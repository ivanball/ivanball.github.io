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
Revised 2026-10-21: the timing burn for an address with no usable credential is a discarded hash rather than a decoy verify, a wrong second-factor code also increments the login counter, change-password rejects a credential-less account before its lockout check, and the hybrid-cache checks read past L1; anchors refreshed.
Revised 2026-10-26: the password verifier accepts a legacy 64-byte hash or a versioned header-plus-hash (not a 64-byte hash only); the login branches no longer all pay the same key-derivation cost, since a legacy record verifies at 600,000 iterations while the burn hashes at the current 210,000 (the gap ADR-133 accepts); a successful sign-in now ends with a best-effort password rehash; and the live anchors were refreshed.
Revised 2026-10-28: anchors refreshed after Common #615 and ADC #298 moved them.
Revised 2026-11-04 (Common v1.277.0 removed `DistributedCacheService`, so `HybridCacheService` is the only
shared-store implementation the counters run on; see Revision below).
Revised 2026-11-07: a login lockout now logs one Warning when it first trips, carrying a 12-character
prefix of the key's SHA-256 and the lockout seconds, never the email; see Revision (2026-11-07).
Revised 2026-11-23: the burn now derives at the legacy 600,000 iterations, so a legacy record is no
longer timing-distinguishable but a current-format record now verifies faster than the burn; a lockout
carries `RetryAfter` and answers with a `Retry-After` header, and a reset clears three keys; failed
attempts now log per attempt (an Information line on each counter increment, and a Warning on each
failed sign-in); the two-factor
management bases are three more principal-keyed call sites; `auth-ip` covers more endpoints; hosts
reach the hybrid cache through `AddMmcaServiceHost`; anchors refreshed.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:103`), which the
  edge answers as `429`. The error carries a `RetryAfter` (`:107`) computed from a separate
  lockout-until key (`:69`) that the trip writes beside the lockout flag with the same TTL
  (`:162-166`). `ResetFailedAttemptsAsync(email)` clears all three keys (attempts, lockout flag and
  lockout-until, `:187-189`) on a successful login.
- **Registration throttle (IP-keyed).** `CheckRegistrationRateLimitAsync(ip)` fails with
  `Error.Unauthorized("Auth.RegistrationRateLimitExceeded", ...)` (`LoginProtectionService.cs:221`,
  so `401`) once `MaxRegistrationsPerIpPerHour`
  (default 10) registrations from one IP land inside `RegistrationRateLimitWindowMinutes` (default 60);
  `IncrementRegistrationCountAsync(ip)` bumps the per-IP counter. A missing/empty IP is a deliberate
  **no-op (fail-open)**.
- **Keyed by submitted email / client IP, not by principal**, so it works before authentication: the
  gap a per-principal limiter cannot fill. The principal-keyed uses are the authenticated flows. The
  change-password flow keys its counter on `password-change:{userId}`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:144-145`)
  because the user has no address to key on there, and a separate key keeps a change-password lockout
  from locking the owner out of sign-in. The three two-factor management flows share a second
  principal key, `two-factor:{userId}`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/TwoFactorAttemptKey.cs:20-21`).
- **The email key is the normalized address, not the raw request string.** Keys route through the same
  `Email` value-object normalization (trim, lowercase) the user lookup uses, so every spelling that
  resolves to one account shares one counter and one lockout. Building keys from raw input made the
  backoff bypassable by varying capitalization or padding: `User@x.com`, `user@x.com` and a padded
  variant targeted the same account but got three independent counters. A malformed address, which
  never matches a user but still increments a counter, falls back to the same trim-and-lowercase shape
  so its variants collapse too.
- **Counter increments are a read-modify-write, not atomic, by decision.**
  `ICacheService.IncrementAsync` is a default interface member shaped as get, add one, set
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:133`). The shared-store
  implementation keeps that same shape instead of issuing Redis `INCR` (the remarks at `:126-132`):
  `INCR` writes a Redis *string* while `StackExchangeRedisCache` stores every entry as a Redis *hash*,
  so mixing the two formats at one key makes the next read of that counter fail with `WRONGTYPE`, which
  surfaces as a 500 on the login and registration endpoints that own it. A readable counter was worth
  more than an atomic one. `MemoryCacheService` does not override the member either, so memory mode runs
  the same default. `HybridCacheService`, the two-level implementation and, since Common v1.277.0 removed
  `DistributedCacheService`, the only shared-store one, which a host selects by calling
  `AddCommonHybridCache` (which replaces whatever `ICacheService` was registered) or its guarded form
  `AddCommonHybridCacheWhenRedisConfigured`, which registers it only when the Redis connection string
  is set (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:226-235`),
  overrides it (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:362`) with the
  same read-modify-write shape and additionally forces both legs past the in-process L1: an L1 hit would
  let a replica read a stale counter and write it back near its starting value, which is a security
  control quietly weakened by a cache optimization. The checks read the same way: the lockout flag and
  the registration count are read through `GetFromSharedStoreAsync`
  (`LoginProtectionService.cs:82`, `:212`; the lockout-until read at `:88` goes the same way), which
  never answers from L1 (`HybridCacheService.cs:266`). The accepted cost, in the code's own words: parallel attempts can overwrite each
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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:180-186`) and
  `ApiControllerBase.HandleFailure`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:49`) resolves the
  status through `ErrorHttpMapping` (`:62`, which ranks the most severe error type,
  `ErrorHttpMapping.cs:54-55`), so a login or change-password lockout answers `429`
  (`ErrorHttpMapping.cs:34`) and the registration throttle answers `401` (`:29`). A `429` whose
  `TooManyRequests` error carries a `RetryAfter` also gets a `Retry-After` header
  (`ApiControllerBase.cs:74`, `:87-99`), so a locked-out client learns when the lockout ends.
