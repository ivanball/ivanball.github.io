# ADR-118: Message Transport Library Policy (MassTransit v8 Pin and Exit Strategy)

## Status
Accepted (2026-09-11). Promotes the MassTransit clause inside
[ADR-016](016-lockstep-versioning-masstransit-pin.md) into a decision of its own: ADR-016 owns the
release policy that the pin is enforced under, this record owns the choice of transport library, the
conditions that end it, and the ordered list of what replaces it.
Amended (2026-09-19): the pinned-entry count is restated workspace-wide (five entries, three in
MMCA.Common plus one each in MMCA.ADC and MMCA.Store) and the build gate's reach is scoped to
MMCA.Common; the `using MassTransit` surface is recounted from source as nine files; ADC's nightly
Service Bus emulator smoke is restated as authoritative rather than advisory; the external v9 and
support-horizon dates gain the hedge ADR-016 already carries; and the unreconciled overlap with
ADR-016's still-live **Transport exit options** section is recorded under **Related**. The pin, the
decision and the replacement order are unchanged. Revised 2026-10-07: anchors refreshed after the
v1.233.0 release. Revised 2026-10-21: the circuit-breaker description now matches source (it wraps
the `IMessageBus` publish, which is the broker hop only in broker mode), and anchors are refreshed.
Revised 2026-10-24: `MassTransit.AmazonSQS` 8.5.11 joins the pinned set for the SQS adapter transport, the pin and its gate unchanged ([ADR-134](134-cloud-neutral-core-vendor-adapters.md)); the trial point and the surface inventory are corrected in place. See Revision (2026-10-24) at the end.
Revised 2026-10-25: `MassTransit.SqlTransport.PostgreSQL` 8.5.11 (Apache-2.0) joins the pinned set for the built-in PostgreSQL transport and reaches every consumer of MMCA.Common.Infrastructure with Dapper; Decision 1 now records that the build gate covers three of MMCA.Common's five MassTransit entries. See Revision (2026-10-25) at the end.
Revised 2026-10-26: every MassTransit entry is at the 8.5.12 v8 patch, the build gate now covers all five MMCA.Common entries, MMCA.Common's `using MassTransit` surface is recounted as fifteen files and the swap surface is restated to include the consumer service hosts' MassTransit-typed consumer registration, and the `Azure.Messaging.ServiceBus` pin is restated as also serving the Azure transport; anchors refreshed.

