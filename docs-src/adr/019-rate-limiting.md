# ADR-019: Layered Rate Limiting with an Authenticated-Only Global Limiter

## Status
Accepted. Revised 2026-08-01 (the `auth-ip` per-IP anonymous-authentication limiter, which the shared
auth controller applies to login and register by default, is recorded as the third layer; the
anonymous-surface trade-off was corrected to match; the edge trust posture behind every IP partition
key was made explicit).

## Context
Every service exposes read and write endpoints to the public internet through the gateway (ADR-008).
Abusive or runaway clients (scrapers, credential stuffing, retry storms, a buggy SPA stuck in a loop)
can exhaust a service's threads, database connections, and downstream quotas. ASP.NET Core ships a
rate-limiting middleware, but "turn on rate limiting" is not the decision: the load-bearing questions
are *who* gets limited, *by what partition key*, and *what is exempt*. A naive per-IP global limiter
is actively wrong for this deployment for three reasons:

- Public read endpoints are output-cached, so legitimate anonymous browsing should be cheap, not
  throttled.
- Anonymous server-rendered (Blazor Server) traffic all shares the UI host's outbound IP, so an IP
  partition would throttle every public visitor as if they were a single abuser.
- Login and registration brute-force is a distinct threat with a distinct control (account lockout
  and per-IP registration throttling), not a general request cap.

## Decision
Rate limiting is **layered**, and the always-on global limiter is **authenticated-only**.

1. **A global limiter that only caps authenticated callers.** `AddCommonRateLimiting`
   (`MMCA.Common.API`) installs a `GlobalLimiter` (active on every request through `UseRateLimiter`)
   that:
   - **Exempts infrastructure traffic** outright (`NoLimiter`): `/health`, `/alive`, JWKS / OIDC
     discovery (`/.well-known/*`), and gRPC inter-service calls (`application/grpc` content type).
     These are legitimately high-frequency.
   - **Exempts anonymous traffic** (`NoLimiter`): unauthenticated requests are not counted, for the
     three reasons above.
   - **Caps each authenticated caller** to `globalPermitLimit` (default 300) requests per fixed
     one-minute window, partitioned by identity name, then the `user_id` claim, then remote IP,
     rejecting overage with `429 Too Many Requests`.
2. **Anonymous abuse is handled by the right-shaped control, not the global limiter.** Public reads
   are served from the output cache (`UseOutputCache`; ADC's Conference service defines
   `EventsCache` / `CategoriesCache` / `QuestionsCache` / `RoomsCache` policies on its public
   controllers), and login/registration brute-force is handled by `LoginProtectionService`
   (exponential-backoff account lockout after `MaxFailedAttempts` failed logins, plus per-IP
   registration throttling).