- **Centralized in framework code, not in consumer code.** The login and registration call sequence
  lives in `AuthenticationServiceBase<TUser>` (`MMCA.Common.Application.Auth`): `CheckLockoutAsync`
  before credential validation, `IncrementFailedAttemptsAsync` on each failed attempt (a wrong
  password, and also a wrong second-factor code, `TwoFactorInvalidCode`, which bumps the same
  email-keyed counter: `AuthenticationServiceBase.cs:873`, increment `:880-882`),
  `ResetFailedAttemptsAsync` on a successful login (`:274`), and `CheckRegistrationRateLimitAsync` /
  `IncrementRegistrationCountAsync` around sign-up (`:322`, `:385`). The password branch treats a
  machine client's service account (ADR-140) like an account with no stored credential: burn, count,
  generic `401` (`:197-210`, `CanSignInWithPassword` `:938-939`). Five further framework call sites
  sit outside that base. `ResetPasswordHandlerBase` takes `ILoginProtectionService` as a constructor
  dependency and calls `ResetFailedAttemptsAsync(request.Email)` once the new credential is persisted,
  so a user who reset the password *because* of a lockout is not left locked out by it.
  `ChangePasswordHandlerBase` takes it as well (`ChangePasswordHandlerBase.cs:60`) and runs the full
  sequence on its own key: `CheckLockoutAsync` before the current-password verify (`:102`),
  `IncrementFailedAttemptsAsync` on a wrong current password (`:110`) and `ResetFailedAttemptsAsync`
  on a correct one (`:115`), so the endpoint is not an unthrottled password oracle for anyone holding
  a session. Ahead of the lockout check it rejects an account with no stored credential with
  `Auth.InvalidCurrentPassword` and no counter increment (`:95-99`), since such an account has no
  current password to prove. Store and ADC `ChangePasswordHandler` subclass it and inject the
  service. The three two-factor management bases run the same check, increment and reset sequence
  on `two-factor:{userId}`: `ConfirmTwoFactorEnrollmentHandlerBase` (constructor `:43`, sequence
  `:76-91`), `DisableTwoFactorHandlerBase` (`:39`, `:55-82`) and `RegenerateRecoveryCodesHandlerBase`
  (`:40`, `:58-83`), all under `MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/`.
  Store subclasses all three (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/TwoFactor/`);
  ADC subclasses none of them. Store and ADC
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
  `AddMmcaServiceHost` (for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:82`,
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:37`), which calls
  `AddCommonHybridCacheWhenRedisConfigured`
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:95`), so with
  Redis configured the counters run through `HybridCacheService.IncrementAsync`.
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
scale-out path is the hybrid cache rather than `DistributedCacheService` alone (and since Common v1.277.0
the hybrid cache only: `DistributedCacheService` is removed, see the Revision (2026-11-04)): every ADC and Store
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

