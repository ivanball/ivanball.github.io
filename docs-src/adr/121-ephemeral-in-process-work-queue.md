# ADR-121: Ephemeral In-Process Work Queue (Bounded Channel plus Hosted Drain)

## Status
Accepted (2026-09-11). Supersedes [ADR-052](052-background-job-execution.md).

## Context
ADR-052 ran two different kinds of work through one mechanism: ephemeral broadcasts that must not
put a gRPC round trip on the hot path of a vote, and an AI scoring pass that takes minutes and issues
one paid API call per session. A single in-process queue served both, and the channel's full mode
(`DropOldest` for the cheap case, `Wait` for the expensive one) plus an in-queue dedup claim carried
the difference between them.

The expensive half has moved out. Session scoring is scheduled as a durable internal command
([ADR-114](114-internal-commands-durable-job-queue.md)): the trigger endpoint writes a row through
`IInternalCommandScheduler.ScheduleAsync`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:115-117`)
and answers `202 Accepted` unconditionally (`:110`, `:125`), and the framework's leased, retrying,
dead-lettering processor runs the pass. Duplicate runs are held off across replicas by a per-event
`IDistributedLock` claim taken inside the handler
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommandHandler.cs:75-77`,
`ClaimTimeToLive` of 15 minutes at `:53`, `ClaimWait` of `TimeSpan.Zero` at `:60`), and the loser of
that claim logs and returns `Result.Success()` (`:79-83`). The handler says where its retries come
from: the framework's backoff and attempt ceiling "replaces the local three-attempt requeue the
in-process queue carried" (`:28`).

What remains is the half that was always a good fit for a channel: ephemeral, best-effort work owned
by one process, where a lost item costs a missed UI refresh and nothing else. This record is scoped
to that work. It is deliberately not a job system, and it no longer pretends to be the place
expensive or must-run work goes.

## Decision
Ephemeral in-process work runs as a **bounded channel plus a single-reader hosted drain**. Nothing
starts an untracked `Task` from a request, and nothing that must run lands here.

- **A bounded `Channel<T>` per job kind**, registered as a singleton with the concrete type and its
  interface both resolving to the **one** instance (`TryAddSingleton<LiveChannelPublishQueue>()` plus
  `TryAddSingleton<ILiveChannelPublishQueue>(sp => sp.GetRequiredService<LiveChannelPublishQueue>())`
  at
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/DependencyInjection.cs:56-57`,
  with the "one concrete singleton, exposed to handlers via the interface" note at `:55`). Registering
  the two separately would give producers a queue nobody drains. Capacity is a per-job constant
  (`1024` at
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Live/LiveChannelPublishQueue.cs:18`,
  applied by `Channel.CreateBounded` at `:33`).
- **The full mode is `DropOldest`, and the drop is invisible to the caller.** Under backpressure the
  freshest broadcast is worth more than the oldest and the request path must never block
  (`BoundedChannelFullMode.DropOldest` at `LiveChannelPublishQueue.cs:36`). `TryWrite` then **always**
  returns true, because the mode evicts to make room, so `Enqueue` does not check it (`:55`, `:58`)
  and no caller can learn from a return value that anything was discarded. The channel's
  `itemDropped` callback (`:40`) is therefore the only real signal, and it is wired to both an
  `Interlocked` counter and a `Warning` log naming the channel, the event and the running total
  (`:61-64`, message at `:67-70`), with the total exposed as `DroppedCount` (`:47`).
- **A `BackgroundService` drain per queue**, `SingleReader` (`LiveChannelPublishQueue.cs:37`),
  consuming with `ReadAllAsync(stoppingToken)`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:41`,
  the `BackgroundService` base at `:33`, registered by
  `AddHostedService<LiveChannelPublishProcessor>()` at
  `MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:21`). Because it is a hosted service the
  host owns the work: shutdown cancels it and waits for it to unwind. The drain is a singleton, so it
  resolves scoped services through `IServiceScopeFactory` per item
  (`LiveChannelPublishProcessor.cs:50`).
- **One failure posture per drain, stated once.** Each item runs inside `BestEffort.ExecuteAsync`
  (`LiveChannelPublishProcessor.cs:45`) so one failed publish cannot kill the loop, and shutdown
  cancellation is handled on its own arm that returns quietly instead of recording an error
  (`:60-65`).
- **Post-commit work is enqueued after the write is durable, never beside it.** The failure this
  rules out is enqueuing while the write can still be undone, which leaves the queued work describing
  state that never persisted. Two shapes satisfy it and both are in use:
  - *From a domain event handler*, which gets post-commit delivery from the existing deferral
    (ADR-003) with no sequencing code in the command handler. `LivePollVoteChangedHandler` implements
    `IDomainEventHandler<LivePollVoteChanged>`
    (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:41`)
    and enqueues at `:79`; `SessionQuestionUpvoteChangedHandler` implements
    `IDomainEventHandler<SessionQuestionUpvoteChanged>`
    (`.../SessionQuestions/DomainEventHandlers/SessionQuestionUpvoteChangedHandler.cs:42`) and
    enqueues at `:80`. Both are singletons that open their own scope (`:53`, `:54`) and wrap the work
    in `BestEffort.ExecuteAsync` (`:51`, `:52`).
  - *From the command handler side of a non-transactional command, once its save has returned.*
    `TransactionalCommandDecorator` wraps only commands implementing `ITransactional` and passes
    everything else straight through
    (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:28-29`,
    marker at `.../UseCases/Markers/ITransactional.cs:6`); no Engagement command implements it, so for
    these handlers `SaveChangesAsync` **is** the commit. Three of the four sites get the ordering
    structurally, because a `MutateEntityHandlerBase` subclass
    (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Crud/MutateEntityHandlerBase.cs:333`,
    over the shared `MutateEntityHandlerCore` at `:52`) holds no save of its own: the base saves at
    `:316`, logs at `:318` and then awaits the `OnMutatedAsync` post-save hook at `:319`, and the
    enqueue is the body of that hook. `CloseLivePollHandler` declares the base at
    `.../LivePolls/UseCases/Close/CloseLivePollHandler.cs:24` and enqueues from the hook at `:73`
    (queue write at `:94-95`); `OpenLivePollHandler` at
    `.../LivePolls/UseCases/Open/OpenLivePollHandler.cs:26` and `:88` (write at `:109-110`);
    `ModerateQuestionHandler` at `.../SessionQuestions/UseCases/Moderate/ModerateQuestionHandler.cs:28`
    and `:89`, whose helper wraps its work in `BestEffort.ExecuteAsync` (`:138`) with one write per
    branch (`:140`, `:154`).
  - *One site keeps the ordering by hand, and the rule is stated in its own terms.*
    `SubmitQuestionHandler` implements `ICommandHandler<SubmitQuestionCommand, Result<SessionQuestionDTO>>`
    directly (`.../SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:38`), so it owns its
    sequence. Its save is not inline: the count-decide-insert-save sequence runs inside
    `CreateUnderClaimAsync` under a per-`(session, user)` `IDistributedLock` claim (`:147-149`,
    `SaveChangesAsync` at `:184`), and `HandleAsync` calls that helper at `:91`, logs at `:97` and
    awaits `EnqueueSubmittedAsync(question)` at `:99`, whose `BestEffort.ExecuteAsync` body
    (`:205-206`) writes the queue at `:217-218` (approved) and `:232-233` (pending count). The rule a
    future edit has to keep is therefore **the enqueue stays below the `CreateUnderClaimAsync` call**,
    not below a save statement in the same method.