## Context
MassTransit is the only message-broker library in this workspace, and it is pinned to 8.5.12 across
all five of MMCA.Common's MassTransit packages (`MMCA.Common/Directory.Packages.props:125-127`,
`:130`, `:136`, the pin comment at `:120-124`). Two consumers declare a
`MassTransit.Azure.ServiceBus.Core` entry of their own at the same 8.5.12 patch for their Service Bus
emulator test tier (`MMCA.ADC/Directory.Packages.props:73`,
`MMCA.Store/Directory.Packages.props:97`), so the workspace carries seven pinned MassTransit entries.
The pin is a policy
rather than a lag: v9 was announced in April 2025 and shipped in January 2026 as a commercial,
source-available product with a runtime licence key (those two dates are the vendor's own public
record, not something this repository can assert). A v9 bus fails its startup licence check and
every broker-enabled service host crashes, which is a failure mode a build cannot see because CI
never starts a broker. That is why the ceiling is a fitness function rather than a comment:
`MassTransit_MustNotExceed_MajorVersion8`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:28`)
parses `Directory.Packages.props` and fails the build at an exclusive major ceiling of 9 (`:34`),
and MMCA.Common subclasses it
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DependencyVersionTests.cs:9`).
A blanket package update bumped the version to 9.1.2 once before and reintroduced the crash. The
gate reads the props file found by walking up from the running test assembly, and MMCA.Common is the
only repo that subclasses the base (the base's own doc comment tells consumers not to), so the build
gate covers Common's five entries and nothing else. What holds the two consumer entries at v8 is
the lockstep sweep plus a `dependabot.yml` in each repo that manages only the github-actions and docker
ecosystems (`MMCA.ADC/.github/dependabot.yml:28`, `MMCA.Store/.github/dependabot.yml:32`), whose
comment says NuGet is excluded and MassTransit must stay v8 (`MMCA.ADC/.github/dependabot.yml:1-4`,
`MMCA.Store/.github/dependabot.yml:6-8`).

A pin with no horizon is a decision that expires quietly, so the real question is not "which version"
but "what does this workspace actually owe MassTransit, and what would it cost to leave". The answer
is narrower than the usual framework-lock-in story, because the durable parts of the messaging design
are not MassTransit's:

- **The outbox is ours.** `OutboxMessage`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs`) is a
  plain EF entity holding the serialized `Payload` (`:43`) keyed by `EventType` (`:40`), with the
  claim lease (`LockedUntil` `:60`, `LockToken` `:67`), the retry counter (`:52`), the propagated
  `TraceId` / `SpanId` (`:73`, `:76`) and the optional `OrderingKey` (`:88`). None of those columns
  is a broker concept ([ADR-003](003-outbox-dual-dispatch.md)).
- **The inbox is ours.** `IInboxStore` (`.../Persistence/Inbox/IInboxStore.cs:16`), `InboxMessage`
  (keyed on `MessageId`, `.../Persistence/Inbox/InboxMessage.cs:14`) and `EfInboxStore` dedup
  redeliveries in the consumer's own database, and `TryBeginAsync`
  (`.../Persistence/Inbox/IInboxStore.cs:38`) stages the row into the handler's own unit of work
  ([ADR-021](021-consumer-inbox-idempotency.md)). A broker supplies the redelivery; nothing else here
  is the broker's.
- **The publish and consume leg is the only part MassTransit owns.** `OutboxProcessor` resolves
  `IMessageBus` from the per-row scope
  (`.../Persistence/Outbox/Processing/OutboxProcessor.cs:776`) and publishes every integration event
  through it (`PublishAsync` at `:785`), and only that `IMessageBus` publish is wrapped in the
  circuit breaker (`:783-787`, the comment saying so at `:778-782`). In broker mode that publish is
  the broker hop; on a monolith the default `InProcessMessageBus` runs the integration-event
  handlers inside the same breaker (the field doc at `:103-110`)
  ([ADR-087](087-broker-poison-message-handling.md)).

The abstractions that stand between application code and the library are already in place and are
this workspace's own types: `IMessageBus`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:28`) and `IEventBus`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventBus.cs:11`). `BrokerMessageBus`
implements the first over a MassTransit `IPublishEndpoint`
(`.../Infrastructure/Messaging/BrokerMessageBus.cs:43-44`); `BrokerEventBus` implements the second and
does not reference MassTransit at all (`.../Infrastructure/Messaging/BrokerEventBus.cs:31`), because
in broker mode its whole job is to write the outbox row and signal the processor. MMCA.Common's
`using MassTransit` surface is **fifteen files**: eleven inside `MMCA.Common.Infrastructure`
(`DependencyInjection.Messaging.cs`, `Messaging/BrokerMessageBus.cs`, four files of the
`Messaging/Transports/` extension point (`IBrokerTransport.cs`, `BrokerTransportPolicies.cs`,
`RabbitMqBrokerTransport.cs`, `PostgreSqlBrokerTransport.cs`) and the five consumer files under
`Messaging/Consumers/`: `IntegrationEventConsumer.cs`, `IntegrationEventConsumerExtensions.cs`,
`UpcastingIntegrationEventConsumer.cs`, `FaultIntegrationEventConsumer.cs` and
`ConsumerOriginRestore.cs`), three in the adapter packages (`MMCA.Common.Azure`'s
`Messaging/AzureServiceBusTransport.cs` and `Messaging/ServiceBusEmulatorSupport.cs`,
`MMCA.Common.Aws`'s `Messaging/AmazonSqsTransport.cs`; see the Revision (2026-10-24)), plus the
emulator test fixture
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Azure/Fixtures/ServiceBusEmulatorFixtureBase.cs:54`.
The surface does not stop at MMCA.Common. Its public consumer-registration API is typed on
MassTransit: `AddBrokerMessaging` takes an `Action<IBusRegistrationConfigurator>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:48-50`) and
`RegisterIntegrationEventConsumer` an `Action<IEndpointRegistrationConfigurator>`
(`.../Messaging/Consumers/IntegrationEventConsumerExtensions.cs:60-62`). Every consumer service host
that runs broker consumers passes such a lambda (for example
`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:269-283`,
`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:303-307`), ADC's Conference host
names MassTransit directly
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/ConferenceBrokerConsumers.cs:1`, `:32-37`),
and each consumer's Service Bus emulator fixture does too
(`MMCA.ADC/Tests/Integration/MMCA.ADC.ServiceBusEmulator.IntegrationTests/Infrastructure/ServiceBusEmulatorFixture.cs:1`,
`MMCA.Store/Tests/Integration/MMCA.Store.ServiceBusEmulator.IntegrationTests/Infrastructure/ServiceBusEmulatorFixture.cs:1`).
Domain, Application and Shared hold the interfaces alone, and that is build-gated:
`MicroserviceExtractionTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/MicroserviceExtractionTestsBase.cs:8`)
bans MassTransit, gRPC and Protobuf from the Domain, Application and Shared layers
(`.../Rules/Layering/ArchitectureRules.Transport.cs:21`); other layers are not checked, and
Infrastructure, `*.Service` and `*.Contracts` are the edges the transport is meant to live at
(`:6-8`).

The comparison landscape is also public rather than internal: the August 2025 Visual Studio Magazine
article "Messaging Made Simple: Choosing the Right Framework for .NET" surveys the same shift, and
the two candidates below are the ones that survive this workspace's constraints. That article, the
v9 release dates above and the v8 support horizon below are all external statements cited as
published: none of them is verifiable from this repository, which is the same hedge
[ADR-016](016-lockstep-versioning-masstransit-pin.md) applies to the support horizon.

## Decision
**Stay on MassTransit v8 behind `IMessageBus`, and keep the outbox and inbox custom precisely because
that is what keeps a transport swap cheap. Record the exit triggers now, and the replacement order,
so the pin is a dated decision rather than an open-ended hold.**

1. **The pin stands; the build gate in MMCA.Common covers all five of its entries.** MassTransit
   remains on v8 (8.5.12 today) on all five MMCA.Common entries: `MassTransit`, `MassTransit.RabbitMQ`
   and `MassTransit.Azure.ServiceBus.Core` (`MMCA.Common/Directory.Packages.props:125-127`),
   `MassTransit.AmazonSQS` (`:130`) and `MassTransit.SqlTransport.PostgreSQL` (`:136`), the last two
   commented as tracking the same v8 line and version as the rest (`:129`, `:134`).
   `DependencyVersionTestsBase` remains the enforcement point, and its `MassTransitPackageIds` list
   names all five
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:18-25`,
   the two transport ids at `:23-24`), which MMCA.Common's subclass inherits without an override
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DependencyVersionTests.cs:9`).
   The two consumer-declared `MassTransit.Azure.ServiceBus.Core` entries are held at the same patch
   by the lockstep sweep and the NuGet-excluded dependabot config, not by a build gate, and a
   consumer that wants its own guard overrides `MassTransitPackageIds` rather than subclassing the
   base as shipped. The ceiling is the major version only: v8 patch and minor updates are ordinary
   dependency work.

2. **No durable messaging mechanism may move into the library.** The outbox, the inbox, the claim
   lease, the retry and dead-letter policy, the ordering key and the trace propagation columns stay
   framework code on framework tables. MassTransit's own transactional-outbox feature is not adopted,
   and adopting it later would be a reversal of this clause, not a refactor.

3. **The exit triggers are named.** Any one of these opens the replacement work, and none of them is
   a version number on its own:
   - a security advisory against MassTransit v8 with no patched v8 release;
   - a .NET major version (11 and onward) that v8 does not support;
   - the close of the v8 maintenance window (community support for the v8 line is stated to end at
     the end of 2026).

4. **The replacement order is decided in advance.** Both candidates implement the existing
   `IMessageBus`, so no consumer handler, module or contract changes; the consumer service hosts'
   MassTransit-typed consumer registration (see Context) is the part a swap does touch:
   - **First: Wolverine** (Apache 2.0). Message handling is plain methods rather than a consumer
     class per message, and its transports cover the two this workspace runs (RabbitMQ, Azure Service
     Bus) plus SQS and Kafka. Its own durable-inbox and outbox features would be left off, because
     decision 2 already owns that layer.
   - **Second: a raw-SDK adapter.** `RabbitMQ.Client` plus `Azure.Messaging.ServiceBus`, the latter
     already pinned at 7.21.0 for the `MMCA.Common.Azure` Service Bus transport and its emulator
     test tier (`MMCA.Common/Directory.Packages.props:141`; the comment at `:137-140` names 7.20.2
     as the first line with working emulator admin-plane support). This is the floor option: no third-party
     abstraction at all, at the cost of hand-writing consumer dispatch, retry and delayed redelivery.

5. **Two options are rejected outright, and recorded so they are not re-proposed.**
   - **MassTransit v9.** Commercial with a runtime licence key. Buying it retires the gate rather
     than answering it, at a recurring cost, and leaves the transport decision where it is today.
   - **MediatR.** Not used anywhere in this workspace (the CQRS pipeline is the framework's own
     `ICommandHandler` / `IQueryHandler` chain, [ADR-014](014-cqrs-decorator-pipeline.md)), and
     commercial since 2025 for the same reason. It is named here only because it is the library most
     often suggested in the same breath, and it would be a new dependency rather than a replacement.

6. **A trial ships beside the incumbent.** The trial point is one more
   `IBrokerTransport` registered by name through `AddBrokerTransport`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:159`, resolved
   by `ResolveBrokerTransport` at `:188`, beside the built-in RabbitMQ and PostgreSQL transports it
   returns at `:188-197` and the adapter transports in MMCA.Common.Azure and MMCA.Common.Aws), so a candidate is exercised by
   configuration without removing anything, and ADC's nightly Service Bus emulator smoke is where it
   runs first. That job is authoritative rather than advisory: it has carried no `continue-on-error`
   since 2026-08-31 (TD-17), and `deploy.yml`'s cross-service-freshness gate requires it to have
   concluded success alongside the `cross-service` job in the same qualifying nightly
   (`MMCA.ADC/.github/workflows/cross-service-tests.yml:142`, the gating rationale at `:116-126`;
   the gate's `required-jobs` at `MMCA.ADC/.github/workflows/deploy.yml:901-903`), so
   a candidate arm that regresses Service Bus topology or the AMQP round-trip blocks the next deploy.

## Rationale
- **The pin is enforceable, so it is honest.** A comment beside a version number is a hope; a fitness
  function that parses `Directory.Packages.props` is the reason the v9 crash was reintroduced exactly
  once. Making the ceiling a build gate is the same invariant-over-discipline posture as the layer
  rules ([ADR-015](015-architecture-fitness-functions.md)).
- **Custom durable machinery is what makes the transport replaceable.** A library that owned the
  outbox would own the lease semantics, the ordering guarantee, the dead-letter retention window and
  the replay API, and every one of those would have to be re-earned against a new library's model.
  Owning them means a swap is a publish-and-consume adapter: MMCA.Common's fifteen-file surface
  above, plus the MassTransit-typed consumer registration in each consumer service host and emulator
  fixture.
- **Wolverine ahead of raw SDKs** because it keeps retry, delayed redelivery and consumer dispatch as
  library concerns on both transports this workspace runs, which is precisely the part the raw-SDK
  option hand-writes. It is ordered first on licence and transport coverage, not on a benchmark run
  here: neither candidate has been evaluated against a running broker in this workspace.
- **Rejecting v9 is a licence decision, not a quality one.** The v9 line is a reasonable product; a
  per-deployment runtime key across seven service hosts plus every test tier is the cost that does
  not fit.

## Trade-offs
- **The workspace sits on a library version with a finite support horizon.** Nothing forces a move
  today, and the exit triggers above are what convert "we should look at this sometime" into a dated
  check. The cost of being wrong about the horizon is a rushed adapter rather than a rewrite, which
  is the whole point of decision 2.
- **A v8 security advisory has no patch path but the exit.** There is no commercial support contract
  on the v8 line, so an advisory with no community patch moves straight to the replacement list.
- **An adapter spike is mostly a Common change, but not only one.** No consumer handler, module or
  contract changes, because the candidate ships behind `IMessageBus` and the ban in
  `MicroserviceExtractionTestsBase` keeps the library out of consumer Domain, Application and Shared
  layers. The ban does not reach service hosts or test fixtures, though: the consumer hosts register
  consumers through MassTransit's `IBusRegistrationConfigurator` and
  `IEndpointRegistrationConfigurator` (see Context), so a swap that changes the
  `AddBrokerMessaging` signature also edits those hosts and the consumer emulator fixtures. The cost
  lands in one Common release plus that host-level change per consumer, swept under
  [ADR-016](016-lockstep-versioning-masstransit-pin.md)'s lockstep policy.
- **The PostgreSQL transport is core, so its package reaches every consumer.**
  `PostgreSqlBrokerTransport` ships in MMCA.Common.Infrastructure because any PostgreSQL is the broker
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlBrokerTransport.cs:10-14`,
  `:40`), so every consumer of that package restores `MassTransit.SqlTransport.PostgreSQL` and the
  Dapper it brings (`MMCA.Common/CHANGELOG.md:86`, `MMCA.Common/Directory.Packages.props:134-135`)
  whether or not it selects the transport.
- **The emulator test tier is coupled to the choice.** `ServiceBusEmulatorFixtureBase` uses the
  MassTransit v8 custom-clients `Host()` overload, so a transport swap re-writes that fixture and
  re-checks the `Azure.Messaging.ServiceBus` 7.21.0 pin it shares with the `MMCA.Common.Azure`
  Service Bus transport.
- **Ordering the candidates without running them is deliberate but partial.** The list narrows what a
  spike has to evaluate; it does not stand in for the spike.

## Revision (2026-10-01)
No decision, trigger, replacement order or rationale changed. Facts restated from source: all five
pinned MassTransit entries are at the v8 patch 8.5.11 (`MMCA.Common/Directory.Packages.props:128-130`,
`MMCA.ADC/Directory.Packages.props:65`, `MMCA.Store/Directory.Packages.props:93`), an ordinary v8
patch update under decision 1, and `Azure.Messaging.ServiceBus` is at 7.21.0
(`MMCA.Common/Directory.Packages.props:135`). Both consumer `dependabot.yml` files also manage a
docker ecosystem (`MMCA.ADC/.github/dependabot.yml:28`, `MMCA.Store/.github/dependabot.yml:32`);
NuGet is still excluded. The transport fitness rule checks Domain, Application and Shared only
(`ArchitectureRules.Transport.cs:21`), not every layer outside API and Infrastructure. ADR-016's
**Related** section now links back to this record without ceding the exit-options list. The broker
transport configuration moved to `DependencyInjection.Messaging.cs` (`:258`), which is also the ninth
`using MassTransit` file in place of `DependencyInjection.cs`; the count of nine is unchanged. The
`OutboxProcessor`, `BrokerMessageBus` and ADC workflow citations are re-anchored.

## Revision (2026-10-06)
No decision, trigger, replacement order or rationale changed, and no fact changed: every corrected
item is a moved line. The 2026-10-01 anchors above now sit at: the three Common MassTransit entries
`MMCA.Common/Directory.Packages.props:124-126` (still 8.5.11), `Azure.Messaging.ServiceBus` 7.21.0 at
`:131`, and `ConfigureBrokerTransport` at `DependencyInjection.Messaging.cs:264`. Anchors in Context
and Decision were re-verified against current source (the `OutboxMessage` columns, the
`OutboxProcessor` publish leg and breaker, the transport switch arms, and ADC `deploy.yml`'s
`required-jobs`).

## Revision (2026-10-07)
Re-verified against current source. No decision, trigger, replacement order or rationale changed,
and no fact changed: all five MassTransit entries are still at 8.5.11 and the Service Bus emulator
smoke is still authoritative and deploy-gated. Four groups of anchors in Context and Decision moved
after the 2026-10-06 revision and are re-pointed in place.

1. Anchors re-verified against current source: the Store `MassTransit.Azure.ServiceBus.Core` entry
   `MMCA.Store/Directory.Packages.props:89` (still 8.5.11; the ADC entry stays at
   `MMCA.ADC/Directory.Packages.props:65`); the `OutboxProcessor` publish leg inside `DeliverAsync`,
   with `IMessageBus` resolved at `OutboxProcessor.cs:680`, the breaker call at `:685-689`,
   `PublishAsync` at `:687` and the only-the-broker-hop comment at `:682-684`; the ADC
   `servicebus-emulator-smoke` job at `MMCA.ADC/.github/workflows/cross-service-tests.yml:142` with
   its AUTHORITATIVE SINCE 2026-08-31 (TD-17) rationale at `:116-126` (`continue-on-error` appears
   there only in comments, never as a key); and the `cross-service-freshness` gate's `required-jobs`
   at `MMCA.ADC/.github/workflows/deploy.yml:885-887` (`required-jobs-mode: same-run` at `:888`).
   The Store anchor inside the 2026-10-01 revision is left as written.

## Revision (2026-10-21)
Re-verified against current source. No decision, trigger, replacement order or rationale changed:
all five MassTransit entries are still at 8.5.11, the build gate's ceiling is still major 9, and
the Service Bus emulator smoke is still authoritative and deploy-gated. One description in Context
moved with the code. Three of the four anchor groups the 2026-10-07 revision re-pointed have moved
again (the Store entry, the `OutboxProcessor` publish leg and the `deploy.yml` gate); the ADC
`servicebus-emulator-smoke` job is still at `cross-service-tests.yml:142` with its TD-17 rationale
at `:116-126`. That revision is left as written.

1. The publish-leg bullet in Context no longer says only the broker hop is wrapped. The breaker in
   `OutboxProcessor.DeliverAsync` wraps the `IMessageBus` publish
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:781-785`),
   and its comment (`:776-780`) and field doc (`:102-105`) state that with broker messaging this is
   the broker hop, while on a monolith the default `InProcessMessageBus` runs the integration-event
   handlers inside the same breaker, so failing handlers can open it too.
