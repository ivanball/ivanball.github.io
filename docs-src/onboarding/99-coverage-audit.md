# Phase 4, Coverage Audit

This audit reconciles the written guide against the mechanically-extracted inventory, logs every
deliberate exception, verifies the grouping/ordering rules, proves all 34 rubric categories are
explained, and lists what could not be determined from source. All counts are reproducible from
`Tools/invtool/` (`classify.ps1`, `plan.ps1`, `verify.ps1`).

---

## 1. Coverage reconciliation

| Quantity | Count | Source |
|----------|------:|--------|
| `.cs` files scanned | 2,699 | `00-inventory.md` |
|, in-scope | 2,581 | |
|, generated/excluded | 118 | logged exception §2.1 |
| Type declaration rows (incl. partial-class fragments) | 3,377 | `00-inventory.md` |
| **Distinct type nodes (partials collapsed)** | **3,264** | the master checklist |
| → mapped to a functional group | 3,264 | `classify.ps1` (0 unmapped) |
| → individually sectioned (named in a chapter) | 1,804 | `verify.ps1` |
| → rolled up by project (G25 test classes) | 1,460 | logged exception §2.2 |
| Distinct `###` sections written across 27 chapters | 1,740 | covering the 1,804 (sibling families share a section, §2.3) |
| Chapter overviews written | 27 | one per group |

**Cross-check result:** `verify.ps1` confirms **0** of the 1,804 individually-sectioned types are
missing from their group chapter, every one appears as a `###` heading or in a sibling-family
`File:Line` table. 3,264 = 1,804 individually-sectioned + 1,460 rolled-up. Nothing dropped, nothing
double-counted (each type maps to exactly one group).

> **Caveat on what `verify.ps1` proves.** Its check is name presence: a type counts as covered when
> its name appears as a `###` heading, in a sibling-family `File:Line` cell, **or anywhere in the
> chapter text**. A type that is only named in passing therefore passes. A stricter check (heading or
> table cell only) run at the v1.135.0 pass reported **64** types that are cross-linked from other
> sections but have no section of their own, so those anchors resolve nowhere. They are listed in §5
> as an open item, not a silent omission (not re-measured at the v1.142.0 pass).

