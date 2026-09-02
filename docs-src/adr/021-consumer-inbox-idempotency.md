# ADR-021: Consumer-Side Inbox for Integration-Event Idempotency

## Status
Accepted (2026-06-09; adoption reviewed 2026-07-15, inventory refreshed 2026-09-01). Revised 2026-08-18 (the inbox stays opt-in, but
being off is no longer silent: a broker-connected host running `NoOpInboxStore` logs a startup
warning, `MessageBus:EnableInbox=true` becomes the stated recommendation for any such host, and the
`InboxMessages` entity is confirmed to be part of the relational model unconditionally. See the
Revision (2026-08-18) at the end). Revised 2026-08-26 (**the inbox is no longer opt-in for a broker
transport**: it resolves ON unless a host explicitly turns it off, and its row is staged into the
handler's own unit of work so it commits atomically with the handler's mutations. See the Revision
(2026-08-26) at the end). See also
[ADR-100](100-outbox-opt-in-resolved-from-messaging-mode.md) (2026-08-29, v1.170.0), which applies this
record's three-valued resolution rule to the **producer** side: `MessageBus:EnableOutbox` is `bool?`
and resolves from the transport the same way `EnableInbox` does here, so the two settings now read
identically. Nothing about the inbox contract changes.

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
  an `InboxMessages` table; `NoOpInboxStore` never dedups. The switch is the
  `MessageBus:EnableInbox` flag (default `false`): `AddBrokerMessaging` registers `EfInboxStore` when
  set and `NoOpInboxStore` otherwise. (**Superseded by the Revision (2026-08-26)**: the setting is
  now `bool?` and resolves ON for a broker transport when unset, so `NoOpInboxStore` is reached only
  by an explicit opt-out.)
- **Check before, record after.** The generic `IntegrationEventConsumer<TEvent>` calls
  `AlreadyProcessedAsync(MessageId)` first and skips the handlers (acking the message) when it is a
  duplicate; it calls `MarkProcessedAsync(MessageId, eventType)` only **after** all handlers succeed.
  A handler that throws rethrows, so MassTransit applies its retry/dead-letter policy and the message
  stays un-recorded (eligible for redelivery). (**Superseded by the Revision (2026-08-26)**: the
  consume path is now `TryBeginAsync` -> handlers -> `CompleteAsync`, with the row STAGED at the
  start and persisted by whichever save comes first.)
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
not make handlers free to be non-idempotent. (**Narrowed by the Revision (2026-08-26)**: a handler
that saves to the same physical source now commits the inbox row in its own transaction, so that
window is closed for it; it remains open for a handler that writes nothing or writes to a different
source, and handlers must still be idempotent.)

In production `EnableInbox: true` is set explicitly on all four ADC service hosts
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:34`,
`MMCA.ADC.Conference.Service/appsettings.json:31`, `MMCA.ADC.Engagement.Service/appsettings.json:52`,
`MMCA.ADC.Notification.Service/appsettings.json:50`) and on all three Store service hosts
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:40`,
`MMCA.Store.Catalog.Service/appsettings.json:30`, `MMCA.Store.Identity.Service/appsettings.json:30`),
so every deployed service host states its posture rather than resting on the transport default the
Revision (2026-08-26) introduced. Where the `InboxMessages` table comes from differs by repo: each of
the four ADC per-service migration projects carries a dedicated `AddInboxMessages` migration, whereas
each Store per-service project creates the table and its unique `IX_InboxMessages_MessageId` index
inside its single `InitialCreate` migration
(`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/Migrations/20260621192808_InitialCreate.cs:21,179`,
`MMCA.Store.Migrations.SqlServer.Catalog/Migrations/20260621192800_InitialCreate.cs:48,213`,
`MMCA.Store.Migrations.SqlServer.Identity/Migrations/20260621192816_InitialCreate.cs:49,119`),
because those per-service projects postdate the frozen combined-archive lineage that added the ADC
migration. Adoption inventory as of 2026-09-01: **three ADC services consume from the broker** and
so use their inbox for real, plus Store Sales. ADC Identity consumes `SpeakerLinkedToUser` and
`SpeakerUnlinkedFromUser` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:290-291`),
ADC Conference consumes `UserRegistered` (`MMCA.ADC.Conference.Service/Program.cs:349`), and ADC
Engagement consumes four events, `AttendeeCheckedIn`, `SessionFeedbackSubmitted`,
`EventFeedbackSubmitted` and `UserDeleted` (`MMCA.ADC.Engagement.Service/Program.cs:281-284`), the
first of which is ADC's first **self-consumption** over the broker: Engagement publishes
`AttendeeCheckedIn` and consumes it back, which is precisely the shape a redelivery would double-count,
so the inbox is load-bearing there rather than decorative. Store Sales consumes `ProductVariantChanged`
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:247`). The remaining three hosts (**ADC
Notification**, **Store Catalog** and **Store Identity**) carry `EnableInbox: true` and the table while
registering no consumer, so their inboxes are provisioned and unused, which is functionally harmless:
the flag costs one scoped `EfInboxStore` registration and the table stays empty until one of them
starts consuming. The audit condition the Trade-offs below state (no broker-consuming service lacks
the flag) holds in both repos, and no host in either repo now leaves the setting to the transport
default.

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
  stay idempotent for it; the inbox narrows the duplicate window, it does not close it. (The
  Revision (2026-08-26) closes it for the common case, a handler saving to the same physical source,
  and leaves it open otherwise.)
