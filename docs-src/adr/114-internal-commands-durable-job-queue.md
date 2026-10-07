# ADR-114: Internal Commands, a Job Queue Built on the Outbox's Machinery

## Status
Accepted (2026-09-09). Rides the outbox machinery of
[ADR-003](003-outbox-dual-dispatch.md) without extending it. Revised 2026-09-19 (three corrections
to match the code: a schedule outside a transaction signals the processor only when the row is
already due, context restoration moved to the shared `AmbientOrigin` helper, and the queue's polling
interval matches the outbox default, with the difference coming from deployed configuration).
Revised 2026-10-01 (a schedule outside a transaction now signals the processor whether or not the row
is due, and the two processors share one polling implementation; see Revision below).
Revised 2026-10-06: a schedule enrolled in a transaction now owes a processor wake that the unit of
work releases once after a successful commit and drops on rollback.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

## Context
The framework has had two ways to move work off the request thread and neither of them is a job
queue.

The **transactional outbox** ([ADR-003](003-outbox-dual-dispatch.md)) carries *events*.
`OutboxMessage`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:15`) is
written by the domain-event interceptor inside the same transaction as the aggregate change, and
`OutboxProcessor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:56`)
drains one table per relational source with a claim lease, exponential backoff, dead-lettering and
OpenTelemetry instrumentation. It answers "this happened, tell whoever cares". It does not answer
"do this later", and bending it to do so means expressing an instruction as an event, which is
exactly the modelling mistake [ADR-007](007-grpc-extraction.md) and
[ADR-008](008-service-extraction-topology.md) spend their length avoiding.

The **recurring scheduler** ([ADR-074](074-recurring-job-scheduler.md)) carries *cron occurrences*.
`IScheduledJob`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IScheduledJob.cs:36`) plus
`ScheduledJobEntry`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20`) hold one
row per registered job in the `Default` source only, and a missed occurrence is deliberately not
replayed. That is right for "sweep the audit trail nightly" and wrong for "send this one order its
receipt", which is a single unit of work bound to a single aggregate, must not be lost, and must not
fire until the order actually commits.

So the gap is specific: a handler that wants a side effect to happen **after** its transaction
commits has, today, either a fire-and-forget `Task` (lost on a crash, invisible to operations) or a
hand-rolled table per feature. Templated email, outbound webhooks, tenant provisioning, saga
timeouts and an operations console all need the same primitive underneath, so building it once and
building it on the machinery already proven in production is the cheaper path than five bespoke
tables.

Three off-the-shelf options were weighed and rejected; the reasoning is in the Rationale below.

## Decision
**Deferred work is an ordinary CQRS command, scheduled into a per-source `InternalCommands` table
and executed later through the normal decorator pipeline.**

Five parts carry that.

**1. The contract is the one that already exists.** `IInternalCommand`
(`MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommand.cs:38`) is a
marker deriving from `ICommand<Result>` and nothing else. A command that opts in keeps its ordinary
`ICommandHandler<TCommand, Result>`; there is deliberately no second handler contract, because the
whole point is that a deferred execution IS the inline execution, run later. `InternalCommandDispatcher`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandDispatcher.cs:75`)
resolves the CLOSED `ICommandHandler<TCommand, Result>` from the execution scope, so what comes back
is already wrapped by Scrutor in the feature gate, the authorization check, logging, cache
invalidation, validation, the timeout budget and the transaction
([ADR-014](014-cqrs-decorator-pipeline.md)'s order, unchanged).

**2. Scheduling rides the caller's unit of work.** `IInternalCommandScheduler`
(`MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommandScheduler.cs:16`)
exposes `ScheduleAsync(command, runAt)` and a `TimeSpan delay` overload, both returning
`Result<Guid>`. The implementation
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/InternalCommandScheduler.cs:69`)
adds the row to the context handed back by the scope's own `IDbContextFactory` (`:99`, `:103`),
which is the same instance the calling handler's repositories use. With a transaction active it
enrolls the row and records an owed processor wake against that context instead of signalling
(`EnrolledCommandWake.Defer`, `:113`), so the caller's commit persists the row and a rollback erases
it; the unit of work releases the owed wake once, after a successful commit
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:481`
and `:634`), and drops it on rollback (`:853`), with the wake itself kept in
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/EnrolledCommandWake.cs:14`.
With no transaction active it saves immediately (`:120`) and signals the processor whether or not the
row is due yet
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/InternalCommandScheduler.cs:125`):
a due row runs on the wake, and a future-dated row re-arms the processor's smart wait on its
`ScheduledOn` plus `ProcessingDelaySeconds`, floored at one second and capped at the polling
interval (`InternalCommandProcessor.cs:101`, delegating to `PollingLoop.ComputeWaitTime` at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Polling/PollingLoop.cs:104`). That is the
outbox's atomicity guarantee applied to an instruction instead of an event: a transaction that
aborts schedules nothing.

**3. One table per relational source, mapped unconditionally.** `InternalCommandMessage`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/InternalCommandMessage.cs:21`)
is configured in `ApplicationDbContext.ConfigureInternalCommands`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:752`)
alongside the outbox and inbox, with three filtered indexes for the poll, the retention sweep and the
dead-letter view. It takes the engine the model is being built for and runs its partial-index
predicates through the same `QuoteColumn`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:619`)
and `IncludeColumns`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:645`)
helpers [ADR-113](113-postgresql-as-a-first-class-engine.md) introduced for the outbox, so PostgreSQL
gets double-quoted identifiers while every other engine keeps the bracketed literal it has always
produced. `PostgreSQLDbContext` calls `base.OnModelCreating`, so the fourth engine needs no
registration of its own. Cosmos ignores the entity, exactly as it ignores the outbox
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:127`).
The mapping is NOT gated on `InternalCommands:Enabled`, unlike the scheduler's job table: a row must
be able to commit in the same transaction as the aggregate change, a transaction does not span
databases, and a flag that changed the schema would make enabling the queue a migration rather than a
deployment decision.

