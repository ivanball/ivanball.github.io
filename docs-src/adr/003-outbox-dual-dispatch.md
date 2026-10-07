# ADR-003: Outbox Pattern with Dual Dispatch

## Status
Accepted. Revised 2026-07-19 (integration-event routing via `IMessageBus`, lease-based claims for
safe scale-out, dead-letter visibility, post-commit dispatch; see Revision below). Revised
2026-08-01 (explicit exponential retry backoff supersedes polling-interval pacing; see Revision
below). Revised 2026-08-07 (random jitter on the retry backoff; see Revision below). Revised
2026-08-26 (opt-in per-key ordered dispatch, dead letters on their own retention window and
replayable, a backlog-age gauge, one transient retry before an unresolvable type is dead-lettered,
and the consumer-side inbox on by default for broker transports; see Revision below). **Amended by
[ADR-100](100-outbox-opt-in-resolved-from-messaging-mode.md)** (2026-08-29, v1.170.0): the outbox is no
longer unconditional. `MessageBus:EnableOutbox` is `bool?` and resolves from the transport exactly as
the inbox does, ON for a broker and OFF for `InProcess`, so a single-process host dispatches events
directly and runs neither background service; a broker with the outbox explicitly disabled is refused
at startup; and the `OutboxMessages` table stays mapped either way, so the flag is never a migration.
Everything below describes the outbox a host that runs it gets, unchanged.
Revised 2026-09-07 (shared broker and cache resources are namespaced per application by default,
so an unset `MessageBus:EndpointPrefix` now yields prefixed queue names unless
`MessageBus:PreserveDefaultEndpointNames` is `true`:
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:75-83`).
**Extended by [ADR-114](114-internal-commands-durable-job-queue.md)** (2026-09-09): a second
per-source table, `InternalCommands`, borrows this record's claim-lease, jittered-backoff and
dead-letter idiom to carry instructions rather than events. The outbox itself is unchanged, and the
two processors share one polling core: both delegate the main loop with its smart wait, the
per-source drain and the jittered retry backoff to the internal static `PollingLoop`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Polling/PollingLoop.cs:5-12`), while
each keeps its own queries, logging, metrics and activities.
Revised 2026-09-11 (an outbox row now captures the ambient request context when it is written,
`TenantId`, `UserId`, `UserRoles` and `CorrelationId`, and the processor restores that context onto
a fresh per-row scope before each row is dispatched; a consumer with a relational outbox source adds
one expand-only migration; see the Revision (2026-09-11) at the end).
Revised 2026-10-01 (domain event handlers do not flush a unit of work themselves, enforced by a
transitive fitness rule; see Revision below).
Revised 2026-10-07: each row's lease is renewed before dispatch and its outcome written as soon as
it finishes by a lock-token-guarded update (no batch save), and async-path local domain-event rows
are inserted already leased, so the lease, not the processing delay, bounds duplicate dispatch.

## Context
Domain events must be reliably published after aggregate changes are persisted. Two failure modes exist:
1. In-process dispatch fails (e.g., handler throws): the event is lost if not persisted.
2. Process crashes between persistence and dispatch: the event is lost if only dispatched in-memory.

## Decision
Use a dual-dispatch strategy:
1. **Outbox persistence**: Domain events are serialized into `OutboxMessage` rows within the same database transaction as the aggregate changes. This guarantees at-least-once persistence.
2. **In-process dispatch**: After `SaveChangesAsync`, events are dispatched immediately in-process via `DomainEventDispatcher` for low-latency handling.
3. **Background processor**: `OutboxProcessor` (a `BackgroundService`) wakes on an in-memory signal when new entries are written, or after a fallback polling interval (`Outbox:PollingIntervalSeconds`, default 2s; ADC prod sets 300s). Entries become eligible `Outbox:ProcessingDelaySeconds` after creation (default 5s); when a cycle sees pending-but-not-yet-eligible entries it **smart-waits** only until the earliest becomes eligible instead of sleeping the full interval. Eligible entries that throw during dispatch are retried up to 5 times, then dropped from the eligible set (a message whose event type cannot be resolved is retried once before being dead-lettered; see the Revision (2026-08-26)).
4. **Handlers do not save**: by default a domain event handler does not flush a unit of work itself. It mutates state and the owning save persists it; a write that must happen independently goes on the outbox. The transitive IL call-graph fitness rule `DomainEventHandlersDoNotSave` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.DomainEventHandlerSaves.cs:76`) enforces it, run through `DomainEventHandlerSaveTestsBase` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/DomainEventHandlerSaveTestsBase.cs:22`); a consumer names each accepted exception in its allowlist (see the Revision (2026-10-01)).

