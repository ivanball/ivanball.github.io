# ADR-029: Authentication Brute-Force Protection and Registration Throttling

## Status
Accepted (2026-06-27). Updated 2026-07-02 (the check/increment/reset call sequence was hoisted
into `AuthenticationServiceBase<TUser>`; the adoption note and the "convention the consumer must
call" trade-off were rewritten to match). Updated 2026-07-25 (the backoff formula now shows the
clamped shift exponent; the counter-atomicity claim was corrected to the accepted non-atomic
read-modify-write, and the native-counter window claim was dropped). Updated 2026-08-01 (the premise
that login and registration carry no rate limiter at all is stale: ADR-019's `auth-ip` per-IP window
now sits on both endpoints by default, so the context and the ADR-019 comparison were corrected to
describe the layering instead; the lockout decision itself is unchanged).
Revised 2026-09-07 (the account-state gate runs after the password check, a credential-less account
cannot authenticate, and every login branch pays the same key-derivation cost).
Updated 2026-09-19 (ADR-019's anonymous exemption now has one metered exception, the real-time hub
paths counted per client IP, and the `auth-ip` window's algorithm is configurable with fixed as the
default; a third `ICacheService` implementation, the opt-in `HybridCacheService`, also overrides
`IncrementAsync`; and `ResetPasswordHandlerBase` is a second framework call site, clearing the
failed-attempt counter after a password reset).
Revised 2026-10-01 (change-password is a third framework call site, with a principal-keyed counter; every ADC and Store service host calls `AddCommonHybridCacheWhenRedisConfigured`, so with Redis configured the counters run through `HybridCacheService.IncrementAsync`; see Revision below).
Revised 2026-10-03 (the counters fail open with a Warning log when the cache is unavailable, instead of
answering 500; see Revision below).
Revised 2026-10-07: a login or change-password lockout answers 429 `Auth.TooManyAttempts` (an
`Error.TooManyRequests`, since Common 1.219.0) rather than a uniform 401, while the registration throttle
still answers 401; see Revision below.
## Context
ADR-019's global rate limiter is **principal-keyed**: it caps requests per authenticated principal,
and anonymous traffic is exempt with one metered exception, the configured real-time hub path
prefixes, where an unauthenticated request counts per client IP instead. The highest-value anonymous
attack surface (the login and registration endpoints) is not that exception, so it still gets nothing
from *that* limiter (credential stuffing, password spraying, registration spam). ADR-019 now puts a
second, narrower limiter directly on those two endpoints: the named `RateLimitPolicyAuthIp`
(`"auth-ip"`) policy, a one-minute window keyed on the client IP (default 30 requests, `429` on
overage), which `AuthControllerBase` applies to login and register by default. That window is
fixed by default and sliding when `RateLimiting:Algorithm` selects it, so the counting shape is
configuration, not a constant. That caps how fast *one source address* can hammer the auth surface;
it does not
cap guesses against *one account*, since an attacker spreading a run across addresses gets a fresh
bucket per address, and its response is a middleware `429` rather than an auth outcome. Two of those
defences also cannot live in a per-principal limiter at all:
at login time there is **no principal yet**, so account lockout must key on the *submitted* identity
(email) and the client IP, not on an authenticated user. We needed a small, always-available service
that the Identity flow calls to throttle these pre-authentication paths.

## Decision
Provide a framework `ILoginProtectionService` (`MMCA.Common.Application.Auth`) with a single
implementation `LoginProtectionService` (`MMCA.Common.Infrastructure.Auth`), registered unconditionally
by `AddInfrastructure` (`services.TryAddScoped<ILoginProtectionService, LoginProtectionService>()`), so
every host that wires infrastructure has it. Its state lives in `ICacheService` (ADR-026), never in a
table.

