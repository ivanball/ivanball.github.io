# ADR-089: Gateway Topology Owned by Configuration

## Status
Accepted (2026-08-18; revised 2026-08-23: ADC's table gained a 27th route, `/Activities`, on
2026-08-19, and the bicep anchors below are corrected; revised 2026-08-31: section 5 now states the
activity timeout where it actually lives, declared once in the shared `MmcaGateway`
`ClusterRequestDefaults` profile rather than copied into each cluster, and the host and test anchors
throughout are re-pinned). **Amends
[ADR-008](008-service-extraction-topology.md)**: that record gave the
Gateway the route-to-service map and expressed it as code (a list of `MapForwarder` calls). The map
itself is unchanged; what changed is where it is written. YARP `ReverseProxy` **configuration** is now
the single source of the route table, the per-route HTTP version policy lives in cluster
configuration, and a route-map test is the drift gate in both consumer repositories. This is a
consumer-side decision, and both consumers landed it on 2026-08-18. (Updated 2026-08-27: the
framework does now ship a gateway package, `MMCA.Common.Gateway`, but it deliberately supplies
behavior **around** the route table and never the table itself, leaving `LoadFromConfig` and
`MapReverseProxy` to the host, so the decision below stays consumer-side; see
[ADR-088](088-gateway-edge-responsibilities.md).)
The Context below records the prior state that motivated the change; the Decision describes what each
gateway does today.

## Context
Before this record, both gateways built their route table by hand, in code. ADC made 26
`MapForwarder` calls and Store made 10. Neither host called `AddReverseProxy` or `LoadFromConfig`, and neither `appsettings.json` had
a `ReverseProxy` section at all: YARP was present only as its forwarder primitive. Destinations were
Aspire service-discovery names (`http://identity`, `http://conference`, `http://catalog` and so on)
resolved through `AddHttpForwarderWithServiceDiscovery`, which is the part of the arrangement that was
right and stays, now as `AddServiceDiscoveryDestinationResolver`
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:115`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:141`).

**The problem was not that the table was duplicated across deployment artifacts. It was that one table
was described three times inside one repository, and the three already disagreed.** ADC was the worked
example:

1. **The code** registered 15 conference forwarders.
2. **The comment above them** said 16.
3. **The test** pinned 23 of the 26 routes, leaving `/Sponsors`, `/CheckIns` and `/Points` unpinned,
   and its own doc comment described the set as "14 REST controllers + SessionSelection". The
   replacement test still names those three routes as the gap it exists to close
   (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/RouteMapTests.cs:32-34`).

Three routes were live and ungated, a comment was off by one, and the test's description matched
neither. None of that was caught, because nothing enumerated the table from a single place: a
hand-written list of calls, a hand-written comment, and a hand-written test theory are three
independent transcriptions of the same fact.

Store had the same shape with less coverage: `MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/`
contained only graceful-shutdown and security-header suites, and a repository-wide search for
`MapForwarder`, `IHttpForwarder` or `RouteMap` in its test tree returned nothing. Store's route table
was pinned by no test at all.

**What is genuinely elsewhere is not the route table, and that distinction is worth recording**,
because it is the duplication a reader assumes exists. The Aspire AppHost holds references and
start-ordering (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:252-262`,
`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:251-257`) and the bicep templates hold
`services__<name>__http__0` environment variables on the gateway container app
(`MMCA.ADC/infra/main.bicep:1709-1712`, `MMCA.Store/infra/main.bicep:1434-1436`). Both are **address
books**: service name to URL, with no path prefix anywhere in them. They answer "where does
`conference` resolve" and never "what reaches conference", so neither is a second route table and
neither should become one.

