# ADR-126: Event Sourcing Is Not Adopted

## Status
Accepted (2026-09-22) **as a documented rejection**. Nothing ships with this record: no event store,
no stream table, no projection host, no new package. What ships is the reason event sourcing was
weighed and dropped, the alternative weighed with it, and the one condition that would make it right
to revisit. The current-state persistence model recorded in [ADR-003](003-outbox-dual-dispatch.md),
[ADR-005](005-soft-delete-vs-erasure.md) and [ADR-075](075-audit-trail.md) remains the accepted
mechanism.

## Context
Event sourcing keeps an append-only log of the facts that happened to an aggregate and treats that log
as the system of record. Current state becomes a fold over the log, a "state as of" question is that
fold truncated at a point in time, and every read model becomes a projection. It is the alternative
most often proposed against the persistence model these repositories use, because from the outside the
codebase looks halfway there already: aggregates raise domain events, those events are persisted, and
a background processor replays them to consumers. The resemblance is superficial, and saying exactly
why is most of this record.

An aggregate here is a **current-state row**. `AuditableBaseEntity<TIdentifierType>` is the base every
aggregate root and child entity derives from, and it carries the state, the audit fields and the
concurrency token on the row itself
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13`, `IsDeleted` at `:20`,
`CreatedOn` at `:25`). Deletion is a flag rather than a fact appended to a log: `Delete()` sets
`IsDeleted = true` at `:77`, and a global query filter hides the row from every normal read
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:413`).
The audit fields are stamped by the save itself, from the identity the caller passed in
(`.../DbContexts/ApplicationDbContext.cs:189`). ADC's `LivePoll` is representative, an aggregate root
holding its own current status
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:18`).

The events those aggregates raise are **notifications, not the record**. `IDomainEvent` is documented
as something meaningful that happened inside the aggregate boundary, dispatched after successful
persistence (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IDomainEvent.cs:7`), and the
dispatcher's only decision is whether an event is also an integration event cross-module handlers
should see
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/DomainEventDispatcher.cs:60`). What those
events get is delivery durability, not history. An `OutboxMessage` row carries the serialized payload
and the stored event identity
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:15`, the
identity at `:38`), the table is mapped on every relational source
(`.../DbContexts/ApplicationDbContext.cs:664`, and per service database in ADC at
`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/Migrations/SQLServerDbContextModelSnapshot.cs:1589`),
the processor drains it
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:56`),
and the consume edge de-duplicates it
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:38`). A
processed outbox row is a delivered message; nothing reads it back and no code path rebuilds state
from one.

## Decision
Do not adopt event sourcing. Aggregates stay current-state EF rows that raise domain events for
notification, carry audit fields, and soft-delete. No repository gains an event store, a per-aggregate
stream, a projection layer or a rehydration path. The rejection is recorded rather than left implicit
because the absence is otherwise unreadable: a reader who sees domain events, a persisted event
payload and a replaying background processor has every ingredient of event sourcing in view, and no
statement anywhere that the combination was declined.

## Rationale
- **No workload asks the question event sourcing answers.** Neither ADC nor MMCA.Store has an
  aggregate that needs replayable per-aggregate history or a "state as of" query. Engagement data is a
  live tally read as it stands, and Store's order flow answers questions about the order as it is now
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsHandler.cs:23`).
- **The per-aggregate log would duplicate the outbox.** The facts an aggregate would append to its
  stream are the domain events it already serializes into `OutboxMessages`, and the outbox does not go
  away, because it exists for at-least-once delivery rather than for history. The result is two durable
  copies of the same fact with two retention policies and two ways to disagree.
- **It is a second persistence model, not a swap.** An event-sourced aggregate needs an append path, a
  rehydration path, a snapshot policy and a projection layer for every read an EF query answers today.
- **The history actually asked for is already answered, more cheaply.** "Who changed this and when" is
  the audit fields plus [ADR-075](075-audit-trail.md)'s field-level change history, committed in the
  same transaction as the change; "where did this row go" is soft delete. And
  [ADR-005](005-soft-delete-vs-erasure.md) commits to anonymizing personal data on request, which an
  immutable system of record turns into a rewrite rather than an update.

## Trade-offs
- **A late adoption costs more than an early one.** The module that eventually needs a stream converts
  an aggregate that already has production data, deployed migrations and reads written as EF queries.
- **Some history is genuinely unrecoverable.** Intermediate states between two saves are gone, and the
  outbox is a delivery buffer with a retention window rather than a partial event log to read later.
- **The rejection relies on the trigger being noticed.** No gate fires when an aggregate quietly grows
  a status-history table, which is the shape a real requirement for history takes on its first day.

## Alternatives rejected
- **Marten on PostgreSQL, weighed 2026-09-22 and rejected.** Marten is the credible .NET event store
  and the specific option this record weighed. It was dropped on two grounds rather than on taste. It
  requires PostgreSQL, which no production source here runs, so adopting it means adding an engine
  beside the existing relational and Cosmos sources ([ADR-018](018-polyglot-persistence.md),
  [ADR-006](006-database-per-service.md)). And its own outbox and projection machinery would sit beside
  [ADR-003](003-outbox-dual-dispatch.md)'s outbox and [ADR-021](021-consumer-inbox-idempotency.md)'s
  inbox rather than replace them, leaving two delivery mechanisms with two dead-letter destinations.
- **A hand-written append-only event table over the existing SQL Server sources.** Cheaper to start and
  worse to finish: it is the outbox schema again with a different retention rule, and projection
  rebuilds, stream versioning and snapshots would be written here rather than consumed.
- **Event sourcing for one aggregate now, to build the muscle.** The aggregate would be chosen for
  convenience rather than need, and a projection layer kept alive by the intent to use it later rots.

## When to revisit
Revisit when **an aggregate acquires a business requirement for full replayable history or temporal
queries**: a financial ledger whose every movement must be reconstructible, or a regulatory transition
log that the audit fields of [ADR-075](075-audit-trail.md) cannot satisfy because the obligation is the
sequence itself rather than the last writer. A wish for more reporting history is not the trigger, and
neither is a desire to audit changes, which is already answered.

When the trigger is met, **adopt event sourcing for that one module only, never system-wide**. Each
module already owns its own database and outbox ([ADR-006](006-database-per-service.md)), so an
event-sourced module is contained behind the same module contract rather than a persistence migration
for the workspace. Every other module keeps the current-state row.

## Related
[ADR-003](003-outbox-dual-dispatch.md) (at-least-once delivery of domain events, the mechanism a
per-aggregate event log would duplicate rather than replace),
[ADR-021](021-consumer-inbox-idempotency.md) (the consume-edge inbox that makes redelivery safe),
[ADR-054](054-saga-compensation-and-reconciliation.md) (choreographed compensation, why cross-boundary
consistency needs no shared stream), [ADR-086](086-process-manager-deferred.md) (the companion record:
a coordinator's state, likewise recorded rather than built),
[ADR-005](005-soft-delete-vs-erasure.md) (soft delete, and the erasure obligation an immutable log
would conflict with), [ADR-075](075-audit-trail.md) (same-transaction field-level change history),
[ADR-006](006-database-per-service.md) (why a future adoption can be scoped to one module),
[ADR-018](018-polyglot-persistence.md) (the engines actually deployed, and the cost of adding one).
