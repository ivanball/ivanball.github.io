# Refresh tokens that rotate per device, and reuse detection that makes theft self-limiting

> Series: MMCA.Common · Article #27 (deep-dive) · Pillar P2 · Group G08 · Rubric §11 · ADR-097 ·
> Status: grounded in `Website/docs-src/adr/097-multi-device-refresh-sessions.md`,
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

The whole workflow lives in one place: `AuthenticationServiceBase<TUser>`
(`AuthenticationServiceBase.cs:74`). Both apps' Identity modules subclass it and change nothing about the
token logic. Here is the model, piece by piece.

**The access token is stateless; the refresh side is one row per signed-in device.** The access token is a
signed JWT whose `exp` comes from `JwtSettings.AccessTokenExpirationMinutes` (default 15 minutes,
`JwtSettings.cs:61`), written by `TokenService.GenerateAccessToken` (`TokenService.cs:91`, expiry stamped at
`:138`). The refresh side is `RefreshSession`, a flat framework record with one row per signed-in device
(`RefreshSession.cs:31`): the user id, a token hash, an issue instant, an expiry, and revocation
bookkeeping (`:61,64,67,70,73,79,82`). Refresh tokens are deliberately absent from the credential contract
the user aggregate exposes to the workflow: `IAuthUser` carries password material only
(`IAuthUser.cs:9-14,20,23`). A user holds as many live sessions as they have signed-in devices, bounded by a
per-user cap (`AuthenticationServiceBase.cs:41-51`).

**The stored value is a digest, not the token.** `TokenService.GenerateRefreshToken` draws 64 bytes from
`RandomNumberGenerator.GetBytes` and base64-encodes them (`TokenService.cs:145,147,148`). That plaintext
lives only in the response that hands it to the client. What the store keeps is `RefreshSession.TokenHash`,
an unsalted hex SHA-256 digest of the token's UTF-8 bytes (`RefreshSession.cs:63,160-163`), exactly 64
characters wide (`:33,34`). The digest is deterministic on purpose, because lookup is by hash: a presented
token finds its row through `FindByTokenHashAsync(RefreshSession.HashToken(token))`
(`AuthenticationServiceBase.cs:734-736`). A database read therefore yields digests, and a digest is not
something you can present.

**Issuing opens a session; refreshing rotates one.** Login (`AuthenticationServiceBase.cs:245`) and
registration (`:330`) both route through `IssueTokensAsync` (`:554`), which opens a fresh session (`:566`,
body `OpenSessionAsync` at `:762`), saves it (`:572`), and returns the token pair (`:574-577`). Refresh runs
its own path. `RefreshTokenAsync` (`:334`) resolves the presented token to its session
(`ResolveRotatableSessionAsync`, called at `:379`, body `:723`) and then rotates it (`RotateAsync`, called
at `:387`, body `:801`). Rotation mints a successor session (`:809-816`) and claims the presented row
through `IRefreshSessionStore.TryRotateAsync` (`:824-826`), which revokes it and links it to that successor
via `ReplacedByTokenHash` (`RefreshSession.cs:46,79,174-186`). The consequence is the important part: the
instant a successor is issued, the token that bought it is spent, and the revoked row it leaves behind is
precisely what makes a replay visible. There is no grace period.

**Refresh binds to the same principal through the expired access token.** `RefreshTokenAsync` requires the
client to present the just-expired access token alongside the refresh token, and runs it through
`TokenService.GetPrincipalFromExpiredToken` (`AuthenticationServiceBase.cs:348`). That method validates
issuer, audience, signing key, and the pinned algorithm, and skips only the lifetime check
(`TokenService.cs:164,168,169,170,172,177`, with the algorithm re-checked against the header at `:187`). An
unsigned, wrong-audience, or algorithm-swapped token yields no principal and the refresh fails
(`AuthenticationServiceBase.cs:349-353`). The user id rides the standard `sub` claim
(`TokenService.cs:100-106`), read at `AuthenticationServiceBase.cs:358` and used to load the account at
`:365`.

**Three rejections, deliberately different behind one error.** `ResolveRotatableSessionAsync` (`:723`) is
the reuse-detection step, and it separates three cases the caller cannot tell apart. An unknown hash, or one
belonging to another account, says nothing about a live session and fails alone (`:738-741`): revoking the
family on it would let anyone holding one of this user's expired access tokens sign them out everywhere by
posting a random string. A **revoked** row means this exact token was already rotated away or signed out and
has come back, which is the BR-206 reuse signal, so every live session the user holds is revoked with reason
`ReuseDetected` (`:743-750`, `RefreshSession.cs:52`). An **expired** row is an ordinary end of life, so that
device re-authenticates and the user's other devices keep working (`:752-754`). All three answer with the
same `Auth.InvalidRefreshToken` error (`:883,884`), so the distinction lives in what happens behind it, not
in what the caller learns.

