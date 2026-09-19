# ADR-124: The Server-Rendered UI Host Is Its Own Hardened Edge

## Status
Accepted (2026-09-19).

## Context
[ADR-019](019-rate-limiting.md) layers rate limiting, and [ADR-088](088-gateway-edge-responsibilities.md)
makes the Gateway the layer that carries the outermost one. Both records describe traffic that arrives
through the Gateway. The server-rendered Blazor UI host is the case neither covers: it is a **separate
externally reachable origin** on its own Container Apps FQDN, so the Gateway's edge limiter guards the
Gateway's own hostname and never sees a single request to the front door a browser actually loads
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:11-16`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Hardening/UiRateLimitingSettings.cs:11-15`, and the same
statement at the registration site in `MMCA.ADC.UI.Web/Program.cs:118-121` and
`MMCA.Store.UI.Web/Program.cs:101-103`).

Two properties of this origin make that gap expensive rather than cosmetic.

**A page load here is not a cheap request.** Under [ADR-056](056-blazor-render-mode-strategy.md)'s
Interactive Auto strategy the first render is always a Server circuit, so every page load opens one and
each open circuit holds live render state for as long as the connection lives
(`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:13-19`, `MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:13-19`).
An unauthenticated loop over the page and negotiate endpoints therefore accumulates server memory, not
just request volume, and the container it accumulates in is 0.25 vCPU / 0.5 GiB
(`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:27-28`,
`MMCA.Store.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:27-28`).

**The framework knob that looks like the answer is not one.** `CircuitOptions` exposes
`DisconnectedCircuitMaxRetained` and `DisconnectedCircuitRetentionPeriod`, and both bound only circuits
that have already DROPPED their connection and are being held for reconnect; nothing in `CircuitOptions`
bounds circuits that are open and connected (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:13-15`,
`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:13-15`). A rate limiter does not close the gap either,
from the other direction: it bounds how fast requests ARRIVE, while a caller who opens circuits slowly
enough to stay inside the window still accumulates them
(`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:10-13`).

## Decision
The server-rendered UI host defends itself, in three layers bound from two configuration sections the
host owns, in both ADC and Store.

- **A ceiling on concurrently ACTIVE circuits, held by a singleton `CircuitHandler`.**
  `BoundedCircuitHandler` counts opens and closes and refuses the ones past `MaxActiveCircuits`
  (`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:37-39,53-71`,
  `MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:37-39,53-71`). It is registered as a **singleton**
  so one count spans the replica: circuit handlers are resolved from each circuit's own scope, so a scoped
  registration would count to one and cap nothing
  (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:44-47,58`,
  `MMCA.Store.UI.Web/Program.cs:93-94,99`). It runs last among the registered handlers
  (`Order => int.MaxValue`), so a refusal happens after cheaper handlers have done their work rather than
  in the middle of it (`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:46-50`,
  `MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:46-50`).

- **The refusal is a thrown exception, and that is the one place the `Result` pattern does not apply.**
  `CircuitHandler.OnCircuitOpenedAsync` returns `Task` and has no "refuse" return value, so a faulted task
  is the only way to stop a circuit from starting; the code says so where it does it
  (`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:22-27`, the `Task.FromException` at `:65-67`, and the
  same pair at `MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:22-27,65-67`). The contract being
  implemented belongs to the framework, so the framework's refusal vocabulary wins over the codebase's.
  Refusal is observable: one Warning per refusal naming the ceiling
  (`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:88-91`, `MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:88-91`).

- **The count is race-safe by construction and cannot leak permits in either direction.** The open path
  increments first and rolls back on refusal, because reading and then incrementing would let two
  simultaneous opens both observe the last free slot and both take it
  (`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:57-62`). The close path floors at zero rather than
  trusting the pairing, because a close without a counted open would otherwise drive the count negative and
  hand out permits forever (`:74-83`). Both are identical in Store
  (`MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:57-62,74-83`).

- **Disconnected-circuit retention is tightened from the same section, as defence in depth.**
  `DisconnectedCircuitMaxRetained` drops from the framework's 100 to **25** in both hosts, because a retained
  circuit holds the same state an active one does while serving nobody
  (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:42-48`,
  `MMCA.Store.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:41-47`). The retention **period** is where the two
  apps deliberately differ: ADC keeps the framework's three minutes because a conference venue's shared wifi
  drops connections for far longer than a home network does and an attendee walking between rooms should come
  back to the session state they left (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:50-58`, 180
  seconds), while Store cuts it to 60 seconds because a shopper who really did drop off wifi reconnects within
  seconds (`MMCA.Store.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:49-55`).

