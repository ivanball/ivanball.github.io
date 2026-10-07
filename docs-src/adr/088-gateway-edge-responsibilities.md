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

**Revised 2026-08-27 (v1.163.0):** the framework now ships a **dedicated gateway package**,
`MMCA.Common.Gateway`, beside the `MMCA.Common.Aspire` edge kit this record originally described.
Three things change below: the one-package constraint in the Context is retired, a composition entry
point (`AddMmcaGateway`) joins the Decision, and the declines gain a companion list of
**delegations**, behaviors the gateway deliberately leaves to a layer better placed to perform them,
recorded so an audit reads them as decisions rather than as gaps. Both consumer gateways reference
the package in package mode (`MMCA.ADC/Directory.Packages.props:125`,
`MMCA.Store/Directory.Packages.props:14`).

**Revised 2026-08-31:** both consumers pin `MMCA.Common.Gateway` in lockstep with the rest of the
framework rather than on a version of its own (1.185.0 today, at the two lines cited above), and the
source citations below are refreshed against current line numbers. Nothing in the decision changes.

**Revised 2026-09-03:** the citations are refreshed again: the rate-limiting kit's anchors all moved
when the synthetic-traffic bypass tier (the 2026-09-01 amendment below) landed in the same two
files. Nothing in the decision changes.
Revised 2026-09-07 (health endpoints serve a cached report with single flight while keeping their
rate-limit bypass, and edge-shaped controls are no longer gateway-only: Store's storefront host
carries its own limiter and a circuit cap).

**Revised 2026-09-11:** the bypass tiers are **four**, not three. The 2026-09-07 security review added
a trusted-internal-caller exemption beside the synthetic-traffic one, recorded as a second amendment
below. Every rate-limiting citation is refreshed against current line numbers, which moved when that
code landed. Nothing else in the decision changes.

**Revised 2026-09-19:** both consumers pinned `MMCA.Common.Gateway` at 1.205.0 on that date, still in
lockstep with the rest of the framework rather than on a version of its own; the current pin is
1.232.0 in both (`MMCA.ADC/Directory.Packages.props:125`, `MMCA.Store/Directory.Packages.props:14`),
and the 1.185.0 figure above is the 2026-08-31 snapshot. Nothing in the decision changes.

**Revised 2026-09-25:** the bearer-delegation paragraph now records the one edge-authorization
difference between the two gateways: ADC's host evaluates the `anonymous` policy each route declares
through an authorization middleware pair, while Store's routes declare the same policy and its host
registers no authorization middleware, by design. Neither authenticates anyone. The ADC gateway
citations in the load-balancing delegation and the adoption trade-off are refreshed against current
line numbers. Nothing in the decision changes.

**Revised 2026-10-01:** both consumers now turn active destination probing off; see the Revision (2026-10-01) below.

Revised 2026-10-06: the edge correlation middleware now sanitizes a caller-supplied id, the gateway config filters are recorded as fixed for the process lifetime, and the citations are refreshed; see the Revision (2026-10-06) below.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release; see the Revision (2026-10-07) below.

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
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:58`, `:64`, `:140`, `:142`, `:143`; both sets
of line numbers are as of the original 2026-08-18 record, before the edge kit landed). Neither
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

One packaging constraint shapes where the fix can live. A YARP host has no controllers, so it does not
take `MMCA.Common.API`, where `CorrelationIdMiddleware` and `AddCommonRateLimiting` live. At the time
of writing it referenced `MMCA.Common.Aspire` and nothing else in the framework, so anything the edge
owned had to be reachable from the Aspire package alone.

**That constraint is retired (2026-08-27).** A gateway host now takes two framework packages,
`MMCA.Common.Aspire` for the host-level kit above and `MMCA.Common.Gateway` for the YARP-level
composition below (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/MMCA.ADC.Gateway.csproj:3-4`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/MMCA.Store.Gateway.csproj:25-26`). The split is along a
real boundary rather than a packaging convenience: the Aspire kit registers **host** middleware and
health checks that any ASP.NET Core process could use, while the Gateway package registers YARP's own
extension points (config filters, transforms, per-route limiter policies) and therefore has to
reference YARP, which a service host has no reason to carry. The Gateway package also carries one
piece of host middleware, `UseCommonForwardedHeaders()`
(`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/ForwardedHeadersExtensions.cs:36`), which both
gateway hosts call first so the per-client-IP window sees the real caller behind the ingress
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:160`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:150`).

## Decision
Ship a **gateway edge kit** in a `Gateway` namespace inside `MMCA.Common.Aspire`, owning exactly three
responsibilities, and record three more as deliberately declined. A fourth section, added 2026-08-27
with the `MMCA.Common.Gateway` package, records what the edge **delegates**: behaviors it does not
perform because another layer already performs them better, which is a different statement from
declining to own a behavior nobody performs.

### What the edge owns

**1. Correlation is ensured, not merely read.** `GatewayCorrelationMiddleware`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayCorrelationMiddleware.cs`) declares
`X-Correlation-ID` as a constant (`:36`). A caller-supplied value is not trusted as sent: `Sanitize`
(`:87-91`) cuts it to `MaxLength` 64 characters (`:43`) and discards it when it cannot be echoed
safely, mirroring the service middleware's own rule. When the header is absent or discarded the
middleware mints one from `Activity.Current?.TraceId`, falling back to `HttpContext.TraceIdentifier`
(`:62-64`), the same precedence ADR-041's service middleware uses. The mechanism that makes it *one*
id is that the value is written back onto the **request** headers before forwarding whenever it
differs from what arrived (`:66-69`): the downstream service's own middleware then finds a header
already present and adopts it instead of minting its own. The response echo is registered through
`Response.OnStarting` (`:72-76`), and the registration extension is `UseGatewayCorrelation()`
(`:108`).

The middleware is **context-free**, and that is a constraint rather than an accident of scope. Its only
constructor dependency is the `RequestDelegate` (`:29`): no `HttpContext.Items`, no logger, no scoped
service. The service-tier version sets a scoped `ICorrelationContext` that the CQRS logging decorators
read, and the Aspire package cannot reference the Application layer that declares that abstraction. The
edge version is therefore a deliberately smaller thing than its namesake, not a copy of it, and it
composes with a host that has no DI graph beyond YARP.

