# Refresh tokens that rotate per device, and reuse detection that makes theft self-limiting

> Series: MMCA.Common · Article #27 (deep-dive) · Pillar P2 · Group G08 · Rubric §11 · ADR-097 ·
> Status: grounded in `Website/docs-src/adr/097-multi-device-refresh-sessions.md`,
> `MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs`,
> `MMCA.Common.Application/Auth/RefreshSessionSettings.cs`,
> `MMCA.Common.Application/Auth/AuthenticationServiceBase.cs`,
> `MMCA.Common.Domain/Auth/RefreshSession.cs`, and
> `MMCA.Common.Infrastructure/Auth/TokenService.cs`. No em dashes.

**Subtitle:** A stateless JWT you cannot revoke has to be short-lived, which forces a refresh token,
which is a long-lived bearer credential that can be stolen and replayed. Here is the hashed, per-device,
rotate-on-every-use model that turns a captured refresh token into a session that ends itself.

---

You sign in and the server hands you a JWT access token. Every service validates it by signature and
expiry with no database lookup, which is exactly why it is fast, and exactly why you cannot revoke it. A
stateless token is valid until its `exp` passes, full stop. So you keep the lifetime short to bound the
damage of a leak.

Short-lived access tokens are unusable on their own: nobody wants to re-enter a password every fifteen
minutes. The standard answer is a refresh token, a second credential the client presents to mint a fresh
access token without a password. And there is the catch. A refresh token is long-lived by definition, it is
a bearer credential (whoever holds it can use it), and if it is captured it can be replayed for its whole
lifetime. You have traded a fifteen-minute exposure window for a seven-day one.

The naive fixes make it worse. A refresh token that never changes is a static long-lived secret sitting in
client storage. A refresh token that is checked but not rotated lets a thief and the legitimate user both
refresh from the same secret indefinitely, and nothing ever notices. A refresh token kept in plaintext hands
every signed-in account to anything that can read the database. What you actually want is a refresh token
that changes on every use, is stored as a digest you cannot present, and a server that treats a spent one as
evidence.

## Why it matters

The two credentials pull in opposite directions, and you cannot collapse them. The access token wants to be
stateless (no lookup on the hot path) which means it cannot be revoked before it expires, which means it
must be short. The refresh token wants to be long-lived (a usable session) which means it is exactly the
kind of durable secret an attacker wants to steal.

So the design question is not "how do I avoid a refresh token" (you cannot) but "how do I make a stolen
refresh token fail fast." The property to aim for is detectability: if a captured token is ever used
alongside the real client, the server should be able to tell that two parties are refreshing from the same
lineage, and end the session for both rather than let the theft run quietly to the token's natural expiry.

That is what rotation plus reuse detection buys, and MMCA.Common decides it once so every consuming Identity
module inherits the same answer instead of re-litigating it per app.

## The MMCA answer: one hashed session per device, rotated on every use