> **Regeneration note (re-verified against current source, polyglot-persistence update).** This audit
> was regenerated after the **polyglot-persistence framework enhancement** (MMCA.Common commit
> `74c0372`, [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) and the matching ADC change. The net change since the previous pass (**+25**
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
> clock. [ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html) (layered rate limiting) was added to the ADR set (001–019) and is cross-referenced where
> rate limiting is taught (G08/G12).

> **Regeneration note (re-verified against current source, v1.83.0 full drift sweep).** This audit was
> regenerated again at **framework v1.83.0** (MMCA.Common `b9a6a28`; MMCA.ADC `17dce5a`; FACTS.md is the
> source of truth for the version / 13-package / 23-ADR figures). The net change since the permission pass
> (**+2** distinct nodes: 1,867 to 1,869) is entirely in **G25 (+2):** `FixedTimeProvider` (the injected-`TimeProvider`
> test clock in `MarkAllNotificationsReadHandlerTests.cs:65`) and `RateLimitPartitionTests`
> (`MMCA.Common.API.Tests/Startup/RateLimitPartitionTests.cs:16`, [ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html)). Both are per-project test types
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
>   the sections existed but did not yet cite the ADRs: **[ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)** (permission authorization) in G08 (the
>   permission-policy sections + the `IPermissionRegistry`/`PermissionRegistry`/`PermissionRegistryBuilder`
>   registry), **[ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)** (consumer inbox idempotency) in G04 (the `IInboxStore`/`EfInboxStore`/`InboxMessage`
>   sections), **[ADR-022](https://ivanball.github.io/docs/adr/022-browser-session-cookie-auth.html)** (browser session-cookie auth) in G08 (the session-cookie subsystem), and **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)**
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
> - **i18n / multi-locale ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), supersedes [ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html)).** Server-side edge error localization keyed by
>   `Error.Code`: **G12 (+5)** `ErrorLocalizer` / `IErrorLocalizer` / `ErrorResourceSource`
>   (`MMCA.Common.API/Localization/`), `ErrorResources` (`MMCA.Common.API/Resources/ErrorResources.cs:9`),
>   and `SupportedCultures` (`MMCA.Common.Shared/Globalization/SupportedCultures.cs:9`, re-homed from the
>   `Shared`-to-G08 catch-all into G12 beside the edge localizer via a new classifier rule). Per-module
>   localized error resources: **G20 (+1)** `ConferenceErrorResources`, **G22 (+1)** `EngagementErrorResources`,
>   **G23 (+1)** `IdentityErrorResources`. Culture bootstrap + forwarding in **G15**: `MmcaCultureBootstrap`,
>   `CultureDelegatingHandler`, `SharedResource`, the `IUserPreferenceReader/Writer` + `ApiUserPreferenceReader/Writer`
>   pair, `UserPreferences` / `UserPreferencesRequest` (`MMCA.Common.UI/`).
> - **Day/Dark theme ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)).** **G15** `ThemeService` (`MMCA.Common.UI/Services/ThemeService.cs:16`) plus the
>   per-user preference plumbing above; **G23 (+6)** `ChangePreferences{Command,Handler,Request}` /
>   `GetUserPreferences{Query,Handler}` / `UserPreferencesResponse` persist `PreferredCulture` / `PreferredTheme`.
>   *Honest adoption note:* the `AddUserPreferences` EF migration is **not yet applied to the production ADC /
>   Store Identity databases**, so the Profile preferences endpoint errors in prod until it is (stated in G23).
> - **PII redaction (§30 / [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).** **G02 (+2)** `PiiRedactor` + its private nested `RedactableProperty`
>   (`MMCA.Common.Domain/Privacy/PiiRedactor.cs:24,123`, commit `b2b0aae`) mask `[Pii]`-marked members for
>   log/telemetry-safe output; a new classifier rule routes `MMCA.Common.Domain.Privacy.*` to G02 beside the
>   existing `PiiAttribute` / `IAnonymizable`.
> - **G25 (+12 net, 874 total).** New reusable/fitness infra sectioned in full: `LocalizationResourceTestsBase`
>   + `TranslationCompletenessTests` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) resx parity), `PiiErasureContractFitnessTests` + `DataSubjectSample`
>   (§30/[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)), `SliceCohesionTests`/`SliceCohesionTestsBase` (§5 VSA), `MarkupSnapshot`/`MarkupSnapshotResult`
>   (§28), `ConstructorDependencyCountTests` / `FormsConventionTests` / `FrameworkVersionConsistencyTests`. New
>   **`MMCA.Common.Benchmarks`** project (4 BenchmarkDotNet types: `SpecificationBenchmarks` / `SampleItem` /
>   `MinValueSpec` / `ActiveSpec`, §12 perf smoke) added to the per-project rollup. The 9 removed are G25 renames
>   (`OrganizerSpeaker*Tests` / `SpeakerProfileTests` / `AttendeeBookmarkEdgeCaseTests` → `CrossService*`;
>   `IntegrationTestBase` / `*Fixture` / `*Collection` / `TestWebApplicationFactory` consolidated).
> - **ADRs 024-034 are now cross-referenced** where their patterns are taught even when they added no type
>   (their code predated the baseline): **[ADR-024](https://ivanball.github.io/docs/adr/024-push-notifications.html)** (two-channel notifications) in G10, **[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)** (startup
>   warm-up/readiness) in G16, **[ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html)** (two-tier caching) in G09, **[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)** (brute-force protection) /
>   **[ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)** (password hashing) / **[ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)** (resource-ownership, `OwnerOrAdminFilter`/`OwnershipHelper`,
>   Store-adopted) in G08, **[ADR-030](https://ivanball.github.io/docs/adr/030-startup-sole-migrator.html)** (startup sole-migrator) in G07/G12, **[ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)** (feature-flag management)
>   and **[ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)** (generic entity controllers + dynamic query contract) in G12/G03. The primer's ADR table was
>   extended 019 → 034 and its §27 note rewritten ([ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html) → [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)), with a new §20 day/dark-theme note ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)).
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
> - **Shared authentication workflow ([ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html), Wave 3, MMCA.Common commit `69dfd53`).** **G08 (+4, 54 total):**
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
>   [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) pseudo-localization gate: `PseudoLocalizer` / `PseudoStringLocalizer` / `PseudoStringLocalizerFactory` /
>   `ResxMudLocalizer` (`MMCA.Common.UI/Globalization/`) and `MudTranslations`. **G16 (+1, 15 total):**
>   `GatewayCorsExtensions`. Donor chapters shrank accordingly: G20 38 → 36, G21 71 → 70, G23 68 → 66, G24 35 → 30.
> - **G22 (-1, 56 total):** `OwnBookmarkSpecification` deleted as dead code (zero call sites at prior HEAD
>   `89d8439`; its ownership-scoping role had already been superseded by the shared `OwnerOrAdminFilter`, [ADR-033](https://ivanball.github.io/docs/adr/033-resource-ownership-authorization.html)).
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
>   is a synchronous, SignalR-hub-channel-driven ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)), cross-service (gRPC) audience-interaction
>   capability with its own aggregates (`LivePoll`/`LivePollOption`/`LivePollVote`,
>   `SessionQuestion`/`SessionQuestionUpvote`), 7 CQRS use-case folders, 2 controllers, and the
>   HappeningNow / SessionLive / PresenterView UI. Approved with **mid-list placement directly after G22**
>   (IDs are append-only, so the new group ID is G26 while the chapter takes file slot 23); renumber fallout:
>   identity-module 23 -> 24, adc-host-composition 24 -> 25, testing-infrastructure 25 -> 26 (17 part files
>   renamed content-unchanged, 3 stale assembled chapters deleted, 110 link occurrences fixed across 30 files).
> - **Three approved regroups** (catch-all fallback landings, classifier O-override/prefix fixes dated
>   2026-07-10 in `Tools/invtool/classify.ps1`): the [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) hub-channel trio `ILiveChannelPublisher` /
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
>   G12 +2 [ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html) authenticated output caching (`OutputCacheOptionsExtensions.cs:6`,
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
> - **ADR cross-references:** [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) (hub channels) is now cited in G10/G15 and throughout the new
>   live-layer chapter; [ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html) (authenticated output caching) in G12/G20. **[ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html) (observability) is not
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
> package being `MMCA.Common.UI.Maui`, the one MAUI-TFM package, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Net change since the v1.111.0 pass:
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
>   time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)/043/044/045). Why no existing group fit: G15 (the natural `MMCA.Common.UI.*` catch-all) is
>   generic MudBlazor building blocks/theme/base-pages, whereas this is a distinct one-contract-plus-three-adapters
>   concern spanning three assemblies (`MMCA.Common.UI`, `MMCA.Common.UI.Web`, `MMCA.Common.UI.Maui`) unified by
>   the platform-adapter pattern, not by MudBlazor. The classifier rules that carve G27 out ahead of the G15
>   catch-all (`Tools/invtool/classify.ps1`, the `MMCA.Common.UI.Services.Capabilities`/`MMCA.Common.UI.Maui`
>   prefix rules + the `IFormFactor`/`WasmFormFactor`/`WebFormFactor` O-overrides) were already present on disk;
>   this pass authored the chapter and reconciled the front matter to match. Approved with **mid-list placement
>   directly after ADC Host Composition** (chapter slot 26, ID G27 append-only); renumber fallout: the testing
>   chapter shifts to slot 27 (`group-27-testing-infrastructure.md`, its file name unchanged from the prior
>   append-only-ID artifact, so no part renames or link rewrites were needed).
> - **[ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) managed file storage / avatars (G07 +13, 70 -> 83).** `IFileStorageService`
>   (`MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11`), `AzureBlobFileStorageService`
>   / `NullFileStorageService` (`MMCA.Common.Infrastructure/Services/`), `IImageProcessor` /
>   `ImageSharpImageProcessor` (decode, auto-orient, exact-square crop, strip metadata, re-encode JPEG),
>   `ImageContentSniffer` (moved in from ADC's `SetUserAvatar` slice), `FileStorageSettings`, plus [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)'s
>   `INativePushSender` / `IPushDeviceRegistrar` + Azure/Null impls landing in the same infrastructure group.
> - **[ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) native push (G10 +8, 45 -> 53), shipped inert.** `AzureNotificationHubNativePushSender`
>   (`MMCA.Common.Infrastructure/Services/AzureNotificationHubNativePushSender.cs:14`), `DeviceInstallationRequest`
>   (`MMCA.Common.Shared/Notifications/PushNotifications/DeviceInstallationRequest.cs:12`), the OS-level FCM/APNs
>   third leg + `DevicesController` control plane. Honest security note captured while spot-checking: the class
>   XML-doc claims ownership "is stamped server-side" without qualification, but only `PUT`/`UpsertAsync` stamps
>   the caller's `UserId`; `DeleteAsync` (`DevicesController.cs:50-56`) is scoped only by the client-generated
>   (non-enumerable) `installationId` with no ownership check. The G10 overview now describes the code's actual
>   behavior, not the comment's overclaim (code wins, per the guide's ground rule).
> - **Other per-group adds:** G08 +2 (external-auth-broker contract `IExternalAuthBroker` /
>   `UnavailableExternalAuthBroker`, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)/043); G12 +2 ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html) app-association/deep-link endpoints
>   `AppAssociationEndpointExtensions` / `AppAssociationOptions`, hoisted from ADC, plus the [ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html) versioning
>   and [ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html) soft-deleted-user-revocation surfaces cross-referenced); G14 +2, G15 +1 net (most new UI
>   capability surface was diverted to the G27 prefix rule ahead of the G15 catch-all, so net movement understates
>   churn); G17 +2, G18 +7 (`Sessions/UseCases/ExportCalendar` .ics slice, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)), G20 +1 (`NowNextDTO` public
>   snapshot), G21 +9 (calendar/QR export UI, OfflineBanner, PresenterLayout onto Common theme providers), G22
>   +11 (`UserEngagementExportService` cross-service gRPC export slice), G26 +3, G23/Identity +12 ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) user
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
>   (~97%), **237** globally-unique fallback, **26** dropped ambiguous. **[ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html) (observability)** remains not
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
>   opt-in optimistic-concurrency marker consumed by `EFRepository` and the audit interceptor ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)
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
> - **G22 +5 (67 -> 72):** the durable [ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html) live-channel publish queue, `LiveChannelPublishWorkItem` /
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
>   (~96%), **331** globally-unique fallback, **27** dropped ambiguous. **[ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html) (observability)** remains
>   not cross-referenced in the guide (still flagged; its home is the devops-aspire chapter, outside scope).
> - **Authoring-methodology note (honest process record).** Adding 90 nodes shifted `plan.ps1`'s write-unit
>   packing boundaries mid-chapter across G10/G18/G25(Testing), so several pre-existing types were pushed
>   into a different part than the drift delta first flagged. A verification pass (duplicate-heading scan +
>   per-part membership diff, beyond `verify.ps1`'s presence-only check) caught 17 fall-through types and 17
>   transient duplicate sections in the testing chapter; a second targeted author wave over the shifted
>   parts (G10 p02-p04, G18 p07-p15, G25 p01/p04/p05/p07) restored parts-to-units 1:1 (final: 0 missing, 0
>   new duplicates). One part (`group-18 p15`) was authored to a stray path and relocated. The node totals
>   and classifier output are exact; the per-type attributions are commit-anchored where a commit is cited.

> **Regeneration note (re-verified against current source, v1.123.0 full drift sweep).** Regenerated
> 2026-07-23 at **framework v1.123.0** (MMCA.Common `c911480`, clean, prior-documented `658786b`;
> MMCA.ADC `160f59f5`, clean, prior-documented `cf69cb8e`; `FACTS.md` remains the source of truth for
> the version / package / ADR figures). Net change since the v1.121.0 pass: **+1** distinct node
> (2,587 -> **2,588**; declaration rows 2,674 -> 2,676), individually-sectioned 1,495 -> **1,494**,
> rolled-up 1,092 -> **1,094**, `###` sections 1,421 -> **1,436** across the (unchanged) **27**
> chapters (`verify.ps1`: 0 missing; rubric 34/34). The change is **+1 production type added, 2
> removed, 0 regrouped**, plus a **+2 net test-only rollup**. No new functional group was needed
> (`classify.ps1`: **0 unmapped**).
> - **G03 +1 (26 -> 27):** `LongFilterStrategy`
>   (`MMCA.Common.Application/Services/Filtering/LongFilterStrategy.cs:14`), the v1.122.0 long-typed
>   dynamic-filter strategy (comparisons plus IN/BETWEEN/IS EMPTY), joining the
>   Bool/DateTime/Decimal/Guid/Int/String sibling family. The chapter also repaired a pre-existing
>   gap: `EntityQueryParameters<TEntity>`, `ParameterReplacer`, `IEntityQueryPipeline`,
>   `EntityQueryPipeline`, `INavigationMetadataProvider`, and `NavigationMetadataProvider` were
>   previously narrated only in overview prose behind `#anchor` links with no matching anchors; they
>   now have real `###` sections (part p02).
> - **G04 -2 (31 -> 29):** `IIntegrationEventPublisher` (interface,
>   `MMCA.Common.Application/Interfaces/IIntegrationEventPublisher.cs`) and `IntegrationEventPublisher`
>   (adapter, `MMCA.Common.Infrastructure/Services/IntegrationEventPublisher.cs`) removed in the
>   v1.123.0 IEventBus consolidation (Common commit `e5d25b5`, PR #104); callers publish through
>   `IEventBus` directly and the chapter overview was rewritten to drop the adapter pattern.
> - **G18 (no count change):** `GetNowNextQuery` now implements `IQueryCacheable` ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8:
>   `CacheKey` under the Session-aggregate prefix, 30s `CacheDuration`); its citation moved
>   `GetNowNextQuery.cs:11 -> :23` and its computed Level moved 0 -> 7, relocating its section within
>   the chapter (old unit p05 -> p14).
> - **G25/Testing +2 net (1,242 -> 1,244, all rolled up):** +`LongFilterStrategyTests`,
>   +`GetNowNextQueryCacheTests`, +`WarningCountingLogger` (nested,
>   `DistributedCacheServiceTests.cs:116`); -`IntegrationEventPublisherTests`;
>   `RecordingIntegrationEventPublisher` renamed in place to `RecordingEventBus`
>   (`TestSupport.cs:266`, retargeted from the deleted contract to `IEventBus`, net-zero). Extractor
>   artifact honestly recorded: the new nested `Item` fixture in `LongFilterStrategyTests.cs:8`
>   collides by name+namespace with the sibling files' existing fixture, so declaration rows rose +2
>   while distinct nodes rose +1 for that hunk.
> - Citation-line-only shifts corrected across G03/G04/G09/G14/G25 (e.g.
>   `DistributedCacheService.cs:14 -> :17`, Infrastructure `DependencyInjection.cs:35 -> :37` after
>   losing the adapter registration, `InProcessMessageBus.cs:20 -> :19`). Cycles **16** (unchanged,
>   same membership, re-verified via invtool). Edge resolution: **8,871** namespace-visible (~96%),
>   **331** globally-unique fallback, **27** dropped ambiguous (rounded figures unchanged).
> - **Post-author verification record:** an adversarial spot-check flagged and corrected two authored
>   claims before this note was written: the testing-chapter overview's "eighteen
>   `ArchitectureRules.*` partial files" (actual: **16**, with no `Aggregates` partial; aggregate
>   rules live inside `ArchitectureRules.Entities.cs` and are exercised via
>   `Bases/AggregateConventionTestsBase.cs`) and a G03 claim that `StringFilterStrategy`'s nine
>   operators are the family's largest set (the DateTime/Decimal/Int/Long strategies have ten each),
>   plus three minor citation-precision slips in the testing overview.

