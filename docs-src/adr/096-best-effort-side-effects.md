# ADR-096: Best-Effort Side-Effect Contract

## Status
Accepted (2026-08-23).

## Context
A command that has already committed often has follow-up work attached to it: evict the output-cache
entries the write invalidated, broadcast the new state to a live channel, send the notification the
user is waiting for. That work can fail on its own, and when it does the question is not whether to
retry but what the failure is allowed to do to the caller. Turning it into an exception would roll
back, retry or 500 an operation whose real work already succeeded.

Five records each answer that question locally, for their own feature, and each answer is right:
ADR-024 makes a push delivery failure non-fatal and records `MarkAsFailed` instead
(`024-push-notifications.md:55`), ADR-026 makes cross-service cache eviction best-effort so a broken
eviction store cannot dead-letter a coherence hint, ADR-076 degrades a data-subject export per section
rather than failing the package (`076-data-subject-export.md:74`), ADR-091 composes the reset email in
the handler and delivers it best-effort, "awaited and its failure caught, logged and swallowed"
(`091-cache-backed-password-reset.md:71-76`), and ADR-054 makes compensation best-effort per order
line (`054-saga-compensation-and-reconciliation.md:158`). What none of them decides is the **policy**:
which failures may be swallowed at all, at what severity, whether cancellation counts as one of them,
and how a swallow is made visible to somebody who is not reading the log. Answered per call site, that
produces a repo full of hand-rolled `catch (Exception)` blocks, each choosing its own severity, its
own treatment of cancellation and its own decision to count nothing. ADR-041 records the counter this
record's helper emits and notes that it is wired to no alert (`041-observability-and-telemetry.md:175-180`,
`:197-200`), but it records the instrument, not the contract behind it.

## Decision
One framework helper defines the contract, and a swallow that does not go through it is a deliberate,
documented exception.

- **`BestEffort.ExecuteAsync(operation, logger, action, cancellationToken = default)`**, a static
  helper in the Application layer
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:45-49`), runs the side
  effect and absorbs its failure.
- **The action is awaited, not fire-and-forget.** The helper awaits `action(cancellationToken)`
  (`:57`), so the side effect completes (or fails) before the caller continues; nothing is left as an
  orphan task racing the response.
- **A failure produces exactly one Warning.** `BestEffortLog.DispatchFailed` is a source-generated
  `[LoggerMessage]` at `Warning` (`:81-84`) reading "Best-effort operation '{Operation}' failed and
  was swallowed; the caller's outcome is unaffected" (`:83`), with the exception attached. The catch
  is deliberately broad, with the reason written into the code: the whole contract is that nothing the
  side effect throws reaches the caller (`:65-71`).
- **A failure produces exactly one metric increment.** `besteffort.dispatch.failed` is a `Counter<long>`
  on its own meter, `MMCA.Common.BestEffort` (`:102`, instrument at `:107-115`), incremented with an
  `operation` tag (`:115`). It is a meter of its own rather than a counter folded into
  `MMCA.Common.Cqrs`, because best-effort dispatch is not part of the CQRS pipeline and an operator can
  drop or keep it independently of the RED metrics (`:93-97`). The Aspire service defaults subscribe it
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:170`).
- **The operation name is a low-cardinality constant.** It becomes a metric tag (`:22`), so call sites
  pass a `const` or a fixed prefix plus a value from a small fixed set. A blank name throws
  `ArgumentException` and a null logger or action throws `ArgumentNullException` (`:51-53`): the helper
  swallows the side effect's failures, never its own caller's bugs.
- **Cancellation is not swallowed.** An `OperationCanceledException` raised while the caller's own
  token is cancelled is rethrown (`:59-63`), so a host shutdown or an abandoned request unwinds
  promptly instead of being recorded as a spurious side-effect failure. A cancellation that is not the
  caller's (an inner timeout) is a genuine failure of the side effect and is swallowed like any other.
- **Post-commit work passes `CancellationToken.None` on purpose.** The write has committed, so its
  follow-up must outlive a caller that has already walked away
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/OutputCacheEvictionExtensions.cs:34-40`;
  the ADC broadcasts take the parameter's default for the same reason,
  `.../SubmitQuestionHandler.cs:122-124`).
- **The contract is pinned by tests.** `BestEffortTests` covers the transparent success path, token
  passthrough, one-Warning-per-failure, the `operation`-tagged increment observed through a
  `MeterListener`, the rethrow of the caller's cancellation, the swallow of a non-caller cancellation,
  and argument validation
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/BestEffortTests.cs:15-141`).

Adoption today is **seven production call sites across two apps**. Six are in ADC Engagement: the
live-channel drain worker, whose operation name is the prefix `live-channel-publish:` plus the work
item's event name and whose own catch turns the rethrown cancellation into a quiet stop
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:36`,
`:45-58`, `:60-65`); three session-question broadcasts, `session-question-submit-broadcast`
(`.../SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:34`, call at `:131`),
`session-question-moderation-broadcast` (`.../UseCases/Moderate/ModerateQuestionHandler.cs:30`, call at
`:136`) and `session-question-upvote-broadcast`
(`.../DomainEventHandlers/SessionQuestionUpvoteChangedHandler.cs:45`, call at `:52`); the poll-results
broadcast `livepoll-results-broadcast`
(`.../LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:44`, call at `:51`); and the
cross-host cache eviction `bookmark-cache-evict-broadcast`
(`.../UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:56`, call at
`:68-80`). The seventh is Store Catalog's `TryEvictByTagAsync` extension, whose operation name is the
prefix `catalog.output-cache-evict:` plus the tag
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/OutputCacheEvictionExtensions.cs:18`,
`:30-41`); four controllers evict through it (`Controllers/CategoriesController.cs:157`,
`ProductsController.cs:222`, `ProductVariantsController.cs:129`, `ProductImagesController.cs:281`).

