# ADR-052: Background Job Execution (Bounded Queue plus Hosted Drain)

## Status
Accepted (2026-07-24).

## Context
Some requests trigger work that cannot run inside the request: an AI scoring pass over an event's
sessions takes minutes and issues one paid API call per session, and a live-channel broadcast must
not put a gRPC round trip on the hot path of a vote. The endpoint should accept the request and
return, leaving the work to run elsewhere.

The obvious shortcut is to start an untracked task and return, which is what the session-scoring
endpoint did (`_ = RunScoringInBackgroundAsync(eventId)`). A code review found three defects that
follow from the shape rather than from that particular implementation:

- **The host does not know the work exists.** `IHostApplicationLifetime` cannot wait for it and
  shutdown cannot cancel it, so an Azure Container Apps scale-in or a deploy tears it down mid-run
  with nothing recorded. For a multi-minute paid pass, that is spend with no result and no trace.
- **Nothing deduplicates it.** Two clicks started two concurrent passes over the same event: double
  the API calls, racing each other's writes, and no way for the caller to learn a run was already in
  flight.
- **Failure handling drifts.** Each fire-and-forget site invents its own try/catch, so the failure
  posture (swallow, log, retry) is decided per call site instead of once.

There is a second, unrelated need with the same shape: work that must happen *after* the request's
transaction commits and must not add latency to it. The live-channel broadcast is that case, and it
already used a bounded queue plus a hosted drain (ADR-039). The two wanted the same mechanism.

This is deliberately not a distributed job system. Every case here is best-effort or re-triggerable
work owned by one service; durable, cross-process scheduling is what the outbox (ADR-003) and the
broker (ADR-008) are for, and this ADR does not compete with them.

## Decision
In-process background work runs as a **bounded queue plus a single-reader hosted drain**. Nothing
starts an untracked `Task` from a request.

- **A bounded `Channel<T>` per job kind**, registered as a singleton, with the concrete type and its
  interface both resolving to the **one** instance (`TryAddSingleton<TQueue>()` plus
  `TryAddSingleton<IQueue>(sp => sp.GetRequiredService<TQueue>())`). Registering them separately
  would give producers a queue nobody drains.
- **A `BackgroundService` drain per queue**, `SingleReader`, consuming with
  `ReadAllAsync(stoppingToken)`. Because it is a hosted service the host owns the work: shutdown
  cancels it and waits for it to unwind. The drain resolves scoped services through
  `IServiceScopeFactory` per item, since it is itself a singleton.
- **The full mode encodes what the work is worth.**
  - *Ephemeral* work uses `BoundedChannelFullMode.DropOldest`: under backpressure the freshest
    broadcast is worth more than the oldest and the request path must never block. Note that
    `TryWrite` then **always** returns true (it evicts to make room), so a caller cannot learn from
    its return value that anything was dropped; the channel's `itemDropped` callback is the only
    real signal and must be wired to a counter and a log.
  - *Expensive* work uses `Wait` with a non-blocking `TryWrite`, so a full queue **refuses** the
    request rather than silently discarding an earlier one, and the caller is told.
- **Expensive work deduplicates by its natural key**, with the claim taken before the write and
  released by the drain only when the run finishes. The dedup window therefore covers execution, not
  just the wait in the queue. A duplicate request gets an explicit refusal (409), not a silent
  coalesce.
- **One failure posture per drain, stated once.** The drain catches per item so one failed run cannot
  kill the loop, and handles shutdown cancellation separately from failure so a graceful restart is
  not recorded as an error.
- **Post-commit work attaches to a domain event, not to the command handler.** A handler that
  enqueues inline runs while the ADR-014 transaction is still open, so a rollback leaves the queued
  work describing state that never persisted. Raising a domain event and enqueuing from its handler
  gets post-commit delivery from the existing deferral (ADR-003), with no extra sequencing code.

Two implementations exist: `LiveChannelPublishQueue` / `LiveChannelPublishProcessor` (ephemeral,
DropOldest, ADR-039) and `SessionScoringQueue` / `SessionScoringProcessor` (expensive, Wait, dedup
by event id).

## Rationale
- **The host lifetime is the point.** A `BackgroundService` is the only in-process shape the host can
  cancel and await. Everything else in the decision follows from wanting that.
- **The queue is where the policy lives.** Capacity, full mode and dedup are properties of the work,
  and putting them in the queue type means a caller cannot get them wrong: it calls `TryEnqueue` and
  reads the outcome.
- **Refusal beats silent coalescing for paid work.** An organizer who clicks twice should learn the
  run is already going, not have the second click vanish into a queue.
- **Single reader gives ordering for free**, which the live-channel case needs per session, and
  serializes expensive runs so two of them cannot contend for the same external rate limit.

## Trade-offs
- **In-process only.** The queue does not survive a restart and does not span replicas. Accepted
  because every current job is either ephemeral (a lost broadcast is a missed UI refresh) or
  re-triggerable (an organizer can click score again). Work that must survive a crash belongs in the
  outbox (ADR-003), not here.
- **Dedup is per replica.** Two replicas can each accept a run for the same event. Today the scoring
  endpoint is organizer-only and low-traffic, so the exposure is small; making it cluster-wide would
  need a distributed lock or a claim row, which is the point at which this should become a real job
  system instead.
- **Backpressure is felt differently by the two modes**, and choosing the wrong one is a silent bug
  in either direction: `DropOldest` on expensive work discards paid runs, and `Wait` on ephemeral
  work turns a slow peer into refused broadcasts. The mode is a per-job decision, not a default.
- **A drain is a serialization point.** One reader means a slow item delays the queue behind it. That
  is wanted for scoring and harmless for broadcasts at the observed conference-day load; a job kind
  that needs parallelism needs its own queue rather than a wider reader, or ordering is lost.

## Related
ADR-003 (the outbox, for work that must be durable and cross-process, and the post-commit deferral
this relies on),
ADR-008 (the broker, for cross-service work),
ADR-014 (the transactional decorator whose commit boundary post-commit work attaches to),
ADR-039 (live channel push, the ephemeral instance of this pattern),
ADR-025 (startup warm-up, the other hosted-service use in the framework).