**A simultaneous replay gets the replay answer.** Two requests presenting the same still-live token both
read an un-revoked row, so the store arbitrates rather than memory: `TryRotateAsync` decides which request
owns the rotation, and the one that loses the claim is treated exactly as a replay, whole live family
revoked (`:824-838`). A caller cannot distinguish the two situations, and neither does the workflow.

**The expiry slides on every rotation.** Every session is stamped with its issue instant plus
`RefreshTokenLifetime`, both when one is opened (`:774`) and when a successor is minted (`:814`). That
property reads `TokenService.RefreshTokenLifetime` (`TokenService.cs:155`), derived from
`JwtSettings.RefreshTokenExpirationDays` (`JwtSettings.cs:64`, default 7 days). A device that refreshes at
least once inside each window stays signed in indefinitely; re-authentication is required only after a full
lifetime passes with no successful refresh, or after a revocation. If the configured value is non-positive,
the base falls back to the seven-day BR-205 default rather than failing startup
(`AuthenticationServiceBase.cs:145,146`; interface default `ITokenService.cs:40`).

**A per-user cap bounds the family.** `MaxActiveSessionsPerUser` reads
`RefreshSessions:MaxActiveSessionsPerUser`, default 10, validated to the range 1-1000 at startup
(`:148-153`). Opening one session past the cap revokes the user's oldest live session with reason
`SessionCapExceeded` rather than refusing the sign-in (`EnforceSessionCapAsync` at `:864`, eviction loop
`:873-876`, reason constant `RefreshSession.cs:55`). Expired-but-unrevoked rows authenticate nobody and do
not count against the cap; they age out with the framework's retention sweep,
`RefreshSessionCleanupService` over the `RefreshSessions:RetentionDays` window (`:857-862`).

**Explicit revocation names one device or takes them all.** `RevokeTokenAsync` (`:416`) accepts an optional
refresh token. A live session belonging to that user is revoked alone with reason `SignedOut`, which is the
sign-out-this-device path (`:431-447`). Anything else (an unknown token, another account's token, an
already-revoked row) leaves the caller unidentifiable, so the request degrades to revoking every live
session the user holds rather than reporting success for a revocation that reached nothing (`:450`).

```csharp
// ResolveRotatableSessionAsync: three rejections, one error (shape, not byte-for-byte).
var session = await refreshSessions.FindByTokenHashAsync(RefreshSession.HashToken(refreshToken), ct);

if (session is null || !session.UserId.Equals(userId))
{
    return Failure(InvalidRefreshTokenError());   // says nothing about a live session: fail alone
}

if (session.IsRevoked)                            // this exact token was already spent, and came back
{
    await RevokeLiveSessionsAsync(userId, RefreshSession.ReasonReuseDetected, now, ct);
    await refreshSessions.SaveChangesAsync(ct);   // BR-206: the whole live family goes
    return Failure(InvalidRefreshTokenError());
}

return session.ExpiresAt <= now                   // an ordinary end of life: this device alone
    ? Failure(InvalidRefreshTokenError())
    : Success(session);

// RotateAsync: the store, not memory, decides which request owns the rotation.
var successor = RefreshSession.Create(userId, tokenService.GenerateRefreshToken(), now, now.Add(RefreshTokenLifetime));
if (!await refreshSessions.TryRotateAsync(session, successor.Value!, now, ct))
{
    await RevokeLiveSessionsAsync(userId, RefreshSession.ReasonReuseDetected, now, ct);
    return Failure(InvalidRefreshTokenError());   // lost the claim: answered exactly like a replay
}
```

## Both apps inherit it; the OAuth path opens the same session

The rotation, reuse detection, session cap, and lifetime logic are identical in ADC and Store because
neither one owns a copy. ADC's `AuthenticationService` (`AuthenticationService.cs:46`) and Store's
(`AuthenticationService.cs:22`) each take `ITokenService` and `IRefreshSessionStore` (ADC `:54`, Store
`:29`) and forward them into the base constructor (ADC `:56-64`, Store `:31-39`) along with the
refresh-session options carried on an app settings object. What the subclasses supply is app-specific hooks:
the claim set (ADC's `speaker_id`, Store's `customer_id`), the deactivated-account gates, the registration
side effect. The security-relevant token workflow is not in either subclass.

That single-source property is what makes ADC's external OAuth login (ADR-036) fall in line for free. The
external-login body (`AuthenticationService.cs:205`) ends by calling the shared `IssueTokensAsync` (`:304`),
so a federated sign-in opens a refresh session through exactly the path a password sign-in takes: hashed at
rest, counted against the same per-user cap, rotated through the same chain. A user who signed in with
Google gets the same guarantees as one who typed a password, because both go through the same base method.

## Trade-offs, honestly

