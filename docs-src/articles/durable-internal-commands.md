# Four Ways to Do Work Later: Channels, Cron, the Outbox and Durable Internal Commands

> Series: MMCA.Common · Article #51 (deep-dive) · Pillar P2/P3 · Group G04 · Rubric §6,§10 · ADR-114, ADR-121 ·
> Status: grounded in `Website/docs-src/adr/114-internal-commands-durable-job-queue.md`,
> `Website/docs-src/adr/121-ephemeral-in-process-work-queue.md`,
> `MMCA.Common/.../Application/InternalCommands/IInternalCommand.cs`,
> `.../IInternalCommandScheduler.cs`, `.../IInternalCommandAdministration.cs`,
> `.../InternalCommandNameAttribute.cs`,
> `MMCA.Common/.../Infrastructure/Persistence/InternalCommands/InternalCommandMessage.cs`,
> `.../Processing/InternalCommandProcessor.cs`, `.../Processing/InternalCommandMetrics.cs`,
> `.../Processing/InternalCommandDispatcher.cs`,
> `.../Administration/InternalCommandsSettings.cs`,
> `MMCA.Store/.../Sales.Application/Orders/InternalCommands/SendOrderPaymentFailedEmailInternalCommand.cs`
> and its handler and saga scheduling site,
> `MMCA.ADC/.../Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/*`,
> `MMCA.ADC/.../Conference.API/Controllers/Sessions/SessionSelectionController.cs`, and the §6/§10 rows of
> `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`. No em dashes.

**Subtitle:** A handler that wants something to happen after its transaction commits has four mechanisms
to choose from, and picking the wrong one loses the work or pays for machinery it does not need. Here is
the durable one: an ordinary CQRS command written to a table inside your transaction, claimed by a leased
processor, and run later through the same decorator pipeline it would have run through inline.

---

The order just failed its payment. You have the aggregate in front of you, the transaction is still open,
and the customer needs an email.

Reach for the obvious thing and you write `_ = Task.Run(() => SendEmailAsync(orderId))`. It works on your
machine every time. It also sends before the transaction commits, so a rollback emails a customer about
an order that does not exist; it dies with the process, so a deploy in the wrong second loses it with no
record; and it is invisible to operations, so nobody finds out either way.

Reach for the second obvious thing and you put a message on a queue. Better, until you notice a message
cannot roll back with the transaction that justified it, which is the dual-write problem the outbox was
adopted to solve, arriving from a new direction.

So the question is not "how do I get this off the request thread." That part is easy and there are four
ways to do it. The question is which of those four this particular piece of work belongs to, and the
answer is decided by one property: what it costs when the work is lost. That is the decision recorded in
**ADR-114**, with its counterweight in **ADR-121**.

## Why it matters

The rubric asks for this twice, from two directions.

§6 (CQRS and Event-Driven Design) wants reads and writes separated through a dispatcher with a real
decorator pipeline, an outbox for atomic persist-then-publish rather than "save then publish and hope",
and idempotent consumers, with "consumers that aren't idempotent and break on redelivery" listed as a red
flag (`ArchitectureEvaluationCriteria.md:229-247`). §10 (Messaging and Integration Architecture) is a
weight-3 category (`:352`) scoring what happens once work leaves the request. It wants delivery semantics
stated per consumer, dead-letter and poison-message handling with "retries with backoff and a bounded
attempt count, then a dead-letter path with an operational procedure", bounded and documented retention,
and long-running work with persisted state and defined timeouts (`:329-348`). Its red flags name
"retries without idempotency (duplicate side effects) or without backoff (retry storms)" and "no
dead-letter story: a poison message blocks the queue or is silently dropped" (`:344-348`).

Read those two lists and notice what they describe: not an event bus, a **job queue**. Backoff, an
attempt ceiling, a dead-letter path, an operator procedure, retention. Every single one of those
properties has to exist somewhere, and the choice is only whether you build them once or five times, once
per feature that needed to do something later.

MMCA.Common scores §6 at Maturity 4 / Implementation 9 and §10 at Maturity 4 / Implementation 9
(`common-ArchitectureScorecard.md:86` and `:90`). Both rows are earned by machinery that was already
there for events. ADR-114 is the record of pointing that same machinery at instructions.

## Four mechanisms, one question

The framework has four ways to do work later, and they are not interchangeable.

**The bounded channel** (ADR-121) is a `Channel<T>` singleton with a `SingleReader` `BackgroundService`
drain, one per job kind. Its full mode is `DropOldest`, so under pressure it evicts the oldest item and
`TryWrite` always returns true, which means the producer cannot learn that anything was discarded
(`ADR-121:45-56`). It is in-process only: it does not survive a restart and does not span replicas
(`:133-135`). That is not a defect, it is the specification. Article 22 in this series covers it in full,
along with the live-channel case it exists for.

**The recurring scheduler** (ADR-074) carries cron occurrences: one row per registered job, and a missed
occurrence is deliberately not replayed (`ADR-114:26-33`). It answers "sweep the audit trail nightly".
Article 22 covers this one too, as the sibling contract for work a clock owns.

