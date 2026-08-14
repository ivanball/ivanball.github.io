# ADR-025: Startup Warm-Up and Readiness Gating for Cold-Start Mitigation

## Status
Accepted (2026-06-27). Revised 2026-07-28: `/health/ready` now excludes `optional`-tagged checks as well
as `live`-tagged ones (see Decision), and the absence of a warm-up timeout was recorded as a known gap
(see Trade-offs). Revised 2026-08-01: that gap is closed. Every warm-up task now runs under a
120-second per-task ceiling, so a task that hangs no longer holds the readiness gate closed (see
Decision and Trade-offs).

## Context
On the Azure Container Apps Consumption plan a replica that has been idle is CPU-throttled, and a
scale-from-zero or scaled-out replica starts cold. The first authenticated request on such a replica
pays costs that a warm replica does not: DNS resolution, TCP and TLS handshakes, the HTTP connection
pool warm-up, and the lazy fetch of the OIDC discovery document by the JwtBearer middleware. That fetch
can stretch past the client timeout, which is the textbook "first request fails, second succeeds"
symptom. The platform also routes traffic to a replica as soon as its readiness probe passes, so a
replica that is technically started but not yet warm gets live traffic it cannot serve cleanly. We need
a way to (a) pre-warm the expensive paths before the replica takes traffic and (b) hold the replica out
of rotation until that warm-up has had its chance, without letting a single stuck dependency keep a
replica permanently out of service.

## Decision
Ship a small warm-up subsystem in `MMCA.Common.Aspire`, wired into `AddServiceDefaults()` so every host
gets it.

- **A readiness gate that starts closed.** `WarmupReadinessGate` (singleton) begins not-ready;
  `WarmupReadinessHealthCheck` is registered tagged `ready` and reports `Unhealthy` until the gate opens.
  `MapDefaultEndpoints()` maps `/health/ready` to every check tagged neither `live` nor `optional`
  (`Source/Hosting/MMCA.Common.Aspire/Extensions.cs:351`), so while warm-up is running the replica's
  readiness endpoint reports not-ready and the platform keeps traffic off it. (`/alive` maps only the
  `live`-tagged self check, `Extensions.cs:335`, so liveness is unaffected and the container is not
  restarted.) The second exclusion, `optional` (`HealthCheckTags.cs:32`), covers a dependency the app
  degrades gracefully without: a distributed cache sitting behind an in-memory fallback, a broker behind
  a retrying outbox. Those checks are still reported on `/health`, so the degradation stays visible, but
  they do not gate readiness, because making them readiness-fatal converts a partial degradation into a
  total outage (every replica goes unready at once and the app stops serving traffic it could still
  serve). A check is left untagged only when the app genuinely cannot answer correctly without it.
- **A background runner that opens the gate once warm-up has had its chance.** `WarmupHostedService`
  runs every registered `IWarmupTask` exactly once, in parallel, then opens the gate. Critically the gate
  is opened in a `finally`, so it **opens even if tasks fail**: a stuck dependency must not keep a replica
  out of rotation forever. Each task additionally runs under a 120-second ceiling (`TaskTimeoutSeconds`,
  `Source/Hosting/MMCA.Common.Aspire/Warmup/WarmupHostedService.cs:42`, applied per task as
  `.WaitAsync(_taskTimeout, _timeProvider, cancellationToken)` at `:69`), so a task that neither completes
  nor throws cannot hold the gate closed either.
- **Per-task failure is logged, not fatal, and falls back to lazy retry.** Each task runs in isolation; a
  thrown task is caught and logged at warning level ("will retry lazily on first use"), so the missed
  warm-up simply happens on the first real request (absorbed by the Polly pipeline, ADR-009). A task that
  trips the 120-second ceiling takes the same route: the `TimeoutException` is caught and logged at
  warning level (`WarmupHostedService.cs:77-82`, `:103-105`), the abandoned task keeps running detached,
  and the dependency is retried lazily on first use. The one exception that is rethrown is an
  `OperationCanceledException` during host shutdown, so stopping the host is not mistaken for a task
  failure.