## Revision (2026-10-21)
Re-verified against current source. The lockout model, the backoff formula, the registration
throttle, the non-atomic counters, the fail-open posture and the `429` / `401` answers are
unchanged. Three behaviors the earlier revisions did not record were added (items 2 to 4), one
recorded behavior was corrected (item 1), and the live anchors
were re-pointed. Anchors inside the dated revisions above (including the "one throwaway
verification" wording and the `:615` / `:624` anchors of the 2026-09-07 and 2026-10-06 passes, and
`MMCA.Common/CHANGELOG.md:286` in the 2026-10-07 pass) record those passes as written.

1. **The timing burn is a discarded hash, not a decoy verify.** `BurnPasswordVerificationCost`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:623`, called at
   `:155`) returns early for a blank password (`:625-628`) and otherwise runs
   `passwordHasher.HashPassword` and discards the result (`:630`). Its remarks (`:615-622`) give the
   reason: hashing and verifying each run the hasher's key derivation once, while a verify against
   fixed decoy material is answered instantly by a hasher that rejects wrong-sized material, which
   reopens the timing gap. Every login branch still pays the same key-derivation cost.
2. **A wrong second-factor code counts as a failed attempt.** `ChallengeSecondFactorCountingFailuresAsync`
   (`AuthenticationServiceBase.cs:548`) increments the same email-keyed counter when the challenge
   fails with `TwoFactorInvalidCode` (`:557`), so the second factor cannot be guessed outside the
   lockout. The Decision's call-sequence bullet now says so.
3. **Change-password rejects a credential-less account before the lockout check.**
   `ChangePasswordHandlerBase` answers `Auth.InvalidCurrentPassword` without touching the counter
   when the stored hash or salt is empty
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:96-100`),
   then builds its key (`:102`) and runs check, increment and reset as before.
4. **The hybrid-cache checks bypass L1 too, not only the increment.** `LoginProtectionService` reads the
   lockout flag and the registration count through `GetFromSharedStoreAsync`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:59`, `:141`),
   which `HybridCacheService` implements against the shared store only (`HybridCacheService.cs:216`).
5. Anchors re-verified against current source: `ChangePasswordHandlerBase.cs` constructor dependency
   `:61`, `CheckLockoutAsync` `:103` (lockout returned unchanged at `:104-107`), increment `:111`,
   reset `:116`, `password-change:{userId}` key `:145-146`; `HybridCacheService.IncrementAsync`
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:326`, read leg
   through `SharedStoreReadOptions` at `:333` (defined `:89-94`), write leg with both L1 flags at
   `:342`; `AddCommonHybridCacheWhenRedisConfigured` at
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:139` and
   `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:103`; the Common 1.219.0 entry
   moving the lockout to `TooManyRequests` at `MMCA.Common/CHANGELOG.md:605` (heading `:593`).
   `LoginProtectionService.cs:68`, `:150` and `AuthenticationServiceBase.cs:139` are unchanged.

## Revision (2026-10-26)
Re-verified against current source. The lockout model, the backoff formula, the registration
throttle, the non-atomic counters, the fail-open posture and the `429` / `401` answers are
unchanged, and the login steps still run in the recorded order (lockout check, credential check,
verify, app gate, email-confirmation gate, second factor). Two recorded statements were corrected
(items 1 and 2), one step the earlier revisions did not record was added (item 3), and the live
anchors were re-pointed. Text and anchors inside the dated revisions above (including
`MMCA.Common/CHANGELOG.md:605` and its heading `:593` in the 2026-10-21 pass, and the "same
key-derivation cost" wording of the 2026-09-07 and 2026-10-21 passes) record those passes as written.

1. **The verifier accepts two hash shapes, not one.** The 2026-09-07 Revision says
   `PasswordHasher.VerifyPassword` rejects anything other than a 64-byte hash over a 32-byte salt.
   It now accepts a `SaltSize` salt (32 bytes,
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:25`) with either a
   legacy `HashSize` hash (64 bytes, `:28`) or a versioned hash of `VersionedHashSize` (a header
   plus the 64-byte hash, `:46`) whose header reads back as valid, and rejects every other shape
   (`VerifyPassword` `:77`, the guard at `:90`, `TryReadIterations` `:122`). The point the
   2026-09-07 item makes still holds: an external-OAuth account (ADR-036) carries an empty hash and
   salt, matches neither shape, and is unreachable by password login. The versioned work factor
   itself is ADR-133's decision.