**2. Rate limiting at the edge counts anonymous callers, and chains a global concurrency cap behind
it.** `AddGatewayRateLimiting` installs a per-client-IP fixed window partitioned on
`Connection.RemoteIpAddress` with **no authentication exemption of any kind**
(`ClientIpPartition`, `.../Gateway/GatewayRateLimitingExtensions.cs:195`, the address read at `:215`,
limiter at `:223`), chained through `PartitionedRateLimiter.CreateChained` (`:306`) with a
process-wide concurrency limiter (`ConcurrencyPartition`, `:241-256`, the limiter at `:250`),
rejecting overage with 429 (`:301`). The two answer different failures: the window answers one noisy
source, and the concurrency cap answers total in-flight work regardless of how many sources produced
it, which is the failure a per-IP window structurally cannot see. Defaults live in
`GatewayRateLimitingSettings` (section `"GatewayRateLimiting"`,
`.../Gateway/GatewayRateLimitingSettings.cs:51`): `PermitLimit` 120 (`:60`) per `WindowSeconds` 60
(`:64`), `GlobalConcurrencyLimit` 200 (`:74`).

**The settings are validated twice, because there are two ways in.** The configuration overload binds
through `AddOptions().Bind(section).ValidateDataAnnotations().ValidateOnStart()`
(`GatewayRateLimitingExtensions.cs:273-276`), so a host with an out-of-range value refuses to boot,
which is [ADR-070](070-fail-fast-configuration-contract.md)'s contract exactly. That alone would not be
enough here: the limiter closes over an eagerly-bound copy rather than resolving `IOptions` per
request, and a caller can hand settings straight to the object overload without passing through the
options pipeline at all. So the overload every path funnels into runs
`Validator.ValidateObject(settings, ..., validateAllProperties: true)` at registration (`:297`, with
the reasoning stated inline at `:294-296`). The `[Range]` bounds on the three numeric settings
(`GatewayRateLimitingSettings.cs:59`, `:63`, `:73`) are therefore load-bearing on both paths: an
invalid `PermitLimit` throws where it is configured, not at the first throttled request.

Bypasses are two-tier as first recorded, and two secret-gated tiers joined them in the amendments
below (synthetic traffic on 2026-09-01, a trusted internal caller on 2026-09-07), so four exist
today. The tiers are different kinds of thing. **Infrastructure bypasses are
unconditional**: `/health`, `/alive` and `/.well-known` are hard-coded
(`GatewayRateLimitingExtensions.cs:69`, matched by path segment, case-insensitively, `IsBypassed` at
`:81-90`, the comparison at `:89`), because
throttling them takes down probes and token validation (ADR-004's JWKS discovery) as a side effect of
throttling traffic. **Application bypasses are configuration**, through `BypassPathPrefixes`
(`GatewayRateLimitingSettings.cs:85`, empty by default), and each consumer sets its own list in the
gateway's `appsettings.json` beside the `ReverseProxy` route table that same file now declares
([ADR-089](089-gateway-topology-owned-by-configuration.md)). The two entries are recorded here so they
are not rediscovered as incidents: Store's Stripe webhook route (`/Payments/{**catch-all}`, bypassed
by the `"/Payments"` prefix at
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:20`, route at `:139-143`), because a 429
to Stripe is a retry and eventually a disabled endpoint, which silently stops every payment update
([ADR-084](084-stripe-webhook-ingress.md)); and ADC's SignalR hub route (`/hubs/{**catch-all}`,
bypassed by the `"/hubs"` prefix at
`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:25`, route at `:254-258`), because a
negotiate-plus-reconnect storm from one office's shared address is exactly the pattern a per-IP window
misreads as abuse ([ADR-039](039-live-channel-push.md)).

**A request with no attributable client IP is not limited.** It gets
`RateLimitPartition.GetNoLimiter` (`GatewayRateLimitingExtensions.cs:220`, the reasoning inline at
`:218-219`) rather than sharing one
bucket with every other unattributable request, which is the same fail-open posture ADR-019 chose for
`auth-ip` and for the global limiter's fallback key, for the same reason: a shared "unknown" bucket is
a single tripwire that one misbehaving caller pulls for everyone behind it.

**Amendment (2026-09-01): a third, secret-gated bypass tier for synthetic traffic.** The two tiers
above assume every caller is a real client. A capacity proof is not: both consumers run a monthly
single-runner k6 read-load test against production through the gateway
(`MMCA.ADC/.github/workflows/load-test.yml`, `MMCA.Store/.github/workflows/load-test.yml`), and the
whole run arrives from ONE runner IP at roughly 100 requests per second, which the per-IP window
(120 per 60 s) reads as exactly the flood it exists to stop. The first scheduled runs after the edge
limiter shipped failed on 2026-09-01 with 96% 429s in both apps (ADC run 33500095682, Store run
33499906085), and ADC's `load-freshness` deploy gate keys off the last green run, so an unfixed
limiter would have blocked every ADC deploy from 2026-09-05. Raising `PermitLimit` for everyone or
adding the read paths to `BypassPathPrefixes` would have removed the protection from the very
surface it guards, and lifting the limit from the load-test workflow via a temporary container-app
revision would have made a workflow that promises to be read-only mutate production twice a month.
The framework instead gained a **synthetic-traffic bypass** (v1.180.0): a request carrying the
configured header (`SyntheticTrafficHeaderName`, default `X-Synthetic-Traffic-Key`,
`GatewayRateLimitingSettings.cs:94`) whose single value matches the configured secret
(`SyntheticTrafficSecret`, `:118`) takes the same no-limiter partition as the two tiers above on BOTH
chained limiters: `IsSyntheticTraffic` (`GatewayRateLimitingExtensions.cs:108`) feeds the one
`IsExemptFromLimiters` predicate (`:182-185`) that each partition consults (`:210` and `:248`). It is
off by default (a null or blank secret disables it, `:158-161`), the comparison is constant-time
(`CryptographicOperations.FixedTimeEquals`, `:172`), exactly one header value is accepted (`:164`),
and a configured secret shorter than 32 characters fails at registration under the ADR-070 contract
(`[StringLength(int.MaxValue, MinimumLength = 32)]`, `GatewayRateLimitingSettings.cs:117`). The secret
is a deployment concern, never a checked-in setting: each consumer injects
`GatewayRateLimiting__SyntheticTrafficSecret` into its gateway from Key Vault the same way it injects
the SMTP password, and the k6 workflow sends the header from the matching repository secret. This
tier is for load and capacity proofs only; a monitoring probe belongs on the always-bypassed
infrastructure paths, and an application route that needs relief belongs in `BypassPathPrefixes`.

**Amendment (2026-09-07): a fourth tier, the trusted internal caller.** The synthetic-traffic tier
answers a load runner, and the 2026-09-07 security review found the same mechanism was needed for a
component the deployment owns. A server-rendered UI host makes every back-end call, token refresh
above all, from ONE container address on behalf of every signed-in visitor, so the per-IP window
collapses the whole site into a single partition and starts answering 429 as soon as the site is
busy: the limiter throttles the application rather than a caller. `TrustedCallerSecret`
(`GatewayRateLimitingSettings.cs:154`) with `TrustedCallerHeaderName` (default
`X-Internal-Caller-Key`, `:126`) generalizes the tier above from a load-test runner to any internal
caller the deployment trusts. The two share one implementation, so the guarantees are identical
rather than merely similar: `IsTrustedInternalCaller` (`GatewayRateLimitingExtensions.cs:141`) and
`IsSyntheticTraffic` (`:108`) both call `PresentsSecret` (`:156`), which is off when no secret is
configured (`:158-161`), rejects a multi-valued header (`:164`) and compares in constant time
(`:172`). The per-IP partition tests `IsTrustedInternalCaller` first (`:202-208`) and stamps
the request's `HttpContext.Items` under `TrustedInternalCallerItemKey` (`:62`, set at `:206`), so the
named per-route policies of `MMCA.Common.Gateway` exempt the trusted caller too (`auth-tight`
included; `RateLimiting/GatewayRoutePolicyExtensions.cs:38`, read at `:99`). Synthetic traffic, and
every request on the concurrency partition, go through the shared `IsExemptFromLimiters` predicate
(`:182-185`).
A configured secret shorter than 32 characters fails at registration
(`GatewayRateLimitingSettings.cs:153`). The secret is deployment data on both sides of the boundary:
each consumer injects `GatewayRateLimiting__TrustedCallerSecret` into gateway and UI container alike
from Key Vault (`MMCA.ADC/infra/main.bicep:2491` and `:2650`, `MMCA.Store/infra/main.bicep:1958-1959` and
`:2084`), and the client half is framework code, `AddTrustedCallerHeader`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:121`, attaching
`TrustedCallerHandler`, `Security/TrustedCallerHandler.cs:35`, at `:156`). It exempts a component you
deployed, never a browser, so it must never reach client-side code.
[ADR-019](019-rate-limiting.md) records the same tier from the limiter-policy side.

