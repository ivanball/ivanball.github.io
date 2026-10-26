# ADR-096: Best-Effort Side-Effect Contract

## Status
Accepted (2026-08-23). Revised 2026-08-31. Revised 2026-09-19. Revised 2026-09-25 (the ADR-054 cross-reference is
re-anchored onto that record's current best-effort trade-off). Revised 2026-10-01. Revised 2026-10-06:
adoption is thirteen call sites with the ADC points award, and every Store Catalog controller evicts
both catalog tags. Revised 2026-10-07: anchors refreshed after the v1.233.0 release. Revised
2026-10-21: the ADR-026 layer-crossing reason for the hand-rolled eviction handler is recorded as
contradicted by source (the API package already calls `BestEffort` on its own meter), the submit
broadcast's two mutually exclusive enqueue branches are cited, and anchors are refreshed. Revised
2026-10-26: adoption is fifteen call sites, adding the ADC Conference speaker-cache eviction and the
framework's post-sign-in password rehash (a second explicit `CancellationToken.None` caller), and
anchors are refreshed.

## Context
A command that has already committed often has follow-up work attached to it: evict the output-cache
entries the write invalidated, broadcast the new state to a live channel, send the notification the
user is waiting for. That work can fail on its own, and when it does the question is not whether to
retry but what the failure is allowed to do to the caller. Turning it into an exception would roll
back, retry or 500 an operation whose real work already succeeded.

Five records each answer that question locally, for their own feature, and each answer is right:
ADR-024 makes a push delivery failure non-fatal and records `MarkAsFailed` instead
(`024-push-notifications.md:76-79`), ADR-026 makes cross-service cache eviction best-effort so a broken
eviction store cannot dead-letter a coherence hint, ADR-076 degrades a data-subject export per section
rather than failing the package (`076-data-subject-export.md:91-98`), ADR-091 composes the reset email in
the handler and delivers it best-effort, "awaited and its failure caught, logged and swallowed"
(`091-cache-backed-password-reset.md:87-96`), and ADR-054 makes compensation best-effort per order
line (`054-saga-compensation-and-reconciliation.md:254-265`). What none of them decides is the **policy**:
which failures may be swallowed at all, at what severity, whether cancellation counts as one of them,
and how a swallow is made visible to somebody who is not reading the log. Answered per call site, that
produces a repo full of hand-rolled `catch (Exception)` blocks, each choosing its own severity, its
own treatment of cancellation and its own decision to count nothing. ADR-041 records the counter this
record's helper emits and notes that it is wired to no alert (`041-observability-and-telemetry.md:288-292`,
`:311-314`), but it records the instrument, not the contract behind it.

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
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:311`).
- **The operation name is a low-cardinality constant.** It becomes a metric tag (`:22`), so call sites
  pass a `const` or a fixed prefix plus a value from a small fixed set. A blank name throws
  `ArgumentException` and a null logger or action throws `ArgumentNullException` (`:51-53`): the helper
  swallows the side effect's failures, never its own caller's bugs.
- **Cancellation is not swallowed.** An `OperationCanceledException` raised while the caller's own
  token is cancelled is rethrown (`:59-63`), so a host shutdown or an abandoned request unwinds
  promptly instead of being recorded as a spurious side-effect failure. A cancellation that is not the
  caller's (an inner timeout) is a genuine failure of the side effect and is swallowed like any other.
- **Post-commit work passes `CancellationToken.None` on purpose.** The write has committed, so its
  follow-up must outlive a caller that has already walked away: the framework's own output-cache
  eviction helper passes it explicitly
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:78-92`,
  the token at `:90`), and so does the framework's post-sign-in password rehash, because the sign-in
  is complete and an abandoned request must not surface a cancellation from it
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:705`, the
  reasoning at `:664-671`); the ADC submit and moderation broadcasts take the parameter's default for
  the same reason (`.../SubmitQuestionHandler.cs:199-202`, the call closing at `:237`, and
  `.../ModerateQuestionHandler.cs:157`), while the three ADC domain-event handlers pass their own
  `cancellationToken` (`.../SessionQuestionUpvoteChangedHandler.cs:91`,
  `.../LivePollVoteChangedHandler.cs:83` and `.../SessionQuestionSubmittedPointsHandler.cs:102`), as
  does the ADC Conference integration-event handler (`.../UserDeletedSpeakerErasureHandler.cs:108`),
  and the hosted bookmark eviction processor passes its `stoppingToken`
  (`.../Caching/BookmarkCacheEvictionProcessor.cs:77`). Those four handlers are post-commit work too
  (the Conference handler saves at `.../UserDeletedSpeakerErasureHandler.cs:99` before its call at
  `:102-108`), and none records a reason for keeping its own token, so this rule is followed by the
  framework sites and the two ADC broadcasts, not by every post-commit caller.
- **The contract is pinned by tests.** `BestEffortTests` covers the transparent success path, token
  passthrough, one-Warning-per-failure, the `operation`-tagged increment observed through a
  `MeterListener`, the rethrow of the caller's cancellation, the swallow of a non-caller cancellation,
  and argument validation
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/BestEffortTests.cs:15-169`).

