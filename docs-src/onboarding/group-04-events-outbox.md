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
background services and admin surface, and the swappable in-process/broker buses. Two opt-in
capabilities are built on top of that spine and live here too: outbound **webhooks**, which carry an
integration event to an external subscriber as a signed HTTP POST
([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)), and the
**process-manager** primitive, which drives a long-running process from domain events and timeouts
([ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html)).

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
with cycle-ignoring options, resolving its stored `EventType` through `EventNameResolver`, capturing
the current W3C trace and span IDs, and copying the caller's ambient
[`OutboxOrigin`](#outboxorigin) (user, roles, permission claims, tenant, correlation id) onto the row
(`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:149-173`). Those
[`OutboxMessage`](#outboxmessage) rows are `Add`ed to the *same* `DbContext`, so the outbox row and the
aggregate change land in **one atomic transaction**
(`MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:268-288`).
This is the single most important guarantee in the chapter: if the business data committed, the event
is durably recorded; if the transaction rolled back, neither exists. There is no window where they
disagree. `[Rubric §8, Data Architecture]` (transactional integrity) and `[Rubric §6]` both hinge on
this atomicity. Crucially, the rows go to the same physical database as the aggregate: every
relational source owns its own `OutboxMessages` table, never a shared one
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html); the table, its origin
columns, and its three filtered indexes, pending, processed, and ordering, are configured in
`MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:816-873`, with the inbox's
table and unique index at `ApplicationDbContext.cs:721-731`; see the
[primer on database-per-service](00-primer.md#2-architectural-styles-this-codebase-commits-to)).

Two details of the capture exist to stop *duplicate* rows. The interceptor snapshots exactly the events
it captured and removes exactly those again after dispatch, so anything a handler raises mid-dispatch
survives to a later capture instead of being wiped
(`DomainEventSaveChangesInterceptor.cs:424`). And a save that started but never completed (a failed
save followed by an execution-strategy retry) has its still-Added outbox rows detached before the next
capture, so the retry does not write a second row per event
(`DomainEventSaveChangesInterceptor.cs:230,338`).

## The routing split: local events dispatch in-process, integration events wait for the bus

Here is the detail that most people get wrong, and it is the heart of the design. After the
transaction commits (`SavedChanges`), the interceptor does **not** treat all captured events the same.
Pure **domain** events (the *local* events) are dispatched in-process through
[`IDomainEventDispatcher`](#idomaineventdispatcher) and their outbox rows are then marked processed.
**Integration** events are deliberately *not* dispatched in-process at all: their outbox rows stay
unprocessed, and the background [`OutboxProcessor`](#outboxprocessor) later publishes them through
[`IMessageBus`](#imessagebus), so the registered transport (in-process for the monolith, broker for an
extracted service) decides delivery (`DomainEventSaveChangesInterceptor.cs:274-286,369-381`). That
routing is what makes `AddDomainEvent(someIntegrationEvent)` broker-correct: without it, such an event
would be dispatched locally and marked processed, silently never reaching the wire. On the asynchronous
save path the local rows are also inserted already **leased**: each save stamps them with a
`LockedUntil` of `LeaseSeconds` ahead under a fresh `LockToken`, so the processor cannot claim a local
row while its in-process dispatch is still running (`DomainEventSaveChangesInterceptor.cs:98,280,304-315`,
`OutboxSettings.cs:80-90`); the synchronous path never dispatches in-process, so its rows go in unleased
(`DomainEventSaveChangesInterceptor.cs:108`). When the context
has no outbox table (Cosmos) *or* the host turned the outbox off, the interceptor falls back to
dispatching *everything* in-process, since nothing would carry integration events to a processor
anyway (`DomainEventSaveChangesInterceptor.cs:64,292-298`). One more subtlety: when the save runs inside
a Transactional command's transaction, all this post-save work is *deferred until after commit*
(`DomainEventSaveChangesInterceptor.cs:358`), flushed by
[`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) once the commit succeeds and
dropped on rollback, so handler side effects never act on state that could still roll back.

The mark-processed step is not a second nested `SaveChanges`. It goes through
[`OutboxFinalizer`](#outboxfinalizer), which stamps every row in the batch with a single set-based
`ExecuteUpdate` and then re-syncs the change tracker (original value first, then clearing `IsModified`)
so a later save does not re-issue the statement
(`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxFinalizer.cs:27-54`), keeping the hottest write
path (every event-raising command) free of an extra full save. The `ProcessedOn` stamp comes from an
injected `TimeProvider`, so a test's fake clock moves it together with the processor's lease, backoff,
and retention arithmetic (`OutboxFinalizer.cs:21-25,36`). Its sibling `ReleaseLeaseAsync` is the failure
path: when in-process dispatch throws, the interceptor clears the lease on that save's local rows,
guarded by the save's own token so a row a processor has since claimed is left alone, and then signals
the processor, which can take the rows once the processing delay has elapsed instead of waiting out the
full lease (`OutboxFinalizer.cs:57-98`, `DomainEventSaveChangesInterceptor.cs:383-394,402-422`). That
release is best effort: a failure there is logged and the rows simply wait out the lease.

The dispatcher itself
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

## Who the delivery runs as: the captured origin

A delivered event runs a poll cycle later, on another thread and possibly in another process, so
without help it would run as an anonymous, tenant-less system call: a handler reading
`ICurrentUserService` would see nobody, its writes would carry the system audit sentinel, a
shared-database host would read across tenants, and the delivery could not be joined back to the
interaction that produced it. [`OutboxOrigin`](#outboxorigin) is the record struct that closes that
gap: four positional values (user id, roles as a comma-separated list, tenant id, correlation id,
`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxOrigin.cs:30-34`) plus the user's permission
claims as a JSON array, carried as an `init` property rather than a fifth parameter so the shipped
constructor is unchanged (`OutboxOrigin.cs:35-40`). It is deliberately the
mirror of [`InternalCommandOrigin`](group-07-persistence-ef-core.md#internalcommandorigin) so the two
background hops capture the same values through the same helper and cannot drift
(`OutboxOrigin.cs:14-16`). It carries no trace context, because [`OutboxMessage`](#outboxmessage)'s
`TraceId`/`SpanId` already do and are stamped from the ambient `Activity` rather than from a scope
(`OutboxOrigin.cs:16-18`). A `default` value means "nothing was captured", which is exactly what a
seeder, a design-time write, or a row written before these columns existed reads back as
(`OutboxOrigin.cs:20-24`); `FromDomainEvent`'s `origin` parameter is defaulted for the same reason, so
a caller with nothing to capture keeps the single-argument call it always made
(`OutboxMessage.cs:149`).

Capture is one read per save, not one per event. The interceptor is a singleton and cannot reach a
scoped service, so [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) attaches a
live accessor to the scoped context (`DbContextFactory.cs:156-158`) and the interceptor reads it once
through `CurrentOutboxOrigin` (`ApplicationDbContext.cs:158,164`,
`DomainEventSaveChangesInterceptor.cs:268`); the two event buses do the same once per batch
(`InProcessEventBus.cs:91`, `BrokerEventBus.cs:81`). One save is one scope's work, so every row
of that save carries the same origin by construction. The values land on five nullable columns of the
row (`OutboxMessage.cs:104-131`): tenant, roles, and correlation id are mapped with explicit widths, while
the permissions column is unbounded and never truncated (`OutboxMessage.cs:124`,
`ApplicationDbContext.cs:682-689`).

Restore is per row, immediately before delivery, and on a scope of the row's own. The processor creates
a FRESH DI scope for each row, for the batch's target, and hands the row's five values to the shared
[`AmbientOrigin`](group-14-module-system-composition.md#ambientorigin) helper, which writes them onto
that scope before the payload is even deserialized, stamping the rebuilt identity with an `Outbox`
authentication type (`OutboxProcessor.cs:568`). A fresh scope is what lets the tenant change
between rows of one shared-target batch, since the tenant context refuses a change once resolved, and it
means one row's identity can never answer for another's; the cycle scope's context still holds the
claimed rows and writes the lease renewals and the outcomes, so only delivery moves to the row scope
(`OutboxProcessor.cs:490-492`). The
in-process path then gets the right ambient context for free, and on the broker path
[`BrokerMessageBus`](#brokermessagebus) reads those same scoped services back out to stamp tenant,
user, roles, permissions, and correlation headers on the outgoing message, collecting only values that are actually
present so an absent header keeps meaning "the publisher had nothing to say" rather than becoming a
false answer (`BrokerMessageBus.cs:126-154`). On the far side,
[`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) applies the mirror step through
`ConsumerOriginRestore` *before* the inbox is touched, because under database-per-tenant the restored
tenant is what routes the store to the right database, and a message from an older publisher carries no
headers and restores nothing (`IntegrationEventConsumer.cs:76`, the helper itself in
[G14](group-14-module-system-composition.md#consumeroriginrestore)). The restore handle stays open for
the whole consume, so a handler that opens its own scope from the root factory still runs as the
publisher's origin (`IntegrationEventConsumer.cs:76`). The identity rebuilt from those
headers is stamped with an `IntegrationEvent` authentication type, which is what makes it count as
authenticated and names the hop it came back from (`IntegrationEventConsumer.cs:51`). One mechanism
therefore carries the authorization principal, the audit stamps, the tenant routing, and the
correlation id across both asynchronous hops: `[Rubric §17, Security & Compliance]` and
`[Rubric §13, Observability & Operability]` at the same time.

## The safety net: how the processor schedules itself

The [`OutboxProcessor`](#outboxprocessor) is a `BackgroundService` and the most intricate type in the
group; most of its complexity is about **not** wasting work. It exists because the steps between
*commit* and *mark-processed* can be interrupted: the process can crash, or in-process dispatch can
throw. When that happens the row stays unprocessed (and the interceptor releases its lease and signals
the processor on its failure path, `DomainEventSaveChangesInterceptor.cs:383-394`) and the processor
catches it on a later cycle. This is the **at-least-once** guarantee of
[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html). Its unavoidable cost is
that the *same* event may be delivered more than once, so **handlers must be idempotent**. That is not
a wart; it is the documented contract and a healthy discipline regardless.

The processor never blindly polls on a fixed clock. Its loop is the shared `PollingLoop`
(`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:124-136`): after a five second startup delay
(`MMCA.Common.Infrastructure/Persistence/Polling/PollingLoop.cs:18,59`) it drains every outbox
**target** once per cycle and aggregates the per-target results into an
[`OutboxCycleResult`](#outboxcycleresult) (`OutboxProcessor.cs:171`), then waits on
[`IOutboxSignal`](#ioutboxsignal) for whichever comes first: a **signal** (a writer called `Signal()`
after persisting a row; [`OutboxSignal`](#outboxsignal) is a thin wrapper over the shared `WakeUpSignal`,
a `SemaphoreSlim(0, 1)` whose single-permit cap deliberately absorbs a burst of surplus signals, since
one batch drains everything anyway,
`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxSignal.cs:10-23`,
`MMCA.Common.Infrastructure/Persistence/Polling/WakeUpSignal.cs:18-30`), the moment the earliest
pending-but-not-yet-eligible row *becomes* eligible (the **smart wait**), or the fallback
`PollingIntervalSeconds` (`PollingLoop.cs:94`, arithmetic in `ComputeWaitTime` at
`PollingLoop.cs:117-130` with a one second floor so an overdue row cannot hot-loop the service,
`PollingLoop.cs:21`). A target is one owned relational source against the shared database, plus one
extra unit per tenant that keeps its own copy of a source, because a tenant database has its own
`OutboxMessages` table that nothing else would ever open; the processor asks the injected
`FrameworkTableTargets` for that list (`OutboxProcessor.cs:66,161`). Each target is visited in its
own DI scope with the tenant set before the context is asked for, since the tenant is what routes the
factory to the right database (the same per-target scoping the admin surface documents,
`OutboxAdministration.cs:22-24`).

Rows are eligible `ProcessingDelaySeconds` after creation, and that delay defaults to `0` (range 0 to
600), so an integration event is published as soon as the post-save signal wakes the processor, tens of
milliseconds after the save ([`OutboxSettings`](#outboxsettings), `OutboxSettings.cs:33-45`). The fetched
batch is split against a cutoff computed once per cycle (`OutboxProcessor.cs:206,221`, fetch at
`OutboxProcessor.cs:311-320`). That delay sets eligibility only; the property's own remarks are explicit
that it does *not* bound the duplicate-dispatch window, because local rows of an asynchronous save are
inserted under the `LeaseSeconds` lease, so the in-process pipeline (save, dispatch, mark processed)
races the processor only once that lease expires, and handlers must be idempotent regardless. A host
raises it only to hold rows back deliberately, for example to give a failed in-process local dispatch a
pause before the processor retries it (`OutboxSettings.cs:36-43`). The smart wait means that even
when the fallback interval is raised in a deployed environment (the default is 2s and the property's
own remarks name 300 as the deployed value to cut idle polling, `OutboxSettings.cs:23-31`), a signalled
event still goes out promptly and a held-back row goes out as soon as its delay elapses. Batches are 50
rows (`OutboxSettings.cs:17`). One
unreachable database cannot starve the others: the targets are drained through the shared
`PollingLoop.DrainAllAsync` with a per-source error callback, and a failing target simply contributes
nothing (and zero backlog) to this cycle (`OutboxProcessor.cs:171`).

## Claiming, scale-out, and ordered delivery

Because a deployment may run more than one replica, each cycle **claims** its eligible prefix with a
lease (`LockedUntil` plus `LockToken`,
`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:54-67`) via a conditional
`ExecuteUpdate` before dispatching (`OutboxProcessor.cs:372-376`), and the poll query skips rows under
an unexpired lease (`OutboxProcessor.cs:311-320`). Two replicas therefore can never double-dispatch the
same row, and a replica that dies mid-batch releases its rows when the lease expires (`LeaseSeconds`,
default 300, `OutboxSettings.cs:90`). When the claim comes back partial, the processor works only the
ids that carry *its own* token. That is scale-out
safety by construction, not merely by the `minReplicas: 1` deployment convention. The claim is not the
end of it, because one lease covers the whole batch and a slow batch could outlive it: before each row
the remaining lease is checked against the clock, and once less than half of `LeaseSeconds` is left the
processor flushes its buffered stamps and renews every not-yet-dispatched row of the batch in ONE
statement guarded on the batch's lock token; a row that renewal finds under another token is skipped
(`OutboxProcessor.cs:474-479,547,707`). Outcomes are written two ways. A failed row's retry or
dead-letter state is written, token-guarded, as soon as that row is done (`OutboxProcessor.cs:1015`).
Delivered rows are buffered and stamped processed together, by one guarded set-based update per flush:
at the end of the batch, before a lease renewal, and on every early exit (a shutdown, a failed write)
(`OutboxProcessor.cs:38-41,912`), in chunks small enough to stay under SQL Server's parameter limit
(`OutboxProcessor.cs:89-92`). A replica that lost a row mid-dispatch therefore drops its stale stamp
instead of overwriting the new owner's. A shutdown signalled while a row is in flight still records the
outcomes of the rows already done, under a five second budget of its own
(`OutboxProcessor.cs:102,790,951`); what a crash (or a failed exit flush) costs is the rows delivered
since the last flush, which are redelivered once their lease expires (`OutboxProcessor.cs:44-48`).

The claim is also where **ordered delivery** is enforced. An event that opts in by implementing
[`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey) has its key copied onto the
outbox row at capture (`OutboxMessage.cs:97,172`), and the claim predicate then refuses that row while
any earlier unprocessed, non-dead-lettered row shares the key, expressed as a correlated `NOT EXISTS`
inside the update itself so a racing replica loses on the row rather than on a check made before the
race (`OutboxProcessor.cs:437-451`). Within one cycle, `SelectOrderedCandidates` keeps at most the
first row per key (`OutboxProcessor.cs:357,405`), and a cycle that deferred such key-mates asks for an
immediate re-poll once it delivers anything, rather than serializing a key at one row per polling
interval (`OutboxProcessor.cs:260,359-361`). A batch containing no keyed row skips that predicate
entirely, so hosts that never declare a key pay nothing for the feature
(`OutboxProcessor.cs:372`). The cost is head-of-line blocking, documented on the interface itself:
a retrying keyed row blocks its successors until it succeeds or exhausts its retries, so keys must be
as narrow as the requirement really is (one per aggregate, never a constant).

## Failures, dead-letters, and keeping the table (and telemetry) bounded

Delivery failures split into outcomes worth keeping straight. A *transient* failure (a handler or
broker publish throwing) increments the row's `RetryCount`, records `LastError`, and **re-leases** the
row for an explicit exponential backoff rather than leaving this cycle's claim on it
(`OutboxProcessor.cs:660-661`). The backoff is `RetryBackoffBaseSeconds * 2^(n-1)` (base 10s,
`OutboxSettings.cs:107`) multiplied by a random jitter factor in `[0.8, 1.2]` and capped at the lease
(`OutboxProcessor.cs:1107-1108`, delegating to `PollingLoop.cs:197`); the jitter is what stops fifty rows that failed together on one
dependency outage from retrying in lockstep against that same dependency. The poll query only ever
selects rows with `RetryCount < MaxRetries` (5 by default, `OutboxProcessor.cs:316`,
`OutboxSettings.cs:21`), so once a row exhausts its retries it stops being fetched, stalls unprocessed
with its last error, and is counted on the `outbox.dead_letter.count` counter with
`reason=retries_exhausted` plus one loud `Error` log line at the moment of exhaustion
(`OutboxProcessor.cs:681-689,1197`). A row whose stored `EventType` resolves to nothing is treated more
gently: the FIRST such attempt is retried through the normal backoff with a `Warning`
naming the fix (give the event an `[EventName]`), because the declaring assembly may simply not be
loaded yet; only the second attempt is terminal, and it dead-letters the row rather than marking it
processed (`RetryCount` set to `MaxRetries`, lease cleared, `ProcessedOn` left null), counting it with
`reason=type_unresolvable` (`OutboxProcessor.cs:1065,1080-1097`). The row therefore leaves the poll, so an
undeliverable payload cannot block the queue behind it, yet stays a dead letter an operator can find
and replay. A host configured with `MaxRetries` of 1 gets no retry here either
(`OutboxProcessor.cs:1078-1080`). Bus publishes additionally run inside a **circuit breaker** built from
[`BrokerResilienceDefaults`](group-16-aspire-orchestration.md#brokerresiliencedefaults) and carrying no
retry strategy of its own, since the outbox already owns retry
(`OutboxProcessor.cs:112-113,1111-1125`). The breaker wraps *only* the `IMessageBus` publish of an
integration event: that is the broker hop on a host with broker messaging, but on a monolith the default
`InProcessMessageBus` runs the integration-event handlers inside the breaker, so failing handlers can
open it too. The pure domain-event branch and every database call stay outside it, since a breaker on
those would open exactly when the processor most needs to persist retry state
(`OutboxProcessor.cs:812-821`). An open circuit is reported
as its own fact: one `BrokerMetrics.CircuitOpenCounter` increment per row and one `Warning` per batch
rather than fifty identical lines (`OutboxProcessor.cs:540,669,1203`), and a row skipped by an open
circuit is re-leased for a backoff derived from the breaker's break duration, capped at the lease,
instead of the per-attempt exponential one (`OutboxProcessor.cs:660`, `PollingLoop.cs:219`).

The instruments themselves live in [`OutboxMetrics`](#outboxmetrics), a single OpenTelemetry meter
named `MMCA.Common.Outbox` (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs:19`)
carrying the dead-letter counter (`OutboxMetrics.cs:41-44`), a success counter
(`OutboxMetrics.cs:47-50`), an end-to-end **delivery lag** histogram in seconds, the number that
answers "how far behind is eventual consistency right now" (`OutboxMetrics.cs:57-60`, recorded at
`OutboxProcessor.cs:990`), an observable **backlog depth** gauge
(`OutboxMetrics.cs:75-79`), and an **oldest-pending age** gauge per data source, which is what an alert
on a wedged outbox fires on (`OutboxMetrics.cs:98-102`). Both gauges are per instance, not fleet-wide,
and both are derived from the fetch wherever they can be: the poll is already ordered by `OccurredOn`,
so its first row *is* the oldest (`OutboxProcessor.cs:216,318`), and a short batch *is* the whole
backlog, so only a saturated batch pays for a `COUNT` (`OutboxProcessor.cs:280-292`). This is dense
`[Rubric §13, Observability & Operability]` and `[Rubric §31, Cost/FinOps]` territory: both the poll and
that count run inside a named `OutboxPoll` activity (`OutboxProcessor.cs:78,285,311`) which
[`OutboxPollFilterProcessor`](group-16-aspire-orchestration.md#outboxpollfilterprocessor) (G16)
suppresses from telemetry export, so a fleet of idle services polling around the clock does not flood
Application Insights, and the per-message success line is `Debug` for the same reason
(`OutboxProcessor.cs:1182`). Each dispatched message also re-parents an `OutboxProcess` consumer
activity onto the trace context stored on its row, so the broker hop stays linked to the request that
raised the event. The parent is rebuilt with the row's stored W3C trace flags, the request's sampling
decision, so a parent-based sampler exports the delivery span only when the request itself was sampled,
and a row with no stored flags reads as not sampled (`OutboxMessage.cs:78-85`,
`OutboxProcessor.cs:1136,1152-1156`).

A sibling [`OutboxCleanupService`](#outboxcleanupservice) keeps the tables bounded. Every
`CleanupIntervalHours` (default 6, `OutboxSettings.cs:78`) it purges processed rows older than
`RetentionDays` (default 7, `OutboxCleanupService.cs:60,91`, `OutboxSettings.cs:70`), then purges
*dead-lettered* rows on their own `DeadLetterRetentionDays` window, falling back to `RetentionDays` when
that setting is left at its default of zero (`OutboxCleanupService.cs:160-164`, `OutboxSettings.cs:118`),
since those rows never get a `ProcessedOn` and would otherwise accumulate forever inside the pending
index that every poll re-scans; every dead-letter deletion is logged at `Warning` with its count
(`OutboxCleanupService.cs:26-28,217`). When the inbox is enabled it purges processed inbox rows on the same
cutoff (`OutboxCleanupService.cs:53,189`). Setting `RetentionDays` to `0` disables the sweep entirely
(`OutboxCleanupService.cs:73`). Because payloads may contain personal data, this sweep is also part of
the privacy posture of [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html).
Both background services take an injected `TimeProvider` (`OutboxProcessor.cs:790`,
`OutboxCleanupService.cs:49,57`) so tests can drive an hour-scale loop deterministically instead of
waiting on wall-clock time, a small but real `[Rubric §14, Testability]` win.

Dead letters are not only swept, they are **operable**. [`OutboxAdministration`](#outboxadministration)
is the scoped EF-backed admin surface behind
[`IOutboxAdministration`](group-07-persistence-ef-core.md#ioutboxadministration): it lists dead letters
with merged paging across every target and a hard 500-row page cap
(`MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxAdministration.cs:45,74,83`), counts pending rows
(`OutboxAdministration.cs:280`), and replays dead letters as one set-based `UPDATE` per target followed
by a `Signal()` so the processor picks them up immediately rather than on the next interval
(`OutboxAdministration.cs:138,169,190`). Its fourth operation, `RepublishProcessedAsync`, re-publishes
the integration events processed within a UTC window of at most 7 days: it asks each source for the
distinct stored names in the window, resolves them as the processor would, updates only the names that
resolve to an `IIntegrationEvent`, and signals the processor (`OutboxAdministration.cs:53-63,196-206,273`).
It refuses to run unless the consumer inbox is enabled, because the inbox is what turns a republish into
a harmless duplicate (`OutboxAdministration.cs:34-35,210-214`). It visits the same tenant-expanded targets
in the same per-scope way the two background services do (`OutboxAdministration.cs:16-27`), and its
validation failures come back as [`Result`](group-01-result-error-handling.md#result) errors rather than
exceptions (`OutboxAdministration.cs:48-63`).

## The pluggable transport, and the posture flags that decide it

Here is the boundary that makes a module extractable without rewriting its handlers. Application code
that wants to publish an integration event depends on [`IEventBus`](#ieventbus) (or on the lower-level
[`IMessageBus`](#imessagebus), both defined in `Application`, so neither ever sees a broker client).
Infrastructure supplies two interchangeable implementations of each, selected by registration:

- **Monolith mode** (the defaults, `MMCA.Common.Infrastructure/DependencyInjection.cs:360,366`).
  [`InProcessEventBus`](#inprocesseventbus) writes the events to the outbox in one save, dispatches them
  in-process, and marks them processed through the same [`OutboxFinalizer`](#outboxfinalizer) path as
  the interceptor (`MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:78-104`), falling back to a
  plain dispatch when the context has no outbox support or the host disabled the outbox
  (`InProcessEventBus.cs:81-85`). [`InProcessMessageBus`](#inprocessmessagebus) just hands the event
  straight to the dispatcher (`MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:21-32`); it is
  what the `OutboxProcessor` calls when draining an integration-event row in monolith mode.
- **Broker mode** (`AddBrokerMessaging`, which *replaces* both registrations,
  `DependencyInjection.cs:771,777`). [`BrokerEventBus`](#brokereventbus) writes the whole batch to the
  outbox in ONE save and then **signals the processor without dispatching in-process**
  (`MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:65-94`), because the consumers live in other
  processes, so an in-process dispatch would be wrong; a data source with no outbox support throws
  loudly here rather than silently dropping events (`BrokerEventBus.cs:70-76`). The `OutboxProcessor`
  then drains the row and publishes it through [`BrokerMessageBus`](#brokermessagebus), which serializes
  the event as its **runtime** type and publishes it on that type's topic, so routing binds to the
  concrete event class rather than the `IIntegrationEvent` base interface
  (`MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:58-62,83-87`). The bytes go out through the
  `IBrokerPublisher` of whichever transport `MessageBus:Provider` selects: RabbitMQ and PostgreSQL are
  built in, and a vendor adapter such as `MMCA.Common.Azure` or `MMCA.Common.Aws` registers its own
  (`BrokerMessageBus.cs:14-18,46-51`). The bus starts a Producer span and writes its W3C `traceparent`
  and `tracestate` as message headers, so distributed traces stay connected across the broker hop
  (`BrokerMessageBus.cs:70-81,106-118`).

Whether the outbox exists at all is itself configuration, and it resolves from the transport.
[`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings) exposes
`IsOutboxEnabled` and `IsInboxEnabled`, each defaulting to ON for a broker provider and OFF for
`InProcess` (`MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:136,170`). A single-process
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
architecture transport-boundary rule forbids `Application`/`Domain`/`Shared` from referencing a broker
client at all (RabbitMQ, Azure Service Bus, Amazon SQS and SNS, and MassTransit, which is banned outright)
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:14-23`,
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:7`,
[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). Note the deliberate
division of labor: the **`*EventBus`** types own *outbox persistence* (write and signal); the
**`*MessageBus`** types own *delivery only* and are invoked by the processor when draining
already-persisted rows.

## Consuming from the broker: the inbox and the generic consumer

On the receiving side of a broker hop, application code keeps writing plain
`IIntegrationEventHandler<TEvent>` implementations; there is no broker-specific consumer class to
author per event. The generic [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) is
the single adapter that bridges a broker-delivered `TEvent` to all the registered in-process handlers
(`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:10-17,61`), registered per
event type with `RegisterIntegrationEventConsumer<TEvent>()` on the
[`IBrokerConsumerBuilder`](group-14-module-system-composition.md#ibrokerconsumerbuilder) that the
`configureConsumers` callback of `AddBrokerMessaging` receives
(`MMCA.Common.Infrastructure/Messaging/Broker/IBrokerConsumerBuilder.cs:6-8,26`). Each call adds one
subscription that binds the event's topic to the host's single queue, and registering the same event (or
the same event name) twice throws (`MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:47-62`).
Because a host has one queue, two services consuming the same event never compete for one queue and there
is no per-consumer endpoint configuration; no separate fault consumer is registered either, since a
message that exhausts its in-process retries and its redeliveries is dead-lettered by
[`BrokerReceivePipeline`](group-14-module-system-composition.md#brokerreceivepipeline), which logs it once
at Error and adds one to the `broker.fault.count` counter (`IBrokerConsumerBuilder.cs:9-14`,
`BrokerReceivePipeline.cs:152-176`). Two siblings sit beside it:
`RegisterUpcastedIntegrationEventConsumer<TEvent>()` drains a retired contract through
[`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent)
into the handlers of its successor (`IBrokerConsumerBuilder.cs:29-40`,
[ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)); the builder picks
the closed consumer type from the subscription kind (`BrokerConsumerBuilder.cs:36-45`), and registering
both kinds for one event is exactly the duplicate it rejects (`BrokerConsumerBuilder.cs:51-57`). And
[`IntegrationEventConsumerExtensions`](#integrationeventconsumerextensions) adds
`RegisterOutputCacheEvictionConsumer()`, an `extension(IBrokerConsumerBuilder)` member that is the named
shorthand for the framework's own eviction broadcast, forwarding to
`RegisterIntegrationEventConsumer<OutputCacheEvictionRequested>()`
(`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:13,28-33`). A handler that throws is logged with the
failing handler's type and rethrown, after its staged inbox row is abandoned, so the framework receive
pipeline retries it in a fresh scope (exponential backoff, `MessageBusSettings.RetryLimit` retries) and
then redelivers or dead-letters it (`IntegrationEventConsumer.cs:113-120`), and a message with no registered handler in this
process is acked with a log line rather than being retried forever
(`IntegrationEventConsumer.cs:126`).

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
(`MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:52,68,143`). A handler's own
`SaveChangesAsync` therefore commits the dedup row in the same transaction as its mutations, closing by
construction the window where a crash between "handler committed" and "inbox written" reprocessed the
whole event; `CompleteAsync` saves the staged row only when nothing else already did, which covers
events whose handlers write nothing (`EfInboxStore.cs:78-102`). The consumer calls `Abandon` on a handler
failure so the failed attempt leaves neither a rejected insert on the scope's context nor a row that
would make the redelivery look like a duplicate (`IntegrationEventConsumer.cs:113`, `EfInboxStore.cs:109`).
Concurrent duplicate
deliveries are absorbed by the unique index on `MessageId` (`ApplicationDbContext.cs:724-726`), whichever
save hits it. The dedup key is `EventNameResolver.GetInboxName(...)`, so an unannotated event keeps
matching the rows it already wrote (`IntegrationEventConsumer.cs:82`). When the inbox is disabled the
no-op [`NoOpInboxStore`](#noopinboxstore) is registered so behavior is unchanged
(`MMCA.Common.Infrastructure/Persistence/Inbox/NoOpInboxStore.cs:7-14`, `DependencyInjection.cs:790`).
The outbox is the *producer-side* idempotency mechanism; the inbox is its *consumer-side* mirror.
Together they make the cross-service event flow effectively-once on top of at-least-once transport
(`[Rubric §6]`, `[Rubric §29, Resilience & Business Continuity]`).

## Outbound webhooks: the spine reaching outside the system

Integration events can also leave the system entirely, as signed HTTP POSTs to subscriber URLs
([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)). The feature
is opt-in twice: a host calls `AddWebhooks(configuration)` and sets `Webhooks:Enabled`, which defaults to
false ([`WebhookSettings`](#webhooksettings),
`MMCA.Common.Application/Webhooks/WebhookSettings.cs:5-17`); with it off the fan-out stays inert, every
administration endpoint answers 404 and no context maps the `WebhookSubscriptions` table. Turning it on
also takes `pipeline.AddWebhookDelivery()`, one `AddWebhookEvent<TEvent>(name)` per published event, the
migration on the `Webhooks:DataSourceName` database, and a controller deriving from
[`WebhookSubscriptionsControllerBase`](#webhooksubscriptionscontrollerbase) granted `webhooks:manage`
([`WebhookServiceCollectionExtensions`](#webhookservicecollectionextensions),
`MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:23-39`).

[`WebhookSubscription`](#webhooksubscription) is the aggregate: a target URL plus the webhook types it
lists (or every type), with its signing secret stored as the host's data-protection layer protected it
and returned in plaintext only once, at create or rotate. After a rotation the previous secret keeps
signing beside the new one until it expires, so a receiver can switch without dropping deliveries
(`MMCA.Common.Domain/Webhooks/WebhookSubscription.cs:7-20`; the grace is `PreviousSecretGraceHours`,
default 24, `WebhookSettings.cs:58-60`). Its tenant is a plain column the store filters explicitly, not
an `ITenantEntity` (`WebhookSubscription.cs:21-24`).
[`DataProtectionWebhookSecretProtector`](#dataprotectionwebhooksecretprotector) implements
[`IWebhookSecretProtector`](#iwebhooksecretprotector) under the purpose `MMCA.Common.Webhooks.Secret.v1`;
a multi-replica host needs the shared key ring, and a secret one replica cannot read surfaces as
`Webhooks.SecretUnreadable`, never as an exception
(`MMCA.Common.Infrastructure/Webhooks/DataProtectionWebhookSecretProtector.cs:9-14`). The admin surface,
[`WebhookSubscriptionsControllerBase`](#webhooksubscriptionscontrollerbase), lists, lists the publishable
event types, creates, updates, rotates, disables, enables and deletes, every call scoped to the caller's
tenant, with refusals such as `Webhooks.TargetNotAllowed` (400), `Webhooks.NotFound` (404, also for
another tenant's id) and `Webhooks.LimitReached` (409)
(`MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:12-37`); that limit is
`MaxSubscriptionsPerTenant`, 25 by default and soft under concurrent creates (`WebhookSettings.cs:62-67`).
Behind it sit [`IWebhookSubscriptionService`](#iwebhooksubscriptionservice) /
[`WebhookSubscriptionService`](#webhooksubscriptionservice) and the EF store
[`EFWebhookSubscriptionStore`](#efwebhooksubscriptionstore). A target is checked at registration by
[`DnsWebhookTargetValidator`](#dnswebhooktargetvalidator) (the default
[`IWebhookTargetValidator`](#iwebhooktargetvalidator)), which applies the outbound address policy and,
unless insecure targets are allowed, refuses a host whose DNS answer is empty or contains ANY address
that is not public; that is an early answer for the operator, and the connect-time check stays
authoritative (`MMCA.Common.Infrastructure/Webhooks/DnsWebhookTargetValidator.cs:11-16`).

Delivery rides two pipelines this chapter already described.
[`WebhookFanOutHandler<TEvent>`](#webhookfanouthandlertevent) is an ordinary
[`ScopedIntegrationEventHandlerBase<TIntegrationEvent>`](#scopedintegrationeventhandlerbasetintegrationevent)
subclass registered by `AddWebhookEvent<TEvent>(name)`, so it receives the event through whichever
transport the host runs (`MMCA.Common.Application/Webhooks/Delivery/WebhookFanOutHandler.cs:17-20,35`). It
returns at once unless webhooks are on and [`WebhookEventCatalog`](#webhookeventcatalog) knows the event's
webhook name (`WebhookFanOutHandler.cs:62-67`), lists the enabled subscriptions of the event's tenant that
subscribe to that name, skips with one warning an event whose serialized payload exceeds
`MaxPayloadBytes` (65536 by default), because redelivering it cannot make it smaller
(`WebhookFanOutHandler.cs:69-86`, `WebhookSettings.cs:51-56`), and otherwise schedules one
[`DeliverWebhookInternalCommand`](#deliverwebhookinternalcommand) per matching subscription inside ONE
transaction (`WebhookFanOutHandler.cs:88-115`). The [`WebhookDeliveryId`](#webhookdeliveryid) is derived
from the event's `MessageId` and the subscription id, so a redelivered event schedules rows with an
unchanged `webhook-id`; a failed schedule throws so the outbox or the broker redelivers the event
(`WebhookFanOutHandler.cs:28-31,91,117-120`). Every delivery is therefore an internal-command row, and
its retries and dead-lettering come from the `InternalCommands` settings rather than a webhook-specific
budget (`WebhookSettings.cs:5-10`).

Those rows are drained not by the shared internal-command loop but by
[`WebhookDeliveryLane`](#webhookdeliverylane), a dedicated `InternalCommandLaneProcessor` keyed by
subscription, so a slow or failing receiver cannot delay the other internal commands, a failing
subscription is cooled down on its own, and two deliveries to one subscription never run at once
(`MMCA.Common.Infrastructure/Webhooks/WebhookDeliveryLane.cs:14-20`). The lane sends up to
`DeliveryConcurrency` (default 4) deliveries at once per replica, starts no delivery after
`TimeoutSeconds` (default 10) into a batch, and cools a failed subscription for
`ReceiverCooldownSeconds` (default 60), during which each delivery that comes due spends one attempt
(`WebhookDeliveryLane.cs:29-48`, `WebhookSettings.cs:34,41,49`). It is registered only when both
`Webhooks:Enabled` and `InternalCommands:Enabled` are true (`WebhookDeliveryLane.cs:51-64`).
[`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler) runs each row: it reads
the subscription under the tenant the processor restored for the row, posts the signed envelope, and maps
the outcome onto the subscription's last-outcome columns and onto the row. A 2xx, a 410 and a refused
target complete the row, because retrying cannot change them; everything else fails it so the processor
retries with backoff
(`MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:12-17,73-77`).

[`HttpWebhookSender`](#httpwebhooksender), the default [`IWebhookSender`](#iwebhooksender), sends one POST
through the `MMCA.Webhooks` named client, signed once per readable secret with the current one first,
and maps the outcome from the status code or the exception alone, never reading the response body; a
target that fails the address policy is refused before anything is sent
(`MMCA.Common.Infrastructure/Webhooks/HttpWebhookSender.cs:14-19,33,62`). The signature is the Standard
Webhooks scheme in [`WebhookSignature`](#webhooksignature): a `whsec_`-prefixed secret of 32 random
bytes, the `webhook-id`, `webhook-timestamp` and `webhook-signature` headers, and a `v1,`-prefixed
HMAC-SHA256 over `{id}.{timestamp}.{body}` that a receiver verifies with `Verify` or any Standard Webhooks
library (`MMCA.Common.Application/Webhooks/Delivery/WebhookSignature.cs:8-32`). The client's primary
handler follows no redirect, uses no proxy and keeps no cookies; every host-default handler (a resilience
pipeline, service discovery) is cleared so the internal-command queue is the only retry policy; its
default loggers are removed so the target URL, which often carries the receiver's token, is never logged
by the client stack; and no `traceparent`, `tracestate` or `baggage` header reaches the receiver
(`WebhookServiceCollectionExtensions.cs:41-55`). The authoritative guard against server-side request
forgery is [`WebhookConnectCallback`](#webhookconnectcallback): the client's connect callback resolves the
host itself (through [`IWebhookDnsResolver`](#iwebhookdnsresolver)) and, unless insecure targets are
allowed, throws [`WebhookTargetRefusedException`](#webhooktargetrefusedexception) before opening a socket
when any resolved address is not public, and it never dials an address it did not check, which is what
holds the policy against DNS rebinding
(`MMCA.Common.Infrastructure/Webhooks/WebhookConnectCallback.cs:7-15,48`). The development switch that
allows insecure targets is honored only in a Development environment, decided in one place by
[`WebhookInsecureTargets`](#webhookinsecuretargets) (`WebhookInsecureTargets.cs:6-10`), and
[`InsecureWebhookTargetsNoticeService`](#insecurewebhooktargetsnoticeservice) is the startup notice for
that switch when it is ignored (`WebhookServiceCollectionExtensions.cs:24-27`). This is the
`[Rubric §17, Security & Compliance]` face of the event spine, with its delivery reliability inherited
from the internal-command queue (`[Rubric §29]`).

## Process managers: a long-running process as an aggregate

The spine also drives multi-step processes
([ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html)).
[`ProcessManagerAggregateRoot<TIdentifierType>`](#processmanageraggregateroottidentifiertype) is the base
for an aggregate that IS the state of a process: its own status columns decide every step, and it declares
no property and no field, so deriving from it changes neither the EF model nor any migration snapshot
(`MMCA.Common.Domain/ProcessManagers/ProcessManagerAggregateRoot.cs:5-17`). Its one notion of time is
`GetLastTransitionOn()`, `LastModifiedOn` or else `CreatedOn`, a method rather than a property for that
same reason (`ProcessManagerAggregateRoot.cs:20-31`). Its one decision is `DecideTimeout`, which an
override implements by matching the fired [`ProcessTimeout`](#processtimeout) by name and re-deriving the
due instant from stored state, so a stale or re-armed timeout is a no-op by construction
(`ProcessManagerAggregateRoot.cs:33-44`). A `ProcessTimeout` is a named, strictly positive window measured
from the last transition (`MMCA.Common.Domain/ProcessManagers/ProcessTimeout.cs:3-21`), and the answer is a
[`ProcessTimeoutDecision`](#processtimeoutdecision) built only through its factories, `NotApplicable`
(the default), `NotYetDue(dueAt)`, `Applied`, or `Rejected(errors)` with at least one error, whose
outcome is a [`ProcessTimeoutOutcome`](#processtimeoutoutcome)
(`MMCA.Common.Domain/ProcessManagers/ProcessTimeoutDecision.cs:10-54`).

Steps run on domain events through
[`ProcessDomainEventHandlerBase<TDomainEvent, TProcess, TProcessId>`](#processdomaineventhandlerbasetdomainevent-tprocess-tprocessid),
an `IDomainEventHandler<TDomainEvent>` that opens one scope, runs one transaction on its unit of work,
loads the correlated process tracked, and hands it with a [`ProcessStepContext`](#processstepcontext) to
the subclass's `HandleStepAsync`
(`MMCA.Common.Application/ProcessManagers/ProcessDomainEventHandlerBase.cs:31-71`). The step owns its
saves: the base never calls `SaveChangesAsync`, and the transaction refuses to commit unsaved changes, so
a step that forgets to save fails loudly (`ProcessDomainEventHandlerBase.cs:17-18`). A missing process
leaves the event handled (`ProcessDomainEventHandlerBase.cs:59-63`); a failed `Result` rolls the unit back
and the default `OnStepFailed` throws [`ProcessStepFailedException`](#processstepfailedexception) so the
outbox redelivers the event, unless an override returns normally
(`ProcessDomainEventHandlerBase.cs:21-25,120-124`). The context carries the event's scope, its unit of
work, and the timeout scheduler, which is null unless the host called `AddProcessManagers()`
(`MMCA.Common.Application/ProcessManagers/ProcessStepContext.cs:6-33`).

Timeouts are internal commands, not timers. A step arms one through
[`IProcessTimeoutScheduler`](#iprocesstimeoutscheduler); the default
[`ProcessTimeoutScheduler`](#processtimeoutscheduler) refuses a zero or negative delay with
`ProcessManagers.TimeoutNotInFuture` and otherwise writes one internal-command row due at the injected
clock's now plus the delay, the same clock the handler later decides with
(`MMCA.Common.Application/ProcessManagers/ProcessTimeoutScheduler.cs:6-39`). The row is a consumer-owned
[`IProcessTimeoutCommand<TProcessId>`](#iprocesstimeoutcommandtprocessid)
(`MMCA.Common.Application/ProcessManagers/IProcessTimeoutCommand.cs:5-17`), handled by a sealed subclass of
[`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`](#processtimeouthandlerbasetcommand-tprocess-tprocessid)
that the module scan registers as a closed command handler inside the decorator pipeline
(`MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandlerBase.cs:25-28`). The handler loads the
process tracked, lets it decide against the injected `TimeProvider`, and saves once, only when the timeout
applied (`ProcessTimeoutHandlerBase.cs:49-98`). Every outcome completes the row with success except a save
failure that is not a concurrency conflict, which propagates so the row retries with backoff; a lost
concurrency race means another writer already moved the process
(`ProcessTimeoutHandlerBase.cs:13-19,86-94`). A `NotYetDue` decision completes the row without scheduling
another, so a step that still wants the timeout arms it again and a host keeps a reconciliation sweep for
what no step covers (`ProcessTimeoutHandlerBase.cs:20-24`). Each handled command yields a
[`ProcessTimeoutReport<TProcessId>`](#processtimeoutreporttprocessid) tagged with a
[`ProcessTimeoutHandling`](#processtimeouthandling) value for an `OnHandled` override to log
(`ProcessTimeoutHandlerBase.cs:113-125`). The primitive adds no table and no configuration key (ADR-143);
it is testable because every decision runs against an injected clock (`[Rubric §14, Testability]`) and
correct under redelivery because every decision is re-derived from stored state (`[Rubric §6]`).

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
[`BrokerMessageBus`](#brokermessagebus) to the selected transport's publisher to the broker, then stamps the row processed and
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

### ProcessTimeoutHandling
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandling.cs:4` · Level 0 · enum

- **What it is**: the six outcomes [`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`](#processtimeouthandlerbasetcommand-tprocess-tprocessid) can reach for one fired timeout: `ProcessMissing`, `NotApplicable`, `NotYetDue`, `Applied`, `Rejected`, `LostRace`.
- **Depends on**: nothing first-party.
- **Concept**: an application-layer widening of the aggregate's own verdict. The domain's [`ProcessTimeoutOutcome`](#processtimeoutoutcome) only knows what the aggregate decided; this enum adds the two outcomes only the handler can observe (no process row at all, and a save that lost a concurrency race). `[Rubric §13, Observability & Operability]` assesses whether a system tells an operator what it did; every handled timeout ends in exactly one of these values, handed to the `OnHandled` logging hook inside a [`ProcessTimeoutReport<TProcessId>`](#processtimeoutreporttprocessid).
- **Walkthrough**: explicitly numbered members (`ProcessTimeoutHandling.cs:7,10,13,16,19,22`). Only `Applied = 3` means a save happened (`ProcessTimeoutHandling.cs:16`); every other member's doc comment records that nothing was saved, and `Rejected` adds that the row is not retried (`ProcessTimeoutHandling.cs:18-19`).
- **Why it's built this way**: none of the six outcomes fails the internal-command row. The handler returns `Result.Success()` for all of them (`ProcessTimeoutHandlerBase.cs:63,83,93,97`) because each is decided by stored state, so a retry could not change it (`ProcessTimeoutHandlerBase.cs:13-18`). The enum is therefore a reporting vocabulary, not a retry signal. Recorded in [ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html).
- **Where it's used**: mapped from the domain outcome in the handler's switch (`ProcessTimeoutHandlerBase.cs:69-76`) and carried as the first positional member of [`ProcessTimeoutReport<TProcessId>`](#processtimeoutreporttprocessid) (`ProcessTimeoutReport.cs:17`).

### WebhookErrorCodes
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookErrorCodes.cs:4` · Level 0 · class (static)

- **What it is**: the eleven stable `Webhooks.*` error codes the outbound-webhook feature returns inside an [`Error`](group-01-result-error-handling.md#error).
- **Depends on**: nothing first-party (string constants only).
- **Concept**: a per-feature error-code catalog, the same convention the Result pattern uses everywhere (see [`Error`](group-01-result-error-handling.md#error)). `[Rubric §9, API & Contract Design]` assesses whether clients get stable, machine-readable failures; each constant's doc comment pins both the error type and the HTTP status it surfaces as, so the code is the contract a subscriber-management client can switch on.
- **Walkthrough**: nine codes surface to API callers: `NotFound` (404, `WebhookErrorCodes.cs:7`); the validation set `UrlInvalid`, `TargetNotAllowed`, `EventTypesRequired`, `TooManyEventTypes` (more than 20), `EventTypeUnknown`, `DescriptionTooLong` (over 200 characters), `SecretRequired` (400, `WebhookErrorCodes.cs:10,13,16,19,22,25,28`); and `LimitReached` (409, `WebhookErrorCodes.cs:31`). Two are queue-only failures that never reach a caller: `DeliveryFailed` (`WebhookErrorCodes.cs:34`), which makes the internal-command processor retry, and `SecretUnreadable` (`WebhookErrorCodes.cs:37`), raised when the stored signing secret cannot be unprotected on the current replica.
- **Why it's built this way**: one class keeps the code strings in one place for the Application service, the Infrastructure validators and the delivery handler, which live in different assemblies. See [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: [`WebhookSubscriptionService`](#webhooksubscriptionservice) (`WebhookSubscriptionService.cs:70,192,225,240`), [`DnsWebhookTargetValidator`](#dnswebhooktargetvalidator) (`DnsWebhookTargetValidator.cs:58`), [`DataProtectionWebhookSecretProtector`](#dataprotectionwebhooksecretprotector) (`DataProtectionWebhookSecretProtector.cs:54`), [`WebhookSignature`](#webhooksignature) (`WebhookSignature.cs:128`) and [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler) (`DeliverWebhookInternalCommandHandler.cs:47,118,122`).

### WebhookEventRegistration
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookEventRegistration.cs:6` · Level 0 · record

- **What it is**: one positional record pairing an integration-event CLR type with the webhook event type name subscribers list (for example `ticket.opened`, `WebhookEventRegistration.cs:3-5`).
- **Depends on**: nothing first-party; `System.Type`.
- **Concept**: a DI-registered descriptor. Instead of a mutable static registry, each `AddWebhookEvent<TEvent>(eventType)` call adds one singleton instance of this record (`DependencyInjection.Webhooks.cs:79`), and [`WebhookEventCatalog`](#webhookeventcatalog) receives the whole set through `IEnumerable<WebhookEventRegistration>`. See [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Walkthrough**: two members, `EventClrType` and `EventType` (`WebhookEventRegistration.cs:6`).
- **Why it's built this way**: registrations live in the service collection, so `AddWebhookEvent` can inspect the earlier ones before adding another: the same type under the same name is a no-op, and a name reused for a different type, or a type registered under a second name, throws `InvalidOperationException` (`DependencyInjection.Webhooks.cs:52-77`).
- **Where it's used**: written by `AddWebhookEvent` (`DependencyInjection.Webhooks.cs:79`) and read by the [`WebhookEventCatalog`](#webhookeventcatalog) constructor (`WebhookEventCatalog.cs:20`).

### WebhookSettings
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookSettings.cs:11` · Level 0 · class

- **What it is**: the outbound-webhook options bound from the `Webhooks` configuration section; nothing is delivered and the `WebhookSubscriptions` table is not mapped until `Enabled` is true (`WebhookSettings.cs:5-10`).
- **Depends on**: nothing first-party; `System.ComponentModel.DataAnnotations` for `[Range]`.
- **Concept**: fail-fast options. `[Rubric §29, Resilience & Business Continuity]` assesses whether one bad dependency can degrade the rest; here the knobs that bound a slow receiver (timeout, per-replica concurrency, cooldown) are explicit, range-checked and defaulted low. Infrastructure binds the section with `ValidateDataAnnotations()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:71-73`), so an out-of-range value fails startup ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
- **Walkthrough**:

  | Member | Line | Default | Range / note |
  |--------|------|---------|--------------|
  | `SectionName` | `WebhookSettings.cs:14` | `"Webhooks"` | const |
  | `Enabled` | `WebhookSettings.cs:17` | `false` | master switch |
  | `DataSourceName` | `WebhookSettings.cs:23` | `"Default"` | database holding `WebhookSubscriptions` |
  | `TimeoutSeconds` | `WebhookSettings.cs:34` | 10 | 1 to 30 (`:33`); also the HttpClient timeout (`WebhookServiceCollectionExtensions.cs:88`) |
  | `DeliveryConcurrency` | `WebhookSettings.cs:41` | 4 | 1 to 16 (`:40`); never two deliveries to one subscription at once |
  | `ReceiverCooldownSeconds` | `WebhookSettings.cs:49` | 60 | 5 to 120 (`:48`); a cooling subscription's due deliveries each spend one attempt |
  | `MaxPayloadBytes` | `WebhookSettings.cs:56` | 65536 | 1024 to 1048576 (`:55`); a larger event is skipped with a warning |
  | `PreviousSecretGraceHours` | `WebhookSettings.cs:60` | 24 | 0 to 168 (`:59`); rotated-out secret keeps signing |
  | `MaxSubscriptionsPerTenant` | `WebhookSettings.cs:67` | 25 | 1 to 500 (`:66`); soft limit, concurrent creates can exceed it |
  | `AllowInsecureTargetsInDevelopment` | `WebhookSettings.cs:73` | `false` | honoured only in Development, else one startup warning |

- **Why it's built this way**: retries are deliberately absent. Each delivery is one internal-command row, so retry counts come from the `InternalCommands:*` settings (`WebhookSettings.cs:8-9`); this class only owns what is webhook-specific. The `TimeoutSeconds` remarks explain why the timeout is kept low: one slow receiver holds one lane slot for up to that many seconds per attempt (`WebhookSettings.cs:26-32`). See [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: [`WebhookDeliveryLane`](#webhookdeliverylane) (`WebhookDeliveryLane.cs:43,47`), [`WebhookFanOutHandler<TEvent>`](#webhookfanouthandlertevent) for the payload cap (`WebhookFanOutHandler.cs:82`), [`WebhookServiceCollectionExtensions`](#webhookservicecollectionextensions), [`WebhookInsecureTargets`](#webhookinsecuretargets), and the startup check [`WebhookRegistrationValidator`](#webhookregistrationvalidator).

### WebhookEventCatalog
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookEventCatalog.cs:10` · Level 1 · class (sealed partial)

- **What it is**: the host's two-way map between webhook event type names and integration-event CLR types, built from every registered [`WebhookEventRegistration`](#webhookeventregistration); empty when nothing is registered (`WebhookEventCatalog.cs:6-9`).
- **Depends on**: [`WebhookEventRegistration`](#webhookeventregistration); BCL `GeneratedRegex`, `NotNullWhen`.
- **Concept**: an allow-list for an outbound contract. `[Rubric §11, Security]` assesses whether data leaves the system only on purpose; a subscription may name only a registered event type (or `"*"`), so no integration event reaches a third party unless the host opted it in with `AddWebhookEvent`.
- **Walkthrough**:
  - Two dictionaries, `_byName` (ordinal comparer) and `_byType` (`WebhookEventCatalog.cs:15-16,24-25`). The constructor fills both with `TryAdd` (`WebhookEventCatalog.cs:26-30`), so a duplicate is ignored here; `AddWebhookEvent` already rejected conflicting ones.
  - `EventTypes` is the ordinal-sorted name list (`WebhookEventCatalog.cs:32,36`).
  - `Contains(eventType)` is null-safe (`WebhookEventCatalog.cs:41`); `TryGetEventType(Type, out string?)` maps the other way (`WebhookEventCatalog.cs:47`).
  - `IsValidEventTypeName` (internal) accepts 1 to `MaxEventTypeLength = 100` characters (`WebhookEventCatalog.cs:13,56-57`) matching `^[a-z][a-z0-9]*([._-][a-z0-9]+)*$` with a 1000 ms regex timeout (`WebhookEventCatalog.cs:59-60`).
- **Why it's built this way**: `TryAddSingleton` in both `AddWebhookEvent` and `AddWebhookDelivery` (`DependencyInjection.Webhooks.cs:81,100`) means the catalog exists whichever is called first, and the name rule lives on the catalog so registration (`DependencyInjection.Webhooks.cs:44-50`) and validation share one definition. See [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: [`WebhookSubscriptionService`](#webhooksubscriptionservice) exposes `EventTypes` and checks `Contains` (`WebhookSubscriptionService.cs:37,234`); [`WebhookFanOutHandler<TEvent>`](#webhookfanouthandlertevent) resolves the published name with `TryGetEventType` (`WebhookFanOutHandler.cs:64`); Infrastructure also registers it (`WebhookServiceCollectionExtensions.cs:82`).

### ProcessStepFailedException
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessStepFailedException.cs:10` · Level 2 · class

- **What it is**: the exception the default `OnStepFailed` of [`ProcessDomainEventHandlerBase<TDomainEvent, TProcess, TProcessId>`](#processdomaineventhandlerbasetdomainevent-tprocess-tprocessid) throws when a step returned a failed result, so the outbox redelivers the event (`ProcessStepFailedException.cs:5-9`).
- **Depends on**: [`Error`](group-01-result-error-handling.md#error); BCL `Exception`.
- **Concept**: the one deliberate bridge from `Result` back to an exception. Domain-event handlers return `Task`, not `Result`, so the only way for a handler to tell the outbox "this did not work, try again" is to throw. See the outbox at [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) and [ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html).
- **Walkthrough**: the three standard exception constructors (`ProcessStepFailedException.cs:13,19,27`) plus a process constructor (`ProcessStepFailedException.cs:36`) that sets `ProcessType`, `ProcessId` and `Errors` (`ProcessStepFailedException.cs:45,48,51`, `Errors` falls back to empty at line 41). `BuildMessage` joins the error codes, or says `no error code` (`ProcessStepFailedException.cs:53-59`).
- **Why it's built this way**: the message carries codes only, never error descriptions, so a log line names the failure without copying step detail. `ProcessId` is a string formatted with the invariant culture by the caller (`ProcessDomainEventHandlerBase.cs:122`), which keeps the exception non-generic.
- **Where it's used**: thrown only by `ProcessDomainEventHandlerBase.OnStepFailed` (`ProcessDomainEventHandlerBase.cs:120-124`).

### ProcessTimeoutReport<TProcessId>
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutReport.cs:16` · Level 2 · record

- **What it is**: what [`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`](#processtimeouthandlerbasetcommand-tprocess-tprocessid) did with one fired timeout, handed to its `OnHandled` hook for logging (`ProcessTimeoutReport.cs:5-8`).
- **Depends on**: [`ProcessTimeoutHandling`](#processtimeouthandling), [`Error`](group-01-result-error-handling.md#error).
- **Concept**: see [`ProcessTimeoutHandling`](#processtimeouthandling). `[Rubric §13, Observability & Operability]`: the record gives a consumer one structured value to log per timeout instead of a set of ad-hoc overrides.
- **Walkthrough**: six positional members (`ProcessTimeoutReport.cs:16-22`): `Handling`, `ProcessId`, `TimeoutName`, `DueAt` (filled for `NotYetDue` only), `Errors` (filled for `Rejected` only) and `StateBefore` (the state described before the aggregate decided, `ProcessTimeoutReport.cs:13-15`). `TProcessId : notnull` (`ProcessTimeoutReport.cs:23`).
- **Why it's built this way**: the handler builds the decision-bearing report directly from the aggregate's decision (`ProcessTimeoutHandlerBase.cs:82`) and every other one through a private helper that leaves `DueAt` null and `Errors` empty (`ProcessTimeoutHandlerBase.cs:120-125`).
- **Where it's used**: only inside the handler base and its tests.

### IProcessTimeoutCommand<TProcessId>
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/IProcessTimeoutCommand.cs:17` · Level 4 · interface

- **What it is**: the contract for a consumer-owned internal command that fires a named timeout on one process aggregate (`IProcessTimeoutCommand.cs:5-9`).
- **Depends on**: [`IInternalCommand`](group-14-module-system-composition.md#iinternalcommand); [`InternalCommandNameAttribute`](group-14-module-system-composition.md#internalcommandnameattribute) by convention.
- **Concept**: a process timeout is not a new mechanism; it is an ordinary durable internal command ([ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html)) with a due time. This interface only adds the correlation (`ProcessId`) the generic handler needs. The doc comment asks every implementation for a stable `[InternalCommandName]` and a handler derived from [`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`](#processtimeouthandlerbasetcommand-tprocess-tprocessid) (`IProcessTimeoutCommand.cs:6-8`), and the convention test base `ProcessTimeoutConventionTestsBase` in `MMCA.Common.Testing.Architecture` checks it (`[Rubric §34, Architecture Governance & Documentation]`).
- **Walkthrough**: one member, `ProcessId` (`IProcessTimeoutCommand.cs:21`). It may be an explicit interface implementation over the command's own id property; `System.Text.Json` does not serialize explicit implementations, so adopting the interface does not change what stored rows carry (`IProcessTimeoutCommand.cs:10-15`).
- **Why it's built this way**: keeping the payload shape stable lets an existing internal command become a process timeout without a data migration. See [ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html).
- **Where it's used**: the parameter type of [`IProcessTimeoutScheduler`](#iprocesstimeoutscheduler)`.ArmAsync` and the `TCommand` constraint of the handler base (`ProcessTimeoutHandlerBase.cs:41`).

### IProcessTimeoutScheduler
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/IProcessTimeoutScheduler.cs:9` · Level 5 · interface

- **What it is**: the one service of the process-manager primitive: arm a timeout command to run after a delay.
- **Depends on**: [`IProcessTimeoutCommand<TProcessId>`](#iprocesstimeoutcommandtprocessid), [`Result`](group-01-result-error-handling.md#result).
- **Concept**: see [`IProcessTimeoutCommand<TProcessId>`](#iprocesstimeoutcommandtprocessid). `[Rubric §6, CQRS & Event-Driven]` assesses whether long-running workflows are modelled explicitly; a step arms its next deadline through this interface instead of a timer, so the deadline survives a restart as a stored row.
- **Walkthrough**: `ArmAsync<TProcessId>(timeout, after, cancellationToken)` returns `Task<Result<Guid>>` (`IProcessTimeoutScheduler.cs:24-28`): the scheduled row id, a `ProcessManagers.TimeoutNotInFuture` validation failure for a zero or negative delay, or the internal command scheduler's own failure (`IProcessTimeoutScheduler.cs:20-23`). The write inherits that scheduler's atomicity: enrolled in the active transaction when there is one, saved outright otherwise (`IProcessTimeoutScheduler.cs:11-15`).
- **Why it's built this way**: arming inside the step's transaction means the state change and its deadline commit or roll back together. See [ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html) and the earlier deferral in [ADR-086](https://ivanball.github.io/docs/adr/086-process-manager-deferred.html).
- **Where it's used**: registered scoped by `AddProcessManagers()` (`DependencyInjection.ProcessManagers.cs:26`) and exposed to steps as [`ProcessStepContext`](#processstepcontext)`.Timeouts`.

### ProcessTimeoutScheduler
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutScheduler.cs:13` · Level 6 · class (sealed)

- **What it is**: the [`IProcessTimeoutScheduler`](#iprocesstimeoutscheduler) implementation: a guard plus one call to the internal command scheduler.
- **Depends on**: [`IInternalCommandScheduler`](group-14-module-system-composition.md#iinternalcommandscheduler), [`Error`](group-01-result-error-handling.md#error); BCL `TimeProvider`.
- **Concept**: see [`IProcessTimeoutScheduler`](#iprocesstimeoutscheduler). `[Rubric §14, Testability]`: the clock is the injected `TimeProvider` (`ProcessTimeoutScheduler.cs:15`), so a test fixes "now" and checks the due time exactly.
- **Walkthrough**: `TimeoutNotInFutureCode = "ProcessManagers.TimeoutNotInFuture"` (`ProcessTimeoutScheduler.cs:18`). `ArmAsync` (`ProcessTimeoutScheduler.cs:21`) null-checks the command (`:27`), returns a validation failure for `after <= TimeSpan.Zero` (`ProcessTimeoutScheduler.cs:29-35`), and otherwise calls `ScheduleAsync(timeout, timeProvider.GetUtcNow() + after, cancellationToken)` (`ProcessTimeoutScheduler.cs:38`).
- **Why it's built this way**: no state of its own, so transactional behavior is exactly the internal command scheduler's ([ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html)). `AddProcessManagers()` also adds `TimeProvider.System` with `TryAddSingleton`, so a host's own clock wins (`DependencyInjection.ProcessManagers.cs:26-27`).
- **Where it's used**: resolved through [`ProcessStepContext`](#processstepcontext) by process steps.

### WebhookRegistrationValidator
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookRegistrationValidator.cs:13` · Level 6 · class (internal sealed)

- **What it is**: an `IValidateOptions<WebhookSettings>` that fails startup when `AddWebhookDelivery()` was called but no [`IWebhookSubscriptionStore`](#iwebhooksubscriptionstore) is registered (`WebhookRegistrationValidator.cs:7-11`).
- **Depends on**: [`WebhookSettings`](#webhooksettings), [`IWebhookSubscriptionStore`](#iwebhooksubscriptionstore); `IServiceProviderIsService`, `IValidateOptions<T>`.
- **Concept**: a wiring check expressed as options validation. `[Rubric §15, Best Practices & Code Quality]`: the Application layer cannot reference the Infrastructure store, so it asks the container whether one exists and turns a per-row runtime failure into one startup error ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
- **Walkthrough**: `Validate` (`WebhookRegistrationValidator.cs:17`) returns `Success` when `IsService(typeof(IWebhookSubscriptionStore))` (`:18-19`), else a failure naming `services.AddWebhooks(configuration)` from `MMCA.Common.Infrastructure.Webhooks` (`WebhookRegistrationValidator.cs:20-22`).
- **Why it's built this way**: it ignores `Enabled` on purpose: a missing store is a mistake whatever the switch says (`WebhookRegistrationValidator.cs:9-10`). `ValidateOnStart()` makes it run at host start (`DependencyInjection.Webhooks.cs:98-99`).
- **Where it's used**: registered only by `AddWebhookDelivery()` (`DependencyInjection.Webhooks.cs:99`).

### ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandlerBase.cs:36` · Level 8 · class (abstract)

- **What it is**: the generic handler for a fired process timeout: load the process tracked, let the aggregate decide against the injected clock, save once when it applied (`ProcessTimeoutHandlerBase.cs:8-11`).
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IConcurrencyConflictDetector`](group-07-persistence-ef-core.md#iconcurrencyconflictdetector), [`ProcessManagerAggregateRoot<TIdentifierType>`](#processmanageraggregateroottidentifiertype), [`ProcessTimeout`](#processtimeout), [`ProcessTimeoutOutcome`](#processtimeoutoutcome), [`ProcessTimeoutReport<TProcessId>`](#processtimeoutreporttprocessid); BCL `TimeProvider`.
- **Concept introduced, the process-manager timeout.** `[Rubric §6, CQRS & Event-Driven]` assesses whether long-running workflows have explicit state and deadlines. The aggregate owns the rule (`DecideTimeout`, `ProcessTimeoutHandlerBase.cs:67`); this base owns only loading, saving and classifying. `[Rubric §29, Resilience & Business Continuity]`: every outcome decided by stored state completes the row with success, and only a save failure that is not a concurrency conflict propagates so the row retries with backoff (`ProcessTimeoutHandlerBase.cs:13-18`).
- **Walkthrough**:
  - `Includes` defaults to none (`ProcessTimeoutHandlerBase.cs:46`).
  - `HandleAsync` (`ProcessTimeoutHandlerBase.cs:49`) resolves the timeout first (`:53`), loads with `asTracking: true` (`ProcessTimeoutHandlerBase.cs:56-58`), and reports `ProcessMissing` when the row is gone (`:60-64`).
  - It captures `DescribeState` before deciding (`:66-67`), maps the outcome with a switch whose default arm is `NotApplicable` (`ProcessTimeoutHandlerBase.cs:69-76`), and for anything but `Applied` reports without saving (`:78-84`).
  - On `Applied` it calls `SaveChangesAsync` once (`:88`); a concurrency conflict becomes `LostRace` (`ProcessTimeoutHandlerBase.cs:90-94`), otherwise `Applied` (`:96`).
  - Extension points: abstract `ResolveTimeout` (`:103`), virtual `DescribeState` returning null (`:111`), virtual no-op `OnHandled` (`ProcessTimeoutHandlerBase.cs:116`).
- **Why it's built this way**: a `NotYetDue` decision schedules nothing new, so each step that still wants the timeout re-arms it and the host keeps a reconciliation sweep for the rest (`ProcessTimeoutHandlerBase.cs:20-23`; compensation and reconciliation in [ADR-054](https://ivanball.github.io/docs/adr/054-saga-compensation-and-reconciliation.html)). One sealed subclass per command lets the module scan register a closed `ICommandHandler<TCommand, Result>` the decorator pipeline wraps (`ProcessTimeoutHandlerBase.cs:24-27`). See [ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html).
- **Where it's used**: consumer subclasses found by the module scan (`DependencyInjection.ProcessManagers.cs:19-22`); the architecture rules in `ArchitectureRules.ProcessTimeouts.cs` check the convention.
- **Caveats / not-in-source**: no subclass exists in `MMCA.ADC/Source` today; the in-repo subclasses are test fixtures. Which consumer, if any, derives it is not determinable from the Common and ADC sources read here.

### ProcessStepContext
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessStepContext.cs:11` · Level 11 · class (sealed)

- **What it is**: the bundle a process step receives: the event's scope provider, its unit of work, and the timeout scheduler when registered.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IProcessTimeoutScheduler`](#iprocesstimeoutscheduler); BCL `IServiceProvider`.
- **Concept**: a parameter object. See [`ProcessDomainEventHandlerBase<TDomainEvent, TProcess, TProcessId>`](#processdomaineventhandlerbasetdomainevent-tprocess-tprocessid) for the step model.
- **Walkthrough**: the constructor null-checks both arguments (`ProcessStepContext.cs:16-19`) and resolves the scheduler with `GetService`, not `GetRequiredService` (`ProcessStepContext.cs:23`). `Services`, `UnitOfWork` (the step owns every save) and nullable `Timeouts` (`ProcessStepContext.cs:27,30,33`).
- **Why it's built this way**: `Timeouts` is null when the host never called `AddProcessManagers()` (`ProcessStepContext.cs:32`), so a process that needs no deadlines works without that registration. Passing one object keeps the abstract `HandleStepAsync` signature stable if the context grows.
- **Where it's used**: constructed per step inside the transaction (`ProcessDomainEventHandlerBase.cs:68`).

### ProcessDomainEventHandlerBase<TDomainEvent, TProcess, TProcessId>
> MMCA.Common.Application · `MMCA.Common.Application.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessDomainEventHandlerBase.cs:31` · Level 12 · class (abstract)

- **What it is**: runs one process step per domain event: one scope, one transaction, the correlated process loaded tracked, then the consumer's `HandleStepAsync` (`ProcessDomainEventHandlerBase.cs:11-14`).
- **Depends on**: [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent), [`IDomainEvent`](#idomainevent), [`ProcessManagerAggregateRoot<TIdentifierType>`](#processmanageraggregateroottidentifiertype), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ProcessStepContext`](#processstepcontext), [`ProcessStepFailedException`](#processstepfailedexception); `IServiceScopeFactory`.
- **Concept**: the event-driven half of the process manager (the timeout half is [`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`](#processtimeouthandlerbasetcommand-tprocess-tprocessid)). `[Rubric §6, CQRS & Event-Driven]`: a domain event moves a stored process aggregate one step, inside its own transaction ([ADR-107](https://ivanball.github.io/docs/adr/107-transaction-execution-contract.html)). `[Rubric §10, Messaging & Integration]`: a failed step throws by default, so the outbox redelivers the event ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
- **Walkthrough**:
  - `HandleAsync` (`ProcessDomainEventHandlerBase.cs:41`) calls `OnStepStarting` before any scope (`:45`), opens an async scope (`ProcessDomainEventHandlerBase.cs:47-48`) and resolves that scope's `IUnitOfWork` (`:50`).
  - Inside `ExecuteInTransactionAsync` (`ProcessDomainEventHandlerBase.cs:52`) it loads by `CorrelateProcessId` with `asTracking: true` (`:55-57`); a missing process calls `OnProcessMissing` and succeeds (`ProcessDomainEventHandlerBase.cs:59-63`); otherwise it returns `HandleStepAsync` with a new [`ProcessStepContext`](#processstepcontext) (`:65-69`).
  - A failed result calls `OnStepFailed` after the rollback (`ProcessDomainEventHandlerBase.cs:73-76`), whose default throws `ProcessStepFailedException` with the process type name and the id formatted invariantly (`ProcessDomainEventHandlerBase.cs:120-124`).
  - Extension points: abstract `CorrelateProcessId` and `HandleStepAsync` (`:83,94`), virtual `Includes` (`:38`), `OnStepStarting`, `OnProcessMissing` (`ProcessDomainEventHandlerBase.cs:102,108`) and `OnStepFailed`.
- **Why it's built this way**: the base never saves; the transaction refuses to commit unsaved changes, so a step that forgets to save fails loudly (`ProcessDomainEventHandlerBase.cs:16-18`). A step's own exception propagates unchanged and cancellation is never caught (`ProcessDomainEventHandlerBase.cs:20-24`). An override of `OnStepFailed` that returns normally keeps the event handled. See [ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html), [ADR-054](https://ivanball.github.io/docs/adr/054-saga-compensation-and-reconciliation.html) and [ADR-086](https://ivanball.github.io/docs/adr/086-process-manager-deferred.html).
- **Where it's used**: consumer subclasses found by the module scan (`DependencyInjection.ProcessManagers.cs:19-22`); `AddApplication()` registers none of this (`:22`).
- **Caveats / not-in-source**: no subclass exists in `MMCA.ADC/Source` today; the in-repo subclasses are test fixtures in `ProcessDomainEventHandlerBaseTests.cs`.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:110`), and
  dispatched by [`IDomainEventDispatcher`](#idomaineventdispatcher) or the
  [`OutboxProcessor`](#outboxprocessor).

### ProcessTimeout
> MMCA.Common.Domain · `MMCA.Common.Domain.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessTimeout.cs:7` · Level 0 · record

- **What it is**: a named time window measured from a process's last transition. A process aggregate
  matches a fired timeout by its `Name` and computes when it is due with `DueAfter`
  (`ProcessTimeout.cs:3-6`).
- **Depends on**: nothing first-party (BCL `TimeSpan`/`DateTime` and the `ArgumentException` guards).
- **Concept introduced, the timeout half of a process manager.** `[Rubric §6, CQRS & Event-Driven]`
  (assesses long-running workflows coordinated through events and commands rather than call chains):
  a process manager advances on events, but it also has to advance when *nothing* happens (an
  unanswered request, an expired hold). This record is the vocabulary for that "nothing happened in
  time" step; the aggregate that interprets it is
  [`ProcessManagerAggregateRoot<TIdentifierType>`](#processmanageraggregateroottidentifiertype)
  ([ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html)).
- **Walkthrough**: a sealed record with an explicit constructor (`ProcessTimeout.cs:14`) that rejects
  a blank name (`ProcessTimeout.cs:16`) and a zero or negative window (`ProcessTimeout.cs:17`), so an
  invalid timeout cannot exist. `Name` (`ProcessTimeout.cs:24`) and `Window` (`ProcessTimeout.cs:27`)
  are get-only. `DueAfter(lastTransitionOn)` (`ProcessTimeout.cs:32`) is just
  `lastTransitionOn + Window`: the due instant is always derived, never stored.
- **Why it's built this way**: keeping the due instant a pure function of the stored last-transition
  time is what lets a stale or re-armed timeout become a no-op (the aggregate re-derives it and answers
  [`ProcessTimeoutDecision`](#processtimeoutdecision) `NotYetDue`); the record carries no process id
  and no state, so it is safe to construct anywhere.
- **Where it's used**: passed to `ProcessManagerAggregateRoot.DecideTimeout`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessManagerAggregateRoot.cs:43`);
  produced by the abstract `ResolveTimeout(TCommand)` of
  [`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`](#processtimeouthandlerbasetcommand-tprocess-tprocessid)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandlerBase.cs:103`),
  whose `Name` is copied into the [`ProcessTimeoutReport<TProcessId>`](#processtimeoutreporttprocessid)
  (`ProcessTimeoutHandlerBase.cs:82`).

### ProcessTimeoutOutcome
> MMCA.Common.Domain · `MMCA.Common.Domain.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessTimeoutOutcome.cs:4` · Level 0 · enum

- **What it is**: what a process aggregate decided about a fired timeout (`ProcessTimeoutOutcome.cs:3`).
- **Depends on**: nothing first-party.
- **Concept**: the result vocabulary of the process-manager timeout step introduced at
  [`ProcessTimeout`](#processtimeout); `[Rubric §6, CQRS & Event-Driven]` applies the same way.
- **Walkthrough**: four explicitly numbered members. `NotApplicable = 0` (`ProcessTimeoutOutcome.cs:7`)
  is the default: the timeout does not apply to the process in its current state or by its name.
  `NotYetDue = 1` (`ProcessTimeoutOutcome.cs:10`): it applies, but a stale or re-armed row fired early.
  `Applied = 2` (`ProcessTimeoutOutcome.cs:13`): the aggregate transitioned. `Rejected = 3`
  (`ProcessTimeoutOutcome.cs:16`): the aggregate refused the transition.
- **Why it's built this way**: making the no-op the zero value means an aggregate that never overrides
  `DecideTimeout` is safe by default (the base returns `NotApplicable`,
  `MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessManagerAggregateRoot.cs:44`).
- **Where it's used**: carried by [`ProcessTimeoutDecision`](#processtimeoutdecision); mapped
  one-to-one onto [`ProcessTimeoutHandling`](#processtimeouthandling) by the timeout handler base
  (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandlerBase.cs:71-74`).

### WebhookDeliveryId
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookDeliveryId.cs:9` · Level 0 · class (static)

- **What it is**: computes the deterministic `webhook-id` of one (event, subscription) pair, so a
  redelivered event schedules the same id and a receiver can dedupe on it (`WebhookDeliveryId.cs:5-8`).
- **Depends on**: nothing first-party; BCL `System.Security.Cryptography.SHA256`.
- **Concept introduced, outbound webhooks and receiver-side idempotency.**
  `[Rubric §10, Messaging & Integration Architecture]` (assesses at-least-once delivery paired with an
  idempotency key the other side can use): MMCA.Common can push integration events to tenant-registered
  HTTP endpoints ([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)).
  Delivery is at-least-once, so every attempt for the same event and subscription must carry the
  same id; this type is the inbound [`IDomainEvent`](#idomainevent) `MessageId` idea turned outward.
- **Walkthrough**: one method, `For(eventId, subscriptionId)` (`WebhookDeliveryId.cs:18`). It writes the
  two GUIDs into a 32-byte stack buffer (`WebhookDeliveryId.cs:20-22`), hashes it with SHA-256 into a
  second stack buffer (`WebhookDeliveryId.cs:24-25`), and returns the first 16 hash bytes as a `Guid`
  (`WebhookDeliveryId.cs:26`). No allocation beyond the result.
- **Why it's built this way**: a hash of the pair is stable across retries, replicas and redeliveries
  without storing anything, and it does not expose the raw event id to the receiver.
- **Where it's used**: [`WebhookFanOutHandler<TEvent>`](#webhookfanouthandlertevent) stamps it into each
  [`DeliverWebhookInternalCommand`](#deliverwebhookinternalcommand)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookFanOutHandler.cs:91`), and
  [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler) sends it as the
  `webhook-id` header value (`DeliverWebhookInternalCommandHandler.cs:62`).

### WebhookDeliveryRequest
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookDeliveryRequest.cs:8` · Level 0 · record

- **What it is**: the input to [`IWebhookSender`](#iwebhooksender): what one POST sends
  (`WebhookDeliveryRequest.cs:3`).
- **Depends on**: nothing first-party at the type level (BCL `Uri`, `IReadOnlyList<string>`).
- **Concept**: part of the outbound webhook delivery path introduced at
  [`WebhookDeliveryId`](#webhookdeliveryid).
- **Walkthrough**: four positional members (`WebhookDeliveryRequest.cs:4-8`): `Target` (the
  subscription URL), `WebhookId` (the `webhook-id` header value), `Body` (the
  [`WebhookEnvelope`](#webhookenvelope) JSON, sent verbatim), and `ProtectedSecrets` (the signing
  secrets still protected, current first; one signature is sent per readable secret).
- **Why it's built this way**: carrying the secrets *protected* keeps the plaintext key out of the
  Application layer; only the sender unprotects them
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/HttpWebhookSender.cs:123`).
  `[Rubric §11, Security]` (assesses secret handling) applies to that choice.
- **Where it's used**: built by [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:60-64`)
  and consumed by [`HttpWebhookSender`](#httpwebhooksender).

### WebhookEnvelope
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookEnvelope.cs:11` · Level 0 · class (static)

- **What it is**: builds the delivery body in the Standard Webhooks payload shape
  `{"type":...,"timestamp":...,"data":...}`, with the event payload carried verbatim
  (`WebhookEnvelope.cs:7-10`).
- **Depends on**: nothing first-party; BCL `StringBuilder`, `System.Text.Json.JsonSerializer`.
- **Concept**: `[Rubric §9, API & Contract Design]` (assesses stable, documented external contracts):
  the receiver-facing body follows a published shape instead of an MMCA-specific one, so any Standard
  Webhooks consumer can parse it.
- **Walkthrough**: one method, `Build(eventType, occurredOn, payloadJson)` (`WebhookEnvelope.cs:18`).
  It rejects a blank type or payload (`WebhookEnvelope.cs:20-21`), normalizes `occurredOn` to UTC
  (`Local` is converted, `Unspecified` is relabelled as UTC, `WebhookEnvelope.cs:23-29`), then
  concatenates with a pre-sized `StringBuilder` (`WebhookEnvelope.cs:31`): `type` is JSON-escaped via
  `JsonSerializer.Serialize` (`WebhookEnvelope.cs:32-33`), `timestamp` is the round-trip `"O"` format
  in the invariant culture (`WebhookEnvelope.cs:34-35`), and `data` is the payload string appended
  without re-serialization (`WebhookEnvelope.cs:36-37`).
- **Why it's built this way**: appending the payload verbatim avoids a parse-and-reserialize round trip
  and keeps the signed body byte-identical to what the fan-out serialized.
- **Where it's used**: called by [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:63`).
- **Caveats / not-in-source**: `payloadJson` is not validated as JSON here; the method trusts its caller
  (the fan-out's `JsonSerializer.Serialize`, `WebhookFanOutHandler.cs:80`).

### WebhookSendStatus
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookSendStatus.cs:4` · Level 0 · enum

- **What it is**: how one webhook POST ended, classified by what the delivery handler should do next.
- **Depends on**: nothing first-party.
- **Concept**: `[Rubric §29, Resilience & Business Continuity]` (assesses retry with a clear line
  between transient and permanent failure): every member's doc comment states whether it is retried.
- **Walkthrough**: six explicitly numbered members. `Delivered = 0` (`WebhookSendStatus.cs:7`): 2xx.
  `Rejected = 1` (`WebhookSendStatus.cs:10`): any other status, redirects included; retried.
  `Gone = 2` (`WebhookSendStatus.cs:13`): 410, the subscription is disabled. `TargetRefused = 3`
  (`WebhookSendStatus.cs:19`): a non-public address at connect time or a scheme the host does not
  accept; retrying cannot change it. `TransportFailed = 4` (`WebhookSendStatus.cs:22`): transport
  failure, timeouts included; retried. `SecretUnreadable = 5` (`WebhookSendStatus.cs:25`): the current
  signing secret could not be unprotected, nothing was sent; retried.
- **Why it's built this way**: the sender classifies, the handler decides; keeping the classification
  in one enum lets [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler) map
  each status to complete-or-retry in one place.
- **Where it's used**: produced by [`HttpWebhookSender`](#httpwebhooksender) (for example 2xx versus
  other at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/HttpWebhookSender.cs:109`, 410 at
  `HttpWebhookSender.cs:106`); carried by [`WebhookSendOutcome`](#webhooksendoutcome).

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:812`),
  with no parallel capture pipeline to keep in step.
- **Where it's used**: implemented by integration events across modules and by
  [`BaseIntegrationEvent`](#baseintegrationevent), which adds the `SchemaVersion` convention; routed
  by the [`OutboxProcessor`](#outboxprocessor) to [`IMessageBus`](#imessagebus)
  (`OutboxProcessor.cs:812`); published by [`InProcessEventBus`](#inprocesseventbus) and
  [`BrokerEventBus`](#brokereventbus); consumed via
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent), whose type parameter is
  constrained to `class, IIntegrationEvent` (`IntegrationEventConsumer.cs:45`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### WebhookSendOutcome
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookSendOutcome.cs:7` · Level 1 · record

- **What it is**: the result of one webhook POST (`WebhookSendOutcome.cs:3`).
- **Depends on**: [`WebhookSendStatus`](#webhooksendstatus) (Level 0).
- **Concept**: see [`WebhookSendStatus`](#webhooksendstatus) for the retry classification.
- **Walkthrough**: three positional members (`WebhookSendOutcome.cs:4-7`): `Status`, `HttpStatusCode`
  (`int?`, set only when the receiver answered) and `Detail` (`string?`, the failure detail in the form
  `"ExceptionType: message"` when there is one).
- **Why it's built this way**: a plain value instead of an exception lets the handler record transport
  failures and HTTP rejections on the subscription the same way.
- **Where it's used**: returned by [`IWebhookSender`](#iwebhooksender) (`IWebhookSender.cs:10`); read by
  `ApplyOutcome` in [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:79`),
  which turns `HttpStatusCode` into an `HTTP {code}` reason (`DeliverWebhookInternalCommandHandler.cs:127-130`)
  and falls back to `Detail`, then to the status name (`DeliverWebhookInternalCommandHandler.cs:142-143`).

### IWebhookSender
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/IWebhookSender.cs:4` · Level 2 · interface

- **What it is**: posts one signed webhook delivery (`IWebhookSender.cs:3`).
- **Depends on**: [`WebhookDeliveryRequest`](#webhookdeliveryrequest), [`WebhookSendOutcome`](#webhooksendoutcome).
- **Concept**: `[Rubric §3, Clean Architecture]` (assesses that the Application layer owns abstractions
  and Infrastructure owns I/O): the delivery handler in Application depends on this port, and the
  `HttpClient` code lives behind it in Infrastructure.
- **Walkthrough**: one member, `SendAsync(request, cancellationToken)` (`IWebhookSender.cs:10`). Its
  contract (`IWebhookSender.cs:6-9`): it signs and posts, never reads the response body, and lets
  cancellation propagate.
- **Why it's built this way**: not reading the body bounds what a hostile receiver can make the host
  allocate; returning an outcome instead of throwing keeps failure classification inside the sender.
- **Where it's used**: implemented by [`HttpWebhookSender`](#httpwebhooksender)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/HttpWebhookSender.cs:25`), registered
  scoped by `AddWebhooks`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:79`),
  and injected into [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler).

### ProcessTimeoutDecision
> MMCA.Common.Domain · `MMCA.Common.Domain.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessTimeoutDecision.cs:10` · Level 2 · record

- **What it is**: the decision a process aggregate returns from `DecideTimeout`. Only `NotYetDue`
  carries `DueAt` and only `Rejected` carries `Errors` (`ProcessTimeoutDecision.cs:5-9`).
- **Depends on**: [`ProcessTimeoutOutcome`](#processtimeoutoutcome) (Level 0) and
  [`Error`](group-01-result-error-handling.md#error) (G01).
- **Concept**: the process-manager timeout step is introduced at [`ProcessTimeout`](#processtimeout).
  The shape here is a closed set of named factories over a private constructor, the same idea as
  [`Result`](group-01-result-error-handling.md#result): invalid combinations cannot be built.
- **Walkthrough**: the constructor is private (`ProcessTimeoutDecision.cs:12`). Three get-only
  properties: `Outcome` (`ProcessTimeoutDecision.cs:20`), `DueAt` (`ProcessTimeoutDecision.cs:23`) and
  `Errors` (`ProcessTimeoutDecision.cs:26`). Four factories: `NotApplicable()`
  (`ProcessTimeoutDecision.cs:30`), `NotYetDue(dueAt)` (`ProcessTimeoutDecision.cs:35`), `Applied()`
  (`ProcessTimeoutDecision.cs:39`) and `Rejected(errors)` (`ProcessTimeoutDecision.cs:45`), which
  throws when the list is empty (`ProcessTimeoutDecision.cs:50`) and stores a copy of it
  (`ProcessTimeoutDecision.cs:53`).
- **Why it's built this way**: a rejected decision with no reason would be unreportable, so the guard
  makes it impossible; the defensive copy keeps the decision immutable after the aggregate returns it.
- **Where it's used**: returned by `ProcessManagerAggregateRoot.DecideTimeout`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessManagerAggregateRoot.cs:43`);
  read by [`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`](#processtimeouthandlerbasetcommand-tprocess-tprocessid)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandlerBase.cs:67`),
  which copies `DueAt` and `Errors` into the [`ProcessTimeoutReport<TProcessId>`](#processtimeoutreporttprocessid)
  (`ProcessTimeoutHandlerBase.cs:82`).

### WebhookSignature
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookSignature.cs:13` · Level 3 · class (static)

- **What it is**: the Standard Webhooks signing scheme: a `whsec_`-prefixed Base64 secret, and a
  `v1,`-prefixed Base64 HMAC-SHA256 over `{id}.{timestamp}.{body}`; receivers verify with `Verify` or
  any Standard Webhooks library (`WebhookSignature.cs:8-12`).
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) (G01),
  [`WebhookErrorCodes`](#webhookerrorcodes); BCL `HMACSHA256`, `RandomNumberGenerator`,
  `CryptographicOperations`.
- **Concept introduced, signed outbound webhooks.** `[Rubric §11, Security]` (assesses authenticity,
  replay protection and constant-time comparison of secrets): a receiver can only trust a webhook it
  can authenticate, so every delivery is signed with a per-subscription key and stamped with a send
  time the receiver checks for freshness. Following a published scheme
  ([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)) means
  the receiver does not need MMCA code to verify.
- **Walkthrough**: constants first: `SecretPrefix = "whsec_"` (`WebhookSignature.cs:16`) and the three
  header names `webhook-id`, `webhook-timestamp`, `webhook-signature` (`WebhookSignature.cs:19,22,25`),
  plus the private `"v1,"` version prefix and a 32-byte key size (`WebhookSignature.cs:27-28`).
  `GenerateSecret()` (`WebhookSignature.cs:32`) is the prefix plus Base64 of 32 random bytes.
  `DecodeSecret(secret)` (`WebhookSignature.cs:38`) returns a `Result<byte[]>`: a missing prefix or an
  empty or invalid Base64 tail (`WebhookSignature.cs:40,47`) is a `Webhooks.SecretUnreadable` failure
  (`WebhookSignature.cs:126-130`), never an exception. `Compute(webhookId, timestamp, body, key)`
  (`WebhookSignature.cs:61`) UTF-8 encodes `{id}.{timestamp}.{body}` in the invariant culture
  (`WebhookSignature.cs:66-67`) and returns `v1,` plus the Base64 HMAC (`WebhookSignature.cs:68`).
  `Verify(...)` (`WebhookSignature.cs:84`) rejects null or blank inputs (`WebhookSignature.cs:93`),
  rejects a timestamp outside the tolerance (`WebhookSignature.cs:98`), then accepts if any
  space-separated `v1,` entry matches the recomputed signature under
  `CryptographicOperations.FixedTimeEquals` (`WebhookSignature.cs:103-107`). The private
  `IsWithinTolerance` (`WebhookSignature.cs:114`) saturates both bounds at the `long` range so a hostile
  timestamp cannot overflow the comparison (`WebhookSignature.cs:121-122`).
- **Why it's built this way**: a space-separated list of signatures lets a rotated subscription send
  one signature per still-valid secret, so a receiver keeps verifying through a rotation; constant-time
  comparison and the saturated window close timing and overflow attacks on the receiver side.
- **Where it's used**: [`HttpWebhookSender`](#httpwebhooksender) joins one `Compute` per readable key
  into the signature header
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/HttpWebhookSender.cs:62,70`);
  [`WebhookSubscriptionService`](#webhooksubscriptionservice) mints secrets with `GenerateSecret`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/WebhookSubscriptionService.cs:81,143`).
  `Verify` has no production caller in MMCA.Common; it is exposed for receivers and exercised by
  `WebhookSignatureTests`.

### DeliverWebhookInternalCommand
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommand.cs:17` · Level 4 · record

- **What it is**: one webhook delivery, as a durable internal-command row the fan-out schedules per
  matching subscription. The row *is* the delivery history (attempts, last error, dead letter, requeue)
  (`DeliverWebhookInternalCommand.cs:5-9`).
- **Depends on**: [`IInternalCommand`](group-14-module-system-composition.md#iinternalcommand) (G14) and
  [`InternalCommandNameAttribute`](group-14-module-system-composition.md#internalcommandnameattribute)
  (G14).
- **Concept**: `[Rubric §29, Resilience & Business Continuity]`: rather than a bespoke delivery table,
  each attempt rides the internal-command lane, so retry with backoff, dead-lettering and requeue come
  from the existing [`InternalCommandProcessor`](group-07-persistence-ef-core.md#internalcommandprocessor)
  ([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)).
- **Walkthrough**: six positional members (`DeliverWebhookInternalCommand.cs:18-23`): `SubscriptionId`,
  `DeliveryId` (from [`WebhookDeliveryId`](#webhookdeliveryid)), `EventType`, `EventId` (the event's
  `MessageId`), `OccurredOn` (its `DateOccurred`) and `PayloadJson` (the event serialized by its runtime
  type with web defaults). The stable storage name is pinned by
  `[InternalCommandName("MMCA.Webhooks.Deliver.v1")]` (`DeliverWebhookInternalCommand.cs:16`), so a
  rename of the CLR type cannot orphan queued rows.
- **Why it's built this way**: the payload is captured at fan-out time, so a delivery replays exactly
  what was scheduled even if the event type later changes shape.
- **Where it's used**: created by [`WebhookFanOutHandler<TEvent>`](#webhookfanouthandlertevent)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookFanOutHandler.cs:88-96`);
  handled by [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler), registered
  at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Webhooks.cs:97`; its rows are
  drained by [`WebhookDeliveryLane`](#webhookdeliverylane), which resolves the storage name and filters
  on the type (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookDeliveryLane.cs:27,44`).

### ProcessManagerAggregateRoot<TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.ProcessManagers` · `MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessManagerAggregateRoot.cs:17` · Level 5 · class (abstract)

- **What it is**: the base class for an aggregate that *is* the state of a long-running process (a
  process manager, or saga): its own status columns decide every step, and named timeouts are applied
  by re-deriving the due instant from what is stored (`ProcessManagerAggregateRoot.cs:5-8`).
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  (G02), [`ProcessTimeout`](#processtimeout), [`ProcessTimeoutDecision`](#processtimeoutdecision).
- **Concept introduced, the process manager as an aggregate.** `[Rubric §4, DDD]` (assesses whether
  aggregates own their invariants) and `[Rubric §6, CQRS & Event-Driven]` (assesses coordination of
  multi-step workflows): instead of a separate saga-state row kept in step with the business
  aggregate, the business aggregate itself is the process state. Event-driven steps run through
  [`ProcessDomainEventHandlerBase<TDomainEvent, TProcess, TProcessId>`](#processdomaineventhandlerbasetdomainevent-tprocess-tprocessid)
  and timeouts through
  [`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`](#processtimeouthandlerbasetcommand-tprocess-tprocessid)
  (`ProcessManagerAggregateRoot.cs:9-14`;
  [ADR-143](https://ivanball.github.io/docs/adr/143-process-manager-primitive.html); see also
  [ADR-054](https://ivanball.github.io/docs/adr/054-saga-compensation-and-reconciliation.html) and
  [ADR-086](https://ivanball.github.io/docs/adr/086-process-manager-deferred.html)).
- **Walkthrough**: `GetLastTransitionOn()` (`ProcessManagerAggregateRoot.cs:29`) returns
  `LastModifiedOn ?? CreatedOn` through a private static helper (`ProcessManagerAggregateRoot.cs:31`).
  `DecideTimeout(timeout, utcNow)` (`ProcessManagerAggregateRoot.cs:43`) is virtual and returns
  `NotApplicable` by default (`ProcessManagerAggregateRoot.cs:44`). Its doc comment
  (`ProcessManagerAggregateRoot.cs:33-42`) fixes the override recipe: check the timeout's name and the
  stored state, return `NotYetDue` when `timeout.DueAfter(GetLastTransitionOn())` lies after `utcNow`,
  otherwise apply the transition; a stale or re-armed timeout is then a no-op by construction.
- **Why it's built this way**: the base declares no property and no field (`ProcessManagerAggregateRoot.cs:9-11`),
  and `GetLastTransitionOn` is a method rather than a property on purpose: a property declared here
  would map into every adopter's EF model (`ProcessManagerAggregateRoot.cs:25-28`). Deriving from it
  therefore leaves migrations unchanged.
- **Where it's used**: the `TProcess` constraint of both process handler bases
  (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandlerBase.cs:42`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessDomainEventHandlerBase.cs:34`);
  the timeout base calls `DecideTimeout` (`ProcessTimeoutHandlerBase.cs:67`).
- **Caveats / not-in-source**: whether an MMCA.ADC aggregate derives from it today is not determinable
  from the brief's usage sites, which list only MMCA.Common source and tests.

### DeliverWebhookInternalCommandHandler
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:24` · Level 6 · class (internal sealed partial)

- **What it is**: delivers one [`DeliverWebhookInternalCommand`](#deliverwebhookinternalcommand): reads
  the subscription under the tenant the processor restored for the row, posts the signed envelope, and
  maps the outcome onto the subscription and onto the row. It is not `ITransactional`: the outcome is
  recorded on its own save (`DeliverWebhookInternalCommandHandler.cs:12-17`).
- **Depends on**: [`IWebhookSubscriptionStore`](#iwebhooksubscriptionstore),
  [`IWebhookSender`](#iwebhooksender), [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) (G05),
  [`WebhookSettings`](#webhooksettings), [`WebhookEnvelope`](#webhookenvelope),
  [`WebhookSubscription`](#webhooksubscription), [`WebhookErrorCodes`](#webhookerrorcodes); implements
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  (G05); BCL `TimeProvider`, `IOptions<T>`, `ILogger<T>`.
- **Concept**: `[Rubric §29, Resilience & Business Continuity]`: success completes the row, failure
  returns a failed `Result` so the internal-command processor retries with backoff and dead-letters
  after its attempt limit (`DeliverWebhookInternalCommandHandler.cs:113-114`).
  `[Rubric §13, Observability & Operability]`: one source-generated log line per outcome
  (`DeliverWebhookInternalCommandHandler.cs:145-161`).
- **Walkthrough**: `HandleAsync` (`DeliverWebhookInternalCommandHandler.cs:37`) first fails when
  `Webhooks:Enabled` is false (`DeliverWebhookInternalCommandHandler.cs:41-49`), so a row queued before
  webhooks were switched off retries and dead-letters where it stays requeue-able. A missing, deleted
  or disabled subscription completes the row with nothing sent (`DeliverWebhookInternalCommandHandler.cs:52-57`).
  Otherwise it builds the [`WebhookDeliveryRequest`](#webhookdeliveryrequest) with the delivery id
  formatted `"D"`, the envelope, and the signing secrets valid now (`DeliverWebhookInternalCommandHandler.cs:59-64`),
  sends it (`DeliverWebhookInternalCommandHandler.cs:66`), applies the outcome
  (`DeliverWebhookInternalCommandHandler.cs:67`) and saves the subscription
  (`DeliverWebhookInternalCommandHandler.cs:69`). `ApplyOutcome` (`DeliverWebhookInternalCommandHandler.cs:79`):
  `Delivered` records success (`DeliverWebhookInternalCommandHandler.cs:85-90`); `TargetRefused`
  records a fixed reason ("not a public address" or "not an https address", chosen by the stored URL
  scheme, `DeliverWebhookInternalCommandHandler.cs:33-34,137-140`) and completes, keeping the
  address-bearing detail to the server-side warning (`DeliverWebhookInternalCommandHandler.cs:92-99`);
  `Gone` records the failure, disables the subscription and completes (`DeliverWebhookInternalCommandHandler.cs:106-111`);
  `Rejected`, `TransportFailed` and `SecretUnreadable` record the failure and return a failed `Result`
  with `Webhooks.SecretUnreadable` or `Webhooks.DeliveryFailed` (`DeliverWebhookInternalCommandHandler.cs:115-124`).
- **Why it's built this way**: a delivery's own save means the outcome survives even when the row is
  about to retry; recording a fixed refusal reason keeps resolved internal addresses out of the tenant
  admin API, which returns `LastFailure` (`DeliverWebhookInternalCommandHandler.cs:94-95`).
- **Where it's used**: registered scoped as `ICommandHandler<DeliverWebhookInternalCommand, Result>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Webhooks.cs:97`) and invoked by
  the internal-command processor for rows on the [`WebhookDeliveryLane`](#webhookdeliverylane).

### WebhookFanOutHandler<TEvent>
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Delivery` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookFanOutHandler.cs:35` · Level 8 · class (internal sealed partial)

- **What it is**: turns one published integration event into one
  [`DeliverWebhookInternalCommand`](#deliverwebhookinternalcommand) per enabled subscription of the
  event's tenant that lists its webhook type (or `"*"`), all scheduled inside one transaction
  (`WebhookFanOutHandler.cs:17-21`).
- **Depends on**: [`ScopedIntegrationEventHandlerBase<TIntegrationEvent>`](#scopedintegrationeventhandlerbasetintegrationevent)
  (its base), [`IIntegrationEvent`](#iintegrationevent), [`WebhookSettings`](#webhooksettings),
  [`WebhookEventCatalog`](#webhookeventcatalog), [`IWebhookSubscriptionStore`](#iwebhooksubscriptionstore),
  [`WebhookDeliveryId`](#webhookdeliveryid), [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) (G05),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (G07),
  [`IInternalCommandScheduler`](group-14-module-system-composition.md#iinternalcommandscheduler) (G14);
  BCL `System.Text.Json`.
- **Concept**: `[Rubric §10, Messaging & Integration Architecture]`: the bridge from the internal event
  stream to external HTTP subscribers. It consumes the same at-least-once integration event as any
  other handler, and hands each delivery to the durable internal-command lane rather than posting
  inline ([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)).
- **Walkthrough**: two constructors: one with a logger (`WebhookFanOutHandler.cs:45`) and one that
  uses `NullLogger` for a container with no logging (`WebhookFanOutHandler.cs:54`).
  `HandleScopedAsync` (`WebhookFanOutHandler.cs:60`) returns early unless `WebhookSettings.Enabled` is
  true and the catalog maps `TEvent` to a webhook type (`WebhookFanOutHandler.cs:62-67`). It lists the
  tenant's enabled subscriptions (`WebhookFanOutHandler.cs:69-72`) and keeps those that subscribe to the
  type (`WebhookFanOutHandler.cs:74`). It serializes the event by its runtime type with
  `JsonSerializerDefaults.Web` (`WebhookFanOutHandler.cs:38,80`); a payload over
  `MaxPayloadBytes` is logged and skipped (`WebhookFanOutHandler.cs:81-86`), because redelivery cannot
  shrink it. It builds one command per match (`WebhookFanOutHandler.cs:88-96`), schedules all of them
  inside `IUnitOfWork.ExecuteInTransactionAsync` (`WebhookFanOutHandler.cs:101-115`), and throws when
  any schedule fails (`WebhookFanOutHandler.cs:117-123`).
- **Why it's built this way**: throwing on a failed schedule makes the outbox or broker redeliver the
  event, and the deterministic delivery id keeps the redelivered rows' `webhook-id` unchanged
  (`WebhookFanOutHandler.cs:27-31`); one transaction means a partial fan-out is never committed.
  Being inert without settings (`WebhookFanOutHandler.cs:23-26`) lets `AddWebhookEvent` register it in
  any host.
- **Where it's used**: registered per event by `AddWebhookEvent<TEvent>(name)` as a singleton
  `IIntegrationEventHandler<TEvent>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Webhooks.cs:80`), so it runs
  alongside the event's other [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
  registrations.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:42`),
  calls `TryBeginAsync` before invoking handlers (`IntegrationEventConsumer.cs:82`), `Abandon` on a
  handler exception (`IntegrationEventConsumer.cs:113`), and `CompleteAsync` after they all succeed
  (`IntegrationEventConsumer.cs:123`). Implemented by [`EfInboxStore`](#efinboxstore) and
  [`NoOpInboxStore`](#noopinboxstore).
- **Caveats / not-in-source**: both registrations live inside `AddBrokerMessaging`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:63`), which returns
  early when the configured provider is in-process (`DependencyInjection.Messaging.cs:67-70`), so a monolith
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
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:136`), reaching
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:142-147`, the
  `AddHostedService` call at line 117). Covered by `InboxDisabledWarningServiceTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Inbox/InboxDisabledWarningServiceTests.cs:11`),
  which is what makes a log-only class testable at all (`[Rubric §14, Testability]`).
- **Caveats / not-in-source**: because the whole registration sits inside `AddBrokerMessaging`, which
  returns early for the in-process provider (`DependencyInjection.Messaging.cs:67-70`), a monolith host never
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:880-894`):
  the table is `dbo.InboxMessages` (`ApplicationDbContext.cs:883`), `EventType` is capped at 500
  non-Unicode characters (`ApplicationDbContext.cs:885`), `MessageId` carries a **unique** index named
  `IX_InboxMessages_MessageId` (`ApplicationDbContext.cs:886-888`), and `ProcessedOn` carries a
  second, non-unique index `IX_InboxMessages_ProcessedOn` (`ApplicationDbContext.cs:892-893`) purely
  so the age-based retention purge has something to seek instead of scanning the table
  (`ApplicationDbContext.cs:890-891`, `[Rubric §12, Performance & Scalability]`).
- **Why it's built this way**: separating `Id` (the PK for EF internals) from `MessageId` (the
  business dedup key with the unique index) follows the surrogate-key convention used elsewhere in the
  codebase, and the unique index is what turns a racing duplicate delivery into a catchable
  `DbUpdateException` rather than a read-then-write race. Storing it as a plain entity lets the same EF
  stack purge it (see [`OutboxCleanupService`](#outboxcleanupservice)) and lets a handler's own
  `SaveChangesAsync` commit it.
  **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** governs the mechanism, and the row lives in the consumer's own database
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: staged, saved, and queried by [`EfInboxStore`](#efinboxstore)
  (`EfInboxStore.cs:59,124`); purged by [`OutboxCleanupService`](#outboxcleanupservice) when the inbox
  is enabled (`OutboxCleanupService.cs:173-188`, gated on `_inboxEnabled` at
  `OutboxCleanupService.cs:53` and called at `OutboxCleanupService.cs:118-121`); configured on every
  relational context by `ApplicationDbContext.ConfigureInbox` (`ApplicationDbContext.cs:880`, called
  from line 347) (G07).
- **Caveats / not-in-source**: the type itself has **no** first-party reference (it is a plain POCO),
  so the links to `IInboxStore`/`IDomainEvent` above are conceptual, not compile dependencies. The
  configuration is skipped by the Cosmos context, which overrides `OnModelCreating`
  (`ApplicationDbContext.cs:876-878`). There is also no tenant column: a tenant with its own database
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:170`), and in
  that mode neither [`OutboxProcessor`](#outboxprocessor) nor
  [`OutboxCleanupService`](#outboxcleanupservice) is registered
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:260-268`). The delivery
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:265-268`), so a host
  either gets the two outbox background services or gets this notice, never both and never neither.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxOrigin
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxOrigin.cs:30` · Level 0 · record struct (public readonly)

- **What it is**: the pieces of ambient context (`UserId`, `UserRoles`, `TenantId`,
  `CorrelationId`, plus the raising user's `UserPermissions`) captured onto an [`OutboxMessage`](#outboxmessage) row at write time, so a handler
  running a poll cycle later sees the same principal, tenant and correlation the raising request did.
- **Depends on**: nothing first-party beyond the module's `UserIdentifierType` alias; a plain
  `readonly record struct` with four positional properties and one `init` property.
- **Concept introduced, ambient-context capture for asynchronous delivery.** `[Rubric §10, Messaging &
  Integration Architecture]` (the outbox row carries the caller's context across the process/thread
  boundary) and `[Rubric §29, Resilience & Business Continuity]` (a crash-and-retry replay still
  restores the original principal rather than an anonymous one). A synchronous handler reads
  `ICurrentUserService` and `ITenantContext` directly; an outbox-delivered handler runs on a background
  poll with neither populated, so [`OutboxMessage.FromDomainEvent`](#outboxmessage) captures this
  struct at write time and the delivery path restores it before the handler runs.
- **Walkthrough**: four positional properties, all nullable (`OutboxOrigin.cs:30-34`):
  `UserId` (`UserIdentifierType?`), `UserRoles` (`string?`, a comma-separated list), `TenantId`
  (`string?`) and `CorrelationId` (`string?`). A fifth, `UserPermissions` (`string?`, a JSON array of
  the raising user's permission claims, null when they hold none), is an `init` property in the struct
  body (`OutboxOrigin.cs:41`) rather than a positional parameter, so the shipped constructor is
  unchanged. Every field is optional because the struct's own default
  value (all nulls) is exactly what a caller with nothing to capture, or every row written before these
  columns existed, reads back as.
- **Why it's built this way**: a single positional struct groups the four values so
  `FromDomainEvent(domainEvent, origin = default)` takes one extra optional parameter instead of four,
  and a defaulted struct argument costs a caller nothing when there is no ambient context to capture
  (an unauthenticated background job, for instance). Keeping it a `record struct` rather than a class
  avoids a heap allocation on the hot save path for what is, per row, four small fields copied once.
- **Where it's used**: constructed by `DbContextFactory.AttachScopeAccessors`
  (`DbContextFactory.cs:156-160`) from `ICurrentUserService`, `AmbientOrigin.FlattenRoles`, the tenant
  context and the correlation context, and exposed through
  `ApplicationDbContext.OutboxOriginAccessor`/`CurrentOutboxOrigin`
  (`ApplicationDbContext.cs:259,265`); read by [`OutboxMessage.FromDomainEvent`](#outboxmessage) to
  populate the row's five capture columns (including `UserPermissions`, `OutboxMessage.cs:166`).
- **Caveats / not-in-source**: the struct itself does not restore anything, it only carries the values;
  the restore side (putting the captured user/tenant/correlation back onto a delivery scope) is the
  outbox processor and `AmbientOrigin` helper's job, not this type's.

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
  (`MessageBusSettings.IsInboxEnabled`, `MessageBusSettings.cs:136`), so this store is the deliberate
  opt-out path for a host that cannot query the `InboxMessages` table yet, not a quiet default. Note
  that it is registered as a **singleton** while [`EfInboxStore`](#efinboxstore) is scoped
  (`DependencyInjection.Messaging.cs:134,142`): a stateless no-op needs no per-request lifetime, an EF-backed
  store that stages rows in the scope's unit of work does. The same `else` branch also registers
  [`InboxDisabledWarningService`](#inboxdisabledwarningservice) (`DependencyInjection.Messaging.cs:147`), so
  choosing the Null Object is never silent (**[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)**).
- **Where it's used**: registered as `IInboxStore` inside `AddBrokerMessaging` on the
  `else` branch of `settings.IsInboxEnabled`, that is when `MessageBus:EnableInbox=false` is set
  explicitly (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:132-148`);
  consumed by [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:10` · Level 2 · class (public sealed)

- **What it is**: the `Outbox` configuration section, tuning the outbox background processor and its
  cleanup companion. Every property carries a default (`OutboxSettings.cs:17-118`), so the section is
  optional and a host with no `Outbox` configuration still runs a working outbox. Note the division of
  labour with [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings): that
  class decides WHETHER the outbox runs, this one decides HOW.
- **Depends on**: [`DataSource`](group-07-persistence-ef-core.md#datasource) (the engine enum) and
  [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey) (for its `DefaultName` constant),
  both imported through `MMCA.Common.Application.Interfaces.Infrastructure` (`OutboxSettings.cs:53`,
  `:62`). Externals: `System.ComponentModel.DataAnnotations` for the `[Range]` attributes.
- **Concept introduced, options binding with a static `SectionName`.** Note the convention that runs
  through every settings class in the framework: `public static readonly string SectionName = "Outbox";`
  (`OutboxSettings.cs:13`) is the single source of truth for the section name, referenced at the bind
  call instead of duplicating the literal (`DependencyInjection.cs:151`). The properties are
  `init`-only, so once materialized from configuration they are immutable for the process lifetime.

  `[Rubric §6, CQRS & Event-Driven]` assesses how reliably state changes turn into dispatched events.
  This is the knob set for the at-least-once outbox
  (**[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)**): `MaxRetries`
  (`:21`) caps attempts, and `ProcessingDelaySeconds` (`:45`) is the eligibility delay after message
  creation. It defaults to 0, so an integration event is published as soon as the post-save signal
  wakes the processor (tens of milliseconds) instead of several seconds later (`:35-36`). The delay
  does not bound the duplicate-dispatch window: on the async save path, local domain-event rows are
  inserted under the `LeaseSeconds` lease, so the in-process pipeline (save, dispatch, mark processed)
  races the processor only once that lease expires, and sync-path rows never dispatch in-process.
  Handlers must be idempotent regardless, and the doc reserves a value above 0 for holding rows back
  deliberately, for example to give a failed in-process local dispatch a pause before the processor
  retries it (`:36-42`).

  `[Rubric §29, Resilience & Business Continuity]` assesses behavior under replication and repeated
  failure. Three properties carry the weight. `LeaseSeconds` (`:90`) claims a batch for a replica so
  concurrent replicas never double-dispatch, and expires so a dead replica's rows become claimable
  again (`:80-88`, applied at `OutboxProcessor.cs:234`). The lease is checked before each row is
  dispatched and renewed for the rows not yet dispatched only once less than half of it remains, so
  half the lease must comfortably exceed the time to dispatch one message, not a whole batch; local
  domain-event rows are also inserted under it while their in-process dispatch runs (`:84-87`).
  `RetryBackoffBaseSeconds` (`:107`) makes the
  retry cadence explicit: attempt `n` waits `base * 2^(n-1)`, multiplied by a jitter factor in
  [0.8, 1.2] so rows that failed together do not retry in lockstep, then capped at `LeaseSeconds`
  (`:92-97`, implemented at `OutboxProcessor.cs:1102-1108`). The remark is worth reading as a design
  lesson: before this setting existed the claim was simply never cleared on failure, so the real retry
  cadence was an accident of the lease (300s) rather than a decision (`:98-105`).

  `[Rubric §31, Cost & FinOps]` assesses cost-relevant defaults. `PollingIntervalSeconds` (`:31`) is a
  fallback, not a hot loop (`:23-29`): with signal-based wakeup the processor wakes immediately on new
  entries and otherwise smart-waits until the earliest pending message becomes eligible, so deployed
  environments set it high (300 in this workspace) to cut idle SQL polling without adding latency for
  real traffic.

  `[Rubric §8, Data Architecture]` assesses how deliberately data is routed. The
  `DataSource` / `DatabaseName` pair (`:53`, `:62`) names where integration events published via
  [`IEventBus`](#ieventbus) are written, defaulting to the top-level connection strings so
  single-database behavior is preserved. It is a per-write target, not a global switch: the doc is
  explicit that the PROCESSOR still drains the outbox table of every relational physical source in use
  (`:58-60`, and see `OutboxProcessor.cs:153-159`).
- **Walkthrough**: one static field then eleven `init` properties, nine of them `[Range]`-validated.
  - `SectionName` (`OutboxSettings.cs:13`): static readonly `"Outbox"`, the bind key.
  - `BatchSize` (`:16-17`): `[Range(1, 1000)]`, default `50`; messages per cycle, used both to size the
    fetch (`OutboxProcessor.cs:320`) and to decide whether more eligible work remains
    (`OutboxProcessor.cs:267`, `:361`).
  - `MaxRetries` (`:20-21`): `[Range(1, 20)]`, default `5`; attempts before a message is treated as
    dead-lettered and excluded from the poll (`OutboxProcessor.cs:290`, `:424`, `:669`). The first
    failure is only re-scheduled when `MaxRetries > 1`, so `1` is honored as "the host asked for no
    retries at all" (`OutboxProcessor.cs:1080`).
  - `PollingIntervalSeconds` (`:30-31`): `[Range(1, 3600)]`, default `2`; the fallback interval.
  - `ProcessingDelaySeconds` (`:44-45`): `[Range(0, 600)]`, default `0` (no initializer, so the
    `int` default); the eligibility delay, applied as a cutoff on the message timestamp
    (`OutboxProcessor.cs:206`, `:275`).
  - `DataSource` (`:53`): default `DataSource.SQLServer`; must be a relational provider that supports
    the outbox table (SQL Server, PostgreSQL or SQLite, `:47-52`), since the outbox is a table.
  - `DatabaseName` (`:62`): default `DataSourceKey.DefaultName`; the logical source name paired with
    `DataSource`.
  - `RetentionDays` (`:69-70`): `[Range(0, 3650)]`, default `7`; days a PROCESSED message is kept
    before purge, with `0` disabling purging entirely (`OutboxCleanupService.cs:73`, cutoff at `:91`).
  - `CleanupIntervalHours` (`:77-78`): `[Range(1, 168)]`, default `6`; the purge sweep cadence, ignored
    when `RetentionDays` is `0` (`OutboxCleanupService.cs:60`).
  - `LeaseSeconds` (`:89-90`): `[Range(10, 3600)]`, default `300`; the claim window, renewed for the
    remaining rows once less than half of it is left.
  - `RetryBackoffBaseSeconds` (`:106-107`): `[Range(1, 3600)]`, default `10`; the exponential-backoff
    base described above.
  - `DeadLetterRetentionDays` (`:117-118`): `[Range(0, 3650)]`, default `0`, which falls back to
    `RetentionDays`. Set it higher to keep exhausted payloads around for diagnosis and manual replay;
    the cleanup service resolves the fallback explicitly before computing its cutoff
    (`OutboxCleanupService.cs:160-162`). The window runs from the last failed attempt, the row's
    `LockedUntil` stamp falling back to `OccurredOn`, so a replay resets it (`:113-115`).
- **Why it's built this way**: the defaults encode the framework's out-of-the-box posture
  (**[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)** outbox,
  **[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)**
  database-per-service): a host with no `Outbox` section that has the outbox switched on gets a working
  at-least-once processor writing to its single default database, while a multi-service deployment
  overrides `PollingIntervalSeconds`, `DataSource` and `DatabaseName` to tune cost and routing. The
  `[Range]` guards give fail-fast validation at bind time rather than a bad value surfacing mid-cycle
  (**[ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)**).
- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` in `AddInfrastructure`
  (`DependencyInjection.cs:150-153`). Consumed by [`OutboxProcessor`](#outboxprocessor)
  (`OutboxProcessor.cs:64`, `:66`) and [`OutboxCleanupService`](#outboxcleanupservice)
  (`OutboxCleanupService.cs:46`, `:52`) for batching, retry pacing and retention; by both event buses
  to pick the write target when publishing an integration event
  ([`InProcessEventBus`](#inprocesseventbus) `InProcessEventBus.cs:38`, `:78`;
  [`BrokerEventBus`](#brokereventbus) `BrokerEventBus.cs:35`, `:67`); and by
  [`EfInboxStore`](#efinboxstore), which deliberately reuses the same `DataSource`/`DatabaseName` pair
  so the inbox lands in the consumer's own database (`EfInboxStore.cs:46`, `:217`).
- **Caveats**: `BrokerEventBus` throws when the resolved target does not support the outbox table,
  naming both configuration keys in the message (`BrokerEventBus.cs:76`), so an outbox pointed at
  Cosmos fails on first publish rather than at bind time; the `[Range]` attributes cannot express
  "relational engines only".

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxMessage
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:15` · Level 2 · class (public sealed)

- **What it is**: a row in an `OutboxMessages` table: a JSON-serialized domain event persisted **in the
  same database transaction as its aggregate**, ready for reliable asynchronous dispatch, plus all the
  bookkeeping the processor needs (retry state, claim lease, trace context, ordering key).
- **Depends on**: [`IDomainEvent`](#idomainevent) and
  [`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey) (G02),
  [`EventNameResolver`](#eventnameresolver), [`OutboxOrigin`](#outboxorigin); BCL `System.Text.Json`,
  `System.Diagnostics.Activity` (trace capture) and `System.Collections.Concurrent` (the type cache).
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
    same instance is reused on the read side (line 194) so payloads round-trip symmetrically.
  - Static `EventTypeCache` (`OutboxMessage.cs:30`), a `ConcurrentDictionary<string, Type?>` keyed
    ordinally by the **stored** name, memoizing the reflection that `DeserializeEvent` would otherwise
    run per row. Only a successful resolution is cached (lines 22-29): an unresolvable name is
    re-scanned on its retry, so an assembly that loads late can still resolve it before the row
    dead-letters.
  - **Identity and payload** (`OutboxMessage.cs:33-46`): `Id` (`Guid`, defaulted to `Guid.NewGuid()`,
    line 33); `EventType` (`required`, the stored identity, line 40); `Payload` (`required`, the JSON
    string, line 43); `OccurredOn` (the business timestamp copied from `IDomainEvent.DateOccurred`, line
    46). All `init`-only. `EventType` is documented as the `EventNameAttribute` name when the event
    declares one and the assembly-qualified type name otherwise (lines 35-39).
  - **Processing state** (`OutboxMessage.cs:49-70`), deliberately *settable* because the processor
    mutates it: `ProcessedOn?` (null until dispatched, line 49); `RetryCount` (line 52); `LockedUntil?`
    (line 60) and `LockToken?` (line 67); `LastError?` (line 70).
  - **The claim lease** is the part worth slowing down for. `LockedUntil` is the UTC timestamp until
    which the row is leased to one processor replica, and its doc states the consequence plainly: rows
    with an unexpired lease are skipped by other replicas' polls, making scale-out safe by construction,
    where before the lease two replicas could drain the same rows and double-dispatch every event
    (lines 54-59). `LockToken` is the claim token written together with the lease, so the claiming
    replica processes only rows carrying **its own** token, which is what stops a race between two claim
    updates from handing the same row to both (lines 62-66).
  - **Trace context** (`OutboxMessage.cs:73-85`): `TraceId?`/`SpanId?` (lines 73, 76), W3C ids captured
    at write time and `init`-only, so a trace can be resumed across the asynchronous hop, plus
    `TraceFlags?` (`byte?`, line 85), the W3C trace flags of the activity current when the event was
    raised, which is the request's sampling decision. The processor rebuilds the parent context with
    those flags, so a parent-based sampler exports the delivery span only when the request itself was
    sampled, and a null (no ambient activity, or a row written before the column existed) reads as not
    sampled (lines 78-84, consumed at
    `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:1152`).
  - **Ordering key** (`OutboxMessage.cs:97`): `OrderingKey?`, copied from an event implementing
    [`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey). Its doc gives the
    invariant the processor enforces (lines 87-96): a row carrying a key is not claimed while an
    earlier unprocessed, non-dead-lettered row with the same key exists in the same data source, so
    events for one aggregate reach the bus in the order they were raised, across batches and across
    replicas, with the head-of-line blocking that implies.
  - **The ambient-context capture** (`OutboxMessage.cs:99-131`): `TenantId?`, `UserId?`
    (`UserIdentifierType?`), `UserRoles?`, `UserPermissions?` (`OutboxMessage.cs:124`, a JSON array of
    the raising user's permission claims, restored as `permission` claims so a handler authorizing on a
    claim-only grant sees what the raising request saw; unbounded and never truncated) and
    `CorrelationId?`, all `init`-only, copied from an
    [`OutboxOrigin`](#outboxorigin) at write time and restored onto the delivery scope before a handler
    runs, so a poll-cycle-later dispatch sees the same tenant, principal, roles, permissions and
    correlation id the raising request did. Every one is null for a row written before these columns existed or for a
    tenant-less/system-raised event, which is deliberate: it is exactly the struct's own default.
  - **`FromDomainEvent(IDomainEvent, OutboxOrigin)`** (`OutboxMessage.cs:149-174`), the static factory.
    It null-guards the event (line 142), captures `Activity.Current` (line 145), resolves the stored
    name through [`EventNameResolver.GetStorageName`](#eventnameresolver) (line 148), serializes
    against the *runtime* type (line 149), copies the five [`OutboxOrigin`](#outboxorigin) fields onto
    the row (lines 153-157, `UserPermissions` at 156), and copies the ordering key with
    `(domainEvent as IHasOrderingKey)?` (line 162). `origin` defaults to `default(OutboxOrigin)` (line
    140), so a caller with nothing to capture
    keeps the single-argument call and every capture column stores null. The comment above the ordering
    key cast is the subtle bit (lines 159-161): the interface test cannot be replaced by a type-level
    flag, because an implementing event returning `null` opts *that one instance* out of ordered
    delivery.
  - **`DeserializeEvent()`** (`OutboxMessage.cs:186-195`) resolves the type (line 170), returns `null`
    rather than throwing when it cannot (lines 171-172) so the processor can dead-letter the row instead
    of crashing, and otherwise deserializes with the shared options (line 176).
  - **`ResolveEventType()`** (`OutboxMessage.cs:199-216`) checks the cache with `TryGetValue` first
    (lines 193-196), then does a two-step lookup, and the comment says the order is load-bearing
    (lines 198-200): `Type.GetType` runs **first** so a row storing an assembly-qualified name resolves
    by a direct lookup, and the attribute scan
    ([`EventNameResolver.FindTypeByDeclaredName`](#eventnameresolver)) only runs for a stored name that
    is not a CLR name (line 201). It writes the cache only when the result is non-null (lines 202-205),
    so a failure is not cached and the one-shot retry the processor grants an unresolvable row really
    scans again. `IsEventTypeCached` (`OutboxMessage.cs:200`) is an `internal` test hook that exposes
    whether a stored name is in the cache.
- **Why it's built this way**: persisting events in the same transaction, not after it, is the only way
  to guarantee no event is lost. JSON keeps rows human-readable for debugging; the stored identity
  enables polymorphic deserialization; the per-name type cache keeps the hot poll path off reflection;
  `TraceId`/`SpanId` let traces span the asynchronous hop; the [`OutboxOrigin`](#outboxorigin) capture
  columns let a delivered handler run authorization checks and stamp audit fields against the same
  principal a synchronous dispatch would have seen instead of running anonymously; and the lease pair
  moves scale-out safety from a deployment convention (`minReplicas: 1`) into the data model. The EF
  configuration completes the picture
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:682-717`):
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
  (`DomainEventSaveChangesInterceptor.cs:267`), by [`InProcessEventBus`](#inprocesseventbus)
  (`InProcessEventBus.cs:91`) and by [`BrokerEventBus`](#brokereventbus) (`BrokerEventBus.cs:81`);
  read, claimed and dispatched by the [`OutboxProcessor`](#outboxprocessor); marked processed in bulk
  by [`OutboxFinalizer`](#outboxfinalizer); listed and replayed by
  [`OutboxAdministration`](#outboxadministration); purged by
  [`OutboxCleanupService`](#outboxcleanupservice).
- **Caveats / not-in-source**: an event that has **not** adopted
  [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) stores its
  assembly-qualified name, so a rename or assembly move makes `Type.GetType` return null for rows
  already written, the failure is not cached (`OutboxMessage.cs:230-233`), and the row dead-letters with
  reason `type_unresolvable` after the processor's one retry, which re-scans the name.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### EfInboxStore
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Inbox` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:43` · Level 13 · class (public sealed partial)

- **What it is**: the EF-backed inbox. It records processed message ids in the consumer's own database
  so a redelivered broker message is skipped, and it stages that record inside the handlers' own unit
  of work so the record and the handlers' writes commit together.
- **Depends on**: [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>` (to find the
  publish-target source), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (the consume
  scope's user, used to stamp the save), `ILogger<EfInboxStore>` and a `TimeProvider` (the clock that
  stamps `ProcessedOn`), all via primary constructor (`EfInboxStore.cs:43-49`); the
  [`InboxMessage`](#inboxmessage) entity; resolves an
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext); EF Core's
  `EntityEntry<T>` and `EntityState` for the staging bookkeeping.
- **Concept introduced, staging the dedup row into the handler's transaction.**
  `[Rubric §6, CQRS & Event-Driven]` (idempotent consumers), `[Rubric §8, Data Architecture]`
  (transaction boundaries) and `[Rubric §29, Resilience]`. The naive inbox writes its row *after* the
  handlers commit, which leaves a window: crash in between and the whole event is reprocessed. This
  store closes that window by construction (`EfInboxStore.cs:18-24`): the row is added to the same
  scoped [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) the handlers
  write through, so the first handler's own `SaveChangesAsync` commits the inbox row in its
  transaction. `CompleteAsync` then writes the row afterwards only when the database shows nothing else
  did (an event whose handlers write nothing, or a handler save that rolled back). The class comment is careful about the limit
  (`EfInboxStore.cs:28-34`): atomicity holds only when the handler writes to the **same physical
  source** this store resolves (the `Outbox:DataSource`/`Outbox:DatabaseName` pair, which is the single
  database of a monolith or of a service that owns one). A handler writing to a different physical
  source is back to two transactions, and delivery is then at-least-once again, which is the contract
  handlers are written against anyway.
- **Walkthrough**
  - `_staged` (`EfInboxStore.cs:56`) is a plain `Dictionary<Guid, EntityEntry<InboxMessage>>` of rows
    opened but not yet closed out. The comment justifies the non-concurrent collection
    (`EfInboxStore.cs:51-55`): the store is scoped per consumed message, so it holds one entry in
    practice and is never touched from two threads.
  - `AlreadyProcessedAsync` (`EfInboxStore.cs:59-65`) resolves the context and issues a single
    `AnyAsync` for an [`InboxMessage`](#inboxmessage) with the given `MessageId` under `AsNoTracking`
    (`EfInboxStore.cs:62-64`), which the unique index turns into an index seek. It returns the `Task`
    directly rather than awaiting it, and the no-tracking read means the probe never adds an entry to
    the change tracker.
  - `TryBeginAsync` (`EfInboxStore.cs:68-75`) short-circuits to `false` when the message was already
    processed (lines 70-71), otherwise stages a row into `_staged` and returns `true` (lines 73-74).
  - `Stage` (`EfInboxStore.cs:139-149`) resolves the context and `Add`s a new
    [`InboxMessage`](#inboxmessage) (lines 143-148) whose `ProcessedOn` comes from the injected clock,
    `timeProvider.GetUtcNow().UtcDateTime` (line 147), rather than the ambient `DateTime.UtcNow`, so a
    test can pin the stamp. A scoped `VSTHRD103` suppression notes that EF's `DbSet.Add` is
    intentionally synchronous because it is an in-memory operation (lines 142 and 149). Note it
    returns the `EntityEntry`, which is the handle the rest of the class reads state from.
  - `CompleteAsync` (`EfInboxStore.cs:78-106`) removes the staged entry and reads its state through
    `TrackedState` (lines 80-83). `Added` still means no handler saved, so the row is persisted now and
    the method returns (lines 84-88). Anything else only USUALLY means a handler's own
    `SaveChangesAsync` committed the row atomically with its mutations: a save inside a transaction
    that then rolled back leaves the entry `Unchanged` with no row, and an execution-strategy retry
    clears the change tracker (`Detached`) before the handler re-runs without it (lines 90-94). So the
    method confirms with `AlreadyProcessedAsync` and returns only when the row really exists (line 95);
    otherwise it detaches the stale entry (lines 98-99) and falls through. When there is no staged
    entry at all (a caller that skipped `TryBeginAsync`, or a second `CompleteAsync`), or the staged
    row never reached the database, it uses the stage-then-save path so the message is still recorded
    (lines 102-105).
  - `Abandon` (`EfInboxStore.cs:109-133`) is the failure branch. No staged row means nothing to undo,
    return `true` (lines 111-112). Otherwise it reads the tracked state, remembers whether it was
    `Added`, and **detaches** the entry rather than leave it `Added` (lines 114-120), because the
    context is cached for the whole scope and a surviving `Added` row would be re-attempted by any
    later save on that scope (lines 117-118). A state other than `Added` is no longer taken as proof
    that a handler committed the row, since that save may since have rolled back or the tracker been
    cleared for a retry (lines 122-124): `RowCommitted` checks the database, and when the row is absent
    (or the entry was `Added`) the method returns `true` (line 125). Only when the row really is
    committed does the store log a Warning and return `false` (lines 128-132), and the comment says
    plainly that the redelivery will be skipped as a duplicate so the handlers that had not run yet
    never will, which is the one case where this design loses work a pure after-the-fact inbox would
    have retried.
  - `MarkProcessedAsync` (`EfInboxStore.cs:136-137`) is a thin stage-and-save, kept because it is
    the abstract member of the port.
  - `SaveStagedAsync` (`EfInboxStore.cs:151-184`) saves and then handles the race. The save is
    `context.SaveChangesAsync(currentUserService.UserId, ...)` (line 165): the publisher's origin is
    restored onto the consume scope before the inbox is touched, and the context is the one a handler
    resolved from that scope, so anything else it left pending is flushed by this save too and is
    stamped with the consume scope's user rather than as the system (lines 161-164). Its
    `catch (DbUpdateException)` (line 167) does three things in order. First it **detaches the rejected
    entry** (line 173), for the same scope-caching reason, and the comment names the identical idiom in
    [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
    (lines 169-172). Second it **re-queries** through `AlreadyProcessedAsync` and rethrows when the row
    is still absent (lines 180-181): only a concurrent duplicate delivery tripping the unique index is
    safe to absorb, and the comment is explicit that re-querying beats sniffing provider-specific error
    codes because the check must hold for SQL Server and SQLite alike, and that swallowing any other
    write failure would ack a message whose inbox row was never written (lines 175-179). Third, and
    only then, it logs the absorbed duplicate at Debug (line 183, source-generated at lines 222-223).
  - `TrackedState` (`EfInboxStore.cs:191-194`) answers what state the staged row has NOW. It looks the
    entity up in the context's `ChangeTracker.Entries<InboxMessage>()` and reports `Detached` when it
    is no longer tracked, because after `ChangeTracker.Clear()` (an execution-strategy retry) the stored
    `EntityEntry` is stale and can still report `Added` (lines 188-191).
  - `RowCommitted` (`EfInboxStore.cs:201-213`) is the synchronous database check `Abandon` uses (it
    runs only on a handler-failure path): an `AsNoTracking` `Any` on `MessageId`. A check that itself
    fails with a `DbException` or `InvalidOperationException` answers `true`, the conservative reading
    that keeps the warning (lines 204-212).
  - `ResolveContext` (`EfInboxStore.cs:215-219`) routes to the configured outbox data source by
    resolving `OutboxSettings.DataSource`/`DatabaseName` through
    [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) (line 218) and asking
    the factory for that context (line 219), so the inbox lands in the same database as the outbox.
- **Why it's built this way**: dedup by `MessageId` (the [`IDomainEvent`](#idomainevent) member
  introduced at Level 0) makes redelivery safe without distributed locks, and storing the row in the
  consumer's *own* database keeps it within the database-per-service boundary ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) while
  making the same-transaction commit possible at all. Relying on the unique index and confirming the
  violation by re-query avoids a read-then-write race between concurrent deliveries without hiding a
  genuine write failure: a handler's own save surfaces the `DbUpdateException` so its mutations roll
  back and the broker redelivers into the skip path (`EfInboxStore.cs:35-41`).
  **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** is the governing decision, including its 2026-08-26 revision, which is what
  made the inbox the resolved default for a broker transport and moved the row into the handler's unit
  of work.
- **Where it's used**: registered as the scoped `IInboxStore` whenever
  `MessageBusSettings.IsInboxEnabled` resolves true, which for a broker transport is the default
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:132-134`); driven by
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) around handler invocation
  (`IntegrationEventConsumer.cs:82,102,123`); its rows are purged by
  [`OutboxCleanupService`](#outboxcleanupservice) (`OutboxCleanupService.cs:173-188`). Exercised
  directly by `EfInboxStoreTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Inbox/EfInboxStoreTests.cs:28`).
- **Caveats / not-in-source**: the inbox key is the event's `[EventName]` identity when it declares
  one and its short type name otherwise, resolved by the caller, not by this store
  ([`EventNameResolver`](#eventnameresolver), called at `IntegrationEventConsumer.cs:82`). Whether a
  given handler's `SaveChangesAsync` actually lands on the same physical source as the resolved outbox
  data source is a per-host configuration question that is not determinable from this file alone.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxAdministration
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxAdministration.cs:36` · Level 16 · class (public sealed partial)

- **What it is**: the EF-backed operator surface over the outbox tables this host owns. It lists dead
  letters, replays them back into the pending pool, and counts the pending backlog, over exactly the
  same targets the [`OutboxProcessor`](#outboxprocessor) drains and the
  [`OutboxCleanupService`](#outboxcleanupservice) sweeps.
- **Depends on**: `IServiceScopeFactory`, `ILogger<OutboxAdministration>`,
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`,
  [`FrameworkTableTargets`](group-07-persistence-ef-core.md#frameworktabletargets) and
  [`IOutboxSignal`](#ioutboxsignal), all via primary constructor (`OutboxAdministration.cs:32-37`);
  implements
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
  operator decides about a replay depends on reading it (`IOutboxAdministration.cs:95-99`), a
  `[Rubric §30, Compliance, Privacy & Data Governance]` choice.
- **Walkthrough**
  - **Guards and paging.** `MaxPageSize` is 500 (`OutboxAdministration.cs:45`), so an admin call cannot
    ask for the whole table at once, and the two validation errors are preallocated `Error.Validation`
    values (lines 42-46).
  - `ListDeadLettersAsync` (`OutboxAdministration.cs:74-135`) validates `skip` and `take` (lines 57-61),
    resolves its targets and fails with a `NotFound`-shaped error when a named source is not owned by
    this host (lines 63-65, 192-195), then queries each target for unprocessed rows whose `RetryCount`
    has reached `MaxRetries`, ordered by `OccurredOn` then `Id`, projected straight into
    `OutboxDeadLetter` under `AsNoTracking` (lines 81-95). Two details are commented in place: the
    source name is materialized *outside* the query because inside the projection it would be a method
    call EF has to translate (lines 72-74), and each target returns at most `skip + take` rows because
    **paging is applied across the merged result**, so "skip 50" means the same thing whether the host
    owns one database or four (lines 76-78, merged at lines 101-104). The per-target row cap is
    `perTarget = (int)Math.Min((long)skip + take, int.MaxValue)` (line 70, used at `.Take(perTarget)`,
    line 90): the sum is widened then clamped because `skip + take` in `int` arithmetic wraps negative
    for a skip near `int.MaxValue` and the database then rejects the negative FETCH/LIMIT; clamped, a
    deep page simply comes back empty (lines 67-69).
  - `ReplayDeadLettersAsync` (`OutboxAdministration.cs:138-194`) is expressed as one set-based
    `ExecuteUpdateAsync` per target rather than as loaded entities, because an operator replaying a
    backlog is replaying thousands of rows and none of the values written depend on the row's current
    state (class doc, lines 22-24). The update resets `RetryCount` to zero, which is what returns the
    row to the poll's predicate, and clears `LockedUntil` and `LockToken` so it is claimable on the very
    next cycle instead of after `LeaseSeconds` (lines 141-146). `LastError` survives on purpose: the
    comment calls it the record of *why* this row needed replaying, and a replay that erased it would
    destroy the only evidence (lines 137-140). An optional id filter narrows the scope (lines 132-135),
    each non-empty target logs at Warning (lines 150-153, `LogReplayed` at 223-224), and when anything
    was replayed it calls [`IOutboxSignal.Signal()`](#ioutboxsignal) rather than leaving the work to a
    polling interval deployed environments set as high as 300 seconds (lines 158-163).
  - `RepublishProcessedAsync` (`OutboxAdministration.cs:206-277`) is the recovery for a broker-side
    loss after a successful publish, or a transport cutover where the old revision published to
    entities nothing consumes any more: it returns the INTEGRATION-event rows processed inside
    `[fromUtc, toUtc)` to the pending pool across every owned source
    (`IOutboxAdministration.cs:56-81`). It is refused with the `Error.Conflict`
    `Outbox.RepublishRequiresInbox` before anything is touched unless the consumer inbox is enabled
    (lines 211-215, error at 65-68), read once at construction from the sixth constructor parameter,
    `IOptions<`[`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)`>`
    (`OutboxAdministration.cs:42`, `_inboxEnabled` at line 71), because the inbox is what turns a
    republished event into a harmless duplicate. `ValidateRepublishWindow` (lines 309-318) then
    requires both bounds UTC, a non-empty range and a width of at most `MaxRepublishWindow`, seven days
    (line 54), each failure a preallocated `Error.Validation` (lines 56-63). The table stores no event
    kind, so each source is first asked for the DISTINCT stored names processed in the window (lines
    233-240), each name is resolved by `IsIntegrationEvent` through
    [`OutboxMessage.ResolveStoredEventType`](#outboxmessage), the same cache and lookup order the
    processor uses, and kept only when it is assignable to
    [`IIntegrationEvent`](#iintegrationevent) (lines 320-322). Domain-event rows are never reset,
    because their handlers run in-process with no inbox and already ran
    (`IOutboxAdministration.cs:65-66`), and a name this host cannot resolve is left alone (remarks,
    lines 196-205). One set-based `ExecuteUpdateAsync` per source then clears `ProcessedOn`,
    `RetryCount`, `LockedUntil` and `LockToken`, leaving `LastError` and `OccurredOn` untouched so
    ordering keys hold (lines 248-260). Every source logs at Warning, a zero included, because the
    republish is an operator action whose record should show which sources had nothing (lines
    264-267, `LogRepublished` at 357-358), and the processor is signalled when anything moved (lines
    271-274).
  - `CountPendingAsync` (`OutboxAdministration.cs:280-301`) sums `LongCountAsync` over unprocessed rows
    with `RetryCount < MaxRetries` across every selected target. Its interface doc draws the line
    against the gauge (`IOutboxAdministration.cs:83-88`): this counts the tables at the moment of the
    call and **includes** rows currently under a claim lease, where `outbox.pending.depth` reports what
    the processor last observed.
  - **Target selection and scoping.** `SelectTargets` (`OutboxAdministration.cs:334-335`) is a one-line
    call to the injected
    [`FrameworkTableTargets.Named`](group-07-persistence-ef-core.md#frameworktabletargets), passing the
    outbox's own `DataSource`/`DatabaseName` and the optional operator-supplied name. That shared type
    answers the target question once for every framework-table sweeper: every relational physical
    source in use (Cosmos skipped), plus the configured publish target when its engine is relational,
    expanded per tenant that keeps its own copy
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/FrameworkTableTargets.cs:54-64`),
    then optionally narrowed to one target matched case-insensitively against its display name
    (`FrameworkTableTargets.cs:75-82`). It is recomputed per call for the same reason the processor
    recomputes it per cycle: module assemblies can register entities after startup (doc, lines 197-201).
    `VisitAsync<T>` (lines 210-221) runs the work for one target in its **own** DI scope, created through
    the shared `scopeFactory.CreateTenantScope(target)` extension
    ([`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets)) that sets the
    tenant *before* the context is asked for, because the tenant is what routes the scoped factory to
    that tenant's database and is also what the query filter reads (line 217).
- **Why it's built this way**: reusing the processor's exact target expansion means an operator screen
  can never show a different set of databases than the one being drained, including per-tenant copies
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). Replay is intentionally
  *not* a delete-and-reinsert: `OccurredOn` is untouched, so a replayed row keeps its place in its
  ordering key (`IOutboxAdministration.cs:36-41`), which is what makes replay safe for events that
  declare an [`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey).
- **Where it's used**: registered scoped as
  [`IOutboxAdministration`](group-07-persistence-ef-core.md#ioutboxadministration) by
  `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:270-273`), with the
  comment explaining the lifetime: scoped, because it creates one child scope per data source it visits
  and holds no state of its own. Its `FrameworkTableTargets` dependency is registered with
  `TryAddSingleton` (`DependencyInjection.cs:97`). The framework ships no endpoint for it; a host exposes it from an admin
  endpoint, a support command or a scheduled job (`IOutboxAdministration.cs:10-14`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxCleanupService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Administration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxCleanupService.cs:43` · Level 16 · class (public sealed partial, `PeriodicBackgroundService`)

- **What it is**: the periodic sweeper that purges spent outbox rows (both **processed** rows and
  **dead-lettered** rows whose retries are exhausted) and, when the inbox is enabled, inbox rows, past
  their retention windows, from every relational target the host owns, including each tenant database
  that keeps its own copy of a source.
- **Depends on**: `IServiceScopeFactory`, `ILogger<OutboxCleanupService>`,
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`,
  `IOptions<`[`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)`>`,
  [`FrameworkTableTargets`](group-07-persistence-ef-core.md#frameworktabletargets) (which decides the
  databases, including per-tenant copies, that hold the tables it sweeps) and a required
  `TimeProvider` (forwarded straight to the
  [`PeriodicBackgroundService`](group-14-module-system-composition.md#periodicbackgroundservice) base
  it extends) (`OutboxCleanupService.cs:43-50`); resolves an
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) and, for a tenant target, an
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) per sweep, both through the shared
  `scopeFactory.CreateTenantScope(target)` helper
  ([`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets)); its work list
  is a list of [`TenantDataSourceTarget`](group-07-persistence-ef-core.md#tenantdatasourcetarget)
  values; operates on
  the [`OutboxMessage`](#outboxmessage) and [`InboxMessage`](#inboxmessage) entities.
- **Concept introduced, retention as a privacy and storage control (plus a clock injection point).**
  `[Rubric §30, Compliance, Privacy & Data Governance]` assesses bounded retention of data that may
  contain PII, `[Rubric §8, Data Architecture]` assesses lifecycle management of operational tables,
  `[Rubric §31, Cost Efficiency]` assesses storage growth, and `[Rubric §14, Testability]` assesses
  whether time-driven code can be tested. The [`OutboxProcessor`](#outboxprocessor) only ever *sets*
  `ProcessedOn`, and a message that exhausts `MaxRetries` keeps `ProcessedOn` null forever, so without
  this sweep the outbox, which stores serialized event payloads that may contain personal data, grows
  without bound and dead rows linger in the pending index every poll re-scans (class doc, lines 15-30,
  citing ADR-003 and ADR-005 at line 21). The `TimeProvider` is now a required constructor parameter rather than an
  optional one defaulting to `TimeProvider.System`, because the base
  [`PeriodicBackgroundService`](group-14-module-system-composition.md#periodicbackgroundservice) owns
  the clock all its waits go through; a private `_timeProvider` field re-reads the same value under this
  type's own name only because capturing the base constructor's own parameter into this type's state
  would be a compiler error, CS9107 (comment, `OutboxCleanupService.cs:55-56`). A test can still drive
  the hour-scale sweep loop deterministically instead of waiting real hours, now through the base's
  injected clock.
- **Walkthrough**
  - The fixed-interval loop itself (delay, cycle, retry-on-failure, log-and-continue) moved to the
    shared [`PeriodicBackgroundService`](group-14-module-system-composition.md#periodicbackgroundservice)
    base; this type now supplies only the four hooks the base calls. `Interval` returns
    `CleanupIntervalHours` hours (`OutboxCleanupService.cs:60`, default 6, `OutboxSettings.cs:78`) and
    `StartupDelay` reuses it verbatim (lines 61-65), so the first sweep still waits one full interval
    before running, which keeps cleanup off the critical path of startup or migration work. `IsEnabled`
    (lines 67-80) is the documented off switch: it returns `false`, and logs, when `RetentionDays <= 0`
    (line 72). `ExecuteCycleAsync` delegates straight to `PurgeAsync` (line 83), and `LogCycleFailure`
    overrides the base's generic message with this service's own event id (line 86, `LogCleanupError`
    at 211-212).
  - `PurgeAsync` (`OutboxCleanupService.cs:89-136`) computes the cutoff from
    `_timeProvider.GetUtcNow().UtcDateTime` minus `RetentionDays` (line 90, default 7,
    `OutboxSettings.cs:70`), then walks `GetRelationalTargets()` (line 92). For each target it opens a
    scope through the shared `scopeFactory.CreateTenantScope(target)` helper (line 98), which sets the
    tenant on the scope **before** the context is asked for, because the tenant is what routes the
    scoped factory to that tenant's database. It then deletes processed rows older than the cutoff with
    [`BatchedDelete.DeleteAsync`](group-07-persistence-ef-core.md#batcheddelete) ordered by
    `ProcessedOn` (lines 104-115), which reads ids and deletes by id at most `BatchSize` = 1000 rows per
    statement, so a first sweep over a long-neglected table is not one enormous delete with one lock
    footprint and one transaction, and observes cancellation between batches
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Retention/BatchedDelete.cs:8-23`).
    Its callback reports the rows actually removed exactly once, even when a later batch throws
    (`BatchedDelete.cs:30-33`), and logs at Information when anything went. The dead-letter sweep
    (ordered by `LockedUntil ?? OccurredOn`, lines 168-181) and the inbox purge (ordered by
    `ProcessedOn`, lines 184-200) go through the same helper, and the per-target `catch` carries a
    scoped `CA1031` suppression (lines 128-130).
  - **The dead-letter sweep** (`SweepDeadLettersAsync`, `OutboxCleanupService.cs:149-171`) is the
    second, separate pass, and its doc is worth reading in full (lines 132-148): dead-lettered rows keep
    `ProcessedOn` null forever, so the processor's poll excludes them (`RetryCount < MaxRetries`) but the
    processed sweep never reaches them either, and they accumulate *inside* the pending index. They are
    purged on their own window, `DeadLetterRetentionDays` falling back to `RetentionDays` when it is 0
    (lines 154-156, and 0 is the default, `OutboxSettings.cs:118`). The window runs from the last failed
    attempt: the filter keys on `LockedUntil ?? OccurredOn` (lines 160-163). The processor stamps
    `LockedUntil` on every failed attempt, the exhausting one and the unresolvable-type dead-letter path
    included (`OutboxProcessor.cs:1091-1093`), a replay clears it and the next failure re-stamps it, and
    `OccurredOn` covers a row that was never stamped. A replayed or long-delayed row therefore keeps its
    full window instead of being purged on the next sweep (lines 139-143). This permanently abandons an
    undelivered event, which is why the deletion logs at **Warning** (line 169, `LogDeadLetterPurged` at
    205-206) while the processed purge logs at Information (`LogPurged` at 202-203), and why the doc
    points at [`OutboxAdministration`](#outboxadministration) as the thing to use before the window
    closes.
  - Inbox rows are purged only when the inbox is enabled (lines 115-118, the flag captured once at
    construction from `MessageBusSettings.IsInboxEnabled`, line 52), delegating to `PurgeInboxAsync`
    (lines 173-188), which deletes [`InboxMessage`](#inboxmessage) rows with `ProcessedOn < cutoff`.
  - A single unreachable database does not stop the others: the per-target `catch` logs and moves on
    (lines 124-128), while a real cancellation is rethrown (lines 120-123). `GetRelationalTargets`
    (lines 196-197) is a one-line call to the injected
    [`FrameworkTableTargets.Relational`](group-07-persistence-ef-core.md#frameworktabletargets) with the
    outbox's own `DataSource`/`DatabaseName`: every relational source backing a registered entity plus
    the configured publish target, against the shared database, plus one extra unit per tenant that
    keeps its own copy
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/FrameworkTableTargets.cs:54-64`).
    That per-tenant expansion is the only reason a per-tenant database's outbox and inbox tables ever
    get swept ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)), and because
    the processor, both operator surfaces and the other cleanup services ask the same type, the sweep
    cannot visit a different set of databases than the one being drained
    (`FrameworkTableTargets.cs:16-18`).
- **Why it's built this way**: bounded retention keeps both storage cost and PII exposure in check;
  doing it as a `DELETE` rather than load-then-remove is the efficient path; and per-target error
  isolation keeps one bad database from blocking the sweep.
  [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html) has the inbox reuse
  this same sweep, gated on the inbox flag, rather than adding a second housekeeping service.
- **Where it's used**: registered as a hosted service alongside the
  [`OutboxProcessor`](#outboxprocessor), inside the same `IsOutboxEnabled` gate
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:260-264`), so a host with
  the outbox disabled runs neither and gets
  [`OutboxDisabledNoticeService`](#outboxdisablednoticeservice) instead.
- **Caveats / not-in-source**: the inbox purge uses the *outbox* `RetentionDays` cutoff
  (`OutboxCleanupService.cs:121`), not a separate inbox window, so shortening outbox retention shortens
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:248`). `Signal()` is
  called by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  on all three of its paths
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:150,387,401`),
  by [`BrokerEventBus`](#brokereventbus) after writing its outbox batch
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:93`), and by
  [`OutboxAdministration`](#outboxadministration) after a replay
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxAdministration.cs:190`).
  `WaitAsync` is awaited by the [`OutboxProcessor`](#outboxprocessor) loop
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:169`),
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:186`),
  produced per source by `ProcessSourceAsync` (`OutboxProcessor.cs:230,241,258-262`), and consumed by
  `ExecuteAsync` to either continue immediately (`OutboxProcessor.cs:162-166`) or wait for the
  duration `ComputeWaitTime` derives from it (`OutboxProcessor.cs:164-169`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxMetrics
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs:16` · Level 1 · class (internal static)

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
    than dropping out of the series, so "drained" stays distinguishable from "host stopped". Unlike
    the depth gauge, a source whose database was unreachable keeps its previous age until its next
    successful cycle (lines 96-97). The dead-letter counter's description names both reasons
    (`OutboxMetrics.cs:44`).
- **Why it's built this way**: static instruments on one shared meter is the idiomatic
  `System.Diagnostics.Metrics` shape and costs nothing when no listener is attached. `Interlocked` on
  the depth field and a `ConcurrentDictionary` for the per-source ages keep the observation callbacks
  lock-free while the processor writes them from its own loop. Making the depth a *gauge fed by the
  cycle* rather than an independent query means the steady state pays no extra database round-trip:
  see `CountPendingAsync`, which derives the depth from the fetch itself unless the batch came back
  saturated (`OutboxProcessor.cs:273-294`).
- **Where it's used**: `DeadLetterCounter` on both dead-letter paths (`OutboxProcessor.cs:1094-1097` for
  an unresolvable type, `:686-689` for exhausted retries); `ProcessedCounter` and
  `DispatchLagHistogram` on the success path (`OutboxProcessor.cs:985,990-992`); `SetOldestPendingAge`
  per source right after its fetch (`OutboxProcessor.cs:214-216`); and `SetPendingDepth` once per
  cycle after every target has been drained (`OutboxProcessor.cs:184`).
- **Caveats / not-in-source**: the circuit-open signal the processor emits alongside these lives on a
  *different* meter,
  [`BrokerMetrics.CircuitOpenCounter`](group-14-module-system-composition.md#brokermetrics), not on
  `OutboxMetrics` (`OutboxProcessor.cs:669-671`).

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
  - `FindTypeByDeclaredName(string)` (`EventNameResolver.cs:76-82`) is the reverse lookup for a stored
    name that is not a CLR name: it scans the loaded, non-dynamic assemblies for the type declaring
    that name. Two performance details are deliberate (lines 69-73): the LINQ query stays lazy so the
    scan stops at the first match instead of materializing every loaded type, and `Type.IsDefined` comes
    first in the predicate because it answers without constructing the attribute, so only the handful of
    annotated types pay for construction. It is reached once per stored name that resolves, because the
    caller caches only a successful result; a name that matches nothing is scanned again on its retry
    (lines 62-68).
  - `GetLoadableTypes(Assembly)` (`EventNameResolver.cs:91-101`) catches `ReflectionTypeLoadException`
    and degrades to `ex.Types.OfType<Type>()`, the subset that did load, so one unloadable type cannot
    stop a scan whose answer may live in a later assembly.
- **Why it's built this way**: putting the decision in one static class is what keeps the outbox and
  the inbox from drifting into two different notions of "the event's name", which would silently break
  dedup. The attribute is documented as a before-the-refactoring move
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/EventNameAttribute.cs:14-19`): it changes
  only what NEW rows store, so applying it while the outbox holds pending rows is a two-step operation,
  drain first, then rename.
- **Where it's used**: `GetStorageName` in `OutboxMessage.FromDomainEvent`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:157`);
  `FindTypeByDeclaredName` in `OutboxMessage.ResolveEventType` (`OutboxMessage.cs:229`), as the
  fallback after `Type.GetType` fails; `GetDeclaredName` in the broker entity naming
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Broker/BrokerNaming.cs:29`);
  `GetInboxName` in
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:82`) and
  [`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:72`).
- **Caveats / not-in-source**: `FindTypeByDeclaredName` searches only **loaded** assemblies
  (`EventNameResolver.cs:77`), which is precisely why the processor treats the first unresolvable
  attempt as transient (see `HandleUnresolvableType` under [`OutboxProcessor`](#outboxprocessor)).
  Uniqueness of a declared name across a host's events is a documented requirement of the attribute
  (`EventNameAttribute.cs:20-24`), not something this resolver enforces.

### OutboxSignal
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxSignal.cs:10` · Level 1 · class (public sealed)

- **What it is**: the `SemaphoreSlim`-based [`IOutboxSignal`](#ioutboxsignal) that wakes the
  [`OutboxProcessor`](#outboxprocessor) the instant new outbox entries are written.
- **Depends on**: [`IOutboxSignal`](#ioutboxsignal) (the port it implements) and `IDisposable`
  (`OutboxSignal.cs:10`); the internal `WakeUpSignal`
  (`MMCA.Common.Infrastructure.Persistence.Polling`), the actual `SemaphoreSlim` wrapper it now
  delegates to (`OutboxSignal.cs:12`).
- **Concept reinforced, event-driven wake, plus a small cost lesson.** `[Rubric §12, Performance &
  Scalability]` (introduced at [`IOutboxSignal`](#ioutboxsignal)) and `[Rubric §31, Cost Efficiency /
  FinOps]`. The one-permit cap that makes surplus signals free now lives on `WakeUpSignal`
  (`new SemaphoreSlim(0, 1)`, `WakeUpSignal.cs:18`), and its doc explains exactly why (lines 6-14): each
  processor drains a whole batch per cycle, so one pending wake-up is all the information a burst of
  writes carries. With the default uncapped `SemaphoreSlim(0)` the class accumulated one permit per
  `Signal()` call, so N writes in a burst made `WaitAsync` return immediately N times, and each of those
  cycles issued a candidate-fetch query per relational data source that returned nothing. The surplus
  signals were harmless for correctness but not for cost; with the cap, the surplus is absorbed. Moving
  the primitive into `WakeUpSignal` also means `InternalCommandSignal` (the internal-command queue's own
  wake-up) shares this exact cap-and-swallow behavior instead of re-implementing it.
- **Walkthrough**: `OutboxSignal` is now three one-line forwards to a private `WakeUpSignal _signal =
  new()` field (`OutboxSignal.cs:12`): `Signal()` calls `_signal.Signal()` (line 15), `WaitAsync` calls
  `_signal.WaitAsync(timeout, cancellationToken)` (lines 18-19), and `Dispose()` calls
  `_signal.Dispose()` (line 22). `WakeUpSignal` holds the mechanics this section previously described
  directly: `Signal()` (`WakeUpSignal.cs:21-31`) calls `_semaphore.Release()` inside a `try` and swallows
  the `SemaphoreFullException` the cap makes routine, so repeated signals never throw and callers never
  need to coordinate; `WaitAsync` (`WakeUpSignal.cs:37-47`) awaits
  `_semaphore.WaitAsync(timeout, cancellationToken)` and rethrows `OperationCanceledException` only when
  the token really was cancelled, propagating shutdown; `Dispose()` (line 50) disposes the semaphore.
- **Why it's built this way**: a counting semaphore is still the lightest primitive that both parks the
  processor loop and is releasable from the commit path. Extracting it into `WakeUpSignal` is what lets
  `InternalCommandSignal` reuse the identical cap-and-swallow behavior instead of duplicating it, keeping
  the "at-least-once is fine, duplicates are absorbed" instinct that runs through this whole group in one
  place rather than two.
- **Where it's used**: registered as the singleton `IOutboxSignal` by `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:248`). Its callers are
  listed under [`IOutboxSignal`](#ioutboxsignal). Note the registration is unconditional, above the
  outbox gate, so the producers can signal without checking whether a processor exists.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### ClaimedBatch
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:1224` · Level 10 · class (private sealed, nested in `OutboxProcessor`)

- **What it is**: the per-batch state object [`OutboxProcessor`](#outboxprocessor) threads through
  dispatch. It holds one claimed batch's progress: the claimed rows in dispatch order, the lock token
  every renewal and stamp is guarded by, this replica's current lease expiry, the delivered rows
  waiting for their batched stamp, and the rows a lease renewal found under another token (type doc,
  `OutboxProcessor.cs:1218-1223`).
- **Depends on**: [`OutboxMessage`](#outboxmessage) (this group) only. It is a primary-constructor
  class `ClaimedBatch(List<OutboxMessage> messages, Guid lockToken, DateTime leaseUntil)`
  (`OutboxProcessor.cs:1224`) with no behavior of its own.
- **Concept introduced, batch state as one mutable carrier instead of loose locals.**
  `[Rubric §29, Resilience]` (lease-guarded, crash-tolerant delivery) and `[Rubric §12, Performance &
  Scalability]` (set-based stamping). Five members carry the whole protocol: `Messages` (get-only list
  of the claimed rows, line 1174), `LockToken` (get-only, line 1176), `LeaseUntil` (the only settable
  member, line 1178, advanced each time a renewal succeeds), `PendingStamps` (the delivered rows
  buffered for one set-based `ProcessedOn` update, line 1180) and `LostIds` (a `HashSet<Guid>` of rows
  a renewal found re-claimed by another replica, line 1182, so they are skipped rather than
  dispatched twice).
- **Walkthrough**: `DispatchMessagesAsync` builds it from the claimed rows, the batch's `lockToken` and
  the `claimLeaseUntil` the claim wrote (`OutboxProcessor.cs:504`), then hands it to
  `DispatchRowsAsync` and `FlushDeliveredAsync`. `RenewLeaseIfDueAsync` reads `LeaseUntil` against the
  injected clock and reports a row lost when its id is in `LostIds` (lines 677-684);
  `RecordOutcomeAsync` appends a delivered row to `PendingStamps` (line 704);
  `RenewRemainingLeasesAsync` writes the new `LeaseUntil` and unions into `LostIds` (lines 839-842);
  `FlushDeliveredAsync` drains `PendingStamps` chunk by chunk (lines 862-896).
- **Why it's built this way**: delivered rows are no longer stamped one UPDATE per row, so something
  has to remember them between the delivery and the flush, and the flush has to run from several
  places (end of batch, before a renewal, early exit). One object passed by reference keeps those
  paths reading the same buffer and the same lease expiry instead of each re-deriving them.
- **Where it's used**: only inside `OutboxProcessor.cs`; it is private to the processor, so nothing
  else constructs one.

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxFinalizer
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxFinalizer.cs:13` · Level 11 · class (internal static)

- **What it is**: the helper that marks a batch of just-dispatched [`OutboxMessage`](#outboxmessage)
  rows processed with a **single set-based SQL `UPDATE`**, then re-syncs the EF change tracker so a
  later save does not re-issue the same statement. It is the finalize step on the low-latency
  in-process happy path, not the background processor's path. A second method,
  `ReleaseLeaseAsync`, clears the lease on those same entries when the in-process dispatch fails.
- **Depends on**: [`OutboxMessage`](#outboxmessage) (this group) and
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (G07); EF Core
  (`ExecuteUpdateAsync`) and BCL `TimeProvider`.
- **Concept introduced, set-based finalize off the hot write path.** `[Rubric §12, Performance &
  Scalability]` assesses keeping the hottest write path cheap, and `[Rubric §8, Data Architecture]`
  assesses efficient set-based mutation. Every event-raising command reaches this the moment its
  transaction commits and its local events are dispatched in-process. The naive approach, setting
  `ProcessedOn` on each tracked entity and calling `SaveChanges` again, would run a second full save
  (change detection, audit stamping, the whole interceptor pipeline) on the busiest write path in the
  system. Instead the doc states the design (`OutboxFinalizer.cs:6-12`): one asynchronous
  `ExecuteUpdate` statement that bypasses the change tracker and the `SaveChanges` interceptor pipeline
  entirely.
- **Walkthrough**: `MarkProcessedAsync(ApplicationDbContext, IReadOnlyList<OutboxMessage>,
  TimeProvider, CancellationToken)` (`OutboxFinalizer.cs:27-55`) short-circuits on an empty batch
  (lines 32-33), computes `now` once from the **injected** `timeProvider` (line 35), collects the row
  ids (line 36), and issues **one** `ExecuteUpdateAsync` that sets `ProcessedOn` over
  `Where(m => ids.Contains(m.Id))` (lines 38-41). Because `ExecuteUpdate` does not touch tracked
  instances, it then loops the entries and, for each, sets the tracked `ProcessedOn`, writes the
  property's `OriginalValue`, and clears `IsModified` (lines 47-53). The ordering inside that loop is
  load-bearing and the comment says why (lines 43-46): clearing `IsModified` reverts the current value
  to the original, so the original must already hold the new value first. The `TimeProvider` is a
  parameter rather than a `TimeProvider.System` read (its doc, lines 20-24) so a test driving a
  `FakeTimeProvider` sees this stamp move with the same clock as the processor's lease, backoff and
  retention arithmetic, a `[Rubric §14, Testability]` point. `ReleaseLeaseAsync(ApplicationDbContext,
  IReadOnlyList<OutboxMessage>, Guid lockToken, CancellationToken)` (`OutboxFinalizer.cs:67-98`) is the
  failure-path twin: it short-circuits on an empty batch (lines 73-74), then issues one
  `ExecuteUpdateAsync` that sets `LockedUntil` and `LockToken` to null over
  `ids.Contains(m.Id) && m.LockToken == lockToken` (lines 78-84). The token guard means a row a
  processor has since claimed under its own token is left alone. It then re-syncs each tracked entry the
  same way `MarkProcessedAsync` does, nulling both properties, writing their `OriginalValue` and
  clearing `IsModified` (lines 86-97). The type doc now says it also releases the lease when the
  in-process dispatch fails (`OutboxFinalizer.cs:11`).
- **Why it's built this way**: `ExecuteUpdate` is a single round-trip that never materializes entities,
  and re-syncing the tracker afterwards keeps a later `SaveChanges` from queueing a redundant `UPDATE`
  for rows that are already processed. This is how
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)'s in-process dispatch
  stays cheap; the durability net is the background [`OutboxProcessor`](#outboxprocessor), which
  deliberately does **not** use this helper (it writes each row's outcome as the row completes, through
  its own `StampAsync` update guarded by the batch's lock token, `OutboxProcessor.cs:1035-1056`, because it
  must persist `RetryCount`, `LastError` and lease changes and drop an outcome whose lease another
  replica has taken).
- **Where it's used**: `MarkProcessedAsync` is called by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  right after the local dispatch (`DomainEventSaveChangesInterceptor.cs:384`), and `ReleaseLeaseAsync`
  by the same interceptor with `CancellationToken.None` on the failure path
  (`DomainEventSaveChangesInterceptor.cs:449`). `MarkProcessedAsync` is also called by
  [`InProcessEventBus`](#inprocesseventbus) after writing and dispatching an integration-event batch
  (`InProcessEventBus.cs:103`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### OutboxProcessor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Outbox.Processing` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:61` · Level 13 · class (public sealed partial, `BackgroundService`)

- **What it is**: the background service that drains every outbox table the host owns, claims rows under
  a lease, and dispatches the [`OutboxMessage`](#outboxmessage)s. It is the engine of at-least-once
  delivery ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) and the most
  intricate type in this group.
- **Depends on**: `IServiceScopeFactory`, `ILogger<OutboxProcessor>`,
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`,
  [`IOutboxSignal`](#ioutboxsignal),
  [`FrameworkTableTargets`](group-07-persistence-ef-core.md#frameworktabletargets) (registered once as a
  singleton by `AddInfrastructure`, `DependencyInjection.cs:97`) and a required `TimeProvider` (resolved
  from the `TryAddSingleton(TimeProvider.System)` registration, `DependencyInjection.cs:368`, rather than
  defaulted in the constructor) (`OutboxProcessor.cs:61-67`); the shared `PollingLoop`
  (`MMCA.Common.Infrastructure.Persistence.Polling`), the loop, smart-wait and per-source drain engine
  this processor and `InternalCommandProcessor` both run on; per cycle scope
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) (line 202), and per row scope
  [`IMessageBus`](#imessagebus) or [`IDomainEventDispatcher`](#idomaineventdispatcher) (lines 814, 829),
  both scopes opened through `CreateTenantScope`
  ([`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets),
  `TenantDataSourceTargets.cs:100`); the [`OutboxMessage`](#outboxmessage) entity,
  [`OutboxMetrics`](#outboxmetrics), [`OutboxCycleResult`](#outboxcycleresult),
  its nested per-batch state [`ClaimedBatch`](#claimedbatch) (`OutboxProcessor.cs:1224`),
  [`TenantDataSourceTarget`](group-07-persistence-ef-core.md#tenantdatasourcetarget),
  [`ColumnWidth`](group-07-persistence-ef-core.md#columnwidth), `ExceptionChain` (line 647),
  [`BrokerResilienceDefaults`](group-16-aspire-orchestration.md#brokerresiliencedefaults),
  [`BrokerMetrics`](group-14-module-system-composition.md#brokermetrics) and
  [`AmbientOrigin`](group-14-module-system-composition.md#ambientorigin); externally Polly
  (`ResiliencePipeline`, `BrokenCircuitException`).
- **Concept introduced, the outbox drain loop: smart wait, claim leases, ordered delivery,
  dead-lettering, a broker circuit breaker, jittered backoff and trace continuity.**
  `[Rubric §6, CQRS & Event-Driven]` (reliable delivery), `[Rubric §29, Resilience]`,
  `[Rubric §13, Observability & Operability]` and `[Rubric §31, Cost Efficiency]` (idle-poll
  suppression), plus `[Rubric §12, Performance & Scalability]` (batched stamping). The class doc sets
  the delivery contract up front (`OutboxProcessor.cs:37-49`): delivery is at-least-once; a failed
  row's state is written as soon as the row is done, while delivered rows are buffered and stamped
  together by one set-based update per flush (end of batch, before a lease renewal, every early exit);
  every write is guarded on the lease token; and the lease is renewed for the rest of the batch, in one
  statement, once less than half of it remains. A delivered message not yet flushed after a crash is
  redelivered only once its claim lease expires (`Outbox:LeaseSeconds`, 300s by default), not
  immediately on restart, because the claim is persisted before dispatch and the poll skips leased
  rows. Take the rest a layer at a time.
- **Walkthrough**
  - **The loop, extracted.** `ExecuteAsync` (`OutboxProcessor.cs:125-139`) contains no loop body: it is
    a one-expression call into `PollingLoop.RunAsync`
    (`Persistence/Polling/PollingLoop.cs:48-101`), passing `_timeProvider`,
    whether this host owns any target (`GetOutboxTargets().Count > 0`), `LogOutboxDisabled` for the
    no-target case, a cycle delegate that calls `ProcessPendingMessagesAsync` and projects its result to
    `(HasMoreWork, EarliestUpcoming)`, `LogProcessingError`, the configured delay and interval seconds,
    and `outboxSignal.WaitAsync` itself as the wait function. `PollingLoop.RunAsync` runs the mechanics:
    it waits `StartupDelay` (a shared 5-second constant, `PollingLoop.cs:18`, matching the internal
    command processor's own delay) so the application finishes initializing, returns immediately when
    `hasTargets()` is false, and otherwise loops until cancelled, treating a cancellation as a clean stop
    and any other cycle exception as a reported, non-fatal error (`PollingLoop.cs:59-84`). A cycle with
    more work re-polls immediately; otherwise it awaits the injected `waitForSignal` for whichever comes
    first of a signal, the **smart wait**, or the fallback interval (`PollingLoop.cs:86-99`). The remark
    on `ExecuteAsync` says this in one line (`OutboxProcessor.cs:124`): the loop, startup delay and smart
    wait are the shared `PollingLoop`.
  - **The smart wait.** `OutboxProcessor.ComputeWaitTime` (`OutboxProcessor.cs:146-151`) is a thin
    forward to `PollingLoop.ComputeWaitTime` (`PollingLoop.cs:117-134`), kept as a named static method
    so existing unit tests keep calling it. It returns the full polling interval when nothing is
    upcoming; otherwise it waits until just after the earliest upcoming row becomes ready, its
    `OccurredOn` plus `ProcessingDelaySeconds` (delay default 5, `OutboxSettings.cs:41`) plus a
    50-millisecond `ReadinessMargin` (`PollingLoop.cs:29`), capped at the polling interval. The margin
    exists because eligibility is a strict `< cutoff` comparison and the signal wait truncates to whole
    milliseconds, so waking at the exact instant could still find the row ineligible (doc,
    `PollingLoop.cs:23-28`). A row that is already due waits the `MinimumWait` of 1 second
    (`PollingLoop.cs:21`, applied at lines 129-131) so it cannot hot-loop the processor, while a row not
    yet due is never pushed past its due instant by that floor. Its doc keeps the subtle rule
    (`PollingLoop.cs:109-110`): failed-but-already-ready rows never shorten the wait, which throttles a
    permanently failing message instead of letting it drive the loop. This is why a deployed host can
    set a long poll interval without adding latency: real messages wake it by signal or smart wait, and
    the slow fallback only cuts idle database chatter and telemetry cost.
  - **Which databases.** `GetOutboxTargets` (`OutboxProcessor.cs:160-161`) asks the injected
    [`FrameworkTableTargets`](group-07-persistence-ef-core.md#frameworktabletargets) one question,
    `tableTargets.Relational(_settings.DataSource, _settings.DatabaseName)`, the overload that adds the
    caller's configured home source to every relational source in use and then expands per tenant
    (`FrameworkTableTargets.cs:54-64`). That type exists so the outbox processor, the internal-command
    processor, both cleanup services, both operator surfaces and the audit-trail sweep all share one
    answer rather than each re-deriving it from the registry, the resolver and the tenancy settings
    (`FrameworkTableTargets.cs:16-18`). The method's own doc states the contract
    (`OutboxProcessor.cs:153-159`): every relational source this host owns (every source backing a
    registered entity plus the configured publish target; Cosmos has no outbox table) against the shared
    database, plus one extra unit per tenant that keeps its own copy of a source, because a tenant
    database has its own `OutboxMessages` table that nothing else would drain
    ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html);
    [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). A host therefore only
    touches *its own* databases, never racing another service for its rows.
  - **Aggregating a cycle.** `ProcessPendingMessagesAsync` (`OutboxProcessor.cs:169-187`) delegates to
    `PollingLoop.DrainAllAsync` (`PollingLoop.cs:147-185`), passing `GetOutboxTargets()`, a delegate that
    calls `ProcessSourceAsync` per target and projects its tuple to
    `(HasMoreWork, EarliestUpcoming, PendingDepth)`, and `LogSourceProcessingError`. `DrainAllAsync` ORs
    the `HasMoreWork` flags, keeps the earliest upcoming timestamp across all targets, and sums the
    observed backlog; one unreachable database must not starve the others, so a per-target failure is
    reported and skipped while a real cancellation propagates (`PollingLoop.cs:159-181`). Back in
    `ProcessPendingMessagesAsync`, the summed depth is published through
    [`OutboxMetrics.SetPendingDepth`](#outboxmetrics) (`OutboxProcessor.cs:184`), so a target that threw
    contributes zero and an outage reads as a drop rather than a stale plateau (comment,
    `OutboxProcessor.cs:182-183`).
  - **Draining one target.** `ProcessSourceAsync` (`OutboxProcessor.cs:193-263`) opens the cycle scope
    through `scopeFactory.CreateTenantScope(target)` (line 200; the comment at line 199 notes the tenant
    is set before the context is asked for) and gets the context for that source (lines 202-203). It
    resolves no dispatcher or message bus: delivery happens on a separate scope per row (see below). It
    fetches a candidate batch (line 208), derives the backlog depth (line 209) and publishes the
    oldest-pending age from the batch's own first row (lines 214-216). Then it splits the ordered batch:
    the eligible prefix is everything with `OccurredOn` before the `ProcessingDelaySeconds` cutoff (lines
    206, 220-224), and the first row past it becomes `earliestPending` (line 226). Nothing eligible means
    an early return carrying only the wait information (lines 228-231). Otherwise it mints this batch's
    `lockToken` (line 233), computes the batch's `leaseUntil` as now plus `LeaseSeconds` (line 234; the
    caller owns the expiry so the claim and the dispatch share one value) and **claims** the prefix,
    receiving the claimed rows plus a `deferredKeyMates` flag (line 235), returns early if another
    replica claimed all of it between fetch and claim (lines 238-242), and hands the batch to
    `DispatchMessagesAsync` together with the cycle context, the token and that `leaseUntil` (line 250).
    There is no batch-end `SaveChangesAsync`: the comment (lines 246-249) says every outcome is persisted
    by `DispatchMessagesAsync` itself, failures per row and deliveries per flush, through guarded
    set-based updates, so a cancellation partway through still flushes the rows already delivered to the
    database rather than leaving them only in the change tracker. The re-poll decision is `processedAny
    && (eligibleCount == BatchSize || deferredKeyMates)` (line 260): a full batch with progress, or
    key-mates this cycle deferred behind their key's head row, which become claimable the moment that row
    is delivered, so waiting out the polling interval (300s deployed) per successor would serialize a key
    at one row per poll (comment, lines 253-257). The progress requirement still stops a fully-failing
    batch from hot-spinning. It returns a `(OutboxCycleResult, long PendingDepth)` tuple (lines 258-262)
    so the caller can sum the depth.
  - **Fetching.** `FetchCandidatesAsync` (`OutboxProcessor.cs:305-323`) selects rows that are
    unprocessed, under `MaxRetries`, and not under another replica's unexpired lease (lines 315-317),
    ordered by `OccurredOn` then `Id` and capped at `BatchSize` (lines 318-320, default 50,
    `OutboxSettings.cs:17`). There is deliberately **no** `OccurredOn` cutoff in SQL (doc, lines
    300-303): pending rows are fetched too so the caller can smart-wait, and ordering by `OccurredOn`
    guarantees eligible rows sort before pending ones, which is what stops a full batch from starving
    eligible work. The query runs inside an explicit `OutboxPoll` activity (line 311; the name constant
    `PollActivityName` is at line 78) that the Aspire
    [`OutboxPollFilterProcessor`](group-16-aspire-orchestration.md#outboxpollfilterprocessor) suppresses
    from telemetry export along with its SqlClient child span; the string is deliberately duplicated
    there because Aspire has no project reference back to Infrastructure (comment, lines 72-77).
  - **Backlog depth almost for free.** `CountPendingAsync` (`OutboxProcessor.cs:273-294`) returns the
    fetched count directly whenever the batch came back short, because a short batch *is* the whole
    backlog (lines 280-283, doc 265-272). Only a saturated batch, exactly the state an operator alerts
    on, pays for a `LongCountAsync`, and that query runs inside its own `OutboxPoll` activity so it is
    suppressed like the poll itself (lines 285-286). The predicate mirrors the fetch (lines 288-293), so
    the gauge counts the rows this processor considers workable.
  - **Claiming: how scale-out is made safe.** `ClaimEligibleAsync` (`OutboxProcessor.cs:348-396`) takes
    both the batch's `leaseUntil` and its `lockToken` from the caller (lines 353-354), because the same
    token later guards every renewal and outcome write and the same expiry seeds the batch's lease
    tracking. It narrows the prefix (line 357), and records `deferredKeyMates` as `candidates.Count <
    eligibleCount` (line 361), the rows `SelectOrderedCandidates` dropped to keep one row per key. It then
    issues one conditional `ExecuteUpdateAsync` setting `LockedUntil` (default lease 300s,
    `OutboxSettings.cs:90`) and `LockToken` (lines 375-379). A claim of zero rows means another replica
    took the whole prefix (lines 381-382); a full claim returns the candidates as-is (lines 384-385); a
    **partial** claim re-queries which ids carry *this* replica's token and processes only those (lines
    387-395). Every return is a `(Claimed, DeferredKeyMates)` tuple. The doc states the property this buys
    (lines 326-331): two replicas can never dispatch the same message, and a replica that dies mid-batch
    releases its rows implicitly when the lease expires. That is scale-out safety by construction rather
    than by a `minReplicas: 1` deployment convention.
  - **Ordered delivery, enforced inside the claim.** This is the piece that is easy to get wrong, and
    the doc explains why it lives here rather than after the fetch (lines 332-340): enforcing it in the
    claim is what makes it survive batching *and* scale-out. Three pieces cooperate.
    `SelectOrderedCandidates` (`OutboxProcessor.cs:405-421`) narrows the eligible prefix to every
    unkeyed row plus the **first** row of each ordering key, which is what stops one cycle from
    dispatching two events of a key in parallel. `FilterClaimable` (lines 427-433) is the shared
    predicate (these ids, still unprocessed, not leased). `FilterUnblocked` (lines 442-452) adds the
    ordering guard as a correlated `NOT EXISTS`: a keyed row is refused while any earlier unprocessed,
    non-dead-lettered row shares its key, evaluated by the database at the instant of the update, so a
    second replica racing the same key loses on the row rather than on a check it made before the race
    started. Which of the two runs is decided per batch (lines 368-373): a batch with no keyed row runs
    exactly the query it always ran, so hosts that never declare an ordering key pay nothing for the
    feature, not even a subquery the optimizer has to prove away. Two documented consequences: a
    predecessor still blocks while it is retrying, which is the head-of-line blocking
    [`IHasOrderingKey`](group-02-domain-building-blocks.md#ihasorderingkey) documents, but once it
    exhausts its retries it stops blocking, so a poison event cannot freeze its key forever (lines
    337-339); and the predecessor test is on `OccurredOn` alone, so two rows sharing a key and an exact
    timestamp are ordered by `Id` within a cycle but neither blocks the other in SQL, because `Guid` has
    no order that .NET and every provider agree on (remarks, lines 342-347).
  - **A fresh scope per row, and the request's identity restored onto it.** `DispatchMessagesAsync`
    (`OutboxProcessor.cs:496-521`) wraps the claimed rows, the batch's `lockToken` and the claim's lease
    expiry in a [`ClaimedBatch`](#claimedbatch) (line 504) and calls `DispatchRowsAsync`
    (lines 529-618), which receives the cycle context, that batch and the batch's
    [`TenantDataSourceTarget`](group-07-persistence-ef-core.md#tenantdatasourcetarget). For each row it
    opens its own `rowScope` through `scopeFactory.CreateTenantScope(target)` (line 561): a tenant-owned
    target keeps its tenant, while the shared target starts unresolved so the restore can set this row's
    tenant or leave it unset (comment, lines 557-560). The scope only carries the delivery, so it is
    disposed before the outcome is recorded through the cycle context. The doc gives the reason
    (remarks, lines 461-470): the tenant context refuses a change once resolved, so on one shared scope
    every later row of a shared-target batch ran under the first row's tenant. Before anything else runs,
    `Context.AmbientOrigin.Restore` writes that row's captured `UserId`, `UserRoles`, `UserPermissions`,
    `TenantId` and `CorrelationId` onto `rowScope.ServiceProvider`, tagged with the authentication type
    `OutboxPrincipalAuthenticationType` (`"Outbox"`, line 84) so the rebuilt identity reads
    `IsAuthenticated` true and names the hop it came back from (lines 568-575). The message bus and the
    dispatcher are resolved from that row scope too (`DeliverAsync`, lines 814, 829), so
    `BrokerMessageBus` reads the restored values when it stamps its publish headers, and the in-process
    path (`InProcessMessageBus` to [`IDomainEventDispatcher`](#idomaineventdispatcher)) gets the right
    ambient context for free, without either transport reaching back into the row. Only delivery moves to
    the row scope: the cycle scope's context holds the claimed rows and writes the lease renewals and
    outcomes (lines 469-470).
  - **Lease renewal, once per batch when due, and guarded outcomes.** The claim lease covers the whole
    batch, so a slow batch could outlive it and let another replica claim a later row while this one is
    still busy (remarks, lines 471-480). Renewal is not a statement per row.
    `RenewLeaseIfDueAsync` (`OutboxProcessor.cs:707-721`) runs before each row is dispatched (line 547),
    subtracts the clock from the batch's `LeaseUntil` (line 713) and writes nothing while at least half of
    `LeaseSeconds` remains (line 714). Once less remains it flushes the buffered stamps and calls
    `RenewRemainingLeasesAsync` (lines 716-717; lines 842-881). That method pushes `LockedUntil` out to
    now plus `LeaseSeconds` (line 848) for every not-yet-dispatched, not-known-lost row of the batch
    (lines 853-856), in one `ExecuteUpdateAsync` per chunk of `MaxIdsPerStatement` ids (500, line 93,
    well under SQL Server's 2100-parameter limit), each filtered on `Id` and this batch's `LockToken`
    (lines 858-863). When fewer rows renewed than asked for, one query finds the ids still carrying the
    token and the rest join `LostIds` (lines 865-877), and the batch's `LeaseUntil` is advanced (line
    880). A row found in `LostIds` is skipped with a Warning (`LogLeaseLostBeforeDispatch`, lines
    547-551), so a lease that lapsed during one long dispatch is caught by the next check before another
    row goes out. A failed row's outcome is written the same guarded way as soon as the row is done:
    `StampAsync` (`OutboxProcessor.cs:1035-1056`) runs the update against `Id == message.Id && LockToken ==
    lockToken` (lines 1041-1042), so a replica that lost the row mid-dispatch matches nothing, logs
    `LogLeaseLost`, detaches the tracked row and drops its stale outcome instead of overwriting the new
    owner's (lines 1047-1052). A match syncs the tracked row's original values to the current ones and
    marks it `Unchanged`, so nothing later writes the outcome through the change tracker without the
    guard (lines 1054-1055). An expired lease nobody re-claimed still carries this token, so its outcome
    is stamped (doc, lines 1022-1029).
  - **Dispatching, and delivered rows stamped in batches.** `DispatchRowsAsync`
    (`OutboxProcessor.cs:529-618`) walks the claimed batch by index and opens a per-message activity
    (line 553). A row whose payload will not deserialize goes to `HandleUnresolvableType` (lines
    577-581). Otherwise `DeliverAsync` (lines 810-832, called at line 584) publishes an
    [`IIntegrationEvent`](#iintegrationevent) through [`IMessageBus`](#imessagebus) and sends a pure
    domain event to [`IDomainEventDispatcher`](#idomaineventdispatcher). After each row,
    `RecordOutcomeAsync` (called at line 610; lines 728-742; the comment at lines 604-608 notes this
    sits outside the try on purpose, so a database failure while recording is not charged to the row as a
    retry) does one of two things. A failed row goes to `RecordFailureOutcomeAsync` and its retry state is
    written now. A delivered row only joins `batch.PendingStamps` (line 740). `FlushDeliveredAsync`
    (lines 895-935) later stamps the buffer: per chunk of `MaxIdsPerStatement` it takes one `ProcessedOn`
    value from the flush time (line 908) and issues one guarded `ExecuteUpdateAsync` filtered on the
    ids and the batch's `LockToken` (lines 910-913). When fewer rows were stamped than buffered, one query
    finds the rows that carry the token (lines 918-926). `SyncDelivered` (lines 970-995) then handles each
    row: an unmatched row logs `LogLeaseLost` and is detached (lines 973-978), while a stamped row is
    accepted as `Unchanged` (lines 980-982), increments `ProcessedCounter` (line 985), records
    `DispatchLagHistogram` as the seconds between `OccurredOn` and `ProcessedOn`, clamped at zero
    because the two timestamps come from different hosts and clock skew must not publish a negative
    duration (lines 987-992), and writes the success log. Each chunk leaves the buffer once synced, so a
    retried flush never stamps or counts a row twice (line 933; doc 883-894). Flushes happen at three
    points: the end of the batch (line 510), before a lease renewal (line 716), and on any early exit
    (see Graceful shutdown). The per-message success log is deliberately Debug, not Information, and the
    comment prices the difference: it would otherwise be the single noisiest line in steady state, a real
    telemetry-ingestion cost, while failures stay loud (lines 1179-1183).
  - **Dead-lettering an unresolvable type, with one grace attempt.** `HandleUnresolvableType`
    (`OutboxProcessor.cs:1074-1100`) records `LastError` (line 1076) and treats the **first** failure to
    resolve as transient, retrying it through the normal backoff path, because the assembly declaring
    the type may simply not be loaded yet, a module assembly resolved lazily or a host still coming up,
    and a name that resolves one cycle later was never a dead letter (doc, lines 1058-1067). Only the
    second attempt is terminal, which is also the point at which an operator has already had a Warning
    naming the row (lines 1080-1086, `LogTypeUnresolvableRetry` at 1191-1192, whose message names the
    fix: give the event an [`EventName`](group-02-domain-building-blocks.md#eventnameattribute)). A host
    that set `MaxRetries` to 1 asked for no retries at all, so that case skips the grace attempt rather
    than scheduling one the poll's filter would never pick up (lines 1078-1080). The terminal path
    dead-letters the row the way exhausted retries do: it sets `RetryCount` to `MaxRetries` and stamps
    `LockedUntil` with the current time rather than clearing it, leaving `ProcessedOn` null (lines
    1089-1093). The comment gives the reason (lines 1091-1092): the dead-letter retention window runs
    from `LockedUntil`, the last failed attempt, and the row already leaves the poll through the
    `RetryCount` filter, so the stamp holds no claim. It then increments the dead-letter counter with
    `reason=type_unresolvable` and logs at Error (lines 1094-1098). The doc names the effect (lines
    1064-1067): the row leaves the poll but stays listed and replayable by the outbox administration and
    is kept for the dead-letter retention window, instead of being purged as delivered.
  - **The circuit breaker around the message-bus publish.** Only the integration-event publish is
    wrapped, and the doc states precisely what that hop is. `_brokerPublishPipeline`
    (`OutboxProcessor.cs:121`) is a Polly `ResiliencePipeline` built by
    `BuildBrokerPublishPipeline(timeProvider)` (lines 1118-1129) from
    [`BrokerResilienceDefaults`](group-16-aspire-orchestration.md#brokerresiliencedefaults) (failure
    ratio, minimum throughput, sampling and break durations, lines 1122-1125), on a
    `ResiliencePipelineBuilder` whose `TimeProvider` is the processor's own clock (line 1119), so a test
    driving the clock drives the break duration too (doc, lines 1115-1116). The integration-event
    branch of `DeliverAsync` executes the publish through it (lines 821-825). The guarded call is the
    `IMessageBus` publish: the broker hop on a host that registers broker messaging, but on a monolith
    the default `InProcessMessageBus` runs the integration-event handlers in-process inside the breaker,
    so failing handlers can open it too (field doc, lines 106-120; comment, lines 816-820). Three
    deliberate choices sit in the doc comments. It never guards the database calls, because a breaker on
    those would open exactly when the processor most needs to persist retry state (lines 110-111). It
    carries **no** retry strategy, because the outbox already owns retry through `RetryCount` and
    `ComputeRetryBackoffSeconds` (lines 112-113). And it is an **instance** field rather than a static
    one, so breaker state cannot leak across the many processors a test assembly constructs in parallel
    (lines 114-119). `OperationCanceledException` is excluded from the handled set (lines 1126-1127),
    because a host shutdown cancelling a batch is not evidence that the broker is unhealthy (doc, lines
    1112-1115). The pure domain-event branch is left unwrapped on purpose: it is a direct method call into
    this same process with no transport to be dead (comment, lines 818-820).
  - **Failure handling.** A cancellation during dispatch is rethrown rather than treated as a delivery
    failure, and the comment explains the bug that guard prevents (lines 588-595): falling into the
    generic handler would increment `RetryCount` and stamp `LastError` on this message and, since every
    later `await` fails the same way, on the whole remainder of the batch, so a graceful restart could
    dead-letter messages that were never attempted. Any other exception is caught (with an inline
    `CA1031` justification, lines 596-598) and handed to `ApplyDeliveryFailure` (lines 600, 629-698),
    which writes the retry state onto the row in memory and returns the batch's circuit-open log latch.
    A genuine failure bumps `RetryCount` (line 644), records `LastError` as `ExceptionChain.Describe(ex)`
    truncated to the 4000-character column width (`MaxErrorLength`, line 87, through
    [`ColumnWidth.Truncate`](group-07-persistence-ef-core.md#columnwidth), lines 647-648) and
    **re-leases** the row for an explicit backoff (lines 658-661); the comment notes that simply keeping
    the original claim made every retry wait the full `LeaseSeconds` no matter what the polling interval
    or a signal said, turning the retry cadence into an accident of the lease (lines 650-657). These
    retry fields are persisted by `RecordFailureAsync` (lines 1001-1020), which writes `RetryCount`,
    `LastError` and `LockedUntil` through the token-guarded `StampAsync` update. A
    `BrokenCircuitException` is treated differently: an open circuit is a rejection, not a delivery
    attempt, so it does **not** consume a retry and cannot dead-letter the row, which would otherwise
    walk every undelivered row through its whole retry budget during a long outage without one real
    attempt; real publish failures, and the failure of the single half-open probe, keep counting
    (comment, lines 636-640; lines 641-645). The rejected row is re-leased for the break instead of a
    count-keyed backoff, through `PollingLoop.ComputeCircuitOpenBackoffSeconds` (line 660;
    `PollingLoop.cs:211-220`): the break duration plus up to a quarter of it as jitter, capped at
    `LeaseSeconds`, so a whole batch does not become claimable in the same instant the circuit
    half-opens, and the lease keeps it from hot-spinning. It is counted on
    [`BrokerMetrics.CircuitOpenCounter`](group-14-module-system-composition.md#brokermetrics) (lines
    669-671) and logged **once per batch** through a local latch (lines 541, 673-676), because an open
    circuit rejects every remaining row in the same instant, and "the broker refused 50 messages" and
    "we did not try, the broker is known-dead" are different operational facts (comment, lines 667-668);
    the method then returns before the exhaustion check (line 678). The log is a Warning because nothing
    is lost, only deferred (comment, lines 1200-1202). When a genuine failure brings `RetryCount` to
    `MaxRetries` (5 by default, `OutboxSettings.cs:21`) the dead-letter counter is incremented with
    `reason=retries_exhausted` and it logs at Error (lines 681-691), otherwise it logs a retry Warning
    (lines 692-695); the exhausted row then leaves the poll through the `RetryCount` filter and is
    eventually purged by [`OutboxCleanupService`](#outboxcleanupservice) after the dead-letter retention
    window (comment, lines 683-685), unless an operator replays it first through
    [`OutboxAdministration`](#outboxadministration).
  - **Backoff.** `OutboxProcessor.ComputeRetryBackoffSeconds` (`OutboxProcessor.cs:1107-1108`) is a
    one-line forward to `PollingLoop.ComputeRetryBackoffSeconds` (`PollingLoop.cs:197-209`), passing
    `_settings.RetryBackoffBaseSeconds` and `_settings.LeaseSeconds` as the base and cap. The shared
    implementation is `RetryBackoffBaseSeconds * 2^(retryCount - 1)` (default base 10,
    `OutboxSettings.cs:107`) with the exponent clamped to at most 16 before it reaches `Math.Pow`
    (`PollingLoop.cs:202`), multiplied by a random jitter factor in `[0.8, 1.2]`
    (`PollingLoop.cs:206`) and capped at `LeaseSeconds`, the cap this processor passes in
    (`PollingLoop.cs:208`). Jitter is applied *before* the cap so a capped backoff sits exactly at the
    lease bound (comment, `PollingLoop.cs:205`). The doc names the reason for the jitter
    (`PollingLoop.cs:188-191`): a batch that failed together, one dependency outage failing all 50 rows
    in the same instant, would otherwise retry in lockstep and re-hammer that dependency on a single
    shared schedule. The `CA5394` suppression on the shared `NextJitter` helper (`PollingLoop.cs:222-223`)
    is justified inline: the randomness feeds no security, token, key or cryptographic decision.
  - **Graceful shutdown.** Delivered rows are buffered, so shutdown handling covers two writes: the
    failed row in flight and the buffered stamps. `DispatchMessagesAsync` tracks a `batchCompleted` flag
    and, if the batch ends any way but normally, calls `FlushDeliveredOnExitAsync` from a `finally`
    (lines 505-520). That method flushes the buffer under its own 5-second budget (`ShutdownStampTimeout`,
    line 102; the `CancellationTokenSource` is built on the injected `TimeProvider`, line 951) rather than
    `CancellationToken.None`, so an uncancellable write against a dead connection cannot hold host
    shutdown open until the command timeout (lines 944-962). A flush failure is logged, never thrown
    (`LogExitStampFailed`, line 960 and 1215-1216: delivered messages will be redelivered when their lease
    expires), so it cannot replace the exception already propagating, which the polling loop uses to
    recognize shutdown. For a failed row, `RecordFailureOutcomeAsync` (lines 757-778) writes normally
    while the batch token is live; if the token is already cancelled, or the shutdown lands during the
    write itself (the guarded update is idempotent, so it is simply written again, lines 770-774), it
    falls to `RecordFailureOnShutdownAsync` (lines 784-803), which writes under the same budget (line
    790), logs a failure as `LogShutdownStampFailed` (lines 796-800 and 1212-1213) and ends by rethrowing
    the cancellation (line 802). After each recorded row the loop also calls
    `cancellationToken.ThrowIfCancellationRequested()` (line 614), stopping the batch after the row's
    outcome is safe, so the `finally` stamps the rows already delivered. Without a shutdown, a database
    failure propagates and fails the source for the cycle (comment, lines 604-608).
  - **Trace continuity.** `StartOutboxActivity` (`OutboxProcessor.cs:1142-1165`) rebuilds the original
    request's `ActivityContext` from the row's `TraceId`/`SpanId`, carrying the **stored** trace flags
    (null reads as none) and marked remote (lines 1149-1153), so a parent-based sampler records the
    delivery span exactly when the raising request was sampled instead of exporting an orphan span for a
    request the sampler dropped (doc, lines 1135-1140). It starts a `Consumer`-kind `OutboxProcess`
    activity tagged with the message id, event type and data source (lines 1155-1162), returning null
    when no trace context was captured (lines 1144-1147), so traces span the asynchronous hop.
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
  cycle (and, by not charging its rejections as retries, keeps an outage from dead-lettering rows that
  were never attempted), the lease-plus-token pair is what makes running more than one replica safe,
  the ordering guard inside the claim is what makes ordered delivery survive both batching and
  scale-out, and the per-row scope is what lets one batch deliver rows belonging to different tenants.
- **Where it's used**: registered as a hosted service by `AddInfrastructure` whenever the transport
  enables the outbox
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:260-264`), so every
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

### CreateWebhookSubscriptionRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Webhooks/CreateWebhookSubscriptionRequest.cs:17` · Level 0 · record

- **What it is**: the wire body of "create a webhook subscription for the caller's tenant": a target
  `Url`, an optional `Description` and the list of `EventTypes` to subscribe to
  (`CreateWebhookSubscriptionRequest.cs:5-8,17`).
- **Depends on**: nothing first-party; `System.Diagnostics.CodeAnalysis` for the suppressions.
- **Concept**: a contract DTO in the Shared layer, so the API controller and any typed client share one
  shape. `[Rubric §9, API & Contract Design]` assesses whether request contracts are explicit and stable;
  this one documents its own limits in the XML doc rather than in a separate spec: the URL must be an
  absolute https target (http and local targets only in Development when the host allows them), the
  description is up to 200 characters, and the event list holds 1 to 20 registered types or `"*"` for
  every one (`CreateWebhookSubscriptionRequest.cs:6-8`).
- **Walkthrough**: a single positional `sealed record` (`CreateWebhookSubscriptionRequest.cs:17`). The
  two `SuppressMessage` attributes (`CreateWebhookSubscriptionRequest.cs:9-16`) keep `Url` a `string`
  against CA1054/CA1056, with the justification that the URL is untrusted operator input validated as
  text before anything parses it, and that `System.Uri` would re-normalize it.
- **Why it's built this way**: carrying the raw string means the validator judges exactly what the
  operator sent; the address policy itself runs later in
  [`DnsWebhookTargetValidator`](#dnswebhooktargetvalidator). The design is recorded in
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: `IWebhookSubscriptionService.CreateAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/IWebhookSubscriptionService.cs:28`,
  see [`IWebhookSubscriptionService`](#iwebhooksubscriptionservice)) and the `[FromBody]` parameter of
  `CreateAsync` on [`WebhookSubscriptionsControllerBase`](#webhooksubscriptionscontrollerbase)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:87-88`).
  The answer is a [`WebhookSubscriptionSecretResponse`](#webhooksubscriptionsecretresponse).

### IWebhookDnsResolver
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/IWebhookDnsResolver.cs:9` · Level 0 · interface

- **What it is**: the internal abstraction that resolves a webhook target's host name to its IP
  addresses, used both when a subscription is validated and when a delivery connects
  (`IWebhookDnsResolver.cs:5-8`).
- **Depends on**: BCL `System.Net.IPAddress`. Implemented by
  [`SystemWebhookDnsResolver`](#systemwebhookdnsresolver).
- **Concept**: a test injection point over a static BCL call. `[Rubric §14, Testability]` assesses
  whether nondeterministic dependencies can be replaced; DNS is exactly that, and the doc says tests
  register a stub first (`IWebhookDnsResolver.cs:6-7`), which works because the default registration is
  a `TryAddSingleton` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:81`).
- **Walkthrough**: one member, `ResolveAsync(string host, CancellationToken)` returning
  `Task<IPAddress[]>`, "possibly none" (`IWebhookDnsResolver.cs:15`). An empty array is a legal answer
  and both callers handle it explicitly.
- **Why it's built this way**: one resolver feeds both the early check and the authoritative connect-time
  check, so a test can model a DNS answer that changes between them (the rebinding case the connect
  callback exists for). The interface is `internal`: hosts do not replace DNS resolution.
- **Where it's used**: [`DnsWebhookTargetValidator`](#dnswebhooktargetvalidator)
  (`DnsWebhookTargetValidator.cs:21,45`) and [`WebhookConnectCallback`](#webhookconnectcallback)
  (`WebhookConnectCallback.cs:23,40`); tests in
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Webhooks/` (`DnsWebhookTargetValidatorTests.cs`,
  `WebhookConnectCallbackTests.cs`, `AddWebhooksTests.cs`) supply stubs.

### UpdateWebhookSubscriptionRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Webhooks/UpdateWebhookSubscriptionRequest.cs:17` · Level 0 · record

- **What it is**: the wire body that replaces an existing subscription's target URL, description and
  event types (`UpdateWebhookSubscriptionRequest.cs:5`).
- **Depends on**: nothing first-party.
- **Concept**: same shape, limits and CA1054/CA1056 suppressions as
  [`CreateWebhookSubscriptionRequest`](#createwebhooksubscriptionrequest)
  (`UpdateWebhookSubscriptionRequest.cs:6-17`); see that section. It is a full replacement, not a patch:
  every field is required positionally, with only `Description` nullable.
- **Walkthrough**: `sealed record UpdateWebhookSubscriptionRequest(string Url, string? Description, IReadOnlyList<string> EventTypes)`
  (`UpdateWebhookSubscriptionRequest.cs:17`).
- **Why it's built this way**: a separate type from the create request keeps the two operations free to
  diverge without a breaking change, while today they carry identical fields. The update does not issue
  a secret, which is why its answer is the plain [`WebhookSubscriptionResponse`](#webhooksubscriptionresponse).
- **Where it's used**: `IWebhookSubscriptionService.UpdateAsync(Guid id, UpdateWebhookSubscriptionRequest request, ...)`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/IWebhookSubscriptionService.cs:35`)
  and the controller's `UpdateAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:112-114`).

### WebhookSubscriptionResponse
> MMCA.Common.Shared · `MMCA.Common.Shared.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Webhooks/WebhookSubscriptionResponse.cs:26` · Level 0 · record

- **What it is**: one subscription as the administration surface lists it, without its signing secret
  (`WebhookSubscriptionResponse.cs:5-8`).
- **Depends on**: nothing first-party.
- **Concept**: a read model that deliberately omits a sensitive field. `[Rubric §11, Security]` assesses
  whether secrets leak through read paths; here the secret is simply not a member, and the doc points to
  [`WebhookSubscriptionSecretResponse`](#webhooksubscriptionsecretresponse) as the only carrier, at
  create or rotate time (`WebhookSubscriptionResponse.cs:6-7`).
- **Walkthrough**: nine positional members (`WebhookSubscriptionResponse.cs:26-35`): `Id`, `Url`,
  `Description`, `EventTypes` (ordinal-sorted, `"*"` for all, line 12), `IsEnabled`, `CreatedOn`, and
  the delivery health fields `LastDeliveredOn`, `LastFailedOn` and `LastFailure` (lines 15-17), all UTC.
  The same CA1054/CA1056 suppressions as the request records apply (lines 18-25).
- **Why it's built this way**: surfacing the last-success and last-failure stamps on the list lets an
  operator see a broken receiver without reading logs, a small `[Rubric §13, Observability &
  Operability]` touch.
- **Where it's used**: built by [`WebhookSubscriptionService`](#webhooksubscriptionservice), returned by
  `ListAsync`, `UpdateAsync`, `DisableAsync` and `EnableAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/IWebhookSubscriptionService.cs:22,35,47,53`)
  and by the matching controller actions
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:54,112,161,182`);
  wrapped by [`WebhookSubscriptionSecretResponse`](#webhooksubscriptionsecretresponse).

### WebhookTargetRefusedException
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookTargetRefusedException.cs:7` · Level 0 · class

- **What it is**: the exception the webhook client's connect callback throws, before any socket opens,
  when a target host resolves to a non-public address; the sender maps it to `TargetRefused`
  (`WebhookTargetRefusedException.cs:3-6`).
- **Depends on**: BCL `HttpRequestException` (its base, line 7).
- **Concept**: a typed refusal distinct from a transport failure. `[Rubric §10, Messaging &
  Integration]` assesses whether delivery failures are classified so retries are spent sensibly; a
  generic socket error is retryable, while a refused target is a policy outcome, and this type is what
  lets [`HttpWebhookSender`](#httpwebhooksender) tell them apart.
- **Walkthrough**: the three conventional constructors (parameterless, message, message plus inner
  exception) at `WebhookTargetRefusedException.cs:10,16,24`; no extra state.
- **Why it's built this way**: deriving from `HttpRequestException` means a throw from inside
  `SocketsHttpHandler.ConnectCallback` travels through `HttpClient` the way any connect failure does.
  The sender then catches it both directly and as the `InnerException` of a wrapping
  `HttpRequestException` (`HttpWebhookSender.cs:82,86`), so the classification holds either way.
- **Where it's used**: thrown by [`WebhookConnectCallback`](#webhookconnectcallback)
  (`WebhookConnectCallback.cs:51`), caught by [`HttpWebhookSender`](#httpwebhooksender)
  (`HttpWebhookSender.cs:82-89`); exercised by `HttpWebhookSenderTests.cs`, `WebhookConnectCallbackTests.cs`
  and `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Webhooks/DeliverWebhookInternalCommandHandlerTests.cs`.
- **Caveats / not-in-source**: whether `HttpClient` surfaces the callback's exception wrapped or bare
  is runtime behavior of the BCL, not visible here; the double catch exists so the code does not depend
  on it.

### SystemWebhookDnsResolver
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/SystemWebhookDnsResolver.cs:6` · Level 1 · class

- **What it is**: the default [`IWebhookDnsResolver`](#iwebhookdnsresolver), a one-line pass-through to
  `Dns.GetHostAddressesAsync(host, cancellationToken)` (`SystemWebhookDnsResolver.cs:9-10`).
- **Depends on**: [`IWebhookDnsResolver`](#iwebhookdnsresolver); BCL `System.Net.Dns`.
- **Concept**: see [`IWebhookDnsResolver`](#iwebhookdnsresolver) for why DNS sits behind an interface.
- **Walkthrough**: `ResolveAsync` is an expression-bodied forward (`SystemWebhookDnsResolver.cs:9-10`);
  no caching, so every validation and every connect resolves afresh, which is what the connect-time
  check relies on.
- **Why it's built this way**: keeping the production implementation trivial leaves all policy in the
  callers ([`DnsWebhookTargetValidator`](#dnswebhooktargetvalidator) and
  [`WebhookConnectCallback`](#webhookconnectcallback)).
- **Where it's used**: registered as a singleton by
  [`WebhookServiceCollectionExtensions`](#webhookservicecollectionextensions)
  (`WebhookServiceCollectionExtensions.cs:81`).

### WebhookConnectCallback
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookConnectCallback.cs:16` · Level 1 · class (static)

- **What it is**: the `SocketsHttpHandler.ConnectCallback` of the `MMCA.Webhooks` client. It resolves
  the host itself, refuses before opening a socket when any resolved address is not public, then dials
  only the addresses it checked (`WebhookConnectCallback.cs:7-15`).
- **Depends on**: [`IWebhookDnsResolver`](#iwebhookdnsresolver),
  [`WebhookTargetRefusedException`](#webhooktargetrefusedexception),
  [`OutboundAddressPolicy`](group-12-api-hosting-mapping.md#outboundaddresspolicy); BCL
  `SocketsHttpHandler`, `Socket`, `NetworkStream`.
- **Concept introduced, connect-time SSRF defense.** `[Rubric §11, Security]` assesses whether
  server-side request forgery is closed, not just discouraged. A webhook target is operator-supplied, so
  a check at subscription time alone is defeated by DNS rebinding (the name resolves publicly when
  validated and privately when delivered) or by any handler that rewrites the request URI. Doing the
  resolution inside the connect callback means the address that is checked is the address that is
  dialled, on every delivery (`WebhookConnectCallback.cs:11-14`).
- **Walkthrough**:
  - `Create(resolver, allowInsecure)` (`WebhookConnectCallback.cs:22-29`) returns a closure over
    `context.DnsEndPoint`.
  - `ConnectAsync` (`WebhookConnectCallback.cs:31-71`): an IP literal is used as-is, otherwise the
    resolver is asked (lines 38-40). An empty answer throws `SocketException(HostNotFound)`, commented
    as not a refusal because it may be transient and so is retried (lines 42-46). Unless
    `allowInsecure`, the first address failing `OutboundAddressPolicy.IsPublicAddress` throws
    [`WebhookTargetRefusedException`](#webhooktargetrefusedexception) naming host and address (lines
    48-53). Then each checked address is tried in resolver order; the first that connects wins, and when
    none does the last `SocketException` surfaces (lines 55-70).
  - `ConnectToAsync` (`WebhookConnectCallback.cs:73-87`) opens a `NoDelay` TCP socket, wraps it in a
    `NetworkStream` with `ownsSocket: true`, and nulls the local so the `finally` disposes only on
    failure (lines 75-85).
- **Why it's built this way**: dialling the checked addresses itself, rather than letting the handler
  resolve again, removes the window between check and use. The refusal versus transport-failure split
  decides whether the internal-command queue retries. See
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: wired as the primary handler's `ConnectCallback` in
  [`WebhookServiceCollectionExtensions`](#webhookservicecollectionextensions)
  (`WebhookServiceCollectionExtensions.cs:95-99`); covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Webhooks/WebhookConnectCallbackTests.cs`.
- **Caveats / not-in-source**: `allowInsecure` is fixed when the primary handler is built (it is read at
  `WebhookServiceCollectionExtensions.cs:97-99`); how long that handler lives is governed by
  `IHttpClientFactory` handler rotation, which is not configured in this code.

### WebhookInsecureTargets
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookInsecureTargets.cs:11` · Level 1 · class (static)

- **What it is**: the single decision behind `Webhooks:AllowInsecureTargetsInDevelopment`: the flag is
  honoured only when a registered `IHostEnvironment` reports Development (`WebhookInsecureTargets.cs:6-10`).
- **Depends on**: [`WebhookSettings`](#webhooksettings); `Microsoft.Extensions.Hosting.IHostEnvironment`.
- **Concept introduced, a dev-only relaxation that fails closed.** `[Rubric §11, Security]` assesses
  whether convenience switches can leak into production. `AreAllowed` returns true only when the flag is
  set AND an environment is registered AND it is Development (`WebhookInsecureTargets.cs:17-18`); a host
  with no registered environment reads as production, the rule of
  [ADR-122](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html).
- **Walkthrough**: one method, `AreAllowed(WebhookSettings settings, IHostEnvironment? environment)`
  (`WebhookInsecureTargets.cs:17-18`).
- **Why it's built this way**: four call sites must agree on the same switch (validator, sender,
  connect callback wiring, startup notice); one helper means a production host cannot accept an http
  target at validation while refusing it at send, or the reverse.
- **Where it's used**: [`DnsWebhookTargetValidator`](#dnswebhooktargetvalidator)
  (`DnsWebhookTargetValidator.cs:30`), [`HttpWebhookSender`](#httpwebhooksender)
  (`HttpWebhookSender.cs:45`), [`InsecureWebhookTargetsNoticeService`](#insecurewebhooktargetsnoticeservice)
  (`InsecureWebhookTargetsNoticeService.cs:27`) and the connect callback wiring
  (`WebhookServiceCollectionExtensions.cs:97-99`).

### WebhookSubscriptionSecretResponse
> MMCA.Common.Shared · `MMCA.Common.Shared.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Webhooks/WebhookSubscriptionSecretResponse.cs:13` · Level 1 · record

- **What it is**: a [`WebhookSubscriptionResponse`](#webhooksubscriptionresponse) plus the plaintext
  signing `Secret` just issued for it, the answer to a create or a rotate
  (`WebhookSubscriptionSecretResponse.cs:3-5,13`).
- **Depends on**: [`WebhookSubscriptionResponse`](#webhooksubscriptionresponse).
- **Concept**: show-once secret delivery. `[Rubric §11, Security]`: only the protected secret is stored,
  so this response is the only place the plaintext ever appears, and a receiver that loses it rotates
  (`WebhookSubscriptionSecretResponse.cs:6-9`). The secret is `whsec_` followed by the Base64 key
  (line 12), the format [`WebhookSignature`](#webhooksignature) decodes.
- **Walkthrough**: `sealed record WebhookSubscriptionSecretResponse(WebhookSubscriptionResponse Subscription, string Secret)`
  (`WebhookSubscriptionSecretResponse.cs:13`).
- **Why it's built this way**: composing the plain response instead of adding a nullable `Secret` to it
  keeps the secret out of every list and update payload by construction.
- **Where it's used**: `CreateAsync` and `RotateSecretAsync` on
  [`IWebhookSubscriptionService`](#iwebhooksubscriptionservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/IWebhookSubscriptionService.cs:28,41`)
  and the controller actions
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:87,140`).

### InsecureWebhookTargetsNoticeService
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/InsecureWebhookTargetsNoticeService.cs:18` · Level 2 · class

- **What it is**: an `IHostedService` that logs one startup Warning when
  `Webhooks:AllowInsecureTargetsInDevelopment` is set in a host that is not Development, so the
  operator learns the flag is ignored at startup rather than from refused subscriptions
  (`InsecureWebhookTargetsNoticeService.cs:9-14`).
- **Depends on**: [`WebhookSettings`](#webhooksettings), [`WebhookInsecureTargets`](#webhookinsecuretargets);
  `IOptions<T>`, `IHostedService`, `ILogger` with `[LoggerMessage]` source generation.
- **Concept**: the observable half of a fail-closed relaxation. `[Rubric §13, Observability &
  Operability]` assesses whether misconfiguration is surfaced; ignoring the flag silently would be safe
  but confusing, and this service makes the ignored state visible once
  ([ADR-122](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html)).
- **Walkthrough**: `StartAsync` (`InsecureWebhookTargetsNoticeService.cs:24-33`) reads the optional
  environment through `IServiceProvider.GetService` (line 26), and logs when the flag is set but
  `WebhookInsecureTargets.AreAllowed` is false (lines 27-30), naming the environment or
  `"(none registered)"`. `StopAsync` is a no-op (line 36). The Warning text, generated at lines 38-41,
  states that targets must be https and resolve to public addresses only.
- **Why it's built this way**: resolving the environment optionally rather than as a constructor
  dependency lets the service run in a host that registers none, which is exactly the production case
  the rule must cover.
- **Where it's used**: registered with `TryAddEnumerable` as a singleton `IHostedService`
  (`WebhookServiceCollectionExtensions.cs:104`); covered by `DnsWebhookTargetValidatorTests.cs` and
  `AddWebhooksTests.cs` in `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Webhooks/`.

### DataProtectionWebhookSecretProtector
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/DataProtectionWebhookSecretProtector.cs:16` · Level 4 · class

- **What it is**: the default [`IWebhookSecretProtector`](#iwebhooksecretprotector), encrypting signing
  secrets at rest with the host's ASP.NET Core data-protection key ring under the purpose
  `MMCA.Common.Webhooks.Secret.v1` (`DataProtectionWebhookSecretProtector.cs:9-14`).
- **Depends on**: [`IWebhookSecretProtector`](#iwebhooksecretprotector),
  [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error),
  [`WebhookErrorCodes`](#webhookerrorcodes); `Microsoft.AspNetCore.DataProtection`.
- **Concept**: secrets encrypted at rest, with an unreadable secret as a value rather than an exception.
  `[Rubric §11, Security]` assesses secret storage; `[Rubric §29, Resilience & Business Continuity]`
  assesses graceful degradation. A replica without the shared key ring
  ([ADR-069](https://ivanball.github.io/docs/adr/069-shared-data-protection-key-ring.html)) cannot read
  another replica's secret, and that surfaces as `Webhooks.SecretUnreadable`, never as a throw
  (`DataProtectionWebhookSecretProtector.cs:11-13`).
- **Walkthrough**: the `Purpose` constant is part of the stored format and never changes
  (`DataProtectionWebhookSecretProtector.cs:18-19`); the protector is created once from it (line 21).
  `Protect` rejects null or empty and forwards (lines 24-28). `Unprotect` returns the failure for blank
  input (lines 33-36), otherwise `Result.Success` of the plaintext (line 40), mapping
  `CryptographicException` and `FormatException` to the same failure (lines 42-49). `Unreadable()` builds
  an `Error.Failure` with code `WebhookErrorCodes.SecretUnreadable` (lines 52-56).
- **Why it's built this way**: returning [`Result`](group-01-result-error-handling.md#result) lets
  [`HttpWebhookSender`](#httpwebhooksender) refuse to send unsigned instead of crashing a delivery; see
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: registered as a singleton (`WebhookServiceCollectionExtensions.cs:80`, with
  `AddDataProtection()` at line 85); consumed by `HttpWebhookSender.ReadKeys` (`HttpWebhookSender.cs:123`);
  covered by `DataProtectionWebhookSecretProtectorTests.cs`.

### DnsWebhookTargetValidator
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/DnsWebhookTargetValidator.cs:20` · Level 4 · class

- **What it is**: the default [`IWebhookTargetValidator`](#iwebhooktargetvalidator), the early answer to
  "may this URL be a webhook target?". The connect-time check stays authoritative; this one tells the
  operator at subscribe time (`DnsWebhookTargetValidator.cs:11-16`).
- **Depends on**: [`IWebhookDnsResolver`](#iwebhookdnsresolver), [`WebhookSettings`](#webhooksettings),
  [`WebhookInsecureTargets`](#webhookinsecuretargets),
  [`OutboundAddressPolicy`](group-12-api-hosting-mapping.md#outboundaddresspolicy),
  [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error),
  [`WebhookErrorCodes`](#webhookerrorcodes).
- **Concept**: defense in depth against SSRF, the early layer in front of
  [`WebhookConnectCallback`](#webhookconnectcallback). `[Rubric §11, Security]`.
- **Walkthrough**: `ValidateAsync` (`DnsWebhookTargetValidator.cs:26-55`) computes `allowInsecure`
  (line 30), then refuses any URI failing `OutboundAddressPolicy.IsAcceptableTargetUri` (lines 31-34).
  With insecure targets allowed, or an IP-literal host already judged by the policy, it succeeds without
  resolving (lines 36-40). Otherwise it resolves the host; any non-cancellation exception becomes a
  refusal (lines 42-50). It succeeds only when the answer is non-empty and every address is public
  (lines 52-54). `Refused` is an `Error.Validation` with code `WebhookErrorCodes.TargetNotAllowed` on the
  `Url` field (lines 57-58).
- **Why it's built this way**: a validation error tied to `Url` becomes a field-level 400 for the
  operator, where a connect-time refusal would only show later as a failed delivery. Requiring ALL
  addresses public matches the connect callback, which refuses on any non-public address. See
  [ADR-122](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html) and
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: registered scoped (`WebhookServiceCollectionExtensions.cs:78`) and called from
  [`WebhookSubscriptionService`](#webhooksubscriptionservice) through its injected
  `IWebhookTargetValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/WebhookSubscriptionService.cs:26,250`);
  covered by `DnsWebhookTargetValidatorTests.cs`.

### HttpWebhookSender
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/HttpWebhookSender.cs:25` · Level 4 · class

- **What it is**: the default [`IWebhookSender`](#iwebhooksender): one Standard Webhooks POST through the
  `MMCA.Webhooks` client, signed once per readable secret, mapped to a
  [`WebhookSendOutcome`](#webhooksendoutcome) from the status code or the exception alone; the response
  body is never read (`HttpWebhookSender.cs:14-19`).
- **Depends on**: [`IWebhookSecretProtector`](#iwebhooksecretprotector),
  [`WebhookSignature`](#webhooksignature), [`WebhookDeliveryRequest`](#webhookdeliveryrequest),
  [`WebhookSendStatus`](#webhooksendstatus), [`WebhookInsecureTargets`](#webhookinsecuretargets),
  [`WebhookTargetRefusedException`](#webhooktargetrefusedexception),
  [`OutboundAddressPolicy`](group-12-api-hosting-mapping.md#outboundaddresspolicy); `IHttpClientFactory`,
  `TimeProvider`.
- **Concept**: outcome classification for an at-least-once delivery. `[Rubric §10, Messaging &
  Integration]` assesses whether a sender tells retryable from terminal failures; this class turns every
  path into one of `Delivered`, `Gone`, `Rejected`, `TransportFailed`, `TargetRefused` or
  `SecretUnreadable`, and never throws for a receiver's behavior.
- **Walkthrough**:
  - Constants: `ClientName = "MMCA.Webhooks"`, `UserAgent = "MMCA-Webhooks/1"`, JSON media type
    (`HttpWebhookSender.cs:33-36`).
  - `SendAsync` (`HttpWebhookSender.cs:39-99`): re-applies the scheme rule with the same switch as the
    connect callback, so a stored `http://` row reaching a production host is refused, never sent in
    plaintext (lines 43-52). Reads the keys; none readable means `SecretUnreadable`, because an unsigned
    delivery is never sent (lines 54-59). Stamps a Unix timestamp from `TimeProvider` and joins one
    signature per key with spaces (lines 61-62). Builds the POST with the id, timestamp and signature
    headers and the user agent (lines 64-71), sends with `ResponseHeadersRead` (lines 75-78) and
    classifies (line 80). Catches map a refusal (bare or as inner exception) to `TargetRefused`, any other
    `HttpRequestException` to `TransportFailed`, and a client timeout (an `OperationCanceledException`
    while the caller's token is still live) to `TransportFailed` (lines 82-98).
  - `Classify` (`HttpWebhookSender.cs:102-110`): 410 is `Gone`, 2xx is `Delivered`, anything else,
    redirects included, is `Rejected`.
  - `ReadKeys` (`HttpWebhookSender.cs:118-136`): current secret first, then any readable previous one;
    an unreadable current secret yields no keys, an unreadable previous one is dropped.
- **Why it's built this way**: signing with every readable secret lets a receiver verify across a secret
  rotation; never reading the body keeps a hostile receiver from streaming data into the host. The
  dev-only switch is shared with the validator and the callback
  ([ADR-122](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html),
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)).
- **Where it's used**: registered scoped (`WebhookServiceCollectionExtensions.cs:79`), its named client
  configured at lines 87-102; called by
  [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:26,66`); covered by
  `HttpWebhookSenderTests.cs`.

### WebhookDeliveryLane
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookDeliveryLane.cs:20` · Level 15 · class (static)

- **What it is**: the dedicated internal-command lane that drains webhook delivery rows
  ([`DeliverWebhookInternalCommand`](#deliverwebhookinternalcommand)) with its own
  [`InternalCommandLaneProcessor`](group-07-persistence-ef-core.md#internalcommandlaneprocessor), never
  the shared loop, so a slow or failing receiver cannot delay the other internal commands
  (`WebhookDeliveryLane.cs:14-19`).
- **Depends on**: [`InternalCommandLane`](group-07-persistence-ef-core.md#internalcommandlane),
  [`InternalCommandLanes`](group-07-persistence-ef-core.md#internalcommandlanes),
  [`InternalCommandLaneProcessor`](group-07-persistence-ef-core.md#internalcommandlaneprocessor),
  [`InternalCommandProcessor`](group-07-persistence-ef-core.md#internalcommandprocessor),
  [`InternalCommandNameResolver`](group-07-persistence-ef-core.md#internalcommandnameresolver),
  [`InternalCommandsSettings`](group-07-persistence-ef-core.md#internalcommandssettings),
  [`IInternalCommandSignal`](group-07-persistence-ef-core.md#iinternalcommandsignal),
  [`FrameworkTableTargets`](group-07-persistence-ef-core.md#frameworktabletargets),
  [`WebhookSettings`](#webhooksettings).
- **Concept introduced, bulkhead lane over the durable job queue.** `[Rubric §29, Resilience & Business
  Continuity]` assesses failure isolation; webhook receivers are third-party and can be slow for
  minutes, so they get their own processor (a bulkhead) on top of the internal-command queue of
  [ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html). Keying rows
  by subscription means a failing subscription is cooled down on its own and two deliveries to one
  subscription never run at once (`WebhookDeliveryLane.cs:17-18`).
- **Walkthrough**:
  - `LaneName = "webhooks"`, the `lane` metric tag and log value (`WebhookDeliveryLane.cs:23`);
    `CommandType` is the stored command name computed from the type (lines 26-27).
  - `Create(settings)` (`WebhookDeliveryLane.cs:36-49`): cooldown from `ReceiverCooldownSeconds` (line
    43), receiver key = `SubscriptionId.ToString("N")` (lines 44-46), `MaxConcurrency` from
    `DeliveryConcurrency` (line 47), and `BatchStartBudget` from `TimeoutSeconds` (line 48).
  - `Register(services, configuration)` (`WebhookDeliveryLane.cs:58-81`): reads both settings sections
    straight from configuration (lines 60-62) and returns unless `Webhooks:Enabled` and
    `InternalCommands:Enabled` are both true; an existing `InternalCommandLanes` descriptor makes a
    second call a no-op (line 64). It registers the lane registry (line 69) and the processor as a plain
    factory singleton `IHostedService`, commented as needed because `AddHostedService` uses
    `TryAddEnumerable`, which refuses a factory registration (lines 71-80).
- **Why it's built this way**: reading configuration directly at registration mirrors how the queue reads
  its own flag (`WebhookDeliveryLane.cs:53-55`), so a disabled feature registers no hosted service at all.
  See [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: called from `AddWebhooks` (`WebhookServiceCollectionExtensions.cs:106`); covered by
  `WebhookDeliveryLaneTests.cs`,
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.SQLServer.Tests/Webhooks/WebhookDeliveryLaneSqlServerTests.cs`
  and `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests/InternalCommandLanePostgreSqlTests.cs`.

### WebhookServiceCollectionExtensions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Webhooks` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:19` · Level 16 · class (static, extension block)

- **What it is**: the public DI entry point `services.AddWebhooks(configuration)`, registering settings,
  the subscription store and service, the target validator, the signed sender and its client, the
  secret protector, the DNS resolver, the event catalog and the startup notice
  (`WebhookServiceCollectionExtensions.cs:23-28,67`).
- **Depends on**: every type in this part plus [`EFWebhookSubscriptionStore`](#efwebhooksubscriptionstore),
  [`WebhookSubscriptionService`](#webhooksubscriptionservice),
  [`WebhookEventCatalog`](#webhookeventcatalog) and [`WebhookSettings`](#webhooksettings);
  `IHttpClientFactory`, `SocketsHttpHandler`, `Microsoft.AspNetCore.DataProtection`.
- **Concept**: an `extension(IServiceCollection)` block as the public DI surface
  ([C# `extension(T)` types](00-primer.md#c-extensiont-types--read-this-once),
  [ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html)).
  `[Rubric §11, Security]`: the client is locked down in one place. `[Rubric §33, Developer
  Experience]`: the remarks are an adoption checklist.
- **Walkthrough**:
  - Settings bound, data-annotation validated and validated on start (`WebhookServiceCollectionExtensions.cs:71-74`,
    [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
  - `TryAdd` registrations, so a host or test can pre-register a replacement: scoped store, service,
    validator and sender; singleton protector, resolver, catalog and `TimeProvider.System` (lines 76-83);
    `AddDataProtection()` (line 85).
  - The `MMCA.Webhooks` client (lines 87-102): `Timeout` from `TimeoutSeconds`; a `SocketsHttpHandler`
    with no redirects, no proxy, no cookies, `ActivityHeadersPropagator = null` and the
    [`WebhookConnectCallback`](#webhookconnectcallback) (lines 89-100); every additional handler cleared
    (line 101) and all loggers removed (line 102).
  - The notice hosted service (line 104) and [`WebhookDeliveryLane.Register`](#webhookdeliverylane)
    (line 106).
- **Why it's built this way**: the remarks (`WebhookServiceCollectionExtensions.cs:31-66`) give the
  reasons. Calling this alone turns nothing on: with `Webhooks:Enabled` false the fan-out is inert and
  every administration endpoint answers 404; turning it on also needs `pipeline.AddWebhookDelivery()`,
  one `AddWebhookEvent<TEvent>(name)` per event, the migration, and a controller deriving from
  [`WebhookSubscriptionsControllerBase`](#webhooksubscriptionscontrollerbase) granted `webhooks:manage`
  (lines 32-40). Clearing host-default handlers makes the internal-command queue the only retry and
  failure policy, removing loggers keeps target URLs (often carrying a receiver token) out of logs, and
  no `traceparent`/`tracestate`/`baggage` reaches the receiver (lines 47-55,
  [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)). A
  multi-replica host needs the shared key ring
  ([ADR-069](https://ivanball.github.io/docs/adr/069-shared-data-protection-key-ring.html), lines 42-46).
  Lane defaults, including `Webhooks:DeliveryConcurrency` (default 4) per replica, are documented at
  lines 57-65 ([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)).
- **Where it's used**: no call site outside the defining file in `MMCA.Common/Source`, and none in
  `MMCA.ADC/Source` (no `AddWebhooks(` or `WebhookSubscriptionsControllerBase` match); exercised by
  `AddWebhooksTests.cs`.
- **Caveats / not-in-source**: the default of 4 stated in the remarks (line 59) matches its declaration
  on [`WebhookSettings`](#webhooksettings)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookSettings.cs:41`). The remark notes the HTTP client trace still records the URL path, so a host exporting
  traces to a shared backend must filter `MMCA.Webhooks` spans itself (lines 53-55).

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:379`);
  the background [`OutboxProcessor`](#outboxprocessor) routes non-integration events through it
  (`OutboxProcessor.cs:830`), as do [`InProcessMessageBus`](#inprocessmessagebus)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:24,31`) and
  [`InProcessEventBus`](#inprocesseventbus)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:85,101`).

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
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Events` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventBus.cs:13` · Level 2 · interface

- **What it is**: the abstraction application code publishes [`IIntegrationEvent`](#iintegrationevent)s
  through. Two `PublishAsync` overloads (`IEventBus.cs:20` and `:25`): a single event and a batch.
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
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Events` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IIntegrationEventHandler.cs:17` · Level 2 · interface

- **What it is**: the handler contract for *receiving* integration events. One method,
  `HandleAsync(TIntegrationEvent, CancellationToken)` (`IIntegrationEventHandler.cs:26`).
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1).
- **Concept**: mirrors [`IDomainEventHandler<in TDomainEvent>`](#idomaineventhandlerin-tdomainevent)
  (Level 1) but for cross-module notifications, and the doc comment contrasts the two directly
  (`IIntegrationEventHandler.cs:5-15`): a domain-event handler reacts to *intra-module* events, an
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
  `MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:123`) beside its plain
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

### IMessageBus
> MMCA.Common.Application · `MMCA.Common.Application.Messaging` · `MMCA.Common.Application/Messaging/IMessageBus.cs:29` · Level 2 · interface

- **What it is**: the **transport-agnostic** abstraction for publishing integration events across
  module or service boundaries. Two `PublishAsync` overloads, single event
  (`MMCA.Common.Application/Messaging/IMessageBus.cs:36`) and batch (`IMessageBus.cs:43`).
- **Depends on**: [`IIntegrationEvent`](#iintegrationevent) (Level 1). Nothing else, which is the
  point: this file has one `using` and it is a Domain namespace (`IMessageBus.cs:1`).
- **Concept introduced, a transport-agnostic message bus for microservices readiness.**
  `[Rubric §7, Microservices Readiness]` assesses whether the transport is a swappable boundary and
  whether the business layers stay free of transport coupling. The doc comment (`IMessageBus.cs:5-28`)
  enumerates both implementations explicitly: [`InProcessMessageBus`](#inprocessmessagebus) dispatches
  synchronously through the existing [`IDomainEventDispatcher`](#idomaineventdispatcher) path for the
  modular-monolith deployment (`IMessageBus.cs:14-18`), and [`BrokerMessageBus`](#brokermessagebus)
  publishes through the selected framework broker transport (an
  [`IBrokerTransport`](group-14-module-system-composition.md#ibrokertransport),
  `MMCA.Common.Infrastructure/Messaging/Transports/IBrokerTransport.cs:22`), RabbitMQ in development
  and Azure Service Bus in production, for the extracted-service mode (`IMessageBus.cs:19-25`,
  `MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:46`). The same comment records why
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
  `Application`, `Domain`, and `Shared` must never reference a broker client directly (RabbitMQ,
  Azure Service Bus, Amazon SQS and SNS, and MassTransit, which is banned outright), and the
  architecture transport-boundary rule enforces exactly that
  (`MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:14-20`, run by
  `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:11`).
  The **MassTransit ban** is a separate constraint enforced by the dependency-version fitness test,
  which fails the build on any `MassTransit*` PackageVersion
  (`MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:13-18`,
  [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html)).
- **Where it's used**: implemented by [`InProcessMessageBus`](#inprocessmessagebus), the default
  scoped registration (`MMCA.Common.Infrastructure/DependencyInjection.cs:366`, with the rationale
  comment at `DependencyInjection.cs:551-555`), and by [`BrokerMessageBus`](#brokermessagebus), which
  `Replace`s that registration inside `AddBrokerMessaging`
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:119`). At runtime it is resolved per cycle by
  the background [`OutboxProcessor`](#outboxprocessor)
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:212`) and invoked for every
  integration-event row it drains (`OutboxProcessor.cs:590-600`).

`[Rubric §10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

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
  fetching an exhausted row is `OutboxProcessor.cs:285` and the dead-letter branch is
  `OutboxProcessor.cs:610`). `[Rubric §13, Observability & Operability]`: the one job the base class
  keeps is the error line naming the concrete handler and the event type, so an operator can tell
  which handler failed for which event without every subclass hand-rolling that context.
- **Concept introduced, batch redelivery.** The consequence subclasses have to design for is in the
  class comment (`SafeDomainEventHandler.cs:21-29`):
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  dispatches every local event of one save in a single `DispatchAsync` call
  (`MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:379`) and
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
    `"Domain event handler {HandlerType} failed for event {EventType}. The event is redelivered by the outbox processor when the outbox is on."`
    (`SafeDomainEventHandler.cs:63-67`) and always returns `false`
    (`SafeDomainEventHandler.cs:69`), so the filter never matches and the exception keeps propagating.
    The message's closing clause is conditional on purpose: redelivery happens only when the outbox
    is enabled for the host, so the log line does not promise a retry the deployment may not run.
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
  [`TestSafeDomainEventHandler`](group-29-testing-infrastructure.md#per-project-test-rollup)
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:124`),
  driven by
  [`SafeDomainEventHandlerTests`](group-29-testing-infrastructure.md#per-project-test-rollup),
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
  `Outbox:MaxRetries` attempts; on the **broker** path the inbox row stays unprocessed and the framework broker receive pipeline
  ([`BrokerReceivePipeline`](group-14-module-system-composition.md#brokerreceivepipeline)) retries,
  redelivers and then moves the message to the dead-letter queue (`ScopedIntegrationEventHandlerBase.cs:31-33`). Delivery is at-least-once either way, so
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
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:62`),
  `SpeakerLinkedToUserHandler`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:46`),
  `SpeakerUnlinkedFromUserHandler`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandler.cs:31`),
  the Engagement points handlers (`AttendeeCheckedInPointsHandler`,
  `EventFeedbackSubmittedPointsHandler`, `SessionFeedbackSubmittedPointsHandler`,
  `UserDeletedPointsHandler`), and Store's `CustomerErasedHandler`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Reviews/IntegrationEventHandlers/CustomerErasedHandler.cs:48`).
  Its behaviour is pinned by
  [`ScopedIntegrationEventHandlerBaseTests`](group-29-testing-infrastructure.md#per-project-test-rollup).
  At runtime the subclasses are reached either through
  [`DomainEventDispatcher`](#domaineventdispatcher) in monolith mode or through
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent) in broker mode.
- **Caveats / not-in-source**: the base cannot enforce the idempotency it requires, and it cannot stop
  a `LogHandlerFailure` override from throwing inside the filter; both stay subclass obligations
  documented in the remarks (`ScopedIntegrationEventHandlerBase.cs:33`,
  `ScopedIntegrationEventHandlerBase.cs:82-83`).

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
  (`MMCA.Common.Application/DependencyInjection.cs:38`, beside the
  [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) registration at
  `DependencyInjection.cs:41`); called by
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  after the outbox rows are written
  (`MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:379`), by
  the background [`OutboxProcessor`](#outboxprocessor) when re-dispatching persisted domain events
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:830`), and by both in-process
  buses ([`InProcessMessageBus`](#inprocessmessagebus),
  [`InProcessEventBus`](#inprocesseventbus)).

### IWebhookSecretProtector
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Subscriptions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/IWebhookSecretProtector.cs:9` · Level 3 · interface

- **What it is**: the port that protects a webhook signing secret at rest and recovers it for
  signing. Two members: `string Protect(string secret)` (`IWebhookSecretProtector.cs:14`) and
  `Result<string> Unprotect(string protectedSecret)` (`IWebhookSecretProtector.cs:19`).
- **Depends on**: the Result pattern from `MMCA.Common.Shared.Abstractions`
  (`IWebhookSecretProtector.cs:1`); nothing else.
- **Concept introduced, a secret that is stored protected and recovered without throwing.**
  `[Rubric §11, Security]` assesses how secrets are held at rest and whether a key failure degrades
  safely. Here the subscription row only ever stores the protected form, and the read side is a
  `Result`, not an exception: the doc on `Unprotect` says it "never throws" and answers
  `Webhooks.SecretUnreadable` instead (`IWebhookSecretProtector.cs:16-18`). The interface doc names
  the operational consequence (`IWebhookSecretProtector.cs:5-8`): the default sits on the host's
  data-protection key ring, so a multi-replica host needs the shared key ring of
  [ADR-069](https://ivanball.github.io/docs/adr/069-shared-data-protection-key-ring.html), or one
  replica cannot read a secret another replica wrote.
- **Walkthrough**: `Protect` is synchronous and returns the stored form. `Unprotect` returns the
  plaintext on success. The default
  [`DataProtectionWebhookSecretProtector`](#dataprotectionwebhooksecretprotector)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/DataProtectionWebhookSecretProtector.cs:16`)
  creates one `IDataProtector` under the fixed purpose `MMCA.Common.Webhooks.Secret.v1`, which its
  comment marks as part of the stored format, so it never changes, and answers a blank input as
  unreadable before trying to decrypt.
- **Why it's built this way**: an unreadable secret is an expected runtime condition (a replica
  without the shared key ring, a rotated-out key), so modelling it as a `Result` lets the sender fail
  one delivery cleanly rather than crash the delivery pipeline.
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html) records
  the split: an unreadable current secret means nothing is sent, an unreadable previous secret is
  dropped from the signature set.
- **Where it's used**: registered as a singleton by `AddWebhooks(configuration)`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:80`,
  [`WebhookServiceCollectionExtensions`](#webhookservicecollectionextensions)); `Protect` is called by
  [`WebhookSubscriptionService`](#webhooksubscriptionservice) at create and rotate, and `Unprotect` by
  [`HttpWebhookSender`](#httpwebhooksender) for each stored secret it signs with
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/HttpWebhookSender.cs:123`).

### IWebhookSubscriptionService
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Subscriptions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/IWebhookSubscriptionService.cs:11` · Level 3 · interface

- **What it is**: the administration API behind the webhook-subscription endpoints: two read-only
  properties and seven `Result`-returning operations, always scoped to the caller's tenant.
- **Depends on**: the Result pattern (`MMCA.Common.Shared.Abstractions`), and the wire contracts in
  `MMCA.Common.Shared.Webhooks` (`IWebhookSubscriptionService.cs:1-2`):
  [`CreateWebhookSubscriptionRequest`](#createwebhooksubscriptionrequest),
  [`UpdateWebhookSubscriptionRequest`](#updatewebhooksubscriptionrequest),
  [`WebhookSubscriptionResponse`](#webhooksubscriptionresponse), and
  [`WebhookSubscriptionSecretResponse`](#webhooksubscriptionsecretresponse).
- **Concept introduced, a show-once secret in the contract shape.** `[Rubric §9, API & Contract
  Design]` assesses whether a contract makes misuse hard. The return types do that here: only
  `CreateAsync` (`IWebhookSubscriptionService.cs:28`) and `RotateSecretAsync`
  (`IWebhookSubscriptionService.cs:41`) return a `WebhookSubscriptionSecretResponse`; every other
  operation returns the secretless `WebhookSubscriptionResponse`, so no read path can leak the signing
  secret (interface doc, `IWebhookSubscriptionService.cs:6-10`). `[Rubric §11, Security]`: the same
  doc fixes the tenancy rule, an id belonging to another tenant or to a deleted row answers
  `Webhooks.NotFound`, so a caller cannot probe for another tenant's subscriptions.
- **Walkthrough**
  - `IsEnabled` (`IWebhookSubscriptionService.cs:14`) reports whether outbound webhooks are on in this
    host; `EventTypes` (`IWebhookSubscriptionService.cs:17`) lists the event types the host publishes.
  - `ListAsync` (`IWebhookSubscriptionService.cs:22`) returns the caller's subscriptions without
    secrets.
  - `CreateAsync` (`IWebhookSubscriptionService.cs:28`) and `UpdateAsync`
    (`IWebhookSubscriptionService.cs:35`) take the request records; update replaces target,
    description and event types.
  - `RotateSecretAsync` (`IWebhookSubscriptionService.cs:41`) issues a new secret while the previous
    one keeps signing for the configured grace period (doc, line 37).
  - `DisableAsync`, `EnableAsync`, and `DeleteAsync` (`IWebhookSubscriptionService.cs:47`, `:53`,
    `:59`); delete is a soft delete and returns a bare `Result`.
- **Why it's built this way**: keeping the operations behind an Application port lets the API layer
  stay a thin adapter (`[Rubric §3, Clean Architecture]`), and the `IsEnabled` flag lets one
  controller base ship in every host and simply answer not-found where webhooks are off
  ([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)).
- **Where it's used**: implemented by [`WebhookSubscriptionService`](#webhooksubscriptionservice),
  registered scoped
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:77`);
  consumed by [`WebhookSubscriptionsControllerBase`](#webhooksubscriptionscontrollerbase), which
  resolves it optionally from the request services and treats it as absent unless `IsEnabled` is true
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:43-44`).

### IWebhookTargetValidator
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Subscriptions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/IWebhookTargetValidator.cs:10` · Level 3 · interface

- **What it is**: the port that decides whether a webhook target URL may be stored. One method,
  `Task<Result> ValidateAsync(Uri target, CancellationToken)` (`IWebhookTargetValidator.cs:16`), which
  answers success or `Webhooks.TargetNotAllowed` (doc, line 15).
- **Depends on**: the Result pattern (`MMCA.Common.Shared.Abstractions`, `IWebhookTargetValidator.cs:1`);
  `System.Uri`.
- **Concept introduced, save-time SSRF feedback versus the connect-time guarantee.**
  `[Rubric §11, Security]` assesses defences against server-side request forgery, where a stored URL
  makes the server call into its own network. The interface doc states the policy and its limit
  (`IWebhookTargetValidator.cs:5-9`): https only, no local host, every address the host resolves to
  must be public (unless insecure targets are allowed in Development), and the connect-time check of
  the delivery client "stays authoritative". This validator is early feedback for the person
  registering the target; it cannot be the guarantee, because DNS can answer differently at delivery
  time. The connect-time half is [`WebhookConnectCallback`](#webhookconnectcallback).
- **Walkthrough**: a one-method async port. It is async because the default
  [`DnsWebhookTargetValidator`](#dnswebhooktargetvalidator)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/DnsWebhookTargetValidator.cs:20`)
  resolves the host through [`IWebhookDnsResolver`](#iwebhookdnsresolver) before judging the
  addresses.
- **Why it's built this way**: putting the check behind a port keeps DNS out of the Application layer
  (`[Rubric §3, Clean Architecture]`) and lets tests substitute a fixed answer
  (`[Rubric §14, Testability]`). See
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html) for why
  the policy is checked where the socket opens as well.
- **Where it's used**: registered scoped
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:78`);
  called by [`WebhookSubscriptionService`](#webhooksubscriptionservice) on create and update
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/WebhookSubscriptionService.cs:249-250`).

### IWebhookSubscriptionStore
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Subscriptions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/IWebhookSubscriptionStore.cs:10` · Level 5 · interface

- **What it is**: the persistence port for [`WebhookSubscription`](#webhooksubscription) rows, with
  four reads and three writes, every read filtered by tenant.
- **Depends on**: [`WebhookSubscription`](#webhooksubscription) (Level 4, `MMCA.Common.Domain.Webhooks`,
  `IWebhookSubscriptionStore.cs:1`).
- **Concept introduced, an explicit tenant argument instead of an ambient filter.**
  `[Rubric §11, Security]` and `[Rubric §8, Data Architecture]` both look at how tenant isolation is
  enforced. Every read takes `string? tenantId`, and the interface doc fixes the semantics
  (`IWebhookSubscriptionStore.cs:5-9`): reads filter by tenant, a `null` tenant matches only untenanted
  rows, and a soft-deleted row is never returned. Passing the tenant explicitly, rather than relying on
  the tenant-entity marker, is what lets webhooks work in a host that never resolves a tenant
  ([ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html)).
- **Walkthrough**
  - `ListAsync` (`IWebhookSubscriptionStore.cs:16`) lists the tenant's subscriptions for the admin API;
    `ListEnabledAsync` (`IWebhookSubscriptionStore.cs:22`) lists only enabled ones, for the fan-out.
  - `FindAsync` (`IWebhookSubscriptionStore.cs:29`) returns one row tracked for an update, or `null`.
  - `CountAsync` (`IWebhookSubscriptionStore.cs:35`) counts non-deleted rows, which backs the
    per-tenant limit.
  - `AddAsync` (`IWebhookSubscriptionStore.cs:41`) adds and saves; `SaveAsync`
    (`IWebhookSubscriptionStore.cs:47`) saves an administrative change to a row from `FindAsync`.
  - `RecordOutcomeAsync` (`IWebhookSubscriptionStore.cs:56`) saves a delivery's last-outcome columns
    and swallows a concurrency conflict, because a concurrent admin change or another delivery
    outcome has already moved the row (doc, `IWebhookSubscriptionStore.cs:49-52`).
    `[Rubric §29, Resilience & Business Continuity]`: a lost last-outcome write is cosmetic, so it is
    not allowed to fail a delivery that already happened.
- **Why it's built this way**: separating `SaveAsync` from `RecordOutcomeAsync` gives the two writers
  different conflict policies, strict for an operator's change, best-effort for delivery bookkeeping.
- **Where it's used**: implemented by [`EFWebhookSubscriptionStore`](#efwebhooksubscriptionstore)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Webhooks/EFWebhookSubscriptionStore.cs:30`),
  registered scoped
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:76`).
  Consumed by [`WebhookSubscriptionService`](#webhooksubscriptionservice), by
  [`WebhookFanOutHandler<TEvent>`](#webhookfanouthandlertevent) through `ListEnabledAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/WebhookFanOutHandler.cs:70-71`),
  and by [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler) through
  `FindAsync` and `RecordOutcomeAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:52`,
  `:69`). [`WebhookRegistrationValidator`](#webhookregistrationvalidator) fails startup when delivery
  is registered without a store
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookRegistrationValidator.cs:18-21`),
  the fail-fast contract of
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html).

### WebhookSubscriptionService
> MMCA.Common.Application · `MMCA.Common.Application.Webhooks.Subscriptions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/Subscriptions/WebhookSubscriptionService.cs:24` · Level 6 · class (public sealed)

- **What it is**: the default [`IWebhookSubscriptionService`](#iwebhooksubscriptionservice). It
  validates a subscription definition, enforces the per-tenant limit, checks the target, generates and
  protects the signing secret, and drives the [`WebhookSubscription`](#webhooksubscription) aggregate's
  own methods for every change.
- **Depends on**: [`IWebhookSubscriptionStore`](#iwebhooksubscriptionstore),
  [`IWebhookTargetValidator`](#iwebhooktargetvalidator),
  [`IWebhookSecretProtector`](#iwebhooksecretprotector),
  [`WebhookEventCatalog`](#webhookeventcatalog), `ITenantContext`,
  `IOptions<`[`WebhookSettings`](#webhooksettings)`>`, and `TimeProvider`, all through the primary
  constructor (`WebhookSubscriptionService.cs:24-31`); also [`WebhookSignature`](#webhooksignature)
  and [`WebhookErrorCodes`](#webhookerrorcodes).
- **Concept, cheap checks before expensive ones, domain rules in the aggregate.** The class doc
  (`WebhookSubscriptionService.cs:10-16`) lists the contract: caller's tenant only, event types are
  `"*"` or registered in the catalog, targets pass the validator, and a new secret is generated, stored
  only protected, and returned once. `[Rubric §4, DDD]`: the service owns cross-cutting checks
  (catalog, tenant limit, DNS) while the aggregate's `Create`, `Update`, `RotateSecret`, `Disable`,
  `Enable`, and `Delete` own the entity invariants. `[Rubric §11, Security]`: the plaintext secret
  exists only in the returned response; the row receives `secretProtector.Protect(secret)`.
- **Walkthrough**
  - `IsEnabled` maps `settings.Value.Enabled` (`WebhookSubscriptionService.cs:34`); `EventTypes` maps
    the catalog (`WebhookSubscriptionService.cs:37`). `UtcNow` reads the injected `TimeProvider`
    (`WebhookSubscriptionService.cs:39`), so disable and rotation instants are testable
    (`[Rubric §14, Testability]`).
  - `ListAsync` (`WebhookSubscriptionService.cs:42`) reads the tenant's rows and maps each through
    `ToResponse` (`WebhookSubscriptionService.cs:179`), which never copies a secret.
  - `CreateAsync` (`WebhookSubscriptionService.cs:50`) runs in a fixed order. A missing `eventTypes`
    member binds `null` and is treated as empty so the domain answers `EventTypesRequired`
    (`WebhookSubscriptionService.cs:58-59`). `CheckDefinition` runs first (line 60), then the
    tenant count against `MaxSubscriptionsPerTenant` with a `Webhooks.LimitReached` conflict
    (`WebhookSubscriptionService.cs:66-73`; default 25, range 1 to 500,
    `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookSettings.cs:66-67`), then the DNS
    target check (line 75), so the network call runs last. The secret comes from
    `WebhookSignature.GenerateSecret()` (line 81), the aggregate is built with the protected form
    (`WebhookSubscriptionService.cs:82-87`), saved (line 93), and returned with the plaintext once
    (line 94).
  - `UpdateAsync` (`WebhookSubscriptionService.cs:98`) finds the caller's own row, re-runs the
    definition and target checks, calls `subscription.Update` (line 124) and saves (line 130). It does
    not re-check the limit, because an update does not add a row.
  - `RotateSecretAsync` (`WebhookSubscriptionService.cs:135`) protects a fresh secret and hands the
    aggregate the previous-secret expiry `UtcNow.AddHours(PreviousSecretGraceHours)`
    (`WebhookSubscriptionService.cs:144-146`; default 24, range 0 to 168, `WebhookSettings.cs:59-60`).
  - `DisableAsync` and `EnableAsync` (`WebhookSubscriptionService.cs:153-158`) go through the shared
    `ChangeAsync` helper (`WebhookSubscriptionService.cs:194`); `DeleteAsync`
    (`WebhookSubscriptionService.cs:161`) returns the aggregate's own `Delete()` failure unchanged
    (line 169).
  - `FindOwnAsync` (`WebhookSubscriptionService.cs:211`) passes the caller's `TenantId` to the store and
    also drops a soft-deleted row (`WebhookSubscriptionService.cs:214`), so every not-found case,
    including another tenant's id, collapses to the one `Webhooks.NotFound` error built at
    `WebhookSubscriptionService.cs:191`.
  - `CheckDefinition` (`WebhookSubscriptionService.cs:218`) collects errors rather than stopping at the
    first: a URL that is blank or not absolute gives `UrlInvalid` (line 222), and every event type that
    is neither `WebhookSubscription.AllEventTypes` nor in the catalog is reported, de-duplicated, in
    one `EventTypeUnknown` error (`WebhookSubscriptionService.cs:231-244`).
  - `ValidateTargetAsync` (`WebhookSubscriptionService.cs:249-250`) builds the absolute `Uri` only
    after `CheckDefinition` has proved it parses.
- **Why it's built this way**: running the database count and the DNS lookup only after the pure
  checks keeps a malformed request from costing a query or a network call, and collapsing every
  ownership miss into one error keeps tenant boundaries opaque.
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html) covers
  the rotation window and the show-once secret.
- **Where it's used**: registered scoped as `IWebhookSubscriptionService`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:77`)
  and reached through [`WebhookSubscriptionsControllerBase`](#webhooksubscriptionscontrollerbase).
- **Caveats / not-in-source**: the tenant limit is a count followed by an insert with no lock between
  them (`WebhookSubscriptionService.cs:66` and `:93`), so concurrent creates can exceed it; ADR-142
  records it as a soft limit.

### InProcessMessageBus
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Messaging` · `MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:18` · Level 3 · class (public sealed)

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
- **Walkthrough**: both overloads (`InProcessMessageBus.cs:21` and `InProcessMessageBus.cs:28`)
  null-guard and then forward straight to `domainEventDispatcher.DispatchAsync([integrationEvent], ...)`
  (`InProcessMessageBus.cs:24`) and `DispatchAsync(integrationEvents, ...)`
  (`InProcessMessageBus.cs:31`). Neither returns an awaited task; both return the dispatcher's task
  directly, so there is no extra state machine on this path. No outbox write happens here: the doc
  comment (`InProcessMessageBus.cs:11-16`) is explicit that this bus is meant to be invoked by the
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
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:366`, with the rationale comment at
  `DependencyInjection.cs:551-555`), and therefore the bus resolved by
  [`OutboxProcessor`](#outboxprocessor) in monolith mode
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:212`). It is replaced by
  [`BrokerMessageBus`](#brokermessagebus) in broker-mode service hosts
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:119`).

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
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Events.cs:146-153`).
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
  (`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:158-160`). It is
  published in ADC by `BookmarkCacheEvictionProcessor`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Caching/BookmarkCacheEvictionProcessor.cs:71`),
  which paces the evictions that `UserSessionBookmarkCacheEvictionHandler` only flags
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:58`).

### IntegrationEventConsumerExtensions
> MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Messaging.Consumers` | `MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:11` | Level 4 | class (public static)

- **What it is**: a C# `extension(IBrokerConsumerBuilder)` block
  (`MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:13`) that adds
  one named registration shorthand, `RegisterOutputCacheEvictionConsumer()`, to
  [`IBrokerConsumerBuilder`](group-14-module-system-composition.md#ibrokerconsumerbuilder), the builder
  the `configureConsumers` callback of `AddBrokerMessaging` receives (class doc,
  `IntegrationEventConsumerExtensions.cs:6-10`). The generic `RegisterIntegrationEventConsumer<TEvent>()`
  and `RegisterUpcastedIntegrationEventConsumer<TEvent>()` are members of that interface itself
  (`MMCA.Common.Infrastructure/Messaging/Broker/IBrokerConsumerBuilder.cs:26`,
  `IBrokerConsumerBuilder.cs:40`), not of this class.
- **Depends on**: [`IBrokerConsumerBuilder`](group-14-module-system-composition.md#ibrokerconsumerbuilder),
  [`OutputCacheEvictionRequested`](#outputcacheevictionrequested). No external messaging library.
- **Concept reinforced, `extension(T)` members as registration sugar.** The `extension(T)` syntax is the
  workspace-wide DI-registration idiom (see the primer's conventions section). `[Rubric S7, Microservices
  Readiness]`: a host declares what it consumes by event type and never names the consumer class the
  receive pipeline resolves, so the registration call site stays decoupled from the concrete consumer.
- **Walkthrough**: `RegisterOutputCacheEvictionConsumer()` (`IntegrationEventConsumerExtensions.cs:28`)
  null-guards the builder (`IntegrationEventConsumerExtensions.cs:30`) and returns
  `builder.RegisterIntegrationEventConsumer<OutputCacheEvictionRequested>()`
  (`IntegrationEventConsumerExtensions.cs:32`), so it chains like the interface members. It exists purely
  so the wiring reads as an intention rather than a type argument, and its doc pairs it with
  `services.AddOutputCacheEvictionHandler()` from MMCA.Common.API: subscribing without the handler is
  harmless but pointless, because the messages complete with a "no handler registered" log and nothing
  is evicted (`IntegrationEventConsumerExtensions.cs:15-26`).
- **Why it's built this way**: there is one queue per host and no per-consumer endpoint configuration,
  and a consumer that exhausts its retries is dead-lettered, logged and counted (`broker.fault.count`)
  by the framework's receive pipeline, so no separate fault consumer and no fault opt-out parameter
  exist to register (`IBrokerConsumerBuilder.cs:9-14`). That leaves this class with nothing to hide but
  a type argument. The transport-boundary fitness rule keeps Application and Domain off any messaging
  library (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:7`;
  [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
- **Where it's used**: inside a host's `configureConsumers` callback
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:65`, invoked at
  `DependencyInjection.Messaging.cs:92`); the ADC Conference service passes
  `ConferenceBrokerConsumers.Register` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:360`)
  and its comments name `RegisterOutputCacheEvictionConsumer` as the broker half of output-cache
  eviction (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:278-279`).

`[Rubric S10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### WebhookSubscription
> MMCA.Common.Domain | `MMCA.Common.Domain.Webhooks` | `MMCA.Common.Domain/Webhooks/WebhookSubscription.cs:38` | Level 4 | class (public sealed)

- **What it is**: one outbound webhook subscription, an auditable entity keyed by `Guid` that names a
  target URL receiving a signed POST for every published integration event whose webhook type it lists,
  or every type through `AllEventTypes = "*"` (class doc,
  `MMCA.Common.Domain/Webhooks/WebhookSubscription.cs:7-9`; constant, `WebhookSubscription.cs:62`).
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (`WebhookSubscription.cs:38`), [`Result`](group-01-result-error-handling.md#result) and
  [`Error`](group-01-result-error-handling.md#error) for the factory and update; BCL `Uri` for URL
  validation.
- **Concept reinforced, the entity factory returns `Result<T>` and guards its own invariants.** The
  Result pattern is taught in the primer. `[Rubric S4, DDD]` assesses whether invariants live on the
  entity: here every property has a private setter (`WebhookSubscription.cs:71-101`), the constructor is
  private (`WebhookSubscription.cs:66`), and both `Create` and `Update` run the same
  `ValidateDefinition` so a subscription can never hold an invalid URL or event list.
  `[Rubric S11, Security]`: the signing secret is only ever held protected (`ProtectedSecret`,
  `WebhookSubscription.cs:83`); the plaintext is returned once, at create or rotate (class doc,
  `WebhookSubscription.cs:15-19`).
- **Walkthrough**
  - Column widths and limits as public constants (`WebhookSubscription.cs:41-59`): `UrlMaxLength` 2048,
    `DescriptionMaxLength` 200, `EventTypesMaxLength` 2048, `MaxEventTypes` 20,
    `ProtectedSecretMaxLength` 1024, `TenantIdMaxLength` 64, `LastFailureMaxLength` 500. The EF mapping
    reads these rather than repeating the numbers (see
    [`WebhookSubscriptionModelBuilderExtensions`](#webhooksubscriptionmodelbuilderextensions)).
  - `Create(url, description, eventTypes, tenantId, protectedSecret)` (`WebhookSubscription.cs:110`)
    collects the definition errors (`WebhookSubscription.cs:117`), adds `Webhooks.SecretRequired` for a
    blank secret (`WebhookSubscription.cs:118-122`), returns every error at once
    (`WebhookSubscription.cs:124-127`), and otherwise builds the entity with `Id = Guid.NewGuid()`
    (`WebhookSubscription.cs:129-137`).
  - `Update(url, description, eventTypes)` (`WebhookSubscription.cs:145`) re-validates and replaces only
    the URL, description and event types; a failure leaves the subscription unchanged, and secrets and
    outcome columns are kept.
  - `ValidateDefinition` (`WebhookSubscription.cs:221`): `Webhooks.UrlInvalid` unless `IsValidUrl` holds
    (`WebhookSubscription.cs:231-238`), which demands an absolute `https` or `http` URL of at most 2048
    characters with no user info and no fragment (`WebhookSubscription.cs:273-281`); the description is
    trimmed, blank becoming `null`, and over 200 characters yields `Webhooks.DescriptionTooLong`
    (`WebhookSubscription.cs:240-245`); an empty or blank-containing event list yields
    `Webhooks.EventTypesRequired` (`WebhookSubscription.cs:248-253`); the types are trimmed, de-duplicated
    and ordinal-sorted before joining with `,` (`WebhookSubscription.cs:255-260`), and more than 20 types
    or a joined string over 2048 characters yields `Webhooks.TooManyEventTypes`
    (`WebhookSubscription.cs:262-267`). The normalization makes the stored column canonical, so two
    subscriptions listing the same types store the same string.
  - Reads: `IsEnabled()` is `DisabledOn is null` (`WebhookSubscription.cs:161`); `GetEventTypes()` splits
    the column (`WebhookSubscription.cs:165-166`); `Subscribes(eventType)` matches the type or `"*"`
    ordinally (`WebhookSubscription.cs:171-175`).
  - Secret rotation: `RotateSecret` moves the current secret to `PreviousProtectedSecret`, records its
    expiry and installs the new one (`WebhookSubscription.cs:183-190`); `GetSigningSecrets(utcNow)`
    returns the current secret first, then the previous one while `utcNow` is before its expiry
    (`WebhookSubscription.cs:195-198`), so a receiver can switch without dropping deliveries.
  - State and outcome: `Disable` keeps the first disable instant (`DisabledOn ??= utcNow`,
    `WebhookSubscription.cs:202`), `Enable` clears it (`WebhookSubscription.cs:205`), `RecordDelivered`
    stamps `LastDeliveredOn` (`WebhookSubscription.cs:209`), and `RecordFailed` stamps `LastFailedOn` and
    truncates the reason to 500 characters (`WebhookSubscription.cs:214-219`).
- **Why it's built this way**: the table is opt-in, mapped only where a host calls `AddWebhooks` with
  `Webhooks:Enabled`, so a host that never opts in builds an unchanged model (class doc,
  `WebhookSubscription.cs:10-14`). `TenantId` is a plain column stamped at create rather than
  `ITenantEntity`, and the store filters it explicitly, `null` matching only `null` (class doc,
  `WebhookSubscription.cs:20-23`). `Url` and the comma-joined `EventTypes` stay strings by design; the
  three suppressions say why (`WebhookSubscription.cs:25-36`): the URL is untrusted input validated as
  text and stored verbatim, and `EventTypes` is the mapped column while `GetEventTypes()` is its parsed
  view. See [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: persisted by [`EFWebhookSubscriptionStore`](#efwebhooksubscriptionstore) behind
  [`IWebhookSubscriptionStore`](#iwebhooksubscriptionstore), managed by
  [`WebhookSubscriptionService`](#webhooksubscriptionservice), and read on delivery by
  [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler).

### WebhookSubscriptionModelBuilderExtensions
> MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Webhooks` | `MMCA.Common.Infrastructure/Persistence/Webhooks/WebhookSubscriptionModelBuilderExtensions.cs:12` | Level 5 | class (public static)

- **What it is**: the EF Core mapping for [`WebhookSubscription`](#webhooksubscription), exposed as one
  `ModelBuilder` extension method, `ApplyWebhookSubscriptionConfiguration`
  (`MMCA.Common.Infrastructure/Persistence/Webhooks/WebhookSubscriptionModelBuilderExtensions.cs:28`).
- **Depends on**: [`WebhookSubscription`](#webhooksubscription) for its width constants; externally EF
  Core's `ModelBuilder`.
- **Concept**: the opt-in table mapping. It is applied by
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) only to the one context
  whose source `Webhooks:DataSourceName` names and only while `Webhooks:Enabled` is true, so a host that
  never opts in keeps a byte-identical model (class doc, `WebhookSubscriptionModelBuilderExtensions.cs:6-11`;
  the call, guarded by `_webhookSubscriptionTableEnabled`,
  `MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:548-552`).
  `[Rubric S8, Data Architecture]`: an optional feature adds no table, no migration and no model-cache
  churn to hosts that do not use it.
- **Walkthrough**: the public constants `TableName = "WebhookSubscriptions"` and
  `TenantIndexName = "IX_WebhookSubscriptions_TenantId_IsDeleted"`
  (`WebhookSubscriptionModelBuilderExtensions.cs:15`, `WebhookSubscriptionModelBuilderExtensions.cs:18`).
  The method null-guards (`WebhookSubscriptionModelBuilderExtensions.cs:30`), maps the table under
  `schema`, default `dbo` (`WebhookSubscriptionModelBuilderExtensions.cs:28`,
  `WebhookSubscriptionModelBuilderExtensions.cs:34`), keys on `Id` with `ValueGeneratedNever()` because
  the factory assigns the `Guid` (`WebhookSubscriptionModelBuilderExtensions.cs:35-36`), sets every
  column width from the entity's constants, with `EventTypes` and `TenantId` non-Unicode
  (`WebhookSubscriptionModelBuilderExtensions.cs:38-48`), and adds the composite `(TenantId, IsDeleted)`
  index every tenant-filtered read uses (`WebhookSubscriptionModelBuilderExtensions.cs:50-51`). It
  returns the builder for chaining (`WebhookSubscriptionModelBuilderExtensions.cs:54`).
- **Why it's built this way**: the doc asks for it to run BEFORE the soft-delete, tenant and
  concurrency-token passes, so the subscription is treated like any other auditable entity
  (`WebhookSubscriptionModelBuilderExtensions.cs:20-24`), which is also what gives
  [`EFWebhookSubscriptionStore`](#efwebhooksubscriptionstore) its soft-delete filter and the row version
  its concurrency catch relies on.
- **Where it's used**: `ApplicationDbContext` (`ApplicationDbContext.cs:551`); exercised by
  `WebhookSubscriptionModelGateTests` and the SQL Server `WebhookSubscriptionSqlServerTests`.

### WebhookSubscriptionsControllerBase
> MMCA.Common.API | `MMCA.Common.API.Controllers.Webhooks` | `MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:40` | Level 6 | class (public abstract)

- **What it is**: the abstract base controller for the outbound webhook administration endpoints: list,
  list the publishable event types, create, update, rotate the secret, disable, enable and delete, each
  scoped to the caller's tenant (class doc,
  `MMCA.Common.API/Controllers/Webhooks/WebhookSubscriptionsControllerBase.cs:12-16`). A derived
  controller supplies only the route and API version (`WebhookSubscriptionsControllerBase.cs:19-25`).
- **Depends on**: [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)
  (`WebhookSubscriptionsControllerBase.cs:40`), [`IWebhookSubscriptionService`](#iwebhooksubscriptionservice),
  [`AdministrationPermissions`](group-08-auth.md#administrationpermissions) through `[HasPermission]`
  (`WebhookSubscriptionsControllerBase.cs:39`), [`IdempotentAttribute`](group-12-api-hosting-mapping.md#idempotentattribute)
  and [`NonIdempotentAttribute`](group-12-api-hosting-mapping.md#nonidempotentattribute), and the request
  and response records [`CreateWebhookSubscriptionRequest`](#createwebhooksubscriptionrequest),
  [`UpdateWebhookSubscriptionRequest`](#updatewebhooksubscriptionrequest),
  [`WebhookSubscriptionResponse`](#webhooksubscriptionresponse) and
  [`WebhookSubscriptionSecretResponse`](#webhooksubscriptionsecretresponse).
- **Concept introduced, "off means no routes".** Every action answers 404 unless the host called
  `AddWebhooks` AND set `Webhooks:Enabled` (class doc, `WebhookSubscriptionsControllerBase.cs:27-30`).
  The service is therefore resolved per action from `HttpContext.RequestServices` rather than injected,
  since a host without `AddWebhooks` has none to inject; the private `EnabledWebhooks` property returns
  it only when `IsEnabled` is true (`WebhookSubscriptionsControllerBase.cs:43-44`). `[Rubric S11,
  Security]`: a disabled feature is indistinguishable from an absent one, and the whole controller sits
  behind `ManageWebhooks` (`WebhookSubscriptionsControllerBase.cs:39`).
  `[Rubric S9, API & Contract Design]`: the class doc lists the refusal codes a client must expect,
  400 for the validation codes, 404 `Webhooks.NotFound` (also for another tenant's id) and 409
  `Webhooks.LimitReached` (`WebhookSubscriptionsControllerBase.cs:32-37`).
- **Walkthrough**: every action follows one shape: return `NotFound()` when `EnabledWebhooks` is null,
  call the service, and map a failure through `HandleFailure` or the value through `Ok`.
  - `GetAllAsync` on `GET` (`WebhookSubscriptionsControllerBase.cs:49`,
    `WebhookSubscriptionsControllerBase.cs:54`) lists subscriptions, disabled ones included, never their
    secrets; `GetEventTypes` on `GET event-types` (`WebhookSubscriptionsControllerBase.cs:67`,
    `WebhookSubscriptionsControllerBase.cs:72-73`) is synchronous and returns the service's
    `EventTypes`.
  - `CreateAsync` on `POST` (`WebhookSubscriptionsControllerBase.cs:79`,
    `WebhookSubscriptionsControllerBase.cs:87`) and `RotateSecretAsync` on `POST {id}/rotate-secret`
    (`WebhookSubscriptionsControllerBase.cs:134`, `WebhookSubscriptionsControllerBase.cs:140`) are
    marked `[NonIdempotent]` because the response carries the only copy of the secret
    (`WebhookSubscriptionsControllerBase.cs:80`, `WebhookSubscriptionsControllerBase.cs:135`). After a
    rotation the previous secret keeps signing for `Webhooks:PreviousSecretGraceHours`
    (`WebhookSubscriptionsControllerBase.cs:127-130`).
  - `UpdateAsync` on `PUT {id}` (`WebhookSubscriptionsControllerBase.cs:106`,
    `WebhookSubscriptionsControllerBase.cs:112`) replaces URL, description and event types.
  - `DisableAsync` and `EnableAsync` on `POST {id}/disable` and `POST {id}/enable` are `[Idempotent]`
    (`WebhookSubscriptionsControllerBase.cs:155-161`, `WebhookSubscriptionsControllerBase.cs:176-182`).
  - `DeleteAsync` on `DELETE {id}` (`WebhookSubscriptionsControllerBase.cs:197`,
    `WebhookSubscriptionsControllerBase.cs:202`) soft-deletes and returns `NoContent()`
    (`WebhookSubscriptionsControllerBase.cs:210`); deliveries already queued complete without sending.
  - Every action is `public virtual`, so a derived controller can override one without copying the rest.
- **Why it's built this way**: the base-controller-plus-thin-derived shape lets each host mount the
  endpoints under its own route and version while Common owns the behavior; see
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: exercised by `WebhookSubscriptionsControllerTests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/Webhooks/WebhookSubscriptionsControllerTests.cs`).
- **Caveats / not-in-source**: no derived controller exists in `MMCA.ADC/Source`; whether Store or
  Helpdesk mounts one is not determinable from the sources checked for this section.

### IntegrationEventConsumer<TEvent>
> MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Messaging.Consumers` | `MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:40` | Level 7 | class (public sealed partial)

- **What it is**: a single generic broker consumer that bridges a delivered event to the existing
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
  contract, invoking every handler registered in the per-attempt DI scope and adding
  **consumer-side inbox idempotency** through [`IInboxStore`](#iinboxstore)
  (class doc, `MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumer.cs:8-11`). It
  implements the framework's own
  [`IBrokerMessageConsumer`](group-14-module-system-composition.md#ibrokermessageconsumer)
  (`IntegrationEventConsumer.cs:44`); no external messaging library is involved.
- **Depends on**: [`IInboxStore`](#iinboxstore),
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent),
  [`IIntegrationEvent`](#iintegrationevent), [`EventNameResolver`](#eventnameresolver),
  [`ConsumerOriginRestore`](group-14-module-system-composition.md#consumeroriginrestore); externally
  `ILogger<T>` with source-generated `[LoggerMessage]` methods and an optional `IServiceProvider`. The
  four dependencies arrive through the primary constructor (`IntegrationEventConsumer.cs:40-44`),
  constrained `where TEvent : class, IIntegrationEvent` (`IntegrationEventConsumer.cs:45`). The provider
  is defaulted to `null` (`IntegrationEventConsumer.cs:44`) so a test constructing the consumer with the
  first three arguments still compiles and simply restores nothing (parameter doc,
  `IntegrationEventConsumer.cs:30-38`).
- **Concept introduced, the consumer-side inbox for broker idempotency.**
  `[Rubric S29, Resilience & Business Continuity]` assesses at-least-once delivery paired with
  *idempotent consumers*, and `[Rubric S6, CQRS & Event-Driven]` assesses idempotent
  integration-event handling. Broker delivery is at-least-*once*: the same message can arrive twice
  after a consumer crash or a redelivery. The inbox makes that safe, and the API is a three-phase one
  rather than a check-then-record pair. `inbox.TryBeginAsync(MessageId, eventTypeName, ct)`
  (`IntegrationEventConsumer.cs:93`) returns `false` when the message was already processed, in which
  case the consumer logs at Debug and returns without running handlers, completing the message
  (`IntegrationEventConsumer.cs:95-96`). When it returns `true`, it has also **staged** the inbox row in
  this scope's unit of work, unsaved. The comment (`IntegrationEventConsumer.cs:88-92`) is precise about
  who writes it: the framework's handlers do not save on this scope, because they are singletons that
  open their own scope per delivery
  ([`ScopedIntegrationEventHandlerBase<TIntegrationEvent>`](#scopedintegrationeventhandlerbasetintegrationevent)),
  so the row is written by `CompleteAsync` once every handler has succeeded. A crash between a
  handler's commit and that write redelivers the event, which is why handlers must still be
  idempotent. The interface's default implementations
  (`MMCA.Common.Infrastructure/Persistence/Inbox/IInboxStore.cs:38`,
  `IInboxStore.cs:48`, `IInboxStore.cs:63`) fall back to the older check-then-record behavior, so an
  external implementation of the interface still compiles and still works.
- **Concept introduced, the inbox key is the event's declared name, not its CLR name.** The key is
  computed by `EventNameResolver.GetInboxName(typeof(TEvent))`
  (`IntegrationEventConsumer.cs:82`), which returns the event's
  [`EventNameAttribute`](group-02-domain-building-blocks.md#eventnameattribute) name when it declares
  one and its short type name otherwise
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/EventNameResolver.cs:59-60`). The comment
  (`IntegrationEventConsumer.cs:79-81`) records the compatibility reason: an unannotated event keeps
  matching the rows already written under its short type name.
  `[Rubric S9, API & Contract Design]`: the stable wire identity, not the CLR identity, is what a
  cross-service dedup key has to be built on, because the CLR name can be refactored.
- **Walkthrough**
  - Entry point: `ConsumeAsync(TEvent integrationEvent, IReadOnlyDictionary<string, string> headers,
    CancellationToken)` (`IntegrationEventConsumer.cs:61-64`) null-guards both the event and the headers
    (`IntegrationEventConsumer.cs:66-67`). The explicit
    `IBrokerMessageConsumer.ConsumeAsync(IIntegrationEvent, ...)` implementation casts to `TEvent` and
    forwards (`IntegrationEventConsumer.cs:138-142`), which is how the non-generic receive pipeline
    calls a generic consumer.
  - Context restore (`IntegrationEventConsumer.cs:69-77`): when `serviceProvider` is not null,
    `ConsumerOriginRestore.Apply(headers, serviceProvider, PrincipalAuthenticationType)`
    (`IntegrationEventConsumer.cs:75-77`) runs **before** the inbox is touched, held in a
    `using var origin` so the handle stays open for the whole consume and a handler that opens its own
    scope from the root factory still runs as the publisher's origin
    (comment, `IntegrationEventConsumer.cs:73-74`), because the inbox store
    resolves its context through the scoped factory, and under database-per-tenant that routing is
    decided by the tenant this restores ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).
    A message published with no origin headers restores nothing, and the scope keeps the defaults it
    already had (comment, `IntegrationEventConsumer.cs:69-72`). The stamped
    `PrincipalAuthenticationType = "IntegrationEvent"` (`IntegrationEventConsumer.cs:51`) is what makes
    the rebuilt identity `IsAuthenticated` and names the hop it came back from.
  - Idempotency short-circuit (`IntegrationEventConsumer.cs:93-97`): a duplicate leads to
    `LogDuplicateSkipped` and a normal return, which completes the message rather than dead-lettering it.
  - Handler loop (`IntegrationEventConsumer.cs:101-122`): counts and invokes each resolved
    `IIntegrationEventHandler<TEvent>` in turn (`IntegrationEventConsumer.cs:106`). On any
    non-`OperationCanceledException` (`IntegrationEventConsumer.cs:108`) it first calls
    `inbox.Abandon(MessageId)` (`IntegrationEventConsumer.cs:113`) so the failed attempt leaves neither
    a rejected insert on the scope's context nor an inbox row that would make the retry look like a
    duplicate (comment, `IntegrationEventConsumer.cs:110-112`), then logs `LogHandlerFailure` naming the
    failing handler's full type name (`IntegrationEventConsumer.cs:119`) and **rethrows**
    (`IntegrationEventConsumer.cs:120`) so the receive pipeline retries in a fresh scope with
    exponential backoff (`MessageBusSettings.RetryLimit`, default 5,
    `MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:94`), then redelivers or dead-letters
    (comment, `IntegrationEventConsumer.cs:115-118`).
  - No-handler case (`IntegrationEventConsumer.cs:124-130`): if zero handlers were registered for the
    event in this process, `LogNoHandlers` fires at Information and the method returns normally, so the
    message completes with no retry storm while the misconfigured service host stays visible in
    telemetry.
  - Mark-processed (`IntegrationEventConsumer.cs:134`): `inbox.CompleteAsync` persists the staged row
    (for the framework's scope-per-delivery handlers this is the write; a handler that saved on this
    scope would already have committed it). Either way the message is recorded only on a
    successful consume, because the failure path above rethrows (comment,
    `IntegrationEventConsumer.cs:132-133`).
  - Three `[LoggerMessage]` partials (`IntegrationEventConsumer.cs:144-151`) are the source-generated,
    allocation-free log methods, `[Rubric S13, Observability & Operability]`.
- **Why it's built this way**: application code keeps writing plain
  [`IIntegrationEventHandler<in TIntegrationEvent>`](#iintegrationeventhandlerin-tintegrationevent)
  implementations, which the module scan already auto-discovers; there is **no broker-specific consumer
  class to write per event type** (class doc, `IntegrationEventConsumer.cs:12-17`). The receive pipeline
  deserializes the message, opens a fresh scope per attempt, resolves this consumer from it and calls
  `ConsumeAsync`, and a throw from here drives its retry, redelivery and dead-letter decisions (class
  doc, `IntegrationEventConsumer.cs:18-25`). That keeps the transport out of the handlers and out of the
  Application layer
  ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html) for the inbox
  guarantee, [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) for the
  outbox half, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) for the
  extraction boundary).
- **Where it's used**: chosen per subscription by
  [`BrokerConsumerBuilder`](group-14-module-system-composition.md#brokerconsumerbuilder) for a current
  contract registered through `RegisterIntegrationEventConsumer<TEvent>()`
  (`MMCA.Common.Infrastructure/Messaging/Consumers/BrokerConsumerBuilder.cs:20`; closed type at
  `BrokerConsumerBuilder.cs:43-45`), registered scoped once per subscription by `AddBrokerMessaging`
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:103-106`), and resolved per attempt by
  [`BrokerReceivePipeline`](group-14-module-system-composition.md#brokerreceivepipeline). A retired
  contract gets
  [`UpcastingIntegrationEventConsumer<TEvent>`](group-14-module-system-composition.md#upcastingintegrationeventconsumertevent)
  instead.
- **Caveats / not-in-source**: whether the inbox actually dedups depends on which
  [`IInboxStore`](#iinboxstore) is registered. `AddBrokerMessaging` registers
  [`EfInboxStore`](#efinboxstore) when `MessageBusSettings.IsInboxEnabled` resolves true, which it
  does by default for a broker transport
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:132-134`,
  `MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:142`); an explicit
  `MessageBus:EnableInbox=false` opts down to [`NoOpInboxStore`](#noopinboxstore), where the inbox
  calls do nothing and every redelivery re-runs the handlers, a posture announced once at startup by
  [`InboxDisabledWarningService`](#inboxdisabledwarningservice).

`[Rubric S10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### BrokerMessageBus
> MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Messaging` | `MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:46` | Level 9 | class (public sealed)

- **What it is**: the [`IMessageBus`](#imessagebus) implementation that publishes integration events
  to the broker `MessageBus:Provider` selects (RabbitMQ and PostgreSQL built in; an adapter such as
  MMCA.Common.Azure or MMCA.Common.Aws registers its own transport) through the transport's
  [`IBrokerPublisher`](group-14-module-system-composition.md#ibrokerpublisher). Extracted microservices
  use it in place of [`InProcessMessageBus`](#inprocessmessagebus)
  (`MMCA.Common.Infrastructure/Messaging/BrokerMessageBus.cs:14-18`).
- **Depends on**: [`IMessageBus`](#imessagebus) (Level 2), [`IIntegrationEvent`](#iintegrationevent)
  (Level 1), [`IBrokerPublisher`](group-14-module-system-composition.md#ibrokerpublisher) and
  [`BrokerTopology`](group-14-module-system-composition.md#brokertopology), taken through the primary
  constructor along with three optional context accessors, `ICurrentUserService?`, `ITenantContext?`
  and `ICorrelationContext?`, each defaulted to `null` (`BrokerMessageBus.cs:46-51`). It also uses
  [`BrokerHeaders`](group-14-module-system-composition.md#brokerheaders),
  [`BrokerWire`](group-14-module-system-composition.md#brokerwire),
  [`OutgoingBrokerMessage`](group-14-module-system-composition.md#outgoingbrokermessage) and
  [`MessageHeaders`](group-08-auth.md#messageheaders); externally `System.Text.Json` and
  `System.Diagnostics.Activity`.
- **Concept introduced, the transport kept at the edge.**
  `[Rubric S7, Microservices Readiness]` assesses whether a module can be lifted out of the monolith
  without rewriting application code, and `[Rubric S6, CQRS & Event-Driven]` assesses at-least-once
  delivery of integration events. The [`IMessageBus`](#imessagebus) interface is defined up in
  `MMCA.Common.Application`, and **`Application`, `Domain`, and `Shared` must never reference a
  messaging library directly**, which the transport-boundary fitness rule enforces
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:7`).
  `BrokerMessageBus` lives in Infrastructure and talks only to the framework's own `IBrokerPublisher`,
  so the wire format, topic naming and header set are owned by Common and each transport adapter only
  moves bytes.
- **Concept introduced, everything a consumer needs travels as headers.** The doc comment
  (`BrokerMessageBus.cs:27-35`) lists them: the [`BrokerHeaders`](group-14-module-system-composition.md#brokerheaders)
  transport headers (event name, message id, content type), the W3C `traceparent`/`tracestate` of a
  Producer span on the `MMCA.Common.Messaging` source, and the request context as
  [`MessageHeaders`](group-08-auth.md#messageheaders) origin headers (who raised the event, their roles,
  the tenant, the correlation id), read back on the other side by
  [`IntegrationEventConsumer<TEvent>`](#integrationeventconsumertevent). The outbox processor restores
  each row's captured context onto this bus's scope before it publishes, so the headers describe the
  original request rather than the background poll. `[Rubric S29, Resilience & Business Continuity]`:
  this is what lets a request's identity, tenant and roles survive the hop between processes.
- **Walkthrough**
  - `PublishAsync(IIntegrationEvent, CancellationToken)` (`BrokerMessageBus.cs:54`): null-guards
    (`BrokerMessageBus.cs:56`), then derives everything from the **runtime type**, not
    `IIntegrationEvent`, because the topic, the wire name and the body all describe the concrete class
    consumers subscribe to (comment, `BrokerMessageBus.cs:58-59`): `eventType`, the wire name from
    `BrokerNaming.EventName`, the topic from `topology.TopicFor`, and the `MessageId`
    (`BrokerMessageBus.cs:60-63`).
  - It calls `CaptureHeaders()` (`BrokerMessageBus.cs:65`) and adds the event-name, message-id (`"D"`
    format, invariant culture) and JSON content-type headers (`BrokerMessageBus.cs:66-68`).
  - It starts a Producer activity named `"{topic} publish"` on `BrokerWire.ActivitySource` and, when a
    listener created one, tags it with the messaging system, operation `send`, destination and message
    id (`BrokerMessageBus.cs:70-77`). `InjectTraceContext(activity ?? Activity.Current, headers)`
    (`BrokerMessageBus.cs:81`) falls back to the ambient activity (the outbox row's), so a publish with
    no listener still carries the trace (comment, `BrokerMessageBus.cs:79-80`),
    `[Rubric S13, Observability & Operability]`.
  - It serializes the event as its runtime type with `BrokerWire.JsonOptions`
    (`BrokerMessageBus.cs:83`) and hands an `OutgoingBrokerMessage(topic, eventName, messageId, body,
    headers)` to `publisher.PublishAsync` (`BrokerMessageBus.cs:85-87`).
  - `PublishAsync(IEnumerable<IIntegrationEvent>, CancellationToken)` (`BrokerMessageBus.cs:91`):
    null-guards (`BrokerMessageBus.cs:93`), then awaits each single publish in turn
    (`BrokerMessageBus.cs:95-98`). There is no transactional grouping across the batch here; batch
    atomicity is the outbox's concern, not the publisher's.
  - `InjectTraceContext` (`BrokerMessageBus.cs:106-118`) writes `traceparent` only for a W3C id, and
    `tracestate` only when non-empty: a hierarchical id has no `traceparent` form (doc,
    `BrokerMessageBus.cs:101-105`).
  - `CaptureHeaders()` (`BrokerMessageBus.cs:126-145`) builds an ordinal-keyed dictionary
    (`BrokerMessageBus.cs:128`) holding only the values actually present, each routed through
    `AddIfPresent` (`BrokerMessageBus.cs:148-154`): `MessageHeaders.TenantId`
    (`BrokerMessageBus.cs:130`), `MessageHeaders.UserId` formatted with the invariant culture
    (`BrokerMessageBus.cs:131-134`), then, when a current-user service is present,
    `MessageHeaders.UserRoles` from `Context.AmbientOrigin.FlattenRoles` and
    `MessageHeaders.UserPermissions` from `Context.AmbientOrigin.FlattenPermissions`
    (`BrokerMessageBus.cs:138-139`), and finally `MessageHeaders.CorrelationId`
    (`BrokerMessageBus.cs:142`). The doc (`BrokerMessageBus.cs:120-125`) explains why absence is not
    written as an empty header: an absent header reads as "the publisher had nothing to say", and an
    empty one would turn a non-answer into a false answer.
- **Why it's built this way**: this bus does **not** itself write to the outbox. Transactional-outbox
  semantics are preserved by the [`OutboxProcessor`](#outboxprocessor): events are persisted to
  [`OutboxMessage`](#outboxmessage) in the *same* database transaction as the aggregate change, then
  the processor drains them by calling this bus
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html); doc comment,
  `BrokerMessageBus.cs:19-25`). Keeping `BrokerMessageBus` a thin publish adapter, with no outbox
  knowledge, is what lets one set of outbox machinery serve both monolith and broker modes
  ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
  [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). The context
  accessors default to `null`, so a host or test that constructs this bus without them publishes no
  identity headers (parameter doc, `BrokerMessageBus.cs:40-43`).
- **Where it's used**: swapped in for the default in-process registration by `AddBrokerMessaging`
  through `services.Replace` (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:119`), which
  returns early without touching the container when `MessageBus:Provider` is in-process
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:72-75`; see
  [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)). It is driven at
  runtime by the [`OutboxProcessor`](#outboxprocessor), which resolves `IMessageBus` per cycle
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:212`) and calls it
  inside a resilience pipeline that wraps only the broker hop (`OutboxProcessor.cs:590-600`).

`[Rubric S10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### BrokerEventBus
> MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Messaging` | `MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:31` | Level 10 | class (public sealed)

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
  `[Rubric S6, CQRS & Event-Driven]`, `[Rubric S8, Data Architecture]` (the transactional outbox), and
  `[Rubric S29, Resilience & Business Continuity]`. The doc comment
  (`BrokerEventBus.cs:18-29`) is explicit that this class differs from
  [`InProcessEventBus`](#inprocesseventbus) only in whether it dispatches synchronously after
  persistence: in-process mode writes the outbox, dispatches, then marks processed
  (`BrokerEventBus.cs:23`), while broker mode writes the outbox, signals the processor, and returns
  (`BrokerEventBus.cs:24`). In broker mode an in-process dispatch would be *incorrect*, since no
  consumer is present locally, so the processor's broker-publish path is the only correct delivery
  channel (`BrokerEventBus.cs:26-28`).
- **Walkthrough**: both public overloads funnel into the private `PublishBatchAsync`, and neither is
  `async`: each returns the batch task directly. The single-event
  overload (`BrokerEventBus.cs:38`) null-guards and returns `PublishBatchAsync` over a one-element array
  (`BrokerEventBus.cs:42`); the batch overload (`BrokerEventBus.cs:46`) null-guards, coerces the
  sequence to an array exactly once (`BrokerEventBus.cs:50`), and returns `Task.CompletedTask` early
  when it is empty (`BrokerEventBus.cs:51-52`). `PublishBatchAsync` (`BrokerEventBus.cs:65-94`) resolves the outbox's
  logical data source through
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver)
  (`BrokerEventBus.cs:67`) and gets its context (`BrokerEventBus.cs:68`). The outbox gate is the
  context's engine capability, `!context.Engine.Capabilities.IsRelational` (`BrokerEventBus.cs:70`):
  when the resolved engine is not relational (Cosmos for example) it throws an `InvalidOperationException` naming the
  misconfigured `Outbox:DataSource` and `Outbox:DatabaseName`, and tells the operator to configure SQL
  Server, PostgreSQL or SQLite (or fall back to `InProcessEventBus`), rather than silently dropping the events
  (`BrokerEventBus.cs:75-76`, with the rationale at `BrokerEventBus.cs:72-74`). Otherwise it reads the
  scope's ambient [`OutboxOrigin`](#outboxorigin) **once** for the whole batch,
  `context.CurrentOutboxOrigin` (`BrokerEventBus.cs:79-81`), because the batch is one caller's work so
  one origin describes all of it, then builds one [`OutboxMessage`](#outboxmessage) per event through
  `FromDomainEvent(integrationEvent, origin)` (`BrokerEventBus.cs:83-85`), `AddRange`s them
  (`BrokerEventBus.cs:88`; EF's synchronous `AddRange` is intentional here, as the comment at
  `BrokerEventBus.cs:87` notes, since `AddRangeAsync` exists only for special value generators), saves
  **once** (`BrokerEventBus.cs:89`), and calls `outboxSignal.Signal()` (`BrokerEventBus.cs:93`) to wake
  the processor immediately instead of waiting for the next poll.
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
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:80`,
  `DependencyInjection.Messaging.cs:248-254`).
- **Where it's used**: registered as the scoped `IEventBus` when `AddBrokerMessaging` runs, replacing
  [`InProcessEventBus`](#inprocesseventbus)
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:125`, with the explanatory comment at
  `DependencyInjection.Messaging.cs:121-124`). Every `IEventBus` injection in application code resolves this
  implementation in broker mode.

`[Rubric S10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.

### EFWebhookSubscriptionStore
> MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Webhooks` | `MMCA.Common.Infrastructure/Persistence/Webhooks/EFWebhookSubscriptionStore.cs:30` | Level 10 | class (internal sealed)

- **What it is**: the EF Core [`IWebhookSubscriptionStore`](#iwebhooksubscriptionstore) over the
  database `Webhooks:DataSourceName` names
  (`MMCA.Common.Infrastructure/Persistence/Webhooks/EFWebhookSubscriptionStore.cs:13-14`).
- **Depends on**: [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  `IOptions<`[`WebhookSettings`](#webhooksettings)`>` and
  [`IConcurrencyConflictDetector`](group-07-persistence-ef-core.md#iconcurrencyconflictdetector), all
  through the primary constructor (`EFWebhookSubscriptionStore.cs:30-35`); it reads and writes
  [`WebhookSubscription`](#webhooksubscription) through
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) and
  [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey).
- **Concept, explicit tenant filtering on a plain column.** `[Rubric S11, Security]` and
  `[Rubric S8, Data Architecture]`: the subscription is deliberately not an `ITenantEntity`, so this
  store filters `TenantId == tenantId` on every read, a `null` tenant matching only untenanted rows,
  while the soft-delete filter hides deleted rows (class doc, `EFWebhookSubscriptionStore.cs:19-23`).
  Writes go through the unit of work so the audit interceptor stamps who created or changed a
  subscription.
- **Walkthrough**
  - `Context` resolves the context for `ResolveDataSourceKey()` on each access, and `Subscriptions` is
    its `DbSet<WebhookSubscription>` (`EFWebhookSubscriptionStore.cs:37`, `EFWebhookSubscriptionStore.cs:39`).
  - `ListAsync` and `ListEnabledAsync` are `AsNoTracking`, tenant-filtered and ordered by `CreatedOn`
    then `Id`; the enabled variant adds `DisabledOn == null`
    (`EFWebhookSubscriptionStore.cs:42-49`, `EFWebhookSubscriptionStore.cs:52-59`).
  - `FindAsync(id, tenantId)` is tracked, matching on both id and tenant so another tenant's id is
    simply not found (`EFWebhookSubscriptionStore.cs:62-63`); `CountAsync` counts the tenant's rows
    (`EFWebhookSubscriptionStore.cs:66-67`).
  - `AddAsync` adds and saves through the factory (`EFWebhookSubscriptionStore.cs:70-76`); `SaveAsync`
    only saves, because the row came from the tracked `FindAsync` (comment,
    `EFWebhookSubscriptionStore.cs:83-84`).
  - `RecordOutcomeAsync` saves and swallows a concurrency conflict recognized by
    `IConcurrencyConflictDetector` (`EFWebhookSubscriptionStore.cs:89-103`): the delivery already
    happened, so a lost last-outcome stamp is dropped rather than failing the row into a retry (comment,
    `EFWebhookSubscriptionStore.cs:99-101`).
  - `ResolveDataSourceKey()` takes the registry's key for `WebhookSubscription` when one exists, and
    otherwise the configured source name verbatim on the engine of the framework-default source
    (`EFWebhookSubscriptionStore.cs:107-112`), the `EFMachineClientStore` precedent (comment,
    `EFWebhookSubscriptionStore.cs:105-106`).
- **Why it's built this way**: the store is `internal` so hosts depend on the
  [`IWebhookSubscriptionStore`](#iwebhooksubscriptionstore) abstraction, and the data-source resolution
  follows an existing store rather than inventing a second rule. See
  [ADR-142](https://ivanball.github.io/docs/adr/142-outbound-webhooks-and-delivery-lane.html).
- **Where it's used**: registered as the scoped `IWebhookSubscriptionStore` by `AddWebhooks`
  (`MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:76`), consumed by
  [`WebhookSubscriptionService`](#webhooksubscriptionservice) and
  [`DeliverWebhookInternalCommandHandler`](#deliverwebhookinternalcommandhandler).

### InProcessEventBus
> MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Messaging` | `MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:34` | Level 10 | class (public sealed)

- **What it is**: the **default** [`IEventBus`](#ieventbus) implementation. When the outbox is on it
  persists integration events to the outbox, dispatches them in-process through
  [`IDomainEventDispatcher`](#idomaineventdispatcher), and marks the rows processed; when the outbox
  is off it dispatches only (`MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:12-17`).
- **Depends on**: [`IEventBus`](#ieventbus) (Level 2),
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`IDomainEventDispatcher`](#idomaineventdispatcher),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  `IOptions<`[`OutboxSettings`](group-04-events-outbox.md#outboxsettings)`>`, a required
  `TimeProvider` resolved from whatever `AddServices` registers it as, and an optional
  `IOptions<`[`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings)`>`, all
  through the primary constructor (`InProcessEventBus.cs:34-40`); it also uses
  [`OutboxMessage`](#outboxmessage) and [`OutboxFinalizer`](#outboxfinalizer).
- **Concept, the monolith half of dual-mode event publishing, and an explicit outbox opt-out.**
  `[Rubric S6, CQRS & Event-Driven]` and `[Rubric S8, Data Architecture]`: the "persist to outbox in
  the same save, then dispatch, then mark processed" sequence is exactly the dual dispatch of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html), and a dispatch failure
  leaves every entry in the batch **unprocessed** so the [`OutboxProcessor`](#outboxprocessor) retries
  it (method doc, `InProcessEventBus.cs:66-70`). The second half of that doc
  (`InProcessEventBus.cs:71-76`) is the part to read carefully: with the outbox turned off
  (`MessageBus:EnableOutbox` resolving to false: set to false, or left unset, which is the in-process
  default) the direct-dispatch branch is taken instead, which means no rows,
  no save, and no processor to retry. That is the **in-process default**:
  `MessageBusSettings.IsOutboxEnabled` resolves an unset `EnableOutbox` from the provider, ON for a
  broker and OFF for `InProcess`
  (`MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:180`,
  `MessageBusSettings.cs:151`), on the reasoning that a single-process application dispatches every
  event in the same process anyway. A monolith that wants at-least-once delivery across a crash sets
  `MessageBus:EnableOutbox=true` explicitly (`MessageBusSettings.cs:160`).
  `[Rubric S31, Cost/FinOps]` is the quiet counterpart here: store-and-forward that nothing needs
  still costs a table, a save, and a poller.
- **Walkthrough**
  - Two readonly fields resolve the constructor's clock and posture: `_timeProvider` is assigned
    `timeProvider` directly with no fallback (`InProcessEventBus.cs:42`), so the caller (`AddServices`,
    or a test constructing this type directly) must supply one; `_outboxEnabled` falls back to `true`
    when no `MessageBusSettings` options are registered (`InProcessEventBus.cs:44`). The outbox default
    is documented as a compatibility choice (`InProcessEventBus.cs:31-33`): a host that resolves no
    `MessageBusSettings` options keeps the outbox path, so the opt-out is only ever taken because
    configuration asked for it.
  - Both public overloads funnel into the private `PublishBatchAsync` (`InProcessEventBus.cs:78`) and
    are non-`async`, returning its task directly: the single overload wraps one event
    (`InProcessEventBus.cs:51`), and the batch overload coerces the sequence to an array once and
    returns `Task.CompletedTask` early when empty (`InProcessEventBus.cs:59-61`).
  - `PublishBatchAsync` resolves the outbox target (`InProcessEventBus.cs:80`) and its context
    (`InProcessEventBus.cs:81`). If the resolved engine is not relational or the outbox is
    off, `!context.Engine.Capabilities.IsRelational || !_outboxEnabled` (`InProcessEventBus.cs:83`), it
    dispatches directly with **no** outbox persistence and returns
    (`InProcessEventBus.cs:85-86`).
  - Otherwise it reads the scope's ambient [`OutboxOrigin`](#outboxorigin) **once** for the whole
    batch, `context.CurrentOutboxOrigin` (`InProcessEventBus.cs:89-91`), because the batch is one
    caller's work so one origin describes all of it, then builds one
    [`OutboxMessage`](#outboxmessage) per event through `FromDomainEvent(integrationEvent, origin)`
    (`InProcessEventBus.cs:93-95`), `AddRange`s them (`InProcessEventBus.cs:98`, synchronously by
    intent, as the comment at `InProcessEventBus.cs:97` notes), saves data plus outbox in one call
    (`InProcessEventBus.cs:99`), dispatches in-process (`InProcessEventBus.cs:101`), and marks the batch
    processed with a single set-based update through
    [`OutboxFinalizer.MarkProcessedAsync`](#outboxfinalizer) (`InProcessEventBus.cs:103`), passing the
    injected `TimeProvider` so the `ProcessedOn` stamp is testable.
- **Why it's built this way**: writing the outbox row and the aggregate change in one
  `SaveChangesAsync` closes the dual-write gap, and dispatching immediately afterward gives synchronous
  in-process reactions without giving up the durable retry path. Finishing through
  [`OutboxFinalizer`](#outboxfinalizer) rather than a second full save keeps the hottest write path
  down to one extra statement, `[Rubric S12, Performance & Scalability]`. The non-relational
  (`Engine.Capabilities.IsRelational`) fast path keeps the framework usable on a store without an
  outbox table (dispatch-only) rather than
  failing, which is the deliberate opposite of the choice
  [`BrokerEventBus`](#brokereventbus) makes: with no local consumers, a silent dispatch-only fallback
  in broker mode would drop the event entirely, so that class throws instead.
- **Where it's used**: the default scoped `IEventBus` registration
  (`MMCA.Common.Infrastructure/DependencyInjection.cs:360`), superseded by
  [`BrokerEventBus`](#brokereventbus) once `AddBrokerMessaging` is called
  (`MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:125`).

`[Rubric S10, Messaging & Integration Architecture]` applies: this type sits on the path a message takes once it leaves the process (outbox, bus, consumer, or broker plumbing), which is what section 10 scores.


---
[⬅ Querying: Specifications, Filtering & the Entity Query Service](group-03-querying-specifications.md)  •  [Index](00-index.md)  •  [CQRS: Commands, Queries & the Decorator Pipeline ➡](group-05-cqrs-pipeline.md)