The workflow is split in two, and the split is the first design decision. `AuthenticationServiceBase<TUser>`
(`AuthenticationServiceBase.cs:67`) decides who is signed in: credentials, lockout, the app's gates.
`IAuthSessionIssuer` (`IAuthSessionIssuer.cs:26`) decides what they are handed: the multi-device refresh
sessions, rotation, reuse detection, the per-user cap and the session claims on the access token, "so this
workflow never touches a session row" (`AuthenticationServiceBase.cs:44-47`). The framework's implementation
is the sealed `AuthSessionIssuer` (`AuthSessionIssuer.cs:42`), registered scoped by `AddInfrastructure`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:176`). Both apps' Identity modules subclass the base,
hand it the issuer, and change nothing about the token logic. Here is the model, piece by piece.

**The access token is stateless; the refresh side is one row per signed-in device.** The access token is a
signed JWT whose `exp` comes from `JwtSettings.AccessTokenExpirationMinutes` (default 15 minutes,
`JwtSettings.cs:66`), written by `TokenService.GenerateAccessToken` (`TokenService.cs:101`, expiry stamped at
`:148`). The refresh side is `RefreshSession`, a sealed framework class kept as a flat bookkeeping record,
with one row per signed-in device (`RefreshSession.cs:43`): the user id, a token hash, an issue instant, an
expiry, and revocation bookkeeping (`:76,79,82,85,88,94,97`). Refresh tokens are deliberately absent from the
credential contract the user aggregate exposes to the workflow: `IAuthUser` carries password material only
(`IAuthUser.cs:9-14,20,23`). A user holds as many live sessions as they have signed-in devices, bounded by a
per-user cap (`AuthSessionIssuer.cs:17-28`). Every access token the issuer mints names the session behind it
in a `sid` claim, stamped by a pass-through token service that wraps the real one
(`SessionStampingTokenService`, `AuthSessionIssuer.cs:552`, claim added at `:584-589`), so the app's claim
code never has to know the claim exists.

**The stored value is a digest, not the token.** `TokenService.GenerateRefreshToken` draws 64 bytes from
`RandomNumberGenerator.GetBytes` and base64-encodes them (`TokenService.cs:155,157,158`). That plaintext
lives only in the response that hands it to the client. What the store keeps is `RefreshSession.TokenHash`,
an unsalted hex SHA-256 digest of the token's UTF-8 bytes (`RefreshSession.cs:79,180-184`), exactly 64
characters wide (`:45-46`). The digest is deterministic on purpose, because lookup is by hash: a presented
token finds its row through `FindByTokenHashAsync(RefreshSession.HashToken(token))`
(`AuthSessionIssuer.cs:312-314`). A database read therefore yields digests, and a digest is not something
you can present.

**Issuing opens a session; refreshing rotates one.** Login (`AuthenticationServiceBase.cs:140`, issuing at
`:230`) and registration (`:243`, issuing at `:325`) both route through `IssueTokensAsync` (`:463`), which
hands the user to `IAuthSessionIssuer.IssueAsync` (`:471`). The issuer opens a fresh session
(`AuthSessionIssuer.cs:78`, body `OpenSessionAsync` at `:356`) before the access token is minted, because
the token carries the session's id, then saves it (`:84`) and returns the token pair (`:86-89`). Refresh runs
its own path. `RefreshTokenAsync` (`AuthenticationServiceBase.cs:329`) calls `RotateAsync`
(`:383`; `AuthSessionIssuer.cs:93`), which resolves the presented token to its session
(`ResolveRotatableSessionAsync`, called at `:104`, body `:301`) and then rotates it (`RotateSessionAsync`,
called at `:112`, body `:397`). Rotation mints a successor session (`:405-412`) and claims the presented row
through `IRefreshSessionStore.TryRotateAsync` (`:419-421`), which revokes it with reason `Rotated` and links
it to that successor via `ReplacedByTokenHash` (`EFRefreshSessionStore.cs:191-196`; `RefreshSession.cs:58,94`).
The successor is a new row with a new id, so the access token handed back carries a new `sid` too
(`AuthSessionIssuer.cs:119-125`). The consequence is the important part: the instant a successor is issued,
the token that bought it is spent, and the rotated row it leaves behind is precisely what makes a replay
visible. One carve-out keeps ordinary concurrency from reading as theft: a spent token that comes back within
a few seconds of its rotation (`RefreshSessions:ReuseGraceSeconds`, default 10, range 0-300,
`RefreshSessionSettings.cs:98-99`) is treated as a race, not a replay.

**Refresh binds to the same principal through the expired access token.** `RefreshTokenAsync` requires the
client to present the just-expired access token alongside the refresh token, and runs it through
`TokenService.GetPrincipalFromExpiredToken` (`AuthenticationServiceBase.cs:343`). That method validates
issuer, audience, signing key, and the pinned algorithm, and skips only the lifetime check
(`TokenService.cs:174,178,179,180,182,187`, with the algorithm re-checked against the header at `:196-197`).
An unsigned, wrong-audience, or algorithm-swapped token yields no principal and the refresh fails
(`AuthenticationServiceBase.cs:344-348`). The user id rides the standard `sub` claim
(`TokenService.cs:110-116`), read at `AuthenticationServiceBase.cs:353` and used to load the account at
`:360`. A second factor the user already verified rides across the rotation too: the `mfa` claim is read off
the signature-validated presented token and stamped on the successor (`:373-378`).

**Five outcomes, two answers.** `ResolveRotatableSessionAsync` (`AuthSessionIssuer.cs:301`) is the
reuse-detection step, and it separates cases that mostly look identical from outside. A blank token, an
unknown hash, or one belonging to another account says nothing about a live session and fails alone
(`:307-310`, `:316-319`): revoking the family on it would let anyone holding one of this user's expired access
tokens sign them out everywhere by posting a random string. A **revoked** row splits by why it died
(`IsReuseSignal`, `:467-477`). A row that was signed out, evicted by the session cap, or already swept by an
earlier reuse event only lost its session, which is not a new theft signal, so that request fails alone and
the user's other devices keep working (`:323-330`). A swept row is dead by construction, and revoking the
family again would buy no containment, only another sign-out for each stale device. A row that was rotated
away (it carries a successor hash) has come back, and what that means depends on when. Rotated less than
`ReuseGraceSeconds` ago, it is a race between sibling requests (another tab, or one browser served by two
replicas), answered `409 Conflict` with `Auth.RefreshSuperseded` and nothing revoked (`:332-337`;
`IsWithinRotationGrace` at `:487-495`). Rotated longer ago, it is the BR-206 reuse signal, so every live
session the user holds is revoked with reason `ReuseDetected` (`:339-343`, `RefreshSession.cs:64`). Only the
`Rotated` reason qualifies for the grace, a revocation stamped slightly ahead of the local clock (another
replica's) counts as inside it, and a grace of `0` turns it off (`:482-485,491-494`). Any other or missing
reason counts as reuse, `AccountDeleted` included (the reason account erasure writes, `RefreshSession.cs:70`,
`RefreshSessionRevocation.cs:86`), the conservative answer for a row the code does not recognize
(`AuthSessionIssuer.cs:458-466,474-476`). An **expired** row
is an ordinary end of life, so that device re-authenticates and the rest are untouched (`:346-348`). Four of
the five outcomes answer with the same `Auth.InvalidRefreshToken` error (`:268-272`), so an unknown token, an
expired one and a replayed one look identical to the caller and the distinction lives in what happens behind
it. The race is the one deliberate exception: `Auth.RefreshSuperseded` (`:279-283`) tells the client its
session is intact and to retry with the token the winning request received.

**A simultaneous refresh is a race first, and a replay only past the grace.** Two requests presenting the
same still-live token both read an un-revoked row, so the store arbitrates rather than memory:
`TryRotateAsync` (`EFRefreshSessionStore.cs:174`) is a conditional update on `RevokedAt IS NULL` (`:191`),
and only one request claims the row. The loser's tracked copy was read before that claim and still shows the
row live, so it re-reads the row untracked, as the database holds it now (`AuthSessionIssuer.cs:429-431`),
and branches the way the lookup path does. A row that a sign-out, a cap eviction or a reuse sweep reached
first fails that request alone (`:432-438`). A row the winning request rotated inside the grace answers 409
with nothing revoked (`:440-443`). A row rotated longer ago than the grace, or unreadable, is
indistinguishable from a replay and gets the replay answer: the whole live family is revoked (`:445-452`).

**The expiry slides on every rotation.** Every session is stamped with its issue instant plus
`RefreshTokenLifetime`, both when one is opened (`AuthSessionIssuer.cs:368`) and when a successor is minted
(`:410`). That property reads `TokenService.RefreshTokenLifetime` (`TokenService.cs:165`), derived from
`JwtSettings.RefreshTokenExpirationDays` (`JwtSettings.cs:73`, default 7 days). A device that refreshes at
least once inside each window stays signed in indefinitely; re-authentication is required only after a full
lifetime passes with no successful refresh, or after a revocation. Both configured lifetimes must be at
least 1 (`[Range(1, int.MaxValue)]`, `JwtSettings.cs:65,72`), and `AddCommonAuthentication` binds the
settings with `ValidateDataAnnotations().ValidateOnStart()`
(`MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:136-139`), so a zero or
negative value fails host startup rather than every sign-in. The issuer still guards itself against an
`ITokenService` that reports a non-positive lifetime: it falls back to the seven-day BR-205 default for the
refresh side (`AuthSessionIssuer.cs:61-62`) and to fifteen minutes for the access side (`:58-59`), and that
second fallback sets only the expiry the response reports (`:89`, `:125`), never the JWT's own `exp`.

**A per-user cap bounds the family.** `RefreshSessionSettings.MaxActiveSessionsPerUser` binds
`RefreshSessions:MaxActiveSessionsPerUser`, default 10, range 1-1000 (`RefreshSessionSettings.cs:34-35`),
validated at startup (`MMCA.Common.Infrastructure/DependencyInjection.cs:168-171`). Opening one session past
the cap revokes the user's oldest live session with reason `SessionCapExceeded` rather than refusing the
sign-in (`EnforceSessionCapAsync` at `AuthSessionIssuer.cs:520`, eviction loop `:529-532`, constant
`ReasonSessionCap` at `RefreshSession.cs:67`). Expired-but-unrevoked rows authenticate nobody and do not
count against the cap; they age out with the framework's retention sweep, `RefreshSessionCleanupService`
over the `RefreshSessions:RetentionDays` window (default 30, `RefreshSessionSettings.cs:71-72`), which the
host runs once `RefreshSessions:Enabled` is set (`DependencyInjection.cs:186-190`).

**Explicit revocation names one device or takes them all.** `RevokeTokenAsync`
(`AuthenticationServiceBase.cs:398`) hands an optional refresh token to `SignOutAsync`
(`AuthSessionIssuer.cs:151`). A live session belonging to that user is revoked alone with reason
`SignedOut`, which is the sign-out-this-device path (`:165-172`). Anything else (an unknown token, another
account's token, an already-revoked row) leaves the caller unidentifiable, so the request degrades to
revoking every live session the user holds rather than reporting success for a revocation that reached
nothing (`:175`). Beside it sit a deliberate sign-out-everywhere (`RevokeAllSessionsAsync`,
`AuthenticationServiceBase.cs:415`, into `SignOutEverywhereAsync`, `AuthSessionIssuer.cs:180`), a device list
(`GetSessionsAsync` `:432`, `ListActiveAsync` `:194`), and a revoke-by-session-id (`RevokeSessionByIdAsync`
`:448`, `RevokeSessionAsync` `:232`) whose ownership check is the store query itself, so another account's
session id and one that never existed both answer `NotFound` (`:237-245`).

```csharp
// AuthSessionIssuer.ResolveRotatableSessionAsync: five outcomes, two answers (shape, not byte-for-byte).
if (string.IsNullOrWhiteSpace(refreshToken))
{
    return Failure(InvalidRefreshTokenError());
}