- **Login lockout (email-keyed).** `IncrementFailedAttemptsAsync(email)` counts consecutive failures in
  a window (`FailedAttemptWindowMinutes`, default 30). Once `MaxFailedAttempts` (default 5) is reached it
  writes a lockout key with **exponential backoff**
  `Math.Min(1 << Math.Min(excessAttempts, 30), MaxLockoutSeconds)` (cap default 300s). The inner clamp
  on the exponent is load-bearing: C# masks int shift counts to 5 bits, so an unclamped `1 << 31` is
  negative and `1 << 32` wraps back to 1, silently shrinking (or negating) the lockout TTL for a
  sufficiently persistent attacker. `1 << 30` already exceeds any permitted `MaxLockoutSeconds`, so deep
  excess always lands on the cap. `CheckLockoutAsync(email)` returns `Result.Failure(Error.TooManyRequests(
  "Auth.TooManyAttempts", ...))` while locked
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:68`), which the
  edge answers as `429`, and `ResetFailedAttemptsAsync(email)` clears both the
  attempt and lockout keys on a successful login.
- **Registration throttle (IP-keyed).** `CheckRegistrationRateLimitAsync(ip)` fails with
  `Error.Unauthorized("Auth.RegistrationRateLimitExceeded", ...)` (`LoginProtectionService.cs:150`,
  so `401`) once `MaxRegistrationsPerIpPerHour`
  (default 10) registrations from one IP land inside `RegistrationRateLimitWindowMinutes` (default 60);
  `IncrementRegistrationCountAsync(ip)` bumps the per-IP counter. A missing/empty IP is a deliberate
  **no-op (fail-open)**.
- **Keyed by submitted email / client IP, not by principal**, so it works before authentication: the
  gap a per-principal limiter cannot fill. The one principal-keyed use is the authenticated
  change-password flow, which keys its counter on `password-change:{userId}`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:128-129`)
  because the user has no address to key on there, and a separate key keeps a change-password lockout
  from locking the owner out of sign-in.
- **The email key is the normalized address, not the raw request string.** Keys route through the same
  `Email` value-object normalization (trim, lowercase) the user lookup uses, so every spelling that
  resolves to one account shares one counter and one lockout. Building keys from raw input made the
  backoff bypassable by varying capitalization or padding: `User@x.com`, `user@x.com` and a padded
  variant targeted the same account but got three independent counters. A malformed address, which
  never matches a user but still increments a counter, falls back to the same trim-and-lowercase shape
  so its variants collapse too.
- **Counter increments are a read-modify-write, not atomic, by decision.**
  `ICacheService.IncrementAsync` is a default interface member shaped as get, add one, set.
  `DistributedCacheService` overrides it but keeps that same shape instead of issuing Redis `INCR`:
  `INCR` writes a Redis *string* while `StackExchangeRedisCache` stores every entry as a Redis *hash*,
  so mixing the two formats at one key makes the next read of that counter fail with `WRONGTYPE`, which
  surfaces as a 500 on the login and registration endpoints that own it. A readable counter was worth
  more than an atomic one. `MemoryCacheService` does not override the member either, so memory mode runs
  the same default. `HybridCacheService`, the opt-in two-level implementation a host selects by calling
  `AddCommonHybridCache` (which replaces whatever `ICacheService` was registered) or its guarded form
  `AddCommonHybridCacheWhenRedisConfigured`, which registers it only when the Redis connection string
  is set (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:200-212`),
  overrides it (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:264`) with the
  same read-modify-write shape and additionally forces both legs past the in-process L1: an L1 hit would
  let a replica read a stale counter and write it back near its starting value, which is a security
  control quietly weakened by a cache optimization. The accepted cost, in the code's own words: parallel attempts can overwrite each
  other's increments, so a burst of genuinely concurrent guesses can undercount and stay below
  `MaxFailedAttempts`. Sequential guessing, which is what a credential-stuffing run against one account
  looks like, still trips the lockout. Because every shipped implementation writes the value back with
  its TTL, the TTL is refreshed on every write: the attempt and registration windows slide rather than
  staying anchored to the first attempt, which only ever tightens the limit.
- **Counters are cache-scoped and TTL-bounded.** They live in the same swappable `ICacheService`
  substrate as ADR-026 (in-process memory in the monolith, distributed/Redis when wired) and self-expire
  via cache TTL: a lockout is inherently ephemeral, so expiry *is* the reset.
- **Returns `Result` (ADR-013)**, so the HTTP edge maps each failure by its error type without the
  endpoint special-casing it: `AuthenticationServiceBase` passes the lockout error through unchanged
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:139`) and
  `ApiControllerBase.HandleFailure` resolves the status through `ErrorHttpMapping`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:48`), so a
  login or change-password lockout answers `429` (`ErrorHttpMapping.cs:31`) and the registration
  throttle answers `401` (`:26`).