- **A built-in task that pre-warms OIDC discovery.** `OpenIdConnectMetadataWarmupTask` fetches
  `{Authority}/.well-known/openid-configuration` over the shared `IHttpClientFactory`, warming DNS, TCP,
  TLS, and the connection pool (and the authority's own discovery cache). It no-ops when no
  `Authentication:JwtBearer:Authority` is configured. The JwtBearer middleware caches discovery
  separately, so its own first fetch still runs; the intent recorded on the task itself
  (`Source/Hosting/MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:14-20`) is that over a
  now-warm connection that fetch completes in single-digit milliseconds.
- **Extensible per host.** `AddWarmupReadiness()` registers the gate, the runner, the readiness health
  check, and the built-in OIDC task; a host adds its own pre-fetches (output cache, reference data) with
  `AddWarmupTask<T>()`.

## Rationale
- **Keep cold replicas out of rotation, briefly.** Gating readiness on warm-up means the platform does
  not send a user request to a replica that is still doing its first handshakes, which is what turns a
  cold start into a visible 5xx.
- **Availability over strict warmth.** Opening the gate even when a task fails or hangs is the
  load-bearing choice: a warm-up that depends on a temporarily unreachable dependency would otherwise pin
  the replica out of service indefinitely. Falling back to lazy retry (covered by the resilience
  pipeline) trades a possibly-slow first request for guaranteed eventual availability.
- **Warm the path, not just the cache.** The OIDC fetch is the specific cold-start failure we saw; even
  though the middleware re-fetches, warming the network path removes the timeout-sized first hit. This is
  the active half of the same cold-start story ADR-004 references from the auth side.
- **Free for every host, cheap for the ones that do not need it.** Putting it in `AddServiceDefaults`
  makes it the default posture; the built-in task self-disables when there is no authority, so a host
  without JwtBearer pays nothing.

## Trade-offs
- **A replica can enter rotation not fully warm.** The gate is opened in a `finally` once the
  `Task.WhenAll` over every registered task returns, that is, once each task has completed, thrown, or
  timed out (`Source/Hosting/MMCA.Common.Aspire/Warmup/WarmupHostedService.cs:53`, `:58`); a thrown or
  timed-out task is caught and logged rather than retried, so a failed warm-up still admits the replica
  and its first request pays the lazy cost. The resilience pipeline mitigates this but does not eliminate
  it. This is deliberate (availability over warmth) but means the gate is a best-effort warm-up signal,
  not a guarantee.
- **The per-task ceiling is a backstop, not a latency budget.** The gap recorded on 2026-07-28 (an
  unbounded `Task.WhenAll` with no per-task deadline anywhere in the subsystem, so a task that HANGS held
  the readiness gate closed for as long as the host ran) is closed: every task runs under a 120-second
  ceiling (`WarmupHostedService.cs:42`, applied at `:69`), and a task that trips it surfaces as a
  `TimeoutException`, is logged, and lets the gate open (`:77-82`). The number deliberately sits above the
  90-second shared Polly total-request timeout that already bounds the built-in OIDC task's HTTP call
  (`Extensions.cs:62`, `HttpResilienceDefaults.cs:19`), so a host-registered task doing non-HTTP work,
  which previously had no bound at all, now inherits the same backstop. Two costs follow. A replica whose
  warm-up hangs stays out of rotation for the full two minutes before it is admitted, so the ceiling
  bounds the damage rather than making it cheap. And `WaitAsync` abandons rather than cancels, so the
  stuck task keeps running detached for the life of the host; the only token that can stop it is still the
  host's `stoppingToken` at shutdown.
- **The gate does not surface a broken dependency.** Since it opens regardless, a persistently failing
  warm-up task is visible only in logs and (for dependencies that have their own health checks) through
  the separate untagged readiness checks, not through the warm-up gate itself.
- **Startup work on every host.** Every host runs the warm-up runner and the built-in task even if the
  benefit is marginal (the task no-ops without an authority, but the hosted service and gate still spin
  up).
- **Middleware cache is separate.** The warm-up warms the connection, not the JwtBearer
  `ConfigurationManager`'s discovery cache, so the very first authenticated request still triggers the
  middleware's own fetch; the optimization is on the network path, not on eliminating the fetch. That the
  remaining fetch is fast is the task's documented intent
  (`Source/Hosting/MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:14-20`), not a figure
  measured or gated anywhere in the repo.

## Related
ADR-004 (the OIDC discovery document the built-in task pre-fetches, and the auth-side view of the same
cold-start), ADR-009 (the Polly resilience pipeline that absorbs the lazy retry when the gate opens
before a task succeeds), ADR-019 (the rate limiter that exempts `/health` and `/alive`, the endpoints
this gate drives).