**3. Readiness reflects the downstreams; liveness does not.**
`AddGatewayDownstreamHealthChecks(params string[] serviceNames)`
(`.../Gateway/GatewayHealthCheckExtensions.cs:131`) registers one check per named downstream with an
`HttpClient` whose `BaseAddress` is the Aspire service-discovery name `http://{name}` (`:195`),
deduplicated through a registry so a repeated name cannot double-probe (`:177-182`, `:255-300`). Each
check probes `/alive` (`DownstreamServiceHealthCheck.cs:48`) under a 2 second budget
(`GatewayHealthCheckExtensions.cs:85`) applied at both the client (`:196`) and the registration
(`:242`), reports `Unhealthy` on failure (`:240`) and carries the `Ready` tag (`:241`). A second
overload (`:149`) takes `GatewayDownstreamHealthCheckOptions`, whose `ProbeVersion` pins the HTTP
version the probe requests (negotiated by default), and the probe client has the standard resilience
handler stripped (`:204-221`), because a retry inside a two second budget only turns a healthy
downstream into a timed-out one.

The tag is the whole design. The Aspire defaults map `/alive` to checks tagged `Live`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Health.cs:138-141`) and `/health/ready` to
everything not tagged `Live` or `Optional` (`:154-156`), so a `Ready`-tagged downstream check reaches
readiness and never reaches liveness. Liveness must stay process-local, or a downstream outage restarts
a perfectly healthy Gateway and makes the outage worse. `/alive` answers "is this process wedged",
`/health/ready` answers "can this process do useful work", and only the second depends on anything
else. That is [ADR-025](025-startup-warmup-readiness.md)'s split, applied to a dependency rather than
to a startup task.

**4. One call composes the YARP-level extension points (2026-08-27).** `AddMmcaGateway` has two
overloads on `IReverseProxyBuilder`
(`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewayReverseProxyExtensions.cs:47` taking
`IConfiguration`, `:68` taking a `GatewaySettings` instance), and both funnel into one `Wire` method
(`:86`) that registers, in order: the named per-route rate-limiter policies (`:88`), the cluster
profile config filter that owns each cluster's `HttpRequest` version policy (`:91`), the health-check
defaults filter (`:92`), and the trace-header transform (`:93`). Filter order carries no meaning and
the type says so: the two filters own disjoint parts of a cluster and neither reads what the other
wrote (`:37-41`). Settings bind from the `"MmcaGateway"` section (`GatewaySettings.cs:15`) through
`ValidateDataAnnotations().ValidateOnStart()` (`GatewayReverseProxyExtensions.cs:54-57`), the same
ADR-070 contract the rate-limit settings honor, and the per-route policies are additionally validated
at registration with `Validator.ValidateObject`
(`RateLimiting/GatewayRoutePolicyExtensions.cs:62`, reasoning at `:45-46`), because the limiter
factory closes over each policy object (`:76`), so a bad value would otherwise surface only at the
first throttled request.

**It registers services and maps nothing, and it does not load the route table.** The host still
calls `MapReverseProxy()` and `UseRateLimiter()` itself (`GatewayReverseProxyExtensions.cs:42-45`),
and `LoadFromConfig` stays the host's call because which section owns the routes, and whether they
come from configuration at all, is a host decision (`:15-20`). That keeps
[ADR-089](089-gateway-topology-owned-by-configuration.md)'s "the route table is the consumer's data"
intact: this package supplies behavior around the table, never the table.

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
that way (`GatewayRateLimitingSettings.cs:11-22`). With N Gateway replicas the effective ceiling is N
times `PermitLimit`, the same multiplication ADR-019 records for its own per-process limiters and only
partly retired there with its Redis option. It is accepted here rather than solved: the edge limiter
exists to bound a flood, not to meter a quota, and an approximate ceiling that needs no network call
and cannot fail is the right shape for the one process the whole fleet sits behind.

**The kit adds no authorization, no path or body rewriting and no response shaping.** Everything that
depends on knowing who the caller is or what the payload means stays behind the proxy, which is what
keeps the Gateway a transport concern and keeps ADR-008's extraction reversible.

**Narrowed 2026-08-27.** This originally read "no request rewriting", and the Gateway package now
adds exactly one request transform: `GatewayTraceHeaderTransformProvider` removes and re-adds
`X-MMCA-Route` and `X-MMCA-Cluster` on every proxied request
(`.../MMCA.Common.Gateway/Transforms/GatewayTraceHeaderTransformProvider.cs:60-71`, header names
defaulted at `GatewaySettings.cs:181`, `:184`). The exception is deliberate and narrow: it stamps
**which route and cluster YARP selected**, a fact only the proxy knows and one a downstream cannot
reconstruct, which is the same argument that made correlation an edge responsibility. It reads
nothing from the request and changes nothing a downstream parses. The decline that stands is the one
that matters: no path rewriting, no body rewriting, no response shaping, and nothing that depends on
the payload's meaning. ADR-089 anticipated this exact tension and left it open
(`089-gateway-topology-owned-by-configuration.md`, the "nothing prevents one from appearing" residual
in its Trade-offs); this is the answer, and the answer is one transform with a stated reason rather
than an open door.

### What the edge delegates (2026-08-27)

Three behaviors a reader expects to find in a reverse proxy are absent on purpose, because a layer
better placed to perform them already does. They are recorded here so an inventory of the gateway
reads them as decisions rather than as omissions.

**Bearer validation is delegated to the backends; the gateway forwards.** This is the same decision
as the JWT decline above, stated from the delegation side, and the `MMCA.Common.Gateway` package
does not revisit it: nothing in it calls `AddAuthentication`, `AddJwtBearer`, `AddAuthorization` or
`RequireAuthorization`, and neither consumer gateway host registers an authentication scheme
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs`). The two hosts differ on authorization, and
the difference changes nothing about the caller: both route tables declare `"AuthorizationPolicy":
"anonymous"` on every route, and only ADC evaluates the declaration. ADC registers the authorization
middleware pair (`AddAuthorization` at `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:114`,
`UseAuthorization` at `:231`, the reasoning inline at `:100-113` and `:228-230`) so that each route's
declared policy is read rather than implied, with the framework fallback policy deliberately not
adopted, because it ships in `MMCA.Common.API` and would pull the MVC stack into a pure YARP host
(`:110-113`). Store's routes declare `anonymous` as well, but its host registers no authorization
middleware, by design (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:45-49`). With no
authentication scheme on either host, an evaluated `anonymous` policy admits every request, so both
gateways still forward every bearer untouched to the service that validates it. The `Authorization` header travels on
YARP's default request-header copy rather than through a transform of its own: the one transform the
package installs touches two headers and no others
(`Transforms/GatewayTraceHeaderTransformProvider.cs:60-71`), and neither gateway's
`appsettings.json` declares a `Transforms` block. Store states the posture in the host itself
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:12-13`, "services validate JWTs themselves;
the gateway just forwards the Authorization header transparently") and again in its project file
(`MMCA.Store.Gateway.csproj:6-7`, "no JWT middleware"). The backends validate through JWKS discovery
against the authority (`AddForwardedJwtBearer`,
`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:52`,
its `AddJwtBearer` at `:84` inside `AddForwardedJwtBearerCore` (`:77`), `Authority` at `:86`), served by `MapJwksEndpoint`
(`.../MMCA.Common.API/Startup/Endpoints/JwksEndpointExtensions.cs:31`). Adding validation at the edge would
give the gateway issuer and key-discovery configuration it does not have, which is the coupling the
decline above rejects: an Identity outage would become a Gateway outage.

**Load balancing is delegated to Azure Container Apps ingress.** No `LoadBalancingPolicy` appears
anywhere in the framework, in either consumer gateway's configuration, or in either repository's
bicep. It is not needed, because **every cluster fronts exactly one destination**: an Aspire
service-discovery name (`http://identity`, `http://conference`) that ACA ingress resolves and
balances across the replicas behind it. ADC declares five clusters with one destination each
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:261-269`, `:270-278`, `:279-287`,
`:288-292`, `:293-297`) and Store three (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:146-154`,
`:155-163`, `:164-168`), resolved through `AddServiceDiscoveryDestinationResolver`
(ADC `Program.cs:151`, Store `Program.cs:141`) against the bicep address book
(`MMCA.ADC/infra/main.bicep:2468-2471`). The shape is not incidental: both repositories **pin it as
an invariant**, asserting that each cluster contains a single destination
(`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/RouteMapTests.cs:251-253`,
`MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/RouteMapTests.cs:315-317`). A second destination in
a cluster would be the gateway balancing across replicas the platform is already balancing across,
with two schedulers holding different opinions about which instance is healthy.