2. **Login branches no longer all pay the same key-derivation cost.** The 2026-09-07 Status line and
   the 2026-10-21 Revision (item 1) say every branch pays one cost. The burn for an unknown or
   credential-less address hashes at the current work factor (`Iterations` 210,000,
   `PasswordHasher.cs:34`, used by `HashPassword` at `:66`; the discarded hash at
   `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:655`), while a
   legacy 64-byte record verifies at `LegacyIterations` 600,000 (`PasswordHasher.cs:37`, read back by
   `TryReadIterations` at `:122-127`). The code states the gap (`AuthenticationServiceBase.cs:643-645`):
   a legacy account is distinguishable from a missing address by timing until its owner signs in once.
   ADR-133 accepts that as a trade-off (its Trade-offs section, "Legacy accounts are distinguishable by
   timing until they sign in once"). A current-format record and the burn still cost the same.
3. **A successful sign-in ends with a best-effort rehash.** After the counter reset (`:224`) and token
   issue (`:230`), `LoginAsync` calls `RehashPasswordIfNeededAsync` (`:237`), which upgrades an
   outdated hash when the user implements `IPasswordRehashableUser`; a failure is logged and never
   fails the sign-in (Common 1.252.0, `MMCA.Common/CHANGELOG.md:183`, heading `:171`). It runs after
   every protection check, so it adds no lockout behavior. The email-confirmation gate,
   `CheckEmailConfirmed` (`:199`), sits between the app gate and the second factor.
4. Anchors re-verified against current source: `LoginProtectionService.cs` lockout failure
   `Error.TooManyRequests` `:70`, registration failure `Error.Unauthorized` `:152`, shared-store reads
   `:61` (lockout flag) and `:143` (registration count);
   `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs` lockout check
   and pass-through `:153-156`, `HasStoredCredential` check `:170` (defined `:627`),
   `BurnPasswordVerificationCost` call `:172` (defined `:648`, discarded `HashPassword` `:655`),
   verify `:178`, failed-attempt increment `:180`, `Auth.InvalidCredentials` `:175` and `:182`,
   `ValidateLoginCandidateAsync` gate call `:189` (hook declared `:601`),
   `ChallengeSecondFactorCountingFailuresAsync` `:568` with its increment at `:577`;
   `HybridCacheService.IncrementAsync`
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:327`, read leg
   through `SharedStoreReadOptions` at `:334` (defined `:90-95`), write leg with both L1 flags at
   `:343`, `GetFromSharedStoreAsync` `:217`; `AddCommonHybridCacheWhenRedisConfigured` in every
   service host, four in ADC (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:145`,
   Conference `:210`, Engagement `:122`, Notification `:125`) and three in Store
   (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:109`, Catalog `:114`, Sales
   `:120`); the Common 1.219.0 entry moving the lockout to `TooManyRequests` at
   `MMCA.Common/CHANGELOG.md:820` (heading `:808`). `ChangePasswordHandlerBase.cs` (`:61`, `:96-100`,
   `:103`, `:111`, `:116`, `:145-146`), `DependencyInjection.Caching.cs:202-214`,
   `ApiControllerBase.cs:48` and `ErrorHttpMapping.cs:26`, `:31` are unchanged.

## Revision (2026-10-28)
Re-verified against current source. No behavior changed: the lockout model, the backoff formula,
the registration throttle, the non-atomic counters, the fail-open posture, the `429` / `401` answers
and the login step order are as the 2026-10-26 Revision records them. Two live anchors moved after
Common #615 and ADC #298; the anchors inside the dated revisions above (including the "unchanged"
note on `DependencyInjection.Caching.cs:202-214`, `Program.cs:145` and the `MMCA.Common/CHANGELOG.md`
lines of the 2026-10-26 pass) record those passes as written.

1. Anchors re-verified against current source: the guarded
   `AddCommonHybridCacheWhenRedisConfigured` now runs
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:218-230`
   (declaration `:218`, connection-string guard `:224`, the `AddCommonHybridCache` call `:226`;
   `:202-214` is now its XML doc comment, and `AddCommonHybridCache` itself is declared at `:157`),
   and the ADC Identity host calls it at
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:146`. The Decision and Trade-offs
   anchors were re-pointed. For the record, the CHANGELOG entries cited by the 2026-10-26 pass now sit
   at `MMCA.Common/CHANGELOG.md:863` (Common 1.219.0 lockout to `TooManyRequests`, heading `:851`)
   and `:226` (Common 1.252.0 best-effort rehash, heading `:214`).

## Revision (2026-11-04)
Common v1.277.0 (Common PR #668) removed `DistributedCacheService`. No behavior of this record changed:
the counters stay a non-atomic read-modify-write with both legs on L2, and every ADC and Store host
already ran them on `HybridCacheService`. What changed is that the hybrid cache is now the only
shared-store implementation: a host that registers a distributed cache without `AddCommonHybridCache`
fails when `ICacheService` resolves, rather than falling back to a per-replica store
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:80-91`). The same
release folds prefix-invalidation generation tokens into every stored key; on a failed token read, a
boundary the process never saw reads as the shared baseline, so the lockout flag and the failure counters
stay in the keyspace every replica shares during a Redis outage
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CachePrefixGenerations.cs:52-58`). The
Decision and Alternatives rejected entries now name `HybridCacheService.IncrementAsync`
(`HybridCacheService.cs:342`) and the guarded helper at `DependencyInjection.Caching.cs:221-233`; the
dated revisions above that name `DistributedCacheService` record the code as it stood then.

## Revision (2026-11-07)
A lockout is no longer silent. The lockout model, the backoff formula, the thresholds, the answers and
the fail-open posture are unchanged; what changed is that an operator now sees an account lock.

1. **One Warning when the lockout first trips.** `IncrementFailedAttemptsAsync` sets the lockout flag
   whenever the counter is at or above `MaxFailedAttempts`, and logs only when the counter equals it
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:99`, `:108`,
   `:110-115`): "Login protection lockout tripped for key {KeyHash}; locked out for {LockoutSeconds}s"
   (`:224-225`). A stuffing run that keeps guessing past the threshold extends the lockout but adds no
   lines, so the log carries one line per locked account rather than one per attempt. The check reads
   the same non-atomic counter the Alternatives below accept, so two truly concurrent attempts that read
   the same prior value can both reach the threshold and log twice; that is the same narrow window that
   lets such a burst slip under the threshold.