- **A UI-host-local per-IP fixed window CHAINED with a replica-wide concurrency ceiling, both rejecting 429.**
  The two limiters answer different questions, so a request must satisfy both:
  `PartitionedRateLimiter.CreateChained` over a per-client-IP fixed window and a single-partition concurrency
  limiter (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:157-163`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingExtensions.cs:152-158`). The rejection status is 429
  (`.../UiRateLimitingExtensions.cs:150` ADC, `:145` Store). The concurrency half queues nothing
  (`QueueLimit = 0`), so a saturated host sheds load instead of growing latency
  (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:115-120`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingExtensions.cs:110-115`, rationale at
  `MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:66-74`).

- **Exemptions are what keep the limiter off the first real visitor rather than off the attacker.** Health and
  liveness probes are exempt, because throttling them turns a traffic spike into a failed probe and a container
  restart; so are the two framework asset roots and any path whose last segment carries a file extension, since
  a single page load pulls dozens of static files served from disk with an ETag
  (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:24-35,51-60`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingExtensions.cs:24-30,46-55`). `/_blazor` deliberately has no
  extension and no exemption, because the negotiate endpoint is exactly what opens a circuit
  (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:48-49`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingExtensions.cs:43-44`). An unresolvable client IP **fails open**
  rather than collapsing every unattributable request into one shared bucket, which would throttle an
  in-process `TestServer` to a standstill (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:81-87`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingExtensions.cs:76-82`).

- **Both limiters go in after forwarded headers and before anything that opens a circuit or renders a page.**
  `AddUiRateLimiting` at registration and `UseUiRateLimiting()` in the pipeline, so the partition key is the
  caller's IP rather than the ingress's (`MMCA.ADC.UI.Web/Program.cs:127` and `:194-197`,
  `MMCA.Store.UI.Web/Program.cs:107` and `:236-239`). The circuit ceiling is registered beside it, with the
  retention half applied to `AddInteractiveServerComponents` from the same section so the two numbers cannot
  drift apart (`MMCA.ADC.UI.Web/Program.cs:53,62` through
  `MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:26-39,49-59`;
  `MMCA.Store.UI.Web/Program.cs:78-88,95-99`).

- **ADC and Store each ship their own copy, with the same section names and the same shape.** Both bind
  `UiRateLimiting` (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:36`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingSettings.cs:34`) and `BlazorCircuitLimits`
  (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:20`,
  `MMCA.Store.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:20`), both ship the limiter **enabled** by default
  with one escape hatch for a load or capacity proof driven from a single runner IP
  (`.../UiRateLimitingSettings.cs:38-43` ADC, `:36-41` Store; the early return that honours it at
  `.../UiRateLimitingExtensions.cs:152-155` ADC, `:147-150` Store), and both carry `MaxActiveCircuits = 200`
  and `GlobalConcurrencyLimit = 200`
  (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:39-40`,
  `MMCA.Store.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:38-39`,
  `MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:75-76`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingSettings.cs:67-68`). The duplication is stated in the code as a
  choice rather than an oversight: the shape is copied from the Gateway kit and declared locally **because
  `MMCA.Common.Gateway` is the reverse-proxy kit and a UI host is not a reverse proxy**
  (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:19-24`, which also names Store's copy as the identical
  shape for the identical reason; `MMCA.Store.UI.Web/Hardening/UiRateLimitingSettings.cs:18-22`).

- **The two copies are tuned differently, and the tuning is the point.** ADC's per-IP window is **1200 per
  minute**, four times the storefront's, because on conference day the attendees are physically in one venue
  behind one NAT and present to this limiter as a SINGLE client IP rather than as 67 of them
  (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:45-60`, window at `:62-64`). Store's is **300 per
  minute**, set well above a single shopper because an office or mobile-carrier NAT presents many shoppers as
  one IP (`MMCA.Store.UI.Web/Hardening/UiRateLimitingSettings.cs:43-54`, window at `:56-58`). ADC additionally
  exempts `/hubs`, declared so the exemption stays true if a SignalR hub is ever fronted on this origin even
  though nothing under it is served by this host today
  (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:26-35`); Store's exempt list has no such entry
  (`MMCA.Store.UI.Web/Hardening/UiRateLimitingExtensions.cs:30`). Every default is also written out explicitly
  in each host's `appsettings.json`, so the deployed posture is stated rather than inherited
  (`MMCA.ADC.UI.Web/appsettings.json:19-24,28-32`, `MMCA.Store.UI.Web/appsettings.json:20-25,35-39`).

