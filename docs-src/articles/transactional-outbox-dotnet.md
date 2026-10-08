# The transactional outbox in .NET 10: never lose an event again

> Series: MMCA.Common · Article #9 (cornerstone deep-dive) · Pillar P2/P3 · Group G04 · Rubric §6,§8 ·
> ADR-003 · ADR-066 · ADR-075 · ADR-087 · ADR-100 · ADR-107 · Status: grounded in `Website/docs-src/onboarding/group-04-events-outbox.md`, `MMCA.Common/CLAUDE.md`,
> and `Website/docs-src/adr/003-outbox-dual-dispatch.md`, re-verified against MMCA.Common v1.233.0 source (see Notes). No em dashes.

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
// SaveChanges does the rest: your data row and the OutboxMessage row,
// one transaction, same database as the aggregate.
```

`AddDomainEvent` lives on the aggregate base (`AuditableAggregateRootEntity`), so any aggregate can
raise events. The interesting work happens in `SaveChangesAsync`, which runs a fixed sequence:

> stamp audit fields -> stamp the tenant (when the host registers a tenant interceptor) -> capture
> domain events from the aggregates -> serialize them to `OutboxMessage`
> rows -> `base.SaveChangesAsync()` commits **data + outbox in the same transaction** -> dispatch the
> local domain events in-process -> mark their outbox rows processed.

That commit is the whole guarantee. The data and the outbox rows are written under one commit, so they
cannot diverge. The in-process dispatch is a fast path for **pure domain events** only: an
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
Running the delegate inside SQL Server's retrying execution strategy (`EnableRetryOnFailure`, five
attempts, a ten-second maximum delay) decides five things. The whole delegate is the retriable unit,
so anything computed outside it but committed inside it is silently wrong on a second attempt. Every
attempt after the first starts from `ResetForRetry`, which calls `ChangeTracker.Clear()` on every
context, because the failed attempt's entities are still `Added` and would otherwise be inserted a
second time with a duplicate outbox row per event. A returned failed `Result` rolls back exactly like
a thrown exception, which is what a framework that mandates `Result` over exceptions owes itself. On
a successful result, `FlushEnrolledCommandsBeforeCommitAsync` runs just before the commit: it saves
internal-command rows enrolled after the handler's last save, so they commit with the caller's
change, and it throws on any other unsaved tracked change, which rolls the unit back rather than
committing while silently discarding that change. And the deferred in-process dispatch is flushed only after the commit succeeds (`FlushDeferredAsync`) and
dropped on every other path (`DropDeferred`), so an in-process handler only ever sees durable state
while the outbox carries everything that crosses a process boundary. A re-entrant call joins the
ambient transaction instead of nesting, and a Cosmos context is never enlisted at all, since
`SupportsTransactions` is false for it. **ADR-107** records that contract.

## The delivery side: OutboxProcessor

A background service, `OutboxProcessor`, drains the outbox. The details that make it production-grade:

- **It only touches its own outbox.** Under database-per-service, every relational source has its own
  `OutboxMessages` table, and the processor drains the sources its host owns. A host never races for
  another service's outbox rows. (That race was a real defect, fixed by going database-per-service;
  see ADR-006.)
- **Smart waiting, not a hot loop.** It wakes on a signal when new rows are written. When it sees rows
  that are pending but not yet eligible (messages become eligible a few seconds after creation, default
  5s), it sleeps only until the earliest becomes eligible.
  Otherwise it sleeps the full fallback interval (default 2s locally; deployed environments set it high,
  for example 300s, to cut idle polling without adding latency). The eligibility delay is not what
  keeps the processor away from an event the saving process is still handling: on the async save path
  a local domain event's row is inserted already leased (`Outbox:LeaseSeconds`, under a fresh lock
  token), so no replica's poller claims it while the in-process dispatch runs, and a failed dispatch
  releases that lease so the processor retries promptly instead of waiting out the full lease.
- **Batches and retries.** It processes in batches of 50 and retries a failed message up to 5 times,
  with at-least-once delivery and OpenTelemetry metrics for dead-letter tracking. Retries back off
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
- `BrokerMessageBus`, used once the module is its own service. Delivery is over a MassTransit-backed
  broker (RabbitMQ in development, Azure Service Bus in production), selected by config.

`MessageBusSettings` selects the mode. Your aggregate code, your handler code, none of it changes when
you extract the module. The outbox is what makes that switch safe: the same durable record is drained
to an in-process handler today and to a broker tomorrow. This is the dual-dispatch design recorded in
**ADR-003**.

Which transport you get is a separate decision, and **ADR-066** records it: `MessageBusProvider`
has exactly three values (`InProcess`, `RabbitMq`, `AzureServiceBus`), chosen at the deployment edge
(the Aspire AppHost locally, Bicep environment variables in production) rather than anywhere in
application code, and both broker branches are configured from one settings object with the same
exponential retry, so the two products stay substitutable. It also records the honest residual: the
production-only Azure Service Bus binding is exercised by a dedicated emulator test tier that runs on
the weekday nightly and gates deployment in both ADC and Store, so a Service-Bus-only regression
blocks the next deploy, though not the merge that introduced it.

```csharp
// One abstraction, two transports. Application code depends only on IMessageBus.
// InProcessMessageBus  -> in-monolith, method-call delivery
// BrokerMessageBus     -> extracted service, MassTransit broker (RabbitMQ dev / Azure Service Bus prod)
```

Whether there is an outbox at all is resolved from that same mode. `MessageBus:EnableOutbox` is a
`bool?` that defaults to unset, and `MessageBusSettings.IsOutboxEnabled` reads
`EnableOutbox ?? Provider != MessageBusProvider.InProcess`, character for character the rule
`IsInboxEnabled` uses two properties above it. `AddInfrastructure` resolves that posture once, at
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
//   InProcess                  -> outbox OFF, events dispatch synchronously, no rows, no services
//   RabbitMq / AzureServiceBus -> outbox ON, and an explicit false throws at registration
{
  "MessageBus": {
    "Provider": "InProcess",
    "EnableOutbox": true
  }
}
```