2. **A hashed key, never the email.** `{KeyHash}` is the first 12 hex characters (48 bits,
   `LogKeyHashLength`, `:35-36`) of the key segment the lockout cache entry already uses
   (`LogKeyHash`, `:211-217`): `EmailIdentity.KeySegment`, the SHA-256 of the normalized address
   (`.../Infrastructure/Auth/EmailIdentity.cs:25-26`). A full unsalted digest of a guessable address can
   be reversed by hashing candidates; a 48-bit prefix matches too many addresses to name one, while still
   correlating repeated lockouts of the same account (`:212-216`). No IP address or user agent is logged.
3. The refresh-token reuse Warning that pairs with it on the session side is recorded in
   [ADR-097](097-multi-device-refresh-sessions.md)'s Amendment (2026-11-07). Failed attempts are still
   not stored in a table.

## Revision (2026-11-23)
Re-verified against current source. The lockout model, the backoff formula, the thresholds, the
registration throttle, the non-atomic counters, the fail-open posture, the `429` / `401` answers and
the login step order are unchanged. Six behaviors moved since the earlier revisions and are
recorded below; the live Decision, Trade-offs, Alternatives and Related text was corrected to match.
Text and anchors inside the dated revisions above (including the 210,000 burn and "A current-format
record and the burn still cost the same" of the 2026-10-26 pass, the "one line per locked account"
of the 2026-11-07 pass, and the `MMCA.Common/CHANGELOG.md` lines) record those passes as written.

