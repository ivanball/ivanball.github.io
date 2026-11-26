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
(`AuthenticationServiceBase.cs:74`) decides who is signed in: credentials, lockout, the app's gates.
`IAuthSessionIssuer` (`IAuthSessionIssuer.cs:27`) decides what they are handed: the multi-device refresh
sessions, rotation, reuse detection, the per-user cap and the session claims on the access token, "so this
workflow never touches a session row" (`AuthenticationServiceBase.cs:50-53`). The framework's implementation
is the sealed `AuthSessionIssuer` (`AuthSessionIssuer.cs:54`), registered scoped by `AddInfrastructure`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:182`). Both apps' Identity modules subclass the base,
hand it the issuer, and change nothing about the token logic. Here is the model, piece by piece.

**The access token is stateless; the refresh side is one row per signed-in device.** The access token is a
signed JWT whose `exp` comes from `JwtSettings.AccessTokenExpirationMinutes` (default 15 minutes,
`JwtSettings.cs:66`), written by `TokenService.GenerateAccessToken` (`TokenService.cs:108`, expiry stamped at
`:178`). The refresh side is `RefreshSession`, a sealed framework class kept as a flat bookkeeping record,
with one row per signed-in device (`RefreshSession.cs:46`): the user id, a token hash, an issue instant, an
expiry, and revocation bookkeeping (`:85,88,91,94,97,103,106`). Refresh tokens are deliberately absent from the
credential contract the user aggregate exposes to the workflow: `IAuthUser` carries password material and a
service-account flag only (`IAuthUser.cs:10-12,19,22,32`). A user holds as many live sessions as they have
signed-in devices, bounded by a per-user cap (`AuthSessionIssuer.cs:19-20,31-32`). Every access token the
issuer mints names the session behind it in a `sid` claim, stamped by a pass-through token service that wraps
the real one (`SessionStampingTokenService`, `AuthSessionIssuer.cs:737`, claim added at `:772-777`), so the
app's claim code never has to know the claim exists.

**The stored value is a digest, not the token.** `TokenService.GenerateRefreshToken` draws 64 bytes from
`RandomNumberGenerator.GetBytes` and base64-encodes them (`TokenService.cs:185,187,188`). That plaintext
lives only in the response that hands it to the client. What the store keeps is `RefreshSession.TokenHash`,
an unsalted hex SHA-256 digest of the token's UTF-8 bytes (`RefreshSession.cs:88,301-304`), exactly 64
characters wide (`:49`). The digest is deterministic on purpose, because lookup is by hash: a presented
token finds its row through `FindByTokenHashAsync(RefreshSession.HashToken(token))`
(`AuthSessionIssuer.cs:409-411`). A database read therefore yields digests, and a digest is not something
you can present.

**Issuing opens a session; refreshing rotates one.** Login (`AuthenticationServiceBase.cs:164`, issuing at
`:281`) and registration (`:301`, issuing at `:397`) both route through `IssueTokensCoreAsync` (`:728`), which
hands the user to `IAuthSessionIssuer.IssueAsync` (`:740`). The issuer opens a fresh session
(`AuthSessionIssuer.cs:86`, opened at `:99`, body `OpenSessionAsync` at `:469`) before the access token is
minted, because the token carries the session's id, then saves it (`:105`) and returns the token pair
(`:112-115`). Refresh runs its own path. `RefreshTokenAsync` (`AuthenticationServiceBase.cs:401`) calls
`RotateAsync` (`:460`; `AuthSessionIssuer.cs:124`), which resolves the presented token to its session
(`ResolveRotatableSessionAsync`, called at `:135`, body `:398`) and then rotates it (`RotateSessionAsync`,
called at `:143`, body `:510`). Rotation mints a successor session that continues the presented one's sign-in
(`CreateSuccessor`, `:520-526`; `SignInId`, `RefreshSession.cs:115`) and claims the presented row through
`IRefreshSessionStore.TryRotateAsync` (`AuthSessionIssuer.cs:533-535`), which revokes it with reason `Rotated`
and links it to that successor via `ReplacedByTokenHash` (`EFRefreshSessionStore.cs:321-326`;
`RefreshSession.cs:67,103`). The successor is a new row with a new id, so the access token handed back carries
a new `sid` too (`AuthSessionIssuer.cs:150-156`). The consequence is the important part: the instant a
successor is issued, the token that bought it is spent, and the rotated row it leaves behind is precisely
what makes a replay visible. One carve-out keeps ordinary concurrency from reading as theft: a spent token
that comes back within a few seconds of its rotation (`RefreshSessions:ReuseGraceSeconds`, default 10, range
0-300, `RefreshSessionSettings.cs:98-99`) is treated as a race, not a replay.

**Refresh binds to the same principal through the expired access token.** `RefreshTokenAsync` requires the
client to present the just-expired access token alongside the refresh token, and runs it through
`TokenService.GetPrincipalFromExpiredToken` (`AuthenticationServiceBase.cs:415`). That method validates
issuer, audience, signing key, and the pinned algorithm, and skips only the lifetime check
(`TokenService.cs:204,208,209,210,212,218`, with the algorithm re-checked against the header at `:228`).
An unsigned, wrong-audience, or algorithm-swapped token yields no principal and the refresh fails
(`AuthenticationServiceBase.cs:416-420`). The user id rides the standard `sub` claim
(`TokenService.cs:146`), read at `AuthenticationServiceBase.cs:425` and used to load the account at
`:432`. A second factor the user already verified rides across the rotation too: the `mfa` claim is read off
the signature-validated presented token and stamped on the successor (`:445-450`). The sign-in instant rides
it the same way and unchanged, as `auth_time` (`:452-455`), so a refresh never makes a session look freshly
signed in; the wrapper stamps both claims (`AuthSessionIssuer.cs:779-790`).

**Five outcomes, two answers, and one opt-in recovery.** `ResolveRotatableSessionAsync`
(`AuthSessionIssuer.cs:398`) is the reuse-detection step, and it separates cases that mostly look identical
from outside. A blank token, an unknown hash, or one belonging to another account says nothing about a live
session and fails alone (`:404-407`, `:413-416`): revoking the family on it would let anyone holding one of
this user's expired access tokens sign them out everywhere by posting a random string. A **revoked** row
splits by why it died (`IsReuseSignal`, `:579-589`). A row that was signed out, evicted by the session cap, or
already swept by an earlier reuse event only lost its session, which is not a new theft signal, so that
request fails alone and the user's other devices keep working (`:420-427`). A swept row is dead by
construction, and revoking the family again would buy no containment, only another sign-out for each stale
device. A row that was rotated away (it carries a successor hash) has come back, and what that means depends
on when. Rotated less than `ReuseGraceSeconds` ago, it is a race between sibling requests (another tab, or
one browser served by two replicas), answered `409 Conflict` with `Auth.RefreshSuperseded` and nothing
revoked (`:429-434`; `IsWithinRotationGrace` at `:599-607`). Rotated longer ago, it is the BR-206 reuse
signal, so every live session the user holds is revoked with reason `ReuseDetected` and one Warning is logged
(`RevokeFamilyOnReuseAsync`, called at `:454`, body `:666-673`; `RefreshSession.cs:73`). One opt-in branch
sits between the grace and that revoke. With `RefreshSessions:LostResponseRecoveryMinutes` above zero
(default 0, so off; range 0-1440, `RefreshSessionSettings.cs:122-123`), a row revoked as `Rotated` inside
that window whose successor belongs to the same user and is still live (so nobody ever presented it) reads as
a client that never received the rotation's response: the successor is rotated in its place through the
normal claim, with a Warning logged (`FindRecoverableSuccessorAsync`, called at `:436-445`, body `:619-643`),
and a successor a sibling request recovered within the grace answers the same 409 (`:447-452`, `:640-642`).
Only the `Rotated` reason qualifies for the grace, a revocation stamped slightly ahead of the local clock
(another replica's) counts as inside it, and a grace of `0` turns it off (`:594-597,603-606`). Any other or
missing reason counts as reuse, `AccountDeleted` included (the reason account erasure writes,
`RefreshSession.cs:79`, `RefreshSessionRevocation.cs:86`), the conservative answer for a row the code does
not recognize (`AuthSessionIssuer.cs:570-577,586-588`). An **expired** row
is an ordinary end of life, so that device re-authenticates and the rest are untouched (`:459-461`). Four of
the five outcomes answer with the same `Auth.InvalidRefreshToken` error (`:365-369`), so an unknown token, an
expired one and a replayed one look identical to the caller and the distinction lives in what happens behind
it. The race is the one deliberate exception: `Auth.RefreshSuperseded` (`:376-380`) tells the client its
session is intact and to retry with the token the winning request received.

**A simultaneous refresh is a race first, and a replay only past the grace.** Two requests presenting the
same still-live token both read an un-revoked row, so the store arbitrates rather than memory:
`TryRotateAsync` (`EFRefreshSessionStore.cs:304`) is a conditional update on `RevokedAt IS NULL` (`:321`),
and only one request claims the row. The loser's tracked copy was read before that claim and still shows the
row live, so it re-reads the row untracked, as the database holds it now (`AuthSessionIssuer.cs:543-545`),
and branches the way the lookup path does. A row that a sign-out, a cap eviction or a reuse sweep reached
first fails that request alone (`:546-552`). A row the winning request rotated inside the grace answers 409
with nothing revoked (`:554-557`). A row rotated longer ago than the grace, or unreadable, is
indistinguishable from a replay and gets the replay answer: the whole live family is revoked (`:559-562`).

**The expiry slides on every rotation.** Every session is stamped with its issue instant plus
`RefreshTokenLifetime`, both when one is opened (`AuthSessionIssuer.cs:481`) and when a successor is minted
(`:524`). That property reads `TokenService.RefreshTokenLifetime` (`TokenService.cs:195`), derived from
`JwtSettings.RefreshTokenExpirationDays` (`JwtSettings.cs:73`, default 7 days). A device that refreshes at
least once inside each window stays signed in indefinitely; re-authentication is required only after a full
lifetime passes with no successful refresh, or after a revocation. Both configured lifetimes must be at
least 1 (`[Range(1, int.MaxValue)]`, `JwtSettings.cs:65,72`), and `AddCommonAuthentication` binds the
settings with `ValidateDataAnnotations().ValidateOnStart()`
(`MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:136-139`), so a zero or
negative value fails host startup rather than every sign-in. The issuer still guards itself against an
`ITokenService` that reports a non-positive lifetime: it falls back to the seven-day BR-205 default for the
refresh side (`AuthSessionIssuer.cs:82-83`) and to fifteen minutes for the access side (`:79-80`), and that
second fallback sets only the expiry the response reports (`:115`, `:156`), never the JWT's own `exp`.

**A per-user cap bounds the family.** `RefreshSessionSettings.MaxActiveSessionsPerUser` binds
`RefreshSessions:MaxActiveSessionsPerUser`, default 10, range 1-1000 (`RefreshSessionSettings.cs:34-35`),
validated at startup (`MMCA.Common.Infrastructure/DependencyInjection.cs:169-172`). Opening one session past
the cap revokes the user's oldest live session with reason `SessionCapExceeded` rather than refusing the
sign-in (`EnforceSessionCapAsync` at `AuthSessionIssuer.cs:705`, eviction loop `:714-717`, constant
`ReasonSessionCap` at `RefreshSession.cs:76`). Expired-but-unrevoked rows authenticate nobody and do not
count against the cap; they age out with the framework's retention sweep, `RefreshSessionCleanupService`
over the `RefreshSessions:RetentionDays` window (default 30, `RefreshSessionSettings.cs:71-72`), which the
host runs once `RefreshSessions:Enabled` is set (`DependencyInjection.cs:209-212`).

**Explicit revocation names one device or takes them all.** `RevokeTokenAsync`
(`AuthenticationServiceBase.cs:476`) hands an optional refresh token to `SignOutAsync`
(`AuthSessionIssuer.cs:193`). A live session belonging to that user is revoked alone with reason
`SignedOut`, which is the sign-out-this-device path (`:207-214`). Anything else (an unknown token, another
account's token, an already-revoked row) leaves the caller unidentifiable, so the request degrades to
revoking every live session the user holds rather than reporting success for a revocation that reached
nothing (`:217`). Beside it sit a deliberate sign-out-everywhere (`RevokeAllSessionsAsync`,
`AuthenticationServiceBase.cs:493`, into `SignOutEverywhereAsync`, `AuthSessionIssuer.cs:222`), a device list
(`GetSessionsAsync` `:510`, `ListActiveAsync` `:236`), and a revoke-by-session-id (`RevokeSessionByIdAsync`
`:538`, `RevokeSessionAsync` `:293`) whose ownership check is the store query itself, so another account's
session id and one that never existed both answer `NotFound` (`:298-306`).

```csharp
// AuthSessionIssuer.ResolveRotatableSessionAsync: five outcomes, two answers, one opt-in recovery
// (shape, not byte-for-byte).
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

    var (recovered, superseded) = await FindRecoverableSuccessorAsync(session, now, ct);
    if (recovered is not null)
    {
        return Success(recovered);                  // opt-in: the response was lost, rotate the unused successor
    }

    if (superseded)
    {
        return Failure(RefreshSupersededError());   // a sibling recovered that successor a moment ago
    }

    await RevokeFamilyOnReuseAsync(userId, now, ct); // BR-206: revoke every live session, save, log a Warning
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
var successor = session.CreateSuccessor(refreshToken, now, now.Add(RefreshTokenLifetime), ipAddress, userAgent);
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

    await RevokeFamilyOnReuseAsync(userId, now, ct);
    return Failure(InvalidRefreshTokenError());     // past the grace, or unreadable: the replay answer
}
```

## Both apps inherit it; the OAuth path opens the same session

The rotation, reuse detection, session cap, and lifetime logic are identical in ADC and Store because
neither one owns a copy. ADC's `AuthenticationService` (`AuthenticationService.cs:52`) and Store's
(`AuthenticationService.cs:26`) each take an `IAuthSessionIssuer` (ADC `:58`, Store `:31`) and forward it into
the base constructor (ADC `:67`, Store `:38`); the token lifetimes and the cap are configuration (the `Jwt`
and `RefreshSessions` sections), not constructor arguments (ADC `:47-49`). What the subclasses supply is
app-specific hooks: the claim set (ADC's `speaker_id`, Store's `customer_id`), the deactivated-account
gates, the registration side effect. They mint through the base's `TokenService` property, which is the
issuer's `sid`-stamping wrapper (`AuthenticationServiceBase.cs:120`). The security-relevant token workflow is
not in either subclass.

That single-source property is what makes ADC's external OAuth login (ADR-036) fall in line for free. The
external-login body (`ExternalLoginCoreAsync`, ADC `AuthenticationService.cs:295`) ends by calling the shared
`IssueTokensAsync` (`:403`), which runs the second-factor challenge an external sign-in owes
(`AuthenticationServiceBase.cs:701-713`) and then reaches the same `IAuthSessionIssuer.IssueAsync` call a
password sign-in reaches (`:715`, `:740`). A federated sign-in therefore opens a refresh session hashed at
rest, counted against the same per-user cap, rotated through the same chain. A user who signed in with
Google gets the same guarantees as one who typed a password, because both go through the same issuer.

## Trade-offs, honestly

This model is a deliberate set of choices, and ADR-097 names the edges rather than hiding them.

- **Every device is its own row, so sign-ins grow a table.** A session is a device fact rather than an
  account fact, which is the point: signing in on a second device leaves the first signed in
  (`AuthSessionIssuer.cs:19-20`). The cost is unbounded growth without two guards, and both are there: a
  per-user cap that evicts the oldest live session (`:705,714-717`) and a retention sweep that hard-deletes
  dead rows after `RetentionDays` (`RefreshSessionSettings.cs:54-58`). A revoked row survives that window
  because it is the evidence the reuse check reads; once it is swept, the same replay reads as an unknown
  token and fails alone. The thirty-day default sits well past the seven-day token lifetime, so a token still
  capable of being replayed always has its row, and lowering the window below that lifetime gives the
  guarantee up (`:60-66`).
- **Reuse detection is aggressive, past a short grace.** Two browser tabs refreshing at nearly the same
  instant present the same token. Inside `ReuseGraceSeconds` (default 10, `RefreshSessionSettings.cs:98-99`)
  the second request is answered 409 and retries, whether it lands on the rotated row or loses the
  `TryRotateAsync` claim (`AuthSessionIssuer.cs:429-434`, `:554-557`). The grace cuts both ways: a stolen token
  replayed within that window of a legitimate rotation gets the same 409 instead of revoking the family,
  because the two cannot be told apart there (`RefreshSessionSettings.cs:89-96`). Past the window a benign
  race is again indistinguishable from theft and still revokes the family (`AuthSessionIssuer.cs:454`,
  `:559-562`), while a row already flagged as reuse fails that request alone, without revoking the family
  again, however recent (`RefreshSessionSettings.cs:93-94`). A grace of `0` fails closed on every rotated
  token that comes back.
- **Lost-response recovery trades a refresh of delay for fewer false sign-outs.** It is off by default. With
  `LostResponseRecoveryMinutes` set, a thief replaying a stolen token while the legitimate client is idle
  inside the window is handed a session; the legitimate client's next refresh then presents a successor that
  was rotated away, which is reuse, and the whole family (thief included) is revoked. Detection is delayed by
  one refresh, never lost, and a successor that was already used is never recovered
  (`RefreshSessionSettings.cs:114-120`).
- **Only a rotated token is evidence.** A token from a device that was signed out, cap-evicted, or already
  swept by an earlier reuse event fails alone
  (`:420-427`, and `:546-552` when it loses the rotation claim), so an ordinary sign-out never ends the user's
  other sessions. The flip side is that a thief replaying a token whose device was already signed out triggers
  nothing beyond that one rejection; the family-wide response is reserved for the case that proves two parties
  held the same lineage.
- **The refresh path is server-side write state.** Unlike the fully stateless access token, every issue
  inserts a row and every refresh revokes one and inserts its successor (`OpenSessionAsync` `:469-494`,
  `RotateSessionAsync` `:510-568`), so refresh always costs a write to the Identity database. That is the
  price of being able to revoke.
- **No absolute cap anchored to the opening login.** Because the expiry is re-stamped on every rotation
  (`:524`), the seven-day window bounds inactivity, not total session age, and a continuously active client
  stays signed in indefinitely. The per-user cap bounds how many devices, and the retention sweep bounds how
  long a dead row lingers, but neither ends a chain that keeps refreshing. An absolute cap on session age is
  deliberately not imposed.
- **A lifetime fallback survives below configuration.** A zero or negative configured lifetime never gets
  that far: both `Jwt` lifetimes carry `[Range(1, int.MaxValue)]` (`JwtSettings.cs:65,72`) and validate at
  startup (`WebApplicationBuilderExtensions.Authentication.cs:136-139`), so the host refuses to boot. What
  remains sits behind `ITokenService`: a token service other than the framework's (a test double, a custom
  implementation) that leaves `RefreshTokenLifetime` alone lands on seven days through the interface default
  (`ITokenService.cs:67`, `AccessTokenLifetime` fifteen minutes at `:60`), and one that reports a
  non-positive value is quietly treated as seven days by the issuer (`AuthSessionIssuer.cs:82-83`) instead
  of surfacing an error. Its fifteen-minute access-side fallback (`:79-80`) reaches only the expiry the
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
answer is a retryable 409, and an opt-in, default-off lost-response recovery rotates a never-presented
successor instead) while a signed-out, cap-evicted, reuse-swept or expired one fails alone, and the honest
trade-offs (a growing table, aggressive reuse detection softened by a grace a thief can also use, recovery
that delays detection by one refresh, a server-side write per refresh, no absolute session-age cap, a
lifetime fallback only a custom token service reaches) that come with
choosing to fail closed past the grace.

**Next in the series:** the write-once REST surface every entity inherits: generic entity controllers that
give a new aggregate its full CRUD API without a hand-written controller per type.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-097 behind this
pattern, or `dotnet add package MMCA.Common.Application` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-097 (multi-device refresh sessions): `Website/docs-src/adr/097-multi-device-refresh-sessions.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Authentication, Security*

