# The transactional outbox in .NET 10: never lose an event again

> Series: MMCA.Common · Article #9 (cornerstone deep-dive) · Pillar P2/P3 · Group G04 · Rubric §6,§8 ·
> ADR-003 · ADR-066 · ADR-075 · ADR-087 · ADR-100 · ADR-107 · Status: grounded in `Website/docs-src/onboarding/group-04-events-outbox.md`, `MMCA.Common/CLAUDE.md`,
> and `Website/docs-src/adr/003-outbox-dual-dispatch.md`. No em dashes.

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
AddDomainEvent(new ProductVariantChanged(Id, newPrice));
// SaveChanges does the rest: your data row and the OutboxMessage row,
// one transaction, same database as the aggregate.
```

`AddDomainEvent` lives on the aggregate base (`AuditableAggregateRootEntity`), so any aggregate can
raise events. The interesting work happens in `SaveChangesAsync`, which runs a fixed sequence:

> stamp audit fields -> capture domain events from the aggregates -> serialize them to `OutboxMessage`
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

`AuditTrailSaveChangesInterceptor` is a third `SaveChangesInterceptor`, registered after the
audit-stamp interceptor and after the domain-event interceptor that writes the outbox rows. The
order is load-bearing: running last is what makes the diff it captures see the final stamped values
rather than a half-populated entity. It walks the change tracker, compares each modified property's
original value against its current one, and adds one `AuditTrailEntry` row per changed property into
the same `SaveChanges` call. The history therefore commits or rolls back with the data it describes,
same transaction, same database. That is the outbox guarantee applied to a different payload: a
trail that can be committed without its data, or lost to a crash in the window after the commit, is
a hint rather than a record.

It is opt-in twice over, which is what keeps the cost proportional to the value. A host has to call
`AddAuditTrail(configuration)`, and an entity has to carry the `IAuditedEntity` marker. A host that
never calls it resolves the interceptor as null (`GetService`, not `GetRequiredService`), so nothing
joins the pipeline and the feature costs nothing. Seven service hosts across the reference apps opt
in today, among them Store's Sales service, ADC's Identity service, and Helpdesk's web host.

Two details follow from what a change history is. A property marked `[Pii]` records
`PiiRedactor.RedactedToken` on both sides of the change rather than the values, redacted at capture
and never at read, since a store that by construction outlives the row it describes would otherwise
become a second copy of personal data that erasure has to chase. And `AuditTrailEntry` is
deliberately not an `IAuditableEntity`, exactly like `OutboxMessage`: no audit stamps of its own
(stamping is itself a change, so it would recurse) and no soft-delete flag (a soft-deleted audit row
is rewritten history that a query filter quietly hides). Rows are append-only and leave only through
a scheduled retention purge.

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
attempts, a ten-second maximum delay) decides four things. The whole delegate is the retriable unit,
so anything computed outside it but committed inside it is silently wrong on a second attempt. Every
attempt after the first starts from `ResetForRetry`, which calls `ChangeTracker.Clear()` on every
context, because the failed attempt's entities are still `Added` and would otherwise be inserted a
second time with a duplicate outbox row per event. A returned failed `Result` rolls back exactly like
a thrown exception, which is what a framework that mandates `Result` over exceptions owes itself. And
the deferred in-process dispatch is flushed only after the commit succeeds (`FlushDeferredAsync`) and
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
  5s, so an in-process handler can run first), it sleeps only until the earliest becomes eligible.
  Otherwise it sleeps the full fallback interval (default 2s locally; deployed environments set it high,
  for example 300s, to cut idle polling without adding latency).
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
exponential retry, so the two products stay substitutable. It also records the honest gap: the
production-only Azure Service Bus binding is exercised by a dedicated emulator test tier that runs
nightly and non-gating, so it is evidence that the binding works, not a check that blocks a
regression.

```csharp
// One abstraction, two transports. Application code depends only on IMessageBus.
// InProcessMessageBus  -> in-monolith, method-call delivery
// BrokerMessageBus     -> extracted service, MassTransit broker (RabbitMQ dev / Azure Service Bus prod)
```

Whether there is an outbox at all is resolved from that same mode. `MessageBus:EnableOutbox` is a
`bool?` that defaults to unset, and `MessageBusSettings.IsOutboxEnabled` reads
`EnableOutbox ?? Provider != MessageBusProvider.InProcess`, character for character the rule
`IsInboxEnabled` uses one property above it. `AddInfrastructure` resolves that posture once, at
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
    var now = (timeProvider ?? TimeProvider.System).GetUtcNow().UtcDateTime;
    builder.Set(e => e.LastModifiedOn, (DateTime?)now);
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
  document this, it ships an opt-in consumer-side inbox: `IInboxStore` (`EfInboxStore` records processed
  messages in an `InboxMessages` table, `NoOpInboxStore` is the default no-op) dedups by `MessageId`,
  switched on with `MessageBus:EnableInbox`, and the generic `IntegrationEventConsumer` checks before
  handling and records only after every handler succeeds (**ADR-021**, enabled in production on five
  service hosts). The honest residual is narrower: the inbox is opt-in per service, and it narrows the
  duplicate window rather than closing it, so a crash between a handler committing and the inbox write
  reprocesses the event once more. Handlers must still be idempotent for that window.
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

*Notes: 2026-09-19 re-verification pass against MMCA.Common v1.205.0 (commit 90ffa7a). Section
history: "The write that skips the whole pipeline" was added 2026-07-27 to close a recorded gap, the
set-based-write audit-field trap was taught only inside Article 49's reconciliation section, and it
lives here because this article already teaches the `SaveChangesAsync` sequence whose first step is
"stamp audit fields". "When the commit itself is ambiguous" was added 2026-08-01 and gained the
per-source outcome paragraph on 2026-08-15 (MMCA.Common PR #248). The transport-selection paragraph
was added 2026-08-07, "The third participant in that sequence: the change trail" on 2026-08-14, and
"When the consumer runs out of retries" on 2026-08-19. The two configuration-surface paragraphs (the
outbox posture resolved from the messaging mode, and the transaction execution contract) were added
2026-09-19. Anchors below were read against source in this pass; MMCA.Common PR #352 split the flat
namespaces, so `OutboxProcessor.cs`, `OutboxSettings.cs`, `OutboxCleanupService.cs`,
`MessageBusSettings.cs`, `FaultIntegrationEventConsumer.cs` and
`IntegrationEventConsumerExtensions.cs` now sit under `Persistence/Outbox/Processing/`,
`Persistence/Outbox/Administration/`, `Messaging/` and `Messaging/Consumers/` rather than the
`Settings/` and `Services/` folders the earlier ledger cited. Outbox posture
(`Website/docs-src/adr/100-outbox-opt-in-resolved-from-messaging-mode.md`, Accepted 2026-08-29 at
`:4`): `MessageBusSettings.EnableOutbox` is a `bool?`
(`Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:167`, doc `:143-166`) and
`IsOutboxEnabled` resolves it as `EnableOutbox ?? Provider != MessageBusProvider.InProcess` (`:175`),
the same rule `IsInboxEnabled` applies at `:141` over `EnableInbox` (`:133`); `AddInfrastructure`
resolves once at registration and registers `OutboxProcessor` plus `OutboxCleanupService` on the
enabled path or `OutboxDisabledNoticeService` on the disabled one
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:223-231`, the transport-decision
comment at `:213-218`, `IOutboxSignal` at `:211`); `EnsureOutboxAvailableForProvider` throws when the
provider is not `InProcess` and `EnableOutbox` is explicitly `false` (declared `:1138`, guard
`:1140`, message `:1143`, doc `:1120-1128`); `OutboxDisabledNoticeService`
(`Persistence/Outbox/Administration/OutboxDisabledNoticeService.cs:22`) logs one Information line
naming what is not running and giving `MessageBus:EnableOutbox=true` as the restore path (`:35-38`).
The in-process default, the explicit `true` a monolith or an in-process test host has to set, and the
unchanged EF model are ADR-100's own decision and trade-off text (`:38-44`, `:46-50`, `:62-68`,
`:70-76`, `:106-111`). Transaction execution contract
(`Website/docs-src/adr/107-transaction-execution-contract.md`, Accepted 2026-09-03 and re-measured
2026-09-19, `:4`): `IUnitOfWork.ExecuteInTransactionAsync`
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:70`) is
forwarded by `UnitOfWork` (`Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:88-91`)
to `DbContextFactory.ExecuteInTransactionAsync`
(`Persistence/DbContexts/Factory/DbContextFactory.cs:518`), and `TransactionalCommandDecorator`
(`Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:20`) calls
it for any `ITransactional` command (`:31`). The delegate runs inside the retrying execution strategy
(`strategy.ExecuteAsync`, `DbContextFactory.cs:545`; `EnableRetryOnFailure(maxRetryCount: 5,
maxRetryDelay: TimeSpan.FromSeconds(10))` at `Persistence/DbContexts/SQLServerDbContext.cs:63-66`);
`ResetForRetry` runs from the second attempt on (`:548`, declared `:761`, `ChangeTracker.Clear()` at
`:766`); a returned failed `Result` rolls back like a throw (`:587`, `RollbackTransaction` `:456`);
the commit failure is returned rather than thrown (`TryCommit` invoked `:591`, declared `:640`) and
rethrown past the strategy (`:559-560`, the inner-chain reason in the code comment at `:555-558`);
`AbandonAfterCommitFailure` rolls back best-effort (`:664`, declared `:681`); deferred dispatch is
flushed only after a successful commit (`:600`,
`Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:145`) and dropped otherwise (`:162`);
and Cosmos is excluded by `SupportsTransactions` (`DbContextFactory.cs:774`). ADR-107 records the
same points at `:33-35`, `:43-51`, `:53-60`, `:62-67`, `:69-76`, `:93-100` and `:109-111`.
`TransactionCommitAmbiguousException` is public and sealed
(`Persistence/DbContexts/Factory/TransactionCommitAmbiguousException.cs:22`) and exposes
`CommittedSources` (`:76`), `AmbiguousSource` (`:85`), `RolledBackSources` (`:93`) and the
`ComposeMessage` clause builder (`:99`) that leaves out empty groups. Delivery side:
`ClaimEligibleAsync` is declared at `Persistence/Outbox/Processing/OutboxProcessor.cs:463` and
invoked at `:308`; `ComputeRetryBackoffSeconds` is declared at `:767` and applied at `:678` and
`:746`. Settings (`Persistence/Outbox/Administration/OutboxSettings.cs`): `RetentionDays` defaults to
7 (`:65`, with `0` disabling the purge, documented `:60-62`), `CleanupIntervalHours` to 6 (`:73`),
`LeaseSeconds` to 300 (`:82`, `[Range(10, 3600)]` `:81`), `RetryBackoffBaseSeconds` to 10 (`:99`,
`[Range(1, 3600)]` `:98`), and `DeadLetterRetentionDays` falls back to `RetentionDays` (`:108`, doc
`:101-106`); the sweep that reads them is
`Persistence/Outbox/Administration/OutboxCleanupService.cs`. Transport selection
(`Website/docs-src/adr/066-broker-transport-selection.md`): `MessageBusProvider` is declared at
`Messaging/MessageBusSettings.cs:236` with `InProcess = 0` (`:241`), `RabbitMq = 1` (`:246`) and
`AzureServiceBus = 2` (`:251`). Consume-side faults
(`Website/docs-src/adr/087-broker-poison-message-handling.md`):
`FaultIntegrationEventConsumer<TEvent>` (`Messaging/Consumers/FaultIntegrationEventConsumer.cs:26`)
resolves the id as `fault.FaultedMessageId ?? fault.FaultId` (`:39`), emits one Error log through
`LogFault` (`:48`, declared `:58`) and increments `BrokerMetrics.FaultCounter` tagged by event type
(`:50`); the counter is `broker.fault.count` on the meter `MMCA.Common.Broker`
(`Messaging/BrokerMetrics.cs:30`, `MeterName` `:21`, `Meter` `:23`, class `:18`); registration is
automatic through `RegisterIntegrationEventConsumer<TEvent>`
(`Messaging/Consumers/IntegrationEventConsumerExtensions.cs:38`), whose
`bool registerFaultConsumer = true` parameter (`:39`) is the only opt-out (guard `:44`).
`MessageBus:EnableDelayedRedelivery` is a `bool` with no initializer, so it defaults to `false`
(`Messaging/MessageBusSettings.cs:195`), and `RedeliveryIntervalsSeconds` defaults to `[60, 600,
3600]` (`:211`). The set-based-write block is verbatim from
`Persistence/Repositories/EFRepository.cs:140-146` (the comment at `:140-141` is the source's own),
inside `ExecuteUpdateAsync`; the empty-assignment guard throws at `:137-138`, the `LastModifiedBy`
stamp guarded by `currentUserService?.UserId` is at `:148-151`, and the final
`Entities.Where(where).ExecuteUpdateAsync(builder.Apply, ...)` replay is at `:153`. Seven service
hosts call `AddAuditTrail` today: `MMCA.Store` Sales `Program.cs:208`, Identity `:195`, Catalog
`:228`; `MMCA.ADC` Identity `Program.cs:239`, Engagement `:198`, Conference `:333`; and
`MMCA.Helpdesk` `Source/Hosts/MMCA.Helpdesk.Web/Program.cs:90`. Carried without line anchors in this
pass, because they were not re-read this run and every file that was had moved by 1 to 168 lines:
`Persistence/Repositories/UpdatePropertySetterBuilder.cs`, the internals of `OutboxCleanupService.cs`,
`Persistence/DbContexts/ApplicationDbContext.cs` (the interceptor registration order),
`Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs`, `AuditTrailEntry.cs`,
`AuditTrailSettings.cs`, `MMCA.Common.Domain/Privacy/PiiRedactor.cs`, the inbox stores under
`Persistence/Inbox/`, `DbContextFactoryCommitAmbiguityTests.cs`, and the paragraph-level anchors into
ADR-003, ADR-021, ADR-066, ADR-075 and ADR-087; their earlier line numbers were removed rather than
restated.*

- Full series index: https://ivanball.github.io/writing.html
