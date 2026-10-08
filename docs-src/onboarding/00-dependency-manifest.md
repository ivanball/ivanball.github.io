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

- Edges resolved by namespace visibility: **20396** (~96%)
- Edges resolved by globally-unique name (fallback): **835**
- References dropped as ambiguous (matched >1 type, none visible): **109**
- Sensitivity: **1265 / 5512** type levels would change if the globally-unique fallback
  were excluded; the fallback is retained because a globally-unique first-party name is
  unambiguous, so excluding it would under-count real dependencies.

Verified non-factors (add zero hidden first-party edges, confirmed by source scan): the
`…IdentifierType` aliases all map to BCL primitives (`int`/`System.Guid`); there are no
MSBuild `<Using>` global usings and no first-party `using static`; the only two first-party
alias `using`s name a target whose bare name already matches (so they resolve regardless).

## Level distribution

| Level | Distinct types |
|-------|------|
| 0 | 1065 |
| 1 | 661 |
| 2 | 418 |
| 3 | 386 |
| 4 | 432 |
| 5 | 435 |
| 6 | 236 |
| 7 | 165 |
| 8 | 227 |
| 9 | 293 |
| 10 | 277 |
| 11 | 123 |
| 12 | 83 |
| 13 | 201 |
| 14 | 152 |
| 15 | 202 |
| 16 | 36 |
| 17 | 39 |
| 18 | 80 |
| 19 | 1 |

<a id="cycles"></a>

## Cycles (SCC size > 1): 49

| Level | Size | Members |
|-------|------|---------|
| 1 | 2 | Hosting:H2cEndpointHealthCheck, Hosting:H2cHealthCheckExtensions |
| 2 | 3 | Shared:Result, Shared:ResultJsonConverterFactory, Shared:ResultConverter |
| 2 | 2 | Shared:IStronglyTypedId<TSelf, TValue>, Shared:StronglyTypedId |
| 2 | 2 | AI:ContentPolicyGuardrail, AI:ContentPolicySettings |
| 2 | 2 | UI:NotificationHubService, UI:ChannelSubscription |
| 2 | 2 | Web:ClientConfigBuilder, Web:ClientConfigEndpointExtensions |
| 2 | 2 | Service:SelfHttpWarmupTask, Service:SelfHttpWarmupTask |
| 3 | 3 | Shared:Enumeration<TEnumeration>, Shared:EnumerationJsonConverterFactory, Shared:EnumerationConverter<TEnumeration> |
| 3 | 2 | Shared:Currency, Shared:CurrencyJsonConverter |
| 3 | 2 | Shared:Address, Shared:AddressInvariants |
| 3 | 2 | Tests:SkuId, Tests:SkuId |
| 3 | 2 | Tests:SpeakerId, Tests:SpeakerId |
| 3 | 2 | Tests:CustomerId, Tests:CustomerId |
| 3 | 2 | Tests:LineId, Tests:LineId |
| 4 | 7 | Tests:AnonymousEndpointTestsBaseTests, Tests:DriftedTests, Tests:StaleAllowListTests, Tests:StrictDriftedTests, Tests:StaleUndecoratedAllowListTests, Tests:StrictConformantTests, Tests:ConformantTests |
| 4 | 2 | Tests:Priority, Tests:Priority |
| 4 | 2 | Tests:Severity, Tests:Severity |
| 5 | 4 | Infrastructure:AmbientOrigin, Infrastructure:RestoreHandle, Infrastructure:OriginSnapshot, Infrastructure:ScopedUserOverride |
| 5 | 2 | API:WebApplicationBuilderExtensions, API:InsecureJwtMetadataWarningStartupFilter |
| 5 | 2 | Tests:CancellationTokenFitnessTests, Tests:CancellationTestMap |
| 5 | 2 | Tests:IdempotencyFitnessTests, Tests:IdempotencyTestMap |
| 5 | 2 | Tests:StronglyTypedIdFitnessTests, Tests:IdentifierFixtureMap |
| 5 | 2 | Tests:NamespaceCycleFitnessTests, Tests:CycleTestMap |
| 5 | 2 | Tests:DegradeOrder, Tests:DegradeCustomer |
| 6 | 3 | Tests:IntegrationEventContractTestsBaseTests, Tests:FixtureMap, Tests:ProbeTests |
| 6 | 3 | Domain:Category, Domain:CategoryInvariants, Domain:CategoryItem |
| 6 | 2 | Tests:ModelBuilderExtensionsTests, Tests:TestModelBuilderDbContext |
| 6 | 2 | Domain:LeaderboardOptIn, Domain:LeaderboardOptInInvariants |
| 7 | 4 | Domain:Event, Domain:EventQuestionAnswer, Domain:EventSpeaker, Domain:Room |
| 7 | 4 | Tests:Speaker, Domain:Speaker, Domain:SpeakerCategoryItem, Domain:SpeakerQuestionAnswer |
| 7 | 2 | Tests:SpecificationFitnessTests, Tests:SpecTestMap |
| 8 | 4 | Domain:Session, Domain:SessionCategoryItem, Domain:SessionQuestionAnswer, Domain:SessionSpeaker |
| 8 | 2 | Domain:LivePoll, Domain:LivePollOption |
| 10 | 2 | API:WebApplicationExtensions, API:MiddlewarePipelineBuilder |
| 10 | 2 | UI:SessionList, UI:SessionStatusDisplay |
| 11 | 23 | Infrastructure:SoftDeleteFilterSql, Infrastructure:AuditTrailSaveChangesInterceptor, Infrastructure:CrossDataSourceDegradeConvention, Infrastructure:RestrictDeleteByDefaultConvention, Infrastructure:SoftDeleteUniqueIndexConvention, Infrastructure:PhysicalDataSource, Infrastructure:ApplicationDbContext, Infrastructure:CosmosDbContext, Infrastructure:DataSourceModelCacheKeyFactory, Infrastructure:PostgreSQLDbContext, Infrastructure:SqliteDbContext, Infrastructure:SQLServerDbContext, Infrastructure:AuditSaveChangesInterceptor, Infrastructure:DomainEventSaveChangesInterceptor, Infrastructure:DeferredDispatch, Infrastructure:TenantSaveChangesInterceptor, Infrastructure:CosmosDataSourceEngine, Infrastructure:DataSourceEngines, Infrastructure:IDataSourceEngine, Infrastructure:PostgreSQLDataSourceEngine, Infrastructure:SqliteDataSourceEngine, Infrastructure:SQLServerDataSourceEngine, Infrastructure:OutboxFinalizer |
| 11 | 2 | API:SessionCookieEndpoints, API:SessionCookieJar |
| 12 | 2 | Tests:GateTestContext, Tests:GateTestContext |
| 13 | 2 | Tests:EventScopeFitnessTests, Tests:FakeConsumerMap |
| 13 | 2 | Tests:EventUpcasterFitnessTests, Tests:UpcasterTestMap |
| 13 | 2 | Tests:AuditTrailTestContext, Tests:FailingSaveInterceptor |
| 13 | 2 | Tests:MidSaveContextCreatingDbContext, Tests:ReentrantSaveInterceptor |
| 13 | 2 | Tests:CommitFailingDbContext, Tests:FailingDatabaseFacade |
| 13 | 2 | Tests:FailingSaveInterceptor, Tests:OutboxRoutingTestDbContext |
| 14 | 2 | Tests:PostgreSQLPersistenceTests, Tests:FixedAssemblyProvider |
| 14 | 2 | Tests:PostgreSQLDbContextModelTests, Tests:FixedAssemblyProvider |
| 15 | 3 | Tests:CosmosConfigurationPortabilityTests, Tests:FixedAssemblyProvider, Tests:MultiSourceSqliteIntegrationTests |
| 15 | 2 | Tests:SQLServerPersistenceTests, Tests:FixedAssemblyProvider |
| 15 | 2 | Tests:DatabaseInitializationExtensionsTests, Tests:FixedAssemblyProvider |

## Manifest (by level, then assembly)

| Level | Type | Assembly | #Deps | First-party dependencies |
|-------|------|----------|-------|--------------------------|
| 0 | `ContractRow` | MMCA.ADC.Architecture.Tests | 0 | (none) |
| 0 | `PageRoute` | MMCA.ADC.Architecture.Tests | 0 | (none) |
| 0 | `SqlAuditConventionTests` | MMCA.ADC.Architecture.Tests | 0 | (none) |
| 0 | `AddCategoryItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddEventQuestionAnswerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddEventSpeakerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddRoomRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddSessionCategoryItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddSessionQuestionAnswerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddSessionSpeakerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AddSpeakerCategoryItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `BatchEventQuestionAnswerItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `BatchSessionQuestionAnswerItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `ConferenceErrorResources` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `UpdateCategoryItemRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `UpdateEventQuestionAnswerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `UpdateRoomRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `UpdateSessionQuestionAnswerRequest` | MMCA.ADC.Conference.API | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.ADC.Conference.API.Tests | 0 | (none) |
| 0 | `ActivityTimeRangeRules<T>` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `BatchEventQuestionAnswerItem` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `BatchSessionQuestionAnswerItem` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ConferenceCategoryUpdateRequest` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `EventDateRangeRules<T>` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ExportEventCalendarQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ExportSessionCalendarQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetCategoryDistributionQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetContentSimilarityQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetNowNextQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicActivityFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicEventSpeakerFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicPartnerFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicRoomFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicSessionCategoryItemFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicSessionFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicSessionSpeakerFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicSpeakerCategoryItemFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicSpeakerFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetPublicSponsorFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionAssetsQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionBookmarkCountQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionBookmarkCountsQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionFeedbackQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionsBySpeakerFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSessionSelectionDashboardQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSpeakersByEventFilterQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `GetSpeakerSessionOverlapQuery` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `IActivityFieldsRequest` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `IEventFieldsRequest` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ISessionAssetFieldsRequest` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ISessionFieldsRequest` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ISessionScoresCacheEvictor` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `ISpeakerFieldsRequest` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `LocalityLookupEntry` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `QuestionUpdateRequest` | MMCA.ADC.Conference.Application | 0 | (none) |
| 0 | `RoomCapacityRules<T>` | MMCA.ADC.Conference.Application | 0 | (none) |
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
| 0 | `TestCategoryItemModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestCategoryModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestEventModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestQuestionModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestRoomModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestSessionizeModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestSessionModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `TestSpeakerModel` | MMCA.ADC.Conference.Application.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Conference.Domain | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Conference.Domain | 0 | (none) |
| 0 | `AiScoreResponse` | MMCA.ADC.Conference.Infrastructure | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Conference.Infrastructure | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Conference.Infrastructure | 0 | (none) |
| 0 | `StubChatClient` | MMCA.ADC.Conference.Infrastructure.Tests | 0 | (none) |
| 0 | `Arrival` | MMCA.ADC.Conference.IntegrationTests | 0 | (none) |
| 0 | `ResultInterceptor` | MMCA.ADC.Conference.IntegrationTests | 0 | (none) |
| 0 | `GoldenExpectation` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 0 | (none) |
| 0 | `GoldenSpeaker` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 0 | (none) |
| 0 | `RecordedScores` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 0 | (none) |
| 0 | `CategoryItemDistribution` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `ConferencePermissions` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `EventLiveInfo` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `LinkUserRequest` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `NowNextSessionDTO` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `PartnerType` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `QuestionModerationDefault` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `RatingQuestionSummary` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `RefreshFromSessionizeResultDTO` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `RoomSessionInfo` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `ScoreEventSessionsResultDTO` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SessionAiScoreDTO` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SessionAssetKind` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SessionAssetLimits` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SessionizeCodeFormat` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SessionStatuses` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SimilarSessionPair` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SpeakerLocalitySummary` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SpeakerSessionSummary` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SponsorLiveInfo` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `SponsorTier` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `TextQuestionResponses` | MMCA.ADC.Conference.Shared | 0 | (none) |
| 0 | `TestEvent` | MMCA.ADC.Conference.Shared.Tests | 0 | (none) |
| 0 | `CategoryItemInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `ChildEntityDeletePath` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `ConferenceRoutePaths` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `ConferenceTrackInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `EventInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `EventPhase` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `IanaTimeZoneAttribute` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `KeynoteSpeakerInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `NewestLoadTracker<T>` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `PreConferenceWorkshopInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `PublicSessionEventScope` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `PublicSessionListFilterState` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `ScorePollSignal` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `SessionAssetComposer` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `SessionAssetLinkRequest` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `SessionAssetUpdateRequest` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `SessionSchedulePageRequest` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `SpeakerInfo` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `VenueMapLinks` | MMCA.ADC.Conference.UI | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.ADC.Conference.UI.Tests | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.ADC.Conference.UI.Tests | 0 | (none) |
| 0 | `GatedHandler` | MMCA.ADC.Conference.UI.Tests | 0 | (none) |
| 0 | `SpanishCultureScope` | MMCA.ADC.Conference.UI.Tests | 0 | (none) |
| 0 | `EventFeedbackPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `FeaturedEvent` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `GatewayApi` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `LiveEventFixture` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `LiveSessionPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `MyBadgePage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `MyPointsPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `OrganizerAttendancePage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `OrganizerEventFeedbackPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `OrganizerPointsOverviewPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `OrganizerSessionFeedbackPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PresenterViewPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicEventDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicEventListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicSessionDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicSpeakerDetailPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `PublicSponsorListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `RoomCheckInPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SessionFeedbackPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SpeakerQrPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SponsorListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `SponsorVisitPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `UserListPage` | MMCA.ADC.E2E.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Engagement.API | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Engagement.API | 0 | (none) |
| 0 | `EngagementErrorResources` | MMCA.ADC.Engagement.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `BookmarkCacheEvictionSignal` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `CastVoteCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `CloseLivePollCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetAttendanceStatsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetBookmarkedSessionIdsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetEventPollsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetLeaderboardQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetModerationQueueQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetMyPointsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetOpenPollsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetOrCreateMyBadgeCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetPointsOverviewQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetPollResultsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetSessionManagePollsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetSessionQuestionsQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `GetUserBookmarksQuery` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `LiveChannelPublishWorkItem` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `OpenLivePollCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `OptInRow` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `RecordedCheckIn` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `SubmitQuestionCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `ToggleUpvoteCommand` | MMCA.ADC.Engagement.Application | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Engagement.Domain | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Engagement.Domain | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Engagement.Infrastructure | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Engagement.Infrastructure | 0 | (none) |
| 0 | `CheckInRow` | MMCA.ADC.Engagement.IntegrationTests | 0 | (none) |
| 0 | `LedgerRow` | MMCA.ADC.Engagement.IntegrationTests | 0 | (none) |
| 0 | `LedgerRow` | MMCA.ADC.Engagement.IntegrationTests | 0 | (none) |
| 0 | `BadgePayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `CastVoteRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `CheckInResultDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `CheckInScope` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `CheckInSettings` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `CreateBookmarkRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `CreateLivePollRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `EngagementPermissions` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `IBookmarkCountService` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `ISessionLiveUIService` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LeaderboardEntryDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollClosedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollOpenedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollOptionDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollOptionResultDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `LivePollStatus` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `ModerationAction` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `MyBadgeDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `PointsActivityType` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `QuestionStatus` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `RoomCheckInRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `RoomCheckInResultDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionAttendanceDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionAnsweredPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionApprovedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionChannel` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionDismissedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionPendingCountChangedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SessionQuestionUpvoteChangedPayload` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SetLeaderboardParticipationRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SponsorVisitRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SponsorVisitResultDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `SubmitQuestionRequest` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `UserEngagementBookmarkExportDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `UserEngagementPollVoteExportDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `UserEngagementQuestionUpvoteExportDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `UserEngagementSubmittedQuestionExportDTO` | MMCA.ADC.Engagement.Shared | 0 | (none) |
| 0 | `AttendeeRow` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `AttendeeSearchField` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `CheckInErrorCodes` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `CheckInState` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `EngagementRoutePaths` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `FeedbackAnswerModel` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `LiveEventContext` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `NowNextSessionInfo` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `OptionState` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `OptionState` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `ScanOutcomeKind` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `SelfCheckInOutcome<TResult>` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `SessionAttendanceRow` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `SessionInfo` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `SessionReminder` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `VisitState` | MMCA.ADC.Engagement.UI | 0 | (none) |
| 0 | `AdvanceableTimeProvider` | MMCA.ADC.Engagement.UI.Tests | 0 | (none) |
| 0 | `DisposeTrackingResponse` | MMCA.ADC.Engagement.UI.Tests | 0 | (none) |
| 0 | `GatedHttpMessageHandler` | MMCA.ADC.Engagement.UI.Tests | 0 | (none) |
| 0 | `AppHostBicepParityTests` | MMCA.ADC.Gateway.Tests | 0 | (none) |
| 0 | `ClusterProfile` | MMCA.ADC.Gateway.Tests | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Identity.API | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Identity.API | 0 | (none) |
| 0 | `IdentityErrorResources` | MMCA.ADC.Identity.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `GetUserAvatarQuery` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `GetUsersQuery` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `IExternalLoginEmailVerifier` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `RemoveUserAvatarCommand` | MMCA.ADC.Identity.Application | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Identity.Domain | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Identity.Domain | 0 | (none) |
| 0 | `SyntheticAccounts` | MMCA.ADC.Identity.Domain | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.ADC.Identity.Infrastructure | 0 | (none) |
| 0 | `ClassReference` | MMCA.ADC.Identity.Infrastructure | 0 | (none) |
| 0 | `DependencyInjection` | MMCA.ADC.Identity.Infrastructure | 0 | (none) |
| 0 | `CaseConference` | MMCA.ADC.Identity.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseIdentity` | MMCA.ADC.Identity.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseWrongSource` | MMCA.ADC.Identity.Infrastructure.Tests | 0 | (none) |
| 0 | `AuthResponse` | MMCA.ADC.Identity.IntegrationTests | 0 | (none) |
| 0 | `ExchangeResponse` | MMCA.ADC.Identity.IntegrationTests | 0 | (none) |
| 0 | `PiiLogCapture` | MMCA.ADC.Identity.IntegrationTests | 0 | (none) |
| 0 | `PreferencesResponse` | MMCA.ADC.Identity.IntegrationTests | 0 | (none) |
| 0 | `IAttendeeQueryService` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `RoleNames` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserAdminDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserAvatarDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportBookmarkDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportCheckInDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportNotificationDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportPointsEntryDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportPollVoteDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportQuestionUpvoteDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportSubjectDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `UserDataExportSubmittedQuestionDTO` | MMCA.ADC.Identity.Shared | 0 | (none) |
| 0 | `IdentityRoutePaths` | MMCA.ADC.Identity.UI | 0 | (none) |
| 0 | `RoleEdit` | MMCA.ADC.Identity.UI | 0 | (none) |
| 0 | `RoleList` | MMCA.ADC.Identity.UI | 0 | (none) |
| 0 | `UserClaimsSpanishResourcesTests` | MMCA.ADC.Identity.UI.Tests | 0 | (none) |
| 0 | `UserNotificationExportItemDTO` | MMCA.ADC.Notification.Shared | 0 | (none) |
| 0 | `FakeServerCallContext` | MMCA.ADC.Services.Tests | 0 | (none) |
| 0 | `GrpcCalls` | MMCA.ADC.Services.Tests | 0 | (none) |
| 0 | `NowNextSession` | MMCA.ADC.UI | 0 | (none) |
| 0 | `AiSettings` | MMCA.Common.AI | 0 | (none) |
| 0 | `AiUsageMeter` | MMCA.Common.AI | 0 | (none) |
| 0 | `ChatToolPolicy` | MMCA.Common.AI | 0 | (none) |
| 0 | `ContentPolicyInjectionMode` | MMCA.Common.AI | 0 | (none) |
| 0 | `GuardrailVerdict` | MMCA.Common.AI | 0 | (none) |
| 0 | `IAiTokenEstimator` | MMCA.Common.AI | 0 | (none) |
| 0 | `IChatRequestRedactor` | MMCA.Common.AI | 0 | (none) |
| 0 | `PromptContract` | MMCA.Common.AI | 0 | (none) |
| 0 | `ToolAuthorization` | MMCA.Common.AI | 0 | (none) |
| 0 | `GoldenReplayCase` | MMCA.Common.AI.Testing | 0 | (none) |
| 0 | `RecordedResponses` | MMCA.Common.AI.Testing | 0 | (none) |
| 0 | `ReplayChatClient` | MMCA.Common.AI.Testing | 0 | (none) |
| 0 | `DurationMeasurement` | MMCA.Common.AI.Tests | 0 | (none) |
| 0 | `Measurement` | MMCA.Common.AI.Tests | 0 | (none) |
| 0 | `StubChatClient` | MMCA.Common.AI.Tests | 0 | (none) |
| 0 | `AllowMissingOwnerAttribute` | MMCA.Common.API | 0 | (none) |
| 0 | `ApiParameterDescriptorBackfillProvider` | MMCA.Common.API | 0 | (none) |
| 0 | `ApiVersionReportingResultFilter` | MMCA.Common.API | 0 | (none) |
| 0 | `AppAssociationOptions` | MMCA.Common.API | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.Common.API | 0 | (none) |
| 0 | `BrowserOrigin` | MMCA.Common.API | 0 | (none) |
| 0 | `ClassReference` | MMCA.Common.API | 0 | (none) |
| 0 | `CommonForwardedHeaders` | MMCA.Common.API | 0 | (none) |
| 0 | `DbUpdateExceptionHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `DisabledFeatureHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `ErrorResources` | MMCA.Common.API | 0 | (none) |
| 0 | `ErrorResourceSource` | MMCA.Common.API | 0 | (none) |
| 0 | `ExternalAuthExtensions` | MMCA.Common.API | 0 | (none) |
| 0 | `FallbackAuthorizationOptions` | MMCA.Common.API | 0 | (none) |
| 0 | `FallbackAuthorizationRequirement` | MMCA.Common.API | 0 | (none) |
| 0 | `IdempotencyMetrics` | MMCA.Common.API | 0 | (none) |
| 0 | `IdempotencyRecord` | MMCA.Common.API | 0 | (none) |
| 0 | `IdempotencySettings` | MMCA.Common.API | 0 | (none) |
| 0 | `IErrorLocalizer` | MMCA.Common.API | 0 | (none) |
| 0 | `ISessionCookieStore` | MMCA.Common.API | 0 | (none) |
| 0 | `JwtAudience` | MMCA.Common.API | 0 | (none) |
| 0 | `JwtAuthorityExtensions` | MMCA.Common.API | 0 | (none) |
| 0 | `MiddlewarePipelineStep` | MMCA.Common.API | 0 | (none) |
| 0 | `MiddlewarePipelineStepNames` | MMCA.Common.API | 0 | (none) |
| 0 | `NonIdempotentAttribute` | MMCA.Common.API | 0 | (none) |
| 0 | `OpenApiEndpointExtensions` | MMCA.Common.API | 0 | (none) |
| 0 | `OperationCanceledExceptionHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `OutputCacheMetrics` | MMCA.Common.API | 0 | (none) |
| 0 | `OwnerOrAdminFilterOptions` | MMCA.Common.API | 0 | (none) |
| 0 | `PermissionPolicy` | MMCA.Common.API | 0 | (none) |
| 0 | `PermissionRequirement` | MMCA.Common.API | 0 | (none) |
| 0 | `QueryFilterModelBinder` | MMCA.Common.API | 0 | (none) |
| 0 | `RateLimitAlgorithm` | MMCA.Common.API | 0 | (none) |
| 0 | `RedisRateLimitLease` | MMCA.Common.API | 0 | (none) |
| 0 | `ServiceInfoResponse` | MMCA.Common.API | 0 | (none) |
| 0 | `ServiceInfoV2Response` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionClaimsToken` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionCookieRequest` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionCookieSettings` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionRefreshStatus` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionTokenResponse` | MMCA.Common.API | 0 | (none) |
| 0 | `SessionTokenResult` | MMCA.Common.API | 0 | (none) |
| 0 | `ValidationExceptionHandler` | MMCA.Common.API | 0 | (none) |
| 0 | `AsyncOnlyResponseStream` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `CultureEndpointTests` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `EndpointFeatureStub` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `ExportRow` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `FakeCategoriesController` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `FakeGrpcMetadata` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `HeaderAuthenticationHandler` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `LogEntry` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `MapCommonOpenApiAuthorizationTests` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `NextDelegateSpy` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `NonSeekableStream` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `OutputCacheEvictTagsTests` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `ProbeControllerFeatureProvider` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `ProbeDimensions` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `ProbeInvocationCounter` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `RecordingHandle` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `SingleServiceProvider` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `StubHostEnvironment` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `StubHttpClientFactory` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `StubHttpMessageHandler` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `SubjectSnapshot` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `TestUpdateRequest` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `TestUserDto` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `TrackingHandle` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `Wrapped` | MMCA.Common.API.Tests | 0 | (none) |
| 0 | `AmbientScope` | MMCA.Common.Application | 0 | (none) |
| 0 | `ApplicationSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.Common.Application | 0 | (none) |
| 0 | `AuditTrailEntryDTO` | MMCA.Common.Application | 0 | (none) |
| 0 | `BestEffortLog` | MMCA.Common.Application | 0 | (none) |
| 0 | `BestEffortMetrics` | MMCA.Common.Application | 0 | (none) |
| 0 | `BlobNames` | MMCA.Common.Application | 0 | (none) |
| 0 | `ClassReference` | MMCA.Common.Application | 0 | (none) |
| 0 | `CqrsContractMismatchKind` | MMCA.Common.Application | 0 | (none) |
| 0 | `CqrsMetrics` | MMCA.Common.Application | 0 | (none) |
| 0 | `DataSource` | MMCA.Common.Application | 0 | (none) |
| 0 | `DecoratorPipelineSeal` | MMCA.Common.Application | 0 | (none) |
| 0 | `DocumentFormats` | MMCA.Common.Application | 0 | (none) |
| 0 | `DynamicQueryConfig` | MMCA.Common.Application | 0 | (none) |
| 0 | `EmailConfirmationSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `EmailRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `FileUploadOptions` | MMCA.Common.Application | 0 | (none) |
| 0 | `FilterValueParser` | MMCA.Common.Application | 0 | (none) |
| 0 | `GetMyNotificationsQuery` | MMCA.Common.Application | 0 | (none) |
| 0 | `GetNotificationHistoryQuery` | MMCA.Common.Application | 0 | (none) |
| 0 | `GetUnreadNotificationCountQuery` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICacheInvalidating` | MMCA.Common.Application | 0 | (none) |
| 0 | `IChannelJoinAuthorizer` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICommand<TResult>` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICommandHandler<in TCommand, TResult>` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICommandWithRequest<out TRequest>` | MMCA.Common.Application | 0 | (none) |
| 0 | `IConcurrencyConflictDetector` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICorrelationContext` | MMCA.Common.Application | 0 | (none) |
| 0 | `ICreateRequest` | MMCA.Common.Application | 0 | (none) |
| 0 | `IDistributedLock` | MMCA.Common.Application | 0 | (none) |
| 0 | `IEmailSender` | MMCA.Common.Application | 0 | (none) |
| 0 | `IEntityConfigurationAssemblyProvider` | MMCA.Common.Application | 0 | (none) |
| 0 | `IFeatureGated` | MMCA.Common.Application | 0 | (none) |
| 0 | `IFilterStrategy` | MMCA.Common.Application | 0 | (none) |
| 0 | `IHasTimeout` | MMCA.Common.Application | 0 | (none) |
| 0 | `ILiveChannelPublisher` | MMCA.Common.Application | 0 | (none) |
| 0 | `ImageContentSniffer` | MMCA.Common.Application | 0 | (none) |
| 0 | `IModuleSeeder` | MMCA.Common.Application | 0 | (none) |
| 0 | `INativePushSender` | MMCA.Common.Application | 0 | (none) |
| 0 | `INotificationRecipientProvider` | MMCA.Common.Application | 0 | (none) |
| 0 | `InternalCommandDeadLetter` | MMCA.Common.Application | 0 | (none) |
| 0 | `InternalCommandNameAttribute` | MMCA.Common.Application | 0 | (none) |
| 0 | `IPasswordHasher` | MMCA.Common.Application | 0 | (none) |
| 0 | `IPermissionGrantCache` | MMCA.Common.Application | 0 | (none) |
| 0 | `IPermissionGrantCacheInvalidator` | MMCA.Common.Application | 0 | (none) |
| 0 | `IPushNotificationSender` | MMCA.Common.Application | 0 | (none) |
| 0 | `IQuery<TResult>` | MMCA.Common.Application | 0 | (none) |
| 0 | `IQueryableExecutor` | MMCA.Common.Application | 0 | (none) |
| 0 | `IQueryCacheable` | MMCA.Common.Application | 0 | (none) |
| 0 | `IQueryHandler<in TQuery, TResult>` | MMCA.Common.Application | 0 | (none) |
| 0 | `IRawSqlQueryExecutor` | MMCA.Common.Application | 0 | (none) |
| 0 | `IRequiresMfa` | MMCA.Common.Application | 0 | (none) |
| 0 | `IRequiresPermission` | MMCA.Common.Application | 0 | (none) |
| 0 | `IScheduledJob` | MMCA.Common.Application | 0 | (none) |
| 0 | `ISharedQueryCache` | MMCA.Common.Application | 0 | (none) |
| 0 | `ISoftDeletedUserValidator` | MMCA.Common.Application | 0 | (none) |
| 0 | `IssuedSession` | MMCA.Common.Application | 0 | (none) |
| 0 | `ITenantContext` | MMCA.Common.Application | 0 | (none) |
| 0 | `ITokenService` | MMCA.Common.Application | 0 | (none) |
| 0 | `ITransactional` | MMCA.Common.Application | 0 | (none) |
| 0 | `IUniqueConstraintViolationDetector` | MMCA.Common.Application | 0 | (none) |
| 0 | `IUpdatePropertySetter<TEntity>` | MMCA.Common.Application | 0 | (none) |
| 0 | `IUserScopedRequest` | MMCA.Common.Application | 0 | (none) |
| 0 | `LegalAcceptanceOptions` | MMCA.Common.Application | 0 | (none) |
| 0 | `MarkAllNotificationsReadCommand` | MMCA.Common.Application | 0 | (none) |
| 0 | `MarkNotificationReadCommand` | MMCA.Common.Application | 0 | (none) |
| 0 | `MmcaApplicationPipelineBuilder` | MMCA.Common.Application | 0 | (none) |
| 0 | `ModuleSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `MutationContext` | MMCA.Common.Application | 0 | (none) |
| 0 | `NavigationType` | MMCA.Common.Application | 0 | (none) |
| 0 | `NonNegativeIntRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `OptionalErrorCodeExtensions` | MMCA.Common.Application | 0 | (none) |
| 0 | `OptionalPositiveIdRules<T, TId>` | MMCA.Common.Application | 0 | (none) |
| 0 | `OptionalStringRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `OutboxDeadLetter` | MMCA.Common.Application | 0 | (none) |
| 0 | `PagingMath` | MMCA.Common.Application | 0 | (none) |
| 0 | `PasswordResetSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `PasswordRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `PermissionGrantSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `PositiveDecimalRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `PositiveIntRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `PropertyAccessor` | MMCA.Common.Application | 0 | (none) |
| 0 | `QueryCachePipelineSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `QueryFieldContract` | MMCA.Common.Application | 0 | (none) |
| 0 | `RecoveryCodeSet` | MMCA.Common.Application | 0 | (none) |
| 0 | `RefreshSessionSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `RequiredIdRules<T, TId>` | MMCA.Common.Application | 0 | (none) |
| 0 | `RequiredStringRules<T>` | MMCA.Common.Application | 0 | (none) |
| 0 | `TwoFactorOutcome` | MMCA.Common.Application | 0 | (none) |
| 0 | `TwoFactorSettings` | MMCA.Common.Application | 0 | (none) |
| 0 | `UserAdministrationQuery` | MMCA.Common.Application | 0 | (none) |
| 0 | `UserDataExportSectionDefaults` | MMCA.Common.Application | 0 | (none) |
| 0 | `AddOrderLineCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `BillingFakeCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `BillingFakeQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `CacheProbeEntity` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `CapturedCounter` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `CapturedMeasurement` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `Category` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `CqrsMetricsProbeCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `CqrsMetricsProbeQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `FakeModuleTracker` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `FixedClock` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `FixedTimeProvider` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `IFakeRemoteContract` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `LogEntry` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `MappedDto` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `NonCacheableTestQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `NonTransactionalCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `OrderPrimitiveDTO` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `OrderUpdateRequest` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PackageGraphPurityTests` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PipelineMarker` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PipelinePingCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PipelinePingQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PipelineTestCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PlainCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PlainQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `PlainTestCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `ProductDto` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `ProfilingTestCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `ProfilingTestQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `RecordingLogger` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `RecordingLogger` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `RemoveOrderLineCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `RenameOrderCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `RenameOrderResult` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `ScanFailingAssembly` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `ScopedProbe` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `SortTestEntity` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `SpeakerDto` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestAddressModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestDecimalModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestGuidModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestIntModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestLoggingCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestLoggingQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestOptionalIntModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestOptionalStringModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestRequest` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestStringModel` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestValidatingCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `TestValidatingQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `UnbudgetedCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `UnbudgetedQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `UngatedStepUpCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `UnguardedCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `UnguardedQuery` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `UnmarkedCommand` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `Widget` | MMCA.Common.Application.Tests | 0 | (none) |
| 0 | `AbstractAnonymousFixtureControllerBase` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `AbstractFitnessControllerBase` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `AnonymousFixtureController` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ArchiveTicketCommand` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ArgumentGuardFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `AsyncClockReadingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `AsyncLambdaClockReadingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `CompliantFixtureService` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `CreateTicketCommand` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `Declaration` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `EngineHit` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ExemptableFixtureService` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ExternalContractFixtureService` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `FatFixtureController` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `GetFixturePreferencesQuery` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `GetFixtureProjectionQuery` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `IBadgeGranter` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `IdempotentFitnessController` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `IFakeExportService` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `IndirectThrowFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `InjectedClockFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `InvalidOperationThrowingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `LambdaClockReadingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `LeftModelBase` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `MisnamedTokenFixtureService` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `MisplacedTokenFixtureService` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `MissingTokenFixtureService` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `NonIdempotentFitnessController` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `NonThrowingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `OffsetNowReadingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `PasswordProbe` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `PurgeTicketsCommand` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ReadRepositoryFixtureCommand` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ReadRepositoryFixtureQuery` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `RebuildFixtureProjectionCommand` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `RebuildTicketIndexCommand` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ReopenTicketRequest` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ResourceEntry` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `RethrowingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `SwitchExpressionFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `ThinFixtureController` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `TicketDomainException` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `TodayReadingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `TwoMemberClockFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `TypeLevelAnonymousFixtureController` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `UndeclaredFitnessController` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `UndecoratedFixtureController` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `UpdateTicketRequest` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `UtcNowReadingFixture` | MMCA.Common.Architecture.Tests | 0 | (none) |
| 0 | `CspNonce` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `CspPolicy` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `DataProtectionExtensions` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `DownstreamProbeVersion` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `Entry` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `GatewayCorsExtensions` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `GatewayDownstreamRegistry` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `GatewayRateLimitingSettings` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `HealthCheckTags` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `HealthEndpointPaths` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `HealthReportCacheOptions` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `IWarmupTask` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `KestrelListenerSpec` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `KeyVaultConfigurationExtensions` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `LeadingSlashPathPrefixesAttribute` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `RedisCachingExtensions` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `RedisPingHealthCheck` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `SecurityHeadersSettings` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `SerilogHostExtensions` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `WarmupReadinessGate` | MMCA.Common.Aspire | 0 | (none) |
| 0 | `BrokerSelection` | MMCA.Common.Aspire.Hosting | 0 | (none) |
| 0 | `H2cHealthCheckRegistry` | MMCA.Common.Aspire.Hosting | 0 | (none) |
| 0 | `ServiceBusEmulatorResource` | MMCA.Common.Aspire.Hosting | 0 | (none) |
| 0 | `StubHandler` | MMCA.Common.Aspire.Hosting.Tests | 0 | (none) |
| 0 | `CapturingLogger` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `CountingCheck` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `DataProtectionExtensionsTests` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `FakeEnvironment` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `FakeLifetime` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `FakeServer` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `LiveMetricsConfigurationTests` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `ProbeAttempt` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `RecordingHttpResponseFeature` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `ServiceDefaultsRetryTests` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `SourceCollectingConfigurationManager` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `StartableResponseFeature` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `StubClock` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `StubHostEnvironment` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `StubHostEnvironment` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `StubHttpClientFactory` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `StubLoggingBuilder` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `StubMetricsBuilder` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `StubWebHostEnvironment` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `TestServerHost` | MMCA.Common.Aspire.Tests | 0 | (none) |
| 0 | `ProductRow` | MMCA.Common.Benchmarks | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.Common.Domain | 0 | (none) |
| 0 | `ClassReference` | MMCA.Common.Domain | 0 | (none) |
| 0 | `DomainEntityState` | MMCA.Common.Domain | 0 | (none) |
| 0 | `EventNameAttribute` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IAuditableEntity` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IAuditedEntity` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IAuthUser` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IBaseEntity<TIdentifierType>` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IDomainEvent` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IdValueGeneratedAttribute` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IHasOrderingKey` | MMCA.Common.Domain | 0 | (none) |
| 0 | `IRowVersioned` | MMCA.Common.Domain | 0 | (none) |
| 0 | `ITenantEntity` | MMCA.Common.Domain | 0 | (none) |
| 0 | `ITwoFactorUserState` | MMCA.Common.Domain | 0 | (none) |
| 0 | `NavigationAttribute` | MMCA.Common.Domain | 0 | (none) |
| 0 | `OrderExpression` | MMCA.Common.Domain | 0 | (none) |
| 0 | `ParameterReplacer` | MMCA.Common.Domain | 0 | (none) |
| 0 | `PiiAttribute` | MMCA.Common.Domain | 0 | (none) |
| 0 | `PushNotificationStatus` | MMCA.Common.Domain | 0 | (none) |
| 0 | `RedactableProperty` | MMCA.Common.Domain | 0 | (none) |
| 0 | `DecoratedEntity` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `EntityWithNavigation` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `InvocationFinder` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `NoPii` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `ParameterFinder` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `PiiBase` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `Subject` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `TestScope` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `UndecoratedEntity` | MMCA.Common.Domain.Tests | 0 | (none) |
| 0 | `ForwardedHeadersExtensions` | MMCA.Common.Gateway | 0 | (none) |
| 0 | `GatewayActiveHealthCheckDefaults` | MMCA.Common.Gateway | 0 | (none) |
| 0 | `GatewayClusterRequestProfile` | MMCA.Common.Gateway | 0 | (none) |
| 0 | `GatewayPassiveHealthCheckDefaults` | MMCA.Common.Gateway | 0 | (none) |
| 0 | `GatewayRoutePolicyPartition` | MMCA.Common.Gateway | 0 | (none) |
| 0 | `GatewayTraceHeaderSettings` | MMCA.Common.Gateway | 0 | (none) |
| 0 | `EmptyServiceProvider` | MMCA.Common.Gateway.Tests | 0 | (none) |
| 0 | `GrpcWireFormat` | MMCA.Common.Grpc | 0 | (none) |
| 0 | `JwtForwardingClientInterceptor` | MMCA.Common.Grpc | 0 | (none) |
| 0 | `AuthenticateResultFeatureStub` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `CountingFailureHandler` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeClient` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeGrpcClient` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeRequest` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeResponse` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `FakeServerCallContext` | MMCA.Common.Grpc.Tests | 0 | (none) |
| 0 | `ApplicationNamespace` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `AssemblyReference` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `AuditTrailEntry` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `BrokerMetrics` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `CacheKeyPrefixOptions` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `CacheOptions` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `CaptureContext` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ClassReference` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ColumnWidth` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ConnectionStringSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `CosmosIntIdValueGenerator` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `CrossTenantWriteException` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `DataSourceEntrySettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `DefaultSeed` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `DetectChangesScope` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `EmailConfirmationEntry` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `EncryptedStringConverter` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `EntityConfigurationOptions` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ExplicitKeyInsertGroup` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ExplicitKeyInsertRoundOrder` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `FaultEndpointConfigurator` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `FileStorageSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `GroupedCount<TKey>` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `GroupedSum<TKey>` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IDbSeeder` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IInboxStore` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IInternalCommandSignal` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IJwksProvider` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `InboxDisabledWarningService` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `InboxMessage` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `InProcessLockHandle` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `InternalCommandCycleResult` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `InternalCommandOrigin` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `InternalCommandsDisabledNoticeService` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `IOutboxSignal` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `JobClaim` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `JwksSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `JwtForwardingDelegatingHandler` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `JwtSigningAlgorithm` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `LocalLease` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `LoginProtectionSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `LookupRow<TId, TName>` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `MessageBusProvider` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `MigrationPolicy` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ModelBuilderExtensions` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `NativePushPayloads` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `NativePushSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `OutboxCycleResult` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `OutboxDisabledNoticeService` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `OutboxOrigin` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `PasswordResetEntry` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `PeriodicBackgroundService` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `PermissionGrantModelGate` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `PersistenceSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ProfilingHelper` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `RedisLockHandle` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `RedisPrefixScanner` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `RowVersionStrategy` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ScheduledJobEntry` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ScheduledJobOverrideSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `SchedulerMetrics` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `SeedAccount` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ServiceBusEmulatorSupport` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `SmtpSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `StronglyTypedIdValueComparer<TSelf>` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `TenantDataSourceOverrideSettings` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `TenantResolutionStrategy` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `TransactionCommitAmbiguousException` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `UseDatabaseAttribute` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `UtcDateTimeConverter` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `ValueHolder<T>` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `WakeUpSignal` | MMCA.Common.Infrastructure | 0 | (none) |
| 0 | `AlwaysRetryExecutionStrategy` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseDefaultSettings` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseEnabledDefaultSource` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseMappingShape` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseNamedSource` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseNoOptIn` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseNoSettings` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseOptedInDefaultSource` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CaseSettingsOnly` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `Category` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CategoryItem` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CountingAllocator` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CycleLeft` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `CycleRight` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `DrillResult` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `FakeEntity` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `FakeTimeProvider` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `FaultingHybridCache` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `GrantOnlyContextBase` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `IFakeContract` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `ImageFrameBoundCollection` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `ManualClock` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `ManualClock` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `Observation` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `OrderPlacedTestEvent` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `ParentDetail` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `PiiBaseThing` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `PlainThing` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `PropertyFacets` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `RecordedExecution` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `RecordingDistributedCache` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `RecordingHybridCache` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `SeededIds` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `SessionOnlyContextBase` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `SharedStore` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `SignalingEntry` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `SqlClientEntraAuthenticationTests` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `StubHostEnvironment` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `Tag` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `TestAddress` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `TestDuplexPipe` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `TestItem` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `ThingAddress` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `UnregisteredEntity` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `WidgetRow` | MMCA.Common.Infrastructure.Tests | 0 | (none) |
| 0 | `LoadResults` | MMCA.Common.LoadTests | 0 | (none) |
| 0 | `PagedQuery` | MMCA.Common.LoadTests | 0 | (none) |
| 0 | `AcceptLegalTermsRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `AdministrationPermissions` | MMCA.Common.Shared | 0 | (none) |
| 0 | `AuthClaimTypes` | MMCA.Common.Shared | 0 | (none) |
| 0 | `AuthenticationRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `AuthenticationResponse` | MMCA.Common.Shared | 0 | (none) |
| 0 | `AuthErrorCodes` | MMCA.Common.Shared | 0 | (none) |
| 0 | `BrokerResilienceDefaults` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ChangePasswordRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ChangePreferencesRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `CollectionResult<T>` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ConcurrencyETag` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ConfirmEmailRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `DeviceInstallationRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `DomainException` | MMCA.Common.Shared | 0 | (none) |
| 0 | `DomainHelper` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ErrorType` | MMCA.Common.Shared | 0 | (none) |
| 0 | `FeatureFlagLifetime` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ForgotPasswordRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `HttpResilienceDefaults` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IBaseDTO<TIdentifierType>` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IConcurrencyAware` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IcsEvent` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IdempotencyHeaders` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IPermissionCatalog` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IPermissionRegistry` | MMCA.Common.Shared | 0 | (none) |
| 0 | `IUserAdminDTO` | MMCA.Common.Shared | 0 | (none) |
| 0 | `KeysetCursor` | MMCA.Common.Shared | 0 | (none) |
| 0 | `KeysetPageRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `LegalAcceptanceDTO` | MMCA.Common.Shared | 0 | (none) |
| 0 | `LegalAcceptanceErrorCodes` | MMCA.Common.Shared | 0 | (none) |
| 0 | `LegalAcceptanceRoutes` | MMCA.Common.Shared | 0 | (none) |
| 0 | `LoginRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `MessageHeaders` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ModuleNameConventions` | MMCA.Common.Shared | 0 | (none) |
| 0 | `NotificationPermissions` | MMCA.Common.Shared | 0 | (none) |
| 0 | `NotificationScopeKey` | MMCA.Common.Shared | 0 | (none) |
| 0 | `OAuthCodeExchangeRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `PaginationMetadata` | MMCA.Common.Shared | 0 | (none) |
| 0 | `PasswordComplexity` | MMCA.Common.Shared | 0 | (none) |
| 0 | `PermissionCatalogResponse` | MMCA.Common.Shared | 0 | (none) |
| 0 | `PropertyReader` | MMCA.Common.Shared | 0 | (none) |
| 0 | `RefreshSessionSummaryResponse` | MMCA.Common.Shared | 0 | (none) |
| 0 | `RefreshTokenRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `Releaser` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ResetPasswordRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `RolePermissionsResponse` | MMCA.Common.Shared | 0 | (none) |
| 0 | `SendEmailConfirmationRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `SendPushNotificationRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ServiceContractAttribute` | MMCA.Common.Shared | 0 | (none) |
| 0 | `SetRolePermissionsRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `SetUserRolesRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `StronglyTypedIdValueParserDelegate<TValue>` | MMCA.Common.Shared | 0 | (none) |
| 0 | `SupportedCultures` | MMCA.Common.Shared | 0 | (none) |
| 0 | `TwoFactorCodeRequest` | MMCA.Common.Shared | 0 | (none) |
| 0 | `TwoFactorRecoveryCodesResponse` | MMCA.Common.Shared | 0 | (none) |
| 0 | `TwoFactorSetupResponse` | MMCA.Common.Shared | 0 | (none) |
| 0 | `UserDataExportSectionDTO` | MMCA.Common.Shared | 0 | (none) |
| 0 | `UserNotificationDTO` | MMCA.Common.Shared | 0 | (none) |
| 0 | `UserPreferencesResponse` | MMCA.Common.Shared | 0 | (none) |
| 0 | `ValueObject` | MMCA.Common.Shared | 0 | (none) |
| 0 | `DomainHelperTests` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `Payload` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `ProbeFeatures` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `ProbeSettings` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `SalesFakeAggregate` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `SalesFakeOrder` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `SalesFakeUseCase` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `TestDTO` | MMCA.Common.Shared.Tests | 0 | (none) |
| 0 | `CrossServiceDataSource` | MMCA.Common.Testing | 0 | (none) |
| 0 | `DependencyInjectionAssert` | MMCA.Common.Testing | 0 | (none) |
| 0 | `EntityBuilderBase<TBuilder, TEntity>` | MMCA.Common.Testing | 0 | (none) |
| 0 | `FeatureManagementTestExtensions` | MMCA.Common.Testing | 0 | (none) |
| 0 | `IIntegrationTestFixture` | MMCA.Common.Testing | 0 | (none) |
| 0 | `JwtTokenGenerator` | MMCA.Common.Testing | 0 | (none) |
| 0 | `MmcaGatewayHardeningTestsBase<TEntryPoint>` | MMCA.Common.Testing | 0 | (none) |
| 0 | `ProductionHostApplicationFactory<TEntryPoint>` | MMCA.Common.Testing | 0 | (none) |
| 0 | `RateLimiterTestExtensions` | MMCA.Common.Testing | 0 | (none) |
| 0 | `SecurityHeadersTestsBase` | MMCA.Common.Testing | 0 | (none) |
| 0 | `ServiceBusEmulatorFixtureBase` | MMCA.Common.Testing | 0 | (none) |
| 0 | `TestPolling` | MMCA.Common.Testing | 0 | (none) |
| 0 | `AnonymousEndpointTestsBase` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `ArchitectureAssert` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `BrandColorTokenTestsBase` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `CallGraphIndex` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `CostTagConventionTestsBase` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `CrossEntityNavigationFinder` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `FlagDeclaration` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `ForeignKeyDeleteFact` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `Layer` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `MessageBusBackpressureTestsBase` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `ModuleConformanceTestsBase<TModule>` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `ObservabilityConventionTestsBase` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `ProtoScopeKind` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `RouteAuthorizationTestsBase` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `RuleHelpers` | MMCA.Common.Testing.Architecture | 0 | (none) |
| 0 | `AppHostEnvironmentRequirement` | MMCA.Common.Testing.Aspire | 0 | (none) |
| 0 | `AppHostProbePaths` | MMCA.Common.Testing.Aspire | 0 | (none) |
| 0 | `AppHostReadinessBudget` | MMCA.Common.Testing.Aspire | 0 | (none) |
| 0 | `DeveloperCertificateAvailability` | MMCA.Common.Testing.Aspire | 0 | (none) |
| 0 | `DockerAvailability` | MMCA.Common.Testing.Aspire | 0 | (none) |
| 0 | `EphemeralRsaKeyPair` | MMCA.Common.Testing.Aspire | 0 | (none) |
| 0 | `H2cProbe` | MMCA.Common.Testing.Aspire | 0 | (none) |
| 0 | `AccessibilityViolationException` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `AdminCredentials` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `AuthOutcome` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `AxeOptions` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `E2EPolling` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `E2ETestConfiguration` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `ForgotPasswordPage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `LoginPage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `ProfilePage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `PseudoLocalizedPage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `RegisterPage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `ResetPasswordPage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `RoleAdminPage` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `UserCredentials` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `WebVitalsSample` | MMCA.Common.Testing.E2E | 0 | (none) |
| 0 | `FakeHandler` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `FeatureManagementTestExtensionsTests` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `ISampleService` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `PingCommand` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `PingQuery` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `RateLimiterTestExtensionsTests` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `SampleGatewayEntryPoint` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `StampingTransformer` | MMCA.Common.Testing.Tests | 0 | (none) |
| 0 | `BunitInteractionExtensions` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `CapturedRequest` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `ErrorSummaryExtensions` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `FreshApiClientFactory` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `MarkupSnapshotResult` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `MudProviderHandles` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `MutableAuthenticationStateProvider` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `Route` | MMCA.Common.Testing.UI | 0 | (none) |
| 0 | `AbsoluteUrlAttribute` | MMCA.Common.UI | 0 | (none) |
| 0 | `ApiFileDownloadButton` | MMCA.Common.UI | 0 | (none) |
| 0 | `AppResumedEventArgs` | MMCA.Common.UI | 0 | (none) |
| 0 | `BackNavigationResult` | MMCA.Common.UI | 0 | (none) |
| 0 | `BrandColors` | MMCA.Common.UI | 0 | (none) |
| 0 | `BreakpointConstants` | MMCA.Common.UI | 0 | (none) |
| 0 | `BuiltInStrings` | MMCA.Common.UI | 0 | (none) |
| 0 | `CachedPage` | MMCA.Common.UI | 0 | (none) |
| 0 | `ChannelReferenceCounter` | MMCA.Common.UI | 0 | (none) |
| 0 | `ComponentLifetimeExtensions` | MMCA.Common.UI | 0 | (none) |
| 0 | `ConfirmationState` | MMCA.Common.UI | 0 | (none) |
| 0 | `CultureDelegatingHandler` | MMCA.Common.UI | 0 | (none) |
| 0 | `DevicePreferenceKeys` | MMCA.Common.UI | 0 | (none) |
| 0 | `ErrorMessages` | MMCA.Common.UI | 0 | (none) |
| 0 | `GeoPoint` | MMCA.Common.UI | 0 | (none) |
| 0 | `IAccessibilityAnnouncer` | MMCA.Common.UI | 0 | (none) |
| 0 | `IApiSettings` | MMCA.Common.UI | 0 | (none) |
| 0 | `IAppDialogService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IBarcodeScannerService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IBatteryStatusService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IBiometricAuthenticator` | MMCA.Common.UI | 0 | (none) |
| 0 | `IClipboardService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IConnectivityStatusService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ICultureApplier` | MMCA.Common.UI | 0 | (none) |
| 0 | `IDevicePreferences` | MMCA.Common.UI | 0 | (none) |
| 0 | `IExternalAuthBroker` | MMCA.Common.UI | 0 | (none) |
| 0 | `IExternalLinkService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IFormFactor` | MMCA.Common.UI | 0 | (none) |
| 0 | `IHapticFeedbackService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IHomePageContent` | MMCA.Common.UI | 0 | (none) |
| 0 | `IInitialThemeModeSource` | MMCA.Common.UI | 0 | (none) |
| 0 | `ILocalCacheStore` | MMCA.Common.UI | 0 | (none) |
| 0 | `IMapNavigationService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IModelValidator` | MMCA.Common.UI | 0 | (none) |
| 0 | `InfiniteScrollSentinel` | MMCA.Common.UI | 0 | (none) |
| 0 | `INotificationScopeProvider` | MMCA.Common.UI | 0 | (none) |
| 0 | `IOAuthUISettings` | MMCA.Common.UI | 0 | (none) |
| 0 | `IPublicLinkBuilder` | MMCA.Common.UI | 0 | (none) |
| 0 | `IPushRegistrationService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IScreenshotService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ISecureTokenStore` | MMCA.Common.UI | 0 | (none) |
| 0 | `ISessionCookieSync` | MMCA.Common.UI | 0 | (none) |
| 0 | `IShareService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ISpeechToTextService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ITextToSpeechService` | MMCA.Common.UI | 0 | (none) |
| 0 | `ITokenRefresher` | MMCA.Common.UI | 0 | (none) |
| 0 | `ITokenStorageService` | MMCA.Common.UI | 0 | (none) |
| 0 | `IUiReadCache` | MMCA.Common.UI | 0 | (none) |
| 0 | `IUserPreferenceWriter` | MMCA.Common.UI | 0 | (none) |
| 0 | `JwtTokenInfo` | MMCA.Common.UI | 0 | (none) |
| 0 | `LatestLoadGuard` | MMCA.Common.UI | 0 | (none) |
| 0 | `LayoutSettings` | MMCA.Common.UI | 0 | (none) |
| 0 | `LazyJsModule` | MMCA.Common.UI | 0 | (none) |
| 0 | `LegalSettings` | MMCA.Common.UI | 0 | (none) |
| 0 | `ListPageState` | MMCA.Common.UI | 0 | (none) |
| 0 | `LocalNotificationRequest` | MMCA.Common.UI | 0 | (none) |
| 0 | `Login` | MMCA.Common.UI | 0 | (none) |
| 0 | `MudTranslations` | MMCA.Common.UI | 0 | (none) |
| 0 | `NavSection` | MMCA.Common.UI | 0 | (none) |
| 0 | `NotificationBellOptions` | MMCA.Common.UI | 0 | (none) |
| 0 | `NotificationPageNotFoundStatus` | MMCA.Common.UI | 0 | (none) |
| 0 | `NotificationPageRequirement` | MMCA.Common.UI | 0 | (none) |
| 0 | `NotificationState` | MMCA.Common.UI | 0 | (none) |
| 0 | `OptionalEmailAttribute` | MMCA.Common.UI | 0 | (none) |
| 0 | `PendingAttempt` | MMCA.Common.UI | 0 | (none) |
| 0 | `PermissionGroup` | MMCA.Common.UI | 0 | (none) |
| 0 | `PersistedGridState` | MMCA.Common.UI | 0 | (none) |
| 0 | `PickedMedia` | MMCA.Common.UI | 0 | (none) |
| 0 | `PseudoLocalizer` | MMCA.Common.UI | 0 | (none) |
| 0 | `PushDeviceToken` | MMCA.Common.UI | 0 | (none) |
| 0 | `QrErrorCorrectionLevel` | MMCA.Common.UI | 0 | (none) |
| 0 | `RatingStars` | MMCA.Common.UI | 0 | (none) |
| 0 | `RegistrationSettings` | MMCA.Common.UI | 0 | (none) |
| 0 | `ReturnUrlProtector` | MMCA.Common.UI | 0 | (none) |
| 0 | `RoleAdminEditResources` | MMCA.Common.UI | 0 | (none) |
| 0 | `RoleAdminListResources` | MMCA.Common.UI | 0 | (none) |
| 0 | `RoutePaths` | MMCA.Common.UI | 0 | (none) |
| 0 | `SameOriginProxyHeaders` | MMCA.Common.UI | 0 | (none) |
| 0 | `SharedResource` | MMCA.Common.UI | 0 | (none) |
| 0 | `StringLocalizerPluralExtensions` | MMCA.Common.UI | 0 | (none) |
| 0 | `ThemeInterop` | MMCA.Common.UI | 0 | (none) |
| 0 | `ToastSeverity` | MMCA.Common.UI | 0 | (none) |
| 0 | `TokenAcquisition` | MMCA.Common.UI | 0 | (none) |
| 0 | `UIModuleConfiguration` | MMCA.Common.UI | 0 | (none) |
| 0 | `UiReadCacheOptions` | MMCA.Common.UI | 0 | (none) |
| 0 | `UISharedAssemblyReference` | MMCA.Common.UI | 0 | (none) |
| 0 | `UnboundedReconnectPolicy` | MMCA.Common.UI | 0 | (none) |
| 0 | `UserAdminListResources` | MMCA.Common.UI | 0 | (none) |
| 0 | `UserAgentSummary` | MMCA.Common.UI | 0 | (none) |
| 0 | `UserPreferences` | MMCA.Common.UI | 0 | (none) |
| 0 | `UserPreferencesRequest` | MMCA.Common.UI | 0 | (none) |
| 0 | `WebApplicationExtensions` | MMCA.Common.UI | 0 | (none) |
| 0 | `InpProbe` | MMCA.Common.UI.E2E.Tests | 0 | (none) |
| 0 | `SampleGridRow` | MMCA.Common.UI.Gallery | 0 | (none) |
| 0 | `BarcodeScanPage` | MMCA.Common.UI.Maui | 0 | (none) |
| 0 | `MauiErrorHandlingInitializer` | MMCA.Common.UI.Maui | 0 | (none) |
| 0 | `MauiThemeStore` | MMCA.Common.UI.Maui | 0 | (none) |
| 0 | `BareEmailModel` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `BareUrlModel` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `CapturedRequest` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `CapturingHandler` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `ChildModel` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `ComponentLifetimeExtensionsTests` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `CultureMutatingCollection` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `CultureScope` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `EmailModel` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `FakeLocalizer` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `FakeStringLocalizer` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `GatedGetHandler` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `KeyedModel` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `MembershipDto` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `PageLocalizer` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `PageLocalizer` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `PipePair` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `ProbeContentHeader` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `ProbeLayoutComponent` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `RecordingNavigationManager` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `ReExecuteFeature` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `ResxMudLocalizerTests` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `ScriptedHandler` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `StubHandler` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `StubHttpClientFactory` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `StubLocalizer` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `StubLocalizer` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `StubLocalizer` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `TrackingHttpResponseMessage` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `UrlModel` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `WidgetRow` | MMCA.Common.UI.Tests | 0 | (none) |
| 0 | `BlazorCircuitLimitSettings` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `BlazorCspSettings` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `BrowserOriginHandler` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `HandoffBody` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `ProxyResponseMode` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `SameOriginApiProxyMarker` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `SameOriginApiProxySettings` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `SameOriginProxyInvoker` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `TokenPair` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `TrustedCallerHandler` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `UiRateLimitingSettings` | MMCA.Common.UI.Web | 0 | (none) |
| 0 | `CapturingHandler` | MMCA.Common.UI.Web.Tests | 0 | (none) |
| 0 | `Jwt` | MMCA.Common.UI.Web.Tests | 0 | (none) |
| 0 | `ManualClock` | MMCA.Common.UI.Web.Tests | 0 | (none) |
| 0 | `ProbeHub` | MMCA.Common.UI.Web.Tests | 0 | (none) |
| 0 | `RefusingAuthenticationHandler` | MMCA.Common.UI.Web.Tests | 0 | (none) |
| 0 | `SeenRequest` | MMCA.Common.UI.Web.Tests | 0 | (none) |
| 0 | `SentRequest` | MMCA.Common.UI.Web.Tests | 0 | (none) |
| 1 | `BrandColorTokenTests` | MMCA.ADC.Architecture.Tests | 1 | BrandColorTokenTestsBase |
| 1 | `ContractTable` | MMCA.ADC.Architecture.Tests | 1 | ContractRow |
| 1 | `CostTagConventionTests` | MMCA.ADC.Architecture.Tests | 1 | CostTagConventionTestsBase |
| 1 | `MessageBusBackpressureTests` | MMCA.ADC.Architecture.Tests | 1 | MessageBusBackpressureTestsBase |
| 1 | `ObservabilityConventionTests` | MMCA.ADC.Architecture.Tests | 1 | ObservabilityConventionTestsBase |
| 1 | `BatchAddEventQuestionAnswersRequest` | MMCA.ADC.Conference.API | 1 | BatchEventQuestionAnswerItemRequest |
| 1 | `BatchAddSessionQuestionAnswersRequest` | MMCA.ADC.Conference.API | 1 | BatchSessionQuestionAnswerItemRequest |
| 1 | `ConferenceErrorResourcesTests` | MMCA.ADC.Conference.API.Tests | 2 | ConferenceErrorResources, IErrorLocalizer |
| 1 | `ConferencePermissionGrantsTests` | MMCA.ADC.Conference.API.Tests | 3 | ConferencePermissions, IPermissionRegistry, RoleNames |
| 1 | `ActivityEventIdRules<T>` | MMCA.ADC.Conference.Application | 1 | RequiredIdRules<T, TId> |
| 1 | `ActivitySortOrderRules<T>` | MMCA.ADC.Conference.Application | 1 | NonNegativeIntRules<T> |
| 1 | `ActivityUpdateRequest` | MMCA.ADC.Conference.Application | 1 | IActivityFieldsRequest |
| 1 | `CategoryItemSortRules<T>` | MMCA.ADC.Conference.Application | 1 | NonNegativeIntRules<T> |
| 1 | `DeleteSessionAssetCommand` | MMCA.ADC.Conference.Application | 1 | ITransactional |
| 1 | `EventSessionizeCodeRules<T>` | MMCA.ADC.Conference.Application | 1 | SessionizeCodeFormat |
| 1 | `EventUpdateRequest` | MMCA.ADC.Conference.Application | 2 | IEventFieldsRequest, QuestionModerationDefault |
| 1 | `IPartnerFieldsRequest` | MMCA.ADC.Conference.Application | 1 | PartnerType |
| 1 | `ISponsorFieldsRequest` | MMCA.ADC.Conference.Application | 1 | SponsorTier |
| 1 | `PartnerEventIdRules<T>` | MMCA.ADC.Conference.Application | 1 | RequiredIdRules<T, TId> |
| 1 | `PartnerSortRules<T>` | MMCA.ADC.Conference.Application | 1 | NonNegativeIntRules<T> |
| 1 | `RoomSortRules<T>` | MMCA.ADC.Conference.Application | 1 | NonNegativeIntRules<T> |
| 1 | `SessionAssetLinkRequest` | MMCA.ADC.Conference.Application | 1 | ISessionAssetFieldsRequest |
| 1 | `SessionAssetSessionIdRules<T>` | MMCA.ADC.Conference.Application | 1 | RequiredIdRules<T, TId> |
| 1 | `SessionAssetSortOrderRules<T>` | MMCA.ADC.Conference.Application | 1 | NonNegativeIntRules<T> |
| 1 | `SessionAssetUpdateRequest` | MMCA.ADC.Conference.Application | 1 | ISessionAssetFieldsRequest |
| 1 | `SessionEventIdRules<T>` | MMCA.ADC.Conference.Application | 1 | RequiredIdRules<T, TId> |
| 1 | `SessionizeCategory` | MMCA.ADC.Conference.Application | 1 | SessionizeCategoryItem |
| 1 | `SessionizeSession` | MMCA.ADC.Conference.Application | 1 | SessionizeQuestionAnswer |
| 1 | `SessionizeSpeaker` | MMCA.ADC.Conference.Application | 2 | SessionizeLink, SessionizeQuestionAnswer |
| 1 | `SessionScoringInput` | MMCA.ADC.Conference.Application | 1 | SpeakerInfo |
| 1 | `SessionUpdateRequest` | MMCA.ADC.Conference.Application | 1 | ISessionFieldsRequest |
| 1 | `SpeakerUpdateRequest` | MMCA.ADC.Conference.Application | 1 | ISpeakerFieldsRequest |
| 1 | `SponsorEventIdRules<T>` | MMCA.ADC.Conference.Application | 1 | RequiredIdRules<T, TId> |
| 1 | `SponsorSortRules<T>` | MMCA.ADC.Conference.Application | 1 | NonNegativeIntRules<T> |
| 1 | `SponsorTierRules<T>` | MMCA.ADC.Conference.Application | 1 | SponsorTier |
| 1 | `UploadSessionAssetCommand` | MMCA.ADC.Conference.Application | 2 | IHasTimeout, ISessionAssetFieldsRequest |
| 1 | `GetNowNextQueryCacheTests` | MMCA.ADC.Conference.Application.Tests | 2 | GetNowNextQuery, IQueryCacheable |
| 1 | `SessionSimilarityCalculatorTests` | MMCA.ADC.Conference.Application.Tests | 1 | SessionSimilarityCalculator |
| 1 | `OutputCacheSessionScoresCacheEvictor` | MMCA.ADC.Conference.Infrastructure | 1 | ISessionScoresCacheEvictor |
| 1 | `FakeBookmarkCountService` | MMCA.ADC.Conference.IntegrationTests | 1 | IBookmarkCountService |
| 1 | `ForwardingProxy` | MMCA.ADC.Conference.IntegrationTests | 1 | ResultInterceptor |
| 1 | `Rendezvous` | MMCA.ADC.Conference.IntegrationTests | 1 | Arrival |
| 1 | `GoldenInput` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 1 | GoldenSpeaker |
| 1 | `ActivityDTO` | MMCA.ADC.Conference.Shared | 2 | IBaseDTO<TIdentifierType>, IConcurrencyAware |
| 1 | `CategoryGroupDistribution` | MMCA.ADC.Conference.Shared | 1 | CategoryItemDistribution |
| 1 | `CategoryItemDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ConferenceFeatures` | MMCA.ADC.Conference.Shared | 1 | FeatureFlagLifetime |
| 1 | `ConferenceReadAudience` | MMCA.ADC.Conference.Shared | 1 | RoleNames |
| 1 | `ContentSimilarityDTO` | MMCA.ADC.Conference.Shared | 1 | SimilarSessionPair |
| 1 | `EventQuestionAnswerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `EventSpeakerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `MultiSessionSpeaker` | MMCA.ADC.Conference.Shared | 1 | SpeakerSessionSummary |
| 1 | `NowNextDTO` | MMCA.ADC.Conference.Shared | 1 | NowNextSessionDTO |
| 1 | `PartnerDTO` | MMCA.ADC.Conference.Shared | 3 | IBaseDTO<TIdentifierType>, IConcurrencyAware, PartnerType |
| 1 | `QuestionDTO` | MMCA.ADC.Conference.Shared | 2 | IBaseDTO<TIdentifierType>, IConcurrencyAware |
| 1 | `RoomDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SessionAssetDTO` | MMCA.ADC.Conference.Shared | 3 | IBaseDTO<TIdentifierType>, IConcurrencyAware, SessionAssetKind |
| 1 | `SessionCategoryItemDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SessionFeedbackDTO` | MMCA.ADC.Conference.Shared | 2 | RatingQuestionSummary, TextQuestionResponses |
| 1 | `SessionLiveInfo` | MMCA.ADC.Conference.Shared | 1 | QuestionModerationDefault |
| 1 | `SessionQuestionAnswerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SessionSpeakerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SpeakerCategoryItemDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SpeakerQuestionAnswerDTO` | MMCA.ADC.Conference.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `SponsorDTO` | MMCA.ADC.Conference.Shared | 3 | IBaseDTO<TIdentifierType>, IConcurrencyAware, SponsorTier |
| 1 | `SessionizeCodeFormatTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SessionizeCodeFormat |
| 1 | `ADCHomeContent` | MMCA.ADC.Conference.UI | 3 | ConferenceTrackInfo, KeynoteSpeakerInfo, PreConferenceWorkshopInfo |
| 1 | `ScorePollTracker` | MMCA.ADC.Conference.UI | 2 | ScorePollSignal, SessionAiScoreDTO |
| 1 | `SessionizeCodeAttribute` | MMCA.ADC.Conference.UI | 1 | SessionizeCodeFormat |
| 1 | `SessionSelectionDisplay` | MMCA.ADC.Conference.UI | 1 | SessionStatuses |
| 1 | `SpeakerDetailLookups` | MMCA.ADC.Conference.UI | 1 | CategoryItemInfo |
| 1 | `ChildEntityDeletePathTests` | MMCA.ADC.Conference.UI.Tests | 1 | ChildEntityDeletePath |
| 1 | `FixedOriginLinkBuilder` | MMCA.ADC.Conference.UI.Tests | 1 | IPublicLinkBuilder |
| 1 | `GatedCacheStore` | MMCA.ADC.Conference.UI.Tests | 1 | ILocalCacheStore |
| 1 | `InMemoryCacheStore` | MMCA.ADC.Conference.UI.Tests | 1 | ILocalCacheStore |
| 1 | `RecordingCacheStore` | MMCA.ADC.Conference.UI.Tests | 1 | ILocalCacheStore |
| 1 | `VenueMapLinksTests` | MMCA.ADC.Conference.UI.Tests | 1 | VenueMapLinks |
| 1 | `FakeCrossServiceAttendeeQueryService` | MMCA.ADC.CrossService.IntegrationTests | 1 | IAttendeeQueryService |
| 1 | `TestSetup` | MMCA.ADC.E2E.Tests | 1 | E2ETestConfiguration |
| 1 | `EngagementErrorResourcesTests` | MMCA.ADC.Engagement.API.Tests | 2 | EngagementErrorResources, IErrorLocalizer |
| 1 | `EngagementPermissionGrantsTests` | MMCA.ADC.Engagement.API.Tests | 3 | EngagementPermissions, IPermissionRegistry, RoleNames |
| 1 | `OwnerOrAdminFilterVocabularyTests` | MMCA.ADC.Engagement.API.Tests | 3 | AuthClaimTypes, OwnerOrAdminFilterOptions, RoleNames |
| 1 | `CastVoteCommandValidator` | MMCA.ADC.Engagement.Application | 1 | CastVoteCommand |
| 1 | `CreateBookmarkRequestValidator` | MMCA.ADC.Engagement.Application | 1 | CreateBookmarkRequest |
| 1 | `CreateLivePollCommand` | MMCA.ADC.Engagement.Application | 1 | CreateLivePollRequest |
| 1 | `ILiveChannelPublishQueue` | MMCA.ADC.Engagement.Application | 1 | LiveChannelPublishWorkItem |
| 1 | `ModerateQuestionCommand` | MMCA.ADC.Engagement.Application | 1 | ModerationAction |
| 1 | `OverviewRow` | MMCA.ADC.Engagement.Application | 1 | PointsActivityType |
| 1 | `RoomCheckInRequestValidator` | MMCA.ADC.Engagement.Application | 1 | RoomCheckInRequest |
| 1 | `SponsorVisitRequestValidator` | MMCA.ADC.Engagement.Application | 1 | SponsorVisitRequest |
| 1 | `ToggleUpvoteCommandValidator` | MMCA.ADC.Engagement.Application | 1 | ToggleUpvoteCommand |
| 1 | `AwardCall` | MMCA.ADC.Engagement.Application.Tests | 1 | PointsActivityType |
| 1 | `GatedFirstCallPublisher` | MMCA.ADC.Engagement.Infrastructure.Tests | 2 | ILiveChannelPublisher, LiveChannelPublishWorkItem |
| 1 | `HangingPublisher` | MMCA.ADC.Engagement.Infrastructure.Tests | 1 | ILiveChannelPublisher |
| 1 | `RecordingPublisher` | MMCA.ADC.Engagement.Infrastructure.Tests | 2 | ILiveChannelPublisher, LiveChannelPublishWorkItem |
| 1 | `AttendanceStatsDTO` | MMCA.ADC.Engagement.Shared | 1 | SessionAttendanceDTO |
| 1 | `CheckInAttendeeRequest` | MMCA.ADC.Engagement.Shared | 1 | CheckInScope |
| 1 | `CheckInDTO` | MMCA.ADC.Engagement.Shared | 2 | CheckInScope, IBaseDTO<TIdentifierType> |
| 1 | `DisabledBookmarkCountService` | MMCA.ADC.Engagement.Shared | 1 | IBookmarkCountService |
| 1 | `EngagementFeatures` | MMCA.ADC.Engagement.Shared | 1 | FeatureFlagLifetime |
| 1 | `LivePollChannel` | MMCA.ADC.Engagement.Shared | 1 | NotificationScopeKey |
| 1 | `LivePollDTO` | MMCA.ADC.Engagement.Shared | 4 | IBaseDTO<TIdentifierType>, IConcurrencyAware, LivePollOptionDTO, LivePollStatus |
| 1 | `LivePollResultsDTO` | MMCA.ADC.Engagement.Shared | 2 | LivePollOptionResultDTO, LivePollStatus |
| 1 | `ManualCheckInRequest` | MMCA.ADC.Engagement.Shared | 1 | CheckInScope |
| 1 | `PointsActivityTotalDTO` | MMCA.ADC.Engagement.Shared | 1 | PointsActivityType |
| 1 | `PointsEntryDTO` | MMCA.ADC.Engagement.Shared | 1 | PointsActivityType |
| 1 | `PointsSubjectKeys` | MMCA.ADC.Engagement.Shared | 1 | NotificationScopeKey |
| 1 | `SessionQuestionDTO` | MMCA.ADC.Engagement.Shared | 3 | IBaseDTO<TIdentifierType>, IConcurrencyAware, QuestionStatus |
| 1 | `UserEngagementCheckInExportDTO` | MMCA.ADC.Engagement.Shared | 1 | CheckInScope |
| 1 | `UserEngagementPointsEntryExportDTO` | MMCA.ADC.Engagement.Shared | 1 | PointsActivityType |
| 1 | `UserSessionBookmarkDTO` | MMCA.ADC.Engagement.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `BadgePayloadTests` | MMCA.ADC.Engagement.Shared.Tests | 1 | BadgePayload |
| 1 | `CheckInSettingsTests` | MMCA.ADC.Engagement.Shared.Tests | 1 | CheckInSettings |
| 1 | `ILiveEventUIService` | MMCA.ADC.Engagement.UI | 1 | LiveEventContext |
| 1 | `NowNextSnapshot` | MMCA.ADC.Engagement.UI | 1 | NowNextSessionInfo |
| 1 | `ScanOutcome` | MMCA.ADC.Engagement.UI | 1 | ScanOutcomeKind |
| 1 | `SessionLiveUIService` | MMCA.ADC.Engagement.UI | 2 | EngagementRoutePaths, ISessionLiveUIService |
| 1 | `SessionReminderPlanner` | MMCA.ADC.Engagement.UI | 3 | EngagementRoutePaths, SessionInfo, SessionReminder |
| 1 | `HttpContextExternalLoginEmailVerifier` | MMCA.ADC.Identity.API | 2 | ExternalAuthExtensions, IExternalLoginEmailVerifier |
| 1 | `IdentityErrorResourcesTests` | MMCA.ADC.Identity.API.Tests | 2 | IdentityErrorResources, IErrorLocalizer |
| 1 | `ConfirmEmailCommand` | MMCA.ADC.Identity.Application | 2 | ConfirmEmailRequest, ICommandWithRequest<out TRequest> |
| 1 | `ForgotPasswordCommand` | MMCA.ADC.Identity.Application | 2 | ForgotPasswordRequest, ICommandWithRequest<out TRequest> |
| 1 | `SetUserAvatarCommand` | MMCA.ADC.Identity.Application | 1 | IHasTimeout |
| 1 | `SyntheticAccountsTests` | MMCA.ADC.Identity.Domain.Tests | 1 | SyntheticAccounts |
| 1 | `PiiCaptureLogger` | MMCA.ADC.Identity.IntegrationTests | 1 | PiiLogCapture |
| 1 | `DisabledAttendeeQueryService` | MMCA.ADC.Identity.Shared | 1 | IAttendeeQueryService |
| 1 | `IdentityPermissions` | MMCA.ADC.Identity.Shared | 1 | AdministrationPermissions |
| 1 | `UserDataExportEngagementSectionDTO` | MMCA.ADC.Identity.Shared | 6 | UserDataExportBookmarkDTO, UserDataExportCheckInDTO, UserDataExportPointsEntryDTO, UserDataExportPollVoteDTO, UserDataExportQuestionUpvoteDTO, UserDataExportSubmittedQuestionDTO |
| 1 | `UserDataExportNotificationSectionDTO` | MMCA.ADC.Identity.Shared | 1 | UserDataExportNotificationDTO |
| 1 | `UserDTO` | MMCA.ADC.Identity.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `UserListDTO` | MMCA.ADC.Identity.Shared | 1 | IUserAdminDTO |
| 1 | `AttendeeNotificationRecipientProvider` | MMCA.ADC.Notification.Application | 2 | IAttendeeQueryService, INotificationRecipientProvider |
| 1 | `LiveChannelPublisherGrpcAdapter` | MMCA.ADC.Notification.Contracts | 1 | ILiveChannelPublisher |
| 1 | `FakeAttendeeQueryService` | MMCA.ADC.Notification.IntegrationTests | 1 | IAttendeeQueryService |
| 1 | `LiveChannelGrpcService` | MMCA.ADC.Notification.Service | 1 | ILiveChannelPublisher |
| 1 | `IUserNotificationExportService` | MMCA.ADC.Notification.Shared | 1 | UserNotificationExportItemDTO |
| 1 | `TokenPermissionGrantsTests` | MMCA.ADC.Services.Tests | 6 | AdministrationPermissions, ConferencePermissions, EngagementPermissions, IPermissionRegistry, NotificationPermissions, RoleNames |
| 1 | `NowNextSnapshot` | MMCA.ADC.UI | 1 | NowNextSession |
| 1 | `ADCHomePageContent` | MMCA.ADC.UI.Web.Client | 1 | IHomePageContent |
| 1 | `ChatGuardrailException` | MMCA.Common.AI | 1 | GuardrailVerdict |
| 1 | `IAiProviderFactory` | MMCA.Common.AI | 1 | AiSettings |
| 1 | `IChatGuardrail` | MMCA.Common.AI | 1 | GuardrailVerdict |
| 1 | `IChatToolPolicy` | MMCA.Common.AI | 1 | ToolAuthorization |
| 1 | `UsageRecordingChatClient` | MMCA.Common.AI | 2 | AiUsageMeter, PromptContract |
| 1 | `GoldenReplayTestsBase` | MMCA.Common.AI.Testing | 3 | GoldenReplayCase, RecordedResponses, ReplayChatClient |
| 1 | `PromptContractPinTestsBase` | MMCA.Common.AI.Testing | 1 | PromptContract |
| 1 | `AiSettingsTests` | MMCA.Common.AI.Tests | 1 | AiSettings |
| 1 | `FixedTokenEstimator` | MMCA.Common.AI.Tests | 1 | IAiTokenEstimator |
| 1 | `PromptContractTests` | MMCA.Common.AI.Tests | 1 | PromptContract |
| 1 | `ReferencePrompts` | MMCA.Common.AI.Tests | 1 | PromptContract |
| 1 | `StubTool` | MMCA.Common.AI.Tests | 1 | ChatToolPolicy |
| 1 | `SuffixRedactor` | MMCA.Common.AI.Tests | 1 | IChatRequestRedactor |
| 1 | `UppercaseRedactor` | MMCA.Common.AI.Tests | 1 | IChatRequestRedactor |
| 1 | `UsageRecorder` | MMCA.Common.AI.Tests | 3 | AiUsageMeter, DurationMeasurement, Measurement |
| 1 | `AppAssociationEndpointExtensions` | MMCA.Common.API | 1 | AppAssociationOptions |
| 1 | `CommonForwardedHeadersExtensions` | MMCA.Common.API | 1 | CommonForwardedHeaders |
| 1 | `DomainExceptionHandler` | MMCA.Common.API | 1 | DomainException |
| 1 | `ErrorLocalizer` | MMCA.Common.API | 2 | ErrorResourceSource, IErrorLocalizer |
| 1 | `FallbackAuthorizationHandler` | MMCA.Common.API | 2 | FallbackAuthorizationOptions, FallbackAuthorizationRequirement |
| 1 | `GlobalExceptionHandler` | MMCA.Common.API | 1 | CrossTenantWriteException |
| 1 | `HasPermissionAttribute` | MMCA.Common.API | 1 | PermissionPolicy |
| 1 | `JwksEndpointExtensions` | MMCA.Common.API | 1 | IJwksProvider |
| 1 | `MiniProfilerExtensions` | MMCA.Common.API | 1 | ApplicationSettings |
| 1 | `PermissionAuthorizationHandler` | MMCA.Common.API | 2 | IPermissionRegistry, PermissionRequirement |
| 1 | `PermissionPolicyProvider` | MMCA.Common.API | 2 | PermissionPolicy, PermissionRequirement |
| 1 | `PublicEndpointOutputCachePolicy` | MMCA.Common.API | 1 | ITenantContext |
| 1 | `RateLimitingSettings` | MMCA.Common.API | 1 | RateLimitAlgorithm |
| 1 | `RedisFixedWindowRateLimiter` | MMCA.Common.API | 1 | RedisRateLimitLease |
| 1 | `ServiceInfoControllerBase` | MMCA.Common.API | 2 | ServiceInfoResponse, ServiceInfoV2Response |
| 1 | `ApiVersionProbeController` | MMCA.Common.API.Tests | 2 | ProbeInvocationCounter, Route |
| 1 | `ApiVersionProtectedProbeController` | MMCA.Common.API.Tests | 1 | Route |
| 1 | `ApiVersionUndecoratedProbeController` | MMCA.Common.API.Tests | 1 | Route |
| 1 | `CommonForwardedHeadersTests` | MMCA.Common.API.Tests | 1 | CommonForwardedHeaders |
| 1 | `DisabledFeatureHandlerTests` | MMCA.Common.API.Tests | 1 | DisabledFeatureHandler |
| 1 | `ErrorLocalizerTests` | MMCA.Common.API.Tests | 1 | IErrorLocalizer |
| 1 | `ExportTestDTO` | MMCA.Common.API.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ExternalAuthExtensionsTests` | MMCA.Common.API.Tests | 1 | ExternalAuthExtensions |
| 1 | `HostRegistrationProbeController` | MMCA.Common.API.Tests | 1 | Route |
| 1 | `IdempotencySettingsTests` | MMCA.Common.API.Tests | 1 | IdempotencySettings |
| 1 | `JwtAudienceTests` | MMCA.Common.API.Tests | 1 | JwtAudience |
| 1 | `JwtAuthorityExtensionsTests` | MMCA.Common.API.Tests | 1 | JwtAuthorityExtensions |
| 1 | `OpenApiProbeHost` | MMCA.Common.API.Tests | 1 | ProbeControllerFeatureProvider |
| 1 | `OperationCanceledExceptionHandlerTests` | MMCA.Common.API.Tests | 1 | OperationCanceledExceptionHandler |
| 1 | `PlainDTO` | MMCA.Common.API.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ProblemDetailsProbeController` | MMCA.Common.API.Tests | 1 | Route |
| 1 | `QueryFilterModelBinderTests` | MMCA.Common.API.Tests | 1 | QueryFilterModelBinder |
| 1 | `ReadScopeDTO` | MMCA.Common.API.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `RecordingLogger` | MMCA.Common.API.Tests | 1 | LogEntry |
| 1 | `SegmentVersionedProbeController` | MMCA.Common.API.Tests | 1 | Route |
| 1 | `SessionClaimsTokenTests` | MMCA.Common.API.Tests | 1 | SessionClaimsToken |
| 1 | `StubErrorLocalizer` | MMCA.Common.API.Tests | 1 | IErrorLocalizer |
| 1 | `StubTenantContext` | MMCA.Common.API.Tests | 1 | ITenantContext |
| 1 | `TestAggDTO` | MMCA.Common.API.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `TestConfirmEmailCommand` | MMCA.Common.API.Tests | 2 | ConfirmEmailRequest, ICommandWithRequest<out TRequest> |
| 1 | `TestCreateRequest` | MMCA.Common.API.Tests | 1 | ICreateRequest |
| 1 | `TestCrudDTO` | MMCA.Common.API.Tests | 2 | IBaseDTO<TIdentifierType>, IConcurrencyAware |
| 1 | `TestDomainException` | MMCA.Common.API.Tests | 1 | DomainException |
| 1 | `TestDTO` | MMCA.Common.API.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `TestForgotPasswordCommand` | MMCA.Common.API.Tests | 2 | ForgotPasswordRequest, ICommandWithRequest<out TRequest> |
| 1 | `TestResetPasswordCommand` | MMCA.Common.API.Tests | 2 | ICommandWithRequest<out TRequest>, ResetPasswordRequest |
| 1 | `TestSendEmailConfirmationCommand` | MMCA.Common.API.Tests | 2 | ICommandWithRequest<out TRequest>, SendEmailConfirmationRequest |
| 1 | `UnboundRouteTokenProbeController` | MMCA.Common.API.Tests | 1 | Route |
| 1 | `VersionedDTO` | MMCA.Common.API.Tests | 2 | IBaseDTO<TIdentifierType>, IConcurrencyAware |
| 1 | `WrappedAsStringConverter` | MMCA.Common.API.Tests | 1 | Wrapped |
| 1 | `BestEffort` | MMCA.Common.Application | 2 | BestEffortLog, BestEffortMetrics |
| 1 | `BoolFilterStrategy` | MMCA.Common.Application | 3 | DynamicQueryConfig, FilterValueParser, IFilterStrategy |
| 1 | `CommandRequestValidator<TCommand, TRequest>` | MMCA.Common.Application | 1 | ICommandWithRequest<out TRequest> |
| 1 | `ConfirmEmailRequestValidator` | MMCA.Common.Application | 1 | ConfirmEmailRequest |
| 1 | `CqrsContractMismatch` | MMCA.Common.Application | 1 | CqrsContractMismatchKind |
| 1 | `DataSourceKey` | MMCA.Common.Application | 1 | DataSource |
| 1 | `DateTimeFilterStrategy` | MMCA.Common.Application | 3 | DynamicQueryConfig, FilterValueParser, IFilterStrategy |
| 1 | `DecimalFilterStrategy` | MMCA.Common.Application | 3 | DynamicQueryConfig, FilterValueParser, IFilterStrategy |
| 1 | `DeleteEntityCommand<TEntity, TIdentifierType>` | MMCA.Common.Application | 1 | ICacheInvalidating |
| 1 | `DocumentContentSniffer` | MMCA.Common.Application | 1 | DocumentFormats |
| 1 | `EntityQueryParameters<TEntity>` | MMCA.Common.Application | 1 | QueryFieldContract |
| 1 | `ForgotPasswordRequestValidator` | MMCA.Common.Application | 1 | ForgotPasswordRequest |
| 1 | `GetUserPreferencesQuery` | MMCA.Common.Application | 1 | IUserScopedRequest |
| 1 | `GuidFilterStrategy` | MMCA.Common.Application | 3 | DynamicQueryConfig, FilterValueParser, IFilterStrategy |
| 1 | `IAuditTrailReader` | MMCA.Common.Application | 1 | AuditTrailEntryDTO |
| 1 | `IDomainEventDispatcher` | MMCA.Common.Application | 1 | IDomainEvent |
| 1 | `IDomainEventHandler<in TDomainEvent>` | MMCA.Common.Application | 1 | IDomainEvent |
| 1 | `IModule` | MMCA.Common.Application | 1 | ApplicationSettings |
| 1 | `IntFilterStrategy` | MMCA.Common.Application | 3 | DynamicQueryConfig, FilterValueParser, IFilterStrategy |
| 1 | `ITwoFactorService` | MMCA.Common.Application | 1 | RecoveryCodeSet |
| 1 | `IUserOwnedRequest` | MMCA.Common.Application | 1 | IUserScopedRequest |
| 1 | `IUserScopedCommand<out TRequest>` | MMCA.Common.Application | 1 | IUserScopedRequest |
| 1 | `LayeredPermissionRegistry` | MMCA.Common.Application | 2 | IPermissionGrantCache, IPermissionRegistry |
| 1 | `LoginRequestValidator` | MMCA.Common.Application | 1 | LoginRequest |
| 1 | `LongFilterStrategy` | MMCA.Common.Application | 3 | DynamicQueryConfig, FilterValueParser, IFilterStrategy |
| 1 | `ModulesSettings` | MMCA.Common.Application | 1 | ModuleSettings |
| 1 | `NavigationPropertyInfo` | MMCA.Common.Application | 1 | NavigationType |
| 1 | `NullNotificationRecipientProvider` | MMCA.Common.Application | 1 | INotificationRecipientProvider |
| 1 | `ProfilingCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 1 | ICommandHandler<in TCommand, TResult> |
| 1 | `ProfilingQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 1 | IQueryHandler<in TQuery, TResult> |
| 1 | `QueryTagScope` | MMCA.Common.Application | 1 | AmbientScope |
| 1 | `RefreshTokenRequestValidator` | MMCA.Common.Application | 1 | RefreshTokenRequest |
| 1 | `SendEmailConfirmationRequestValidator` | MMCA.Common.Application | 1 | SendEmailConfirmationRequest |
| 1 | `SendPushNotificationCommand` | MMCA.Common.Application | 3 | ICommandWithRequest<out TRequest>, ITransactional, SendPushNotificationRequest |
| 1 | `SessionStampingTokenService` | MMCA.Common.Application | 2 | AuthClaimTypes, ITokenService |
| 1 | `StringFilterStrategy` | MMCA.Common.Application | 3 | DynamicQueryConfig, FilterValueParser, IFilterStrategy |
| 1 | `StrongPasswordRules<T>` | MMCA.Common.Application | 1 | PasswordComplexity |
| 1 | `TenantCacheKey` | MMCA.Common.Application | 1 | ITenantContext |
| 1 | `TwoFactorCodeRequestValidator` | MMCA.Common.Application | 1 | TwoFactorCodeRequest |
| 1 | `UnconfiguredPermissionRegistry` | MMCA.Common.Application | 2 | IPermissionCatalog, IPermissionRegistry |
| 1 | `UserCacheKey` | MMCA.Common.Application | 1 | IUserScopedRequest |
| 1 | `UserDataExportSectionResult` | MMCA.Common.Application | 1 | UserDataExportSectionDefaults |
| 1 | `AccountDTO` | MMCA.Common.Application.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ApplicationSettingsTests` | MMCA.Common.Application.Tests | 1 | ApplicationSettings |
| 1 | `BlobNamesTests` | MMCA.Common.Application.Tests | 1 | BlobNames |
| 1 | `BudgetedCommand` | MMCA.Common.Application.Tests | 1 | IHasTimeout |
| 1 | `BudgetedQuery` | MMCA.Common.Application.Tests | 1 | IHasTimeout |
| 1 | `CacheableTestQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `CacheDoubleCheckMetricQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `CacheHitMetricQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `CacheInvalidatingTestCommand` | MMCA.Common.Application.Tests | 1 | ICacheInvalidating |
| 1 | `CacheMissMetricQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `CachePipelineTestCommand` | MMCA.Common.Application.Tests | 1 | ICacheInvalidating |
| 1 | `CacheReadCanceledQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `CacheReadFailureMetricQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `CacheReadFailureQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `CtorProbeCommand` | MMCA.Common.Application.Tests | 1 | ICacheInvalidating |
| 1 | `CtorProbeQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `FakeEntityDTO` | MMCA.Common.Application.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `FakeGrantCache` | MMCA.Common.Application.Tests | 1 | IPermissionGrantCache |
| 1 | `FakeModuleAlphaSeeder` | MMCA.Common.Application.Tests | 2 | FakeModuleTracker, IModuleSeeder |
| 1 | `FakeRemoteContractRealAdapter` | MMCA.Common.Application.Tests | 1 | IFakeRemoteContract |
| 1 | `FakeRemoteContractStub` | MMCA.Common.Application.Tests | 1 | IFakeRemoteContract |
| 1 | `FeatureGatedCommand` | MMCA.Common.Application.Tests | 1 | IFeatureGated |
| 1 | `FeatureGatedCommandWithValue` | MMCA.Common.Application.Tests | 1 | IFeatureGated |
| 1 | `FeatureGatedQuery` | MMCA.Common.Application.Tests | 1 | IFeatureGated |
| 1 | `FeatureGatedQueryNonGeneric` | MMCA.Common.Application.Tests | 1 | IFeatureGated |
| 1 | `FileUploadOptionsTests` | MMCA.Common.Application.Tests | 1 | FileUploadOptions |
| 1 | `FullPipelineTestCommand` | MMCA.Common.Application.Tests | 2 | ICacheInvalidating, ITransactional |
| 1 | `GuardedCommand` | MMCA.Common.Application.Tests | 1 | IRequiresPermission |
| 1 | `GuardedCommandWithValue` | MMCA.Common.Application.Tests | 1 | IRequiresPermission |
| 1 | `GuardedQuery` | MMCA.Common.Application.Tests | 1 | IRequiresPermission |
| 1 | `ImageContentSnifferTests` | MMCA.Common.Application.Tests | 1 | ImageContentSniffer |
| 1 | `MutationContextTests` | MMCA.Common.Application.Tests | 1 | MutationContext |
| 1 | `MyOrdersQuery` | MMCA.Common.Application.Tests | 2 | IQueryCacheable, IUserScopedRequest |
| 1 | `OptedOutCacheInvalidatingTestCommand` | MMCA.Common.Application.Tests | 1 | ICacheInvalidating |
| 1 | `OrderCreateRequest` | MMCA.Common.Application.Tests | 1 | ICreateRequest |
| 1 | `OrderDTO` | MMCA.Common.Application.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `OrderLineDTO` | MMCA.Common.Application.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `PagingMathTests` | MMCA.Common.Application.Tests | 1 | PagingMath |
| 1 | `PermissiveTestRequestValidator` | MMCA.Common.Application.Tests | 1 | TestRequest |
| 1 | `PopulateLockTimeoutQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `Product` | MMCA.Common.Application.Tests | 1 | Category |
| 1 | `ProjectedEntityDTO` | MMCA.Common.Application.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `PublicCardQuery` | MMCA.Common.Application.Tests | 3 | IQueryCacheable, ISharedQueryCache, IUserScopedRequest |
| 1 | `ResolvedEntityDTO` | MMCA.Common.Application.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ScopeCapturingLogger<TCategoryName>` | MMCA.Common.Application.Tests | 1 | LogEntry |
| 1 | `SecondTestRequestValidator` | MMCA.Common.Application.Tests | 1 | TestRequest |
| 1 | `StampedeTestQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `StepUpCommand` | MMCA.Common.Application.Tests | 2 | IRequiresMfa, IRequiresPermission |
| 1 | `StepUpQuery` | MMCA.Common.Application.Tests | 1 | IRequiresMfa |
| 1 | `StoredState` | MMCA.Common.Application.Tests | 1 | ITwoFactorUserState |
| 1 | `TestCommandWithRequest` | MMCA.Common.Application.Tests | 2 | ICommandWithRequest<out TRequest>, TestRequest |
| 1 | `TestConfirmEmailCommand` | MMCA.Common.Application.Tests | 2 | ConfirmEmailRequest, ICommandWithRequest<out TRequest> |
| 1 | `TestForgotPasswordCommand` | MMCA.Common.Application.Tests | 2 | ForgotPasswordRequest, ICommandWithRequest<out TRequest> |
| 1 | `TestRequestValidator` | MMCA.Common.Application.Tests | 1 | TestRequest |
| 1 | `TestResetPasswordCommand` | MMCA.Common.Application.Tests | 2 | ICommandWithRequest<out TRequest>, ResetPasswordRequest |
| 1 | `TestSendConfirmationCommand` | MMCA.Common.Application.Tests | 2 | ICommandWithRequest<out TRequest>, SendEmailConfirmationRequest |
| 1 | `TestStrategy` | MMCA.Common.Application.Tests | 1 | IFilterStrategy |
| 1 | `TransactionalCommand` | MMCA.Common.Application.Tests | 1 | ITransactional |
| 1 | `TransactionalPipelineTestCommand` | MMCA.Common.Application.Tests | 1 | ITransactional |
| 1 | `UnscopedQuery` | MMCA.Common.Application.Tests | 1 | IQueryCacheable |
| 1 | `ValidationFailureExtensionsTests` | MMCA.Common.Application.Tests | 1 | ErrorType |
| 1 | `CreateTicketCommandValidator` | MMCA.Common.Architecture.Tests | 1 | CreateTicketCommand |
| 1 | `CustomExceptionThrowingFixture` | MMCA.Common.Architecture.Tests | 1 | TicketDomainException |
| 1 | `DisabledFakeExportService` | MMCA.Common.Architecture.Tests | 1 | IFakeExportService |
| 1 | `EditorRequiredParameterConventionTests` | MMCA.Common.Architecture.Tests | 1 | UISharedAssemblyReference |
| 1 | `FixtureBadFeatures` | MMCA.Common.Architecture.Tests | 1 | FeatureFlagLifetime |
| 1 | `FixtureDomainEvent` | MMCA.Common.Architecture.Tests | 1 | IDomainEvent |
| 1 | `FixtureExpiredFeatures` | MMCA.Common.Architecture.Tests | 1 | FeatureFlagLifetime |
| 1 | `FixtureGoodFeatures` | MMCA.Common.Architecture.Tests | 1 | FeatureFlagLifetime |
| 1 | `HighFloorTemplate` | MMCA.Common.Architecture.Tests | 1 | CostTagConventionTestsBase |
| 1 | `InheritingFitnessController` | MMCA.Common.Architecture.Tests | 1 | AbstractFitnessControllerBase |
| 1 | `InheritingFixtureController` | MMCA.Common.Architecture.Tests | 1 | AbstractAnonymousFixtureControllerBase |
| 1 | `NoModuleAssemblies` | MMCA.Common.Architecture.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NoOutboxSignal` | MMCA.Common.Architecture.Tests | 1 | IOutboxSignal |
| 1 | `NoServices` | MMCA.Common.Architecture.Tests | 1 | MessageBusBackpressureTestsBase |
| 1 | `ObservabilityConventionTestsBaseTests` | MMCA.Common.Architecture.Tests | 1 | ObservabilityConventionTestsBase |
| 1 | `ReopenTicketCommand` | MMCA.Common.Architecture.Tests | 2 | ICommandWithRequest<out TRequest>, ReopenTicketRequest |
| 1 | `RightModel` | MMCA.Common.Architecture.Tests | 1 | LeftModelBase |
| 1 | `SampleDeploymentObservabilityTests` | MMCA.Common.Architecture.Tests | 1 | ObservabilityConventionTestsBase |
| 1 | `UntaggedTemplate` | MMCA.Common.Architecture.Tests | 1 | CostTagConventionTestsBase |
| 1 | `UpdateTicketCommand` | MMCA.Common.Architecture.Tests | 2 | ICommandWithRequest<out TRequest>, UpdateTicketRequest |
| 1 | `UpdateTicketRequestValidator` | MMCA.Common.Architecture.Tests | 1 | UpdateTicketRequest |
| 1 | `WrongPrefixTemplate` | MMCA.Common.Architecture.Tests | 1 | CostTagConventionTestsBase |
| 1 | `CachedHealthReportProvider` | MMCA.Common.Aspire | 2 | Entry, HealthReportCacheOptions |
| 1 | `DownstreamServiceHealthCheck` | MMCA.Common.Aspire | 2 | DownstreamProbeVersion, HealthEndpointPaths |
| 1 | `GatewayDownstreamHealthCheckOptions` | MMCA.Common.Aspire | 1 | DownstreamProbeVersion |
| 1 | `GatewayRateLimitingExtensions` | MMCA.Common.Aspire | 1 | GatewayRateLimitingSettings |
| 1 | `ICspPolicyProvider` | MMCA.Common.Aspire | 1 | CspPolicy |
| 1 | `KestrelEndpointExtensions` | MMCA.Common.Aspire | 1 | KestrelListenerSpec |
| 1 | `OpenIdConnectMetadataWarmupTask` | MMCA.Common.Aspire | 1 | IWarmupTask |
| 1 | `SelfHttpWarmupTaskBase` | MMCA.Common.Aspire | 1 | IWarmupTask |
| 1 | `WarmupHostedService` | MMCA.Common.Aspire | 2 | IWarmupTask, WarmupReadinessGate |
| 1 | `WarmupReadinessHealthCheck` | MMCA.Common.Aspire | 1 | WarmupReadinessGate |
| 1 | `Extensions` | MMCA.Common.Aspire.Hosting | 1 | ServiceBusEmulatorResource |
| 1 | `H2cEndpointHealthCheck` | MMCA.Common.Aspire.Hosting | 1 | H2cHealthCheckExtensions |
| 1 | `H2cHealthCheckExtensions` | MMCA.Common.Aspire.Hosting | 2 | H2cEndpointHealthCheck, H2cHealthCheckRegistry |
| 1 | `AttemptRecorder` | MMCA.Common.Aspire.Tests | 1 | ProbeAttempt |
| 1 | `GatewayCorsExtensionsTests` | MMCA.Common.Aspire.Tests | 1 | StubHostEnvironment |
| 1 | `HangingTask` | MMCA.Common.Aspire.Tests | 1 | IWarmupTask |
| 1 | `RecordingTask` | MMCA.Common.Aspire.Tests | 1 | IWarmupTask |
| 1 | `RedisPingHealthCheckTests` | MMCA.Common.Aspire.Tests | 2 | HealthCheckTags, RedisPingHealthCheck |
| 1 | `SourceCollectingHostApplicationBuilder` | MMCA.Common.Aspire.Tests | 4 | SourceCollectingConfigurationManager, StubHostEnvironment, StubLoggingBuilder, StubMetricsBuilder |
| 1 | `StubHandler` | MMCA.Common.Aspire.Tests | 1 | ProbeAttempt |
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
| 1 | `PiiOverride` | MMCA.Common.Domain.Tests | 1 | PiiBase |
| 1 | `GatewayHealthCheckDefaults` | MMCA.Common.Gateway | 2 | GatewayActiveHealthCheckDefaults, GatewayPassiveHealthCheckDefaults |
| 1 | `GatewayRoutePolicySettings` | MMCA.Common.Gateway | 1 | GatewayRoutePolicyPartition |
| 1 | `ForwardedHeadersExtensionsTests` | MMCA.Common.Gateway.Tests | 1 | ForwardedHeadersExtensions |
| 1 | `FakeStreamReader` | MMCA.Common.Grpc.Tests | 1 | FakeResponse |
| 1 | `FakeStreamWriter` | MMCA.Common.Grpc.Tests | 1 | FakeRequest |
| 1 | `GrpcWireFormatTests` | MMCA.Common.Grpc.Tests | 1 | GrpcWireFormat |
| 1 | `ResilienceCircuitBreakerFaultInjectionTests` | MMCA.Common.Grpc.Tests | 1 | CountingFailureHandler |
| 1 | `AuditTrailSettings` | MMCA.Common.Infrastructure | 1 | DataSource |
| 1 | `AzureNotificationHubNativePushSender` | MMCA.Common.Infrastructure | 2 | INativePushSender, NativePushPayloads |
| 1 | `CacheKeyNamespace` | MMCA.Common.Infrastructure | 1 | CacheKeyPrefixOptions |
| 1 | `CacheSettings` | MMCA.Common.Infrastructure | 1 | CacheOptions |
| 1 | `DataSourceEngineCapabilities` | MMCA.Common.Infrastructure | 2 | MigrationPolicy, RowVersionStrategy |
| 1 | `DataSourcesSettings` | MMCA.Common.Infrastructure | 1 | DataSourceEntrySettings |
| 1 | `DbSeeder` | MMCA.Common.Infrastructure | 1 | IDbSeeder |
| 1 | `DefaultEntityConfigurationAssemblyProvider` | MMCA.Common.Infrastructure | 2 | EntityConfigurationOptions, IEntityConfigurationAssemblyProvider |
| 1 | `DesignTimeDbContextOptions` | MMCA.Common.Infrastructure | 2 | ConnectionStringSettings, DataSourceEntrySettings |
| 1 | `EfCoreConcurrencyConflictDetector` | MMCA.Common.Infrastructure | 1 | IConcurrencyConflictDetector |
| 1 | `EFQueryableExecutor` | MMCA.Common.Infrastructure | 1 | IQueryableExecutor |
| 1 | `EnrolledCommandWake` | MMCA.Common.Infrastructure | 1 | IInternalCommandSignal |
| 1 | `EventNameResolver` | MMCA.Common.Infrastructure | 1 | EventNameAttribute |
| 1 | `ExplicitAssemblyProvider` | MMCA.Common.Infrastructure | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `IExplicitKeyInsertDialect` | MMCA.Common.Infrastructure | 1 | ExplicitKeyInsertGroup |
| 1 | `InProcessDistributedLock` | MMCA.Common.Infrastructure | 2 | IDistributedLock, InProcessLockHandle |
| 1 | `InternalCommandMetrics` | MMCA.Common.Infrastructure | 1 | Measurement |
| 1 | `InternalCommandNameResolver` | MMCA.Common.Infrastructure | 1 | InternalCommandNameAttribute |
| 1 | `InternalCommandSignal` | MMCA.Common.Infrastructure | 2 | IInternalCommandSignal, WakeUpSignal |
| 1 | `JwtSettings` | MMCA.Common.Infrastructure | 1 | JwtSigningAlgorithm |
| 1 | `MessageBusSettings` | MMCA.Common.Infrastructure | 1 | MessageBusProvider |
| 1 | `NamespaceConventions` | MMCA.Common.Infrastructure | 1 | ModuleNameConventions |
| 1 | `NoOpInboxStore` | MMCA.Common.Infrastructure | 1 | IInboxStore |
| 1 | `NullLiveChannelPublisher` | MMCA.Common.Infrastructure | 1 | ILiveChannelPublisher |
| 1 | `NullNativePushSender` | MMCA.Common.Infrastructure | 1 | INativePushSender |
| 1 | `NullPushNotificationSender` | MMCA.Common.Infrastructure | 1 | IPushNotificationSender |
| 1 | `OutboxMetrics` | MMCA.Common.Infrastructure | 1 | Measurement |
| 1 | `OutboxSignal` | MMCA.Common.Infrastructure | 2 | IOutboxSignal, WakeUpSignal |
| 1 | `PasswordHasher` | MMCA.Common.Infrastructure | 1 | IPasswordHasher |
| 1 | `PendingEntityKey` | MMCA.Common.Infrastructure | 1 | AuditTrailEntry |
| 1 | `PermissionGrantRefreshService` | MMCA.Common.Infrastructure | 3 | IPermissionGrantCache, PeriodicBackgroundService, PermissionGrantSettings |
| 1 | `PushNotificationSettings` | MMCA.Common.Infrastructure | 1 | NotificationScopeKey |
| 1 | `RsaJwksProvider` | MMCA.Common.Infrastructure | 2 | IJwksProvider, JwksSettings |
| 1 | `SchedulerSettings` | MMCA.Common.Infrastructure | 2 | DataSource, ScheduledJobOverrideSettings |
| 1 | `SensitiveDataLoggingGate` | MMCA.Common.Infrastructure | 1 | PersistenceSettings |
| 1 | `SmtpTransportSecurity` | MMCA.Common.Infrastructure | 1 | SmtpSettings |
| 1 | `SqlServerUniqueConstraintViolationDetector` | MMCA.Common.Infrastructure | 1 | IUniqueConstraintViolationDetector |
| 1 | `TenantEntrySettings` | MMCA.Common.Infrastructure | 1 | TenantDataSourceOverrideSettings |
| 1 | `UpdatePropertySetterBuilder<TEntity>` | MMCA.Common.Infrastructure | 1 | IUpdatePropertySetter<TEntity> |
| 1 | `UseDataSourceAttribute` | MMCA.Common.Infrastructure | 1 | DataSource |
| 1 | `NoTenantContext` | MMCA.Common.Infrastructure.SQLServer.Tests | 1 | ITenantContext |
| 1 | `AddLegalAcceptanceTests` | MMCA.Common.Infrastructure.Tests | 1 | LegalAcceptanceOptions |
| 1 | `AuditedThing` | MMCA.Common.Infrastructure.Tests | 2 | IAuditedEntity, ThingAddress |
| 1 | `AuditTrailTestHarness` | MMCA.Common.Infrastructure.Tests | 1 | FakeTimeProvider |
| 1 | `CacheOptionsTests` | MMCA.Common.Infrastructure.Tests | 1 | CacheOptions |
| 1 | `CatalogContext` | MMCA.Common.Infrastructure.Tests | 5 | Category, CategoryItem, CycleLeft, CycleRight, Tag |
| 1 | `CompositeKeyThing` | MMCA.Common.Infrastructure.Tests | 1 | IAuditedEntity |
| 1 | `ConnectionStringSettingsTests` | MMCA.Common.Infrastructure.Tests | 1 | ConnectionStringSettings |
| 1 | `CosmosIntIdValueGeneratorTests` | MMCA.Common.Infrastructure.Tests | 1 | CosmosIntIdValueGenerator |
| 1 | `CountingSweep` | MMCA.Common.Infrastructure.Tests | 2 | FakeTimeProvider, PeriodicBackgroundService |
| 1 | `CustomSchemaContext` | MMCA.Common.Infrastructure.Tests | 1 | SessionOnlyContextBase |
| 1 | `DatabaseRestoreDrillTests` | MMCA.Common.Infrastructure.Tests | 1 | DrillResult |
| 1 | `DelegateScheduledJob` | MMCA.Common.Infrastructure.Tests | 1 | IScheduledJob |
| 1 | `EmptyAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `EmptyAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `EncryptedStringConverterTests` | MMCA.Common.Infrastructure.Tests | 1 | EncryptedStringConverter |
| 1 | `EntityConfigurationOptionsTests` | MMCA.Common.Infrastructure.Tests | 1 | EntityConfigurationOptions |
| 1 | `EvictionSignalingMemoryCache` | MMCA.Common.Infrastructure.Tests | 2 | ManualClock, SignalingEntry |
| 1 | `FakeClockLoop` | MMCA.Common.Infrastructure.Tests | 1 | FakeTimeProvider |
| 1 | `FakeContract` | MMCA.Common.Infrastructure.Tests | 1 | IFakeContract |
| 1 | `FakeGrantCache` | MMCA.Common.Infrastructure.Tests | 1 | IPermissionGrantCache |
| 1 | `FirstJob` | MMCA.Common.Infrastructure.Tests | 1 | IScheduledJob |
| 1 | `GrantOnlyCustomSchemaContext` | MMCA.Common.Infrastructure.Tests | 1 | GrantOnlyContextBase |
| 1 | `GrantOnlyPostgreSqlContext` | MMCA.Common.Infrastructure.Tests | 1 | GrantOnlyContextBase |
| 1 | `GrantOnlySqlServerContext` | MMCA.Common.Infrastructure.Tests | 1 | GrantOnlyContextBase |
| 1 | `MultiSourceTestEvent` | MMCA.Common.Infrastructure.Tests | 1 | IDomainEvent |
| 1 | `MutableTenantContext` | MMCA.Common.Infrastructure.Tests | 1 | ITenantContext |
| 1 | `NativePushPayloadsTests` | MMCA.Common.Infrastructure.Tests | 1 | NativePushPayloads |
| 1 | `NoAssemblies` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NoAssemblies` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NoAssemblies` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NoConfigurationAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NoConfigurationAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NoModuleAssemblies` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NoModuleAssemblies` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `NullAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `OrderedTestEvent` | MMCA.Common.Infrastructure.Tests | 1 | IDomainEvent |
| 1 | `OrderPlacedConsumer` | MMCA.Common.Infrastructure.Tests | 1 | OrderPlacedTestEvent |
| 1 | `OverridingPiiThing` | MMCA.Common.Infrastructure.Tests | 2 | IAuditedEntity, PiiBaseThing |
| 1 | `PersistenceSettingsTests` | MMCA.Common.Infrastructure.Tests | 1 | PersistenceSettings |
| 1 | `ProfilingHelperTests` | MMCA.Common.Infrastructure.Tests | 1 | ProfilingHelper |
| 1 | `RecordingInboxStore` | MMCA.Common.Infrastructure.Tests | 1 | IInboxStore |
| 1 | `RecordingLogger` | MMCA.Common.Infrastructure.Tests | 1 | InboxDisabledWarningService |
| 1 | `RefreshSessionOnlyContext` | MMCA.Common.Infrastructure.Tests | 1 | SessionOnlyContextBase |
| 1 | `SchedulerMetricsTests` | MMCA.Common.Infrastructure.Tests | 1 | SchedulerMetrics |
| 1 | `SecondJob` | MMCA.Common.Infrastructure.Tests | 1 | IScheduledJob |
| 1 | `SmtpSettingsTests` | MMCA.Common.Infrastructure.Tests | 1 | SmtpSettings |
| 1 | `StampTestEvent` | MMCA.Common.Infrastructure.Tests | 1 | IDomainEvent |
| 1 | `State` | MMCA.Common.Infrastructure.Tests | 1 | ITwoFactorUserState |
| 1 | `StubChannelJoinAuthorizer` | MMCA.Common.Infrastructure.Tests | 1 | IChannelJoinAuthorizer |
| 1 | `TenantDetail` | MMCA.Common.Infrastructure.Tests | 1 | ITenantEntity |
| 1 | `TestDomainEvent` | MMCA.Common.Infrastructure.Tests | 1 | IDomainEvent |
| 1 | `LoadItemDTO` | MMCA.Common.LoadTests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `BaseLookup<TIdentifierType>` | MMCA.Common.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `ClaimsPrincipalExtensions` | MMCA.Common.Shared | 1 | AuthClaimTypes |
| 1 | `DomainInvariantViolationException` | MMCA.Common.Shared | 1 | DomainException |
| 1 | `Error` | MMCA.Common.Shared | 1 | ErrorType |
| 1 | `FeatureFlagAttribute` | MMCA.Common.Shared | 1 | FeatureFlagLifetime |
| 1 | `FeatureFlagDescriptor` | MMCA.Common.Shared | 1 | FeatureFlagLifetime |
| 1 | `GrpcResilienceDefaults` | MMCA.Common.Shared | 1 | HttpResilienceDefaults |
| 1 | `IcsCalendarBuilder` | MMCA.Common.Shared | 1 | IcsEvent |
| 1 | `KeyedSemaphoreStripe` | MMCA.Common.Shared | 1 | Releaser |
| 1 | `KeysetCollectionResult<T>` | MMCA.Common.Shared | 1 | CollectionResult<T> |
| 1 | `NotificationFeatures` | MMCA.Common.Shared | 1 | FeatureFlagLifetime |
| 1 | `PagedCollectionResult<T>` | MMCA.Common.Shared | 2 | CollectionResult<T>, PaginationMetadata |
| 1 | `PermissionRegistry` | MMCA.Common.Shared | 2 | IPermissionCatalog, IPermissionRegistry |
| 1 | `PrivacyFeatures` | MMCA.Common.Shared | 1 | FeatureFlagLifetime |
| 1 | `PushNotificationDTO` | MMCA.Common.Shared | 1 | IBaseDTO<TIdentifierType> |
| 1 | `StronglyTypedIdValueParser<TValue>` | MMCA.Common.Shared | 1 | StronglyTypedIdValueParserDelegate<TValue> |
| 1 | `UserDataExportDTO` | MMCA.Common.Shared | 1 | UserDataExportSectionDTO |
| 1 | `ConcreteDomainException` | MMCA.Common.Shared.Tests | 1 | DomainException |
| 1 | `ConcurrencyETagTests` | MMCA.Common.Shared.Tests | 1 | ConcurrencyETag |
| 1 | `LegalAcceptanceDTOTests` | MMCA.Common.Shared.Tests | 1 | LegalAcceptanceDTO |
| 1 | `ModuleNameConventionsTests` | MMCA.Common.Shared.Tests | 4 | ModuleNameConventions, SalesFakeAggregate, SalesFakeOrder, SalesFakeUseCase |
| 1 | `NotificationScopeKeyTests` | MMCA.Common.Shared.Tests | 1 | NotificationScopeKey |
| 1 | `PaginationMetadataTests` | MMCA.Common.Shared.Tests | 1 | PaginationMetadata |
| 1 | `PasswordComplexityTests` | MMCA.Common.Shared.Tests | 1 | PasswordComplexity |
| 1 | `SupportedCulturesTests` | MMCA.Common.Shared.Tests | 1 | SupportedCultures |
| 1 | `TestValueObject` | MMCA.Common.Shared.Tests | 1 | ValueObject |
| 1 | `CrossServiceFixtureBase` | MMCA.Common.Testing | 1 | CrossServiceDataSource |
| 1 | `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>` | MMCA.Common.Testing | 2 | ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult> |
| 1 | `GracefulShutdownTestsBase<TEntryPoint>` | MMCA.Common.Testing | 1 | ProductionHostApplicationFactory<TEntryPoint> |
| 1 | `HostScopedAssemblyProvider` | MMCA.Common.Testing | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `InMemoryQueryableExecutor` | MMCA.Common.Testing | 1 | IQueryableExecutor |
| 1 | `IntegrationTestBase<TFixture>` | MMCA.Common.Testing | 1 | IIntegrationTestFixture |
| 1 | `RecordingHttpForwarder` | MMCA.Common.Testing | 1 | Route |
| 1 | `LayerRef` | MMCA.Common.Testing.Architecture | 1 | Layer |
| 1 | `ProtoScope` | MMCA.Common.Testing.Architecture | 1 | ProtoScopeKind |
| 1 | `SpanishAccentTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureAssert |
| 1 | `AppHostEnvironmentGate` | MMCA.Common.Testing.Aspire | 3 | AppHostEnvironmentRequirement, DeveloperCertificateAvailability, DockerAvailability |
| 1 | `AppHostReadinessBudgetTests` | MMCA.Common.Testing.Aspire.Tests | 1 | AppHostReadinessBudget |
| 1 | `DeveloperCertificateAvailabilityTests` | MMCA.Common.Testing.Aspire.Tests | 1 | DeveloperCertificateAvailability |
| 1 | `DockerAvailabilityTests` | MMCA.Common.Testing.Aspire.Tests | 1 | DockerAvailability |
| 1 | `EphemeralRsaKeyPairTests` | MMCA.Common.Testing.Aspire.Tests | 1 | EphemeralRsaKeyPair |
| 1 | `H2cProbeServerTests` | MMCA.Common.Testing.Aspire.Tests | 2 | AppHostProbePaths, H2cProbe |
| 1 | `H2cProbeTests` | MMCA.Common.Testing.Aspire.Tests | 1 | H2cProbe |
| 1 | `AuthOutcomeRules` | MMCA.Common.Testing.E2E | 1 | AuthOutcome |
| 1 | `PlaywrightFixture` | MMCA.Common.Testing.E2E | 1 | E2ETestConfiguration |
| 1 | `WebVitalsArtifact` | MMCA.Common.Testing.E2E | 1 | WebVitalsSample |
| 1 | `WebVitalsBudget` | MMCA.Common.Testing.E2E | 1 | WebVitalsSample |
| 1 | `FixedProvider` | MMCA.Common.Testing.Tests | 1 | IEntityConfigurationAssemblyProvider |
| 1 | `JwtTokenGeneratorTests` | MMCA.Common.Testing.Tests | 1 | JwtTokenGenerator |
| 1 | `MmcaGatewayHardeningTestsBaseTests` | MMCA.Common.Testing.Tests | 1 | MmcaGatewayHardeningTestsBase<TEntryPoint> |
| 1 | `ProbeFixture` | MMCA.Common.Testing.Tests | 1 | ServiceBusEmulatorFixtureBase |
| 1 | `SampleGatewayHardeningTests` | MMCA.Common.Testing.Tests | 2 | MmcaGatewayHardeningTestsBase<TEntryPoint>, SampleGatewayEntryPoint |
| 1 | `SampleService` | MMCA.Common.Testing.Tests | 1 | ISampleService |
| 1 | `TestPollingTests` | MMCA.Common.Testing.Tests | 1 | TestPolling |
| 1 | `CapturingHttpMessageHandler` | MMCA.Common.Testing.UI | 2 | CapturedRequest, Route |
| 1 | `MarkupSnapshot` | MMCA.Common.Testing.UI | 1 | MarkupSnapshotResult |
| 1 | `StubTokenStorageService` | MMCA.Common.Testing.UI | 1 | ITokenStorageService |
| 1 | `TestPrincipal` | MMCA.Common.Testing.UI | 1 | AuthClaimTypes |
| 1 | `AlwaysOnlineConnectivityStatusService` | MMCA.Common.UI | 1 | IConnectivityStatusService |
| 1 | `ApiSettings` | MMCA.Common.UI | 1 | IApiSettings |
| 1 | `ApiUserPreferenceWriter` | MMCA.Common.UI | 4 | ITokenStorageService, IUserPreferenceWriter, JwtTokenInfo, UserPreferencesRequest |
| 1 | `AuthDelegatingHandler` | MMCA.Common.UI | 1 | ITokenStorageService |
| 1 | `AuthenticatedServiceBase` | MMCA.Common.UI | 2 | IdempotencyHeaders, ITokenStorageService |
| 1 | `AuthFieldMessages` | MMCA.Common.UI | 1 | SharedResource |
| 1 | `BiometricGate` | MMCA.Common.UI | 2 | AppResumedEventArgs, DevicePreferenceKeys |
| 1 | `BrowserMapNavigationService` | MMCA.Common.UI | 2 | IExternalLinkService, IMapNavigationService |
| 1 | `CapabilitiesJsModule` | MMCA.Common.UI | 1 | LazyJsModule |
| 1 | `ConfigurationOAuthUISettings` | MMCA.Common.UI | 1 | IOAuthUISettings |
| 1 | `DataAnnotationsModelValidator` | MMCA.Common.UI | 1 | IModelValidator |
| 1 | `DeepLinkRouteEventArgs` | MMCA.Common.UI | 1 | Route |
| 1 | `DefaultOAuthUISettings` | MMCA.Common.UI | 1 | IOAuthUISettings |
| 1 | `DetailPageBase` | MMCA.Common.UI | 1 | LatestLoadGuard |
| 1 | `EndpointCultureApplier` | MMCA.Common.UI | 1 | ICultureApplier |
| 1 | `IAppLifecycleNotifier` | MMCA.Common.UI | 1 | AppResumedEventArgs |
| 1 | `IGeocodingService` | MMCA.Common.UI | 1 | GeoPoint |
| 1 | `IGeolocationService` | MMCA.Common.UI | 1 | GeoPoint |
| 1 | `ILocalNotificationService` | MMCA.Common.UI | 1 | LocalNotificationRequest |
| 1 | `IMediaPickerService` | MMCA.Common.UI | 1 | PickedMedia |
| 1 | `InMemoryDevicePreferences` | MMCA.Common.UI | 1 | IDevicePreferences |
| 1 | `InvariantMudLocalizationInterceptor` | MMCA.Common.UI | 1 | BuiltInStrings |
| 1 | `IPushDeviceTokenProvider` | MMCA.Common.UI | 1 | PushDeviceToken |
| 1 | `ISessionAwareTokenRefresher` | MMCA.Common.UI | 2 | ITokenRefresher, TokenAcquisition |
| 1 | `IToastService` | MMCA.Common.UI | 1 | ToastSeverity |
| 1 | `IUserPreferenceReader` | MMCA.Common.UI | 1 | UserPreferences |
| 1 | `JsFetchSessionCookieSync` | MMCA.Common.UI | 1 | ISessionCookieSync |
| 1 | `JwtAuthenticationStateProvider` | MMCA.Common.UI | 1 | ITokenStorageService |
| 1 | `ListPageQueryStateService` | MMCA.Common.UI | 1 | ListPageState |
| 1 | `ListPageStateService` | MMCA.Common.UI | 2 | LazyJsModule, ListPageState |
| 1 | `MauiBackNavigationBridge` | MMCA.Common.UI | 1 | BackNavigationResult |
| 1 | `MmcaCultureBootstrap` | MMCA.Common.UI | 1 | SupportedCultures |
| 1 | `MudAppDialogService` | MMCA.Common.UI | 1 | IAppDialogService |
| 1 | `NavigationHistoryService` | MMCA.Common.UI | 2 | LazyJsModule, ReturnUrlProtector |
| 1 | `NavigationPublicLinkBuilder` | MMCA.Common.UI | 1 | IPublicLinkBuilder |
| 1 | `NavItem` | MMCA.Common.UI | 1 | NavSection |
| 1 | `NotificationSendModel` | MMCA.Common.UI | 1 | SendPushNotificationRequest |
| 1 | `NullAccessibilityAnnouncer` | MMCA.Common.UI | 1 | IAccessibilityAnnouncer |
| 1 | `NullBarcodeScannerService` | MMCA.Common.UI | 1 | IBarcodeScannerService |
| 1 | `NullBatteryStatusService` | MMCA.Common.UI | 1 | IBatteryStatusService |
| 1 | `NullBiometricAuthenticator` | MMCA.Common.UI | 1 | IBiometricAuthenticator |
| 1 | `NullClipboardService` | MMCA.Common.UI | 1 | IClipboardService |
| 1 | `NullExternalLinkService` | MMCA.Common.UI | 1 | IExternalLinkService |
| 1 | `NullHapticFeedbackService` | MMCA.Common.UI | 1 | IHapticFeedbackService |
| 1 | `NullLocalCacheStore` | MMCA.Common.UI | 1 | ILocalCacheStore |
| 1 | `NullMapNavigationService` | MMCA.Common.UI | 1 | IMapNavigationService |
| 1 | `NullNotificationScopeProvider` | MMCA.Common.UI | 1 | INotificationScopeProvider |
| 1 | `NullPushRegistrationService` | MMCA.Common.UI | 1 | IPushRegistrationService |
| 1 | `NullScreenshotService` | MMCA.Common.UI | 1 | IScreenshotService |
| 1 | `NullShareService` | MMCA.Common.UI | 1 | IShareService |
| 1 | `NullSpeechToTextService` | MMCA.Common.UI | 1 | ISpeechToTextService |
| 1 | `NullTextToSpeechService` | MMCA.Common.UI | 1 | ITextToSpeechService |
| 1 | `OAuthFlowStateStore` | MMCA.Common.UI | 2 | ILocalCacheStore, PendingAttempt |
| 1 | `OfflineFirstPageSnapshot<TItem>` | MMCA.Common.UI | 3 | CachedPage, IConnectivityStatusService, ILocalCacheStore |
| 1 | `PasswordComplexityAttribute` | MMCA.Common.UI | 1 | PasswordComplexity |
| 1 | `PseudoStringLocalizer` | MMCA.Common.UI | 2 | PseudoLocalizer, SupportedCultures |
| 1 | `ResxMudLocalizer` | MMCA.Common.UI | 1 | MudTranslations |
| 1 | `SameOriginProxyRequestHandler` | MMCA.Common.UI | 1 | SameOriginProxyHeaders |
| 1 | `ThemeService` | MMCA.Common.UI | 1 | LazyJsModule |
| 1 | `TokenHydrationWarmup` | MMCA.Common.UI | 1 | ITokenStorageService |
| 1 | `UiReadCache` | MMCA.Common.UI | 2 | IUiReadCache, UiReadCacheOptions |
| 1 | `UnavailableExternalAuthBroker` | MMCA.Common.UI | 1 | IExternalAuthBroker |
| 1 | `ViewerTimeZone` | MMCA.Common.UI | 1 | LazyJsModule |
| 1 | `WasmFormFactor` | MMCA.Common.UI | 1 | IFormFactor |
| 1 | `GalleryFakeAuthenticationHandler` | MMCA.Common.UI.Gallery | 2 | AuthClaimTypes, NotificationPermissions |
| 1 | `NullTokenRefresher` | MMCA.Common.UI.Gallery | 1 | ITokenRefresher |
| 1 | `NullTokenStorageService` | MMCA.Common.UI.Gallery | 1 | ITokenStorageService |
| 1 | `SampleGridData` | MMCA.Common.UI.Gallery | 1 | SampleGridRow |
| 1 | `MauiAccessibilityAnnouncer` | MMCA.Common.UI.Maui | 1 | IAccessibilityAnnouncer |
| 1 | `MauiBarcodeScannerService` | MMCA.Common.UI.Maui | 2 | BarcodeScanPage, IBarcodeScannerService |
| 1 | `MauiBatteryStatusService` | MMCA.Common.UI.Maui | 1 | IBatteryStatusService |
| 1 | `MauiBiometricAuthenticator` | MMCA.Common.UI.Maui | 1 | IBiometricAuthenticator |
| 1 | `MauiClipboardService` | MMCA.Common.UI.Maui | 1 | IClipboardService |
| 1 | `MauiConnectivityStatusService` | MMCA.Common.UI.Maui | 1 | IConnectivityStatusService |
| 1 | `MauiCultureStore` | MMCA.Common.UI.Maui | 1 | SupportedCultures |
| 1 | `MauiDevicePreferences` | MMCA.Common.UI.Maui | 1 | IDevicePreferences |
| 1 | `MauiExternalLinkService` | MMCA.Common.UI.Maui | 1 | IExternalLinkService |
| 1 | `MauiFormFactor` | MMCA.Common.UI.Maui | 1 | IFormFactor |
| 1 | `MauiHapticFeedbackService` | MMCA.Common.UI.Maui | 1 | IHapticFeedbackService |
| 1 | `MauiInitialThemeModeSource` | MMCA.Common.UI.Maui | 2 | IInitialThemeModeSource, MauiThemeStore |
| 1 | `MauiLocalCacheStore` | MMCA.Common.UI.Maui | 1 | ILocalCacheStore |
| 1 | `MauiMapNavigationService` | MMCA.Common.UI.Maui | 1 | IMapNavigationService |
| 1 | `MauiPublicLinkBuilder` | MMCA.Common.UI.Maui | 1 | IPublicLinkBuilder |
| 1 | `MauiScreenshotService` | MMCA.Common.UI.Maui | 1 | IScreenshotService |
| 1 | `MauiSecureTokenStore` | MMCA.Common.UI.Maui | 1 | ISecureTokenStore |
| 1 | `MauiShareService` | MMCA.Common.UI.Maui | 1 | IShareService |
| 1 | `MauiSpeechToTextService` | MMCA.Common.UI.Maui | 1 | ISpeechToTextService |
| 1 | `MauiTextToSpeechService` | MMCA.Common.UI.Maui | 1 | ITextToSpeechService |
| 1 | `MauiTokenStorageService` | MMCA.Common.UI.Maui | 4 | ISecureTokenStore, ITokenRefresher, ITokenStorageService, JwtTokenInfo |
| 1 | `AlwaysFailsValidator` | MMCA.Common.UI.Tests | 1 | IModelValidator |
| 1 | `ChannelReferenceCounterTests` | MMCA.Common.UI.Tests | 1 | ChannelReferenceCounter |
| 1 | `ConcurrencyTrackingTokenStorage` | MMCA.Common.UI.Tests | 1 | ITokenStorageService |
| 1 | `DroppingCacheStore` | MMCA.Common.UI.Tests | 1 | ILocalCacheStore |
| 1 | `FakeBiometricAuthenticator` | MMCA.Common.UI.Tests | 1 | IBiometricAuthenticator |
| 1 | `FakeCacheStore` | MMCA.Common.UI.Tests | 1 | ILocalCacheStore |
| 1 | `FakeConnectivity` | MMCA.Common.UI.Tests | 1 | IConnectivityStatusService |
| 1 | `FakeConnectivityService` | MMCA.Common.UI.Tests | 1 | IConnectivityStatusService |
| 1 | `FakeDevicePreferences` | MMCA.Common.UI.Tests | 1 | IDevicePreferences |
| 1 | `FakeExternalLinkService` | MMCA.Common.UI.Tests | 1 | IExternalLinkService |
| 1 | `FakeLocalCacheStore` | MMCA.Common.UI.Tests | 1 | ILocalCacheStore |
| 1 | `FakeStringLocalizerFactory` | MMCA.Common.UI.Tests | 1 | FakeStringLocalizer |
| 1 | `FixedInitialThemeModeSource` | MMCA.Common.UI.Tests | 1 | IInitialThemeModeSource |
| 1 | `InMemoryHubServer` | MMCA.Common.UI.Tests | 1 | PipePair |
| 1 | `LatestLoadGuardTests` | MMCA.Common.UI.Tests | 1 | LatestLoadGuard |
| 1 | `LazyJsModuleTests` | MMCA.Common.UI.Tests | 1 | LazyJsModule |
| 1 | `NamedScopeProvider` | MMCA.Common.UI.Tests | 1 | INotificationScopeProvider |
| 1 | `NotificationStateTests` | MMCA.Common.UI.Tests | 2 | FakeTimeProvider, NotificationState |
| 1 | `RecordingCultureApplier` | MMCA.Common.UI.Tests | 1 | ICultureApplier |
| 1 | `ReturnUrlProtectorTests` | MMCA.Common.UI.Tests | 1 | ReturnUrlProtector |
| 1 | `SampleModel` | MMCA.Common.UI.Tests | 1 | ChildModel |
| 1 | `ScriptedHandler` | MMCA.Common.UI.Tests | 1 | IdempotencyHeaders |
| 1 | `StringLocalizerPluralExtensionsTests` | MMCA.Common.UI.Tests | 1 | FakeLocalizer |
| 1 | `StubHttpMessageHandler` | MMCA.Common.UI.Tests | 2 | CapturedRequest, StubHttpMessageHandler |
| 1 | `StubScopeProvider` | MMCA.Common.UI.Tests | 1 | INotificationScopeProvider |
| 1 | `StubSharedLocalizer` | MMCA.Common.UI.Tests | 1 | SharedResource |
| 1 | `TestUser` | MMCA.Common.UI.Tests | 1 | IUserAdminDTO |
| 1 | `TimerCountingTimeProvider` | MMCA.Common.UI.Tests | 1 | FakeTimeProvider |
| 1 | `UserAdminListSpanishResourcesTests` | MMCA.Common.UI.Tests | 1 | UserAdminListResources |
| 1 | `UserAgentSummaryTests` | MMCA.Common.UI.Tests | 1 | UserAgentSummary |
| 1 | `WidgetDto` | MMCA.Common.UI.Tests | 1 | IBaseDTO<TIdentifierType> |
| 1 | `BlazorCspSettingsValidator` | MMCA.Common.UI.Web | 1 | BlazorCspSettings |
| 1 | `BoundedCircuitHandler` | MMCA.Common.UI.Web | 1 | BlazorCircuitLimitSettings |
| 1 | `SameOriginApiProxySettingsValidator` | MMCA.Common.UI.Web | 1 | SameOriginApiProxySettings |
| 1 | `SessionHandoffProtector` | MMCA.Common.UI.Web | 1 | TokenPair |
| 1 | `UiRateLimitingExtensions` | MMCA.Common.UI.Web | 2 | SameOriginApiProxySettings, UiRateLimitingSettings |
| 1 | `WebFormFactor` | MMCA.Common.UI.Web | 1 | IFormFactor |
| 1 | `BrowserOriginHandlerTests` | MMCA.Common.UI.Web.Tests | 2 | BrowserOriginHandler, CapturingHandler |
| 1 | `CapturingHandler` | MMCA.Common.UI.Web.Tests | 1 | SentRequest |
| 1 | `FakeGateway` | MMCA.Common.UI.Web.Tests | 3 | AuthenticationResponse, Jwt, SeenRequest |
| 1 | `Mocks` | MMCA.Common.UI.Web.Tests | 2 | ISessionCookieSync, ITokenRefresher |
| 2 | `ServiceInfoController` | MMCA.ADC.Conference.API | 2 | Route, ServiceInfoControllerBase |
| 2 | `AddSessionAssetLinkCommand` | MMCA.ADC.Conference.Application | 2 | ICommandWithRequest<out TRequest>, SessionAssetLinkRequest |
| 2 | `DeleteSessionAssetCommandValidator` | MMCA.ADC.Conference.Application | 2 | DeleteSessionAssetCommand, RequiredIdRules<T, TId> |
| 2 | `IAiScoringService` | MMCA.ADC.Conference.Application | 2 | SessionScoringInput, SessionScoringResult |
| 2 | `PartnerUpdateRequest` | MMCA.ADC.Conference.Application | 2 | IPartnerFieldsRequest, PartnerType |
| 2 | `SessionizeResponse` | MMCA.ADC.Conference.Application | 5 | SessionizeCategory, SessionizeQuestion, SessionizeRoom, SessionizeSession, SessionizeSpeaker |
| 2 | `SponsorUpdateRequest` | MMCA.ADC.Conference.Application | 2 | ISponsorFieldsRequest, SponsorTier |
| 2 | `UpdateSessionAssetCommand` | MMCA.ADC.Conference.Application | 2 | ICommandWithRequest<out TRequest>, SessionAssetUpdateRequest |
| 2 | `TestSessionizeValidator` | MMCA.ADC.Conference.Application.Tests | 2 | EventSessionizeCodeRules<T>, TestSessionizeModel |
| 2 | `UploadSessionAssetCommandMarkerTests` | MMCA.ADC.Conference.Application.Tests | 1 | UploadSessionAssetCommand |
| 2 | `CategoryItemChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `EventQuestionAnswerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `EventSpeakerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `RoomChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SessionCategoryItemChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SessionQuestionAnswerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SessionSpeakerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SpeakerCategoryItemChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SpeakerQuestionAnswerChanged` | MMCA.ADC.Conference.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `OutputCacheSessionScoresCacheEvictorTests` | MMCA.ADC.Conference.Infrastructure.Tests | 1 | OutputCacheSessionScoresCacheEvictor |
| 2 | `SeedRun` | MMCA.ADC.Conference.IntegrationTests | 2 | ForwardingProxy, Rendezvous |
| 2 | `GoldenCase` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 4 | GoldenExpectation, GoldenInput, SessionScoringInput, SpeakerInfo |
| 2 | `SelfHttpOutputCacheWarmupTask` | MMCA.ADC.Conference.Service | 1 | SelfHttpWarmupTaskBase |
| 2 | `CategoryDistributionDTO` | MMCA.ADC.Conference.Shared | 1 | CategoryGroupDistribution |
| 2 | `ConferenceCategoryDTO` | MMCA.ADC.Conference.Shared | 3 | CategoryItemDTO, IBaseDTO<TIdentifierType>, IConcurrencyAware |
| 2 | `EventDTO` | MMCA.ADC.Conference.Shared | 6 | EventQuestionAnswerDTO, EventSpeakerDTO, IBaseDTO<TIdentifierType>, IConcurrencyAware, QuestionModerationDefault, RoomDTO |
| 2 | `SessionDTO` | MMCA.ADC.Conference.Shared | 5 | IBaseDTO<TIdentifierType>, IConcurrencyAware, SessionCategoryItemDTO, SessionQuestionAnswerDTO, SessionSpeakerDTO |
| 2 | `SpeakerDTO` | MMCA.ADC.Conference.Shared | 4 | IBaseDTO<TIdentifierType>, IConcurrencyAware, SpeakerCategoryItemDTO, SpeakerQuestionAnswerDTO |
| 2 | `SpeakerSessionOverlapDTO` | MMCA.ADC.Conference.Shared | 1 | MultiSessionSpeaker |
| 2 | `ActivityFormModel` | MMCA.ADC.Conference.UI | 1 | ActivityDTO |
| 2 | `ConferenceCategoryItemEditModel` | MMCA.ADC.Conference.UI | 1 | CategoryItemDTO |
| 2 | `PartnerFormModel` | MMCA.ADC.Conference.UI | 2 | PartnerDTO, PartnerType |
| 2 | `PublicReadAudience` | MMCA.ADC.Conference.UI | 1 | ConferenceReadAudience |
| 2 | `QuestionFormModel` | MMCA.ADC.Conference.UI | 1 | QuestionDTO |
| 2 | `RoomFormModel` | MMCA.ADC.Conference.UI | 1 | RoomDTO |
| 2 | `SessionAssetDisplay` | MMCA.ADC.Conference.UI | 3 | SessionAssetDTO, SessionAssetKind, SessionAssetLimits |
| 2 | `SponsorFormModel` | MMCA.ADC.Conference.UI | 2 | SponsorDTO, SponsorTier |
| 2 | `ScorePollTrackerTests` | MMCA.ADC.Conference.UI.Tests | 3 | ScorePollSignal, ScorePollTracker, SessionAiScoreDTO |
| 2 | `CheckInScanPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `ConferenceCategoryCreatePage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `ConferenceCategoryDetailPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `ConferenceCategoryListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `EventCreatePage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `EventDetailPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `EventFilterPageExtensions` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `EventListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `HappeningNowPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `PartnerCreatePage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `PartnerDetailPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `PartnerListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `PublicSessionListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `PublicSpeakerListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `QuestionCreatePage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `QuestionDetailPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `QuestionListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `RoomCreatePage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `RoomDetailPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `RoomListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SessionAssetsPanelPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SessionCreatePage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SessionDetailPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SessionListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SpeakerCreatePage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SpeakerDashboardPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SpeakerDetailPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SpeakerListPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SponsorCreatePage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `SponsorDetailPage` | MMCA.ADC.E2E.Tests | 1 | State |
| 2 | `CheckInAttendeeRequestValidator` | MMCA.ADC.Engagement.Application | 2 | CheckInAttendeeRequest, CheckInScope |
| 2 | `LiveChannelPublishQueue` | MMCA.ADC.Engagement.Application | 2 | ILiveChannelPublishQueue, LiveChannelPublishWorkItem |
| 2 | `ManualCheckInRequestValidator` | MMCA.ADC.Engagement.Application | 2 | CheckInScope, ManualCheckInRequest |
| 2 | `CastVoteCommandValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 2 | CastVoteCommand, CastVoteCommandValidator |
| 2 | `CountingQueryableExecutor` | MMCA.ADC.Engagement.Application.Tests | 2 | InMemoryQueryableExecutor, IQueryableExecutor |
| 2 | `CreateBookmarkRequestValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 2 | CreateBookmarkRequest, CreateBookmarkRequestValidator |
| 2 | `RecordingQueue` | MMCA.ADC.Engagement.Application.Tests | 2 | ILiveChannelPublishQueue, LiveChannelPublishWorkItem |
| 2 | `RecordingQueue` | MMCA.ADC.Engagement.Application.Tests | 2 | ILiveChannelPublishQueue, LiveChannelPublishWorkItem |
| 2 | `RoomCheckInRequestValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 2 | RoomCheckInRequest, RoomCheckInRequestValidator |
| 2 | `SponsorVisitRequestValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 2 | SponsorVisitRequest, SponsorVisitRequestValidator |
| 2 | `ToggleUpvoteCommandValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 2 | ToggleUpvoteCommand, ToggleUpvoteCommandValidator |
| 2 | `LeaderboardOptInChanged` | MMCA.ADC.Engagement.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `LivePollChanged` | MMCA.ADC.Engagement.Domain | 3 | BaseDomainEvent, DomainEntityState, LivePollStatus |
| 2 | `LivePollVoteChanged` | MMCA.ADC.Engagement.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `PointsEntryChanged` | MMCA.ADC.Engagement.Domain | 3 | BaseDomainEvent, DomainEntityState, PointsActivityType |
| 2 | `SessionQuestionChanged` | MMCA.ADC.Engagement.Domain | 3 | BaseDomainEvent, DomainEntityState, QuestionStatus |
| 2 | `SessionQuestionUpvoteChanged` | MMCA.ADC.Engagement.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `UserSessionBookmarkChanged` | MMCA.ADC.Engagement.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `SelfHttpWarmupTask` | MMCA.ADC.Engagement.Service | 2 | SelfHttpWarmupTask, SelfHttpWarmupTaskBase |
| 2 | `MyPointsDTO` | MMCA.ADC.Engagement.Shared | 1 | PointsEntryDTO |
| 2 | `PointsOverviewDTO` | MMCA.ADC.Engagement.Shared | 2 | PointsActivityTotalDTO, PointsEntryDTO |
| 2 | `UserEngagementExportDTO` | MMCA.ADC.Engagement.Shared | 6 | UserEngagementBookmarkExportDTO, UserEngagementCheckInExportDTO, UserEngagementPointsEntryExportDTO, UserEngagementPollVoteExportDTO, UserEngagementQuestionUpvoteExportDTO, UserEngagementSubmittedQuestionExportDTO |
| 2 | `DisabledBookmarkCountServiceTests` | MMCA.ADC.Engagement.Shared.Tests | 1 | DisabledBookmarkCountService |
| 2 | `PointsSubjectKeysTests` | MMCA.ADC.Engagement.Shared.Tests | 1 | PointsSubjectKeys |
| 2 | `CurrentEventNotificationScopeProvider` | MMCA.ADC.Engagement.UI | 4 | ILiveEventUIService, INotificationScopeProvider, LiveEventContext, NotificationScopeKey |
| 2 | `LiveBroadcastPatch` | MMCA.ADC.Engagement.UI | 3 | LivePollResultsDTO, SessionQuestionDTO, SessionQuestionUpvoteChangedPayload |
| 2 | `IdentityModule` | MMCA.ADC.Identity.API | 4 | ApplicationSettings, DisabledAttendeeQueryService, IAttendeeQueryService, IModule |
| 2 | `ChangePasswordRequestValidator` | MMCA.ADC.Identity.Application | 2 | ChangePasswordRequest, StrongPasswordRules<T> |
| 2 | `ExportUserDataQuery` | MMCA.ADC.Identity.Application | 1 | IUserOwnedRequest |
| 2 | `SetUserAvatarCommandValidator` | MMCA.ADC.Identity.Application | 2 | ImageContentSniffer, SetUserAvatarCommand |
| 2 | `LoginRequestValidatorTests` | MMCA.ADC.Identity.Application.Tests | 2 | LoginRequest, LoginRequestValidator |
| 2 | `RefreshTokenRequestValidatorTests` | MMCA.ADC.Identity.Application.Tests | 2 | RefreshTokenRequest, RefreshTokenRequestValidator |
| 2 | `SetUserAvatarCommandMarkerTests` | MMCA.ADC.Identity.Application.Tests | 1 | SetUserAvatarCommand |
| 2 | `UserDeleted` | MMCA.ADC.Identity.Domain | 1 | BaseDomainEvent |
| 2 | `UserPasswordChanged` | MMCA.ADC.Identity.Domain | 1 | BaseDomainEvent |
| 2 | `FakeUserNotificationExportService` | MMCA.ADC.Identity.IntegrationTests | 2 | IUserNotificationExportService, UserNotificationExportItemDTO |
| 2 | `PiiCaptureLoggerProvider` | MMCA.ADC.Identity.IntegrationTests | 1 | PiiCaptureLogger |
| 2 | `SelfHttpWarmupTask` | MMCA.ADC.Identity.Service | 2 | SelfHttpWarmupTask, SelfHttpWarmupTaskBase |
| 2 | `DisabledAttendeeQueryServiceTests` | MMCA.ADC.Identity.Shared.Tests | 1 | DisabledAttendeeQueryService |
| 2 | `AttendeeNotificationRecipientProviderTests` | MMCA.ADC.Notification.Application.Tests | 2 | AttendeeNotificationRecipientProvider, IAttendeeQueryService |
| 2 | `DisabledUserNotificationExportService` | MMCA.ADC.Notification.Shared | 2 | IUserNotificationExportService, UserNotificationExportItemDTO |
| 2 | `LiveChannelGrpcServiceTests` | MMCA.ADC.Services.Tests | 5 | FakeServerCallContext, ILiveChannelPublisher, LiveChannelGrpcService, LivePollChannel, SessionQuestionChannel |
| 2 | `LiveChannelPublisherGrpcAdapterTests` | MMCA.ADC.Services.Tests | 2 | GrpcCalls, LiveChannelPublisherGrpcAdapter |
| 2 | `AiProviderValidator` | MMCA.Common.AI | 2 | AiSettings, IAiProviderFactory |
| 2 | `BoundedChatClient` | MMCA.Common.AI | 5 | AiSettings, ChatToolPolicy, IAiTokenEstimator, IChatToolPolicy, ToolAuthorization |
| 2 | `ContentPolicyGuardrail` | MMCA.Common.AI | 5 | ContentPolicyInjectionMode, ContentPolicySettings, GuardrailVerdict, IChatGuardrail, IChatRequestRedactor |
| 2 | `ContentPolicySettings` | MMCA.Common.AI | 2 | ContentPolicyGuardrail, ContentPolicyInjectionMode |
| 2 | `GuardrailChatClient` | MMCA.Common.AI | 4 | ChatGuardrailException, GuardrailVerdict, IChatGuardrail, IChatRequestRedactor |
| 2 | `AnthropicAiProviderFactory` | MMCA.Common.AI.Anthropic | 2 | AiSettings, IAiProviderFactory |
| 2 | `OpenAiProviderFactory` | MMCA.Common.AI.OpenAI | 2 | AiSettings, IAiProviderFactory |
| 2 | `EmptyCorpusHarness` | MMCA.Common.AI.Tests | 3 | GoldenReplayCase, GoldenReplayTestsBase, ReplayChatClient |
| 2 | `FakeProviderFactory` | MMCA.Common.AI.Tests | 2 | AiSettings, IAiProviderFactory |
| 2 | `MissingRecordingHarness` | MMCA.Common.AI.Tests | 3 | GoldenReplayCase, GoldenReplayTestsBase, ReplayChatClient |
| 2 | `PinHarness` | MMCA.Common.AI.Tests | 2 | PromptContract, PromptContractPinTestsBase |
| 2 | `PreStreamingGuardrail` | MMCA.Common.AI.Tests | 2 | GuardrailVerdict, IChatGuardrail |
| 2 | `ProviderTagTests` | MMCA.Common.AI.Tests | 2 | StubChatClient, UsageRecordingChatClient |
| 2 | `RecordingGuardrail` | MMCA.Common.AI.Tests | 2 | GuardrailVerdict, IChatGuardrail |
| 2 | `ReferenceGoldenReplayTests` | MMCA.Common.AI.Tests | 6 | GoldenReplayCase, GoldenReplayTestsBase, PromptContract, RecordedResponses, ReferencePrompts, ReplayChatClient |
| 2 | `ReferencePromptContractTests` | MMCA.Common.AI.Tests | 3 | PromptContract, PromptContractPinTestsBase, ReferencePrompts |
| 2 | `StubGuardrail` | MMCA.Common.AI.Tests | 2 | GuardrailVerdict, IChatGuardrail |
| 2 | `StubToolPolicy` | MMCA.Common.AI.Tests | 2 | IChatToolPolicy, ToolAuthorization |
| 2 | `UsageRecordingChatClientTests` | MMCA.Common.AI.Tests | 5 | AiUsageMeter, PromptContract, StubChatClient, UsageRecorder, UsageRecordingChatClient |
| 2 | `IEntityControllerBase<TEntityDTO, TIdentifierType>` | MMCA.Common.API | 5 | BaseLookup<TIdentifierType>, CollectionResult<T>, IBaseDTO<TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder |
| 2 | `ModuleControllerFeatureProvider` | MMCA.Common.API | 1 | ModulesSettings |
| 2 | `OidcDiscoveryEndpointExtensions` | MMCA.Common.API | 1 | JwksEndpointExtensions |
| 2 | `OutputCacheOptionsExtensions` | MMCA.Common.API | 1 | PublicEndpointOutputCachePolicy |
| 2 | `ApiParameterDescriptorBackfillProviderTests` | MMCA.Common.API.Tests | 4 | ApiParameterDescriptorBackfillProvider, OpenApiProbeHost, SegmentVersionedProbeController, UnboundRouteTokenProbeController |
| 2 | `AppAssociationEndpointTests` | MMCA.Common.API.Tests | 2 | AppAssociationEndpointExtensions, AppAssociationOptions |
| 2 | `AuthorizationExtensionsTests` | MMCA.Common.API.Tests | 3 | IPermissionRegistry, PermissionAuthorizationHandler, PermissionPolicyProvider |
| 2 | `ExceptionHandlerTests` | MMCA.Common.API.Tests | 8 | CrossTenantWriteException, DbUpdateExceptionHandler, DomainExceptionHandler, DomainInvariantViolationException, GlobalExceptionHandler, OperationCanceledExceptionHandler, TestDomainException, ValidationExceptionHandler |
| 2 | `FallbackAuthorizationTests` | MMCA.Common.API.Tests | 3 | FallbackAuthorizationHandler, FallbackAuthorizationOptions, FallbackAuthorizationRequirement |
| 2 | `HostRegistrationProbeFeatureProvider` | MMCA.Common.API.Tests | 1 | HostRegistrationProbeController |
| 2 | `JwksEndpointTests` | MMCA.Common.API.Tests | 4 | IJwksProvider, JwksEndpointExtensions, JwksSettings, RsaJwksProvider |
| 2 | `OpenApiBaselineTests` | MMCA.Common.API.Tests | 4 | OpenApiProbeHost, ProblemDetailsProbeController, SegmentVersionedProbeController, UnboundRouteTokenProbeController |
| 2 | `PermissionPolicyProviderTests` | MMCA.Common.API.Tests | 2 | PermissionPolicyProvider, PermissionRequirement |
| 2 | `ProbeControllerFeatureProvider` | MMCA.Common.API.Tests | 3 | ApiVersionProbeController, ApiVersionProtectedProbeController, ApiVersionUndecoratedProbeController |
| 2 | `PublicEndpointOutputCachePolicyTests` | MMCA.Common.API.Tests | 3 | ITenantContext, PublicEndpointOutputCachePolicy, StubTenantContext |
| 2 | `RateLimitingSettingsTests` | MMCA.Common.API.Tests | 2 | RateLimitAlgorithm, RateLimitingSettings |
| 2 | `RecordingLoggerProvider` | MMCA.Common.API.Tests | 2 | LogEntry, RecordingLogger |
| 2 | `RedisFixedWindowRateLimiterTests` | MMCA.Common.API.Tests | 2 | FakeTimeProvider, RedisFixedWindowRateLimiter |
| 2 | `StubFeatureManager` | MMCA.Common.API.Tests | 1 | PrivacyFeatures |
| 2 | `TestChangePasswordCommand` | MMCA.Common.API.Tests | 2 | ChangePasswordRequest, IUserScopedCommand<out TRequest> |
| 2 | `TestChangePreferencesCommand` | MMCA.Common.API.Tests | 2 | ChangePreferencesRequest, IUserScopedCommand<out TRequest> |
| 2 | `TestExportQuery` | MMCA.Common.API.Tests | 1 | IUserOwnedRequest |
| 2 | `CacheKeyLocks` | MMCA.Common.Application | 1 | KeyedSemaphoreStripe |
| 2 | `CqrsContractInspector` | MMCA.Common.Application | 6 | CqrsContractMismatch, CqrsContractMismatchKind, ICommand<TResult>, ICommandHandler<in TCommand, TResult>, IQuery<TResult>, IQueryHandler<in TQuery, TResult> |
| 2 | `EmailConfirmationErrors` | MMCA.Common.Application | 1 | Error |
| 2 | `IDataSourceService` | MMCA.Common.Application | 2 | DataSource, DataSourceKey |
| 2 | `IEventBus` | MMCA.Common.Application | 1 | IIntegrationEvent |
| 2 | `IEventUpcaster` | MMCA.Common.Application | 1 | IIntegrationEvent |
| 2 | `IEventUpcasterRegistry` | MMCA.Common.Application | 1 | IIntegrationEvent |
| 2 | `IIntegrationEventHandler<in TIntegrationEvent>` | MMCA.Common.Application | 1 | IIntegrationEvent |
| 2 | `IMessageBus` | MMCA.Common.Application | 1 | IIntegrationEvent |
| 2 | `INavigationMetadata` | MMCA.Common.Application | 1 | NavigationPropertyInfo |
| 2 | `IUserDataExportSection` | MMCA.Common.Application | 1 | UserDataExportSectionResult |
| 2 | `LegalAcceptanceErrors` | MMCA.Common.Application | 3 | AuthErrorCodes, Error, LegalAcceptanceErrorCodes |
| 2 | `ModuleLoader` | MMCA.Common.Application | 4 | ApplicationSettings, IModule, IModuleSeeder, ModulesSettings |
| 2 | `QueryCacheKeyLocks` | MMCA.Common.Application | 1 | KeyedSemaphoreStripe |
| 2 | `ResetPasswordRequestValidator` | MMCA.Common.Application | 2 | ResetPasswordRequest, StrongPasswordRules<T> |
| 2 | `SafeDomainEventHandler<TDomainEvent>` | MMCA.Common.Application | 2 | BaseDomainEvent, IDomainEventHandler<in TDomainEvent> |
| 2 | `TwoFactorErrors` | MMCA.Common.Application | 1 | Error |
| 2 | `UserOwnershipRule` | MMCA.Common.Application | 2 | Error, IUserOwnedRequest |
| 2 | `ValidationFailureExtensions` | MMCA.Common.Application | 1 | Error |
| 2 | `AuditTrailEntryDTOTests` | MMCA.Common.Application.Tests | 2 | AuditTrailEntryDTO, IAuditTrailReader |
| 2 | `BestEffortTests` | MMCA.Common.Application.Tests | 2 | BestEffort, RecordingLogger |
| 2 | `CommandRequestValidatorTests` | MMCA.Common.Application.Tests | 6 | CommandRequestValidator<TCommand, TRequest>, PermissiveTestRequestValidator, SecondTestRequestValidator, TestCommandWithRequest, TestRequest, TestRequestValidator |
| 2 | `DocumentContentSnifferTests` | MMCA.Common.Application.Tests | 2 | DocumentContentSniffer, DocumentFormats |
| 2 | `FakeConsumerModule` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 2 | `FakeCycleModuleOne` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 2 | `FakeCycleModuleTwo` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 2 | `FakeModuleAlpha` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 2 | `FakeModuleBravo` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 2 | `FakeModuleCharlie` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 2 | `FakeStrictModule` | MMCA.Common.Application.Tests | 3 | ApplicationSettings, FakeModuleTracker, IModule |
| 2 | `FakeStubbedModule` | MMCA.Common.Application.Tests | 5 | ApplicationSettings, FakeModuleTracker, FakeRemoteContractStub, IFakeRemoteContract, IModule |
| 2 | `ForgotPasswordRequestValidatorTests` | MMCA.Common.Application.Tests | 2 | ForgotPasswordRequest, ForgotPasswordRequestValidator |
| 2 | `LoginRequestValidatorTests` | MMCA.Common.Application.Tests | 2 | LoginRequest, LoginRequestValidator |
| 2 | `ModulesSettingsTests` | MMCA.Common.Application.Tests | 2 | ModuleSettings, ModulesSettings |
| 2 | `MultiHandlerEvent` | MMCA.Common.Application.Tests | 1 | BaseDomainEvent |
| 2 | `NullNotificationRecipientProviderTests` | MMCA.Common.Application.Tests | 1 | NullNotificationRecipientProvider |
| 2 | `RefreshTokenRequestValidatorTests` | MMCA.Common.Application.Tests | 2 | RefreshTokenRequest, RefreshTokenRequestValidator |
| 2 | `StubTwoFactorService` | MMCA.Common.Application.Tests | 2 | ITwoFactorService, RecoveryCodeSet |
| 2 | `TestChangePasswordCommand` | MMCA.Common.Application.Tests | 2 | ChangePasswordRequest, IUserScopedCommand<out TRequest> |
| 2 | `TestChangePreferencesCommand` | MMCA.Common.Application.Tests | 2 | ChangePreferencesRequest, IUserScopedCommand<out TRequest> |
| 2 | `TestDeleteUserCommand` | MMCA.Common.Application.Tests | 1 | IUserOwnedRequest |
| 2 | `TestEvent` | MMCA.Common.Application.Tests | 1 | BaseDomainEvent |
| 2 | `TestExportUserDataQuery` | MMCA.Common.Application.Tests | 1 | IUserOwnedRequest |
| 2 | `TestSafeDomainEvent` | MMCA.Common.Application.Tests | 1 | BaseDomainEvent |
| 2 | `TestTwoFactorCommand` | MMCA.Common.Application.Tests | 2 | IUserScopedCommand<out TRequest>, TwoFactorCodeRequest |
| 2 | `CostTagConventionTestsBaseTests` | MMCA.Common.Architecture.Tests | 4 | CostTagConventionTestsBase, HighFloorTemplate, UntaggedTemplate, WrongPrefixTemplate |
| 2 | `DuplicateTicketErrors` | MMCA.Common.Architecture.Tests | 1 | Error |
| 2 | `DynamicErrors` | MMCA.Common.Architecture.Tests | 1 | Error |
| 2 | `FakeDependentModule` | MMCA.Common.Architecture.Tests | 4 | ApplicationSettings, DisabledFakeExportService, IFakeExportService, IModule |
| 2 | `FakeLeafModule` | MMCA.Common.Architecture.Tests | 2 | ApplicationSettings, IModule |
| 2 | `InnocentHandler` | MMCA.Common.Architecture.Tests | 2 | FixtureDomainEvent, IDomainEventHandler<in TDomainEvent> |
| 2 | `InterfaceDispatchSavingHandler` | MMCA.Common.Architecture.Tests | 3 | FixtureDomainEvent, IBadgeGranter, IDomainEventHandler<in TDomainEvent> |
| 2 | `LeftService` | MMCA.Common.Architecture.Tests | 1 | RightModel |
| 2 | `MessageBusBackpressureTestsBaseTests` | MMCA.Common.Architecture.Tests | 3 | MessageBusBackpressureTestsBase, MessageBusSettings, NoServices |
| 2 | `NoDomainEventDispatcher` | MMCA.Common.Architecture.Tests | 2 | IDomainEvent, IDomainEventDispatcher |
| 2 | `PasswordHashingFitnessTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureAssert, PasswordHasher |
| 2 | `PasswordRuleParityTests` | MMCA.Common.Architecture.Tests | 3 | PasswordComplexityAttribute, PasswordProbe, StrongPasswordRules<T> |
| 2 | `SharedCodeErrors` | MMCA.Common.Architecture.Tests | 1 | Error |
| 2 | `TicketErrors` | MMCA.Common.Architecture.Tests | 1 | Error |
| 2 | `TwoBranchTicketErrors` | MMCA.Common.Architecture.Tests | 1 | Error |
| 2 | `UnprefixedErrors` | MMCA.Common.Architecture.Tests | 1 | Error |
| 2 | `SecurityHeadersMiddleware` | MMCA.Common.Aspire | 3 | CspNonce, ICspPolicyProvider, SecurityHeadersSettings |
| 2 | `StaticCspPolicyProvider` | MMCA.Common.Aspire | 3 | CspPolicy, ICspPolicyProvider, SecurityHeadersSettings |
| 2 | `H2cHealthCheckExtensionsTests` | MMCA.Common.Aspire.Hosting.Tests | 3 | H2cEndpointHealthCheck, H2cHealthCheckExtensions, StubHandler |
| 2 | `CachedHealthReportProviderTests` | MMCA.Common.Aspire.Tests | 4 | CachedHealthReportProvider, CountingCheck, HealthReportCacheOptions, StubClock |
| 2 | `ConfigurableWarmupTask` | MMCA.Common.Aspire.Tests | 1 | SelfHttpWarmupTaskBase |
| 2 | `GatewayRateLimitingTests` | MMCA.Common.Aspire.Tests | 2 | GatewayRateLimitingExtensions, GatewayRateLimitingSettings |
| 2 | `GatewayTrustedCallerTests` | MMCA.Common.Aspire.Tests | 2 | GatewayRateLimitingExtensions, GatewayRateLimitingSettings |
| 2 | `KestrelEndpointExtensionsTests` | MMCA.Common.Aspire.Tests | 2 | KestrelEndpointExtensions, KestrelListenerSpec |
| 2 | `KeyVaultConfigurationExtensionsTests` | MMCA.Common.Aspire.Tests | 1 | SourceCollectingHostApplicationBuilder |
| 2 | `NoCspProvider` | MMCA.Common.Aspire.Tests | 2 | CspPolicy, ICspPolicyProvider |
| 2 | `RefusesHttp2Handler` | MMCA.Common.Aspire.Tests | 2 | AttemptRecorder, ProbeAttempt |
| 2 | `StubCspProvider` | MMCA.Common.Aspire.Tests | 2 | CspPolicy, ICspPolicyProvider |
| 2 | `WarmupHostedServiceTests` | MMCA.Common.Aspire.Tests | 6 | HangingTask, IWarmupTask, RecordingTask, ThrowingTask, WarmupHostedService, WarmupReadinessGate |
| 2 | `WarmupReadinessHealthCheckTests` | MMCA.Common.Aspire.Tests | 2 | WarmupReadinessGate, WarmupReadinessHealthCheck |
| 2 | `SampleItem` | MMCA.Common.Benchmarks | 1 | BaseEntity<TIdentifierType> |
| 2 | `BaseIntegrationEvent` | MMCA.Common.Domain | 2 | BaseDomainEvent, IIntegrationEvent |
| 2 | `EntityChangedEvent<TIdentifierType>` | MMCA.Common.Domain | 2 | BaseDomainEvent, DomainEntityState |
| 2 | `PushNotificationCreated` | MMCA.Common.Domain | 1 | BaseDomainEvent |
| 2 | `Specification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 2 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType> |
| 2 | `GuidIdEntity` | MMCA.Common.Domain.Tests | 1 | BaseEntity<TIdentifierType> |
| 2 | `OtherTestEntity` | MMCA.Common.Domain.Tests | 1 | BaseEntity<TIdentifierType> |
| 2 | `PiiRedactorTests` | MMCA.Common.Domain.Tests | 4 | NoPii, PiiOverride, PiiRedactor, Subject |
| 2 | `StringIdEntity` | MMCA.Common.Domain.Tests | 1 | BaseEntity<TIdentifierType> |
| 2 | `TestDomainEvent` | MMCA.Common.Domain.Tests | 1 | BaseDomainEvent |
| 2 | `TestDomainEvent` | MMCA.Common.Domain.Tests | 1 | BaseDomainEvent |
| 2 | `GatewaySettings` | MMCA.Common.Gateway | 4 | GatewayClusterRequestProfile, GatewayHealthCheckDefaults, GatewayRoutePolicySettings, GatewayTraceHeaderSettings |
| 2 | `ResultFailureException` | MMCA.Common.Grpc | 1 | Error |
| 2 | `JwtForwardingClientInterceptorTests` | MMCA.Common.Grpc.Tests | 6 | AuthenticateResultFeatureStub, FakeRequest, FakeResponse, FakeStreamReader, FakeStreamWriter, JwtForwardingClientInterceptor |
| 2 | `ResilienceHandlerTests` | MMCA.Common.Grpc.Tests | 3 | FakeGrpcClient, GrpcResilienceDefaults, HttpResilienceDefaults |
| 2 | `ResultGrpcExtensionsDecoderTests` | MMCA.Common.Grpc.Tests | 2 | Error, ErrorType |
| 2 | `AggregateCapture` | MMCA.Common.Infrastructure | 2 | IAggregateRoot, IDomainEvent |
| 2 | `ConnectionStringSettingsValidator` | MMCA.Common.Infrastructure | 2 | ConnectionStringSettings, DataSourcesSettings |
| 2 | `FaultIntegrationEventConsumer<TEvent>` | MMCA.Common.Infrastructure | 2 | BrokerMetrics, IIntegrationEvent |
| 2 | `IEntityDataSourceRegistry` | MMCA.Common.Infrastructure | 1 | DataSourceKey |
| 2 | `InternalCommandsSettings` | MMCA.Common.Infrastructure | 2 | DataSource, DataSourceKey |
| 2 | `NotificationHub` | MMCA.Common.Infrastructure | 2 | IChannelJoinAuthorizer, PushNotificationSettings |
| 2 | `NullDomainEventDispatcher` | MMCA.Common.Infrastructure | 2 | IDomainEvent, IDomainEventDispatcher |
| 2 | `OutboxSettings` | MMCA.Common.Infrastructure | 2 | DataSource, DataSourceKey |
| 2 | `OwnedDependents` | MMCA.Common.Infrastructure | 1 | State |
| 2 | `QueryTags` | MMCA.Common.Infrastructure | 1 | QueryTagScope |
| 2 | `RedisDistributedLock` | MMCA.Common.Infrastructure | 3 | CacheKeyNamespace, IDistributedLock, RedisLockHandle |
| 2 | `SmtpEmailSender` | MMCA.Common.Infrastructure | 3 | IEmailSender, SmtpSettings, SmtpTransportSecurity |
| 2 | `Snapshot` | MMCA.Common.Infrastructure | 1 | DataSourceKey |
| 2 | `TenancySettings` | MMCA.Common.Infrastructure | 2 | TenantEntrySettings, TenantResolutionStrategy |
| 2 | `TenantDataSourceTarget` | MMCA.Common.Infrastructure | 1 | DataSourceKey |
| 2 | `TokenService` | MMCA.Common.Infrastructure | 6 | AuthClaimTypes, IPermissionRegistry, ITokenService, JwksSettings, JwtSettings, JwtSigningAlgorithm |
| 2 | `TotpTwoFactorService` | MMCA.Common.Infrastructure | 3 | ITwoFactorService, RecoveryCodeSet, TwoFactorSettings |
| 2 | `PgThingCreated` | MMCA.Common.Infrastructure.PostgreSQL.Tests | 1 | BaseDomainEvent |
| 2 | `PgThingShipped` | MMCA.Common.Infrastructure.PostgreSQL.Tests | 2 | BaseDomainEvent, IIntegrationEvent |
| 2 | `RecordingDomainEventDispatcher` | MMCA.Common.Infrastructure.PostgreSQL.Tests | 2 | IDomainEvent, IDomainEventDispatcher |
| 2 | `RecordingDomainEventDispatcher` | MMCA.Common.Infrastructure.SQLServer.Tests | 2 | IDomainEvent, IDomainEventDispatcher |
| 2 | `SqlThingShipped` | MMCA.Common.Infrastructure.SQLServer.Tests | 2 | BaseDomainEvent, IIntegrationEvent |
| 2 | `ApplicationNamespaceTests` | MMCA.Common.Infrastructure.Tests | 3 | ApplicationNamespace, CacheKeyNamespace, CacheKeyPrefixOptions |
| 2 | `CacheSettingsTests` | MMCA.Common.Infrastructure.Tests | 3 | CacheOptions, CacheSettings, QueryCachePipelineSettings |
| 2 | `DefaultEntityConfigurationAssemblyProviderTests` | MMCA.Common.Infrastructure.Tests | 2 | DefaultEntityConfigurationAssemblyProvider, EntityConfigurationOptions |
| 2 | `EfCoreConcurrencyConflictDetectorTests` | MMCA.Common.Infrastructure.Tests | 1 | EfCoreConcurrencyConflictDetector |
| 2 | `EFQueryableExecutorTests` | MMCA.Common.Infrastructure.Tests | 2 | EFQueryableExecutor, TestItem |
| 2 | `ExclusionEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `InboxDisabledWarningServiceTests` | MMCA.Common.Infrastructure.Tests | 2 | InboxDisabledWarningService, RecordingLogger |
| 2 | `InProcessDistributedLockTests` | MMCA.Common.Infrastructure.Tests | 1 | InProcessDistributedLock |
| 2 | `IntegrityEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `JwtSettingsTests` | MMCA.Common.Infrastructure.Tests | 2 | JwtSettings, JwtSigningAlgorithm |
| 2 | `MessageBusSettingsTests` | MMCA.Common.Infrastructure.Tests | 2 | MessageBusProvider, MessageBusSettings |
| 2 | `NamedDomainEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `NullLiveChannelPublisherTests` | MMCA.Common.Infrastructure.Tests | 1 | NullLiveChannelPublisher |
| 2 | `NullPushNotificationSenderTests` | MMCA.Common.Infrastructure.Tests | 1 | NullPushNotificationSender |
| 2 | `OrderedDomainEvent` | MMCA.Common.Infrastructure.Tests | 2 | BaseDomainEvent, IHasOrderingKey |
| 2 | `OutboxSignalTests` | MMCA.Common.Infrastructure.Tests | 1 | OutboxSignal |
| 2 | `PasswordHasherSecurityTests` | MMCA.Common.Infrastructure.Tests | 1 | PasswordHasher |
| 2 | `PasswordHasherTests` | MMCA.Common.Infrastructure.Tests | 1 | PasswordHasher |
| 2 | `PeriodicBackgroundServiceTests` | MMCA.Common.Infrastructure.Tests | 2 | CountingSweep, FakeTimeProvider |
| 2 | `PushNotificationSettingsTests` | MMCA.Common.Infrastructure.Tests | 1 | PushNotificationSettings |
| 2 | `RsaJwksProviderTests` | MMCA.Common.Infrastructure.Tests | 2 | JwksSettings, RsaJwksProvider |
| 2 | `SensitiveDataLoggingGateTests` | MMCA.Common.Infrastructure.Tests | 3 | PersistenceSettings, SensitiveDataLoggingGate, StubHostEnvironment |
| 2 | `ServiceBusEmulatorSupportTests` | MMCA.Common.Infrastructure.Tests | 3 | MessageBusProvider, MessageBusSettings, ServiceBusEmulatorSupport |
| 2 | `SmtpTransportSecurityTests` | MMCA.Common.Infrastructure.Tests | 2 | SmtpSettings, SmtpTransportSecurity |
| 2 | `SqlServerUniqueConstraintViolationDetectorTests` | MMCA.Common.Infrastructure.Tests | 1 | SqlServerUniqueConstraintViolationDetector |
| 2 | `TenantOnlyThing` | MMCA.Common.Infrastructure.Tests | 2 | BaseEntity<TIdentifierType>, ITenantEntity |
| 2 | `TestableDbSeeder` | MMCA.Common.Infrastructure.Tests | 1 | DbSeeder |
| 2 | `TestDomainEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `TestDomainEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `TestDomainEventWithData` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `TestIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 2 | BaseDomainEvent, IIntegrationEvent |
| 2 | `TestIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 1 | IIntegrationEvent |
| 2 | `TestLocalEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `TestLocalEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseDomainEvent |
| 2 | `TestOrderedEvent` | MMCA.Common.Infrastructure.Tests | 3 | BaseDomainEvent, IHasOrderingKey, IIntegrationEvent |
| 2 | `TypedServiceClientRegistrationTests` | MMCA.Common.Infrastructure.Tests | 2 | FakeContract, IFakeContract |
| 2 | `UseDataSourceAttributeTests` | MMCA.Common.Infrastructure.Tests | 2 | DataSource, UseDataSourceAttribute |
| 2 | `Measured` | MMCA.Common.LoadTests | 1 | PagedCollectionResult<T> |
| 2 | `ErrorTypeSeverity` | MMCA.Common.Shared | 2 | Error, ErrorType |
| 2 | `FeatureFlagRegistry` | MMCA.Common.Shared | 2 | FeatureFlagAttribute, FeatureFlagDescriptor |
| 2 | `IStronglyTypedId<TSelf, TValue>` | MMCA.Common.Shared | 1 | StronglyTypedId |
| 2 | `PermissionRegistryBuilder` | MMCA.Common.Shared | 1 | PermissionRegistry |
| 2 | `Result` | MMCA.Common.Shared | 2 | Error, ResultJsonConverterFactory |
| 2 | `ResultConverter` | MMCA.Common.Shared | 2 | Error, Result |
| 2 | `ResultJsonConverterFactory` | MMCA.Common.Shared | 3 | PropertyReader, Result, ResultConverter |
| 2 | `StronglyTypedId` | MMCA.Common.Shared | 2 | IStronglyTypedId<TSelf, TValue>, StronglyTypedIdValueParser<TValue> |
| 2 | `CollectionResultTests` | MMCA.Common.Shared.Tests | 3 | CollectionResult<T>, PagedCollectionResult<T>, PaginationMetadata |
| 2 | `DomainExceptionTests` | MMCA.Common.Shared.Tests | 3 | ConcreteDomainException, DomainException, DomainInvariantViolationException |
| 2 | `ErrorTests` | MMCA.Common.Shared.Tests | 2 | Error, ErrorType |
| 2 | `IcsCalendarBuilderTests` | MMCA.Common.Shared.Tests | 2 | IcsCalendarBuilder, IcsEvent |
| 2 | `KeyedSemaphoreStripeTests` | MMCA.Common.Shared.Tests | 1 | KeyedSemaphoreStripe |
| 2 | `KeysetPaginationTests` | MMCA.Common.Shared.Tests | 4 | CollectionResult<T>, KeysetCollectionResult<T>, KeysetCursor, KeysetPageRequest |
| 2 | `CrossServiceHostIsolation` | MMCA.Common.Testing | 4 | DefaultEntityConfigurationAssemblyProvider, EntityConfigurationOptions, HostScopedAssemblyProvider, IEntityConfigurationAssemblyProvider |
| 2 | `OpenApiContractTestsBase<TFixture>` | MMCA.Common.Testing | 2 | IIntegrationTestFixture, IntegrationTestBase<TFixture> |
| 2 | `ProblemDetailsContractTestsBase<TFixture>` | MMCA.Common.Testing | 2 | IIntegrationTestFixture, IntegrationTestBase<TFixture> |
| 2 | `ServiceInfoVersioningContractTestsBase<TFixture>` | MMCA.Common.Testing | 2 | IIntegrationTestFixture, IntegrationTestBase<TFixture> |
| 2 | `SqlServerIntegrationTestFixtureBase<TEntryPoint>` | MMCA.Common.Testing | 2 | CrossServiceFixtureBase, IIntegrationTestFixture |
| 2 | `IArchitectureMap` | MMCA.Common.Testing.Architecture | 2 | Layer, LayerRef |
| 2 | `AppHostFixtureBase` | MMCA.Common.Testing.Aspire | 4 | AppHostEnvironmentGate, AppHostEnvironmentRequirement, AppHostReadinessBudget, EphemeralRsaKeyPair |
| 2 | `AppHostEnvironmentGateTests` | MMCA.Common.Testing.Aspire.Tests | 2 | AppHostEnvironmentGate, AppHostEnvironmentRequirement |
| 2 | `AppHostProbePathsTests` | MMCA.Common.Testing.Aspire.Tests | 2 | AppHostProbePaths, JwksEndpointExtensions |
| 2 | `E2ETestCollection` | MMCA.Common.Testing.E2E | 1 | PlaywrightFixture |
| 2 | `PageExtensions` | MMCA.Common.Testing.E2E | 2 | AccessibilityViolationException, State |
| 2 | `WebVitalsCollector` | MMCA.Common.Testing.E2E | 2 | WebVitalsArtifact, WebVitalsSample |
| 2 | `CrossServiceHostIsolationTests` | MMCA.Common.Testing.Tests | 5 | CrossServiceFixtureBase, DefaultEntityConfigurationAssemblyProvider, EntityConfigurationOptions, FixedProvider, IEntityConfigurationAssemblyProvider |
| 2 | `DependencyInjectionAssertTests` | MMCA.Common.Testing.Tests | 3 | DependencyInjectionAssert, ISampleService, SampleService |
| 2 | `FakeCrossServiceFixture` | MMCA.Common.Testing.Tests | 2 | CrossServiceDataSource, CrossServiceFixtureBase |
| 2 | `OverridingFixture` | MMCA.Common.Testing.Tests | 1 | ProbeFixture |
| 2 | `RecordingHttpForwarderTests` | MMCA.Common.Testing.Tests | 2 | RecordingHttpForwarder, StampingTransformer |
| 2 | `BunitComponentTestBase` | MMCA.Common.Testing.UI | 5 | ListPageQueryStateService, ListPageStateService, MudProviderHandles, MutableAuthenticationStateProvider, ViewerTimeZone |
| 2 | `UiHttpServiceHarness` | MMCA.Common.Testing.UI | 3 | CapturingHttpMessageHandler, FreshApiClientFactory, StubTokenStorageService |
| 2 | `ApiUserPreferenceReader` | MMCA.Common.UI | 4 | ITokenStorageService, IUserPreferenceReader, JwtTokenInfo, UserPreferences |
| 2 | `AppLifecycleNotifier` | MMCA.Common.UI | 2 | AppResumedEventArgs, IAppLifecycleNotifier |
| 2 | `BrowserAccessibilityAnnouncer` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IAccessibilityAnnouncer |
| 2 | `BrowserClipboardService` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IClipboardService |
| 2 | `BrowserConnectivityStatusService` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IConnectivityStatusService |
| 2 | `BrowserDevicePreferences` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IDevicePreferences |
| 2 | `BrowserExternalLinkService` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IExternalLinkService |
| 2 | `BrowserLocalCacheStore` | MMCA.Common.UI | 2 | CapabilitiesJsModule, ILocalCacheStore |
| 2 | `BrowserShareService` | MMCA.Common.UI | 2 | CapabilitiesJsModule, IShareService |
| 2 | `ChannelSubscription` | MMCA.Common.UI | 1 | NotificationHubService |
| 2 | `DirectApiTokenRefresher` | MMCA.Common.UI | 6 | AuthDelegatingHandler, AuthenticationResponse, ISecureTokenStore, ISessionAwareTokenRefresher, RefreshTokenRequest, TokenAcquisition |
| 2 | `ForgotPasswordModel` | MMCA.Common.UI | 1 | AuthFieldMessages |
| 2 | `IDeepLinkDispatcher` | MMCA.Common.UI | 1 | DeepLinkRouteEventArgs |
| 2 | `IdempotentReadRetry` | MMCA.Common.UI | 1 | AuthenticatedServiceBase |
| 2 | `IUIModule` | MMCA.Common.UI | 1 | NavItem |
| 2 | `LocalizedDataAnnotationsValidator` | MMCA.Common.UI | 2 | DataAnnotationsModelValidator, SharedResource |
| 2 | `LoginModel` | MMCA.Common.UI | 1 | AuthFieldMessages |
| 2 | `MmcaClientConfigBootstrap` | MMCA.Common.UI | 1 | ApiSettings |
| 2 | `MMCATheme` | MMCA.Common.UI | 2 | BrandColors, Error |
| 2 | `ModelValidation` | MMCA.Common.UI | 2 | DataAnnotationsModelValidator, IModelValidator |
| 2 | `MudToastService` | MMCA.Common.UI | 2 | IToastService, ToastSeverity |
| 2 | `NotificationHubService` | MMCA.Common.UI | 6 | ApiSettings, ChannelReferenceCounter, ChannelSubscription, ITokenStorageService, State, UnboundedReconnectPolicy |
| 2 | `NullGeocodingService` | MMCA.Common.UI | 2 | GeoPoint, IGeocodingService |
| 2 | `NullGeolocationService` | MMCA.Common.UI | 2 | GeoPoint, IGeolocationService |
| 2 | `NullLocalNotificationService` | MMCA.Common.UI | 2 | ILocalNotificationService, LocalNotificationRequest |
| 2 | `NullMediaPickerService` | MMCA.Common.UI | 2 | IMediaPickerService, PickedMedia |
| 2 | `NullPushDeviceTokenProvider` | MMCA.Common.UI | 2 | IPushDeviceTokenProvider, PushDeviceToken |
| 2 | `PseudoStringLocalizerFactory` | MMCA.Common.UI | 1 | PseudoStringLocalizer |
| 2 | `RegisterModel` | MMCA.Common.UI | 2 | AuthFieldMessages, PasswordComplexity |
| 2 | `ResetPasswordModel` | MMCA.Common.UI | 2 | AuthFieldMessages, PasswordComplexity |
| 2 | `SameOriginProxyTokenRefresher` | MMCA.Common.UI | 2 | ISessionAwareTokenRefresher, TokenAcquisition |
| 2 | `WasmTokenStorageService` | MMCA.Common.UI | 5 | ISessionAwareTokenRefresher, ISessionCookieSync, ITokenRefresher, ITokenStorageService, JwtTokenInfo |
| 2 | `AuthOutcomeRulesTests` | MMCA.Common.UI.E2E.Tests | 2 | AuthOutcome, AuthOutcomeRules |
| 2 | `WebVitalsBudgetTests` | MMCA.Common.UI.E2E.Tests | 2 | WebVitalsBudget, WebVitalsSample |
| 2 | `MainPageBase` | MMCA.Common.UI.Maui | 2 | MauiBackNavigationBridge, MauiThemeStore |
| 2 | `MauiCultureApplier` | MMCA.Common.UI.Maui | 3 | ICultureApplier, MauiCultureStore, SupportedCultures |
| 2 | `MauiCultureInitializer` | MMCA.Common.UI.Maui | 1 | MauiCultureStore |
| 2 | `MauiExternalAuthBroker` | MMCA.Common.UI.Maui | 3 | ApiSettings, IExternalAuthBroker, OAuthFlowStateStore |
| 2 | `MauiGeocodingService` | MMCA.Common.UI.Maui | 2 | GeoPoint, IGeocodingService |
| 2 | `MauiGeolocationService` | MMCA.Common.UI.Maui | 2 | GeoPoint, IGeolocationService |
| 2 | `MauiLocalNotificationService` | MMCA.Common.UI.Maui | 2 | ILocalNotificationService, LocalNotificationRequest |
| 2 | `MauiMediaPickerService` | MMCA.Common.UI.Maui | 2 | IMediaPickerService, PickedMedia |
| 2 | `MauiPushRegistrationService` | MMCA.Common.UI.Maui | 3 | IDevicePreferences, IPushDeviceTokenProvider, IPushRegistrationService |
| 2 | `WindowLifecycleExtensions` | MMCA.Common.UI.Maui | 1 | IAppLifecycleNotifier |
| 2 | `AbsoluteUrlAttributeTests` | MMCA.Common.UI.Tests | 4 | BareUrlModel, DataAnnotationsModelValidator, StubLocalizer, UrlModel |
| 2 | `ApiClientRegistrationTests` | MMCA.Common.UI.Tests | 4 | ApiSettings, HttpResilienceDefaults, ITokenStorageService, StubTokenStorageService |
| 2 | `ApiUserPreferenceWriterTests` | MMCA.Common.UI.Tests | 5 | ApiUserPreferenceWriter, ITokenStorageService, Jwt, StubHttpClientFactory, StubHttpMessageHandler |
| 2 | `AuthDelegatingHandlerTests` | MMCA.Common.UI.Tests | 3 | AuthDelegatingHandler, ITokenStorageService, StubHttpMessageHandler |
| 2 | `AuthenticatedServiceBaseRetryTests` | MMCA.Common.UI.Tests | 2 | AuthenticatedServiceBase, TrackingHttpResponseMessage |
| 2 | `BrowserMapNavigationServiceTests` | MMCA.Common.UI.Tests | 2 | BrowserMapNavigationService, IExternalLinkService |
| 2 | `CapturingHttpMessageHandlerTests` | MMCA.Common.UI.Tests | 1 | CapturingHttpMessageHandler |
| 2 | `ErrorMessagesTests` | MMCA.Common.UI.Tests | 2 | DomainInvariantViolationException, ErrorMessages |
| 2 | `InvariantMudLocalizationInterceptorTests` | MMCA.Common.UI.Tests | 1 | InvariantMudLocalizationInterceptor |
| 2 | `JsFetchSessionCookieSyncTests` | MMCA.Common.UI.Tests | 1 | JsFetchSessionCookieSync |
| 2 | `JwtAuthenticationStateProviderTests` | MMCA.Common.UI.Tests | 2 | ITokenStorageService, JwtAuthenticationStateProvider |
| 2 | `ListPageQueryStateServiceTests` | MMCA.Common.UI.Tests | 3 | ListPageQueryStateService, ListPageState, RecordingNavigationManager |
| 2 | `ListPageStateServiceTests` | MMCA.Common.UI.Tests | 2 | ListPageState, ListPageStateService |
| 2 | `MauiBackNavigationBridgeTests` | MMCA.Common.UI.Tests | 2 | BackNavigationResult, MauiBackNavigationBridge |
| 2 | `MmcaCultureBootstrapTests` | MMCA.Common.UI.Tests | 3 | CultureMutatingCollection, MmcaCultureBootstrap, SupportedCultures |
| 2 | `Mocks` | MMCA.Common.UI.Tests | 2 | StubHttpClientFactory, StubHttpMessageHandler |
| 2 | `Mocks` | MMCA.Common.UI.Tests | 5 | ISecureTokenStore, ISessionCookieSync, ITokenRefresher, StubHttpClientFactory, StubHttpMessageHandler |
| 2 | `Mocks` | MMCA.Common.UI.Tests | 2 | StubHttpClientFactory, StubHttpMessageHandler |
| 2 | `OAuthFlowStateStoreTests` | MMCA.Common.UI.Tests | 4 | DroppingCacheStore, FakeCacheStore, FakeTimeProvider, OAuthFlowStateStore |
| 2 | `OfflineFirstPageSnapshotTests` | MMCA.Common.UI.Tests | 4 | FakeConnectivity, FakeLocalCacheStore, ILocalCacheStore, OfflineFirstPageSnapshot<TItem> |
| 2 | `PolicyProbe` | MMCA.Common.UI.Tests | 2 | AuthenticatedServiceBase, ITokenStorageService |
| 2 | `ProbePage` | MMCA.Common.UI.Tests | 2 | DetailPageBase, LatestLoadGuard |
| 2 | `StubTokenStorageServiceTests` | MMCA.Common.UI.Tests | 1 | StubTokenStorageService |
| 2 | `ToastConsumer` | MMCA.Common.UI.Tests | 1 | IToastService |
| 2 | `TokenHydrationWarmupTests` | MMCA.Common.UI.Tests | 2 | ITokenStorageService, TokenHydrationWarmup |
| 2 | `UiReadCacheTests` | MMCA.Common.UI.Tests | 3 | FakeTimeProvider, UiReadCache, UiReadCacheOptions |
| 2 | `WasmFormFactorTests` | MMCA.Common.UI.Tests | 2 | IFormFactor, WasmFormFactor |
| 2 | `BlazorCircuitLimitExtensions` | MMCA.Common.UI.Web | 2 | BlazorCircuitLimitSettings, BoundedCircuitHandler |
| 2 | `BlazorCspPolicyProvider` | MMCA.Common.UI.Web | 5 | ApiSettings, BlazorCspSettings, BlazorCspSettingsValidator, CspPolicy, ICspPolicyProvider |
| 2 | `ClientConfigBuilder` | MMCA.Common.UI.Web | 1 | ClientConfigEndpointExtensions |
| 2 | `ClientConfigEndpointExtensions` | MMCA.Common.UI.Web | 4 | ApiSettings, ClientConfigBuilder, SameOriginApiProxyMarker, SameOriginApiProxySettings |
| 2 | `HandoffSessionCookieSync` | MMCA.Common.UI.Web | 2 | ISessionCookieSync, SessionHandoffProtector |
| 2 | `HandoffTokenRefresher` | MMCA.Common.UI.Web | 3 | ISessionAwareTokenRefresher, SessionHandoffProtector, TokenAcquisition |
| 2 | `BlazorCspPolicyProviderTests` | MMCA.Common.UI.Web.Tests | 4 | ApiSettings, BlazorCspSettings, CspPolicy, ICspPolicyProvider |
| 2 | `TrustedCallerHandlerTests` | MMCA.Common.UI.Web.Tests | 2 | CapturingHandler, TrustedCallerHandler |
| 2 | `TrustedCallerHeaderRegistrationTests` | MMCA.Common.UI.Web.Tests | 1 | CapturingHandler |
| 2 | `TrustedCallerServiceDiscoveryTests` | MMCA.Common.UI.Web.Tests | 2 | CapturingHandler, SentRequest |
| 2 | `UiRateLimitingTests` | MMCA.Common.UI.Web.Tests | 2 | UiRateLimitingExtensions, UiRateLimitingSettings |
| 3 | `ISessionAssetAccessService` | MMCA.ADC.Conference.Application | 1 | Result |
| 3 | `ISessionizeService` | MMCA.ADC.Conference.Application | 2 | Result, SessionizeResponse |
| 3 | `ISessionScoringRunner` | MMCA.ADC.Conference.Application | 2 | Result, ScoreEventSessionsResultDTO |
| 3 | `SessionizeSyncWarnings` | MMCA.ADC.Conference.Application | 1 | Result |
| 3 | `UpdateEventResult` | MMCA.ADC.Conference.Application | 1 | EventDTO |
| 3 | `UpdateSessionResult` | MMCA.ADC.Conference.Application | 1 | SessionDTO |
| 3 | `RecordingEventBus` | MMCA.ADC.Conference.Application.Tests | 2 | IEventBus, IIntegrationEvent |
| 3 | `ActivityChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `CategoryChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `EventChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `PartnerChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `QuestionChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `SessionAssetChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `SessionChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `SpeakerChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `SponsorChanged` | MMCA.ADC.Conference.Domain | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `SessionScoringService` | MMCA.ADC.Conference.Infrastructure | 7 | AiScoreResponse, ChatGuardrailException, IAiScoringService, PromptContract, SessionScoringInput, SessionScoringResult, SpeakerInfo |
| 3 | `FakeAiScoringService` | MMCA.ADC.Conference.IntegrationTests | 3 | IAiScoringService, SessionScoringInput, SessionScoringResult |
| 3 | `GoldenCorpus` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 1 | GoldenCase |
| 3 | `ConferencePermissionGrants` | MMCA.ADC.Conference.Shared | 3 | ConferencePermissions, PermissionRegistryBuilder, RoleNames |
| 3 | `EventFeedbackSubmitted` | MMCA.ADC.Conference.Shared | 1 | BaseIntegrationEvent |
| 3 | `IEventLiveValidationService` | MMCA.ADC.Conference.Shared | 5 | EventLiveInfo, Result, RoomSessionInfo, SessionLiveInfo, SponsorLiveInfo |
| 3 | `ISessionBookmarkValidationService` | MMCA.ADC.Conference.Shared | 1 | Result |
| 3 | `SessionCalendarExport` | MMCA.ADC.Conference.Shared | 2 | SessionDTO, SessionStatuses |
| 3 | `SessionFeedbackSubmitted` | MMCA.ADC.Conference.Shared | 1 | BaseIntegrationEvent |
| 3 | `SessionSelectionDashboardDTO` | MMCA.ADC.Conference.Shared | 4 | CategoryDistributionDTO, SessionAiScoreDTO, SpeakerLocalitySummary, SpeakerSessionOverlapDTO |
| 3 | `SpeakerLinkedToUser` | MMCA.ADC.Conference.Shared | 1 | BaseIntegrationEvent |
| 3 | `SpeakerUnlinkedFromUser` | MMCA.ADC.Conference.Shared | 1 | BaseIntegrationEvent |
| 3 | `ConferenceCategoryDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | ConferenceCategoryDTO |
| 3 | `EventDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | EventDTO |
| 3 | `SessionDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SessionDTO |
| 3 | `SpeakerDTOTests` | MMCA.ADC.Conference.Shared.Tests | 1 | SpeakerDTO |
| 3 | `ActivityCreateModel` | MMCA.ADC.Conference.UI | 2 | ActivityDTO, ActivityFormModel |
| 3 | `ActivityEditModel` | MMCA.ADC.Conference.UI | 2 | ActivityDTO, ActivityFormModel |
| 3 | `ConferenceCategoryFormModel` | MMCA.ADC.Conference.UI | 1 | ConferenceCategoryDTO |
| 3 | `ConferenceUIModule` | MMCA.ADC.Conference.UI | 5 | ConferenceRoutePaths, IUIModule, NavItem, NavSection, RoleNames |
| 3 | `EventFormModel` | MMCA.ADC.Conference.UI | 2 | EventDTO, QuestionModerationDefault |
| 3 | `ICategoryItemLookupService` | MMCA.ADC.Conference.UI | 2 | CategoryItemInfo, Result |
| 3 | `IEventLookupService` | MMCA.ADC.Conference.UI | 2 | EventInfo, Result |
| 3 | `IEventSpeakerUIService` | MMCA.ADC.Conference.UI | 2 | EventSpeakerDTO, Result |
| 3 | `IOrganizerEventFeedbackUIService` | MMCA.ADC.Conference.UI | 2 | EventQuestionAnswerDTO, Result |
| 3 | `IOrganizerSessionFeedbackUIService` | MMCA.ADC.Conference.UI | 2 | Result, SessionQuestionAnswerDTO |
| 3 | `IPublicSessionScheduleService` | MMCA.ADC.Conference.UI | 3 | Result, SessionDTO, SessionSchedulePageRequest |
| 3 | `ISessionAssetUIService` | MMCA.ADC.Conference.UI | 4 | Result, SessionAssetDTO, SessionAssetLinkRequest, SessionAssetUpdateRequest |
| 3 | `ISessionCategoryItemUIService` | MMCA.ADC.Conference.UI | 2 | Result, SessionCategoryItemDTO |
| 3 | `ISessionSpeakerUIService` | MMCA.ADC.Conference.UI | 2 | Result, SessionSpeakerDTO |
| 3 | `ISpeakerCategoryItemUIService` | MMCA.ADC.Conference.UI | 2 | Result, SpeakerCategoryItemDTO |
| 3 | `ISpeakerDashboardUIService` | MMCA.ADC.Conference.UI | 3 | Result, SessionDTO, SessionFeedbackDTO |
| 3 | `ISpeakerDetailLookupService` | MMCA.ADC.Conference.UI | 2 | Result, SpeakerDetailLookups |
| 3 | `ISpeakerLookupService` | MMCA.ADC.Conference.UI | 2 | Result, SpeakerInfo |
| 3 | `PartnerCreateModel` | MMCA.ADC.Conference.UI | 3 | PartnerDTO, PartnerFormModel, PartnerType |
| 3 | `PartnerEditModel` | MMCA.ADC.Conference.UI | 3 | PartnerDTO, PartnerFormModel, PartnerType |
| 3 | `PublicScheduleRoomOptions` | MMCA.ADC.Conference.UI | 2 | EventDTO, RoomDTO |
| 3 | `PublicSessionListFilterBar` | MMCA.ADC.Conference.UI | 5 | EventDTO, IScreenshotService, IShareService, IToastService, RoomDTO |
| 3 | `QuestionCreateModel` | MMCA.ADC.Conference.UI | 2 | QuestionDTO, QuestionFormModel |
| 3 | `QuestionEditModel` | MMCA.ADC.Conference.UI | 2 | QuestionDTO, QuestionFormModel |
| 3 | `RoomCreateModel` | MMCA.ADC.Conference.UI | 2 | RoomDTO, RoomFormModel |
| 3 | `RoomEditModel` | MMCA.ADC.Conference.UI | 2 | RoomDTO, RoomFormModel |
| 3 | `SessionFormModel` | MMCA.ADC.Conference.UI | 1 | SessionDTO |
| 3 | `SessionizeRefreshOutcome` | MMCA.ADC.Conference.UI | 2 | EventDTO, RefreshFromSessionizeResultDTO |
| 3 | `SpeakerFormModel` | MMCA.ADC.Conference.UI | 1 | SpeakerDTO |
| 3 | `SponsorCreateModel` | MMCA.ADC.Conference.UI | 2 | SponsorDTO, SponsorFormModel |
| 3 | `SponsorEditModel` | MMCA.ADC.Conference.UI | 2 | SponsorDTO, SponsorFormModel |
| 3 | `PublicReadAudienceTests` | MMCA.ADC.Conference.UI.Tests | 3 | ConferenceReadAudience, PublicReadAudience, RoleNames |
| 3 | `E2ETestCollection` | MMCA.ADC.E2E.Tests | 2 | E2ETestCollection, PlaywrightFixture |
| 3 | `IPointsAwarder` | MMCA.ADC.Engagement.Application | 2 | PointsActivityType, Result |
| 3 | `LivePollAuthorization` | MMCA.ADC.Engagement.Application | 3 | Error, Result, SessionLiveInfo |
| 3 | `UserSessionBookmarkCacheEvictionHandler` | MMCA.ADC.Engagement.Application | 3 | BookmarkCacheEvictionSignal, IDomainEventHandler<in TDomainEvent>, UserSessionBookmarkChanged |
| 3 | `CheckInAttendeeRequestValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 3 | CheckInAttendeeRequest, CheckInAttendeeRequestValidator, CheckInScope |
| 3 | `LiveChannelPublishQueueTests` | MMCA.ADC.Engagement.Application.Tests | 2 | LiveChannelPublishQueue, LiveChannelPublishWorkItem |
| 3 | `ManualCheckInRequestValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 3 | CheckInScope, ManualCheckInRequest, ManualCheckInRequestValidator |
| 3 | `LiveChannelPublishProcessor` | MMCA.ADC.Engagement.Infrastructure | 4 | BestEffort, ILiveChannelPublisher, LiveChannelPublishQueue, LiveChannelPublishWorkItem |
| 3 | `RecordingEventBus` | MMCA.ADC.Engagement.Infrastructure.Tests | 2 | IEventBus, IIntegrationEvent |
| 3 | `AttendeeCheckedIn` | MMCA.ADC.Engagement.Shared | 1 | BaseIntegrationEvent |
| 3 | `EngagementPermissionGrants` | MMCA.ADC.Engagement.Shared | 3 | EngagementPermissions, PermissionRegistryBuilder, RoleNames |
| 3 | `ISessionBookmarkUIService` | MMCA.ADC.Engagement.Shared | 2 | Result, UserSessionBookmarkDTO |
| 3 | `IUserEngagementExportService` | MMCA.ADC.Engagement.Shared | 1 | UserEngagementExportDTO |
| 3 | `IBookmarkUIService` | MMCA.ADC.Engagement.UI | 3 | CreateBookmarkRequest, Result, UserSessionBookmarkDTO |
| 3 | `ICheckInUIService` | MMCA.ADC.Engagement.UI | 9 | AttendanceStatsDTO, CheckInAttendeeRequest, CheckInResultDTO, ManualCheckInRequest, MyBadgeDTO, Result, RoomCheckInResultDTO, SelfCheckInOutcome<TResult>, SponsorVisitResultDTO |
| 3 | `IEventFeedbackUIService` | MMCA.ADC.Engagement.UI | 2 | EventQuestionAnswerDTO, Result |
| 3 | `ILivePollUIService` | MMCA.ADC.Engagement.UI | 4 | CreateLivePollRequest, LivePollDTO, LivePollResultsDTO, Result |
| 3 | `INowNextService` | MMCA.ADC.Engagement.UI | 2 | NowNextSnapshot, Result |
| 3 | `IPointsUIService` | MMCA.ADC.Engagement.UI | 4 | LeaderboardEntryDTO, MyPointsDTO, PointsOverviewDTO, Result |
| 3 | `IQuestionLookupService` | MMCA.ADC.Engagement.UI | 2 | QuestionDTO, Result |
| 3 | `ISessionFeedbackUIService` | MMCA.ADC.Engagement.UI | 2 | Result, SessionQuestionAnswerDTO |
| 3 | `ISessionLookupService` | MMCA.ADC.Engagement.UI | 2 | Result, SessionInfo |
| 3 | `ISessionQuestionUIService` | MMCA.ADC.Engagement.UI | 3 | Result, SessionQuestionDTO, SubmitQuestionRequest |
| 3 | `LiveChannelSubscription` | MMCA.ADC.Engagement.UI | 1 | NotificationHubService |
| 3 | `CurrentEventNotificationScopeProviderTests` | MMCA.ADC.Engagement.UI.Tests | 4 | CurrentEventNotificationScopeProvider, FakeTimeProvider, ILiveEventUIService, LiveEventContext |
| 3 | `IdentityModuleTests` | MMCA.ADC.Identity.API.Tests | 2 | IdentityModule, ModuleConformanceTestsBase<TModule> |
| 3 | `NotificationUserDataExportSection` | MMCA.ADC.Identity.Application | 5 | IUserDataExportSection, IUserNotificationExportService, UserDataExportNotificationDTO, UserDataExportNotificationSectionDTO, UserDataExportSectionResult |
| 3 | `ChangePasswordRequestValidatorTests` | MMCA.ADC.Identity.Application.Tests | 2 | ChangePasswordRequest, ChangePasswordRequestValidator |
| 3 | `ThrowingExportSection` | MMCA.ADC.Identity.Application.Tests | 2 | IUserDataExportSection, UserDataExportSectionResult |
| 3 | `IdentityPermissionGrants` | MMCA.ADC.Identity.Shared | 3 | IdentityPermissions, PermissionRegistryBuilder, RoleNames |
| 3 | `UserDeleted` | MMCA.ADC.Identity.Shared | 1 | BaseIntegrationEvent |
| 3 | `UserRegistered` | MMCA.ADC.Identity.Shared | 1 | BaseIntegrationEvent |
| 3 | `IUserUIService` | MMCA.ADC.Identity.UI | 2 | Result, UserListDTO |
| 3 | `BunitTestBase` | MMCA.ADC.Identity.UI.Tests | 1 | BunitComponentTestBase |
| 3 | `NotificationModule` | MMCA.ADC.Notification.API | 4 | ApplicationSettings, DisabledUserNotificationExportService, IModule, IUserNotificationExportService |
| 3 | `NotificationPermissionGrants` | MMCA.ADC.Notification.Shared | 3 | NotificationPermissions, PermissionRegistryBuilder, RoleNames |
| 3 | `DeviceUIModule` | MMCA.ADC.UI | 3 | BiometricGate, IUIModule, NavItem |
| 3 | `MainPage` | MMCA.ADC.UI | 1 | MainPageBase |
| 3 | `PiiRedactionGuardrail` | MMCA.Common.AI | 4 | GuardrailVerdict, IChatGuardrail, IChatRequestRedactor, Result |
| 3 | `AnthropicAiServiceCollectionExtensions` | MMCA.Common.AI.Anthropic | 2 | AnthropicAiProviderFactory, IAiProviderFactory |
| 3 | `OpenAiServiceCollectionExtensions` | MMCA.Common.AI.OpenAI | 2 | IAiProviderFactory, OpenAiProviderFactory |
| 3 | `AdapterFactoryTests` | MMCA.Common.AI.Tests | 6 | AiSettings, AnthropicAiProviderFactory, BoundedChatClient, IAiProviderFactory, OpenAiProviderFactory, UsageRecordingChatClient |
| 3 | `AiServiceCollectionExtensionsTests` | MMCA.Common.AI.Tests | 7 | AiSettings, BoundedChatClient, GuardrailChatClient, IChatGuardrail, StubChatClient, StubGuardrail, UsageRecordingChatClient |
| 3 | `BoundedChatClientTests` | MMCA.Common.AI.Tests | 7 | AiSettings, BoundedChatClient, FixedTokenEstimator, PromptContract, StubChatClient, StubTool, StubToolPolicy |
| 3 | `ContentPolicyGuardrailTests` | MMCA.Common.AI.Tests | 3 | ContentPolicyGuardrail, ContentPolicyInjectionMode, ContentPolicySettings |
| 3 | `ContentPolicyRegistrationTests` | MMCA.Common.AI.Tests | 7 | ContentPolicyGuardrail, ContentPolicyInjectionMode, ContentPolicySettings, GuardrailChatClient, IChatGuardrail, IChatRequestRedactor, StubChatClient |
| 3 | `GuardrailChatClientTests` | MMCA.Common.AI.Tests | 5 | ChatGuardrailException, GuardrailChatClient, GuardrailVerdict, StubChatClient, StubGuardrail |
| 3 | `RecordedResponsesTests` | MMCA.Common.AI.Tests | 3 | PinHarness, PromptContract, RecordedResponses |
| 3 | `ReplayChatClientTests` | MMCA.Common.AI.Tests | 3 | EmptyCorpusHarness, MissingRecordingHarness, ReplayChatClient |
| 3 | `StreamedGuardrailTests` | MMCA.Common.AI.Tests | 6 | ChatGuardrailException, GuardrailChatClient, GuardrailVerdict, PreStreamingGuardrail, StubChatClient, StubGuardrail |
| 3 | `ToolPolicyTests` | MMCA.Common.AI.Tests | 8 | AiSettings, BoundedChatClient, ChatToolPolicy, IChatToolPolicy, StubChatClient, StubTool, StubToolPolicy, ToolAuthorization |
| 3 | `AuthorizationExtensions` | MMCA.Common.API | 9 | FallbackAuthorizationHandler, FallbackAuthorizationOptions, FallbackAuthorizationRequirement, IPermissionCatalog, IPermissionRegistry, PermissionAuthorizationHandler, PermissionPolicyProvider, PermissionRegistry, PermissionRegistryBuilder |
| 3 | `ErrorHttpMapping` | MMCA.Common.API | 4 | Error, ErrorType, ErrorTypeSeverity, IErrorLocalizer |
| 3 | `IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>` | MMCA.Common.API | 3 | IBaseDTO<TIdentifierType>, ICreateRequest, IEntityControllerBase<TEntityDTO, TIdentifierType> |
| 3 | `ModuleHostContext` | MMCA.Common.API | 3 | ApplicationSettings, ModuleLoader, ModulesSettings |
| 3 | `SignalRExtensions` | MMCA.Common.API | 2 | NotificationHub, PushNotificationSettings |
| 3 | `StronglyTypedIdSchemaTransformer` | MMCA.Common.API | 1 | StronglyTypedId |
| 3 | `TenantResolutionMiddleware` | MMCA.Common.API | 3 | ITenantContext, TenancySettings, TenantResolutionStrategy |
| 3 | `AddCommonOpenApiHostRegistrationTests` | MMCA.Common.API.Tests | 1 | HostRegistrationProbeFeatureProvider |
| 3 | `ApiVersionRejectionAuthorizationTests` | MMCA.Common.API.Tests | 4 | ApiVersionProbeController, HeaderAuthenticationHandler, ProbeControllerFeatureProvider, ProbeInvocationCounter |
| 3 | `BadHttpRequestExceptionHandlingTests` | MMCA.Common.API.Tests | 1 | RecordingLoggerProvider |
| 3 | `ModuleHostExtensionsTests` | MMCA.Common.API.Tests | 3 | ApplicationSettings, ModuleLoader, ModulesSettings |
| 3 | `OidcDiscoveryEndpointTests` | MMCA.Common.API.Tests | 2 | JwksEndpointExtensions, OidcDiscoveryEndpointExtensions |
| 3 | `PermissionAuthorizationHandlerTests` | MMCA.Common.API.Tests | 4 | AuthClaimTypes, PermissionAuthorizationHandler, PermissionRegistryBuilder, PermissionRequirement |
| 3 | `ProbeOrderId` | MMCA.Common.API.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `ProbeSkuId` | MMCA.Common.API.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `DomainEventDispatcher` | MMCA.Common.Application | 6 | IDomainEvent, IDomainEventDispatcher, IDomainEventHandler<in TDomainEvent>, IEventUpcasterRegistry, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent> |
| 3 | `EventUpcasterRegistry` | MMCA.Common.Application | 4 | IDomainEvent, IEventUpcaster, IEventUpcasterRegistry, IIntegrationEvent |
| 3 | `IAuthSessionIssuer` | MMCA.Common.Application | 4 | AuthenticationResponse, ITokenService, RefreshSessionSummaryResponse, Result |
| 3 | `ICacheService` | MMCA.Common.Application | 1 | CacheKeyLocks |
| 3 | `IEmailConfirmationTokenService` | MMCA.Common.Application | 1 | Result |
| 3 | `IFileStorageService` | MMCA.Common.Application | 2 | FileUploadOptions, Result |
| 3 | `IImageProcessor` | MMCA.Common.Application | 1 | Result |
| 3 | `IInternalCommand` | MMCA.Common.Application | 2 | ICommand<TResult>, Result |
| 3 | `IInternalCommandAdministration` | MMCA.Common.Application | 2 | InternalCommandDeadLetter, Result |
| 3 | `ILegalAcceptanceService` | MMCA.Common.Application | 2 | LegalAcceptanceDTO, Result |
| 3 | `ILoginProtectionService` | MMCA.Common.Application | 1 | Result |
| 3 | `IOutboxAdministration` | MMCA.Common.Application | 2 | OutboxDeadLetter, Result |
| 3 | `IPasswordResetTokenService` | MMCA.Common.Application | 1 | Result |
| 3 | `IPushDeviceRegistrar` | MMCA.Common.Application | 2 | DeviceInstallationRequest, Result |
| 3 | `IRoleAdministrationService` | MMCA.Common.Application | 3 | PermissionCatalogResponse, Result, RolePermissionsResponse |
| 3 | `ITwoFactorAuthenticator` | MMCA.Common.Application | 2 | Result, TwoFactorOutcome |
| 3 | `ITwoFactorStore` | MMCA.Common.Application | 2 | ITwoFactorUserState, Result |
| 3 | `IUserAdministrationService<TUserDto>` | MMCA.Common.Application | 3 | PagedCollectionResult<T>, Result, UserAdministrationQuery |
| 3 | `LegalAcceptancePolicy` | MMCA.Common.Application | 4 | LegalAcceptanceDTO, LegalAcceptanceErrors, LegalAcceptanceOptions, Result |
| 3 | `LoggingCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 6 | CqrsMetrics, ICommandHandler<in TCommand, TResult>, ICorrelationContext, ModuleNameConventions, QueryTagScope, Result |
| 3 | `LoggingQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 6 | CqrsMetrics, ICorrelationContext, IQueryHandler<in TQuery, TResult>, ModuleNameConventions, QueryTagScope, Result |
| 3 | `NavigationMetadata` | MMCA.Common.Application | 2 | INavigationMetadata, NavigationPropertyInfo |
| 3 | `QueryFieldService` | MMCA.Common.Application | 4 | Error, PropertyAccessor, QueryFieldContract, Result |
| 3 | `ResultFailureFactory` | MMCA.Common.Application | 2 | Error, Result |
| 3 | `ScopedIntegrationEventHandlerBase<TIntegrationEvent>` | MMCA.Common.Application | 2 | IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent> |
| 3 | `StronglyTypedIdFilterStrategy<TSelf, TValue>` | MMCA.Common.Application | 5 | DynamicQueryConfig, FilterValueParser, IFilterStrategy, IStronglyTypedId<TSelf, TValue>, StronglyTypedId |
| 3 | `AgreeingMarkedCommand` | MMCA.Common.Application.Tests | 2 | ICommand<TResult>, Result |
| 3 | `AgreeingMarkedQuery` | MMCA.Common.Application.Tests | 2 | IQuery<TResult>, Result |
| 3 | `CancellingSection` | MMCA.Common.Application.Tests | 2 | IUserDataExportSection, UserDataExportSectionResult |
| 3 | `CtorProbeCommandHandler` | MMCA.Common.Application.Tests | 3 | CtorProbeCommand, ICommandHandler<in TCommand, TResult>, Result |
| 3 | `CtorProbeQueryHandler` | MMCA.Common.Application.Tests | 3 | CtorProbeQuery, IQueryHandler<in TQuery, TResult>, Result |
| 3 | `CustomerRenamedV1` | MMCA.Common.Application.Tests | 1 | BaseIntegrationEvent |
| 3 | `CustomerRenamedV2` | MMCA.Common.Application.Tests | 1 | BaseIntegrationEvent |
| 3 | `CustomerRenamedV3` | MMCA.Common.Application.Tests | 1 | BaseIntegrationEvent |
| 3 | `DriftedMarkedCommand` | MMCA.Common.Application.Tests | 2 | ICommand<TResult>, Result |
| 3 | `LayeredPermissionRegistryTests` | MMCA.Common.Application.Tests | 4 | FakeGrantCache, LayeredPermissionRegistry, PermissionRegistry, PermissionRegistryBuilder |
| 3 | `MappedOrderId` | MMCA.Common.Application.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `ModuleLoaderTests` | MMCA.Common.Application.Tests | 12 | ApplicationSettings, FakeCycleModuleOne, FakeCycleModuleTwo, FakeModuleAlpha, FakeModuleTracker, FakeRemoteContractRealAdapter, FakeRemoteContractStub, IFakeRemoteContract, ModuleLoader, ModuleSettings, ModulesSettings, ScanFailingAssembly |
| 3 | `MultiHandlerEventHandler1` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, MultiHandlerEvent |
| 3 | `MultiHandlerEventHandler2` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, MultiHandlerEvent |
| 3 | `OrderId` | MMCA.Common.Application.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `PipelinePingCommandHandler` | MMCA.Common.Application.Tests | 3 | ICommandHandler<in TCommand, TResult>, PipelinePingCommand, Result |
| 3 | `PipelinePingQueryHandler` | MMCA.Common.Application.Tests | 3 | IQueryHandler<in TQuery, TResult>, PipelinePingQuery, Result |
| 3 | `ProfilingCommandDecoratorTests` | MMCA.Common.Application.Tests | 5 | Error, ICommandHandler<in TCommand, TResult>, ProfilingCommandDecorator<TCommand, TResult>, ProfilingTestCommand, Result |
| 3 | `ProfilingQueryDecoratorTests` | MMCA.Common.Application.Tests | 5 | Error, IQueryHandler<in TQuery, TResult>, ProfilingQueryDecorator<TQuery, TResult>, ProfilingTestQuery, Result |
| 3 | `RecordingIntegrationHandler<TEvent>` | MMCA.Common.Application.Tests | 2 | IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent> |
| 3 | `RecordingSection` | MMCA.Common.Application.Tests | 2 | IUserDataExportSection, UserDataExportSectionResult |
| 3 | `ResetPasswordRequestValidatorTests` | MMCA.Common.Application.Tests | 2 | ResetPasswordRequest, ResetPasswordRequestValidator |
| 3 | `RetiredEvent` | MMCA.Common.Application.Tests | 1 | BaseIntegrationEvent |
| 3 | `SkuId` | MMCA.Common.Application.Tests | 2 | IStronglyTypedId<TSelf, TValue>, SkuId |
| 3 | `SuccessorEvent` | MMCA.Common.Application.Tests | 1 | BaseIntegrationEvent |
| 3 | `TestEventHandler` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, TestEvent |
| 3 | `TestIntegrationEvent` | MMCA.Common.Application.Tests | 3 | BaseDomainEvent, BaseIntegrationEvent, IIntegrationEvent |
| 3 | `TestIntegrationEvent` | MMCA.Common.Application.Tests | 1 | BaseIntegrationEvent |
| 3 | `TestSafeDomainEventHandler` | MMCA.Common.Application.Tests | 2 | SafeDomainEventHandler<TDomainEvent>, TestSafeDomainEvent |
| 3 | `ThrowingSection` | MMCA.Common.Application.Tests | 2 | IUserDataExportSection, UserDataExportSectionResult |
| 3 | `UnmarkedCommandHandler` | MMCA.Common.Application.Tests | 3 | ICommandHandler<in TCommand, TResult>, Result, UnmarkedCommand |
| 3 | `UnrelatedEvent` | MMCA.Common.Application.Tests | 1 | BaseIntegrationEvent |
| 3 | `UserOwnershipRuleTests` | MMCA.Common.Application.Tests | 4 | Error, ErrorType, TestDeleteUserCommand, UserOwnershipRule |
| 3 | `WrongKindRequest` | MMCA.Common.Application.Tests | 2 | ICommand<TResult>, Result |
| 3 | `AcyclicConsumer` | MMCA.Common.Architecture.Tests | 1 | LeftService |
| 3 | `ArchiveTicketHandler` | MMCA.Common.Architecture.Tests | 3 | ArchiveTicketCommand, ICommandHandler<in TCommand, TResult>, Result |
| 3 | `CompliantFixtureId` | MMCA.Common.Architecture.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `CompliantStringFixtureId` | MMCA.Common.Architecture.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `CreateTicketHandler` | MMCA.Common.Architecture.Tests | 3 | CreateTicketCommand, ICommandHandler<in TCommand, TResult>, Result |
| 3 | `DriftedTests` | MMCA.Common.Architecture.Tests | 2 | FakeDependentModule, ModuleConformanceTestsBase<TModule> |
| 3 | `EmptyScanTests` | MMCA.Common.Architecture.Tests | 2 | AnonymousEndpointTestsBase, Result |
| 3 | `ExtraStateFixtureId` | MMCA.Common.Architecture.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `FakeDependentModuleConformanceTests` | MMCA.Common.Architecture.Tests | 4 | DisabledFakeExportService, FakeDependentModule, IFakeExportService, ModuleConformanceTestsBase<TModule> |
| 3 | `FakeLeafModuleConformanceTests` | MMCA.Common.Architecture.Tests | 2 | FakeLeafModule, ModuleConformanceTestsBase<TModule> |
| 3 | `FixtureBackwardsV1` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureBackwardsV2` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureCleanEvent` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureCompliantV1` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureCompliantV2` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureCompliantV3` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureContestedV1` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureContestedV2` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureContestedV3` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureCountEvent` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureLabelEvent` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureNamedEvent` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureNullableCountEvent` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureNullableLabelEvent` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureShapedBase` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `FixtureTallyEvent` | MMCA.Common.Architecture.Tests | 1 | BaseIntegrationEvent |
| 3 | `GetFixtureEntityHandlerBase<TQuery>` | MMCA.Common.Architecture.Tests | 2 | IQueryHandler<in TQuery, TResult>, Result |
| 3 | `GetFixturePreferencesHandlerBase` | MMCA.Common.Architecture.Tests | 3 | GetFixturePreferencesQuery, IQueryHandler<in TQuery, TResult>, Result |
| 3 | `GetFixtureProjectionHandler` | MMCA.Common.Architecture.Tests | 3 | GetFixtureProjectionQuery, IQueryHandler<in TQuery, TResult>, Result |
| 3 | `MutableFixtureId` | MMCA.Common.Architecture.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `NoEntityDataSources` | MMCA.Common.Architecture.Tests | 3 | DataSource, DataSourceKey, IEntityDataSourceRegistry |
| 3 | `NotARecordFixtureId` | MMCA.Common.Architecture.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `PurgeTicketsHandler` | MMCA.Common.Architecture.Tests | 3 | ICommandHandler<in TCommand, TResult>, PurgeTicketsCommand, Result |
| 3 | `RebuildFixtureProjectionHandler` | MMCA.Common.Architecture.Tests | 3 | ICommandHandler<in TCommand, TResult>, RebuildFixtureProjectionCommand, Result |
| 3 | `RebuildTicketIndexHandler` | MMCA.Common.Architecture.Tests | 3 | ICommandHandler<in TCommand, TResult>, RebuildTicketIndexCommand, Result |
| 3 | `ReopenTicketHandler` | MMCA.Common.Architecture.Tests | 3 | ICommandHandler<in TCommand, TResult>, ReopenTicketCommand, Result |
| 3 | `StrandedFixtureHandlerBase` | MMCA.Common.Architecture.Tests | 3 | GetFixturePreferencesQuery, IQueryHandler<in TQuery, TResult>, Result |
| 3 | `StubMap` | MMCA.Common.Architecture.Tests | 3 | IArchitectureMap, Layer, LayerRef |
| 3 | `TestingAspireBoundaryTests` | MMCA.Common.Architecture.Tests | 2 | AppHostFixtureBase, ArchitectureAssert |
| 3 | `UpdateTicketHandler` | MMCA.Common.Architecture.Tests | 3 | ICommandHandler<in TCommand, TResult>, Result, UpdateTicketCommand |
| 3 | `SecurityHeadersExtensions` | MMCA.Common.Aspire | 4 | ICspPolicyProvider, SecurityHeadersMiddleware, SecurityHeadersSettings, StaticCspPolicyProvider |
| 3 | `E2eLiftTests` | MMCA.Common.Aspire.Hosting.Tests | 3 | GatewayRateLimitingSettings, GatewayRoutePolicySettings, GatewaySettings |
| 3 | `SecurityHeadersCacheControlTests` | MMCA.Common.Aspire.Tests | 5 | NoCspProvider, SecurityHeadersMiddleware, SecurityHeadersSettings, StartableResponseFeature, StubWebHostEnvironment |
| 3 | `SelfHttpWarmupTaskBaseTests` | MMCA.Common.Aspire.Tests | 7 | CapturingLogger, ConfigurableWarmupTask, FakeEnvironment, FakeLifetime, FakeServer, SelfHttpWarmupTaskBase, TestServerHost |
| 3 | `ActiveSpec` | MMCA.Common.Benchmarks | 2 | SampleItem, Specification<TEntity, TIdentifierType> |
| 3 | `MinValueSpec` | MMCA.Common.Benchmarks | 2 | SampleItem, Specification<TEntity, TIdentifierType> |
| 3 | `AuditableBaseEntity<TIdentifierType>` | MMCA.Common.Domain | 5 | BaseEntity<TIdentifierType>, Error, IAuditableEntity, IRowVersioned, Result |
| 3 | `IAnonymizable` | MMCA.Common.Domain | 1 | Result |
| 3 | `IEmailConfirmableUser` | MMCA.Common.Domain | 1 | Result |
| 3 | `ILegalAcceptingUser` | MMCA.Common.Domain | 1 | Result |
| 3 | `InlineSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 2 | IBaseEntity<TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 3 | `IPasswordChangeableUser` | MMCA.Common.Domain | 2 | IAuthUser, Result |
| 3 | `IReactivatable` | MMCA.Common.Domain | 1 | Result |
| 3 | `IUserPreferences` | MMCA.Common.Domain | 1 | Result |
| 3 | `OutputCacheEvictionRequested` | MMCA.Common.Domain | 1 | BaseIntegrationEvent |
| 3 | `PermissionGrant` | MMCA.Common.Domain | 2 | Error, Result |
| 3 | `QuerySpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 3 | IBaseEntity<TIdentifierType>, OrderExpression, Specification<TEntity, TIdentifierType> |
| 3 | `BaseDomainEventTests` | MMCA.Common.Domain.Tests | 1 | TestDomainEvent |
| 3 | `PushNotificationCreatedTests` | MMCA.Common.Domain.Tests | 3 | BaseDomainEvent, IDomainEvent, PushNotificationCreated |
| 3 | `TestEntityChangedEvent` | MMCA.Common.Domain.Tests | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `TestGuidEntityChangedEvent` | MMCA.Common.Domain.Tests | 3 | DomainEntityState, EntityChangedEvent<TIdentifierType>, State |
| 3 | `TestIntegrationEvent` | MMCA.Common.Domain.Tests | 1 | BaseIntegrationEvent |
| 3 | `GatewayClusterProfileConfigFilter` | MMCA.Common.Gateway | 2 | GatewayClusterRequestProfile, GatewaySettings |
| 3 | `GatewayHealthCheckDefaultsConfigFilter` | MMCA.Common.Gateway | 1 | GatewaySettings |
| 3 | `GatewayRoutePolicyExtensions` | MMCA.Common.Gateway | 2 | GatewayRoutePolicySettings, GatewaySettings |
| 3 | `GatewayTraceHeaderTransformProvider` | MMCA.Common.Gateway | 2 | GatewaySettings, GatewayTraceHeaderSettings |
| 3 | `GrpcResultExceptionInterceptor` | MMCA.Common.Grpc | 1 | ResultFailureException |
| 3 | `ResultGrpcExtensions` | MMCA.Common.Grpc | 5 | Error, ErrorType, ErrorTypeSeverity, Result, ResultFailureException |
| 3 | `ResultFailureExceptionTests` | MMCA.Common.Grpc.Tests | 2 | Error, ResultFailureException |
| 3 | `ResultGrpcExtensionsTests` | MMCA.Common.Grpc.Tests | 5 | Error, ErrorType, ErrorTypeSeverity, Result, ResultFailureException |
| 3 | `EventUpcasterStartupValidator` | MMCA.Common.Infrastructure | 2 | IEventUpcasterRegistry, IIntegrationEvent |
| 3 | `InProcessMessageBus` | MMCA.Common.Infrastructure | 3 | IDomainEventDispatcher, IIntegrationEvent, IMessageBus |
| 3 | `NullableStronglyTypedIdValueConverter<TSelf, TValue>` | MMCA.Common.Infrastructure | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `PollingLoop` | MMCA.Common.Infrastructure | 1 | TenantDataSourceTarget |
| 3 | `SignalRLiveChannelPublisher` | MMCA.Common.Infrastructure | 2 | ILiveChannelPublisher, NotificationHub |
| 3 | `SignalRPushNotificationSender` | MMCA.Common.Infrastructure | 2 | IPushNotificationSender, NotificationHub |
| 3 | `StronglyTypedIdValueConverter<TSelf, TValue>` | MMCA.Common.Infrastructure | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `ConnectionStringSettingsValidatorTests` | MMCA.Common.Infrastructure.Tests | 4 | ConnectionStringSettings, ConnectionStringSettingsValidator, DataSourceEntrySettings, DataSourcesSettings |
| 3 | `CustomerId` | MMCA.Common.Infrastructure.Tests | 2 | CustomerId, IStronglyTypedId<TSelf, TValue> |
| 3 | `DbSeederTests` | MMCA.Common.Infrastructure.Tests | 1 | TestableDbSeeder |
| 3 | `EmptyEntityDataSourceRegistry` | MMCA.Common.Infrastructure.Tests | 2 | DataSourceKey, IEntityDataSourceRegistry |
| 3 | `FixedSourcesRegistry` | MMCA.Common.Infrastructure.Tests | 2 | DataSourceKey, IEntityDataSourceRegistry |
| 3 | `FixedSourcesRegistry` | MMCA.Common.Infrastructure.Tests | 2 | DataSourceKey, IEntityDataSourceRegistry |
| 3 | `HarnessFaultingEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `HarnessSecondEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `HarnessTestEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `LineId` | MMCA.Common.Infrastructure.Tests | 2 | IStronglyTypedId<TSelf, TValue>, LineId |
| 3 | `MapRegistry` | MMCA.Common.Infrastructure.Tests | 2 | DataSourceKey, IEntityDataSourceRegistry |
| 3 | `NamedIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `NotificationHubConnectionCapTests` | MMCA.Common.Infrastructure.Tests | 2 | NotificationHub, PushNotificationSettings |
| 3 | `NotificationHubTests` | MMCA.Common.Infrastructure.Tests | 4 | IChannelJoinAuthorizer, NotificationHub, PushNotificationSettings, StubChannelJoinAuthorizer |
| 3 | `OrderId` | MMCA.Common.Infrastructure.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `OrderPlacedV2` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `OtherIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `OutboxSettingsTests` | MMCA.Common.Infrastructure.Tests | 2 | DataSource, OutboxSettings |
| 3 | `RecordingHandler<TEvent>` | MMCA.Common.Infrastructure.Tests | 2 | IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent> |
| 3 | `RedisDistributedLockTests` | MMCA.Common.Infrastructure.Tests | 1 | RedisDistributedLock |
| 3 | `RetiredOrderPlaced` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `RetiredTestIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `SmtpEmailSenderTests` | MMCA.Common.Infrastructure.Tests | 2 | SmtpEmailSender, SmtpSettings |
| 3 | `SpeakerId` | MMCA.Common.Infrastructure.Tests | 2 | IStronglyTypedId<TSelf, TValue>, SpeakerId |
| 3 | `TestDataSourceService` | MMCA.Common.Infrastructure.Tests | 3 | DataSource, DataSourceKey, IDataSourceService |
| 3 | `TestFaultedEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `TestIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 2 | BaseIntegrationEvent, IIntegrationEvent |
| 3 | `TestIntegrationEvent` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `TestIntegrationEventV2` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `ThrowingHandler<TEvent>` | MMCA.Common.Infrastructure.Tests | 2 | IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent> |
| 3 | `TokenServiceTests` | MMCA.Common.Infrastructure.Tests | 8 | AuthClaimTypes, IPermissionRegistry, JwksSettings, JwtSettings, JwtSigningAlgorithm, PermissionRegistryBuilder, RsaJwksProvider, TokenService |
| 3 | `TotpTwoFactorServiceTests` | MMCA.Common.Infrastructure.Tests | 3 | RecoveryCodeSet, TotpTwoFactorService, TwoFactorSettings |
| 3 | `ValidatorSampleV1` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `ValidatorSampleV2` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `ValidatorSampleV3` | MMCA.Common.Infrastructure.Tests | 1 | BaseIntegrationEvent |
| 3 | `CountingMessageBus` | MMCA.Common.LoadTests | 2 | IIntegrationEvent, IMessageBus |
| 3 | `LoadIntegrationEvent` | MMCA.Common.LoadTests | 1 | BaseIntegrationEvent |
| 3 | `Address` | MMCA.Common.Shared | 4 | AddressInvariants, Result, State, ValueObject |
| 3 | `AddressInvariants` | MMCA.Common.Shared | 3 | Address, Error, Result |
| 3 | `Currency` | MMCA.Common.Shared | 4 | CurrencyJsonConverter, Error, Result, ValueObject |
| 3 | `CurrencyJsonConverter` | MMCA.Common.Shared | 1 | Currency |
| 3 | `DateRange` | MMCA.Common.Shared | 3 | Error, Result, ValueObject |
| 3 | `DateTimeRange` | MMCA.Common.Shared | 3 | Error, Result, ValueObject |
| 3 | `EmailInvariants` | MMCA.Common.Shared | 2 | Error, Result |
| 3 | `Enumeration<TEnumeration>` | MMCA.Common.Shared | 3 | EnumerationJsonConverterFactory, Error, Result |
| 3 | `EnumerationConverter<TEnumeration>` | MMCA.Common.Shared | 1 | Enumeration<TEnumeration> |
| 3 | `EnumerationJsonConverterFactory` | MMCA.Common.Shared | 2 | Enumeration<TEnumeration>, EnumerationConverter<TEnumeration> |
| 3 | `PhoneNumberInvariants` | MMCA.Common.Shared | 2 | Error, Result |
| 3 | `ProblemDetailsResultReader` | MMCA.Common.Shared | 3 | Error, ErrorType, Result |
| 3 | `ResultExtensions` | MMCA.Common.Shared | 2 | Error, Result |
| 3 | `RoleValue` | MMCA.Common.Shared | 2 | Error, Result |
| 3 | `StronglyTypedIdConverter<TSelf, TValue>` | MMCA.Common.Shared | 2 | IStronglyTypedId<TSelf, TValue>, StronglyTypedId |
| 3 | `StronglyTypedIdMappings<TSelf, TValue>` | MMCA.Common.Shared | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `StronglyTypedIdTypeConverter<TSelf, TValue>` | MMCA.Common.Shared | 2 | IStronglyTypedId<TSelf, TValue>, StronglyTypedId |
| 3 | `CustomerId` | MMCA.Common.Shared.Tests | 2 | CustomerId, IStronglyTypedId<TSelf, TValue> |
| 3 | `ErrorTypeSeverityTests` | MMCA.Common.Shared.Tests | 4 | Error, ErrorType, ErrorTypeSeverity, Result |
| 3 | `FeatureFlagRegistryTests` | MMCA.Common.Shared.Tests | 7 | FeatureFlagAttribute, FeatureFlagLifetime, FeatureFlagRegistry, NotificationFeatures, PrivacyFeatures, ProbeFeatures, ProbeSettings |
| 3 | `LateRegisteredId` | MMCA.Common.Shared.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `LineId` | MMCA.Common.Shared.Tests | 2 | IStronglyTypedId<TSelf, TValue>, LineId |
| 3 | `OrderId` | MMCA.Common.Shared.Tests | 1 | IStronglyTypedId<TSelf, TValue> |
| 3 | `PermissionCatalogTests` | MMCA.Common.Shared.Tests | 2 | IPermissionCatalog, PermissionRegistryBuilder |
| 3 | `PermissionRegistryTests` | MMCA.Common.Shared.Tests | 1 | PermissionRegistryBuilder |
| 3 | `ResultExtensionsTests` | MMCA.Common.Shared.Tests | 2 | Error, Result |
| 3 | `ResultJsonConverterFactoryTests` | MMCA.Common.Shared.Tests | 6 | Error, ErrorType, PagedCollectionResult<T>, PaginationMetadata, Result, TestDTO |
| 3 | `ResultTests` | MMCA.Common.Shared.Tests | 3 | Error, ErrorType, Result |
| 3 | `SkuId` | MMCA.Common.Shared.Tests | 2 | IStronglyTypedId<TSelf, TValue>, SkuId |
| 3 | `SpeakerId` | MMCA.Common.Shared.Tests | 2 | IStronglyTypedId<TSelf, TValue>, SpeakerId |
| 3 | `ArchitectureMapBase` | MMCA.Common.Testing.Architecture | 3 | IArchitectureMap, Layer, LayerRef |
| 3 | `ConstructorDependencyCountTestsBase` | MMCA.Common.Testing.Architecture | 1 | IArchitectureMap |
| 3 | `AppHostTestBase<TFixture>` | MMCA.Common.Testing.Aspire | 4 | AppHostFixtureBase, AppHostProbePaths, H2cProbe, JwtTokenGenerator |
| 3 | `SampleAppHostFixture` | MMCA.Common.Testing.Aspire.AppHostTests | 3 | AppHostEnvironmentRequirement, AppHostFixtureBase, AppHostReadinessBudget |
| 3 | `E2ETestBase` | MMCA.Common.Testing.E2E | 9 | AuthOutcome, AuthOutcomeRules, AxeOptions, E2ETestCollection, E2ETestConfiguration, PlaywrightFixture, RegisterPage, Result, State |
| 3 | `WebVitalsPageExtensions` | MMCA.Common.Testing.E2E | 3 | WebVitalsBudget, WebVitalsCollector, WebVitalsSample |
| 3 | `CrossServiceFixtureBaseTests` | MMCA.Common.Testing.Tests | 2 | CrossServiceFixtureBase, FakeCrossServiceFixture |
| 3 | `PingCommandHandler` | MMCA.Common.Testing.Tests | 3 | ICommandHandler<in TCommand, TResult>, PingCommand, Result |
| 3 | `PingQueryHandler` | MMCA.Common.Testing.Tests | 3 | IQueryHandler<in TQuery, TResult>, PingQuery, Result |
| 3 | `ServiceBusEmulatorFixtureBaseTests` | MMCA.Common.Testing.Tests | 3 | OverridingFixture, ProbeFixture, ServiceBusEmulatorFixtureBase |
| 3 | `HttpTestDoubles` | MMCA.Common.Testing.UI | 4 | FreshApiClientFactory, ITokenStorageService, StubTokenStorageService, UiHttpServiceHarness |
| 3 | `ChangePasswordCard` | MMCA.Common.UI | 1 | Result |
| 3 | `DataGridListPageBase<TDto>` | MMCA.Common.UI | 9 | BreakpointConstants, ErrorMessages, IToastService, ListPageQueryStateService, ListPageState, ListPageStateService, PersistedGridState, Result, SharedResource |
| 3 | `DeepLinkDispatcher` | MMCA.Common.UI | 2 | DeepLinkRouteEventArgs, IDeepLinkDispatcher |
| 3 | `HttpResultExecutor` | MMCA.Common.UI | 2 | Error, Result |
| 3 | `IEmailConfirmationUIService` | MMCA.Common.UI | 1 | Result |
| 3 | `IEntityService<TEntityDTO, TIdentifierType>` | MMCA.Common.UI | 3 | BaseLookup<TIdentifierType>, IBaseDTO<TIdentifierType>, Result |
| 3 | `ILegalAcceptanceUIService` | MMCA.Common.UI | 2 | LegalAcceptanceDTO, Result |
| 3 | `INotificationInboxUIService` | MMCA.Common.UI | 3 | PagedCollectionResult<T>, Result, UserNotificationDTO |
| 3 | `IPushNotificationUIService` | MMCA.Common.UI | 4 | PagedCollectionResult<T>, PushNotificationDTO, Result, SendPushNotificationRequest |
| 3 | `IRoleAdminUIService` | MMCA.Common.UI | 3 | PermissionCatalogResponse, Result, RolePermissionsResponse |
| 3 | `IUserAdminActionsUIService` | MMCA.Common.UI | 1 | Result |
| 3 | `MobileInfiniteScrollList<TItem>` | MMCA.Common.UI | 2 | Result, SharedResource |
| 3 | `PagedReadAll` | MMCA.Common.UI | 2 | PagedCollectionResult<T>, Result |
| 3 | `GalleryUIModule` | MMCA.Common.UI.Gallery | 3 | IUIModule, NavItem, SharedResource |
| 3 | `DependencyInjection` | MMCA.Common.UI.Maui | 50 | IAccessibilityAnnouncer, IBatteryStatusService, IBiometricAuthenticator, IClipboardService, IConnectivityStatusService, IDevicePreferences, IExternalAuthBroker, IExternalLinkService, IFormFactor, IGeocodingService, IGeolocationService, IHapticFeedbackService, IInitialThemeModeSource, ILocalCacheStore, ILocalNotificationService, IMapNavigationService, IMediaPickerService, IPublicLinkBuilder, IPushRegistrationService, IScreenshotService …(+30) |
| 3 | `DeviceCapabilitiesInitializer` | MMCA.Common.UI.Maui | 1 | IDeepLinkDispatcher |
| 3 | `BareModule` | MMCA.Common.UI.Tests | 2 | IUIModule, NavItem |
| 3 | `BrandColorTokenTests` | MMCA.Common.UI.Tests | 3 | BrandColors, BrandColorTokenTests, MMCATheme |
| 3 | `BrowserExternalLinkServiceTests` | MMCA.Common.UI.Tests | 2 | BrowserExternalLinkService, CapabilitiesJsModule |
| 3 | `BunitComponentTestBaseAuthorizationTests` | MMCA.Common.UI.Tests | 2 | BunitComponentTestBase, TestPrincipal |
| 3 | `BunitComponentTestBaseFacadeTests` | MMCA.Common.UI.Tests | 5 | BunitComponentTestBase, IAppDialogService, MudAppDialogService, MudToastService, ToastConsumer |
| 3 | `BunitTestBase` | MMCA.Common.UI.Tests | 10 | AlwaysOnlineConnectivityStatusService, BunitComponentTestBase, EndpointCultureApplier, IConnectivityStatusService, ICultureApplier, IExternalAuthBroker, IPublicLinkBuilder, NavigationPublicLinkBuilder, ThemeService, UnavailableExternalAuthBroker |
| 3 | `CapabilityFallbackTests` | MMCA.Common.UI.Tests | 21 | AlwaysOnlineConnectivityStatusService, GeoPoint, InMemoryDevicePreferences, LocalNotificationRequest, NullAccessibilityAnnouncer, NullBarcodeScannerService, NullBatteryStatusService, NullBiometricAuthenticator, NullClipboardService, NullExternalLinkService, NullGeocodingService, NullGeolocationService, NullHapticFeedbackService, NullLocalCacheStore, NullLocalNotificationService, NullMapNavigationService, NullScreenshotService, NullShareService, NullSpeechToTextService, NullTextToSpeechService …(+1) |
| 3 | `CapturingLogger` | MMCA.Common.UI.Tests | 1 | NotificationHubService |
| 3 | `DirectApiTokenRefresherTests` | MMCA.Common.UI.Tests | 9 | AuthDelegatingHandler, AuthenticationResponse, DirectApiTokenRefresher, ISecureTokenStore, ISessionAwareTokenRefresher, ITokenRefresher, Mocks, StubHttpClientFactory, StubHttpMessageHandler |
| 3 | `HeaderModule` | MMCA.Common.UI.Tests | 4 | IUIModule, NavItem, ProbeContentHeader, ProbeLayoutComponent |
| 3 | `IdempotentReadRetryTests` | MMCA.Common.UI.Tests | 3 | IdempotentReadRetry, PolicyProbe, StubHandler |
| 3 | `LinkContrastTests` | MMCA.Common.UI.Tests | 2 | BrandColors, MMCATheme |
| 3 | `MmcaClientConfigBootstrapTests` | MMCA.Common.UI.Tests | 2 | MmcaClientConfigBootstrap, ScriptedHandler |
| 3 | `MudToastServiceTests` | MMCA.Common.UI.Tests | 2 | MudToastService, ToastSeverity |
| 3 | `OtherModule` | MMCA.Common.UI.Tests | 2 | IUIModule, NavItem |
| 3 | `PasswordComplexityAttributeTests` | MMCA.Common.UI.Tests | 2 | PasswordComplexityAttribute, RegisterModel |
| 3 | `SameOriginProxyClientTests` | MMCA.Common.UI.Tests | 7 | ApiSettings, CapturingHandler, ITokenStorageService, MmcaClientConfigBootstrap, NotificationHubService, SameOriginProxyHeaders, StubTokenStorageService |
| 3 | `SameOriginProxyTokenRefresherTests` | MMCA.Common.UI.Tests | 1 | SameOriginProxyTokenRefresher |
| 3 | `StubUiModule` | MMCA.Common.UI.Tests | 2 | IUIModule, NavItem |
| 3 | `TokenRefreshPipelineTests` | MMCA.Common.UI.Tests | 9 | AuthDelegatingHandler, AuthenticationResponse, DirectApiTokenRefresher, ISecureTokenStore, ISessionCookieSync, ITokenRefresher, ITokenStorageService, StubHttpMessageHandler, WasmTokenStorageService |
| 3 | `UiHttpServiceHarnessTests` | MMCA.Common.UI.Tests | 1 | UiHttpServiceHarness |
| 3 | `WasmTokenStorageServiceTests` | MMCA.Common.UI.Tests | 7 | FakeTimeProvider, ISessionAwareTokenRefresher, ISessionCookieSync, ITokenRefresher, Mocks, TokenAcquisition, WasmTokenStorageService |
| 3 | `BoundedCircuitHandlerTests` | MMCA.Common.UI.Web.Tests | 3 | BlazorCircuitLimitExtensions, BlazorCircuitLimitSettings, BoundedCircuitHandler |
| 3 | `RefusalCapturingLogger` | MMCA.Common.UI.Web.Tests | 1 | NotificationHubService |
| 3 | `SessionHandoffServicesTests` | MMCA.Common.UI.Web.Tests | 3 | HandoffSessionCookieSync, HandoffTokenRefresher, SessionHandoffProtector |
| 4 | `ImageSizingTests` | MMCA.ADC.Architecture.Tests | 1 | ArchitectureMapBase |
| 4 | `LegalDocumentConsistencyTests` | MMCA.ADC.Architecture.Tests | 1 | ArchitectureMapBase |
| 4 | `MauiHostShellTests` | MMCA.ADC.Architecture.Tests | 1 | ArchitectureMapBase |
| 4 | `MobileHostParityTests` | MMCA.ADC.Architecture.Tests | 1 | ArchitectureMapBase |
| 4 | `NavigationContractTests` | MMCA.ADC.Architecture.Tests | 4 | ArchitectureMapBase, ContractRow, ContractTable, PageRoute |
| 4 | `SpanishAccentTests` | MMCA.ADC.Architecture.Tests | 2 | ArchitectureMapBase, SpanishAccentTestsBase |
| 4 | `DependencyInjection` | MMCA.ADC.Conference.API | 2 | ApplicationSettings, ConferencePermissionGrants |
| 4 | `ScoreEventSessionsInternalCommand` | MMCA.ADC.Conference.Application | 6 | ConferenceFeatures, ConferencePermissions, IFeatureGated, IHasTimeout, IInternalCommand, IRequiresPermission |
| 4 | `SpeakerDeletedHandler` | MMCA.ADC.Conference.Application | 5 | DomainEntityState, IDomainEventHandler<in TDomainEvent>, IEventBus, SpeakerChanged, SpeakerUnlinkedFromUser |
| 4 | `SessionizeService` | MMCA.ADC.Conference.Infrastructure | 5 | Error, ISessionizeService, Result, SessionizeCodeFormat, SessionizeResponse |
| 4 | `SessionScoreResponseGuardrail` | MMCA.ADC.Conference.Infrastructure | 5 | AiScoreResponse, GuardrailVerdict, IChatGuardrail, PromptContract, SessionScoringService |
| 4 | `GoldenReplayTests` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 8 | GoldenCorpus, GoldenReplayCase, GoldenReplayTestsBase, GuardrailChatClient, RecordedResponses, RecordedScores, ReplayChatClient, SessionScoringService |
| 4 | `LiveJudgeTests` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 2 | GoldenCorpus, SessionScoringService |
| 4 | `PromptContractTests` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 4 | GoldenCorpus, SessionScoringInput, SessionScoringService, SpeakerInfo |
| 4 | `SessionScoringPromptContractPinTests` | MMCA.ADC.Conference.Scoring.Evaluation.Tests | 3 | PromptContract, PromptContractPinTestsBase, SessionScoringService |
| 4 | `ConferenceBrokerConsumers` | MMCA.ADC.Conference.Service | 2 | UserDeleted, UserRegistered |
| 4 | `DisabledEventLiveValidationService` | MMCA.ADC.Conference.Shared | 7 | EventLiveInfo, IEventLiveValidationService, QuestionModerationDefault, Result, RoomSessionInfo, SessionLiveInfo, SponsorLiveInfo |
| 4 | `DisabledSessionBookmarkValidationService` | MMCA.ADC.Conference.Shared | 2 | ISessionBookmarkValidationService, Result |
| 4 | `CategoryItemLookupService` | MMCA.ADC.Conference.UI | 11 | CategoryItemDTO, CategoryItemInfo, CollectionResult<T>, ConferenceCategoryDTO, HttpResultExecutor, ICategoryItemLookupService, IdempotentReadRetry, PagedCollectionResult<T>, PagedReadAll, ProblemDetailsResultReader, Result |
| 4 | `ConferenceCategoryCreateModel` | MMCA.ADC.Conference.UI | 2 | ConferenceCategoryDTO, ConferenceCategoryFormModel |
| 4 | `ConferenceCategoryEditModel` | MMCA.ADC.Conference.UI | 2 | ConferenceCategoryDTO, ConferenceCategoryFormModel |
| 4 | `EventCreateModel` | MMCA.ADC.Conference.UI | 2 | EventDTO, EventFormModel |
| 4 | `EventEditModel` | MMCA.ADC.Conference.UI | 3 | EventDTO, EventFormModel, QuestionModerationDefault |
| 4 | `EventLookupService` | MMCA.ADC.Conference.UI | 9 | EventDTO, EventInfo, HttpResultExecutor, IdempotentReadRetry, IEventLookupService, PagedCollectionResult<T>, PagedReadAll, ProblemDetailsResultReader, Result |
| 4 | `IActivityUIService` | MMCA.ADC.Conference.UI | 2 | ActivityDTO, IEntityService<TEntityDTO, TIdentifierType> |
| 4 | `ICategoryItemUIService` | MMCA.ADC.Conference.UI | 2 | CategoryItemDTO, IEntityService<TEntityDTO, TIdentifierType> |
| 4 | `IConferenceCategoryUIService` | MMCA.ADC.Conference.UI | 2 | ConferenceCategoryDTO, IEntityService<TEntityDTO, TIdentifierType> |
| 4 | `IEventUIService` | MMCA.ADC.Conference.UI | 5 | EventDTO, IEntityService<TEntityDTO, TIdentifierType>, RefreshFromSessionizeResultDTO, Result, SessionizeRefreshOutcome |
| 4 | `IPartnerUIService` | MMCA.ADC.Conference.UI | 2 | IEntityService<TEntityDTO, TIdentifierType>, PartnerDTO |
| 4 | `IQuestionUIService` | MMCA.ADC.Conference.UI | 2 | IEntityService<TEntityDTO, TIdentifierType>, QuestionDTO |
| 4 | `IRoomUIService` | MMCA.ADC.Conference.UI | 3 | IEntityService<TEntityDTO, TIdentifierType>, Result, RoomDTO |
| 4 | `ISessionSelectionUIService` | MMCA.ADC.Conference.UI | 3 | Result, ScoreEventSessionsResultDTO, SessionSelectionDashboardDTO |
| 4 | `ISessionUIService` | MMCA.ADC.Conference.UI | 2 | IEntityService<TEntityDTO, TIdentifierType>, SessionDTO |
| 4 | `ISpeakerUIService` | MMCA.ADC.Conference.UI | 3 | IEntityService<TEntityDTO, TIdentifierType>, Result, SpeakerDTO |
| 4 | `ISponsorUIService` | MMCA.ADC.Conference.UI | 2 | IEntityService<TEntityDTO, TIdentifierType>, SponsorDTO |
| 4 | `OrganizerEventFeedbackService` | MMCA.ADC.Conference.UI | 9 | AuthenticatedServiceBase, EventQuestionAnswerDTO, HttpResultExecutor, IOrganizerEventFeedbackUIService, ITokenStorageService, PagedCollectionResult<T>, PagedReadAll, ProblemDetailsResultReader, Result |
| 4 | `OrganizerSessionFeedbackService` | MMCA.ADC.Conference.UI | 9 | AuthenticatedServiceBase, HttpResultExecutor, IOrganizerSessionFeedbackUIService, ITokenStorageService, PagedCollectionResult<T>, PagedReadAll, ProblemDetailsResultReader, Result, SessionQuestionAnswerDTO |
| 4 | `PublicSessionBookmarkState` | MMCA.ADC.Conference.UI | 2 | ISessionBookmarkUIService, Result |
| 4 | `ScorePollHost` | MMCA.ADC.Conference.UI | 2 | SessionSelectionDashboardDTO, ToastSeverity |
| 4 | `SessionAssetService` | MMCA.ADC.Conference.UI | 12 | AuthenticatedServiceBase, ConcurrencyETag, HttpResultExecutor, IdempotencyHeaders, ISessionAssetUIService, ITokenStorageService, ProblemDetailsResultReader, Result, SessionAssetDTO, SessionAssetLimits, SessionAssetLinkRequest, SessionAssetUpdateRequest |
| 4 | `SessionCreateModel` | MMCA.ADC.Conference.UI | 2 | SessionDTO, SessionFormModel |
| 4 | `SessionEditModel` | MMCA.ADC.Conference.UI | 2 | SessionDTO, SessionFormModel |
| 4 | `SessionSelectionAiScores` | MMCA.ADC.Conference.UI | 3 | SessionAiScoreDTO, SessionSelectionDashboardDTO, SessionSelectionDisplay |
| 4 | `SessionSelectionFilterOptions` | MMCA.ADC.Conference.UI | 2 | SessionSelectionDashboardDTO, SessionStatuses |
| 4 | `SpeakerDashboardService` | MMCA.ADC.Conference.UI | 9 | AuthenticatedServiceBase, HttpResultExecutor, ISpeakerDashboardUIService, ITokenStorageService, PagedCollectionResult<T>, ProblemDetailsResultReader, Result, SessionDTO, SessionFeedbackDTO |
| 4 | `SpeakerLookupService` | MMCA.ADC.Conference.UI | 9 | HttpResultExecutor, IdempotentReadRetry, ISpeakerLookupService, PagedCollectionResult<T>, PagedReadAll, ProblemDetailsResultReader, Result, SpeakerDTO, SpeakerInfo |
| 4 | `SpeakerUserSearch` | MMCA.ADC.Conference.UI | 3 | IUserUIService, Result, UserListDTO |
| 4 | `InertEventLookupService` | MMCA.ADC.Conference.UI.Tests | 3 | EventInfo, IEventLookupService, Result |
| 4 | `InertSessionAssetService` | MMCA.ADC.Conference.UI.Tests | 6 | Error, ISessionAssetUIService, Result, SessionAssetDTO, SessionAssetLinkRequest, SessionAssetUpdateRequest |
| 4 | `RoomCreateModelTests` | MMCA.ADC.Conference.UI.Tests | 1 | RoomCreateModel |
| 4 | `AdcE2ETestBase` | MMCA.ADC.E2E.Tests | 3 | E2ETestBase, PlaywrightFixture, State |
| 4 | `DependencyInjection` | MMCA.ADC.Engagement.API | 4 | ApplicationSettings, EngagementPermissionGrants, OwnerOrAdminFilterOptions, RoleNames |
| 4 | `EventFeedbackSubmittedPointsHandler` | MMCA.ADC.Engagement.Application | 5 | EventFeedbackSubmitted, IPointsAwarder, PointsActivityType, PointsSubjectKeys, ScopedIntegrationEventHandlerBase<TIntegrationEvent> |
| 4 | `SessionFeedbackSubmittedPointsHandler` | MMCA.ADC.Engagement.Application | 5 | IPointsAwarder, PointsActivityType, PointsSubjectKeys, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, SessionFeedbackSubmitted |
| 4 | `SessionQuestionSubmittedPointsHandler` | MMCA.ADC.Engagement.Application | 7 | BestEffort, DomainEntityState, IDomainEventHandler<in TDomainEvent>, IPointsAwarder, PointsActivityType, PointsSubjectKeys, SessionQuestionChanged |
| 4 | `RecordingPointsAwarder` | MMCA.ADC.Engagement.Application.Tests | 4 | AwardCall, IPointsAwarder, PointsActivityType, Result |
| 4 | `ThrowingPointsAwarder` | MMCA.ADC.Engagement.Application.Tests | 3 | IPointsAwarder, PointsActivityType, Result |
| 4 | `UserSessionBookmarkCacheEvictionHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 4 | BookmarkCacheEvictionSignal, DomainEntityState, UserSessionBookmarkCacheEvictionHandler, UserSessionBookmarkChanged |
| 4 | `BookmarkCacheEvictionProcessor` | MMCA.ADC.Engagement.Infrastructure | 5 | BestEffort, BookmarkCacheEvictionSignal, IEventBus, OutputCacheEvictionRequested, UserSessionBookmarkCacheEvictionHandler |
| 4 | `LiveChannelPublishProcessorTests` | MMCA.ADC.Engagement.Infrastructure.Tests | 7 | GatedFirstCallPublisher, HangingPublisher, ILiveChannelPublisher, LiveChannelPublishProcessor, LiveChannelPublishQueue, LiveChannelPublishWorkItem, RecordingPublisher |
| 4 | `FakeEventLiveValidationService` | MMCA.ADC.Engagement.IntegrationTests | 8 | Error, EventLiveInfo, IEventLiveValidationService, QuestionModerationDefault, Result, RoomSessionInfo, SessionLiveInfo, SponsorLiveInfo |
| 4 | `FakeSessionBookmarkValidationService` | MMCA.ADC.Engagement.IntegrationTests | 3 | Error, ISessionBookmarkValidationService, Result |
| 4 | `DisabledUserEngagementExportService` | MMCA.ADC.Engagement.Shared | 2 | IUserEngagementExportService, UserEngagementExportDTO |
| 4 | `BookmarkService` | MMCA.ADC.Engagement.UI | 9 | AuthenticatedServiceBase, CreateBookmarkRequest, HttpResultExecutor, IBookmarkUIService, ITokenStorageService, PagedCollectionResult<T>, ProblemDetailsResultReader, Result, UserSessionBookmarkDTO |
| 4 | `CheckInService` | MMCA.ADC.Engagement.UI | 16 | AttendanceStatsDTO, AuthenticatedServiceBase, CheckInAttendeeRequest, CheckInResultDTO, HttpResultExecutor, ICheckInUIService, ITokenStorageService, ManualCheckInRequest, MyBadgeDTO, ProblemDetailsResultReader, Result, RoomCheckInRequest, RoomCheckInResultDTO, SelfCheckInOutcome<TResult>, SponsorVisitRequest, SponsorVisitResultDTO |
| 4 | `EventFeedback` | MMCA.ADC.Engagement.UI | 11 | DataAnnotationsModelValidator, ErrorType, EventQuestionAnswerDTO, FeedbackAnswerModel, IEventFeedbackUIService, IEventLookupService, IQuestionLookupService, IToastService, ModelValidation, QuestionDTO, Result |
| 4 | `EventFeedbackService` | MMCA.ADC.Engagement.UI | 9 | AuthenticatedServiceBase, EventQuestionAnswerDTO, HttpResultExecutor, IdempotencyHeaders, IEventFeedbackUIService, ITokenStorageService, PagedCollectionResult<T>, ProblemDetailsResultReader, Result |
| 4 | `LivePollUIService` | MMCA.ADC.Engagement.UI | 12 | AuthenticatedServiceBase, CastVoteRequest, ConcurrencyETag, CreateLivePollRequest, HttpResultExecutor, IdempotencyHeaders, ILivePollUIService, ITokenStorageService, LivePollDTO, LivePollResultsDTO, ProblemDetailsResultReader, Result |
| 4 | `NowNextService` | MMCA.ADC.Engagement.UI | 6 | HttpResultExecutor, IdempotentReadRetry, INowNextService, NowNextSnapshot, ProblemDetailsResultReader, Result |
| 4 | `PointsService` | MMCA.ADC.Engagement.UI | 10 | AuthenticatedServiceBase, HttpResultExecutor, IPointsUIService, ITokenStorageService, LeaderboardEntryDTO, MyPointsDTO, PointsOverviewDTO, ProblemDetailsResultReader, Result, SetLeaderboardParticipationRequest |
| 4 | `QuestionLookupService` | MMCA.ADC.Engagement.UI | 8 | AuthenticatedServiceBase, HttpResultExecutor, IQuestionLookupService, ITokenStorageService, PagedCollectionResult<T>, ProblemDetailsResultReader, QuestionDTO, Result |
| 4 | `SessionFeedbackService` | MMCA.ADC.Engagement.UI | 9 | AuthenticatedServiceBase, HttpResultExecutor, IdempotencyHeaders, ISessionFeedbackUIService, ITokenStorageService, PagedCollectionResult<T>, ProblemDetailsResultReader, Result, SessionQuestionAnswerDTO |
| 4 | `SessionLivePollPanel` | MMCA.ADC.Engagement.UI | 6 | ErrorType, IHapticFeedbackService, ILivePollUIService, IToastService, LivePollResultsDTO, Result |
| 4 | `SessionLookupService` | MMCA.ADC.Engagement.UI | 9 | HttpResultExecutor, IdempotentReadRetry, ISessionLookupService, PagedCollectionResult<T>, PagedReadAll, ProblemDetailsResultReader, Result, SessionDTO, SessionInfo |
| 4 | `SessionQuestionUIService` | MMCA.ADC.Engagement.UI | 10 | AuthenticatedServiceBase, ConcurrencyETag, HttpResultExecutor, IdempotencyHeaders, ISessionQuestionUIService, ITokenStorageService, ProblemDetailsResultReader, Result, SessionQuestionDTO, SubmitQuestionRequest |
| 4 | `SessionReminderCoordinator` | MMCA.ADC.Engagement.UI | 7 | IDevicePreferences, ILiveEventUIService, ILocalNotificationService, ISessionLookupService, LocalNotificationRequest, SessionReminder, SessionReminderPlanner |
| 4 | `HappeningNowTests` | MMCA.ADC.Engagement.UI.Tests | 19 | ApiSettings, BunitComponentTestBase, HappeningNowPage, IHapticFeedbackService, ILiveEventUIService, ILivePollUIService, INowNextService, ITokenStorageService, LiveEventContext, LivePollDTO, LivePollResultsDTO, NotificationHubService, NotificationState, NowNextSessionInfo, NowNextSnapshot, NullHapticFeedbackService, Result, RoleNames, TestPrincipal |
| 4 | `LiveChannelJoinTests` | MMCA.ADC.Engagement.UI.Tests | 23 | ApiSettings, BunitComponentTestBase, HappeningNowPage, IHapticFeedbackService, ILiveEventUIService, ILivePollUIService, INowNextService, ISessionLookupService, ISessionQuestionUIService, ISpeechToTextService, ITokenStorageService, LiveEventContext, LivePollResultsDTO, NotificationHubService, NotificationState, NowNextSnapshot, NullHapticFeedbackService, NullSpeechToTextService, PresenterViewPage, Result …(+3) |
| 4 | `DependencyInjection` | MMCA.ADC.Identity.API | 4 | ApplicationSettings, HttpContextExternalLoginEmailVerifier, IdentityPermissionGrants, IExternalLoginEmailVerifier |
| 4 | `EngagementUserDataExportSection` | MMCA.ADC.Identity.Application | 10 | IUserDataExportSection, IUserEngagementExportService, UserDataExportBookmarkDTO, UserDataExportCheckInDTO, UserDataExportEngagementSectionDTO, UserDataExportPointsEntryDTO, UserDataExportPollVoteDTO, UserDataExportQuestionUpvoteDTO, UserDataExportSectionResult, UserDataExportSubmittedQuestionDTO |
| 4 | `SendEmailConfirmationCommand` | MMCA.ADC.Identity.Application | 3 | ICommandWithRequest<out TRequest>, IInternalCommand, SendEmailConfirmationRequest |
| 4 | `NotificationUserDataExportSectionTests` | MMCA.ADC.Identity.Application.Tests | 4 | IUserNotificationExportService, NotificationUserDataExportSection, UserDataExportNotificationSectionDTO, UserNotificationExportItemDTO |
| 4 | `UserRole` | MMCA.ADC.Identity.Domain | 4 | Error, Result, RoleNames, RoleValue |
| 4 | `FakeUserEngagementExportService` | MMCA.ADC.Identity.IntegrationTests | 6 | CheckInScope, IUserEngagementExportService, UserEngagementBookmarkExportDTO, UserEngagementCheckInExportDTO, UserEngagementExportDTO, UserEngagementSubmittedQuestionExportDTO |
| 4 | `TokenPermissionGrants` | MMCA.ADC.Identity.Service | 5 | ConferencePermissionGrants, EngagementPermissionGrants, IdentityPermissionGrants, NotificationPermissionGrants, PermissionRegistryBuilder |
| 4 | `IdentityPermissionGrantsTests` | MMCA.ADC.Identity.Shared.Tests | 6 | AdministrationPermissions, IdentityPermissionGrants, IdentityPermissions, PermissionRegistry, PermissionRegistryBuilder, RoleNames |
| 4 | `UserService` | MMCA.ADC.Identity.UI | 9 | AuthenticatedServiceBase, HttpResultExecutor, ITokenStorageService, IUserUIService, PagedCollectionResult<T>, ProblemDetailsResultReader, Result, UserAvatarDTO, UserListDTO |
| 4 | `ComponentsSnapshotTests` | MMCA.ADC.Identity.UI.Tests | 2 | BunitTestBase, MarkupSnapshot |
| 4 | `DependencyInjection` | MMCA.ADC.Notification.API | 2 | ApplicationSettings, NotificationPermissionGrants |
| 4 | `NotificationModuleTests` | MMCA.ADC.Notification.API.Tests | 4 | DisabledUserNotificationExportService, IUserNotificationExportService, ModuleConformanceTestsBase<TModule>, NotificationModule |
| 4 | `TestSupport` | MMCA.ADC.Notification.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, BaseEntity<TIdentifierType> |
| 4 | `LiveChannelJoinAuthorizer` | MMCA.ADC.Notification.Service | 4 | ConferenceReadAudience, IChannelJoinAuthorizer, IEventLiveValidationService, NotificationScopeKey |
| 4 | `ServiceBusEmulatorFixture` | MMCA.ADC.ServiceBusEmulator.IntegrationTests | 3 | ServiceBusEmulatorFixtureBase, SpeakerLinkedToUser, UserRegistered |
| 4 | `LiveChannelPublishFailureCountingTests` | MMCA.ADC.Services.Tests | 6 | GrpcCalls, ILiveChannelPublisher, LiveChannelPublisherGrpcAdapter, LiveChannelPublishProcessor, LiveChannelPublishQueue, LiveChannelPublishWorkItem |
| 4 | `SelfHttpOutputCacheWarmupTaskTests` | MMCA.ADC.Services.Tests | 2 | PagedReadAll, SelfHttpOutputCacheWarmupTask |
| 4 | `App` | MMCA.ADC.UI | 1 | MainPage |
| 4 | `GuardrailServiceCollectionExtensions` | MMCA.Common.AI | 5 | ContentPolicyGuardrail, ContentPolicySettings, IChatGuardrail, IChatRequestRedactor, PiiRedactionGuardrail |
| 4 | `GuardrailRegistrationTests` | MMCA.Common.AI.Tests | 7 | AiSettings, BoundedChatClient, GuardrailChatClient, IChatGuardrail, IChatRequestRedactor, PiiRedactionGuardrail, StubChatClient |
| 4 | `RequestRedactionTests` | MMCA.Common.AI.Tests | 6 | GuardrailChatClient, PiiRedactionGuardrail, RecordingGuardrail, StubChatClient, SuffixRedactor, UppercaseRedactor |
| 4 | `ApiControllerBase` | MMCA.Common.API | 3 | Error, ErrorHttpMapping, IErrorLocalizer |
| 4 | `IdempotencyFilter` | MMCA.Common.API | 7 | ICacheService, IdempotencyHeaders, IdempotencyMetrics, IdempotencyRecord, IdempotencySettings, IDistributedLock, KeyedSemaphoreStripe |
| 4 | `ModuleHostExtensions` | MMCA.Common.API | 4 | ApplicationSettings, ModuleHostContext, ModuleLoader, ModulesSettings |
| 4 | `OutputCacheEvictionHandler` | MMCA.Common.API | 3 | IIntegrationEventHandler<in TIntegrationEvent>, OutputCacheEvictionRequested, OutputCacheMetrics |
| 4 | `StronglyTypedIdParameterTransformer` | MMCA.Common.API | 2 | StronglyTypedId, StronglyTypedIdSchemaTransformer |
| 4 | `SupportsIfMatchAttribute` | MMCA.Common.API | 4 | ConcurrencyETag, Error, ErrorHttpMapping, IErrorLocalizer |
| 4 | `UnhandledResultFailureFilter` | MMCA.Common.API | 4 | Error, ErrorHttpMapping, IErrorLocalizer, Result |
| 4 | `DesignTimeDatabaseInitializationTests` | MMCA.Common.API.Tests | 1 | ModuleHostContext |
| 4 | `ErrorHttpMappingTests` | MMCA.Common.API.Tests | 2 | ErrorHttpMapping, ErrorType |
| 4 | `ExportMoney` | MMCA.Common.API.Tests | 1 | Currency |
| 4 | `ExportTestEntity` | MMCA.Common.API.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `OrderProbe` | MMCA.Common.API.Tests | 2 | ProbeOrderId, ProbeSkuId |
| 4 | `PlainEntity` | MMCA.Common.API.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ReadScopeEntity` | MMCA.Common.API.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TenantResolutionMiddlewareTests` | MMCA.Common.API.Tests | 4 | ITenantContext, TenancySettings, TenantResolutionMiddleware, TenantResolutionStrategy |
| 4 | `TestEntity` | MMCA.Common.API.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestOwnerSpecification` | MMCA.Common.API.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 4 | `VersionedEntity` | MMCA.Common.API.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `AddressLine1Rules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `AddressLine2Rules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `BeginTwoFactorEnrollmentHandlerBase<TCommand>` | MMCA.Common.Application | 8 | Error, ICommandHandler<in TCommand, TResult>, ITwoFactorService, ITwoFactorStore, ITwoFactorUserState, IUserScopedRequest, Result, TwoFactorSetupResponse |
| 4 | `CachingCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 6 | ICacheInvalidating, ICacheService, ICommandHandler<in TCommand, TResult>, ITenantContext, Result, TenantCacheKey |
| 4 | `CachingQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 12 | CqrsMetrics, ICacheService, IQueryCacheable, IQueryHandler<in TQuery, TResult>, ITenantContext, KeyedSemaphoreStripe, QueryCacheKeyLocks, QueryCachePipelineSettings, Releaser, Result, TenantCacheKey, UserCacheKey |
| 4 | `CityRules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `ConfirmTwoFactorEnrollmentHandlerBase<TCommand>` | MMCA.Common.Application | 8 | ICommandHandler<in TCommand, TResult>, ITwoFactorService, ITwoFactorStore, IUserScopedCommand<out TRequest>, Result, TwoFactorCodeRequest, TwoFactorErrors, TwoFactorRecoveryCodesResponse |
| 4 | `CountryRules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `DisableTwoFactorHandlerBase<TCommand>` | MMCA.Common.Application | 8 | ICommandHandler<in TCommand, TResult>, ITwoFactorAuthenticator, ITwoFactorStore, IUserScopedCommand<out TRequest>, Result, TwoFactorCodeRequest, TwoFactorErrors, TwoFactorOutcome |
| 4 | `FeatureGateCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 4 | Error, ICommandHandler<in TCommand, TResult>, IFeatureGated, ResultFailureFactory |
| 4 | `FeatureGateQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 4 | Error, IFeatureGated, IQueryHandler<in TQuery, TResult>, ResultFailureFactory |
| 4 | `IDeleteBlobInternalCommand` | MMCA.Common.Application | 1 | IInternalCommand |
| 4 | `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.Application | 2 | AuditableBaseEntity<TIdentifierType>, IBaseDTO<TIdentifierType> |
| 4 | `IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.Application | 2 | AuditableBaseEntity<TIdentifierType>, IBaseDTO<TIdentifierType> |
| 4 | `IEntityQuerier<TEntity, TIdentifierType>` | MMCA.Common.Application | 6 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, KeysetCollectionResult<T>, KeysetPageRequest, Result |
| 4 | `IEntityQueryPipeline` | MMCA.Common.Application | 3 | AuditableBaseEntity<TIdentifierType>, EntityQueryParameters<TEntity>, NavigationMetadata |
| 4 | `IEntityReader<TEntity, TIdentifierType>` | MMCA.Common.Application | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` | MMCA.Common.Application | 3 | AuditableBaseEntity<TIdentifierType>, ICreateRequest, Result |
| 4 | `IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>` | MMCA.Common.Application | 2 | AuditableBaseEntity<TIdentifierType>, Result |
| 4 | `IInternalCommandScheduler` | MMCA.Common.Application | 2 | IInternalCommand, Result |
| 4 | `INavigationMetadataProvider` | MMCA.Common.Application | 1 | NavigationMetadata |
| 4 | `INavigationPopulator<in TEntity>` | MMCA.Common.Application | 1 | NavigationMetadata |
| 4 | `IPermissionGrantStore` | MMCA.Common.Application | 2 | PermissionGrant, Result |
| 4 | `QueryFilterService` | MMCA.Common.Application | 12 | BoolFilterStrategy, DateTimeFilterStrategy, DecimalFilterStrategy, Error, GuidFilterStrategy, IFilterStrategy, IntFilterStrategy, LongFilterStrategy, QueryFieldContract, Result, StringFilterStrategy, StronglyTypedIdFilterStrategy<TSelf, TValue> |
| 4 | `RegenerateRecoveryCodesHandlerBase<TCommand>` | MMCA.Common.Application | 10 | ICommandHandler<in TCommand, TResult>, ITwoFactorAuthenticator, ITwoFactorService, ITwoFactorStore, IUserScopedCommand<out TRequest>, Result, TwoFactorCodeRequest, TwoFactorErrors, TwoFactorOutcome, TwoFactorRecoveryCodesResponse |
| 4 | `SetRolePermissionsRequestValidator` | MMCA.Common.Application | 2 | PermissionGrant, SetRolePermissionsRequest |
| 4 | `SetUserRolesRequestValidator` | MMCA.Common.Application | 2 | PermissionGrant, SetUserRolesRequest |
| 4 | `SoftDeletedUserCache` | MMCA.Common.Application | 1 | ICacheService |
| 4 | `StateRules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `TimeoutCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 5 | CqrsMetrics, Error, ICommandHandler<in TCommand, TResult>, IHasTimeout, ResultFailureFactory |
| 4 | `TimeoutQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 5 | CqrsMetrics, Error, IHasTimeout, IQueryHandler<in TQuery, TResult>, ResultFailureFactory |
| 4 | `ValidatingCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 3 | Error, ICommandHandler<in TCommand, TResult>, ResultFailureFactory |
| 4 | `ValidatingQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 3 | Error, IQueryHandler<in TQuery, TResult>, ResultFailureFactory |
| 4 | `ZipCodeRules<T>` | MMCA.Common.Application | 1 | AddressInvariants |
| 4 | `AccountEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `AgreeingMarkedCommandHandler` | MMCA.Common.Application.Tests | 3 | AgreeingMarkedCommand, ICommandHandler<in TCommand, TResult>, Result |
| 4 | `AgreeingMarkedQueryHandler` | MMCA.Common.Application.Tests | 3 | AgreeingMarkedQuery, IQueryHandler<in TQuery, TResult>, Result |
| 4 | `ChildA` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ChildB` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ChildC` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ChildD` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `CqrsMetricsTests` | MMCA.Common.Application.Tests | 10 | CapturedMeasurement, CqrsMetricsProbeCommand, CqrsMetricsProbeQuery, Error, ICommandHandler<in TCommand, TResult>, ICorrelationContext, IQueryHandler<in TQuery, TResult>, LoggingCommandDecorator<TCommand, TResult>, LoggingQueryDecorator<TQuery, TResult>, Result |
| 4 | `CustomLoggingIntegrationEventHandler` | MMCA.Common.Application.Tests | 3 | ScopedIntegrationEventHandlerBase<TIntegrationEvent>, TestIntegrationEvent, TestIntegrationEvent |
| 4 | `Dependent` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `DriftedMarkedCommandHandler` | MMCA.Common.Application.Tests | 3 | DriftedMarkedCommand, ICommandHandler<in TCommand, TResult>, Result |
| 4 | `EnvelopeCopyingV1ToV2Upcaster` | MMCA.Common.Application.Tests | 3 | CustomerRenamedV1, CustomerRenamedV2, IEventUpcaster |
| 4 | `FakeAuthenticator` | MMCA.Common.Application.Tests | 6 | ITwoFactorAuthenticator, ITwoFactorService, ITwoFactorStore, Result, TwoFactorErrors, TwoFactorOutcome |
| 4 | `FakeEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `Item` | MMCA.Common.Application.Tests | 2 | OrderId, SkuId |
| 4 | `LegalAcceptancePolicyTests` | MMCA.Common.Application.Tests | 6 | ErrorType, LegalAcceptanceDTO, LegalAcceptanceErrorCodes, LegalAcceptanceOptions, LegalAcceptancePolicy, Result |
| 4 | `MappedOrder` | MMCA.Common.Application.Tests | 1 | MappedOrderId |
| 4 | `Mocks` | MMCA.Common.Application.Tests | 8 | ICommandHandler<in TCommand, TResult>, ICorrelationContext, IQueryHandler<in TQuery, TResult>, LoggingCommandDecorator<TCommand, TResult>, LoggingQueryDecorator<TQuery, TResult>, Result, TestLoggingCommand, TestLoggingQuery |
| 4 | `NavigationMetadataTests` | MMCA.Common.Application.Tests | 3 | NavigationMetadata, NavigationPropertyInfo, NavigationType |
| 4 | `NavigationPopulatorStubEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `NoNavEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `OrderingTestEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `OrderLine` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `OrderLineEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `OrderWrapperDTO` | MMCA.Common.Application.Tests | 1 | MappedOrderId |
| 4 | `ParentEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `Principal` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ProjectedEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `QueryFieldServiceTests` | MMCA.Common.Application.Tests | 4 | CacheProbeEntity, MappedDto, ProductDto, QueryFieldService |
| 4 | `QueryFieldServiceTieBreakTests` | MMCA.Common.Application.Tests | 2 | QueryFieldService, SortTestEntity |
| 4 | `RecordingCacheService` | MMCA.Common.Application.Tests | 1 | ICacheService |
| 4 | `RecordingDomainHandlerForRetired` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, RetiredEvent |
| 4 | `RecordingTwoFactorStore` | MMCA.Common.Application.Tests | 5 | ITwoFactorStore, ITwoFactorUserState, Result, State, StoredState |
| 4 | `RelatedA` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RelatedB` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RelatedC` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RelatedEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ResolvedEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ResultFailureFactoryTests` | MMCA.Common.Application.Tests | 3 | Error, LoggingCommandDecorator<TCommand, TResult>, Result |
| 4 | `RetiredToSuccessorUpcaster` | MMCA.Common.Application.Tests | 3 | IEventUpcaster, RetiredEvent, SuccessorEvent |
| 4 | `RivalV1ToV3Upcaster` | MMCA.Common.Application.Tests | 3 | CustomerRenamedV1, CustomerRenamedV3, IEventUpcaster |
| 4 | `SafeDomainEventHandlerTests` | MMCA.Common.Application.Tests | 3 | RecordingLogger, TestSafeDomainEvent, TestSafeDomainEventHandler |
| 4 | `SelfMappingUpcaster` | MMCA.Common.Application.Tests | 2 | CustomerRenamedV1, IEventUpcaster |
| 4 | `StubChild` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `StubEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `StubParent` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestDomainEventHandlerForIntegration` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, TestIntegrationEvent |
| 4 | `TestEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestIntegrationEventDomainHandler` | MMCA.Common.Application.Tests | 2 | IDomainEventHandler<in TDomainEvent>, TestIntegrationEvent |
| 4 | `TestIntegrationEventHandler` | MMCA.Common.Application.Tests | 2 | IIntegrationEventHandler<in TIntegrationEvent>, TestIntegrationEvent |
| 4 | `TestReadEntity` | MMCA.Common.Application.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestScopedIntegrationEventHandler` | MMCA.Common.Application.Tests | 4 | ScopedIntegrationEventHandlerBase<TIntegrationEvent>, ScopedProbe, TestIntegrationEvent, TestIntegrationEvent |
| 4 | `TwoFactorStub` | MMCA.Common.Application.Tests | 4 | ITwoFactorAuthenticator, Result, TwoFactorErrors, TwoFactorOutcome |
| 4 | `V1ToV2Upcaster` | MMCA.Common.Application.Tests | 3 | CustomerRenamedV1, CustomerRenamedV2, IEventUpcaster |
| 4 | `V2ToV1Upcaster` | MMCA.Common.Application.Tests | 3 | CustomerRenamedV1, CustomerRenamedV2, IEventUpcaster |
| 4 | `V2ToV3Upcaster` | MMCA.Common.Application.Tests | 3 | CustomerRenamedV2, CustomerRenamedV3, IEventUpcaster |
| 4 | `WrongKindHandler` | MMCA.Common.Application.Tests | 3 | IQueryHandler<in TQuery, TResult>, Result, WrongKindRequest |
| 4 | `AnonymousEndpointTestsBaseTests` | MMCA.Common.Architecture.Tests | 11 | AbstractAnonymousFixtureControllerBase, AnonymousFixtureController, ConformantTests, DriftedTests, EmptyScanTests, InheritingFixtureController, StaleAllowListTests, StaleUndecoratedAllowListTests, StrictConformantTests, StrictDriftedTests, UndecoratedFixtureController |
| 4 | `BareMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, Layer, LayerRef, Result |
| 4 | `CascadeChildFixture` | MMCA.Common.Architecture.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ConformantTests` | MMCA.Common.Architecture.Tests | 5 | AbstractAnonymousFixtureControllerBase, AnonymousEndpointTestsBase, AnonymousEndpointTestsBaseTests, AnonymousFixtureController, TypeLevelAnonymousFixtureController |
| 4 | `DataSourceBranchingFitnessTests` | MMCA.Common.Architecture.Tests | 3 | ArchitectureAssert, ArchitectureMapBase, EngineHit |
| 4 | `DriftedTests` | MMCA.Common.Architecture.Tests | 2 | AnonymousEndpointTestsBase, AnonymousEndpointTestsBaseTests |
| 4 | `FakeArchitectureMap` | MMCA.Common.Architecture.Tests | 2 | ArchitectureMapBase, LayerRef |
| 4 | `FitnessPrincipal` | MMCA.Common.Architecture.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FixtureApplicationMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, GetFixturePreferencesQuery, Layer, LayerRef |
| 4 | `FixtureAssemblyMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, FixtureDomainEvent, Layer, LayerRef |
| 4 | `FixtureBackwardsVersionUpcaster` | MMCA.Common.Architecture.Tests | 3 | FixtureBackwardsV1, FixtureBackwardsV2, IEventUpcaster |
| 4 | `FixtureCompliantV1ToV2Upcaster` | MMCA.Common.Architecture.Tests | 3 | FixtureCompliantV1, FixtureCompliantV2, IEventUpcaster |
| 4 | `FixtureCompliantV2ToV3Upcaster` | MMCA.Common.Architecture.Tests | 3 | FixtureCompliantV2, FixtureCompliantV3, IEventUpcaster |
| 4 | `FixtureContestedClaimUpcaster` | MMCA.Common.Architecture.Tests | 3 | FixtureContestedV1, FixtureContestedV2, IEventUpcaster |
| 4 | `FixtureEntity` | MMCA.Common.Architecture.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FixtureLeakedPayload` | MMCA.Common.Architecture.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FixtureMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, FatFixtureController, Layer, LayerRef |
| 4 | `FixtureMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, FixtureBadFeatures, Layer, LayerRef |
| 4 | `FixtureModuleMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, Layer, LayerRef, TicketErrors |
| 4 | `FixtureModuleMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, CreateTicketCommand, Layer, LayerRef |
| 4 | `FixtureRivalClaimUpcaster` | MMCA.Common.Architecture.Tests | 3 | FixtureContestedV1, FixtureContestedV3, IEventUpcaster |
| 4 | `FixtureShapedEvent` | MMCA.Common.Architecture.Tests | 1 | FixtureShapedBase |
| 4 | `ModuleConformanceTestsBaseTests` | MMCA.Common.Architecture.Tests | 2 | DriftedTests, FakeLeafModuleConformanceTests |
| 4 | `PluralSentenceResourceTests` | MMCA.Common.Architecture.Tests | 3 | ArchitectureAssert, ArchitectureMapBase, ResourceEntry |
| 4 | `SpanishAccentTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureMapBase, SpanishAccentTestsBase |
| 4 | `StaleAllowListTests` | MMCA.Common.Architecture.Tests | 2 | AnonymousEndpointTestsBase, AnonymousEndpointTestsBaseTests |
| 4 | `StaleUndecoratedAllowListTests` | MMCA.Common.Architecture.Tests | 2 | AnonymousEndpointTestsBase, AnonymousEndpointTestsBaseTests |
| 4 | `StrictConformantTests` | MMCA.Common.Architecture.Tests | 2 | AnonymousEndpointTestsBase, AnonymousEndpointTestsBaseTests |
| 4 | `StrictDriftedTests` | MMCA.Common.Architecture.Tests | 2 | AnonymousEndpointTestsBase, AnonymousEndpointTestsBaseTests |
| 4 | `AuditableAggregateRootEntity<TIdentifierType>` | MMCA.Common.Domain | 7 | AuditableBaseEntity<TIdentifierType>, Error, IAggregateRoot, IAuditableEntity, IDomainEvent, IReactivatable, Result |
| 4 | `IErasableUser` | MMCA.Common.Domain | 2 | IAnonymizable, Result |
| 4 | `OwnedByUserSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 2 | AuditableBaseEntity<TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 4 | `RefreshSession` | MMCA.Common.Domain | 3 | Error, IAnonymizable, Result |
| 4 | `SpecificationComposer` | MMCA.Common.Domain | 4 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, ParameterReplacer, QuerySpecification<TEntity, TIdentifierType> |
| 4 | `BaseIntegrationEventTests` | MMCA.Common.Domain.Tests | 2 | IIntegrationEvent, TestIntegrationEvent |
| 4 | `ChildEntity` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `CompositionTestEntity` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `EntityChangedEventTests` | MMCA.Common.Domain.Tests | 3 | DomainEntityState, TestEntityChangedEvent, TestGuidEntityChangedEvent |
| 4 | `EntityWithGeneratedId` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `EntityWithoutGeneratedId` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FakeAnswer` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `OutputCacheEvictionRequestedTests` | MMCA.Common.Domain.Tests | 2 | IIntegrationEvent, OutputCacheEvictionRequested |
| 4 | `QueryTestEntity` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ReactivatableChildEntity` | MMCA.Common.Domain.Tests | 3 | AuditableBaseEntity<TIdentifierType>, IReactivatable, Result |
| 4 | `TestEntity` | MMCA.Common.Domain.Tests | 2 | AuditableBaseEntity<TIdentifierType>, BaseEntity<TIdentifierType> |
| 4 | `TestEntity` | MMCA.Common.Domain.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `UndeletableChildEntity` | MMCA.Common.Domain.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Result |
| 4 | `UndeletableEntity` | MMCA.Common.Domain.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Result |
| 4 | `GatewayReverseProxyExtensions` | MMCA.Common.Gateway | 4 | GatewayClusterProfileConfigFilter, GatewayHealthCheckDefaultsConfigFilter, GatewaySettings, GatewayTraceHeaderTransformProvider |
| 4 | `AddMmcaGatewayTests` | MMCA.Common.Gateway.Tests | 5 | GatewayClusterProfileConfigFilter, GatewayClusterRequestProfile, GatewayHealthCheckDefaultsConfigFilter, GatewaySettings, GatewayTraceHeaderTransformProvider |
| 4 | `GatewayClusterProfileConfigFilterTests` | MMCA.Common.Gateway.Tests | 4 | Address, GatewayClusterProfileConfigFilter, GatewayClusterRequestProfile, GatewaySettings |
| 4 | `GatewayHealthCheckDefaultsConfigFilterTests` | MMCA.Common.Gateway.Tests | 6 | Address, GatewayActiveHealthCheckDefaults, GatewayHealthCheckDefaults, GatewayHealthCheckDefaultsConfigFilter, GatewayPassiveHealthCheckDefaults, GatewaySettings |
| 4 | `GatewayRoutePolicyTests` | MMCA.Common.Gateway.Tests | 4 | GatewayRoutePolicyExtensions, GatewayRoutePolicyPartition, GatewayRoutePolicySettings, GatewaySettings |
| 4 | `GatewayTraceHeaderTransformProviderTests` | MMCA.Common.Gateway.Tests | 5 | EmptyServiceProvider, GatewaySettings, GatewayTraceHeaderSettings, GatewayTraceHeaderTransformProvider, Route |
| 4 | `DependencyInjection` | MMCA.Common.Grpc | 4 | GrpcResilienceDefaults, GrpcResultExceptionInterceptor, HttpResilienceDefaults, JwtForwardingClientInterceptor |
| 4 | `DependencyInjectionTests` | MMCA.Common.Grpc.Tests | 3 | FakeClient, GrpcResultExceptionInterceptor, JwtForwardingClientInterceptor |
| 4 | `GrpcResultExceptionInterceptorTests` | MMCA.Common.Grpc.Tests | 4 | Error, FakeServerCallContext, GrpcResultExceptionInterceptor, ResultFailureException |
| 4 | `AzureBlobFileStorageService` | MMCA.Common.Infrastructure | 4 | Error, FileUploadOptions, IFileStorageService, Result |
| 4 | `AzureNotificationHubDeviceRegistrar` | MMCA.Common.Infrastructure | 5 | DeviceInstallationRequest, Error, IPushDeviceRegistrar, NativePushPayloads, Result |
| 4 | `DistributedCacheService` | MMCA.Common.Infrastructure | 5 | CacheKeyNamespace, CacheOptions, CacheSettings, ICacheService, RedisPrefixScanner |
| 4 | `EnumerationValueConverter<TEnumeration>` | MMCA.Common.Infrastructure | 1 | Enumeration<TEnumeration> |
| 4 | `HybridCacheService` | MMCA.Common.Infrastructure | 4 | CacheKeyNamespace, CacheSettings, ICacheService, RedisPrefixScanner |
| 4 | `IEntityTypeConfigurationBase<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ImageSharpImageProcessor` | MMCA.Common.Infrastructure | 3 | Error, IImageProcessor, Result |
| 4 | `InternalCommandDispatcher` | MMCA.Common.Infrastructure | 3 | ICommandHandler<in TCommand, TResult>, IInternalCommand, Result |
| 4 | `InternalCommandMessage` | MMCA.Common.Infrastructure | 4 | IInternalCommand, InternalCommandNameResolver, InternalCommandOrigin, Payload |
| 4 | `MemoryCacheService` | MMCA.Common.Infrastructure | 3 | CacheSettings, ICacheService, KeyedSemaphoreStripe |
| 4 | `NullableEnumerationValueConverter<TEnumeration>` | MMCA.Common.Infrastructure | 1 | Enumeration<TEnumeration> |
| 4 | `NullFileStorageService` | MMCA.Common.Infrastructure | 4 | Error, FileUploadOptions, IFileStorageService, Result |
| 4 | `NullPushDeviceRegistrar` | MMCA.Common.Infrastructure | 3 | DeviceInstallationRequest, IPushDeviceRegistrar, Result |
| 4 | `PermissionGrantModelBuilderExtensions` | MMCA.Common.Infrastructure | 1 | PermissionGrant |
| 4 | `SpecificationEvaluator` | MMCA.Common.Infrastructure | 5 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, OrderExpression, QuerySpecification<TEntity, TIdentifierType>, QueryTags |
| 4 | `TwoFactorAuthenticator` | MMCA.Common.Infrastructure | 8 | ICacheService, ITwoFactorAuthenticator, ITwoFactorService, ITwoFactorStore, Result, TwoFactorErrors, TwoFactorOutcome, TwoFactorSettings |
| 4 | `AlreadySoftDeleteFilteredEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `BracketQuotedFilterEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `CosmosIndexedEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `DependencyInjectionPushNotificationsTests` | MMCA.Common.Infrastructure.Tests | 5 | ILiveChannelPublisher, IPushNotificationSender, PushNotificationSettings, SignalRLiveChannelPublisher, SignalRPushNotificationSender |
| 4 | `FakeCacheService` | MMCA.Common.Infrastructure.Tests | 1 | ICacheService |
| 4 | `FakeConfirmationCacheService` | MMCA.Common.Infrastructure.Tests | 1 | ICacheService |
| 4 | `FakeEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FakeEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FakeEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `FakeTwoFactorStore` | MMCA.Common.Infrastructure.Tests | 6 | Error, ITwoFactorStore, ITwoFactorUserState, RecoveryCodeSet, Result, State |
| 4 | `FaultIntegrationEventConsumerTests` | MMCA.Common.Infrastructure.Tests | 2 | FaultIntegrationEventConsumer<TEvent>, TestFaultedEvent |
| 4 | `FilteredIndexEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `Parent` | MMCA.Common.Infrastructure.Tests | 2 | AuditableBaseEntity<TIdentifierType>, ParentDetail |
| 4 | `PlainThing` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `Priority` | MMCA.Common.Infrastructure.Tests | 2 | Enumeration<TEnumeration>, Priority |
| 4 | `Product` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `ProjectedTestEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RecordingCommand` | MMCA.Common.Infrastructure.Tests | 1 | IInternalCommand |
| 4 | `RecordingDomainHandler` | MMCA.Common.Infrastructure.Tests | 2 | IDomainEventHandler<in TDomainEvent>, TestIntegrationEvent |
| 4 | `RecordingIntegrationHandler` | MMCA.Common.Infrastructure.Tests | 2 | IIntegrationEventHandler<in TIntegrationEvent>, TestIntegrationEvent |
| 4 | `RecordingOriginalHandler` | MMCA.Common.Infrastructure.Tests | 2 | IIntegrationEventHandler<in TIntegrationEvent>, TestIntegrationEvent |
| 4 | `RecordingSuccessorHandler` | MMCA.Common.Infrastructure.Tests | 2 | IIntegrationEventHandler<in TIntegrationEvent>, TestIntegrationEventV2 |
| 4 | `RegistryUnattributed` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RenamedFlagEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RetiredToV2Upcaster` | MMCA.Common.Infrastructure.Tests | 3 | IEventUpcaster, RetiredTestIntegrationEvent, TestIntegrationEventV2 |
| 4 | `RetiredToV2Upcaster` | MMCA.Common.Infrastructure.Tests | 3 | IEventUpcaster, OrderPlacedV2, RetiredOrderPlaced |
| 4 | `RivalV1ToV3Upcaster` | MMCA.Common.Infrastructure.Tests | 3 | IEventUpcaster, ValidatorSampleV1, ValidatorSampleV3 |
| 4 | `SampleV1ToV2Upcaster` | MMCA.Common.Infrastructure.Tests | 3 | IEventUpcaster, ValidatorSampleV1, ValidatorSampleV2 |
| 4 | `SignalRLiveChannelPublisherTests` | MMCA.Common.Infrastructure.Tests | 2 | NotificationHub, SignalRLiveChannelPublisher |
| 4 | `SignalRPushNotificationSenderAdditionalTests` | MMCA.Common.Infrastructure.Tests | 2 | NotificationHub, SignalRPushNotificationSender |
| 4 | `SignalRPushNotificationSenderTests` | MMCA.Common.Infrastructure.Tests | 2 | NotificationHub, SignalRPushNotificationSender |
| 4 | `SoftDeletableEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `SoftDeletableTestEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `SpecTestChild` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `SqliteIndexedEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `SqlServerIndexedEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TenantThing` | MMCA.Common.Infrastructure.Tests | 3 | AuditableBaseEntity<TIdentifierType>, ITenantEntity, TenantDetail |
| 4 | `TestAuditEntity` | MMCA.Common.Infrastructure.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Result |
| 4 | `TestChildEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestMappedEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestNonAggregateEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `TestOwnedAuditEntity` | MMCA.Common.Infrastructure.Tests | 2 | AuditableBaseEntity<TIdentifierType>, TestAddress |
| 4 | `ThrowingCacheService` | MMCA.Common.Infrastructure.Tests | 1 | ICacheService |
| 4 | `TrailedTenantThing` | MMCA.Common.Infrastructure.Tests | 3 | AuditableBaseEntity<TIdentifierType>, IAuditedEntity, ITenantEntity |
| 4 | `UniqueNamedEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `Widget` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `Widget` | MMCA.Common.Infrastructure.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `WrappedSpeaker` | MMCA.Common.Infrastructure.Tests | 3 | AuditableBaseEntity<TIdentifierType>, LineId, SpeakerId |
| 4 | `Email` | MMCA.Common.Shared | 3 | EmailInvariants, Result, ValueObject |
| 4 | `Money` | MMCA.Common.Shared | 4 | Currency, Error, Result, ValueObject |
| 4 | `PhoneNumber` | MMCA.Common.Shared | 3 | PhoneNumberInvariants, Result, ValueObject |
| 4 | `RegisterRequest` | MMCA.Common.Shared | 1 | Address |
| 4 | `StronglyTypedIdJsonConverterFactory` | MMCA.Common.Shared | 2 | StronglyTypedId, StronglyTypedIdConverter<TSelf, TValue> |
| 4 | `AddressInvariantsTests` | MMCA.Common.Shared.Tests | 2 | Address, AddressInvariants |
| 4 | `AddressTests` | MMCA.Common.Shared.Tests | 1 | Address |
| 4 | `CurrencyTests` | MMCA.Common.Shared.Tests | 1 | Currency |
| 4 | `DateRangeTests` | MMCA.Common.Shared.Tests | 1 | DateRange |
| 4 | `DateTimeRangeTests` | MMCA.Common.Shared.Tests | 1 | DateTimeRange |
| 4 | `Grade` | MMCA.Common.Shared.Tests | 1 | Enumeration<TEnumeration> |
| 4 | `OrderDto` | MMCA.Common.Shared.Tests | 3 | CustomerId, OrderId, SkuId |
| 4 | `Priority` | MMCA.Common.Shared.Tests | 2 | Enumeration<TEnumeration>, Priority |
| 4 | `ProblemDetailsResultReaderTests` | MMCA.Common.Shared.Tests | 4 | ErrorType, ErrorTypeSeverity, Payload, ProblemDetailsResultReader |
| 4 | `RoleValueTests` | MMCA.Common.Shared.Tests | 1 | RoleValue |
| 4 | `Severity` | MMCA.Common.Shared.Tests | 2 | Enumeration<TEnumeration>, Severity |
| 4 | `Severity` | MMCA.Common.Shared.Tests | 3 | Enumeration<TEnumeration>, EnumerationJsonConverterFactory, Severity |
| 4 | `ArchitectureRules` | MMCA.Common.Testing.Architecture | 11 | ArchitectureAssert, ArchitectureMapBase, CallGraphIndex, CrossEntityNavigationFinder, FlagDeclaration, ForeignKeyDeleteFact, IArchitectureMap, Layer, LayerRef, ProtoScope, ProtoScopeKind |
| 4 | `DataResidencyTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureMapBase, IArchitectureMap |
| 4 | `FormsConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureMapBase, IArchitectureMap |
| 4 | `FrameworkVersionConsistencyTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureMapBase, IArchitectureMap |
| 4 | `RawQueryableConventionTestsBase` | MMCA.Common.Testing.Architecture | 4 | ArchitectureAssert, ArchitectureMapBase, IArchitectureMap, Layer |
| 4 | `RawSqlConventionTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureAssert, ArchitectureMapBase, IArchitectureMap |
| 4 | `StateManagementConventionTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureMapBase, IArchitectureMap, Layer |
| 4 | `UIArchitectureConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureMapBase, IArchitectureMap |
| 4 | `SampleAppHostCollection` | MMCA.Common.Testing.Aspire.AppHostTests | 1 | SampleAppHostFixture |
| 4 | `AuthorizationTestsBase` | MMCA.Common.Testing.E2E | 2 | E2ETestBase, PlaywrightFixture |
| 4 | `LogoutTestsBase` | MMCA.Common.Testing.E2E | 2 | E2ETestBase, PlaywrightFixture |
| 4 | `PasswordResetTestsBase` | MMCA.Common.Testing.E2E | 6 | AxeOptions, E2ETestBase, ForgotPasswordPage, LoginPage, PlaywrightFixture, ResetPasswordPage |
| 4 | `ProfileManagementTestsBase` | MMCA.Common.Testing.E2E | 4 | AxeOptions, E2ETestBase, PlaywrightFixture, ProfilePage |
| 4 | `PseudoLocalizationTestsBase` | MMCA.Common.Testing.E2E | 3 | E2ETestBase, PlaywrightFixture, PseudoLocalizedPage |
| 4 | `UserLoginTestsBase` | MMCA.Common.Testing.E2E | 4 | AxeOptions, E2ETestBase, LoginPage, PlaywrightFixture |
| 4 | `UserPreferencesTestsBase` | MMCA.Common.Testing.E2E | 2 | E2ETestBase, PlaywrightFixture |
| 4 | `UserRegistrationTestsBase` | MMCA.Common.Testing.E2E | 4 | AxeOptions, E2ETestBase, PlaywrightFixture, RegisterPage |
| 4 | `TestChildEntity` | MMCA.Common.Testing.Tests | 1 | AuditableBaseEntity<TIdentifierType> |
| 4 | `RoleAdminEditPageTestsBase<TPage>` | MMCA.Common.Testing.UI | 5 | BunitComponentTestBase, IRoleAdminUIService, PermissionCatalogResponse, Result, RolePermissionsResponse |
| 4 | `RoleAdminListPageTestsBase<TPage>` | MMCA.Common.Testing.UI | 5 | BunitComponentTestBase, Error, IRoleAdminUIService, Result, RolePermissionsResponse |
| 4 | `ChildEntityServiceBase` | MMCA.Common.UI | 5 | AuthenticatedServiceBase, HttpResultExecutor, ITokenStorageService, ProblemDetailsResultReader, Result |
| 4 | `ConfirmEmail` | MMCA.Common.UI | 4 | CapabilitiesJsModule, ConfirmationState, IEmailConfirmationUIService, SharedResource |
| 4 | `DependencyInjection` | MMCA.Common.UI | 57 | AlwaysOnlineConnectivityStatusService, AppLifecycleNotifier, BrowserAccessibilityAnnouncer, BrowserClipboardService, BrowserConnectivityStatusService, BrowserDevicePreferences, BrowserExternalLinkService, BrowserLocalCacheStore, BrowserMapNavigationService, BrowserShareService, CapabilitiesJsModule, DeepLinkDispatcher, IAccessibilityAnnouncer, IAppLifecycleNotifier, IBarcodeScannerService, IBatteryStatusService, IBiometricAuthenticator, IClipboardService, IConnectivityStatusService, IDeepLinkDispatcher …(+37) |
| 4 | `EmailConfirmationUIService` | MMCA.Common.UI | 6 | ConfirmEmailRequest, HttpResultExecutor, IEmailConfirmationUIService, ProblemDetailsResultReader, Result, SendEmailConfirmationRequest |
| 4 | `EntityServiceBase<TEntityDTO, TIdentifierType>` | MMCA.Common.UI | 15 | AuthenticatedServiceBase, BaseLookup<TIdentifierType>, CollectionResult<T>, ConcurrencyETag, ErrorType, HttpResultExecutor, IBaseDTO<TIdentifierType>, IConcurrencyAware, IdempotencyHeaders, IEntityService<TEntityDTO, TIdentifierType>, ITokenStorageService, IUiReadCache, PagedCollectionResult<T>, ProblemDetailsResultReader, Result |
| 4 | `IUserAdminUIService<TUserDto>` | MMCA.Common.UI | 2 | IUserAdminActionsUIService, Result |
| 4 | `LegalAcceptanceUIService` | MMCA.Common.UI | 9 | AcceptLegalTermsRequest, AuthenticatedServiceBase, HttpResultExecutor, ILegalAcceptanceUIService, ITokenStorageService, LegalAcceptanceDTO, LegalAcceptanceRoutes, ProblemDetailsResultReader, Result |
| 4 | `ListPageActions` | MMCA.Common.UI | 3 | IToastService, MobileInfiniteScrollList<TItem>, Result |
| 4 | `NotificationInbox` | MMCA.Common.UI | 6 | INotificationInboxUIService, IToastService, NotificationState, SharedResource, UserNotificationDTO, ViewerTimeZone |
| 4 | `NotificationInboxService` | MMCA.Common.UI | 10 | AuthenticatedServiceBase, HttpResultExecutor, INotificationInboxUIService, INotificationScopeProvider, ITokenRefresher, ITokenStorageService, PagedCollectionResult<T>, ProblemDetailsResultReader, Result, UserNotificationDTO |
| 4 | `Register` | MMCA.Common.UI | 2 | Address, Result |
| 4 | `ResultUiExtensions` | MMCA.Common.UI | 9 | Error, ErrorType, ErrorTypeSeverity, HttpResultExecutor, IToastService, ProblemDetailsResultReader, Result, SharedResource, ToastSeverity |
| 4 | `RoleAdminEdit` | MMCA.Common.UI | 7 | AdministrationPermissions, IRoleAdminUIService, IToastService, LatestLoadGuard, PermissionGroup, Result, RoleAdminEditResources |
| 4 | `RoleAdminList` | MMCA.Common.UI | 4 | IRoleAdminUIService, Result, RoleAdminListResources, RolePermissionsResponse |
| 4 | `RoleAdminService` | MMCA.Common.UI | 9 | AuthenticatedServiceBase, HttpResultExecutor, IRoleAdminUIService, ITokenStorageService, PermissionCatalogResponse, ProblemDetailsResultReader, Result, RolePermissionsResponse, SetRolePermissionsRequest |
| 4 | `TermsPromptRulesTests` | MMCA.Common.UI.E2E.Tests | 1 | E2ETestBase |
| 4 | `StubNotificationInboxUIService` | MMCA.Common.UI.Gallery | 5 | INotificationInboxUIService, PagedCollectionResult<T>, PaginationMetadata, Result, UserNotificationDTO |
| 4 | `StubPushNotificationUIService` | MMCA.Common.UI.Gallery | 6 | IPushNotificationUIService, PagedCollectionResult<T>, PaginationMetadata, PushNotificationDTO, Result, SendPushNotificationRequest |
| 4 | `HostingDependencyInjection` | MMCA.Common.UI.Maui | 7 | DeviceCapabilitiesInitializer, IBarcodeScannerService, ICultureApplier, MauiBarcodeScannerService, MauiCultureApplier, MauiCultureInitializer, MauiErrorHandlingInitializer |
| 4 | `ApiFileDownloadButtonTests` | MMCA.Common.UI.Tests | 10 | ApiFileDownloadButton, ApiSettings, BunitTestBase, CapturingHttpMessageHandler, HttpTestDoubles, IExternalLinkService, IShareService, IToastService, NullExternalLinkService, NullShareService |
| 4 | `ClickableCardTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `CultureSwitcherTests` | MMCA.Common.UI.Tests | 4 | BunitTestBase, ICultureApplier, RecordingCultureApplier, SupportedCultures |
| 4 | `DeepLinkDispatcherTests` | MMCA.Common.UI.Tests | 2 | DeepLinkDispatcher, DeepLinkRouteEventArgs |
| 4 | `DeepLinkListenerTests` | MMCA.Common.UI.Tests | 3 | BunitTestBase, DeepLinkDispatcher, IDeepLinkDispatcher |
| 4 | `DeepLinkRouteShapeTests` | MMCA.Common.UI.Tests | 1 | DeepLinkDispatcher |
| 4 | `DeleteConfirmationEscapeTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `DeleteConfirmationTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `DetailPageBaseTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, ProbePage |
| 4 | `DocumentLanguageTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `EmptyStateTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `EndpointCultureApplierTests` | MMCA.Common.UI.Tests | 3 | BunitTestBase, EndpointCultureApplier, ICultureApplier |
| 4 | `ErrorSummaryExtensionsTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `ErrorSummaryPageLocalizerFallbackTests` | MMCA.Common.UI.Tests | 6 | BunitTestBase, Error, ErrorType, PageLocalizer, ProblemDetailsResultReader, Result |
| 4 | `ErrorSummaryTests` | MMCA.Common.UI.Tests | 7 | BunitTestBase, Error, ErrorType, PageLocalizer, Result, SharedResource, StubSharedLocalizer |
| 4 | `ExternalLinkTests` | MMCA.Common.UI.Tests | 4 | BunitTestBase, FakeExternalLinkService, IExternalLinkService, NullExternalLinkService |
| 4 | `ForbiddenTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `GridBackedTestPage` | MMCA.Common.UI.Tests | 2 | DataGridListPageBase<TDto>, WidgetRow |
| 4 | `HttpResultExecutorTests` | MMCA.Common.UI.Tests | 4 | Error, ErrorType, HttpResultExecutor, Result |
| 4 | `InfiniteScrollSentinelTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, InfiniteScrollSentinel |
| 4 | `ListNoRecordsContentTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `MmcaThemeProvidersTests` | MMCA.Common.UI.Tests | 3 | BunitTestBase, MMCATheme, ThemeService |
| 4 | `MobileCardListTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `MobileInfiniteScrollListTests` | MMCA.Common.UI.Tests | 4 | BunitTestBase, Error, MobileInfiniteScrollList<TItem>, Result |
| 4 | `NavigationPublicLinkBuilderTests` | MMCA.Common.UI.Tests | 5 | BunitTestBase, IPublicLinkBuilder, ITokenStorageService, NavigationPublicLinkBuilder, StubTokenStorageService |
| 4 | `NotFoundTests` | MMCA.Common.UI.Tests | 3 | BunitTestBase, ReExecuteFeature, TestPrincipal |
| 4 | `NotificationHubServiceTests` | MMCA.Common.UI.Tests | 7 | ApiSettings, CapturingLogger, ConcurrencyTrackingTokenStorage, InMemoryHubServer, ITokenStorageService, NotificationHubService, UnboundedReconnectPolicy |
| 4 | `NotificationListenerTests` | MMCA.Common.UI.Tests | 11 | ApiSettings, BunitTestBase, InMemoryHubServer, INotificationScopeProvider, IToastService, ITokenStorageService, NotificationHubService, NotificationState, NullNotificationScopeProvider, TestPrincipal, ToastSeverity |
| 4 | `OfflineBannerTests` | MMCA.Common.UI.Tests | 4 | AlwaysOnlineConnectivityStatusService, BunitTestBase, FakeConnectivityService, IConnectivityStatusService |
| 4 | `PagedReadAllTests` | MMCA.Common.UI.Tests | 5 | Error, PagedCollectionResult<T>, PagedReadAll, PaginationMetadata, Result |
| 4 | `PageStateScopeTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `PrimitivesSnapshotTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, MarkupSnapshot |
| 4 | `PrimitivesTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `QrCodeButtonTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, QrErrorCorrectionLevel |
| 4 | `QrCodeImageTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, QrErrorCorrectionLevel |
| 4 | `RatingStarsTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, RatingStars |
| 4 | `RedirectToLoginTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `ResultUiExtensionsHttpLocalizationTests` | MMCA.Common.UI.Tests | 5 | Error, HttpResultExecutor, ProblemDetailsResultReader, Result, SharedResource |
| 4 | `ResultUiExtensionsPageLocalizerFallbackTests` | MMCA.Common.UI.Tests | 5 | Error, IToastService, PageLocalizer, ProblemDetailsResultReader, Result |
| 4 | `SharedHttpTestDoublesTests` | MMCA.Common.UI.Tests | 3 | CapturingHttpMessageHandler, HttpTestDoubles, UiHttpServiceHarness |
| 4 | `SharePageButtonTests` | MMCA.Common.UI.Tests | 3 | BunitTestBase, IClipboardService, IShareService |
| 4 | `TestGridPage` | MMCA.Common.UI.Tests | 3 | DataGridListPageBase<TDto>, Result, WidgetRow |
| 4 | `ThemeToggleTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, ThemeService |
| 4 | `UnsavedChangesGuardTests` | MMCA.Common.UI.Tests | 1 | BunitTestBase |
| 4 | `ViewerTimeZoneTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, ViewerTimeZone |
| 4 | `NotificationHubAuthRefusalTests` | MMCA.Common.UI.Web.Tests | 7 | Address, ApiSettings, ITokenStorageService, NotificationHubService, ProbeHub, RefusalCapturingLogger, RefusingAuthenticationHandler |
| 5 | `ConferenceModule` | MMCA.ADC.Conference.API | 6 | ApplicationSettings, DisabledEventLiveValidationService, DisabledSessionBookmarkValidationService, IEventLiveValidationService, IModule, ISessionBookmarkValidationService |
| 5 | `SessionCalendarController` | MMCA.ADC.Conference.API | 6 | ApiControllerBase, ConferencePermissions, ExportSessionCalendarQuery, IQueryHandler<in TQuery, TResult>, Result, Route |
| 5 | `DeleteSessionAssetBlobInternalCommand` | MMCA.ADC.Conference.Application | 1 | IDeleteBlobInternalCommand |
| 5 | `ScoreEventSessionsInternalCommandHandler` | MMCA.ADC.Conference.Application | 7 | Error, ICommandHandler<in TCommand, TResult>, IDistributedLock, ISessionScoresCacheEvictor, ISessionScoringRunner, Result, ScoreEventSessionsInternalCommand |
| 5 | `Mocks` | MMCA.ADC.Conference.Application.Tests | 2 | IEventBus, SpeakerDeletedHandler |
| 5 | `ScoreEventSessionsInternalCommandMarkerTests` | MMCA.ADC.Conference.Application.Tests | 4 | ConferenceFeatures, ConferencePermissions, IFeatureGated, ScoreEventSessionsInternalCommand |
| 5 | `SessionAiScore` | MMCA.ADC.Conference.Domain | 3 | AuditableAggregateRootEntity<TIdentifierType>, Error, Result |
| 5 | `DependencyInjection` | MMCA.ADC.Conference.Infrastructure | 8 | IAiScoringService, IChatGuardrail, ISessionizeService, ISessionScoresCacheEvictor, OutputCacheSessionScoresCacheEvictor, SessionizeService, SessionScoreResponseGuardrail, SessionScoringService |
| 5 | `ConferenceAiGuardrailsRegistrationTests` | MMCA.ADC.Conference.Infrastructure.Tests | 7 | ContentPolicyGuardrail, GuardrailChatClient, IChatGuardrail, IChatRequestRedactor, PiiRedactionGuardrail, SessionScoreResponseGuardrail, StubChatClient |
| 5 | `SessionScoreResponseGuardrailTests` | MMCA.ADC.Conference.Infrastructure.Tests | 8 | GuardrailChatClient, GuardrailVerdict, PromptContract, SessionScoreResponseGuardrail, SessionScoringInput, SessionScoringService, SpeakerInfo, StubChatClient |
| 5 | `SessionScoringServiceTests` | MMCA.ADC.Conference.Infrastructure.Tests | 9 | GuardrailChatClient, PiiRedactionGuardrail, PromptContract, SessionScoreResponseGuardrail, SessionScoringInput, SessionScoringResult, SessionScoringService, SpeakerInfo, StubChatClient |
| 5 | `DisabledEventLiveValidationServiceTests` | MMCA.ADC.Conference.Shared.Tests | 2 | DisabledEventLiveValidationService, QuestionModerationDefault |
| 5 | `ActivityService` | MMCA.ADC.Conference.UI | 4 | ActivityDTO, EntityServiceBase<TEntityDTO, TIdentifierType>, IActivityUIService, ITokenStorageService |
| 5 | `CategoryItemService` | MMCA.ADC.Conference.UI | 4 | CategoryItemDTO, EntityServiceBase<TEntityDTO, TIdentifierType>, ICategoryItemUIService, ITokenStorageService |
| 5 | `ConferenceCategoryCreate` | MMCA.ADC.Conference.UI | 8 | ConferenceCategoryCreateModel, ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, IConferenceCategoryUIService, IToastService, ModelValidation, Result |
| 5 | `ConferenceCategoryDetail` | MMCA.ADC.Conference.UI | 8 | ConferenceCategoryDTO, ConferenceCategoryEditModel, ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, IConferenceCategoryUIService, IToastService, ModelValidation |
| 5 | `ConferenceCategoryList` | MMCA.ADC.Conference.UI | 8 | ConferenceCategoryDTO, ConferenceRoutePaths, DataGridListPageBase<TDto>, ErrorMessages, IConferenceCategoryUIService, ListPageActions, MobileInfiniteScrollList<TItem>, Result |
| 5 | `ConferenceCategoryService` | MMCA.ADC.Conference.UI | 4 | ConferenceCategoryDTO, EntityServiceBase<TEntityDTO, TIdentifierType>, IConferenceCategoryUIService, ITokenStorageService |
| 5 | `EventService` | MMCA.ADC.Conference.UI | 10 | ConcurrencyETag, EntityServiceBase<TEntityDTO, TIdentifierType>, EventDTO, IEventLookupService, IEventUIService, ISpeakerLookupService, ITokenStorageService, RefreshFromSessionizeResultDTO, Result, SessionizeRefreshOutcome |
| 5 | `EventSpeakerService` | MMCA.ADC.Conference.UI | 6 | ChildEntityDeletePath, ChildEntityServiceBase, EventSpeakerDTO, IEventSpeakerUIService, ITokenStorageService, Result |
| 5 | `FeedbackQuestionLoader` | MMCA.ADC.Conference.UI | 3 | IQuestionUIService, QuestionDTO, Result |
| 5 | `PartnerService` | MMCA.ADC.Conference.UI | 4 | EntityServiceBase<TEntityDTO, TIdentifierType>, IPartnerUIService, ITokenStorageService, PartnerDTO |
| 5 | `PublicSessionListView` | MMCA.ADC.Conference.UI | 11 | BookmarkService, ConferenceRoutePaths, IHapticFeedbackService, ISessionBookmarkUIService, IToastService, ListPageActions, MobileInfiniteScrollList<TItem>, Result, SessionDTO, SessionStatuses, SpeakerInfo |
| 5 | `PublicSessionScheduleService` | MMCA.ADC.Conference.UI | 8 | IConnectivityStatusService, ILocalCacheStore, IPublicSessionScheduleService, ISessionUIService, OfflineFirstPageSnapshot<TItem>, Result, SessionDTO, SessionSchedulePageRequest |
| 5 | `QuestionService` | MMCA.ADC.Conference.UI | 4 | EntityServiceBase<TEntityDTO, TIdentifierType>, IQuestionUIService, ITokenStorageService, QuestionDTO |
| 5 | `RoomService` | MMCA.ADC.Conference.UI | 5 | EntityServiceBase<TEntityDTO, TIdentifierType>, IRoomUIService, ITokenStorageService, Result, RoomDTO |
| 5 | `ScorePollSession` | MMCA.ADC.Conference.UI | 6 | ISessionSelectionUIService, ScorePollHost, ScorePollSignal, ScorePollTracker, SessionSelectionDashboardDTO, ToastSeverity |
| 5 | `SessionAssetsDownloadList` | MMCA.ADC.Conference.UI | 4 | ISessionAssetUIService, SessionAssetDisplay, SessionAssetDTO, SessionAssetService |
| 5 | `SessionAssetsPanel` | MMCA.ADC.Conference.UI | 9 | ISessionAssetUIService, Result, SessionAssetComposer, SessionAssetDisplay, SessionAssetDTO, SessionAssetLimits, SessionAssetLinkRequest, SessionAssetService, SessionAssetUpdateRequest |
| 5 | `SessionBookmarkButton` | MMCA.ADC.Conference.UI | 4 | BookmarkService, IHapticFeedbackService, ISessionBookmarkUIService, IToastService |
| 5 | `SessionCategoryItemService` | MMCA.ADC.Conference.UI | 6 | ChildEntityDeletePath, ChildEntityServiceBase, ISessionCategoryItemUIService, ITokenStorageService, Result, SessionCategoryItemDTO |
| 5 | `SessionLookups` | MMCA.ADC.Conference.UI | 9 | CategoryItemInfo, EventInfo, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISpeakerLookupService, Result, RoomDTO, SpeakerInfo |
| 5 | `SessionSelectionFilters` | MMCA.ADC.Conference.UI | 2 | SessionSelectionDashboardDTO, SessionSelectionFilterOptions |
| 5 | `SessionSelectionService` | MMCA.ADC.Conference.UI | 8 | AuthenticatedServiceBase, HttpResultExecutor, ISessionSelectionUIService, ITokenStorageService, ProblemDetailsResultReader, Result, ScoreEventSessionsResultDTO, SessionSelectionDashboardDTO |
| 5 | `SessionService` | MMCA.ADC.Conference.UI | 4 | EntityServiceBase<TEntityDTO, TIdentifierType>, ISessionUIService, ITokenStorageService, SessionDTO |
| 5 | `SessionSpeakerService` | MMCA.ADC.Conference.UI | 6 | ChildEntityDeletePath, ChildEntityServiceBase, ISessionSpeakerUIService, ITokenStorageService, Result, SessionSpeakerDTO |
| 5 | `SpeakerCategoryItemService` | MMCA.ADC.Conference.UI | 6 | ChildEntityDeletePath, ChildEntityServiceBase, ISpeakerCategoryItemUIService, ITokenStorageService, Result, SpeakerCategoryItemDTO |
| 5 | `SpeakerCreateModel` | MMCA.ADC.Conference.UI | 3 | Email, SpeakerDTO, SpeakerFormModel |
| 5 | `SpeakerDetailLookupService` | MMCA.ADC.Conference.UI | 6 | ICategoryItemLookupService, IConferenceCategoryUIService, IQuestionUIService, ISpeakerDetailLookupService, Result, SpeakerDetailLookups |
| 5 | `SpeakerEditModel` | MMCA.ADC.Conference.UI | 3 | Email, SpeakerDTO, SpeakerFormModel |
| 5 | `SpeakerService` | MMCA.ADC.Conference.UI | 7 | EntityServiceBase<TEntityDTO, TIdentifierType>, ISpeakerLookupService, ISpeakerUIService, ITokenStorageService, LinkUserRequest, Result, SpeakerDTO |
| 5 | `SponsorService` | MMCA.ADC.Conference.UI | 4 | EntityServiceBase<TEntityDTO, TIdentifierType>, ISponsorUIService, ITokenStorageService, SponsorDTO |
| 5 | `ADCHomeServiceDoubles` | MMCA.ADC.Conference.UI.Tests | 7 | EventDTO, IEventUIService, IPartnerUIService, ISponsorUIService, PartnerDTO, Result, SponsorDTO |
| 5 | `ClientEventFormatValidationTests` | MMCA.ADC.Conference.UI.Tests | 4 | EventCreateModel, EventEditModel, EventFormModel, SessionizeCodeFormat |
| 5 | `EventFormModelEmailTests` | MMCA.ADC.Conference.UI.Tests | 2 | EventEditModel, EventFormModel |
| 5 | `EventLookupServiceTests` | MMCA.ADC.Conference.UI.Tests | 7 | CapturingHttpMessageHandler, EventDTO, EventLookupService, FakeTimeProvider, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata |
| 5 | `OrganizerEventFeedbackServiceTests` | MMCA.ADC.Conference.UI.Tests | 7 | CapturingHttpMessageHandler, ErrorType, EventQuestionAnswerDTO, HttpTestDoubles, OrganizerEventFeedbackService, PagedCollectionResult<T>, PaginationMetadata |
| 5 | `OrganizerSessionFeedbackServiceTests` | MMCA.ADC.Conference.UI.Tests | 6 | CapturingHttpMessageHandler, HttpTestDoubles, OrganizerSessionFeedbackService, PagedCollectionResult<T>, PaginationMetadata, SessionQuestionAnswerDTO |
| 5 | `SessionAssetServiceTests` | MMCA.ADC.Conference.UI.Tests | 4 | CapturingHttpMessageHandler, HttpTestDoubles, SessionAssetDTO, SessionAssetService |
| 5 | `SessionCreateModelTests` | MMCA.ADC.Conference.UI.Tests | 1 | SessionCreateModel |
| 5 | `SessionEditModelTests` | MMCA.ADC.Conference.UI.Tests | 2 | SessionDTO, SessionEditModel |
| 5 | `SpeakerLookupServiceTests` | MMCA.ADC.Conference.UI.Tests | 8 | CapturingHttpMessageHandler, FakeTimeProvider, GatedHandler, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, SpeakerDTO, SpeakerLookupService |
| 5 | `AccessibilityTests` | MMCA.ADC.E2E.Tests | 42 | AdcE2ETestBase, CheckInScanPage, ConferenceCategoryCreatePage, ConferenceCategoryListPage, E2ETestCollection, EventCreatePage, EventDetailPage, EventListPage, HappeningNowPage, MyBadgePage, MyPointsPage, OrganizerAttendancePage, OrganizerPointsOverviewPage, PartnerCreatePage, PartnerDetailPage, PartnerListPage, PlaywrightFixture, PublicEventDetailPage, PublicEventListPage, PublicSessionDetailPage …(+22) |
| 5 | `AccountDeletionTests` | MMCA.ADC.E2E.Tests | 5 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, ProfilePage, State |
| 5 | `AttendeeBookmarkTests` | MMCA.ADC.E2E.Tests | 5 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, PublicSessionListPage, SessionCreatePage |
| 5 | `AttendeeFeedbackTests` | MMCA.ADC.E2E.Tests | 12 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, EventFeedbackPage, PlaywrightFixture, PublicEventDetailPage, PublicSessionDetailPage, PublicSessionListPage, QuestionCreatePage, SessionCreatePage, SessionFeedbackPage |
| 5 | `AttendeeShareAndExportTests` | MMCA.ADC.E2E.Tests | 8 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, PublicEventDetailPage, PublicEventListPage, PublicSessionDetailPage, PublicSpeakerDetailPage, PublicSpeakerListPage |
| 5 | `AuthorizationTests` | MMCA.ADC.E2E.Tests | 2 | AuthorizationTestsBase, PlaywrightFixture |
| 5 | `CheckInAndPointsTests` | MMCA.ADC.E2E.Tests | 16 | AdcE2ETestBase, CheckInScanPage, E2ETestCollection, EventCreatePage, EventDetailPage, MyBadgePage, MyPointsPage, OrganizerAttendancePage, OrganizerPointsOverviewPage, PlaywrightFixture, RoomCheckInPage, RoomCreatePage, RoomDetailPage, SessionCreatePage, SponsorVisitPage, State |
| 5 | `DataIntegrityTests` | MMCA.ADC.E2E.Tests | 12 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, PlaywrightFixture, PublicSessionListPage, PublicSpeakerDetailPage, RoomCreatePage, RoomDetailPage, SessionCreatePage, SessionDetailPage, State |
| 5 | `LivePollWorkflowTests` | MMCA.ADC.E2E.Tests | 5 | AdcE2ETestBase, E2ETestCollection, HappeningNowPage, PlaywrightFixture, State |
| 5 | `LiveSessionQaTests` | MMCA.ADC.E2E.Tests | 12 | AdcE2ETestBase, E2ETestCollection, E2ETestConfiguration, EventCreatePage, EventDetailPage, HappeningNowPage, LiveEventFixture, LiveSessionPage, PlaywrightFixture, PresenterViewPage, RegisterPage, State |
| 5 | `LogoutTests` | MMCA.ADC.E2E.Tests | 2 | LogoutTestsBase, PlaywrightFixture |
| 5 | `NotificationTests` | MMCA.ADC.E2E.Tests | 4 | AdcE2ETestBase, E2ETestCollection, E2ETestConfiguration, PlaywrightFixture |
| 5 | `OrganizerCategoryManagementTests` | MMCA.ADC.E2E.Tests | 6 | AdcE2ETestBase, ConferenceCategoryCreatePage, ConferenceCategoryDetailPage, ConferenceCategoryListPage, E2ETestCollection, PlaywrightFixture |
| 5 | `OrganizerEventManagementTests` | MMCA.ADC.E2E.Tests | 9 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, EventListPage, PlaywrightFixture, PublicEventDetailPage, SessionCreatePage, SessionDetailPage |
| 5 | `OrganizerFeedbackAnalyticsTests` | MMCA.ADC.E2E.Tests | 11 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, EventFeedbackPage, OrganizerEventFeedbackPage, OrganizerSessionFeedbackPage, PlaywrightFixture, PublicEventDetailPage, SessionCreatePage, SessionDetailPage |
| 5 | `OrganizerPartnerManagementTests` | MMCA.ADC.E2E.Tests | 7 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, PartnerCreatePage, PartnerDetailPage, PartnerListPage, PlaywrightFixture |
| 5 | `OrganizerQuestionManagementTests` | MMCA.ADC.E2E.Tests | 6 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, QuestionCreatePage, QuestionDetailPage, QuestionListPage |
| 5 | `OrganizerRelationshipManagementTests` | MMCA.ADC.E2E.Tests | 10 | AdcE2ETestBase, ConferenceCategoryCreatePage, ConferenceCategoryDetailPage, E2ETestCollection, EventCreatePage, PlaywrightFixture, SessionCreatePage, SessionDetailPage, SpeakerCreatePage, State |
| 5 | `OrganizerRoomManagementTests` | MMCA.ADC.E2E.Tests | 7 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, PlaywrightFixture, RoomCreatePage, RoomDetailPage, RoomListPage |
| 5 | `OrganizerSessionManagementTests` | MMCA.ADC.E2E.Tests | 7 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, PlaywrightFixture, SessionCreatePage, SessionDetailPage, SessionListPage |
| 5 | `OrganizerSpeakerManagementTests` | MMCA.ADC.E2E.Tests | 9 | AdcE2ETestBase, ConferenceCategoryCreatePage, ConferenceCategoryDetailPage, E2ETestCollection, PlaywrightFixture, SpeakerCreatePage, SpeakerDetailPage, SpeakerListPage, State |
| 5 | `OrganizerSponsorManagementTests` | MMCA.ADC.E2E.Tests | 8 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, PlaywrightFixture, SponsorCreatePage, SponsorDetailPage, SponsorListPage, State |
| 5 | `PasswordResetTests` | MMCA.ADC.E2E.Tests | 2 | PasswordResetTestsBase, PlaywrightFixture |
| 5 | `ProfileManagementTests` | MMCA.ADC.E2E.Tests | 5 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, ProfilePage, State |
| 5 | `PseudoLocalizationTests` | MMCA.ADC.E2E.Tests | 4 | E2ETestCollection, PlaywrightFixture, PseudoLocalizationTestsBase, PseudoLocalizedPage |
| 5 | `PublicSponsorBrowseTests` | MMCA.ADC.E2E.Tests | 9 | AdcE2ETestBase, E2ETestCollection, EventCreatePage, EventDetailPage, EventListPage, PlaywrightFixture, PublicSponsorListPage, SponsorCreatePage, SponsorDetailPage |
| 5 | `RoleAdministrationTests` | MMCA.ADC.E2E.Tests | 4 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, RoleAdminPage |
| 5 | `SessionAssetsTests` | MMCA.ADC.E2E.Tests | 7 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, PublicSessionDetailPage, SessionAssetsPanelPage, SessionDetailPage, SessionListPage |
| 5 | `SessionSelectionDashboardTests` | MMCA.ADC.E2E.Tests | 6 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, SessionCreatePage, SessionDetailPage, State |
| 5 | `SpeakerDashboardTests` | MMCA.ADC.E2E.Tests | 4 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, SpeakerDashboardPage |
| 5 | `SpeakerSelfServiceTests` | MMCA.ADC.E2E.Tests | 15 | AdcE2ETestBase, E2EPolling, E2ETestCollection, E2ETestConfiguration, GatewayApi, PlaywrightFixture, PublicSessionListPage, RegisterPage, SessionCreatePage, SessionDetailPage, SpeakerCreatePage, SpeakerDashboardPage, SpeakerDetailPage, SpeakerQrPage, State |
| 5 | `UserLoginTests` | MMCA.ADC.E2E.Tests | 2 | PlaywrightFixture, UserLoginTestsBase |
| 5 | `UserManagementTests` | MMCA.ADC.E2E.Tests | 4 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, UserListPage |
| 5 | `UserPreferencesTests` | MMCA.ADC.E2E.Tests | 2 | PlaywrightFixture, UserPreferencesTestsBase |
| 5 | `UserRegistrationTests` | MMCA.ADC.E2E.Tests | 2 | PlaywrightFixture, UserRegistrationTestsBase |
| 5 | `WebVitalsTests` | MMCA.ADC.E2E.Tests | 5 | AdcE2ETestBase, E2ETestCollection, PlaywrightFixture, PublicSessionListPage, WebVitalsBudget |
| 5 | `CheckInsController` | MMCA.ADC.Engagement.API | 18 | ApiControllerBase, AttendanceStatsDTO, CheckInAttendeeRequest, CheckInResultDTO, EngagementFeatures, EngagementPermissions, GetAttendanceStatsQuery, GetOrCreateMyBadgeCommand, ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult>, ManualCheckInRequest, MyBadgeDTO, Result, RoomCheckInRequest, RoomCheckInResultDTO, Route, SponsorVisitRequest, SponsorVisitResultDTO |
| 5 | `EngagementModule` | MMCA.ADC.Engagement.API | 6 | ApplicationSettings, DisabledBookmarkCountService, DisabledUserEngagementExportService, IBookmarkCountService, IModule, IUserEngagementExportService |
| 5 | `PointsController` | MMCA.ADC.Engagement.API | 14 | ApiControllerBase, EngagementFeatures, EngagementPermissions, GetLeaderboardQuery, GetMyPointsQuery, GetPointsOverviewQuery, ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult>, LeaderboardEntryDTO, MyPointsDTO, PointsOverviewDTO, Result, Route, SetLeaderboardParticipationRequest |
| 5 | `DependencyInjection` | MMCA.ADC.Engagement.Infrastructure | 2 | BookmarkCacheEvictionProcessor, LiveChannelPublishProcessor |
| 5 | `BookmarkCacheEvictionProcessorTests` | MMCA.ADC.Engagement.Infrastructure.Tests | 6 | BookmarkCacheEvictionProcessor, BookmarkCacheEvictionSignal, FakeTimeProvider, IEventBus, OutputCacheEvictionRequested, RecordingEventBus |
| 5 | `AttendeeSummary` | MMCA.ADC.Engagement.UI | 1 | Email |
| 5 | `MyBadge` | MMCA.ADC.Engagement.UI | 3 | BadgePayload, CheckInService, ICheckInUIService |
| 5 | `MyPoints` | MMCA.ADC.Engagement.UI | 7 | IPointsUIService, LeaderboardEntryDTO, PointsActivityType, PointsEntryDTO, PointsService, Result, ViewerTimeZone |
| 5 | `OrganizerPointsOverview` | MMCA.ADC.Engagement.UI | 5 | IPointsUIService, PointsActivityType, PointsOverviewDTO, PointsService, ViewerTimeZone |
| 5 | `RoomCheckIn` | MMCA.ADC.Engagement.UI | 9 | CheckInErrorCodes, CheckInService, CheckInState, ICheckInUIService, IToastService, Result, RoomCheckInResultDTO, State, ViewerTimeZone |
| 5 | `SessionBookmarkUIService` | MMCA.ADC.Engagement.UI | 9 | AuthenticatedServiceBase, CreateBookmarkRequest, HttpResultExecutor, ISessionBookmarkUIService, ITokenStorageService, ProblemDetailsResultReader, Result, SessionReminderCoordinator, UserSessionBookmarkDTO |
| 5 | `SponsorVisit` | MMCA.ADC.Engagement.UI | 8 | CheckInErrorCodes, CheckInService, ICheckInUIService, IToastService, SponsorVisitResultDTO, State, ViewerTimeZone, VisitState |
| 5 | `BookmarkServiceTests` | MMCA.ADC.Engagement.UI.Tests | 8 | BookmarkService, CapturingHttpMessageHandler, CreateBookmarkRequest, ErrorType, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, UserSessionBookmarkDTO |
| 5 | `CheckInServiceTests` | MMCA.ADC.Engagement.UI.Tests | 5 | CapturingHttpMessageHandler, CheckInService, DisposeTrackingResponse, HttpTestDoubles, SponsorVisitResultDTO |
| 5 | `EventFeedbackServiceTests` | MMCA.ADC.Engagement.UI.Tests | 8 | CapturingHttpMessageHandler, ErrorType, EventFeedbackService, EventQuestionAnswerDTO, HttpTestDoubles, IdempotencyHeaders, PagedCollectionResult<T>, PaginationMetadata |
| 5 | `NowNextServiceTests` | MMCA.ADC.Engagement.UI.Tests | 6 | CapturingHttpMessageHandler, HttpTestDoubles, NowNextService, NowNextSessionInfo, NowNextSnapshot, Snapshot |
| 5 | `QuestionLookupServiceTests` | MMCA.ADC.Engagement.UI.Tests | 6 | CapturingHttpMessageHandler, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, QuestionDTO, QuestionLookupService |
| 5 | `SessionFeedbackServiceTests` | MMCA.ADC.Engagement.UI.Tests | 8 | CapturingHttpMessageHandler, ErrorType, HttpTestDoubles, IdempotencyHeaders, PagedCollectionResult<T>, PaginationMetadata, SessionFeedbackService, SessionQuestionAnswerDTO |
| 5 | `SessionLookupServiceTests` | MMCA.ADC.Engagement.UI.Tests | 9 | CapturingHttpMessageHandler, HttpTestDoubles, PagedCollectionResult<T>, PagedReadAll, PaginationMetadata, ProblemDetailsResultReader, SessionDTO, SessionInfo, SessionLookupService |
| 5 | `SessionQuestionUIServiceTests` | MMCA.ADC.Engagement.UI.Tests | 7 | CapturingHttpMessageHandler, HttpTestDoubles, IdempotencyHeaders, QuestionStatus, SessionQuestionDTO, SessionQuestionUIService, SubmitQuestionRequest |
| 5 | `SessionReminderCoordinatorTests` | MMCA.ADC.Engagement.UI.Tests | 11 | Error, ILiveEventUIService, ILocalNotificationService, InMemoryDevicePreferences, ISessionLookupService, LiveEventContext, LocalNotificationRequest, Result, SessionInfo, SessionReminderCoordinator, SessionReminderPlanner |
| 5 | `UserClaimsController` | MMCA.ADC.Identity.API | 2 | ApiControllerBase, Route |
| 5 | `DeleteAvatarBlobInternalCommand` | MMCA.ADC.Identity.Application | 1 | IDeleteBlobInternalCommand |
| 5 | `EngagementUserDataExportSectionTests` | MMCA.ADC.Identity.Application.Tests | 12 | CheckInScope, EngagementUserDataExportSection, IUserEngagementExportService, PointsActivityType, UserDataExportEngagementSectionDTO, UserEngagementBookmarkExportDTO, UserEngagementCheckInExportDTO, UserEngagementExportDTO, UserEngagementPointsEntryExportDTO, UserEngagementPollVoteExportDTO, UserEngagementQuestionUpvoteExportDTO, UserEngagementSubmittedQuestionExportDTO |
| 5 | `LegalAndDataCard` | MMCA.ADC.Identity.UI | 9 | IExternalLinkService, ILegalAcceptanceUIService, IShareService, IToastService, IUserUIService, LegalAcceptanceDTO, LegalSettings, UserService, ViewerTimeZone |
| 5 | `RoleEditTests` | MMCA.ADC.Identity.UI.Tests | 4 | IdentityRoutePaths, RoleAdminEditPageTestsBase<TPage>, RoleEdit, RoleNames |
| 5 | `RoleListTests` | MMCA.ADC.Identity.UI.Tests | 4 | IdentityRoutePaths, RoleAdminListPageTestsBase<TPage>, RoleList, RoleNames |
| 5 | `UserDetailTests` | MMCA.ADC.Identity.UI.Tests | 8 | AuthClaimTypes, BunitTestBase, Error, IAppDialogService, IUserAdminUIService<TUserDto>, Result, RoleNames, UserAdminDTO |
| 5 | `UserServiceTests` | MMCA.ADC.Identity.UI.Tests | 8 | CapturingHttpMessageHandler, Email, ErrorType, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, UserListDTO, UserService |
| 5 | `ServiceBusEmulatorCollection` | MMCA.ADC.ServiceBusEmulator.IntegrationTests | 1 | ServiceBusEmulatorFixture |
| 5 | `LiveChannelJoinAuthorizerTests` | MMCA.ADC.Services.Tests | 9 | Error, EventInfo, EventLiveInfo, IEventLiveValidationService, LiveChannelJoinAuthorizer, Result, RoleNames, SessionInfo, SessionLiveInfo |
| 5 | `CsvWriter` | MMCA.Common.API | 2 | Currency, Money |
| 5 | `CurrencyJsonConverter` | MMCA.Common.API | 2 | Currency, Money |
| 5 | `IdempotentAttribute` | MMCA.Common.API | 1 | IdempotencyFilter |
| 5 | `InsecureJwtMetadataWarningStartupFilter` | MMCA.Common.API | 1 | WebApplicationBuilderExtensions |
| 5 | `OutputCacheEvictionExtensions` | MMCA.Common.API | 4 | BestEffort, IIntegrationEventHandler<in TIntegrationEvent>, OutputCacheEvictionHandler, OutputCacheEvictionRequested |
| 5 | `UsersAdminControllerBase<TUserDto>` | MMCA.Common.API | 6 | AdministrationPermissions, ApiControllerBase, IUserAdministrationService<TUserDto>, PagedCollectionResult<T>, SetUserRolesRequest, UserAdministrationQuery |
| 5 | `WebApplicationBuilderExtensions` | MMCA.Common.API | 13 | ApiParameterDescriptorBackfillProvider, ApiVersionReportingResultFilter, ApplicationNamespace, CacheKeyPrefixOptions, InsecureJwtMetadataWarningStartupFilter, JwtSettings, JwtSigningAlgorithm, PushNotificationSettings, RateLimitAlgorithm, RateLimitingSettings, RedisFixedWindowRateLimiter, StronglyTypedIdParameterTransformer, StronglyTypedIdSchemaTransformer |
| 5 | `CurrencyJsonConverterTests` | MMCA.Common.API.Tests | 2 | Currency, Money |
| 5 | `DimensionedRow` | MMCA.Common.API.Tests | 3 | Currency, Money, ProbeDimensions |
| 5 | `ExportShapeTestDTO` | MMCA.Common.API.Tests | 2 | ExportMoney, IBaseDTO<TIdentifierType> |
| 5 | `IdempotencyFilterPassthroughTests` | MMCA.Common.API.Tests | 2 | ICacheService, IdempotencyFilter |
| 5 | `IdempotencyFilterTests` | MMCA.Common.API.Tests | 10 | AuthClaimTypes, ICacheService, IdempotencyFilter, IdempotencyRecord, IDistributedLock, NonSeekableStream, Result, TrackingHandle, Wrapped, WrappedAsStringConverter |
| 5 | `InitTestMigratedWidget` | MMCA.Common.API.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `InitTestWidget` | MMCA.Common.API.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `PricedRow` | MMCA.Common.API.Tests | 2 | Currency, Money |
| 5 | `RecordingLogger` | MMCA.Common.API.Tests | 1 | OutputCacheEvictionHandler |
| 5 | `RoundTripController` | MMCA.Common.API.Tests | 2 | ApiControllerBase, Error |
| 5 | `SupportsIfMatchAttributeTests` | MMCA.Common.API.Tests | 3 | ConcurrencyETag, Result, SupportsIfMatchAttribute |
| 5 | `TestAggregateEntity` | MMCA.Common.API.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestApiController` | MMCA.Common.API.Tests | 2 | ApiControllerBase, Error |
| 5 | `TestController` | MMCA.Common.API.Tests | 2 | ApiControllerBase, Error |
| 5 | `UnhandledResultFailureFilterTests` | MMCA.Common.API.Tests | 3 | Error, Result, UnhandledResultFailureFilter |
| 5 | `WrappedIdProbeController` | MMCA.Common.API.Tests | 4 | OrderProbe, ProbeOrderId, ProbeSkuId, Route |
| 5 | `AddressValidator` | MMCA.Common.Application | 7 | Address, AddressLine1Rules<T>, AddressLine2Rules<T>, CityRules<T>, CountryRules<T>, StateRules<T>, ZipCodeRules<T> |
| 5 | `AuthenticationValidators` | MMCA.Common.Application | 5 | LegalAcceptanceOptions, LegalAcceptancePolicy, LoginRequest, RefreshTokenRequest, RegisterRequest |
| 5 | `DeleteBlobInternalCommandHandlerBase<TCommand>` | MMCA.Common.Application | 5 | ErrorType, ICommandHandler<in TCommand, TResult>, IDeleteBlobInternalCommand, IFileStorageService, Result |
| 5 | `EntityQueryPipeline` | MMCA.Common.Application | 9 | AuditableBaseEntity<TIdentifierType>, EntityQueryParameters<TEntity>, IEntityQueryPipeline, IQueryableExecutor, NavigationMetadata, NavigationType, PagingMath, QueryFieldService, QueryFilterService |
| 5 | `IAuthenticationService` | MMCA.Common.Application | 7 | AuthenticationResponse, Error, LoginRequest, RefreshSessionSummaryResponse, RefreshTokenRequest, RegisterRequest, Result |
| 5 | `IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.Application | 7 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IBaseDTO<TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, Result |
| 5 | `IReadRepository<TEntity, TIdentifierType>` | MMCA.Common.Application | 3 | AuditableBaseEntity<TIdentifierType>, IEntityQuerier<TEntity, TIdentifierType>, IEntityReader<TEntity, TIdentifierType> |
| 5 | `IRefreshSessionStore` | MMCA.Common.Application | 1 | RefreshSession |
| 5 | `IWriteRepository<TEntity, TIdentifierType>` | MMCA.Common.Application | 3 | AuditableAggregateRootEntity<TIdentifierType>, IRowVersioned, IUpdatePropertySetter<TEntity> |
| 5 | `NavigationMetadataProvider` | MMCA.Common.Application | 6 | IDataSourceService, INavigationMetadataProvider, NavigationAttribute, NavigationMetadata, NavigationPropertyInfo, NavigationType |
| 5 | `NullNavigationPopulator<TEntity>` | MMCA.Common.Application | 2 | INavigationPopulator<in TEntity>, NavigationMetadata |
| 5 | `UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>` | MMCA.Common.Application | 4 | AuditableBaseEntity<TIdentifierType>, ICacheInvalidating, ICommandWithRequest<out TRequest>, IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType> |
| 5 | `BoolFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 5 | `CacheServiceGetOrCreateTests` | MMCA.Common.Application.Tests | 3 | ICacheService, KeyedSemaphoreStripe, RecordingCacheService |
| 5 | `CachingDecoratorConstructorSelectionTests` | MMCA.Common.Application.Tests | 10 | CachingCommandDecorator<TCommand, TResult>, CachingQueryDecorator<TQuery, TResult>, CtorProbeCommand, CtorProbeCommandHandler, CtorProbeQuery, CtorProbeQueryHandler, ICacheService, ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult>, Result |
| 5 | `CachingDecoratorTenantScopingTests` | MMCA.Common.Application.Tests | 9 | CacheableTestQuery, CacheInvalidatingTestCommand, CachingCommandDecorator<TCommand, TResult>, CachingQueryDecorator<TQuery, TResult>, ICacheService, ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult>, ITenantContext, Result |
| 5 | `CachingQueryDecoratorTests` | MMCA.Common.Application.Tests | 18 | CacheableTestQuery, CacheDoubleCheckMetricQuery, CacheHitMetricQuery, CacheMissMetricQuery, CacheReadCanceledQuery, CacheReadFailureMetricQuery, CacheReadFailureQuery, CachingQueryDecorator<TQuery, TResult>, CapturedCounter, Error, ICacheService, IQueryHandler<in TQuery, TResult>, NonCacheableTestQuery, PopulateLockTimeoutQuery, QueryCacheKeyLocks, QueryCachePipelineSettings, Result, StampedeTestQuery |
| 5 | `CachingTestEntity` | MMCA.Common.Application.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `CallerScopedQueryCacheTests` | MMCA.Common.Application.Tests | 7 | CachingQueryDecorator<TQuery, TResult>, ICacheService, IQueryHandler<in TQuery, TResult>, MyOrdersQuery, PublicCardQuery, Result, UnscopedQuery |
| 5 | `ConfirmableAuthUser` | MMCA.Common.Application.Tests | 4 | AuditableAggregateRootEntity<TIdentifierType>, IAuthUser, IEmailConfirmableUser, Result |
| 5 | `ConfirmableUser` | MMCA.Common.Application.Tests | 4 | AuditableAggregateRootEntity<TIdentifierType>, Error, IEmailConfirmableUser, Result |
| 5 | `CqrsContractInspectorTests` | MMCA.Common.Application.Tests | 11 | AgreeingMarkedCommandHandler, AgreeingMarkedQueryHandler, CqrsContractInspector, CqrsContractMismatch, CqrsContractMismatchKind, DriftedMarkedCommand, DriftedMarkedCommandHandler, ICommandHandler<in TCommand, TResult>, Result, UnmarkedCommandHandler, WrongKindHandler |
| 5 | `DateTimeFilterStrategyTests` | MMCA.Common.Application.Tests | 3 | DateTimeFilterStrategy, Item, QueryFilterService |
| 5 | `DecimalFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 5 | `DomainEventDispatcherAdditionalTests` | MMCA.Common.Application.Tests | 16 | DomainEventDispatcher, EventUpcasterRegistry, IDomainEventHandler<in TDomainEvent>, IEventUpcasterRegistry, IIntegrationEventHandler<in TIntegrationEvent>, MultiHandlerEvent, MultiHandlerEventHandler1, MultiHandlerEventHandler2, RecordingDomainHandlerForRetired, RecordingIntegrationHandler<TEvent>, RetiredEvent, RetiredToSuccessorUpcaster, SuccessorEvent, TestDomainEventHandlerForIntegration, TestIntegrationEvent, TestIntegrationEventHandler |
| 5 | `DomainEventDispatcherTests` | MMCA.Common.Application.Tests | 8 | DomainEventDispatcher, IDomainEventHandler<in TDomainEvent>, IIntegrationEventHandler<in TIntegrationEvent>, TestEvent, TestEventHandler, TestIntegrationEvent, TestIntegrationEventDomainHandler, TestIntegrationEventHandler |
| 5 | `EntityQueryParametersTests` | MMCA.Common.Application.Tests | 2 | EntityQueryParameters<TEntity>, TestEntity |
| 5 | `EventUpcasterRegistryTests` | MMCA.Common.Application.Tests | 13 | CustomerRenamedV1, CustomerRenamedV2, CustomerRenamedV3, EnvelopeCopyingV1ToV2Upcaster, EventUpcasterRegistry, IEventUpcaster, IIntegrationEvent, RivalV1ToV3Upcaster, SelfMappingUpcaster, UnrelatedEvent, V1ToV2Upcaster, V2ToV1Upcaster, V2ToV3Upcaster |
| 5 | `FakeEntityDTOMapper` | MMCA.Common.Application.Tests | 3 | FakeEntity, FakeEntityDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 5 | `FeatureGateCommandDecoratorTests` | MMCA.Common.Application.Tests | 6 | FeatureGateCommandDecorator<TCommand, TResult>, FeatureGatedCommand, FeatureGatedCommandWithValue, ICommandHandler<in TCommand, TResult>, PlainCommand, Result |
| 5 | `FeatureGateQueryDecoratorTests` | MMCA.Common.Application.Tests | 6 | FeatureGatedQuery, FeatureGatedQueryNonGeneric, FeatureGateQueryDecorator<TQuery, TResult>, IQueryHandler<in TQuery, TResult>, PlainQuery, Result |
| 5 | `GuidFilterStrategyTests` | MMCA.Common.Application.Tests | 3 | Item, QueryFilterService, Tag |
| 5 | `IntFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 5 | `LoggingCommandDecoratorTests` | MMCA.Common.Application.Tests | 9 | BillingFakeCommand, Error, ICommandHandler<in TCommand, TResult>, ICorrelationContext, LoggingCommandDecorator<TCommand, TResult>, Mocks, Result, ScopeCapturingLogger<TCategoryName>, TestLoggingCommand |
| 5 | `LoggingQueryDecoratorTests` | MMCA.Common.Application.Tests | 8 | BillingFakeQuery, ICorrelationContext, IQueryHandler<in TQuery, TResult>, LoggingQueryDecorator<TQuery, TResult>, Mocks, Result, ScopeCapturingLogger<TCategoryName>, TestLoggingQuery |
| 5 | `LongFilterStrategyTests` | MMCA.Common.Application.Tests | 2 | Item, QueryFilterService |
| 5 | `MixedEntity` | MMCA.Common.Application.Tests | 3 | AuditableBaseEntity<TIdentifierType>, ChildC, RelatedC |
| 5 | `OrderAggregate` | MMCA.Common.Application.Tests | 4 | AuditableAggregateRootEntity<TIdentifierType>, Error, OrderLine, Result |
| 5 | `OrderEntity` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, OrderLineEntity |
| 5 | `PrimitiveMapper` | MMCA.Common.Application.Tests | 4 | MappedOrder, MappedOrderId, OrderPrimitiveDTO, StronglyTypedIdMappings<TSelf, TValue> |
| 5 | `QueryFilterServicePropertyCacheTests` | MMCA.Common.Application.Tests | 2 | QueryFilterService, Widget |
| 5 | `QueryFilterServiceTests` | MMCA.Common.Application.Tests | 3 | Product, QueryFilterService, TestStrategy |
| 5 | `QueryFilterServiceValidateTests` | MMCA.Common.Application.Tests | 2 | Product, QueryFilterService |
| 5 | `ReadOnlyCollectionEntity` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, ChildD |
| 5 | `ResolvedProjector` | MMCA.Common.Application.Tests | 3 | IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>, ResolvedEntity, ResolvedEntityDTO |
| 5 | `ResolvedProjectorMarker` | MMCA.Common.Application.Tests | 3 | IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>, ResolvedEntity, ResolvedEntityDTO |
| 5 | `ScopedIntegrationEventHandlerBaseTests` | MMCA.Common.Application.Tests | 6 | CustomLoggingIntegrationEventHandler, RecordingLogger, ScopedProbe, TestIntegrationEvent, TestIntegrationEvent, TestScopedIntegrationEventHandler |
| 5 | `SoftDeletedUserCacheTests` | MMCA.Common.Application.Tests | 2 | ICacheService, SoftDeletedUserCache |
| 5 | `SpyMapper` | MMCA.Common.Application.Tests | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, ProjectedEntity, ProjectedEntityDTO |
| 5 | `StringFilterStrategyTests` | MMCA.Common.Application.Tests | 3 | Item, QueryFilterService, StringFilterStrategy |
| 5 | `StronglyTypedIdFilterStrategyTests` | MMCA.Common.Application.Tests | 4 | Item, OrderId, QueryFilterService, SkuId |
| 5 | `SupportedChild` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, ChildA |
| 5 | `SupportedFK` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, RelatedA |
| 5 | `TestAggregateEntity` | MMCA.Common.Application.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestAuthUser` | MMCA.Common.Application.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, IAuthUser |
| 5 | `TestBeginHandler` | MMCA.Common.Application.Tests | 4 | BeginTwoFactorEnrollmentHandlerBase<TCommand>, ITwoFactorService, ITwoFactorStore, TestTwoFactorCommand |
| 5 | `TestConfirmHandler` | MMCA.Common.Application.Tests | 4 | ConfirmTwoFactorEnrollmentHandlerBase<TCommand>, ITwoFactorService, ITwoFactorStore, TestTwoFactorCommand |
| 5 | `TestDeleteBlobCommand` | MMCA.Common.Application.Tests | 1 | IDeleteBlobInternalCommand |
| 5 | `TestDisableHandler` | MMCA.Common.Application.Tests | 4 | DisableTwoFactorHandlerBase<TCommand>, ITwoFactorAuthenticator, ITwoFactorStore, TestTwoFactorCommand |
| 5 | `TestIdentityUser` | MMCA.Common.Application.Tests | 6 | AuditableAggregateRootEntity<TIdentifierType>, Error, IErasableUser, IPasswordChangeableUser, IUserPreferences, Result |
| 5 | `TestProjector` | MMCA.Common.Application.Tests | 3 | IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>, ProjectedEntity, ProjectedEntityDTO |
| 5 | `TestRegenerateHandler` | MMCA.Common.Application.Tests | 5 | ITwoFactorAuthenticator, ITwoFactorService, ITwoFactorStore, RegenerateRecoveryCodesHandlerBase<TCommand>, TestTwoFactorCommand |
| 5 | `TimeoutCommandDecoratorTests` | MMCA.Common.Application.Tests | 5 | BudgetedCommand, ICommandHandler<in TCommand, TResult>, Result, TimeoutCommandDecorator<TCommand, TResult>, UnbudgetedCommand |
| 5 | `TimeoutQueryDecoratorTests` | MMCA.Common.Application.Tests | 5 | BudgetedQuery, IQueryHandler<in TQuery, TResult>, Result, TimeoutQueryDecorator<TQuery, TResult>, UnbudgetedQuery |
| 5 | `UnsupportedChild` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, ChildB |
| 5 | `UnsupportedFK` | MMCA.Common.Application.Tests | 2 | AuditableBaseEntity<TIdentifierType>, RelatedB |
| 5 | `ValidatingCommandDecoratorTests` | MMCA.Common.Application.Tests | 4 | ICommandHandler<in TCommand, TResult>, Result, TestValidatingCommand, ValidatingCommandDecorator<TCommand, TResult> |
| 5 | `ValidatingQueryDecoratorTests` | MMCA.Common.Application.Tests | 5 | ErrorType, IQueryHandler<in TQuery, TResult>, Result, TestValidatingQuery, ValidatingQueryDecorator<TQuery, TResult> |
| 5 | `WrapperMapper` | MMCA.Common.Application.Tests | 2 | MappedOrder, OrderWrapperDTO |
| 5 | `AnonymousEndpointTests` | MMCA.Common.Architecture.Tests | 3 | AnonymousEndpointTestsBase, ApiControllerBase, UISharedAssemblyReference |
| 5 | `CancellationTestMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, CancellationTokenFitnessTests, Layer, LayerRef |
| 5 | `CancellationTokenFitnessTests` | MMCA.Common.Architecture.Tests | 7 | ArchitectureRules, CancellationTestMap, CompliantFixtureService, ExemptableFixtureService, MisnamedTokenFixtureService, MisplacedTokenFixtureService, MissingTokenFixtureService |
| 5 | `ChildlessFixture` | MMCA.Common.Architecture.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `CommandValidatorCoverageFitnessTests` | MMCA.Common.Architecture.Tests | 8 | ArchitectureRules, ArchiveTicketCommand, CreateTicketCommand, FixtureModuleMap, PurgeTicketsCommand, RebuildTicketIndexCommand, ReopenTicketCommand, UpdateTicketCommand |
| 5 | `ConformantTests` | MMCA.Common.Architecture.Tests | 3 | ConstructorDependencyCountTestsBase, FixtureMap, IArchitectureMap |
| 5 | `CycleTestMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, Layer, LayerRef, NamespaceCycleFitnessTests |
| 5 | `DataSubjectSample` | MMCA.Common.Architecture.Tests | 3 | Email, IAnonymizable, Result |
| 5 | `DbSetRemovingFixture` | MMCA.Common.Architecture.Tests | 1 | FixtureEntity |
| 5 | `EmptyScanTests` | MMCA.Common.Architecture.Tests | 3 | BareMap, ConstructorDependencyCountTestsBase, IArchitectureMap |
| 5 | `ErrorCatalogFitnessTests` | MMCA.Common.Architecture.Tests | 7 | ArchitectureRules, DuplicateTicketErrors, DynamicErrors, FixtureModuleMap, SharedCodeErrors, TicketErrors, UnprefixedErrors |
| 5 | `ExecuteDeletingFixture` | MMCA.Common.Architecture.Tests | 1 | FixtureEntity |
| 5 | `ExemptedOffenderFixture` | MMCA.Common.Architecture.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, CascadeChildFixture |
| 5 | `FitnessDependent` | MMCA.Common.Architecture.Tests | 2 | AuditableBaseEntity<TIdentifierType>, FitnessPrincipal |
| 5 | `FixtureAssemblyMap` | MMCA.Common.Architecture.Tests | 7 | ArchitectureMapBase, CascadeChildFixture, FixtureEntity, InjectedClockFixture, Layer, LayerRef, NonThrowingFixture |
| 5 | `FixtureLeakingEvent` | MMCA.Common.Architecture.Tests | 2 | BaseIntegrationEvent, FixtureLeakedPayload |
| 5 | `FormsConventionTestsBaseTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureMapBase, FormsConventionTestsBase |
| 5 | `ForwardedJwtAudienceFitnessTests` | MMCA.Common.Architecture.Tests | 3 | ArchitectureMapBase, ArchitectureRules, JwtAudience |
| 5 | `HelperCascadingFixture` | MMCA.Common.Architecture.Tests | 3 | AuditableAggregateRootEntity<TIdentifierType>, CascadeChildFixture, Result |
| 5 | `IdempotencyFitnessTests` | MMCA.Common.Architecture.Tests | 7 | AbstractFitnessControllerBase, ArchitectureRules, IdempotencyTestMap, IdempotentFitnessController, InheritingFitnessController, NonIdempotentFitnessController, UndeclaredFitnessController |
| 5 | `IdempotencyTestMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, IdempotencyFitnessTests, Layer, LayerRef |
| 5 | `IdentifierFixtureMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, Layer, LayerRef, StronglyTypedIdFitnessTests |
| 5 | `InlineStyleFitnessTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureMapBase, ArchitectureRules |
| 5 | `LayerDependencyOverrideTests` | MMCA.Common.Architecture.Tests | 4 | ArchitectureRules, FakeArchitectureMap, Layer, LayerRef |
| 5 | `LoopCascadingFixture` | MMCA.Common.Architecture.Tests | 3 | AuditableAggregateRootEntity<TIdentifierType>, CascadeChildFixture, Result |
| 5 | `LooseCeilingTests` | MMCA.Common.Architecture.Tests | 3 | ConstructorDependencyCountTestsBase, FixtureMap, IArchitectureMap |
| 5 | `MissingOverrideFixture` | MMCA.Common.Architecture.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, CascadeChildFixture |
| 5 | `NamespaceCycleFitnessTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureRules, CycleTestMap |
| 5 | `NavigationContractTests` | MMCA.Common.Architecture.Tests | 2 | NavigationContractTests, UISharedAssemblyReference |
| 5 | `ProtoContractFitnessTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureMapBase, ArchitectureRules |
| 5 | `ReadRepositoryFixtureAggregate` | MMCA.Common.Architecture.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `SelfOnlyDeleteFixture` | MMCA.Common.Architecture.Tests | 3 | AuditableAggregateRootEntity<TIdentifierType>, CascadeChildFixture, Result |
| 5 | `SliceCohesionFitnessTests` | MMCA.Common.Architecture.Tests | 5 | ArchitectureRules, FixtureApplicationMap, GetFixtureEntityHandlerBase<TQuery>, GetFixturePreferencesHandlerBase, StrandedFixtureHandlerBase |
| 5 | `SoftDeletingFixture` | MMCA.Common.Architecture.Tests | 1 | FixtureEntity |
| 5 | `SortableColumnFitnessTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureMapBase, ArchitectureRules |
| 5 | `StronglyTypedIdFitnessTests` | MMCA.Common.Architecture.Tests | 7 | ArchitectureRules, CompliantFixtureId, CompliantStringFixtureId, ExtraStateFixtureId, IdentifierFixtureMap, MutableFixtureId, NotARecordFixtureId |
| 5 | `TightCeilingTests` | MMCA.Common.Architecture.Tests | 3 | ConstructorDependencyCountTestsBase, FixtureMap, IArchitectureMap |
| 5 | `GatewayHealthCheckExtensions` | MMCA.Common.Aspire | 5 | DownstreamServiceHealthCheck, GatewayDownstreamHealthCheckOptions, GatewayDownstreamRegistry, HealthCheckTags, Register |
| 5 | `QueryPipelineBenchmarks` | MMCA.Common.Benchmarks | 3 | ProductRow, QueryFieldService, QueryFilterService |
| 5 | `AndSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 4 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Specification<TEntity, TIdentifierType>, SpecificationComposer |
| 5 | `CommonInvariants` | MMCA.Common.Domain | 4 | Error, Money, Result, SupportedCultures |
| 5 | `NotSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 4 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Specification<TEntity, TIdentifierType>, SpecificationComposer |
| 5 | `OrSpecification<TEntity, TIdentifierType>` | MMCA.Common.Domain | 4 | IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Specification<TEntity, TIdentifierType>, SpecificationComposer |
| 5 | `UserNotification` | MMCA.Common.Domain | 2 | AuditableAggregateRootEntity<TIdentifierType>, Result |
| 5 | `AgeGreaterThanSpec` | MMCA.Common.Domain.Tests | 2 | Specification<TEntity, TIdentifierType>, TestEntity |
| 5 | `AgeGreaterThanSpecification` | MMCA.Common.Domain.Tests | 2 | CompositionTestEntity, Specification<TEntity, TIdentifierType> |
| 5 | `AgeRangeSpec` | MMCA.Common.Domain.Tests | 2 | Specification<TEntity, TIdentifierType>, TestEntity |
| 5 | `AuditableBaseEntityAdditionalTests` | MMCA.Common.Domain.Tests | 1 | UndeletableEntity |
| 5 | `AuditableBaseEntityTests` | MMCA.Common.Domain.Tests | 1 | TestEntity |
| 5 | `BaseEntityTests` | MMCA.Common.Domain.Tests | 6 | BaseEntity<TIdentifierType>, GuidIdEntity, IBaseEntity<TIdentifierType>, OtherTestEntity, StringIdEntity, TestEntity |
| 5 | `DefaultsSpecification` | MMCA.Common.Domain.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, QueryTestEntity |
| 5 | `EntityTypeExtensionsTests` | MMCA.Common.Domain.Tests | 2 | EntityWithGeneratedId, EntityWithoutGeneratedId |
| 5 | `FullyConfiguredSpecification` | MMCA.Common.Domain.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, QueryTestEntity |
| 5 | `NameEqualsSpec` | MMCA.Common.Domain.Tests | 2 | Specification<TEntity, TIdentifierType>, TestEntity |
| 5 | `NameStartsWithSpec` | MMCA.Common.Domain.Tests | 2 | Specification<TEntity, TIdentifierType>, TestEntity |
| 5 | `NameStartsWithSpecification` | MMCA.Common.Domain.Tests | 2 | CompositionTestEntity, Specification<TEntity, TIdentifierType> |
| 5 | `NegativePagingSpecification` | MMCA.Common.Domain.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, QueryTestEntity |
| 5 | `PagedSpecification` | MMCA.Common.Domain.Tests | 2 | CompositionTestEntity, QuerySpecification<TEntity, TIdentifierType> |
| 5 | `RefreshSessionTests` | MMCA.Common.Domain.Tests | 2 | RefreshSession, Result |
| 5 | `TestAggregate` | MMCA.Common.Domain.Tests | 5 | AuditableAggregateRootEntity<TIdentifierType>, ChildEntity, ReactivatableChildEntity, Result, UndeletableChildEntity |
| 5 | `UnshapedQuerySpecification` | MMCA.Common.Domain.Tests | 2 | CompositionTestEntity, QuerySpecification<TEntity, TIdentifierType> |
| 5 | `ValidatingAggregate` | MMCA.Common.Domain.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, ChildEntity |
| 5 | `AmbientOrigin` | MMCA.Common.Infrastructure | 6 | AuthClaimTypes, ICorrelationContext, ITenantContext, OriginSnapshot, RestoreHandle, ScopedUserOverride |
| 5 | `EmailIdentity` | MMCA.Common.Infrastructure | 1 | Email |
| 5 | `EmailValueConverter` | MMCA.Common.Infrastructure | 1 | Email |
| 5 | `EntityTypeBuilderExtensions` | MMCA.Common.Infrastructure | 4 | Address, AddressInvariants, Currency, Money |
| 5 | `EntityTypeConfigurationBase<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 4 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IAggregateRoot, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 2 | AuditableBaseEntity<TIdentifierType>, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `IEntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 2 | AuditableBaseEntity<TIdentifierType>, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 2 | AuditableBaseEntity<TIdentifierType>, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 2 | AuditableBaseEntity<TIdentifierType>, IEntityTypeConfigurationBase<TEntity, TIdentifierType> |
| 5 | `KeysetQueryBuilder` | MMCA.Common.Infrastructure | 4 | IBaseEntity<TIdentifierType>, QueryTags, SpecificationEvaluator, ValueHolder<T> |
| 5 | `NullableEmailValueConverter` | MMCA.Common.Infrastructure | 1 | Email |
| 5 | `NullablePhoneNumberValueConverter` | MMCA.Common.Infrastructure | 1 | PhoneNumber |
| 5 | `OriginSnapshot` | MMCA.Common.Infrastructure | 1 | AmbientOrigin |
| 5 | `PermissionGrantCache` | MMCA.Common.Infrastructure | 4 | IPermissionGrantCache, IPermissionGrantCacheInvalidator, IPermissionGrantStore, PermissionGrantSettings |
| 5 | `PhoneNumberValueConverter` | MMCA.Common.Infrastructure | 1 | PhoneNumber |
| 5 | `RefreshSessionModelBuilderExtensions` | MMCA.Common.Infrastructure | 1 | RefreshSession |
| 5 | `RestoreHandle` | MMCA.Common.Infrastructure | 1 | OriginSnapshot |
| 5 | `ScopedUserOverride` | MMCA.Common.Infrastructure | 2 | AmbientOrigin, Principal |
| 5 | `StoredPermissionRoleAdministrationService` | MMCA.Common.Infrastructure | 12 | AdministrationPermissions, Error, IPermissionCatalog, IPermissionGrantCache, IPermissionGrantCacheInvalidator, IPermissionGrantStore, IPermissionRegistry, IRoleAdministrationService, PermissionCatalogResponse, PermissionGrantSettings, Result, RolePermissionsResponse |
| 5 | `PgThing` | MMCA.Common.Infrastructure.PostgreSQL.Tests | 3 | AuditableAggregateRootEntity<TIdentifierType>, PgThingCreated, PgThingShipped |
| 5 | `DistributedCacheServiceRedisTests` | MMCA.Common.Infrastructure.Redis.Tests | 1 | DistributedCacheService |
| 5 | `HybridCacheServiceRedisTests` | MMCA.Common.Infrastructure.Redis.Tests | 3 | DistributedCacheService, HybridCacheService, ICacheService |
| 5 | `SqlThing` | MMCA.Common.Infrastructure.SQLServer.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, SqlThingShipped |
| 5 | `AddCommonHybridCacheTests` | MMCA.Common.Infrastructure.Tests | 5 | CacheOptions, DistributedCacheService, HybridCacheService, ICacheService, MemoryCacheService |
| 5 | `AuditedAggregateThing` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, IAuditedEntity |
| 5 | `AzureNotificationHubDeviceRegistrarTests` | MMCA.Common.Infrastructure.Tests | 1 | AzureNotificationHubDeviceRegistrar |
| 5 | `CascadingChild` | MMCA.Common.Infrastructure.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Parent |
| 5 | `DegradeCustomer` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, DegradeOrder |
| 5 | `DegradeOrder` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, DegradeCustomer |
| 5 | `DesignAlphaEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `DesignBetaEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `DesignPostgreSQLEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `DesignSqliteEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `EnumerationValueConverterTests` | MMCA.Common.Infrastructure.Tests | 3 | EnumerationValueConverter<TEnumeration>, NullableEnumerationValueConverter<TEnumeration>, Priority |
| 5 | `EventUpcasterStartupValidatorTests` | MMCA.Common.Infrastructure.Tests | 8 | EventUpcasterRegistry, EventUpcasterStartupValidator, IEventUpcaster, IEventUpcasterRegistry, RivalV1ToV3Upcaster, SampleV1ToV2Upcaster, ValidatorSampleV1, ValidatorSampleV2 |
| 5 | `ExclusionAggregate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `ExecutionLog` | MMCA.Common.Infrastructure.Tests | 3 | RecordedExecution, RecordingCommand, Result |
| 5 | `FakeAggregate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `FakeAggregate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `FakeAggregateEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `FakeGrantStore` | MMCA.Common.Infrastructure.Tests | 3 | IPermissionGrantStore, PermissionGrant, Result |
| 5 | `FileUploadOptionsOverloadTests` | MMCA.Common.Infrastructure.Tests | 3 | FileUploadOptions, NullFileStorageService, Result |
| 5 | `FilteredIndexTestDbContext` | MMCA.Common.Infrastructure.Tests | 5 | CosmosIndexedEntity, DataSource, RenamedFlagEntity, SqliteIndexedEntity, SqlServerIndexedEntity |
| 5 | `HandRolledOwner` | MMCA.Common.Infrastructure.Tests | 2 | Address, Money |
| 5 | `HelperOwner` | MMCA.Common.Infrastructure.Tests | 2 | Address, Money |
| 5 | `HybridCacheServiceTests` | MMCA.Common.Infrastructure.Tests | 9 | CacheKeyNamespace, CacheOptions, CacheSettings, DistributedCacheService, FaultingHybridCache, HybridCacheService, ICacheService, RecordingDistributedCache, RecordingHybridCache |
| 5 | `ImageSharpImageProcessorFrameBoundTests` | MMCA.Common.Infrastructure.Tests | 3 | CountingAllocator, ImageFrameBoundCollection, ImageSharpImageProcessor |
| 5 | `ImageSharpImageProcessorTests` | MMCA.Common.Infrastructure.Tests | 1 | ImageSharpImageProcessor |
| 5 | `IntegrityAggregate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `InternalCommandMessageTypeCacheTests` | MMCA.Common.Infrastructure.Tests | 2 | InternalCommandMessage, Payload |
| 5 | `MemoryCacheServiceTests` | MMCA.Common.Infrastructure.Tests | 5 | CacheSettings, EvictionSignalingMemoryCache, ICacheService, KeyedSemaphoreStripe, MemoryCacheService |
| 5 | `MultiSourceCustomer` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `OptionalChild` | MMCA.Common.Infrastructure.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Parent |
| 5 | `PermissionGrantModelBuilderExtensionsTests` | MMCA.Common.Infrastructure.Tests | 5 | GrantOnlyCustomSchemaContext, GrantOnlyPostgreSqlContext, GrantOnlySqlServerContext, PermissionGrant, PermissionGrantModelBuilderExtensions |
| 5 | `PortablePrincipal` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `PostgresThing` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RecordingCommandValidator` | MMCA.Common.Infrastructure.Tests | 1 | RecordingCommand |
| 5 | `RegistryDuplicate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RegistryInvoice` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RegistryOrder` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RegistrySqlServerEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `RequiredChild` | MMCA.Common.Infrastructure.Tests | 2 | AuditableBaseEntity<TIdentifierType>, Parent |
| 5 | `SoftDeleteTestDbContext` | MMCA.Common.Infrastructure.Tests | 1 | SoftDeletableTestEntity |
| 5 | `SpecTestEntity` | MMCA.Common.Infrastructure.Tests | 3 | AuditableBaseEntity<TIdentifierType>, Email, SpecTestChild |
| 5 | `SqliteTestEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `SqlServerThing` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `StampedEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestAggregate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestAggregate` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestAggregateEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestEntity` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TestSeedUser` | MMCA.Common.Infrastructure.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `TwoFactorAuthenticatorTests` | MMCA.Common.Infrastructure.Tests | 12 | Error, ErrorType, FakeCacheService, FakeTwoFactorStore, ICacheService, RecoveryCodeSet, Result, TotpTwoFactorService, TwoFactorAuthenticator, TwoFactorErrors, TwoFactorOutcome, TwoFactorSettings |
| 5 | `WarningCountingLogger` | MMCA.Common.Infrastructure.Tests | 1 | DistributedCacheService |
| 5 | `WrappedOrder` | MMCA.Common.Infrastructure.Tests | 3 | AuditableAggregateRootEntity<TIdentifierType>, CustomerId, OrderId |
| 5 | `LoadItem` | MMCA.Common.LoadTests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `StronglyTypedIdTypeConverters` | MMCA.Common.Shared | 3 | Register, StronglyTypedId, StronglyTypedIdTypeConverter<TSelf, TValue> |
| 5 | `Alert` | MMCA.Common.Shared.Tests | 2 | Severity, Severity |
| 5 | `ClaimsPrincipalExtensionsTests` | MMCA.Common.Shared.Tests | 2 | AuthClaimTypes, Principal |
| 5 | `CurrencyJsonConverterTests` | MMCA.Common.Shared.Tests | 2 | Currency, Money |
| 5 | `EmailTests` | MMCA.Common.Shared.Tests | 1 | Email |
| 5 | `EnumerationTests` | MMCA.Common.Shared.Tests | 2 | Priority, Severity |
| 5 | `MoneySerializationTests` | MMCA.Common.Shared.Tests | 2 | Currency, Money |
| 5 | `MoneyTests` | MMCA.Common.Shared.Tests | 2 | Currency, Money |
| 5 | `PhoneNumberTests` | MMCA.Common.Shared.Tests | 1 | PhoneNumber |
| 5 | `StronglyTypedIdSerializationTests` | MMCA.Common.Shared.Tests | 6 | CustomerId, OrderDto, OrderId, SkuId, SpeakerId, StronglyTypedIdJsonConverterFactory |
| 5 | `ValueObjectTests` | MMCA.Common.Shared.Tests | 7 | Address, Currency, DateRange, DateTimeRange, Money, TestValueObject, ValueObject |
| 5 | `AggregateConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `AiDependencyIsolationTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `CancellationTokenConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `CascadeSoftDeleteConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ClockReadTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `CommandValidatorCoverageTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ConcurrencyConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ContractImplementationTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ControllerConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `DeleteBehaviorConventionTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 5 | `DependencyVersionTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 5 | `DomainEventHandlerSaveTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `DomainPurityTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `DomainThrowTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `EntityConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ErrorCatalogTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `EventConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `FeatureFlagLifecycleTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `FolderWidthTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 5 | `ForwardedJwtAudienceTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureMapBase, ArchitectureRules, IArchitectureMap |
| 5 | `HandlerConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `HandlerResultConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `IdempotencyConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ImmutabilityTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `InlineStyleTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 5 | `IntegrationEventContractTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureAssert, ArchitectureRules, IArchitectureMap |
| 5 | `IntegrationEventPayloadPurityTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `LayerDependencyTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureRules, IArchitectureMap, Layer |
| 5 | `LifetimeTokenConventionTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 5 | `LocalizationResourceTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 5 | `LocalizedTextConventionTestsBase` | MMCA.Common.Testing.Architecture | 3 | ArchitectureMapBase, ArchitectureRules, IArchitectureMap |
| 5 | `MicroserviceExtractionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ModuleIsolationTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `NamespaceCycleTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `NamingConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `PiiConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ProtoContractTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 5 | `QueryHandlerReadRepositoryTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `ServiceContractPurityTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `SharedLayerTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `SliceCohesionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `SoftDeleteEnforcementTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `SortableColumnConventionTestsBase` | MMCA.Common.Testing.Architecture | 1 | ArchitectureRules |
| 5 | `SpecificationConventionTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `StronglyTypedIdTestsBase` | MMCA.Common.Testing.Architecture | 2 | ArchitectureRules, IArchitectureMap |
| 5 | `SampleAppHostTests` | MMCA.Common.Testing.Aspire.AppHostTests | 4 | AppHostProbePaths, AppHostTestBase<TFixture>, SampleAppHostCollection, SampleAppHostFixture |
| 5 | `TestAggregate` | MMCA.Common.Testing.Tests | 1 | AuditableAggregateRootEntity<TIdentifierType> |
| 5 | `ConfirmEmailPageTestsBase` | MMCA.Common.Testing.UI | 6 | BunitComponentTestBase, ConfirmEmail, Email, Error, IEmailConfirmationUIService, Result |
| 5 | `IAuthUIService` | MMCA.Common.UI | 5 | AuthenticationResponse, LoginRequest, RefreshSessionSummaryResponse, RegisterRequest, Result |
| 5 | `MoneyExtensions` | MMCA.Common.UI | 1 | Money |
| 5 | `NotificationRoutePaths` | MMCA.Common.UI | 1 | NotificationInbox |
| 5 | `PushNotificationService` | MMCA.Common.UI | 8 | EntityServiceBase<TEntityDTO, TIdentifierType>, INotificationScopeProvider, IPushNotificationUIService, ITokenStorageService, PagedCollectionResult<T>, PushNotificationDTO, Result, SendPushNotificationRequest |
| 5 | `UserAdminList<TUser>` | MMCA.Common.UI | 8 | IAppDialogService, IUserAdminActionsUIService, IUserAdminDTO, IUserAdminUIService<TUserDto>, ListPageActions, MobileInfiniteScrollList<TItem>, Result, UserAdminListResources |
| 5 | `UserAdminService<TUserDto>` | MMCA.Common.UI | 8 | AuthenticatedServiceBase, HttpResultExecutor, ITokenStorageService, IUserAdminUIService<TUserDto>, PagedCollectionResult<T>, ProblemDetailsResultReader, Result, SetUserRolesRequest |
| 5 | `AuthModelValidationTests` | MMCA.Common.UI.Tests | 4 | Email, LoginModel, RegisterModel, ResetPasswordModel |
| 5 | `DataGridListPageBaseTests` | MMCA.Common.UI.Tests | 11 | BunitTestBase, DataGridListPageBase<TDto>, Error, GridBackedTestPage, IToastService, ListPageStateService, Result, State, TestGridPage, ToastSeverity, WidgetRow |
| 5 | `EditorShell` | MMCA.Common.UI.Tests | 1 | RoleAdminEdit |
| 5 | `EmailConfirmationUIServiceTests` | MMCA.Common.UI.Tests | 4 | CapturingHttpMessageHandler, EmailConfirmationUIService, ErrorType, HttpTestDoubles |
| 5 | `ForeignKeyWidgetService` | MMCA.Common.UI.Tests | 3 | EntityServiceBase<TEntityDTO, TIdentifierType>, ITokenStorageService, WidgetDto |
| 5 | `LegalAcceptanceUIServiceTests` | MMCA.Common.UI.Tests | 5 | CapturingHttpMessageHandler, HttpTestDoubles, LegalAcceptanceDTO, LegalAcceptanceErrorCodes, LegalAcceptanceUIService |
| 5 | `ListPageActionsTests` | MMCA.Common.UI.Tests | 6 | BunitTestBase, Error, IToastService, ListPageActions, MobileInfiniteScrollList<TItem>, Result |
| 5 | `MembershipService` | MMCA.Common.UI.Tests | 4 | ChildEntityServiceBase, ITokenStorageService, MembershipDto, Result |
| 5 | `MmcaThemeProvidersInitialModeTests` | MMCA.Common.UI.Tests | 4 | BunitTestBase, FixedInitialThemeModeSource, IInitialThemeModeSource, MmcaThemeProvidersTests |
| 5 | `MmcaThemeProvidersPrerenderTests` | MMCA.Common.UI.Tests | 2 | BunitTestBase, MmcaThemeProvidersTests |
| 5 | `ModelValidationTests` | MMCA.Common.UI.Tests | 8 | AlwaysFailsValidator, ChildModel, DataAnnotationsModelValidator, Email, KeyedModel, ModelValidation, SampleModel, StubLocalizer |
| 5 | `MoneyExtensionsTests` | MMCA.Common.UI.Tests | 3 | CultureScope, Currency, Money |
| 5 | `NotificationInboxServiceTests` | MMCA.Common.UI.Tests | 11 | ErrorType, ITokenRefresher, ITokenStorageService, Mocks, NotificationInboxService, PagedCollectionResult<T>, PaginationMetadata, StubHttpClientFactory, StubHttpMessageHandler, StubScopeProvider, UserNotificationDTO |
| 5 | `NotificationInboxTests` | MMCA.Common.UI.Tests | 11 | BunitTestBase, Error, INotificationInboxUIService, IToastService, NotificationInbox, NotificationState, PagedCollectionResult<T>, PaginationMetadata, Result, ToastSeverity, UserNotificationDTO |
| 5 | `OptionalEmailAttributeTests` | MMCA.Common.UI.Tests | 5 | BareEmailModel, DataAnnotationsModelValidator, Email, EmailModel, StubLocalizer |
| 5 | `ResultUiExtensionsTests` | MMCA.Common.UI.Tests | 7 | Error, ErrorType, IToastService, Result, ResultUiExtensions, StubLocalizer, ToastSeverity |
| 5 | `RoleAdminEditTests` | MMCA.Common.UI.Tests | 9 | AdministrationPermissions, BunitTestBase, Error, IRoleAdminUIService, IToastService, PermissionCatalogResponse, Result, RoleAdminEdit, RolePermissionsResponse |
| 5 | `RoleAdminListTests` | MMCA.Common.UI.Tests | 7 | BunitTestBase, Error, IRoleAdminUIService, Result, RoleAdminList, RolePermissionsResponse, StubLocalizer |
| 5 | `RosterShell` | MMCA.Common.UI.Tests | 1 | RoleAdminList |
| 5 | `WidgetService` | MMCA.Common.UI.Tests | 6 | EntityServiceBase<TEntityDTO, TIdentifierType>, ITokenStorageService, IUiReadCache, PagedCollectionResult<T>, Result, WidgetDto |
| 5 | `ClientConfigEndpointTests` | MMCA.Common.UI.Web.Tests | 3 | ApiSettings, ClientConfigEndpointExtensions, Email |
| 6 | `AnonymousEndpointTests` | MMCA.ADC.Architecture.Tests | 4 | AnonymousEndpointTestsBase, ConferenceModule, EngagementModule, IdentityModule |
| 6 | `FolderWidthTests` | MMCA.ADC.Architecture.Tests | 2 | ArchitectureMapBase, FolderWidthTestsBase |
| 6 | `InlineStyleTests` | MMCA.ADC.Architecture.Tests | 2 | ArchitectureMapBase, InlineStyleTestsBase |
| 6 | `LifetimeTokenConventionTests` | MMCA.ADC.Architecture.Tests | 2 | ArchitectureMapBase, LifetimeTokenConventionTestsBase |
| 6 | `ProtoContractTests` | MMCA.ADC.Architecture.Tests | 1 | ProtoContractTestsBase |
| 6 | `SortableColumnConventionTests` | MMCA.ADC.Architecture.Tests | 2 | ArchitectureMapBase, SortableColumnConventionTestsBase |
| 6 | `TranslationCompletenessTests` | MMCA.ADC.Architecture.Tests | 1 | LocalizationResourceTestsBase |
| 6 | `DeleteSessionAssetBlobInternalCommandHandler` | MMCA.ADC.Conference.Application | 3 | DeleteBlobInternalCommandHandlerBase<TCommand>, DeleteSessionAssetBlobInternalCommand, IFileStorageService |
| 6 | `DeleteSessionAssetBlobInternalCommandValidator` | MMCA.ADC.Conference.Application | 1 | DeleteSessionAssetBlobInternalCommand |
| 6 | `ScoreEventSessionsInternalCommandHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | Error, IDistributedLock, ISessionScoresCacheEvictor, ISessionScoringRunner, Result, ScoreEventSessionsInternalCommand, ScoreEventSessionsInternalCommandHandler, ScoreEventSessionsResultDTO |
| 6 | `SpeakerDeletedHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | DomainEntityState, IEventBus, IIntegrationEvent, Mocks, SpeakerChanged, SpeakerDeletedHandler, SpeakerUnlinkedFromUser |
| 6 | `ActivityInvariants` | MMCA.ADC.Conference.Domain | 3 | ActivityDTO, CommonInvariants, Result |
| 6 | `Category` | MMCA.ADC.Conference.Domain | 7 | AuditableAggregateRootEntity<TIdentifierType>, CategoryChanged, CategoryInvariants, CategoryItem, CategoryItemChanged, DomainEntityState, Result |
| 6 | `CategoryInvariants` | MMCA.ADC.Conference.Domain | 6 | CategoryItem, CategoryItemDTO, CommonInvariants, ConferenceCategoryDTO, Error, Result |
| 6 | `CategoryItem` | MMCA.ADC.Conference.Domain | 5 | AuditableBaseEntity<TIdentifierType>, Category, CategoryInvariants, CategoryItem, Result |
| 6 | `EventInvariants` | MMCA.ADC.Conference.Domain | 5 | CommonInvariants, Error, EventDTO, Result, RoomDTO |
| 6 | `PartnerInvariants` | MMCA.ADC.Conference.Domain | 3 | CommonInvariants, PartnerDTO, Result |
| 6 | `QuestionInvariants` | MMCA.ADC.Conference.Domain | 4 | CommonInvariants, Error, QuestionDTO, Result |
| 6 | `SessionAssetInvariants` | MMCA.ADC.Conference.Domain | 5 | CommonInvariants, Error, Result, SessionAssetDTO, SessionAssetKind |
| 6 | `SessionInvariants` | MMCA.ADC.Conference.Domain | 5 | CommonInvariants, Error, Result, SessionDTO, SessionStatuses |
| 6 | `SpeakerInvariants` | MMCA.ADC.Conference.Domain | 3 | CommonInvariants, Result, SpeakerDTO |
| 6 | `SponsorInvariants` | MMCA.ADC.Conference.Domain | 4 | CommonInvariants, Result, SponsorDTO, SponsorTier |
| 6 | `SessionAiScoreTests` | MMCA.ADC.Conference.Domain.Tests | 1 | SessionAiScore |
| 6 | `ConferenceCategoryItemsPanel` | MMCA.ADC.Conference.UI | 12 | CategoryChanged, CategoryItemDTO, CategoryItemService, ConferenceCategoryDTO, ConferenceCategoryItemEditModel, DataAnnotationsModelValidator, ErrorMessages, ErrorType, ICategoryItemUIService, IConferenceCategoryUIService, IToastService, ModelValidation |
| 6 | `DependencyInjection` | MMCA.ADC.Conference.UI | 29 | CategoryItemLookupService, ConferenceUIModule, EventLookupService, EventSpeakerService, ICategoryItemLookupService, IEventLookupService, IEventSpeakerUIService, IOrganizerEventFeedbackUIService, IOrganizerSessionFeedbackUIService, IPublicSessionScheduleService, ISessionAssetUIService, ISessionCategoryItemUIService, ISessionSelectionUIService, ISessionSpeakerUIService, ISpeakerCategoryItemUIService, ISpeakerDashboardUIService, ISpeakerDetailLookupService, ISpeakerLookupService, OrganizerEventFeedbackService, OrganizerSessionFeedbackService …(+9) |
| 6 | `EventCreate` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, EventCreateModel, EventService, IEventUIService, IToastService, ModelValidation, Result |
| 6 | `EventList` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, DataGridListPageBase<TDto>, ErrorMessages, EventDTO, EventService, IEventUIService, ListPageActions, MobileInfiniteScrollList<TItem>, Result |
| 6 | `OrganizerEventFeedback` | MMCA.ADC.Conference.UI | 10 | ConferenceRoutePaths, EventLookupService, EventQuestionAnswerDTO, FeedbackQuestionLoader, IEventLookupService, IOrganizerEventFeedbackUIService, IQuestionUIService, IToastService, QuestionDTO, QuestionService |
| 6 | `OrganizerSessionFeedback` | MMCA.ADC.Conference.UI | 10 | ConferenceRoutePaths, FeedbackQuestionLoader, IOrganizerSessionFeedbackUIService, IQuestionUIService, ISessionUIService, IToastService, QuestionDTO, QuestionService, SessionQuestionAnswerDTO, SessionService |
| 6 | `QuestionCreate` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, IQuestionUIService, IToastService, ModelValidation, QuestionCreateModel, QuestionService, Result |
| 6 | `QuestionList` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, DataGridListPageBase<TDto>, ErrorMessages, IQuestionUIService, ListPageActions, MobileInfiniteScrollList<TItem>, QuestionDTO, QuestionService, Result |
| 6 | `RoomCreate` | MMCA.ADC.Conference.UI | 12 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IRoomUIService, IToastService, ModelValidation, Result, RoomCreateModel, RoomService |
| 6 | `SessionCreate` | MMCA.ADC.Conference.UI | 17 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IRoomUIService, ISessionUIService, IToastService, LatestLoadGuard, ModelValidation, Result, RoomDTO, RoomService, SessionCreateModel, SessionFormModel, SessionService |
| 6 | `SpeakerCategoryItemsPanel` | MMCA.ADC.Conference.UI | 6 | CategoryItemInfo, ISpeakerCategoryItemUIService, IToastService, SpeakerCategoryItemDTO, SpeakerCategoryItemService, SpeakerDTO |
| 6 | `SpeakerCreate` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, ISpeakerUIService, IToastService, ModelValidation, Result, SpeakerCreateModel, SpeakerService |
| 6 | `SpeakerDetail` | MMCA.ADC.Conference.UI | 18 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, ISessionUIService, ISpeakerDetailLookupService, ISpeakerUIService, IToastService, IUserUIService, ModelValidation, SessionDTO, SessionService, SpeakerDetailLookups, SpeakerDTO, SpeakerEditModel, SpeakerService, SpeakerUserSearch, UserListDTO, UserService |
| 6 | `SpeakerQr` | MMCA.ADC.Conference.UI | 4 | ConferenceRoutePaths, IPublicLinkBuilder, ISpeakerUIService, SpeakerService |
| 6 | `BunitTestBase` | MMCA.ADC.Conference.UI.Tests | 10 | ApiSettings, BunitComponentTestBase, IEventLookupService, InertEventLookupService, InertSessionAssetService, IPublicLinkBuilder, IPublicSessionScheduleService, ISessionAssetUIService, NavigationPublicLinkBuilder, PublicSessionScheduleService |
| 6 | `ClientUrlValidationTests` | MMCA.ADC.Conference.UI.Tests | 9 | ActivityCreateModel, ActivityEditModel, EventCreateModel, EventEditModel, PartnerCreateModel, PartnerEditModel, SpeakerCreateModel, SpeakerEditModel, SponsorCreateModel |
| 6 | `EventServiceTests` | MMCA.ADC.Conference.UI.Tests | 8 | CapturingHttpMessageHandler, ErrorType, EventDTO, EventService, HttpTestDoubles, IEventLookupService, ISpeakerLookupService, RefreshFromSessionizeResultDTO |
| 6 | `PublicSessionScheduleServiceTests` | MMCA.ADC.Conference.UI.Tests | 8 | Error, IConnectivityStatusService, ISessionUIService, PublicSessionScheduleService, RecordingCacheStore, Result, SessionDTO, SessionSchedulePageRequest |
| 6 | `RoomServiceTests` | MMCA.ADC.Conference.UI.Tests | 4 | CapturingHttpMessageHandler, HttpTestDoubles, RoomDTO, RoomService |
| 6 | `SessionSelectionServiceTests` | MMCA.ADC.Conference.UI.Tests | 9 | CapturingHttpMessageHandler, CategoryDistributionDTO, ErrorType, HttpTestDoubles, ScoreEventSessionsResultDTO, SessionSelectionDashboardDTO, SessionSelectionService, SpeakerLocalitySummary, SpeakerSessionOverlapDTO |
| 6 | `SpeakerEditModelTests` | MMCA.ADC.Conference.UI.Tests | 2 | SpeakerDTO, SpeakerEditModel |
| 6 | `SpeakerFormModelEmailTests` | MMCA.ADC.Conference.UI.Tests | 3 | Email, SpeakerEditModel, SpeakerFormModel |
| 6 | `SpeakerServiceTests` | MMCA.ADC.Conference.UI.Tests | 5 | CapturingHttpMessageHandler, HttpTestDoubles, ISpeakerLookupService, SpeakerDTO, SpeakerService |
| 6 | `AttendeeBadgeInvariants` | MMCA.ADC.Engagement.Domain | 2 | CommonInvariants, Result |
| 6 | `CheckInInvariants` | MMCA.ADC.Engagement.Domain | 4 | CheckInScope, CommonInvariants, Error, Result |
| 6 | `LeaderboardOptIn` | MMCA.ADC.Engagement.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, LeaderboardOptInChanged, LeaderboardOptInInvariants, Result |
| 6 | `LeaderboardOptInInvariants` | MMCA.ADC.Engagement.Domain | 3 | CommonInvariants, LeaderboardOptIn, Result |
| 6 | `LivePollInvariants` | MMCA.ADC.Engagement.Domain | 4 | CommonInvariants, LivePollDTO, LivePollOptionDTO, Result |
| 6 | `LivePollVoteInvariants` | MMCA.ADC.Engagement.Domain | 2 | CommonInvariants, Result |
| 6 | `PointsEntryInvariants` | MMCA.ADC.Engagement.Domain | 5 | CommonInvariants, Error, PointsActivityType, PointsSubjectKeys, Result |
| 6 | `SessionQuestionInvariants` | MMCA.ADC.Engagement.Domain | 3 | CommonInvariants, Result, SessionQuestionDTO |
| 6 | `SessionQuestionUpvoteInvariants` | MMCA.ADC.Engagement.Domain | 2 | CommonInvariants, Result |
| 6 | `UserSessionBookmarkInvariants` | MMCA.ADC.Engagement.Domain | 2 | CommonInvariants, Result |
| 6 | `IAttendeeLookupService` | MMCA.ADC.Engagement.UI | 2 | AttendeeSummary, Result |
| 6 | `PresenterView` | MMCA.ADC.Engagement.UI | 14 | ILivePollUIService, ISessionLookupService, ISessionQuestionUIService, IToastService, LiveBroadcastPatch, LivePollChannel, LivePollResultsDTO, NotificationHubService, QuestionService, QuestionStatus, Result, SessionInfo, SessionQuestionChannel, SessionQuestionDTO |
| 6 | `SessionFeedback` | MMCA.ADC.Engagement.UI | 14 | DataAnnotationsModelValidator, ErrorType, FeedbackAnswerModel, IEntityService<TEntityDTO, TIdentifierType>, IQuestionLookupService, ISessionFeedbackUIService, IToastService, ModelValidation, QuestionDTO, Result, SessionDTO, SessionQuestionAnswerDTO, SessionService, SessionStatuses |
| 6 | `SessionLive` | MMCA.ADC.Engagement.UI | 18 | EngagementRoutePaths, ErrorType, ILivePollUIService, ISessionLookupService, ISessionQuestionUIService, IToastService, LiveBroadcastPatch, LiveChannelSubscription, LivePollChannel, LivePollDTO, LivePollResultsDTO, NotificationHubService, QuestionService, Result, RoleNames, SessionInfo, SessionQuestionChannel, SessionQuestionDTO |
| 6 | `SessionLiveQuestionPanel` | MMCA.ADC.Engagement.UI | 9 | ErrorType, ISessionQuestionUIService, ISpeechToTextService, IToastService, QuestionService, QuestionStatus, Result, SessionQuestionDTO, SubmitQuestionRequest |
| 6 | `MyBadgeTests` | MMCA.ADC.Engagement.UI.Tests | 7 | BunitComponentTestBase, Error, ICheckInUIService, MyBadge, MyBadgeDTO, Result, TestPrincipal |
| 6 | `MyPointsTests` | MMCA.ADC.Engagement.UI.Tests | 12 | BunitComponentTestBase, Entry, Error, IPointsUIService, LeaderboardEntryDTO, MyPoints, MyPointsDTO, PointsActivityType, PointsEntryDTO, PointsSubjectKeys, Result, TestPrincipal |
| 6 | `OrganizerPointsOverviewTests` | MMCA.ADC.Engagement.UI.Tests | 13 | BunitComponentTestBase, Entry, Error, IPointsUIService, OrganizerPointsOverview, PointsActivityTotalDTO, PointsActivityType, PointsEntryDTO, PointsOverviewDTO, PointsSubjectKeys, Result, RoleNames, TestPrincipal |
| 6 | `SessionBookmarkUIServiceTests` | MMCA.ADC.Engagement.UI.Tests | 9 | CapturingHttpMessageHandler, HttpTestDoubles, ILiveEventUIService, InMemoryDevicePreferences, ISessionLookupService, NullLocalNotificationService, SessionBookmarkUIService, SessionReminderCoordinator, UserSessionBookmarkDTO |
| 6 | `SponsorVisitTests` | MMCA.ADC.Engagement.UI.Tests | 7 | BunitComponentTestBase, CheckInErrorCodes, ICheckInUIService, SelfCheckInOutcome<TResult>, SponsorVisit, SponsorVisitResultDTO, TestPrincipal |
| 6 | `UsersAdminController` | MMCA.ADC.Identity.API | 4 | IUserAdministrationService<TUserDto>, Route, UserAdminDTO, UsersAdminControllerBase<TUserDto> |
| 6 | `DependencyInjectionTests` | MMCA.ADC.Identity.API.Tests | 3 | ApplicationSettings, DependencyInjectionAssert, IAuthenticationService |
| 6 | `UserClaimsControllerTests` | MMCA.ADC.Identity.API.Tests | 2 | AuthClaimTypes, UserClaimsController |
| 6 | `DeleteAvatarBlobInternalCommandHandler` | MMCA.ADC.Identity.Application | 3 | DeleteAvatarBlobInternalCommand, DeleteBlobInternalCommandHandlerBase<TCommand>, IFileStorageService |
| 6 | `DeleteAvatarBlobInternalCommandValidator` | MMCA.ADC.Identity.Application | 1 | DeleteAvatarBlobInternalCommand |
| 6 | `UserInvariants` | MMCA.ADC.Identity.Domain | 4 | CommonInvariants, Error, Result, UserRole |
| 6 | `Profile` | MMCA.ADC.Identity.UI | 6 | IAuthUIService, IMediaPickerService, IToastService, IUserUIService, PickedMedia, UserService |
| 6 | `UserDetail` | MMCA.ADC.Identity.UI | 7 | IAppDialogService, IdentityRoutePaths, IToastService, IUserAdminUIService<TUserDto>, RoleNames, UserAdminDTO, UserAdminService<TUserDto> |
| 6 | `UserList` | MMCA.ADC.Identity.UI | 7 | IUserUIService, Result, RoleNames, UserAdminList<TUser>, UserListDTO, UserService, ViewerTimeZone |
| 6 | `ConfirmEmailTests` | MMCA.ADC.Identity.UI.Tests | 1 | ConfirmEmailPageTestsBase |
| 6 | `LegalAndDataCardTests` | MMCA.ADC.Identity.UI.Tests | 11 | AuthClaimTypes, BunitTestBase, IAuthUIService, IExternalLinkService, ILegalAcceptanceUIService, IShareService, IUserUIService, LegalAcceptanceDTO, LegalSettings, ProfilePage, Result |
| 6 | `ProfileAvatarCaptureTests` | MMCA.ADC.Identity.UI.Tests | 9 | AuthClaimTypes, BunitTestBase, IAuthUIService, IMediaPickerService, IToastService, IUserUIService, PickedMedia, ProfilePage, Result |
| 6 | `ProfileChangePasswordTests` | MMCA.ADC.Identity.UI.Tests | 6 | AuthClaimTypes, BunitTestBase, IAuthUIService, IUserUIService, ProfilePage, Result |
| 6 | `ProfileTests` | MMCA.ADC.Identity.UI.Tests | 6 | AuthClaimTypes, BunitTestBase, IAuthUIService, IUserUIService, ProfilePage, Result |
| 6 | `ServiceBusRoundTripSmokeTests` | MMCA.ADC.ServiceBusEmulator.IntegrationTests | 4 | ServiceBusEmulatorCollection, ServiceBusEmulatorFixture, SpeakerLinkedToUser, UserRegistered |
| 6 | `AppActionRouteMap` | MMCA.ADC.UI | 2 | EngagementRoutePaths, NotificationRoutePaths |
| 6 | `EmailConfirmationControllerBase<TSendCommand, TConfirmCommand>` | MMCA.Common.API | 7 | ApiControllerBase, ConfirmEmailRequest, ICommandHandler<in TCommand, TResult>, ICommandWithRequest<out TRequest>, Result, SendEmailConfirmationRequest, WebApplicationBuilderExtensions |
| 6 | `EntityCsvExporter<TEntityDTO>` | MMCA.Common.API | 6 | CsvWriter, Error, PagedCollectionResult<T>, PaginationMetadata, QueryFieldService, Result |
| 6 | `OAuthControllerBase` | MMCA.Common.API | 7 | AuthenticationResponse, Error, ExternalAuthExtensions, IAuthenticationService, ICacheService, IDistributedLock, OAuthCodeExchangeRequest |
| 6 | `ApiControllerBaseTests` | MMCA.Common.API.Tests | 3 | Error, Result, TestApiController |
| 6 | `CsvWriterTests` | MMCA.Common.API.Tests | 1 | CsvWriter |
| 6 | `EdgeErrorLocalizationTests` | MMCA.Common.API.Tests | 4 | Error, IErrorLocalizer, StubErrorLocalizer, TestController |
| 6 | `ForwardedJwtBearerSecurityTests` | MMCA.Common.API.Tests | 2 | StubHostEnvironment, WebApplicationBuilderExtensions |
| 6 | `Mocks` | MMCA.Common.API.Tests | 2 | IAuthenticationService, ICacheService |
| 6 | `OutputCacheEvictionHandlerTests` | MMCA.Common.API.Tests | 4 | IIntegrationEventHandler<in TIntegrationEvent>, OutputCacheEvictionHandler, OutputCacheEvictionRequested, RecordingLogger |
| 6 | `ProbeControllerFeatureProvider` | MMCA.Common.API.Tests | 1 | WrappedIdProbeController |
| 6 | `ProblemDetailsRoundTripTests` | MMCA.Common.API.Tests | 6 | Error, ErrorType, ErrorTypeSeverity, ProblemDetailsResultReader, Result, RoundTripController |
| 6 | `RateLimitAlgorithmSelectionTests` | MMCA.Common.API.Tests | 4 | RateLimitAlgorithm, RateLimitingSettings, RedisFixedWindowRateLimiter, WebApplicationBuilderExtensions |
| 6 | `RateLimitPartitionTests` | MMCA.Common.API.Tests | 3 | AuthClaimTypes, RateLimitingSettings, WebApplicationBuilderExtensions |
| 6 | `RecordingQueryService` | MMCA.Common.API.Tests | 10 | BaseLookup<TIdentifierType>, Error, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, ReadScopeDTO, ReadScopeEntity, Result |
| 6 | `SpecificationHonoringQueryService` | MMCA.Common.API.Tests | 9 | BaseLookup<TIdentifierType>, ExportTestDTO, ExportTestEntity, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, Result |
| 6 | `TestUsersAdminController` | MMCA.Common.API.Tests | 3 | IUserAdministrationService<TUserDto>, TestUserDto, UsersAdminControllerBase<TUserDto> |
| 6 | `WebApplicationBuilderExtensionsTests` | MMCA.Common.API.Tests | 1 | WebApplicationBuilderExtensions |
| 6 | `AbsoluteUrlRules<T>` | MMCA.Common.Application | 1 | CommonInvariants |
| 6 | `AuthSessionIssuer` | MMCA.Common.Application | 12 | AuthenticationResponse, Error, IAuthenticationService, IAuthSessionIssuer, IRefreshSessionStore, IssuedSession, ITokenService, RefreshSession, RefreshSessionSettings, RefreshSessionSummaryResponse, Result, SessionStampingTokenService |
| 6 | `IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>` | MMCA.Common.Application | 4 | AuditableBaseEntity<TIdentifierType>, MutationContext, Result, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 6 | `IRepository<TEntity, TIdentifierType>` | MMCA.Common.Application | 3 | AuditableAggregateRootEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IWriteRepository<TEntity, TIdentifierType> |
| 6 | `NavigationLoader` | MMCA.Common.Application | 2 | AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType> |
| 6 | `ReadRepositoryExtensions` | MMCA.Common.Application | 4 | AuditableBaseEntity<TIdentifierType>, Error, IReadRepository<TEntity, TIdentifierType>, Result |
| 6 | `RefreshSessionRevocation` | MMCA.Common.Application | 2 | IRefreshSessionStore, RefreshSession |
| 6 | `AddressValidationRulesTests` | MMCA.Common.Application.Tests | 11 | Address, AddressInvariants, AddressLine1Rules<T>, AddressLine2Rules<T>, AddressValidator, CityRules<T>, CountryRules<T>, State, StateRules<T>, TestAddressModel, ZipCodeRules<T> |
| 6 | `AuthenticationValidatorsTests` | MMCA.Common.Application.Tests | 4 | AuthenticationValidators, LoginRequest, RefreshTokenRequest, RegisterRequest |
| 6 | `CachingCommandDecoratorTests` | MMCA.Common.Application.Tests | 10 | CacheInvalidatingTestCommand, CachingCommandDecorator<TCommand, TResult>, CachingTestEntity, DeleteEntityCommand<TEntity, TIdentifierType>, Error, ICacheService, ICommandHandler<in TCommand, TResult>, OptedOutCacheInvalidatingTestCommand, PlainTestCommand, Result |
| 6 | `CustomDeleteOrderHandler` | MMCA.Common.Application.Tests | 4 | DeleteEntityCommand<TEntity, TIdentifierType>, ICommandHandler<in TCommand, TResult>, OrderAggregate, Result |
| 6 | `DecreaseOrderApplier` | MMCA.Common.Application.Tests | 4 | IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, OrderAggregate, OrderUpdateRequest, Result |
| 6 | `DependencyInjectionTests` | MMCA.Common.Application.Tests | 6 | DomainEventDispatcher, EntityQueryPipeline, IDomainEventDispatcher, IEntityQueryPipeline, INavigationMetadataProvider, NavigationMetadataProvider |
| 6 | `EntityQueryPipelineOrderingTests` | MMCA.Common.Application.Tests | 5 | EntityQueryParameters<TEntity>, EntityQueryPipeline, InMemoryQueryableExecutor, NavigationMetadata, OrderingTestEntity |
| 6 | `EntityQueryPipelineTests` | MMCA.Common.Application.Tests | 7 | EntityQueryParameters<TEntity>, EntityQueryPipeline, IQueryableExecutor, NavigationMetadata, NavigationPropertyInfo, NavigationType, TestEntity |
| 6 | `ExplicitOrderUpdateCommandValidator` | MMCA.Common.Application.Tests | 3 | OrderAggregate, OrderUpdateRequest, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 6 | `IncreaseOrderApplier` | MMCA.Common.Application.Tests | 4 | IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, OrderAggregate, OrderUpdateRequest, Result |
| 6 | `NavigationMetadataProviderTests` | MMCA.Common.Application.Tests | 12 | ChildD, IDataSourceService, MixedEntity, NavigationMetadata, NavigationMetadataProvider, NavigationType, NoNavEntity, ReadOnlyCollectionEntity, SupportedChild, SupportedFK, UnsupportedChild, UnsupportedFK |
| 6 | `NullNavigationPopulatorTests` | MMCA.Common.Application.Tests | 4 | INavigationPopulator<in TEntity>, NavigationMetadata, NullNavigationPopulator<TEntity>, StubEntity |
| 6 | `RaceStore` | MMCA.Common.Application.Tests | 2 | IRefreshSessionStore, RefreshSession |
| 6 | `ReadRepositoryExtensionsTests` | MMCA.Common.Application.Tests | 4 | ErrorType, IReadRepository<TEntity, TIdentifierType>, Result, TestReadEntity |
| 6 | `RecordingSetter` | MMCA.Common.Application.Tests | 2 | IUpdatePropertySetter<TEntity>, UserNotification |
| 6 | `RenameOrderByOwnerCommand` | MMCA.Common.Application.Tests | 3 | OrderAggregate, OrderUpdateRequest, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 6 | `StronglyTypedIdMapperTests` | MMCA.Common.Application.Tests | 5 | MappedOrder, MappedOrderId, OrderPrimitiveDTO, PrimitiveMapper, WrapperMapper |
| 6 | `TestDeleteBlobHandler` | MMCA.Common.Application.Tests | 3 | DeleteBlobInternalCommandHandlerBase<TCommand>, IFileStorageService, TestDeleteBlobCommand |
| 6 | `TestHidingDeleteUser` | MMCA.Common.Application.Tests | 3 | IErasableUser, Result, TestIdentityUser |
| 6 | `TwoFactorHandlerBaseTests` | MMCA.Common.Application.Tests | 15 | ErrorType, FakeAuthenticator, RecordingTwoFactorStore, RecoveryCodeSet, Result, StubTwoFactorService, TestBeginHandler, TestConfirmHandler, TestDisableHandler, TestRegenerateHandler, TestTwoFactorCommand, TwoFactorCodeRequest, TwoFactorErrors, TwoFactorRecoveryCodesResponse, TwoFactorSetupResponse |
| 6 | `CascadeSoftDeleteFitnessTests` | MMCA.Common.Architecture.Tests | 8 | ArchitectureRules, ChildlessFixture, ExemptedOffenderFixture, FixtureAssemblyMap, HelperCascadingFixture, LoopCascadingFixture, MissingOverrideFixture, SelfOnlyDeleteFixture |
| 6 | `ConstructorDependencyCountTestsBaseTests` | MMCA.Common.Architecture.Tests | 7 | ConformantTests, EmptyScanTests, FatFixtureController, GetFixtureProjectionHandler, LooseCeilingTests, RebuildFixtureProjectionHandler, TightCeilingTests |
| 6 | `DependencyVersionTests` | MMCA.Common.Architecture.Tests | 1 | DependencyVersionTestsBase |
| 6 | `FixtureMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, IntegrationEventContractTestsBaseTests, Layer, LayerRef |
| 6 | `FolderWidthTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureMapBase, FolderWidthTestsBase |
| 6 | `FrameworkProbeMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, FixtureLeakingEvent, Layer, LayerRef |
| 6 | `InlineStyleTests` | MMCA.Common.Architecture.Tests | 2 | ArchitectureMapBase, InlineStyleTestsBase |
| 6 | `IntegrationEventContractTestsBaseTests` | MMCA.Common.Architecture.Tests | 4 | ArchitectureRules, FixtureMap, IntegrationEventContractTestsBase, ProbeTests |
| 6 | `LifetimeTokenConventionTests` | MMCA.Common.Architecture.Tests | 3 | ArchitectureMapBase, ArchitectureRules, LifetimeTokenConventionTestsBase |
| 6 | `LocalizationResourceTests` | MMCA.Common.Architecture.Tests | 2 | LocalizationResourceTestsBase, SupportedCultures |
| 6 | `ModuleProbeMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, FixtureLeakingEvent, Layer, LayerRef |
| 6 | `NavigatingQuerySpec` | MMCA.Common.Architecture.Tests | 2 | FitnessDependent, QuerySpecification<TEntity, TIdentifierType> |
| 6 | `NavigatingSpec` | MMCA.Common.Architecture.Tests | 2 | FitnessDependent, Specification<TEntity, TIdentifierType> |
| 6 | `PiiErasureContractFitnessTests` | MMCA.Common.Architecture.Tests | 3 | DataSubjectSample, IAnonymizable, PiiRedactor |
| 6 | `ProbeTests` | MMCA.Common.Architecture.Tests | 3 | FixtureMap, IArchitectureMap, IntegrationEventContractTestsBase |
| 6 | `ScalarOnlyQuerySpec` | MMCA.Common.Architecture.Tests | 2 | FitnessDependent, QuerySpecification<TEntity, TIdentifierType> |
| 6 | `ScalarOnlySpec` | MMCA.Common.Architecture.Tests | 2 | FitnessDependent, Specification<TEntity, TIdentifierType> |
| 6 | `SoftDeleteEnforcementFitnessTests` | MMCA.Common.Architecture.Tests | 5 | ArchitectureRules, DbSetRemovingFixture, ExecuteDeletingFixture, FixtureAssemblyMap, SoftDeletingFixture |
| 6 | `GatewayDownstreamHealthCheckPollingTests` | MMCA.Common.Aspire.Tests | 4 | AttemptRecorder, GatewayHealthCheckExtensions, ProbeAttempt, RefusesHttp2Handler |
| 6 | `GatewayDownstreamHealthChecksTests` | MMCA.Common.Aspire.Tests | 8 | DownstreamProbeVersion, DownstreamServiceHealthCheck, GatewayDownstreamHealthCheckOptions, GatewayHealthCheckExtensions, HealthCheckTags, ProbeAttempt, StubHandler, StubHttpClientFactory |
| 6 | `SpecificationBenchmarks` | MMCA.Common.Benchmarks | 5 | ActiveSpec, AndSpecification<TEntity, TIdentifierType>, MinValueSpec, OrSpecification<TEntity, TIdentifierType>, SampleItem |
| 6 | `PushNotificationInvariants` | MMCA.Common.Domain | 2 | CommonInvariants, Result |
| 6 | `SpecificationExtensions` | MMCA.Common.Domain | 5 | AndSpecification<TEntity, TIdentifierType>, IBaseEntity<TIdentifierType>, ISpecification<TEntity, TIdentifierType>, NotSpecification<TEntity, TIdentifierType>, OrSpecification<TEntity, TIdentifierType> |
| 6 | `AuditableAggregateRootEntityAdditionalTests` | MMCA.Common.Domain.Tests | 5 | ChildEntity, ReactivatableChildEntity, TestAggregate, UndeletableChildEntity, ValidatingAggregate |
| 6 | `AuditableAggregateRootEntityTests` | MMCA.Common.Domain.Tests | 2 | TestAggregate, TestDomainEvent |
| 6 | `CommonInvariantsTests` | MMCA.Common.Domain.Tests | 7 | CommonInvariants, Currency, ErrorType, Money, Result, SupportedCultures, TestScope |
| 6 | `OwnedByUserSpecificationTests` | MMCA.Common.Domain.Tests | 3 | FakeAnswer, NotSpecification<TEntity, TIdentifierType>, OwnedByUserSpecification<TEntity, TIdentifierType> |
| 6 | `QuerySpecificationTests` | MMCA.Common.Domain.Tests | 7 | DefaultsSpecification, FullyConfiguredSpecification, ISpecification<TEntity, TIdentifierType>, NegativePagingSpecification, OrderExpression, QueryTestEntity, Specification<TEntity, TIdentifierType> |
| 6 | `SpecificationAdditionalTests` | MMCA.Common.Domain.Tests | 6 | AgeRangeSpec, AndSpecification<TEntity, TIdentifierType>, NameEqualsSpec, NotSpecification<TEntity, TIdentifierType>, OrSpecification<TEntity, TIdentifierType>, TestEntity |
| 6 | `SpecificationCompositionTests` | MMCA.Common.Domain.Tests | 10 | AgeGreaterThanSpecification, AndSpecification<TEntity, TIdentifierType>, CompositionTestEntity, InvocationFinder, NameStartsWithSpecification, NotSpecification<TEntity, TIdentifierType>, OrSpecification<TEntity, TIdentifierType>, PagedSpecification, ParameterFinder, UnshapedQuerySpecification |
| 6 | `SpecificationTests` | MMCA.Common.Domain.Tests | 6 | AgeGreaterThanSpec, AndSpecification<TEntity, TIdentifierType>, NameStartsWithSpec, NotSpecification<TEntity, TIdentifierType>, OrSpecification<TEntity, TIdentifierType>, TestEntity |
| 6 | `UserNotificationTests` | MMCA.Common.Domain.Tests | 1 | UserNotification |
| 6 | `ConsumerOriginRestore` | MMCA.Common.Infrastructure | 2 | AmbientOrigin, MessageHeaders |
| 6 | `CorrelationContext` | MMCA.Common.Infrastructure | 2 | AmbientOrigin, ICorrelationContext |
| 6 | `EFReadRepositoryDecorator<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 8 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, KeysetCollectionResult<T>, KeysetPageRequest, ProfilingHelper, Result |
| 6 | `EmailConfirmationTokenService` | MMCA.Common.Infrastructure | 8 | EmailConfirmationEntry, EmailConfirmationErrors, EmailConfirmationSettings, EmailIdentity, Error, ICacheService, IEmailConfirmationTokenService, Result |
| 6 | `LoginProtectionService` | MMCA.Common.Infrastructure | 6 | EmailIdentity, Error, ICacheService, ILoginProtectionService, LoginProtectionSettings, Result |
| 6 | `PasswordResetTokenService` | MMCA.Common.Infrastructure | 8 | EmailIdentity, Error, ICacheService, IDistributedLock, IPasswordResetTokenService, PasswordResetEntry, PasswordResetSettings, Result |
| 6 | `TenantContext` | MMCA.Common.Infrastructure | 2 | AmbientOrigin, ITenantContext |
| 6 | `AddressTestDbContext` | MMCA.Common.Infrastructure.Tests | 3 | AddressInvariants, HandRolledOwner, HelperOwner |
| 6 | `AllSpecification` | MMCA.Common.Infrastructure.Tests | 2 | Specification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `BbbSpecification` | MMCA.Common.Infrastructure.Tests | 2 | Specification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `BetaSpecification` | MMCA.Common.Infrastructure.Tests | 2 | Specification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `BetaSpecification` | MMCA.Common.Infrastructure.Tests | 2 | Specification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `DeletedByNameSpecification` | MMCA.Common.Infrastructure.Tests | 2 | Specification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `DistributedCacheServiceTests` | MMCA.Common.Infrastructure.Tests | 4 | CacheKeyNamespace, DistributedCacheService, ICacheService, WarningCountingLogger |
| 6 | `EmailIdentityTests` | MMCA.Common.Infrastructure.Tests | 1 | EmailIdentity |
| 6 | `EmailValueConverterTests` | MMCA.Common.Infrastructure.Tests | 3 | Email, EmailValueConverter, NullableEmailValueConverter |
| 6 | `HighestRankedBetaSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `HighRankSpecification` | MMCA.Common.Infrastructure.Tests | 2 | Specification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `IncludingSoftDeletedSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `IncludingSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `IncludingSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `IndexBuilderExtensionsTests` | MMCA.Common.Infrastructure.Tests | 5 | CosmosIndexedEntity, FilteredIndexTestDbContext, RenamedFlagEntity, SqliteIndexedEntity, SqlServerIndexedEntity |
| 6 | `KeysetQueryBuilderCursorValueTests` | MMCA.Common.Infrastructure.Tests | 1 | KeysetQueryBuilder |
| 6 | `LowestRankedBetaSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `ModelBuilderExtensionsTests` | MMCA.Common.Infrastructure.Tests | 4 | IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, ModelBuilderExtensions, TestMappedEntity, TestModelBuilderDbContext |
| 6 | `MoneyTestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | Currency, HandRolledOwner, HelperOwner, Money |
| 6 | `MultiSourceOrder` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, MultiSourceCustomer |
| 6 | `NoMatchSpecification` | MMCA.Common.Infrastructure.Tests | 2 | Specification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `OrderedSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `PagedSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `PermissionGrantCacheTests` | MMCA.Common.Infrastructure.Tests | 5 | IPermissionGrantStore, ManualClock, PermissionGrant, PermissionGrantCache, PermissionGrantSettings |
| 6 | `PhoneNumberValueConverterTests` | MMCA.Common.Infrastructure.Tests | 3 | NullablePhoneNumberValueConverter, PhoneNumber, PhoneNumberValueConverter |
| 6 | `PortableThing` | MMCA.Common.Infrastructure.Tests | 2 | AuditableAggregateRootEntity<TIdentifierType>, PortablePrincipal |
| 6 | `RankDescendingSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `RefreshSessionModelBuilderExtensionsTests` | MMCA.Common.Infrastructure.Tests | 4 | CustomSchemaContext, RefreshSession, RefreshSessionModelBuilderExtensions, RefreshSessionOnlyContext |
| 6 | `RegistryUnattributedConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryUnattributed |
| 6 | `StoredPermissionRoleAdministrationServiceTests` | MMCA.Common.Infrastructure.Tests | 11 | AdministrationPermissions, Error, ErrorType, FakeGrantCache, FakeGrantStore, IPermissionGrantCacheInvalidator, IPermissionGrantStore, PermissionGrantSettings, PermissionRegistryBuilder, Result, StoredPermissionRoleAdministrationService |
| 6 | `TestAggregateEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationBase<TEntity, TIdentifierType>, TestAggregateEntity |
| 6 | `TestDbContext` | MMCA.Common.Infrastructure.Tests | 6 | FakeAggregate, FakeAggregate, FakeEntity, FakeEntity, TestChildEntity, TestEntity |
| 6 | `TestEntitySqliteConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, TestMappedEntity |
| 6 | `TestModelBuilderDbContext` | MMCA.Common.Infrastructure.Tests | 4 | IDataSourceService, IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, ModelBuilderExtensionsTests, TestDataSourceService |
| 6 | `TestNonAggregateEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationBase<TEntity, TIdentifierType>, TestNonAggregateEntity |
| 6 | `TopTwoByRankSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `TrackedSpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `UnorderedQuerySpecification` | MMCA.Common.Infrastructure.Tests | 2 | QuerySpecification<TEntity, TIdentifierType>, SpecTestEntity |
| 6 | `LoadItemMapper` | MMCA.Common.LoadTests | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, LoadItem, LoadItemDTO |
| 6 | `LoadItemNavigationPopulator` | MMCA.Common.LoadTests | 3 | INavigationPopulator<in TEntity>, LoadItem, NavigationMetadata |
| 6 | `StronglyTypedIdRegistry` | MMCA.Common.Shared | 2 | StronglyTypedId, StronglyTypedIdTypeConverters |
| 6 | `EnumerationSerializationTests` | MMCA.Common.Shared.Tests | 5 | Alert, EnumerationJsonConverterFactory, Grade, Severity, Severity |
| 6 | `StronglyTypedIdTypeConverterTests` | MMCA.Common.Shared.Tests | 6 | LateRegisteredId, LineId, OrderId, SkuId, StronglyTypedIdTypeConverter<TSelf, TValue>, StronglyTypedIdTypeConverters |
| 6 | `InMemoryRefreshSessionStore` | MMCA.Common.Testing | 2 | IRefreshSessionStore, RefreshSession |
| 6 | `AuthUIService` | MMCA.Common.UI | 20 | AuthenticationResponse, ChangePasswordRequest, Error, ForgotPasswordRequest, HttpResultExecutor, IAuthUIService, ILocalCacheStore, IPushRegistrationService, ISessionAwareTokenRefresher, ITokenRefresher, ITokenStorageService, IUiReadCache, JwtAuthenticationStateProvider, LoginRequest, OAuthCodeExchangeRequest, ProblemDetailsResultReader, RefreshSessionSummaryResponse, RegisterRequest, ResetPasswordRequest, Result |
| 6 | `NotificationBell` | MMCA.Common.UI | 6 | INotificationInboxUIService, NotificationBellOptions, NotificationRoutePaths, NotificationState, SharedResource, State |
| 6 | `NotificationList` | MMCA.Common.UI | 7 | IPushNotificationUIService, IToastService, NotificationPermissions, NotificationRoutePaths, PushNotificationDTO, SharedResource, ViewerTimeZone |
| 6 | `NotificationSend` | MMCA.Common.UI | 13 | DataAnnotationsModelValidator, ErrorMessages, INotificationScopeProvider, IPushNotificationUIService, IToastService, ModelValidation, NotificationPermissions, NotificationRoutePaths, NotificationSendModel, PushNotificationDTO, Result, SendPushNotificationRequest, SharedResource |
| 6 | `Sessions` | MMCA.Common.UI | 9 | IAppDialogService, IAuthUIService, IToastService, RefreshSessionSummaryResponse, Result, RoutePaths, SharedResource, UserAgentSummary, ViewerTimeZone |
| 6 | `TermsAcceptanceGate` | MMCA.Common.UI | 8 | ErrorType, IAuthUIService, ILegalAcceptanceUIService, LegalAcceptanceDTO, LegalAcceptanceErrorCodes, LegalSettings, Result, SharedResource |
| 6 | `NoOpAuthUIService` | MMCA.Common.UI.Gallery | 7 | AuthenticationResponse, Error, IAuthUIService, LoginRequest, RefreshSessionSummaryResponse, RegisterRequest, Result |
| 6 | `AuthFormValidationMessageTests` | MMCA.Common.UI.Tests | 9 | ApiSettings, BunitTestBase, IAuthUIService, ILocalCacheStore, IOAuthUISettings, IUserPreferenceReader, Login, OAuthFlowStateStore, Register |
| 6 | `ChangePasswordCardTests` | MMCA.Common.UI.Tests | 6 | BunitTestBase, ChangePasswordCard, Error, IAuthUIService, IToastService, Result |
| 6 | `ChildEntityServiceBaseTests` | MMCA.Common.UI.Tests | 7 | ErrorType, ITokenStorageService, MembershipDto, MembershipService, Mocks, StubHttpClientFactory, StubHttpMessageHandler |
| 6 | `ConfirmEmailPageTests` | MMCA.Common.UI.Tests | 1 | ConfirmEmailPageTestsBase |
| 6 | `EntityServiceBaseCachingTests` | MMCA.Common.UI.Tests | 15 | BaseLookup<TIdentifierType>, CollectionResult<T>, FakeTimeProvider, GatedGetHandler, ITokenStorageService, IUiReadCache, PagedCollectionResult<T>, PaginationMetadata, Result, StubHttpClientFactory, StubHttpMessageHandler, UiReadCache, UiReadCacheOptions, WidgetDto, WidgetService |
| 6 | `EntityServiceBaseIdempotencyRetryTests` | MMCA.Common.UI.Tests | 6 | ErrorType, FreshApiClientFactory, ScriptedHandler, StubTokenStorageService, WidgetDto, WidgetService |
| 6 | `EntityServiceBaseTests` | MMCA.Common.UI.Tests | 14 | BaseLookup<TIdentifierType>, CollectionResult<T>, ErrorType, ForeignKeyWidgetService, HttpResultExecutor, ITokenStorageService, Mocks, PagedCollectionResult<T>, PaginationMetadata, ProblemDetailsResultReader, StubHttpClientFactory, StubHttpMessageHandler, WidgetDto, WidgetService |
| 6 | `LoginErrorQueryTests` | MMCA.Common.UI.Tests | 8 | ApiSettings, BunitTestBase, IAuthUIService, ILocalCacheStore, IOAuthUISettings, IUserPreferenceReader, Login, OAuthFlowStateStore |
| 6 | `MainLayoutContentHeaderTests` | MMCA.Common.UI.Tests | 7 | BareModule, BunitTestBase, HeaderModule, IAuthUIService, IExternalLinkService, IUIModule, NullExternalLinkService |
| 6 | `MainLayoutFooterTests` | MMCA.Common.UI.Tests | 6 | BunitTestBase, IAuthUIService, IExternalLinkService, LayoutSettings, LegalSettings, NullExternalLinkService |
| 6 | `MainLayoutSkipLinkTests` | MMCA.Common.UI.Tests | 6 | BunitTestBase, IAuthUIService, IExternalLinkService, LayoutSettings, LegalSettings, NullExternalLinkService |
| 6 | `NavMenuTests` | MMCA.Common.UI.Tests | 11 | AuthClaimTypes, BunitTestBase, IAuthUIService, IUIModule, LayoutSettings, NavItem, NavSection, RoutePaths, SharedResource, StubUiModule, TestPrincipal |
| 6 | `PseudoLocalizationTests` | MMCA.Common.UI.Tests | 7 | FakeStringLocalizer, FakeStringLocalizerFactory, PseudoLocalizationTests, PseudoLocalizer, PseudoStringLocalizer, PseudoStringLocalizerFactory, SupportedCultures |
| 6 | `PushNotificationServiceTests` | MMCA.Common.UI.Tests | 13 | ErrorType, IdempotencyHeaders, ITokenStorageService, Mocks, PagedCollectionResult<T>, PaginationMetadata, ProblemDetailsResultReader, PushNotificationDTO, PushNotificationService, SendPushNotificationRequest, StubHttpClientFactory, StubHttpMessageHandler, StubScopeProvider |
| 6 | `RegisterAddressOptionTests` | MMCA.Common.UI.Tests | 7 | AuthenticationResponse, BunitTestBase, IAuthUIService, Register, RegisterRequest, RegistrationSettings, Result |
| 6 | `RegisterFormTests` | MMCA.Common.UI.Tests | 8 | AuthenticationResponse, AuthErrorCodes, BunitTestBase, Error, IAuthUIService, Register, RegisterRequest, Result |
| 6 | `RegisterTermsTests` | MMCA.Common.UI.Tests | 9 | AuthenticationResponse, BunitTestBase, IAuthUIService, IExternalLinkService, LegalSettings, NullExternalLinkService, Register, RegisterRequest, Result |
| 6 | `RoleAdminEditPageTests` | MMCA.Common.UI.Tests | 2 | EditorShell, RoleAdminEditPageTestsBase<TPage> |
| 6 | `RoleAdminListPageTests` | MMCA.Common.UI.Tests | 2 | RoleAdminListPageTestsBase<TPage>, RosterShell |
| 6 | `UserAdminListTests` | MMCA.Common.UI.Tests | 11 | AuthClaimTypes, BunitTestBase, Error, IAppDialogService, IUserAdminActionsUIService, IUserAdminUIService<TUserDto>, MudProviderHandles, Result, StubLocalizer, TestUser, UserAdminList<TUser> |
| 7 | `ActivityDescriptionRules<T>` | MMCA.ADC.Conference.Application | 2 | ActivityInvariants, OptionalStringRules<T> |
| 7 | `ActivityNameRules<T>` | MMCA.ADC.Conference.Application | 2 | ActivityInvariants, RequiredStringRules<T> |
| 7 | `ActivityVenueAddressRules<T>` | MMCA.ADC.Conference.Application | 2 | ActivityInvariants, OptionalStringRules<T> |
| 7 | `ActivityVenueNameRules<T>` | MMCA.ADC.Conference.Application | 2 | ActivityInvariants, OptionalStringRules<T> |
| 7 | `ActivityVenueUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, ActivityInvariants |
| 7 | `AddCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | Category, ICacheInvalidating |
| 7 | `CategoryItemDTOMapper` | MMCA.ADC.Conference.Application | 3 | CategoryItem, CategoryItemDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 7 | `CategoryItemNameRules<T>` | MMCA.ADC.Conference.Application | 1 | CategoryInvariants |
| 7 | `ConferenceCategoryCreateRequest` | MMCA.ADC.Conference.Application | 3 | Category, ICacheInvalidating, ICreateRequest |
| 7 | `ConferenceCategoryTitleRules<T>` | MMCA.ADC.Conference.Application | 1 | CategoryInvariants |
| 7 | `ConferenceCategoryUpdateApplier` | MMCA.ADC.Conference.Application | 4 | Category, ConferenceCategoryUpdateRequest, IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, Result |
| 7 | `EventDescriptionRules<T>` | MMCA.ADC.Conference.Application | 2 | EventInvariants, OptionalStringRules<T> |
| 7 | `EventNameRules<T>` | MMCA.ADC.Conference.Application | 2 | EventInvariants, RequiredStringRules<T> |
| 7 | `EventOrganizerContactEmailRules<T>` | MMCA.ADC.Conference.Application | 2 | EmailRules<T>, EventInvariants |
| 7 | `EventSponsorshipPacketUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, EventInvariants |
| 7 | `EventTicketingUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, EventInvariants |
| 7 | `EventTimeZoneRules<T>` | MMCA.ADC.Conference.Application | 1 | EventInvariants |
| 7 | `EventVenueAddressRules<T>` | MMCA.ADC.Conference.Application | 2 | EventInvariants, OptionalStringRules<T> |
| 7 | `EventVenueMapUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, EventInvariants |
| 7 | `EventWiFiInfoRules<T>` | MMCA.ADC.Conference.Application | 2 | EventInvariants, OptionalStringRules<T> |
| 7 | `PartnerDescriptionRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, PartnerInvariants |
| 7 | `PartnerNameRules<T>` | MMCA.ADC.Conference.Application | 2 | PartnerInvariants, RequiredStringRules<T> |
| 7 | `PartnerOptionalUrlRules<T>` | MMCA.ADC.Conference.Application | 1 | AbsoluteUrlRules<T> |
| 7 | `QuestionTextRules<T>` | MMCA.ADC.Conference.Application | 1 | QuestionInvariants |
| 7 | `RemoveCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | Category, ICacheInvalidating |
| 7 | `RoomAccessibilityInfoRules<T>` | MMCA.ADC.Conference.Application | 2 | EventInvariants, OptionalStringRules<T> |
| 7 | `RoomFloorRules<T>` | MMCA.ADC.Conference.Application | 2 | EventInvariants, OptionalStringRules<T> |
| 7 | `RoomLocationRules<T>` | MMCA.ADC.Conference.Application | 2 | EventInvariants, OptionalStringRules<T> |
| 7 | `RoomNameRules<T>` | MMCA.ADC.Conference.Application | 1 | EventInvariants |
| 7 | `SessionAccessibilityInfoRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 7 | `SessionAssetFileNameRules<T>` | MMCA.ADC.Conference.Application | 2 | SessionAssetInvariants, SessionAssetLimits |
| 7 | `SessionAssetTitleRules<T>` | MMCA.ADC.Conference.Application | 2 | RequiredStringRules<T>, SessionAssetInvariants |
| 7 | `SessionAssetUrlRules<T>` | MMCA.ADC.Conference.Application | 1 | SessionAssetInvariants |
| 7 | `SessionDescriptionRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 7 | `SessionLiveUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 7 | `SessionRecordingUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 7 | `SessionResourceLinksRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 7 | `SessionStatusRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SessionInvariants |
| 7 | `SessionTitleRules<T>` | MMCA.ADC.Conference.Application | 2 | RequiredStringRules<T>, SessionInvariants |
| 7 | `SpeakerEmailRules<T>` | MMCA.ADC.Conference.Application | 2 | EmailRules<T>, SpeakerInvariants |
| 7 | `SpeakerFirstNameRules<T>` | MMCA.ADC.Conference.Application | 2 | RequiredStringRules<T>, SpeakerInvariants |
| 7 | `SpeakerGitHubUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, SpeakerInvariants |
| 7 | `SpeakerLastNameRules<T>` | MMCA.ADC.Conference.Application | 2 | RequiredStringRules<T>, SpeakerInvariants |
| 7 | `SpeakerLinkedInUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, SpeakerInvariants |
| 7 | `SpeakerWebsiteUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, SpeakerInvariants |
| 7 | `SponsorBoothNumberRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SponsorInvariants |
| 7 | `SponsorDescriptionRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SponsorInvariants |
| 7 | `SponsorLinkedInUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, SponsorInvariants |
| 7 | `SponsorLogoUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, SponsorInvariants |
| 7 | `SponsorNameRules<T>` | MMCA.ADC.Conference.Application | 2 | RequiredStringRules<T>, SponsorInvariants |
| 7 | `SponsorTwitterHandleRules<T>` | MMCA.ADC.Conference.Application | 2 | OptionalStringRules<T>, SponsorInvariants |
| 7 | `SponsorWebsiteUrlRules<T>` | MMCA.ADC.Conference.Application | 2 | AbsoluteUrlRules<T>, SponsorInvariants |
| 7 | `UpdateCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | Category, ICacheInvalidating |
| 7 | `DeleteSessionAssetBlobInternalCommandHandlerTests` | MMCA.ADC.Conference.Application.Tests | 6 | DeleteSessionAssetBlobInternalCommand, DeleteSessionAssetBlobInternalCommandHandler, DeleteSessionAssetBlobInternalCommandValidator, Error, IFileStorageService, Result |
| 7 | `InMemoryRepository<TEntity, TIdentifierType>` | MMCA.ADC.Conference.Application.Tests | 9 | AuditableAggregateRootEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRowVersioned, ISpecification<TEntity, TIdentifierType>, IUpdatePropertySetter<TEntity>, KeysetCollectionResult<T>, KeysetPageRequest, Result |
| 7 | `Event` | MMCA.ADC.Conference.Domain | 15 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Email, Error, EventChanged, EventInvariants, EventQuestionAnswer, EventQuestionAnswerChanged, EventSpeaker, EventSpeakerChanged, IAuditedEntity, QuestionModerationDefault, Result, Room, RoomChanged |
| 7 | `EventQuestionAnswer` | MMCA.ADC.Conference.Domain | 5 | AuditableBaseEntity<TIdentifierType>, Event, EventInvariants, QuestionInvariants, Result |
| 7 | `EventSpeaker` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, Event, IReactivatable, Result |
| 7 | `Question` | MMCA.ADC.Conference.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, QuestionChanged, QuestionInvariants, Result |
| 7 | `Room` | MMCA.ADC.Conference.Domain | 5 | AuditableBaseEntity<TIdentifierType>, Event, EventInvariants, IReactivatable, Result |
| 7 | `SessionAsset` | MMCA.ADC.Conference.Domain | 7 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Error, Result, SessionAssetChanged, SessionAssetInvariants, SessionAssetKind |
| 7 | `Speaker` | MMCA.ADC.Conference.Domain | 13 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Email, Error, IAuditedEntity, Result, Speaker, SpeakerCategoryItem, SpeakerCategoryItemChanged, SpeakerChanged, SpeakerInvariants, SpeakerQuestionAnswer, SpeakerQuestionAnswerChanged |
| 7 | `SpeakerCategoryItem` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, IReactivatable, Result, Speaker |
| 7 | `SpeakerQuestionAnswer` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, Result, Speaker, SpeakerInvariants |
| 7 | `ActivityInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | ActivityInvariants |
| 7 | `CategoryInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 2 | Category, CategoryInvariants |
| 7 | `CategoryTests` | MMCA.ADC.Conference.Domain.Tests | 4 | Category, CategoryChanged, CategoryInvariants, DomainEntityState |
| 7 | `EventInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | EventInvariants |
| 7 | `PartnerInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | PartnerInvariants |
| 7 | `QuestionInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | QuestionInvariants |
| 7 | `SessionAssetInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 3 | SessionAssetDTO, SessionAssetInvariants, SessionAssetKind |
| 7 | `SessionInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | SessionInvariants |
| 7 | `SpeakerInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | SpeakerInvariants |
| 7 | `SponsorInvariantsTests` | MMCA.ADC.Conference.Domain.Tests | 1 | SponsorInvariants |
| 7 | `FakeSessionizeService` | MMCA.ADC.Conference.IntegrationTests | 5 | ISessionizeService, Result, SessionizeResponse, SessionizeSession, Sessions |
| 7 | `SessionSelectionSpeakerOverlap` | MMCA.ADC.Conference.UI | 4 | MultiSessionSpeaker, Sessions, SessionSelectionDisplay, SpeakerSessionSummary |
| 7 | `AddToCalendarButtonTests` | MMCA.ADC.Conference.UI.Tests | 7 | ApiSettings, BunitTestBase, CapturingHttpMessageHandler, HttpTestDoubles, IExternalLinkService, IShareService, IToastService |
| 7 | `ConferenceCategoryDetailStaleLoadTests` | MMCA.ADC.Conference.UI.Tests | 8 | BunitTestBase, ConferenceCategoryDetail, ConferenceCategoryDTO, ICategoryItemUIService, IConferenceCategoryUIService, Result, RoleNames, TestPrincipal |
| 7 | `ConferenceCategoryItemsPanelTests` | MMCA.ADC.Conference.UI.Tests | 11 | BunitTestBase, CategoryItemDTO, ConferenceCategoryDTO, ConferenceCategoryItemsPanel, Error, ICategoryItemUIService, IConferenceCategoryUIService, IToastService, Result, RoleNames, TestPrincipal |
| 7 | `EventCreateTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, EventCreate, EventCreateModel, EventDTO, IEventUIService |
| 7 | `OrganizerSessionFeedbackTests` | MMCA.ADC.Conference.UI.Tests | 11 | BunitTestBase, Error, IOrganizerSessionFeedbackUIService, IQuestionUIService, ISessionUIService, IToastService, OrganizerSessionFeedback, QuestionDTO, Result, SessionDTO, SessionQuestionAnswerDTO |
| 7 | `QrCodeButtonTests` | MMCA.ADC.Conference.UI.Tests | 1 | BunitTestBase |
| 7 | `QuestionCreateTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, IQuestionUIService, QuestionCreate, QuestionCreateModel, QuestionDTO |
| 7 | `SessionAssetsDownloadListTests` | MMCA.ADC.Conference.UI.Tests | 7 | BunitTestBase, Error, ISessionAssetUIService, Result, SessionAssetDTO, SessionAssetKind, SessionAssetsDownloadList |
| 7 | `SessionAssetsPanelTests` | MMCA.ADC.Conference.UI.Tests | 9 | BunitTestBase, Error, ISessionAssetUIService, Result, SessionAssetDTO, SessionAssetKind, SessionAssetLimits, SessionAssetLinkRequest, SessionAssetsPanel |
| 7 | `SessionBookmarkButtonTests` | MMCA.ADC.Conference.UI.Tests | 6 | AuthClaimTypes, BunitTestBase, ISessionBookmarkUIService, IToastService, Result, SessionBookmarkButton |
| 7 | `SessionCreateTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, Error, EventInfo, IEventLookupService, IRoomUIService, ISessionUIService, Result, RoomDTO, SessionCreate, SessionDTO |
| 7 | `SessionSelectionAiScoresTests` | MMCA.ADC.Conference.UI.Tests | 6 | BunitTestBase, CategoryDistributionDTO, SessionAiScoreDTO, SessionSelectionAiScores, SessionSelectionDashboardDTO, SpeakerSessionOverlapDTO |
| 7 | `SharePageButtonTests` | MMCA.ADC.Conference.UI.Tests | 3 | BunitTestBase, IClipboardService, IShareService |
| 7 | `SpeakerCategoryItemsPanelTests` | MMCA.ADC.Conference.UI.Tests | 9 | BunitTestBase, CategoryItemInfo, ISpeakerCategoryItemUIService, Result, RoleNames, SpeakerCategoryItemDTO, SpeakerCategoryItemsPanel, SpeakerDTO, TestPrincipal |
| 7 | `SpeakerDetailSessionTimesTests` | MMCA.ADC.Conference.UI.Tests | 15 | BunitTestBase, CategoryItemInfo, ISessionUIService, ISpeakerCategoryItemUIService, ISpeakerDetailLookupService, ISpeakerUIService, IToastService, IUserUIService, Result, RoleNames, SessionDTO, SpeakerDetail, SpeakerDetailLookups, SpeakerDTO, TestPrincipal |
| 7 | `SpeakerDetailTests` | MMCA.ADC.Conference.UI.Tests | 15 | BunitTestBase, CategoryItemInfo, Error, ISessionUIService, ISpeakerCategoryItemUIService, ISpeakerDetailLookupService, ISpeakerUIService, IUserUIService, Result, RoleNames, SessionDTO, SpeakerDetail, SpeakerDetailLookups, SpeakerDTO, TestPrincipal |
| 7 | `SpeakerQrTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, ConferenceRoutePaths, Error, FixedOriginLinkBuilder, IPublicLinkBuilder, ISpeakerUIService, QrErrorCorrectionLevel, Result, SpeakerDTO, SpeakerQr |
| 7 | `CreateLivePollRequestValidator` | MMCA.ADC.Engagement.Application | 2 | CreateLivePollRequest, LivePollInvariants |
| 7 | `SubmitQuestionCommandValidator` | MMCA.ADC.Engagement.Application | 2 | SessionQuestionInvariants, SubmitQuestionCommand |
| 7 | `HandlerMocks` | MMCA.ADC.Engagement.Application.Tests | 2 | IRepository<TEntity, TIdentifierType>, LeaderboardOptIn |
| 7 | `TestSupport` | MMCA.ADC.Engagement.Application.Tests | 10 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, BaseEntity<TIdentifierType>, EventLiveInfo, IEventLiveValidationService, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, QuestionModerationDefault, Result, SessionLiveInfo |
| 7 | `AttendeeBadge` | MMCA.ADC.Engagement.Domain | 3 | AttendeeBadgeInvariants, AuditableAggregateRootEntity<TIdentifierType>, Result |
| 7 | `LivePollVote` | MMCA.ADC.Engagement.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, LivePollVoteChanged, LivePollVoteInvariants, Result |
| 7 | `PointsEntry` | MMCA.ADC.Engagement.Domain | 7 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, IAuditedEntity, PointsActivityType, PointsEntryChanged, PointsEntryInvariants, Result |
| 7 | `SessionQuestion` | MMCA.ADC.Engagement.Domain | 7 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Error, QuestionStatus, Result, SessionQuestionChanged, SessionQuestionInvariants |
| 7 | `SessionQuestionUpvote` | MMCA.ADC.Engagement.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Result, SessionQuestionUpvoteChanged, SessionQuestionUpvoteInvariants |
| 7 | `UserSessionBookmark` | MMCA.ADC.Engagement.Domain | 5 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Result, UserSessionBookmarkChanged, UserSessionBookmarkInvariants |
| 7 | `LeaderboardOptInTests` | MMCA.ADC.Engagement.Domain.Tests | 3 | DomainEntityState, LeaderboardOptIn, LeaderboardOptInChanged |
| 7 | `PointsEntryInvariantsTests` | MMCA.ADC.Engagement.Domain.Tests | 3 | PointsActivityType, PointsEntryInvariants, PointsSubjectKeys |
| 7 | `PointsSettings` | MMCA.ADC.Engagement.Shared | 4 | EventFeedback, PointsActivityType, SessionFeedback, SponsorVisit |
| 7 | `AttendeeLookupService` | MMCA.ADC.Engagement.UI | 9 | AttendeeRow, AttendeeSummary, AuthenticatedServiceBase, HttpResultExecutor, IAttendeeLookupService, ITokenStorageService, PagedCollectionResult<T>, ProblemDetailsResultReader, Result |
| 7 | `AttendeeSearchPanel` | MMCA.ADC.Engagement.UI | 7 | AttendeeSearchField, AttendeeSummary, DataGridListPageBase<TDto>, IAttendeeLookupService, ListPageActions, MobileInfiniteScrollList<TItem>, Result |
| 7 | `AppActionRouteMapTests` | MMCA.ADC.Engagement.UI.Tests | 3 | AppActionRouteMap, EngagementRoutePaths, NotificationRoutePaths |
| 7 | `EmailConfirmationController` | MMCA.ADC.Identity.API | 8 | ConfirmEmailCommand, ConfirmEmailRequest, EmailConfirmationControllerBase<TSendCommand, TConfirmCommand>, ICommandHandler<in TCommand, TResult>, Result, Route, SendEmailConfirmationCommand, SendEmailConfirmationRequest |
| 7 | `OAuthController` | MMCA.ADC.Identity.API | 5 | IAuthenticationService, ICacheService, IDistributedLock, OAuthControllerBase, Route |
| 7 | `UsersAdminControllerTests` | MMCA.ADC.Identity.API.Tests | 9 | AdministrationPermissions, Error, HasPermissionAttribute, IUserAdministrationService<TUserDto>, NonIdempotentAttribute, Result, SetUserRolesRequest, UserAdminDTO, UsersAdminController |
| 7 | `RegisterRequestValidator` | MMCA.ADC.Identity.Application | 6 | AddressValidator, EmailRules<T>, RegisterRequest, RequiredStringRules<T>, StrongPasswordRules<T>, UserInvariants |
| 7 | `DeleteAvatarBlobInternalCommandHandlerTests` | MMCA.ADC.Identity.Application.Tests | 5 | DeleteAvatarBlobInternalCommand, DeleteAvatarBlobInternalCommandHandler, Error, IFileStorageService, Result |
| 7 | `InMemoryRepository<TEntity, TIdentifierType>` | MMCA.ADC.Identity.Application.Tests | 9 | AuditableAggregateRootEntity<TIdentifierType>, BaseLookup<TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRowVersioned, ISpecification<TEntity, TIdentifierType>, IUpdatePropertySetter<TEntity>, KeysetCollectionResult<T>, KeysetPageRequest, Result |
| 7 | `User` | MMCA.ADC.Identity.Domain | 13 | AuditableAggregateRootEntity<TIdentifierType>, Email, IAuditedEntity, IEmailConfirmableUser, IErasableUser, ILegalAcceptingUser, IPasswordChangeableUser, IUserPreferences, Result, UserDeleted, UserInvariants, UserPasswordChanged, UserRole |
| 7 | `IdentityUIModule` | MMCA.ADC.Identity.UI | 7 | AdministrationPermissions, IdentityRoutePaths, IUIModule, NavItem, NavSection, RoleNames, TermsAcceptanceGate |
| 7 | `IdentityRouteAuthorizationTests` | MMCA.ADC.Identity.UI.Tests | 2 | RouteAuthorizationTestsBase, UserList |
| 7 | `AppActionsInitializer` | MMCA.ADC.UI | 1 | AppActionRouteMap |
| 7 | `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.API | 15 | ApiControllerBase, ApplicationSettings, AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConcurrencyETag, EntityCsvExporter<TEntityDTO>, Error, IBaseDTO<TIdentifierType>, IEntityControllerBase<TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, Route, Specification<TEntity, TIdentifierType> |
| 7 | `EntityCsvExporterTests` | MMCA.Common.API.Tests | 7 | AsyncOnlyResponseStream, EntityCsvExporter<TEntityDTO>, Error, ExportRow, PagedCollectionResult<T>, PaginationMetadata, Result |
| 7 | `EntityCsvExporterValueObjectTests` | MMCA.Common.API.Tests | 9 | Currency, DimensionedRow, EntityCsvExporter<TEntityDTO>, Money, PagedCollectionResult<T>, PaginationMetadata, PricedRow, ProbeDimensions, Result |
| 7 | `LockingTestOAuthController` | MMCA.Common.API.Tests | 4 | IAuthenticationService, ICacheService, IDistributedLock, OAuthControllerBase |
| 7 | `ModuleControllerFeatureProviderTests` | MMCA.Common.API.Tests | 5 | ApiControllerBaseTests, FakeCategoriesController, ModuleControllerFeatureProvider, ModuleSettings, ModulesSettings |
| 7 | `TestEmailConfirmationController` | MMCA.Common.API.Tests | 7 | ConfirmEmailRequest, EmailConfirmationControllerBase<TSendCommand, TConfirmCommand>, ICommandHandler<in TCommand, TResult>, Result, SendEmailConfirmationRequest, TestConfirmEmailCommand, TestSendEmailConfirmationCommand |
| 7 | `TestOAuthController` | MMCA.Common.API.Tests | 3 | IAuthenticationService, ICacheService, OAuthControllerBase |
| 7 | `IUnitOfWork` | MMCA.Common.Application | 4 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType> |
| 7 | `AuthSessionIssuerReuseGraceTests` | MMCA.Common.Application.Tests | 10 | AuthenticationResponse, AuthSessionIssuer, ErrorType, FixedTimeProvider, FixedTimeProvider, ITokenService, RaceStore, RefreshSession, RefreshSessionSettings, Result |
| 7 | `CommonValidationRulesTests` | MMCA.Common.Application.Tests | 17 | AbsoluteUrlRules<T>, EmailRules<T>, NonNegativeIntRules<T>, OptionalPositiveIdRules<T, TId>, OptionalStringRules<T>, PasswordRules<T>, PositiveDecimalRules<T>, PositiveIntRules<T>, RequiredIdRules<T, TId>, RequiredStringRules<T>, StrongPasswordRules<T>, TestDecimalModel, TestGuidModel, TestIntModel, TestOptionalIntModel, TestOptionalStringModel, TestStringModel |
| 7 | `CustomIncreaseOrderHandler` | MMCA.Common.Application.Tests | 7 | ICommandHandler<in TCommand, TResult>, IncreaseOrderApplier, OrderAggregate, OrderDTO, OrderUpdateRequest, Result, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 7 | `DeleteBlobInternalCommandHandlerBaseTests` | MMCA.Common.Application.Tests | 5 | Error, IFileStorageService, Result, TestDeleteBlobCommand, TestDeleteBlobHandler |
| 7 | `NavigationLoaderTests` | MMCA.Common.Application.Tests | 4 | IReadRepository<TEntity, TIdentifierType>, NavigationLoader, StubChild, StubParent |
| 7 | `OwnerOrderApplier` | MMCA.Common.Application.Tests | 7 | Error, IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>, MutationContext, OrderAggregate, OrderUpdateRequest, RenameOrderByOwnerCommand, Result |
| 7 | `Speaker` | MMCA.Common.Application.Tests | 1 | Speaker |
| 7 | `SpecificationFitnessTests` | MMCA.Common.Architecture.Tests | 6 | ArchitectureRules, NavigatingQuerySpec, NavigatingSpec, ScalarOnlyQuerySpec, ScalarOnlySpec, SpecTestMap |
| 7 | `SpecTestMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, Layer, LayerRef, SpecificationFitnessTests |
| 7 | `PushNotification` | MMCA.Common.Domain | 6 | AuditableAggregateRootEntity<TIdentifierType>, CommonInvariants, PushNotificationCreated, PushNotificationInvariants, PushNotificationStatus, Result |
| 7 | `PushNotificationInvariantsTests` | MMCA.Common.Domain.Tests | 2 | PushNotificationInvariants, Result |
| 7 | `EFRepositoryDecorator<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 6 | AuditableAggregateRootEntity<TIdentifierType>, EFReadRepositoryDecorator<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRowVersioned, IUpdatePropertySetter<TEntity>, ProfilingHelper |
| 7 | `IntegrationEventConsumer<TEvent>` | MMCA.Common.Infrastructure | 5 | ConsumerOriginRestore, EventNameResolver, IInboxStore, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent> |
| 7 | `IRepositoryFactory` | MMCA.Common.Infrastructure | 4 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType> |
| 7 | `StronglyTypedIdModelConfiguration` | MMCA.Common.Infrastructure | 3 | StronglyTypedIdRegistry, StronglyTypedIdValueComparer<TSelf>, StronglyTypedIdValueConverter<TSelf, TValue> |
| 7 | `CorrelationContextTests` | MMCA.Common.Infrastructure.Tests | 1 | CorrelationContext |
| 7 | `EFReadRepositoryDecoratorAdditionalTests` | MMCA.Common.Infrastructure.Tests | 7 | EFReadRepositoryDecorator<TEntity, TIdentifierType>, FakeEntity, FakeEntity, FakeEntity, InlineSpecification<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType> |
| 7 | `EFReadRepositoryDecoratorTests` | MMCA.Common.Infrastructure.Tests | 6 | BaseLookup<TIdentifierType>, EFReadRepositoryDecorator<TEntity, TIdentifierType>, FakeEntity, FakeEntity, FakeEntity, IReadRepository<TEntity, TIdentifierType> |
| 7 | `EmailConfirmationTokenServiceTests` | MMCA.Common.Infrastructure.Tests | 9 | EmailConfirmationEntry, EmailConfirmationErrors, EmailConfirmationSettings, EmailConfirmationTokenService, ErrorType, FakeConfirmationCacheService, FakeTimeProvider, ICacheService, Result |
| 7 | `LoginProtectionServiceHybridCacheTests` | MMCA.Common.Infrastructure.Tests | 5 | ICacheService, LoginProtectionService, LoginProtectionSettings, Result, SharedStore |
| 7 | `LoginProtectionServiceTests` | MMCA.Common.Infrastructure.Tests | 7 | ErrorType, FakeCacheService, ICacheService, LoginProtectionService, LoginProtectionSettings, Result, ThrowingCacheService |
| 7 | `OwnsAddressTests` | MMCA.Common.Infrastructure.Tests | 6 | Address, AddressInvariants, AddressTestDbContext, HandRolledOwner, HelperOwner, PropertyFacets |
| 7 | `OwnsMoneyTests` | MMCA.Common.Infrastructure.Tests | 6 | Currency, HandRolledOwner, HelperOwner, Money, MoneyTestDbContext, PropertyFacets |
| 7 | `PasswordResetTokenServiceTests` | MMCA.Common.Infrastructure.Tests | 9 | ErrorType, FakeCacheService, FakeTimeProvider, ICacheService, InProcessDistributedLock, PasswordResetEntry, PasswordResetSettings, PasswordResetTokenService, Result |
| 7 | `TenantContextTests` | MMCA.Common.Infrastructure.Tests | 1 | TenantContext |
| 7 | `TenantScopeInsideARestoredHopTests` | MMCA.Common.Infrastructure.Tests | 9 | AmbientOrigin, CorrelationContext, DataSource, DataSourceKey, ICorrelationContext, ITenantContext, ScopedUserOverride, TenantContext, TenantDataSourceTarget |
| 7 | `TestConfigDbContext` | MMCA.Common.Infrastructure.Tests | 2 | TestAggregateEntity, TestAggregateEntityConfiguration |
| 7 | `TestNonAggregateConfigDbContext` | MMCA.Common.Infrastructure.Tests | 2 | TestNonAggregateEntity, TestNonAggregateEntityConfiguration |
| 7 | `StronglyTypedIdTests` | MMCA.Common.Shared.Tests | 7 | CustomerId, LineId, OrderId, SkuId, SpeakerId, StronglyTypedId, StronglyTypedIdRegistry |
| 7 | `NotificationUIModule` | MMCA.Common.UI | 7 | IUIModule, NavItem, NavSection, NotificationBell, NotificationPermissions, NotificationRoutePaths, SharedResource |
| 7 | `AuthUIServiceTests` | MMCA.Common.UI.Tests | 17 | AuthenticationResponse, AuthResponse, AuthUIService, DirectApiTokenRefresher, ErrorType, HttpResultExecutor, ILocalCacheStore, IPushRegistrationService, ISecureTokenStore, ITokenRefresher, ITokenStorageService, Jwt, JwtAuthenticationStateProvider, LoginRequest, RegisterRequest, StubHttpClientFactory, StubHttpMessageHandler |
| 7 | `BiometricGateTests` | MMCA.Common.UI.Tests | 21 | AppLifecycleNotifier, AuthUIService, BiometricGate, BunitTestBase, DevicePreferenceKeys, FakeBiometricAuthenticator, FakeDevicePreferences, FakeTimeProvider, IAppLifecycleNotifier, IAuthUIService, IBiometricAuthenticator, IDevicePreferences, ILocalCacheStore, IPushRegistrationService, ITokenRefresher, ITokenStorageService, IUiReadCache, JwtAuthenticationStateProvider, StubHttpClientFactory, StubHttpMessageHandler …(+1) |
| 7 | `NotificationBellHost` | MMCA.Common.UI.Tests | 1 | NotificationBell |
| 7 | `NotificationListTests` | MMCA.Common.UI.Tests | 12 | AuthClaimTypes, BunitTestBase, Error, IPushNotificationUIService, IToastService, NotificationList, NotificationPermissions, PagedCollectionResult<T>, PaginationMetadata, PushNotificationDTO, Result, ToastSeverity |
| 7 | `NotificationSendTests` | MMCA.Common.UI.Tests | 14 | AuthClaimTypes, BunitTestBase, Error, INotificationScopeProvider, IPushNotificationUIService, IToastService, NamedScopeProvider, NotificationPermissions, NotificationSend, NullNotificationScopeProvider, PushNotificationDTO, Result, SendPushNotificationRequest, ToastSeverity |
| 7 | `SessionsTests` | MMCA.Common.UI.Tests | 10 | BunitTestBase, Error, IAppDialogService, IAuthUIService, IToastService, RefreshSessionSummaryResponse, Result, Sessions, TestPrincipal, ToastSeverity |
| 7 | `TermsAcceptanceGateTests` | MMCA.Common.UI.Tests | 13 | BunitTestBase, Error, HttpResultExecutor, IAuthUIService, IExternalLinkService, ILegalAcceptanceUIService, LegalAcceptanceDTO, MudProviderHandles, NullExternalLinkService, ProblemDetailsResultReader, Result, TermsAcceptanceGate, TestPrincipal |
| 7 | `UserAdminListPrerenderTests` | MMCA.Common.UI.Tests | 8 | BunitTestBase, IAppDialogService, IUserAdminActionsUIService, IUserAdminUIService<TUserDto>, Result, TestUser, UserAdminList<TUser>, UserAdminListTests |
| 8 | `CategoryItemsController` | MMCA.ADC.Conference.API | 17 | AddCategoryItemCommand, AddCategoryItemRequest, BaseLookup<TIdentifierType>, CategoryItem, CategoryItemDTO, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveCategoryItemCommand, Result, Route, UpdateCategoryItemCommand, UpdateCategoryItemRequest |
| 8 | `SessionSelectionController` | MMCA.ADC.Conference.API | 20 | ApiControllerBase, CategoryDistributionDTO, ConferenceFeatures, ConferencePermissions, ContentSimilarityDTO, Error, Event, GetCategoryDistributionQuery, GetContentSimilarityQuery, GetSessionSelectionDashboardQuery, GetSpeakerSessionOverlapQuery, IEntityReader<TEntity, TIdentifierType>, IInternalCommandScheduler, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Route, ScoreEventSessionsInternalCommand, SessionSelectionDashboardDTO, SpeakerSessionOverlapDTO |
| 8 | `ActivityFieldRules<T>` | MMCA.ADC.Conference.Application | 8 | ActivityDescriptionRules<T>, ActivityNameRules<T>, ActivitySortOrderRules<T>, ActivityTimeRangeRules<T>, ActivityVenueAddressRules<T>, ActivityVenueNameRules<T>, ActivityVenueUrlRules<T>, IActivityFieldsRequest |
| 8 | `AddCategoryItemCommandValidator` | MMCA.ADC.Conference.Application | 3 | AddCategoryItemCommand, CategoryItemNameRules<T>, CategoryItemSortRules<T> |
| 8 | `AddEventQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `AddEventSpeakerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `AddRoomCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `AddSpeakerCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Speaker |
| 8 | `BatchAddEventQuestionAnswersCommand` | MMCA.ADC.Conference.Application | 4 | BatchEventQuestionAnswerItem, Event, ICacheInvalidating, ITransactional |
| 8 | `ConferenceCategoryCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | Category, ConferenceCategoryCreateRequest, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result |
| 8 | `ConferenceCategoryCreateRequestValidator` | MMCA.ADC.Conference.Application | 2 | ConferenceCategoryCreateRequest, ConferenceCategoryTitleRules<T> |
| 8 | `ConferenceCategoryDTOMapper` | MMCA.ADC.Conference.Application | 4 | Category, CategoryItemDTOMapper, ConferenceCategoryDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 8 | `ConferenceCategoryUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | ConferenceCategoryTitleRules<T>, ConferenceCategoryUpdateRequest |
| 8 | `DeleteSessionAssetHandler` | MMCA.ADC.Conference.Application | 9 | DeleteSessionAssetBlobInternalCommand, DeleteSessionAssetCommand, Error, ICommandHandler<in TCommand, TResult>, IInternalCommandScheduler, ISessionAssetAccessService, IUnitOfWork, Result, SessionAsset |
| 8 | `EventCreateRequest` | MMCA.ADC.Conference.Application | 4 | Event, ICacheInvalidating, ICreateRequest, IEventFieldsRequest |
| 8 | `EventFieldRules<T>` | MMCA.ADC.Conference.Application | 12 | EventDateRangeRules<T>, EventDescriptionRules<T>, EventNameRules<T>, EventOrganizerContactEmailRules<T>, EventSessionizeCodeRules<T>, EventSponsorshipPacketUrlRules<T>, EventTicketingUrlRules<T>, EventTimeZoneRules<T>, EventVenueAddressRules<T>, EventVenueMapUrlRules<T>, EventWiFiInfoRules<T>, IEventFieldsRequest |
| 8 | `EventQuestionAnswerDTOMapper` | MMCA.ADC.Conference.Application | 3 | EventQuestionAnswer, EventQuestionAnswerDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 8 | `EventQuestionAnswerRules` | MMCA.ADC.Conference.Application | 7 | Error, Event, EventInvariants, EventQuestionAnswer, Question, QuestionInvariants, Result |
| 8 | `EventSpeakerDTOMapper` | MMCA.ADC.Conference.Application | 3 | EventSpeaker, EventSpeakerDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 8 | `LinkUserToSpeakerCommand` | MMCA.ADC.Conference.Application | 3 | ICacheInvalidating, ITransactional, Speaker |
| 8 | `PartnerFieldRules<T>` | MMCA.ADC.Conference.Application | 6 | IPartnerFieldsRequest, PartnerDescriptionRules<T>, PartnerInvariants, PartnerNameRules<T>, PartnerOptionalUrlRules<T>, PartnerSortRules<T> |
| 8 | `PublishedEventSpecification` | MMCA.ADC.Conference.Application | 2 | Event, Specification<TEntity, TIdentifierType> |
| 8 | `PublishEventCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `QuestionCreateRequest` | MMCA.ADC.Conference.Application | 3 | ICacheInvalidating, ICreateRequest, Question |
| 8 | `QuestionDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, Question, QuestionDTO |
| 8 | `QuestionUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | QuestionTextRules<T>, QuestionUpdateRequest |
| 8 | `RefreshFromSessionizeCommand` | MMCA.ADC.Conference.Application | 4 | ConferenceFeatures, Event, ICacheInvalidating, IFeatureGated |
| 8 | `RemoveEventQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `RemoveEventSpeakerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `RemoveRoomCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `RemoveSpeakerCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Speaker |
| 8 | `RoomDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, Room, RoomDTO |
| 8 | `SessionAssetDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SessionAsset, SessionAssetDTO |
| 8 | `SessionAssetFieldRules<T>` | MMCA.ADC.Conference.Application | 3 | ISessionAssetFieldsRequest, SessionAssetSortOrderRules<T>, SessionAssetTitleRules<T> |
| 8 | `SessionFieldRules<T>` | MMCA.ADC.Conference.Application | 8 | ISessionFieldsRequest, SessionAccessibilityInfoRules<T>, SessionDescriptionRules<T>, SessionLiveUrlRules<T>, SessionRecordingUrlRules<T>, SessionResourceLinksRules<T>, SessionStatusRules<T>, SessionTitleRules<T> |
| 8 | `SessionizeSyncContext` | MMCA.ADC.Conference.Application | 3 | Event, IUnitOfWork, SessionizeResponse |
| 8 | `SpeakerCategoryItemDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SpeakerCategoryItem, SpeakerCategoryItemDTO |
| 8 | `SpeakerCreateRequest` | MMCA.ADC.Conference.Application | 4 | ICacheInvalidating, ICreateRequest, ISpeakerFieldsRequest, Speaker |
| 8 | `SpeakerFieldRules<T>` | MMCA.ADC.Conference.Application | 7 | ISpeakerFieldsRequest, SpeakerEmailRules<T>, SpeakerFirstNameRules<T>, SpeakerGitHubUrlRules<T>, SpeakerLastNameRules<T>, SpeakerLinkedInUrlRules<T>, SpeakerWebsiteUrlRules<T> |
| 8 | `SpeakerLocalityHelper` | MMCA.ADC.Conference.Application | 3 | Category, LocalityLookupEntry, Speaker |
| 8 | `SpeakerQuestionAnswerDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SpeakerQuestionAnswer, SpeakerQuestionAnswerDTO |
| 8 | `SponsorFieldRules<T>` | MMCA.ADC.Conference.Application | 10 | ISponsorFieldsRequest, SponsorBoothNumberRules<T>, SponsorDescriptionRules<T>, SponsorLinkedInUrlRules<T>, SponsorLogoUrlRules<T>, SponsorNameRules<T>, SponsorSortRules<T>, SponsorTierRules<T>, SponsorTwitterHandleRules<T>, SponsorWebsiteUrlRules<T> |
| 8 | `UnlinkUserFromSpeakerCommand` | MMCA.ADC.Conference.Application | 3 | ICacheInvalidating, ITransactional, Speaker |
| 8 | `UnpublishEventCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `UpdateCategoryItemCommandValidator` | MMCA.ADC.Conference.Application | 3 | CategoryItemNameRules<T>, CategoryItemSortRules<T>, UpdateCategoryItemCommand |
| 8 | `UpdateEventCommand` | MMCA.ADC.Conference.Application | 4 | Event, EventUpdateRequest, ICacheInvalidating, ICommandWithRequest<out TRequest> |
| 8 | `UpdateEventQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `UpdateQuestionCommand` | MMCA.ADC.Conference.Application | 4 | ICacheInvalidating, ICommandWithRequest<out TRequest>, Question, QuestionUpdateRequest |
| 8 | `UpdateRoomCommand` | MMCA.ADC.Conference.Application | 2 | Event, ICacheInvalidating |
| 8 | `UpdateSpeakerCommand` | MMCA.ADC.Conference.Application | 3 | Speaker, SpeakerUpdateRequest, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 8 | `UserDeletedSpeakerUnlinkHandler` | MMCA.ADC.Conference.Application | 5 | IUnitOfWork, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, Speaker, SpeakerUnlinkedFromUser, UserDeleted |
| 8 | `UserRegisteredHandler` | MMCA.ADC.Conference.Application | 8 | Email, IEntityQuerier<TEntity, TIdentifierType>, IEventBus, IUnitOfWork, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, Speaker, SpeakerLinkedToUser, UserRegistered |
| 8 | `CategoryItemDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Category, CategoryItem, CategoryItemDTOMapper |
| 8 | `RecordingUnitOfWork` | MMCA.ADC.Conference.Application.Tests | 6 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, InMemoryRepository<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork |
| 8 | `SessionAssetFixtures` | MMCA.ADC.Conference.Application.Tests | 1 | SessionAsset |
| 8 | `TestCategoryItemValidator` | MMCA.ADC.Conference.Application.Tests | 3 | CategoryItemNameRules<T>, CategoryItemSortRules<T>, TestCategoryItemModel |
| 8 | `TestCategoryTitleValidator` | MMCA.ADC.Conference.Application.Tests | 2 | ConferenceCategoryTitleRules<T>, TestCategoryModel |
| 8 | `TestEventValidator` | MMCA.ADC.Conference.Application.Tests | 4 | EventDateRangeRules<T>, EventNameRules<T>, EventTimeZoneRules<T>, TestEventModel |
| 8 | `TestQuestionTextValidator` | MMCA.ADC.Conference.Application.Tests | 2 | QuestionTextRules<T>, TestQuestionModel |
| 8 | `TestRoomValidator` | MMCA.ADC.Conference.Application.Tests | 7 | RoomAccessibilityInfoRules<T>, RoomCapacityRules<T>, RoomFloorRules<T>, RoomLocationRules<T>, RoomNameRules<T>, RoomSortRules<T>, TestRoomModel |
| 8 | `TestSessionValidator` | MMCA.ADC.Conference.Application.Tests | 3 | SessionEventIdRules<T>, SessionTitleRules<T>, TestSessionModel |
| 8 | `TestSpeakerValidator` | MMCA.ADC.Conference.Application.Tests | 3 | SpeakerFirstNameRules<T>, SpeakerLastNameRules<T>, TestSpeakerModel |
| 8 | `Activity` | MMCA.ADC.Conference.Domain | 6 | ActivityChanged, ActivityInvariants, AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Event, Result |
| 8 | `Partner` | MMCA.ADC.Conference.Domain | 7 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Event, PartnerChanged, PartnerInvariants, PartnerType, Result |
| 8 | `Session` | MMCA.ADC.Conference.Domain | 15 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Error, Event, IAuditedEntity, Result, Room, SessionCategoryItem, SessionCategoryItemChanged, SessionChanged, SessionInvariants, SessionQuestionAnswer, SessionQuestionAnswerChanged, SessionSpeaker, SessionSpeakerChanged |
| 8 | `SessionCategoryItem` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, IReactivatable, Result, Session |
| 8 | `SessionQuestionAnswer` | MMCA.ADC.Conference.Domain | 5 | AuditableBaseEntity<TIdentifierType>, QuestionInvariants, Result, Session, SessionInvariants |
| 8 | `SessionSpeaker` | MMCA.ADC.Conference.Domain | 4 | AuditableBaseEntity<TIdentifierType>, IReactivatable, Result, Session |
| 8 | `Sponsor` | MMCA.ADC.Conference.Domain | 7 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Event, Result, SponsorChanged, SponsorInvariants, SponsorTier |
| 8 | `EventBuilder` | MMCA.ADC.Conference.Domain.Tests | 2 | EntityBuilderBase<TBuilder, TEntity>, Event |
| 8 | `EventQuestionAnswerTests` | MMCA.ADC.Conference.Domain.Tests | 7 | DomainEntityState, ErrorType, Event, EventInvariants, EventQuestionAnswer, EventQuestionAnswerChanged, QuestionInvariants |
| 8 | `EventSpeakerTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, ErrorType, Event, EventSpeaker, EventSpeakerChanged |
| 8 | `EventTests` | MMCA.ADC.Conference.Domain.Tests | 9 | DomainEntityState, Event, EventChanged, EventInvariants, EventSpeaker, EventSpeakerChanged, QuestionModerationDefault, Room, RoomChanged |
| 8 | `QuestionTests` | MMCA.ADC.Conference.Domain.Tests | 1 | Question |
| 8 | `SessionAssetBuilder` | MMCA.ADC.Conference.Domain.Tests | 3 | EntityBuilderBase<TBuilder, TEntity>, SessionAsset, SessionAssetKind |
| 8 | `SpeakerBuilder` | MMCA.ADC.Conference.Domain.Tests | 2 | EntityBuilderBase<TBuilder, TEntity>, Speaker |
| 8 | `SpeakerCategoryItemTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, ErrorType, Speaker, SpeakerCategoryItem, SpeakerCategoryItemChanged |
| 8 | `SpeakerQuestionAnswerTests` | MMCA.ADC.Conference.Domain.Tests | 6 | DomainEntityState, ErrorType, Speaker, SpeakerInvariants, SpeakerQuestionAnswer, SpeakerQuestionAnswerChanged |
| 8 | `SpeakerTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, Speaker, SpeakerCategoryItemChanged, SpeakerChanged, SpeakerInvariants |
| 8 | `SeederMocks` | MMCA.ADC.Conference.Infrastructure.Tests | 4 | Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question |
| 8 | `SessionizeServiceTests` | MMCA.ADC.Conference.Infrastructure.Tests | 8 | Question, SessionizeCategory, SessionizeCodeFormat, SessionizeQuestion, SessionizeResponse, SessionizeRoom, SessionizeService, Sessions |
| 8 | `CurrentEventSelector` | MMCA.ADC.Conference.Shared | 1 | Event |
| 8 | `EventDetail` | MMCA.ADC.Conference.UI | 14 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, ErrorType, Event, EventDTO, EventEditModel, EventService, IEventUIService, IToastService, ModelValidation, RefreshFromSessionizeResultDTO, Result, SessionizeCodeFormat |
| 8 | `PublicEventDetail` | MMCA.ADC.Conference.UI | 13 | ConferenceRoutePaths, Event, EventDTO, EventService, IClipboardService, IEventUIService, IGeocodingService, IGeolocationService, IMapNavigationService, IToastService, LatestLoadGuard, PublicReadAudience, ToastSeverity |
| 8 | `QuestionDetail` | MMCA.ADC.Conference.UI | 10 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, IQuestionUIService, IToastService, ModelValidation, Question, QuestionDTO, QuestionEditModel, QuestionService |
| 8 | `RoomDetail` | MMCA.ADC.Conference.UI | 13 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IRoomUIService, IToastService, ModelValidation, Room, RoomDTO, RoomEditModel, RoomService |
| 8 | `OrganizerEventFeedbackTests` | MMCA.ADC.Conference.UI.Tests | 12 | BunitTestBase, Error, EventInfo, EventQuestionAnswerDTO, IEventLookupService, IOrganizerEventFeedbackUIService, IQuestionUIService, IToastService, OrganizerEventFeedback, Question, QuestionDTO, Result |
| 8 | `QuestionListDoubles` | MMCA.ADC.Conference.UI.Tests | 3 | IQuestionUIService, Question, QuestionDTO |
| 8 | `SessionSelectionSpeakerOverlapTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, MultiSessionSpeaker, Sessions, SessionSelectionSpeakerOverlap, SpeakerSessionSummary |
| 8 | `PublicBrowseTests` | MMCA.ADC.E2E.Tests | 17 | AdcE2ETestBase, E2ETestCollection, Event, EventCreatePage, EventDetailPage, FeaturedEvent, GatewayApi, PlaywrightFixture, PublicEventDetailPage, PublicEventListPage, PublicSessionListPage, PublicSpeakerDetailPage, PublicSpeakerListPage, SessionCreatePage, SessionDetailPage, SpeakerCreatePage, SpeakerDetailPage |
| 8 | `BookmarkCountService` | MMCA.ADC.Engagement.Application | 3 | IBookmarkCountService, IUnitOfWork, UserSessionBookmark |
| 8 | `CreateLivePollCommandValidator` | MMCA.ADC.Engagement.Application | 2 | CreateLivePollCommand, CreateLivePollRequestValidator |
| 8 | `GetBookmarkedSessionIdsHandler` | MMCA.ADC.Engagement.Application | 5 | GetBookmarkedSessionIdsQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, UserSessionBookmark |
| 8 | `GetLeaderboardHandler` | MMCA.ADC.Engagement.Application | 9 | GetLeaderboardQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LeaderboardEntryDTO, LeaderboardOptIn, OptInRow, PointsEntry, PointsSettings, Result |
| 8 | `GetPointsOverviewHandler` | MMCA.ADC.Engagement.Application | 9 | GetPointsOverviewQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, OverviewRow, PointsActivityTotalDTO, PointsEntry, PointsEntryDTO, PointsOverviewDTO, Result |
| 8 | `SessionQuestionUpvoteChangedHandler` | MMCA.ADC.Engagement.Application | 11 | BestEffort, IDomainEventHandler<in TDomainEvent>, ILiveChannelPublishQueue, IUnitOfWork, LiveChannelPublishWorkItem, LivePollChannel, SessionQuestion, SessionQuestionChannel, SessionQuestionUpvote, SessionQuestionUpvoteChanged, SessionQuestionUpvoteChangedPayload |
| 8 | `SessionQuestionViewBuilder` | MMCA.ADC.Engagement.Application | 5 | IQueryableExecutor, IUnitOfWork, SessionQuestion, SessionQuestionDTO, SessionQuestionUpvote |
| 8 | `ToggleUpvoteHandler` | MMCA.ADC.Engagement.Application | 12 | Error, ICommandHandler<in TCommand, TResult>, IConcurrencyConflictDetector, IEntityReader<TEntity, TIdentifierType>, IEventLiveValidationService, IRepository<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, IUnitOfWork, Result, SessionQuestion, SessionQuestionUpvote, ToggleUpvoteCommand |
| 8 | `UserDeletedBadgeHandler` | MMCA.ADC.Engagement.Application | 4 | AttendeeBadge, IUnitOfWork, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, UserDeleted |
| 8 | `UserDeletedBookmarksHandler` | MMCA.ADC.Engagement.Application | 4 | IUnitOfWork, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, UserDeleted, UserSessionBookmark |
| 8 | `UserDeletedPointsHandler` | MMCA.ADC.Engagement.Application | 4 | IUnitOfWork, LeaderboardOptIn, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, UserDeleted |
| 8 | `UserDeletedSessionQuestionsHandler` | MMCA.ADC.Engagement.Application | 5 | IUnitOfWork, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, SessionQuestion, SessionQuestionUpvote, UserDeleted |
| 8 | `UserDeletedVotesHandler` | MMCA.ADC.Engagement.Application | 4 | IUnitOfWork, LivePollVote, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, UserDeleted |
| 8 | `UserSessionBookmarkDTOMapper` | MMCA.ADC.Engagement.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, UserSessionBookmark, UserSessionBookmarkDTO |
| 8 | `AwarderMocks` | MMCA.ADC.Engagement.Application.Tests | 3 | IRepository<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, PointsEntry |
| 8 | `CreateLivePollRequestValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 4 | CreateLivePollRequest, CreateLivePollRequestValidator, LivePollInvariants, Question |
| 8 | `HandlerMocks` | MMCA.ADC.Engagement.Application.Tests | 9 | IDistributedLock, IEventLiveValidationService, ILiveChannelPublishQueue, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, LiveChannelPublishWorkItem, SessionQuestion, SessionQuestionUpvote |
| 8 | `HandlerMocks` | MMCA.ADC.Engagement.Application.Tests | 5 | IQueryableExecutor, IRepository<TEntity, TIdentifierType>, ISessionBookmarkValidationService, IUnitOfWork, UserSessionBookmark |
| 8 | `MutableOptions` | MMCA.ADC.Engagement.Application.Tests | 1 | PointsSettings |
| 8 | `SubmitQuestionCommandValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 3 | SessionQuestionInvariants, SubmitQuestionCommand, SubmitQuestionCommandValidator |
| 8 | `BookmarkManagementDomainService` | MMCA.ADC.Engagement.Domain | 2 | Result, UserSessionBookmark |
| 8 | `LivePoll` | MMCA.ADC.Engagement.Domain | 9 | AuditableAggregateRootEntity<TIdentifierType>, DomainEntityState, Error, LivePollChanged, LivePollInvariants, LivePollOption, LivePollStatus, Question, Result |
| 8 | `LivePollOption` | MMCA.ADC.Engagement.Domain | 4 | AuditableBaseEntity<TIdentifierType>, LivePoll, LivePollInvariants, Result |
| 8 | `AttendeeBadgeTests` | MMCA.ADC.Engagement.Domain.Tests | 1 | AttendeeBadge |
| 8 | `LivePollVoteTests` | MMCA.ADC.Engagement.Domain.Tests | 3 | DomainEntityState, LivePollVote, LivePollVoteChanged |
| 8 | `PointsEntryTests` | MMCA.ADC.Engagement.Domain.Tests | 5 | DomainEntityState, PointsActivityType, PointsEntry, PointsEntryChanged, PointsSubjectKeys |
| 8 | `SessionQuestionTests` | MMCA.ADC.Engagement.Domain.Tests | 5 | DomainEntityState, QuestionStatus, SessionQuestion, SessionQuestionChanged, SessionQuestionInvariants |
| 8 | `SessionQuestionUpvoteTests` | MMCA.ADC.Engagement.Domain.Tests | 3 | DomainEntityState, SessionQuestionUpvote, SessionQuestionUpvoteChanged |
| 8 | `UserSessionBookmarkTests` | MMCA.ADC.Engagement.Domain.Tests | 3 | DomainEntityState, UserSessionBookmark, UserSessionBookmarkChanged |
| 8 | `PointsSettingsTests` | MMCA.ADC.Engagement.Shared.Tests | 5 | EventFeedback, PointsActivityType, PointsSettings, SessionFeedback, SponsorVisit |
| 8 | `PollManagementPanel` | MMCA.ADC.Engagement.UI | 8 | CreateLivePollRequest, ErrorType, ILivePollUIService, IToastService, LivePollDTO, OptionState, Question, Result |
| 8 | `SessionLiveModerationPanel` | MMCA.ADC.Engagement.UI | 12 | CreateLivePollRequest, ErrorType, ILivePollUIService, ISessionQuestionUIService, IToastService, LivePollDTO, LivePollStatus, OptionState, Question, QuestionService, Result, SessionQuestionDTO |
| 8 | `AttendeeLookupServiceTests` | MMCA.ADC.Engagement.UI.Tests | 8 | AdvanceableTimeProvider, AttendeeLookupService, AttendeeSummary, CapturingHttpMessageHandler, GatedHttpMessageHandler, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata |
| 8 | `EventFeedbackTests` | MMCA.ADC.Engagement.UI.Tests | 12 | BunitComponentTestBase, Error, EventFeedback, EventInfo, EventQuestionAnswerDTO, FeedbackAnswerModel, IEventFeedbackUIService, IEventLookupService, IQuestionLookupService, Question, QuestionDTO, Result |
| 8 | `LivePollCardTests` | MMCA.ADC.Engagement.UI.Tests | 5 | BunitComponentTestBase, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, Question |
| 8 | `LivePollUIServiceTests` | MMCA.ADC.Engagement.UI.Tests | 12 | CapturingHttpMessageHandler, CreateLivePollRequest, ErrorType, HttpTestDoubles, IdempotencyHeaders, LivePollDTO, LivePollOptionDTO, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, LivePollUIService, Question |
| 8 | `PresenterViewTests` | MMCA.ADC.Engagement.UI.Tests | 17 | ApiSettings, BunitComponentTestBase, Error, ILivePollUIService, ISessionLookupService, ISessionQuestionUIService, ITokenStorageService, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, NotificationHubService, PresenterView, Question, QuestionStatus, Result, SessionInfo, SessionQuestionDTO |
| 8 | `SessionFeedbackTests` | MMCA.ADC.Engagement.UI.Tests | 13 | BunitComponentTestBase, Error, IEntityService<TEntityDTO, TIdentifierType>, IQuestionLookupService, ISessionFeedbackUIService, IToastService, Question, QuestionDTO, Result, SessionDTO, SessionFeedback, SessionQuestionAnswerDTO, ToastSeverity |
| 8 | `SessionLivePollPanelTests` | MMCA.ADC.Engagement.UI.Tests | 11 | BunitComponentTestBase, Error, IHapticFeedbackService, ILivePollUIService, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, NullHapticFeedbackService, Question, Result, SessionLivePollPanel |
| 8 | `SessionLiveQuestionPanelTests` | MMCA.ADC.Engagement.UI.Tests | 9 | BunitComponentTestBase, ISessionQuestionUIService, ISpeechToTextService, Question, QuestionStatus, Result, SessionLiveQuestionPanel, SessionQuestionDTO, SubmitQuestionRequest |
| 8 | `EmailConfirmationControllerTests` | MMCA.ADC.Identity.API.Tests | 8 | ConfirmEmailCommand, ConfirmEmailRequest, EmailConfirmationController, Error, ICommandHandler<in TCommand, TResult>, Result, SendEmailConfirmationCommand, SendEmailConfirmationRequest |
| 8 | `OAuthControllerTests` | MMCA.ADC.Identity.API.Tests | 9 | AuthenticationResponse, Error, IAuthenticationService, ICacheService, IDistributedLock, OAuthCodeExchangeRequest, OAuthController, Result, User |
| 8 | `AttendeeQueryService` | MMCA.ADC.Identity.Application | 5 | IAttendeeQueryService, IUnitOfWork, SyntheticAccounts, User, UserRole |
| 8 | `ChangePasswordCommand` | MMCA.ADC.Identity.Application | 5 | ChangePasswordRequest, ICacheInvalidating, ICommandWithRequest<out TRequest>, IUserScopedCommand<out TRequest>, User |
| 8 | `ChangePreferencesCommand` | MMCA.ADC.Identity.Application | 4 | ChangePreferencesRequest, ICacheInvalidating, IUserScopedCommand<out TRequest>, User |
| 8 | `DeleteUserCommand` | MMCA.ADC.Identity.Application | 4 | ICacheInvalidating, ITransactional, IUserOwnedRequest, User |
| 8 | `GetUserAvatarHandler` | MMCA.ADC.Identity.Application | 7 | Error, GetUserAvatarQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, User, UserAvatarDTO |
| 8 | `GetUsersHandler` | MMCA.ADC.Identity.Application | 11 | Email, GetUsersQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PagedCollectionResult<T>, PaginationMetadata, PagingMath, Result, User, UserListDTO |
| 8 | `LegalAcceptanceService` | MMCA.ADC.Identity.Application | 6 | Error, ILegalAcceptanceService, IUnitOfWork, LegalAcceptanceDTO, Result, User |
| 8 | `ResetPasswordCommand` | MMCA.ADC.Identity.Application | 4 | ICacheInvalidating, ICommandWithRequest<out TRequest>, ResetPasswordRequest, User |
| 8 | `SpeakerLinkedToUserHandler` | MMCA.ADC.Identity.Application | 4 | IUnitOfWork, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, SpeakerLinkedToUser, User |
| 8 | `SpeakerUnlinkedFromUserHandler` | MMCA.ADC.Identity.Application | 4 | IUnitOfWork, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, SpeakerUnlinkedFromUser, User |
| 8 | `UserAdministrationService` | MMCA.ADC.Identity.Application | 15 | Email, Error, IQueryableExecutor, IRefreshSessionStore, IUnitOfWork, IUserAdministrationService<TUserDto>, PagedCollectionResult<T>, PaginationMetadata, PagingMath, RefreshSession, Result, User, UserAdminDTO, UserAdministrationQuery, UserRole |
| 8 | `UserDTOMapper` | MMCA.ADC.Identity.Application | 4 | Email, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, User, UserDTO |
| 8 | `RecordingUnitOfWork` | MMCA.ADC.Identity.Application.Tests | 6 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, InMemoryRepository<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork |
| 8 | `RegisterRequestValidatorTests` | MMCA.ADC.Identity.Application.Tests | 2 | RegisterRequest, RegisterRequestValidator |
| 8 | `ServiceMocks` | MMCA.ADC.Identity.Application.Tests | 11 | IExternalLoginEmailVerifier, ILoginProtectionService, InMemoryRefreshSessionStore, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, LoginRequest, RefreshTokenRequest, RegisterRequest, User |
| 8 | `UserAcceptTermsTests` | MMCA.ADC.Identity.Domain.Tests | 3 | Result, User, UserRole |
| 8 | `UserAnonymizeTests` | MMCA.ADC.Identity.Domain.Tests | 4 | Email, Result, User, UserRole |
| 8 | `UserBuilder` | MMCA.ADC.Identity.Domain.Tests | 3 | EntityBuilderBase<TBuilder, TEntity>, User, UserRole |
| 8 | `UserInvariantsAndRoleTests` | MMCA.ADC.Identity.Domain.Tests | 4 | Result, User, UserDeleted, UserRole |
| 8 | `UserTests` | MMCA.ADC.Identity.Domain.Tests | 3 | User, UserPasswordChanged, UserRole |
| 8 | `SeederMocks` | MMCA.ADC.Identity.Infrastructure.Tests | 4 | IPasswordHasher, IRepository<TEntity, TIdentifierType>, IUnitOfWork, User |
| 8 | `DependencyInjection` | MMCA.ADC.Identity.UI | 4 | IdentityUIModule, IUserUIService, UserAdminDTO, UserService |
| 8 | `IdentityUIModuleTests` | MMCA.ADC.Identity.UI.Tests | 2 | IdentityUIModule, TermsAcceptanceGate |
| 8 | `UserListTests` | MMCA.ADC.Identity.UI.Tests | 12 | AuthClaimTypes, BunitTestBase, Email, Error, IAppDialogService, IUserAdminActionsUIService, IUserUIService, Result, User, UserAdminList<TUser>, UserList, UserListDTO |
| 8 | `UserNotificationExportService` | MMCA.ADC.Notification.Application | 6 | IQueryableExecutor, IUnitOfWork, IUserNotificationExportService, PushNotification, UserNotification, UserNotificationExportItemDTO |
| 8 | `ConferenceBrokerConsumersTests` | MMCA.ADC.Services.Tests | 6 | ConferenceBrokerConsumers, FaultIntegrationEventConsumer<TEvent>, IntegrationEventConsumer<TEvent>, OutputCacheEvictionRequested, UserDeleted, UserRegistered |
| 8 | `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>` | MMCA.Common.API | 10 | AuditableAggregateRootEntity<TIdentifierType>, DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>, IBaseDTO<TIdentifierType>, ICommandHandler<in TCommand, TResult>, ICreateRequest, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, Route |
| 8 | `CurrentUserTargetingContextAccessor` | MMCA.Common.API | 1 | User |
| 8 | `AsyncScopedReadController` | MMCA.Common.API.Tests | 5 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ReadScopeDTO, ReadScopeEntity, Specification<TEntity, TIdentifierType> |
| 8 | `BothHooksReadController` | MMCA.Common.API.Tests | 5 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ReadScopeDTO, ReadScopeEntity, Specification<TEntity, TIdentifierType> |
| 8 | `DefaultExportTestController` | MMCA.Common.API.Tests | 4 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ExportTestDTO, ExportTestEntity, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType> |
| 8 | `EmailConfirmationControllerBaseTests` | MMCA.Common.API.Tests | 11 | ConfirmEmailRequest, EmailConfirmationControllerBase<TSendCommand, TConfirmCommand>, Error, ICommandHandler<in TCommand, TResult>, IdempotentAttribute, Result, SendEmailConfirmationRequest, TestConfirmEmailCommand, TestEmailConfirmationController, TestSendEmailConfirmationCommand, WebApplicationBuilderExtensions |
| 8 | `ExportShapeTestController` | MMCA.Common.API.Tests | 4 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ExportShapeTestDTO, ExportTestEntity, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType> |
| 8 | `ExportTestController` | MMCA.Common.API.Tests | 4 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ExportTestDTO, ExportTestEntity, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType> |
| 8 | `OAuthControllerBaseTests` | MMCA.Common.API.Tests | 13 | AuthenticationResponse, Error, ExternalAuthExtensions, IAuthenticationService, ICacheService, IDistributedLock, LockingTestOAuthController, Mocks, OAuthCodeExchangeRequest, RecordingHandle, Result, SingleServiceProvider, TestOAuthController |
| 8 | `PlainEntityController` | MMCA.Common.API.Tests | 4 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PlainDTO, PlainEntity |
| 8 | `ScopedExportTestController` | MMCA.Common.API.Tests | 5 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ExportTestDTO, ExportTestEntity, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Specification<TEntity, TIdentifierType> |
| 8 | `SyncScopedReadController` | MMCA.Common.API.Tests | 5 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ReadScopeDTO, ReadScopeEntity, Specification<TEntity, TIdentifierType> |
| 8 | `TestEntityController` | MMCA.Common.API.Tests | 5 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, TestDTO, TestEntity |
| 8 | `UnscopedReadController` | MMCA.Common.API.Tests | 4 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ReadScopeDTO, ReadScopeEntity |
| 8 | `VersionedEntityController` | MMCA.Common.API.Tests | 4 | EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, VersionedDTO, VersionedEntity |
| 8 | `AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>` | MMCA.Common.Application | 6 | AuditableAggregateRootEntity<TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IUniqueConstraintViolationDetector, IUnitOfWork, Result |
| 8 | `AuthenticationServiceBase<TUser>` | MMCA.Common.Application | 28 | AuditableAggregateRootEntity<TIdentifierType>, AuthClaimTypes, AuthenticationResponse, AuthenticationValidators, AuthErrorCodes, Email, EmailConfirmationErrors, EmailConfirmationSettings, Error, IAuthenticationService, IAuthSessionIssuer, IAuthUser, IEmailConfirmableUser, ILoginProtectionService, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, ITwoFactorAuthenticator, IUnitOfWork, LegalAcceptanceErrors …(+8) |
| 8 | `ChangePasswordHandlerBase<TUser, TCommand>` | MMCA.Common.Application | 12 | AuditableAggregateRootEntity<TIdentifierType>, ChangePasswordRequest, Error, ICommandHandler<in TCommand, TResult>, ILoginProtectionService, IPasswordChangeableUser, IPasswordHasher, IRefreshSessionStore, IUnitOfWork, IUserScopedCommand<out TRequest>, RefreshSessionRevocation, Result |
| 8 | `ChangePreferencesHandlerBase<TUser, TCommand>` | MMCA.Common.Application | 8 | AuditableAggregateRootEntity<TIdentifierType>, ChangePreferencesRequest, Error, ICommandHandler<in TCommand, TResult>, IUnitOfWork, IUserPreferences, IUserScopedCommand<out TRequest>, Result |
| 8 | `ConfirmEmailHandlerBase<TUser, TCommand>` | MMCA.Common.Application | 9 | AuditableAggregateRootEntity<TIdentifierType>, ConfirmEmailRequest, EmailConfirmationErrors, ICommandHandler<in TCommand, TResult>, ICommandWithRequest<out TRequest>, IEmailConfirmableUser, IEmailConfirmationTokenService, IUnitOfWork, Result |
| 8 | `CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>` | MMCA.Common.Application | 9 | AuditableAggregateRootEntity<TIdentifierType>, IBaseDTO<TIdentifierType>, ICommandHandler<in TCommand, TResult>, ICreateRequest, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result |
| 8 | `CrossSourceSpecification` | MMCA.Common.Application | 6 | AuditableBaseEntity<TIdentifierType>, IBaseEntity<TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IUnitOfWork, ParameterReplacer, Specification<TEntity, TIdentifierType> |
| 8 | `DeleteEntityHandler<TEntity, TIdentifierType>` | MMCA.Common.Application | 7 | AuditableAggregateRootEntity<TIdentifierType>, DeleteEntityCommand<TEntity, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result |
| 8 | `DeleteUserHandlerBase<TUser, TCommand>` | MMCA.Common.Application | 10 | AuditableAggregateRootEntity<TIdentifierType>, Error, ICacheService, ICommandHandler<in TCommand, TResult>, IErasableUser, IUnitOfWork, IUserOwnedRequest, Result, SoftDeletedUserCache, UserOwnershipRule |
| 8 | `EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | MMCA.Common.Application | 22 | AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, EntityQueryParameters<TEntity>, Error, IBaseDTO<TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, IUnitOfWork, NavigationMetadata, NavigationMetadataProvider, PagedCollectionResult<T>, PaginationMetadata, QueryFieldContract, QueryFieldService …(+2) |
| 8 | `ExportUserDataHandlerBase<TUser, TQuery>` | MMCA.Common.Application | 12 | AuditableAggregateRootEntity<TIdentifierType>, Error, IQueryHandler<in TQuery, TResult>, IUnitOfWork, IUserDataExportSection, IUserOwnedRequest, Result, Subject, UserDataExportDTO, UserDataExportSectionDefaults, UserDataExportSectionDTO, UserOwnershipRule |
| 8 | `ForgotPasswordHandlerBase<TUser, TCommand>` | MMCA.Common.Application | 10 | AuditableAggregateRootEntity<TIdentifierType>, Email, ForgotPasswordRequest, ICommandHandler<in TCommand, TResult>, ICommandWithRequest<out TRequest>, IEmailSender, IPasswordResetTokenService, IUnitOfWork, PasswordResetSettings, Result |
| 8 | `GetMyNotificationsHandler` | MMCA.Common.Application | 11 | GetMyNotificationsQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PagedCollectionResult<T>, PaginationMetadata, PagingMath, PushNotification, Result, UserNotification, UserNotificationDTO |
| 8 | `GetUnreadNotificationCountHandler` | MMCA.Common.Application | 7 | GetUnreadNotificationCountQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PushNotification, Result, UserNotification |
| 8 | `GetUserPreferencesHandlerBase<TUser>` | MMCA.Common.Application | 8 | AuditableBaseEntity<TIdentifierType>, Error, GetUserPreferencesQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, IUserPreferences, Result, UserPreferencesResponse |
| 8 | `ICurrentUserService` | MMCA.Common.Application | 1 | User |
| 8 | `INavigationDescriptor<in TEntity>` | MMCA.Common.Application | 1 | IUnitOfWork |
| 8 | `MarkAllNotificationsReadHandler` | MMCA.Common.Application | 6 | ICommandHandler<in TCommand, TResult>, IUnitOfWork, MarkAllNotificationsReadCommand, PushNotification, Result, UserNotification |
| 8 | `MarkNotificationReadHandler` | MMCA.Common.Application | 7 | Error, ICommandHandler<in TCommand, TResult>, IQueryableExecutor, IUnitOfWork, MarkNotificationReadCommand, Result, UserNotification |
| 8 | `MutateEntityHandlerCore<TCommand, TEntity, TIdentifierType>` | MMCA.Common.Application | 6 | AuditableAggregateRootEntity<TIdentifierType>, Error, IRepository<TEntity, TIdentifierType>, IUnitOfWork, MutationContext, Result |
| 8 | `PushNotificationDTOMapper` | MMCA.Common.Application | 4 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, PushNotification, PushNotificationDTO, PushNotificationStatus |
| 8 | `PushNotificationDTOProjection` | MMCA.Common.Application | 2 | PushNotification, PushNotificationDTO |
| 8 | `ResetPasswordHandlerBase<TUser, TCommand>` | MMCA.Common.Application | 13 | AuditableAggregateRootEntity<TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, ICommandWithRequest<out TRequest>, ILoginProtectionService, IPasswordChangeableUser, IPasswordHasher, IPasswordResetTokenService, IRefreshSessionStore, IUnitOfWork, RefreshSessionRevocation, ResetPasswordRequest, Result |
| 8 | `SendEmailConfirmationHandlerBase<TUser, TCommand>` | MMCA.Common.Application | 11 | AuditableAggregateRootEntity<TIdentifierType>, Email, EmailConfirmationSettings, ICommandHandler<in TCommand, TResult>, ICommandWithRequest<out TRequest>, IEmailConfirmableUser, IEmailConfirmationTokenService, IEmailSender, IUnitOfWork, Result, SendEmailConfirmationRequest |
| 8 | `SendPushNotificationRequestValidator` | MMCA.Common.Application | 3 | PushNotification, PushNotificationInvariants, SendPushNotificationRequest |
| 8 | `SoftDeletedUserValidator<TUser>` | MMCA.Common.Application | 3 | AuditableAggregateRootEntity<TIdentifierType>, ISoftDeletedUserValidator, IUnitOfWork |
| 8 | `TransactionalCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 3 | ICommandHandler<in TCommand, TResult>, ITransactional, IUnitOfWork |
| 8 | `HandlerMocks` | MMCA.Common.Application.Tests | 9 | INativePushSender, INotificationRecipientProvider, IPushNotificationSender, IQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, PushNotification, UserNotification |
| 8 | `HandlerMocks` | MMCA.Common.Application.Tests | 12 | ICacheService, IEmailConfirmationTokenService, IEmailSender, ILoginProtectionService, IPasswordHasher, IPasswordResetTokenService, IReadRepository<TEntity, TIdentifierType>, IRefreshSessionStore, IRepository<TEntity, TIdentifierType>, IUnitOfWork, TestHidingDeleteUser, TestIdentityUser |
| 8 | `QueryFieldContractSecurityTests` | MMCA.Common.Application.Tests | 6 | Email, QueryFieldContract, QueryFieldService, QueryFilterService, Speaker, SpeakerDto |
| 8 | `ServiceMocks` | MMCA.Common.Application.Tests | 7 | ILoginProtectionService, InMemoryRefreshSessionStore, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, TestAuthUser |
| 8 | `BadgeGranter` | MMCA.Common.Architecture.Tests | 2 | IBadgeGranter, IUnitOfWork |
| 8 | `DirectSavingHandler` | MMCA.Common.Architecture.Tests | 3 | FixtureDomainEvent, IDomainEventHandler<in TDomainEvent>, IUnitOfWork |
| 8 | `PointsWriter` | MMCA.Common.Architecture.Tests | 1 | IUnitOfWork |
| 8 | `ReadRepositoryQueryHandlerFixture` | MMCA.Common.Architecture.Tests | 5 | IQueryHandler<in TQuery, TResult>, IUnitOfWork, ReadRepositoryFixtureAggregate, ReadRepositoryFixtureQuery, Result |
| 8 | `WriteRepositoryCommandHandlerFixture` | MMCA.Common.Architecture.Tests | 5 | ICommandHandler<in TCommand, TResult>, IUnitOfWork, ReadRepositoryFixtureAggregate, ReadRepositoryFixtureCommand, Result |
| 8 | `WriteRepositoryQueryHandlerFixture` | MMCA.Common.Architecture.Tests | 5 | IQueryHandler<in TQuery, TResult>, IUnitOfWork, ReadRepositoryFixtureAggregate, ReadRepositoryFixtureQuery, Result |
| 8 | `PushNotificationTests` | MMCA.Common.Domain.Tests | 3 | PushNotification, PushNotificationCreated, PushNotificationStatus |
| 8 | `ClaimBasedUserIdProvider` | MMCA.Common.Infrastructure | 1 | User |
| 8 | `UpcastingIntegrationEventConsumer<TEvent>` | MMCA.Common.Infrastructure | 7 | ConsumerOriginRestore, EventNameResolver, IEventUpcasterRegistry, IInboxStore, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent>, IntegrationEventConsumer<TEvent> |
| 8 | `EFRepositoryDecoratorAdditionalTests` | MMCA.Common.Infrastructure.Tests | 3 | EFRepositoryDecorator<TEntity, TIdentifierType>, FakeAggregateEntity, IRepository<TEntity, TIdentifierType> |
| 8 | `EFRepositoryDecoratorTests` | MMCA.Common.Infrastructure.Tests | 3 | EFRepositoryDecorator<TEntity, TIdentifierType>, FakeAggregateEntity, IRepository<TEntity, TIdentifierType> |
| 8 | `EntityTypeConfigurationBaseTests` | MMCA.Common.Infrastructure.Tests | 6 | TestAggregateEntity, TestAggregateEntityConfiguration, TestConfigDbContext, TestNonAggregateConfigDbContext, TestNonAggregateEntity, TestNonAggregateEntityConfiguration |
| 8 | `IntegrationEventConsumerContextTests` | MMCA.Common.Infrastructure.Tests | 11 | CorrelationContext, ICorrelationContext, IInboxStore, IIntegrationEventHandler<in TIntegrationEvent>, IntegrationEventConsumer<TEvent>, ITenantContext, MessageHeaders, ScopedUserOverride, TenantContext, TestIntegrationEvent, TestIntegrationEvent |
| 8 | `IntegrationEventConsumerTests` | MMCA.Common.Infrastructure.Tests | 6 | IInboxStore, IIntegrationEventHandler<in TIntegrationEvent>, IntegrationEventConsumer<TEvent>, NamedIntegrationEvent, TestIntegrationEvent, TestIntegrationEvent |
| 8 | `NotificationTestDbContext` | MMCA.Common.Infrastructure.Tests | 2 | PushNotification, UserNotification |
| 8 | `ProjectionTestDbContext` | MMCA.Common.Infrastructure.Tests | 1 | PushNotification |
| 8 | `SeederMocks` | MMCA.Common.Infrastructure.Tests | 4 | IPasswordHasher, IRepository<TEntity, TIdentifierType>, IUnitOfWork, TestSeedUser |
| 8 | `TestConnectionContext` | MMCA.Common.Infrastructure.Tests | 2 | TestDuplexPipe, User |
| 8 | `DependencyInjection` | MMCA.Common.UI | 10 | INotificationInboxUIService, INotificationScopeProvider, IPushNotificationUIService, IUIModule, NotificationHubService, NotificationInboxService, NotificationState, NotificationUIModule, NullNotificationScopeProvider, PushNotificationService |
| 8 | `NotificationPageGate` | MMCA.Common.UI | 6 | IUIModule, LayoutSettings, NotificationInbox, NotificationList, NotificationSend, NotificationUIModule |
| 8 | `GalleryAuthenticationStateProvider` | MMCA.Common.UI.Gallery | 1 | User |
| 8 | `NotificationBellTests` | MMCA.Common.UI.Tests | 11 | BunitTestBase, Error, FakeTimeProvider, INotificationInboxUIService, IToastService, NotificationBell, NotificationBellHost, NotificationBellOptions, NotificationState, Result, TimerCountingTimeProvider |
| 8 | `NotificationNavResourceTests` | MMCA.Common.UI.Tests | 1 | NotificationUIModule |
| 9 | `DecoratorPipelineOrderTests` | MMCA.ADC.Architecture.Tests | 11 | ChangePreferencesCommand, ClassReference, DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>, GetUserPreferencesQuery, ICacheService, ICorrelationContext, ICurrentUserService, IPermissionRegistry, IUnitOfWork, Result, UserPreferencesResponse |
| 9 | `ConferenceCategoriesController` | MMCA.ADC.Conference.API | 17 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, Category, CollectionResult<T>, ConferenceCategoryCreateRequest, ConferenceCategoryDTO, ConferenceCategoryUpdateRequest, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, Result, Route, SupportsIfMatchAttribute, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 9 | `CurrentUserServiceExtensions` | MMCA.ADC.Conference.API | 2 | ConferenceReadAudience, ICurrentUserService |
| 9 | `EventLifecycleController` | MMCA.ADC.Conference.API | 10 | ApiControllerBase, ConferencePermissions, ICommandHandler<in TCommand, TResult>, PublishEventCommand, RefreshFromSessionizeCommand, RefreshFromSessionizeResultDTO, Result, Route, SupportsIfMatchAttribute, UnpublishEventCommand |
| 9 | `EventsController` | MMCA.ADC.Conference.API | 25 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, Event, EventCreateRequest, EventDTO, EventUpdateRequest, ExportEventCalendarQuery, GetNowNextQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, NowNextDTO, PagedCollectionResult<T>, PublishedEventSpecification, QueryFilterModelBinder, Result …(+5) |
| 9 | `EventSpeakersController` | MMCA.ADC.Conference.API | 19 | AddEventSpeakerCommand, AddEventSpeakerRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, EventSpeaker, EventSpeakerDTO, GetPublicEventSpeakerFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveEventSpeakerCommand, Result, Route, Specification<TEntity, TIdentifierType> |
| 9 | `QuestionsController` | MMCA.ADC.Conference.API | 17 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, QueryFilterModelBinder, Question, QuestionCreateRequest, QuestionDTO, QuestionUpdateRequest, Result, Route, SupportsIfMatchAttribute, UpdateQuestionCommand |
| 9 | `RoomsController` | MMCA.ADC.Conference.API | 21 | AddRoomCommand, AddRoomRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, GetPublicRoomFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveRoomCommand, Result, Room, RoomDTO, Route, Specification<TEntity, TIdentifierType>, UpdateRoomCommand …(+1) |
| 9 | `SessionAssetsController` | MMCA.ADC.Conference.API | 19 | AddSessionAssetLinkCommand, ApiControllerBase, ConferencePermissions, DeleteSessionAssetCommand, Error, GetSessionAssetsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IPermissionRegistry, IQueryHandler<in TQuery, TResult>, Result, Route, SessionAssetDTO, SessionAssetLimits, SessionAssetLinkRequest, SessionAssetUpdateRequest, SupportsIfMatchAttribute, UpdateSessionAssetCommand, UploadSessionAssetCommand |
| 9 | `SpeakerCategoryItemsController` | MMCA.ADC.Conference.API | 19 | AddSpeakerCategoryItemCommand, AddSpeakerCategoryItemRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, GetPublicSpeakerCategoryItemFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveSpeakerCategoryItemCommand, Result, Route, SpeakerCategoryItem, SpeakerCategoryItemDTO, Specification<TEntity, TIdentifierType> |
| 9 | `SpeakerLinksController` | MMCA.ADC.Conference.API | 8 | ApiControllerBase, ConferencePermissions, ICommandHandler<in TCommand, TResult>, LinkUserRequest, LinkUserToSpeakerCommand, Result, Route, UnlinkUserFromSpeakerCommand |
| 9 | `SpeakerSessionsController` | MMCA.ADC.Conference.API | 10 | ApiControllerBase, GetSessionBookmarkCountQuery, GetSessionBookmarkCountsQuery, GetSessionFeedbackQuery, ICurrentUserService, IQueryHandler<in TQuery, TResult>, Result, RoleNames, Route, SessionFeedbackDTO |
| 9 | `CategoryItemsControllerTests` | MMCA.ADC.Conference.API.Tests | 14 | AddCategoryItemCommand, AddCategoryItemRequest, CategoryItem, CategoryItemDTO, CategoryItemsController, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, RemoveCategoryItemCommand, Result, UpdateCategoryItemCommand, UpdateCategoryItemRequest |
| 9 | `SessionSelectionControllerTests` | MMCA.ADC.Conference.API.Tests | 25 | CategoryDistributionDTO, CategoryGroupDistribution, CategoryItemDistribution, ContentSimilarityDTO, Error, Event, FixedTimeProvider, GetCategoryDistributionQuery, GetContentSimilarityQuery, GetSessionSelectionDashboardQuery, GetSpeakerSessionOverlapQuery, IInternalCommand, IInternalCommandScheduler, IQueryHandler<in TQuery, TResult>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, MultiSessionSpeaker, Result, ScoreEventSessionsInternalCommand, Sessions …(+5) |
| 9 | `ActivityCreateRequest` | MMCA.ADC.Conference.Application | 4 | Activity, IActivityFieldsRequest, ICacheInvalidating, ICreateRequest |
| 9 | `ActivityDTOMapper` | MMCA.ADC.Conference.Application | 3 | Activity, ActivityDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 9 | `ActivityUpdateApplier` | MMCA.ADC.Conference.Application | 4 | Activity, ActivityUpdateRequest, IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, Result |
| 9 | `ActivityUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | ActivityFieldRules<T>, ActivityUpdateRequest |
| 9 | `AddCategoryItemHandler` | MMCA.ADC.Conference.Application | 8 | AddCategoryItemCommand, AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>, Category, CategoryItem, CategoryItemDTO, CategoryItemDTOMapper, IUnitOfWork, Result |
| 9 | `AddEventQuestionAnswerCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddEventQuestionAnswerCommand |
| 9 | `AddEventQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 13 | AddEventQuestionAnswerCommand, Error, Event, EventFeedbackSubmitted, EventQuestionAnswer, EventQuestionAnswerDTO, EventQuestionAnswerDTOMapper, EventQuestionAnswerRules, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, Question, Result |
| 9 | `AddEventSpeakerCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddEventSpeakerCommand |
| 9 | `AddEventSpeakerHandler` | MMCA.ADC.Conference.Application | 8 | AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>, AddEventSpeakerCommand, Event, EventSpeaker, EventSpeakerDTO, EventSpeakerDTOMapper, IUnitOfWork, Result |
| 9 | `AddRoomCommandValidator` | MMCA.ADC.Conference.Application | 7 | AddRoomCommand, RoomAccessibilityInfoRules<T>, RoomCapacityRules<T>, RoomFloorRules<T>, RoomLocationRules<T>, RoomNameRules<T>, RoomSortRules<T> |
| 9 | `AddSessionAssetLinkHandler` | MMCA.ADC.Conference.Application | 8 | AddSessionAssetLinkCommand, ICommandHandler<in TCommand, TResult>, ISessionAssetAccessService, IUnitOfWork, Result, SessionAsset, SessionAssetDTO, SessionAssetDTOMapper |
| 9 | `AddSessionCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 9 | `AddSessionQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 9 | `AddSessionSpeakerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 9 | `AddSpeakerCategoryItemCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddSpeakerCategoryItemCommand |
| 9 | `AddSpeakerCategoryItemHandler` | MMCA.ADC.Conference.Application | 8 | AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>, AddSpeakerCategoryItemCommand, IUnitOfWork, Result, Speaker, SpeakerCategoryItem, SpeakerCategoryItemDTO, SpeakerCategoryItemDTOMapper |
| 9 | `BatchAddEventQuestionAnswersCommandValidator` | MMCA.ADC.Conference.Application | 1 | BatchAddEventQuestionAnswersCommand |
| 9 | `BatchAddEventQuestionAnswersHandler` | MMCA.ADC.Conference.Application | 13 | BatchAddEventQuestionAnswersCommand, Error, Event, EventFeedbackSubmitted, EventQuestionAnswer, EventQuestionAnswerDTO, EventQuestionAnswerDTOMapper, EventQuestionAnswerRules, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, Question, Result |
| 9 | `BatchAddSessionQuestionAnswersCommand` | MMCA.ADC.Conference.Application | 4 | BatchSessionQuestionAnswerItem, ICacheInvalidating, ITransactional, Session |
| 9 | `CalendarExportMapper` | MMCA.ADC.Conference.Application | 4 | Event, IcsEvent, Session, SessionCalendarExport |
| 9 | `ConferenceCategoryEntityQueryService` | MMCA.ADC.Conference.Application | 8 | Category, ConferenceCategoryDTO, ConferenceCategoryDTOMapper, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork |
| 9 | `CreateConferenceCategoryHandler` | MMCA.ADC.Conference.Application | 7 | Category, ConferenceCategoryCreateRequest, ConferenceCategoryDTO, ConferenceCategoryDTOMapper, CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork |
| 9 | `DeleteConferenceCategoryHandler` | MMCA.ADC.Conference.Application | 3 | Category, DeleteEntityHandler<TEntity, TIdentifierType>, IUnitOfWork |
| 9 | `EventCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | Event, EventCreateRequest, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result |
| 9 | `EventCreateRequestValidator` | MMCA.ADC.Conference.Application | 2 | EventCreateRequest, EventFieldRules<T> |
| 9 | `EventDTOMapper` | MMCA.ADC.Conference.Application | 7 | Email, Event, EventDTO, EventQuestionAnswerDTOMapper, EventSpeakerDTOMapper, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, RoomDTOMapper |
| 9 | `EventUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | EventFieldRules<T>, EventUpdateRequest |
| 9 | `GetCategoryDistributionHandler` | MMCA.ADC.Conference.Application | 12 | Category, CategoryDistributionDTO, CategoryGroupDistribution, CategoryItemDistribution, GetCategoryDistributionQuery, IEntityQuerier<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session, SessionStatuses, StatusBucket |
| 9 | `GetContentSimilarityHandler` | MMCA.ADC.Conference.Application | 11 | Category, ContentSimilarityDTO, GetContentSimilarityQuery, IEntityQuerier<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session, SessionSimilarityCalculator, SessionStatuses, SimilarSessionPair |
| 9 | `GetSessionAssetsHandler` | MMCA.ADC.Conference.Application | 9 | GetSessionAssetsQuery, IEntityQuerier<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, ISessionAssetAccessService, IUnitOfWork, Result, SessionAsset, SessionAssetDTO, SessionAssetDTOMapper |
| 9 | `GetSessionBookmarkCountHandler` | MMCA.ADC.Conference.Application | 8 | Error, GetSessionBookmarkCountQuery, IBookmarkCountService, IEntityReader<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session |
| 9 | `GetSessionBookmarkCountsHandler` | MMCA.ADC.Conference.Application | 6 | GetSessionBookmarkCountsQuery, IBookmarkCountService, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session |
| 9 | `GetSessionFeedbackHandler` | MMCA.ADC.Conference.Application | 12 | Error, GetSessionFeedbackQuery, IEntityQuerier<TEntity, TIdentifierType>, IEntityReader<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Question, RatingQuestionSummary, Result, Session, SessionFeedbackDTO, TextQuestionResponses |
| 9 | `GetSessionsBySpeakerFilterHandler` | MMCA.ADC.Conference.Application | 8 | GetSessionsBySpeakerFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session, SessionSpeaker, Specification<TEntity, TIdentifierType> |
| 9 | `GetSessionSelectionDashboardHandler` | MMCA.ADC.Conference.Application | 26 | Category, CategoryDistributionDTO, CategoryGroupDistribution, CategoryItemDistribution, Error, Event, GetSessionSelectionDashboardQuery, IEntityQuerier<TEntity, TIdentifierType>, IEntityReader<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LocalityLookupEntry, MultiSessionSpeaker, Result, Session, SessionAiScore, SessionAiScoreDTO, Sessions, SessionSelectionDashboardDTO, SessionStatuses …(+6) |
| 9 | `GetSpeakersByEventFilterHandler` | MMCA.ADC.Conference.Application | 10 | EventSpeaker, GetSpeakersByEventFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session, SessionSpeaker, Speaker, Specification<TEntity, TIdentifierType> |
| 9 | `GetSpeakerSessionOverlapHandler` | MMCA.ADC.Conference.Application | 16 | Category, GetSpeakerSessionOverlapQuery, IEntityQuerier<TEntity, TIdentifierType>, IEntityReader<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LocalityLookupEntry, MultiSessionSpeaker, Result, Session, Sessions, SessionStatuses, Speaker, SpeakerLocalityHelper, SpeakerSessionOverlapDTO, SpeakerSessionSummary |
| 9 | `ISessionizeSyncStrategy` | MMCA.ADC.Conference.Application | 2 | SessionizeSyncContext, SessionizeSyncResult |
| 9 | `PartnerCreateRequest` | MMCA.ADC.Conference.Application | 5 | ICacheInvalidating, ICreateRequest, IPartnerFieldsRequest, Partner, PartnerType |
| 9 | `PartnerDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, Partner, PartnerDTO |
| 9 | `PartnerUpdateApplier` | MMCA.ADC.Conference.Application | 4 | IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, Partner, PartnerUpdateRequest, Result |
| 9 | `PartnerUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | PartnerFieldRules<T>, PartnerUpdateRequest |
| 9 | `PublicSessionStatusSpecification` | MMCA.ADC.Conference.Application | 3 | Session, SessionStatuses, Specification<TEntity, TIdentifierType> |
| 9 | `QuestionCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Question, QuestionCreateRequest, Result |
| 9 | `QuestionCreateRequestValidator` | MMCA.ADC.Conference.Application | 2 | QuestionCreateRequest, QuestionTextRules<T> |
| 9 | `RemoveSessionCategoryItemCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 9 | `RemoveSessionQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 9 | `RemoveSessionSpeakerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 9 | `RoomEntityQueryService` | MMCA.ADC.Conference.Application | 8 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork, Room, RoomDTO, RoomDTOMapper |
| 9 | `SessionAssetLinkRequestValidator` | MMCA.ADC.Conference.Application | 4 | SessionAssetFieldRules<T>, SessionAssetLinkRequest, SessionAssetSessionIdRules<T>, SessionAssetUrlRules<T> |
| 9 | `SessionAssetUpdateRequestValidator` | MMCA.ADC.Conference.Application | 3 | SessionAssetFieldRules<T>, SessionAssetInvariants, SessionAssetUpdateRequest |
| 9 | `SessionBookmarkValidationService` | MMCA.ADC.Conference.Application | 6 | Error, ISessionBookmarkValidationService, IUnitOfWork, Result, Session, SessionInvariants |
| 9 | `SessionCategoryItemDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SessionCategoryItem, SessionCategoryItemDTO |
| 9 | `SessionCreateRequest` | MMCA.ADC.Conference.Application | 4 | ICacheInvalidating, ICreateRequest, ISessionFieldsRequest, Session |
| 9 | `SessionQuestionAnswerDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SessionQuestionAnswer, SessionQuestionAnswerDTO |
| 9 | `SessionQuestionAnswerRules` | MMCA.ADC.Conference.Application | 9 | Error, Event, EventInvariants, Question, QuestionInvariants, Result, Session, SessionInvariants, SessionQuestionAnswer |
| 9 | `SessionRoomScheduling` | MMCA.ADC.Conference.Application | 5 | Error, Event, IEntityReader<TEntity, TIdentifierType>, Result, Session |
| 9 | `SessionScoringRunner` | MMCA.ADC.Conference.Application | 12 | Error, IAiScoringService, IEntityQuerier<TEntity, TIdentifierType>, ISessionScoringRunner, IUnitOfWork, Result, ScoreEventSessionsResultDTO, Session, SessionAiScore, SessionScoringInput, Speaker, SpeakerInfo |
| 9 | `SessionSpeakerDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, SessionSpeaker, SessionSpeakerDTO |
| 9 | `SessionUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | SessionFieldRules<T>, SessionUpdateRequest |
| 9 | `SpeakerCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result, Speaker, SpeakerCreateRequest |
| 9 | `SpeakerCreateRequestValidator` | MMCA.ADC.Conference.Application | 2 | SpeakerCreateRequest, SpeakerFieldRules<T> |
| 9 | `SpeakerDTOMapper` | MMCA.ADC.Conference.Application | 8 | Email, ICurrentUserService, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, RoleNames, Speaker, SpeakerCategoryItemDTOMapper, SpeakerDTO, SpeakerQuestionAnswerDTOMapper |
| 9 | `SpeakerUpdateApplier` | MMCA.ADC.Conference.Application | 6 | IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>, MutationContext, Result, Speaker, SpeakerUpdateRequest, UpdateSpeakerCommand |
| 9 | `SpeakerUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | SpeakerFieldRules<T>, SpeakerUpdateRequest |
| 9 | `SponsorCreateRequest` | MMCA.ADC.Conference.Application | 5 | ICacheInvalidating, ICreateRequest, ISponsorFieldsRequest, Sponsor, SponsorTier |
| 9 | `SponsorDTOMapper` | MMCA.ADC.Conference.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, Sponsor, SponsorDTO |
| 9 | `SponsorUpdateApplier` | MMCA.ADC.Conference.Application | 4 | IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, Result, Sponsor, SponsorUpdateRequest |
| 9 | `SponsorUpdateRequestValidator` | MMCA.ADC.Conference.Application | 2 | SponsorFieldRules<T>, SponsorUpdateRequest |
| 9 | `UpdateEventQuestionAnswerCommandValidator` | MMCA.ADC.Conference.Application | 2 | QuestionInvariants, UpdateEventQuestionAnswerCommand |
| 9 | `UpdateRoomCommandValidator` | MMCA.ADC.Conference.Application | 7 | RoomAccessibilityInfoRules<T>, RoomCapacityRules<T>, RoomFloorRules<T>, RoomLocationRules<T>, RoomNameRules<T>, RoomSortRules<T>, UpdateRoomCommand |
| 9 | `UpdateSessionCommand` | MMCA.ADC.Conference.Application | 4 | ICacheInvalidating, ICommandWithRequest<out TRequest>, Session, SessionUpdateRequest |
| 9 | `UpdateSessionQuestionAnswerCommand` | MMCA.ADC.Conference.Application | 2 | ICacheInvalidating, Session |
| 9 | `UploadSessionAssetCommandValidator` | MMCA.ADC.Conference.Application | 7 | DocumentContentSniffer, DocumentFormats, SessionAssetFieldRules<T>, SessionAssetFileNameRules<T>, SessionAssetLimits, SessionAssetSessionIdRules<T>, UploadSessionAssetCommand |
| 9 | `UploadSessionAssetHandler` | MMCA.ADC.Conference.Application | 17 | BlobNames, DeleteSessionAssetBlobInternalCommand, DocumentContentSniffer, DocumentFormats, Error, FileUploadOptions, ICommandHandler<in TCommand, TResult>, IFileStorageService, IInternalCommandScheduler, ISessionAssetAccessService, IUnitOfWork, Result, SessionAsset, SessionAssetDTO, SessionAssetDTOMapper, SessionAssetLimits, UploadSessionAssetCommand |
| 9 | `UserDeletedFeedbackHandler` | MMCA.ADC.Conference.Application | 8 | Event, EventQuestionAnswer, IUnitOfWork, QuestionInvariants, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, Session, SessionQuestionAnswer, UserDeleted |
| 9 | `AddCategoryItemCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | AddCategoryItemCommand, AddCategoryItemCommandValidator, CategoryInvariants |
| 9 | `ConferenceCategoryCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | CategoryInvariants, ConferenceCategoryCreateRequest, ConferenceCategoryCreateRequestValidator |
| 9 | `ConferenceCategoryDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Category, CategoryItemDTOMapper, ConferenceCategoryDTOMapper |
| 9 | `ConferenceCategoryUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | ConferenceCategoryUpdateRequest, ConferenceCategoryUpdateRequestValidator |
| 9 | `ConferenceCategoryValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 5 | CategoryInvariants, TestCategoryItemModel, TestCategoryItemValidator, TestCategoryModel, TestCategoryTitleValidator |
| 9 | `EventQuestionAnswerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Event, EventQuestionAnswer, EventQuestionAnswerDTOMapper |
| 9 | `EventSpeakerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Event, EventSpeaker, EventSpeakerDTOMapper |
| 9 | `EventValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | EventInvariants, TestEventModel, TestEventValidator |
| 9 | `Fakes` | MMCA.ADC.Conference.Application.Tests | 4 | InMemoryRepository<TEntity, TIdentifierType>, RecordingEventBus, RecordingUnitOfWork, Speaker |
| 9 | `PublishedEventSpecificationTests` | MMCA.ADC.Conference.Application.Tests | 2 | Event, PublishedEventSpecification |
| 9 | `QuestionDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 2 | Question, QuestionDTOMapper |
| 9 | `QuestionUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | QuestionUpdateRequest, QuestionUpdateRequestValidator |
| 9 | `QuestionValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | QuestionInvariants, TestQuestionModel, TestQuestionTextValidator |
| 9 | `RoomDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Event, Room, RoomDTOMapper |
| 9 | `RoomValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | EventInvariants, TestRoomModel, TestRoomValidator |
| 9 | `SessionAssetDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionAssetDTOMapper, SessionAssetFixtures, SessionAssetKind |
| 9 | `SessionValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionInvariants, TestSessionModel, TestSessionValidator |
| 9 | `SpeakerCategoryItemDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 4 | Speaker, SpeakerBuilder, SpeakerCategoryItem, SpeakerCategoryItemDTOMapper |
| 9 | `SpeakerLocalityHelperTests` | MMCA.ADC.Conference.Application.Tests | 5 | Category, LocalityLookupEntry, Speaker, SpeakerBuilder, SpeakerLocalityHelper |
| 9 | `SpeakerQuestionAnswerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 4 | Speaker, SpeakerBuilder, SpeakerQuestionAnswer, SpeakerQuestionAnswerDTOMapper |
| 9 | `SpeakerValidationRulesTests` | MMCA.ADC.Conference.Application.Tests | 3 | SpeakerInvariants, TestSpeakerModel, TestSpeakerValidator |
| 9 | `UpdateCategoryItemCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | CategoryInvariants, UpdateCategoryItemCommand, UpdateCategoryItemCommandValidator |
| 9 | `EventCascadeDeletionDomainService` | MMCA.ADC.Conference.Domain | 7 | Activity, Event, Partner, Result, Session, SessionAsset, Sponsor |
| 9 | `ActivityBuilder` | MMCA.ADC.Conference.Domain.Tests | 2 | Activity, EntityBuilderBase<TBuilder, TEntity> |
| 9 | `PartnerBuilder` | MMCA.ADC.Conference.Domain.Tests | 3 | EntityBuilderBase<TBuilder, TEntity>, Partner, PartnerType |
| 9 | `SessionAssetTests` | MMCA.ADC.Conference.Domain.Tests | 6 | DomainEntityState, SessionAsset, SessionAssetBuilder, SessionAssetChanged, SessionAssetInvariants, SessionAssetKind |
| 9 | `SessionBuilder` | MMCA.ADC.Conference.Domain.Tests | 2 | EntityBuilderBase<TBuilder, TEntity>, Session |
| 9 | `SessionStatusNormalizationTests` | MMCA.ADC.Conference.Domain.Tests | 1 | Session |
| 9 | `SessionTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, Session, SessionCategoryItemChanged, SessionChanged, SessionSpeakerChanged |
| 9 | `SponsorBuilder` | MMCA.ADC.Conference.Domain.Tests | 3 | EntityBuilderBase<TBuilder, TEntity>, Sponsor, SponsorTier |
| 9 | `ConferenceModuleDbSeeder` | MMCA.ADC.Conference.Infrastructure | 15 | Activity, DbSeeder, Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Partner, PartnerType, Question, QuestionInvariants, Session, SessionInvariants, Speaker, Sponsor, SponsorTier, SqlServerUniqueConstraintViolationDetector |
| 9 | `ConferenceTestDbContext` | MMCA.ADC.Conference.Infrastructure.Tests | 14 | Category, CategoryItem, Event, EventQuestionAnswer, EventSpeaker, Question, Room, Session, SessionCategoryItem, SessionQuestionAnswer, SessionSpeaker, Speaker, SpeakerCategoryItem, SpeakerQuestionAnswer |
| 9 | `SessionMappingOnlyDbContext` | MMCA.ADC.Conference.Infrastructure.Tests | 1 | Session |
| 9 | `CurrentEventDefaults` | MMCA.ADC.Conference.Shared | 2 | CurrentEventSelector, EventDTO |
| 9 | `CurrentEventSelectorTests` | MMCA.ADC.Conference.Shared.Tests | 2 | CurrentEventSelector, TestEvent |
| 9 | `ActivityCreate` | MMCA.ADC.Conference.UI | 13 | ActivityCreateModel, ActivityService, ConferenceRoutePaths, CurrentEventSelector, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IActivityUIService, IEventLookupService, IToastService, ModelValidation, Result |
| 9 | `ActivityDetail` | MMCA.ADC.Conference.UI | 13 | Activity, ActivityDTO, ActivityEditModel, ActivityService, ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IActivityUIService, IEventLookupService, IToastService, ModelValidation |
| 9 | `ADCHome` | MMCA.ADC.Conference.UI | 14 | ADCHomeContent, CurrentEventSelector, EventDTO, EventPhase, EventService, IEventUIService, IPartnerUIService, ISponsorUIService, PartnerDTO, PartnerService, PartnerType, SponsorDTO, SponsorService, SponsorTier |
| 9 | `EventFilteredListPageBase<TDto>` | MMCA.ADC.Conference.UI | 5 | CurrentEventSelector, DataGridListPageBase<TDto>, EventInfo, EventLookupService, IEventLookupService |
| 9 | `PartnerCreate` | MMCA.ADC.Conference.UI | 13 | ConferenceRoutePaths, CurrentEventSelector, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IPartnerUIService, IToastService, ModelValidation, PartnerCreateModel, PartnerService, Result |
| 9 | `PartnerDetail` | MMCA.ADC.Conference.UI | 14 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, IPartnerUIService, IToastService, ModelValidation, Partner, PartnerDTO, PartnerEditModel, PartnerService, PartnerType |
| 9 | `PublicActivityList` | MMCA.ADC.Conference.UI | 8 | ActivityDTO, ActivityService, CurrentEventSelector, EventLookupService, IActivityUIService, IEventLookupService, IMapNavigationService, IToastService |
| 9 | `PublicEventList` | MMCA.ADC.Conference.UI | 13 | ConferenceRoutePaths, CurrentEventSelector, DataGridListPageBase<TDto>, EventDTO, EventInfo, EventLookupService, EventService, IEventLookupService, IEventUIService, ListPageActions, MobileInfiniteScrollList<TItem>, PublicReadAudience, Result |
| 9 | `PublicSessionDetail` | MMCA.ADC.Conference.UI | 18 | ConferenceRoutePaths, CurrentEventSelector, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionLiveUIService, ISessionUIService, ISpeakerLookupService, ITextToSpeechService, IToastService, LatestLoadGuard, RoomDTO, RoomService, Session, SessionDTO, SessionLive, SessionService, SessionStatuses |
| 9 | `PublicSponsorList` | MMCA.ADC.Conference.UI | 7 | CurrentEventSelector, EventLookupService, IEventLookupService, ISponsorUIService, SponsorDTO, SponsorService, SponsorTier |
| 9 | `SessionDetail` | MMCA.ADC.Conference.UI | 28 | CategoryItemInfo, CategoryItemLookupService, ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, ErrorType, EventLookupService, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionCategoryItemUIService, ISessionSpeakerUIService, ISessionUIService, ISpeakerLookupService, IToastService, ModelValidation, Result, RoomService, Session, SessionCategoryItemService …(+8) |
| 9 | `SessionSelectionDashboard` | MMCA.ADC.Conference.UI | 13 | ConferenceRoutePaths, CurrentEventSelector, EventInfo, EventLookupService, IEventLookupService, ISessionSelectionUIService, IToastService, ScorePollHost, ScorePollSession, SessionSelectionDashboardDTO, SessionSelectionDisplay, SessionSelectionFilters, ToastSeverity |
| 9 | `SpeakerDashboard` | MMCA.ADC.Conference.UI | 12 | CurrentEventSelector, ErrorType, EventInfo, EventLookupService, IEventLookupService, ISpeakerDashboardUIService, ISpeakerUIService, IToastService, SessionDTO, SessionFeedbackDTO, SpeakerDTO, SpeakerService |
| 9 | `SponsorCreate` | MMCA.ADC.Conference.UI | 13 | ConferenceRoutePaths, CurrentEventSelector, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, ISponsorUIService, IToastService, ModelValidation, Result, SponsorCreateModel, SponsorService |
| 9 | `SponsorDetail` | MMCA.ADC.Conference.UI | 14 | ConferenceRoutePaths, DataAnnotationsModelValidator, ErrorMessages, EventInfo, EventLookupService, IEventLookupService, ISponsorUIService, IToastService, ModelValidation, Sponsor, SponsorDTO, SponsorEditModel, SponsorService, SponsorTier |
| 9 | `ComponentsSnapshotTests` | MMCA.ADC.Conference.UI.Tests | 10 | ApiSettings, BunitTestBase, EventDTO, MarkupSnapshot, PublicSessionListFilterBar, PublicSessionListView, Result, RoomDTO, Session, SessionDTO |
| 9 | `EventDetailActionErrorTests` | MMCA.ADC.Conference.UI.Tests | 8 | BunitTestBase, Error, EventDetail, EventDTO, IEventUIService, IToastService, Result, SessionizeRefreshOutcome |
| 9 | `EventDetailStaleLoadTests` | MMCA.ADC.Conference.UI.Tests | 6 | BunitTestBase, Event, EventDetail, EventDTO, IEventUIService, Result |
| 9 | `EventDetailTests` | MMCA.ADC.Conference.UI.Tests | 8 | BunitTestBase, Error, EventDetail, EventDTO, IEventUIService, QuestionModerationDefault, Result, SessionizeRefreshOutcome |
| 9 | `ManagementRouteAuthorizationTests` | MMCA.ADC.Conference.UI.Tests | 2 | PublicEventDetail, RouteAuthorizationTestsBase |
| 9 | `PublicEventDetailTests` | MMCA.ADC.Conference.UI.Tests | 12 | BunitTestBase, Error, Event, EventDTO, GeoPoint, IClipboardService, IEventUIService, IGeocodingService, IGeolocationService, IMapNavigationService, PublicEventDetail, Result |
| 9 | `PublicSessionListViewBookmarkTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, Error, ISessionBookmarkUIService, IToastService, ProblemDetailsResultReader, PublicSessionListView, Result, Session, SessionDTO, UserSessionBookmarkDTO |
| 9 | `QuestionDetailStaleLoadTests` | MMCA.ADC.Conference.UI.Tests | 6 | BunitTestBase, IQuestionUIService, Question, QuestionDetail, QuestionDTO, Result |
| 9 | `QuestionDetailTests` | MMCA.ADC.Conference.UI.Tests | 9 | BunitTestBase, Error, IQuestionUIService, Question, QuestionDetail, QuestionDTO, QuestionListDoubles, Result, SpanishCultureScope |
| 9 | `QuestionListLocalizationTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, IQuestionUIService, QuestionList, QuestionListDoubles, SpanishCultureScope |
| 9 | `QuestionListMobileLocalizationTests` | MMCA.ADC.Conference.UI.Tests | 5 | BunitTestBase, IQuestionUIService, QuestionList, QuestionListDoubles, SpanishCultureScope |
| 9 | `RoomDetailStaleLoadTests` | MMCA.ADC.Conference.UI.Tests | 8 | BunitTestBase, EventInfo, IEventLookupService, IRoomUIService, Result, Room, RoomDetail, RoomDTO |
| 9 | `RoomDetailTests` | MMCA.ADC.Conference.UI.Tests | 7 | BunitTestBase, EventInfo, IEventLookupService, IRoomUIService, Result, RoomDetail, RoomDTO |
| 9 | `SpeakerDashboardServiceTests` | MMCA.ADC.Conference.UI.Tests | 11 | CapturingHttpMessageHandler, ErrorType, HttpTestDoubles, PagedCollectionResult<T>, PaginationMetadata, RatingQuestionSummary, Session, SessionDTO, SessionFeedbackDTO, SessionSpeakerDTO, SpeakerDashboardService |
| 9 | `LivePollsController` | MMCA.ADC.Engagement.API | 19 | ApiControllerBase, CloseLivePollCommand, CreateLivePollCommand, CreateLivePollRequest, DeleteEntityCommand<TEntity, TIdentifierType>, EngagementFeatures, EngagementPermissions, GetEventPollsQuery, GetSessionManagePollsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, LivePoll, LivePollDTO, OpenLivePollCommand, Result, RoleNames, Route, SupportsIfMatchAttribute |
| 9 | `LivePollVotingController` | MMCA.ADC.Engagement.API | 14 | ApiControllerBase, CastVoteCommand, CastVoteRequest, EngagementFeatures, Error, GetOpenPollsQuery, GetPollResultsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, LivePollResultsDTO, Result, RoleNames, Route |
| 9 | `SessionQuestionsController` | MMCA.ADC.Engagement.API | 18 | ApiControllerBase, EngagementFeatures, Error, GetModerationQueueQuery, GetSessionQuestionsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, ModerateQuestionCommand, ModerationAction, Result, RoleNames, Route, SessionQuestionDTO, SubmitQuestionCommand, SubmitQuestionRequest, SupportsIfMatchAttribute, ToggleUpvoteCommand |
| 9 | `ControllerMocks` | MMCA.ADC.Engagement.API.Tests | 47 | AttendanceStatsDTO, CastVoteCommand, CheckInAttendeeRequest, CheckInResultDTO, CloseLivePollCommand, CreateBookmarkRequest, CreateLivePollCommand, DeleteEntityCommand<TEntity, TIdentifierType>, GetAttendanceStatsQuery, GetBookmarkedSessionIdsQuery, GetEventPollsQuery, GetLeaderboardQuery, GetModerationQueueQuery, GetMyPointsQuery, GetOpenPollsQuery, GetOrCreateMyBadgeCommand, GetPointsOverviewQuery, GetPollResultsQuery, GetSessionManagePollsQuery, GetSessionQuestionsQuery …(+27) |
| 9 | `CreateBookmarkHandler` | MMCA.ADC.Engagement.Application | 11 | BookmarkManagementDomainService, CreateBookmarkRequest, Error, ICommandHandler<in TCommand, TResult>, ISessionBookmarkValidationService, IUniqueConstraintViolationDetector, IUnitOfWork, Result, UserSessionBookmark, UserSessionBookmarkDTO, UserSessionBookmarkDTOMapper |
| 9 | `DeleteLivePollHandler` | MMCA.ADC.Engagement.Application | 3 | DeleteEntityHandler<TEntity, TIdentifierType>, IUnitOfWork, LivePoll |
| 9 | `GetModerationQueueHandler` | MMCA.ADC.Engagement.Application | 10 | GetModerationQueueQuery, IEventLiveValidationService, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePollAuthorization, Result, SessionQuestion, SessionQuestionDTO, SessionQuestionViewBuilder |
| 9 | `GetMyPointsHandler` | MMCA.ADC.Engagement.Application | 10 | GetMyPointsQuery, ICurrentUserService, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LeaderboardOptIn, MyPointsDTO, PagingMath, PointsEntry, PointsEntryDTO, Result |
| 9 | `GetOrCreateMyBadgeHandler` | MMCA.ADC.Engagement.Application | 10 | AttendeeBadge, Error, GetOrCreateMyBadgeCommand, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQuerier<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, IUnitOfWork, MyBadgeDTO, Result |
| 9 | `GetSessionQuestionsHandler` | MMCA.ADC.Engagement.Application | 11 | GetSessionQuestionsQuery, IEventLiveValidationService, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, QuestionStatus, Result, SessionQuestion, SessionQuestionDTO, SessionQuestionUpvote, SessionQuestionViewBuilder |
| 9 | `GetUserBookmarksHandler` | MMCA.ADC.Engagement.Application | 12 | GetUserBookmarksQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, ISessionBookmarkValidationService, IUnitOfWork, PagedCollectionResult<T>, PaginationMetadata, PagingMath, Result, UserSessionBookmark, UserSessionBookmarkDTO, UserSessionBookmarkDTOMapper |
| 9 | `LivePollDTOMapper` | MMCA.ADC.Engagement.Application | 3 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, LivePoll, LivePollDTO |
| 9 | `LivePollResultsBuilder` | MMCA.ADC.Engagement.Application | 7 | IQueryableExecutor, IUnitOfWork, LivePoll, LivePollOptionResultDTO, LivePollResultsDTO, LivePollVote, Question |
| 9 | `SetLeaderboardParticipationHandler` | MMCA.ADC.Engagement.Application | 11 | Error, ICommandHandler<in TCommand, TResult>, IConcurrencyConflictDetector, ICurrentUserService, IEntityQuerier<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, IUnitOfWork, LeaderboardOptIn, Result, SetLeaderboardParticipationRequest |
| 9 | `SubmitQuestionHandler` | MMCA.ADC.Engagement.Application | 21 | BestEffort, Error, ICommandHandler<in TCommand, TResult>, IDistributedLock, IEventLiveValidationService, ILiveChannelPublishQueue, IUnitOfWork, LiveChannelPublishWorkItem, LivePollChannel, QuestionModerationDefault, QuestionStatus, Result, SessionLiveInfo, SessionQuestion, SessionQuestionApprovedPayload, SessionQuestionChannel, SessionQuestionDTO, SessionQuestionInvariants, SessionQuestionPendingCountChangedPayload, SessionQuestionViewBuilder …(+1) |
| 9 | `CreateLivePollCommandValidatorTests` | MMCA.ADC.Engagement.Application.Tests | 5 | CreateLivePollCommand, CreateLivePollCommandValidator, CreateLivePollRequest, LivePollInvariants, Question |
| 9 | `HandlerMocks` | MMCA.ADC.Engagement.Application.Tests | 6 | IEventLiveValidationService, ILiveChannelPublishQueue, IRepository<TEntity, TIdentifierType>, IUnitOfWork, LivePoll, LivePollVote |
| 9 | `SessionQuestionUpvoteChangedHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 11 | DomainEntityState, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, QuestionStatus, RecordingQueue, SessionQuestion, SessionQuestionChannel, SessionQuestionUpvote, SessionQuestionUpvoteChanged, SessionQuestionUpvoteChangedHandler, SessionQuestionUpvoteChangedPayload |
| 9 | `UserSessionBookmarkDTOMapperTests` | MMCA.ADC.Engagement.Application.Tests | 2 | UserSessionBookmark, UserSessionBookmarkDTOMapper |
| 9 | `BookmarkCountServiceGrpcAdapter` | MMCA.ADC.Engagement.Contracts | 2 | BookmarkCountService, IBookmarkCountService |
| 9 | `BookmarkManagementDomainServiceTests` | MMCA.ADC.Engagement.Domain.Tests | 2 | BookmarkManagementDomainService, UserSessionBookmark |
| 9 | `LivePollTests` | MMCA.ADC.Engagement.Domain.Tests | 6 | DomainEntityState, LivePoll, LivePollChanged, LivePollInvariants, LivePollOption, LivePollStatus |
| 9 | `BookmarkCountsGrpcService` | MMCA.ADC.Engagement.Service | 2 | BookmarkCountService, IBookmarkCountService |
| 9 | `CheckInScopeNames` | MMCA.ADC.Engagement.Shared | 4 | CheckInScope, Event, Session, Sponsor |
| 9 | `LiveEventService` | MMCA.ADC.Engagement.UI | 8 | CurrentEventSelector, EventDTO, HttpResultExecutor, IdempotentReadRetry, ILiveEventUIService, LiveEventContext, PagedCollectionResult<T>, ProblemDetailsResultReader |
| 9 | `ComponentsSnapshotTests` | MMCA.ADC.Engagement.UI.Tests | 21 | AttendeeSearchPanel, AttendeeSummary, BunitComponentTestBase, IAttendeeLookupService, ILivePollUIService, ISessionQuestionUIService, LivePollDTO, LivePollOptionDTO, LivePollOptionResultDTO, LivePollResultsDTO, LivePollStatus, MarkupSnapshot, PollManagementPanel, Question, QuestionStatus, Result, SessionLiveModerationPanel, SessionLivePollPanel, SessionLiveQuestionPanel, SessionQuestionDTO …(+1) |
| 9 | `SessionLiveModerationGateTests` | MMCA.ADC.Engagement.UI.Tests | 24 | ApiSettings, BunitComponentTestBase, EngagementRoutePaths, Error, IHapticFeedbackService, ILiveEventUIService, ILivePollUIService, INowNextService, ISessionLookupService, ISessionQuestionUIService, ISpeechToTextService, ITokenStorageService, LivePollDTO, LivePollResultsDTO, NotificationHubService, NotificationState, NullHapticFeedbackService, NullSpeechToTextService, Result, RoleNames …(+4) |
| 9 | `SessionLiveModerationPanelTests` | MMCA.ADC.Engagement.UI.Tests | 11 | BunitComponentTestBase, CreateLivePollRequest, ILivePollUIService, ISessionQuestionUIService, LivePollDTO, LivePollStatus, Question, QuestionStatus, Result, SessionLiveModerationPanel, SessionQuestionDTO |
| 9 | `SessionReminderPlannerTests` | MMCA.ADC.Engagement.UI.Tests | 3 | Session, SessionInfo, SessionReminderPlanner |
| 9 | `UsersController` | MMCA.ADC.Identity.API | 16 | ApiControllerBase, DeleteUserCommand, Error, GetUserAvatarQuery, GetUsersQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IdentityPermissions, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, RemoveUserAvatarCommand, Result, Route, SetUserAvatarCommand, UserAvatarDTO, UserListDTO |
| 9 | `ChangePasswordHandler` | MMCA.ADC.Identity.Application | 7 | ChangePasswordCommand, ChangePasswordHandlerBase<TUser, TCommand>, ILoginProtectionService, IPasswordHasher, IRefreshSessionStore, IUnitOfWork, User |
| 9 | `ChangePreferencesCommandValidator` | MMCA.ADC.Identity.Application | 3 | ChangePreferencesCommand, CommonInvariants, SupportedCultures |
| 9 | `ChangePreferencesHandler` | MMCA.ADC.Identity.Application | 4 | ChangePreferencesCommand, ChangePreferencesHandlerBase<TUser, TCommand>, IUnitOfWork, User |
| 9 | `ConfirmEmailHandler` | MMCA.ADC.Identity.Application | 5 | ConfirmEmailCommand, ConfirmEmailHandlerBase<TUser, TCommand>, IEmailConfirmationTokenService, IUnitOfWork, User |
| 9 | `DeleteUserHandler` | MMCA.ADC.Identity.Application | 10 | DeleteAvatarBlobInternalCommand, DeleteUserCommand, DeleteUserHandlerBase<TUser, TCommand>, ICacheService, IInternalCommandScheduler, IUnitOfWork, Result, User, UserDeleted, UserRole |
| 9 | `ExportUserDataHandler` | MMCA.ADC.Identity.Application | 8 | Email, ExportUserDataHandlerBase<TUser, TQuery>, ExportUserDataQuery, IUnitOfWork, IUserDataExportSection, User, UserDataExportSubjectDTO, UserRole |
| 9 | `GetUserPreferencesHandler` | MMCA.ADC.Identity.Application | 3 | GetUserPreferencesHandlerBase<TUser>, IUnitOfWork, User |
| 9 | `ResetPasswordHandler` | MMCA.ADC.Identity.Application | 8 | ILoginProtectionService, IPasswordHasher, IPasswordResetTokenService, IRefreshSessionStore, IUnitOfWork, ResetPasswordCommand, ResetPasswordHandlerBase<TUser, TCommand>, User |
| 9 | `AttendeeQueryServiceTests` | MMCA.ADC.Identity.Application.Tests | 5 | AttendeeQueryService, InMemoryRepository<TEntity, TIdentifierType>, RecordingUnitOfWork, User, UserRole |
| 9 | `Fakes` | MMCA.ADC.Identity.Application.Tests | 3 | InMemoryRepository<TEntity, TIdentifierType>, RecordingUnitOfWork, User |
| 9 | `GetUserAvatarHandlerTests` | MMCA.ADC.Identity.Application.Tests | 7 | ErrorType, GetUserAvatarHandler, GetUserAvatarQuery, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, User, UserRole |
| 9 | `LegalAcceptanceServiceTests` | MMCA.ADC.Identity.Application.Tests | 7 | FakeTimeProvider, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, LegalAcceptanceService, User, UserRole |
| 9 | `SoftDeletedUserValidatorTests` | MMCA.ADC.Identity.Application.Tests | 4 | IRepository<TEntity, TIdentifierType>, IUnitOfWork, SoftDeletedUserValidator<TUser>, User |
| 9 | `UserDTOMapperTests` | MMCA.ADC.Identity.Application.Tests | 3 | User, UserDTOMapper, UserRole |
| 9 | `AttendeeQueryServiceGrpcAdapter` | MMCA.ADC.Identity.Contracts | 2 | AttendeeQueryService, IAttendeeQueryService |
| 9 | `AttendeesGrpcService` | MMCA.ADC.Identity.Service | 2 | AttendeeQueryService, IAttendeeQueryService |
| 9 | `DependencyInjection` | MMCA.ADC.Notification.Application | 5 | ApplicationSettings, AttendeeNotificationRecipientProvider, INotificationRecipientProvider, IUserNotificationExportService, UserNotificationExportService |
| 9 | `DependencyInjectionTests` | MMCA.ADC.Notification.Application.Tests | 6 | ApplicationSettings, AttendeeNotificationRecipientProvider, DependencyInjectionAssert, INotificationRecipientProvider, IUserNotificationExportService, UserNotificationExportService |
| 9 | `UserNotificationExportServiceGrpcAdapter` | MMCA.ADC.Notification.Contracts | 4 | GrpcWireFormat, IUserNotificationExportService, UserNotificationExportItemDTO, UserNotificationExportService |
| 9 | `UserNotificationExportGrpcService` | MMCA.ADC.Notification.Service | 3 | GrpcWireFormat, IUserNotificationExportService, UserNotificationExportService |
| 9 | `MainActivity` | MMCA.ADC.UI | 3 | Activity, DeepLinkDispatcher, IDeepLinkDispatcher |
| 9 | `WebAuthenticatorCallbackActivity` | MMCA.ADC.UI | 1 | Activity |
| 9 | `PromptTaggingChatClient` | MMCA.Common.AI | 4 | Activity, AiUsageMeter, PromptContract, Tag |
| 9 | `CorrelationIdMiddleware` | MMCA.Common.API | 2 | Activity, ICorrelationContext |
| 9 | `CrudEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>` | MMCA.Common.API | 12 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, AuditableAggregateRootEntity<TIdentifierType>, DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, IBaseDTO<TIdentifierType>, ICommandHandler<in TCommand, TResult>, ICreateRequest, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, Route, SupportsIfMatchAttribute, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 9 | `DevicesController` | MMCA.Common.API | 8 | ApiControllerBase, DeviceInstallationRequest, Error, ICurrentUserService, IPushDeviceRegistrar, NotificationFeatures, Result, Route |
| 9 | `InboxController` | MMCA.Common.API | 15 | ApiControllerBase, Error, GetMyNotificationsQuery, GetUnreadNotificationCountQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, MarkAllNotificationsReadCommand, MarkNotificationReadCommand, NotificationFeatures, PagedCollectionResult<T>, PushNotification, Result, Route, UserNotificationDTO |
| 9 | `NotificationsController` | MMCA.Common.API | 15 | ApiControllerBase, Error, GetNotificationHistoryQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IdempotencyHeaders, IQueryHandler<in TQuery, TResult>, NotificationFeatures, NotificationPermissions, PagedCollectionResult<T>, PushNotificationDTO, Result, Route, SendPushNotificationCommand, SendPushNotificationRequest |
| 9 | `OwnershipHelper` | MMCA.Common.API | 3 | Error, ICurrentUserService, Result |
| 9 | `SessionRefreshOutcome` | MMCA.Common.API | 3 | Session, SessionRefreshStatus, SessionTokenResult |
| 9 | `SoftDeletedUserMiddleware` | MMCA.Common.API | 4 | ICacheService, ICurrentUserService, ISoftDeletedUserValidator, SoftDeletedUserCache |
| 9 | `CurrentUserTargetingContextAccessorTests` | MMCA.Common.API.Tests | 3 | AuthClaimTypes, CurrentUserTargetingContextAccessor, User |
| 9 | `EntityControllerBaseETagTests` | MMCA.Common.API.Tests | 12 | ConcurrencyETag, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PlainDTO, PlainEntity, PlainEntityController, Result, Specification<TEntity, TIdentifierType>, VersionedDTO, VersionedEntity, VersionedEntityController |
| 9 | `EntityControllerBaseExportColumnTests` | MMCA.Common.API.Tests | 12 | ApplicationSettings, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ExportMoney, ExportShapeTestController, ExportShapeTestDTO, ExportTestEntity, FakeTimeProvider, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, Result, Specification<TEntity, TIdentifierType> |
| 9 | `EntityControllerBaseExportTests` | MMCA.Common.API.Tests | 17 | ApplicationSettings, AsyncOnlyResponseStream, DefaultExportTestController, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, ExportTestController, ExportTestDTO, ExportTestEntity, FakeTimeProvider, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, Result, ScopedExportTestController, Specification<TEntity, TIdentifierType>, SpecificationHonoringQueryService |
| 9 | `EntityControllerBaseReadSpecificationTests` | MMCA.Common.API.Tests | 17 | ApplicationSettings, AsyncScopedReadController, BaseLookup<TIdentifierType>, BothHooksReadController, CollectionResult<T>, ConcurrencyETag, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, FakeTimeProvider, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, ReadScopeDTO, ReadScopeEntity, RecordingQueryService, Specification<TEntity, TIdentifierType>, SyncScopedReadController, UnscopedReadController |
| 9 | `EntityControllerBaseTests` | MMCA.Common.API.Tests | 13 | ApplicationSettings, BaseLookup<TIdentifierType>, CollectionResult<T>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, Result, Specification<TEntity, TIdentifierType>, TestDTO, TestEntity, TestEntityController |
| 9 | `StronglyTypedIdApiTests` | MMCA.Common.API.Tests | 5 | ICacheService, ICurrentUserService, ProbeControllerFeatureProvider, ProbeOrderId, StronglyTypedIdTypeConverters |
| 9 | `TestAggregateRootController` | MMCA.Common.API.Tests | 9 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, TestAggDTO, TestAggregateEntity, TestCreateRequest |
| 9 | `AuthorizationGate` | MMCA.Common.Application | 6 | CqrsMetrics, Error, ICurrentUserService, IPermissionRegistry, IRequiresMfa, IRequiresPermission |
| 9 | `ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>` | MMCA.Common.Application | 4 | AuditableBaseEntity<TIdentifierType>, INavigationDescriptor<in TEntity>, IUnitOfWork, NavigationLoader |
| 9 | `CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>` | MMCA.Common.Application | 7 | AuditableAggregateRootEntity<TIdentifierType>, CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, IBaseDTO<TIdentifierType>, ICreateRequest, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork |
| 9 | `CurrentUserServiceExtensions` | MMCA.Common.Application | 4 | Error, ErrorType, ICurrentUserService, Result |
| 9 | `DeclarativeNavigationPopulator<TEntity>` | MMCA.Common.Application | 4 | INavigationDescriptor<in TEntity>, INavigationPopulator<in TEntity>, IUnitOfWork, NavigationMetadata |
| 9 | `FKNavigationDescriptor<TEntity, TChild, TChildId>` | MMCA.Common.Application | 4 | AuditableBaseEntity<TIdentifierType>, INavigationDescriptor<in TEntity>, IUnitOfWork, NavigationLoader |
| 9 | `GetNotificationHistoryHandler` | MMCA.Common.Application | 11 | GetNotificationHistoryQuery, IQueryableExecutor, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PagedCollectionResult<T>, PaginationMetadata, PagingMath, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, Result |
| 9 | `MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>` | MMCA.Common.Application | 7 | AuditableAggregateRootEntity<TIdentifierType>, IBaseDTO<TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IUnitOfWork, MutateEntityHandlerCore<TCommand, TEntity, TIdentifierType>, Result |
| 9 | `PushNotificationDTOProjector` | MMCA.Common.Application | 4 | IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>, PushNotification, PushNotificationDTO, PushNotificationDTOProjection |
| 9 | `SendPushNotificationHandler` | MMCA.Common.Application | 13 | Error, ICommandHandler<in TCommand, TResult>, INativePushSender, INotificationRecipientProvider, IPushNotificationSender, IUnitOfWork, NotificationScopeKey, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, Result, SendPushNotificationCommand, UserNotification |
| 9 | `ApplicationPipelineCompositionTests` | MMCA.Common.Application.Tests | 14 | ICacheService, ICommandHandler<in TCommand, TResult>, ICorrelationContext, ICurrentUserService, IDomainEventDispatcher, IPermissionRegistry, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PipelineMarker, PipelinePingCommand, PipelinePingCommandHandler, PipelinePingQuery, PipelinePingQueryHandler, Result |
| 9 | `CommandDecoratorPipelineTests` | MMCA.Common.Application.Tests | 13 | CachePipelineTestCommand, CachingCommandDecorator<TCommand, TResult>, Error, FullPipelineTestCommand, ICacheService, ICommandHandler<in TCommand, TResult>, ICorrelationContext, IUnitOfWork, LoggingCommandDecorator<TCommand, TResult>, PipelineTestCommand, Result, TransactionalCommandDecorator<TCommand, TResult>, TransactionalPipelineTestCommand |
| 9 | `ConfirmableAuthenticationService` | MMCA.Common.Application.Tests | 16 | AuthenticationServiceBase<TUser>, AuthenticationValidators, AuthSessionIssuer, ConfirmableAuthUser, Email, EmailConfirmationSettings, ILoginProtectionService, IPasswordHasher, IRefreshSessionStore, ITokenService, ITwoFactorAuthenticator, IUnitOfWork, RefreshSessionSettings, RegisterRequest, Result, TokenService |
| 9 | `CrossSourceSpecificationTests` | MMCA.Common.Application.Tests | 5 | CrossSourceSpecification, Dependent, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, Principal |
| 9 | `DeleteEntityHandlerTests` | MMCA.Common.Application.Tests | 6 | DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, ErrorType, IRepository<TEntity, TIdentifierType>, IUnitOfWork, TestAggregateEntity |
| 9 | `EntityQueryServiceProjectionTests` | MMCA.Common.Application.Tests | 16 | EntityQueryPipeline, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, InlineSpecification<TEntity, TIdentifierType>, InMemoryQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, NavigationMetadata, NavigationPropertyInfo, NavigationType, ProjectedEntity, ProjectedEntityDTO, SpyMapper, TestProjector |
| 9 | `EntityQueryServiceResolutionTests` | MMCA.Common.Application.Tests | 13 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, ResolvedEntity, ResolvedEntityDTO, ResolvedProjector, ResolvedProjectorMarker |
| 9 | `GetMyNotificationsHandlerTests` | MMCA.Common.Application.Tests | 10 | GetMyNotificationsHandler, GetMyNotificationsQuery, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, PagedCollectionResult<T>, PushNotification, Result, UserNotification, UserNotificationDTO |
| 9 | `GetUnreadNotificationCountHandlerTests` | MMCA.Common.Application.Tests | 9 | GetUnreadNotificationCountHandler, GetUnreadNotificationCountQuery, HandlerMocks, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, PushNotification, Result, UserNotification |
| 9 | `MappedEntityQueryService` | MMCA.Common.Application.Tests | 8 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, FakeEntity, FakeEntityDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork |
| 9 | `MarkNotificationReadHandlerTests` | MMCA.Common.Application.Tests | 9 | FixedTimeProvider, HandlerMocks, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, MarkNotificationReadCommand, MarkNotificationReadHandler, Result, UserNotification |
| 9 | `NarrowedQueryService` | MMCA.Common.Application.Tests | 9 | AccountDTO, AccountEntity, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork, QueryFieldContract |
| 9 | `PushNotificationDTOMapperTests` | MMCA.Common.Application.Tests | 5 | PushNotification, PushNotificationDTO, PushNotificationDTOMapper, PushNotificationStatus, Result |
| 9 | `RefusingPrepareCreateOrderHandler` | MMCA.Common.Application.Tests | 9 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, Error, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderCreateRequest, OrderDTO, Result |
| 9 | `RewritingPrepareCreateOrderHandler` | MMCA.Common.Application.Tests | 8 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderCreateRequest, OrderDTO, Result |
| 9 | `SendPushNotificationRequestValidatorTests` | MMCA.Common.Application.Tests | 4 | PushNotification, PushNotificationInvariants, SendPushNotificationRequest, SendPushNotificationRequestValidator |
| 9 | `SessionAwareAuthenticationService` | MMCA.Common.Application.Tests | 14 | AuthenticationServiceBase<TUser>, AuthenticationValidators, AuthSessionIssuer, Email, ILoginProtectionService, IPasswordHasher, IRefreshSessionStore, ITokenService, IUnitOfWork, RefreshSessionSettings, RegisterRequest, Result, TestAuthUser, TokenService |
| 9 | `SoftDeletedUserValidatorTests` | MMCA.Common.Application.Tests | 4 | IRepository<TEntity, TIdentifierType>, IUnitOfWork, SoftDeletedUserValidator<TUser>, TestIdentityUser |
| 9 | `TermsAwareAuthenticationService` | MMCA.Common.Application.Tests | 13 | AuthenticationServiceBase<TUser>, AuthenticationValidators, AuthSessionIssuer, Email, ILoginProtectionService, IPasswordHasher, IRefreshSessionStore, ITokenService, IUnitOfWork, RefreshSessionSettings, RegisterRequest, Result, TestAuthUser |
| 9 | `TestableEntityQueryService` | MMCA.Common.Application.Tests | 8 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, FakeEntity, FakeEntityDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork |
| 9 | `TestAddOrderLineHandler` | MMCA.Common.Application.Tests | 7 | AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>, AddOrderLineCommand, IUnitOfWork, OrderAggregate, OrderLine, OrderLineDTO, Result |
| 9 | `TestAuthenticationService` | MMCA.Common.Application.Tests | 13 | AuthenticationServiceBase<TUser>, AuthenticationValidators, AuthSessionIssuer, Email, ILoginProtectionService, IPasswordHasher, IRefreshSessionStore, ITokenService, IUnitOfWork, RefreshSessionSettings, RegisterRequest, Result, TestAuthUser |
| 9 | `TestChangePasswordHandler` | MMCA.Common.Application.Tests | 7 | ChangePasswordHandlerBase<TUser, TCommand>, ILoginProtectionService, IPasswordHasher, IRefreshSessionStore, IUnitOfWork, TestChangePasswordCommand, TestIdentityUser |
| 9 | `TestChangePreferencesHandler` | MMCA.Common.Application.Tests | 4 | ChangePreferencesHandlerBase<TUser, TCommand>, IUnitOfWork, TestChangePreferencesCommand, TestIdentityUser |
| 9 | `TestConfirmEmailHandler` | MMCA.Common.Application.Tests | 5 | ConfirmableUser, ConfirmEmailHandlerBase<TUser, TCommand>, IEmailConfirmationTokenService, IUnitOfWork, TestConfirmEmailCommand |
| 9 | `TestCreateOrderHandler` | MMCA.Common.Application.Tests | 7 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderCreateRequest, OrderDTO |
| 9 | `TestDeleteOrderHandler` | MMCA.Common.Application.Tests | 5 | DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, Result |
| 9 | `TestDeleteUserHandler` | MMCA.Common.Application.Tests | 6 | DeleteUserHandlerBase<TUser, TCommand>, ICacheService, IUnitOfWork, Result, TestDeleteUserCommand, TestHidingDeleteUser |
| 9 | `TestExportUserDataHandler` | MMCA.Common.Application.Tests | 6 | ExportUserDataHandlerBase<TUser, TQuery>, IUnitOfWork, IUserDataExportSection, TestExportUserDataQuery, TestIdentityUser, UserDataExportDTO |
| 9 | `TestForgotPasswordHandler` | MMCA.Common.Application.Tests | 8 | Email, ForgotPasswordHandlerBase<TUser, TCommand>, IEmailSender, IPasswordResetTokenService, IUnitOfWork, PasswordResetSettings, TestForgotPasswordCommand, TestIdentityUser |
| 9 | `TestGetUserPreferencesHandler` | MMCA.Common.Application.Tests | 3 | GetUserPreferencesHandlerBase<TUser>, IUnitOfWork, TestIdentityUser |
| 9 | `TestResetPasswordHandler` | MMCA.Common.Application.Tests | 8 | ILoginProtectionService, IPasswordHasher, IPasswordResetTokenService, IRefreshSessionStore, IUnitOfWork, ResetPasswordHandlerBase<TUser, TCommand>, TestIdentityUser, TestResetPasswordCommand |
| 9 | `TestSendConfirmationHandler` | MMCA.Common.Application.Tests | 8 | ConfirmableUser, Email, EmailConfirmationSettings, IEmailConfirmationTokenService, IEmailSender, IUnitOfWork, SendEmailConfirmationHandlerBase<TUser, TCommand>, TestSendConfirmationCommand |
| 9 | `TransactionalCommandDecoratorTests` | MMCA.Common.Application.Tests | 6 | ICommandHandler<in TCommand, TResult>, IUnitOfWork, NonTransactionalCommand, Result, TransactionalCommand, TransactionalCommandDecorator<TCommand, TResult> |
| 9 | `FixtureAssemblyMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, Layer, LayerRef, ReadRepositoryQueryHandlerFixture |
| 9 | `PointsAwarder` | MMCA.Common.Architecture.Tests | 1 | PointsWriter |
| 9 | `GatewayCorrelationMiddleware` | MMCA.Common.Aspire | 1 | Activity |
| 9 | `OutboxPollFilterProcessor` | MMCA.Common.Aspire | 1 | Activity |
| 9 | `ProbeTelemetryFilter` | MMCA.Common.Aspire | 2 | Activity, HealthEndpointPaths |
| 9 | `ProbeTelemetryToggleTests` | MMCA.Common.Aspire.Tests | 1 | Activity |
| 9 | `BrokerMessageBus` | MMCA.Common.Infrastructure | 6 | ICorrelationContext, ICurrentUserService, IIntegrationEvent, IMessageBus, ITenantContext, MessageHeaders |
| 9 | `CurrentUserService` | MMCA.Common.Infrastructure | 2 | ICurrentUserService, User |
| 9 | `ImpersonatingCurrentUserService` | MMCA.Common.Infrastructure | 2 | ICurrentUserService, ScopedUserOverride |
| 9 | `IntegrationEventConsumerExtensions` | MMCA.Common.Infrastructure | 6 | FaultEndpointConfigurator, FaultIntegrationEventConsumer<TEvent>, IIntegrationEvent, IntegrationEventConsumer<TEvent>, OutputCacheEvictionRequested, UpcastingIntegrationEventConsumer<TEvent> |
| 9 | `InternalCommandOriginCapture` | MMCA.Common.Infrastructure | 6 | Activity, AmbientOrigin, ICorrelationContext, ICurrentUserService, InternalCommandOrigin, ITenantContext |
| 9 | `OutboxMessage` | MMCA.Common.Infrastructure | 6 | Activity, EventNameResolver, IDomainEvent, IHasOrderingKey, OutboxOrigin, Payload |
| 9 | `FixedCurrentUserService` | MMCA.Common.Infrastructure.SQLServer.Tests | 1 | ICurrentUserService |
| 9 | `AnonymousCurrentUserService` | MMCA.Common.Infrastructure.Tests | 1 | ICurrentUserService |
| 9 | `ClaimBasedUserIdProviderTests` | MMCA.Common.Infrastructure.Tests | 3 | AuthClaimTypes, ClaimBasedUserIdProvider, TestConnectionContext |
| 9 | `IntegrationEventConsumerHarnessTests` | MMCA.Common.Infrastructure.Tests | 13 | EventUpcasterRegistry, FaultIntegrationEventConsumer<TEvent>, HarnessFaultingEvent, HarnessSecondEvent, HarnessTestEvent, IEventUpcasterRegistry, IInboxStore, IIntegrationEventHandler<in TIntegrationEvent>, IntegrationEventConsumer<TEvent>, RecordingHandler<TEvent>, RecordingInboxStore, ThrowingHandler<TEvent>, UpcastingIntegrationEventConsumer<TEvent> |
| 9 | `NullUserService` | MMCA.Common.Infrastructure.Tests | 1 | ICurrentUserService |
| 9 | `OverrideOnlyCurrentUserService` | MMCA.Common.Infrastructure.Tests | 3 | ICurrentUserService, ScopedUserOverride, User |
| 9 | `RecordingCommandHandler` | MMCA.Common.Infrastructure.Tests | 7 | ExecutionLog, ICommandHandler<in TCommand, TResult>, ICurrentUserService, ITenantContext, RecordedExecution, RecordingCommand, Result |
| 9 | `RecordingScopedHandler` | MMCA.Common.Infrastructure.Tests | 5 | ICorrelationContext, ICurrentUserService, ITenantContext, ScopedIntegrationEventHandlerBase<TIntegrationEvent>, TestIntegrationEvent |
| 9 | `RoleOnlyService` | MMCA.Common.Infrastructure.Tests | 1 | ICurrentUserService |
| 9 | `StubCurrentUserService` | MMCA.Common.Infrastructure.Tests | 1 | ICurrentUserService |
| 9 | `UpcastingIntegrationEventConsumerTests` | MMCA.Common.Infrastructure.Tests | 9 | EventUpcasterRegistry, IEventUpcaster, IInboxStore, IIntegrationEventHandler<in TIntegrationEvent>, OrderPlacedV2, RetiredOrderPlaced, RetiredToV2Upcaster, RetiredToV2Upcaster, UpcastingIntegrationEventConsumer<TEvent> |
| 9 | `NotificationPageAuthorizationHandler` | MMCA.Common.UI | 4 | IUIModule, LayoutSettings, NotificationPageGate, NotificationPageRequirement |
| 9 | `GalleryHost` | MMCA.Common.UI.Gallery | 18 | GalleryAuthenticationStateProvider, GalleryFakeAuthenticationHandler, GalleryUIModule, IAuthUIService, INotificationInboxUIService, INotificationScopeProvider, IPushNotificationUIService, ITokenRefresher, ITokenStorageService, IUIModule, NoOpAuthUIService, NotificationState, NullNotificationScopeProvider, NullTokenRefresher, NullTokenStorageService, StubNotificationInboxUIService, StubPushNotificationUIService, SupportedCultures |
| 9 | `NotificationPageGateTests` | MMCA.Common.UI.Tests | 7 | LayoutSettings, NotificationInbox, NotificationList, NotificationPageGate, NotificationSend, NotificationUIModule, OtherModule |
| 10 | `ActivitiesController` | MMCA.ADC.Conference.API | 21 | Activity, ActivityCreateRequest, ActivityDTO, ActivityUpdateRequest, AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, GetPublicActivityFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, Result, Route, Specification<TEntity, TIdentifierType>, SupportsIfMatchAttribute …(+1) |
| 10 | `ConferenceModuleSeeder` | MMCA.ADC.Conference.API | 3 | ConferenceModuleDbSeeder, IModuleSeeder, IUnitOfWork |
| 10 | `EventQuestionAnswersController` | MMCA.ADC.Conference.API | 25 | AddEventQuestionAnswerCommand, AddEventQuestionAnswerRequest, BaseLookup<TIdentifierType>, BatchAddEventQuestionAnswersCommand, BatchAddEventQuestionAnswersRequest, BatchEventQuestionAnswerItem, CollectionResult<T>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, EventQuestionAnswer, EventQuestionAnswerDTO, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, OwnedByUserSpecification<TEntity, TIdentifierType>, OwnershipHelper, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveEventQuestionAnswerCommand, Result …(+5) |
| 10 | `PartnersController` | MMCA.ADC.Conference.API | 21 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, GetPublicPartnerFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, Partner, PartnerCreateRequest, PartnerDTO, PartnerUpdateRequest, QueryFilterModelBinder, Result, Route, Specification<TEntity, TIdentifierType>, SupportsIfMatchAttribute …(+1) |
| 10 | `SessionCategoryItemsController` | MMCA.ADC.Conference.API | 19 | AddSessionCategoryItemCommand, AddSessionCategoryItemRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, GetPublicSessionCategoryItemFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveSessionCategoryItemCommand, Result, Route, SessionCategoryItem, SessionCategoryItemDTO, Specification<TEntity, TIdentifierType> |
| 10 | `SessionQuestionAnswersController` | MMCA.ADC.Conference.API | 25 | AddSessionQuestionAnswerCommand, AddSessionQuestionAnswerRequest, BaseLookup<TIdentifierType>, BatchAddSessionQuestionAnswersCommand, BatchAddSessionQuestionAnswersRequest, BatchSessionQuestionAnswerItem, CollectionResult<T>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, OwnedByUserSpecification<TEntity, TIdentifierType>, OwnershipHelper, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveSessionQuestionAnswerCommand, Result, RoleNames, Route …(+5) |
| 10 | `SessionsController` | MMCA.ADC.Conference.API | 25 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, Event, EventDTO, GetPublicSessionFilterQuery, GetSessionsBySpeakerFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, Result, Route, Session, SessionCreateRequest, SessionDTO …(+5) |
| 10 | `SessionSpeakersController` | MMCA.ADC.Conference.API | 19 | AddSessionSpeakerCommand, AddSessionSpeakerRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, GetPublicSessionSpeakerFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, RemoveSessionSpeakerCommand, Result, Route, SessionSpeaker, SessionSpeakerDTO, Specification<TEntity, TIdentifierType> |
| 10 | `SpeakersController` | MMCA.ADC.Conference.API | 25 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetPublicSpeakerFilterQuery, GetSpeakersByEventFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IPermissionRegistry, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, Result, Route, Speaker, SpeakerCreateRequest, SpeakerDTO …(+5) |
| 10 | `SponsorsController` | MMCA.ADC.Conference.API | 21 | AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>, BaseLookup<TIdentifierType>, CollectionResult<T>, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, GetPublicSponsorFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, QueryFilterModelBinder, Result, Route, Specification<TEntity, TIdentifierType>, Sponsor, SponsorCreateRequest, SponsorDTO, SponsorUpdateRequest, SupportsIfMatchAttribute …(+1) |
| 10 | `ConferenceCategoriesControllerTests` | MMCA.ADC.Conference.API.Tests | 14 | Category, ConferenceCategoriesController, ConferenceCategoryCreateRequest, ConferenceCategoryDTO, ConferenceCategoryUpdateRequest, DeleteEntityCommand<TEntity, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, Result, SupportsIfMatchAttribute, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 10 | `EventLifecycleControllerTests` | MMCA.ADC.Conference.API.Tests | 10 | Error, ErrorType, EventLifecycleController, ICommandHandler<in TCommand, TResult>, PublishEventCommand, RefreshFromSessionizeCommand, RefreshFromSessionizeResultDTO, Result, SupportsIfMatchAttribute, UnpublishEventCommand |
| 10 | `EventsControllerAuthorizationTests` | MMCA.ADC.Conference.API.Tests | 2 | EventsController, RoleNames |
| 10 | `EventsControllerTests` | MMCA.ADC.Conference.API.Tests | 26 | BaseLookup<TIdentifierType>, CollectionResult<T>, DeleteEntityCommand<TEntity, TIdentifierType>, Error, Event, EventCreateRequest, EventDTO, EventsController, EventUpdateRequest, ExportEventCalendarQuery, GetNowNextQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, ISpecification<TEntity, TIdentifierType>, NowNextDTO, PagedCollectionResult<T>, PaginationMetadata, PublishedEventSpecification …(+6) |
| 10 | `EventSpeakersControllerTests` | MMCA.ADC.Conference.API.Tests | 19 | AddEventSpeakerCommand, AddEventSpeakerRequest, BaseLookup<TIdentifierType>, Error, EventSpeaker, EventSpeakerDTO, EventSpeakersController, GetPublicEventSpeakerFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, RemoveEventSpeakerCommand, Result, RoleNames, Specification<TEntity, TIdentifierType> |
| 10 | `QuestionsControllerTests` | MMCA.ADC.Conference.API.Tests | 14 | DeleteEntityCommand<TEntity, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, Question, QuestionCreateRequest, QuestionDTO, QuestionsController, QuestionUpdateRequest, Result, SupportsIfMatchAttribute, UpdateQuestionCommand |
| 10 | `RoomsControllerTests` | MMCA.ADC.Conference.API.Tests | 22 | AddRoomCommand, AddRoomRequest, BaseLookup<TIdentifierType>, CollectionResult<T>, Error, GetPublicRoomFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, RemoveRoomCommand, Result, RoleNames, Room, RoomDTO, RoomsController, Specification<TEntity, TIdentifierType> …(+2) |
| 10 | `SessionAssetsControllerTests` | MMCA.ADC.Conference.API.Tests | 20 | AddSessionAssetLinkCommand, ConferencePermissions, DeleteSessionAssetCommand, Error, GetSessionAssetsQuery, HasPermissionAttribute, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IPermissionRegistry, IQueryHandler<in TQuery, TResult>, Result, SessionAssetDTO, SessionAssetKind, SessionAssetLimits, SessionAssetLinkRequest, SessionAssetsController, SessionAssetUpdateRequest, SupportsIfMatchAttribute, UpdateSessionAssetCommand, UploadSessionAssetCommand |
| 10 | `SpeakerCategoryItemsControllerTests` | MMCA.ADC.Conference.API.Tests | 19 | AddSpeakerCategoryItemCommand, AddSpeakerCategoryItemRequest, BaseLookup<TIdentifierType>, Error, GetPublicSpeakerCategoryItemFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, RemoveSpeakerCategoryItemCommand, Result, RoleNames, SpeakerCategoryItem, SpeakerCategoryItemDTO, SpeakerCategoryItemsController, Specification<TEntity, TIdentifierType> |
| 10 | `SpeakerLinksControllerTests` | MMCA.ADC.Conference.API.Tests | 9 | ConferencePermissions, Error, HasPermissionAttribute, ICommandHandler<in TCommand, TResult>, LinkUserRequest, LinkUserToSpeakerCommand, Result, SpeakerLinksController, UnlinkUserFromSpeakerCommand |
| 10 | `SpeakerSessionsControllerTests` | MMCA.ADC.Conference.API.Tests | 10 | Error, GetSessionBookmarkCountQuery, GetSessionBookmarkCountsQuery, GetSessionFeedbackQuery, ICurrentUserService, IQueryHandler<in TQuery, TResult>, Result, RoleNames, SessionFeedbackDTO, SpeakerSessionsController |
| 10 | `ActivityCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | Activity, ActivityCreateRequest, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result |
| 10 | `ActivityCreateRequestValidator` | MMCA.ADC.Conference.Application | 3 | ActivityCreateRequest, ActivityEventIdRules<T>, ActivityFieldRules<T> |
| 10 | `ActivityNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | Activity, DeclarativeNavigationPopulator<TEntity>, Event, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork |
| 10 | `AddSessionCategoryItemCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddSessionCategoryItemCommand |
| 10 | `AddSessionCategoryItemHandler` | MMCA.ADC.Conference.Application | 8 | AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>, AddSessionCategoryItemCommand, IUnitOfWork, Result, Session, SessionCategoryItem, SessionCategoryItemDTO, SessionCategoryItemDTOMapper |
| 10 | `AddSessionQuestionAnswerCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddSessionQuestionAnswerCommand |
| 10 | `AddSessionQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 14 | AddSessionQuestionAnswerCommand, Error, Event, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, Question, Result, Session, SessionFeedbackSubmitted, SessionQuestionAnswer, SessionQuestionAnswerDTO, SessionQuestionAnswerDTOMapper, SessionQuestionAnswerRules |
| 10 | `AddSessionSpeakerCommandValidator` | MMCA.ADC.Conference.Application | 1 | AddSessionSpeakerCommand |
| 10 | `AddSessionSpeakerHandler` | MMCA.ADC.Conference.Application | 8 | AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>, AddSessionSpeakerCommand, IUnitOfWork, Result, Session, SessionSpeaker, SessionSpeakerDTO, SessionSpeakerDTOMapper |
| 10 | `BatchAddSessionQuestionAnswersCommandValidator` | MMCA.ADC.Conference.Application | 1 | BatchAddSessionQuestionAnswersCommand |
| 10 | `BatchAddSessionQuestionAnswersHandler` | MMCA.ADC.Conference.Application | 14 | BatchAddSessionQuestionAnswersCommand, Error, Event, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IUnitOfWork, Question, Result, Session, SessionFeedbackSubmitted, SessionQuestionAnswer, SessionQuestionAnswerDTO, SessionQuestionAnswerDTOMapper, SessionQuestionAnswerRules |
| 10 | `CategoryItemNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | Category, CategoryItem, DeclarativeNavigationPopulator<TEntity>, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork |
| 10 | `CategorySyncStrategy` | MMCA.ADC.Conference.Application | 8 | Category, ISessionizeSyncStrategy, Result, SessionizeCategory, SessionizeCategoryItem, SessionizeSyncContext, SessionizeSyncResult, SessionizeSyncWarnings |
| 10 | `ConferenceCategoryNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | Category, CategoryItem, ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, IUnitOfWork |
| 10 | `CreateActivityHandler` | MMCA.ADC.Conference.Application | 11 | Activity, ActivityCreateRequest, ActivityDTO, ActivityDTOMapper, CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, Error, Event, IEntityReader<TEntity, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Result |
| 10 | `CreateEventHandler` | MMCA.ADC.Conference.Application | 7 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, Event, EventCreateRequest, EventDTO, EventDTOMapper, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork |
| 10 | `CreatePartnerHandler` | MMCA.ADC.Conference.Application | 11 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, Error, Event, IEntityReader<TEntity, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Partner, PartnerCreateRequest, PartnerDTO, PartnerDTOMapper, Result |
| 10 | `CreateSpeakerHandler` | MMCA.ADC.Conference.Application | 7 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Speaker, SpeakerCreateRequest, SpeakerDTO, SpeakerDTOMapper |
| 10 | `CreateSponsorHandler` | MMCA.ADC.Conference.Application | 11 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, Error, Event, IEntityReader<TEntity, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Result, Sponsor, SponsorCreateRequest, SponsorDTO, SponsorDTOMapper |
| 10 | `DeleteEventHandler` | MMCA.ADC.Conference.Application | 14 | Activity, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteSessionAssetBlobInternalCommand, Error, Event, EventCascadeDeletionDomainService, ICommandHandler<in TCommand, TResult>, IInternalCommandScheduler, IUnitOfWork, Partner, Result, Session, SessionAsset, Sponsor |
| 10 | `EventLiveValidationService` | MMCA.ADC.Conference.Application | 14 | CalendarExportMapper, CurrentEventSelector, Error, Event, EventLiveInfo, IEventLiveValidationService, IUnitOfWork, Result, RoomSessionInfo, Session, SessionInvariants, SessionLiveInfo, Sponsor, SponsorLiveInfo |
| 10 | `EventNavigationPopulator` | MMCA.ADC.Conference.Application | 7 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, Event, EventQuestionAnswer, EventSpeaker, IUnitOfWork, Room |
| 10 | `EventQuestionAnswerNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, Event, EventQuestionAnswer, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork |
| 10 | `EventSpeakerNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, Event, EventSpeaker, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork |
| 10 | `ExportEventCalendarHandler` | MMCA.ADC.Conference.Application | 9 | CalendarExportMapper, Error, Event, ExportEventCalendarQuery, IcsCalendarBuilder, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session |
| 10 | `ExportSessionCalendarHandler` | MMCA.ADC.Conference.Application | 9 | CalendarExportMapper, Error, Event, ExportSessionCalendarQuery, IcsCalendarBuilder, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, Session |
| 10 | `GetNowNextHandler` | MMCA.ADC.Conference.Application | 11 | CalendarExportMapper, CurrentEventSelector, Error, Event, GetNowNextQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, NowNextDTO, NowNextSessionDTO, Result, Session |
| 10 | `GetPublicSessionFilterHandler` | MMCA.ADC.Conference.Application | 9 | CrossSourceSpecification, Event, GetPublicSessionFilterQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicSessionStatusSpecification, Result, Session, Specification<TEntity, TIdentifierType> |
| 10 | `PartnerCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Partner, PartnerCreateRequest, Result |
| 10 | `PartnerCreateRequestValidator` | MMCA.ADC.Conference.Application | 3 | PartnerCreateRequest, PartnerEventIdRules<T>, PartnerFieldRules<T> |
| 10 | `PartnerNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, Event, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, Partner |
| 10 | `PublicConferenceVisibility` | MMCA.ADC.Conference.Application | 8 | CrossSourceSpecification, Event, IEntityQuerier<TEntity, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IUnitOfWork, PublicSessionStatusSpecification, Session, SessionSpeaker |
| 10 | `PublishEventHandler` | MMCA.ADC.Conference.Application | 5 | Event, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, PublishEventCommand, Result |
| 10 | `QuestionSyncStrategy` | MMCA.ADC.Conference.Application | 6 | ISessionizeSyncStrategy, Question, QuestionInvariants, SessionizeSyncContext, SessionizeSyncResult, SessionizeSyncWarnings |
| 10 | `RemoveEventQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 9 | Error, Event, EventQuestionAnswer, ICurrentUserService, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, RemoveEventQuestionAnswerCommand, Result, RoleNames |
| 10 | `RemoveSessionQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 10 | Error, ICurrentUserService, IRepository<TEntity, TIdentifierType>, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, RemoveSessionQuestionAnswerCommand, Result, RoleNames, Session, SessionQuestionAnswer |
| 10 | `RoomNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, Event, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, Room |
| 10 | `RoomSyncStrategy` | MMCA.ADC.Conference.Application | 9 | Event, EventInvariants, ISessionizeSyncStrategy, Result, Room, SessionizeRoom, SessionizeSyncContext, SessionizeSyncResult, SessionizeSyncWarnings |
| 10 | `SessionAssetAccessService` | MMCA.ADC.Conference.Application | 11 | Error, Event, IEntityQuerier<TEntity, TIdentifierType>, IEntityReader<TEntity, TIdentifierType>, ISessionAssetAccessService, IUnitOfWork, PublicSessionStatusSpecification, Result, Session, SessionAsset, SessionAssetLimits |
| 10 | `SessionCategoryItemNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, Session, SessionCategoryItem |
| 10 | `SessionCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result, Session, SessionCreateRequest |
| 10 | `SessionCreateRequestValidator` | MMCA.ADC.Conference.Application | 3 | SessionCreateRequest, SessionEventIdRules<T>, SessionFieldRules<T> |
| 10 | `SessionDTOMapper` | MMCA.ADC.Conference.Application | 6 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, Session, SessionCategoryItemDTOMapper, SessionDTO, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper |
| 10 | `SessionNavigationPopulator` | MMCA.ADC.Conference.Application | 10 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, Event, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, Room, Session, SessionCategoryItem, SessionQuestionAnswer, SessionSpeaker |
| 10 | `SessionQuestionAnswerNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, Session, SessionQuestionAnswer |
| 10 | `SessionSpeakerNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, Session, SessionSpeaker |
| 10 | `SessionSyncStrategy` | MMCA.ADC.Conference.Application | 8 | ISessionizeSyncStrategy, Result, Session, SessionizeQuestionAnswer, SessionizeSession, SessionizeSyncContext, SessionizeSyncResult, SessionizeSyncWarnings |
| 10 | `SpeakerCategoryItemNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, Speaker, SpeakerCategoryItem |
| 10 | `SpeakerEntityQueryService` | MMCA.ADC.Conference.Application | 9 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork, QueryFieldContract, Speaker, SpeakerDTO, SpeakerDTOMapper |
| 10 | `SpeakerNavigationPopulator` | MMCA.ADC.Conference.Application | 6 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, IUnitOfWork, Speaker, SpeakerCategoryItem, SpeakerQuestionAnswer |
| 10 | `SpeakerSyncStrategy` | MMCA.ADC.Conference.Application | 11 | CommonInvariants, EventSpeaker, ISessionizeSyncStrategy, Result, SessionizeQuestionAnswer, SessionizeSpeaker, SessionizeSyncContext, SessionizeSyncResult, SessionizeSyncWarnings, Speaker, SpeakerInvariants |
| 10 | `SponsorCreateRequestMapper` | MMCA.ADC.Conference.Application | 4 | IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, Result, Sponsor, SponsorCreateRequest |
| 10 | `SponsorCreateRequestValidator` | MMCA.ADC.Conference.Application | 3 | SponsorCreateRequest, SponsorEventIdRules<T>, SponsorFieldRules<T> |
| 10 | `SponsorNavigationPopulator` | MMCA.ADC.Conference.Application | 5 | DeclarativeNavigationPopulator<TEntity>, Event, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, Sponsor |
| 10 | `UnlinkUserFromSpeakerHandler` | MMCA.ADC.Conference.Application | 6 | IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Result, Speaker, SpeakerUnlinkedFromUser, UnlinkUserFromSpeakerCommand |
| 10 | `UnpublishEventHandler` | MMCA.ADC.Conference.Application | 5 | Event, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Result, UnpublishEventCommand |
| 10 | `UpdateCategoryItemHandler` | MMCA.ADC.Conference.Application | 5 | Category, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Result, UpdateCategoryItemCommand |
| 10 | `UpdateRoomHandler` | MMCA.ADC.Conference.Application | 5 | Event, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Result, UpdateRoomCommand |
| 10 | `UpdateSessionAssetHandler` | MMCA.ADC.Conference.Application | 8 | ISessionAssetAccessService, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Result, SessionAsset, SessionAssetDTO, SessionAssetDTOMapper, UpdateSessionAssetCommand |
| 10 | `UpdateSessionQuestionAnswerCommandValidator` | MMCA.ADC.Conference.Application | 2 | QuestionInvariants, UpdateSessionQuestionAnswerCommand |
| 10 | `ActivityDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 2 | Activity, ActivityDTOMapper |
| 10 | `ActivityUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | ActivityInvariants, ActivityUpdateRequest, ActivityUpdateRequestValidator |
| 10 | `AddEventQuestionAnswerCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddEventQuestionAnswerCommand, AddEventQuestionAnswerCommandValidator |
| 10 | `AddEventSpeakerCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddEventSpeakerCommand, AddEventSpeakerCommandValidator |
| 10 | `AddRoomCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | AddRoomCommand, AddRoomCommandValidator, EventInvariants |
| 10 | `AddSpeakerCategoryItemCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddSpeakerCategoryItemCommand, AddSpeakerCategoryItemCommandValidator |
| 10 | `BatchAddEventQuestionAnswersCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | BatchAddEventQuestionAnswersCommand, BatchAddEventQuestionAnswersCommandValidator, BatchEventQuestionAnswerItem |
| 10 | `CalendarExportMapperTests` | MMCA.ADC.Conference.Application.Tests | 5 | CalendarExportMapper, Event, Session, SessionBuilder, SessionStatuses |
| 10 | `EventCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | EventCreateRequest, EventCreateRequestValidator, EventInvariants |
| 10 | `EventDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 5 | Event, EventDTOMapper, EventQuestionAnswerDTOMapper, EventSpeakerDTOMapper, RoomDTOMapper |
| 10 | `EventSessionizeCodeRulesTests` | MMCA.ADC.Conference.Application.Tests | 7 | EventCreateRequest, EventCreateRequestValidator, EventUpdateRequest, EventUpdateRequestValidator, SessionizeCodeFormat, TestSessionizeModel, TestSessionizeValidator |
| 10 | `EventUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | EventUpdateRequest, EventUpdateRequestValidator |
| 10 | `GetSessionBookmarkCountHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | ErrorType, GetSessionBookmarkCountHandler, GetSessionBookmarkCountQuery, IBookmarkCountService, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, Session, SessionBuilder |
| 10 | `GetSessionBookmarkCountsHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | GetSessionBookmarkCountsHandler, GetSessionBookmarkCountsQuery, IBookmarkCountService, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, Session, SessionBuilder |
| 10 | `GetSessionFeedbackHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | ErrorType, GetSessionFeedbackHandler, GetSessionFeedbackQuery, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question, Result, Session, SessionBuilder, SessionFeedbackDTO |
| 10 | `PartnerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Partner, PartnerDTOMapper, PartnerType |
| 10 | `PartnerUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 4 | PartnerInvariants, PartnerType, PartnerUpdateRequest, PartnerUpdateRequestValidator |
| 10 | `QuestionCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | QuestionCreateRequest, QuestionCreateRequestValidator, QuestionInvariants |
| 10 | `SessionAssetLinkRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionAssetInvariants, SessionAssetLinkRequest, SessionAssetLinkRequestValidator |
| 10 | `SessionAssetUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionAssetInvariants, SessionAssetUpdateRequest, SessionAssetUpdateRequestValidator |
| 10 | `SessionCategoryItemDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 4 | Session, SessionBuilder, SessionCategoryItem, SessionCategoryItemDTOMapper |
| 10 | `SessionQuestionAnswerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 4 | Session, SessionBuilder, SessionQuestionAnswer, SessionQuestionAnswerDTOMapper |
| 10 | `SessionRoomFilterTests` | MMCA.ADC.Conference.Application.Tests | 3 | QueryFilterService, Session, SessionBuilder |
| 10 | `SessionRoomSchedulingTests` | MMCA.ADC.Conference.Application.Tests | 4 | ErrorType, Session, SessionBuilder, SessionRoomScheduling |
| 10 | `SessionSpeakerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 4 | Session, SessionBuilder, SessionSpeaker, SessionSpeakerDTOMapper |
| 10 | `SessionUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionInvariants, SessionUpdateRequest, SessionUpdateRequestValidator |
| 10 | `SpeakerCreateRequestMapperTests` | MMCA.ADC.Conference.Application.Tests | 2 | SpeakerCreateRequest, SpeakerCreateRequestMapper |
| 10 | `SpeakerCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 4 | Email, SpeakerCreateRequest, SpeakerCreateRequestValidator, SpeakerInvariants |
| 10 | `SpeakerDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 6 | ICurrentUserService, Speaker, SpeakerBuilder, SpeakerCategoryItemDTOMapper, SpeakerDTOMapper, SpeakerQuestionAnswerDTOMapper |
| 10 | `SpeakerUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 4 | Email, SpeakerInvariants, SpeakerUpdateRequest, SpeakerUpdateRequestValidator |
| 10 | `SponsorDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 3 | Sponsor, SponsorDTOMapper, SponsorTier |
| 10 | `SponsorUpdateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 4 | SponsorInvariants, SponsorTier, SponsorUpdateRequest, SponsorUpdateRequestValidator |
| 10 | `UpdateRoomCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | EventInvariants, UpdateRoomCommand, UpdateRoomCommandValidator |
| 10 | `UploadSessionAssetCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 4 | SessionAssetFixtures, SessionAssetLimits, UploadSessionAssetCommand, UploadSessionAssetCommandValidator |
| 10 | `UserDeletedFeedbackHandlerTests` | MMCA.ADC.Conference.Application.Tests | 12 | AuditableAggregateRootEntity<TIdentifierType>, Event, EventQuestionAnswer, InMemoryRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, QuestionInvariants, RecordingUnitOfWork, Session, SessionQuestionAnswer, UserDeleted, UserDeletedFeedbackHandler |
| 10 | `UserDeletedSpeakerUnlinkHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | ApplicationSettings, IIntegrationEventHandler<in TIntegrationEvent>, InMemoryRepository<TEntity, TIdentifierType>, IUnitOfWork, RecordingUnitOfWork, Speaker, SpeakerUnlinkedFromUser, UserDeleted, UserDeletedFeedbackHandler, UserDeletedSpeakerUnlinkHandler |
| 10 | `UserRegisteredHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | Fakes, IEventBus, InMemoryRepository<TEntity, TIdentifierType>, IUnitOfWork, RecordingEventBus, RecordingUnitOfWork, Speaker, SpeakerBuilder, SpeakerLinkedToUser, UserRegistered, UserRegisteredHandler |
| 10 | `SessionBookmarkValidationServiceGrpcAdapter` | MMCA.ADC.Conference.Contracts | 3 | ISessionBookmarkValidationService, Result, SessionBookmarkValidationService |
| 10 | `ActivityTests` | MMCA.ADC.Conference.Domain.Tests | 6 | Activity, ActivityBuilder, ActivityChanged, ActivityInvariants, DomainEntityState, Result |
| 10 | `EventCascadeDeletionDomainServiceTests` | MMCA.ADC.Conference.Domain.Tests | 7 | ActivityBuilder, Event, EventCascadeDeletionDomainService, PartnerBuilder, PartnerType, Session, SponsorBuilder |
| 10 | `PartnerTests` | MMCA.ADC.Conference.Domain.Tests | 7 | DomainEntityState, Partner, PartnerBuilder, PartnerChanged, PartnerInvariants, PartnerType, Result |
| 10 | `SessionCategoryItemTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, ErrorType, SessionBuilder, SessionCategoryItem, SessionCategoryItemChanged |
| 10 | `SessionQuestionAnswerTests` | MMCA.ADC.Conference.Domain.Tests | 7 | DomainEntityState, ErrorType, QuestionInvariants, SessionBuilder, SessionInvariants, SessionQuestionAnswer, SessionQuestionAnswerChanged |
| 10 | `SessionSpeakerTests` | MMCA.ADC.Conference.Domain.Tests | 5 | DomainEntityState, ErrorType, SessionBuilder, SessionSpeaker, SessionSpeakerChanged |
| 10 | `SponsorTests` | MMCA.ADC.Conference.Domain.Tests | 7 | DomainEntityState, Result, Sponsor, SponsorBuilder, SponsorChanged, SponsorInvariants, SponsorTier |
| 10 | `ConferenceModuleDbSeederTests` | MMCA.ADC.Conference.Infrastructure.Tests | 7 | ConferenceModuleDbSeeder, Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question, QuestionInvariants, SeederMocks |
| 10 | `SessionBookmarksGrpcService` | MMCA.ADC.Conference.Service | 2 | ISessionBookmarkValidationService, SessionBookmarkValidationService |
| 10 | `CurrentEventDefaultsTests` | MMCA.ADC.Conference.Shared.Tests | 3 | CurrentEventDefaults, Event, EventDTO |
| 10 | `ActivityList` | MMCA.ADC.Conference.UI | 9 | ActivityDTO, ActivityService, ConferenceRoutePaths, ErrorMessages, EventFilteredListPageBase<TDto>, IActivityUIService, ListPageActions, MobileInfiniteScrollList<TItem>, Result |
| 10 | `PartnerList` | MMCA.ADC.Conference.UI | 10 | ConferenceRoutePaths, ErrorMessages, EventFilteredListPageBase<TDto>, IPartnerUIService, ListPageActions, MobileInfiniteScrollList<TItem>, PartnerDTO, PartnerService, PartnerType, Result |
| 10 | `PublicSessionEventCatalog` | MMCA.ADC.Conference.UI | 8 | CurrentEventDefaults, EventDTO, IEventUIService, ISpeakerLookupService, PublicReadAudience, PublicScheduleRoomOptions, RoomDTO, SpeakerInfo |
| 10 | `PublicSpeakerDetail` | MMCA.ADC.Conference.UI | 13 | ConferenceReadAudience, ConferenceRoutePaths, CurrentEventDefaults, EventService, IEventUIService, ISessionUIService, ISpeakerUIService, IToastService, LatestLoadGuard, SessionDTO, SessionService, SpeakerDTO, SpeakerService |
| 10 | `PublicSpeakerList` | MMCA.ADC.Conference.UI | 5 | EventFilteredListPageBase<TDto>, ISpeakerUIService, PublicReadAudience, SpeakerDTO, SpeakerService |
| 10 | `RoomList` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, ErrorMessages, EventFilteredListPageBase<TDto>, IRoomUIService, ListPageActions, MobileInfiniteScrollList<TItem>, Result, RoomDTO, RoomService |
| 10 | `SessionList` | MMCA.ADC.Conference.UI | 16 | ConferenceRoutePaths, CurrentEventDefaults, DataGridListPageBase<TDto>, ErrorMessages, EventDTO, EventService, IEventUIService, ISessionUIService, ISpeakerLookupService, ListPageActions, MobileInfiniteScrollList<TItem>, Result, SessionDTO, SessionService, SessionStatusDisplay, SpeakerInfo |
| 10 | `SessionStatusDisplay` | MMCA.ADC.Conference.UI | 2 | SessionList, SessionStatuses |
| 10 | `SpeakerList` | MMCA.ADC.Conference.UI | 9 | ConferenceRoutePaths, ErrorMessages, EventFilteredListPageBase<TDto>, ISpeakerUIService, ListPageActions, MobileInfiniteScrollList<TItem>, Result, SpeakerDTO, SpeakerService |
| 10 | `SponsorList` | MMCA.ADC.Conference.UI | 10 | ConferenceRoutePaths, ErrorMessages, EventFilteredListPageBase<TDto>, ISponsorUIService, ListPageActions, MobileInfiniteScrollList<TItem>, Result, SponsorDTO, SponsorService, SponsorTier |
| 10 | `ActivityCreateTests` | MMCA.ADC.Conference.UI.Tests | 7 | ActivityCreate, ActivityCreateModel, ActivityDTO, BunitTestBase, EventInfo, IActivityUIService, IEventLookupService |
| 10 | `ActivityDetailStaleLoadTests` | MMCA.ADC.Conference.UI.Tests | 8 | Activity, ActivityDetail, ActivityDTO, BunitTestBase, EventInfo, IActivityUIService, IEventLookupService, Result |
| 10 | `ActivityDetailTests` | MMCA.ADC.Conference.UI.Tests | 9 | Activity, ActivityDetail, ActivityDTO, BunitTestBase, Error, EventInfo, IActivityUIService, IEventLookupService, Result |
| 10 | `ADCHomeDisposalTests` | MMCA.ADC.Conference.UI.Tests | 6 | ADCHome, ADCHomeServiceDoubles, BunitTestBase, EventDTO, IEventUIService, Result |
| 10 | `ADCHomePartnersTests` | MMCA.ADC.Conference.UI.Tests | 6 | ADCHome, ADCHomeServiceDoubles, BunitTestBase, Partner, PartnerDTO, PartnerType |
| 10 | `ADCHomeSponsorsTests` | MMCA.ADC.Conference.UI.Tests | 4 | ADCHome, ADCHomeServiceDoubles, BunitTestBase, SponsorDTO |
| 10 | `ADCHomeStaffEventListTests` | MMCA.ADC.Conference.UI.Tests | 9 | ADCHome, BunitTestBase, EventDTO, IEventUIService, IPartnerUIService, ISponsorUIService, PartnerDTO, Result, SponsorDTO |
| 10 | `ADCHomeTests` | MMCA.ADC.Conference.UI.Tests | 5 | ADCHome, BunitTestBase, IEventUIService, IPartnerUIService, ISponsorUIService |
| 10 | `ADCHomeTicketingTests` | MMCA.ADC.Conference.UI.Tests | 3 | ADCHome, ADCHomeServiceDoubles, BunitTestBase |
| 10 | `PartnerCreateTests` | MMCA.ADC.Conference.UI.Tests | 7 | BunitTestBase, EventInfo, IEventLookupService, IPartnerUIService, PartnerCreate, PartnerDTO, PartnerType |
| 10 | `PartnerDetailStaleLoadTests` | MMCA.ADC.Conference.UI.Tests | 9 | BunitTestBase, EventInfo, IEventLookupService, IPartnerUIService, Partner, PartnerDetail, PartnerDTO, PartnerType, Result |
| 10 | `PartnerDetailTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, Error, EventInfo, IEventLookupService, IPartnerUIService, Partner, PartnerDetail, PartnerDTO, PartnerType, Result |
| 10 | `PublicActivityListTests` | MMCA.ADC.Conference.UI.Tests | 8 | ActivityDTO, BunitTestBase, Error, EventInfo, IActivityUIService, IEventLookupService, PublicActivityList, Result |
| 10 | `PublicEventListRedirectTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, EventDTO, EventInfo, IEventLookupService, IEventUIService, MobileInfiniteScrollList<TItem>, PublicEventList, Result, RoleNames, TestPrincipal |
| 10 | `PublicSessionDetailBookmarkTests` | MMCA.ADC.Conference.UI.Tests | 16 | BunitTestBase, CategoryItemInfo, Error, ICategoryItemLookupService, IRoomUIService, ISessionBookmarkUIService, ISessionLiveUIService, ISessionUIService, ISpeakerLookupService, IToastService, ProblemDetailsResultReader, PublicSessionDetail, Result, SessionDTO, SpeakerInfo, UserSessionBookmarkDTO |
| 10 | `PublicSessionDetailLiveButtonTests` | MMCA.ADC.Conference.UI.Tests | 16 | BunitTestBase, CategoryItemInfo, Error, EventInfo, FixedTimeProvider, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionBookmarkUIService, ISessionLiveUIService, ISessionUIService, ISpeakerLookupService, PublicSessionDetail, Result, SessionDTO, SpeakerInfo |
| 10 | `PublicSessionDetailTests` | MMCA.ADC.Conference.UI.Tests | 18 | BunitTestBase, CategoryItemInfo, Error, ICategoryItemLookupService, IHapticFeedbackService, IRoomUIService, ISessionBookmarkUIService, ISessionLiveUIService, ISessionUIService, ISpeakerLookupService, PublicSessionDetail, Result, RoomDTO, SessionCategoryItemDTO, SessionDTO, SessionStatuses, SpeakerInfo, UserSessionBookmarkDTO |
| 10 | `PublicSponsorListTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, Error, EventInfo, HttpResultExecutor, IEventLookupService, ISponsorUIService, PublicSponsorList, Result, SponsorDTO, SponsorTier |
| 10 | `SessionDetailCategoryChipTests` | MMCA.ADC.Conference.UI.Tests | 18 | BunitTestBase, CategoryItemInfo, EventInfo, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionCategoryItemUIService, ISessionSpeakerUIService, ISessionUIService, ISpeakerLookupService, Result, RoleNames, RoomDTO, SessionCategoryItemDTO, SessionDetail, SessionDTO, SpeakerInfo, TestPrincipal |
| 10 | `SessionDetailChipErrorTests` | MMCA.ADC.Conference.UI.Tests | 20 | BunitTestBase, CategoryItemInfo, Error, EventInfo, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionCategoryItemUIService, ISessionSpeakerUIService, ISessionUIService, ISpeakerLookupService, IToastService, Result, RoleNames, RoomDTO, SessionCategoryItemDTO, SessionDetail, SessionDTO, SpeakerInfo, TestPrincipal |
| 10 | `SessionDetailDeletedSpeakerTests` | MMCA.ADC.Conference.UI.Tests | 18 | BunitTestBase, CategoryItemInfo, EventInfo, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionCategoryItemUIService, ISessionSpeakerUIService, ISessionUIService, ISpeakerLookupService, Result, RoleNames, RoomDTO, SessionDetail, SessionDTO, SessionSpeakerDTO, SpeakerInfo, TestPrincipal |
| 10 | `SessionDetailRoomCacheTests` | MMCA.ADC.Conference.UI.Tests | 18 | BunitTestBase, CategoryItemInfo, EventInfo, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionCategoryItemUIService, ISessionSpeakerUIService, ISessionUIService, ISpeakerLookupService, Result, RoleNames, Room, RoomDTO, SessionDetail, SessionDTO, SpeakerInfo, TestPrincipal |
| 10 | `SessionDetailScheduleTests` | MMCA.ADC.Conference.UI.Tests | 17 | BunitTestBase, CategoryItemInfo, EventInfo, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionCategoryItemUIService, ISessionSpeakerUIService, ISessionUIService, ISpeakerLookupService, Result, RoleNames, RoomDTO, SessionDetail, SessionDTO, SpeakerInfo, TestPrincipal |
| 10 | `SessionDetailStaleLoadTests` | MMCA.ADC.Conference.UI.Tests | 19 | BunitTestBase, CategoryItemInfo, Error, EventInfo, ICategoryItemLookupService, IEventLookupService, IRoomUIService, ISessionCategoryItemUIService, ISessionSpeakerUIService, ISessionUIService, ISpeakerLookupService, Result, RoleNames, RoomDTO, Session, SessionDetail, SessionDTO, SpeakerInfo, TestPrincipal |
| 10 | `SessionSelectionDashboardTests` | MMCA.ADC.Conference.UI.Tests | 18 | BunitTestBase, CategoryDistributionDTO, CategoryGroupDistribution, CategoryItemDistribution, Error, EventInfo, IEventLookupService, ISessionSelectionUIService, MultiSessionSpeaker, Result, ScoreEventSessionsResultDTO, SessionAiScoreDTO, Sessions, SessionSelectionDashboard, SessionSelectionDashboardDTO, SpeakerLocalitySummary, SpeakerSessionOverlapDTO, SpeakerSessionSummary |
| 10 | `SessionSelectionStaleResponseTests` | MMCA.ADC.Conference.UI.Tests | 18 | BunitTestBase, CategoryDistributionDTO, Error, EventInfo, IEventLookupService, ISessionSelectionUIService, IToastService, MultiSessionSpeaker, Result, ScoreEventSessionsResultDTO, SessionAiScoreDTO, Sessions, SessionSelectionAiScores, SessionSelectionDashboard, SessionSelectionDashboardDTO, SpeakerSessionOverlapDTO, SpeakerSessionSummary, ToastSeverity |
| 10 | `SpeakerDashboardTests` | MMCA.ADC.Conference.UI.Tests | 16 | BunitTestBase, Error, EventInfo, IEventLookupService, ISpeakerDashboardUIService, ISpeakerUIService, IToastService, RatingQuestionSummary, Result, Session, SessionDTO, SessionFeedbackDTO, SpeakerDashboard, SpeakerDTO, TestPrincipal, TextQuestionResponses |
| 10 | `SponsorCreateTests` | MMCA.ADC.Conference.UI.Tests | 7 | BunitTestBase, EventInfo, IEventLookupService, ISponsorUIService, SponsorCreate, SponsorDTO, SponsorTier |
| 10 | `SponsorDetailStaleLoadTests` | MMCA.ADC.Conference.UI.Tests | 9 | BunitTestBase, EventInfo, IEventLookupService, ISponsorUIService, Result, Sponsor, SponsorDetail, SponsorDTO, SponsorTier |
| 10 | `SponsorDetailTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, Error, EventInfo, IEventLookupService, ISponsorUIService, Result, Sponsor, SponsorDetail, SponsorDTO, SponsorTier |
| 10 | `CheckInsControllerTests` | MMCA.ADC.Engagement.API.Tests | 22 | AttendanceStatsDTO, CheckInAttendeeRequest, CheckInResultDTO, CheckInsController, CheckInScope, ControllerMocks, EngagementFeatures, EngagementPermissions, Error, GetAttendanceStatsQuery, GetOrCreateMyBadgeCommand, HasPermissionAttribute, ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult>, ManualCheckInRequest, MyBadgeDTO, Result, RoomCheckInRequest, RoomCheckInResultDTO, SessionAttendanceDTO …(+2) |
| 10 | `ConditionalWriteConventionTests` | MMCA.ADC.Engagement.API.Tests | 3 | LivePollsController, SessionQuestionsController, SupportsIfMatchAttribute |
| 10 | `LivePollsControllerTests` | MMCA.ADC.Engagement.API.Tests | 20 | CloseLivePollCommand, ControllerMocks, CreateLivePollCommand, CreateLivePollRequest, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetEventPollsQuery, GetSessionManagePollsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IdempotentAttribute, IQueryHandler<in TQuery, TResult>, LivePoll, LivePollDTO, LivePollsController, LivePollStatus, OpenLivePollCommand, Question, Result, SupportsIfMatchAttribute |
| 10 | `LivePollVotingControllerTests` | MMCA.ADC.Engagement.API.Tests | 14 | CastVoteCommand, CastVoteRequest, ControllerMocks, GetOpenPollsQuery, GetPollResultsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IdempotentAttribute, IQueryHandler<in TQuery, TResult>, LivePollResultsDTO, LivePollStatus, LivePollVotingController, Question, Result |
| 10 | `PointsControllerTests` | MMCA.ADC.Engagement.API.Tests | 21 | ControllerMocks, EngagementFeatures, EngagementPermissions, Entry, Error, GetLeaderboardQuery, GetMyPointsQuery, GetPointsOverviewQuery, HasPermissionAttribute, ICommandHandler<in TCommand, TResult>, IQueryHandler<in TQuery, TResult>, LeaderboardEntryDTO, MyPoints, MyPointsDTO, PointsActivityTotalDTO, PointsActivityType, PointsController, PointsEntryDTO, PointsOverviewDTO, Result …(+1) |
| 10 | `SessionQuestionsControllerTests` | MMCA.ADC.Engagement.API.Tests | 18 | ControllerMocks, Error, GetModerationQueueQuery, GetSessionQuestionsQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IdempotentAttribute, IQueryHandler<in TQuery, TResult>, ModerateQuestionCommand, ModerationAction, QuestionStatus, Result, SessionQuestionDTO, SessionQuestionsController, SubmitQuestionCommand, SubmitQuestionRequest, SupportsIfMatchAttribute, ToggleUpvoteCommand |
| 10 | `AttendeeCheckedInPointsHandler` | MMCA.ADC.Engagement.Application | 6 | AttendeeCheckedIn, CheckInScopeNames, IPointsAwarder, PointsActivityType, PointsSubjectKeys, ScopedIntegrationEventHandlerBase<TIntegrationEvent> |
| 10 | `CastVoteHandler` | MMCA.ADC.Engagement.Application | 12 | CastVoteCommand, Error, ICommandHandler<in TCommand, TResult>, IEntityReader<TEntity, TIdentifierType>, IEventLiveValidationService, IUniqueConstraintViolationDetector, IUnitOfWork, LivePoll, LivePollResultsBuilder, LivePollResultsDTO, LivePollVote, Result |
| 10 | `CloseLivePollHandler` | MMCA.ADC.Engagement.Application | 11 | CloseLivePollCommand, IEventLiveValidationService, ILiveChannelPublishQueue, IUnitOfWork, LiveChannelPublishWorkItem, LivePoll, LivePollAuthorization, LivePollChannel, LivePollClosedPayload, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Result |
| 10 | `CreateLivePollHandler` | MMCA.ADC.Engagement.Application | 10 | CreateLivePollCommand, Error, ICommandHandler<in TCommand, TResult>, IEventLiveValidationService, IUnitOfWork, LivePoll, LivePollAuthorization, LivePollDTO, LivePollDTOMapper, Result |
| 10 | `GetEventPollsHandler` | MMCA.ADC.Engagement.Application | 8 | GetEventPollsQuery, IEntityQuerier<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePoll, LivePollDTO, LivePollDTOMapper, Result |
| 10 | `GetOpenPollsHandler` | MMCA.ADC.Engagement.Application | 11 | Error, GetOpenPollsQuery, IEntityQuerier<TEntity, TIdentifierType>, IEventLiveValidationService, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePoll, LivePollResultsBuilder, LivePollResultsDTO, LivePollStatus, Result |
| 10 | `GetPollResultsHandler` | MMCA.ADC.Engagement.Application | 13 | Error, GetPollResultsQuery, IEntityReader<TEntity, TIdentifierType>, IEventLiveValidationService, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePoll, LivePollAuthorization, LivePollResultsBuilder, LivePollResultsDTO, LivePollStatus, Result, SessionLiveInfo |
| 10 | `GetSessionManagePollsHandler` | MMCA.ADC.Engagement.Application | 9 | GetSessionManagePollsQuery, IEventLiveValidationService, IQueryHandler<in TQuery, TResult>, IUnitOfWork, LivePoll, LivePollAuthorization, LivePollDTO, LivePollDTOMapper, Result |
| 10 | `LivePollNavigationPopulator` | MMCA.ADC.Engagement.Application | 5 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, DeclarativeNavigationPopulator<TEntity>, IUnitOfWork, LivePoll, LivePollOption |
| 10 | `LivePollOptionNavigationPopulator` | MMCA.ADC.Engagement.Application | 5 | DeclarativeNavigationPopulator<TEntity>, FKNavigationDescriptor<TEntity, TChild, TChildId>, IUnitOfWork, LivePoll, LivePollOption |
| 10 | `LivePollVoteChangedHandler` | MMCA.ADC.Engagement.Application | 9 | BestEffort, IDomainEventHandler<in TDomainEvent>, ILiveChannelPublishQueue, IUnitOfWork, LiveChannelPublishWorkItem, LivePoll, LivePollChannel, LivePollResultsBuilder, LivePollVoteChanged |
| 10 | `OpenLivePollHandler` | MMCA.ADC.Engagement.Application | 11 | IEventLiveValidationService, ILiveChannelPublishQueue, IUnitOfWork, LiveChannelPublishWorkItem, LivePoll, LivePollAuthorization, LivePollChannel, LivePollOpenedPayload, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, OpenLivePollCommand, Result |
| 10 | `PointsAwarder` | MMCA.ADC.Engagement.Application | 8 | IPointsAwarder, IUniqueConstraintViolationDetector, IUnitOfWork, PointsActivityType, PointsAwarder, PointsEntry, PointsSettings, Result |
| 10 | `LivePollDTOMapperTests` | MMCA.ADC.Engagement.Application.Tests | 3 | LivePoll, LivePollDTOMapper, LivePollStatus |
| 10 | `LivePollResultsBuilderTests` | MMCA.ADC.Engagement.Application.Tests | 9 | AuditableBaseEntity<TIdentifierType>, CountingQueryableExecutor, InMemoryQueryableExecutor, IQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, LivePoll, LivePollResultsBuilder, LivePollVote |
| 10 | `CheckIn` | MMCA.ADC.Engagement.Domain | 7 | AttendeeCheckedIn, AuditableAggregateRootEntity<TIdentifierType>, CheckInInvariants, CheckInScope, CheckInScopeNames, IAuditedEntity, Result |
| 10 | `CheckInScopeNamesTests` | MMCA.ADC.Engagement.Shared.Tests | 2 | CheckInScope, CheckInScopeNames |
| 10 | `CheckInScan` | MMCA.ADC.Engagement.UI | 20 | AttendeeSummary, BadgePayload, CheckInAttendeeRequest, CheckInResultDTO, CheckInScope, CheckInService, ErrorType, IAttendeeLookupService, IBarcodeScannerService, ICheckInUIService, ILiveEventUIService, ISessionLookupService, IToastService, LiveEventContext, LiveEventService, ManualCheckInRequest, Result, ScanOutcome, ScanOutcomeKind, SessionInfo |
| 10 | `HappeningNow` | MMCA.ADC.Engagement.UI | 18 | ErrorType, IHapticFeedbackService, ILiveEventUIService, ILivePollUIService, INowNextService, IToastService, LiveBroadcastPatch, LiveChannelSubscription, LiveEventContext, LiveEventService, LivePollChannel, LivePollDTO, LivePollResultsDTO, NotificationHubService, NotificationState, NowNextSessionInfo, Result, RoleNames |
| 10 | `LiveEventListener` | MMCA.ADC.Engagement.UI | 10 | EngagementRoutePaths, IAccessibilityAnnouncer, IBatteryStatusService, ILiveEventUIService, IToastService, LiveEventService, LivePollChannel, LivePollOpenedPayload, NotificationHubService, ToastSeverity |
| 10 | `OrganizerAttendance` | MMCA.ADC.Engagement.UI | 8 | AttendanceStatsDTO, CheckInService, ICheckInUIService, ILiveEventUIService, ISessionLookupService, LiveEventService, SessionAttendanceDTO, SessionAttendanceRow |
| 10 | `LiveEventServiceTests` | MMCA.ADC.Engagement.UI.Tests | 7 | CapturingHttpMessageHandler, EventDTO, FakeTimeProvider, HttpTestDoubles, LiveEventService, PagedCollectionResult<T>, PaginationMetadata |
| 10 | `UsersControllerTests` | MMCA.ADC.Identity.API.Tests | 15 | DeleteUserCommand, Error, GetUserAvatarQuery, GetUsersQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, PaginationMetadata, RemoveUserAvatarCommand, Result, SetUserAvatarCommand, UserAvatarDTO, UserListDTO, UsersController |
| 10 | `ExportUserDataRegistrationTests` | MMCA.ADC.Identity.Application.Tests | 10 | ClassReference, ClassReference, EngagementUserDataExportSection, ExportUserDataHandler, ExportUserDataQuery, IQueryHandler<in TQuery, TResult>, IUserDataExportSection, NotificationUserDataExportSection, Result, UserDataExportDTO |
| 10 | `SpeakerLinkedToUserHandlerTests` | MMCA.ADC.Identity.Application.Tests | 8 | Fakes, InMemoryRepository<TEntity, TIdentifierType>, IUnitOfWork, RecordingUnitOfWork, SpeakerLinkedToUser, SpeakerLinkedToUserHandler, User, UserRole |
| 10 | `SpeakerUnlinkedFromUserHandlerTests` | MMCA.ADC.Identity.Application.Tests | 8 | Fakes, InMemoryRepository<TEntity, TIdentifierType>, IUnitOfWork, RecordingUnitOfWork, SpeakerUnlinkedFromUser, SpeakerUnlinkedFromUserHandler, User, UserRole |
| 10 | `DependencyInjection` | MMCA.ADC.Identity.Contracts | 3 | AttendeeQueryService, AttendeeQueryServiceGrpcAdapter, IAttendeeQueryService |
| 10 | `DependencyInjection` | MMCA.ADC.Notification.Contracts | 5 | ILiveChannelPublisher, IUserNotificationExportService, LiveChannelPublisherGrpcAdapter, UserNotificationExportService, UserNotificationExportServiceGrpcAdapter |
| 10 | `AttendeesGrpcServiceTests` | MMCA.ADC.Services.Tests | 5 | AttendeeQueryService, AttendeesGrpcService, FakeServerCallContext, GrpcCalls, IAttendeeQueryService |
| 10 | `BookmarkCountsGrpcServiceTests` | MMCA.ADC.Services.Tests | 6 | BookmarkCountService, BookmarkCountServiceGrpcAdapter, BookmarkCountsGrpcService, FakeServerCallContext, GrpcCalls, IBookmarkCountService |
| 10 | `SessionBookmarkValidationServiceGrpcAdapterTests` | MMCA.ADC.Services.Tests | 4 | Error, GrpcCalls, ISessionBookmarkValidationService, SessionBookmarkValidationService |
| 10 | `UserNotificationExportGrpcServiceTests` | MMCA.ADC.Services.Tests | 4 | FakeServerCallContext, IUserNotificationExportService, UserNotificationExportGrpcService, UserNotificationExportItemDTO |
| 10 | `UserNotificationExportServiceGrpcAdapterTests` | MMCA.ADC.Services.Tests | 3 | UserNotificationExportItemDTO, UserNotificationExportService, UserNotificationExportServiceGrpcAdapter |
| 10 | `ADCHomePageContent` | MMCA.ADC.UI | 2 | ADCHome, IHomePageContent |
| 10 | `NowNextWidgetProvider` | MMCA.ADC.UI | 3 | MainActivity, NowNextSession, NowNextSnapshot |
| 10 | `AiServiceCollectionExtensions` | MMCA.Common.AI | 11 | AiProviderValidator, AiSettings, AiUsageMeter, BoundedChatClient, GuardrailChatClient, IAiProviderFactory, IChatGuardrail, IChatRequestRedactor, IChatToolPolicy, PromptTaggingChatClient, UsageRecordingChatClient |
| 10 | `AiProviderSelectionTests` | MMCA.Common.AI.Tests | 6 | AiSettings, BoundedChatClient, FakeProviderFactory, IAiProviderFactory, PromptTaggingChatClient, StubChatClient |
| 10 | `PromptTaggingChatClientTests` | MMCA.Common.AI.Tests | 4 | AiUsageMeter, PromptContract, PromptTaggingChatClient, StubChatClient |
| 10 | `DataExportControllerBase<TQuery>` | MMCA.Common.API | 9 | ApiControllerBase, CurrentUserService, Error, ICurrentUserService, IQueryHandler<in TQuery, TResult>, IUserOwnedRequest, PrivacyFeatures, Result, UserDataExportDTO |
| 10 | `DependencyInjection` | MMCA.Common.API | 1 | NotificationsController |
| 10 | `ICookieSessionRefresher` | MMCA.Common.API | 2 | SessionRefreshOutcome, SessionTokenResult |
| 10 | `LegalAcceptanceControllerBase` | MMCA.Common.API | 10 | AcceptLegalTermsRequest, ApiControllerBase, CurrentUserService, Error, ICurrentUserService, ILegalAcceptanceService, LegalAcceptanceDTO, LegalAcceptanceOptions, LegalAcceptancePolicy, LegalAcceptanceRoutes |
| 10 | `MiddlewarePipelineBuilder` | MMCA.Common.API | 8 | CommonForwardedHeaders, CorrelationIdMiddleware, MiddlewarePipelineStep, MiddlewarePipelineStepNames, SoftDeletedUserMiddleware, TenantResolutionMiddleware, WebApplicationBuilderExtensions, WebApplicationExtensions |
| 10 | `OwnerOrAdminFilter` | MMCA.Common.API | 4 | AllowMissingOwnerAttribute, ICurrentUserService, OwnerOrAdminFilterOptions, OwnershipHelper |
| 10 | `RolesAdminControllerBase` | MMCA.Common.API | 8 | AdministrationPermissions, ApiControllerBase, CurrentUserService, ICurrentUserService, IRoleAdministrationService, PermissionCatalogResponse, RolePermissionsResponse, SetRolePermissionsRequest |
| 10 | `WebApplicationExtensions` | MMCA.Common.API | 2 | MiddlewarePipelineBuilder, SupportedCultures |
| 10 | `AggregateRootEntityControllerBaseTests` | MMCA.Common.API.Tests | 11 | ApplicationSettings, DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, TestAggDTO, TestAggregateEntity, TestAggregateRootController, TestCreateRequest |
| 10 | `CorrelationIdMiddlewareTests` | MMCA.Common.API.Tests | 2 | CorrelationIdMiddleware, ICorrelationContext |
| 10 | `DevicesControllerTests` | MMCA.Common.API.Tests | 6 | DeviceInstallationRequest, DevicesController, Error, ICurrentUserService, IPushDeviceRegistrar, Result |
| 10 | `NotificationInboxControllerTests` | MMCA.Common.API.Tests | 13 | Error, GetMyNotificationsQuery, GetUnreadNotificationCountQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, InboxController, IQueryHandler<in TQuery, TResult>, MarkAllNotificationsReadCommand, MarkNotificationReadCommand, PagedCollectionResult<T>, PaginationMetadata, Result, UserNotificationDTO |
| 10 | `NotificationsControllerTests` | MMCA.Common.API.Tests | 13 | Error, GetNotificationHistoryQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IdempotencyHeaders, IQueryHandler<in TQuery, TResult>, NotificationsController, PagedCollectionResult<T>, PaginationMetadata, PushNotificationDTO, Result, SendPushNotificationCommand, SendPushNotificationRequest |
| 10 | `OwnershipHelperGateTests` | MMCA.Common.API.Tests | 4 | Error, ICurrentUserService, OwnershipHelper, Result |
| 10 | `OwnershipHelperTests` | MMCA.Common.API.Tests | 3 | ICurrentUserService, OwnershipHelper, TestOwnerSpecification |
| 10 | `SoftDeletedUserMiddlewareTests` | MMCA.Common.API.Tests | 5 | ICacheService, ICurrentUserService, ISoftDeletedUserValidator, SoftDeletedUserCache, SoftDeletedUserMiddleware |
| 10 | `TestCrudController` | MMCA.Common.API.Tests | 11 | CrudEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>, DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, TestAggregateEntity, TestCreateRequest, TestCrudDTO, TestUpdateRequest, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 10 | `AuthorizationCommandDecorator<TCommand, TResult>` | MMCA.Common.Application | 6 | AuthorizationGate, Error, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IPermissionRegistry, ResultFailureFactory |
| 10 | `AuthorizationQueryDecorator<TQuery, TResult>` | MMCA.Common.Application | 6 | AuthorizationGate, Error, ICurrentUserService, IPermissionRegistry, IQueryHandler<in TQuery, TResult>, ResultFailureFactory |
| 10 | `DependencyInjection` | MMCA.Common.Application | 30 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, GetMyNotificationsHandler, GetMyNotificationsQuery, GetNotificationHistoryHandler, GetNotificationHistoryQuery, GetUnreadNotificationCountHandler, GetUnreadNotificationCountQuery, ICommandHandler<in TCommand, TResult>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, INavigationPopulator<in TEntity>, INotificationRecipientProvider, IQueryHandler<in TQuery, TResult>, MarkAllNotificationsReadCommand, MarkAllNotificationsReadHandler, MarkNotificationReadCommand, MarkNotificationReadHandler, NullNavigationPopulator<TEntity>, NullNotificationRecipientProvider …(+10) |
| 10 | `RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>` | MMCA.Common.Application | 3 | AuditableAggregateRootEntity<TIdentifierType>, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType> |
| 10 | `UpdateEntityCommandHandler<TCommand, TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>` | MMCA.Common.Application | 9 | AuditableAggregateRootEntity<TIdentifierType>, IBaseDTO<TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, MutationContext, Result, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 10 | `UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>` | MMCA.Common.Application | 8 | AuditableAggregateRootEntity<TIdentifierType>, IBaseDTO<TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Result, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 10 | `AuthenticationServiceBaseTests` | MMCA.Common.Application.Tests | 21 | AuthClaimTypes, AuthenticationResponse, AuthenticationValidators, Error, ErrorType, FixedTimeProvider, ILoginProtectionService, InMemoryRefreshSessionStore, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, LoginRequest, RefreshSession, RefreshSessionSettings, RefreshTokenRequest, RegisterRequest, Result, ServiceMocks, TestAuthenticationService …(+1) |
| 10 | `ChangePasswordHandlerBaseTests` | MMCA.Common.Application.Tests | 14 | ChangePasswordRequest, Error, ErrorType, HandlerMocks, ILoginProtectionService, IPasswordHasher, IRefreshSessionStore, IRepository<TEntity, TIdentifierType>, IUnitOfWork, RefreshSession, Result, TestChangePasswordCommand, TestChangePasswordHandler, TestIdentityUser |
| 10 | `ChangePreferencesHandlerBaseTests` | MMCA.Common.Application.Tests | 10 | ChangePreferencesRequest, Error, ErrorType, HandlerMocks, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, TestChangePreferencesCommand, TestChangePreferencesHandler, TestIdentityUser |
| 10 | `ChildNavigationDescriptorTests` | MMCA.Common.Application.Tests | 6 | ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>, INavigationDescriptor<in TEntity>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderEntity, OrderLineEntity |
| 10 | `CreateEntityHandlerBaseTests` | MMCA.Common.Application.Tests | 13 | Error, ErrorType, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderCreateRequest, OrderDTO, RefusingPrepareCreateOrderHandler, Result, RewritingPrepareCreateOrderHandler, TestCreateOrderHandler |
| 10 | `CurrentUserServiceExtensionsTests` | MMCA.Common.Application.Tests | 4 | CurrentUserServiceExtensions, ErrorType, ICurrentUserService, Result |
| 10 | `DeclarativeNavigationPopulatorTests` | MMCA.Common.Application.Tests | 7 | DeclarativeNavigationPopulator<TEntity>, INavigationDescriptor<in TEntity>, IUnitOfWork, NavigationMetadata, NavigationPopulatorStubEntity, NavigationPropertyInfo, NavigationType |
| 10 | `DeleteEntityHandlerExtensionTests` | MMCA.Common.Application.Tests | 9 | DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, Error, ErrorType, IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, Result, TestDeleteOrderHandler |
| 10 | `DeleteUserHandlerBaseTests` | MMCA.Common.Application.Tests | 11 | Error, ErrorType, HandlerMocks, ICacheService, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, SoftDeletedUserCache, TestDeleteUserCommand, TestDeleteUserHandler, TestHidingDeleteUser |
| 10 | `EmailConfirmationHandlerBaseTests` | MMCA.Common.Application.Tests | 14 | ConfirmableUser, ConfirmEmailRequest, EmailConfirmationErrors, EmailConfirmationSettings, Error, ErrorType, HandlerMocks, IRepository<TEntity, TIdentifierType>, Result, SendEmailConfirmationRequest, TestConfirmEmailCommand, TestConfirmEmailHandler, TestSendConfirmationCommand, TestSendConfirmationHandler |
| 10 | `EntityQueryServiceContractTests` | MMCA.Common.Application.Tests | 11 | AccountDTO, AccountEntity, BaseLookup<TIdentifierType>, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, NarrowedQueryService |
| 10 | `EntityQueryServiceTests` | MMCA.Common.Application.Tests | 17 | BaseLookup<TIdentifierType>, EntityQueryParameters<TEntity>, EntityQueryPipeline, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, FakeEntity, FakeEntityDTO, FakeEntityDTOMapper, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, InMemoryQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, MappedEntityQueryService, NavigationMetadata, TestableEntityQueryService |
| 10 | `ExportUserDataHandlerBaseTests` | MMCA.Common.Application.Tests | 16 | CancellingSection, ErrorType, FakeTimeProvider, HandlerMocks, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, IUserDataExportSection, RecordingSection, Result, TestExportUserDataHandler, TestExportUserDataQuery, TestIdentityUser, ThrowingSection, UserDataExportDTO, UserDataExportSectionDefaults, UserDataExportSectionResult |
| 10 | `FKNavigationDescriptorTests` | MMCA.Common.Application.Tests | 6 | FKNavigationDescriptor<TEntity, TChild, TChildId>, INavigationDescriptor<in TEntity>, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, ParentEntity, RelatedEntity |
| 10 | `ForgotPasswordHandlerBaseTests` | MMCA.Common.Application.Tests | 8 | Error, ForgotPasswordRequest, HandlerMocks, PasswordResetSettings, Result, TestForgotPasswordCommand, TestForgotPasswordHandler, TestIdentityUser |
| 10 | `GetNotificationHistoryHandlerTests` | MMCA.Common.Application.Tests | 10 | GetNotificationHistoryHandler, GetNotificationHistoryQuery, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUnitOfWork, PagedCollectionResult<T>, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, Result |
| 10 | `GetUserPreferencesHandlerBaseTests` | MMCA.Common.Application.Tests | 9 | ErrorType, GetUserPreferencesQuery, HandlerMocks, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, TestGetUserPreferencesHandler, TestIdentityUser, UserPreferencesResponse |
| 10 | `NotificationDependencyInjectionTests` | MMCA.Common.Application.Tests | 23 | GetMyNotificationsHandler, GetMyNotificationsQuery, GetNotificationHistoryHandler, GetNotificationHistoryQuery, GetUnreadNotificationCountHandler, GetUnreadNotificationCountQuery, ICommandHandler<in TCommand, TResult>, INavigationPopulator<in TEntity>, INotificationRecipientProvider, IQueryHandler<in TQuery, TResult>, MarkAllNotificationsReadCommand, MarkAllNotificationsReadHandler, MarkNotificationReadCommand, MarkNotificationReadHandler, NullNotificationRecipientProvider, PagedCollectionResult<T>, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, Result …(+3) |
| 10 | `PushNotificationDTOProjectorTests` | MMCA.Common.Application.Tests | 6 | IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, PushNotificationDTOProjector, PushNotificationStatus |
| 10 | `RefreshSessionManagementTests` | MMCA.Common.Application.Tests | 21 | AuthClaimTypes, AuthenticationResponse, AuthenticationValidators, ErrorType, FixedTimeProvider, ILoginProtectionService, InMemoryRefreshSessionStore, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, LoginRequest, RefreshSession, RefreshSessionSettings, RefreshSessionSummaryResponse, RefreshTokenRequest, RegisterRequest, Result, ServiceMocks, SessionAwareAuthenticationService …(+1) |
| 10 | `ResetPasswordHandlerBaseTests` | MMCA.Common.Application.Tests | 16 | Email, Error, ErrorType, HandlerMocks, ILoginProtectionService, IPasswordHasher, IPasswordResetTokenService, IRefreshSessionStore, IRepository<TEntity, TIdentifierType>, IUnitOfWork, RefreshSession, ResetPasswordRequest, Result, TestIdentityUser, TestResetPasswordCommand, TestResetPasswordHandler |
| 10 | `SendPushNotificationHandlerTests` | MMCA.Common.Application.Tests | 17 | HandlerMocks, INativePushSender, INotificationRecipientProvider, IPushNotificationSender, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, ITransactional, IUnitOfWork, PushNotification, PushNotificationDTO, PushNotificationDTOMapper, PushNotificationStatus, Result, SendPushNotificationCommand, SendPushNotificationHandler, SendPushNotificationRequest, UserNotification |
| 10 | `TestNoMutationHandler` | MMCA.Common.Application.Tests | 4 | IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, OrderAggregate, RenameOrderCommand |
| 10 | `TestRenameOrderDTOHandler` | MMCA.Common.Application.Tests | 7 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, OrderAggregate, OrderDTO, RenameOrderCommand, Result |
| 10 | `TestRenameOrderHandler` | MMCA.Common.Application.Tests | 5 | IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, OrderAggregate, RenameOrderCommand, Result |
| 10 | `TestSkippingRenameHandler` | MMCA.Common.Application.Tests | 6 | IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, MutationContext, OrderAggregate, RenameOrderCommand, Result |
| 10 | `TransitiveSavingHandler` | MMCA.Common.Architecture.Tests | 3 | FixtureDomainEvent, IDomainEventHandler<in TDomainEvent>, PointsAwarder |
| 10 | `GatewayCorrelationExtensions` | MMCA.Common.Aspire | 1 | GatewayCorrelationMiddleware |
| 10 | `ProbeTelemetryFilterProcessor` | MMCA.Common.Aspire | 3 | Activity, HealthEndpointPaths, ProbeTelemetryFilter |
| 10 | `GatewayCorrelationMiddlewareTests` | MMCA.Common.Aspire.Tests | 3 | Activity, GatewayCorrelationMiddleware, RecordingHttpResponseFeature |
| 10 | `OutboxPollFilterProcessorTests` | MMCA.Common.Aspire.Tests | 2 | Activity, OutboxPollFilterProcessor |
| 10 | `CapturedState` | MMCA.Common.Infrastructure | 3 | AggregateCapture, IDomainEvent, OutboxMessage |
| 10 | `CapturingMessageBus` | MMCA.Common.Infrastructure.Tests | 8 | ICorrelationContext, ICurrentUserService, IIntegrationEvent, IMessageBus, ITenantContext, Observation, RecordingScopedHandler, TestIntegrationEvent |
| 10 | `CurrentUserServiceAdditionalTests` | MMCA.Common.Infrastructure.Tests | 3 | AuthClaimTypes, CurrentUserService, User |
| 10 | `CurrentUserServiceTests` | MMCA.Common.Infrastructure.Tests | 6 | AuthClaimTypes, CurrentUserService, ICurrentUserService, NullUserService, RoleOnlyService, User |
| 10 | `OutboxMessageTests` | MMCA.Common.Infrastructure.Tests | 7 | NamedDomainEvent, OrderedDomainEvent, OutboxMessage, OutboxOrigin, Payload, TestDomainEvent, TestDomainEventWithData |
| 10 | `PushNotificationProjectionTranslationTests` | MMCA.Common.Infrastructure.Tests | 5 | ProjectionTestDbContext, PushNotification, PushNotificationDTOMapper, PushNotificationDTOProjector, PushNotificationStatus |
| 10 | `DecoratorPipelineOrderTests` | MMCA.Common.Testing.Tests | 11 | DecoratorPipelineOrderTests, DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>, ICacheService, ICorrelationContext, ICurrentUserService, IPermissionRegistry, IUnitOfWork, PingCommand, PingCommandHandler, PingQuery, Result |
| 10 | `DependencyInjection` | MMCA.Common.UI | 54 | ApiSettings, ApiUserPreferenceReader, ApiUserPreferenceWriter, AuthDelegatingHandler, AuthUIService, CultureDelegatingHandler, DefaultOAuthUISettings, EmailConfirmationUIService, EndpointCultureApplier, HttpResilienceDefaults, IAppDialogService, IAuthUIService, ICultureApplier, IEmailConfirmationUIService, IEntityService<TEntityDTO, TIdentifierType>, IFormFactor, ILegalAcceptanceUIService, InvariantMudLocalizationInterceptor, IOAuthUISettings, IPublicLinkBuilder …(+34) |
| 10 | `GalleryHostFixture` | MMCA.Common.UI.E2E.Tests | 2 | E2ETestConfiguration, GalleryHost |
| 10 | `GalleryProcess` | MMCA.Common.UI.E2E.Tests | 1 | GalleryHost |
| 11 | `ActivitiesControllerTests` | MMCA.ADC.Conference.API.Tests | 21 | ActivitiesController, Activity, ActivityCreateRequest, ActivityDTO, ActivityUpdateRequest, ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetPublicActivityFilterQuery, HasPermissionAttribute, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, Result, RoleNames, Specification<TEntity, TIdentifierType>, SupportsIfMatchAttribute …(+1) |
| 11 | `ConditionalWriteConventionTests` | MMCA.ADC.Conference.API.Tests | 11 | ActivitiesController, ConferenceCategoriesController, EventLifecycleController, EventsController, PartnersController, QuestionsController, SessionAssetsController, SessionsController, SpeakersController, SponsorsController, SupportsIfMatchAttribute |
| 11 | `EntityExportAuthorizationTests` | MMCA.ADC.Conference.API.Tests | 14 | ActivitiesController, ConferencePermissions, EventQuestionAnswersController, EventsController, EventSpeakersController, HasPermissionAttribute, PartnersController, SessionCategoryItemsController, SessionQuestionAnswersController, SessionsController, SessionSpeakersController, SpeakerCategoryItemsController, SpeakersController, SponsorsController |
| 11 | `EventQuestionAnswersControllerTests` | MMCA.ADC.Conference.API.Tests | 22 | AddEventQuestionAnswerCommand, AddEventQuestionAnswerRequest, BatchAddEventQuestionAnswersCommand, BatchAddEventQuestionAnswersRequest, CollectionResult<T>, Error, EventQuestionAnswer, EventQuestionAnswerDTO, EventQuestionAnswersController, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, OwnedByUserSpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, RemoveEventQuestionAnswerCommand, Result, RoleNames, Specification<TEntity, TIdentifierType> …(+2) |
| 11 | `PartnersControllerTests` | MMCA.ADC.Conference.API.Tests | 22 | ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetPublicPartnerFilterQuery, HasPermissionAttribute, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, Partner, PartnerCreateRequest, PartnerDTO, PartnersController, PartnerType, PartnerUpdateRequest, Result, RoleNames, Specification<TEntity, TIdentifierType> …(+2) |
| 11 | `SessionCategoryItemsControllerTests` | MMCA.ADC.Conference.API.Tests | 19 | AddSessionCategoryItemCommand, AddSessionCategoryItemRequest, BaseLookup<TIdentifierType>, Error, GetPublicSessionCategoryItemFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, RemoveSessionCategoryItemCommand, Result, RoleNames, SessionCategoryItem, SessionCategoryItemDTO, SessionCategoryItemsController, Specification<TEntity, TIdentifierType> |
| 11 | `SessionQuestionAnswersControllerTests` | MMCA.ADC.Conference.API.Tests | 22 | AddSessionQuestionAnswerCommand, AddSessionQuestionAnswerRequest, BatchAddSessionQuestionAnswersCommand, BatchAddSessionQuestionAnswersRequest, CollectionResult<T>, Error, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, OwnedByUserSpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, RemoveSessionQuestionAnswerCommand, Result, RoleNames, SessionQuestionAnswer, SessionQuestionAnswerDTO, SessionQuestionAnswersController, Specification<TEntity, TIdentifierType> …(+2) |
| 11 | `SessionsControllerTests` | MMCA.ADC.Conference.API.Tests | 27 | BaseLookup<TIdentifierType>, CollectionResult<T>, DeleteEntityCommand<TEntity, TIdentifierType>, Error, Event, EventDTO, GetPublicSessionFilterQuery, GetSessionsBySpeakerFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, PaginationMetadata, Result, RoleNames, Session, SessionCreateRequest …(+7) |
| 11 | `SessionSpeakersControllerTests` | MMCA.ADC.Conference.API.Tests | 19 | AddSessionSpeakerCommand, AddSessionSpeakerRequest, BaseLookup<TIdentifierType>, Error, GetPublicSessionSpeakerFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, RemoveSessionSpeakerCommand, Result, RoleNames, SessionSpeaker, SessionSpeakerDTO, SessionSpeakersController, Specification<TEntity, TIdentifierType> |
| 11 | `SpeakersControllerTests` | MMCA.ADC.Conference.API.Tests | 26 | AndSpecification<TEntity, TIdentifierType>, BaseLookup<TIdentifierType>, ConcurrencyETag, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetPublicSpeakerFilterQuery, GetSpeakersByEventFilterQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IPermissionRegistry, IQueryHandler<in TQuery, TResult>, ISpecification<TEntity, TIdentifierType>, PagedCollectionResult<T>, PermissionRegistry, Result, RoleNames, Speaker, SpeakerCreateRequest …(+6) |
| 11 | `SponsorsControllerTests` | MMCA.ADC.Conference.API.Tests | 22 | ConferencePermissions, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetPublicSponsorFilterQuery, HasPermissionAttribute, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, PagedCollectionResult<T>, Result, RoleNames, Specification<TEntity, TIdentifierType>, Sponsor, SponsorCreateRequest, SponsorDTO, SponsorsController, SponsorTier, SponsorUpdateRequest …(+2) |
| 11 | `GetPublicActivityFilterHandler` | MMCA.ADC.Conference.Application | 8 | Activity, GetPublicActivityFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicConferenceVisibility, Result, Specification<TEntity, TIdentifierType> |
| 11 | `GetPublicEventSpeakerFilterHandler` | MMCA.ADC.Conference.Application | 8 | EventSpeaker, GetPublicEventSpeakerFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicConferenceVisibility, Result, Specification<TEntity, TIdentifierType> |
| 11 | `GetPublicPartnerFilterHandler` | MMCA.ADC.Conference.Application | 8 | GetPublicPartnerFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Partner, PublicConferenceVisibility, Result, Specification<TEntity, TIdentifierType> |
| 11 | `GetPublicRoomFilterHandler` | MMCA.ADC.Conference.Application | 8 | GetPublicRoomFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicConferenceVisibility, Result, Room, Specification<TEntity, TIdentifierType> |
| 11 | `GetPublicSessionCategoryItemFilterHandler` | MMCA.ADC.Conference.Application | 8 | GetPublicSessionCategoryItemFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicConferenceVisibility, Result, SessionCategoryItem, Specification<TEntity, TIdentifierType> |
| 11 | `GetPublicSessionSpeakerFilterHandler` | MMCA.ADC.Conference.Application | 8 | GetPublicSessionSpeakerFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicConferenceVisibility, Result, SessionSpeaker, Specification<TEntity, TIdentifierType> |
| 11 | `GetPublicSpeakerCategoryItemFilterHandler` | MMCA.ADC.Conference.Application | 8 | GetPublicSpeakerCategoryItemFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicConferenceVisibility, Result, SpeakerCategoryItem, Specification<TEntity, TIdentifierType> |
| 11 | `GetPublicSpeakerFilterHandler` | MMCA.ADC.Conference.Application | 8 | GetPublicSpeakerFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicConferenceVisibility, Result, Speaker, Specification<TEntity, TIdentifierType> |
| 11 | `GetPublicSponsorFilterHandler` | MMCA.ADC.Conference.Application | 8 | GetPublicSponsorFilterQuery, InlineSpecification<TEntity, TIdentifierType>, IQueryHandler<in TQuery, TResult>, IUnitOfWork, PublicConferenceVisibility, Result, Specification<TEntity, TIdentifierType>, Sponsor |
| 11 | `RemoveCategoryItemHandler` | MMCA.ADC.Conference.Application | 6 | Category, IRepository<TEntity, TIdentifierType>, IUnitOfWork, RemoveCategoryItemCommand, RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>, Result |
| 11 | `RemoveEventSpeakerHandler` | MMCA.ADC.Conference.Application | 5 | Event, IUnitOfWork, RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>, RemoveEventSpeakerCommand, Result |
| 11 | `RemoveSessionCategoryItemHandler` | MMCA.ADC.Conference.Application | 6 | IRepository<TEntity, TIdentifierType>, IUnitOfWork, RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>, RemoveSessionCategoryItemCommand, Result, Session |
| 11 | `RemoveSessionSpeakerHandler` | MMCA.ADC.Conference.Application | 6 | IRepository<TEntity, TIdentifierType>, IUnitOfWork, RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>, RemoveSessionSpeakerCommand, Result, Session |
| 11 | `RemoveSpeakerCategoryItemHandler` | MMCA.ADC.Conference.Application | 5 | IUnitOfWork, RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>, RemoveSpeakerCategoryItemCommand, Result, Speaker |
| 11 | `SessionEntityQueryService` | MMCA.ADC.Conference.Application | 8 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IUnitOfWork, Session, SessionDTO, SessionDTOMapper |
| 11 | `UpdateSpeakerHandler` | MMCA.ADC.Conference.Application | 8 | IUnitOfWork, Speaker, SpeakerDTO, SpeakerDTOMapper, SpeakerUpdateApplier, SpeakerUpdateRequest, UpdateEntityCommandHandler<TCommand, TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>, UpdateSpeakerCommand |
| 11 | `ActivityCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | ActivityCreateRequest, ActivityCreateRequestValidator, ActivityInvariants |
| 11 | `AddSessionCategoryItemCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddSessionCategoryItemCommand, AddSessionCategoryItemCommandValidator |
| 11 | `AddSessionQuestionAnswerCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddSessionQuestionAnswerCommand, AddSessionQuestionAnswerCommandValidator |
| 11 | `AddSessionSpeakerCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 2 | AddSessionSpeakerCommand, AddSessionSpeakerCommandValidator |
| 11 | `BatchAddSessionQuestionAnswersCommandValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | BatchAddSessionQuestionAnswersCommand, BatchAddSessionQuestionAnswersCommandValidator, BatchSessionQuestionAnswerItem |
| 11 | `ExportEventCalendarHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, Event, ExportEventCalendarHandler, ExportEventCalendarQuery, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Session, SessionBuilder |
| 11 | `ExportSessionCalendarHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, Event, ExportSessionCalendarHandler, ExportSessionCalendarQuery, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Session, SessionBuilder |
| 11 | `GetNowNextHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | ErrorType, Event, FakeTimeProvider, GetNowNextHandler, GetNowNextQuery, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Session, SessionBuilder, SessionStatuses |
| 11 | `PartnerCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 4 | PartnerCreateRequest, PartnerCreateRequestValidator, PartnerInvariants, PartnerType |
| 11 | `SessionCreateRequestMapperTests` | MMCA.ADC.Conference.Application.Tests | 2 | SessionCreateRequest, SessionCreateRequestMapper |
| 11 | `SessionCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 3 | SessionCreateRequest, SessionCreateRequestValidator, SessionInvariants |
| 11 | `SessionDTOMapperTests` | MMCA.ADC.Conference.Application.Tests | 7 | Event, Session, SessionBuilder, SessionCategoryItemDTOMapper, SessionDTOMapper, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper |
| 11 | `SponsorCreateRequestValidatorTests` | MMCA.ADC.Conference.Application.Tests | 4 | SponsorCreateRequest, SponsorCreateRequestValidator, SponsorInvariants, SponsorTier |
| 11 | `EventLiveValidationServiceGrpcAdapter` | MMCA.ADC.Conference.Contracts | 9 | Error, EventLiveInfo, EventLiveValidationService, IEventLiveValidationService, QuestionModerationDefault, Result, RoomSessionInfo, SessionLiveInfo, SponsorLiveInfo |
| 11 | `EventLiveValidationGrpcService` | MMCA.ADC.Conference.Service | 3 | EventLiveValidationService, IEventLiveValidationService, QuestionModerationDefault |
| 11 | `PublicSessionList` | MMCA.ADC.Conference.UI | 17 | BookmarkService, ConferenceRoutePaths, DataGridListPageBase<TDto>, EventService, IEventUIService, IPublicSessionScheduleService, ISessionBookmarkUIService, ISpeakerLookupService, NewestLoadTracker<T>, PublicSessionBookmarkState, PublicSessionEventCatalog, PublicSessionEventScope, PublicSessionListFilterState, PublicSessionListView, Result, SessionDTO, SessionSchedulePageRequest |
| 11 | `EventFilteredListPageBaseTests` | MMCA.ADC.Conference.UI.Tests | 9 | BunitTestBase, Error, EventInfo, IEventLookupService, ISponsorUIService, Result, RoleNames, SponsorList, TestPrincipal |
| 11 | `EventFilteredListPagePrerenderTests` | MMCA.ADC.Conference.UI.Tests | 7 | BunitTestBase, EventInfo, IEventLookupService, ISponsorUIService, RoleNames, SponsorList, TestPrincipal |
| 11 | `PublicSpeakerDetailTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, Error, EventDTO, IEventUIService, ISessionUIService, ISpeakerUIService, PublicSpeakerDetail, Result, SessionDTO, SpeakerDTO |
| 11 | `PublicSpeakerListCardGridTests` | MMCA.ADC.Conference.UI.Tests | 7 | BunitTestBase, EventInfo, IEventLookupService, InfiniteScrollSentinel, ISpeakerUIService, PublicSpeakerList, SpeakerDTO |
| 11 | `PublicSpeakerListEventFilterTests` | MMCA.ADC.Conference.UI.Tests | 7 | BunitTestBase, EventInfo, IEventLookupService, ISpeakerUIService, PublicSpeakerList, RoleNames, TestPrincipal |
| 11 | `SessionListCurrentEventClockTests` | MMCA.ADC.Conference.UI.Tests | 12 | BunitTestBase, Event, EventDTO, FixedTimeProvider, IEventUIService, ISessionUIService, ISpeakerLookupService, Result, RoleNames, SessionList, SpeakerInfo, TestPrincipal |
| 11 | `SessionListEventFilterTests` | MMCA.ADC.Conference.UI.Tests | 11 | BunitTestBase, Event, EventDTO, IEventUIService, ISessionUIService, ISpeakerLookupService, Result, RoleNames, SessionList, SpeakerInfo, TestPrincipal |
| 11 | `SessionListStatusChipTests` | MMCA.ADC.Conference.UI.Tests | 12 | BunitTestBase, EventDTO, IEventUIService, ISessionUIService, ISpeakerLookupService, Result, RoleNames, SessionDTO, SessionList, SessionStatuses, SpeakerInfo, TestPrincipal |
| 11 | `BookmarksController` | MMCA.ADC.Engagement.API | 18 | ApiControllerBase, CreateBookmarkRequest, DeleteEntityCommand<TEntity, TIdentifierType>, EngagementFeatures, Error, GetBookmarkedSessionIdsQuery, GetUserBookmarksQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, OwnerOrAdminFilter, PagedCollectionResult<T>, Result, RoleNames, Route, UserSessionBookmark, UserSessionBookmarkDTO |
| 11 | `CheckInDTOMapper` | MMCA.ADC.Engagement.Application | 3 | CheckIn, CheckInDTO, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType> |
| 11 | `CheckInProcessor` | MMCA.ADC.Engagement.Application | 9 | CheckIn, CheckInResultDTO, CheckInScope, Error, IEntityQuerier<TEntity, TIdentifierType>, IEventLiveValidationService, IUnitOfWork, RecordedCheckIn, Result |
| 11 | `GetAttendanceStatsHandler` | MMCA.ADC.Engagement.Application | 8 | AttendanceStatsDTO, CheckIn, CheckInScope, GetAttendanceStatsQuery, IQueryHandler<in TQuery, TResult>, IUnitOfWork, Result, SessionAttendanceDTO |
| 11 | `UserEngagementExportService` | MMCA.ADC.Engagement.Application | 16 | CheckIn, IUnitOfWork, IUserEngagementExportService, LeaderboardOptIn, LivePollVote, PointsEntry, SessionQuestion, SessionQuestionUpvote, UserEngagementBookmarkExportDTO, UserEngagementCheckInExportDTO, UserEngagementExportDTO, UserEngagementPointsEntryExportDTO, UserEngagementPollVoteExportDTO, UserEngagementQuestionUpvoteExportDTO, UserEngagementSubmittedQuestionExportDTO, UserSessionBookmark |
| 11 | `HandlerMocks` | MMCA.ADC.Engagement.Application.Tests | 4 | AttendeeBadge, CheckIn, IEventLiveValidationService, IRepository<TEntity, TIdentifierType> |
| 11 | `LivePollVoteChangedHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 12 | DomainEntityState, InMemoryQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, LivePoll, LivePollChannel, LivePollResultsBuilder, LivePollResultsDTO, LivePollVote, LivePollVoteChanged, LivePollVoteChangedHandler, RecordingQueue |
| 11 | `CheckInTests` | MMCA.ADC.Engagement.Domain.Tests | 4 | AttendeeCheckedIn, CheckIn, CheckInScope, CheckInScopeNames |
| 11 | `EngagementUIModule` | MMCA.ADC.Engagement.UI | 6 | EngagementRoutePaths, IUIModule, LiveEventListener, NavItem, NavSection, RoleNames |
| 11 | `CheckInScanTests` | MMCA.ADC.Engagement.UI.Tests | 13 | AttendeeSearchPanel, AttendeeSummary, BunitComponentTestBase, CheckInScan, IAttendeeLookupService, IBarcodeScannerService, ICheckInUIService, ILiveEventUIService, ISessionLookupService, LiveEventContext, RoleNames, SessionInfo, TestPrincipal |
| 11 | `LiveEventListenerResilienceTests` | MMCA.ADC.Engagement.UI.Tests | 15 | ApiSettings, BunitComponentTestBase, EngagementRoutePaths, IAccessibilityAnnouncer, IBatteryStatusService, ILiveEventUIService, IToastService, ITokenStorageService, LiveEventContext, LiveEventListener, LivePollChannel, NotificationHubService, NullAccessibilityAnnouncer, TestPrincipal, ToastSeverity |
| 11 | `OrganizerAttendanceTests` | MMCA.ADC.Engagement.UI.Tests | 11 | AttendanceStatsDTO, BunitComponentTestBase, ICheckInUIService, ILiveEventUIService, ISessionLookupService, LiveEventContext, OrganizerAttendance, RoleNames, SessionAttendanceDTO, SessionInfo, TestPrincipal |
| 11 | `RoomCheckInTests` | MMCA.ADC.Engagement.UI.Tests | 8 | BunitComponentTestBase, CheckIn, CheckInErrorCodes, ICheckInUIService, RoomCheckIn, RoomCheckInResultDTO, SelfCheckInOutcome<TResult>, TestPrincipal |
| 11 | `AdminRolesController` | MMCA.ADC.Identity.API | 4 | ICurrentUserService, IRoleAdministrationService, RolesAdminControllerBase, Route |
| 11 | `LegalAcceptanceController` | MMCA.ADC.Identity.API | 5 | ICurrentUserService, ILegalAcceptanceService, LegalAcceptanceControllerBase, LegalAcceptanceOptions, Route |
| 11 | `UsersDataExportController` | MMCA.ADC.Identity.API | 7 | DataExportControllerBase<TQuery>, ExportUserDataQuery, ICurrentUserService, IQueryHandler<in TQuery, TResult>, Result, Route, UserDataExportDTO |
| 11 | `EventLiveValidationServiceGrpcAdapterTests` | MMCA.ADC.Services.Tests | 5 | EventLiveValidationService, IEventLiveValidationService, QuestionModerationDefault, Result, SessionLiveInfo |
| 11 | `SessionBookmarksGrpcServiceTests` | MMCA.ADC.Services.Tests | 6 | Error, FakeServerCallContext, ISessionBookmarkValidationService, Result, ResultFailureException, SessionBookmarksGrpcService |
| 11 | `MauiProgram` | MMCA.ADC.UI | 14 | ADCHomePageContent, App, AppActionRouteMap, AppActionsInitializer, ConfigurationOAuthUISettings, DeviceUIModule, DirectApiTokenRefresher, IDeepLinkDispatcher, IHomePageContent, IOAuthUISettings, ITokenRefresher, IUIModule, JwtAuthenticationStateProvider, UIModuleConfiguration |
| 11 | `CookieSessionRefreshMiddleware` | MMCA.Common.API | 1 | ICookieSessionRefresher |
| 11 | `SessionCookieEndpoints` | MMCA.Common.API | 6 | ICookieSessionRefresher, SessionClaimsToken, SessionCookieJar, SessionCookieRequest, SessionCookieSettings, SessionTokenResponse |
| 11 | `SessionCookieJar` | MMCA.Common.API | 3 | JwtSettings, SessionCookieEndpoints, SessionCookieSettings |
| 11 | `CrudEntityControllerBaseTests` | MMCA.Common.API.Tests | 15 | ApplicationSettings, ConcurrencyETag, DeleteEntityCommand<TEntity, TIdentifierType>, EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>, Error, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Result, SupportsIfMatchAttribute, TestAggregateEntity, TestCreateRequest, TestCrudController, TestCrudDTO, TestUpdateRequest, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType> |
| 11 | `DependencyInjectionTests` | MMCA.Common.API.Tests | 11 | DbUpdateExceptionHandler, DisabledFeatureHandler, DomainExceptionHandler, GlobalExceptionHandler, IdempotencyFilter, IdempotencySettings, IModule, ModuleLoader, OperationCanceledExceptionHandler, OwnerOrAdminFilter, ValidationExceptionHandler |
| 11 | `MiddlewarePipelineBuilderTests` | MMCA.Common.API.Tests | 3 | MiddlewarePipelineBuilder, MiddlewarePipelineStep, MiddlewarePipelineStepNames |
| 11 | `OwnerOrAdminFilterTests` | MMCA.Common.API.Tests | 4 | AllowMissingOwnerAttribute, ICurrentUserService, OwnerOrAdminFilter, OwnerOrAdminFilterOptions |
| 11 | `RateLimitEdgeCaseSecurityTests` | MMCA.Common.API.Tests | 5 | EndpointFeatureStub, FakeGrpcMetadata, MiddlewarePipelineBuilder, RateLimitingSettings, WebApplicationBuilderExtensions |
| 11 | `StubRefresher` | MMCA.Common.API.Tests | 3 | ICookieSessionRefresher, SessionRefreshOutcome, SessionTokenResult |
| 11 | `TestDataExportController` | MMCA.Common.API.Tests | 6 | DataExportControllerBase<TQuery>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, Result, TestExportQuery, UserDataExportDTO |
| 11 | `TestLegalAcceptanceController` | MMCA.Common.API.Tests | 4 | ICurrentUserService, ILegalAcceptanceService, LegalAcceptanceControllerBase, LegalAcceptanceOptions |
| 11 | `TestRolesAdminController` | MMCA.Common.API.Tests | 3 | ICurrentUserService, IRoleAdministrationService, RolesAdminControllerBase |
| 11 | `DependencyInjection` | MMCA.Common.Application | 53 | AuditableAggregateRootEntity<TIdentifierType>, AuthorizationCommandDecorator<TCommand, TResult>, AuthorizationQueryDecorator<TQuery, TResult>, CachingCommandDecorator<TCommand, TResult>, CachingQueryDecorator<TQuery, TResult>, ClassReference, CommandRequestValidator<TCommand, TRequest>, CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, DecoratorPipelineSeal, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, DomainEventDispatcher, EntityQueryPipeline, EventUpcasterRegistry, FeatureGateCommandDecorator<TCommand, TResult>, FeatureGateQueryDecorator<TQuery, TResult>, IBaseDTO<TIdentifierType>, ICommandHandler<in TCommand, TResult>, ICommandWithRequest<out TRequest>, ICreateRequest …(+33) |
| 11 | `AddEntityCrudTests` | MMCA.Common.Application.Tests | 18 | CommandRequestValidator<TCommand, TRequest>, CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, CustomDeleteOrderHandler, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, ExplicitOrderUpdateCommandValidator, ICommandHandler<in TCommand, TResult>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderCreateRequest, OrderDTO, OrderUpdateRequest, Result, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 11 | `AuthorizationCommandDecoratorTests` | MMCA.Common.Application.Tests | 10 | AuthClaimTypes, AuthorizationCommandDecorator<TCommand, TResult>, ErrorType, GuardedCommand, GuardedCommandWithValue, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IPermissionRegistry, Result, UnguardedCommand |
| 11 | `AuthorizationMultiFactorDecoratorTests` | MMCA.Common.Application.Tests | 12 | AuthClaimTypes, AuthorizationCommandDecorator<TCommand, TResult>, AuthorizationQueryDecorator<TQuery, TResult>, ErrorType, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IPermissionRegistry, IQueryHandler<in TQuery, TResult>, Result, StepUpCommand, StepUpQuery, UngatedStepUpCommand |
| 11 | `AuthorizationQueryDecoratorTests` | MMCA.Common.Application.Tests | 9 | AuthClaimTypes, AuthorizationQueryDecorator<TQuery, TResult>, ErrorType, GuardedQuery, ICurrentUserService, IPermissionRegistry, IQueryHandler<in TQuery, TResult>, Result, UnguardedQuery |
| 11 | `ConditionalWriteRootTouchTests` | MMCA.Common.Application.Tests | 10 | IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderDTO, OrderUpdateRequest, Result, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 11 | `DerivedUpdateCommandTests` | MMCA.Common.Application.Tests | 11 | ICommandWithRequest<out TRequest>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderDTO, OrderUpdateRequest, OwnerOrderApplier, RenameOrderByOwnerCommand, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityCommandHandler<TCommand, TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 11 | `MutateEntityHandlerBaseTests` | MMCA.Common.Application.Tests | 9 | ErrorType, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderDTO, RenameOrderCommand, TestRenameOrderDTOHandler, TestRenameOrderHandler |
| 11 | `TestRemoveOrderLineHandler` | MMCA.Common.Application.Tests | 5 | IUnitOfWork, OrderAggregate, RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>, RemoveOrderLineCommand, Result |
| 11 | `UpdateEntityHandlerTests` | MMCA.Common.Application.Tests | 13 | Error, ErrorType, ICommandWithRequest<out TRequest>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderDTO, OrderUpdateRequest, Result, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 11 | `VerbDiscriminatedUpdateTests` | MMCA.Common.Application.Tests | 11 | DecreaseOrderApplier, ICommandWithRequest<out TRequest>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IncreaseOrderApplier, IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, OrderDTO, OrderUpdateRequest, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 11 | `WriteSideRegistrationTests` | MMCA.Common.Application.Tests | 17 | CommandRequestValidator<TCommand, TRequest>, CustomIncreaseOrderHandler, DecreaseOrderApplier, ICommandHandler<in TCommand, TResult>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>, IncreaseOrderApplier, IUnitOfWork, OrderAggregate, OrderDTO, OrderUpdateRequest, OwnerOrderApplier, RenameOrderByOwnerCommand, Result, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityCommandHandler<TCommand, TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 11 | `DomainEventHandlerSaveFitnessTests` | MMCA.Common.Architecture.Tests | 8 | ArchitectureRules, DirectSavingHandler, FixtureAssemblyMap, InnocentHandler, InterfaceDispatchSavingHandler, PointsAwarder, PointsWriter, TransitiveSavingHandler |
| 11 | `Extensions` | MMCA.Common.Aspire | 13 | CachedHealthReportProvider, HealthCheckTags, HealthEndpointPaths, HealthReportCacheOptions, HttpResilienceDefaults, IWarmupTask, OpenIdConnectMetadataWarmupTask, OutboxPollFilterProcessor, ProbeTelemetryFilterProcessor, RedisPingHealthCheck, WarmupHostedService, WarmupReadinessGate, WarmupReadinessHealthCheck |
| 11 | `ProbeTelemetryFilterProcessorTests` | MMCA.Common.Aspire.Tests | 3 | Activity, ProbeTelemetryFilter, ProbeTelemetryFilterProcessor |
| 11 | `ApplicationDbContext` | MMCA.Common.Infrastructure | 36 | AuditableBaseEntity<TIdentifierType>, AuditSaveChangesInterceptor, AuditTrailEntry, AuditTrailSaveChangesInterceptor, AuditTrailSettings, CrossDataSourceDegradeConvention, DataSource, DataSourceEngines, DataSourceKey, DataSourceModelCacheKeyFactory, DetectChangesScope, DomainEventSaveChangesInterceptor, IAuditableEntity, IDataSourceEngine, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, InboxMessage, InternalCommandMessage, ITenantEntity, OutboxMessage …(+16) |
| 11 | `AuditSaveChangesInterceptor` | MMCA.Common.Infrastructure | 5 | ApplicationDbContext, IAuditableEntity, IRowVersioned, OwnedDependents, RowVersionStrategy |
| 11 | `AuditTrailSaveChangesInterceptor` | MMCA.Common.Infrastructure | 14 | Activity, ApplicationDbContext, AuditTrailEntry, CaptureContext, ColumnWidth, IAuditedEntity, InboxMessage, OutboxMessage, OwnedDependents, PendingEntityKey, PiiAttribute, PiiRedactor, ScheduledJobEntry, State |
| 11 | `CosmosDataSourceEngine` | MMCA.Common.Infrastructure | 17 | ApplicationDbContext, AuditableBaseEntity<TIdentifierType>, ConnectionStringSettings, CosmosDbContext, CosmosIntIdValueGenerator, DataSource, DataSourceEngineCapabilities, DataSourceEntrySettings, IDataSourceEngine, IEntityConfigurationAssemblyProvider, IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>, IExplicitKeyInsertDialect, MigrationPolicy, NamespaceConventions, PhysicalDataSource, RowVersionStrategy, TenantDataSourceOverrideSettings |
| 11 | `CosmosDbContext` | MMCA.Common.Infrastructure | 6 | ApplicationDbContext, DataSource, IEntityConfigurationAssemblyProvider, InternalCommandMessage, OutboxMessage, PhysicalDataSource |
| 11 | `CrossDataSourceDegradeConvention` | MMCA.Common.Infrastructure | 3 | DataSourceEngines, DataSourceKey, IEntityDataSourceRegistry |
| 11 | `DataSourceEngines` | MMCA.Common.Infrastructure | 6 | CosmosDataSourceEngine, DataSource, IDataSourceEngine, PostgreSQLDataSourceEngine, SqliteDataSourceEngine, SQLServerDataSourceEngine |
| 11 | `DataSourceModelCacheKeyFactory` | MMCA.Common.Infrastructure | 1 | ApplicationDbContext |
| 11 | `DeferredDispatch` | MMCA.Common.Infrastructure | 2 | CapturedState, DomainEventSaveChangesInterceptor |
| 11 | `DomainEventSaveChangesInterceptor` | MMCA.Common.Infrastructure | 14 | AggregateCapture, ApplicationDbContext, CapturedState, DeferredDispatch, IAggregateRoot, IDomainEvent, IDomainEventDispatcher, IIntegrationEvent, IOutboxSignal, LocalLease, MessageBusSettings, OutboxFinalizer, OutboxMessage, OutboxSettings |
| 11 | `IDataSourceEngine` | MMCA.Common.Infrastructure | 10 | ApplicationDbContext, AuditableBaseEntity<TIdentifierType>, ConnectionStringSettings, DataSource, DataSourceEngineCapabilities, DataSourceEntrySettings, IEntityConfigurationAssemblyProvider, IExplicitKeyInsertDialect, PhysicalDataSource, TenantDataSourceOverrideSettings |
| 11 | `OutboxFinalizer` | MMCA.Common.Infrastructure | 2 | ApplicationDbContext, OutboxMessage |
| 11 | `PhysicalDataSource` | MMCA.Common.Infrastructure | 3 | DataSourceEngines, DataSourceKey, MigrationPolicy |
| 11 | `PostgreSQLDataSourceEngine` | MMCA.Common.Infrastructure | 16 | ApplicationDbContext, AuditableBaseEntity<TIdentifierType>, ConnectionStringSettings, DataSource, DataSourceEngineCapabilities, DataSourceEntrySettings, IDataSourceEngine, IEntityConfigurationAssemblyProvider, IEntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>, IExplicitKeyInsertDialect, MigrationPolicy, NamespaceConventions, PhysicalDataSource, PostgreSQLDbContext, RowVersionStrategy, TenantDataSourceOverrideSettings |
| 11 | `PostgreSQLDbContext` | MMCA.Common.Infrastructure | 6 | ApplicationDbContext, DataSource, IEntityConfigurationAssemblyProvider, PersistenceSettings, PhysicalDataSource, UtcDateTimeConverter |
| 11 | `RestrictDeleteByDefaultConvention` | MMCA.Common.Infrastructure | 2 | DataSource, DataSourceEngines |
| 11 | `SoftDeleteFilterSql` | MMCA.Common.Infrastructure | 3 | DataSource, DataSourceEngines, IAuditableEntity |
| 11 | `SoftDeleteUniqueIndexConvention` | MMCA.Common.Infrastructure | 4 | DataSource, DataSourceEngines, IAuditableEntity, SoftDeleteFilterSql |
| 11 | `SqliteDataSourceEngine` | MMCA.Common.Infrastructure | 15 | ApplicationDbContext, AuditableBaseEntity<TIdentifierType>, ConnectionStringSettings, DataSource, DataSourceEngineCapabilities, DataSourceEntrySettings, IDataSourceEngine, IEntityConfigurationAssemblyProvider, IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, IExplicitKeyInsertDialect, MigrationPolicy, PhysicalDataSource, RowVersionStrategy, SqliteDbContext, TenantDataSourceOverrideSettings |
| 11 | `SqliteDbContext` | MMCA.Common.Infrastructure | 4 | ApplicationDbContext, DataSource, IEntityConfigurationAssemblyProvider, PhysicalDataSource |
| 11 | `SQLServerDataSourceEngine` | MMCA.Common.Infrastructure | 17 | ApplicationDbContext, AuditableBaseEntity<TIdentifierType>, ConnectionStringSettings, DataSource, DataSourceEngineCapabilities, DataSourceEntrySettings, ExplicitKeyInsertGroup, IDataSourceEngine, IEntityConfigurationAssemblyProvider, IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, IExplicitKeyInsertDialect, MigrationPolicy, NamespaceConventions, PhysicalDataSource, RowVersionStrategy, SQLServerDbContext, TenantDataSourceOverrideSettings |
| 11 | `SQLServerDbContext` | MMCA.Common.Infrastructure | 5 | ApplicationDbContext, DataSource, IEntityConfigurationAssemblyProvider, PersistenceSettings, PhysicalDataSource |
| 11 | `TenantSaveChangesInterceptor` | MMCA.Common.Infrastructure | 3 | ApplicationDbContext, CrossTenantWriteException, ITenantEntity |
| 11 | `MiddlewarePipelineOrderTestsBase` | MMCA.Common.Testing | 2 | MiddlewarePipelineBuilder, MiddlewarePipelineStepNames |
| 11 | `GalleryE2ECollection` | MMCA.Common.UI.E2E.Tests | 2 | GalleryHostFixture, PlaywrightFixture |
| 11 | `NotificationPagesHiddenRoutingTests` | MMCA.Common.UI.E2E.Tests | 1 | GalleryProcess |
| 12 | `AdcArchitectureMap` | MMCA.ADC.Architecture.Tests | 19 | ApiControllerBase, ApplicationDbContext, ArchitectureMapBase, BaseEntity<TIdentifierType>, ConferenceModule, EngagementModule, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, Event, EventDTO, IdentityModule, Layer, LayerRef, NotificationModule, Result, User, UserDTO, UserNotificationExportItemDTO, UserSessionBookmark, UserSessionBookmarkDTO |
| 12 | `MiddlewarePipelineOrderTests` | MMCA.ADC.Architecture.Tests | 1 | MiddlewarePipelineOrderTestsBase |
| 12 | `DependencyInjection` | MMCA.ADC.Conference.Contracts | 6 | EventLiveValidationService, EventLiveValidationServiceGrpcAdapter, IEventLiveValidationService, ISessionBookmarkValidationService, SessionBookmarkValidationService, SessionBookmarkValidationServiceGrpcAdapter |
| 12 | `ModuleApplicationDbContext` | MMCA.ADC.Conference.Infrastructure | 20 | Activity, ApplicationDbContext, Category, CategoryItem, Event, EventQuestionAnswer, EventSpeaker, IEntityConfigurationAssemblyProvider, Partner, PhysicalDataSource, Question, Room, Session, SessionAsset, SessionCategoryItem, SessionQuestionAnswer, SessionSpeaker, Speaker, SpeakerCategoryItem, Sponsor |
| 12 | `ConferenceGrpcEndpoints` | MMCA.ADC.Conference.Service | 2 | EventLiveValidationGrpcService, SessionBookmarksGrpcService |
| 12 | `PublicSessionListEventFilterTests` | MMCA.ADC.Conference.UI.Tests | 12 | BunitTestBase, Error, Event, EventDTO, IEventUIService, ISessionUIService, ISpeakerLookupService, PublicSessionList, Result, RoleNames, SpeakerInfo, TestPrincipal |
| 12 | `PublicSessionListEventsLoadFailedTests` | MMCA.ADC.Conference.UI.Tests | 16 | BunitTestBase, Error, EventDTO, IConnectivityStatusService, IEventUIService, ILocalCacheStore, InMemoryCacheStore, ISessionUIService, ISpeakerLookupService, IToastService, PublicSessionList, Result, RoomDTO, SessionDTO, SpeakerInfo, TestPrincipal |
| 12 | `PublicSessionListMyScheduleTests` | MMCA.ADC.Conference.UI.Tests | 17 | BunitTestBase, ConferenceRoutePaths, Error, EventDTO, IEventUIService, IScreenshotService, ISessionBookmarkUIService, ISessionUIService, IShareService, ISpeakerLookupService, IToastService, ListPageState, ListPageStateService, PublicSessionList, Result, SpeakerInfo, TestPrincipal |
| 12 | `PublicSessionListPrerenderedEventsLoadFailedTests` | MMCA.ADC.Conference.UI.Tests | 13 | BunitTestBase, Error, EventDTO, IEventUIService, ISessionUIService, ISpeakerLookupService, ListPageQueryStateService, ListPageStateService, PublicSessionList, Result, RoomDTO, SessionDTO, SpeakerInfo |
| 12 | `PublicSessionListRetryRaceTests` | MMCA.ADC.Conference.UI.Tests | 12 | BunitTestBase, Error, EventDTO, GatedCacheStore, IEventUIService, ILocalCacheStore, ISessionUIService, ISpeakerLookupService, PublicSessionList, Result, SessionDTO, SpeakerInfo |
| 12 | `PublicSessionListRoomFilterTests` | MMCA.ADC.Conference.UI.Tests | 10 | BunitTestBase, EventDTO, IEventUIService, ISessionUIService, ISpeakerLookupService, PublicSessionList, Result, Room, RoomDTO, SpeakerInfo |
| 12 | `PublicSessionListSortTests` | MMCA.ADC.Conference.UI.Tests | 8 | BunitTestBase, EventDTO, IEventUIService, ISessionUIService, ISpeakerLookupService, PublicSessionList, Result, SpeakerInfo |
| 12 | `BookmarksControllerTests` | MMCA.ADC.Engagement.API.Tests | 17 | BookmarksController, ControllerMocks, CreateBookmarkRequest, DeleteEntityCommand<TEntity, TIdentifierType>, Error, GetBookmarkedSessionIdsQuery, GetUserBookmarksQuery, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IQueryHandler<in TQuery, TResult>, OwnerOrAdminFilter, PagedCollectionResult<T>, PaginationMetadata, Result, UserSessionBookmark, UserSessionBookmarkDTO |
| 12 | `CheckInAttendeeHandler` | MMCA.ADC.Engagement.Application | 11 | AttendeeBadge, BadgePayload, CheckInAttendeeRequest, CheckInProcessor, CheckInResultDTO, Error, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEventLiveValidationService, IUnitOfWork, Result |
| 12 | `DependencyInjection` | MMCA.ADC.Engagement.Application | 33 | ApplicationSettings, BookmarkCacheEvictionSignal, BookmarkCountService, ClassReference, ClassReference, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, DeleteLivePollHandler, EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IBookmarkCountService, ICommandHandler<in TCommand, TResult>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, ILiveChannelPublishQueue, INavigationPopulator<in TEntity>, IPointsAwarder, IUserEngagementExportService, LiveChannelPublishQueue, LivePoll, LivePollDTO, LivePollNavigationPopulator …(+13) |
| 12 | `ManualCheckInHandler` | MMCA.ADC.Engagement.Application | 8 | CheckInProcessor, CheckInResultDTO, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEventLiveValidationService, IUnitOfWork, ManualCheckInRequest, Result |
| 12 | `RecordRoomCheckInHandler` | MMCA.ADC.Engagement.Application | 13 | CheckIn, CheckInProcessor, CheckInScope, CheckInSettings, Error, ErrorType, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEventLiveValidationService, IUnitOfWork, Result, RoomCheckInRequest, RoomCheckInResultDTO |
| 12 | `RecordSponsorVisitHandler` | MMCA.ADC.Engagement.Application | 9 | CheckInProcessor, CheckInScope, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IEventLiveValidationService, IUnitOfWork, Result, SponsorVisitRequest, SponsorVisitResultDTO |
| 12 | `UserEngagementExportServiceTests` | MMCA.ADC.Engagement.Application.Tests | 12 | AuditableAggregateRootEntity<TIdentifierType>, CheckIn, IRepository<TEntity, TIdentifierType>, IUnitOfWork, LeaderboardOptIn, LivePollVote, PointsEntry, Register, SessionQuestion, SessionQuestionUpvote, UserEngagementExportService, UserSessionBookmark |
| 12 | `UserEngagementExportServiceGrpcAdapter` | MMCA.ADC.Engagement.Contracts | 12 | CheckInScope, GrpcWireFormat, IUserEngagementExportService, PointsActivityType, UserEngagementBookmarkExportDTO, UserEngagementCheckInExportDTO, UserEngagementExportDTO, UserEngagementExportService, UserEngagementPointsEntryExportDTO, UserEngagementPollVoteExportDTO, UserEngagementQuestionUpvoteExportDTO, UserEngagementSubmittedQuestionExportDTO |
| 12 | `ModuleApplicationDbContext` | MMCA.ADC.Engagement.Infrastructure | 13 | ApplicationDbContext, AttendeeBadge, CheckIn, IEntityConfigurationAssemblyProvider, LeaderboardOptIn, LivePoll, LivePollOption, LivePollVote, PhysicalDataSource, PointsEntry, SessionQuestion, SessionQuestionUpvote, UserSessionBookmark |
| 12 | `UserEngagementExportGrpcService` | MMCA.ADC.Engagement.Service | 4 | GrpcWireFormat, IUserEngagementExportService, LeaderboardOptIn, UserEngagementExportService |
| 12 | `DependencyInjection` | MMCA.ADC.Engagement.UI | 33 | AttendeeLookupService, BookmarkService, CheckInService, CurrentEventNotificationScopeProvider, EngagementUIModule, EventFeedbackService, IAttendeeLookupService, IBookmarkUIService, ICheckInUIService, IEventFeedbackUIService, ILiveEventUIService, ILivePollUIService, INotificationScopeProvider, INowNextService, IPointsUIService, IQuestionLookupService, ISessionBookmarkUIService, ISessionFeedbackUIService, ISessionLiveUIService, ISessionLookupService …(+13) |
| 12 | `AdminRolesControllerTests` | MMCA.ADC.Identity.API.Tests | 12 | AdministrationPermissions, AdminRolesController, Error, HasPermissionAttribute, ICurrentUserService, IdentityPermissionGrants, IRoleAdministrationService, PermissionRegistryBuilder, Result, RoleNames, RolePermissionsResponse, SetRolePermissionsRequest |
| 12 | `UsersDataExportControllerTests` | MMCA.ADC.Identity.API.Tests | 10 | Email, Error, ExportUserDataQuery, ICurrentUserService, IQueryHandler<in TQuery, TResult>, Result, Subject, UserDataExportDTO, UserDataExportSubjectDTO, UsersDataExportController |
| 12 | `ModuleApplicationDbContext` | MMCA.ADC.Identity.Infrastructure | 4 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, PhysicalDataSource, User |
| 12 | `GateContext<TCase>` | MMCA.ADC.Identity.Infrastructure.Tests | 3 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, PhysicalDataSource |
| 12 | `EventLiveValidationGrpcServiceTests` | MMCA.ADC.Services.Tests | 13 | Error, EventLiveInfo, EventLiveValidationGrpcService, EventLiveValidationService, FakeServerCallContext, GrpcCalls, IEventLiveValidationService, QuestionModerationDefault, Result, ResultFailureException, RoomSessionInfo, SessionLiveInfo, SponsorLiveInfo |
| 12 | `App` | MMCA.ADC.UI | 1 | MauiProgram |
| 12 | `AppDelegate` | MMCA.ADC.UI | 4 | DeepLinkDispatcher, IDeepLinkDispatcher, MauiProgram, Register |
| 12 | `MainApplication` | MMCA.ADC.UI | 1 | MauiProgram |
| 12 | `CookieSessionRefreshMiddlewareExtensions` | MMCA.Common.API | 1 | CookieSessionRefreshMiddleware |
| 12 | `CookieTokenReader` | MMCA.Common.API | 1 | SessionCookieEndpoints |
| 12 | `SessionCookieStore` | MMCA.Common.API | 3 | ISessionCookieStore, SessionCookieJar, SessionCookieSettings |
| 12 | `AdministrationControllerBaseTests` | MMCA.Common.API.Tests | 19 | AdministrationPermissions, Error, HasPermissionAttribute, ICurrentUserService, IRoleAdministrationService, IUserAdministrationService<TUserDto>, PagedCollectionResult<T>, PaginationMetadata, PermissionCatalogResponse, Result, RolePermissionsResponse, RolesAdminControllerBase, SetRolePermissionsRequest, SetUserRolesRequest, TestRolesAdminController, TestUserDto, TestUsersAdminController, UserAdministrationQuery, UsersAdminControllerBase<TUserDto> |
| 12 | `ClaimsOnlySessionCookieEndpointsTests` | MMCA.Common.API.Tests | 7 | ICookieSessionRefresher, SessionCookieEndpoints, SessionCookieRequest, SessionCookieSettings, SessionTokenResponse, SessionTokenResult, StubRefresher |
| 12 | `DataExportControllerBaseTests` | MMCA.Common.API.Tests | 13 | DataExportControllerBase<TQuery>, Error, ICurrentUserService, IQueryHandler<in TQuery, TResult>, PrivacyFeatures, Result, StubFeatureManager, Subject, SubjectSnapshot, TestDataExportController, TestExportQuery, UserDataExportDTO, UserDataExportSectionDTO |
| 12 | `LegalAcceptanceControllerBaseTests` | MMCA.Common.API.Tests | 9 | AcceptLegalTermsRequest, ICurrentUserService, ILegalAcceptanceService, LegalAcceptanceControllerBase, LegalAcceptanceDTO, LegalAcceptanceErrorCodes, LegalAcceptanceOptions, Result, TestLegalAcceptanceController |
| 12 | `SessionCookieEndpointsTests` | MMCA.Common.API.Tests | 6 | ICookieSessionRefresher, SessionCookieEndpoints, SessionCookieRequest, SessionTokenResponse, SessionTokenResult, StubRefresher |
| 12 | `SessionCookieJarTests` | MMCA.Common.API.Tests | 4 | JwtSettings, SessionCookieEndpoints, SessionCookieJar, SessionCookieSettings |
| 12 | `ChildEntityHandlerBaseTests` | MMCA.Common.Application.Tests | 9 | AddOrderLineCommand, ErrorType, IRepository<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, IUnitOfWork, OrderAggregate, RemoveOrderLineCommand, TestAddOrderLineHandler, TestRemoveOrderLineHandler |
| 12 | `CommonArchitectureMap` | MMCA.Common.Architecture.Tests | 10 | ApiControllerBase, ApplicationDbContext, ArchitectureMapBase, BaseEntity<TIdentifierType>, DomainEventDispatcher, Layer, LayerRef, Result, ResultGrpcExtensions, UISharedAssemblyReference |
| 12 | `FrameworkModels` | MMCA.Common.Architecture.Tests | 12 | AuditSaveChangesInterceptor, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, IEntityDataSourceRegistry, NoDomainEventDispatcher, NoEntityDataSources, NoModuleAssemblies, NoOutboxSignal, PhysicalDataSource, SqliteDbContext, SQLServerDbContext |
| 12 | `FrameworkModuleArchitectureMap` | MMCA.Common.Architecture.Tests | 7 | ApplicationDbContext, ArchitectureMapBase, BaseEntity<TIdentifierType>, DomainEventDispatcher, Layer, LayerRef, Result |
| 12 | `FrameworkSanityTests` | MMCA.Common.Architecture.Tests | 7 | ApplicationDbContext, ArchitectureAssert, DomainEventDispatcher, IJwksProvider, ILiveChannelPublisher, IMessageBus, ResultGrpcExtensions |
| 12 | `ModuleIsolationTestsBaseTests` | MMCA.Common.Architecture.Tests | 5 | ApplicationDbContext, ArchitectureRules, BaseEntity<TIdentifierType>, Layer, StubMap |
| 12 | `BrokerSelectionTests` | MMCA.Common.Aspire.Hosting.Tests | 4 | BrokerSelection, Extensions, Extensions, ServiceBusEmulatorResource |
| 12 | `ServiceBusEmulatorBrokerTests` | MMCA.Common.Aspire.Hosting.Tests | 3 | Extensions, Extensions, ServiceBusEmulatorResource |
| 12 | `AiTelemetryExportTests` | MMCA.Common.Aspire.Tests | 1 | Extensions |
| 12 | `InfrastructureHealthChecksTests` | MMCA.Common.Aspire.Tests | 2 | Extensions, HealthCheckTags |
| 12 | `MetricsInstrumentationToggleTests` | MMCA.Common.Aspire.Tests | 1 | Extensions |
| 12 | `PollyResilienceMetricsTests` | MMCA.Common.Aspire.Tests | 1 | Extensions |
| 12 | `ProbeTelemetryFilterTests` | MMCA.Common.Aspire.Tests | 2 | Extensions, ProbeTelemetryFilter |
| 12 | `RedisReadinessSafetyTests` | MMCA.Common.Aspire.Tests | 2 | Extensions, HealthCheckTags |
| 12 | `SecurityHeadersMiddlewareTests` | MMCA.Common.Aspire.Tests | 8 | CspNonce, CspPolicy, Extensions, ICspPolicyProvider, SecurityHeadersMiddleware, SecurityHeadersSettings, StubCspProvider, StubWebHostEnvironment |
| 12 | `StubHostEnvironment` | MMCA.Common.Aspire.Tests | 1 | Extensions |
| 12 | `TracesSampleRatioTests` | MMCA.Common.Aspire.Tests | 1 | Extensions |
| 12 | `DataSourceService` | MMCA.Common.Infrastructure | 5 | DataSource, DataSourceEngines, DataSourceKey, IDataSourceService, IEntityDataSourceRegistry |
| 12 | `EFReadRepository<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 19 | ApplicationDbContext, AuditableBaseEntity<TIdentifierType>, BaseLookup<TIdentifierType>, DataSourceEngineCapabilities, EntityQueryPipeline, Error, GroupedCount<TKey>, GroupedSum<TKey>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, KeysetCollectionResult<T>, KeysetCursor, KeysetPageRequest, KeysetQueryBuilder, LookupRow<TId, TName>, QuerySpecification<TEntity, TIdentifierType>, QueryTags, Result, SpecificationEvaluator |
| 12 | `EntityTypeConfiguration<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 9 | AuditableBaseEntity<TIdentifierType>, DataSource, DataSourceEngines, EntityTypeConfigurationBase<TEntity, TIdentifierType>, IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>, IEntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>, IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>, IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, UseDataSourceAttribute |
| 12 | `IDataSourceResolver` | MMCA.Common.Infrastructure | 3 | DataSource, DataSourceKey, PhysicalDataSource |
| 12 | `IDbContextFactory` | MMCA.Common.Infrastructure | 2 | ApplicationDbContext, DataSourceKey |
| 12 | `IndexBuilderExtensions` | MMCA.Common.Infrastructure | 2 | DataSource, SoftDeleteFilterSql |
| 12 | `IPhysicalDbContextFactory` | MMCA.Common.Infrastructure | 3 | ApplicationDbContext, DataSourceKey, PhysicalDataSource |
| 12 | `CosmosDbContextTests` | MMCA.Common.Infrastructure.Tests | 1 | CosmosDbContext |
| 12 | `DegradeTestContext` | MMCA.Common.Infrastructure.Tests | 7 | ApplicationDbContext, DataSourceKey, DegradeCustomer, DegradeOrder, EmptyAssemblyProvider, IEntityDataSourceRegistry, PhysicalDataSource |
| 12 | `ExplicitKeyInsertRoundOrderTests` | MMCA.Common.Infrastructure.Tests | 8 | CatalogContext, Category, CategoryItem, CycleLeft, CycleRight, ExplicitKeyInsertRoundOrder, SQLServerDataSourceEngine, Tag |
| 12 | `GateContext<TCase>` | MMCA.Common.Infrastructure.Tests | 3 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, PhysicalDataSource |
| 12 | `GateTestContext` | MMCA.Common.Infrastructure.Tests | 13 | ApplicationDbContext, AuditSaveChangesInterceptor, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, GateTestContext, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, PhysicalDataSource, SchedulerSettings |
| 12 | `GateTestContext` | MMCA.Common.Infrastructure.Tests | 14 | ApplicationDbContext, AuditSaveChangesInterceptor, AuditTrailSettings, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, GateTestContext, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, PhysicalDataSource |
| 12 | `IntegrityTestDbContext` | MMCA.Common.Infrastructure.Tests | 13 | ApplicationDbContext, AuditSaveChangesInterceptor, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IntegrityAggregate, IOutboxSignal, MessageBusSettings, NullAssemblyProvider, NullAssemblyProvider, PhysicalDataSource |
| 12 | `ModelTestContext` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, AuditSaveChangesInterceptor, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, PhysicalDataSource |
| 12 | `NamedSoftDeleteTestDbContext` | MMCA.Common.Infrastructure.Tests | 2 | ApplicationDbContext, ProjectedTestEntity |
| 12 | `Participant` | MMCA.Common.Infrastructure.Tests | 2 | ApplicationDbContext, IRefreshSessionStore |
| 12 | `PhysicalDataSourceTests` | MMCA.Common.Infrastructure.Tests | 3 | DataSource, DataSourceKey, PhysicalDataSource |
| 12 | `SpecificationTestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, NullableEmailValueConverter, SpecTestChild, SpecTestEntity |
| 12 | `TestPhysicalDataSources` | MMCA.Common.Infrastructure.Tests | 3 | DataSource, DataSourceKey, PhysicalDataSource |
| 12 | `WrappedIdContextServices` | MMCA.Common.Infrastructure.Tests | 13 | AuditSaveChangesInterceptor, CustomerId, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, LineId, OrderId, SpeakerId, StronglyTypedIdRegistry, WrappedOrder, WrappedSpeaker |
| 12 | `CreateMigrationProofTable` | MMCA.Common.Infrastructure.Tests.MigrationsFixture | 1 | SqliteDbContext |
| 12 | `MiddlewarePipelineOrderTests` | MMCA.Common.Testing.Tests | 1 | MiddlewarePipelineOrderTestsBase |
| 12 | `GalleryAxeTestBase` | MMCA.Common.UI.E2E.Tests | 4 | E2ETestConfiguration, GalleryE2ECollection, GalleryHostFixture, PlaywrightFixture |
| 12 | `SameOriginProxyTransformer` | MMCA.Common.UI.Web | 5 | ISessionCookieStore, ProxyResponseMode, SameOriginProxyHeaders, SessionClaimsToken, SessionCookieEndpoints |
| 12 | `ProxyHost` | MMCA.Common.UI.Web.Tests | 4 | ApiSettings, FakeGateway, SameOriginProxyInvoker, SessionCookieEndpoints |
| 13 | `AiDependencyIsolationTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, AiDependencyIsolationTestsBase, IArchitectureMap |
| 13 | `CascadeSoftDeleteConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, CascadeSoftDeleteConventionTestsBase, IArchitectureMap |
| 13 | `ClockReadTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ClockReadTestsBase, IArchitectureMap |
| 13 | `CommandValidatorCoverageTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, CommandValidatorCoverageTestsBase, IArchitectureMap |
| 13 | `ConcurrencyConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ConcurrencyConventionTestsBase, IArchitectureMap |
| 13 | `ConstructorDependencyCountTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ConstructorDependencyCountTestsBase, IArchitectureMap |
| 13 | `ContractImplementationTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ContractImplementationTestsBase, IArchitectureMap |
| 13 | `ControllerConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ControllerConventionTestsBase, IArchitectureMap |
| 13 | `DataResidencyTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, DataResidencyTestsBase, IArchitectureMap |
| 13 | `DomainEventHandlerSaveTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, DomainEventHandlerSaveTestsBase, IArchitectureMap |
| 13 | `DomainPurityTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, DomainPurityTestsBase, IArchitectureMap |
| 13 | `DomainThrowTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, DomainThrowTestsBase, IArchitectureMap |
| 13 | `EntityConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, EntityConventionTestsBase, IArchitectureMap |
| 13 | `ErrorCatalogTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ErrorCatalogTestsBase, IArchitectureMap |
| 13 | `EventConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, EventConventionTestsBase, IArchitectureMap |
| 13 | `FeatureFlagLifecycleTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, FeatureFlagLifecycleTestsBase, IArchitectureMap |
| 13 | `FormsConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, FormsConventionTestsBase, IArchitectureMap |
| 13 | `ForwardedJwtAudienceTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, ForwardedJwtAudienceTestsBase, IArchitectureMap |
| 13 | `FrameworkVersionConsistencyTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, FrameworkVersionConsistencyTestsBase, IArchitectureMap |
| 13 | `HandlerConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, HandlerConventionTestsBase, IArchitectureMap |
| 13 | `HandlerResultConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, HandlerResultConventionTestsBase, IArchitectureMap |
| 13 | `IdempotencyConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, IdempotencyConventionTestsBase |
| 13 | `ImmutabilityTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, ImmutabilityTestsBase |
| 13 | `IntegrationEventContractTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, IntegrationEventContractTestsBase |
| 13 | `IntegrationEventPayloadPurityTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, IntegrationEventPayloadPurityTestsBase |
| 13 | `LayerDependencyTests` | MMCA.ADC.Architecture.Tests | 4 | AdcArchitectureMap, IArchitectureMap, Layer, LayerDependencyTestsBase |
| 13 | `LocalizedTextConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, LocalizedTextConventionTestsBase |
| 13 | `MicroserviceExtractionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, MicroserviceExtractionTestsBase |
| 13 | `ModuleIsolationTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, ModuleIsolationTestsBase |
| 13 | `NamingConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, NamingConventionTestsBase |
| 13 | `PiiConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, PiiConventionTestsBase |
| 13 | `QueryHandlerReadRepositoryTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, QueryHandlerReadRepositoryTestsBase |
| 13 | `RawQueryableConventionTests` | MMCA.ADC.Architecture.Tests | 4 | AdcArchitectureMap, ArchitectureMapBase, IArchitectureMap, RawQueryableConventionTestsBase |
| 13 | `RawSqlConventionTests` | MMCA.ADC.Architecture.Tests | 4 | AdcArchitectureMap, ArchitectureMapBase, IArchitectureMap, RawSqlConventionTestsBase |
| 13 | `ServiceContractPurityTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, ServiceContractPurityTestsBase |
| 13 | `SharedLayerTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, SharedLayerTestsBase |
| 13 | `SliceCohesionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, SliceCohesionTestsBase |
| 13 | `SoftDeleteEnforcementTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, SoftDeleteEnforcementTestsBase |
| 13 | `SpecificationConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, SpecificationConventionTestsBase |
| 13 | `StateManagementConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, StateManagementConventionTestsBase |
| 13 | `StronglyTypedIdTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, StronglyTypedIdTestsBase |
| 13 | `UIArchitectureConventionTests` | MMCA.ADC.Architecture.Tests | 3 | AdcArchitectureMap, IArchitectureMap, UIArchitectureConventionTestsBase |
| 13 | `DependencyInjection` | MMCA.ADC.Engagement.Contracts | 6 | BookmarkCountService, BookmarkCountServiceGrpcAdapter, IBookmarkCountService, IUserEngagementExportService, UserEngagementExportService, UserEngagementExportServiceGrpcAdapter |
| 13 | `ConferenceGrpcEndpointsTests` | MMCA.ADC.Services.Tests | 3 | ConferenceGrpcEndpoints, EventLiveValidationGrpcService, SessionBookmarksGrpcService |
| 13 | `UserEngagementExportGrpcServiceTests` | MMCA.ADC.Services.Tests | 10 | CheckInScope, FakeServerCallContext, IUserEngagementExportService, UserEngagementBookmarkExportDTO, UserEngagementCheckInExportDTO, UserEngagementExportDTO, UserEngagementExportGrpcService, UserEngagementPollVoteExportDTO, UserEngagementQuestionUpvoteExportDTO, UserEngagementSubmittedQuestionExportDTO |
| 13 | `UserEngagementExportServiceGrpcAdapterTests` | MMCA.ADC.Services.Tests | 4 | CheckInScope, UserEngagementExportDTO, UserEngagementExportService, UserEngagementExportServiceGrpcAdapter |
| 13 | `Program` | MMCA.ADC.UI | 1 | AppDelegate |
| 13 | `CookieSessionRefresher` | MMCA.Common.API | 12 | AuthenticationResponse, BrowserOrigin, CookieTokenReader, ICookieSessionRefresher, KeyedSemaphoreStripe, RefreshTokenRequest, SessionCookieEndpoints, SessionCookieJar, SessionCookieSettings, SessionRefreshOutcome, SessionRefreshStatus, SessionTokenResult |
| 13 | `SessionCookieAuthenticationHandler` | MMCA.Common.API | 1 | CookieTokenReader |
| 13 | `CookieSessionRefreshMiddlewareTests` | MMCA.Common.API.Tests | 5 | CookieSessionRefreshMiddleware, CookieSessionRefreshMiddlewareExtensions, ICookieSessionRefresher, NextDelegateSpy, SessionTokenResult |
| 13 | `CookieTokenReaderTests` | MMCA.Common.API.Tests | 2 | CookieTokenReader, SessionCookieEndpoints |
| 13 | `AggregateConventionTests` | MMCA.Common.Architecture.Tests | 3 | AggregateConventionTestsBase, CommonArchitectureMap, IArchitectureMap |
| 13 | `AiDependencyIsolationTests` | MMCA.Common.Architecture.Tests | 3 | AiDependencyIsolationTestsBase, CommonArchitectureMap, IArchitectureMap |
| 13 | `CancellationTokenConventionTests` | MMCA.Common.Architecture.Tests | 3 | CancellationTokenConventionTestsBase, CommonArchitectureMap, IArchitectureMap |
| 13 | `CascadeSoftDeleteConventionTests` | MMCA.Common.Architecture.Tests | 3 | CascadeSoftDeleteConventionTestsBase, CommonArchitectureMap, IArchitectureMap |
| 13 | `ClockReadTests` | MMCA.Common.Architecture.Tests | 13 | ArchitectureRules, AsyncClockReadingFixture, AsyncLambdaClockReadingFixture, ClockReadTestsBase, CommonArchitectureMap, FixtureAssemblyMap, IArchitectureMap, InjectedClockFixture, LambdaClockReadingFixture, OffsetNowReadingFixture, TodayReadingFixture, TwoMemberClockFixture, UtcNowReadingFixture |
| 13 | `ConcurrencyConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, ConcurrencyConventionTestsBase, IArchitectureMap |
| 13 | `ContractImplementationTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, ContractImplementationTestsBase, IArchitectureMap |
| 13 | `DeleteBehaviorConventionTests` | MMCA.Common.Architecture.Tests | 3 | ArchitectureRules, DeleteBehaviorConventionTestsBase, FrameworkModels |
| 13 | `DomainPurityTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, DomainPurityTestsBase, IArchitectureMap |
| 13 | `DomainThrowFitnessTests` | MMCA.Common.Architecture.Tests | 9 | ArchitectureRules, ArgumentGuardFixture, CommonArchitectureMap, CustomExceptionThrowingFixture, FixtureAssemblyMap, IndirectThrowFixture, InvalidOperationThrowingFixture, NonThrowingFixture, RethrowingFixture |
| 13 | `EntityConventionTests` | MMCA.Common.Architecture.Tests | 3 | EntityConventionTestsBase, FrameworkModuleArchitectureMap, IArchitectureMap |
| 13 | `EventScopeFitnessTests` | MMCA.Common.Architecture.Tests | 3 | ArchitectureRules, CommonArchitectureMap, FakeConsumerMap |
| 13 | `EventUpcasterFitnessTests` | MMCA.Common.Architecture.Tests | 9 | ArchitectureRules, CommonArchitectureMap, FixtureBackwardsVersionUpcaster, FixtureCompliantV1ToV2Upcaster, FixtureCompliantV2ToV3Upcaster, FixtureContestedClaimUpcaster, FixtureContestedV1, FixtureRivalClaimUpcaster, UpcasterTestMap |
| 13 | `EventVersioningConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, EventConventionTestsBase, IArchitectureMap |
| 13 | `FakeConsumerMap` | MMCA.Common.Architecture.Tests | 5 | ArchitectureMapBase, BaseIntegrationEvent, EventScopeFitnessTests, Layer, LayerRef |
| 13 | `FeatureFlagLifecycleRuleTests` | MMCA.Common.Architecture.Tests | 6 | ArchitectureRules, CommonArchitectureMap, FixtureBadFeatures, FixtureExpiredFeatures, FixtureGoodFeatures, FixtureMap |
| 13 | `FeatureFlagLifecycleTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, FeatureFlagLifecycleTestsBase, IArchitectureMap |
| 13 | `FrameworkConstructorDependencyTests` | MMCA.Common.Architecture.Tests | 4 | CommonArchitectureMap, ConstructorDependencyCountTestsBase, IArchitectureMap, Layer |
| 13 | `HandlerResultConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, HandlerResultConventionTestsBase, IArchitectureMap |
| 13 | `IdempotencyConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, IdempotencyConventionTestsBase |
| 13 | `ImmutabilityTests` | MMCA.Common.Architecture.Tests | 3 | FrameworkModuleArchitectureMap, IArchitectureMap, ImmutabilityTestsBase |
| 13 | `IntegrationEventPayloadPurityRuleTests` | MMCA.Common.Architecture.Tests | 7 | ArchitectureRules, CommonArchitectureMap, FixtureCleanEvent, FixtureLeakedPayload, FixtureLeakingEvent, FrameworkProbeMap, ModuleProbeMap |
| 13 | `IntegrationEventPayloadPurityTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, IntegrationEventPayloadPurityTestsBase |
| 13 | `LayerDependencyTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, LayerDependencyTestsBase |
| 13 | `LocalizedTextConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, LocalizedTextConventionTestsBase |
| 13 | `MicroserviceExtractionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, MicroserviceExtractionTestsBase |
| 13 | `NamespaceCycleTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, NamespaceCycleTestsBase |
| 13 | `PiiConventionTests` | MMCA.Common.Architecture.Tests | 4 | CommonArchitectureMap, IArchitectureMap, Layer, PiiConventionTestsBase |
| 13 | `Probe` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, DataResidencyTestsBase, IArchitectureMap |
| 13 | `QueryHandlerReadRepositoryTests` | MMCA.Common.Architecture.Tests | 9 | ArchitectureRules, CommonArchitectureMap, FixtureAssemblyMap, FixtureAssemblyMap, IArchitectureMap, QueryHandlerReadRepositoryTestsBase, ReadRepositoryQueryHandlerFixture, WriteRepositoryCommandHandlerFixture, WriteRepositoryQueryHandlerFixture |
| 13 | `RawQueryableConventionTests` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, CommonArchitectureMap, IArchitectureMap, RawQueryableConventionTestsBase |
| 13 | `RawSqlConventionTests` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, CommonArchitectureMap, IArchitectureMap, RawSqlConventionTestsBase |
| 13 | `ServiceContractPurityTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, ServiceContractPurityTestsBase |
| 13 | `SliceCohesionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, SliceCohesionTestsBase |
| 13 | `SoftDeleteEnforcementTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, SoftDeleteEnforcementTestsBase |
| 13 | `StateManagementConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, StateManagementConventionTestsBase |
| 13 | `StronglyTypedIdConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, StronglyTypedIdTestsBase |
| 13 | `TenantEntityConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, ITenantEntity, Layer |
| 13 | `UIArchitectureConventionTests` | MMCA.Common.Architecture.Tests | 3 | CommonArchitectureMap, IArchitectureMap, UIArchitectureConventionTestsBase |
| 13 | `UpcasterTestMap` | MMCA.Common.Architecture.Tests | 4 | ArchitectureMapBase, EventUpcasterFitnessTests, Layer, LayerRef |
| 13 | `SerilogHostExtensionsTests` | MMCA.Common.Aspire.Tests | 3 | Extensions, SerilogHostExtensions, StubHostEnvironment |
| 13 | `AuditTrailReader` | MMCA.Common.Infrastructure | 7 | AuditTrailEntry, AuditTrailEntryDTO, AuditTrailSettings, DataSourceKey, IAuditTrailReader, IDataSourceResolver, IDbContextFactory |
| 13 | `BrokerEventBus` | MMCA.Common.Infrastructure | 7 | IDataSourceResolver, IDbContextFactory, IEventBus, IIntegrationEvent, IOutboxSignal, OutboxMessage, OutboxSettings |
| 13 | `DataSourceResolver` | MMCA.Common.Infrastructure | 10 | ConnectionStringSettings, DataSource, DataSourceEngines, DataSourceEntrySettings, DataSourceKey, DataSourcesSettings, DefaultSeed, IDataSourceResolver, MigrationPolicy, PhysicalDataSource |
| 13 | `EfInboxStore` | MMCA.Common.Infrastructure | 6 | ApplicationDbContext, IDataSourceResolver, IDbContextFactory, IInboxStore, InboxMessage, OutboxSettings |
| 13 | `EFPermissionGrantStore` | MMCA.Common.Infrastructure | 11 | ApplicationDbContext, DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, IPermissionGrantStore, IUniqueConstraintViolationDetector, PermissionGrant, PermissionGrantSettings, Result |
| 13 | `EFRawSqlQueryExecutor` | MMCA.Common.Infrastructure | 5 | DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IRawSqlQueryExecutor |
| 13 | `EFRefreshSessionStore` | MMCA.Common.Infrastructure | 10 | ApplicationDbContext, DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, IRefreshSessionStore, RefreshSession, RefreshSessionSettings, Sessions |
| 13 | `EFRepository<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 10 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, EFReadRepository<TEntity, TIdentifierType>, IAuditableEntity, ICurrentUserService, IRepository<TEntity, TIdentifierType>, IRowVersioned, IUpdatePropertySetter<TEntity>, RowVersionStrategy, UpdatePropertySetterBuilder<TEntity> |
| 13 | `EntityDataSourceRegistry` | MMCA.Common.Infrastructure | 10 | DataSource, DataSourceKey, IDataSourceResolver, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IEntityTypeConfigurationBase<TEntity, TIdentifierType>, NamespaceConventions, Snapshot, UseDatabaseAttribute, UseDataSourceAttribute |
| 13 | `EntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 3 | AuditableBaseEntity<TIdentifierType>, DataSource, EntityTypeConfiguration<TEntity, TIdentifierType> |
| 13 | `EntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 3 | AuditableBaseEntity<TIdentifierType>, DataSource, EntityTypeConfiguration<TEntity, TIdentifierType> |
| 13 | `EntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 3 | AuditableBaseEntity<TIdentifierType>, DataSource, EntityTypeConfiguration<TEntity, TIdentifierType> |
| 13 | `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | MMCA.Common.Infrastructure | 3 | AuditableBaseEntity<TIdentifierType>, DataSource, EntityTypeConfiguration<TEntity, TIdentifierType> |
| 13 | `InProcessEventBus` | MMCA.Common.Infrastructure | 9 | IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEventBus, IIntegrationEvent, MessageBusSettings, OutboxFinalizer, OutboxMessage, OutboxSettings |
| 13 | `InternalCommandScheduler` | MMCA.Common.Infrastructure | 12 | AmbientOrigin, EnrolledCommandWake, Error, IDataSourceResolver, IDbContextFactory, IInternalCommand, IInternalCommandScheduler, IInternalCommandSignal, InternalCommandMessage, InternalCommandOriginCapture, InternalCommandsSettings, Result |
| 13 | `PhysicalDbContextFactory` | MMCA.Common.Infrastructure | 7 | ApplicationDbContext, DataSourceEngines, DataSourceKey, IDataSourceResolver, IEntityConfigurationAssemblyProvider, IPhysicalDbContextFactory, PhysicalDataSource |
| 13 | `RefreshSessionCleanupService` | MMCA.Common.Infrastructure | 8 | DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, PeriodicBackgroundService, RefreshSession, RefreshSessionSettings |
| 13 | `ScheduledJobRunner` | MMCA.Common.Infrastructure | 10 | ApplicationDbContext, ColumnWidth, DataSourceKey, IDataSourceResolver, IDbContextFactory, IScheduledJob, JobClaim, ScheduledJobEntry, SchedulerMetrics, SchedulerSettings |
| 13 | `TenancySettingsValidator` | MMCA.Common.Infrastructure | 8 | DataSource, DataSourceEngines, DataSourceKey, IDataSourceResolver, TenancySettings, TenantDataSourceOverrideSettings, TenantEntrySettings, TenantResolutionStrategy |
| 13 | `UnitOfWork` | MMCA.Common.Infrastructure | 9 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IDataSourceService, IDbContextFactory, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRepositoryFactory, IUniqueConstraintViolationDetector, IUnitOfWork |
| 13 | `AdminTestContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NoAssemblies, OutboxMessage, TestPhysicalDataSources |
| 13 | `AuditTrailModelGateTests` | MMCA.Common.Infrastructure.Tests | 3 | AuditTrailEntry, DataSourceKey, GateTestContext |
| 13 | `AuditTrailTestContext` | MMCA.Common.Infrastructure.Tests | 18 | ApplicationDbContext, AuditedAggregateThing, AuditedThing, AuditSaveChangesInterceptor, AuditTrailEntry, AuditTrailSaveChangesInterceptor, CompositeKeyThing, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FailingSaveInterceptor, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, OverridingPiiThing, PlainThing, TestPhysicalDataSources |
| 13 | `CleanupTestContext` | MMCA.Common.Infrastructure.Tests | 13 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, InboxMessage, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, NullAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 13 | `CommitFailingDbContext` | MMCA.Common.Infrastructure.Tests | 13 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FailingDatabaseFacade, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, OutboxMessage, TestAggregate, TestPhysicalDataSources |
| 13 | `CrossDataSourceDegradeConventionTests` | MMCA.Common.Infrastructure.Tests | 14 | AuditSaveChangesInterceptor, DataSource, DataSourceKey, DataSourceModelCacheKeyFactory, DegradeCustomer, DegradeOrder, DegradeTestContext, DomainEventSaveChangesInterceptor, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, MapRegistry, OutboxSignal, PhysicalDataSource |
| 13 | `DataSourceServiceAdditionalTests` | MMCA.Common.Infrastructure.Tests | 7 | DataSource, DataSourceKey, DataSourceService, FakeEntity, FakeEntity, IEntityDataSourceRegistry, UnregisteredEntity |
| 13 | `DataSourceServiceTests` | MMCA.Common.Infrastructure.Tests | 6 | DataSource, DataSourceKey, DataSourceService, FakeEntity, FakeEntity, IEntityDataSourceRegistry |
| 13 | `DefaultDataSourceResolver` | MMCA.Common.Infrastructure.Tests | 4 | DataSource, DataSourceKey, IDataSourceResolver, PhysicalDataSource |
| 13 | `DeleteBehaviorTestDbContext` | MMCA.Common.Infrastructure.Tests | 14 | ApplicationDbContext, AuditSaveChangesInterceptor, CascadingChild, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NoModuleAssemblies, NoModuleAssemblies, OptionalChild, Parent, RequiredChild, TestPhysicalDataSources |
| 13 | `DependencyInjectionAdditionalTests` | MMCA.Common.Infrastructure.Tests | 6 | EntityConfigurationOptions, IDataSourceService, IDbContextFactory, IQueryableExecutor, IRepositoryFactory, IUnitOfWork |
| 13 | `DetectionTestDbContext` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, TestPhysicalDataSources, Widget, Widget |
| 13 | `EFReadRepositoryKeysetPagingTests` | MMCA.Common.Infrastructure.Tests | 7 | BbbSpecification, EFReadRepository<TEntity, TIdentifierType>, ErrorType, KeysetCursor, KeysetPageRequest, SpecificationTestDbContext, SpecTestEntity |
| 13 | `EFReadRepositoryLookupProjectionTests` | MMCA.Common.Infrastructure.Tests | 4 | EFReadRepository<TEntity, TIdentifierType>, Email, SpecificationTestDbContext, SpecTestEntity |
| 13 | `EFReadRepositoryLookupSecurityTests` | MMCA.Common.Infrastructure.Tests | 4 | EFReadRepository<TEntity, TIdentifierType>, EntityQueryPipeline, SpecificationTestDbContext, SpecTestEntity |
| 13 | `EFReadRepositoryProjectedFilterTests` | MMCA.Common.Infrastructure.Tests | 3 | EFReadRepository<TEntity, TIdentifierType>, NamedSoftDeleteTestDbContext, ProjectedTestEntity |
| 13 | `EFReadRepositoryReadSurfaceTests` | MMCA.Common.Infrastructure.Tests | 7 | EFReadRepository<TEntity, TIdentifierType>, HighestRankedBetaSpecification, LowestRankedBetaSpecification, NoMatchSpecification, SpecificationTestDbContext, SpecTestChild, SpecTestEntity |
| 13 | `EFReadRepositorySpecificationTests` | MMCA.Common.Infrastructure.Tests | 16 | AllSpecification, BetaSpecification, BetaSpecification, DeletedByNameSpecification, EFReadRepository<TEntity, TIdentifierType>, HighRankSpecification, IncludingSoftDeletedSpecification, IncludingSpecification, IncludingSpecification, ISpecification<TEntity, TIdentifierType>, NoMatchSpecification, SpecificationTestDbContext, SpecTestChild, SpecTestEntity, TopTwoByRankSpecification, TrackedSpecification |
| 13 | `ExclusionTestDbContext` | MMCA.Common.Infrastructure.Tests | 9 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, ExclusionAggregate, IEntityDataSourceRegistry, NullAssemblyProvider, NullAssemblyProvider, TestPhysicalDataSources |
| 13 | `FailingDatabaseFacade` | MMCA.Common.Infrastructure.Tests | 2 | AlwaysRetryExecutionStrategy, CommitFailingDbContext |
| 13 | `FailingSaveInterceptor` | MMCA.Common.Infrastructure.Tests | 1 | AuditTrailTestContext |
| 13 | `FailingSaveInterceptor` | MMCA.Common.Infrastructure.Tests | 1 | OutboxRoutingTestDbContext |
| 13 | `FixedEngineResolver` | MMCA.Common.Infrastructure.Tests | 4 | DataSource, DataSourceKey, IDataSourceResolver, PhysicalDataSource |
| 13 | `GrantTestContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, TestPhysicalDataSources |
| 13 | `InboxTestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, InboxMessage, TestPhysicalDataSources |
| 13 | `InternalCommandModelTests` | MMCA.Common.Infrastructure.Tests | 6 | ApplicationDbContext, DataSource, DataSourceKey, InternalCommandMessage, ModelTestContext, OutboxMessage |
| 13 | `InternalCommandTestContext` | MMCA.Common.Infrastructure.Tests | 11 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, InternalCommandMessage, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, TestPhysicalDataSources |
| 13 | `KeysetQueryBuilderNullOrderingTests` | MMCA.Common.Infrastructure.Tests | 3 | KeysetQueryBuilder, SpecificationTestDbContext, SpecTestEntity |
| 13 | `KeysetQueryBuilderSqlTests` | MMCA.Common.Infrastructure.Tests | 3 | KeysetQueryBuilder, SpecificationTestDbContext, SpecTestEntity |
| 13 | `MidSaveContextCreatingDbContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IOutboxSignal, ReentrantSaveInterceptor, TestPhysicalDataSources |
| 13 | `Mocks` | MMCA.Common.Infrastructure.Tests | 4 | IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IOutboxSignal |
| 13 | `Mocks` | MMCA.Common.Infrastructure.Tests | 3 | IDataSourceService, IDbContextFactory, IRepositoryFactory |
| 13 | `NoSessionTableContext` | MMCA.Common.Infrastructure.Tests | 6 | ApplicationDbContext, NullAssemblyProvider, NullAssemblyProvider, NullAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 13 | `OrderingTestContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NoAssemblies, OutboxMessage, TestPhysicalDataSources |
| 13 | `OutboxRoutingTestDbContext` | MMCA.Common.Infrastructure.Tests | 11 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FailingSaveInterceptor, IEntityDataSourceRegistry, NullAssemblyProvider, NullAssemblyProvider, OutboxMessage, TestAggregate, TestPhysicalDataSources |
| 13 | `OutboxTestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 13 | `PermissionGrantModelGateTests` | MMCA.Common.Infrastructure.Tests | 19 | AuditSaveChangesInterceptor, CaseMappingShape, CaseNamedSource, CaseNoOptIn, CaseOptedInDefaultSource, CaseSettingsOnly, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, GateContext<TCase>, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IOutboxSignal, PermissionGrant, PermissionGrantModelBuilderExtensions, PermissionGrantModelGate, PermissionGrantSettings, PhysicalDataSource |
| 13 | `PortableThingConfiguration` | MMCA.Common.Infrastructure.Tests | 3 | DataSource, EntityTypeConfiguration<TEntity, TIdentifierType>, PortableThing |
| 13 | `QueryShapeTestDbContext` | MMCA.Common.Infrastructure.Tests | 11 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, Product, TestPhysicalDataSources |
| 13 | `ReentrantSaveInterceptor` | MMCA.Common.Infrastructure.Tests | 1 | MidSaveContextCreatingDbContext |
| 13 | `RefreshSessionModelGateTests` | MMCA.Common.Infrastructure.Tests | 18 | AuditSaveChangesInterceptor, CaseDefaultSettings, CaseEnabledDefaultSource, CaseMappingShape, CaseNamedSource, CaseNoSettings, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, GateContext<TCase>, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IOutboxSignal, PhysicalDataSource, RefreshSession, RefreshSessionModelBuilderExtensions, RefreshSessionSettings |
| 13 | `RestoreTestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 13 | `SchedulerModelGateTests` | MMCA.Common.Infrastructure.Tests | 3 | DataSourceKey, GateTestContext, ScheduledJobEntry |
| 13 | `SchedulerTestContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, ScheduledJobEntry, TestPhysicalDataSources |
| 13 | `SessionCleanupTestContext` | MMCA.Common.Infrastructure.Tests | 5 | ApplicationDbContext, NullAssemblyProvider, NullAssemblyProvider, NullAssemblyProvider, TestPhysicalDataSources |
| 13 | `SingleContextFactory` | MMCA.Common.Infrastructure.Tests | 3 | ApplicationDbContext, DataSourceKey, IDbContextFactory |
| 13 | `SoftDeleteTestDbContext` | MMCA.Common.Infrastructure.Tests | 11 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, SoftDeletableEntity, SoftDeleteTestDbContext, TestPhysicalDataSources |
| 13 | `SpecificationEvaluatorTests` | MMCA.Common.Infrastructure.Tests | 11 | BetaSpecification, IncludingSpecification, OrderedSpecification, PagedSpecification, QueryTagScope, RankDescendingSpecification, SpecificationEvaluator, SpecificationTestDbContext, SpecTestChild, SpecTestEntity, UnorderedQuerySpecification |
| 13 | `SQLServerDbContextTests` | MMCA.Common.Infrastructure.Tests | 11 | AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyAssemblyProvider, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, OutboxSignal, PersistenceSettings, SQLServerDbContext, TestPhysicalDataSources |
| 13 | `StampTestDbContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, IEntityConfigurationAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 13 | `TenantTestContext` | MMCA.Common.Infrastructure.Tests | 17 | ApplicationDbContext, AuditSaveChangesInterceptor, AuditTrailEntry, AuditTrailSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, PlainThing, TenantOnlyThing, TenantSaveChangesInterceptor, TenantThing, TestPhysicalDataSources, TrailedTenantThing |
| 13 | `TestApplicationDbContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IOutboxSignal, TestEntity, TestPhysicalDataSources |
| 13 | `TestAuditDbContext` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, TestAuditEntity, TestOwnedAuditEntity, TestPhysicalDataSources |
| 13 | `TestDomainEventDbContext` | MMCA.Common.Infrastructure.Tests | 9 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IEntityDataSourceRegistry, NullAssemblyProvider, NullAssemblyProvider, TestAggregate, TestPhysicalDataSources |
| 13 | `TestNonOutboxContext` | MMCA.Common.Infrastructure.Tests | 9 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, TestPhysicalDataSources |
| 13 | `TestOutboxContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, OutboxMessage, TestPhysicalDataSources |
| 13 | `TransactionTestDbContext` | MMCA.Common.Infrastructure.Tests | 14 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, InternalCommandMessage, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, NullAssemblyProvider, OutboxMessage, TestAggregate, TestPhysicalDataSources |
| 13 | `UniqueIndexTestDbContext` | MMCA.Common.Infrastructure.Tests | 15 | AlreadySoftDeleteFilteredEntity, ApplicationDbContext, AuditSaveChangesInterceptor, BracketQuotedFilterEntity, DataSource, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FilteredIndexEntity, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, TestPhysicalDataSources, UniqueNamedEntity |
| 13 | `WidgetContext` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NoModuleAssemblies, TestPhysicalDataSources, Widget |
| 13 | `WrappedIdBareSqliteContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, NoAssemblies, TestPhysicalDataSources, WrappedIdContextServices |
| 13 | `WrappedIdPostgresContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, NoAssemblies, TestPhysicalDataSources, WrappedIdContextServices |
| 13 | `WrappedIdSqliteContext` | MMCA.Common.Infrastructure.Tests | 6 | ApplicationDbContext, NoAssemblies, TestPhysicalDataSources, WrappedIdContextServices, WrappedOrder, WrappedSpeaker |
| 13 | `WrappedIdSqlServerContext` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, NoAssemblies, TestPhysicalDataSources, WrappedIdContextServices |
| 13 | `LoadStack` | MMCA.Common.LoadTests | 5 | ApplicationDbContext, DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory |
| 13 | `ComponentsPageE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `DarkModeE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `DeleteConfirmationKeyboardE2ETests` | MMCA.Common.UI.E2E.Tests | 3 | GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `ForgotPasswordPageE2ETests` | MMCA.Common.UI.E2E.Tests | 5 | AxeOptions, ForgotPasswordPage, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `GridPageE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `LoginPageE2ETests` | MMCA.Common.UI.E2E.Tests | 5 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, LoginPage, PlaywrightFixture |
| 13 | `MobileNavKeyboardE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `MobileTopRowE2ETests` | MMCA.Common.UI.E2E.Tests | 3 | GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `NotificationPagesE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `PseudoLocalizationE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture, SupportedCultures |
| 13 | `RegisterPageE2ETests` | MMCA.Common.UI.E2E.Tests | 5 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture, RegisterPage |
| 13 | `ResetPasswordPageE2ETests` | MMCA.Common.UI.E2E.Tests | 5 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture, ResetPasswordPage |
| 13 | `SessionsPageE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `ShellPagesE2ETests` | MMCA.Common.UI.E2E.Tests | 4 | AxeOptions, GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `StickySidebarE2ETests` | MMCA.Common.UI.E2E.Tests | 3 | GalleryAxeTestBase, GalleryHostFixture, PlaywrightFixture |
| 13 | `WebVitalsE2ETests` | MMCA.Common.UI.E2E.Tests | 6 | GalleryAxeTestBase, GalleryHostFixture, InpProbe, PlaywrightFixture, WebVitalsBudget, WebVitalsSample |
| 13 | `SameOriginApiProxyEndpoint` | MMCA.Common.UI.Web | 11 | ICookieSessionRefresher, ISessionCookieStore, ProxyResponseMode, SameOriginApiProxySettings, SameOriginProxyHeaders, SameOriginProxyInvoker, SameOriginProxyTransformer, SessionClaimsToken, SessionCookieEndpoints, SessionRefreshOutcome, SessionRefreshStatus |
| 13 | `ServerTokenStorageService` | MMCA.Common.UI.Web | 6 | CookieTokenReader, ISessionAwareTokenRefresher, ISessionCookieSync, ITokenRefresher, ITokenStorageService, JwtTokenInfo |
| 13 | `SameOriginApiProxyAuthFlowTests` | MMCA.Common.UI.Web.Tests | 7 | FakeGateway, Jwt, LoginRequest, ProxyHost, SessionCookieEndpoints, SessionHandoffProtector, SessionTokenResponse |
| 13 | `SameOriginApiProxyCsrfTests` | MMCA.Common.UI.Web.Tests | 3 | FakeGateway, Jwt, ProxyHost |
| 13 | `SameOriginApiProxyHubTests` | MMCA.Common.UI.Web.Tests | 5 | Address, FakeGateway, Jwt, ProxyHost, SessionCookieEndpoints |
| 13 | `SameOriginApiProxyOptInTests` | MMCA.Common.UI.Web.Tests | 10 | FakeGateway, HandoffSessionCookieSync, HandoffTokenRefresher, ISessionCookieSync, ITokenRefresher, JsFetchSessionCookieSync, ProxyHost, SameOriginApiProxySettings, SameOriginProxyTokenRefresher, SessionCookieSettings |
| 13 | `SameOriginApiProxyOriginTests` | MMCA.Common.UI.Web.Tests | 3 | FakeGateway, Jwt, ProxyHost |
| 13 | `SameOriginApiProxyRefreshOutcomeTests` | MMCA.Common.UI.Web.Tests | 3 | FakeGateway, Jwt, ProxyHost |
| 13 | `SameOriginApiProxyTokenTests` | MMCA.Common.UI.Web.Tests | 4 | FakeGateway, Jwt, ProxyHost, SessionCookieEndpoints |
| 14 | `CreateQuestionHandler` | MMCA.ADC.Conference.Application | 11 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, Error, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUnitOfWork, Question, QuestionCreateRequest, QuestionDTO, QuestionDTOMapper, QuestionInvariants, Result, UnitOfWork |
| 14 | `CreateSessionHandler` | MMCA.ADC.Conference.Application | 14 | CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>, Error, Event, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IUniqueConstraintViolationDetector, IUnitOfWork, Result, Session, SessionCreateRequest, SessionDTO, SessionDTOMapper, SessionInvariants, SessionRoomScheduling, UnitOfWork |
| 14 | `DeleteSessionHandler` | MMCA.ADC.Conference.Application | 9 | DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType>, DeleteSessionAssetBlobInternalCommand, IInternalCommandScheduler, IUnitOfWork, Result, Session, SessionAsset, UnitOfWork |
| 14 | `LinkUserToSpeakerHandler` | MMCA.ADC.Conference.Application | 8 | Error, IUnitOfWork, LinkUserToSpeakerCommand, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Result, Speaker, SpeakerLinkedToUser, UnitOfWork |
| 14 | `RefreshFromSessionizeHandler` | MMCA.ADC.Conference.Application | 20 | CategorySyncStrategy, Error, Event, ICommandHandler<in TCommand, TResult>, IConcurrencyConflictDetector, ICurrentUserService, ISessionizeService, ISessionizeSyncStrategy, IUnitOfWork, QuestionSyncStrategy, RefreshFromSessionizeCommand, RefreshFromSessionizeResultDTO, Result, RoomSyncStrategy, SessionizeResponse, SessionizeSyncContext, SessionizeSyncResult, SessionSyncStrategy, SpeakerSyncStrategy, UnitOfWork |
| 14 | `RemoveRoomHandler` | MMCA.ADC.Conference.Application | 7 | Event, IUnitOfWork, RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>, RemoveRoomCommand, Result, Session, UnitOfWork |
| 14 | `UpdateEventQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 12 | Error, Event, EventQuestionAnswer, EventQuestionAnswerRules, ICurrentUserService, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Question, Result, RoleNames, UnitOfWork, UpdateEventQuestionAnswerCommand |
| 14 | `UpdateQuestionHandler` | MMCA.ADC.Conference.Application | 12 | Error, EventQuestionAnswer, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Question, QuestionDTO, QuestionDTOMapper, Result, SessionQuestionAnswer, SpeakerQuestionAnswer, UnitOfWork, UpdateQuestionCommand |
| 14 | `UpdateSessionQuestionAnswerHandler` | MMCA.ADC.Conference.Application | 13 | Error, Event, ICurrentUserService, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, Question, Result, RoleNames, Session, SessionQuestionAnswer, SessionQuestionAnswerRules, UnitOfWork, UpdateSessionQuestionAnswerCommand |
| 14 | `CategorySyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 10 | Category, CategorySyncStrategy, Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, SessionizeCategory, SessionizeCategoryItem, SessionizeResponse, SessionizeSyncContext, UnitOfWork |
| 14 | `QuestionSyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 11 | Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question, QuestionSyncStrategy, SessionizeQuestion, SessionizeQuestionAnswer, SessionizeResponse, SessionizeSpeaker, SessionizeSyncContext, UnitOfWork |
| 14 | `RoomSyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 10 | Event, EventInvariants, IReadRepository<TEntity, TIdentifierType>, IUnitOfWork, Room, RoomSyncStrategy, SessionizeResponse, SessionizeRoom, SessionizeSyncContext, UnitOfWork |
| 14 | `SessionSyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 12 | Event, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Session, SessionInvariants, SessionizeQuestionAnswer, SessionizeResponse, SessionizeSession, SessionizeSyncContext, Sessions, SessionSyncStrategy, UnitOfWork |
| 14 | `SpeakerSyncStrategyTests` | MMCA.ADC.Conference.Application.Tests | 14 | Event, EventSpeaker, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, SessionizeLink, SessionizeQuestionAnswer, SessionizeResponse, SessionizeSpeaker, SessionizeSyncContext, Speaker, SpeakerInvariants, SpeakerSyncStrategy, UnitOfWork |
| 14 | `ActivityConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | Activity, ActivityInvariants, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 14 | `CategoryItemConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | CategoryInvariants, CategoryItem, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 14 | `ConferenceCategoryConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | Category, CategoryInvariants, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 14 | `EventConfiguration` | MMCA.ADC.Conference.Infrastructure | 4 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Event, EventInvariants, NullableEmailValueConverter |
| 14 | `EventQuestionAnswerConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, EventInvariants, EventQuestionAnswer |
| 14 | `EventSpeakerConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, EventSpeaker |
| 14 | `PartnerConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Partner, PartnerInvariants |
| 14 | `QuestionConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Question, QuestionInvariants |
| 14 | `RoomConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, EventInvariants, Room |
| 14 | `SessionAiScoreConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionAiScore |
| 14 | `SessionAssetConfiguration` | MMCA.ADC.Conference.Infrastructure | 5 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Event, Session, SessionAsset, SessionAssetInvariants |
| 14 | `SessionCategoryItemConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionCategoryItem |
| 14 | `SessionConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Session, SessionInvariants |
| 14 | `SessionQuestionAnswerConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionInvariants, SessionQuestionAnswer |
| 14 | `SessionSpeakerConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionSpeaker |
| 14 | `SpeakerCategoryItemConfiguration` | MMCA.ADC.Conference.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SpeakerCategoryItem |
| 14 | `SpeakerConfiguration` | MMCA.ADC.Conference.Infrastructure | 4 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, NullableEmailValueConverter, Speaker, SpeakerInvariants |
| 14 | `SpeakerQuestionAnswerConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SpeakerInvariants, SpeakerQuestionAnswer |
| 14 | `SponsorConfiguration` | MMCA.ADC.Conference.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, Sponsor, SponsorInvariants |
| 14 | `ConferenceTestWebApplicationFactory` | MMCA.ADC.Conference.IntegrationTests | 9 | FakeAiScoringService, FakeBookmarkCountService, FakeSessionizeService, IAiScoringService, IBookmarkCountService, ISessionizeService, JwtTokenGenerator, Program, WebApplicationBuilderExtensions |
| 14 | `ConferenceCrossServiceFactory` | MMCA.ADC.CrossService.IntegrationTests | 3 | JwtTokenGenerator, Program, WebApplicationBuilderExtensions |
| 14 | `EngagementCrossServiceFactory` | MMCA.ADC.CrossService.IntegrationTests | 3 | JwtTokenGenerator, Program, WebApplicationBuilderExtensions |
| 14 | `IdentityCrossServiceFactory` | MMCA.ADC.CrossService.IntegrationTests | 1 | Program |
| 14 | `NotificationCrossServiceFactory` | MMCA.ADC.CrossService.IntegrationTests | 5 | FakeCrossServiceAttendeeQueryService, IAttendeeQueryService, JwtTokenGenerator, Program, WebApplicationBuilderExtensions |
| 14 | `ModerateQuestionHandler` | MMCA.ADC.Engagement.Application | 20 | BestEffort, Error, IEventLiveValidationService, ILiveChannelPublishQueue, IUnitOfWork, LiveChannelPublishWorkItem, LivePollAuthorization, LivePollChannel, ModerateQuestionCommand, ModerationAction, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, QuestionStatus, Result, SessionQuestion, SessionQuestionAnsweredPayload, SessionQuestionApprovedPayload, SessionQuestionChannel, SessionQuestionDismissedPayload, SessionQuestionPendingCountChangedPayload, UnitOfWork |
| 14 | `AttendeeBadgeConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | AttendeeBadge, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 14 | `CheckInConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | CheckIn, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 14 | `LeaderboardOptInConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, LeaderboardOptIn |
| 14 | `LivePollConfiguration` | MMCA.ADC.Engagement.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, LivePoll, LivePollInvariants |
| 14 | `LivePollOptionConfiguration` | MMCA.ADC.Engagement.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, LivePollInvariants, LivePollOption |
| 14 | `LivePollVoteConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, LivePollVote |
| 14 | `PointsEntryConfiguration` | MMCA.ADC.Engagement.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, PointsEntry, PointsSubjectKeys |
| 14 | `SessionQuestionConfiguration` | MMCA.ADC.Engagement.Infrastructure | 3 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionQuestion, SessionQuestionInvariants |
| 14 | `SessionQuestionUpvoteConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SessionQuestionUpvote |
| 14 | `UserSessionBookmarkConfiguration` | MMCA.ADC.Engagement.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, UserSessionBookmark |
| 14 | `EngagementTestWebApplicationFactory` | MMCA.ADC.Engagement.IntegrationTests | 9 | FakeEventLiveValidationService, FakeSessionBookmarkValidationService, IEventLiveValidationService, ILiveChannelPublisher, ISessionBookmarkValidationService, JwtTokenGenerator, NullLiveChannelPublisher, Program, WebApplicationBuilderExtensions |
| 14 | `GatewayApplicationFactory` | MMCA.ADC.Gateway.Tests | 3 | ProductionHostApplicationFactory<TEntryPoint>, Program, RecordingHttpForwarder |
| 14 | `GracefulShutdownTests` | MMCA.ADC.Gateway.Tests | 2 | GracefulShutdownTestsBase<TEntryPoint>, Program |
| 14 | `LegalPagesTests` | MMCA.ADC.Gateway.Tests | 2 | ProductionHostApplicationFactory<TEntryPoint>, Program |
| 14 | `PrivacyPageContrastTests` | MMCA.ADC.Gateway.Tests | 2 | ProductionHostApplicationFactory<TEntryPoint>, Program |
| 14 | `RobotsTxtTests` | MMCA.ADC.Gateway.Tests | 2 | ProductionHostApplicationFactory<TEntryPoint>, Program |
| 14 | `RouteMapApplicationFactory` | MMCA.ADC.Gateway.Tests | 2 | Program, RecordingHttpForwarder |
| 14 | `SecurityHeadersTests` | MMCA.ADC.Gateway.Tests | 3 | ProductionHostApplicationFactory<TEntryPoint>, Program, SecurityHeadersTestsBase |
| 14 | `AuthenticationService` | MMCA.ADC.Identity.Application | 19 | AuthenticationResponse, AuthenticationServiceBase<TUser>, AuthenticationValidators, Email, EmailConfirmationSettings, Error, IAuthenticationService, IAuthSessionIssuer, IExternalLoginEmailVerifier, ILoginProtectionService, IPasswordHasher, IUnitOfWork, RegisterRequest, Result, TokenService, UnitOfWork, User, UserRegistered, UserRole |
| 14 | `ForgotPasswordHandler` | MMCA.ADC.Identity.Application | 9 | Email, ForgotPasswordCommand, ForgotPasswordHandlerBase<TUser, TCommand>, IEmailSender, IPasswordResetTokenService, IUnitOfWork, PasswordResetSettings, UnitOfWork, User |
| 14 | `SendEmailConfirmationHandler` | MMCA.ADC.Identity.Application | 9 | Email, EmailConfirmationSettings, IEmailConfirmationTokenService, IEmailSender, IUnitOfWork, SendEmailConfirmationCommand, SendEmailConfirmationHandlerBase<TUser, TCommand>, UnitOfWork, User |
| 14 | `UserConfiguration` | MMCA.ADC.Identity.Infrastructure | 4 | EmailValueConverter, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, User, UserInvariants |
| 14 | `RefreshSessionModelGateTests` | MMCA.ADC.Identity.Infrastructure.Tests | 19 | AuditSaveChangesInterceptor, CaseConference, CaseIdentity, CaseWrongSource, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceKey, DataSourceResolver, DataSourcesSettings, DomainEventSaveChangesInterceptor, GateContext<TCase>, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IOutboxSignal, PhysicalDataSource, RefreshSession, RefreshSessionSettings |
| 14 | `IdentityTestWebApplicationFactory` | MMCA.ADC.Identity.IntegrationTests | 6 | FakeUserEngagementExportService, FakeUserNotificationExportService, IUserEngagementExportService, IUserNotificationExportService, PiiCaptureLoggerProvider, Program |
| 14 | `NotificationTestWebApplicationFactory` | MMCA.ADC.Notification.IntegrationTests | 5 | FakeAttendeeQueryService, IAttendeeQueryService, JwtTokenGenerator, Program, WebApplicationBuilderExtensions |
| 14 | `ConferenceUiHostApplicationFactory` | MMCA.ADC.UI.Web.Tests | 2 | ProductionHostApplicationFactory<TEntryPoint>, Program |
| 14 | `DependencyInjection` | MMCA.Common.API | 28 | CookieSessionRefresher, CookieTokenReader, CurrencyJsonConverter, CurrentUserTargetingContextAccessor, DbUpdateExceptionHandler, DisabledFeatureHandler, DomainExceptionHandler, EnumerationJsonConverterFactory, ErrorLocalizer, ErrorResources, ErrorResourceSource, GlobalExceptionHandler, ICookieSessionRefresher, IdempotencyFilter, IdempotencySettings, IErrorLocalizer, ISessionCookieStore, ModuleControllerFeatureProvider, ModuleLoader, ModulesSettings …(+8) |
| 14 | `SessionCookieAuthenticationExtensions` | MMCA.Common.API | 1 | SessionCookieAuthenticationHandler |
| 14 | `InitTestMigratedWidgetConfiguration` | MMCA.Common.API.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, InitTestMigratedWidget |
| 14 | `InitTestWidgetConfiguration` | MMCA.Common.API.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, InitTestWidget |
| 14 | `RefresherHarness` | MMCA.Common.API.Tests | 4 | CookieSessionRefresher, SessionCookieSettings, StubHttpClientFactory, StubHttpMessageHandler |
| 14 | `SessionCookieAuthenticationHandlerTests` | MMCA.Common.API.Tests | 4 | CookieTokenReader, FakeTimeProvider, SessionCookieAuthenticationHandler, SessionCookieEndpoints |
| 14 | `MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>` | MMCA.Common.Application | 7 | AuditableAggregateRootEntity<TIdentifierType>, ICommandHandler<in TCommand, TResult>, IUnitOfWork, MutateEntityHandlerCore<TCommand, TEntity, TIdentifierType>, MutationContext, Result, UnitOfWork |
| 14 | `Harness` | MMCA.Common.Application.Tests | 25 | AuthClaimTypes, AuthenticationValidators, ConfirmableAuthenticationService, ConfirmableAuthUser, EmailConfirmationSettings, FixedClock, ILoginProtectionService, InMemoryRefreshSessionStore, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, ITwoFactorAuthenticator, IUnitOfWork, LegalAcceptanceOptions, LoginRequest, RefreshSession, RefreshSessionSettings, RefreshTokenRequest, RegisterRequest, Result …(+5) |
| 14 | `Harness` | MMCA.Common.Application.Tests | 8 | IRepository<TEntity, TIdentifierType>, IUnitOfWork, IUpdatePropertySetter<TEntity>, MarkAllNotificationsReadHandler, PushNotification, RecordingSetter, UnitOfWork, UserNotification |
| 14 | `TestRetryingRenameHandler` | MMCA.Common.Application.Tests | 7 | Error, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, OrderAggregate, RenameOrderCommand, Result, UnitOfWork |
| 14 | `DataResidencyTestsBaseTests` | MMCA.Common.Architecture.Tests | 1 | Probe |
| 14 | `DbContextFactory` | MMCA.Common.Infrastructure | 24 | AmbientOrigin, ApplicationDbContext, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EnrolledCommandWake, Entry, ExplicitKeyInsertGroup, ExplicitKeyInsertRoundOrder, ICorrelationContext, ICurrentUserService, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, IExplicitKeyInsertDialect, InternalCommandMessage, IPhysicalDbContextFactory, ITenantContext, OutboxOrigin, PhysicalDataSource …(+4) |
| 14 | `DesignTimeDbContextHelper` | MMCA.Common.Infrastructure | 28 | AuditSaveChangesInterceptor, AuditTrailSaveChangesInterceptor, AuditTrailSettings, DataSource, DataSourceKey, DataSourceResolver, DataSourcesSettings, DesignTimeDbContextOptions, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, ExplicitAssemblyProvider, IDataSourceResolver, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IOutboxSignal, NullDomainEventDispatcher, OutboxSignal, PermissionGrantModelGate, PermissionGrantSettings …(+8) |
| 14 | `IdentityModuleDbSeederBase<TUser>` | MMCA.Common.Infrastructure | 9 | AuditableAggregateRootEntity<TIdentifierType>, DbSeeder, Email, IPasswordHasher, IUnitOfWork, PasswordHasher, Result, SeedAccount, UnitOfWork |
| 14 | `PushNotificationConfiguration` | MMCA.Common.Infrastructure | 4 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, PushNotification, PushNotificationInvariants, SoftDeleteFilterSql |
| 14 | `RepositoryFactory` | MMCA.Common.Infrastructure | 10 | ApplicationSettings, AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, EFReadRepository<TEntity, TIdentifierType>, EFReadRepositoryDecorator<TEntity, TIdentifierType>, EFRepository<TEntity, TIdentifierType>, EFRepositoryDecorator<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRepositoryFactory |
| 14 | `TenantDataSourceTargets` | MMCA.Common.Infrastructure | 5 | DataSourceKey, ITenantContext, TenancySettings, TenancySettingsValidator, TenantDataSourceTarget |
| 14 | `UserNotificationConfiguration` | MMCA.Common.Infrastructure | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, UserNotification |
| 14 | `FixedAssemblyProvider` | MMCA.Common.Infrastructure.PostgreSQL.Tests | 2 | IEntityConfigurationAssemblyProvider, PostgreSQLPersistenceTests |
| 14 | `PgThingConfiguration` | MMCA.Common.Infrastructure.PostgreSQL.Tests | 2 | EntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>, PgThing |
| 14 | `PostgreSQLPersistenceTests` | MMCA.Common.Infrastructure.PostgreSQL.Tests | 20 | ApplicationDbContext, AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceKey, DataSourceResolver, DataSourcesSettings, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, OutboxMessage, OutboxSignal, PgThing, PgThingCreated, PhysicalDbContextFactory, RecordingDomainEventDispatcher |
| 14 | `SqlThingConfiguration` | MMCA.Common.Infrastructure.SQLServer.Tests | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SqlThing |
| 14 | `AddMultiTenancyTests` | MMCA.Common.Infrastructure.Tests | 11 | ConnectionStringSettings, DataSourceResolver, DataSourcesSettings, ITenantContext, TenancySettings, TenancySettingsValidator, TenantContext, TenantDataSourceOverrideSettings, TenantEntrySettings, TenantResolutionStrategy, TenantSaveChangesInterceptor |
| 14 | `AddScheduledJobsTests` | MMCA.Common.Infrastructure.Tests | 5 | FirstJob, IScheduledJob, ScheduledJobRunner, SchedulerSettings, SecondJob |
| 14 | `ApplicationDbContextTenantFilterTests` | MMCA.Common.Infrastructure.Tests | 8 | ApplicationDbContext, EFReadRepository<TEntity, TIdentifierType>, IAuditableEntity, PlainThing, TenantDetail, TenantOnlyThing, TenantTestContext, TenantThing |
| 14 | `ApplicationDbContextTests` | MMCA.Common.Infrastructure.Tests | 4 | ApplicationDbContext, DataSource, TestApplicationDbContext, TestEntity |
| 14 | `AuditSaveChangesInterceptorTests` | MMCA.Common.Infrastructure.Tests | 7 | Address, AuditSaveChangesInterceptor, FakeTimeProvider, TestAddress, TestAuditDbContext, TestAuditEntity, TestOwnedAuditEntity |
| 14 | `AuditTrailSaveChangesInterceptorTests` | MMCA.Common.Infrastructure.Tests | 17 | Address, AuditedAggregateThing, AuditedThing, AuditTrailEntry, AuditTrailSaveChangesInterceptor, AuditTrailTestContext, AuditTrailTestHarness, CompositeKeyThing, Email, FakeTimeProvider, InboxMessage, OutboxMessage, OverridingPiiThing, PiiRedactor, PlainThing, ScheduledJobEntry, ThingAddress |
| 14 | `BrokerEventBusTests` | MMCA.Common.Infrastructure.Tests | 19 | ApplicationDbContext, AuditSaveChangesInterceptor, BrokerEventBus, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEntityDataSourceRegistry, IIntegrationEvent, IOutboxSignal, Mocks, OutboxMessage, OutboxSettings, TestIntegrationEvent, TestNonOutboxContext, TestOutboxContext |
| 14 | `BrokerMessageBusTests` | MMCA.Common.Infrastructure.Tests | 9 | BrokerMessageBus, ICorrelationContext, ICurrentUserService, IIntegrationEvent, ITenantContext, MessageHeaders, Mocks, OtherIntegrationEvent, TestIntegrationEvent |
| 14 | `CronosNextOccurrenceTests` | MMCA.Common.Infrastructure.Tests | 1 | ScheduledJobRunner |
| 14 | `DataSourceResolverTests` | MMCA.Common.Infrastructure.Tests | 9 | AuditTrailSettings, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceKey, DataSourceResolver, DataSourcesSettings, OutboxSettings, SchedulerSettings |
| 14 | `DependencyInjectionBrokerMessagingTests` | MMCA.Common.Infrastructure.Tests | 6 | EfInboxStore, IInboxStore, InboxDisabledWarningService, MessageBusSettings, NoOpInboxStore, OrderPlacedConsumer |
| 14 | `DependencyInjectionTests` | MMCA.Common.Infrastructure.Tests | 23 | CorrelationContext, CurrentUserService, DistributedCacheService, EntityConfigurationOptions, ICacheService, ICorrelationContext, ICurrentUserService, IDistributedLock, IEmailSender, IEventBus, ILiveChannelPublisher, InProcessDistributedLock, InProcessEventBus, IPasswordHasher, IPushNotificationSender, ITokenService, MemoryCacheService, NullLiveChannelPublisher, NullPushNotificationSender, PasswordHasher …(+3) |
| 14 | `DesignAlphaEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | DesignAlphaEntity, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 14 | `DesignBetaEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | DesignBetaEntity, EntityTypeConfigurationSQLServer<TEntity, TIdentifierType> |
| 14 | `DesignPostgreSQLEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | DesignPostgreSQLEntity, EntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType> |
| 14 | `DesignSqliteEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | DesignSqliteEntity, EntityTypeConfigurationSqlite<TEntity, TIdentifierType> |
| 14 | `DomainEventCaptureExclusionTests` | MMCA.Common.Infrastructure.Tests | 8 | DomainEventSaveChangesInterceptor, ExclusionAggregate, ExclusionEvent, ExclusionTestDbContext, IDomainEvent, IDomainEventDispatcher, IOutboxSignal, MessageBusSettings |
| 14 | `DomainEventSaveChangesInterceptorLocalLeaseTests` | MMCA.Common.Infrastructure.Tests | 10 | DomainEventSaveChangesInterceptor, FakeTimeProvider, IDomainEvent, IDomainEventDispatcher, IOutboxSignal, OutboxMessage, OutboxRoutingTestDbContext, TestAggregate, TestIntegrationEvent, TestLocalEvent |
| 14 | `DomainEventSaveChangesInterceptorOutboxRoutingTests` | MMCA.Common.Infrastructure.Tests | 11 | DomainEventSaveChangesInterceptor, FakeTimeProvider, IDomainEvent, IDomainEventDispatcher, IOutboxSignal, OutboxMessage, OutboxRoutingTestDbContext, TestAggregate, TestIntegrationEvent, TestLocalEvent, TestOrderedEvent |
| 14 | `DomainEventSaveChangesInterceptorTests` | MMCA.Common.Infrastructure.Tests | 8 | DomainEventSaveChangesInterceptor, IDomainEvent, IDomainEventDispatcher, IOutboxSignal, MessageBusSettings, TestAggregate, TestDomainEvent, TestDomainEventDbContext |
| 14 | `EfInboxStoreTests` | MMCA.Common.Infrastructure.Tests | 17 | ApplicationDbContext, AuditSaveChangesInterceptor, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EfInboxStore, EmptyEntityDataSourceRegistry, FakeTimeProvider, IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, InboxMessage, InboxTestDbContext, IOutboxSignal, OutboxSettings |
| 14 | `EFPermissionGrantStoreTests` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, DataSourceKey, EFPermissionGrantStore, EmptyEntityDataSourceRegistry, GrantTestContext, IDataSourceResolver, IDbContextFactory, PermissionGrant, PermissionGrantSettings, SqlServerUniqueConstraintViolationDetector |
| 14 | `EFRawSqlQueryExecutorTests` | MMCA.Common.Infrastructure.Tests | 7 | DataSource, EFRawSqlQueryExecutor, FixedEngineResolver, SingleContextFactory, Widget, WidgetContext, WidgetRow |
| 14 | `EFReadRepositoryGetByIdFilterTests` | MMCA.Common.Infrastructure.Tests | 4 | EFReadRepository<TEntity, TIdentifierType>, SoftDeletableTestEntity, SoftDeleteTestDbContext, SoftDeleteTestDbContext |
| 14 | `EFRepositoryAdditionalTests` | MMCA.Common.Infrastructure.Tests | 3 | EFRepository<TEntity, TIdentifierType>, TestDbContext, TestEntity |
| 14 | `EFRepositoryConcurrencyTouchTests` | MMCA.Common.Infrastructure.Tests | 3 | EFRepository<TEntity, TIdentifierType>, TestDbContext, TestEntity |
| 14 | `EFRepositoryIntegrationTests` | MMCA.Common.Infrastructure.Tests | 8 | EFReadRepository<TEntity, TIdentifierType>, EFRepository<TEntity, TIdentifierType>, FakeTimeProvider, IAuditableEntity, ICurrentUserService, TestChildEntity, TestDbContext, TestEntity |
| 14 | `FixedAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 2 | IEntityConfigurationAssemblyProvider, PostgreSQLDbContextModelTests |
| 14 | `InProcessEventBusOutboxTests` | MMCA.Common.Infrastructure.Tests | 12 | DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, InProcessEventBus, MessageBusSettings, OutboxMessage, OutboxSettings, TestIntegrationEvent, TestOutboxContext |
| 14 | `InProcessEventBusTests` | MMCA.Common.Infrastructure.Tests | 10 | DataSource, DataSourceKey, IDataSourceResolver, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, IIntegrationEvent, InProcessEventBus, OutboxSettings, TestNonOutboxContext |
| 14 | `InProcessMessageBusTests` | MMCA.Common.Infrastructure.Tests | 16 | DomainEventDispatcher, IDomainEvent, IDomainEventDispatcher, IDomainEventHandler<in TDomainEvent>, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent>, InProcessMessageBus, Mocks, RecordingDomainHandler, RecordingIntegrationHandler, RecordingOriginalHandler, RecordingSuccessorHandler, RetiredTestIntegrationEvent, RetiredToV2Upcaster, TestIntegrationEvent, TestIntegrationEventV2 |
| 14 | `MarkAllNotificationsReadHandlerTrackingTests` | MMCA.Common.Infrastructure.Tests | 9 | EFRepository<TEntity, TIdentifierType>, IUnitOfWork, MarkAllNotificationsReadCommand, MarkAllNotificationsReadHandler, NotificationTestDbContext, PushNotification, Result, SeededIds, UserNotification |
| 14 | `MultiSourceCustomerConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, MultiSourceCustomer |
| 14 | `MultiSourceOrderConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, MultiSourceOrder |
| 14 | `PortablePrincipalConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, PortablePrincipal |
| 14 | `PostgreSQLDbContextModelTests` | MMCA.Common.Infrastructure.Tests | 21 | ApplicationDbContext, AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceResolver, DataSourcesSettings, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, OutboxMessage, OutboxSignal, PhysicalDbContextFactory, PostgreSQLDbContext, PostgresThing, SqlServerThing …(+1) |
| 14 | `PostgresThingConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>, PostgresThing |
| 14 | `QueryParameterizationTests` | MMCA.Common.Infrastructure.Tests | 3 | QueryFieldService, QueryFilterService, QueryShapeTestDbContext |
| 14 | `RegistryDuplicateConfigurationA` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryDuplicate |
| 14 | `RegistryDuplicateConfigurationB` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryDuplicate |
| 14 | `RegistryInvoiceConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryInvoice |
| 14 | `RegistryOrderConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, RegistryOrder |
| 14 | `RegistrySqlServerEntityConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, RegistrySqlServerEntity |
| 14 | `RestrictDeleteByDefaultConventionTests` | MMCA.Common.Infrastructure.Tests | 6 | CascadingChild, DeleteBehaviorTestDbContext, OptionalChild, Parent, RequiredChild, RestrictDeleteByDefaultConvention |
| 14 | `SaveChangeDetectionTests` | MMCA.Common.Infrastructure.Tests | 3 | DetectionTestDbContext, Widget, Widget |
| 14 | `ScheduledJobRunnerTests` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, DataSource, DelegateScheduledJob, FakeTimeProvider, IDataSourceResolver, ScheduledJobEntry, ScheduledJobOverrideSettings, ScheduledJobRunner, SchedulerSettings, SchedulerTestContext |
| 14 | `SchedulerTestHarness` | MMCA.Common.Infrastructure.Tests | 9 | ApplicationDbContext, DataSource, DataSourceKey, FakeTimeProvider, IDataSourceResolver, IDbContextFactory, IScheduledJob, ScheduledJobRunner, SchedulerSettings |
| 14 | `SoftDeleteQueryFilterTests` | MMCA.Common.Infrastructure.Tests | 2 | SoftDeletableEntity, SoftDeleteTestDbContext |
| 14 | `SoftDeleteUniqueIndexConventionTests` | MMCA.Common.Infrastructure.Tests | 5 | AlreadySoftDeleteFilteredEntity, BracketQuotedFilterEntity, FilteredIndexEntity, UniqueIndexTestDbContext, UniqueNamedEntity |
| 14 | `SqliteTestEntityConfig` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, SqliteTestEntity |
| 14 | `SqlServerThingConfiguration` | MMCA.Common.Infrastructure.Tests | 2 | EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>, SqlServerThing |
| 14 | `StampTestDbContext` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, AuditSaveChangesInterceptor, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NullAssemblyProvider, NullAssemblyProvider, StampedEntity, StampTestDbContext, TestPhysicalDataSources |
| 14 | `StronglyTypedIdPersistenceTests` | MMCA.Common.Infrastructure.Tests | 15 | ApplicationDbContext, CustomerId, LineId, NullableStronglyTypedIdValueConverter<TSelf, TValue>, OrderId, QueryFilterService, SpeakerId, StronglyTypedIdValueComparer<TSelf>, StronglyTypedIdValueConverter<TSelf, TValue>, WrappedIdBareSqliteContext, WrappedIdPostgresContext, WrappedIdSqliteContext, WrappedIdSqlServerContext, WrappedOrder, WrappedSpeaker |
| 14 | `SweepHarness` | MMCA.Common.Infrastructure.Tests | 14 | ApplicationDbContext, DataSourceKey, DefaultDataSourceResolver, EmptyEntityDataSourceRegistry, FakeClockLoop, FakeTimeProvider, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, NoSessionTableContext, RefreshSession, RefreshSessionCleanupService, RefreshSessionSettings, SessionCleanupTestContext |
| 14 | `TenantSaveChangesInterceptorTests` | MMCA.Common.Infrastructure.Tests | 5 | CrossTenantWriteException, PlainThing, TenantTestContext, TenantThing, TrailedTenantThing |
| 14 | `UnitOfWorkAdditionalTests` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, DataSource, DataSourceKey, FakeAggregate, FakeEntity, IDataSourceService, IDbContextFactory, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRepositoryFactory, Mocks, UnitOfWork |
| 14 | `UnitOfWorkTests` | MMCA.Common.Infrastructure.Tests | 13 | ApplicationDbContext, DataSource, DataSourceKey, FakeAggregate, FakeEntity, IDataSourceService, IDbContextFactory, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IRepositoryFactory, IUniqueConstraintViolationDetector, Mocks, UnitOfWork |
| 14 | `LoadItemConfiguration` | MMCA.Common.LoadTests | 2 | EntityTypeConfigurationSqlite<TEntity, TIdentifierType>, LoadItem |
| 14 | `PagedQueryFixture` | MMCA.Common.LoadTests | 11 | EntityQueryService<TEntity, TEntityDTO, TIdentifierType>, IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>, IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>, INavigationPopulator<in TEntity>, LoadItem, LoadItemDTO, LoadItemMapper, LoadItemNavigationPopulator, LoadStack, PagedCollectionResult<T>, PagedQuery |
| 14 | `HandlerTestBase<THandler>` | MMCA.Common.Testing | 6 | AuditableAggregateRootEntity<TIdentifierType>, AuditableBaseEntity<TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, UnitOfWork |
| 14 | `DependencyInjection` | MMCA.Common.UI.Web | 12 | ApiSettings, BlazorCspPolicyProvider, BlazorCspSettings, BlazorCspSettingsValidator, BrowserOriginHandler, GatewayRateLimitingSettings, ICspPolicyProvider, IFormFactor, ITokenStorageService, ServerTokenStorageService, TrustedCallerHandler, WebFormFactor |
| 14 | `SameOriginApiProxyServiceExtensions` | MMCA.Common.UI.Web | 12 | ApiSettings, HandoffSessionCookieSync, HandoffTokenRefresher, ISessionCookieSync, ITokenRefresher, SameOriginApiProxyEndpoint, SameOriginApiProxyMarker, SameOriginApiProxySettings, SameOriginApiProxySettingsValidator, SameOriginProxyInvoker, SessionCookieSettings, SessionHandoffProtector |
| 14 | `SessionHandoffEndpoints` | MMCA.Common.UI.Web | 5 | HandoffBody, ICookieSessionRefresher, ISessionCookieStore, SameOriginApiProxyEndpoint, SessionHandoffProtector |
| 14 | `ServerTokenStorageServiceTests` | MMCA.Common.UI.Web.Tests | 9 | CookieTokenReader, ISessionAwareTokenRefresher, ISessionCookieSync, ITokenRefresher, ManualClock, Mocks, ServerTokenStorageService, SessionCookieEndpoints, TokenAcquisition |
| 14 | `WebFormFactorTests` | MMCA.Common.UI.Web.Tests | 5 | ICspPolicyProvider, IFormFactor, ITokenStorageService, ServerTokenStorageService, WebFormFactor |
| 15 | `ServiceModels` | MMCA.ADC.Architecture.Tests | 3 | DataSourceEntrySettings, DefaultEntityConfigurationAssemblyProvider, DesignTimeDbContextHelper |
| 15 | `AddRoomHandler` | MMCA.ADC.Conference.Application | 13 | AddRoomCommand, Error, Event, EventInvariants, IEntityQuerier<TEntity, TIdentifierType>, IUnitOfWork, MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>, MutationContext, Result, Room, RoomDTO, RoomDTOMapper, UnitOfWork |
| 15 | `DependencyInjection` | MMCA.ADC.Conference.Application | 84 | Activity, ActivityCreateRequest, ActivityDTO, ActivityNavigationPopulator, ActivityUpdateRequest, ApplicationSettings, Category, CategoryItem, CategoryItemDTO, CategoryItemNavigationPopulator, ClassReference, ClassReference, ConferenceCategoryCreateRequest, ConferenceCategoryDTO, ConferenceCategoryEntityQueryService, ConferenceCategoryNavigationPopulator, ConferenceCategoryUpdateRequest, DeleteConferenceCategoryHandler, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEntityHandler<TEntity, TIdentifierType> …(+64) |
| 15 | `UpdateEventHandler` | MMCA.ADC.Conference.Application | 11 | Event, EventDTOMapper, IEntityReader<TEntity, TIdentifierType>, IUnitOfWork, MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>, MutationContext, Result, Session, UnitOfWork, UpdateEventCommand, UpdateEventResult |
| 15 | `UpdateSessionHandler` | MMCA.ADC.Conference.Application | 13 | Error, Event, IEntityReader<TEntity, TIdentifierType>, IUnitOfWork, MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>, MutationContext, Result, Session, SessionDTOMapper, SessionRoomScheduling, UnitOfWork, UpdateSessionCommand, UpdateSessionResult |
| 15 | `ActivityNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | Activity, ActivityNavigationPopulator, HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, UnitOfWork |
| 15 | `ActivityUpdateApplierTests` | MMCA.ADC.Conference.Application.Tests | 11 | Activity, ActivityDTO, ActivityDTOMapper, ActivityUpdateApplier, ActivityUpdateRequest, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 15 | `AddCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddCategoryItemCommand, AddCategoryItemHandler, Category, CategoryItemDTOMapper, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork |
| 15 | `AddEventQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | AddEventQuestionAnswerCommand, AddEventQuestionAnswerHandler, ErrorType, Event, EventQuestionAnswerDTOMapper, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Question, UnitOfWork |
| 15 | `AddEventSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | AddEventSpeakerCommand, AddEventSpeakerHandler, ErrorType, Event, EventSpeakerDTOMapper, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, UnitOfWork |
| 15 | `AddSessionAssetLinkHandlerTests` | MMCA.ADC.Conference.Application.Tests | 12 | AddSessionAssetLinkCommand, AddSessionAssetLinkHandler, Error, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, ISessionAssetAccessService, Result, SessionAsset, SessionAssetDTOMapper, SessionAssetKind, SessionAssetLinkRequest, UnitOfWork |
| 15 | `AddSessionCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddSessionCategoryItemCommand, AddSessionCategoryItemHandler, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionCategoryItemDTOMapper, UnitOfWork |
| 15 | `AddSessionQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | AddSessionQuestionAnswerCommand, AddSessionQuestionAnswerHandler, ErrorType, Event, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Question, Session, SessionQuestionAnswerDTOMapper, UnitOfWork |
| 15 | `AddSessionSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddSessionSpeakerCommand, AddSessionSpeakerHandler, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionSpeakerDTOMapper, UnitOfWork |
| 15 | `AddSpeakerCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | AddSpeakerCategoryItemCommand, AddSpeakerCategoryItemHandler, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Speaker, SpeakerCategoryItemDTOMapper, UnitOfWork |
| 15 | `BatchAddEventQuestionAnswersHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | BatchAddEventQuestionAnswersCommand, BatchAddEventQuestionAnswersHandler, BatchEventQuestionAnswerItem, ErrorType, Event, EventFeedbackSubmitted, EventQuestionAnswerDTOMapper, FakeTimeProvider, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Question, UnitOfWork |
| 15 | `BatchAddSessionQuestionAnswersHandlerTests` | MMCA.ADC.Conference.Application.Tests | 14 | BatchAddSessionQuestionAnswersCommand, BatchAddSessionQuestionAnswersHandler, BatchSessionQuestionAnswerItem, ErrorType, Event, FakeTimeProvider, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Question, Session, SessionFeedbackSubmitted, SessionQuestionAnswerDTOMapper, UnitOfWork |
| 15 | `CategoryItemNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | CategoryItem, CategoryItemNavigationPopulator, HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, UnitOfWork |
| 15 | `ConferenceCategoryEntityQueryServiceTests` | MMCA.ADC.Conference.Application.Tests | 13 | Category, CategoryItemDTOMapper, ConferenceCategoryDTO, ConferenceCategoryDTOMapper, ConferenceCategoryEntityQueryService, EntityQueryParameters<TEntity>, HandlerTestBase<THandler>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IReadRepository<TEntity, TIdentifierType>, NavigationMetadata, UnitOfWork |
| 15 | `ConferenceCategoryNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | Category, ConferenceCategoryNavigationPopulator, HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, UnitOfWork |
| 15 | `ConferenceCategoryUpdateApplierTests` | MMCA.ADC.Conference.Application.Tests | 12 | Category, CategoryItemDTOMapper, ConferenceCategoryDTO, ConferenceCategoryDTOMapper, ConferenceCategoryUpdateApplier, ConferenceCategoryUpdateRequest, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 15 | `ConferenceCrudRegistrationTests` | MMCA.ADC.Conference.Application.Tests | 29 | Activity, ActivityCreateRequest, ActivityDTO, ActivityUpdateRequest, ApplicationSettings, Category, CommandRequestValidator<TCommand, TRequest>, ConferenceCategoryDTO, ConferenceCategoryUpdateRequest, CreateActivityHandler, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteSessionHandler, ICommandHandler<in TCommand, TResult>, IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>, IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>, Partner, PartnerDTO, PartnerUpdateRequest, Result, Session …(+9) |
| 15 | `CreateActivityHandlerTests` | MMCA.ADC.Conference.Application.Tests | 12 | Activity, ActivityCreateRequest, ActivityDTOMapper, CreateActivityHandler, Error, ErrorType, Event, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Result, UnitOfWork |
| 15 | `CreateConferenceCategoryHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | Category, CategoryItemDTOMapper, ConferenceCategoryCreateRequest, ConferenceCategoryDTOMapper, CreateConferenceCategoryHandler, Error, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Result, UnitOfWork |
| 15 | `CreateEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | CreateEventHandler, Error, Event, EventCreateRequest, EventDTOMapper, EventQuestionAnswerDTOMapper, EventSpeakerDTOMapper, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Result, RoomDTOMapper, UnitOfWork |
| 15 | `CreatePartnerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 14 | CreatePartnerHandler, Error, ErrorType, Event, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Partner, PartnerCreateRequest, PartnerCreateRequestMapper, PartnerDTOMapper, PartnerType, Result, UnitOfWork |
| 15 | `CreateQuestionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | CreateQuestionHandler, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Question, QuestionCreateRequest, QuestionDTOMapper, QuestionInvariants, Result, UnitOfWork |
| 15 | `CreateSessionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 18 | CreateSessionHandler, Error, ErrorType, Event, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, IUnitOfWork, Result, Session, SessionCategoryItemDTOMapper, SessionCreateRequest, SessionDTOMapper, SessionInvariants, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper, UnitOfWork |
| 15 | `CreateSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 14 | CreateSpeakerHandler, Email, Error, HandlerTestBase<THandler>, ICurrentUserService, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Result, Speaker, SpeakerCategoryItemDTOMapper, SpeakerCreateRequest, SpeakerDTOMapper, SpeakerQuestionAnswerDTOMapper, UnitOfWork |
| 15 | `CreateSponsorHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | CreateSponsorHandler, Error, ErrorType, Event, HandlerTestBase<THandler>, IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Result, Sponsor, SponsorCreateRequest, SponsorDTOMapper, SponsorTier, UnitOfWork |
| 15 | `DeleteConferenceCategoryHandlerTests` | MMCA.ADC.Conference.Application.Tests | 6 | Category, DeleteConferenceCategoryHandler, DeleteEntityCommand<TEntity, TIdentifierType>, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork |
| 15 | `DeleteEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 19 | Activity, DeleteEntityCommand<TEntity, TIdentifierType>, DeleteEventHandler, Error, ErrorType, Event, HandlerTestBase<THandler>, IInternalCommand, IInternalCommandScheduler, IRepository<TEntity, TIdentifierType>, Partner, PartnerType, Result, Session, SessionAsset, SessionAssetFixtures, Sponsor, SponsorTier, UnitOfWork |
| 15 | `DeleteSessionAssetHandlerTests` | MMCA.ADC.Conference.Application.Tests | 15 | DeleteSessionAssetBlobInternalCommand, DeleteSessionAssetCommand, DeleteSessionAssetHandler, Error, ErrorType, HandlerTestBase<THandler>, IInternalCommand, IInternalCommandScheduler, IRepository<TEntity, TIdentifierType>, ISessionAssetAccessService, ITransactional, Result, SessionAsset, SessionAssetFixtures, UnitOfWork |
| 15 | `DeleteSessionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | DeleteEntityCommand<TEntity, TIdentifierType>, DeleteSessionHandler, Error, ErrorType, HandlerTestBase<THandler>, IInternalCommand, IInternalCommandScheduler, IRepository<TEntity, TIdentifierType>, Result, Session, SessionAsset, SessionAssetFixtures, UnitOfWork |
| 15 | `EventLiveValidationServiceTests` | MMCA.ADC.Conference.Application.Tests | 13 | ErrorType, Event, EventLiveValidationService, FakeTimeProvider, HandlerTestBase<THandler>, IEventLiveValidationService, IRepository<TEntity, TIdentifierType>, QuestionModerationDefault, Session, SessionBuilder, Sponsor, SponsorTier, UnitOfWork |
| 15 | `EventNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | Event, EventNavigationPopulator, HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, UnitOfWork |
| 15 | `EventQuestionAnswerNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | EventQuestionAnswer, EventQuestionAnswerNavigationPopulator, HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, UnitOfWork |
| 15 | `EventSpeakerNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | EventSpeaker, EventSpeakerNavigationPopulator, HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, UnitOfWork |
| 15 | `GetCategoryDistributionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | Category, GetCategoryDistributionHandler, GetCategoryDistributionQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionBuilder, SessionStatuses, UnitOfWork |
| 15 | `GetContentSimilarityHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | Category, GetContentSimilarityHandler, GetContentSimilarityQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionBuilder, SessionStatuses, UnitOfWork |
| 15 | `GetPublicActivityFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | Activity, Event, GetPublicActivityFilterHandler, GetPublicActivityFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, UnitOfWork |
| 15 | `GetPublicEventSpeakerFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | Event, EventSpeaker, GetPublicEventSpeakerFilterHandler, GetPublicEventSpeakerFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Session, SessionSpeaker, UnitOfWork |
| 15 | `GetPublicPartnerFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | Event, GetPublicPartnerFilterHandler, GetPublicPartnerFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, Partner, PartnerType, UnitOfWork |
| 15 | `GetPublicRoomFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | Event, GetPublicRoomFilterHandler, GetPublicRoomFilterQuery, HandlerTestBase<THandler>, InlineSpecification<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, Room, UnitOfWork |
| 15 | `GetPublicSessionCategoryItemFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | Event, GetPublicSessionCategoryItemFilterHandler, GetPublicSessionCategoryItemFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Session, SessionCategoryItem, UnitOfWork |
| 15 | `GetPublicSessionFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | Event, GetPublicSessionFilterHandler, GetPublicSessionFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, Session, SessionBuilder, SessionStatuses, UnitOfWork |
| 15 | `GetPublicSessionSpeakerFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | Event, GetPublicSessionSpeakerFilterHandler, GetPublicSessionSpeakerFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Session, SessionSpeaker, UnitOfWork |
| 15 | `GetPublicSpeakerCategoryItemFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | Event, GetPublicSpeakerCategoryItemFilterHandler, GetPublicSpeakerCategoryItemFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Session, SessionSpeaker, SpeakerCategoryItem, UnitOfWork |
| 15 | `GetPublicSpeakerFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 14 | Event, EventSpeaker, GetPublicSpeakerFilterHandler, GetPublicSpeakerFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, ISpecification<TEntity, TIdentifierType>, Session, SessionBuilder, SessionSpeaker, SessionStatuses, Speaker, SpeakerBuilder, UnitOfWork |
| 15 | `GetPublicSponsorFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | Event, GetPublicSponsorFilterHandler, GetPublicSponsorFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, Sponsor, SponsorTier, UnitOfWork |
| 15 | `GetSessionAssetsHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | GetSessionAssetsHandler, GetSessionAssetsQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, ISessionAssetAccessService, SessionAsset, SessionAssetDTOMapper, SessionAssetFixtures, UnitOfWork |
| 15 | `GetSessionsBySpeakerFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | GetSessionsBySpeakerFilterHandler, GetSessionsBySpeakerFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, Session, SessionBuilder, SessionSpeaker, UnitOfWork |
| 15 | `GetSessionSelectionDashboardHandlerTests` | MMCA.ADC.Conference.Application.Tests | 14 | Category, ErrorType, Event, GetSessionSelectionDashboardHandler, GetSessionSelectionDashboardQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionAiScore, SessionBuilder, SessionStatuses, Speaker, SpeakerBuilder, UnitOfWork |
| 15 | `GetSpeakersByEventFilterHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | EventSpeaker, GetSpeakersByEventFilterHandler, GetSpeakersByEventFilterQuery, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, Session, SessionSpeaker, Speaker, SpeakerBuilder, UnitOfWork |
| 15 | `GetSpeakerSessionOverlapHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | Category, GetSpeakerSessionOverlapHandler, GetSpeakerSessionOverlapQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionBuilder, SessionStatuses, Speaker, SpeakerBuilder, UnitOfWork |
| 15 | `LinkUserToSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, LinkUserToSpeakerCommand, LinkUserToSpeakerHandler, Speaker, SpeakerLinkedToUser, UnitOfWork |
| 15 | `PartnerNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, Partner, PartnerNavigationPopulator, UnitOfWork |
| 15 | `PartnerUpdateApplierTests` | MMCA.ADC.Conference.Application.Tests | 12 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Partner, PartnerDTO, PartnerDTOMapper, PartnerType, PartnerUpdateApplier, PartnerUpdateRequest, UnitOfWork, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 15 | `PublishEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, PublishEventCommand, PublishEventHandler, UnitOfWork |
| 15 | `RefreshFromSessionizeHandlerTests` | MMCA.ADC.Conference.Application.Tests | 14 | Error, ErrorType, Event, IConcurrencyConflictDetector, ICurrentUserService, IRepository<TEntity, TIdentifierType>, ISessionizeService, ITransactional, IUnitOfWork, RefreshFromSessionizeCommand, RefreshFromSessionizeHandler, RefreshFromSessionizeResultDTO, Result, SessionizeResponse |
| 15 | `RemoveCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | Category, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveCategoryItemCommand, RemoveCategoryItemHandler, UnitOfWork |
| 15 | `RemoveEventQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | ErrorType, Event, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, RemoveEventQuestionAnswerCommand, RemoveEventQuestionAnswerHandler, RoleNames, UnitOfWork |
| 15 | `RemoveEventSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveEventSpeakerCommand, RemoveEventSpeakerHandler, UnitOfWork |
| 15 | `RemoveRoomHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveRoomCommand, RemoveRoomHandler, Session, UnitOfWork |
| 15 | `RemoveSessionCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveSessionCategoryItemCommand, RemoveSessionCategoryItemHandler, Session, UnitOfWork |
| 15 | `RemoveSessionQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 9 | ErrorType, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, RemoveSessionQuestionAnswerCommand, RemoveSessionQuestionAnswerHandler, RoleNames, Session, UnitOfWork |
| 15 | `RemoveSessionSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveSessionSpeakerCommand, RemoveSessionSpeakerHandler, Session, UnitOfWork |
| 15 | `RemoveSpeakerCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RemoveSpeakerCategoryItemCommand, RemoveSpeakerCategoryItemHandler, Speaker, UnitOfWork |
| 15 | `RoomEntityQueryServiceTests` | MMCA.ADC.Conference.Application.Tests | 12 | EntityQueryParameters<TEntity>, HandlerTestBase<THandler>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IReadRepository<TEntity, TIdentifierType>, NavigationMetadata, Room, RoomDTO, RoomDTOMapper, RoomEntityQueryService, UnitOfWork |
| 15 | `RoomNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, Room, RoomNavigationPopulator, UnitOfWork |
| 15 | `SessionAssetAccessServiceTests` | MMCA.ADC.Conference.Application.Tests | 9 | Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionAsset, SessionAssetAccessService, SessionAssetLimits, SessionBuilder, UnitOfWork |
| 15 | `SessionBookmarkValidationServiceTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, ISessionBookmarkValidationService, Session, SessionBookmarkValidationService, SessionBuilder, UnitOfWork |
| 15 | `SessionCategoryItemNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, SessionCategoryItem, SessionCategoryItemNavigationPopulator, UnitOfWork |
| 15 | `SessionEntityQueryServiceTests` | MMCA.ADC.Conference.Application.Tests | 15 | EntityQueryParameters<TEntity>, HandlerTestBase<THandler>, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, IReadRepository<TEntity, TIdentifierType>, NavigationMetadata, Session, SessionCategoryItemDTOMapper, SessionDTO, SessionDTOMapper, SessionEntityQueryService, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper, UnitOfWork |
| 15 | `SessionNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, Session, SessionNavigationPopulator, UnitOfWork |
| 15 | `SessionQuestionAnswerNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, SessionQuestionAnswer, SessionQuestionAnswerNavigationPopulator, UnitOfWork |
| 15 | `SessionScoringRunnerTests` | MMCA.ADC.Conference.Application.Tests | 14 | AuditableBaseEntity<TIdentifierType>, HandlerTestBase<THandler>, IAiScoringService, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Session, SessionAiScore, SessionBuilder, SessionScoringInput, SessionScoringResult, SessionScoringRunner, SessionStatuses, Speaker, UnitOfWork |
| 15 | `SessionSpeakerNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, SessionSpeaker, SessionSpeakerNavigationPopulator, UnitOfWork |
| 15 | `SpeakerCategoryItemNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, SpeakerCategoryItem, SpeakerCategoryItemNavigationPopulator, UnitOfWork |
| 15 | `SpeakerEntityQueryServiceTests` | MMCA.ADC.Conference.Application.Tests | 17 | EntityQueryParameters<TEntity>, ErrorType, HandlerTestBase<THandler>, ICurrentUserService, IEntityQueryPipeline, INavigationMetadataProvider, INavigationPopulator<in TEntity>, InlineSpecification<TEntity, TIdentifierType>, IReadRepository<TEntity, TIdentifierType>, NavigationMetadata, Speaker, SpeakerBuilder, SpeakerCategoryItemDTOMapper, SpeakerDTOMapper, SpeakerEntityQueryService, SpeakerQuestionAnswerDTOMapper, UnitOfWork |
| 15 | `SpeakerNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, Speaker, SpeakerNavigationPopulator, UnitOfWork |
| 15 | `SponsorNavigationPopulatorTests` | MMCA.ADC.Conference.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, NavigationMetadata, Sponsor, SponsorNavigationPopulator, UnitOfWork |
| 15 | `SponsorUpdateApplierTests` | MMCA.ADC.Conference.Application.Tests | 12 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Sponsor, SponsorDTO, SponsorDTOMapper, SponsorTier, SponsorUpdateApplier, SponsorUpdateRequest, UnitOfWork, UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>, UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest> |
| 15 | `UnlinkUserFromSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 8 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Speaker, SpeakerUnlinkedFromUser, UnitOfWork, UnlinkUserFromSpeakerCommand, UnlinkUserFromSpeakerHandler |
| 15 | `UnpublishEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UnpublishEventCommand, UnpublishEventHandler |
| 15 | `UpdateCategoryItemHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | Category, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UpdateCategoryItemCommand, UpdateCategoryItemHandler |
| 15 | `UpdateEventQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 10 | ErrorType, Event, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Question, RoleNames, UnitOfWork, UpdateEventQuestionAnswerCommand, UpdateEventQuestionAnswerHandler |
| 15 | `UpdateQuestionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | ErrorType, EventQuestionAnswer, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, Question, QuestionDTOMapper, QuestionUpdateRequest, SessionQuestionAnswer, SpeakerQuestionAnswer, UnitOfWork, UpdateQuestionCommand, UpdateQuestionHandler |
| 15 | `UpdateRoomHandlerTests` | MMCA.ADC.Conference.Application.Tests | 7 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, UpdateRoomCommand, UpdateRoomHandler |
| 15 | `UpdateSessionAssetHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionAsset, SessionAssetAccessService, SessionAssetDTOMapper, SessionAssetFixtures, SessionAssetUpdateRequest, SessionBuilder, UnitOfWork, UpdateSessionAssetCommand, UpdateSessionAssetHandler |
| 15 | `UpdateSessionQuestionAnswerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 11 | ErrorType, Event, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Question, RoleNames, Session, UnitOfWork, UpdateSessionQuestionAnswerCommand, UpdateSessionQuestionAnswerHandler |
| 15 | `UpdateSpeakerHandlerTests` | MMCA.ADC.Conference.Application.Tests | 14 | Email, ErrorType, HandlerTestBase<THandler>, ICurrentUserService, IRepository<TEntity, TIdentifierType>, Speaker, SpeakerCategoryItemDTOMapper, SpeakerDTOMapper, SpeakerQuestionAnswerDTOMapper, SpeakerUpdateApplier, SpeakerUpdateRequest, UnitOfWork, UpdateSpeakerCommand, UpdateSpeakerHandler |
| 15 | `UploadSessionAssetHandlerTests` | MMCA.ADC.Conference.Application.Tests | 17 | DeleteSessionAssetBlobInternalCommand, Error, FileUploadOptions, HandlerTestBase<THandler>, IFileStorageService, IInternalCommand, IInternalCommandScheduler, IRepository<TEntity, TIdentifierType>, ISessionAssetAccessService, Result, SessionAsset, SessionAssetDTOMapper, SessionAssetFixtures, SessionAssetKind, UnitOfWork, UploadSessionAssetCommand, UploadSessionAssetHandler |
| 15 | `ConferenceEntityConfigurationTests` | MMCA.ADC.Conference.Infrastructure.Tests | 35 | Category, CategoryInvariants, CategoryItem, CategoryItemConfiguration, ConferenceCategoryConfiguration, ConferenceTestDbContext, Event, EventConfiguration, EventInvariants, EventQuestionAnswer, EventQuestionAnswerConfiguration, EventSpeaker, EventSpeakerConfiguration, Question, QuestionConfiguration, QuestionInvariants, Room, RoomConfiguration, Session, SessionCategoryItem …(+15) |
| 15 | `ConferenceIntegrationTestFixture` | MMCA.ADC.Conference.IntegrationTests | 4 | ConferenceTestWebApplicationFactory, JwtTokenGenerator, Program, SqlServerIntegrationTestFixtureBase<TEntryPoint> |
| 15 | `CrossServiceFixture` | MMCA.ADC.CrossService.IntegrationTests | 7 | ConferenceCrossServiceFactory, CrossServiceDataSource, CrossServiceFixtureBase, EngagementCrossServiceFactory, IdentityCrossServiceFactory, JwtTokenGenerator, NotificationCrossServiceFactory |
| 15 | `AttendeeCheckedInPointsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 11 | AttendeeCheckedIn, AttendeeCheckedInPointsHandler, CheckInScopeNames, Error, HandlerTestBase<THandler>, IPointsAwarder, PointsActivityType, RecordingPointsAwarder, Result, SponsorVisit, TestSupport |
| 15 | `BookmarkCountServiceTests` | MMCA.ADC.Engagement.Application.Tests | 5 | BookmarkCountService, HandlerTestBase<THandler>, IBookmarkCountService, UnitOfWork, UserSessionBookmark |
| 15 | `CastVoteHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 14 | CastVoteCommand, CastVoteHandler, ErrorType, FakeTimeProvider, HandlerMocks, HandlerTestBase<THandler>, InMemoryQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, LivePoll, LivePollResultsBuilder, LivePollVote, TestSupport, UnitOfWork |
| 15 | `CheckInAttendeeHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 20 | AttendeeBadge, AttendeeCheckedIn, BadgePayload, CheckIn, CheckInAttendeeHandler, CheckInAttendeeRequest, CheckInScope, CheckInScopeNames, Error, ErrorType, EventLiveInfo, FakeTimeProvider, HandlerMocks, HandlerTestBase<THandler>, ICurrentUserService, IEventLiveValidationService, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 15 | `CloseLivePollHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 16 | CloseLivePollCommand, CloseLivePollHandler, Error, ErrorType, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, ILiveChannelPublishQueue, LiveChannelPublishWorkItem, LivePoll, LivePollChannel, LivePollStatus, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 15 | `CreateBookmarkHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 12 | CreateBookmarkHandler, CreateBookmarkRequest, Error, ErrorType, HandlerMocks, HandlerTestBase<THandler>, ISessionBookmarkValidationService, IUniqueConstraintViolationDetector, Result, UnitOfWork, UserSessionBookmark, UserSessionBookmarkDTOMapper |
| 15 | `CreateLivePollHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 17 | CreateLivePollCommand, CreateLivePollHandler, CreateLivePollRequest, Error, ErrorType, EventLiveInfo, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, LivePoll, LivePollDTOMapper, LivePollStatus, Question, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 15 | `DeleteLivePollHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 6 | DeleteEntityCommand<TEntity, TIdentifierType>, DeleteLivePollHandler, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, LivePoll, UnitOfWork |
| 15 | `EventFeedbackSubmittedPointsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 9 | Error, EventFeedbackSubmitted, EventFeedbackSubmittedPointsHandler, HandlerTestBase<THandler>, IPointsAwarder, PointsActivityType, RecordingPointsAwarder, Result, TestSupport |
| 15 | `GetAttendanceStatsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 6 | CheckIn, CheckInScope, GetAttendanceStatsHandler, GetAttendanceStatsQuery, HandlerTestBase<THandler>, UnitOfWork |
| 15 | `GetBookmarkedSessionIdsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 5 | GetBookmarkedSessionIdsHandler, GetBookmarkedSessionIdsQuery, HandlerTestBase<THandler>, UnitOfWork, UserSessionBookmark |
| 15 | `GetEventPollsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 7 | GetEventPollsHandler, GetEventPollsQuery, HandlerTestBase<THandler>, LivePoll, LivePollDTOMapper, LivePollStatus, UnitOfWork |
| 15 | `GetLeaderboardHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 9 | Entry, GetLeaderboardHandler, GetLeaderboardQuery, HandlerTestBase<THandler>, LeaderboardOptIn, PointsActivityType, PointsEntry, PointsSettings, UnitOfWork |
| 15 | `GetModerationQueueHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 16 | Error, ErrorType, GetModerationQueueHandler, GetModerationQueueQuery, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, InMemoryQueryableExecutor, QuestionModerationDefault, QuestionStatus, Result, SessionLiveInfo, SessionQuestion, SessionQuestionUpvote, SessionQuestionViewBuilder, UnitOfWork |
| 15 | `GetMyPointsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 10 | Entry, ErrorType, GetMyPointsHandler, GetMyPointsQuery, HandlerTestBase<THandler>, ICurrentUserService, LeaderboardOptIn, PointsActivityType, PointsEntry, UnitOfWork |
| 15 | `GetOpenPollsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 12 | CountingQueryableExecutor, ErrorType, GetOpenPollsHandler, GetOpenPollsQuery, HandlerTestBase<THandler>, InMemoryQueryableExecutor, IQueryableExecutor, LivePoll, LivePollResultsBuilder, LivePollVote, TestSupport, UnitOfWork |
| 15 | `GetOrCreateMyBadgeHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 9 | AttendeeBadge, ErrorType, GetOrCreateMyBadgeCommand, GetOrCreateMyBadgeHandler, HandlerMocks, HandlerTestBase<THandler>, ICurrentUserService, IUniqueConstraintViolationDetector, UnitOfWork |
| 15 | `GetPointsOverviewHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 8 | Entry, GetPointsOverviewHandler, GetPointsOverviewQuery, HandlerTestBase<THandler>, PointsActivityType, PointsEntry, PointsEntryDTO, UnitOfWork |
| 15 | `GetPollResultsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 18 | Error, ErrorType, EventLiveInfo, GetPollResultsHandler, GetPollResultsQuery, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, InMemoryQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, LivePoll, LivePollResultsBuilder, LivePollStatus, LivePollVote, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 15 | `GetSessionManagePollsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 15 | Error, ErrorType, GetSessionManagePollsHandler, GetSessionManagePollsQuery, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, IRepository<TEntity, TIdentifierType>, LivePoll, LivePollDTOMapper, LivePollStatus, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 15 | `GetSessionQuestionsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 10 | GetSessionQuestionsHandler, GetSessionQuestionsQuery, HandlerTestBase<THandler>, InMemoryQueryableExecutor, QuestionStatus, SessionQuestion, SessionQuestionUpvote, SessionQuestionViewBuilder, TestSupport, UnitOfWork |
| 15 | `GetUserBookmarksHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 11 | Error, GetUserBookmarksHandler, GetUserBookmarksQuery, HandlerMocks, HandlerTestBase<THandler>, IQueryableExecutor, ISessionBookmarkValidationService, Result, UnitOfWork, UserSessionBookmark, UserSessionBookmarkDTOMapper |
| 15 | `LivePollOptionNavigationPopulatorTests` | MMCA.ADC.Engagement.Application.Tests | 6 | HandlerTestBase<THandler>, INavigationPopulator<in TEntity>, LivePollOption, LivePollOptionNavigationPopulator, NavigationMetadata, UnitOfWork |
| 15 | `ManualCheckInHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 17 | AttendeeCheckedIn, CheckIn, CheckInScope, CheckInScopeNames, ErrorType, EventLiveInfo, FakeTimeProvider, HandlerMocks, HandlerTestBase<THandler>, ICurrentUserService, IEventLiveValidationService, ManualCheckInHandler, ManualCheckInRequest, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 15 | `ModerateQuestionHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 17 | Error, ErrorType, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, ILiveChannelPublishQueue, LiveChannelPublishWorkItem, ModerateQuestionCommand, ModerateQuestionHandler, ModerationAction, QuestionModerationDefault, QuestionStatus, Result, SessionLiveInfo, SessionQuestion, SessionQuestionChannel, UnitOfWork |
| 15 | `OpenLivePollHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 18 | Error, ErrorType, EventLiveInfo, FakeTimeProvider, HandlerMocks, HandlerTestBase<THandler>, IEventLiveValidationService, ILiveChannelPublishQueue, LiveChannelPublishWorkItem, LivePoll, LivePollChannel, LivePollStatus, OpenLivePollCommand, OpenLivePollHandler, QuestionModerationDefault, Result, SessionLiveInfo, UnitOfWork |
| 15 | `PointsAwarderTests` | MMCA.ADC.Engagement.Application.Tests | 12 | AwarderMocks, EventFeedback, HandlerTestBase<THandler>, IUniqueConstraintViolationDetector, MutableOptions, PointsActivityType, PointsAwarder, PointsEntry, PointsSettings, PointsSubjectKeys, SessionFeedback, UnitOfWork |
| 15 | `RecordRoomCheckInHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 17 | AttendeeCheckedIn, CheckIn, CheckInScope, CheckInScopeNames, CheckInSettings, Error, ErrorType, FakeTimeProvider, HandlerMocks, HandlerTestBase<THandler>, ICurrentUserService, IEventLiveValidationService, RecordRoomCheckInHandler, Result, RoomCheckInRequest, RoomSessionInfo, UnitOfWork |
| 15 | `RecordSponsorVisitHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 16 | AttendeeCheckedIn, CheckIn, CheckInScope, CheckInScopeNames, Error, ErrorType, FakeTimeProvider, HandlerMocks, HandlerTestBase<THandler>, ICurrentUserService, IEventLiveValidationService, RecordSponsorVisitHandler, Result, SponsorLiveInfo, SponsorVisitRequest, UnitOfWork |
| 15 | `SessionFeedbackSubmittedPointsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 9 | Error, HandlerTestBase<THandler>, IPointsAwarder, PointsActivityType, RecordingPointsAwarder, Result, SessionFeedbackSubmitted, SessionFeedbackSubmittedPointsHandler, TestSupport |
| 15 | `SessionQuestionSubmittedPointsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 13 | DomainEntityState, Error, HandlerTestBase<THandler>, IPointsAwarder, PointsActivityType, QuestionStatus, RecordingPointsAwarder, Result, SessionQuestion, SessionQuestionChanged, SessionQuestionSubmittedPointsHandler, TestSupport, ThrowingPointsAwarder |
| 15 | `SetLeaderboardParticipationHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 10 | ErrorType, HandlerMocks, HandlerTestBase<THandler>, IConcurrencyConflictDetector, ICurrentUserService, IUniqueConstraintViolationDetector, LeaderboardOptIn, SetLeaderboardParticipationHandler, SetLeaderboardParticipationRequest, UnitOfWork |
| 15 | `SubmitQuestionHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 25 | Error, ErrorType, FakeTimeProvider, HandlerMocks, HandlerTestBase<THandler>, IDistributedLock, IEventLiveValidationService, ILiveChannelPublishQueue, InMemoryQueryableExecutor, IReadRepository<TEntity, TIdentifierType>, LiveChannelPublishWorkItem, QuestionModerationDefault, QuestionStatus, Result, SessionLiveInfo, SessionQuestion, SessionQuestionApprovedPayload, SessionQuestionChannel, SessionQuestionInvariants, SessionQuestionPendingCountChangedPayload …(+5) |
| 15 | `ToggleUpvoteHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 14 | ErrorType, FakeTimeProvider, HandlerMocks, HandlerTestBase<THandler>, IConcurrencyConflictDetector, IRepository<TEntity, TIdentifierType>, IUniqueConstraintViolationDetector, QuestionStatus, SessionQuestion, SessionQuestionUpvote, TestSupport, ToggleUpvoteCommand, ToggleUpvoteHandler, UnitOfWork |
| 15 | `UserDeletedBadgeHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 7 | AttendeeBadge, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, TestSupport, UnitOfWork, UserDeleted, UserDeletedBadgeHandler |
| 15 | `UserDeletedBookmarksHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 7 | HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, TestSupport, UnitOfWork, UserDeleted, UserDeletedBookmarksHandler, UserSessionBookmark |
| 15 | `UserDeletedPointsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 7 | HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, LeaderboardOptIn, TestSupport, UnitOfWork, UserDeleted, UserDeletedPointsHandler |
| 15 | `UserDeletedSessionQuestionsHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 10 | HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Question, QuestionStatus, SessionQuestion, SessionQuestionUpvote, TestSupport, UnitOfWork, UserDeleted, UserDeletedSessionQuestionsHandler |
| 15 | `UserDeletedVotesHandlerTests` | MMCA.ADC.Engagement.Application.Tests | 7 | HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, LivePollVote, TestSupport, UnitOfWork, UserDeleted, UserDeletedVotesHandler |
| 15 | `EngagementTestDbContext` | MMCA.ADC.Engagement.Infrastructure.Tests | 12 | LivePoll, LivePollConfiguration, LivePollOption, LivePollOptionConfiguration, LivePollVote, LivePollVoteConfiguration, SessionQuestion, SessionQuestionConfiguration, SessionQuestionUpvote, SessionQuestionUpvoteConfiguration, UserSessionBookmark, UserSessionBookmarkConfiguration |
| 15 | `EngagementIntegrationTestFixture` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementTestWebApplicationFactory, JwtTokenGenerator, Program, SqlServerIntegrationTestFixtureBase<TEntryPoint> |
| 15 | `GatewayHardeningTests` | MMCA.ADC.Gateway.Tests | 3 | GatewayApplicationFactory, MmcaGatewayHardeningTestsBase<TEntryPoint>, Program |
| 15 | `RouteMapTests` | MMCA.ADC.Gateway.Tests | 5 | ClusterProfile, GatewayRoutePolicyPartition, GatewaySettings, RecordingHttpForwarder, RouteMapApplicationFactory |
| 15 | `DependencyInjection` | MMCA.ADC.Identity.Application | 18 | ApplicationSettings, AttendeeQueryService, AuthenticationService, AuthenticationValidators, ClassReference, ClassReference, EngagementUserDataExportSection, IAttendeeQueryService, IAuthenticationService, ILegalAcceptanceService, ISoftDeletedUserValidator, IUserAdministrationService<TUserDto>, LegalAcceptanceService, NotificationUserDataExportSection, SoftDeletedUserValidator<TUser>, User, UserAdminDTO, UserAdministrationService |
| 15 | `SetUserAvatarHandler` | MMCA.ADC.Identity.Application | 13 | DeleteAvatarBlobInternalCommand, Error, IFileStorageService, IImageProcessor, IInternalCommandScheduler, ImageContentSniffer, IUnitOfWork, MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>, MutationContext, Result, SetUserAvatarCommand, User, UserAvatarDTO |
| 15 | `AuthenticationServiceTests` | MMCA.ADC.Identity.Application.Tests | 27 | AuthClaimTypes, AuthenticationResponse, AuthenticationService, AuthenticationValidators, AuthSessionIssuer, EmailConfirmationSettings, Error, ErrorType, FakeTimeProvider, IExternalLoginEmailVerifier, ILoginProtectionService, InMemoryRefreshSessionStore, IPasswordHasher, IRepository<TEntity, TIdentifierType>, ITokenService, IUnitOfWork, LegalAcceptanceOptions, LoginRequest, RefreshSession, RefreshSessionSettings …(+7) |
| 15 | `ChangePasswordHandlerTests` | MMCA.ADC.Identity.Application.Tests | 13 | ChangePasswordCommand, ChangePasswordHandler, ChangePasswordRequest, ErrorType, HandlerTestBase<THandler>, ILoginProtectionService, IPasswordHasher, IRefreshSessionStore, IRepository<TEntity, TIdentifierType>, Result, UnitOfWork, User, UserRole |
| 15 | `ChangePreferencesHandlerTests` | MMCA.ADC.Identity.Application.Tests | 9 | ChangePreferencesCommand, ChangePreferencesHandler, ChangePreferencesRequest, ErrorType, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, User, UserRole |
| 15 | `ConfirmEmailHandlerTests` | MMCA.ADC.Identity.Application.Tests | 13 | ConfirmEmailCommand, ConfirmEmailHandler, ConfirmEmailRequest, Email, EmailConfirmationErrors, Error, HandlerTestBase<THandler>, IEmailConfirmationTokenService, IRepository<TEntity, TIdentifierType>, Result, UnitOfWork, User, UserRole |
| 15 | `DeleteUserHandlerTests` | MMCA.ADC.Identity.Application.Tests | 16 | DeleteAvatarBlobInternalCommand, DeleteUserCommand, DeleteUserHandler, Error, ErrorType, FakeTimeProvider, HandlerTestBase<THandler>, ICacheService, IInternalCommand, IInternalCommandScheduler, IRepository<TEntity, TIdentifierType>, Result, SoftDeletedUserCache, UnitOfWork, User, UserRole |
| 15 | `ExportUserDataHandlerTests` | MMCA.ADC.Identity.Application.Tests | 26 | EngagementUserDataExportSection, ErrorType, ExportUserDataHandler, ExportUserDataHandlerBase<TUser, TQuery>, ExportUserDataQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, IUserDataExportSection, IUserEngagementExportService, IUserNotificationExportService, NotificationUserDataExportSection, Subject, ThrowingExportSection, UnitOfWork, User, UserDataExportDTO, UserDataExportEngagementSectionDTO, UserDataExportNotificationSectionDTO, UserDataExportSectionDefaults, UserDataExportSectionDTO …(+6) |
| 15 | `ForgotPasswordHandlerTests` | MMCA.ADC.Identity.Application.Tests | 12 | ForgotPasswordCommand, ForgotPasswordHandler, ForgotPasswordRequest, HandlerTestBase<THandler>, IEmailSender, IPasswordResetTokenService, IRepository<TEntity, TIdentifierType>, PasswordResetSettings, Result, UnitOfWork, User, UserRole |
| 15 | `GetUserPreferencesHandlerTests` | MMCA.ADC.Identity.Application.Tests | 12 | ChangePreferencesCommand, ChangePreferencesHandler, ChangePreferencesRequest, ErrorType, GetUserPreferencesHandler, GetUserPreferencesQuery, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, UnitOfWork, User, UserPreferencesResponse, UserRole |
| 15 | `GetUsersHandlerTests` | MMCA.ADC.Identity.Application.Tests | 10 | Email, GetUsersHandler, GetUsersQuery, HandlerTestBase<THandler>, IQueryableExecutor, IRepository<TEntity, TIdentifierType>, UnitOfWork, User, UserListDTO, UserRole |
| 15 | `ResetPasswordHandlerTests` | MMCA.ADC.Identity.Application.Tests | 15 | Email, Error, HandlerTestBase<THandler>, ILoginProtectionService, IPasswordHasher, IPasswordResetTokenService, IRefreshSessionStore, IRepository<TEntity, TIdentifierType>, ResetPasswordCommand, ResetPasswordHandler, ResetPasswordRequest, Result, UnitOfWork, User, UserRole |
| 15 | `SendEmailConfirmationHandlerTests` | MMCA.ADC.Identity.Application.Tests | 13 | Email, EmailConfirmationSettings, HandlerTestBase<THandler>, IEmailConfirmationTokenService, IEmailSender, IRepository<TEntity, TIdentifierType>, Result, SendEmailConfirmationCommand, SendEmailConfirmationHandler, SendEmailConfirmationRequest, UnitOfWork, User, UserRole |
| 15 | `UserAdministrationServiceTests` | MMCA.ADC.Identity.Application.Tests | 13 | ErrorType, FakeTimeProvider, HandlerTestBase<THandler>, IQueryableExecutor, IRefreshSessionStore, IRepository<TEntity, TIdentifierType>, RefreshSession, UnitOfWork, User, UserAdminDTO, UserAdministrationQuery, UserAdministrationService, UserRole |
| 15 | `IdentityModuleDbSeeder` | MMCA.ADC.Identity.Infrastructure | 9 | Email, IdentityModuleDbSeederBase<TUser>, IPasswordHasher, IUnitOfWork, Result, SeedAccount, UnitOfWork, User, UserRole |
| 15 | `IdentityTestDbContext` | MMCA.ADC.Identity.Infrastructure.Tests | 4 | DataSource, SoftDeleteUniqueIndexConvention, User, UserConfiguration |
| 15 | `IdentityIntegrationTestFixture` | MMCA.ADC.Identity.IntegrationTests | 4 | IdentityTestWebApplicationFactory, JwtTokenGenerator, Program, SqlServerIntegrationTestFixtureBase<TEntryPoint> |
| 15 | `UserNotificationExportServiceTests` | MMCA.ADC.Notification.Application.Tests | 8 | HandlerTestBase<THandler>, InMemoryQueryableExecutor, IRepository<TEntity, TIdentifierType>, IUserNotificationExportService, PushNotification, UnitOfWork, UserNotification, UserNotificationExportService |
| 15 | `NotificationIntegrationTestFixture` | MMCA.ADC.Notification.IntegrationTests | 4 | JwtTokenGenerator, NotificationTestWebApplicationFactory, Program, SqlServerIntegrationTestFixtureBase<TEntryPoint> |
| 15 | `BoundedCircuitHandlerTests` | MMCA.ADC.UI.Web.Tests | 3 | BlazorCircuitLimitSettings, BoundedCircuitHandler, ConferenceUiHostApplicationFactory |
| 15 | `ClientConfigEndpointTests` | MMCA.ADC.UI.Web.Tests | 1 | ConferenceUiHostApplicationFactory |
| 15 | `FallbackAuthorizationTests` | MMCA.ADC.UI.Web.Tests | 2 | ConferenceUiHostApplicationFactory, FallbackAuthorizationOptions |
| 15 | `ForbiddenStatusPageTests` | MMCA.ADC.UI.Web.Tests | 2 | ConferenceUiHostApplicationFactory, SessionCookieEndpoints |
| 15 | `SecurityHeadersTests` | MMCA.ADC.UI.Web.Tests | 2 | ConferenceUiHostApplicationFactory, SecurityHeadersTestsBase |
| 15 | `SerilogBootstrapTests` | MMCA.ADC.UI.Web.Tests | 1 | ConferenceUiHostApplicationFactory |
| 15 | `UiRateLimitingTests` | MMCA.ADC.UI.Web.Tests | 2 | ConferenceUiHostApplicationFactory, UiRateLimitingSettings |
| 15 | `AuthControllerBase` | MMCA.Common.API | 12 | ApiControllerBase, AuthenticationResponse, AuthenticationService, CurrentUserService, IAuthenticationService, ICurrentUserService, LoginRequest, RefreshSessionSummaryResponse, RefreshTokenRequest, RegisterRequest, User, WebApplicationBuilderExtensions |
| 15 | `DatabaseInitializationExtensions` | MMCA.Common.API | 10 | ApplicationSettings, DataSourceKey, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, ModuleHostContext, ModuleLoader, TenancySettings, TenantDataSourceTarget, TenantDataSourceTargets |
| 15 | `PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>` | MMCA.Common.API | 9 | ApiControllerBase, ForgotPasswordHandler, ForgotPasswordRequest, ICommandHandler<in TCommand, TResult>, ICommandWithRequest<out TRequest>, ResetPasswordHandler, ResetPasswordRequest, Result, WebApplicationBuilderExtensions |
| 15 | `CookieSessionRefresherTests` | MMCA.Common.API.Tests | 10 | AuthenticationResponse, CookieSessionRefresher, CookieTokenReader, FakeTimeProvider, KeyedSemaphoreStripe, RefresherHarness, SessionCookieEndpoints, SessionRefreshOutcome, SessionRefreshStatus, SessionTokenResult |
| 15 | `DatabaseInitializationExtensionsTests` | MMCA.Common.API.Tests | 30 | ApplicationSettings, AuditSaveChangesInterceptor, ConnectionStringSettings, CreateMigrationProofTable, DataSource, DataSourceEntrySettings, DataSourceResolver, DataSourcesSettings, DbContextFactory, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, ICurrentUserService, IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, InitTestMigratedWidget, InitTestWidget …(+10) |
| 15 | `FixedAssemblyProvider` | MMCA.Common.API.Tests | 2 | DatabaseInitializationExtensionsTests, IEntityConfigurationAssemblyProvider |
| 15 | `AuthenticationServiceIdentityCompletionsTests` | MMCA.Common.Application.Tests | 11 | AuthClaimTypes, AuthenticationResponse, EmailConfirmationErrors, ErrorType, Harness, LoginRequest, RefreshTokenRequest, Result, TwoFactorErrors, TwoFactorOutcome, TwoFactorStub |
| 15 | `AuthenticationServiceLegalAcceptanceTests` | MMCA.Common.Application.Tests | 10 | AuthenticationResponse, AuthenticationValidators, AuthErrorCodes, Harness, LegalAcceptanceOptions, LoginRequest, RefreshTokenRequest, RegisterRequest, Result, TestAuthUser |
| 15 | `MarkAllNotificationsReadHandlerTests` | MMCA.Common.Application.Tests | 6 | FixedTimeProvider, Harness, MarkAllNotificationsReadCommand, PushNotification, Result, UserNotification |
| 15 | `MutateAttemptScopeTests` | MMCA.Common.Application.Tests | 5 | IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, RenameOrderCommand, TestRetryingRenameHandler |
| 15 | `TestRenameOrderPayloadHandler` | MMCA.Common.Application.Tests | 7 | IUnitOfWork, MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>, MutationContext, OrderAggregate, RenameOrderCommand, RenameOrderResult, Result |
| 15 | `FrameworkTableTargets` | MMCA.Common.Infrastructure | 8 | DataSource, DataSourceEngines, DataSourceKey, IDataSourceResolver, IEntityDataSourceRegistry, TenancySettings, TenantDataSourceTarget, TenantDataSourceTargets |
| 15 | `FixedAssemblyProvider` | MMCA.Common.Infrastructure.SQLServer.Tests | 2 | IEntityConfigurationAssemblyProvider, SQLServerPersistenceTests |
| 15 | `SQLServerPersistenceTests` | MMCA.Common.Infrastructure.SQLServer.Tests | 23 | ApplicationDbContext, AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceKey, DataSourceResolver, DataSourcesSettings, DbContextFactory, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, FixedCurrentUserService, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, NoTenantContext, OutboxMessage, OutboxSignal, PhysicalDbContextFactory …(+3) |
| 15 | `AuditTrailReaderTests` | MMCA.Common.Infrastructure.Tests | 12 | ApplicationDbContext, AuditTrailEntry, AuditTrailReader, AuditTrailSettings, AuditTrailTestContext, AuditTrailTestHarness, DataSource, DataSourceKey, FakeTimeProvider, IDataSourceResolver, IDbContextFactory, SchedulerTestHarness |
| 15 | `CosmosConfigurationPortabilityTests` | MMCA.Common.Infrastructure.Tests | 17 | AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceResolver, DataSourcesSettings, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, OutboxSignal, PhysicalDbContextFactory, PortablePrincipal, PortableThing |
| 15 | `DbContextFactoryAdditionalTests` | MMCA.Common.Infrastructure.Tests | 10 | DataSource, DataSourceKey, DbContextFactory, DefaultDataSourceResolver, ICurrentUserService, IEntityDataSourceRegistry, IPhysicalDbContextFactory, ITenantContext, MidSaveContextCreatingDbContext, TenancySettings |
| 15 | `DbContextFactoryCommitAmbiguityTests` | MMCA.Common.Infrastructure.Tests | 16 | CommitFailingDbContext, DataSource, DataSourceKey, DbContextFactory, DefaultDataSourceResolver, ICurrentUserService, IDomainEvent, IDomainEventDispatcher, IEntityDataSourceRegistry, IPhysicalDbContextFactory, ITenantContext, Result, TenancySettings, TestAggregate, TestLocalEvent, TransactionCommitAmbiguousException |
| 15 | `DbContextFactoryMigrationTargetTests` | MMCA.Common.Infrastructure.Tests | 22 | AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceKey, DataSourceResolver, DataSourcesSettings, DbContextFactory, DomainEventSaveChangesInterceptor, FixedSourcesRegistry, FixedSourcesRegistry, ICurrentUserService, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, ITenantContext, NoConfigurationAssemblyProvider, NoConfigurationAssemblyProvider, OutboxSignal …(+2) |
| 15 | `DbContextFactorySaveIntegrityTests` | MMCA.Common.Infrastructure.Tests | 14 | DataSource, DataSourceKey, DbContextFactory, DefaultDataSourceResolver, ICurrentUserService, IDomainEvent, IDomainEventDispatcher, IEntityDataSourceRegistry, IntegrityAggregate, IntegrityEvent, IntegrityTestDbContext, IPhysicalDbContextFactory, ITenantContext, TenancySettings |
| 15 | `DbContextFactoryTenantTests` | MMCA.Common.Infrastructure.Tests | 16 | ApplicationDbContext, DataSource, DataSourceKey, DbContextFactory, ICurrentUserService, IDataSourceResolver, IEntityDataSourceRegistry, IPhysicalDbContextFactory, ITenantContext, MutableTenantContext, PhysicalDataSource, TenancySettings, TenantContext, TenantDataSourceOverrideSettings, TenantEntrySettings, TenantTestContext |
| 15 | `DbContextFactoryTests` | MMCA.Common.Infrastructure.Tests | 10 | ApplicationDbContext, DataSource, DataSourceKey, DbContextFactory, DefaultDataSourceResolver, ICurrentUserService, IEntityDataSourceRegistry, IPhysicalDbContextFactory, ITenantContext, TenancySettings |
| 15 | `DesignTimeDbContextHelperTests` | MMCA.Common.Infrastructure.Tests | 12 | ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceKey, DesignAlphaEntity, DesignBetaEntity, DesignPostgreSQLEntity, DesignSqliteEntity, DesignTimeDbContextHelper, DesignTimeDbContextOptions, PermissionGrant, RefreshSession |
| 15 | `DomainEventSaveChangesInterceptorOutboxDisabledTests` | MMCA.Common.Infrastructure.Tests | 11 | DomainEventSaveChangesInterceptor, DomainEventSaveChangesInterceptorOutboxRoutingTests, IDomainEvent, IDomainEventDispatcher, IOutboxSignal, MessageBusSettings, OutboxMessage, OutboxRoutingTestDbContext, TestAggregate, TestIntegrationEvent, TestLocalEvent |
| 15 | `EFRepositoryAuditStampTests` | MMCA.Common.Infrastructure.Tests | 15 | DataSource, DataSourceKey, DbContextFactory, DefaultDataSourceResolver, EFRepository<TEntity, TIdentifierType>, ICurrentUserService, IDataSourceService, IEntityDataSourceRegistry, IPhysicalDbContextFactory, IRepositoryFactory, ITenantContext, StampedEntity, StampTestDbContext, TenancySettings, UnitOfWork |
| 15 | `FixedAssemblyProvider` | MMCA.Common.Infrastructure.Tests | 3 | CosmosConfigurationPortabilityTests, IEntityConfigurationAssemblyProvider, MultiSourceSqliteIntegrationTests |
| 15 | `MigrationApplyProofTests` | MMCA.Common.Infrastructure.Tests | 21 | AuditSaveChangesInterceptor, ConnectionStringSettings, CreateMigrationProofTable, DataSource, DataSourceEntrySettings, DataSourceKey, DataSourceResolver, DataSourcesSettings, DbContextFactory, DomainEventSaveChangesInterceptor, FixedSourcesRegistry, ICurrentUserService, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, ITenantContext, NoConfigurationAssemblyProvider, OutboxSignal, PhysicalDbContextFactory …(+1) |
| 15 | `MultiSourceSqliteIntegrationTests` | MMCA.Common.Infrastructure.Tests | 28 | ApplicationSettings, AuditSaveChangesInterceptor, ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceResolver, DataSourceService, DataSourcesSettings, DbContextFactory, DomainEventSaveChangesInterceptor, EntityDataSourceRegistry, FixedAssemblyProvider, ICurrentUserService, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, ITenantContext, MultiSourceCustomer, MultiSourceOrder …(+8) |
| 15 | `NotificationConfigurationEngineTests` | MMCA.Common.Infrastructure.Tests | 7 | ApplicationDbContext, ConnectionStringSettings, DataSourceEntrySettings, DesignTimeDbContextHelper, PushNotification, UserNotification, UserNotificationConfiguration |
| 15 | `PushNotificationTestDbContext` | MMCA.Common.Infrastructure.Tests | 1 | PushNotificationConfiguration |
| 15 | `RefreshSessionCleanupServiceTests` | MMCA.Common.Infrastructure.Tests | 14 | AuditSaveChangesInterceptor, DataSource, DataSourceKey, DefaultDataSourceResolver, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, IDataSourceResolver, IDomainEventDispatcher, IEntityDataSourceRegistry, IOutboxSignal, RefreshSession, RefreshSessionCleanupService, RefreshSessionSettings, SweepHarness |
| 15 | `RepositoryFactoryTests` | MMCA.Common.Infrastructure.Tests | 13 | ApplicationSettings, EFReadRepository<TEntity, TIdentifierType>, EFReadRepositoryDecorator<TEntity, TIdentifierType>, EFRepository<TEntity, TIdentifierType>, EFRepositoryDecorator<TEntity, TIdentifierType>, FakeAggregate, FakeAggregate, FakeEntity, FakeEntity, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, RepositoryFactory, TestDbContext |
| 15 | `SqliteTestDbContext` | MMCA.Common.Infrastructure.Tests | 2 | SqliteTestEntity, SqliteTestEntityConfig |
| 15 | `TestIdentityModuleDbSeeder` | MMCA.Common.Infrastructure.Tests | 8 | Email, Error, IdentityModuleDbSeederBase<TUser>, IPasswordHasher, IUnitOfWork, Result, SeedAccount, TestSeedUser |
| 15 | `PagedQueryLoadTests` | MMCA.Common.LoadTests | 7 | LoadItem, LoadItemDTO, LoadResults, Measured, PagedCollectionResult<T>, PagedQuery, PagedQueryFixture |
| 15 | `HandlerTestBaseTests` | MMCA.Common.Testing.Tests | 5 | FakeHandler, HandlerTestBase<THandler>, TestAggregate, TestChildEntity, UnitOfWork |
| 15 | `SameOriginApiProxyEndpointExtensions` | MMCA.Common.UI.Web | 8 | HandoffSessionCookieSync, HandoffTokenRefresher, ISessionCookieSync, ITokenRefresher, SameOriginApiProxyEndpoint, SameOriginApiProxyMarker, SameOriginApiProxySettings, SessionHandoffEndpoints |
| 16 | `DeleteBehaviorConventionTests` | MMCA.ADC.Architecture.Tests | 3 | ArchitectureRules, DeleteBehaviorConventionTestsBase, ServiceModels |
| 16 | `AddRoomHandlerTests` | MMCA.ADC.Conference.Application.Tests | 12 | AddRoomCommand, AddRoomHandler, ErrorType, Event, EventInvariants, HandlerTestBase<THandler>, IReadRepository<TEntity, TIdentifierType>, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Room, RoomDTOMapper, UnitOfWork |
| 16 | `UpdateEventHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | ErrorType, Event, EventDTOMapper, EventQuestionAnswerDTOMapper, EventSpeakerDTOMapper, EventUpdateRequest, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, RoomDTOMapper, Session, UnitOfWork, UpdateEventCommand, UpdateEventHandler |
| 16 | `UpdateSessionHandlerTests` | MMCA.ADC.Conference.Application.Tests | 13 | ErrorType, Event, HandlerTestBase<THandler>, IRepository<TEntity, TIdentifierType>, Session, SessionCategoryItemDTOMapper, SessionDTOMapper, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper, SessionUpdateRequest, UnitOfWork, UpdateSessionCommand, UpdateSessionHandler |
| 16 | `ConferenceIntegrationTestCollection` | MMCA.ADC.Conference.IntegrationTests | 1 | ConferenceIntegrationTestFixture |
| 16 | `CrossServiceCollection` | MMCA.ADC.CrossService.IntegrationTests | 1 | CrossServiceFixture |
| 16 | `EngagementEntityConfigurationTests` | MMCA.ADC.Engagement.Infrastructure.Tests | 9 | EngagementTestDbContext, LivePoll, LivePollInvariants, LivePollOption, LivePollVote, SessionQuestion, SessionQuestionInvariants, SessionQuestionUpvote, UserSessionBookmark |
| 16 | `EngagementIntegrationTestCollection` | MMCA.ADC.Engagement.IntegrationTests | 1 | EngagementIntegrationTestFixture |
| 16 | `IdentityModuleSeeder` | MMCA.ADC.Identity.API | 4 | IdentityModuleDbSeeder, IModuleSeeder, IPasswordHasher, IUnitOfWork |
| 16 | `PasswordResetController` | MMCA.ADC.Identity.API | 8 | ForgotPasswordCommand, ForgotPasswordRequest, ICommandHandler<in TCommand, TResult>, PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>, ResetPasswordCommand, ResetPasswordRequest, Result, Route |
| 16 | `RemoveUserAvatarHandler` | MMCA.ADC.Identity.Application | 9 | DeleteAvatarBlobInternalCommand, IInternalCommandScheduler, IUnitOfWork, MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>, MutationContext, RemoveUserAvatarCommand, Result, SetUserAvatarHandler, User |
| 16 | `SetUserAvatarHandlerTests` | MMCA.ADC.Identity.Application.Tests | 15 | DeleteAvatarBlobInternalCommand, Error, ErrorType, IFileStorageService, IImageProcessor, IInternalCommand, IInternalCommandScheduler, ImageContentSniffer, IRepository<TEntity, TIdentifierType>, IUnitOfWork, Result, SetUserAvatarCommand, SetUserAvatarHandler, User, UserRole |
| 16 | `IdentityEntityConfigurationTests` | MMCA.ADC.Identity.Infrastructure.Tests | 3 | IdentityTestDbContext, User, UserInvariants |
| 16 | `IdentityModuleDbSeederTests` | MMCA.ADC.Identity.Infrastructure.Tests | 6 | IdentityModuleDbSeeder, IPasswordHasher, IRepository<TEntity, TIdentifierType>, IUnitOfWork, SeederMocks, User |
| 16 | `ConferenceModeIdentityFixture` | MMCA.ADC.Identity.IntegrationTests | 1 | IdentityIntegrationTestFixture |
| 16 | `IdentityIntegrationTestCollection` | MMCA.ADC.Identity.IntegrationTests | 1 | IdentityIntegrationTestFixture |
| 16 | `JwksEnabledIdentityFixture` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestFixture, JwtTokenGenerator |
| 16 | `NotificationIntegrationTestCollection` | MMCA.ADC.Notification.IntegrationTests | 1 | NotificationIntegrationTestFixture |
| 16 | `UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>` | MMCA.Common.API | 15 | AuthControllerBase, ChangePasswordHandler, ChangePasswordRequest, ChangePreferencesHandler, ChangePreferencesRequest, CurrentUserService, GetUserPreferencesHandler, GetUserPreferencesQuery, IAuthenticationService, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, IUserScopedCommand<out TRequest>, Result, UserPreferencesResponse |
| 16 | `OverridingAuthController` | MMCA.Common.API.Tests | 5 | AuthControllerBase, AuthenticationResponse, IAuthenticationService, ICurrentUserService, RegisterRequest |
| 16 | `TestAuthController` | MMCA.Common.API.Tests | 3 | AuthControllerBase, IAuthenticationService, ICurrentUserService |
| 16 | `TestPasswordResetController` | MMCA.Common.API.Tests | 7 | ForgotPasswordRequest, ICommandHandler<in TCommand, TResult>, PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>, ResetPasswordRequest, Result, TestForgotPasswordCommand, TestResetPasswordCommand |
| 16 | `MutationContextHandlerTests` | MMCA.Common.Application.Tests | 8 | IRepository<TEntity, TIdentifierType>, IUnitOfWork, OrderAggregate, RenameOrderCommand, TestNoMutationHandler, TestRenameOrderHandler, TestRenameOrderPayloadHandler, TestSkippingRenameHandler |
| 16 | `AuditTrailCleanupJob` | MMCA.Common.Infrastructure | 6 | AuditTrailEntry, AuditTrailSettings, FrameworkTableTargets, IDbContextFactory, IScheduledJob, TenantDataSourceTarget |
| 16 | `InternalCommandAdministration` | MMCA.Common.Infrastructure | 11 | ApplicationDbContext, Error, FrameworkTableTargets, IDbContextFactory, IInternalCommandAdministration, IInternalCommandSignal, InternalCommandDeadLetter, InternalCommandMessage, InternalCommandsSettings, Result, TenantDataSourceTarget |
| 16 | `InternalCommandCleanupService` | MMCA.Common.Infrastructure | 7 | ApplicationDbContext, FrameworkTableTargets, IDbContextFactory, InternalCommandMessage, InternalCommandsSettings, PeriodicBackgroundService, TenantDataSourceTarget |
| 16 | `InternalCommandProcessor` | MMCA.Common.Infrastructure | 16 | Activity, AmbientOrigin, ApplicationDbContext, ColumnWidth, FrameworkTableTargets, IDbContextFactory, IInternalCommand, IInternalCommandSignal, InternalCommandCycleResult, InternalCommandDispatcher, InternalCommandMessage, InternalCommandMetrics, InternalCommandsSettings, PollingLoop, Result, TenantDataSourceTarget |
| 16 | `OutboxAdministration` | MMCA.Common.Infrastructure | 11 | ApplicationDbContext, Error, FrameworkTableTargets, IDbContextFactory, IOutboxAdministration, IOutboxSignal, OutboxDeadLetter, OutboxMessage, OutboxSettings, Result, TenantDataSourceTarget |
| 16 | `OutboxCleanupService` | MMCA.Common.Infrastructure | 9 | ApplicationDbContext, FrameworkTableTargets, IDbContextFactory, InboxMessage, MessageBusSettings, OutboxMessage, OutboxSettings, PeriodicBackgroundService, TenantDataSourceTarget |
| 16 | `OutboxProcessor` | MMCA.Common.Infrastructure | 20 | Activity, ApplicationDbContext, BrokerMetrics, BrokerResilienceDefaults, ColumnWidth, DataSourceKey, Event, FrameworkTableTargets, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, IIntegrationEvent, IMessageBus, IOutboxSignal, OutboxCycleResult, OutboxMessage, OutboxMetrics, OutboxSettings, PollingLoop, TenantDataSourceTarget |
| 16 | `EntityDataSourceRegistryTests` | MMCA.Common.Infrastructure.Tests | 15 | ConnectionStringSettings, DataSource, DataSourceEntrySettings, DataSourceKey, DataSourceResolver, DataSourcesSettings, EntityDataSourceRegistry, FixedAssemblyProvider, NamespaceConventions, PushNotification, RegistryDuplicate, RegistryInvoice, RegistryOrder, RegistrySqlServerEntity, RegistryUnattributed |
| 16 | `EntityTypeConfigurationTests` | MMCA.Common.Infrastructure.Tests | 2 | SqliteTestDbContext, SqliteTestEntity |
| 16 | `IdentityModuleDbSeederBaseTests` | MMCA.Common.Infrastructure.Tests | 7 | IPasswordHasher, IRepository<TEntity, TIdentifierType>, IUnitOfWork, SeedAccount, SeederMocks, TestIdentityModuleDbSeeder, TestSeedUser |
| 16 | `PushNotificationConfigurationTests` | MMCA.Common.Infrastructure.Tests | 2 | PushNotification, PushNotificationTestDbContext |
| 16 | `RotationHarness` | MMCA.Common.Infrastructure.Tests | 9 | ApplicationDbContext, DataSourceKey, EmptyEntityDataSourceRegistry, IDataSourceResolver, IDbContextFactory, Participant, RefreshSession, RefreshSessionCleanupServiceTests, RefreshSessionSettings |
| 16 | `StoreHarness` | MMCA.Common.Infrastructure.Tests | 9 | ApplicationDbContext, DataSourceKey, EmptyEntityDataSourceRegistry, IDataSourceResolver, IDbContextFactory, IRefreshSessionStore, RefreshSession, RefreshSessionCleanupServiceTests, RefreshSessionSettings |
| 17 | `ApiVersioningTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConferenceIntegrationTestCollection, ConferenceIntegrationTestFixture, ServiceInfoVersioningContractTestsBase<TFixture> |
| 17 | `ConferenceIntegrationTestBase` | MMCA.ADC.Conference.IntegrationTests | 6 | ConcurrencyETag, ConferenceIntegrationTestCollection, ConferenceIntegrationTestFixture, Email, IntegrationTestBase<TFixture>, JwtTokenGenerator |
| 17 | `OpenApiContractTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConferenceIntegrationTestCollection, ConferenceIntegrationTestFixture, OpenApiContractTestsBase<TFixture> |
| 17 | `ProblemDetailsContractTests` | MMCA.ADC.Conference.IntegrationTests | 5 | ConcurrencyETag, ConferenceIntegrationTestCollection, ConferenceIntegrationTestFixture, JwtTokenGenerator, ProblemDetailsContractTestsBase<TFixture> |
| 17 | `CrossServiceTestBase` | MMCA.ADC.CrossService.IntegrationTests | 9 | CrossServiceCollection, CrossServiceFixture, Email, IEventBus, IInternalCommandAdministration, IUnitOfWork, JwtTokenGenerator, TestPolling, UserRegistered |
| 17 | `EngagementIntegrationTestBase` | MMCA.ADC.Engagement.IntegrationTests | 5 | ConcurrencyETag, EngagementIntegrationTestCollection, EngagementIntegrationTestFixture, IntegrationTestBase<TFixture>, JwtTokenGenerator |
| 17 | `OpenApiContractTests` | MMCA.ADC.Engagement.IntegrationTests | 3 | EngagementIntegrationTestCollection, EngagementIntegrationTestFixture, OpenApiContractTestsBase<TFixture> |
| 17 | `ProblemDetailsContractTests` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementIntegrationTestCollection, EngagementIntegrationTestFixture, JwtTokenGenerator, ProblemDetailsContractTestsBase<TFixture> |
| 17 | `AuthController` | MMCA.ADC.Identity.API | 22 | AuthenticationResponse, AuthenticationService, ChangePasswordCommand, ChangePasswordRequest, ChangePreferencesCommand, ChangePreferencesRequest, GetUserPreferencesQuery, IAuthenticationService, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IInternalCommandScheduler, IQueryHandler<in TQuery, TResult>, LoginRequest, RegisterRequest, Result, Route, SendEmailConfirmationCommand, SendEmailConfirmationRequest, SyntheticAccounts, UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand> …(+2) |
| 17 | `RemoveUserAvatarHandlerTests` | MMCA.ADC.Identity.Application.Tests | 12 | DeleteAvatarBlobInternalCommand, Error, ErrorType, IInternalCommand, IInternalCommandScheduler, IRepository<TEntity, TIdentifierType>, IUnitOfWork, RemoveUserAvatarCommand, RemoveUserAvatarHandler, Result, User, UserRole |
| 17 | `ConferenceModeIdentityCollection` | MMCA.ADC.Identity.IntegrationTests | 1 | ConferenceModeIdentityFixture |
| 17 | `IdentityIntegrationTestBase` | MMCA.ADC.Identity.IntegrationTests | 4 | IdentityIntegrationTestCollection, IdentityIntegrationTestFixture, IntegrationTestBase<TFixture>, JwtTokenGenerator |
| 17 | `JwksIntegrationTestCollection` | MMCA.ADC.Identity.IntegrationTests | 1 | JwksEnabledIdentityFixture |
| 17 | `OpenApiContractTests` | MMCA.ADC.Identity.IntegrationTests | 3 | IdentityIntegrationTestCollection, IdentityIntegrationTestFixture, OpenApiContractTestsBase<TFixture> |
| 17 | `ProblemDetailsContractTests` | MMCA.ADC.Identity.IntegrationTests | 5 | Email, IdentityIntegrationTestCollection, IdentityIntegrationTestFixture, JwtTokenGenerator, ProblemDetailsContractTestsBase<TFixture> |
| 17 | `NotificationIntegrationTestBase` | MMCA.ADC.Notification.IntegrationTests | 4 | IntegrationTestBase<TFixture>, JwtTokenGenerator, NotificationIntegrationTestCollection, NotificationIntegrationTestFixture |
| 17 | `OpenApiContractTests` | MMCA.ADC.Notification.IntegrationTests | 3 | NotificationIntegrationTestCollection, NotificationIntegrationTestFixture, OpenApiContractTestsBase<TFixture> |
| 17 | `ProblemDetailsContractTests` | MMCA.ADC.Notification.IntegrationTests | 4 | JwtTokenGenerator, NotificationIntegrationTestCollection, NotificationIntegrationTestFixture, ProblemDetailsContractTestsBase<TFixture> |
| 17 | `AuthControllerBaseRateLimitTests` | MMCA.Common.API.Tests | 3 | AuthControllerBase, OverridingAuthController, WebApplicationBuilderExtensions |
| 17 | `AuthControllerBaseTests` | MMCA.Common.API.Tests | 14 | AuthClaimTypes, AuthControllerBase, AuthenticationResponse, Error, IAuthenticationService, ICurrentUserService, IdempotentAttribute, LoginRequest, NonIdempotentAttribute, RefreshSessionSummaryResponse, RefreshTokenRequest, RegisterRequest, Result, TestAuthController |
| 17 | `PasswordResetAuthControllerBaseTests` | MMCA.Common.API.Tests | 11 | Error, ForgotPasswordRequest, ICommandHandler<in TCommand, TResult>, IdempotentAttribute, PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>, ResetPasswordRequest, Result, TestForgotPasswordCommand, TestPasswordResetController, TestResetPasswordCommand, WebApplicationBuilderExtensions |
| 17 | `TestUserAccountAuthController` | MMCA.Common.API.Tests | 12 | ChangePasswordRequest, ChangePreferencesRequest, GetUserPreferencesQuery, IAuthenticationService, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, Result, TestChangePasswordCommand, TestChangePreferencesCommand, UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>, UserPreferencesResponse |
| 17 | `DependencyInjection` | MMCA.Common.Infrastructure | 174 | ApplicationNamespace, AuditSaveChangesInterceptor, AuditTrailCleanupJob, AuditTrailReader, AuditTrailSaveChangesInterceptor, AuditTrailSettings, AuthSessionIssuer, AzureBlobFileStorageService, AzureNotificationHubDeviceRegistrar, AzureNotificationHubNativePushSender, BrokerEventBus, BrokerMessageBus, CacheKeyNamespace, CacheKeyPrefixOptions, CacheSettings, ClaimBasedUserIdProvider, ClassReference, ConnectionStringSettings, ConnectionStringSettingsValidator, CorrelationContext …(+154) |
| 17 | `AddAuditTrailTests` | MMCA.Common.Infrastructure.Tests | 6 | AuditTrailCleanupJob, AuditTrailReader, AuditTrailSaveChangesInterceptor, AuditTrailSettings, IAuditTrailReader, IScheduledJob |
| 17 | `AuditTrailCleanupJobTests` | MMCA.Common.Infrastructure.Tests | 15 | ApplicationDbContext, AuditedThing, AuditTrailCleanupJob, AuditTrailEntry, AuditTrailSettings, AuditTrailTestContext, AuditTrailTestHarness, DataSource, DataSourceKey, FakeTimeProvider, FrameworkTableTargets, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, SchedulerTestHarness |
| 17 | `DependencyInjectionInfrastructureTests` | MMCA.Common.Infrastructure.Tests | 16 | AuditSaveChangesInterceptor, ConnectionStringSettings, DomainEventSaveChangesInterceptor, EntityConfigurationOptions, IDataSourceService, IEntityConfigurationAssemblyProvider, IQueryableExecutor, IRawSqlQueryExecutor, IRepository<TEntity, TIdentifierType>, IRepositoryFactory, IUniqueConstraintViolationDetector, IUnitOfWork, OutboxProcessor, OutboxSettings, SmtpSettings, SqlServerUniqueConstraintViolationDetector |
| 17 | `DependencyInjectionOutboxGateTests` | MMCA.Common.Infrastructure.Tests | 3 | OutboxCleanupService, OutboxDisabledNoticeService, OutboxProcessor |
| 17 | `EFRefreshSessionStoreFindByIdTests` | MMCA.Common.Infrastructure.Tests | 2 | RefreshSession, StoreHarness |
| 17 | `EFRefreshSessionStoreRotationTests` | MMCA.Common.Infrastructure.Tests | 3 | Participant, RefreshSession, RotationHarness |
| 17 | `InternalCommandTestHarness` | MMCA.Common.Infrastructure.Tests | 30 | AnonymousCurrentUserService, ApplicationDbContext, CorrelationContext, DataSource, DataSourceKey, DefaultDataSourceResolver, EmptyEntityDataSourceRegistry, ExecutionLog, FakeTimeProvider, FrameworkTableTargets, ICommandHandler<in TCommand, TResult>, ICorrelationContext, ICurrentUserService, IDbContextFactory, IInternalCommand, IInternalCommandSignal, ImpersonatingCurrentUserService, InternalCommandMessage, InternalCommandOriginCapture, InternalCommandProcessor …(+10) |
| 17 | `Mocks` | MMCA.Common.Infrastructure.Tests | 3 | IDataSourceResolver, IEntityDataSourceRegistry, OutboxCleanupService |
| 17 | `OutboxAdministrationTests` | MMCA.Common.Infrastructure.Tests | 13 | AdminTestContext, DataSource, DataSourceKey, FrameworkTableTargets, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, IOutboxSignal, OutboxAdministration, OutboxDeadLetter, OutboxMessage, OutboxSettings, Payload |
| 17 | `OutboxProcessorContextRestoreTests` | MMCA.Common.Infrastructure.Tests | 28 | AuditSaveChangesInterceptor, CapturingMessageBus, CorrelationContext, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FrameworkTableTargets, ICorrelationContext, ICurrentUserService, IDataSourceResolver, IDbContextFactory, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IMessageBus, IOutboxSignal, ITenantContext, OutboxMessage, OutboxOrigin …(+8) |
| 17 | `OutboxProcessorOrderingTests` | MMCA.Common.Infrastructure.Tests | 17 | DataSource, DataSourceKey, FakeTimeProvider, FrameworkTableTargets, IDataSourceResolver, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, IEntityDataSourceRegistry, IMessageBus, IOutboxSignal, OrderedTestEvent, OrderingTestContext, OutboxMessage, OutboxProcessor, OutboxSettings, Payload |
| 17 | `OutboxProcessorPerRowStampTests` | MMCA.Common.Infrastructure.Tests | 20 | AuditSaveChangesInterceptor, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FrameworkTableTargets, IDataSourceResolver, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IMessageBus, IOutboxSignal, OutboxMessage, OutboxProcessor, OutboxSettings, Payload, StampTestDbContext, StampTestEvent |
| 17 | `OutboxProcessorTests` | MMCA.Common.Infrastructure.Tests | 26 | AuditSaveChangesInterceptor, BrokerResilienceDefaults, DataSource, DataSourceKey, DomainEventSaveChangesInterceptor, EmptyEntityDataSourceRegistry, FakeTimeProvider, FrameworkTableTargets, IDataSourceResolver, IDbContextFactory, IDomainEvent, IDomainEventDispatcher, IEntityConfigurationAssemblyProvider, IEntityDataSourceRegistry, IIntegrationEvent, IMessageBus, IOutboxSignal, OutboxCycleResult, OutboxMessage, OutboxProcessor …(+6) |
| 17 | `OutboxProcessorWaitTests` | MMCA.Common.Infrastructure.Tests | 1 | OutboxProcessor |
| 17 | `TenantDataSourceTargetTests` | MMCA.Common.Infrastructure.Tests | 15 | DataSource, DataSourceKey, FrameworkTableTargets, IDataSourceResolver, IEntityDataSourceRegistry, IOutboxSignal, MessageBusSettings, OutboxCleanupService, OutboxProcessor, OutboxSettings, TenancySettings, TenantDataSourceOverrideSettings, TenantDataSourceTarget, TenantDataSourceTargets, TenantEntrySettings |
| 17 | `OutboxThroughputLoadTests` | MMCA.Common.LoadTests | 7 | CountingMessageBus, IMessageBus, LoadIntegrationEvent, LoadResults, LoadStack, OutboxMessage, OutboxProcessor |
| 18 | `AnonymousAccessDeniedTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `AnonymousConferenceReadTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `AnonymousSessionAssetTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `AttendeeAccessDeniedTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `AttendeeQuestionAnswerTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `AuditStampFidelityTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `ConcurrentSeedingTests` | MMCA.ADC.Conference.IntegrationTests | 7 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture, ConferenceModuleDbSeeder, ForwardingProxy, IUnitOfWork, Rendezvous, SeedRun |
| 18 | `CrossServiceUserRegisteredTests` | MMCA.ADC.Conference.IntegrationTests | 5 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture, IIntegrationEventHandler<in TIntegrationEvent>, IUnitOfWork, UserRegistered |
| 18 | `IdempotencyReplayTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerAssociationEdgeCaseTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerAssociationTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerCategoryTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerConcurrencyTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerEventLifecycleTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerEventTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerQuestionAnswerTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerQuestionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerRoomEdgeCaseTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerRoomTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerSessionAssetTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture, SessionAssetLimits |
| 18 | `OrganizerSessionEdgeCaseTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OrganizerSessionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `OutputCacheEvictionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `SessionDurationSortTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `SessionIncludeChildrenRegressionTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `SessionizeRefreshTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture, FakeSessionizeService |
| 18 | `SessionSelectionTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture, TestPolling |
| 18 | `SoftDeleteFidelityTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `SpeakerFeedbackAuthTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `SpeakerManagementTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `SpeakerSessionAssetTests` | MMCA.ADC.Conference.IntegrationTests | 3 | ConcurrencyETag, ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `SpeakerUpdateAuthTests` | MMCA.ADC.Conference.IntegrationTests | 2 | ConferenceIntegrationTestBase, ConferenceIntegrationTestFixture |
| 18 | `BookmarkCountGrpcTests` | MMCA.ADC.CrossService.IntegrationTests | 2 | CrossServiceFixture, CrossServiceTestBase |
| 18 | `CrossServiceSmokeTests` | MMCA.ADC.CrossService.IntegrationTests | 2 | CrossServiceFixture, CrossServiceTestBase |
| 18 | `SpeakerLinkBrokerFlowTests` | MMCA.ADC.CrossService.IntegrationTests | 2 | CrossServiceFixture, CrossServiceTestBase |
| 18 | `TwoReplicaHubFanOutTests` | MMCA.ADC.CrossService.IntegrationTests | 4 | CrossServiceFixture, CrossServiceTestBase, FakeCrossServiceAttendeeQueryService, NotificationHub |
| 18 | `UserRegisteredBrokerFlowTests` | MMCA.ADC.CrossService.IntegrationTests | 2 | CrossServiceFixture, CrossServiceTestBase |
| 18 | `AnonymousBookmarkAccessDeniedTests` | MMCA.ADC.Engagement.IntegrationTests | 2 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture |
| 18 | `AttendeeBookmarkTests` | MMCA.ADC.Engagement.IntegrationTests | 3 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeSessionBookmarkValidationService |
| 18 | `CheckInAuthorizationTests` | MMCA.ADC.Engagement.IntegrationTests | 5 | BadgePayload, CheckInScope, EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService |
| 18 | `CheckInScanRoundTripTests` | MMCA.ADC.Engagement.IntegrationTests | 6 | AttendeeCheckedIn, BadgePayload, CheckInScope, EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService |
| 18 | `LivePollAuthorizationTests` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService, Question |
| 18 | `OrganizerLivePollLifecycleTests` | MMCA.ADC.Engagement.IntegrationTests | 4 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService, Question |
| 18 | `PointsAwardRoundTripTests` | MMCA.ADC.Engagement.IntegrationTests | 10 | AttendeeCheckedIn, BadgePayload, CheckInScope, EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService, IIntegrationEventHandler<in TIntegrationEvent>, LedgerRow, PointsActivityType, PointsSubjectKeys |
| 18 | `PointsEndpointTests` | MMCA.ADC.Engagement.IntegrationTests | 7 | AttendeeCheckedIn, CheckInScopeNames, EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService, IIntegrationEventHandler<in TIntegrationEvent>, JwtTokenGenerator |
| 18 | `RoomCheckInRoundTripTests` | MMCA.ADC.Engagement.IntegrationTests | 6 | BadgePayload, CheckInRow, CheckInScope, EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService |
| 18 | `SessionQuestionLifecycleTests` | MMCA.ADC.Engagement.IntegrationTests | 3 | EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService |
| 18 | `SponsorVisitRoundTripTests` | MMCA.ADC.Engagement.IntegrationTests | 8 | AttendeeCheckedIn, EngagementIntegrationTestBase, EngagementIntegrationTestFixture, FakeEventLiveValidationService, IIntegrationEventHandler<in TIntegrationEvent>, LedgerRow, PointsActivityType, PointsSubjectKeys |
| 18 | `AuthControllerTests` | MMCA.ADC.Identity.API.Tests | 20 | AuthController, AuthenticationResponse, ChangePasswordCommand, ChangePasswordRequest, ChangePreferencesCommand, Error, ErrorType, GetUserPreferencesQuery, IAuthenticationService, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IInternalCommand, IInternalCommandScheduler, IQueryHandler<in TQuery, TResult>, LoginRequest, RefreshTokenRequest, RegisterRequest, Result, SendEmailConfirmationCommand, UserPreferencesResponse |
| 18 | `AnonymousAccessDeniedTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `AnonymousAuthEdgeCaseTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `AnonymousAuthTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `AttendeeAccessDeniedTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `AttendeeAuthTests` | MMCA.ADC.Identity.IntegrationTests | 4 | AuthResponse, Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `AttendeeClaimsTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `AttendeeProfileTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `AuthIpRateLimitConfigurationTests` | MMCA.ADC.Identity.IntegrationTests | 4 | ConferenceModeIdentityCollection, ConferenceModeIdentityFixture, IntegrationTestBase<TFixture>, RateLimitingSettings |
| 18 | `AuthPreferencesTests` | MMCA.ADC.Identity.IntegrationTests | 4 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture, PreferencesResponse |
| 18 | `CrossServiceSpeakerLinkTests` | MMCA.ADC.Identity.IntegrationTests | 8 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture, IIntegrationEvent, IIntegrationEventHandler<in TIntegrationEvent>, IUnitOfWork, SpeakerLinkedToUser, SpeakerUnlinkedFromUser |
| 18 | `EmailConfirmationFlowTests` | MMCA.ADC.Identity.IntegrationTests | 6 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture, IEmailConfirmationTokenService, IInternalCommandAdministration, TestPolling |
| 18 | `ErasureAndPiiLoggingTests` | MMCA.ADC.Identity.IntegrationTests | 4 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture, PiiLogCapture |
| 18 | `JwksIntegrationTestBase` | MMCA.ADC.Identity.IntegrationTests | 3 | IntegrationTestBase<TFixture>, JwksEnabledIdentityFixture, JwksIntegrationTestCollection |
| 18 | `OAuthChallengeTests` | MMCA.ADC.Identity.IntegrationTests | 2 | IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `OAuthExchangeTests` | MMCA.ADC.Identity.IntegrationTests | 5 | AuthenticationResponse, ExchangeResponse, ICacheService, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `OrganizerUserTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `OutboxFidelityTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `PasswordResetFlowTests` | MMCA.ADC.Identity.IntegrationTests | 4 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture, IPasswordResetTokenService |
| 18 | `UserExportTests` | MMCA.ADC.Identity.IntegrationTests | 4 | Email, FakeUserNotificationExportService, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `UsersAdminTests` | MMCA.ADC.Identity.IntegrationTests | 3 | Email, IdentityIntegrationTestBase, IdentityIntegrationTestFixture |
| 18 | `NotificationControllerTests` | MMCA.ADC.Notification.IntegrationTests | 3 | FakeAttendeeQueryService, NotificationIntegrationTestBase, NotificationIntegrationTestFixture |
| 18 | `NotificationHubTests` | MMCA.ADC.Notification.IntegrationTests | 4 | FakeAttendeeQueryService, NotificationHub, NotificationIntegrationTestBase, NotificationIntegrationTestFixture |
| 18 | `RateLimitingConfigurationTests` | MMCA.ADC.Notification.IntegrationTests | 3 | NotificationIntegrationTestBase, NotificationIntegrationTestFixture, RateLimitingSettings |
| 18 | `UserAccountAuthControllerBaseTests` | MMCA.Common.API.Tests | 15 | AuthenticationResponse, ChangePasswordRequest, ChangePreferencesRequest, Error, GetUserPreferencesQuery, IAuthenticationService, ICommandHandler<in TCommand, TResult>, ICurrentUserService, IQueryHandler<in TQuery, TResult>, LoginRequest, Result, TestChangePasswordCommand, TestChangePreferencesCommand, TestUserAccountAuthController, UserPreferencesResponse |
| 18 | `DbContextFactoryTransactionTests` | MMCA.Common.Infrastructure.Tests | 23 | DataSource, DataSourceKey, DbContextFactory, DefaultDataSourceResolver, Error, FakeTimeProvider, ICurrentUserService, IDomainEvent, IDomainEventDispatcher, IEntityDataSourceRegistry, IInternalCommandSignal, InternalCommandMessage, InternalCommandScheduler, InternalCommandTestHarness, IPhysicalDbContextFactory, ITenantContext, OutboxMessage, RecordingCommand, Result, TenancySettings …(+3) |
| 18 | `InternalCommandAdministrationTests` | MMCA.Common.Infrastructure.Tests | 12 | DataSourceKey, DefaultDataSourceResolver, EmptyEntityDataSourceRegistry, FakeTimeProvider, FrameworkTableTargets, IDbContextFactory, IInternalCommandSignal, InternalCommandAdministration, InternalCommandMessage, InternalCommandTestContext, InternalCommandTestHarness, RecordingCommand |
| 18 | `InternalCommandCleanupServiceTests` | MMCA.Common.Infrastructure.Tests | 13 | DataSource, DataSourceKey, DefaultDataSourceResolver, EmptyEntityDataSourceRegistry, FakeTimeProvider, FrameworkTableTargets, IDbContextFactory, InternalCommandCleanupService, InternalCommandMessage, InternalCommandsSettings, InternalCommandTestContext, InternalCommandTestHarness, RecordingCommand |
| 18 | `InternalCommandProcessorTests` | MMCA.Common.Infrastructure.Tests | 11 | Error, ExecutionLog, FakeTimeProvider, IInternalCommandSignal, InternalCommandMessage, InternalCommandProcessor, InternalCommandTestContext, InternalCommandTestHarness, RecordingCommand, Result, StubCurrentUserService |
| 18 | `InternalCommandSchedulerTests` | MMCA.Common.Infrastructure.Tests | 9 | FakeTimeProvider, ICurrentUserService, IInternalCommandSignal, InternalCommandMessage, InternalCommandScheduler, InternalCommandTestContext, InternalCommandTestHarness, RecordingCommand, StubCurrentUserService |
| 18 | `OutboxCleanupServiceTests` | MMCA.Common.Infrastructure.Tests | 18 | ApplicationDbContext, CleanupTestContext, DataSource, DataSourceKey, FakeClockLoop, FakeTimeProvider, FrameworkTableTargets, IDataSourceResolver, IDbContextFactory, IEntityDataSourceRegistry, InboxMessage, MessageBusSettings, Mocks, Mocks, OutboxCleanupService, OutboxMessage, OutboxSettings, Payload |
| 18 | `OutboxProcessorExecuteAsyncTests` | MMCA.Common.Infrastructure.Tests | 10 | DataSource, DataSourceKey, DependencyInjection, FakeTimeProvider, FrameworkTableTargets, IDataSourceResolver, IEntityDataSourceRegistry, IOutboxSignal, OutboxProcessor, OutboxSettings |
| 19 | `JwksDiscoveryTests` | MMCA.ADC.Identity.IntegrationTests | 3 | JwksEnabledIdentityFixture, JwksIntegrationTestBase, JwtTokenGenerator |
