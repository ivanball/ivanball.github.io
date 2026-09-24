# Extracting a module to a gRPC service, live

> Series: MMCA.Common · Article #32 (tutorial) · Pillar P3/P5 · Groups G13,G14 · Rubric §7,§9 ·
> ADR-007, ADR-008, ADR-012, ADR-088, ADR-089 · Status: grounded in `Website/docs-src/adr/007-grpc-extraction.md`,
> `Website/docs-src/adr/008-service-extraction-topology.md`, `Website/docs-src/adr/012-grpc-host-transport.md`,
> `Website/docs-src/adr/088-gateway-edge-responsibilities.md`,
> `Website/docs-src/adr/089-gateway-topology-owned-by-configuration.md`, `MMCA.Common/CLAUDE.md`
> (the microservices extraction section), and `Website/docs-src/onboarding/group-13-grpc-contracts.md`. No em dashes.

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

- Asynchronous, fire-and-forget flows go through `IMessageBus`, defined in
  `MMCA.Common.Application`. The application never references the broker library.
- Synchronous cross-module calls go through a plain C# interface (for example
  `IBookmarkCountService`), resolved from DI. The caller does not know whether the implementation is an
  in-process object or something else.

This invariant is not a hope. It is enforced. `MicroserviceExtractionTests` in the architecture suite
fail the build if `MassTransit`, gRPC, or Protobuf types appear in any Domain, Application, or Shared
assembly. So you cannot accidentally couple the core to a transport during normal development, which
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
REST side (the unhandled-failure filter reads the same one). The trailers carry every error as
structured metadata. The client adapter reads those trailers back and reconstructs
`Result.Failure(errors)`. One error model, two transports, written once in the interceptor.

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
  distributed authorization works without each handler threading a token (it is a no-op outside an HTTP
  request, for example in a background processor).
- `AddStandardResilienceHandler()` gives every gRPC client the same Polly retry, timeout, and
  circuit-breaker pipeline as the HTTP clients. A deliberate `SocketsHttpHandler` override forces
  explicit HTTP/2 so the resilience handler cannot defeat the h2c negotiation.

The `services.Replace(...)` is deliberate and uses `Replace`, not `TryAdd`. By the time this runs (after
`ModuleLoader`), the container already holds either the real in-process `IBookmarkCountService` (if
Engagement is enabled in this host) or a `Disabled*` stub (registered by the module's
`RegisterDisabledStubs()` when the peer is disabled). `Replace` wins over both, so after the call the
resolved interface is always the gRPC adapter pointing at the extracted peer. That is why the call comes
after module discovery.

## Step 4: flip the message bus from in-process to broker

Synchronous calls now cross the wire. The asynchronous, fire-and-forget flows (domain and integration
events) need the same treatment, and the framework makes it a configuration switch rather than a code
change.

`IMessageBus` has two implementations in Infrastructure: `InProcessMessageBus` (in-monolith, delivery is
a method call) and `BrokerMessageBus` (a MassTransit broker, RabbitMQ locally and Azure Service Bus in
production, with an `IntegrationEventConsumer`).
`MessageBusSettings` selects the mode. In the monolith you ran in-process; in the extracted service you
flip the setting to the broker.

```csharp
// Program.cs: the broker registration is conditional on settings, not hard-coded.
builder.Services.AddBrokerMessaging(builder.Configuration);
// MessageBus__Provider=RabbitMq (injected by the AppHost's WithBroker) selects BrokerMessageBus.
```

Your aggregate code, which does `AddDomainEvent(new BookmarkAdded(...))`, does not change. The
transactional outbox is what makes the switch safe: the same durable outbox row is drained to an
in-process handler today and published to the broker tomorrow. The reliability pattern and the
extraction boundary are the same mechanism (ADR-003).

## Step 5: JWKS so the new service validates tokens

