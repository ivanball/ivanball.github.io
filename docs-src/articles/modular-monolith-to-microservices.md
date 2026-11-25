# Modular monolith to microservices, without the rewrite

> Series: MMCA.Common · Article #2 (cornerstone thesis) · Pillar P1/P3 · Groups G07,G13,G14 ·
> Rubric §7 · ADRs 006/007/008/118 · Status: grounded in `MMCA.Common/AGENTS.md` (its "Microservices
> Extraction Boundaries" section), `Website/docs-src/adr/006-database-per-service.md`, `Website/docs-src/adr/007-grpc-extraction.md`,
> `Website/docs-src/adr/008-service-extraction-topology.md`, and `Website/docs-src/onboarding/group-14-module-system-composition.md`
> + `group-13-grpc-contracts.md`, with source re-read 2026-11-25 at v1.319.0 (`MessageBusSettings.cs`,
> `IMessageBus.cs`, `BrokerMessageBus.cs`, `ArchitectureRules.Transport.cs`, `ResultGrpcExtensions.cs`,
> ADC `main.bicep`, Engagement.Contracts `DependencyInjection.cs`, Conference.Service
> `Program.cs`). No em dashes.

**Subtitle:** "Monolith or microservices" is the wrong question. Build the extraction point now, keep it tested,
and cut the service later, on a boundary you have already proven.

---

There is a decision a lot of teams make far too early, and then spend two years paying for.

Day one, someone asks "monolith or microservices?" and the room splits. One camp wants a single
deployable so they can ship. The other wants service boundaries so they never have to do the
"big migration" later. Both are right, and the argument is a false binary. The thing that actually
hurts is not which one you pick. It is that whichever you pick, the boundary you draw on a whiteboard
in week one is almost never the boundary the system needs in year two. A premature service split
calcifies the wrong join point in a network you cannot refactor across. A monolith with no internal
boundaries calcifies no join point at all, and the eventual extraction is a rewrite.

MMCA.Common takes a third position. Build the boundary now, inside one deployable, and make it
**real and tested** rather than aspirational. The day a module genuinely needs to be its own service,
extraction is a hosting and configuration change, not a rewrite of business logic.

## Why it matters

The reason the "we will split it later" plan usually fails is that the monolith quietly grows
couplings that the eventual split has to unwind. Two modules share a database, so a foreign key
spans them. One module calls another's class directly, so the call assumes in-process semantics
(synchronous, transactional, never fails for network reasons). Events are dispatched by a direct
method call, so nobody ever wrote the durable handoff a broker needs. None of these are visible in a
demo. All of them are load-bearing the day you try to pull a module out, and that is exactly when you
discover the boundary was a fiction.

So the boundary has to be enforced while it is cheap to enforce: while everything still runs in one
process and a violation is a one-line fix instead of a distributed-systems incident. That is the
whole design center of this framework. The invariant, stated once: **application and domain code talks
to abstractions; transport choices live at the edges.**

## The MMCA answer: four extraction points, all enforced in the monolith

There are four places a "split it later" plan leaks, and the framework closes each one with a real
mechanism, not a guideline.

### 1. Database-per-service, even inside the monolith (ADR-006)

The first leak is the shared database. In MMCA.Common, every entity resolves to a physical data
source: a `DataSourceKey(Engine, Name)` pair. `DataSourceResolver` maps logical names (a module's name)
onto physical connection strings, and `EntityDataSourceRegistry` maps every entity to its source at
startup. The clever part is collapse: a host with no `DataSources` configuration collapses every
logical name onto a single `Default` source, so it behaves **exactly** like a single-database
monolith (one context, one change tracker, foreign keys intact). Point one config entry at a separate
database and that module's data is physically isolated, with no code change. This is the deep-dive
of its own article; the point here is that the data boundary exists from day one and costs nothing
until you use it.

### 2. A transport-agnostic message bus

The second leak is event delivery. Application code publishes an integration event through
`IEventBus` and never touches the transport. Beneath it sits one transport abstraction, `IMessageBus`,
defined in the Application layer, with two implementations in Infrastructure: `InProcessMessageBus`
(delivery is a method call, used in the monolith) and `BrokerMessageBus` (delivery goes through the
selected broker transport's `IBrokerPublisher`, used once a module is its own service). The broker
transports are framework code, not a third-party bus library. `MessageBusSettings.Provider`, a plain
string, selects the mode: `InProcess`, `RabbitMq` and `PostgreSql` are built in, and any other value
names a broker transport an adapter package registers (`AzureServiceBus` from `MMCA.Common.Azure`,
`AmazonSqs` from `MMCA.Common.Aws`; the adapter pattern has [its own article](cloud-neutral-vendor-adapters.md)).
ADC runs RabbitMQ locally and Azure Service Bus in production. Your handler code does not change when
you flip it.

The rule that keeps this honest is that **Application, Domain, and Shared never reference a broker
client or the gRPC runtime directly.** That is not a code-review comment. It is a fitness test,
`MicroserviceExtractionTests`, that fails the build if a transport type (RabbitMQ, Azure Service Bus,
Amazon SQS or SNS, gRPC, protobuf, or the banned MassTransit) leaks into the core. The transactional
outbox (its own article in this series) is what makes the flip safe. Under a broker it is always on:
each integration event is written in the same transaction as the aggregate change and drained to the
broker. A monolith on `InProcess` dispatches synchronously by default and gets the same durable
record, and at-least-once delivery across a crash, by setting `MessageBus:EnableOutbox=true`.

### 3. gRPC contracts for synchronous calls (ADR-007)

The third leak is the synchronous call between modules: "how many bookmarks does this session have?"
needs an answer, not a fire-and-forget event. In the monolith that is a direct interface call. Across
a process boundary it is gRPC, exposed through `MMCA.Common.Grpc`.

The convention is what makes extraction a registration change. Any project whose name ends in
`.Contracts` auto-compiles its `Protos/**/*.proto` with both server and client stubs. Each
`.Contracts` project ships a hand-written adapter that implements **the same C# interface the modules
already used in-process.** Concretely, a `BookmarkCountServiceGrpcAdapter` implements
`IBookmarkCountService`, holds a generated gRPC client, and translates the interface call into a wire
call. Because the in-process service and the adapter satisfy the identical interface, the composition
root just does `services.Replace(...)` to swap one for the other. The calling code never learns which
it got.

The error model survives the hop too. On the server, `GrpcResultExceptionInterceptor` turns a failed
`Result` (raised as a `ResultFailureException`) into an `RpcException` carrying the errors as
structured trailers. On the client, an adapter whose interface returns a `Result` catches that
`RpcException` and calls `ToResult()` (or `ToResult<T>()`), which rebuilds `Result.Failure(errors)`
from the trailers and degrades a bare transport fault (a reset connection, a missed deadline) to a
single retryable `Unexpected` error coded `Grpc.{StatusCode}` that carries the RPC detail. Callers keep
programming against `Result<T>` whether the answer came from an object or a network round-trip. This
is "Result over the wire," and it is why the wire hop does not poison your error handling.

### 4. Federated auth, a gateway, and Aspire hosting (ADR-008)

The last leak is everything around the services. User tokens cross services through JWKS, not a
shared secret: `IJwksProvider` (`RsaJwksProvider`) exposes signing keys, and `JwksEndpointExtensions`
serves `/.well-known/jwks.json`, so an extracted service validates a forwarded token against the
issuer's public keys. Under the Aspire AppHost each service discovers those keys through the gateway;
in production each service points its JWT authority straight at the Identity service. The one
exception is a service-to-service gRPC call with no user token to forward (a background drain, an
internal command): it carries an HS256 service token signed with a key the services share (ADR-061).
A single YARP reverse-proxy gateway is the only client entry point, owning the route-to-service map;
clients never address a service directly. `MMCA.Common.Aspire.Hosting` wires the broker, JWKS
discovery, the service-token key, and the per-service data sources for the extracted topology.

ADR-008 names the payoff precisely: each extracted service is just **the monolith with one module
enabled.** The `ModuleLoader` still runs, but each service host names only its own module assembly,
so peer modules are never discovered and their interfaces are wired by gRPC clients the host
registers. (The `Disabled*` stubs belong to a combined host that discovers a module and finds it
disabled.) Because the host names its module list in code, folding services back together is a
host-level change, not configuration alone. The Domain,
Application, and Shared code is byte-for-byte identical whether it runs in-process or extracted.

## What the boundary looks like in code

The whole thesis fits in one DI swap. The same handler depends on the same interface; only the
registration line differs between the two topologies.

```csharp
// Application code depends on the interface. It never sees the transport.
public sealed class GetSessionBookmarkCountHandler(
    IUnitOfWork unitOfWork,
    IBookmarkCountService bookmarkCountService) : IQueryHandler<GetSessionBookmarkCountQuery, Result<int>>
{
    // ... var count = await bookmarkCountService.GetBookmarkCountForSessionAsync(query.SessionId, cancellationToken);
    //     return Result.Success(count);   // the interface returns a plain Task<int>; the handler returns Result<int>
}

// MONOLITH host: the real in-process implementation is registered (peer module enabled).
//   -> IBookmarkCountService = the concrete Engagement service. Delivery is a method call.

// EXTRACTED host: it names only the Conference assembly, so no Engagement registration exists here,
// and the .Contracts DI helper adds the gRPC adapter (Replace, so it would also win over a stub):
services.Replace(ServiceDescriptor.Scoped<IBookmarkCountService, BookmarkCountServiceGrpcAdapter>());
//   -> same interface, now a gRPC call. GetSessionBookmarkCountHandler does not change.
```

The transport choice is one line at the composition edge. Everything above it is untouched.

## Trade-offs, honestly

Reversibility is not free, and the ADRs are candid about the bill.

- **Distributed-systems semantics arrive the moment you split.** Cross-service consistency is
  eventual (outbox plus integration events), not transactional. There are no cross-service
  transactions and no cross-database foreign keys (ADR-006). Referential integrity across services
  becomes the application's responsibility; a compensating index survives, the FK constraint does not.
- **Operational surface grows.** A split means multiple deployables, a gateway, service discovery, a
  broker, and per-service databases to provision, migrate, and back up, versus one process. Aspire
  orchestrates this locally and Bicep/Azure Container Apps in production, but the complexity is real.
- **Bidirectional gRPC pairs need care.** When two services call each other synchronously, the
  AppHost deliberately omits a reciprocal `WaitFor` to avoid a startup deadlock; the transient "peer
  not ready" errors self-heal through the resilience pipeline. That is a known sharp edge, not a free
  lunch.
- **The boundary costs a little even when unused.** Carrying `IMessageBus`, the data-source resolver, and
  the `.Contracts` convention in a monolith you may never split is overhead. The bet is that the
  overhead is small and the optionality is worth it. It is a bet, not a theorem.

The honest version of the thesis is not "microservices for free." It is "the boundary is cheap to
keep and tested, so the decision to split stays open instead of being foreclosed by accreted
coupling."

## Apply this even without MMCA

You do not need this framework to keep the extraction point open. You need three habits.

1. **Give each module its own logical data ownership now,** even in one database. No cross-module
   foreign keys, no joins across modules. If you cannot draw the data boundary today, you do not have
   a module, you have a tangle.
2. **Put one transport-agnostic interface between modules** for both events and synchronous calls.
   Application code depends on the interface; the in-process implementation and the future remote
   implementation both satisfy it. Swapping them is a registration change.
3. **Make the boundary executable.** A test that fails the build when transport types leak into your
   core is worth more than any architecture diagram, because the diagram does not run in CI and the
   test does.

The rule of thumb: a service boundary you have not enforced in the monolith is a boundary you have not
actually built. You have drawn a picture of one.

---

**What we covered:** why monolith-versus-microservices is a false binary, the four extraction points MMCA.Common
enforces inside one deployable (database-per-service, `IEventBus` over the transport-agnostic `IMessageBus`, gRPC
`.Contracts` with Result-over-the-wire, and JWKS auth behind a YARP gateway with Aspire hosting), and
the one invariant that ties them together: application code talks to abstractions, transport lives at
the edge, enforced by `MicroserviceExtractionTests`.

**Next in the series:** what good architecture actually means, the 34-category rubric this framework
grades itself against, and why enforced beats convention-only.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the three ADRs behind this boundary, or
install it and try the split for yourself.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-006 (database per service), ADR-007 (gRPC extraction), ADR-008 (service-extraction topology):
  in `Website/docs-src/adr/` in the docs site.
- `dotnet add package MMCA.Common.API`

*Tags: .NET, C Sharp, Software Architecture, Microservices, Modular Monolith*

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`). Anchors marked
"audit-confirmed" were confirmed by this run's audit and not re-opened by the apply step; every other anchor
was read in this run. Messaging: application code publishes through `IEventBus` and `IMessageBus` is only
the transport the outbox drains through (`MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:5-10`,
the interface at :29, its two implementations listed at :12-25); the `IEventBus` implementations are
`InProcessEventBus` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:34`) and
`BrokerEventBus` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:31`);
`InProcessMessageBus` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:18`) and
`BrokerMessageBus` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:46`, publishing
through the transport's `IBrokerPublisher` per its doc comment at :13-18, constructor parameter at :47). The provider
is the string `MessageBusSettings.Provider` defaulting to `InProcess`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:25`, adapter-registered brokers
at :8-11 and :18-23); built-in constants in `MessageBusProviders`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/MessageBusProviders.cs`: `InProcess` :16,
`RabbitMq` :19, `PostgreSql` :27, adapter transports at :34-39; audit-confirmed). Outbox posture: `EnableOutbox`
(`MessageBusSettings.cs:172`, doc :144-171: off under `InProcess` with synchronous dispatch and no outbox rows, on
under a broker, `MessageBus:EnableOutbox=true` opts a monolith in at :159-161, turning it off under a broker is
refused at registration at :161-163) resolved by `IsOutboxEnabled` at :180. ADC production sets
`MessageBus__Provider` to `AzureServiceBus` (`MMCA.ADC/infra/main.bicep:2439`, :2686, :2846, :3006).
Transport-leak fitness rule: `TransportDependencies`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:14-23`:
MassTransit, RabbitMQ.Client, Azure.Messaging.ServiceBus, Amazon.SQS, Amazon.SimpleNotificationService, Grpc,
Google.Protobuf; MassTransit "banned outright, ADR-118" at :7-8), asserted by `TransportDoesNotLeakIntoCoreLayers`
(:26) through `MicroserviceExtractionTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/MicroserviceExtractionTestsBase.cs:9`,
test at :14); the AGENTS.md bullet says "never reference a broker client" (`MMCA.Common/AGENTS.md:151`).
Data sources: `DataSourceResolver`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:16`, collapse
onto Default described at :212 and :289, unmapped-name fallback to `DataSourceKey.Default` at :99-106); `DataSourceKey`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/DataSourceKey.cs:15`,
`DefaultName` at :18) and `EntityDataSourceRegistry`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21`) are
audit-confirmed. Modules: `module.RegisterDisabledStubs(services)` at
`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:121` (the class at :16 and
`DisabledBookmarkCountService` at
`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/DisabledBookmarkCountService.cs:7`
audit-confirmed). The extracted Conference host calls `AddMmcaServiceHost`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`) with `ModuleAssemblies` holding only the
Conference module assembly (:89), and registers `AddEngagementBookmarkCountClient()` in the `ConfigurePipeline`
option (:357, the call at :359; comments at :37 and :332). ADR-008's payoff "the monolith with one module enabled"
is at `Website/docs-src/adr/008-service-extraction-topology.md:54` (and :113); its 2026-11-23 Revision (:309)
records the `AddMmcaServiceHost` / `ModuleAssemblies` shape at :318-322. Auth: AppHost JWKS discovery through
the gateway (`WithJwksDiscovery(identityService, gateway)` at `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:373-375`);
in production each service's `Authentication__JwtBearer__Authority` is `http://${identityApp.name}`
(`MMCA.ADC/infra/main.bicep:2672`, :2816, :2986). Service tokens: `Grpc__ServiceToken__SigningKey`
(`MMCA.ADC/infra/main.bicep:2492`, :2839, :3014) and the AppHost helper
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/ServiceTokenExtensions.cs:9-11`, ADR-061); `IJwksProvider`,
`RsaJwksProvider` and `JwksEndpointExtensions` anchors are audit-confirmed. gRPC and Result over the wire:
`ResultGrpcExtensions` (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:31`:
`ToRpcException()` at :119, client-side `ToResult()` at :219 and `ToResult<T>()` at :244, the transport-fault
degrade documented at :210-212 and :234-236, built by `TransportError` at :340 with code `Grpc.{StatusCode}` at
:342 and its `Unexpected`-not-`Failure` rationale at :336-338); `GrpcResultExceptionInterceptor` and
`ResultFailureException` are audit-confirmed. Result-returning ADC adapters call it, e.g.
`ex.ToResult<EventLiveInfo>()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:70`) and
`ex.ToResult()` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:58`);
`BookmarkCountServiceGrpcAdapter`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/BookmarkCountServiceGrpcAdapter.cs:14`) returns a plain
`Task<int>` (:23). The `.Contracts` convention: `MMCA.Common/Directory.Build.props:198` (the `EndsWith('.Contracts')`
item group) with `<Protobuf Include="Protos\**\*.proto" GrpcServices="Both" />` at :205 (ADC: `MMCA.ADC/Directory.Build.props:180`/:187).
Worked example: `IBookmarkCountService` and `GetSessionBookmarkCountHandler` anchors (interface :10/:19, handler
:14-16, call :43, return :45) are audit-confirmed; the code sample's `services.Replace(...)` line is verbatim source
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:52`, inside
`AddEngagementBookmarkCountClient` at :46; the comment at :50-51 notes Replace wins over an in-process
registration or a disabled stub). Aspire hosting: `MMCA.Common.Aspire.Hosting` ships eleven source files
(`BrokerSelection.cs`, `Extensions.cs`, `GatewayUiExtensions.cs`, `H2cEndpointHealthCheck.cs`,
`H2cHealthCheckExtensions.cs`, `IdentityLinkExtensions.cs`, `MmcaReplicas.cs`, `ServiceBusEmulatorResource.cs`,
`ServiceEndpointProfile.cs`, `ServiceInfrastructureExtensions.cs`, `ServiceTokenExtensions.cs`);
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs` exposes `AddMessageBroker` (:220),
`WithBroker` (:312, second overload :341), `WithJwksDiscovery` (:370), `WithE2eRsaKeys` (:414) and
`WithSQLServerDataSource`/`WithPostgreSQLDataSource`/`WithCosmosDataSource`/`WithSqliteDataSource`
(:587/:617/:646/:671), and **no** gRPC project-reference API (its only gRPC mention is a prose comment at :383;
`ServiceTokenExtensions.cs` names gRPC only for the service-token key). ADC's AppHost wires gRPC peers with stock
Aspire `WithReference` (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:266-308` under the block comment at
:251-265, whose deadlock and self-heal rationale is at :257-264; the Conference to Engagement reference at :276
carries no `WaitFor`, per the comment at :274-275). Repo and license: `ivanball/MMCA.Common`, Apache-2.0
(`MMCA.Common/Directory.Build.props:94-95`). Header source: the "Microservices Extraction Boundaries" heading is
at `MMCA.Common/AGENTS.md:147`, its message-bus bullet at :151. Changes this run (2026-11-25): section 2 names
`IEventBus` as the application publish API and `IMessageBus` as the transport beneath it (`IMessageBus.cs:5-10`);
`BrokerMessageBus` delivery became the transport's `IBrokerPublisher` rather than MassTransit (`BrokerMessageBus.cs:13-18`,
:47); the fitness-rule sentence names the broker clients and gRPC runtime it forbids (`ArchitectureRules.Transport.cs:14-23`);
the outbox sentence states the per-provider posture (off by default in-process, forced on under a broker,
`MessageBusSettings.cs:144-180`); the error-model sentence names the synthesized error `Unexpected` with code
`Grpc.{StatusCode}` (`ResultGrpcExtensions.cs:336-342`); section 4 scopes JWKS to user tokens and adds the
HS256 service token (`main.bicep:2492`, `ServiceTokenExtensions.cs:9-11`); ADR-118 joined the header; the
framework stamp moved to v1.319.0, the Aspire.Hosting file count from five to eleven, the forbidden transport set
from three to seven, and the Conference host evidence from `AddModuleHost`/`AddMmcaApplicationPipeline` to
`AddMmcaServiceHost`/`ModuleAssemblies`/`ConfigurePipeline`; every other anchor was re-anchored. Earlier runs
(2026-09-19 through 2026-10-29) corrected the provider selector to a string, the extracted-host and `Disabled*`
stub description, the AppHost-only JWKS discovery, the error-model attribution to `ToResult()`, the handler's
constructor shape, the header source file, and several moved paths and anchors.*

- Full series index: https://ivanball.github.io/writing.html