## Rationale
- **Guaranteed delivery**: The outbox table is written atomically with the aggregate changes. Even if the process crashes after persistence, the background processor catches up.
- **Low latency**: In-process dispatch handles the happy path without polling delay. In broker mode (`BrokerEventBus` persists the event to the outbox + signals; `OutboxProcessor` then publishes it to the broker via `IMessageBus`/`BrokerMessageBus`), the signal plus smart wait deliver integration events ~`ProcessingDelaySeconds` after publish even when the fallback interval is minutes long.
- **Idempotent handlers**: Domain event handlers must be idempotent since the same event may be dispatched both in-process and by the background processor if the in-process mark-as-processed fails.
- **Processing delay**: The eligibility delay holds a fresh row back from the background processor for `Outbox:ProcessingDelaySeconds`. On the async save path it is not what bounds the duplicate-dispatch window: local domain-event rows are inserted already leased for `Outbox:LeaseSeconds` (`MMCA.Common/.../Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:96-98`, lease applied at `:305-316`), so no poller claims them while the in-process pipeline (save -> dispatch -> mark processed) runs. A failed dispatch releases that lease under its token (`:387-390`, `:408-422`; `MMCA.Common/.../Outbox/Processing/OutboxFinalizer.cs:67`), so the processor retries once the processing delay has elapsed rather than after the full lease. The release is best effort: if it throws, the failure is logged and the rows wait out the full `Outbox:LeaseSeconds` (`DomainEventSaveChangesInterceptor.cs:403-405`, `:418-421`). The sync path writes no lease and never dispatches in-process, so its rows belong to the processor from the start (`DomainEventSaveChangesInterceptor.cs:108-111`). A dispatch that outlives the lease can still be re-dispatched (idempotency absorbs this).
- **Cheap idle polling**: A long fallback interval in deployed environments cuts idle DB chatter and its telemetry; additionally, the poll query runs inside an `OutboxPoll` activity that `OutboxPollFilterProcessor` (MMCA.Common.Aspire) suppresses from telemetry export, so idle polls do not flood Application Insights ingestion.

## Trade-offs
- Domain event handlers must be idempotent (this is a good practice regardless).
- The outbox table grows until processed entries are cleaned up: `OutboxCleanupService` purges rows whose `ProcessedOn` is older than `Outbox:RetentionDays` (default 7; set `0` to disable). See ADR-005.
- Two distinct failure mechanisms exist. A message whose event **type cannot be resolved** is
  retried once (the first unresolvable attempt is treated as transient; see the Revision
  (2026-08-26)) and then dead-lettered, which requires manual investigation.
  A message that **throws during dispatch** is retried up to `Outbox:MaxRetries` (default 5) times,
  then dropped from the eligible set (it stops being polled once `RetryCount >= MaxRetries`).
- Failed-message retries are paced by an explicit exponential backoff, not by the polling interval, and the backoff is randomized. A failure re-leases its own row for `Outbox:RetryBackoffBaseSeconds * 2^(n-1)` seconds multiplied by a random jitter factor in `[0.8, 1.2]`, capped at `Outbox:LeaseSeconds` (the re-lease at `MMCA.Common/.../Outbox/Processing/OutboxProcessor.cs:543-544`; `ComputeRetryBackoffSeconds` at `:858-859` delegates to the jitter-then-cap formula in `PollingLoop.ComputeRetryBackoffSeconds` at `MMCA.Common/.../Persistence/Polling/PollingLoop.cs:183-197`, jitter at `:193`, cap at `:196`). At the shipped defaults (base 10s, `MaxRetries` 5, lease 300s, batch 50: `MMCA.Common/.../Outbox/Administration/OutboxSettings.cs:17,21,84,101`) the four waits between the five attempts are ranges rather than fixed values: about 8-12s, 16-24s, 32-48s and 64-96s. A persistently failing message therefore spends **about 150 seconds of backoff (2.5 minutes), 120s to 180s across the jitter range**, before the fifth failure dead-letters it, and the 300s cap never binds at those defaults (the longest jittered wait tops out near 96s; only a sixth attempt, nominally 320s, could reach the cap).
- That backoff total is a floor, not a schedule. A backoff that expires between cycles is only noticed when the processor next wakes, and a failed-but-eligible row never shortens the wait (the next-cycle wait is computed only from the not-yet-eligible remainder: `OutboxProcessor.cs:202-210`), so the wall-clock horizon is the floor plus poll granularity at the 2s default interval, and up to one fallback interval per retry (about 20 minutes at the 300s prod interval) when no new write signals the loop sooner. A batch that dispatched nothing also does not re-poll immediately (`HasMoreEligibleWork` requires progress: `OutboxProcessor.cs:242`, reasoning at `:235-239`), so a batch of 50 that fails in full cannot hot-spin the processor. With progress, the loop re-polls at once both for a full eligible batch and for key-mates the cycle deferred behind their key's head row, so an ordering key is not serialized at one row per poll (`:242`).
- Rows orphaned by a process crash (no signal exists) wait up to the polling interval before the safety-net pickup. A local domain-event row written on the async path first waits out the lease it was inserted under (`Outbox:LeaseSeconds`, default 300s: `OutboxSettings.cs:79-84`), because nothing released it (`DomainEventSaveChangesInterceptor.cs:20-23`).

## Revision (2026-07-19)
Four changes from the 2026-07-19 full review:

1. **Integration events route through the outbox to `IMessageBus`, never local dispatch.** An
   `IIntegrationEvent` raised via `AddDomainEvent` used to be dispatched in-process and marked
   processed, silently never reaching the wire in broker mode. Now
   `DomainEventSaveChangesInterceptor` writes its outbox row but does NOT dispatch it in-process;
   the row stays unprocessed and `OutboxProcessor` publishes it via `IMessageBus`, so the
   registered transport (in-process for the monolith, MassTransit broker for extracted services)
   determines delivery. `AddDomainEvent(integrationEvent)` is therefore broker-correct. Pure
   domain events keep the dual-dispatch fast path described above.
