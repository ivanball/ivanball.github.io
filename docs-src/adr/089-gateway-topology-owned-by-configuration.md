# ADR-089: Gateway Topology Owned by Configuration

## Status
Accepted (2026-08-18). **Amends [ADR-008](008-service-extraction-topology.md)**: that record gave the
Gateway the route-to-service map and expressed it as code (a list of `MapForwarder` calls). The map
itself is unchanged; what changes is where it is written. YARP `ReverseProxy` **configuration** becomes
the single source of the route table, the per-route HTTP version policy moves into cluster
configuration, and a route-map test becomes the drift gate in both consumer repositories. This is a
consumer-side decision (the framework ships no gateway), and the implementation follows in this wave:
every "today" statement below describes the state as of 2026-08-18, before the change.

## Context
Both gateways build their route table by hand, in code. ADC makes 26 `MapForwarder` calls
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:121-161`) and Store makes 10
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:106-129`). Neither host calls
`AddReverseProxy` or `LoadFromConfig`, and neither `appsettings.json` has a `ReverseProxy` section at
all: YARP is present only as its forwarder primitive. Destinations are Aspire service-discovery names
(`http://identity`, `http://conference`, `http://catalog` and so on) resolved through
`AddHttpForwarderWithServiceDiscovery` (`MMCA.ADC.Gateway/Program.cs:44`,
`MMCA.Store.Gateway/Program.cs:66`), which is the part of the arrangement that is right and stays.

**The problem is not that the table is duplicated across deployment artifacts. It is that one table is
described three times inside one repository, and the three already disagree.** ADC is the worked
example:

1. **The code** registers 15 conference forwarders (`Program.cs:130-144`).
2. **The comment above them** says 16 (`Program.cs:129`).
3. **The test** pins 23 of the 26 routes (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/RouteMapTests.cs:57`),
   leaving `/Sponsors` (`Program.cs:144`), `/CheckIns` (`:148`) and `/Points` (`:150`) unpinned, and its
   own doc comment describes the set as "14 REST controllers + SessionSelection"
   (`RouteMapTests.cs:65`).

Three routes are live and ungated, a comment is off by one, and the test's description matches neither.
None of that was caught, because nothing enumerates the table from a single place: a hand-written list
of calls, a hand-written comment, and a hand-written test theory are three independent transcriptions
of the same fact.

Store has the same shape with less coverage: `MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/`
contains only graceful-shutdown and security-header suites, and a repository-wide search for
`MapForwarder`, `IHttpForwarder` or `RouteMap` in its test tree returns nothing. Store's route table is
pinned by no test at all.

**What is genuinely elsewhere is not the route table, and that distinction is worth recording**,
because it is the duplication a reader assumes exists. The Aspire AppHost holds references and
start-ordering (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:252-262`,
`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:218-226`) and the bicep templates hold
`services__<name>__http__0` environment variables on the gateway container app
(`MMCA.ADC/infra/main.bicep:1671-1674`, `MMCA.Store/infra/main.bicep:1369-1371`). Both are **address
books**: service name to URL, with no path prefix anywhere in them. They answer "where does
`conference` resolve" and never "what reaches conference", so neither is a second route table and
neither should become one.

