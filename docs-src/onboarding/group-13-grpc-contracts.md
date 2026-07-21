# 13. gRPC & Inter-Service Contracts

**What this chapter is about.** Once the ADC modules stopped sharing a process and became four
separate service hosts (Identity, Conference, Engagement, Notification), the in-process method calls
between them had to cross a network boundary. Asynchronous, fire-and-forget flows go over the broker
via the outbox (see [`IMessageBus`](group-04-events-outbox.md#imessagebus) and ADR-003); but some
calls need a *synchronous answer*, "how many bookmarks does this session have?", "is this session
valid to bookmark?", "give me the user ids of every attendee". This chapter is the **synchronous
transport seam**: a tiny, transport-only package (`MMCA.Common.Grpc`) plus a per-consumer
`*.Contracts` convention that together let a module be lifted out of the monolith and called over
**gRPC** *without rewriting a line of application or domain code*. The governing decision is
[ADR-007 (gRPC extraction)](../adr/007-grpc-extraction.md), with the supporting topology in
ADR-008 (YARP service mesh), auth in ADR-004 (JWKS dual-fetch), and the concrete Kestrel/HTTP-2
transport choices (h2c `Http2`-only for ADC vs `Http1AndHttp2` + ALPN for Store) in ADR-012. `[Rubric §7, Microservices
Readiness]` is the headline lens here, it assesses whether modules can genuinely be extracted, with
explicit, versioned contracts and transport kept at the edge, and `[Rubric §9, API & Contract
Design]` because the goal is that an error looks the same to a caller whether the answer came from an
in-process object or a wire hop.

**The cast of types in this group is small and all lives in `MMCA.Common.Grpc`**: a *transport-only*
package that, per Clean Architecture, depends on **`Shared` only** (it must never couple to Domain,
Application, or Infrastructure; see [primer §1](00-primer.md#1-the-big-picture)). There are six:
[`DependencyInjection`](#dependencyinjection) (the registration surface, `AddGrpcServiceDefaults()`
server-side, `AddTypedGrpcClient<TClient>(serviceName)` client-side),
[`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) (server-side: turns a failed
`Result` into an `RpcException`), [`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor)
(client-side: forwards the caller's bearer token downstream),
[`ResultGrpcExtensions`](#resultgrpcextensions) (the `Result`↔`RpcException` mapping helpers),
[`ResultFailureException`](#resultfailureexception) (the in-band carrier between a service method and
that interceptor), and the lone Shared-layer marker [`ServiceContractAttribute`](#servicecontractattribute)
(tags the wire surface of an extracted service). The concrete `.proto` definitions and the typed
clients they generate do *not* live here, they live in each consumer's `*.Contracts` project (ADC's
`MMCA.ADC.Conference.Contracts`, `.Engagement.Contracts`, `.Identity.Contracts`), which this package
exists to wire up.

**The contract-package convention.** Anything whose project name ends in `.Contracts` is special:
`Directory.Build.props` (in both Common and ADC) auto-pulls `Grpc.Tools` + `Google.Protobuf` and
compiles every `Protos/**/*.proto` with `GrpcServices="Both"`, so a single shared package produces
*both* the server base class and the client stub. The deliberate design choice (ADR-007) is that each
`.Contracts` project also ships a **hand-written gRPC adapter** that implements the *same C# interface
the modules already used in-process*. Concretely: Conference's code depends on the interface
`IBookmarkCountService` (defined in `MMCA.ADC.Engagement.Shared`); the in-process implementation lives
in Engagement; the cross-process implementation is `BookmarkCountServiceGrpcAdapter`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/BookmarkCountServiceGrpcAdapter.cs:14`),
which holds a generated `BookmarkCountServiceClient` and translates an interface call into a gRPC call
and the proto response back into the C# return type. Because both the in-process service and the
adapter satisfy the *identical interface*, swapping monolith for microservice is a **registration
change, not a rewrite**, which is the whole point of the seam.

**How the swap actually happens at the composition root.** Each `.Contracts` project also ships an
`extension(IServiceCollection)` DI helper, e.g. `AddConferenceSessionValidationClient()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:42`), that does two
things: (1) calls Common's `AddTypedGrpcClient<TClient>(serviceName)` to register the generated gRPC
client against the named service, and (2) calls `services.Replace(...)`, *not* `TryAdd`, to
overwrite whatever `ISessionBookmarkValidationService` is already in the container with the gRPC
adapter. The `Replace` is deliberate: by the time the host calls this (after `ModuleLoader` has run),
the container holds *either* the real in-process implementation (if that peer module is enabled in
this host) *or* a `Disabled*` stub (registered by the module's `RegisterDisabledStubs()` when the peer
is disabled). `Replace` wins over both, so after the call the resolved interface is always the gRPC
adapter pointing at the extracted peer. This is why the per-service `Program.cs` files call
`AddConferenceSessionValidationClient()` / `AddEngagementBookmarkCountClient()` *after* module
discovery.

**`Result` over the wire, the round-trip.** The codebase's pervasive
[`Result`](group-01-result-error-handling.md#result) pattern (errors as values, not exceptions; see
[primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) is preserved end-to-end
across the hop. On the **server**, a gRPC service implementation calls the inner C# service, gets back
a `Result`, and calls `result.ThrowIfFailure()` (from [`ResultGrpcExtensions`](#resultgrpcextensions)),
see `SessionBookmarksGrpcService`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:39`). That
guard throws a [`ResultFailureException`](#resultfailureexception) carrying the
[`Error`](group-01-result-error-handling.md#error) list. The
[`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) registered by
`AddGrpcServiceDefaults()` catches it for all four server call shapes (unary, server-/client-/duplex-
streaming), logs it, and rethrows `errors.ToRpcException()`, an `RpcException` whose `StatusCode`
comes from a `FrozenDictionary<ErrorType, StatusCode>` mapping that *mirrors* the HTTP
[`ErrorType`](group-01-result-error-handling.md#errortype)→status mapping in
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase), and whose trailing metadata
carries every error as `error-{i}-code/-message/-type/-source/-target` entries. The **client adapter**
reads those trailers back, reconstructs `Result.Failure(errors)`, and hands the caller the same shape
they would have seen in-process. That symmetry, one error model, two transports, is the
`[Rubric §9, API & Contract Design]` and `[Rubric §10, Cross-Cutting Concerns]` story: error
translation is a pipeline concern, written once in the interceptor, not repeated in every method.

**Auth and the network shape.** Every typed client wired by `AddTypedGrpcClient<TClient>`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:66`) gets a
[`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) that copies the inbound
`Authorization` header off the current `HttpContext` onto the outgoing call's metadata, so the
caller's JWT rides along to the downstream service and distributed authorization works without each
handler threading a token by hand (it is a no-op outside an HTTP request, e.g. in background
processors). The downstream service validates that forwarded token against the issuer's **JWKS**, not
a shared secret (ADR-004; see [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) /
[`IJwksProvider`](group-08-auth.md#ijwksprovider)), discovered through the gateway. The transport is
**HTTP/2 cleartext (h2c) with prior knowledge**: the client addresses `http://{serviceName}`,
resolved by **Aspire service discovery**, because Aspire's project-resource discovery doesn't reliably
expose an `https` key for these peers; the three REST services therefore serve `Http2`-only on their
cleartext endpoint (Notification runs `Http1AndHttp2` so its SignalR WebSocket upgrade still works).
A deliberate `SocketsHttpHandler` override (`DependencyInjection.cs:85`) forces explicit HTTP/2 so the
global resilience handler from `MMCA.Common.Aspire` can't defeat the negotiation, and on top of that,
`AddStandardResilienceHandler()` gives every gRPC client the same Polly retry/timeout/circuit-breaker
pipeline as the HTTP clients `[Rubric §29, Resilience & Business Continuity]`. `[Rubric §11,
Security]` is touched twice over: federated JWT validation rather than a shared secret, and token
forwarding that never widens the caller's authority.

**The live topology, and a sharp edge to know.** In ADC today there are exactly three gRPC edges:
Engagement → Conference (`ISessionBookmarkValidationService`, "is this session bookmarkable?"),
Conference → Engagement (`IBookmarkCountService`, "how many bookmarks for the speaker dashboard?"),
and Conference → Identity (`IAttendeeQueryService`, attendee user ids for broadcast notifications).
The server side is mapped in each service's `Program.cs` via `AddGrpcServiceDefaults()` +
`app.MapGrpcService<...>()`. Note that **Conference ↔ Engagement is a bidirectional pair**, and the
AppHost (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:221-225`) deliberately gives Engagement
a `WithReference(conference).WaitFor(conference)` but the reverse Conference → Engagement edge only a
`WithReference` with **no `WaitFor`**, because a reciprocal wait would deadlock startup (each waiting
for the other to be healthy). The transient "peer not ready" errors that result self-heal through the
resilience pipeline. This is the practical cost ADR-007 calls out: mutual synchronous dependencies
need care, and the resilience handler is what makes them tolerable.

**Governance, and one honest gap.** [`ServiceContractAttribute`](#servicecontractattribute) is the
intended marker for "this type is part of an extracted service's wire surface", apply it to the C#
interface, the integration-event records, and the boundary DTOs, with an optional `Version`. Its
doc-comment and ADR-007 describe a consumer-side architecture test that enforces contract purity
against it. In the *current* source, however, **no type carries `[ServiceContract]` and no test reads
it**, the attribute is a provided-but-unadopted seam. What the framework actually relies on for
contract governance today are *other* fitness functions: ADC's integration-event contract-snapshot
tests (which freeze each event's wire shape and fail on drift) and the `MicroserviceExtractionTests`
that forbid `MassTransit`/gRPC types from leaking into Application/Domain/Shared, the executable
governance that keeps this transport genuinely *at the edge* `[Rubric §34, Architecture Governance &
Documentation]`. Treat `[ServiceContract]` as an available convention to adopt when you extract the
next module, not as something existing contracts are tagged with. Generated gRPC client classes are
part of the contract surface by virtue of their `.proto` regardless, so they need no attribute.

### JwtForwardingClientInterceptor
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Interceptors` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/JwtForwardingClientInterceptor.cs:19` · Level 0 · class (sealed)

- **What it is**: a gRPC **client-side** interceptor that copies the inbound `Authorization` header
  from the current `HttpContext` onto every outgoing gRPC call's metadata, so the caller's JWT bearer
  token rides along to downstream services. It is the gRPC counterpart of the HTTP
  [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler) in
  the API/Infrastructure layer.
- **Depends on**: `Grpc.Core.Interceptors.Interceptor` (the base class) and `Grpc.Core` call types
  (NuGet, see [primer §3, "Transport"](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0));
  `Microsoft.AspNetCore.Http.IHttpContextAccessor` (ASP.NET Core, injected). Nothing first-party, it
  lives in `MMCA.Common.Grpc`, which by the layer rules depends on **`Shared` only** and is pure
  transport (see [primer §1](00-primer.md#1-the-big-picture)).
- **Concept introduced, gRPC interceptors and token forwarding across a service mesh.** `[Rubric §7,
  Microservices Readiness]` (assesses whether application code talks to abstractions while transport
  concerns live at the edges, here, cross-service auth is handled by a transport interceptor, not by
  every handler threading a token). `[Rubric §11, Security]` (assesses how credentials propagate; this
  forwards the bearer token so distributed authorization works end-to-end without re-authenticating at
  each hop). A gRPC **interceptor** is the gRPC equivalent of an HTTP `DelegatingHandler` / ASP.NET
  middleware: it wraps every call in a pipeline. There are **five** call shapes, unary (async and
  blocking), server-streaming, client-streaming, and duplex-streaming, and this interceptor overrides
  all five so no call variant can bypass token forwarding. It is the **client** side of the
  cross-service auth story whose **server** side is JWKS validation (ADR-004 "authentication
  dual-fetch").
- **Walkthrough**: members in execution order:
  - `private const string AuthorizationHeader = "Authorization"` (line 21), the single header name.
  - The five overrides (`AsyncUnaryCall` line 24, `BlockingUnaryCall` line 35, `AsyncServerStreamingCall`
    line 46, `AsyncClientStreamingCall` line 57, `AsyncDuplexStreamingCall` line 67) each follow the same
    shape: `ArgumentNullException.ThrowIfNull(continuation)`, build a new context via
    `WithForwardedAuthorization(context)`, then call `continuation(...)`. (The two streaming variants
    whose continuation takes no `request` argument call `continuation(newContext)`; the others pass
    `(request, newContext)`.)
  - `WithForwardedAuthorization<TRequest, TResponse>` (lines 76-99) is the shared helper. It reads
    `httpContextAccessor.HttpContext?.Request?.Headers.Authorization.ToString()` (line 81); if that is
    null or empty it returns the context **unchanged** (lines 82-85), the deliberate **no-op when there
    is no HTTP request**, e.g. a background processor or hosted service invoking a gRPC client outside a
    request. Otherwise it takes the call's existing `Options.Headers` (or a fresh `Metadata` via `[]`,
    line 87) and **first checks whether `Authorization` is already present** (lines 90-94), if a prior
    interceptor or the caller already set it, it bails out to avoid a duplicate header. Only then does it
    `headers.Add(...)` (line 96), rebuild the call options with `WithHeaders`, and return a new
    `ClientInterceptorContext` carrying `context.Method`, `context.Host`, and the new options (lines
    97-98).
- **Why it's built this way**: sealing + overriding all five call types makes token forwarding total:
  there is no call shape that silently drops the credential. Doing it in an interceptor (not per call
  site) keeps consumer code transport-agnostic, which is exactly the extraction seam ADR-007 and
  ADR-008 want. The duplicate-header guard means it composes safely with other interceptors.
- **Where it's used**: registered automatically by `AddTypedGrpcClient<TClient>` in this group's
  [`DependencyInjection`](#dependencyinjection) (`DependencyInjection.cs:72,76`), so every typed gRPC
  client an extracted ADC/Store service builds gets it without explicit wiring.

### ServiceContractAttribute
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:18` · Level 0 · class (sealed attribute)

- **What it is**: an attribute marking an interface/DTO/event as part of a service's **wire contract**
  (the surface published in a `*.Contracts` NuGet package for an extracted microservice).
- **Depends on**: `System.Attribute` (BCL) only.
- **Concept introduced, explicit service contracts + attribute-driven governance.** `[Rubric §7,
  Microservices Readiness]` (assesses explicit, versioned contracts and extractability) and
  `[Rubric §9, API & Contract Design]` (versioned contracts). When a module is lifted into its own
  service (ADR-007), the types consumers depend on, the service interface, the integration-event
  records, the boundary DTOs, are tagged `[ServiceContract]` so the wire surface is *identifiable*.
  This also touches `[Rubric §34, Architecture Governance]` (assesses fitness functions / executable
  governance): the doc comment (`ServiceContractAttribute.cs:5-9`) states the *intended* invariant,
  contract types must not depend on the producing service's Domain/Application/Infrastructure, should
  be enforced by an **architecture test in each consumer**. ⚠️ In practice (verified by source search)
  that purity is enforced by *other* tests that don't read this attribute, see **Where it's used** and
  **Caveats** below; the attribute itself is currently dormant.
- **Walkthrough**: `[AttributeUsage(Interface | Class | Struct, Inherited = false)]`
  (`ServiceContractAttribute.cs:17`); two constructors (parameterless, line 23, and one taking a
  `version` string, line 31) and a `Version` property defaulting to `"v1"` (line 34) for contract
  versioning.
- **Why it's built this way**: an attribute is the lightest way to *mark* membership in a category that
  tooling/tests can then enforce. Crucially, `MMCA.Common` ships **no** `[ServiceContract]` types
  itself, it provides the *marker*; the concrete contracts live in the consumer (ADC/Store), which is
  why the enforcing test is meant to live there too.
- **Where it's used**: **currently unused in code (a provided-but-unadopted seam).** Verified by
  source search: *no* type in `MMCA.Common`, `MMCA.ADC`, or `MMCA.Store` carries `[ServiceContract]`,
  and no architecture test references the attribute, the only `.cs` file mentioning it is its own
  definition. The contract governance the framework actually relies on today is enforced **without**
  this attribute: ADC's `IntegrationEventContractTests` snapshots every integration-event's wire shape
  against a frozen `ExpectedContract` and fails on drift, and `MicroserviceExtractionTests` keeps
  transport at the edge (`Infrastructure`/`*.Service`/`*.Contracts`). Generated gRPC client classes are
  part of the contract surface by virtue of their `.proto` regardless.
- **Caveats / not-in-source**: **discrepancy logged (code is ground truth):** the attribute's own
  XML-doc and ADR-007 describe it as the marker that identifies the wire surface and is enforced by a
  consumer architecture test, but neither an applied use of the marker nor a test referencing it exists
  in the current source. Treat `[ServiceContract]` as an *available* but not-yet-adopted convention; if
  you extract a module, you can start applying it, but don't assume existing contracts are tagged.

### ResultFailureException
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Exceptions` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Exceptions/ResultFailureException.cs:16` · Level 2 · class (sealed)

- **What it is**: a typed exception that carries `IReadOnlyList<Error>` from a failing
  [`Result`](group-01-result-error-handling.md#result). gRPC service implementations raise it
  indirectly via `result.ThrowIfFailure()`; the [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor)
  (Level 3) catches it and translates it into an `RpcException` with the right status code and structured
  error trailers.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error) (Level 1); `System.Exception`
  (BCL).
- **Concept introduced, bridging the Result pattern across the gRPC transport.** `[Rubric §9, API &
  Contract Design]` (assesses consistent error shapes across transports) and `[Rubric §7,
  Microservices Readiness]` (the gRPC extraction seam). gRPC has no native "return a failure value";
  failures travel as `RpcException`/status codes. So the [`Result`](group-01-result-error-handling.md#result)
  pattern (taught in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) and
  G01) is adapted to the wire by smuggling the failure through a single, *internal-to-the-transport-edge*
  exception type whose payload is the original `Error` list, so the interceptor can rebuild the exact
  same `Code/Message/Type/Source/Target` fields a consumer would have seen over HTTP. This mirrors the
  HTTP side: where REST maps `Result` failures to RFC 9457 Problem Details in
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase), gRPC maps them to
  `RpcException`.
- **Walkthrough**: four constructors. The three standard `Exception` constructors (parameterless line
  19, message line 24, message+inner line 30) each set `Errors = []` and exist **only to satisfy
  CA1032** (the analyzer that requires the full exception constructor set). The meaningful one is
  `ResultFailureException(IReadOnlyList<Error> errors)` (line 35), whose message is built by
  `BuildMessage` (line 41), it joins the errors as `"Code: Message"` pairs, or `"Result failure"` when
  the list is empty. `Errors` (line 39) is a read-only property.
- **Why it's built this way**: using a *single, dedicated* exception (rather than throwing arbitrary
  exceptions) lets the server interceptor catch exactly one type and translate it deterministically;
  everything else propagating out is a genuine fault. The XML-doc (lines 11-14) is explicit that service
  code should **not** `throw` this directly, it should call `result.ThrowIfFailure()` from
  [`ResultGrpcExtensions`](#resultgrpcextensions), keeping the throw site uniform.
- **Where it's used**: thrown by [`ResultGrpcExtensions.ThrowIfFailure()` / `UnwrapOrThrow<T>()`](#resultgrpcextensions)
  (Level 3); caught by [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) (Level 3),
  which calls `ex.Errors.ToRpcException()`.

### GrpcResultExceptionInterceptor
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Interceptors` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/GrpcResultExceptionInterceptor.cs:19` · Level 3 · class (sealed, partial)

- **What it is**: a **server-side** gRPC `Interceptor` that catches [`ResultFailureException`](#resultfailureexception)
  thrown by service implementations and rethrows it as an `RpcException` carrying the correct
  `StatusCode` and structured error trailers, across all four server-handler shapes (unary,
  server-streaming, client-streaming, duplex).
- **Depends on**: [`ResultFailureException`](#resultfailureexception) (Level 2);
  [`ResultGrpcExtensions.ToRpcException`](#resultgrpcextensions) (Level 3, called as `ex.Errors.ToRpcException()`);
  `Grpc.Core.Interceptors.Interceptor`, `Grpc.Core` (NuGet); `Microsoft.Extensions.Logging.ILogger<T>`.
- **Concept reinforced, error translation as a cross-cutting concern, symmetric with the HTTP layer.**
  `[Rubric §7, Microservices Readiness]` (assesses that error handling is symmetric across HTTP and
  gRPC) and `[Rubric §10, Cross-Cutting Concerns]` (error translation lives in one interceptor, not
  re-coded in every service method). The doc comment (lines 11-13) names the parallel explicitly: this
  "mirrors the behavior of `ApiControllerBase.HandleFailure` for HTTP responses." `[Rubric §13,
  Observability]` also applies, each caught failure is logged with the gRPC method name. The pattern: a
  service method just calls `result.ThrowIfFailure()` / `result.UnwrapOrThrow()`; this interceptor does
  the translation uniformly.
- **Walkthrough**: four override methods, one per server-handler shape: `UnaryServerHandler` (line 22),
  `ServerStreamingServerHandler` (line 42), `ClientStreamingServerHandler` (line 63),
  `DuplexStreamingServerHandler` (line 83). Each follows an identical body: null-check `continuation`
  and `context`, `try { await continuation(...).ConfigureAwait(false) }`, and
  `catch (ResultFailureException ex) { LogResultFailure(logger, context.Method, ex); throw ex.Errors.ToRpcException(); }`.
  Logging uses the **source-generated** `[LoggerMessage]` partial method `LogResultFailure` (line 103),
  hence the `partial` class, which is the allocation-free, high-performance logging idiom (no boxing,
  no format-string parsing at call time). `ConfigureAwait(false)` is used throughout (library code that
  must not capture a sync context).
- **Why it's built this way**: covering all four handler shapes means every gRPC operation, including
  streaming, gets uniform `Result`-failure surfacing. Keeping it in an interceptor is the §10 point:
  the translation is one place, so a change to the error wire-shape (see
  [`ResultGrpcExtensions`](#resultgrpcextensions)) is made once.
- **Where it's used**: registered by `AddGrpcServiceDefaults()` in this group's
  [`DependencyInjection`](#dependencyinjection) (`DependencyInjection.cs:28,32`), which adds it to the
  gRPC server pipeline of every extracted service host.

### ResultGrpcExtensions
> MMCA.Common.Grpc · `MMCA.Common.Grpc` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:21` · Level 3 · class (static)

- **What it is**: the extension methods that bridge [`Result`](group-01-result-error-handling.md#result)/`Result<T>`
  to gRPC's transport model (`RpcException`, `StatusCode`). It provides `ToGrpcStatusCode(this ErrorType)`,
  `ThrowIfFailure(this Result)`, `UnwrapOrThrow<T>(this Result<T>)`, and
  `ToRpcException(this IReadOnlyList<Error>)`, plus the `ErrorType → StatusCode` lookup table.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error) (Level 1),
  [`ErrorType`](group-01-result-error-handling.md#errortype) (Level 0),
  [`Result`](group-01-result-error-handling.md#result) and `Result<T>` (Level 2),
  [`ResultFailureException`](#resultfailureexception) (Level 2); `Grpc.Core` (NuGet);
  `System.Collections.Frozen` (BCL).
- **Concept introduced, gRPC transport adaptation of the Result pattern, with a status-code map that
  parallels the HTTP one.** `[Rubric §7, Microservices Readiness]` (the Result pattern works
  identically across both HTTP and gRPC transports) and `[Rubric §9, API & Contract Design]`
  (consistent error shapes across protocols). Where [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)
  maps [`ErrorType`](group-01-result-error-handling.md#errortype) → HTTP status codes, this maps
  `ErrorType` → gRPC `StatusCode` via a `FrozenDictionary` (lines 27-38): `Validation`/`Invariant`/`Failure`
  → `InvalidArgument`, `NotFound` → `NotFound`, `Conflict` → `Aborted`, `Unauthorized` →
  `Unauthenticated`, `Forbidden` → `PermissionDenied`, `UnprocessableEntity` → `FailedPrecondition`. A
  `FrozenDictionary` is the right tool: built once at static-init, then read-only and lookup-optimized.
- **Walkthrough**: members in teaching order:
  - `ErrorTypeToStatusCode` (lines 27-38), the static `FrozenDictionary<ErrorType, StatusCode>`,
    documented (lines 24-25) as mirroring `ErrorHttpMapping.ErrorTypeToStatusCode` in `MMCA.Common.API`.
  - `ToGrpcStatusCode(this ErrorType)` (line 46), `GetValueOrDefault(errorType, StatusCode.InvalidArgument)`;
    the **fallback** to `InvalidArgument` means an unmapped error type still produces a valid status.
  - `ThrowIfFailure(this Result result)` (line 57), the guard a gRPC service method calls first:
    null-check, then `if (result.IsFailure) throw new ResultFailureException(result.Errors)`.
  - `UnwrapOrThrow<T>(this Result<T> result)` (line 73), the typed variant: throws on failure, else
    returns `result.Value!`.
  - `ToRpcException(this IReadOnlyList<Error> errors)` (line 92), the actual translator. The **first**
    error's `Type` chooses the status code (line 97; `StatusCode.Internal` if the list is empty); the
    `Status.Detail` is the joined `"Code: Message"` summary (line 100); then it walks every error and
    writes **structured trailing metadata**, `error-{i}-code`, `error-{i}-message`, `error-{i}-type`,
    and (when present) `error-{i}-source` / `error-{i}-target` (lines 104-120). It returns
    `new RpcException(new Status(statusCode, detail), trailers)` (line 122).
- **Why it's built this way**: the trailers carry the *full* error list in a machine-readable shape, so
  a typed gRPC client can parse them back into [`Error`](group-01-result-error-handling.md#error)
  objects and reconstruct a `Result.Failure` on the client side, preserving the Result pattern across
  the network hop, not just a flattened string. The "first error sets the status" rule matches the HTTP
  convention so the two transports behave the same. `[Rubric §10, Cross-Cutting Concerns]`: this is the
  single source of truth for gRPC error shape, consumed by the interceptor.
- **Where it's used**: `ThrowIfFailure` / `UnwrapOrThrow` are called by gRPC service method
  implementations in each module's `*.Contracts`/service project; `ToRpcException` is called by
  [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) (Level 3) to do the final
  translation.

### DependencyInjection
> MMCA.Common.Grpc · `MMCA.Common.Grpc` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:15` · Level 4 · class (static)

- **What it is**: the gRPC infrastructure registration class. A C# `extension(IServiceCollection)`
  type (see [primer §4, "extension(T) types"](00-primer.md#4-c-build-and-code-style-conventions))
  exposing two methods: `AddGrpcServiceDefaults()` (server side) and `AddTypedGrpcClient<TClient>(string serviceName)`
  (client side).
- **Depends on**: [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) (Level 3),
  [`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) (Level 0); `Grpc.Net.ClientFactory`,
  `Microsoft.Extensions.Http.Resilience` (Polly), and the `Microsoft.Extensions.DependencyInjection`
  helpers (NuGet/BCL).
- **Concept reinforced, wiring the gRPC extraction seam (ADR-007), with resilience and h2c.** `[Rubric
  §7, Microservices Readiness]` (ADR-007: gRPC transport for synchronous inter-service calls, wired so
  consumer code stays transport-agnostic). `[Rubric §29, Resilience & Business Continuity]` (ADR-009:
  a standard Polly resilience pipeline on **every** outbound gRPC client, retry/timeout/circuit-breaker
 , matching the HTTP defaults from `MMCA.Common.Aspire`). The DI uses the `extension(IServiceCollection)`
  syntax, the codebase's idiom for adding registration methods directly onto `IServiceCollection`.
- **Walkthrough**
  - `AddGrpcServiceDefaults()` (line 26): `TryAddSingleton<GrpcResultExceptionInterceptor>` (line 28),
    then `AddGrpc(options => { options.Interceptors.Add<GrpcResultExceptionInterceptor>(); options.EnableDetailedErrors = false; })`
    (lines 30-34, detailed errors **off** so internal exception text never leaks over the wire),
    then `AddGrpcReflection()` (line 36) so tools like `grpcurl` can introspect the schema. Returns
    `services` for chaining.
  - `AddTypedGrpcClient<TClient>(string serviceName)` (line 66): validates `serviceName`
    (`ArgumentException.ThrowIfNullOrWhiteSpace`, line 69), registers `AddHttpContextAccessor()` +
    `TryAddTransient<JwtForwardingClientInterceptor>()` (lines 71-72), then `AddGrpcClient<TClient>` with
    address `new Uri($"http://{serviceName}")` (lines 74-75) and `.AddInterceptor<JwtForwardingClientInterceptor>(InterceptorScope.Client)`
    (line 76). It then **forces the primary handler** to a `SocketsHttpHandler` with
    `EnableMultipleHttp2Connections = true` and a 5-minute `PooledConnectionIdleTimeout` (lines 85-89),
    and finally `AddStandardResilienceHandler()` (line 94). Returns the `IHttpClientBuilder`.
- **Why it's built this way**: two deliberate, well-documented decisions live here (and are worth
  reading the inline comments for, lines 47-52 and 78-93):
  1. **h2c (HTTP/2 cleartext) over `http://{serviceName}`, not HTTPS.** The doc comment explains Aspire's
     project-resource discovery from `launchSettings.json` doesn't reliably create an
     `services__<name>__https__0` discovery key, so the resolver silently falls back to `http`; the
     target service must therefore serve HTTP/2 on its cleartext endpoint
     (`Kestrel:EndpointDefaults:Protocols = "Http2"`) or Kestrel rejects the frames with
     `HTTP_1_1_REQUIRED`.
  2. **Explicit `SocketsHttpHandler`.** The global `ConfigureHttpClientDefaults` from
     `MMCA.Common.Aspire` applies to *all* `HttpClient`s including this gRPC one, and its resilience
     pipeline can wrap the primary handler in a way that defeats HTTP/2 negotiation; setting
     `SocketsHttpHandler` explicitly bypasses that for the gRPC client only. Resilience is then layered
     back on top.

  Application code should typically register a hand-written adapter implementing the C# service
  interface (e.g. `IProductVariantService`) that delegates to the generated typed client, so the rest
  of the app never sees gRPC types (ADR-007/008).
- **Where it's used**: each extracted service host calls `AddGrpcServiceDefaults()` server-side; each
  consumer host calls `AddTypedGrpcClient<TClient>("<servicename>")` (e.g.
  `AddTypedGrpcClient<ConferenceServiceClient>("conference")`) for each downstream peer it talks to.
- **Caveats / not-in-source**: there are many classes named `DependencyInjection` across the framework
  and modules (one per package/module); this section is specifically the `MMCA.Common.Grpc` one. Its
  typemap anchor is the bare `dependencyinjection` (G14 owns that map row); link to it as
  `#dependencyinjection` within this group file.


---
[⬅ API Hosting, Middleware, Idempotency & DTO/Contract Mapping](group-12-api-hosting-mapping.md)  •  [Index](00-index.md)  •  [Module System, Composition & Configuration ➡](group-14-module-system-composition.md)