1. **The burn derives at the most expensive work factor, which inverts the timing gap.**
   `PasswordHasher` sets `BurnIterations` to the larger of `Iterations` (210,000) and
   `LegacyIterations` (600,000)
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:34`, `:37`, `:64`) and
   implements `IPasswordHasher.BurnVerificationCost` at that count over a fresh salt (`:114-119`; the
   interface default, a plain `HashPassword`, is
   `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:39`).
   `BurnPasswordVerificationCost`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:955`) calls it
   at `:962`. A legacy record is therefore no longer distinguishable from a missing address. A
   current-format record, though, is written and verified at 210,000 (`PasswordHasher.cs:72`,
   `:102`), so an unknown or credential-less address now costs roughly 2.9 times a wrong password on
   an existing current-format account. No padding or delay equalizes the two branches. The gap the
   2026-10-26 Revision records as closed for current-format accounts is open in the other direction;
   it stays open until the burn and the current verify cost the same.
2. **A lockout carries its expiry.** The trip writes a lockout-until key beside the flag with the same
   TTL (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:69`,
   `:162-166`), `CheckLockoutAsync` reads it only when locked (`:86-90`) and attaches the remaining
   time as `RetryAfter` (`:107`), and `ApiControllerBase` turns it into a `Retry-After` header on the
   `429` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:74`,
   `:87-99`). `ResetFailedAttemptsAsync` now removes three keys, not two (`LoginProtectionService.cs:187-189`).
3. **Every failed attempt now logs, not only the trip.** `IncrementFailedAttemptsAsync` writes an
   Information line, "Login protection recorded a failed attempt for key {KeyHash}; {AttemptCount} in
   the current window", on every increment (`LoginProtectionService.cs:145-149`, message `:283`), and
   `AuthenticationServiceBase` writes a Warning "Password sign-in failed ({Outcome}) for address hash
   {EmailHash}" for every failed sign-in, the locked-out outcome included
   (`AuthenticationServiceBase.cs:979`, message `:1059`). The lockout-tripped Warning still fires once
   per locked account (`LoginProtectionService.cs:170-173`), but a stuffing run now adds log lines
   per attempt. Both lines carry a truncated hash, never the address.
4. **Three more principal-keyed call sites.** `ConfirmTwoFactorEnrollmentHandlerBase`,
   `DisableTwoFactorHandlerBase` and `RegenerateRecoveryCodesHandlerBase` run check, increment and
   reset on `two-factor:{userId}`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/TwoFactorAttemptKey.cs:20-21`).
   Store subclasses all three; ADC subclasses none. The login password branch also rejects an ADR-140
   service account like a credential-less one (`AuthenticationServiceBase.cs:197-210`, `:938-939`).
5. **The `auth-ip` list grew.** Besides login and register
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:78`, `:103`), the
   password-reset pair and the email-confirmation pair, the policy sits on
   `MachineClients/MachineTokenControllerBase.cs:48`, `OAuthControllerBase.cs:176`,
   `Passkeys/PasskeysControllerBase.cs:232`, `:257` and `SignInLinks/SignInLinkControllerBase.cs:83`,
   `:111`. The Related entry was corrected.
