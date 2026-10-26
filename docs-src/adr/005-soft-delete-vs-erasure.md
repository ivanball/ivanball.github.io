# ADR-005: Soft-Delete vs. Right-to-Erasure

## Status
Accepted. Updated 2026-06-27 (documented the `[Pii]` → `IAnonymizable` build-time guard and `PiiRedactor`).
Updated 2026-08-26 (`DeletedOn`/`DeletedBy` stamps, the `DeleteChildren` cascade helper, and a
hard-delete fitness rule).
Updated 2026-09-07 (a pseudonymous key kept through anonymization must not appear on an
anonymous surface; Store's public review list is served through a contract that declares none).
Updated 2026-10-01 (corrected the `DeleteChildren` composition description; citations refreshed).
Revised 2026-10-06: Store's public review contract carries no reviewer name either, and the interceptor and controller anchors were refreshed.
Revised 2026-10-19: the framework guard runs in both directions (a reverse rule and a sample-coverage fact in `PiiConventionTestsBase`, v1.246.0), and ADC and Store both adopt it. Same date: ADC's `Speaker` becomes `IAnonymizable` with a `[Pii]` email that the cross-service `UserDeleted` erasure anonymizes before unlinking.
Revised 2026-10-21: ADC's Engagement module records each erased account in an `ErasedUser` row and refuses a later question, vote or upvote from it after the `UserDeleted` erasure ran; other Engagement write paths keyed to the caller's id (bookmark create, badge, room check-in, sponsor visit) run no such check.
Revised 2026-10-26: ADC's `ErasedUserGuard` now runs in seven Engagement write handlers keyed to the caller's id (bookmark create, badge, room check-in and sponsor visit joined question, vote and upvote), so the late-write residual of the 2026-10-21 revision is closed for those paths; the leaderboard opt-in, also keyed to the caller's id, does not call it and still lets an erased account that never opted in publish a fresh row, and the staff-driven check-ins do not call it either.
## Context
The framework's default deletion model is **soft-delete**: `AuditableBaseEntity.Delete()` sets `IsDeleted = true` and EF Core global query filters exclude the row from normal queries. The row (including any personal data it holds) stays in the database indefinitely, which is exactly what audit, referential integrity, and "undelete" (BR-135) require.

This conflicts with data-subject **erasure** rights (GDPR Art. 17 right-to-be-forgotten, CCPA deletion): when a person requests deletion, their personal data must actually be removed or anonymized, not merely hidden. Soft-delete alone is therefore non-compliant for personal data, and a consumer app's published privacy policy (e.g. a "we delete your data within 30 days" promise) cannot be honored by soft-delete.

A second source of retained personal data is the **outbox**: processed `OutboxMessage` rows hold serialized event payloads that may contain personal data and were previously never purged (ADR-003).

## Decision
Separate the two concerns and provide an extension point for each, rather than overloading soft-delete:

1. **Soft-delete stays the default** for lifecycle/state management (hide + retain + undelete). It is explicitly *not* a privacy mechanism. Three things make the lifecycle half complete rather than merely a flag:
   - **The deletion is stamped like any other audit fact.** `IAuditableEntity` carries `DeletedOn` and `DeletedBy` beside `CreatedOn/By` and `LastModifiedOn/By` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAuditableEntity.cs:26,29`, implemented at `.../Entities/AuditableBaseEntity.cs:39,45`), so "when was this deleted, and by whom" is answerable from the row rather than from an audit-trail lookup (ADR-075). The domain does not write them: the clock and the current user live in infrastructure, so `AuditSaveChangesInterceptor` stamps them from the `IsDeleted` **transition** (`.../MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:125-144`, called at `:87` and `:96`, prior value read at `:121-123`) and clears them on the reverse one (`Undelete`, BR-135, `AuditableBaseEntity.cs:89`). Driving it from the transition rather than from the value is what keeps a later update to an already-deleted row from re-stamping it, exactly as `CreatedOn/By` survive every update (`AuditSaveChangesInterceptor.cs:15-19`, `:126-128`, early return at `:137-140`, `CreatedOn/By` pinned at `:91-92`; the domain-side note at `AuditableBaseEntity.cs:60-64`).
   - **Cascading to children is a framework helper, not a loop per aggregate.** `AuditableAggregateRootEntity.DeleteChildren<TChild, TChildId>(children)` (`.../Domain/Entities/AuditableAggregateRootEntity.cs:273-292`) deletes every still-active child and aggregates the failures into one `Result` via `Result.Combine` (ADR-013, `:291`). Already-deleted children are skipped rather than reported, so re-deleting a parent is idempotent with respect to its children instead of surfacing an `AlreadyDeleted` error a caller cannot act on (`:283-286`, reasoning at `:252-255`). An aggregate composes it as `Result.Combine(DeleteChildren<OrderLine, OrderLineIdentifierType>(_lines), base.Delete())` (`:262`), so a failing child fails the whole cascade's `Result`. Both arguments are evaluated before `Combine` runs (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:124`), so the root's in-memory `IsDeleted` is set even when a child fails; what keeps the cascade atomic is that the caller does not save a failed `Result`.
   - **A hard delete is a reviewable exception, enforced by a fitness rule.** `ArchitectureRules.HardDeletesOnlyInAllowedTypes` (`.../Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.SoftDelete.cs:62`, surfaced through `.../Bases/Domain/SoftDeleteEnforcementTestsBase.cs:17,29-31`, whose `AllowedHardDeleteTypes` is empty by default and therefore bans hard deletes outright until a repo names its exceptions, `:27`) fails the build when EF Core's erasing members (`DbSet.Remove`/`RemoveRange`, `DbContext.Remove`/`RemoveRange`, `ExecuteDelete`/`ExecuteDeleteAsync`: `ArchitectureRules.SoftDelete.cs:10-11`, scoped to the entity-set declaring types at `:18-24`) are called from a type outside the repo's allowlist, which is the short list of places where erasing a row IS the requirement: retention purge jobs, outbox and audit-trail cleanup, and the erasure handlers below (`:26-34`, `SoftDeleteEnforcementTestsBase.cs:21-26`). Neither NetArchTest nor reflection can see a call inside a method body, so the rule reads IL through the Mono.Cecil that NetArchTest already carries and matches callees by full name, which keeps the testing package's zero-reference stance toward EF Core (`ArchitectureRules.SoftDelete.cs:36-43`, the callee test at `:124`). It sees only direct calls: a hard delete reached through a repo-owned interface is caught at the implementing type, so that implementation goes on the allowlist and the abstraction stays usable (`:51-56`).