2. **Lease-based claims make scale-out safe by construction.** `OutboxMessage` gains `LockedUntil`
   and `LockToken`: before dispatching, a processor replica claims the eligible batch with an
   atomic `ExecuteUpdateAsync` lease (`Outbox:LeaseSeconds`, default 300); other replicas skip
   rows under an unexpired lease and a race between two claim updates resolves per row (each
   replica processes only rows carrying its own token). A replica that dies mid-batch releases its
   rows implicitly when the lease expires. Running `minReplicas: 1` is therefore **no longer a
   correctness requirement for the outbox** (previously two replicas could drain the same rows and
   double-dispatch every event); it remains a cost choice, and ADR-030's sole-migrator rationale
   for the setting stands on its own.
3. **Dead-letter visibility.** Retry exhaustion is now loud: the `outbox.dead_letter.count` metric
   gets a `reason=retries_exhausted` tag (beside the existing `type_unresolvable`), an Error-level
   log fires at the moment of exhaustion (the operator's last signal before the row leaves the
   poll), and `Outbox:DeadLetterRetentionDays` retains dead-lettered payloads longer than
   `Outbox:RetentionDays` (0 = same retention) for diagnosis and manual replay before
   `OutboxCleanupService` purges them.
4. **In-process dispatch defers until after commit.** When the save runs inside a transaction (the
   ADR-014 Transactional path), the post-save dispatch/mark-processed work is deferred and flushed
   only after a successful commit; rollback (exception or the new business-failure rollback,
   ADR-014 Revision) drops it together with the outbox rows.

## Revision (2026-07-24)
Three capture-side corrections found in a code review. None change the dual-dispatch decision; they
close gaps between what it promised and what the interceptor did.

1. **Capture removes exactly what it captured.** The post-dispatch cleanup used to clear an
   aggregate's event list wholesale, which also discarded anything a handler raised on that same
   aggregate *during* in-process dispatch: those events arrive after the capture and were wiped
   before any later capture could see them, so they never dispatched and never reached the outbox.
   Capture now snapshots each aggregate's events and removes only those (`IAggregateRoot`
   `.RemoveDomainEvents`), leaving a handler-raised event pending for the next save.
2. **A retried operation writes one row per event.** `ExecuteInTransactionAsync` runs under an EF
   execution strategy that re-runs the whole delegate on a transient fault, against the same cached
   `DbContext` instances. Because capture runs on every `SavingChanges` pass while the aggregate's
   events are only cleared after a *successful* save, each attempt appended another outbox row per
   event: one transient SQL failure published every integration event twice. Capture now discards an
   abandoned capture's staged rows, and the retry path clears the change tracker first so entities
   added by the failed attempt are not inserted again either.
3. **Shutdown does not consume retries.** The dispatch loop's general `catch` also caught the
   cancellation raised at host shutdown, incrementing `RetryCount` and stamping `LastError` on the
   whole remainder of the batch. A graceful restart could therefore dead-letter messages that were
   never actually attempted. Cancellation now rethrows and the batch is left untouched.

## Revision (2026-08-01)
One retry-pacing correction. The dual-dispatch decision is unchanged; the Trade-offs above described
a cadence the processor no longer has.

1. **Retry backoff is explicit, and it supersedes polling-interval pacing.** Before
   `Outbox:RetryBackoffBaseSeconds` existed, a failed row simply kept the claim its cycle had taken,
   and because the poll skips leased rows the next attempt could not happen until the FULL
   `Outbox:LeaseSeconds` (300s) elapsed, whatever the polling interval or an explicit signal said:
   the retry cadence was an accident of the lease rather than a decision
   (`MMCA.Common/.../Settings/OutboxSettings.cs:89-96`). A failure now re-leases its row for
   `RetryBackoffBaseSeconds * 2^(n-1)` seconds, capped at the lease so a permanently failing message
   never holds a claim longer than a dead replica's rows would
   (`MMCA.Common/.../Outbox/OutboxProcessor.cs:644-645`, formula at `:734-748`). At the shipped defaults that was
   10s, 20s, 40s and 80s between the five attempts: 150 seconds of enforced backoff before
   dead-lettering, shortening the first retries while still throttling a message that will never
   succeed. Those four waits are no longer exact values; the jitter added on 2026-08-07 (see the
   Revision below) spreads each of them by plus or minus 20%. The Trade-offs bullet that quoted
   "~25 minutes" at a 300s interval is replaced by the curve plus its wake-cadence ceiling above.

## Revision (2026-08-07)
One retry-pacing refinement. The decision and the curve are unchanged; the waits are no longer
identical across a batch.

1. **The retry backoff carries random jitter.** The exponential wait is multiplied by a random
   factor in `[0.8, 1.2]` before the lease cap is applied, so the four waits between the five
   attempts are about 8-12s, 16-24s, 32-48s and 64-96s at the shipped defaults instead of exactly
   10s, 20s, 40s and 80s (`MMCA.Common/.../Outbox/OutboxProcessor.cs:744`, cap applied at `:747`). The reason is the
   failure mode the backoff alone does not cover: one dependency outage fails all 50 rows of a batch
   in the same instant, and a deterministic curve then retries all 50 on a single shared schedule,
   re-hammering that dependency in synchronized bursts. Jitter spreads the attempts apart. The
   jitter is applied before the cap so a capped backoff still lands exactly on the lease bound, and
   the generator is deliberately pseudorandom: it spaces retries and feeds no security decision.
   The practical consequence for operators is that "150 seconds before dead-lettering" is now an
   expectation (120s to 180s), not a guarantee.

## Revision (2026-08-26)
Five changes. The dual-dispatch decision is unchanged; what changes is what happens to a message
that must not overtake its predecessor, to one that never made it out, and to the duplicate a broker
hands a consumer twice.