- **Work that must run does not go here.** Anything expensive, paid, long-running or not
  re-triggerable is scheduled as an internal command (ADR-114), which is durable across a restart,
  leased so one replica at a time executes a row, retried with backoff and dead-lettered on the
  ceiling, and deduplicated across replicas by an `IDistributedLock` claim inside the handler
  (ADR-108). That path accepts with `202` and silently coalesces the claim loser rather than refusing
  a duplicate, which is the correct posture for a self-deduplicating schedule and is the opposite of
  what an in-process queue could offer.

One implementation exists: `LiveChannelPublishQueue` / `LiveChannelPublishProcessor` (ephemeral,
`DropOldest`, ADR-039).

## Rationale
- **The host lifetime is the point.** A `BackgroundService` is the only in-process shape the host can
  cancel and await. Everything else in the decision follows from wanting that, and a deploy or an
  Azure Container Apps scale-in then unwinds the drain instead of tearing it down mid-item.
- **The queue is where the policy lives.** Capacity, full mode and the drop accounting are properties
  of the work, and putting them in the queue type means a caller cannot get them wrong: it calls
  `Enqueue` and the queue decides what happens under pressure.
- **`DropOldest` is the honest mode for ephemeral work.** A live broadcast has a shelf life measured
  in seconds; holding the request path open to deliver a stale one trades a real cost for a worthless
  gain. The counter and the warning keep the discard visible even though the caller cannot see it.
- **Single reader gives ordering for free**, which the live-channel case needs per session, at the
  cost of one item at a time.
- **One boundary, one question.** The split with ADR-114 reduces to "would losing this item be
  noticed as anything more than a missed UI refresh?" If yes, it is an internal command; if no, it is
  a channel item. Keeping both behind one mechanism is what made ADR-052 drift.

## Trade-offs
- **In-process only.** The queue does not survive a restart and does not span replicas. Accepted
  because every job left here is ephemeral by definition. Work that must survive a crash belongs in
  the outbox (ADR-003) or the internal-command queue (ADR-114), not here.
- **Drops are silent at the call site.** The producer has no way to know, and the counter
  (`LiveChannelPublishQueue.cs:47`) and the `Warning` line (`:67-70`) only help someone who goes
  looking at logs. A sustained backlog shows up as UI staleness before it shows up as an alert.
- **A drain is a serialization point.** One reader means a slow item delays the queue behind it. That
  is harmless for broadcasts at the observed conference-day load; a job kind that needs parallelism
  needs its own queue rather than a wider reader, or ordering is lost.
- **One post-save ordering is remembered rather than enforced.** The three base-class handlers cannot
  express the wrong order, but `SubmitQuestionHandler` can: an edit that lifted its enqueue above the
  `CreateUnderClaimAsync` call (`SubmitQuestionHandler.cs:91`, `:99`) would broadcast a question that
  may never have persisted, and no test or analyzer catches that shape.
- **Choosing this over ADR-114 is a per-job judgement.** Putting must-run work on a `DropOldest`
  channel loses it silently, and putting a broadcast through a durable command pays a row, a poll
  interval and a lease for something worth less than the write.

## Related
[ADR-114](114-internal-commands-durable-job-queue.md) (the durable, leased, retrying queue that owns
expensive and must-run work),
[ADR-108](108-distributed-lock-primitive.md) (the cross-replica claim that replaced this record's
per-replica dedup),
ADR-039 (live channel push, the one instance of this pattern),
ADR-003 (the outbox, and the post-commit domain-event deferral the first enqueue shape relies on),
ADR-014 (the transactional decorator whose commit boundary post-commit work attaches to),
ADR-025 (startup warm-up, the other hosted-service use in the framework),
[ADR-052](052-background-job-execution.md) (superseded: the record that covered both halves).