This model is a deliberate set of choices, and ADR-097 names the edges rather than hiding them.

- **Every device is its own row, so sign-ins grow a table.** A session is a device fact rather than an
  account fact, which is the point: signing in on a phone leaves the laptop signed in
  (`AuthenticationServiceBase.cs:41-43`). The cost is unbounded growth without two guards, and both are
  there: a per-user cap that evicts the oldest live session (`:864,873-876`) and a retention sweep that ages
  the table out (`:857-862`). A revoked row is kept rather than deleted, because it is the evidence the
  reuse check reads.
- **Reuse detection is aggressive by design.** Two browser tabs refreshing at the same instant present the
  same still-live token, one of them loses the `TryRotateAsync` claim, and the loser is answered as a replay
  with the family revoked (`:824-838`). A benign race is indistinguishable from theft, so failing closed is
  chosen over a convenient short reuse-grace window.
- **The refresh path is server-side write state.** Unlike the fully stateless access token, every issue
  inserts a row and every refresh revokes one and inserts its successor (`:762-787`, `:801-841`), so refresh
  always costs a write to the Identity database. That is the price of being able to revoke.
- **No absolute cap anchored to the opening login.** Because the expiry is re-stamped on every rotation
  (`:814`), the seven-day window bounds inactivity, not total session age, and a continuously active client
  stays signed in indefinitely. The per-user cap bounds how many devices, and the retention sweep bounds how
  long a dead row lingers, but neither ends a chain that keeps refreshing. An absolute cap on session age is
  deliberately not imposed.
- **A non-positive configured lifetime falls back silently.** A zero or negative `RefreshTokenExpirationDays`
  (or a test double reporting `TimeSpan.Zero` via the interface default, `ITokenService.cs:40`) is treated as
  absent and reverts to the seven-day baseline rather than failing startup
  (`AuthenticationServiceBase.cs:145,146`). A misconfiguration quietly reverts to the default instead of
  surfacing an error.

None of these are reasons to skip rotation. They are the reasons to wire it knowing what it does and does not
promise.

## Apply this even without MMCA

The pattern ports to any stack with a JWT story:

1. **Keep the access token short and stateless.** Validate it by signature and expiry with no lookup, and set
   a lifetime measured in minutes so the un-revocable window stays small.
2. **Give each device its own server-side session row, and rotate it on every refresh.** One row per
   sign-in, revoked and replaced the moment it is used, with the successor's identity recorded on the row it
   replaced. The revoked row is not garbage: it is the detector.
3. **Store a digest, never the token.** Make the refresh token opaque random bytes (sixty-four is plenty),
   hand the plaintext to the client once, and keep only an unsalted hash so the lookup stays a single indexed
   read and a database dump mints nothing.
4. **Bind refresh to the presented (expired) access token, and pin the algorithm.** Read the principal from
   the expired token while skipping only the lifetime check, and re-verify issuer, audience, key, and
   algorithm so the token cannot tell you how to trust it.
5. **Split your rejections behind one error message.** An unknown token fails alone, an expired session fails
   alone, and a revoked session revokes the user's whole live family. Returning one indistinguishable error
   for all three keeps the detector from doubling as an oracle.

The takeaway: **a refresh token you rotate on every use, store only as a hash, and answer with a family-wide
revoke the instant a spent one reappears, turns a long-lived stealable secret into a session that ends
itself.** The stateless access token stays fast; the write on refresh is what buys you the ability to revoke
one device or all of them.

---

**What we covered:** why a stateless access token forces a refresh token and a refresh token forces a theft
story, how MMCA.Common keeps one hashed `RefreshSession` row per signed-in device and rotates it through a
store-arbitrated claim, how a revoked row is the reuse signal that revokes a user's whole live family while
an expired one fails alone, and the honest trade-offs (a growing table, aggressive reuse detection, a
server-side write per refresh, no absolute session-age cap, a silent lifetime fallback) that come with
choosing to fail closed.