1. **Ordered delivery per key, opt-in, with head-of-line semantics.** An event that implements
   `IHasOrderingKey` (one member, `string? OrderingKey`, typically the aggregate id:
   `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IHasOrderingKey.cs:24-31`) has that value
   copied onto its outbox row
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:79`,
   copied at `:116`), and the processor refuses to claim a keyed row while an EARLIER unprocessed,
   non-dead-lettered row carries the same key. The guard lives in the claim itself, as a correlated
   `NOT EXISTS` inside the same `ExecuteUpdateAsync` that takes the lease
   (`.../Outbox/Processing/OutboxProcessor.cs:546-556`, applied at `:475-483`), so a second replica racing the
   same key loses on the row rather than on a check it made before the race started (`:538-542`);
   ordering therefore holds across batches and across scaled-out replicas, not merely within one batch
   (`:439-442`). Within a cycle, the candidate set keeps at most one row per key, so a single batch
   never dispatches two events of one key in parallel (`:509-525`, reasoning at `:502-508`). This is
   head-of-line blocking by design: a keyed row that is failing and backing off blocks every later row
   with the same key, which is why keys must be as narrow as the ordering requirement really is (one
   key per aggregate serializes that aggregate; a constant key serializes the whole outbox:
   `IHasOrderingKey.cs:15-22`). A row that exhausts its retries stops blocking, so a poison event
   cannot freeze its key forever (`OutboxProcessor.cs:446-447`, the `RetryCount` term of the predicate
   at `:555`). Two costs are recorded in code: a batch containing no keyed row runs exactly the query
   it always ran, so hosts that never declare a key pay nothing, not even a subquery the optimizer has
   to prove away (`:470-475`); and the predecessor test is on `OccurredOn` alone, so two rows sharing
   a key and an exact timestamp do not block each other in SQL (`:448-452`, `:556`). A tie at tick
   resolution is not an ordering the outbox claims to observe.
2. **A dead letter is evidence, so it gets its own retention window and a way back.**
   `OutboxCleanupService` sweeps dead-lettered rows on `Outbox:DeadLetterRetentionDays`, falling back
   to `Outbox:RetentionDays` when it is `0`, and keys the cutoff on `OccurredOn` because a dead letter
   never gets a `ProcessedOn` (`.../Outbox/OutboxCleanupService.cs:158-169`, rationale at `:140-151`;
   `.../Settings/OutboxSettings.cs:108`, contract at `:101-106`). Setting that window wider than
   `RetentionDays` is what keeps an undelivered payload around long enough to diagnose. Deletion is
   the one cleanup action that cannot be undone, so every sweep that removes rows logs one Warning
   per source naming the count (`OutboxCleanupService.cs:171-174`, message at `:226`). The way back is
   `IOutboxAdministration`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IOutboxAdministration.cs:16`),
   an operator surface a host exposes from an admin endpoint, a support command or a scheduled job
   (`:5-14`), registered scoped by the framework
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:202-203`):
   `ListDeadLettersAsync(dataSource, skip, take)` pages them oldest first across every outbox source
   the host owns or one named source (`IOutboxAdministration.cs:30-34`, contract at `:18-29`);
   `ReplayDeadLettersAsync(dataSource, ids)` returns them to the pending pool, with `RetryCount` to
   zero and the lease cleared, `LastError` deliberately KEPT because the reason is the first thing
   anyone asks after a replay, and `OccurredOn` untouched so a replayed row keeps its place in its
   ordering key (`:51-54`, reasoning at `:36-40`); and `CountPendingAsync(dataSource)` counts the
   tables at the moment of the call, including rows under a claim lease, which is the difference
   between it and the `outbox.pending.depth` gauge (`:65`, contrast drawn at `:56-61`). Every method
   returns `Result` (ADR-013): an unreachable or unknown source is a failure an operator screen
   renders, not an exception (`:11-13`). The projected `OutboxDeadLetter` record deliberately omits
   the event payload, which can carry personal data (ADR-005) and answers nothing a replay decision
   depends on (`:80-87`, stated at `:68-72`).
3. **A new gauge reports how late the backlog already is.** `outbox.oldest_pending.age` (seconds,
   tagged `data_source`, on the existing `MMCA.Common.Outbox` meter:
   `.../Outbox/OutboxMetrics.cs:98-102`, meter name at `:19`, published per cycle at `:115-116`) is
   the age of the oldest row still awaiting dispatch, observed per source at the start of its most
   recent cycle. Where `outbox.dispatch.lag` (`:57-60`) reports how late the messages that DID arrive
   were, this one reports how late a stuck backlog is while it is still stuck, which is what an alert
   on a wedged outbox fires on (`:81-86`). It costs nothing extra: the poll already fetches pending
   rows ordered by `OccurredOn`, so its first row IS the minimum and no `MIN()` query is ever issued
   (`:87-90`). It reuses the poll's predicate, so rows under another replica's lease and dead letters
   are excluded, which makes it deliverable backlog rather than table age (`:90-94`); a source with
   nothing pending reports `0` rather than dropping out of the series, and a source whose database was
   unreachable keeps its previous value until its next successful cycle (`:94-97`).
4. **A stored event identity that survives refactoring is declared, not repaired afterwards.**
   `[EventName("Sales.OrderPlaced.v1")]` on the event class is the one stable-identity mechanism
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/EventNameAttribute.cs:31-32`, contract at
   `:3-12`): the outbox row stores that name in place of the assembly-qualified type name
   (`.../Outbox/EventNameResolver.cs:47-51`, written at `.../Outbox/OutboxMessage.cs:107`), so a
   rename, a namespace move and an assembly move all leave the rows already written still resolvable.
   Resolution reads the stored name alone, CLR name first and the attribute scan only when that
   misses, with the result cached per stored name (`OutboxMessage.cs:147-153`, scan at
   `EventNameResolver.cs:75-81`). The trade-off is that the attribute only ever changes what NEW rows
   store, so it has to be applied BEFORE the refactoring: an event renamed without one orphans every
   row already written under its old CLR name, and those rows dead-letter
   (`EventNameAttribute.cs:14-19`). Adopting it while the outbox holds pending rows is therefore a
   two-step move: drain first, then rename. Beside it, the first unresolvable attempt is treated as
   transient and retried through the normal backoff, because the assembly declaring the type may
   simply not be loaded yet (a lazily resolved module assembly, a host still coming up) and a name
   that resolves one cycle later was never a dead letter (`.../Outbox/OutboxProcessor.cs:701-714`,
   reasoning at `:689-695`). Only the second attempt is terminal (`:716-722`), which is also the point
   at which the operator has had a Warning naming the row (`:714`, message at `:826`). A host that set
   `Outbox:MaxRetries` to 1 asked for no retries at all and gets none (`:707-711`). A payload whose
   fields changed shape is a different problem: it needs a new event type and an upcaster (ADR-090).