3. **A per-IP cap on the anonymous authentication endpoints, on by default.** `AddCommonRateLimiting`
   also registers the named policy `RateLimitPolicyAuthIp` (`"auth-ip"`): a fixed one-minute window
   keyed on the client IP, `authIpPermitLimit` (default 30) requests, overage rejected with `429`.
   Unlike the other named policies it is not left to each app to attach. `AuthControllerBase`
   (`MMCA.Common.API`) decorates `LoginAsync` and `RegisterAsync` with
   `[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]`, so any consumer that
   inherits the base gets it without opting in. **What an override inherits, settled empirically
   (2026-08-13):** `EnableRateLimitingAttribute` leaves `AttributeUsage.Inherited` at its default of
   `true`, and a derived override therefore still sees the base attribute through
   `GetCustomAttributes(inherit: true)`, so a bare override very likely retains the policy rather
   than silently dropping it. The convention is unchanged regardless: apply the attribute explicitly
   on **every** override (ADC always did; Store now does), because endpoint metadata resolution is
   not something an app should have to reason about per action, and a dropped policy fails silently.
   Two guards pin it instead of leaving it to argument: a MMCA.Common reflection test that asserts
   both the base decoration and the inherited-on-an-override case, and a Store integration test that
   reads the booted host's `EndpointDataSource` and asserts `POST /Auth/register` carries the
   `auth-ip` policy in its metadata (the only check independent of the reflection question). It
   exists because the other two layers leave one hole between them: the global limiter
   no-ops for anonymous traffic and the lockout is keyed per email, so a password spray (one password,
   many emails) from a single source was otherwise unthrottled. Three details are deliberate:
   `RefreshAsync` is **not** throttled (renewal is automatic and periodic, and Blazor Server circuits
   issue it server-side from the UI host's IP); a request with no attributable IP gets `NoLimiter`
   rather than sharing one bucket with every other such request, mirroring the global limiter's
   fail-open posture; and the default is 30 rather than a tighter 10 for the same shared-IP reason,
   since every Server-circuit user's login leaves from the UI host's address.
4. **The remaining named policies are opt-in, per-endpoint tightening.** `AddCommonRateLimiting` also
   registers `FixedPolicy` and `UserPolicy`, which a specific action can apply with
   `[EnableRateLimiting(...)]` when it needs a tighter cap than the global default. Nothing in either
   app applies those two today.
5. **The client IP these partitions key on is whatever the edge forwards, and that is trusted from any
   proxy.** Both IP-keyed decisions above (the `auth-ip` window, and the global limiter's third-choice
   fallback key) read `HttpContext.Connection.RemoteIpAddress`, which `UseForwardedHeaders` has
   already rewritten from `X-Forwarded-For` earlier in the same shared pipeline
   (`UseCommonMiddlewarePipeline` runs forwarded headers before `UseRateLimiter`). That middleware is
   configured to trust **any** proxy: the pipeline clears both `KnownProxies` and `KnownIPNetworks`,
   because cloud reverse proxies (Azure Container Apps, AWS ALB) front the services from internal
   addresses that are not in the default allow-lists, and an unlisted proxy means the headers are
   ignored and every request is attributed to the proxy instead. The decision is to take a
   caller-supplied IP as canonical rather than to run with no usable client IP at all.

## Rationale
- **Limit the traffic that is both attributable and expensive.** An authenticated request is tied to
  a principal and usually drives the database; capping per-principal stops a single account from
  monopolizing a service without punishing the public read path.
- **Do not punish shared-origin anonymous traffic.** With Blazor Server fronting public browsing
  behind one IP, and public reads served from the output cache, an anonymous IP cap would throttle
  legitimate visitors at scale while barely protecting an already-cached backend.
- **Right control per threat.** Brute-force is an auth concern answered by a per-email lockout plus a
  per-IP cap on the two endpoints that carry it; general overload is a per-user request cap;
  infrastructure endpoints must never be throttled. A single global IP bucket conflates all three.

## Trade-offs
- **The global limiter only protects the authenticated surface.** The anonymous surface is covered
  endpoint by endpoint instead: login and register carry the `auth-ip` limiter by default and the
  login-protection service on top of it, and public reads are served from the output cache. An
  uncached anonymous endpoint added later inherits none of that: it has no global cap and must opt
  into a named policy or its own control.
- **The per-IP cap keys on a header a caller can set.** Trusting forwarded headers from any proxy is
  what makes the IP usable at all behind a cloud load balancer, but it makes a spoofable input the
  partition key of a security control. The exposure is bounded rather than absent: `ForwardLimit` is
  left at its default of 1, so only the rightmost `X-Forwarded-For` entry is consumed, and a proxy
  that appends the real client address wins for any traffic that actually traverses it. A caller that
  can reach a service **without** passing through that proxy can name its own IP and mint a fresh
  `auth-ip` bucket per request, leaving the per-email lockout (ADR-029, not IP-keyed) as the control
  still standing in front of a spray. Containing this is a deployment concern, not a limiter one:
  either the gateway is the only reachable ingress, or the allow-lists carry the real proxy ranges.
  Neither is enforced in code today.
- **Per-user partitioning depends on the authenticated principal being populated** when the limiter
  partitions the request, so the limiter's placement relative to authentication in the request
  pipeline is load-bearing: move it and the partition sees a different (or empty) principal.
- **Defaults are deployment-agnostic.** 300 requests/min/user is a coarse backstop, not a tuned SLO;
  a service with heavier legitimate per-user traffic must raise it, and a stricter endpoint must opt
  into a named policy.
- **In-process counters.** Limiter state is per-instance, so across N replicas the effective ceiling
  is roughly N times the configured limit. This is an accepted backstop, not a distributed quota.

## Related
ADR-004 (the JWKS/discovery traffic the limiter exempts, and the authenticated principal it keys on),
ADR-008 (the gateway edge this protects), ADR-017 (request idempotency, the other inbound-edge
safeguard against client retries), ADR-029 (the per-email lockout and registration throttle that sit
on the same two endpoints as the `auth-ip` cap).
