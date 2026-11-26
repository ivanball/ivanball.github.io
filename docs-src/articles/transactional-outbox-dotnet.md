# The transactional outbox in .NET 10: never lose an event again

> Series: MMCA.Common · Article #9 (cornerstone deep-dive) · Pillar P2/P3 · Group G04 · Rubric §6,§8 ·
> ADR-003 · ADR-066 · ADR-075 · ADR-087 · ADR-100 · ADR-107 · ADR-118 · Status: grounded in `Website/docs-src/onboarding/group-04-events-outbox.md`, `MMCA.Common/CLAUDE.md`,
> `Website/docs-src/adr/003-outbox-dual-dispatch.md` and `Website/docs-src/adr/118-message-transport-library-policy.md`, re-verified against MMCA.Common v1.319.0 source (see Notes). No em dashes.

**Subtitle:** "Save to the database, then publish to the broker" is a dual write with no atomicity.
Here is the at-least-once pattern that fixes it, in one SaveChanges call.

---

There is a two-line bug hiding in a huge number of .NET services, and it looks completely reasonable:

```csharp
await _db.SaveChangesAsync();        // 1. persist the order
await _bus.Publish(orderPlaced);     // 2. tell everyone else
```

Step 1 succeeds. Step 2 fails: a network blip, a broker restart, a redeploy mid-request. Now your
database says the order exists, and the rest of your system never heard about it. Inventory is not
decremented, the confirmation email never sends, the analytics pipeline is blind to it.

This is a **dual write**: two systems updated in two steps with no shared transaction. It cannot be
made reliable by reordering the lines or adding a try/catch. Publish-then-save has the mirror problem
(you announce an order that was never saved). There is no ordering of two independent commits that is
safe.

## Why it matters

The failure is rare per request and catastrophic in aggregate. It does not show up in tests, because
tests do not kill the broker between two awaits. It shows up in production as "the data says X but the
downstream system thinks Y," weeks later, as a reconciliation ticket nobody can reproduce.

The moment you have **more than one thing that needs to know** when something happens (and in any
non-trivial system you do), you need the persist and the publish to be atomic. That is what the
transactional outbox gives you.

## The pattern: one transaction, then a separate delivery

The transactional outbox splits the problem into two phases that are each individually safe:

1. **Record intent atomically.** When you save the order, you also write the event to an
   `OutboxMessages` table **in the same database transaction**. Either both commit or neither does.
   There is no window where the order exists and the event does not.
2. **Deliver separately, with retries.** A background processor reads unprocessed rows from the outbox
   and publishes them. If publishing fails, the row stays unprocessed and is retried. Delivery is
   **at-least-once**: it may publish twice, never zero times.

The durable record (the committed outbox row) decouples "it happened" from "everyone has been told."
The broker can be down for an hour; when it comes back, the backlog drains.

## How MMCA.Common does it: you just record intent

The reason this pattern is often skipped is that wiring it by hand is tedious. In MMCA.Common it is
automatic. Your aggregate records a domain event, and the framework does the rest.

```csharp
// Inside your aggregate. You only declare that something happened:
AddDomainEvent(new InventoryAdjusted(Id, oldAvailableQuantity, AvailableQuantity));
// SaveChanges does the rest: with the outbox on, your data row and the OutboxMessage row,
// one transaction, same database as the aggregate.
```

`AddDomainEvent` lives on the aggregate base (`AuditableAggregateRootEntity`), so any aggregate can
raise events. The interesting work happens in `SaveChangesAsync`, which runs a fixed sequence:

> stamp audit fields -> stamp the tenant (when the host registers a tenant interceptor) -> capture
> domain events from the aggregates -> serialize them to `OutboxMessage`
> rows -> `base.SaveChangesAsync()` commits **data + outbox in the same transaction** -> dispatch the
> local domain events in-process -> mark their outbox rows processed.

That commit is the whole guarantee. With the outbox on (the default for a broker transport; the
in-process default is covered under ADR-100 below), the data and the outbox rows are written under one
commit, so they cannot diverge. With it off, no rows are written and every captured event, integration
events included, is dispatched in-process. The in-process dispatch is a fast path for **pure domain events** only: an
`IIntegrationEvent` still gets its outbox row, but it is deliberately not dispatched in-process, so its
row stays unprocessed and only `OutboxProcessor` publishes it through `IMessageBus` (the registered
transport decides delivery). That is what keeps an integration event broker-correct once the module is
extracted. (Source: the SaveChanges flow in `MMCA.Common/CLAUDE.md` and
`Website/docs-src/onboarding/group-04-events-outbox.md`.)

## The third participant in that sequence: the change trail

The first step of that sequence, "stamp audit fields", answers who touched a row last. It cannot
answer what changed, because the stamp is a single overwrite: a row edited nine times carries the
ninth editor and nothing else. **ADR-075** adds the missing half, and it belongs in this article
because it does not invent a mechanic, it reuses this one.

