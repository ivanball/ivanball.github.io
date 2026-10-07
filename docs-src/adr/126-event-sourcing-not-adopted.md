# ADR-126: Event Sourcing Is Not Adopted

## Status
Accepted (2026-09-22) **as a documented rejection**. Nothing ships with this record: no event store,
no stream table, no projection host, no new package. What ships is the reason event sourcing was
weighed and dropped, the alternative weighed with it, and the one condition that would make it right
to revisit. The current-state persistence model recorded in [ADR-003](003-outbox-dual-dispatch.md),
[ADR-005](005-soft-delete-vs-erasure.md) and [ADR-075](075-audit-trail.md) remains the accepted
mechanism. Revised 2026-10-01: citations re-anchored. Revised 2026-10-06: the ADR-075 history claim
is scoped to opted-in entities, with retention purging only where the host runs the scheduler. Revised 2026-10-07: the rationale acknowledges ADC's append-only points ledger and why it
is not event sourcing, and the Marten rejection separates framework PostgreSQL support (ADR-113)
from production, where no deployment runs a PostgreSQL server.

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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:454`, the filter applied at `:466`).
The audit fields are stamped during the save, from the identity the caller passed in: the save records
it (`.../DbContexts/ApplicationDbContext.cs:194`, set at `:197`) and the audit interceptor reads it back
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:66`). ADC's `LivePoll` is representative, an aggregate root
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
identity at `:40`), the table is mapped on every relational source
(`.../DbContexts/ApplicationDbContext.cs:668`, and per service database in ADC at
`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/Migrations/SQLServerDbContextModelSnapshot.cs:1590`),
the processor drains it
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:56`),
and the consume edge de-duplicates it
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:41`). A
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
  The nearest shape is Engagement's points ledger: `PointsEntry` is append-only, with no mutators, so
  a total is the sum of its entries
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/Points/PointsEntry.cs:12`), the one
  write that does move a total being the soft delete or erasure of an entry (`:26-27`). That is not
  event sourcing: each entry is its own current-state aggregate row, not an event replayed to rebuild
  some other aggregate, and the total is a query over the rows the soft-delete filter leaves visible
  rather than a fold into a rehydrated state. Nor does it meet the revisit trigger below: it is marked
  `IAuditedEntity` (`:31`) because it decides a prize-bearing leaderboard, so that the append-only
  rule can be proven rather than asserted (`:24-25`), and the [ADR-075](075-audit-trail.md) trail
  answers that need without a replayable stream.
- **The per-aggregate log would duplicate the outbox.** The facts an aggregate would append to its
  stream are the domain events it already serializes into `OutboxMessages`, and the outbox does not go
  away, because it exists for at-least-once delivery rather than for history. The result is two durable
  copies of the same fact with two retention policies and two ways to disagree.
- **It is a second persistence model, not a swap.** An event-sourced aggregate needs an append path, a
  rehydration path, a snapshot policy and a projection layer for every read an EF query answers today.
- **The history actually asked for is already answered, more cheaply.** "Who changed this and when" is
  the audit fields plus [ADR-075](075-audit-trail.md)'s field-level change history, committed in the
  same transaction as the change for entities marked `IAuditedEntity` and purged after the configured
  retention window only where the host also runs the scheduler; "where did this row go" is soft
  delete. And
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
  requires PostgreSQL. The framework already supports PostgreSQL as an engine
  ([ADR-113](113-postgresql-as-a-first-class-engine.md),
  `MMCA.Common/Directory.Packages.props:63`), and the provider ships in every consumer as a direct
  dependency of `MMCA.Common.Infrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/MMCA.Common.Infrastructure.csproj:47`), but no
  production deployment runs a PostgreSQL server and no production entity routes to a
  non-SQL-Server engine ([ADR-018](018-polyglot-persistence.md)). So Marten would add no engine to the
  framework, but it would add a deployed PostgreSQL server for the adopting module's database
  ([ADR-006](006-database-per-service.md)). And its own outbox and projection machinery would sit beside
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

## Revision (2026-10-01)
No decision or rationale changed. Two citations were re-anchored: the soft-delete global query filter
now points at `ApplySoftDeleteFilters` (`.../DbContexts/ApplicationDbContext.cs:454`, the filter at
`:466`), and the outbox processor at its class declaration (`.../Outbox/Processing/OutboxProcessor.cs:57`).

## Revision (2026-10-06)
No decision changed.
- The audit-history rationale is scoped: ADR-075 field-level history covers only entities marked
  `IAuditedEntity` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAuditedEntity.cs:34`), is
  opt-in (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:26`)
  and is purged after a retention window (`:38`, 90 days by default) only when the host also runs the
  scheduler (`AddScheduledJobs` plus `Scheduler:Enabled`); without it the value is inert and the table
  grows (`:33-35`). ADC's `LivePoll` is not marked.
- Audit stamping is attributed to the interceptor reading the identity the save records, not to the
  save method itself.
- Anchors re-verified against current source; the soft-delete filter (`:453`, `:465`), outbox mapping
  (`:667`), `EventType` (`:40`), save (`:194`) and `OutboxProcessor` (`:53`) citations moved.

## Revision (2026-10-07)
Re-verified against current source. The decision (event sourcing not adopted) and the revisit trigger
are unchanged; two rationale statements were made precise and six body anchors re-pointed, after
source commits on 2026-10-07 shifted the lines they cited.
1. The "no workload asks for replayable history" rationale now names ADC Engagement's `PointsEntry`,
   an append-only ledger whose total is the sum of its entries
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/Points/PointsEntry.cs:12`), with
   soft delete or erasure as the one write that moves a total (`:26-27`), and states why it is not
   event sourcing (each entry is a current-state aggregate row, not an event replayed to rebuild
   another aggregate) and why it does not meet the revisit trigger: it is marked `IAuditedEntity`
   (`:31`) so the append-only rule can be proven (`:24-25`), which the ADR-075 trail already answers.
2. The Marten rejection no longer says PostgreSQL is absent here. The framework supports it as an
   engine ([ADR-113](113-postgresql-as-a-first-class-engine.md),
   `MMCA.Common/Directory.Packages.props:63`), and the provider ships transitively in every consumer
   through `MMCA.Common.Infrastructure.csproj:47`, but no production deployment runs a PostgreSQL
   server and no production entity routes to a non-SQL-Server engine
   ([ADR-018](018-polyglot-persistence.md)). Marten would add a deployed PostgreSQL server for the
   adopting module, not a new framework engine.
3. Anchors re-verified against current source: `ApplySoftDeleteFilters`
   (`.../DbContexts/ApplicationDbContext.cs:454`, the filter at `:466`), the `OutboxMessages` table
   mapping in `ConfigureOutbox` (`:668`), `OutboxProcessor` class declaration
   (`.../Outbox/Processing/OutboxProcessor.cs:56`), `EfInboxStore` class declaration
   (`.../Persistence/Inbox/EfInboxStore.cs:41`), and ADC's `OutboxMessages` table mapping
   (`SQLServerDbContextModelSnapshot.cs:1590`). The earlier values `:453`, `:465`, `:667`, `:53`,
   `EfInboxStore.cs:38` and snapshot `:1589` (and the 2026-10-01 `:57`) are superseded by these;
   `EventType` (`OutboxMessage.cs:40`) and the save (`ApplicationDbContext.cs:194`) hold.

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
