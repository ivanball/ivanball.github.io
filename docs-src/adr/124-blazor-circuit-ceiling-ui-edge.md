# ADR-124: The Server-Rendered UI Host Is Its Own Hardened Edge

## Status
Accepted (2026-09-19). Revised 2026-09-25 (the hardening kit is one framework copy in
`MMCA.Common.UI.Web/Hardening/`, first shipped in v1.206.0, which both UI hosts consume; the `/hubs`
exemption is a framework default; both hosts adopt forwarded headers through Common's
`UseCommonUiForwardedHeaders`; every anchor repointed; see the Revision below).

## Context
[ADR-019](019-rate-limiting.md) layers rate limiting, and [ADR-088](088-gateway-edge-responsibilities.md)
makes the Gateway the layer that carries the outermost one. Both records describe traffic that arrives
through the Gateway. The server-rendered Blazor UI host is the case neither covers: it is a **separate
externally reachable origin** on its own Container Apps FQDN, so the Gateway's edge limiter guards the
Gateway's own hostname and never sees a single request to the front door a browser actually loads
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:11-16`, and the same
statement at the registration site in `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:134-136` and
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:87-89`).

Two properties of this origin make that gap expensive rather than cosmetic.

**A page load here is not a cheap request.** Under [ADR-056](056-blazor-render-mode-strategy.md)'s
Interactive Auto strategy the first render is always a Server circuit, so every page load opens one and
each open circuit holds live render state for as long as the connection lives
(`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:14-20`).
An unauthenticated loop over the page and negotiate endpoints therefore accumulates server memory, not
just request volume, and the container it accumulates in is 0.25 vCPU / 0.5 GiB
(`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:27-28`).

**The framework knob that looks like the answer is not one.** `CircuitOptions` exposes
`DisconnectedCircuitMaxRetained` and `DisconnectedCircuitRetentionPeriod`, and both bound only circuits
that have already DROPPED their connection and are being held for reconnect; nothing in `CircuitOptions`
bounds circuits that are open and connected (`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:13-15`,
`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:14-16`). A rate limiter does not close the gap either,
from the other direction: it bounds how fast requests ARRIVE, while a caller who opens circuits slowly
enough to stay inside the window still accumulates them
(`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:10-13`).

## Decision
The server-rendered UI host defends itself, in three layers bound from two configuration sections the
host owns, in both ADC and Store, using one framework kit.

- **A ceiling on concurrently ACTIVE circuits, held by a singleton `CircuitHandler`.**
  `BoundedCircuitHandler` counts opens and closes and refuses the ones past `MaxActiveCircuits`
  (`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:39-43,58-76`). It is registered as a **singleton**
  so one count spans the replica: circuit handlers are resolved from each circuit's own scope, so a scoped
  registration would count to one and cap nothing
  (`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:46-48,60`). It runs last among the
  registered handlers (`Order => int.MaxValue`), so a refusal happens after cheaper handlers have done their
  work rather than in the middle of it (`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:51-55`).

- **The refusal is a thrown exception, and that is the one place the `Result` pattern does not apply.**
  `CircuitHandler.OnCircuitOpenedAsync` returns `Task` and has no "refuse" return value, so a faulted task
  is the only way to stop a circuit from starting; the code says so where it does it
  (`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:23-28`, the `Task.FromException` at `:70-72`). The
  contract being implemented belongs to the framework, so the framework's refusal vocabulary wins over the
  codebase's. Refusal is observable: one Warning per refusal naming the ceiling (`:93-96`).

- **The count is race-safe by construction and cannot leak permits in either direction.** The open path
  increments first and rolls back on refusal, because reading and then incrementing would let two
  simultaneous opens both observe the last free slot and both take it
  (`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:62-67`). The close path floors at zero rather than
  trusting the pairing, because a close without a counted open would otherwise drive the count negative and
  hand out permits forever (`:81-88`).