**The transactional outbox** (ADR-003) carries *events*. A row is written by the domain-event interceptor
inside the same transaction as the aggregate change, and a processor drains it with a claim lease,
exponential backoff, dead-lettering and OpenTelemetry instrumentation (`ADR-114:14-24`). It answers "this
happened, tell whoever cares". It does not answer "do this later", and bending it to do so means
expressing an instruction as an event, which is the modelling mistake ADR-007 and ADR-008 spend their
length avoiding.

**The internal command queue** (ADR-114) is the fourth, and it exists because the first three leave a
specific gap: a single unit of work, bound to a single aggregate, that must not be lost, and must not
fire until the aggregate change actually commits.

ADR-121 states the deciding question in one line: "would losing this item be noticed as anything more
than a missed UI refresh?" If yes, it is an internal command; if no, it is a channel item (`:128-131`).
The record is blunt about the symmetry of the mistake: putting must-run work on a `DropOldest` channel
loses it silently, and putting a broadcast through a durable command pays a row, a poll interval and a
lease for something worth less than the write (`:146-149`).

## The MMCA answer: a deferred execution IS the inline execution

Here is the decision that makes the rest of it cheap.

`IInternalCommand` is a marker interface deriving from `ICommand<Result>` and nothing else
(`IInternalCommand.cs:38`). A command that opts in keeps its ordinary
`ICommandHandler<TCommand, Result>`. There is deliberately no second handler contract, no `IJob`, no
`ExecuteAsync(JobContext)`, because the whole point is that running later is the only difference
(`IInternalCommand.cs:11-16`).

`InternalCommandDispatcher` resolves the **closed** `ICommandHandler<TCommand, Result>` from the
execution scope (`InternalCommandDispatcher.cs:75`), so what comes back from the container is already
wrapped by Scrutor in the whole ADR-014 chain: the feature gate, the authorization check, logging, cache
invalidation, validation, the timeout budget and the transaction, in that order, unchanged
(`ADR-114:51-61`).

That one decision is what the rest of this article is really about. It means a deferred command gets
validated. It means a deferred command can require a permission. It means the logging decorator writes
the same line it always wrote. None of that is job-queue code, because none of it is job-queue code
anywhere else either.

Compare that to what a general-purpose job library executes: a serialized method invocation, which passes
through none of your pipeline until you teach it to (`ADR-114:146-154`).

## Scheduling rides the caller's unit of work

`IInternalCommandScheduler` exposes `ScheduleAsync(command, runAt)` and a `TimeSpan delay` overload, both
returning `Result<Guid>` (`IInternalCommandScheduler.cs:41-57`). `runAt` is "the earliest instant the
command may run, converted to UTC", with `null` meaning as soon as possible, and the contract is explicit
that the processor never runs a row before that instant and makes no promise about how long after it a
busy queue takes to get there (`:23-27`).

The write goes to the context handed back by the scope's own `IDbContextFactory`, which is the same
instance the calling handler's repositories are using. From there the behavior splits, and the split is
the whole reason this mechanism exists (`ADR-114:62-75`):

- **With a transaction active**, the row is only enrolled. The caller's commit persists it, and the
  caller's rollback erases it.
- **With no transaction active**, the row is saved immediately, which flushes anything else pending on
  that context exactly as calling the unit of work's own save would
  (`IInternalCommandScheduler.cs:34-40`). The processor is signalled only when the row is already due, so
  a future-dated row is persisted without a wake-up and waits for the poll loop.

That first bullet is the outbox's atomicity guarantee applied to an instruction instead of an event: a
transaction that aborts schedules nothing. It is also precisely what a separate job store cannot give
you, and it is the single reason ADR-114 rejects Hangfire, Quartz.NET and a cloud queue. All three keep
their state somewhere your transaction does not reach, so an enqueue beside a rollback is a job with no
justification (`ADR-114:146-168`). The cloud-queue rejection is the interesting one, because it is
conditional: a broker queue is the right answer once the work must cross a process boundary or survive
the database being unavailable, and the standard way to enqueue it safely is to write an outbox row that
a processor forwards, which is this design plus one hop (`:161-168`).

## The row, and what it remembers

`InternalCommandMessage` (`InternalCommandMessage.cs:21`) is deliberately not an auditable entity, for
the same reason `OutboxMessage` is not: it is framework bookkeeping, not domain state, so it carries no
soft-delete flag, no audit stamps and no concurrency token. Its concurrency control is the explicit claim
lease (`:14-19`).

The columns fall into four groups.

**The instruction**: `CommandType` (`:43`), which is the identity the payload deserializes against, and
`Payload` (`:46`), the `System.Text.Json` output. The payload has to round-trip through JSON, which is a
requirement rather than a style preference, and the guidance is to keep it to identifiers and scalars,
never loaded aggregates (`IInternalCommand.cs:19-24`).

**The schedule**: `ScheduledOn` (`:52`), the earliest UTC instant the row may run, equal to `CreatedOn`
(`:55`) for an immediate schedule.