Adoption today is **fifteen call sites**: eight in ADC (seven in Engagement, one in Conference), five
in Store, and two in the framework (its own eviction helper and the post-sign-in password rehash). The
ADC Engagement seven are the
live-channel drain worker, whose operation name is the prefix `live-channel-publish:` plus the work
item's event name and whose own catch turns the rethrown cancellation into a quiet stop
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:47`,
`:125-126`, `:100-105`); three session-question broadcasts, `session-question-submit-broadcast`
(`.../SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:42`, call at `:208`, which enqueues
onto the live-channel publish queue rather than publishing inline, exactly once per submit: the
approved branch at `:219-220` or the pending-count branch at `:234-235`),
`session-question-moderation-broadcast` (`.../UseCases/Moderate/ModerateQuestionHandler.cs:31`, call at
`:138`) and `session-question-upvote-broadcast`
(`.../DomainEventHandlers/SessionQuestionUpvoteChangedHandler.cs:47`, call at `:54`); the poll-results
broadcast `livepoll-results-broadcast`
(`.../LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:44`, call at `:51`); and the
cross-host cache eviction `bookmark-cache-evict-broadcast`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Caching/BookmarkCacheEvictionProcessor.cs:49`,
call at `:62-77`, a hosted processor that drains the signal the domain-event handler raises); and the
question-asked points award `session-question-points-award`, which runs after the question's transaction
commits so a failed award never fails the committed question
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandler.cs:59`,
call at `:82-102`). The ADC Conference site is the speaker-list eviction `speaker-cache-evict`, raised
after a user deletion anonymizes and unlinks that user's speakers, so a broker fault cannot fail an
erasure that has already been saved
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserDeletedSpeakerErasureHandler.cs:102-108`,
after `SaveChangesAsync` at `:99`). The Store five are a checkout display label, `checkout-customer-name`, resolved by the
checkout preflight outside the transaction so an unreachable Identity leaves the name null instead of
failing an otherwise valid checkout
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutPreflight.cs:77-87`,
the operation name at `:78`, the outside-the-transaction reasoning at `:17-24`);
three inventory label fetches sharing the operation name `inventory-catalog-labels`, so a Catalog service
that drops out leaves rows with whatever labels they had
(`.../Inventory/UseCases/Create/CreateInventoryItemHandler.cs:68`,
`.../Inventory/UseCases/BulkSet/BulkSetInventoryHandler.cs:67` and
`.../Inventory/UseCases/Set/AdjustInventoryHandler.cs:64-65`); and the post-save eviction broadcast
`review-anonymize-cache-evict-broadcast` raised after a customer erasure anonymizes reviews, where a
broker fault must not fail an erasure that has already committed
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Reviews/IntegrationEventHandlers/CustomerErasedHandler.cs:62`,
call at `:109-115`). Four of those five are pre-commit reads rather than post-commit follow-ups (the
create fetch runs before `base.PersistAsync` at `CreateInventoryItemHandler.cs:82`, the set fetch before
`SaveChangesAsync` at `AdjustInventoryHandler.cs:79`): the
contract is about what a failure is allowed to do to the caller, not about where in the handler the
work sits. The framework's first site is its post-sign-in password rehash, `password-rehash`, which
runs after the tokens are issued so a concurrency conflict or a dropped connection is swallowed by the
helper and cannot fail a sign-in that has already succeeded
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:78`, call at
`:682-705`). A refused invariant never reaches the swallow: the action logs `PasswordRehashRejected`
and returns normally, with no Warning from the helper and no `besteffort.dispatch.failed` increment
(`:693-700`), although the method's own remark says such a failure "is logged and counted through"
the helper (`:664-668`). The second is its own multi-tag eviction helper,
`OutputCacheEvictionExtensions.TryEvictTagsAsync`, whose operation name is the constant prefix
`output-cache-evict:` plus the tag being evicted
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:34`,
`:78-92`). Store Catalog reaches it from seven controllers, each passing fixed low-cardinality cache
tags, and every one of them evicts `catalog:products` and `catalog:categories` together:
`Controllers/CategoriesController.cs:174`, `ProductsController.cs:190`, `ProductVariantsController.cs:212`,
`ProductImagesController.cs:219`, `ReviewsController.cs:329`, `ReviewModerationController.cs:166` and
`ProductAttributesController.cs:154`.