**Proxy-hop retries are delegated to client-side resilience.** The gateway retries nothing: no retry
configuration, no Polly pipeline and no `IForwarderHttpClientFactory` appears in the package or in
either host. Retries live in the client the user is waiting on, where
`EntityServiceBase` runs a Polly exponential-backoff-with-jitter policy declared on its base
`AuthenticatedServiceBase` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:27`,
built by `BuildRetryPolicy` at `:170-173`; executed in `EntityServiceBase.cs` at
`:365` and `:393`), while the server-to-server budget is deliberately one retry beyond the initial attempt
(`.../MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:30`, the up-to-16x storm argument at
`:22-26`). The decisive reason is [ADR-017](017-request-idempotency.md): the `Idempotency-Key` is
minted client-side and held constant across that client's own attempts, and it appears nowhere in
the gateway package or either gateway host. A proxy-hop retry would therefore be a replay with
nothing attached to make it safe, on a write the proxy cannot inspect to know whether replaying it
is harmless. Retrying where the key is is the only version that is correct.

**Active destination probing is available and off by default, and both consumers leave it off.** The
package can apply YARP health-check defaults to any cluster that declares none
(`Configuration/GatewayHealthCheckDefaultsConfigFilter.cs`, additive-only: an existing block is kept
verbatim, `:30-31`, class doc at `:9-14`). **Passive** checking is the default that is on
(`GatewaySettings.cs:135`, `TransportFailureRate` at `:139`, 60 second reactivation at `:142`),
because YARP watches the forwarded responses it is already making, so it costs no extra traffic
(`:129-131`). **Active** probing is opt-in (`Enabled` defaults to `false`, `:153`, reasoning at
`:145-149`: an extra probe per destination per interval is real traffic and real cost, and passive
checks already eject a destination failing the requests the gateway cares about); when enabled it
probes `/alive` (`:170-171`) on the `ConsecutiveFailures` policy (`:156-157`) every 10 seconds
(`:160`) under a 5 second budget (`:163`). `/alive` rather than `/health` is its own decision:
readiness on a downstream flips during that downstream's rolling deployment, and ejecting a
destination for that is the gateway reacting to a healthy deployment as if it were an outage
(`:165-169`). Both consumers set `HealthCheckDefaults:Active:Enabled` to `false` explicitly: every
cluster fronts one Container Apps address that the platform already routes only to ready replicas, so
an active probe could only eject the sole destination, and each probe bills an otherwise idle
downstream replica at the active rate (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:52-61`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:26-35`). Both pin the effective result
(`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/GatewayHardeningTests.cs:85-89`,
`MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/MmcaGatewayTests.cs:136-140`), so the default is
off, the deployed answer is off, and passive checking stays on in both.

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
  (`GatewayRateLimitingExtensions.cs:278-279`, consumed at `:308` and `:310`), so an
  `IOptionsMonitor` reload never reaches it. Validation is not the gap (both paths validate, see the
  Decision), but liveness of the value is: changing a limit is a restart, not a config push, which is
  the opposite of what "it is
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
- **Two correlation middlewares now exist with two literals written twice.** The gateway type and
  the API type are separate, in separate packages, each declaring the header name and the 64
  character `MaxLength` its sanitizing rule cuts to (`GatewayCorrelationMiddleware.cs:36`, `:43`).
  A change to either in one is a silent break, the same duplicated-literal cost ADR-041 already records for the meter names in this
  same Aspire package.
- **Two different `/alive` probes now exist, and they answer different questions.** The Aspire kit's
  `AddGatewayDownstreamHealthChecks` probes `/alive` under a 2 second budget and feeds the
  **Gateway's own readiness**, so a downstream outage takes the Gateway out of ACA's rotation. The
  Gateway package's active health check, when a host enables it (neither consumer does), probes the
same path under a 5 second default and feeds
  **YARP destination ejection**, so a failing destination stops receiving forwards. Same path, same
  word "health", different mechanism and different consequence, and a reader who conflates them will
  misdiagnose the next incident. They are also tuned differently on purpose: the readiness probe is
  the tighter budget because it gates traffic to the whole process.
- **`AddMmcaGateway`'s configuration overload closes over an eagerly-bound copy too**
  (`GatewayReverseProxyExtensions.cs:59`), so the per-route limiter policies never see an
  `IOptionsMonitor` reload, exactly as the Aspire kit's limiter does not. The config filters share
  that shape: each copies `IOptions<GatewaySettings>.Value` into a readonly field at construction
  (`Configuration/GatewayClusterProfileConfigFilter.cs:27`,
  `Configuration/GatewayHealthCheckDefaultsConfigFilter.cs:19`), and the code states that the filters
  close over the settings for the process lifetime (`GatewayReverseProxyExtensions.cs:73-75`). A
  change to `MmcaGateway` settings, filter-owned or limit, is therefore a restart; only the YARP
  route table itself hot-reloads.
- **The delegations are correct today because of facts nothing enforces framework-side.** Load
  balancing is safely delegated only while each cluster has one destination, and proxy-hop retries
  are safely absent only while the idempotency key is minted client-side. Both consumers pin the
  first with a test; nothing pins the second beyond the fact that no gateway code mints a key. A
  future gateway that added a second destination to a cluster, or a retry, would invalidate a
  recorded decision without failing a build.
- **Nothing gates adoption.** A gateway that never calls the three registrations behaves exactly as
  before, and no fitness function names a gateway host. Both consumer gateways do call all three
  today (ADC `Program.cs:76`, `:90`, `:165`; Store `Program.cs:87`, `:112`, `:155`), but that is a
  wiring habit rather than an enforced invariant, which is the audit-the-inventory caveat ADR-005 and
  ADR-017 both record, now applied to the edge.

## Revision (2026-09-07)
Two changes from the 2026-09-07 security review.

1. **Health endpoints are cached server-side, and the bypass stays** (SEC-Common-71 / SEC-ADC-17 /
   SEC-ADC-56). `/health` and `/health/ready` are anonymous and rate-limit exempt by design, which is
   correct for a probe and wrong under a flood: each request ran every live dependency probe, and on
   a gateway it fanned out to every backend. `CachedHealthReportProvider`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Health/CachedHealthReportProvider.cs:25`) runs the
   probes at most once per `HealthChecks:CacheSeconds` (default 5,
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Health/HealthReportCacheOptions.cs:38`, read at
   `CachedHealthReportProvider.cs:59`) with single flight through a per-entry semaphore (`:39`), so a
   flood costs one probe round per window instead of one per request. The exemption is kept rather
   than replaced: a throttled probe is an outage signal the orchestrator would act on. `/alive` is
   unchanged and still uncached, which preserves the rule that startup gates read liveness, never
   readiness. ADC's gateway caches its downstream readiness probes the same way
   (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/HealthChecks/DownstreamReadinessCache.cs:24`,
   `GetOrProbeAsync` at `:78`).