**The outcome**: `ProcessedOn` (`:61`), `Attempts` (`:64`), `LastError` (`:70`, truncated to the column
width) and `DeadLetteredOn` (`:77`), plus the lease pair `ClaimedBy` (`:84`) and `ClaimedUntil` (`:92`).

**The context it was written under**: `CorrelationId` (`:98`), `TraceId` (`:101`), `SpanId` (`:104`),
`UserId` (`:111`), `UserRoles` (`:118`) and `TenantId` (`:124`).

That fourth group is the one people forget to build, and it is what turns a deferred command from a
system call into a continuation of a user's request. Before the dispatcher runs, the processor calls the
shared `AmbientOrigin.Restore` (`InternalCommandProcessor.cs:530`), the same helper every other
background hop uses, so every hop restores the same shape. It sets the tenant first, then rebuilds a
`ClaimsPrincipal` carrying the `sub` claim and one role claim per stored role, and hands it to
`ScopedUserOverride`, a scoped carrier read by `ImpersonatingCurrentUserService`, which decorates whatever
`ICurrentUserService` the host registered (`ADR-114:96-109`). With no override set every member reads
straight through, so an HTTP request behaves exactly as it did before the queue existed. The identity is
stamped with an authentication type of `InternalCommand` (`InternalCommandProcessor.cs:72`), which is what
makes `IsAuthenticated` true and names the hop the identity came back from.

Restore the principal and an `IRequiresPermission` command becomes schedulable, because the authorization
decorator has a real user to evaluate. That is a genuinely useful property and a genuinely uncomfortable
one, and the trade-offs section below does not dodge it.

## A rename that does not orphan the queue

The row stores the command's assembly-qualified CLR name by default, which means renaming the class,
moving its namespace, or moving its assembly orphans every row already scheduled under the old name
(`InternalCommandNameAttribute.cs:7-10`).

`[InternalCommandName("Sales.SendOrderPaymentFailedEmail")]` replaces that with a stable identity no
refactoring changes. It mirrors `EventNameAttribute` on the outbox side, and the name has to be unique
across the commands a host can resolve, because reverse lookup matches on it (`:13-17`).

Two details matter more than the attribute itself. First, it changes only what **new** rows store, so
applying it to a command whose queue already holds pending rows is a two-step move: drain the queue
first, then rename (`:13-15`). Second, the failure it prevents is loud rather than silent: a rename
without the attribute leaves in-flight rows unresolvable, and the processor logs that and dead-letters
them rather than dropping them quietly (`IInternalCommand.cs:30-36`). You lose the work either way. The
difference is whether you find out.

## The drain: claim, execute, stamp

`InternalCommandProcessor` is a `BackgroundService` (`InternalCommandProcessor.cs:47`). Its cycle is the
outbox's idiom, borrowed rather than shared.

It waits a five-second startup delay so the host finishes module registration and migration before the
first cycle touches the table (`:81`), and returns immediately if the host owns no relational sources
(`:89-97`). Each cycle fetches the due candidates per source, claims the due prefix of the batch with a
lease token (`ClaimDueAsync`, `:369`), executes each row in a **fresh DI scope**, and stamps the outcome
through a set-based update guarded by that token (`StampAsync`, `:653`). That guard is what makes a
scaled-out host safe: a replica whose lease expired mid-execution silently drops its stale outcome rather
than overwriting whatever the new claimant did.

A `Result.Failure` and a thrown exception are the same operational fact, and both consume an attempt. The
backoff is `RetryBackoffBaseSeconds * 2^(attempts-1)` with jitter in `[0.8, 1.2]`, capped at
`MaxRetryBackoffSeconds` (`ComputeRetryBackoffSeconds`, `:679`).

Two failures are terminal on the **first** attempt rather than consuming the budget: an unresolvable
command type (`:434`) and a missing handler registration (`:456`). The outbox retries an unresolvable
type once, and the divergence is reasoned rather than accidental: an outbox row's type may live in an
assembly that has simply not loaded yet, while a queue row can only ever run on a host that registers a
handler for it, so a host that cannot name the type has no such handler and retrying would burn the
budget waiting for a fact that will not change (`ADR-114:110-141`).

The settings mirror `OutboxSettings` where the semantics match (`InternalCommandsSettings.cs`):
`BatchSize` 50 (`:31`), `MaxAttempts` 5 (`:39`), `PollingIntervalSeconds` 2 (`:49`), `LeaseSeconds` 300
(`:68`), `RetryBackoffBaseSeconds` 10 (`:77`), `RetentionDays` 7 (`:93`), `CleanupIntervalHours` 6
(`:108`). Two deliberately differ. `ProcessingDelaySeconds` defaults to `0` rather than the outbox's 5
(`:58`), because that delay exists to bound a race with the in-process fast path that dispatches an event
before the processor can, and a job queue has no such fast path. `MaxRetryBackoffSeconds` is its own
ceiling of 600 (`:86`) rather than reusing the lease, because a job queue wants a long lease for slow
handlers and a short ceiling on how long a transient failure parks a command, where the outbox gets one
number for both (`ADR-114:133-141`).

