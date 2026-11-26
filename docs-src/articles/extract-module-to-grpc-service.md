# Extracting a module to a gRPC service, live

> Series: MMCA.Common · Article #32 (tutorial) · Pillar P3/P5 · Groups G13,G14 · Rubric §7,§9 ·
> ADR-007, ADR-008, ADR-012, ADR-021, ADR-088, ADR-089, ADR-118 · Status: grounded in `Website/docs-src/adr/007-grpc-extraction.md`,
> `Website/docs-src/adr/008-service-extraction-topology.md`, `Website/docs-src/adr/012-grpc-host-transport.md`,
> `Website/docs-src/adr/088-gateway-edge-responsibilities.md`,
> `Website/docs-src/adr/089-gateway-topology-owned-by-configuration.md`, `MMCA.Common/AGENTS.md`
> (the "Microservices Extraction Boundaries" section), and `Website/docs-src/onboarding/group-13-grpc-contracts.md`. No em dashes.

**Subtitle:** A step-by-step walkthrough of lifting a module out of the monolith into its own gRPC
service without rewriting application code. Define a contract, wire a typed client, flip the message bus
to a broker, federate auth with JWKS, orchestrate with Aspire, route through a gateway. And it stays
reversible.

---

"We will start as a monolith and split into services later" is one of the most common architecture
promises, and one of the most commonly broken. The split gets deferred because, when the day comes,
"later" turns out to mean a rewrite: the application code is tangled with the transport, the calls
between modules are direct method calls that assume a shared process, and pulling one module out means
touching everything.

MMCA.Common's thesis is that the split should be a wiring change, not a rewrite, and the way you earn
that is by holding one invariant from day one. This article walks through extracting a module live,
step by step, and the whole walkthrough only works because of step zero.

## Step 0: the starting invariant

The precondition that makes everything else possible: **application and domain code already talk to
abstractions, and transport choices live at the edges.**

Concretely, that means two things were true while the code still ran as a monolith:

- Asynchronous, fire-and-forget flows go through `IEventBus`, defined in `MMCA.Common.Application`.
  Beneath it, `IMessageBus` (also an Application abstraction) is the transport the outbox drains
  through. The application never references the broker library.
- Synchronous cross-module calls go through a plain C# interface (for example
  `IBookmarkCountService`), resolved from DI. The caller does not know whether the implementation is an
  in-process object or something else.

This invariant is not a hope. It is enforced. `MicroserviceExtractionTests` in the architecture suite
fail the build if a broker client (RabbitMQ, Azure Service Bus, Amazon SQS or SNS), `MassTransit`
(banned outright), or gRPC or Protobuf types appear in any Domain, Application, or Shared assembly.
So you cannot accidentally couple the core to a transport during normal development, which
means when extraction day arrives the core is genuinely host-agnostic. If your codebase does not have
this property, stop here and fix that first. Everything below assumes it.

We will extract a module (call it Engagement) whose interface `IBookmarkCountService` a peer module
(Conference) calls synchronously.

## Step 1: define the .Contracts project

The wire surface lives in its own project whose name ends in `.Contracts`. That suffix is load-bearing.
`Directory.Build.props` gives any `*.Contracts` project special treatment: it auto-pulls `Grpc.Tools`
and `Google.Protobuf` and compiles every `Protos/**/*.proto` with `GrpcServices="Both"`, generating
**both** the server base class and the client stub. One shared package serves the producer and the
consumer.

```
MMCA.App.Engagement.Contracts/
├── MMCA.App.Engagement.Contracts.csproj   # name ends in .Contracts -> proto auto-compile
└── Protos/
    └── bookmark_count.proto                # GrpcServices="Both" applied by Directory.Build.props
```

```protobuf
// Protos/bookmark_count.proto
syntax = "proto3";
service BookmarkCountService {
  rpc GetCount (GetCountRequest) returns (GetCountResponse);
}
message GetCountRequest  { int32 session_id = 1; }
message GetCountResponse { int32 count = 1; }
```

The contract project also ships a hand-written **gRPC adapter** that implements the same C# interface
the modules already used in-process. The adapter holds the generated client and translates an interface
call into a gRPC call and the proto response back into the C# return type. Because both the in-process
implementation and the adapter satisfy the identical `IBookmarkCountService`, swapping monolith for
microservice is a registration change. The application code that calls `IBookmarkCountService` never
changes.

## Step 2: server side, AddGrpcServiceDefaults()

In the extracted Engagement service's host, register the gRPC server defaults and map the service:

```csharp
// Engagement.Service Program.cs
builder.Services.AddGrpcServiceDefaults();   // from MMCA.Common.Grpc
...
app.MapGrpcService<BookmarkCountGrpcService>();
```

