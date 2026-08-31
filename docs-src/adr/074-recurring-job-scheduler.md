# ADR-074: Recurring Job Scheduler (Persistent Cron Jobs on the Outbox Claim-Lease Pattern)

## Status
Accepted (2026-08-13; revised 2026-08-14, 2026-08-18, 2026-08-31). The implementation lands in the MMCA.Common "enterprise capability wave" release
and is opt-in: a host calls `AddScheduledJobs(configuration)` and sets `Scheduler:Enabled`. Until it does,
the framework creates no table and starts no runner.

## Context
The framework had two kinds of background work and neither of them is a schedule.

`OutboxProcessor` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs`)
is durable, multi-replica safe and event-driven: it runs when there is a row to drain, and its cadence is a
consequence of writes, not a calendar. [ADR-052](052-background-job-execution.md) is the opposite end: an
in-process bounded queue plus a hosted drain, started by a request, lost on restart, scoped to one replica
by design. Between them sits work that is neither, and every repo in the workspace had started inventing it
locally: purge rows older than N days, reconcile with an external system overnight, recompute a projection
before the business day. The available answer was a `PeriodicBackgroundService` subclass with an interval,
which fails on two counts. An interval is not a time of day, so "every 24 hours" drifts with each deploy and
lands at whatever hour the last restart happened to be. And an interval-driven hosted service runs on
**every** replica, so scaling a service to three instances silently triples a purge.

[ADR-075](075-audit-trail.md) forced the question: its change-history table needs a retention purge, and
shipping that as one more bespoke hosted service would have made the framework's own recurring work a
private implementation of a capability it declines to own. The unrecorded decision was whether to adopt a
scheduling product (Hangfire or Quartz.NET) or to extend the durable polling loop already in production.

## Decision

### The scheduler is the outbox claim-lease pattern applied to cron, not Hangfire and not Quartz.NET
A persistent job store plus a single-runner claim lease, reusing the exact idiom the outbox proved. The
outbox claims a batch with an `ExecuteUpdateAsync` that sets `LockedUntil` and `LockToken` in one statement
(`.../Persistence/Outbox/OutboxProcessor.cs:478-479`, inside `ClaimEligibleAsync`, `:454`) over a shared
`FilterClaimable` predicate that admits only rows whose `LockedUntil` is null or already in the past
(`:533-535`), then re-reads the claimed
set by `LockToken` so a partial claim processes only its own rows (`:490-493`). A due job is claimed the same way, so two replicas can
never run the same occurrence, and a replica that dies mid-run releases its job when the lease expires.

Hangfire would have brought its own schema, its own storage abstraction, a dashboard surface to authorize
and host, and a licensing posture that varies by storage provider. Quartz.NET would have brought a large
configuration surface and a second scheduling model beside the one the outbox already implements. Both add
a dependency that every extracted service host (ADR-008) must be reasoned about separately, in a framework
whose extraction story is that a module lifts out without acquiring new infrastructure. The missing piece
was a cron expression, not a product.

### Cron parsing is the one thing bought rather than built
**Cronos** (MIT, zero-dependency) is pinned in `Directory.Packages.props` and parses every expression.
Writing a cron parser in-house is out of scope for this wave, and interval-only schedules are below the bar
this record exists to clear.

### `IScheduledJob` is the contract, resolved scoped per execution
`IScheduledJob` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IScheduledJob.cs`) declares
`Name`, `CronExpression` (a string) and `ExecuteAsync(CancellationToken)`. Nothing else: a job is a name, a
schedule and a body. Jobs are resolved through `IServiceScopeFactory` in a **fresh scope per execution**,
the OutboxProcessor pattern, so a job body gets scoped services (a `DbContext`, a repository, the
correlation context) exactly as a request handler does, and a long-lived runner never captures a scoped
dependency.