## The worked example: an email that must survive a deploy

MMCA.Store's Sales module schedules a payment-failure notification. The command is fifteen lines and most
of them are documentation:

```csharp
// MMCA.Store.Sales.Application/Orders/InternalCommands/SendOrderPaymentFailedEmailInternalCommand.cs
// (XML doc comments trimmed; the attribute, the record and the marker are verbatim.)
[InternalCommandName("Sales.SendOrderPaymentFailedEmail")]
public sealed record SendOrderPaymentFailedEmailInternalCommand(OrderIdentifierType OrderId)
    : IInternalCommand;
```

One identifier as the payload, a stable name, and the marker. That is the entire contract.

The scheduling site is `OrderPaymentFailedSagaHandler`, the domain-event handler Article 49 covers as a
compensating saga step. It opens its own scope, resolves `IInternalCommandScheduler`, and calls
`ScheduleAsync(new SendOrderPaymentFailedEmailInternalCommand(domainEvent.OrderId), runAt: null, ...)`
(`OrderPaymentFailedSagaHandler.cs:32,35`). The same handler also schedules
`ExpireUnpaidOrderInternalCommand` (`:79-82`), which is the `runAt` case: a command that should run at a
specific future instant rather than as soon as possible.

The handler on the other side is an ordinary command handler with no queue awareness at all:

```csharp
// Condensed from SendOrderPaymentFailedEmailInternalCommandHandler.HandleAsync (logging trimmed).
public sealed partial class SendOrderPaymentFailedEmailInternalCommandHandler(
    IUnitOfWork unitOfWork,
    ICustomerService customerService,
    IEmailSender emailSender,
    ILogger<SendOrderPaymentFailedEmailInternalCommandHandler> logger)
    : ICommandHandler<SendOrderPaymentFailedEmailInternalCommand, Result>
{
    public async Task<Result> HandleAsync(
        SendOrderPaymentFailedEmailInternalCommand command,
        CancellationToken cancellationToken = default)
    {
        var orders = unitOfWork.GetReadRepository<Order, OrderIdentifierType>();
        var order = await orders.GetByIdAsync(command.OrderId, cancellationToken);

        // A missing order or customer returns SUCCESS: redelivery would reach the same conclusion,
        // so retrying it would only burn the attempt budget on a fact that will not change.
        if (order is null)
            return Result.Success();

        var contactInfo = await customerService
            .GetContactInfoByIdAsync(order.CustomerId, cancellationToken);
        if (contactInfo is null)
            return Result.Success();

        var subject = $"Payment Failed - Order #{order.Id}";
        var body = "<h2>Payment Failed</h2>" /* ... */;

        // NOT wrapped: a transport fault fails the row, and the framework's backoff retries it.
        await emailSender.SendAsync(contactInfo.Email, subject, body, isHtml: true, cancellationToken);

        return Result.Success();
    }
}
```

Two lines of judgement carry the whole failure policy, and both are written down in the source rather
than inferred. A missing order or customer returns success with a log line, because redelivery would
reach the same conclusion (`SendOrderPaymentFailedEmailInternalCommandHandler.cs:15-18,36-50`). The SMTP
call is not wrapped, so a transport fault fails the row and is retried by the framework (`:17-18,59`).
And the command's own documentation states the honest cost: delivery is at-least-once with no sent
marker kept, so a host that dies after the SMTP call re-sends once the claim lease expires
(`SendOrderPaymentFailedEmailInternalCommand.cs:9-12`).

## The expensive case: permission, timeout and a cross-replica claim

MMCA.ADC's AI session scoring is the other end of the range, and it is the case ADR-121 moved out of the
in-process channel. One pass issues one paid Anthropic call per session, so losing it is expensive and
running it twice is worse.

The command declares three interfaces rather than one (`ScoreEventSessionsInternalCommand.cs:26-27`):

```csharp
// MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/
// ScoreEventSessionsInternalCommand.cs (doc comments trimmed).
[InternalCommandName("Conference.ScoreEventSessions.v1")]
public sealed record ScoreEventSessionsInternalCommand(EventIdentifierType EventId)
    : IInternalCommand, IRequiresPermission, IHasTimeout
{
    // Safe on a deferred command because the row carries the scheduling organizer: the processor
    // restores that principal, so the gate evaluates the operator who asked, not a system principal.
    public string Permission => ConferencePermissions.SessionSelectionManage;

    // MUST stay below the handler's 15-minute distributed-lock TTL: a budget outliving the lock
    // would let the claim expire mid-pass and a second replica start a concurrent, paid pass.
    public TimeSpan Timeout => TimeSpan.FromMinutes(12);
}
```

That is the payoff of resolving the closed handler through the container. `IRequiresPermission` and
`IHasTimeout` are the ordinary markers every synchronous command uses, and they work here because the
decorator chain is the same chain.

The trigger endpoint schedules and answers `202 Accepted` unconditionally
(`SessionSelectionController.cs:108,115-117,126`), and its `[NonIdempotent]` attribute records why
caching the 202 would be wrong: it would report acceptance for a request that never reached the queue,
hiding a schedule failure the caller has to act on (`:109`).