2. **Edge-shaped controls are not gateway-only.** This record assigned rate limiting and connection
   bounds to the gateway, which left a public HTML origin fronted by a different ingress with
   neither (SEC-Store-56). Store's storefront host now carries its own fixed-window limiter
   (`UiRateLimitingSettings`, on by default,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Hardening/UiRateLimitingSettings.cs:31`, 300
   requests per 60 seconds at `:54` and `:58`, global concurrency 200 at `:68`; registered at
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:107` and applied at `:239`) and a
   `BoundedCircuitHandler`
   (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:37`, registered
   at `Program.cs:99`) that caps concurrent Blazor circuits at
   `BlazorCircuitLimitSettings.MaxActiveCircuits` (200,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:39`), with
   `DisconnectedCircuitMaxRetained` 25 (`:47`) and `DisconnectedCircuitRetentionSeconds` 60 (`:55`).
   A request limiter alone does not bound a server-rendered origin, because the expensive resource is
   the circuit a single page load opens, not the request that opened it.

## Revision (2026-09-10)

**Both public UI hosts now carry the own-host hardening, so item 2 above is no longer a Store-only
remediation.** ADC's conference UI is externally reachable on its own FQDN, which is the same
condition that produced SEC-Store-56: a public HTML origin fronted by an ingress the gateway limiter
never sees.