`AddGrpcServiceDefaults()` registers `GrpcResultExceptionInterceptor` plus gRPC reflection.
The interceptor is the piece that keeps your error model intact across the wire. Your gRPC service
implementation calls the inner C# service, gets back a `Result`, and calls `result.ThrowIfFailure()`.
That throws a `ResultFailureException` carrying the `Error` list; the interceptor catches it for all four
server call shapes, logs it, and rethrows `errors.ToRpcException()`, an `RpcException` whose
`StatusCode` comes from a `FrozenDictionary<ErrorType, StatusCode>` mapping that mirrors the HTTP
`ErrorType`-to-status table in `ErrorHttpMapping`, the internal type `ApiControllerBase` reads on the
REST side (the unhandled-failure filter reads the same one). The status comes from the most severe
error in the list, and the trailers carry every error as structured metadata. On the calling side,
`RpcException.ToResult()` reads those trailers back and reconstructs `Result.Failure(errors)`, degrading
a transport fault that carries no trailers to a single `Grpc.{StatusCode}` error. An adapter whose
interface returns a `Result` closes the round trip with it; one whose interface returns a plain value
(`IBookmarkCountService` returns a count) lets the `RpcException` propagate instead. One error model,
two transports, written once in the interceptor.

## Step 3: client side, AddTypedGrpcClient<TClient>(serviceName)