2. **Erasure is an explicit, additive capability.** Aggregates that store personal data implement `IAnonymizable` (`MMCA.Common.Domain.Interfaces`). An application-layer erasure handler loads the aggregate, calls `Anonymize()` (idempotent, returns `Result`), and saves: overwriting personal fields in place so foreign keys and the audit trail survive. Fields that must remain retrievable are persisted through the AES-256-GCM `EncryptedStringConverter`. An erasure that runs on a consuming side reaches only the rows that exist when it runs, while an access token outlives the account it was issued for, so a consumer can record the erasure and refuse later writes from that id on each write path that checks the record (ADC Engagement's `ErasedUser`, which seven Engagement write handlers keyed to the caller's id check; the leaderboard opt-in does not, Revision 2026-10-26).
3. **Outbox retention is bounded.** `OutboxCleanupService` purges processed outbox rows older than `Outbox:RetentionDays` (default 7; set `0` to disable) across every relational data source, so event payloads are not retained indefinitely.
4. **A build-time guard backs the per-entity opt-in.** Domain properties holding data-subject personal data are marked `[Pii]` (`MMCA.Common.Domain.Attributes.PiiAttribute`, property-targeted). A fitness function (`ArchitectureRules.EntitiesWithPiiImplementAnonymizable`, surfaced through `PiiConventionTestsBase`) **fails the build** if any Domain entity declaring a `[Pii]` property does not implement `IAnonymizable`, so "this aggregate holds personal data but has no erasure path" is caught by tooling, not by review. The companion `PiiRedactor` (`MMCA.Common.Domain.Privacy`) masks the same `[Pii]`-marked members when an entity is written to a log or telemetry attribute, so personal data does not leak through diagnostics. The same base also runs the guard in reverse: whatever `Anonymize()` overwrites must carry `[Pii]` (Revision 2026-10-19).

