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

## Context
Domain events must be reliably published after aggregate changes are persisted. Two failure modes exist:
1. In-process dispatch fails (e.g., handler throws): the event is lost if not persisted.
2. Process crashes between persistence and dispatch: the event is lost if only dispatched in-memory.

## Decision
Use a dual-dispatch strategy:
1. **Outbox persistence**: Domain events are serialized into `OutboxMessage` rows within the same database transaction as the aggregate changes. This guarantees at-least-once persistence.
2. **In-process dispatch**: After `SaveChangesAsync`, events are dispatched immediately in-process via `DomainEventDispatcher` for low-latency handling.
3. **Background processor**: `OutboxProcessor` (a `BackgroundService`) wakes on an in-memory signal when new entries are written, or after a fallback polling interval (`Outbox:PollingIntervalSeconds`, default 2s; ADC prod sets 300s). Entries become eligible `Outbox:ProcessingDelaySeconds` after creation (default 5s); when a cycle sees pending-but-not-yet-eligible entries it **smart-waits** only until the earliest becomes eligible instead of sleeping the full interval. Eligible entries that throw during dispatch are retried up to 5 times, then dropped from the eligible set (a message whose event type cannot be resolved is retried once before being dead-lettered; see the Revision (2026-08-26)).

## Rationale
- **Guaranteed delivery**: The outbox table is written atomically with the aggregate changes. Even if the process crashes after persistence, the background processor catches up.
- **Low latency**: In-process dispatch handles the happy path without polling delay. In broker mode (`BrokerEventBus` persists the event to the outbox + signals; `OutboxProcessor` then publishes it to the broker via `IMessageBus`/`BrokerMessageBus`), the signal plus smart wait deliver integration events ~`ProcessingDelaySeconds` after publish even when the fallback interval is minutes long.
- **Idempotent handlers**: Domain event handlers must be idempotent since the same event may be dispatched both in-process and by the background processor if the in-process mark-as-processed fails.
- **Processing delay**: The eligibility delay prevents the background processor from re-dispatching events that were already dispatched in-process but not yet marked as processed. It bounds the duplicate-dispatch window: the in-process pipeline (save → dispatch → mark processed) must finish within it, or the event is re-dispatched (idempotency absorbs this).
- **Cheap idle polling**: A long fallback interval in deployed environments cuts idle DB chatter and its telemetry; additionally, the poll query runs inside an `OutboxPoll` activity that `OutboxPollFilterProcessor` (MMCA.Common.Aspire) suppresses from telemetry export, so idle polls do not flood Application Insights ingestion.

## Trade-offs
- Domain event handlers must be idempotent (this is a good practice regardless).
- The outbox table grows until processed entries are cleaned up: `OutboxCleanupService` purges rows whose `ProcessedOn` is older than `Outbox:RetentionDays` (default 7; set `0` to disable). See ADR-005.
- Two distinct failure mechanisms exist. A message whose event **type cannot be resolved** is
  retried once (the first unresolvable attempt is treated as transient; see the Revision
  (2026-08-26)) and then dead-lettered, which requires manual investigation.
  A message that **throws during dispatch** is retried up to `Outbox:MaxRetries` (default 5) times,
  then dropped from the eligible set (it stops being polled once `RetryCount >= MaxRetries`).
