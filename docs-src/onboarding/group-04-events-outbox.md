# 4. Domain & Integration Events + Outbox Dual-Dispatch

**What this chapter covers.** This group is the codebase's *event spine*: how an aggregate says
"something happened," how that fact is persisted so it cannot be lost, and how it eventually reaches
every interested handler, whether that handler lives in the same process or in an extracted
microservice across a broker. Two questions drive the whole design. *How do we publish events
reliably when persistence and dispatch are separate steps that can each fail independently?* And *how
do we keep application code identical whether the module ships inside the monolith or as its own
service?* The answer to the first is the **transactional outbox with dual dispatch** (ADR-003); the
answer to the second is a **transport-agnostic message bus** plus a consumer-side **inbox** (ADR-006,
ADR-008, ADR-021). The types here implement both, top to bottom: the event contracts, the in-process
dispatcher, the outbox tables and their background drainers, and the swappable in-process/broker
buses.

If you have not yet met the **Result pattern**, **aggregate roots and domain events**, or the
**database-per-service** rule, skim [primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to)
first, this chapter builds directly on them.

## The two kinds of event

Everything starts with two marker interfaces in the Domain layer. [`IDomainEvent`](#idomainevent) is
the base contract: a `DateOccurred` timestamp (when the *business* action happened, not when it was
dispatched, `IDomainEvent.cs:10`) and a `MessageId` GUID used for consumer-side deduplication
(`IDomainEvent.cs:13`). [`IIntegrationEvent`](#iintegrationevent) *extends* `IDomainEvent` and adds no
members (`IIntegrationEvent.cs:15`), it is a pure role marker. The distinction is semantic and
load-bearing: a **domain event** is *intra-module* (raised and handled inside one bounded context,
`OrderPaid` consumed by the Sales module that raised it); an **integration event** is *inter-module*
(one module publishes, others react). Because integration events *are* domain events, they flow
through the exact same outbox machinery, the system never needs a second delivery pipeline.

The base records supply the defaults. [`BaseDomainEvent`](#basedomainevent) stamps `DateOccurred` at
construction (`BaseDomainEvent.cs:20`) and mints a fresh `MessageId` (`BaseDomainEvent.cs:27`), both
`init` so a deserialized event keeps the values it was created with.
[`BaseIntegrationEvent`](#baseintegrationevent) adds a `virtual SchemaVersion` defaulting to `1`
(`BaseIntegrationEvent.cs:22`): additive field changes keep the version, but a breaking change (a
renamed, removed, or retyped field) requires a NEW event type plus a consumer-side upcaster, never a
silent reshape of an existing contract (ADR-010). [`EntityChangedEvent<TIdentifierType>`](#entitychangedeventtidentifiertype)
is a reusable CRUD-lifecycle event carrying a [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate)
(Added/Updated/Deleted) and the affected `EntityId` (`EntityChangedEvent.cs:24-27`), so entities do
not each hand-roll three near-identical event records. This split, markers and base records in
`Domain`, all dispatch and persistence machinery in `Application`/`Infrastructure`, is textbook
`[Rubric §3, Clean Architecture]` (the domain declares *what* an event is; outer layers decide *how*
it travels) and `[Rubric §6, CQRS & Event-Driven]` (an explicit, first-class event model rather than
implicit side effects). The `SchemaVersion` convention is the `[Rubric §9, API & Contract Design]`
angle: an event on the wire is a versioned contract like any API surface.

## Raising and capturing: where the outbox is written

Aggregates raise events by calling `AddDomainEvent()` (see
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
in G02), which simply buffers them on the entity. Nothing is dispatched yet, the events ride along
until the next save. The actual capture happens in EF Core's save pipeline, in
[`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
(G07). On `SavingChanges` it scans the change tracker for aggregate roots with buffered events, calls
[`OutboxMessage.FromDomainEvent(...)`](#outboxmessage) on each (serializing the event to JSON,
capturing its assembly-qualified type name and the current W3C trace/span IDs, `OutboxMessage.cs:59-73`),
and `Add`s those [`OutboxMessage`](#outboxmessage) rows to the *same* `DbContext`, so the outbox row
and the aggregate change land in **one atomic transaction**
(`DomainEventSaveChangesInterceptor.cs:79-108`). This is the single most important guarantee in the
chapter: if the business data committed, the event is durably recorded; if the transaction rolled
back, neither exists. There is no window where they disagree. `[Rubric §8, Data Architecture]`
(transactional integrity) and `[Rubric §6]` both hinge on this atomicity. Crucially, the rows go to
the same physical database as the aggregate, every relational source owns its own `OutboxMessages`
table, never a shared one (ADR-006; see [primer on database-per-service](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).

## Dual dispatch: the happy path and the safety net

Right after the transaction commits (`SavedChanges`), the interceptor dispatches the captured events
**in-process** through [`IDomainEventDispatcher`](#idomaineventdispatcher), then marks the outbox rows
`ProcessedOn` (`DomainEventSaveChangesInterceptor.cs:114-143`). That mark is *not* a second nested
`SaveChanges`: it goes through [`OutboxFinalizer`](#outboxfinalizer), which stamps every row in the
batch with a single set-based `ExecuteUpdate` and then re-syncs the change tracker so a later save
does not re-issue the statement (`OutboxFinalizer.cs:21-48`), keeping the hottest write path (every
event-raising command) free of an extra full save. That is *dispatch #1*, the low-latency happy path.
Dispatch #2 is the background [`OutboxProcessor`](#outboxprocessor): a `BackgroundService` that drains
still-unprocessed outbox rows and delivers them too. Why both? Because the steps between *commit* and
*mark-processed* can be interrupted, the process can crash, or in-process dispatch can throw. If that
happens, the row stays unprocessed (and the interceptor signals the processor on the failure path,
`DomainEventSaveChangesInterceptor.cs:133-136`) and the background processor catches it on its next
cycle. This is the **dual-dispatch** strategy of ADR-003: at-least-once delivery (`[Rubric §6]`,
`[Rubric §29, Resilience & Business Continuity]`). The unavoidable cost is that the *same* event may
be delivered twice (in-process *and* by the processor, if the mark-processed step lost the race), so
**handlers must be idempotent**. That is not a wart; it is the documented contract (ADR-003) and a
healthy discipline regardless.

The dispatcher itself ([`DomainEventDispatcher`](#domaineventdispatcher)) is a small
performance-conscious piece of machinery. For each event it resolves every registered
[`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent) and, if the event is
also an integration event, every
[`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
(`DomainEventDispatcher.cs:35-45`), invoking each through a **compiled expression-tree delegate cached
per (event type, handler interface)** so the generic `HandleAsync` call avoids reflection and boxing at
runtime (`DomainEventDispatcher.cs:26-28,76-96`), relevant to `[Rubric §12, Performance &
Scalability]`. Handlers that perform side effects (email, downstream writes) should derive from
[`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent), which catches and logs
handler exceptions (`SafeDomainEventHandler.cs:18-32`) so a failed side effect never rolls back the
primary business transaction, the outbox retry is the recovery mechanism instead.

## How the processor schedules itself: signal + smart wait

The [`OutboxProcessor`](#outboxprocessor) is the most intricate type in the group, and most of its
complexity is about **not** wasting work. It never blindly polls on a fixed clock. Each cycle it
drains every relational source's outbox once and returns an [`OutboxCycleResult`](#outboxcycleresult)
describing what it found (`OutboxProcessor.cs:162-193`), then waits on [`IOutboxSignal`](#ioutboxsignal)
for whichever comes first: a **signal** (a writer called `Signal()` after persisting a row,
[`OutboxSignal`](#outboxsignal) is a `SemaphoreSlim(0)` wrapper, `OutboxSignal.cs:9-41`), the moment
the earliest pending-but-not-yet-eligible row *becomes* eligible (the **smart wait**), or a fallback
`PollingIntervalSeconds` (`OutboxProcessor.cs:100-137`). Rows are only eligible `ProcessingDelaySeconds`
(default 5s, `OutboxSettings.cs:40`) after creation; that delay is deliberate: it gives the in-process
happy path time to mark the row processed before the processor would re-deliver it, bounding the
duplicate-delivery window. The smart wait means that even when the fallback interval is set high in
production (e.g. 300s, to cut idle DB chatter and telemetry cost), an event still goes out about 5s
after it was written.

Delivery failures split into two very different outcomes, worth keeping straight. A *transient* failure
(a handler or broker publish throwing) increments the row's `RetryCount` and records `LastError`
(`OutboxProcessor.cs:303-309`); the poll query only ever selects rows with `RetryCount < MaxRetries`
(5 by default, `OutboxProcessor.cs:221`, `OutboxSettings.cs:21`), so once a row exhausts its retries it
simply stops being fetched, stalling unprocessed with its last error for investigation, it is neither
deleted nor marked processed. The *other* outcome is a genuine **dead-letter**: a row whose stored
`EventType` can no longer be resolved to a CLR type (deserialize returns null) is marked processed
immediately, tagged with a `LastError`, and counted on the `outbox.dead_letter.count` OpenTelemetry
counter (`OutboxProcessor.cs:277-284,60-63`), so an undeliverable payload cannot block the queue behind
it. This is dense `[Rubric §13, Observability & Operability]` and `[Rubric §31, Cost/FinOps]` territory:
the poll query runs inside a named `OutboxPoll` activity that
[`OutboxPollFilterProcessor`](group-16-aspire-orchestration.md#outboxpollfilterprocessor) (G16)
suppresses from telemetry export (`OutboxProcessor.cs:206-226`), so a fleet of idle services polling
around the clock does not flood Application Insights. A sibling
[`OutboxCleanupService`](#outboxcleanupservice) purges processed rows older than `RetentionDays`
(default 7, `OutboxCleanupService.cs:76-114`, `OutboxSettings.cs:65`), keeping the table bounded and,
because payloads may contain personal data, supporting the privacy posture of ADR-005.

## The pluggable transport: in-process vs. broker

Here is the seam that makes a module extractable without rewriting its handlers. Application code that
wants to publish an integration event depends on [`IMessageBus`](#imessagebus) (defined in
`Application`, so it never sees MassTransit) or on the higher-level [`IEventBus`](#ieventbus) /
[`IIntegrationEventPublisher`](#iintegrationeventpublisher). Infrastructure supplies two
interchangeable implementations of each, selected by configuration:

- **Monolith mode.** [`InProcessEventBus`](#inprocesseventbus) writes the event to the outbox,
  dispatches it in-process, and marks it processed through the same [`OutboxFinalizer`](#outboxfinalizer)
  path as the interceptor (`InProcessEventBus.cs:55-78`). [`InProcessMessageBus`](#inprocessmessagebus)
  just hands the event straight to the dispatcher (`InProcessMessageBus.cs:20-34`), it is what the
  `OutboxProcessor` calls when draining an integration-event row in monolith mode.
- **Broker mode.** [`BrokerEventBus`](#brokereventbus) writes the event to the outbox and **signals
  the processor but does not dispatch in-process** (`BrokerEventBus.cs:37-62`), because the consumers
  live in other processes, an in-process dispatch would be wrong. The `OutboxProcessor` then drains the
  row and publishes it through [`BrokerMessageBus`](#brokermessagebus), which hands it to MassTransit
  using the event's runtime type (`BrokerMessageBus.cs:24-34`) to RabbitMQ (dev) / Azure Service Bus
  (prod). MassTransit propagates the trace context across the broker hop, so distributed traces stay
  connected.

The selection between these is a pure DI swap, no application or domain code changes. That is the whole
point of `[Rubric §7, Microservices Readiness]`: transport choices live at the edges, and the
NetArchTest extraction rules forbid `Application`/`Domain`/`Shared` from referencing MassTransit at all
(see ADR-007/008). Note the deliberate division of labor: the **`*EventBus`** types own *outbox
persistence* (write + signal); the **`*MessageBus`** types own *delivery only* and are invoked by the
processor when draining already-persisted rows. The thin
[`IntegrationEventPublisher`](#integrationeventpublisher) adapter exists to preserve the older
`IIntegrationEventPublisher` contract over whichever `IEventBus` is registered
(`IntegrationEventPublisher.cs:12-17`).

## Consuming from the broker: the inbox and the generic consumer

On the receiving side of a broker hop, application code keeps writing plain
`IIntegrationEventHandler<TEvent>` implementations, there is no MassTransit-specific consumer class to
author per event. The generic [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) is
the single adapter that bridges MassTransit's `IConsumer<TEvent>` to all the registered in-process
handlers (`IntegrationEventConsumer.cs:33-79`), registered per event type via
[`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions)'s
`RegisterIntegrationEventConsumer<TEvent>()` (`IntegrationEventConsumerExtensions.cs:22-27`). Because
broker delivery is *also* at-least-once, the consumer guards against duplicates with the **inbox**
(ADR-021): [`IInboxStore`](#iinboxstore)'s `AlreadyProcessedAsync` is checked before invoking handlers
and `MarkProcessedAsync` is written *after* they succeed (recording the event's `MessageId` in an
[`InboxMessage`](#inboxmessage) row, `IntegrationEventConsumer.cs:42-78`). When the inbox is disabled
the no-op [`NoOpInboxStore`](#noopinboxstore) is registered so behavior is unchanged
(`NoOpInboxStore.cs:7-14`); when enabled, [`EfInboxStore`](#efinboxstore) persists dedup records to the
consumer service's own database, relying on a unique index on `MessageId` to shrug off a concurrent
duplicate insert (`EfInboxStore.cs:34-56`). Recording happens *after* handlers succeed so that a
handler failure leaves the message un-recorded and eligible for MassTransit's retry/dead-letter policy.
The outbox is the *producer-side* idempotency mechanism; the inbox is its *consumer-side* mirror,
together they make the cross-service event flow exactly-once-effective on top of at-least-once transport
(`[Rubric §6]`, `[Rubric §29]`).

## Putting it together, one event's life

To see the whole spine at once, follow a single integration event from a Sales handler to a Catalog
handler in **broker mode**. (1) Something has already happened in Sales (a command mutated an aggregate,
whose domain events were captured to the outbox and dispatched in-process by the interceptor); one of
those in-process handlers, or the command handler itself, publishes an `OrderPaidIntegrationEvent`
through [`IEventBus`](#ieventbus). (2) In broker mode the registered `IEventBus` is
[`BrokerEventBus`](#brokereventbus): it serializes the event into an [`OutboxMessage`](#outboxmessage),
saves that row, and calls `Signal()`, deliberately *not* dispatching in-process. (3) The signal wakes
the [`OutboxProcessor`](#outboxprocessor) immediately (otherwise the smart wait or fallback interval
would). (4) Once the row is eligible (after `ProcessingDelaySeconds`), the processor reads it,
deserializes it, sees it is an [`IIntegrationEvent`](#iintegrationevent), and publishes it through
[`IMessageBus`](#imessagebus) to [`BrokerMessageBus`](#brokermessagebus) to MassTransit to the broker,
then marks the row processed. (5) In the Catalog service,
[`IntegrationEventConsumer<OrderPaidIntegrationEvent>`](#integrationeventconsumertevent) receives it,
asks the [`IInboxStore`](#iinboxstore) whether that `MessageId` was already handled, runs every
`IIntegrationEventHandler<OrderPaidIntegrationEvent>`, and records the `MessageId` so a redelivery is
skipped. (6) Back on the producer, [`OutboxCleanupService`](#outboxcleanupservice) eventually purges the
processed row. In monolith mode steps 3 to 5 collapse into the in-process dispatcher (the registered
`IEventBus` is [`InProcessEventBus`](#inprocesseventbus), which writes, dispatches, and finalizes in one
call), but the *contracts the application code touches never change*, which is exactly the property that
lets a module graduate to its own service without a rewrite (ADR-008). For the mechanics of *why* each
design choice was made, ADR-003 (dual dispatch), ADR-006 (per-service outbox), ADR-010 (event
versioning), ADR-021 (consumer inbox), and ADR-007/008 (transport at the edge) are the primary
references.

### IDomainEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IDomainEvent.cs:7` · Level 0 · interface

- **What it is**: the marker contract for **domain events**: something meaningful happened inside an
  aggregate boundary, to be dispatched after successful persistence.
- **Depends on**: nothing first-party (BCL `DateTime`/`Guid` only).
- **Concept introduced, domain events + idempotency keys.** `[Rubric §6, CQRS & Event-Driven]`
  (assesses reliable events; idempotent consumers; events carrying enough context) and `[Rubric §4,
  DDD]` (aggregates raise events on state change). An aggregate doesn't call other modules directly;
  it *records* that something happened (e.g. "SessionScored") as an `IDomainEvent`, and the framework
  dispatches it after the data is safely saved, the basis of the **Outbox pattern** (ADR-003).
- **Walkthrough**: two properties: `DateOccurred` (`IDomainEvent.cs:10`) is *when the action happened*
  (not when dispatched), and `MessageId` (a `Guid`, line 13) is a unique per-instance id used for
  **consumer-side idempotency** (inbox dedup), so a redelivered event is processed once. That
  `MessageId` is what makes consumers safe under at-least-once delivery; it is minted at event creation
  by [`BaseDomainEvent`](#basedomainevent), survives outbox serialization, travels through the broker,
  and lands in an [`InboxMessage`](#inboxmessage) as the dedup key (ADR-021).
- **Why it's built this way**: a minimal marker keeps the domain free of dispatch mechanics; the two
  fields are exactly what the outbox/inbox machinery needs (ordering by occurrence, dedup by id).
- **Where it's used**: implemented by concrete domain events in each module; raised by
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype),
  captured from aggregates during `SaveChangesAsync`, serialized to [`OutboxMessage`](#outboxmessage),
  and dispatched by [`IDomainEventDispatcher`](#idomaineventdispatcher) + the
  [`OutboxProcessor`](#outboxprocessor).

### IInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/IInboxStore.cs:9` · Level 0 · interface

- **What it is**: the consumer-side idempotency port: it lets a broker consumer detect and skip an
  integration event that this service has already processed, guarding against at-least-once
  redelivery.
- **Depends on**: nothing first-party (BCL `Guid`/`Task`). Conceptually keyed by
  [`IDomainEvent`](#idomainevent)'s `MessageId`; backed by [`InboxMessage`](#inboxmessage) rows in the
  EF implementation.
- **Concept introduced, the consumer-side Inbox (ADR-021).** `[Rubric §6, CQRS & Event-Driven]`
  (idempotent consumers) and `[Rubric §29, Resilience & Business Continuity]` (assesses tolerance of
  duplicate/redelivered messages). The *inbox* is the consumer-side complement to the *outbox*. Every
  reliable broker guarantees **at-least-once** delivery, so the same message can arrive more than once
  after a transient failure. The inbox records the message ids it has successfully processed; on
  redelivery `AlreadyProcessedAsync` returns `true` and the consumer discards the duplicate without
  re-running side effects. The default registration is a **no-op** ([`NoOpInboxStore`](#noopinboxstore));
  the EF-backed [`EfInboxStore`](#efinboxstore) is registered only when `MessageBus:EnableInbox=true`
  (the doc comment, `IInboxStore.cs:6-7`, states this).
- **Walkthrough**: two async members: `AlreadyProcessedAsync(Guid messageId, ...)` (`IInboxStore.cs:12`),
  a keyed lookup by the event's `MessageId`; and `MarkProcessedAsync(Guid messageId, string eventType,
  ...)` (line 15), which records the processed id (and the type name, for diagnostics).
- **Why it's built this way**: the port lets the no-op and EF-backed implementations be swapped by
  configuration (`MessageBus:EnableInbox`) without touching consumer code, a §6/§10
  dependency-inversion win; **ADR-021** records this opt-in inbox as the broker-consume sibling of
  ADR-003's outbox (producer side) and ADR-017's HTTP-edge idempotency, deduping broker redeliveries
  by `MessageId` in the consumer's own database with a unique index as the race guard. See
  [`NoOpInboxStore`](#noopinboxstore) for the Null-Object default.
- **Where it's used**: consumed by [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  (the broker consumer base, this group); implemented by [`EfInboxStore`](#efinboxstore) (Level 8) and
  [`NoOpInboxStore`](#noopinboxstore) (Level 1).

### InboxMessage
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/InboxMessage.cs:8` · Level 0 · class (sealed)

- **What it is**: a deduplication record: "this service already processed the integration event with
  this `MessageId`." It is an EF entity that lives in the consumer service's *own* database (mirroring
  the outbox).
- **Depends on**: nothing first-party (BCL only). Its `MessageId` carries
  [`IDomainEvent`](#idomainevent)'s id semantics, and it is read/written through
  [`IInboxStore`](#iinboxstore).
- **Concept introduced, the inbox row (idempotency table).** `[Rubric §6, CQRS & Event-Driven]`
  (idempotent consumers) and `[Rubric §8, Data Architecture]` (deliberate dedup table per service).
  Before processing an integration event, [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  asks [`IInboxStore.AlreadyProcessedAsync`](#iinboxstore); after a successful handle it calls
  `MarkProcessedAsync`, which inserts one of these rows. Because the table lives in the consumer's own
  DB, the dedup respects the database-per-service boundary (ADR-006).
- **Walkthrough**: four `init`-only properties (`InboxMessage.cs:11-20`): `Id` (surrogate `Guid` PK,
  defaulted to `Guid.NewGuid()`, line 11) is the EF key; `MessageId` (`required`, line 14) is the
  event's own id, the **deduplication key**, carrying a unique index in the EF config; `EventType`
  (`required`, line 17) is retained for diagnostics; `ProcessedOn` (line 20) is the UTC timestamp
  stamped at mark time.
- **Why it's built this way**: separating `Id` (PK for EF internals) from `MessageId` (the business
  dedup key with the unique index) follows the same surrogate-key convention the codebase uses
  elsewhere; storing it as a plain entity lets the same EF stack purge it (see
  [`OutboxCleanupService`](#outboxcleanupservice)). **ADR-021** governs this mechanism: the unique
  index on `MessageId` is the concurrency guard a racing duplicate delivery trips, and the row lives in
  the consumer's own database (ADR-006).
- **Where it's used**: written/read by [`EfInboxStore`](#efinboxstore); purged by
  [`OutboxCleanupService`](#outboxcleanupservice) when the inbox is enabled; an EF configuration class
  applies its unique index.
- **Caveats / not-in-source**: the source has **no** first-party reference (it is a plain POCO), so
  the links to `IInboxStore`/`IDomainEvent` above are conceptual, not compile dependencies.

### IOutboxSignal
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/IOutboxSignal.cs:8` · Level 0 · interface

- **What it is**: a wake-up signal between the producer (the code that commits outbox rows) and the
  [`OutboxProcessor`](#outboxprocessor) background service, so the processor wakes the instant new rows
  are written instead of sleeping out a fixed polling interval.
- **Depends on**: nothing first-party (BCL `TimeSpan`/`Task`). Implemented by
  [`OutboxSignal`](#outboxsignal) (a `SemaphoreSlim`).
- **Concept introduced, event-driven wake vs. fixed polling.** `[Rubric §12, Performance &
  Scalability]` (assesses latency under load), `[Rubric §29, Resilience]`, and `[Rubric §31, Cost
  Efficiency / FinOps]` (assesses idle resource burn). Without a signal, the processor would poll the
  DB on a fixed schedule, up to 300s in production (ADR-003). Instead, the producer calls `Signal()`
  immediately after committing outbox entries; the processor is parked on `WaitAsync(timeout, ct)` and
  returns at once. This collapses dispatch latency from "up to the polling interval" to near-zero in
  the common case, while the timeout remains a safety net **and** keeps idle DB chatter (and its
  telemetry cost) low.
- **Walkthrough**: `Signal()` (`IOutboxSignal.cs:11`) is synchronous and unblocks any waiter; it is
  safe to call from the same thread that just finished `SaveChangesAsync`. `WaitAsync(TimeSpan timeout,
  CancellationToken ct)` (line 20) is what the processor loop awaits at the top of every cycle,
  returning when either signalled or the timeout elapses.
- **Why it's built this way**: keeping it an interface lets tests inject a controllable signal to
  drive the processor deterministically without real timers (a §14 testability seam).
- **Where it's used**: `Signal()` is called by [`BrokerEventBus`](#brokereventbus)/[`InProcessEventBus`](#inprocesseventbus)
  after writing an outbox row and by the `SaveChanges` event-capture path; `WaitAsync` is awaited by
  the [`OutboxProcessor`](#outboxprocessor) loop, with the wait duration computed from
  [`OutboxCycleResult`](#outboxcycleresult).

### OutboxCycleResult
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCycleResult.cs:19` · Level 0 · record struct (internal, readonly)

- **What it is**: the outcome of one outbox processing cycle, used by the
  [`OutboxProcessor`](#outboxprocessor) to decide how long to wait before the next cycle.
- **Depends on**: nothing first-party (BCL `bool`/`DateTime?`). Consumed by the processor, which
  feeds the computed wait to [`IOutboxSignal.WaitAsync`](#ioutboxsignal).
- **Concept introduced, the smart-wait input.** `[Rubric §12, Performance & Scalability]`,
  `[Rubric §29, Resilience]`, `[Rubric §31, Cost Efficiency]`. Two fields drive two distinct wait
  policies (the XML doc, `OutboxCycleResult.cs:7-18`, spells both out): `HasMoreEligibleWork` triggers
  an **immediate re-poll**, it is set only when a *full* batch of eligible rows was fetched **and** at
  least one made progress (dispatched or dead-lettered), so more eligible rows are likely waiting; the
  *progress* requirement is what stops a batch wholly stuck in a permanent error from hot-spinning the
  loop. `EarliestPendingOccurredOn` enables **time-precise wake-up**: if the oldest not-yet-eligible
  message becomes eligible in 47 seconds, the processor sleeps exactly 47 seconds instead of the full
  fallback interval; `null` means nothing is pending, so the full interval applies.
- **Walkthrough**: declared as a `readonly record struct` (line 19) with two positional members:
  `HasMoreEligibleWork` (`bool`) and `EarliestPendingOccurredOn` (`DateTime?`). The value-type, no-heap
  shape means the tight background loop allocates nothing per cycle.
- **Why it's built this way**: a record struct avoids per-cycle allocation in a long-running loop;
  `internal` visibility keeps the outbox processing contract private to the Infrastructure layer (it is
  not part of any public API).
- **Where it's used**: returned by `OutboxProcessor.ProcessSourceAsync`/`ProcessPendingMessagesAsync`
  and consumed by `ExecuteAsync` to call [`IOutboxSignal.WaitAsync`](#ioutboxsignal) with the right
  duration (see [`OutboxProcessor`](#outboxprocessor)).

### IIntegrationEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IIntegrationEvent.cs:15` · Level 1 · interface

- **What it is**: a marker interface distinguishing **integration events** (cross-module/cross-service)
  from plain domain events (intra-module).
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0), it *extends* it.
- **Concept introduced, domain vs. integration events.** `[Rubric §6, CQRS & Event-Driven]`
  (reliable events across module boundaries) and `[Rubric §7, Microservices Readiness]` (loose
  coupling via events). The doc comment (`IIntegrationEvent.cs:8-13`) draws the line: *domain events*
  are handled inside the same bounded context (same process, handled by
  [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent)); *integration events*
  are facts that other modules, possibly in other processes, need to react to, handled by
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent) and
  transported through [`IMessageBus`](#imessagebus). Because it still extends `IDomainEvent`, an
  integration event flows through the **same outbox pipeline** (at-least-once); the marker just tells
  the [`OutboxProcessor`](#outboxprocessor) to route it through `IMessageBus.PublishAsync` rather than
  the in-process dispatcher. The interface is empty
  (`public interface IIntegrationEvent : IDomainEvent;`, line 15), membership itself is the marker.
- **Why it's built this way**: making integration events a *subtype* of domain events means one
  outbox mechanism serves both, and the routing decision is a single `is IIntegrationEvent` check in
  the processor (`OutboxProcessor.cs:290`), no parallel pipeline.
- **Where it's used**: implemented by integration events across modules (e.g. Engagement's bookmark/
  feedback events); routed by the [`OutboxProcessor`](#outboxprocessor) to [`IMessageBus`](#imessagebus),
  published by [`InProcessEventBus`](#inprocesseventbus)/[`BrokerEventBus`](#brokereventbus), and
  consumed via [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent).

### NoOpInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/NoOpInboxStore.cs:7` · Level 1 · class (internal sealed)

- **What it is**: the default [`IInboxStore`](#iinboxstore) used when the inbox is disabled: it never
  dedups and records nothing, so consumer behavior is exactly as it was before the inbox feature
  existed.
- **Depends on**: [`IInboxStore`](#iinboxstore) (the port it implements); BCL `Task`/`Guid` only.
- **Concept reinforced, the Null Object pattern.** `[Rubric §2, Design Patterns]` (assesses idiomatic
  use of patterns) and `[Rubric §10, Cross-Cutting Concerns]`. `AlreadyProcessedAsync` always returns
  `false` (`NoOpInboxStore.cs:9-10`) and `MarkProcessedAsync` does nothing (`NoOpInboxStore.cs:12-13`).
  The consumer pipeline is written against [`IInboxStore`](#iinboxstore) and runs identically whether
  or not dedup is enabled: the Null Object removes a runtime `if (inbox enabled)` branch from every
  consumer.
- **Why it's built this way**: opt-in dedup keeps the monolith simple, in-process dispatch never
  redelivers, so a single-process or broker-less deployment needs no inbox and pays nothing for the
  default (**ADR-021**). It is the registration unless `MessageBus:EnableInbox=true` swaps in
  [`EfInboxStore`](#efinboxstore).
- **Where it's used**: registered in DI as the default `IInboxStore`; consumed by
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent).

### OutboxMessage
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:14` · Level 1 · class (sealed)

- **What it is**: a row in an `OutboxMessages` table: a JSON-serialized domain event persisted **in
  the same DB transaction as its aggregate**, ready for reliable async dispatch.
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0); BCL `System.Text.Json`,
  `System.Diagnostics.Activity` (trace capture), and `System.Collections.Concurrent` (the type cache).
- **Concept introduced, the Transactional Outbox pattern.** `[Rubric §6, CQRS & Event-Driven]`
  (reliable at-least-once delivery), `[Rubric §8, Data Architecture]` (event written in the same
  transaction as the aggregate), and `[Rubric §29, Resilience & Business Continuity]` (the delivery
  guarantee survives a crash). ADR-003 is the governing decision. The problem it solves: if you save an
  aggregate and *then* publish an event, a crash between the two loses the event. The fix: write the
  event to an `OutboxMessages` row in the **same database transaction** as the aggregate change; the
  [`OutboxProcessor`](#outboxprocessor) then reads unprocessed rows and dispatches them, re-dispatching
  after a crash (at-least-once). Each service owns its own outbox table (ADR-006), so there is no
  cross-service race.
- **Walkthrough**
  - Static `SerializerOptions` (`OutboxMessage.cs:16-19`), a `JsonSerializerOptions` with
    `ReferenceHandler.IgnoreCycles`, so an event referencing a cyclic entity graph still serializes;
    the same instance is reused on the read side so payloads round-trip symmetrically.
  - Static `EventTypeCache` (`OutboxMessage.cs:25`): a `ConcurrentDictionary<string, Type?>` keyed by
    assembly-qualified name (`StringComparer.Ordinal`) that memoizes the `Type.GetType` reflection
    lookup `DeserializeEvent` would otherwise run on **every** row; the XML doc (lines 21-24) notes an
    unresolvable name caches as `null` so a poison payload's resolution is not retried on each poll.
  - **Fields** (`OutboxMessage.cs:28-52`): `Id` (`Guid`, auto `Guid.NewGuid()`, line 28); `EventType`
    (`required`, the assembly-qualified type name for deserialization, line 31); `Payload` (`required`,
    the JSON string, line 34); `OccurredOn` (the business timestamp from `IDomainEvent.DateOccurred`,
    line 37); `ProcessedOn?` (a *settable* `DateTime?`, null until dispatched, line 40); `RetryCount`
    (settable, bumped on failure, line 43); `LastError?` (settable, last failure message, line 46);
    `TraceId?`/`SpanId?` (W3C trace context captured at write time, lines 49-52). Note the deliberate
    mix of `init` (immutable identity/payload/trace) and `set` (mutable processing state the processor
    updates).
  - **`FromDomainEvent(IDomainEvent)`** (`OutboxMessage.cs:59-73`): the static factory. It null-guards
    the event (line 61), captures `Activity.Current` (line 64) for trace propagation, and serializes
    using the *runtime* type so `type.AssemblyQualifiedName` survives the JSON round-trip (line 67
    falls back to `FullName`/`Name` if the AQN is null).
  - **`DeserializeEvent()`** (`OutboxMessage.cs:79-88`): re-inflates the event, resolving the CLR type
    through `EventTypeCache.GetOrAdd(EventType, static ... => Type.GetType(...))` (line 81); returns
    `null` (rather than throwing) if the type can no longer be resolved (lines 82-83, e.g. after a
    rename) so the processor can dead-letter it instead of crashing, then deserializes with the shared
    `SerializerOptions` (line 87).
- **Why it's built this way**: persisting events in the same transaction (not after) is the only way
  to guarantee no event is lost. JSON keeps rows human-readable for debugging; the assembly-qualified
  name enables polymorphic deserialization; the per-name type cache keeps the hot poll path off
  reflection; `TraceId`/`SpanId` let traces span the async outbox hop.
- **Where it's used**: written by the `SaveChanges` event-capture in
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  and by [`InProcessEventBus`](#inprocesseventbus)/[`BrokerEventBus`](#brokereventbus); read and
  dispatched by the [`OutboxProcessor`](#outboxprocessor); marked processed by
  [`OutboxFinalizer`](#outboxfinalizer); purged by [`OutboxCleanupService`](#outboxcleanupservice).
- **Caveats / not-in-source**: a type-rename migration requires keeping the old `EventType` resolvable
  (or a data migration); an assembly rename makes `Type.GetType(EventType)` return null, the null caches
  in `EventTypeCache`, and the row dead-letters on the next cycle.

### OutboxSignal
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxSignal.cs:9` · Level 1 · class (sealed)

- **What it is**: the `SemaphoreSlim`-based [`IOutboxSignal`](#ioutboxsignal) that wakes the
  [`OutboxProcessor`](#outboxprocessor) the instant new outbox entries are written.
- **Depends on**: [`IOutboxSignal`](#ioutboxsignal) (the port it implements); BCL `SemaphoreSlim`/
  `TimeSpan`.
- **Concept reinforced, event-driven wake.** `[Rubric §12, Performance & Scalability]` (event-driven
  wake beats poll-only latency), introduced at [`IOutboxSignal`](#ioutboxsignal).
- **Walkthrough**: a `SemaphoreSlim(0)` field (line 11). `Signal()` (lines 14-24) calls
  `_semaphore.Release()`, catching and swallowing the defensive `SemaphoreFullException` (lines 20-23)
  so repeated signals never throw; multiple rapid signals are harmless because the processor drains
  *all* pending rows in one batch and then re-waits (the XML doc, lines 3-8, says so). `WaitAsync`
  (lines 27-37) awaits `_semaphore.WaitAsync(timeout, ct)` and re-throws only on real shutdown
  cancellation (lines 33-36). It implements `IDisposable` (line 40) to release the semaphore.
- **Why it's built this way**: a counting semaphore is the lightest primitive that both blocks the
  processor loop and is releasable from the commit path; swallowing `SemaphoreFullException` makes
  signalling idempotent against bursts.
- **Where it's used**: registered in DI (by `AddInfrastructure`); `Signal()` is called by
  [`BrokerEventBus`](#brokereventbus)/[`InProcessEventBus`](#inprocesseventbus) and the `SaveChanges`
  event-capture path after writing outbox rows; `WaitAsync` is awaited by the
  [`OutboxProcessor`](#outboxprocessor) loop.

### OutboxFinalizer
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxFinalizer.cs:12` · Level 6 · class (internal static)

- **What it is**: the helper that marks a batch of just-dispatched [`OutboxMessage`](#outboxmessage)
  rows processed with a **single set-based SQL `UPDATE`**, then re-syncs the EF change tracker so a
  later save does not re-issue the same statement. It is the finalize step on the low-latency happy
  path, not the background processor's path.
- **Depends on**: [`OutboxMessage`](#outboxmessage) (this group),
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (G07); BCL EF Core
  (`ExecuteUpdateAsync`) and `TimeProvider.System`.
- **Concept introduced, set-based finalize off the hot write path.** `[Rubric §12, Performance &
  Scalability]` (assesses keeping the hottest write path cheap) and `[Rubric §8, Data Architecture]`
  (efficient set-based mutation). Every event-raising command reaches this the moment its transaction
  commits and its events are dispatched in-process. The naive approach, setting `ProcessedOn` on each
  tracked entity and calling `SaveChanges` again, would run a second full save (change detection, audit
  stamping, the interceptor pipeline) on the busiest write path in the system. Instead the doc comment
  (`OutboxFinalizer.cs:6-11`) states the design: one asynchronous `ExecuteUpdate` statement that
  bypasses the change tracker and the `SaveChanges` interceptor entirely.
- **Walkthrough**: `MarkProcessedAsync(ApplicationDbContext, IReadOnlyList<OutboxMessage>,
  CancellationToken)` (`OutboxFinalizer.cs:21-48`) short-circuits on an empty batch (lines 26-27);
  computes `now` once from `TimeProvider.System.GetUtcNow().UtcDateTime` (line 29); collects the row ids
  (line 30); issues **one** `ExecuteUpdateAsync` that `SetProperty(m => m.ProcessedOn, now)` over
  `Where(m => ids.Contains(m.Id))` (lines 32-35). Because `ExecuteUpdate` does not touch tracked
  instances, it then loops the entries and, for each, sets the tracked `ProcessedOn`, writes the
  property's `OriginalValue`, and clears `IsModified` (lines 41-47). The ordering is load-bearing and
  the inline comment (lines 37-40) explains why: clearing `IsModified` reverts the current value to the
  original, so the original must already hold the new value first.
- **Why it's built this way**: `ExecuteUpdate` is a single round-trip that never materializes entities;
  re-syncing the tracker afterwards keeps a later `SaveChanges` from queueing a redundant `UPDATE` for
  rows that are already processed. This is the concrete implementation of ADR-003's *dispatch #1* (the
  in-process happy path) staying cheap, the durability net is the background
  [`OutboxProcessor`](#outboxprocessor), which does *not* use this helper.
- **Where it's used**: called by the
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  (G07) right after commit, and by [`InProcessEventBus`](#inprocesseventbus) after writing and
  dispatching an integration-event row.

### EfInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:18` · Level 8 · class (sealed partial)

- **What it is**: the EF-backed inbox: it records processed message ids in the consumer's own
  database so a redelivered broker message is skipped (consumer-side dedup).
- **Depends on**: [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  [`OutboxSettings`](group-14-module-system-composition.md#outboxsettings) (to find the publish-target
  source), `ILogger`; the [`InboxMessage`](#inboxmessage) entity; resolves an
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).
- **Concept reinforced, at-least-once-with-dedup, and why handlers must still be idempotent.**
  `[Rubric §6, CQRS & Event-Driven]` (idempotent consumers) and `[Rubric §29, Resilience]`.
  `AlreadyProcessedAsync` (`EfInboxStore.cs:25-31`) issues an `AnyAsync` for an
  [`InboxMessage`](#inboxmessage) with the given `MessageId`. `MarkProcessedAsync`
  (`EfInboxStore.cs:34-56`) inserts one *after* handlers succeed, catching the `DbUpdateException`
  thrown by the unique index when a concurrent duplicate delivery already inserted the same id (lines
  50-55, treated as already-processed and logged at Debug via `LogConcurrentDuplicate`, lines 64-65).
  `ResolveContext` (`EfInboxStore.cs:58-62`) routes to the configured outbox data source via
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver). The class comment
  (`EfInboxStore.cs:11-17`) is explicit: because the inbox row is written *after* the handler commits, a
  crash in between reprocesses once, so handlers **must still be idempotent**. This is the consumer-side
  complement to the producer-side [`OutboxProcessor`](#outboxprocessor).
- **Why it's built this way**: dedup-by-`MessageId` (the [`IDomainEvent.MessageId`](#idomainevent)
  introduced at Level 0) makes redelivery safe without distributed locks; storing the row in the
  consumer's *own* DB keeps it within the database-per-service boundary (ADR-006). Relying on the unique
  index (and swallowing its violation) avoids a read-then-write race between concurrent deliveries.
  **ADR-021** is the governing decision: this opt-in inbox is the broker-consume sibling of ADR-003's
  outbox and ADR-017's HTTP-edge idempotency, activated by `MessageBus:EnableInbox` and marking
  processed only after all handlers succeed (a throwing handler leaves the message redeliverable).
- **Where it's used**: registered in place of [`NoOpInboxStore`](#noopinboxstore) when
  `MessageBus:EnableInbox=true`; called by the [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  pipeline around handler invocation; its rows are purged by [`OutboxCleanupService`](#outboxcleanupservice).

### OutboxCleanupService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCleanupService.cs:32` · Level 8 · class (sealed partial, `BackgroundService`)

- **What it is**: the periodic sweeper that purges **processed** outbox rows (and, when enabled,
  inbox rows) older than the retention window from every relational source the host owns.
- **Depends on**: `IServiceScopeFactory`,
  [`OutboxSettings`](group-14-module-system-composition.md#outboxsettings),
  [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings) (via `IOptions<>`),
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory), and an optional
  `TimeProvider`; the [`OutboxMessage`](#outboxmessage)/[`InboxMessage`](#inboxmessage) entities.
- **Concept reinforced, retention as a privacy + storage control (plus a clock seam).** `[Rubric §30,
  Compliance, Privacy & Data Governance]` (assesses bounded retention of data that may contain PII),
  `[Rubric §8, Data Architecture]`, and `[Rubric §14, Testability]`. The
  [`OutboxProcessor`](#outboxprocessor) only ever *sets* `ProcessedOn`; without this sweep the outbox,
  which stores serialized event payloads that may contain personal data, grows unbounded (the doc cites
  ADR-003 / ADR-005). The constructor takes an optional `TimeProvider? timeProvider = null`
  (`OutboxCleanupService.cs:39`) stored as `_timeProvider`, defaulting to `TimeProvider.System` (line
  43); the doc comment (lines 30-31) states its purpose, it is a clock abstraction so tests can drive
  the hour-scale sweep loop deterministically instead of waiting real hours.
- **Walkthrough**: `ExecuteAsync` (`OutboxCleanupService.cs:46-74`) returns immediately when
  `RetentionDays <= 0` (lines 48-52, the off switch), then loops, deliberately awaiting
  `_timeProvider.Delay(interval, ...)` (line 62) **before** each `PurgeAsync` (line 63) so cleanup never
  competes with startup or migrations (the comment, lines 56-57). `PurgeAsync`
  (`OutboxCleanupService.cs:76-114`) computes the cutoff from `_timeProvider.GetUtcNow()` minus
  `RetentionDays` (line 78), then per source deletes processed rows older than the cutoff via
  `ExecuteDeleteAsync`, a set-based SQL `DELETE` with no entity materialization (lines 89-92), and
  purges the inbox too when `MessageBusSettings.EnableInbox` is set (lines 99-102, delegating to
  `PurgeInboxAsync`, lines 116-131). A single unreachable database does not stop the others (lines
  108-112). `GetRelationalSources` (lines 138-149) computes the same source set the processor drains.
- **Why it's built this way**: bounded retention keeps both storage cost (§31) and PII exposure (§30)
  in check; doing it as a `DELETE` (not load-then-remove) is the efficient path, and per-source
  error isolation keeps one bad DB from blocking the sweep. ADR-021 has the inbox reuse this same
  retention sweep (gated on `EnableInbox`) rather than adding a second housekeeping service.
- **Where it's used**: registered as a hosted service alongside the [`OutboxProcessor`](#outboxprocessor)
  in `AddInfrastructure`.

### OutboxProcessor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:37` · Level 8 · class (sealed partial, `BackgroundService`)

- **What it is**: the background service that drains every outbox table the host owns and dispatches
  the [`OutboxMessage`](#outboxmessage)s, the engine of at-least-once delivery (ADR-003).
- **Depends on**: `IServiceScopeFactory`,
  [`OutboxSettings`](group-14-module-system-composition.md#outboxsettings) (via `IOptions<>`),
  [`IOutboxSignal`](#ioutboxsignal),
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver); per scope
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDomainEventDispatcher`](#idomaineventdispatcher), and [`IMessageBus`](#imessagebus); the
  [`OutboxMessage`](#outboxmessage) entity.
- **Concept introduced, the outbox drain loop: smart wait, per-source draining, dead-lettering, and
  trace continuity.** `[Rubric §6, CQRS & Event-Driven]` (reliable delivery), `[Rubric §29,
  Resilience]`, `[Rubric §13, Observability & Operability]` (traces + dead-letter metric), and
  `[Rubric §31, Cost Efficiency]` (idle-poll suppression). The loop (`ExecuteAsync`,
  `OutboxProcessor.cs:66-110`): after a 5s startup delay (line 69) it bails out entirely if the host
  owns no relational sources (lines 71-75), then repeatedly processes all sources and **waits** for
  whichever of (a) an [`IOutboxSignal`](#ioutboxsignal) (a new entry was written), (b) the moment the
  earliest pending message becomes eligible, the **smart wait** computed by `ComputeWaitTime`
  (`OutboxProcessor.cs:119-137`, floored at 1s via `MinimumWait`, capped at the polling interval), or
  (c) the fallback interval, comes first. This is why production can set a 300s poll interval without
  adding latency: real messages wake it via signal or smart-wait, and the slow fallback only cuts idle
  DB chatter and telemetry cost. `GetOutboxSources` (`OutboxProcessor.cs:144-155`) enumerates every
  relational source backing a registered entity plus the configured publish target (Cosmos has no
  outbox), so a host only ever touches *its own* databases, never racing another service for its rows
  (ADR-006, the fix recorded in the outbox-race memory). `ProcessSourceAsync`
  (`OutboxProcessor.cs:195-256`) fetches a batch ordered by `OccurredOn` (eligible rows sort before
  pending ones, so a full batch can't starve eligible work), splits the eligible prefix (older than the
  `ProcessingDelaySeconds` cutoff) from the pending remainder, dispatches the eligible ones, then saves
  with the **base** `DbContext.SaveChangesAsync` (line 249, bypassing audit stamping and re-dispatch).
  The poll query runs inside an explicit `OutboxPoll` activity (`OutboxProcessor.cs:212`; the name
  constant `PollActivityName` is at line 53) that the Aspire
  [`OutboxPollFilterProcessor`](group-16-aspire-orchestration.md#outboxpollfilterprocessor) suppresses
  from telemetry, the string is deliberately duplicated there because Aspire has no project reference
  (the comment at lines 47-52 says so). `DispatchMessagesAsync` (`OutboxProcessor.cs:263-313`):
  deserialize the event; if the type can't be resolved, **dead-letter** it (mark processed, bump the
  `outbox.dead_letter.count` counter, line 282; the `DeadLetterCounter` is defined at lines 60-63);
  route an [`IIntegrationEvent`](#iintegrationevent) via [`IMessageBus`](#imessagebus) (in-process or
  broker, the `is IIntegrationEvent` check at line 290) and a pure domain event via
  [`IDomainEventDispatcher`](#idomaineventdispatcher); on failure bump `RetryCount` (capped by
  `MaxRetries` in the fetch filter, line 221) and record `LastError`. Each dispatch restarts the
  original request's trace via `StartOutboxActivity` (`OutboxProcessor.cs:320-342`) so traces span the
  async hop.
- **Why it's built this way**: ADR-003: the outbox is the durability guarantee behind every
  integration event; the smart-wait + per-source design (ADR-006) plus the telemetry suppression are
  the cost/latency optimizations recorded in the outbox-cost-optimization memory. Dead-lettering
  unresolvable types stops one poison message from blocking the queue; the *progress* requirement on
  re-poll (see [`OutboxCycleResult`](#outboxcycleresult)) prevents a fully-failing batch from
  hot-spinning.
- **Where it's used**: registered as a hosted service in every service host; the producer side is the
  two `IEventBus` implementations ([`InProcessEventBus`](#inprocesseventbus) /
  [`BrokerEventBus`](#brokereventbus)) plus the `SaveChanges` event-capture in
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor);
  its companion sweeper is [`OutboxCleanupService`](#outboxcleanupservice).

### BaseDomainEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.DomainEvents` · `MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:18` · Level 1 · record class (abstract)

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
  `MessageId` is serialized with the payload, it survives the outbox → broker → consumer round-trip,
  making consumer-side deduplication via the inbox table reliable.
- **Walkthrough**: two `init` properties with inline defaults; `abstract` so consumers must declare a
  concrete event type. Concrete events add whatever domain-specific payload they carry (entity id,
  state change, etc.) as additional positional or `init` properties on the derived record.
- **Why it's built this way**: inline defaults mean a concrete event record needs zero boilerplate:
  `public sealed record SessionCreated(SessionIdentifierType SessionId) : BaseDomainEvent;` is the
  complete type. Minting `MessageId` at construction (not at serialization) keeps the id stable even
  if the event is serialized more than once. This is the consumer-idempotency half of the at-least-once
  story in `ADRs/003-outbox-dual-dispatch.md`. The creation-time default on `DateOccurred` is now
  documented as a deliberate domain-modelling choice rather than an oversight (the `<remarks>` block,
  lines 10-16): a domain event's occurrence instant is by definition the moment the aggregate raises
  it, so stamping it at construction is the correct event-sourcing / audit semantic, and it is
  intentionally distinct from infrastructure timestamps that must be deterministically testable
  (audit fields, notification read-time), which are stamped from an injected `TimeProvider`. This is a
  comment/rationale addition only; the runtime behavior is unchanged.
- **Where it's used**: base of every domain event across both apps (e.g. `CategoryItemChanged`,
  `UserDeleted`); subclassed by [`BaseIntegrationEvent`](#baseintegrationevent) and
  [`EntityChangedEvent<TIdentifierType>`](#entitychangedeventtidentifiertype); captured into an
  [`OutboxMessage`](#outboxmessage) row and routed by [`DomainEventDispatcher`](#domaineventdispatcher).

### IDomainEventDispatcher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IDomainEventDispatcher.cs:8` · Level 1 · interface

- **What it is**: the dispatch port for in-process domain-event delivery. A single method,
  `DispatchAsync(IEnumerable<IDomainEvent>, CancellationToken)` (line 16), takes a batch of events and
  routes each to its registered handlers after an aggregate persists changes (doc comment, lines 5-6).
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
  immediate in-process reactions that don't need outbox durability; the background
  [`OutboxProcessor`](#outboxprocessor) uses the same dispatcher to re-dispatch persisted events.

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
- **Concept introduced, explicit integration-event schema versioning (ADR-010).** This base now
  carries a single member beyond what it inherits: `public virtual int SchemaVersion => 1;` (line 22).
  `[Rubric §9, API & Contract Design]` assesses whether contracts evolve without silently breaking
  consumers; an integration event *is* a wire contract once it crosses a service boundary. The version
  is serialized with the payload, so a consumer has an explicit signal to branch or upcast on. The
  doc comment (lines 13-22) states the discipline precisely: additive/optional field changes keep the
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
- **Caveats / not-in-source**: the prior tier edition documented this as a bare one-liner record with
  no members; that is stale. As of the current source the `SchemaVersion` property (ADR-010) is part
  of the base.

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

- **What it is**: an abstraction for publishing [`IIntegrationEvent`](#iintegrationevent)s to all
  registered handlers. Two `PublishAsync` overloads (lines 18, 25): a single event and a batch.
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept introduced, integration events vs. domain events.** `[Rubric §6, CQRS & Event-Driven]`
  assesses reliable events, at-least-once delivery, and idempotent consumers. A **domain event** is
  raised *inside* an aggregate, captured by `SaveChangesAsync`, and dispatched within the same
  transaction; an **integration event** is an *intentional signal to other bounded contexts* and may
  cross a service boundary. `IEventBus` is where that distinction is enforced, callers publish an
  `IIntegrationEvent` and the infrastructure decides how to route it. The doc comment (lines 5-10) is
  precise: the *default* implementation dispatches in-process through the outbox for at-least-once
  delivery via [`IDomainEventDispatcher`](#idomaineventdispatcher), while alternative implementations
  (Azure Service Bus, RabbitMQ) can be substituted via DI.
- **Where it's used**: implemented by `IntegrationEventPublisher` (Level 3); closely related to
  [`IIntegrationEventPublisher`](#iintegrationeventpublisher) (the explicit, unit-of-work-aware publish
  port) and to the transport-agnostic [`IMessageBus`](#imessagebus).

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
  module; consumed by [`DomainEventDispatcher`](#domaineventdispatcher) (Level 3) and by the broker
  consumer on the extracted-service path.

### IIntegrationEventPublisher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IIntegrationEventPublisher.cs:15` · Level 2 · interface

- **What it is**: the **explicit publish** port for integration events. One overload:
  `PublishAsync(IIntegrationEvent, CancellationToken)` (line 24).
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept**: the explicit counterpart to aggregate-raised domain events. The doc comment (lines
  5-13) contrasts the two paths: domain events are raised by aggregate roots via `AddDomainEvent()`
  and dispatched automatically during `SaveChangesAsync`; integration events can be published
  *explicitly* from command handlers, domain-event handlers, or application services. The key
  guarantee (lines 17-23): the event is persisted to the **outbox in the current unit-of-work
  transaction** and dispatched in-process only after successful persistence, so a publish and the
  state change that motivated it commit or roll back together. `[Rubric §6, CQRS & Event-Driven]`
  (transactional publish, no "save-then-publish-and-hope" dual-write gap, see
  `ADRs/003-outbox-dual-dispatch.md`).
- **Where it's used**: injected into domain-event handlers that must signal another bounded context
  without an aggregate raising the event (e.g. an ADC `SpeakerDeletedHandler` publishing
  `SpeakerUnlinkedFromUser`); implemented by `IntegrationEventPublisher` (Level 3).

### IMessageBus
> MMCA.Common.Application · `MMCA.Common.Application.Messaging` · `MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:28` · Level 2 · interface

- **What it is**: the **transport-agnostic** abstraction for publishing integration events across
  module or service boundaries. Two `PublishAsync` overloads (lines 35, 42): single event and batch.
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept introduced, a transport-agnostic message bus for microservices readiness.**
  `[Rubric §7, Microservices Readiness]` assesses whether the transport is a swappable seam and
  whether business layers stay free of transport coupling. The doc comment (lines 5-27) enumerates
  both implementations explicitly: [`InProcessMessageBus`](#inprocessmessagebus) dispatches
  synchronously through the existing [`IDomainEventDispatcher`](#idomaineventdispatcher) path
  (modular-monolith mode), and `BrokerMessageBus` publishes via MassTransit to an external broker
  (RabbitMQ in dev, Azure Service Bus in prod) for the extracted-service mode, with the outbox
  semantics preserved because [`OutboxProcessor`](#outboxprocessor) drains
  [`OutboxMessage`](#outboxmessage) rows through this bus instead of dispatching in-process. The
  comment is explicit that application code should depend on `IMessageBus` rather than on `IEventBus`
  or a transport-specific client. `[Rubric §29, Resilience & Business Continuity]`: outbox + broker
  together give at-least-once delivery with retry.
- **Why it's built this way**: transport belongs at the edge (`ADRs/007-grpc-extraction.md`,
  `ADRs/008-service-extraction-topology.md`). The *same* application code that called
  `IMessageBus.PublishAsync` in the monolith keeps working when the module is extracted and
  `BrokerMessageBus` is swapped in, only config (`MessageBus:Provider`) changes. `Application`,
  `Domain`, and `Shared` must never reference `MassTransit` directly; `MicroserviceExtractionTests`
  (NetArchTest) enforces that, and the **MassTransit v8 pin** is enforced separately by
  `DependencyVersionTests` (v9 needs a commercial licence; see the primer §3/§4).
- **Where it's used**: implemented by [`InProcessMessageBus`](#inprocessmessagebus) and
  `BrokerMessageBus` (both Level 3); drained through at runtime by
  [`OutboxProcessor`](#outboxprocessor).

### SafeDomainEventHandler<TDomainEvent>
> MMCA.Common.Application · `MMCA.Common.Application.DomainEvents` · `MMCA.Common/Source/Core/MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:14` · Level 2 · class (abstract)

- **What it is**: a base class for domain-event handlers whose failures should **not** roll back the
  primary transaction. It wraps an abstract `HandleSafelyAsync` in a `try/catch` that logs the error
  but does not propagate it.
- **Depends on**: [`BaseDomainEvent`](#basedomainevent) (Level 1),
  [`IDomainEventHandler<TDomainEvent>`](#idomaineventhandlerin-tdomainevent) (Level 1),
  `Microsoft.Extensions.Logging.ILogger` (external).
- **Concept introduced, safe side-effect handlers and at-least-once delivery discipline.**
  `[Rubric §6, CQRS & Event-Driven]` (at-least-once delivery: the outbox guarantees retry, so a safe
  handler lets the processor re-dispatch on failure without re-running the primary operation).
  `[Rubric §29, Resilience & Business Continuity]` (graceful degradation of side-effects). An
  aggregate's `SaveChangesAsync` dispatches domain events in-process *after* the data is safely
  persisted. If a side-effect handler ("send welcome email when a user registers") throws, the entire
  save should *not* roll back, the primary state change is already committed; only the side effect
  failed. `SafeDomainEventHandler` catches non-cancellation exceptions, logs them with "The outbox
  processor will retry" (lines 26-31), and returns gracefully. Handlers that *must* succeed atomically
  with the primary transaction (e.g. a read model in the same DB) should instead implement
  [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent) directly and let
  exceptions propagate.
- **Walkthrough**: primary constructor takes an `ILogger` (line 14), constrained
  `where TDomainEvent : BaseDomainEvent` (line 15). `HandleAsync` (line 18) awaits
  `HandleSafelyAsync` inside `catch (Exception ex) when (ex is not OperationCanceledException)`
  (line 24), cancellation is the one exception that *should* propagate. `HandleSafelyAsync` (line 38)
  is the abstract method concrete subclasses implement.
- **Why it's built this way**: it codifies the at-least-once contract of
  `ADRs/003-outbox-dual-dispatch.md` at the handler level: swallow-and-log instead of fail-the-save,
  because the durable retry path already exists in the outbox.
- **Where it's used**: base class for ADC's side-effect handlers across Conference/Engagement/Identity.

### DomainEventDispatcher
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/DomainEventDispatcher.cs:16` · Level 3 · class (sealed)

- **What it is**: the in-process implementation of [`IDomainEventDispatcher`](#idomaineventdispatcher):
  it dispatches each event to all registered `IDomainEventHandler<T>` instances and, if the event also
  implements [`IIntegrationEvent`](#iintegrationevent), to all registered
  [`IIntegrationEventHandler<T>`](#iintegrationeventhandlerin-tintegrationevent) instances. It uses
  **compiled expression-tree delegates cached per event type** to eliminate per-dispatch reflection.
- **Depends on**: [`IDomainEvent`](#idomainevent),
  [`IDomainEventDispatcher`](#idomaineventdispatcher),
  [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent),
  [`IIntegrationEvent`](#iintegrationevent),
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent);
  externals `IServiceProvider`, `System.Linq.Expressions`, `ILogger<T>`.
- **Concept introduced, compiled expression-tree delegates for handler dispatch.**
  `[Rubric §12, Performance & Scalability]` (avoids reflection overhead on the hot
  post-`SaveChanges` path) and `[Rubric §6, CQRS & Event-Driven]` (events fan out to all registered
  handlers reliably). The problem: `IServiceProvider.GetServices(closedHandlerType)` (line 48) returns
  `object` instances, so calling `HandleAsync` on them would otherwise require reflection on every
  dispatch. The solution: on first encounter of a `(eventType, handlerInterfaceType)` pair,
  `BuildInvoker` (line 74) uses `Expression.Lambda` to compile a
  `Func<object, object, CancellationToken, Task>` that casts the `object` arguments to their concrete
  types and calls `HandleAsync` directly (lines 82-93). Subsequent dispatches of the same event type
  reuse the cached delegate, zero reflection.
- **Walkthrough**
  - `_serviceProvider` (line 18), null-checked in the field initializer.
  - `CompiledDelegates` (line 25), `ConcurrentDictionary<(Type EventType, Type HandlerInterface),
    Func<…>>`, **static** so the warmed cache is shared process-wide and thread-safe.
  - `DispatchAsync` (line 28), null-guards the batch, then per event: always dispatches to
    `IDomainEventHandler<>` (line 37), and dispatches to `IIntegrationEventHandler<>` only when the
    event is also an `IIntegrationEvent` (lines 40-41).
  - `DispatchToHandlersAsync` (line 45), closes the open handler type over the event type, resolves
    all handlers, fetches/builds the cached invoker (`GetOrAdd`, line 49), and awaits each; a `null`
    resolved handler is logged as a likely DI misconfiguration and skipped (lines 55-59).
  - `BuildInvoker` (line 74), finds `HandleAsync` on the closed handler type, builds
    `((IHandler<TEvent>)handler).HandleAsync((TEvent)event, ct)` as an expression, and `Compile()`s it.
- **Why it's built this way**: at-least-once domain-event delivery
  (`ADRs/003-outbox-dual-dispatch.md`) requires the dispatcher to run after each `SaveChangesAsync`;
  with many events per request on a busy session, reflection cost compounds, so the expression-tree
  cache makes dispatch near zero-cost after warm-up. Routing domain and integration events through one
  dispatcher (rather than two) keeps the in-process path uniform.
- **Where it's used**: registered as the `IDomainEventDispatcher` implementation; called by
  `ApplicationDbContext.SaveChangesAsync` after the outbox rows are written, and by the background
  [`OutboxProcessor`](#outboxprocessor) when re-dispatching persisted events; the in-process bus
  ([`InProcessMessageBus`](#inprocessmessagebus)) routes integration-event publishes through it too.

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
  processor drains them by calling this bus (ADR-003). Keeping `BrokerMessageBus` a thin publish
  adapter, with no outbox knowledge, is what lets the same outbox machinery serve both monolith and
  broker modes (ADRs 007/008).
- **Where it's used**: registered when `MessageBus:Provider` selects RabbitMQ or Azure Service Bus
  (see [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)); selected by
  `AddBrokerMessaging()` in each service host's `Program.cs`. Driven by the
  [`OutboxProcessor`](#outboxprocessor) in broker mode.

### InProcessMessageBus

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/InProcessMessageBus.cs:20` · Level 3 · class (sealed)

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
  the persist-and-dispatch semantics uses [`IEventBus`](#ieventbus) /
  [`IIntegrationEventPublisher`](#iintegrationeventpublisher) instead.
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
  keeps the MassTransit dependency out of the handlers and out of the Application layer (ADR-003 for
  the inbox/outbox guarantee; ADRs 007/008 for the extraction seam).
- **Where it's used**: registered in each broker-mode service host's MassTransit configuration for
  every integration event the service consumes (e.g. Conference consuming `UserRegistered`; Identity
  consuming `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser`).

### IntegrationEventPublisher

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/IntegrationEventPublisher.cs:12` · Level 3 · class (sealed)

- **What it is**: implements [`IIntegrationEventPublisher`](#iintegrationeventpublisher) by delegating
  straight to [`IEventBus`](#ieventbus). A thin adapter preserving the older single-event publish
  contract for callers that inject `IIntegrationEventPublisher` rather than [`IEventBus`](#ieventbus).
- **Depends on**: [`IEventBus`](#ieventbus), [`IIntegrationEvent`](#iintegrationevent),
  [`IIntegrationEventPublisher`](#iintegrationeventpublisher).
- **Concept reinforced, adapter for contract backward-compatibility.** `[Rubric §1, SOLID]`
  (Liskov / interface-segregation: the adapter lets the narrower `IIntegrationEventPublisher` contract
  be satisfied by the same outbox-backed [`IEventBus`](#ieventbus) implementation). The single method
  `PublishAsync` (line 15–16) is one expression-bodied delegation; the doc comment recommends new code
  inject [`IEventBus`](#ieventbus) directly.
- **Where it's used**: handlers that publish an individual integration event inject
  `IIntegrationEventPublisher` (e.g. ADC's `SpeakerDeletedHandler` publishing `SpeakerUnlinkedFromUser`),
  ultimately routing through whichever [`IEventBus`](#ieventbus) is registered (in-process or broker).

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
  directly, so the seam stays clean (ADRs 007/008).
- **Where it's used**: in each broker-mode service's `Program.cs` configure-consumers callback (e.g.
  `config.RegisterIntegrationEventConsumer<SpeakerLinkedToUser>()`).

### BrokerEventBus, InProcessEventBus

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · Level 8 · class (sealed)

These two [`IEventBus`](#ieventbus) implementations are the publish entry point that integration-event
producers (link handlers, `AuthenticationService`, republish handlers) call via
[`IIntegrationEventPublisher`](#iintegrationeventpublisher). They are **structurally parallel**, both
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
- **Concept introduced, the outbox dual-dispatch seam (ADR-003) and the in-process/broker switch
  (ADRs 007/008).** `[Rubric §6, CQRS & Event-Driven]` (transactional outbox = atomic write +
  publish), `[Rubric §7, Microservices Readiness]` (one interface, two transports), `[Rubric §8,
  Data Architecture]` (the outbox is the cross-source consistency mechanism in database-per-service,
  ADR-006). Both implementations resolve the outbox target the same way
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
- **Why it's built this way**: ADR-003: persisting the [`OutboxMessage`](#outboxmessage) in the same
  transaction as the aggregate change makes delivery atomic with the business write (no "save then
  publish and hope" dual-write bug). Offering both a synchronous in-process path and a broker path
  behind one [`IEventBus`](#ieventbus) is exactly what lets a module move from monolith to extracted
  service without touching any publishing code, `AddBrokerMessaging` simply swaps the registration,
  config-driven by `MessageBus:Provider` (see
  [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)).
- **Where they're used**: [`IIntegrationEventPublisher`](#iintegrationeventpublisher) and direct
  [`IEventBus`](#ieventbus) injections resolve one of these; called by ADC's link handlers,
  `UserRegisteredHandler`'s republish, and `AuthenticationService`.


---
[⬅ Querying: Specifications, Filtering & the Entity Query Service](group-03-querying-specifications.md)  •  [Index](00-index.md)  •  [CQRS: Commands, Queries & the Decorator Pipeline ➡](group-05-cqrs-pipeline.md)