2. Anchors re-verified against current source: the Store `MassTransit.Azure.ServiceBus.Core` entry
   `MMCA.Store/Directory.Packages.props:92` (still 8.5.11; ADC still at
   `MMCA.ADC/Directory.Packages.props:65`); `MassTransit_MustNotExceed_MajorVersion8` at
   `DependencyVersionTestsBase.cs:26` with `exclusiveMajorCeiling: 9` at `:32`; `IMessageBus`
   resolved at `OutboxProcessor.cs:774`, `PublishAsync` at `:783`; and the
   `cross-service-freshness` gate's `required-jobs` at `MMCA.ADC/.github/workflows/deploy.yml:900-902`
   (`required-jobs-mode: same-run` at `:903`). The `MicroserviceExtractionTestsBase` citation in
   Context now names the class declaration (`MicroserviceExtractionTestsBase.cs:8`) rather than the
   `CoreLayers_ShouldNotDependOn_Transport` test at `:13`; neither line moved.

## Revision (2026-10-24)
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) moves the vendor transports into adapter
packages. The library choice, the v8 pin, the exit triggers and the replacement order are unchanged.

1. **`MassTransit.AmazonSQS` stays on the v8 pin.** It is pinned at 8.5.11, documented as the same
   version as every MassTransit entry above it
   (`MMCA.Common/Directory.Packages.props:129`-`:130`), beside `MassTransit`, `MassTransit.RabbitMQ`
   and `MassTransit.Azure.ServiceBus.Core` at 8.5.11 (`:125`-`:127`). MMCA.Common therefore carries
   four MassTransit entries; the five-entry workspace count in the 2026-09-19 amendment is left as
   recorded. Only `MMCA.Common.Aws` consumes the new entry, through `AmazonSqsTransport`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsTransport.cs:37`).
2. **The vendor transports left the core.** The Azure Service Bus transport and its emulator helper
   are in `MMCA.Common.Azure`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Messaging/AzureServiceBusTransport.cs:16`,
   `Messaging/ServiceBusEmulatorSupport.cs:32`), and the build gate refuses a vendor MassTransit
   transport in any core project
   (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:108-111`, `:126`).
3. **Corrected in place:** Decision item 6, which placed the trial point in a `MessageBusProvider`
   switch inside `ConfigureBrokerTransport` (neither exists now; a trial is one more registered
   `IBrokerTransport`), and the Context surface inventory, which listed
   `Messaging/ServiceBusEmulatorSupport.cs` in Infrastructure and the fixture under
   `MMCA.Common.Testing`.

## Revision (2026-10-25)
The library choice, the v8 pin, the exit triggers and the replacement order are unchanged.

1. **`MassTransit.SqlTransport.PostgreSQL` joins the v8 pin.** It is pinned at 8.5.11
   (`MMCA.Common/Directory.Packages.props:136`) under a comment tying it to the same v8 line and
   version as every MassTransit entry and noting that it brings Dapper (`:134-135`); its license is
   Apache-2.0 (`MMCA.Common/CHANGELOG.md:24`). It backs the built-in `PostgreSqlBrokerTransport`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlBrokerTransport.cs:40`),
   selected by `MessageBus:Provider=PostgreSql` ([ADR-066](066-broker-transport-selection.md)).
   Because that transport is core, every consumer of MMCA.Common.Infrastructure now restores it and
   Dapper (`MMCA.Common/CHANGELOG.md:24`), recorded as a new Trade-offs bullet.
