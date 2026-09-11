# ADR-118: Message Transport Library Policy (MassTransit v8 Pin and Exit Strategy)

## Status
Accepted (2026-09-11). Promotes the MassTransit clause inside
[ADR-016](016-lockstep-versioning-masstransit-pin.md) into a decision of its own: ADR-016 owns the
release policy that the pin is enforced under, this record owns the choice of transport library, the
conditions that end it, and the ordered list of what replaces it.

## Context
MassTransit is the only message-broker library in this workspace, and it is pinned to 8.5.10 across
all three of its packages (`MMCA.Common/Directory.Packages.props:106-108`). The pin is a policy
rather than a lag: v9 was announced in April 2025 and shipped in January 2026 as a commercial,
source-available product with a runtime licence key. A v9 bus fails its startup licence check and
every broker-enabled service host crashes, which is a failure mode a build cannot see because CI
never starts a broker. That is why the ceiling is a fitness function rather than a comment:
`MassTransit_MustNotExceed_MajorVersion8`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:25`)
parses `Directory.Packages.props` and fails the build at an exclusive major ceiling of 9 (`:31`),
and MMCA.Common subclasses it
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DependencyVersionTests.cs:9`).
A blanket package update bumped the version to 9.1.2 once before and reintroduced the crash.

A pin with no horizon is a decision that expires quietly, so the real question is not "which version"
but "what does this workspace actually owe MassTransit, and what would it cost to leave". The answer
is narrower than the usual framework-lock-in story, because the durable parts of the messaging design
are not MassTransit's:

- **The outbox is ours.** `OutboxMessage`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs`) is a
  plain EF entity holding the serialized `Payload` (`:41`) keyed by `EventType` (`:38`), with the
  claim lease (`LockedUntil` `:58`, `LockToken` `:65`), the retry counter (`:50`), the propagated
  `TraceId` / `SpanId` (`:71`, `:74`) and the optional `OrderingKey` (`:86`). None of those columns
  is a broker concept ([ADR-003](003-outbox-dual-dispatch.md)).
- **The inbox is ours.** `IInboxStore` (`.../Persistence/Inbox/IInboxStore.cs:16`), `InboxMessage`
  (keyed on `MessageId`, `.../Persistence/Inbox/InboxMessage.cs:14`) and `EfInboxStore` dedup
  redeliveries in the consumer's own database, and `TryBeginAsync`
  (`.../Persistence/Inbox/IInboxStore.cs:38`) stages the row into the handler's own unit of work
  ([ADR-021](021-consumer-inbox-idempotency.md)). A broker supplies the redelivery; nothing else here
  is the broker's.
- **The publish and consume leg is the only part MassTransit owns.** `OutboxProcessor` resolves
  `IMessageBus` per scope
  (`.../Persistence/Outbox/Processing/OutboxProcessor.cs:272`) and routes every integration event
  through it (`:589`), and only the broker hop is wrapped in the circuit breaker
  ([ADR-087](087-broker-poison-message-handling.md)).

The abstractions that stand between application code and the library are already in place and are
this workspace's own types: `IMessageBus`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:28`) and `IEventBus`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventBus.cs:11`). `BrokerMessageBus`
implements the first over a MassTransit `IPublishEndpoint`
(`.../Infrastructure/Messaging/BrokerMessageBus.cs:24`); `BrokerEventBus` implements the second and
does not reference MassTransit at all (`.../Infrastructure/Messaging/BrokerEventBus.cs:31`), because
in broker mode its whole job is to write the outbox row and signal the processor. The whole
`using MassTransit` surface is **eight files**: seven inside `MMCA.Common.Infrastructure`
(`DependencyInjection.cs`, `Messaging/BrokerMessageBus.cs`, `Messaging/ServiceBusEmulatorSupport.cs`
and the four consumer files under `Messaging/Consumers/`) plus the emulator test fixture
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/ServiceBusEmulatorFixtureBase.cs`. Domain,
Application and Shared hold the interfaces alone, and that is build-gated:
`MicroserviceExtractionTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/MicroserviceExtractionTestsBase.cs:13`)
bans MassTransit, gRPC and Protobuf outside API and Infrastructure in every repo.

The comparison landscape is also public rather than internal: the August 2025 Visual Studio Magazine
article "Messaging Made Simple: Choosing the Right Framework for .NET" surveys the same shift, and
the two candidates below are the ones that survive this workspace's constraints.