The framework provides the **extension points** (`IAnonymizable`, `OutboxCleanupService`, `PiiRedactor`) and a **build-time guard** (the `[Pii]` → `IAnonymizable` fitness rule); each consumer app owns the **policy**: which properties are `[Pii]`, the erasure orchestration/endpoint (data-subject request handling), and any data-subject access/export endpoint, because the personal-data model lives in the consumer (e.g. ADC's `User`).

## Rationale
- **Right tool per concern**: soft-delete answers "is this record active?"; erasure answers "has this person's data been removed?". Conflating them (e.g. hard-deleting inside `Delete()`) would break audit, undelete, and referential integrity.
- **Audit-preserving**: anonymize-in-place keeps the row and its audit fields, satisfying both erasure and accountability obligations simultaneously.
- **Idempotent + Result-based**: matches the framework's domain conventions and tolerates retried erasure requests.
- **Bounded retention**: the cleanup service closes the "outbox grows forever / retains PII forever" gap noted in ADR-003 without changing delivery semantics.

## Trade-offs
- Erasure is opt-in per entity, but the opt-in is **guarded**: an aggregate exposing a `[Pii]`-marked property that does not implement `IAnonymizable` fails the architecture fitness test, so the "holds personal data but is not erasable" gap surfaces at build time rather than in a manual personal-data inventory. The residual risk shifts to *marking*: an entity that holds personal data on an **unmarked** property is invisible to the guard, so consumers still own the discipline of applying `[Pii]` to genuine data-subject fields.
- Anonymization is irreversible by design and is not the same operation as undelete.
- The late-write guard is per write path, not per account: ADC Engagement refuses in the seven handlers that call `ErasedUserGuard` (question, vote, upvote, bookmark create, badge, room check-in, sponsor visit), so any write that takes the caller's user id without calling it stays open to a token that outlives its account. One such path exists: the leaderboard opt-in refuses only an erased row the erasure left behind, so an erased account that never opted in can still publish a fresh public leaderboard row under the erased id, named from the token's claims. The two staff-driven check-in handlers write under an attendee's id rather than the caller's and do not call it either, so an organizer can record a check-in for an erased attendee's id. The guard is the second line of defence: the shared deleted-user marker already answers 401 on every host while it is readable (ADR-047), so a write reaches the guard only when the best-effort marker write failed or the shared cache read failed open within the access token's remaining lifetime (Revisions 2026-10-21 and 2026-10-26).
- The framework cannot, on its own, make a consumer compliant: the consumer must still wire the erasure handler, the data-subject request flow, and access/export. This ADR provides the extension points, not the policy.
- The default 7-day outbox retention is a **behavior change**: consumers upgrading the framework begin purging processed outbox rows older than 7 days unless they set `Outbox:RetentionDays = 0`.
- The `DeletedOn`/`DeletedBy` stamps are **two new nullable columns on every auditable table**, so adopting the framework version that introduced them costs one scaffolded migration per consumer database. They are additive (expand only, no ADR-057 override needed) and they are not backfilled: rows soft-deleted before the migration keep null stamps forever, so the pair answers "who deleted this" only from that point on.
- The fitness rule turns "we soft-delete, mostly" into a **reviewed inventory**, not into a guarantee. It sees direct IL calls in the assemblies the repo's architecture map registers, so raw SQL, a stored procedure, or a delete issued from an unmapped assembly is invisible to it, and an allowlist entry covers every erasing call in the named type rather than the one that was reviewed.

## Revision (2026-09-07)
Anonymization keeps the row and its foreign keys: `Anonymize()` overwrites the personal fields and
leaves the entity's relationships intact, because the aggregate still has to hang off the order and
the customer it belongs to. That is deliberate, and it creates one rule this record did not state.

**A pseudonymous key retained through anonymization must never be projected onto an anonymous
surface.** A customer id or an order id is not personal data on its own, but on a public list it
re-attaches every "anonymized" row to the same subject, and to that subject's other rows, for any
reader. Anonymization that a caller can undo by grouping is not anonymization.

Store's anonymous review list is the worked case (SEC-Store-07 / SEC-Store-18). The read is served
through `PublicProductReviewDTO`
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Reviews/PublicProductReviewDTO.cs:30`),
which declares the product id, rating, title, body, reviewer name, status and timestamps (`:33-60`)
and no `CustomerId` and no `OrderId`. The controller closes the anonymous paged endpoint over that
type rather than over the owner-facing DTO
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ReviewsController.cs:58`,
`:94-99`), and the caller's `sortColumn` is validated against the same type (`:107`), so the public
shape bounds both what is returned and what can be ordered on.