One swallow stays hand-rolled. The framework's own
`OutputCacheEvictionHandler` hand-rolls the same swallow-log-count shape against
`cache.eviction.failed` on the `MMCA.Common.OutputCache` meter
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionHandler.cs:51-62`): it is
the one documented non-reuse of this helper inside the framework. The rationale ADR-026 records for it
(`026-caching-strategy.md:614-619`) no longer matches source. ADR-026 says the API package cannot reach
`BestEffort` without either a layer-crossing reference or a duplicated meter name, and calls the
hand-rolled copy a small duplication chosen over a worse coupling; yet the same package's
`TryEvictTagsAsync` imports `MMCA.Common.Application.Services` and calls `BestEffort.ExecuteAsync` on
the helper's own meter, with no meter name restated
(`.../Caching/OutputCacheEvictionExtensions.cs:7`, `:86-90`), the allowed API-to-Application
direction. Neither half of that reason holds, and no other reason for the non-reuse is recorded in
source. What the handler does differently is observable, not justified: it counts per tag on
`cache.eviction.failed`, tagged `cache_tag` (`.../Caching/OutputCacheMetrics.cs:30`, `:37`), rather than
on the `operation`-tagged `besteffort.dispatch.failed`; it rethrows every `OperationCanceledException`
(`OutputCacheEvictionHandler.cs:56`), where the helper rethrows only the caller's own cancellation and
swallows any other (`BestEffort.cs:59-63`); and it logs a Debug line on each successful eviction
(`OutputCacheEvictionHandler.cs:54`).

Store's `AddVariantHandler` used to be the second hand-rolled case, and it now shows what the contract
says to do when a side effect is too important to swallow: stop swallowing it. It no longer catches
anything and no longer publishes inline. After `SaveChangesAsync` populates the database-generated
`ProductVariantId`, it schedules a durable ADR-114 internal
command, `PublishProductVariantChangedInternalCommand`, carrying the `ProductId` and that
`ProductVariantId`, with `CancellationToken.None` so the follow-up outlives a caller
that has walked away
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/UseCases/AddVariant/AddVariantHandler.cs:92-95`).
The command is `ITransactional` (`AddVariantCommand.cs:25`), so the scheduler only enrolls the row and
the transactional pipeline saves it just before the commit: the row commits with the variant
(`AddVariantHandler.cs:77`, `:79-82`, `:97-98`).
The scheduled row is the durable record, so a broker fault retries with backoff instead of stranding the
variant without inventory; an inline publish left a window in which a crash between the commit and the
publish lost the event outright, and the outbox could not help because the row only lands there once
`PublishAsync` has been reached. What survives is much narrower: only a failure to write the row itself
loses the event. That failure arrives as a `Result`, not an exception, and is still isolated from the
caller's outcome (the variant is committed, and a client retry with a null SKU would create a duplicate),
and it is still logged at **Error** with both ids, because it is the case where an admin has to create
the inventory record by hand (`:99-100`, the `[LoggerMessage]` at `:110-113`).

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
  was exactly that case, and the answer was to make the work durable rather than to keep it outside the
  helper: the publish became a scheduled internal command, and only the narrow failure to record that
  command still logs at Error.

## Trade-offs
- **Nothing gates use of the helper.** There is no fitness rule, analyzer or architecture test that
  fails a build for a hand-rolled `catch (Exception)` that should have been a `BestEffort` call; the
  helper is a convention backed by review. The only inventory is a search, which is how the fifteen call
  sites and the one remaining hand-rolled swallow above were enumerated.