ADC ships the same trio under
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Hardening/`: `UiRateLimitingExtensions.cs:13` and
`UiRateLimitingSettings.cs:33` for the per-IP fixed window chained with a replica concurrency
ceiling, `BoundedCircuitHandler.cs:37` for the active-circuit cap, and
`BlazorCircuitLimitSettings.cs:17` for its bounds. The limiter is registered at
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:127` and applied at `:197`.

One structural difference is worth naming so it is not read as drift. Store registers the circuit
handler directly (`Program.cs:99`), while ADC wraps registration and the `CircuitOptions` retention
callback in one `AddBoundedBlazorCircuits()` helper (`Program.cs:62`, the singleton at
`Hardening/BlazorCircuitLimitExtensions.cs:58`, the retention callback at `:26-39`, passed into
`AddInteractiveServerComponents` at `Program.cs:53`). The registered services are the same; only the
call shape differs.

The tuned numbers differ too, and that is the parameter doing its job rather than a divergence:

| Setting | ADC | Store |
| --- | --- | --- |
| `PermitLimit` per window | 1200 (`UiRateLimitingSettings.cs:60`) | 300 (`UiRateLimitingSettings.cs:54`) |
| `WindowSeconds` | 60 (`:64`) | 60 (`:58`) |
| `GlobalConcurrencyLimit` | 200 (`:76`) | 200 (`:68`) |
| `MaxActiveCircuits` | 200 (`BlazorCircuitLimitSettings.cs:40`) | 200 (`BlazorCircuitLimitSettings.cs:39`) |
| `DisconnectedCircuitMaxRetained` | 25 (`:48`) | 25 (`:47`) |
| `DisconnectedCircuitRetentionSeconds` | 180 (`:58`) | 60 (`:55`) |

ADC's window is four times Store's because conference-day traffic arrives as a room full of attendees
behind a handful of shared NAT addresses, where a storefront's per-IP assumption of roughly one
shopper per address holds. Its 180-second disconnected retention is the ASP.NET Core framework
default kept rather than tightened, for the same reason: an attendee walking between rooms drops
Wi-Fi and expects the page to reconnect, and Store's 60 seconds trades that for memory it would rather
spend elsewhere. ADC restates both in configuration so the shipped value is visible without reading
the settings class (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:19-24` and `:28-32`).

The shipped values are pinned by tests in the gating tier, so a silent retune fails a pull request:
`MMCA.ADC/Tests/Hosts/MMCA.ADC.UI.Web.Tests/UiRateLimitingTests.cs:16` asserts burst shedding, exempt
paths, per-IP partitioning and the three limiter values, and `BoundedCircuitHandlerTests.cs:16`
asserts the ceiling, permit release and the three circuit bounds.

**Still local, still not framework code.** The Decision above records the deliberate reason Store
declared this hardening in its own host rather than in MMCA.Common. Two near-identical copies now
exist, which strengthens the case for extraction without settling it: a shared UI-host hardening kit
would need its own decision, and this revision does not take one. **That decision is taken in the
2026-09-20 revision below**, which moves the kit into MMCA.Common and deletes both local copies.

## Revision (2026-09-20)

**The decision the last revision declined to take is taken here: the own-host UI hardening is
framework code.** Two near-identical copies in two consumers is the shape that says a kit has stopped
being one app's remediation, and the second copy landed with no new thinking in it. The kit now ships
in `MMCA.Common.UI.Web` under the `MMCA.Common.UI.Web.Hardening` namespace, released in the framework
wave merged as `82036e7` on MMCA.Common `main` (`MMCA.Common/CHANGELOG.md:24-36`).

Five files carry it, all under
`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/`:

| File | What it holds |
| --- | --- |
| `UiRateLimitingExtensions.cs:22` | the per-IP fixed window chained with the replica concurrency ceiling, the exempt-prefix list (`:42`) and the exemption rule (`:62`) |
| `UiRateLimitingSettings.cs:33` | the `UiRateLimiting` section (`:36`) and its three tuned values |
| `BlazorCircuitLimitExtensions.cs:19` | the two registration halves, which attach to different builders |
| `BlazorCircuitLimitSettings.cs:17` | the `BlazorCircuitLimits` section (`:20`) and its three bounds |
| `BoundedCircuitHandler.cs:39` | the ceiling on concurrently ACTIVE circuits, counted on open (`:58`) and released on close (`:79`) |

Three entry points are the whole public surface: `AddUiRateLimiting(configuration)`
(`UiRateLimitingExtensions.cs:145`), `UseUiRateLimiting()` (`:187`), and the circuit pair
`AddBoundedBlazorCircuits()` (`BlazorCircuitLimitExtensions.cs:51`) with
`BlazorCircuitLimitExtensions.RetentionFrom(configuration)` (`:28`), the callback handed to
`AddInteractiveServerComponents`. The retention and the active-circuit ceiling stay two calls because
they attach to different builders, and they read the same section so the two numbers cannot drift.

**Both consumers now consume the framework kit and their local copies are deleted.** Neither change is
merged yet; both sit on the branch `chore/common-wave-2026-09-20` in their repos.

- MMCA.ADC swaps one `using` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:31`) and keeps every
  call site where it was: the retention callback at `:53`, `AddBoundedBlazorCircuits()` at `:62`,
  `AddUiRateLimiting(builder.Configuration)` at `:127` and `UseUiRateLimiting()` at `:197`. Its whole
  `Hardening/` folder (five files) is gone.