`AuditTrailSaveChangesInterceptor` is one more `SaveChangesInterceptor`, registered last: after the
audit-stamp interceptor, after the tenant interceptor when a host registers one, and after the
domain-event interceptor that writes the outbox rows. The order is load-bearing: running last is what makes the diff it captures see the final stamped values
rather than a half-populated entity. It walks the change tracker, compares each modified property's
original value against its current one, and adds one `AuditTrailEntry` row per changed property into
the same `SaveChanges` call. The history therefore commits or rolls back with the data it describes,
same transaction, same database. That is the outbox guarantee applied to a different payload: a
trail that can be committed without its data, or lost to a crash in the window after the commit, is
a hint rather than a record.

It is opt-in three times over, which is what keeps the cost proportional to the value. A host has
to call `AddAuditTrail(configuration)`, it has to set `AuditTrail:Enabled` (default `false`, and the
single switch for both recording and whether the `AuditTrailEntries` table is mapped into the model
at all), and an entity has to carry the `IAuditedEntity` marker. A host that never calls
`AddAuditTrail` resolves the interceptor as null (`GetService`, not `GetRequiredService`), so nothing
joins the pipeline and the feature costs nothing. Seven hosts across the reference apps call it
today, among them Store's Sales service, ADC's Identity service, and Helpdesk's web host.

Two details follow from what a change history is. A property marked `[Pii]` records
`PiiRedactor.RedactedToken` on both sides of the change rather than the values, redacted at capture
and never at read, since a store that by construction outlives the row it describes would otherwise
become a second copy of personal data that erasure has to chase. And `AuditTrailEntry` is
deliberately not an `IAuditableEntity`, exactly like `OutboxMessage`: no audit stamps of its own
(stamping is itself a change, so it would recurse) and no soft-delete flag (a soft-deleted audit row
is rewritten history that a query filter quietly hides). Rows are append-only and leave only through
the scheduled `AuditTrailCleanupJob` (`AuditTrail:RetentionDays`, default 90), and that job runs only
when the host also calls `AddScheduledJobs(configuration)` and sets `Scheduler:Enabled`. Without the
scheduler the trail keeps recording, nothing purges it, and the retention setting is inert.

The honest cost is that this one sits on the caller's latency path. An audited entity with twenty
changed properties writes twenty extra rows inside your transaction, which is exactly not the
beside-the-request work that the outbox drain is.

## When the commit itself is ambiguous

Everything above rests on one commit, which makes it fair to ask what happens when the commit is the
thing that fails. A commit can fail after the database has applied it but before the acknowledgement
reaches the client, so the outcome is genuinely unknown: the transaction may be durable, or it may
not.

That ambiguity is dangerous here specifically because of the outbox. SQL Server's
`EnableRetryOnFailure` execution strategy classifies most commit-phase errors (timeouts, dropped
connections) as transient and re-runs the whole operation, and against a commit that may already be
durable, that duplicates every write the operation performed, including its outbox rows. The
mechanism that guarantees you never lose an event is what makes a blind retry expensive.

So the framework takes that failure out of the retry path. `DbContextFactory.ExecuteInTransactionAsync`
captures the commit failure, returns out of the execution strategy normally, and throws
`TransactionCommitAmbiguousException` only once the strategy is done with it. The placement is
deliberate: the strategy decides retriability by walking an exception's whole inner chain, so a
wrapper thrown inside it would be unwrapped and retried anyway. Failures that are not the commit are
still retried, and each retry starts from a cleared change tracker so the previous attempt's entities
(and one duplicate outbox row per event) are not written twice.

Not being retried is only half of it; the other half is being able to see what happened. The
exception carries a per-source outcome map: `CommittedSources` (their commits already succeeded, so
those writes are durable), `AmbiguousSource` (the one commit that threw, and the only outcome nobody
can vouch for), and `RolledBackSources` (never reached, rolled back best-effort, so they wrote
nothing that survives). Its message appends the same thing in words, `Per-source outcome: committed
[...]; ambiguous [...]; rolled back [...]`, leaving out any group that is empty. This matters
because commits are sequential and independent, with no two-phase commit: a failure on the second of
two sources leaves the first durable, and that partial state is now readable straight off the
exception or the log line instead of being reconstructed by database archaeology afterwards. With a
single transactional source, which is what every production host runs today, that one source is the
ambiguous outcome and the other two groups are empty.

Recovery then belongs to the caller, and both halves of it are already in this series. A request
marked `[Idempotent]` replays safely (Article 18), and if the commit did land, whatever it wrote to
the outbox is delivered by the processor anyway. The in-process dispatch deferred by the transaction
is dropped rather than flushed, so no handler acts on state that may not exist. This is an edge case
the framework ships a named exception for, not a headline feature, but it is the honest footnote to
"that commit is the whole guarantee."