- **The Warning carries the operation name and the exception, nothing else.** No entity id, no
  correlation payload beyond the ambient scope. `SubmitQuestionHandler` records that cost explicitly:
  the question id is one log line earlier, not in the best-effort warning
  (`.../Submit/SubmitQuestionHandler.cs:202-204`).
- **The counter is failure-only and alerts on nothing.** A healthy system emits zero, and zero is
  indistinguishable from a host that never wired the meter. ADR-041 puts it in exactly that gap
  (`041-observability-and-telemetry.md:311-314`).
- **The meter name is a duplicated literal.** `MMCA.Common.Aspire` subscribes it by string because that
  package has no reference to Application (`BestEffort.cs:89-92`, `Extensions.Telemetry.cs:311`), so a rename has
  to move in two places or the metric silently stops being exported.
- **A swallow is still a loss.** The helper decides that the caller does not see the failure; it does
  not make the side effect happen. A cache entry heals on its own TTL, but a lost broadcast never
  replays, and callers whose loss is unrecoverable have to say so themselves.
- **Two "best effort" counters exist.** `cache.eviction.failed` and `besteffort.dispatch.failed` count
  the same shape of event on different meters, one per the ADR-026 non-reuse and one from this helper,
  so an operator asking "what is silently failing" has two places to look.

## Revision (2026-10-01)
No decision or rationale changed; the adoption inventory and several statements about it are
corrected. Adoption is twelve call sites, not eleven: Store's inventory set path is a fifth Store site,
a third `inventory-catalog-labels` fetch
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Inventory/UseCases/Set/AdjustInventoryHandler.cs:66-67`).
The `checkout-customer-name` call lives in the checkout preflight, not the handler
(`.../ShoppingCarts/UseCases/CheckOut/CheckOutPreflight.cs:77-87`). Four of the five Store sites are
pre-commit reads, not two. Only the ADC submit and moderation broadcasts take the token parameter's
default; the two domain-event handlers pass their own token
(`.../SessionQuestionUpvoteChangedHandler.cs:84`, `.../LivePollVoteChangedHandler.cs:83`) and the
bookmark eviction processor passes its `stoppingToken` (`.../BookmarkCacheEvictionProcessor.cs:77`). Store Catalog reaches `TryEvictTagsAsync` from
seven controllers, three of them evicting two tags at once (`CategoriesController.cs:171`). The
`AddVariantHandler` schedule runs inside the `ITransactional` command and commits with the variant
rather than after the commit (`AddVariantHandler.cs:76-79`, `:94-95`). Citations refreshed: the meter
subscription (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:313`),
`SubmitQuestionHandler`, `AddVariantHandler`, the controller lines, and the ADR-024, ADR-026 and
ADR-041 cross-references.

## Revision (2026-10-06)
No decision or rationale changed; the adoption inventory is corrected again.
- Adoption is thirteen call sites, not twelve: ADC adds the question-asked points award,
  `session-question-points-award`
  (`.../Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandler.cs:59`, call at `:82-102`),
  which passes its own `cancellationToken` (`:102`), so three ADC domain-event handlers do, not two.
- All seven Store Catalog controllers now evict `catalog:products` and `catalog:categories` together;
  none evicts `catalog:products` alone (`ReviewsController.cs:324`).
- The hand-rolled `OutputCacheEvictionHandler` paragraph no longer claims the code itself documents
  the non-reuse: the handler's comment justifies only the broad catch (`OutputCacheEvictionHandler.cs:58-59`).
- Anchors re-verified against current source: the ADR-026, ADR-054 and ADR-091 cross-references,
  `AddVariantHandler` and the seven controller lines.