var session = await refreshSessions.FindByTokenHashAsync(RefreshSession.HashToken(refreshToken), ct);
if (session is null || !session.UserId.Equals(userId))
{
    return Failure(InvalidRefreshTokenError());     // says nothing about a live session: fail alone
}

if (session.IsRevoked)
{
    if (!IsReuseSignal(session))
    {
        return Failure(InvalidRefreshTokenError()); // signed out, cap-evicted or reuse-swept: this device alone
    }

    if (IsWithinRotationGrace(session, now))
    {
        return Failure(RefreshSupersededError());   // 409: a sibling rotated it a moment ago, nothing revoked
    }

    await RevokeLiveSessionsAsync(userId, RefreshSession.ReasonReuseDetected, now, ct);
    await refreshSessions.SaveChangesAsync(ct);     // BR-206: a rotated-away token came back past the grace
    return Failure(InvalidRefreshTokenError());
}

return session.ExpiresAt <= now                     // an ordinary end of life: this device alone
    ? Failure(InvalidRefreshTokenError())
    : Success(session);

// IsReuseSignal: rotated (a successor hash), or any reason other than SignedOut / SessionCapExceeded / ReuseDetected.
static bool IsReuseSignal(RefreshSession s) =>
    s.ReplacedByTokenHash is not null
    || s.ReasonRevoked is not (RefreshSession.ReasonSignedOut
        or RefreshSession.ReasonSessionCap
        or RefreshSession.ReasonReuseDetected);