Per-route behavior was hand-written too, and that is where the two repositories had silently diverged.
ADC set `ForwarderRequestConfig.ActivityTimeout` from `Gateway:ForwarderActivityTimeoutSeconds`,
defaulted to `HttpResilienceDefaults.TotalRequestTimeout` plus 10 seconds, so 100 seconds against the
90-second client budget
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:19`), plus a
one-hour `Gateway:HubActivityTimeoutSeconds` for the SignalR route. **Store set no activity timeout
anywhere.** Both of its `ForwarderRequestConfig` constructions omitted it, so every Store route, the
Stripe webhook forward included, ran on YARP's implicit default with no relationship to the resilience
budget the rest of the stack is tuned to. The gap was total rather than partial, and it existed
because a per-route setting written as a constructor argument in one repository is invisible from the
other.

The HTTP version policy had the same shape. ADC sent `HttpVersion.Version20` with
`RequestVersionExact`, h2c prior knowledge, while deliberately leaving both unset on Notification's two
routes because that host runs [ADR-012](012-grpc-host-transport.md)'s mixed-endpoint profile. Store
applied `Version20` plus `RequestVersionExact` to Catalog, Identity and `.well-known`, and left its
Sales routes on YARP's negotiating defaults. The policy was real, per-destination and correct; it was
just expressed as positional arguments at call sites rather than as a property of the destination it
describes.

## Decision
Make configuration the single source of the gateway route table, and pin it with a test.

### 1. `ReverseProxy` configuration is the route table
Each gateway calls `AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"))`
and `MapReverseProxy()`, and the `MapForwarder` lists are deleted. ADC wires it at
`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:112-115` and maps it at `:158`; Store at
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:138-141` and `:172`. Routes and clusters live
in the gateway's own `appsettings.json`: 27 routes over five clusters for ADC (4 identity, 16
conference, 5 engagement, 2 notification, at
`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:58-168`) and 10 routes over three clusters
for Store (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:42-84`). Destinations stay
Aspire service-discovery names, so nothing about ADR-008's transport-at-the-edge posture, the AppHost
wiring or the bicep address book changes: what changed is that the path-prefix-to-cluster mapping is
data rather than a sequence of calls.

Adding a controller to a service then means adding a route entry, not editing and rebuilding a separate
deployable.

### 2. What stays where, stated so it stops being rediscovered
- **`ReverseProxy` configuration owns the routes.** It is the only place a path prefix appears.
- **The AppHost owns dev orchestration.** References and `WaitFor` ordering for local F5, nothing about
  paths.
- **bicep owns deployment topology.** The `services__<name>__http__0` variables that make the
  service-discovery names resolve in Azure Container Apps, nothing about paths.

The rule is that a path prefix belongs to exactly one file per gateway. An address book is not a route
table, and the two must not converge.

### 3. `RouteMapTests` is the drift gate, in both repositories
ADC's `RouteMapTests` is the enumeration of the configured table rather than a hand-typed parallel
list, and it covers every route rather than 23 of 26. A behavioral theory drives each pinned route
through the real proxy pipeline
(`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/RouteMapTests.cs:157-189`) with a recording fake
substituted for `IHttpForwarder` in the factory's test services (`:426-431`), and two completeness
facts read the host's loaded `IProxyConfig` and compare it against the same pinned table, so a route
or cluster added to `appsettings.json` without a corresponding expectation fails, and an expectation
with no route fails as well (`:192`, `:214`). That two-way check is what the previous one-way theory could not
do, and it is the reason a configuration table is safe to adopt: configuration is not compile-checked,
so the check has to be a test. `/Sponsors`, `/CheckIns` and `/Points` are pinned by it now.

Store gained the equivalent suite it had none of
(`MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/RouteMapTests.cs:46`): all ten route prefixes are
pinned to their owning cluster (`:87-99`) and to its destination (`:106-123`, driven through the same
recording forwarder at `:166-183`), with the forwarder budget and the per-cluster version settings
asserted separately (`:259-277`, `:279-298`, `:300-318`). **Updated
2026-08-27: Store's half is no longer one-way.** ADC's two completeness facts are ported, so the
loaded `IProxyConfig` is compared back against the pinned table in both directions: a route added to
`appsettings.json` with no matching entry fails (`:185-205`, the reasoning stated inline at
`:199-201`) and so does a cluster (`:207-241`). The same comparison now doubles as the drift gate on
the shared `MMCA.Common.Gateway` cluster profile, asserting that no cluster declares an activity
timeout of its own any more (`:228-232`).