2. **The build gate does not cover it.** `MassTransitPackageIds` still lists `MassTransit`,
   `MassTransit.RabbitMQ` and `MassTransit.Azure.ServiceBus.Core` only
   (`DependencyVersionTestsBase.cs:20-22`), with no override in Common's subclass
   (`DependencyVersionTests.cs:9`), so neither `MassTransit.SqlTransport.PostgreSQL` nor the
   `MassTransit.AmazonSQS` entry the 2026-10-24 revision added is checked against the major-9 ceiling
   (`DependencyVersionTestsBase.cs:32`). Decision 1 now says so; the 2026-10-24 revision's "the pin
   and its gate unchanged" describes the gate's list, not its reach over the new entry.
3. **Corrected in place:** Decision 1 (three packages, now five MMCA.Common entries with three gated)
   and Decision 6's `DependencyInjection.Messaging.cs` anchors (`:148`, `:177`, `:179-181`, now `:159`,
   `:188`, `:188-197`). The three-entry and five-entry counts in Context and their props anchors are
   left as recorded, Decision 1 carrying the current figures, and the `using MassTransit` file count
   in Context was not recounted in this pass.

## Revision (2026-10-26)
Re-verified against current source. The library choice, the v8 pin, the major-9 ceiling, the exit
triggers and the replacement order are unchanged. What moved: every MassTransit entry took the
8.5.12 v8 patch, the build gate's list now covers all five MMCA.Common entries, and the
`using MassTransit` surface is recounted, with the swap surface restated to reach the consumer
service hosts. The earlier revisions are left as written.