- **Opt-in per service.** A broker-consuming service that forgets `EnableInbox` gets no dedup (and no
  `InboxMessages` table), the same audit-the-inventory caveat as ADR-005 / ADR-017 / ADR-020.
  Enabling it also requires the migration that creates the table. (**Superseded**: the Revision
  (2026-08-18) removed the migration claim, and the Revision (2026-08-26) removed the opt-in itself
  for broker hosts, so forgetting the flag is no longer a way to lose dedup.)
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
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:741-744`), which is
   what scopes this to hosts that actually talk to a broker: in-process dispatch never redelivers, so
   there is nothing to warn about. Past that early return, the `EnableInbox` branch
   (`:784-796`) registers `EfInboxStore` as scoped (`:786`) when the flag is set, and on the `else`
   branch registers `NoOpInboxStore` as a singleton (`:790`) **plus** an `IHostedService` whose only
   job is to emit one `Warning` line naming the consequence and the fix (`:795`). The service is
   `InboxDisabledWarningService`
   (`.../Persistence/Inbox/InboxDisabledWarningService.cs:20-21`), and it evaluates nothing at
   runtime: `StartAsync` logs unconditionally (`:24-28`), because the condition was already decided by
   which DI branch registered it. Its message text is at `:33-36`. The type is `internal`, so it is a
   framework behavior rather than a public extension point.
2. **`MessageBus:EnableInbox=true` is now the stated recommendation, not a neutral option.** The
   setting is still `bool` with no initializer, so the default is still `false`, but its own
   documentation now says "RECOMMENDED true for any broker-connected host". (**Superseded by the
   Revision (2026-08-26)**: the property is `bool?` with no initializer
   (`.../Settings/MessageBusSettings.cs:117`), and its documentation now states the transport-driven
   resolution rather than a recommendation (`:91-116`).) The Trade-offs entry above ("a broker-consuming service that
   forgets `EnableInbox` gets no dedup") therefore keeps its substance and loses its silence: the
   inventory audit it asks for is now performed by the host at every boot.
3. **The `InboxMessages` table is part of the relational model unconditionally.**
   `ApplicationDbContext.OnModelCreating` calls `ConfigureInbox(modelBuilder)` with no flag check
   (`.../Persistence/DbContexts/ApplicationDbContext.cs:347`, body at `:565-584`, including the unique
   `IX_InboxMessages_MessageId` at `:576-578`), and it is configured inline in the base context rather
   than as an `IEntityTypeConfiguration`. `SQLServerDbContext` and `SqliteDbContext` reach it through
   `base.OnModelCreating`; `CosmosDbContext` deliberately does not call the base (`CosmosDbContext.cs:89`,
   documented at `ApplicationDbContext.cs:567-568`), so the guarantee is **relational engines only**,
   consistent with the "Cosmos hosts skip it" statement in the Decision above.

**So the Trade-offs entry above overstated the cost of enabling.** It said that enabling the inbox
"also requires the migration that creates the table". On a relational host that has applied the
standard migrations, it does not: the table is part of the shared relational model those migrations
already create, so flipping `EnableInbox` is a configuration change and a restart with no schema work.
Every service enumerated in the Decision above is past that point already (ADC's four per-service
migration projects each carry an `AddInboxMessages` migration; Store's per-service projects create the
table in `InitialCreate`). The settings documentation says the same thing
(`MessageBusSettings.cs:94-97`), and carved out the `false` default for an existing host that has not
migrated the table yet (that carve-out is now the explicit `EnableInbox=false` opt-out documented at
`:110-115`, per the Revision (2026-08-26)). Cosmos hosts remain the exception, as the
Decision above already states.

## Revision (2026-08-26)
**Two changes, and the first one reverses this record's central choice.** The inbox is no longer
opt-in where redelivery is possible, and its row is no longer a separate write.

1. **`EnableInbox` becomes three-valued, and unset resolves ON for a broker.**
   `MessageBusSettings.EnableInbox` is now `bool?` with no initializer
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:117`), and every
   framework component reads the resolved posture instead:
   `IsInboxEnabled => EnableInbox ?? Provider != MessageBusProvider.InProcess` (`:125`). An explicit
   value still wins in both directions (`:110-115`); left unset the transport decides, ON for RabbitMQ
   and Azure Service Bus, OFF for the in-process provider that has no redelivery to dedup (`:99-102`).
   The reason the default flipped is written where the setting lives: broker delivery is
   at-least-once by contract, so an ack lost to a network blip, a redelivery after a lease expiry, or
   an outbox row republished after a crash all hand the same event to the same handlers twice, and
   with the inbox off each of those becomes a duplicate side effect (a second email, a second charge
   attempt, a double decrement) unless every handler happens to be idempotent on its own (`:103-108`).
   The registration branch is unchanged in shape and only its condition moved: `AddBrokerMessaging`
   still returns early for `MessageBusProvider.InProcess`
   (`.../MMCA.Common.Infrastructure/DependencyInjection.cs:741`), so this scopes to broker hosts, and
   past it `settings.IsInboxEnabled` (`:784`) selects the scoped `EfInboxStore` (`:786`) or the
   singleton `NoOpInboxStore` plus the startup-warning hosted service (`:790`, `:795`). Reaching
   `InboxDisabledWarningService` therefore now means a **deliberate opt-out** rather than an
   unnoticed default, and its Warning says so, naming the setting, the consequence and the fact that
   the `InboxMessages` table is already part of the model
   (`.../Persistence/Inbox/InboxDisabledWarningService.cs:13-16`, message text at `:35`). **The
   Trade-offs entry "a broker-consuming service that forgets `EnableInbox` gets no dedup" no longer
   describes a reachable state**: forgetting the flag now yields dedup, and only writing
   `false` removes it.