## Revision (2026-10-01)
No decision changed. One description in Decision 1 was corrected: it said composing
`Result.Combine(DeleteChildren<...>(_lines), base.Delete())` aborts the cascade "before the root is
touched". `Result.Combine` takes `params ReadOnlySpan<Result>`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:124`), so both arguments are
evaluated first and `base.Delete()` sets the root's `IsDeleted` in memory even when a child fails;
the failure surfaces through the combined `Result`, and the caller not saving it is what keeps the
cascade atomic (the framework's own wording at
`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:260-261` claims
only that a failing child aborts the cascade). Citations refreshed: `AuditSaveChangesInterceptor.cs`
(`:116-130`, `:73`, `:82`, `:108-109`, `:15-19`, `:123-126`), `AuditableAggregateRootEntity.cs`
(`:275-294`, `:293`, `:285-288`, `:253-257`, `:264`), and the fitness-rule paths, which moved under
`Rules/Domain/` and `Bases/Domain/` with their line anchors unchanged.

## Revision (2026-10-06)
No decision changed. Two facts recorded in the 2026-09-07 Revision were corrected against source:
- `PublicProductReviewDTO` carries **no reviewer name**, not only no `CustomerId` and no `OrderId`:
  its doc says so (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Reviews/PublicProductReviewDTO.cs:8`,
  `:16-18`, an anonymous visitor never sees a byline, so on the cached list the name only leaked).
  It declares the id, row version, product id, rating, title, body, status and the two timestamps
  (`:33-57`); the type is still declared at `:30`.
- In `ReviewsController.cs` the public query service is the constructor parameter at `:57`, the
  anonymous paged endpoint is `:88-99` (`[AllowAnonymous]` at `:89`, signature at `:93-99`, the
  public query service called at `:105`), and `sortColumn` is validated by
  `QueryFieldService.Validate<PublicProductReviewDTO>` at `:101` (`:107` only defaults it to
  `CreatedOn`).

Anchors were re-verified against current source. The interceptor anchors in Decision 1 moved
(`AuditSaveChangesInterceptor.cs:125-144`, `:87`, `:96`, `:121-123`, `:126-128`, `:91-92`; `:15-19`
unchanged), which supersedes the interceptor list recorded in the 2026-10-01 Revision; the
`AuditableBaseEntity.cs` and `AuditableAggregateRootEntity.cs` anchors are unchanged.

## Revision (2026-10-19)
No decision changed. The build-time guard in Decision 4 now runs in **both directions**, from the
framework rather than from one consumer (MMCA.Common v1.246.0):
- **Forward** (unchanged): `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/PiiConventionTestsBase.cs:34`).
- **Reverse**: `PropertiesOverwrittenByAnonymize_MustCarryPii` (`PiiConventionTestsBase.cs:43-44`,
  implemented by `ArchitectureRules.PropertiesOverwrittenByAnonymizeCarryPii` at
  `.../Rules/Governance/ArchitectureRules.Anonymization.cs:49`) builds each sample, runs
  `Anonymize()`, and fails on every string or reference property whose value moved without a `[Pii]`
  marker, because an unmarked overwritten field keeps its pre-erasure value in clear as an audit-trail
  `OldValue` (ADR-075). Value types and collections are out of scope (`:40-46`).
- **Coverage**: `EveryAnonymizableDomainEntity_IsCoveredBySample` (`PiiConventionTestsBase.cs:37-40`,
  `ArchitectureRules.Anonymization.cs:12`) fails when a concrete `IAnonymizable` type in a module
  Domain assembly has no sample, so a new erasable entity cannot escape the reverse rule. Samples come
  from the overridable `AnonymizableSamples` table, empty by default (`PiiConventionTestsBase.cs:31`),
  so a repo with no anonymizable module entity passes unchanged.

Both apps adopt it. Store moved its hand-written reverse rule into the base and keeps only its four
samples (`ProductReview`, `Customer`, `User`, `Order`) plus a non-vacuity guard
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Privacy/PiiConventionTests.cs:33-48`,
`:55-61`). ADC supplies two samples: a `User` built as an external account with every device field
filled, and a `Speaker` with every profile field and the user link filled
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Privacy/PiiConventionTests.cs:23-30`,
`:31-41`). The reverse rule found six fields ADC's `Anonymize()` overwrote without a marker; `DeviceFormFactor`,
`DevicePlatform`, `DeviceModel`, `DeviceManufacturer`, `DeviceType` and `LoginProvider` now carry
`[Pii]` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:85`, `:89`, `:93`,
`:97`, `:105`, `:109`), and a data-only migration redacts their existing audit-trail rows
(`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20261019200206_RedactAuditTrailDeviceAndProviderValues.cs:26-29`).