5. **The consumer-side inbox is on by default wherever redelivery is possible.**
   `MessageBus:EnableInbox` is now three-valued (`.../Settings/MessageBusSettings.cs:117`): an explicit
   setting wins in both directions (`:111`), and left unset it resolves ON for a broker provider and
   OFF for the in-process one, which has no redelivery to dedup (`:102`, reasoning at `:103-108`). Broker
   delivery is at-least-once by contract, so with the inbox off every redelivery became a duplicate
   side effect unless each handler happened to be idempotent on its own (`:103-107`); a host that must
   not query the table yet sets `false` explicitly and still gets its one startup Warning
   (`.../Persistence/Inbox/InboxDisabledWarningService.cs:13-16`, message at `:35`). The inbox row
   also stops being a separate write: `TryBeginAsync` STAGES it in the scope's unit of work unsaved
   (`.../Persistence/Inbox/EfInboxStore.cs:61-68`), so a handler that saves on that same scope commits
   the row in the same transaction as its own mutations, and the window where a crash between "handler
   committed" and "inbox written" reprocessed the whole event is closed by construction rather than by
   asking every handler to be idempotent (`:16-22`; `CompleteAsync` writes only if nothing else did,
   `:71-89`). A handler failure abandons the staged row before rethrowing, so the retry does not see
   its own abandoned attempt as a duplicate (`.../Services/IntegrationEventConsumer.cs:69`, abandon at
   `:74`, rethrow at `:81`, detach at `EfInboxStore.cs:106-109`). ADR-021 owns the inbox contract; this is the
   outbox-side consequence, and it makes the delivery story symmetric: the outbox guarantees the event
   leaves, the inbox guarantees it lands once.

## Revision (2026-09-07)
The dispatch model is unchanged. What changed is the **name** the outbox's downstream resources take
by default, from the 2026-09-07 security review (SEC-Common-53).

`ApplicationNamespace.Resolve`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/ApplicationNamespace.cs:53`)
derives one namespace from `Application:Namespace`, falling back to the host application name, and
that namespace now supplies three defaults that used to be empty: `MessageBus:EndpointPrefix`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:66`, resolved at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:793`), `Cache:KeyPrefix`
and with it the distributed-lock keyspace
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:83`, rationale at
`:68`), and the SignalR Redis backplane channel prefix (`DependencyInjection.cs:653`). Two
applications sharing one broker or one Redis therefore no longer share a queue name or a cache key by
accident.

**The cutover rule this creates.** Adopting the upgrade renames resources: queue names gain a prefix,
cache and lock keys gain a prefix (a cold cache after deploy), and the backplane moves channel. A
consumer that must keep its current names pins the pre-upgrade values explicitly (set
`Application:Namespace`, or the individual prefix keys) **before** upgrading; a consumer that takes
the new names drains the old broker queues on cutover, because in-flight messages sit under the old
endpoint name and nothing reads it afterwards.

## Revision (2026-09-11)
The dispatch model is unchanged: same table, same claim lease, same dual dispatch, same retry and
dead-letter policy. What changed is what a row carries, because the hop was dropping the thing that
made the delivered work attributable.

**The hole the columns close.** An event written inside a request was delivered one poll cycle later
on a background scope that had no principal, no tenant and no correlation id. A handler reading
`ICurrentUserService` saw nobody, its own writes were stamped with the audit sentinel, a host running
the shared-schema tenant filter ([ADR-073](073-multi-tenancy-model.md)) read across tenants, and
nothing in the logs joined the delivery back to the request that produced it. The deferred-command
queue ([ADR-114](114-internal-commands-durable-job-queue.md)) had already solved exactly this on its
own row; the outbox now does it through the same helper, so the two hops cannot drift.

