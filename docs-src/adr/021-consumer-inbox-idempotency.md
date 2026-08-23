# ADR-021: Consumer-Side Inbox for Integration-Event Idempotency

## Status
Accepted (2026-06-09; adoption reviewed 2026-07-15). Revised 2026-08-18 (the inbox stays opt-in, but
being off is no longer silent: a broker-connected host running `NoOpInboxStore` logs a startup
warning, `MessageBus:EnableInbox=true` becomes the stated recommendation for any such host, and the
`InboxMessages` entity is confirmed to be part of the relational model unconditionally. See the
Revision (2026-08-18) at the end).

## Context
ADR-003 makes integration-event delivery **at-least-once**: the outbox guarantees a published event
is not lost, and the MassTransit broker redelivers on consumer failure. At-least-once means a
consumer can legitimately see the **same event more than once** (broker redelivery after a transient
handler failure, a redeploy mid-consume, or a lost ack). ADR-003's answer was "domain-event handlers
must be idempotent," but that pushes the dedup burden onto every handler author and is easy to get
wrong. We wanted a single, reusable place that recognizes an already-processed integration event and
skips it, without changing how handlers are written.

This is the broker-consumer sibling of two idempotency concerns the framework already records:
ADR-003 (the producer/outbox side plus handler idempotency) and ADR-017 (the inbound HTTP edge,
deduping client retries). The inbox is the third leg: deduping **broker redeliveries** at the
consume edge.

## Decision
Add an opt-in **inbox** that records each successfully-processed integration event by its `MessageId`
and skips redeliveries.

- **Every event carries a `MessageId`.** `BaseDomainEvent` stamps a unique `MessageId`; it is the
  dedup key (the same id the outbox serializes and the broker carries).
- **`IInboxStore` with two implementations.** `EfInboxStore` (active) records processed messages in
  an `InboxMessages` table; `NoOpInboxStore` (default) never dedups. The switch is the
  `MessageBus:EnableInbox` flag (default `false`): `AddBrokerMessaging` registers `EfInboxStore` when
  set and `NoOpInboxStore` otherwise.
- **Check before, record after.** The generic `IntegrationEventConsumer<TEvent>` calls
  `AlreadyProcessedAsync(MessageId)` first and skips the handlers (acking the message) when it is a
  duplicate; it calls `MarkProcessedAsync(MessageId, eventType)` only **after** all handlers succeed.
  A handler that throws rethrows, so MassTransit applies its retry/dead-letter policy and the message
  stays un-recorded (eligible for redelivery).
- **The inbox lives in the consumer's own database.** Rows are written to the host's outbox data
  source (`Outbox:DataSource` / `Outbox:DatabaseName`), so each service dedups in its own database,
  consistent with database-per-service (ADR-006). Every relational source gets an `InboxMessages`
  table; Cosmos hosts skip it.
- **A unique index is the concurrency guard.** `IX_InboxMessages_MessageId` is unique; a concurrent
  duplicate that races past the `AlreadyProcessedAsync` check fails its insert with `DbUpdateException`,
  which `EfInboxStore` swallows as "already processed."
- **Bounded retention.** `OutboxCleanupService` purges inbox rows older than `Outbox:RetentionDays`
  alongside outbox rows (gated on `EnableInbox`), so the table does not grow forever (ADR-005).

The delivery guarantee is therefore **at-least-once-with-dedup**, not exactly-once: a crash between a
handler's commit and the inbox write reprocesses the event exactly once more, so **handlers must
still be idempotent** for that narrow window. The inbox removes the routine-duplicate burden; it does
not make handlers free to be non-idempotent.

In production `EnableInbox: true` is set on all four ADC service hosts
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:28`,
`MMCA.ADC.Conference.Service/appsettings.json:31`, `MMCA.ADC.Engagement.Service/appsettings.json:52`,
`MMCA.ADC.Notification.Service/appsettings.json:50`) and on Store's Sales service
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:40`). Where the `InboxMessages`
table comes from differs by repo: each of the four ADC per-service migration projects carries a
dedicated `AddInboxMessages` migration, whereas Store Sales creates the table and its unique
`IX_InboxMessages_MessageId` index inside its single `InitialCreate` migration
(`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/Migrations/20260621192808_InitialCreate.cs:21,179`),
because that per-service project postdates the frozen combined-archive lineage that added the ADC
migration. Adoption inventory as of 2026-08-13: **three ADC services consume from the broker** and
so use their inbox for real, plus Store Sales. ADC Identity consumes `SpeakerLinkedToUser` and
`SpeakerUnlinkedFromUser` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:299-300`),
ADC Conference consumes `UserRegistered` (`MMCA.ADC.Conference.Service/Program.cs:372`), and ADC
Engagement consumes four events, `AttendeeCheckedIn`, `SessionFeedbackSubmitted`,
`EventFeedbackSubmitted` and `UserDeleted` (`MMCA.ADC.Engagement.Service/Program.cs:305-308`), the
first of which is ADC's first **self-consumption** over the broker: Engagement publishes
`AttendeeCheckedIn` and consumes it back, which is precisely the shape a redelivery would double-count,
so the inbox is load-bearing there rather than decorative. Store Sales consumes `ProductVariantChanged`
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:253`). Only **ADC Notification**
now carries `EnableInbox: true` and the table while registering no consumer, so its inbox alone is
provisioned and unused (functionally harmless). The mirror image is equally harmless and worth stating
because it looks like the opposite mistake: Store Catalog and Store Identity carry the `InboxMessages`
table from their own `InitialCreate` migrations
(`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Catalog/Migrations/20260621192800_InitialCreate.cs:48,213`,
`MMCA.Store.Migrations.SqlServer.Identity/Migrations/20260621192816_InitialCreate.cs:49,119`) with
**no** `EnableInbox` flag and **no** consumer, so the table exists and is simply never written; the
audit condition the Trade-offs below state (no broker-consuming service lacks the flag) holds in both
repos.

