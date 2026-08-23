# ADR-088: Gateway Edge Responsibilities (and the Three It Declines)

## Status
Accepted (2026-08-18). **Extends [ADR-019](019-rate-limiting.md)** with a fourth, edge-tier layer whose
posture is the deliberate opposite of the service tier's authenticated-only global limiter; nothing in
ADR-019's three service-tier layers changes. It also extends
[ADR-041](041-observability-and-telemetry.md)'s correlation id one hop outward, to the process that
sees a request first and its response last. [ADR-004](004-authentication-dual-fetch.md)'s validation
authority is **unchanged on purpose**: the gateway does not validate tokens, recorded below as a
rejection with a named trigger rather than as an omission. The framework half shipped in v1.154.0
(`MMCA.Common/CHANGELOG.md`) and both consumer gateways were wired to it in the same wave, so the
adoption statements below describe what each gateway does today.

## Context
[ADR-008](008-service-extraction-topology.md) made the Gateway the only client entry point and gave it
three jobs: the route-to-service map, CORS, and forwarding the caller's `Authorization` header. Nothing
was added to it since. Meanwhile the service tier accumulated a standardized cross-cutting pipeline
(correlation id, rate limiting, forwarded headers, tenant resolution, output cache) that
[ADR-079](079-shared-http-middleware-pipeline.md) fixed into one ordered method, and that record
scopes the gateways **out** of it deliberately: a reverse proxy has no controllers, no localization and
no tenant context, so composing the service chain there would be wrong.

Scoping the gateways out was right, and it left a real gap, because three of those behaviors are not
service concerns at all. They are edge concerns the service tier had been performing one hop too late.
Before this record the gateway chains were four calls long and contained none of them: ADC registered
security headers, default endpoints, CORS, static files and a privacy endpoint around its forwarders
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:77`, `:117`, `:119`, `:120`, `:129`, `:134-135`),
and Store registered security headers, default endpoints and CORS
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:58`, `:64`, `:140`, `:142`, `:143`). Neither
had a rate limiter or a correlation id of any kind.

**A correlation id minted per service is not a correlation id.** `CorrelationIdMiddleware` (ADR-041)
runs inside each service host and falls back to the W3C trace id when the client sends no
`X-Correlation-ID`. A browser call crossing the Gateway into two services therefore produced two
independent ids, neither present in the Gateway's own logs, and an operator holding the id from one
service could not find the request's first hop. The one process guaranteed to see every request
exactly once was the only one not stamping it.

**ADR-019's anonymous exemption is correct one hop in and wrong at the edge.** That record exempts
anonymous traffic from the global limiter for two stated reasons: Blazor Server fronts public browsing
behind a single IP, so an anonymous IP cap would throttle real visitors, and public reads are served
from the output cache anyway, so the backend they reach is already cheap. Both are properties of a
service sitting *behind* the Gateway. At the edge neither holds. The output cache that made an
anonymous read cheap lives behind the proxy, so a flood is paid for in full by the Gateway (accept,
route, forward, copy the response) before anything can be served from cache, and the fleet's only
shared choke point had no cap at all on the traffic class that most needs one.

**A gateway that is "healthy" while every downstream is unreachable still receives traffic.** The
Gateway's readiness endpoint reported only that the Gateway process was up. Azure Container Apps then
routed to it and it forwarded to services that were not answering, converting a downstream outage into
a wall of 502s from a replica the platform believed was ready.

One packaging constraint shapes where the fix can live. A YARP host references `MMCA.Common.Aspire` and
nothing else in the framework: it has no controllers, so it does not take `MMCA.Common.API`, where
`CorrelationIdMiddleware` and `AddCommonRateLimiting` live. Anything the edge owns has to be reachable
from the Aspire package alone.

## Decision
Ship a **gateway edge kit** in a `Gateway` namespace inside `MMCA.Common.Aspire`, owning exactly three
responsibilities, and record three more as deliberately declined.

### What the edge owns

