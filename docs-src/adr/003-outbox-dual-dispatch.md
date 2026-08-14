# ADR-003: Outbox Pattern with Dual Dispatch

## Status
Accepted. Revised 2026-07-19 (integration-event routing via `IMessageBus`, lease-based claims for
safe scale-out, dead-letter visibility, post-commit dispatch; see Revision below). Revised
2026-08-01 (explicit exponential retry backoff supersedes polling-interval pacing; see Revision
below). Revised 2026-08-07 (random jitter on the retry backoff; see Revision below).

## Context
Domain events must be reliably published after aggregate changes are persisted. Two failure modes exist:
1. In-process dispatch fails (e.g., handler throws): the event is lost if not persisted.
2. Process crashes between persistence and dispatch: the event is lost if only dispatched in-memory.

## Decision
Use a dual-dispatch strategy:
1. **Outbox persistence**: Domain events are serialized into `OutboxMessage` rows within the same database transaction as the aggregate changes. This guarantees at-least-once persistence.
2. **In-process dispatch**: After `SaveChangesAsync`, events are dispatched immediately in-process via `DomainEventDispatcher` for low-latency handling.
3. **Background processor**: `OutboxProcessor` (a `BackgroundService`) wakes on an in-memory signal when new entries are written, or after a fallback polling interval (`Outbox:PollingIntervalSeconds`, default 2s; ADC prod sets 300s). Entries become eligible `Outbox:ProcessingDelaySeconds` after creation (default 5s); when a cycle sees pending-but-not-yet-eligible entries it **smart-waits** only until the earliest becomes eligible instead of sleeping the full interval. Eligible entries that throw during dispatch are retried up to 5 times, then dropped from the eligible set (a message whose event type cannot be resolved is dead-lettered immediately on first pickup; see Trade-offs).

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
  dead-lettered immediately on first pickup (it can never succeed) and requires manual investigation.
  A message that **throws during dispatch** is retried up to `Outbox:MaxRetries` (default 5) times,
  then dropped from the eligible set (it stops being polled once `RetryCount >= MaxRetries`).
- Failed-message retries are paced by an explicit exponential backoff, not by the polling interval, and the backoff is randomized. A failure re-leases its own row for `Outbox:RetryBackoffBaseSeconds * 2^(n-1)` seconds multiplied by a random jitter factor in `[0.8, 1.2]`, capped at `Outbox:LeaseSeconds` (`MMCA.Common/.../Outbox/OutboxProcessor.cs:500-507,539-553`). At the shipped defaults (base 10s, `MaxRetries` 5, lease 300s, batch 50: `MMCA.Common/.../Settings/OutboxSettings.cs:17,21,82,99`) the four waits between the five attempts are ranges rather than fixed values: about 8-12s, 16-24s, 32-48s and 64-96s. A persistently failing message therefore spends **about 150 seconds of backoff (2.5 minutes), 120s to 180s across the jitter range**, before the fifth failure dead-letters it, and the 300s cap never binds at those defaults (the longest jittered wait tops out near 96s; only a sixth attempt, nominally 320s, could reach the cap).
- That backoff total is a floor, not a schedule. A backoff that expires between cycles is only noticed when the processor next wakes, and a failed-but-eligible row never shortens the wait (the next-cycle wait is computed only from the not-yet-eligible remainder: `OutboxProcessor.cs:128-129,269`), so the wall-clock horizon is the floor plus poll granularity at the 2s default interval, and up to one fallback interval per retry (about 20 minutes at the 300s prod interval) when no new write signals the loop sooner. A batch that dispatched nothing also does not re-poll immediately (`HasMoreEligibleWork` requires progress: `OutboxProcessor.cs:287-291`), so a batch of 50 that fails in full cannot hot-spin the processor.
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
   (`MMCA.Common/.../Outbox/OutboxProcessor.cs:500-507,539-553`). At the shipped defaults that was
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
   10s, 20s, 40s and 80s (`MMCA.Common/.../Outbox/OutboxProcessor.cs:539-553`). The reason is the
   failure mode the backoff alone does not cover: one dependency outage fails all 50 rows of a batch
   in the same instant, and a deterministic curve then retries all 50 on a single shared schedule,
   re-hammering that dependency in synchronized bursts. Jitter spreads the attempts apart. The
   jitter is applied before the cap so a capped backoff still lands exactly on the lease bound, and
   the generator is deliberately pseudorandom: it spaces retries and feeds no security decision.
   The practical consequence for operators is that "150 seconds before dead-lettering" is now an
   expectation (120s to 180s), not a guarantee.