## Rationale
- **Dedup once, not in every handler.** A single consume-edge check turns "every handler author must
  remember to be idempotent against redelivery" into a framework guarantee for the common case, the
  same invariant-over-discipline posture the framework prefers (ADR-015).
- **Record-after-success is the correct ordering.** Marking processed only after handlers succeed
  means a failure leaves the message redeliverable; marking before would risk dropping an event whose
  handler then failed.
- **Physical isolation reuses database-per-service.** Putting the inbox in the consumer's own outbox
  database needs no new infrastructure and keeps each service self-contained, with no shared dedup
  store to race on.
- **Opt-in keeps the monolith simple.** In-process dispatch (ADR-003) never redelivers, so a
  single-process or broker-less deployment needs no inbox; `NoOpInboxStore` is the default and costs
  nothing.

## Trade-offs
- **Not exactly-once.** The crash-after-handler-before-inbox window reprocesses once, so handlers must
  stay idempotent for it; the inbox narrows the duplicate window, it does not close it.
- **Opt-in per service.** A broker-consuming service that forgets `EnableInbox` gets no dedup (and no
  `InboxMessages` table), the same audit-the-inventory caveat as ADR-005 / ADR-017 / ADR-020.
  Enabling it also requires the migration that creates the table.
- **A second housekeeping table.** Each consumer database carries an `InboxMessages` table and its
  retention purge, in addition to the outbox.
- **Dedup is keyed on `MessageId`, not payload.** Dedup is per-message-identity (the intended
  granularity); a producer that re-published the *same* business action under a *new* `MessageId`
  would not be deduped by the inbox.

## Related
ADR-003 (the outbox and at-least-once delivery whose consumer side this deduplicates; handler
idempotency is still required for the crash window), ADR-006 (the inbox lives in the consumer's own
database), ADR-005 (`OutboxCleanupService` bounds inbox retention too), ADR-017 (the inbound-HTTP-edge
idempotency this mirrors at the broker-consume edge), ADR-066 (the transport selection whose
non-`InProcess` providers are exactly the hosts the new startup warning fires in),
[ADR-087](087-broker-poison-message-handling.md) (second-level redelivery, which can now re-run a
handler an hour after the original attempt: the inbox and every idempotent handler must hold across
that gap, not only across a retry burst).

## Revision (2026-08-18)
**The decision is unchanged: the inbox is still opt-in and `NoOpInboxStore` is still the default.**
What changed is that the default is now loud.

1. **A broker-connected host with no inbox says so at startup.** `AddBrokerMessaging` returns early
   for `MessageBusProvider.InProcess`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:669-672`), which is
   what scopes this to hosts that actually talk to a broker: in-process dispatch never redelivers, so
   there is nothing to warn about. Past that early return, the `EnableInbox` branch
   (`:699-711`) registers `EfInboxStore` as scoped (`:701`) when the flag is set, and on the `else`
   branch registers `NoOpInboxStore` as a singleton (`:705`) **plus** an `IHostedService` whose only
   job is to emit one `Warning` line naming the consequence and the fix (`:710`). The service is
   `InboxDisabledWarningService`
   (`.../Persistence/Inbox/InboxDisabledWarningService.cs:18-19`), and it evaluates nothing at
   runtime: `StartAsync` logs unconditionally (`:22-26`), because the condition was already decided by
   which DI branch registered it. Its message text is at `:31-34`. The type is `internal`, so it is a
   framework behavior rather than a public extension point.
2. **`MessageBus:EnableInbox=true` is now the stated recommendation, not a neutral option.** The
   setting is still `bool` with no initializer, so the default is still `false`
   (`.../Settings/MessageBusSettings.cs:76`), but its own documentation now says "RECOMMENDED true for
   any broker-connected host" (`:65-73`). The Trade-offs entry above ("a broker-consuming service that
   forgets `EnableInbox` gets no dedup") therefore keeps its substance and loses its silence: the
   inventory audit it asks for is now performed by the host at every boot.
3. **The `InboxMessages` table is part of the relational model unconditionally.**
   `ApplicationDbContext.OnModelCreating` calls `ConfigureInbox(modelBuilder)` with no flag check
   (`.../Persistence/DbContexts/ApplicationDbContext.cs:320`, body at `:514-528`, including the unique
   `IX_InboxMessages_MessageId` at `:520-522`), and it is configured inline in the base context rather
   than as an `IEntityTypeConfiguration`. `SQLServerDbContext` and `SqliteDbContext` reach it through
   `base.OnModelCreating`; `CosmosDbContext` deliberately does not call the base (`CosmosDbContext.cs:89`,
   documented at `ApplicationDbContext.cs:510-513`), so the guarantee is **relational engines only**,
   consistent with the "Cosmos hosts skip it" statement in the Decision above.

**So the Trade-offs entry above overstated the cost of enabling.** It said that enabling the inbox
"also requires the migration that creates the table". On a relational host that has applied the
standard migrations, it does not: the table is part of the shared relational model those migrations
already create, so flipping `EnableInbox` is a configuration change and a restart with no schema work.
Every service enumerated in the Decision above is past that point already (ADC's four per-service
migration projects each carry an `AddInboxMessages` migration; Store's per-service projects create the
table in `InitialCreate`). The settings documentation says the same thing
(`MessageBusSettings.cs:60-64`), and notes that the `false` default exists only so an existing host
does not start querying a table it has not migrated yet. Cosmos hosts remain the exception, as the
Decision above already states.