ADC's `Speaker` is the second anonymizable entity. It implements `IAnonymizable`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:28`) with one
`[Pii]` field, the organizer-held `Email` (`:40-41`). `Anonymize()` (`:330`) replaces it with
`deleted-{Id}@anonymized.invalid` (`:337`) and keeps the name, biography and the rest of the profile,
because those are the published event program rather than account data; a speaker with no email, or
already carrying the placeholder, is a no-op. The erasure reaches it across services: Identity's
`UserDeleted` integration event is consumed in Conference by `UserDeletedSpeakerErasureHandler`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserDeletedSpeakerErasureHandler.cs:40`),
which anonymizes every speaker linked to the erased account and then unlinks it (`:66`, `:74`) in
one save, since the link is the only way to find the speaker. A data-only migration redacts the
speaker email values already in the Conference audit trail
(`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20261019232613_RedactAuditTrailSpeakerEmailValues.cs:24-27`).
Two paths cannot bring the address back. The Sessionize sync never writes an email: a new speaker is
created with none and an update passes the stored value through
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SpeakerSyncStrategy.cs:126`,
`:163`). And the BR-207 auto-link matches only a provider-verified email
(`.../Users/IntegrationEventHandlers/UserRegisteredHandler.cs:99`), which an address on the reserved
`.invalid` domain can never be, so the placeholder cannot re-attach the profile to anyone.

The Trade-offs residual narrows accordingly: a field that `Anonymize()` overwrites can no longer go
unmarked. A personal-data field that the erasure never touches is still invisible to both directions,
so marking discipline remains the consumer's for those.

## Revision (2026-10-21)
Re-verified against current source. Decisions 1, 3 and 4 are unchanged; Decision 2 gains one
sentence and the Trade-offs one bullet, both recording the late-write guard on the consuming side
of the `UserDeleted` erasure in ADC and its limits.

