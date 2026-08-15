# 4. Domain & Integration Events + Outbox Dual-Dispatch

**What this chapter covers.** This group is the codebase's *event spine*: how an aggregate says
"something happened", how that fact is persisted so it cannot be lost, and how it eventually reaches
every interested handler, whether that handler lives in the same process or in an extracted
microservice across a broker. Two questions drive the whole design. *How do we publish events
reliably when persistence and dispatch are separate steps that can each fail independently?* And *how
do we keep application code identical whether a module ships inside the monolith or as its own
service?* The answer to the first is the **transactional outbox** with an at-least-once background
drainer ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)); the answer to the second is a **transport-agnostic message bus** plus a
consumer-side **inbox** ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html), [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)). The types here implement both, top to bottom:
the event contracts, the in-process dispatcher, the outbox and inbox tables and their background
services, and the swappable in-process/broker buses.

If you have not yet met the **Result pattern**, **aggregate roots and domain events**, or the
**database-per-service** rule, skim [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)
first: this chapter builds directly on them.

## The two kinds of event

Everything starts with two marker interfaces in the Domain layer. [`IDomainEvent`](#idomainevent) is
the base contract: a `DateOccurred` timestamp (when the *business* action happened, not when it was
dispatched, `MMCA.Common.Domain/Interfaces/IDomainEvent.cs:10`) and a `MessageId` GUID used for
consumer-side deduplication (`MMCA.Common.Domain/Interfaces/IDomainEvent.cs:13`).
[`IIntegrationEvent`](#iintegrationevent) *extends* `IDomainEvent` and adds no members
(`MMCA.Common.Domain/Interfaces/IIntegrationEvent.cs:15`): it is a pure role marker. The distinction
is semantic and load-bearing. A **domain event** is *intra-module* (raised and handled inside one
bounded context); an **integration event** is *inter-module* (one module publishes, others react,
for example Identity's `UserRegistered` consumed by another module). Because integration events *are*
domain events, they ride the exact same outbox machinery; the system never needs a second capture
pipeline. What differs is only how they are *delivered* after capture, which the routing rules below
make precise.

The base records supply the defaults. [`BaseDomainEvent`](#basedomainevent) stamps `DateOccurred` at
construction (`MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:28`) and mints a fresh `MessageId`
(`MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:35`), both `init` so a deserialized event keeps
the values it was created with. Its remarks call out the trap that follows from being a `record`:
structural equality is *not* a deduplication mechanism, because those two defaults differ per
instance, so two logically identical events are never equal (`BaseDomainEvent.cs:10-16`). Dedup is
the inbox's job, keyed on `MessageId`. [`BaseIntegrationEvent`](#baseintegrationevent) adds a
`virtual SchemaVersion` defaulting to `1` (`MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:22`):
additive field changes keep the version, but a breaking change (a renamed, removed, or retyped field)
requires a NEW event type plus a consumer-side upcaster, never a silent reshape of an existing
contract ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)). [`EntityChangedEvent<TIdentifierType>`](#entitychangedeventtidentifiertype) is a
reusable CRUD-lifecycle event carrying a
[`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Added/Updated/Deleted)
and the affected `EntityId` (`MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24-27`), so
entities do not each hand-roll three near-identical event records. This split (markers and base
records in `Domain`, all dispatch and persistence machinery in `Application`/`Infrastructure`) is
textbook `[Rubric §3, Clean Architecture]` (the domain declares *what* an event is; outer layers
decide *how* it travels) and `[Rubric §6, CQRS & Event-Driven]` (an explicit, first-class event model
rather than implicit side effects). The `SchemaVersion` convention is the
`[Rubric §9, API & Contract Design]` angle: an event on the wire is a versioned contract like any
API surface.

## Raising and capturing: where the outbox is written

Aggregates raise events by calling `AddDomainEvent()` (see
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
in G02), which simply buffers them on the entity. Nothing is dispatched yet; the events ride along
until the next save. The actual capture happens in EF Core's save pipeline, in
[`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
(G07). On `SavingChanges` it snapshots the change tracker's aggregate roots that have buffered events
and calls [`OutboxMessage.FromDomainEvent(...)`](#outboxmessage) on each, serializing the event to
JSON, capturing its assembly-qualified type name and the current W3C trace/span IDs
(`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:74-88`), and `Add`s those
[`OutboxMessage`](#outboxmessage) rows to the *same* `DbContext`, so the outbox row and the aggregate
change land in **one atomic transaction**
(`MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:184-248`).
This is the single most important guarantee in the chapter: if the business data committed, the event
is durably recorded; if the transaction rolled back, neither exists. There is no window where they
disagree. `[Rubric §8, Data Architecture]` (transactional integrity) and `[Rubric §6]` both hinge on
this atomicity. Crucially, the rows go to the same physical database as the aggregate: every
relational source owns its own `OutboxMessages` table, never a shared one ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html); the table and
its two filtered indexes are configured in
`MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:297-321`; see the
[primer on database-per-service](00-primer.md#2-architectural-styles-this-codebase-commits-to)).

Two details of the capture are worth carrying forward, because both exist to stop *duplicate* rows.
The interceptor snapshots exactly the events it captured and removes exactly those again after
dispatch, so anything a handler raises mid-dispatch survives to a later capture instead of being
wiped (`DomainEventSaveChangesInterceptor.cs:331-341`). And a save that started but never completed
(a failed save followed by an execution-strategy retry) has its still-Added outbox rows detached
before the next capture, so the retry does not write a second row per event
(`DomainEventSaveChangesInterceptor.cs:255-272`).

## The routing split: local events dispatch in-process, integration events wait for the bus

Here is the detail that most people get wrong, and it is the heart of the design. After the
transaction commits (`SavedChanges`), the interceptor does **not** treat all captured events the
same. Pure **domain** events (the *local* events) are dispatched in-process through
[`IDomainEventDispatcher`](#idomaineventdispatcher) and their outbox rows are then marked processed.
**Integration** events are deliberately *not* dispatched in-process at all: their outbox rows stay
unprocessed, and the background [`OutboxProcessor`](#outboxprocessor) later publishes them through
[`IMessageBus`](#imessagebus), so the registered transport (in-process for the monolith, broker for
an extracted service) decides delivery
(`DomainEventSaveChangesInterceptor.cs:213-238,301-329`). That routing is what makes
`AddDomainEvent(someIntegrationEvent)` broker-correct: before it existed, such an event would be
dispatched locally and marked processed, silently never reaching the wire. On a context with no
outbox table (Cosmos), the interceptor falls back to dispatching *everything* in-process, since
nothing could carry integration events to a bus anyway
(`DomainEventSaveChangesInterceptor.cs:239-244`). One more subtlety: when the save runs inside a
Transactional command's transaction, all this post-save work is *deferred until after commit*
(`DomainEventSaveChangesInterceptor.cs:285-292`), flushed by
[`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) once the commit succeeds and
dropped on rollback (`DomainEventSaveChangesInterceptor.cs:128-145`), so handler side effects never
act on state that could still roll back.

The mark-processed step is not a second nested `SaveChanges`. It goes through
[`OutboxFinalizer`](#outboxfinalizer), which stamps every row in the batch with a single set-based
`ExecuteUpdate` and then re-syncs the change tracker so a later save does not re-issue the statement
(`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxFinalizer.cs:21-48`), keeping the hottest write
path (every event-raising command) free of an extra full save. The dispatcher itself
([`DomainEventDispatcher`](#domaineventdispatcher)) is a small, performance-conscious piece of
machinery. For each event it resolves every registered
[`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent) and, if the event is
also an integration event, every
[`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
(`MMCA.Common.Application/Services/DomainEventDispatcher.cs:35-45`), invoking each through a
**compiled expression-tree delegate cached per (event type, handler interface)** so the generic
`HandleAsync` call avoids reflection and boxing at runtime
(`MMCA.Common.Application/Services/DomainEventDispatcher.cs:26-28,76-96`), relevant to
`[Rubric §12, Performance & Scalability]`.

Handlers that perform side effects (email, downstream writes) should derive from
[`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent), and its contract is
the opposite of what the name suggests: it logs the failure with handler and event context and then
lets the exception **propagate unchanged**, through an exception filter so the log write precedes any
unwinding and the stack trace stays intact
(`MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:36-47,61-70`). Swallowing was the
older behavior and it made the "the outbox will retry it" promise false: a handler that reported
success got its outbox row marked processed, so nothing ever retried and the side effect was lost
(`SafeDomainEventHandler.cs:13-20`). The consequence to design for is **batch** redelivery: the
interceptor dispatches every local event of one save in a single call, so one rethrowing handler
skips the mark-processed step for that whole local batch and the processor redelivers all of them,
not just the event that failed (`SafeDomainEventHandler.cs:21-29`). Subclasses must therefore be
idempotent about their own event *and* about every sibling event raised by the same save.

## The safety net: how the processor schedules itself

The [`OutboxProcessor`](#outboxprocessor) is a `BackgroundService` and the most intricate type in the
group; most of its complexity is about **not** wasting work. It exists because the steps between
*commit* and *mark-processed* can be interrupted: the process can crash, or in-process dispatch can
throw. When that happens the row stays unprocessed (and the interceptor signals the processor on its
failure path, `DomainEventSaveChangesInterceptor.cs:315-323`) and the processor catches it on a later
cycle. This is the **at-least-once** guarantee of [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html). Its unavoidable cost is that the *same*
event may be delivered more than once, so **handlers must be idempotent**. That is not a wart; it is
the documented contract and a healthy discipline regardless.

The processor never blindly polls on a fixed clock. After a five second startup delay
(`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:81`) it drains every relational
source's outbox once per cycle and aggregates the per-source results into an
[`OutboxCycleResult`](#outboxcycleresult) (`OutboxProcessor.cs:175-213`), then waits on
[`IOutboxSignal`](#ioutboxsignal) for whichever comes first: a **signal** (a writer called `Signal()`
after persisting a row; [`OutboxSignal`](#outboxsignal) is a `SemaphoreSlim(0, 1)` wrapper whose
single-permit cap deliberately absorbs a burst of surplus signals, since one batch drains everything
anyway, `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxSignal.cs:17-30`), the moment the
earliest pending-but-not-yet-eligible row *becomes* eligible (the **smart wait**), or a fallback
`PollingIntervalSeconds` (`OutboxProcessor.cs:106-120`, arithmetic in `ComputeWaitTime` at
`OutboxProcessor.cs:131-149` with a one second floor so an overdue row cannot hot-loop the service,
`OutboxProcessor.cs:66`). Rows are only eligible `ProcessingDelaySeconds` (default 5s,
[`OutboxSettings`](group-14-module-system-composition.md#outboxsettings), `OutboxSettings.cs:40`)
after creation, split off the fetched batch by an ordered prefix scan
(`OutboxProcessor.cs:240-245`). That delay is deliberate: it gives the in-process happy path time to
mark local rows processed before the processor would re-deliver them, bounding the duplicate-delivery
window. The smart wait means that even when the fallback interval is set high in a deployed
environment (300s, to cut idle DB chatter and telemetry cost, `OutboxSettings.cs:23-31`), an event
still goes out about 5s after it was written. Batches are 50 rows (`OutboxSettings.cs:17`). One
unreachable database cannot starve the others: each source is drained inside its own try/catch and a
failing source simply contributes nothing to this cycle (`OutboxProcessor.cs:195-206`).

Because a deployment may run more than one replica, each cycle **claims** its eligible prefix with a
lease (`LockedUntil` + `LockToken`,
`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:45-58`) via a conditional
`ExecuteUpdate` before dispatching (`OutboxProcessor.cs:390-425`), and the poll query skips rows
under an unexpired lease (`OutboxProcessor.cs:372-380`). Two replicas therefore can never
double-dispatch the same row, and a replica that dies mid-batch releases its rows when the lease
expires (`LeaseSeconds`, default 300, `OutboxSettings.cs:82`). That is scale-out safety by
construction, not merely by the `minReplicas: 1` deployment convention. Graceful shutdown gets the
same care: a cancellation landing mid-batch would otherwise strand the `ProcessedOn` stamps in the
change tracker and redeliver already-delivered messages when the lease expired, so the processor
flushes those stamps on the way out under a five second budget
(`OutboxProcessor.cs:269-279,340-352`).

## Failures, dead-letters, and keeping the table (and telemetry) bounded

Delivery failures split into two very different outcomes, worth keeping straight. A *transient*
failure (a handler or broker publish throwing) increments the row's `RetryCount`, records
`LastError`, and **re-leases** the row for an explicit exponential backoff rather than leaving this
cycle's claim on it (`OutboxProcessor.cs:495-526`). The backoff is
`RetryBackoffBaseSeconds * 2^(n-1)` (base 10s, `OutboxSettings.cs:99`) multiplied by a random jitter
factor in `[0.8, 1.2]` and capped at the lease (`OutboxProcessor.cs:539-553`); the jitter is what
stops fifty rows that failed together on one dependency outage from retrying in lockstep against that
same dependency. The poll query only ever selects rows with `RetryCount < MaxRetries` (5 by default,
`OutboxProcessor.cs:374`, `OutboxSettings.cs:21`), so once a row exhausts its retries it stops being
fetched, stalls unprocessed with its last error, and is counted on the `outbox.dead_letter.count`
counter with `reason=retries_exhausted` plus one loud `Error` log line at the moment of exhaustion
(`OutboxProcessor.cs:511-521`). The *other* outcome is a hard **dead-letter**: a row whose stored
`EventType` can no longer be resolved to a CLR type (deserialize returns null) is marked processed
immediately, tagged with a `LastError`, and counted with `reason=type_unresolvable`
(`OutboxProcessor.cs:445-457`), so an undeliverable payload cannot block the queue behind it.

The instruments themselves live in [`OutboxMetrics`](#outboxmetrics), a single OpenTelemetry meter
named `MMCA.Common.Outbox` carrying the dead-letter counter
(`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMetrics.cs:32-35`), a success counter
(`OutboxMetrics.cs:38-41`), an end-to-end **delivery lag** histogram in seconds, the number that
answers "how far behind is eventual consistency right now" (`OutboxMetrics.cs:48-51`, recorded and
clamped against clock skew at `OutboxProcessor.cs:481-483`), and an observable **backlog depth**
gauge (`OutboxMetrics.cs:66-70`). That gauge is per instance, not fleet-wide, and is derived from the
fetch wherever it can be: a short batch *is* the whole backlog, so only a saturated batch pays for a
`COUNT` (`OutboxProcessor.cs:304-325`). This is dense `[Rubric §13, Observability & Operability]` and
`[Rubric §31, Cost/FinOps]` territory: both the poll and that count run inside a named `OutboxPoll`
activity (`OutboxProcessor.cs:63,316,369`) which
[`OutboxPollFilterProcessor`](group-16-aspire-orchestration.md#outboxpollfilterprocessor) (G16)
suppresses from telemetry export, so a fleet of idle services polling around the clock does not flood
Application Insights, and the per-message success line is `Debug` for the same reason
(`OutboxProcessor.cs:599-603`).

A sibling [`OutboxCleanupService`](#outboxcleanupservice) keeps the tables bounded. Every
`CleanupIntervalHours` (default 6, `OutboxSettings.cs:73`) it purges processed rows older than
`RetentionDays` (default 7, `OutboxCleanupService.cs:92-95`, `OutboxSettings.cs:65`), then purges
*dead-lettered* rows on their own `DeadLetterRetentionDays` window keyed on `OccurredOn`, since those
rows never get a `ProcessedOn` and would otherwise accumulate forever inside the pending index that
every poll re-scans (`OutboxCleanupService.cs:111-127`, `OutboxSettings.cs:101-108`). When the inbox
is enabled it purges processed inbox rows on the same cutoff (`OutboxCleanupService.cs:146-161`).
Setting `RetentionDays` to `0` disables the sweep entirely (`OutboxCleanupService.cs:51-55`). Because
payloads may contain personal data, this sweep is also part of the privacy posture of
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html). Both background services take an optional `TimeProvider` (`OutboxProcessor.cs:43-44,55`,
`OutboxCleanupService.cs:33-34,46`) so tests can drive an hour-scale loop deterministically instead of
waiting on wall-clock time, a small but real `[Rubric §14, Testability]` win.

## The pluggable transport: in-process versus broker

Here is the boundary that makes a module extractable without rewriting its handlers. Application code
that wants to publish an integration event depends on [`IEventBus`](#ieventbus) (or on the lower-level
[`IMessageBus`](#imessagebus), both defined in `Application`, so neither ever sees MassTransit).
Infrastructure supplies two interchangeable implementations of each, selected by registration:

- **Monolith mode** (the defaults, `MMCA.Common.Infrastructure/DependencyInjection.cs:225,231`).
  [`InProcessEventBus`](#inprocesseventbus) writes the events to the outbox in one save, dispatches
  them in-process, and marks them processed through the same [`OutboxFinalizer`](#outboxfinalizer)
  path as the interceptor (`MMCA.Common.Infrastructure/Services/InProcessEventBus.cs:55-78`), falling
  back to a plain dispatch on a context with no outbox support (`InProcessEventBus.cs:60-64`).
  [`InProcessMessageBus`](#inprocessmessagebus) just hands the event straight to the dispatcher
  (`MMCA.Common.Infrastructure/Services/InProcessMessageBus.cs:22-33`); it is what the
  `OutboxProcessor` calls when draining an integration-event row in monolith mode.
- **Broker mode** (`AddBrokerMessaging`, which *replaces* both registrations,
  `DependencyInjection.cs:438,444`). [`BrokerEventBus`](#brokereventbus) writes the whole batch to the
  outbox in ONE save and then **signals the processor without dispatching in-process**
  (`MMCA.Common.Infrastructure/Services/BrokerEventBus.cs:64-90`), because the consumers live in other
  processes, so an in-process dispatch would be wrong; a data source with no outbox support throws
  loudly here rather than silently dropping events (`BrokerEventBus.cs:69-76`). The
  `OutboxProcessor` then drains the row and publishes it through [`BrokerMessageBus`](#brokermessagebus),
  which hands it to MassTransit using the event's **runtime** type so routing binds to the concrete
  event class rather than the `IIntegrationEvent` base interface
  (`MMCA.Common.Infrastructure/Services/BrokerMessageBus.cs:27-34`) for RabbitMQ (dev) or Azure
  Service Bus (prod). MassTransit propagates the trace context across the broker hop, so distributed
  traces stay connected (`BrokerMessageBus.cs:18-22`).

The selection between these is a pure DI swap: no application or domain code changes. That is the
whole point of `[Rubric §7, Microservices Readiness]`: transport choices live at the edges, and the
NetArchTest transport-boundary rule forbids `Application`/`Domain`/`Shared` from referencing
MassTransit at all
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:6`,
[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/008). Note the deliberate division of labor: the **`*EventBus`** types own *outbox
persistence* (write and signal); the **`*MessageBus`** types own *delivery only* and are invoked by
the processor when draining already-persisted rows.

## Consuming from the broker: the inbox and the generic consumer

On the receiving side of a broker hop, application code keeps writing plain
`IIntegrationEventHandler<TEvent>` implementations; there is no MassTransit-specific consumer class to
author per event. The generic [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) is
the single adapter that bridges MassTransit's `IConsumer<TEvent>` to all the registered in-process
handlers (`MMCA.Common.Infrastructure/Services/IntegrationEventConsumer.cs:33-79`), registered per
event type via [`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions)'s
`RegisterIntegrationEventConsumer<TEvent>()`, an `extension(IBusRegistrationConfigurator)` block that
is a one-line `AddConsumer` wrapper
(`MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs:13-28`). A handler that
throws is logged with the failing handler's type and rethrown so MassTransit's configured retry
policy runs before the message is dead-lettered (`IntegrationEventConsumer.cs:57-65`), and a message
with no registered handler in this process is acked with a log line rather than being retried forever
(`IntegrationEventConsumer.cs:68-74`).

Because broker delivery is *also* at-least-once, the consumer guards against duplicates with the
**inbox** ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)): [`IInboxStore`](#iinboxstore)'s `AlreadyProcessedAsync` is checked before
invoking handlers, and `MarkProcessedAsync` is written *after* they all succeed, recording the event's
`MessageId` in an [`InboxMessage`](#inboxmessage) row (`IntegrationEventConsumer.cs:42-46,76-78`).
When the inbox is disabled the no-op [`NoOpInboxStore`](#noopinboxstore) is registered so behavior is
unchanged (`MMCA.Common.Infrastructure/Persistence/Inbox/NoOpInboxStore.cs:9-13`,
`DependencyInjection.cs:454`); when enabled (`MessageBus:EnableInbox=true`,
`DependencyInjection.cs:448-450`), [`EfInboxStore`](#efinboxstore) persists dedup records to the
consumer service's own database, relying on a unique index on `MessageId`
(`ApplicationDbContext.cs:334-336`) to shrug off a concurrent duplicate insert: the
`DbUpdateException` is treated as "already processed" and the rejected row is detached so a later save
on the same scope does not re-attempt it
(`MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:25-62`). Recording happens after
handlers succeed on purpose, so a handler failure leaves the message un-recorded and eligible for
MassTransit's retry/dead-letter policy; the price is that a crash between the handler's commit and
the inbox write reprocesses once (`EfInboxStore.cs:11-17`). The outbox is the *producer-side*
idempotency mechanism; the inbox is its *consumer-side* mirror. Together they make the cross-service
event flow effectively-once on top of at-least-once transport (`[Rubric §6]`,
`[Rubric §29, Resilience & Business Continuity]`).

## Putting it together, one event's life

To see the whole spine at once, follow a single integration event from a producer service to a
consumer service in **broker mode**. (1) A command mutates an aggregate, which raises an integration
event via `AddDomainEvent(...)`; the interceptor captures it into an [`OutboxMessage`](#outboxmessage)
in the same transaction and, because it is an integration event, deliberately does *not* dispatch it
in-process, it only signals the processor. (2) Once the row is eligible (after `ProcessingDelaySeconds`),
the [`OutboxProcessor`](#outboxprocessor) claims it under a lease, deserializes it, sees it is an
[`IIntegrationEvent`](#iintegrationevent), and publishes it through [`IMessageBus`](#imessagebus),
which in broker mode is [`BrokerMessageBus`](#brokermessagebus) to MassTransit to the broker, then
stamps the row processed and records its delivery lag on [`OutboxMetrics`](#outboxmetrics). (3) In the
consumer service, [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) receives it,
asks the [`IInboxStore`](#iinboxstore) whether that `MessageId` was already handled, runs every
`IIntegrationEventHandler<TEvent>`, and records the `MessageId` so a redelivery is skipped. (4) Back
on the producer, [`OutboxCleanupService`](#outboxcleanupservice) eventually purges the processed row.
In monolith mode steps 2 and 3 collapse: the registered [`IMessageBus`](#imessagebus) is
[`InProcessMessageBus`](#inprocessmessagebus), which hands the event to the same
[`DomainEventDispatcher`](#domaineventdispatcher) that local events already flow through, and
application code that publishes directly can use [`InProcessEventBus`](#inprocesseventbus) to write,
dispatch, and finalize in one call. The *contracts the application code touches never change*, which
is exactly the property that lets a module graduate to its own service without a rewrite ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
For the mechanics of *why* each design choice was made, [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) (outbox and at-least-once), [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)
(per-service outbox), [ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) (event versioning), [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html) (consumer inbox), and [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/008
(transport at the edge) are the primary references.

### IDomainEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IDomainEvent.cs:7` · Level 0 · interface

- **What it is**: the marker contract for **domain events**: something meaningful happened inside an
  aggregate boundary, to be dispatched after successful persistence.
- **Depends on**: nothing first-party (BCL `DateTime`/`Guid` only).
- **Concept introduced, domain events + idempotency keys.** `[Rubric §6, CQRS & Event-Driven]`
  (assesses reliable events, idempotent consumers, and events carrying enough context) and
  `[Rubric §4, DDD]` (aggregates raise events on state change). An aggregate does not call other
  modules directly; it *records* that something happened (for example "SessionScored") as an
  `IDomainEvent`, and the framework dispatches it after the data is safely saved, the basis of the
  **Outbox pattern** ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
- **Walkthrough**: two properties, and the whole file is 14 lines. `DateOccurred`
  (`IDomainEvent.cs:10`) is *when the business action happened*, not when it was dispatched, and the
  XML doc says exactly that. `MessageId` (a `Guid`, `IDomainEvent.cs:13`) is a unique per-instance id
  used for **consumer-side idempotency** (inbox dedup), so a redelivered event is processed once.
  That `MessageId` is what makes consumers safe under at-least-once delivery: it is minted at event
  creation by [`BaseDomainEvent`](#basedomainevent), survives outbox serialization inside the JSON
  payload, travels through the broker, and lands in an [`InboxMessage`](#inboxmessage) as the dedup
  key ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).
- **Why it's built this way**: a minimal marker keeps the domain free of dispatch mechanics, and the
  two members are exactly what the outbox/inbox machinery needs (ordering and eligibility by
  occurrence time, dedup by id). Note what is *not* here: no `Version`, no routing key, no transport
  metadata. Those live one layer out, on [`OutboxMessage`](#outboxmessage).
- **Where it's used**: implemented by concrete domain events in each module; raised by
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (G02), captured from aggregates during `SaveChangesAsync`, serialized into an
  [`OutboxMessage`](#outboxmessage) by `OutboxMessage.FromDomainEvent`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:74`), and
  dispatched by [`IDomainEventDispatcher`](#idomaineventdispatcher) or the
  [`OutboxProcessor`](#outboxprocessor).

### IInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/IInboxStore.cs:9` · Level 0 · interface

- **What it is**: the consumer-side idempotency port. It lets a broker consumer detect and skip an
  integration event that this service has already processed, guarding against at-least-once
  redelivery.
- **Depends on**: nothing first-party (BCL `Guid`/`Task`). Conceptually keyed by
  [`IDomainEvent`](#idomainevent)'s `MessageId`, and backed by [`InboxMessage`](#inboxmessage) rows in
  the EF implementation.
- **Concept introduced, the consumer-side Inbox ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).** `[Rubric §6, CQRS & Event-Driven]`
  (idempotent consumers) and `[Rubric §29, Resilience & Business Continuity]` (assesses tolerance of
  duplicate or redelivered messages). The *inbox* is the consumer-side complement to the *outbox*.
  Every reliable broker guarantees **at-least-once** delivery, so the same message can arrive more
  than once after a transient failure. The inbox records the message ids it has successfully
  processed; on redelivery `AlreadyProcessedAsync` returns `true` and the consumer discards the
  duplicate without re-running side effects. The default registration is a **no-op**
  ([`NoOpInboxStore`](#noopinboxstore)); the EF-backed [`EfInboxStore`](#efinboxstore) is registered
  only when `MessageBus:EnableInbox=true`, which the interface's own doc comment states
  (`IInboxStore.cs:6-7`) and `AddBrokerMessaging` implements
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:684-693`).
- **Walkthrough**: two async members. `AlreadyProcessedAsync(Guid messageId, CancellationToken)`
  (`IInboxStore.cs:12`) is a keyed lookup by the event's `MessageId`. `MarkProcessedAsync(Guid
  messageId, string eventType, CancellationToken)` (`IInboxStore.cs:15`) records the processed id plus
  the type name, which is retained purely for diagnostics.
- **Why it's built this way**: the port lets the no-op and EF-backed implementations be swapped by
  configuration without touching consumer code, a §6/§10 dependency-inversion win.
  **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** records this opt-in inbox as the broker-consume sibling of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)'s outbox (producer side) and [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)'s HTTP-edge idempotency, deduping broker
  redeliveries by `MessageId` in the consumer's own database with a unique index as the race guard.
- **Where it's used**: consumed by [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  (this group), which takes it as a primary-constructor parameter
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/IntegrationEventConsumer.cs:28`),
  checks `AlreadyProcessedAsync` before invoking handlers (`IntegrationEventConsumer.cs:42`) and calls
  `MarkProcessedAsync` only after they all succeed (`IntegrationEventConsumer.cs:78`). Implemented by
  [`EfInboxStore`](#efinboxstore) (Level 8) and [`NoOpInboxStore`](#noopinboxstore) (Level 1).
- **Caveats / not-in-source**: both registrations live inside `AddBrokerMessaging`, which returns
  early when the configured provider is in-process (`DependencyInjection.cs:656-659`), so a
  monolith host that never calls it has no `IInboxStore` in the container at all. That is consistent
  (nothing consumes the port without a broker consumer) but it does mean the no-op default is a
  *broker-mode* default, not a container-wide one.

### InboxMessage
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/InboxMessage.cs:8` · Level 0 · class (public sealed)

- **What it is**: a deduplication record saying "this service already processed the integration event
  with this `MessageId`". It is an EF entity that lives in the consumer service's *own* database,
  mirroring the outbox.
- **Depends on**: nothing first-party (BCL only). Its `MessageId` carries
  [`IDomainEvent`](#idomainevent)'s id semantics, and it is read and written through
  [`IInboxStore`](#iinboxstore).
- **Concept introduced, the inbox row (idempotency table).** `[Rubric §6, CQRS & Event-Driven]`
  (idempotent consumers) and `[Rubric §8, Data Architecture]` (a deliberate dedup table per service).
  Before processing an integration event, [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  asks [`IInboxStore.AlreadyProcessedAsync`](#iinboxstore); after a successful handle it calls
  `MarkProcessedAsync`, which inserts one of these rows. Because the table lives in the consumer's own
  database, the dedup respects the database-per-service boundary ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Walkthrough**: four `init`-only properties (`InboxMessage.cs:11-20`). `Id` (surrogate `Guid` PK
  defaulted to `Guid.NewGuid()`, `InboxMessage.cs:11`) is the EF key. `MessageId` (`required`,
  `InboxMessage.cs:14`) is the event's own id, the **deduplication key**. `EventType` (`required`,
  `InboxMessage.cs:17`) is retained for diagnostics. `ProcessedOn` (`InboxMessage.cs:20`) is the UTC
  timestamp stamped at mark time. The shape only makes sense together with its EF configuration
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:514-528`):
  the table is `dbo.InboxMessages` (`ApplicationDbContext.cs:517`), `EventType` is capped at 500
  non-Unicode characters (`ApplicationDbContext.cs:519`), `MessageId` carries a **unique** index named
  `IX_InboxMessages_MessageId` (`ApplicationDbContext.cs:520-522`), and `ProcessedOn` carries a
  second, non-unique index (`ApplicationDbContext.cs:526-527`) purely so the age-based retention purge
  has something to seek instead of scanning the table (the comment at `ApplicationDbContext.cs:524-525`
  says so outright).
- **Why it's built this way**: separating `Id` (the PK for EF internals) from `MessageId` (the
  business dedup key with the unique index) follows the surrogate-key convention used elsewhere in the
  codebase, and the unique index is what turns a racing duplicate delivery into a catchable
  `DbUpdateException` rather than a read-then-write race. Storing it as a plain entity lets the same EF
  stack purge it (see [`OutboxCleanupService`](#outboxcleanupservice)).
  **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** governs the mechanism, and the row lives in the consumer's own database
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: written and read by [`EfInboxStore`](#efinboxstore)
  (`EfInboxStore.cs:28,38`); purged by [`OutboxCleanupService`](#outboxcleanupservice) when the inbox
  is enabled (`OutboxCleanupService.cs:160-175`); configured on every relational context by
  `ApplicationDbContext.ConfigureInbox` (G07).
- **Caveats / not-in-source**: the type itself has **no** first-party reference (it is a plain POCO),
  so the links to `IInboxStore`/`IDomainEvent` above are conceptual, not compile dependencies. There is
  also no tenant column: a tenant with its own database gets its own `InboxMessages` table instead (see
  [`OutboxCleanupService`](#outboxcleanupservice)).

### IOutboxSignal
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/IOutboxSignal.cs:8` · Level 0 · interface

- **What it is**: a wake-up signal between the producer (the code that commits outbox rows) and the
  [`OutboxProcessor`](#outboxprocessor) background service, so the processor wakes the instant new rows
  are written instead of sleeping out a fixed polling interval.
- **Depends on**: nothing first-party (BCL `TimeSpan`/`Task`). Implemented by
  [`OutboxSignal`](#outboxsignal), a `SemaphoreSlim` wrapper.
- **Concept introduced, event-driven wake versus fixed polling.** `[Rubric §12, Performance &
  Scalability]` (assesses latency under load), `[Rubric §29, Resilience]`, and `[Rubric §31, Cost
  Efficiency / FinOps]` (assesses idle resource burn). Without a signal the processor would poll on a
  fixed schedule, and deployed environments deliberately set that fallback high to cut idle database
  chatter (the default is 2s, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:31`).
  Instead the producer calls `Signal()` immediately after committing outbox entries; the processor is
  parked on `WaitAsync(timeout, ct)` and returns at once. This collapses dispatch latency from "up to
  the polling interval" to near-zero in the common case, while the timeout remains a safety net and
  keeps idle DB chatter (and its telemetry cost) low.
- **Walkthrough**: `Signal()` (`IOutboxSignal.cs:11`) is synchronous and unblocks any waiter, so it is
  safe to call from the same thread that just finished `SaveChangesAsync`. `WaitAsync(TimeSpan
  timeout, CancellationToken cancellationToken)` (`IOutboxSignal.cs:20`) is what the processor loop
  awaits at the bottom of every cycle, returning when either signalled or the timeout elapses; its doc
  names it explicitly as the replacement for polling delays (`IOutboxSignal.cs:13-19`).
- **Why it's built this way**: keeping it an interface lets tests inject a controllable signal to
  drive the processor deterministically without real timers, a §14 testability injection point, and it
  keeps the `SemaphoreSlim` detail (including its one-permit cap) out of every call site.
- **Where it's used**: registered as a singleton in `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:150`) and again in the
  design-time host (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:69`).
  `Signal()` is called by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  on all three of its paths (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:117,313,322`)
  and by [`BrokerEventBus`](#brokereventbus) after writing an outbox row
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/BrokerEventBus.cs:89`). `WaitAsync` is
  awaited by the [`OutboxProcessor`](#outboxprocessor) loop
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:126`),
  with the wait duration computed from [`OutboxCycleResult`](#outboxcycleresult).

### OutboxCycleResult
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCycleResult.cs:19` · Level 0 · record struct (internal, readonly)

- **What it is**: the outcome of one outbox processing cycle, used by the
  [`OutboxProcessor`](#outboxprocessor) to decide how long to wait before the next cycle.
- **Depends on**: nothing first-party (BCL `bool`/`DateTime?`). Consumed by the processor, which feeds
  the computed wait to [`IOutboxSignal.WaitAsync`](#ioutboxsignal).
- **Concept introduced, the smart-wait input.** `[Rubric §12, Performance & Scalability]`,
  `[Rubric §29, Resilience]`, `[Rubric §31, Cost Efficiency]`. Two members drive two distinct wait
  policies, and the XML doc spells both out (`OutboxCycleResult.cs:7-18`). `HasMoreEligibleWork`
  triggers an **immediate re-poll**: it is set only when a *full* batch of eligible rows was fetched
  **and** at least one made progress (dispatched or dead-lettered), so more eligible rows are likely
  waiting. The progress requirement is what stops a batch wholly stuck in a permanent error from
  hot-spinning the loop. `EarliestPendingOccurredOn` enables **time-precise wake-up**: if the oldest
  not-yet-eligible message becomes eligible in 47 seconds, the processor sleeps roughly 47 seconds
  instead of the full fallback interval; `null` means nothing is pending, so the full interval applies.
- **Walkthrough**: declared as a `readonly record struct` with two positional members on a single line
  (`OutboxCycleResult.cs:19`): `HasMoreEligibleWork` (`bool`) and `EarliestPendingOccurredOn`
  (`DateTime?`). The value-type, no-heap shape means the tight background loop allocates nothing per
  cycle. It is `internal`, so it is not part of any package's public API surface.
- **Why it's built this way**: a record struct avoids per-cycle allocation in a long-running loop, and
  `internal` visibility keeps the outbox processing contract private to the Infrastructure layer.
- **Where it's used**: returned by `OutboxProcessor.ProcessPendingMessagesAsync`
  (`OutboxProcessor.cs:227`) after aggregating the per-target results, produced per source by
  `ProcessSourceAsync` (`OutboxProcessor.cs:273,282,313-317`), and consumed by `ExecuteAsync` to either
  continue immediately (`OutboxProcessor.cs:112-116`) or call
  [`IOutboxSignal.WaitAsync`](#ioutboxsignal) with the duration `ComputeWaitTime` derives from it
  (`OutboxProcessor.cs:121-126`).

### OutboxMetrics
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMetrics.cs:15` · Level 0 · class (internal static)

- **What it is**: the single OpenTelemetry `Meter` and the four instruments that describe the health
  of the outbox pipeline: dead letters, successful dispatches, end-to-end delivery lag, and observed
  backlog depth.
- **Depends on**: nothing first-party; BCL `System.Diagnostics.Metrics` (`Meter`, `Counter<long>`,
  `Histogram<double>`, `ObservableGauge<long>`) and `Interlocked`. Emitted exclusively by
  [`OutboxProcessor`](#outboxprocessor).
- **Concept introduced, instrumenting an asynchronous pipeline you cannot watch from a request
  trace.** `[Rubric §13, Observability & Operability]` (assesses whether operators can answer "is it
  healthy, and how far behind is it" without attaching a debugger) and `[Rubric §29, Resilience]`.
  Everything about the outbox happens *after* the HTTP response has gone out, so no request trace ever
  covers it. These four instruments are the substitute. A host exports them by registering the
  `MeterName` meter, and the Aspire service defaults (`ConfigureOpenTelemetry`) already do; the doc
  comment notes that the meter name is duplicated as a literal in MMCA.Common.Aspire because that
  package has no reference to Infrastructure (`OutboxMetrics.cs:7-9`), the same deliberate duplication
  used for the `OutboxPoll` activity name.
- **Walkthrough**
  - `MeterName` (`OutboxMetrics.cs:18`) is the constant `"MMCA.Common.Outbox"`, and the single static
    `Meter` is created from it (`OutboxMetrics.cs:20`). The class doc is explicit that one meter serves
    every outbox instrument and that a second `Meter` with this name must never be created
    (`OutboxMetrics.cs:10-13`).
  - `DeadLetterCounter` (`outbox.dead_letter.count`, `OutboxMetrics.cs:32-35`) counts messages
    abandoned, tagged by `event_type` **and** by `reason`, which takes exactly two values:
    `type_unresolvable` or `retries_exhausted` (`OutboxMetrics.cs:28-31`). That second tag is what lets
    an operator tell a deployment mistake (a renamed event type) apart from a genuine downstream outage.
  - `ProcessedCounter` (`outbox.processed.count`, `OutboxMetrics.cs:38-41`) counts messages dispatched
    successfully and stamped processed, tagged by `event_type`.
  - `DispatchLagHistogram` (`outbox.dispatch.lag`, unit seconds, `OutboxMetrics.cs:48-51`) records the
    interval between `OccurredOn` and `ProcessedOn`. The doc calls it the number that answers "how far
    behind is eventual consistency right now" (`OutboxMetrics.cs:43-47`).
  - `PendingDepthGauge` (`outbox.pending.depth`, `OutboxMetrics.cs:66-70`) is an `ObservableGauge`
    reading the `_pendingDepth` field (`OutboxMetrics.cs:26`) through `Interlocked.Read`, published by
    `SetPendingDepth` (`OutboxMetrics.cs:76`) via `Interlocked.Exchange`. Its `remarks`
    (`OutboxMetrics.cs:57-65`) carry the operational caveat that matters most: the gauge reports what
    **this** instance last observed, not a cluster-wide depth, so with several replicas each publishes
    its own view and the values must be read per instance and never summed into a fleet total. The count
    uses the same predicate as the poll (unprocessed, retries not exhausted, not under an unexpired
    lease), so rows another replica currently holds are excluded.
- **Why it's built this way**: static instruments on one shared meter is the standard
  `System.Diagnostics.Metrics` shape and costs nothing when no listener is attached. `Interlocked` on
  the backing field keeps the gauge callback lock-free while the processor writes it from its own loop.
  Making the depth a *gauge fed by the cycle* rather than an independent query means the steady state
  pays no extra database round-trip at all: see `CountPendingAsync`, which derives the depth from the
  fetch itself unless the batch came back saturated (`OutboxProcessor.cs:328-349`).
- **Where it's used**: `DeadLetterCounter` on both dead-letter paths (`OutboxProcessor.cs:475-478` for
  an unresolvable type, `OutboxProcessor.cs:540-543` for exhausted retries), `ProcessedCounter` and
  `DispatchLagHistogram` on the success path (`OutboxProcessor.cs:500,505-507`), and `SetPendingDepth`
  once per cycle after every target has been drained (`OutboxProcessor.cs:225`).

### IIntegrationEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IIntegrationEvent.cs:15` · Level 1 · interface

- **What it is**: a marker interface distinguishing **integration events** (cross-module or
  cross-service) from plain domain events (intra-module).
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0), which it extends.
- **Concept introduced, domain versus integration events.** `[Rubric §6, CQRS & Event-Driven]`
  (reliable events across module boundaries) and `[Rubric §7, Microservices Readiness]` (loose coupling
  via events). The doc comment draws the line (`IIntegrationEvent.cs:8-13`): *domain events* are
  intra-module, raised and handled within the same bounded context by
  [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent); *integration events*
  are facts that other modules, possibly in other processes, need to react to, handled by
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent) and
  transported through [`IMessageBus`](#imessagebus). Because it still extends `IDomainEvent`, an
  integration event flows through the **same outbox pipeline** (at-least-once); the marker only tells
  the [`OutboxProcessor`](#outboxprocessor) to route it through `IMessageBus.PublishAsync` rather than
  the in-process dispatcher. The interface is empty
  (`public interface IIntegrationEvent : IDomainEvent;`, `IIntegrationEvent.cs:15`): membership itself
  is the marker.
- **Why it's built this way**: making integration events a *subtype* of domain events means one outbox
  mechanism serves both, and the routing decision is a single `is IIntegrationEvent` pattern match in
  the processor (`OutboxProcessor.cs:486`), with no parallel capture pipeline to keep in step.
- **Where it's used**: implemented by integration events across modules and by
  [`BaseIntegrationEvent`](#baseintegrationevent), which adds the `SchemaVersion` convention; routed
  by the [`OutboxProcessor`](#outboxprocessor) to [`IMessageBus`](#imessagebus)
  (`OutboxProcessor.cs:486-493`); published by [`InProcessEventBus`](#inprocesseventbus) and
  [`BrokerEventBus`](#brokereventbus); consumed via
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent).

### NoOpInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/NoOpInboxStore.cs:7` · Level 1 · class (internal sealed)

- **What it is**: the default [`IInboxStore`](#iinboxstore) used when the inbox is disabled. It never
  dedups and records nothing, so consumer behavior is exactly as it was before the inbox feature
  existed.
- **Depends on**: [`IInboxStore`](#iinboxstore) (the port it implements); BCL `Task`/`Guid` only.
- **Concept reinforced, the Null Object pattern.** `[Rubric §2, Design Patterns]` (assesses idiomatic
  use of patterns) and `[Rubric §10, Cross-Cutting Concerns]`. `AlreadyProcessedAsync` always returns
  `Task.FromResult(false)` (`NoOpInboxStore.cs:9-10`) and `MarkProcessedAsync` returns
  `Task.CompletedTask` (`NoOpInboxStore.cs:12-13`). The consumer pipeline is written against
  [`IInboxStore`](#iinboxstore) and runs identically whether or not dedup is enabled: the Null Object
  removes a runtime `if (inbox enabled)` branch from every consumer.
- **Why it's built this way**: opt-in dedup keeps the monolith simple. In-process dispatch never
  redelivers, so a single-process or broker-less deployment needs no inbox and pays nothing for the
  default (**[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)**). Note that this one is registered as a **singleton** while
  [`EfInboxStore`](#efinboxstore) is scoped (`DependencyInjection.cs:688,692`): a stateless no-op needs
  no per-request lifetime, an EF-backed store does.
- **Where it's used**: registered as the default `IInboxStore` inside `AddBrokerMessaging` whenever
  `MessageBus:EnableInbox` is not set
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:690-693`); consumed by
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent).

### OutboxMessage
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:14` · Level 1 · class (public sealed)

- **What it is**: a row in an `OutboxMessages` table: a JSON-serialized domain event persisted **in
  the same database transaction as its aggregate**, ready for reliable asynchronous dispatch, plus the
  bookkeeping the processor needs (retry state, claim lease, trace context).
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0); BCL `System.Text.Json`,
  `System.Diagnostics.Activity` (trace capture), and `System.Collections.Concurrent` (the type cache).
- **Concept introduced, the Transactional Outbox pattern.** `[Rubric §6, CQRS & Event-Driven]`
  (reliable at-least-once delivery), `[Rubric §8, Data Architecture]` (the event is written in the same
  transaction as the aggregate), and `[Rubric §29, Resilience & Business Continuity]` (the delivery
  guarantee survives a crash). [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) is the governing decision. The problem it solves: if you save
  an aggregate and *then* publish an event, a crash between the two loses the event. The fix is to
  write the event to an `OutboxMessages` row in the **same database transaction** as the aggregate
  change; the [`OutboxProcessor`](#outboxprocessor) then reads unprocessed rows and dispatches them,
  re-dispatching after a crash (at-least-once). Each service owns its own outbox table
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so there is no cross-service race.
- **Walkthrough**
  - Static `SerializerOptions` (`OutboxMessage.cs:16-19`), a `JsonSerializerOptions` with
    `ReferenceHandler.IgnoreCycles`, so an event referencing a cyclic entity graph still serializes;
    the same instance is reused on the read side (`OutboxMessage.cs:102`) so payloads round-trip
    symmetrically.
  - Static `EventTypeCache` (`OutboxMessage.cs:25`), a `ConcurrentDictionary<string, Type?>` keyed by
    assembly-qualified name with `StringComparer.Ordinal`, memoizing the `Type.GetType` reflection
    lookup `DeserializeEvent` would otherwise run on **every** row. The XML doc notes that an
    unresolvable name caches as `null` (`OutboxMessage.cs:21-24`), so a poison payload's resolution is
    not retried on each poll.
  - **Identity and payload** (`OutboxMessage.cs:28-37`): `Id` (`Guid`, auto `Guid.NewGuid()`, line 28);
    `EventType` (`required`, the assembly-qualified type name used for deserialization, line 31);
    `Payload` (`required`, the JSON string, line 34); `OccurredOn` (the business timestamp copied from
    `IDomainEvent.DateOccurred`, line 37). All `init`-only.
  - **Processing state** (`OutboxMessage.cs:40-61`), deliberately *settable* because the processor
    mutates it: `ProcessedOn?` (null until dispatched, line 40); `RetryCount` (bumped on failure, line
    43); `LockedUntil?` and `LockToken?` (lines 51 and 58); `LastError?` (the last failure message,
    line 61).
  - **The claim lease** is the part worth slowing down for. `LockedUntil` is the UTC timestamp until
    which the row is leased to one processor replica, and its doc states the consequence plainly:
    rows with an unexpired lease are skipped by other replicas' polls, making scale-out safe by
    construction, where before the lease two replicas could drain the same rows and double-dispatch
    every event (`OutboxMessage.cs:45-50`). `LockToken` is the claim token written together with the
    lease so the claiming replica processes only rows carrying **its own** token, which is what stops a
    race between two claim updates from handing the same row to both (`OutboxMessage.cs:53-57`).
  - **Trace context** (`OutboxMessage.cs:63-67`): `TraceId?`/`SpanId?`, W3C ids captured at write time
    and `init`-only, so a trace can be resumed across the asynchronous hop.
  - **`FromDomainEvent(IDomainEvent)`** (`OutboxMessage.cs:74-88`), the static factory. It null-guards
    the event (line 76), captures `Activity.Current` (line 79), and serializes using the *runtime* type
    so `type.AssemblyQualifiedName` survives the JSON round-trip (line 82 falls back to
    `FullName` then `Name` if the assembly-qualified name is null).
  - **`DeserializeEvent()`** (`OutboxMessage.cs:94-103`) re-inflates the event, resolving the CLR type
    through `EventTypeCache.GetOrAdd(EventType, static typeName => Type.GetType(typeName))` (line 96).
    It returns `null` rather than throwing when the type can no longer be resolved (lines 97-98, for
    example after a rename) so the processor can dead-letter the row instead of crashing, then
    deserializes with the shared `SerializerOptions` (line 102).
- **Why it's built this way**: persisting events in the same transaction, not after it, is the only
  way to guarantee no event is lost. JSON keeps rows human-readable for debugging; the
  assembly-qualified name enables polymorphic deserialization; the per-name type cache keeps the hot
  poll path off reflection; `TraceId`/`SpanId` let traces span the asynchronous outbox hop; and the
  lease pair moves scale-out safety from a deployment convention (`minReplicas: 1`) into the data
  model. The EF configuration completes the picture
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:483-507`):
  table `dbo.OutboxMessages` (line 486), bounded columns for `EventType` (500, non-Unicode, line 488),
  `LastError` (4000, line 490) and the trace ids (64, lines 491-492), a **filtered** pending index on
  `(ProcessedOn, OccurredOn)` that includes `RetryCount` and `LockedUntil` so the poll's filter columns
  ride along without a key lookup (lines 496-499, rationale at lines 493-495), and a second filtered
  index on non-null `ProcessedOn` so the retention sweep does not scan the largest partition of the
  table (lines 504-506).
- **Where it's used**: written by the `SaveChanges` capture in
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  (G07) and by [`InProcessEventBus`](#inprocesseventbus)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/InProcessEventBus.cs:68`) and
  [`BrokerEventBus`](#brokereventbus) (`BrokerEventBus.cs:80`); read, claimed and dispatched by the
  [`OutboxProcessor`](#outboxprocessor); marked processed in bulk by
  [`OutboxFinalizer`](#outboxfinalizer); purged by [`OutboxCleanupService`](#outboxcleanupservice).
- **Caveats / not-in-source**: a type-rename migration requires keeping the old `EventType` resolvable
  (or a data migration). An assembly rename makes `Type.GetType(EventType)` return null, the null
  caches in `EventTypeCache`, and the row dead-letters on the next cycle with reason
  `type_unresolvable`.

### OutboxSignal
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxSignal.cs:15` · Level 1 · class (public sealed)

- **What it is**: the `SemaphoreSlim`-based [`IOutboxSignal`](#ioutboxsignal) that wakes the
  [`OutboxProcessor`](#outboxprocessor) the instant new outbox entries are written.
- **Depends on**: [`IOutboxSignal`](#ioutboxsignal) (the port it implements) and `IDisposable`; BCL
  `SemaphoreSlim`/`TimeSpan`.
- **Concept reinforced, event-driven wake, plus a small cost lesson.** `[Rubric §12, Performance &
  Scalability]` (introduced at [`IOutboxSignal`](#ioutboxsignal)) and `[Rubric §31, Cost Efficiency /
  FinOps]`. The semaphore is capped at **one permit** on purpose (`new SemaphoreSlim(0, 1)`,
  `OutboxSignal.cs:17`) and the class doc explains exactly why (`OutboxSignal.cs:5-13`): the processor
  drains every pending message in a single batch, so one pending wake-up is all the information a burst
  of saves carries. With the default uncapped `SemaphoreSlim(0)` the class accumulated one permit per
  `Signal()` call, so N saves in a burst made `WaitAsync` return immediately N times, and each of those
  cycles issued a candidate-fetch query per relational data source that returned nothing. Surplus
  signals were harmless for correctness but not for cost. With the cap, the surplus is absorbed here.
- **Walkthrough**: `Signal()` (`OutboxSignal.cs:20-30`) calls `_semaphore.Release()` inside a `try`
  and swallows the `SemaphoreFullException` the cap now makes routine (`OutboxSignal.cs:26-29`), so
  repeated signals never throw. `WaitAsync` (`OutboxSignal.cs:33-43`) awaits
  `_semaphore.WaitAsync(timeout, cancellationToken)` and rethrows `OperationCanceledException` only
  when the token really was cancelled, propagating shutdown (`OutboxSignal.cs:39-42`); a plain timeout
  simply returns. `Dispose()` (`OutboxSignal.cs:46`) disposes the semaphore.
- **Why it's built this way**: a counting semaphore is the lightest primitive that both parks the
  processor loop and is releasable from the commit path. Capping it at one permit and swallowing the
  overflow makes signalling idempotent against bursts, which is the same "at-least-once is fine,
  duplicates are absorbed" instinct that runs through this whole group.
- **Where it's used**: registered as the singleton `IOutboxSignal`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:150`) and in the
  design-time host (`DesignTimeDbContextHelper.cs:69`). Callers are listed under
  [`IOutboxSignal`](#ioutboxsignal).

### OutboxFinalizer
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxFinalizer.cs:12` · Level 6 · class (internal static)

- **What it is**: the helper that marks a batch of just-dispatched [`OutboxMessage`](#outboxmessage)
  rows processed with a **single set-based SQL `UPDATE`**, then re-syncs the EF change tracker so a
  later save does not re-issue the same statement. It is the finalize step on the low-latency
  in-process happy path, not the background processor's path.
- **Depends on**: [`OutboxMessage`](#outboxmessage) (this group) and
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (G07); EF Core
  (`ExecuteUpdateAsync`) and BCL `TimeProvider.System`.
- **Concept introduced, set-based finalize off the hot write path.** `[Rubric §12, Performance &
  Scalability]` (assesses keeping the hottest write path cheap) and `[Rubric §8, Data Architecture]`
  (efficient set-based mutation). Every event-raising command reaches this the moment its transaction
  commits and its local events are dispatched in-process. The naive approach, setting `ProcessedOn` on
  each tracked entity and calling `SaveChanges` again, would run a second full save (change detection,
  audit stamping, the interceptor pipeline) on the busiest write path in the system. Instead the doc
  comment states the design (`OutboxFinalizer.cs:6-11`): one asynchronous `ExecuteUpdate` statement
  that bypasses the change tracker and the `SaveChanges` interceptor pipeline entirely.
- **Walkthrough**: `MarkProcessedAsync(ApplicationDbContext, IReadOnlyList<OutboxMessage>,
  CancellationToken)` (`OutboxFinalizer.cs:21-48`) short-circuits on an empty batch
  (`OutboxFinalizer.cs:26-27`), computes `now` once from `TimeProvider.System.GetUtcNow().UtcDateTime`
  (line 29), collects the row ids (line 30), and issues **one** `ExecuteUpdateAsync` that
  `SetProperty(m => m.ProcessedOn, now)` over `Where(m => ids.Contains(m.Id))` (lines 32-35). Because
  `ExecuteUpdate` does not touch tracked instances, it then loops the entries and, for each, sets the
  tracked `ProcessedOn`, writes the property's `OriginalValue`, and clears `IsModified` (lines 41-47).
  The ordering inside that loop is load-bearing and the inline comment says why (lines 37-40): clearing
  `IsModified` reverts the current value to the original, so the original must already hold the new
  value first.
- **Why it's built this way**: `ExecuteUpdate` is a single round-trip that never materializes
  entities, and re-syncing the tracker afterwards keeps a later `SaveChanges` from queueing a redundant
  `UPDATE` for rows that are already processed. This is how [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)'s *dispatch #1* (the in-process
  happy path) stays cheap; the durability net is the background [`OutboxProcessor`](#outboxprocessor),
  which deliberately does **not** use this helper (it stamps `ProcessedOn` on tracked rows and issues
  one ordinary `SaveChangesAsync` per source, `OutboxProcessor.cs:309`, because it must also persist
  `RetryCount`, `LastError` and lease changes in the same save).
- **Where it's used**: called by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  right after commit (`DomainEventSaveChangesInterceptor.cs:310`) and by
  [`InProcessEventBus`](#inprocesseventbus) after writing and dispatching an integration-event batch
  (`InProcessEventBus.cs:77`).

### EfInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:18` · Level 8 · class (public sealed partial)

- **What it is**: the EF-backed inbox. It records processed message ids in the consumer's own database
  so a redelivered broker message is skipped (consumer-side dedup).
- **Depends on**: [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  `IOptions<`[`OutboxSettings`](group-14-module-system-composition.md#outboxsettings)`>` (to find the
  publish-target source) and `ILogger<EfInboxStore>`, all via primary constructor
  (`EfInboxStore.cs:18-22`); the [`InboxMessage`](#inboxmessage) entity; resolves an
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).
- **Concept reinforced, at-least-once-with-dedup, and why handlers must still be idempotent.**
  `[Rubric §6, CQRS & Event-Driven]` (idempotent consumers) and `[Rubric §29, Resilience]`. The class
  comment is the important read (`EfInboxStore.cs:11-17`): because the inbox row is written *after*
  the handlers commit, a crash in between reprocesses the message once, so handlers **must still be
  idempotent**. The inbox shrinks the duplicate window; it does not eliminate it. This is the
  consumer-side complement to the producer-side [`OutboxProcessor`](#outboxprocessor).
- **Walkthrough**
  - `AlreadyProcessedAsync` (`EfInboxStore.cs:25-31`) resolves the context and issues a single
    `AnyAsync` for an [`InboxMessage`](#inboxmessage) with the given `MessageId`
    (`EfInboxStore.cs:28-29`), which the unique index turns into an index seek.
  - `MarkProcessedAsync` (`EfInboxStore.cs:34-68`) adds a row stamped `DateTime.UtcNow`
    (`EfInboxStore.cs:38-43`, with a scoped `VSTHRD103` suppression noting that EF's `DbSet.Add` is
    intentionally synchronous, lines 37 and 44) and saves (line 48).
  - The `catch (DbUpdateException)` (lines 50-67) is where the design lives, and it does three things
    in order. First it **detaches the rejected entry** (`entry.State = EntityState.Detached`, line 56);
    the comment explains that the context is cached per data source for the whole scope, so a row left
    in `Added` state would make every later `SaveChangesAsync` on that scope re-attempt the failed
    insert (lines 52-55). Second it **re-queries** through `AlreadyProcessedAsync` and rethrows when the
    row is still absent (lines 63-64): only a concurrent duplicate delivery tripping the unique index is
    safe to absorb, and the comment is explicit that re-querying beats sniffing provider-specific error
    codes because the check must hold for SQL Server and SQLite alike, and that swallowing any other
    write failure would ACK a message whose inbox row was never written (lines 58-62). Third, and only
    then, it logs the absorbed duplicate at Debug (`EfInboxStore.cs:66`, source-generated at lines
    76-77).
  - `ResolveContext` (`EfInboxStore.cs:70-74`) routes to the configured outbox data source by resolving
    `OutboxSettings.DataSource`/`DatabaseName` through
    [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) and asking the
    factory for that context, so the inbox lands in the same database as the outbox.
- **Why it's built this way**: dedup by `MessageId` (the [`IDomainEvent`](#idomainevent) member
  introduced at Level 0) makes redelivery safe without distributed locks, and storing the row in the
  consumer's *own* database keeps it within the database-per-service boundary ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Relying on
  the unique index and confirming the violation by re-query avoids a read-then-write race between
  concurrent deliveries without hiding a genuine write failure.
  **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** is the governing decision: this opt-in inbox is the broker-consume sibling of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)'s outbox and [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)'s HTTP-edge idempotency, activated by
  `MessageBus:EnableInbox` and marking processed only after all handlers succeed, so a throwing handler
  leaves the message redeliverable.
- **Where it's used**: registered as the scoped `IInboxStore` in place of
  [`NoOpInboxStore`](#noopinboxstore) when `MessageBus:EnableInbox=true`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:686-689`); called by
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) around handler invocation
  (`IntegrationEventConsumer.cs:42,78`); its rows are purged by
  [`OutboxCleanupService`](#outboxcleanupservice).

### OutboxCleanupService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCleanupService.cs:40` · Level 8 · class (public sealed partial, `BackgroundService`)

- **What it is**: the periodic sweeper that purges spent outbox rows (both **processed** rows and
  **dead-lettered** rows whose retries are exhausted) and, when the inbox is enabled, inbox rows, older
  than their retention windows, from every relational target the host owns, including each tenant
  database that keeps its own copy of a source.
- **Depends on**: `IServiceScopeFactory`, `ILogger<OutboxCleanupService>`,
  `IOptions<`[`OutboxSettings`](group-14-module-system-composition.md#outboxsettings)`>`,
  `IOptions<`[`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)`>`,
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), an optional
  `TimeProvider` and an optional
  `IOptions<`[`TenancySettings`](group-14-module-system-composition.md#tenancysettings)`>`
  (`OutboxCleanupService.cs:40-48`); resolves an
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) and, for a tenant target, an
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) per sweep; expands its work list through
  [`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets) into
  [`TenantDataSourceTarget`](group-07-persistence-ef-core.md#tenantdatasourcetarget) values; operates
  on the [`OutboxMessage`](#outboxmessage) and [`InboxMessage`](#inboxmessage) entities.
- **Concept reinforced, retention as a privacy and storage control (plus a clock injection point).**
  `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses bounded retention of data that may
  contain PII), `[Rubric §8, Data Architecture]`, `[Rubric §31, Cost Efficiency]`, and
  `[Rubric §14, Testability]`. The [`OutboxProcessor`](#outboxprocessor) only ever *sets*
  `ProcessedOn`, and a message that exhausts `MaxRetries` keeps `ProcessedOn` null forever, so without
  this sweep the outbox, which stores serialized event payloads that may contain personal data, grows
  without bound and dead rows linger in the pending index where every poll re-scans them
  (`OutboxCleanupService.cs:15-27`, citing ADR-003 and ADR-005). The constructor takes an optional
  `TimeProvider? timeProvider = null` (`OutboxCleanupService.cs:47`) defaulting to
  `TimeProvider.System` (line 52); the doc states its purpose (lines 34-35): a clock abstraction so
  tests can drive the hour-scale sweep loop deterministically instead of waiting real hours.
- **Walkthrough**
  - `ExecuteAsync` (`OutboxCleanupService.cs:55-83`) returns immediately when `RetentionDays <= 0`
    (lines 57-61), the documented off switch. It computes the interval from `CleanupIntervalHours`
    (line 63, default 6, `OutboxSettings.cs:73`) and then loops, deliberately awaiting
    `_timeProvider.Delay(interval, ...)` **before** each `PurgeAsync` (lines 71-72) so cleanup never
    competes with startup or migration work (comment, lines 65-66). Shutdown breaks the loop cleanly
    (lines 74-77); any other exception is logged and the loop continues (lines 78-81).
  - `PurgeAsync` (`OutboxCleanupService.cs:85-158`) computes the cutoff from
    `_timeProvider.GetUtcNow().UtcDateTime` minus `RetentionDays` (line 87, default 7,
    `OutboxSettings.cs:65`), then walks `GetRelationalTargets()` (line 89). For a tenant target it sets
    the tenant on the scope **before** asking for the context (lines 96-101), because the tenant is what
    routes the scoped factory to that tenant's database. Then it opens the context (lines 103-104) and
    deletes processed rows older than the cutoff with `ExecuteDeleteAsync`, a set-based SQL `DELETE`
    with no entity materialization (lines 106-109).
  - **The dead-letter sweep** (lines 125-141) is the second, separate pass and the comment above it is
    worth reading in full (lines 116-124): dead-lettered rows keep `ProcessedOn` null forever, so the
    processor's poll excludes them (`RetryCount < MaxRetries`) but the processed sweep never reaches
    them either. They are purged on their own window, `DeadLetterRetentionDays` falling back to
    `RetentionDays` when it is 0 (lines 125-127, and 0 is the default, `OutboxSettings.cs:108`), keyed
    on `OccurredOn` since they have no `ProcessedOn` (lines 131-136). The comment is explicit that this
    **permanently abandons an undelivered event** after that window, which is why the deletion logs at
    Warning (line 140, `LogDeadLetterPurged` at lines 209-210) while the processed purge logs at
    Information (line 113, `LogPurged` at lines 206-207).
  - Inbox rows are purged only when `MessageBusSettings.EnableInbox` is set (lines 143-146, the flag
    captured once at construction, line 51), delegating to `PurgeInboxAsync` (lines 160-175), which
    deletes [`InboxMessage`](#inboxmessage) rows with `ProcessedOn < cutoff`.
  - A single unreachable database does not stop the others: the per-target `catch` logs and moves on
    (lines 152-156), while a real cancellation is rethrown (lines 148-151). `GetRelationalSources`
    (lines 182-193) computes the same source set the processor drains: every physical source backing a
    registered entity, minus Cosmos, plus the configured publish target.
    `GetRelationalTargets` (lines 200-201) then expands that list into one target per source against the
    shared database plus one extra per tenant that overrides a source, which is the only reason a
    per-tenant database's outbox and inbox tables ever get swept
    ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html); doc, lines 195-199).
- **Why it's built this way**: bounded retention keeps both storage cost (§31) and PII exposure (§30)
  in check; doing it as a `DELETE` rather than load-then-remove is the efficient path, and per-target
  error isolation keeps one bad database from blocking the sweep.
  [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html) has the inbox reuse this same retention sweep, gated on `EnableInbox`, rather than
  adding a second housekeeping service.
- **Where it's used**: registered as a hosted service alongside the
  [`OutboxProcessor`](#outboxprocessor) in `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:152`).
- **Caveats / not-in-source**: the inbox purge uses the *outbox* `RetentionDays` cutoff (line 145), not
  a separate inbox window; shortening outbox retention therefore shortens the dedup memory too.

### OutboxProcessor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:50` · Level 8 · class (public sealed partial, `BackgroundService`)

- **What it is**: the background service that drains every outbox table the host owns, claims rows
  under a lease, and dispatches the [`OutboxMessage`](#outboxmessage)s. It is the engine of
  at-least-once delivery ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) and the most intricate type in this group.
- **Depends on**: `IServiceScopeFactory`, `ILogger<OutboxProcessor>`,
  `IOptions<`[`OutboxSettings`](group-14-module-system-composition.md#outboxsettings)`>`,
  [`IOutboxSignal`](#ioutboxsignal),
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), an optional
  `TimeProvider` and an optional
  `IOptions<`[`TenancySettings`](group-14-module-system-composition.md#tenancysettings)`>`
  (`OutboxProcessor.cs:50-58`); per scope
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDomainEventDispatcher`](#idomaineventdispatcher), [`IMessageBus`](#imessagebus) and, for a tenant
  target, [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) (`OutboxProcessor.cs:244-252`);
  the [`OutboxMessage`](#outboxmessage) entity, [`OutboxMetrics`](#outboxmetrics),
  [`OutboxCycleResult`](#outboxcycleresult) and
  [`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets).
- **Concept introduced, the outbox drain loop: smart wait, leases, per-target draining,
  dead-lettering, jittered backoff, and trace continuity.** `[Rubric §6, CQRS & Event-Driven]`
  (reliable delivery), `[Rubric §29, Resilience]`, `[Rubric §13, Observability & Operability]`, and
  `[Rubric §31, Cost Efficiency]` (idle-poll suppression). The class doc sets the delivery contract up
  front (`OutboxProcessor.cs:28-35`): delivery is at-least-once, and a message dispatched but not yet
  stamped processed is redelivered only once its claim lease expires, not immediately on restart,
  because the claim is persisted before dispatch and the poll skips leased rows. Take the rest a layer
  at a time.
- **Walkthrough**
  - **The loop.** `ExecuteAsync` (`OutboxProcessor.cs:84-128`) waits 5 seconds so the application
    finishes initializing (line 87), then bails out entirely if the host owns no relational targets
    (lines 89-93, logged once, `LogOutboxDisabled` at lines 608-609). Each iteration calls
    `ProcessPendingMessagesAsync`, treats a cancellation as a clean stop (lines 102-106) and any other
    exception as a logged error that does not kill the service (lines 107-110). If the cycle reported
    `HasMoreEligibleWork` it re-polls immediately (lines 112-116); otherwise it awaits
    [`IOutboxSignal.WaitAsync`](#ioutboxsignal) for whichever comes first of a signal, the **smart
    wait**, or the fallback interval (lines 118-126).
  - **The smart wait.** `ComputeWaitTime` (`OutboxProcessor.cs:137-155`) returns the full polling
    interval when nothing is pending (lines 143-146); otherwise it waits until the earliest pending row
    becomes eligible (its `OccurredOn` plus `ProcessingDelaySeconds`, line 148), floored at
    `MinimumWait` of 1 second so an overdue row cannot hot-loop the processor (lines 72, 149-152) and
    capped at the polling interval (line 154). Its doc adds a subtle rule (lines 130-136):
    failed-but-already-eligible messages never shorten the wait, which throttles a permanently failing
    message instead of letting it drive the loop. This is why production can set a 300s poll interval
    without adding latency: real messages wake it by signal or smart wait, and the slow fallback only
    cuts idle DB chatter and telemetry cost.
  - **Which databases.** `GetOutboxSources` (`OutboxProcessor.cs:162-173`) enumerates every relational
    physical source backing a registered entity (Cosmos is filtered out, line 165) plus the configured
    publish target (lines 167-170), deduplicated. It is recomputed per cycle, which the doc calls cheap
    and tolerant of module assemblies loading after startup (lines 157-161). A host therefore only ever
    touches *its own* databases, never racing another service for its rows ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
    `GetOutboxTargets` (lines 181-182) is the layer above it: it expands those sources through
    [`TenantDataSourceTargets.Expand`](group-07-persistence-ef-core.md#tenantdatasourcetargets) into one
    target per source against the shared database plus one per tenant that keeps its own copy of a
    source, because a tenant database has its own `OutboxMessages` table that nothing else would drain
    (doc, lines 175-180; [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).
  - **Aggregating a cycle.** `ProcessPendingMessagesAsync` (`OutboxProcessor.cs:190-228`) drains each
    target in turn, ORs the `HasMoreEligibleWork` flags, keeps the earliest pending timestamp across
    all targets, and sums the observed backlog (lines 196-221). One unreachable database must not starve
    the others, so a per-target failure is logged and skipped (lines 214-220) while a real cancellation
    propagates (lines 210-213). It then publishes the summed depth through
    [`OutboxMetrics.SetPendingDepth`](#outboxmetrics) (line 225), so a target that threw contributes
    zero and an outage reads as a drop rather than a stale plateau (comment, lines 223-224).
  - **Draining one target.** `ProcessSourceAsync` (`OutboxProcessor.cs:234-318`) opens a scope, sets the
    tenant when the target has one (lines 244-247), gets the context for that source and resolves the
    dispatcher and message bus (lines 249-252). It fetches a candidate batch (line 257) and derives the
    backlog depth (line 258), then splits the ordered batch: the eligible prefix is everything with
    `OccurredOn` before the `ProcessingDelaySeconds` cutoff (lines 255, 263-267), and the first row past
    it becomes `earliestPending` (line 269). Nothing eligible means an early return carrying only the
    wait information (lines 271-274). Otherwise it **claims** the prefix (lines 276-277), returns early
    if another replica claimed all of it between fetch and claim (lines 279-283), dispatches (lines
    290-291), and saves with the plain `DbContext.SaveChangesAsync` (line 309). The comment above that
    save is worth noting (lines 305-308): no user id is passed, so the audit interceptor stamps its
    system sentinel, and although the EF interceptors still run there is nothing for them to capture
    because `OutboxMessage` is not an aggregate root. It returns a
    `(OutboxCycleResult, long PendingDepth)` tuple (lines 313-317) so the caller can sum the depth.
  - **Fetching.** `FetchCandidatesAsync` (`OutboxProcessor.cs:387-404`) selects rows that are
    unprocessed, under `MaxRetries`, and not under another replica's unexpired lease (lines 397-399),
    ordered by `OccurredOn` and capped at `BatchSize` (lines 400-401, default 50,
    `OutboxSettings.cs:17`). There is deliberately **no** `OccurredOn` cutoff in SQL (doc, lines
    378-386): pending rows are fetched too so the caller can smart-wait, and ordering by `OccurredOn`
    guarantees eligible rows sort before pending ones, which is what stops a full batch from starving
    eligible work. The query runs inside an explicit `OutboxPoll` activity (lines 393-394; the name
    constant `PollActivityName` is at line 69) that the Aspire
    [`OutboxPollFilterProcessor`](group-16-aspire-orchestration.md#outboxpollfilterprocessor)
    suppresses from telemetry export along with its SqlClient child span; the string is deliberately
    duplicated there because Aspire has no project reference back to Infrastructure (comment, lines
    63-68).
  - **Backlog depth almost for free.** `CountPendingAsync` (`OutboxProcessor.cs:328-349`) returns the
    fetched count directly whenever the batch came back short, because a short batch *is* the whole
    backlog (lines 335-338). Only a saturated batch, exactly the state an operator alerts on, pays for
    a `LongCountAsync`, and that query runs inside its own `OutboxPoll` activity so it is suppressed
    like the poll itself (lines 340-348). The predicate mirrors the fetch (lines 344-346), so the gauge
    counts the rows this processor considers workable.
  - **Claiming: how scale-out is made safe.** `ClaimEligibleAsync` (`OutboxProcessor.cs:414-449`) mints
    a `lockToken` and a `leaseUntil` of now plus `LeaseSeconds` (lines 421-422, default 300,
    `OutboxSettings.cs:82`), then issues one conditional `ExecuteUpdateAsync` setting `LockedUntil` and
    `LockToken` on the eligible ids that are still unprocessed and unleased (lines 425-432). A claim of
    zero rows means another replica took the whole prefix (lines 434-435); a full claim returns the
    prefix as-is (lines 437-438); a **partial** claim re-queries which ids carry *this* replica's token
    and processes only those (lines 441-448). The doc states the property this buys (lines 406-413):
    two replicas can never dispatch the same message, and a replica that dies mid-batch releases its
    rows implicitly when the lease expires. That is scale-out safety by construction rather than by a
    `minReplicas: 1` deployment convention.
  - **Dispatching.** `DispatchMessagesAsync` (`OutboxProcessor.cs:456-554`) walks the claimed batch
    inside a per-message activity (line 466). If `DeserializeEvent()` returns null the row is
    **dead-lettered**: `LastError` records the unresolvable type, `ProcessedOn` is stamped, the
    [`OutboxMetrics.DeadLetterCounter`](#outboxmetrics) is incremented with
    `reason=type_unresolvable`, and it logs at Error (lines 470-481). Otherwise an
    [`IIntegrationEvent`](#iintegrationevent) is published through [`IMessageBus`](#imessagebus) and a
    pure domain event goes to [`IDomainEventDispatcher`](#idomaineventdispatcher) (lines 486-493). On
    success the row is stamped, `ProcessedCounter` is incremented and `DispatchLagHistogram` records
    the seconds between `OccurredOn` and `ProcessedOn`, clamped at zero because the two timestamps can
    come from different hosts and clock skew must not publish a negative duration (lines 495-507). The
    per-message success log is deliberately Debug, not Information, and the comment prices the
    difference: it would otherwise be the single noisiest line in steady state, a real
    telemetry-ingestion cost, while failures stay loud (lines 623-627).
  - **Failure handling.** A cancellation during dispatch is rethrown rather than treated as a delivery
    failure, and the comment explains the bug that guard prevents (lines 511-518): falling into the
    generic handler would increment `RetryCount` and stamp `LastError` on this message and, since every
    later `await` fails the same way, on the whole remainder of the batch, so a graceful restart could
    dead-letter messages that were never attempted. A genuine exception bumps `RetryCount`, records
    `LastError`, and **re-leases** the row for an explicit backoff (lines 519-533); the comment notes
    that simply keeping the original claim made every retry wait the full `LeaseSeconds` no matter what
    the polling interval said, turning the retry cadence into an accident of the lease (lines 524-529).
    When `RetryCount` reaches `MaxRetries` (5 by default, `OutboxSettings.cs:21`) the dead-letter
    counter is incremented with `reason=retries_exhausted` and it logs at Error (lines 535-545); the
    row then leaves the poll through the `RetryCount` filter and is eventually purged by
    [`OutboxCleanupService`](#outboxcleanupservice).
  - **Backoff.** `ComputeRetryBackoffSeconds` (`OutboxProcessor.cs:563-577`) is
    `RetryBackoffBaseSeconds * 2^(retryCount - 1)` (default base 10, `OutboxSettings.cs:99`) with the
    exponent clamped to at most 16 before it reaches `Math.Pow` (line 568), multiplied by a random
    jitter factor in `[0.8, 1.2]` (line 573) and capped at `LeaseSeconds` (line 576). Jitter is applied
    *before* the cap so a capped backoff sits exactly at the lease bound (comment, line 571). The doc
    names the reason for the jitter (lines 556-562): a batch that failed together, one dependency
    outage failing all 50 rows in the same instant, would otherwise retry in lockstep and re-hammer
    that dependency on a single shared schedule. The `S2245`/`CA5394` suppression (lines 572-574) is
    justified inline: the randomness feeds no security or cryptographic decision.
  - **Graceful shutdown.** If cancellation lands mid-batch, `ProcessSourceAsync` calls
    `TryPersistStampsOnCancellationAsync` (lines 293-303, implemented at lines 364-376) before
    rethrowing, so messages already delivered keep their `ProcessedOn` instead of being redelivered
    when their lease expires. Two constraints are deliberate (doc, lines 351-363): its own try/catch,
    because a failure here must never replace the propagating `OperationCanceledException` the loop
    uses to recognize shutdown; and its own 5-second token (`ShutdownSaveTimeout`, line 79) rather than
    `CancellationToken.None`, so an uncancellable save against a dead connection cannot hold host
    shutdown open until the command timeout. A failure there logs at Warning and says plainly that the
    delivered messages will be redelivered when the lease expires (lines 617-618).
  - **Trace continuity.** `StartOutboxActivity` (`OutboxProcessor.cs:584-606`) rebuilds the original
    request's `ActivityContext` from the row's `TraceId`/`SpanId` and starts a `Consumer`-kind
    `OutboxProcess` activity tagged with the message id, event type and data source (lines 596-603),
    returning null when no trace context was captured (lines 586-589), so traces span the asynchronous
    hop.
- **Why it's built this way**: [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) makes the outbox the durability guarantee behind every
  integration event; the per-source design follows from [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) and the per-tenant expansion from
  [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html). The smart wait, the derived backlog count and the suppressed poll activity are all
  cost and latency work: an idle fleet polling around the clock would otherwise dominate telemetry
  ingestion. Dead-lettering unresolvable types stops one poison message from blocking the queue, the
  *progress* requirement on re-poll (see [`OutboxCycleResult`](#outboxcycleresult)) prevents a
  fully-failing batch from hot-spinning, and the lease plus token pair is what makes running more than
  one replica safe.
- **Where it's used**: registered as a hosted service in `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:151`), so every service
  host runs one. The producer side is the two `IEventBus` implementations
  ([`InProcessEventBus`](#inprocesseventbus) and [`BrokerEventBus`](#brokereventbus)) plus the
  `SaveChanges` capture in
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor);
  its companion sweeper is [`OutboxCleanupService`](#outboxcleanupservice).
- **Caveats / not-in-source**: the `outbox.pending.depth` gauge is per instance by design (see
  [`OutboxMetrics`](#outboxmetrics)); the lease makes multiple replicas *correct*, but the gauge still
  must not be summed across them.

### BaseDomainEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.DomainEvents` · `MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:26` · Level 1 · record class (abstract)

- **What it is**: the abstract base record for all domain events, supplying default values for both
  [`IDomainEvent`](#idomainevent) properties so a concrete event type is a one-liner.
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0).
- **Concept introduced, record semantics for domain events.** `[Rubric §6, CQRS & Event-Driven]`
  assesses whether events carry enough context and whether consumers can stay idempotent. Declaring
  the base as a `record class` (line 18) gives **structural equality**, useful for deduplication and
  for value-based assertions in tests. Two properties are initialised inline at construction:
  `DateOccurred = DateTime.UtcNow` (line 20) captures *when the business action happened* (not when
  the event is dispatched, the doc comment draws this distinction explicitly), and
  `MessageId = Guid.NewGuid()` (line 27) mints a unique per-instance id at construction time. Because
  `MessageId` is serialized with the payload, it survives the outbox -> broker -> consumer round-trip,
  making consumer-side deduplication via the inbox table reliable.
- **Walkthrough**: two `init` properties with inline defaults; `abstract` so consumers must declare a
  concrete event type. Concrete events add whatever domain-specific payload they carry (entity id,
  state change, etc.) as additional positional or `init` properties on the derived record.
- **Why it's built this way**: inline defaults mean a concrete event record needs zero boilerplate:
  `public sealed record SessionCreated(SessionIdentifierType SessionId) : BaseDomainEvent;` is the
  complete type. Minting `MessageId` at construction (not at serialization) keeps the id stable even
  if the event is serialized more than once. This is the consumer-idempotency half of the at-least-once
  story in `ADRs/003-outbox-dual-dispatch.md`. The creation-time default on `DateOccurred` is
  documented as a deliberate domain-modelling choice rather than an oversight (the `<remarks>` block,
  lines 10-16): a domain event's occurrence instant is by definition the moment the aggregate raises
  it, so stamping it at construction is the correct event-sourcing / audit semantic, and it is
  intentionally distinct from infrastructure timestamps that must be deterministically testable
  (audit fields, notification read-time), which are stamped from an injected `TimeProvider`.
- **Where it's used**: base of every domain event across both apps (e.g. `CategoryItemChanged`,
  `UserDeleted`); subclassed by [`BaseIntegrationEvent`](#baseintegrationevent) and
  [`EntityChangedEvent<TIdentifierType>`](#entitychangedeventtidentifiertype); captured into an
  [`OutboxMessage`](#outboxmessage) row and routed by [`DomainEventDispatcher`](#domaineventdispatcher).

### IDomainEventDispatcher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IDomainEventDispatcher.cs:8` · Level 1 · interface

- **What it is**: the dispatch port for in-process domain-event delivery. A single method,
  `DispatchAsync(IEnumerable<IDomainEvent>, CancellationToken)` (line 16), takes a batch of events and
  routes each to its registered handlers after an aggregate persists changes (doc comment, lines 5-7).
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0).
- **Concept introduced, the dispatcher/handler split for domain events.** `[Rubric §6, CQRS &
  Event-Driven]` assesses whether events are dispatched *after* persistence rather than from inside
  aggregates, and whether handlers are discoverable. The dispatcher is the port half of the pair; the
  handler half is [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent).
  `[Rubric §1, SOLID]`: the dispatcher depends only on the abstract handler contract (DIP), so adding
  a reaction never edits the dispatcher.
- **Walkthrough**: a one-method port; the only implementation is
  [`DomainEventDispatcher`](#domaineventdispatcher) (Level 3), which fans each event out to every
  registered `IDomainEventHandler<T>` and, for integration events, additionally to every
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent).
- **Why it's built this way**: keeping the contract in `Application` (a port) and the implementation
  in the same layer but a separate file follows Clean Architecture's ports/adapters split; the outbox
  (`ADRs/003-outbox-dual-dispatch.md`) re-uses the *same* dispatcher both for the synchronous
  in-process copy and for re-dispatch of persisted events.
- **Where it's used**: `ApplicationDbContext.SaveChangesAsync` collects domain events from aggregates,
  serializes them to [`OutboxMessage`](#outboxmessage) rows, then calls `DispatchAsync` for the
  immediate in-process reactions; the background [`OutboxProcessor`](#outboxprocessor) and both
  in-process buses ([`InProcessMessageBus`](#inprocessmessagebus),
  [`InProcessEventBus`](#inprocesseventbus)) route through the same dispatcher.

### IDomainEventHandler<in TDomainEvent>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IDomainEventHandler.cs:10` · Level 1 · interface

- **What it is**: the handler contract a domain-event reaction implements, with a single
  `HandleAsync(TDomainEvent, CancellationToken)` (line 19).
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0).
- **Concept**: the handler half of the dispatcher/handler split introduced by
  [`IDomainEventDispatcher`](#idomaineventdispatcher). `IDomainEventHandler<in TDomainEvent>` is
  **contravariant** on `TDomainEvent` (the `in` keyword, line 10), constrained
  `where TDomainEvent : IDomainEvent` (line 11); contravariance means a handler written against a
  base event type can be used where a handler for a more derived event is required. Per the doc
  comment (lines 5-7), handlers are **auto-discovered by Scrutor assembly scanning** and resolved from
  DI during dispatch (the framework wires this through `ScanModuleApplicationServices<T>`).
  `[Rubric §6, CQRS & Event-Driven]`.
- **Walkthrough**: a one-method port. Handlers that must succeed atomically with the primary
  transaction (e.g. a read model in the same DB) implement it directly and let exceptions propagate;
  side-effect handlers extend [`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent)
  instead so a failure logs-and-continues rather than rolling back the save.
- **Where it's used**: resolved and invoked by [`DomainEventDispatcher`](#domaineventdispatcher)
  (Level 3) for every dispatched event; the dispatcher closes this open generic over the concrete
  event type to find the right handlers.

### BaseIntegrationEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.DomainEvents` · `MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:11` · Level 2 · record class (abstract)

- **What it is**: the abstract base for **integration events** (events meant to cross module/service
  boundaries). It inherits [`BaseDomainEvent`](#basedomainevent) for outbox-pipeline compatibility and
  implements [`IIntegrationEvent`](#iintegrationevent) so the dispatcher routes it to integration-event
  handlers.
- **Depends on**: [`BaseDomainEvent`](#basedomainevent) (Level 1),
  [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept introduced, explicit integration-event schema versioning ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)).** This base carries a
  single member beyond what it inherits: `public virtual int SchemaVersion => 1;` (line 22).
  `[Rubric §9, API & Contract Design]` assesses whether contracts evolve without silently breaking
  consumers; an integration event *is* a wire contract once it crosses a service boundary. The version
  is serialized with the payload, so a consumer has an explicit signal to branch or upcast on. The
  doc comment (lines 13-21) states the discipline precisely: additive/optional field changes keep the
  same version; a **breaking** change (renamed, removed, or retyped field) requires a *new* event type
  (e.g. `FooV2`) plus a consumer-side upcaster, never a silent reshape of an existing type. Concrete
  events bump it by overriding (`public override int SchemaVersion => 2;`). `[Rubric §6, CQRS &
  Event-Driven]`: the dual inheritance is the routing mechanism, `BaseDomainEvent` supplies
  `DateOccurred`/`MessageId` so the outbox and inbox dedup machinery (which operates on `IDomainEvent`)
  treat integration events uniformly, while the `IIntegrationEvent` marker is what makes
  [`DomainEventDispatcher`](#domaineventdispatcher) additionally fan the event out to
  `IIntegrationEventHandler<T>`.
- **Why it's built this way**: declaring `SchemaVersion` **virtual with a default** keeps *adding*
  the member a non-breaking change: every pre-existing event implicitly stays `v1` without edits. See
  `ADRs/010-integration-event-schema-versioning.md` for the upcaster policy and
  `ADRs/003-outbox-dual-dispatch.md` for why integration events ride the same outbox.
- **Where it's used**: base of all cross-module events in MMCA.ADC (e.g. `SpeakerLinkedToUser`,
  `SpeakerUnlinkedFromUser`, `UserRegistered`).

### EntityChangedEvent<TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.DomainEvents` · `MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24` · Level 2 · record (abstract)

- **What it is**: the **standardized CRUD lifecycle event base**. Instead of separate `Created`,
  `Updated`, and `Deleted` events per entity, one event type carries the `State`
  ([`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate)) and the affected
  `EntityId`. Handlers filter on `State` to decide which transitions they care about.
- **Depends on**: [`BaseDomainEvent`](#basedomainevent) (Level 1),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Level 0).
- **Concept introduced, consolidated lifecycle events.** `[Rubric §6, CQRS & Event-Driven]` (one
  event type per entity avoids a proliferation of near-identical event classes while still carrying
  enough context to act on). The doc comment (lines 9-19) draws the boundary clearly: derive **one**
  record per entity and raise it with `DomainEntityState.Added` from factory methods,
  `DomainEntityState.Updated` from mutation methods, and `DomainEntityState.Deleted` from `Delete()`;
  reserve a *named* event (e.g. `OrderPaid`, `ShoppingCartCheckedOut`), inheriting
  [`BaseDomainEvent`](#basedomainevent) directly, for business state-machine transitions with unique
  payloads. `[Rubric §16, Maintainability]` assesses change-amplification cost: collapsing three CRUD
  events into one keeps the event surface small.
- **Walkthrough**: a primary-constructor record (line 24) with two positional parameters, `State`
  (`DomainEntityState`, line 25) and `EntityId` (`TIdentifierType`, line 26).
  `where TIdentifierType : notnull` (line 27) prevents a nullable id. The `abstract` modifier forces
  consumers to derive a concrete record (e.g. `CategoryChanged : EntityChangedEvent<ConferenceCategoryIdentifierType>`)
  which may add extra payload.
- **Where it's used**: base of ADC's generic CRUD events such as `CategoryChanged`, `EventChanged`,
  `QuestionChanged`, `SessionChanged`, `SpeakerChanged`.

### IEventBus
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEventBus.cs:11` · Level 2 · interface

- **What it is**: an abstraction for publishing [`IIntegrationEvent`](#iintegrationevent)s. Two
  `PublishAsync` overloads (lines 18, 25): a single event and a batch.
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept introduced, integration events vs. domain events.** `[Rubric §6, CQRS & Event-Driven]`
  assesses reliable events, at-least-once delivery, and idempotent consumers. A **domain event** is
  raised *inside* an aggregate, captured by `SaveChangesAsync`, and dispatched within the same
  transaction; an **integration event** is an *intentional signal to other bounded contexts* and may
  cross a service boundary. `IEventBus` is where that distinction is enforced: callers publish an
  `IIntegrationEvent` and the infrastructure decides how to route it. The doc comment (lines 5-10) is
  precise: the *default* implementation dispatches in-process through the outbox for at-least-once
  delivery via [`IDomainEventDispatcher`](#idomaineventdispatcher), while alternative implementations
  (Azure Service Bus, RabbitMQ) can be substituted via DI. The "persist to outbox + then act"
  guarantee lives in the concrete implementations below, not the interface.
- **Where it's used**: implemented by [`InProcessEventBus`](#inprocesseventbus) (default, monolith
  mode) and [`BrokerEventBus`](#brokereventbus) (extracted-service mode), both Level 8; contrast with
  the transport-agnostic [`IMessageBus`](#imessagebus) that the
  [`OutboxProcessor`](#outboxprocessor) drains through.

### IIntegrationEventHandler<in TIntegrationEvent>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IIntegrationEventHandler.cs:15` · Level 2 · interface

- **What it is**: the handler contract for *receiving* integration events. One method:
  `Task HandleAsync(TIntegrationEvent integrationEvent, CancellationToken cancellationToken)` (line 24).
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept**: mirrors [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent)
  (Level 1) but for cross-module notifications: the doc comment (lines 5-12) contrasts the two, a
  domain-event handler reacts to *intra-module* events, whereas an integration-event handler reacts to
  *cross-module* notifications (e.g. a Sales module handling `UserRegistered` from Identity). It is
  contravariant (`in`, line 15), constrained `where TIntegrationEvent : IIntegrationEvent` (line 16).
  Per the comment, implementations are auto-discovered by Scrutor (registered **singleton**; a handler
  that needs scoped services creates its own DI scope internally) and dispatched by
  [`DomainEventDispatcher`](#domaineventdispatcher). `[Rubric §6, CQRS & Event-Driven]`.
- **Where it's used**: implemented by ADC handlers such as `UserRegisteredHandler` in the Conference
  module; consumed in-process by [`DomainEventDispatcher`](#domaineventdispatcher) (Level 3) and, on
  the extracted-service path, by [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  which resolves every registered handler for the delivered event and invokes them in order.

### IMessageBus
> MMCA.Common.Application · `MMCA.Common.Application.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:28` · Level 2 · interface

- **What it is**: the **transport-agnostic** abstraction for publishing integration events across
  module or service boundaries. Two `PublishAsync` overloads (lines 35, 42): single event and batch.
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept introduced, a transport-agnostic message bus for microservices readiness.**
  `[Rubric §7, Microservices Readiness]` assesses whether the transport is a swappable boundary and
  whether business layers stay free of transport coupling. The doc comment (lines 5-27) enumerates
  both implementations explicitly: [`InProcessMessageBus`](#inprocessmessagebus) dispatches
  synchronously through the existing [`IDomainEventDispatcher`](#idomaineventdispatcher) path
  (modular-monolith mode), and [`BrokerMessageBus`](#brokermessagebus) publishes via MassTransit to an
  external broker (RabbitMQ in dev, Azure Service Bus in prod) for the extracted-service mode, with the
  outbox semantics preserved because [`OutboxProcessor`](#outboxprocessor) drains
  [`OutboxMessage`](#outboxmessage) rows through this bus instead of dispatching in-process. The
  comment is explicit that application code should depend on `IMessageBus` rather than on `IEventBus`
  or a transport-specific client. `[Rubric §29, Resilience & Business Continuity]`: outbox + broker
  together give at-least-once delivery with retry.
- **Why it's built this way**: transport belongs at the edge (`ADRs/007-grpc-extraction.md`,
  `ADRs/008-service-extraction-topology.md`). The *same* application code that called
  `IMessageBus.PublishAsync` in the monolith keeps working when the module is extracted and
  `BrokerMessageBus` is swapped in; only config (`MessageBus:Provider`) changes. `Application`,
  `Domain`, and `Shared` must never reference `MassTransit` directly; `MicroserviceExtractionTests`
  (NetArchTest) enforces that, and the **MassTransit v8 pin** is enforced separately by
  `DependencyVersionTests` (v9 needs a commercial licence; see the primer).
- **Where it's used**: implemented by [`InProcessMessageBus`](#inprocessmessagebus) and
  [`BrokerMessageBus`](#brokermessagebus) (both Level 3); drained through at runtime by
  [`OutboxProcessor`](#outboxprocessor).

### SafeDomainEventHandler<TDomainEvent>
> MMCA.Common.Application · `MMCA.Common.Application.DomainEvents` · `MMCA.Common/Source/Core/MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:32` · Level 2 · class (abstract)

- **What it is**: a base class for domain-event handlers that must log their own failure with handler
  and event context before the exception continues to the dispatcher. It wraps an abstract
  `HandleSafelyAsync` in an exception **filter** that writes one error line and then lets the
  exception propagate unchanged (lines 38-47); it does not swallow anything.
- **Depends on**: [`BaseDomainEvent`](#basedomainevent) (Level 1),
  [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent) (Level 1),
  `Microsoft.Extensions.Logging.ILogger` (external).
- **Concept introduced, log-and-propagate handlers and the at-least-once delivery contract.**
  `[Rubric §6, CQRS & Event-Driven]` assesses whether event delivery is reliable end to end, and the
  class comment (lines 13-20) records why the earlier swallow-and-log version was not: a handler that
  threw still reported success to the dispatcher, so its outbox row was marked processed, nothing
  ever retried, and the side effect was lost with only a log line to show for it. Propagating hands
  the decision to the delivery mechanism, which is built for exactly this.
  `[Rubric §29, Resilience & Business Continuity]`: on the [`OutboxProcessor`](#outboxprocessor) path
  the failed message keeps its retry count, backs off, and dead-letters after `Outbox:MaxRetries`
  attempts (default 5,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:21`; the
  increment/backoff/dead-letter branches are
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:440-470`).
  `[Rubric §13, Observability & Operability]`: the one job the base class keeps is the error line
  naming the concrete handler and the event type, so an operator can tell which handler failed for
  which event without every subclass hand-rolling that context. The consequence to design for is
  **batch** redelivery on the interceptor path (class comment, lines 21-29):
  `DomainEventSaveChangesInterceptor` dispatches every local event of one save in a single
  `DispatchAsync` call and only then marks that batch processed
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:306`
  and `:310`), so one rethrowing handler aborts that call and skips `MarkProcessedAsync` for the
  WHOLE local batch: every local event written by that save is redelivered by the outbox processor,
  not just the event whose handler failed. Delivery is therefore at-least-once and subclasses must be
  idempotent for their own event *and* for every sibling event raised by the same save.
- **Walkthrough**: primary constructor takes an `ILogger` (line 32), constrained
  `where TDomainEvent : BaseDomainEvent` (line 33). `HandleAsync` (line 36) awaits
  `HandleSafelyAsync` (line 40) inside
  `catch (Exception ex) when (ex is not OperationCanceledException && LogAndRethrow(ex))` (line 42):
  `OperationCanceledException` is excluded from the filter, so host shutdown propagates with no log
  line, because it is not a delivery failure. `LogAndRethrow` (line 61) logs the exception with
  `GetType().Name` and `typeof(TDomainEvent).Name` under the message
  `"Domain event handler {HandlerType} failed for event {EventType}. The outbox processor will redeliver the event."`
  (lines 63-67) and always returns `false` (line 69), so the filter never matches and the exception
  keeps propagating; the `throw;` inside the catch body is unreachable (lines 44-45). Doing the log
  in a *filter* rather than a catch block is the point: filters run on the first pass, ahead of any
  unwinding, so the handler context is recorded even if an outer frame wraps or rethrows, and the
  original stack trace stays untouched. `HandleSafelyAsync` (line 54) is the abstract method concrete
  subclasses implement.
- **Why it's built this way**: it puts the at-least-once contract of
  `ADRs/003-outbox-dual-dispatch.md` where that ADR expects the retry decision to live, in the
  delivery mechanism rather than in each handler: the handler reports the truth and the outbox
  decides on retry, backoff, and dead-lettering (the ADR's matching obligation is that handlers are
  idempotent, since the same event may be dispatched in-process and again by the processor). A failed
  handler still does not roll back the primary save, but that is now the caller's doing rather than
  the base class's: in
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs`
  the flush runs after the data is committed (dispatch is deferred while a transaction is open, lines
  285-292) and catches the propagated exception itself (line 315), logging "In-process domain event
  dispatch failed; the outbox processor will retry" (line 343) and signalling the processor so the
  unprocessed rows are picked up (lines 321-322).
- **Where it's used**: reached at runtime through [`DomainEventDispatcher`](#domaineventdispatcher),
  whichever caller dispatched the event (the save-changes interceptor after `SaveChangesAsync`,
  [`InProcessEventBus`](#inprocesseventbus) / [`InProcessMessageBus`](#inprocessmessagebus), or the
  background [`OutboxProcessor`](#outboxprocessor)). The only subclass in the workspace today is
  [`TestSafeDomainEventHandler`](group-27-testing-infrastructure.md#testsafedomaineventhandler),
  driven by
  [`SafeDomainEventHandlerTests`](group-27-testing-infrastructure.md#safedomaineventhandlertests)
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs`),
  which pin the three behaviours: log **and** propagate (line 33), the log lands before the caller
  sees the exception (line 51), and `OperationCanceledException` passes through unlogged (line 73).
- **Caveats / not-in-source**: the swallow-to-propagate history and the batch-redelivery contract come
  from the class remarks (lines 13-29), not from anything visible in the current control flow. The
  base class cannot enforce the idempotency it demands: that stays a subclass obligation with no
  compile-time or runtime guard. Not determinable from source: how a real side-effect handler behaves
  under redelivery, because no application (ADC, Store, or Helpdesk) derives from this base class
  today, so only the Common unit tests exercise it.

### DomainEventDispatcher
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/DomainEventDispatcher.cs:16` · Level 3 · class (sealed)

- **What it is**: the in-process implementation of [`IDomainEventDispatcher`](#idomaineventdispatcher):
  it dispatches each event to all registered `IDomainEventHandler<T>` instances and, if the event also
  implements [`IIntegrationEvent`](#iintegrationevent), to all registered
  [`IIntegrationEventHandler<T>`](#iintegrationeventhandlerin-tintegrationevent) instances. It uses
  **compiled expression-tree delegates cached per (event type, handler interface)** to eliminate
  per-dispatch reflection.
- **Depends on**: [`IDomainEvent`](#idomainevent),
  [`IDomainEventDispatcher`](#idomaineventdispatcher),
  [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent),
  [`IIntegrationEvent`](#iintegrationevent),
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent);
  externals `IServiceProvider`, `System.Linq.Expressions`, `ILogger<T>`.
- **Concept introduced, compiled expression-tree delegates for handler dispatch.**
  `[Rubric §12, Performance & Scalability]` (avoids reflection overhead on the hot
  post-`SaveChanges` path) and `[Rubric §6, CQRS & Event-Driven]` (events fan out to all registered
  handlers reliably). The problem: `IServiceProvider.GetServices(closedHandlerType)` (line 53) returns
  `object` instances, so calling `HandleAsync` on them would otherwise require reflection on every
  dispatch. The solution: on first encounter of a `(eventType, handlerInterfaceType)` pair,
  `BuildInvoker` (line 76) uses `Expression.Lambda` to compile a
  `Func<object, object, CancellationToken, Task>` that casts the `object` arguments to their concrete
  types and calls `HandleAsync` directly (lines 84-95). Subsequent dispatches of the same pair reuse
  the cached delegate, zero reflection.
- **Walkthrough**
  - `_serviceProvider` (line 18), null-checked in the field initializer.
  - `DispatchCache` (lines 26-28), a **static** `ConcurrentDictionary` keyed by
    `(Type EventType, Type HandlerInterface)` whose value is the tuple
    `(Type ClosedHandlerType, Func<object, object, CancellationToken, Task> Invoker)`; caching the
    closed handler type alongside the invoker keeps `Type.MakeGenericType` off the per-dispatch path
    (doc comment, lines 20-25). Being static, the warmed cache is shared process-wide and thread-safe.
  - `DispatchAsync` (line 31), null-guards the batch (line 33), then per event always dispatches to
    `IDomainEventHandler<>` (line 40) and dispatches to `IIntegrationEventHandler<>` only when the
    event is also an `IIntegrationEvent` (lines 43-44).
  - `DispatchToHandlersAsync` (line 48), `GetOrAdd`s the cached `(closedHandlerType, invoker)` pair
    with a `static` factory (lines 50-52), resolves all handlers (line 53), and awaits each via the
    invoker (line 63); a `null` resolved handler is logged as a likely DI misconfiguration and skipped
    (lines 57-61).
  - `BuildInvoker` (line 76), closes the open handler type (line 78), finds `HandleAsync` on it
    (line 79), builds `((IHandler<TEvent>)handler).HandleAsync((TEvent)event, ct)` as an expression
    (lines 84-92), and `Compile()`s it (lines 94-95).
- **Why it's built this way**: at-least-once domain-event delivery
  (`ADRs/003-outbox-dual-dispatch.md`) requires the dispatcher to run after each `SaveChangesAsync`;
  with many events per request on a busy session, reflection cost compounds, so the expression-tree
  cache makes dispatch near zero-cost after warm-up. Routing domain and integration events through one
  dispatcher (rather than two) keeps the in-process path uniform.
- **Where it's used**: registered as the `IDomainEventDispatcher` implementation; called by
  `ApplicationDbContext.SaveChangesAsync` after the outbox rows are written, by the background
  [`OutboxProcessor`](#outboxprocessor) when re-dispatching persisted events, and by both in-process
  buses ([`InProcessMessageBus`](#inprocessmessagebus), [`InProcessEventBus`](#inprocesseventbus)).

### BrokerEventBus
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/BrokerEventBus.cs:30` · Level 8 · class (sealed)

- **What it is**: the [`IEventBus`](#ieventbus) implementation for **microservice (broker)
  deployments**. It persists integration events to the outbox and signals the
  [`OutboxProcessor`](#outboxprocessor) to drain them, but does **not** dispatch in-process (the
  consumers live in other processes).
- **Depends on**: [`IEventBus`](#ieventbus) (Level 2),
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) (Level 7),
  [`IOutboxSignal`](#ioutboxsignal) (Level 0),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) (Level 3),
  [`OutboxSettings`](group-14-module-system-composition.md#outboxsettings) (Level 2),
  [`OutboxMessage`](#outboxmessage) (Level 1), [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept introduced, the broker half of dual-mode event publishing.** `[Rubric §6, CQRS &
  Event-Driven]`, `[Rubric §8, Data Architecture]` (the transactional outbox), and `[Rubric §29,
  Resilience & Business Continuity]`. The doc comment (lines 17-28) is explicit that this class differs
  from [`InProcessEventBus`](#inprocesseventbus) only in whether it dispatches synchronously after
  persistence: in-process mode writes outbox then dispatches; broker mode writes outbox then just
  signals the processor and returns, because in broker mode an in-process dispatch would be *incorrect*
  (no consumer is present locally). The [`OutboxProcessor`](#outboxprocessor) is the only correct
  delivery channel, publishing via [`IMessageBus`](#imessagebus) -> [`BrokerMessageBus`](#brokermessagebus)
  -> MassTransit -> broker.
- **Walkthrough**: primary constructor injects the DB-context factory, outbox signal, data-source
  resolver, and `IOptions<OutboxSettings>` (lines 30-34). `PublishAsync` (single, line 37) resolves the
  outbox's logical data source (line 41) and gets its context (line 42); if `!context.SupportsOutbox`
  (line 44, e.g. Cosmos) it throws an `InvalidOperationException` naming the misconfigured target
  rather than silently dropping the event (lines 49-50). Otherwise it builds an
  [`OutboxMessage`](#outboxmessage) via `FromDomainEvent` (line 53), `Add`s it (line 55, with a
  `VSTHRD103` suppression because EF's synchronous `Add` is intentional), saves (line 57), and calls
  `outboxSignal.Signal()` (line 61) to wake the processor immediately instead of waiting for the next
  poll. The batch overload (line 65) iterates the single overload.
- **Why it's built this way**: it enforces the transactional-outbox invariant of
  `ADRs/003-outbox-dual-dispatch.md` (persist atomically, publish later) while `ADRs/007-grpc-extraction.md`
  / `ADRs/008-service-extraction-topology.md` motivate keeping delivery entirely on the async broker
  path once a module is extracted. Throwing on a non-outbox data source makes the "broker mode needs an
  outbox-enabled store" constraint fail loudly at first publish.
- **Where it's used**: registered as the `IEventBus` implementation when `AddBrokerMessaging` runs,
  replacing [`InProcessEventBus`](#inprocesseventbus).

### InProcessEventBus
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/InProcessEventBus.cs:23` · Level 8 · class (sealed)

- **What it is**: the **default** [`IEventBus`](#ieventbus) implementation. It persists integration
  events to the outbox and then dispatches them in-process via
  [`IDomainEventDispatcher`](#idomaineventdispatcher), all modules running in the same process.
- **Depends on**: [`IEventBus`](#ieventbus) (Level 2),
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) (Level 7),
  [`IDomainEventDispatcher`](#idomaineventdispatcher) (Level 1),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) (Level 3),
  [`OutboxSettings`](group-14-module-system-composition.md#outboxsettings) (Level 2),
  [`OutboxMessage`](#outboxmessage) (Level 1),
  [`OutboxFinalizer`](#outboxfinalizer) (Level 6), [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept, the monolith half of dual-mode event publishing.** `[Rubric §6, CQRS & Event-Driven]`
  and `[Rubric §8, Data Architecture]`: the "persist to outbox in the same save, then dispatch, then
  mark processed" sequence is exactly the dual-dispatch of `ADRs/003-outbox-dual-dispatch.md`. A
  dispatch failure leaves every entry in the batch **unprocessed** so the
  [`OutboxProcessor`](#outboxprocessor) retries it (at-least-once; consumers stay idempotent via the
  inbox, doc comment lines 49-54).
- **Walkthrough**: primary constructor injects the DB-context factory, dispatcher, data-source
  resolver, and `IOptions<OutboxSettings>` (lines 23-27). Both public overloads funnel into the private
  `PublishBatchAsync` (line 55): the single overload wraps one event (line 34); the batch overload
  coerces the sequence to an array and returns early when empty (lines 42-44). `PublishBatchAsync`
  resolves the outbox target (line 57) and its context (line 58); if `!context.SupportsOutbox` (line
  60) it dispatches directly with **no** outbox persistence and returns (line 62). Otherwise it builds
  one [`OutboxMessage`](#outboxmessage) per event (lines 66-68), `AddRange`s them (line 71, with the
  same intentional-synchronous-`AddRange` suppression), saves data + outbox in one call (line 73),
  dispatches in-process (line 75), and marks the batch processed with a single set-based update via
  [`OutboxFinalizer.MarkProcessedAsync`](#outboxfinalizer) (line 77).
- **Why it's built this way**: writing the outbox row and the aggregate change in one
  `SaveChangesAsync` closes the dual-write gap; dispatching immediately afterward gives synchronous
  in-process reactions without giving up the durable retry path. The `SupportsOutbox` fast path keeps
  the framework usable on a store without an outbox table (dispatch-only) rather than failing.
- **Where it's used**: the default `IEventBus` registration; superseded by
  [`BrokerEventBus`](#brokereventbus) once `AddBrokerMessaging` is called.

### BrokerMessageBus

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/BrokerMessageBus.cs:24` · Level 3 · class (sealed)

- **What it is**: the [`IMessageBus`](#imessagebus) implementation backed by MassTransit (RabbitMQ
  locally, Azure Service Bus in production). Publishes integration events to the broker for
  cross-process / cross-service delivery; used by extracted microservices in place of
  [`InProcessMessageBus`](#inprocessmessagebus).
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent), [`IMessageBus`](#imessagebus);
  externally MassTransit's `IPublishEndpoint` (primer §3, "Messaging").
- **Concept introduced, MassTransit as the transport-agnostic broker, kept at the edge.**
  `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out of the monolith
  without rewriting application code; `[Rubric §6, CQRS & Event-Driven]` assesses at-least-once
  delivery of integration events. The [`IMessageBus`](#imessagebus) interface is defined up in
  `MMCA.Common.Application`, a deliberate architectural constraint: **`Application`, `Domain`, and
  `Shared` must never reference MassTransit directly** (fitness-tested by `MicroserviceExtractionTests`,
  see primer §4). `BrokerMessageBus` is the *only* place MassTransit crosses into first-party code,
  and it lives in Infrastructure, the outermost layer that is allowed to know the transport.
- **Walkthrough**
  - `PublishAsync(IIntegrationEvent, …)` (line 27): null-guards, then calls
    `publishEndpoint.Publish(integrationEvent, integrationEvent.GetType(), cancellationToken)`. The
    **runtime type** (not the `IIntegrationEvent` base interface) is passed explicitly (line 33) so
    MassTransit routes by the concrete event class, consumers bind to the concrete type, never to
    the base interface, so publishing as `IIntegrationEvent` would reach nobody.
  - `PublishAsync(IEnumerable<IIntegrationEvent>, …)` (line 37): iterates and awaits each single
    publish in turn (line 41–44).
  - The doc comment (lines 18–22) records that MassTransit automatically propagates the ambient
    `System.Diagnostics.Activity` as `traceparent`/`tracestate` message headers, so distributed
    tracing continues across the broker hop, `[Rubric §13, Observability & Operability]`.
- **Why it's built this way**: this bus does **not** itself write to the outbox. Transactional-outbox
  semantics are preserved by the [`OutboxProcessor`](#outboxprocessor): events are persisted to
  [`OutboxMessage`](#outboxmessage) in the *same DB transaction* as the aggregate change, then the
  processor drains them by calling this bus ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). Keeping `BrokerMessageBus` a thin publish
  adapter, with no outbox knowledge, is what lets the same outbox machinery serve both monolith and
  broker modes (ADRs 007/008).
- **Where it's used**: registered when `MessageBus:Provider` selects RabbitMQ or Azure Service Bus
  (see [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)); selected by
  `AddBrokerMessaging()` in each service host's `Program.cs`. Driven by the
  [`OutboxProcessor`](#outboxprocessor) in broker mode.

### InProcessMessageBus

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/InProcessMessageBus.cs:19` · Level 3 · class (sealed)

- **What it is**: the [`IMessageBus`](#imessagebus) implementation for the modular-monolith /
  integration-test case: dispatches integration events synchronously through the in-process
  [`IDomainEventDispatcher`](#idomaineventdispatcher). This is the default registration when no broker
  is configured.
- **Depends on**: [`IDomainEventDispatcher`](#idomaineventdispatcher),
  [`IIntegrationEvent`](#iintegrationevent), [`IMessageBus`](#imessagebus).
- **Concept reinforced, same interface, different transport.** `[Rubric §7, Microservices
  Readiness]`, application code injects [`IMessageBus`](#imessagebus) and never learns whether the
  events leave the process. Swapping the registration from this class to
  [`BrokerMessageBus`](#brokermessagebus) is the entire "go distributed" change for the publish path.
- **Walkthrough**: both overloads (lines 23, 30) null-guard then forward straight to
  `domainEventDispatcher.DispatchAsync([integrationEvent], …)` / `DispatchAsync(integrationEvents, …)`.
  No outbox write happens here: the doc comment (lines 12–18) is explicit that this bus is meant to be
  invoked by the [`OutboxProcessor`](#outboxprocessor) when draining *already-persisted* entries, or
  by paths that have already taken responsibility for outbox persistence, it is the in-process
  counterpart of [`BrokerMessageBus`](#brokermessagebus), not a "persist + dispatch" bus. Code wanting
  the persist-and-dispatch semantics uses [`IEventBus`](#ieventbus) instead.
- **Why it's built this way**: keeping the monolith path a single synchronous dispatcher call means
  integration tests need no broker container, and the common (monolith) deployment pays no broker
  latency. The outbox still provides the at-least-once safety net via the
  [`OutboxProcessor`](#outboxprocessor).
- **Where it's used**: registered when `MessageBus:Provider` is absent / `InProcess` (see
  [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)); the default in
  integration-test `WebApplicationFactory` configs. Swapped for [`BrokerMessageBus`](#brokermessagebus)
  in deployed service hosts.

### IntegrationEventConsumer<TEvent>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/IntegrationEventConsumer.cs:26` · Level 3 · class (sealed, partial)

- **What it is**: a single generic MassTransit `IConsumer<TEvent>` that bridges broker-delivered
  messages to the existing [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
  contract, resolving every registered handler from the per-message DI scope and adding
  **consumer-side inbox idempotency** via [`IInboxStore`](#iinboxstore).
- **Depends on**: [`IInboxStore`](#iinboxstore),
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent),
  [`IIntegrationEvent`](#iintegrationevent); externally MassTransit's `IConsumer<T>`/`ConsumeContext<T>`
  and `ILogger<T>` (with source-generated `[LoggerMessage]` logging).
- **Concept introduced, the consumer-side inbox for broker idempotency.** `[Rubric §29, Resilience,
  Reliability & Business Continuity]` assesses at-least-once delivery paired with *idempotent
  consumers*; `[Rubric §6, CQRS & Event-Driven]` assesses idempotent integration-event handling.
  MassTransit guarantees at-least-*once* delivery, the same message can arrive twice after a consumer
  crash or broker redelivery. The inbox makes that safe: `inbox.AlreadyProcessedAsync(MessageId, …)`
  (line 42) checks whether this event's `MessageId` (the idempotency key carried by
  [`IDomainEvent`](#idomainevent)) was already recorded, and if so logs at Debug and returns (acking
  the message) without re-running handlers. After all handlers succeed,
  `inbox.MarkProcessedAsync(MessageId, …)` (line 78) records it. Recording *after* success is the key
  ordering: a handler failure rethrows before the mark, leaving the message un-recorded and eligible
  for redelivery.
- **Walkthrough**
  - Idempotency short-circuit (line 42–46): duplicate → `LogDuplicateSkipped` (line 44) → return (ack,
    do not dead-letter).
  - Handler loop (line 50–66): invokes each resolved `IIntegrationEventHandler<TEvent>` in turn; on any
    non-`OperationCanceledException` it logs `LogHandlerFailure` (line 63) naming the failing handler,
    then **rethrows** so MassTransit's `UseMessageRetry` policy (exponential backoff,
    `MessageBusSettings.RetryLimit` attempts, configured in `ConfigureBrokerTransport`) fires before
    dead-lettering.
  - No-handler case (line 68–74): if zero handlers were registered for the event in this process, logs
    `LogNoHandlers` at Information and returns normally, the broker acks (no retry storm) but the
    misconfigured service host is still visible in telemetry.
  - Mark-processed (line 78): records the `MessageId` only on the success path.
  - Three `[LoggerMessage]` partials (lines 81–88) are the source-generated, allocation-free log
    methods, `[Rubric §13, Observability & Operability]`.
- **Why it's built this way**: application code keeps writing plain
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
  implementations (auto-discovered as singletons by `ScanModuleApplicationServices`); there is **no
  per-event MassTransit consumer class to author**. This one universal adapter is registered once per
  event type via [`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions), which
  keeps the MassTransit dependency out of the handlers and out of the Application layer ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) for
  the inbox/outbox guarantee; ADRs 007/008 for the extraction boundary).
- **Where it's used**: registered in each broker-mode service host's MassTransit configuration for
  every integration event the service consumes (e.g. Conference consuming `UserRegistered`; Identity
  consuming `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser`).

### IntegrationEventConsumerExtensions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs:11` · Level 4 · class (static)

- **What it is**: a C# `extension(IBusRegistrationConfigurator)` that adds a fluent
  `RegisterIntegrationEventConsumer<TEvent>()` method, hiding the MassTransit consumer-registration
  plumbing behind one clean call.
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent),
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent); externally MassTransit's
  `IBusRegistrationConfigurator`.
- **Concept reinforced, C# 14 `extension(T)` members for registration sugar (primer §4), and keeping
  MassTransit at the edge.** `[Rubric §7, Microservices Readiness]`, the host registers a consumer
  with `config.RegisterIntegrationEventConsumer<TEvent>()` and never spells out the
  `IntegrationEventConsumer<T>` MassTransit type, so the registration call site stays decoupled from the
  concrete consumer; `[Rubric §6, CQRS & Event-Driven]` (one registration per consumed event type wires
  the at-least-once, idempotent delivery path).
- **Walkthrough**: the `extension(IBusRegistrationConfigurator x)` block (line 13) adds
  `RegisterIntegrationEventConsumer<TEvent>()` (line 22): it calls
  `x.AddConsumer<IntegrationEventConsumer<TEvent>>()` (line 25) and returns the configurator for
  chaining. The `where TEvent : class, IIntegrationEvent` constraint (line 23) keeps registration
  limited to real integration events.
- **Why it's built this way**: each service host's `Program.cs` calls this once per integration event
  type it consumes. Hiding `AddConsumer` keeps the host from coupling to the concrete consumer type;
  `MicroserviceExtractionTests` (primer §4) enforces that Application/Domain never reference MassTransit
  directly, so the boundary stays clean (ADRs 007/008).
- **Where it's used**: in each broker-mode service's `Program.cs` configure-consumers callback (e.g.
  `config.RegisterIntegrationEventConsumer<SpeakerLinkedToUser>()`).

### BrokerEventBus, InProcessEventBus

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · Level 8 · class (sealed)

These two [`IEventBus`](#ieventbus) implementations are the publish entry point that integration-event
producers (link handlers, `AuthenticationService`, republish handlers) inject directly. They are
**structurally parallel**, both
persist an [`OutboxMessage`](#outboxmessage) to the outbox-owning data source in the *same* save, and
differ **only** in what they do *after* persisting.

| Type | File:Line | Mode (what differs after the outbox write) |
|------|-----------|--------------------------------------------|
| `InProcessEventBus` | `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/InProcessEventBus.cs:23` | monolith, write outbox → **dispatch in-process** via [`IDomainEventDispatcher`](#idomaineventdispatcher) → mark row processed |
| `BrokerEventBus` | `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/BrokerEventBus.cs:30` | microservice, write outbox → **signal** the [`OutboxProcessor`](#outboxprocessor) → return (no in-process dispatch) |

- **What they are**: the concrete [`IEventBus`](#ieventbus) for the two deployment shapes. Whichever
  one is registered, callers see the identical interface, so producing code never changes when a module
  moves from monolith to extracted service.
- **Depends on**: both take [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), and
  `IOptions<`[`OutboxSettings`](group-14-module-system-composition.md#outboxsettings)`>`;
  `InProcessEventBus` additionally takes [`IDomainEventDispatcher`](#idomaineventdispatcher),
  `BrokerEventBus` additionally takes [`IOutboxSignal`](#ioutboxsignal). Both produce
  [`OutboxMessage`](#outboxmessage) rows and depend on [`IIntegrationEvent`](#iintegrationevent).
- **Concept introduced, the outbox dual-dispatch boundary ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) and the in-process/broker switch
  (ADRs 007/008).** `[Rubric §6, CQRS & Event-Driven]` (transactional outbox = atomic write +
  publish), `[Rubric §7, Microservices Readiness]` (one interface, two transports), `[Rubric §8,
  Data Architecture]` (the outbox is the cross-source consistency mechanism in database-per-service,
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Both implementations resolve the outbox target the same way
  (`dataSourceResolver.ResolveLogical(OutboxSettings.DataSource, .DatabaseName)`, `InProcess` line 34 /
  `Broker` line 41), fetch the context for that source, and act on `context.SupportsOutbox`:
  - `InProcessEventBus.PublishAsync` (lines 30–51): when the source supports the outbox it adds an
    [`OutboxMessage`](#outboxmessage) (line 39–40), saves it (line 41), **immediately dispatches the
    event in-process** via [`IDomainEventDispatcher`](#idomaineventdispatcher) (line 43), then stamps
    `outboxEntry.ProcessedOn = DateTime.UtcNow` and saves again (lines 45–46). So the happy path is
    fast and the [`OutboxProcessor`](#outboxprocessor) is only a retry safety net if that in-process
    dispatch failed (leaving the row un-processed). When the source has no outbox (e.g. Cosmos), it
    falls back to a plain in-process dispatch (line 50).
  - `BrokerEventBus.PublishAsync` (lines 37–60): writes the [`OutboxMessage`](#outboxmessage) (line
    53–54), saves it (line 55), and **signals** the processor (`outboxSignal.Signal()`, line 59) so the
    broker publish doesn't wait for the next poll cycle, but it does **not** dispatch, because in
    broker mode the consumers live in *other processes*; the [`OutboxProcessor`](#outboxprocessor)'s
    broker-publish path (via [`BrokerMessageBus`](#brokermessagebus)) is the only correct delivery
    channel. If the configured outbox source lacks outbox support it **throws
    `InvalidOperationException`** (lines 44–51) naming the offending `Outbox:DataSource` /
    `Outbox:DatabaseName` rather than silently dropping events, broker mode is incompatible with a
    non-outbox source.
  - Both batch overloads (`InProcess` line 54 / `Broker` line 63) iterate and await each single publish.
- **Why it's built this way**: [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html): persisting the [`OutboxMessage`](#outboxmessage) in the same
  transaction as the aggregate change makes delivery atomic with the business write (no "save then
  publish and hope" dual-write bug). Offering both a synchronous in-process path and a broker path
  behind one [`IEventBus`](#ieventbus) is exactly what lets a module move from monolith to extracted
  service without touching any publishing code, `AddBrokerMessaging` simply swaps the registration,
  config-driven by `MessageBus:Provider` (see
  [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)).
- **Where they're used**: every [`IEventBus`](#ieventbus) injection resolves one of these; called by ADC's link handlers,
  `UserRegisteredHandler`'s republish, and `AuthenticationService`.


---
[⬅ Querying: Specifications, Filtering & the Entity Query Service](group-03-querying-specifications.md)  •  [Index](00-index.md)  •  [CQRS: Commands, Queries & the Decorator Pipeline ➡](group-05-cqrs-pipeline.md)
