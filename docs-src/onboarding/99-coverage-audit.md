# Phase 4, Coverage Audit

This audit reconciles the written guide against the mechanically-extracted inventory, logs every
deliberate exception, verifies the grouping/ordering rules, proves all 34 rubric categories are
explained, and lists what could not be determined from source. All counts are reproducible from
`Tools/invtool/` (`classify.ps1`, `plan.ps1`, `verify.ps1`).

---

## 1. Coverage reconciliation

| Quantity | Count | Source |
|----------|------:|--------|
| `.cs` files scanned | 2,210 | `00-inventory.md` |
|, in-scope | 2,132 | |
|, generated/excluded | 78 | logged exception §2.1 |
| Type declaration rows (incl. partial-class fragments) | 2,674 | `00-inventory.md` |
| **Distinct type nodes (partials collapsed)** | **2,587** | the master checklist |
| → mapped to a functional group | 2,587 | `classify.ps1` (0 unmapped) |
| → individually sectioned (named in a chapter) | 1,495 | `verify.ps1` |
| → rolled up by project (G25 test classes) | 1,092 | logged exception §2.2 |
| Distinct `###` sections written across 27 chapters | 1,421 | covering the 1,495 (sibling families share a section, §2.3) |
| Chapter overviews written | 27 | one per group |

**Cross-check result:** `verify.ps1` confirms **0** of the 1,495 individually-sectioned types are
missing from their group chapter, every one appears as a `###` heading or in a sibling-family
`File:Line` table. 2,587 = 1,495 individually-sectioned + 1,092 rolled-up. Nothing dropped, nothing
double-counted (each type maps to exactly one group).

> **Regeneration note (re-verified against current source, polyglot-persistence update).** This audit
> was regenerated after the **polyglot-persistence framework enhancement** (MMCA.Common commit
> `74c0372`, ADR-018) and the matching ADC change. The net change since the previous pass (**+25**
> distinct nodes: 1,826 → 1,851) is:
> - **G03 (+3):** the cross-source specification helper, `CrossSourceSpecification` + its
>   `ParameterReplacer` (Application layer) and the new `InlineSpecification<T,TId>` (Domain layer)
>   that resolve a related principal's keys and filter by foreign-key `IN`, so a predicate stays
>   translatable when the principal lives in a different physical data source.
> - **G07 (+1):** the unified engine-aware `EntityTypeConfiguration<T,TId>` base (declares its engine
>   via `[UseDataSource]`); the three `…SQLServer/Sqlite/Cosmos` bases are now thin shims over it.
> - **G18 (+1 net):** ADC Conference's public-session filter was refactored from the cross-source-unsafe
>   `PublicSessionSpecification` (removed) to `GetPublicSessionFilterQuery` + `GetPublicSessionFilterHandler`
>   built on `CrossSourceSpecification`.
> - **G25 (+20):** the polyglot test suites (`CrossSourceSpecificationTests`, `SpecificationFitnessTests`,
>   `CosmosConfigurationPortabilityTests`, `DatabaseInitializationExtensionsTests`, plus fixtures) and the
>   shared `SpecificationConventionTestsBase` + the opt-in `SpecificationsDoNotNavigateToOtherEntities`
>   fitness rule, against the removed `PublicSessionSpecificationTests`.
>
> The Aspire hosting API was also renamed (`WithDataSource` → `WithSQLServerDataSource`, plus new
> `WithCosmosDataSource`/`WithSqliteDataSource`), and ADRs 011–018 (which post-date the first build) are
> now cross-referenced where their patterns are taught.

> **Regeneration note (re-verified against current source, permission-authorization + TimeProvider
> update).** This audit was regenerated again after the **permission-based authorization** mechanism
> (MMCA.Common commit `bc6c5d7`, released v1.80.0) and ADC's adoption of it (commit `ac5b175`), together
> with a framework-wide move off ambient `DateTime.UtcNow` to an injected `TimeProvider`. The net change
> since the polyglot pass (**+16** distinct nodes: 1,851 → 1,867) is:
> - **G08 (+9):** the Common permission mechanism, `IPermissionRegistry` / `PermissionRegistry` /
>   `PermissionRegistryBuilder` / `AuthClaimTypes` (Shared) and `HasPermissionAttribute` /
>   `PermissionAuthorizationHandler` / `PermissionPolicy` / `PermissionPolicyProvider` /
>   `PermissionRequirement` (API). `AuthorizationExtensions` gained `AddPermissions`, and `RoleNames`
>   gained `ContentEditor`.
> - **G17 (+1):** ADC's `ConferencePermissions` capability catalog (Conference.Shared).
> - **G23 (+2):** ADC's `IdentityPermissions` catalog (Identity.Shared) and the `AuthenticationValidators`
>   parameter object (Identity.Application) that keeps `AuthenticationService` under the constructor-arity
>   ceiling. `UserRole` gained `ContentEditor`.
> - **G25 (+4):** the new permission tests, `PermissionRegistryTests`, `PermissionAuthorizationHandlerTests`,
>   `PermissionPolicyProviderTests` (Common), and `ConferencePermissionGrantsTests` (ADC).
>
> TimeProvider adoption changed signatures without adding types: `TokenService` (G08),
> `UserNotification.MarkAsRead` + the two notification read handlers (G10), `Event.RecordSessionizeRefresh`
> (G17), `RefreshFromSessionizeHandler` (G18), and `AuthenticationService` (G23) now take or inject the
> clock. ADR-019 (layered rate limiting) was added to the ADR set (001–019) and is cross-referenced where
> rate limiting is taught (G08/G12).