- **Centralized in framework code, not in consumer code.** The login and registration call sequence
  lives in `AuthenticationServiceBase<TUser>` (`MMCA.Common.Application.Auth`): `CheckLockoutAsync`
  before credential validation, `IncrementFailedAttemptsAsync` on each failed attempt,
  `ResetFailedAttemptsAsync` on a successful login, and `CheckRegistrationRateLimitAsync` /
  `IncrementRegistrationCountAsync` around sign-up. Two further framework call sites sit outside that
  base. `ResetPasswordHandlerBase` takes `ILoginProtectionService` as a constructor dependency and
  calls `ResetFailedAttemptsAsync(request.Email)` once the new credential is persisted, so a user who
  reset the password *because* of a lockout is not left locked out by it. `ChangePasswordHandlerBase`
  takes it as well (`ChangePasswordHandlerBase.cs:47`) and runs the full sequence on its own key:
  `CheckLockoutAsync` before the current-password verify (`:89`), `IncrementFailedAttemptsAsync` on a
  wrong current password (`:97`) and `ResetFailedAttemptsAsync` on a correct one (`:102`), so the
  endpoint is not an unthrottled password oracle for anyone holding a session. Store and ADC
  `ChangePasswordHandler` subclass it and inject the service. Store and ADC
  `AuthenticationService` are sealed
  subclasses that inject `ILoginProtectionService` into the base constructor and inherit those calls;
  neither app invokes the protection methods directly. Settings bind from the `"LoginProtection"`
  section.

## Rationale
- **Complements ADR-019 rather than duplicating it.** ADR-019 carries two limiter layers and this is
  the third on top of them: its global limiter caps authenticated *throughput* per principal, its
  `auth-ip` policy caps *request rate per source IP* on login and register, and this caps *attempts
  against one account* (keyed on the submitted email, so it holds however many addresses the attempts
  come from) plus signups per IP over an hour rather than a minute. The keys differ and so does the
  response shape: the limiters reject at the middleware with `429` and no auth outcome, while these
  checks return a `Result` failure carrying an auth error code (`Auth.TooManyAttempts`, answered
  `429`; `Auth.RegistrationRateLimitExceeded`, answered `401`). Three mechanisms by design, not one.
- **Cache-backed, no new table.** Reusing ADR-026's substrate means the protection scales from monolith
  to distributed with no schema and no per-handler branching, and a lockout's natural lifetime is a TTL,
  not a row to clean up.
- **Exponential backoff** frustrates automated guessing (each excess attempt doubles the wait) while a
  legitimate user's brief lockout self-heals within the cap.

## Trade-offs
- **Cache-scoped state weakens under scale-out without Redis.** In memory mode the counters are
  per-replica and evaporate on restart, so a multi-replica deployment that did not wire a distributed
  cache does not aggregate an attacker hitting different replicas. The answer is the same as ADR-026:
  register a distributed cache once scaled out. Both apps do: every ADC and Store service host calls
  `AddCommonHybridCacheWhenRedisConfigured` (for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:138`,
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:102`), so with Redis configured
  the counters run through `HybridCacheService.IncrementAsync`.
- **Normalization widens the DoS lever slightly.** Collapsing every spelling onto one counter is what
  makes the lockout enforceable, and it also means an attacker no longer needs to guess the exact
  spelling the victim uses to lock them out. That is the same targeted-DoS trade below, not a new one:
  the alternative was a lockout that did not hold at all.
- **Email-keyed lockout is a targeted-DoS lever.** An attacker can lock a *known* account out by
  deliberately failing its logins. The short backoff cap (default 300s) bounds the
  harm, but it is an accepted availability-for-security trade.
- **IP-keyed registration throttle is coarse.** Shared NAT/proxy IPs throttle innocents together, and
  per-attacker IP rotation evades it; it is fail-open on a missing IP. It raises the cost of bulk signup,
  it does not stop a determined distributed attacker.
- **Protection rides on the shared base class, not on the HTTP edge.** Because the login and
  registration call sequence is
  centralized in `AuthenticationServiceBase<TUser>`, a consumer whose `AuthenticationService`
  subclasses it inherits the lockout and registration-throttle checks automatically (both apps do), so
  it is no longer a per-flow convention that a subclass can forget. What the framework still does not do
  is intercept the HTTP endpoints: an Identity flow written *without* the base class (calling
  `ILoginProtectionService` by hand, or not at all) remains unprotected. That residual is the same
  audit-the-inventory caveat as the other opt-in capabilities (ADR-019/020/021/026).

