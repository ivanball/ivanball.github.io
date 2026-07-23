# Phase 1: Dependency Manifest & Leveling

Each distinct type node is assigned a **Level** by longest-path layering over its
first-party dependencies (base/interface, generic constraints, field/property/param/return
types, attributes, instantiations, static access). Edges resolved by namespace-aware name
matching against the first-party type set; mutually-dependent types are grouped in one SCC
and share a level (cycles listed below).

### Edge resolution & accuracy

A referenced simple name resolves to a first-party type when that type's declaring
namespace is visible to the referencing type, via a file `using`, an assembly-wide
`global using`, the type's own namespace, or any ancestor namespace (C# allows simple-name
references to types in enclosing namespaces without a `using`). If no namespace-visible
candidate exists but the bare name is **globally unique** among first-party types, the edge
is still linked (only one possible target). Names that are neither visible nor unique are
dropped as unresolvable without full semantic binding.

- Edges resolved by namespace visibility: **8871** (~96%)
- Edges resolved by globally-unique name (fallback): **331**
- References dropped as ambiguous (matched >1 type, none visible): **27**
- Sensitivity: **362 / 2588** type levels would change if the globally-unique fallback
  were excluded; the fallback is retained because a globally-unique first-party name is
  unambiguous, so excluding it would under-count real dependencies.

Verified non-factors (add zero hidden first-party edges, confirmed by source scan): the
`…IdentifierType` aliases all map to BCL primitives (`int`/`System.Guid`); there are no
MSBuild `<Using>` global usings and no first-party `using static`; the only two first-party
alias `using`s name a target whose bare name already matches (so they resolve regardless).

## Level distribution

| Level | Distinct types |
|-------|------|
| 0 | 517 |
| 1 | 313 |
| 2 | 204 |
| 3 | 207 |
| 4 | 263 |
| 5 | 172 |
| 6 | 153 |
| 7 | 152 |
| 8 | 249 |
| 9 | 108 |
| 10 | 132 |
| 11 | 16 |
| 12 | 20 |
| 13 | 8 |
| 14 | 6 |
| 15 | 14 |
| 16 | 53 |
| 17 | 1 |

## Cycles (SCC size > 1): 16

| Level | Size | Members |
|-------|------|---------|
| 2 | 3 | Shared:Result, Shared:ResultJsonConverterFactory, Shared:ResultConverter |
| 2 | 2 | API:SessionCookieEndpoints, API:SessionCookieJar |
| 2 | 2 | UI:NotificationHubService, UI:ChannelSubscription |
| 3 | 2 | Shared:Currency, Shared:CurrencyJsonConverter |
| 3 | 2 | Shared:Address, Shared:AddressInvariants |
| 5 | 4 | Domain:Event, Domain:EventQuestionAnswer, Domain:EventSpeaker, Domain:Room |
| 5 | 3 | Domain:Speaker, Domain:SpeakerCategoryItem, Domain:SpeakerQuestionAnswer |
| 5 | 3 | Domain:Category, Domain:CategoryInvariants, Domain:CategoryItem |
| 5 | 2 | Tests:DegradeOrder, Tests:DegradeCustomer |
| 6 | 6 | Infrastructure:ApplicationDbContext, Infrastructure:DataSourceModelCacheKeyFactory, Infrastructure:AuditSaveChangesInterceptor, Infrastructure:DomainEventSaveChangesInterceptor, Infrastructure:DeferredDispatch, Infrastructure:OutboxFinalizer |
| 6 | 4 | Domain:Session, Domain:SessionCategoryItem, Domain:SessionQuestionAnswer, Domain:SessionSpeaker |
| 6 | 2 | Tests:ModelBuilderExtensionsTests, Tests:TestModelBuilderDbContext |
| 6 | 2 | Domain:LivePoll, Domain:LivePollOption |
| 7 | 2 | Tests:SpecificationFitnessTests, Tests:SpecTestMap |
| 9 | 3 | Tests:CosmosConfigurationPortabilityTests, Tests:FixedAssemblyProvider, Tests:MultiSourceSqliteIntegrationTests |
| 9 | 2 | Tests:DatabaseInitializationExtensionsTests, Tests:FixedAssemblyProvider |

## Manifest (by level, then assembly)

| Level | Type | Assembly | #Deps | First-party dependencies |
|-------|------|----------|-------|--------------------------|
| 0 | `ObservabilityConventionTests` | MMCA.ADC.Architecture.Tests | 0 | (none) |
| 0 | `AddCategoryItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddEventQuestionAnswerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddEventSpeakerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddRoomRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddSessionCategoryItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddSessionQuestionAnswerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddSessionSpeakerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddSpeakerCategoryItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `ConferenceErrorResources` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `UpdateCategoryItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `UpdateEventQuestionAnswerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `UpdateRoomRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `UpdateSessionQuestionAnswerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `CategoryItemSortRules<T>` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `EventDateRangeRules<T>` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ExportEventCalendarQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ExportSessionCalendarQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetCategoryDistributionQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetContentSimilarityQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicSessionFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionBookmarkCountQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionBookmarkCountsQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionFeedbackQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionSelectionDashboardQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSpeakersByEventFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSpeakerSessionOverlapQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `RoomCapacityRules<T>` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `RoomSortRules<T>` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ScoreEventSessionsCommand` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionEventIdRules<T>` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionizeCategoryItem` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionizeLink` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionizeQuestion` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionizeQuestionAnswer` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionizeRoom` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionizeSyncResult` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionScoringResult` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SessionSimilarityCalculator` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `SpeakerInfo` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `StatusBucket` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `StatusBucket` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestCategoryItemModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestCategoryModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestEventModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestQuestionModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestRoomModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestSessionModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestSpeakerModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Conference.Domain | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Conference.Domain | 0 | (none) |
| 0 | `SessionStatuses` | MMCA.ADC.Conference.Domain | 0 | (none) |
| 0 | `AiScoreResponse` | MMCA.ADC.Conference.Infrastructure | 0 | (none) |
| 0 | `AnthropicContentBlock` | MMCA.ADC.Conference.Infrastructure | 0 | (none) |
| 0 | `AnthropicMessage` | MMCA.ADC.Conference.Infrastructure | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Conference.Infrastructure | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Conference.Infrastructure | 0 | (none) |
| 0 | `FakeAnthropicHandler` | MMCA.ADC.Conference.Infrastructure.Tests | 0 | (none) |
| 0 | `KestrelConfiguration` | MMCA.ADC.Conference.Service | 0 | (none) |
| 0 | `CategoryItemDistribution` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `ConferenceFeatures` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `ConferencePermissions` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `EventLiveInfo` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `LinkUserRequest` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `NowNextSessionDTO` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `QuestionModerationDefault` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `RatingQuestionSummary` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `RefreshFromSessionizeResultDTO` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `ScoreEventSessionsResultDTO` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SessionAiScoreDTO` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SimilarSessionPair` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SpeakerLocalitySummary` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SpeakerSessionSummary` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `TextQuestionResponses` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `TestEvent` | MMCA.ADC.Conference.Shared.Tests | 0 | (none) |
| 0 | `ADCEventInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `CategoryItemInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `ConferenceRoutePaths` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `ConferenceTrackInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `EventInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `EventPhase` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `IPublicLinkBuilder` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `KeynoteSpeakerInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `ScorePollSignal` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `SessionSelectionDisplay` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `SpeakerInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `SponsorInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `RateLimiterNeutralizer` | MMCA.ADC.CrossService.IntegrationTests | 0 | (none) |
| 0 | `ConferenceCategoryCreatePage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `ConferenceCategoryDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `ConferenceCategoryListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `EventCreatePage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `EventDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `EventFeedbackPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `EventListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `HappeningNowPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `OrganizerEventFeedbackPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `OrganizerSessionFeedbackPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicEventDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicEventListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicSessionDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicSessionListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicSpeakerDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicSpeakerListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `QuestionCreatePage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `QuestionDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `QuestionListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `RoomCreatePage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `RoomDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `RoomListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SessionCreatePage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SessionDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SessionFeedbackPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SessionListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SpeakerCreatePage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SpeakerDashboardPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SpeakerDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SpeakerListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `UserListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Engagement.API | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Engagement.API | 0 | (none) |
| 0 | `EngagementErrorResources` | MMCA.ADC.Engagement.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `CastVoteCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `CloseLivePollCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetBookmarkedSessionIdsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetEventPollsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetModerationQueueQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetOpenPollsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetPollResultsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetSessionQuestionsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetUserBookmarksQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `LiveChannelPublishWorkItem` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `OpenLivePollCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `SubmitQuestionCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `ToggleUpvoteCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.ADC.Engagement.Application.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Engagement.Domain | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Engagement.Domain | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Engagement.Infrastructure | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Engagement.Infrastructure | 0 | (none) |
| 0 | `KestrelConfiguration` | MMCA.ADC.Engagement.Service | 0 | (none) |
| 0 | `CastVoteRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `CreateBookmarkRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `CreateLivePollRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `EngagementFeatures` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `EngagementPermissions` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `IBookmarkCountService` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `ISessionLiveUIService` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollChannel` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollClosedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollOpenedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollOptionDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollOptionResultDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollStatus` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `ModerationAction` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `QuestionStatus` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionAnsweredPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionApprovedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionChannel` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionDismissedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionPendingCountChangedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionUpvoteChangedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SubmitQuestionRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `UserEngagementBookmarkExportDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `UserEngagementSubmittedQuestionExportDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `AnswerState` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `EngagementRoutePaths` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `LiveEventContext` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `OptionState` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `OptionState` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `SessionInfo` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `SessionReminder` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `RecordingHttpForwarder` | MMCA.ADC.Gateway.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Identity.API | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Identity.API | 0 | (none) |
| 0 | `IdentityErrorResources` | MMCA.ADC.Identity.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `ChangePreferencesRequest` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `ExportUserDataQuery` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `GetUserAvatarQuery` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `GetUserPreferencesQuery` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `GetUsersQuery` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `IExternalLoginEmailVerifier` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `RemoveUserAvatarCommand` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `SetUserAvatarCommand` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `UserPreferencesResponse` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Identity.Domain | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Identity.Domain | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Identity.Infrastructure | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Identity.Infrastructure | 0 | (none) |
| 0 | `DependencyInjection` | MMCA.ADC.Identity.Infrastructure | 0 | (none) |
| 0 | `AuthResponse` | MMCA.ADC.Identity.IntegrationTests | 0 | (none) |
| 0 | `ExchangeResponse` | MMCA.ADC.Identity.IntegrationTests | 0 | (none) |
| 0 | `PiiLogCapture` | MMCA.ADC.Identity.IntegrationTests | 0 | (none) |
| 0 | `PreferencesResponse` | MMCA.ADC.Identity.IntegrationTests | 0 | (none) |
| 0 | `KestrelConfiguration` | MMCA.ADC.Identity.Service | 0 | (none) |
| 0 | `IAttendeeQueryService` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `IdentityPermissions` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `IdentitySettings` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserAvatarDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportBookmarkDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportNotificationDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportSubmittedQuestionDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserListDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `IdentityRoutePaths` | MMCA.ADC.Identity.UI | 0 | (none) |
| 0 | `KestrelConfiguration` | MMCA.ADC.Notification.Service | 0 | (none) |
| 0 | `UserNotificationExportItemDTO` | MMCA.ADC.Notification.Shared | 0 | (none) |
| 0 | `ServiceBusEmulatorFixture` | MMCA.ADC.ServiceBusEmulator.IntegrationTests | 0 | (none) |
| 0 | `NowNextSession` | MMCA.ADC.UI | 0 | (none) |
| 0 | `WebAuthenticatorCallbackActivity` | MMCA.ADC.UI | 0 | (none) |
| 0 | `AppAssociationOptions` | MMCA.Common.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.Common.API | 0 | (none) |
| 0 | `AuthorizationPolicies` | MMCA.Common.API | 0 | (none) |
| 0 | `ClassReference` | MMCA.Common.API | 0 | (none) |
| 0 | `DbUpdateExceptionHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `DisabledFeatureHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `ErrorResources` | MMCA.Common.API | 0 | (none) |
| 0 | `ErrorResourceSource` | MMCA.Common.API | 0 | (none) |
| 0 | `ExternalAuthExtensions` | MMCA.Common.API | 0 | (none) |
| 0 | `GlobalExceptionHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `IdempotencyRecord` | MMCA.Common.API | 0 | (none) |
| 0 | `IdempotencySettings` | MMCA.Common.API | 0 | (none) |
| 0 | `IErrorLocalizer` | MMCA.Common.API | 0 | (none) |
| 0 | `OpenApiEndpointExtensions` | MMCA.Common.API | 0 | (none) |
| 0 | `OperationCanceledExceptionHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `OwnerOrAdminFilterOptions` | MMCA.Common.API | 0 | (none) |
| 0 | `PermissionPolicy` | MMCA.Common.API | 0 | (none) |
| 0 | `PermissionRequirement` | MMCA.Common.API | 0 | (none) |
| 0 | `PublicEndpointOutputCachePolicy` | MMCA.Common.API | 0 | (none) |
| 0 | `QueryFilterModelBinder` | MMCA.Common.API | 0 | (none) |
| 0 | `ServiceInfoResponse` | MMCA.Common.API | 0 | (none) |
| 0 | `ServiceInfoV2Response` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionCookieRequest` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionTokenResponse` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionTokenResult` | MMCA.Common.API | 0 | (none) |
| 0 | `ValidationExceptionHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `FakeCategoriesController` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `NextDelegateSpy` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `SingleServiceProvider` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `StubHttpClientFactory` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `StubHttpMessageHandler` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.Common.Application | 0 | (none) |
| 0 | `ClassReference` | MMCA.Common.Application | 0 | (none) |
| 0 | `CqrsMetrics` | MMCA.Common.Application | 0 | (none) |
| 0 | `DataSource` | MMCA.Common.Application | 0 | (none) |
| 0 | `DeleteEntityCommand<TEntity, TIdentifierType>` | MMCA.Common.Application | 0 | (none) |
| 0 | `EmailRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `EntityQueryParameters<TEntity>` | MMCA.Common.Application | 0 | (none) |
| 0 | `FilterValueParser` | MMCA.Common.Application | 0 | (none) |
| 0 | `GetMyNotificationsQuery` | MMCA.Common.Application | 0 | (none) |
| 0 | `GetNotificationHistoryQuery` | MMCA.Common.Application | 0 | (none) |
| 0 | `GetUnreadNotificationCountQuery` | MMCA.Common.Application | 0 | (none) |
| 0 | `IApplicationSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICacheInvalidating` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICacheService` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICommandHandler<in TCommand, TResult>` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICommandWithRequest<out TRequest>` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICorrelationContext` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICreateRequest` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICurrentUserService` | MMCA.Common.Application | 0 | (none) |
| 0 | `IEmailSender` | MMCA.Common.Application | 0 | (none) |
| 0 | `IEntityConfigurationAssemblyProvider` | MMCA.Common.Application | 0 | (none) |
| 0 | `IFeatureGated` | MMCA.Common.Application | 0 | (none) |
| 0 | `IFilterStrategy` | MMCA.Common.Application | 0 | (none) |
| 0 | `ILiveChannelPublisher` | MMCA.Common.Application | 0 | (none) |
| 0 | `ImageContentSniffer` | MMCA.Common.Application | 0 | (none) |
| 0 | `IModuleSeeder` | MMCA.Common.Application | 0 | (none) |
| 0 | `INativePushSender` | MMCA.Common.Application | 0 | (none) |
| 0 | `INotificationRecipientProvider` | MMCA.Common.Application | 0 | (none) |
| 0 | `IPasswordHasher` | MMCA.Common.Application | 0 | (none) |
| 0 | `IPushNotificationSender` | MMCA.Common.Application | 0 | (none) |
| 0 | `IQueryableExecutor` | MMCA.Common.Application | 0 | (none) |
| 0 | `IQueryCacheable` | MMCA.Common.Application | 0 | (none) |
| 0 | `IQueryHandler<in TQuery, TResult>` | MMCA.Common.Application | 0 | (none) |
| 0 | `ISoftDeletedUserValidator` | MMCA.Common.Application | 0 | (none) |
| 0 | `ITokenService` | MMCA.Common.Application | 0 | (none) |
| 0 | `ITransactional` | MMCA.Common.Application | 0 | (none) |
| 0 | `MarkAllNotificationsReadCommand` | MMCA.Common.Application | 0 | (none) |
| 0 | `MarkNotificationReadCommand` | MMCA.Common.Application | 0 | (none) |
| 0 | `ModuleSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `NavigationType` | MMCA.Common.Application | 0 | (none) |
| 0 | `NonNegativeIntRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `OptionalStringRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `ParameterReplacer` | MMCA.Common.Application | 0 | (none) |
| 0 | `PasswordRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `PositiveDecimalRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `PositiveIntRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `PropertyAccessor` | MMCA.Common.Application | 0 | (none) |
| 0 | `QueryCacheKeyLocks` | MMCA.Common.Application | 0 | (none) |
| 0 | `RequiredStringRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `StrongPasswordRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `CapturedMeasurement` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `CqrsMetricsProbeCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `CqrsMetricsProbeQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `FakeModuleTracker` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `IFakeRemoteContract` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `Item` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `NonCacheableTestQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `NonTransactionalCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PipelineTestCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PlainCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PlainQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PlainTestCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `Product` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `ProductDto` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `ProfilingTestCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `ProfilingTestQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestAddressModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestDecimalModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestIntModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestLoggingCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestLoggingQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestOptionalStringModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestRequest` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestStringModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestValidatingCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `CspPolicy` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `GatewayCorsExtensions` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `IWarmupTask` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `OutboxPollFilterProcessor` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `SecurityHeadersSettings` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `WarmupReadinessGate` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `Extensions` | MMCA.Common.Aspire.Hosting | 0 | (none) |
| 0 | `StubWebHostEnvironment` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.Common.Domain | 0 | (none) |
| 0 | `ClassReference` | MMCA.Common.Domain | 0 | (none) |
| 0 | `DomainEntityState` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IAuditableEntity` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IAuthUser` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IBaseEntity<TIdentifierType>` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IDomainEvent` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IdValueGeneratedAttribute` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IRowVersioned` | MMCA.Common.Domain | 0 | (none) |
| 0 | `NavigationAttribute` | MMCA.Common.Domain | 0 | (none) |
| 0 | `PiiAttribute` | MMCA.Common.Domain | 0 | (none) |
| 0 | `PushNotificationStatus` | MMCA.Common.Domain | 0 | (none) |
| 0 | `RedactableProperty` | MMCA.Common.Domain | 0 | (none) |
| 0 | `DecoratedEntity` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `EntityWithNavigation` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `NoPii` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `Subject` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `UndecoratedEntity` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `JwtForwardingClientInterceptor` | MMCA.Common.Grpc | 0 | (none) |
| 0 | `CountingFailureHandler` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeClient` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeGrpcClient` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeRequest` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeResponse` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `CacheOptions` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ClaimBasedUserIdProvider` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ClassReference` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `CosmosIntIdValueGenerator` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `DataSourceEntrySettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `EncryptedStringConverter` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `EntityConfigurationOptions` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `FileStorageSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IConnectionStringSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IDbSeeder` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IdentityInsertGroup` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IInboxStore` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IJwksProvider` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `InboxMessage` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IOutboxSignal` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IPushNotificationSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ISmtpSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `JwksSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `JwtForwardingDelegatingHandler` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `JwtSigningAlgorithm` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `LoginProtectionSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `MessageBusProvider` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ModelBuilderExtensions` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `NamespaceConventions` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `NativePushPayloads` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `NativePushSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `OutboxCycleResult` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ProfilingHelper` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `UseDatabaseAttribute` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ValReturn<T>` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `DrillResult` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `FakeEntity` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `FakeTimeProvider` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `TestDuplexPipe` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `TestItem` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `UnregisteredEntity` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `AuthClaimTypes` | MMCA.Common.Shared | 0 | (none) |
| 0 | `AuthenticationRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `AuthenticationResponse` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ChangePasswordRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `CollectionResult<T>` | MMCA.Common.Shared | 0 | (none) |
| 0 | `DeviceInstallationRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `DomainException` | MMCA.Common.Shared | 0 | (none) |
| 0 | `DomainHelper` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ErrorType` | MMCA.Common.Shared | 0 | (none) |
| 0 | `HttpResilienceDefaults` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IBaseDTO<TIdentifierType>` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IConcurrencyAware` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IcsEvent` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IPermissionRegistry` | MMCA.Common.Shared | 0 | (none) |
| 0 | `LoginRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `NotificationFeatures` | MMCA.Common.Shared | 0 | (none) |
| 0 | `OAuthCodeExchangeRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `PaginationMetadata` | MMCA.Common.Shared | 0 | (none) |
| 0 | `PropertyReader` | MMCA.Common.Shared | 0 | (none) |
| 0 | `RefreshTokenRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `RoleNames` | MMCA.Common.Shared | 0 | (none) |
| 0 | `SendPushNotificationRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ServiceContractAttribute` | MMCA.Common.Shared | 0 | (none) |
| 0 | `SupportedCultures` | MMCA.Common.Shared | 0 | (none) |
| 0 | `UserNotificationDTO` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ValueObject` | MMCA.Common.Shared | 0 | (none) |
| 0 | `DomainHelperTests` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `TestDTO` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `EntityBuilderBase<TBuilder, TEntity>` | MMCA.Common.Testing | 0 | (none) |
| 0 | `FeatureManagementTestExtensions` | MMCA.Common.Testing | 0 | (none) |
| 0 | `IIntegrationTestFixture` | MMCA.Common.Testing | 0 | (none) |
| 0 | `JwtTokenGenerator` | MMCA.Common.Testing | 0 | (none) |
| 0 | `SecurityHeadersTestsBase` | MMCA.Common.Testing | 0 | (none) |
| 0 | `ArchitectureAssert` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `BrandColorTokenTestsBase` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `CrossEntityNavigationFinder` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `Layer` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `RouteAuthorizationTestsBase` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `RuleHelpers` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `AccessibilityViolationException` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `AdminCredentials` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `AxeOptions` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `E2ETestConfiguration` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `LoginPage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `ProfilePage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `RegisterPage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `UserCredentials` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `WebVitalsSample` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `FakeHandler` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `PingCommand` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `PingQuery` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `BunitInteractionExtensions` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `CapturedRequest` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `FreshApiClientFactory` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `IsAuthenticatedAuthorizationService` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `MarkupSnapshotResult` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `MudProviderHandles` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `MutableAuthenticationStateProvider` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `Route` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `TestPrincipal` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `BackNavigationResult` | MMCA.Common.UI | 0 | (none) |
| 0 | `BrandColors` | MMCA.Common.UI | 0 | (none) |
| 0 | `BreakpointConstants` | MMCA.Common.UI | 0 | (none) |
| 0 | `CapabilitiesJsModule` | MMCA.Common.UI | 0 | (none) |
| 0 | `CultureDelegatingHandler` | MMCA.Common.UI | 0 | (none) |
| 0 | `DevicePreferenceKeys` | MMCA.Common.UI | 0 | (none) |
| 0 | `GeoPoint` | MMCA.Common.UI | 0 | (none) |
| 0 | `IAccessibilityAnnouncer` | MMCA.Common.UI | 0 | (none) |
| 0 | `IApiSettings` | MMCA.Common.UI | 0 | (none) |
| 0 | `IBatteryStatusService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IBiometricAuthenticator` | MMCA.Common.UI | 0 | (none) |
| 0 | `IClipboardService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IConnectivityStatusService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IDevicePreferences` | MMCA.Common.UI | 0 | (none) |
| 0 | `IExternalAuthBroker` | MMCA.Common.UI | 0 | (none) |
| 0 | `IExternalLinkService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IFormFactor` | MMCA.Common.UI | 0 | (none) |
| 0 | `IHapticFeedbackService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IHomePageContent` | MMCA.Common.UI | 0 | (none) |
| 0 | `ILocalCacheStore` | MMCA.Common.UI | 0 | (none) |
| 0 | `IMapNavigationService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IOAuthUISettings` | MMCA.Common.UI | 0 | (none) |
| 0 | `IPushRegistrationService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IScreenshotService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ISessionCookieSync` | MMCA.Common.UI | 0 | (none) |
| 0 | `IShareService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ISpeechToTextService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ITextToSpeechService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ITokenRefresher` | MMCA.Common.UI | 0 | (none) |
| 0 | `ITokenStorageService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IUserPreferenceWriter` | MMCA.Common.UI | 0 | (none) |
| 0 | `JwtTokenInfo` | MMCA.Common.UI | 0 | (none) |
| 0 | `LayoutSettings` | MMCA.Common.UI | 0 | (none) |
| 0 | `ListPageState` | MMCA.Common.UI | 0 | (none) |
| 0 | `LocalNotificationRequest` | MMCA.Common.UI | 0 | (none) |
| 0 | `LoginModel` | MMCA.Common.UI | 0 | (none) |
| 0 | `MudTranslations` | MMCA.Common.UI | 0 | (none) |
| 0 | `NavSection` | MMCA.Common.UI | 0 | (none) |
| 0 | `NotificationRoutePaths` | MMCA.Common.UI | 0 | (none) |
| 0 | `NotificationState` | MMCA.Common.UI | 0 | (none) |
| 0 | `PasswordComplexityAttribute` | MMCA.Common.UI | 0 | (none) |
| 0 | `PersistedGridState` | MMCA.Common.UI | 0 | (none) |
| 0 | `PickedMedia` | MMCA.Common.UI | 0 | (none) |
| 0 | `PseudoLocalizer` | MMCA.Common.UI | 0 | (none) |
| 0 | `PushDeviceToken` | MMCA.Common.UI | 0 | (none) |
| 0 | `RegisterModel` | MMCA.Common.UI | 0 | (none) |
| 0 | `ReturnUrlProtector` | MMCA.Common.UI | 0 | (none) |
| 0 | `RoutePaths` | MMCA.Common.UI | 0 | (none) |
| 0 | `SharedResource` | MMCA.Common.UI | 0 | (none) |
| 0 | `ThemeService` | MMCA.Common.UI | 0 | (none) |
| 0 | `UIModuleConfiguration` | MMCA.Common.UI | 0 | (none) |
| 0 | `UISharedAssemblyReference` | MMCA.Common.UI | 0 | (none) |
| 0 | `UserPreferences` | MMCA.Common.UI | 0 | (none) |
| 0 | `UserPreferencesRequest` | MMCA.Common.UI | 0 | (none) |
| 0 | `WebApplicationExtensions` | MMCA.Common.UI | 0 | (none) |
| 0 | `GalleryFakeAuthenticationHandler` | MMCA.Common.UI.Gallery | 0 | (none) |
| 0 | `CapturedRequest` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `FakeStringLocalizer` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `RecordingNavigationManager` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `ResxMudLocalizerTests` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `StubHttpClientFactory` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `WidgetRow` | MMCA.Common.UI.Tests | 0 | (none) |
| 1 | `BrandColorTokenTests` | MMCA.ADC.Architecture.Tests | 1 | BrandColorTokenTestsBase |
| 1 | `ConferenceErrorResourcesTests` | MMCA.ADC.Conference.API.Tests | 2 | ConferenceErrorResources, IErrorLocalizer |
| 1 | `ConferencePermissionGrantsTests` | MMCA.ADC.Conference.API.Tests | 3 | ConferencePermissions, IPermissionRegistry, RoleNames |
| 1 | `ConferenceCategoryUpdateRequest` | MMCA.ADC.Conference.Application | 1 | IConcurrencyAware |
| 1 | `EventUpdateRequest` | MMCA.ADC.Conference.Application | 2 | IConcurrencyAware, QuestionModerationDefault |
| 1 | `QuestionUpdateRequest` | MMCA.ADC.Conference.Application | 1 | IConcurrencyAware |
| 1 | `SessionizeCategory` | MMCA.ADC.Conference.Application | 1 | SessionizeCategoryItem |
| 1 | `SessionizeSession` | MMCA.ADC.Conference.Application | 1 | SessionizeQuestionAnswer |
| 1 | `SessionizeSpeaker` | MMCA.ADC.Conference.Application | 2 | SessionizeLink, SessionizeQuestionAnswer |
| 1 | `SessionScoringInput` | MMCA.ADC.Conference.Application | 1 | SpeakerInfo |
| 1 | `SessionUpdateRequest` | MMCA.ADC.Conference.Application | 1 | IConcurrencyAware |
| 1 | `SpeakerUpdateRequest` | MMCA.ADC.Conference.Application | 1 | IConcurrencyAware |
| 1 | `SessionSimilarityCalculatorTests` | MMCA.ADC.Conference.Application.Tests | 1 | SessionSimilarityCalculator |
| 1 | `AnthropicRequest` | MMCA.ADC.Conference.Infrastructure | 1 | AnthropicMessage |
| 1 | `AnthropicResponse` | MMCA.ADC.Conference.Infrastructure | 1 | AnthropicContentBlock |
| 1 | `FakeBookmarkCountService` | MMCA.ADC.Conference.IntegrationTests | 1 | IBookmarkCountService |
| 1 | `SelfHttpOutputCacheWarmupTask` | MMCA.ADC.Conference.Service | 1 | IWarmupTask |
| 1 | `CategoryGroupDistribution` | MMCA.ADC.Conference.Shared | 1 | CategoryItemDistribution |
| 1 | `CategoryItemDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ContentSimilarityDTO` | MMCA.ADC.Conference.Shared | 1 | SimilarSessionPair |
| 1 | `EventQuestionAnswerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `EventSpeakerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `MultiSessionSpeaker` | MMCA.ADC.Conference.Shared | 1 | SpeakerSessionSummary |
| 1 | `NowNextDTO` | MMCA.ADC.Conference.Shared | 1 | NowNextSessionDTO |
| 1 | `QuestionDTO` | MMCA.ADC.Conference.Shared | 2 | IBaseDTO<TIdentifierType>, IConcurrencyAware |
| 1 | `RoomDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SessionCategoryItemDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SessionFeedbackDTO` | MMCA.ADC.Conference.Shared | 2 | RatingQuestionSummary, TextQuestionResponses |
| 1 | `SessionLiveInfo` | MMCA.ADC.Conference.Shared | 1 | QuestionModerationDefault |
| 1 | `SessionQuestionAnswerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SessionSpeakerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SpeakerCategoryItemDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SpeakerQuestionAnswerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ADCCollectionResult` | MMCA.ADC.Conference.UI | 1 | ADCEventInfo |
| 1 | `ICategoryItemLookupService` | MMCA.ADC.Conference.UI | 1 | CategoryItemInfo |
| 1 | `IEventLookupService` | MMCA.ADC.Conference.UI | 1 | EventInfo |
| 1 | `ISpeakerLookupService` | MMCA.ADC.Conference.UI | 1 | SpeakerInfo |
| 1 | `NavigationPublicLinkBuilder` | MMCA.ADC.Conference.UI | 1 | IPublicLinkBuilder |
| 1 | `ScorePollTracker` | MMCA.ADC.Conference.UI | 1 | ScorePollSignal |
| 1 | `SponsorTierInfo` | MMCA.ADC.Conference.UI | 1 | SponsorInfo |
| 1 | `InProcessJwtBearer` | MMCA.ADC.CrossService.IntegrationTests | 1 | JwtTokenGenerator |
| 1 | `TestSetup` | MMCA.ADC.E2E.Tests | 1 | E2ETestConfiguration |
| 1 | `EngagementErrorResourcesTests` | MMCA.ADC.Engagement.API.Tests | 2 | EngagementErrorResources, IErrorLocalizer |
| 1 | `EngagementPermissionGrantsTests` | MMCA.ADC.Engagement.API.Tests | 3 | EngagementPermissions, IPermissionRegistry, RoleNames |
| 1 | `CastVoteCommandValidator` | MMCA.ADC.Engagement.Application | 1 | CastVoteCommand |
| 1 | `CreateBookmarkRequestValidator` | MMCA.ADC.Engagement.Application | 1 | CreateBookmarkRequest |
| 1 | `CreateLivePollCommand` | MMCA.ADC.Engagement.Application | 1 | CreateLivePollRequest |
| 1 | `ILiveChannelPublishQueue` | MMCA.ADC.Engagement.Application | 1 | LiveChannelPublishWorkItem |
| 1 | `ModerateQuestionCommand` | MMCA.ADC.Engagement.Application | 1 | ModerationAction |
| 1 | `ToggleUpvoteCommandValidator` | MMCA.ADC.Engagement.Application | 1 | ToggleUpvoteCommand |
| 1 | `InMemoryQueryableExecutor` | MMCA.ADC.Engagement.Application.Tests | 1 | IQueryableExecutor |
| 1 | `RecordingPublisher` | MMCA.ADC.Engagement.Infrastructure.Tests | 2 | ILiveChannelPublisher, LiveChannelPublishWorkItem |
| 1 | `DisabledBookmarkCountService` | MMCA.ADC.Engagement.Shared | 1 | IBookmarkCountService |
| 1 | `LivePollDTO` | MMCA.ADC.Engagement.Shared | 3 | IBaseDTO<TIdentifierType>, LivePollOptionDTO, LivePollStatus |
| 1 | `LivePollResultsDTO` | MMCA.ADC.Engagement.Shared | 2 | LivePollOptionResultDTO, LivePollStatus |
| 1 | `SessionQuestionDTO` | MMCA.ADC.Engagement.Shared | 2 | IBaseDTO<TIdentifierType>, QuestionStatus |
| 1 | `UserEngagementExportDTO` | MMCA.ADC.Engagement.Shared | 2 | UserEngagementBookmarkExportDTO, UserEngagementSubmittedQuestionExportDTO |
| 1 | `UserSessionBookmarkDTO` | MMCA.ADC.Engagement.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ILiveEventUIService` | MMCA.ADC.Engagement.UI | 1 | LiveEventContext |
| 1 | `ISessionLookupService` | MMCA.ADC.Engagement.UI | 1 | SessionInfo |
| 1 | `SessionLiveUIService` | MMCA.ADC.Engagement.UI | 2 | EngagementRoutePaths, ISessionLiveUIService |
| 1 | `SessionReminderPlanner` | MMCA.ADC.Engagement.UI | 3 | EngagementRoutePaths, SessionInfo, SessionReminder |
| 1 | `HttpContextExternalLoginEmailVerifier` | MMCA.ADC.Identity.API | 2 | ExternalAuthExtensions, IExternalLoginEmailVerifier |
| 1 | `IdentityErrorResourcesTests` | MMCA.ADC.Identity.API.Tests | 2 | IdentityErrorResources, IErrorLocalizer |
| 1 | `ChangePasswordRequestValidator` | MMCA.ADC.Identity.Application | 2 | ChangePasswordRequest, StrongPasswordRules<T> |
| 1 | `PiiCaptureLogger` | MMCA.ADC.Identity.IntegrationTests | 1 | PiiLogCapture |
| 1 | `DisabledAttendeeQueryService` | MMCA.ADC.Identity.Shared | 1 | IAttendeeQueryService |
| 1 | `UserDataExportEngagementSectionDTO` | MMCA.ADC.Identity.Shared | 2 | UserDataExportBookmarkDTO, UserDataExportSubmittedQuestionDTO |
| 1 | `UserDataExportNotificationSectionDTO` | MMCA.ADC.Identity.Shared | 1 | UserDataExportNotificationDTO |
| 1 | `UserDTO` | MMCA.ADC.Identity.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `IUserUIService` | MMCA.ADC.Identity.UI | 1 | UserListDTO |
| 1 | `AttendeeNotificationRecipientProvider` | MMCA.ADC.Notification.Application | 2 | IAttendeeQueryService, INotificationRecipientProvider |
| 1 | `InMemoryQueryableExecutor` | MMCA.ADC.Notification.Application.Tests | 1 | IQueryableExecutor |
| 1 | `LiveChannelPublisherGrpcAdapter` | MMCA.ADC.Notification.Contracts | 1 | ILiveChannelPublisher |
| 1 | `FakeAttendeeQueryService` | MMCA.ADC.Notification.IntegrationTests | 1 | IAttendeeQueryService |
| 1 | `LiveChannelGrpcService` | MMCA.ADC.Notification.Service | 1 | ILiveChannelPublisher |
| 1 | `IUserNotificationExportService` | MMCA.ADC.Notification.Shared | 1 | UserNotificationExportItemDTO |
| 1 | `ServiceBusEmulatorCollection` | MMCA.ADC.ServiceBusEmulator.IntegrationTests | 1 | ServiceBusEmulatorFixture |
| 1 | `AppActionsInitializer` | MMCA.ADC.UI | 2 | EngagementRoutePaths, NotificationRoutePaths |
| 1 | `MauiPublicLinkBuilder` | MMCA.ADC.UI | 1 | IPublicLinkBuilder |
| 1 | `MauiTokenStorageService` | MMCA.ADC.UI | 1 | ITokenStorageService |
| 1 | `NowNextSnapshot` | MMCA.ADC.UI | 1 | NowNextSession |
| 1 | `ADCHomePageContent` | MMCA.ADC.UI.Web.Client | 1 | IHomePageContent |
| 1 | `AppAssociationEndpointExtensions` | MMCA.Common.API | 1 | AppAssociationOptions |
| 1 | `CorrelationIdMiddleware` | MMCA.Common.API | 1 | ICorrelationContext |
| 1 | `DomainExceptionHandler` | MMCA.Common.API | 1 | DomainException |
| 1 | `ErrorLocalizer` | MMCA.Common.API | 2 | ErrorResourceSource, IErrorLocalizer |
| 1 | `HasPermissionAttribute` | MMCA.Common.API | 1 | PermissionPolicy |
| 1 | `ICookieSessionRefresher` | MMCA.Common.API | 1 | SessionTokenResult |
| 1 | `IdempotencyFilter` | MMCA.Common.API | 3 | ICacheService, IdempotencyRecord, IdempotencySettings |
| 1 | `JwksEndpointExtensions` | MMCA.Common.API | 1 | IJwksProvider |
| 1 | `OutputCacheOptionsExtensions` | MMCA.Common.API | 1 | PublicEndpointOutputCachePolicy |
| 1 | `OwnershipHelper` | MMCA.Common.API | 1 | ICurrentUserService |
| 1 | `PermissionAuthorizationHandler` | MMCA.Common.API | 3 | AuthClaimTypes, IPermissionRegistry, PermissionRequirement |
| 1 | `PermissionPolicyProvider` | MMCA.Common.API | 2 | PermissionPolicy, PermissionRequirement |
| 1 | `ServiceInfoControllerBase` | MMCA.Common.API | 2 | ServiceInfoResponse, ServiceInfoV2Response |
| 1 | `SoftDeletedUserMiddleware` | MMCA.Common.API | 3 | ICacheService, ICurrentUserService, ISoftDeletedUserValidator |
| 1 | `AuthorizationExtensionsTests` | MMCA.Common.API.Tests | 2 | AuthorizationPolicies, RoleNames |
| 1 | `DisabledFeatureHandlerTests` | MMCA.Common.API.Tests | 1 | DisabledFeatureHandler |
| 1 | `ErrorLocalizerTests` | MMCA.Common.API.Tests | 1 | IErrorLocalizer |
| 1 | `ExternalAuthExtensionsTests` | MMCA.Common.API.Tests | 1 | ExternalAuthExtensions |
| 1 | `IdempotencySettingsTests` | MMCA.Common.API.Tests | 1 | IdempotencySettings |
| 1 | `PublicEndpointOutputCachePolicyTests` | MMCA.Common.API.Tests | 1 | PublicEndpointOutputCachePolicy |
| 1 | `QueryFilterModelBinderTests` | MMCA.Common.API.Tests | 1 | QueryFilterModelBinder |
| 1 | `StubErrorLocalizer` | MMCA.Common.API.Tests | 1 | IErrorLocalizer |
| 1 | `TestAggDTO` | MMCA.Common.API.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `TestCreateRequest` | MMCA.Common.API.Tests | 1 | ICreateRequest |
| 1 | `TestDomainException` | MMCA.Common.API.Tests | 1 | DomainException |
| 1 | `TestDTO` | MMCA.Common.API.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ApplicationSettings` | MMCA.Common.Application | 1 | IApplicationSettings |
| 1 | `BoolFilterStrategy` | MMCA.Common.Application | 1 | IFilterStrategy |
| 1 | `CommandRequestValidator<TCommand, TRequest>` | MMCA.Common.Application | 1 | ICommandWithRequest<out TRequest> |
| 1 | `DataSourceKey` | MMCA.Common.Application | 1 | DataSource |
| 1 | `DateTimeFilterStrategy` | MMCA.Common.Application | 2 | FilterValueParser, IFilterStrategy |
| 1 | `DecimalFilterStrategy` | MMCA.Common.Application | 2 | FilterValueParser, IFilterStrategy |
| 1 | `GuidFilterStrategy` | MMCA.Common.Application | 2 | FilterValueParser, IFilterStrategy |
| 1 | `IDomainEventDispatcher` | MMCA.Common.Application | 1 | IDomainEvent |
| 1 | `IDomainEventHandler<in TDomainEvent>` | MMCA.Common.Application | 1 | IDomainEvent |
| 1 | `IntFilterStrategy` | MMCA.Common.Application | 2 | FilterValueParser, IFilterStrategy |
| 1 | `LoginRequestValidator` | MMCA.Common.Application | 1 | LoginRequest |
| 1 | `LongFilterStrategy` | MMCA.Common.Application | 2 | FilterValueParser, IFilterStrategy |
| 1 | `ModulesSettings` | MMCA.Common.Application | 1 | ModuleSettings |
| 1 | `NavigationPropertyInfo` | MMCA.Common.Application | 1 | NavigationType |
| 1 | `NullNotificationRecipientProvider` | MMCA.Common.Application | 1 | INotificationRecipientProvider |
| 1 | `ProfilingCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 1 | ICommandHandler<in TCommand, TResult> |
| 1 | `ProfilingQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 1 | IQueryHandler<in TQuery, TResult> |
| 1 | `RefreshTokenRequestValidator` | MMCA.Common.Application | 1 | RefreshTokenRequest |
| 1 | `SendPushNotificationCommand` | MMCA.Common.Application | 2 | ICommandWithRequest<out TRequest>, SendPushNotificationRequest |
| 1 | `StringFilterStrategy` | MMCA.Common.Application | 2 | FilterValueParser, IFilterStrategy |
| 1 | `CacheableTestQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `CacheInvalidatingTestCommand` | MMCA.Common.Application.Tests | 1 | ICacheInvalidating |
| 1 | `CachePipelineTestCommand` | MMCA.Common.Application.Tests | 1 | ICacheInvalidating |
| 1 | `CommonValidationRulesTests` | MMCA.Common.Application.Tests | 12 | EmailRules<T>, NonNegativeIntRules<T>, OptionalStringRules<T>, PasswordRules<T>, PositiveDecimalRules<T>, PositiveIntRules<T>, RequiredStringRules<T>, StrongPasswordRules<T>, TestDecimalModel, TestIntModel, TestOptionalStringModel, TestStringModel |
| 1 | `FakeEntityDTO` | MMCA.Common.Application.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `FakeModuleAlphaSeeder` | MMCA.Common.Application.Tests | 2 | FakeModuleTracker, IModuleSeeder |
| 1 | `FakeRemoteContractRealAdapter` | MMCA.Common.Application.Tests | 1 | IFakeRemoteContract |
| 1 | `FakeRemoteContractStub` | MMCA.Common.Application.Tests | 1 | IFakeRemoteContract |
| 1 | `FeatureGatedCommand` | MMCA.Common.Application.Tests | 1 | IFeatureGated |
| 1 | `FeatureGatedCommandWithValue` | MMCA.Common.Application.Tests | 1 | IFeatureGated |
| 1 | `FeatureGatedQuery` | MMCA.Common.Application.Tests | 1 | IFeatureGated |
| 1 | `FeatureGatedQueryNonGeneric` | MMCA.Common.Application.Tests | 1 | IFeatureGated |
| 1 | `FullPipelineTestCommand` | MMCA.Common.Application.Tests | 2 | ICacheInvalidating, ITransactional |
| 1 | `ImageContentSnifferTests` | MMCA.Common.Application.Tests | 1 | ImageContentSniffer |
| 1 | `PermissiveTestRequestValidator` | MMCA.Common.Application.Tests | 1 | TestRequest |
| 1 | `StampedeTestQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `TestCommandWithRequest` | MMCA.Common.Application.Tests | 2 | ICommandWithRequest<out TRequest>, TestRequest |
| 1 | `TestRequestValidator` | MMCA.Common.Application.Tests | 1 | TestRequest |
| 1 | `TestStrategy` | MMCA.Common.Application.Tests | 1 | IFilterStrategy |
| 1 | `TransactionalCommand` | MMCA.Common.Application.Tests | 1 | ITransactional |
| 1 | `TransactionalPipelineTestCommand` | MMCA.Common.Application.Tests | 1 | ITransactional |
| 1 | `ValidationFailureExtensionsTests` | MMCA.Common.Application.Tests | 1 | ErrorType |
| 1 | `NavigationContractTests` | MMCA.Common.Architecture.Tests | 1 | UISharedAssemblyReference |
| 1 | `ICspPolicyProvider` | MMCA.Common.Aspire | 1 | CspPolicy |
| 1 | `OpenIdConnectMetadataWarmupTask` | MMCA.Common.Aspire | 1 | IWarmupTask |
| 1 | `WarmupHostedService` | MMCA.Common.Aspire | 2 | IWarmupTask, WarmupReadinessGate |
| 1 | `WarmupReadinessHealthCheck` | MMCA.Common.Aspire | 1 | WarmupReadinessGate |
| 1 | `OutboxPollFilterProcessorTests` | MMCA.Common.Aspire.Tests | 1 | OutboxPollFilterProcessor |
| 1 | `RecordingTask` | MMCA.Common.Aspire.Tests | 1 | IWarmupTask |
| 1 | `ThrowingTask` | MMCA.Common.Aspire.Tests | 1 | IWarmupTask |
| 1 | `WarmupReadinessGateTests` | MMCA.Common.Aspire.Tests | 1 | WarmupReadinessGate |
| 1 | `BaseDomainEvent` | MMCA.Common.Domain | 1 | IDomainEvent |
| 1 | `BaseEntity<TIdentifierType>` | MMCA.Common.Domain | 1 | IBaseEntity<TIdentifierType> |
| 1 | `EntityTypeExtensions` | MMCA.Common.Domain | 1 | IdValueGeneratedAttribute |
| 1 | `IAggregateRoot` | MMCA.Common.Domain | 1 | IDomainEvent |
| 1 | `IIntegrationEvent` | MMCA.Common.Domain | 1 | IDomainEvent |
| 1 | `ISpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 1 | IBaseEntity<TIdentifierType> |
| 1 | `PiiRedactor` | MMCA.Common.Domain | 2 | PiiAttribute, RedactableProperty |
| 1 | `IdValueGeneratedAttributeTests` | MMCA.Common.Domain.Tests | 3 | DecoratedEntity, IdValueGeneratedAttribute, UndecoratedEntity |
| 1 | `NavigationAttributeTests` | MMCA.Common.Domain.Tests | 2 | EntityWithNavigation, NavigationAttribute |
| 1 | `FakeStreamReader` | MMCA.Common.Grpc.Tests | 1 | FakeResponse |
| 1 | `FakeStreamWriter` | MMCA.Common.Grpc.Tests | 1 | FakeRequest |
| 1 | `ResilienceCircuitBreakerFaultInjectionTests` | MMCA.Common.Grpc.Tests | 1 | CountingFailureHandler |
| 1 | `ResilienceHandlerTests` | MMCA.Common.Grpc.Tests | 1 | FakeGrpcClient |
| 1 | `AzureNotificationHubNativePushSender` | MMCA.Common.Infrastructure | 2 | INativePushSender, NativePushPayloads |
| 1 | `ConnectionStringSettings` | MMCA.Common.Infrastructure | 1 | IConnectionStringSettings |
| 1 | `CorrelationContext` | MMCA.Common.Infrastructure | 1 | ICorrelationContext |
| 1 | `DataSourcesSettings` | MMCA.Common.Infrastructure | 1 | DataSourceEntrySettings |
| 1 | `DbSeeder` | MMCA.Common.Infrastructure | 1 | IDbSeeder |
| 1 | `DefaultEntityConfigurationAssemblyProvider` | MMCA.Common.Infrastructure | 2 | EntityConfigurationOptions, IEntityConfigurationAssemblyProvider |
| 1 | `DistributedCacheService` | MMCA.Common.Infrastructure | 2 | CacheOptions, ICacheService |
| 1 | `EFQueryableExecutor` | MMCA.Common.Infrastructure | 1 | IQueryableExecutor |
| 1 | `ExplicitAssemblyProvider` | MMCA.Common.Infrastructure | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `IJwtSettings` | MMCA.Common.Infrastructure | 1 | JwtSigningAlgorithm |
| 1 | `MemoryCacheService` | MMCA.Common.Infrastructure | 1 | ICacheService |
| 1 | `MessageBusSettings` | MMCA.Common.Infrastructure | 1 | MessageBusProvider |
| 1 | `NoOpInboxStore` | MMCA.Common.Infrastructure | 1 | IInboxStore |
| 1 | `NullLiveChannelPublisher` | MMCA.Common.Infrastructure | 1 | ILiveChannelPublisher |
| 1 | `NullNativePushSender` | MMCA.Common.Infrastructure | 1 | INativePushSender |
| 1 | `NullPushNotificationSender` | MMCA.Common.Infrastructure | 1 | IPushNotificationSender |
| 1 | `OutboxMessage` | MMCA.Common.Infrastructure | 1 | IDomainEvent |
| 1 | `OutboxSignal` | MMCA.Common.Infrastructure | 1 | IOutboxSignal |
| 1 | `PasswordHasher` | MMCA.Common.Infrastructure | 1 | IPasswordHasher |
| 1 | `PushNotificationSettings` | MMCA.Common.Infrastructure | 1 | IPushNotificationSettings |
| 1 | `RsaJwksProvider` | MMCA.Common.Infrastructure | 2 | IJwksProvider, JwksSettings |
| 1 | `SmtpEmailSender` | MMCA.Common.Infrastructure | 2 | IEmailSender, ISmtpSettings |
| 1 | `SmtpSettings` | MMCA.Common.Infrastructure | 1 | ISmtpSettings |
| 1 | `SoftDeleteUniqueIndexConvention` | MMCA.Common.Infrastructure | 2 | DataSource, IAuditableEntity |
| 1 | `UseDataSourceAttribute` | MMCA.Common.Infrastructure | 1 | DataSource |
| 1 | `CacheOptionsTests` | MMCA.Common.Infrastructure.Tests | 1 | CacheOptions |
| 1 | `CosmosIntIdValueGeneratorTests` | MMCA.Common.Infrastructure.Tests | 1 | CosmosIntIdValueGenerator |
| 1 | `DatabaseRestoreDrillTests` | MMCA.Common.Infrastructure.Tests | 1 | DrillResult |
| 1 | `EmptyAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `EncryptedStringConverterTests` | MMCA.Common.Infrastructure.Tests | 1 | EncryptedStringConverter |
| 1 | `EntityConfigurationOptionsTests` | MMCA.Common.Infrastructure.Tests | 1 | EntityConfigurationOptions |
| 1 | `FakeCacheService` | MMCA.Common.Infrastructure.Tests | 1 | ICacheService |
| 1 | `MultiSourceTestEvent` | MMCA.Common.Infrastructure.Tests | 1 | IDomainEvent |
| 1 | `NativePushPayloadsTests` | MMCA.Common.Infrastructure.Tests | 1 | NativePushPayloads |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `ProfilingHelperTests` | MMCA.Common.Infrastructure.Tests | 1 | ProfilingHelper |
| 1 | `BaseLookup<TIdentifierType>` | MMCA.Common.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `DomainInvariantViolationException` | MMCA.Common.Shared | 1 | DomainException |
| 1 | `Error` | MMCA.Common.Shared | 1 | ErrorType |
| 1 | `IcsCalendarBuilder` | MMCA.Common.Shared | 1 | IcsEvent |
| 1 | `PagedCollectionResult<T>` | MMCA.Common.Shared | 2 | CollectionResult<T>, PaginationMetadata |
| 1 | `PermissionRegistry` | MMCA.Common.Shared | 1 | IPermissionRegistry |
| 1 | `PushNotificationDTO` | MMCA.Common.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ConcreteDomainException` | MMCA.Common.Shared.Tests | 1 | DomainException |
| 1 | `PaginationMetadataTests` | MMCA.Common.Shared.Tests | 1 | PaginationMetadata |
| 1 | `TestValueObject` | MMCA.Common.Shared.Tests | 1 | ValueObject |
| 1 | `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>` | MMCA.Common.Testing | 2 | ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult> |
| 1 | `IntegrationTestBase<TFixture>` | MMCA.Common.Testing | 1 | IIntegrationTestFixture |
| 1 | `SqlServerIntegrationTestFixtureBase<TEntryPoint>` | MMCA.Common.Testing | 1 | IIntegrationTestFixture |
| 1 | `LayerRef` | MMCA.Common.Testing.Architecture | 1 | Layer |
| 1 | `PageExtensions` | MMCA.Common.Testing.E2E | 1 | AccessibilityViolationException |
| 1 | `PlaywrightFixture` | MMCA.Common.Testing.E2E | 1 | E2ETestConfiguration |
| 1 | `WebVitalsArtifact` | MMCA.Common.Testing.E2E | 1 | WebVitalsSample |
| 1 | `BunitComponentTestBase` | MMCA.Common.Testing.UI | 3 | IsAuthenticatedAuthorizationService, MudProviderHandles, MutableAuthenticationStateProvider |
| 1 | `CapturingHttpMessageHandler` | MMCA.Common.Testing.UI | 2 | CapturedRequest, Route |
| 1 | `MarkupSnapshot` | MMCA.Common.Testing.UI | 1 | MarkupSnapshotResult |
| 1 | `StubTokenStorageService` | MMCA.Common.Testing.UI | 1 | ITokenStorageService |
| 1 | `AlwaysOnlineConnectivityStatusService` | MMCA.Common.UI | 1 | IConnectivityStatusService |
| 1 | `ApiSettings` | MMCA.Common.UI | 1 | IApiSettings |
| 1 | `ApiUserPreferenceWriter` | MMCA.Common.UI | 3 | ITokenStorageService, IUserPreferenceWriter, UserPreferencesRequest |
| 1 | `AuthDelegatingHandler` | MMCA.Common.UI | 1 | ITokenStorageService |
| 1 | `AuthenticatedServiceBase` | MMCA.Common.UI | 1 | ITokenStorageService |
| 1 | `BrowserAccessibilityAnnouncer` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IAccessibilityAnnouncer |
| 1 | `BrowserClipboardService` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IClipboardService |
| 1 | `BrowserConnectivityStatusService` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IConnectivityStatusService |
| 1 | `BrowserDevicePreferences` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IDevicePreferences |
| 1 | `BrowserExternalLinkService` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IExternalLinkService |
| 1 | `BrowserLocalCacheStore` | MMCA.Common.UI | 2 | CapabilitiesJsModule, ILocalCacheStore |
| 1 | `BrowserMapNavigationService` | MMCA.Common.UI | 2 | IExternalLinkService, IMapNavigationService |
| 1 | `BrowserShareService` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IShareService |
| 1 | `ConfigurationOAuthUISettings` | MMCA.Common.UI | 1 | IOAuthUISettings |
| 1 | `DeepLinkRouteEventArgs` | MMCA.Common.UI | 1 | Route |
| 1 | `DefaultOAuthUISettings` | MMCA.Common.UI | 1 | IOAuthUISettings |
| 1 | `DirectApiTokenRefresher` | MMCA.Common.UI | 4 | AuthenticationResponse, ITokenRefresher, ITokenStorageService, RefreshTokenRequest |
| 1 | `IGeocodingService` | MMCA.Common.UI | 1 | GeoPoint |
| 1 | `IGeolocationService` | MMCA.Common.UI | 1 | GeoPoint |
| 1 | `ILocalNotificationService` | MMCA.Common.UI | 1 | LocalNotificationRequest |
| 1 | `IMediaPickerService` | MMCA.Common.UI | 1 | PickedMedia |
| 1 | `InMemoryDevicePreferences` | MMCA.Common.UI | 1 | IDevicePreferences |
| 1 | `IPushDeviceTokenProvider` | MMCA.Common.UI | 1 | PushDeviceToken |
| 1 | `IUserPreferenceReader` | MMCA.Common.UI | 1 | UserPreferences |
| 1 | `JsFetchSessionCookieSync` | MMCA.Common.UI | 1 | ISessionCookieSync |
| 1 | `JwtAuthenticationStateProvider` | MMCA.Common.UI | 1 | ITokenStorageService |
| 1 | `ListPageQueryStateService` | MMCA.Common.UI | 1 | ListPageState |
| 1 | `ListPageStateService` | MMCA.Common.UI | 1 | ListPageState |
| 1 | `MauiBackNavigationBridge` | MMCA.Common.UI | 1 | BackNavigationResult |
| 1 | `MmcaCultureBootstrap` | MMCA.Common.UI | 1 | SupportedCultures |
| 1 | `MobileInfiniteScrollList<TItem>` | MMCA.Common.UI | 1 | SharedResource |
| 1 | `NavigationHistoryService` | MMCA.Common.UI | 1 | ReturnUrlProtector |
| 1 | `NavItem` | MMCA.Common.UI | 1 | NavSection |
| 1 | `NullAccessibilityAnnouncer` | MMCA.Common.UI | 1 | IAccessibilityAnnouncer |
| 1 | `NullBatteryStatusService` | MMCA.Common.UI | 1 | IBatteryStatusService |
| 1 | `NullBiometricAuthenticator` | MMCA.Common.UI | 1 | IBiometricAuthenticator |
| 1 | `NullClipboardService` | MMCA.Common.UI | 1 | IClipboardService |
| 1 | `NullExternalLinkService` | MMCA.Common.UI | 1 | IExternalLinkService |
| 1 | `NullHapticFeedbackService` | MMCA.Common.UI | 1 | IHapticFeedbackService |
| 1 | `NullLocalCacheStore` | MMCA.Common.UI | 1 | ILocalCacheStore |
| 1 | `NullMapNavigationService` | MMCA.Common.UI | 1 | IMapNavigationService |
| 1 | `NullPushRegistrationService` | MMCA.Common.UI | 1 | IPushRegistrationService |
| 1 | `NullScreenshotService` | MMCA.Common.UI | 1 | IScreenshotService |
| 1 | `NullShareService` | MMCA.Common.UI | 1 | IShareService |
| 1 | `NullSpeechToTextService` | MMCA.Common.UI | 1 | ISpeechToTextService |
| 1 | `NullTextToSpeechService` | MMCA.Common.UI | 1 | ITextToSpeechService |
| 1 | `PseudoStringLocalizer` | MMCA.Common.UI | 2 | PseudoLocalizer, SupportedCultures |
| 1 | `ResxMudLocalizer` | MMCA.Common.UI | 1 | MudTranslations |
| 1 | `SameOriginProxyTokenRefresher` | MMCA.Common.UI | 1 | ITokenRefresher |
| 1 | `UnavailableExternalAuthBroker` | MMCA.Common.UI | 1 | IExternalAuthBroker |
| 1 | `WasmFormFactor` | MMCA.Common.UI | 1 | IFormFactor |
| 1 | `WasmTokenStorageService` | MMCA.Common.UI | 4 | ISessionCookieSync, ITokenRefresher, ITokenStorageService, JwtTokenInfo |
| 1 | `NullTokenRefresher` | MMCA.Common.UI.Gallery | 1 | ITokenRefresher |
| 1 | `NullTokenStorageService` | MMCA.Common.UI.Gallery | 1 | ITokenStorageService |
| 1 | `MauiAccessibilityAnnouncer` | MMCA.Common.UI.Maui | 1 | IAccessibilityAnnouncer |
| 1 | `MauiBatteryStatusService` | MMCA.Common.UI.Maui | 1 | IBatteryStatusService |
| 1 | `MauiBiometricAuthenticator` | MMCA.Common.UI.Maui | 1 | IBiometricAuthenticator |
| 1 | `MauiClipboardService` | MMCA.Common.UI.Maui | 1 | IClipboardService |
| 1 | `MauiConnectivityStatusService` | MMCA.Common.UI.Maui | 1 | IConnectivityStatusService |
| 1 | `MauiDevicePreferences` | MMCA.Common.UI.Maui | 1 | IDevicePreferences |
| 1 | `MauiExternalLinkService` | MMCA.Common.UI.Maui | 1 | IExternalLinkService |
| 1 | `MauiFormFactor` | MMCA.Common.UI.Maui | 1 | IFormFactor |
| 1 | `MauiHapticFeedbackService` | MMCA.Common.UI.Maui | 1 | IHapticFeedbackService |
| 1 | `MauiLocalCacheStore` | MMCA.Common.UI.Maui | 1 | ILocalCacheStore |
| 1 | `MauiMapNavigationService` | MMCA.Common.UI.Maui | 1 | IMapNavigationService |
| 1 | `MauiScreenshotService` | MMCA.Common.UI.Maui | 1 | IScreenshotService |
| 1 | `MauiShareService` | MMCA.Common.UI.Maui | 1 | IShareService |
| 1 | `MauiSpeechToTextService` | MMCA.Common.UI.Maui | 1 | ISpeechToTextService |
| 1 | `MauiTextToSpeechService` | MMCA.Common.UI.Maui | 1 | ITextToSpeechService |
| 1 | `FakeBiometricAuthenticator` | MMCA.Common.UI.Tests | 1 | IBiometricAuthenticator |
| 1 | `FakeConnectivityService` | MMCA.Common.UI.Tests | 1 | IConnectivityStatusService |
| 1 | `FakeDevicePreferences` | MMCA.Common.UI.Tests | 1 | IDevicePreferences |
| 1 | `FakeExternalLinkService` | MMCA.Common.UI.Tests | 1 | IExternalLinkService |
| 1 | `FakeStringLocalizerFactory` | MMCA.Common.UI.Tests | 1 | FakeStringLocalizer |
| 1 | `NotificationStateTests` | MMCA.Common.UI.Tests | 1 | NotificationState |
| 1 | `OtherDomainException` | MMCA.Common.UI.Tests | 1 | DomainException |
| 1 | `ReturnUrlProtectorTests` | MMCA.Common.UI.Tests | 1 | ReturnUrlProtector |
| 1 | `StubHttpMessageHandler` | MMCA.Common.UI.Tests | 2 | CapturedRequest, StubHttpMessageHandler |
| 1 | `WidgetDto` | MMCA.Common.UI.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `WebFormFactor` | MMCA.Common.UI.Web | 1 | IFormFactor |
| 1 | `Mocks` | MMCA.Common.UI.Web.Tests | 2 | ISessionCookieSync, ITokenRefresher |
| 2 | `DependencyInjection` | MMCA.ADC.Conference.API | 3 | ApplicationSettings, ConferencePermissions, RoleNames |
| 2 | `ServiceInfoController` | MMCA.ADC.Conference.API | 2 | Route, ServiceInfoControllerBase |
| 2 | `IAiScoringService` | MMCA.ADC.Conference.Application | 2 | SessionScoringInput, SessionScoringResult |
| 2 | `SessionizeResponse` | MMCA.ADC.Conference.Application | 5 | SessionizeCategory, SessionizeQuestion, SessionizeRoom, SessionizeSession, SessionizeSpeaker |
| 2 | `GrpcErrorTrailerParser` | MMCA.ADC.Conference.Contracts | 2 | Error, ErrorType |
| 2 | `CategoryItemChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `EventQuestionAnswerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `EventSpeakerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `RoomChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SessionCategoryItemChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SessionQuestionAnswerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SessionSpeakerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SpeakerCategoryItemChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SpeakerQuestionAnswerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `CategoryDistributionDTO` | MMCA.ADC.Conference.Shared | 1 | CategoryGroupDistribution |
| 2 | `ConferenceCategoryDTO` | MMCA.ADC.Conference.Shared | 3 | CategoryItemDTO, IBaseDTO<TIdentifierType>, IConcurrencyAware |
| 2 | `EventDTO` | MMCA.ADC.Conference.Shared | 6 | EventQuestionAnswerDTO, EventSpeakerDTO, IBaseDTO<TIdentifierType>, IConcurrencyAware, QuestionModerationDefault, RoomDTO |
| 2 | `SessionDTO` | MMCA.ADC.Conference.Shared | 5 | IBaseDTO<TIdentifierType>, IConcurrencyAware, SessionCategoryItemDTO, SessionQuestionAnswerDTO, SessionSpeakerDTO |
| 2 | `SpeakerDTO` | MMCA.ADC.Conference.Shared | 4 | IBaseDTO<TIdentifierType>, IConcurrencyAware, SpeakerCategoryItemDTO, SpeakerQuestionAnswerDTO |
| 2 | `SpeakerSessionOverlapDTO` | MMCA.ADC.Conference.Shared | 1 | MultiSessionSpeaker |
| 2 | `EventQuestionAnswerDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | EventQuestionAnswerDTO |
| 2 | `EventSpeakerDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | EventSpeakerDTO |
| 2 | `QuestionDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | QuestionDTO |
| 2 | `RoomDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | RoomDTO |
| 2 | `SessionCategoryItemDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SessionCategoryItemDTO |
| 2 | `SessionQuestionAnswerDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SessionQuestionAnswerDTO |
| 2 | `SessionSpeakerDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SessionSpeakerDTO |
| 2 | `SpeakerCategoryItemDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SpeakerCategoryItemDTO |
| 2 | `SpeakerQuestionAnswerDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SpeakerQuestionAnswerDTO |
| 2 | `IEventSpeakerUIService` | MMCA.ADC.Conference.UI | 1 | EventSpeakerDTO |
| 2 | `IOrganizerEventFeedbackUIService` | MMCA.ADC.Conference.UI | 1 | EventQuestionAnswerDTO |
| 2 | `IOrganizerSessionFeedbackUIService` | MMCA.ADC.Conference.UI | 1 | SessionQuestionAnswerDTO |
| 2 | `ISessionCategoryItemUIService` | MMCA.ADC.Conference.UI | 1 | SessionCategoryItemDTO |
| 2 | `ISessionSpeakerUIService` | MMCA.ADC.Conference.UI | 1 | SessionSpeakerDTO |
| 2 | `ISpeakerCategoryItemUIService` | MMCA.ADC.Conference.UI | 1 | SpeakerCategoryItemDTO |
| 2 | `SessionSelectionSpeakerOverlap` | MMCA.ADC.Conference.UI | 3 | MultiSessionSpeaker, SessionSelectionDisplay, SpeakerSessionSummary |
| 2 | `DependencyInjection` | MMCA.ADC.Engagement.API | 4 | ApplicationSettings, EngagementPermissions, OwnerOrAdminFilterOptions, RoleNames |
| 2 | `LiveChannelPublishQueue` | MMCA.ADC.Engagement.Application | 2 | ILiveChannelPublishQueue, LiveChannelPublishWorkItem |
| 2 | `CastVoteCommandValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 2 | CastVoteCommand, CastVoteCommandValidator |
| 2 | `CreateBookmarkRequestValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 2 | CreateBookmarkRequest, CreateBookmarkRequestValidator |
| 2 | `LivePollChanged` | MMCA.ADC.Engagement.Domain | 3 | BaseDomainEvent, DomainEntityState, LivePollStatus |
| 2 | `LivePollVoteChanged` | MMCA.ADC.Engagement.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SessionQuestionChanged` | MMCA.ADC.Engagement.Domain | 3 | BaseDomainEvent, DomainEntityState, QuestionStatus |
| 2 | `SessionQuestionUpvoteChanged` | MMCA.ADC.Engagement.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `UserSessionBookmarkChanged` | MMCA.ADC.Engagement.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `ISessionBookmarkUIService` | MMCA.ADC.Engagement.Shared | 1 | UserSessionBookmarkDTO |
| 2 | `IUserEngagementExportService` | MMCA.ADC.Engagement.Shared | 1 | UserEngagementExportDTO |
| 2 | `DisabledBookmarkCountServiceTests` | MMCA.ADC.Engagement.Shared.Tests | 1 | DisabledBookmarkCountService |
| 2 | `UserSessionBookmarkDTOTests` | MMCA.ADC.Engagement.Shared.Tests | 1 | UserSessionBookmarkDTO |
| 2 | `IBookmarkUIService` | MMCA.ADC.Engagement.UI | 2 | CreateBookmarkRequest, UserSessionBookmarkDTO |
| 2 | `IEventFeedbackUIService` | MMCA.ADC.Engagement.UI | 1 | EventQuestionAnswerDTO |
| 2 | `ILivePollUIService` | MMCA.ADC.Engagement.UI | 3 | CreateLivePollRequest, LivePollDTO, LivePollResultsDTO |
| 2 | `IQuestionLookupService` | MMCA.ADC.Engagement.UI | 1 | QuestionDTO |
| 2 | `ISessionFeedbackUIService` | MMCA.ADC.Engagement.UI | 1 | SessionQuestionAnswerDTO |
| 2 | `ISessionQuestionUIService` | MMCA.ADC.Engagement.UI | 2 | SessionQuestionDTO, SubmitQuestionRequest |
| 2 | `SessionReminderCoordinator` | MMCA.ADC.Engagement.UI | 6 | IDevicePreferences, ILiveEventUIService, ILocalNotificationService, ISessionLookupService, LocalNotificationRequest, SessionReminderPlanner |
| 2 | `DependencyInjection` | MMCA.ADC.Identity.API | 5 | ApplicationSettings, HttpContextExternalLoginEmailVerifier, IdentityPermissions, IExternalLoginEmailVerifier, RoleNames |
| 2 | `ChangePasswordRequestValidatorTests` | MMCA.ADC.Identity.Application.Tests | 2 | ChangePasswordRequest, ChangePasswordRequestValidator |
| 2 | `LoginRequestValidatorTests` | MMCA.ADC.Identity.Application.Tests | 2 | LoginRequest, LoginRequestValidator |
| 2 | `RefreshTokenRequestValidatorTests` | MMCA.ADC.Identity.Application.Tests | 2 | RefreshTokenRequest, RefreshTokenRequestValidator |
| 2 | `UserDeleted` | MMCA.ADC.Identity.Domain | 1 | BaseDomainEvent |
| 2 | `UserPasswordChanged` | MMCA.ADC.Identity.Domain | 1 | BaseDomainEvent |
| 2 | `FakeUserNotificationExportService` | MMCA.ADC.Identity.IntegrationTests | 2 | IUserNotificationExportService, UserNotificationExportItemDTO |
| 2 | `PiiCaptureLoggerProvider` | MMCA.ADC.Identity.IntegrationTests | 1 | PiiCaptureLogger |
| 2 | `UserDataExportDTO` | MMCA.ADC.Identity.Shared | 2 | UserDataExportEngagementSectionDTO, UserDataExportNotificationSectionDTO |
| 2 | `DisabledAttendeeQueryServiceTests` | MMCA.ADC.Identity.Shared.Tests | 1 | DisabledAttendeeQueryService |
| 2 | `ListPageActions` | MMCA.ADC.Identity.UI | 1 | MobileInfiniteScrollList<TItem> |
| 2 | `DependencyInjection` | MMCA.ADC.Notification.API | 1 | ApplicationSettings |
| 2 | `AttendeeNotificationRecipientProviderTests` | MMCA.ADC.Notification.Application.Tests | 2 | AttendeeNotificationRecipientProvider, IAttendeeQueryService |
| 2 | `DisabledUserNotificationExportService` | MMCA.ADC.Notification.Shared | 2 | IUserNotificationExportService, UserNotificationExportItemDTO |
| 2 | `MainPage` | MMCA.ADC.UI | 1 | MauiBackNavigationBridge |
| 2 | `CookieSessionRefreshMiddleware` | MMCA.Common.API | 1 | ICookieSessionRefresher |
| 2 | `ErrorHttpMapping` | MMCA.Common.API | 3 | Error, ErrorType, IErrorLocalizer |
| 2 | `IdempotentAttribute` | MMCA.Common.API | 1 | IdempotencyFilter |
| 2 | `IEntityControllerBase<TEntityDTO, TIdentifierType>` | MMCA.Common.API | 5 | BaseLookup<TIdentifierType>, CollectionResult<T>, IBaseDTO<TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder |
| 2 | `MiniProfilerExtensions` | MMCA.Common.API | 1 | ApplicationSettings |
| 2 | `ModuleControllerFeatureProvider` | MMCA.Common.API | 1 | ModulesSettings |
| 2 | `OidcDiscoveryEndpointExtensions` | MMCA.Common.API | 1 | JwksEndpointExtensions |
| 2 | `OwnerOrAdminFilter` | MMCA.Common.API | 3 | ICurrentUserService, OwnerOrAdminFilterOptions, OwnershipHelper |
| 2 | `SessionCookieEndpoints` | MMCA.Common.API | 4 | ICookieSessionRefresher, SessionCookieJar, SessionCookieRequest, SessionTokenResponse |
| 2 | `SessionCookieJar` | MMCA.Common.API | 1 | SessionCookieEndpoints |
| 2 | `AppAssociationEndpointTests` | MMCA.Common.API.Tests | 2 | AppAssociationEndpointExtensions, AppAssociationOptions |
| 2 | `CorrelationIdMiddlewareTests` | MMCA.Common.API.Tests | 2 | CorrelationIdMiddleware, ICorrelationContext |
| 2 | `ExceptionHandlerTests` | MMCA.Common.API.Tests | 7 | DbUpdateExceptionHandler, DomainExceptionHandler, DomainInvariantViolationException, GlobalExceptionHandler, OperationCanceledExceptionHandler, TestDomainException, ValidationExceptionHandler |
| 2 | `JwksEndpointTests` | MMCA.Common.API.Tests | 4 | IJwksProvider, JwksEndpointExtensions, JwksSettings, RsaJwksProvider |
| 2 | `PermissionPolicyProviderTests` | MMCA.Common.API.Tests | 2 | PermissionPolicyProvider, PermissionRequirement |
| 2 | `SoftDeletedUserMiddlewareTests` | MMCA.Common.API.Tests | 4 | ICacheService, ICurrentUserService, ISoftDeletedUserValidator, SoftDeletedUserMiddleware |
| 2 | `StubRefresher` | MMCA.Common.API.Tests | 2 | ICookieSessionRefresher, SessionTokenResult |
| 2 | `IDataSourceService` | MMCA.Common.Application | 2 | DataSource, DataSourceKey |
| 2 | `IEventBus` | MMCA.Common.Application | 1 | IIntegrationEvent |
| 2 | `IIntegrationEventHandler<in TIntegrationEvent>` | MMCA.Common.Application | 1 | IIntegrationEvent |
| 2 | `IMessageBus` | MMCA.Common.Application | 1 | IIntegrationEvent |
| 2 | `IModule` | MMCA.Common.Application | 1 | ApplicationSettings |
| 2 | `INavigationMetadata` | MMCA.Common.Application | 1 | NavigationPropertyInfo |
| 2 | `SafeDomainEventHandler<TDomainEvent>` | MMCA.Common.Application | 2 | BaseDomainEvent, IDomainEventHandler<in TDomainEvent> |
| 2 | `ValidationFailureExtensions` | MMCA.Common.Application | 1 | Error |
| 2 | `ApplicationSettingsTests` | MMCA.Common.Application.Tests | 2 | ApplicationSettings, IApplicationSettings |
| 2 | `CommandRequestValidatorTests` | MMCA.Common.Application.Tests | 5 | CommandRequestValidator<TCommand, TRequest>, PermissiveTestRequestValidator, TestCommandWithRequest, TestRequest, TestRequestValidator |
| 2 | `LoginRequestValidatorTests` | MMCA.Common.Application.Tests | 2 | LoginRequest, LoginRequestValidator |
| 2 | `ModulesSettingsTests` | MMCA.Common.Application.Tests | 2 | ModuleSettings, ModulesSettings |
| 2 | `MultiHandlerEvent` | MMCA.Common.Application.Tests | 1 | BaseDomainEvent |
| 2 | `NullNotificationRecipientProviderTests` | MMCA.Common.Application.Tests | 1 | NullNotificationRecipientProvider |
| 2 | `RefreshTokenRequestValidatorTests` | MMCA.Common.Application.Tests | 2 | RefreshTokenRequest, RefreshTokenRequestValidator |
| 2 | `TestEvent` | MMCA.Common.Application.Tests | 1 | BaseDomainEvent |
| 2 | `TestSafeDomainEvent` | MMCA.Common.Application.Tests | 1 | BaseDomainEvent |
| 2 | `Extensions` | MMCA.Common.Aspire | 7 | HttpResilienceDefaults, IWarmupTask, OpenIdConnectMetadataWarmupTask, OutboxPollFilterProcessor, WarmupHostedService, WarmupReadinessGate, WarmupReadinessHealthCheck |
| 2 | `SecurityHeadersMiddleware` | MMCA.Common.Aspire | 2 | ICspPolicyProvider, SecurityHeadersSettings |
| 2 | `StaticCspPolicyProvider` | MMCA.Common.Aspire | 3 | CspPolicy, ICspPolicyProvider, SecurityHeadersSettings |
| 2 | `StubCspProvider` | MMCA.Common.Aspire.Tests | 2 | CspPolicy, ICspPolicyProvider |
| 2 | `WarmupHostedServiceTests` | MMCA.Common.Aspire.Tests | 5 | IWarmupTask, RecordingTask, ThrowingTask, WarmupHostedService, WarmupReadinessGate |
| 2 | `WarmupReadinessHealthCheckTests` | MMCA.Common.Aspire.Tests | 2 | WarmupReadinessGate, WarmupReadinessHealthCheck |
| 2 | `SampleItem` | MMCA.Common.Benchmarks | 1 | BaseEntity<TIdentifierType> |
| 2 | `BaseIntegrationEvent` | MMCA.Common.Domain | 2 | BaseDomainEvent, IIntegrationEvent |
| 2 | `EntityChangedEvent<TIdentifierType>` | MMCA.Common.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `PushNotificationCreated` | MMCA.Common.Domain | 1 | BaseDomainEvent |
| 2 | `Specification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 2 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType> |
| 2 | `GuidIdEntity` | MMCA.Common.Domain.Tests | 1 | BaseEntity<TIdentifierType> |
| 2 | `PiiRedactorTests` | MMCA.Common.Domain.Tests | 3 | NoPii, PiiRedactor, Subject |
| 2 | `StringIdEntity` | MMCA.Common.Domain.Tests | 1 | BaseEntity<TIdentifierType> |
| 2 | `TestDomainEvent` | MMCA.Common.Domain.Tests | 1 | BaseDomainEvent |
| 2 | `TestDomainEvent` | MMCA.Common.Domain.Tests | 1 | BaseDomainEvent |
| 2 | `ResultFailureException` | MMCA.Common.Grpc | 1 | Error |
| 2 | `JwtForwardingClientInterceptorTests` | MMCA.Common.Grpc.Tests | 5 | FakeRequest, FakeResponse, FakeStreamReader, FakeStreamWriter, JwtForwardingClientInterceptor |
| 2 | `CapturedState` | MMCA.Common.Infrastructure | 3 | IAggregateRoot, IDomainEvent, OutboxMessage |
| 2 | `DesignTimeDbContextOptions` | MMCA.Common.Infrastructure | 2 | ConnectionStringSettings, DataSourceEntrySettings |
| 2 | `IEntityDataSourceRegistry` | MMCA.Common.Infrastructure | 1 | DataSourceKey |
| 2 | `JwtSettings` | MMCA.Common.Infrastructure | 2 | IJwtSettings, JwtSigningAlgorithm |
| 2 | `NotificationHub` | MMCA.Common.Infrastructure | 1 | PushNotificationSettings |
| 2 | `NullDomainEventDispatcher` | MMCA.Common.Infrastructure | 2 | IDomainEvent, IDomainEventDispatcher |
| 2 | `OutboxSettings` | MMCA.Common.Infrastructure | 2 | DataSource, DataSourceKey |
| 2 | `PhysicalDataSource` | MMCA.Common.Infrastructure | 1 | DataSourceKey |
| 2 | `Snapshot` | MMCA.Common.Infrastructure | 1 | DataSourceKey |
| 2 | `TokenService` | MMCA.Common.Infrastructure | 3 | IJwtSettings, ITokenService, JwtSigningAlgorithm |
| 2 | `ConnectionStringSettingsTests` | MMCA.Common.Infrastructure.Tests | 2 | ConnectionStringSettings, IConnectionStringSettings |
| 2 | `CorrelationContextTests` | MMCA.Common.Infrastructure.Tests | 1 | CorrelationContext |
| 2 | `DefaultEntityConfigurationAssemblyProviderTests` | MMCA.Common.Infrastructure.Tests | 2 | DefaultEntityConfigurationAssemblyProvider, EntityConfigurationOptions |
| 2 | `EFQueryableExecutorTests` | MMCA.Common.Infrastructure.Tests | 2 | EFQueryableExecutor, TestItem |
| 2 | `MemoryCacheServiceTests` | MMCA.Common.Infrastructure.Tests | 1 | MemoryCacheService |
| 2 | `NullLiveChannelPublisherTests` | MMCA.Common.Infrastructure.Tests | 1 | NullLiveChannelPublisher |
| 2 | `NullPushNotificationSenderTests` | MMCA.Common.Infrastructure.Tests | 1 | NullPushNotificationSender |
| 2 | `PasswordHasherTests` | MMCA.Common.Infrastructure.Tests | 1 | PasswordHasher |
| 2 | `PushNotificationSettingsTests` | MMCA.Common.Infrastructure.Tests | 2 | IPushNotificationSettings, PushNotificationSettings |
| 2 | `RsaJwksProviderTests` | MMCA.Common.Infrastructure.Tests | 2 | JwksSettings, RsaJwksProvider |
| 2 | `SmtpEmailSenderTests` | MMCA.Common.Infrastructure.Tests | 2 | SmtpEmailSender, SmtpSettings |
| 2 | `SmtpSettingsTests` | MMCA.Common.Infrastructure.Tests | 2 | ISmtpSettings, SmtpSettings |
| 2 | `TestableDbSeeder` | MMCA.Common.Infrastructure.Tests | 1 | DbSeeder |
| 2 | `TestDomainEvent` | MMCA.Common.Infrastructure.Tests | 2 | BaseDomainEvent, IDomainEvent |
| 2 | `TestDomainEventWithData` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `TestIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 2 | BaseDomainEvent, IIntegrationEvent |
| 2 | `TestLocalEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `UseDataSourceAttributeTests` | MMCA.Common.Infrastructure.Tests | 2 | DataSource, UseDataSourceAttribute |
| 2 | `WarningCountingLogger` | MMCA.Common.Infrastructure.Tests | 1 | DistributedCacheService |
| 2 | `PermissionRegistryBuilder` | MMCA.Common.Shared | 1 | PermissionRegistry |
| 2 | `Result` | MMCA.Common.Shared | 2 | Error, ResultJsonConverterFactory |
| 2 | `ResultConverter` | MMCA.Common.Shared | 2 | Error, Result |
| 2 | `ResultJsonConverterFactory` | MMCA.Common.Shared | 3 | PropertyReader, Result, ResultConverter |
| 2 | `CollectionResultTests` | MMCA.Common.Shared.Tests | 3 | CollectionResult<T>, PagedCollectionResult<T>, PaginationMetadata |
| 2 | `DomainExceptionTests` | MMCA.Common.Shared.Tests | 3 | ConcreteDomainException, DomainException, DomainInvariantViolationException |
| 2 | `ErrorTests` | MMCA.Common.Shared.Tests | 2 | Error, ErrorType |
| 2 | `IcsCalendarBuilderTests` | MMCA.Common.Shared.Tests | 2 | IcsCalendarBuilder, IcsEvent |
| 2 | `OpenApiContractTestsBase<TFixture>` | MMCA.Common.Testing | 2 | IIntegrationTestFixture, IntegrationTestBase<TFixture> |
| 2 | `ProblemDetailsContractTestsBase<TFixture>` | MMCA.Common.Testing | 2 | IIntegrationTestFixture, IntegrationTestBase<TFixture> |
| 2 | `ServiceInfoVersioningContractTestsBase<TFixture>` | MMCA.Common.Testing | 2 | IIntegrationTestFixture, IntegrationTestBase<TFixture> |
| 2 | `IArchitectureMap` | MMCA.Common.Testing.Architecture | 2 | Layer, LayerRef |
| 2 | `E2ETestCollection` | MMCA.Common.Testing.E2E | 1 | PlaywrightFixture |
| 2 | `WebVitalsCollector` | MMCA.Common.Testing.E2E | 2 | WebVitalsArtifact, WebVitalsSample |
| 2 | `UiHttpServiceHarness` | MMCA.Common.Testing.UI | 3 | CapturingHttpMessageHandler, FreshApiClientFactory, StubTokenStorageService |
| 2 | `ApiUserPreferenceReader` | MMCA.Common.UI | 3 | ITokenStorageService, IUserPreferenceReader, UserPreferences |
| 2 | `ChannelSubscription` | MMCA.Common.UI | 1 | NotificationHubService |
| 2 | `ErrorMessages` | MMCA.Common.UI | 1 | DomainInvariantViolationException |
| 2 | `IDeepLinkDispatcher` | MMCA.Common.UI | 1 | DeepLinkRouteEventArgs |
| 2 | `IEntityService<TEntityDTO, TIdentifierType>` | MMCA.Common.UI | 2 | BaseLookup<TIdentifierType>, IBaseDTO<TIdentifierType> |
| 2 | `INotificationInboxUIService` | MMCA.Common.UI | 2 | PagedCollectionResult<T>, UserNotificationDTO |
| 2 | `IPushNotificationUIService` | MMCA.Common.UI | 3 | PagedCollectionResult<T>, PushNotificationDTO, SendPushNotificationRequest |
| 2 | `IUIModule` | MMCA.Common.UI | 1 | NavItem |
| 2 | `MMCATheme` | MMCA.Common.UI | 2 | BrandColors, Error |
| 2 | `NotificationHubService` | MMCA.Common.UI | 3 | ApiSettings, ChannelSubscription, ITokenStorageService |
| 2 | `NullGeocodingService` | MMCA.Common.UI | 2 | GeoPoint, IGeocodingService |
| 2 | `NullGeolocationService` | MMCA.Common.UI | 2 | GeoPoint, IGeolocationService |
| 2 | `NullLocalNotificationService` | MMCA.Common.UI | 2 | ILocalNotificationService, LocalNotificationRequest |
| 2 | `NullMediaPickerService` | MMCA.Common.UI | 2 | IMediaPickerService, PickedMedia |
| 2 | `NullPushDeviceTokenProvider` | MMCA.Common.UI | 2 | IPushDeviceTokenProvider, PushDeviceToken |
| 2 | `PseudoStringLocalizerFactory` | MMCA.Common.UI | 1 | PseudoStringLocalizer |
| 2 | `ServiceExceptionHelper` | MMCA.Common.UI | 1 | DomainInvariantViolationException |
| 2 | `MauiExternalAuthBroker` | MMCA.Common.UI.Maui | 2 | ApiSettings, IExternalAuthBroker |
| 2 | `MauiGeocodingService` | MMCA.Common.UI.Maui | 2 | GeoPoint, IGeocodingService |
| 2 | `MauiGeolocationService` | MMCA.Common.UI.Maui | 2 | GeoPoint, IGeolocationService |
| 2 | `MauiLocalNotificationService` | MMCA.Common.UI.Maui | 2 | ILocalNotificationService, LocalNotificationRequest |
| 2 | `MauiMediaPickerService` | MMCA.Common.UI.Maui | 2 | IMediaPickerService, PickedMedia |
| 2 | `MauiPushRegistrationService` | MMCA.Common.UI.Maui | 3 | IDevicePreferences, IPushDeviceTokenProvider, IPushRegistrationService |
| 2 | `AuthDelegatingHandlerTests` | MMCA.Common.UI.Tests | 3 | AuthDelegatingHandler, ITokenStorageService, StubHttpMessageHandler |
| 2 | `BunitTestBase` | MMCA.Common.UI.Tests | 6 | AlwaysOnlineConnectivityStatusService, BunitComponentTestBase, IConnectivityStatusService, IExternalAuthBroker, ThemeService, UnavailableExternalAuthBroker |
| 2 | `CapturingHttpMessageHandlerTests` | MMCA.Common.UI.Tests | 1 | CapturingHttpMessageHandler |
| 2 | `JwtAuthenticationStateProviderTests` | MMCA.Common.UI.Tests | 2 | ITokenStorageService, JwtAuthenticationStateProvider |
| 2 | `ListPageQueryStateServiceTests` | MMCA.Common.UI.Tests | 3 | ListPageQueryStateService, ListPageState, RecordingNavigationManager |
| 2 | `ListPageStateServiceTests` | MMCA.Common.UI.Tests | 2 | ListPageState, ListPageStateService |
| 2 | `Mocks` | MMCA.Common.UI.Tests | 2 | StubHttpClientFactory, StubHttpMessageHandler |
| 2 | `Mocks` | MMCA.Common.UI.Tests | 5 | ISessionCookieSync, ITokenRefresher, ITokenStorageService, StubHttpClientFactory, StubHttpMessageHandler |
| 2 | `Mocks` | MMCA.Common.UI.Tests | 2 | StubHttpClientFactory, StubHttpMessageHandler |
| 2 | `SameOriginProxyTokenRefresherTests` | MMCA.Common.UI.Tests | 1 | SameOriginProxyTokenRefresher |
| 2 | `StubTokenStorageServiceTests` | MMCA.Common.UI.Tests | 1 | StubTokenStorageService |
| 2 | `WasmFormFactorTests` | MMCA.Common.UI.Tests | 2 | IFormFactor, WasmFormFactor |
| 2 | `BlazorCspPolicyProvider` | MMCA.Common.UI.Web | 3 | ApiSettings, CspPolicy, ICspPolicyProvider |
| 2 | `BlazorCspPolicyProviderTests` | MMCA.Common.UI.Web.Tests | 3 | ApiSettings, CspPolicy, ICspPolicyProvider |
| 3 | `ISessionizeService` | MMCA.ADC.Conference.Application | 1 | SessionizeResponse |
| 3 | `RoomChangedHandler` | MMCA.ADC.Conference.Application | 3 | DomainEntityState, IDomainEventHandler<in TDomainEvent>, RoomChanged |
| 3 | `UpdateEventResult` | MMCA.ADC.Conference.Application | 1 | EventDTO |
| 3 | `UpdateSessionResult` | MMCA.ADC.Conference.Application | 1 | SessionDTO |
| 3 | `RecordingEventBus` | MMCA.ADC.Conference.Application.Tests | 2 | IEventBus, IIntegrationEvent |
| 3 | `CategoryChanged` | MMCA.ADC.Conference.Domain | 2 | DomainEntityState, EntityChangedEvent<TIdentifierType> |
| 3 | `EventChanged` | MMCA.ADC.Conference.Domain | 2 | DomainEntityState, EntityChangedEvent<TIdentifierType> |
| 3 | `QuestionChanged` | MMCA.ADC.Conference.Domain | 2 | DomainEntityState, EntityChangedEvent<TIdentifierType> |
| 3 | `SessionChanged` | MMCA.ADC.Conference.Domain | 2 | DomainEntityState, EntityChangedEvent<TIdentifierType> |
| 3 | `SpeakerChanged` | MMCA.ADC.Conference.Domain | 2 | DomainEntityState, EntityChangedEvent<TIdentifierType> |
| 3 | `AnthropicScoringService` | MMCA.ADC.Conference.Infrastructure | 8 | AiScoreResponse, AnthropicMessage, AnthropicRequest, AnthropicResponse, IAiScoringService, SessionScoringInput, SessionScoringResult, SpeakerInfo |
| 3 | `FakeAiScoringService` | MMCA.ADC.Conference.IntegrationTests | 3 | IAiScoringService, SessionScoringInput, SessionScoringResult |
| 3 | `IEventLiveValidationService` | MMCA.ADC.Conference.Shared | 3 | EventLiveInfo, Result, SessionLiveInfo |
| 3 | `ISessionBookmarkValidationService` | MMCA.ADC.Conference.Shared | 1 | Result |
| 3 | `SessionSelectionDashboardDTO` | MMCA.ADC.Conference.Shared | 4 | CategoryDistributionDTO, SessionAiScoreDTO, SpeakerLocalitySummary, SpeakerSessionOverlapDTO |
| 3 | `SpeakerLinkedToUser` | MMCA.ADC.Conference.Shared | 1 | BaseIntegrationEvent |
| 3 | `SpeakerUnlinkedFromUser` | MMCA.ADC.Conference.Shared | 1 | BaseIntegrationEvent |
| 3 | `ConferenceCategoryDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | ConferenceCategoryDTO |
| 3 | `EventDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | EventDTO |
| 3 | `SessionDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SessionDTO |
| 3 | `CachedSessionPage` | MMCA.ADC.Conference.UI | 1 | SessionDTO |
| 3 | `CategoryItemLookupService` | MMCA.ADC.Conference.UI | 6 | CategoryItemDTO, CategoryItemInfo, CollectionResult<T>, ConferenceCategoryDTO, ICategoryItemLookupService, PagedCollectionResult<T> |
| 3 | `ConferenceUIModule` | MMCA.ADC.Conference.UI | 5 | ConferenceRoutePaths, IUIModule, NavItem, NavSection, RoleNames |
| 3 | `EventLookupService` | MMCA.ADC.Conference.UI | 4 | EventDTO, EventInfo, IEventLookupService, PagedCollectionResult<T> |
| 3 | `ICategoryItemUIService` | MMCA.ADC.Conference.UI | 2 | CategoryItemDTO, IEntityService<TEntityDTO, TIdentifierType> |
| 3 | `IConferenceCategoryUIService` | MMCA.ADC.Conference.UI | 2 | ConferenceCategoryDTO, IEntityService<TEntityDTO, TIdentifierType> |
| 3 | `IEventUIService` | MMCA.ADC.Conference.UI | 3 | EventDTO, IEntityService<TEntityDTO, TIdentifierType>, RefreshFromSessionizeResultDTO |
| 3 | `IQuestionUIService` | MMCA.ADC.Conference.UI | 2 | IEntityService<TEntityDTO, TIdentifierType>, QuestionDTO |
| 3 | `IRoomUIService` | MMCA.ADC.Conference.UI | 2 | IEntityService<TEntityDTO, TIdentifierType>, RoomDTO |
| 3 | `ISessionUIService` | MMCA.ADC.Conference.UI | 2 | IEntityService<TEntityDTO, TIdentifierType>, SessionDTO |
| 3 | `ISpeakerDashboardUIService` | MMCA.ADC.Conference.UI | 2 | SessionDTO, SessionFeedbackDTO |
| 3 | `ISpeakerUIService` | MMCA.ADC.Conference.UI | 2 | IEntityService<TEntityDTO, TIdentifierType>, SpeakerDTO |
| 3 | `OrganizerEventFeedbackService` | MMCA.ADC.Conference.UI | 6 | AuthenticatedServiceBase, EventQuestionAnswerDTO, IOrganizerEventFeedbackUIService, ITokenStorageService, PagedCollectionResult<T>, ServiceExceptionHelper |
| 3 | `OrganizerSessionFeedbackService` | MMCA.ADC.Conference.UI | 6 | AuthenticatedServiceBase, IOrganizerSessionFeedbackUIService, ITokenStorageService, PagedCollectionResult<T>, ServiceExceptionHelper, SessionQuestionAnswerDTO |
| 3 | `PublicSessionListFilterBar` | MMCA.ADC.Conference.UI | 3 | EventDTO, IScreenshotService, IShareService |
| 3 | `SpeakerLookupService` | MMCA.ADC.Conference.UI | 4 | ISpeakerLookupService, PagedCollectionResult<T>, SpeakerDTO, SpeakerInfo |
| 3 | `BunitTestBase` | MMCA.ADC.Conference.UI.Tests | 26 | AlwaysOnlineConnectivityStatusService, ApiSettings, BunitComponentTestBase, IClipboardService, IConnectivityStatusService, IExternalLinkService, IGeocodingService, IGeolocationService, IHapticFeedbackService, ILocalCacheStore, IMapNavigationService, IPublicLinkBuilder, IScreenshotService, IShareService, ITextToSpeechService, NavigationPublicLinkBuilder, NullClipboardService, NullExternalLinkService, NullGeocodingService, NullGeolocationService …(+6) |
| 3 | `E2ETestCollection` | MMCA.ADC.E2E.Tests | 2 | E2ETestCollection, PlaywrightFixture |
| 3 | `LivePollAuthorization` | MMCA.ADC.Engagement.Application | 3 | Error, Result, SessionLiveInfo |
| 3 | `LiveChannelPublishQueueTests` | MMCA.ADC.Engagement.Application.Tests | 2 | LiveChannelPublishQueue, LiveChannelPublishWorkItem |
| 3 | `LiveChannelPublishProcessor` | MMCA.ADC.Engagement.Infrastructure | 2 | ILiveChannelPublisher, LiveChannelPublishQueue |
| 3 | `DisabledUserEngagementExportService` | MMCA.ADC.Engagement.Shared | 2 | IUserEngagementExportService, UserEngagementExportDTO |
| 3 | `BookmarkService` | MMCA.ADC.Engagement.UI | 8 | AuthenticatedServiceBase, CreateBookmarkRequest, IBookmarkUIService, ITokenStorageService, PagedCollectionResult<T>, PaginationMetadata, ServiceExceptionHelper, UserSessionBookmarkDTO |
| 3 | `EngagementUIModule` | MMCA.ADC.Engagement.UI | 3 | EngagementRoutePaths, IUIModule, NavItem |
| 3 | `EventFeedbackService` | MMCA.ADC.Engagement.UI | 6 | AuthenticatedServiceBase, EventQuestionAnswerDTO, IEventFeedbackUIService, ITokenStorageService, PagedCollectionResult<T>, ServiceExceptionHelper |
| 3 | `LivePollUIService` | MMCA.ADC.Engagement.UI | 8 | AuthenticatedServiceBase, CastVoteRequest, CreateLivePollRequest, ILivePollUIService, ITokenStorageService, LivePollDTO, LivePollResultsDTO, ServiceExceptionHelper |
| 3 | `QuestionLookupService` | MMCA.ADC.Engagement.UI | 5 | AuthenticatedServiceBase, IQuestionLookupService, ITokenStorageService, PagedCollectionResult<T>, QuestionDTO |
| 3 | `SessionBookmarkUIService` | MMCA.ADC.Engagement.UI | 7 | AuthenticatedServiceBase, CreateBookmarkRequest, ISessionBookmarkUIService, ITokenStorageService, ServiceExceptionHelper, SessionReminderCoordinator, UserSessionBookmarkDTO |
| 3 | `SessionFeedbackService` | MMCA.ADC.Engagement.UI | 6 | AuthenticatedServiceBase, ISessionFeedbackUIService, ITokenStorageService, PagedCollectionResult<T>, ServiceExceptionHelper, SessionQuestionAnswerDTO |
| 3 | `SessionLivePollPanel` | MMCA.ADC.Engagement.UI | 4 | ErrorMessages, IHapticFeedbackService, ILivePollUIService, LivePollResultsDTO |
| 3 | `SessionLookupService` | MMCA.ADC.Engagement.UI | 4 | ISessionLookupService, PagedCollectionResult<T>, SessionDTO, SessionInfo |
| 3 | `SessionQuestionUIService` | MMCA.ADC.Engagement.UI | 6 | AuthenticatedServiceBase, ISessionQuestionUIService, ITokenStorageService, ServiceExceptionHelper, SessionQuestionDTO, SubmitQuestionRequest |
| 3 | `HappeningNowTests` | MMCA.ADC.Engagement.UI.Tests | 14 | ApiSettings, BunitComponentTestBase, HappeningNowPage, IHapticFeedbackService, ILiveEventUIService, ILivePollUIService, ISessionLookupService, ITokenStorageService, LiveEventContext, NotificationHubService, NotificationState, NullHapticFeedbackService, SessionInfo, TestPrincipal |
| 3 | `LiveChannelJoinTests` | MMCA.ADC.Engagement.UI.Tests | 17 | ApiSettings, BunitComponentTestBase, HappeningNowPage, IHapticFeedbackService, ILiveEventUIService, ILivePollUIService, ISessionLookupService, ISessionQuestionUIService, ISpeechToTextService, ITokenStorageService, LiveEventContext, NotificationHubService, NotificationState, NullHapticFeedbackService, NullSpeechToTextService, SessionInfo, TestPrincipal |
| 3 | `SessionReminderCoordinatorTests` | MMCA.ADC.Engagement.UI.Tests | 9 | ILiveEventUIService, ILocalNotificationService, InMemoryDevicePreferences, ISessionLookupService, LiveEventContext, LocalNotificationRequest, SessionInfo, SessionReminderCoordinator, SessionReminderPlanner |
| 3 | `IdentityModule` | MMCA.ADC.Identity.API | 4 | ApplicationSettings, DisabledAttendeeQueryService, IAttendeeQueryService, IModule |
| 3 | `FakeUserEngagementExportService` | MMCA.ADC.Identity.IntegrationTests | 4 | IUserEngagementExportService, UserEngagementBookmarkExportDTO, UserEngagementExportDTO, UserEngagementSubmittedQuestionExportDTO |
| 3 | `UserRegistered` | MMCA.ADC.Identity.Shared | 1 | BaseIntegrationEvent |
| 3 | `IdentityUIModule` | MMCA.ADC.Identity.UI | 5 | IdentityRoutePaths, IUIModule, NavItem, NavSection, RoleNames |
| 3 | `UserService` | MMCA.ADC.Identity.UI | 8 | AuthenticatedServiceBase, ITokenStorageService, IUserUIService, PagedCollectionResult<T>, PaginationMetadata, ServiceExceptionHelper, UserAvatarDTO, UserListDTO |
| 3 | `BunitTestBase` | MMCA.ADC.Identity.UI.Tests | 3 | BunitComponentTestBase, IMediaPickerService, NullMediaPickerService |
| 3 | `NotificationModule` | MMCA.ADC.Notification.API | 4 | ApplicationSettings, DisabledUserNotificationExportService, IModule, IUserNotificationExportService |
| 3 | `App` | MMCA.ADC.UI | 1 | MainPage |
| 3 | `DeviceUIModule` | MMCA.ADC.UI | 2 | IUIModule, NavItem |
| 3 | `MainActivity` | MMCA.ADC.UI | 1 | IDeepLinkDispatcher |
| 3 | `ApiControllerBase` | MMCA.Common.API | 3 | Error, ErrorHttpMapping, IErrorLocalizer |
| 3 | `AuthorizationExtensions` | MMCA.Common.API | 6 | AuthorizationPolicies, IPermissionRegistry, PermissionAuthorizationHandler, PermissionPolicyProvider, PermissionRegistryBuilder, RoleNames |
| 3 | `CookieSessionRefreshMiddlewareExtensions` | MMCA.Common.API | 1 | CookieSessionRefreshMiddleware |
| 3 | `CookieTokenReader` | MMCA.Common.API | 1 | SessionCookieEndpoints |
| 3 | `IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>` | MMCA.Common.API | 3 | IBaseDTO<TIdentifierType>, ICreateRequest, IEntityControllerBase<TEntityDTO, TIdentifierType> |
| 3 | `SignalRExtensions` | MMCA.Common.API | 2 | NotificationHub, PushNotificationSettings |
| 3 | `UnhandledResultFailureFilter` | MMCA.Common.API | 4 | Error, ErrorHttpMapping, IErrorLocalizer, Result |
| 3 | `WebApplicationBuilderExtensions` | MMCA.Common.API | 2 | JwtSettings, JwtSigningAlgorithm |
| 3 | `IdempotencyFilterTests` | MMCA.Common.API.Tests | 4 | ICacheService, IdempotencyFilter, IdempotencyRecord, Result |
| 3 | `OidcDiscoveryEndpointTests` | MMCA.Common.API.Tests | 2 | JwksEndpointExtensions, OidcDiscoveryEndpointExtensions |
| 3 | `OwnerOrAdminFilterTests` | MMCA.Common.API.Tests | 3 | ICurrentUserService, OwnerOrAdminFilter, OwnerOrAdminFilterOptions |
| 3 | `PermissionAuthorizationHandlerTests` | MMCA.Common.API.Tests | 5 | AuthClaimTypes, PermissionAuthorizationHandler, PermissionRegistryBuilder, PermissionRequirement, RoleNames |
| 3 | `SessionCookieEndpointsTests` | MMCA.Common.API.Tests | 6 | ICookieSessionRefresher, SessionCookieEndpoints, SessionCookieRequest, SessionTokenResponse, SessionTokenResult, StubRefresher |
| 3 | `SessionCookieJarTests` | MMCA.Common.API.Tests | 2 | SessionCookieEndpoints, SessionCookieJar |
| 3 | `CachingCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 4 | ICacheInvalidating, ICacheService, ICommandHandler<in TCommand, TResult>, Result |
| 3 | `CachingQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 5 | ICacheService, IQueryCacheable, IQueryHandler<in TQuery, TResult>, QueryCacheKeyLocks, Result |
| 3 | `DomainEventDispatcher` | MMCA.Common.Application | 5 | IDomainEvent, IDomainEventDispatcher, IDomainEventHandler<in TDomainEvent>, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent> |
| 3 | `IFileStorageService` | MMCA.Common.Application | 1 | Result |
| 3 | `IImageProcessor` | MMCA.Common.Application | 1 | Result |
| 3 | `ILoginProtectionService` | MMCA.Common.Application | 1 | Result |
| 3 | `IPushDeviceRegistrar` | MMCA.Common.Application | 2 | DeviceInstallationRequest, Result |
| 3 | `LoggingCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 4 | CqrsMetrics, ICommandHandler<in TCommand, TResult>, ICorrelationContext, Result |
| 3 | `LoggingQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 4 | CqrsMetrics, ICorrelationContext, IQueryHandler<in TQuery, TResult>, Result |
| 3 | `ModuleLoader` | MMCA.Common.Application | 4 | ApplicationSettings, IModule, IModuleSeeder, ModulesSettings |
| 3 | `NavigationMetadata` | MMCA.Common.Application | 2 | INavigationMetadata, NavigationPropertyInfo |
| 3 | `QueryFieldService` | MMCA.Common.Application | 3 | Error, PropertyAccessor, Result |
| 3 | `QueryFilterService` | MMCA.Common.Application | 10 | BoolFilterStrategy, DateTimeFilterStrategy, DecimalFilterStrategy, Error, GuidFilterStrategy, IFilterStrategy, IntFilterStrategy, LongFilterStrategy, Result, StringFilterStrategy |
| 3 | `ResultFailureFactory` | MMCA.Common.Application | 2 | Error, Result |
| 3 | `FakeConsumerModule` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 3 | `FakeCycleModuleOne` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 3 | `FakeCycleModuleTwo` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 3 | `FakeModuleAlpha` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 3 | `FakeModuleBravo` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 3 | `FakeModuleCharlie` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 3 | `FakeStrictModule` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 3 | `FakeStubbedModule` | MMCA.Common.Application.Tests | 5 | ApplicationSettings, FakeModuleTracker, FakeRemoteContractStub, IFakeRemoteContract, IModule |
| 3 | `MultiHandlerEventHandler1` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, MultiHandlerEvent |
| 3 | `MultiHandlerEventHandler2` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, MultiHandlerEvent |
| 3 | `ProfilingCommandDecoratorTests` | MMCA.Common.Application.Tests | 5 | Error, ICommandHandler<in TCommand, TResult>, ProfilingCommandDecorator<TCommand, TResult>, ProfilingTestCommand, Result |
| 3 | `ProfilingQueryDecoratorTests` | MMCA.Common.Application.Tests | 5 | Error, IQueryHandler<in TQuery, TResult>, ProfilingQueryDecorator<TQuery, TResult>, ProfilingTestQuery, Result |
| 3 | `TestEventHandler` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, TestEvent |
| 3 | `TestIntegrationEvent` | MMCA.Common.Application.Tests | 3 | BaseDomainEvent, BaseIntegrationEvent, IIntegrationEvent |
| 3 | `TestSafeDomainEventHandler` | MMCA.Common.Application.Tests | 2 | SafeDomainEventHandler<TDomainEvent>, TestSafeDomainEvent |
| 3 | `SecurityHeadersExtensions` | MMCA.Common.Aspire | 4 | ICspPolicyProvider, SecurityHeadersMiddleware, SecurityHeadersSettings, StaticCspPolicyProvider |
| 3 | `MetricsInstrumentationToggleTests` | MMCA.Common.Aspire.Tests | 1 | Extensions |
| 3 | `SecurityHeadersMiddlewareTests` | MMCA.Common.Aspire.Tests | 6 | CspPolicy, ICspPolicyProvider, SecurityHeadersMiddleware, SecurityHeadersSettings, StubCspProvider, StubWebHostEnvironment |
| 3 | `TracesSampleRatioTests` | MMCA.Common.Aspire.Tests | 1 | Extensions |
| 3 | `ActiveSpec` | MMCA.Common.Benchmarks | 2 | SampleItem, Specification<TEntity, TIdentifierType> |
| 3 | `MinValueSpec` | MMCA.Common.Benchmarks | 2 | SampleItem, Specification<TEntity, TIdentifierType> |
| 3 | `AndSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 3 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 3 | `AuditableBaseEntity<TIdentifierType>` | MMCA.Common.Domain | 5 | BaseEntity<TIdentifierType>, Error, IAuditableEntity, IRowVersioned, Result |
| 3 | `CommonInvariants` | MMCA.Common.Domain | 2 | Error, Result |
| 3 | `IAnonymizable` | MMCA.Common.Domain | 1 | Result |
| 3 | `InlineSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 2 | IBaseEntity<TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 3 | `NotSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 3 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 3 | `OrSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 3 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 3 | `BaseDomainEventTests` | MMCA.Common.Domain.Tests | 1 | TestDomainEvent |
| 3 | `PushNotificationCreatedTests` | MMCA.Common.Domain.Tests | 3 | BaseDomainEvent, IDomainEvent, PushNotificationCreated |
| 3 | `TestEntityChangedEvent` | MMCA.Common.Domain.Tests | 2 | DomainEntityState, EntityChangedEvent<TIdentifierType> |
| 3 | `TestGuidEntityChangedEvent` | MMCA.Common.Domain.Tests | 2 | DomainEntityState, EntityChangedEvent<TIdentifierType> |
| 3 | `TestIntegrationEvent` | MMCA.Common.Domain.Tests | 1 | BaseIntegrationEvent |
| 3 | `GrpcResultExceptionInterceptor` | MMCA.Common.Grpc | 1 | ResultFailureException |
| 3 | `ResultGrpcExtensions` | MMCA.Common.Grpc | 4 | Error, ErrorType, Result, ResultFailureException |
| 3 | `ResultFailureExceptionTests` | MMCA.Common.Grpc.Tests | 2 | Error, ResultFailureException |
| 3 | `ResultGrpcExtensionsTests` | MMCA.Common.Grpc.Tests | 4 | Error, ErrorType, Result, ResultFailureException |
| 3 | `BrokerMessageBus` | MMCA.Common.Infrastructure | 2 | IIntegrationEvent, IMessageBus |
| 3 | `CrossDataSourceDegradeConvention` | MMCA.Common.Infrastructure | 3 | DataSource, DataSourceKey, IEntityDataSourceRegistry |
| 3 | `DataSourceService` | MMCA.Common.Infrastructure | 4 | DataSource, DataSourceKey, IDataSourceService, IEntityDataSourceRegistry |
| 3 | `IDataSourceResolver` | MMCA.Common.Infrastructure | 3 | DataSource, DataSourceKey, PhysicalDataSource |
| 3 | `InProcessMessageBus` | MMCA.Common.Infrastructure | 3 | IDomainEventDispatcher, IIntegrationEvent, IMessageBus |
| 3 | `IntegrationEventConsumer<TEvent>` | MMCA.Common.Infrastructure | 3 | IInboxStore, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent> |
| 3 | `SignalRLiveChannelPublisher` | MMCA.Common.Infrastructure | 2 | ILiveChannelPublisher, NotificationHub |
| 3 | `SignalRPushNotificationSender` | MMCA.Common.Infrastructure | 2 | IPushNotificationSender, NotificationHub |
| 3 | `DbSeederTests` | MMCA.Common.Infrastructure.Tests | 1 | TestableDbSeeder |
| 3 | `DistributedCacheServiceTests` | MMCA.Common.Infrastructure.Tests | 2 | DistributedCacheService, WarningCountingLogger |
| 3 | `EmptyEntityDataSourceRegistry` | MMCA.Common.Infrastructure.Tests | 2 | DataSourceKey, IEntityDataSourceRegistry |
| 3 | `JwtSettingsTests` | MMCA.Common.Infrastructure.Tests | 2 | IJwtSettings, JwtSettings |
| 3 | `MapRegistry` | MMCA.Common.Infrastructure.Tests | 2 | DataSourceKey, IEntityDataSourceRegistry |
| 3 | `NotificationHubTests` | MMCA.Common.Infrastructure.Tests | 2 | NotificationHub, PushNotificationSettings |
| 3 | `OtherIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `OutboxMessageTests` | MMCA.Common.Infrastructure.Tests | 3 | OutboxMessage, TestDomainEvent, TestDomainEventWithData |
| 3 | `OutboxSettingsTests` | MMCA.Common.Infrastructure.Tests | 2 | DataSource, OutboxSettings |
| 3 | `TestDataSourceService` | MMCA.Common.Infrastructure.Tests | 3 | DataSource, DataSourceKey, IDataSourceService |
| 3 | `TestIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 2 | BaseIntegrationEvent, IIntegrationEvent |
| 3 | `TestPhysicalDataSources` | MMCA.Common.Infrastructure.Tests | 3 | DataSource, DataSourceKey, PhysicalDataSource |
| 3 | `TokenServiceTests` | MMCA.Common.Infrastructure.Tests | 3 | JwtSettings, JwtSigningAlgorithm, TokenService |
| 3 | `Address` | MMCA.Common.Shared | 3 | AddressInvariants, Result, ValueObject |
| 3 | `AddressInvariants` | MMCA.Common.Shared | 3 | Address, Error, Result |
| 3 | `Currency` | MMCA.Common.Shared | 4 | CurrencyJsonConverter, Error, Result, ValueObject |
| 3 | `CurrencyJsonConverter` | MMCA.Common.Shared | 1 | Currency |
| 3 | `DateRange` | MMCA.Common.Shared | 3 | Error, Result, ValueObject |
| 3 | `DateTimeRange` | MMCA.Common.Shared | 3 | Error, Result, ValueObject |
| 3 | `EmailInvariants` | MMCA.Common.Shared | 2 | Error, Result |
| 3 | `PhoneNumberInvariants` | MMCA.Common.Shared | 2 | Error, Result |
| 3 | `RoleValue` | MMCA.Common.Shared | 2 | Error, Result |
| 3 | `PermissionRegistryTests` | MMCA.Common.Shared.Tests | 2 | PermissionRegistryBuilder, RoleNames |
| 3 | `ResultJsonConverterFactoryTests` | MMCA.Common.Shared.Tests | 6 | Error, ErrorType, PagedCollectionResult<T>, PaginationMetadata, Result, TestDTO |
| 3 | `ResultTests` | MMCA.Common.Shared.Tests | 2 | Error, Result |
| 3 | `ArchitectureMapBase` | MMCA.Common.Testing.Architecture | 3 | IArchitectureMap, Layer, LayerRef |
| 3 | `ArchitectureRules` | MMCA.Common.Testing.Architecture | 4 | ArchitectureAssert, CrossEntityNavigationFinder, IArchitectureMap, Layer |
| 3 | `ConstructorDependencyCountTestsBase` | MMCA.Common.Testing.Architecture | 1 | IArchitectureMap |
| 3 | `E2ETestBase` | MMCA.Common.Testing.E2E | 5 | AxeOptions, E2ETestCollection, E2ETestConfiguration, PlaywrightFixture, Result |
| 3 | `PingCommandHandler` | MMCA.Common.Testing.Tests | 3 | ICommandHandler<in TCommand, TResult>, PingCommand, Result |
| 3 | `PingQueryHandler` | MMCA.Common.Testing.Tests | 3 | IQueryHandler<in TQuery, TResult>, PingQuery, Result |
| 3 | `HttpTestDoubles` | MMCA.Common.Testing.UI | 4 | FreshApiClientFactory, ITokenStorageService, StubTokenStorageService, UiHttpServiceHarness |
| 3 | `ChildEntityServiceBase` | MMCA.Common.UI | 3 | AuthenticatedServiceBase, ITokenStorageService, ServiceExceptionHelper |
| 3 | `DataGridListPageBase<TDto>` | MMCA.Common.UI | 7 | BreakpointConstants, ErrorMessages, ListPageQueryStateService, ListPageState, ListPageStateService, PersistedGridState, SharedResource |
| 3 | `DeepLinkDispatcher` | MMCA.Common.UI | 2 | DeepLinkRouteEventArgs, IDeepLinkDispatcher |
| 3 | `EntityServiceBase<TEntityDTO, TIdentifierType>` | MMCA.Common.UI | 9 | AuthenticatedServiceBase, BaseLookup<TIdentifierType>, CollectionResult<T>, IBaseDTO<TIdentifierType>, IEntityService<TEntityDTO, TIdentifierType>, ITokenStorageService, PagedCollectionResult<T>, PaginationMetadata, ServiceExceptionHelper |
| 3 | `NotificationBell` | MMCA.Common.UI | 4 | INotificationInboxUIService, NotificationRoutePaths, NotificationState, SharedResource |
| 3 | `NotificationInbox` | MMCA.Common.UI | 5 | ErrorMessages, INotificationInboxUIService, NotificationState, SharedResource, UserNotificationDTO |
| 3 | `NotificationInboxService` | MMCA.Common.UI | 6 | AuthenticatedServiceBase, INotificationInboxUIService, ITokenStorageService, PagedCollectionResult<T>, ServiceExceptionHelper, UserNotificationDTO |
| 3 | `NotificationList` | MMCA.Common.UI | 5 | ErrorMessages, IPushNotificationUIService, NotificationRoutePaths, PushNotificationDTO, SharedResource |
| 3 | `NotificationSend` | MMCA.Common.UI | 6 | ErrorMessages, IPushNotificationUIService, NotificationRoutePaths, PushNotificationDTO, SendPushNotificationRequest, SharedResource |
| 3 | `GalleryUIModule` | MMCA.Common.UI.Gallery | 2 | IUIModule, NavItem |
| 3 | `StubNotificationInboxUIService` | MMCA.Common.UI.Gallery | 4 | INotificationInboxUIService, PagedCollectionResult<T>, PaginationMetadata, UserNotificationDTO |
| 3 | `StubPushNotificationUIService` | MMCA.Common.UI.Gallery | 5 | IPushNotificationUIService, PagedCollectionResult<T>, PaginationMetadata, PushNotificationDTO, SendPushNotificationRequest |
| 3 | `DependencyInjection` | MMCA.Common.UI.Maui | 42 | IAccessibilityAnnouncer, IBatteryStatusService, IBiometricAuthenticator, IClipboardService, IConnectivityStatusService, IDevicePreferences, IExternalAuthBroker, IExternalLinkService, IFormFactor, IGeocodingService, IGeolocationService, IHapticFeedbackService, ILocalCacheStore, ILocalNotificationService, IMapNavigationService, IMediaPickerService, IPushRegistrationService, IScreenshotService, IShareService, ISpeechToTextService …(+22) |
| 3 | `DeviceCapabilitiesInitializer` | MMCA.Common.UI.Maui | 1 | IDeepLinkDispatcher |
| 3 | `BiometricGateTests` | MMCA.Common.UI.Tests | 8 | BunitTestBase, DevicePreferenceKeys, FakeBiometricAuthenticator, FakeDevicePreferences, IBiometricAuthenticator, IDevicePreferences, ITokenStorageService, StubTokenStorageService |
| 3 | `BrandColorTokenTests` | MMCA.Common.UI.Tests | 3 | BrandColors, BrandColorTokenTests, MMCATheme |
| 3 | `CapabilityFallbackTests` | MMCA.Common.UI.Tests | 20 | AlwaysOnlineConnectivityStatusService, GeoPoint, InMemoryDevicePreferences, LocalNotificationRequest, NullAccessibilityAnnouncer, NullBatteryStatusService, NullBiometricAuthenticator, NullClipboardService, NullExternalLinkService, NullGeocodingService, NullGeolocationService, NullHapticFeedbackService, NullLocalCacheStore, NullLocalNotificationService, NullMapNavigationService, NullScreenshotService, NullShareService, NullSpeechToTextService, NullTextToSpeechService, UnavailableExternalAuthBroker |
| 3 | `DeleteConfirmationTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 3 | `DirectApiTokenRefresherTests` | MMCA.Common.UI.Tests | 7 | AuthenticationResponse, DirectApiTokenRefresher, ITokenStorageService, Mocks, Mocks, StubHttpClientFactory, StubHttpMessageHandler |
| 3 | `EmptyStateTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 3 | `ErrorMessagesTests` | MMCA.Common.UI.Tests | 3 | DomainInvariantViolationException, ErrorMessages, OtherDomainException |
| 3 | `ExternalLinkTests` | MMCA.Common.UI.Tests | 4 | BunitTestBase, FakeExternalLinkService, IExternalLinkService, NullExternalLinkService |
| 3 | `ForbiddenTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 3 | `MmcaThemeProvidersTests` | MMCA.Common.UI.Tests | 3 | BunitTestBase, MMCATheme, ThemeService |
| 3 | `MobileCardListTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 3 | `MobileInfiniteScrollListTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, MobileInfiniteScrollList<TItem> |
| 3 | `NotificationHubServiceTests` | MMCA.Common.UI.Tests | 3 | ApiSettings, ITokenStorageService, NotificationHubService |
| 3 | `OfflineBannerTests` | MMCA.Common.UI.Tests | 4 | AlwaysOnlineConnectivityStatusService, BunitTestBase, FakeConnectivityService, IConnectivityStatusService |
| 3 | `PageStateScopeTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 3 | `PrimitivesSnapshotTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, MarkupSnapshot |
| 3 | `PrimitivesTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 3 | `RedirectToLoginTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 3 | `ServiceExceptionHelperTests` | MMCA.Common.UI.Tests | 2 | DomainInvariantViolationException, ServiceExceptionHelper |
| 3 | `StubUiModule` | MMCA.Common.UI.Tests | 2 | IUIModule, NavItem |
| 3 | `UiHttpServiceHarnessTests` | MMCA.Common.UI.Tests | 1 | UiHttpServiceHarness |
| 3 | `UnsavedChangesGuardTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 3 | `WasmTokenStorageServiceTests` | MMCA.Common.UI.Tests | 5 | ISessionCookieSync, ITokenRefresher, Mocks, Mocks, WasmTokenStorageService |
| 4 | `SessionSelectionController` | MMCA.ADC.Conference.API | 16 | ApiControllerBase, CategoryDistributionDTO, ConferencePermissions, ContentSimilarityDTO, GetCategoryDistributionQuery, GetContentSimilarityQuery, GetSessionSelectionDashboardQuery, GetSpeakerSessionOverlapQuery, ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult>, Result, Route, ScoreEventSessionsCommand, ScoreEventSessionsResultDTO, SessionSelectionDashboardDTO, SpeakerSessionOverlapDTO |
| 4 | `SessionCreatedHandler` | MMCA.ADC.Conference.Application | 3 | DomainEntityState, IDomainEventHandler<in TDomainEvent>, SessionChanged |
| 4 | `SpeakerDeletedHandler` | MMCA.ADC.Conference.Application | 5 | DomainEntityState, IDomainEventHandler<in TDomainEvent>, IEventBus, SpeakerChanged, SpeakerUnlinkedFromUser |
| 4 | `RoomChangedHandlerTests` | MMCA.ADC.Conference.Application.Tests | 3 | DomainEntityState, RoomChanged, RoomChangedHandler |
| 4 | `RoomChangedHandlerTests` | MMCA.ADC.Conference.Application.Tests | 3 | DomainEntityState, RoomChanged, RoomChangedHandler |
| 4 | `EventInvariants` | MMCA.ADC.Conference.Domain | 3 | CommonInvariants, Error, Result |
| 4 | `QuestionInvariants` | MMCA.ADC.Conference.Domain | 3 | CommonInvariants, Error, Result |
| 4 | `SessionInvariants` | MMCA.ADC.Conference.Domain | 4 | CommonInvariants, Error, Result, SessionStatuses |
| 4 | `SpeakerInvariants` | MMCA.ADC.Conference.Domain | 2 | CommonInvariants, Result |
| 4 | `SessionizeService` | MMCA.ADC.Conference.Infrastructure | 2 | ISessionizeService, SessionizeResponse |
| 4 | `AnthropicScoringServiceTests` | MMCA.ADC.Conference.Infrastructure.Tests | 5 | AnthropicScoringService, FakeAnthropicHandler, SessionScoringInput, SessionScoringResult, SpeakerInfo |
| 4 | `FakeSessionizeService` | MMCA.ADC.Conference.IntegrationTests | 3 | ISessionizeService, SessionizeResponse, SessionizeSession |
| 4 | `DisabledEventLiveValidationService` | MMCA.ADC.Conference.Shared | 5 | EventLiveInfo, IEventLiveValidationService, QuestionModerationDefault, Result, SessionLiveInfo |
| 4 | `DisabledSessionBookmarkValidationService` | MMCA.ADC.Conference.Shared | 2 | ISessionBookmarkValidationService, Result |
| 4 | `CategoryItemService` | MMCA.ADC.Conference.UI | 4 | CategoryItemDTO, EntityServiceBase<TEntityDTO, TIdentifierType>, ICategoryItemUIService, ITokenStorageService |
| 4 | `ConferenceCategoryCreate` | MMCA.ADC.Conference.UI | 4 | ConferenceCategoryDTO, ConferenceRoutePaths, ErrorMessages, IConferenceCategoryUIService |
| 4 | `ConferenceCategoryList` | MMCA.ADC.Conference.UI | 7 | ConferenceCategoryDTO, ConferenceRoutePaths, DataGridListPageBase<TDto>, ErrorMessages, IConferenceCategoryUIService, ListPageActions, MobileInfiniteScrollList<TItem> |
| 4 | `ConferenceCategoryService` | MMCA.ADC.Conference.UI | 4 | ConferenceCategoryDTO, EntityServiceBase<TEntityDTO, TIdentifierType>, IConferenceCategoryUIService, ITokenStorageService |
| 4 | `EventService` | MMCA.ADC.Conference.UI | 5 | EntityServiceBase<TEntityDTO, TIdentifierType>, EventDTO, IEventUIService, ITokenStorageService, RefreshFromSessionizeResultDTO |
| 4 | `EventSpeakerService` | MMCA.ADC.Conference.UI | 4 | ChildEntityServiceBase, EventSpeakerDTO, IEventSpeakerUIService, ITokenStorageService |
| 4 | `ISessionSelectionUIService` | MMCA.ADC.Conference.UI | 2 | ScoreEventSessionsResultDTO, SessionSelectionDashboardDTO |
| 4 | `PublicSessionListView` | MMCA.ADC.Conference.UI | 8 | BookmarkService, ConferenceRoutePaths, IHapticFeedbackService, ISessionBookmarkUIService, ListPageActions, MobileInfiniteScrollList<TItem>, SessionDTO, SpeakerInfo |
| 4 | `QuestionService` | MMCA.ADC.Conference.UI | 4 | EntityServiceBase<TEntityDTO, TIdentifierType>, IQuestionUIService, ITokenStorageService, QuestionDTO |
| 4 | `RoomService` | MMCA.ADC.Conference.UI | 4 | EntityServiceBase<TEntityDTO, TIdentifierType>, IRoomUIService, ITokenStorageService, RoomDTO |
| 4 | `SessionCategoryItemService` | MMCA.ADC.Conference.UI | 4 | ChildEntityServiceBase, ISessionCategoryItemUIService, ITokenStorageService, SessionCategoryItemDTO |
| 4 | `SessionSelectionAiScores` | MMCA.ADC.Conference.UI | 3 | SessionAiScoreDTO, SessionSelectionDashboardDTO, SessionSelectionDisplay |
| 4 | `SessionService` | MMCA.ADC.Conference.UI | 4 | EntityServiceBase<TEntityDTO, TIdentifierType>, ISessionUIService, ITokenStorageService, SessionDTO |
| 4 | `SessionSpeakerService` | MMCA.ADC.Conference.UI | 4 | ChildEntityServiceBase, ISessionSpeakerUIService, ITokenStorageService, SessionSpeakerDTO |
| 4 | `SpeakerCategoryItemService` | MMCA.ADC.Conference.UI | 4 | ChildEntityServiceBase, ISpeakerCategoryItemUIService, ITokenStorageService, SpeakerCategoryItemDTO |
| 4 | `SpeakerDashboardService` | MMCA.ADC.Conference.UI | 6 | AuthenticatedServiceBase, ISpeakerDashboardUIService, ITokenStorageService, PagedCollectionResult<T>, SessionDTO, SessionFeedbackDTO |
| 4 | `SpeakerService` | MMCA.ADC.Conference.UI | 5 | EntityServiceBase<TEntityDTO, TIdentifierType>, ISpeakerUIService, ITokenStorageService, LinkUserRequest, SpeakerDTO |
| 4 | `AddToCalendarButtonTests` | MMCA.ADC.Conference.UI.Tests | 6 | ApiSettings, BunitTestBase, CapturingHttpMessageHandler, HttpTestDoubles, IExternalLinkService, IShareService |
| 4 | `OrganizerEventFeedbackServiceTests` | MMCA.ADC.Conference.UI.Tests | 7 | CapturingHttpMessageHandler, DomainInvariantViolationException, EventQuestionAnswerDTO, HttpTestDoubles, OrganizerEventFeedbackService, PagedCollectionResult<T>, PaginationMetadata |
| 4 | `OrganizerSessionFeedbackServiceTests` | MMCA.ADC.Conference.UI.Tests | 6 | CapturingHttpMessageHandler, HttpTestDoubles, OrganizerSessionFeedbackService, PagedCollectionResult<T>, PaginationMetadata, SessionQuestionAnswerDTO |
| 4 | `QrCodeButtonTests` | MMCA.ADC.Conference.UI.Tests | 1 | BunitTestBase |
| 4 | `SharePageButtonTests` | MMCA.ADC.Conference.UI.Tests | 3 | BunitTestBase, IClipboardService, IShareService |
| 4 | `AccessibilityTests` | MMCA.ADC.E2E.Tests | 20 | ConferenceCategoryCreatePage, ConferenceCategoryListPage, E2ETestBase, E2ETestCollection, EventCreatePage, EventListPage, HappeningNowPage, PlaywrightFixture, PublicEventListPage, PublicSessionListPage, PublicSpeakerListPage, QuestionCreatePage, QuestionListPage, RoomCreatePage, RoomListPage, SessionCreatePage, SessionListPage, SpeakerCreatePage, SpeakerDashboardPage, SpeakerListPage |
| 4 | `AccountDeletionTests` | MMCA.ADC.E2E.Tests | 4 | E2ETestBase, E2ETestCollection, PlaywrightFixture, ProfilePage |
| 4 | `AttendeeBookmarkTests` | MMCA.ADC.E2E.Tests | 5 | E2ETestBase, E2ETestCollection, PlaywrightFixture, PublicSessionListPage, SessionCreatePage |
| 4 | `AttendeeFeedbackTests` | MMCA.ADC.E2E.Tests | 13 | E2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, EventFeedbackPage, PlaywrightFixture, PublicEventDetailPage, PublicEventListPage, PublicSessionDetailPage, PublicSessionListPage, QuestionCreatePage, SessionCreatePage, SessionFeedbackPage |
| 4 | `LivePollWorkflowTests` | MMCA.ADC.E2E.Tests | 4 | E2ETestBase, E2ETestCollection, HappeningNowPage, PlaywrightFixture |
| 4 | `NotificationTests` | MMCA.ADC.E2E.Tests | 4 | E2ETestBase, E2ETestCollection, E2ETestConfiguration, PlaywrightFixture |
| 4 | `OrganizerCategoryManagementTests` | MMCA.ADC.E2E.Tests | 6 | ConferenceCategoryCreatePage, ConferenceCategoryDetailPage, ConferenceCategoryListPage, E2ETestBase, E2ETestCollection, PlaywrightFixture |
| 4 | `OrganizerEventManagementTests` | MMCA.ADC.E2E.Tests | 6 | E2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, EventListPage, PlaywrightFixture |
| 4 | `OrganizerFeedbackAnalyticsTests` | MMCA.ADC.E2E.Tests | 12 | E2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, EventFeedbackPage, OrganizerEventFeedbackPage, OrganizerSessionFeedbackPage, PlaywrightFixture, PublicEventDetailPage, PublicEventListPage, SessionCreatePage, SessionDetailPage |
| 4 | `OrganizerQuestionManagementTests` | MMCA.ADC.E2E.Tests | 6 | E2ETestBase, E2ETestCollection, PlaywrightFixture, QuestionCreatePage, QuestionDetailPage, QuestionListPage |
| 4 | `OrganizerRelationshipManagementTests` | MMCA.ADC.E2E.Tests | 9 | ConferenceCategoryCreatePage, ConferenceCategoryDetailPage, E2ETestBase, E2ETestCollection, EventCreatePage, PlaywrightFixture, SessionCreatePage, SessionDetailPage, SpeakerCreatePage |
| 4 | `OrganizerRoomManagementTests` | MMCA.ADC.E2E.Tests | 7 | E2ETestBase, E2ETestCollection, EventCreatePage, PlaywrightFixture, RoomCreatePage, RoomDetailPage, RoomListPage |
| 4 | `OrganizerSessionManagementTests` | MMCA.ADC.E2E.Tests | 7 | E2ETestBase, E2ETestCollection, EventCreatePage, PlaywrightFixture, SessionCreatePage, SessionDetailPage, SessionListPage |
| 4 | `OrganizerSpeakerManagementTests` | MMCA.ADC.E2E.Tests | 8 | ConferenceCategoryCreatePage, ConferenceCategoryDetailPage, E2ETestBase, E2ETestCollection, PlaywrightFixture, SpeakerCreatePage, SpeakerDetailPage, SpeakerListPage |
| 4 | `ProfileManagementTests` | MMCA.ADC.E2E.Tests | 4 | E2ETestBase, E2ETestCollection, PlaywrightFixture, ProfilePage |
| 4 | `PseudoLocalizationTests` | MMCA.ADC.E2E.Tests | 3 | E2ETestBase, E2ETestCollection, PlaywrightFixture |
| 4 | `PublicBrowseTests` | MMCA.ADC.E2E.Tests | 11 | E2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, PlaywrightFixture, PublicEventDetailPage, PublicEventListPage, PublicSessionListPage, PublicSpeakerDetailPage, PublicSpeakerListPage, SpeakerCreatePage |
| 4 | `SessionSelectionDashboardTests` | MMCA.ADC.E2E.Tests | 3 | E2ETestBase, E2ETestCollection, PlaywrightFixture |
| 4 | `SpeakerDashboardTests` | MMCA.ADC.E2E.Tests | 4 | E2ETestBase, E2ETestCollection, PlaywrightFixture, SpeakerDashboardPage |
| 4 | `SpeakerSelfServiceTests` | MMCA.ADC.E2E.Tests | 7 | E2ETestBase, E2ETestCollection, PlaywrightFixture, SessionCreatePage, SessionDetailPage, SpeakerCreatePage, SpeakerDashboardPage |
| 4 | `UserManagementTests` | MMCA.ADC.E2E.Tests | 4 | E2ETestBase, E2ETestCollection, PlaywrightFixture, UserListPage |
| 4 | `WebVitalsTests` | MMCA.ADC.E2E.Tests | 4 | E2ETestBase, E2ETestCollection, PlaywrightFixture, WebVitalsCollector |
| 4 | `EngagementModule` | MMCA.ADC.Engagement.API | 6 | ApplicationSettings, DisabledBookmarkCountService, DisabledUserEngagementExportService, IBookmarkCountService, IModule, IUserEngagementExportService |
| 4 | `SessionQuestionsController` | MMCA.ADC.Engagement.API | 18 | ApiControllerBase, AuthorizationPolicies, EngagementFeatures, Error, GetModerationQueueQuery, GetSessionQuestionsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, ModerateQuestionCommand, ModerationAction, Result, RoleNames, Route, SessionQuestionDTO, SubmitQuestionCommand, SubmitQuestionRequest, ToggleUpvoteCommand |
| 4 | `LivePollInvariants` | MMCA.ADC.Engagement.Domain | 3 | CommonInvariants, Error, Result |
| 4 | `LivePollVoteInvariants` | MMCA.ADC.Engagement.Domain | 2 | CommonInvariants, Result |
| 4 | `SessionQuestionInvariants` | MMCA.ADC.Engagement.Domain | 3 | CommonInvariants, Error, Result |
| 4 | `SessionQuestionUpvoteInvariants` | MMCA.ADC.Engagement.Domain | 2 | CommonInvariants, Result |
| 4 | `UserSessionBookmarkInvariants` | MMCA.ADC.Engagement.Domain | 2 | CommonInvariants, Result |
| 4 | `DependencyInjection` | MMCA.ADC.Engagement.Infrastructure | 1 | LiveChannelPublishProcessor |
| 4 | `LiveChannelPublishProcessorTests` | MMCA.ADC.Engagement.Infrastructure.Tests | 5 | ILiveChannelPublisher, LiveChannelPublishProcessor, LiveChannelPublishQueue, LiveChannelPublishWorkItem, RecordingPublisher |
| 4 | `FakeEventLiveValidationService` | MMCA.ADC.Engagement.IntegrationTests | 6 | Error, EventLiveInfo, IEventLiveValidationService, QuestionModerationDefault, Result, SessionLiveInfo |
| 4 | `FakeSessionBookmarkValidationService` | MMCA.ADC.Engagement.IntegrationTests | 3 | Error, ISessionBookmarkValidationService, Result |
| 4 | `BookmarkServiceTests` | MMCA.ADC.Engagement.UI.Tests | 8 | BookmarkService, CapturingHttpMessageHandler, CreateBookmarkRequest, DomainInvariantViolationException, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, UserSessionBookmarkDTO |
| 4 | `EventFeedbackServiceTests` | MMCA.ADC.Engagement.UI.Tests | 7 | CapturingHttpMessageHandler, DomainInvariantViolationException, EventFeedbackService, EventQuestionAnswerDTO, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata |
| 4 | `QuestionLookupServiceTests` | MMCA.ADC.Engagement.UI.Tests | 6 | CapturingHttpMessageHandler, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, QuestionDTO, QuestionLookupService |
| 4 | `SessionBookmarkUIServiceTests` | MMCA.ADC.Engagement.UI.Tests | 9 | CapturingHttpMessageHandler, HttpTestDoubles, ILiveEventUIService, InMemoryDevicePreferences, ISessionLookupService, NullLocalNotificationService, SessionBookmarkUIService, SessionReminderCoordinator, UserSessionBookmarkDTO |
| 4 | `SessionFeedbackServiceTests` | MMCA.ADC.Engagement.UI.Tests | 7 | CapturingHttpMessageHandler, DomainInvariantViolationException, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, SessionFeedbackService, SessionQuestionAnswerDTO |
| 4 | `SessionLookupServiceTests` | MMCA.ADC.Engagement.UI.Tests | 7 | CapturingHttpMessageHandler, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, SessionDTO, SessionInfo, SessionLookupService |
| 4 | `SessionQuestionUIServiceTests` | MMCA.ADC.Engagement.UI.Tests | 6 | CapturingHttpMessageHandler, HttpTestDoubles, QuestionStatus, SessionQuestionDTO, SessionQuestionUIService, SubmitQuestionRequest |
| 4 | `UserClaimsController` | MMCA.ADC.Identity.API | 2 | ApiControllerBase, Route |
| 4 | `IdentityModuleTests` | MMCA.ADC.Identity.API.Tests | 2 | IdentityModule, IModule |
| 4 | `UserRole` | MMCA.ADC.Identity.Domain | 4 | Error, Result, RoleNames, RoleValue |
| 4 | `DependencyInjection` | MMCA.ADC.Identity.UI | 5 | IdentityUIModule, IEntityService<TEntityDTO, TIdentifierType>, IUIModule, IUserUIService, UserService |
| 4 | `UserList` | MMCA.ADC.Identity.UI | 6 | DataGridListPageBase<TDto>, IUserUIService, ListPageActions, MobileInfiniteScrollList<TItem>, UserListDTO, UserService |
| 4 | `NotificationModuleTests` | MMCA.ADC.Notification.API.Tests | 3 | DisabledUserNotificationExportService, IUserNotificationExportService, NotificationModule |
| 4 | `TestSupport` | MMCA.ADC.Notification.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, BaseEntity<TIdentifierType> |
| 4 | `ServiceBusRoundTripSmokeTests` | MMCA.ADC.ServiceBusEmulator.IntegrationTests | 4 | ServiceBusEmulatorCollection, ServiceBusEmulatorFixture, SpeakerLinkedToUser, UserRegistered |
| 4 | `NowNextWidgetProvider` | MMCA.ADC.UI | 3 | MainActivity, NowNextSession, NowNextSnapshot |
| 4 | `CookieSessionRefresher` | MMCA.Common.API | 7 | AuthenticationResponse, CookieTokenReader, ICookieSessionRefresher, RefreshTokenRequest, SessionCookieEndpoints, SessionCookieJar, SessionTokenResult |
| 4 | `CurrencyJsonConverter` | MMCA.Common.API | 1 | Currency |
| 4 | `DevicesController` | MMCA.Common.API | 8 | ApiControllerBase, DeviceInstallationRequest, Error, ICurrentUserService, IPushDeviceRegistrar, NotificationFeatures, Result, Route |
| 4 | `InboxController` | MMCA.Common.API | 15 | ApiControllerBase, AuthorizationPolicies, Error, GetMyNotificationsQuery, GetUnreadNotificationCountQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, MarkAllNotificationsReadCommand, MarkNotificationReadCommand, NotificationFeatures, PagedCollectionResult<T>, Result, Route, UserNotificationDTO |
| 4 | `NotificationsController` | MMCA.Common.API | 14 | ApiControllerBase, AuthorizationPolicies, Error, GetNotificationHistoryQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, NotificationFeatures, PagedCollectionResult<T>, PushNotificationDTO, Result, Route, SendPushNotificationCommand, SendPushNotificationRequest |
| 4 | `SessionCookieAuthenticationHandler` | MMCA.Common.API | 1 | CookieTokenReader |
| 4 | `WebApplicationExtensions` | MMCA.Common.API | 4 | CorrelationIdMiddleware, SoftDeletedUserMiddleware, SupportedCultures, WebApplicationBuilderExtensions |
| 4 | `CookieSessionRefreshMiddlewareTests` | MMCA.Common.API.Tests | 5 | CookieSessionRefreshMiddleware, CookieSessionRefreshMiddlewareExtensions, ICookieSessionRefresher, NextDelegateSpy, SessionTokenResult |
| 4 | `CookieTokenReaderTests` | MMCA.Common.API.Tests | 2 | CookieTokenReader, SessionCookieEndpoints |
| 4 | `CurrencyJsonConverterTests` | MMCA.Common.API.Tests | 1 | Currency |
| 4 | `DependencyInjectionTests` | MMCA.Common.API.Tests | 11 | DbUpdateExceptionHandler, DisabledFeatureHandler, DomainExceptionHandler, GlobalExceptionHandler, IdempotencyFilter, IdempotencySettings, IModule, ModuleLoader, OperationCanceledExceptionHandler, OwnerOrAdminFilter, ValidationExceptionHandler |
| 4 | `RateLimitPartitionTests` | MMCA.Common.API.Tests | 1 | WebApplicationBuilderExtensions |
| 4 | `TestApiController` | MMCA.Common.API.Tests | 2 | ApiControllerBase, Error |
| 4 | `TestController` | MMCA.Common.API.Tests | 2 | ApiControllerBase, Error |
| 4 | `TestEntity` | MMCA.Common.API.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestOwnerSpecification` | MMCA.Common.API.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 4 | `UnhandledResultFailureFilterTests` | MMCA.Common.API.Tests | 3 | Error, Result, UnhandledResultFailureFilter |
| 4 | `WebApplicationBuilderExtensionsTests` | MMCA.Common.API.Tests | 1 | WebApplicationBuilderExtensions |
| 4 | `AddressLine1Rules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `AddressLine2Rules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `CityRules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `CountryRules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `FeatureGateCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 4 | Error, ICommandHandler<in TCommand, TResult>, IFeatureGated, ResultFailureFactory |
| 4 | `FeatureGateQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 4 | Error, IFeatureGated, IQueryHandler<in TQuery, TResult>, ResultFailureFactory |
| 4 | `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.Application | 2 | AuditableBaseEntity<TIdentifierType>, IBaseDTO<TIdentifierType> |
| 4 | `IEntityQuerier<TEntity, TIdentifierType>` | MMCA.Common.Application | 2 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType> |
| 4 | `IEntityQueryPipeline` | MMCA.Common.Application | 3 | AuditableBaseEntity<TIdentifierType>, EntityQueryParameters<TEntity>, NavigationMetadata |
| 4 | `IEntityReader<TEntity, TIdentifierType>` | MMCA.Common.Application | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` | MMCA.Common.Application | 3 | AuditableBaseEntity<TIdentifierType>, ICreateRequest, Result |
| 4 | `INavigationMetadataProvider` | MMCA.Common.Application | 1 | NavigationMetadata |
| 4 | `INavigationPopulator<in TEntity>` | MMCA.Common.Application | 1 | NavigationMetadata |
| 4 | `IWriteRepository<TEntity, TIdentifierType>` | MMCA.Common.Application | 2 | AuditableBaseEntity<TIdentifierType>, IRowVersioned |
| 4 | `StateRules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `ValidatingCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 3 | Error, ICommandHandler<in TCommand, TResult>, ResultFailureFactory |
| 4 | `ZipCodeRules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `BoolFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 4 | `CachingCommandDecoratorTests` | MMCA.Common.Application.Tests | 7 | CacheInvalidatingTestCommand, CachingCommandDecorator<TCommand, TResult>, Error, ICacheService, ICommandHandler<in TCommand, TResult>, PlainTestCommand, Result |
| 4 | `CachingQueryDecoratorTests` | MMCA.Common.Application.Tests | 8 | CacheableTestQuery, CachingQueryDecorator<TQuery, TResult>, Error, ICacheService, IQueryHandler<in TQuery, TResult>, NonCacheableTestQuery, Result, StampedeTestQuery |
| 4 | `ChildA` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ChildB` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ChildC` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ChildD` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `CqrsMetricsTests` | MMCA.Common.Application.Tests | 10 | CapturedMeasurement, CqrsMetricsProbeCommand, CqrsMetricsProbeQuery, Error, ICommandHandler<in TCommand, TResult>, ICorrelationContext, IQueryHandler<in TQuery, TResult>, LoggingCommandDecorator<TCommand, TResult>, LoggingQueryDecorator<TQuery, TResult>, Result |
| 4 | `DateTimeFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 4 | `DecimalFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 4 | `Dependent` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FakeEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `GuidFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 4 | `IntFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 4 | `LongFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 4 | `Mocks` | MMCA.Common.Application.Tests | 8 | ICommandHandler<in TCommand, TResult>, ICorrelationContext, IQueryHandler<in TQuery, TResult>, LoggingCommandDecorator<TCommand, TResult>, LoggingQueryDecorator<TQuery, TResult>, Result, TestLoggingCommand, TestLoggingQuery |
| 4 | `ModuleLoaderTests` | MMCA.Common.Application.Tests | 10 | ApplicationSettings, FakeCycleModuleOne, FakeCycleModuleTwo, FakeModuleTracker, FakeRemoteContractRealAdapter, FakeRemoteContractStub, IFakeRemoteContract, ModuleLoader, ModuleSettings, ModulesSettings |
| 4 | `NavigationMetadataTests` | MMCA.Common.Application.Tests | 3 | NavigationMetadata, NavigationPropertyInfo, NavigationType |
| 4 | `NavigationPopulatorStubEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `NoNavEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `OrderLineEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ParentEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `Principal` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `QueryFieldServiceTests` | MMCA.Common.Application.Tests | 2 | ProductDto, QueryFieldService |
| 4 | `QueryFilterServiceTests` | MMCA.Common.Application.Tests | 3 | Product, QueryFilterService, TestStrategy |
| 4 | `QueryFilterServiceValidateTests` | MMCA.Common.Application.Tests | 2 | Product, QueryFilterService |
| 4 | `RelatedA` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RelatedB` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RelatedC` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RelatedEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ResultFailureFactoryTests` | MMCA.Common.Application.Tests | 3 | Error, LoggingCommandDecorator<TCommand, TResult>, Result |
| 4 | `SafeDomainEventHandlerTests` | MMCA.Common.Application.Tests | 2 | TestSafeDomainEvent, TestSafeDomainEventHandler |
| 4 | `StringFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 4 | `StubChild` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `StubEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `StubParent` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestDomainEventHandlerForIntegration` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, TestIntegrationEvent |
| 4 | `TestEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestIntegrationEventDomainHandler` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, TestIntegrationEvent |
| 4 | `TestIntegrationEventHandler` | MMCA.Common.Application.Tests | 2 | IIntegrationEventHandler<in TIntegrationEvent>, TestIntegrationEvent |
| 4 | `TestReadEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FitnessPrincipal` | MMCA.Common.Architecture.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `SpecificationBenchmarks` | MMCA.Common.Benchmarks | 5 | ActiveSpec, AndSpecification<TEntity, TIdentifierType>, MinValueSpec, OrSpecification<TEntity, TIdentifierType>, SampleItem |
| 4 | `AuditableAggregateRootEntity<TIdentifierType>` | MMCA.Common.Domain | 6 | AuditableBaseEntity<TIdentifierType>, Error, IAggregateRoot, IAuditableEntity, IDomainEvent, Result |
| 4 | `PushNotificationInvariants` | MMCA.Common.Domain | 2 | CommonInvariants, Result |
| 4 | `BaseIntegrationEventTests` | MMCA.Common.Domain.Tests | 2 | IIntegrationEvent, TestIntegrationEvent |
| 4 | `ChildEntity` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `CommonInvariantsTests` | MMCA.Common.Domain.Tests | 3 | CommonInvariants, ErrorType, Result |
| 4 | `EntityChangedEventTests` | MMCA.Common.Domain.Tests | 3 | DomainEntityState, TestEntityChangedEvent, TestGuidEntityChangedEvent |
| 4 | `EntityWithGeneratedId` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `EntityWithoutGeneratedId` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestEntity` | MMCA.Common.Domain.Tests | 2 | AuditableBaseEntity<TIdentifierType>, BaseEntity<TIdentifierType> |
| 4 | `TestEntity` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `UndeletableEntity` | MMCA.Common.Domain.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Result |
| 4 | `DependencyInjection` | MMCA.Common.Grpc | 3 | GrpcResultExceptionInterceptor, HttpResilienceDefaults, JwtForwardingClientInterceptor |
| 4 | `DependencyInjectionTests` | MMCA.Common.Grpc.Tests | 3 | FakeClient, GrpcResultExceptionInterceptor, JwtForwardingClientInterceptor |
| 4 | `AzureBlobFileStorageService` | MMCA.Common.Infrastructure | 3 | Error, IFileStorageService, Result |
| 4 | `AzureNotificationHubDeviceRegistrar` | MMCA.Common.Infrastructure | 5 | DeviceInstallationRequest, Error, IPushDeviceRegistrar, NativePushPayloads, Result |
| 4 | `DataSourceResolver` | MMCA.Common.Infrastructure | 7 | DataSource, DataSourceEntrySettings, DataSourceKey, DataSourcesSettings, IConnectionStringSettings, IDataSourceResolver, PhysicalDataSource |
| 4 | `IEntityTypeConfigurationBase<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ImageSharpImageProcessor` | MMCA.Common.Infrastructure | 3 | Error, IImageProcessor, Result |
| 4 | `IntegrationEventConsumerExtensions` | MMCA.Common.Infrastructure | 2 | IIntegrationEvent, IntegrationEventConsumer<TEvent> |
| 4 | `LoginProtectionService` | MMCA.Common.Infrastructure | 5 | Error, ICacheService, ILoginProtectionService, LoginProtectionSettings, Result |
| 4 | `NullFileStorageService` | MMCA.Common.Infrastructure | 3 | Error, IFileStorageService, Result |
| 4 | `NullPushDeviceRegistrar` | MMCA.Common.Infrastructure | 3 | DeviceInstallationRequest, IPushDeviceRegistrar, Result |
| 4 | `DataSourceServiceAdditionalTests` | MMCA.Common.Infrastructure.Tests | 6 | DataSource, DataSourceKey, DataSourceService, FakeEntity, IEntityDataSourceRegistry, UnregisteredEntity |
| 4 | `DataSourceServiceTests` | MMCA.Common.Infrastructure.Tests | 5 | DataSource, DataSourceKey, DataSourceService, FakeEntity, IEntityDataSourceRegistry |
| 4 | `DependencyInjectionPushNotificationsTests` | MMCA.Common.Infrastructure.Tests | 6 | ILiveChannelPublisher, IPushNotificationSender, IPushNotificationSettings, PushNotificationSettings, SignalRLiveChannelPublisher, SignalRPushNotificationSender |
| 4 | `FakeEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FilteredIndexEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `IntegrationEventConsumerTests` | MMCA.Common.Infrastructure.Tests | 4 | IInboxStore, IIntegrationEventHandler<in TIntegrationEvent>, IntegrationEventConsumer<TEvent>, TestIntegrationEvent |
| 4 | `RecordingDomainHandler` | MMCA.Common.Infrastructure.Tests | 2 | IDomainEventHandler<in TDomainEvent>, TestIntegrationEvent |
| 4 | `RecordingIntegrationHandler` | MMCA.Common.Infrastructure.Tests | 2 | IIntegrationEventHandler<in TIntegrationEvent>, TestIntegrationEvent |
| 4 | `RegistryUnattributed` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `SignalRLiveChannelPublisherTests` | MMCA.Common.Infrastructure.Tests | 2 | NotificationHub, SignalRLiveChannelPublisher |
| 4 | `SignalRPushNotificationSenderAdditionalTests` | MMCA.Common.Infrastructure.Tests | 2 | NotificationHub, SignalRPushNotificationSender |
| 4 | `SignalRPushNotificationSenderTests` | MMCA.Common.Infrastructure.Tests | 2 | NotificationHub, SignalRPushNotificationSender |
| 4 | `SoftDeletableEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestAuditEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestChildEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestMappedEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestNonAggregateEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `UniqueNamedEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `Email` | MMCA.Common.Shared | 3 | EmailInvariants, Result, ValueObject |
| 4 | `Money` | MMCA.Common.Shared | 4 | Currency, Error, Result, ValueObject |
| 4 | `PhoneNumber` | MMCA.Common.Shared | 3 | PhoneNumberInvariants, Result, ValueObject |
| 4 | `RegisterRequest` | MMCA.Common.Shared | 1 | Address |
| 4 | `AddressInvariantsTests` | MMCA.Common.Shared.Tests | 2 | Address, AddressInvariants |
| 4 | `AddressTests` | MMCA.Common.Shared.Tests | 1 | Address |
| 4 | `CurrencyJsonConverterTests` | MMCA.Common.Shared.Tests | 1 | Currency |
| 4 | `CurrencyTests` | MMCA.Common.Shared.Tests | 1 | Currency |
| 4 | `DateRangeTests` | MMCA.Common.Shared.Tests | 1 | DateRange |
| 4 | `DateTimeRangeTests` | MMCA.Common.Shared.Tests | 1 | DateTimeRange |
| 4 | `AggregateConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `ConcurrencyConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `ControllerConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `DataResidencyTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureMapBase, IArchitectureMap |
| 4 | `DependencyVersionTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 4 | `DomainPurityTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `EntityConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `EventConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `FormsConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureMapBase, IArchitectureMap |
| 4 | `FrameworkVersionConsistencyTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureMapBase, IArchitectureMap |
| 4 | `HandlerConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `HandlerResultConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `ImmutabilityTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `IntegrationEventContractTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `LayerDependencyTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureRules, IArchitectureMap, Layer |
| 4 | `LocalizationResourceTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 4 | `LocalizedTextConventionTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureMapBase, ArchitectureRules, IArchitectureMap |
| 4 | `MicroserviceExtractionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `ModuleIsolationTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `NamingConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `PiiConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `RawQueryableConventionTestsBase` | MMCA.Common.Testing.Architecture | 4 | ArchitectureAssert, ArchitectureMapBase, IArchitectureMap, Layer |
| 4 | `SharedLayerTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `SliceCohesionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `SpecificationConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 4 | `StateManagementConventionTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureMapBase, IArchitectureMap, Layer |
| 4 | `UIArchitectureConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureMapBase, IArchitectureMap |
| 4 | `AuthorizationTestsBase` | MMCA.Common.Testing.E2E | 2 | E2ETestBase, PlaywrightFixture |
| 4 | `LogoutTestsBase` | MMCA.Common.Testing.E2E | 2 | E2ETestBase, PlaywrightFixture |
| 4 | `ProfileManagementTestsBase` | MMCA.Common.Testing.E2E | 4 | AxeOptions, E2ETestBase, PlaywrightFixture, ProfilePage |
| 4 | `UserLoginTestsBase` | MMCA.Common.Testing.E2E | 4 | AxeOptions, E2ETestBase, LoginPage, PlaywrightFixture |
| 4 | `UserPreferencesTestsBase` | MMCA.Common.Testing.E2E | 2 | E2ETestBase, PlaywrightFixture |
| 4 | `UserRegistrationTestsBase` | MMCA.Common.Testing.E2E | 4 | AxeOptions, E2ETestBase, PlaywrightFixture, RegisterPage |
| 4 | `TestChildEntity` | MMCA.Common.Testing.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `DependencyInjection` | MMCA.Common.UI | 53 | AlwaysOnlineConnectivityStatusService, BrowserAccessibilityAnnouncer, BrowserClipboardService, BrowserConnectivityStatusService, BrowserDevicePreferences, BrowserExternalLinkService, BrowserLocalCacheStore, BrowserMapNavigationService, BrowserShareService, CapabilitiesJsModule, DeepLinkDispatcher, IAccessibilityAnnouncer, IBatteryStatusService, IBiometricAuthenticator, IClipboardService, IConnectivityStatusService, IDeepLinkDispatcher, IDevicePreferences, IExternalAuthBroker, IExternalLinkService …(+33) |
| 4 | `NotificationUIModule` | MMCA.Common.UI | 6 | IUIModule, NavItem, NavSection, NotificationBell, NotificationRoutePaths, RoleNames |
| 4 | `PushNotificationService` | MMCA.Common.UI | 6 | EntityServiceBase<TEntityDTO, TIdentifierType>, IPushNotificationUIService, ITokenStorageService, PagedCollectionResult<T>, PushNotificationDTO, SendPushNotificationRequest |
| 4 | `HostingDependencyInjection` | MMCA.Common.UI.Maui | 1 | DeviceCapabilitiesInitializer |
| 4 | `DeepLinkDispatcherTests` | MMCA.Common.UI.Tests | 2 | DeepLinkDispatcher, DeepLinkRouteEventArgs |
| 4 | `DeepLinkListenerTests` | MMCA.Common.UI.Tests | 3 | BunitTestBase, DeepLinkDispatcher, IDeepLinkDispatcher |
| 4 | `MembershipService` | MMCA.Common.UI.Tests | 2 | ChildEntityServiceBase, ITokenStorageService |
| 4 | `NotificationBellTests` | MMCA.Common.UI.Tests | 4 | BunitTestBase, INotificationInboxUIService, NotificationBell, NotificationState |
| 4 | `NotificationInboxServiceTests` | MMCA.Common.UI.Tests | 10 | DomainInvariantViolationException, ITokenStorageService, Mocks, Mocks, NotificationInboxService, PagedCollectionResult<T>, PaginationMetadata, StubHttpClientFactory, StubHttpMessageHandler, UserNotificationDTO |
| 4 | `NotificationInboxTests` | MMCA.Common.UI.Tests | 7 | BunitTestBase, INotificationInboxUIService, NotificationInbox, NotificationState, PagedCollectionResult<T>, PaginationMetadata, UserNotificationDTO |
| 4 | `NotificationListTests` | MMCA.Common.UI.Tests | 6 | BunitTestBase, IPushNotificationUIService, NotificationList, PagedCollectionResult<T>, PaginationMetadata, PushNotificationDTO |
| 4 | `NotificationSendTests` | MMCA.Common.UI.Tests | 5 | BunitTestBase, IPushNotificationUIService, NotificationSend, PushNotificationDTO, SendPushNotificationRequest |
| 4 | `SharedHttpTestDoublesTests` | MMCA.Common.UI.Tests | 3 | CapturingHttpMessageHandler, HttpTestDoubles, UiHttpServiceHarness |
| 4 | `TestGridPage` | MMCA.Common.UI.Tests | 2 | DataGridListPageBase<TDto>, WidgetRow |
| 4 | `WidgetService` | MMCA.Common.UI.Tests | 3 | EntityServiceBase<TEntityDTO, TIdentifierType>, ITokenStorageService, WidgetDto |
| 4 | `ServerTokenStorageService` | MMCA.Common.UI.Web | 5 | CookieTokenReader, ISessionCookieSync, ITokenRefresher, ITokenStorageService, JwtTokenInfo |
| 5 | `TranslationCompletenessTests` | MMCA.ADC.Architecture.Tests | 1 | LocalizationResourceTestsBase |
| 5 | `ConferenceModule` | MMCA.ADC.Conference.API | 6 | ApplicationSettings, DisabledEventLiveValidationService, DisabledSessionBookmarkValidationService, IEventLiveValidationService, IModule, ISessionBookmarkValidationService |
| 5 | `SessionSelectionControllerTests` | MMCA.ADC.Conference.API.Tests | 20 | CategoryDistributionDTO, CategoryGroupDistribution, CategoryItemDistribution, ContentSimilarityDTO, Error, GetCategoryDistributionQuery, GetContentSimilarityQuery, GetSessionSelectionDashboardQuery, GetSpeakerSessionOverlapQuery, ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult>, MultiSessionSpeaker, Result, ScoreEventSessionsCommand, ScoreEventSessionsResultDTO, SessionSelectionController, SessionSelectionDashboardDTO, SimilarSessionPair, SpeakerSessionOverlapDTO, SpeakerSessionSummary |
| 5 | `EventNameRules<T>` | MMCA.ADC.Conference.Application | 2 | EventInvariants, RequiredStringRules<T> |
| 5 | `EventTimeZoneRules<T>` | MMCA.ADC.Conference.Application | 1 | EventInvariants |
| 5 | `QuestionTextRules<T>` | MMCA.ADC.Conference.Application | 1 | QuestionInvariants |
| 5 | `RoomAccessibilityInfoRules<T>` | MMCA.ADC.Conference.Application | 1 | EventInvariants |
| 5 | `RoomFloorRules<T>` | MMCA.ADC.Conference.Application | 1 | EventInvariants |
| 5 | `RoomLocationRules<T>` | MMCA.ADC.Conference.Application | 1 | EventInvariants |
| 5 | `RoomNameRules<T>` | MMCA.ADC.Conference.Application | 1 | EventInvariants |
| 5 | `SessionAccessibilityInfoRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 5 | `SessionDescriptionRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 5 | `SessionLiveUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 5 | `SessionRecordingUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 5 | `SessionResourceLinksRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 5 | `SessionStatusRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 5 | `SessionTitleRules<T>` | MMCA.ADC.Conference.Application | 2 | RequiredStringRules<T>, SessionInvariants |
| 5 | `SpeakerFirstNameRules<T>` | MMCA.ADC.Conference.Application | 2 | RequiredStringRules<T>, SpeakerInvariants |
| 5 | `SpeakerLastNameRules<T>` | MMCA.ADC.Conference.Application | 2 | RequiredStringRules<T>, SpeakerInvariants |
| 5 | `Mocks` | MMCA.ADC.Conference.Application.Tests | 2 | IEventBus, SpeakerDeletedHandler |
| 5 | `SessionCreatedHandlerTests` | MMCA.ADC.Conference.Application.Tests | 3 | DomainEntityState, SessionChanged, SessionCreatedHandler |
| 5 | `SessionCreatedHandlerTests` | MMCA.ADC.Conference.Application.Tests | 3 | DomainEntityState, SessionChanged, SessionCreatedHandler |
| 5 | `Category` | MMCA.ADC.Conference.Domain | 7 | AuditableAggregateRootEntity<TIdentifierType>, CategoryChanged, CategoryInvariants, CategoryItem, CategoryItemChanged, DomainEntityState, Result |
| 5 | `CategoryInvariants` | MMCA.ADC.Conference.Domain | 4 | CategoryItem, CommonInvariants, Error, Result |
| 5 | `CategoryItem` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, Category, CategoryInvariants, Result |
| 5 | `Event` | MMCA.ADC.Conference.Domain | 13 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Error, EventChanged, EventInvariants, EventQuestionAnswer, EventQuestionAnswerChanged, EventSpeaker, EventSpeakerChanged, QuestionModerationDefault, Result, Room, RoomChanged |
| 5 | `EventQuestionAnswer` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, Event, EventInvariants, Result |
| 5 | `EventSpeaker` | MMCA.ADC.Conference.Domain | 3 | AuditableBaseEntity<TIdentifierType>, Event, Result |
| 5 | `Question` | MMCA.ADC.Conference.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, QuestionChanged, QuestionInvariants, Result |
| 5 | `Room` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, Event, EventInvariants, Result |
| 5 | `SessionAiScore` | MMCA.ADC.Conference.Domain | 3 | AuditableAggregateRootEntity<TIdentifierType>, Error, Result |
| 5 | `Speaker` | MMCA.ADC.Conference.Domain | 11 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Email, Error, Result, SpeakerCategoryItem, SpeakerCategoryItemChanged, SpeakerChanged, SpeakerInvariants, SpeakerQuestionAnswer, SpeakerQuestionAnswerChanged |
| 5 | `SpeakerCategoryItem` | MMCA.ADC.Conference.Domain | 3 | AuditableBaseEntity<TIdentifierType>, Result, Speaker |
| 5 | `SpeakerQuestionAnswer` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, Result, Speaker, SpeakerInvariants |
| 5 | `EventInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | EventInvariants |
| 5 | `QuestionInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | QuestionInvariants |
| 5 | `SessionInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | SessionInvariants |
| 5 | `SpeakerInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | SpeakerInvariants |
| 5 | `DependencyInjection` | MMCA.ADC.Conference.Infrastructure | 4 | AnthropicScoringService, IAiScoringService, ISessionizeService, SessionizeService |
| 5 | `DisabledEventLiveValidationServiceTests` | MMCA.ADC.Conference.Shared.Tests | 2 | DisabledEventLiveValidationService, QuestionModerationDefault |
| 5 | `SpeakerDTOTests` | MMCA.ADC.Conference.Shared.Tests | 2 | Email, SpeakerDTO |
| 5 | `EventCreate` | MMCA.ADC.Conference.UI | 5 | ConferenceRoutePaths, ErrorMessages, EventDTO, EventService, IEventUIService |
| 5 | `EventList` | MMCA.ADC.Conference.UI | 8 | ConferenceRoutePaths, DataGridListPageBase<TDto>, ErrorMessages, EventDTO, EventService, IEventUIService, ListPageActions, MobileInfiniteScrollList<TItem> |
| 5 | `OrganizerEventFeedback` | MMCA.ADC.Conference.UI | 8 | ConferenceRoutePaths, EventLookupService, EventQuestionAnswerDTO, IEventLookupService, IOrganizerEventFeedbackUIService, IQuestionUIService, QuestionDTO, QuestionService |
| 5 | `OrganizerSessionFeedback` | MMCA.ADC.Conference.UI | 8 | ConferenceRoutePaths, IOrganizerSessionFeedbackUIService, IQuestionUIService, ISessionUIService, QuestionDTO, QuestionService, SessionQuestionAnswerDTO, SessionService |
| 5 | `PublicEventList` | MMCA.ADC.Conference.UI | 7 | ConferenceRoutePaths, DataGridListPageBase<TDto>, EventDTO, EventService, IEventUIService, ListPageActions, MobileInfiniteScrollList<TItem> |
| 5 | `QuestionCreate` | MMCA.ADC.Conference.UI | 5 | ConferenceRoutePaths, ErrorMessages, IQuestionUIService, QuestionDTO, QuestionService |
| 5 | `QuestionList` | MMCA.ADC.Conference.UI | 8 | ConferenceRoutePaths, DataGridListPageBase<TDto>, ErrorMessages, IQuestionUIService, ListPageActions, MobileInfiniteScrollList<TItem>, QuestionDTO, QuestionService |
| 5 | `RoomCreate` | MMCA.ADC.Conference.UI | 8 | ConferenceRoutePaths, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IRoomUIService, RoomDTO, RoomService |
| 5 | `SessionCreate` | MMCA.ADC.Conference.UI | 11 | ConferenceRoutePaths, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IRoomUIService, ISessionUIService, RoomDTO, RoomService, SessionDTO, SessionService |
| 5 | `SessionSelectionService` | MMCA.ADC.Conference.UI | 5 | AuthenticatedServiceBase, ISessionSelectionUIService, ITokenStorageService, ScoreEventSessionsResultDTO, SessionSelectionDashboardDTO |
| 5 | `SpeakerCreate` | MMCA.ADC.Conference.UI | 6 | ConferenceRoutePaths, Email, ErrorMessages, ISpeakerUIService, SpeakerDTO, SpeakerService |
| 5 | `EventServiceTests` | MMCA.ADC.Conference.UI.Tests | 5 | CapturingHttpMessageHandler, DomainInvariantViolationException, EventService, HttpTestDoubles, RefreshFromSessionizeResultDTO |
| 5 | `SessionSelectionAiScoresTests` | MMCA.ADC.Conference.UI.Tests | 6 | BunitTestBase, CategoryDistributionDTO, SessionAiScoreDTO, SessionSelectionAiScores, SessionSelectionDashboardDTO, SpeakerSessionOverlapDTO |
| 5 | `AuthorizationTests` | MMCA.ADC.E2E.Tests | 2 | AuthorizationTestsBase, PlaywrightFixture |
| 5 | `LogoutTests` | MMCA.ADC.E2E.Tests | 2 | LogoutTestsBase, PlaywrightFixture |
| 5 | `UserLoginTests` | MMCA.ADC.E2E.Tests | 2 | PlaywrightFixture, UserLoginTestsBase |
| 5 | `UserPreferencesTests` | MMCA.ADC.E2E.Tests | 2 | PlaywrightFixture, UserPreferencesTestsBase |
| 5 | `UserRegistrationTests` | MMCA.ADC.E2E.Tests | 2 | PlaywrightFixture, UserRegistrationTestsBase |
| 5 | `CreateLivePollRequestValidator` | MMCA.ADC.Engagement.Application | 2 | CreateLivePollRequest, LivePollInvariants |
| 5 | `SubmitQuestionCommandValidator` | MMCA.ADC.Engagement.Application | 2 | SessionQuestionInvariants, SubmitQuestionCommand |
| 5 | `LivePollVote` | MMCA.ADC.Engagement.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, LivePollVoteChanged, LivePollVoteInvariants, Result |
| 5 | `SessionQuestion` | MMCA.ADC.Engagement.Domain | 7 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Error, QuestionStatus, Result, SessionQuestionChanged, SessionQuestionInvariants |
| 5 | `SessionQuestionUpvote` | MMCA.ADC.Engagement.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Result, SessionQuestionUpvoteChanged, SessionQuestionUpvoteInvariants |
| 5 | `UserSessionBookmark` | MMCA.ADC.Engagement.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Result, UserSessionBookmarkChanged, UserSessionBookmarkInvariants |
| 5 | `PresenterView` | MMCA.ADC.Engagement.UI | 12 | ILivePollUIService, ISessionLookupService, ISessionQuestionUIService, LivePollChannel, LivePollResultsDTO, NotificationHubService, QuestionService, QuestionStatus, SessionInfo, SessionQuestionChannel, SessionQuestionDTO, SessionQuestionUpvoteChangedPayload |
| 5 | `SessionFeedback` | MMCA.ADC.Engagement.UI | 8 | AnswerState, IEntityService<TEntityDTO, TIdentifierType>, IQuestionLookupService, ISessionFeedbackUIService, QuestionDTO, SessionDTO, SessionQuestionAnswerDTO, SessionService |
| 5 | `SessionLive` | MMCA.ADC.Engagement.UI | 14 | EngagementRoutePaths, ILivePollUIService, ISessionLookupService, ISessionQuestionUIService, LivePollChannel, LivePollDTO, LivePollResultsDTO, NotificationHubService, QuestionService, RoleNames, SessionInfo, SessionQuestionChannel, SessionQuestionDTO, SessionQuestionUpvoteChangedPayload |
| 5 | `SessionLiveQuestionPanel` | MMCA.ADC.Engagement.UI | 7 | ErrorMessages, ISessionQuestionUIService, ISpeechToTextService, QuestionService, QuestionStatus, SessionQuestionDTO, SubmitQuestionRequest |
| 5 | `UserClaimsControllerTests` | MMCA.ADC.Identity.API.Tests | 1 | UserClaimsController |
| 5 | `UserInvariants` | MMCA.ADC.Identity.Domain | 5 | CommonInvariants, Error, Result, SupportedCultures, UserRole |
| 5 | `UserDTOTests` | MMCA.ADC.Identity.Shared.Tests | 2 | Email, UserDTO |
| 5 | `UserListDTOTests` | MMCA.ADC.Identity.Shared.Tests | 2 | Email, UserListDTO |
| 5 | `UserServiceTests` | MMCA.ADC.Identity.UI.Tests | 8 | CapturingHttpMessageHandler, DomainInvariantViolationException, Email, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, UserListDTO, UserService |
| 5 | `DependencyInjection` | MMCA.Common.API | 21 | CookieSessionRefresher, CookieTokenReader, CurrencyJsonConverter, DbUpdateExceptionHandler, DisabledFeatureHandler, DomainExceptionHandler, ErrorLocalizer, ErrorResources, ErrorResourceSource, GlobalExceptionHandler, ICookieSessionRefresher, IdempotencyFilter, IdempotencySettings, IErrorLocalizer, ModuleControllerFeatureProvider, ModuleLoader, ModulesSettings, OperationCanceledExceptionHandler, OwnerOrAdminFilter, UnhandledResultFailureFilter …(+1) |
| 5 | `DependencyInjection` | MMCA.Common.API | 1 | NotificationsController |
| 5 | `SessionCookieAuthenticationExtensions` | MMCA.Common.API | 1 | SessionCookieAuthenticationHandler |
| 5 | `ApiControllerBaseTests` | MMCA.Common.API.Tests | 2 | Error, TestApiController |
| 5 | `DevicesControllerTests` | MMCA.Common.API.Tests | 6 | DeviceInstallationRequest, DevicesController, Error, ICurrentUserService, IPushDeviceRegistrar, Result |
| 5 | `EdgeErrorLocalizationTests` | MMCA.Common.API.Tests | 4 | Error, IErrorLocalizer, StubErrorLocalizer, TestController |
| 5 | `InitTestWidget` | MMCA.Common.API.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `NotificationInboxControllerTests` | MMCA.Common.API.Tests | 13 | Error, GetMyNotificationsQuery, GetUnreadNotificationCountQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, InboxController, IQueryHandler<in TQuery, TResult>, MarkAllNotificationsReadCommand, MarkNotificationReadCommand, PagedCollectionResult<T>, PaginationMetadata, Result, UserNotificationDTO |
| 5 | `NotificationsControllerTests` | MMCA.Common.API.Tests | 12 | Error, GetNotificationHistoryQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, NotificationsController, PagedCollectionResult<T>, PaginationMetadata, PushNotificationDTO, Result, SendPushNotificationCommand, SendPushNotificationRequest |
| 5 | `OwnershipHelperTests` | MMCA.Common.API.Tests | 3 | ICurrentUserService, OwnershipHelper, TestOwnerSpecification |
| 5 | `RefresherHarness` | MMCA.Common.API.Tests | 3 | CookieSessionRefresher, StubHttpClientFactory, StubHttpMessageHandler |
| 5 | `SessionCookieAuthenticationHandlerTests` | MMCA.Common.API.Tests | 4 | CookieTokenReader, FakeTimeProvider, SessionCookieAuthenticationHandler, SessionCookieEndpoints |
| 5 | `TestAggregateEntity` | MMCA.Common.API.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `AddressValidator` | MMCA.Common.Application | 7 | Address, AddressLine1Rules<T>, AddressLine2Rules<T>, CityRules<T>, CountryRules<T>, StateRules<T>, ZipCodeRules<T> |
| 5 | `AuthenticationValidators` | MMCA.Common.Application | 3 | LoginRequest, RefreshTokenRequest, RegisterRequest |
| 5 | `EntityQueryPipeline` | MMCA.Common.Application | 8 | AuditableBaseEntity<TIdentifierType>, EntityQueryParameters<TEntity>, IEntityQueryPipeline, IQueryableExecutor, NavigationMetadata, NavigationType, QueryFieldService, QueryFilterService |
| 5 | `IAuthenticationService` | MMCA.Common.Application | 6 | AuthenticationResponse, Error, LoginRequest, RefreshTokenRequest, RegisterRequest, Result |
| 5 | `IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.Application | 7 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IBaseDTO<TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, Result, Specification<TEntity, TIdentifierType> |
| 5 | `IReadRepository<TEntity, TIdentifierType>` | MMCA.Common.Application | 3 | AuditableBaseEntity<TIdentifierType>, IEntityQuerier<TEntity, TIdentifierType>, IEntityReader<TEntity, TIdentifierType> |
| 5 | `NavigationMetadataProvider` | MMCA.Common.Application | 6 | IDataSourceService, INavigationMetadataProvider, NavigationAttribute, NavigationMetadata, NavigationPropertyInfo, NavigationType |
| 5 | `NullNavigationPopulator<TEntity>` | MMCA.Common.Application | 2 | INavigationPopulator<in TEntity>, NavigationMetadata |
| 5 | `SendPushNotificationRequestValidator` | MMCA.Common.Application | 2 | PushNotificationInvariants, SendPushNotificationRequest |
| 5 | `DomainEventDispatcherAdditionalTests` | MMCA.Common.Application.Tests | 9 | DomainEventDispatcher, IDomainEventHandler<in TDomainEvent>, IIntegrationEventHandler<in TIntegrationEvent>, MultiHandlerEvent, MultiHandlerEventHandler1, MultiHandlerEventHandler2, TestDomainEventHandlerForIntegration, TestIntegrationEvent, TestIntegrationEventHandler |
| 5 | `DomainEventDispatcherTests` | MMCA.Common.Application.Tests | 8 | DomainEventDispatcher, IDomainEventHandler<in TDomainEvent>, IIntegrationEventHandler<in TIntegrationEvent>, TestEvent, TestEventHandler, TestIntegrationEvent, TestIntegrationEventDomainHandler, TestIntegrationEventHandler |
| 5 | `EntityQueryParametersTests` | MMCA.Common.Application.Tests | 2 | EntityQueryParameters<TEntity>, TestEntity |
| 5 | `FeatureGateCommandDecoratorTests` | MMCA.Common.Application.Tests | 6 | FeatureGateCommandDecorator<TCommand, TResult>, FeatureGatedCommand, FeatureGatedCommandWithValue, ICommandHandler<in TCommand, TResult>, PlainCommand, Result |
| 5 | `FeatureGateQueryDecoratorTests` | MMCA.Common.Application.Tests | 6 | FeatureGatedQuery, FeatureGatedQueryNonGeneric, FeatureGateQueryDecorator<TQuery, TResult>, IQueryHandler<in TQuery, TResult>, PlainQuery, Result |
| 5 | `LoggingCommandDecoratorTests` | MMCA.Common.Application.Tests | 7 | Error, ICommandHandler<in TCommand, TResult>, ICorrelationContext, LoggingCommandDecorator<TCommand, TResult>, Mocks, Result, TestLoggingCommand |
| 5 | `LoggingQueryDecoratorTests` | MMCA.Common.Application.Tests | 6 | ICorrelationContext, IQueryHandler<in TQuery, TResult>, LoggingQueryDecorator<TQuery, TResult>, Mocks, Result, TestLoggingQuery |
| 5 | `MixedEntity` | MMCA.Common.Application.Tests | 3 | AuditableBaseEntity<TIdentifierType>, ChildC, RelatedC |
| 5 | `OrderEntity` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, OrderLineEntity |
| 5 | `ReadOnlyCollectionEntity` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, ChildD |
| 5 | `SupportedChild` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, ChildA |
| 5 | `SupportedFK` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, RelatedA |
| 5 | `TestAggregateEntity` | MMCA.Common.Application.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestAuthUser` | MMCA.Common.Application.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, IAuthUser |
| 5 | `UnsupportedChild` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, ChildB |
| 5 | `UnsupportedFK` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, RelatedB |
| 5 | `ValidatingCommandDecoratorTests` | MMCA.Common.Application.Tests | 4 | ICommandHandler<in TCommand, TResult>, Result, TestValidatingCommand, ValidatingCommandDecorator<TCommand, TResult> |
| 5 | `DataSubjectSample` | MMCA.Common.Architecture.Tests | 3 | Email, IAnonymizable, Result |
| 5 | `DependencyVersionTests` | MMCA.Common.Architecture.Tests | 1 | DependencyVersionTestsBase |
| 5 | `FitnessDependent` | MMCA.Common.Architecture.Tests | 2 | AuditableBaseEntity<TIdentifierType>, FitnessPrincipal |
| 5 | `LocalizationResourceTests` | MMCA.Common.Architecture.Tests | 2 | LocalizationResourceTestsBase, SupportedCultures |
| 5 | `PushNotification` | MMCA.Common.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, PushNotificationCreated, PushNotificationInvariants, PushNotificationStatus, Result |
| 5 | `UserNotification` | MMCA.Common.Domain | 2 | AuditableAggregateRootEntity<TIdentifierType>, Result |
| 5 | `AgeGreaterThanSpec` | MMCA.Common.Domain.Tests | 2 | Specification<TEntity, TIdentifierType>, TestEntity |
| 5 | `AgeRangeSpec` | MMCA.Common.Domain.Tests | 2 | Specification<TEntity, TIdentifierType>, TestEntity |
| 5 | `AuditableBaseEntityAdditionalTests` | MMCA.Common.Domain.Tests | 1 | UndeletableEntity |
| 5 | `AuditableBaseEntityTests` | MMCA.Common.Domain.Tests | 1 | TestEntity |
| 5 | `BaseEntityTests` | MMCA.Common.Domain.Tests | 5 | BaseEntity<TIdentifierType>, GuidIdEntity, IBaseEntity<TIdentifierType>, StringIdEntity, TestEntity |
| 5 | `EntityTypeExtensionsTests` | MMCA.Common.Domain.Tests | 2 | EntityWithGeneratedId, EntityWithoutGeneratedId |
| 5 | `NameEqualsSpec` | MMCA.Common.Domain.Tests | 2 | Specification<TEntity, TIdentifierType>, TestEntity |
| 5 | `NameStartsWithSpec` | MMCA.Common.Domain.Tests | 2 | Specification<TEntity, TIdentifierType>, TestEntity |
| 5 | `PushNotificationInvariantsTests` | MMCA.Common.Domain.Tests | 2 | PushNotificationInvariants, Result |
| 5 | `TestAggregate` | MMCA.Common.Domain.Tests | 3 | AuditableAggregateRootEntity<TIdentifierType>, ChildEntity, Result |
| 5 | `ValidatingAggregate` | MMCA.Common.Domain.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, ChildEntity |
| 5 | `EntityDataSourceRegistry` | MMCA.Common.Infrastructure | 10 | DataSource, DataSourceKey, IDataSourceResolver, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IEntityTypeConfigurationBase<TEntity, TIdentifierType>, NamespaceConventions, Snapshot, UseDatabaseAttribute, UseDataSourceAttribute |
| 5 | `EntityTypeConfigurationBase<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 4 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IAggregateRoot, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 2 | AuditableBaseEntity<TIdentifierType>, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 2 | AuditableBaseEntity<TIdentifierType>, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 2 | AuditableBaseEntity<TIdentifierType>, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `DataSourceResolverTests` | MMCA.Common.Infrastructure.Tests | 6 | ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceKey, DataSourceResolver, DataSourcesSettings |
| 5 | `DegradeCustomer` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, DegradeOrder |
| 5 | `DegradeOrder` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, DegradeCustomer |
| 5 | `DesignAlphaEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `DesignBetaEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `FakeAggregate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `FakeAggregateEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `ImageSharpImageProcessorTests` | MMCA.Common.Infrastructure.Tests | 1 | ImageSharpImageProcessor |
| 5 | `LoginProtectionServiceTests` | MMCA.Common.Infrastructure.Tests | 5 | ErrorType, FakeCacheService, LoginProtectionService, LoginProtectionSettings, Result |
| 5 | `MultiSourceCustomer` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `PortablePrincipal` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RegistryDuplicate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RegistryInvoice` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RegistryOrder` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RegistrySqlServerEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `SqliteTestEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestAggregate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestAggregateEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestEntity` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType> |
| 5 | `EmailTests` | MMCA.Common.Shared.Tests | 1 | Email |
| 5 | `MoneyTests` | MMCA.Common.Shared.Tests | 2 | Currency, Money |
| 5 | `PhoneNumberTests` | MMCA.Common.Shared.Tests | 1 | PhoneNumber |
| 5 | `ValueObjectTests` | MMCA.Common.Shared.Tests | 7 | Address, Currency, DateRange, DateTimeRange, Money, TestValueObject, ValueObject |
| 5 | `TestAggregate` | MMCA.Common.Testing.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `DependencyInjection` | MMCA.Common.UI | 8 | INotificationInboxUIService, IPushNotificationUIService, IUIModule, NotificationHubService, NotificationInboxService, NotificationState, NotificationUIModule, PushNotificationService |
| 5 | `IAuthUIService` | MMCA.Common.UI | 3 | AuthenticationResponse, LoginRequest, RegisterRequest |
| 5 | `MoneyExtensions` | MMCA.Common.UI | 1 | Money |
| 5 | `AuthModelValidationTests` | MMCA.Common.UI.Tests | 3 | Email, LoginModel, RegisterModel |
| 5 | `ChildEntityServiceBaseTests` | MMCA.Common.UI.Tests | 6 | DomainInvariantViolationException, ITokenStorageService, MembershipService, Mocks, StubHttpClientFactory, StubHttpMessageHandler |
| 5 | `DataGridListPageBaseTests` | MMCA.Common.UI.Tests | 5 | BunitTestBase, ListPageQueryStateService, ListPageStateService, TestGridPage, WidgetRow |
| 5 | `EntityServiceBaseTests` | MMCA.Common.UI.Tests | 11 | BaseLookup<TIdentifierType>, CollectionResult<T>, DomainInvariantViolationException, ITokenStorageService, Mocks, PagedCollectionResult<T>, PaginationMetadata, StubHttpClientFactory, StubHttpMessageHandler, WidgetDto, WidgetService |
| 5 | `MoneyExtensionsTests` | MMCA.Common.UI.Tests | 2 | Currency, Money |
| 5 | `PseudoLocalizationTests` | MMCA.Common.UI.Tests | 7 | FakeStringLocalizer, FakeStringLocalizerFactory, PseudoLocalizationTests, PseudoLocalizer, PseudoStringLocalizer, PseudoStringLocalizerFactory, SupportedCultures |
| 5 | `PushNotificationServiceTests` | MMCA.Common.UI.Tests | 10 | ITokenStorageService, Mocks, Mocks, PagedCollectionResult<T>, PaginationMetadata, PushNotificationDTO, PushNotificationService, SendPushNotificationRequest, StubHttpClientFactory, StubHttpMessageHandler |
| 5 | `DependencyInjection` | MMCA.Common.UI.Web | 6 | BlazorCspPolicyProvider, ICspPolicyProvider, IFormFactor, ITokenStorageService, ServerTokenStorageService, WebFormFactor |
| 5 | `ServerTokenStorageServiceTests` | MMCA.Common.UI.Web.Tests | 6 | CookieTokenReader, ISessionCookieSync, ITokenRefresher, Mocks, ServerTokenStorageService, SessionCookieEndpoints |
| 5 | `WebFormFactorTests` | MMCA.Common.UI.Web.Tests | 5 | ICspPolicyProvider, IFormFactor, ITokenStorageService, ServerTokenStorageService, WebFormFactor |
| 6 | `AddCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | Category, ICacheInvalidating |
| 6 | `AddEventQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `AddEventSpeakerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `AddRoomCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `AddSpeakerCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Speaker |
| 6 | `CategoryItemDTOMapper` | MMCA.ADC.Conference.Application | 3 | CategoryItem, CategoryItemDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 6 | `CategoryItemNameRules<T>` | MMCA.ADC.Conference.Application | 1 | CategoryInvariants |
| 6 | `ConferenceCategoryCreateRequest` | MMCA.ADC.Conference.Application | 3 | Category, ICacheInvalidating, ICreateRequest |
| 6 | `ConferenceCategoryTitleRules<T>` | MMCA.ADC.Conference.Application | 1 | CategoryInvariants |
| 6 | `EventCreateRequest` | MMCA.ADC.Conference.Application | 3 | Event, ICacheInvalidating, ICreateRequest |
| 6 | `EventQuestionAnswerDTOMapper` | MMCA.ADC.Conference.Application | 3 | EventQuestionAnswer, EventQuestionAnswerDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 6 | `EventSpeakerDTOMapper` | MMCA.ADC.Conference.Application | 3 | EventSpeaker, EventSpeakerDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 6 | `EventUpdateRequestValidator` | MMCA.ADC.Conference.Application | 4 | EventDateRangeRules<T>, EventNameRules<T>, EventTimeZoneRules<T>, EventUpdateRequest |
| 6 | `LinkUserToSpeakerCommand` | MMCA.ADC.Conference.Application | 3 | ICacheInvalidating, ITransactional, Speaker |
| 6 | `OwnEventQuestionAnswerSpecification` | MMCA.ADC.Conference.Application | 2 | EventQuestionAnswer, Specification<TEntity, TIdentifierType> |
| 6 | `PublishedEventSpecification` | MMCA.ADC.Conference.Application | 2 | Event, Specification<TEntity, TIdentifierType> |
| 6 | `PublishEventCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `QuestionCreateRequest` | MMCA.ADC.Conference.Application | 3 | ICacheInvalidating, ICreateRequest, Question |
| 6 | `QuestionDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, Question, QuestionDTO |
| 6 | `QuestionUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | QuestionTextRules<T>, QuestionUpdateRequest |
| 6 | `RefreshFromSessionizeCommand` | MMCA.ADC.Conference.Application | 5 | ConferenceFeatures, Event, ICacheInvalidating, IFeatureGated, ITransactional |
| 6 | `RemoveCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | Category, ICacheInvalidating |
| 6 | `RemoveEventQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `RemoveEventSpeakerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `RemoveRoomCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `RemoveSpeakerCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Speaker |
| 6 | `RoomDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, Room, RoomDTO |
| 6 | `SessionUpdateRequestValidator` | MMCA.ADC.Conference.Application | 8 | SessionAccessibilityInfoRules<T>, SessionDescriptionRules<T>, SessionLiveUrlRules<T>, SessionRecordingUrlRules<T>, SessionResourceLinksRules<T>, SessionStatusRules<T>, SessionTitleRules<T>, SessionUpdateRequest |
| 6 | `SpeakerCategoryItemDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SpeakerCategoryItem, SpeakerCategoryItemDTO |
| 6 | `SpeakerCreateRequest` | MMCA.ADC.Conference.Application | 3 | ICacheInvalidating, ICreateRequest, Speaker |
| 6 | `SpeakerLocalityHelper` | MMCA.ADC.Conference.Application | 2 | Category, Speaker |
| 6 | `SpeakerQuestionAnswerDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SpeakerQuestionAnswer, SpeakerQuestionAnswerDTO |
| 6 | `SpeakerUpdateRequestValidator` | MMCA.ADC.Conference.Application | 3 | SpeakerFirstNameRules<T>, SpeakerLastNameRules<T>, SpeakerUpdateRequest |
| 6 | `UnlinkUserFromSpeakerCommand` | MMCA.ADC.Conference.Application | 3 | ICacheInvalidating, ITransactional, Speaker |
| 6 | `UnpublishEventCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `UpdateCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | Category, ICacheInvalidating |
| 6 | `UpdateConferenceCategoryCommand` | MMCA.ADC.Conference.Application | 4 | Category, ConferenceCategoryUpdateRequest, ICacheInvalidating, ICommandWithRequest<out TRequest> |
| 6 | `UpdateEventCommand` | MMCA.ADC.Conference.Application | 4 | Event, EventUpdateRequest, ICacheInvalidating, ICommandWithRequest<out TRequest> |
| 6 | `UpdateEventQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `UpdateQuestionCommand` | MMCA.ADC.Conference.Application | 4 | ICacheInvalidating, ICommandWithRequest<out TRequest>, Question, QuestionUpdateRequest |
| 6 | `UpdateRoomCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 6 | `UpdateSpeakerCommand` | MMCA.ADC.Conference.Application | 4 | ICacheInvalidating, ICommandWithRequest<out TRequest>, Speaker, SpeakerUpdateRequest |
| 6 | `SpeakerDeletedHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | DomainEntityState, IEventBus, IIntegrationEvent, Mocks, SpeakerChanged, SpeakerDeletedHandler, SpeakerUnlinkedFromUser |
| 6 | `TestEventValidator` | MMCA.ADC.Conference.Application.Tests | 4 | EventDateRangeRules<T>, EventNameRules<T>, EventTimeZoneRules<T>, TestEventModel |
| 6 | `TestQuestionTextValidator` | MMCA.ADC.Conference.Application.Tests | 2 | QuestionTextRules<T>, TestQuestionModel |
| 6 | `TestRoomValidator` | MMCA.ADC.Conference.Application.Tests | 7 | RoomAccessibilityInfoRules<T>, RoomCapacityRules<T>, RoomFloorRules<T>, RoomLocationRules<T>, RoomNameRules<T>, RoomSortRules<T>, TestRoomModel |
| 6 | `TestSessionValidator` | MMCA.ADC.Conference.Application.Tests | 3 | SessionEventIdRules<T>, SessionTitleRules<T>, TestSessionModel |
| 6 | `TestSpeakerValidator` | MMCA.ADC.Conference.Application.Tests | 3 | SpeakerFirstNameRules<T>, SpeakerLastNameRules<T>, TestSpeakerModel |
| 6 | `Session` | MMCA.ADC.Conference.Domain | 14 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Error, Event, Result, Room, SessionCategoryItem, SessionCategoryItemChanged, SessionChanged, SessionInvariants, SessionQuestionAnswer, SessionQuestionAnswerChanged, SessionSpeaker, SessionSpeakerChanged |
| 6 | `SessionCategoryItem` | MMCA.ADC.Conference.Domain | 3 | AuditableBaseEntity<TIdentifierType>, Result, Session |
| 6 | `SessionQuestionAnswer` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, Result, Session, SessionInvariants |
| 6 | `SessionSpeaker` | MMCA.ADC.Conference.Domain | 3 | AuditableBaseEntity<TIdentifierType>, Result, Session |
| 6 | `CategoryInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 2 | Category, CategoryInvariants |
| 6 | `CategoryTests` | MMCA.ADC.Conference.Domain.Tests | 3 | Category, CategoryChanged, DomainEntityState |
| 6 | `EventBuilder` | MMCA.ADC.Conference.Domain.Tests | 2 | EntityBuilderBase<TBuilder, TEntity>, Event |
| 6 | `EventQuestionAnswerTests` | MMCA.ADC.Conference.Domain.Tests | 6 | DomainEntityState, ErrorType, Event, EventInvariants, EventQuestionAnswer, EventQuestionAnswerChanged |
| 6 | `EventSpeakerTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, ErrorType, Event, EventSpeaker, EventSpeakerChanged |
| 6 | `EventTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, Event, EventChanged, QuestionModerationDefault, RoomChanged |
| 6 | `QuestionTests` | MMCA.ADC.Conference.Domain.Tests | 1 | Question |
| 6 | `SessionAiScoreTests` | MMCA.ADC.Conference.Domain.Tests | 1 | SessionAiScore |
| 6 | `SpeakerBuilder` | MMCA.ADC.Conference.Domain.Tests | 2 | EntityBuilderBase<TBuilder, TEntity>, Speaker |
| 6 | `SpeakerCategoryItemTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, ErrorType, Speaker, SpeakerCategoryItem, SpeakerCategoryItemChanged |
| 6 | `SpeakerQuestionAnswerTests` | MMCA.ADC.Conference.Domain.Tests | 6 | DomainEntityState, ErrorType, Speaker, SpeakerInvariants, SpeakerQuestionAnswer, SpeakerQuestionAnswerChanged |
| 6 | `SpeakerTests` | MMCA.ADC.Conference.Domain.Tests | 3 | DomainEntityState, Speaker, SpeakerChanged |
| 6 | `SessionizeServiceTests` | MMCA.ADC.Conference.Infrastructure.Tests | 6 | Question, SessionizeCategory, SessionizeQuestion, SessionizeResponse, SessionizeRoom, SessionizeService |
| 6 | `CurrentEventSelector` | MMCA.ADC.Conference.Shared | 1 | Event |
| 6 | `ConferenceCategoryDetail` | MMCA.ADC.Conference.UI | 8 | Category, CategoryItemDTO, CategoryItemService, ConferenceCategoryDTO, ConferenceRoutePaths, ErrorMessages, ICategoryItemUIService, IConferenceCategoryUIService |
| 6 | `DependencyInjection` | MMCA.ADC.Conference.UI | 27 | CategoryItemLookupService, ConferenceUIModule, EventLookupService, EventSpeakerService, ICategoryItemLookupService, IEntityService<TEntityDTO, TIdentifierType>, IEventLookupService, IEventSpeakerUIService, IOrganizerEventFeedbackUIService, IOrganizerSessionFeedbackUIService, IPublicLinkBuilder, ISessionCategoryItemUIService, ISessionSelectionUIService, ISessionSpeakerUIService, ISpeakerCategoryItemUIService, ISpeakerDashboardUIService, ISpeakerLookupService, IUIModule, NavigationPublicLinkBuilder, OrganizerEventFeedbackService …(+7) |
| 6 | `EventDetail` | MMCA.ADC.Conference.UI | 8 | ConferenceRoutePaths, ErrorMessages, Event, EventDTO, EventService, IEventUIService, QuestionModerationDefault, RefreshFromSessionizeResultDTO |
| 6 | `PublicEventDetail` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, Event, EventDTO, EventService, IClipboardService, IEventUIService, IGeocodingService, IGeolocationService, IMapNavigationService |
| 6 | `PublicSpeakerDetail` | MMCA.ADC.Conference.UI | 8 | ConferenceRoutePaths, ISessionUIService, ISpeakerUIService, SessionDTO, SessionService, Speaker, SpeakerDTO, SpeakerService |
| 6 | `QuestionDetail` | MMCA.ADC.Conference.UI | 6 | ConferenceRoutePaths, ErrorMessages, IQuestionUIService, Question, QuestionDTO, QuestionService |
| 6 | `RoomDetail` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IRoomUIService, Room, RoomDTO, RoomService |
| 6 | `SpeakerCategoryItemsPanel` | MMCA.ADC.Conference.UI | 6 | CategoryItemInfo, ISpeakerCategoryItemUIService, Speaker, SpeakerCategoryItemDTO, SpeakerCategoryItemService, SpeakerDTO |
| 6 | `SpeakerDetail` | MMCA.ADC.Conference.UI | 19 | CategoryItemInfo, CategoryItemLookupService, ConferenceRoutePaths, Email, ErrorMessages, ICategoryItemLookupService, IConferenceCategoryUIService, IQuestionUIService, ISessionUIService, ISpeakerUIService, IUserUIService, QuestionService, SessionDTO, SessionService, Speaker, SpeakerDTO, SpeakerService, UserListDTO, UserService |
| 6 | `EventCreateTests` | MMCA.ADC.Conference.UI.Tests | 4 | BunitTestBase, EventCreate, EventDTO, IEventUIService |
| 6 | `OrganizerEventFeedbackTests` | MMCA.ADC.Conference.UI.Tests | 9 | BunitTestBase, EventInfo, EventQuestionAnswerDTO, IEventLookupService, IOrganizerEventFeedbackUIService, IQuestionUIService, OrganizerEventFeedback, Question, QuestionDTO |
| 6 | `OrganizerSessionFeedbackTests` | MMCA.ADC.Conference.UI.Tests | 8 | BunitTestBase, IOrganizerSessionFeedbackUIService, IQuestionUIService, ISessionUIService, OrganizerSessionFeedback, QuestionDTO, SessionDTO, SessionQuestionAnswerDTO |
| 6 | `QuestionCreateTests` | MMCA.ADC.Conference.UI.Tests | 4 | BunitTestBase, IQuestionUIService, QuestionCreate, QuestionDTO |
| 6 | `SessionSelectionServiceTests` | MMCA.ADC.Conference.UI.Tests | 8 | CapturingHttpMessageHandler, CategoryDistributionDTO, HttpTestDoubles, ScoreEventSessionsResultDTO, SessionSelectionDashboardDTO, SessionSelectionService, SpeakerLocalitySummary, SpeakerSessionOverlapDTO |
| 6 | `SessionSelectionSpeakerOverlapTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, MultiSessionSpeaker, SessionSelectionSpeakerOverlap, Speaker, SpeakerSessionSummary |
| 6 | `BookmarksController` | MMCA.ADC.Engagement.API | 19 | ApiControllerBase, AuthorizationPolicies, CreateBookmarkRequest, DeleteEntityCommand<TEntity, TIdentifierType>, EngagementFeatures, Error, GetBookmarkedSessionIdsQuery, GetUserBookmarksQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, OwnerOrAdminFilter, PagedCollectionResult<T>, Result, RoleNames, Route, UserSessionBookmark, UserSessionBookmarkDTO |
| 6 | `CreateLivePollCommandValidator` | MMCA.ADC.Engagement.Application | 2 | CreateLivePollCommand, CreateLivePollRequestValidator |
| 6 | `UserSessionBookmarkDTOMapper` | MMCA.ADC.Engagement.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, UserSessionBookmark, UserSessionBookmarkDTO |
| 6 | `IBookmarkManagementDomainService` | MMCA.ADC.Engagement.Domain | 2 | Result, UserSessionBookmark |
| 6 | `LivePoll` | MMCA.ADC.Engagement.Domain | 9 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Error, LivePollChanged, LivePollInvariants, LivePollOption, LivePollStatus, Question, Result |
| 6 | `LivePollOption` | MMCA.ADC.Engagement.Domain | 4 | AuditableBaseEntity<TIdentifierType>, LivePoll, LivePollInvariants, Result |
| 6 | `LivePollVoteTests` | MMCA.ADC.Engagement.Domain.Tests | 3 | DomainEntityState, LivePollVote, LivePollVoteChanged |
| 6 | `SessionQuestionTests` | MMCA.ADC.Engagement.Domain.Tests | 5 | DomainEntityState, QuestionStatus, SessionQuestion, SessionQuestionChanged, SessionQuestionInvariants |
| 6 | `SessionQuestionUpvoteTests` | MMCA.ADC.Engagement.Domain.Tests | 3 | DomainEntityState, SessionQuestionUpvote, SessionQuestionUpvoteChanged |
| 6 | `UserSessionBookmarkTests` | MMCA.ADC.Engagement.Domain.Tests | 3 | DomainEntityState, UserSessionBookmark, UserSessionBookmarkChanged |
| 6 | `EventFeedback` | MMCA.ADC.Engagement.UI | 7 | AnswerState, EventQuestionAnswerDTO, IEventFeedbackUIService, IEventLookupService, IQuestionLookupService, Question, QuestionDTO |
| 6 | `SessionLiveModerationPanel` | MMCA.ADC.Engagement.UI | 11 | CreateLivePollRequest, ErrorMessages, ILivePollUIService, ISessionQuestionUIService, LivePollDTO, LivePollResultsDTO, LivePollStatus, OptionState, Question, QuestionService, SessionQuestionDTO |
| 6 | `LivePollCardTests` | MMCA.ADC.Engagement.UI.Tests | 5 | BunitComponentTestBase, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, Question |
| 6 | `LivePollUIServiceTests` | MMCA.ADC.Engagement.UI.Tests | 10 | CapturingHttpMessageHandler, CreateLivePollRequest, HttpTestDoubles, LivePollDTO, LivePollOptionDTO, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, LivePollUIService, Question |
| 6 | `PresenterViewTests` | MMCA.ADC.Engagement.UI.Tests | 15 | ApiSettings, BunitComponentTestBase, ILivePollUIService, ISessionLookupService, ISessionQuestionUIService, ITokenStorageService, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, NotificationHubService, PresenterView, Question, QuestionStatus, SessionInfo, SessionQuestionDTO |
| 6 | `SessionFeedbackTests` | MMCA.ADC.Engagement.UI.Tests | 9 | BunitComponentTestBase, IEntityService<TEntityDTO, TIdentifierType>, IQuestionLookupService, ISessionFeedbackUIService, Question, QuestionDTO, SessionDTO, SessionFeedback, SessionQuestionAnswerDTO |
| 6 | `SessionLivePollPanelTests` | MMCA.ADC.Engagement.UI.Tests | 9 | BunitComponentTestBase, IHapticFeedbackService, ILivePollUIService, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, NullHapticFeedbackService, Question, SessionLivePollPanel |
| 6 | `SessionLiveQuestionPanelTests` | MMCA.ADC.Engagement.UI.Tests | 8 | BunitComponentTestBase, ISessionQuestionUIService, ISpeechToTextService, Question, QuestionStatus, SessionLiveQuestionPanel, SessionQuestionDTO, SubmitQuestionRequest |
| 6 | `DependencyInjectionTests` | MMCA.ADC.Identity.API.Tests | 2 | ApplicationSettings, IAuthenticationService |
| 6 | `RegisterRequestValidator` | MMCA.ADC.Identity.Application | 5 | AddressValidator, EmailRules<T>, RegisterRequest, RequiredStringRules<T>, StrongPasswordRules<T> |
| 6 | `User` | MMCA.ADC.Identity.Domain | 9 | AuditableAggregateRootEntity<TIdentifierType>, Email, IAnonymizable, IAuthUser, Result, UserDeleted, UserInvariants, UserPasswordChanged, UserRole |
| 6 | `Profile` | MMCA.ADC.Identity.UI | 5 | IAuthUIService, IMediaPickerService, IUserUIService, PickedMedia, UserService |
| 6 | `ProfileChangePasswordTests` | MMCA.ADC.Identity.UI.Tests | 5 | BunitTestBase, IAuthUIService, IUserUIService, ProfilePage, TestPrincipal |
| 6 | `ProfileTests` | MMCA.ADC.Identity.UI.Tests | 4 | BunitTestBase, IAuthUIService, IUserUIService, ProfilePage |
| 6 | `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.API | 12 | ApiControllerBase, AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, CollectionResult<T>, Error, IApplicationSettings, IBaseDTO<TIdentifierType>, IEntityControllerBase<TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, Route |
| 6 | `OAuthControllerBase` | MMCA.Common.API | 6 | AuthenticationResponse, Error, ExternalAuthExtensions, IAuthenticationService, ICacheService, OAuthCodeExchangeRequest |
| 6 | `CookieSessionRefresherTests` | MMCA.Common.API.Tests | 5 | AuthenticationResponse, CookieTokenReader, RefresherHarness, SessionCookieEndpoints, SessionTokenResult |
| 6 | `Mocks` | MMCA.Common.API.Tests | 2 | IAuthenticationService, ICacheService |
| 6 | `ModuleControllerFeatureProviderTests` | MMCA.Common.API.Tests | 5 | ApiControllerBaseTests, FakeCategoriesController, ModuleControllerFeatureProvider, ModuleSettings, ModulesSettings |
| 6 | `IRepository<TEntity, TIdentifierType>` | MMCA.Common.Application | 3 | AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IWriteRepository<TEntity, TIdentifierType> |
| 6 | `NavigationLoader` | MMCA.Common.Application | 2 | AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType> |
| 6 | `PushNotificationDTOMapper` | MMCA.Common.Application | 4 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, PushNotification, PushNotificationDTO, PushNotificationStatus |
| 6 | `ReadRepositoryExtensions` | MMCA.Common.Application | 4 | AuditableBaseEntity<TIdentifierType>, Error, IReadRepository<TEntity, TIdentifierType>, Result |
| 6 | `AddressValidationRulesTests` | MMCA.Common.Application.Tests | 10 | Address, AddressInvariants, AddressLine1Rules<T>, AddressLine2Rules<T>, AddressValidator, CityRules<T>, CountryRules<T>, StateRules<T>, TestAddressModel, ZipCodeRules<T> |
| 6 | `AuthenticationValidatorsTests` | MMCA.Common.Application.Tests | 4 | AuthenticationValidators, LoginRequest, RefreshTokenRequest, RegisterRequest |
| 6 | `DependencyInjectionTests` | MMCA.Common.Application.Tests | 8 | ApplicationSettings, DomainEventDispatcher, EntityQueryPipeline, IApplicationSettings, IDomainEventDispatcher, IEntityQueryPipeline, INavigationMetadataProvider, NavigationMetadataProvider |
| 6 | `EntityQueryPipelineTests` | MMCA.Common.Application.Tests | 7 | EntityQueryParameters<TEntity>, EntityQueryPipeline, IQueryableExecutor, NavigationMetadata, NavigationPropertyInfo, NavigationType, TestEntity |
| 6 | `NavigationMetadataProviderTests` | MMCA.Common.Application.Tests | 12 | ChildD, IDataSourceService, MixedEntity, NavigationMetadata, NavigationMetadataProvider, NavigationType, NoNavEntity, ReadOnlyCollectionEntity, SupportedChild, SupportedFK, UnsupportedChild, UnsupportedFK |
| 6 | `NullNavigationPopulatorTests` | MMCA.Common.Application.Tests | 4 | INavigationPopulator<in TEntity>, NavigationMetadata, NullNavigationPopulator<TEntity>, StubEntity |
| 6 | `ReadRepositoryExtensionsTests` | MMCA.Common.Application.Tests | 4 | ErrorType, IReadRepository<TEntity, TIdentifierType>, Result, TestReadEntity |
| 6 | `SendPushNotificationRequestValidatorTests` | MMCA.Common.Application.Tests | 3 | PushNotificationInvariants, SendPushNotificationRequest, SendPushNotificationRequestValidator |
| 6 | `NavigatingSpec` | MMCA.Common.Architecture.Tests | 2 | FitnessDependent, Specification<TEntity, TIdentifierType> |
| 6 | `PiiErasureContractFitnessTests` | MMCA.Common.Architecture.Tests | 3 | DataSubjectSample, IAnonymizable, PiiRedactor |
| 6 | `ScalarOnlySpec` | MMCA.Common.Architecture.Tests | 2 | FitnessDependent, Specification<TEntity, TIdentifierType> |
| 6 | `AuditableAggregateRootEntityAdditionalTests` | MMCA.Common.Domain.Tests | 3 | ChildEntity, TestAggregate, ValidatingAggregate |
| 6 | `AuditableAggregateRootEntityTests` | MMCA.Common.Domain.Tests | 2 | TestAggregate, TestDomainEvent |
| 6 | `PushNotificationTests` | MMCA.Common.Domain.Tests | 3 | PushNotification, PushNotificationCreated, PushNotificationStatus |
| 6 | `SpecificationAdditionalTests` | MMCA.Common.Domain.Tests | 6 | AgeRangeSpec, AndSpecification<TEntity, TIdentifierType>, NameEqualsSpec, NotSpecification<TEntity, TIdentifierType>, OrSpecification<TEntity, TIdentifierType>, TestEntity |
| 6 | `SpecificationTests` | MMCA.Common.Domain.Tests | 6 | AgeGreaterThanSpec, AndSpecification<TEntity, TIdentifierType>, NameStartsWithSpec, NotSpecification<TEntity, TIdentifierType>, OrSpecification<TEntity, TIdentifierType>, TestEntity |
| 6 | `UserNotificationTests` | MMCA.Common.Domain.Tests | 1 | UserNotification |
| 6 | `ApplicationDbContext` | MMCA.Common.Infrastructure | 18 | AuditableBaseEntity<TIdentifierType>, AuditSaveChangesInterceptor, CrossDataSourceDegradeConvention, DataSource, DataSourceKey, DataSourceModelCacheKeyFactory, DomainEventSaveChangesInterceptor, IAuditableEntity, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>, IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, InboxMessage, OutboxMessage, PhysicalDataSource, SoftDeleteUniqueIndexConvention, ValReturn<T> |
| 6 | `AuditSaveChangesInterceptor` | MMCA.Common.Infrastructure | 2 | ApplicationDbContext, IAuditableEntity |
| 6 | `DataSourceModelCacheKeyFactory` | MMCA.Common.Infrastructure | 1 | ApplicationDbContext |
| 6 | `DeferredDispatch` | MMCA.Common.Infrastructure | 2 | CapturedState, DomainEventSaveChangesInterceptor |
| 6 | `DomainEventSaveChangesInterceptor` | MMCA.Common.Infrastructure | 10 | ApplicationDbContext, CapturedState, DeferredDispatch, IAggregateRoot, IDomainEvent, IDomainEventDispatcher, IIntegrationEvent, IOutboxSignal, OutboxFinalizer, OutboxMessage |
| 6 | `EFReadRepository<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 3 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IReadRepository<TEntity, TIdentifierType> |
| 6 | `EFReadRepositoryDecorator<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 4 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, ProfilingHelper |
| 6 | `EntityTypeConfiguration<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 9 | AuditableBaseEntity<TIdentifierType>, CosmosIntIdValueGenerator, DataSource, EntityTypeConfigurationBase<TEntity, TIdentifierType>, IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>, IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, NamespaceConventions, UseDataSourceAttribute |
| 6 | `OutboxFinalizer` | MMCA.Common.Infrastructure | 2 | ApplicationDbContext, OutboxMessage |
| 6 | `ModelBuilderExtensionsTests` | MMCA.Common.Infrastructure.Tests | 4 | IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, ModelBuilderExtensions, TestMappedEntity, TestModelBuilderDbContext |
| 6 | `MultiSourceOrder` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, MultiSourceCustomer |
| 6 | `PortableThing` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, PortablePrincipal |
| 6 | `RegistryUnattributedConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryUnattributed |
| 6 | `TestAggregateEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationBase<TEntity, TIdentifierType>, TestAggregateEntity |
| 6 | `TestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | FakeAggregate, FakeEntity, TestChildEntity, TestEntity |
| 6 | `TestEntitySqliteConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, TestMappedEntity |
| 6 | `TestModelBuilderDbContext` | MMCA.Common.Infrastructure.Tests | 4 | IDataSourceService, IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, ModelBuilderExtensionsTests, TestDataSourceService |
| 6 | `TestNonAggregateEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationBase<TEntity, TIdentifierType>, TestNonAggregateEntity |
| 6 | `AuthUIService` | MMCA.Common.UI | 10 | AuthenticationResponse, ChangePasswordRequest, IAuthUIService, IPushRegistrationService, ITokenRefresher, ITokenStorageService, JwtAuthenticationStateProvider, LoginRequest, OAuthCodeExchangeRequest, RegisterRequest |
| 6 | `NoOpAuthUIService` | MMCA.Common.UI.Gallery | 4 | AuthenticationResponse, IAuthUIService, LoginRequest, RegisterRequest |
| 6 | `NavMenuTests` | MMCA.Common.UI.Tests | 8 | BunitTestBase, IAuthUIService, IUIModule, LayoutSettings, NavItem, NavSection, StubUiModule, TestPrincipal |
| 6 | `RegisterFormTests` | MMCA.Common.UI.Tests | 3 | BunitTestBase, IAuthUIService, RegisterRequest |
| 7 | `CategoryItemsController` | MMCA.ADC.Conference.API | 17 | AddCategoryItemCommand, AddCategoryItemRequest, BaseLookup<TIdentifierType>, CategoryItem, CategoryItemDTO, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveCategoryItemCommand, Result, Route, UpdateCategoryItemCommand, UpdateCategoryItemRequest |
| 7 | `EventQuestionAnswersController` | MMCA.ADC.Conference.API | 20 | AddEventQuestionAnswerCommand, AddEventQuestionAnswerRequest, AuthorizationPolicies, BaseLookup<TIdentifierType>, CollectionResult<T>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, EventQuestionAnswer, EventQuestionAnswerDTO, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, OwnEventQuestionAnswerSpecification, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveEventQuestionAnswerCommand, Result, RoleNames, Route, UpdateEventQuestionAnswerCommand, UpdateEventQuestionAnswerRequest |
| 7 | `EventSpeakersController` | MMCA.ADC.Conference.API | 15 | AddEventSpeakerCommand, AddEventSpeakerRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, EventSpeaker, EventSpeakerDTO, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveEventSpeakerCommand, Result, Route |
| 7 | `RoomsController` | MMCA.ADC.Conference.API | 17 | AddRoomCommand, AddRoomRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveRoomCommand, Result, Room, RoomDTO, Route, UpdateRoomCommand, UpdateRoomRequest |
| 7 | `SpeakerCategoryItemsController` | MMCA.ADC.Conference.API | 15 | AddSpeakerCategoryItemCommand, AddSpeakerCategoryItemRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveSpeakerCategoryItemCommand, Result, Route, SpeakerCategoryItem, SpeakerCategoryItemDTO |
| 7 | `AddCategoryItemCommandValidator` | MMCA.ADC.Conference.Application | 3 | AddCategoryItemCommand, CategoryItemNameRules<T>, CategoryItemSortRules<T> |
| 7 | `AddEventQuestionAnswerCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddEventQuestionAnswerCommand |
| 7 | `AddEventSpeakerCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddEventSpeakerCommand |
| 7 | `AddRoomCommandValidator` | MMCA.ADC.Conference.Application | 7 | AddRoomCommand, RoomAccessibilityInfoRules<T>, RoomCapacityRules<T>, RoomFloorRules<T>, RoomLocationRules<T>, RoomNameRules<T>, RoomSortRules<T> |
| 7 | `AddSessionCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 7 | `AddSessionQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 7 | `AddSessionSpeakerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 7 | `AddSpeakerCategoryItemCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddSpeakerCategoryItemCommand |
| 7 | `CalendarExportMapper` | MMCA.ADC.Conference.Application | 3 | Event, IcsEvent, Session |
| 7 | `ConferenceCategoryCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | Category, ConferenceCategoryCreateRequest, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result |
| 7 | `ConferenceCategoryCreateRequestValidator` | MMCA.ADC.Conference.Application | 2 | ConferenceCategoryCreateRequest, ConferenceCategoryTitleRules<T> |
| 7 | `ConferenceCategoryDTOMapper` | MMCA.ADC.Conference.Application | 4 | Category, CategoryItemDTOMapper, ConferenceCategoryDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 7 | `ConferenceCategoryUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | ConferenceCategoryTitleRules<T>, ConferenceCategoryUpdateRequest |
| 7 | `EventCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | Event, EventCreateRequest, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result |
| 7 | `EventCreateRequestValidator` | MMCA.ADC.Conference.Application | 4 | EventCreateRequest, EventDateRangeRules<T>, EventNameRules<T>, EventTimeZoneRules<T> |
| 7 | `EventDTOMapper` | MMCA.ADC.Conference.Application | 6 | Event, EventDTO, EventQuestionAnswerDTOMapper, EventSpeakerDTOMapper, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, RoomDTOMapper |
| 7 | `GetNowNextQuery` | MMCA.ADC.Conference.Application | 2 | IQueryCacheable, Session |
| 7 | `OwnSessionQuestionAnswerSpecification` | MMCA.ADC.Conference.Application | 2 | SessionQuestionAnswer, Specification<TEntity, TIdentifierType> |
| 7 | `QuestionCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Question, QuestionCreateRequest, Result |
| 7 | `QuestionCreateRequestValidator` | MMCA.ADC.Conference.Application | 2 | QuestionCreateRequest, QuestionTextRules<T> |
| 7 | `RemoveSessionCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 7 | `RemoveSessionQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 7 | `RemoveSessionSpeakerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 7 | `SessionCategoryItemDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SessionCategoryItem, SessionCategoryItemDTO |
| 7 | `SessionCreateRequest` | MMCA.ADC.Conference.Application | 3 | ICacheInvalidating, ICreateRequest, Session |
| 7 | `SessionQuestionAnswerDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SessionQuestionAnswer, SessionQuestionAnswerDTO |
| 7 | `SessionRoomScheduling` | MMCA.ADC.Conference.Application | 2 | Error, Session |
| 7 | `SessionSpeakerDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SessionSpeaker, SessionSpeakerDTO |
| 7 | `SpeakerCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result, Speaker, SpeakerCreateRequest |
| 7 | `SpeakerCreateRequestValidator` | MMCA.ADC.Conference.Application | 3 | SpeakerCreateRequest, SpeakerFirstNameRules<T>, SpeakerLastNameRules<T> |
| 7 | `SpeakerDTOMapper` | MMCA.ADC.Conference.Application | 8 | Email, ICurrentUserService, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, RoleNames, Speaker, SpeakerCategoryItemDTOMapper, SpeakerDTO, SpeakerQuestionAnswerDTOMapper |
| 7 | `UpdateCategoryItemCommandValidator` | MMCA.ADC.Conference.Application | 3 | CategoryItemNameRules<T>, CategoryItemSortRules<T>, UpdateCategoryItemCommand |
| 7 | `UpdateRoomCommandValidator` | MMCA.ADC.Conference.Application | 7 | RoomAccessibilityInfoRules<T>, RoomCapacityRules<T>, RoomFloorRules<T>, RoomLocationRules<T>, RoomNameRules<T>, RoomSortRules<T>, UpdateRoomCommand |
| 7 | `UpdateSessionCommand` | MMCA.ADC.Conference.Application | 4 | ICacheInvalidating, ICommandWithRequest<out TRequest>, Session, SessionUpdateRequest |
| 7 | `UpdateSessionQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 7 | `CategoryItemDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Category, CategoryItem, CategoryItemDTOMapper |
| 7 | `EventQuestionAnswerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Event, EventQuestionAnswer, EventQuestionAnswerDTOMapper |
| 7 | `EventSpeakerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Event, EventSpeaker, EventSpeakerDTOMapper |
| 7 | `EventUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | EventUpdateRequest, EventUpdateRequestValidator |
| 7 | `EventValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | EventInvariants, TestEventModel, TestEventValidator |
| 7 | `InMemoryRepository<TEntity, TIdentifierType>` | MMCA.ADC.Conference.Application.Tests | 4 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRowVersioned |
| 7 | `OwnEventQuestionAnswerSpecificationTests` | MMCA.ADC.Conference.Application.Tests | 2 | Event, OwnEventQuestionAnswerSpecification |
| 7 | `PublishedEventSpecificationTests` | MMCA.ADC.Conference.Application.Tests | 2 | Event, PublishedEventSpecification |
| 7 | `QuestionDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 2 | Question, QuestionDTOMapper |
| 7 | `QuestionUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | QuestionUpdateRequest, QuestionUpdateRequestValidator |
| 7 | `QuestionValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | QuestionInvariants, TestQuestionModel, TestQuestionTextValidator |
| 7 | `RoomDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Event, Room, RoomDTOMapper |
| 7 | `RoomValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | EventInvariants, TestRoomModel, TestRoomValidator |
| 7 | `SessionUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionInvariants, SessionUpdateRequest, SessionUpdateRequestValidator |
| 7 | `SessionValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionInvariants, TestSessionModel, TestSessionValidator |
| 7 | `SpeakerCategoryItemDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Speaker, SpeakerCategoryItem, SpeakerCategoryItemDTOMapper |
| 7 | `SpeakerLocalityHelperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Category, Speaker, SpeakerLocalityHelper |
| 7 | `SpeakerQuestionAnswerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Speaker, SpeakerQuestionAnswer, SpeakerQuestionAnswerDTOMapper |
| 7 | `SpeakerUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | Email, SpeakerUpdateRequest, SpeakerUpdateRequestValidator |
| 7 | `SpeakerValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | SpeakerInvariants, TestSpeakerModel, TestSpeakerValidator |
| 7 | `TestCategoryItemValidator` | MMCA.ADC.Conference.Application.Tests | 3 | CategoryItemNameRules<T>, CategoryItemSortRules<T>, TestCategoryItemModel |
| 7 | `TestCategoryTitleValidator` | MMCA.ADC.Conference.Application.Tests | 2 | ConferenceCategoryTitleRules<T>, TestCategoryModel |
| 7 | `IEventCascadeDeletionDomainService` | MMCA.ADC.Conference.Domain | 3 | Event, Result, Session |
| 7 | `SessionBuilder` | MMCA.ADC.Conference.Domain.Tests | 2 | EntityBuilderBase<TBuilder, TEntity>, Session |
| 7 | `SessionTests` | MMCA.ADC.Conference.Domain.Tests | 3 | DomainEntityState, Session, SessionChanged |
| 7 | `ModuleApplicationDbContext` | MMCA.ADC.Conference.Infrastructure | 16 | ApplicationDbContext, Category, CategoryItem, Event, EventQuestionAnswer, EventSpeaker, IEntityConfigurationAssemblyProvider, PhysicalDataSource, Question, Room, Session, SessionCategoryItem, SessionQuestionAnswer, SessionSpeaker, Speaker, SpeakerCategoryItem |
| 7 | `CurrentEventDefaults` | MMCA.ADC.Conference.Shared | 2 | CurrentEventSelector, EventDTO |
| 7 | `CurrentEventSelectorTests` | MMCA.ADC.Conference.Shared.Tests | 2 | CurrentEventSelector, TestEvent |
| 7 | `ADCHome` | MMCA.ADC.Conference.UI | 8 | ADCCollectionResult, ADCEventInfo, ConferenceTrackInfo, CurrentEventSelector, EventPhase, KeynoteSpeakerInfo, SponsorInfo, SponsorTierInfo |
| 7 | `PublicSessionDetail` | MMCA.ADC.Conference.UI | 16 | BookmarkService, ConferenceRoutePaths, ICategoryItemLookupService, IHapticFeedbackService, IRoomUIService, ISessionBookmarkUIService, ISessionLiveUIService, ISessionUIService, ISpeakerLookupService, ITextToSpeechService, RoomDTO, RoomService, Session, SessionDTO, SessionLive, SessionService |
| 7 | `PublicSpeakerList` | MMCA.ADC.Conference.UI | 12 | ConferenceRoutePaths, CurrentEventSelector, DataGridListPageBase<TDto>, EventInfo, EventLookupService, IEventLookupService, ISpeakerUIService, ListPageActions, MobileInfiniteScrollList<TItem>, RoleNames, SpeakerDTO, SpeakerService |
| 7 | `RoomList` | MMCA.ADC.Conference.UI | 12 | ConferenceRoutePaths, CurrentEventSelector, DataGridListPageBase<TDto>, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IRoomUIService, ListPageActions, MobileInfiniteScrollList<TItem>, RoomDTO, RoomService |
| 7 | `SessionDetail` | MMCA.ADC.Conference.UI | 22 | CategoryItemInfo, CategoryItemLookupService, ConferenceRoutePaths, ErrorMessages, EventInfo, EventLookupService, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionCategoryItemUIService, ISessionSpeakerUIService, ISessionUIService, ISpeakerLookupService, RoomDTO, RoomService, Session, SessionCategoryItemService, SessionDTO, SessionService, SessionSpeakerService …(+2) |
| 7 | `SessionSelectionDashboard` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, CurrentEventSelector, EventInfo, EventLookupService, IEventLookupService, ISessionSelectionUIService, ScorePollSignal, ScorePollTracker, SessionSelectionDashboardDTO |
| 7 | `SpeakerDashboard` | MMCA.ADC.Conference.UI | 12 | CurrentEventSelector, Email, EventInfo, EventLookupService, IEventLookupService, ISpeakerDashboardUIService, ISpeakerUIService, SessionDTO, SessionFeedbackDTO, Speaker, SpeakerDTO, SpeakerService |
| 7 | `SpeakerList` | MMCA.ADC.Conference.UI | 12 | ConferenceRoutePaths, CurrentEventSelector, DataGridListPageBase<TDto>, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, ISpeakerUIService, ListPageActions, MobileInfiniteScrollList<TItem>, SpeakerDTO, SpeakerService |
| 7 | `EventDetailTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, EventDetail, EventDTO, IEventUIService, QuestionModerationDefault |
| 7 | `ManagementRouteAuthorizationTests` | MMCA.ADC.Conference.UI.Tests | 2 | PublicEventDetail, RouteAuthorizationTestsBase |
| 7 | `PublicEventDetailTests` | MMCA.ADC.Conference.UI.Tests | 6 | BunitTestBase, EventDTO, IClipboardService, IEventUIService, IMapNavigationService, PublicEventDetail |
| 7 | `PublicSpeakerDetailTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, ISessionUIService, ISpeakerUIService, PublicSpeakerDetail, SpeakerDTO |
| 7 | `QuestionDetailTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, IQuestionUIService, Question, QuestionDetail, QuestionDTO |
| 7 | `SpeakerDashboardServiceTests` | MMCA.ADC.Conference.UI.Tests | 10 | CapturingHttpMessageHandler, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, RatingQuestionSummary, Session, SessionDTO, SessionFeedbackDTO, SessionSpeakerDTO, SpeakerDashboardService |
| 7 | `LivePollsController` | MMCA.ADC.Engagement.API | 24 | ApiControllerBase, AuthorizationPolicies, CastVoteCommand, CastVoteRequest, CloseLivePollCommand, CreateLivePollCommand, CreateLivePollRequest, DeleteEntityCommand<TEntity, TIdentifierType>, EngagementFeatures, EngagementPermissions, Error, GetEventPollsQuery, GetOpenPollsQuery, GetPollResultsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, LivePoll, LivePollDTO, LivePollResultsDTO …(+4) |
| 7 | `ControllerMocks` | MMCA.ADC.Engagement.API.Tests | 28 | CastVoteCommand, CloseLivePollCommand, CreateBookmarkRequest, CreateLivePollCommand, DeleteEntityCommand<TEntity, TIdentifierType>, GetBookmarkedSessionIdsQuery, GetEventPollsQuery, GetModerationQueueQuery, GetOpenPollsQuery, GetPollResultsQuery, GetSessionQuestionsQuery, GetUserBookmarksQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, LivePoll, LivePollDTO, LivePollResultsDTO, ModerateQuestionCommand …(+8) |
| 7 | `LivePollDTOMapper` | MMCA.ADC.Engagement.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, LivePoll, LivePollDTO |
| 7 | `CreateLivePollCommandValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 5 | CreateLivePollCommand, CreateLivePollCommandValidator, CreateLivePollRequest, LivePollInvariants, Question |
| 7 | `TestSupport` | MMCA.ADC.Engagement.Application.Tests | 4 | AuditableBaseEntity<TIdentifierType>, BaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType> |
| 7 | `UserSessionBookmarkDTOMapperTests` | MMCA.ADC.Engagement.Application.Tests | 2 | UserSessionBookmark, UserSessionBookmarkDTOMapper |
| 7 | `BookmarkManagementDomainService` | MMCA.ADC.Engagement.Domain | 3 | IBookmarkManagementDomainService, Result, UserSessionBookmark |
| 7 | `LivePollTests` | MMCA.ADC.Engagement.Domain.Tests | 6 | DomainEntityState, LivePoll, LivePollChanged, LivePollInvariants, LivePollOption, LivePollStatus |
| 7 | `ModuleApplicationDbContext` | MMCA.ADC.Engagement.Infrastructure | 9 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, LivePoll, LivePollOption, LivePollVote, PhysicalDataSource, SessionQuestion, SessionQuestionUpvote, UserSessionBookmark |
| 7 | `LiveEventService` | MMCA.ADC.Engagement.UI | 5 | CurrentEventSelector, EventDTO, ILiveEventUIService, LiveEventContext, PagedCollectionResult<T> |
| 7 | `EventFeedbackTests` | MMCA.ADC.Engagement.UI.Tests | 9 | BunitComponentTestBase, EventFeedback, EventInfo, EventQuestionAnswerDTO, IEventFeedbackUIService, IEventLookupService, IQuestionLookupService, Question, QuestionDTO |
| 7 | `SessionLiveModerationPanelTests` | MMCA.ADC.Engagement.UI.Tests | 11 | BunitComponentTestBase, CreateLivePollRequest, ILivePollUIService, ISessionQuestionUIService, LivePollDTO, LivePollResultsDTO, LivePollStatus, Question, QuestionStatus, SessionLiveModerationPanel, SessionQuestionDTO |
| 7 | `SessionReminderPlannerTests` | MMCA.ADC.Engagement.UI.Tests | 3 | Session, SessionInfo, SessionReminderPlanner |
| 7 | `OAuthController` | MMCA.ADC.Identity.API | 4 | IAuthenticationService, ICacheService, OAuthControllerBase, Route |
| 7 | `ChangePasswordCommand` | MMCA.ADC.Identity.Application | 4 | ChangePasswordRequest, ICacheInvalidating, ICommandWithRequest<out TRequest>, User |
| 7 | `ChangePreferencesCommand` | MMCA.ADC.Identity.Application | 3 | ChangePreferencesRequest, ICacheInvalidating, User |
| 7 | `DeleteUserCommand` | MMCA.ADC.Identity.Application | 2 | ICacheInvalidating, User |
| 7 | `UserDTOMapper` | MMCA.ADC.Identity.Application | 4 | Email, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, User, UserDTO |
| 7 | `InMemoryRepository<TEntity, TIdentifierType>` | MMCA.ADC.Identity.Application.Tests | 4 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRowVersioned |
| 7 | `RegisterRequestValidatorTests` | MMCA.ADC.Identity.Application.Tests | 2 | RegisterRequest, RegisterRequestValidator |
| 7 | `UserAnonymizeTests` | MMCA.ADC.Identity.Domain.Tests | 4 | Email, Result, User, UserRole |
| 7 | `UserBuilder` | MMCA.ADC.Identity.Domain.Tests | 3 | EntityBuilderBase<TBuilder, TEntity>, User, UserRole |
| 7 | `UserInvariantsAndRoleTests` | MMCA.ADC.Identity.Domain.Tests | 4 | Result, User, UserDeleted, UserRole |
| 7 | `UserTests` | MMCA.ADC.Identity.Domain.Tests | 3 | User, UserPasswordChanged, UserRole |
| 7 | `ModuleApplicationDbContext` | MMCA.ADC.Identity.Infrastructure | 4 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, PhysicalDataSource, User |
| 7 | `IdentityRouteAuthorizationTests` | MMCA.ADC.Identity.UI.Tests | 3 | RouteAuthorizationTestsBase, User, UserList |
| 7 | `UserListTests` | MMCA.ADC.Identity.UI.Tests | 8 | BunitTestBase, Email, IUserUIService, ListPageQueryStateService, ListPageStateService, User, UserList, UserListDTO |
| 7 | `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>` | MMCA.Common.API | 10 | AuditableAggregateRootEntity<TIdentifierType>, DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>, IBaseDTO<TIdentifierType>, ICommandHandler<in TCommand, TResult>, ICreateRequest, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, Route |
| 7 | `TestEntityController` | MMCA.Common.API.Tests | 5 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, TestDTO, TestEntity |
| 7 | `TestOAuthController` | MMCA.Common.API.Tests | 3 | IAuthenticationService, ICacheService, OAuthControllerBase |
| 7 | `IUnitOfWork` | MMCA.Common.Application | 4 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType> |
| 7 | `NavigationLoaderTests` | MMCA.Common.Application.Tests | 4 | IReadRepository<TEntity, TIdentifierType>, NavigationLoader, StubChild, StubParent |
| 7 | `PushNotificationDTOMapperTests` | MMCA.Common.Application.Tests | 5 | PushNotification, PushNotificationDTO, PushNotificationDTOMapper, PushNotificationStatus, Result |
| 7 | `CommonArchitectureMap` | MMCA.Common.Architecture.Tests | 10 | ApiControllerBase, ApplicationDbContext, ArchitectureMapBase, BaseEntity<TIdentifierType>, DomainEventDispatcher, Layer, LayerRef, Result, ResultGrpcExtensions, UISharedAssemblyReference |
| 7 | `FrameworkSanityTests` | MMCA.Common.Architecture.Tests | 7 | ApplicationDbContext, ArchitectureAssert, DomainEventDispatcher, IJwksProvider, ILiveChannelPublisher, IMessageBus, ResultGrpcExtensions |
| 7 | `SpecificationFitnessTests` | MMCA.Common.Architecture.Tests | 4 | ArchitectureRules, NavigatingSpec, ScalarOnlySpec, SpecTestMap |
| 7 | `SpecTestMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, Layer, LayerRef, SpecificationFitnessTests |
| 7 | `CosmosDbContext` | MMCA.Common.Infrastructure | 5 | ApplicationDbContext, DataSource, IEntityConfigurationAssemblyProvider, OutboxMessage, PhysicalDataSource |
| 7 | `CurrentUserService` | MMCA.Common.Infrastructure | 2 | ICurrentUserService, User |
| 7 | `EFRepository<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 4 | AuditableBaseEntity<TIdentifierType>, EFReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRowVersioned |
| 7 | `EFRepositoryDecorator<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 5 | AuditableBaseEntity<TIdentifierType>, EFReadRepositoryDecorator<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRowVersioned, ProfilingHelper |
| 7 | `EntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 3 | AuditableBaseEntity<TIdentifierType>, DataSource, EntityTypeConfiguration<TEntity, TIdentifierType> |
| 7 | `EntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 3 | AuditableBaseEntity<TIdentifierType>, DataSource, EntityTypeConfiguration<TEntity, TIdentifierType> |
| 7 | `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 3 | AuditableBaseEntity<TIdentifierType>, DataSource, EntityTypeConfiguration<TEntity, TIdentifierType> |
| 7 | `IDbContextFactory` | MMCA.Common.Infrastructure | 3 | ApplicationDbContext, DataSource, DataSourceKey |
| 7 | `IPhysicalDbContextFactory` | MMCA.Common.Infrastructure | 2 | ApplicationDbContext, DataSourceKey |
| 7 | `IRepositoryFactory` | MMCA.Common.Infrastructure | 4 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType> |
| 7 | `SqliteDbContext` | MMCA.Common.Infrastructure | 4 | ApplicationDbContext, DataSource, IEntityConfigurationAssemblyProvider, PhysicalDataSource |
| 7 | `SQLServerDbContext` | MMCA.Common.Infrastructure | 4 | ApplicationDbContext, DataSource, IEntityConfigurationAssemblyProvider, PhysicalDataSource |
| 7 | `CleanupTestContext` | MMCA.Common.Infrastructure.Tests | 11 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, InboxMessage, IOutboxSignal, NullAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 7 | `DegradeTestContext` | MMCA.Common.Infrastructure.Tests | 7 | ApplicationDbContext, DataSourceKey, DegradeCustomer, DegradeOrder, EmptyAssemblyProvider, IEntityDataSourceRegistry, PhysicalDataSource |
| 7 | `EFReadRepositoryDecoratorAdditionalTests` | MMCA.Common.Infrastructure.Tests | 3 | EFReadRepositoryDecorator<TEntity, TIdentifierType>, FakeEntity, IReadRepository<TEntity, TIdentifierType> |
| 7 | `EFReadRepositoryDecoratorTests` | MMCA.Common.Infrastructure.Tests | 4 | BaseLookup<TIdentifierType>, EFReadRepositoryDecorator<TEntity, TIdentifierType>, FakeEntity, IReadRepository<TEntity, TIdentifierType> |
| 7 | `InboxTestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, InboxMessage, TestPhysicalDataSources |
| 7 | `OutboxRoutingTestDbContext` | MMCA.Common.Infrastructure.Tests | 9 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IEntityDataSourceRegistry, NullAssemblyProvider, OutboxMessage, TestAggregate, TestPhysicalDataSources |
| 7 | `OutboxTestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 7 | `PortableThingConfiguration` | MMCA.Common.Infrastructure.Tests | 3 | DataSource, EntityTypeConfiguration<TEntity, TIdentifierType>, PortableThing |
| 7 | `SoftDeleteTestDbContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, SoftDeletableEntity, TestPhysicalDataSources |
| 7 | `TestApplicationDbContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IOutboxSignal, TestEntity, TestPhysicalDataSources |
| 7 | `TestAuditDbContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, TestAuditEntity, TestPhysicalDataSources |
| 7 | `TestConfigDbContext` | MMCA.Common.Infrastructure.Tests | 2 | TestAggregateEntity, TestAggregateEntityConfiguration |
| 7 | `TestConnectionContext` | MMCA.Common.Infrastructure.Tests | 2 | TestDuplexPipe, User |
| 7 | `TestDomainEventDbContext` | MMCA.Common.Infrastructure.Tests | 8 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IEntityDataSourceRegistry, NullAssemblyProvider, TestAggregate, TestPhysicalDataSources |
| 7 | `TestNonAggregateConfigDbContext` | MMCA.Common.Infrastructure.Tests | 2 | TestNonAggregateEntity, TestNonAggregateEntityConfiguration |
| 7 | `TestNonOutboxContext` | MMCA.Common.Infrastructure.Tests | 9 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, TestPhysicalDataSources |
| 7 | `TestOutboxContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 7 | `TransactionTestDbContext` | MMCA.Common.Infrastructure.Tests | 11 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, OutboxMessage, TestAggregate, TestPhysicalDataSources |
| 7 | `UniqueIndexTestDbContext` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FilteredIndexEntity, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, TestPhysicalDataSources, UniqueNamedEntity |
| 7 | `DependencyInjection` | MMCA.Common.UI | 22 | ApiSettings, ApiUserPreferenceReader, ApiUserPreferenceWriter, AuthDelegatingHandler, AuthUIService, CultureDelegatingHandler, DefaultOAuthUISettings, IAuthUIService, IFormFactor, IOAuthUISettings, ISessionCookieSync, IUserPreferenceReader, IUserPreferenceWriter, JsFetchSessionCookieSync, LayoutSettings, ListPageQueryStateService, ListPageStateService, NavigationHistoryService, PseudoStringLocalizerFactory, ResxMudLocalizer …(+2) |
| 7 | `GalleryAuthenticationStateProvider` | MMCA.Common.UI.Gallery | 1 | User |
| 8 | `DecoratorPipelineOrderTests` | MMCA.ADC.Architecture.Tests | 9 | ChangePreferencesCommand, ClassReference, DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>, GetUserPreferencesQuery, ICacheService, ICorrelationContext, IUnitOfWork, Result, UserPreferencesResponse |
| 8 | `ConferenceCategoriesController` | MMCA.ADC.Conference.API | 16 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, Category, CollectionResult<T>, ConferenceCategoryCreateRequest, ConferenceCategoryDTO, ConferenceCategoryUpdateRequest, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, Result, Route, UpdateConferenceCategoryCommand |
| 8 | `EventsController` | MMCA.ADC.Conference.API | 28 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, Event, EventCreateRequest, EventDTO, EventUpdateRequest, ExportEventCalendarQuery, GetNowNextQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, NowNextDTO, PagedCollectionResult<T>, PublishedEventSpecification, PublishEventCommand, QueryFilterModelBinder …(+8) |
| 8 | `QuestionsController` | MMCA.ADC.Conference.API | 16 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, Question, QuestionCreateRequest, QuestionDTO, QuestionUpdateRequest, Result, Route, UpdateQuestionCommand |
| 8 | `SessionCategoryItemsController` | MMCA.ADC.Conference.API | 15 | AddSessionCategoryItemCommand, AddSessionCategoryItemRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveSessionCategoryItemCommand, Result, Route, SessionCategoryItem, SessionCategoryItemDTO |
| 8 | `SessionQuestionAnswersController` | MMCA.ADC.Conference.API | 20 | AddSessionQuestionAnswerCommand, AddSessionQuestionAnswerRequest, AuthorizationPolicies, BaseLookup<TIdentifierType>, CollectionResult<T>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, OwnSessionQuestionAnswerSpecification, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveSessionQuestionAnswerCommand, Result, RoleNames, Route, SessionQuestionAnswer, SessionQuestionAnswerDTO, UpdateSessionQuestionAnswerCommand, UpdateSessionQuestionAnswerRequest |
| 8 | `SessionsController` | MMCA.ADC.Conference.API | 25 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, Event, EventDTO, ExportSessionCalendarQuery, GetPublicSessionFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, Result, RoleNames, Route, Session, SessionCreateRequest …(+5) |
| 8 | `SessionSpeakersController` | MMCA.ADC.Conference.API | 15 | AddSessionSpeakerCommand, AddSessionSpeakerRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveSessionSpeakerCommand, Result, Route, SessionSpeaker, SessionSpeakerDTO |
| 8 | `SpeakersController` | MMCA.ADC.Conference.API | 28 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, GetSessionBookmarkCountQuery, GetSessionBookmarkCountsQuery, GetSessionFeedbackQuery, GetSpeakersByEventFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, LinkUserRequest, LinkUserToSpeakerCommand, PagedCollectionResult<T>, QueryFilterModelBinder, Result, RoleNames, Route …(+8) |
| 8 | `CategoryItemsControllerTests` | MMCA.ADC.Conference.API.Tests | 12 | AddCategoryItemCommand, AddCategoryItemRequest, CategoryItem, CategoryItemDTO, CategoryItemsController, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, RemoveCategoryItemCommand, Result, UpdateCategoryItemCommand, UpdateCategoryItemRequest |
| 8 | `EventQuestionAnswersControllerTests` | MMCA.ADC.Conference.API.Tests | 17 | AddEventQuestionAnswerCommand, AddEventQuestionAnswerRequest, CollectionResult<T>, Error, EventQuestionAnswer, EventQuestionAnswerDTO, EventQuestionAnswersController, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, RemoveEventQuestionAnswerCommand, Result, Specification<TEntity, TIdentifierType>, UpdateEventQuestionAnswerCommand, UpdateEventQuestionAnswerRequest |
| 8 | `EventSpeakersControllerTests` | MMCA.ADC.Conference.API.Tests | 10 | AddEventSpeakerCommand, AddEventSpeakerRequest, Error, EventSpeaker, EventSpeakerDTO, EventSpeakersController, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, RemoveEventSpeakerCommand, Result |
| 8 | `RoomsControllerTests` | MMCA.ADC.Conference.API.Tests | 12 | AddRoomCommand, AddRoomRequest, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, RemoveRoomCommand, Result, Room, RoomDTO, RoomsController, UpdateRoomCommand, UpdateRoomRequest |
| 8 | `SpeakerCategoryItemsControllerTests` | MMCA.ADC.Conference.API.Tests | 10 | AddSpeakerCategoryItemCommand, AddSpeakerCategoryItemRequest, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, RemoveSpeakerCategoryItemCommand, Result, SpeakerCategoryItem, SpeakerCategoryItemDTO, SpeakerCategoryItemsController |
| 8 | `AddCategoryItemHandler` | MMCA.ADC.Conference.Application | 8 | AddCategoryItemCommand, Category, CategoryItemDTO, CategoryItemDTOMapper, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result |
| 8 | `AddEventQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 13 | AddEventQuestionAnswerCommand, Error, Event, EventInvariants, EventQuestionAnswer, EventQuestionAnswerDTO, EventQuestionAnswerDTOMapper, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, Question, QuestionInvariants, Result |
| 8 | `AddEventSpeakerHandler` | MMCA.ADC.Conference.Application | 8 | AddEventSpeakerCommand, Error, Event, EventSpeakerDTO, EventSpeakerDTOMapper, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result |
| 8 | `AddRoomHandler` | MMCA.ADC.Conference.Application | 10 | AddRoomCommand, Error, Event, EventInvariants, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, Room, RoomDTO, RoomDTOMapper |
| 8 | `AddSessionCategoryItemCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddSessionCategoryItemCommand |
| 8 | `AddSessionCategoryItemHandler` | MMCA.ADC.Conference.Application | 8 | AddSessionCategoryItemCommand, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, Session, SessionCategoryItemDTO, SessionCategoryItemDTOMapper |
| 8 | `AddSessionQuestionAnswerCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddSessionQuestionAnswerCommand |
| 8 | `AddSessionQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 15 | AddSessionQuestionAnswerCommand, Error, Event, EventInvariants, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, Question, QuestionInvariants, Result, Session, SessionInvariants, SessionQuestionAnswer, SessionQuestionAnswerDTO, SessionQuestionAnswerDTOMapper |
| 8 | `AddSessionSpeakerCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddSessionSpeakerCommand |
| 8 | `AddSessionSpeakerHandler` | MMCA.ADC.Conference.Application | 8 | AddSessionSpeakerCommand, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, Session, SessionSpeakerDTO, SessionSpeakerDTOMapper |
| 8 | `AddSpeakerCategoryItemHandler` | MMCA.ADC.Conference.Application | 8 | AddSpeakerCategoryItemCommand, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, Speaker, SpeakerCategoryItemDTO, SpeakerCategoryItemDTOMapper |
| 8 | `CreateConferenceCategoryHandler` | MMCA.ADC.Conference.Application | 8 | Category, ConferenceCategoryCreateRequest, ConferenceCategoryDTO, ConferenceCategoryDTOMapper, ICommandHandler<in TCommand, TResult>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Result |
| 8 | `CreateEventHandler` | MMCA.ADC.Conference.Application | 8 | Event, EventCreateRequest, EventDTO, EventDTOMapper, ICommandHandler<in TCommand, TResult>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Result |
| 8 | `CreateQuestionHandler` | MMCA.ADC.Conference.Application | 10 | Error, ICommandHandler<in TCommand, TResult>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Question, QuestionCreateRequest, QuestionDTO, QuestionDTOMapper, QuestionInvariants, Result |
| 8 | `CreateSpeakerHandler` | MMCA.ADC.Conference.Application | 8 | ICommandHandler<in TCommand, TResult>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Result, Speaker, SpeakerCreateRequest, SpeakerDTO, SpeakerDTOMapper |
| 8 | `DeleteEventHandler` | MMCA.ADC.Conference.Application | 8 | DeleteEntityCommand<TEntity, TIdentifierType>, Error, Event, ICommandHandler<in TCommand, TResult>, IEventCascadeDeletionDomainService, IUnitOfWork, Result, Session |
| 8 | `EventLiveValidationService` | MMCA.ADC.Conference.Application | 9 | Error, Event, EventLiveInfo, IEventLiveValidationService, IUnitOfWork, Result, Session, SessionInvariants, SessionLiveInfo |
| 8 | `ExportEventCalendarHandler` | MMCA.ADC.Conference.Application | 9 | CalendarExportMapper, Error, Event, ExportEventCalendarQuery, IcsCalendarBuilder, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session |
| 8 | `ExportSessionCalendarHandler` | MMCA.ADC.Conference.Application | 9 | CalendarExportMapper, Error, Event, ExportSessionCalendarQuery, IcsCalendarBuilder, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session |
| 8 | `GetCategoryDistributionHandler` | MMCA.ADC.Conference.Application | 11 | Category, CategoryDistributionDTO, CategoryGroupDistribution, CategoryItemDistribution, GetCategoryDistributionQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session, SessionStatuses, StatusBucket |
| 8 | `GetContentSimilarityHandler` | MMCA.ADC.Conference.Application | 10 | Category, ContentSimilarityDTO, GetContentSimilarityQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session, SessionSimilarityCalculator, SessionStatuses, SimilarSessionPair |
| 8 | `GetNowNextHandler` | MMCA.ADC.Conference.Application | 11 | CalendarExportMapper, CurrentEventSelector, Error, Event, GetNowNextQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, NowNextDTO, NowNextSessionDTO, Result, Session |
| 8 | `GetSessionBookmarkCountHandler` | MMCA.ADC.Conference.Application | 7 | Error, GetSessionBookmarkCountQuery, IBookmarkCountService, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session |
| 8 | `GetSessionBookmarkCountsHandler` | MMCA.ADC.Conference.Application | 6 | GetSessionBookmarkCountsQuery, IBookmarkCountService, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session |
| 8 | `GetSessionFeedbackHandler` | MMCA.ADC.Conference.Application | 10 | Error, GetSessionFeedbackQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Question, RatingQuestionSummary, Result, Session, SessionFeedbackDTO, TextQuestionResponses |
| 8 | `GetSessionSelectionDashboardHandler` | MMCA.ADC.Conference.Application | 22 | Category, CategoryDistributionDTO, CategoryGroupDistribution, CategoryItemDistribution, Error, Event, GetSessionSelectionDashboardQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, MultiSessionSpeaker, Result, Session, SessionAiScore, SessionAiScoreDTO, SessionSelectionDashboardDTO, SessionStatuses, Speaker, SpeakerLocalityHelper, SpeakerLocalitySummary, SpeakerSessionOverlapDTO …(+2) |
| 8 | `GetSpeakersByEventFilterHandler` | MMCA.ADC.Conference.Application | 10 | EventSpeaker, GetSpeakersByEventFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session, SessionSpeaker, Speaker, Specification<TEntity, TIdentifierType> |
| 8 | `GetSpeakerSessionOverlapHandler` | MMCA.ADC.Conference.Application | 12 | Category, GetSpeakerSessionOverlapQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, MultiSessionSpeaker, Result, Session, SessionStatuses, Speaker, SpeakerLocalityHelper, SpeakerSessionOverlapDTO, SpeakerSessionSummary |
| 8 | `LinkUserToSpeakerHandler` | MMCA.ADC.Conference.Application | 7 | Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, LinkUserToSpeakerCommand, Result, Speaker, SpeakerLinkedToUser |
| 8 | `PublishEventHandler` | MMCA.ADC.Conference.Application | 6 | Error, Event, ICommandHandler<in TCommand, TResult>, IUnitOfWork, PublishEventCommand, Result |
| 8 | `RemoveCategoryItemHandler` | MMCA.ADC.Conference.Application | 6 | Category, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, RemoveCategoryItemCommand, Result |
| 8 | `RemoveEventQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 9 | Error, Event, EventQuestionAnswer, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, RemoveEventQuestionAnswerCommand, Result, RoleNames |
| 8 | `RemoveEventSpeakerHandler` | MMCA.ADC.Conference.Application | 6 | Error, Event, ICommandHandler<in TCommand, TResult>, IUnitOfWork, RemoveEventSpeakerCommand, Result |
| 8 | `RemoveRoomHandler` | MMCA.ADC.Conference.Application | 6 | Error, Event, ICommandHandler<in TCommand, TResult>, IUnitOfWork, RemoveRoomCommand, Result |
| 8 | `RemoveSessionCategoryItemHandler` | MMCA.ADC.Conference.Application | 6 | Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, RemoveSessionCategoryItemCommand, Result, Session |
| 8 | `RemoveSessionQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 9 | Error, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, RemoveSessionQuestionAnswerCommand, Result, RoleNames, Session, SessionQuestionAnswer |
| 8 | `RemoveSessionSpeakerHandler` | MMCA.ADC.Conference.Application | 6 | Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, RemoveSessionSpeakerCommand, Result, Session |
| 8 | `RemoveSpeakerCategoryItemHandler` | MMCA.ADC.Conference.Application | 6 | Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, RemoveSpeakerCategoryItemCommand, Result, Speaker |
| 8 | `ScoreEventSessionsHandler` | MMCA.ADC.Conference.Application | 12 | Error, IAiScoringService, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, ScoreEventSessionsCommand, ScoreEventSessionsResultDTO, Session, SessionAiScore, SessionScoringInput, Speaker, SpeakerInfo |
| 8 | `SessionBookmarkValidationService` | MMCA.ADC.Conference.Application | 6 | Error, ISessionBookmarkValidationService, IUnitOfWork, Result, Session, SessionInvariants |
| 8 | `SessionCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result, Session, SessionCreateRequest |
| 8 | `SessionCreateRequestValidator` | MMCA.ADC.Conference.Application | 9 | SessionAccessibilityInfoRules<T>, SessionCreateRequest, SessionDescriptionRules<T>, SessionEventIdRules<T>, SessionLiveUrlRules<T>, SessionRecordingUrlRules<T>, SessionResourceLinksRules<T>, SessionStatusRules<T>, SessionTitleRules<T> |
| 8 | `SessionDTOMapper` | MMCA.ADC.Conference.Application | 6 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, Session, SessionCategoryItemDTOMapper, SessionDTO, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper |
| 8 | `SessionizeSyncContext` | MMCA.ADC.Conference.Application | 3 | Event, IUnitOfWork, SessionizeResponse |
| 8 | `UnlinkUserFromSpeakerHandler` | MMCA.ADC.Conference.Application | 7 | Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, Speaker, SpeakerUnlinkedFromUser, UnlinkUserFromSpeakerCommand |
| 8 | `UnpublishEventHandler` | MMCA.ADC.Conference.Application | 6 | Error, Event, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, UnpublishEventCommand |
| 8 | `UpdateCategoryItemHandler` | MMCA.ADC.Conference.Application | 6 | Category, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, UpdateCategoryItemCommand |
| 8 | `UpdateConferenceCategoryHandler` | MMCA.ADC.Conference.Application | 8 | Category, ConferenceCategoryDTO, ConferenceCategoryDTOMapper, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, UpdateConferenceCategoryCommand |
| 8 | `UpdateEventHandler` | MMCA.ADC.Conference.Application | 9 | Error, Event, EventDTOMapper, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, Session, UpdateEventCommand, UpdateEventResult |
| 8 | `UpdateEventQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 9 | Error, Event, EventQuestionAnswer, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, Result, RoleNames, UpdateEventQuestionAnswerCommand |
| 8 | `UpdateQuestionHandler` | MMCA.ADC.Conference.Application | 10 | Error, EventQuestionAnswer, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Question, QuestionDTO, QuestionDTOMapper, Result, SessionQuestionAnswer, UpdateQuestionCommand |
| 8 | `UpdateRoomHandler` | MMCA.ADC.Conference.Application | 6 | Error, Event, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, UpdateRoomCommand |
| 8 | `UpdateSessionQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 9 | Error, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, Result, RoleNames, Session, SessionQuestionAnswer, UpdateSessionQuestionAnswerCommand |
| 8 | `UpdateSpeakerHandler` | MMCA.ADC.Conference.Application | 8 | Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, Speaker, SpeakerDTO, SpeakerDTOMapper, UpdateSpeakerCommand |
| 8 | `UserRegisteredHandler` | MMCA.ADC.Conference.Application | 8 | Email, IEventBus, IIntegrationEventHandler<in TIntegrationEvent>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Speaker, SpeakerLinkedToUser, UserRegistered |
| 8 | `AddCategoryItemCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | AddCategoryItemCommand, AddCategoryItemCommandValidator, CategoryInvariants |
| 8 | `AddEventQuestionAnswerCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddEventQuestionAnswerCommand, AddEventQuestionAnswerCommandValidator |
| 8 | `AddEventSpeakerCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddEventSpeakerCommand, AddEventSpeakerCommandValidator |
| 8 | `AddRoomCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | AddRoomCommand, AddRoomCommandValidator, EventInvariants |
| 8 | `AddSpeakerCategoryItemCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddSpeakerCategoryItemCommand, AddSpeakerCategoryItemCommandValidator |
| 8 | `CalendarExportMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | CalendarExportMapper, Event, Session |
| 8 | `ConferenceCategoryCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | CategoryInvariants, ConferenceCategoryCreateRequest, ConferenceCategoryCreateRequestValidator |
| 8 | `ConferenceCategoryDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Category, CategoryItemDTOMapper, ConferenceCategoryDTOMapper |
| 8 | `ConferenceCategoryUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | ConferenceCategoryUpdateRequest, ConferenceCategoryUpdateRequestValidator |
| 8 | `ConferenceCategoryValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 5 | CategoryInvariants, TestCategoryItemModel, TestCategoryItemValidator, TestCategoryModel, TestCategoryTitleValidator |
| 8 | `EventCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | EventCreateRequest, EventCreateRequestValidator |
| 8 | `EventDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 5 | Event, EventDTOMapper, EventQuestionAnswerDTOMapper, EventSpeakerDTOMapper, RoomDTOMapper |
| 8 | `GetNowNextQueryCacheTests` | MMCA.ADC.Conference.Application.Tests | 3 | GetNowNextQuery, IQueryCacheable, Session |
| 8 | `OwnSessionQuestionAnswerSpecificationTests` | MMCA.ADC.Conference.Application.Tests | 2 | OwnSessionQuestionAnswerSpecification, Session |
| 8 | `QuestionCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | QuestionCreateRequest, QuestionCreateRequestValidator, QuestionInvariants |
| 8 | `RecordingUnitOfWork` | MMCA.ADC.Conference.Application.Tests | 6 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, InMemoryRepository<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork |
| 8 | `SessionCategoryItemDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Session, SessionCategoryItem, SessionCategoryItemDTOMapper |
| 8 | `SessionQuestionAnswerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Session, SessionQuestionAnswer, SessionQuestionAnswerDTOMapper |
| 8 | `SessionRoomSchedulingTests` | MMCA.ADC.Conference.Application.Tests | 3 | ErrorType, Session, SessionRoomScheduling |
| 8 | `SessionSpeakerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Session, SessionSpeaker, SessionSpeakerDTOMapper |
| 8 | `SpeakerCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | Email, SpeakerCreateRequest, SpeakerCreateRequestValidator |
| 8 | `SpeakerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 5 | ICurrentUserService, Speaker, SpeakerCategoryItemDTOMapper, SpeakerDTOMapper, SpeakerQuestionAnswerDTOMapper |
| 8 | `UpdateCategoryItemCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | CategoryInvariants, UpdateCategoryItemCommand, UpdateCategoryItemCommandValidator |
| 8 | `UpdateRoomCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | EventInvariants, UpdateRoomCommand, UpdateRoomCommandValidator |
| 8 | `EventCascadeDeletionDomainService` | MMCA.ADC.Conference.Domain | 4 | Event, IEventCascadeDeletionDomainService, Result, Session |
| 8 | `SessionCategoryItemTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, ErrorType, SessionBuilder, SessionCategoryItem, SessionCategoryItemChanged |
| 8 | `SessionQuestionAnswerTests` | MMCA.ADC.Conference.Domain.Tests | 6 | DomainEntityState, ErrorType, SessionBuilder, SessionInvariants, SessionQuestionAnswer, SessionQuestionAnswerChanged |
| 8 | `SessionSpeakerTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, ErrorType, SessionBuilder, SessionSpeaker, SessionSpeakerChanged |
| 8 | `CategoryItemConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | CategoryInvariants, CategoryItem, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 8 | `ConferenceCategoryConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | Category, CategoryInvariants, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 8 | `ConferenceModuleDbSeeder` | MMCA.ADC.Conference.Infrastructure | 9 | DbSeeder, Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question, QuestionInvariants, Session, SessionInvariants, Speaker |
| 8 | `EventConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Event, EventInvariants |
| 8 | `EventQuestionAnswerConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, EventInvariants, EventQuestionAnswer |
| 8 | `EventSpeakerConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, EventSpeaker |
| 8 | `QuestionConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Question, QuestionInvariants |
| 8 | `RoomConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, EventInvariants, Room |
| 8 | `SessionAiScoreConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionAiScore |
| 8 | `SessionCategoryItemConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionCategoryItem |
| 8 | `SessionConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Session, SessionInvariants |
| 8 | `SessionQuestionAnswerConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionInvariants, SessionQuestionAnswer |
| 8 | `SessionSpeakerConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionSpeaker |
| 8 | `SpeakerCategoryItemConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SpeakerCategoryItem |
| 8 | `SpeakerConfiguration` | MMCA.ADC.Conference.Infrastructure | 4 | Email, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Speaker, SpeakerInvariants |
| 8 | `SpeakerQuestionAnswerConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SpeakerInvariants, SpeakerQuestionAnswer |
| 8 | `SeederMocks` | MMCA.ADC.Conference.Infrastructure.Tests | 4 | Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question |
| 8 | `CurrentEventDefaultsTests` | MMCA.ADC.Conference.Shared.Tests | 3 | CurrentEventDefaults, Event, EventDTO |
| 8 | `PublicSessionList` | MMCA.ADC.Conference.UI | 17 | BookmarkService, CachedSessionPage, CurrentEventDefaults, DataGridListPageBase<TDto>, EventDTO, EventService, IConnectivityStatusService, IEventUIService, ILocalCacheStore, ISessionBookmarkUIService, ISessionUIService, ISpeakerLookupService, PublicSessionListView, RoleNames, SessionDTO, SessionService, SpeakerInfo |
| 8 | `SessionList` | MMCA.ADC.Conference.UI | 14 | ConferenceRoutePaths, CurrentEventDefaults, DataGridListPageBase<TDto>, ErrorMessages, EventDTO, EventService, IEventUIService, ISessionUIService, ISpeakerLookupService, ListPageActions, MobileInfiniteScrollList<TItem>, SessionDTO, SessionService, SpeakerInfo |
| 8 | `PublicSessionDetailLiveButtonTests` | MMCA.ADC.Conference.UI.Tests | 11 | BunitTestBase, CategoryItemInfo, ICategoryItemLookupService, IRoomUIService, ISessionBookmarkUIService, ISessionLiveUIService, ISessionUIService, ISpeakerLookupService, PublicSessionDetail, SessionDTO, SpeakerInfo |
| 8 | `PublicSessionDetailTests` | MMCA.ADC.Conference.UI.Tests | 12 | BunitTestBase, CategoryItemInfo, ICategoryItemLookupService, IHapticFeedbackService, IRoomUIService, ISessionBookmarkUIService, ISessionLiveUIService, ISessionUIService, ISpeakerLookupService, PublicSessionDetail, SessionDTO, SpeakerInfo |
| 8 | `PublicSpeakerListEventFilterTests` | MMCA.ADC.Conference.UI.Tests | 8 | BunitTestBase, EventInfo, IEventLookupService, ISpeakerUIService, ListPageQueryStateService, ListPageStateService, PublicSpeakerList, TestPrincipal |
| 8 | `SessionSelectionDashboardTests` | MMCA.ADC.Conference.UI.Tests | 16 | BunitTestBase, CategoryDistributionDTO, CategoryGroupDistribution, CategoryItemDistribution, EventInfo, IEventLookupService, ISessionSelectionUIService, MultiSessionSpeaker, ScoreEventSessionsResultDTO, SessionAiScoreDTO, SessionSelectionDashboard, SessionSelectionDashboardDTO, Speaker, SpeakerLocalitySummary, SpeakerSessionOverlapDTO, SpeakerSessionSummary |
| 8 | `SpeakerDashboardTests` | MMCA.ADC.Conference.UI.Tests | 14 | BunitTestBase, EventInfo, IEventLookupService, ISpeakerDashboardUIService, ISpeakerUIService, RatingQuestionSummary, Session, SessionDTO, SessionFeedbackDTO, Speaker, SpeakerDashboard, SpeakerDTO, TestPrincipal, TextQuestionResponses |
| 8 | `BookmarksControllerTests` | MMCA.ADC.Engagement.API.Tests | 17 | BookmarksController, ControllerMocks, CreateBookmarkRequest, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetBookmarkedSessionIdsQuery, GetUserBookmarksQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, OwnerOrAdminFilter, PagedCollectionResult<T>, PaginationMetadata, Result, UserSessionBookmark, UserSessionBookmarkDTO |
| 8 | `LivePollsControllerTests` | MMCA.ADC.Engagement.API.Tests | 22 | CastVoteCommand, CastVoteRequest, CloseLivePollCommand, ControllerMocks, CreateLivePollCommand, CreateLivePollRequest, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetEventPollsQuery, GetOpenPollsQuery, GetPollResultsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, LivePoll, LivePollDTO, LivePollResultsDTO, LivePollsController, LivePollStatus, OpenLivePollCommand …(+2) |
| 8 | `SessionQuestionsControllerTests` | MMCA.ADC.Engagement.API.Tests | 16 | ControllerMocks, Error, GetModerationQueueQuery, GetSessionQuestionsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, ModerateQuestionCommand, ModerationAction, QuestionStatus, Result, SessionQuestionDTO, SessionQuestionsController, SubmitQuestionCommand, SubmitQuestionRequest, ToggleUpvoteCommand |
| 8 | `BookmarkCountService` | MMCA.ADC.Engagement.Application | 4 | IBookmarkCountService, IQueryableExecutor, IUnitOfWork, UserSessionBookmark |
| 8 | `CloseLivePollHandler` | MMCA.ADC.Engagement.Application | 12 | CloseLivePollCommand, Error, ICommandHandler<in TCommand, TResult>, IEventLiveValidationService, ILiveChannelPublishQueue, IUnitOfWork, LiveChannelPublishWorkItem, LivePoll, LivePollAuthorization, LivePollChannel, LivePollClosedPayload, Result |
| 8 | `CreateBookmarkHandler` | MMCA.ADC.Engagement.Application | 10 | CreateBookmarkRequest, Error, IBookmarkManagementDomainService, ICommandHandler<in TCommand, TResult>, ISessionBookmarkValidationService, IUnitOfWork, Result, UserSessionBookmark, UserSessionBookmarkDTO, UserSessionBookmarkDTOMapper |
| 8 | `CreateLivePollHandler` | MMCA.ADC.Engagement.Application | 10 | CreateLivePollCommand, Error, ICommandHandler<in TCommand, TResult>, IEventLiveValidationService, IUnitOfWork, LivePoll, LivePollAuthorization, LivePollDTO, LivePollDTOMapper, Result |
| 8 | `GetBookmarkedSessionIdsHandler` | MMCA.ADC.Engagement.Application | 5 | GetBookmarkedSessionIdsQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, UserSessionBookmark |
| 8 | `GetEventPollsHandler` | MMCA.ADC.Engagement.Application | 7 | GetEventPollsQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePoll, LivePollDTO, LivePollDTOMapper, Result |
| 8 | `GetUserBookmarksHandler` | MMCA.ADC.Engagement.Application | 11 | GetUserBookmarksQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, ISessionBookmarkValidationService, IUnitOfWork, PagedCollectionResult<T>, PaginationMetadata, Result, UserSessionBookmark, UserSessionBookmarkDTO, UserSessionBookmarkDTOMapper |
| 8 | `LivePollResultsBuilder` | MMCA.ADC.Engagement.Application | 7 | IQueryableExecutor, IUnitOfWork, LivePoll, LivePollOptionResultDTO, LivePollResultsDTO, LivePollVote, Question |
| 8 | `ModerateQuestionHandler` | MMCA.ADC.Engagement.Application | 17 | Error, ICommandHandler<in TCommand, TResult>, IEventLiveValidationService, ILiveChannelPublisher, IUnitOfWork, LivePollAuthorization, LivePollChannel, ModerateQuestionCommand, ModerationAction, QuestionStatus, Result, SessionQuestion, SessionQuestionAnsweredPayload, SessionQuestionApprovedPayload, SessionQuestionChannel, SessionQuestionDismissedPayload, SessionQuestionPendingCountChangedPayload |
| 8 | `OpenLivePollHandler` | MMCA.ADC.Engagement.Application | 11 | Error, ICommandHandler<in TCommand, TResult>, IEventLiveValidationService, ILiveChannelPublisher, IUnitOfWork, LivePoll, LivePollAuthorization, LivePollChannel, LivePollOpenedPayload, OpenLivePollCommand, Result |
| 8 | `SessionQuestionViewBuilder` | MMCA.ADC.Engagement.Application | 5 | IQueryableExecutor, IUnitOfWork, SessionQuestion, SessionQuestionDTO, SessionQuestionUpvote |
| 8 | `ToggleUpvoteHandler` | MMCA.ADC.Engagement.Application | 12 | Error, ICommandHandler<in TCommand, TResult>, ILiveChannelPublisher, IRepository<TEntity, TIdentifierType>, IUnitOfWork, LivePollChannel, Result, SessionQuestion, SessionQuestionChannel, SessionQuestionUpvote, SessionQuestionUpvoteChangedPayload, ToggleUpvoteCommand |
| 8 | `UserEngagementExportService` | MMCA.ADC.Engagement.Application | 7 | IUnitOfWork, IUserEngagementExportService, SessionQuestion, UserEngagementBookmarkExportDTO, UserEngagementExportDTO, UserEngagementSubmittedQuestionExportDTO, UserSessionBookmark |
| 8 | `HandlerMocks` | MMCA.ADC.Engagement.Application.Tests | 7 | IEventLiveValidationService, ILiveChannelPublisher, ILiveChannelPublishQueue, IRepository<TEntity, TIdentifierType>, IUnitOfWork, LivePoll, LivePollVote |
| 8 | `HandlerMocks` | MMCA.ADC.Engagement.Application.Tests | 6 | IEventLiveValidationService, ILiveChannelPublisher, IRepository<TEntity, TIdentifierType>, IUnitOfWork, SessionQuestion, SessionQuestionUpvote |
| 8 | `HandlerMocks` | MMCA.ADC.Engagement.Application.Tests | 5 | IQueryableExecutor, IRepository<TEntity, TIdentifierType>, ISessionBookmarkValidationService, IUnitOfWork, UserSessionBookmark |
| 8 | `LivePollDTOMapperTests` | MMCA.ADC.Engagement.Application.Tests | 3 | LivePoll, LivePollDTOMapper, LivePollStatus |
| 8 | `BookmarkManagementDomainServiceTests` | MMCA.ADC.Engagement.Domain.Tests | 2 | BookmarkManagementDomainService, UserSessionBookmark |
| 8 | `LivePollConfiguration` | MMCA.ADC.Engagement.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, LivePoll, LivePollInvariants |
| 8 | `LivePollOptionConfiguration` | MMCA.ADC.Engagement.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, LivePollInvariants, LivePollOption |
| 8 | `LivePollVoteConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, LivePollVote |
| 8 | `SessionQuestionConfiguration` | MMCA.ADC.Engagement.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionQuestion, SessionQuestionInvariants |
| 8 | `SessionQuestionUpvoteConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionQuestionUpvote |
| 8 | `UserSessionBookmarkConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, UserSessionBookmark |
| 8 | `DependencyInjection` | MMCA.ADC.Engagement.UI | 23 | BookmarkService, EngagementUIModule, EventFeedbackService, IBookmarkUIService, IEventFeedbackUIService, ILiveEventUIService, ILivePollUIService, IQuestionLookupService, ISessionBookmarkUIService, ISessionFeedbackUIService, ISessionLiveUIService, ISessionLookupService, ISessionQuestionUIService, IUIModule, LiveEventService, LivePollUIService, QuestionLookupService, SessionBookmarkUIService, SessionFeedbackService, SessionLiveUIService …(+3) |
| 8 | `HappeningNow` | MMCA.ADC.Engagement.UI | 17 | CreateLivePollRequest, ErrorMessages, IHapticFeedbackService, ILiveEventUIService, ILivePollUIService, ISessionLookupService, LiveEventContext, LiveEventService, LivePollChannel, LivePollDTO, LivePollResultsDTO, NotificationHubService, NotificationState, OptionState, Question, RoleNames, SessionInfo |
| 8 | `UsersController` | MMCA.ADC.Identity.API | 18 | ApiControllerBase, DeleteUserCommand, Error, ExportUserDataQuery, GetUserAvatarQuery, GetUsersQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IdentityPermissions, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, RemoveUserAvatarCommand, Result, Route, SetUserAvatarCommand, UserAvatarDTO, UserDataExportDTO, UserListDTO |
| 8 | `OAuthControllerTests` | MMCA.ADC.Identity.API.Tests | 7 | AuthenticationResponse, Error, IAuthenticationService, ICacheService, OAuthCodeExchangeRequest, OAuthController, Result |
| 8 | `AttendeeQueryService` | MMCA.ADC.Identity.Application | 4 | IAttendeeQueryService, IUnitOfWork, User, UserRole |
| 8 | `ChangePasswordHandler` | MMCA.ADC.Identity.Application | 7 | ChangePasswordCommand, Error, ICommandHandler<in TCommand, TResult>, IPasswordHasher, IUnitOfWork, Result, User |
| 8 | `ChangePreferencesHandler` | MMCA.ADC.Identity.Application | 6 | ChangePreferencesCommand, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result, User |
| 8 | `DeleteUserHandler` | MMCA.ADC.Identity.Application | 8 | DeleteUserCommand, Error, ICommandHandler<in TCommand, TResult>, IFileStorageService, IUnitOfWork, Result, User, UserRole |
| 8 | `ExportUserDataHandler` | MMCA.ADC.Identity.Application | 16 | Email, Error, ExportUserDataQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, IUserEngagementExportService, IUserNotificationExportService, Result, User, UserDataExportBookmarkDTO, UserDataExportDTO, UserDataExportEngagementSectionDTO, UserDataExportNotificationDTO, UserDataExportNotificationSectionDTO, UserDataExportSubmittedQuestionDTO, UserRole |
| 8 | `GetUserAvatarHandler` | MMCA.ADC.Identity.Application | 7 | Error, GetUserAvatarQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, User, UserAvatarDTO |
| 8 | `GetUserPreferencesHandler` | MMCA.ADC.Identity.Application | 7 | Error, GetUserPreferencesQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, User, UserPreferencesResponse |
| 8 | `GetUsersHandler` | MMCA.ADC.Identity.Application | 10 | Email, GetUsersQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PagedCollectionResult<T>, PaginationMetadata, Result, User, UserListDTO |
| 8 | `SetUserAvatarHandler` | MMCA.ADC.Identity.Application | 10 | Error, ICommandHandler<in TCommand, TResult>, IFileStorageService, IImageProcessor, ImageContentSniffer, IUnitOfWork, Result, SetUserAvatarCommand, User, UserAvatarDTO |
| 8 | `SoftDeletedUserValidator` | MMCA.ADC.Identity.Application | 3 | ISoftDeletedUserValidator, IUnitOfWork, User |
| 8 | `SpeakerLinkedToUserHandler` | MMCA.ADC.Identity.Application | 4 | IIntegrationEventHandler<in TIntegrationEvent>, IUnitOfWork, SpeakerLinkedToUser, User |
| 8 | `SpeakerUnlinkedFromUserHandler` | MMCA.ADC.Identity.Application | 4 | IIntegrationEventHandler<in TIntegrationEvent>, IUnitOfWork, SpeakerUnlinkedFromUser, User |
| 8 | `RecordingUnitOfWork` | MMCA.ADC.Identity.Application.Tests | 6 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, InMemoryRepository<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork |
| 8 | `ServiceMocks` | MMCA.ADC.Identity.Application.Tests | 10 | IExternalLoginEmailVerifier, ILoginProtectionService, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, LoginRequest, RefreshTokenRequest, RegisterRequest, User |
| 8 | `UserDTOMapperTests` | MMCA.ADC.Identity.Application.Tests | 3 | User, UserDTOMapper, UserRole |
| 8 | `IdentityModuleDbSeeder` | MMCA.ADC.Identity.Infrastructure | 6 | DbSeeder, Email, IPasswordHasher, IUnitOfWork, User, UserRole |
| 8 | `UserConfiguration` | MMCA.ADC.Identity.Infrastructure | 4 | Email, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, User, UserInvariants |
| 8 | `SeederMocks` | MMCA.ADC.Identity.Infrastructure.Tests | 4 | IPasswordHasher, IRepository<TEntity, TIdentifierType>, IUnitOfWork, User |
| 8 | `UserNotificationExportService` | MMCA.ADC.Notification.Application | 6 | IQueryableExecutor, IUnitOfWork, IUserNotificationExportService, PushNotification, UserNotification, UserNotificationExportItemDTO |
| 8 | `ADCHomePageContent` | MMCA.ADC.UI | 2 | ADCHome, IHomePageContent |
| 8 | `DatabaseInitializationExtensions` | MMCA.Common.API | 7 | ApplicationSettings, DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, ModuleLoader |
| 8 | `EntityControllerBaseTests` | MMCA.Common.API.Tests | 13 | BaseLookup<TIdentifierType>, CollectionResult<T>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, IApplicationSettings, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, Result, Specification<TEntity, TIdentifierType>, TestDTO, TestEntity, TestEntityController |
| 8 | `InitTestWidgetConfiguration` | MMCA.Common.API.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, InitTestWidget |
| 8 | `OAuthControllerBaseTests` | MMCA.Common.API.Tests | 10 | AuthenticationResponse, Error, ExternalAuthExtensions, IAuthenticationService, ICacheService, Mocks, OAuthCodeExchangeRequest, Result, SingleServiceProvider, TestOAuthController |
| 8 | `TestAggregateRootController` | MMCA.Common.API.Tests | 9 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, TestAggDTO, TestAggregateEntity, TestCreateRequest |
| 8 | `AuthenticationServiceBase<TUser>` | MMCA.Common.Application | 16 | AuditableAggregateRootEntity<TIdentifierType>, AuthenticationResponse, AuthenticationValidators, Email, Error, IAuthenticationService, IAuthUser, ILoginProtectionService, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, LoginRequest, RefreshTokenRequest, RegisterRequest, Result |
| 8 | `CrossSourceSpecification` | MMCA.Common.Application | 6 | AuditableBaseEntity<TIdentifierType>, IBaseEntity<TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IUnitOfWork, ParameterReplacer, Specification<TEntity, TIdentifierType> |
| 8 | `DeleteEntityHandler<TEntity, TIdentifierType>` | MMCA.Common.Application | 6 | AuditableAggregateRootEntity<TIdentifierType>, DeleteEntityCommand<TEntity, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, Result |
| 8 | `EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.Application | 19 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, EntityQueryParameters<TEntity>, Error, IBaseDTO<TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, NavigationMetadataProvider, PagedCollectionResult<T>, PaginationMetadata, QueryFieldService, QueryFilterService, Result, Specification<TEntity, TIdentifierType> |
| 8 | `GetMyNotificationsHandler` | MMCA.Common.Application | 10 | GetMyNotificationsQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PagedCollectionResult<T>, PaginationMetadata, PushNotification, Result, UserNotification, UserNotificationDTO |
| 8 | `GetNotificationHistoryHandler` | MMCA.Common.Application | 10 | GetNotificationHistoryQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PagedCollectionResult<T>, PaginationMetadata, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, Result |
| 8 | `GetUnreadNotificationCountHandler` | MMCA.Common.Application | 6 | GetUnreadNotificationCountQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, UserNotification |
| 8 | `INavigationDescriptor<in TEntity>` | MMCA.Common.Application | 1 | IUnitOfWork |
| 8 | `MarkAllNotificationsReadHandler` | MMCA.Common.Application | 6 | ICommandHandler<in TCommand, TResult>, IQueryableExecutor, IUnitOfWork, MarkAllNotificationsReadCommand, Result, UserNotification |
| 8 | `MarkNotificationReadHandler` | MMCA.Common.Application | 7 | Error, ICommandHandler<in TCommand, TResult>, IQueryableExecutor, IUnitOfWork, MarkNotificationReadCommand, Result, UserNotification |
| 8 | `SendPushNotificationHandler` | MMCA.Common.Application | 12 | Error, ICommandHandler<in TCommand, TResult>, INativePushSender, INotificationRecipientProvider, IPushNotificationSender, IUnitOfWork, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, Result, SendPushNotificationCommand, UserNotification |
| 8 | `TransactionalCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 3 | ICommandHandler<in TCommand, TResult>, ITransactional, IUnitOfWork |
| 8 | `HandlerMocks` | MMCA.Common.Application.Tests | 8 | INativePushSender, INotificationRecipientProvider, IPushNotificationSender, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, PushNotification, UserNotification |
| 8 | `ServiceMocks` | MMCA.Common.Application.Tests | 6 | ILoginProtectionService, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, TestAuthUser |
| 8 | `AggregateConventionTests` | MMCA.Common.Architecture.Tests | 3 | AggregateConventionTestsBase, CommonArchitectureMap, IArchitectureMap |
| 8 | `DomainPurityTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, DomainPurityTestsBase, IArchitectureMap |
| 8 | `EventVersioningConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, EventConventionTestsBase, IArchitectureMap |
| 8 | `HandlerResultConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, HandlerResultConventionTestsBase, IArchitectureMap |
| 8 | `LayerDependencyTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, LayerDependencyTestsBase |
| 8 | `LocalizedTextConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, LocalizedTextConventionTestsBase |
| 8 | `MicroserviceExtractionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, MicroserviceExtractionTestsBase |
| 8 | `PiiConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, PiiConventionTestsBase |
| 8 | `RawQueryableConventionTests` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, CommonArchitectureMap, IArchitectureMap, RawQueryableConventionTestsBase |
| 8 | `SliceCohesionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, SliceCohesionTestsBase |
| 8 | `StateManagementConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, StateManagementConventionTestsBase |
| 8 | `UIArchitectureConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, UIArchitectureConventionTestsBase |
| 8 | `ApplicationDbContextEFFactory` | MMCA.Common.Infrastructure | 6 | ApplicationDbContext, CosmosDbContext, DataSource, IDbContextFactory, SqliteDbContext, SQLServerDbContext |
| 8 | `BrokerEventBus` | MMCA.Common.Infrastructure | 7 | IDataSourceResolver, IDbContextFactory, IEventBus, IIntegrationEvent, IOutboxSignal, OutboxMessage, OutboxSettings |
| 8 | `DbContextFactory` | MMCA.Common.Infrastructure | 13 | ApplicationDbContext, CosmosDbContext, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, ICurrentUserService, IDataSourceResolver, IDbContextFactory, IdentityInsertGroup, IEntityDataSourceRegistry, IPhysicalDbContextFactory, Result, SQLServerDbContext |
| 8 | `DefaultCosmosDbContextFactory` | MMCA.Common.Infrastructure | 5 | CosmosDbContext, DataSource, DataSourceKey, IDbContextFactory, IPhysicalDbContextFactory |
| 8 | `DefaultSqliteDbContextFactory` | MMCA.Common.Infrastructure | 5 | DataSource, DataSourceKey, IDbContextFactory, IPhysicalDbContextFactory, SqliteDbContext |
| 8 | `DefaultSqlServerDbContextFactory` | MMCA.Common.Infrastructure | 5 | DataSource, DataSourceKey, IDbContextFactory, IPhysicalDbContextFactory, SQLServerDbContext |
| 8 | `DesignTimeDbContextHelper` | MMCA.Common.Infrastructure | 17 | AuditSaveChangesInterceptor, DataSource, DataSourceKey, DataSourceResolver, DataSourcesSettings, DesignTimeDbContextOptions, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, ExplicitAssemblyProvider, IDataSourceResolver, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IOutboxSignal, NullDomainEventDispatcher, OutboxSignal, SQLServerDbContext |
| 8 | `EfInboxStore` | MMCA.Common.Infrastructure | 6 | ApplicationDbContext, IDataSourceResolver, IDbContextFactory, IInboxStore, InboxMessage, OutboxSettings |
| 8 | `InProcessEventBus` | MMCA.Common.Infrastructure | 8 | IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEventBus, IIntegrationEvent, OutboxFinalizer, OutboxMessage, OutboxSettings |
| 8 | `OutboxCleanupService` | MMCA.Common.Infrastructure | 9 | DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, InboxMessage, MessageBusSettings, OutboxMessage, OutboxSettings |
| 8 | `OutboxProcessor` | MMCA.Common.Infrastructure | 13 | ApplicationDbContext, DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEntityDataSourceRegistry, IIntegrationEvent, IMessageBus, IOutboxSignal, OutboxCycleResult, OutboxMessage, OutboxSettings |
| 8 | `PhysicalDbContextFactory` | MMCA.Common.Infrastructure | 9 | ApplicationDbContext, CosmosDbContext, DataSource, DataSourceKey, IDataSourceResolver, IEntityConfigurationAssemblyProvider, IPhysicalDbContextFactory, SqliteDbContext, SQLServerDbContext |
| 8 | `PushNotificationConfiguration` | MMCA.Common.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, PushNotification |
| 8 | `RepositoryFactory` | MMCA.Common.Infrastructure | 10 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, EFReadRepository<TEntity, TIdentifierType>, EFReadRepositoryDecorator<TEntity, TIdentifierType>, EFRepository<TEntity, TIdentifierType>, EFRepositoryDecorator<TEntity, TIdentifierType>, IApplicationSettings, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRepositoryFactory |
| 8 | `UnitOfWork` | MMCA.Common.Infrastructure | 8 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IDataSourceService, IDbContextFactory, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRepositoryFactory, IUnitOfWork |
| 8 | `UserNotificationConfiguration` | MMCA.Common.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, UserNotification |
| 8 | `ApplicationDbContextTests` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, DataSource, TestApplicationDbContext, TestEntity |
| 8 | `AuditSaveChangesInterceptorTests` | MMCA.Common.Infrastructure.Tests | 4 | AuditSaveChangesInterceptor, FakeTimeProvider, TestAuditDbContext, TestAuditEntity |
| 8 | `ClaimBasedUserIdProviderTests` | MMCA.Common.Infrastructure.Tests | 2 | ClaimBasedUserIdProvider, TestConnectionContext |
| 8 | `CrossDataSourceDegradeConventionTests` | MMCA.Common.Infrastructure.Tests | 14 | AuditSaveChangesInterceptor, DataSource, DataSourceKey, DataSourceModelCacheKeyFactory, DegradeCustomer, DegradeOrder, DegradeTestContext, DomainEventSaveChangesInterceptor, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, MapRegistry, OutboxSignal, PhysicalDataSource |
| 8 | `CurrentUserServiceAdditionalTests` | MMCA.Common.Infrastructure.Tests | 2 | CurrentUserService, User |
| 8 | `CurrentUserServiceTests` | MMCA.Common.Infrastructure.Tests | 2 | CurrentUserService, User |
| 8 | `DependencyInjectionAdditionalTests` | MMCA.Common.Infrastructure.Tests | 6 | EntityConfigurationOptions, IDataSourceService, IDbContextFactory, IQueryableExecutor, IRepositoryFactory, IUnitOfWork |
| 8 | `DesignAlphaEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | DesignAlphaEntity, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 8 | `DesignBetaEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | DesignBetaEntity, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 8 | `DomainEventSaveChangesInterceptorOutboxRoutingTests` | MMCA.Common.Infrastructure.Tests | 9 | DomainEventSaveChangesInterceptor, IDomainEvent, IDomainEventDispatcher, IOutboxSignal, OutboxMessage, OutboxRoutingTestDbContext, TestAggregate, TestIntegrationEvent, TestLocalEvent |
| 8 | `DomainEventSaveChangesInterceptorTests` | MMCA.Common.Infrastructure.Tests | 7 | DomainEventSaveChangesInterceptor, IDomainEvent, IDomainEventDispatcher, IOutboxSignal, TestAggregate, TestDomainEvent, TestDomainEventDbContext |
| 8 | `EFRepositoryAdditionalTests` | MMCA.Common.Infrastructure.Tests | 3 | EFRepository<TEntity, TIdentifierType>, TestDbContext, TestEntity |
| 8 | `EFRepositoryDecoratorAdditionalTests` | MMCA.Common.Infrastructure.Tests | 3 | EFRepositoryDecorator<TEntity, TIdentifierType>, FakeAggregateEntity, IRepository<TEntity, TIdentifierType> |
| 8 | `EFRepositoryDecoratorTests` | MMCA.Common.Infrastructure.Tests | 3 | EFRepositoryDecorator<TEntity, TIdentifierType>, FakeAggregateEntity, IRepository<TEntity, TIdentifierType> |
| 8 | `EFRepositoryIntegrationTests` | MMCA.Common.Infrastructure.Tests | 5 | EFReadRepository<TEntity, TIdentifierType>, EFRepository<TEntity, TIdentifierType>, TestChildEntity, TestDbContext, TestEntity |
| 8 | `EntityTypeConfigurationBaseTests` | MMCA.Common.Infrastructure.Tests | 6 | TestAggregateEntity, TestAggregateEntityConfiguration, TestConfigDbContext, TestNonAggregateConfigDbContext, TestNonAggregateEntity, TestNonAggregateEntityConfiguration |
| 8 | `Mocks` | MMCA.Common.Infrastructure.Tests | 4 | IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IOutboxSignal |
| 8 | `MultiSourceCustomerConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, MultiSourceCustomer |
| 8 | `MultiSourceOrderConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, MultiSourceOrder |
| 8 | `PortablePrincipalConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, PortablePrincipal |
| 8 | `RegistryDuplicateConfigurationA` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryDuplicate |
| 8 | `RegistryDuplicateConfigurationB` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryDuplicate |
| 8 | `RegistryInvoiceConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryInvoice |
| 8 | `RegistryOrderConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryOrder |
| 8 | `RegistrySqlServerEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, RegistrySqlServerEntity |
| 8 | `SoftDeleteQueryFilterTests` | MMCA.Common.Infrastructure.Tests | 2 | SoftDeletableEntity, SoftDeleteTestDbContext |
| 8 | `SoftDeleteUniqueIndexConventionTests` | MMCA.Common.Infrastructure.Tests | 3 | FilteredIndexEntity, UniqueIndexTestDbContext, UniqueNamedEntity |
| 8 | `SqliteTestEntityConfig` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, SqliteTestEntity |
| 8 | `GalleryHost` | MMCA.Common.UI.Gallery | 16 | GalleryAuthenticationStateProvider, GalleryFakeAuthenticationHandler, GalleryUIModule, IAuthUIService, INotificationInboxUIService, IPushNotificationUIService, ITokenRefresher, ITokenStorageService, IUIModule, NoOpAuthUIService, NotificationState, NullTokenRefresher, NullTokenStorageService, StubNotificationInboxUIService, StubPushNotificationUIService, SupportedCultures |
| 9 | `AdcArchitectureMap` | MMCA.ADC.Architecture.Tests | 17 | ApiControllerBase, ApplicationDbContext, ArchitectureMapBase, BaseEntity<TIdentifierType>, ConferenceModule, EngagementModule, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Event, EventDTO, IdentityModule, Layer, LayerRef, Result, User, UserDTO, UserSessionBookmark, UserSessionBookmarkDTO |
| 9 | `ConferenceModuleSeeder` | MMCA.ADC.Conference.API | 3 | ConferenceModuleDbSeeder, IModuleSeeder, IUnitOfWork |
| 9 | `ConferenceCategoriesControllerTests` | MMCA.ADC.Conference.API.Tests | 11 | Category, ConferenceCategoriesController, ConferenceCategoryCreateRequest, ConferenceCategoryDTO, ConferenceCategoryUpdateRequest, DeleteEntityCommand<TEntity, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, UpdateConferenceCategoryCommand |
| 9 | `EventsControllerTests` | MMCA.ADC.Conference.API.Tests | 26 | CollectionResult<T>, DeleteEntityCommand<TEntity, TIdentifierType>, Error, ErrorType, Event, EventCreateRequest, EventDTO, EventsController, EventUpdateRequest, ExportEventCalendarQuery, GetNowNextQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, NowNextDTO, PagedCollectionResult<T>, PaginationMetadata, PublishEventCommand, RefreshFromSessionizeCommand …(+6) |
| 9 | `QuestionsControllerTests` | MMCA.ADC.Conference.API.Tests | 11 | DeleteEntityCommand<TEntity, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Question, QuestionCreateRequest, QuestionDTO, QuestionsController, QuestionUpdateRequest, Result, UpdateQuestionCommand |
| 9 | `SessionCategoryItemsControllerTests` | MMCA.ADC.Conference.API.Tests | 10 | AddSessionCategoryItemCommand, AddSessionCategoryItemRequest, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, RemoveSessionCategoryItemCommand, Result, SessionCategoryItem, SessionCategoryItemDTO, SessionCategoryItemsController |
| 9 | `SessionQuestionAnswersControllerTests` | MMCA.ADC.Conference.API.Tests | 17 | AddSessionQuestionAnswerCommand, AddSessionQuestionAnswerRequest, CollectionResult<T>, Error, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, RemoveSessionQuestionAnswerCommand, Result, SessionQuestionAnswer, SessionQuestionAnswerDTO, SessionQuestionAnswersController, Specification<TEntity, TIdentifierType>, UpdateSessionQuestionAnswerCommand, UpdateSessionQuestionAnswerRequest |
| 9 | `SessionsControllerTests` | MMCA.ADC.Conference.API.Tests | 22 | CollectionResult<T>, DeleteEntityCommand<TEntity, TIdentifierType>, Error, Event, EventDTO, ExportSessionCalendarQuery, GetPublicSessionFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, PaginationMetadata, Result, Session, SessionCreateRequest, SessionDTO, SessionsController, SessionUpdateRequest, Specification<TEntity, TIdentifierType> …(+2) |
| 9 | `SessionSpeakersControllerTests` | MMCA.ADC.Conference.API.Tests | 10 | AddSessionSpeakerCommand, AddSessionSpeakerRequest, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, RemoveSessionSpeakerCommand, Result, SessionSpeaker, SessionSpeakerDTO, SessionSpeakersController |
| 9 | `SpeakersControllerTests` | MMCA.ADC.Conference.API.Tests | 24 | DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetSessionBookmarkCountQuery, GetSessionBookmarkCountsQuery, GetSessionFeedbackQuery, GetSpeakersByEventFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, LinkUserRequest, LinkUserToSpeakerCommand, PagedCollectionResult<T>, Result, SessionFeedbackDTO, Speaker, SpeakerCreateRequest, SpeakerDTO, SpeakersController …(+4) |
| 9 | `CreateSessionHandler` | MMCA.ADC.Conference.Application | 11 | Error, ICommandHandler<in TCommand, TResult>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Result, Session, SessionCreateRequest, SessionDTO, SessionDTOMapper, SessionInvariants, SessionRoomScheduling |
| 9 | `GetPublicSessionFilterHandler` | MMCA.ADC.Conference.Application | 9 | CrossSourceSpecification, Event, GetPublicSessionFilterQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session, SessionStatuses, Specification<TEntity, TIdentifierType> |
| 9 | `ISessionizeSyncStrategy` | MMCA.ADC.Conference.Application | 2 | SessionizeSyncContext, SessionizeSyncResult |
| 9 | `SpeakerEntityQueryService` | MMCA.ADC.Conference.Application | 8 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork, Speaker, SpeakerDTO, SpeakerDTOMapper |
| 9 | `UpdateSessionHandler` | MMCA.ADC.Conference.Application | 11 | Error, Event, ICommandHandler<in TCommand, TResult>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, Session, SessionDTOMapper, SessionRoomScheduling, UpdateSessionCommand, UpdateSessionResult |
| 9 | `AddSessionCategoryItemCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddSessionCategoryItemCommand, AddSessionCategoryItemCommandValidator |
| 9 | `AddSessionQuestionAnswerCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddSessionQuestionAnswerCommand, AddSessionQuestionAnswerCommandValidator |
| 9 | `AddSessionSpeakerCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddSessionSpeakerCommand, AddSessionSpeakerCommandValidator |
| 9 | `ExportSessionCalendarHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, ExportSessionCalendarHandler, ExportSessionCalendarQuery, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Session |
| 9 | `Fakes` | MMCA.ADC.Conference.Application.Tests | 4 | InMemoryRepository<TEntity, TIdentifierType>, RecordingEventBus, RecordingUnitOfWork, Speaker |
| 9 | `GetNowNextHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, Event, FixedTimeProvider, GetNowNextHandler, GetNowNextQuery, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Session |
| 9 | `GetSessionBookmarkCountHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, GetSessionBookmarkCountHandler, GetSessionBookmarkCountQuery, IBookmarkCountService, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, Session |
| 9 | `GetSessionBookmarkCountsHandlerTests` | MMCA.ADC.Conference.Application.Tests | 6 | GetSessionBookmarkCountsHandler, GetSessionBookmarkCountsQuery, IBookmarkCountService, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, Session |
| 9 | `GetSessionFeedbackHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | ErrorType, GetSessionFeedbackHandler, GetSessionFeedbackQuery, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question, Result, Session, SessionFeedbackDTO |
| 9 | `SessionCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionCreateRequest, SessionCreateRequestValidator, SessionInvariants |
| 9 | `SessionDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 6 | Event, Session, SessionCategoryItemDTOMapper, SessionDTOMapper, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper |
| 9 | `EventLiveValidationServiceGrpcAdapter` | MMCA.ADC.Conference.Contracts | 8 | Error, EventLiveInfo, EventLiveValidationService, GrpcErrorTrailerParser, IEventLiveValidationService, QuestionModerationDefault, Result, SessionLiveInfo |
| 9 | `SessionBookmarkValidationServiceGrpcAdapter` | MMCA.ADC.Conference.Contracts | 5 | Error, GrpcErrorTrailerParser, ISessionBookmarkValidationService, Result, SessionBookmarkValidationService |
| 9 | `EventCascadeDeletionDomainServiceTests` | MMCA.ADC.Conference.Domain.Tests | 3 | Event, EventCascadeDeletionDomainService, Session |
| 9 | `ConferenceModuleDbSeederTests` | MMCA.ADC.Conference.Infrastructure.Tests | 6 | ConferenceModuleDbSeeder, Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question, SeederMocks |
| 9 | `ConferenceTestDbContext` | MMCA.ADC.Conference.Infrastructure.Tests | 28 | Category, CategoryItem, CategoryItemConfiguration, ConferenceCategoryConfiguration, Event, EventConfiguration, EventQuestionAnswer, EventQuestionAnswerConfiguration, EventSpeaker, EventSpeakerConfiguration, Question, QuestionConfiguration, Room, RoomConfiguration, Session, SessionCategoryItem, SessionCategoryItemConfiguration, SessionConfiguration, SessionQuestionAnswer, SessionQuestionAnswerConfiguration …(+8) |
| 9 | `EventLiveValidationGrpcService` | MMCA.ADC.Conference.Service | 3 | EventLiveValidationService, IEventLiveValidationService, QuestionModerationDefault |
| 9 | `SessionBookmarksGrpcService` | MMCA.ADC.Conference.Service | 2 | ISessionBookmarkValidationService, SessionBookmarkValidationService |
| 9 | `PublicSessionListEventFilterTests` | MMCA.ADC.Conference.UI.Tests | 11 | BunitTestBase, Event, EventDTO, IEventUIService, ISessionUIService, ISpeakerLookupService, ListPageQueryStateService, ListPageStateService, PublicSessionList, SpeakerInfo, TestPrincipal |
| 9 | `SessionListEventFilterTests` | MMCA.ADC.Conference.UI.Tests | 11 | BunitTestBase, Event, EventDTO, IEventUIService, ISessionUIService, ISpeakerLookupService, ListPageQueryStateService, ListPageStateService, SessionList, SpeakerInfo, TestPrincipal |
| 9 | `CastVoteHandler` | MMCA.ADC.Engagement.Application | 13 | CastVoteCommand, Error, ICommandHandler<in TCommand, TResult>, ILiveChannelPublishQueue, IRepository<TEntity, TIdentifierType>, IUnitOfWork, LiveChannelPublishWorkItem, LivePoll, LivePollChannel, LivePollResultsBuilder, LivePollResultsDTO, LivePollVote, Result |
| 9 | `GetModerationQueueHandler` | MMCA.ADC.Engagement.Application | 10 | GetModerationQueueQuery, IEventLiveValidationService, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePollAuthorization, Result, SessionQuestion, SessionQuestionDTO, SessionQuestionViewBuilder |
| 9 | `GetOpenPollsHandler` | MMCA.ADC.Engagement.Application | 9 | Error, GetOpenPollsQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePoll, LivePollResultsBuilder, LivePollResultsDTO, LivePollStatus, Result |
| 9 | `GetPollResultsHandler` | MMCA.ADC.Engagement.Application | 8 | Error, GetPollResultsQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePoll, LivePollResultsBuilder, LivePollResultsDTO, Result |
| 9 | `GetSessionQuestionsHandler` | MMCA.ADC.Engagement.Application | 9 | GetSessionQuestionsQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, QuestionStatus, Result, SessionQuestion, SessionQuestionDTO, SessionQuestionViewBuilder |
| 9 | `SubmitQuestionHandler` | MMCA.ADC.Engagement.Application | 17 | Error, ICommandHandler<in TCommand, TResult>, IEventLiveValidationService, ILiveChannelPublisher, IUnitOfWork, LivePollChannel, QuestionModerationDefault, QuestionStatus, Result, SessionQuestion, SessionQuestionApprovedPayload, SessionQuestionChannel, SessionQuestionDTO, SessionQuestionInvariants, SessionQuestionPendingCountChangedPayload, SessionQuestionViewBuilder, SubmitQuestionCommand |
| 9 | `BookmarkCountServiceGrpcAdapter` | MMCA.ADC.Engagement.Contracts | 2 | BookmarkCountService, IBookmarkCountService |
| 9 | `UserEngagementExportServiceGrpcAdapter` | MMCA.ADC.Engagement.Contracts | 5 | IUserEngagementExportService, UserEngagementBookmarkExportDTO, UserEngagementExportDTO, UserEngagementExportService, UserEngagementSubmittedQuestionExportDTO |
| 9 | `EngagementTestDbContext` | MMCA.ADC.Engagement.Infrastructure.Tests | 12 | LivePoll, LivePollConfiguration, LivePollOption, LivePollOptionConfiguration, LivePollVote, LivePollVoteConfiguration, SessionQuestion, SessionQuestionConfiguration, SessionQuestionUpvote, SessionQuestionUpvoteConfiguration, UserSessionBookmark, UserSessionBookmarkConfiguration |
| 9 | `BookmarkCountsGrpcService` | MMCA.ADC.Engagement.Service | 2 | BookmarkCountService, IBookmarkCountService |
| 9 | `UserEngagementExportGrpcService` | MMCA.ADC.Engagement.Service | 2 | IUserEngagementExportService, UserEngagementExportService |
| 9 | `IdentityModuleSeeder` | MMCA.ADC.Identity.API | 4 | IdentityModuleDbSeeder, IModuleSeeder, IPasswordHasher, IUnitOfWork |
| 9 | `UsersControllerTests` | MMCA.ADC.Identity.API.Tests | 18 | DeleteUserCommand, Email, Error, ExportUserDataQuery, GetUserAvatarQuery, GetUsersQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, PaginationMetadata, RemoveUserAvatarCommand, Result, SetUserAvatarCommand, UserAvatarDTO, UserDataExportDTO, UserListDTO, UsersController |
| 9 | `AuthenticationService` | MMCA.ADC.Identity.Application | 18 | AuthenticationResponse, AuthenticationServiceBase<TUser>, AuthenticationValidators, Email, Error, IAuthenticationService, IExternalLoginEmailVerifier, ILoginProtectionService, IPasswordHasher, ITokenService, IUnitOfWork, RegisterRequest, Result, TokenService, UnitOfWork, User, UserRegistered, UserRole |
| 9 | `RemoveUserAvatarHandler` | MMCA.ADC.Identity.Application | 8 | Error, ICommandHandler<in TCommand, TResult>, IFileStorageService, IUnitOfWork, RemoveUserAvatarCommand, Result, SetUserAvatarHandler, User |
| 9 | `Fakes` | MMCA.ADC.Identity.Application.Tests | 3 | InMemoryRepository<TEntity, TIdentifierType>, RecordingUnitOfWork, User |
| 9 | `SetUserAvatarHandlerTests` | MMCA.ADC.Identity.Application.Tests | 11 | Error, IFileStorageService, IImageProcessor, ImageContentSniffer, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, SetUserAvatarCommand, SetUserAvatarHandler, User, UserRole |
| 9 | `SoftDeletedUserValidatorTests` | MMCA.ADC.Identity.Application.Tests | 4 | IRepository<TEntity, TIdentifierType>, IUnitOfWork, SoftDeletedUserValidator, User |
| 9 | `AttendeeQueryServiceGrpcAdapter` | MMCA.ADC.Identity.Contracts | 2 | AttendeeQueryService, IAttendeeQueryService |
| 9 | `IdentityModuleDbSeederTests` | MMCA.ADC.Identity.Infrastructure.Tests | 6 | IdentityModuleDbSeeder, IPasswordHasher, IRepository<TEntity, TIdentifierType>, IUnitOfWork, SeederMocks, User |
| 9 | `IdentityTestDbContext` | MMCA.ADC.Identity.Infrastructure.Tests | 2 | User, UserConfiguration |
| 9 | `AttendeesGrpcService` | MMCA.ADC.Identity.Service | 2 | AttendeeQueryService, IAttendeeQueryService |
| 9 | `DependencyInjection` | MMCA.ADC.Notification.Application | 5 | ApplicationSettings, AttendeeNotificationRecipientProvider, INotificationRecipientProvider, IUserNotificationExportService, UserNotificationExportService |
| 9 | `DependencyInjectionTests` | MMCA.ADC.Notification.Application.Tests | 5 | ApplicationSettings, AttendeeNotificationRecipientProvider, INotificationRecipientProvider, IUserNotificationExportService, UserNotificationExportService |
| 9 | `UserNotificationExportServiceGrpcAdapter` | MMCA.ADC.Notification.Contracts | 3 | IUserNotificationExportService, UserNotificationExportItemDTO, UserNotificationExportService |
| 9 | `UserNotificationExportGrpcService` | MMCA.ADC.Notification.Service | 2 | IUserNotificationExportService, UserNotificationExportService |
| 9 | `MauiProgram` | MMCA.ADC.UI | 17 | ADCHomePageContent, App, AppActionsInitializer, ConfigurationOAuthUISettings, DeviceUIModule, DirectApiTokenRefresher, IDeepLinkDispatcher, IHomePageContent, IOAuthUISettings, IPublicLinkBuilder, ITokenRefresher, ITokenStorageService, IUIModule, JwtAuthenticationStateProvider, MauiPublicLinkBuilder, MauiTokenStorageService, UIModuleConfiguration |
| 9 | `AggregateRootEntityControllerBaseTests` | MMCA.Common.API.Tests | 11 | DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, IApplicationSettings, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, TestAggDTO, TestAggregateEntity, TestAggregateRootController, TestCreateRequest |
| 9 | `DatabaseInitializationExtensionsTests` | MMCA.Common.API.Tests | 23 | ApplicationSettings, AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceResolver, DataSourcesSettings, DbContextFactory, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, ICurrentUserService, IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, InitTestWidget, IOutboxSignal, IPhysicalDbContextFactory …(+3) |
| 9 | `FixedAssemblyProvider` | MMCA.Common.API.Tests | 2 | DatabaseInitializationExtensionsTests, IEntityConfigurationAssemblyProvider |
| 9 | `ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>` | MMCA.Common.Application | 4 | AuditableBaseEntity<TIdentifierType>, INavigationDescriptor<in TEntity>, IUnitOfWork, NavigationLoader |
| 9 | `DeclarativeNavigationPopulator<TEntity>` | MMCA.Common.Application | 4 | INavigationDescriptor<in TEntity>, INavigationPopulator<in TEntity>, IUnitOfWork, NavigationMetadata |
| 9 | `DependencyInjection` | MMCA.Common.Application | 27 | ApplicationSettings, CachingCommandDecorator<TCommand, TResult>, CachingQueryDecorator<TQuery, TResult>, ClassReference, CommandRequestValidator<TCommand, TRequest>, DomainEventDispatcher, EntityQueryPipeline, FeatureGateCommandDecorator<TCommand, TResult>, FeatureGateQueryDecorator<TQuery, TResult>, IApplicationSettings, ICommandHandler<in TCommand, TResult>, ICommandWithRequest<out TRequest>, IDomainEventDispatcher, IDomainEventHandler<in TDomainEvent>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IIntegrationEventHandler<in TIntegrationEvent>, INavigationMetadataProvider, IQueryHandler<in TQuery, TResult> …(+7) |
| 9 | `DependencyInjection` | MMCA.Common.Application | 28 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, GetMyNotificationsHandler, GetMyNotificationsQuery, GetNotificationHistoryHandler, GetNotificationHistoryQuery, GetUnreadNotificationCountHandler, GetUnreadNotificationCountQuery, ICommandHandler<in TCommand, TResult>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, INavigationPopulator<in TEntity>, INotificationRecipientProvider, IQueryHandler<in TQuery, TResult>, MarkAllNotificationsReadCommand, MarkAllNotificationsReadHandler, MarkNotificationReadCommand, MarkNotificationReadHandler, NullNavigationPopulator<TEntity>, NullNotificationRecipientProvider, PagedCollectionResult<T> …(+8) |
| 9 | `FKNavigationDescriptor<TEntity, TChild, TChildId>` | MMCA.Common.Application | 4 | AuditableBaseEntity<TIdentifierType>, INavigationDescriptor<in TEntity>, IUnitOfWork, NavigationLoader |
| 9 | `CommandDecoratorPipelineTests` | MMCA.Common.Application.Tests | 13 | CachePipelineTestCommand, CachingCommandDecorator<TCommand, TResult>, Error, FullPipelineTestCommand, ICacheService, ICommandHandler<in TCommand, TResult>, ICorrelationContext, IUnitOfWork, LoggingCommandDecorator<TCommand, TResult>, PipelineTestCommand, Result, TransactionalCommandDecorator<TCommand, TResult>, TransactionalPipelineTestCommand |
| 9 | `CrossSourceSpecificationTests` | MMCA.Common.Application.Tests | 5 | CrossSourceSpecification, Dependent, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, Principal |
| 9 | `DeleteEntityHandlerTests` | MMCA.Common.Application.Tests | 6 | DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, ErrorType, IRepository<TEntity, TIdentifierType>, IUnitOfWork, TestAggregateEntity |
| 9 | `GetMyNotificationsHandlerTests` | MMCA.Common.Application.Tests | 10 | GetMyNotificationsHandler, GetMyNotificationsQuery, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, PagedCollectionResult<T>, PushNotification, Result, UserNotification, UserNotificationDTO |
| 9 | `GetNotificationHistoryHandlerTests` | MMCA.Common.Application.Tests | 10 | GetNotificationHistoryHandler, GetNotificationHistoryQuery, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, PagedCollectionResult<T>, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, Result |
| 9 | `GetUnreadNotificationCountHandlerTests` | MMCA.Common.Application.Tests | 8 | GetUnreadNotificationCountHandler, GetUnreadNotificationCountQuery, HandlerMocks, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, UserNotification |
| 9 | `MarkAllNotificationsReadHandlerTests` | MMCA.Common.Application.Tests | 9 | FixedTimeProvider, HandlerMocks, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, MarkAllNotificationsReadCommand, MarkAllNotificationsReadHandler, Result, UserNotification |
| 9 | `MarkNotificationReadHandlerTests` | MMCA.Common.Application.Tests | 9 | FixedTimeProvider, HandlerMocks, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, MarkNotificationReadCommand, MarkNotificationReadHandler, Result, UserNotification |
| 9 | `NotificationDependencyInjectionTests` | MMCA.Common.Application.Tests | 23 | GetMyNotificationsHandler, GetMyNotificationsQuery, GetNotificationHistoryHandler, GetNotificationHistoryQuery, GetUnreadNotificationCountHandler, GetUnreadNotificationCountQuery, ICommandHandler<in TCommand, TResult>, INavigationPopulator<in TEntity>, INotificationRecipientProvider, IQueryHandler<in TQuery, TResult>, MarkAllNotificationsReadCommand, MarkAllNotificationsReadHandler, MarkNotificationReadCommand, MarkNotificationReadHandler, NullNotificationRecipientProvider, PagedCollectionResult<T>, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, Result …(+3) |
| 9 | `SendPushNotificationHandlerTests` | MMCA.Common.Application.Tests | 15 | HandlerMocks, INativePushSender, INotificationRecipientProvider, IPushNotificationSender, IRepository<TEntity, TIdentifierType>, IUnitOfWork, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, PushNotificationStatus, Result, SendPushNotificationCommand, SendPushNotificationHandler, SendPushNotificationRequest, UserNotification |
| 9 | `TestableEntityQueryService` | MMCA.Common.Application.Tests | 8 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, FakeEntity, FakeEntityDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork |
| 9 | `TestAuthenticationService` | MMCA.Common.Application.Tests | 10 | AuthenticationServiceBase<TUser>, AuthenticationValidators, Email, ILoginProtectionService, IPasswordHasher, ITokenService, IUnitOfWork, RegisterRequest, Result, TestAuthUser |
| 9 | `TransactionalCommandDecoratorTests` | MMCA.Common.Application.Tests | 6 | ICommandHandler<in TCommand, TResult>, IUnitOfWork, NonTransactionalCommand, Result, TransactionalCommand, TransactionalCommandDecorator<TCommand, TResult> |
| 9 | `DependencyInjection` | MMCA.Common.Infrastructure | 101 | ApplicationDbContext, ApplicationDbContextEFFactory, AuditSaveChangesInterceptor, AzureBlobFileStorageService, AzureNotificationHubDeviceRegistrar, AzureNotificationHubNativePushSender, BrokerEventBus, BrokerMessageBus, ClaimBasedUserIdProvider, ClassReference, ConnectionStringSettings, CorrelationContext, CosmosDbContext, CurrentUserService, DataSourceEntrySettings, DataSourceResolver, DataSourceService, DataSourcesSettings, DbContextFactory, DefaultCosmosDbContextFactory …(+81) |
| 9 | `ApplicationDbContextEFFactoryTests` | MMCA.Common.Infrastructure.Tests | 5 | ApplicationDbContextEFFactory, CosmosDbContext, IDbContextFactory, SqliteDbContext, SQLServerDbContext |
| 9 | `BrokerEventBusTests` | MMCA.Common.Infrastructure.Tests | 19 | ApplicationDbContext, AuditSaveChangesInterceptor, BrokerEventBus, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEntityDataSourceRegistry, IIntegrationEvent, IOutboxSignal, Mocks, OutboxMessage, OutboxSettings, TestIntegrationEvent, TestNonOutboxContext, TestOutboxContext |
| 9 | `BrokerMessageBusTests` | MMCA.Common.Infrastructure.Tests | 5 | BrokerMessageBus, IIntegrationEvent, Mocks, OtherIntegrationEvent, TestIntegrationEvent |
| 9 | `CosmosConfigurationPortabilityTests` | MMCA.Common.Infrastructure.Tests | 17 | AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceResolver, DataSourcesSettings, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, OutboxSignal, PhysicalDbContextFactory, PortablePrincipal, PortableThing |
| 9 | `DbContextFactoryAdditionalTests` | MMCA.Common.Infrastructure.Tests | 6 | DataSource, DbContextFactory, ICurrentUserService, IDataSourceResolver, IEntityDataSourceRegistry, IPhysicalDbContextFactory |
| 9 | `DbContextFactoryTests` | MMCA.Common.Infrastructure.Tests | 8 | ApplicationDbContext, DataSource, DataSourceKey, DbContextFactory, ICurrentUserService, IDataSourceResolver, IEntityDataSourceRegistry, IPhysicalDbContextFactory |
| 9 | `DbContextFactoryTransactionTests` | MMCA.Common.Infrastructure.Tests | 15 | DataSource, DataSourceKey, DbContextFactory, Error, ICurrentUserService, IDataSourceResolver, IDomainEvent, IDomainEventDispatcher, IEntityDataSourceRegistry, IPhysicalDbContextFactory, OutboxMessage, Result, TestAggregate, TestLocalEvent, TransactionTestDbContext |
| 9 | `DependencyInjectionInfrastructureTests` | MMCA.Common.Infrastructure.Tests | 16 | AuditSaveChangesInterceptor, ConnectionStringSettings, DomainEventSaveChangesInterceptor, EntityConfigurationOptions, IConnectionStringSettings, IDataSourceService, IEntityConfigurationAssemblyProvider, IJwtSettings, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IRepositoryFactory, ISmtpSettings, IUnitOfWork, OutboxProcessor, OutboxSettings, SmtpSettings |
| 9 | `DependencyInjectionTests` | MMCA.Common.Infrastructure.Tests | 20 | CorrelationContext, CurrentUserService, DistributedCacheService, EntityConfigurationOptions, ICacheService, ICorrelationContext, ICurrentUserService, IEmailSender, IEventBus, ILiveChannelPublisher, InProcessEventBus, IPasswordHasher, IPushNotificationSender, ITokenService, MemoryCacheService, NullLiveChannelPublisher, NullPushNotificationSender, PasswordHasher, SmtpEmailSender, TokenService |
| 9 | `DesignTimeDbContextHelperTests` | MMCA.Common.Infrastructure.Tests | 8 | ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceKey, DesignAlphaEntity, DesignBetaEntity, DesignTimeDbContextHelper, DesignTimeDbContextOptions |
| 9 | `EfInboxStoreTests` | MMCA.Common.Infrastructure.Tests | 16 | ApplicationDbContext, AuditSaveChangesInterceptor, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EfInboxStore, EmptyEntityDataSourceRegistry, IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, InboxMessage, InboxTestDbContext, IOutboxSignal, OutboxSettings |
| 9 | `FixedAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 3 | CosmosConfigurationPortabilityTests, IEntityConfigurationAssemblyProvider, MultiSourceSqliteIntegrationTests |
| 9 | `InProcessEventBusOutboxTests` | MMCA.Common.Infrastructure.Tests | 11 | DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, InProcessEventBus, OutboxMessage, OutboxSettings, TestIntegrationEvent, TestOutboxContext |
| 9 | `InProcessEventBusTests` | MMCA.Common.Infrastructure.Tests | 10 | DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, IIntegrationEvent, InProcessEventBus, OutboxSettings, TestNonOutboxContext |
| 9 | `InProcessMessageBusTests` | MMCA.Common.Infrastructure.Tests | 11 | DomainEventDispatcher, IDomainEvent, IDomainEventDispatcher, IDomainEventHandler<in TDomainEvent>, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent>, InProcessMessageBus, Mocks, RecordingDomainHandler, RecordingIntegrationHandler, TestIntegrationEvent |
| 9 | `Mocks` | MMCA.Common.Infrastructure.Tests | 6 | IDataSourceResolver, IDataSourceService, IDbContextFactory, IEntityDataSourceRegistry, IRepositoryFactory, OutboxCleanupService |
| 9 | `MultiSourceSqliteIntegrationTests` | MMCA.Common.Infrastructure.Tests | 26 | AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceResolver, DataSourceService, DataSourcesSettings, DbContextFactory, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, IApplicationSettings, ICurrentUserService, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, MultiSourceCustomer, MultiSourceOrder, MultiSourceTestEvent …(+6) |
| 9 | `OutboxProcessorTests` | MMCA.Common.Infrastructure.Tests | 22 | AuditSaveChangesInterceptor, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FakeTimeProvider, IDataSourceResolver, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IIntegrationEvent, IMessageBus, IOutboxSignal, OutboxCycleResult, OutboxMessage, OutboxProcessor, OutboxSettings, OutboxTestDbContext …(+2) |
| 9 | `OutboxProcessorWaitTests` | MMCA.Common.Infrastructure.Tests | 1 | OutboxProcessor |
| 9 | `RepositoryFactoryTests` | MMCA.Common.Infrastructure.Tests | 11 | EFReadRepository<TEntity, TIdentifierType>, EFReadRepositoryDecorator<TEntity, TIdentifierType>, EFRepository<TEntity, TIdentifierType>, EFRepositoryDecorator<TEntity, TIdentifierType>, FakeAggregate, FakeEntity, IApplicationSettings, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, RepositoryFactory, TestDbContext |
| 9 | `SqliteTestDbContext` | MMCA.Common.Infrastructure.Tests | 2 | SqliteTestEntity, SqliteTestEntityConfig |
| 9 | `HandlerTestBase<THandler>` | MMCA.Common.Testing | 6 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, UnitOfWork |
| 9 | `DecoratorPipelineOrderTests` | MMCA.Common.Testing.Tests | 9 | DecoratorPipelineOrderTests, DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>, ICacheService, ICorrelationContext, IUnitOfWork, PingCommand, PingCommandHandler, PingQuery, Result |
| 9 | `GalleryHostFixture` | MMCA.Common.UI.E2E.Tests | 2 | E2ETestConfiguration, GalleryHost |
| 10 | `ConcurrencyConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ConcurrencyConventionTestsBase, IArchitectureMap |
| 10 | `ConstructorDependencyCountTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ConstructorDependencyCountTestsBase, IArchitectureMap |
| 10 | `ControllerConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ControllerConventionTestsBase, IArchitectureMap |
| 10 | `DataResidencyTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, DataResidencyTestsBase, IArchitectureMap |
| 10 | `DomainPurityTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, DomainPurityTestsBase, IArchitectureMap |
| 10 | `EntityConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, EntityConventionTestsBase, IArchitectureMap |
| 10 | `EventConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, EventConventionTestsBase, IArchitectureMap |
| 10 | `FormsConventionTests` | MMCA.ADC.Architecture.Tests | 4 | AdcArchitectureMap, ArchitectureMapBase, FormsConventionTestsBase, IArchitectureMap |
| 10 | `FrameworkVersionConsistencyTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, FrameworkVersionConsistencyTestsBase, IArchitectureMap |
| 10 | `HandlerConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, HandlerConventionTestsBase, IArchitectureMap |
| 10 | `HandlerResultConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, HandlerResultConventionTestsBase, IArchitectureMap |
| 10 | `ImmutabilityTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, ImmutabilityTestsBase |
| 10 | `IntegrationEventContractTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, IntegrationEventContractTestsBase |
| 10 | `LayerDependencyTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, LayerDependencyTestsBase |
| 10 | `LocalizedTextConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, LocalizedTextConventionTestsBase |
| 10 | `MicroserviceExtractionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, MicroserviceExtractionTestsBase |
| 10 | `ModuleIsolationTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, ModuleIsolationTestsBase |
| 10 | `NamingConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, NamingConventionTestsBase |
| 10 | `PiiConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, PiiConventionTestsBase |
| 10 | `RawQueryableConventionTests` | MMCA.ADC.Architecture.Tests | 4 | AdcArchitectureMap, ArchitectureMapBase, IArchitectureMap, RawQueryableConventionTestsBase |
| 10 | `SharedLayerTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, SharedLayerTestsBase |
| 10 | `SliceCohesionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, SliceCohesionTestsBase |
| 10 | `SpecificationConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, SpecificationConventionTestsBase |
| 10 | `StateManagementConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, StateManagementConventionTestsBase |
| 10 | `UIArchitectureConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, UIArchitectureConventionTestsBase |
| 10 | `CategorySyncStrategy` | MMCA.ADC.Conference.Application | 6 | Category, ISessionizeSyncStrategy, SessionizeCategory, SessionizeCategoryItem, SessionizeSyncContext, SessionizeSyncResult |
| 10 | `ConferenceCategoryNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | Category, CategoryItem, ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, IUnitOfWork |
| 10 | `EventNavigationPopulator` | MMCA.ADC.Conference.Application | 7 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, Event, EventQuestionAnswer, EventSpeaker, IUnitOfWork, Room |
| 10 | `QuestionSyncStrategy` | MMCA.ADC.Conference.Application | 5 | ISessionizeSyncStrategy, Question, QuestionInvariants, SessionizeSyncContext, SessionizeSyncResult |
| 10 | `RoomSyncStrategy` | MMCA.ADC.Conference.Application | 3 | ISessionizeSyncStrategy, SessionizeSyncContext, SessionizeSyncResult |
| 10 | `SessionNavigationPopulator` | MMCA.ADC.Conference.Application | 7 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, IUnitOfWork, Session, SessionCategoryItem, SessionQuestionAnswer, SessionSpeaker |
| 10 | `SessionSyncStrategy` | MMCA.ADC.Conference.Application | 6 | ISessionizeSyncStrategy, Session, SessionizeQuestionAnswer, SessionizeSession, SessionizeSyncContext, SessionizeSyncResult |
| 10 | `SpeakerNavigationPopulator` | MMCA.ADC.Conference.Application | 6 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, IUnitOfWork, Speaker, SpeakerCategoryItem, SpeakerQuestionAnswer |
| 10 | `SpeakerSyncStrategy` | MMCA.ADC.Conference.Application | 7 | ISessionizeSyncStrategy, SessionizeLink, SessionizeQuestionAnswer, SessionizeSpeaker, SessionizeSyncContext, SessionizeSyncResult, Speaker |
| 10 | `AddCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddCategoryItemCommand, AddCategoryItemHandler, Category, CategoryItemDTOMapper, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork |
| 10 | `AddEventQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | AddEventQuestionAnswerCommand, AddEventQuestionAnswerHandler, ErrorType, Event, EventQuestionAnswerDTOMapper, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Question, UnitOfWork |
| 10 | `AddEventSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddEventSpeakerCommand, AddEventSpeakerHandler, ErrorType, Event, EventSpeakerDTOMapper, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork |
| 10 | `AddRoomHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | AddRoomCommand, AddRoomHandler, ErrorType, Event, EventInvariants, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Room, RoomDTOMapper, UnitOfWork |
| 10 | `AddSessionCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddSessionCategoryItemCommand, AddSessionCategoryItemHandler, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionCategoryItemDTOMapper, UnitOfWork |
| 10 | `AddSessionQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | AddSessionQuestionAnswerCommand, AddSessionQuestionAnswerHandler, ErrorType, Event, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Question, Session, SessionQuestionAnswerDTOMapper, UnitOfWork |
| 10 | `AddSessionSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddSessionSpeakerCommand, AddSessionSpeakerHandler, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionSpeakerDTOMapper, UnitOfWork |
| 10 | `AddSpeakerCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddSpeakerCategoryItemCommand, AddSpeakerCategoryItemHandler, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Speaker, SpeakerCategoryItemDTOMapper, UnitOfWork |
| 10 | `CreateConferenceCategoryHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | Category, CategoryItemDTOMapper, ConferenceCategoryCreateRequest, ConferenceCategoryDTOMapper, CreateConferenceCategoryHandler, Error, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Result, UnitOfWork |
| 10 | `CreateEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | CreateEventHandler, Error, Event, EventCreateRequest, EventDTOMapper, EventQuestionAnswerDTOMapper, EventSpeakerDTOMapper, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Result, RoomDTOMapper, UnitOfWork |
| 10 | `CreateQuestionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | CreateQuestionHandler, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Question, QuestionCreateRequest, QuestionDTOMapper, QuestionInvariants, Result, UnitOfWork |
| 10 | `CreateSessionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 15 | CreateSessionHandler, Error, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, Session, SessionCategoryItemDTOMapper, SessionCreateRequest, SessionDTOMapper, SessionInvariants, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper, UnitOfWork |
| 10 | `CreateSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 14 | CreateSpeakerHandler, Email, Error, HandlerTestBase<THandler>, ICurrentUserService, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Result, Speaker, SpeakerCategoryItemDTOMapper, SpeakerCreateRequest, SpeakerDTOMapper, SpeakerQuestionAnswerDTOMapper, UnitOfWork |
| 10 | `DeleteEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEventHandler, ErrorType, Event, EventCascadeDeletionDomainService, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, UnitOfWork |
| 10 | `EventLiveValidationServiceTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, Event, EventLiveValidationService, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, QuestionModerationDefault, Session, UnitOfWork |
| 10 | `GetCategoryDistributionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | Category, GetCategoryDistributionHandler, GetCategoryDistributionQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionStatuses, UnitOfWork |
| 10 | `GetContentSimilarityHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | Category, GetContentSimilarityHandler, GetContentSimilarityQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionStatuses, UnitOfWork |
| 10 | `GetPublicSessionFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | Event, GetPublicSessionFilterHandler, GetPublicSessionFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, Session, SessionStatuses, UnitOfWork |
| 10 | `GetSessionSelectionDashboardHandlerTests` | MMCA.ADC.Conference.Application.Tests | 12 | Category, ErrorType, Event, GetSessionSelectionDashboardHandler, GetSessionSelectionDashboardQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionAiScore, SessionStatuses, Speaker, UnitOfWork |
| 10 | `GetSpeakersByEventFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | EventSpeaker, GetSpeakersByEventFilterHandler, GetSpeakersByEventFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, Session, SessionSpeaker, Speaker, UnitOfWork |
| 10 | `GetSpeakerSessionOverlapHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | Category, GetSpeakerSessionOverlapHandler, GetSpeakerSessionOverlapQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionStatuses, Speaker, UnitOfWork |
| 10 | `LinkUserToSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, LinkUserToSpeakerCommand, LinkUserToSpeakerHandler, Speaker, SpeakerLinkedToUser, UnitOfWork |
| 10 | `PublishEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, PublishEventCommand, PublishEventHandler, UnitOfWork |
| 10 | `RemoveCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | Category, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveCategoryItemCommand, RemoveCategoryItemHandler, UnitOfWork |
| 10 | `RemoveEventQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | ErrorType, Event, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, RemoveEventQuestionAnswerCommand, RemoveEventQuestionAnswerHandler, RoleNames, UnitOfWork |
| 10 | `RemoveEventSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveEventSpeakerCommand, RemoveEventSpeakerHandler, UnitOfWork |
| 10 | `RemoveRoomHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveRoomCommand, RemoveRoomHandler, UnitOfWork |
| 10 | `RemoveSessionCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveSessionCategoryItemCommand, RemoveSessionCategoryItemHandler, Session, UnitOfWork |
| 10 | `RemoveSessionQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | ErrorType, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, RemoveSessionQuestionAnswerCommand, RemoveSessionQuestionAnswerHandler, RoleNames, Session, UnitOfWork |
| 10 | `RemoveSessionSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveSessionSpeakerCommand, RemoveSessionSpeakerHandler, Session, UnitOfWork |
| 10 | `RemoveSpeakerCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveSpeakerCategoryItemCommand, RemoveSpeakerCategoryItemHandler, Speaker, UnitOfWork |
| 10 | `ScoreEventSessionsHandlerTests` | MMCA.ADC.Conference.Application.Tests | 12 | HandlerTestBase<THandler>, IAiScoringService, IRepository<TEntity, TIdentifierType>, ScoreEventSessionsCommand, ScoreEventSessionsHandler, Session, SessionAiScore, SessionScoringInput, SessionScoringResult, SessionStatuses, Speaker, UnitOfWork |
| 10 | `SessionBookmarkValidationServiceTests` | MMCA.ADC.Conference.Application.Tests | 6 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionBookmarkValidationService, UnitOfWork |
| 10 | `SpeakerEntityQueryServiceTests` | MMCA.ADC.Conference.Application.Tests | 16 | EntityQueryParameters<TEntity>, ErrorType, HandlerTestBase<THandler>, ICurrentUserService, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, InlineSpecification<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, NavigationMetadata, Speaker, SpeakerCategoryItemDTOMapper, SpeakerDTOMapper, SpeakerEntityQueryService, SpeakerQuestionAnswerDTOMapper, UnitOfWork |
| 10 | `UnlinkUserFromSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Speaker, SpeakerUnlinkedFromUser, UnitOfWork, UnlinkUserFromSpeakerCommand, UnlinkUserFromSpeakerHandler |
| 10 | `UnpublishEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UnpublishEventCommand, UnpublishEventHandler |
| 10 | `UpdateCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | Category, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UpdateCategoryItemCommand, UpdateCategoryItemHandler |
| 10 | `UpdateConferenceCategoryHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | Category, CategoryItemDTOMapper, ConferenceCategoryDTOMapper, ConferenceCategoryUpdateRequest, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UpdateConferenceCategoryCommand, UpdateConferenceCategoryHandler |
| 10 | `UpdateEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | ErrorType, Event, EventDTOMapper, EventQuestionAnswerDTOMapper, EventSpeakerDTOMapper, EventUpdateRequest, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RoomDTOMapper, Session, UnitOfWork, UpdateEventCommand, UpdateEventHandler |
| 10 | `UpdateEventQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | ErrorType, Event, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, RoleNames, UnitOfWork, UpdateEventQuestionAnswerCommand, UpdateEventQuestionAnswerHandler |
| 10 | `UpdateQuestionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 12 | ErrorType, EventQuestionAnswer, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Question, QuestionDTOMapper, QuestionUpdateRequest, SessionQuestionAnswer, UnitOfWork, UpdateQuestionCommand, UpdateQuestionHandler |
| 10 | `UpdateRoomHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UpdateRoomCommand, UpdateRoomHandler |
| 10 | `UpdateSessionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionCategoryItemDTOMapper, SessionDTOMapper, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper, SessionUpdateRequest, UnitOfWork, UpdateSessionCommand, UpdateSessionHandler |
| 10 | `UpdateSessionQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | ErrorType, Event, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, RoleNames, Session, UnitOfWork, UpdateSessionQuestionAnswerCommand, UpdateSessionQuestionAnswerHandler |
| 10 | `UpdateSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | Email, ErrorType, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Speaker, SpeakerCategoryItemDTOMapper, SpeakerDTOMapper, SpeakerQuestionAnswerDTOMapper, SpeakerUpdateRequest, UnitOfWork, UpdateSpeakerCommand, UpdateSpeakerHandler |
| 10 | `UserRegisteredHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | Fakes, IEventBus, InMemoryRepository<TEntity, TIdentifierType>, IUnitOfWork, RecordingEventBus, RecordingUnitOfWork, Speaker, SpeakerLinkedToUser, UserRegistered, UserRegisteredHandler |
| 10 | `DependencyInjection` | MMCA.ADC.Conference.Contracts | 6 | EventLiveValidationService, EventLiveValidationServiceGrpcAdapter, IEventLiveValidationService, ISessionBookmarkValidationService, SessionBookmarkValidationService, SessionBookmarkValidationServiceGrpcAdapter |
| 10 | `ConferenceEntityConfigurationTests` | MMCA.ADC.Conference.Infrastructure.Tests | 20 | Category, CategoryInvariants, CategoryItem, ConferenceTestDbContext, Event, EventInvariants, EventQuestionAnswer, EventSpeaker, Question, QuestionInvariants, Room, Session, SessionCategoryItem, SessionInvariants, SessionQuestionAnswer, SessionSpeaker, Speaker, SpeakerCategoryItem, SpeakerInvariants, SpeakerQuestionAnswer |
| 10 | `LivePollNavigationPopulator` | MMCA.ADC.Engagement.Application | 5 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, IUnitOfWork, LivePoll, LivePollOption |
| 10 | `BookmarkCountServiceTests` | MMCA.ADC.Engagement.Application.Tests | 5 | BookmarkCountService, HandlerTestBase<THandler>, InMemoryQueryableExecutor, UnitOfWork, UserSessionBookmark |
| 10 | `CastVoteHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 16 | CastVoteCommand, CastVoteHandler, ErrorType, FixedTimeProvider, HandlerMocks, HandlerTestBase<THandler>, ILiveChannelPublishQueue, InMemoryQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, LiveChannelPublishWorkItem, LivePoll, LivePollChannel, LivePollResultsBuilder, LivePollResultsDTO, LivePollVote, UnitOfWork |
| 10 | `CloseLivePollHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 16 | CloseLivePollCommand, CloseLivePollHandler, Error, ErrorType, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, ILiveChannelPublishQueue, LiveChannelPublishWorkItem, LivePoll, LivePollChannel, LivePollStatus, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 10 | `CreateBookmarkHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 12 | BookmarkManagementDomainService, CreateBookmarkHandler, CreateBookmarkRequest, Error, ErrorType, HandlerMocks, HandlerTestBase<THandler>, ISessionBookmarkValidationService, Result, UnitOfWork, UserSessionBookmark, UserSessionBookmarkDTOMapper |
| 10 | `CreateLivePollHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 17 | CreateLivePollCommand, CreateLivePollHandler, CreateLivePollRequest, Error, ErrorType, EventLiveInfo, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, LivePoll, LivePollDTOMapper, LivePollStatus, Question, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 10 | `GetBookmarkedSessionIdsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 5 | GetBookmarkedSessionIdsHandler, GetBookmarkedSessionIdsQuery, HandlerTestBase<THandler>, UnitOfWork, UserSessionBookmark |
| 10 | `GetEventPollsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 7 | GetEventPollsHandler, GetEventPollsQuery, HandlerTestBase<THandler>, LivePoll, LivePollDTOMapper, LivePollStatus, UnitOfWork |
| 10 | `GetModerationQueueHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 16 | Error, ErrorType, GetModerationQueueHandler, GetModerationQueueQuery, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, InMemoryQueryableExecutor, QuestionModerationDefault, QuestionStatus, Result, SessionLiveInfo, SessionQuestion, SessionQuestionUpvote, SessionQuestionViewBuilder, UnitOfWork |
| 10 | `GetOpenPollsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 9 | ErrorType, GetOpenPollsHandler, GetOpenPollsQuery, HandlerTestBase<THandler>, InMemoryQueryableExecutor, LivePoll, LivePollResultsBuilder, LivePollVote, UnitOfWork |
| 10 | `GetSessionQuestionsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 9 | GetSessionQuestionsHandler, GetSessionQuestionsQuery, HandlerTestBase<THandler>, InMemoryQueryableExecutor, QuestionStatus, SessionQuestion, SessionQuestionUpvote, SessionQuestionViewBuilder, UnitOfWork |
| 10 | `GetUserBookmarksHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 11 | Error, GetUserBookmarksHandler, GetUserBookmarksQuery, HandlerMocks, HandlerTestBase<THandler>, IQueryableExecutor, ISessionBookmarkValidationService, Result, UnitOfWork, UserSessionBookmark, UserSessionBookmarkDTOMapper |
| 10 | `ModerateQuestionHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 16 | Error, ErrorType, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, ILiveChannelPublisher, ModerateQuestionCommand, ModerateQuestionHandler, ModerationAction, QuestionModerationDefault, QuestionStatus, Result, SessionLiveInfo, SessionQuestion, SessionQuestionChannel, UnitOfWork |
| 10 | `OpenLivePollHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 17 | Error, ErrorType, EventLiveInfo, FixedTimeProvider, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, ILiveChannelPublisher, LivePoll, LivePollChannel, LivePollStatus, OpenLivePollCommand, OpenLivePollHandler, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 10 | `SubmitQuestionHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 22 | Error, FixedTimeProvider, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, ILiveChannelPublisher, InMemoryQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, QuestionModerationDefault, QuestionStatus, Result, SessionLiveInfo, SessionQuestion, SessionQuestionApprovedPayload, SessionQuestionChannel, SessionQuestionInvariants, SessionQuestionPendingCountChangedPayload, SessionQuestionUpvote, SessionQuestionViewBuilder, SubmitQuestionCommand …(+2) |
| 10 | `ToggleUpvoteHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 12 | ErrorType, FixedTimeProvider, HandlerMocks, HandlerTestBase<THandler>, ILiveChannelPublisher, QuestionStatus, SessionQuestion, SessionQuestionChannel, SessionQuestionUpvote, ToggleUpvoteCommand, ToggleUpvoteHandler, UnitOfWork |
| 10 | `DependencyInjection` | MMCA.ADC.Engagement.Contracts | 6 | BookmarkCountService, BookmarkCountServiceGrpcAdapter, IBookmarkCountService, IUserEngagementExportService, UserEngagementExportService, UserEngagementExportServiceGrpcAdapter |
| 10 | `EngagementEntityConfigurationTests` | MMCA.ADC.Engagement.Infrastructure.Tests | 9 | EngagementTestDbContext, LivePoll, LivePollInvariants, LivePollOption, LivePollVote, SessionQuestion, SessionQuestionInvariants, SessionQuestionUpvote, UserSessionBookmark |
| 10 | `DependencyInjection` | MMCA.ADC.Identity.Application | 10 | ApplicationSettings, AttendeeQueryService, AuthenticationService, AuthenticationValidators, ClassReference, ClassReference, IAttendeeQueryService, IAuthenticationService, ISoftDeletedUserValidator, SoftDeletedUserValidator |
| 10 | `AttendeeQueryServiceTests` | MMCA.ADC.Identity.Application.Tests | 5 | AttendeeQueryService, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, User |
| 10 | `AuthenticationServiceTests` | MMCA.ADC.Identity.Application.Tests | 19 | AuthenticationResponse, AuthenticationService, AuthenticationValidators, Error, ErrorType, IExternalLoginEmailVerifier, ILoginProtectionService, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, LoginRequest, RefreshTokenRequest, RegisterRequest, Result, ServiceMocks, User, UserRegistered, UserRole |
| 10 | `ChangePasswordHandlerTests` | MMCA.ADC.Identity.Application.Tests | 10 | ChangePasswordCommand, ChangePasswordHandler, ChangePasswordRequest, ErrorType, HandlerTestBase<THandler>, IPasswordHasher, IRepository<TEntity, TIdentifierType>, UnitOfWork, User, UserRole |
| 10 | `ChangePreferencesHandlerTests` | MMCA.ADC.Identity.Application.Tests | 9 | ChangePreferencesCommand, ChangePreferencesHandler, ChangePreferencesRequest, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, User, UserRole |
| 10 | `DeleteUserHandlerTests` | MMCA.ADC.Identity.Application.Tests | 10 | DeleteUserCommand, DeleteUserHandler, ErrorType, HandlerTestBase<THandler>, IFileStorageService, IRepository<TEntity, TIdentifierType>, Result, UnitOfWork, User, UserRole |
| 10 | `ExportUserDataHandlerTests` | MMCA.ADC.Identity.Application.Tests | 14 | ErrorType, ExportUserDataHandler, ExportUserDataQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, IUserEngagementExportService, IUserNotificationExportService, UnitOfWork, User, UserEngagementBookmarkExportDTO, UserEngagementExportDTO, UserEngagementSubmittedQuestionExportDTO, UserNotificationExportItemDTO, UserRole |
| 10 | `GetUserPreferencesHandlerTests` | MMCA.ADC.Identity.Application.Tests | 12 | ChangePreferencesCommand, ChangePreferencesHandler, ChangePreferencesRequest, ErrorType, GetUserPreferencesHandler, GetUserPreferencesQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, User, UserPreferencesResponse, UserRole |
| 10 | `GetUsersHandlerTests` | MMCA.ADC.Identity.Application.Tests | 10 | Email, GetUsersHandler, GetUsersQuery, HandlerTestBase<THandler>, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, UnitOfWork, User, UserListDTO, UserRole |
| 10 | `SpeakerLinkedToUserHandlerTests` | MMCA.ADC.Identity.Application.Tests | 8 | Fakes, InMemoryRepository<TEntity, TIdentifierType>, IUnitOfWork, RecordingUnitOfWork, SpeakerLinkedToUser, SpeakerLinkedToUserHandler, User, UserRole |
| 10 | `SpeakerUnlinkedFromUserHandlerTests` | MMCA.ADC.Identity.Application.Tests | 8 | Fakes, InMemoryRepository<TEntity, TIdentifierType>, IUnitOfWork, RecordingUnitOfWork, SpeakerUnlinkedFromUser, SpeakerUnlinkedFromUserHandler, User, UserRole |
| 10 | `DependencyInjection` | MMCA.ADC.Identity.Contracts | 3 | AttendeeQueryService, AttendeeQueryServiceGrpcAdapter, IAttendeeQueryService |
| 10 | `IdentityEntityConfigurationTests` | MMCA.ADC.Identity.Infrastructure.Tests | 3 | IdentityTestDbContext, User, UserInvariants |
| 10 | `UserNotificationExportServiceTests` | MMCA.ADC.Notification.Application.Tests | 7 | HandlerTestBase<THandler>, InMemoryQueryableExecutor, IRepository<TEntity, TIdentifierType>, PushNotification, UnitOfWork, UserNotification, UserNotificationExportService |
| 10 | `DependencyInjection` | MMCA.ADC.Notification.Contracts | 5 | ILiveChannelPublisher, IUserNotificationExportService, LiveChannelPublisherGrpcAdapter, UserNotificationExportService, UserNotificationExportServiceGrpcAdapter |
| 10 | `App` | MMCA.ADC.UI | 1 | MauiProgram |
| 10 | `AppDelegate` | MMCA.ADC.UI | 2 | IDeepLinkDispatcher, MauiProgram |
| 10 | `MainApplication` | MMCA.ADC.UI | 1 | MauiProgram |
| 10 | `AuthControllerBase` | MMCA.Common.API | 9 | ApiControllerBase, AuthenticationResponse, AuthenticationService, CurrentUserService, IAuthenticationService, ICurrentUserService, LoginRequest, RefreshTokenRequest, RegisterRequest |
| 10 | `AuthenticationServiceBaseTests` | MMCA.Common.Application.Tests | 17 | AuthenticationResponse, AuthenticationValidators, Error, ErrorType, FixedTimeProvider, ILoginProtectionService, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, LoginRequest, RefreshTokenRequest, RegisterRequest, Result, ServiceMocks, TestAuthenticationService, TestAuthUser |
| 10 | `ChildNavigationDescriptorTests` | MMCA.Common.Application.Tests | 6 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, INavigationDescriptor<in TEntity>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderEntity, OrderLineEntity |
| 10 | `DeclarativeNavigationPopulatorTests` | MMCA.Common.Application.Tests | 7 | DeclarativeNavigationPopulator<TEntity>, INavigationDescriptor<in TEntity>, IUnitOfWork, NavigationMetadata, NavigationPopulatorStubEntity, NavigationPropertyInfo, NavigationType |
| 10 | `EntityQueryServiceTests` | MMCA.Common.Application.Tests | 10 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, FakeEntity, FakeEntityDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, TestableEntityQueryService |
| 10 | `FKNavigationDescriptorTests` | MMCA.Common.Application.Tests | 6 | FKNavigationDescriptor<TEntity, TChild, TChildId>, INavigationDescriptor<in TEntity>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, ParentEntity, RelatedEntity |
| 10 | `EntityDataSourceRegistryTests` | MMCA.Common.Infrastructure.Tests | 15 | ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceKey, DataSourceResolver, DataSourcesSettings, EntityDataSourceRegistry, FixedAssemblyProvider, NamespaceConventions, PushNotification, RegistryDuplicate, RegistryInvoice, RegistryOrder, RegistrySqlServerEntity, RegistryUnattributed |
| 10 | `EntityTypeConfigurationTests` | MMCA.Common.Infrastructure.Tests | 2 | SqliteTestDbContext, SqliteTestEntity |
| 10 | `OutboxCleanupServiceTests` | MMCA.Common.Infrastructure.Tests | 14 | ApplicationDbContext, CleanupTestContext, DataSource, DataSourceKey, FakeTimeProvider, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, InboxMessage, MessageBusSettings, Mocks, OutboxCleanupService, OutboxMessage, OutboxSettings |
| 10 | `OutboxProcessorExecuteAsyncTests` | MMCA.Common.Infrastructure.Tests | 9 | DataSource, DataSourceKey, DependencyInjection, FakeTimeProvider, IDataSourceResolver, IEntityDataSourceRegistry, IOutboxSignal, OutboxProcessor, OutboxSettings |
| 10 | `UnitOfWorkAdditionalTests` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, DataSource, DataSourceKey, FakeAggregate, FakeEntity, IDataSourceService, IDbContextFactory, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRepositoryFactory, Mocks, UnitOfWork |
| 10 | `UnitOfWorkTests` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, DataSource, DataSourceKey, FakeAggregate, FakeEntity, IDataSourceService, IDbContextFactory, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRepositoryFactory, Mocks, UnitOfWork |
| 10 | `HandlerTestBaseTests` | MMCA.Common.Testing.Tests | 5 | FakeHandler, HandlerTestBase<THandler>, TestAggregate, TestChildEntity, UnitOfWork |
| 10 | `GalleryE2ECollection` | MMCA.Common.UI.E2E.Tests | 2 | GalleryHostFixture, PlaywrightFixture |
| 11 | `DependencyInjection` | MMCA.ADC.Conference.Application | 49 | ApplicationSettings, Category, CategoryItem, CategoryItemDTO, ClassReference, ClassReference, ConferenceCategoryDTO, ConferenceCategoryNavigationPopulator, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, DeleteEventHandler, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Event, EventCascadeDeletionDomainService, EventDTO, EventLiveValidationService, EventNavigationPopulator, EventQuestionAnswer, EventQuestionAnswerDTO, EventSpeaker …(+29) |
| 11 | `RefreshFromSessionizeHandler` | MMCA.ADC.Conference.Application | 19 | CategorySyncStrategy, Error, Event, ICommandHandler<in TCommand, TResult>, ICurrentUserService, ISessionizeService, ISessionizeSyncStrategy, IUnitOfWork, QuestionSyncStrategy, RefreshFromSessionizeCommand, RefreshFromSessionizeResultDTO, Result, RoomSyncStrategy, SessionizeResponse, SessionizeSyncContext, SessionizeSyncResult, SessionSyncStrategy, SpeakerSyncStrategy, UnitOfWork |
| 11 | `CategorySyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 10 | Category, CategorySyncStrategy, Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, SessionizeCategory, SessionizeCategoryItem, SessionizeResponse, SessionizeSyncContext, UnitOfWork |
| 11 | `ConferenceCategoryNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | Category, ConferenceCategoryNavigationPopulator, HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, UnitOfWork |
| 11 | `EventNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | Event, EventNavigationPopulator, HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, UnitOfWork |
| 11 | `QuestionSyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 1 | QuestionSyncStrategy |
| 11 | `RoomSyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 7 | Event, IUnitOfWork, RoomSyncStrategy, SessionizeResponse, SessionizeRoom, SessionizeSyncContext, UnitOfWork |
| 11 | `SessionNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, Session, SessionNavigationPopulator, UnitOfWork |
| 11 | `SessionSyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 9 | Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Session, SessionizeResponse, SessionizeSession, SessionizeSyncContext, SessionSyncStrategy, UnitOfWork |
| 11 | `SpeakerNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, Speaker, SpeakerNavigationPopulator, UnitOfWork |
| 11 | `SpeakerSyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 1 | SpeakerSyncStrategy |
| 11 | `DependencyInjection` | MMCA.ADC.Engagement.Application | 29 | ApplicationSettings, BookmarkCountService, BookmarkManagementDomainService, ClassReference, ClassReference, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IBookmarkCountService, IBookmarkManagementDomainService, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ILiveChannelPublishQueue, INavigationPopulator<in TEntity>, IUserEngagementExportService, LiveChannelPublishQueue, LivePoll, LivePollDTO, LivePollNavigationPopulator, LivePollResultsBuilder …(+9) |
| 11 | `AuthController` | MMCA.ADC.Identity.API | 18 | AuthControllerBase, AuthenticationResponse, AuthenticationService, ChangePasswordCommand, ChangePasswordRequest, ChangePreferencesCommand, ChangePreferencesRequest, CurrentUserService, GetUserPreferencesQuery, IAuthenticationService, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, LoginRequest, RegisterRequest, Result, Route, UserPreferencesResponse |
| 11 | `Program` | MMCA.ADC.UI | 1 | AppDelegate |
| 11 | `TestAuthController` | MMCA.Common.API.Tests | 3 | AuthControllerBase, IAuthenticationService, ICurrentUserService |
| 11 | `GalleryAxeTestBase` | MMCA.Common.UI.E2E.Tests | 4 | E2ETestConfiguration, GalleryE2ECollection, GalleryHostFixture, PlaywrightFixture |
| 12 | `RefreshFromSessionizeHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | ErrorType, Event, ICurrentUserService, IRepository<TEntity, TIdentifierType>, ISessionizeService, IUnitOfWork, RefreshFromSessionizeCommand, RefreshFromSessionizeHandler, SessionizeResponse |
| 12 | `ConferenceTestWebApplicationFactory` | MMCA.ADC.Conference.IntegrationTests | 8 | FakeAiScoringService, FakeBookmarkCountService, FakeSessionizeService, IAiScoringService, IBookmarkCountService, ISessionizeService, JwtTokenGenerator, Program |
| 12 | `ConferenceCrossServiceFactory` | MMCA.ADC.CrossService.IntegrationTests | 3 | InProcessJwtBearer, Program, RateLimiterNeutralizer |
| 12 | `EngagementCrossServiceFactory` | MMCA.ADC.CrossService.IntegrationTests | 3 | InProcessJwtBearer, Program, RateLimiterNeutralizer |
| 12 | `IdentityCrossServiceFactory` | MMCA.ADC.CrossService.IntegrationTests | 2 | Program, RateLimiterNeutralizer |
| 12 | `EngagementTestWebApplicationFactory` | MMCA.ADC.Engagement.IntegrationTests | 8 | FakeEventLiveValidationService, FakeSessionBookmarkValidationService, IEventLiveValidationService, ILiveChannelPublisher, ISessionBookmarkValidationService, JwtTokenGenerator, NullLiveChannelPublisher, Program |
| 12 | `GatewayApplicationFactory` | MMCA.ADC.Gateway.Tests | 1 | Program |
| 12 | `RouteMapApplicationFactory` | MMCA.ADC.Gateway.Tests | 2 | Program, RecordingHttpForwarder |
| 12 | `AuthControllerTests` | MMCA.ADC.Identity.API.Tests | 17 | AuthController, AuthenticationResponse, ChangePasswordCommand, ChangePasswordRequest, ChangePreferencesCommand, Error, ErrorType, GetUserPreferencesQuery, IAuthenticationService, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, LoginRequest, RefreshTokenRequest, RegisterRequest, Result, UserPreferencesResponse |
| 12 | `IdentityTestWebApplicationFactory` | MMCA.ADC.Identity.IntegrationTests | 6 | FakeUserEngagementExportService, FakeUserNotificationExportService, IUserEngagementExportService, IUserNotificationExportService, PiiCaptureLoggerProvider, Program |
| 12 | `NotificationTestWebApplicationFactory` | MMCA.ADC.Notification.IntegrationTests | 4 | FakeAttendeeQueryService, IAttendeeQueryService, JwtTokenGenerator, Program |
| 12 | `AuthControllerBaseTests` | MMCA.Common.API.Tests | 9 | AuthenticationResponse, Error, IAuthenticationService, ICurrentUserService, LoginRequest, RefreshTokenRequest, RegisterRequest, Result, TestAuthController |
| 12 | `ComponentsPageE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 12 | `DarkModeE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 12 | `LoginPageE2ETests` | MMCA.Common.UI.E2E.Tests | 5 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, LoginPage, PlaywrightFixture |
| 12 | `MobileTopRowE2ETests` | MMCA.Common.UI.E2E.Tests | 3 | GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 12 | `NotificationPagesE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 12 | `PseudoLocalizationE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture, SupportedCultures |
| 12 | `RegisterPageE2ETests` | MMCA.Common.UI.E2E.Tests | 5 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture, RegisterPage |
| 12 | `WebVitalsE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture, WebVitalsCollector |
| 13 | `ConferenceIntegrationTestFixture` | MMCA.ADC.Conference.IntegrationTests | 4 | ConferenceTestWebApplicationFactory, JwtTokenGenerator, Program, SqlServerIntegrationTestFixtureBase<TEntryPoint> |
| 13 | `CrossServiceFixture` | MMCA.ADC.CrossService.IntegrationTests | 4 | ConferenceCrossServiceFactory, EngagementCrossServiceFactory, IdentityCrossServiceFactory, JwtTokenGenerator |
| 13 | `EngagementIntegrationTestFixture` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementTestWebApplicationFactory, JwtTokenGenerator, Program, SqlServerIntegrationTestFixtureBase<TEntryPoint> |
| 13 | `GracefulShutdownTests` | MMCA.ADC.Gateway.Tests | 1 | GatewayApplicationFactory |
| 13 | `RouteMapTests` | MMCA.ADC.Gateway.Tests | 1 | RouteMapApplicationFactory |
| 13 | `SecurityHeadersTests` | MMCA.ADC.Gateway.Tests | 2 | GatewayApplicationFactory, SecurityHeadersTestsBase |
| 13 | `IdentityIntegrationTestFixture` | MMCA.ADC.Identity.IntegrationTests | 4 | IdentityTestWebApplicationFactory, JwtTokenGenerator, Program, SqlServerIntegrationTestFixtureBase<TEntryPoint> |
| 13 | `NotificationIntegrationTestFixture` | MMCA.ADC.Notification.IntegrationTests | 4 | JwtTokenGenerator, NotificationTestWebApplicationFactory, Program, SqlServerIntegrationTestFixtureBase<TEntryPoint> |
| 14 | `ConferenceIntegrationTestCollection` | MMCA.ADC.Conference.IntegrationTests | 1 | ConferenceIntegrationTestFixture |
| 14 | `CrossServiceCollection` | MMCA.ADC.CrossService.IntegrationTests | 1 | CrossServiceFixture |
| 14 | `EngagementIntegrationTestCollection` | MMCA.ADC.Engagement.IntegrationTests | 1 | EngagementIntegrationTestFixture |
| 14 | `IdentityIntegrationTestCollection` | MMCA.ADC.Identity.IntegrationTests | 1 | IdentityIntegrationTestFixture |
| 14 | `JwksEnabledIdentityFixture` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestFixture, JwtTokenGenerator |
| 14 | `NotificationIntegrationTestCollection` | MMCA.ADC.Notification.IntegrationTests | 1 | NotificationIntegrationTestFixture |
| 15 | `ApiVersioningTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConferenceIntegrationTestCollection, ConferenceIntegrationTestFixture, ServiceInfoVersioningContractTestsBase<TFixture> |
| 15 | `ConferenceIntegrationTestBase` | MMCA.ADC.Conference.IntegrationTests | 4 | ConferenceIntegrationTestCollection, ConferenceIntegrationTestFixture, IntegrationTestBase<TFixture>, JwtTokenGenerator |
| 15 | `OpenApiContractTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConferenceIntegrationTestCollection, ConferenceIntegrationTestFixture, OpenApiContractTestsBase<TFixture> |
| 15 | `ProblemDetailsContractTests` | MMCA.ADC.Conference.IntegrationTests | 4 | ConferenceIntegrationTestCollection, ConferenceIntegrationTestFixture, JwtTokenGenerator, ProblemDetailsContractTestsBase<TFixture> |
| 15 | `CrossServiceTestBase` | MMCA.ADC.CrossService.IntegrationTests | 5 | CrossServiceCollection, CrossServiceFixture, Email, IUnitOfWork, JwtTokenGenerator |
| 15 | `EngagementIntegrationTestBase` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementIntegrationTestCollection, EngagementIntegrationTestFixture, IntegrationTestBase<TFixture>, JwtTokenGenerator |
| 15 | `OpenApiContractTests` | MMCA.ADC.Engagement.IntegrationTests | 3 | EngagementIntegrationTestCollection, EngagementIntegrationTestFixture, OpenApiContractTestsBase<TFixture> |
| 15 | `ProblemDetailsContractTests` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementIntegrationTestCollection, EngagementIntegrationTestFixture, JwtTokenGenerator, ProblemDetailsContractTestsBase<TFixture> |
| 15 | `IdentityIntegrationTestBase` | MMCA.ADC.Identity.IntegrationTests | 4 | IdentityIntegrationTestCollection, IdentityIntegrationTestFixture, IntegrationTestBase<TFixture>, JwtTokenGenerator |
| 15 | `JwksIntegrationTestCollection` | MMCA.ADC.Identity.IntegrationTests | 1 | JwksEnabledIdentityFixture |
| 15 | `OpenApiContractTests` | MMCA.ADC.Identity.IntegrationTests | 3 | IdentityIntegrationTestCollection, IdentityIntegrationTestFixture, OpenApiContractTestsBase<TFixture> |
| 15 | `ProblemDetailsContractTests` | MMCA.ADC.Identity.IntegrationTests | 5 | Email, IdentityIntegrationTestCollection, IdentityIntegrationTestFixture, JwtTokenGenerator, ProblemDetailsContractTestsBase<TFixture> |
| 15 | `NotificationIntegrationTestBase` | MMCA.ADC.Notification.IntegrationTests | 4 | IntegrationTestBase<TFixture>, JwtTokenGenerator, NotificationIntegrationTestCollection, NotificationIntegrationTestFixture |
| 15 | `OpenApiContractTests` | MMCA.ADC.Notification.IntegrationTests | 3 | NotificationIntegrationTestCollection, NotificationIntegrationTestFixture, OpenApiContractTestsBase<TFixture> |
| 16 | `AnonymousAccessDeniedTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `AnonymousConferenceReadTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `AttendeeAccessDeniedTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `AttendeeQuestionAnswerTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `AuditStampFidelityTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `CrossServiceUserRegisteredTests` | MMCA.ADC.Conference.IntegrationTests | 5 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture, IIntegrationEventHandler<in TIntegrationEvent>, IUnitOfWork, UserRegistered |
| 16 | `IdempotencyReplayTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerAssociationEdgeCaseTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerAssociationTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerCategoryTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerConcurrencyTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerEventLifecycleTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerEventTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerQuestionAnswerTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerQuestionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerRoomEdgeCaseTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerRoomTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerSessionEdgeCaseTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OrganizerSessionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `OutputCacheEvictionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `SessionIncludeChildrenRegressionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `SessionizeRefreshTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture, FakeSessionizeService |
| 16 | `SessionSelectionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `SoftDeleteFidelityTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `SpeakerManagementTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `SpeakerUpdateAuthTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 16 | `BookmarkCountGrpcTests` | MMCA.ADC.CrossService.IntegrationTests | 2 | CrossServiceFixture, CrossServiceTestBase |
| 16 | `CrossServiceSmokeTests` | MMCA.ADC.CrossService.IntegrationTests | 2 | CrossServiceFixture, CrossServiceTestBase |
| 16 | `SpeakerLinkBrokerFlowTests` | MMCA.ADC.CrossService.IntegrationTests | 2 | CrossServiceFixture, CrossServiceTestBase |
| 16 | `UserRegisteredBrokerFlowTests` | MMCA.ADC.CrossService.IntegrationTests | 2 | CrossServiceFixture, CrossServiceTestBase |
| 16 | `AnonymousBookmarkAccessDeniedTests` | MMCA.ADC.Engagement.IntegrationTests | 2 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture |
| 16 | `AttendeeBookmarkTests` | MMCA.ADC.Engagement.IntegrationTests | 3 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeSessionBookmarkValidationService |
| 16 | `LivePollAuthorizationTests` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService, Question |
| 16 | `OrganizerLivePollLifecycleTests` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService, Question |
| 16 | `SessionQuestionLifecycleTests` | MMCA.ADC.Engagement.IntegrationTests | 3 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService |
| 16 | `AnonymousAccessDeniedTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `AnonymousAuthEdgeCaseTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `AnonymousAuthTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `AttendeeAccessDeniedTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `AttendeeAuthTests` | MMCA.ADC.Identity.IntegrationTests | 4 | AuthResponse, Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `AttendeeClaimsTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `AttendeeProfileTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `AuthPreferencesTests` | MMCA.ADC.Identity.IntegrationTests | 4 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture, PreferencesResponse |
| 16 | `CrossServiceSpeakerLinkTests` | MMCA.ADC.Identity.IntegrationTests | 8 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent>, IUnitOfWork, SpeakerLinkedToUser, SpeakerUnlinkedFromUser |
| 16 | `ErasureAndPiiLoggingTests` | MMCA.ADC.Identity.IntegrationTests | 4 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture, PiiLogCapture |
| 16 | `JwksIntegrationTestBase` | MMCA.ADC.Identity.IntegrationTests | 3 | IntegrationTestBase<TFixture>, JwksEnabledIdentityFixture, JwksIntegrationTestCollection |
| 16 | `OAuthChallengeTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `OAuthExchangeTests` | MMCA.ADC.Identity.IntegrationTests | 5 | AuthenticationResponse, ExchangeResponse, ICacheService, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `OrganizerUserTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `OutboxFidelityTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `UserExportTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 16 | `NotificationControllerTests` | MMCA.ADC.Notification.IntegrationTests | 3 | FakeAttendeeQueryService, NotificationIntegrationTestBase, NotificationIntegrationTestFixture |
| 16 | `NotificationHubTests` | MMCA.ADC.Notification.IntegrationTests | 4 | FakeAttendeeQueryService, NotificationHub, NotificationIntegrationTestBase, NotificationIntegrationTestFixture |
| 17 | `JwksDiscoveryTests` | MMCA.ADC.Identity.IntegrationTests | 3 | JwksEnabledIdentityFixture, JwksIntegrationTestBase, JwtTokenGenerator |
