# ADR-121: Ephemeral In-Process Work Queue (Bounded Channel plus Hosted Drain)

## Status
Accepted (2026-09-11). Supersedes [ADR-052](052-background-job-execution.md).
Revised 2026-10-01: the scoring trigger's feature gate and failure path, and ADR-025's place among the framework hosted services.
Revised 2026-10-06: the scoring trigger's event-existence 404 and the handler's current retry remarks.
Revised 2026-10-07: the live drain's bounded shutdown flush (complete the queue, then publish what remains within a 5-second budget) and its `WaitToReadAsync` loop.

## Context
ADR-052 ran two different kinds of work through one mechanism: ephemeral broadcasts that must not
put a gRPC round trip on the hot path of a vote, and an AI scoring pass that takes minutes and issues
one paid API call per session. A single in-process queue served both, and the channel's full mode
(`DropOldest` for the cheap case, `Wait` for the expensive one) plus an in-queue dedup claim carried
the difference between them.

The expensive half has moved out. Session scoring is scheduled as a durable internal command
([ADR-114](114-internal-commands-durable-job-queue.md)): the trigger endpoint writes a row through
`IInternalCommandScheduler.ScheduleAsync`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:148-152`)
and answers `202 Accepted` once the row is written (`:160`), with a failed schedule surfaced through
`HandleFailure` (`:156`), an unknown event answered 404 by an existence check before anything is
scheduled (`:143-146`), and a `[FeatureGate(ConferenceFeatures.SessionScoring)]` gate (`:134`)
answering 404 while the flag is off, and the framework's leased, retrying,
dead-lettering processor runs the pass. Duplicate runs are held off across replicas by a per-event
`IDistributedLock` claim taken inside the handler
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommandHandler.cs:83-85`,
`ClaimTimeToLive` of 15 minutes at `:61`, `ClaimWait` of `TimeSpan.Zero` at `:68`), and the loser of
that claim logs and returns `Result.Success()` (`:87-91`). The handler's remarks say where its
retries come from: the framework's processor completes a row only on a successful result, and
anything else consumes an attempt, backs off, and dead-letters at `InternalCommands:MaxAttempts`
(`:23-27`).

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
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/DependencyInjection.cs:53-54`,
  with the "one concrete singleton, exposed to handlers via the interface" note at `:52`). Registering
  the two separately would give producers a queue nobody drains. Capacity is a per-job constant
  (`1024` at
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Live/LiveChannelPublishQueue.cs:18`,
  applied by `Channel.CreateBounded` at `:33`).