## Revision (2026-09-07)
The lockout model is unchanged. Three things about the order and cost of the login path changed, all
from the 2026-09-07 security review.

1. **The account-state gate runs after the password check** (SEC-Common-05).
   `AuthenticationServiceBase.LoginAsync` verifies the password
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:159`) and only
   then calls the app's `ValidateLoginCandidateAsync` gate (`:170`, hook declared at `:559`).
   Reaching the gate therefore proves the caller owns the account, so the gate's distinct message
   (a deactivated account, say) is told to the owner rather than to anyone sweeping addresses. It
   also closes a counting hole: a wrong password against a gated account now increments the
   failed-attempt counter (`:160-163`) instead of short-circuiting ahead of it.
2. **An account with no stored credential cannot authenticate** (SEC-Common-01). `HasStoredCredential`
   (`:758`) is checked before the verify (`:151`), and `PasswordHasher.VerifyPassword`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:43`) rejects credential
   material it never produced, meaning anything other than a `HashSize` 64-byte hash over a
   `SaltSize` 32-byte salt (`:18`, `:15`). This is what makes an external-OAuth account
   (ADR-036), which carries empty hash and salt, unreachable by password login rather than
   verifiable against any password.
3. **Timing is equalized for an address with no usable credential** (SEC-Common-78). The
   unknown-address and no-credential branch runs one throwaway verification before answering:
   `BurnPasswordVerificationCost` (`:766`, the verify at `:775`), called at `:153`. Without it the
   401 for an address with no account came back in a fraction of the time a real check takes, which
   is a membership oracle that no amount of response-body sameness closes. The generic
   `Auth.InvalidCredentials` answer (`:156`, `:163`) is unchanged.

## Revision (2026-10-01)
The login lockout and registration throttle are unchanged. Two current-state statements were
corrected. First, `ResetPasswordHandlerBase` is no longer the only framework call site outside
`AuthenticationServiceBase<TUser>`: `ChangePasswordHandlerBase` injects `ILoginProtectionService`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:47`)
and runs check, increment and reset around the current-password verify (`:89`, `:97`, `:102`), so a
signed-in session cannot guess the current password without hitting the same exponential lockout.
Its counter is keyed `password-change:{userId}` (`:128-129`), a principal key rather than an email,
so the "keyed by submitted email / client IP" bullet now names this one exception. Second, the
scale-out path is the hybrid cache rather than `DistributedCacheService` alone: every ADC and Store
service host calls the guarded `AddCommonHybridCacheWhenRedisConfigured`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:200-212`), so with
Redis configured the counters run through `HybridCacheService.IncrementAsync`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:253`), the same
non-atomic read-modify-write with L1 bypassed. The line anchors inside the 2026-09-07 Revision record
the code as it stood then and are left as written.

## Revision (2026-10-03)
Decision added: **the counters fail open when the cache is unavailable.** Before this revision no
behavior was decided for a cache outage, and the observed result was neither open nor closed: with
Redis stopped, the lockout check read nothing and let the attempt through, while the failed-attempt
increment and the post-login reset rethrew the cache failure, so `POST /Auth/login` answered 500 for
a right and a wrong password alike (ADC Local Test Run 3). `LoginProtectionService` now catches a
cache failure in every check, increment and reset (login lockout and registration throttle), logs it
at Warning, and continues as if no counter state exists: a check answers success and an increment or
reset is a no-op. Caller cancellation still propagates.

Fail open was chosen over fail closed for three reasons. `CacheSettings` already promises that a
cache outage never becomes an error, and login is the one path where breaking that promise locks
every user out of every service at once. The counters are ephemeral by design (expiry is the reset),
so an outage only shortens a lockout that would have lapsed anyway. And guessing is still bounded
while the cache is down, because ADR-019's `auth-ip` per-IP window on login and register keeps its
own in-process state and is unaffected by the outage (it is deliberately never Redis-backed). It is
also the posture the framework already takes for the distributed request limiter,
`RedisFixedWindowRateLimiter`, which permits the request and logs a warning on a Redis fault. The cost is that a lockout already in force is
not enforced during the outage; the Warning log makes that window visible.

## Revision (2026-10-06)
No behavior changed; this pass corrected anchors only.

- The Trade-offs examples of a host calling `AddCommonHybridCacheWhenRedisConfigured` now point at
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:138` and
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:102`.
- The login-path order recorded in the 2026-09-07 Revision still holds (credential check, verify,
  gate); its anchors in
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs` have moved and
  now read: `HasStoredCredential` check `:153` (defined `:607`), `BurnPasswordVerificationCost` call
  `:155` (defined `:615`, throwaway verify `:624`), password verify `:161`, failed-attempt increment
  `:163`, `Auth.InvalidCredentials` `:158` and `:165`, `ValidateLoginCandidateAsync` gate call `:172`
  (hook declared `:581`).
