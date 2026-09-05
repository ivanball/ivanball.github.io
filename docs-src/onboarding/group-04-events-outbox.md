# 4. Domain & Integration Events + Outbox Dual-Dispatch

**What this chapter covers.** This group is the codebase's *event spine*: how an aggregate says
"something happened", how that fact is persisted so it cannot be lost, and how it eventually reaches
every interested handler, whether that handler lives in the same process or in an extracted
microservice across a broker. Three questions drive the whole design. *How do we publish events
reliably when persistence and dispatch are separate steps that can each fail independently?* *How do
we keep application code identical whether a module ships inside the monolith or as its own service?*
And *how does a small single-process application avoid paying for machinery it does not need?* The
answer to the first is the **transactional outbox** with an at-least-once background drainer
([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)); the answer to the
second is a **transport-agnostic message bus** plus a consumer-side **inbox**
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html),
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html),
[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)); the answer to the
third is a pair of resolved posture flags that turn the outbox and the inbox on for a broker and off
for the in-process transport, each stating its choice once at startup. The types here implement all
three: the event contracts, the in-process dispatcher, the outbox and inbox tables with their
background services and admin surface, and the swappable in-process/broker buses.

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
instance, so two logically identical events are never equal (`BaseDomainEvent.cs:9-17`). Dedup is the
inbox's job, keyed on `MessageId`. A second remark defends the creation-time stamp as a domain-modelling
choice rather than an untestable clock: an event's occurrence instant *is* the moment the aggregate
raises it, and threading a `TimeProvider` through every aggregate to move that stamp would not improve
the model (`BaseDomainEvent.cs:18-25`).