Three pieces of handler discipline are worth copying (`ScoreEventSessionsInternalCommandHandler.cs`):

- **Lock and skip, not lock and wait.** The handler takes a per-event `IDistributedLock` claim with a
  15-minute time-to-live (`:53`) and a wait of `TimeSpan.Zero` (`:60`), and the loser logs and returns
  `Result.Success()` (`:79-83`). Queueing behind a pass already covering the same work would only pay for
  it twice.
- **A refusal is not retried, a fault is.** A `Result` failure from the pass is a business outcome (no
  sessions to score, the event is not scorable) and replaying it would pay for the same refusal again, so
  it is logged and reported as success. An exception propagates instead, and the framework's backoff and
  attempt ceiling decide how often it is replayed and when it is dead-lettered (`:22-29,87-90`).
- **Idempotent as required.** Re-running a pass rewrites the same per-session score rows rather than
  accumulating them (`:30-33`).

The command's own remarks record what it replaced and why: an in-process channel plus a five-minute
recovery sweep, where the channel was exactly as durable as the replica holding it, so a deploy or a
crash between the trigger and the last session's score left the event half scored with nothing that would
ever pick it up again (`ScoreEventSessionsInternalCommand.cs:13-19`).

## Operating it

A queue with no operator surface is a queue that gets hand-edited in production SQL.
`IInternalCommandAdministration` (`IInternalCommandAdministration.cs:17`) mirrors `IOutboxAdministration`
with four methods: `CountPendingAsync` (`:28`), `ListDeadLettersAsync` oldest first (`:42`),
`RequeueAsync` (`:63`) and `PurgeProcessedAsync` (`:80`). Every method returns `Result<T>`, because an
unknown source name or an unreachable database is an expected failure an operator screen renders, not an
exception (`:11-15`).

Three of its decisions are worth stealing outright. A requeue puts attempts back to zero and clears the
dead-letter stamp and the lease, but **keeps `LastError` on purpose**, because the reason a command failed
is the first thing anyone asks after a requeue (`:48-52`). The pending count **includes** rows whose
scheduled instant is still in the future, because they are backlog the host has accepted, not work it has
finished (`:19-23`). And the dead-letter projection, `InternalCommandDeadLetter` (`:99`), deliberately
omits the payload: it can carry personal data, and nothing an operator decides about a requeue depends on
reading it (`:86-89`).

The telemetry lands on its own meter, `MMCA.Common.InternalCommands` (`InternalCommandMetrics.cs:20`),
with three counters and two histograms and two observable gauges: `internal_commands.processed.count`
(`:38-39`), `.failed.count` (`:48-49`), `.dead_letter.count` (`:57-58`),
`internal_commands.execution.duration` (`:66-67`), `.execution.lag` (`:75-76`),
`internal_commands.pending.depth` (`:92-93`) and `internal_commands.oldest_due.age` (`:104-105`).

Lag and oldest-due-age are the two that answer the question an operator actually has. Depth tells you how
much is waiting; lag and age tell you how late it already is.

## Trade-offs, honestly

- **One migration per relational data source.** The table is in the model of every relational source
  (SQL Server, PostgreSQL and SQLite after ADR-113), so adopting the queue means
  `dotnet ef migrations add AddInternalCommands` per source, applied before deploying (`ADR-114:179-183`).
  The mapping is deliberately **not** gated on `InternalCommands:Enabled`, unlike the cron scheduler's job
  table, because a row must be able to commit in the same transaction as the aggregate change, a
  transaction does not span databases, and a flag that changed the schema would make enabling the queue a
  migration rather than a deployment decision (`:88-95`).
- **Execution is at-least-once, and it is a new obligation on ordinary commands.** A replica that dies
  after its handler committed and before the row was stamped releases the row when its lease expires, and
  the command runs again. That is the same contract the outbox already places on event handlers, so it is
  not new for anyone using the framework, but a command handler previously only ever ran once per request
  (`ADR-114:185-189`).
- **A scheduled command runs with the scheduling user's authority, not the executing host's.** That is
  what makes an `IRequiresPermission` command schedulable at all, and it means the row is a durable record
  of an authorization decision. If the user's roles change between scheduling and execution, the stored
  roles win. The record files that as deliberate (the decision was taken when the work was requested) and
  as the reason the row is under the same retention discipline as the outbox, because the payload can
  carry personal data (`ADR-114:191-197`).
- **A command scheduled inside a transaction waits up to one polling interval.** The enrolled row raises
  no signal, because a signal before the commit only buys a poll against a transaction that has not
  committed. `PollingIntervalSeconds` ships at 2, the same default the outbox ships, so the divergence is
  a deployment decision rather than a framework one: ADC and Store both run the queue at 60 seconds while
  pushing the outbox to 300 (`ADR-114:199-209`). A host that raises the interval to cut idle polling
  accepts that much latency on transaction-scheduled work.