**Four nullable columns, captured at write time.** `OutboxMessage` gains `TenantId`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:93`),
`UserId` (`:100`), `UserRoles` (`:106`) and `CorrelationId` (`:113`), filled from an `OutboxOrigin`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxOrigin.cs:29`) by
`FromDomainEvent(IDomainEvent domainEvent, OutboxOrigin origin = default)` (`OutboxMessage.cs:131`,
assignments at `:144`-`:147`). The origin is produced once per save by an accessor the scoped context
factory attaches
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:149`-`:153`)
and read through `ApplicationDbContext.CurrentOutboxOrigin`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:146`,
backing property at `:140`), so the role flattening costs one pass per save rather than one per row.
All three write paths take it from there: the domain-event interceptor
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:247`,
`:251`), `InProcessEventBus`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:89`, `:93`) and
`BrokerEventBus`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:81`, `:85`). Roles
are flattened to a comma-separated list truncated to the column width by the shared helper
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/AmbientOrigin.cs:41`, the 512-character
cap at `:25`). The mapping mirrors the `InternalCommands` columns deliberately: `varchar(64)` tenant,
`varchar(512)` roles, `varchar(64)` correlation id (`ApplicationDbContext.cs:652`-`:654`).

**Restored per row, overwritten per row.** `OutboxProcessor` calls `AmbientOrigin.Restore` on the
cycle's scope before the row is deserialized, published or dispatched
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:607`-`:613`),
stamping the rebuilt identity with the authentication type `Outbox` (`:81`), which is what makes it
read as authenticated and names the hop it came back from. The restore overwrites rather than
accumulates: the principal is set or cleared on every call (`AmbientOrigin.cs:145`-`:156`) and the
correlation id is overwritten whenever the row carries one (`:158`-`:161`), so one row's identity can
never answer for the next row of the same batch. The tenant is the one value that is not overwritten.
It is set only when the scope has not already resolved a different tenant
(`AmbientOrigin.cs:137`-`:143`), because `ITenantContext` is single-valued for the life of a scope by
contract and a scope whose tenant changed mid-flight has already read rows under the previous one.

**The consumer-visible cost: one expand-only migration per relational outbox source.** Every column is
nullable, nothing is renamed and nothing is dropped, so this is an expand-only change
([ADR-057](057-expand-contract-schema-evolution-gate.md)) and the migration and the package can be
deployed in either order. A row written before the upgrade reads back as "nothing was captured",
which is exactly what it is, and the one-argument `FromDomainEvent(domainEvent)` still compiles and
still stores four nulls. Cosmos sources need nothing, because `CosmosDbContext` does not map the
outbox.

The broker half of the same hop is recorded in [ADR-021](021-consumer-inbox-idempotency.md): the same
four values travel as `MMCA-*` message headers and are restored on the consuming scope before the
inbox is touched.

## Revision (2026-10-01)
The dual-dispatch decision is unchanged. One rule is added to it (Decision item 4), and several
statements made by earlier revisions no longer describe the code. The current-state sections above
are corrected; the earlier Revision sections stay as written and are superseded where noted here.

1. **Domain event handlers do not save.** Dispatch runs after `SaveChangesAsync` (after commit
   inside an `ITransactional` command), so a handler that saves opens a second write in the middle
   of the first one: it re-enters the change tracker, can raise a fresh event cascade, and persists
   work the outer transaction may still roll back
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.DomainEventHandlerSaves.cs:23-29`).
   `DomainEventHandlersDoNotSave` (`:76-79`) reads IL through Mono.Cecil and walks the call graph
   breadth-first out of every `IDomainEventHandler<T>` method, following direct calls, delegate
   creations, interface and virtual calls expanded to their implementations, and async state
   machines (`:37-49`), to a default depth of 6 (`:79`). An allowlist entry silences a type and stops
   the walk from descending into it (`:51-60`); the shared base defaults it to `MMCA.Common`, because
   the framework's outbox event bus persists by design
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/DomainEventHandlerSaveTestsBase.cs:33`,
   the test at `:42-44`). Its limits are stated in code: a bounded depth, interface dispatch resolved
   only inside the scanned assemblies, and reflection or DI-resolved delegates invisible (`:61-69` of
   the rule file). Adoption: MMCA.ADC subclasses the base
   (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/DomainEventHandlerSaveTests.cs:11`)
   and allowlists one accepted trade-off, the gamification `PointsAwarder` (`:27`). MMCA.Store's
   `main` subclasses it
   (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/DomainEventHandlerSaveTests.cs:19`)
   and allowlists three handlers that commit an independent, idempotent follow-up write in their own
   scope: `UserRegisteredHandler` (`:39`), `OrderCancelledSagaHandler` (`:53`) and
   `ProductReviewChangedHandler` (`:67`). MMCA.Helpdesk has no subclass and does not run the rule.
2. **The two polling processors share one implementation of the loop.** The 2026-09-09 Status line
   said the outbox and internal-command processors shared an idiom rather than an implementation.
   Both now delegate to the internal static `PollingLoop`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Polling/PollingLoop.cs:5-12`):
   `OutboxProcessor` at `MMCA.Common/.../Outbox/Processing/OutboxProcessor.cs:113`, `:163` and `:692`,
   `InternalCommandProcessor` at
   `MMCA.Common/.../Persistence/InternalCommands/Processing/InternalCommandProcessor.cs:82`, `:138` and
   `:644`. Each passes its own cap to the shared backoff (`PollingLoop.cs:181-183`): the outbox caps at
   `Outbox:LeaseSeconds`.
3. **Each row is delivered on its own scope.** The Revision (2026-09-11) restored the captured
   context onto the cycle's scope. The processor now creates a fresh scope per row
   (`OutboxProcessor.cs:520`) and restores onto it (`:525-531`); the cycle scope's context still
   tracks the rows for the batch save (rationale at `:487-497`). The consequence for tenants differs
   from what that revision recorded: because the tenant context refuses a change once resolved, a
   shared scope ran every later row of a shared-target batch under the first row's tenant, and the
   fresh scope is what lets the tenant change between rows (`:489-491`, `:518-519`).