The extracted Engagement service now receives forwarded JWTs from Conference and must validate them. It
does so against the issuer's **JWKS**, the public signing keys, not a shared secret. `IJwksProvider`
(implemented by `RsaJwksProvider` in Infrastructure) exposes the signing keys, and
`JwksEndpointExtensions` in the API layer serves `/.well-known/jwks.json` so any extracted service can
fetch the issuer's public keys and validate independently. JWKS discovery is routed through the gateway
(ADR-004). No service ever needs to share a symmetric secret with another, which is what makes the fleet
safe to grow.

## Step 6: wire it in the AppHost with MMCA.Common.Aspire.Hosting

Local orchestration is where the topology becomes runnable. `MMCA.Common.Aspire.Hosting` provides
AppHost extension methods for the cross-cutting infrastructure of an extracted deployment: the RabbitMQ
broker, JWKS service discovery, and the per-service data sources. The gRPC edge is not one of them, as
the snippet below shows: peers are wired with stock Aspire `WithReference`.

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
static files, the route table, and the edge concerns in step 8. You add the service's routes to the
gateway's table and reference it for discovery, and you wire JWKS discovery so the new service
resolves keys through that same gateway:

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
controllers, so it references those two framework packages and nothing else from the framework, and
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
  `Activity.Current?.TraceId` with `HttpContext.TraceIdentifier` as the fallback. The part that makes
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
  produced it. Four kinds of request take the no-limiter partition on both limiters. `/health`,
  `/alive` and `/.well-known` are always bypassed, because throttling them takes out the probes and
  JWKS discovery as collateral. A host adds its own prefixes through `BypassPathPrefixes`, which is
  how Store exempts its Stripe webhook route and ADC its SignalR hub route. The other two are
  secret-proving headers, each off until its secret is configured: `SyntheticTrafficSecret`, so a
  load run measures the system rather than the limiter, and `TrustedCallerSecret`, for a
  server-rendered UI host whose every back-end call leaves from one address that the per-IP window
  would otherwise collapse into a single partition. ADC's gateway names the trusted-caller header in
  configuration and takes the secret itself from Key Vault. A request with no attributable client IP
  is not limited at all: that is
  fail-open, chosen over collapsing every unattributable caller into one shared bucket. The settings
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
`ReverseProxy` configuration as the single source, 33 routes in ADC and 15 in Store, pinned in both
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
  gateway must forward HTTP/2 (`ForwardHttp2=true`, and `transport: http2` on the container ingress).
  JWKS uses the two-argument `WithJwksDiscovery(identity, gateway)`, because the HTTP/1.1 JwtBearer
  backchannel cannot reach an Http2-only endpoint directly, so it goes through the gateway, which
  terminates TLS and routes `/.well-known/*` on. Any service that **serves** gRPC over cleartext needs
  Profile A. ADC uses it.
- **Profile B (consumer-only, one-directional gRPC, gRPC rides the HTTPS/ALPN endpoint).** Kestrel is
  `Http1AndHttp2`; gRPC clients use the HTTPS endpoint where ALPN negotiates HTTP/2. The gateway forwards
  HTTP/1.1 (`ForwardHttp2=false`), and JWKS uses the single-argument `WithJwksDiscovery(identity)`.

A 2026 update is the cautionary tale here: Store originally chose Profile B because its gRPC edges looked
"consumer-only," but a one-directional topology still has services that **serve** inbound cleartext
gRPC, and Azure Container Apps cleartext ingress cannot deliver HTTP/2 to them under Profile B. The
result was `HTTP_1_1_REQUIRED` 500s in production. Store converged to Profile A. The lesson: if any
service in your fleet hosts an inbound gRPC server over cleartext, you are on Profile A, and you must
flip Kestrel, `ForwardHttp2`, the ingress transport, and the JWKS form together.

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
swapped in the gRPC adapter, and the in-process implementation resolves again. Flip `MessageBusSettings`
back to `InProcessMessageBus` and events dispatch in-process. The `ModuleLoader` boots the same module
code either way. That reversibility is insurance: a small team can adopt microservices without betting
that the split was correct on the first try.