On the calling side (Conference's host), wire the typed gRPC client and replace the local interface
registration with the adapter:

```csharp
// Conference.Service Program.cs, AFTER ModuleLoader has run
services.AddEngagementBookmarkCountClient();   // ships in the .Contracts project; this:
//   1. calls AddTypedGrpcClient<BookmarkCountServiceClient>("engagement")
//   2. services.Replace(IBookmarkCountService -> BookmarkCountServiceGrpcAdapter)
```

`AddTypedGrpcClient<TClient>(serviceName)` wires the generated client to Aspire service discovery,
addressing `http://{serviceName}` over **HTTP/2 cleartext (h2c) with prior knowledge**. Two interceptor
and resilience details ride along automatically:

- A `JwtForwardingClientInterceptor` copies the inbound `Authorization` header off the current
  `HttpContext` onto the outgoing call's metadata, so the caller's JWT rides along downstream and
  distributed authorization works without each handler threading a token. When the request carries no
  `Authorization` header but authenticated with a bearer token from elsewhere (a SignalR hub connection
  passes it as `?access_token=`), it forwards the token saved on the authentication ticket instead; a
  header that is present always wins. It is a no-op outside an HTTP request, for example in a
  background processor, and it forwards only the user's token: a call with no user goes out with no
  credential unless its client opts into the framework's service token with `WithServiceToken()`
  (covered in `Website/docs-src/articles/jwks-cross-service-auth.md`).
- `AddStandardResilienceHandler()` gives every gRPC client a Polly retry, timeout, and
  circuit-breaker pipeline whose values come from the `Grpc`-prefixed members of
  `HttpResilienceDefaults`. The timeouts are the east-west path's own (8 seconds per attempt, 20 in
  total, against the HTTP clients' 30 and 90), while the retry budget of one is shared with the HTTP
  clients. The retry fires only on a failure to reach the peer before the
  request was sent (an `HttpRequestException` whose `HttpRequestError` is name resolution, the TCP
  connect, or the TLS handshake), because every gRPC call is a POST and replaying one that reached the
  handler could run it twice; an `HttpRequestException` raised after the request frames were written is
  not retried. The circuit breaker's failure ratio, minimum throughput and break duration are
  explicit gRPC values, while its sampling window is the HTTP clients' own. A deliberate `SocketsHttpHandler` override forces
  explicit HTTP/2 so the resilience handler cannot defeat the h2c negotiation.

The `services.Replace(...)` is deliberate and uses `Replace`, not `TryAdd`. By the time this runs (after
`ModuleLoader`), the container holds one of three things: the real in-process `IBookmarkCountService`
(if Engagement is enabled in this host), a `Disabled*` stub (registered by the module's
`RegisterDisabledStubs()` when the peer is disabled in configuration), or nothing at all (a dedicated
service host names only its own module to `ModuleLoader`, so the peer is never discovered and no stub
is registered). `Replace` covers all three, so after the call the resolved interface is always the gRPC
adapter pointing at the extracted peer. That is why the call comes
after module discovery.

## Step 4: flip the message bus from in-process to broker

Synchronous calls now cross the wire. The asynchronous, fire-and-forget flows (domain and integration
events) need the same treatment, and the framework makes it a configuration switch rather than a code
change.

`IMessageBus` has two implementations in Infrastructure: `InProcessMessageBus` (in-monolith, delivery is
a method call) and `BrokerMessageBus`, which publishes through the selected transport's
`IBrokerPublisher`. RabbitMQ and PostgreSQL transports are built in, and an adapter package
(MMCA.Common.Azure for Azure Service Bus, MMCA.Common.Aws for Amazon SQS) registers its own; on the
receiving side an `IntegrationEventConsumer` delivers each event to its handlers.
`MessageBusSettings` selects the mode. In the monolith you ran in-process; in the extracted service you
flip the setting to the broker.

```csharp
// Program.cs: the broker registration is conditional on settings, not hard-coded.
builder.Services.AddBrokerMessaging(builder.Configuration);
// MessageBus__Provider=RabbitMq (injected by the AppHost's WithBroker) selects BrokerMessageBus.
```

Your aggregate code, which does `AddDomainEvent(new BookmarkAdded(...))`, does not change. The
transactional outbox follows the same setting. With a broker selected it resolves on: the event is
written as a durable outbox row in the same transaction as the aggregate change and published to the
broker after commit. With `InProcess` it resolves off and events dispatch inside the process that
raised them, unless the host opts in with `MessageBus:EnableOutbox=true`. The `OutboxMessages` table
stays mapped either way, so the switch is never a migration (ADR-003, as amended by ADR-100).

## Step 5: JWKS so the new service validates tokens

The extracted Engagement service now receives forwarded JWTs from Conference and must validate them. It
does so against the issuer's **JWKS**, the public signing keys, not a shared secret. `IJwksProvider`
(implemented by `RsaJwksProvider` in Infrastructure) exposes the signing keys, and
`JwksEndpointExtensions` in the API layer serves `/.well-known/jwks.json` so any extracted service can
fetch the issuer's public keys and validate independently. Under local Aspire the JWKS backchannel is routed
through the gateway; in Azure Container Apps each service points straight at the identity app's
in-cluster address (ADR-004, ADR-012). Validating a user's token never requires services to share a
symmetric secret, which is what makes the fleet safe to grow. The framework's one shared key is opt-in
and separate: an HS256 service token (configuration section `Grpc:ServiceToken`) for calls that carry
no user, which Store enables on its Sales-to-Identity edge and ADC on three edges (the verified-user
lookup, the live-channel push and the ticket-invitation call) (ADR-007).

## Step 6: wire it in the AppHost with MMCA.Common.Aspire.Hosting

Local orchestration is where the topology becomes runnable. `MMCA.Common.Aspire.Hosting` provides
AppHost extension methods for the cross-cutting infrastructure of an extracted deployment: the broker
(RabbitMQ, or the Azure Service Bus emulator, with an `AddSelectedBroker`/`WithSelectedBroker` pair),
JWKS service discovery, the per-service data sources, `WithMmcaServiceInfrastructure` for the chain
every service shares, and the signing key for the opt-in service token. The peer gRPC edge is not one
of them, as the snippet below shows: peers are wired with stock Aspire `WithReference`.

```csharp
// AppHost Program.cs
var broker = builder.AddRabbitMQ("broker");

var engagementService = builder.AddProject<Projects.MMCA_App_Engagement_Service>("engagement")
    .WithBroker(broker);      // .WithReference(broker).WaitFor(broker) + MessageBus__Provider=RabbitMq

var conferenceService = builder.AddProject<Projects.MMCA_App_Conference_Service>("conference")
    .WithBroker(broker);

// gRPC edge: Conference calls Engagement. WithReference injects services__engagement__http__0
// so AddTypedGrpcClient<...>("engagement") can resolve http://engagement at runtime.
conferenceService.WithReference(engagementService);
engagementService.WithReference(conferenceService).WaitFor(conferenceService);
```

`WithBroker` chains `.WithReference(broker).WaitFor(broker).WithEnvironment("MessageBus__Provider",
"RabbitMq")`, so each service waits for RabbitMQ to be healthy and gets the env var that makes
`AddBrokerMessaging()` select the broker transport. `WithReference` on a project resource injects the
`services__{name}__http__0` discovery variables the typed gRPC client uses to resolve `http://{name}`.

One sharp edge worth internalizing: a **bidirectional** gRPC pair (Conference calls Engagement and
Engagement calls Conference) must not have reciprocal `WaitFor` calls, or startup deadlocks (each waits
for the other to be healthy). Declare `WaitFor` in one direction only; the transient "peer not ready"
errors on the other edge self-heal through the resilience pipeline you got for free in step 3 (ADR-007).

## Step 7: route through the YARP gateway

Clients never address a service directly. A single YARP reverse-proxy gateway owns the
route-to-service map and is the only entry point. It has no DbContext and no controllers; it is CORS,
security headers, static files, the route table, and the edge concerns in step 8, among others. You add the service's routes to the
gateway's table and reference it for discovery, and in the local AppHost you wire JWKS discovery so
the new service resolves keys through that same gateway:

```csharp
var gateway = builder.AddProject<Projects.MMCA_App_Gateway>("gateway")
    .WithReference(engagementService)
    .WithReference(conferenceService)
    .WaitFor(engagementService)
    .WaitFor(conferenceService);

engagementService.WithJwksDiscovery(identityService, gateway);  // Profile A form (see below)
```

Centralizing the entry point keeps client config trivial (one URL), centralizes CORS and
auth-forwarding, and lets the internal services run cleartext h2c without exposing that to clients
(ADR-008).

## Step 8: what the edge process itself owns

Step 7 gets a request to the right service. The edge process also has jobs of its own, and they are
jobs no service behind it can do, because only the gateway sees every request exactly once. Three of
them ship in the `Gateway` namespace of `MMCA.Common.Aspire`. A fourth, the forwarded-headers step
that makes the client IP the caller's rather than the ingress's, ships in `MMCA.Common.Gateway`
alongside `AddMmcaGateway`, the shared YARP forwarder profile both gateways chain onto
`AddReverseProxy`. The package placement is a constraint, not a preference: a YARP host has no
controllers, so it references those two framework packages plus `MMCA.Common.Azure.Startup` (Key Vault
configuration and Azure Monitor export only, with no persistence or messaging code, see
[the cloud adapters article](cloud-neutral-vendor-adapters.md)) and nothing else from the framework, and
it cannot reach the service-tier `CorrelationIdMiddleware` or `AddCommonRateLimiting` that live in
`MMCA.Common.API`.

```csharp
// Gateway Program.cs
builder.Services.AddGatewayRateLimiting(builder.Configuration);
builder.Services.AddGatewayDownstreamHealthChecks("identity", "conference", "engagement", "notification");
builder.Services.AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"))
    .AddMmcaGateway(builder.Configuration)      // the shared forwarder profile and per-route policies
    .AddServiceDiscoveryDestinationResolver();
...
app.UseCommonForwardedHeaders();  // so the client IP is the caller's, not the ingress's
app.UseGatewayCorrelation();      // before anything, including a 429, can short-circuit
app.UseCors();
app.UseGatewayRateLimiting();     // after CORS, before the proxy is mapped
app.MapReverseProxy();
```

- **One correlation id for the whole hop, not one per service.** `GatewayCorrelationMiddleware`
  declares the `X-Correlation-ID` constant and, when the caller sent none, mints one from
  `Activity.Current?.TraceId` with `HttpContext.TraceIdentifier` as the fallback. A caller-supplied
  value follows the services' own rule: it is cut to 64 characters, and replaced by a minted id when it
  holds a non-ASCII or control character (Kestrel refuses to echo one). The part that makes
  it *one* id is that the value is written back onto the **request** headers before forwarding, so the
  downstream service's own middleware finds a header already present and adopts it instead of minting
  a second one. The response echo runs from `Response.OnStarting`, so it survives a proxied response
  whose headers the forwarder writes. The middleware's only constructor dependency is the
  `RequestDelegate`: no scoped service, no `HttpContext.Items`, which is what lets it drop into a host
  with no application container.
- **An edge limiter that counts anonymous callers.** `AddGatewayRateLimiting` installs a per-client-IP
  fixed window (120 requests per 60 seconds by default) chained with a process-wide concurrency cap
  (200 in flight), both rejecting with 429. The anonymous posture is the deliberate inverse of the
  service-tier limiter's: ADR-019 exempts anonymous traffic partly because public reads are served
  from the output cache, and that cache lives *behind* the proxy, so a flood is paid for in full at the
  edge before anything can be served cheaply. The two limiters answer different failures: the window
  answers one noisy source, the concurrency cap answers total in-flight work no matter how many sources
  produced it. Three kinds of request take the no-limiter partition on both limiters. `/health`,
  `/alive` and `/.well-known` are always bypassed, because throttling them takes out the probes and
  JWKS discovery as collateral. A host adds its own prefixes through `BypassPathPrefixes`, which is
  how Store exempts its Stripe webhook route and ADC its SignalR hub route. The third is a
  secret-proving header, off until its secret is configured: `SyntheticTrafficSecret`, so a load run
  measures the system rather than the limiter. A second secret-proving header, `TrustedCallerSecret`,
  serves a server-rendered UI host whose every back-end call leaves from one address that the per-IP
  window would otherwise collapse into a single partition. A proven trusted caller skips the
  concurrency cap, and under the default `TrustedCallerMode.PerVisitor` it is counted in the per-IP
  window of the visitor it forwards in `X-Forwarded-For` rather than of its own address;
  `TrustedCallerMode.Exempt` exempts it from both limiters. ADC's gateway names the trusted-caller
  header in configuration, takes the secret itself from Key Vault, and sets no mode, so it runs
  per-visitor. A request with no attributable client IP
  skips the per-IP window (fail-open, chosen over collapsing every unattributable caller into one shared
  bucket) but still counts against the concurrency cap. The settings
  validate on both construction paths, the options pipeline (`ValidateOnStart`) and a
  `Validator.ValidateObject` call at registration, because the limiter closes over an eagerly bound
  copy and a caller can hand it settings without passing through options at all.
- **Readiness that reflects the downstreams, liveness that does not.**
  `AddGatewayDownstreamHealthChecks("identity", "conference", ...)` registers one check per named
  service, each GETting `/alive` through a service-discovery-resolved client under a 2 second budget,
  and tags them `Ready`. The tag is the design: a `Ready` check reaches `/health/ready` and never
  reaches `/alive`, so a downstream outage pulls the gateway out of the load balancer without
  restarting a gateway process that is perfectly healthy.

There is a fourth thing the edge deliberately does **not** do, and the refusal is the decision:
**no JWT pre-validation at the gateway.** ADR-004 puts validation authority in the services, and a
second validator does not add a check, it adds a second truth: two processes reading two JWKS caches
can disagree across a key rotation, and the one that rejects is the one the caller sees. The saving
would be one forward of a request the service was going to reject in microseconds anyway. The trigger
to revisit is measured, not felt: when invalid-token traffic is a material share of forwarded volume,
it becomes a cost argument, and the services keep validating either way (ADR-088).

The route table itself is configuration, not code. What step 7 calls "the gateway's table" is YARP
`ReverseProxy` configuration as the single source, 45 routes in ADC and 18 in Store, pinned in both
repositories by a `RouteMapTests` drift gate that drives each route through the real proxy pipeline
and compares the loaded `IProxyConfig` back against the pinned list in both directions. The
alternative shape, hand-written `MapForwarder` calls, states the same table three times inside one
repository (the registrations, the comment above them, and the list the test pins) with nothing
forcing the three to agree, which is how a live route ends up ungated. The per-destination HTTP
version policy from the next section lives in cluster configuration rather than in positional
arguments at a call site, so a host's transport profile is readable one line under the service it
describes (ADR-089).

## A note you cannot skip: ADR-012's two Kestrel transport profiles

On a cleartext endpoint there is no TLS, so there is no ALPN to negotiate the protocol. Kestrel must be
told up front which protocols the cleartext port speaks, and the choice forces matching gateway-forward
and JWKS-discovery wiring. There are two coherent profiles, and picking the wrong one fails with
`HTTP_1_1_REQUIRED` on gRPC or a JWKS backchannel that cannot reach the auth endpoint.

- **Profile A (serves inbound cleartext gRPC, including any bidirectional pair).** Kestrel is
  `Http2`-only on cleartext (h2c prior knowledge), so peer gRPC clients negotiate without TLS. The
  gateway cluster fronting the host declares `Version` 2 with `VersionPolicy` `RequestVersionExact` in
  its `ReverseProxy` configuration (a policy that allows a lower version would downgrade to HTTP/1.1,
  which the backend rejects), and the container ingress is `transport: http2`. Locally, JWKS uses the
  two-argument `WithJwksDiscovery(identity, gateway)`, because the HTTP/1.1 JwtBearer backchannel
  cannot reach an Http2-only endpoint directly, so it goes through the gateway, which terminates TLS
  and routes `/.well-known/*` on. In Azure Container Apps each service sets the direct in-cluster
  authority `http://<identity app>` instead, and the `http2` ingress carries the metadata fetch. Any service that **serves** gRPC over cleartext needs
  Profile A. ADC uses it.
- **Profile B (`Http1AndHttp2`, no cluster version pair).** Kestrel is `Http1AndHttp2`, so the
  cleartext endpoint speaks HTTP/1.1 (there is no ALPN without TLS), and the gateway cluster declares no
  version pair, so YARP's negotiating default resolves to HTTP/1.1 against it. ADR-012 also describes a
  consumer-only variant that carries gRPC over the HTTPS/ALPN endpoint with the single-argument
  `WithJwksDiscovery(identity)`, and marks both of those halves historical: no deployed host is pure
  Profile B. `Http1AndHttp2` survives only as the default-endpoint half of the mixed-endpoint profile
  below, and every host that serves gRPC does so over cleartext h2c with the gateway-routed JWKS form.

A 2026 update is the cautionary tale here: Store originally chose Profile B because its gRPC edges looked
"consumer-only," but a one-directional topology still has services that **serve** inbound cleartext
gRPC, and Azure Container Apps cleartext ingress cannot deliver HTTP/2 to them under Profile B. The
result was `HTTP_1_1_REQUIRED` 500s in production. Store converged to Profile A. The lesson: if any
service in your fleet hosts an inbound gRPC server over cleartext, you are on Profile A, and you must
flip Kestrel, the gateway cluster's version policy, the ingress transport, and the JWKS form together.

There is a sharper case the two-profile framing does not cover on its own: a host that needs both.
ADC's Notification service serves a SignalR hub (whose WebSocket transport needs the HTTP/1.1 Upgrade
handshake) AND an inbound live-channel gRPC ingress, and Store's Sales service runs the same
mixed-endpoint profile. Neither whole-host profile fits,
because the constraint was only ever per endpoint, not per host. The resolution is a mixed-endpoint
profile that applies both profiles inside one process: the default cleartext endpoint (port 8080) stays
`Http1AndHttp2` (Profile B) so the WebSocket Upgrade still works, and a dedicated `Http2`-only `grpc`
endpoint (port 8081) serves the cleartext h2c gRPC (Profile A) for
`LiveChannelPushService.PushToChannel`, mapped as `LiveChannelGrpcService`. Peers resolve that ingress
through its named endpoint scheme `http://_grpc.notification`, not the default port, and in Azure
Container Apps it rides a dedicated internal TCP port mapping so one app can serve HTTP/1.1 WebSockets
and end-to-end HTTP/2 without hitting envoy's single-transport limit. The takeaway generalizes: when one
host must speak WebSockets and serve inbound cleartext gRPC, split the two protocols across two Kestrel
endpoints instead of forcing one whole-host profile (ADR-012's mixed-endpoint amendment).

## The whole point: it stays reversible

Walk the steps back and you see why this is not a one-way door. Because transport lives at the edge and
the core talks to abstractions, a service can be re-collapsed into a combined host by changing
configuration, not code. Enable the peer module in the same host, drop the `services.Replace(...)` that
swapped in the gRPC adapter, and the in-process implementation resolves again. Set `MessageBus:Provider`
back to `InProcess` and `InProcessMessageBus` dispatches events in-process. The `ModuleLoader` boots the same module
code either way. That reversibility is insurance: a small team can adopt microservices without betting
that the split was correct on the first try.

## Trade-offs, honestly

- **Operational complexity multiplies.** You now run multiple deployables plus a gateway, service
  discovery, a broker, and per-service databases instead of one process. Aspire hides a lot of this
  locally; production needs the matching Bicep and ingress configuration.
- **Distributed-systems semantics are now yours.** Cross-service consistency is eventual (outbox plus
  integration events). There are no cross-service transactions and no cross-database foreign keys.
  Broker delivery is at-least-once, so redeliveries must be deduplicated. The framework inbox does that
  for every consumer and is on by default under any broker (ADR-021), at the price of an
  `InboxMessages` table in each service database.
- **The transport profile leaks into hosting.** ADR-012 is not optional reading. The Kestrel protocol
  choice, the gateway-forward mode, the ingress transport, and the JWKS form are a coupled set, and a
  half-configured set fails in ways that only show up in the cloud, not locally.
- **Bidirectional pairs need deliberate startup handling.** The no-`WaitFor`-on-the-reverse-edge trick
  is necessary, and it relies on the resilience pipeline to absorb the transient startup errors. It
  works, but it is a thing you must know rather than discover.
- **The edge limiter's number is per replica, and changing it is a restart.** Both edge limiters count
  in one process's memory, so the fleet ceiling is the configured value multiplied by the replica
  count, which rises exactly when the load that motivated the limit arrives. And because the limiter
  closes over an eagerly bound copy of its settings rather than resolving options per request, no
  reload reaches it: calling the limit "a configuration section" invites the assumption that it can be
  changed live, and it cannot (ADR-088).

None of these are reasons to keep everything in one process forever. They are the reasons to keep the
split reversible, so you only pay the complexity for the modules that actually need it.

## Apply this even without MMCA

The recipe ports to any stack:

1. **Make the core talk to abstractions and put a fitness test on it.** A message-bus interface and
   plain service interfaces, with an architecture test that forbids transport types in your domain and
   application layers, so the property cannot rot.
2. **Keep the wire contract in a shared package** that generates both server and client stubs, and ship
   an adapter that implements the same interface the in-process code already used. Extraction becomes a
   registration swap.
3. **Federate user auth with JWKS,** not a shared secret, so adding a service does not mean distributing a
   symmetric key. If services must also call each other with no user present, keep that shared key
   opt-in, scoped to the edges that need it, and separate from user-token validation.
4. **Front the services with a single gateway** so clients see one URL and internal transport choices
   stay internal.
5. **Treat the Kestrel/gateway/ingress/JWKS transport choice as one coupled decision,** and write down
   which profile you are on. The half-configured states fail in production, not in development.

The takeaway: the monolith-to-microservices split is a rewrite only if you let transport leak into your
business logic. Hold the abstraction boundary from day one, enforce it with a test, and the split
becomes a wiring change you can undo.

---

**What we covered:** the starting invariant (core talks to abstractions, enforced by
`MicroserviceExtractionTests`), defining a `.Contracts` project with auto-compiled protos and a
same-interface gRPC adapter, server-side `AddGrpcServiceDefaults()` with `Result`-over-the-wire,
client-side `AddTypedGrpcClient<T>(serviceName)` with JWT forwarding and Polly over h2c, flipping
`IMessageBus` to `BrokerMessageBus` via settings, JWKS so the new service validates tokens, AppHost
wiring through `MMCA.Common.Aspire.Hosting`, routing through the YARP gateway, the edge
responsibilities the gateway process owns (forwarded headers, ensured correlation, an
anonymous-counting rate limiter, downstream-aware readiness) plus the JWT pre-validation it declines
and the route table it keeps in configuration, ADR-012's two Kestrel transport profiles, and why the
whole thing stays reversible.

**Next in the series:** resilience handlers and recovery objectives, the retry pipeline behind these
calls plus the RTO/RPO targets and the drilled restore behind them.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read ADRs 007, 008, 012, 088, and 089
behind this walkthrough, or `dotnet add package MMCA.Common.Grpc` and try it.*
- ⭐ Repo: https://github.com/ivanball/MMCA.Common
- 📚 Full series index: https://ivanball.github.io/writing.html
- 📄 ADR-007 (gRPC extraction), ADR-008 (service-extraction topology), ADR-012 (gRPC-host transport),
  ADR-088 (gateway edge responsibilities), ADR-089 (gateway topology owned by configuration) in
  the repo.

*Tags: .NET, C Sharp, Microservices, gRPC, Software Architecture*

*Notes: 2026-11-25 pass, re-verified 2026-11-25 against MMCA.Common v1.319.0
(`MMCA.Common/FACTS.md:14`). Audit input: this run's findings file for Article 32 (9 drifted or
unverifiable claims, 28 confirmed). Body corrections, each re-read this pass: (1) Step 0: application
code publishes through `IEventBus`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventBus.cs:13`); `IMessageBus`
is the transport `OutboxProcessor` drains through
(`MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:5-10`, interface `:29`).
(2) The forbidden core-layer transport list is `MassTransit`, `RabbitMQ.Client`,
`Azure.Messaging.ServiceBus`, `Amazon.SQS`, `Amazon.SimpleNotificationService`, `Grpc` and
`Google.Protobuf`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:14-23`;
MassTransit "banned outright, ADR-118" at `:6-8`; the failure message names `IEventBus` at `:37-39`;
the `MicroserviceExtractionTests` name per `MMCA.Common/AGENTS.md`, "Microservices Extraction
Boundaries"). (3) `BrokerMessageBus` publishes through the selected transport's `IBrokerPublisher`,
RabbitMQ and PostgreSQL built in and an adapter such as MMCA.Common.Azure or MMCA.Common.Aws
registering its own
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:13-18`, ctor
`:46-51`); `IntegrationEventConsumer<TEvent>` at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:40`;
`WithBroker` injects `MessageBus__Provider=RabbitMq` at
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:321` (the Service Bus emulator
overload sets `AzureServiceBus` at `:350`). (4) Service token: ADC opts in on three edges,
`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Contracts/DependencyInjection.cs:74` (verified-user
lookup), `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/DependencyInjection.cs:51`
(live-channel push) and `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:110`
(ticket invitation), with the signing key shared at
`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:244-247`; ADR-007's 2026-11-23 revision at
`Website/docs-src/adr/007-grpc-extraction.md:15-17`; Store's Sales-to-Identity edge
(`MMCA.Store/Source/Services/MMCA.Store.Identity.Contracts/DependencyInjection.cs:46`) and HS256 with
section `Grpc:ServiceToken` (`ServiceTokenSettings.cs:13`, `:21`) per this run's audit. (5)
`MMCA.Common.Aspire.Hosting` surface, re-read: `AddMessageBroker` `Extensions.cs:220`,
`AddServiceBusEmulatorBroker` `:261`, `WithBroker` `:312` and `:341`, `WithJwksDiscovery` `:370`,
data sources `:587`/`:617`/`:646`/`:671`; `AddSelectedBroker` and `WithSelectedBroker`
(`BrokerSelection.cs:58`, `:82`); `WithMmcaServiceInfrastructure`
(`ServiceInfrastructureExtensions.cs:57`, used by ADC's AppHost at `Program.cs:137`, `:159`, `:197`,
`:222`); `AddServiceTokenSigningKey` and `WithServiceTokenSigningKey` (`ServiceTokenExtensions.cs:46`,
`:67`); no method wires a peer gRPC edge, and ADC wires its peers with stock `WithReference`
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:269`, `:276`). (6) Both gateways reference
`MMCA.Common.Aspire`, `MMCA.Common.Azure.Startup` and `MMCA.Common.Gateway`
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/MMCA.ADC.Gateway.csproj:3-7`, the "does not reference
MMCA.Common.Azure" comment at `:4-5`; `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/MMCA.Store.Gateway.csproj:27-29`,
comment `:16-17`); ADC calls `AddAzureKeyVaultConfiguration` and `AddAzureMonitorExporter` at
`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:75`, `:82`; that `MMCA.Common.Azure.Startup`
references only `MMCA.Common.Aspire` (`MMCA.Common.Azure.Startup.csproj:33`) is per this run's audit.
(7) Three kinds of request skip both limiters, and a trusted caller skips only the concurrency cap and
is counted per visitor by default
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:33-43`);
`TrustedCallerMode.PerVisitor` `TrustedCallerMode.cs:17`, `Exempt` `:23`, default at
`GatewayRateLimitingSettings.cs:166` (documented `:160-163`); ADC's gateway configuration names the
header and the Key Vault secret and sets no mode
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:25-32`). (8) Route counts 45 and 18,
counted as `"ClusterId"` lines in `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json` (`Routes`
opens `:80`) and `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json` (`Routes` opens `:52`);
ADR-089's 2026-11-23 recount at `Website/docs-src/adr/089-gateway-topology-owned-by-configuration.md:28-29`.
(9) Trade-offs: the inbox resolves on for any broker transport
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:142`, override
`EnableInbox` `:134`, the `InboxMessages` opt-out note `:128-131`). Header: ADR-021 and ADR-118 added
for (2), (3) and (9). Re-read and unchanged: `MessageBusSettings.cs` section `:16`, string `Provider`
defaulting to `MessageBusProviders.InProcess` `:25`, `EnableOutbox` `:172`, `IsOutboxEnabled` `:180`;
`AddEngagementBookmarkCountClient`
`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:46`, typed client
`:48`, `services.Replace` `:52`, called at
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:359`; ADC gateway ordering
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs`) `AddGatewayRateLimiting` `:89`,
`AddGatewayDownstreamHealthChecks` `:105`, `AddCommonSecurityHeaders` `:135`, `AddReverseProxy` `:171`,
`UseCommonForwardedHeaders` `:183`, `UseGatewayCorrelation` `:188`, `UseCommonSecurityHeaders` `:193`,
`UseCors` `:196`, `UseGatewayRateLimiting` `:203`, `MapReverseProxy` `:236`; bypass lists `"/hubs"`
(ADC `appsettings.json:25`) and `"/Payments"` (Store `appsettings.json:20`); ADC Notification maps
`LiveChannelGrpcService` with `RequireAuthorization(ServiceTokenDefaults.ServiceCallerPolicy)` and the
export service with `RequireAuthorization()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:160`, `:168`). Per this run's
audit, not reopened: `HttpResilienceDefaults.cs` gRPC and HTTP values at `:15`/`:18`/`:21`/`:32`/`:72`/`:75`/`:81`/`:87`/`:93`;
ADC Bicep in-cluster identity authority `MMCA.ADC/infra/main.bicep:2672`, `:2816`, `:2986`; the
gateway-kit, health-check, correlation, `ResultGrpcExtensions`, `ModuleLoader`, `ErrorHttpMapping`
and ADR-012 Profile anchors of earlier passes (values confirmed, lines not re-pinned). The
Notification `Program.cs` no longer carries the `ConfigureEndpointsWithHealthProbe` and
`AddGrpcServiceDefaults` calls an earlier pass anchored there; the mixed-endpoint prose rests on ADR-012
and this run's audit. The Program.cs, .proto and adapter code blocks are illustrative composites in a
generic "MMCA.App" namespace; `AddEngagementBookmarkCountClient` is the real ADC helper with its body
abridged. Not settled: the ADR-004 attribution (validation authority in the services) is read only as
ADR-088 states it. Earlier passes: 2026-07-27, 2026-09-19, 2026-10-02 (v1.221.0), 2026-10-08
(v1.233.0), 2026-10-22 (v1.250.0) and 2026-10-29; their line anchors are superseded by this pass.*