4. **Shutdown persists the stamps already earned.** The Revision (2026-07-24) item 3 says the batch
   is left untouched on cancellation. Cancellation still rethrows without counting a retry
   (`OutboxProcessor.cs:579-586`), but the cycle first saves the change-tracked stamps of the rows it
   already handled (`:241-251`, `TryPersistStampsOnCancellationAsync` at `:312-324`), so a message
   delivered before a graceful shutdown is not redelivered when its lease expires. Rows not yet
   reached stay untouched.
5. **Keeping the old queue names is a flag, not a prefix.** The Revision (2026-09-07) cutover rule
   says a consumer keeping its names pins `Application:Namespace` or the prefix keys. No prefix value
   reproduces the old queue names, because the endpoint formatter changed
   (`MMCA.Common/CHANGELOG.md:1366-1367`); the opt-out is `MessageBus:PreserveDefaultEndpointNames=true`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:75-83`), which
   skips the prefixed formatter entirely
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:75-86`).
6. **Two omissions, recorded.** The broker publish runs under a circuit breaker with no retry
   strategy of its own (`OutboxProcessor.cs:96-108`, applied at `:551-555`); an open-circuit
   rejection follows the normal failure path, incrementing `RetryCount` and re-leasing the row
   (`:589-599`, `:603-609`), so a broker outage longer than the backoff curve dead-letters messages
   once `MaxRetries` is reached (`:623`). And the poll fetches the oldest `BatchSize` pending rows
   with no key awareness, so a key with `BatchSize` or more pending rows fills the fetch window and
   delays unrelated newer rows until it drains or its head row dead-letters
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IHasOrderingKey.cs:24-27`).
7. **Citations refreshed in the current-state sections.** The outbox files now sit under
   `Persistence/Outbox/Administration/` (`OutboxSettings`, `OutboxCleanupService`) and
   `Persistence/Outbox/Processing/` (`OutboxProcessor`, `OutboxMetrics`, `EventNameResolver`). For
   readers following the older revisions: `IHasOrderingKey` is at `IHasOrderingKey.cs:29-36` (member
   `:35`); `OrderingKey` at `OutboxMessage.cs:86`, copied at `:152`, the stored event name written at
   `:139` and resolved at `:183-189`; the ordering guard `FilterUnblocked` at
   `OutboxProcessor.cs:468-478` (the `RetryCount` term `:477`, the `OccurredOn` term `:478`), chosen
   only for a batch holding a keyed row (`:394-399`), with the one-row-per-key selection at
   `:431-447`; `HandleUnresolvableType` at `:661-684`; the dead-letter sweep at
   `OutboxCleanupService.cs:155-171`; `IOutboxAdministration` under
   `MMCA.Common.Application/Interfaces/Infrastructure/Persistence/`, registered at
   `DependencyInjection.cs:219-220`; `EnableInbox` at `Messaging/MessageBusSettings.cs:133`; the
   consumer's abandon at `Messaging/Consumers/IntegrationEventConsumer.cs:101` (rethrow `:108`); and
   the endpoint prefix resolved at `DependencyInjection.Messaging.cs:80-82`, the SignalR channel prefix
   at `DependencyInjection.Notifications.cs:59-61`.

## Revision (2026-10-06)
No content change: the dispatch model, the retry curve and every behavior recorded above still hold.
The earlier Revision sections keep the anchors recorded on their dates; for readers following them,
the load-bearing locations now are:

- `OutboxProcessor` (`MMCA.Common/.../Outbox/Processing/OutboxProcessor.cs`): `PollingLoop.RunAsync`
  at `:107`, `PollingLoop.DrainAllAsync` at `:152`, `ComputeRetryBackoffSeconds` at `:688-689`; the
  per-row scope at `:516` with `AmbientOrigin.Restore` at `:522`; the cancellation catch at `:576`
  and `TryPersistStampsOnCancellationAsync` at `:304`; the `MaxRetries` dead-letter check at `:620`;
  the `Outbox` authentication type at `:76`.
- `OutboxMessage` (`MMCA.Common/.../Persistence/Outbox/OutboxMessage.cs`): `OrderingKey` at `:88`
  (copied at `:154`), `TenantId` at `:95`, `UserRoles` at `:108`, `CorrelationId` at `:115`,
  `FromDomainEvent` at `:133` (origin assignments at `:146-149`), the stored event name at `:141`
  and resolved at `:201`.
- The origin: `ApplicationDbContext.CurrentOutboxOrigin` at
  `MMCA.Common/.../Persistence/DbContexts/ApplicationDbContext.cs:177` (accessor property `:171`),
  attached at `.../DbContexts/Factory/DbContextFactory.cs:156`; `AmbientOrigin.FlattenRoles` at
  `MMCA.Common/.../Context/AmbientOrigin.cs:54`, the 512-character `MaxRolesLength` at `:38`,
  `Restore` at `:156`.
- `IOutboxAdministration` lives at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IOutboxAdministration.cs`,
  registered at `MMCA.Common/.../Infrastructure/DependencyInjection.cs:229` inside the
  `IsOutboxEnabled` branch (`:217`).
- `MessageBus:EndpointPrefix` at `MMCA.Common/.../Messaging/MessageBusSettings.cs:73`, resolved at
  `MMCA.Common/.../Infrastructure/DependencyInjection.Messaging.cs:81-83`.
