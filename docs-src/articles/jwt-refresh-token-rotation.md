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
(`AuthenticationServiceBase.cs:63`) decides who is signed in: credentials, lockout, the app's gates.
`IAuthSessionIssuer` (`IAuthSessionIssuer.cs:26`) decides what they are handed: the multi-device refresh
sessions, rotation, reuse detection, the per-user cap and the session claims on the access token, "so this
workflow never touches a session row" (`AuthenticationServiceBase.cs:40-43`). The framework's implementation
is the sealed `AuthSessionIssuer` (`AuthSessionIssuer.cs:39`), registered scoped by `AddInfrastructure`
(`MMCA.Common.Infrastructure/DependencyInjection.cs:176`). Both apps' Identity modules subclass the base,
hand it the issuer, and change nothing about the token logic. Here is the model, piece by piece.

**The access token is stateless; the refresh side is one row per signed-in device.** The access token is a
signed JWT whose `exp` comes from `JwtSettings.AccessTokenExpirationMinutes` (default 15 minutes,
`JwtSettings.cs:61`), written by `TokenService.GenerateAccessToken` (`TokenService.cs:101`, expiry stamped at
`:148`). The refresh side is `RefreshSession`, a sealed framework record with one row per signed-in device
(`RefreshSession.cs:39`): the user id, a token hash, an issue instant, an expiry, and revocation
bookkeeping (`:69,72,75,78,81,87,90`). Refresh tokens are deliberately absent from the credential contract
the user aggregate exposes to the workflow: `IAuthUser` carries password material only
(`IAuthUser.cs:9-14,20,23`). A user holds as many live sessions as they have signed-in devices, bounded by a
per-user cap (`AuthSessionIssuer.cs:17-26`). Every access token the issuer mints names the session behind it
in a `sid` claim, stamped by a pass-through token service that wraps the real one
(`SessionStampingTokenService`, `AuthSessionIssuer.cs:474`, claim added at `:506-511`), so the app's claim
code never has to know the claim exists.

**The stored value is a digest, not the token.** `TokenService.GenerateRefreshToken` draws 64 bytes from
`RandomNumberGenerator.GetBytes` and base64-encodes them (`TokenService.cs:155,157,158`). That plaintext
lives only in the response that hands it to the client. What the store keeps is `RefreshSession.TokenHash`,
an unsalted hex SHA-256 digest of the token's UTF-8 bytes (`RefreshSession.cs:72,173-177`), exactly 64
characters wide (`:41-42`). The digest is deterministic on purpose, because lookup is by hash: a presented
token finds its row through `FindByTokenHashAsync(RefreshSession.HashToken(token))`
(`AuthSessionIssuer.cs:286-288`). A database read therefore yields digests, and a digest is not something
you can present.

**Issuing opens a session; refreshing rotates one.** Login (`AuthenticationServiceBase.cs:105`, issuing at
`:194`) and registration (`:203`, issuing at `:279`) both route through `IssueTokensAsync` (`:417`), which
hands the user to `IAuthSessionIssuer.IssueAsync` (`:425`). The issuer opens a fresh session
(`AuthSessionIssuer.cs:75`, body `OpenSessionAsync` at `:322`) before the access token is minted, because
the token carries the session's id, then saves it (`:81`) and returns the token pair (`:83-86`). Refresh runs
its own path. `RefreshTokenAsync` (`AuthenticationServiceBase.cs:283`) calls `RotateAsync`
(`:337`; `AuthSessionIssuer.cs:90`), which resolves the presented token to its session
(`ResolveRotatableSessionAsync`, called at `:101`, body `:275`) and then rotates it (`RotateSessionAsync`,
called at `:109`, body `:361`). Rotation mints a successor session (`:369-376`) and claims the presented row
through `IRefreshSessionStore.TryRotateAsync` (`:384-386`), which revokes it with reason `Rotated` and links
it to that successor via `ReplacedByTokenHash` (`EFRefreshSessionStore.cs:125-130`; `RefreshSession.cs:54,87`).
The successor is a new row with a new id, so the access token handed back carries a new `sid` too
(`AuthSessionIssuer.cs:116-122`). The consequence is the important part: the instant a successor is issued,
the token that bought it is spent, and the rotated row it leaves behind is precisely what makes a replay
visible. There is no grace period.