**4. Execution restores the caller's context.** The row captures the scheduling user id, roles,
tenant and correlation id. The processor does not restore that context itself: before the dispatcher
runs it calls the shared `AmbientOrigin.Restore`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/AmbientOrigin.cs:156`, called at `InternalCommandProcessor.cs:483`), the same helper
the other background hops use, so every hop restores the same shape. `Restore` sets the tenant
first, then rebuilds a `ClaimsPrincipal` carrying the `sub` claim and one role claim per stored role
(`AmbientOrigin.BuildPrincipal`, same file `:86`) and hands it to `ScopedUserOverride`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ScopedUserOverride.cs:27`), a scoped
carrier read by `ImpersonatingCurrentUserService`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/ImpersonatingCurrentUserService.cs:20`),
which decorates whatever `ICurrentUserService` the host registered
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:242`). With no override
set every member reads straight through, so an HTTP request behaves exactly as before.

**5. Failure policy: the outbox's, with one deliberate divergence.** `InternalCommandProcessor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandProcessor.cs:43`)
claims the due prefix of each batch with a lease token
(`ClaimDueAsync`, `:286`), executes each row in a fresh DI scope, and stamps the outcome through a
set-based update guarded by that token (`StampAsync`, `:606`) so a replica whose lease expired
mid-execution silently drops its stale outcome. A `Result.Failure` and a thrown exception are the
same operational fact and both consume an attempt; the backoff is
`RetryBackoffBaseSeconds * 2^(attempts-1)` with jitter in `[0.8, 1.2]`, capped at
`MaxRetryBackoffSeconds` (`ComputeRetryBackoffSeconds`, `:632`, delegating to the shared
`PollingLoop.ComputeRetryBackoffSeconds` at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Polling/PollingLoop.cs:183`). A
payload that no longer deserializes is dead-lettered on the first attempt as `payload_invalid`
(`:374`), because retrying cannot change the stored bytes. The divergence: an unresolvable
command type (`type_unresolvable`, `:387`) and a missing handler registration (`handler_missing`,
`:409`) are terminal on the FIRST attempt, where the outbox
retries an unresolvable type once. An outbox row's type may live in an assembly that has simply not
loaded yet; a queue row can only run on a host that registers a handler for it, and a host that
cannot name the type has no such handler, so retrying would burn the attempt budget waiting for a
fact that will not change.

Settings live under `InternalCommands`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Administration/InternalCommandsSettings.cs:15`)
and mirror `OutboxSettings` where the semantics match: `BatchSize` 50 (`:31`), `MaxAttempts` 5
(`:39`), `LeaseSeconds` 300 (`:70`), `RetryBackoffBaseSeconds` 10 (`:79`), `RetentionDays` 7 (`:95`),
`CleanupIntervalHours` 6 (`:110`). Two values deliberately differ. `ProcessingDelaySeconds` defaults
to `0` rather than the outbox's 5 (`:59`), because that delay exists to bound a race with the
in-process fast path that dispatches an event before the processor can, and the queue has no such
fast path. `MaxRetryBackoffSeconds` (600, `:88`) is a separate ceiling rather than the lease, because
a job queue wants a long lease for slow handlers and a short ceiling on how long a transient failure
parks a command, where the outbox caps its backoff at `LeaseSeconds` and gets one number for both.

`IInternalCommandAdministration`
(`MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommandAdministration.cs:17`)
mirrors `IOutboxAdministration`: count pending, list dead letters, requeue, purge completed. A
requeue keeps `LastError` on purpose, because the reason a command failed is the first thing anyone
asks after a requeue.