- **The full mode is `DropOldest`, and the drop is invisible to the caller.** Under backpressure the
  freshest broadcast is worth more than the oldest and the request path must never block
  (`BoundedChannelFullMode.DropOldest` at `LiveChannelPublishQueue.cs:36`). Until the queue is
  completed at host shutdown (`Complete()` at `:66`), `TryWrite` **always** returns true, because the
  mode evicts to make room; after completion a write is refused silently. `Enqueue` does not check it
  either way (`:56`, `TryWrite` at `:59`), so no caller can learn from a return value that anything
  was discarded. The channel's `itemDropped` callback (`:40`) is therefore the only real signal, and
  it is wired to both an `Interlocked` counter and a `Warning` log naming the channel, the event and
  the running total (`OnItemDropped` at `:68-72`, increment at `:70`, log call at `:71`, message at
  `:76`), with the total exposed as `DroppedCount` (`:47`).
  The full mode is a per-job choice, not a rule: a job whose requests coalesce may use a capacity-one
  channel with `DropWrite` instead, as ADC's bookmark cache-eviction signal does
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/Services/BookmarkCacheEvictionSignal.cs:27-30`),
  where any number of requests made while one is pending collapse into it and the drop is the intent.
- **A `BackgroundService` drain per queue**, `SingleReader` (`LiveChannelPublishQueue.cs:37`),
  consuming with a `WaitToReadAsync(stoppingToken)` loop. The live drain also tests the stopping
  token before each `TryRead`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:85-86`,
  test and `TryRead` at `:90`; the `BackgroundService` base at `:43`, registered by
  `AddHostedService<LiveChannelPublishProcessor>()` at
  `MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:23`). The test and the read are two
  separate steps, so a stop that lands between them still dequeues one item onto a cancelled token.
  The bookmark eviction drain reads with no stop test, which is fine for a capacity-one signal
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Caching/BookmarkCacheEvictionProcessor.cs:56-60`).
  Because it is a hosted service the
  host owns the work. The drain is a singleton, so it resolves scoped services through
  `IServiceScopeFactory` per item (`CreateAsyncScope` at `LiveChannelPublishProcessor.cs:126`).
- **Shutdown flushes rather than drops, inside one bounded budget.** The live drain overrides
  `StopAsync` (`LiveChannelPublishProcessor.cs:52-78`): it completes the queue first (`:56`), so the
  remaining items are a finite set, then gives the whole stop one `ShutdownDrainBudget` of 5 seconds
  (`:49`, applied at `:58`). Within that budget it cancels the stopping token and waits for
  `ExecuteAsync` to return (`base.StopAsync` at `:63`). That cancellation aborts the publish in
  progress rather than letting it finish: the drain publishes on the stopping token (`:92`),
  `BestEffort` passes it through and rethrows the cancellation
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:57-63`), and the gRPC
  adapter forwards it to the call and turns `Cancelled` into an `OperationCanceledException`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:49-53`).
  That item was already dequeued, so it is lost. Then, only if
  the worker has let go of the single reader, publishes the remaining items in FIFO order on its own
  token (`DrainRemainingAsync` at `:70`, defined at `:105`), because the stopping token is already
  cancelled. Anything still queued when the budget runs out is counted and logged as a `Warning`
  (`:73-77`, message at `:136-139`) and abandoned. The flush is best effort: it narrows the loss at a
  deploy or scale-in, it does not make the queue durable.
- **One failure posture per drain, stated once.** Each item runs inside `BestEffort.ExecuteAsync`
  (`LiveChannelPublishProcessor.cs:121`) so one failed publish cannot kill the loop, and shutdown
  cancellation is handled on its own arm that returns quietly instead of recording an error
  (`:96-101`, with a second arm for an exhausted budget in `DrainRemainingAsync` at `:114-117`).
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
    (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:30-31`,
    marker at `.../UseCases/Markers/ITransactional.cs:6`); no Engagement command implements it, so for
    these handlers `SaveChangesAsync` **is** the commit. Three of the four sites get the ordering
    structurally, because a `MutateEntityHandlerBase` subclass
    (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Crud/MutateEntityHandlerBase.cs:339`,
    over the shared `MutateEntityHandlerCore` at `:52`) holds no save of its own: the base saves at
    `:322`, logs at `:324` and then awaits the `OnMutatedAsync` post-save hook at `:325`, and the
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

Two implementations exist: `LiveChannelPublishQueue` / `LiveChannelPublishProcessor` (ephemeral,
`DropOldest`, ADR-039) and `BookmarkCacheEvictionSignal` / `BookmarkCacheEvictionProcessor`
(ephemeral, capacity one, `DropWrite`; the processor is registered at
`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:24`).

## Rationale
- **The host lifetime is the point.** A `BackgroundService` is the only in-process shape the host can
  cancel and await. Everything else in the decision follows from wanting that, and a deploy or an
  Azure Container Apps scale-in then cancels the drain through its stopping token (which aborts the
  one publish in progress) and gets a bounded chance to publish what is still queued, since those
  are broadcasts attendees have not yet seen.
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
- **In-process only.** The queue does not survive a restart and does not span replicas. The
  shutdown flush covers what is still queued at a graceful stop within its 5-second budget only; a
  crash, a stop that outlasts the budget, or a write after the queue is completed still loses
  items, and even a stop well inside the budget loses the item being published when it lands,
  because the stopping token cancels that publish and nothing retries it
  (`LiveChannelPublishProcessor.cs:63`, `:92`, `:96-101`). Accepted because
  every job left here is ephemeral by definition. Work that must survive a crash belongs in the
  outbox (ADR-003) or the internal-command queue (ADR-114), not here.
- **Drops are silent at the call site.** The producer has no way to know, and the counter
  (`LiveChannelPublishQueue.cs:47`) and the `Warning` line (`:76`) only help someone who goes
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

## Revision (2026-10-01)
No decision or rationale changed. Two Context and Related statements are corrected: the scoring
trigger no longer answers `202 Accepted` unconditionally, because a
`[FeatureGate(ConferenceFeatures.SessionScoring)]` attribute
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:125`)
answers 404 with the flag off and a failed schedule returns `HandleFailure` (`:138-141`), leaving
`Accepted()` (`:144`) for the success path only; and ADR-025's warm-up is one of several framework
hosted services rather than the only other one (for example `OutboxProcessor` at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:209`,
`InternalCommandProcessor` at `.../DependencyInjection.Jobs.cs:175`, `WarmupHostedService` at
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:102`). Citations refreshed: the
`ScheduleAsync` call, the scoring handler's claim, TTL, wait and loser lines (the cache evict at
`ScoreEventSessionsInternalCommandHandler.cs:76` now precedes the claim), the Engagement queue
registrations, and the `TransactionalCommandDecorator` pass-through.