// IsWithinRotationGrace: only a Rotated row, revoked less than ReuseGraceSeconds ago (0 turns it off).
bool IsWithinRotationGrace(RefreshSession s, DateTime now) =>
    grace > TimeSpan.Zero
    && s.ReasonRevoked == RefreshSession.ReasonRotated
    && s.RevokedAt is { } revokedAt
    && now - revokedAt < grace;

// RotateSessionAsync: the store, not memory, decides which request owns the rotation.
var refreshToken = tokenService.GenerateRefreshToken();
var successor = RefreshSession.Create(userId, refreshToken, now, now.Add(RefreshTokenLifetime), ipAddress, userAgent);
if (!await refreshSessions.TryRotateAsync(session, successor.Value!, now, ct))
{
    var current = await refreshSessions.FindByIdUntrackedAsync(session.Id, ct); // the row as stored now
    if (current is not null && !IsReuseSignal(current))
    {
        return Failure(InvalidRefreshTokenError()); // lost to a sign-out, cap eviction or reuse sweep: this device alone
    }

    if (current is not null && IsWithinRotationGrace(current, now))
    {
        return Failure(RefreshSupersededError());   // lost to a sibling inside the grace: 409, nothing revoked
    }

    await RevokeLiveSessionsAsync(userId, RefreshSession.ReasonReuseDetected, now, ct);
    await refreshSessions.SaveChangesAsync(ct);
    return Failure(InvalidRefreshTokenError());     // past the grace, or unreadable: the replay answer
}
```

## Both apps inherit it; the OAuth path opens the same session

The rotation, reuse detection, session cap, and lifetime logic are identical in ADC and Store because
neither one owns a copy. ADC's `AuthenticationService` (`AuthenticationService.cs:50`) and Store's
(`AuthenticationService.cs:26`) each take an `IAuthSessionIssuer` (ADC `:56`, Store `:31`) and forward it into
the base constructor (ADC `:59`, Store `:33`); the token lifetimes and the cap are configuration (the `Jwt`
and `RefreshSessions` sections), not constructor arguments (ADC `:44-47`). What the subclasses supply is
app-specific hooks: the claim set (ADC's `speaker_id`, Store's `customer_id`), the deactivated-account
gates, the registration side effect. They mint through the base's `TokenService` property, which is the
issuer's `sid`-stamping wrapper (`AuthenticationServiceBase.cs:105`). The security-relevant token workflow is
not in either subclass.

That single-source property is what makes ADC's external OAuth login (ADR-036) fall in line for free. The
external-login body (`ExternalLoginCoreAsync`, ADC `AuthenticationService.cs:225`) ends by calling the shared
`IssueTokensAsync` (`:336`), so a federated sign-in opens a refresh session through exactly the path a
password sign-in takes: hashed at rest, counted against the same per-user cap, rotated through the same
chain. A user who signed in with Google gets the same guarantees as one who typed a password, because both
go through the same issuer.

## Trade-offs, honestly

This model is a deliberate set of choices, and ADR-097 names the edges rather than hiding them.

- **Every device is its own row, so sign-ins grow a table.** A session is a device fact rather than an
  account fact, which is the point: signing in on a second device leaves the first signed in
  (`AuthSessionIssuer.cs:17-18`). The cost is unbounded growth without two guards, and both are there: a
  per-user cap that evicts the oldest live session (`:520,529-532`) and a retention sweep that hard-deletes
  dead rows after `RetentionDays` (`RefreshSessionSettings.cs:54-58`). A revoked row survives that window
  because it is the evidence the reuse check reads; once it is swept, the same replay reads as an unknown
  token and fails alone. The thirty-day default sits well past the seven-day token lifetime, so a token still
  capable of being replayed always has its row, and lowering the window below that lifetime gives the
  guarantee up (`:60-66`).
- **Reuse detection is aggressive, past a short grace.** Two browser tabs refreshing at nearly the same
  instant present the same token. Inside `ReuseGraceSeconds` (default 10, `RefreshSessionSettings.cs:98-99`)
  the second request is answered 409 and retries, whether it lands on the rotated row or loses the
  `TryRotateAsync` claim (`AuthSessionIssuer.cs:332-337`, `:440-443`). The grace cuts both ways: a stolen token
  replayed within that window of a legitimate rotation gets the same 409 instead of revoking the family,
  because the two cannot be told apart there (`RefreshSessionSettings.cs:89-96`). Past the window a benign
  race is again indistinguishable from theft and still revokes the family (`AuthSessionIssuer.cs:445-452`),
  while a row already flagged as reuse fails that request alone, without revoking the family again, however
  recent (`RefreshSessionSettings.cs:93-94`). A grace of `0` fails closed on every rotated token that comes
  back.
- **Only a rotated token is evidence.** A token from a device that was signed out, cap-evicted, or already
  swept by an earlier reuse event fails alone
  (`:323-330`, and `:432-438` when it loses the rotation claim), so an ordinary sign-out never ends the user's
  other sessions. The flip side is that a thief replaying a token whose device was already signed out triggers
  nothing beyond that one rejection; the family-wide response is reserved for the case that proves two parties
  held the same lineage.
- **The refresh path is server-side write state.** Unlike the fully stateless access token, every issue
  inserts a row and every refresh revokes one and inserts its successor (`OpenSessionAsync` `:356-381`,
  `RotateSessionAsync` `:397-456`), so refresh always costs a write to the Identity database. That is the
  price of being able to revoke.
- **No absolute cap anchored to the opening login.** Because the expiry is re-stamped on every rotation
  (`:410`), the seven-day window bounds inactivity, not total session age, and a continuously active client
  stays signed in indefinitely. The per-user cap bounds how many devices, and the retention sweep bounds how
  long a dead row lingers, but neither ends a chain that keeps refreshing. An absolute cap on session age is
  deliberately not imposed.
- **A lifetime fallback survives below configuration.** A zero or negative configured lifetime never gets
  that far: both `Jwt` lifetimes carry `[Range(1, int.MaxValue)]` (`JwtSettings.cs:65,72`) and validate at
  startup (`WebApplicationBuilderExtensions.Authentication.cs:136-139`), so the host refuses to boot. What
  remains sits behind `ITokenService`: a token service other than the framework's (a test double, a custom
  implementation) that leaves `RefreshTokenLifetime` alone lands on seven days through the interface default
  (`ITokenService.cs:40`, `AccessTokenLifetime` fifteen minutes at `:33`), and one that reports a
  non-positive value is quietly treated as seven days by the issuer (`AuthSessionIssuer.cs:61-62`) instead
  of surfacing an error. Its fifteen-minute access-side fallback (`:58-59`) reaches only the expiry the
  response reports, not the token, whose `exp` is whatever that token service stamps.

None of these are reasons to skip rotation. They are the reasons to wire it knowing what it does and does not
promise.

## Apply this even without MMCA

The pattern ports to any stack with a JWT story:

1. **Keep the access token short and stateless.** Validate it by signature and expiry with no lookup, and set
   a lifetime measured in minutes so the un-revocable window stays small.
2. **Give each device its own server-side session row, and rotate it on every refresh.** One row per
   sign-in, revoked and replaced the moment it is used, with the successor's identity recorded on the row it
   replaced. The revoked row is not garbage: it is the detector, so keep it longer than the token could live.
3. **Store a digest, never the token.** Make the refresh token opaque random bytes (sixty-four is plenty),
   hand the plaintext to the client once, and keep only an unsalted hash so the lookup stays a single indexed
   read and a database dump mints nothing.
4. **Bind refresh to the presented (expired) access token, and pin the algorithm.** Read the principal from
   the expired token while skipping only the lifetime check, and re-verify issuer, audience, key, and
   algorithm so the token cannot tell you how to trust it.
5. **Split your rejections behind one error message, and give the race its own answer.** An unknown token
   fails alone, an expired session fails alone, a signed-out session fails alone, and a rotated-away session
   that comes back revokes the user's whole live family. Record why and when each row was revoked so the
   detector can tell those apart, and return one indistinguishable error for all of them so the detector does
   not double as an oracle. If two tabs or two replicas legitimately race, answer a token rotated a few seconds
   ago with a distinct, retryable conflict rather than a sign-out, knowing a thief inside that window gets the
   same pass.

The takeaway: **a refresh token you rotate on every use, store only as a hash, and answer with a family-wide
revoke the instant a rotated-away one reappears past a few seconds' race grace, turns a long-lived stealable
secret into a session that ends itself.** The stateless access token stays fast; the write on refresh is what
buys you the ability to revoke one device or all of them.

---

**What we covered:** why a stateless access token forces a refresh token and a refresh token forces a theft
story, how MMCA.Common splits who-is-signed-in from what-they-are-handed and keeps one hashed
`RefreshSession` row per signed-in device, rotated through a store-arbitrated claim, how a rotated-away row
is the reuse signal that revokes a user's whole live family once a short race grace has passed (inside it the
answer is a retryable 409) while a signed-out, cap-evicted, reuse-swept or expired one fails alone, and the honest
trade-offs (a growing table, aggressive reuse detection softened by a grace a thief can also use, a
server-side write per refresh, no absolute session-age cap, a lifetime fallback only a custom token service
reaches) that come with
choosing to fail closed past the grace.

**Next in the series:** the write-once REST surface every entity inherits: generic entity controllers that
give a new aggregate its full CRUD API without a hand-written controller per type.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-097 behind this
pattern, or `dotnet add package MMCA.Common.Application` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-097 (multi-device refresh sessions): `Website/docs-src/adr/097-multi-device-refresh-sessions.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Authentication, Security*