6. **Hosts reach the hybrid cache through the service-host builder.** No ADC or Store host calls
   `AddCommonHybridCacheWhenRedisConfigured` directly; `AddMmcaServiceHost` does
   (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:95`), and all
   seven hosts call it (ADC Conference `Program.cs:82`, Engagement `:58`, Identity `:82`,
   Notification `:58`; Store Catalog `:32`, Identity `:37`, Sales `:51`).
7. Anchors re-verified against current source: `LoginProtectionService.cs` `TooManyRequests` `:103`,
   `Unauthorized` `:221`, shared-store reads `:82`, `:88`, `:212`, trip `:151`, `LogKeyHashLength`
   `:45`, `LogKeyHash` `:276` (doc `:270-275`), lockout-tripped message `:287`;
   `ErrorHttpMapping.cs` `401` `:29`, `429` `:34`, most-severe ranking `:54-55`;
   `ApiControllerBase.cs` `HandleFailure` `:49`, status `:62`; `HybridCacheService.cs`
   `IncrementAsync` `:362` (read leg `:369`, write leg with both L1 flags `:378`),
   `SharedStoreReadOptions` `:92-96`, `GetFromSharedStoreAsync` `:266`; `DependencyInjection.Caching.cs`
   guarded helper `:226` (guard `:232`, call `:234`), `AddCommonHybridCache` `:162`, the throw in the
   `ICacheService` factory when an L2 is registered without the hybrid service over it `:79-93` (message `:89-92`); `AuthenticationServiceBase.cs`
   request validation `:170-177`, lockout check `:180` (passed through `:186`), credential check
   `:201`, burn `:203`, verify `:212`, increments `:204` and `:214`, app gate `:226` (hook `:906`),
   `CheckEmailConfirmed` `:239` (defined `:829`), second factor `:248` (defined `:873`, increment
   `:880-882`), reset `:274`, rehash `:295` (defined `:1001`), registration check `:322` and increment
   `:385`; `ChangePasswordHandlerBase.cs` `:60`, `:95-99`, `:101`, `:102`, `:110`, `:115`,
   `:144-145`.

## Alternatives rejected
- **Making the failed-attempt and registration counters atomic.** The increment in
  `HybridCacheService.IncrementAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:362`) is a
  read-modify-write against the `IDistributedCache` L2 only (both legs bypass L1) and is knowingly not
  atomic (decided in Common v1.125.2, PR #119, on the since-removed `DistributedCacheService`). It once used Redis `INCR`, which is atomic but
  writes a Redis **string**, while `StackExchangeRedisCache` stores every entry as a Redis **hash**,
  so the next read of that key returned `WRONGTYPE` and answered 500 from both registration and
  login. Two remedies were weighed on 2026-07-25 and both declined: a Lua script written against the
  hash layout, and moving these counters off `IDistributedCache` so both sides speak Redis strings.
  The residual weakness is narrow. Concurrent guesses can overwrite each other's increments, so a
  parallel burst can stay under `MaxFailedAttempts`, but sequential guessing (what credential
  stuffing against one account actually looks like) still trips the lockout. The comments in
  `LoginProtectionService.IncrementFailedAttemptsAsync` and the v1.126.0 CHANGELOG entry record the
  accepted final state, not a TODO: cite this section rather than re-opening the finding.

## Related
ADR-019 (the layered limiter: a principal-keyed global cap that exempts this anonymous surface, its
one metered anonymous exception being the real-time hub paths, plus the per-IP `auth-ip` window that
now sits on these two endpoints, on the password-reset pair, the two email-confirmation endpoints,
the machine-token endpoint, one OAuth endpoint, two passkey endpoints and the two sign-in-link
endpoints),
ADR-026 (the `ICacheService` substrate these counters live in),
ADR-013 (the `Result` / `Error` the checks return),
ADR-022 (the browser session-cookie auth flow these endpoints sit behind).