*Notes (evidence refresh, re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`;
consumer pins not re-read this run): every named type, anchor and number re-read from source this run.
Changes this run (2026-11-25): (1) lost-response recovery added to the body, the code block, a new trade-off
bullet and "What we covered": `FindRecoverableSuccessorAsync` is called between the grace check and the
family revoke (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:436-452`,
body :619-643, Warning log :645-651), gated by `RefreshSessions:LostResponseRecoveryMinutes` [Range(0,1440)],
default 0 = off (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:122-123`,
doc :101-121, trade-off :114-120); ADR-097 revision 2026-11-02, 1.273.0
(`Website/docs-src/adr/097-multi-device-refresh-sessions.md:39-40`). (2) The family revoke is
`RevokeFamilyOnReuseAsync` (:666-673, Warning without IP or user agent :653-658), called on the lookup path
(:454) and the lost-claim path (:562); code block updated. (3) The successor is minted by
`RefreshSession.CreateSuccessor` (`AuthSessionIssuer.cs:520-526`; `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:233`),
which carries `SignInId` (:115; ADR-097 amendment 2026-11-07, :41-44); code block updated. (4) Refresh carries
`auth_time` across rotation as well as `mfa`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:445-450` mfa, :452-455
auth_time; wrapper stamps them at `AuthSessionIssuer.cs:779-790`); the previously unverified carry-over
claim is settled. (5) Login and registration route through the private `IssueTokensCoreAsync`
(`AuthenticationServiceBase.cs:728`, `IssueAsync` call :740); the protected `IssueTokensAsync` (:694) adds a
second-factor challenge for non-service accounts (:701-713) and is what ADC's external login calls, so the
OAuth paragraph says "the same IssueAsync call" rather than "exactly the path". (6) `IAuthUser` also exposes
`IsServiceAccount` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IAuthUser.cs:32`, doc :10-12,
`PasswordHash` :19, `PasswordSalt` :22). (7) Every anchor below re-anchored in place. Standing inventory:
`AuthSessionIssuer` (sealed partial, :54, 802 lines; class doc device :19-20, recovery :29-31, cap :31-32)
behind `IAuthSessionIssuer` (`Auth/Sessions/IAuthSessionIssuer.cs:27`; `TokenService` :35, `IssueAsync` :47,
`RotateAsync` :71, `SignOutAsync` :117, `SignOutEverywhereAsync` :123), registered `TryAddScoped` at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:182`. Issuer anchors: fallbacks
:79-80 (15 min) and :82-83 (7 days); `IssueAsync` :86 (open :99, save :105, response :112-115); `RotateAsync`
:124 (resolve :135, rotate :143, new `sid` :150-156); `SignOutAsync` :193 (single device :207-214, degrade
:217); `SignOutEverywhereAsync` :222; `ListActiveAsync` :236; `RevokeSessionAsync` :293 (NotFound :298-306,
already revoked `Auth.SessionAlreadyRevoked` :308-315); `InvalidRefreshTokenError` :365-369,
`RefreshSupersededError` :376-380; `ResolveRotatableSessionAsync` :398 (blank :404-407, lookup :409-411,
unknown or wrong user :413-416, revoked :418, fail alone :420-427, grace 409 :429-434, recovery :436-445,
recovered-successor 409 :447-452, family revoke :454-456, expired :459-461); `OpenSessionAsync` :469 (generate
:476, expiry :481, cap :490, staged insert :491); `RotateSessionAsync` :510 (successor :520-526, expiry :524,
`TryRotateAsync` :533-535, untracked re-read :543-545, fail alone :546-552, 409 :554-557, family revoke
:559-562); `IsReuseSignal` :579-589 (doc :570-577, conservative return :586-588); `IsWithinRotationGrace`
:599-607 (doc :591-598, clock note :596-597, predicate :603-606); `RevokeLiveSessionsAsync` :677;
`EnforceSessionCapAsync` :705 (cap read :707, loop :714-717); `SessionStampingTokenService` :737 (`sid`
:772-777, `mfa` :779-782, `auth_time` :784-790). Base: class :74, class doc :50-53, `TokenService` property
:120, `LoginAsync` :164 (issue :281), `RegisterAsync` :301 (issue :397), `RefreshTokenAsync` :401
(`GetPrincipalFromExpiredToken` :415, null principal :416-420, `GetUserId` :425, user load :432,
`ValidateRefreshCandidateAsync` call :439 and virtual :913, `RotateAsync` call :460), `RevokeTokenAsync` :476
(`SignOutAsync` :487), `RevokeAllSessionsAsync` :493, `GetSessionsAsync` :510, `RevokeSessionByIdAsync` :538.
Store claim: `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:304`
(`ExecuteInTransactionAsync` :317, predicate `RevokedAt == null` :321,
`RevokedAt`/`ReasonRotated`/`ReplacedByTokenHash` :324-326). Session record: `RefreshSession.cs:46`,
`TokenHashLength` 64 :49, reasons `ReasonRotated` :67, `ReasonSignedOut` :70, `ReasonReuseDetected` :73,
`ReasonSessionCap` = "SessionCapExceeded" :76, `ReasonAccountDeleted` :79, fields `Id` :82, `UserId` :85,
`TokenHash` :88, `CreatedAt` :91, `ExpiresAt` :94, `RevokedAt` :97, `ReplacedByTokenHash` :103, `ReasonRevoked`
:106, `SignInId` :115, `IsRevoked` :165, `IsActiveAt` :169, `Create` :184, `CreateSuccessor` :233, `HashToken`
(SHA-256 over UTF-8, `Convert.ToHexString`, upper-case hex) :301-304, `Revoke` :315; `AccountDeleted` written
at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionRevocation.cs:86` (doc :59).
Settings: `MaxActiveSessionsPerUser` [Range(1,1000)] = 10 :34-35, `RetentionDays` = 30 :71-72 (hard-delete
doc :54-58, reuse-bound doc :60-66), `ReuseGraceSeconds` [Range(0,300)] = 10 :98-99 (doc :82-97, trade-off
:89-96, flagged row fails alone :93-94), `LostResponseRecoveryMinutes` :122-123; options bound at
`DependencyInjection.cs:169-172`; `RefreshSessionCleanupService` added only when `RefreshSessions:Enabled`
:209-212. Tokens: `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs`
`GenerateAccessToken` :108 (lifetime :114), `sub` :146, `expires` :178, `GenerateRefreshToken` :185 (64 bytes
:187, base64 :188), `RefreshTokenLifetime` :195, `GetPrincipalFromExpiredToken` :204 (issuer :208, audience
:209, key :210, lifetime off :212, `ValidAlgorithms` :218, header alg re-check :228); `JwtSettings.cs` 15 min
:66, 7 days :73, [Range(1, int.MaxValue)] :65 and :72; `JwtSettings` bound with
`ValidateDataAnnotations().ValidateOnStart()` at
`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:136-139`;
`MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs` `GenerateRefreshToken` :53,
defaults `AccessTokenLifetime` 15 min :60 and `RefreshTokenLifetime` 7 days :67. Subclasses: ADC
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:52`
(`IAuthSessionIssuer` :58, base :67, configuration doc :47-49, `ExternalLoginAsync` :283,
`ExternalLoginCoreAsync` :295, `IssueTokensAsync` :403); Store
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:26`
(`IAuthSessionIssuer` :31, base :38, `customer_id` builder doc :186). Governing record: ADR-097, Accepted
2026-08-26, revised through 2026-11-23 (:8-48), supersedes ADR-050's storage model (:4); reason paragraph
"`AccountDeleted` included" (:147), lost-response recovery (:176, :771), trade-off "still revokes a family on
a benign race that outlasts the grace" (:507). Numbers: 15 min, 7 days, 64 bytes, 64-char hash, cap 10, range
1-1000, retention 30 days, reuse grace 10 seconds, range 0-300, lost-response recovery default 0 minutes,
range 0-1440, outcomes five plus the opt-in recovery branch (four share `Auth.InvalidRefreshToken`, the race
answers 409 `Auth.RefreshSuperseded`), lifetime range 1 to int.MaxValue on both `Jwt` lifetimes, revocation
reasons five, reasons excluded from the reuse signal three. The code block is illustrative of the shape,
condensed from `ResolveRotatableSessionAsync` (:404-461), `IsReuseSignal` (:579-589),
`IsWithinRotationGrace` (:599-607) and `RotateSessionAsync` (:520-564); it is not byte-for-byte. Prior
passes: 2026-10-29 (`ReasonReuseDetected` excluded from the reuse signal, ADR-097 2026-10-25 revision);
2026-10-22 at v1.250.0 (lifetime range checks, `AccountDeleted`); 2026-10-08 at v1.233.0 (reuse grace window
adopted into the body); 2026-10-02 at v1.221.0 (session logic moved into `AuthSessionIssuer`, `IsReuseSignal`
split). Prose verified free of em dashes and the banned boundary-noun.*

- Full series index: https://ivanball.github.io/writing.html