That contract has a name and a record of its own. Every transactional write in the framework funnels
through one method: `IUnitOfWork.ExecuteInTransactionAsync` is the Application-layer name for it,
`UnitOfWork` forwards straight to `DbContextFactory.ExecuteInTransactionAsync`, and the CQRS
pipeline's `TransactionalCommandDecorator` calls it for any command carrying `ITransactional`.
Running the delegate inside SQL Server's retrying execution strategy (`EnableRetryOnFailure`, up to
five retries, a ten-second maximum delay) decides six things. The whole delegate is the retriable unit,
so anything computed outside it but committed inside it is silently wrong on a second attempt. Every
attempt after the first starts from `ResetForRetry`, which calls `ChangeTracker.Clear()` on every
context, because the failed attempt's entities are still `Added` and would otherwise be inserted a
second time with a duplicate outbox row per event. A returned failed `Result` rolls back exactly like
a thrown exception, which is what a framework that mandates `Result` over exceptions owes itself. A
thrown exception, cancellation included, rolls the attempt back best-effort and rethrows the original
even when the rollback itself throws, so the strategy judges retriability on the real failure rather
than on a rollback error from a connection the fault already broke. On
a successful result, `FlushEnrolledCommandsBeforeCommitAsync` runs just before the commit: it saves
internal-command rows enrolled after the handler's last save, so they commit with the caller's
change, and it throws on any other unsaved tracked change, which rolls the unit back rather than
committing while silently discarding that change. And the deferred in-process dispatch is flushed only after the commit succeeds (`FlushDeferredAsync`) and
dropped on every other path (`DropDeferred`), exactly like the internal-command processor wake owed by
commands enrolled in the unit (released after the commit, before the flush), so an in-process handler only ever sees durable state
while the outbox carries everything that crosses a process boundary. A re-entrant call joins the
ambient transaction instead of nesting, and a Cosmos context is never enlisted at all, since
`SupportsTransactions` is false for it. **ADR-107** records that contract.

## The delivery side: OutboxProcessor

A background service, `OutboxProcessor`, drains the outbox. The details that make it production-grade:

- **It only touches its own outbox.** Under database-per-service, every relational source has its own
  `OutboxMessages` table, and the processor drains the sources its host owns. A host never races for
  another service's outbox rows. (That race was a real defect, fixed by going database-per-service;
  see ADR-006.)
- **Smart waiting, not a hot loop.** It wakes on a signal when new rows are written, and with
  `Outbox:ProcessingDelaySeconds` at its default of 0 a row is eligible as soon as it commits, so an
  integration event goes out within tens of milliseconds of the save. A host that sets a delay holds
  rows back deliberately, and when the processor sees rows that are pending but not yet eligible, it
  sleeps only until the earliest becomes eligible.
  Otherwise it sleeps the full fallback interval (default 2s locally; deployed environments set it high,
  for example 300s, to cut idle polling without adding latency). An eligibility delay is not what
  keeps the processor away from an event the saving process is still handling: on the async save path
  a local domain event's row is inserted already leased (`Outbox:LeaseSeconds`, under a fresh lock
  token), so no replica's poller claims it while the in-process dispatch runs, and a failed dispatch
  releases that lease so the processor retries promptly instead of waiting out the full lease.
- **Batches and retries.** It processes in batches of 50 and gives each message at most 5 delivery
  attempts (`Outbox:MaxRetries`) before dead-lettering it. A rejection by an open broker circuit is
  not an attempt, since that publish never left the process: it spends no retry and cannot
  dead-letter the row, which is re-leased for about the circuit's break duration plus jitter, capped
  at the lease. Delivery is at-least-once, with OpenTelemetry metrics for dead-letter tracking. Retries back off
  exponentially: attempt `n` waits `Outbox:RetryBackoffBaseSeconds * 2^(n-1)` (default base 10s),
  multiplied by a random jitter factor between 0.8 and 1.2 and then capped at the lease duration.
  The jitter is what keeps a batch that failed together (one dependency outage fails all 50 rows in
  the same instant) from retrying in lockstep and re-hammering that dependency on one shared
  schedule. The explicit backoff is also what makes the retry cadence a decision: without it, a failed
  message's claim would simply never clear, and the cadence would be an accident of the 300-second
  lease.
- **Lease-based claiming for scale-out.** Before dispatching, a replica claims its batch with an atomic
  lease (`OutboxMessage.LockedUntil`/`LockToken`, `Outbox:LeaseSeconds` default 300s); other replicas
  skip leased rows, and a replica that dies mid-batch releases its rows when the lease expires. Two
  replicas can run without double-dispatching, so correctness does not depend on `minReplicas: 1` and
  the replica count is a capacity decision (ADR-003).