- **Disconnected-circuit retention is tightened from the same section, as defence in depth.**
  `DisconnectedCircuitMaxRetained` drops from the framework's 100 to **25** by default, because a retained
  circuit holds the same state an active one does while serving nobody
  (`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:40-46`), and both hosts keep 25
  (`MMCA.ADC.UI.Web/appsettings.json:30`, `MMCA.Store.UI.Web/appsettings.json:37`). The retention **period** is
  where the two apps deliberately differ. The kit defaults it to 60 seconds, because a visitor who really did
  drop off wifi reconnects within seconds, and its own documentation names the exception
  (`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:48-57`): Store keeps 60
  (`MMCA.Store.UI.Web/appsettings.json:38`), while ADC raises it back to the ASP.NET Core default of 180
  (`MMCA.ADC.UI.Web/appsettings.json:31`) because a conference venue's shared wifi drops connections for far
  longer than a home network does and an attendee walking between rooms should come back to the session state
  they left.

- **A UI-host-local per-IP fixed window CHAINED with a replica-wide concurrency ceiling, both rejecting 429.**
  The two limiters answer different questions, so a request must satisfy both:
  `PartitionedRateLimiter.CreateChained` over a per-client-IP fixed window and a single-partition concurrency
  limiter (`MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:170-176`). The rejection status is 429
  (`:163`). The concurrency half queues nothing (`QueueLimit = 0`), so a saturated host sheds load instead of
  growing latency (`:128-133`, rationale at `MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:64-72`).

- **Exemptions are what keep the limiter off the first real visitor rather than off the attacker.** Health and
  liveness probes are exempt, because throttling them turns a traffic spike into a failed probe and a container
  restart; so are the two framework asset roots and any path whose last segment carries a file extension, since
  a single page load pulls dozens of static files served from disk with an ETag
  (`MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:33-42,49-56,62-71`). The default exempt list also
  carries `/hubs`, mirroring the Gateway's own bypass list, so a host that ever fronts a SignalR hub on this
  origin is covered by declaration rather than by accident (`:37-42`); because it is the kit's default, both
  hosts exempt it, and Store's use-site comment names it (`MMCA.Store.UI.Web/Program.cs:213-216`, ADC's at
  `MMCA.ADC.UI.Web/Program.cs:200-202`). `/_blazor` deliberately has no extension and no exemption, because
  the negotiate endpoint is exactly what opens a circuit (`MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:55-56`).
  An unresolvable client IP **fails open** rather than collapsing every unattributable request into one shared
  bucket, which would throttle an in-process `TestServer` to a standstill (`:93-99`).