**Refresh binds to the same principal through the expired access token.** `RefreshTokenAsync` requires the
client to present the just-expired access token alongside the refresh token, and runs it through
`TokenService.GetPrincipalFromExpiredToken` (`AuthenticationServiceBase.cs:297`). That method validates
issuer, audience, signing key, and the pinned algorithm, and skips only the lifetime check
(`TokenService.cs:174,178,179,180,182,187`, with the algorithm re-checked against the header at `:196-197`).
An unsigned, wrong-audience, or algorithm-swapped token yields no principal and the refresh fails
(`AuthenticationServiceBase.cs:298-302`). The user id rides the standard `sub` claim
(`TokenService.cs:110-116`), read at `AuthenticationServiceBase.cs:307` and used to load the account at
`:314`. A second factor the user already verified rides across the rotation too: the `mfa` claim is read off
the signature-validated presented token and stamped on the successor (`:327-332`).

**One error, four different consequences.** `ResolveRotatableSessionAsync` (`AuthSessionIssuer.cs:275`) is
the reuse-detection step, and it separates cases the caller cannot tell apart. A blank token, an unknown
hash, or one belonging to another account says nothing about a live session and fails alone (`:281-284`,
`:290-293`): revoking the family on it would let anyone holding one of this user's expired access tokens sign
them out everywhere by posting a random string. A **revoked** row splits by why it died (`IsReuseSignal`,
`:409-417`). A row that was rotated away (it carries a successor hash) or already flagged as reuse has come
back, which is the BR-206 reuse signal, so every live session the user holds is revoked with reason
`ReuseDetected` (`:305-309`, `RefreshSession.cs:60`). A row that was signed out or evicted by the session cap
only lost its session, which is not a theft signal, so that request fails alone and the user's other devices
keep working (`:297-303`). Any other or missing reason counts as reuse, the conservative answer for a row the
code does not recognize (`:403-407,416`). An **expired** row is an ordinary end of life, so that device
re-authenticates and the rest are untouched (`:312-314`). Every branch answers with the same
`Auth.InvalidRefreshToken` error (`:257-261`), so the distinction lives in what happens behind it, not in
what the caller learns.

**A simultaneous replay gets the replay answer.** Two requests presenting the same still-live token both
read an un-revoked row, so the store arbitrates rather than memory: `TryRotateAsync` is a conditional
update on `RevokedAt IS NULL` (`EFRefreshSessionStore.cs:125`), and the request that loses the claim is
treated exactly as a replay, whole live family revoked (`AuthSessionIssuer.cs:388-398`). A caller cannot
distinguish the two situations, and neither does the workflow.

**The expiry slides on every rotation.** Every session is stamped with its issue instant plus
`RefreshTokenLifetime`, both when one is opened (`AuthSessionIssuer.cs:334`) and when a successor is minted
(`:374`). That property reads `TokenService.RefreshTokenLifetime` (`TokenService.cs:165`), derived from
`JwtSettings.RefreshTokenExpirationDays` (`JwtSettings.cs:64`, default 7 days). A device that refreshes at
least once inside each window stays signed in indefinitely; re-authentication is required only after a full
lifetime passes with no successful refresh, or after a revocation. If the configured value is non-positive,
the issuer falls back to the seven-day BR-205 default (and to fifteen minutes for the access token) rather
than failing startup (`AuthSessionIssuer.cs:55-59`; interface default `ITokenService.cs:40`).