The idle poll spans are deliberately suppressed from telemetry export (an `OutboxPollFilterProcessor`
in the Aspire package drops the recurring `OutboxPoll` activity), so polling does not dominate your
observability bill.

## The same code dispatches in-process and over a broker

Here is where the outbox earns its place in a framework whose whole thesis is "monolith now,
microservices later." The event you raised does not know how it will be delivered.

There is one abstraction, `IMessageBus`, with two implementations:

- `InProcessMessageBus`, used while the module lives inside the monolith. Delivery is a method call.
- `BrokerMessageBus`, used once the module is its own service. It publishes through the selected
  transport's `IBrokerPublisher`, and the transports are framework code over the vendor SDKs
  (RabbitMQ and PostgreSQL built in, Azure Service Bus and Amazon SQS in adapter packages; **ADR-118**).
  The reference apps run RabbitMQ in development and Azure Service Bus in production, selected by config.

`MessageBusSettings` selects the mode. Your aggregate code, your handler code, none of it changes when
you extract the module. The outbox is what makes that switch safe: the same durable record is drained
to an in-process handler today and to a broker tomorrow. This is the dual-dispatch design recorded in
**ADR-003**.

Which transport you get is a separate decision, and **ADR-066** records it: `MessageBus:Provider`
is a string with three built-in values (`InProcess`, `RabbitMq`, `PostgreSql`), and any other value
names a transport an adapter package registers (`AzureServiceBus` from MMCA.Common.Azure, `AmazonSqs`
from MMCA.Common.Aws; see [Cloud-neutral core, vendor adapters](cloud-neutral-vendor-adapters.md)).
The value is chosen at the deployment edge (the Aspire AppHost locally, Bicep environment variables
in production) rather than anywhere in application code. Every broker transport takes its retry,
redelivery and backpressure from one shared policy (`BrokerTransportPolicies`) over one settings
object, read by the framework receive pipeline that **ADR-118**'s native-transports amendment
records, so the products stay substitutable. ADR-066 also records the honest residual: the
production-only Azure Service Bus binding is exercised by a dedicated emulator test tier that runs on
the weekday nightly and gates deployment in both ADC and Store, so a Service-Bus-only regression
blocks the next deploy, though not the merge that introduced it.

```csharp
// One abstraction, two transports. Application code depends only on IMessageBus.
// InProcessMessageBus  -> in-monolith, method-call delivery
// BrokerMessageBus     -> extracted service, IBrokerPublisher of the selected transport (RabbitMQ dev / Azure Service Bus prod)
```

Whether there is an outbox at all is resolved from that same mode. `MessageBus:EnableOutbox` is a
`bool?` that defaults to unset, and `MessageBusSettings.IsOutboxEnabled` reads
`EnableOutbox ?? !MessageBusProviders.IsInProcess(Provider)`, character for character the rule
`IsInboxEnabled` uses two properties above it (a blank provider counts as `InProcess`). `AddInfrastructure` resolves that posture once, at
registration: on the enabled path it registers `OutboxProcessor` and `OutboxCleanupService`, and on
the disabled path it registers neither and adds `OutboxDisabledNoticeService`, which logs one startup
line naming exactly what is not running. The one combination that cannot work is refused rather than
documented: `EnsureOutboxAvailableForProvider` throws when a broker transport is paired with an
explicit `false`, because `BrokerEventBus` writes the rows and `OutboxProcessor` is the only thing
that publishes them. The `OutboxMessages` table stays mapped either way, so flipping the flag is a
restart and never a migration (**ADR-100**). The direction that costs something is the in-process
default: a monolith that wants at-least-once delivery across a crash, and an in-process test host
that asserts on outbox rows or on a retried handler, both have to say so explicitly.

```jsonc
// Unset is the default, and the transport decides:
//   InProcess        -> outbox OFF, events dispatch synchronously, no rows, no processor
//                       (one startup notice says so)
//   any broker value -> outbox ON, and an explicit false throws at registration
{
  "MessageBus": {
    "Provider": "InProcess",
    "EnableOutbox": true
  }
}
```

Application, Domain, and Shared are forbidden from referencing a transport directly: a fitness test
(`MicroserviceExtractionTests`) fails the test run if a broker SDK the transports run on
(`RabbitMQ.Client`, `Azure.Messaging.ServiceBus`, the Amazon SQS and SNS clients) or the gRPC runtime
leaks upward, and a governance test fails on any MassTransit package version at all. The reliability
pattern and the extraction boundary are the same mechanism.

## When the consumer runs out of retries