1. **ADC Engagement keeps an `ErasedUser` record per erased account.** The aggregate holds the user
   id and the erasure time only, no name, email or other personal data
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/ErasedUsers/ErasedUser.cs:19`,
   `:22`, `:25`, rationale at `:8-16`), with a unique index on `UserId`
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/ErasedUsers/ErasedUserConfiguration.cs:29-30`;
   table added by `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20261020142915_AddErasedUsers.cs:15`).
   One consumer of `UserDeleted` writes it, `UserDeletedSessionQuestionsHandler`
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/IntegrationEventHandlers/UserDeletedSessionQuestionsHandler.cs:33`),
   in the same save as the question-text erasure and upvote deletion (`:72`, `:79`), stamped with
   the event's `DeletedOn` (`:106`). `RecordErasureAsync` (`:94`) checks for an existing record
   first (`:101`) and adds one only when absent (`:112`), so a redelivery writes nothing and a
   concurrent duplicate fails the unique index and is retried into that state.
2. **The write handlers check it.** `ErasedUserGuard.EnsureNotErasedAsync`
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/ErasedUsers/ErasedUserGuard.cs:26`)
   asks whether a record exists for the caller (`:33`) and fails with `Error.Forbidden` (`:38`)
   under the code `Engagement.AccountErased` (`:18`). Three handlers call it before writing:
   submitting a question (`.../SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:66-68`),
   toggling an upvote (`.../SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:33-35`)
   and casting a poll vote (`.../LivePolls/UseCases/CastVote/CastVoteHandler.cs:36-38`). Without
   it, a question, vote or upvote that the erased account's still-valid access token sends after
   the erasure ran would carry the erased user id (and, for a question, free text) that no erasure
   revisits.
3. **Coverage elsewhere.** No other ADC handler reads `ErasedUser`. The leaderboard opt-in relies
   on its own terminal marker instead: an erased, soft-deleted opt-in row refuses reactivation with
   `Points.AccountErased`
   (`.../Points/UseCases/SetLeaderboardParticipation/SetLeaderboardParticipationHandler.cs:92-97`).
   Four Engagement write paths keyed to the caller's id run no check at all. Two of them recreate
   rows the erasure removes: `UserDeletedBookmarksHandler` soft-deletes the account's bookmarks
   (`.../UserSessionBookmarks/IntegrationEventHandlers/UserDeletedBookmarksHandler.cs:46`), yet
   `CreateBookmarkHandler` creates or reactivates one for `command.UserId`
   (`.../UserSessionBookmarks/UseCases/Create/CreateBookmarkHandler.cs:56`); and
   `UserDeletedBadgeHandler` soft-deletes the attendee badge
   (`.../CheckIns/IntegrationEventHandlers/UserDeletedBadgeHandler.cs:46`), yet
   `GetOrCreateMyBadgeHandler` mints one for the caller
   (`.../CheckIns/UseCases/GetOrCreateMyBadge/GetOrCreateMyBadgeHandler.cs:29`, `:41`). The room
   check-in and sponsor-visit handlers also write under the caller's id
   (`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:58`,
   `.../CheckIns/UseCases/RecordSponsorVisit/RecordSponsorVisitHandler.cs:50`). These paths are
   reachable only behind the first line of defence failing: the erasure writes the shared
   deleted-user marker, best effort, for the 15-minute access-token lifetime
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:166`,
   `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:32`), and
   `SoftDeletedUserMiddleware` answers 401 on every host, Engagement included, while it reads
   that marker
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:105-111`),
   failing open when the shared cache read throws (`:95-103`). So a still-valid token can bring
   back an erased bookmark or badge row for the erased id only when the marker write failed or the
   cache read failed open before that token lapsed; the `ErasedUser` guard exists to close that
   same residual for questions, votes and upvotes.
   Store has no equivalent record or guard (no match in `MMCA.Store/Source`).

## Revision (2026-10-26)
Re-verified against current source. Decisions 1, 3 and 4 are unchanged. The late-write guard
recorded in the 2026-10-21 Revision now covers seven Engagement write handlers keyed to the
caller's id, though not the leaderboard opt-in, so Decision 2's closing sentence and the matching
Trade-offs bullet were updated; the 2026-10-21 Revision itself stays as written.