**A per-user cap bounds the family.** `RefreshSessionSettings.MaxActiveSessionsPerUser` binds
`RefreshSessions:MaxActiveSessionsPerUser`, default 10, range 1-1000 (`RefreshSessionSettings.cs:34-35`),
validated at startup (`MMCA.Common.Infrastructure/DependencyInjection.cs:168-171`). Opening one session past
the cap revokes the user's oldest live session with reason `SessionCapExceeded` rather than refusing the
sign-in (`EnforceSessionCapAsync` at `AuthSessionIssuer.cs:442`, eviction loop `:451-454`, constant
`ReasonSessionCap` at `RefreshSession.cs:63`). Expired-but-unrevoked rows authenticate nobody and do not
count against the cap; they age out with the framework's retention sweep, `RefreshSessionCleanupService`
over the `RefreshSessions:RetentionDays` window (default 30, `RefreshSessionSettings.cs:71-72`), which the
host runs once `RefreshSessions:Enabled` is set (`DependencyInjection.cs:181-184`).

**Explicit revocation names one device or takes them all.** `RevokeTokenAsync`
(`AuthenticationServiceBase.cs:352`) hands an optional refresh token to `SignOutAsync`
(`AuthSessionIssuer.cs:148`). A live session belonging to that user is revoked alone with reason
`SignedOut`, which is the sign-out-this-device path (`:162-169`). Anything else (an unknown token, another
account's token, an already-revoked row) leaves the caller unidentifiable, so the request degrades to
revoking every live session the user holds rather than reporting success for a revocation that reached
nothing (`:172`). Beside it sit a deliberate sign-out-everywhere (`RevokeAllSessionsAsync`,
`AuthenticationServiceBase.cs:369`, into `SignOutEverywhereAsync`, `AuthSessionIssuer.cs:177`), a device list
(`GetSessionsAsync` `:386`, `ListActiveAsync` `:191`), and a revoke-by-session-id (`RevokeSessionByIdAsync`
`:402`, `RevokeSessionAsync` `:227`) whose ownership check is the store query itself, so another account's
session id and one that never existed both answer `NotFound` (`:232-240`).

```csharp
// AuthSessionIssuer.ResolveRotatableSessionAsync: one error, four consequences (shape, not byte-for-byte).
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
        return Failure(InvalidRefreshTokenError()); // signed out or cap-evicted: this device alone
    }

    await RevokeLiveSessionsAsync(userId, RefreshSession.ReasonReuseDetected, now, ct);
    await refreshSessions.SaveChangesAsync(ct);     // BR-206: a rotated-away token came back
    return Failure(InvalidRefreshTokenError());
}

return session.ExpiresAt <= now                     // an ordinary end of life: this device alone
    ? Failure(InvalidRefreshTokenError())
    : Success(session);

// IsReuseSignal: rotated (a successor hash), or any reason other than SignedOut / SessionCapExceeded.
static bool IsReuseSignal(RefreshSession s) =>
    s.ReplacedByTokenHash is not null
    || s.ReasonRevoked is not (RefreshSession.ReasonSignedOut or RefreshSession.ReasonSessionCap);

// RotateSessionAsync: the store, not memory, decides which request owns the rotation.
var refreshToken = tokenService.GenerateRefreshToken();
var successor = RefreshSession.Create(userId, refreshToken, now, now.Add(RefreshTokenLifetime), ipAddress, userAgent);
if (!await refreshSessions.TryRotateAsync(session, successor.Value!, now, ct))
{
    await RevokeLiveSessionsAsync(userId, RefreshSession.ReasonReuseDetected, now, ct);
    await refreshSessions.SaveChangesAsync(ct);
    return Failure(InvalidRefreshTokenError());     // lost the claim: answered exactly like a replay
}
```

## Both apps inherit it; the OAuth path opens the same session

The rotation, reuse detection, session cap, and lifetime logic are identical in ADC and Store because
neither one owns a copy. ADC's `AuthenticationService` (`AuthenticationService.cs:50`) and Store's
(`AuthenticationService.cs:26`) each take an `IAuthSessionIssuer` (ADC `:56`, Store `:31`) and forward it into
the base constructor (ADC `:58`, Store `:33`); the token lifetimes and the cap are configuration (the `Jwt`
and `RefreshSessions` sections), not constructor arguments (ADC `:44-47`). What the subclasses supply is
app-specific hooks: the claim set (ADC's `speaker_id`, Store's `customer_id`), the deactivated-account
gates, the registration side effect. They mint through the base's `TokenService` property, which is the
issuer's `sid`-stamping wrapper (`AuthenticationServiceBase.cs:98`). The security-relevant token workflow is
not in either subclass.

That single-source property is what makes ADC's external OAuth login (ADR-036) fall in line for free. The
external-login body (`ExternalLoginCoreAsync`, ADC `AuthenticationService.cs:204`) ends by calling the shared
`IssueTokensAsync` (`:316`), so a federated sign-in opens a refresh session through exactly the path a
password sign-in takes: hashed at rest, counted against the same per-user cap, rotated through the same
chain. A user who signed in with Google gets the same guarantees as one who typed a password, because both
go through the same issuer.

## Trade-offs, honestly

This model is a deliberate set of choices, and ADR-097 names the edges rather than hiding them.

- **Every device is its own row, so sign-ins grow a table.** A session is a device fact rather than an
  account fact, which is the point: signing in on a second device leaves the first signed in
  (`AuthSessionIssuer.cs:17-18`). The cost is unbounded growth without two guards, and both are there: a
  per-user cap that evicts the oldest live session (`:442,451-454`) and a retention sweep that hard-deletes
  dead rows after `RetentionDays` (`RefreshSessionSettings.cs:54-58`). A revoked row survives that window
  because it is the evidence the reuse check reads; once it is swept, the same replay reads as an unknown
  token and fails alone. The thirty-day default sits well past the seven-day token lifetime, so a token still
  capable of being replayed always has its row, and lowering the window below that lifetime gives the
  guarantee up (`:60-66`).
- **Reuse detection is aggressive by design.** Two browser tabs refreshing at the same instant present the
  same still-live token, one of them loses the `TryRotateAsync` claim, and the loser is answered as a replay
  with the family revoked (`AuthSessionIssuer.cs:388-398`). A benign race is indistinguishable from theft, so
  failing closed is chosen over a convenient short reuse-grace window.
- **Only a rotated token is evidence.** A token from a device that was signed out or cap-evicted fails alone
  (`:297-303`), so an ordinary sign-out never ends the user's other sessions. The flip side is that a thief
  replaying a token whose device was already signed out triggers nothing beyond that one rejection; the
  family-wide response is reserved for the case that proves two parties held the same lineage.
- **The refresh path is server-side write state.** Unlike the fully stateless access token, every issue
  inserts a row and every refresh revokes one and inserts its successor (`OpenSessionAsync` `:322-348`,
  `RotateSessionAsync` `:361-401`), so refresh always costs a write to the Identity database. That is the
  price of being able to revoke.
- **No absolute cap anchored to the opening login.** Because the expiry is re-stamped on every rotation
  (`:374`), the seven-day window bounds inactivity, not total session age, and a continuously active client
  stays signed in indefinitely. The per-user cap bounds how many devices, and the retention sweep bounds how
  long a dead row lingers, but neither ends a chain that keeps refreshing. An absolute cap on session age is
  deliberately not imposed.
- **A non-positive configured lifetime falls back silently.** A zero or negative `RefreshTokenExpirationDays`
  (or a test double reporting `TimeSpan.Zero` via the interface default, `ITokenService.cs:40`) is treated as
  absent and reverts to the seven-day baseline rather than failing startup
  (`AuthSessionIssuer.cs:58-59`). A misconfiguration quietly reverts to the default instead of surfacing an
  error.

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
5. **Split your rejections behind one error message.** An unknown token fails alone, an expired session fails
   alone, a signed-out session fails alone, and a rotated-away session that comes back revokes the user's
   whole live family. Record why each row was revoked so the detector can tell those apart, and return one
   indistinguishable error for all of them so the detector does not double as an oracle.

The takeaway: **a refresh token you rotate on every use, store only as a hash, and answer with a family-wide
revoke the instant a rotated-away one reappears, turns a long-lived stealable secret into a session that ends
itself.** The stateless access token stays fast; the write on refresh is what buys you the ability to revoke
one device or all of them.

---

**What we covered:** why a stateless access token forces a refresh token and a refresh token forces a theft
story, how MMCA.Common splits who-is-signed-in from what-they-are-handed and keeps one hashed
`RefreshSession` row per signed-in device, rotated through a store-arbitrated claim, how a rotated-away row
is the reuse signal that revokes a user's whole live family while a signed-out, cap-evicted or expired one
fails alone, and the honest trade-offs (a growing table, aggressive reuse detection, a server-side write per
refresh, no absolute session-age cap, a silent lifetime fallback) that come with choosing to fail closed.

**Next in the series:** the write-once REST surface every entity inherits: generic entity controllers that
give a new aggregate its full CRUD API without a hand-written controller per type.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-097 behind this
pattern, or `dotnet add package MMCA.Common.Application` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-097 (multi-device refresh sessions): `Website/docs-src/adr/097-multi-device-refresh-sessions.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Authentication, Security*

*Notes (evidence refresh, 2026-10-02, MMCA.Common v1.221.0): every named type, anchor and number re-read from
source this run. Change recorded here, not in the body: the session issue, rotate, reuse, cap and sign-out
logic the 2026-09-19 pass anchored in `AuthenticationServiceBase.cs` (anchors up to :884) lives in the
sealed `AuthSessionIssuer` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:39`,
528 lines) behind `IAuthSessionIssuer` (`Auth/Sessions/IAuthSessionIssuer.cs:26`; `TokenService` :34,
`IssueAsync` :46, `RotateAsync` :67, `SignOutAsync` :94, `SignOutEverywhereAsync` :100), registered
`TryAddScoped` at `MMCA.Common.Infrastructure/DependencyInjection.cs:176`; the base (`AuthenticationServiceBase.cs:63`,
609 lines) delegates, class doc :40-43. A revoked row no longer always revokes the family: `IsReuseSignal`
(`AuthSessionIssuer.cs:409-417`, doc :403-407) splits it, and the body, code block, trade-offs, apply item 5,
takeaway and "What we covered" were reworked for the four outcomes. Header Status repointed to
`AuthSessionIssuer.cs` and `RefreshSessionSettings.cs`; title, subtitle, ADR/group/rubric cells unchanged.
Governing record: ADR-097, Accepted 2026-08-26, revised 2026-08-27, 2026-09-01, 2026-09-07
(`Website/docs-src/adr/097-multi-device-refresh-sessions.md:3-19`); ADR-050 superseded by it
(`050-jwt-refresh-token-rotation.md:4`). Honest gap: ADR-097's own body still cites base-class anchors and
predates the `IsReuseSignal` split, so this article is grounded on source, not on the ADR's anchors.
Base anchors: `LoginAsync` :105 (issue :194), `RegisterAsync` :203 (issue :279), `RefreshTokenAsync` :283
(`GetPrincipalFromExpiredToken` :297, null principal :298-302, `GetUserId` :307, user load :314, `mfa`
carry :327-332, `RotateAsync` call :337), `RevokeTokenAsync` :352 (`SignOutAsync` :363),
`RevokeAllSessionsAsync` :369, `GetSessionsAsync` :386, `RevokeSessionByIdAsync` :402, `IssueTokensAsync`
:417 (`IssueAsync` :425), `TokenService` property :98. Issuer anchors: lifetime fallbacks :55-56 (15 min)
and :58-59 (7 days); `IssueAsync` :62 (open :75, save :81, response :83-86); `RotateAsync` :90 (resolve
:101, rotate :109, new `sid` :116-122); `SignOutAsync` :148 (single device :162-169, degrade :172);
`SignOutEverywhereAsync` :177; `ListActiveAsync` :191; `RevokeSessionAsync` :227 (NotFound :232-240,
already-revoked success :242-245); `InvalidRefreshTokenError` :257-261; `ResolveRotatableSessionAsync` :275
(blank :281-284, lookup :286-288, unknown or wrong user :290-293, revoked :295, non-reuse fail-alone
:297-303, family revoke :305-309, expired :312-314); `OpenSessionAsync` :322 (generate :329, expiry :334,
cap :344, staged insert :345); `RotateSessionAsync` :361 (successor :369-376, expiry :374, `TryRotateAsync`
:384-386, lost claim :388-398); `RevokeLiveSessionsAsync` :420; `EnforceSessionCapAsync` :442 (cap read
:444, loop :451-454); `SessionStampingTokenService` :474 (`sid` :506-511, `mfa` :513-516). Store claim:
`MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:108` (conditional update :125,
`RevokedAt`/`ReasonRotated`/`ReplacedByTokenHash` :128-130). Session record:
`MMCA.Common.Domain/Auth/RefreshSession.cs:39` (`IAnonymizable`, `[Pii]` `IpAddress` :98, `UserAgent` :105),
`TokenHashLength` 64 :41-42, reasons `ReasonRotated` :54, `ReasonSignedOut` :57, `ReasonReuseDetected` :60,
`ReasonSessionCap` = "SessionCapExceeded" :63, fields `UserId` :69, `TokenHash` :72, `CreatedAt` :75,
`ExpiresAt` :78, `RevokedAt` :81, `ReplacedByTokenHash` :87, `ReasonRevoked` :90, `IsActiveAt` :112,
`Create` :125, `HashToken` (SHA-256 over UTF-8, upper-case hex) :173-177, `Revoke` :187-202. Source-comment
drift noticed, not acted on (source is out of scope): `RefreshSession.cs:26-28` says rows are never deleted
except to be revoked, while `RefreshSessionSettings.cs:54-58` documents the sweep's hard delete. Settings:
`MMCA.Common.Application/Auth/RefreshSessionSettings.cs` `MaxActiveSessionsPerUser` [Range(1,1000)] = 10
:34-35, `RetentionDays` = 30 :71-72 (reuse-bound doc :60-66); options bound and `ValidateOnStart` at
`DependencyInjection.cs:168-171`; `RefreshSessionCleanupService` registered only when `RefreshSessions:Enabled`
:181-184. Tokens: `MMCA.Common.Infrastructure/Auth/TokenService.cs` `GenerateAccessToken` :101, `sub` only
:110-116, `exp` :148, `GenerateRefreshToken` :155 (64 bytes :157, base64 :158), `RefreshTokenLifetime` :165,
`GetPrincipalFromExpiredToken` :174 (issuer :178, audience :179, key :180, lifetime off :182,
`ValidAlgorithms` :187, header alg re-check :196-197); `JwtSettings.cs` 15 min :61, 7 days :64;
`ITokenService.cs` `GenerateRefreshToken` :26, interface default `RefreshTokenLifetime` :40;
`MMCA.Common.Domain/Auth/IAuthUser.cs:9-14,20,23` unchanged. Subclasses: ADC
`MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:50` (`IAuthSessionIssuer` :56, base :58,
configuration doc :44-47, `ExternalLoginAsync` :192, `ExternalLoginCoreAsync` :204, `IssueTokensAsync`
:316, `speaker_id` :384); Store `MMCA.Store.Identity.Application/Users/AuthenticationService.cs:26`
(`IAuthSessionIssuer` :31, base :33, `customer_id` :187-189). Numbers unchanged: 15 min, 7 days, 64 bytes,
64-char hash, cap 10, range 1-1000; added: retention 30 days. The code block is illustrative of the shape,
condensed from `ResolveRotatableSessionAsync` (:281-314), `IsReuseSignal` (:409-417) and
`RotateSessionAsync` (:369-398); it is not byte-for-byte. Prose verified free of em dashes and the banned
boundary-noun.*

- Full series index: https://ivanball.github.io/writing.html