> **Regeneration note (re-verified against current source, v1.83.0 full drift sweep).** This audit was
> regenerated again at **framework v1.83.0** (MMCA.Common `b9a6a28`; MMCA.ADC `17dce5a`; FACTS.md is the
> source of truth for the version / 13-package / 23-ADR figures). The net change since the permission pass
> (**+2** distinct nodes: 1,867 to 1,869) is entirely in **G25 (+2):** `FixedTimeProvider` (the injected-`TimeProvider`
> test clock in `MarkAllNotificationsReadHandlerTests.cs:65`) and `RateLimitPartitionTests`
> (`MMCA.Common.API.Tests/Startup/RateLimitPartitionTests.cs:16`, ADR-019). Both are per-project test types
> and roll up by project (768 to 770), so the individually-sectioned count is unchanged at 1,099. No type was
> added, removed, or regrouped outside G25.
> - **Two moved declaration citations** were re-verified and corrected: `BaseDomainEvent`
>   (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs` `:10` to `:18`, an `<remarks>`
>   block now documenting the creation-time `DateOccurred` default as a deliberate choice, comment-only,
>   commit `b99f46c`) and `OpenApiEndpointExtensions`
>   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs` `:16` to `:18`),
>   which gained an opt-in **Scalar OpenAPI UI** helper (`MapCommonScalarUi`, behind the non-production guard,
>   commit `706df4d`); the G12 section now documents it.
> - **Four ADRs finalized since the last pass (020-023) are now cross-referenced** where their patterns are
>   taught. The code for all four predated the last guide pass (the types were already in the baseline), so
>   the sections existed but did not yet cite the ADRs: **ADR-020** (permission authorization) in G08 (the
>   permission-policy sections + the `IPermissionRegistry`/`PermissionRegistry`/`PermissionRegistryBuilder`
>   registry), **ADR-021** (consumer inbox idempotency) in G04 (the `IInboxStore`/`EfInboxStore`/`InboxMessage`
>   sections), **ADR-022** (browser session-cookie auth) in G08 (the session-cookie subsystem), and **ADR-023**
>   (security response headers + pluggable CSP) in G16 (`SecurityHeadersMiddleware`/`ICspPolicyProvider` in
>   `MMCA.Common.Aspire`) and G24 (ADC's `BlazorCspPolicyProvider`).
> - **G08 unit repack (no content lost).** Re-running `plan.ps1` repartitioned G08's sections units: the
>   session-cookie (`MMCA.Common.API.SessionCookies`) and permission (`MMCA.Common.API.Authorization`)
>   namespaces shifted the level-ordered packing, so G08 was re-authored across five units (p00 overview +
>   p01 to p04, 49 `###` sections) to restore the twelve session-cookie sections and re-home the JWT/token/DTO/
>   registry sections without any drop or duplicate (`verify.ps1`: 0 missing; no new same-name-collision
>   headings). The G25 per-project rollup (`-p07`) was reconciled to **770**, correcting four pre-existing
>   undercounts (`MMCA.Common.Shared.Tests` 18 to 19, `MMCA.Common.API.Tests` 37 to 40,
>   `MMCA.Common.Application.Tests` 133 to 134, `MMCA.ADC.Conference.API.Tests` 13 to 14). Scope note: `build/facts`
>   (the new FACTS.md generator in the MMCA.Common repo root) is build tooling, not framework/app source, and
>   is excluded from the inventory by the same rule as `Tools/invtool`.

> **Regeneration note (re-verified against current source, v1.93.0 full drift sweep).** Regenerated at
> **framework v1.93.0** (MMCA.Common `3e72bfa`; MMCA.ADC `89d8439`; FACTS.md is the source of truth for the
> version / 13-package / **34-ADR (001-034)** figures). Net change since the v1.83.0 pass: **+41** distinct
> nodes (1,869 → 1,910), individually-sectioned 1,099 → **1,137**, rolled-up 770 → **773**, `###` sections
> 883 → **931**. The change is **+73 added, 9 removed (all G25 test renames/consolidation), 0 regrouped**,
> clustered around the post-v1.83 ADRs (`verify.ps1`: 0 missing; rubric 34/34):
> - **i18n / multi-locale (ADR-027, supersedes ADR-011).** Server-side edge error localization keyed by
>   `Error.Code`: **G12 (+5)** `ErrorLocalizer` / `IErrorLocalizer` / `ErrorResourceSource`
>   (`MMCA.Common.API/Localization/`), `ErrorResources` (`MMCA.Common.API/Resources/ErrorResources.cs:9`),
>   and `SupportedCultures` (`MMCA.Common.Shared/Globalization/SupportedCultures.cs:9`, re-homed from the
>   `Shared`-to-G08 catch-all into G12 beside the edge localizer via a new classifier rule). Per-module
>   localized error resources: **G20 (+1)** `ConferenceErrorResources`, **G22 (+1)** `EngagementErrorResources`,
>   **G23 (+1)** `IdentityErrorResources`. Culture bootstrap + forwarding in **G15**: `MmcaCultureBootstrap`,
>   `CultureDelegatingHandler`, `SharedResource`, the `IUserPreferenceReader/Writer` + `ApiUserPreferenceReader/Writer`
>   pair, `UserPreferences` / `UserPreferencesRequest` (`MMCA.Common.UI/`).
> - **Day/Dark theme (ADR-028).** **G15** `ThemeService` (`MMCA.Common.UI/Services/ThemeService.cs:16`) plus the
>   per-user preference plumbing above; **G23 (+6)** `ChangePreferences{Command,Handler,Request}` /
>   `GetUserPreferences{Query,Handler}` / `UserPreferencesResponse` persist `PreferredCulture` / `PreferredTheme`.
>   *Honest adoption note:* the `AddUserPreferences` EF migration is **not yet applied to the production ADC /
>   Store Identity databases**, so the Profile preferences endpoint errors in prod until it is (stated in G23).
> - **PII redaction (§30 / ADR-005).** **G02 (+2)** `PiiRedactor` + its private nested `RedactableProperty`
>   (`MMCA.Common.Domain/Privacy/PiiRedactor.cs:24,123`, commit `b2b0aae`) mask `[Pii]`-marked members for
>   log/telemetry-safe output; a new classifier rule routes `MMCA.Common.Domain.Privacy.*` to G02 beside the
>   existing `PiiAttribute` / `IAnonymizable`.
> - **G25 (+12 net, 874 total).** New reusable/fitness infra sectioned in full: `LocalizationResourceTestsBase`
>   + `TranslationCompletenessTests` (ADR-027 resx parity), `PiiErasureContractFitnessTests` + `DataSubjectSample`
>   (§30/ADR-005), `SliceCohesionTests`/`SliceCohesionTestsBase` (§5 VSA), `MarkupSnapshot`/`MarkupSnapshotResult`
>   (§28), `ConstructorDependencyCountTests` / `FormsConventionTests` / `FrameworkVersionConsistencyTests`. New
>   **`MMCA.Common.Benchmarks`** project (4 BenchmarkDotNet types: `SpecificationBenchmarks` / `SampleItem` /
>   `MinValueSpec` / `ActiveSpec`, §12 perf smoke) added to the per-project rollup. The 9 removed are G25 renames
>   (`OrganizerSpeaker*Tests` / `SpeakerProfileTests` / `AttendeeBookmarkEdgeCaseTests` → `CrossService*`;
>   `IntegrationTestBase` / `*Fixture` / `*Collection` / `TestWebApplicationFactory` consolidated).
> - **ADRs 024-034 are now cross-referenced** where their patterns are taught even when they added no type
>   (their code predated the baseline): **ADR-024** (two-channel notifications) in G10, **ADR-025** (startup
>   warm-up/readiness) in G16, **ADR-026** (two-tier caching) in G09, **ADR-029** (brute-force protection) /
>   **ADR-032** (password hashing) / **ADR-033** (resource-ownership, `OwnerOrAdminFilter`/`OwnershipHelper`,
>   Store-adopted) in G08, **ADR-030** (startup sole-migrator) in G07/G12, **ADR-031** (feature-flag management)
>   and **ADR-034** (generic entity controllers + dynamic query contract) in G12/G03. The primer's ADR table was
>   extended 019 → 034 and its §27 note rewritten (ADR-011 → ADR-027), with a new §20 day/dark-theme note (ADR-028).
> - **Pipeline governance changes** (classifier/extractor, in the uncommittable workspace `Tools/invtool`): one
>   new prefix rule `Domain.Privacy → G02`, one `Shared.Globalization → G12` (SupportedCultures), `Benchmarks → G25`
>   test-detection, and an extractor exclusion of `build/facts` (the FACTS.md generator) so `FactsGenerator` no
>   longer leaks into the inventory. Cycles 13 → **14** (a new G25 test SCC). Edge resolution: **6,238** namespace-
>   visible (~98%) + **140** globally-unique fallback, **25** dropped ambiguous.

> **Regeneration note (re-verified against current source, v1.103.1 full drift sweep).** Regenerated at
> **framework v1.103.1** (MMCA.Common `62fefa9`, MMCA.ADC `bdf8604d`, both clean; FACTS.md is the source of
> truth for the version / **14-package** / ADR-range figures, the fourteenth package being the new
> `MMCA.Common.UI.Web` project). Net change since the v1.93.0 pass: **+31** distinct nodes (1,910 → 1,941),
> individually-sectioned 1,137 → **1,166**, rolled-up 773 → **775**, `###` sections 931 → **996**
> (`verify.ps1`: 0 missing; rubric 34/34). The change is **+34 added, 2 removed, 8 moved repo-to-repo, 1
> two-to-one merge, 0 regrouped**, clustered around the move-to-Common extraction Waves 2-3 and the i18n
> pseudo-localization gate:
> - **Shared authentication workflow (ADR-032, Wave 3, MMCA.Common commit `69dfd53`).** **G08 (+4, 54 total):**
>   `AuthenticationServiceBase<TUser>` (`MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:34`),
>   `IAuthUser` (`MMCA.Common.Domain/Auth/IAuthUser.cs:10`), `OwnerOrAdminFilterOptions`
>   (`MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:11`), plus `AuthenticationValidators` moved in
>   from ADC Identity.Application (byte-identical body). ADC's `AuthenticationService` is now a thin subclass
>   supplying per-app hooks (its G23 section was rewritten accordingly). One new classifier prefix rule,
>   `MMCA.Common.Domain.Auth → G08` (user-approved 2026-07-04), resolved the only unmapped type.
> - **Edge controller bases hoisted (G12 +5, 52 total):** `OAuthControllerBase` and `ServiceInfoControllerBase`
>   (new, with nested `ServiceInfoResponse`/`ServiceInfoV2Response` moved from ADC's `ServiceInfoController`),
>   plus `ExternalAuthExtensions` moved from ADC Identity.API (the ADC copies were deleted).
> - **UI auth/CSP plumbing hoisted + pseudo-loc gate (G15 +11, 80 total).** Moved in: `BlazorCspPolicyProvider`
>   and `ServerTokenStorageService` (into the new `MMCA.Common.UI.Web` project, whose `DependencyInjection` is
>   also new), `WasmTokenStorageService`, `ChildEntityServiceBase`, and `ConfigurationOAuthUISettings` (a 2-to-1
>   merge of ADC's `AdcOAuthUISettings` + `WasmOAuthUISettings`, the sole -1 in the node arithmetic). New for the
>   ADR-027 pseudo-localization gate: `PseudoLocalizer` / `PseudoStringLocalizer` / `PseudoStringLocalizerFactory` /
>   `ResxMudLocalizer` (`MMCA.Common.UI/Globalization/`) and `MudTranslations`. **G16 (+1, 15 total):**
>   `GatewayCorsExtensions`. Donor chapters shrank accordingly: G20 38 → 36, G21 71 → 70, G23 68 → 66, G24 35 → 30.
> - **G22 (-1, 56 total):** `OwnBookmarkSpecification` deleted as dead code (zero call sites at prior HEAD
>   `89d8439`; its ownership-scoping role had already been superseded by the shared `OwnerOrAdminFilter`, ADR-033).
> - **G25 (+21 net, 895 total).** New sectioned infrastructure: six Testing.Architecture bases
>   (`BrandColorTokenTestsBase`, `ConstructorDependencyCountTestsBase`, `DataResidencyTestsBase`,
>   `FormsConventionTestsBase`, `FrameworkVersionConsistencyTestsBase`, `LocalizedTextConventionTestsBase`),
>   the `WebVitalsCollector`/`WebVitalsSample`/`WebVitalsArtifact` trio, `AuthorizationTestsBase`,
>   `SecurityHeadersTestsBase`, and `SqlServerIntegrationTestFixtureBase<TEntryPoint>`; plus rolled-up test
>   classes (pseudo-loc and web-vitals suites, `LocalizedTextConventionTests` in both repos). ADC's
>   `ProtectedPageExtensions` was removed, functionally superseded by `AuthorizationTestsBase` (different shape,
>   tracked as removed+added, not moved). Rollup reconciled: `MMCA.Common.UI.Tests` 26 → 31,
>   `MMCA.Common.UI.E2E.Tests` 7 → 9.
> - **Level repack (no content lost).** The new Common bases changed dependency Levels, which re-sorted
>   `plan.ps1`'s packing in G08/G12/G15/G18/G21/G22/G23/G25. 48 units (10 overviews + 37 section units + the G25
>   rollup) were re-authored to the new unit boundaries and the orphaned part `group-25-adc-host-composition-p03`
>   (all-stale sections) was deleted (`verify.ps1`: 0 missing, no duplicate headings). G18's inputs repacked with
>   zero content change, so its parts were deliberately left as-is (chapter coverage is unaffected; part/unit
>   alignment catches up on the next G18-touching pass).
> - **Corrections made while re-verifying:** the stale G23 callout that the Profile preferences endpoint errors
>   in production was removed (the `AddUserPreferences` migrations were since applied; applied-state itself is
>   Not determinable from source), `IdentitySettings` is now documented as an unwired placeholder (no
>   `Configure<IdentitySettings>` and no reader anywhere in MMCA.ADC; the live BR-213 registration throttle is
>   Common's `LoginProtectionSettings.MaxRegistrationsPerIpPerHour`), and `EngagementUIModule`'s stale XML-doc
>   claim of contributing navigation items is corrected to the code's actual `NavItems = []`. Cycles 14 → **13**
>   (the extraction dissolved one SCC). Edge resolution: **143** globally-unique fallback, **25** dropped ambiguous.

> **Regeneration note (re-verified against current source, v1.111.0 full drift sweep + new group creation).**
> Regenerated at **framework v1.111.0** (MMCA.Common `c50d86f`, clean; MMCA.ADC `f3aba4b9`, working tree dirty
> only on three governance files unrelated to this pass: `ArchitectureScorecard.md`, `RemediationBacklog.md`,
> `infra/main.bicep`; `FACTS.md` is the source of truth for the version / 14-package / ADR-range (001-041)
> figures). Net change since the v1.103.1 pass: **+346** distinct nodes (1,941 -> 2,287), individually-sectioned
> 1,166 -> **1,284**, rolled-up 775 -> **1,003**, `###` sections 996 -> **1,143** across the now-26 chapters
> (`verify.ps1`: 0 missing; rubric 34/34). The change is **+346 added, 0 removed, 0 moved repo-to-repo,
> 7 regrouped (all approved classifier fixes, below)**, clustered around the v1.106.0-v1.111.0 release train:
> - **New group created (governance event, user-approved 2026-07-10): G26, "ADC Engagement Live Layer
>   (Real-Time Polls & Session Q&A)"**, chapter file `group-23-engagement-live-layer.md` (89 types). All 89
>   land mechanically in G22 via the broad `MMCA.ADC.Engagement` prefix rule, but G22's charter is explicitly
>   the async Session-Bookmarks slice; the live layer (added whole in MMCA.ADC commits `58476d84`/`e2f304ea`)
>   is a synchronous, SignalR-hub-channel-driven (ADR-039), cross-service (gRPC) audience-interaction
>   capability with its own aggregates (`LivePoll`/`LivePollOption`/`LivePollVote`,
>   `SessionQuestion`/`SessionQuestionUpvote`), 7 CQRS use-case folders, 2 controllers, and the
>   HappeningNow / SessionLive / PresenterView UI. Approved with **mid-list placement directly after G22**
>   (IDs are append-only, so the new group ID is G26 while the chapter takes file slot 23); renumber fallout:
>   identity-module 23 -> 24, adc-host-composition 24 -> 25, testing-infrastructure 25 -> 26 (17 part files
>   renamed content-unchanged, 3 stale assembled chapters deleted, 110 link occurrences fixed across 30 files).
> - **Three approved regroups** (catch-all fallback landings, classifier O-override/prefix fixes dated
>   2026-07-10 in `Tools/invtool/classify.ps1`): the ADR-039 hub-channel trio `ILiveChannelPublisher` /
>   `NullLiveChannelPublisher` / `SignalRLiveChannelPublisher` from the G07 fallback to **G10** (exact
>   structural sibling of the push-sender trio); the Result JSON round-trip trio `ResultJsonConverterFactory` /
>   `ResultConverter` / `PropertyReader` (`MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:15,35,95`)
>   from the G08 `Shared` catch-all to **G01** (the three form a 3-node cycle with `Result` itself); and
>   `HttpResilienceDefaults` (`MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:10`) to **G16**, since
>   its only consumers are ServiceDefaults (`MMCA.Common.Aspire/Extensions.cs:45-78`) and the typed gRPC
>   client (`MMCA.Common.Grpc/DependencyInjection.cs:87-108`), which re-apply the same Polly values.
> - **Per-group adds:** G04 +1 `OutboxFinalizer`
>   (`MMCA.Common.Infrastructure/Persistence/Outbox/OutboxFinalizer.cs:12`, the v1.110.0 async outbox
>   finalize); G05 +1 `QueryCacheKeyLocks` (nested in `CachingQueryDecorator.cs`, cache-stampede lock);
>   G12 +2 ADR-040 authenticated output caching (`OutputCacheOptionsExtensions.cs:6`,
>   `PublicEndpointOutputCachePolicy.cs:35`); G15 +1 `ChannelSubscription` (nested in
>   `NotificationHubService.cs`, a new L2 cycle); G17 +7 two-event-home + live-validation contracts
>   (`MMCA.ADC.Conference.Shared/Events/`: `CurrentEventSelector`, `CurrentEventDefaults`, `EventLiveInfo`,
>   `SessionLiveInfo`, `IEventLiveValidationService`, `DisabledEventLiveValidationService`,
>   `QuestionModerationDefault`); G18 +3 (`EventLiveValidationService.cs:18` + the `GetSpeakersByEventFilter`
>   query/handler); G20 +3 cross-service live-validation gRPC (`EventLiveValidationServiceGrpcAdapter.cs:23`,
>   `GrpcErrorTrailerParser.cs:14`, `EventLiveValidationGrpcService.cs:22`); G10 +6 (adds
>   `LiveChannelPublisherGrpcAdapter.cs:20`, `LiveChannelGrpcService.cs:19`, the new Notification.Contracts
>   `DependencyInjection.cs:14`, plus the 3 regrouped in); G01 +3 and G16 +1 regrouped in; G26 +89 (the new
>   chapter); G25 +229 rolled-up test classes (the v1.106.0 unit/integration/E2E programs plus the live-layer
>   suites), including the new individually-sectioned `UserPreferencesTestsBase` (Testing.E2E), lifting the
>   sectioned G25 infrastructure count 120 -> 121.
> - **Repack alignment repair.** `plan.ps1`'s repack shifted unit boundaries through G17/G18, so the first
>   assembly dropped 9 sections (the 5 DecisionSupport records and the 4 Questions/Update use-case types) and
>   duplicated 23 headings between re-authored and stale parts. Thirteen stale parts (G17 p01/p03/p04/p05,
>   G18 p04/p06-p13) were re-authored to the new boundaries; final `verify.ps1` reports 0 missing and the two
>   chapters have no same-type duplicate headings (the remaining `### StatusBucket` pair is two distinct
>   nested enums: `GetCategoryDistributionHandler.cs:94` and `GetSessionSelectionDashboardHandler.cs:308`).
>   G12's p02-p05 part/unit misalignment (chapter-complete, duplicate-free) is pre-existing and catches up on
>   the next G12-touching pass, per the same convention as the v1.103.1 G18 note.
> - **Corrections made while re-verifying** (spot-checks + re-author passes): the G15 overview's claim that
>   `LayoutSettings` is validated on start was fixed (only `ApiSettings` has
>   `.ValidateDataAnnotations().ValidateOnStart()`, `MMCA.Common.UI/DependencyInjection.cs:29-32`;
>   `LayoutSettings` is bind-only with defaults, `:34-36`); the `Speaker` section's claim that category-item
>   adds have no duplicate guard was fixed (the guard exists at `Speaker.cs:296-303`; the unguarded add is
>   `AddSpeakerQuestionAnswer`, `:353`); the `Event` walkthrough was refreshed including the new
>   `QuestionModerationDefault` field (`Event.cs:54`, BR-233).
> - **ADR cross-references:** ADR-039 (hub channels) is now cited in G10/G15 and throughout the new
>   live-layer chapter; ADR-040 (authenticated output caching) in G12/G20. **ADR-041 (observability) is not
>   yet cross-referenced anywhere in the guide**; its natural home is the devops-aspire chapter, which is
>   outside this pass's scope. Flagged for the next devops-touching pass rather than cited without
>   re-verifying that chapter.
> - Cycles 13 -> **16** (new: the G15 `NotificationHubService`/`ChannelSubscription` pair and two G25 test
>   SCCs around `CosmosConfigurationPortabilityTests`/`DatabaseInitializationExtensionsTests`/
>   `FixedAssemblyProvider`/`MultiSourceSqliteIntegrationTests`); all three verified in-group. Edge
>   resolution: **192** globally-unique fallback, **26** dropped ambiguous.

> **Regeneration note (re-verified against current source, v1.116.0 full drift sweep + G27 chapter authored).**
> Regenerated at **framework v1.116.0** (MMCA.Common `09cf78e`, clean; MMCA.ADC `2632af6c`, clean; `FACTS.md`
> is the source of truth for the version / **15-package** / **48-ADR (001-048)** figures, the fifteenth
> package being `MMCA.Common.UI.Maui`, the one MAUI-TFM package, ADR-042). Net change since the v1.111.0 pass:
> **+210** distinct nodes (2,287 -> **2,497**), individually-sectioned 1,284 -> **1,465**, rolled-up 1,003 ->
> **1,032**, `###` sections 1,143 -> **1,397** across the now-**27** chapters (`verify.ps1`: 0 missing; rubric
> 34/34). The change is **+210 added, 0 removed, several repo-to-repo moves, 0 confident type-level regroups**,
> clustered around the v1.106.0-v1.116.0 release train (ADRs 042-048). **Data-quality caveat:** an earlier
> incomplete session had already regenerated the mechanical files (`out/`, `00-group-taxonomy.md`,
> `00-inventory.md`, `00-dependency-manifest.md`, `_units/`, `_typemap.tsv`) to this 2,497/27-group state
> without authoring the new chapter or touching the front-matter prose, so the exact prior `00-nodes.tsv`
> snapshot no longer existed on disk; this delta was reconstructed from git history (`v1.111.0..HEAD` /
> `f3aba4b9..HEAD`) cross-referenced against the fresh inventory, not a byte-exact file diff. The node totals
> and classifier output are exact; the per-type added/moved attributions are git-derived.
> - **New group created (governance event, user-approved 2026-07-16): G27, "Device Capability Abstraction
>   Layer (Native Contracts, MAUI, Browser & Fallback Adapters)"**, chapter file `group-26-device-capability-layer.md`
>   (**87** types, 87 `###` sections). Per-capability interface contracts in `MMCA.Common.UI/Services/Capabilities/`
>   (biometric, geocoding/geolocation, speech, push registration, media/clipboard/screenshot, haptics, share,
>   external auth/links, local cache/notifications, connectivity/battery/accessibility, deep links) plus their
>   **MAUI-native** (`MMCA.Common.UI.Maui/Capabilities/`), **browser-JS-interop** (`.../Capabilities/Browser/`),
>   and **inert-fallback** (`.../Capabilities/Fallbacks/`) implementations, selected per host at DI composition
>   time (ADR-042/043/044/045). Why no existing group fit: G15 (the natural `MMCA.Common.UI.*` catch-all) is
>   generic MudBlazor building blocks/theme/base-pages, whereas this is a distinct one-contract-plus-three-adapters
>   concern spanning three assemblies (`MMCA.Common.UI`, `MMCA.Common.UI.Web`, `MMCA.Common.UI.Maui`) unified by
>   the platform-adapter pattern, not by MudBlazor. The classifier rules that carve G27 out ahead of the G15
>   catch-all (`Tools/invtool/classify.ps1`, the `MMCA.Common.UI.Services.Capabilities`/`MMCA.Common.UI.Maui`
>   prefix rules + the `IFormFactor`/`WasmFormFactor`/`WebFormFactor` O-overrides) were already present on disk;
>   this pass authored the chapter and reconciled the front matter to match. Approved with **mid-list placement
>   directly after ADC Host Composition** (chapter slot 26, ID G27 append-only); renumber fallout: the testing
>   chapter shifts to slot 27 (`group-27-testing-infrastructure.md`, its file name unchanged from the prior
>   append-only-ID artifact, so no part renames or link rewrites were needed).
> - **ADR-045 managed file storage / avatars (G07 +13, 70 -> 83).** `IFileStorageService`
>   (`MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11`), `AzureBlobFileStorageService`
>   / `NullFileStorageService` (`MMCA.Common.Infrastructure/Services/`), `IImageProcessor` /
>   `ImageSharpImageProcessor` (decode, auto-orient, exact-square crop, strip metadata, re-encode JPEG),
>   `ImageContentSniffer` (moved in from ADC's `SetUserAvatar` slice), `FileStorageSettings`, plus ADR-044's
>   `INativePushSender` / `IPushDeviceRegistrar` + Azure/Null impls landing in the same infrastructure group.
> - **ADR-044 native push (G10 +8, 45 -> 53), shipped inert.** `AzureNotificationHubNativePushSender`
>   (`MMCA.Common.Infrastructure/Services/AzureNotificationHubNativePushSender.cs:14`), `DeviceInstallationRequest`
>   (`MMCA.Common.Shared/Notifications/PushNotifications/DeviceInstallationRequest.cs:12`), the OS-level FCM/APNs
>   third leg + `DevicesController` control plane. Honest security note captured while spot-checking: the class
>   XML-doc claims ownership "is stamped server-side" without qualification, but only `PUT`/`UpsertAsync` stamps
>   the caller's `UserId`; `DeleteAsync` (`DevicesController.cs:50-56`) is scoped only by the client-generated
>   (non-enumerable) `installationId` with no ownership check. The G10 overview now describes the code's actual
>   behavior, not the comment's overclaim (code wins, per the guide's ground rule).
> - **Other per-group adds:** G08 +2 (external-auth-broker contract `IExternalAuthBroker` /
>   `UnavailableExternalAuthBroker`, ADR-042/043); G12 +2 (ADR-043 app-association/deep-link endpoints
>   `AppAssociationEndpointExtensions` / `AppAssociationOptions`, hoisted from ADC, plus the ADR-046 versioning
>   and ADR-047 soft-deleted-user-revocation surfaces cross-referenced); G14 +2, G15 +1 net (most new UI
>   capability surface was diverted to the G27 prefix rule ahead of the G15 catch-all, so net movement understates
>   churn); G17 +2, G18 +7 (`Sessions/UseCases/ExportCalendar` .ics slice, ADR-042), G20 +1 (`NowNextDTO` public
>   snapshot), G21 +9 (calendar/QR export UI, OfflineBanner, PresenterLayout onto Common theme providers), G22
>   +11 (`UserEngagementExportService` cross-service gRPC export slice), G26 +3, G23/Identity +12 (ADR-045 user
>   avatar end to end: `SetUserAvatar`/`GetUserAvatar`/`RemoveUserAvatar` use-case family), G24/Host +4
>   (device-capability DI wiring, `AppLockKeyMigration` one-time preference migrator), G25/Testing +46 (new
>   reusable `RouteAuthorizationTestsBase` + OpenAPI/ProblemDetails/ServiceInfo-versioning contract bases + the
>   shared `HttpTestDoubles` UI harness consolidated from 3 ADC copies, plus per-project growth across every
>   touched module).
> - **ADRs 042-048 are now cross-referenced** where their patterns are taught: **042** (device-capability) in
>   the new G27 chapter + G08/G24; **043** (mobile deep links / app association / native OAuth callback) in
>   G12/G27; **044** (native push) in G07/G10; **045** (managed file storage + avatars) in G07/G23; **046**
>   (HTTP API versioning) in G12/G20/G25; **047** (soft-deleted-user session revocation) in G12; **048**
>   (primitive identifier type aliases) in G02/G14 where the alias convention is taught.
> - **Corrections made while re-verifying** (adversarial spot-checks on the authored overviews): the G08 auth
>   overview's 7 `MMCA.Common.API` citations were pointing at `Source/Core/` instead of the real
>   `Source/Presentation/MMCA.Common.API` layer (corrected; the section parts had it right), and its
>   `TokenService` algorithm re-check citation was split to `:130` (the `ValidAlgorithms` pin passed into
>   `ValidateToken`) + `:139-140` (the post-return header re-check); the G10 DevicesController DELETE
>   overclaim above; a G10 `[ApiVersion]` citation range widened `:29-30` -> `:28-30`.
> - Cycles **16** (unchanged this pass, re-verified via invtool). Edge resolution: **8,596** namespace-visible
>   (~97%), **237** globally-unique fallback, **26** dropped ambiguous. **ADR-041 (observability)** remains not
>   cross-referenced in the guide; its natural home is the devops-aspire chapter, outside this pass's scope
>   (still flagged, as at v1.111.0).

> **Regeneration note (re-verified against current source, v1.121.0 full drift sweep).** Regenerated at
> **framework v1.121.0** (MMCA.Common `658786b`, clean, prior-documented `09cf78e`; MMCA.ADC `cf69cb8e`,
> clean, prior-documented `2632af6c`; `FACTS.md` is the source of truth for the version / **15-package** /
> **50-ADR (001-050)** figures). Net change since the v1.116.0 pass: **+90** distinct nodes (2,497 ->
> **2,587**), individually-sectioned 1,465 -> **1,495**, rolled-up 1,032 -> **1,092**, `###` sections
> 1,397 -> **1,421** across the (unchanged) **27** chapters (`verify.ps1`: 0 missing; rubric 34/34). The
> change is **+26 production types added, 1 removed, 8 types moved G24 -> G21, 0 confident type-level
> regroups**, plus a **+64 net test-only rollup**. No new functional group was needed (`classify.ps1`:
> **0 unmapped**).
> - **G02 +1 (27 -> 28):** `IRowVersioned` (`MMCA.Common.Domain/Interfaces/IRowVersioned.cs:11`), the
>   opt-in optimistic-concurrency marker consumed by `EFRepository` and the audit interceptor (ADR-035
>   cited from the source doc comment; the ADR text itself was not opened this pass).
> - **G03 +1 (25 -> 26):** `FilterValueParser`
>   (`MMCA.Common.Application/Services/Filtering/FilterValueParser.cs:8`), which ships the IN-operator
>   dynamic-filter feature by parsing comma-delimited value lists (int/Guid lists skip unparseable
>   entries; the string-list path only splits + trims).
> - **G07 +2 (83 -> 85):** `SoftDeleteUniqueIndexConvention`
>   (`.../Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:24`) and `DeferredDispatch`
>   (`.../Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:275`), the latter a new **6th
>   member** of the L6 persistence cycle (see section 3).
> - **G18 +9 (202 -> 211):** the batch `GetSessionBookmarkCountsQuery`/`Handler` bookmark-count perf slice
>   (`Speakers/UseCases/GetSessionBookmarkCounts/`, commit `fa420f65`), the six per-field
>   `Session*Rules<T>` validation-rule family (`Sessions/Validation/SessionValidationRules.cs:37-99`:
>   Description/Status/LiveUrl/RecordingUrl/AccessibilityInfo/ResourceLinks) and `SessionRoomScheduling`
>   (`Sessions/Validation/SessionRoomScheduling.cs:14`).
> - **G21 +10 (79 -> 89):** the **8 ADC Home-page view-model types moved in from G24** (see moves below)
>   plus `ScorePollSignal` / `ScorePollTracker`
>   (`Pages/SessionSelection/ScorePollTracker.cs:6,31`, commit `adee5058`), the AI-scoring poll recovery
>   state machine.
> - **G22 +5 (67 -> 72):** the durable ADR-039 live-channel publish queue, `LiveChannelPublishWorkItem` /
>   `ILiveChannelPublishQueue` / `LiveChannelPublishQueue` (`Engagement.Application/Live/`) +
>   `LiveChannelPublishProcessor` (`Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:21`,
>   commit `bf99b92a`).
> - **G23/Identity +4 (78 -> 82):** the external-login lifetime fix `IExternalLoginEmailVerifier`
>   (`Identity.Application/Users/IExternalLoginEmailVerifier.cs:11`) + `HttpContextExternalLoginEmailVerifier`
>   (`Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:17`, commit `cf69cb8e`) and
>   `ListPageActions` (`Identity.UI/Common/ListPageActions.cs:13`).
> - **G10/G20/G22/G23 shared add:** a same-shaped `KestrelConfiguration` was added once per extractable
>   ADC service host (Notification/Conference/Engagement/Identity, 4 total), sectioned in the module's
>   chapter (counted in each group's delta above; G10 53 -> 54, G20 40 -> 41).
> - **Moved (de-duplication, commit `adee5058`): 8 ADC Home-page types G24 -> G21.** `ADCHome`,
>   `ADCEventInfo`, `ConferenceTrackInfo`, `EventPhase`, `KeynoteSpeakerInfo`, `SponsorInfo`,
>   `SponsorTierInfo`, `ADCCollectionResult` were duplicated across both host shells
>   (`MMCA.ADC.UI/Pages/ADCHome.razor.cs` + `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs`, 16 nodes) and
>   were consolidated into one shared component `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs` (8
>   nodes). Net: **G24/Host 34 -> 18** (-16), G21 +8 of its +10. Their prose sections moved to the
>   Conference UI chapter and are cross-linked from G24.
> - **Removed (1): `AnonymousAuthenticationStateProvider`** (Gallery stub), superseded by
>   `GalleryAuthenticationStateProvider` + `GalleryFakeAuthenticationHandler`
>   (`MMCA.Common.UI.Gallery/Stubs/`, a different shape, tracked as remove + add).
> - **G25/Testing +64 net (1,170 -> 1,242, mostly rolled up):** 6 newly individually-sectioned reusable
>   bases (`DecoratorPipelineOrderTestsBase<...>`, `HandlerTestBase<THandler>`,
>   `HandlerResultConventionTestsBase`, `RawQueryableConventionTestsBase`, the two Gallery stubs above) plus
>   per-project [Fact] growth (Common.Application.Tests 147 -> 160, Common.Infrastructure.Tests 157 -> 171,
>   ADC.Identity.IntegrationTests 28 -> 33, ADC.Architecture.Tests 26 -> 30, ADC.Engagement.UI.Tests 14 ->
>   19, and new `MMCA.ADC.Notification.API.Tests` / `.Application.Tests` / `ServiceBusEmulator.IntegrationTests`
>   projects; ADC.Conference.Application.Tests 139 -> 133 net decrease via consolidation).
> - Cycles **16** (unchanged this pass, re-verified via invtool), but the **L6 persistence cycle grew from
>   5 to 6 members** with `DeferredDispatch` added (section 3). Edge resolution: **8,868** namespace-visible
>   (~96%), **331** globally-unique fallback, **27** dropped ambiguous. **ADR-041 (observability)** remains
>   not cross-referenced in the guide (still flagged; its home is the devops-aspire chapter, outside scope).
> - **Authoring-methodology note (honest process record).** Adding 90 nodes shifted `plan.ps1`'s write-unit
>   packing boundaries mid-chapter across G10/G18/G25(Testing), so several pre-existing types were pushed
>   into a different part than the drift delta first flagged. A verification pass (duplicate-heading scan +
>   per-part membership diff, beyond `verify.ps1`'s presence-only check) caught 17 fall-through types and 17
>   transient duplicate sections in the testing chapter; a second targeted author wave over the shifted
>   parts (G10 p02-p04, G18 p07-p15, G25 p01/p04/p05/p07) restored parts-to-units 1:1 (final: 0 missing, 0
>   new duplicates). One part (`group-18 p15`) was authored to a stray path and relocated. The node totals
>   and classifier output are exact; the per-type attributions are commit-anchored where a commit is cited.

---

## 2. Exceptions log (every deliberate omission, with reason)

### 2.1 Generated / scaffolded code, not sectioned (68 files)
EF Core migrations (`/Migrations/`, `.Migrations.SqlServer`), `ModelSnapshot`, `*.Designer.cs`,
`*.g.cs`, `GlobalUsings.g.cs`, and `AssemblyInfo.cs` are excluded by rule (`Tools/invtool` `IsGenerated`).
The **mechanisms** that produce them are taught instead: the `DbContext`, the migration workflow, and
the `.proto`/gRPC contracts (see [group-07](group-07-persistence-ef-core.md),
[group-13](group-13-grpc-contracts.md), and [devops-testing](devops-testing.md)). The full file list is
in [`00-inventory.md`](00-inventory.md#generated--excluded-artifacts-no-type-sections-written).

### 2.2 Per-`[Fact]` test classes, rolled up by project (1,032 types)
Per the guide's TESTS note, individual test classes are **not** given per-type sections. The
[Testing chapter (group-27)](group-27-testing-infrastructure.md) instead:
- sections the **reusable** test infrastructure in full (the **138** types in `MMCA.Common.Testing`,
  `.Testing.E2E`, `.Testing.UI`, the shared **`.Testing.Architecture`** rule library + bases, now
  including the six convention/fitness bases added since v1.93.0, the web-vitals collector, the
  localization resx-parity base, the slice-cohesion base, the markup-snapshot helper, the new
  contract/route-authorization bases (`RouteAuthorizationTestsBase`, the OpenAPI/ProblemDetails/
  ServiceInfo-versioning contract bases) and the shared `HttpTestDoubles` UI harness added since
  v1.111.0, and the per-repo architecture-fitness test classes plus the `Gallery` harness), and
- rolls the remaining **1,032** per-suite test classes (including the `MMCA.Common.Benchmarks`
  perf-smoke project) into a **per-project table** (purpose + style:
  unit / integration / fitness / E2E / component / performance-smoke).
Every one of the 1,032 remains individually listed with `file:line` in
[`00-inventory.md`](00-inventory.md). This is the only category of first-party type not given its own
prose section.

### 2.3 Sibling-family grouping (sibling families fold into shared sections)
Near-identical families (per-entity `Add*/Remove*/Update*` commands, `*DTOMapper`, `*CreateRequest`,
`*Validator`, per-type filter strategies, etc.) are taught in one `### A, B, C` section that explains
the shared shape once. **Every** grouped type is still named and cited individually via the section's
`File:Line` table, so citation coverage is complete (this is what `verify.ps1` checks). The 1,495
individually-sectioned types are covered by 1,421 `###` sections; the 74-type difference is family grouping.

---

## 3. Grouping & ordering verification

- **Every type in exactly one group.** `classify.ps1` assigns all 2,587 nodes via name-level overrides
  (for the grab-bag `MMCA.Common.*Interfaces*/Services` namespaces) + ordered namespace-prefix rules;
  it reports **0 unmapped** and the per-group counts sum to 2,587. See
  [`00-group-taxonomy.md`](00-group-taxonomy.md).
- **Within-group ascending Level.** Each chapter's sections were authored from a pre-sorted, Level-
  ascending unit table, so no section precedes a same-group type it depends on (ties broken by name).
- **Cycles kept whole.** All **16** dependency cycles (SCCs) sit inside a single group, never split
  (re-verified for the three cycles new in this pass: the `NotificationHubService`/`ChannelSubscription`
  pair is wholly in [group-15](group-15-common-ui-framework.md), and the two new test SCCs around
  `CosmosConfigurationPortabilityTests`/`DatabaseInitializationExtensionsTests`/`FixedAssemblyProvider`/
  `MultiSourceSqliteIntegrationTests` are wholly in [group-26](group-27-testing-infrastructure.md)):
  the `ApplicationDbContext ↔ AuditSaveChangesInterceptor ↔ DomainEventSaveChangesInterceptor ↔
  DataSourceModelCacheKeyFactory ↔ OutboxFinalizer ↔ DeferredDispatch` cycle (now 6 members, the
  `DeferredDispatch` record added this pass so the domain-event interceptor can defer a dispatch across
  the SaveChanges boundary) is wholly in [group-07](group-07-persistence-ef-core.md); the
  Event/Session/Speaker/Category aggregate nav-cycles are wholly in
  [group-17](group-17-conference-domain.md); the `Address`/`Currency` value-object + converter pairs in
  [group-02](group-02-domain-building-blocks.md) (plus polyglot-fitness and the new localization/markup
  test cycles in [group-26](group-27-testing-infrastructure.md)). Full list:
  [manifest](00-dependency-manifest.md#cycles-scc-size--1-16).
- **Cross-group forward references are allowed and cross-linked.** Because group order is functional
  (not a strict global topological sort), some sections reference a first-party type whose home group
  comes later. These are correct **by construction**: every cross-link target is resolved through
  `_typemap.tsv` (type → group file + anchor), so a link can only point at the type's actual home.
  Representative forward references (lower group → later group), each cross-linked in the text:
  - `ErrorType`/`Result` (group-01) → `ApiControllerBase`/`ErrorHttpMapping` (group-12) and
    `ResultGrpcExtensions` (group-13) for the HTTP/gRPC mapping.
  - `EntityQueryService` (group-03) → the repository contracts and `EFRepository` (group-07).
  - `INavigationPopulator` (group-11) → its concrete ADC populators (groups 18/22/23).
  - The Common base classes (groups 01–16) → their ADC consumers (groups 17–24) throughout.
  *Scope note:* this list is representative, not exhaustive; an exhaustive enumeration is unnecessary
  because the typemap guarantees every link resolves to the correct home group.

---

## 4. Rubric coverage matrix
<a id="rubric-coverage-matrix"></a>

Every one of the 34 categories is explained at least once against real code. "First explained in" is
the earliest group chapter (by order) that tags it; many recur and several are also developed in the
DevOps/test chapters (noted).

| § | Category | First explained in |
|---|----------|--------------------|
| §1 | SOLID Principles | [group-02](group-02-domain-building-blocks.md) |
| §2 | Design Patterns | [group-01](group-01-result-error-handling.md) |
| §3 | Clean Architecture | [group-01](group-01-result-error-handling.md) |
| §4 | Domain-Driven Design | [group-01](group-01-result-error-handling.md) |
| §5 | Vertical Slice Architecture | [group-02](group-02-domain-building-blocks.md) (developed in groups 17–23) |
| §6 | CQRS & Event-Driven | [group-02](group-02-domain-building-blocks.md) (developed in groups 04–05) |
| §7 | Microservices Readiness | [group-04](group-04-events-outbox.md) (developed in groups 13–14, [devops-iac](devops-iac.md)) |
| §8 | Data Architecture | [group-02](group-02-domain-building-blocks.md) (developed in group-07) |
| §9 | API & Contract Design | [group-01](group-01-result-error-handling.md) (developed in groups 12–13) |
| §10 | Cross-Cutting Concerns | [group-02](group-02-domain-building-blocks.md) (developed in group-05) |
| §11 | Security | [group-02](group-02-domain-building-blocks.md) (developed in group-08) |
| §12 | Performance & Scalability | [group-01](group-01-result-error-handling.md) |
| §13 | Observability & Operability | [group-02](group-02-domain-building-blocks.md) (developed in [devops-aspire](devops-aspire.md)) |
| §14 | Testability & Test Strategy | [group-03](group-03-querying-specifications.md) (developed in group-26, [devops-testing](devops-testing.md)) |
| §15 | Best Practices & Code Quality | [group-02](group-02-domain-building-blocks.md) (also [primer §4](00-primer.md#4-c-build-and-code-style-conventions)) |
| §16 | Maintainability & Evolvability | [group-02](group-02-domain-building-blocks.md) |
| §17 | DevOps & Deployment | [group-07](group-07-persistence-ef-core.md) (developed in [devops-cicd](devops-cicd.md)/[iac](devops-iac.md)) |
| §18 | UI Architecture & Component Design | [group-08](group-08-auth.md) (developed in groups 15, 21) |
| §19 | State Management & Data Flow | [group-08](group-08-auth.md) (developed in group-15) |
| §20 | Design System, Theming & Consistency | [group-15](group-15-common-ui-framework.md) (incl. day/dark `ThemeService`, ADR-028) |
| §21 | Accessibility (a11y) | [group-15](group-15-common-ui-framework.md) (developed in group-26/[devops-testing](devops-testing.md)) |
| §22 | Responsive & Cross-Browser/Device | [group-15](group-15-common-ui-framework.md) |
| §23 | Front-End Performance & Rendering | [group-15](group-15-common-ui-framework.md) |
| §24 | Forms, Validation & UX Safety | [group-05](group-05-cqrs-pipeline.md) (developed in groups 06, 15, 21) |
| §25 | Navigation, Routing & Information Architecture | [group-15](group-15-common-ui-framework.md) |
| §26 | Front-End Security | [group-08](group-08-auth.md) |
| §27 | Internationalization & Localization | [group-02](group-02-domain-building-blocks.md) (now multi-locale en-US + es per ADR-027, developed in groups 12/15/20/22/23; note in [primer §6](00-primer.md#6-the-34-category-architecture-evaluation-lens)) |
| §28 | Front-End Testing & Quality | [group-15](group-15-common-ui-framework.md) (developed in group-26) |
| §29 | Resilience, Reliability & Business Continuity | [group-04](group-04-events-outbox.md) (developed in [devops-runbooks](devops-runbooks.md)) |
| §30 | Compliance, Privacy & Data Governance | [group-02](group-02-domain-building-blocks.md) (developed in group-24) |
| §31 | Cost Efficiency / FinOps | [group-04](group-04-events-outbox.md) (developed in [devops-cicd](devops-cicd.md)) |
| §32 | Dependency & Supply-Chain | [group-18](group-18-conference-application.md) (also [primer §4](00-primer.md#4-c-build-and-code-style-conventions)) |
| §33 | Developer Experience & Inner Loop | [group-06](group-06-validation.md) (developed in [devops-aspire](devops-aspire.md)) |
| §34 | Architecture Governance & Documentation | [group-02](group-02-domain-building-blocks.md) (also [primer §4](00-primer.md#architecture-enforcement-is-doubled-fitness-functions-rubric-34-3)) |

**Result: 34 / 34 categories explained.** (`verify.ps1` confirms all 34 `§N` tokens appear across the
chapters. It also reports a 35th distinct `§N` token, `§1798`, which is the legal citation
"CCPA §1798.100" in [group-24](group-24-identity-module.md), not a rubric category; ignore it.)

---

## 5. Open questions / not determinable from source

1. **`IDbSeeder` host invocation** ([group-07](group-07-persistence-ef-core.md)). The seeding
   *contract* and implementations are in `MMCA.Common`, but the `IHostedService`/startup invoker that
   actually runs seeding at boot lives in **consuming-app host code**, not in `MMCA.Common` source, so
   its exact wiring is noted as out-of-scope-for-source rather than asserted.
2. **Engine seams (Cosmos / SQLite) are supported, with a staged first adoption (ADR-018).** All
   *current* production entity configs use the `…SQLServer` base, so in deployed ADC the polyglot paths
   are not yet live. But the polyglot-persistence framework work (ADR-018) added the unified engine-aware
   [`EntityTypeConfiguration<T,TId>`](group-07-persistence-ef-core.md#entitytypeconfigurationtentity-tidentifiertype)
   base, the cross-source [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification),
   the Cosmos-index skip in the degrade convention, SQLite `EnsureCreated`, and a fitness rule + new test
   suites (Cosmos config portability, cross-source spec, SQLite init), and ADC Conference's
   `Session`→Cosmos / `Room`→SQLite move is the staged-but-not-yet-deployed first use. The guide documents
   these as real, exercised capabilities with honest adoption notes (see
   [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) and group-07), not yet as
   live production options.
3. **Edge-resolution approximation.** The dependency graph is a *syntactic* (namespace-aware) resolve,
   not a full semantic compiler bind: ~97% of edges bind by namespace visibility, the rest by a
   globally-unique-name fallback (237 edges), and 26 references are dropped as ambiguous. This is accurate enough
   for the leveling spine but is a documented approximation
   ([manifest accuracy note](00-dependency-manifest.md#edge-resolution--accuracy)).

---

## 6. How to regenerate this audit

```
# from C:\Projects\MMCA\Tools\invtool
dotnet run -- out  ../../MMCA.Common/Source ../../MMCA.Common/Tests ../../MMCA.ADC/Source ../../MMCA.ADC/Tests
pwsh -File classify.ps1   # -> 00-group-taxonomy.md + _groups.tsv (0 unmapped check)
pwsh -File plan.ps1       # -> _typemap.tsv + _units/* + _workplan.json
pwsh -File concat.ps1     # parts/* -> group-NN-*.md
pwsh -File fixanchors.ps1 # inject <a id> aliases for sibling-family members (from _typemap.tsv)
pwsh -File fixanchors2.ps1 # conservative cross-link repair (unique-heading-token match)
pwsh -File verify.ps1     # 0-missing coverage check + rubric 34/34 check
```
Then copy the refreshed `out/00-inventory.md` and `out/00-dependency-manifest.md` into
`Docs/Onboarding/` (the `00-group-taxonomy.md` is written there directly by `classify.ps1`).