## Revision (2026-10-07)
Re-verified against current source. No decision, rationale or adoption count changed; only anchors
moved.
- Anchors re-verified against current source: the live-channel drain worker's operation-name prefix
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:46`),
  its `BestEffort.ExecuteAsync` call (`:120-121`) and the quiet-stop catch for the rethrown
  cancellation (`:96-101`); the ADR-024 non-fatal delivery bullet (`024-push-notifications.md:74-77`);
  the ADR-076 per-section degradation section (`076-data-subject-export.md:87-89`); and the ADR-041
  counter record and its failure-only, no-alert paragraph (`041-observability-and-telemetry.md:243-252`,
  `:270-273`).

## Revision (2026-10-21)
Re-verified against current source. No decision or adoption count changed; this record stops relying
on one ADR-026 rationale that source contradicts, one call-site description is corrected, and anchors
moved.
1. The hand-rolled `OutputCacheEvictionHandler` paragraph no longer leans on ADR-026's stated reason
   that the API package cannot reach `BestEffort` without either a layer-crossing reference or a
   duplicated meter name: the same package's `TryEvictTagsAsync` already imports
   `MMCA.Common.Application.Services` and calls the helper on its own meter
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:7`,
   `:86-90`), so both halves fail and the "worse coupling" conclusion with them. The handler still
   hand-rolls its swallow; the paragraph now lists what it does differently with no rationale attached:
   its `cache_tag`-tagged `cache.eviction.failed` counter (`.../Caching/OutputCacheMetrics.cs:30`, `:37`),
   rethrowing every cancellation (`.../Caching/OutputCacheEvictionHandler.cs:56`) and a Debug line on
   success (`:54`).
2. The submit broadcast enqueues onto the live-channel publish queue from one of two mutually exclusive
   branches, once per submit: approved
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:223-224`)
   or pending count (`:238-239`).
3. Anchors re-verified against current source: the Aspire meter subscription
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:314`); the live-channel drain
   worker's prefix, call and quiet-stop catch (`.../Live/LiveChannelPublishProcessor.cs:47`,
   `:125-126`, `:100-105`); `SubmitQuestionHandler` (constant `:42`, call `:212`, token rationale
   `:203-206`, call closing `:241`, cost note `:206-208`); `SessionQuestionUpvoteChangedHandler`
   (`:47`, `:54`, token `:91`); `BestEffortTests.cs:15-169`; the moved controller lines
   (`ProductsController.cs:190`, `ProductVariantsController.cs:212`, `ReviewsController.cs:329`); and
   the ADR-026 (`:614-619`), ADR-041 (`:251-260`, `:278-281`), ADR-054 (`:254-265`) and ADR-091
   (`:86-93`) cross-references.

## Revision (2026-10-26)
Re-verified against current source. No decision or rationale changed; the adoption inventory grows by
two call sites, the `CancellationToken.None` bullet names both framework callers, and anchors moved.
1. Adoption is fifteen call sites, not thirteen: eight in ADC, five in Store and two in the framework.
   ADC Conference adds `speaker-cache-evict`, raised after the user-deletion speaker erasure saves and
   passing the handler's own token
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserDeletedSpeakerErasureHandler.cs:102-108`,
   `SaveChangesAsync` at `:99`). The framework adds the post-sign-in password rehash,
   `password-rehash`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:78`, call at
   `:682-705`).
2. The rehash passes `CancellationToken.None` explicitly, so the Decision's post-commit bullet now
   names it beside the eviction helper (`AuthenticationServiceBase.cs:705`, reasoning at `:664-671`),
   and lists the Conference handler among the callers that pass their own token (`:108`).
3. Anchors re-verified against current source: the Aspire meter subscription
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:311`);
   `SubmitQuestionHandler` (call `:208`, token rationale `:199-202`, call closing `:237`, cost note
   `:202-204`, approved branch `:219-220`, pending-count branch `:234-235`); `AdjustInventoryHandler`
   (call `:64-65`, `SaveChangesAsync` `:79`); `ProductImagesController.cs:219`; and the ADR-024
   (`:76-79`), ADR-041 (`:288-292`, `:311-314`), ADR-076 (`:91-98`) and ADR-091 (`:87-96`)
   cross-references.
4. The `CancellationToken.None` bullet now says the four handler sites that keep their own token are
   post-commit work with no recorded reason, and the password-rehash paragraph separates the
   refused-invariant path, which is logged as `PasswordRehashRejected` without reaching the helper's
   swallow or counter (`AuthenticationServiceBase.cs:693-700`).

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
swallowed, the shape this helper standardizes),
[ADR-114](114-internal-commands-durable-job-queue.md) (the durable queue `AddVariantHandler` now
schedules onto, the alternative to swallowing a side effect whose loss is unrecoverable).