- **Two poll loops, not one.** A host runs the outbox processor and the queue processor side by side,
  each with its own signal instance so a burst of schedules cannot consume the outbox's single pending
  wake-up. Both poll spans are suppressed from telemetry export by the same Aspire processor
  (`ADR-114:210-216`). Two loops is two idle query streams against every source, which is exactly the
  cost the 60-second production interval is paying down.
- **The duplication with the outbox is deliberate and bounded.** Extending the outbox to carry commands
  was the tempting option and it is rejected on four counts: the two rows want different columns (a
  scheduled instant, an attempt budget, a captured principal), different indexes, different retention and
  different terminal semantics for an unresolvable type, and the outbox's poll predicate is the hottest
  query the framework issues, so widening it would make every outbox change a job-queue change
  (`ADR-114:169-176`). The two processors share an idiom, not an implementation.
- **The payload is JSON, which is a real constraint on what a command can carry.** Identifiers and
  scalars round-trip; a loaded aggregate does not, and should not be attempted (`IInternalCommand.cs:19-24`).
  Everything a handler needs beyond an identifier it re-reads at execution time, which is correct anyway,
  because the world moved on between the schedule and the run.
- **Choosing between this and a channel is a per-job judgement no test enforces.** ADR-121's question
  ("would losing this item be noticed as anything more than a missed UI refresh?") is a rule a human
  applies, and getting it wrong in either direction is silent (`ADR-121:128-131,146-149`).

## Apply this even without MMCA

The mechanism ports to anything with a relational database and a background worker. Six steps, in the
order that matters:

1. **Write the job to a table inside the caller's transaction.** This is the whole design and everything
   else is detail. If your job store is a different database, a different queue or a different service,
   an enqueue beside a rollback leaves you with a job nothing justifies. One table per database that
   schedules work, written through the same connection and unit of work the aggregate change uses.
2. **Make the deferred unit the same unit you already execute.** If your application has a command or
   handler abstraction with a pipeline attached, defer *that*, and resolve the handler from the container
   at execution time so the pipeline applies. A separate job contract means validation, authorization,
   logging and transactions get re-implemented for the deferred path, in a second vocabulary, and drift
   from the first.
3. **Store the context, not just the payload.** Tenant, user id, roles, correlation id. Restore them
   before the handler runs and a deferred job stops being an anonymous system call: your logs correlate,
   your tenant filters apply, and an authorization check has a real subject. Use one restore helper for
   every background hop so they cannot diverge.
4. **Give the type a stable name, separately from the CLR type.** An attribute or a string constant. Then
   a rename is a rename, not an orphaning, and make the unresolvable case dead-letter loudly rather than
   disappear.
5. **Claim with a lease, stamp under the lease token.** A `SELECT` of due rows plus an `UPDATE` that sets
   a claim token and an expiry, then a final update guarded by that same token. That guard is what lets a
   replica that stalled past its lease drop its stale outcome instead of overwriting the new claimant's.
   Then make handlers idempotent, because a lease bounds concurrency and does not bound re-execution.
6. **Build the operator surface on day one.** Count pending, list dead letters, requeue, purge. Keep the
   error text on a requeue. Meter depth, and also lag, because depth tells you how much is waiting and lag
   tells you how late it already is. A dead-letter path with no way back into execution is production SQL
   with extra steps.

The rule of thumb: **decide what losing the work costs before you decide where to put it. Ephemeral work
on a durable queue is waste you can measure; must-run work on an ephemeral queue is a loss you cannot.**

---

**What we covered:** why a handler that wants a side effect after its commit has four mechanisms and not
one, how ADR-121's question ("would losing this be more than a missed UI refresh?") splits the ephemeral
channel from the durable queue, why an internal command is an ordinary `ICommand<Result>` resolved as a
closed handler so the whole ADR-014 decorator chain applies to a deferred run, how `ScheduleAsync` rides
the caller's unit of work so a rollback schedules nothing (and why that single property rules out
Hangfire, Quartz.NET and a cloud queue), what `InternalCommandMessage` remembers about the request that
scheduled it and how `AmbientOrigin.Restore` puts the tenant and the principal back, why
`[InternalCommandName]` makes a rename survivable and its absence loud, how the leased claim-execute-stamp
cycle and its jittered backoff bound failure, and what the administration surface and the
`MMCA.Common.InternalCommands` meter have to expose before a dead-letter path is an operational procedure
rather than a table.

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-114 behind this pattern, or
`dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision records: `Website/docs-src/adr/114-internal-commands-durable-job-queue.md` and
  `Website/docs-src/adr/121-ephemeral-in-process-work-queue.md`
- The full 34-category scorecard, §6 and §10 included, lives in
  `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 50, "The LLM is a dependency: a bounded, guarded, metered boundary for chat
completions." Next in the series: Article 52, "Finishing identity: second factor, email confirmation and
stored permission grants."*

*Tags: .NET, C Sharp, Distributed Systems, Microservices, Software Architecture*