## Rationale
Four alternatives were weighed, and each one gave up the atomicity guarantee or duplicated a
vocabulary the framework already owns:

**Hangfire.** It is the obvious answer and it brings its own storage, its own dashboard and its own
serialization. All three are the problem. Its storage is a separate set of tables with its own
connection, so a job enqueued inside a handler cannot commit atomically with the aggregate change
that justified it, which is precisely the guarantee this record exists to provide. Its dashboard and
its `IJobFilter` pipeline duplicate, in a second vocabulary, the operator surface and the decorator
pipeline the framework already has. And it executes a serialized method invocation, not a command,
so nothing it runs passes through feature gating, authorization, validation or the transaction
decorator without being taught to.

**Quartz.NET.** A stronger scheduler than the framework's own (calendars, misfire policies,
clustering) and a weaker fit for this problem. It is built around recurring triggers, and the
framework already has that shape in `IScheduledJob`. Its `AdoJobStore` is again a separate schema
with no way to enlist in the caller's transaction, and adopting it would mean running two schedulers
with two configuration surfaces to gain a feature set (cron calendars) nobody has asked for.

**A cloud queue (Azure Storage Queues, Service Bus).** The right answer once the work must cross a
process boundary or survive the database being unavailable, and the wrong first step. It reintroduces
the dual-write problem the outbox was adopted to solve, because a message put on a queue cannot roll
back with the transaction; the standard fix is to write an outbox row that a processor forwards to
the queue, which is this design plus one hop. It also adds an infrastructure dependency and a cost
line to every consumer, including MMCA.Helpdesk, whose whole premise is running with nothing but a
database.

**Extending the outbox to carry commands.** Tempting, since the machinery is exactly what is wanted.
Rejected because the two rows want different columns (a scheduled instant, an attempt budget, a
captured principal), different indexes, different retention and different terminal semantics for an
unresolvable type, and because the outbox's poll predicate is the hottest query the framework issues.
Widening it to serve a second workload would have made every outbox change a job-queue change. The
duplication is bounded and deliberate: the two processors share the loop mechanics (the main loop
with its smart wait, the per-source drain and the retry backoff) through the internal `PollingLoop`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Polling/PollingLoop.cs:12`), while
each keeps its own tables, queries, logging, metrics and activities, and `ScheduledJobRunner` still
borrows the claim-lease idiom without borrowing the code.

## Trade-offs

**Consumers take one migration per relational data source.** The table is in the model of every
relational source (SQL Server, PostgreSQL and SQLite after
[ADR-113](113-postgresql-as-a-first-class-engine.md)), so a consumer bumping to this version runs
`dotnet ef migrations add AddInternalCommands` per source and applies it before deploying. That is
the cost of the atomicity guarantee, and it is paid once.

**Execution is at-least-once, and handlers must be idempotent.** A replica that dies after its
handler committed and before the row was stamped releases the row when its lease expires and the
command runs again. This is the same contract the outbox already places on event handlers, so it is
not a new obligation for anyone already using the framework, but it is now an obligation on ordinary
commands too, which previously only ever ran once per request.

**A scheduled command runs with the scheduling user's authority, not the executing host's.**
That is what makes an `IRequiresPermission` command schedulable at all, and it means the row is a
durable record of an authorization decision. If the user's roles change between scheduling and
execution, the stored roles win. That is deliberate (the decision was taken when the work was
requested) and it is why the row is subject to the same retention discipline as the outbox: the
sweep (`InternalCommandCleanupService`) is the retention policy, and the payload can carry personal
data ([ADR-003](003-outbox-dual-dispatch.md) / [ADR-005](005-soft-delete-vs-erasure.md)).

**A command scheduled inside a transaction is woken at the commit, and the polling interval is the
fallback.** The enrolled row raises no signal at enrollment, because a signal before the commit only
buys a poll against a transaction that has not committed; the wake is owed instead and released once
after the commit succeeds (Decision 2). Anything that wake does not reach is discovered by the next
poll. `InternalCommands:PollingIntervalSeconds` ships at 2
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Administration/InternalCommandsSettings.cs:50`),
which is the same default `OutboxSettings` ships
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:31`),
so the divergence is a deployment decision rather than a framework one: ADC and Store both run the
queue at 60 seconds (`MMCA.ADC/infra/main.bicep:1750`, `MMCA.Store/infra/main.bicep:1500`) while
pushing the outbox to 300 (`MMCA.ADC/infra/main.bicep:1744`, `MMCA.Store/infra/main.bicep:1493`).
A host that raises the interval to cut idle polling accepts that much latency on any
transaction-scheduled work the post-commit wake does not reach.

**Two poll loops, not one.** A host now runs the outbox processor and the queue processor side by
side, each with its own signal instance so a burst of schedules cannot consume the outbox's single
pending wake-up. Both poll spans are suppressed from telemetry export by the same Aspire processor
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:63`), and the
queue's metrics land on their own `MMCA.Common.InternalCommands` meter
(`.../Persistence/InternalCommands/Processing/InternalCommandMetrics.cs:20`).