1. **Seven handlers call `ErasedUserGuard`.** Besides question, upvote and vote
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:66-68`,
   `.../SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:33-35`,
   `.../LivePolls/UseCases/CastVote/CastVoteHandler.cs:36-38`), the guard now runs before creating
   or reactivating a bookmark (`.../UserSessionBookmarks/UseCases/Create/CreateBookmarkHandler.cs:32-34`),
   minting the attendee badge (`.../CheckIns/UseCases/GetOrCreateMyBadge/GetOrCreateMyBadgeHandler.cs:40-42`),
   recording a room check-in (`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:66-68`)
   and recording a sponsor visit (`.../CheckIns/UseCases/RecordSponsorVisit/RecordSponsorVisitHandler.cs:58-60`).
   The guard's own doc names the same set (`.../ErasedUsers/ErasedUserGuard.cs:7-14`), as do the
   erasure handler that writes the record
   (`.../SessionQuestions/IntegrationEventHandlers/UserDeletedSessionQuestionsHandler.cs:17-19`,
   `:85-87`) and the aggregate (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/ErasedUsers/ErasedUser.cs:8-17`).
   An erased bookmark or badge therefore cannot come back under the erased id even when the shared
   deleted-user marker is unreadable, which closes the residual item 3 of the 2026-10-21 Revision
   described for those four paths.
2. **The leaderboard opt-in does not call it.** `SetLeaderboardParticipationHandler` writes under
   the caller's id
   (`.../Points/UseCases/SetLeaderboardParticipation/SetLeaderboardParticipationHandler.cs:46-50`)
   and still relies on its own terminal marker, refusing only a soft-deleted row whose name the
   erasure replaced (`:91-97`). The erasure only erases rows that already exist
   (`.../Points/IntegrationEventHandlers/UserDeletedPointsHandler.cs:66-84`) and creates none, so
   for an account that never opted in a still-valid token can create a fresh opt-in under the
   erased id (`SetLeaderboardParticipationHandler.cs:105-109`, saved at `:114`) carrying the
   display name resolved from the token's claims (`:67`). That residual stays open, behind the same
   first line of defence as before.
3. **Staff-driven check-ins do not call it.** `ManualCheckInHandler` and `CheckInAttendeeHandler`
   write a check-in under an attendee's id taken from the command or the scanned badge
   (`.../CheckIns/UseCases/ManualCheckIn/ManualCheckInHandler.cs:44`,
   `.../CheckIns/UseCases/CheckInAttendee/CheckInAttendeeHandler.cs:64`), not under the caller's id,
   and nothing on that path reads `ErasedUser`, so an organizer naming an erased attendee's id in a
   manual check-in records it under that id. Both are organizer-only operations; the residual is
   recorded here rather than closed.
4. Anchors re-verified against current source: `AuditableAggregateRootEntity.cs` moved
   (`DeleteChildren` at `:273-292`, `Result.Combine` at `:291`, the already-deleted skip at
   `:283-286`, its reasoning at `:252-255`, the compose example at `:262`), which supersedes the
   `AuditableAggregateRootEntity.cs` anchors in the 2026-10-01 and 2026-10-06 Revisions (the
   framework wording cited there at `:260-261` is now `:258-259`); `Result.cs:124` unchanged. Later
   anchors in the dated Revisions moved as follows and are recorded here rather than edited there:
   `UserDeletedSessionQuestionsHandler.cs` class `:34`, `RecordErasureAsync` call `:73`, save `:80`,
   declaration `:96`, existence check `:103`, `DeletedOn` stamp `:108`, add `:114`; `ErasedUser.cs`
   class `:20`, `UserId` `:23`, `ErasedOn` `:26`; ADC `User.cs` `[Pii]` markers `:86`, `:90`, `:94`,
   `:98`, `:106`, `:110`; `SpeakerSyncStrategy.cs` pass-through of the stored email `:162` (`:126`
   unchanged); `UserDeletedSpeakerErasureHandler.cs` class `:50`, `Anonymize()` `:79`,
   `UnlinkUser()` `:87`, single save `:99`. `ErasedUserGuard.cs:18`, `:26`, `:33`, `:38`,
   `ErasedUserConfiguration.cs:29-30` and `20261020142915_AddErasedUsers.cs:15` are unchanged.