- Every other live anchor (`ChangePasswordHandlerBase.cs`, `DependencyInjection.Caching.cs`,
  `HybridCacheService.cs`, `PasswordHasher.cs`) was re-verified against current source and is
  unchanged.

## Alternatives rejected
- **Making the failed-attempt and registration counters atomic.** The increment in
  `DistributedCacheService.IncrementAsync` is a read-modify-write through `IDistributedCache` and is
  knowingly not atomic (Common v1.125.2, PR #119). It once used Redis `INCR`, which is atomic but
  writes a Redis **string**, while `StackExchangeRedisCache` stores every entry as a Redis **hash**,
  so the next read of that key returned `WRONGTYPE` and answered 500 from both registration and
  login. Two remedies were weighed on 2026-07-25 and both declined: a Lua script written against the
  hash layout, and moving these counters off `IDistributedCache` so both sides speak Redis strings.
  The residual weakness is narrow. Concurrent guesses can overwrite each other's increments, so a
  parallel burst can stay under `MaxFailedAttempts`, but sequential guessing (what credential
  stuffing against one account actually looks like) still trips the lockout. The comments in
  `LoginProtectionService.IncrementFailedAttemptsAsync` and the v1.126.0 CHANGELOG entry record the
  accepted final state, not a TODO: cite this section rather than re-opening the finding.

## Revision (2026-10-07)
Re-verified against current source. The lockout model, the backoff formula, the registration
throttle, the non-atomic counters and the fail-open posture are unchanged. What moved is the HTTP
answer to a lockout, which the 2026-10-03 and 2026-10-06 revisions did not record.

1. **A lockout answers `429`, not `401`.** `CheckLockoutAsync` fails with
   `Error.TooManyRequests("Auth.TooManyAttempts", ...)`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:68`); the error
   code is unchanged, the error type is not (Common 1.219.0, `MMCA.Common/CHANGELOG.md:286`).
   `AuthenticationServiceBase.LoginAsync` returns that error unchanged
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:139`), as does
   `ChangePasswordHandlerBase` (`ChangePasswordHandlerBase.cs:89-92`), and
   `ApiControllerBase.HandleFailure` resolves the status through `ErrorHttpMapping`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:48`), which maps
   `TooManyRequests` to `429` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:31`).
   The Decision, the "Returns `Result`" bullet, the ADR-019 comparison in Rationale and the
   targeted-DoS trade-off were corrected: the edge no longer maps every failure to one uniform `401`.
2. **The registration throttle still answers `401`.** `CheckRegistrationRateLimitAsync` fails with
   `Error.Unauthorized("Auth.RegistrationRateLimitExceeded", ...)` (`LoginProtectionService.cs:150`),
   mapped to `401` (`ErrorHttpMapping.cs:26`).
3. **The `auth-ip` list in Related is complete.** Besides login and register
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:72`, `:96`) and
   the password-reset pair (`PasswordResetAuthControllerBase.cs:78`, `:102`), the policy also sits on
   the two email-confirmation endpoints (`EmailConfirmationControllerBase.cs:81`, `:109`).
4. Anchors re-verified against current source: `HybridCacheService.IncrementAsync` is declared at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:264` (the
   Decision anchor was re-pointed; `:253` falls inside its remarks), with both legs still past L1
   (the read at `:271` through `SharedStoreReadOptions`, `:86-90`; the write at `:280`). The `:253` anchor in the 2026-10-01 Revision and the "unchanged" note in the 2026-10-06
   Revision record those passes as written.

## Related
ADR-019 (the layered limiter: a principal-keyed global cap that exempts this anonymous surface, its
one metered anonymous exception being the real-time hub paths, plus the per-IP `auth-ip` window that
now sits on these two endpoints, on the password-reset pair and on the two email-confirmation
endpoints),
ADR-026 (the `ICacheService` substrate these counters live in),
ADR-013 (the `Result` / `Error` the checks return),
ADR-022 (the browser session-cookie auth flow these endpoints sit behind).