- **Forwarded headers come first, with one framework posture shared by every host.** Both UI hosts open their
  pipeline with `UseCommonUiForwardedHeaders()` (`MMCA.ADC.UI.Web/Program.cs:192`,
  `MMCA.Store.UI.Web/Program.cs:188`), defined in `MMCA.Common.API`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/CommonForwardedHeadersExtensions.cs:24-25`, shipped in
  v1.211.0, `MMCA.Common/CHANGELOG.md:32-35`). It applies `CommonForwardedHeaders.Create()`: `X-Forwarded-For`,
  `X-Forwarded-Proto` and `X-Forwarded-Host` by default, with the known-proxy and known-network allow-lists
  cleared because cloud ingress reaches the container from addresses in neither default list
  (`.../MMCA.Common.API/Startup/CommonForwardedHeaders.cs:14-20,33-34,42-53`). The service pipeline's
  `ForwardedHeaders` step builds its options from the same factory
  (`.../MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:69`), and the Gateway package keeps its
  own dependency-free copy of the same values (`CommonForwardedHeaders.cs:22-24`,
  `MMCA.Common/Source/Hosting/MMCA.Common.Gateway/ForwardedHeadersExtensions.cs:59-63`), so all three hosts
  read the scheme, host and client address the same way. That ordering is what makes the partition key below
  the caller's IP rather than the ingress's.

- **Both limiters go in after forwarded headers and before anything that opens a circuit or renders a page.**
  `AddUiRateLimiting` at registration and `UseUiRateLimiting()` in the pipeline
  (`MMCA.ADC.UI.Web/Program.cs:142` and `:203`, `MMCA.Store.UI.Web/Program.cs:94` and `:217`). The circuit
  ceiling is registered beside it, with the retention half applied to `AddInteractiveServerComponents` from
  the same section so the two numbers cannot drift apart (`RetentionFrom` at `MMCA.ADC.UI.Web/Program.cs:68`
  and `MMCA.Store.UI.Web/Program.cs:77`, `AddBoundedBlazorCircuits()` at `MMCA.ADC.UI.Web/Program.cs:77` and
  `MMCA.Store.UI.Web/Program.cs:85`, both through
  `MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:28-41,51-61`).

- **One framework kit, consumed by both hosts, with the same section names and the same shape.** The kit
  ships in `MMCA.Common.UI.Web` from v1.206.0 (`MMCA.Common/CHANGELOG.md:270-282`) and binds
  `UiRateLimiting` (`MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:36`) and `BlazorCircuitLimits`
  (`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:20`). It ships the limiter **enabled** by
  default with one escape hatch for a load or capacity proof driven from a single runner IP
  (`UiRateLimitingSettings.cs:38-43`; the early return that honours it at
  `UiRateLimitingExtensions.cs:165-168`), and defaults `MaxActiveCircuits = 200`
  (`BlazorCircuitLimitSettings.cs:38`) and `GlobalConcurrencyLimit = 200` (`UiRateLimitingSettings.cs:74`).
  The kit is deliberately separate from the Gateway's limiter even though it is shaped like it, **because
  `MMCA.Common.Gateway` is the reverse-proxy kit and a UI host is not a reverse proxy**
  (`UiRateLimitingSettings.cs:18-25`).

- **The two hosts tune the kit differently through configuration, and the tuning is the point.** The kit's
  per-IP window defaults to **300 per minute**, set well above a single visitor because an office or
  mobile-carrier NAT presents many visitors as one IP, and its documentation tells a host whose audience sits
  behind one address to raise it (`MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:45-58`, window at
  `:60-62`). Store keeps 300 (`MMCA.Store.UI.Web/appsettings.json:22`). ADC sets **1200 per minute**, four
  times the storefront's, because on conference day the attendees are physically in one venue behind one NAT
  and present to this limiter as a SINGLE client IP (`MMCA.ADC.UI.Web/appsettings.json:15-21`, restated at
  `MMCA.ADC.UI.Web/Program.cs:140-141`). Every value is also written out explicitly in each host's
  `appsettings.json`, so the deployed posture is stated rather than inherited
  (`MMCA.ADC.UI.Web/appsettings.json:19-24,28-32`, `MMCA.Store.UI.Web/appsettings.json:20-25,35-39`).

## Rationale
- **A separate origin is a separate edge.** The Gateway cannot defend a hostname it never receives a request
  for, so the choice was between routing the UI through the Gateway and letting the UI carry its own limiter.
  The host carries it, which leaves the browser's front door as the direct origin it already is
  (`MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:11-16`).
- **A circuit is resident state, so it needs a count and not a rate.** The rate limiter and the circuit ceiling
  bound different resources, and each leaves the other's failure mode open: this is why both exist rather than
  one (`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:9-16`).
- **`CircuitHandler` is the documented extension point that sees a circuit open and close**, which is why the
  count lives there rather than in middleware or in `CircuitOptions`
  (`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:19-20`).
- **Throwing is the framework's own refusal vocabulary here.** The client sees the standard Blazor reconnect UI
  rather than a crashed page, and the count is decremented before the throw so a refusal never leaks a permit
  (`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:26-28,64-72`).
- **The ceilings are abuse ceilings, not capacity plans.** 200 active circuits per replica is derived from the
  container the host runs in (0.25 vCPU / 0.5 GiB, roughly 300 MiB left for circuit state against a MudBlazor
  render tree of a few hundred kilobytes up to about a megabyte), and it sits far above real demand because
  Interactive Auto moves a returning session to the WebAssembly runtime after the first render. The instruction
  that follows from that framing is written next to the number: raise it only together with the container's
  memory (`MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:26-38`). ADC's busiest measured
  conference day peaked near 67 concurrent users, and its UI container scales to at most two replicas
  (`MMCA.ADC.UI.Web/appsettings.json:25-27`, `MMCA.ADC/infra/main.bicep:1270`).
- **Binding is validated at startup, and the hot path does not pay for it.** Both sections go through
  `ValidateDataAnnotations().ValidateOnStart()`, and the limiter then closes over the already-bound instance
  rather than resolving `IOptions` on every request, precisely because an out-of-range value has already failed
  the start-up validation (`MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:150-159`,
  `MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:55-58`).

## Trade-offs
- **Both ceilings are per replica, in memory.** The effective allowance is the configured number multiplied by
  the replica count (two at most for ADC's UI today), so two replicas carry an abuse ceiling of 400 circuits
  against a real peak of well under 100. That is the same trade the Gateway kit documents and is accepted for
  the same reason: an edge limiter has to answer in microseconds on every request, and a shared counter would
  put a network round trip in front of the whole site
  (`MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:27-31`,
  `MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:34-35`).
- **One kit moves both hosts at once.** Because the limiter, the circuit ceiling and the forwarded-header
  posture are framework code, a behaviour change reaches both UI hosts together at the lockstep version bump
  (ADR-016), and the per-host differences are confined to configuration values. The cost is the other side of
  the same coin: a host that needs a different shape, not just a different number, has no local copy to bend
  and must change the framework.
- **A refusal is an exception on a framework contract**, so the diagnostic is a Warning log rather than a typed
  result a caller can branch on, and the user-facing signal is the standard Blazor reconnect UI rather than a
  message the app controls (`MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:23-28,93-96`).
- **Fail-open on an unresolvable client IP is a deliberate hole.** A caller the host cannot attribute takes the
  no-limiter partition, which is the right call for an in-process `TestServer` and is a gap if anything else ever
  reaches this host without a remote address (`MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:93-99`).
- **The extension-bearing-path rule is a heuristic.** Anything whose last segment has a file extension is exempt
  from both limiters, which is how a static asset is told apart from a page route without depending on middleware
  ordering; a page route that ever ends in a dotted segment would inherit that exemption silently
  (`MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:49-56,62-71`).
- **A per-IP window is the wrong shape for a venue, and is widened rather than replaced.** ADC's fourfold
  widening buys a margin over one NAT'd venue at the cost of letting a single scripted client burn four times as
  many requests before it is shed (`MMCA.ADC.UI.Web/appsettings.json:15-21`,
  `MMCA.Common.UI.Web/Hardening/UiRateLimitingSettings.cs:52-55`).

## Revision (2026-09-25): one framework kit, one forwarded-header posture
The hardening kit this record decides now lives once, in `MMCA.Common.UI.Web/Hardening/`, first shipped in
v1.206.0 (`MMCA.Common/CHANGELOG.md:270-282`). ADC and Store each import it
(`MMCA.ADC.UI.Web/Program.cs:31`, `MMCA.Store.UI.Web/Program.cs:23`) and carry no `Hardening/` folder of their
own, so the settings, the handler and the limiter are one implementation and the hosts differ only in the
configuration values recorded above. Two facts moved with it. The `/hubs` exemption became the kit's default
and so applies to both hosts rather than to ADC alone. And both hosts now adopt forwarded headers through
Common's `UseCommonUiForwardedHeaders()` (v1.211.0), which honours For, Proto and Host with the allow-lists
cleared, the same posture as the service pipeline and the Gateway, where Store's host previously honoured For
and Proto only. Every anchor in this record was repointed to the framework files and to the hosts' current
call sites.

## Related
[ADR-019](019-rate-limiting.md) (the layered rate-limiting posture this adds a layer to),
[ADR-088](088-gateway-edge-responsibilities.md) (the Gateway edge whose limiter this host is outside of, and
which the registration comments name directly at `MMCA.ADC.UI.Web/Program.cs:134` and
`MMCA.Store.UI.Web/Program.cs:87`), [ADR-056](056-blazor-render-mode-strategy.md) (the Interactive Auto
strategy that makes a first render a Server circuit and a returning session a WebAssembly one, which is what
makes the ceiling both necessary and generous), [ADR-079](079-shared-http-middleware-pipeline.md) (the ordered
pipeline this middleware is placed into, after forwarded headers and before anything that renders),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep bump that moves both hosts onto a kit change together).
