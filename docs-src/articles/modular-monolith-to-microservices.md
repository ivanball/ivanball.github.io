# Modular monolith to microservices, without the rewrite

> Series: MMCA.Common · Article #2 (cornerstone thesis) · Pillar P1/P3 · Groups G07,G13,G14 ·
> Rubric §7 · ADRs 006/007/008 · Status: grounded in `MMCA.Common/CLAUDE.md` (its microservice
> extraction-boundaries section), `Website/docs-src/adr/006-database-per-service.md`, `Website/docs-src/adr/007-grpc-extraction.md`,
> `Website/docs-src/adr/008-service-extraction-topology.md`, and `Website/docs-src/onboarding/group-14-module-system-composition.md`
> + `group-13-grpc-contracts.md`, with source re-read 2026-10-02 at v1.221.0 (`MessageBusSettings.cs`,
> `ArchitectureRules.Transport.cs`, `ResultGrpcExtensions.cs`, ADC `IBookmarkCountService.cs`,
> `GetSessionBookmarkCountHandler.cs`, Engagement.Contracts `DependencyInjection.cs`). No em dashes.

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

The second leak is event delivery. There is one abstraction, `IMessageBus`, defined in the
Application layer, with two implementations in Infrastructure: `InProcessMessageBus` (delivery is a
method call, used in the monolith) and `BrokerMessageBus` (delivery is over a MassTransit broker,
RabbitMQ locally and Azure Service Bus in production, used once a module is its own service).
`MessageBusSettings` selects the mode. Your handler code does not change when you flip it.

The rule that keeps this honest is that **Application, Domain, and Shared must never reference
MassTransit directly.** That is not a code-review comment. It is a fitness test,
`MicroserviceExtractionTests`, that fails the build if a transport type leaks into the core. The
transactional outbox (its own article in this series) is what makes the flip safe: the same durable
event record drains to an in-process handler today and to a broker tomorrow.

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
single failure carrying the RPC detail. Callers keep programming against `Result<T>` whether the
answer came from an object or a network round-trip. This is "Result over the wire," and it is why
the wire hop does not poison your error handling.

### 4. Federated auth, a gateway, and Aspire hosting (ADR-008)

The last leak is everything around the services. Cross-service auth uses JWKS, not a shared secret:
`IJwksProvider` (`RsaJwksProvider`) exposes signing keys, and `JwksEndpointExtensions` serves
`/.well-known/jwks.json`, so an extracted service validates a forwarded token against the issuer's
public keys, discovered through the gateway. A single YARP reverse-proxy gateway is the only client
entry point, owning the route-to-service map; clients never address a service directly.
`MMCA.Common.Aspire.Hosting` wires the broker, JWKS discovery, and the per-service data sources for
the extracted topology.

ADR-008 names the payoff precisely: each extracted service is just **the monolith with one module
enabled.** The `ModuleLoader` still runs, only with one module's `Enabled=true`; disabled peers are
satisfied by `Disabled*` stubs, which the host then replaces with gRPC clients. The Domain,
Application, and Shared code is byte-for-byte identical whether it runs in-process or extracted.

## What the boundary looks like in code

The whole thesis fits in one DI swap. The same handler depends on the same interface; only the
registration line differs between the two topologies.