[`BaseIntegrationEvent`](#baseintegrationevent) adds a `virtual SchemaVersion` defaulting to `1`
(`MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:33`). Additive or optional field changes keep
the version, but a breaking change (a renamed, removed, or retyped field) requires a NEW event type
plus an **upcaster**, never a silent reshape of an existing contract
([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)). That
upcaster is a registration, not a convention
([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)): the module calls
`services.AddEventUpcaster<FooV1, FooV2, FooUpcaster>()`, and a host still receiving the retired
contract over a broker adds `RegisterUpcastedIntegrationEventConsumer<FooV1>()` beside its
`RegisterIntegrationEventConsumer<FooV2>()` (`BaseIntegrationEvent.cs:22-31`). Handlers are then
written once, against the newest contract. Declaring `SchemaVersion` virtual with a default is what
kept adding the member a non-breaking change for every event that already existed.

Two reusable shapes sit on top of those bases.
[`EntityChangedEvent<TIdentifierType>`](#entitychangedeventtidentifiertype) is a CRUD-lifecycle event
carrying a [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate)
(Added/Updated/Deleted) and the affected `EntityId`
(`MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24-27`), so entities do not each hand-roll
three near-identical event records; its own remarks reserve it for generic lifecycle events and send
state-machine transitions such as `OrderPaid` back to `BaseDomainEvent`
(`EntityChangedEvent.cs:16-20`). [`OutputCacheEvictionRequested`](#outputcacheevictionrequested) is the
framework's one concrete integration event
(`MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:29`): a tag list broadcast to
every host that serves output-cached responses, because ASP.NET Core's output cache is per host and a
write in the owning service otherwise leaves a stale response in front of every other replica
(`OutputCacheEvictionRequested.cs:12-17`). Its `Tags` list defaults to empty rather than being
`required`, so a message arriving without the field deserializes into a harmless no-op instead of
faulting a consumer (`OutputCacheEvictionRequested.cs:37`), and it carries an explicit
`[EventName("Common.OutputCacheEvictionRequested.v1")]` identity
(`OutputCacheEvictionRequested.cs:28`).

This split (markers and base records in `Domain`, all dispatch and persistence machinery in
`Application`/`Infrastructure`) is textbook `[Rubric §3, Clean Architecture]` (the domain declares
*what* an event is; outer layers decide *how* it travels) and `[Rubric §6, CQRS & Event-Driven]` (an
explicit, first-class event model rather than implicit side effects). The `SchemaVersion` plus
upcaster convention is the `[Rubric §9, API & Contract Design]` angle: an event on the wire is a
versioned contract like any API surface.

## Stored identity: what a row remembers an event as

An event in memory is a CLR type; an event in a table is a *string*. Which string it is decides
whether a row survives a refactoring, and [`EventNameResolver`](#eventnameresolver) is the single
cached lookup that answers it for both storage sites
(`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/EventNameResolver.cs:19`). An event that declares
[`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) is stored under that
declared name, which no rename, namespace move, or assembly move changes. An event without one keeps
exactly the identity it had before this type existed: `GetStorageName` falls back to the
assembly-qualified name for the outbox (`EventNameResolver.cs:47-51`) and `GetInboxName` to the short
type name for the inbox (`EventNameResolver.cs:59-60`). That fallback is what makes adoption opt-in
and leaves rows already in flight unaffected. The declared name is cached per type, including the
`null` "no attribute" answer, so the common unannotated case pays one reflection lookup per type per
process rather than one per event (`EventNameResolver.cs:26,35-38`). The reverse direction, resolving a
stored name that is not a CLR name, scans loaded assemblies lazily and degrades to the types that did
load when a dependency is missing (`EventNameResolver.cs:75-81,90-100`).

## Raising and capturing: where the outbox is written

Aggregates raise events by calling `AddDomainEvent()` (see
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
in G02), which simply buffers them on the entity. Nothing is dispatched yet; the events ride along
until the next save. The actual capture happens in EF Core's save pipeline, in
[`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
(G07). On `SavingChanges` it snapshots the change tracker's aggregate roots that have buffered events
and calls [`OutboxMessage.FromDomainEvent(...)`](#outboxmessage) on each, serializing the event to JSON
with cycle-ignoring options, resolving its stored `EventType` through `EventNameResolver`, and
capturing the current W3C trace and span IDs
(`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:99-118`). Those
[`OutboxMessage`](#outboxmessage) rows are `Add`ed to the *same* `DbContext`, so the outbox row and the
aggregate change land in **one atomic transaction**
(`MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:236-271`).
This is the single most important guarantee in the chapter: if the business data committed, the event
is durably recorded; if the transaction rolled back, neither exists. There is no window where they
disagree. `[Rubric §8, Data Architecture]` (transactional integrity) and `[Rubric §6]` both hinge on
this atomicity. Crucially, the rows go to the same physical database as the aggregate: every
relational source owns its own `OutboxMessages` table, never a shared one
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html); the table and its three
filtered indexes, pending, processed, and ordering, are configured in
`MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:529-563`, with the inbox's
unique index at `ApplicationDbContext.cs:571-584`; see the
[primer on database-per-service](00-primer.md#2-architectural-styles-this-codebase-commits-to)).

Two details of the capture exist to stop *duplicate* rows. The interceptor snapshots exactly the events
it captured and removes exactly those again after dispatch, so anything a handler raises mid-dispatch
survives to a later capture instead of being wiped
(`DomainEventSaveChangesInterceptor.cs:329-352`). And a save that started but never completed (a failed
save followed by an execution-strategy retry) has its still-Added outbox rows detached before the next
capture, so the retry does not write a second row per event
(`DomainEventSaveChangesInterceptor.cs:274-293`).

## The routing split: local events dispatch in-process, integration events wait for the bus

Here is the detail that most people get wrong, and it is the heart of the design. After the
transaction commits (`SavedChanges`), the interceptor does **not** treat all captured events the same.
Pure **domain** events (the *local* events) are dispatched in-process through
[`IDomainEventDispatcher`](#idomaineventdispatcher) and their outbox rows are then marked processed.
**Integration** events are deliberately *not* dispatched in-process at all: their outbox rows stay
unprocessed, and the background [`OutboxProcessor`](#outboxprocessor) later publishes them through
[`IMessageBus`](#imessagebus), so the registered transport (in-process for the monolith, broker for an
extracted service) decides delivery (`DomainEventSaveChangesInterceptor.cs:237-256,324-352`). That
routing is what makes `AddDomainEvent(someIntegrationEvent)` broker-correct: without it, such an event
would be dispatched locally and marked processed, silently never reaching the wire. When the context
has no outbox table (Cosmos) *or* the host turned the outbox off, the interceptor falls back to
dispatching *everything* in-process, since nothing would carry integration events to a processor
anyway (`DomainEventSaveChangesInterceptor.cs:54,263-267`). One more subtlety: when the save runs inside
a Transactional command's transaction, all this post-save work is *deferred until after commit*
(`DomainEventSaveChangesInterceptor.cs:301-318`), flushed by
[`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) once the commit succeeds and
dropped on rollback, so handler side effects never act on state that could still roll back.

The mark-processed step is not a second nested `SaveChanges`. It goes through
[`OutboxFinalizer`](#outboxfinalizer), which stamps every row in the batch with a single set-based
`ExecuteUpdate` and then re-syncs the change tracker (original value first, then clearing `IsModified`)
so a later save does not re-issue the statement
(`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxFinalizer.cs:26-53`), keeping the hottest write
path (every event-raising command) free of an extra full save. The dispatcher itself
([`DomainEventDispatcher`](#domaineventdispatcher)) is a small, performance-conscious piece of
machinery. For each event it resolves every registered
[`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent) and, if the event is also
an integration event, every
[`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
(`MMCA.Common.Application/Services/DomainEventDispatcher.cs:46-67`), invoking each through a **compiled
expression-tree delegate cached per (event type, handler interface)** so the generic `HandleAsync` call
avoids reflection and boxing at runtime (`DomainEventDispatcher.cs:41-43,97-117`), relevant to
`[Rubric §12, Performance & Scalability]`. The integration branch runs the event through
[`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) first, so a retired
contract (including one deserialized from an outbox row written before an upgrade) reaches the handlers
written against its successor (`DomainEventDispatcher.cs:62`); the domain-event branch is deliberately
untouched, because intra-module handlers keep receiving the original type and instance.

Handlers that perform side effects (email, downstream writes) derive from one of two bases, and the
contract of both is the opposite of what "safe" suggests.
[`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent) logs the failure with
handler and event context and then lets the exception **propagate unchanged**, through an exception
filter so the log write precedes any unwinding and the stack trace stays intact
(`MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:36-47,61-70`);
`OperationCanceledException` passes straight through with no log line, because host shutdown is not a
delivery failure (`SafeDomainEventHandler.cs:42`). Swallowing made the "the outbox will retry it"
promise false: a handler that reported success got its outbox row marked processed, so nothing ever
retried and the side effect was lost (`SafeDomainEventHandler.cs:13-20`). The consequence to design for
is **batch** redelivery: the interceptor dispatches every local event of one save in a single call, so
one rethrowing handler skips the mark-processed step for that whole local batch and the processor
redelivers all of them, not just the event that failed (`SafeDomainEventHandler.cs:21-29`).
[`ScopedIntegrationEventHandlerBase<TIntegrationEvent>`](#scopedintegrationeventhandlerbasetintegrationevent)
is its cross-module sibling and adds the one thing integration handlers all need: because they are
registered as singletons they cannot constructor-inject a scoped service, so the base opens an
`AsyncServiceScope` per delivery and hands the subclass that scope's provider
(`MMCA.Common.Application/DomainEvents/ScopedIntegrationEventHandlerBase.cs:51-55`), with the same
log-and-rethrow envelope and an overridable `LogHandlerFailure` for source-generated logging
(`ScopedIntegrationEventHandlerBase.cs:87-92`). Subclasses of either base must be idempotent about
their own event *and* about every sibling event raised by the same save.

## The safety net: how the processor schedules itself

The [`OutboxProcessor`](#outboxprocessor) is a `BackgroundService` and the most intricate type in the
group; most of its complexity is about **not** wasting work. It exists because the steps between
*commit* and *mark-processed* can be interrupted: the process can crash, or in-process dispatch can
throw. When that happens the row stays unprocessed (and the interceptor signals the processor on its
failure path, `DomainEventSaveChangesInterceptor.cs:338-346`) and the processor catches it on a later
cycle. This is the **at-least-once** guarantee of
[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html). Its unavoidable cost is
that the *same* event may be delivered more than once, so **handlers must be idempotent**. That is not
a wart; it is the documented contract and a healthy discipline regardless.

The processor never blindly polls on a fixed clock. After a five second startup delay
(`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:107`) it drains every outbox
**target** once per cycle and aggregates the per-target results into an
[`OutboxCycleResult`](#outboxcycleresult) (`OutboxProcessor.cs:208-246`), then waits on
[`IOutboxSignal`](#ioutboxsignal) for whichever comes first: a **signal** (a writer called `Signal()`
after persisting a row; [`OutboxSignal`](#outboxsignal) is a `SemaphoreSlim(0, 1)` wrapper whose
single-permit cap deliberately absorbs a burst of surplus signals, since one batch drains everything
anyway, `MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxSignal.cs:17-30`), the moment the earliest
pending-but-not-yet-eligible row *becomes* eligible (the **smart wait**), or the fallback
`PollingIntervalSeconds` (`OutboxProcessor.cs:130-145`, arithmetic in `ComputeWaitTime` at
`OutboxProcessor.cs:155-173` with a one second floor so an overdue row cannot hot-loop the service,
`OutboxProcessor.cs:76`). A target is one owned relational source against the shared database, plus one
extra unit per tenant that keeps its own copy of a source, because a tenant database has its own
`OutboxMessages` table that nothing else would ever open
(`OutboxProcessor.cs:180-200`); each target is visited in its own DI scope with `ITenantContext` set
before the context is asked for, since the tenant is what routes the factory to the right database
(`OutboxProcessor.cs:258-268`).

Rows are only eligible `ProcessingDelaySeconds` (default 5s,
[`OutboxSettings`](#outboxsettings), `OutboxSettings.cs:40`) after
creation, split off the fetched batch by an ordered prefix scan (`OutboxProcessor.cs:287-293`). That
delay is deliberate: it gives the in-process happy path time to mark local rows processed before the
processor would re-deliver them, bounding the duplicate-delivery window. The smart wait means that even
when the fallback interval is raised in a deployed environment (the default is 2s and the property's
own remarks name 300 as the deployed value to cut idle polling, `OutboxSettings.cs:23-31`), an event
still goes out about 5s after it was written. Batches are 50 rows (`OutboxSettings.cs:17`). One
unreachable database cannot starve the others: each target is drained inside its own try/catch and a
failing target simply contributes nothing to this cycle (`OutboxProcessor.cs:228-238`).

## Claiming, scale-out, and ordered delivery

Because a deployment may run more than one replica, each cycle **claims** its eligible prefix with a
lease (`LockedUntil` plus `LockToken`,
`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:52-65`) via a conditional
`ExecuteUpdate` before dispatching (`OutboxProcessor.cs:454-498`), and the poll query skips rows under
an unexpired lease (`OutboxProcessor.cs:411-429`). Two replicas therefore can never double-dispatch the
same row, and a replica that dies mid-batch releases its rows when the lease expires (`LeaseSeconds`,
default 300, `OutboxSettings.cs:82`). When the claim comes back partial, the processor re-reads which
ids carry *its own* token and processes only those (`OutboxProcessor.cs:486-497`). That is scale-out
safety by construction, not merely by the `minReplicas: 1` deployment convention. Graceful shutdown gets
the same care: a cancellation landing mid-batch would otherwise strand the `ProcessedOn` stamps in the
change tracker and redeliver already-delivered messages when the lease expired, so the processor
flushes those stamps on the way out under a five second budget and its own short-lived token
(`OutboxProcessor.cs:83,317-327,388-400`).

The claim is also where **ordered delivery** is enforced. An event that opts in by implementing
[`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey) has its key copied onto the
outbox row at capture (`OutboxMessage.cs:85,115`), and the claim predicate then refuses that row while
any earlier unprocessed, non-dead-lettered row shares the key, expressed as a correlated `NOT EXISTS`
inside the update itself so a racing replica loses on the row rather than on a check made before the
race (`OutboxProcessor.cs:544-554`). Within one cycle, `SelectOrderedCandidates` keeps at most the
first row per key (`OutboxProcessor.cs:507-523`), and a batch containing no keyed row runs exactly the
query it always ran, so hosts that never declare a key pay nothing for the feature
(`OutboxProcessor.cs:470-475`). The cost is head-of-line blocking, documented on the interface itself:
a retrying keyed row blocks its successors until it succeeds or exhausts its retries, so keys must be
as narrow as the requirement really is (one per aggregate, never a constant).

## Failures, dead-letters, and keeping the table (and telemetry) bounded

Delivery failures split into outcomes worth keeping straight. A *transient* failure (a handler or
broker publish throwing) increments the row's `RetryCount`, records `LastError`, and **re-leases** the
row for an explicit exponential backoff rather than leaving this cycle's claim on it
(`OutboxProcessor.cs:631-643`). The backoff is `RetryBackoffBaseSeconds * 2^(n-1)` (base 10s,
`OutboxSettings.cs:99`) multiplied by a random jitter factor in `[0.8, 1.2]` and capped at the lease
(`OutboxProcessor.cs:732-746`); the jitter is what stops fifty rows that failed together on one
dependency outage from retrying in lockstep against that same dependency. The poll query only ever
selects rows with `RetryCount < MaxRetries` (5 by default, `OutboxProcessor.cs:422`,
`OutboxSettings.cs:21`), so once a row exhausts its retries it stops being fetched, stalls unprocessed
with its last error, and is counted on the `outbox.dead_letter.count` counter with
`reason=retries_exhausted` plus one loud `Error` log line at the moment of exhaustion
(`OutboxProcessor.cs:667-677`). A row whose stored `EventType` resolves to nothing is treated more
gently than it once was: the FIRST such attempt is retried through the normal backoff with a `Warning`
naming the fix (give the event an `[EventName]`), because the declaring assembly may simply not be
loaded yet; only the second attempt is terminal, marking the row processed and counting it with
`reason=type_unresolvable` (`OutboxProcessor.cs:701-723`), so an undeliverable payload cannot block the
queue behind it. Broker publishes additionally run inside a **circuit breaker** built from
[`BrokerResilienceDefaults`](group-16-aspire-orchestration.md#brokerresiliencedefaults) and carrying no
retry strategy of its own, since the outbox already owns retry
(`OutboxProcessor.cs:99,755-766`). The breaker wraps *only* the broker hop, never the in-process
dispatcher branch or the database calls (`OutboxProcessor.cs:592-605`), and an open circuit is reported
as its own fact: one `BrokerMetrics.CircuitOpenCounter` increment per row and one `Warning` per batch
rather than fifty identical lines (`OutboxProcessor.cs:653-665`).

The instruments themselves live in [`OutboxMetrics`](#outboxmetrics), a single OpenTelemetry meter
named `MMCA.Common.Outbox` (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs:19`)
carrying the dead-letter counter (`OutboxMetrics.cs:41-44`), a success counter
(`OutboxMetrics.cs:47-50`), an end-to-end **delivery lag** histogram in seconds, the number that
answers "how far behind is eventual consistency right now" (`OutboxMetrics.cs:57-60`, recorded and
clamped against clock skew at `OutboxProcessor.cs:617-619`), an observable **backlog depth** gauge
(`OutboxMetrics.cs:75-79`), and an **oldest-pending age** gauge per data source, which is what an alert
on a wedged outbox fires on (`OutboxMetrics.cs:98-102`). Both gauges are per instance, not fleet-wide,
and both are derived from the fetch wherever they can be: the poll is already ordered by `OccurredOn`,
so its first row *is* the oldest (`OutboxProcessor.cs:281-283`), and a short batch *is* the whole
backlog, so only a saturated batch pays for a `COUNT` (`OutboxProcessor.cs:352-373`). This is dense
`[Rubric §13, Observability & Operability]` and `[Rubric §31, Cost/FinOps]` territory: both the poll and
that count run inside a named `OutboxPoll` activity (`OutboxProcessor.cs:73,364,417`) which
[`OutboxPollFilterProcessor`](group-16-aspire-orchestration.md#outboxpollfilterprocessor) (G16)
suppresses from telemetry export, so a fleet of idle services polling around the clock does not flood
Application Insights, and the per-message success line is `Debug` for the same reason
(`OutboxProcessor.cs:812-816`). Each dispatched message also re-parents an `OutboxProcess` consumer
activity onto the trace context stored on its row, so the broker hop stays linked to the request that
raised the event (`OutboxProcessor.cs:773-795`).

A sibling [`OutboxCleanupService`](#outboxcleanupservice) keeps the tables bounded. Every
`CleanupIntervalHours` (default 6, `OutboxSettings.cs:73`) it purges processed rows older than
`RetentionDays` (default 7, `OutboxCleanupService.cs:94,114`, `OutboxSettings.cs:65`), then purges
*dead-lettered* rows on their own `DeadLetterRetentionDays` window, falling back to `RetentionDays` when
that setting is left at its default of zero (`OutboxCleanupService.cs:155-164`, `OutboxSettings.cs:108`),
since those rows never get a `ProcessedOn` and would otherwise accumulate forever inside the pending
index that every poll re-scans. When the inbox is enabled it purges processed inbox rows on the same
cutoff (`OutboxCleanupService.cs:58,179-186`). Setting `RetentionDays` to `0` disables the sweep entirely
(`OutboxCleanupService.cs:64-68`). Because payloads may contain personal data, this sweep is also part of
the privacy posture of [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html).
Both background services take an optional `TimeProvider` (`OutboxProcessor.cs:61-65`,
`OutboxCleanupService.cs:54-59`) so tests can drive an hour-scale loop deterministically instead of
waiting on wall-clock time, a small but real `[Rubric §14, Testability]` win.

Dead letters are not only swept, they are **operable**. [`OutboxAdministration`](#outboxadministration)
is the scoped EF-backed admin surface behind
[`IOutboxAdministration`](group-07-persistence-ef-core.md#ioutboxadministration): it lists dead letters
with merged paging across every target and a hard 500-row page cap
(`MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxAdministration.cs:46,57`), counts pending rows
(`OutboxAdministration.cs:174`), and replays dead letters as one set-based `UPDATE` per target followed
by a `Signal()` so the processor picks them up immediately rather than on the next interval
(`OutboxAdministration.cs:115,146,167`). It visits the same tenant-expanded targets in the same
per-scope way the two background services do (`OutboxAdministration.cs:16-26`), and its validation
failures come back as [`Result`](group-01-result-error-handling.md#result) errors rather than
exceptions (`OutboxAdministration.cs:47-51,62-66`).

## The pluggable transport, and the posture flags that decide it

Here is the boundary that makes a module extractable without rewriting its handlers. Application code
that wants to publish an integration event depends on [`IEventBus`](#ieventbus) (or on the lower-level
[`IMessageBus`](#imessagebus), both defined in `Application`, so neither ever sees MassTransit).
Infrastructure supplies two interchangeable implementations of each, selected by registration:

- **Monolith mode** (the defaults, `MMCA.Common.Infrastructure/DependencyInjection.cs:564,570`).
  [`InProcessEventBus`](#inprocesseventbus) writes the events to the outbox in one save, dispatches them
  in-process, and marks them processed through the same [`OutboxFinalizer`](#outboxfinalizer) path as
  the interceptor (`MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:76-99`), falling back to a
  plain dispatch when the context has no outbox support or the host disabled the outbox
  (`InProcessEventBus.cs:42,80-84`). [`InProcessMessageBus`](#inprocessmessagebus) just hands the event
  straight to the dispatcher (`MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:22-33`); it is
  what the `OutboxProcessor` calls when draining an integration-event row in monolith mode.
- **Broker mode** (`AddBrokerMessaging`, which *replaces* both registrations,
  `DependencyInjection.cs:771,777`). [`BrokerEventBus`](#brokereventbus) writes the whole batch to the
  outbox in ONE save and then **signals the processor without dispatching in-process**
  (`MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:65-91`), because the consumers live in other
  processes, so an in-process dispatch would be wrong; a data source with no outbox support throws
  loudly here rather than silently dropping events (`BrokerEventBus.cs:69-76`). The `OutboxProcessor`
  then drains the row and publishes it through [`BrokerMessageBus`](#brokermessagebus), which hands it to
  MassTransit using the event's **runtime** type so routing binds to the concrete event class rather
  than the `IIntegrationEvent` base interface
  (`MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:27-34`) for RabbitMQ (dev) or Azure Service
  Bus (prod). MassTransit propagates the trace context across the broker hop, so distributed traces stay
  connected (`BrokerMessageBus.cs:18-22`).

Whether the outbox exists at all is itself configuration, and it resolves from the transport.
[`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings) exposes
`IsOutboxEnabled` and `IsInboxEnabled`, each defaulting to ON for a broker provider and OFF for
`InProcess` (`MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:125,159`). A single-process
application dispatches every event inside the process that raised it, so store-and-forward buys it two
background services, a table and a poll loop and nothing else; a broker deployment cannot deliver at all
without it. An explicit value wins in both directions for the in-process transport, so a monolith that
wants at-least-once delivery across a crash sets `MessageBus:EnableOutbox=true`
(`MessageBusSettings.cs:151`), but turning the outbox OFF under a broker is refused at registration with
a startup failure rather than honored, because it would drop every cross-service event silently
(`DependencyInjection.cs:862`). Neither posture is allowed to be invisible: with the outbox off,
[`OutboxDisabledNoticeService`](#outboxdisablednoticeservice) logs one startup `Information` line naming
the changed guarantee (`MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxDisabledNoticeService.cs:22-38`,
registered at `DependencyInjection.cs:190-197`), and with the inbox explicitly off under a broker,
[`InboxDisabledWarningService`](#inboxdisabledwarningservice) logs one `Warning`
(`MMCA.Common.Infrastructure/Persistence/Inbox/InboxDisabledWarningService.cs:20-36`,
`DependencyInjection.cs:795`). The level difference is deliberate: the first is the default posture of a
small application, the second is an opt-out of a safety feature.

The selection between transports is a pure DI swap: no application or domain code changes. That is the
whole point of `[Rubric §7, Microservices Readiness]`: transport choices live at the edges, and the
NetArchTest transport-boundary rule forbids `Application`/`Domain`/`Shared` from referencing MassTransit
at all (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:7`,
[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). Note the deliberate
division of labor: the **`*EventBus`** types own *outbox persistence* (write and signal); the
**`*MessageBus`** types own *delivery only* and are invoked by the processor when draining
already-persisted rows.

## Consuming from the broker: the inbox and the generic consumer

On the receiving side of a broker hop, application code keeps writing plain
`IIntegrationEventHandler<TEvent>` implementations; there is no MassTransit-specific consumer class to
author per event. The generic [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) is
the single adapter that bridges MassTransit's `IConsumer<TEvent>` to all the registered in-process
handlers (`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:34-96`), registered per event
type via [`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions)'s
`RegisterIntegrationEventConsumer<TEvent>()`, an `extension(IBusRegistrationConfigurator)` block
(`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:14`) that also
registers a
[`FaultIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#faultintegrationeventconsumertevent)
by default, so a message that exhausts its retries leaves more trace than an unwatched `_error` queue
(`IntegrationEventConsumerExtensions.cs:38-50`). The fault registration is a defaulted opt-out, not a
fixed rule: `registerFaultConsumer` defaults to `true` (`IntegrationEventConsumerExtensions.cs:39,44-47`)
and a host that routes an event's faults itself (a dedicated fault service, or its own
`IConsumer<Fault<TEvent>>`) passes `false` so two consumers do not compete for the same fault topic
(`IntegrationEventConsumerExtensions.cs:31-37`). Two siblings sit
beside it: `RegisterUpcastedIntegrationEventConsumer<TEvent>()` drains a retired contract through
[`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent)
into the handlers of its successor, taking the same fault-consumer flag
(`IntegrationEventConsumerExtensions.cs:78-90`,
[ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)); its remarks warn
against also registering the plain consumer for the retired type, since two consumers on one event
compete for one queue and would run the handlers twice
(`IntegrationEventConsumerExtensions.cs:58-64`). And
`RegisterOutputCacheEvictionConsumer()` is the named shorthand for the framework's own eviction
broadcast, forwarding that same flag into
`RegisterIntegrationEventConsumer<OutputCacheEvictionRequested>()`
(`IntegrationEventConsumerExtensions.cs:108-110`). A handler that throws is logged with the
failing handler's type and rethrown so MassTransit's configured retry policy runs before the message is
dead-lettered (`IntegrationEventConsumer.cs:69-82`), and a message with no registered handler in this
process is acked with a log line rather than being retried forever
(`IntegrationEventConsumer.cs:85-91`).

Because broker delivery is *also* at-least-once, the consumer guards against duplicates with the
**inbox** ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)), and the
shape of that guard is the subtle part. [`IInboxStore`](#iinboxstore) is a three-step contract:
`TryBeginAsync` before the handlers, `CompleteAsync` after they all succeed, `Abandon` when one fails
(`MMCA.Common.Infrastructure/Persistence/Inbox/IInboxStore.cs:38-63`); the older
`AlreadyProcessedAsync`/`MarkProcessedAsync` pair remains on the interface and supplies the default
implementations of the three, so an external implementation keeps working unchanged
(`IInboxStore.cs:19-22`). What `TryBeginAsync` adds is **staging**: [`EfInboxStore`](#efinboxstore)
does not write the [`InboxMessage`](#inboxmessage) row after the handlers run, it stages it into the
same scoped `ApplicationDbContext` the handlers write through
(`MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:49,61-68`). A handler's own
`SaveChangesAsync` therefore commits the dedup row in the same transaction as its mutations, closing by
construction the window where a crash between "handler committed" and "inbox written" reprocessed the
whole event; `CompleteAsync` saves the staged row only when nothing else already did, which covers
events whose handlers write nothing (`EfInboxStore.cs:71-80`). The consumer calls `Abandon` on a handler
failure so the failed attempt leaves neither a rejected insert on the scope's context nor a row that
would make the redelivery look like a duplicate (`IntegrationEventConsumer.cs:74`). Concurrent duplicate
deliveries are absorbed by the unique index on `MessageId` (`ApplicationDbContext.cs:576-578`), whichever
save hits it. The dedup key is `EventNameResolver.GetInboxName(...)`, so an unannotated event keeps
matching the rows it already wrote (`IntegrationEventConsumer.cs:43`). When the inbox is disabled the
no-op [`NoOpInboxStore`](#noopinboxstore) is registered so behavior is unchanged
(`MMCA.Common.Infrastructure/Persistence/Inbox/NoOpInboxStore.cs:7-14`, `DependencyInjection.cs:790`).
The outbox is the *producer-side* idempotency mechanism; the inbox is its *consumer-side* mirror.
Together they make the cross-service event flow effectively-once on top of at-least-once transport
(`[Rubric §6]`, `[Rubric §29, Resilience & Business Continuity]`).

## Putting it together, one event's life

To see the whole spine at once, follow a single integration event from a producer service to a consumer
service in **broker mode**. (1) A command mutates an aggregate, which raises an integration event via
`AddDomainEvent(...)`; the interceptor captures it into an [`OutboxMessage`](#outboxmessage) in the same
transaction, stores its identity through [`EventNameResolver`](#eventnameresolver), and, because it is
an integration event, deliberately does *not* dispatch it in-process: it only signals the processor.
(2) Once the row is eligible (after `ProcessingDelaySeconds`) and unblocked by any earlier row sharing
its `OrderingKey`, the [`OutboxProcessor`](#outboxprocessor) claims it under a lease, deserializes it,
sees it is an [`IIntegrationEvent`](#iintegrationevent), and publishes it through
[`IMessageBus`](#imessagebus) behind the broker circuit breaker, which in broker mode is
[`BrokerMessageBus`](#brokermessagebus) to MassTransit to the broker, then stamps the row processed and
records its delivery lag on [`OutboxMetrics`](#outboxmetrics). (3) In the consumer service,
[`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) receives it, asks the
[`IInboxStore`](#iinboxstore) to begin (which skips the message outright if that `MessageId` was already
handled, and otherwise stages the dedup row), runs every `IIntegrationEventHandler<TEvent>`, and
completes so a redelivery is skipped. (4) Back on the producer,
[`OutboxCleanupService`](#outboxcleanupservice) eventually purges the processed row, and anything that
dead-lettered stays visible to [`OutboxAdministration`](#outboxadministration) until its own retention
window closes. In monolith mode steps 2 and 3 collapse: with the outbox on, the registered
[`IMessageBus`](#imessagebus) is [`InProcessMessageBus`](#inprocessmessagebus), which hands the event to
the same [`DomainEventDispatcher`](#domaineventdispatcher) that local events already flow through, and
application code that publishes directly uses [`InProcessEventBus`](#inprocesseventbus) to write,
dispatch, and finalize in one call; with the outbox off (the in-process default) that same call is a
straight synchronous dispatch and no row is written at all. The *contracts the application code touches
never change*, which is exactly the property that lets a module graduate to its own service without a
rewrite ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). For the
mechanics of *why* each design choice was made,
[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) (outbox and at-least-once),
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (per-service outbox),
[ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) (event
versioning), [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)
(upcaster registration), [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)
(consumer inbox), and [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) with
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) (transport at the
edge) are the primary references.

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
  creation by [`BaseDomainEvent`](#basedomainevent)
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:35`, alongside the
  `DateOccurred` default on line 28), survives outbox serialization inside the JSON payload, travels
  through the broker, and lands in an [`InboxMessage`](#inboxmessage) as the dedup key
  ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).
- **Why it's built this way**: a minimal marker keeps the domain free of dispatch mechanics, and the
  two members are exactly what the outbox/inbox machinery needs (ordering and eligibility by
  occurrence time, dedup by id). Note what is *not* here: no `Version`, no routing key, no transport
  metadata. Those live one layer out, on [`OutboxMessage`](#outboxmessage) and on
  [`BaseIntegrationEvent`](#baseintegrationevent).
- **Where it's used**: implemented by concrete domain events in each module; raised by
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (G02), captured from aggregates during `SaveChangesAsync` by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  (G07), serialized into an [`OutboxMessage`](#outboxmessage) by `OutboxMessage.FromDomainEvent`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:99`), and
  dispatched by [`IDomainEventDispatcher`](#idomaineventdispatcher) or the
  [`OutboxProcessor`](#outboxprocessor).

### IInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/IInboxStore.cs:16` · Level 0 · interface

- **What it is**: the consumer-side idempotency port. It lets a broker consumer detect and skip an
  integration event that this service has already processed, and it owns the small protocol that
  brackets a consume: open, run handlers, close (or discard on failure).
- **Depends on**: nothing first-party (BCL `Guid`/`Task`). Conceptually keyed by
  [`IDomainEvent`](#idomainevent)'s `MessageId`, and backed by [`InboxMessage`](#inboxmessage) rows in
  the EF implementation.
- **Concept introduced, the consumer-side Inbox ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)).** `[Rubric §6, CQRS & Event-Driven]`
  (idempotent consumers) and `[Rubric §29, Resilience & Business Continuity]` (assesses tolerance of
  duplicate or redelivered messages). The *inbox* is the consumer-side complement to the *outbox*.
  Every reliable broker guarantees **at-least-once** delivery, so the same message can arrive more
  than once after a transient failure. The inbox records the message ids it has successfully
  processed; on redelivery the store answers "already seen" and the consumer discards the duplicate
  without re-running side effects. The doc comment states the shape of the protocol
  (`IInboxStore.cs:8-14`): `TryBeginAsync` -> handlers -> `CompleteAsync`, where **`TryBeginAsync`
  stages the inbox row in the same scoped unit of work the handlers write through**, so a handler's
  own `SaveChangesAsync` commits the row together with its mutations and a crash between the two
  becomes impossible.
- **Concept introduced, default interface implementations as a compatibility layer.**
  `[Rubric §1, SOLID]` (interface segregation and open/closed extension) and
  `[Rubric §15, Best Practices & Code Quality]`. Three of the five members ship **bodies on the interface itself**:
  `TryBeginAsync` (`IInboxStore.cs:38-39`) is defined as `!await AlreadyProcessedAsync(...)`,
  `CompleteAsync` (`IInboxStore.cs:48-49`) forwards to `MarkProcessedAsync`, and `Abandon`
  (`IInboxStore.cs:63`) returns `true`. The `<remarks>` says why (`IInboxStore.cs:33-37`): an
  implementation that only supplies the two abstract members keeps the older
  write-the-row-after-the-handlers behavior and still compiles, so the staging protocol was added
  without breaking an external implementation of the port.
- **Walkthrough**, in protocol order.
  - `AlreadyProcessedAsync(Guid messageId, CancellationToken)` (`IInboxStore.cs:19`): the abstract
    keyed lookup by the event's `MessageId`.
  - `MarkProcessedAsync(Guid messageId, string eventType, CancellationToken)` (`IInboxStore.cs:22`):
    the abstract write. `eventType` is retained for diagnostics only.
  - `TryBeginAsync(...)` (`IInboxStore.cs:38-39`): returns `false` when the message was already
    processed, in which case the caller must skip its handlers and ack; otherwise it stages the row
    and returns `true` (`IInboxStore.cs:24-32`).
  - `CompleteAsync(...)` (`IInboxStore.cs:48-49`): persists the staged row **only if a handler's save
    has not already committed it**, and the contract calls itself idempotent
    (`IInboxStore.cs:41-44`).
  - `Abandon(Guid messageId)` (`IInboxStore.cs:63`): the failure branch. Its return value carries the
    honest bad news (`IInboxStore.cs:57-62`): `true` means the staged row was discarded before it
    reached the database so the redelivery will reprocess, `false` means an earlier handler's save had
    already committed the row, so the redelivery is treated as a duplicate and the remaining handlers
    will not run again.
- **Why it's built this way**: the port lets the no-op and EF-backed implementations be swapped by
  configuration without touching consumer code, a §1/§6 dependency-inversion win, and putting the
  protocol (not just the two data operations) on the interface keeps the ordering rules in one place
  instead of in every consumer. **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** records this inbox as the broker-consume sibling of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)'s outbox (producer side) and [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)'s HTTP-edge idempotency, deduping broker
  redeliveries by `MessageId` in the consumer's own database with a unique index as the race guard.
- **Where it's used**: consumed by [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  (this group), which takes it as a primary-constructor parameter
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:29`),
  calls `TryBeginAsync` before invoking handlers (`IntegrationEventConsumer.cs:54`), `Abandon` on a
  handler exception (`IntegrationEventConsumer.cs:74`), and `CompleteAsync` after they all succeed
  (`IntegrationEventConsumer.cs:95`). Implemented by [`EfInboxStore`](#efinboxstore) and
  [`NoOpInboxStore`](#noopinboxstore).
- **Caveats / not-in-source**: both registrations live inside `AddBrokerMessaging`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:746`), which returns
  early when the configured provider is in-process (`DependencyInjection.cs:755-758`), so a monolith
  host that never calls it has no `IInboxStore` in the container at all. That is consistent (nothing
  consumes the port without a broker consumer) but it does mean the inbox posture is a *broker-mode*
  decision, not a container-wide one.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### InboxDisabledWarningService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/InboxDisabledWarningService.cs:20` · Level 0 · class (internal sealed partial, `IHostedService`)

- **What it is**: a one-shot hosted service that writes a single Warning at startup when a host runs
  broker messaging with consumer-side inbox deduplication **explicitly** turned off. It does nothing
  else: no timer, no per-message work.
- **Depends on**: `ILogger<InboxDisabledWarningService>` via primary constructor
  (`InboxDisabledWarningService.cs:20`) and `Microsoft.Extensions.Hosting.IHostedService`
  (`InboxDisabledWarningService.cs:21`). It names [`NoOpInboxStore`](#noopinboxstore) in its doc
  comment but has no code dependency on it.
- **Concept introduced, making a disabled safety feature audible.** `[Rubric §13, Observability &
  Operability]` (assesses whether an operator can tell the running posture of the system from its
  own output) and `[Rubric §29, Resilience & Business Continuity]` (duplicate tolerance). The class
  comment states the argument (`InboxDisabledWarningService.cs:6-17`): a silently disabled safety
  feature is indistinguishable from an enabled one until the first duplicate side effect reaches a
  customer, so the off state is made loud exactly once, at startup, where it costs one log line and
  nothing per message. Because the inbox now **defaults to ON for every broker transport**
  (`MessageBusSettings.IsInboxEnabled`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:125`), reaching
  this service means the host set `MessageBus:EnableInbox=false` deliberately, so the text reads as an
  opt-out record rather than a nudge about a default (`InboxDisabledWarningService.cs:12-17`). This is
  the deliberate opposite of the per-message success log in [`OutboxProcessor`](#outboxprocessor),
  which is Debug precisely because it recurs.
- **Walkthrough**: `StartAsync` (`InboxDisabledWarningService.cs:24-28`) calls the source-generated
  `LogInboxDisabled` and returns `Task.CompletedTask`; `StopAsync`
  (`InboxDisabledWarningService.cs:31`) is a completed task. The message itself is the teaching
  artifact (`InboxDisabledWarningService.cs:33-36`): it names the setting and the store that produced
  the posture, states that the broker default is ON, explains that at-least-once delivery means every
  redelivered message runs its handlers again and duplicates their side effects until each handler is
  idempotent on its own, gives the remedy (remove the setting or set it to `true`), and notes that the
  `InboxMessages` table is already part of the model, so turning it back on needs no schema work.
- **Why it's built this way**: registering the warning **only on the disabled branch** means a host
  that keeps the default never constructs this service at all, so the correct configuration pays
  nothing. Emitting it from `StartAsync` rather than from the DI registration puts it in the host's
  startup log next to the rest of the boot sequence, where an operator reads it.
- **Where it's used**: added by `AddBrokerMessaging` inside the `else` branch of the
  `IsInboxEnabled` check, immediately after the [`NoOpInboxStore`](#noopinboxstore) registration
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:802-809`, the
  `AddHostedService` call at line 795). Covered by `InboxDisabledWarningServiceTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Inbox/InboxDisabledWarningServiceTests.cs:11`),
  which is what makes a log-only class testable at all (`[Rubric §14, Testability]`).
- **Caveats / not-in-source**: because the whole registration sits inside `AddBrokerMessaging`, which
  returns early for the in-process provider (`DependencyInjection.cs:755-758`), a monolith host never
  sees this warning. That is correct (in-process dispatch does not redeliver) but it does mean the
  absence of the line is not by itself evidence that dedup is on.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

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
  When [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) opens a consume, the
  store stages one of these rows; when the consume closes successfully the row is committed. Because
  the table lives in the consumer's own database, the dedup respects the database-per-service boundary
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) and can be committed in the same transaction as a handler's own writes.
- **Walkthrough**: four `init`-only properties (`InboxMessage.cs:11-20`). `Id` (surrogate `Guid` PK
  defaulted to `Guid.NewGuid()`, `InboxMessage.cs:11`) is the EF key. `MessageId` (`required`,
  `InboxMessage.cs:14`) is the event's own id, the **deduplication key**. `EventType` (`required`,
  `InboxMessage.cs:17`) is retained for diagnostics. `ProcessedOn` (`InboxMessage.cs:20`) is the UTC
  timestamp stamped at staging time. The shape only makes sense together with its EF configuration
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:570-584`):
  the table is `dbo.InboxMessages` (`ApplicationDbContext.cs:573`), `EventType` is capped at 500
  non-Unicode characters (`ApplicationDbContext.cs:575`), `MessageId` carries a **unique** index named
  `IX_InboxMessages_MessageId` (`ApplicationDbContext.cs:576-578`), and `ProcessedOn` carries a
  second, non-unique index `IX_InboxMessages_ProcessedOn` (`ApplicationDbContext.cs:582-583`) purely
  so the age-based retention purge has something to seek instead of scanning the table
  (`ApplicationDbContext.cs:580-581`, `[Rubric §12, Performance & Scalability]`).
- **Why it's built this way**: separating `Id` (the PK for EF internals) from `MessageId` (the
  business dedup key with the unique index) follows the surrogate-key convention used elsewhere in the
  codebase, and the unique index is what turns a racing duplicate delivery into a catchable
  `DbUpdateException` rather than a read-then-write race. Storing it as a plain entity lets the same EF
  stack purge it (see [`OutboxCleanupService`](#outboxcleanupservice)) and lets a handler's own
  `SaveChangesAsync` commit it.
  **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** governs the mechanism, and the row lives in the consumer's own database
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: staged, saved, and queried by [`EfInboxStore`](#efinboxstore)
  (`EfInboxStore.cs:55,120`); purged by [`OutboxCleanupService`](#outboxcleanupservice) when the inbox
  is enabled (`OutboxCleanupService.cs:179-194`, gated on `_inboxEnabled` at
  `OutboxCleanupService.cs:58` and called at `OutboxCleanupService.cs:124-127`); configured on every
  relational context by `ApplicationDbContext.ConfigureInbox` (`ApplicationDbContext.cs:570`, called
  from line 347) (G07).
- **Caveats / not-in-source**: the type itself has **no** first-party reference (it is a plain POCO),
  so the links to `IInboxStore`/`IDomainEvent` above are conceptual, not compile dependencies. The
  configuration is skipped by the Cosmos context, which overrides `OnModelCreating`
  (`ApplicationDbContext.cs:566-568`). There is also no tenant column: a tenant with its own database
  gets its own `InboxMessages` table instead (see [`OutboxCleanupService`](#outboxcleanupservice)).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxDisabledNoticeService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxDisabledNoticeService.cs:22` · Level 0 · class (internal sealed partial, `IHostedService`)

- **What it is**: a hosted service whose entire job is to write one Information log line at startup
  when the host is running **without** the transactional outbox, so the changed delivery guarantee is
  stated out loud rather than inferred from an absent background service.
- **Depends on**: `ILogger<OutboxDisabledNoticeService>` via primary constructor
  (`OutboxDisabledNoticeService.cs:22`) and `IHostedService` (line 22); nothing else first-party.
- **Concept introduced, announcing a posture instead of leaving it to be discovered.**
  `[Rubric §13, Observability & Operability]` assesses whether an operator can tell what mode a host
  is in without reading its source, and `[Rubric §33, Developer Experience]` assesses whether the
  framework's defaults explain themselves. Outbox registration is a **transport** decision, not a
  persistence one: `MessageBusSettings.IsOutboxEnabled` resolves to `false` for the in-process
  provider unless `MessageBus:EnableOutbox` says otherwise
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:159`), and in
  that mode neither [`OutboxProcessor`](#outboxprocessor) nor
  [`OutboxCleanupService`](#outboxcleanupservice) is registered
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:204-212`). The delivery
  guarantee changes with it: events reach their handlers synchronously inside the raising process, and
  a crash between the commit and the dispatch loses them. The class doc states that this is the right
  trade for a single-process application and the wrong one to discover from an absent hosted service
  (`OutboxDisabledNoticeService.cs:7-14`).
- **Walkthrough**: `StartAsync` calls the single generated log method and returns
  `Task.CompletedTask` (`OutboxDisabledNoticeService.cs:26-30`); `StopAsync` is a no-op (line 32). The
  message itself is the type's real content (`OutboxDisabledNoticeService.cs:35-38`): it names what
  is not happening (no `OutboxMessages` rows, neither background service running, a failed handler is
  not retried, a crash between commit and dispatch loses the event), names the fix
  (`MessageBus:EnableOutbox=true`), and closes the obvious follow-up question by noting that the
  `OutboxMessages` table is already part of the model, so flipping the flag is never a migration.
- **Why it's built this way**: the level choice is the interesting part and the doc argues it
  explicitly (`OutboxDisabledNoticeService.cs:15-19`). This is Information, not the Warning that the
  inbox's [`InboxDisabledWarningService`](#inboxdisabledwarningservice) uses, because a missing outbox
  is the **default** posture of an in-process host rather than an opt-out of a safety feature, and a
  warning on every small application's startup would train operators to ignore the category.
- **Where it's used**: registered by `AddInfrastructure` in the `else` branch of the outbox gate
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:209-212`), so a host
  either gets the two outbox background services or gets this notice, never both and never neither.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

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
  the [`OutboxProcessor`](#outboxprocessor) to route it through the message bus rather than the
  in-process dispatcher. The interface is empty
  (`public interface IIntegrationEvent : IDomainEvent;`, `IIntegrationEvent.cs:15`): membership itself
  is the marker.
- **Why it's built this way**: making integration events a *subtype* of domain events means one outbox
  mechanism serves both, and the routing decision is a single `is IIntegrationEvent` pattern match in
  the processor
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:592`),
  with no parallel capture pipeline to keep in step.
- **Where it's used**: implemented by integration events across modules and by
  [`BaseIntegrationEvent`](#baseintegrationevent), which adds the `SchemaVersion` convention; routed
  by the [`OutboxProcessor`](#outboxprocessor) to [`IMessageBus`](#imessagebus)
  (`OutboxProcessor.cs:592`); published by [`InProcessEventBus`](#inprocesseventbus) and
  [`BrokerEventBus`](#brokereventbus); consumed via
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent), whose type parameter is
  constrained to `class, IIntegrationEvent` (`IntegrationEventConsumer.cs:31`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### NoOpInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/NoOpInboxStore.cs:7` · Level 1 · class (internal sealed)

- **What it is**: the [`IInboxStore`](#iinboxstore) used when a broker host explicitly disables the
  inbox. It never dedups and records nothing, so consumer behavior is exactly what it would be with no
  inbox at all.
- **Depends on**: [`IInboxStore`](#iinboxstore) (the port it implements); BCL `Task`/`Guid` only.
- **Concept reinforced, the Null Object pattern.** `[Rubric §2, Design Patterns]` (assesses idiomatic
  use of patterns) and `[Rubric §17, DevOps & Deployment]`. `AlreadyProcessedAsync` always returns
  `Task.FromResult(false)` (`NoOpInboxStore.cs:9-10`) and `MarkProcessedAsync` returns
  `Task.CompletedTask` (`NoOpInboxStore.cs:12-13`). The consumer pipeline is written against
  [`IInboxStore`](#iinboxstore) and runs identically whether or not dedup is enabled: the Null Object
  removes a runtime `if (inbox enabled)` branch from every consumer.
- **Walkthrough**: the class implements only the two abstract members, so the three protocol members
  come from the interface defaults and compose into exactly the right no-op behavior.
  `TryBeginAsync` inherits `!await AlreadyProcessedAsync(...)` (`IInboxStore.cs:38-39`), which is
  always `true`, so handlers always run; `CompleteAsync` inherits the forward to `MarkProcessedAsync`
  (`IInboxStore.cs:48-49`), which writes nothing; `Abandon` inherits `true` (`IInboxStore.cs:63`),
  meaning "nothing was committed, a redelivery will reprocess". Nothing about the staging protocol
  had to be restated here, which is the payoff of putting the defaults on the port.
- **Why it's built this way**: the inbox resolves ON for a broker transport
  (`MessageBusSettings.IsInboxEnabled`, `MessageBusSettings.cs:125`), so this store is the deliberate
  opt-out path for a host that cannot query the `InboxMessages` table yet, not a quiet default. Note
  that it is registered as a **singleton** while [`EfInboxStore`](#efinboxstore) is scoped
  (`DependencyInjection.cs:800,804`): a stateless no-op needs no per-request lifetime, an EF-backed
  store that stages rows in the scope's unit of work does. The same `else` branch also registers
  [`InboxDisabledWarningService`](#inboxdisabledwarningservice) (`DependencyInjection.cs:809`), so
  choosing the Null Object is never silent (**[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)**).
- **Where it's used**: registered as `IInboxStore` inside `AddBrokerMessaging` on the
  `else` branch of `settings.IsInboxEnabled`, that is when `MessageBus:EnableInbox=false` is set
  explicitly (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:798-809`);
  consumed by [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:10` · Level 2 · class (public sealed)

- **What it is**: the `Outbox` configuration section, tuning the outbox background processor and its
  cleanup companion. Every property carries a default (`OutboxSettings.cs:17-108`), so the section is
  optional and a host with no `Outbox` configuration still runs a working outbox. Note the division of
  labour with [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings): that
  class decides WHETHER the outbox runs, this one decides HOW.
- **Depends on**: [`DataSource`](group-07-persistence-ef-core.md#datasource) (the engine enum) and
  [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey) (for its `DefaultName` constant),
  both imported through `MMCA.Common.Application.Interfaces.Infrastructure` (`OutboxSettings.cs:48`,
  `:57`). Externals: `System.ComponentModel.DataAnnotations` for the `[Range]` attributes.
- **Concept introduced, options binding with a static `SectionName`.** Note the convention that runs
  through every settings class in the framework: `public static readonly string SectionName = "Outbox";`
  (`OutboxSettings.cs:13`) is the single source of truth for the section name, referenced at the bind
  call instead of duplicating the literal (`DependencyInjection.cs:141`). The properties are
  `init`-only, so once materialized from configuration they are immutable for the process lifetime.

  `[Rubric §6, CQRS & Event-Driven]` assesses how reliably state changes turn into dispatched events.
  This is the knob set for the at-least-once outbox
  (**[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)**): `MaxRetries`
  (`:21`) caps attempts, and `ProcessingDelaySeconds` (`:40`) bounds the duplicate-dispatch window.
  The in-process path (save aggregate and outbox row, dispatch, mark processed) must complete inside
  that delay or the processor may re-dispatch the same event, which is why handlers must be idempotent
  regardless (`:33-38`).

  `[Rubric §29, Resilience & Business Continuity]` assesses behavior under replication and repeated
  failure. Three properties carry the weight. `LeaseSeconds` (`:82`) claims a batch for a replica so
  concurrent replicas never double-dispatch, and expires so a dead replica's rows become claimable
  again (`:75-81`, applied at `OutboxProcessor.cs:464`). `RetryBackoffBaseSeconds` (`:99`) makes the
  retry cadence explicit: attempt `n` waits `base * 2^(n-1)`, multiplied by a jitter factor in
  [0.8, 1.2] so rows that failed together do not retry in lockstep, then capped at `LeaseSeconds`
  (`:84-89`, implemented at `OutboxProcessor.cs:740-747`). The remark is worth reading as a design
  lesson: before this setting existed the claim was simply never cleared on failure, so the real retry
  cadence was an accident of the lease (300s) rather than a decision (`:90-97`).

  `[Rubric §31, Cost & FinOps]` assesses cost-relevant defaults. `PollingIntervalSeconds` (`:31`) is a
  fallback, not a hot loop (`:23-29`): with signal-based wakeup the processor wakes immediately on new
  entries and otherwise smart-waits until the earliest pending message becomes eligible, so deployed
  environments set it high (300 in this workspace) to cut idle SQL polling without adding latency for
  real traffic.

  `[Rubric §8, Data Architecture]` assesses how deliberately data is routed. The
  `DataSource` / `DatabaseName` pair (`:48`, `:57`) names where integration events published via
  [`IEventBus`](#ieventbus) are written, defaulting to the top-level connection strings so
  single-database behavior is preserved. It is a per-write target, not a global switch: the doc is
  explicit that the PROCESSOR still drains the outbox table of every relational physical source in use
  (`:53-56`, and see `OutboxProcessor.cs:187-189`).
- **Walkthrough**: one static field then eleven `init` properties, nine of them `[Range]`-validated.
  - `SectionName` (`OutboxSettings.cs:13`): static readonly `"Outbox"`, the bind key.
  - `BatchSize` (`:16-17`): `[Range(1, 1000)]`, default `50`; messages per cycle, used both to size the
    fetch (`OutboxProcessor.cs:428`) and to decide whether more eligible work remains
    (`OutboxProcessor.cs:341`, `:361`).
  - `MaxRetries` (`:20-21`): `[Range(1, 20)]`, default `5`; attempts before a message is treated as
    dead-lettered and excluded from the poll (`OutboxProcessor.cs:371`, `:424`, `:669`). The first
    failure is only re-scheduled when `MaxRetries > 1`, so `1` is honored as "the host asked for no
    retries at all" (`OutboxProcessor.cs:709`).
  - `PollingIntervalSeconds` (`:30-31`): `[Range(1, 3600)]`, default `2`; the fallback interval.
  - `ProcessingDelaySeconds` (`:39-40`): `[Range(0, 600)]`, default `5`; the eligibility delay, applied
    as a cutoff on the message timestamp (`OutboxProcessor.cs:144`, `:275`).
  - `DataSource` (`:48`): default `DataSource.SQLServer`; must be a relational provider (SQL Server or
    SQLite), since the outbox is a table.
  - `DatabaseName` (`:57`): default `DataSourceKey.DefaultName`; the logical source name paired with
    `DataSource`.
  - `RetentionDays` (`:64-65`): `[Range(0, 3650)]`, default `7`; days a PROCESSED message is kept
    before purge, with `0` disabling purging entirely (`OutboxCleanupService.cs:64`, cutoff at `:94`).
  - `CleanupIntervalHours` (`:72-73`): `[Range(1, 168)]`, default `6`; the purge sweep cadence, ignored
    when `RetentionDays` is `0` (`OutboxCleanupService.cs:70`).
  - `LeaseSeconds` (`:81-82`): `[Range(10, 3600)]`, default `300`; the batch claim window.
  - `RetryBackoffBaseSeconds` (`:98-99`): `[Range(1, 3600)]`, default `10`; the exponential-backoff
    base described above.
  - `DeadLetterRetentionDays` (`:107-108`): `[Range(0, 3650)]`, default `0`, which falls back to
    `RetentionDays`. Set it higher to keep exhausted payloads around for diagnosis and manual replay;
    the cleanup service resolves the fallback explicitly before computing its cutoff
    (`OutboxCleanupService.cs:160-162`).
- **Why it's built this way**: the defaults encode the framework's out-of-the-box posture
  (**[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)** outbox,
  **[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)**
  database-per-service): a host with no `Outbox` section that has the outbox switched on gets a working
  at-least-once processor writing to its single default database, while a multi-service deployment
  overrides `PollingIntervalSeconds`, `DataSource` and `DatabaseName` to tune cost and routing. The
  `[Range]` guards give fail-fast validation at bind time rather than a bad value surfacing mid-cycle
  (**[ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)**).
- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in `AddInfrastructure`
  (`DependencyInjection.cs:140-143`). Consumed by [`OutboxProcessor`](#outboxprocessor)
  (`OutboxProcessor.cs:59`, `:66`) and [`OutboxCleanupService`](#outboxcleanupservice)
  (`OutboxCleanupService.cs:50`, `:57`) for batching, retry pacing and retention; by both event buses
  to pick the write target when publishing an integration event
  ([`InProcessEventBus`](#inprocesseventbus) `InProcessEventBus.cs:37`, `:78`;
  [`BrokerEventBus`](#brokereventbus) `BrokerEventBus.cs:35`, `:67`); and by
  [`EfInboxStore`](#efinboxstore), which deliberately reuses the same `DataSource`/`DatabaseName` pair
  so the inbox lands in the consumer's own database (`EfInboxStore.cs:41`, `:162`).
- **Caveats**: `BrokerEventBus` throws when the resolved target does not support the outbox table,
  naming both configuration keys in the message (`BrokerEventBus.cs:76`), so an outbox pointed at
  Cosmos fails on first publish rather than at bind time; the `[Range]` attributes cannot express
  "relational engines only".

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### EfInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:38` · Level 13 · class (public sealed partial)

- **What it is**: the EF-backed inbox. It records processed message ids in the consumer's own database
  so a redelivered broker message is skipped, and it stages that record inside the handlers' own unit
  of work so the record and the handlers' writes commit together.
- **Depends on**: [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>` (to find the
  publish-target source) and `ILogger<EfInboxStore>`, all via primary constructor
  (`EfInboxStore.cs:38-42`); the [`InboxMessage`](#inboxmessage) entity; resolves an
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext); EF Core's
  `EntityEntry<T>` and `EntityState` for the staging bookkeeping.
- **Concept introduced, staging the dedup row into the handler's transaction.**
  `[Rubric §6, CQRS & Event-Driven]` (idempotent consumers), `[Rubric §8, Data Architecture]`
  (transaction boundaries) and `[Rubric §29, Resilience]`. The naive inbox writes its row *after* the
  handlers commit, which leaves a window: crash in between and the whole event is reprocessed. This
  store closes that window by construction (`EfInboxStore.cs:16-22`): the row is added to the same
  scoped [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) the handlers
  write through, so the first handler's own `SaveChangesAsync` commits the inbox row in its
  transaction. `CompleteAsync` then writes the row afterwards only when nothing else did, which is the
  case for an event whose handlers write nothing. The class comment is careful about the limit
  (`EfInboxStore.cs:23-29`): atomicity holds only when the handler writes to the **same physical
  source** this store resolves (the `Outbox:DataSource`/`Outbox:DatabaseName` pair, which is the single
  database of a monolith or of a service that owns one). A handler writing to a different physical
  source is back to two transactions, and delivery is then at-least-once again, which is the contract
  handlers are written against anyway.
- **Walkthrough**
  - `_staged` (`EfInboxStore.cs:49`) is a plain `Dictionary<Guid, EntityEntry<InboxMessage>>` of rows
    opened but not yet closed out. The comment justifies the non-concurrent collection
    (`EfInboxStore.cs:44-48`): the store is scoped per consumed message, so it holds one entry in
    practice and is never touched from two threads.
  - `AlreadyProcessedAsync` (`EfInboxStore.cs:52-58`) resolves the context and issues a single
    `AnyAsync` for an [`InboxMessage`](#inboxmessage) with the given `MessageId`
    (`EfInboxStore.cs:55-57`), which the unique index turns into an index seek.
  - `TryBeginAsync` (`EfInboxStore.cs:61-68`) short-circuits to `false` when the message was already
    processed (lines 63-64), otherwise stages a row into `_staged` and returns `true` (lines 66-67).
  - `Stage` (`EfInboxStore.cs:116-127`) resolves the context and `Add`s a new
    [`InboxMessage`](#inboxmessage) stamped `DateTime.UtcNow` (lines 120-125), with a scoped
    `VSTHRD103` suppression noting that EF's `DbSet.Add` is intentionally synchronous because it is an
    in-memory operation (lines 119 and 126). Note it returns the `EntityEntry`, which is the handle the
    rest of the class reads state from.
  - `CompleteAsync` (`EfInboxStore.cs:71-89`) removes the staged entry and inspects its state
    (lines 73-78). `Added` still means no handler saved, so the row is persisted now (line 80);
    anything else means a handler's own `SaveChangesAsync` already committed it atomically with its
    mutations, which is the whole point of staging, so there is nothing left to write (lines 75-77).
    When there is no staged entry at all (a caller that skipped `TryBeginAsync`, or a second
    `CompleteAsync`), it falls back to the stage-then-save path so the message is still recorded
    (lines 86-88).
  - `Abandon` (`EfInboxStore.cs:92-110`) is the failure branch. No staged row means nothing to undo,
    return `true` (lines 94-95). A staged entry whose state is no longer `Added` means a handler
    committed the row before a later handler failed: the store logs a Warning and returns `false`
    (lines 97-103), and the comment says plainly that the redelivery will be skipped as a duplicate so
    the handlers that had not run yet never will, which is the one case where this design loses work a
    pure after-the-fact inbox would have retried. Otherwise the entry is **detached** rather than left
    `Added` (line 108), because the context is cached for the whole scope and a surviving `Added` row
    would be re-attempted by any later save on that scope (lines 106-107).
  - `MarkProcessedAsync` (`EfInboxStore.cs:113-114`) is now a thin stage-and-save, kept because it is
    the abstract member of the port.
  - `SaveStagedAsync` (`EfInboxStore.cs:129-158`) saves and then handles the race. Its
    `catch (DbUpdateException)` (line 140) does three things in order. First it **detaches the rejected
    entry** (line 146), for the same scope-caching reason, and the comment names the identical idiom in
    [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
    (lines 142-145). Second it **re-queries** through `AlreadyProcessedAsync` and rethrows when the row
    is still absent (lines 153-154): only a concurrent duplicate delivery tripping the unique index is
    safe to absorb, and the comment is explicit that re-querying beats sniffing provider-specific error
    codes because the check must hold for SQL Server and SQLite alike, and that swallowing any other
    write failure would ack a message whose inbox row was never written (lines 148-152). Third, and
    only then, it logs the absorbed duplicate at Debug (line 156, source-generated at lines 166-167).
  - `ResolveContext` (`EfInboxStore.cs:160-164`) routes to the configured outbox data source by
    resolving `OutboxSettings.DataSource`/`DatabaseName` through
    [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) (line 162) and asking
    the factory for that context (line 163), so the inbox lands in the same database as the outbox.
- **Why it's built this way**: dedup by `MessageId` (the [`IDomainEvent`](#idomainevent) member
  introduced at Level 0) makes redelivery safe without distributed locks, and storing the row in the
  consumer's *own* database keeps it within the database-per-service boundary ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) while
  making the same-transaction commit possible at all. Relying on the unique index and confirming the
  violation by re-query avoids a read-then-write race between concurrent deliveries without hiding a
  genuine write failure: a handler's own save surfaces the `DbUpdateException` so its mutations roll
  back and the broker redelivers into the skip path (`EfInboxStore.cs:30-36`).
  **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** is the governing decision, including its 2026-08-26 revision, which is what
  made the inbox the resolved default for a broker transport and moved the row into the handler's unit
  of work.
- **Where it's used**: registered as the scoped `IInboxStore` whenever
  `MessageBusSettings.IsInboxEnabled` resolves true, which for a broker transport is the default
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:798-800`); driven by
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) around handler invocation
  (`IntegrationEventConsumer.cs:54,74,95`); its rows are purged by
  [`OutboxCleanupService`](#outboxcleanupservice) (`OutboxCleanupService.cs:179-194`). Exercised
  directly by `EfInboxStoreTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Inbox/EfInboxStoreTests.cs:27`).
- **Caveats / not-in-source**: the inbox key is the event's `[EventName]` identity when it declares
  one and its short type name otherwise, resolved by the caller, not by this store
  ([`EventNameResolver`](#eventnameresolver), called at `IntegrationEventConsumer.cs:43`). Whether a
  given handler's `SaveChangesAsync` actually lands on the same physical source as the resolved outbox
  data source is a per-host configuration question that is not determinable from this file alone.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxAdministration
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxAdministration.cs:36` · Level 13 · class (public sealed partial)

- **What it is**: the EF-backed operator surface over the outbox tables this host owns. It lists dead
  letters, replays them back into the pending pool, and counts the pending backlog, over exactly the
  same targets the [`OutboxProcessor`](#outboxprocessor) drains and the
  [`OutboxCleanupService`](#outboxcleanupservice) sweeps.
- **Depends on**: `IServiceScopeFactory`, `ILogger<OutboxAdministration>`,
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`,
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  [`IOutboxSignal`](#ioutboxsignal) and an optional
  `IOptions<`[`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings)`>`, all via
  primary constructor (`OutboxAdministration.cs:36-43`); implements
  [`IOutboxAdministration`](group-07-persistence-ef-core.md#ioutboxadministration) and projects
  [`OutboxDeadLetter`](group-07-persistence-ef-core.md#outboxdeadletter); resolves an
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) and, for a tenant target, an
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) per visited target; returns
  [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error).
- **Concept introduced, a supported way BACK into delivery for an abandoned event.**
  `[Rubric §13, Observability & Operability]` assesses whether operators have first-class tooling for
  the failure modes a system actually has, and `[Rubric §29, Resilience & Business Continuity]`
  assesses recovery, not just detection. The interface doc states the gap it closes: without it the
  only terminal states for an undelivered event are "eventually deleted by the retention sweep" and
  "edited by hand in production SQL"
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IOutboxAdministration.cs:5-14`).
  Every method returns a `Result`, because an unknown or unreachable source is an expected failure an
  operator screen renders, not an exception. Note also what
  [`OutboxDeadLetter`](group-07-persistence-ef-core.md#outboxdeadletter) does **not** carry: the event
  payload is deliberately not projected, because it can contain personal data
  ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)) and nothing an
  operator decides about a replay depends on reading it (`IOutboxAdministration.cs:68-72`), a
  `[Rubric §30, Compliance, Privacy & Data Governance]` choice.
- **Walkthrough**
  - **Guards and paging.** `MaxPageSize` is 500 (`OutboxAdministration.cs:46`), so an admin call cannot
    ask for the whole table at once, and the two validation errors are preallocated `Error.Validation`
    values (lines 47-51).
  - `ListDeadLettersAsync` (`OutboxAdministration.cs:57-113`) validates `skip` and `take` (lines 62-66),
    resolves its targets and fails with a `NotFound`-shaped error when a named source is not owned by
    this host (lines 68-70, 197-200), then queries each target for unprocessed rows whose `RetryCount`
    has reached `MaxRetries`, ordered by `OccurredOn` then `Id`, projected straight into
    `OutboxDeadLetter` under `AsNoTracking` (lines 86-100). Two details are commented in place: the
    source name is materialized *outside* the query because inside the projection it would be a method
    call EF has to translate (lines 77-79), and each target returns at most `skip + take` rows because
    **paging is applied across the merged result**, so "skip 50" means the same thing whether the host
    owns one database or four (lines 81-83, merged at lines 106-109).
  - `ReplayDeadLettersAsync` (`OutboxAdministration.cs:116-172`) is expressed as one set-based
    `ExecuteUpdateAsync` per target rather than as loaded entities, because an operator replaying a
    backlog is replaying thousands of rows and none of the values written depend on the row's current
    state (class doc, lines 21-25). The update resets `RetryCount` to zero, which is what returns the
    row to the poll's predicate, and clears `LockedUntil` and `LockToken` so it is claimable on the very
    next cycle instead of after `LeaseSeconds` (lines 146-151). `LastError` survives on purpose: the
    comment calls it the record of *why* this row needed replaying, and a replay that erased it would
    destroy the only evidence (lines 142-145). An optional id filter narrows the scope (lines 137-140),
    each non-empty target logs at Warning (lines 155-158, `LogReplayed` at 247-248), and when anything
    was replayed it calls [`IOutboxSignal.Signal()`](#ioutboxsignal) rather than leaving the work to a
    polling interval deployed environments set as high as 300 seconds (lines 163-168).
  - `CountPendingAsync` (`OutboxAdministration.cs:175-196`) sums `LongCountAsync` over unprocessed rows
    with `RetryCount < MaxRetries` across every selected target. Its interface doc draws the line
    against the gauge (`IOutboxAdministration.cs:56-61`): this counts the tables at the moment of the
    call and **includes** rows currently under a claim lease, where `outbox.pending.depth` reports what
    the processor last observed.
  - **Target selection and scoping.** `SelectTargets` (`OutboxAdministration.cs:208-223`) builds the
    same set the two background services use (every relational physical source in use, minus Cosmos,
    plus the configured publish target), expands it per tenant through
    [`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets), and optionally
    filters to one name case-insensitively. It is recomputed per call for the same reason the processor
    recomputes it per cycle: module assemblies can register entities after startup (lines 202-206).
    `VisitAsync<T>` (lines 229-245) runs the work for one target in its **own** DI scope and sets the
    tenant *before* asking for the context, because the tenant is what routes the scoped factory to that
    tenant's database and is also what the query filter reads (lines 224-228, 238-241).
- **Why it's built this way**: reusing the processor's exact target expansion means an operator screen
  can never show a different set of databases than the one being drained, including per-tenant copies
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). Replay is intentionally
  *not* a delete-and-reinsert: `OccurredOn` is untouched, so a replayed row keeps its place in its
  ordering key (`IOutboxAdministration.cs:36-41`), which is what makes replay safe for events that
  declare an [`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey).
- **Where it's used**: registered scoped as
  [`IOutboxAdministration`](group-07-persistence-ef-core.md#ioutboxadministration) by
  `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:200-203`), with the
  comment explaining the lifetime: scoped, because it creates one child scope per data source it visits
  and holds no state of its own. The framework ships no endpoint for it; a host exposes it from an admin
  endpoint, a support command or a scheduled job (`IOutboxAdministration.cs:10-14`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxCleanupService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxCleanupService.cs:47` · Level 13 · class (public sealed partial, `BackgroundService`)

- **What it is**: the periodic sweeper that purges spent outbox rows (both **processed** rows and
  **dead-lettered** rows whose retries are exhausted) and, when the inbox is enabled, inbox rows, past
  their retention windows, from every relational target the host owns, including each tenant database
  that keeps its own copy of a source.
- **Depends on**: `IServiceScopeFactory`, `ILogger<OutboxCleanupService>`,
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`,
  `IOptions<`[`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)`>`,
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), an optional
  `TimeProvider` and an optional
  `IOptions<`[`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings)`>`
  (`OutboxCleanupService.cs:47-55`); resolves an
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) and, for a tenant target, an
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) per sweep; expands its work list through
  [`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets) into
  [`TenantDataSourceTarget`](group-07-persistence-ef-core.md#tenantdatasourcetarget) values; operates on
  the [`OutboxMessage`](#outboxmessage) and [`InboxMessage`](#inboxmessage) entities.
- **Concept introduced, retention as a privacy and storage control (plus a clock injection point).**
  `[Rubric §30, Compliance, Privacy & Data Governance]` assesses bounded retention of data that may
  contain PII, `[Rubric §8, Data Architecture]` assesses lifecycle management of operational tables,
  `[Rubric §31, Cost Efficiency]` assesses storage growth, and `[Rubric §14, Testability]` assesses
  whether time-driven code can be tested. The [`OutboxProcessor`](#outboxprocessor) only ever *sets*
  `ProcessedOn`, and a message that exhausts `MaxRetries` keeps `ProcessedOn` null forever, so without
  this sweep the outbox, which stores serialized event payloads that may contain personal data, grows
  without bound and dead rows linger in the pending index every poll re-scans
  (`OutboxCleanupService.cs:18-33`, citing ADR-003 and ADR-005). The constructor takes an optional
  `TimeProvider? timeProvider = null` (line 52) defaulting to `TimeProvider.System` (line 57), so a
  test can drive the hour-scale sweep loop deterministically instead of waiting real hours (doc, lines
  39-40).
- **Walkthrough**
  - `ExecuteAsync` (`OutboxCleanupService.cs:62-90`) returns immediately when `RetentionDays <= 0`
    (lines 62-66), the documented off switch. It computes the interval from `CleanupIntervalHours`
    (line 68, default 6, `OutboxSettings.cs:73`) and then loops, deliberately awaiting
    `Task.Delay(interval, _timeProvider, stoppingToken)` **before** each `PurgeAsync` (lines 76-77) so
    cleanup never competes with startup or migration work (comment, lines 70-71). Shutdown breaks the
    loop cleanly (lines 79-82); any other exception is logged and the loop continues (lines 83-86).
  - `PurgeAsync` (`OutboxCleanupService.cs:92-140`) computes the cutoff from
    `_timeProvider.GetUtcNow().UtcDateTime` minus `RetentionDays` (line 92, default 7,
    `OutboxSettings.cs:65`), then walks `GetRelationalTargets()` (line 94). For a tenant target it sets
    the tenant on the scope **before** asking for the context (lines 103-106), because the tenant is
    what routes the scoped factory to that tenant's database. It then deletes processed rows older than
    the cutoff with `ExecuteDeleteAsync`, a set-based SQL `DELETE` with no entity materialization
    (lines 111-114), logging at Information when anything went (lines 116-119).
  - **The dead-letter sweep** (`SweepDeadLettersAsync`, `OutboxCleanupService.cs:155-177`) is the
    second, separate pass, and its doc is worth reading in full (lines 140-151): dead-lettered rows keep
    `ProcessedOn` null forever, so the processor's poll excludes them (`RetryCount < MaxRetries`) but the
    processed sweep never reaches them either, and they accumulate *inside* the pending index. They are
    purged on their own window, `DeadLetterRetentionDays` falling back to `RetentionDays` when it is 0
    (lines 158-160, and 0 is the default, `OutboxSettings.cs:108`), keyed on `OccurredOn` since they
    have no `ProcessedOn` (lines 164-167). This permanently abandons an undelivered event, which is why
    the deletion logs at **Warning** (line 173, `LogDeadLetterPurged` at 226-227) while the processed
    purge logs at Information (`LogPurged` at 223-224), and why the doc points at
    [`OutboxAdministration`](#outboxadministration) as the thing to use before the window closes.
  - Inbox rows are purged only when the inbox is enabled (lines 123-126, the flag captured once at
    construction from `MessageBusSettings.IsInboxEnabled`, line 56), delegating to `PurgeInboxAsync`
    (lines 177-192), which deletes [`InboxMessage`](#inboxmessage) rows with `ProcessedOn < cutoff`.
  - A single unreachable database does not stop the others: the per-target `catch` logs and moves on
    (lines 132-136), while a real cancellation is rethrown (lines 128-131). `GetRelationalSources`
    (lines 199-210) computes the same source set the processor drains, and `GetRelationalTargets`
    (lines 217-218) expands it into one target per source against the shared database plus one extra per
    tenant that keeps its own copy, which is the only reason a per-tenant database's outbox and inbox
    tables ever get swept ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html);
    doc, lines 212-216).
- **Why it's built this way**: bounded retention keeps both storage cost and PII exposure in check;
  doing it as a `DELETE` rather than load-then-remove is the efficient path; and per-target error
  isolation keeps one bad database from blocking the sweep.
  [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html) has the inbox reuse
  this same sweep, gated on the inbox flag, rather than adding a second housekeeping service.
- **Where it's used**: registered as a hosted service alongside the
  [`OutboxProcessor`](#outboxprocessor), inside the same `IsOutboxEnabled` gate
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:204-208`), so a host with
  the outbox disabled runs neither and gets
  [`OutboxDisabledNoticeService`](#outboxdisablednoticeservice) instead.
- **Caveats / not-in-source**: the inbox purge uses the *outbox* `RetentionDays` cutoff
  (`OutboxCleanupService.cs:127`), not a separate inbox window, so shortening outbox retention shortens
  the dedup memory with it.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### IOutboxSignal
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/IOutboxSignal.cs:8` · Level 0 · interface

- **What it is**: a wake-up signal between the producer (the code that has just committed outbox rows)
  and the [`OutboxProcessor`](#outboxprocessor) background service, so the processor wakes the instant
  new rows exist instead of sleeping out a fixed polling interval.
- **Depends on**: nothing first-party (BCL `TimeSpan`/`Task`/`CancellationToken`). Implemented by
  [`OutboxSignal`](#outboxsignal), a `SemaphoreSlim` wrapper.
- **Concept introduced, event-driven wake versus fixed polling.** `[Rubric §12, Performance &
  Scalability]` assesses whether latency is bounded by design rather than by a timer, and
  `[Rubric §31, Cost Efficiency / FinOps]` assesses idle resource burn. Without a signal the processor
  would poll on a fixed schedule, and the framework deliberately lets deployed environments set that
  fallback high to cut idle database chatter (the default is 2 seconds,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:31`, with the doc on
  lines 23-29 explicitly recommending 300 for a deployed host). The signal is what makes that safe:
  the producer calls `Signal()` right after committing outbox entries, and the processor, parked on
  `WaitAsync(timeout, ct)`, returns at once. Dispatch latency collapses from "up to the polling
  interval" to near zero in the common case, while the timeout stays as a safety net.
- **Walkthrough**: `Signal()` (`IOutboxSignal.cs:11`) is synchronous and unblocks any waiter, so it is
  safe to call from the same thread that just finished `SaveChangesAsync`.
  `WaitAsync(TimeSpan timeout, CancellationToken cancellationToken)` (`IOutboxSignal.cs:20`) is what
  the processor loop awaits at the bottom of every cycle, returning when either signalled or the
  timeout elapses; the doc names it as the replacement for polling delays
  (`IOutboxSignal.cs:13-19`).
- **Why it's built this way**: keeping the wake-up an interface lets a test inject a controllable
  signal and drive the processor deterministically without real timers, a `[Rubric §14, Testability]`
  injection point, and it keeps the `SemaphoreSlim` detail (including its one-permit cap) out of every
  call site.
- **Where it's used**: registered as a singleton by `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:192`). `Signal()` is
  called by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  on all three of its paths
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:134,337,346`),
  by [`BrokerEventBus`](#brokereventbus) after writing its outbox batch
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:90`), and by
  [`OutboxAdministration`](#outboxadministration) after a replay
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxAdministration.cs:168`).
  `WaitAsync` is awaited by the [`OutboxProcessor`](#outboxprocessor) loop
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:146`),
  with the duration computed from [`OutboxCycleResult`](#outboxcycleresult).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxCycleResult
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxCycleResult.cs:19` · Level 0 · record struct (internal readonly)

- **What it is**: the outcome of one outbox polling cycle, used by the
  [`OutboxProcessor`](#outboxprocessor) to decide how long to wait before the next one.
- **Depends on**: nothing first-party (BCL `bool` and `DateTime?`). Consumed by the processor, which
  feeds the computed wait to [`IOutboxSignal.WaitAsync`](#ioutboxsignal).
- **Concept introduced, the smart-wait input.** `[Rubric §12, Performance & Scalability]`,
  `[Rubric §29, Resilience & Business Continuity]`, and `[Rubric §31, Cost Efficiency]`. Two members
  drive two distinct wait policies, and the XML doc spells both out (`OutboxCycleResult.cs:7-18`).
  `HasMoreEligibleWork` triggers an **immediate re-poll**: it is set only when a *full* batch of
  eligible messages was fetched **and** at least one of them made progress (dispatched or
  dead-lettered), so more eligible rows are probably waiting. The progress requirement is what stops a
  batch stuck in a permanent error from hot-spinning the loop. `EarliestPendingOccurredOn` enables
  **time-precise wake-up**: it carries the `OccurredOn` of the oldest row that is not yet eligible
  (younger than the processing delay), so the processor sleeps until exactly that moment instead of
  the full polling interval; `null` means nothing is pending and the full interval applies.
- **Walkthrough**: declared as a `readonly record struct` with two positional members on a single line
  (`OutboxCycleResult.cs:19`): `HasMoreEligibleWork` (`bool`) and `EarliestPendingOccurredOn`
  (`DateTime?`). The value-type, no-heap shape means the tight background loop allocates nothing per
  cycle, and `internal` keeps it out of the package's public API surface.
- **Why it's built this way**: a record struct is the cheapest way to return two related values from a
  loop that runs forever, and `internal` visibility keeps the outbox processing contract private to
  the Infrastructure layer where the only two participants live.
- **Where it's used**: returned by `OutboxProcessor.ProcessPendingMessagesAsync` after aggregating the
  per-target results
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:247`),
  produced per source by `ProcessSourceAsync` (`OutboxProcessor.cs:299,308,339-343`), and consumed by
  `ExecuteAsync` to either continue immediately (`OutboxProcessor.cs:132-136`) or wait for the
  duration `ComputeWaitTime` derives from it (`OutboxProcessor.cs:141-146`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxMetrics
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs:16` · Level 0 · class (internal static)

- **What it is**: the single OpenTelemetry `Meter` and the five instruments that describe the health
  of the outbox pipeline: dead letters, successful dispatches, end-to-end delivery lag, observed
  backlog depth, and the age of the oldest row still waiting.
- **Depends on**: nothing first-party; BCL `System.Diagnostics.Metrics` (`Meter`, `Counter<long>`,
  `Histogram<double>`, `ObservableGauge<long>`, `ObservableGauge<double>`, `Measurement<double>`),
  `Interlocked`, and `ConcurrentDictionary`. Emitted exclusively by
  [`OutboxProcessor`](#outboxprocessor).
- **Concept introduced, instrumenting an asynchronous pipeline no request trace can cover.**
  `[Rubric §13, Observability & Operability]` assesses whether operators can answer "is it healthy,
  and how far behind is it" without attaching a debugger, and `[Rubric §29, Resilience]` assesses
  whether degradation is visible before it becomes an outage. Everything the outbox does happens after
  the HTTP response has gone out, so no request trace ever covers it; these instruments are the
  substitute. A host exports them by registering the `MeterName` meter, and the Aspire service defaults
  (`ConfigureOpenTelemetry`) already do. The meter name is duplicated as a literal in
  MMCA.Common.Aspire because that package has no reference to Infrastructure
  (`OutboxMetrics.cs:6-11`), the same deliberate duplication used for the `OutboxPoll` activity name.
- **Walkthrough**
  - `MeterName` (`OutboxMetrics.cs:19`) is the constant `"MMCA.Common.Outbox"`, and the single static
    `Meter` is created from it (line 21). The class doc is explicit that one meter serves every outbox
    instrument and that a second `Meter` with this name must never be created (lines 12-14).
  - `DeadLetterCounter` (`outbox.dead_letter.count`, `OutboxMetrics.cs:41-44`) counts abandoned
    messages, tagged by `event_type` **and** by `reason`, which takes exactly two values,
    `type_unresolvable` or `retries_exhausted` (lines 37-40). That second tag is what lets an operator
    tell a deployment mistake (a renamed event type) apart from a genuine downstream outage.
  - `ProcessedCounter` (`outbox.processed.count`, `OutboxMetrics.cs:47-50`) counts messages dispatched
    successfully and stamped processed, tagged by `event_type`.
  - `DispatchLagHistogram` (`outbox.dispatch.lag`, unit seconds, `OutboxMetrics.cs:57-60`) records the
    interval between `OccurredOn` and `ProcessedOn`. The doc calls it the number that answers "how far
    behind is eventual consistency right now" (lines 52-56).
  - `PendingDepthGauge` (`outbox.pending.depth`, `OutboxMetrics.cs:75-79`) is an `ObservableGauge`
    reading the `_pendingDepth` field (line 27) through `Interlocked.Read`, published once per cycle by
    `SetPendingDepth` (line 108) via `Interlocked.Exchange`. Its `remarks` (lines 66-74) carry the
    operational caveat that matters most: the gauge reports what **this** instance last observed, not a
    cluster-wide depth, so with several replicas each publishes its own view and the values must be
    read per instance and never summed into a fleet total. The count uses the same predicate as the
    poll (unprocessed, retries not exhausted, not under an unexpired lease), so rows another replica
    currently holds are excluded, and a source whose database is unreachable contributes zero for that
    cycle rather than holding a stale value.
  - `OldestPendingAgeGauge` (`outbox.oldest_pending.age`, unit seconds, `OutboxMetrics.cs:98-102`) is
    the alerting counterpart to the lag histogram, and the distinction in its doc is worth internalizing
    (lines 81-86): `outbox.dispatch.lag` reports how late the messages that *did* get delivered were,
    while this one reports how late the backlog already is **while it is still stuck**, which is the
    number an alert on a wedged outbox fires on. It is tagged per `data_source`, backed by the
    `OldestPendingAgeSeconds` dictionary (lines 34-35), published by `SetOldestPendingAge`
    (lines 115-116), and projected into one `Measurement<double>` per source by
    `ObserveOldestPendingAge` (lines 118-126). Its `remarks` (lines 87-97) note that it costs no extra
    query at all (the poll already fetches pending rows ordered by `OccurredOn`, so the first row *is*
    the minimum and no `MIN()` is ever issued), that it excludes leased and dead-lettered rows so it
    measures deliverable backlog rather than table age, and that a drained source reports `0` rather
    than dropping out of the series, so "drained" stays distinguishable from "host stopped".
- **Why it's built this way**: static instruments on one shared meter is the idiomatic
  `System.Diagnostics.Metrics` shape and costs nothing when no listener is attached. `Interlocked` on
  the depth field and a `ConcurrentDictionary` for the per-source ages keep the observation callbacks
  lock-free while the processor writes them from its own loop. Making the depth a *gauge fed by the
  cycle* rather than an independent query means the steady state pays no extra database round-trip:
  see `CountPendingAsync`, which derives the depth from the fetch itself unless the batch came back
  saturated (`OutboxProcessor.cs:354-375`).
- **Where it's used**: `DeadLetterCounter` on both dead-letter paths (`OutboxProcessor.cs:719-722` for
  an unresolvable type, `:672-675` for exhausted retries); `ProcessedCounter` and
  `DispatchLagHistogram` on the success path (`OutboxProcessor.cs:614,619-621`); `SetOldestPendingAge`
  per source right after its fetch (`OutboxProcessor.cs:283-285`); and `SetPendingDepth` once per
  cycle after every target has been drained (`OutboxProcessor.cs:245`).
- **Caveats / not-in-source**: the circuit-open signal the processor emits alongside these lives on a
  *different* meter,
  [`BrokerMetrics.CircuitOpenCounter`](group-14-module-system-composition.md#brokermetrics), not on
  `OutboxMetrics` (`OutboxProcessor.cs:658-660`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### EventNameResolver
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/EventNameResolver.cs:19` · Level 1 · class (internal static)

- **What it is**: the one cached lookup of the name an event is **stored** under, shared by the two
  places a stored identity is written: the outbox row and the inbox dedup key. It is also the reverse
  lookup that turns a stored name back into a CLR type.
- **Depends on**:
  [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) (G02); BCL
  `System.Reflection` and `ConcurrentDictionary`. Consumed by [`OutboxMessage`](#outboxmessage),
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) and
  [`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent).
- **Concept introduced, a serialization identity that outlives the CLR type name.**
  `[Rubric §9, API & Contract Design]` assesses whether a stored or on-the-wire contract can evolve
  without breaking what is already in flight, and `[Rubric §15, Best Practices & Code Quality]` assesses whether an
  ordinary refactoring (rename, namespace move, project split) is safe. The problem: an outbox row
  records the event's assembly-qualified CLR name, so renaming the class or moving it to another
  assembly orphans every row already written under the old name, and the processor eventually
  dead-letters them. `EventNameAttribute` declares a stable identity instead, and this resolver is the
  single place that decides which of the two a given event uses. Crucially, adoption is **opt-in and
  backward-compatible**: an event without the attribute keeps exactly the identity it had before this
  type existed, the assembly-qualified name in the outbox and the short type name in the inbox
  (`EventNameResolver.cs:7-18`), so rows already in flight are unaffected.
- **Walkthrough**
  - `DeclaredNameCache` (`EventNameResolver.cs:26`) is a `ConcurrentDictionary<Type, string?>`. Caching
    `null` matters as much as caching a hit: the common unannotated case then pays one reflection lookup
    per type per process rather than one per event instance (lines 21-25).
  - `GetDeclaredName(Type)` (`EventNameResolver.cs:35-38`) reads the attribute with
    `inherit: false`, so a derived event never silently borrows its base's identity (lines 28-32).
  - `GetStorageName(Type)` (`EventNameResolver.cs:47-51`) is the outbox side: the declared name when
    present, otherwise `AssemblyQualifiedName`, falling back to `FullName` then `Name` for the exotic
    types that have neither.
  - `GetInboxName(Type)` (`EventNameResolver.cs:59-60`) is the inbox side: the declared name when
    present, otherwise the **short** type name, which is what every existing inbox row already holds.
  - `FindTypeByDeclaredName(string)` (`EventNameResolver.cs:75-81`) is the reverse lookup for a stored
    name that is not a CLR name: it scans the loaded, non-dynamic assemblies for the type declaring
    that name. Two performance details are deliberate (lines 68-72): the LINQ query stays lazy so the
    scan stops at the first match instead of materializing every loaded type, and `Type.IsDefined` comes
    first in the predicate because it answers without constructing the attribute, so only the handful of
    annotated types pay for construction. It is reached at most once per stored name, because the caller
    caches the result.
  - `GetLoadableTypes(Assembly)` (`EventNameResolver.cs:90-100`) catches `ReflectionTypeLoadException`
    and degrades to `ex.Types.OfType<Type>()`, the subset that did load, so one unloadable type cannot
    stop a scan whose answer may live in a later assembly.
- **Why it's built this way**: putting the decision in one static class is what keeps the outbox and
  the inbox from drifting into two different notions of "the event's name", which would silently break
  dedup. The attribute is documented as a before-the-refactoring move
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/EventNameAttribute.cs:14-19`): it changes
  only what NEW rows store, so applying it while the outbox holds pending rows is a two-step operation,
  drain first, then rename.
- **Where it's used**: `GetStorageName` in `OutboxMessage.FromDomainEvent`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:107`);
  `FindTypeByDeclaredName` in `OutboxMessage.ResolveEventType` (`OutboxMessage.cs:153`);
  `GetInboxName` in
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:43`) and
  [`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:62`).
- **Caveats / not-in-source**: `FindTypeByDeclaredName` searches only **loaded** assemblies
  (`EventNameResolver.cs:76`), which is precisely why the processor treats the first unresolvable
  attempt as transient (see `HandleUnresolvableType` under [`OutboxProcessor`](#outboxprocessor)).
  Uniqueness of a declared name across a host's events is a documented requirement of the attribute
  (`EventNameAttribute.cs:20-24`), not something this resolver enforces.

### IDomainEventDispatcher
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Events` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IDomainEventDispatcher.cs:8` · Level 1 · interface

- **What it is**: the dispatch port for in-process domain-event delivery. A single method,
  `DispatchAsync(IEnumerable<IDomainEvent>, CancellationToken)` (`IDomainEventDispatcher.cs:16`), takes
  a batch of events and routes each to its registered handlers after an aggregate persists changes
  (doc comment, lines 5-7).
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0).
- **Concept introduced, the dispatcher/handler split for domain events.** `[Rubric §6, CQRS &
  Event-Driven]` assesses whether events are dispatched *after* persistence rather than from inside
  aggregates, and whether handlers are discoverable. The dispatcher is the port half of the pair; the
  handler half is [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent).
  `[Rubric §1, SOLID]`: the dispatcher depends only on the abstract handler contract (dependency
  inversion), so adding a reaction never edits the dispatcher.
- **Walkthrough**: a one-method port taking a batch rather than a single event, which lets the
  implementation resolve handlers once per event type for a whole save. The only implementation is
  [`DomainEventDispatcher`](#domaineventdispatcher) (Level 3), which fans each event out to every
  registered `IDomainEventHandler<T>` and, for integration events, additionally to every
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent).
- **Why it's built this way**: keeping the contract in `Application` (a port) and the implementation
  behind it follows the Clean Architecture ports-and-adapters split, and the outbox
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) reuses the *same*
  dispatcher for both the synchronous in-process copy and the background re-dispatch of persisted
  events, so a handler cannot behave differently depending on which path delivered its event.
- **Where it's used**: the
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  collects domain events from aggregates, writes them as [`OutboxMessage`](#outboxmessage) rows, then
  calls `DispatchAsync` for the immediate in-process reactions
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:330`);
  the background [`OutboxProcessor`](#outboxprocessor) routes non-integration events through it
  (`OutboxProcessor.cs:606`), as do [`InProcessMessageBus`](#inprocessmessagebus)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:25,32`) and
  [`InProcessEventBus`](#inprocesseventbus)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:83,96`).

### IDomainEventHandler<in TDomainEvent>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Events` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IDomainEventHandler.cs:10` · Level 1 · interface

- **What it is**: the contract a domain-event reaction implements, with a single
  `HandleAsync(TDomainEvent, CancellationToken)` (`IDomainEventHandler.cs:19`).
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0).
- **Concept**: the handler half of the dispatcher/handler split introduced by
  [`IDomainEventDispatcher`](#idomaineventdispatcher). `IDomainEventHandler<in TDomainEvent>` is
  **contravariant** on `TDomainEvent` (the `in` keyword, `IDomainEventHandler.cs:10`), constrained
  `where TDomainEvent : IDomainEvent` (line 11); contravariance means a handler written against a base
  event type is usable where a handler for a more derived event is required. Per the doc comment
  (lines 5-8), implementations are **auto-discovered by Scrutor assembly scanning** and resolved from
  DI during dispatch, which the framework wires through `ScanModuleApplicationServices<T>`.
  `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §5, Vertical Slice]`: a new reaction is a new file
  in the owning module, never an edit to shared dispatch code.
- **Walkthrough**: a one-method port. Handlers that must succeed atomically with the primary
  transaction (a read model in the same database, say) implement it directly and let exceptions
  propagate; handlers that want their own failure context logged first extend
  [`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent), which logs and then
  lets the exception continue so the outbox can redeliver.
- **Where it's used**: resolved and invoked by [`DomainEventDispatcher`](#domaineventdispatcher)
  (Level 3) for every dispatched event; the dispatcher closes this open generic over the concrete
  runtime event type to find the right handlers.

### OutboxSignal
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxSignal.cs:15` · Level 1 · class (public sealed)

- **What it is**: the `SemaphoreSlim`-based [`IOutboxSignal`](#ioutboxsignal) that wakes the
  [`OutboxProcessor`](#outboxprocessor) the instant new outbox entries are written.
- **Depends on**: [`IOutboxSignal`](#ioutboxsignal) (the port it implements) and `IDisposable`
  (`OutboxSignal.cs:15`); BCL `SemaphoreSlim`.
- **Concept reinforced, event-driven wake, plus a small cost lesson.** `[Rubric §12, Performance &
  Scalability]` (introduced at [`IOutboxSignal`](#ioutboxsignal)) and `[Rubric §31, Cost Efficiency /
  FinOps]`. The semaphore is capped at **one permit** on purpose (`new SemaphoreSlim(0, 1)`,
  `OutboxSignal.cs:17`) and the class doc explains exactly why (lines 5-13): the processor drains every
  pending message in a single batch, so one pending wake-up is all the information a burst of saves
  carries. With the default uncapped `SemaphoreSlim(0)` the class accumulated one permit per `Signal()`
  call, so N saves in a burst made `WaitAsync` return immediately N times, and each of those cycles
  issued a candidate-fetch query per relational data source that returned nothing. The surplus signals
  were harmless for correctness but not for cost; with the cap, the surplus is absorbed here.
- **Walkthrough**: `Signal()` (`OutboxSignal.cs:20-30`) calls `_semaphore.Release()` inside a `try` and
  swallows the `SemaphoreFullException` the cap now makes routine (lines 26-29), so repeated signals
  never throw and callers never need to coordinate. `WaitAsync` (`OutboxSignal.cs:33-43`) awaits
  `_semaphore.WaitAsync(timeout, cancellationToken)` and rethrows `OperationCanceledException` only
  when the token really was cancelled, propagating shutdown (lines 39-42); a plain timeout simply
  returns. `Dispose()` (line 46) disposes the semaphore.
- **Why it's built this way**: a counting semaphore is the lightest primitive that both parks the
  processor loop and is releasable from the commit path. Capping it at one permit and swallowing the
  overflow makes signalling idempotent against bursts, which is the same "at-least-once is fine,
  duplicates are absorbed" instinct that runs through this whole group.
- **Where it's used**: registered as the singleton `IOutboxSignal` by `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:192`). Its callers are
  listed under [`IOutboxSignal`](#ioutboxsignal). Note the registration is unconditional, above the
  outbox gate, so the producers can signal without checking whether a processor exists.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### BaseDomainEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.DomainEvents` · `MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:26` · Level 1 · record class (abstract)

- **What it is**: the abstract base record for every domain event, supplying default values for both
  [`IDomainEvent`](#idomainevent) properties so a concrete event type is a one-liner.
- **Depends on**: [`IDomainEvent`](#idomainevent) (Level 0). No externals beyond `DateTime` and
  `Guid`.
- **Concept introduced, record semantics for domain events.** `[Rubric §6, CQRS & Event-Driven]`
  assesses whether events carry enough context and whether consumers can stay idempotent. Declaring
  the base as a `record class` (`MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:26`) gives
  **structural equality**, which is useful for value-based assertions in tests. Two properties are
  initialized inline at construction. `DateOccurred = DateTime.UtcNow`
  (`MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:28`) captures *when the business action
  happened*, not when the event was dispatched, a distinction the summary comment draws explicitly
  (`BaseDomainEvent.cs:5-8`). `MessageId = Guid.NewGuid()` (`BaseDomainEvent.cs:35`) mints a unique
  per-instance id at construction time. Because `MessageId` is serialized with the payload it survives
  the outbox to broker to consumer round trip, which is what makes consumer-side deduplication through
  the [`InboxMessage`](#inboxmessage) table reliable (property doc, `BaseDomainEvent.cs:30-34`).
- **Walkthrough**: two `init` properties with inline defaults, and nothing else. The type is
  `abstract`, so a consumer must declare a concrete event; derived events add whatever domain payload
  they carry (entity id, state change, and so on) as positional or `init` members. The first
  `<remarks>` block (`BaseDomainEvent.cs:9-17`) exists to head off a trap: **structural equality is
  not a deduplication mechanism here.** Both `MessageId` and `DateOccurred` default to a fresh value
  per instance, so two logically identical events raised separately are never equal, and anything
  relying on that comparison to spot a duplicate would silently never match. Deduplication is the
  inbox's job ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)),
  keyed on `MessageId`.
- **Why it's built this way**: inline defaults mean a concrete event record needs zero boilerplate,
  `public sealed record SessionCreated(SessionIdentifierType SessionId) : BaseDomainEvent;` is the
  complete type. Minting `MessageId` at construction rather than at serialization keeps the id stable
  even if the event is serialized more than once, which is the consumer-idempotency half of the
  at-least-once story in
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html). The creation-time
  default on `DateOccurred` is documented as a deliberate domain-modelling choice rather than an
  oversight (second `<remarks>` block, `BaseDomainEvent.cs:18-25`): a domain event's occurrence
  instant is by definition the moment the aggregate raises it, so stamping it at construction is the
  correct event-sourcing and audit semantic, and it is intentionally distinct from *infrastructure*
  timestamps that must be deterministically testable (audit fields, notification read-time), which are
  stamped from an injected `TimeProvider`. `[Rubric §14, Testability]` is the tension being resolved
  here, and the comment records that resolving it the other way (threading a clock through every
  aggregate) would not improve the model.
- **Where it's used**: the base of every domain event across MMCA.Common, MMCA.ADC, and MMCA.Store;
  subclassed by [`BaseIntegrationEvent`](#baseintegrationevent) and by
  [`EntityChangedEvent<TIdentifierType>`](#entitychangedeventtidentifiertype); it is the generic
  constraint on [`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent)
  (`MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:33`); instances are captured into
  [`OutboxMessage`](#outboxmessage) rows and routed by
  [`DomainEventDispatcher`](#domaineventdispatcher).

### IEventBus
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Events` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventBus.cs:11` · Level 2 · interface

- **What it is**: the abstraction application code publishes [`IIntegrationEvent`](#iintegrationevent)s
  through. Two `PublishAsync` overloads (`IEventBus.cs:18` and `:25`): a single event and a batch.
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept introduced, integration events versus domain events at the publish call site.**
  `[Rubric §6, CQRS & Event-Driven]` assesses reliable events, at-least-once delivery and idempotent
  consumers. A **domain event** is raised *inside* an aggregate, captured by the save-changes
  interceptor and dispatched after that save; an **integration event** is an *intentional signal to
  other bounded contexts* that may cross a service boundary. `IEventBus` is where that distinction
  shows up in a caller's code: you publish an `IIntegrationEvent` and the infrastructure decides how to
  route it. The doc comment (lines 5-10) is precise: the default implementation dispatches in-process
  through [`IDomainEventDispatcher`](#idomaineventdispatcher) with outbox persistence for at-least-once
  delivery, while alternative implementations (Azure Service Bus, RabbitMQ) can be substituted via DI.
  The "persist first, then act" guarantee lives in the concrete implementations, not in this interface.
- **Why it's built this way**: two overloads rather than one keeps the batch case a single save and a
  single signal in the implementations, which is exactly the atomicity argument
  [`BrokerEventBus`](#brokereventbus) documents; a loop over the single-event overload would produce
  one transaction and one wake-up per event.
- **Where it's used**: implemented by [`InProcessEventBus`](#inprocesseventbus) (the monolith default)
  and [`BrokerEventBus`](#brokereventbus) (the extracted-service path), both Level 13. Contrast it with
  the transport-agnostic [`IMessageBus`](#imessagebus) that the
  [`OutboxProcessor`](#outboxprocessor) drains through: `IEventBus` is the *producer's* API and writes
  the outbox row, `IMessageBus` is the *transport's* API and moves the row's payload onward.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### IIntegrationEventHandler<in TIntegrationEvent>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Events` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IIntegrationEventHandler.cs:15` · Level 2 · interface

- **What it is**: the handler contract for *receiving* integration events. One method,
  `HandleAsync(TIntegrationEvent, CancellationToken)` (`IIntegrationEventHandler.cs:24`).
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept**: mirrors [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent)
  (Level 1) but for cross-module notifications, and the doc comment contrasts the two directly
  (`IIntegrationEventHandler.cs:5-13`): a domain-event handler reacts to *intra-module* events, an
  integration-event handler reacts to *cross-module* ones, for example a Sales module handling
  `UserRegistered` from the Identity module. It is contravariant (`in`, line 15), constrained
  `where TIntegrationEvent : IIntegrationEvent` (line 16). Implementations are auto-discovered by
  Scrutor at **singleton** lifetime, and the doc states the consequence plainly: handlers create their
  own DI scopes internally (lines 9-12), which is what
  [`ScopedIntegrationEventHandlerBase<TIntegrationEvent>`](#scopedintegrationeventhandlerbasetintegrationevent)
  exists to do for you. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]`:
  a handler written against this contract does not know whether its event arrived in-process or off a
  broker.
- **Where it's used**: implemented by the framework's own
  [`OutputCacheEvictionHandler`](group-12-api-hosting-mapping.md#outputcacheevictionhandler) and by
  application handlers in ADC and Store; invoked in-process by
  [`DomainEventDispatcher`](#domaineventdispatcher) (Level 3) and, on the extracted-service path, by
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent), which resolves every
  registered handler for the delivered event and invokes them in order.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### BaseIntegrationEvent
> MMCA.Common.Domain · `MMCA.Common.Domain.DomainEvents` · `MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:11` · Level 2 · record class (abstract)

- **What it is**: the abstract base for **integration events**, the events meant to cross module or
  service boundaries. It inherits [`BaseDomainEvent`](#basedomainevent) for outbox-pipeline
  compatibility and implements [`IIntegrationEvent`](#iintegrationevent) so the dispatcher additionally
  routes it to integration-event handlers
  (`MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:11`).
- **Depends on**: [`BaseDomainEvent`](#basedomainevent) (Level 1),
  [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept introduced, explicit integration-event schema versioning.** This base adds exactly one
  member beyond what it inherits: `public virtual int SchemaVersion => 1;`
  (`MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:32`). `[Rubric §9, API & Contract Design]`
  assesses whether contracts evolve without silently breaking consumers, and an integration event *is*
  a wire contract the moment it crosses a service boundary. The version is serialized with the
  payload, so a consumer has an explicit signal to branch or upcast on. The doc comment
  (`BaseIntegrationEvent.cs:13-20`) states the discipline precisely: additive or optional field changes
  keep the same version, while a **breaking** change (a renamed, removed, or retyped field) requires a
  *new* event type (for example `FooV2`) plus a consumer-side upcaster, never a silent reshape of an
  existing type. Concrete events bump it by overriding (`public override int SchemaVersion => 2;`).
  `[Rubric §6, CQRS & Event-Driven]`: the dual inheritance is the routing mechanism.
  `BaseDomainEvent` supplies `DateOccurred` and `MessageId`, so the outbox and inbox machinery (which
  operates on `IDomainEvent`) treats integration events uniformly, while the `IIntegrationEvent`
  marker is what makes [`DomainEventDispatcher`](#domaineventdispatcher) fan the event out to
  `IIntegrationEventHandler<T>` as well.
- **Concept introduced, the upcaster is a registration, not a convention.** The second doc paragraph
  (`BaseIntegrationEvent.cs:21-30`) spells out the migration mechanics from
  [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html). The owning
  module registers `services.AddEventUpcaster<FooV1, FooV2, FooUpcaster>()`, and a host that also
  still receives the retired contract over a broker adds
  `x.RegisterUpcastedIntegrationEventConsumer<FooV1>()`
  ([`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions),
  `MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:78`) beside its plain
  `x.RegisterIntegrationEventConsumer<FooV2>()`. Handlers are then written once, against the newest
  contract only. The framework preserves `MessageId` and `DateOccurred` across every hop, so inbox
  deduplication is unaffected by an upcast, and a fitness function requires the upcast *target* to
  declare a strictly higher `SchemaVersion` than its source. That last rule is what keeps the version
  number from being decorative. `[Rubric §15, Best Practices & Code Quality]`: the handler set never has to grow a
  branch per historical contract shape.
- **Why it's built this way**: declaring `SchemaVersion` **virtual with a default** keeps *adding* the
  member a non-breaking change, so every pre-existing event implicitly stays v1 with no edits
  (`BaseIntegrationEvent.cs:19-20`). See
  [ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) for the
  versioning policy, [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)
  for the upcaster registration contract, and
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) for why integration
  events ride the same outbox as ordinary domain events.
- **Where it's used**: base of the framework's own
  [`OutputCacheEvictionRequested`](#outputcacheevictionrequested) and of every cross-module event in
  the apps (for example ADC's `SpeakerLinkedToUser`, `SpeakerUnlinkedFromUser`, `UserRegistered`, and
  Store's `ProductVariantChanged`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### EntityChangedEvent<TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.DomainEvents` · `MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24` · Level 2 · record (abstract)

- **What it is**: the **standardized CRUD lifecycle event base**. Instead of separate `Created`,
  `Updated`, and `Deleted` events per entity, one event type carries the `State`
  ([`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate)) and the affected
  `EntityId`. Handlers filter on `State` to decide which transitions they care about.
- **Depends on**: [`BaseDomainEvent`](#basedomainevent) (Level 1),
  [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate) (Level 0).
- **Concept introduced, consolidated lifecycle events.** `[Rubric §6, CQRS & Event-Driven]`: one
  event type per entity avoids a proliferation of near-identical event classes while still carrying
  enough context to act on. The doc comment (`MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:5-20`)
  draws the boundary clearly: derive **one** record per entity and raise it with
  `DomainEntityState.Added` from factory methods, `DomainEntityState.Updated` from mutation methods,
  and `DomainEntityState.Deleted` from `Delete()`; reserve a *named* event (for example `OrderPaid`,
  `ShoppingCartCheckedOut`), inheriting [`BaseDomainEvent`](#basedomainevent) directly, for business
  state-machine transitions with unique payloads (`EntityChangedEvent.cs:15-19`).
  `[Rubric §15, Best Practices & Code Quality]` assesses change-amplification cost: collapsing three CRUD events into
  one keeps the event surface small, so adding an entity adds one record rather than three.
- **Walkthrough**: a primary-constructor record (`EntityChangedEvent.cs:24`) with two positional
  parameters, `State` of type `DomainEntityState` (`EntityChangedEvent.cs:25`) and `EntityId` of type
  `TIdentifierType` (`EntityChangedEvent.cs:26`). The `where TIdentifierType : notnull` constraint
  (`EntityChangedEvent.cs:27`) prevents a nullable identifier from reaching the outbox payload. The
  `abstract` modifier forces consumers to derive a concrete record (for example
  `CategoryChanged : EntityChangedEvent<ConferenceCategoryIdentifierType>`), which may add extra
  payload of its own. The identifier types themselves come from the module-level `global using` alias
  convention (see the primer's conventions section).
- **Where it's used**: the base of the generic CRUD events in MMCA.ADC such as `CategoryChanged`,
  `EventChanged`, `QuestionChanged`, `SessionChanged`, and `SpeakerChanged`.

### SafeDomainEventHandler<TDomainEvent>
> MMCA.Common.Application · `MMCA.Common.Application.DomainEvents` · `MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:32` · Level 2 · class (abstract)

- **What it is**: a base class for domain-event handlers that must log their own failure with handler
  and event context before the exception continues to the dispatcher. It wraps an abstract
  `HandleSafelyAsync` in an exception **filter** that writes one error line and then lets the
  exception propagate unchanged
  (`MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:36-47`). Despite the name, it does
  not swallow anything.
- **Depends on**: [`BaseDomainEvent`](#basedomainevent) (Level 1),
  [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent) (Level 1); externally
  `Microsoft.Extensions.Logging.ILogger`, taken through the primary constructor
  (`SafeDomainEventHandler.cs:32`).
- **Concept introduced, log-and-propagate handlers and the at-least-once delivery contract.**
  `[Rubric §6, CQRS & Event-Driven]` assesses whether event delivery is reliable end to end, and the
  class comment (`SafeDomainEventHandler.cs:13-20`) records why the earlier swallow-and-log version
  was not: a handler that threw still reported success to the dispatcher, so its outbox row was marked
  processed, nothing ever retried, and the side effect was lost with only a log line to show for it.
  Propagating hands the decision to the delivery mechanism, which is built for exactly this.
  `[Rubric §29, Resilience & Business Continuity]`: on the [`OutboxProcessor`](#outboxprocessor) path
  the failed message keeps its retry count, backs off, and dead-letters after `Outbox:MaxRetries`
  attempts (default 5,
  [`OutboxSettings`](group-04-events-outbox.md#outboxsettings),
  `MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:21`; the retry-count check that stops
  fetching an exhausted row is `OutboxProcessor.cs:369` and the dead-letter branch is
  `OutboxProcessor.cs:667`). `[Rubric §13, Observability & Operability]`: the one job the base class
  keeps is the error line naming the concrete handler and the event type, so an operator can tell
  which handler failed for which event without every subclass hand-rolling that context.
- **Concept introduced, batch redelivery.** The consequence subclasses have to design for is in the
  class comment (`SafeDomainEventHandler.cs:21-29`):
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  dispatches every local event of one save in a single `DispatchAsync` call
  (`MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:330`) and
  only then marks that whole batch processed
  (`DomainEventSaveChangesInterceptor.cs:333`). One rethrowing handler aborts the dispatch call and so
  skips `MarkProcessedAsync` for the WHOLE local batch: every local event written by that save is
  redelivered by the outbox processor, not just the event whose handler failed. Delivery is therefore
  at-least-once, and subclasses must be idempotent for their own event *and* for every sibling event
  raised by the same save.
- **Walkthrough**
  - Primary constructor takes an `ILogger` (`SafeDomainEventHandler.cs:32`), constrained
    `where TDomainEvent : BaseDomainEvent` (`SafeDomainEventHandler.cs:33`).
  - `HandleAsync` (`SafeDomainEventHandler.cs:36`) awaits `HandleSafelyAsync`
    (`SafeDomainEventHandler.cs:40`) inside
    `catch (Exception ex) when (ex is not OperationCanceledException && LogAndRethrow(ex))`
    (`SafeDomainEventHandler.cs:42`). `OperationCanceledException` is excluded from the filter, so
    host shutdown propagates with no log line, because it is not a delivery failure.
  - `LogAndRethrow` (`SafeDomainEventHandler.cs:61`) logs the exception with `GetType().Name` and
    `typeof(TDomainEvent).Name` under the message
    `"Domain event handler {HandlerType} failed for event {EventType}. The outbox processor will redeliver the event."`
    (`SafeDomainEventHandler.cs:63-67`) and always returns `false`
    (`SafeDomainEventHandler.cs:69`), so the filter never matches and the exception keeps propagating.
    The `throw;` inside the catch body is unreachable and is commented as such
    (`SafeDomainEventHandler.cs:44-45`).
  - Doing the log in a *filter* rather than a catch block is the point, and the method doc says so
    (`SafeDomainEventHandler.cs:56-60`): filters run on the first pass, ahead of any unwinding, so the
    handler context is recorded even if an outer frame wraps or rethrows, and the original stack trace
    stays untouched.
  - `HandleSafelyAsync` (`SafeDomainEventHandler.cs:54`) is the abstract method subclasses implement;
    its doc restates the idempotency obligation (`SafeDomainEventHandler.cs:49-53`).
- **Why it's built this way**: it puts the at-least-once contract of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) where that ADR expects
  the retry decision to live, in the delivery mechanism rather than in each handler. The handler
  reports the truth and the outbox decides on retry, backoff, and dead-lettering, and the ADR's
  matching obligation is that handlers stay idempotent. `[Rubric §1, SOLID]`: this is a template
  method, the invariant (log, then propagate, except on cancellation) is sealed in the base and only
  the varying step is abstract, so no subclass can accidentally re-introduce swallowing. A failed
  handler still does not roll back the primary save, but that is the caller's doing rather than the
  base class's: the interceptor's flush runs after the data is committed, catches the propagated
  exception itself, and signals the processor so the unprocessed rows are picked up
  (`DomainEventSaveChangesInterceptor.cs:345`).
- **Where it's used**: reached at runtime through [`DomainEventDispatcher`](#domaineventdispatcher),
  whichever caller dispatched the event (the save-changes interceptor after `SaveChangesAsync`,
  [`InProcessEventBus`](#inprocesseventbus) or [`InProcessMessageBus`](#inprocessmessagebus), or the
  background [`OutboxProcessor`](#outboxprocessor)). The only subclass in the workspace today is
  [`TestSafeDomainEventHandler`](group-27-testing-infrastructure.md#testsafedomaineventhandler)
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:124`),
  driven by
  [`SafeDomainEventHandlerTests`](group-27-testing-infrastructure.md#safedomaineventhandlertests),
  which pin the three behaviours: log **and** propagate, the log lands before the caller sees the
  exception, and `OperationCanceledException` passes through unlogged. The cross-module sibling for
  integration events is
  [`ScopedIntegrationEventHandlerBase<TIntegrationEvent>`](#scopedintegrationeventhandlerbasetintegrationevent),
  which is the base the applications actually derive from.
- **Caveats / not-in-source**: the swallow-to-propagate history and the batch-redelivery contract come
  from the class remarks (`SafeDomainEventHandler.cs:13-29`), not from anything visible in the current
  control flow. The base class cannot enforce the idempotency it demands: that stays a subclass
  obligation with no compile-time or runtime guard. Not determinable from source: how a real
  side-effect handler behaves under redelivery, because no application (ADC, Store, or Helpdesk)
  derives from this base class today, so only the Common unit tests exercise it.

### ScopedIntegrationEventHandlerBase<TIntegrationEvent>
> MMCA.Common.Application · `MMCA.Common.Application.DomainEvents` · `MMCA.Common.Application/DomainEvents/ScopedIntegrationEventHandlerBase.cs:39` · Level 3 · class (abstract)

- **What it is**: the base class for integration-event handlers, the cross-module sibling of
  [`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent). It supplies the two
  blocks every such handler would otherwise repeat: the DI scope preamble and the log-and-rethrow
  envelope (`MMCA.Common.Application/DomainEvents/ScopedIntegrationEventHandlerBase.cs:8-11`).
- **Depends on**:
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
  (Level 2), [`IIntegrationEvent`](#iintegrationevent) (Level 1); externally
  `Microsoft.Extensions.DependencyInjection.IServiceScopeFactory` and
  `Microsoft.Extensions.Logging.ILogger`, both taken through the primary constructor
  (`ScopedIntegrationEventHandlerBase.cs:39-41`), constrained
  `where TIntegrationEvent : IIntegrationEvent` (`ScopedIntegrationEventHandlerBase.cs:42`).
- **Concept introduced, why a singleton handler has to open its own scope.**
  `[Rubric §29, Resilience, Reliability & Business Continuity]` assesses whether repeated infrastructure ceremony is factored
  out of business code, and `[Rubric §1, SOLID]` covers the template-method shape that does it. The
  class doc states the constraint (`ScopedIntegrationEventHandlerBase.cs:12-19`):
  `IIntegrationEventHandler<T>` implementations are registered as **singletons** by the module scan,
  so they cannot constructor-inject a scoped service such as
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) without a captive-dependency bug. Each
  handler therefore has to open its own scope per delivery. This base runs the subclass inside an
  `IServiceScopeFactory.CreateAsyncScope()`-derived async scope and hands it that scope's
  `IServiceProvider`, so a handler body is only its own resolutions plus its own logic, and the scope
  is always disposed. That last guarantee is the reason to have a base class at all: an
  `await using` that every handler hand-rolled would eventually be forgotten in one of them.
- **Concept reinforced, log-and-propagate, identical to the domain-event side.** The exception
  handling matches [`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent)
  exactly, and the doc says so (`ScopedIntegrationEventHandlerBase.cs:20-25`): the subclass body runs
  inside an exception filter that writes one error log line and then lets the exception propagate
  unchanged, while `OperationCanceledException` passes straight through with no log line because host
  shutdown is not a delivery failure. `[Rubric §29, Resilience & Business Continuity]`: the third doc
  paragraph (`ScopedIntegrationEventHandlerBase.cs:26-34`) spells out what propagating buys on each of
  the two delivery paths, which is the detail that distinguishes this class from its domain-event
  sibling. On the **outbox** path the message keeps its retry count, backs off, and dead-letters after
  `Outbox:MaxRetries` attempts; on the **broker** path the inbox row stays unprocessed and MassTransit
  redelivers and then moves the message to the error queue. Delivery is at-least-once either way, so
  subclasses must be idempotent.
- **Walkthrough**
  - `HandleAsync` (`ScopedIntegrationEventHandlerBase.cs:45`) null-guards the event
    (`ScopedIntegrationEventHandlerBase.cs:47`), then opens the scope with
    `scopeFactory.CreateAsyncScope()` (`ScopedIntegrationEventHandlerBase.cs:51`) and disposes it
    through `await using (scope.ConfigureAwait(false))`
    (`ScopedIntegrationEventHandlerBase.cs:52`), passing `scope.ServiceProvider` to the subclass
    (`ScopedIntegrationEventHandlerBase.cs:54`).
  - The whole block sits inside
    `catch (Exception ex) when (ex is not OperationCanceledException && LogAndRethrow(ex, integrationEvent))`
    (`ScopedIntegrationEventHandlerBase.cs:57`). As on the domain-event side, the `throw;` in the catch
    body is unreachable and commented as such (`ScopedIntegrationEventHandlerBase.cs:59-61`); the
    filter is the mechanism, so the log write lands ahead of any unwinding and the original stack
    trace is preserved.
  - `HandleScopedAsync` (`ScopedIntegrationEventHandlerBase.cs:75-78`) is the abstract member a
    subclass implements. Its signature takes the event, the scope's `IServiceProvider`, and the
    cancellation token; its doc restates that the scope is opened before the call and disposed after
    it, and that implementations must be idempotent
    (`ScopedIntegrationEventHandlerBase.cs:65-70`).
  - `LogHandlerFailure` (`ScopedIntegrationEventHandlerBase.cs:87-92`) is `virtual`, not private, and
    that is the one genuine extension point beyond `HandleScopedAsync`. The default writes
    `"Integration event handler {HandlerType} failed for event {EventType}. The delivery mechanism will redeliver the event."`
    with `GetType().Name` and `typeof(TIntegrationEvent).Name`. Its doc
    (`ScopedIntegrationEventHandlerBase.cs:80-86`) tells a subclass to override it in order to log the
    event's own identifiers through a source-generated `[LoggerMessage]` method, and imposes the two
    rules that follow from where it runs: the override executes inside the exception filter, so it
    must not throw and must not rethrow.
  - `LogAndRethrow` (`ScopedIntegrationEventHandlerBase.cs:99-104`) is the private filter predicate.
    It calls `LogHandlerFailure` and always returns `false`, so the filter never matches and the
    exception keeps travelling.
- **Why it's built this way**: it is the same ADR-003 division of labour as
  [`SafeDomainEventHandler<TDomainEvent>`](#safedomaineventhandlertdomainevent), with the retry
  decision left to the delivery mechanism, plus the scope management that the singleton handler
  lifetime forces. Sealing both concerns in a base class means a new integration-event handler in any
  module is a constructor, an override, and nothing else, which is why the applications derive from
  this class where they derive from its domain-event sibling not at all.
- **Where it's used**: it is the base of the integration-event handlers across both apps, for example
  ADC's `UserRegisteredHandler`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:48`),
  `SpeakerLinkedToUserHandler`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:30`),
  `SpeakerUnlinkedFromUserHandler`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandler.cs:30`),
  the Engagement points handlers (`AttendeeCheckedInPointsHandler`,
  `EventFeedbackSubmittedPointsHandler`, `SessionFeedbackSubmittedPointsHandler`,
  `UserDeletedPointsHandler`), and Store's `ProductVariantAddedHandler`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Inventory/DomainEventHandlers/ProductVariantAddedHandler.cs:33`).
  Its behaviour is pinned by
  [`ScopedIntegrationEventHandlerBaseTests`](group-27-testing-infrastructure.md#scopedintegrationeventhandlerbasetests).
  At runtime the subclasses are reached either through
  [`DomainEventDispatcher`](#domaineventdispatcher) in monolith mode or through
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) in broker mode.
- **Caveats / not-in-source**: the base cannot enforce the idempotency it requires, and it cannot stop
  a `LogHandlerFailure` override from throwing inside the filter; both stay subclass obligations
  documented in the remarks (`ScopedIntegrationEventHandlerBase.cs:33`,
  `ScopedIntegrationEventHandlerBase.cs:82-83`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxFinalizer
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxFinalizer.cs:12` · Level 11 · class (internal static)

- **What it is**: the helper that marks a batch of just-dispatched [`OutboxMessage`](#outboxmessage)
  rows processed with a **single set-based SQL `UPDATE`**, then re-syncs the EF change tracker so a
  later save does not re-issue the same statement. It is the finalize step on the low-latency
  in-process happy path, not the background processor's path.
- **Depends on**: [`OutboxMessage`](#outboxmessage) (this group) and
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (G07); EF Core
  (`ExecuteUpdateAsync`) and BCL `TimeProvider`.
- **Concept introduced, set-based finalize off the hot write path.** `[Rubric §12, Performance &
  Scalability]` assesses keeping the hottest write path cheap, and `[Rubric §8, Data Architecture]`
  assesses efficient set-based mutation. Every event-raising command reaches this the moment its
  transaction commits and its local events are dispatched in-process. The naive approach, setting
  `ProcessedOn` on each tracked entity and calling `SaveChanges` again, would run a second full save
  (change detection, audit stamping, the whole interceptor pipeline) on the busiest write path in the
  system. Instead the doc states the design (`OutboxFinalizer.cs:6-11`): one asynchronous
  `ExecuteUpdate` statement that bypasses the change tracker and the `SaveChanges` interceptor pipeline
  entirely.
- **Walkthrough**: `MarkProcessedAsync(ApplicationDbContext, IReadOnlyList<OutboxMessage>,
  TimeProvider, CancellationToken)` (`OutboxFinalizer.cs:26-54`) short-circuits on an empty batch
  (lines 32-33), computes `now` once from the **injected** `timeProvider` (line 35), collects the row
  ids (line 36), and issues **one** `ExecuteUpdateAsync` that sets `ProcessedOn` over
  `Where(m => ids.Contains(m.Id))` (lines 38-41). Because `ExecuteUpdate` does not touch tracked
  instances, it then loops the entries and, for each, sets the tracked `ProcessedOn`, writes the
  property's `OriginalValue`, and clears `IsModified` (lines 47-53). The ordering inside that loop is
  load-bearing and the comment says why (lines 43-46): clearing `IsModified` reverts the current value
  to the original, so the original must already hold the new value first. The `TimeProvider` is a
  parameter rather than a `TimeProvider.System` read (its doc, lines 20-24) so a test driving a
  `FakeTimeProvider` sees this stamp move with the same clock as the processor's lease, backoff and
  retention arithmetic, a `[Rubric §14, Testability]` point.
- **Why it's built this way**: `ExecuteUpdate` is a single round-trip that never materializes entities,
  and re-syncing the tracker afterwards keeps a later `SaveChanges` from queueing a redundant `UPDATE`
  for rows that are already processed. This is how
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)'s in-process dispatch
  stays cheap; the durability net is the background [`OutboxProcessor`](#outboxprocessor), which
  deliberately does **not** use this helper (it stamps `ProcessedOn` on tracked rows and issues one
  ordinary `SaveChangesAsync` per source, `OutboxProcessor.cs:335`, because it must persist
  `RetryCount`, `LastError` and lease changes in the same save).
- **Where it's used**: called by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  right after the local dispatch (`DomainEventSaveChangesInterceptor.cs:334`) and by
  [`InProcessEventBus`](#inprocesseventbus) after writing and dispatching an integration-event batch
  (`InProcessEventBus.cs:98`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxProcessor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:56` · Level 13 · class (public sealed partial, `BackgroundService`)

- **What it is**: the background service that drains every outbox table the host owns, claims rows under
  a lease, and dispatches the [`OutboxMessage`](#outboxmessage)s. It is the engine of at-least-once
  delivery ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) and the most
  intricate type in this group.
- **Depends on**: `IServiceScopeFactory`, `ILogger<OutboxProcessor>`,
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`,
  [`IOutboxSignal`](#ioutboxsignal),
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), an optional
  `TimeProvider` and an optional
  `IOptions<`[`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings)`>`
  (`OutboxProcessor.cs:56-64`); per scope
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDomainEventDispatcher`](#idomaineventdispatcher), [`IMessageBus`](#imessagebus) and, for a tenant
  target, [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) (lines 262-270); the
  [`OutboxMessage`](#outboxmessage) entity, [`OutboxMetrics`](#outboxmetrics),
  [`OutboxCycleResult`](#outboxcycleresult),
  [`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets),
  [`BrokerResilienceDefaults`](group-16-aspire-orchestration.md#brokerresiliencedefaults) and
  [`BrokerMetrics`](group-14-module-system-composition.md#brokermetrics); externally Polly
  (`ResiliencePipeline`, `BrokenCircuitException`).
- **Concept introduced, the outbox drain loop: smart wait, claim leases, ordered delivery,
  dead-lettering, a broker circuit breaker, jittered backoff and trace continuity.**
  `[Rubric §6, CQRS & Event-Driven]` (reliable delivery), `[Rubric §29, Resilience]`,
  `[Rubric §13, Observability & Operability]` and `[Rubric §31, Cost Efficiency]` (idle-poll
  suppression). The class doc sets the delivery contract up front (`OutboxProcessor.cs:34-41`): delivery
  is at-least-once, and a message dispatched but not yet stamped processed is redelivered only once its
  claim lease expires, not immediately on restart, because the claim is persisted before dispatch and
  the poll skips leased rows. Take the rest a layer at a time.
- **Walkthrough**
  - **The loop.** `ExecuteAsync` (`OutboxProcessor.cs:104-148`) waits 5 seconds so the application
    finishes initializing (line 105), then bails out entirely if the host owns no relational targets
    (lines 107-111, logged once, `LogOutboxDisabled` at 797-798). Each iteration calls
    `ProcessPendingMessagesAsync` (line 118), treats a cancellation as a clean stop (lines 120-124) and
    any other exception as a logged error that does not kill the service (lines 125-128). If the cycle
    reported `HasMoreEligibleWork` it re-polls immediately (lines 130-134); otherwise it awaits
    [`IOutboxSignal.WaitAsync`](#ioutboxsignal) for whichever comes first of a signal, the **smart
    wait**, or the fallback interval (lines 139-144).
  - **The smart wait.** `ComputeWaitTime` (`OutboxProcessor.cs:157-175`) returns the full polling
    interval when nothing is pending (lines 161-164); otherwise it waits until the earliest pending row
    becomes eligible, its `OccurredOn` plus `ProcessingDelaySeconds` (line 166, delay default 5,
    `OutboxSettings.cs:40`), floored at `MinimumWait` of 1 second so an overdue row cannot hot-loop the
    processor (lines 76, 167-170) and capped at the polling interval (line 172). Its doc adds a subtle
    rule (lines 148-154): failed-but-already-eligible messages never shorten the wait, which throttles a
    permanently failing message instead of letting it drive the loop. This is why a deployed host can
    set a long poll interval without adding latency: real messages wake it by signal or smart wait, and
    the slow fallback only cuts idle database chatter and telemetry cost.
  - **Which databases.** `GetOutboxSources` (`OutboxProcessor.cs:182-193`) enumerates every relational
    physical source backing a registered entity (Cosmos is filtered out, line 183) plus the configured
    publish target (lines 185-188), deduplicated (line 190). It is recomputed per cycle, which the doc
    calls cheap and tolerant of module assemblies loading after startup (lines 175-179). A host
    therefore only touches *its own* databases, never racing another service for its rows
    ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). `GetOutboxTargets`
    (lines 199-200) is the layer above it: it expands those sources through
    [`TenantDataSourceTargets.Expand`](group-07-persistence-ef-core.md#tenantdatasourcetargets) into one
    target per source against the shared database plus one per tenant that keeps its own copy, because a
    tenant database has its own `OutboxMessages` table that nothing else would drain (doc, lines
    193-198; [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).
  - **Aggregating a cycle.** `ProcessPendingMessagesAsync` (`OutboxProcessor.cs:210-248`) drains each
    target in turn, ORs the `HasMoreEligibleWork` flags, keeps the earliest pending timestamp across all
    targets, and sums the observed backlog (lines 214-226). One unreachable database must not starve the
    others, so a per-target failure is logged and skipped (lines 232-238) while a real cancellation
    propagates (lines 228-231). It then publishes the summed depth through
    [`OutboxMetrics.SetPendingDepth`](#outboxmetrics) (line 243), so a target that threw contributes
    zero and an outage reads as a drop rather than a stale plateau (comment, lines 241-242).
  - **Draining one target.** `ProcessSourceAsync` (`OutboxProcessor.cs:254-344`) opens a scope (line
    258), sets the tenant when the target has one (lines 262-265), gets the context for that source
    (lines 267-268) and resolves the dispatcher and message bus (lines 269-270). It fetches a candidate
    batch (line 275), derives the backlog depth (lines 276-277) and publishes the oldest-pending age
    from the batch's own first row (lines 279-283). Then it splits the ordered batch: the eligible
    prefix is everything with `OccurredOn` before the `ProcessingDelaySeconds` cutoff (lines 273,
    287-291), and the first row past it becomes `earliestPending` (line 293). Nothing eligible means an
    early return carrying only the wait information (lines 295-298). Otherwise it **claims** the prefix
    (lines 300-301), returns early if another replica claimed all of it between fetch and claim (lines
    303-307), dispatches (lines 314-315), and saves with a plain `DbContext.SaveChangesAsync` (line
    333). The comment above that save is worth noting (lines 329-332): no user id is passed, so the
    audit interceptor stamps its system sentinel, and although the EF interceptors still run there is
    nothing for them to capture because `OutboxMessage` is not an aggregate root. It returns a
    `(OutboxCycleResult, long PendingDepth)` tuple (lines 337-341) so the caller can sum the depth.
  - **Fetching.** `FetchCandidatesAsync` (`OutboxProcessor.cs:413-431`) selects rows that are
    unprocessed, under `MaxRetries`, and not under another replica's unexpired lease (lines 421-423),
    ordered by `OccurredOn` then `Id` and capped at `BatchSize` (lines 424-426, default 50,
    `OutboxSettings.cs:17`). There is deliberately **no** `OccurredOn` cutoff in SQL (doc, lines
    402-410): pending rows are fetched too so the caller can smart-wait, and ordering by `OccurredOn`
    guarantees eligible rows sort before pending ones, which is what stops a full batch from starving
    eligible work. The query runs inside an explicit `OutboxPoll` activity (lines 417-418; the name
    constant `PollActivityName` is at line 73) that the Aspire
    [`OutboxPollFilterProcessor`](group-16-aspire-orchestration.md#outboxpollfilterprocessor) suppresses
    from telemetry export along with its SqlClient child span; the string is deliberately duplicated
    there because Aspire has no project reference back to Infrastructure (comment, lines 67-72).
  - **Backlog depth almost for free.** `CountPendingAsync` (`OutboxProcessor.cs:354-375`) returns the
    fetched count directly whenever the batch came back short, because a short batch *is* the whole
    backlog (lines 359-362). Only a saturated batch, exactly the state an operator alerts on, pays for a
    `LongCountAsync`, and that query runs inside its own `OutboxPoll` activity so it is suppressed like
    the poll itself (lines 364-372). The predicate mirrors the fetch (lines 368-370), so the gauge counts
    the rows this processor considers workable.
  - **Claiming: how scale-out is made safe.** `ClaimEligibleAsync` (`OutboxProcessor.cs:456-500`) mints
    a `lockToken` and a `leaseUntil` of now plus `LeaseSeconds` (lines 461-462, default 300,
    `OutboxSettings.cs:82`), narrows the prefix (line 463), then issues one conditional
    `ExecuteUpdateAsync` setting `LockedUntil` and `LockToken` (lines 477-481). A claim of zero rows
    means another replica took the whole prefix (lines 483-484); a full claim returns the candidates
    as-is (lines 486-487); a **partial** claim re-queries which ids carry *this* replica's token and
    processes only those (lines 490-497). The doc states the property this buys (lines 431-437): two
    replicas can never dispatch the same message, and a replica that dies mid-batch releases its rows
    implicitly when the lease expires. That is scale-out safety by construction rather than by a
    `minReplicas: 1` deployment convention.
  - **Ordered delivery, enforced inside the claim.** This is the piece that is easy to get wrong, and
    the doc explains why it lives here rather than after the fetch (lines 438-446): enforcing it in the
    claim is what makes it survive batching *and* scale-out. Three pieces cooperate.
    `SelectOrderedCandidates` (`OutboxProcessor.cs:509-525`) narrows the eligible prefix to every
    unkeyed row plus the **first** row of each ordering key, which is what stops one cycle from
    dispatching two events of a key in parallel. `FilterClaimable` (lines 529-535) is the shared
    predicate (these ids, still unprocessed, not leased). `FilterUnblocked` (lines 544-554) adds the
    ordering guard as a correlated `NOT EXISTS`: a keyed row is refused while any earlier unprocessed,
    non-dead-lettered row shares its key, evaluated by the database at the instant of the update, so a
    second replica racing the same key loses on the row rather than on a check it made before the race
    started. Which of the two runs is decided per batch (lines 470-475): a batch with no keyed row runs
    exactly the query it always ran, so hosts that never declare an ordering key pay nothing for the
    feature, not even a subquery the optimizer has to prove away. Two documented consequences: a
    predecessor still blocks while it is retrying, which is the head-of-line blocking
    [`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey) documents, but once it
    exhausts its retries it stops blocking, so a poison event cannot freeze its key forever (lines
    443-445); and the predecessor test is on `OccurredOn` alone, so two rows sharing a key and an exact
    timestamp are ordered by `Id` within a cycle but neither blocks the other in SQL, because `Guid` has
    no order that .NET and every provider agree on (remarks, lines 448-453).
  - **Dispatching.** `DispatchMessagesAsync` (`OutboxProcessor.cs:563-689`) walks the claimed batch
    inside a per-message activity (line 577). A row whose payload will not deserialize goes to
    `HandleUnresolvableType` (lines 580-585). Otherwise an [`IIntegrationEvent`](#iintegrationevent) is
    published through [`IMessageBus`](#imessagebus) and a pure domain event goes to
    [`IDomainEventDispatcher`](#idomaineventdispatcher) (lines 590-605). On success the row is stamped
    (lines 607-609), `ProcessedCounter` is incremented (line 612) and `DispatchLagHistogram` records the
    seconds between `OccurredOn` and `ProcessedOn`, clamped at zero because the two timestamps come from
    different hosts and clock skew must not publish a negative duration (lines 614-619). The per-message
    success log is deliberately Debug, not Information, and the comment prices the difference: it would
    otherwise be the single noisiest line in steady state, a real telemetry-ingestion cost, while
    failures stay loud (lines 812-816).
  - **Dead-lettering an unresolvable type, with one grace attempt.** `HandleUnresolvableType`
    (`OutboxProcessor.cs:703-725`) treats the **first** failure to resolve as transient and retries it
    through the normal backoff path, because the assembly declaring the type may simply not be loaded
    yet, a module assembly resolved lazily or a host still coming up, and a name that resolves one cycle
    later was never a dead letter (doc, lines 689-695). Only the second attempt is terminal, which is
    also the point at which an operator has already had a Warning naming the row (lines 707-714,
    `LogTypeUnresolvableRetry` at 824-825, whose message names the fix: give the event an
    [`EventName`](group-02-domain-building-blocks.md#eventnameattribute)). A host that set `MaxRetries`
    to 1 asked for no retries at all, so that case skips the grace attempt rather than scheduling one
    the poll's filter would never pick up (lines 705-707). The terminal path stamps `ProcessedOn`,
    increments the dead-letter counter with `reason=type_unresolvable` and logs at Error (lines 716-722).
  - **The broker circuit breaker.** Only the broker hop is wrapped. `_brokerPublishPipeline`
    (`OutboxProcessor.cs:101`) is a Polly `ResiliencePipeline` built by `BuildBrokerPublishPipeline`
    (lines 755-766) from
    [`BrokerResilienceDefaults`](group-16-aspire-orchestration.md#brokerresiliencedefaults) (failure
    ratio, minimum throughput, sampling and break durations, lines 759-762), and the integration-event
    branch executes the publish through it (lines 596-600). Three deliberate choices sit in the doc
    comments. It guards the publish call **only**, never the database calls, because a breaker on those
    would open exactly when the processor most needs to persist retry state (lines 87-91). It carries
    **no** retry strategy, because the outbox already owns retry through `RetryCount` and
    `ComputeRetryBackoffSeconds` (lines 90-91). And it is an **instance** field rather than a static
    one, so breaker state cannot leak across the many processors a test assembly constructs in parallel
    (lines 92-97). `OperationCanceledException` is excluded from the handled set (lines 763-764), because
    a host shutdown cancelling a batch is not evidence that the broker is unhealthy (doc, lines 748-754).
    The in-process dispatcher branch is left unwrapped on purpose: it is a direct method call into the
    same process, so a breaker there would only add a way to reject work that would have succeeded
    (comment, lines 592-595).
  - **Failure handling.** A cancellation during dispatch is rethrown rather than treated as a delivery
    failure, and the comment explains the bug that guard prevents (lines 625-628): falling into the
    generic handler would increment `RetryCount` and stamp `LastError` on this message and, since every
    later `await` fails the same way, on the whole remainder of the batch, so a graceful restart could
    dead-letter messages that were never attempted. A genuine exception bumps `RetryCount` (line 633),
    records `LastError` (line 634) and **re-leases** the row for an explicit backoff (lines 642-643);
    the comment notes that simply keeping the original claim made every retry wait the full
    `LeaseSeconds` no matter what the polling interval or a signal said, turning the retry cadence into
    an accident of the lease (lines 636-641). A `BrokenCircuitException` follows that same failure path
    but is counted separately on
    [`BrokerMetrics.CircuitOpenCounter`](group-14-module-system-composition.md#brokermetrics) (lines
    653-659) and logged **once per batch** through a local latch (lines 573, 661-665), because an open
    circuit rejects every remaining row in the same instant, and "the broker refused 50 messages" and
    "we did not try, the broker is known-dead" are different operational facts (comment, lines 647-652).
    When `RetryCount` reaches `MaxRetries` (5 by default, `OutboxSettings.cs:21`) the dead-letter counter
    is incremented with `reason=retries_exhausted` and it logs at Error (lines 667-677); the row then
    leaves the poll through the `RetryCount` filter and is eventually purged by
    [`OutboxCleanupService`](#outboxcleanupservice), unless an operator replays it first through
    [`OutboxAdministration`](#outboxadministration).
  - **Backoff.** `ComputeRetryBackoffSeconds` (`OutboxProcessor.cs:734-748`) is
    `RetryBackoffBaseSeconds * 2^(retryCount - 1)` (default base 10, `OutboxSettings.cs:99`) with the
    exponent clamped to at most 16 before it reaches `Math.Pow` (line 737), multiplied by a random
    jitter factor in `[0.8, 1.2]` (line 742) and capped at `LeaseSeconds` (line 745). Jitter is applied
    *before* the cap so a capped backoff sits exactly at the lease bound (comment, line 740). The doc
    names the reason for the jitter (lines 725-731): a batch that failed together, one dependency outage
    failing all 50 rows in the same instant, would otherwise retry in lockstep and re-hammer that
    dependency on a single shared schedule. The `S2245`/`CA5394` suppression (lines 741, 743) is
    justified inline: the randomness feeds no security, token, key or cryptographic decision.
  - **Graceful shutdown.** If cancellation lands mid-batch, `ProcessSourceAsync` calls
    `TryPersistStampsOnCancellationAsync` (lines 317-327, implemented at 388-400) before rethrowing, so
    messages already delivered keep their `ProcessedOn` instead of being redelivered when their lease
    expires. Two constraints are deliberate (doc, lines 375-387): its own try/catch, because a failure
    here must never replace the propagating `OperationCanceledException` the loop uses to recognize
    shutdown; and its own 5-second token (`ShutdownSaveTimeout`, line 83) rather than
    `CancellationToken.None`, so an uncancellable save against a dead connection cannot hold host
    shutdown open until the command timeout. A failure there logs at Warning and says plainly that the
    delivered messages will be redelivered when the lease expires (lines 806-807).
  - **Trace continuity.** `StartOutboxActivity` (`OutboxProcessor.cs:775-797`) rebuilds the original
    request's `ActivityContext` from the row's `TraceId`/`SpanId` (lines 780-783) and starts a
    `Consumer`-kind `OutboxProcess` activity tagged with the message id, event type and data source
    (lines 785-792), returning null when no trace context was captured (lines 775-778), so traces span
    the asynchronous hop.
- **Why it's built this way**:
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) makes the outbox the
  durability guarantee behind every integration event; the per-source design follows from
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) and the per-tenant
  expansion from [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html). The smart
  wait, the derived backlog count and the suppressed poll activity are all cost and latency work: an
  idle fleet polling around the clock would otherwise dominate telemetry ingestion. Dead-lettering
  unresolvable types stops one poison message from blocking the queue, the *progress* requirement on
  re-poll (see [`OutboxCycleResult`](#outboxcycleresult)) prevents a fully-failing batch from
  hot-spinning, the circuit breaker keeps a known-dead broker from being hammered once per row per
  cycle, the lease-plus-token pair is what makes running more than one replica safe, and the ordering
  guard inside the claim is what makes ordered delivery survive both batching and scale-out.
- **Where it's used**: registered as a hosted service by `AddInfrastructure` whenever the transport
  enables the outbox
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:204-208`), so every
  broker-backed service host runs exactly one. The producer side is the two `IEventBus` implementations
  ([`InProcessEventBus`](#inprocesseventbus) and [`BrokerEventBus`](#brokereventbus)) plus the
  `SaveChanges` capture in
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor);
  its companion sweeper is [`OutboxCleanupService`](#outboxcleanupservice) and its operator surface is
  [`OutboxAdministration`](#outboxadministration).
- **Caveats / not-in-source**: the `outbox.pending.depth` gauge is per instance by design (see
  [`OutboxMetrics`](#outboxmetrics)); the lease makes multiple replicas *correct*, but the gauge still
  must not be summed across them.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### IMessageBus
> MMCA.Common.Application · `MMCA.Common.Application.Messaging` · `MMCA.Common.Application/Messaging/IMessageBus.cs:28` · Level 2 · interface

- **What it is**: the **transport-agnostic** abstraction for publishing integration events across
  module or service boundaries. Two `PublishAsync` overloads, single event
  (`MMCA.Common.Application/Messaging/IMessageBus.cs:35`) and batch (`IMessageBus.cs:42`).
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1). Nothing else, which is the
  point: this file has one `using` and it is a Domain namespace (`IMessageBus.cs:1`).
- **Concept introduced, a transport-agnostic message bus for microservices readiness.**
  `[Rubric §7, Microservices Readiness]` assesses whether the transport is a swappable boundary and
  whether the business layers stay free of transport coupling. The doc comment (`IMessageBus.cs:5-27`)
  enumerates both implementations explicitly: [`InProcessMessageBus`](#inprocessmessagebus) dispatches
  synchronously through the existing [`IDomainEventDispatcher`](#idomaineventdispatcher) path for the
  modular-monolith deployment (`IMessageBus.cs:13-17`), and [`BrokerMessageBus`](#brokermessagebus)
  publishes through MassTransit to an external broker, RabbitMQ in development and Azure Service Bus
  in production, for the extracted-service mode (`IMessageBus.cs:18-24`). The same comment records why
  transactional-outbox semantics survive the swap: [`OutboxProcessor`](#outboxprocessor) drains
  [`OutboxMessage`](#outboxmessage) rows *through this bus* instead of dispatching in-process
  (`IMessageBus.cs:21-23`). It is also explicit that application code that publishes cross-cutting
  events should depend on `IMessageBus` rather than on [`IEventBus`](#ieventbus) or on a
  transport-specific client (`IMessageBus.cs:6-9`). `[Rubric §3, Clean Architecture]`: the interface
  lives in `Application` and both implementations live in `Infrastructure`, so the dependency arrow
  points inward.
- **Why it's built this way**: transport belongs at the edge
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). The *same*
  application code that called `IMessageBus.PublishAsync` in the monolith keeps working when the
  module is extracted and `BrokerMessageBus` is swapped in; only configuration
  (`MessageBus:Provider`,
  [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)) changes.
  `Application`, `Domain`, and `Shared` must never reference MassTransit directly, and the NetArchTest
  transport-boundary rule enforces exactly that
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:7`).
  The **MassTransit v8 pin** is a separate constraint enforced by the dependency-version fitness test
  (v9 requires a commercial licence); see the primer's external-stack section.
- **Where it's used**: implemented by [`InProcessMessageBus`](#inprocessmessagebus), the default
  scoped registration (`MMCA.Common.Infrastructure/DependencyInjection.cs:570`, with the rationale
  comment at `DependencyInjection.cs:551-555`), and by [`BrokerMessageBus`](#brokermessagebus), which
  `Replace`s that registration inside `AddBrokerMessaging`
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:785`). At runtime it is resolved per cycle by
  the background [`OutboxProcessor`](#outboxprocessor)
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:272`) and invoked for every
  integration-event row it drains (`OutboxProcessor.cs:590-600`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### BrokerMessageBus
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:24` · Level 3 · class (public sealed)

- **What it is**: the [`IMessageBus`](#imessagebus) implementation backed by MassTransit (RabbitMQ
  locally, Azure Service Bus in production). It publishes integration events to the broker for
  cross-process delivery and is used by extracted microservices in place of
  [`InProcessMessageBus`](#inprocessmessagebus)
  (`MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:7-10`).
- **Depends on**: [`IMessageBus`](#imessagebus) (Level 2), [`IIntegrationEvent`](#iintegrationevent)
  (Level 1); externally MassTransit's `IPublishEndpoint`, taken through the primary constructor
  (`BrokerMessageBus.cs:24`). See the primer's external-stack section for MassTransit.
- **Concept introduced, MassTransit as the transport, kept at the edge.**
  `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out of the monolith
  without rewriting application code, and `[Rubric §6, CQRS & Event-Driven]` assesses at-least-once
  delivery of integration events. The [`IMessageBus`](#imessagebus) interface is defined up in
  `MMCA.Common.Application`, a deliberate architectural constraint: **`Application`, `Domain`, and
  `Shared` must never reference MassTransit directly**, which the transport-boundary fitness rule
  enforces
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:7`).
  `BrokerMessageBus` is one of the few places MassTransit crosses into first-party code, and it lives
  in Infrastructure, the outermost layer that is allowed to know the transport.
- **Walkthrough**
  - `PublishAsync(IIntegrationEvent, CancellationToken)` (`BrokerMessageBus.cs:27`): null-guards
    (`BrokerMessageBus.cs:29`), then calls
    `publishEndpoint.Publish(integrationEvent, integrationEvent.GetType(), cancellationToken)`
    (`BrokerMessageBus.cs:33`). Passing the **runtime type** explicitly rather than letting the static
    `IIntegrationEvent` type be used is load-bearing: MassTransit routes by the concrete event class,
    and consumers bind to the concrete type, never to the base interface, so publishing as
    `IIntegrationEvent` would reach nobody (comment, `BrokerMessageBus.cs:31-32`).
  - `PublishAsync(IEnumerable<IIntegrationEvent>, CancellationToken)` (`BrokerMessageBus.cs:37`):
    null-guards (`BrokerMessageBus.cs:39`), then iterates and awaits each single publish in turn
    (`BrokerMessageBus.cs:41-44`). There is no transactional grouping across the batch here; batch
    atomicity is the outbox's concern, not the publisher's.
  - The doc comment (`BrokerMessageBus.cs:18-22`) records that MassTransit automatically propagates the
    ambient `System.Diagnostics.Activity` as `traceparent` and `tracestate` message headers, so a
    distributed trace continues across the broker hop, `[Rubric §13, Observability & Operability]`.
- **Why it's built this way**: this bus does **not** itself write to the outbox. Transactional-outbox
  semantics are preserved by the [`OutboxProcessor`](#outboxprocessor): events are persisted to
  [`OutboxMessage`](#outboxmessage) in the *same* database transaction as the aggregate change, then
  the processor drains them by calling this bus
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html), and the doc comment
  says exactly this at `BrokerMessageBus.cs:11-17`). Keeping `BrokerMessageBus` a thin publish
  adapter, with no outbox knowledge, is what lets one set of outbox machinery serve both monolith and
  broker modes ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
- **Where it's used**: swapped in for the default in-process registration by `AddBrokerMessaging`
  through `services.Replace` (`MMCA.Common.Infrastructure/DependencyInjection.cs:785`), which returns
  early without touching the container when `MessageBus:Provider` is `InProcess`
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:755-758`; see
  [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)). It is driven at
  runtime by the [`OutboxProcessor`](#outboxprocessor), which resolves `IMessageBus` per cycle
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:272`) and calls it inside a
  resilience pipeline that wraps only the broker hop
  (`OutboxProcessor.cs:590-600`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### DomainEventDispatcher
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common.Application/Services/DomainEventDispatcher.cs:23` · Level 3 · class (public sealed)

- **What it is**: the in-process implementation of [`IDomainEventDispatcher`](#idomaineventdispatcher).
  It dispatches each event to every registered `IDomainEventHandler<T>` and, if the event also
  implements [`IIntegrationEvent`](#iintegrationevent), to every registered
  [`IIntegrationEventHandler<T>`](#iintegrationeventhandlerin-tintegrationevent) after running the
  event through the upcaster chain. It uses **compiled expression-tree delegates cached per (event
  type, handler interface)** to eliminate per-dispatch reflection.
- **Depends on**: [`IDomainEvent`](#idomainevent),
  [`IDomainEventDispatcher`](#idomaineventdispatcher),
  [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent),
  [`IIntegrationEvent`](#iintegrationevent),
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent),
  [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry); externally
  `IServiceProvider`, `System.Linq.Expressions`, `System.Collections.Concurrent`, and `ILogger<T>`.
- **Concept introduced, compiled expression-tree delegates for handler dispatch.**
  `[Rubric §12, Performance & Scalability]` (this is the hot post-`SaveChanges` path, so reflection
  cost compounds with every event on a busy request) and `[Rubric §6, CQRS & Event-Driven]` (events
  fan out to all registered handlers reliably). The problem:
  `IServiceProvider.GetServices(closedHandlerType)`
  (`MMCA.Common.Application/Services/DomainEventDispatcher.cs:74`) returns `object` instances, so
  calling the generic `HandleAsync` on them would otherwise require reflection on every dispatch. The
  solution: on first encounter of a `(eventType, handlerInterfaceType)` pair, `BuildInvoker`
  (`DomainEventDispatcher.cs:97`) uses `Expression.Lambda` to compile a
  `Func<object, object, CancellationToken, Task>` that casts the `object` arguments to their concrete
  types and calls `HandleAsync` directly (`DomainEventDispatcher.cs:105-116`). Subsequent dispatches
  of the same pair reuse the cached delegate, with zero reflection.
- **Concept introduced, where upcasting happens on the in-process path.** The class doc
  (`DomainEventDispatcher.cs:15-21`) states the split precisely: the *integration* branch runs the
  event through [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) first, so
  a retired contract reaches the handlers written against its successor
  ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)). That also
  covers outbox rows written before an upgrade, which deserialize back into the old type. The
  `IDomainEventHandler<T>` branch is deliberately left untouched, because intra-module handlers keep
  receiving the original type and the original instance. `[Rubric §9, API & Contract Design]`: only
  the *cross-boundary* contract needs version tolerance; an in-module event has no independent
  deployment to be out of step with.
- **Walkthrough**
  - `_serviceProvider` (`DomainEventDispatcher.cs:25`), null-checked in the field initializer.
  - `_upcasterRegistry` (`DomainEventDispatcher.cs:32-33`), a `Lazy<IEventUpcasterRegistry?>` over
    `serviceProvider.GetService`, resolved on first use and cached. `GetService` rather than
    `GetRequiredService` is deliberate and documented (`DomainEventDispatcher.cs:27-31`): this
    dispatcher is constructed directly in tests and in bare providers that never called
    `AddApplication()`, and no registry simply means no upcasting rather than a startup crash.
  - `DispatchCache` (`DomainEventDispatcher.cs:41-43`), a **static** `ConcurrentDictionary` keyed by
    `(Type EventType, Type HandlerInterface)` whose value is the tuple
    `(Type ClosedHandlerType, Func<object, object, CancellationToken, Task> Invoker)`. Caching the
    closed handler type alongside the invoker keeps `Type.MakeGenericType` off the per-dispatch path
    (doc comment, `DomainEventDispatcher.cs:35-40`). Being static, the warmed cache is shared
    process-wide, and `ConcurrentDictionary` makes that thread-safe.
  - `DispatchAsync` (`DomainEventDispatcher.cs:46`) null-guards the batch
    (`DomainEventDispatcher.cs:48`), then per event always dispatches to `IDomainEventHandler<>`
    (`DomainEventDispatcher.cs:55`) and dispatches to `IIntegrationEventHandler<>` only when the event
    is also an `IIntegrationEvent` (`DomainEventDispatcher.cs:60-65`). The upcast happens on that
    branch: `_upcasterRegistry.Value?.UpcastToTerminal(integrationEvent) ?? integrationEvent`
    (`DomainEventDispatcher.cs:62`), and the *terminal* event's runtime type is what selects the
    handler set (`DomainEventDispatcher.cs:64`).
  - `DispatchToHandlersAsync` (`DomainEventDispatcher.cs:69`) `GetOrAdd`s the cached
    `(closedHandlerType, invoker)` pair with a `static` factory
    (`DomainEventDispatcher.cs:71-73`, `static` so the lambda allocates no closure), resolves all
    handlers (`DomainEventDispatcher.cs:74`), and awaits each through the invoker
    (`DomainEventDispatcher.cs:84`). A `null` resolved handler is logged as a likely DI
    misconfiguration and skipped rather than throwing (`DomainEventDispatcher.cs:78-82`).
  - `BuildInvoker` (`DomainEventDispatcher.cs:97`) closes the open handler type
    (`DomainEventDispatcher.cs:99`), finds `HandleAsync` on it and throws a named
    `InvalidOperationException` if it is missing (`DomainEventDispatcher.cs:100-101`), builds
    `((IHandler<TEvent>)handler).HandleAsync((TEvent)event, ct)` as an expression
    (`DomainEventDispatcher.cs:105-113`), and `Compile()`s it
    (`DomainEventDispatcher.cs:115-116`).
- **Why it's built this way**: at-least-once domain-event delivery
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) requires the
  dispatcher to run after each `SaveChangesAsync`, so with many events per request the reflection cost
  would compound; the expression-tree cache makes dispatch near zero-cost after warm-up. Routing
  domain and integration events through one dispatcher rather than two keeps the in-process path
  uniform, which is precisely what lets [`InProcessMessageBus`](#inprocessmessagebus) be a two-line
  adapter.
- **Where it's used**: registered as the singleton `IDomainEventDispatcher`
  (`MMCA.Common.Application/DependencyInjection.cs:37`, beside the
  [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) registration at
  `DependencyInjection.cs:41`); called by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  after the outbox rows are written
  (`MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:330`), by
  the background [`OutboxProcessor`](#outboxprocessor) when re-dispatching persisted domain events
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:606`), and by both in-process
  buses ([`InProcessMessageBus`](#inprocessmessagebus),
  [`InProcessEventBus`](#inprocesseventbus)).

### InProcessMessageBus
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:19` · Level 3 · class (public sealed)

- **What it is**: the [`IMessageBus`](#imessagebus) implementation for the modular-monolith and
  integration-test case. It dispatches integration events synchronously through the in-process
  [`IDomainEventDispatcher`](#idomaineventdispatcher), and it is the default registration when no
  broker is configured (`MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:7-10`).
- **Depends on**: [`IDomainEventDispatcher`](#idomaineventdispatcher) (Level 1),
  [`IMessageBus`](#imessagebus) (Level 2), [`IIntegrationEvent`](#iintegrationevent) (Level 1). No
  externals at all.
- **Concept reinforced, same interface, different transport.** `[Rubric §7, Microservices Readiness]`:
  application code injects [`IMessageBus`](#imessagebus) and never learns whether the events leave the
  process. Swapping the registration from this class to [`BrokerMessageBus`](#brokermessagebus) is the
  entire "go distributed" change for the publish path.
- **Walkthrough**: both overloads (`InProcessMessageBus.cs:22` and `InProcessMessageBus.cs:29`)
  null-guard and then forward straight to `domainEventDispatcher.DispatchAsync([integrationEvent], ...)`
  (`InProcessMessageBus.cs:25`) and `DispatchAsync(integrationEvents, ...)`
  (`InProcessMessageBus.cs:32`). Neither returns an awaited task; both return the dispatcher's task
  directly, so there is no extra state machine on this path. No outbox write happens here: the doc
  comment (`InProcessMessageBus.cs:11-17`) is explicit that this bus is meant to be invoked by the
  [`OutboxProcessor`](#outboxprocessor) when draining *already-persisted* entries, or by application
  paths that have already taken responsibility for outbox persistence elsewhere. It is the in-process
  counterpart of [`BrokerMessageBus`](#brokermessagebus), not a "persist and dispatch" bus. Code that
  wants persist-and-dispatch semantics uses [`IEventBus`](#ieventbus) instead
  (`InProcessMessageBus.cs:15-16`).
- **Why it's built this way**: keeping the monolith path a single synchronous dispatcher call means
  integration tests need no broker container and the common (monolith) deployment pays no broker
  latency. When the outbox is enabled, the [`OutboxProcessor`](#outboxprocessor) still supplies the
  at-least-once safety net around this bus, because the processor is what invokes it.
- **Where it's used**: registered as the default scoped `IMessageBus` in `AddServices`
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:570`, with the rationale comment at
  `DependencyInjection.cs:551-555`), and therefore the bus resolved by
  [`OutboxProcessor`](#outboxprocessor) in monolith mode
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:272`). It is replaced by
  [`BrokerMessageBus`](#brokermessagebus) in broker-mode service hosts
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:785`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### IntegrationEventConsumer<TEvent>
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:27` · Level 3 · class (public sealed partial)

- **What it is**: a single generic MassTransit `IConsumer<TEvent>` that bridges broker-delivered
  messages to the existing
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
  contract, resolving every registered handler from the per-message DI scope and adding
  **consumer-side inbox idempotency** through [`IInboxStore`](#iinboxstore).
- **Depends on**: [`IInboxStore`](#iinboxstore),
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent),
  [`IIntegrationEvent`](#iintegrationevent), [`EventNameResolver`](#eventnameresolver); externally
  MassTransit's `IConsumer<T>` and `ConsumeContext<T>`, and `ILogger<T>` with source-generated
  `[LoggerMessage]` methods. The three dependencies arrive through the primary constructor
  (`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:27-30`), constrained
  `where TEvent : class, IIntegrationEvent` (`IntegrationEventConsumer.cs:31`).
- **Concept introduced, the consumer-side inbox for broker idempotency.**
  `[Rubric §29, Resilience & Business Continuity]` assesses at-least-once delivery paired with
  *idempotent consumers*, and `[Rubric §6, CQRS & Event-Driven]` assesses idempotent
  integration-event handling. MassTransit guarantees at-least-*once* delivery: the same message can
  arrive twice after a consumer crash or a broker redelivery. The inbox makes that safe, and the API
  is a three-phase one rather than a check-then-record pair.
  `inbox.TryBeginAsync(MessageId, eventTypeName, ct)` (`IntegrationEventConsumer.cs:54`) returns
  `false` when the message was already processed, in which case the consumer logs at Debug and returns
  without running handlers, acking the message (`IntegrationEventConsumer.cs:56-57`). When it returns
  `true`, it has also **staged** the inbox row in the scope's unit of work, unsaved. That staging is
  the load-bearing detail, and the comment explains why (`IntegrationEventConsumer.cs:49-53`): a
  handler that calls `SaveChangesAsync` on that same scope commits the inbox row *in the same
  transaction as its own mutations*, so the window in which a crash between "handler committed" and
  "inbox written" reprocessed the whole event is closed by construction rather than by asking every
  handler to be idempotent. The interface's default implementations
  (`MMCA.Common.Infrastructure/Persistence/Inbox/IInboxStore.cs:38`,
  `IInboxStore.cs:48`, `IInboxStore.cs:63`) fall back to the older check-then-record behavior, so an
  external implementation of the interface still compiles and still works.
- **Concept introduced, the inbox key is the event's declared name, not its CLR name.** The key is
  computed by `EventNameResolver.GetInboxName(typeof(TEvent))`
  (`IntegrationEventConsumer.cs:43`), which returns the event's
  [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) name when it declares
  one and its short type name otherwise
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/EventNameResolver.cs:59-60`). The comment
  (`IntegrationEventConsumer.cs:40-42`) records the compatibility reason: an unannotated event keeps
  matching the rows already written under its short type name.
  `[Rubric §9, API & Contract Design]`: the stable wire identity, not the CLR identity, is what a
  cross-service dedup key has to be built on, because the CLR name can be refactored.
- **Walkthrough**
  - Guard and unwrap: `ArgumentNullException.ThrowIfNull(context)`
    (`IntegrationEventConsumer.cs:36`), then `context.Message`
    (`IntegrationEventConsumer.cs:38`).
  - Idempotency short-circuit (`IntegrationEventConsumer.cs:54-58`): a duplicate leads to
    `LogDuplicateSkipped` and a normal return, which acks rather than dead-letters.
  - Handler loop (`IntegrationEventConsumer.cs:62-83`): counts and invokes each resolved
    `IIntegrationEventHandler<TEvent>` in turn (`IntegrationEventConsumer.cs:67`). On any
    non-`OperationCanceledException` (`IntegrationEventConsumer.cs:69`) it first calls
    `inbox.Abandon(MessageId)` (`IntegrationEventConsumer.cs:74`) so the failed attempt leaves neither
    a rejected insert on the scope's context nor an inbox row that would make the redelivery look like
    a duplicate (comment, `IntegrationEventConsumer.cs:71-73`), then logs `LogHandlerFailure` naming
    the failing handler's full type name (`IntegrationEventConsumer.cs:80`) and **rethrows**
    (`IntegrationEventConsumer.cs:81`) so MassTransit's `UseMessageRetry` policy (exponential backoff,
    `MessageBusSettings.RetryLimit` attempts, default 5,
    `MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:76`) runs before the message is
    dead-lettered.
  - No-handler case (`IntegrationEventConsumer.cs:85-91`): if zero handlers were registered for the
    event in this process, `LogNoHandlers` fires and the method returns normally, so the broker acks
    with no retry storm while the misconfigured service host stays visible in telemetry.
  - Mark-processed (`IntegrationEventConsumer.cs:95`): `inbox.CompleteAsync` persists the staged row
    unless a handler's own save already committed it. Either way the message is recorded only on a
    successful consume, because the failure path above rethrows (comment,
    `IntegrationEventConsumer.cs:93-94`).
  - Three `[LoggerMessage]` partials (`IntegrationEventConsumer.cs:98-105`) are the source-generated,
    allocation-free log methods, `[Rubric §13, Observability & Operability]`.
- **Why it's built this way**: application code keeps writing plain
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
  implementations, which the module scan already auto-discovers as singletons; there is **no per-event
  MassTransit consumer class to author** (doc comment, `IntegrationEventConsumer.cs:14-19`). This one
  universal adapter is registered once per event type through
  [`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions)
  (`IntegrationEventConsumer.cs:20-24`), which keeps the MassTransit dependency out of the handlers
  and out of the Application layer
  ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html) for the inbox
  guarantee, [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) for the
  outbox half, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) for the
  extraction boundary).
- **Where it's used**: registered in each broker-mode service host's MassTransit configuration for
  every integration event that service consumes, through
  `RegisterIntegrationEventConsumer<TEvent>` on
  [`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions)
  (`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:42`). The retired-contract
  variant is handled by a different consumer,
  [`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent).
- **Caveats / not-in-source**: whether the inbox actually dedups depends on which
  [`IInboxStore`](#iinboxstore) is registered. `AddBrokerMessaging` registers
  [`EfInboxStore`](#efinboxstore) when `MessageBusSettings.IsInboxEnabled` resolves true, which it
  does by default for a broker transport
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:798-804`,
  `MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:125`); an explicit
  `MessageBus:EnableInbox=false` opts down to [`NoOpInboxStore`](#noopinboxstore), where the inbox
  calls do nothing and every redelivery re-runs the handlers, a posture announced once at startup by
  [`InboxDisabledWarningService`](#inboxdisabledwarningservice). One inconsistency worth knowing:
  the no-handler comment says "log a warning" (`IntegrationEventConsumer.cs:87`) but the
  `[LoggerMessage]` attribute declares `Level = LogLevel.Information`
  (`IntegrationEventConsumer.cs:101`); the attribute is what runs.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutputCacheEvictionRequested
> MMCA.Common.Domain · `MMCA.Common.Domain.IntegrationEvents` · `MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:29` · Level 3 · record class (public sealed)

- **What it is**: the framework's own integration event, a cross-service request to evict output-cache
  entries carrying the given tags. It is published by the service that owns the data, through the
  outbox like any other integration event, and consumed by every host that serves output-cached
  responses built from that data
  (`MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:6-9`).
- **Depends on**: [`BaseIntegrationEvent`](#baseintegrationevent) (Level 2), and through it
  [`IIntegrationEvent`](#iintegrationevent) and [`IDomainEvent`](#idomainevent);
  [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) (Level 0). The only
  BCL type in its payload is `IReadOnlyList<string>`.
- **Concept introduced, a framework-shipped event contract, and why a per-host cache needs a
  fan-out.** `[Rubric §12, Performance & Scalability]` (cache correctness under scale-out),
  `[Rubric §9, API & Contract Design]` (wire contracts and their versioning), and
  `[Rubric §6, CQRS & Event-Driven]`. The doc comment states the problem precisely
  (`OutputCacheEvictionRequested.cs:10-15`): ASP.NET Core's output cache is per host, because
  `IOutputCacheStore` is a local store, so a write in the owning service leaves a stale cached
  response sitting in front of every OTHER replica and every other service until its TTL expires.
  Broadcasting the eviction turns a per-process concern into a fan-out one message wide. Note that
  this is a *framework* event, not an application one: the events fitness rule records that
  framework-shipped integration events are the framework's own contract, gated by its conventions and
  public API baseline, so consumer residency rules and frozen snapshots neither police nor churn on
  them
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Events.cs:59-66`).
- **Walkthrough**: the type carries one member and one attribute.
  `[EventName("Common.OutputCacheEvictionRequested.v1")]`
  (`OutputCacheEvictionRequested.cs:28`) pins the stable wire and storage identity, which is what the
  outbox writes and what [`EventNameResolver`](#eventnameresolver) reverse-resolves, so the CLR type
  can be renamed without orphaning rows or inbox keys. `Tags`
  (`OutputCacheEvictionRequested.cs:37`) is an `IReadOnlyList<string>` defaulted to `[]`, holding the
  output-cache tags to evict exactly as the producing host spelled them in its
  `[OutputCache(Tags = ...)]` or policy registration. Defaulting rather than marking it `required` is
  deliberate and documented (`OutputCacheEvictionRequested.cs:31-36`): a message that arrives without
  the field deserializes into a harmless no-op instead of faulting the consumer and dead-lettering.
  `SchemaVersion` is inherited at `1` from [`BaseIntegrationEvent`](#baseintegrationevent).
- **Why it's built this way**: the doc calls it a **frozen-contract candidate**
  (`OutputCacheEvictionRequested.cs:16-26`). The wire shape is deliberately minimal, a tag list and
  nothing else, because every host that consumes it must be able to deserialize it forever. Any change
  is therefore a versioning decision
  ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)):
  additive optional fields keep `SchemaVersion` at 1, while a rename, removal, or retype requires a
  new event type plus a registered upcaster
  (`services.AddEventUpcaster<OutputCacheEvictionRequested, OutputCacheEvictionRequestedV2, ...>()`)
  and a `RegisterUpcastedIntegrationEventConsumer<OutputCacheEvictionRequested>()` on every host still
  receiving the old contract until the queues drain
  ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)). Riding the
  ordinary outbox path ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html))
  means the eviction inherits the same at-least-once guarantee as any business event, and a duplicate
  eviction is harmless by nature, which is why this event needs no special idempotency handling.
- **Where it's used**: consumed by
  [`OutputCacheEvictionHandler`](group-12-api-hosting-mapping.md#outputcacheevictionhandler)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionHandler.cs:32`),
  registered by `AddOutputCacheEvictionHandler`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:111`); its
  broker consumer is wired by the named shorthand `RegisterOutputCacheEvictionConsumer` on
  [`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions)
  (`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:108-110`). It is
  published in ADC by `UserSessionBookmarkCacheEvictionHandler`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:77`).

### IntegrationEventConsumerExtensions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging.Consumers` · `MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:12` · Level 4 · class (public static)

- **What it is**: a C# `extension(IBusRegistrationConfigurator)` block that adds three fluent
  registration methods: the generic `RegisterIntegrationEventConsumer<TEvent>`, the retired-contract
  `RegisterUpcastedIntegrationEventConsumer<TEvent>`, and the named shorthand
  `RegisterOutputCacheEvictionConsumer`. All three hide the MassTransit consumer-registration plumbing
  behind one call, and every consumer they register ends up delegating to the
  [`IIntegrationEventHandler<TEvent>`](#iintegrationeventhandlerin-tintegrationevent) implementations
  resolved from DI
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IIntegrationEventHandler.cs:15`),
  which is the type the registration doc comments point at
  (`IntegrationEventConsumerExtensions.cs:18`, `IntegrationEventConsumerExtensions.cs:55`).
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent),
  [`IIntegrationEventHandler<TEvent>`](#iintegrationeventhandlerin-tintegrationevent),
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent),
  [`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent),
  [`FaultIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#faultintegrationeventconsumertevent),
  [`OutputCacheEvictionRequested`](#outputcacheevictionrequested); externally MassTransit's
  `IBusRegistrationConfigurator`.
- **Concept reinforced, `extension(T)` members as registration sugar, plus a lesson in making
  failures observable.** The `extension(T)` syntax is the workspace-wide DI-registration idiom (see
  the primer's conventions section). `[Rubric §7, Microservices Readiness]`: a host registers a
  consumer with `x.RegisterIntegrationEventConsumer<TEvent>()` and never spells out the
  `IntegrationEventConsumer<T>` MassTransit type, so the registration call site stays decoupled from
  the concrete consumer. `[Rubric §13, Observability & Operability]`: the doc comment
  (`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:21-28`) explains why a
  **fault consumer** is registered alongside by default. MassTransit publishes a `Fault<TEvent>`
  message whenever a consumer exhausts its retry policy, and with nothing subscribed to that topic the
  only trace of an undelivered event is a row in the broker's `_error` queue that no dashboard is
  watching. The fault consumer subscribes to it and emits one Error log plus a `broker.fault.count`
  metric.
- **Walkthrough**: the `extension(IBusRegistrationConfigurator x)` block opens at
  `IntegrationEventConsumerExtensions.cs:14`.
  - `RegisterIntegrationEventConsumer<TEvent>(bool registerFaultConsumer = true)`
    (`IntegrationEventConsumerExtensions.cs:38-50`), constrained
    `where TEvent : class, IIntegrationEvent` (`IntegrationEventConsumerExtensions.cs:40`), calls
    `x.AddConsumer<IntegrationEventConsumer<TEvent>>()`
    (`IntegrationEventConsumerExtensions.cs:42`), conditionally adds
    `FaultIntegrationEventConsumer<TEvent>` (`IntegrationEventConsumerExtensions.cs:44-47`), and
    returns the configurator for chaining (`IntegrationEventConsumerExtensions.cs:49`). The opt-out
    exists for an event whose faults a host routes itself, so two consumers do not compete for the
    same fault topic (parameter doc, `IntegrationEventConsumerExtensions.cs:31-37`).
  - `RegisterUpcastedIntegrationEventConsumer<TEvent>(bool registerFaultConsumer = true)`
    (`IntegrationEventConsumerExtensions.cs:78-90`) is the same shape but registers
    [`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent)
    (`IntegrationEventConsumerExtensions.cs:82`) for a **retired** contract: it upcasts each message to
    its terminal successor and delegates to the handlers registered for THAT contract, so handlers only
    ever have to exist for the newest contract
    ([ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)). Its doc
    (`IntegrationEventConsumerExtensions.cs:52-77`) is a small operations manual for a contract
    migration: pair it with `services.AddEventUpcaster<TEvent, TNew, TUpcaster>()` and a plain
    `RegisterIntegrationEventConsumer<TNew>()`; do **not** also register the plain consumer for the
    retired type, because two consumers on one event compete for the same queue and would run the
    handlers twice (`IntegrationEventConsumerExtensions.cs:61-63`). With no upcaster registered it
    degrades to ordinary handler dispatch on the original type, which is what makes the registration
    safe to add before the upcaster exists and safe to leave in place for one release after it is
    deleted (`IntegrationEventConsumerExtensions.cs:65-70`).
  - `RegisterOutputCacheEvictionConsumer(bool registerFaultConsumer = true)`
    (`IntegrationEventConsumerExtensions.cs:108-110`) is a one-line delegation to the generic method
    closed over [`OutputCacheEvictionRequested`](#outputcacheevictionrequested). It exists purely so
    the wiring reads as an intention rather than a type argument
    (`IntegrationEventConsumerExtensions.cs:92-96`), and its doc pairs it with
    `services.AddOutputCacheEvictionHandler()` from MMCA.Common.API: registering the consumer without
    the handler is harmless but pointless, because the messages are acked with a "no handler
    registered" log and nothing is evicted (`IntegrationEventConsumerExtensions.cs:97-102`).
- **Why it's built this way**: each service host's `Program.cs` calls one of these per integration
  event type it consumes. Hiding `AddConsumer` keeps the host from coupling to the concrete consumer
  type, and the transport-boundary fitness rule enforces that Application and Domain never reference
  MassTransit at all
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:7`;
  [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). Defaulting the
  fault consumer to *on* means the safe posture is the one you get by not thinking about it,
  `[Rubric §15, Best Practices & Code Quality]`.
- **Where it's used**: inside the `configureConsumers` callback passed to `AddBrokerMessaging`
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:779`) in each broker-mode service's
  `Program.cs`, for example `x.RegisterIntegrationEventConsumer<SpeakerLinkedToUser>()`.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxMessage
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:15` · Level 9 · class (public sealed)

- **What it is**: a row in an `OutboxMessages` table: a JSON-serialized domain event persisted **in the
  same database transaction as its aggregate**, ready for reliable asynchronous dispatch, plus all the
  bookkeeping the processor needs (retry state, claim lease, trace context, ordering key).
- **Depends on**: [`IDomainEvent`](#idomainevent) and
  [`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey) (G02),
  [`EventNameResolver`](#eventnameresolver); BCL `System.Text.Json`, `System.Diagnostics.Activity`
  (trace capture) and `System.Collections.Concurrent` (the type cache).
- **Concept introduced, the Transactional Outbox pattern.** `[Rubric §6, CQRS & Event-Driven]`
  (reliable at-least-once delivery), `[Rubric §8, Data Architecture]` (the event is written in the same
  transaction as the aggregate) and `[Rubric §29, Resilience & Business Continuity]` (the delivery
  guarantee survives a crash).
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) is the governing
  decision. The problem it solves: if you save an aggregate and *then* publish an event, a crash
  between the two loses the event. The fix is to write the event to an `OutboxMessages` row in the
  **same database transaction** as the aggregate change; the [`OutboxProcessor`](#outboxprocessor)
  then reads unprocessed rows and dispatches them, re-dispatching after a crash (at-least-once). Each
  service owns its own outbox table
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), so there is no
  cross-service race.
- **Walkthrough**
  - Static `SerializerOptions` (`OutboxMessage.cs:17-20`), a `JsonSerializerOptions` with
    `ReferenceHandler.IgnoreCycles`, so an event referencing a cyclic entity graph still serializes; the
    same instance is reused on the read side (line 137) so payloads round-trip symmetrically.
  - Static `EventTypeCache` (`OutboxMessage.cs:28`), a `ConcurrentDictionary<string, Type?>` keyed
    ordinally by the **stored** name, memoizing the reflection that `DeserializeEvent` would otherwise
    run per row. An unresolvable name caches as `null` (lines 21-26), so a poison payload's resolution
    is not retried on every poll.
  - **Identity and payload** (`OutboxMessage.cs:31-44`): `Id` (`Guid`, defaulted to `Guid.NewGuid()`,
    line 30); `EventType` (`required`, the stored identity, line 37); `Payload` (`required`, the JSON
    string, line 40); `OccurredOn` (the business timestamp copied from `IDomainEvent.DateOccurred`, line
    43). All `init`-only. `EventType` is documented as the `EventNameAttribute` name when the event
    declares one and the assembly-qualified type name otherwise (lines 32-36).
  - **Processing state** (`OutboxMessage.cs:47-68`), deliberately *settable* because the processor
    mutates it: `ProcessedOn?` (null until dispatched, line 46); `RetryCount` (line 49); `LockedUntil?`
    (line 57) and `LockToken?` (line 64); `LastError?` (line 67).
  - **The claim lease** is the part worth slowing down for. `LockedUntil` is the UTC timestamp until
    which the row is leased to one processor replica, and its doc states the consequence plainly: rows
    with an unexpired lease are skipped by other replicas' polls, making scale-out safe by construction,
    where before the lease two replicas could drain the same rows and double-dispatch every event
    (lines 51-56). `LockToken` is the claim token written together with the lease, so the claiming
    replica processes only rows carrying **its own** token, which is what stops a race between two claim
    updates from handing the same row to both (lines 59-63).
  - **Trace context** (`OutboxMessage.cs:71-74`): `TraceId?`/`SpanId?`, W3C ids captured at write time
    and `init`-only, so a trace can be resumed across the asynchronous hop.
  - **Ordering key** (`OutboxMessage.cs:86`): `OrderingKey?`, copied from an event implementing
    [`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey). Its doc gives the
    invariant the processor enforces (lines 75-84): a row carrying a key is not claimed while an
    earlier unprocessed, non-dead-lettered row with the same key exists in the same data source, so
    events for one aggregate reach the bus in the order they were raised, across batches and across
    replicas, with the head-of-line blocking that implies.
  - **`FromDomainEvent(IDomainEvent)`** (`OutboxMessage.cs:99-118`), the static factory. It null-guards
    the event (line 100), captures `Activity.Current` (line 103), resolves the stored name through
    [`EventNameResolver.GetStorageName`](#eventnameresolver) (line 106), serializes against the
    *runtime* type (line 107), and copies the ordering key with `(domainEvent as IHasOrderingKey)?`
    (line 115). The comment above that cast is the subtle bit (lines 112-114): the interface test cannot
    be replaced by a type-level flag, because an implementing event returning `null` opts *that one
    instance* out of ordered delivery.
  - **`DeserializeEvent()`** (`OutboxMessage.cs:130-139`) resolves the type (line 131), returns `null`
    rather than throwing when it cannot (lines 132-133) so the processor can dead-letter the row instead
    of crashing, and otherwise deserializes with the shared options (line 137).
  - **`ResolveEventType()`** (`OutboxMessage.cs:147-153`) is a two-step lookup behind the cache, and
    the comment says the order is load-bearing (lines 147-149): `Type.GetType` runs **first** so a row
    storing an assembly-qualified name resolves by a direct lookup, and the attribute scan
    ([`EventNameResolver.FindTypeByDeclaredName`](#eventnameresolver)) only runs for a stored name that
    is not a CLR name.
- **Why it's built this way**: persisting events in the same transaction, not after it, is the only way
  to guarantee no event is lost. JSON keeps rows human-readable for debugging; the stored identity
  enables polymorphic deserialization; the per-name type cache keeps the hot poll path off reflection;
  `TraceId`/`SpanId` let traces span the asynchronous hop; and the lease pair moves scale-out safety
  from a deployment convention (`minReplicas: 1`) into the data model. The EF configuration completes
  the picture
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:528-563`):
  table `dbo.OutboxMessages` (line 531), bounded columns for `EventType` (500, non-Unicode, line 533),
  `LastError` (4000, line 535) and `OrderingKey` (200, line 538), and three **filtered** indexes, each
  with its reason written above it: `IX_OutboxMessages_Pending` (line 545) whose included `RetryCount`
  and `LockedUntil` let the poll's filter columns ride along without a key lookup,
  `IX_OutboxMessages_Processed` (line 552) so the six-hourly retention sweep does not scan the largest
  partition of the table, and `IX_OutboxMessages_Ordering` (line 562) keyed on
  `(OrderingKey, OccurredOn)` and filtered to keyed pending rows, so the claim's predecessor test is a
  seek and a host that never declares an ordering key carries an empty index.
- **Where it's used**: written by the `SaveChanges` capture in
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  (`DomainEventSaveChangesInterceptor.cs:244`), by [`InProcessEventBus`](#inprocesseventbus)
  (`InProcessEventBus.cs:89`) and by [`BrokerEventBus`](#brokereventbus) (`BrokerEventBus.cs:81`);
  read, claimed and dispatched by the [`OutboxProcessor`](#outboxprocessor); marked processed in bulk
  by [`OutboxFinalizer`](#outboxfinalizer); listed and replayed by
  [`OutboxAdministration`](#outboxadministration); purged by
  [`OutboxCleanupService`](#outboxcleanupservice).
- **Caveats / not-in-source**: an event that has **not** adopted
  [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) stores its
  assembly-qualified name, so a rename or assembly move makes `Type.GetType` return null for rows
  already written, the null caches, and the row dead-letters with reason `type_unresolvable` after the
  processor's one retry.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### BrokerEventBus
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:31` · Level 13 · class (public sealed)

- **What it is**: the [`IEventBus`](#ieventbus) implementation for **microservice (broker)
  deployments**. It persists integration events to the outbox and signals the
  [`OutboxProcessor`](#outboxprocessor) to drain them, but it deliberately does **not** dispatch
  in-process, because the consumers live in other processes
  (`MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:12-17`).
- **Depends on**: [`IEventBus`](#ieventbus) (Level 2),
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IOutboxSignal`](#ioutboxsignal),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver), and
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`, all through
  the primary constructor (`BrokerEventBus.cs:31-35`); it produces
  [`OutboxMessage`](#outboxmessage) rows from [`IIntegrationEvent`](#iintegrationevent) instances.
- **Concept introduced, the broker half of dual-mode event publishing.**
  `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §8, Data Architecture]` (the transactional outbox), and
  `[Rubric §29, Resilience & Business Continuity]`. The doc comment
  (`BrokerEventBus.cs:18-29`) is explicit that this class differs from
  [`InProcessEventBus`](#inprocesseventbus) only in whether it dispatches synchronously after
  persistence: in-process mode writes the outbox, dispatches, then marks processed
  (`BrokerEventBus.cs:23`), while broker mode writes the outbox, signals the processor, and returns
  (`BrokerEventBus.cs:24`). In broker mode an in-process dispatch would be *incorrect*, since no
  consumer is present locally, so the processor's broker-publish path is the only correct delivery
  channel (`BrokerEventBus.cs:26-28`).
- **Walkthrough**: both public overloads funnel into the private `PublishBatchAsync`. The single-event
  overload (`BrokerEventBus.cs:38`) null-guards and wraps the event in a one-element array
  (`BrokerEventBus.cs:42`); the batch overload (`BrokerEventBus.cs:46`) null-guards, coerces the
  sequence to an array exactly once (`BrokerEventBus.cs:50`), and returns early when it is empty
  (`BrokerEventBus.cs:51-52`). `PublishBatchAsync` (`BrokerEventBus.cs:65-91`) resolves the outbox's
  logical data source through
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver)
  (`BrokerEventBus.cs:67`) and gets its context (`BrokerEventBus.cs:68`). If `!context.SupportsOutbox`
  (`BrokerEventBus.cs:70`, Cosmos for example) it throws an `InvalidOperationException` naming the
  misconfigured `Outbox:DataSource` and `Outbox:DatabaseName` rather than silently dropping the events
  (`BrokerEventBus.cs:75-76`, with the rationale at `BrokerEventBus.cs:72-74`). Otherwise it builds one
  [`OutboxMessage`](#outboxmessage) per event through `FromDomainEvent`
  (`BrokerEventBus.cs:79-81`), `AddRange`s them (`BrokerEventBus.cs:84`, with a `VSTHRD103`
  suppression because EF's synchronous `AddRange` is intentional here,
  `BrokerEventBus.cs:83` and `BrokerEventBus.cs:85`), saves **once** (`BrokerEventBus.cs:86`), and
  calls `outboxSignal.Signal()` (`BrokerEventBus.cs:90`) to wake the processor immediately instead of
  waiting for the next poll.
- **Why it's built this way**: the one-save shape is the load-bearing detail, and the method's own doc
  explains it (`BrokerEventBus.cs:57-64`). A per-event save-and-signal loop cost a round trip per event
  and, worse, was not atomic: a failure partway through a batch left the earlier events committed and
  the rest unwritten, so a caller that saw a failure could not tell what had already been published.
  One save makes the batch all-or-nothing, and one signal is all the processor can consume anyway,
  because [`IOutboxSignal`](#ioutboxsignal) caps at a single permit and discards the surplus (see
  [`OutboxSignal`](#outboxsignal)). Beyond that, it enforces the transactional-outbox invariant of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) (persist atomically,
  publish later), while [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) motivate keeping
  delivery entirely on the asynchronous broker path once a module is extracted. Throwing on a
  non-outbox data source makes the "broker mode needs an outbox-enabled store" constraint fail loudly
  at the first publish rather than lose events quietly, and the same constraint is checked once at
  startup as well: `EnsureOutboxAvailableForProvider` rejects `MessageBus:EnableOutbox=false` under a
  broker transport with a message that names this class as the reason
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:763`,
  `DependencyInjection.cs:857-862`).
- **Where it's used**: registered as the scoped `IEventBus` when `AddBrokerMessaging` runs, replacing
  [`InProcessEventBus`](#inprocesseventbus)
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:791`, with the explanatory comment at
  `DependencyInjection.cs:773-776`). Every `IEventBus` injection in application code resolves this
  implementation in broker mode.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### InProcessEventBus
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:33` · Level 13 · class (public sealed)

- **What it is**: the **default** [`IEventBus`](#ieventbus) implementation. When the outbox is on it
  persists integration events to the outbox, dispatches them in-process through
  [`IDomainEventDispatcher`](#idomaineventdispatcher), and marks the rows processed; when the outbox
  is off it dispatches only (`MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:12-17`).
- **Depends on**: [`IEventBus`](#ieventbus) (Level 2),
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDomainEventDispatcher`](#idomaineventdispatcher),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`, an optional
  `TimeProvider`, and an optional
  `IOptions<`[`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)`>`, all
  through the primary constructor (`InProcessEventBus.cs:33-39`); it also uses
  [`OutboxMessage`](#outboxmessage) and [`OutboxFinalizer`](#outboxfinalizer).
- **Concept, the monolith half of dual-mode event publishing, and an explicit outbox opt-out.**
  `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §8, Data Architecture]`: the "persist to outbox in
  the same save, then dispatch, then mark processed" sequence is exactly the dual dispatch of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html), and a dispatch failure
  leaves every entry in the batch **unprocessed** so the [`OutboxProcessor`](#outboxprocessor) retries
  it (method doc, `InProcessEventBus.cs:65-69`). The second half of that doc
  (`InProcessEventBus.cs:70-74`) is the part to read carefully: with the outbox turned off
  (`MessageBus:EnableOutbox=false`) the direct-dispatch branch is taken instead, which means no rows,
  no save, and no processor to retry. That is the **in-process default**:
  `MessageBusSettings.IsOutboxEnabled` resolves an unset `EnableOutbox` from the provider, ON for a
  broker and OFF for `InProcess`
  (`MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:151`,
  `MessageBusSettings.cs:159`), on the reasoning that a single-process application dispatches every
  event in the same process anyway. A monolith that wants at-least-once delivery across a crash sets
  `MessageBus:EnableOutbox=true` explicitly (`MessageBusSettings.cs:144`).
  `[Rubric §31, Cost/FinOps]` is the quiet counterpart here: store-and-forward that nothing needs
  still costs a table, a save, and a poller.
- **Walkthrough**
  - Two readonly fields resolve the optional dependencies: `_timeProvider` falls back to
    `TimeProvider.System` (`InProcessEventBus.cs:41`), and `_outboxEnabled` falls back to `true` when
    no `MessageBusSettings` options are registered (`InProcessEventBus.cs:43`). Both defaults are
    documented as compatibility choices (`InProcessEventBus.cs:28-32`): a host that resolves no
    options, and any test constructing this type directly, keeps the outbox path, so the opt-out is
    only ever taken because configuration asked for it.
  - Both public overloads funnel into the private `PublishBatchAsync` (`InProcessEventBus.cs:76`): the
    single overload wraps one event (`InProcessEventBus.cs:50`), and the batch overload coerces the
    sequence to an array once and returns early when empty (`InProcessEventBus.cs:58-60`).
  - `PublishBatchAsync` resolves the outbox target (`InProcessEventBus.cs:78`) and its context
    (`InProcessEventBus.cs:79`). If `!context.SupportsOutbox || !_outboxEnabled`
    (`InProcessEventBus.cs:81`) it dispatches directly with **no** outbox persistence and returns
    (`InProcessEventBus.cs:83-84`).
  - Otherwise it builds one [`OutboxMessage`](#outboxmessage) per event
    (`InProcessEventBus.cs:87-89`), `AddRange`s them (`InProcessEventBus.cs:92`, with the same
    intentional-synchronous-`AddRange` suppression at `InProcessEventBus.cs:91` and
    `InProcessEventBus.cs:93`), saves data plus outbox in one call (`InProcessEventBus.cs:94`),
    dispatches in-process (`InProcessEventBus.cs:96`), and marks the batch processed with a single
    set-based update through [`OutboxFinalizer.MarkProcessedAsync`](#outboxfinalizer)
    (`InProcessEventBus.cs:98`), passing the injected `TimeProvider` so the `ProcessedOn` stamp is
    testable.
- **Why it's built this way**: writing the outbox row and the aggregate change in one
  `SaveChangesAsync` closes the dual-write gap, and dispatching immediately afterward gives synchronous
  in-process reactions without giving up the durable retry path. Finishing through
  [`OutboxFinalizer`](#outboxfinalizer) rather than a second full save keeps the hottest write path
  down to one extra statement, `[Rubric §12, Performance & Scalability]`. The `SupportsOutbox` fast
  path keeps the framework usable on a store without an outbox table (dispatch-only) rather than
  failing, which is the deliberate opposite of the choice
  [`BrokerEventBus`](#brokereventbus) makes: with no local consumers, a silent dispatch-only fallback
  in broker mode would drop the event entirely, so that class throws instead.
- **Where it's used**: the default scoped `IEventBus` registration
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:564`), superseded by
  [`BrokerEventBus`](#brokereventbus) once `AddBrokerMessaging` is called
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:791`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.


---
[⬅ Querying: Specifications, Filtering & the Entity Query Service](group-03-querying-specifications.md)  •  [Index](00-index.md)  •  [CQRS: Commands, Queries & the Decorator Pipeline ➡](group-05-cqrs-pipeline.md)
