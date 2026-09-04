# ADR-025: Startup Warm-Up and Readiness Gating for Cold-Start Mitigation

## Status
Accepted (2026-06-27). Revised 2026-07-28: `/health/ready` now excludes `optional`-tagged checks as well
as `live`-tagged ones (see Decision), and the absence of a warm-up timeout was recorded as a known gap
(see Trade-offs). Revised 2026-08-01: that gap is closed. Every warm-up task now runs under a
120-second per-task ceiling, so a task that hangs no longer holds the readiness gate closed (see
Decision and Trade-offs). Revised 2026-08-31: the record now covers `SelfHttpWarmupTaskBase`, the shipped
base class for warming a host's own inbound request path, which both production apps subclass (see
Decision). Revised 2026-09-02: readiness checks are recorded as PING-class only, never admin-class, and
the framework owns the Redis registration so that the untagged health check an Aspire client integration
adds cannot reach `/health/ready` (see Context and Decision).

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

A readiness probe also fails for reasons that have nothing to do with a dependency being down, and the
command a check chooses is one of them. Aspire's `AddRedisClient` and `AddRedisDistributedCache`
register the `AspNetCore.HealthChecks.Redis` check under the name `StackExchange.Redis` with no tags at
all, so it is neither `live` nor `optional` and lands in `/health/ready` by construction. Under
StackExchange.Redis 3.x, Azure Managed Redis reports itself as a cluster, so that check issues
`CLUSTER INFO`, and the client refuses the command on a connection that was not opened in admin mode:
readiness fails on every probe against a cache that is answering normally. That failure takes the worst
shape a deployment failure can take. The new Container Apps revision never activates, the previous
revision keeps serving, and the pipeline reports a successful deploy over a revision that never took a
single request.

## Decision
Ship a small warm-up subsystem in `MMCA.Common.Aspire`, wired into `AddServiceDefaults()` so every host
gets it.

- **A readiness gate that starts closed.** `WarmupReadinessGate` (singleton) begins not-ready;
  `WarmupReadinessHealthCheck` is registered tagged `ready` and reports `Unhealthy` until the gate opens.
  `MapDefaultEndpoints()` maps `/health/ready` to every check tagged neither `live` nor `optional`
  (`Source/Hosting/MMCA.Common.Aspire/Extensions.cs:433-436`), so while warm-up is running the replica's
  readiness endpoint reports not-ready and the platform keeps traffic off it. (`/alive` maps only the
  `live`-tagged self check, `Extensions.cs:417-420`, so liveness is unaffected and the container is not
  restarted.) The second exclusion, `optional` (`HealthCheckTags.cs:32`), covers a dependency the app
  degrades gracefully without: a distributed cache sitting behind an in-memory fallback, a broker behind
  a retrying outbox. Those checks are still reported on `/health`, so the degradation stays visible, but
  they do not gate readiness, because making them readiness-fatal converts a partial degradation into a
  total outage (every replica goes unready at once and the app stops serving traffic it could still
  serve). A check is left untagged only when the app genuinely cannot answer correctly without it.
