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

## Context
ADR-019's global rate limiter is **authenticated-only**: it caps requests per authenticated principal
and deliberately *exempts* anonymous traffic. The highest-value anonymous attack surface (the login
and registration endpoints) therefore gets nothing from *that* limiter (credential stuffing, password
spraying, registration spam). ADR-019 now puts a second, narrower limiter directly on those two
endpoints: the named `RateLimitPolicyAuthIp` (`"auth-ip"`) policy, a fixed one-minute window keyed on
the client IP (default 30 requests, `429` on overage), which `AuthControllerBase` applies to login and
register by default. That caps how fast *one source address* can hammer the auth surface; it does not
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
  excess always lands on the cap. `CheckLockoutAsync(email)` returns `Result.Failure(Error.Unauthorized(
  "Auth.TooManyAttempts", …))` while locked, and `ResetFailedAttemptsAsync(email)` clears both the
  attempt and lockout keys on a successful login.
- **Registration throttle (IP-keyed).** `CheckRegistrationRateLimitAsync(ip)` fails with
  `Error.Unauthorized("Auth.RegistrationRateLimitExceeded", …)` once `MaxRegistrationsPerIpPerHour`
  (default 10) registrations from one IP land inside `RegistrationRateLimitWindowMinutes` (default 60);
  `IncrementRegistrationCountAsync(ip)` bumps the per-IP counter. A missing/empty IP is a deliberate
  **no-op (fail-open)**.
- **Keyed by submitted email / client IP, not by principal**, so it works before authentication: the
  gap a per-principal limiter cannot fill.
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
  the same default. The accepted cost, in the code's own words: parallel attempts can overwrite each
  other's increments, so a burst of genuinely concurrent guesses can undercount and stay below
  `MaxFailedAttempts`. Sequential guessing, which is what a credential-stuffing run against one account
  looks like, still trips the lockout. Because every shipped implementation writes the value back with
  its TTL, the TTL is refreshed on every write: the attempt and registration windows slide rather than
  staying anchored to the first attempt, which only ever tightens the limit.
- **Counters are cache-scoped and TTL-bounded.** They live in the same swappable `ICacheService`
  substrate as ADR-026 (in-process memory in the monolith, distributed/Redis when wired) and self-expire
  via cache TTL: a lockout is inherently ephemeral, so expiry *is* the reset.
- **Returns `Result` (ADR-013)**, so the HTTP edge maps every failure to a uniform `401` without the
  endpoint special-casing it.
- **Centralized in the shared authentication base.** The call sequence lives once in
  `AuthenticationServiceBase<TUser>` (`MMCA.Common.Application.Auth`): `CheckLockoutAsync` before
  credential validation, `IncrementFailedAttemptsAsync` on each failed attempt,
  `ResetFailedAttemptsAsync` on a successful login, and `CheckRegistrationRateLimitAsync` /
  `IncrementRegistrationCountAsync` around sign-up. Store and ADC `AuthenticationService` are sealed
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
  checks return a `Result` failure the edge maps to the same uniform `401` as a bad password. Three
  mechanisms by design, not one.
- **Cache-backed, no new table.** Reusing ADR-026's substrate means the protection scales from monolith
  to distributed with no schema and no per-handler branching, and a lockout's natural lifetime is a TTL,
  not a row to clean up.
- **Exponential backoff** frustrates automated guessing (each excess attempt doubles the wait) while a
  legitimate user's brief lockout self-heals within the cap.

## Trade-offs
- **Cache-scoped state weakens under scale-out without Redis.** In memory mode the counters are
  per-replica and evaporate on restart, so a multi-replica deployment that did not wire a distributed
  cache does not aggregate an attacker hitting different replicas. The answer is the same as ADR-026:
  register a distributed cache once scaled out (both apps do).
- **Normalization widens the DoS lever slightly.** Collapsing every spelling onto one counter is what
  makes the lockout enforceable, and it also means an attacker no longer needs to guess the exact
  spelling the victim uses to lock them out. That is the same targeted-DoS trade below, not a new one:
  the alternative was a lockout that did not hold at all.
- **Email-keyed lockout is a targeted-DoS lever.** An attacker can lock a *known* account out by
  deliberately failing its logins. The short backoff cap (default 300s) and the generic 401 bound the
  harm, but it is an accepted availability-for-security trade.
- **IP-keyed registration throttle is coarse.** Shared NAT/proxy IPs throttle innocents together, and
  per-attacker IP rotation evades it; it is fail-open on a missing IP. It raises the cost of bulk signup,
  it does not stop a determined distributed attacker.
- **Protection rides on the shared base class, not on the HTTP edge.** Because the call sequence is
  centralized in `AuthenticationServiceBase<TUser>`, a consumer whose `AuthenticationService`
  subclasses it inherits the lockout and registration-throttle checks automatically (both apps do), so
  it is no longer a per-flow convention that a subclass can forget. What the framework still does not do
  is intercept the HTTP endpoints: an Identity flow written *without* the base class (calling
  `ILoginProtectionService` by hand, or not at all) remains unprotected. That residual is the same
  audit-the-inventory caveat as the other opt-in capabilities (ADR-019/020/021/026).

## Related
ADR-019 (the layered limiter: an authenticated-only global cap that exempts this anonymous surface,
plus the per-IP `auth-ip` window that now sits on the same two endpoints),
ADR-026 (the `ICacheService` substrate these counters live in),
ADR-013 (the `Result` / `Error` the checks return),
ADR-022 (the browser session-cookie auth flow these endpoints sit behind).