> **Regeneration note (re-verified against current source, v1.128.0 full drift sweep).** Regenerated
> 2026-07-25 at **framework v1.128.0** (MMCA.Common `3dff29b`, clean, prior-documented `c911480`;
> MMCA.ADC `ec7a0c4a`, clean, prior-documented `160f59f5`; `FACTS.md` remains the source of truth for
> the version / package / ADR figures). Net change since the v1.123.0 pass: **+49** distinct nodes
> (2,588 -> **2,637**; declaration rows 2,676 -> 2,727; files scanned 2,210 -> 2,252, generated
> exclusions 78 -> 88), individually-sectioned 1,494 -> **1,517**, rolled-up 1,094 -> **1,120**,
> `###` sections 1,436 -> **1,456** across the (unchanged) **27** chapters (`verify.ps1`: 0 missing;
> rubric 34/34). The change is **+23 production types added, 0 removed, 0 regrouped, 0 moved**, plus a
> **+26 test-only rollup**. No new functional group was needed (`classify.ps1`: **0 unmapped**).
> - **G03 +2 (27 -> 29):** `DynamicQueryConfig`
>   (`MMCA.Common.Application/Services/Filtering/DynamicQueryConfig.cs:18`) and `PagingMath`
>   (`MMCA.Common.Application/Services/Query/PagingMath.cs:20`), the extracted page-size clamp shared
>   by the query pipeline and the controller base.
> - **G07 +5 (85 -> 90):** the `ExecuteUpdateAsync` set-builder pair `IUpdatePropertySetter<TEntity>`
>   (`MMCA.Common.Application/Interfaces/Infrastructure/IUpdatePropertySetter.cs:13`) and
>   `UpdatePropertySetterBuilder<TEntity>`
>   (`MMCA.Common.Infrastructure/Persistence/Repositories/UpdatePropertySetterBuilder.cs:14`);
>   `PeriodicBackgroundService` (`MMCA.Common.Infrastructure/Services/PeriodicBackgroundService.cs:20`);
>   and two nested types now surfaced by the extractor, `DetectChangesScope`
>   (`MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:170`) and
>   `AggregateCapture`
>   (`MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:303`).
> - **G08 +3 (56 -> 59):** `AllowMissingOwnerAttribute`
>   (`MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:21`) and the striped async lock
>   `KeyedSemaphoreStripe` + its nested `Releaser`
>   (`MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22` and `:78`).
> - **G09 +2 (4 -> 6):** `CacheKeyPrefixOptions` and `CacheKeyNamespace`
>   (`MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:28` and `:41`), doubling the caching chapter.
> - **G12 +1 (56 -> 57):** `ConcurrencyTokenRequest` (`MMCA.Common.Shared/DTOs/ConcurrencyTokenRequest.cs:12`),
>   the shared row-version DTO the v1.125.0 sweep swapped every lifecycle-transition record onto
>   ([ADR-035](https://ivanball.github.io/docs/adr/035-entity-lifecycle-toggles.html)).
> - **G17 +1 (85 -> 86)** and **G22 +1 (72 -> 73):** the per-module transition requests built on that
>   DTO, `EventTransitionRequest` (`MMCA.ADC.Conference.Shared/Events/EventTransitionRequest.cs:14`) and
>   `LifecycleTransitionRequest` (`MMCA.ADC.Engagement.Shared/LifecycleTransitionRequest.cs:15`).
> - **G18 +5 (211 -> 216):** the AI session-scoring queue `ISessionScoringQueue` /
>   `SessionScoringEnqueueResult` (`.../DecisionSupport/ScoreEventSessions/ISessionScoringQueue.cs:31`
>   and `:4`) + `SessionScoringQueue` (`.../ScoreEventSessions/SessionScoringQueue.cs:17`), and the
>   server-side speaker filter `GetSessionsBySpeakerFilterQuery` / `GetSessionsBySpeakerFilterHandler`
>   (`.../GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterQuery.cs:11`, `...Handler.cs:21`) that
>   replaced the client-side virtual filter.
> - **G19 +1 (27 -> 28):** `SessionScoringProcessor`
>   (`MMCA.ADC.Conference.Infrastructure/Services/SessionScoringProcessor.cs:31`), the background
>   drain for that queue.
> - **Chapter 23 / G26 +2 (92 -> 94):** the atomic counter handlers `LivePollVoteChangedHandler`
>   (`MMCA.ADC.Engagement.Application/LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:31`)
>   and `SessionQuestionUpvoteChangedHandler`
>   (`MMCA.ADC.Engagement.Application/SessionQuestions/DomainEventHandlers/SessionQuestionUpvoteChangedHandler.cs:32`).
> - **G25/Testing +26 net (1,244 -> 1,270, all rolled up; individually-sectioned reusable infrastructure
>   stays at 150):** new suites across `MMCA.Common.Application.Tests`, `MMCA.Common.Infrastructure.Tests`,
>   `MMCA.Common.Shared.Tests`, `MMCA.Common.Benchmarks`, `MMCA.ADC.Conference.Application.Tests` and
>   `MMCA.ADC.Engagement.Application.Tests`, plus a brand-new project
>   **`MMCA.Common.Infrastructure.Redis.Tests`** (1 type, `DistributedCacheServiceRedisTests`) which
>   gets its own row in the per-project rollup table.
> - Cycles **16 -> 18**: two new test-only SCCs, `MidSaveContextCreatingDbContext` /
>   `ReentrantSaveInterceptor` and `FailingSaveInterceptor` / `OutboxRoutingTestDbContext`, both wholly
>   inside the testing group (all four assigned `G25`), and the
>   `CosmosConfigurationPortabilityTests` SCC's level shifted 9 -> 10. Edge resolution: **9,038**
>   namespace-visible (~96%), **335** globally-unique fallback, **28** dropped ambiguous.
> - **Post-author verification record:** re-authoring under a repacked unit layout dropped three
>   pre-existing sections whose types had shifted across unit boundaries into a part that was not in
>   the re-author set (`GetSessionBookmarkCountQuery`, `GetSessionBookmarkCountHandler`,
>   `SessionEventIdRules<T>`, all group-18). `verify.ps1` caught it (3 missing); the sections were
>   restored into their new home unit and re-verified line by line against current source, which
>   surfaced one genuine drift corrected in the restored text: the bookmark-count endpoint's output-cache
>   policy is now `BookmarkCountsCache`, not `ConferencePublicCache`
>   (`MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:264`). A second spot-check corrected a
>   loose anchor in the group-08 overview: 75-octet folding and the CRLF writes both live in
>   `IcsCalendarBuilder.AppendLine` (`MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:83-104`), not at
>   `:22`. Final run: **0 missing, rubric 34/34**.

> **Regeneration note (re-verified against current source, v1.131.0 full drift sweep).** Regenerated
> 2026-07-28 at **framework v1.131.0** (MMCA.Common `2c52aa9`, clean, prior-documented `3dff29b`;
> MMCA.ADC `2ec77796`, clean, prior-documented `ec7a0c4a`; `FACTS.md` remains the source of truth for
> the version / package / ADR figures). Net change since the v1.128.0 pass: **+8** distinct nodes
> (2,637 -> **2,645**; declaration rows 2,727 -> 2,735; files scanned 2,252 -> 2,260, generated
> exclusions unchanged at 88), individually-sectioned 1,517 -> **1,524**, rolled-up 1,120 -> **1,121**,
> across the (unchanged) **27** chapters (`verify.ps1`: 0 missing; rubric 34/34). The change is
> **+7 individually-sectioned types added, 0 removed, 0 regrouped**, plus a **+1 net test-only rollup**
> (+2 added, -1 removed) and **2 citation-line corrections**. No new functional group was needed
> (`classify.ps1`: **0 unmapped**). The whole delta traces to one change: ADC commit `01551f14`
> ("Bump MMCA.Common to v1.131.0 and adopt the shared health-check and test bases", #77) and the
> framework work it consumes.
> - **G16 +1 (16 -> 17):** `HealthCheckTags`
>   (`MMCA.Common.Aspire/HealthCheckTags.cs:6`), the shared liveness/readiness tag vocabulary the
>   service hosts now register against. The chapter repacked from one sections unit to two, which
>   relocated the existing `HttpResilienceDefaults` section into the new `p02` unit unchanged.
> - **G22 +1 (73 -> 74)** and **G23 +1 (82 -> 83):** `SelfHttpWarmupTask`, one per extractable service
>   host (`MMCA.ADC.Engagement.Service/SelfHttpWarmupTask.cs:19` and
>   `MMCA.ADC.Identity.Service/SelfHttpWarmupTask.cs:19`). They are two distinct classes that share a
>   name, taught in their own service chapters. The Conference service has no equivalent today.
> - **G25 +5 (1,270 -> 1,275), of which +4 are individually sectioned:** the shared host bases
>   `ProductionHostApplicationFactory<TEntryPoint>` (`MMCA.Common.Testing/ProductionHostApplicationFactory.cs:22`)
>   and `GracefulShutdownTestsBase<TEntryPoint>` (`MMCA.Common.Testing/GracefulShutdownTestsBase.cs:24`),
>   the fitness base `ObservabilityConventionTestsBase`
>   (`MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:30`) and its own
>   suite `ObservabilityConventionTestsBaseTests`
>   (`MMCA.Common.Architecture.Tests/ObservabilityConventionTestsBaseTests.cs:14`); plus two rolled-up
>   suites, `AuthControllerBaseRateLimitTests`
>   (`MMCA.Common.API.Tests/Controllers/AuthControllerBaseRateLimitTests.cs:16`) and
>   `InfrastructureHealthChecksTests` (`MMCA.Common.Aspire.Tests/Health/InfrastructureHealthChecksTests.cs:16`).
>   The one **removal** this pass is ADC's local `GatewayApplicationFactory`
>   (`MMCA.ADC.Gateway.Tests/GatewayApplicationFactory.cs:12`), deleted in `01551f14` and functionally
>   superseded by the shared generic base above; because the shapes differ (local concrete factory vs
>   shared generic base) it is tracked as remove + add, not a move, per the earlier
>   `AnonymousAuthenticationStateProvider` precedent. Reusable-infrastructure sections rose 150 -> 154;
>   the per-project rollup table moved `MMCA.ADC.Gateway.Tests` 6 -> 5, `MMCA.Common.API.Tests` 65 -> 66
>   and `MMCA.Common.Aspire.Tests` 11 -> 12.
> - **Citation-only corrections (no behavior change):** `AuthControllerBase`
>   (`MMCA.Common.API/Controllers/AuthControllerBase.cs`) `:16 -> :40` in
>   [group-12](group-12-api-hosting-mapping.md), and `AuthController`
>   (`MMCA.ADC.Identity.API/Controllers/AuthController.cs`) `:25 -> :26` in
>   [group-24](group-24-identity-module.md). Three rolled-up test classes also shifted lines
>   (`ConstructorDependencyCountTests` `:11 -> :17`, `GracefulShutdownTests` `:14 -> :9`,
>   `ObservabilityConventionTests` `:17 -> :7`); they are cited only in
>   [`00-inventory.md`](00-inventory.md), which regenerates.
> - **Cycles 18 -> 19, and the 19th is a phantom.** The new SCC pairs the two `SelfHttpWarmupTask`
>   classes with each other. Neither references the other; they are unrelated types in different
>   services that the extractor's globally-unique-name fallback cannot tell apart. It is the first
>   cycle whose members sit in two different groups (`G22` and `G23`), and correctly so, since each
>   chapter teaches its own class. Recorded here rather than suppressed, because
>   `00-dependency-manifest.md` is generated and will keep reporting it until the fallback gains
>   namespace disambiguation or one class is renamed. Edge resolution: **9,050** namespace-visible
>   (~96%), **338** globally-unique fallback (335 -> 338), **28** dropped ambiguous (unchanged).
> - **Correction to the prior pass's section count.** The v1.128.0 note recorded `###` sections as
>   1,436 -> 1,456. The assembled corpus at that commit actually held **1,439**, so the recorded figure
>   was overstated by 17; it appears to have been inferred rather than measured. This pass measures it
>   directly from `concat.ps1`'s per-chapter output: **1,439 -> 1,446**, exactly +7 for the seven new
>   individually-sectioned types (group-16 16 -> 17, group-22 64 -> 65, group-24 65 -> 66, group-27
>   145 -> 149; group-12 unchanged at 57, its edit being citation-only). Coverage was never affected:
>   `verify.ps1` checks names, not section totals, and reported 0 missing at both passes.
> - **Post-author verification record:** the spot-check pass returned two DRIFTED verdicts on prose
>   this run authored, both confirmed against source and corrected before assembly. (1) The group-22
>   overview attributed the design-time migrations factory's configuration-assembly handle to the
>   Application-layer `AssemblyReference`; the factory actually uses
>   `MMCA.ADC.Engagement.Infrastructure.AssemblyReference`
>   (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Engagement/DesignTimeSQLServerDbContextFactory.cs:27`),
>   which is the correct layer because the `IEntityTypeConfiguration` classes live in Infrastructure.
>   (2) The group-12 `ApiControllerBase` section claimed the shared `internal static` `ErrorHttpMapping`
>   members let `UnhandledResultFailureFilter` produce a "byte-identical" body. Only the status code
>   and the `errors` extension are shared; `Title`/`Detail` deliberately differ ("Unhandled result
>   failure" / "The action returned a Result.Failure that was not mapped to an HTTP error response."
>   at `MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:41-42` against "Operation failed" /
>   "One or more errors occurred." at `MMCA.Common.API/Controllers/ApiControllerBase.cs:43-44`), so a
>   response that fell through the filter stays distinguishable from one the controller mapped on
>   purpose. Final run after both corrections: **0 missing, rubric 34/34**.
> - **One code-side fix landed out of this sweep.** Authoring the group-16 chapter surfaced a stale
>   in-code comment: `OutboxPollFilterProcessor` explained its duplicated activity-name literals with
>   "the Aspire package has no project references by design", which stopped being true when
>   `MMCA.Common.Aspire` took a `ProjectReference` on `MMCA.Common.Shared` for `HttpResilienceDefaults`.
>   Corrected in MMCA.Common `006812e` (PR #167, merged after this sweep's extraction at `2c52aa9`):
>   the real reason is that the package does not reference `MMCA.Common.Infrastructure`, where
>   `OutboxProcessor` lives, so `AddServiceDefaults` stays usable from a host that does not take the
>   persistence stack. That commit lengthened the comment by three lines, shifting the citations inside
>   the type's body, so the group-16 overview and section were re-cited against `006812e`
>   (`OnEnd` `:24 -> :27`, parent-chain walk `:34 -> :37`, the both-names match `:36-37 -> :39-40`, the
>   `Recorded` clear `:42 -> :45`, the null guard `:26-30 -> :29-33`, the two constants
>   `:20-21 -> :23-24`, the comment itself `:17-19 -> :17-22`). The type's own declaration line (`:15`)
>   is above the comment and did not move, so the generated inventory, taxonomy and node set are
>   unaffected and were not re-extracted. The chapter prose also repeated the false
>   "no project references" reason in two places; both now state the Infrastructure-specific one.

> **Regeneration note (re-verified against current source, v1.135.0 full drift sweep).** Regenerated at
> **framework v1.135.0** (MMCA.Common `f292233`; MMCA.ADC `995a7886`; both clean; `FACTS.md` is the source
> of truth for the version and package figures). Net change since the v1.131.0 pass: **+92** distinct
> nodes (2,645 to **2,737**), individually-sectioned 1,524 to **1,556**, rolled-up 1,121 to **1,181**,
> cycles 19 to **20**. `classify.ps1`: **0 unmapped**, so no new functional group was needed and the
> chapter count stays at 27. `verify.ps1`: **0 missing, rubric 34/34**. `###` sections 1,446 to
> **1,442**, which is a *fall* despite 43 new sections because this pass also removed 47 duplicate or
> dead ones (see the dedup paragraph below): 1,446 - 47 + 43 = 1,442, measured from `concat.ps1`'s
> per-chapter output rather than inferred. The delta traces to the bug-hunt remediation waves in both
> repos (MMCA.Common #177/#179/#180, MMCA.ADC #88 to #94) and releases v1.132.0 through v1.135.0.
> - **34 new individually-sectioned types, +60 rolled-up test types, 2 removed.** G05 +1
>   (`IDistributedLock`, `MMCA.Common.Application/Interfaces/IDistributedLock.cs:30`); G07 +1
>   (`TransactionCommitAmbiguousException`,
>   `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/TransactionCommitAmbiguousException.cs:22`);
>   G14 +4 (the distributed-lock implementations and their handles, `Infrastructure/Concurrency/`);
>   G15 +3 (`ICultureApplier`, `EndpointCultureApplier`, `ChannelReferenceCounter`); G17 +1
>   (`ConferenceReadAudience`, `Conference.Shared/Authorization/ConferenceReadAudience.cs:23`);
>   G18 +13 (the six `GetPublic*Filter` query/handler pairs, `PublicConferenceVisibility`,
>   `PublicSessionStatusSpecification`, `LocalityLookupEntry`); G20 +2 (`PublicLookupReader`,
>   `CurrentUserServiceExtensions`); G21 +1 (`SessionSelectionFilterOptions`) and **-2**
>   (`SponsorInfo`, `SponsorTierInfo`, both deleted from `ADCHome.razor.cs`, whose sections and inbound
>   links were removed); G22 +5 (the now-and-next slice plus `LiveEventListener`); G26 +3 (the MAUI
>   culture applier, initializer and store). The clusters are the BR-49/BR-239 public-visibility
>   projection, the culture-applier boundary ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)),
>   distributed locking behind the idempotency filter, and reference-counted hub-channel membership
>   ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)).
> - **The `DbContexts.Factory` family was written for the first time (+9 sections).** `IDbContextFactory`,
>   `IPhysicalDbContextFactory`, `PhysicalDbContextFactory`, `ApplicationDbContextEFFactory`, the three
>   `Default*DbContextFactory` engine shims, `DbContextFactory` and `IdentityInsertGroup` had **no
>   sections at all** despite other chapters cross-linking to them, so those anchors resolved nowhere.
>   Closing them dropped the anchor-less count from 107 to 64 (§5, item 4).
> - **47 duplicate or dead sections removed.** Earlier passes re-authored a repacked part into its
>   successor without removing the predecessor, so seven chapters taught the same type twice: the
>   assembled corpus held **42** duplicate headings, 28 of them in group-07 alone, where `p02`'s 13
>   sections were a strict subset of `p03`'s 14 and `p04`'s 15 a subset of `p05`'s 16. The stale copies
>   were the losers on evidence (`p02` cited `ApplicationDbContext.cs:34` and `class`; `p03` cites `:35`
>   and `class (abstract)`), so four fully-redundant part files were deleted and the individual
>   duplicates removed from `group-04-p02`, `group-19-p01`, `group-23-p07` and `group-24-p02`. One
>   deletion was caught and reverted: `group-25-p03` also held the **WinUI** `App`
>   (`MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:8`), a distinct type from `p01`'s `App`
>   (`MMCA.ADC.UI/App.xaml.cs:7`), so a name-based subset test wrongly read it as redundant; that
>   section was restored. A (section + citation) pair check across the whole corpus now reports **0**
>   duplicates.
> - **137 section-header citations corrected mechanically** from the fresh inventory across 35 parts
>   (3 same-name cases were left alone as ambiguous). This only fixes the declaration line in each
>   section's meta line; see §5 item 5 for why that is not sufficient.
> - **8 sections repaired after an adversarial prose check returned 8 DRIFTED out of 8.** The sampled
>   sections were the ones whose declaration line had moved furthest, and several described behaviour
>   that has since inverted: `SafeDomainEventHandler<TDomainEvent>` was documented as swallowing handler
>   exceptions when the current code uses an exception filter that logs and **rethrows**
>   (`SafeDomainEventHandler.cs:63-67`); `WarmupHostedService` was documented as having no per-task
>   deadline, with the hang called out as an open gap, when a `WaitAsync(_taskTimeout, ...)` timeout and
>   a fourth `LogTaskTimedOut` message now exist (`WarmupHostedService.cs:69`, `:105`);
>   `QueryCacheKeyLocks` was documented as a `ConcurrentDictionary<string, SemaphoreSlim>` keyed exactly
>   when it is now a fixed-width `KeyedSemaphoreStripe` that buckets keys (`CachingQueryDecorator.cs:123`);
>   `MemoryCacheService`'s claimed load-bearing write ordering no longer exists; `SpeakerLocalityHelper`'s
>   `FindLocalityCategory` is now the plural `FindLocalityCategories` returning every match
>   (`SpeakerLocalityHelper.cs:88`); and `ConferenceTrackInfo` described twelve tracks with names that
>   appear nowhere in source against the real eight (`ADCHome.razor.cs:254-268`). `PropertyAccessor` and
>   `AggregateCapture` were citation-stale throughout. All eight were rewritten against current source.
> - **The 20th cycle is genuine, unlike the 19th.** `CommitFailingDbContext` and `FailingDatabaseFacade`
>   (`MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:175` and
>   `:230`) really do reference each other: the context holds the facade and the facade takes the context.
>   Both are rolled-up test doubles, so no chapter section is affected. Edge resolution: **9,543**
>   namespace-visible (~96%), **348** globally-unique fallback (338 to 348), **28** dropped ambiguous
>   (unchanged).
> - **Method note.** The mechanical plan repacked G18 (16 to 17 units) and G26 (10 to 11), and the
>   workflow's default apply path would have re-authored all 28 of those parts from their new rosters.
>   That was deliberately **not** done: parts and unit boundaries have been out of sync for many passes
>   (44 of 123 sections units at this pass), so a wholesale rewrite drops the sections that migrated
>   elsewhere, which is exactly what produced the 42 duplicates above. New sections were inserted into
>   the part where their siblings already live, leaving every other section byte-identical.

> **Regeneration note (re-verified against current source, v1.142.0 full drift sweep).** Regenerated at
> **framework v1.142.0** (MMCA.Common `710d29d`; MMCA.ADC `e50ce9b8`; both clean; `FACTS.md` is the
> source of truth for the version and package figures). Net change since the v1.135.0 pass: **+127**
> distinct nodes (2,737 to **2,864**), individually-sectioned 1,556 to **1,598**, rolled-up 1,181 to
> **1,266**, cycles 20 to **21**. `classify.ps1`: **0 unmapped**, no new functional group needed, the
> chapter count stays at 27. `verify.ps1`: **0 missing, rubric 34/34**. `###` sections 1,442 to
> **1,388** (28 stale duplicate copies deleted after the full-roster re-author, plus sibling-family
> consolidation in the rewritten parts; measured from `concat.ps1`'s per-chapter output). The delta
> traces to the production-patterns extraction program and releases v1.136.0 through v1.142.0.
> - **The dominant cluster is the user-account use-case extraction to Common.** The generic
>   `ChangePassword`/`ChangePreferences`/`DeleteUser`/`GetUserPreferences` handler bases plus the
>   user-scoping contracts (`IUserScopedRequest`, `IUserOwnedRequest`, `UserOwnershipRule`,
>   `SoftDeletedUserValidator<TUser>`, `UserUseCaseLog`) landed in G14
>   (`MMCA.Common.Application/Users/`), the preference/erasure domain contracts (`IErasableUser`,
>   `IPasswordChangeableUser`, `IUserPreferences`) in G08 (`MMCA.Common.Domain/Auth/`),
>   `OwnedByUserSpecification<TEntity, TIdentifierType>` in G03
>   (`MMCA.Common.Domain/Specifications/OwnedByUserSpecification.cs:20`), and
>   `UserAccountAuthControllerBase` in G12. The ADC Identity originals (`ChangePreferencesRequest`,
>   `GetUserPreferencesQuery`, `UserPreferencesResponse`, the non-generic `SoftDeletedUserValidator`)
>   were deleted from G23, and the Conference `OwnEventQuestionAnswerSpecification` /
>   `OwnSessionQuestionAnswerSpecification` pair was replaced by the generic specification (G18).
> - **Hosting extraction (G16/G24/G27-device).** The four per-service `KestrelConfiguration` classes
>   were replaced by `KestrelEndpointExtensions` + `KestrelListenerSpec`
>   (`MMCA.Common.Aspire/Kestrel/`), self-warmup gained the shared `SelfHttpWarmupTaskBase`
>   (`MMCA.Common.Aspire/Warmup/`), and `MauiTokenStorageService` moved from `MMCA.ADC.UI` to
>   `MMCA.Common.UI.Maui` (joined by the new `MainPageBase`).
> - **New framework surface.** G07 +9 (the four value converters under
>   `MMCA.Common.Infrastructure/Persistence/Conversions/`, `EntityTypeBuilderExtensions` /
>   `IndexBuilderExtensions`, `IdentityModuleDbSeederBase<TUser>` + `SeedAccount`,
>   `SoftDeleteFilterSql`); G04 +1 (`OutboxMetrics`); G12 +2 (`IdempotencyMetrics`,
>   `UserAccountAuthControllerBase`); G08 +7; G14 +12; G16 +4; G18 +2 (`SessionizeSyncWarnings`,
>   `SessionScoringWorkItem`); G20 -2 (`PublicLookupReader` removed, Kestrel config extracted);
>   G25 +99 net rolled-up test types plus new individually-sectioned testing bases
>   (`CrossServiceFixtureBase`, `DependencyInjectionAssert`, `TestPolling`,
>   `ModuleConformanceTestsBase<TModule>`, `WebVitalsBudget`).
> - **The 21st cycle is genuine and test-only.** `RecordingDistributedLock` and its nested `Handle`
>   (`MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringProcessorTests.cs:197` and
>   `:235`) reference each other; both are rolled-up test doubles, so no chapter section is affected.
>   Edge resolution: **9,964** namespace-visible (~97%), **358** globally-unique fallback (348 to
>   358), **28** dropped ambiguous (unchanged).
> - **Method note: this pass re-authored to the new rosters, then deduplicated.** 53 approved units
>   were re-authored from current source (15 overviews, 37 sections units, the G25 rollup), and the
>   G18 repack fallout was closed by re-authoring **all 18** of its sections units so parts and unit
>   boundaries are back in sync there. The re-author left 28 stale duplicate section copies behind in
>   six not-re-authored parts; each was deleted in favor of the freshly authored owner copy, which
>   emptied three part files entirely (`group-07-...-p07`, `group-26-...-p09`, `group-27-...-p07`,
>   removed). A duplicate scan against the prior corpus now reports only legitimate same-name
>   families (e.g. the five per-assembly Identity `DependencyInjection` classes, the fifth being the
>   newly added `MMCA.ADC.Identity.API/DependencyInjection.cs:18`).
> - **Spot-checks.** All 15 re-authored overviews plus the G25 rollup were adversarially spot-checked:
>   14 CONFIRMED, one DRIFTED on a citation nit (the G10 overview called all four notification
>   defaults no-ops; `IEmailSender`'s default is the real `SmtpEmailSender`,
>   `MMCA.Common.Infrastructure/DependencyInjection.cs:234`, and `INotificationRecipientProvider`'s
>   no-op default lives at `MMCA.Common.Application/Notifications/DependencyInjection.cs:67`); the
>   sentence was corrected in place and re-verified against source.

> **Regeneration note (re-verified against current source, v1.152.0 full drift sweep).** Regenerated at
> **framework v1.152.0** (MMCA.Common `3ba8d13`; MMCA.ADC `e129c82f`; both clean; `FACTS.md` is the
> source of truth for the version and package figures). Net change since the v1.142.0 pass: **+400**
> distinct nodes (2,864 to **3,264**), individually-sectioned 1,598 to **1,804**, rolled-up 1,266 to
> **1,460**, cycles 21 to **26**, `###` sections 1,388 to **1,740**. `classify.ps1`: **0 unmapped**, no
> new functional group needed, the chapter count stays at 27. `verify.ps1`: **0 missing, rubric 34/34**.
> One honest caveat up front: this delta spans releases **v1.143.0 through v1.152.0** (roughly ten
> releases with no intervening onboarding sweep), so per-type attribution below is derived from the
> mechanical inventory diff, not from per-release narration.
> - **The dominant application cluster is the Engagement build-out (G22 +100, 78 to 178).** The shipped
>   conference-day features: the QR badge check-in surface (organizer scanning, manual fallback,
>   attendee self-service from printed room/sponsor codes, attendance rollup), the points economy (an
>   append-only ledger plus the opt-in public leaderboard with GDPR erasure), and their use cases,
>   persistence, API and UI. The chapter's fourteen sections units plus overview were re-authored to
>   the new roster and the `00-index.md` concern line now names all four capability families.
> - **The dominant framework cluster is the enterprise wave (v1.150.0, ADRs 073-078; +61 across
>   G02/G05/G07/G08/G09/G12/G14/G16).** Audit trail (`AuditTrailEntry`,
>   `AuditTrailSaveChangesInterceptor`, `MMCA.Common.Infrastructure/Persistence/AuditTrail/`), the
>   scheduler (`IScheduledJob`, `ScheduledJobRunner`, `SchedulerMetrics`), multi-tenancy
>   (`TenantContext`, `TenantSaveChangesInterceptor`, `TenantResolutionMiddleware`,
>   `TenancySettings`), hybrid caching (`HybridCacheService`, `RedisPrefixScanner`), and the GDPR
>   data-export generalization (`ExportUserDataHandlerBase<TUser, TQuery>`,
>   `DataExportControllerBase<TQuery>`, `IUserDataExportSection`, `CsvWriter`).
> - **The one removed type is a move-to-Common, not a deletion.** `UserDataExportDTO` left
>   `MMCA.ADC.Identity.Shared.Users` and reappears in G08 under `MMCA.Common.Shared.Privacy`
>   alongside `UserDataExportSectionDTO` and `PrivacyFeatures`; the ADC Identity chapter (G24)
>   sections were updated accordingly.
> - **Conference additions (+44 across G17-G21):** sponsors (the `AddSponsors` migration family and
>   home-page sponsor rail), the per-event organizer contact email, the room-name unique index, and
>   decision-support/session additions; plus **+194** rolled-up test types in the testing chapter
>   (G25 classifier id, chapter 27) covering all of the above.
> - **Graph and cycle movement.** Edge resolution: **11,706** namespace-visible (~96%), **481**
>   globally-unique fallback (358 to 481), **28** dropped ambiguous (unchanged). Cycles 21 to 26;
>   three of the 26 are now identical-name fallback artifacts rather than real dependencies (the
>   `SelfHttpWarmupTask` service pair, plus the new test pairs `Priority` at
>   `MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EnumerationValueConverterTests.cs:89` /
>   `MMCA.Common.Shared.Tests/ValueObjects/EnumerationTests.cs:122` and `GateTestContext` at
>   `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailModelGateTests.cs:76` /
>   `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:71`). The largest new
>   genuine cycle is the eight-member G07 interceptor SCC around `ApplicationDbContext` (now including
>   `AuditTrailSaveChangesInterceptor` and `TenantSaveChangesInterceptor`).
> - **Method note: this pass re-authored 118 units, then deduplicated against unit rosters.** The
>   approved scope was 102 units (83 sections units mapped from the added/moved type sets, 17
>   overviews, the testing rollup); the G18 repack fallout then required its remaining 11 sections
>   units (`plan.ps1` regrew the chapter to 19 sections units), and five newly-packed units with no
>   prior part (G07 p02/p11, G14 p06, G21 p07, testing p07) were authored to close the packing.
>   Deduplication removed **71** stale duplicate section copies across 11 not-re-authored parts,
>   emptying five part files (removed). 35 sole-copy sections remain in parts whose new roster no
>   longer lists them (placement drift, coverage intact per `verify.ps1`); they reconcile at the next
>   repack re-author.
> - **Spot-checks.** All 16 authored overview/rollup parts were adversarially spot-checked: 15
>   CONFIRMED, one DRIFTED on a citation nit (the G02 overview cited the PII-erasure fitness rule at
>   `ArchitectureRules.Governance.cs:50`, a shared helper; the rule method
>   `EntitiesWithPiiImplementAnonymizable` lives at `ArchitectureRules.Governance.cs:11`); the
>   citation was corrected in place, alongside one cosmetic line-count fix in the G05 overview flagged
>   by an otherwise-CONFIRMED check.

> **Regeneration note (re-verified against current source, devops-scope refresh, 2026-08-14).** A scoped
> refresh of the five hand-authored DevOps chapters (outside the type pipeline; last refreshed
> 2026-08-02) against MMCA.Common `3ba8d13` and MMCA.ADC `e129c82f`. Each chapter was drift-checked
> read-only first, then re-authored targeted-sections-only; all five verdicts were TARGETED, no full
> re-author and no node-count change (the type inventory was already current from the v1.152.0 sweep).
> - **devops-cicd (3 fixes):** the integration-tests gate now guards roughly 390 `[Fact]` methods
>   (was 330), the three freshness jobs grant two read privileges, `actions: read` plus
>   `contents: read` (`deploy.yml:553-555/610-612/667-669`), and the Testcontainers-tier description
>   cite moved to `cross-service-tests.yml:6-10`.
> - **devops-iac:** new coverage for the post-08-02 pure-insertion bicep additions: the daily ACR
>   purge task (`foundation.bicep:83-108`, a third foundation resource), the two
>   `Telemetry__Disable*Metrics` env vars on all six apps (`main.bicep:231-238`), the private
>   DataProtection key-ring container (`main.bicep:821-827`) with Identity/UI wiring (`:1134-1135`,
>   `:1780-1781`) and the explicitly-not-implemented Key Vault Crypto User follow-up, the
>   `KeyVault__Uri` config source on five apps (Gateway excluded, `:937-939`), and the
>   `Scheduler__PollingIntervalSeconds` / `Outbox__DeadLetterRetentionDays` settings; every
>   `main.bicep`/`foundation.bicep` cite was re-derived (insertion offsets of +15 to +101).
> - **devops-aspire:** the Gateway's three forwarder configs with explicit activity timeouts and the
>   two new `Gateway:*` knobs (`Gateway/Program.cs:75-110`), the eighth `MMCA.Common.Aspire.Hosting`
>   extension `WithE2eRegistrationThrottleLift` (`Extensions.cs:176-191`, replacing the inline AppHost
>   throttle lift), a new subsection for `AddCommonKeyVaultConfiguration` / `AddCommonDataProtection` /
>   `AddScheduledJobs` (each no-ops when its config key is absent), the four-meter OTel list, and a
>   full AppHost/Extensions cite sweep.
> - **devops-runbooks:** the restore-drill narrative was inverted to match source: the DR doc now
>   documents three automated paths with the weekly cron as the enforcing one, and a six-row drill
>   ledger, latest 2026-08-10 (`DISASTER-RECOVERY.md:120-175`); the stale OPERATIONS.md 3-day-window
>   caution was dropped (fixed at source in ADC `1dd53f8d`); roughly 20 `main.bicep` cites re-anchored.
> - **devops-testing:** all 45 per-project rows re-derived from the regenerated inventory (methodology
>   unchanged: distinct inventory nodes), roll-ups now 875 Common + 658 ADC = 1,533 types (was 1,246);
>   FACTS-owned fitness numbers moved to 100 methods / 32 bases / 78 executed by Common's own build
>   (`FACTS.md:44,47-48`), with `ModuleConformanceTestsBase` and its Common-repo test class newly
>   covered; the shipped-package roll-up is now 95 (was 89).

---

## 2. Exceptions log (every deliberate omission, with reason)

### 2.1 Generated / scaffolded code, not sectioned (118 files)
EF Core migrations (`/Migrations/`, `.Migrations.SqlServer`), `ModelSnapshot`, `*.Designer.cs`,
`*.g.cs`, `GlobalUsings.g.cs`, and `AssemblyInfo.cs` are excluded by rule (`Tools/invtool` `IsGenerated`).
The **mechanisms** that produce them are taught instead: the `DbContext`, the migration workflow, and
the `.proto`/gRPC contracts (see [group-07](group-07-persistence-ef-core.md),
[group-13](group-13-grpc-contracts.md), and [devops-testing](devops-testing.md)). The full file list is
in [`00-inventory.md`](00-inventory.md#generated--excluded-artifacts-no-type-sections-written).

### 2.2 Per-`[Fact]` test classes, rolled up by project (1,460 types)
Per the guide's TESTS note, individual test classes are **not** given per-type sections. The
[Testing chapter (group-27)](group-27-testing-infrastructure.md) instead:
- sections the **reusable** test infrastructure in full (the **168** types in `MMCA.Common.Testing`,
  `.Testing.E2E`, `.Testing.UI`, the shared **`.Testing.Architecture`** rule library + bases, now
  including the six convention/fitness bases added since v1.93.0, the web-vitals collector, the
  localization resx-parity base, the slice-cohesion base, the markup-snapshot helper, the new
  contract/route-authorization bases (`RouteAuthorizationTestsBase`, the OpenAPI/ProblemDetails/
  ServiceInfo-versioning contract bases) and the shared `HttpTestDoubles` UI harness added since
  v1.111.0, the shared `ProductionHostApplicationFactory<TEntryPoint>` /
  `GracefulShutdownTestsBase<TEntryPoint>` host bases and the `ObservabilityConventionTestsBase`
  fitness base added at the v1.135.0 pass, plus the cross-service fixture/data-source bases,
  `DependencyInjectionAssert`, `TestPolling`, `ModuleConformanceTestsBase<TModule>` and the
  `WebVitalsBudget` added at the v1.142.0 pass, and the per-repo architecture-fitness test classes
  plus the `Gallery` harness), and
- rolls the remaining **1,460** per-suite test classes (including the `MMCA.Common.Benchmarks`
  perf-smoke project) into a **per-project table** (purpose + style:
  unit / integration / fitness / E2E / component / performance-smoke).
Every one of the 1,460 remains individually listed with `file:line` in
[`00-inventory.md`](00-inventory.md). This is the only category of first-party type not given its own
prose section.

### 2.3 Sibling-family grouping (sibling families fold into shared sections)
Near-identical families (per-entity `Add*/Remove*/Update*` commands, `*DTOMapper`, `*CreateRequest`,
`*Validator`, per-type filter strategies, etc.) are taught in one `### A, B, C` section that explains
the shared shape once. **Every** grouped type is still named and cited individually via the section's
`File:Line` table, so citation coverage is complete (this is what `verify.ps1` checks). The 1,804
individually-sectioned types are covered by 1,740 `###` sections; the 64-type difference is family grouping.

---

## 3. Grouping & ordering verification

- **Every type in exactly one group.** `classify.ps1` assigns all 3,264 nodes via name-level overrides
  (for the grab-bag `MMCA.Common.*Interfaces*/Services` namespaces) + ordered namespace-prefix rules;
  it reports **0 unmapped** and the per-group counts sum to 3,264. See
  [`00-group-taxonomy.md`](00-group-taxonomy.md).
- **Within-group ascending Level.** Each chapter's sections were authored from a pre-sorted, Level-
  ascending unit table, so no section precedes a same-group type it depends on (ties broken by name).
- **Cycles kept whole.** **18 of the 19** dependency cycles (SCCs) sit inside a single group, never
  split. The one exception is the 19th, added this pass, and it is not a real cycle: the two
  identically-named `SelfHttpWarmupTask` classes
  (`MMCA.ADC.Engagement.Service/SelfHttpWarmupTask.cs:19`, `G22`, and
  `MMCA.ADC.Identity.Service/SelfHttpWarmupTask.cs:19`, `G23`) are unrelated types in different
  services that neither references the other; the extractor's globally-unique-name fallback cannot
  distinguish them and links each to the other, producing a phantom 2-node SCC whose members sit in
  two different groups. Splitting it across the two service chapters is correct, since each chapter
  teaches its own class. The real cycles were re-verified as whole
  (including the two new in the v1.128.0 pass, both test-only and both wholly in
  [group-27](group-27-testing-infrastructure.md): `MidSaveContextCreatingDbContext` /
  `ReentrantSaveInterceptor` and `FailingSaveInterceptor` / `OutboxRoutingTestDbContext`, all four
  assigned `G25` in `out/00-assigned.csv`):
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
| §20 | Design System, Theming & Consistency | [group-15](group-15-common-ui-framework.md) (incl. day/dark `ThemeService`, [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)) |
| §21 | Accessibility (a11y) | [group-15](group-15-common-ui-framework.md) (developed in group-26/[devops-testing](devops-testing.md)) |
| §22 | Responsive & Cross-Browser/Device | [group-15](group-15-common-ui-framework.md) |
| §23 | Front-End Performance & Rendering | [group-15](group-15-common-ui-framework.md) |
| §24 | Forms, Validation & UX Safety | [group-05](group-05-cqrs-pipeline.md) (developed in groups 06, 15, 21) |
| §25 | Navigation, Routing & Information Architecture | [group-15](group-15-common-ui-framework.md) |
| §26 | Front-End Security | [group-08](group-08-auth.md) |
| §27 | Internationalization & Localization | [group-02](group-02-domain-building-blocks.md) (now multi-locale en-US + es per [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), developed in groups 12/15/20/22/23; note in [primer §6](00-primer.md#6-the-34-category-architecture-evaluation-lens)) |
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
2. **Engine extension points (Cosmos / SQLite) are supported, with a staged first adoption ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)).** All
   *current* production entity configs use the `…SQLServer` base, so in deployed ADC the polyglot paths
   are not yet live. But the polyglot-persistence framework work ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) added the unified engine-aware
   [`EntityTypeConfiguration<T,TId>`](group-07-persistence-ef-core.md#entitytypeconfigurationtentity-tidentifiertype)
   base, the cross-source [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification),
   the Cosmos-index skip in the degrade convention, SQLite `EnsureCreated`, and a fitness rule + new test
   suites (Cosmos config portability, cross-source spec, SQLite init), and ADC Conference's
   `Session`→Cosmos / `Room`→SQLite move is the staged-but-not-yet-deployed first use. The guide documents
   these as real, exercised capabilities with honest adoption notes (see
   [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) and group-07), not yet as
   live production options.
3. **Edge-resolution approximation.** The dependency graph is a *syntactic* (namespace-aware) resolve,
   not a full semantic compiler bind: ~96% of edges bind by namespace visibility (9,543), the rest by a
   globally-unique-name fallback (348 edges), and 28 references are dropped as ambiguous. This is accurate enough
   for the leveling spine but is a documented approximation
   ([manifest accuracy note](00-dependency-manifest.md#edge-resolution--accuracy)).
4. **64 cross-linked types have no section of their own** (measured at the v1.135.0 pass by the
   stricter heading-or-table-cell check described in §1). They are named in prose and, in many cases,
   linked to with a `#anchor` that resolves nowhere: **G07 17** (the `EntityTypeConfiguration`
   family, seeding, encryption, the repository factory, value generators, `IUnitOfWork`,
   `ReadRepositoryExtensions`), **G21 16** (the Conference UI lookup/service contracts),
   **G23 15** (Identity: `ChangePassword`, `DeleteUser`, `ExportUserData`, `ModuleApplicationDbContext`,
   `Profile`, the gRPC adapters), **G18 9**, **G22 5** (the Shared bookmark contracts), **G08 2**.
   The `DbContexts.Factory` family that sat in this list was written at this pass, which is how the
   count fell from 107 to 64. Same-name types (several `DependencyInjection` classes) can hide a hole
   from a name-based check, so 64 is a floor, not an exact figure: one such hole
   (`MMCA.ADC.Identity.Contracts.DependencyInjection`) was found by hand at this pass.
5. **Body drift is not mechanically detectable, and it is real.** A section's declaration citation can
   be corrected from the inventory, but its walkthrough line numbers and its description of behaviour
   cannot. At the v1.135.0 pass, **199** of the 1,556 individually-sectioned types were declared in one
   of the **256** non-test source files that changed since the previous sweep. An adversarial
   spot-check of 8 sections whose declaration line had moved returned **8 DRIFTED**, several with
   inverted behaviour (see the v1.135.0 regeneration note). Eight were repaired at this pass; the rest
   of the 199 have corrected declaration citations but unverified bodies, and should be treated as the
   next pass's first task.

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