## Revision (2026-10-06)
No decision or rationale changed. Corrections this pass:
- The scoring trigger now checks that the event exists before scheduling and answers an unknown
  event with 404 through `HandleFailure`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:143-146`);
  the Context paragraph records it.
- The scoring handler no longer carries the quoted "replaces the local three-attempt requeue" remark;
  Context now paraphrases its current retry remarks
  (`ScoreEventSessionsInternalCommandHandler.cs:23-27`) instead of quoting removed wording.
- The hosted services the 2026-10-01 revision cites now register at `OutboxProcessor`
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:219` and
  `InternalCommandProcessor` `.../DependencyInjection.Jobs.cs:176` (`WarmupHostedService` is
  unchanged at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:102`).

Anchors in the live sections were re-verified against current source and refreshed (the trigger's
`ScheduleAsync`, `HandleFailure`, `Accepted()` and `[FeatureGate]` lines, the scoring handler's
claim, TTL, wait and loser lines, and the `MutateEntityHandlerBase` save, log and hook lines).

## Revision (2026-10-07)
Re-verified against current source. The decision (bounded `DropOldest` channel, single-reader
hosted drain, post-commit enqueue, must-run work on ADR-114) is unchanged; what moved is the live
drain's loop and shutdown behavior, which the Decision, Rationale and Trade-offs now record.
1. The drain no longer consumes with `ReadAllAsync`: it loops on `WaitToReadAsync(stoppingToken)`
   and tests the stop before each `TryRead`, which narrows (but, as two separate steps, does not
   close) the window in which an item is dequeued after the stop
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:85-90`).
   The bookmark eviction drain has no such test
   (`.../Caching/BookmarkCacheEvictionProcessor.cs:56-60`).
2. Shutdown flushes rather than only cancelling: `StopAsync` (`LiveChannelPublishProcessor.cs:52-78`)
   completes the queue (`:56`, `LiveChannelPublishQueue.Complete()` at
   `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Live/LiveChannelPublishQueue.cs:66`),
   shares one 5-second `ShutdownDrainBudget` (`:49`, `:58`) across `base.StopAsync` (`:63`) and
   `DrainRemainingAsync` (`:70`, defined at `:105`), and logs whatever it abandons (`:73-77`,
   message at `:136-139`). `base.StopAsync` cancels the publish in progress rather than letting it
   finish (`:92`; `BestEffort.cs:57-63`; `LiveChannelPublisherGrpcAdapter.cs:49-53`), so that item
   is lost. The Rationale and the "In-process only" trade-off state the flush and its limits.
3. `TryWrite` always succeeds only until the queue is completed; a write after completion is refused
   silently (remarks at `LiveChannelPublishQueue.cs:50-55`). `Enqueue` still does not check it.
4. Anchors re-verified against current source: `Enqueue` (`LiveChannelPublishQueue.cs:56`),
   `TryWrite` (`:59`), `OnItemDropped` (`:68-72`, increment `:70`, log call `:71`), the drop
   message (`:76`, also in Trade-offs); the `BackgroundService` base
   (`LiveChannelPublishProcessor.cs:43`), `CreateAsyncScope` (`:126`), `BestEffort.ExecuteAsync`
   (`:121`) and the cancellation arm (`:96-101`). Unchanged and confirmed: `Capacity` (`:18`),
   `CreateBounded` (`:33`), `DropOldest` (`:36`), `SingleReader` (`:37`), `itemDropped` (`:40`),
   `DroppedCount` (`:47`), both hosted-service registrations
   (`MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:23-24`), the queue singletons
   (`MMCA.ADC.Engagement.Application/DependencyInjection.cs:53-54`), the bookmark signal's
   `DropWrite` channel (`BookmarkCacheEvictionSignal.cs:27-30`), the domain event handler and
   command handler enqueue lines, and the `MutateEntityHandlerBase` (`:339`, `:322`, `:325`) and
   `TransactionalCommandDecorator` (`:30`) lines.

## Related
[ADR-114](114-internal-commands-durable-job-queue.md) (the durable, leased, retrying queue that owns
expensive and must-run work),
[ADR-108](108-distributed-lock-primitive.md) (the cross-replica claim that replaced this record's
per-replica dedup),
ADR-039 (live channel push, the one instance of this pattern),
ADR-003 (the outbox, and the post-commit domain-event deferral the first enqueue shape relies on),
ADR-014 (the transactional decorator whose commit boundary post-commit work attaches to),
ADR-025 (startup warm-up, one of several framework hosted services alongside the outbox and
internal-command processors),
[ADR-052](052-background-job-execution.md) (superseded: the record that covered both halves).
