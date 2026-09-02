# ADR-100: The Outbox Is Resolved from the Messaging Mode, Not Always On

## Status
Accepted (2026-08-29, framework v1.170.0). Amends [ADR-003](003-outbox-dual-dispatch.md) (the outbox
runs when the transport needs it, rather than in every host unconditionally) and follows the
three-valued resolution precedent [ADR-021](021-consumer-inbox-idempotency.md) set for the inbox. The
EF model is unchanged: the `OutboxMessages` table stays mapped on every relational source either way,
so this is a configuration decision and never a migration.

## Context
ADR-003 gives every host a transactional outbox: domain and integration events are written to
`OutboxMessages` in the same transaction as the aggregate changes, `OutboxProcessor` publishes them,
and `OutboxCleanupService` ages the table out. That is the correct and only workable arrangement when
the publish crosses a process boundary, because the alternative is a broker call inside a database
transaction.

A single-process application takes no such hop. Its `IEventBus` dispatches every event inside the
process that raised it, so the store-and-forward round trip buys it two hosted services, a poll loop
and a table it reads to find rows it wrote a millisecond earlier. On a small application, where the
whole point of the shape is that a developer can run it with `dotnet run` against one file, those are
the background services printing log lines about work that never had to happen.

ADR-021 had already answered the same question on the consumer side. `MessageBus:EnableInbox` became
`bool?` and `IsInboxEnabled` resolves an unset value from the transport, ON for a broker and OFF for
in-process, which has no redelivery to dedup
(`Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:102`). The outbox had no such
resolution: it ran in every host, including the one that had nothing to forward to.

The reverse posture is a real hazard rather than a symmetrical option. A broker deployment publishes
integration events **exclusively** through the outbox: `BrokerEventBus` writes the rows and
`OutboxProcessor` publishes them, so a host with a broker configured and the outbox switched off has
no delivery channel at all and drops every cross-service event silently.

## Decision
Make the outbox a three-valued setting resolved from the transport, gate the components that cost
something, keep the schema, and refuse the one combination that cannot work.

1. **`MessageBus:EnableOutbox` is `bool?` and defaults to unset.**
   `MessageBusSettings.EnableOutbox` (`Source/Core/MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:151`)
   carries the explicit override; `IsOutboxEnabled` (`:159`) is the resolved posture every framework
   component reads: `EnableOutbox ?? Provider != MessageBusProvider.InProcess`. That is character for
   character the inbox rule two properties above it (`:125`). An explicit value wins in both
   directions, so a monolith that wants at-least-once delivery across a crash sets
   `MessageBus:EnableOutbox=true` and gets the full outbox back (`:143-148`).

2. **Resolution happens once, at registration.** `AddInfrastructure` binds the section, and on the
   enabled path registers `OutboxProcessor` and `OutboxCleanupService`; on the disabled path it
   registers neither and adds `OutboxDisabledNoticeService` instead
   (`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:186-198`, reasoning at
   `:180-185`).

3. **The row writes are gated at both write points**, not only the background services:
   `InProcessEventBus` takes its direct-dispatch branch when the outbox is off, with no rows, no save
   and no processor to retry (`Source/Core/MMCA.Common.Infrastructure/Services/InProcessEventBus.cs:42`,
   branch at `:80-84`, documented at `:69-73`), and `DomainEventSaveChangesInterceptor` captures and
   dispatches in-process without writing rows
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:54`,
   contract at `:41-44`). Both fall back to the outbox path when no options are resolvable, so a
   container that binds neither keeps the previous behavior. This is the same branch a context
   without outbox support (Cosmos) already took, reached by a second condition rather than a new one.

4. **A broker with the outbox explicitly disabled fails at startup.**
   `EnsureOutboxAvailableForProvider` throws when the provider is anything other than `InProcess` and
   `EnableOutbox` is explicitly `false` (`DependencyInjection.cs:857-864`). The message names the
   mechanism (`BrokerEventBus` writes the rows, `OutboxProcessor` publishes them), the consequence
   (every cross-service event dropped silently) and the fix. Leaving the setting unset under a broker
   resolves to enabled, so only a deliberate `false` reaches the throw.

5. **Being off is never silent.** `OutboxDisabledNoticeService`
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxDisabledNoticeService.cs:21`)
   logs one startup line naming exactly what is not running and what it costs: no rows are written,
   neither background service is present, an event whose handler fails is not retried, and a crash
   between the commit and the dispatch loses it, with `MessageBus:EnableOutbox=true` given as the
   restore path and the absence of any migration stated (`:36`). It is the mirror of the inbox's
   `InboxDisabledWarningService` (ADR-021).