1. **All seven MassTransit entries are at 8.5.12**, an ordinary v8 patch update under decision 1:
   MMCA.Common's five (`MMCA.Common/Directory.Packages.props:125-127`, `:130`, `:136`) and the two
   consumer `MassTransit.Azure.ServiceBus.Core` entries (`MMCA.ADC/Directory.Packages.props:73`,
   `MMCA.Store/Directory.Packages.props:97`). Context now states the five MMCA.Common entries and
   the seven-entry workspace count in place of the three-package and five-entry wording.
2. **The build gate covers every MMCA.Common MassTransit entry.** `MassTransitPackageIds` now names
   `MassTransit.AmazonSQS` and `MassTransit.SqlTransport.PostgreSQL` beside the original three
   (`DependencyVersionTestsBase.cs:18-25`, the two at `:23-24`; recorded in
   `MMCA.Common/CHANGELOG.md:65`, release 1.258.0), and Common's subclass still inherits the list
   (`DependencyVersionTests.cs:9`). Decision 1 and Context now say the gate covers all five; the
   2026-10-25 revision's "three gated" describes the list as it was.
3. **The `using MassTransit` surface is fifteen files, not nine**: eleven in
   `MMCA.Common.Infrastructure` (the four `Messaging/Transports/` files `IBrokerTransport.cs`,
   `BrokerTransportPolicies.cs`, `RabbitMqBrokerTransport.cs` and `PostgreSqlBrokerTransport.cs`
   among them), `AzureServiceBusTransport.cs` and `ServiceBusEmulatorSupport.cs` in
   `MMCA.Common.Azure`, `AmazonSqsTransport.cs` in `MMCA.Common.Aws`, and the
   `ServiceBusEmulatorFixtureBase` fixture. That count is MMCA.Common's own. Context and Rationale
   are corrected in place.