## Rationale
- **A separate origin is a separate edge.** The Gateway cannot defend a hostname it never receives a request
  for, so the choice was between routing the UI through the Gateway and letting the UI carry its own limiter.
  The host carries it, which leaves the browser's front door as the direct origin it already is
  (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:11-16`).
- **A circuit is resident state, so it needs a count and not a rate.** The rate limiter and the circuit ceiling
  bound different resources, and each leaves the other's failure mode open: this is why both exist rather than
  one (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:9-15`).
- **`CircuitHandler` is the documented extension point that sees a circuit open and close**, which is why the
  count lives there rather than in middleware or in `CircuitOptions`
  (`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:18-19`).
- **Throwing is the framework's own refusal vocabulary here.** The client sees the standard Blazor reconnect UI
  rather than a crashed page, and the count is decremented before the throw so a refusal never leaks a permit
  (`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:25-27,62-67`).
- **The ceilings are abuse ceilings, not capacity plans.** 200 active circuits per replica is derived from the
  container the host runs in (0.25 vCPU / 0.5 GiB, up to two replicas, roughly 300 MiB left for circuit state
  against a MudBlazor render tree of a few hundred kilobytes up to about a megabyte), and it sits far above real
  demand because Interactive Auto moves a returning session to the WebAssembly runtime after the first render;
  the busiest measured conference day peaked near 67 concurrent users against 76 accounts. The instruction that
  follows from that framing is written next to the number: raise it only together with the container's memory
  (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:26-40`,
  `MMCA.Store.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:26-39`).
- **Binding is validated at startup, and the hot path does not pay for it.** Both sections go through
  `ValidateDataAnnotations().ValidateOnStart()`, and the limiter then closes over the already-bound instance
  rather than resolving `IOptions` on every request, precisely because an out-of-range value has already failed
  the start-up validation (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:137-146`,
  `MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:53-56`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingExtensions.cs:132-141`, `MMCA.Store.UI.Web/Program.cs:95-98`).

## Trade-offs
- **Both ceilings are per replica, in memory.** The effective allowance is the configured number multiplied by
  the replica count (two today), so two replicas carry an abuse ceiling of 400 circuits against a real peak of
  well under 100. That is the same trade the Gateway kit documents and is accepted for the same reason: an edge
  limiter has to answer in microseconds on every request, and a shared counter would put a network round trip in
  front of the whole site (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:26-30`,
  `MMCA.Store.UI.Web/Hardening/UiRateLimitingSettings.cs:25-28`,
  `MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:35-36`).
- **Two copies to keep aligned, with no mechanism keeping them aligned.** The section names, the defaults, the
  partition keys and the refusal semantics match by convention only; no test, analyzer or shared package holds
  the two hosts to the same shape, so a fix applied to one is a fix applied to one. The copies have already
  diverged structurally as well as numerically: ADC factored registration into
  `BlazorCircuitLimitExtensions` (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:26,49`) while
  Store still writes the same two registrations inline in `Program.cs`
  (`MMCA.Store.UI.Web/Program.cs:78-88,95-99`), and Store has no such file.
- **A refusal is an exception on a framework contract**, so the diagnostic is a Warning log rather than a typed
  result a caller can branch on, and the user-facing signal is the standard Blazor reconnect UI rather than a
  message the app controls (`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:22-27,88-91`).
- **Fail-open on an unresolvable client IP is a deliberate hole.** A caller the host cannot attribute takes the
  no-limiter partition, which is the right call for an in-process `TestServer` and is a gap if anything else ever
  reaches this host without a remote address (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:81-87`).
- **The extension-bearing-path rule is a heuristic.** Anything whose last segment has a file extension is exempt
  from both limiters, which is how a static asset is told apart from a page route without depending on middleware
  ordering; a page route that ever ends in a dotted segment would inherit that exemption silently
  (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingExtensions.cs:42-59`).
- **A per-IP window is the wrong shape for a venue, and is widened rather than replaced.** ADC's fourfold
  widening buys a margin over one NAT'd venue at the cost of letting a single scripted client burn four times as
  many requests before it is shed (`MMCA.ADC.UI.Web/Hardening/UiRateLimitingSettings.cs:48-57`).

## Related
[ADR-019](019-rate-limiting.md) (the layered rate-limiting posture this adds a layer to),
[ADR-088](088-gateway-edge-responsibilities.md) (the Gateway edge whose limiter this host is outside of, and
which the registration comments name directly at `MMCA.ADC.UI.Web/Program.cs:118` and
`MMCA.Store.UI.Web/Program.cs:101`), [ADR-056](056-blazor-render-mode-strategy.md) (the Interactive Auto
strategy that makes a first render a Server circuit and a returning session a WebAssembly one, which is what
makes the ceiling both necessary and generous), [ADR-079](079-shared-http-middleware-pipeline.md) (the ordered
pipeline this middleware is placed into, after forwarded headers and before anything that renders).