6. **The EF model does not change.** `OutboxMessage` is configured in `OnModelCreating` for every
   relational provider
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:528-531`),
   independent of the setting. Flipping the flag in either direction is a configuration change and a
   restart, with no migration in any consumer.

## Rationale
- **The outbox is a transport decision, not a persistence one.** Whether an event must survive a
  process boundary is exactly the question `MessageBus:Provider` already answers, so deriving the
  outbox from it puts the default where the information is instead of asking every host to restate
  it.
- **One resolution rule, already proven.** ADR-021 introduced null-means-resolve-from-transport for
  the inbox and it held: an explicit value still wins, and reaching the degraded path becomes a
  deliberate opt-out that says so in the log. Repeating the rule verbatim means an operator learns it
  once and there are two settings, not two mental models.
- **The dangerous direction is refused, not documented.** Broker plus disabled outbox has no correct
  behavior, so it is a startup failure rather than a paragraph in a guide. The other three
  combinations are all meaningful.
- **Keeping the table mapped is what makes the flag cheap.** Removing the entity from the model when
  the outbox is off would make every flip a schema move, and a table drop is precisely the
  contract-phase change ADR-057's expand/contract gate exists to stop shipping alongside the code
  that stopped using it. An unused empty table costs nothing; a migration pair costs a release.
- **It makes the small-app floor honest.** A `dotnet new mmca-app --database sqlite --no-aspire`
  application starts with no broker, so the poll loop it used to run had nothing to publish and no
  peer to publish to. Under this record it does not start one, and the developer reading its startup
  log is told that in one line.

## Trade-offs
- **The default for an in-process host changed.** A host on `InProcess` messaging (or with no
  `MessageBus` section at all, which resolves to the same provider) no longer runs the durable outbox
  unless it sets `MessageBus:EnableOutbox=true`. For a monolith that relied on the outbox to retry a
  failed in-process handler, or to survive a crash between commit and dispatch, that guarantee is
  gone until the flag is set. The startup notice is the only thing that tells an operator, and a log
  line is weaker than a compile error.
- **Two hosts with the same code can behave differently.** The same module, deployed as a monolith
  and as an extracted service, gets synchronous dispatch in one and store-and-forward in the other.
  That was already true of the delivery path (ADR-003 chose it deliberately); what is new is that the
  durability of a **domain** event now varies with the transport too.
- **The resolved posture is not visible in configuration.** An operator reading `appsettings.json`
  sees nothing about the outbox on either path, and has to know the resolution rule or read the
  startup log. The same cost ADR-021 accepted for the inbox.
- **An empty `OutboxMessages` table ships in every database.** Correct for the flip-back property,
  slightly confusing for anyone reading the schema of an application that has never written a row to
  it.
- **Nothing gates the setting against deployment topology.** A host that adds a broker later and
  leaves an explicit `EnableOutbox=false` in place fails at startup, which is the good case; a host
  that sets it `true` with no broker simply pays for the outbox, and nothing objects.

## Related
[ADR-003](003-outbox-dual-dispatch.md) (the outbox itself: the dual-dispatch contract, the processor,
the retry and dead-letter policy, all unchanged for a host that runs it),
[ADR-021](021-consumer-inbox-idempotency.md) (the consumer-side sibling whose three-valued resolution
this record copies),
[ADR-006](006-database-per-service.md) (the per-source outbox tables this setting leaves mapped),
[ADR-057](057-expand-contract-schema-evolution-gate.md) (the schema-shape gate that keeping the entity
mapped avoids entirely),
[ADR-008](008-service-extraction-topology.md) (extraction is what turns the transport, and therefore
the resolved outbox posture, from in-process to broker),
[ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md) (the per-service integration tier
that needs no Docker because the default provider is `InProcess`, the same default this record reads).