- `IHasOrderingKey` at `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IHasOrderingKey.cs:31`,
  member `OrderingKey` at `:37`.

Anchors in the current-state sections were re-verified against current source (Trade-offs
`OutboxProcessor.cs` cites moved).

## Revision (2026-10-07)
Re-verified against current source. The dual-dispatch decision, the claim lease, the ordering
guard and the jittered retry curve (`MMCA.Common/.../Persistence/Polling/PollingLoop.cs:183-197`)
are unchanged. What moved is how a claimed row's outcome reaches the database and how a local
domain-event row is protected while it is dispatched in-process, which supersedes the Revision
(2026-10-01) items 3 and 4 and the "no content change" line of the Revision (2026-10-06). The
current-state Rationale and Trade-offs above are corrected; the earlier Revision sections stay as
written.

1. **Each row's outcome is written as the row finishes, under the batch's lock token.** There is
   no batch save (`MMCA.Common/.../Outbox/Processing/OutboxProcessor.cs:229-231`). After delivery
   the cycle calls `RecordOutcomeAsync` (`:592`, defined at `:612-634`), which writes through
   `WriteOutcomeAsync` (`:661-669`) to `RecordDeliveredAsync` (`:723`) or `RecordFailureAsync`
   (`:757`). Both end in `StampAsync` (`:789-810`), a set-based `ExecuteUpdateAsync` guarded on the
   row id and the lock token only, with no `LockedUntil` term (`:795-796`). An expired lease alone
   does not void the write: the stamp still lands while no other replica has claimed the row. Once
   another replica re-claims it under a new token, the update matches nothing, and the replica
   logs the lost lease and detaches its stale copy rather than overwriting the new owner's record
   (`:801-805`). A database failure while recording the outcome is not charged to the row
   as a retry; it propagates and fails the source for the cycle (`:587-590`).
2. **Each row's lease is renewed just before it is dispatched.** The claim lease covers the whole
   batch, so a slow batch could outlive it. `RenewLeaseAsync` (`:703-717`, called at `:484`)
   resets the row's `LockedUntil` to now plus `Outbox:LeaseSeconds` (`:709`, `:713`) in a statement
   guarded on the lock token, and a row that no longer carries the token is skipped, not dispatched (`:485-487`). The
   cycle scope's context holds the claimed rows and writes each renewal and outcome; only delivery
   moves to the fresh per-row scope (`:451-452`, scope at `:498`, tenant rationale at `:443-447`).
3. **Shutdown writes the outcome of the row in flight, then rethrows.** If the batch token is
   already cancelled when a row finishes, or is cancelled during the write (`:619-631`),
   `RecordOutcomeOnShutdownAsync` (`:640-658`) writes that row's outcome under its own
   `ShutdownStampTimeout` of 5 seconds (`:89`), logs rather than throws a failure of that write,
   and then rethrows the cancellation (`:657`), so a delivery that finished before shutdown is not
   redelivered. One case is not covered: when delivery itself throws `OperationCanceledException`
   under shutdown, the catch at `:524-530` rethrows before the outcome write, so that row is not
   stamped and becomes claimable again once its lease expires. Rows not yet reached stay untouched.
4. **Async-path local domain-event rows are inserted already leased.** The async save inserts each
   local event's row with `LockedUntil` set to now plus `Outbox:LeaseSeconds` under a fresh token
   (`MMCA.Common/.../Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:96-98`, `:280`,
   `:305-316`; `MMCA.Common/.../Outbox/Administration/OutboxSettings.cs:79-84`), so no replica's
   poller delivers the event while this process still handles it. A failed in-process dispatch
   releases the lease under that token (`DomainEventSaveChangesInterceptor.cs:387-390`, `:408-422`;
   `MMCA.Common/.../Outbox/Processing/OutboxFinalizer.cs:67`), so the processor retries promptly.
   The release is best effort: a failed release is logged and the rows wait out the full lease
   (`:403-405`, `:418-421`). A crash leaves the rows to the processor once the lease expires (`:20-23`). The sync path
   writes no lease (`:108-111`). Integration-event rows are never leased at insert (`:226`).
5. **Anchors re-verified against current source:** `OutboxProcessor.cs`: `PollingLoop.RunAsync` at
   `:110`, `PollingLoop.DrainAllAsync` at `:155`, `ComputeRetryBackoffSeconds` at `:858-859`, the
   per-row `CreateTenantScope` at `:498` with `AmbientOrigin.Restore` at `:505`, the cancellation
   catch at `:524`, the failure re-lease at `:543-544`, the `MaxRetries` dead-letter check at
   `:568`, the `Outbox` authentication type at `:79`; the broker publish pipeline field at `:105`
   (built at `:868-870`, applied at `:685`); the eligible split at `:202-210` and the re-poll test
   at `:242`; the ordering guard `FilterUnblocked` at `:424-434` (the correlated `!outbox.Any` at
   `:431`, the `RetryCount` term `:433`, the `OccurredOn` term `:434`), chosen only for a batch
   holding a keyed row (`:353-355`) and applied inside the claim's `ExecuteUpdateAsync`
   (`:357-361`); `SelectOrderedCandidates` at `:387-403`; `HandleUnresolvableType` at `:828`.
   `OutboxSettings.cs`: `BatchSize` `:17`, `MaxRetries` `:21`, `LeaseSeconds` `:84`,
   `RetryBackoffBaseSeconds` `:101`. `PollingLoop.cs`: jitter `:193`, cap `:196`.