4. **The swap surface reaches the consumer service hosts.** `AddBrokerMessaging` takes an
   `Action<IBusRegistrationConfigurator>` (`DependencyInjection.Messaging.cs:48-50`) and
   `RegisterIntegrationEventConsumer` an `Action<IEndpointRegistrationConfigurator>`
   (`IntegrationEventConsumerExtensions.cs:60-62`); the consumer hosts pass such lambdas
   (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:269-283`,
   `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:279-301`,
   `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:303-307`), ADC's Conference host
   references MassTransit directly (`ConferenceBrokerConsumers.cs:1`, `:32-37`, wired at
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:432`), and both consumer emulator
   fixtures carry `using MassTransit` (`ServiceBusEmulatorFixture.cs:1` in each). Context, Decision 4,
   Rationale and the adapter-spike Trade-offs bullet no longer say a swap is Common-only or leaves
   consumers untouched; the `MicroserviceExtractionTestsBase` ban covers Domain, Application and
   Shared only.
5. **`Azure.Messaging.ServiceBus` 7.21.0 also serves the `MMCA.Common.Azure` Service Bus transport**,
   not only the emulator test tier (`MMCA.Common/Directory.Packages.props:137-141`). Decision 4 and
   the emulator Trade-offs bullet now say so.
6. Anchors re-verified against current source: `MassTransit_MustNotExceed_MajorVersion8` at
   `DependencyVersionTestsBase.cs:28` with `exclusiveMajorCeiling: 9` at `:34`; the props pin comment
   at `MMCA.Common/Directory.Packages.props:120-124`; `IMessageBus` resolved at
   `OutboxProcessor.cs:776`, the breaker at `:783-787`, `PublishAsync` at `:785`, the comment at
   `:778-782` and the field doc at `:103-110`; the `cross-service-freshness` gate's `required-jobs`
   at `MMCA.ADC/.github/workflows/deploy.yml:901-903` (`required-jobs-mode: same-run` at `:904`);
   and the PostgreSQL transport entry in the Trade-offs bullet at `MMCA.Common/CHANGELOG.md:86`
   (release 1.257.0). The `MMCA.Common.LayerEnforcement.targets` and `CHANGELOG.md:24` anchors
   inside the 2026-10-24 and 2026-10-25 revisions are left as written; the vendor-transport refusal
   now sits in target `EnforceCloudVendorBoundary` (`:130`, conditions at `:144-145`, error at
   `:151`).

## Related
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release policy this pin is
enforced under; its 2026-08-28 amendment first sketched exit options, and this record owns the
ordered list. ADR-016's **Transport exit options** section now defers to this record: it keeps the
surface inventory, the trial point and the proving ground, and records its OpenTransit-fork,
commercial-v9 and raw-SDK candidates only as first sketched, so where the two lists differ this
record governs),
[ADR-066](066-broker-transport-selection.md) (which broker runs where, the axis orthogonal to which
library talks to it),
[ADR-003](003-outbox-dual-dispatch.md) (the outbox this record refuses to hand to a library),
[ADR-021](021-consumer-inbox-idempotency.md) (the inbox, for the same reason),
[ADR-087](087-broker-poison-message-handling.md) (the circuit breaker around the `IMessageBus`
publish, which is the library-owned broker hop in broker mode),
[ADR-010](010-integration-event-schema-versioning.md) and
[ADR-090](090-event-upcaster-registration.md) (the contract and upcaster rules a transport swap must
not disturb),
[ADR-015](015-architecture-fitness-functions.md) (the gate the pin is enforced by).