Application, Domain, and Shared are forbidden from referencing MassTransit directly; a fitness test
(`MicroserviceExtractionTests`) fails the build if the transport leaks upward. The reliability pattern
and the extraction boundary are the same mechanism.

## When the consumer runs out of retries

The outbox makes the publish durable. It says nothing about what happens after the broker accepts the
message, and that is the other half of delivery. MassTransit applies its own retry policy on the
consume side, and when those retries are spent it moves the message to the transport's error queue and
the consumer moves on. That is correct behavior, and until **ADR-087** it was also silent: the outbox's
own dead-letter path is loud (a metric, an Error log, a retention window), but it covers the publish leg
only. An event that left the outbox successfully and then failed every consume attempt produced no
counter and no log line in any of our meters.

`FaultIntegrationEventConsumer<TEvent>` closes that. It consumes `Fault<TEvent>`, the message
MassTransit publishes when a consumer's retries are exhausted, and it does exactly two things: it writes
one Error log line naming the event type and the faulted message id (the broker's own message id when
MassTransit captured one, the fault id otherwise, since one of the two is always what an operator pastes
into a queue browser), and it increments `broker.fault.count`, tagged by event type, on a meter named
`MMCA.Common.Broker`. It never throws and never replays the failed message, deliberately: a fault
consumer that tried to recover would be a third retry policy hiding behind the two that already exist.
Registration is automatic, because `RegisterIntegrationEventConsumer<TEvent>` adds it by default, so
opting out is a visible `false` at one call site rather than a setting that silently disarms every
consumer in a service.

The other half of ADR-087 is not symmetric across transports. Second-level redelivery (reschedule the
message minutes or hours later instead of retrying it immediately) is the right tool for a dependency
that will come back, but not within seconds, and `MessageBus:EnableDelayedRedelivery` defaults to off.
RabbitMQ consults that flag, because the feature needs the `rabbitmq_delayed_message_exchange` plugin
that the Aspire development container does not ship, and a default-on setting would fail every
developer's first run at bus start. Azure Service Bus ignores the flag and always applies the intervals
(default one minute, ten minutes, one hour), because it schedules natively and has no plugin to be
missing. Two honest costs ride along. The RabbitMQ deployment is the shape most likely to be running
without second-level redelivery, and nothing warns it. And an event redelivered an hour later runs its
handlers an hour after the original attempt, so the consumer-side inbox and every idempotent handler
have to stay correct across that span rather than across a retry burst. The counter itself only
observes: a fault means a message is sitting in the error queue until a human acts on it, with no alert
wired to it and no automated replay path.

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
  `MessageId`, and `MessageBus:EnableInbox` is a `bool?` that resolves ON for RabbitMQ and Azure
  Service Bus when unset. `NoOpInboxStore` is reached only through an explicit `EnableInbox=false`,
  and that opt-out logs a startup Warning rather than staying silent. The generic
  `IntegrationEventConsumer` stages the inbox row in the scope's unit of work before the handlers
  run and abandons it when a handler throws, so a handler that saves to the same source commits the
  inbox row in its own transaction (**ADR-021**; every deployed service host also sets
  `EnableInbox: true` explicitly, four in ADC and three in Store). The honest residual is narrower:
  the duplicate window stays open for a handler that writes nothing or writes to a different source,
  so handlers must still be idempotent for that case.
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
- **Latency.** Eligibility delay plus poll interval means delivery is near-real-time, not instant. That
  is the correct trade for durability, but size the intervals for your workload.
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