### 4. The HTTP version policy is expressed in cluster configuration
Each cluster declares its own `HttpRequest` version and version policy beside the destination it
applies to, which is where [ADR-012](012-grpc-host-transport.md)'s per-host profile actually belongs:
the h2c-only hosts declare HTTP/2 with an exact version policy, and the mixed-endpoint hosts (ADC's
Notification, Store's Sales) state neither, keeping the version-negotiating default their websocket
traffic needs. ADC's `identity`, `conference` and `engagement` clusters carry `Version` with
`RequestVersionExact` (`appsettings.json:174-177`, `:183-186`, `:192-195`) and its two Notification
clusters carry no `HttpRequest` block at all (`:197-201`, `:202-206`); Store's `catalog` and `identity`
clusters carry them (`appsettings.json:87-90`, `:96-99`) and its `sales` cluster states neither
(`:104-108`).

Resolving that profile is the framework's job, not each host's. `GatewayClusterProfileConfigFilter` in
the `MMCA.Common.Gateway` package merges three sources per property rather than per block, so a cluster
that states one value keeps inheriting the rest: the cluster's own `HttpRequest`, then
`MmcaGateway:ClusterRequestOverrides[clusterId]`, then `MmcaGateway:ClusterRequestDefaults`
(`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/Configuration/GatewayClusterProfileConfigFilter.cs:59-74`,
precedence stated at `:9-17`). A `GatewayClusterRequestProfile` carries `Version`, `VersionPolicy`,
`ActivityTimeout` and `AllowResponseBuffering` (`.../MMCA.Common.Gateway/GatewaySettings.cs:58`, `:64`,
`:67`, `:70`), declared once in `ClusterRequestDefaults` (`:22`) and narrowed per cluster in
`ClusterRequestOverrides` (`:29`). The version pair is text rather than typed, so a mistyped value
fails at startup with a message naming the cluster instead of binding to a silent default (`:76-111`).
Whatever the merge resolves reaches the forwarder as stated: dropping one cluster to HTTP/1.1 is a
statement in that cluster's own profile, never a switch applied over the loaded table
(`GatewayClusterProfileConfigFilter.cs:18-22`). Both gateways declare their shared profile in that
section, ADC with the one-hour SignalR override its hub route needs
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:27-35`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:22-25`), so the effective per-cluster
policy is readable without opening `Program.cs` in either.

### 5. Store's timeout parity is fixed in the same move
Store's routes gain the activity timeout ADC already has, tied to the same
`HttpResilienceDefaults.TotalRequestTimeout` budget, expressed as configuration rather than as a
constructor argument. Store declares `"ActivityTimeout": "00:01:40"` exactly once, as
`MmcaGateway:ClusterRequestDefaults`
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:22-25`), and the shared cluster profile
of section 4 merges those 100 seconds into all three clusters, none of which states a timeout of its
own. ADC declares the same 100 seconds in the same place, with the one-hour override its hub cluster
needs (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:27-35`). The route-map test pins the
resolved value on every route
(`MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/RouteMapTests.cs:57`, asserted at `:259-277`) and
pins the absence of any per-cluster declaration beside it (`:228-232`), so a cluster that reintroduced
its own would fail rather than silently opt out of the shared budget. This is
folded into this record rather than filed separately because the reason
Store never got it is exactly the reason this record exists: a per-route setting buried in a call site
in one repository is not visible as a missing setting in the other. Moving both tables into the same
declarative shape makes the difference a diff instead of an archaeology exercise.

## Rationale
- **The drift already happened, in the repository that has the most gateway tests.** ADC is the careful
  consumer, and it still carried three unpinned routes, an off-by-one comment and a test description
  matching neither. The argument for configuration is not aesthetic: a hand-maintained list of calls
  produces exactly this, and adding discipline has already been tried.
- **A route table is data, and data belongs in configuration.** Nothing in a forwarder registration is
  a decision the compiler can check anyway: the path is a string, the destination is a string, the
  cluster name is a string. Writing them as C# buys a build step and no verification.
- **Naming the AppHost and bicep as address books prevents the wrong fix.** The instinct on hearing
  "the route table is duplicated" is to unify the AppHost, bicep and the gateway. That would put path
  prefixes into deployment templates, which is the actual multiple-descriptions problem this record is
  trying not to create.
