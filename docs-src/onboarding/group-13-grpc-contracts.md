# 13. gRPC & Inter-Service Contracts

**What this chapter is about.** Once the ADC modules stopped sharing a process and became four
separate service hosts (Identity, Conference, Engagement, Notification), the in-process method calls
between them had to cross a network boundary. Asynchronous, fire-and-forget flows go over the broker
via the outbox (see [`IMessageBus`](group-04-events-outbox.md#imessagebus) and
[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)); but some calls need a
*synchronous answer*: "is this session valid to bookmark?", "how many bookmarks does this session
have?", "give me the user ids of every attendee", "is this event live right now?". This chapter is the
**synchronous transport boundary**: a tiny, transport-only package (`MMCA.Common.Grpc`) plus a
per-consumer `*.Contracts` convention that together let a module be lifted out of the monolith and
called over **gRPC** *without rewriting a line of application or domain code*. The governing decision
is [ADR-007 (gRPC extraction)](https://ivanball.github.io/docs/adr/007-grpc-extraction.html), with the
supporting topology in [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)
(YARP service mesh), auth in [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)
(JWKS dual-fetch), the executable contract governance in
[ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html), and the concrete
Kestrel/HTTP-2 transport profiles in
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html). `[Rubric §7, Microservices
Readiness]` is the headline lens here: it assesses whether modules can genuinely be extracted, with
explicit, versioned contracts and transport kept at the edge. `[Rubric §9, API & Contract Design]` is
the second, because the goal is that an error looks the same to a caller whether the answer came from
an in-process object or a wire hop.

**The cast of types in this group is small, and all but one lives in `MMCA.Common.Grpc`**: a
*transport-only* package that, per Clean Architecture, depends on **`Shared` only** (it must never
couple to Domain, Application, or Infrastructure; see [primer §1](00-primer.md#1-the-big-picture)).
There are six: [`DependencyInjection`](#dependencyinjection) (the registration surface,
`AddGrpcServiceDefaults()` server-side and `AddTypedGrpcClient<TClient>(serviceName)` client-side, at
`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:15`),
[`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) (server-side: turns a failed
`Result` into an `RpcException`),
[`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) (client-side: forwards the
caller's bearer token downstream), [`ResultGrpcExtensions`](#resultgrpcextensions) (the whole
`Result` to `RpcException` mapping, in both directions),
[`ResultFailureException`](#resultfailureexception) (the in-band carrier between a service method and
that interceptor), and the lone `MMCA.Common.Shared` marker
[`ServiceContractAttribute`](#servicecontractattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:21`), which tags
the wire surface of an extracted service. The concrete `.proto` definitions and the typed clients they
generate do *not* live here: they live in each consumer's `*.Contracts` project (ADC's
`MMCA.ADC.Conference.Contracts`, `.Engagement.Contracts`, `.Identity.Contracts`,
`.Notification.Contracts`), which this package exists to wire up.

**The contract-package convention.** Anything whose project name ends in `.Contracts` is special:
`Directory.Build.props` in all three consuming repos auto-pulls `Grpc.Tools`, `Google.Protobuf`, and
`Grpc.Net.ClientFactory`, and compiles every `Protos/**/*.proto` with `GrpcServices="Both"`
(`MMCA.ADC/Directory.Build.props:114-122`, mirrored at `MMCA.Common/Directory.Build.props:150-157`),
so a single shared package produces *both* the server base class and the client stub. The deliberate
design choice ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)) is that each
`.Contracts` project also ships a **hand-written gRPC adapter** that implements the *same C# interface
the modules already used in-process*. Concretely: Conference's code depends on the interface
`IBookmarkCountService` (declared in `MMCA.ADC.Engagement.Shared` and marked `[ServiceContract]` at
`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/IBookmarkCountService.cs:10`);
the in-process implementation lives in Engagement; the cross-process implementation is
`BookmarkCountServiceGrpcAdapter`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/BookmarkCountServiceGrpcAdapter.cs:14`), an
`internal sealed` class holding a generated `BookmarkCountServiceClient` that translates an interface
call into a gRPC call and the proto response back into the C# return type
(`BookmarkCountServiceGrpcAdapter.cs:27-35`). Because both the in-process service and the adapter
satisfy the *identical interface*, swapping monolith for microservice is a **registration change, not
a rewrite**, which is the whole point of the boundary. Every adapter also sets a per-call `deadline`
from a five-second `CallDeadline` constant (`BookmarkCountServiceGrpcAdapter.cs:20`,
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:35`),
deliberately far tighter than the shared resilience budget, so a *hung* peer (as opposed to a refusing
one) fails fast instead of stalling the caller's inline request.