**1. Correlation is ensured, not merely read.** `GatewayCorrelationMiddleware`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayCorrelationMiddleware.cs`) declares
`X-Correlation-ID` as a constant (`:34`), and when the header is absent it mints one from
`Activity.Current?.TraceId`, falling back to `HttpContext.TraceIdentifier` (`:48-55`), the same
precedence ADR-041's service middleware uses. The mechanism that makes it *one* id is that the value is
written back onto the **request** headers before forwarding: the downstream service's own middleware
then finds a header already present and adopts it instead of minting its own. The response echo is
registered through `Response.OnStarting` (`:58-62`), and the registration extension is
`UseGatewayCorrelation()` (`:82`).

The middleware is **context-free**, and that is a constraint rather than an accident of scope. Its only
constructor dependency is the `RequestDelegate` (`:27`): no `HttpContext.Items`, no logger, no scoped
service. The service-tier version sets a scoped `ICorrelationContext` that the CQRS logging decorators
read, and the Aspire package cannot reference the Application layer that declares that abstraction. The
edge version is therefore a deliberately smaller thing than its namesake, not a copy of it, and it
composes with a host that has no DI graph beyond YARP.

**2. Rate limiting at the edge counts anonymous callers, and chains a global concurrency cap behind
it.** `AddGatewayRateLimiting` installs a per-client-IP fixed window partitioned on
`Connection.RemoteIpAddress` with **no authentication exemption of any kind**
(`.../Gateway/GatewayRateLimitingExtensions.cs:90`, limiter at `:98`), chained through
`PartitionedRateLimiter.CreateChained` (`:181`) with a process-wide concurrency limiter (`:124-125`),
rejecting overage with 429 (`:176`). The two answer different failures: the window answers one noisy
source, and the concurrency cap answers total in-flight work regardless of how many sources produced
it, which is the failure a per-IP window structurally cannot see. Defaults live in
`GatewayRateLimitingSettings` (section `"GatewayRateLimiting"`,
`.../Gateway/GatewayRateLimitingSettings.cs:42`): `PermitLimit` 120 (`:51`) per `WindowSeconds` 60
(`:55`), `GlobalConcurrencyLimit` 200 (`:65`).

**The settings are validated twice, because there are two ways in.** The configuration overload binds
through `AddOptions().Bind(section).ValidateDataAnnotations().ValidateOnStart()`
(`GatewayRateLimitingExtensions.cs:148-151`), so a host with an out-of-range value refuses to boot,
which is [ADR-070](070-fail-fast-configuration-contract.md)'s contract exactly. That alone would not be
enough here: the limiter closes over an eagerly-bound copy rather than resolving `IOptions` per
request, and a caller can hand settings straight to the object overload without passing through the
options pipeline at all. So the overload every path funnels into runs
`Validator.ValidateObject(settings, ..., validateAllProperties: true)` at registration (`:172`, with
the reasoning stated inline at `:169-171`). The `[Range]` bounds on the three numeric settings
(`GatewayRateLimitingSettings.cs:50`, `:54`, `:64`) are therefore load-bearing on both paths: an
invalid `PermitLimit` throws where it is configured, not at the first throttled request.

Bypasses are two-tier, and the tiers are different kinds of thing. **Infrastructure bypasses are
unconditional**: `/health`, `/alive` and `/.well-known` are hard-coded
(`GatewayRateLimitingExtensions.cs:47`, matched by path segment, case-insensitively, `:64`), because
throttling them takes down probes and token validation (ADR-004's JWKS discovery) as a side effect of
throttling traffic. **Application bypasses are configuration**, through `BypassPathPrefixes`
(`GatewayRateLimitingSettings.cs:74`, empty by default), and each consumer sets its own list in the
gateway's `appsettings.json` beside the `ReverseProxy` route table that same file now declares
([ADR-089](089-gateway-topology-owned-by-configuration.md)). The two entries are recorded here so they
are not rediscovered as incidents: Store's Stripe webhook route (`/Payments/{**catch-all}`, bypassed
by the `"/Payments"` prefix at
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:17`, route at `:57-60`), because a 429
to Stripe is a retry and eventually a disabled endpoint, which silently stops every payment update
([ADR-084](084-stripe-webhook-ingress.md)); and ADC's SignalR hub route (`/hubs/{**catch-all}`,
bypassed by the `"/hubs"` prefix at
`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:18`, route at `:126-129`), because a
negotiate-plus-reconnect storm from one office's shared address is exactly the pattern a per-IP window
misreads as abuse ([ADR-039](039-live-channel-push.md)).