- MMCA.Store swaps the same `using` (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:24`) and
  additionally loses an inline block: the hand-written `CircuitOptions` callback and the
  `AddOptions<BlazorCircuitLimitSettings>().BindConfiguration(...).ValidateDataAnnotations()` plus
  `AddSingleton<CircuitHandler, BoundedCircuitHandler>()` pair become
  `RetentionFrom(builder.Configuration)` at `:78` and `AddBoundedBlazorCircuits()` at `:86`. The limiter
  is registered at `:95` and applied at `:227`. Its `Hardening/` folder (four files) is gone.

**No configuration moved.** The framework binds the same two sections (`UiRateLimiting` at
`UiRateLimitingSettings.cs:36`, `BlazorCircuitLimits` at `BlazorCircuitLimitSettings.cs:20`) and the
same six keys, which are the names both apps were already shipping, so neither `appsettings.json`
changed a character. That is what made the adoption one `using` per host.

The tuned values recorded in the 2026-09-10 revision still hold, and they are now set purely in each
app's configuration against framework defaults rather than in a per-app settings class:

| Setting | Framework default | ADC | Store |
| --- | --- | --- | --- |
| `PermitLimit` per window | 300 (`UiRateLimitingSettings.cs:58`) | 1200 (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:21`) | 300 (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/appsettings.json:22`) |
| `WindowSeconds` | 60 (`:62`) | 60 (`appsettings.json:22`) | 60 (`appsettings.json:23`) |
| `GlobalConcurrencyLimit` | 200 (`:74`) | 200 (`appsettings.json:23`) | 200 (`appsettings.json:24`) |
| `MaxActiveCircuits` | 200 (`BlazorCircuitLimitSettings.cs:38`) | 200 (`appsettings.json:29`) | 200 (`appsettings.json:36`) |
| `DisconnectedCircuitMaxRetained` | 25 (`:46`) | 25 (`appsettings.json:30`) | 25 (`appsettings.json:37`) |
| `DisconnectedCircuitRetentionSeconds` | 60 (`:57`) | 180 (`appsettings.json:31`) | 60 (`appsettings.json:38`) |

The defaults are Store's numbers, which is deliberate: a public origin should ship limited even when a
host configures nothing, and the tighter pair is the safe one to inherit. ADC's four-times-wider window
and its 180-second retention keep the reasons the 2026-09-10 revision recorded (a venue full of
attendees behind a handful of shared NAT addresses, and a walk between rooms that should reconnect),
and both are now visible in configuration rather than in a settings class.

**One behavior delta, and it is a widening.** The framework exempts `/hubs` alongside `/health`,
`/alive`, `/_framework` and `/_content` (`UiRateLimitingExtensions.cs:42`), because a SignalR
connection is long-lived and its negotiate and reconnect traffic must never be throttled; that mirrors
the Gateway's own `GatewayRateLimiting:BypassPathPrefixes`. ADC's local copy already had the `/hubs`
prefix; Store's did not (four prefixes at `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Hardening/UiRateLimitingExtensions.cs:30`
on `main`, before the deletion). Store's storefront origin serves no hub, so the exemption covers
nothing that exists there today and the observable behavior is unchanged; it is covered by declaration
rather than by accident if one ever appears. `/_blazor` keeps no exemption on either host, because the
negotiate endpoint is exactly what opens a circuit.

**The unit facts moved with the code; the wiring facts stayed.** The kit's own behavior is now tested
once, beside it, in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/Hardening/`:
`UiRateLimitingTests.cs` covers the exemption rule and the partition keys, and
`BoundedCircuitHandlerTests.cs` covers the ceiling, the rollback on refusal and the floor at zero.
What each consumer kept is the half only that repo can answer, which is whether its real host wires the
kit at all and on which numbers:

- MMCA.ADC: `MMCA.ADC/Tests/Hosts/MMCA.ADC.UI.Web.Tests/UiRateLimitingTests.cs:29` proves the real host
  registers the limiter and the file still drives a burst through the limiter the host actually
  registered, so the conference-day window is pinned; `BoundedCircuitHandlerTests.cs:25` proves the
  handler is registered as a SINGLETON (a scoped registration counts to one per circuit and caps
  nothing) and `:41` pins the tightened retention values.
- MMCA.Store: `MMCA.Store/Tests/Hosts/MMCA.Store.UI.Web.Tests/UiRateLimitingTests.cs:29` and
  `BoundedCircuitHandlerTests.cs:30` keep the same two registration assertions and nothing else.

This closes item 2 of the 2026-09-10 revision as a remediation: the hardening is no longer a thing each
public UI host has to remember to write, and a third Blazor host gets it with one `using` and two
registrations.

## Revision (2026-10-01)

**Both consumers now turn active destination probing off.** The framework half of the delegation is
unchanged: active checks stay opt-in (`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewaySettings.cs:153`)
and passive checks stay on. What changed is each consumer's choice. Both gateways set
`MmcaGateway:HealthCheckDefaults:Active:Enabled` to `false`
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:52-61`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:26-35`), for the reason the configuration
states inline: every cluster fronts one Container Apps address the platform already routes only to
ready replicas, so an active probe could only eject the sole destination (turning a slow request into
a 503), and each probe bills an otherwise idle downstream replica at the active rate. The tests now pin
the OFF answer (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/GatewayHardeningTests.cs:85-89`,
`MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/MmcaGatewayTests.cs:136-140`). The delegation
paragraph and the two-probes trade-off are corrected to match. Store's gateway host still describes
an active `/alive` probe every 30 seconds in its comments
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:40`, `:133`); the configuration and its test
are what run.

**Corrections that change no decision.** The trusted internal caller now also bypasses the named
per-route policies: the per-IP partition stamps `TrustedInternalCallerItemKey`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:62`, set at
`:206`) and `auth-tight` reads it
(`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/RateLimiting/GatewayRoutePolicyExtensions.cs:99`).
The Gateway package carries one piece of host middleware, `UseCommonForwardedHeaders()`
(`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/ForwardedHeadersExtensions.cs:36`), now recorded in
the Context. The server-to-server budget is one retry beyond the initial attempt, not one attempt
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:30`). Every other
citation in the current-state sections is refreshed against current line numbers (the rate-limiting
kit, the health mapping now in `Extensions.Health.cs`, the forwarded-JWT registration now in
`WebApplicationBuilderExtensions.Authentication.cs`, `EntityServiceBase` now under `Services/Api/`,
the route and cluster tables, both bicep files, the route-map tests and the package pins).