**Next in the series:** the write-once REST surface every entity inherits: generic entity controllers that
give a new aggregate its full CRUD API without a hand-written controller per type.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-097 behind this
pattern, or `dotnet add package MMCA.Common.Application` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-097 (multi-device refresh sessions): `Website/docs-src/adr/097-multi-device-refresh-sessions.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Authentication, Security*

*Notes (evidence audit, 2026-09-19): the article's premise was re-grounded this run and every named type,
anchor and number re-read from source. Governing record: ADR-097 "Multi-Device Refresh Sessions (Hashed,
Rotating, Per Device)", Accepted 2026-08-26, revised 2026-08-27, 2026-09-01 and 2026-09-07
(`Website/docs-src/adr/097-multi-device-refresh-sessions.md:1-19`); it supersedes the storage model of
ADR-050, which is marked "Superseded by ADR-097 (2026-09-01)" and whose storage, revocation, claim and
single-session details are recorded there as not describing the code
(`Website/docs-src/adr/050-jwt-refresh-token-rotation.md:3-29`). The header blockquote, the CTA link and the
trade-offs attribution were repointed from ADR-050 to ADR-097 accordingly, and the title, the subtitle, the
"MMCA answer" heading and the "What we covered" paragraph were rewritten for the per-device model. Workflow
home: `AuthenticationServiceBase<TUser>` declared at
`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:74`, model summary in its
class doc `:41-51`. Credential contract: `MMCA.Common.Domain/Auth/IAuthUser.cs:9-14` (refresh tokens
deliberately absent), `PasswordHash` :20, `PasswordSalt` :23; `UpdateRefreshToken` and `RevokeRefreshToken`
are declared by no production type, and neither app `User` aggregate carries refresh state. Session record:
`MMCA.Common.Domain/Auth/RefreshSession.cs:31` (sealed, framework bookkeeping rather than an aggregate,
`:22-29`), `TokenHash` :63,64, `TokenHashLength` 64 :33,34, `HashToken` (SHA-256 over UTF-8 bytes,
upper-case hex) :160-163, `Create` :112, `Revoke` :174-186, `ReplacedByTokenHash` :79, reason constants
`Rotated` :46, `SignedOut` :49, `ReuseDetected` :52, `SessionCapExceeded` :55, `IsActiveAt` :99. Access
token: `TokenService.GenerateAccessToken` (`MMCA.Common.Infrastructure/Auth/TokenService.cs:91`), `sub` as
the sole user-id claim :100-106, `exp` from `_jwtSettings.AccessTokenExpirationMinutes` at :138; default 15
at `MMCA.Common.Infrastructure/Auth/JwtSettings.cs:61`. Refresh-token generation: 64 bytes from
`RandomNumberGenerator.GetBytes` + base64 at `TokenService.cs:145,147,148`
(`ITokenService.GenerateRefreshToken` declared
`MMCA.Common.Application/Interfaces/Infrastructure/Auth/ITokenService.cs:26`). Issue path: login
`AuthenticationServiceBase.cs:245` and registration :330 into `IssueTokensAsync` :554 (`OpenSessionAsync`
call :566, save :572, response :574-577); `OpenSessionAsync` body :762 (`GenerateRefreshToken` :769,
`RefreshSession.Create` :770-776, cap :784, staged insert :785). Refresh path: `RefreshTokenAsync` :334;
`GetPrincipalFromExpiredToken` call :348 and null-principal 401 :349-353; `sub` read :358; user load :365;
`ResolveRotatableSessionAsync` call :379 (body :723, hash lookup :734-736, unknown-or-wrong-user :738-741,
revoked-row family revoke :743-750, expired :752-754); `RotateAsync` call :387 (body :801, successor
:809-816, `TryRotateAsync` claim :824-826, lost-claim replay answer :828-838); rotated response :404-407.
`GetPrincipalFromExpiredToken` validation params at `TokenService.cs:164` (ValidateIssuer :168,
ValidateAudience :169, ValidateIssuerSigningKey :170, ValidateLifetime=false :172, ValidAlgorithms :177, alg
header re-check :187). Sliding expiry: `RefreshTokenLifetime` base property
`AuthenticationServiceBase.cs:145,146` reading `TokenService.RefreshTokenLifetime` (`TokenService.cs:155`,
`FromDays(_jwtSettings.RefreshTokenExpirationDays)`), default 7 at `JwtSettings.cs:64`; interface default
`ITokenService.cs:40`; stamped :774 (new session) and :814 (successor). Per-user cap:
`MaxActiveSessionsPerUser` :148-153 (`RefreshSessions:MaxActiveSessionsPerUser`, default 10, range 1-1000),
`EnforceSessionCapAsync` :864 with the eviction loop :873-876; retention sweep `RefreshSessionCleanupService`
over `RefreshSessions:RetentionDays` :857-862. Explicit revoke: `RevokeTokenAsync` :416, single-device branch
:431-447, degrade-to-all :450, `RevokeLiveSessionsAsync` :844. Shared rejection error :883,884. Sealed
subclasses: ADC `AuthenticationService.cs:46` (`IRefreshSessionStore` :54, base forward :56-64), Store
`AuthenticationService.cs:22` (`IRefreshSessionStore` :29, base forward :31-39). ADC OAuth path (ADR-036)
opens the same session: external-login body :205 returning `IssueTokensAsync` at :304. The code block is
illustrative-of-the-shape, condensed from `ResolveRotatableSessionAsync` (:729-754) and `RotateAsync`
(:809-838); it is not byte-for-byte. Prose verified free of em dashes and the banned boundary-noun.*

- Full series index: https://ivanball.github.io/writing.html