*Notes: 2026-10-08 re-verification pass against MMCA.Common v1.233.0 (findings
`Docs/Planning/Quality/medium-apply-2026-10-08/09-transactional-outbox-dotnet.json`). Changes in this
pass: the smart-waiting bullet credited the 5s processing delay with letting the in-process handler
run first; v1.233.0 (`MMCA.Common/CHANGELOG.md:26`, release header `:13`) inserts async-path local
domain-event rows already leased under a fresh lock token, so the bullet now names the lease as what
keeps the poller off the row and the failed-dispatch lease release as what makes the retry prompt
(`Persistence/Outbox/Administration/OutboxSettings.cs` `ProcessingDelaySeconds` 5 `:41`, "does not
bound the duplicate-dispatch window" doc `:34-38`; `Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs`
class remarks `:17-23`, lease field `:66`, lease stamped `:310-311` from `:314-316`; ADR-003 Status
revision 2026-10-07 `:34-36` and the processing-delay rationale `:54`). The illustrative snippet raised
`ProductVariantChanged(Id, newPrice)`, an invented two-argument shape of what is really an integration
event (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IntegrationEvents/ProductVariantChanged.cs:34`,
`BaseIntegrationEvent` `:41`), which is exactly the case the article says is not dispatched
in-process; it now shows a real pure domain event raised by a real aggregate,
`InventoryAdjusted(Id, oldAvailableQuantity, AvailableQuantity)` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Inventory/InventoryItem.cs:172`;
`Inventory/DomainEvents/InventoryAdjusted.cs:6-10`, `BaseDomainEvent`). Header stamp v1.221.0 to
v1.233.0. Re-read on 2026-10-08 and corrected in place below where they moved: `OutboxSettings.cs`,
`DbContextFactory.cs`, `UnitOfWork.cs`, `DomainEventSaveChangesInterceptor.cs`, `OutboxProcessor.cs`,
`EFRepository.cs`, `IntegrationEventConsumer.cs`, `DependencyInjection.cs`,
`DependencyInjection.Messaging.cs` and every `AddAuditTrail` call site (still seven hosts; ADC's
three moved). Re-read and unchanged: the `MessageBusSettings.cs` anchors, `PollingLoop.cs`,
`TransactionCommitAmbiguousException.cs`, `SQLServerDbContext.cs`. Everything else below is carried
from the 2026-10-02 pass, not re-read in this one. `EFRepository.ExecuteUpdateAsync` also calls
`StampRowVersion(builder)` (`:157`, declared `:168`) after the audit block; the article's block stops
before it and stays accurate. Prior pass:
2026-10-02 against MMCA.Common v1.221.0 (audit findings `Reports/update-medium/2026-10-02/09.json`).
Section history: "The write that skips the whole
pipeline" was added 2026-07-27 (the set-based-write audit-field trap was taught only inside Article
49's reconciliation section, and it lives here because this article teaches the `SaveChangesAsync`
sequence whose first step is "stamp audit fields"); "When the commit itself is ambiguous" 2026-08-01,
its per-source outcome paragraph 2026-08-15 (MMCA.Common PR #248); the transport-selection paragraph
2026-08-07; "The third participant in that sequence: the change trail" 2026-08-14; "When the
consumer runs out of retries" 2026-08-19; the outbox-posture and transaction-contract paragraphs
2026-09-19. Changes in the 2026-10-02 pass: the inbox bullet described an opt-in inbox with `NoOpInboxStore`
as the default, a check-before/record-after consumer and "five service hosts"; it now teaches the
broker default-ON inbox, the staged row and the seven explicit `EnableInbox: true` hosts (ADR-021
Revision 2026-08-26). The ADR-066 emulator tier read "nightly and non-gating"; it is deploy-gating
since the 2026-09-01 revision. The audit trail gained its third gate (`AuditTrail:Enabled`) and the
scheduler dependency of its retention purge; the interceptor paragraph and the SaveChanges sequence
gained the optional tenant step. The ADR-107 contract decides five things after its 2026-10-01
revision (`FlushEnrolledCommandsBeforeCommitAsync`). The set-based-write block lost the
`?? TimeProvider.System` fallback and now also shows the `LastModifiedBy` stamp. "One property above
it" corrected to two. Anchors (paths under
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/` unless stated). Outbox posture
(`Website/docs-src/adr/100-outbox-opt-in-resolved-from-messaging-mode.md`, Accepted 2026-08-29 at
`:4`, Decision item 1 at `:41-47`, the in-process default trade-off at `:113-118`):
`Messaging/MessageBusSettings.cs` `EnableInbox` `bool?` `:133` (broker-ON doc `:115-124`,
explicit-false Warning doc `:127-130`), `IsInboxEnabled` `:141`, `EnableOutbox` `bool?` `:167` (doc
`:143-166`, the monolith's explicit `true` at `:159-161`), `IsOutboxEnabled` `:175`. The in-process
test-host clause follows from that rule (an `InProcess` host with `EnableOutbox` unset resolves OFF
at `:175` and writes no rows); ADR-100 carries no test-host text, so it is no longer attributed to
ADR-100's own wording. `DependencyInjection.cs`: `IOutboxSignal` `:206`, transport-decision comment
`:208-213`, guard call `:216`, enabled registration `:218-222`, disabled `:223-226`.
`DependencyInjection.Messaging.cs`: `EnsureOutboxAvailableForProvider` declared `:202`, guard `:204`,
throw `:206-207`, doc `:184-197`, second call site `:60`; `EfInboxStore` registered when
`IsInboxEnabled` `:108-110`, `NoOpInboxStore` on an explicit false `:116-118` with the Warning comment
`:120-122`. Inbox consume path: `Messaging/Consumers/IntegrationEventConsumer.cs` stages the row via
`TryBeginAsync` (`:82`) and calls `Abandon` on a handler failure (`:102`) before rethrowing
(`:109`). ADR-021 (`Website/docs-src/adr/021-consumer-inbox-idempotency.md`): Status revisions
`:4-11`, opt-in superseded `:53-55`, check-before superseded `:60-62`, window narrowed `:76-79`,
explicit `EnableInbox: true` on four ADC and three Store service hosts `:81-87` (Store Sales
`appsettings.json:58` re-read), five of seven consuming from the broker `:96-97`. Audit trail:
`Persistence/AuditTrail/AuditTrailSettings.cs` single-gate remarks `:11-14`, `Enabled` default false
`:26`, `RetentionDays` 90 `:38` (`[Range(1, 3650)]` `:37`), scheduler dependency `:33-35`;
`DependencyInjection.Jobs.cs` registration-is-not-enabling `:89-92`, retention needs the scheduler
`:97-101`; `MMCA.Common.Domain/Interfaces/IAuditedEntity.cs:24`. Interceptor order in
`Persistence/DbContexts/ApplicationDbContext.cs`: audit and domain-event interceptors resolved
`:297-298`, the tenant interceptor between them when registered `:305-308` (otherwise `:311`), the
trail last through `GetService` `:319-322` (comment `:314-318`). `AddAuditTrail` call sites:
`MMCA.Store` Sales `Program.cs:208`, Catalog `:233`, Identity `:195`; `MMCA.ADC` Identity
`Program.cs:249`, Conference `:356`, Engagement `:202`; `MMCA.Helpdesk`
`Source/Hosts/MMCA.Helpdesk.Web/Program.cs:90`. Transaction contract
(`Website/docs-src/adr/107-transaction-execution-contract.md`, Accepted 2026-09-03 at `:4`, revised
2026-09-25 `:5-8` and 2026-10-01 `:9-11`): Decision `:39-42`, re-entrant join `:50-58`, retriable
unit and `ResetForRetry` `:60-68`, failed-Result rollback and the enrolled-command flush `:70-80`,
commit never retried `:82-89`, per-source outcome `:91-98`, best-effort rollback `:100-104`, deferred
flush and drop `:106-110`, Revision `:202`. Source:
`MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:63`;
`Persistence/UnitOfWork.cs:91-94`; `MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs`
class `:22`, `ITransactional` check `:30`, call `:33`. `Persistence/DbContexts/Factory/DbContextFactory.cs`:
`ExecuteInTransactionAsync` `:551`, `strategy.ExecuteAsync` `:578`, `ResetForRetry` call `:581`
(declared `:836`, `ChangeTracker.Clear()` `:841`), failed `Result` `:615` with `RollbackTransaction`
call `:620` (declared `:484`), `FlushEnrolledCommandsBeforeCommitAsync` call `:625` (declared `:681`,
throw `:698-704`, save `:706`), `TryCommit` call `:627` (declared `:719`), `FlushDeferredAsync` call
`:641`, `AbandonAfterCommitFailure` call `:743` (declared `:760`), rethrow past the strategy
`:592-593` with the inner-chain comment `:588-591`, `SupportsTransactions` `:860-861`
(`Engine.Capabilities.IsRelational`, false for Cosmos);
`Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs` `FlushDeferredAsync` `:160`,
`DropDeferred` `:177`. Delivery side: `Persistence/Outbox/Processing/OutboxProcessor.cs`
`ClaimEligibleAsync` declared `:333`, invoked `:221`; `ComputeRetryBackoffSeconds` `:865-866`
(delegating to `Persistence/Polling/PollingLoop.cs:183`, jitter `0.8 + NextDouble() * 0.4` at
`:193`), applied `:547` and `:845`. Consume-side faults: `RegisterIntegrationEventConsumer<TEvent>`
(`Messaging/Consumers/IntegrationEventConsumerExtensions.cs:60`), `bool registerFaultConsumer = true`
(`:61`), guard `:71`, the same opt-out on the sibling overloads (`:124`/`:134`, `:159-160`).
Set-based write: the block is verbatim from `Persistence/Repositories/EFRepository.cs:141-155` inside
`ExecuteUpdateAsync`, empty-assignment guard `:138-139`, `Entities.Where(where).ExecuteUpdateAsync(builder.Apply, ...)`
replay `:159`. Re-read 2026-10-08:
`Persistence/Outbox/Administration/OutboxSettings.cs` (`RetentionDays` 7 `:66`, `0` disables;
`CleanupIntervalHours` 6 `:74`; `LeaseSeconds` 300 `:85`, `[Range(10, 3600)]` `:84`;
`RetryBackoffBaseSeconds` 10 `:102`, `[Range(1, 3600)]` `:101`; `DeadLetterRetentionDays` fallback
`:111`, doc `:104-109`). Confirmed by the 2026-10-02 audit, with the `TransactionCommitAmbiguousException.cs`,
`SQLServerDbContext.cs`, `MessageBusSettings.cs` and `PollingLoop.cs` anchors re-read unchanged on 2026-10-08: `OutboxDisabledNoticeService.cs:22` (restore path `:35-38`),
`TransactionCommitAmbiguousException.cs` (sealed `:22`, `CommittedSources` `:76`, `AmbiguousSource`
`:85`, `RolledBackSources` `:93`, `ComposeMessage` `:99`), `Persistence/DbContexts/SQLServerDbContext.cs:63-66`
(`EnableRetryOnFailure`, 5 retries, 10s), `MessageBusProvider` (`Messaging/MessageBusSettings.cs:236`,
`InProcess` `:241`, `RabbitMq` `:246`, `AzureServiceBus` `:251`), `EnableDelayedRedelivery` `:195`,
`RedeliveryIntervalsSeconds` `[60, 600, 3600]` `:211`, `FaultIntegrationEventConsumer.cs`
(`:26`, id `:39`, `LogFault` `:48` declared `:58`, counter `:50`) and `Messaging/BrokerMetrics.cs`
(`broker.fault.count` `:30`, `MeterName` `:21`, `Meter` `:23`, class `:18`). ADR-066
(`Website/docs-src/adr/066-broker-transport-selection.md`): the 2026-09-01 revision `:6-10`, both
emulator jobs authoritative and deploy-gating `:161-172`, the nightly-not-per-commit trade-off
`:213-222`. Carried without line anchors: `Persistence/Repositories/UpdatePropertySetterBuilder.cs`,
the internals of `OutboxCleanupService.cs`, `AuditTrailSaveChangesInterceptor.cs`,
`AuditTrailEntry.cs`, `MMCA.Common.Domain/Privacy/PiiRedactor.cs`, the inbox stores under
`Persistence/Inbox/`, `InboxDisabledWarningService.cs`, `DbContextFactoryCommitAmbiguityTests.cs`,
and paragraph-level anchors into ADR-003, ADR-075 and ADR-087.*

- Full series index: https://ivanball.github.io/writing.html