**Two statements are flagged rather than changed.** `AddServiceDefaults` attaches the standard Polly
resilience handler to every `IHttpClientFactory` client in both gateway hosts
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:39`, `:49`), so "no Polly pipeline
appears in either host" reads more broadly than the code. The comment above that registration says
the defaults also reach the YARP forwarder (`:37-38`), but no code in the gateway package or either
gateway host replaces YARP's forwarder client factory to route the proxy hop through
`IHttpClientFactory`, so this record does not adopt the comment's claim; whether the handler reaches
the proxy hop is left for review. ADC's route-table comment says the
framework fallback policy is registered and that an undeclared route fails closed
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:72-77`), while the host registers plain
`AddAuthorization()` with no fallback (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:108-112`);
this record follows `Program.cs`.

**Superseded statements in earlier revisions.** Those sections stay as written. ADC's app-side
`DownstreamReadinessCache` (2026-09-07 item 1) is deleted; the gateway relies on the framework
`CachedHealthReportProvider` with `HealthChecks:CacheSeconds` pinned to 10
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:40-42`,
`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:90-96`). The 2026-09-20 consumer changes are
merged, so neither consumer has a `Hardening/` folder and every per-app `Hardening/` anchor in the
2026-09-07 and 2026-09-10 revisions no longer resolves. The framework UI kit keeps `/_blazor` inside
the per-IP window but exempts it from the concurrency ceiling, because the same prefix carries the
circuit WebSocket
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:140`,
reasoning at `:63-67`), and it also exempts any path with a file extension (`:80-81`).

## Revision (2026-10-06)

- **Edge correlation sanitizes what the caller sends.** `GatewayCorrelationMiddleware` no longer
  adopts any present header as-is: a caller-supplied id is cut to 64 characters and discarded (a new
  one minted) when it cannot be echoed safely, and the request header is rewritten only when the
  value changed. The Decision and the duplicated-literal trade-off (now two literals, the header
  name and `MaxLength`) are corrected to match.
- **The gateway config filters do not see a reload.** The trade-off that said a settings change
  reaches them at the next configuration reload is corrected: both copy `IOptions<T>.Value` at
  construction, so a `MmcaGateway` settings change is a restart for them as for the limiter.
- **The downstream readiness probes gained two behaviors** now recorded in the Decision: an options
  overload that pins the probe's HTTP version, and a probe client with the resilience handler
  stripped.
- **Superseded in earlier revisions, left as written there.** The framework UI kit's file-extension
  exemption now applies only outside the same-origin API proxy prefix, and the proxy's own `/hubs`
  path is exempt as well
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:82-93`);
  the `/_blazor` concurrency exemption is at `:156`. The 2026-09-20 kit table now resolves to the
  class at `:25`, the exempt list at `:56`, `AddUiRateLimiting` at `:175` and `UseUiRateLimiting` at
  `:225`, `UiRateLimitingSettings.cs:76` for the concurrency default and
  `BoundedCircuitHandler.cs:43` (open `:72`, close `:102`). The consumer UI hosts call the kit at
  ADC `Program.cs:72`, `:81`, `:146`, `:218` and Store `Program.cs:78`, `:86`, `:95`, `:229`,
  which also replaces the Store and ADC `Program.cs` anchors in the 2026-09-07 and 2026-09-10
  revisions. Store's tuned UI values sit at `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/appsettings.json:25-27`
  and `:39-41`. The kit's release entry is `MMCA.Common/CHANGELOG.md:798` (`[1.206.0]`). The
  2026-09-20 "not merged yet" sentence is superseded by the 2026-10-01 note that both consumer
  changes are merged.
- Every `path:line` anchor in the Status, Context, Decision and Trade-offs sections was re-verified
  against current source and refreshed (the `MMCA.Common.Gateway` pin is 1.232.0 in both consumers).

## Revision (2026-10-07)

Re-verified against current source. Nothing in the decision changes: the edge responsibilities, the
three declines, the delegations, the four bypass tiers and ADC's no-fallback authorization all hold
as recorded. Only the version pin and line anchors moved with the v1.233.0 release.

1. **The `MMCA.Common.Gateway` pin is 1.233.0 in both consumers**
   (`MMCA.ADC/Directory.Packages.props:121`, `MMCA.Store/Directory.Packages.props:14`), still in
   lockstep with the rest of the framework. This supersedes the ADC `:125` anchor in the 2026-08-27
   and 2026-09-19 Status sentences and the 1.232.0 figure there and in the 2026-10-06 revision,
   which stay as written. The 2026-10-06 statement that every Status, Context, Decision and
   Trade-offs anchor was current no longer held at this audit; the Decision anchors are refreshed
   below, and the Status pin anchor is superseded here.
2. Anchors re-verified against current source:
   - ADC injects `GatewayRateLimiting__TrustedCallerSecret` into the gateway at
     `MMCA.ADC/infra/main.bicep:2491` and the UI at `:2650` (Decision refreshed); the Store anchors
     `MMCA.Store/infra/main.bicep:1958-1959` and `:2084` are unchanged.
   - ADC's service-discovery address book is `MMCA.ADC/infra/main.bicep:2468-2471` (Decision
     refreshed).
   - The ADC UI host calls the kit at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:72`
     (`RetentionFrom`), `:82` (`AddBoundedBlazorCircuits`), `:148` (`AddUiRateLimiting`) and `:221`
     (`UseUiRateLimiting`), superseding the ADC anchors in the 2026-10-06 revision. The Store anchors
     `:78`, `:86`, `:95`, `:229` hold, and the Store `using` of the kit namespace is at
     `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:23` (the 2026-09-20 revision cites `:24`).
   - The kit's release entry is `MMCA.Common/CHANGELOG.md:823` (`[1.206.0]`), superseding `:798` in
     the 2026-10-06 revision.
   - ADC's gateway registers plain `AddAuthorization()` at
     `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:114`, with the no-fallback reasoning at
     `:110-113`, superseding `:108-112` in the 2026-10-01 revision. The route-table comment at
     `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:72-77` still describes a registered
     fallback, and this record still follows `Program.cs`.

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