Per-route behavior is hand-written too, and that is where the two repositories have silently diverged.
ADC sets `ForwarderRequestConfig.ActivityTimeout` from `Gateway:ForwarderActivityTimeoutSeconds`,
defaulted to `HttpResilienceDefaults.TotalRequestTimeout` plus 10 seconds, so 100 seconds against the
90-second client budget (`MMCA.ADC.Gateway/Program.cs:81-83`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:19`), plus a
one-hour `Gateway:HubActivityTimeoutSeconds` for the SignalR route (`Program.cs:88-90`), applied at
`:95`, `:103`, `:108` and `:110`. **Store sets no activity timeout anywhere.** Both of its
`ForwarderRequestConfig` constructions (`MMCA.Store.Gateway/Program.cs:88`, `:97`) omit it, so every
Store route, the Stripe webhook forward at `:129` included, runs on YARP's implicit default with no
relationship to the resilience budget the rest of the stack is tuned to. The gap is total rather than
partial, and it exists because a per-route setting written as a constructor argument in one repository
is invisible from the other.

The HTTP version policy has the same shape. ADC gates HTTP/2 on a `ForwardHttp2` switch
(`Program.cs:73`, set in `appsettings.json:13`) and sends `HttpVersion.Version20` with
`RequestVersionExact` (`:96`, `:101`), h2c prior knowledge, while deliberately leaving both unset on
Notification's two routes (`:108`, `:110`) because that host runs [ADR-012](012-grpc-host-transport.md)'s
mixed-endpoint profile. Store has the same switch in code only, with no `appsettings.json` key
(`Program.cs:86`), applies `Version20` plus `RequestVersionExact` to Catalog, Identity and
`.well-known` (`:90`, `:95`), and leaves its Sales routes on YARP's HTTP/1.1 defaults (`:126-129`). The
policy is real, per-destination and correct; it is just expressed as positional arguments at call
sites rather than as a property of the destination it describes.

## Decision
Make configuration the single source of the gateway route table, and pin it with a test.

### 1. `ReverseProxy` configuration is the route table
Each gateway calls `AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"))`
and `MapReverseProxy()`, and the `MapForwarder` lists are deleted. Routes and clusters live in the
gateway's own `appsettings.json`. Destinations stay Aspire service-discovery names, so nothing about
ADR-008's transport-at-the-edge posture, the AppHost wiring or the bicep address book changes: what
changes is that the path-prefix-to-cluster mapping is data rather than a sequence of calls.

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
ADC's `RouteMapTests` becomes the enumeration of the configured table rather than a hand-typed parallel
list, and it must cover every route rather than 23 of 26. Store gains an equivalent suite where it has
none today. The test reads the host's loaded proxy configuration, so a route added to `appsettings.json`
without a corresponding expectation fails, and an expectation with no route fails as well. That
two-way check is what the current one-way theory could not do, and it is the reason a configuration
table is safe to adopt: configuration is not compile-checked, so the check has to be a test.

### 4. The HTTP version policy is expressed in cluster configuration
Each cluster declares its own `HttpRequest` version and version policy beside the destination it
applies to, which is where [ADR-012](012-grpc-host-transport.md)'s per-host profile actually belongs:
the h2c-only hosts declare HTTP/2 with an exact version policy, and the mixed-endpoint hosts (ADC's
Notification, Store's Sales) declare the HTTP/1.1-capable profile their websocket traffic needs. The
`ForwardHttp2` switch keeps its meaning as the environment-level override, and ADC's habit of writing
it into `appsettings.json` becomes both repositories' habit, so the effective policy is readable
without opening `Program.cs`.

### 5. Store's timeout parity is fixed in the same move
Store's routes gain the activity timeout ADC already has, tied to the same
`HttpResilienceDefaults.TotalRequestTimeout` budget, expressed as configuration rather than as a
constructor argument. This is folded into this record rather than filed separately because the reason
Store never got it is exactly the reason this record exists: a per-route setting buried in a call site
in one repository is not visible as a missing setting in the other. Moving both tables into the same
declarative shape makes the difference a diff instead of an archaeology exercise.

## Rationale
- **The drift already happened, in the repository that has the most gateway tests.** ADC is the careful
  consumer, and it still carries three unpinned routes, an off-by-one comment and a test description
  matching neither. The argument for configuration is not aesthetic: a hand-maintained list of calls
  produces exactly this, and adding discipline has already been tried.
- **A route table is data, and data belongs in configuration.** Nothing in a forwarder registration is
  a decision the compiler can check anyway: the path is a string, the destination is a string, the
  cluster name is a string. Writing them as C# buys a build step and no verification.
- **Naming the AppHost and bicep as address books prevents the wrong fix.** The instinct on hearing
  "the route table is duplicated" is to unify the AppHost, bicep and the gateway. That would put path
  prefixes into deployment templates, which is the actual multiple-descriptions problem this record is
  trying not to create.
- **Configuration without a test would be worse than code.** A typo in a cluster name is a compile
  error today and a runtime 502 after this change. The gate is what makes the trade net-positive, which
  is why it is part of the decision and not a follow-up.
- **Per-destination policy belongs beside the destination.** An HTTP version policy that lives in the
  argument list of one of 26 calls is invisible; the same policy on the cluster is one line under the
  service it describes, and ADR-012's profiles become readable as configuration rather than inferable
  from argument omissions.
- **Folding the Store timeout in keeps the parity fix from being lost.** It is a two-line difference
  that has survived several sweeps precisely because nothing put the two tables side by side.

## Trade-offs
- **The compiler stops helping.** A misspelled cluster reference, a malformed path pattern or a route
  that shadows another is a runtime failure, discovered as a 404 or a 502, where the current code would
  not have built. The route-map test is the only thing standing in that gap, so its coverage is now
  load-bearing in a way it never was.
- **Configuration in `appsettings.json` still ships with the image.** Route changes remain a deploy;
  what disappears is the C# edit and the rebuild reasoning, not the release. Calling the table
  "configuration" invites the assumption that it can be changed live, and it cannot unless a future
  change moves it to an external configuration source.
- **Ordering and matching semantics change.** `MapForwarder` routes are ASP.NET Core endpoints matched
  by the routing table's own precedence; YARP config routes are matched by YARP's rules, with explicit
  `Order` available. Catch-all routes (`/hubs/{**catch-all}`, `/Payments/{**catch-all}`) are the ones
  most likely to behave subtly differently, and they are also the two routes whose failure is least
  visible: a websocket that will not upgrade and a webhook that Stripe silently retries.
- **YARP config exposes transforms the code path never used.** A richer surface is available at the
  moment the table becomes easy to edit, and header or path transforms at the gateway are exactly the
  edge behavior [ADR-088](088-gateway-edge-responsibilities.md) declines to own. Nothing prevents one
  from appearing in a route entry.
- **Two repositories must land the same shape or the divergence simply moves.** The Store timeout gap
  is the proof that a per-gateway habit does not propagate. Configuration makes divergence easier to
  see and does not make it impossible, and no shared framework code enforces the shape, since the
  gateways are consumer-owned hosts by design.
- **A JSON table reviews less well than a code diff.** A reviewer reading 26 routes in
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