- Failed-message retries are paced by an explicit exponential backoff, not by the polling interval, and the backoff is randomized. A failure re-leases its own row for `Outbox:RetryBackoffBaseSeconds * 2^(n-1)` seconds multiplied by a random jitter factor in `[0.8, 1.2]`, capped at `Outbox:LeaseSeconds` (the re-lease at `MMCA.Common/.../Outbox/OutboxProcessor.cs:642-643`, the jitter-then-cap formula in `ComputeRetryBackoffSeconds` at `:732-746`). At the shipped defaults (base 10s, `MaxRetries` 5, lease 300s, batch 50: `MMCA.Common/.../Settings/OutboxSettings.cs:17,21,82,99`) the four waits between the five attempts are ranges rather than fixed values: about 8-12s, 16-24s, 32-48s and 64-96s. A persistently failing message therefore spends **about 150 seconds of backoff (2.5 minutes), 120s to 180s across the jitter range**, before the fifth failure dead-letters it, and the 300s cap never binds at those defaults (the longest jittered wait tops out near 96s; only a sixth attempt, nominally 320s, could reach the cap).
- That backoff total is a floor, not a schedule. A backoff that expires between cycles is only noticed when the processor next wakes, and a failed-but-eligible row never shortens the wait (the next-cycle wait is computed only from the not-yet-eligible remainder: `OutboxProcessor.cs:150-173`), so the wall-clock horizon is the floor plus poll granularity at the 2s default interval, and up to one fallback interval per retry (about 20 minutes at the 300s prod interval) when no new write signals the loop sooner. A batch that dispatched nothing also does not re-poll immediately (`HasMoreEligibleWork` requires progress: `OutboxProcessor.cs:329-334`), so a batch of 50 that fails in full cannot hot-spin the processor.
- Rows orphaned by a process crash (no signal exists) wait up to the polling interval before the safety-net pickup.

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
   (`MMCA.Common/.../Outbox/OutboxProcessor.cs:642-643`, formula at `:732-746`). At the shipped defaults that was
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
   10s, 20s, 40s and 80s (`MMCA.Common/.../Outbox/OutboxProcessor.cs:742`, cap applied at `:745`). The reason is the
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
   copied at `:115`), and the processor refuses to claim a keyed row while an EARLIER unprocessed,
   non-dead-lettered row carries the same key. The guard lives in the claim itself, as a correlated
   `NOT EXISTS` inside the same `ExecuteUpdateAsync` that takes the lease
   (`.../Outbox/OutboxProcessor.cs:544-554`, applied at `:473-480`), so a second replica racing the
   same key loses on the row rather than on a check it made before the race started (`:538-542`);
   ordering therefore holds across batches and across scaled-out replicas, not merely within one batch
   (`:439-442`). Within a cycle, the candidate set keeps at most one row per key, so a single batch
   never dispatches two events of one key in parallel (`:507-520`, reasoning at `:500-505`). This is
   head-of-line blocking by design: a keyed row that is failing and backing off blocks every later row
   with the same key, which is why keys must be as narrow as the ordering requirement really is (one
   key per aggregate serializes that aggregate; a constant key serializes the whole outbox:
   `IHasOrderingKey.cs:15-22`). A row that exhausts its retries stops blocking, so a poison event
   cannot freeze its key forever (`OutboxProcessor.cs:443-445`, the `RetryCount` term of the predicate
   at `:553`). Two costs are recorded in code: a batch containing no keyed row runs exactly the query
   it always ran, so hosts that never declare a key pay nothing, not even a subquery the optimizer has
   to prove away (`:470-475`); and the predecessor test is on `OccurredOn` alone, so two rows sharing
   a key and an exact timestamp do not block each other in SQL (`:448-452`, `:554`). A tie at tick
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
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:177-178`):
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
   (`.../Outbox/EventNameResolver.cs:47-51`, written at `.../Outbox/OutboxMessage.cs:106`), so a
   rename, a namespace move and an assembly move all leave the rows already written still resolvable.
   Resolution reads the stored name alone, CLR name first and the attribute scan only when that
   misses, with the result cached per stored name (`OutboxMessage.cs:146-152`, scan at
   `EventNameResolver.cs:75-81`). The trade-off is that the attribute only ever changes what NEW rows
   store, so it has to be applied BEFORE the refactoring: an event renamed without one orphans every
   row already written under its old CLR name, and those rows dead-letter
   (`EventNameAttribute.cs:14-19`). Adopting it while the outbox holds pending rows is therefore a
   two-step move: drain first, then rename. Beside it, the first unresolvable attempt is treated as
   transient and retried through the normal backoff, because the assembly declaring the type may
   simply not be loaded yet (a lazily resolved module assembly, a host still coming up) and a name
   that resolves one cycle later was never a dead letter (`.../Outbox/OutboxProcessor.cs:701-714`,
   reasoning at `:689-695`). Only the second attempt is terminal (`:716-722`), which is also the point
   at which the operator has had a Warning naming the row (`:712`, message at `:825`). A host that set
   `Outbox:MaxRetries` to 1 asked for no retries at all and gets none (`:707-711`). A payload whose
   fields changed shape is a different problem: it needs a new event type and an upcaster (ADR-090).
5. **The consumer-side inbox is on by default wherever redelivery is possible.**
   `MessageBus:EnableInbox` is now three-valued (`.../Settings/MessageBusSettings.cs:94`): an explicit
   setting wins in both directions (`:88`), and left unset it resolves ON for a broker provider and
   OFF for the in-process one, which has no redelivery to dedup (`:102`, reasoning at `:76-79`). Broker
   delivery is at-least-once by contract, so with the inbox off every redelivery became a duplicate
   side effect unless each handler happened to be idempotent on its own (`:79-85`); a host that must
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