## Trade-offs, honestly

- **Operational complexity multiplies.** You now run multiple deployables plus a gateway, service
  discovery, a broker, and per-service databases instead of one process. Aspire hides a lot of this
  locally; production needs the matching Bicep and ingress configuration.
- **Distributed-systems semantics are now yours.** Cross-service consistency is eventual (outbox plus
  integration events). There are no cross-service transactions and no cross-database foreign keys.
  Consumers must be idempotent because broker delivery is at-least-once.
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
3. **Federate auth with JWKS,** not a shared secret, so adding a service does not mean distributing a
   symmetric key.
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

*Notes: 2026-07-27 correction: Step 6 previously said `MMCA.Common.Aspire.Hosting` provides "gRPC
project references". It does not. The package ships four source files (`Extensions.cs`,
`H2cHealthCheckExtensions.cs`, `H2cEndpointHealthCheck.cs` and `ServiceBusEmulatorResource.cs`) and
no gRPC API at all: in `Extensions.cs` the AppHost surface is `AddMessageBroker`, `WithBroker` (plus
a second overload taking the Service Bus emulator resource), `WithJwksDiscovery`, `WithE2eRsaKeys`,
`WithE2eRegistrationThrottleLift` and `With{SQLServer,Cosmos,Sqlite}DataSource`
(`:483`/`:542`/`:567`), and the single `gRPC` occurrence in the file is a comment at `:322`
explaining why the JwtBearer backchannel is routed through the gateway. The step's own code sample
already showed the truth: gRPC peers are wired with stock Aspire `WithReference`, exactly as ADC's
real AppHost does (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs`:
`engagementService.WithReference(conferenceService).WaitFor(conferenceService)` at `:271`, the
deliberate no-`WaitFor` deadlock rationale at `:261` and `:273`, and the reverse edge
`conferenceService.WithReference(engagementService)` at `:274`). Verified type/behavior names and
conventions: `IMessageBus`/`InProcessMessageBus`/
`BrokerMessageBus`/`MessageBusSettings`, `MicroserviceExtractionTests` (forbids MassTransit/gRPC/Protobuf
in Domain/Application/Shared), `*.Contracts` auto-compile of `Protos/**/*.proto` with
`GrpcServices="Both"`, the same-interface gRPC adapter (`*GrpcAdapter`), `AddGrpcServiceDefaults()`,
`GrpcResultExceptionInterceptor`, `ResultFailureException`, `result.ThrowIfFailure()`,
`errors.ToRpcException()`, `FrozenDictionary<ErrorType, StatusCode>`, `AddTypedGrpcClient<TClient>
(serviceName)`, `JwtForwardingClientInterceptor`, `AddStandardResilienceHandler`, `SocketsHttpHandler`
h2c override, `services.Replace(...)` over `Disabled*` stubs after `ModuleLoader`, `AddBrokerMessaging`,
`IJwksProvider`/`RsaJwksProvider`/`JwksEndpointExtensions` and `/.well-known/jwks.json`, AppHost
`WithBroker`/`WithReference`/`WaitFor`/`WithJwksDiscovery`, ADR-012 Profile A/B (Store converged to
Profile A in commit 49b7283). Two hosts run the ADR-012 mixed-endpoint profile and both were read
this run: ADC's Notification service
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:9-19`, default `http`
endpoint `http://*:8080` `Http1AndHttp2` for the SignalR WebSocket Upgrade plus a named `grpc`
endpoint `http://*:8081` `Http2` for the live-channel gRPC ingress
`LiveChannelPushService.PushToChannel`, resolved by peers via `http://_grpc.notification`; host
wiring at `.../Notification.Service/Program.cs:74`
(`ConfigureEndpointsWithHealthProbe(HttpProtocols.Http1AndHttp2, redeclareCleartextEndpoint: false)`,
rationale comment at `:73`), `:244` (`AddGrpcServiceDefaults()`) and `:290`
(`MapGrpcService<LiveChannelGrpcService>().AllowAnonymous()`; the data-subject-export
`UserNotificationExportGrpcService` is mapped at `:298`)), and Store's Sales service, whose Kestrel
section carries the identical pair
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:10-19`). The Program.cs,
.proto, and adapter code blocks are illustrative composites of the documented conventions using a
generic "MMCA.App" namespace, not verbatim copies of ADC/Store source; <verify> exact signatures and
the `.Contracts` DI helper names against your own extracted module before publishing. Step 8 (the
edge process's own responsibilities) folds in ADR-088 and ADR-089, read at
`Website/docs-src/adr/088-gateway-edge-responsibilities.md` and
`Website/docs-src/adr/089-gateway-topology-owned-by-configuration.md`. Edge kit verified against
source this run, all under `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/`:
`GatewayCorrelationMiddleware` declares `HeaderName = "X-Correlation-ID"`
(`GatewayCorrelationMiddleware.cs:34`), mints from `Activity.Current?.TraceId` falling back to
`context.TraceIdentifier` (`:53`) and writes it onto the REQUEST headers, echoes via
`Response.OnStarting` (`:58`), takes only `RequestDelegate` (`:27`) and registers through
`UseGatewayCorrelation()` (`:82`); `AddGatewayRateLimiting` binds with `ValidateOnStart()`
(`GatewayRateLimitingExtensions.cs:258`) and the object overload runs
`Validator.ValidateObject(..., validateAllProperties: true)` at registration (`:279`), partitions on
`Connection.RemoteIpAddress` (`:197`) with `RateLimitPartition.GetNoLimiter` for an unresolvable IP
(`:202`), a fixed window at `:205`, a process-wide `GetConcurrencyLimiter` at `:232`, chained via
`PartitionedRateLimiter.CreateChained` (`:288`) and rejecting with
`StatusCodes.Status429TooManyRequests` (`:283`); the always-bypassed prefixes `["/health", "/alive",
"/.well-known"]` are declared at `:59` and matched by whole path segment at `:76`. Four kinds of
request take the no-limiter partition on BOTH limiters, documented at `:28-37`: an always-bypassed
prefix, a host-configured prefix, a synthetic-traffic request proving `SyntheticTrafficSecret`
(`GatewayRateLimitingSettings.cs:115`, header name at `:91`) and a trusted internal caller proving
`TrustedCallerSecret` (`:151`, header name at `:123`), the last two inert until their secret is set.
ADC's gateway names the trusted-caller header in configuration and takes the secret from Key Vault
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:26-32`). Limiter defaults: `PermitLimit`
120 (`GatewayRateLimitingSettings.cs:59`), `WindowSeconds` 60 (`:63`), `GlobalConcurrencyLimit` 200
(`:73`), `BypassPathPrefixes` empty (`:82`), section name `"GatewayRateLimiting"` (`:50`).
`AddGatewayDownstreamHealthChecks(params string[] serviceNames)`
(`GatewayHealthCheckExtensions.cs:130`, with an options overload at `:148`) sets
`BaseAddress = http://{name}` (`:194`) with `ProbeTimeout` = 2 seconds (`:84`, applied at `:195` and
`:212`), `failureStatus: HealthStatus.Unhealthy` (`:210`) and `tags: [HealthCheckTags.Ready]`
(`:211`), probing `/alive` rather than `/health/ready` on purpose
(`DownstreamServiceHealthCheck.cs:17`). Consumer wiring read this run: both gateway hosts reference
two framework packages, `MMCA.Common.Aspire` and `MMCA.Common.Gateway`
(`MMCA.ADC.Gateway.csproj:3-4`, `MMCA.Store.Gateway.csproj:25-26`), and both run the same ordering.
ADC (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs`): `AddReverseProxy().LoadFromConfig(...)`
plus `.AddMmcaGateway(...)` and `.AddServiceDiscoveryDestinationResolver()` at `:146-149`,
`app.UseCommonForwardedHeaders()` at `:158`, `UseGatewayCorrelation()` at `:163`,
`UseCommonSecurityHeaders()` at `:168`, `MapDefaultEndpoints()` at `:170`, `UseCors()` at `:171` and
`UseGatewayRateLimiting()` at `:178`. Store
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs`): `UseCommonForwardedHeaders()` at `:150`,
with the comment at `:146-149` pointing at `MMCA.Common.Gateway.ForwardedHeadersExtensions`, and
`UseGatewayCorrelation()` at `:155`. The helper itself is
`ForwardedHeadersExtensions.UseCommonForwardedHeaders()`
(`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/ForwardedHeadersExtensions.cs:36`, delegating to
`UseForwardedHeaders(CreateForwardedHeadersOptions())` at `:40`), which is why neither gateway calls
`UseForwardedHeaders` directly and why both attribute the per-client-IP partition to the real caller
rather than to the ingress in front of them. Bypass lists are `"/hubs"` for ADC
(`MMCA.ADC.Gateway/appsettings.json:25`) and `"/Payments"` for Store
(`MMCA.Store.Gateway/appsettings.json:20`). Route table from configuration, counted this run by
`ClusterId` entries: 33 routes in ADC (`MMCA.ADC.Gateway/appsettings.json`, `Routes` section opening
at `:80`) and 15 in Store (`MMCA.Store.Gateway/appsettings.json:47`); ADR-089 records the same pair
with its cluster split at
`Website/docs-src/adr/089-gateway-topology-owned-by-configuration.md:92-96`. The hand-written
alternative it rejects (26 ADC / 10 Store `MapForwarder` calls, and a three-way ADC disagreement of
15 registered vs a comment saying 16 vs a test pinning 23 of 26) is that ADR's Context. The drift
gates are `MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/RouteMapTests.cs` (the pinned `RouteMap`
`TheoryData` at `:131`, driven behaviorally from `:179`, `IProxyConfig` completeness read at `:221`
and `:239`) and `MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/RouteMapTests.cs` (class at `:46`,
`RoutePatterns` at `:102`, `RouteMap` at `:126`, `IProxyConfig` read at `:229` and `:246`); both
compare the loaded `IProxyConfig` against the pinned table in BOTH directions, with Store's rationale
spelled out at `:31-35`. The step 8 `Program.cs` snippet is an illustrative composite of ADC's real
gateway ordering, not a verbatim copy. The declined edge JWT pre-validation and its measured revisit
trigger are ADR-088's "What the edge declines"; the per-replica and closed-over-settings trade-offs
are its Trade-offs section. Step 2's HTTP status table is
`FrozenDictionary<ErrorType, int> ErrorTypeToStatusCode` on the internal `ErrorHttpMapping`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:14`, table at
`:20`), centralized so `ApiControllerBase` (`Controllers/ApiControllerBase.cs:48` for
`GetStatusCode`, `:58` for `BuildErrorsExtension`) and `UnhandledResultFailureFilter` share one copy.
2026-09-19 pass, six substantive corrections re-read against source: the route pair moved from 26/10
to 33/15; the `IProxyConfig` both-directions comparison is no longer ADC-only, Store's gate does it
too; a gateway host references `MMCA.Common.Gateway` as well as `MMCA.Common.Aspire`, so the edge
snippet calls `UseCommonForwardedHeaders()` and step 8 names a fourth framework-owned edge
responsibility; the limiter's bypasses are four kinds, not two tiers; Store's Sales service is a
second mixed-endpoint host next to ADC's Notification service; and the previous pass's claim that
Store's gateway has no forwarded-headers step at all, together with the per-client-IP misattribution
finding built on it, is void. Not settled this run: the ADR-003 (outbox as the extraction mechanism),
ADR-004 (validation authority in the services) and ADR-019 (anonymous exemption) attributions were
not re-read against the ADR texts, and the ADR-019 contrast is corroborated only indirectly, by the
framework docstring at `GatewayRateLimitingExtensions.cs:17-21`.*