*Notes: verified type/behavior names with path:line (all re-read this run, 2026-09-19). The three code
blocks are illustrative of the documented shape: the `SendOrderPaymentFailedEmailInternalCommand` block is
the source record with its XML doc comments removed (attribute, record and marker verbatim, from
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/SendOrderPaymentFailedEmailInternalCommand.cs:14-15`);
the handler block is condensed from that command's handler `:19-64` (the `LoggerMessage` calls and their
declarations trimmed, `ConfigureAwait(false)` and the `string.Create(CultureInfo.InvariantCulture, ...)`
wrappers elided for width, the two rationale comments shortened from `:15-18`, control flow and API calls
faithful); the `ScoreEventSessionsInternalCommand` block is condensed from
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommand.cs:25-45`
with the two XML doc blocks shortened to one-line comments.*
- *ADR-114 (`Website/docs-src/adr/114-internal-commands-durable-job-queue.md`), Accepted 2026-09-09 (`:4`),
  revised 2026-09-19 with three corrections to match the code (`:5-9`): the two existing mechanisms and
  the gap between them (outbox `:14-24`, recurring scheduler `:26-33`, the gap `:35-43`); the five parts
  of the decision (marker plus closed-handler dispatch `:51-61`, scheduling on the caller's unit of work
  `:62-75`, one unconditionally mapped table per relational source `:76-95`, context restoration
  `:96-109`, failure policy and its one divergence `:110-141`); the four rejected alternatives (Hangfire
  `:146-154`, Quartz.NET `:155-160`, a cloud queue `:161-168`, extending the outbox `:169-176`); and the
  trade-offs restated here (`:179-183`, `:185-189`, `:191-197`, `:199-209`, `:210-216`). ADR-114's own
  anchors for `InternalCommandProcessor` members sit above this run's readings (the record cites the class
  at `:50`, `ClaimDueAsync` at `:366`, `StampAsync` at `:686` and `ComputeRetryBackoffSeconds` at `:712`);
  this article cites the lines read this run.*
- *ADR-121 (`Website/docs-src/adr/121-ephemeral-in-process-work-queue.md`), Accepted 2026-09-11,
  supersedes ADR-052 (`:4`): the bounded-channel decision (`:35-44`), the `DropOldest` full mode and the
  invisible drop (`:45-56`), "work that must run does not go here" (`:105-114`), the one-question split
  with ADR-114 (`:128-131`), in-process-only (`:133-135`) and the per-job judgement (`:146-149`).*
- *Framework contracts (paths rooted at `MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/`):
  `IInternalCommand.cs:38` (marker over `ICommand<Result>`), the no-second-handler-contract rationale
  `:11-16`, the JSON payload requirement `:19-24`, the at-least-once statement `:25-29` and the
  rename-is-visible statement `:30-36`. `IInternalCommandScheduler.cs:16` with `ScheduleAsync(command,
  runAt)` `:41-44` and the `TimeSpan delay` overload `:54-57`, the `runAt` contract `:23-27`, the
  unit-of-work paragraph `:9-14`, and the enrolled-versus-saved remark `:34-40`.
  `InternalCommandNameAttribute.cs:25` (declaration), orphaning rationale `:7-10`, new-rows-only and
  uniqueness remark `:13-17`, sample `:18-21`. `IInternalCommandAdministration.cs:17` with
  `CountPendingAsync` `:28` (future rows counted, `:19-23`), `ListDeadLettersAsync` `:42`, `RequeueAsync`
  `:63` (`LastError` kept on purpose `:48-52`), `PurgeProcessedAsync` `:80`, the `Result<T>` rationale
  `:11-15`, and the `InternalCommandDeadLetter` record `:99` with its payload-omitted rationale `:86-89`.*