**A request with no attributable client IP is not limited.** It gets
`RateLimitPartition.GetNoLimiter` (`GatewayRateLimitingExtensions.cs:90-95`) rather than sharing one
bucket with every other unattributable request, which is the same fail-open posture ADR-019 chose for
`auth-ip` and for the global limiter's fallback key, for the same reason: a shared "unknown" bucket is
a single tripwire that one misbehaving caller pulls for everyone behind it.

**3. Readiness reflects the downstreams; liveness does not.**
`AddGatewayDownstreamHealthChecks(params string[] serviceNames)`
(`.../Gateway/GatewayHealthCheckExtensions.cs:75`) registers one check per named downstream with an
`HttpClient` whose `BaseAddress` is the Aspire service-discovery name `http://{name}` (`:93-100`),
deduplicated through a registry so a repeated name cannot double-probe (`:80-88`, `:124-171`). Each
check probes `/alive` (`DownstreamServiceHealthCheck.cs:31`) under a 2 second budget applied at both
the client and the registration (`:29`, `GatewayHealthCheckExtensions.cs:99`, `:110`), reports
`Unhealthy` on failure (`:108`) and carries the `Ready` tag (`:109`).

The tag is the whole design. The Aspire defaults map `/alive` to checks tagged `Live`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:342-345`) and `/health/ready` to
everything not tagged `Live` or `Optional` (`:358-361`), so a `Ready`-tagged downstream check reaches
readiness and never reaches liveness. Liveness must stay process-local, or a downstream outage restarts
a perfectly healthy Gateway and makes the outage worse. `/alive` answers "is this process wedged",
`/health/ready` answers "can this process do useful work", and only the second depends on anything
else. That is [ADR-025](025-startup-warmup-readiness.md)'s split, applied to a dependency rather than
to a startup task.

### What the edge declines

**Edge JWT pre-validation is deferred, and the deferral is the decision.** The obvious next move is to
validate the bearer token at the Gateway and reject an invalid one before it costs a forward. It is not
being made. [ADR-004](004-authentication-dual-fetch.md) puts validation authority in the services, and
a second validator does not add a check, it adds a second truth: two processes reading two JWKS caches
can disagree across a key rotation, and the one that rejects is the one the caller sees. The Gateway
would also acquire issuer and JWKS configuration it does not have today, making an Identity outage a
Gateway outage, and it would have to decide what to do about ADR-022's cookie-carried browser sessions,
which are not bearer tokens at all. The saving is one forward of a request the service was going to
reject in microseconds anyway.

The trigger to revisit is measured rather than felt: when invalid-or-absent-token traffic becomes a
material share of forwarded volume (visible in the edge limiter and downstream signals this record
adds), pre-validation becomes a cost argument instead of a correctness argument and can be taken then,
with the services **still** validating.

**The limiter is in-memory, per replica.** No Redis, no shared counter, and the type documents itself
that way (`GatewayRateLimitingSettings.cs:10-21`). With N Gateway replicas the effective ceiling is N
times `PermitLimit`, the same multiplication ADR-019 records for its own per-process limiters and only
partly retired there with its Redis option. It is accepted here rather than solved: the edge limiter
exists to bound a flood, not to meter a quota, and an approximate ceiling that needs no network call
and cannot fail is the right shape for the one process the whole fleet sits behind.

**The kit adds no authorization, no request rewriting and no response shaping.** Everything that
depends on knowing who the caller is or what the payload means stays behind the proxy, which is what
keeps the Gateway a transport concern and keeps ADR-008's extraction reversible.

## Rationale
- **The edge is the only place that sees a request exactly once.** That is what makes ensure-at-the-edge
  correct and mint-per-service wrong: not that the service version is broken, but that it runs after
  the point where uniqueness is free.
- **The two rate-limit postures differ because the traffic differs, not because one is a mistake.**
  ADR-019 measured its exemption against a backend fronted by an output cache and a Blazor Server
  circuit. The Gateway pays for anonymous traffic before either can help. Stating both postures
  together is what keeps the second from reading as a contradiction of the first.
- **A chained concurrency limiter answers the failure a window cannot.** A per-IP window is blind to
  ten thousand distinct addresses each behaving politely; a concurrency cap is blind to one address
  being rude but never lets in-flight work exceed what the process can carry. Neither alone bounds the
  Gateway's load.
- **Bypasses are split by kind because they fail differently.** A throttled health probe or JWKS fetch
  is an immediate self-inflicted outage, so it is not a setting. A throttled webhook or hub is
  application-specific and its correct list differs per app, so it is.
- **`Ready` and not `Live` keeps a dependency failure from becoming a restart loop.** Wiring downstream
  probes into liveness is the classic version of this mistake, and it turns a recoverable downstream
  blip into a fleet-wide restart at the worst moment.
- **Declining JWT validation is a real decision with a cost.** It is recorded because the alternative
  is that someone reads the edge kit, notices the obvious missing piece, and adds it without knowing
  ADR-004 already placed the authority elsewhere.

## Trade-offs
- **The limiter closes over an eagerly-bound copy of the settings**
  (`GatewayRateLimitingExtensions.cs:154`, consumed at `:164-172`), so an `IOptionsMonitor` reload
  never reaches it. Validation is not the gap (both paths validate, see the Decision), but liveness of
  the value is: changing a limit is a restart, not a config push, which is the opposite of what "it is
  a configuration section" usually implies. The double validation is itself a consequence of that
  shape rather than belt-and-braces, so the two must stay in step: a future change that made the
  limiter resolve `IOptions` per request would make the registration-time check redundant, and one
  that added a third construction path would need to route through the same overload to keep it.
- **Per-replica limits mean the configured number is not the enforced number.** An operator reading
  `PermitLimit` 120 sees a per-replica figure; the fleet ceiling depends on how many Gateway replicas
  are running at that instant, so it rises exactly when the load that motivated it arrives.
- **Fail-open on an unknown IP is a hole with a name.** A caller who can arrive without an attributable
  address is unlimited at the edge. The alternative (one shared bucket) is worse, and this is still a
  hole.
- **`BypassPathPrefixes` is a prefix match, so it is only as precise as the value given.** A broad
  prefix exempts more than intended and nothing warns; the two entries named above are narrow, and a
  third added carelessly is an unlimited path through the only choke point.
- **Downstream health checks add fan-out and an all-or-nothing readiness.** Every Gateway replica
  probes every named downstream on the health interval, and a slow-but-alive service can exceed the 2
  second budget and mark the Gateway not-ready while it is still perfectly able to serve every other
  service's routes.
- **Two correlation middlewares now exist with one header name written twice.** The gateway type and
  the API type are separate, in separate packages, each declaring the literal. A rename in one is a
  silent break, the same duplicated-literal cost ADR-041 already records for the meter names in this
  same Aspire package.
- **Nothing gates adoption.** A gateway that never calls the three registrations behaves exactly as
  before, and no fitness function names a gateway host. Both consumer gateways do call all three
  today (ADC `Program.cs:65`, `:71`, `:112`; Store `Program.cs:74`, `:79`, `:136`), but that is a
  wiring habit rather than an enforced invariant, which is the audit-the-inventory caveat ADR-005 and
  ADR-017 both record, now applied to the edge.

## Related
[ADR-008](008-service-extraction-topology.md) (the record that made the Gateway the only entry point
and gave it routing, CORS and auth forwarding; this is the first record to add cross-cutting behavior
to it), [ADR-019](019-rate-limiting.md) (the three service-tier limiter layers this adds a fourth,
edge-tier layer beside, and whose anonymous exemption the edge deliberately inverts),
[ADR-079](079-shared-http-middleware-pipeline.md) (the shared service pipeline the gateways sit outside
of, which is what left these three behaviors unowned),
[ADR-041](041-observability-and-telemetry.md) (the correlation id extended one hop outward, and the
duplicated-literal cost the second header-name declaration repeats),
[ADR-004](004-authentication-dual-fetch.md) (the validation authority the edge declines to duplicate,
and the JWKS discovery path the unconditional bypass protects),
[ADR-025](025-startup-warmup-readiness.md) (the readiness model these downstream checks join, including
why liveness stays process-local),
[ADR-070](070-fail-fast-configuration-contract.md) (the fail-fast contract this kit's settings honor on
both construction paths, the options pipeline and the registration-time check the closed-over copy
requires),
[ADR-084](084-stripe-webhook-ingress.md) and [ADR-039](039-live-channel-push.md) (the two traffic
shapes the configurable bypass list exists for),
[ADR-089](089-gateway-topology-owned-by-configuration.md) (the other half of this wave: what the
Gateway routes, as opposed to what it does to a request on the way through).