2. **The inbox row is staged into the handler's own unit of work.** The consume path is
   `TryBeginAsync` -> handlers -> `CompleteAsync`, with `Abandon` on the failure branch
   (`.../Persistence/Inbox/IInboxStore.cs:9-14`); all three are default interface members over the
   original `AlreadyProcessedAsync`/`MarkProcessedAsync` pair (`:38-39`, `:48-49`, `:63`), so
   `NoOpInboxStore` and any hand-written implementation keep working unchanged.
   `EfInboxStore.TryBeginAsync` re-checks and then **stages** an `InboxMessage` into the same scoped
   `ApplicationDbContext` the handlers write through, tracked in a small per-message dictionary
   (`.../Persistence/Inbox/EfInboxStore.cs:61-68`, staging at `:116-127`, the dictionary and its
   one-entry-in-practice rationale at `:44-49`). A handler's own `SaveChangesAsync` therefore commits
   the inbox row **in the same transaction as its mutations**, which closes the window this record's
   Decision called out: a crash after the handler committed can no longer reprocess work whose save
   carried the row. `CompleteAsync` then writes only if nothing else did, keying on the entry still
   being `Added` (`:71-84`), and falls back to the old write-after-handlers path for a caller that
   skipped `TryBeginAsync` (`:86-88`), which is also the path an event whose handlers write nothing
   takes. `IntegrationEventConsumer<TEvent>` is where the three calls sit: the duplicate check and
   skip (`.../Services/IntegrationEventConsumer.cs:54-58`), the handler loop, and the final
   `CompleteAsync` (`:95`).
   - **The failure path discards the staged row first.** A throwing handler triggers
     `inbox.Abandon(messageId)` before the rethrow that lets MassTransit apply its retry policy
     (`IntegrationEventConsumer.cs:74`, rethrow at `:81`). `Abandon` detaches a still-`Added` entry
     rather than leaving it staged, because the context is cached for the whole scope and a surviving
     `Added` row would be re-attempted by any later save on it (`EfInboxStore.cs:106-109`). The one
     case this design loses to a pure after-the-fact inbox is made loud rather than silent: when an
     earlier handler already committed the row and a later handler then fails, the redelivery is
     skipped as a duplicate, so the handlers that had not run never will, and `Abandon` returns
     `false` after logging a Warning saying exactly that (`:97-104`, message at `:169-172`).
   - **Unique-index duplicate absorption is preserved, on both saves.** A concurrent duplicate that
     races past the check fails its insert, and `SaveStagedAsync` detaches the rejected entry, then
     re-queries rather than sniffing provider-specific error codes (so the check holds for SQL Server
     and SQLite alike) and absorbs the rejection only when the row really is there, rethrowing
     anything else so a genuine write failure cannot ack an unrecorded message
     (`EfInboxStore.cs:140-157`). When it is the **handler's** save that hits the index, the
     `DbUpdateException` surfaces to the handler, its mutations roll back, and the broker redelivers
     into the skip path (`:30-36`).
   - **Atomicity holds where the handler writes to the same physical source** the store resolves (the
     `Outbox:DataSource` / `Outbox:DatabaseName` pair, which is the single database of a monolith and
     of a service that owns one). A handler writing to a different source is back to two
     transactions and its row is persisted by `CompleteAsync`, so delivery there stays
     at-least-once, which is the contract handlers are written against anyway (`:23-29`).

**What this record still says is right.** Dedup is keyed on `MessageId`, the rows live in the
consumer's own database, the unique index is the concurrency guard, retention rides
`OutboxCleanupService`, and handlers must stay idempotent: the crash window is closed only for a
handler whose own save carried the row.