## Decision
**Stay on MassTransit v8 behind `IMessageBus`, and keep the outbox and inbox custom precisely because
that is what keeps a transport swap cheap. Record the exit triggers now, and the replacement order,
so the pin is a dated decision rather than an open-ended hold.**

1. **The pin stands and stays build-gated.** MassTransit remains at 8.5.10 on all three packages, and
   `DependencyVersionTestsBase` remains the enforcement point. The ceiling is the major version only:
   v8 patch and minor updates are ordinary dependency work.

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
   `IMessageBus` and neither touches a consumer:
   - **First: Wolverine** (Apache 2.0). Message handling is plain methods rather than a consumer
     class per message, and its transports cover the two this workspace runs (RabbitMQ, Azure Service
     Bus) plus SQS and Kafka. Its own durable-inbox and outbox features would be left off, because
     decision 2 already owns that layer.
   - **Second: a raw-SDK adapter.** `RabbitMQ.Client` plus `Azure.Messaging.ServiceBus`, the latter
     already pinned at 7.20.2 for the Service Bus emulator test tier
     (`MMCA.Common/Directory.Packages.props:113`). This is the floor option: no third-party
     abstraction at all, at the cost of hand-writing consumer dispatch, retry and delayed redelivery.

5. **Two options are rejected outright, and recorded so they are not re-proposed.**
   - **MassTransit v9.** Commercial with a runtime licence key. Buying it retires the gate rather
     than answering it, at a recurring cost, and leaves the transport decision where it is today.
   - **MediatR.** Not used anywhere in this workspace (the CQRS pipeline is the framework's own
     `ICommandHandler` / `IQueryHandler` chain, [ADR-014](014-cqrs-decorator-pipeline.md)), and
     commercial since 2025 for the same reason. It is named here only because it is the library most
     often suggested in the same breath, and it would be a new dependency rather than a replacement.

6. **A trial ships beside the incumbent.** The trial point is an additive arm in the
   `MessageBusProvider` switch inside `ConfigureBrokerTransport`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:1189`, beside the
   RabbitMQ arm at `:1196` and the Azure Service Bus arm at `:1226`), so a candidate is exercised by
   configuration without removing anything, and ADC's advisory nightly Service Bus emulator smoke is
   where it runs first.

## Rationale
- **The pin is enforceable, so it is honest.** A comment beside a version number is a hope; a fitness
  function that parses `Directory.Packages.props` is the reason the v9 crash was reintroduced exactly
  once. Making the ceiling a build gate is the same invariant-over-discipline posture as the layer
  rules ([ADR-015](015-architecture-fitness-functions.md)).
- **Custom durable machinery is what makes the transport replaceable.** A library that owned the
  outbox would own the lease semantics, the ordering guarantee, the dead-letter retention window and
  the replay API, and every one of those would have to be re-earned against a new library's model.
  Owning them means a swap is a publish-and-consume adapter, which is the eight-file surface above.
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
- **An adapter spike is a Common-only change.** No consumer handler, module or contract changes, and
  no consumer repo gains a dependency, because the candidate ships behind `IMessageBus` and the ban
  in `MicroserviceExtractionTestsBase` already guarantees no consumer references the library. The
  cost lands in one package and one release, swept under
  [ADR-016](016-lockstep-versioning-masstransit-pin.md)'s lockstep policy.
- **The emulator test tier is coupled to the choice.** `ServiceBusEmulatorFixtureBase` uses the
  MassTransit v8 custom-clients `Host()` overload, so a transport swap re-writes that fixture and
  re-checks the `Azure.Messaging.ServiceBus` 7.20.2 pin it exists for.
- **Ordering the candidates without running them is deliberate but partial.** The list narrows what a
  spike has to evaluate; it does not stand in for the spike.

## Related
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release policy this pin is
enforced under; its 2026-08-28 amendment first sketched exit options, and this record takes ownership
of that list),
[ADR-066](066-broker-transport-selection.md) (which broker runs where, the axis orthogonal to which
library talks to it),
[ADR-003](003-outbox-dual-dispatch.md) (the outbox this record refuses to hand to a library),
[ADR-021](021-consumer-inbox-idempotency.md) (the inbox, for the same reason),
[ADR-087](087-broker-poison-message-handling.md) (the circuit breaker on the one leg the library
owns),
[ADR-010](010-integration-event-schema-versioning.md) and
[ADR-090](090-event-upcaster-registration.md) (the contract and upcaster rules a transport swap must
not disturb),
[ADR-015](015-architecture-fitness-functions.md) (the gate the pin is enforced by).