The outbox makes the publish durable. It says nothing about what happens after the broker accepts the
message, and that is the other half of delivery. The outbox's own dead-letter path (a metric, an Error
log, a retention window) covers the publish leg only. On the consume side the transports move bytes
and nothing else: every one of them (RabbitMQ, PostgreSQL, Azure Service Bus, Amazon SQS) hands each
delivery to the one framework `BrokerReceivePipeline`, and that pipeline owns the whole failure policy
(**ADR-118**, Amendment 2026-11-23).

It runs in three stages. First, in-process retry: the consumer (inbox, origin restore, handlers) runs
up to `MessageBus:RetryLimit + 1` times, each attempt in a fresh DI scope, with an exponential delay
between attempts (defaults: 5 retries, starting at 1s and doubling to a 30s cap). Second, once every
retry has failed, second-level redelivery: the pipeline asks the transport to put the message back on
the host's queue after the next `MessageBus:RedeliveryIntervalsSeconds` step (default one minute, ten
minutes, one hour), the right tool for a dependency that will come back, but not within seconds.
Third, once the redeliveries are spent too, the dead-letter: one Error log line naming the event type,
the message id and the queue, and one increment of `broker.fault.count`, tagged by `event_type` and
`queue`, on a meter named `MMCA.Common.Broker`. A delivery that no retry can fix skips straight to the
dead-letter: a body that does not deserialize, or an event name the host has no subscription for.

Because the pipeline logs and counts at the moment it dead-letters, there is no fault consumer and no
fault topic: `RegisterIntegrationEventConsumer<TEvent>()` takes no arguments, and with one queue per
host each service only ever sees its own failures. The pipeline never throws for a handler or payload
failure and never replays a dead-lettered message, deliberately: recovery logic at that point would be
a third retry policy hiding behind the two that already exist. The one exception it lets out is the
host's own cancellation, and the transport then leaves the message unacknowledged so the broker
delivers it again after the restart.

Redelivery works the same way on every transport, each through its own native mechanism: RabbitMQ
through per-interval delay queues (no plugin), PostgreSQL through the row's visibility time, Azure
Service Bus and Amazon SQS through native scheduling, with any interval longer than a transport's cap
shortened to it (Amazon SQS caps a message delay at 15 minutes). A configured list replaces the default
rather than merging with it, and `[0]` turns redelivery off. Two honest costs ride along. An event
redelivered an hour later runs its handlers an hour after the original attempt, so the consumer-side
inbox and every idempotent handler have to stay correct across that span rather than across a retry
burst. And the counter only observes: a dead-lettered message sits in the transport's dead-letter
location until a human replays or discards it. Both reference applications alert on the Service Bus
dead-letter count of their host queues, which catches every dead-letter cause rather than only the
counted one, but there is no automated replay path.

## The write that skips the whole pipeline

Everything above depends on one assumption: that writes go through `SaveChangesAsync`. There is a
write that does not, and it is worth knowing before you reach for it, because the pipeline failing
silently is the whole problem.

`ExecuteUpdate` issues set-based SQL directly. It never materializes entities, never populates the
change tracker, and therefore never runs the interceptor that stamps audit fields. A bulk update
written the obvious way updates the rows and quietly leaves `LastModifiedOn` and `LastModifiedBy`
holding whoever touched the row last, possibly years ago. Nothing throws. The rows are correct and the
audit trail is wrong, which is the worst combination, since the failure is invisible until an auditor
asks.

The framework's `IWriteRepository.ExecuteUpdateAsync` closes that hole by stamping the fields by hand:

```csharp
// ExecuteUpdate bypasses the save pipeline's audit interceptor, so stamp the
// modification audit fields here unless the caller assigned them explicitly.
if (!builder.SetsProperty(nameof(IAuditableEntity.LastModifiedOn)))
{
    var now = timeProvider.GetUtcNow().UtcDateTime;
    builder.Set(e => e.LastModifiedOn, (DateTime?)now);
}

// With no current user (a background or system scope) the editor is the default sentinel,
// exactly as the save pipeline attributes a system save; leaving the column alone would keep
// crediting the change to the previous human editor.
if (!builder.SetsProperty(nameof(IAuditableEntity.LastModifiedBy)))
{
    builder.Set(e => e.LastModifiedBy, currentUserService?.UserId ?? default);
}
```

The mechanism that makes this possible is small and reusable: rather than handing EF's setter builder
straight to the caller, the repository collects the assignments into an `UpdatePropertySetterBuilder`
first. Because the assignments are captured rather than applied immediately, the repository can ask
`SetsProperty(...)` what the caller already set, add what is missing, and only then replay everything
onto EF via `Apply`. Intercepting a fluent API is usually awkward; buffering it makes it easy.

The `unless the caller assigned them explicitly` clause matters, since a reconciliation sweep that
wants to attribute the change to a system actor rather than the current user can set the fields
itself and the repository will not overwrite them.