- **Configuration without a test would be worse than code.** A typo in a cluster name was a compile
  error before and is a runtime 502 now. The gate is what makes the trade net-positive, which
  is why it is part of the decision and not a follow-up.
- **Per-destination policy belongs beside the destination.** An HTTP version policy that lives in the
  argument list of one of 26 calls is invisible; the same policy on the cluster is one line under the
  service it describes, and ADR-012's profiles become readable as configuration rather than inferable
  from argument omissions.
- **Folding the Store timeout in keeps the parity fix from being lost.** It is a two-line difference
  that has survived several sweeps precisely because nothing put the two tables side by side.

## Trade-offs
- **The compiler stopped helping.** A misspelled cluster reference, a malformed path pattern or a route
  that shadows another is a runtime failure, discovered as a 404 or a 502, where the previous code would
  not have built. The route-map test is the only thing standing in that gap, so its coverage is now
  load-bearing in a way it never was.
- **Configuration in `appsettings.json` still ships with the image.** Route changes remain a deploy;
  what disappears is the C# edit and the rebuild reasoning, not the release. Calling the table
  "configuration" invites the assumption that it can be changed live, and it cannot unless a future
  change moves it to an external configuration source.
- **Ordering and matching semantics changed.** `MapForwarder` routes were ASP.NET Core endpoints matched
  by the routing table's own precedence; YARP config routes are matched by YARP's rules, with explicit
  `Order` available. Catch-all routes (`/hubs/{**catch-all}`, `/Payments/{**catch-all}`) are the ones
  most likely to behave subtly differently, and they are also the two routes whose failure is least
  visible: a websocket that will not upgrade and a webhook that Stripe silently retries.
- **YARP config exposes transforms the code path never used.** A richer surface is available at the
  moment the table becomes easy to edit, and header or path transforms at the gateway are exactly the
  edge behavior [ADR-088](088-gateway-edge-responsibilities.md) declines to own. Nothing prevents one
  from appearing in a route entry. (2026-08-27: one framework transform now exists, stamping the
  selected route and cluster onto the forwarded request, and ADR-088 narrows its decline to name it
  as the one deliberate exception. The residual stands for route-entry transforms, which are still
  ungated.)
- **Two repositories must land the same shape or the divergence simply moves.** The Store timeout gap
  was the proof that a per-gateway habit does not propagate. Both landed the shape, and one smaller
  difference survived it: Store's route-map suite had no `IProxyConfig` completeness check, closed by
  porting ADC's two completeness facts. What made it close is worth recording: the shared
  `MMCA.Common.Gateway` package gave the two hosts one settings shape to converge on, which is a
  stronger convergence force than either repo noticing the other's diff. Configuration still makes
  divergence easier to see rather than impossible, and the route table itself remains consumer-owned
  by design.
- **A JSON table reviews less well than a code diff.** A reviewer reading 27 routes in
  `appsettings.json` has no types, no navigation and no compiler; the gain in editability is partly a
  loss in review signal, offset only by the test.

## Related
[ADR-008](008-service-extraction-topology.md) (amended: the Gateway keeps the route-to-service map it
was given, now expressed as configuration rather than as forwarder registrations),
[ADR-088](088-gateway-edge-responsibilities.md) (the other half of this wave: what the Gateway does to
a request passing through, as opposed to where it sends it, including the rate-limit bypasses that name
two of the routes this table declares),
[ADR-012](012-grpc-host-transport.md) (the per-host Kestrel profiles whose forwarding counterpart the
cluster version policy now declares beside the destination),
[ADR-009](009-resilience-and-recovery-objectives.md) (the `HttpResilienceDefaults.TotalRequestTimeout`
budget Store's missing activity timeout is being tied back to),
[ADR-084](084-stripe-webhook-ingress.md) and [ADR-039](039-live-channel-push.md) (the two catch-all
routes whose matching semantics deserve the most care in the move),
[ADR-015](015-architecture-fitness-functions.md) (the invariant-over-discipline posture the route-map
gate applies to a table that configuration would otherwise leave unchecked),
[ADR-058](058-runtime-conformance-suites-as-a-package.md) (the booted-host conformance model the
route-map test follows: assert against the running configuration, not against a reflection of the
source).