### The job store is one row per job, in the Default source only
`ScheduledJobEntry` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs`)
carries `JobName` (the primary key), `CronExpression`, `NextRunOn`, `LastRunOn`, `LastOutcome`,
`LastDurationMs`, `LockedUntil` and `LockToken`. It is deliberately **not** an `IAuditableEntity`: it
self-stamps nothing, it is never soft-deleted, and no global query filter reaches it. That falls out of the
mapping rather than being asserted: the soft-delete filter is applied only to entity types assignable to
`IAuditableEntity` (`.../Persistence/DbContexts/ApplicationDbContext.cs:370`, `:379`), and
`ConfigureScheduler` maps the table with no `HasQueryFilter` call of its own (`:594-619`). That is the
`OutboxMessage` precedent: infrastructure rows are not domain rows.

The table lives in the **Default** source and only there. The outbox exists once per relational database
because an outbox row must be written in the same transaction as the aggregate that produced it
([ADR-006](006-database-per-service.md)). A schedule has no such tie: a job belongs to the host that
registered it, not to a database, and a per-source job table would give a four-database host four copies of
one schedule and four claims for one occurrence.

### `ScheduledJobRunner` is a `BackgroundService` with a smart wait, not a `PeriodicBackgroundService`
`ScheduledJobRunner` (`.../Infrastructure/Scheduling/ScheduledJobRunner.cs`) subclasses `BackgroundService`
directly, because a fixed period is the wrong shape: after each cycle it waits until the **earliest**
`NextRunOn` across the store, through `TimeProvider`, capped by the polling interval. That mirrors the
outbox smart wait, and it is what keeps a scheduler with one nightly job from waking 2,880 times a day to
find nothing due. The cycle is: claim the due jobs with the `ExecuteUpdateAsync` lease, execute each in a
fresh scope, record the outcome and duration on the row, compute the next occurrence with Cronos in UTC,
release the lease.

### A missed schedule runs once and then advances
A host that was down for six hours does not fire six catch-up runs. When the runner finds a job whose
`NextRunOn` is in the past it executes that job exactly once, then advances `NextRunOn` to the next
occurrence **after now**, discarding the occurrences that elapsed while the host was gone. A retention purge
that missed four nights wants one purge, not four identical passes over a table it already cleaned, and a
reconciliation sweep wants current state rather than four replays of it. The cost is in the Trade-offs: a
job that must run for every window is not served by this scheduler.

### Settings, metrics and registration
`SchedulerSettings` binds the `Scheduler` section with `Enabled`, `PollingIntervalSeconds` (default 30) and
`LeaseSeconds` (default 300), through the mandatory
`AddOptions<T>().Bind(...).ValidateDataAnnotations().ValidateOnStart()` chain of
[ADR-070](070-fail-fast-configuration-contract.md), so a malformed scheduler section stops the host at boot
rather than at 03:00.

`SchedulerMetrics` (`.../Infrastructure/Scheduling/SchedulerMetrics.cs:16`) follows the same conventions as
`OutboxMetrics` (`.../Persistence/Outbox/OutboxMetrics.cs:16`) under
[ADR-041](041-observability-and-telemetry.md): one meter per subsystem, never a second `Meter` with the
same name, and outcomes carried as tags rather than as separate instruments. It is not an
instrument-for-instrument copy. The scheduler emits **one** counter, `RunCounter`, tagged by `job` and by
`outcome` (`Succeeded`, `Failed`, `Skipped`), so a failure rate is that counter split by tag rather than a
second instrument (`:28`), plus two histograms: `DurationHistogram` for execution time in seconds (`:39`)
and `LagHistogram` for lag, actual start minus `NextRunOn` (`:50`). The outbox carries a different set for
its own shape: two counters, `DeadLetterCounter` and `ProcessedCounter` (`OutboxMetrics.cs:41`, `:47`), one
histogram, `DispatchLagHistogram` (`:57`), and two observable gauges, `PendingDepthGauge` for backlog depth
(`:75`) and `OldestPendingAgeGauge` for the age of the oldest row still awaiting dispatch, per `data_source`
(`:98`). The scheduler has a counterpart for neither, because depth and backlog age are questions about a
queue and a schedule has no queue.

Registration is two calls. `AddScheduledJobs(configuration)` binds the settings and registers the runner;
`AddScheduledJob<TJob>()` adds one job from any module, using the accumulate-across-modules idiom that
`AddPermissions` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:54`)
and its `EnsurePermissionRegistry` helper (`:68`) already establish. That registration takes **no schedule
argument** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:426`): the schedule is
the job's own `CronExpression` property, and the one way to retime a shipped job without a release is
configuration, the `Scheduler:Jobs:{Name}:Cron` section bound by `SchedulerSettings.Jobs`
(`.../Infrastructure/Settings/SchedulerSettings.cs:54-60`) into `ScheduledJobOverrideSettings.Cron` (`:74`).
The runner resolves the two per job on every cycle, the override when it is present and non-blank and the
compiled-in default otherwise (`ResolveCronExpression`, `.../Infrastructure/Scheduling/ScheduledJobRunner.cs:162`).
The table is created only when the settings flag is on, the same gating [ADR-075](075-audit-trail.md) uses.
Every cycle the registered jobs are **upserted by `JobName`** (`SyncRegistrationsAsync`, `:259`), which is why
an override edited on a running host takes effect on the next cycle: the stored expression is rewritten and
the next occurrence recomputed from the current instant, with a row whose expression is unchanged left alone.

### Design-time gets the same flag
`DesignTimeDbContextOptions.EnableScheduler`
(`.../Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:41`) is the design-time mirror of
`Scheduler:Enabled`, and `DesignTimeDbContextHelper` feeds it to the context as a fixed
`SchedulerSettings` (`.../Design/DesignTimeDbContextHelper.cs:136-137`). Without that flag the design-time
model diverges from the runtime model and `dotnet ef` breaks for every consumer.

### The framework dogfoods it
`AuditTrailCleanupJob`, the retention purge of [ADR-075](075-audit-trail.md), ships as the framework's first
`IScheduledJob`, so the contract is exercised by the package that defines it before any application depends
on it. In the consumer sweep, ADC, Store and Helpdesk all call `AddScheduledJobs`, each adding one migration
on its Default source.

## Rationale
- **The lease is already proven under production load.** Multi-replica correctness for recurring work is the
  hard part, and it was solved once for the outbox: an atomic claim update, a token identifying the
  claimant's rows, and an expiry that returns a dead replica's work with no operator involvement. Reusing it
  means the scheduler's riskiest property was verified before it existed.
- **A product dependency is paid for by every host, forever.** Hangfire and Quartz.NET are competent, and
  they are also a schema, a configuration model and an upgrade obligation that each extracted service host
  inherits. Adding a scheduling server to that list would have cost more than the code it replaced.
- **A cron string is the interface operators already know.** It is portable, it is diffable in configuration,
  and it expresses "03:15 every day" and "every 15 minutes on weekdays" in one grammar. An interval
  expresses neither.
- **Persistence is what makes it a schedule instead of a timer.** `NextRunOn` and `LastRunOn` survive a
  restart, so a deploy at 02:59 does not skip the 03:00 job and does not re-run it.
- **Cronos is a parser, not a framework.** MIT, zero dependencies, no storage or hosting opinion: it turns a
  string into the next `DateTime` and nothing else, which is exactly the piece not worth writing.
- **Scoped-per-execution keeps job bodies ordinary.** A job that takes an `IUnitOfWork` looks like any other
  application code, and nothing about it knows it is on a schedule. The Default source keeps the schedule
  itself in one place, since jobs are host-scoped facts and per-database copies would only contend.
- **Opt-in keeps the release non-breaking.** No table, no runner, no polling and no cost for a host that
  never calls `AddScheduledJobs`, which is what lets the capability ship in a lockstep release
  (ADR-016) that every consumer takes at once.

## Trade-offs
- **A polling loop is not a real-time scheduler.** Worst-case start lag is one polling interval, 30 seconds
  at the default, so sub-minute precision is not on offer. A job that must start within a second of its
  scheduled instant is not what this is.
- **The lease is a time lease, not a fence.** A runner that stalls past `LeaseSeconds` (300 by default) can
  have its job claimed by another replica while it is still executing. Jobs must therefore be idempotent,
  the same at-least-once posture [ADR-003](003-outbox-dual-dispatch.md) demands of event handlers, and a job
  whose body can exceed the lease should raise `LeaseSeconds` rather than assume exclusivity.
- **Scheduling depends on the Default database.** A service whose module database is perfectly healthy
  loses all scheduling if its Default source is unavailable, because that is where the claim is taken. That
  is the price of one schedule per host rather than one per source.
- **No per-job retry policy in v1.** A failed run records its outcome and its duration and then waits for
  the next cron occurrence. There is no backoff curve and no dead-letter equivalent of the outbox's, so a
  job that fails at 03:00 is simply not done until 03:00 tomorrow unless the job body retries internally.
- **No dashboard, no ad-hoc trigger endpoint, no run-history table.** The entry carries the **last** outcome
  and duration and nothing before it, so "did this run last Tuesday" is a question for the job's logs or
  metrics, not the table.
- **Run-once-then-advance silently drops occurrences.** A long outage loses every elapsed window but one,
  with no record that it did. That is right for a purge and wrong for a job that must produce an artifact
  per window (a nightly export, a per-period invoice run), which has to make the window explicit in its own
  state rather than infer it from the schedule.
- **Cron is evaluated in UTC only.** A daily job holds its UTC instant across a local daylight-saving shift,
  so a "3am" job becomes a 4am job for half the year in any zone that observes one. Making it zone-aware
  would put a time zone on every entry and a policy decision on every ambiguous or skipped local hour.
- **Nothing enforces that a cron expression is sensible.** A typo that still parses binds a job to a
  schedule nobody intended, and Cronos parsing at startup is the only check: it catches `* * * * ? ?` and it
  cannot catch `0 3 * * 1` written when `0 3 * * *` was meant.
- **One runner per host, and it is shared.** A slow job delays the jobs due behind it, exactly as
  [ADR-052](052-background-job-execution.md)'s single-reader drain does for its queue.

## Related
[ADR-003](003-outbox-dual-dispatch.md) (the outbox whose claim-lease idiom and smart wait this reuses
verbatim, and whose at-least-once posture it inherits along with the idempotency obligation on job bodies),
[ADR-052](052-background-job-execution.md) (in-process background execution: the request-triggered,
non-durable sibling this does not replace, the boundary being durability and ownership, since work started
by a request and safe to lose stays on the bounded queue while work owned by a clock and required to survive
a restart belongs here),
[ADR-006](006-database-per-service.md) (database-per-service, why the outbox is per-source and this job
store is Default-source-only),
[ADR-075](075-audit-trail.md) (the audit-trail retention purge that ships as this scheduler's first job),
[ADR-070](070-fail-fast-configuration-contract.md) (the validating chain `SchedulerSettings` binds through),
[ADR-041](041-observability-and-telemetry.md) (the metrics conventions `SchedulerMetrics` follows, the same
ones `OutboxMetrics` follows, with its own instrument set),
[ADR-030](030-startup-sole-migrator.md) (the startup owner that applies the migration
creating the job table).