**What this unlocks.** Templated email, outbound webhooks with retry, tenant provisioning, saga
timeouts and an operations console over deferred work now share one durable substrate with one
retry policy, one dead-letter story and one operator surface, instead of a table and a poll loop per
feature.

## Revision (2026-10-01)
Two statements no longer matched the code. First, a schedule made outside a transaction now saves
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/InternalCommandScheduler.cs:123`)
and then signals the processor whether or not the row is due
(`InternalCommandScheduler.cs:128`); the earlier due-only guard is gone, so a future-dated row
re-arms the processor's smart wait on its `ScheduledOn` instead of being learned only at the next
polling interval. Rows enrolled in a transaction still raise no signal (`:111`). Second, the outbox
and queue processors now share an implementation of their loop mechanics, the internal `PollingLoop`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Polling/PollingLoop.cs:12`), used at
`OutboxProcessor.cs:113` and `InternalCommandProcessor.cs:82`; the queries, telemetry names and
failure policy stay per-processor, so the decision to keep the two tables separate is unchanged.
Decision 5 also now names the third first-attempt terminal case, an undeserializable payload
(`InternalCommandProcessor.cs:385`). Stale citations were re-anchored in place: `OutboxProcessor`,
`ConfigureInternalCommands`, `QuoteColumn`, `IncludeColumns`, the Cosmos `Ignore`, `ScopedUserOverride`,
the `ICurrentUserService` decoration, `InternalCommandProcessor` and its members, the
`InternalCommandsSettings` defaults, and the ADC polling settings (`MMCA.ADC/infra/main.bicep:1693`
and `:1699`).

## Revision (2026-10-06)
- A schedule enrolled in a transaction no longer leaves the row to the next poll. The scheduler
  records an owed wake (`InternalCommandScheduler.cs:113`, `EnrolledCommandWake.cs:14`), which the
  unit of work releases once after a successful commit (`DbContextFactory.cs:481` and `:634`) and
  drops on rollback (`DbContextFactory.cs:853`). Decision 2 and the transaction-latency trade-off
  were reworded to match; the 2026-10-01 statement that enrolled rows raise no signal (`:111` there)
  is superseded.
- The trade-off now cites the Store deployment alongside ADC for the 60-second queue and 300-second
  outbox intervals (`MMCA.Store/infra/main.bicep:1500` and `:1493`).
- Anchors were re-verified against current source and re-anchored in the live sections; the
  `PollingLoop` call sites recorded in the 2026-10-01 revision are now `OutboxProcessor.cs:107` and
  `InternalCommandProcessor.cs:76`, and its `payload_invalid` anchor is now
  `InternalCommandProcessor.cs:374`.

## Revision (2026-10-07)
Re-verified against current source. The decision, the five parts, every `InternalCommandsSettings`
default (`BatchSize` 50, `MaxAttempts` 5, `PollingIntervalSeconds` 2, `ProcessingDelaySeconds` 0,
`LeaseSeconds` 300, `RetryBackoffBaseSeconds` 10, `MaxRetryBackoffSeconds` 600, `RetentionDays` 7,
`CleanupIntervalHours` 6) and the deployed 60-second queue and 300-second outbox intervals in ADC and
Store are unchanged; only line anchors moved.

1. Anchors re-verified against current source: `OutboxProcessor`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:56`,
   its `PollingLoop.RunAsync` call now at `:110`), `ConfigureInternalCommands`, `QuoteColumn` and
   `IncludeColumns`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:752`,
   `:619`, `:645`), the `InternalCommandsSettings` members
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Administration/InternalCommandsSettings.cs:50`,
   `:59`, `:70`, `:79`, `:88`, `:95`, `:110`), and the ADC polling settings
   (`MMCA.ADC/infra/main.bicep:1750` for the queue and `:1744` for the outbox). The 2026-10-01 and
   2026-10-06 revisions keep their dated anchors as written.

## Related
[ADR-003](003-outbox-dual-dispatch.md) (the claim-lease, backoff and dead-letter machinery this
record borrows as an idiom),
[ADR-014](014-cqrs-decorator-pipeline.md) (the decorator chain a deferred command runs through
unchanged),
[ADR-074](074-recurring-job-scheduler.md) (the cron scheduler this record is deliberately not),
[ADR-052](052-background-job-execution.md) (the background execution posture the processor follows),
[ADR-113](113-postgresql-as-a-first-class-engine.md) (the engine-aware index helpers the table reuses),
[ADR-100](100-outbox-opt-in-resolved-from-messaging-mode.md) (why an always-mapped table is not a
migration decision).