Two swallows deliberately stay hand-rolled, and both say so in code. Store's `AddVariantHandler`
publishes `ProductVariantChanged` after the commit and catches around it, logging at **Error** with
the `ProductId` and `ProductVariantId`: the event is lost, Sales does not auto-create the zero-stock
inventory record, and an operator needs those ids to create it by hand. Routing it through the helper
would both downgrade an unrecoverable loss to Warning and drop the ids, which is why that one site
stays as it is while every other swallow in the repo uses the helper
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/UseCases/AddVariant/AddVariantHandler.cs:81-95`,
catch at `:97-108`). The framework's own `OutputCacheEvictionHandler` hand-rolls the same
swallow-log-count shape against `cache.eviction.failed` on the `MMCA.Common.OutputCache` meter
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionHandler.cs:51-62`),
because `BestEffort` lives in Application and the API package cannot reach it without a layer-crossing
reference or a duplicated meter name (recorded in ADR-026, `026-caching-strategy.md:412-417`).

## Rationale
- **One policy beats five local leniencies.** Each feature record is still right about its own
  degradation; what they could not each decide is the shape of the swallow. A single helper fixes
  severity, cardinality and the cancellation rule once, so a new post-commit side effect inherits them
  instead of re-litigating them.
- **A swallowed failure has to be countable.** A Warning in a log nobody reads is how a side effect
  quietly stops working for weeks. The counter turns "the broadcast has been failing since Tuesday"
  into a question a dashboard can answer, which is the only thing that makes swallowing defensible.
- **Cancellation is not a failure.** Swallowing it would turn an orderly shutdown into a burst of
  spurious warnings and a metric spike, and would let a stopping host keep doing work it was told to
  stop. Rethrowing keeps shutdown a shutdown.
- **Awaiting keeps the failure attributable.** A detached task would still fail, just later, off the
  request's context and without the logger scope that names what it was doing.
- **Fixing the severity at Warning is a filter, not a limitation.** A swallow that genuinely deserves
  Error, with ids an operator must act on, is evidence the work is not best-effort. `AddVariantHandler`
  is exactly that case, and it stays outside the helper.

## Trade-offs
- **Nothing gates use of the helper.** There is no fitness rule, analyzer or architecture test that
  fails a build for a hand-rolled `catch (Exception)` that should have been a `BestEffort` call; the
  helper is a convention backed by review. The only inventory is a search, which is how the seven call
  sites and two deviations above were enumerated.
- **The Warning carries the operation name and the exception, nothing else.** No entity id, no
  correlation payload beyond the ambient scope. `SubmitQuestionHandler` records that cost explicitly:
  the question id is one log line earlier, not in the best-effort warning
  (`.../Submit/SubmitQuestionHandler.cs:125-127`).
- **The counter is failure-only and alerts on nothing.** A healthy system emits zero, and zero is
  indistinguishable from a host that never wired the meter. ADR-041 puts it in exactly that gap
  (`041-observability-and-telemetry.md:197-200`).
- **The meter name is a duplicated literal.** `MMCA.Common.Aspire` subscribes it by string because that
  package has no reference to Application (`BestEffort.cs:89-92`, `Extensions.cs:170`), so a rename has
  to move in two places or the metric silently stops being exported.
- **A swallow is still a loss.** The helper decides that the caller does not see the failure; it does
  not make the side effect happen. A cache entry heals on its own TTL, but a lost broadcast never
  replays, and callers whose loss is unrecoverable have to say so themselves.
- **Two "best effort" counters exist.** The layer constraint on the API package means
  `cache.eviction.failed` and `besteffort.dispatch.failed` count the same shape of event on different
  meters, so an operator asking "what is silently failing" has two places to look.

## Related
[ADR-024](024-push-notifications.md) (push delivery failure is non-fatal and recorded rather than
raised, one of the local leniencies this policy generalizes),
[ADR-026](026-caching-strategy.md) (eviction is best-effort, and its `OutputCacheEvictionHandler` is
the framework's one documented non-reuse of this helper),
[ADR-041](041-observability-and-telemetry.md) (records `besteffort.dispatch.failed`, its meter, and
that it is wired to no alert),
[ADR-054](054-saga-compensation-and-reconciliation.md) (compensation is best-effort per line, and its
one hand-rolled swallow is the same question answered locally),
[ADR-076](076-data-subject-export.md) (per-section degradation makes an incomplete package the
contract rather than a failure),
[ADR-091](091-cache-backed-password-reset.md) (the reset email is awaited, caught, logged and
swallowed, the shape this helper standardizes).
