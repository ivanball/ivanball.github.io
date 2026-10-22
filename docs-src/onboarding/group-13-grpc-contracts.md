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
There are sixteen, and seven of them carry the core transport: [`DependencyInjection`](#dependencyinjection) (the registration surface,
`AddGrpcServiceDefaults()` server-side and `AddTypedGrpcClient<TClient>(serviceName)` client-side, at
`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:25`),
[`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) (server-side: turns a failed
`Result` into an `RpcException`),
[`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) (client-side: forwards the
caller's bearer token downstream), [`ResultGrpcExtensions`](#resultgrpcextensions) (the whole
`Result` to `RpcException` mapping, in both directions),
[`ResultFailureException`](#resultfailureexception) (the in-band carrier between a service method and
that interceptor), [`GrpcWireFormat`](#grpcwireformat) (the shared string encodings for timestamps
and money, at `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/GrpcWireFormat.cs:30`), and the lone
`MMCA.Common.Shared` marker
[`ServiceContractAttribute`](#servicecontractattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:23`), which tags
the wire surface of an extracted service. The other nine form the **service-token** family for calls
that have no user token to forward, eight in `MMCA.Common.Grpc.Authentication` plus one client
interceptor: [`IServiceTokenProvider`](#iservicetokenprovider) and its
[`ServiceTokenProvider`](#servicetokenprovider) (with the private [`CachedToken`](#cachedtoken)
record), [`ServiceTokenSettings`](#servicetokensettings), [`ServiceTokenDefaults`](#servicetokendefaults),
the two registration surfaces [`ServiceTokenServiceCollectionExtensions`](#servicetokenservicecollectionextensions)
(with the private [`DefaultSchemeGuard`](#defaultschemeguard) marker) and
[`ServiceTokenHttpClientBuilderExtensions`](#servicetokenhttpclientbuilderextensions), and
[`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor). The concrete `.proto` definitions and the typed clients they
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
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:44`), that does two
things: (1) calls Common's `AddTypedGrpcClient<TClient>(serviceName)` to register the generated gRPC
client against the named service (`DependencyInjection.cs:46`), and (2) calls
`services.Replace(ServiceDescriptor.Scoped<...>())`, *not* `TryAdd`, to overwrite whatever
`ISessionBookmarkValidationService` is already in the container with the gRPC adapter
(`DependencyInjection.cs:50`). The `Replace` is deliberate and documented in place
(`DependencyInjection.cs:48-49`): by the time the host calls this, the container holds *either* the
real in-process implementation (if that peer module is enabled in this host) *or* a `Disabled*` stub
registered by the module when the peer is disabled. `Replace` wins over both, so after the call the
resolved interface is always the gRPC adapter pointing at the extracted peer. Ordering is not left to
chance: each host registers these helpers as steps inside
`services.AddMmcaApplicationPipeline(pipeline => pipeline.Register(moduleHost.RegisterModules).Register(s => s.AddConferenceSessionValidationClient())...)`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:287-291`), so module discovery runs
first and the client replacements run after it, in declaration order.

**`Result` over the wire, the outbound half.** The codebase's pervasive
[`Result`](group-01-result-error-handling.md#result) pattern (errors as values, not exceptions; see
[primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) survives the hop intact. On
the **server**, a gRPC service implementation calls the inner C# service, gets back a `Result`, and
calls `result.ThrowIfFailure()` (from [`ResultGrpcExtensions`](#resultgrpcextensions),
`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:72`); see
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
`errors.ToRpcException()`. That encoder (`ResultGrpcExtensions.cs:119`) picks the status from the
**most severe** error rather than the first, via
[`ErrorTypeSeverity`](group-01-result-error-handling.md#errortypeseverity)`.MostSevere`
(`ResultGrpcExtensions.cs:124`), so an aggregate built by `Result.Combine` cannot be downgraded by
error ordering; the `ErrorType` to `StatusCode` table itself is a `FrozenDictionary`
(`ResultGrpcExtensions.cs:37-50`) that *mirrors* the HTTP mapping in
[`ErrorHttpMapping`](group-12-api-hosting-mapping.md#errorhttpmapping) used by
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase). Every error is then
serialized into the trailers as `error-{i}-code`, `-message`, `-type`, and (when non-empty) `-source`
and `-target` entries (`ResultGrpcExtensions.cs:132-147`). Because gRPC text metadata is printable
ASCII only, the message, source, and target values are percent-encoded as UTF-8 for every character
outside that range and for `%` itself (`ResultGrpcExtensions.cs:287-314`), so an accented name or a
newline in a validation message cannot break the trailer at the transport; a value that is already
plain printable ASCII goes on the wire unchanged (`ResultGrpcExtensions.cs:289-292`).

**`Result` over the wire, the inbound half.** The same class owns the decoder, so the round trip is
closed by framework code rather than by hand-rolled parsing in each adapter. `Metadata.ToErrors()`
(`ResultGrpcExtensions.cs:173`) walks `error-{i}-code` from index zero and stops at the first gap,
matching the contiguous layout the encoder writes, percent-decodes the message, source, and target
(`ResultGrpcExtensions.cs:191-194`, `:314-315`), and an unrecognized `error-{i}-type` falls back to
`ErrorType.Failure` instead of throwing (`ResultGrpcExtensions.cs:278-281`), so a newer peer that adds
an error type cannot break an older client. On top of that, `RpcException.ToResult()` and
`ToResult<T>()` (`ResultGrpcExtensions.cs:218` and `:240`) hand the caller a failed `Result` directly:
structured trailers win when present, and a pure transport fault that carries none (a reset
connection, an exceeded deadline) degrades to a single `ErrorType.Failure` error coded
`Grpc.{StatusCode}` and stamped with the calling member's name via `[CallerMemberName]`
(`ResultGrpcExtensions.cs:331-335`). A client adapter's catch block is therefore one line:
`return ex.ToResult();`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:58`).
That symmetry, one error model over two transports, is the `[Rubric §9, API & Contract Design]` and
`[Rubric §29, Resilience, Reliability & Business Continuity]` story: error translation is a pipeline concern, written once in
the interceptor and its extension pair, not repeated in every method. One sharp edge is documented in
the interceptor itself (`GrpcResultExceptionInterceptor.cs:103-138`): a `ResultFailureException` built
from a message-only constructor carries *no* errors, so the shared encoder would answer the
placeholder detail "Unspecified failure"; the interceptor keeps `StatusCode.Internal` for that case
and substitutes the real message (plus any inner exception's message) rather than synthesizing an
`Error.Failure`, which would map to `InvalidArgument` and wrongly blame the caller.

**Values protobuf has no lossless scalar for.** Errors are not the only thing both ends must agree on
byte for byte. [`GrpcWireFormat`](#grpcwireformat) is a static class that writes the two encodings
the hand-written services and adapters share, so the format lives in one place rather than in each
`.proto` mapping. Timestamps travel as ISO 8601 round-trip (`"O"`) strings: `FormatUtc` stamps
`DateTimeKind.Utc` before formatting (`GrpcWireFormat.cs:42-43`), because SQL Server hands columns
back as `Unspecified` and `"O"` would otherwise drop the `Z`, and `ParseUtc` reads either form, with
or without the marker, as UTC on the same instant through `AssumeUniversal | AdjustToUniversal`
(`GrpcWireFormat.cs:37`, `:61-62`), which keeps a rolling deploy with an older replica on the other end
working. An optional timestamp maps "absent" to the empty string, since proto3 has no null string
(`FormatUtcOrEmpty` / `ParseUtcOrNull`, `GrpcWireFormat.cs:51-52`, `:71-72`). Money travels as an
invariant-culture decimal string (`GrpcWireFormat.cs:77`, `:83-84`), so a price is never rounded
through a double and never misread under a comma-decimal locale. The `Parse*` methods throw
`FormatException` on a corrupt peer payload, treating it as a fault; an adapter that wants to map a
malformed amount to its own answer uses `TryParseDecimal` instead (`GrpcWireFormat.cs:93-94`). In ADC
the data-subject export edges are the users: Engagement's server writes `FormatUtc`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Grpc/UserEngagementExportGrpcService.cs:50`)
and its adapter reads `ParseUtc`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/UserEngagementExportServiceGrpcAdapter.cs:45`),
and Notification pairs `FormatUtcOrEmpty` with `ParseUtcOrNull` for a notification's read time
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/UserNotificationExportGrpcService.cs:49`,
`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/UserNotificationExportServiceGrpcAdapter.cs:44`).

**Auth and the network shape.** Every typed client wired by `AddTypedGrpcClient<TClient>`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:89`) gets a
[`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) (`DependencyInjection.cs:95-100`)
that copies the inbound `Authorization` header off the current `HttpContext` onto the outgoing call's
metadata, so the caller's JWT rides along to the downstream service and distributed authorization
works without each handler threading a token by hand. When the inbound request authenticated without
an `Authorization` header (a SignalR hub connection passes its token as `?access_token=`), it
forwards the token saved on the authentication ticket instead, read as `access_token` and rebuilt as
a `Bearer` value, while a header that is present always wins
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/JwtForwardingClientInterceptor.cs:151-159`).
It forwards nothing outside an HTTP request, for example in a background processor
(`JwtForwardingClientInterceptor.cs:146-149`), and it refuses to overwrite or duplicate an
`Authorization` entry a caller or prior interceptor already set (`JwtForwardingClientInterceptor.cs:114-117`,
`:133-136`). It forwards only the user's token (`JwtForwardingClientInterceptor.cs:28-31`); the
service-token path below covers a call that has none. It is the gRPC counterpart of the HTTP
[`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler). The
downstream service validates that forwarded token against the issuer's **JWKS**, not a shared secret
([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html); see
[`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) / [`IJwksProvider`](group-08-auth.md#ijwksprovider)).
The server half also sets `EnableDetailedErrors = false` and adds server reflection
(`DependencyInjection.cs:43`, `:46`), so tools like grpcurl can introspect the schema without exception
detail leaking to callers. `[Rubric §11, Security]` is touched three times over here: federated JWT
validation of user tokens rather than a shared secret, token forwarding that never widens the caller's
authority, and detailed errors kept off.

**Calls with no user token: service tokens, the calling side.** Forwarding covers a call made inside a
user's request; a background processor, or an anonymous request that fans out internally, has no user
token, and its call would otherwise arrive unauthenticated
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/IServiceTokenProvider.cs:3-8`). The
answer is a self-minted service token configured by [`ServiceTokenSettings`](#servicetokensettings)
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenSettings.cs:18`), bound
from the one `Grpc:ServiceToken` section (`ServiceTokenSettings.cs:21`) by both halves, so the key,
issuer, and audience cannot drift between caller and receiver within a deployment. Its `Validate`
fails the host on start unless the Base64 `SigningKey` decodes to at least 32 bytes, `ServiceName` is
set, and `LifetimeMinutes` lies between 1 and 60 (`ServiceTokenSettings.cs:24`, `:27`, `:59-93`);
`Issuer` defaults to `mmca-service`, `Audience` to `internal-grpc` (which must differ from the user
tokens' audience, since the audience is what keeps a service token out of the user scheme), and the
lifetime to 5 minutes (`ServiceTokenSettings.cs:42-51`). `AddServiceTokenClient(configuration)`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:35`)
registers [`ServiceTokenProvider`](#servicetokenprovider) as the singleton
[`IServiceTokenProvider`](#iservicetokenprovider) (`ServiceTokenServiceCollectionExtensions.cs:40-41`),
whose `GetToken()` (`IServiceTokenProvider.cs:15`) returns an HS256 JWT with `sub` and `svc` naming this
service and a fresh `jti` (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenProvider.cs:85-91`).
The provider caches it as a private [`CachedToken`](#cachedtoken) record (`ServiceTokenProvider.cs:105`)
and replaces it once 60 seconds or less remain (`ServiceTokenProvider.cs:26`, `:76-77`), so a token that
could expire mid-call is never handed out: readers take the published token without locking, and only
a caller inside that refresh window takes the lock and mints, once for everyone waiting
(`ServiceTokenProvider.cs:52-74`). Registering the provider sends nothing by itself. A typed client opts
in by chaining `.WithServiceToken()` from
[`ServiceTokenHttpClientBuilderExtensions`](#servicetokenhttpclientbuilderextensions) onto
`AddTypedGrpcClient<TClient>`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenHttpClientBuilderExtensions.cs:28`),
which adds the [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor) to that client alone
(`ServiceTokenHttpClientBuilderExtensions.cs:34`). Precedence is the user's token, then the service
token: the interceptor attaches nothing when the call already carries `Authorization` or the ambient
request holds a user token, and it decides that with the forwarding interceptor's own helpers, so the
result does not depend on which of the two runs first
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/ServiceTokenClientInterceptor.cs:85-94`,
`JwtForwardingClientInterceptor.cs:108`, `:133`, `:144`). It is per client and never global because a
server that does not validate service tokens would have to reject one, and a default JwtBearer scheme
first fetches its OIDC metadata to do so, which can stall a call while that endpoint is still starting
(`ServiceTokenClientInterceptor.cs:13-17`).

**Service tokens, the receiving side.** `AddServiceTokenAuthentication(configuration)`
(`ServiceTokenServiceCollectionExtensions.cs:63`) adds a JwtBearer scheme named by
[`ServiceTokenDefaults`](#servicetokendefaults)`.AuthenticationScheme`, `"ServiceToken"`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenDefaults.cs:15`;
`ServiceTokenServiceCollectionExtensions.cs:70-72`). It validates issuer, audience, lifetime, and
signature against the shared key, pins the algorithm to HS256 so an algorithm-confusion swap cannot
pass (`ServiceTokenServiceCollectionExtensions.cs:133-145`), and fails any token that validates without
the `svc` claim (`ServiceTokenDefaults.cs:27`; `ServiceTokenServiceCollectionExtensions.cs:151-157`). It
also adds the `InternalCaller` policy (`ServiceTokenDefaults.cs:21`), which admits an authenticated
caller from either the user scheme or the service scheme
(`ServiceTokenServiceCollectionExtensions.cs:84-87`). The service scheme is never made the default, so a
service token satisfies only an endpoint that names that policy, and a plain `[Authorize]` endpoint
still authenticates users alone. Rather than document the trap, the registration fails the host at
startup when the service scheme would end up the default, explicitly or as the lone registered scheme
ASP.NET Core promotes, through the start-time validation of the private
[`DefaultSchemeGuard`](#defaultschemeguard) marker options type
(`ServiceTokenServiceCollectionExtensions.cs:78-82`, `:110-129`, `:165`). The settings bind and validate
once however many of the two halves a host calls (`ServiceTokenServiceCollectionExtensions.cs:96-107`).
The shared symmetric key is a deliberate choice for east-west traffic inside one deployment, with no
issuer service to call and a key rotation that is one configuration change on every service
(`ServiceTokenSettings.cs:12-17`), in contrast to the JWKS validation of forwarded user tokens. In the
repos today the adopter is Store: Sales registers the calling half
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:289`) and opts its
`CustomerServiceClient` in
(`MMCA.Store/Source/Services/MMCA.Store.Identity.Contracts/DependencyInjection.cs:46`), and Identity
registers the receiving half and maps `CustomersGrpcService` under the `InternalCaller` policy
(`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:173`, `:343`). ADC wires neither
half. `[Rubric §11, Security]` again: a service identity that is minted, scoped by audience, and
admitted only where an endpoint asks for it.

**The transport is HTTP/2 cleartext (h2c) with prior knowledge.** The client addresses
`http://{serviceName}` (`DependencyInjection.cs:98-99`), resolved by **Aspire service discovery**,
because Aspire's project-resource discovery does not reliably expose an `https` key for these peers;
the Sonar cleartext warning is suppressed in place with that rationale (`DependencyInjection.cs:97`). A
deliberate `SocketsHttpHandler` override (`DependencyInjection.cs:112-120`) forces
`EnableMultipleHttp2Connections` and re-applies the pooled-lifetime and keep-alive values from
[`HttpResilienceDefaults`](group-16-aspire-orchestration.md#httpresiliencedefaults), because the global
`ConfigureHttpClientDefaults` from `MMCA.Common.Aspire` applies to *all* `HttpClient`s and its wrapper
can defeat HTTP/2 negotiation. On top of that, `AddStandardResilienceHandler` gives every gRPC client
an explicit Polly pipeline sourced entirely from
[`GrpcResilienceDefaults`](group-16-aspire-orchestration.md#grpcresiliencedefaults)
(`DependencyInjection.cs:129-152`): the attempt timeout, total timeout, and retry budget are the same
values the HTTP defaults use, but the retry is narrowed: every gRPC call is a POST, so only a failure
to reach the peer before the request was sent is retried, an `HttpRequestException` whose
`HttpRequestError` is `NameResolutionError`, `ConnectionError`, or `SecureConnectionError` (DNS, the TCP
connect, or the TLS handshake during a replica rollover). A status, an attempt timeout, or an
`HttpRequestException` raised after the request frames were written may already have reached the
handler and could run the call twice, so none of those is retried (`DependencyInjection.cs:135-147`). The circuit-breaker values are
spelled out (`FailureRatio` 0.5,
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
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:289-290`), Engagement to Notification
for the best-effort live-channel push (`Program.cs:291`, replacing the framework's
[`NullLiveChannelPublisher`](group-10-notifications.md#nulllivechannelpublisher) behind
[`ILiveChannelPublisher`](group-10-notifications.md#ilivechannelpublisher)), Conference to Engagement
for `IBookmarkCountService` on the speaker dashboard
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:420`), Notification to Identity for
attendee user ids (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:230`), and
Identity to Engagement plus Identity to Notification for the cross-service data-subject export
aggregation (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:330-331`). Server sides are
mapped in each host with `AddGrpcServiceDefaults()` plus `app.MapGrpcService<...>()`, mostly behind
`.RequireAuthorization()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:430`, `:396-397`).

**The startup-ordering edge worth knowing.** Conference and Engagement call *each other*, so the
AppHost gives Engagement a `WithReference(conference).WaitFor(conference)` but the reverse Conference
to Engagement edge only a `WithReference` with **no `WaitFor`**
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:266`, `:273`), because a reciprocal wait would
deadlock startup with each service waiting for the other to be healthy. The same reasoning drops the
`WaitFor` on Engagement to Notification (`Program.cs:277`) and on both Identity edges
(`Program.cs:287-288`); only Notification to Identity keeps one (`Program.cs:264`). The transient
"peer not ready" errors that result self-heal through the resilience pipeline. This is the practical
cost [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) calls out: mutual
synchronous dependencies need care, and the retry plus circuit breaker is what makes them tolerable.

**Governance: the marker is adopted and enforced.**
[`ServiceContractAttribute`](#servicecontractattribute) marks a type as part of an extracted service's
wire surface, applied to the C# interface, the integration-event records, and the boundary DTOs, with
an optional `Version` that defaults to `"v1"`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:36-39`).
MMCA.Common itself marks no type, so the rule is a ratchet in the framework repo and bites in a
consumer the moment its first contract type is marked. In ADC six interfaces carry it today
(`ISessionBookmarkValidationService`, `IEventLiveValidationService`, `IBookmarkCountService`,
`IUserEngagementExportService`, `IAttendeeQueryService`, `IUserNotificationExportService`), and Store
marks its own. Two fitness functions read the attribute by full name
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Contracts.cs:10`): the
**purity** rule, that a contract type must not reach into the producing service's Domain, Application,
or Infrastructure (`ArchitectureRules.Contracts.cs:32`, exposed through
[`ServiceContractPurityTestsBase`](group-28-testing-infrastructure.md#servicecontractpuritytestsbase)),
and the **encapsulation** rule, that the class serving a `[ServiceContract]` interface must not be
public (`ArchitectureRules.Contracts.cs:81`, exposed through
[`ContractImplementationTestsBase`](group-28-testing-infrastructure.md#contractimplementationtestsbase)),
which is why every gRPC adapter above is `internal sealed`. Alongside them,
[`MicroserviceExtractionTestsBase`](group-28-testing-infrastructure.md#microserviceextractiontestsbase)
forbids MassTransit and gRPC types from leaking into Application, Domain, or Shared. Each repo
subclasses all three (for example
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Layering/ServiceContractPurityTests.cs:9`). That is the
executable governance keeping this transport genuinely at the edge
`[Rubric §34, Architecture Governance & Documentation]` and `[Rubric §15, Best Practices & Code
Quality]`. Generated gRPC client classes need no attribute: they are part of the contract surface by
virtue of their `.proto`.

### CachedToken
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenProvider.cs:105` · Level 0 · record (private, sealed)

- **What it is**: a private nested record inside [`ServiceTokenProvider`](#servicetokenprovider) holding a
  minted token and the instant it expires: `CachedToken(string Value, DateTimeOffset ExpiresAt)`
  (`ServiceTokenProvider.cs:105`).
- **Depends on**: BCL only.
- **Concept reinforced, immutable value published across threads.** Being a record (reference type), the
  provider can publish it with a single `Volatile.Write` and readers see either the old or the new token,
  never a torn pair (`ServiceTokenProvider.cs:52-70`).
- **Walkthrough**: `IsFresh` compares `ExpiresAt - now` to the 60-second window (line 76); `Mint` builds it
  from the written token string and the `exp` actually serialized (line 101).
- **Why it's built this way**: carrying `ExpiresAt` next to `Value` lets the cache age a token without
  re-parsing the JWT.
- **Where it's used**: only inside `ServiceTokenProvider.cs`.

### DefaultSchemeGuard
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:165` · Level 0 · class (private, sealed)

- **What it is**: an empty marker class nested in
  [`ServiceTokenServiceCollectionExtensions`](#servicetokenservicecollectionextensions)
  (`ServiceTokenServiceCollectionExtensions.cs:165`), declared `private sealed class DefaultSchemeGuard;`.
  Its doc comment calls it "marker options whose start-time validation runs the default-scheme guard"
  (line 164).
- **Depends on**: nothing; it carries no members.
- **Concept reinforced, fail-fast configuration contract.** [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)
  `[Rubric §11, Security]`: the options system runs `Validate` plus `ValidateOnStart` against it, so the check
  executes once at host startup (`ServiceTokenServiceCollectionExtensions.cs:78-82`).
- **Walkthrough**: `AddOptions<DefaultSchemeGuard>().Validate<IOptions<AuthenticationOptions>>(...)` calls
  `ServiceTokenIsNotTheDefaultScheme` and, on failure, reports that the `ServiceToken` scheme must not be the
  default (lines 78-82).
- **Why it's built this way**: a marker type keeps the validation off `AuthenticationOptions` itself, so reading
  those options stays free of side effects (comment, lines 76-77).
- **Where it's used**: only in `AddServiceTokenAuthentication`; exercised by `ServiceTokenDefaultSchemeGuardTests`.

### GrpcWireFormat
> MMCA.Common.Grpc · `MMCA.Common.Grpc` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/GrpcWireFormat.cs:30` · Level 0 · class (static)

- **What it is**: the shared string encodings a hand-written gRPC service and its client adapter use
  for the two values protobuf has no lossless scalar for: UTC timestamps, written as ISO 8601
  round-trip (`"O"`) strings, and money, written as invariant-culture decimal strings. Both ends of a
  contract call these helpers, so the wire format is defined once (doc summary,
  `GrpcWireFormat.cs:4-8`).
- **Depends on**: `System.Globalization` (`CultureInfo`, `DateTimeStyles`, `NumberStyles`, BCL,
  `GrpcWireFormat.cs:1`) only. Nothing first-party and nothing from `Grpc.Core`: it is pure string
  formatting that happens to live in the transport package.
- **Concept introduced, a single wire encoding for non-scalar values.** `[Rubric §9, API & Contract
  Design]` (assesses whether a contract has one unambiguous wire shape): the format of a timestamp or an
  amount is part of the contract, so a producer that writes `"O"` and a consumer that parses with the
  thread culture would disagree silently; routing both ends through one class removes that choice from
  every adapter. `[Rubric §29, Resilience & Business Continuity]` (assesses tolerance of partial
  failure and mixed-version operation): `ParseUtc` accepts a timestamp with or without the `Z` marker
  because a rolling deploy can leave a replica that still emits the marker-less form on the other end
  (lines 15-16).
- **Walkthrough**: one private constant, then format/parse pairs.
  - `UtcStyles` (`GrpcWireFormat.cs:37`) is `AssumeUniversal | AdjustToUniversal`. The comment above it
    (lines 32-36) records why: a suffix-less value would otherwise parse as `Unspecified`, and
    `AssumeUniversal` alone yields `Local`; `RoundtripKind` is deliberately absent because
    `DateTime.Parse` rejects it alongside either `Assume*` or `AdjustToUniversal`.
  - `FormatUtc(DateTime)` (line 42) calls `DateTime.SpecifyKind(value, DateTimeKind.Utc)` and formats
    with `"O"` under `CultureInfo.InvariantCulture`, so the output always ends in `Z`.
    `FormatUtcOrEmpty(DateTime?)` (line 51) writes the empty string for `null`, because proto3 has no
    null string.
  - `ParseUtc(string)` (line 61) is `DateTime.Parse(value, InvariantCulture, UtcStyles)`, yielding
    `DateTimeKind.Utc` on the same instant whether or not the marker was present.
    `ParseUtcOrNull(string?)` (line 71) maps the empty string (also what a peer predating the field
    sends) back to `null`.
  - `FormatDecimal(decimal)` (line 77) writes `value.ToString(InvariantCulture)`, keeping the scale (for
    example `1234.50`). `ParseDecimal(string)` (line 83) parses with `NumberStyles.Number` under the
    invariant culture, and `TryParseDecimal(string?, out decimal)` (line 93) is the non-throwing
    variant.
- **Why it's built this way**: the doc remarks (lines 9-28) give three reasons. SQL Server hands
  `DateTime` columns back as `Unspecified`, and `"O"` omits the `Z` for that kind, so `FormatUtc`
  stamps `Utc` before formatting: the stored values are already UTC, so a value is relabelled, never
  converted. A `double` would round a price, and the invariant culture on both ends keeps `"1234.50"`
  from being read back as a different number under a comma-decimal locale. Finally, `ParseUtc` and
  `ParseDecimal` throw `FormatException` on a malformed value, treating a corrupt peer payload as a
  fault; an adapter that wants its own answer for bad input uses `TryParseDecimal` and decides itself.
- **Where it's used**: the ADC export contracts on both sides of the wire. Server side,
  [`UserEngagementExportGrpcService`](group-22-engagement-module.md#userengagementexportgrpcservice)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Grpc/UserEngagementExportGrpcService.cs:50,56,65`)
  and [`UserNotificationExportGrpcService`](group-10-notifications.md#usernotificationexportgrpcservice)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Grpc/UserNotificationExportGrpcService.cs:47,49`)
  call `FormatUtc` / `FormatUtcOrEmpty`; client side, the matching adapters
  [`UserEngagementExportServiceGrpcAdapter`](group-22-engagement-module.md#userengagementexportservicegrpcadapter)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/UserEngagementExportServiceGrpcAdapter.cs:45,51,60`)
  and [`UserNotificationExportServiceGrpcAdapter`](group-10-notifications.md#usernotificationexportservicegrpcadapter)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/UserNotificationExportServiceGrpcAdapter.cs:42,44`)
  call `ParseUtc` / `ParseUtcOrNull`. Covered by `GrpcWireFormatTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/GrpcWireFormatTests.cs:18`).
- **Caveats / not-in-source**: none of the usage sites read for this section calls the decimal
  helpers; their consumers (if any outside ADC) are not determinable from the usage list in hand.

### IServiceTokenProvider
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/IServiceTokenProvider.cs:8` · Level 0 · interface

- **What it is**: the one-method contract for "give me a token naming this service":
  `string GetToken()` (`IServiceTokenProvider.cs:15`). The doc comment promises a compact JWT valid for
  at least the next 60 seconds, returned as the token only, without the `Bearer` prefix (lines 10-14).
- **Depends on**: nothing.
- **Concept introduced, a narrow abstraction in front of credential minting.** `[Rubric §7,
  Microservices Readiness]` (assesses transport concerns behind abstractions) and `[Rubric §11,
  Security]`.
- **Walkthrough**: a single member, `GetToken`. The caller adds `Bearer ` itself, as
  [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor) does.
- **Why it's built this way**: the interceptor depends on the interface, so tests substitute a fake
  without keys or clocks (`ServiceTokenClientInterceptorTests`).
- **Where it's used**: implemented by [`ServiceTokenProvider`](#servicetokenprovider), consumed by
  [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor), registered by
  `AddServiceTokenClient` (`ServiceTokenServiceCollectionExtensions.cs:41`) and referenced in
  `DependencyInjection.cs` (the `AddTypedGrpcClient` doc comment, line 64).

### JwtForwardingClientInterceptor
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Interceptors` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/JwtForwardingClientInterceptor.cs:39` · Level 0 · class (sealed)

- **What it is**: a gRPC **client-side** interceptor that copies the inbound `Authorization` header
  from the current `HttpContext` onto every outgoing gRPC call's metadata, so the caller's JWT bearer
  token rides along to downstream services. When the request authenticated without that header (a
  SignalR hub connection passes its token as `?access_token=`), it forwards the token saved on the
  authentication ticket instead (class remarks, `JwtForwardingClientInterceptor.cs:24-25`). It is the gRPC counterpart of the HTTP
  [`JwtForwardingDelegatingHandler`](group-12-api-hosting-mapping.md#jwtforwardingdelegatinghandler) in
  the API/Infrastructure layer. It forwards only the **user's** token: a call with no user token goes
  out with no `Authorization` entry unless its client opted into service tokens with
  [`ServiceTokenHttpClientBuilderExtensions`](#servicetokenhttpclientbuilderextensions)' `WithServiceToken()`,
  which adds [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor) for that client alone
  (class remarks, lines 27-36). An `Authorization` entry the caller already set is never overwritten
  or duplicated.
- **Depends on**: `Grpc.Core.Interceptors.Interceptor` (the base class) and `Grpc.Core` call types
  (NuGet, see [primer §3, "Transport"](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0));
  `Microsoft.AspNetCore.Http.IHttpContextAccessor` (ASP.NET Core, injected as a primary-constructor
  parameter, `JwtForwardingClientInterceptor.cs:39`); `IAuthenticateResultFeature` and the
  `AuthenticationProperties.GetTokenValue` helper (`using Microsoft.AspNetCore.Authentication`,
  line 3) for the saved-token fallback. Nothing first-party: it lives in
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
  - `internal const string AuthorizationHeader = "Authorization"`
    (`JwtForwardingClientInterceptor.cs:41`), the single header name (internal so
    [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor) shares it), and
    `private const string AccessTokenName = "access_token"` (line 43), the name under which
    `JwtBearerOptions.SaveToken` stores the token on the authentication ticket.
  - The five overrides (`AsyncUnaryCall` line 46, `BlockingUnaryCall` line 57,
    `AsyncServerStreamingCall` line 68, `AsyncClientStreamingCall` line 79, `AsyncDuplexStreamingCall`
    line 89) each follow the same three-step shape:
    `ArgumentNullException.ThrowIfNull(continuation)`, build a new context via
    `WithForwardedAuthorization(context)`, then invoke `continuation(...)`. The two streaming variants
    whose continuation takes no `request` argument call `continuation(newContext)` (lines 85 and 95);
    the other three pass `(request, newContext)`.
  - `WithForwardedAuthorization<TRequest, TResponse>` (`JwtForwardingClientInterceptor.cs:162-168`) is now a
    thin private wrapper: if `HasAuthorization(context)` is true it returns the context unchanged,
    otherwise it calls `WithAuthorization(context, ResolveUserAuthorization(httpContextAccessor.HttpContext))`.
  - `WithAuthorization<TRequest, TResponse>(context, authHeader)` (`JwtForwardingClientInterceptor.cs:108-123`)
    is the shared `internal static` helper. If `authHeader` is null or empty, **or** the call already
    carries an `Authorization` entry, it returns the context **unchanged** (line 114): the deliberate
    **no-op when there is no HTTP request**, for example a background processor or hosted service
    invoking a gRPC client outside a request. Otherwise it takes the call's existing `Options.Headers`
    (or a fresh `Metadata` via the collection expression `[]`, line 119), does `headers.Add(...)`
    (line 120), rebuilds the call options with `WithHeaders` (line 121), and returns a new
    `ClientInterceptorContext` carrying `context.Method`, `context.Host`, and the new options (line 122).
  - `HasAuthorization<TRequest, TResponse>(context)` (`JwtForwardingClientInterceptor.cs:133-136`) answers
    whether `Options.Headers?.GetValue("Authorization")` is non-null, so a prior interceptor or the caller
    that already set it is never overwritten or duplicated.
  - `ResolveUserAuthorization(HttpContext?)` (`JwtForwardingClientInterceptor.cs:144-160`, `internal static`)
    picks the value.
    No `HttpContext` answers `null` (lines 146-149). A non-empty inbound `Authorization` header is
    returned as-is and **always wins** (lines 151-155). Otherwise it reads
    `httpContext.Features.Get<IAuthenticateResultFeature>()?.AuthenticateResult?.Properties?.GetTokenValue("access_token")`
    and, when that is non-empty, answers `$"Bearer {savedToken}"` (lines 157-159). This is what lets a
    call made from inside a SignalR hub, where the token arrived on the query string rather than in a
    header, still carry the caller's identity downstream.
- **Why it's built this way**: sealing the class and overriding all five call shapes makes token
  forwarding total, so there is no call shape that silently drops the credential. Doing it in an
  interceptor rather than at each call site keeps consumer code transport-agnostic, which is exactly the
  extraction boundary [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) want. The
  duplicate-header guard means it composes safely with other interceptors, and the helpers being
  `internal static` lets [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor) reuse the same
  guard and header write instead of copying them. The saved-token fallback
  forwards the token the request actually authenticated with, and only when no header is present, so
  it never overrides an explicit `Authorization` value.
- **Where it's used**: registered automatically by `AddTypedGrpcClient<TClient>` in this group's
  [`DependencyInjection`](#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:95,100`), so every typed gRPC
  client an ADC or Store service host builds gets it without explicit wiring.

### ServiceContractAttribute
> MMCA.Common.Shared · `MMCA.Common.Shared.Abstractions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:23` · Level 0 · class (sealed attribute)

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
  own doc comment (`ServiceContractAttribute.cs:8-11`) is not advisory, it is executed as a fitness
  function. `ArchitectureRules.ServiceContractsDoNotDependOnServiceInternals`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Contracts.cs:32`)
  scans every assembly the repo's architecture map registers, selects the types that carry the marker
  (`MeetCustomRule(CarriesServiceContractAttribute)`, line 44, matched by the full type name string held
  in `ServiceContractAttributeFullName`, lines 10-11), and asserts none of them depends on the producing
  service's Domain, Application, or Infrastructure namespaces. A second rule,
  `ServiceContractImplementationsAreNotPublic` (`ArchitectureRules.Contracts.cs:81`), walks the same
  marker in the other direction: a type implementing a `[ServiceContract]` interface must not itself be
  public, because the interface is the published surface, not the implementation.
- **Walkthrough**: `[AttributeUsage(AttributeTargets.Interface | AttributeTargets.Class |
  AttributeTargets.Struct, Inherited = false)]` (`ServiceContractAttribute.cs:22`) constrains where it
  can be applied and keeps it off derived types; two constructors, parameterless (line 26) and one taking
  a `version` string (line 34); a get-only `Version` property initialized to `"v1"` (line 37), so the
  parameterless form still reports a version.
- **Why it's built this way**: an attribute is the lightest way to *mark* membership in a category that
  tooling and tests then enforce, and the marker is deliberately **attribute-driven rather than
  layer-driven**. The remarks on
  `ServiceContractPurityTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/ServiceContractPurityTestsBase.cs:9-11`)
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
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/Live/IEventLiveValidationService.cs:12`),
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
  [`ServiceContractPurityTestsBase`](group-28-testing-infrastructure.md#servicecontractpuritytestsbase)
  (`ServiceContractPurityTestsBase.cs:20-26`) and
  [`ContractImplementationTestsBase`](group-28-testing-infrastructure.md#contractimplementationtestsbase)
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/ContractImplementationTestsBase.cs:20,34`),
  which Common, ADC, Store, and Helpdesk each subclass in their architecture-test project.
- **Caveats / not-in-source**: generated gRPC client and server classes are **not** marked; the doc
  comment (`ServiceContractAttribute.cs:16-17`) states they are part of the contract surface by virtue of
  being declared in a `.proto` file, so the attribute is not needed on them. The `Version` value is
  metadata only: no source read in this group consumes it, so it does not participate in any wire-level
  version negotiation.

### ServiceTokenDefaults
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenDefaults.cs:8` · Level 0 · class (static)

- **What it is**: the three well-known names of the service-token scheme, held as constants so the minting
  side and the validating side cannot drift: the authentication scheme `"ServiceToken"`
  (`ServiceTokenDefaults.cs:15`), the authorization policy `"InternalCaller"` (line 21), and the claim
  type `"svc"` that carries the calling service's name (line 27).
- **Depends on**: nothing; it is three `const string` members in `MMCA.Common.Grpc`.
- **Concept introduced, a service-to-service credential kept separate from the user credential.**
  `[Rubric §11, Security]` (assesses how callers are told apart and how far a credential reaches). The
  doc comment on the scheme states the key rule: it is **never the default scheme**, so a service token
  only authenticates an endpoint that names the scheme, in practice one under `InternalCallerPolicy`
  (lines 10-14). The policy accepts an authenticated caller from either the user JwtBearer scheme or the
  service scheme (lines 17-20). A token without the `svc` claim is not a service token and is refused
  (lines 23-26).
- **Walkthrough**: no behavior, only the three constants above.
- **Why it's built this way**: the scheme name is shared by `AddServiceTokenAuthentication`, the default
  scheme guard, and the policy registration, and the claim type is shared by the minting side and the
  validation event, so one definition removes string drift between them.
- **Where it's used**: [`ServiceTokenServiceCollectionExtensions`](#servicetokenservicecollectionextensions)
  (13 references, `ServiceTokenServiceCollectionExtensions.cs`), [`ServiceTokenProvider`](#servicetokenprovider)
  (writes the claim, `ServiceTokenProvider.cs:88`), and the tests
  `MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/Authentication/ServiceTokenAuthenticationTests.cs`.

### ServiceTokenSettings
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenSettings.cs:18` · Level 0 · class (sealed)

- **What it is**: the options class bound from the `Grpc:ServiceToken` section
  (`SectionName`, `ServiceTokenSettings.cs:21`). It carries `SigningKey` (line 33, Base64 HMAC key shared
  by every service in the deployment), `ServiceName` (line 39, the `sub` and `svc` claims), `Issuer`
  (line 42, default `"mmca-service"`), `Audience` (line 48, default `"internal-grpc"`), and
  `LifetimeMinutes` (line 51, default 5). It implements `IValidatableObject`.
- **Depends on**: `System.ComponentModel.DataAnnotations` (BCL) only.
- **Concept introduced, fail-fast configuration contract.** `[Rubric §11, Security]` (assesses secret
  and key handling) and the project's fail-fast option pattern
  ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html);
  key sourcing: [ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)).
  `Validate` (line 59) yields one `ValidationResult` per defect, so a misconfigured host fails on start
  with a message naming the exact problem rather than minting tokens a receiver cannot validate.
- **Walkthrough**: `SigningKey` is checked in three steps: blank (required), not valid Base64
  (`DecodedLength` returns `null`, line 96), or fewer than the HS256 minimum of 32 bytes
  (`MinimumSigningKeyBytes`, line 24). `ServiceName` must be non-blank. `LifetimeMinutes` must lie in
  1 to 60 (`MaximumLifetimeMinutes`, line 27). `DecodedLength` allocates a buffer sized
  `(length + 3) / 4 * 3` and uses `Convert.TryFromBase64String` (lines 96-100).
- **Why it's built this way**: the audience default differs from the user tokens' audience on purpose,
  because the audience is what keeps a service token out of the user scheme (doc comment, lines 44-47).
  The five-minute default and 60-minute cap bound the damage of a leaked token.
- **Where it's used**: bound and validated once by `AddServiceTokenSettings`
  (`ServiceTokenServiceCollectionExtensions.cs:96-106`), read by [`ServiceTokenProvider`](#servicetokenprovider)
  to mint, and covered by `ServiceTokenSettingsTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/Authentication/ServiceTokenSettingsTests.cs`).

### ServiceTokenClientInterceptor
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Interceptors` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/ServiceTokenClientInterceptor.cs:28` · Level 1 · class (sealed)

- **What it is**: a gRPC client interceptor that, for a call carrying no user token, attaches this
  service's own token as `Authorization: Bearer {token}`. It is added per client by
  [`WithServiceToken()`](#servicetokenhttpclientbuilderextensions), never globally.
- **Depends on**: [`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) (reuses its
  `internal static` `HasAuthorization`, `ResolveUserAuthorization` and `WithAuthorization`),
  [`IServiceTokenProvider`](#iservicetokenprovider) (the token source), and `IHttpContextAccessor`; both
  injected through the primary constructor (`ServiceTokenClientInterceptor.cs:28-30`).
- **Concept reinforced, interceptors for cross-service auth.** `[Rubric §11, Security]` (assesses how a
  call proves who is making it when no user is involved, such as a background job).
- **Walkthrough**: the five call-shape overrides (`AsyncUnaryCall` line 33, `BlockingUnaryCall` line 43,
  `AsyncServerStreamingCall` line 53, `AsyncClientStreamingCall` line 63, `AsyncDuplexStreamingCall`
  line 72) each null-check the continuation and pass `WithServiceAuthorization(context)`. That helper
  (line 80) returns the context unchanged when the call already has an `Authorization` entry **or** a user
  token resolves from the ambient request (lines 85-89). Otherwise it calls
  `serviceTokenProvider.GetToken()` (line 91) and hands `Bearer {token}`, or `null` for an empty token, to
  `JwtForwardingClientInterceptor.WithAuthorization` (lines 92-94).
- **Why it's built this way**: the user's identity always wins over the service's, so a user-initiated
  call is never silently escalated to a service call. Reusing the jwt interceptor's helpers keeps one
  definition of "already has an `Authorization` entry".
- **Where it's used**: added by `WithServiceToken()`
  (`ServiceTokenHttpClientBuilderExtensions.cs:34`); tested in
  `MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/ServiceTokenClientInterceptorTests.cs`.

### ServiceTokenProvider
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenProvider.cs:23` · Level 1 · class (sealed)

- **What it is**: the [`IServiceTokenProvider`](#iservicetokenprovider) implementation. It mints an HS256
  JWT naming this service and caches it, handing out the same token until its last 60 seconds
  (`RefreshWindow`, `ServiceTokenProvider.cs:26`).
- **Depends on**: [`ServiceTokenSettings`](#servicetokensettings) (via `IOptions`), `TimeProvider` (the
  clock), [`ServiceTokenDefaults`](#servicetokendefaults) (the `svc` claim type), and
  `System.IdentityModel.Tokens.Jwt` (NuGet). The constructor builds `SigningCredentials` once from the
  Base64 key with `SecurityAlgorithms.HmacSha256` (lines 39-48).
- **Concept introduced, a double-checked token cache.** `[Rubric §11, Security]` (assesses short-lived
  credentials) and `[Rubric §29, Resilience & Business Continuity]` (a token that could expire mid-call
  is never handed out).
- **Walkthrough**: `GetToken()` (line 52) reads the published `_cached` with `Volatile.Read`; if
  `IsFresh` (line 76: `ExpiresAt - now > RefreshWindow`) it returns without locking. Otherwise it takes
  the `Lock _gate` (line 61), re-checks in case another caller minted while it waited, and only then
  `Mint`s and publishes with `Volatile.Write`. `Mint` (line 79) truncates now to whole seconds, because JWT
  times are whole seconds and the cache must age the token by the `exp` actually written, then adds
  `LifetimeMinutes`. The claims are `sub`, `svc`, a fresh `jti`, and `iat` (lines 85-91); the token carries
  the issuer, audience, `notBefore` and `expires` from the settings (lines 93-99), and the result is stored as a
  [`CachedToken`](#cachedtoken) (line 101).
- **Why it's built this way**: registered as a singleton, so one cache per process serves every
  outgoing call; readers never contend, and only a caller inside the refresh window takes the lock, once
  for everyone waiting (class remarks, lines 16-22).
- **Where it's used**: registered by `AddServiceTokenClient`
  (`ServiceTokenServiceCollectionExtensions.cs:41`) and consumed by
  [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor); tested in `ServiceTokenProviderTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/Authentication/ServiceTokenProviderTests.cs`).

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:77,94`); caught by
  [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) in all four server-handler shapes.
- **Caveats / not-in-source**: the three CA1032 constructors produce an instance with **no** errors, and
  that case is not free downstream. The interceptor treats it specially (see
  `GrpcResultExceptionInterceptor.cs:126-138`) because the normal encoder would otherwise flatten the
  message away; prefer the `IReadOnlyList<Error>` constructor, which is what `ThrowIfFailure` uses.

### ServiceTokenHttpClientBuilderExtensions
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenHttpClientBuilderExtensions.cs:11` · Level 2 · class (static)

- **What it is**: a C# `extension(IHttpClientBuilder)` block (see
  [primer §4](00-primer.md#4-c-build-and-code-style-conventions)) with one method, `WithServiceToken()`
  (`ServiceTokenHttpClientBuilderExtensions.cs:28`), that opts a single typed gRPC client into service
  tokens.
- **Depends on**: [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor) and
  `Grpc.Net.ClientFactory` (`AddInterceptor`, `InterceptorScope.Client`).
- **Concept introduced, per-client opt-in.** `[Rubric §11, Security]` (assesses least privilege). Chain it
  onto `AddTypedGrpcClient<TClient>` ([`DependencyInjection`](#dependencyinjection)) only for a client
  whose server validates service tokens (`AddServiceTokenAuthentication`); leave it off every other
  client, since a server that does not validate them would have to reject the token (doc comment,
  lines 14-19).
- **Walkthrough**: null-checks the builder (line 30), calls `AddHttpContextAccessor()` (line 32), registers
  `TryAddTransient<ServiceTokenClientInterceptor>()` (line 33), and returns
  `builder.AddInterceptor<ServiceTokenClientInterceptor>(InterceptorScope.Client)` (line 34), so the
  builder chains on.
- **Why it's built this way**: the interceptor attaches to that client alone (see
  [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). The host must also call
  [`AddServiceTokenClient`](#servicetokenservicecollectionextensions); without it the client fails to
  resolve on first use, naming the missing `IServiceTokenProvider` (remarks, lines 21-24).
- **Where it's used**: tested in `ServiceTokenHttpClientBuilderExtensionsTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/Authentication/ServiceTokenHttpClientBuilderExtensionsTests.cs`).

### ServiceTokenServiceCollectionExtensions
> MMCA.Common.Grpc · `MMCA.Common.Grpc.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:23` · Level 2 · class (static)

- **What it is**: the registration surface for both ends of service tokens, as an
  `extension(IServiceCollection)` block ([ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html)):
  `AddServiceTokenClient(IConfiguration)` (`ServiceTokenServiceCollectionExtensions.cs:35`) for a caller, and
  `AddServiceTokenAuthentication(IConfiguration)` (line 63) for a receiver.
- **Depends on**: [`ServiceTokenSettings`](#servicetokensettings),
  [`ServiceTokenDefaults`](#servicetokendefaults), [`IServiceTokenProvider`](#iservicetokenprovider) /
  [`ServiceTokenProvider`](#servicetokenprovider), [`DefaultSchemeGuard`](#defaultschemeguard), and
  ASP.NET Core JwtBearer, authorization and options.
- **Concept introduced, fail-fast hosting for a security rule.** `[Rubric §11, Security]` (assesses
  whether an unsafe configuration can start) and
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html).
- **Walkthrough**: `AddServiceTokenClient` binds the settings, `TryAddSingleton(TimeProvider.System)` and
  `TryAddSingleton<IServiceTokenProvider, ServiceTokenProvider>()` (lines 39-41).
  `AddServiceTokenAuthentication` binds the settings (line 67), adds the `ServiceToken` JwtBearer scheme
  (line 70), configures it from the validated settings (lines 71-72), registers the default-scheme guard
  with `ValidateOnStart` (lines 78-82), and adds the `InternalCaller` policy over the user scheme plus the
  service scheme with `RequireAuthenticatedUser` (lines 84-87). The private `AddServiceTokenSettings`
  (line 96) returns early when a `DataAnnotationValidateOptions<ServiceTokenSettings>` is already
  registered (line 98), then binds `Grpc:ServiceToken` with `ValidateDataAnnotations().ValidateOnStart()`
  (lines 103-106), so a bad section reports each problem once. `ServiceTokenIsNotTheDefaultScheme`
  (line 110) is false if any of the four default-scheme slots is `ServiceToken`, or if no default is set and
  `ServiceToken` is the lone registered scheme (ASP.NET Core promotes a lone scheme to default).
  `ConfigureServiceTokenBearer` (line 131) validates issuer, audience, lifetime and signing key, pins
  `ValidAlgorithms` to HS256 against algorithm-confusion (lines 133-145), and its `OnTokenValidated` event
  fails the context when the `svc` claim is missing or blank (lines 147-161).
- **Why it's built this way**: the guard exists because a service token that became the default scheme
  would satisfy every plain `[Authorize]` endpoint. The check runs once at startup via a marker options type,
  so reading `AuthenticationOptions` stays free of side effects. See
  [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html).
- **Where it's used**: not referenced outside its defining file in source; the tests
  `ServiceTokenAuthenticationTests` and `ServiceTokenDefaultSchemeGuardTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/Authentication/`) exercise it.
- **Caveats / not-in-source**: ADC and Store host usage of these two methods was not found in the usage
  list for this section (Not determinable from source here).

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
  and `[Rubric §9, API & Contract Design]` (error translation lives in one interceptor, not re-coded in
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
  streaming ones, gets uniform `Result`-failure surfacing. Keeping it in an interceptor is the §9 point:
  the translation lives in one place, so a change to the error wire shape (see
  [`ResultGrpcExtensions`](#resultgrpcextensions)) is made once. Logging at `Information` rather than
  `Error` is deliberate for a *domain* failure: a rejected command is an expected outcome, not a fault.
- **Where it's used**: registered by `AddGrpcServiceDefaults()` in this group's
  [`DependencyInjection`](#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:38,42`), which adds it to the
  gRPC server pipeline of every extracted service host. Its live counterparts are the gRPC service
  implementations that call `result.ThrowIfFailure()`, for example
  [`SessionBookmarksGrpcService`](group-20-conference-api-grpc.md#sessionbookmarksgrpcservice)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:39,57`) and
  [`EventLiveValidationGrpcService`](group-20-conference-api-grpc.md#eventlivevalidationgrpcservice)
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:38,62,91,115`).

### ResultGrpcExtensions
> MMCA.Common.Grpc · `MMCA.Common.Grpc` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:31` · Level 3 · class (static)

- **What it is**: the extension members that bridge [`Result`](group-01-result-error-handling.md#result)
  and `Result<T>` to gRPC's transport model (`RpcException`, `StatusCode`, `Metadata` trailers). It is
  both an **encoder** (server side: `ThrowIfFailure`, `UnwrapOrThrow`, `ToRpcException`) and a matching
  **decoder** (client side: `ToErrors`, `ToResult`, `ToResult<T>`), plus the `ErrorType` to `StatusCode`
  lookup table.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`ErrorType`](group-01-result-error-handling.md#errortype),
  [`ErrorTypeSeverity`](group-01-result-error-handling.md#errortypeseverity),
  [`Result`](group-01-result-error-handling.md#result) and `Result<T>` (all via
  `using MMCA.Common.Shared.Abstractions`, `ResultGrpcExtensions.cs:8`);
  [`ResultFailureException`](#resultfailureexception) (Level 2); `Grpc.Core` (NuGet);
  `System.Collections.Frozen`, `System.Globalization`, `System.Runtime.CompilerServices`, and
  `System.Text` (`StringBuilder`, `Rune`, for trailer escaping) (BCL, `ResultGrpcExtensions.cs:1-5`).
- **Concept introduced, a symmetric wire codec for the Result pattern.** `[Rubric §9, API & Contract
  Design]` (assesses consistent error shapes across protocols) and `[Rubric §7, Microservices Readiness]`
  (the Result pattern behaves identically over HTTP and gRPC). Where
  [`ErrorHttpMapping`](group-12-api-hosting-mapping.md#errorhttpmapping) maps `ErrorType` to HTTP status
  codes, `ErrorTypeToStatusCode` here (lines 37-50) maps it to gRPC `StatusCode`:
  `Validation`, `Invariant`, and `Failure` to `InvalidArgument`; `NotFound` to `NotFound`; `Conflict` to
  `Aborted`; `Unauthorized` to `Unauthenticated`; `Forbidden` to `PermissionDenied`;
  `UnprocessableEntity` to `FailedPrecondition`; `Unexpected` to `Internal`; `TooManyRequests` to `ResourceExhausted`. A `FrozenDictionary` is the
  right tool: built once at static init, then read-only and lookup-optimized. The genuinely new idea in
  this type is that the encoding is **round-trippable**: the failure is written into trailers in a shape
  the decoder can reverse, so a caller ends up holding the same `Result` it would have held in-process.
  `[Rubric §29, Resilience, Reliability & Business Continuity]` follows from that: both halves of the codec live here, so the
  wire shape has exactly one definition.
- **Walkthrough**: the class is a set of C# `extension(T)` blocks (see
  [primer §4](00-primer.md#4-c-build-and-code-style-conventions)), which is why it carries a file-level
  `[SuppressMessage]` for CA1708 (lines 27-30): with multiple extension blocks in one static class the
  analyzer flags the compiler-generated grouping members as case-colliding, a false positive.
  - `extension(ErrorType errorType)` (line 52) contributes `ToGrpcStatusCode()` (line 59):
    `GetValueOrDefault(errorType, StatusCode.InvalidArgument)`, so an unmapped error type still produces
    a valid status.
  - `extension(Result result)` (line 63) contributes `ThrowIfFailure()` (line 72), the guard a gRPC
    service method calls first: null-check, then
    `if (result.IsFailure) throw new ResultFailureException(result.Errors)` (lines 75-78).
  - `extension<T>(Result<T> result)` (line 82) contributes `UnwrapOrThrow()` (line 89), the typed
    variant: throws on failure, otherwise returns `result.Value!` (line 97).
  - `extension(IReadOnlyList<Error> errors)` (line 101) contributes `ToRpcException()` (line 119), the
    encoder. The status code comes from `ErrorTypeSeverity.MostSevere(errors).Type.ToGrpcStatusCode()`
    (line 124), falling back to `StatusCode.Internal` for an empty list; the `Status.Detail` is the
    joined `"Code: Message"` summary or the literal `"Unspecified failure"` (lines 127-129). It then
    walks every error and writes **structured trailing metadata**: `error-{i}-code`, `error-{i}-message`,
    and `error-{i}-type` always (lines 135-137), plus `error-{i}-source` and `error-{i}-target` only when
    non-empty (lines 138-146). Every key is built with `CultureInfo.InvariantCulture` so the wire form
    cannot vary by locale. The message, source, and target **values** pass through
    `EscapeTrailerValue` (lines 136, 140, 145); the code and the type name are written raw. It returns
    `new RpcException(new Status(statusCode, detail), trailers)` (line 149).
  - `extension(Metadata? trailers)` (line 153) contributes `ToErrors()` (line 173), the exact inverse.
    Null or empty trailers decode to `[]` (lines 175-178). Otherwise it loops from index zero, reading
    `error-{i}-code` and **stopping at the first missing code** (lines 185-189), which matches the
    contiguous layout the encoder writes; message, source, and target are percent-decoded through
    `Unescape`, a missing message decodes to the empty string, and a missing source or target to `null`
    (lines 191-194), mirroring the encoder's omission rule.
  - `extension(RpcException exception)` (line 204) contributes `ToResult()` (line 218) and
    `ToResult<T>()` (line 242), which close the round trip. Both decode `exception.Trailers.ToErrors()`
    and return `Result.Failure(errors)` when the trailers carried a structured failure, or
    `Result.Failure(TransportError(exception, source))` when they did not (lines 224-226 and 248-250).
    Both take a `[CallerMemberName] string source = ""` parameter, so the synthesized transport error is
    stamped with the calling adapter method's name for free.
  - The private helpers close the file. `ErrorFactories` (lines 259-271) is a second `FrozenDictionary`
    mapping each `ErrorType` to its `Error` factory method, documented (lines 254-258) as a lookup table
    rather than a `switch` so adding an error type stays a one-line entry instead of pushing the decoder
    past the cyclomatic-complexity ceiling `[Rubric §15, Best Practices & Code Quality]`.
    `ParseErrorType` (line 278) does a case-**sensitive** `Enum.TryParse` and falls back to
    `ErrorType.Failure`. `EscapeTrailerValue` (line 287) returns the value unchanged when every
    character is verbatim-safe, otherwise walks it rune by rune and writes each byte of a non-verbatim
    rune's UTF-8 encoding as `%XX`; `IsVerbatimTrailerChar` (line 314) defines verbatim-safe as printable
    ASCII (`' '` to `'~'`) except `%` itself, so the decoder can tell an escape from a literal.
    `Unescape` (line 317) is `Uri.UnescapeDataString`, with `null` staying `null`. `BuildError`
    (line 321) dispatches through the factory table, and `TransportError` (line 331) builds the stand-in
    error coded `$"Grpc.{exception.StatusCode}"` carrying `exception.Status.Detail`.
- **Why it's built this way**: four decisions are worth naming.
  1. **The most severe error picks the status, not the first one** (line 124). The encoder ranks the list
     through [`ErrorTypeSeverity`](group-01-result-error-handling.md#errortypeseverity)
     (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ErrorTypeSeverity.cs:71`, ties keep the
     earliest error), the same ranking the HTTP edge uses, so an aggregate built by `Result.Combine`
     cannot be downgraded by error ordering: an `Unauthorized` travelling behind a `Validation` still
     answers `Unauthenticated`. Ranking picks the status only; **all** errors still travel in the
     trailers.
  2. **The decoder degrades rather than throws.** An unrecognized `error-{i}-type` falls back to
     `ErrorType.Failure` (line 281) instead of raising, so a newer peer that adds an error type cannot
     break an older client, and an `RpcException` with no structured trailers at all (a reset connection,
     an exceeded deadline) still reaches the caller as a `Result` failure rather than an exception
     (lines 326-336). That is the `[Rubric §29, Resilience & Business Continuity]` angle: the client-side
     programming model never changes shape because the network misbehaved.
  3. **Trailers carry the full error list, not a flattened string**, so the client reconstructs real
     `Error` objects with their original `Code`, `Message`, `Type`, `Source`, and `Target`. This is what
     makes the Result pattern survive the hop intact ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).
  4. **Trailer values are percent-encoded, not passed raw** (doc comment, lines 112-116). gRPC text
     metadata is printable ASCII only, so an accented character or a newline in an error message would
     break the trailer at the transport. Escaping only what needs it means a plain-ASCII value without
     `%` goes on the wire unchanged, and the decoder's `Unescape` restores the original string exactly,
     so the round trip holds for any message text.
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
> MMCA.Common.Grpc · `MMCA.Common.Grpc` · `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:25` · Level 4 · class (static)

- **What it is**: the gRPC infrastructure registration class. It is a C# `extension(IServiceCollection)`
  block (line 27, see [primer §4](00-primer.md#4-c-build-and-code-style-conventions)) exposing two
  methods: `AddGrpcServiceDefaults()` for the server side and
  `AddTypedGrpcClient<TClient>(string serviceName)` for the client side. Its class-level `<remarks>`
  (lines 15-24) states the package's job in one place: this is the extraction boundary for a module
  lifted out of the modular monolith, it carries transport concerns only, and consuming modules keep
  the generated protobuf types out of their application and domain code behind a hand-written adapter
  that is the module's Anti-Corruption Layer.
- **Depends on**: [`GrpcResultExceptionInterceptor`](#grpcresultexceptioninterceptor) (Level 3),
  [`JwtForwardingClientInterceptor`](#jwtforwardingclientinterceptor) (Level 0; it forwards only the user's
  token, and a client that opts in with `WithServiceToken()` gets this service's own token from
  [`ServiceTokenClientInterceptor`](#servicetokenclientinterceptor) when there is none, see the doc
  comment at `DependencyInjection.cs:63-65`), and
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
  (lines 97 and 101, its justification text pointing back at the class-level extraction boundary
  remarks) rather than silently.
- **Walkthrough**
  - `AddGrpcServiceDefaults()` (line 36): `TryAddSingleton<GrpcResultExceptionInterceptor>()` (line 38),
    then `AddGrpc(options => { options.Interceptors.Add<GrpcResultExceptionInterceptor>(); options.EnableDetailedErrors = false; })`
    (lines 40-44), then `AddGrpcReflection()` (line 46) so tools such as `grpcurl` can introspect the
    schema. Returns `services` for chaining.
  - `AddTypedGrpcClient<TClient>(string serviceName)` (line 89) does four things in order. First it
    validates the name (`ArgumentException.ThrowIfNullOrWhiteSpace`, line 92) and registers
    `AddHttpContextAccessor()` plus `TryAddTransient<JwtForwardingClientInterceptor>()` (lines 94-95).
    Second it calls `AddGrpcClient<TClient>` with the address `new Uri($"http://{serviceName}")`
    (lines 98-99), resolved by Aspire service discovery, and attaches
    `.AddInterceptor<JwtForwardingClientInterceptor>(InterceptorScope.Client)` (line 100). Third it
    **forces the primary handler** to a `SocketsHttpHandler` (lines 112-120) with
    `EnableMultipleHttp2Connections = true` and the connection-hygiene values re-applied from
    `HttpResilienceDefaults`: `PooledConnectionLifetime` (10 minutes), `PooledConnectionIdleTimeout`
    (5 minutes), `KeepAlivePingDelay` (60 seconds), `KeepAlivePingTimeout` (30 seconds), and
    `KeepAlivePingPolicy = WithActiveRequests`
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:36,39,42,45`).
    Fourth it layers `AddStandardResilienceHandler` back on (lines 129-152), setting every knob from
    [`GrpcResilienceDefaults`](group-16-aspire-orchestration.md#grpcresiliencedefaults): a 30-second
    attempt timeout and 90-second total request timeout re-exposed from the outbound-HTTP path, one
    retry beyond the initial attempt, and an explicit circuit breaker (60-second sampling window,
    `FailureRatio` 0.5, `MinimumThroughput` 10, `BreakDuration` 10 seconds)
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/GrpcResilienceDefaults.cs:15-33`). The retry
    is narrowed by `options.Retry.ShouldHandle` (lines 142-147) to an `HttpRequestException` whose
    `HttpRequestError` is `NameResolutionError`, `ConnectionError`, or `SecureConnectionError`: only a
    failure to reach the service before the request was sent is retried. It returns the original
    `IHttpClientBuilder` (line 153), not the resilience-pipeline builder, so callers can keep chaining.
- **Why it's built this way**: four deliberate decisions live here, each documented inline and each
  worth reading before changing anything.
  1. **h2c (HTTP/2 cleartext) over `http://{serviceName}`, not HTTPS** (lines 54-62). Aspire's
     project-resource endpoint discovery from `launchSettings.json` does not reliably create a
     `services__<name>__https__0` discovery key, and the resolver silently falls back to `http`
     regardless of the requested scheme. The target service must therefore serve HTTP/2 on its cleartext
     endpoint (`Kestrel:EndpointDefaults:Protocols = "Http2"`) or Kestrel rejects the frames with
     `HTTP_1_1_REQUIRED`. The per-host transport choices are
     [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html).
  2. **The explicit `SocketsHttpHandler`** (lines 103-111). The global `ConfigureHttpClientDefaults` from
     `MMCA.Common.Aspire` applies to *all* `HttpClient` instances including this gRPC one, and its
     standard resilience pipeline can wrap the primary handler in a way that defeats HTTP/2 negotiation.
     Setting `SocketsHttpHandler` explicitly bypasses that wrapper for the gRPC client only, which is
     precisely why the pooled-lifetime and keep-alive values have to be re-applied from the same
     `HttpResilienceDefaults` source of truth: the override drops whatever the global default had set.
  3. **The circuit breaker is stated explicitly, not left at the library defaults** (comment at
     lines 122-128, values at `GrpcResilienceDefaults.cs:26-33`). An east-west gRPC call addresses a peer
     directly and bypasses the Gateway's active health checks, so the breaker is the only thing that
     notices a peer going bad. Timeouts and the retry budget, by contrast, are re-exposed from
     `HttpResilienceDefaults` so the two paths cannot drift.
  4. **The retry predicate is replaced, not left at the default** (comment at lines 135-141). Every gRPC
     call is an HTTP POST, so the standard handler's unsafe-method opt-out would switch the retry off
     entirely. Instead only an `HttpRequestException` whose `HttpRequestError` is `NameResolutionError`,
     `ConnectionError`, or `SecureConnectionError` (failures before the request was sent, for example
     during an ACA replica rollover) is retried. A returned status, an attempt timeout, or an
     `HttpRequestException` raised after the request frames were written (`ResponseEnded`, a protocol
     error, or `Unknown` wrapping a connection reset) may already have reached the handler, and
     replaying it could run the call twice. That keeps the single retry safe for
     non-idempotent calls `[Rubric §29, Resilience & Business Continuity]`.

  The doc comment is explicit that application code should **not** consume the generated client
  directly (lines 68-78): register a hand-written adapter implementing the consuming module's own C#
  interface contract (for example `ISessionBookmarkValidationService`) that delegates to the typed
  gRPC client. That adapter *is* the module's Anti-Corruption Layer: the one place where the peer's
  wire model (the generated protobuf types) is translated into the module's own interface contract and
  domain types, so the peer's contract never leaks inward past it. The source names the pattern and
  cites [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) (line 76). Extraction
  itself follows the Strangler Fig route (lines 79-84,
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)): the new service
  host is stood up beside the modular monolith, the typed client and its Anti-Corruption Layer adapter
  move traffic to it, and the in-process path is retired last.
- **Where it's used**: each extracted service host calls `AddGrpcServiceDefaults()` server-side (ADC's
  Conference, Engagement, Identity, and Notification `Program.cs`, and Store's Catalog, Identity, and
  Sales `Program.cs`); each consumer wires `AddTypedGrpcClient<TClient>("<servicename>")` indirectly
  through the per-contract DI helper in the matching `*.Contracts` project, for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/DependencyInjection.cs:46,76`.
- **Caveats / not-in-source**: many classes across the framework and the modules are named
  `DependencyInjection` (one per package or module); this section is specifically the
  `MMCA.Common.Grpc` one. The `_typemap.tsv` anchor for the bare name is owned by another group, so
  link to this one as `#dependencyinjection` from within this chapter only.


---
[⬅ API Hosting, Middleware, Idempotency & DTO/Contract Mapping](group-12-api-hosting-mapping.md)  •  [Index](00-index.md)  •  [Module System, Composition & Configuration ➡](group-14-module-system-composition.md)