```csharp
// Application code depends ONLY on the interface. It never sees the transport.
public sealed class GetSessionBookmarkCountHandler(
    IBookmarkCountService bookmarkCountService) : IQueryHandler<GetSessionBookmarkCountQuery, Result<int>>
{
    // ... var count = await bookmarkCountService.GetBookmarkCountForSessionAsync(query.SessionId, cancellationToken);
    //     return Result.Success(count);   // the interface returns a plain Task<int>; the handler returns Result<int>
}

// MONOLITH host: the real in-process implementation is registered (peer module enabled).
//   -> IBookmarkCountService = the concrete Engagement service. Delivery is a method call.

// EXTRACTED host: after ModuleLoader runs, the peer is disabled (a Disabled* stub holds the slot),
// then the .Contracts DI helper overwrites it with the gRPC adapter:
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
enforces inside one deployable (database-per-service, the transport-agnostic `IMessageBus`, gRPC
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

*Notes: 2026-10-02 re-verify at framework v1.221.0 (`MMCA.Common/FACTS.md:14`); every anchor below was
re-read in this run. Messaging: `IMessageBus`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:28`), `InProcessMessageBus`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:19`) and
`BrokerMessageBus` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:43`,
publishing through MassTransit, transport-neutral); `MessageBusProvider` has three values, `InProcess` (0),
`RabbitMq` (1, dev/test) and `AzureServiceBus` (2, production)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:236`, members at
:241/:246/:251). Transport-leak fitness rule: the forbidden set is MassTransit, Grpc **and** Google.Protobuf
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:11-16`),
asserted by `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/MicroserviceExtractionTestsBase.cs:13`
and subclassed in Common, ADC, Store, Helpdesk and the MMCA.ECommerce sample. Data sources: `DataSourceKey`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/DataSourceKey.cs:15`,
`DefaultName = "Default"` at :18), `DataSourceResolver`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:16`, the
collapse onto Default described at :191 and :294) and `EntityDataSourceRegistry`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21`).
Modules: `ModuleLoader` (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:16`) and the
`Disabled*` stubs, e.g. `DisabledBookmarkCountService`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/DisabledBookmarkCountService.cs:7`).
Auth: `IJwksProvider` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11`, serving
`/.well-known/jwks.json` per its doc comment at :6), `RsaJwksProvider`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:14`) and `JwksEndpointExtensions`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Endpoints/JwksEndpointExtensions.cs:15`). gRPC and
Result over the wire: `GrpcResultExceptionInterceptor`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Interceptors/GrpcResultExceptionInterceptor.cs:19`,
catching `ResultFailureException` at :34 and mapping its errors through `ToRpcException()` in
`ToTransportException` at :126), `ResultFailureException`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Exceptions/ResultFailureException.cs:16`), and
`ResultGrpcExtensions` (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs:31`:
`ToRpcException()` at :119, client-side `ToResult()` at :218 and `ToResult<T>()` at :242, structured
trailers first, a bare transport fault degrading to one `Grpc.{StatusCode}` failure). Result-returning ADC
adapters call it, e.g. `ex.ToResult<EventLiveInfo>()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:61`) and
`ex.ToResult()` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:58`);
`BookmarkCountServiceGrpcAdapter`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/BookmarkCountServiceGrpcAdapter.cs:14`) returns a
plain count and has no `Result` to rebuild. The `.Contracts` convention:
`MMCA.Common/Directory.Build.props:153` (the `EndsWith('.Contracts')` item group) with
`<Protobuf Include="Protos\**\*.proto" GrpcServices="Both" />` at :160. Worked example:
`IBookmarkCountService` carries `[ServiceContract]` and declares
`Task<int> GetBookmarkCountForSessionAsync(SessionIdentifierType sessionId, CancellationToken)`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/IBookmarkCountService.cs:10`
and :19); `GetSessionBookmarkCountHandler`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountHandler.cs:14`,
implementing `IQueryHandler<GetSessionBookmarkCountQuery, Result<int>>` at :16) makes the call at :43 and
returns `Result.Success(count)` at :45; the code sample's `services.Replace(...)` line is verbatim source
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:49`, inside
`AddEngagementBookmarkCountClient` at :43). Aspire hosting: `MMCA.Common.Aspire.Hosting` ships four source
files (`Extensions.cs`, `H2cHealthCheckExtensions.cs`, `H2cEndpointHealthCheck.cs`,
`ServiceBusEmulatorResource.cs`); `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs`
exposes `AddMessageBroker` (:160), `WithBroker` (:252, second overload :280), `WithJwksDiscovery` (:309),
`WithE2eRsaKeys` (:353) and
`WithSQLServerDataSource`/`WithPostgreSQLDataSource`/`WithCosmosDataSource`/`WithSqliteDataSource`
(:483/:513/:542/:567), and **no** gRPC project-reference API (the only gRPC mention is a prose comment at
:322). ADC's AppHost wires gRPC peers with stock Aspire `WithReference`
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:269-301`; the Conference to Engagement reference at
:274 carries no `WaitFor`). Repo and license: `ivanball/MMCA.Common`, Apache-2.0
(`MMCA.Common/Directory.Build.props:49-50`). Changes this run: the license/URL anchor was re-anchored to
49-50; the error-model paragraph was corrected (the trailer-to-`Result` rebuild is `ToResult()` in
`ResultGrpcExtensions`, called by Result-returning adapters, not something the bookmark adapter does); the
code sample's handler shape now matches source (primary constructor plus `IQueryHandler`); a "now" was
dropped from section 1. Earlier runs: the 2026-09-19 run corrected three moved paths
(`MessageBusSettings.cs` to `Messaging/`, `ArchitectureRules.Transport.cs` to `Rules/Layering/`,
`MicroserviceExtractionTestsBase.cs` to `Bases/Layering/`) and retired the `ServiceContractAttribute` gap;
before that, "over RabbitMQ" became provider-neutral, an invented Aspire gRPC API was removed, and a
nonexistent `GetCountAsync(...) returns Result<int>` was replaced with the real interface method.*

- Full series index: https://ivanball.github.io/writing.html