- *Framework infrastructure (paths rooted at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/`):
  `InternalCommandMessage.cs:21` (not an auditable entity, `:14-19`), columns `Id` `:36`, `CommandType`
  `:43`, `Payload` `:46`, `ScheduledOn` `:52`, `CreatedOn` `:55`, `ProcessedOn` `:61`, `Attempts` `:64`,
  `LastError` `:70`, `DeadLetteredOn` `:77`, `ClaimedBy` `:84`, `ClaimedUntil` `:92`, `CorrelationId`
  `:98`, `TraceId` `:101`, `SpanId` `:104`, `UserId` `:111`, `UserRoles` `:118`, `TenantId` `:124`.
  `Processing/InternalCommandProcessor.cs:47` (`BackgroundService` declaration), `PollActivityName` `:63`,
  `MaxErrorLength` 4000 `:66`, `PrincipalAuthenticationType` `:72`, `MinimumWait` 1s `:75`, `StartupDelay`
  5s `:81`, `ExecuteAsync` `:89` with the no-relational-sources exit `:93-97`, `ClaimDueAsync` `:369`,
  `ExecuteClaimedAsync` `:417` with the terminal type-unresolvable `:434` and handler-missing `:456`
  branches, `AmbientOrigin.Restore` call `:530`, `StampAsync` `:653`, `ComputeRetryBackoffSeconds` `:679`.
  `Processing/InternalCommandDispatcher.cs:21` resolving the closed handler `:75`.
  `Processing/InternalCommandMetrics.cs:20` (`MeterName` = `MMCA.Common.InternalCommands`),
  `internal_commands.processed.count` `:38-39`, `.failed.count` `:48-49`, `.dead_letter.count` `:57-58`,
  `.execution.duration` `:66-67`, `.execution.lag` `:75-76`, `.pending.depth` `:92-93`,
  `.oldest_due.age` `:104-105`. `Administration/InternalCommandsSettings.cs:15` with `SectionName` `:18`,
  `Enabled` `:27`, `BatchSize` 50 `:31`, `MaxAttempts` 5 `:39`, `PollingIntervalSeconds` 2 `:49`,
  `ProcessingDelaySeconds` 0 `:58`, `LeaseSeconds` 300 `:68`, `RetryBackoffBaseSeconds` 10 `:77`,
  `MaxRetryBackoffSeconds` 600 `:86`, `RetentionDays` 7 `:93`, `CleanupIntervalHours` 6 `:108`.*
- *MMCA.Store adoption (paths rooted at `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/`):
  `Orders/InternalCommands/SendOrderPaymentFailedEmailInternalCommand.cs:15` with
  `[InternalCommandName("Sales.SendOrderPaymentFailedEmail")]` `:14` and the at-least-once, no-sent-marker
  remark `:9-12`; its handler `Orders/InternalCommands/SendOrderPaymentFailedEmailInternalCommandHandler.cs:19`
  implementing `ICommandHandler<SendOrderPaymentFailedEmailInternalCommand, Result>` `:24`, the
  return-success-on-missing-order branch `:36-40` and missing-customer branch `:46-50`, the unwrapped
  `emailSender.SendAsync` `:59`, and the remarks stating both policies `:15-18`. Scheduled from
  `Orders/Saga/OrderPaymentFailedSagaHandler.cs:32,35` (`IInternalCommandScheduler` resolved from the
  handler's own scope, `runAt: null`), which also schedules `ExpireUnpaidOrderInternalCommand` `:79-82`.
  Other Store internal commands read this run: `Orders/InternalCommands/SendOrderShippedEmailInternalCommand.cs`,
  `Orders/InternalCommands/ExpireUnpaidOrderInternalCommand.cs` and
  `MMCA.Store.Catalog.Application/Products/InternalCommands/PublishProductVariantChangedInternalCommand.cs`.*
- *MMCA.ADC adoption (paths rooted at `MMCA.ADC/Source/Modules/Conference/`):
  `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommand.cs:26-27`
  implementing `IInternalCommand, IRequiresPermission, IHasTimeout`, `[InternalCommandName("Conference.ScoreEventSessions.v1")]`
  `:25`, `Permission` `:35` with the restored-principal rationale `:29-34`, `Timeout` 12 minutes `:44` with
  the must-stay-below-the-lock-TTL rationale `:37-43`, and the what-it-replaced remark `:13-19`. Its
  handler `.../ScoreEventSessionsInternalCommandHandler.cs:39` implementing
  `ICommandHandler<ScoreEventSessionsInternalCommand, Result>` `:44`, `ClaimTimeToLive` 15 minutes `:53`,
  `ClaimWait` `TimeSpan.Zero` `:60`, the claim `:75-77`, the claim-loser success `:79-83`, the refusal
  branch `:87-90`, and the three remarks paragraphs `:14-21` (lock and skip), `:22-29` (refusal versus
  fault) and `:30-33` (idempotent as required). Trigger endpoint
  `MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:108` (`[HttpPost("score/{eventId}")]`),
  `[NonIdempotent(...)]` `:109`, the schedule call `:115-117` and `return Accepted()` `:126`.*
- *Rubric and scorecard: §6 CQRS and Event-Driven Design criteria and red flags
  (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:229-247`); §10 Messaging and Integration
  Architecture intent, criteria and red flags (`:329-348`) at default weight 3 (`:352`). Scores:
  `Website/docs-src/governance/common-ArchitectureScorecard.md:86` (§6 at weight 2, Maturity 4,
  Implementation 9) and `:90` (§10 at weight 3, Maturity 4, Implementation 9), both from the 2026-09-19
  thirty-sixth-wave re-score at framework v1.205.0 (`:5`). Group G04 Domain and Integration Events +
  Outbox Dual-Dispatch (`Website/docs-src/onboarding/00-group-taxonomy.md:59`). Framework v1.205.0
  (`MMCA.Common/FACTS.md:14`) / 19 published packages (`FACTS.md:19`) / 136 fitness test methods across 53
  abstract bases (`FACTS.md:48`) this run; ADR index rows for ADR-114 and ADR-121 at
  `Website/docs-src/adr/README.md:126` and `:133`.*
- *Article 22 (`Article-22-live-channel-push.md`) already teaches the two lighter mechanisms this article
  frames against: the bounded channel and its drain (its "The queue is where you say what the work is
  worth" section, `:184`) and the cron scheduler (its "The sibling contract: work a clock owns" section,
  `:256`). Read only, not edited by this run.*

- Full series index: https://ivanball.github.io/writing.html