- **Readiness checks are PING-class, never admin-class.** A check that participates in `/health/ready`
  may only issue the cheapest liveness command its dependency offers: a Redis `PING`, a trivial
  `SELECT 1`. It may never issue a command that needs elevated permissions or cluster topology (Redis
  `CLUSTER INFO` or `CLUSTER NODES`, anything that requires admin mode), because such a command reports
  the caller's privileges as much as the dependency's health, and a probe cannot tell those two answers
  apart. So MMCA.Common owns the Redis registration for hosts rather than leaving it to each host:
  `AddRedisCaching` in `MMCA.Common.Aspire` registers the client and the distributed cache with the
  health checks that the Aspire client integrations add automatically switched off, because those
  arrive untagged and therefore gate readiness, and the framework registers its own `redis` check in
  their place, tagged `optional` and performing a `PING` only
  (`Source/Hosting/MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:57` and `Source/Hosting/MMCA.Common.Aspire/Health/RedisPingHealthCheck.cs:26`). A host that reaches for an Aspire client
  integration directly puts the untagged check back and defeats both rules at once.
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
- **A shipped base class for warming the host's own request path.** `SelfHttpWarmupTaskBase`
  (`Source/Hosting/MMCA.Common.Aspire/Warmup/SelfHttpWarmupTaskBase.cs:28`, public API at
  `Source/Hosting/MMCA.Common.Aspire/PublicAPI.Shipped.txt:91-93`) is the second warm-up family: where the
  OIDC task warms one outbound connection, this replays a short list of hot read paths against the host's
  own Kestrel endpoint, so the cost paid down is the full inbound path (ingress connection, Kestrel,
  output cache, routing, authentication, handler, EF Core, SQL) rather than a single dependency
  (`:11-22`). A derived task supplies only a name and its `WarmupPaths` (`:49`, `:59`); the mechanism is
  in the base. It waits for `ApplicationStarted` before self-requesting, because the warm-up runner starts
  before Kestrel is listening (`:189-199`, awaited at `:102`), and it resolves the actual bound cleartext
  address from `IServer`, falling back to `ASPNETCORE_URLS` and then to port 8080 (`:157-166`, `:39`),
  which is the only correct answer under Aspire's dynamic ports. Requests are pinned to HTTP/2 with
  `RequestVersionExact` by default (`:70`, `:77`) because a host serving h2c-only cleartext endpoints
  rejects a silent downgrade to HTTP/1.1, which would fail the warm-up on every startup; a host that stays
  Http1AndHttp2 overrides both members. `RequireSuccessStatusCode` defaults to true but is overridable to
  false (`:90`), so a self-request against an `[Authorize]` route counts as warmed: the 401 is by design
  and the refusal still traverses the whole pipeline. The task no-ops under the `Testing` environment
  (`:46`, `:95-98`), whose in-memory `TestServer` never opens a socket. Failures follow the same rule as
  the rest of the subsystem: caught, logged at warning level, never fatal (`:141-146`, `:205-207`). Both
  production apps subclass and register it: ADC in Conference
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:22`, registered
  at `Program.cs:257`), Engagement (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/SelfHttpWarmupTask.cs:23`,
  `Program.cs:158`) and Identity (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/SelfHttpWarmupTask.cs:23`,
  `Program.cs:169`); Store in Catalog
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/SelfHttpOutputCacheWarmupTask.cs:23`,
  `Program.cs:163`), Identity (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/SelfHttpOutputCacheWarmupTask.cs:25`,
  `Program.cs:144`) and Sales (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/SelfHttpOutputCacheWarmupTask.cs:26`,
  `Program.cs:158`).
- **Extensible per host.** `AddWarmupReadiness()` registers the gate, the runner, the readiness health
  check, and the built-in OIDC task; a host adds its own pre-fetches (output cache, reference data) with
  `AddWarmupTask<T>()`, which is also how a `SelfHttpWarmupTaskBase` subclass enters the run.

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
- **A readiness probe answers one question.** Can this replica serve a request? A cluster-topology or
  admin-mode command answers a different one, and it answers it wrongly whenever the connection is not
  privileged, so it can only ever add false negatives to a gate whose false negatives take a replica out
  of rotation. Holding readiness checks to PING-class commands, and owning the registration in the
  framework so a host cannot inherit an untagged one by accident, keeps the gate measuring reachability.
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
  (`Extensions.cs:61`, `HttpResilienceDefaults.cs:19`), so a host-registered task doing non-HTTP work,
  which previously had no bound at all, now inherits the same backstop. Two costs follow. A replica whose
  warm-up hangs stays out of rotation for the full two minutes before it is admitted, so the ceiling
  bounds the damage rather than making it cheap. And `WaitAsync` abandons rather than cancels, so the
  stuck task keeps running detached for the life of the host; the only token that can stop it is still the
  host's `stoppingToken` at shutdown.
- **The gate does not surface a broken dependency.** Since it opens regardless, a persistently failing
  warm-up task is visible only in logs and (for dependencies that have their own health checks) through
  the separate untagged readiness checks, not through the warm-up gate itself.
- **A PING-class check is a shallow check.** `PING` proves the connection is open and the server is
  answering; it does not prove the cache can serve the key sizes or the throughput the app needs. That
  is the trade the rule accepts: a readiness gate reports reachability, and deeper dependency assertions
  belong on `/health` where they can be observed without taking a replica out of rotation.
- **Framework-owned registration costs a hop of indirection.** A host that wants an Aspire Redis client
  option the framework does not surface has to go through `AddRedisCaching` (or extend it) rather than
  calling the client integration directly, since calling it directly is what re-introduces the untagged
  check.
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
this gate drives), ADR-026 (the two-tier caching strategy whose Redis substrate the framework-owned
registration and the `optional`-tagged `PING` check belong to).