Two limits are worth stating plainly. This is a **set-based** write, so it raises no domain events and
writes no outbox rows, which means everything this article describes does not apply to it. That is
the correct trade for a maintenance sweep over thousands of rows and the wrong one for a business
operation, so reach for it when you are reconciling state, not when you are expressing intent. And
`ExecuteUpdate` will not be caught by the same review reflex as `SaveChanges`, so the safe default is
to route it through the repository rather than calling it on a `DbSet`.

## Trade-offs, honestly

The outbox is not free, and the rubric review of this framework names the rough edges:

- **At-least-once means duplicates are possible.** A consumer can receive the same event twice (publish
  succeeded, the "mark processed" step did not). The framework does not just
  document this, it ships a consumer-side inbox that is on by default for a broker transport:
  `IInboxStore` (`EfInboxStore` records processed messages in an `InboxMessages` table) dedups by
  `MessageId`, and `MessageBus:EnableInbox` is a `bool?` that resolves ON for any broker transport
  (RabbitMQ, PostgreSQL, Azure Service Bus, Amazon SQS) when unset. `NoOpInboxStore` is reached only through an explicit `EnableInbox=false`,
  and that opt-out logs a startup Warning rather than staying silent. The generic
  `IntegrationEventConsumer` stages the inbox row in the scope's unit of work before the handlers
  run, abandons it when a handler throws, and writes it through `CompleteAsync` once every handler
  has succeeded (**ADR-021**; every deployed service host also sets `EnableInbox: true` explicitly,
  four in ADC and three in Store). Only a handler that saves through the consumer's own scope to the
  same source commits the inbox row in its own transaction. The framework's persisting handlers do
  not take that path: they derive from `ScopedIntegrationEventHandlerBase`, which opens a scope of
  its own per delivery, so their saves never carry the staged row. The honest residual is therefore
  the common case, not a narrow one: a crash between a handler's commit and the inbox write
  redelivers the event, so handlers must still be idempotent.
- **The table grows, but it self-purges.** Processed outbox rows accumulate, and the serialized
  payloads can contain PII, so the framework ships an automatic `OutboxCleanupService` that sweeps every
  relational source and deletes processed rows whose `ProcessedOn` is older than `Outbox:RetentionDays`
  (default 7 days; set `0` to disable) on an `Outbox:CleanupIntervalHours` cadence (default 6 hours). The
  same sweep also purges dead-lettered rows (retries exhausted, never delivered) on their own
  `Outbox:DeadLetterRetentionDays` window (falling back to `RetentionDays`), so failed payloads do not
  linger in the pending index forever. The
  residual decision is yours: pick a retention window that satisfies your compliance and replay needs,
  since that setting is what decides how long PII-bearing payloads linger. This is where it intersects
  the compliance category.
- **Latency.** Delivery is near-real-time, not instant. On the happy path the post-save signal wakes
  the processor and the row publishes within tens of milliseconds (`Outbox:ProcessingDelaySeconds`
  defaults to 0), and the poll interval only paces idle polling, which is why a deployed host can set
  it to 300s. The latency cost lives on the failure paths: a failed publish waits out its exponential
  backoff, and a failed consume walks through in-process retries and then redeliveries a minute, ten
  minutes and an hour apart. That is the correct trade for durability, but size the backoff and the
  redelivery intervals for your workload.
- **It is per-source and best-effort sequential.** There is no two-phase commit across sources; the
  outbox is the cross-source consistency mechanism, not distributed transactions.

None of these are reasons to skip it. They are the reasons to configure it deliberately.

## Apply this even without MMCA

The idea ports to any stack:

1. Write the event row in the **same transaction** as the state change. If your ORM cannot do that,
   you do not have an outbox, you have a hopeful second write.
2. Drain it with a **separate** worker that retries on failure and marks rows processed only after a
   confirmed publish.
3. Make consumers **idempotent**, because at-least-once will eventually deliver a duplicate.
4. Give the table a **retention policy** before it becomes a compliance problem.

The rule of thumb is the takeaway: **if you ever persist and publish in two steps, you have a
consistency bug. Make it one step.**

---

**What we covered:** why "save then publish" loses messages, how the transactional outbox makes the
persist and the publish atomic, how MMCA.Common automates it through `SaveChanges` + `OutboxProcessor`,
and why the same mechanism powers both in-process dispatch and broker delivery.

**Next in the series:** Database-per-service inside a monolith, the design the outbox quietly depends on.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-003 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-003 (outbox dual-dispatch): `Website/docs-src/adr/003-outbox-dual-dispatch.md` in the docs site.