**How the swap actually happens at the composition root.** Each `.Contracts` project also ships an
`extension(IServiceCollection)` DI helper, for example `AddConferenceSessionValidationClient()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:43`), that does two
things: (1) calls Common's `AddTypedGrpcClient<TClient>(serviceName)` to register the generated gRPC
client against the named service (`DependencyInjection.cs:45`), and (2) calls
`services.Replace(ServiceDescriptor.Scoped<...>())`, *not* `TryAdd`, to overwrite whatever
`ISessionBookmarkValidationService` is already in the container with the gRPC adapter
(`DependencyInjection.cs:49`). The `Replace` is deliberate and documented in place
(`DependencyInjection.cs:47-48`): by the time the host calls this, the container holds *either* the
real in-process implementation (if that peer module is enabled in this host) *or* a `Disabled*` stub
registered by the module when the peer is disabled. `Replace` wins over both, so after the call the
resolved interface is always the gRPC adapter pointing at the extracted peer. Ordering is not left to
chance: each host registers these helpers as steps inside
`services.AddMmcaApplicationPipeline(pipeline => pipeline.Register(moduleHost.RegisterModules).Register(s => s.AddConferenceSessionValidationClient())...)`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:278-282`), so module discovery runs
first and the client replacements run after it, in declaration order.

**`Result` over the wire, the outbound half.** The codebase's pervasive
[`Result`](group-01-result-error-handling.md#result) pattern (errors as values, not exceptions; see
[primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) survives the hop intact. On
the **server**, a gRPC service implementation calls the inner C# service, gets back a `Result`, and
calls `result.ThrowIfFailure()` (from [`ResultGrpcExtensions`](#resultgrpcextensions),
`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:69`); see
`SessionBookmarksGrpcService`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:39`). That
guard throws a [`ResultFailureException`](#resultfailureexception)
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Exceptions/ResultFailureException.cs:16`) carrying
the [`Error`](group-01-result-error-handling.md#error) list
(`ResultFailureException.cs:35`, `:39`). The
[`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) registered by
`AddGrpcServiceDefaults()` catches it for all four server call shapes (unary, server-, client-, and
duplex-streaming, at `GrpcResultExceptionInterceptor.cs:22`, `:42`, `:63`, `:83`), logs it through a
source-generated `LoggerMessage` (`GrpcResultExceptionInterceptor.cs:140`), and rethrows
`errors.ToRpcException()`. That encoder (`ResultGrpcExtensions.cs:112`) picks the status from the
**most severe** error rather than the first, via
[`ErrorTypeSeverity`](group-01-result-error-handling.md#errortypeseverity)`.MostSevere`
(`ResultGrpcExtensions.cs:117`), so an aggregate built by `Result.Combine` cannot be downgraded by
error ordering; the `ErrorType` to `StatusCode` table itself is a `FrozenDictionary`
(`ResultGrpcExtensions.cs:35-47`) that *mirrors* the HTTP mapping in
[`ErrorHttpMapping`](group-12-api-hosting-mapping.md#errorhttpmapping) used by
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase). Every error is then
serialized into the trailers as `error-{i}-code`, `-message`, `-type`, and (when non-empty) `-source`
and `-target` entries (`ResultGrpcExtensions.cs:125-140`).

**`Result` over the wire, the inbound half.** The same class owns the decoder, so the round trip is
closed by framework code rather than by hand-rolled parsing in each adapter. `Metadata.ToErrors()`
(`ResultGrpcExtensions.cs:165`) walks `error-{i}-code` from index zero and stops at the first gap,
matching the contiguous layout the encoder writes, and an unrecognized `error-{i}-type` falls back to
`ErrorType.Failure` instead of throwing (`ResultGrpcExtensions.cs:269-272`), so a newer peer that adds
an error type cannot break an older client. On top of that, `RpcException.ToResult()` and
`ToResult<T>()` (`ResultGrpcExtensions.cs:210` and `:234`) hand the caller a failed `Result` directly:
structured trailers win when present, and a pure transport fault that carries none (a reset
connection, an exceeded deadline) degrades to a single `ErrorType.Failure` error coded
`Grpc.{StatusCode}` and stamped with the calling member's name via `[CallerMemberName]`
(`ResultGrpcExtensions.cs:285-289`). A client adapter's catch block is therefore one line:
`return ex.ToResult();`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:58`).
That symmetry, one error model over two transports, is the `[Rubric §9, API & Contract Design]` and
`[Rubric §10, Cross-Cutting Concerns]` story: error translation is a pipeline concern, written once in
the interceptor and its extension pair, not repeated in every method. One sharp edge is documented in
the interceptor itself (`GrpcResultExceptionInterceptor.cs:103-138`): a `ResultFailureException` built
from a message-only constructor carries *no* errors, so the shared encoder would answer the
placeholder detail "Unspecified failure"; the interceptor keeps `StatusCode.Internal` for that case
and substitutes the real message (plus any inner exception's message) rather than synthesizing an
`Error.Failure`, which would map to `InvalidArgument` and wrongly blame the caller.

**Auth and the network shape.** Every typed client wired by `AddTypedGrpcClient<TClient>`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:66`) gets a
[`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) (`DependencyInjection.cs:72-77`)
that copies the inbound `Authorization` header off the current `HttpContext` onto the outgoing call's
metadata, so the caller's JWT rides along to the downstream service and distributed authorization
works without each handler threading a token by hand. It is a no-op outside an HTTP request, for
example in a background processor
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/JwtForwardingClientInterceptor.cs:82-85`),
and it refuses to duplicate a header a prior interceptor already set
(`JwtForwardingClientInterceptor.cs:90-94`). It is the gRPC counterpart of the HTTP
[`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler). The
downstream service validates that forwarded token against the issuer's **JWKS**, not a shared secret
([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html); see
[`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) / [`IJwksProvider`](group-08-auth.md#ijwksprovider)).
The server half also sets `EnableDetailedErrors = false` and adds server reflection
(`DependencyInjection.cs:33`, `:36`), so tools like grpcurl can introspect the schema without exception
detail leaking to callers. `[Rubric §11, Security]` is touched three times over here: federated JWT
validation rather than a shared secret, token forwarding that never widens the caller's authority, and
detailed errors kept off.

**The transport is HTTP/2 cleartext (h2c) with prior knowledge.** The client addresses
`http://{serviceName}` (`DependencyInjection.cs:75-76`), resolved by **Aspire service discovery**,
because Aspire's project-resource discovery does not reliably expose an `https` key for these peers;
the Sonar cleartext warning is suppressed in place with that rationale (`DependencyInjection.cs:74`). A
deliberate `SocketsHttpHandler` override (`DependencyInjection.cs:89-97`) forces
`EnableMultipleHttp2Connections` and re-applies the pooled-lifetime and keep-alive values from
[`HttpResilienceDefaults`](group-16-aspire-orchestration.md#httpresiliencedefaults), because the global
`ConfigureHttpClientDefaults` from `MMCA.Common.Aspire` applies to *all* `HttpClient`s and its wrapper
can defeat HTTP/2 negotiation. On top of that, `AddStandardResilienceHandler` gives every gRPC client
an explicit Polly pipeline sourced entirely from
[`GrpcResilienceDefaults`](group-16-aspire-orchestration.md#grpcresiliencedefaults)
(`DependencyInjection.cs:106-115`): the attempt timeout, total timeout, and retry budget are the same
values the HTTP defaults use, and the circuit-breaker values are spelled out (`FailureRatio` 0.5,
`MinimumThroughput` 10, `BreakDuration` 10 seconds, at
`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/GrpcResilienceDefaults.cs:27-33`) precisely
because an east-west gRPC call bypasses the Gateway's active health checks
`[Rubric §29, Resilience & Business Continuity]`.

**Two Kestrel profiles, per endpoint and not per host**
([ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html)). A host that serves
inbound gRPC and nothing that needs HTTP/1.1 runs `Http2`-only on its cleartext endpoint:
`"Kestrel": { "EndpointDefaults": { "Protocols": "Http2" } }` in ADC's Conference, Engagement, and
Identity services (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/appsettings.json:9-12`), and
in Store's Catalog and Identity. A host that must *also* speak HTTP/1.1 splits protocols across two
named endpoints in one process: ADC's Notification keeps `Http1AndHttp2` on `http` (port 8080) for
REST, probes, and the SignalR WebSocket upgrade handshake, and declares a second `Http2`-only `grpc`
endpoint on port 8081
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:9-19`); Store's Sales host
runs that same mixed profile. That second profile is why one client registration names its target
`"_grpc.notification"` rather than `"notification"`
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:42`): Aspire service
discovery injects a `services__notification__grpc__0` key for the named endpoint, and the `_grpc.`
prefix selects it.

**The live topology in ADC.** There are seven gRPC edges today, one per `.proto` under
`MMCA.ADC/Source/Services/*/Protos/`, each with a generated client, a hand-written adapter, and a
server-side service class. Reading them as consumer to producer: Engagement to Conference for
`ISessionBookmarkValidationService` and `IEventLiveValidationService`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:280-281`), Engagement to Notification
for the best-effort live-channel push (`Program.cs:282`, replacing the framework's
[`NullLiveChannelPublisher`](group-10-notifications.md#nulllivechannelpublisher) behind
[`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher)), Conference to Engagement
for `IBookmarkCountService` on the speaker dashboard
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:349`), Notification to Identity for
attendee user ids (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:217`), and
Identity to Engagement plus Identity to Notification for the cross-service data-subject export
aggregation (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:290-291`). Server sides are
mapped in each host with `AddGrpcServiceDefaults()` plus `app.MapGrpcService<...>()`, mostly behind
`.RequireAuthorization()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:361`, `:396-397`).

**The startup-ordering edge worth knowing.** Conference and Engagement call *each other*, so the
AppHost gives Engagement a `WithReference(conference).WaitFor(conference)` but the reverse Conference
to Engagement edge only a `WithReference` with **no `WaitFor`**
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:270`, `:273`), because a reciprocal wait would
deadlock startup with each service waiting for the other to be healthy. The same reasoning drops the
`WaitFor` on Engagement to Notification (`Program.cs:281`) and on both Identity edges
(`Program.cs:291-292`); only Notification to Identity keeps one (`Program.cs:268`). The transient
"peer not ready" errors that result self-heal through the resilience pipeline. This is the practical
cost [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) calls out: mutual
synchronous dependencies need care, and the retry plus circuit breaker is what makes them tolerable.

**Governance: the marker is adopted and enforced.**
[`ServiceContractAttribute`](#servicecontractattribute) marks a type as part of an extracted service's
wire surface, applied to the C# interface, the integration-event records, and the boundary DTOs, with
an optional `Version` that defaults to `"v1"`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:34-37`).
MMCA.Common itself marks no type, so the rule is a ratchet in the framework repo and bites in a
consumer the moment its first contract type is marked. In ADC six interfaces carry it today
(`ISessionBookmarkValidationService`, `IEventLiveValidationService`, `IBookmarkCountService`,
`IUserEngagementExportService`, `IAttendeeQueryService`, `IUserNotificationExportService`), and Store
marks its own. Two fitness functions read the attribute by full name
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Contracts.cs:10`): the
**purity** rule, that a contract type must not reach into the producing service's Domain, Application,
or Infrastructure (`ArchitectureRules.Contracts.cs:32`, exposed through
[`ServiceContractPurityTestsBase`](group-27-testing-infrastructure.md#servicecontractpuritytestsbase)),
and the **encapsulation** rule, that the class serving a `[ServiceContract]` interface must not be
public (`ArchitectureRules.Contracts.cs:81`, exposed through
[`ContractImplementationTestsBase`](group-27-testing-infrastructure.md#contractimplementationtestsbase)),
which is why every gRPC adapter above is `internal sealed`. Alongside them,
[`MicroserviceExtractionTestsBase`](group-27-testing-infrastructure.md#microserviceextractiontestsbase)
forbids MassTransit and gRPC types from leaking into Application, Domain, or Shared. Each repo
subclasses all three (for example
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ServiceContractPurityTests.cs:9`). That is the
executable governance keeping this transport genuinely at the edge
`[Rubric §34, Architecture Governance & Documentation]` and `[Rubric §15, Best Practices & Code
Quality]`. Generated gRPC client classes need no attribute: they are part of the contract surface by
virtue of their `.proto`.

### JwtForwardingClientInterceptor
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Interceptors` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/JwtForwardingClientInterceptor.cs:19` · Level 0 · class (sealed)

- **What it is**: a gRPC **client-side** interceptor that copies the inbound `Authorization` header
  from the current `HttpContext` onto every outgoing gRPC call's metadata, so the caller's JWT bearer
  token rides along to downstream services. It is the gRPC counterpart of the HTTP
  [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler) in
  the API/Infrastructure layer.
- **Depends on**: `Grpc.Core.Interceptors.Interceptor` (the base class) and `Grpc.Core` call types
  (NuGet, see [primer §3, "Transport"](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0));
  `Microsoft.AspNetCore.Http.IHttpContextAccessor` (ASP.NET Core, injected as a primary-constructor
  parameter, `JwtForwardingClientInterceptor.cs:19`). Nothing first-party: it lives in
  `MMCA.Common.Grpc`, which by the layer rules depends on **`Shared` only** and is pure transport (see
  [primer §1](00-primer.md#1-the-big-picture)).
- **Concept introduced, gRPC interceptors and token forwarding across a service mesh.** `[Rubric §7,
  Microservices Readiness]` (assesses whether application code talks to abstractions while transport
  concerns live at the edges; here, cross-service auth is handled by a transport interceptor, not by
  every handler threading a token). `[Rubric §11, Security]` (assesses how credentials propagate; this
  forwards the bearer token so distributed authorization works end-to-end without re-authenticating at
  each hop). A gRPC **interceptor** is the gRPC equivalent of an HTTP `DelegatingHandler` / ASP.NET
  middleware: it wraps every call in a pipeline. There are **five** client call shapes (unary async and
  blocking, server-streaming, client-streaming, duplex-streaming) and this interceptor overrides all
  five, so no call variant can bypass token forwarding. It is the **client** side of the cross-service
  auth story whose **server** side is JWKS validation
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), see
  [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider)).
- **Walkthrough**: members in execution order.
  - `private const string AuthorizationHeader = "Authorization"`
    (`JwtForwardingClientInterceptor.cs:21`), the single header name.
  - The five overrides (`AsyncUnaryCall` line 24, `BlockingUnaryCall` line 35,
    `AsyncServerStreamingCall` line 46, `AsyncClientStreamingCall` line 57, `AsyncDuplexStreamingCall`
    line 67) each follow the same three-step shape:
    `ArgumentNullException.ThrowIfNull(continuation)`, build a new context via
    `WithForwardedAuthorization(context)`, then invoke `continuation(...)`. The two streaming variants
    whose continuation takes no `request` argument call `continuation(newContext)` (lines 63 and 73);
    the other three pass `(request, newContext)`.
  - `WithForwardedAuthorization<TRequest, TResponse>` (`JwtForwardingClientInterceptor.cs:76-99`) is the
    shared helper. It reads `httpContextAccessor.HttpContext?.Request?.Headers.Authorization.ToString()`
    (line 81); if that is null or empty it returns the context **unchanged** (lines 82-85), the
    deliberate **no-op when there is no HTTP request**, for example a background processor or hosted
    service invoking a gRPC client outside a request. Otherwise it takes the call's existing
    `Options.Headers` (or a fresh `Metadata` via the collection expression `[]`, line 87), then **checks
    whether `Authorization` is already present** (lines 90-94) and bails out if a prior interceptor or
    the caller already set it, so the header is never duplicated. Only then does it `headers.Add(...)`
    (line 96), rebuild the call options with `WithHeaders` (line 97), and return a new
    `ClientInterceptorContext` carrying `context.Method`, `context.Host`, and the new options (line 98).
- **Why it's built this way**: sealing the class and overriding all five call shapes makes token
  forwarding total, so there is no call shape that silently drops the credential. Doing it in an
  interceptor rather than at each call site keeps consumer code transport-agnostic, which is exactly the
  extraction boundary [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) want. The
  duplicate-header guard means it composes safely with other interceptors.
- **Where it's used**: registered automatically by `AddTypedGrpcClient<TClient>` in this group's
  [`DependencyInjection`](#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:72,77`), so every typed gRPC
  client an ADC or Store service host builds gets it without explicit wiring.

### ServiceContractAttribute
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:21` · Level 0 · class (sealed attribute)

- **What it is**: an attribute marking an interface, DTO, or integration-event record as part of a
  service's **wire contract**, the surface published in a `*.Contracts` NuGet package for an extracted
  microservice.
- **Depends on**: `System.Attribute` (BCL) only.
- **Concept introduced, explicit service contracts plus attribute-driven governance.** `[Rubric §7,
  Microservices Readiness]` (assesses explicit, versioned contracts and extractability) and `[Rubric §9,
  API & Contract Design]` (versioned contracts). When a module is lifted into its own service
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)), the types consumers depend
  on (the service interface, the integration-event records, the boundary DTOs) are tagged
  `[ServiceContract]` so the wire surface is *identifiable by tooling*. That identification is what makes
  `[Rubric §34, Architecture Governance & Documentation]` apply: the invariant stated in the attribute's
  own doc comment (`ServiceContractAttribute.cs:6-9`) is not advisory, it is executed as a fitness
  function. `ArchitectureRules.ServiceContractsDoNotDependOnServiceInternals`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Contracts.cs:32`)
  scans every assembly the repo's architecture map registers, selects the types that carry the marker
  (`MeetCustomRule(CarriesServiceContractAttribute)`, line 44, matched by the full type name string held
  in `ServiceContractAttributeFullName`, lines 10-11), and asserts none of them depends on the producing
  service's Domain, Application, or Infrastructure namespaces. A second rule,
  `ServiceContractImplementationsAreNotPublic` (`ArchitectureRules.Contracts.cs:81`), walks the same
  marker in the other direction: a type implementing a `[ServiceContract]` interface must not itself be
  public, because the interface is the published surface, not the implementation.
- **Walkthrough**: `[AttributeUsage(AttributeTargets.Interface | AttributeTargets.Class |
  AttributeTargets.Struct, Inherited = false)]` (`ServiceContractAttribute.cs:20`) constrains where it
  can be applied and keeps it off derived types; two constructors, parameterless (line 26) and one taking
  a `version` string (line 34); a get-only `Version` property initialized to `"v1"` (line 37), so the
  parameterless form still reports a version.
- **Why it's built this way**: an attribute is the lightest way to *mark* membership in a category that
  tooling and tests then enforce, and the marker is deliberately **attribute-driven rather than
  layer-driven**. The remarks on
  `ServiceContractPurityTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ServiceContractPurityTestsBase.cs:9-11`)
  explain why: no repo registers a `Layer.Contracts` entry in its architecture map today, so a
  layer-iterating rule would pass vacuously forever, while scanning every mapped assembly for the marker
  catches contract types wherever they actually live (in practice, in each module's `*.Shared` project).
  The base class is also honest about the empty case (lines 12-18): a repo that marks no type passes
  without asserting anything, and MMCA.Common itself ships no `[ServiceContract]` type, so within the
  framework the rule is a **ratchet** that bites the moment a first contract type is marked. It
  complements, and does not replace, the transport- and layer-purity rules
  ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)) that guard the
  same boundary from the layer side.
- **Where it's used**: the marker is **applied in the consumer repos, not in MMCA.Common**. Nine
  interfaces carry it today: in ADC,
  [`IAttendeeQueryService`](group-24-identity-module.md#iattendeequeryservice)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IAttendeeQueryService.cs:10`),
  [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/IBookmarkCountService.cs:10`),
  [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sessions/ISessionBookmarkValidationService.cs:10`),
  [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/IEventLiveValidationService.cs:11`),
  `IUserEngagementExportService`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Exports/IUserEngagementExportService.cs:13`),
  and `IUserNotificationExportService`
  (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/UserNotifications/IUserNotificationExportService.cs:13`);
  in Store, `IProductVariantService`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IProductVariantService.cs:19`),
  `ICustomerService`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/Customers/ICustomerService.cs:25`), and
  `IUserSalesExportService`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/Exports/IUserSalesExportService.cs:20`). The
  rules that read the marker are surfaced to each repo through
  [`ServiceContractPurityTestsBase`](group-27-testing-infrastructure.md#servicecontractpuritytestsbase)
  (`ServiceContractPurityTestsBase.cs:20-26`) and
  [`ContractImplementationTestsBase`](group-27-testing-infrastructure.md#contractimplementationtestsbase)
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ContractImplementationTestsBase.cs:20,34`),
  which Common, ADC, Store, and Helpdesk each subclass in their architecture-test project.
- **Caveats / not-in-source**: generated gRPC client and server classes are **not** marked; the doc
  comment (`ServiceContractAttribute.cs:16-17`) states they are part of the contract surface by virtue of
  being declared in a `.proto` file, so the attribute is not needed on them. The `Version` value is
  metadata only: no source read in this group consumes it, so it does not participate in any wire-level
  version negotiation.

### ResultFailureException
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Exceptions` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Exceptions/ResultFailureException.cs:16` · Level 2 · class (sealed)

- **What it is**: a typed exception that carries the `IReadOnlyList<Error>` from a failing
  [`Result`](group-01-result-error-handling.md#result). gRPC service implementations raise it indirectly
  via `result.ThrowIfFailure()`; the
  [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) catches it and translates it into
  an `RpcException` with the right status code and structured error trailers.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error) (via
  `using MMCA.Common.Shared.Abstractions`, `ResultFailureException.cs:1`); `System.Exception` (BCL).
- **Concept introduced, bridging the Result pattern across the gRPC transport.** `[Rubric §9, API &
  Contract Design]` (assesses consistent error shapes across transports) and `[Rubric §7, Microservices
  Readiness]` (the gRPC extraction boundary). gRPC has no native "return a failure value": failures
  travel as `RpcException` plus a status code. So the
  [`Result`](group-01-result-error-handling.md#result) pattern (taught in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) and G01) is adapted to the
  wire by smuggling the failure through a single exception type, internal to the transport edge, whose
  payload is the original `Error` list, so the interceptor can rebuild the exact same
  `Code`/`Message`/`Type`/`Source`/`Target` fields a consumer would have seen over HTTP. This mirrors the
  HTTP side: where REST maps `Result` failures to RFC 9457 Problem Details in
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase), gRPC maps them to
  `RpcException`.
- **Walkthrough**: four constructors. The three standard `Exception` constructors (parameterless line 19,
  message line 24, message plus inner exception line 30) each set `Errors = []` and exist **only to
  satisfy CA1032**, the analyzer that requires the full exception constructor set (stated at line 18).
  The meaningful one is `ResultFailureException(IReadOnlyList<Error> errors)` (line 35), whose message is
  built by the private `BuildMessage` (line 41): it joins the errors as `"Code: Message"` pairs, or
  answers the literal `"Result failure"` when the list is empty. `Errors` (line 39) is a get-only
  property, documented as empty for the three CA1032 constructors.
- **Why it's built this way**: using a *single, dedicated* exception rather than throwing arbitrary
  exceptions lets the server interceptor catch exactly one type and translate it deterministically;
  anything else propagating out is a genuine fault. The XML doc (lines 11-14) is explicit that service
  code should **not** `throw` this directly, it should call `result.ThrowIfFailure()` from
  [`ResultGrpcExtensions`](#resultgrpcextensions), which keeps the throw site uniform and guarantees the
  `Errors`-carrying constructor is the one used.
- **Where it's used**: thrown by `ThrowIfFailure()` and `UnwrapOrThrow<T>()` in
  [`ResultGrpcExtensions`](#resultgrpcextensions)
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:74,91`); caught by
  [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) in all four server-handler shapes.
- **Caveats / not-in-source**: the three CA1032 constructors produce an instance with **no** errors, and
  that case is not free downstream. The interceptor treats it specially (see
  `GrpcResultExceptionInterceptor.cs:126-138`) because the normal encoder would otherwise flatten the
  message away; prefer the `IReadOnlyList<Error>` constructor, which is what `ThrowIfFailure` uses.

### GrpcResultExceptionInterceptor
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Interceptors` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/GrpcResultExceptionInterceptor.cs:19` · Level 3 · class (sealed, partial)

- **What it is**: a **server-side** gRPC `Interceptor` that catches
  [`ResultFailureException`](#resultfailureexception) thrown by service implementations and rethrows it
  as an `RpcException` carrying the correct `StatusCode` and structured error trailers, across all four
  server-handler shapes (unary, server-streaming, client-streaming, duplex).
- **Depends on**: [`ResultFailureException`](#resultfailureexception) (Level 2); `ToRpcException` from
  [`ResultGrpcExtensions`](#resultgrpcextensions) (Level 3, called as `exception.Errors.ToRpcException()`
  at `GrpcResultExceptionInterceptor.cs:130`); `Grpc.Core.Interceptors.Interceptor` and `Grpc.Core`
  (NuGet); `Microsoft.Extensions.Logging.ILogger<T>` (injected as a primary-constructor parameter,
  line 19).
- **Concept reinforced, error translation as a cross-cutting concern, symmetric with the HTTP layer.**
  `[Rubric §7, Microservices Readiness]` (assesses that error handling is symmetric across HTTP and gRPC)
  and `[Rubric §10, Cross-Cutting Concerns]` (error translation lives in one interceptor, not re-coded in
  every service method). The doc comment (lines 11-13) names the parallel explicitly: this "mirrors the
  behavior of `ApiControllerBase.HandleFailure` for HTTP responses". `[Rubric §13, Observability &
  Operability]` also applies: every caught failure is logged with the gRPC method name before it is
  translated, so a failing east-west call is visible on the producing side even though the caller only
  sees a status code.
- **Walkthrough**: four override methods, one per server-handler shape, then one shared translator.
  - `UnaryServerHandler` (line 22), `ServerStreamingServerHandler` (line 42),
    `ClientStreamingServerHandler` (line 63), and `DuplexStreamingServerHandler` (line 83) all have an
    identical body: null-check `continuation` and `context`, `await continuation(...)` with
    `ConfigureAwait(false)` (library code that must not capture a synchronization context), and
    `catch (ResultFailureException ex) { LogResultFailure(logger, context.Method, ex); throw ToTransportException(ex); }`.
  - `ToTransportException(ResultFailureException)` (lines 126-138) is the shared decision. When the
    exception carries errors, it delegates to `exception.Errors.ToRpcException()` (line 130) and the
    structured trailers come with it. When it carries none, which is what the CA1032 message-only
    constructors produce, that mapping would answer the placeholder detail `"Unspecified failure"` and
    the real `Message` would be lost, so this method instead builds
    `new RpcException(new Status(StatusCode.Internal, detail))` (line 137), where `detail` is the
    exception message with the inner exception's message appended after `": "` when there is one
    (lines 133-135). The remarks (lines 107-123) explain why the empty case is **not** solved by
    synthesizing an `Error.Failure`: `ErrorType.Failure` maps to `StatusCode.InvalidArgument`, which
    would blame the caller for a server-side fault, so the empty case keeps `StatusCode.Internal` and
    replaces only the detail.
  - `LogResultFailure` (lines 140-141) is a source-generated `[LoggerMessage]` partial method at
    `LogLevel.Information` with the template `"gRPC method {Method} returned a result failure"`. That is
    why the class is `partial`: the generator emits the body. It is the allocation-free, high-performance
    logging idiom (no boxing, no format-string parsing at the call site).
- **Why it's built this way**: covering all four handler shapes means every gRPC operation, including the
  streaming ones, gets uniform `Result`-failure surfacing. Keeping it in an interceptor is the §10 point:
  the translation lives in one place, so a change to the error wire shape (see
  [`ResultGrpcExtensions`](#resultgrpcextensions)) is made once. Logging at `Information` rather than
  `Error` is deliberate for a *domain* failure: a rejected command is an expected outcome, not a fault.
- **Where it's used**: registered by `AddGrpcServiceDefaults()` in this group's
  [`DependencyInjection`](#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:28,32`), which adds it to the
  gRPC server pipeline of every extracted service host. Its live counterparts are the gRPC service
  implementations that call `result.ThrowIfFailure()`, for example
  [`SessionBookmarksGrpcService`](group-20-conference-api-grpc.md#sessionbookmarksgrpcservice)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:39,57`) and
  [`EventLiveValidationGrpcService`](group-20-conference-api-grpc.md#eventlivevalidationgrpcservice)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:38,62,91,115`).

### ResultGrpcExtensions
> MMCA.Common.Grpc · `MMCA.Common.Grpc` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:29` · Level 3 · class (static)

- **What it is**: the extension members that bridge [`Result`](group-01-result-error-handling.md#result)
  and `Result<T>` to gRPC's transport model (`RpcException`, `StatusCode`, `Metadata` trailers). It is
  both an **encoder** (server side: `ThrowIfFailure`, `UnwrapOrThrow`, `ToRpcException`) and a matching
  **decoder** (client side: `ToErrors`, `ToResult`, `ToResult<T>`), plus the `ErrorType` to `StatusCode`
  lookup table.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`ErrorType`](group-01-result-error-handling.md#errortype),
  [`ErrorTypeSeverity`](group-01-result-error-handling.md#errortypeseverity),
  [`Result`](group-01-result-error-handling.md#result) and `Result<T>` (all via
  `using MMCA.Common.Shared.Abstractions`, `ResultGrpcExtensions.cs:7`);
  [`ResultFailureException`](#resultfailureexception) (Level 2); `Grpc.Core` (NuGet);
  `System.Collections.Frozen`, `System.Globalization`, and `System.Runtime.CompilerServices` (BCL).
- **Concept introduced, a symmetric wire codec for the Result pattern.** `[Rubric §9, API & Contract
  Design]` (assesses consistent error shapes across protocols) and `[Rubric §7, Microservices Readiness]`
  (the Result pattern behaves identically over HTTP and gRPC). Where
  [`ErrorHttpMapping`](group-12-api-hosting-mapping.md#errorhttpmapping) maps `ErrorType` to HTTP status
  codes, `ErrorTypeToStatusCode` here (lines 35-47) maps it to gRPC `StatusCode`:
  `Validation`, `Invariant`, and `Failure` to `InvalidArgument`; `NotFound` to `NotFound`; `Conflict` to
  `Aborted`; `Unauthorized` to `Unauthenticated`; `Forbidden` to `PermissionDenied`;
  `UnprocessableEntity` to `FailedPrecondition`; `Unexpected` to `Internal`. A `FrozenDictionary` is the
  right tool: built once at static init, then read-only and lookup-optimized. The genuinely new idea in
  this type is that the encoding is **round-trippable**: the failure is written into trailers in a shape
  the decoder can reverse, so a caller ends up holding the same `Result` it would have held in-process.
  `[Rubric §10, Cross-Cutting Concerns]` follows from that: both halves of the codec live here, so the
  wire shape has exactly one definition.
- **Walkthrough**: the class is a set of C# `extension(T)` blocks (see
  [primer §4](00-primer.md#4-c-build-and-code-style-conventions)), which is why it carries a file-level
  `[SuppressMessage]` for CA1708 (lines 25-28): with multiple extension blocks in one static class the
  analyzer flags the compiler-generated grouping members as case-colliding, a false positive.
  - `extension(ErrorType errorType)` (line 49) contributes `ToGrpcStatusCode()` (line 56):
    `GetValueOrDefault(errorType, StatusCode.InvalidArgument)`, so an unmapped error type still produces
    a valid status.
  - `extension(Result result)` (line 60) contributes `ThrowIfFailure()` (line 69), the guard a gRPC
    service method calls first: null-check, then
    `if (result.IsFailure) throw new ResultFailureException(result.Errors)` (lines 72-75).
  - `extension<T>(Result<T> result)` (line 79) contributes `UnwrapOrThrow()` (line 86), the typed
    variant: throws on failure, otherwise returns `result.Value!` (line 94).
  - `extension(IReadOnlyList<Error> errors)` (line 98) contributes `ToRpcException()` (line 112), the
    encoder. The status code comes from `ErrorTypeSeverity.MostSevere(errors).Type.ToGrpcStatusCode()`
    (line 117), falling back to `StatusCode.Internal` for an empty list; the `Status.Detail` is the
    joined `"Code: Message"` summary or the literal `"Unspecified failure"` (lines 120-122). It then
    walks every error and writes **structured trailing metadata**: `error-{i}-code`, `error-{i}-message`,
    and `error-{i}-type` always (lines 128-130), plus `error-{i}-source` and `error-{i}-target` only when
    non-empty (lines 131-139). Every key is built with `CultureInfo.InvariantCulture` so the wire form
    cannot vary by locale. It returns `new RpcException(new Status(statusCode, detail), trailers)`
    (line 142).
  - `extension(Metadata? trailers)` (line 146) contributes `ToErrors()` (line 165), the exact inverse.
    Null or empty trailers decode to `[]` (lines 167-170). Otherwise it loops from index zero, reading
    `error-{i}-code` and **stopping at the first missing code** (lines 177-181), which matches the
    contiguous layout the encoder writes; a missing message decodes to the empty string and a missing
    source or target to `null` (lines 183-186), mirroring the encoder's omission rule.
  - `extension(RpcException exception)` (line 196) contributes `ToResult()` (line 210) and
    `ToResult<T>()` (line 234), which close the round trip. Both decode `exception.Trailers.ToErrors()`
    and return `Result.Failure(errors)` when the trailers carried a structured failure, or
    `Result.Failure(TransportError(exception, source))` when they did not (lines 216-218 and 240-242).
    Both take a `[CallerMemberName] string source = ""` parameter, so the synthesized transport error is
    stamped with the calling adapter method's name for free.
  - The private helpers close the file. `ErrorFactories` (lines 251-263) is a second `FrozenDictionary`
    mapping each `ErrorType` to its `Error` factory method, documented (lines 246-250) as a lookup table
    rather than a `switch` so adding an error type stays a one-line entry instead of pushing the decoder
    past the cyclomatic-complexity ceiling `[Rubric §15, Best Practices & Code Quality]`.
    `ParseErrorType` (line 269) does a case-**sensitive** `Enum.TryParse` and falls back to
    `ErrorType.Failure`, `BuildError` (line 275) dispatches through the factory table, and
    `TransportError` (line 285) builds the stand-in error coded `$"Grpc.{exception.StatusCode}"` carrying
    `exception.Status.Detail`.
- **Why it's built this way**: three decisions are worth naming.
  1. **The most severe error picks the status, not the first one** (line 117). The encoder ranks the list
     through [`ErrorTypeSeverity`](group-01-result-error-handling.md#errortypeseverity)
     (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:69`, ties keep the
     earliest error), the same ranking the HTTP edge uses, so an aggregate built by `Result.Combine`
     cannot be downgraded by error ordering: an `Unauthorized` travelling behind a `Validation` still
     answers `Unauthenticated`. Ranking picks the status only; **all** errors still travel in the
     trailers.
  2. **The decoder degrades rather than throws.** An unrecognized `error-{i}-type` falls back to
     `ErrorType.Failure` (line 272) instead of raising, so a newer peer that adds an error type cannot
     break an older client, and an `RpcException` with no structured trailers at all (a reset connection,
     an exceeded deadline) still reaches the caller as a `Result` failure rather than an exception
     (lines 280-289). That is the `[Rubric §29, Resilience & Business Continuity]` angle: the client-side
     programming model never changes shape because the network misbehaved.
  3. **Trailers carry the full error list, not a flattened string**, so the client reconstructs real
     `Error` objects with their original `Code`, `Message`, `Type`, `Source`, and `Target`. This is what
     makes the Result pattern survive the hop intact ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).
- **Where it's used**: `ThrowIfFailure` and `UnwrapOrThrow` are called by the gRPC service
  implementations in each service project, for example
  [`SessionBookmarksGrpcService`](group-20-conference-api-grpc.md#sessionbookmarksgrpcservice)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:39`);
  `ToRpcException` is called by [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor)
  (`GrpcResultExceptionInterceptor.cs:130`); `ToResult` and `ToResult<T>` are called by the client-side
  adapters in the `*.Contracts` projects, for example
  [`SessionBookmarkValidationServiceGrpcAdapter`](group-20-conference-api-grpc.md#sessionbookmarkvalidationservicegrpcadapter)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:58,85`).

### DependencyInjection
> MMCA.Common.Grpc · `MMCA.Common.Grpc` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:15` · Level 4 · class (static)

- **What it is**: the gRPC infrastructure registration class. It is a C# `extension(IServiceCollection)`
  block (line 17, see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)) exposing two
  methods: `AddGrpcServiceDefaults()` for the server side and
  `AddTypedGrpcClient<TClient>(string serviceName)` for the client side.
- **Depends on**: [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) (Level 3),
  [`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) (Level 0), and
  [`GrpcResilienceDefaults`](group-16-aspire-orchestration.md#grpcresiliencedefaults) /
  [`HttpResilienceDefaults`](group-16-aspire-orchestration.md#httpresiliencedefaults) (via
  `using MMCA.Common.Shared.Resilience`, `DependencyInjection.cs:5`); `Grpc.Net.ClientFactory`,
  `Microsoft.Extensions.Http.Resilience` (Polly), and the `Microsoft.Extensions.DependencyInjection`
  helpers (NuGet and BCL).
- **Concept reinforced, wiring the gRPC extraction boundary with resilience and h2c.** `[Rubric §7,
  Microservices Readiness]` ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html):
  gRPC transport for synchronous inter-service calls, wired so consumer code stays transport-agnostic)
  and `[Rubric §29, Resilience & Business Continuity]`
  ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html): a standard
  Polly pipeline of timeout, retry, and circuit breaker on **every** outbound gRPC client). `[Rubric §11,
  Security]` appears twice here in a form worth noticing: detailed errors are switched off so internal
  exception text never leaks over the wire, and the transport is cleartext h2c *by design* for in-cluster
  east-west calls, which is why the S5332 analyzer is suppressed with an explicit justification
  (lines 74 and 78) rather than silently.
- **Walkthrough**
  - `AddGrpcServiceDefaults()` (line 26): `TryAddSingleton<GrpcResultExceptionInterceptor>()` (line 28),
    then `AddGrpc(options => { options.Interceptors.Add<GrpcResultExceptionInterceptor>(); options.EnableDetailedErrors = false; })`
    (lines 30-34), then `AddGrpcReflection()` (line 36) so tools such as `grpcurl` can introspect the
    schema. Returns `services` for chaining.
  - `AddTypedGrpcClient<TClient>(string serviceName)` (line 66) does four things in order. First it
    validates the name (`ArgumentException.ThrowIfNullOrWhiteSpace`, line 69) and registers
    `AddHttpContextAccessor()` plus `TryAddTransient<JwtForwardingClientInterceptor>()` (lines 71-72).
    Second it calls `AddGrpcClient<TClient>` with the address `new Uri($"http://{serviceName}")`
    (lines 75-76), resolved by Aspire service discovery, and attaches
    `.AddInterceptor<JwtForwardingClientInterceptor>(InterceptorScope.Client)` (line 77). Third it
    **forces the primary handler** to a `SocketsHttpHandler` (lines 89-97) with
    `EnableMultipleHttp2Connections = true` and the connection-hygiene values re-applied from
    `HttpResilienceDefaults`: `PooledConnectionLifetime` (10 minutes), `PooledConnectionIdleTimeout`
    (5 minutes), `KeepAlivePingDelay` (60 seconds), `KeepAlivePingTimeout` (30 seconds), and
    `KeepAlivePingPolicy = WithActiveRequests`
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:34,37,40,43`).
    Fourth it layers `AddStandardResilienceHandler` back on (lines 106-115), setting every knob from
    [`GrpcResilienceDefaults`](group-16-aspire-orchestration.md#grpcresiliencedefaults): a 30-second
    attempt timeout and 90-second total request timeout re-exposed from the outbound-HTTP path, one
    retry beyond the initial attempt, and an explicit circuit breaker (60-second sampling window,
    `FailureRatio` 0.5, `MinimumThroughput` 10, `BreakDuration` 10 seconds)
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/GrpcResilienceDefaults.cs:15-33`). It returns
    the original `IHttpClientBuilder` (line 116), not the resilience-pipeline builder, so callers can
    keep chaining.
- **Why it's built this way**: three deliberate decisions live here, each documented inline and each
  worth reading before changing anything.
  1. **h2c (HTTP/2 cleartext) over `http://{serviceName}`, not HTTPS** (lines 43-52). Aspire's
     project-resource endpoint discovery from `launchSettings.json` does not reliably create a
     `services__<name>__https__0` discovery key, and the resolver silently falls back to `http`
     regardless of the requested scheme. The target service must therefore serve HTTP/2 on its cleartext
     endpoint (`Kestrel:EndpointDefaults:Protocols = "Http2"`) or Kestrel rejects the frames with
     `HTTP_1_1_REQUIRED`. The per-host transport choices are
     [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html).
  2. **The explicit `SocketsHttpHandler`** (lines 80-88). The global `ConfigureHttpClientDefaults` from
     `MMCA.Common.Aspire` applies to *all* `HttpClient` instances including this gRPC one, and its
     standard resilience pipeline can wrap the primary handler in a way that defeats HTTP/2 negotiation.
     Setting `SocketsHttpHandler` explicitly bypasses that wrapper for the gRPC client only, which is
     precisely why the pooled-lifetime and keep-alive values have to be re-applied from the same
     `HttpResilienceDefaults` source of truth: the override drops whatever the global default had set.
  3. **The circuit breaker is stated explicitly, not left at the library defaults** (comment at
     lines 99-105, values at `GrpcResilienceDefaults.cs:26-33`). An east-west gRPC call addresses a peer
     directly and bypasses the Gateway's active health checks, so the breaker is the only thing that
     notices a peer going bad. Timeouts and the retry budget, by contrast, are re-exposed from
     `HttpResilienceDefaults` so the two paths cannot drift.

  Application code should typically register a hand-written adapter implementing the C# service
  interface (for example `ISessionBookmarkValidationService`) that delegates to the generated typed
  client, so the rest of the app never sees gRPC types (doc comment lines 56-61, and
  [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) /
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
- **Where it's used**: each extracted service host calls `AddGrpcServiceDefaults()` server-side (ADC's
  Conference, Engagement, Identity, and Notification `Program.cs`, and Store's Catalog, Identity, and
  Sales `Program.cs`); each consumer wires `AddTypedGrpcClient<TClient>("<servicename>")` indirectly
  through the per-contract DI helper in the matching `*.Contracts` project, for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:45,75`.
- **Caveats / not-in-source**: many classes across the framework and the modules are named
  `DependencyInjection` (one per package or module); this section is specifically the
  `MMCA.Common.Grpc` one. The `_typemap.tsv` anchor for the bare name is owned by another group, so
  link to this one as `#dependencyinjection` from within this chapter only.


---
[⬅ API Hosting, Middleware, Idempotency & DTO/Contract Mapping](group-12-api-hosting-mapping.md)  •  [Index](00-index.md)  •  [Module System, Composition & Configuration ➡](group-14-module-system-composition.md)