*Notes (evidence refresh, 2026-10-29, MMCA.Common v1.265.1 (`MMCA.Common/FACTS.md:14`); ADC and Store pin
1.265.1 at `MMCA.ADC/Directory.Packages.props:110` and `MMCA.Store/Directory.Packages.props:10`): every named
type, anchor and number re-read from source this run. Changes this run (2026-10-29): `IsReuseSignal` excludes
`ReasonReuseDetected` alongside `ReasonSignedOut` and `ReasonSessionCap`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:474-476`, doc :458-466),
so a row swept by an earlier reuse event fails that request alone on the lookup path (:323-330, comment
:325-326) and on the lost-claim path (:432-438, comment :434), and only a row rotated past the grace or an
unreadable one gets the family revoke (:445-452, comment :445); `RefreshSessionSettings.cs:93-94` says the
same, and ADR-097 records it as the 2026-10-25 revision (`Website/docs-src/adr/097-multi-device-refresh-sessions.md:35-37`,
1.261.0). Reworked for this: "Five outcomes, two answers", the simultaneous-refresh paragraph, the code block
(`IsReuseSignal` and three comments), the aggressive-reuse and "Only a rotated token is evidence" trade-off
bullets, and "What we covered". Every `AuthSessionIssuer` and `AuthenticationServiceBase` anchor moved and is
re-anchored in place (`AuthenticationServiceBase` grew an app gate `ValidateRefreshCandidateAsync`, called at
:367, definition :605). Prior pass 2026-10-22 at v1.250.0 recorded: both `Jwt` lifetimes carry
`[Range(1, int.MaxValue)]`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:65` access, `:72` refresh, docs
:60-64 and :68-71) and `AddCommonAuthentication` binds `JwtSettings` with
`ValidateDataAnnotations().ValidateOnStart()`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:136-139`),
so a non-positive configured lifetime fails startup; the issuer fallbacks (:58-59, :61-62) are reached only
through an `ITokenService` reporting a non-positive lifetime.
A fifth revocation reason, `ReasonAccountDeleted` = "AccountDeleted" (`RefreshSession.cs:70`, written on
account erasure by `MMCA.Common.Application/Auth/RefreshSessionRevocation.cs:86`, doc :58-61), counts as
reuse through the conservative return of `IsReuseSignal`; the five-outcomes paragraph names it.
Governing record: ADR-097, Accepted 2026-08-26, revised 2026-08-27, 2026-09-01, 2026-09-07, 2026-10-01 (:20),
2026-10-06 (:22, re-anchored on `AuthSessionIssuer`), 2026-10-07 (:25-29, grace adopted), 2026-10-21
(:30-34, `AccountDeleted` erasure, password-reset ordering, administrator sessions view, anchors after
1.250.0), 2026-10-25 (:35-37, a reuse-swept token fails alone) and 2026-10-26 (:38, anchors after 1.261.0);
its reason paragraph says "`AccountDeleted` included" (:130) and its trade-off reads "still revokes a family
on a benign race that outlasts the grace" (:460-472, grace bullet :473). ADR-050 superseded by it
(`050-jwt-refresh-token-rotation.md:4`). Standing inventory, corrected in place:
`AuthSessionIssuer` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:42`,
606 lines; class doc device :17-18, cap :27-28) behind `IAuthSessionIssuer` (`Auth/Sessions/IAuthSessionIssuer.cs:26`;
`TokenService` :34, `IssueAsync` :46, `RotateAsync` :70, `SignOutAsync` :97, `SignOutEverywhereAsync` :103),
registered `TryAddScoped` at `MMCA.Common.Infrastructure/DependencyInjection.cs:176`; the base
(`AuthenticationServiceBase.cs:67`, 729 lines) delegates, class doc :44-47. Base anchors: `LoginAsync` :140
(issue :230), `RegisterAsync` :243 (issue :325), `RefreshTokenAsync` :329 (`GetPrincipalFromExpiredToken`
:343, null principal :344-348, `GetUserId` :353, user load :360, `ValidateRefreshCandidateAsync` :367, `mfa`
carry :373-378, `RotateAsync` call :383), `RevokeTokenAsync` :398 (`SignOutAsync` :409),
`RevokeAllSessionsAsync` :415, `GetSessionsAsync` :432, `RevokeSessionByIdAsync` :448, `IssueTokensAsync` :463
(`IssueAsync` :471), `TokenService` property :105.
Issuer anchors: lifetime fallbacks :58-59 (15 min) and :61-62 (7 days); `IssueAsync` :65 (open :78, save :84,
response :86-89); `RotateAsync` :93 (resolve :104, rotate :112, new `sid` :119-125); `SignOutAsync` :151
(single device :165-172, degrade :175); `SignOutEverywhereAsync` :180; `ListActiveAsync` :194;
`RevokeSessionAsync` :232 (NotFound :237-245; an already-revoked session answers NotFound
`Auth.SessionAlreadyRevoked` and writes nothing, :247-254); `InvalidRefreshTokenError` :268-272,
`RefreshSupersededError` :279-283; `ResolveRotatableSessionAsync` :301 (blank :307-310, lookup :312-314,
unknown or wrong user :316-319, revoked :321, non-reuse fail-alone :323-330, grace 409 :332-337, family
revoke :339-343, expired :346-348); `OpenSessionAsync` :356 (generate :363, expiry :368, cap :377, staged
insert :378); `RotateSessionAsync` :397 (successor :405-412, expiry :410, `TryRotateAsync` :419-421, lost
claim :423-453, untracked re-read :429-431, fail alone :432-438, 409 :440-443, family revoke :445-452);
`IsReuseSignal` :467-477 (doc :458-466, conservative return :474-476); `IsWithinRotationGrace` :487-495 (doc
:482-485, predicate :491-494); `RevokeLiveSessionsAsync` :498; `EnforceSessionCapAsync` :520 (cap read :522,
loop :529-532); `SessionStampingTokenService` :552 (`sid` :584-589, `mfa` :591-594). Store claim:
`MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:174` (inside
`ExecuteInTransactionAsync` :187, conditional update predicate :191,
`RevokedAt`/`ReasonRotated`/`ReplacedByTokenHash` :194-196). Session record:
`MMCA.Common.Domain/Auth/RefreshSession.cs:43` (sealed class documented as a flat record, doc :27-32;
`IAnonymizable`, `[Pii]` `IpAddress` :104-105, `UserAgent` :111-112, `Anonymize` :217), `TokenHashLength` 64
:45-46, reasons `ReasonRotated` :58, `ReasonSignedOut` :61, `ReasonReuseDetected` :64, `ReasonSessionCap` =
"SessionCapExceeded" :67, `ReasonAccountDeleted` :70, fields `Id` :73, `UserId` :76, `TokenHash` :79,
`CreatedAt` :82, `ExpiresAt` :85, `RevokedAt` :88, `ReplacedByTokenHash` :94, `ReasonRevoked` :97,
`IsActiveAt` :119, `Create` :132, `HashToken` (SHA-256 over UTF-8, upper-case hex) :180-184, `Revoke` :194.
Settings: `MMCA.Common.Application/Auth/RefreshSessionSettings.cs` `MaxActiveSessionsPerUser`
[Range(1,1000)] = 10 :34-35, `RetentionDays` = 30 :71-72 (hard-delete doc :54-58, reuse-bound doc :60-66),
`ReuseGraceSeconds` [Range(0,300)] = 10 :98-99 (doc :82-97, security trade-off :89-96, flagged row fails
alone :93-94); options bound and `ValidateOnStart` at `DependencyInjection.cs:168-171`;
`RefreshSessionCleanupService` registered only when `RefreshSessions:Enabled` :186-190 (`AddHostedService`
:189). Tokens:
`MMCA.Common.Infrastructure/Auth/TokenService.cs` `GenerateAccessToken` :101, `sub` only :110-116, `exp`
:148, `GenerateRefreshToken` :155 (64 bytes :157, base64 :158), `RefreshTokenLifetime` :165,
`GetPrincipalFromExpiredToken` :174 (issuer :178, audience :179, key :180, lifetime off :182,
`ValidAlgorithms` :187, header alg re-check :196-197); `JwtSettings.cs` 15 min :66, 7 days :73, `Validate`
:79-94 (signing-key checks only; the lifetimes are range-checked by attribute);
`MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs` `GenerateRefreshToken` :26,
interface defaults `AccessTokenLifetime` 15 min :33 and `RefreshTokenLifetime` 7 days :40;
`MMCA.Common.Domain/Auth/IAuthUser.cs:9-14,20,23` unchanged. Subclasses: ADC
`MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:50` (`IAuthSessionIssuer` :56, base :59,
configuration doc :44-47, `ExternalLoginAsync` :213, `ExternalLoginCoreAsync` :225, `IssueTokensAsync`
:336, `speaker_id` :406-407); Store `MMCA.Store.Identity.Application/Users/AuthenticationService.cs:26`
(`IAuthSessionIssuer` :31, base :33, `customer_id` builder :184-187, claim :186). Numbers: 15 min, 7 days,
64 bytes, 64-char hash, cap 10, range 1-1000, retention 30 days, reuse grace 10 seconds, range 0-300,
outcomes five (four share `Auth.InvalidRefreshToken`, one answers 409 `Auth.RefreshSuperseded`), lifetime
range 1 to int.MaxValue on both `Jwt` lifetimes, revocation reasons five, reasons excluded from the reuse
signal three (two before 1.261.0). The code block is
illustrative of the shape, condensed from `ResolveRotatableSessionAsync` (:307-348), `IsReuseSignal`
(:467-477), `IsWithinRotationGrace` (:487-495) and `RotateSessionAsync` (:405-452); it is not byte-for-byte.
Prior passes: 2026-10-22 at v1.250.0 (lifetime range checks, `AccountDeleted`); 2026-10-08 at v1.233.0
adopted the reuse grace window into the body ("Five outcomes, two answers", the simultaneous-refresh
paragraph, the code block, the aggressive-reuse trade-off, apply item 5, the takeaway and "What we
covered"); 2026-10-02 at v1.221.0 moved the session logic from `AuthenticationServiceBase.cs` into
`AuthSessionIssuer` and introduced the `IsReuseSignal` split. Prose verified free of em dashes and the
banned boundary-noun.*

- Full series index: https://ivanball.github.io/writing.html