*Tags: .NET, C Sharp, Microservices, Distributed Systems, Software Architecture*

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/CHANGELOG.md:7`), the
`/update-medium` audit of 2026-11-25 (findings `09-transactional-outbox-dotnet`, verdict
Needs-structural-change); every changed claim below was re-read in source this run. Paths are under
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/` unless stated. Changes in this pass:
(1) Transport. MassTransit left MMCA.Common in v1.316.0 (`MMCA.Common/CHANGELOG.md:53`). The
`BrokerMessageBus` bullet and the snippet comment named a MassTransit-backed broker; the bus publishes
through the selected transport's `IBrokerPublisher` (`Messaging/BrokerMessageBus.cs:13-18`), and the
transports are framework code over the vendor SDKs (`Website/docs-src/adr/118-message-transport-library-policy.md`
status `:22-26`, Amendment (2026-11-23) `:494-529`). (2) The consume-side section is rewritten around
`BrokerReceivePipeline` (`Messaging/Consumers/BrokerReceivePipeline.cs` class summary `:12-24`,
`ProcessAsync` `:82-105`, immediate dead-letter for an unknown event or a poison body `:107-146`,
`AfterRetriesExhausted` `:156-177` with the counter tags `event_type` and `queue` at `:171-174`, retry
loop `:184-200`) and `BrokerMetrics.FaultCounter` (`Messaging/BrokerMetrics.cs:26-33`, `MeterName`
`:21`). `FaultIntegrationEventConsumer` no longer exists in MMCA.Common/Source; the consumer builder
registers no fault consumer (`Messaging/Broker/IBrokerConsumerBuilder.cs:11-13`) and
`RegisterIntegrationEventConsumer<TEvent>()` takes no parameter (`:26`). Retry settings:
`Messaging/MessageBusSettings.cs` `RetryLimit` 5 `:94`, `RetryMinIntervalSeconds` 1 `:101`,
`RetryMaxIntervalSeconds` 30 `:107`, doubling doc `:97-98`; redelivery default `[60, 600, 3600]`
`:190`, replace-not-merge and `[0]` as the off switch `:196-198`, the SQS 15-minute cap `:199-201`,
the per-transport mechanism (RabbitMQ delay queues, no plugin) `:207-211`. `EnableDelayedRedelivery`
does not exist. (3) The "no alert wired" clause: both apps declare `brokerDeadLetterAlert` on the
Service Bus `DeadletteredMessages` metric (`MMCA.ADC/infra/main.bicep:778`, metric `:797`;
`MMCA.Store/infra/main.bicep:563`); the "no automated replay" half stands. (4) Fitness test:
`ArchitectureRules.TransportDependencies` lists MassTransit, RabbitMQ.Client,
Azure.Messaging.ServiceBus, Amazon.SQS, Amazon.SimpleNotificationService, Grpc and Google.Protobuf
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:14-23`,
doc `:5-13`), asserted by `MicroserviceExtractionTestsBase.CoreLayers_ShouldNotDependOn_Transport`
(`Bases/Layering/MicroserviceExtractionTestsBase.cs:14`), plus
`DependencyVersionTestsBase.MassTransit_MustNotBeReferenced` (`Bases/Governance/DependencyVersionTestsBase.cs:13-18`);
"fails the build" became "fails the test run". (5) `Outbox:ProcessingDelaySeconds` defaults to 0
(`Persistence/Outbox/Administration/OutboxSettings.cs:45`, doc `:33-43`; v1.306.0 at
`MMCA.Common/CHANGELOG.md:312`, `:320`); the smart-waiting bullet and the latency bullet are rewritten
(polling doc `OutboxSettings.cs:23-31`). (6) An open circuit spends no retry
(`Persistence/Outbox/Processing/OutboxProcessor.cs:636-645`, re-lease `:658-661`,
`Persistence/Polling/PollingLoop.cs` `ComputeCircuitOpenBackoffSeconds` `:219`; v1.282.0 at
`CHANGELOG.md:759`, `:779`; ADR-087 Revision 2026-11-08 at `:17`). (7) The inbox resolves ON for any
broker transport (`MessageBusSettings.cs:117-119`, `IsInboxEnabled` `:142`). (8) Header: ADR-118
added, the ADR-118 file added to the grounding, stamp moved to v1.319.0 from the 2026-10-29 pass.
Re-read this run behind unchanged prose: `OutboxSettings.cs` `BatchSize` 50 `:17`, `MaxRetries` 5
`:21`, `PollingIntervalSeconds` 2 `:31`, `RetentionDays` 7 `:70`, `CleanupIntervalHours` 6 `:78`,
`LeaseSeconds` 300 `:90`, `RetryBackoffBaseSeconds` 10 `:107`, `DeadLetterRetentionDays` `:118`;
`OutboxProcessor.cs` `ClaimEligibleAsync` declared `:348` (invoked `:235`), `RetryCount++` `:644`,
dead-letter at `RetryCount >= MaxRetries` `:681`, `ComputeRetryBackoffSeconds` `:1107-1108` delegating
to `PollingLoop.cs:197` (jitter `NextJitter` `:223`); `MessageBusSettings.cs` `Provider` string `:25`,
`EnableInbox` `:134`, `EnableOutbox` `:172`, `IsOutboxEnabled` `:180`;
`Messaging/Transports/MessageBusProviders.cs` `InProcess` `:16`, `RabbitMq` `:19`, `PostgreSql` `:27`,
`IsInProcess` `:44`; `Messaging/Transports/BrokerTransportPolicies.cs` `RetryDelay` `:27`,
`BuildRedeliveryIntervals` `:65`, `ResolvePrefetchCount` `:85`, `ResolveConcurrentMessageLimit` `:98`;
`DependencyInjection.cs` guard `:258`, enabled registration `:260-262`, `OutboxDisabledNoticeService`
`:267`; `DependencyInjection.Messaging.cs` `EnsureOutboxAvailableForProvider` declared `:248` (call
`:80`), `EfInboxStore` `:134`, `NoOpInboxStore` `:142`; `Messaging/Consumers/IntegrationEventConsumer.cs`
`TryBeginAsync` `:93`, `Abandon` `:113`, `CompleteAsync` `:134`;
`Persistence/DbContexts/Factory/DbContextFactory.cs` `ExecuteInTransactionAsync` `:578`,
`strategy.ExecuteAsync` `:605`, `FlushEnrolledCommandsBeforeCommitAsync` call `:652`;
`Persistence/DbContexts/ApplicationDbContext.cs` audit interceptor resolved `:385`; the seven
`AddAuditTrail` hosts: `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:105`, Catalog
`:93`, Identity `:101`; `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:220`,
Conference `:295`, Engagement `:122`; `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:104`;
`InventoryAdjusted` raised at `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Inventory/InventoryItem.cs:195`;
the ADC Service Bus emulator tier (`MMCA.ADC/.github/workflows/cross-service-tests.yml:148`, run in
`deploy.yml:1013`). Carried without a line re-read this run (prose unchanged, confirmed by the audit):
`TransactionCommitAmbiguousException.cs`, `SQLServerDbContext.cs` (`EnableRetryOnFailure`, 5 retries,
10s), the rest of `DbContextFactory.cs` (`ResetForRetry`, `TryCommit`, best-effort rollback,
`SupportsTransactions`), `UnitOfWork.cs`, `TransactionalCommandDecorator.cs`,
`EFRepository.ExecuteUpdateAsync` (the snippet) and `UpdatePropertySetterBuilder.cs`,
`AuditTrailSettings.cs`, `AuditTrailSaveChangesInterceptor.cs`, `PiiRedactor.cs`,
`OutboxCleanupService.cs`, `ScopedIntegrationEventHandlerBase.cs`, and the paragraph-level anchors into
ADR-003, ADR-021, ADR-075, ADR-100 and ADR-107.
Flag (2026-11-25): ADR-087 (`Website/docs-src/adr/087-broker-poison-message-handling.md`, Context
`:21-49`) and ADR-066 (`066-broker-transport-selection.md:47`, `:103`, `:144`, and its later
sections) still describe MassTransit (the fault consumer, the delayed-message plugin, MassTransit v8
transports), and none of their revisions records the native-transport rewrite. The article cites
ADR-118's Amendment (2026-11-23) for the transport and the consume-side policy, and keeps ADR-087 in
the header for the publish-side circuit breaker and ADR-066 for provider selection, both of which
still match source; reconciling the two ADRs is owed to `/update-adrs`.
Verifier fixes (2026-11-25): the shared-policy sentence in the transport-selection paragraph cites
ADR-118's Amendment (2026-11-23) (`Website/docs-src/adr/118-message-transport-library-policy.md:514-516`)
instead of ADR-066, whose only mention (`066-broker-transport-selection.md:170`) names a MassTransit-era
`ApplyReceivePolicies` member that source no longer has (`BrokerTransportPolicies.cs:16`, `:27`, `:52`,
`:65`, `:85`, `:98`, under `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/`;
the class comment `:4-5` states the receive pipeline and every transport read it).
Section history: "The write that skips the whole pipeline" added 2026-07-27; "When the commit itself
is ambiguous" 2026-08-01, its per-source outcome paragraph 2026-08-15; the transport-selection
paragraph 2026-08-07; "The third participant in that sequence: the change trail" 2026-08-14; "When the
consumer runs out of retries" 2026-08-19, rewritten 2026-11-25 for the native transports; the
outbox-posture and transaction-contract paragraphs 2026-09-19. Prior passes: 2026-10-29 (the v1.265 line),
2026-10-22 (v1.250.0), 2026-10-08 (v1.233.0), 2026-10-02 (v1.221.0); their line anchors are
superseded by the ones above and their change records live in this file's Website git history.*

- Full series index: https://ivanball.github.io/writing.html
