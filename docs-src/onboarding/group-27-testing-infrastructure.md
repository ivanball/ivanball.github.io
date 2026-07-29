# 27. Testing & Quality Infrastructure

**What this group covers.** Everything the codebase uses to *prove* itself: the four reusable
test-support packages that ship out of `MMCA.Common/Source/Hosting` (`MMCA.Common.Testing`,
`MMCA.Common.Testing.E2E`, `MMCA.Common.Testing.UI`, `MMCA.Common.Testing.Architecture`, four of the
fifteen published packages listed in `MMCA.Common/FACTS.md:19-36`), the architecture-fitness rule
library that gates the build, the runtime-conformance bases that gate a booted host, the
backend-less component Gallery harness, the BenchmarkDotNet performance suite, and the many per-repo
test projects that consume all of it. The distinction to hold onto while reading: most of the
*types* in this group are reusable **bases, fixtures, harnesses, and helpers** compiled into and
shipped by MMCA.Common, while the concrete `[Fact]`-bearing test classes that subclass them live in
each consumer repo (`MMCA.Common.*.Tests`, `MMCA.ADC.*.Tests`, `MMCA.Store.*.Tests`). Those
individual test classes are cataloged by project in the companion rollup section; this chapter
teaches the *machinery* they stand on. For how the tiers map onto CI jobs and solution filters, see
[Testing Architecture & Solution Composition](devops-testing.md).

There are five moving parts, and they map onto the test pyramid plus one governance layer:

1. **Integration-test scaffolding** ([`IIntegrationTestFixture`](#iintegrationtestfixture),
   [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture),
   [`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint),
   [`ProductionHostApplicationFactory<TEntryPoint>`](#productionhostapplicationfactorytentrypoint),
   [`JwtTokenGenerator`](#jwttokengenerator), [`FeatureManagementTestExtensions`](#featuremanagementtestextensions),
   [`EntityBuilderBase<TBuilder, TEntity>`](#entitybuilderbasetbuilder-tentity)) boots a real service
   host in-process against a throwaway SQL Server database and drives it over HTTP.
2. **Architecture fitness functions** ([`IArchitectureMap`](#iarchitecturemap),
   [`ArchitectureMapBase`](#architecturemapbase), [`Layer`](#layer), [`LayerRef`](#layerref),
   [`ArchitectureAssert`](#architectureassert), [`RuleHelpers`](#rulehelpers),
   [`CrossEntityNavigationFinder`](#crossentitynavigationfinder), the sixteen
   [`ArchitectureRules`](#architecturerules) partial files, and the thirty-one abstract `*TestsBase`
   classes including [`RouteAuthorizationTestsBase`](#routeauthorizationtestsbase) and
   [`BrandColorTokenTestsBase`](#brandcolortokentestsbase)) turn architectural rules into
   build-gating assertions that run identically across every repo.
3. **Component (bUnit) testing** ([`BunitComponentTestBase`](#bunitcomponenttestbase),
   [`TestPrincipal`](#testprincipal), [`BunitInteractionExtensions`](#bunitinteractionextensions),
   [`CapturingHttpMessageHandler`](#capturinghttpmessagehandler),
   [`UiHttpServiceHarness`](#uihttpserviceharness), [`HttpTestDoubles`](#httptestdoubles),
   [`StubTokenStorageService`](#stubtokenstorageservice), [`MarkupSnapshot`](#markupsnapshot))
   render Blazor components in isolation with real MudBlazor services and faked HTTP/auth edges.
4. **End-to-end (Playwright) testing** ([`PlaywrightFixture`](#playwrightfixture),
   [`E2ETestBase`](#e2etestbase), [`E2ETestConfiguration`](#e2etestconfiguration),
   [`PageExtensions`](#pageextensions), [`AxeOptions`](#axeoptions),
   [`AccessibilityViolationException`](#accessibilityviolationexception),
   [`WebVitalsCollector`](#webvitalscollector), the reusable page objects
   [`LoginPage`](#loginpage) / [`RegisterPage`](#registerpage) / [`ProfilePage`](#profilepage), and
   the shipped workflow suites such as [`AuthorizationTestsBase`](#authorizationtestsbase))
   drive a real browser against a running app, asserting accessibility and performance alongside
   behavior.
5. **Contract and pipeline bases** ([`SecurityHeadersTestsBase`](#securityheaderstestsbase),
   [`OpenApiContractTestsBase<TFixture>`](#openapicontracttestsbasetfixture),
   [`ProblemDetailsContractTestsBase<TFixture>`](#problemdetailscontracttestsbasetfixture),
   [`ServiceInfoVersioningContractTestsBase<TFixture>`](#serviceinfoversioningcontracttestsbasetfixture),
   [`GracefulShutdownTestsBase<TEntryPoint>`](#gracefulshutdowntestsbasetentrypoint),
   [`DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult),
   [`HandlerTestBase<THandler>`](#handlertestbasethandler)) pin cross-cutting HTTP and pipeline
   guarantees so a refactor cannot silently drop them.

This whole group is the [Rubric §14, Testability] story made concrete: the framework does not merely
*permit* testing, it ships the reusable substrate so every consumer tests the same way. The
front-end tiers additionally carry [Rubric §21, Accessibility], [Rubric §22,
Responsive/Cross-Browser], [Rubric §23, Front-End Performance], and [Rubric §28, Front-End Testing];
the fitness library carries [Rubric §34, Architecture Governance & Documentation]. Two ADRs govern
the two governance tiers and are worth reading before touching anything here:
[ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) for the
structural rules, and
[ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html) for
the runtime conformance suites that cover exactly what ADR-015 declared out of scope, "structure /
registration, not runtime behavior"
(`Website/docs-src/adr/015-architecture-fitness-functions.md:48`).

## Integration tests: a real host, a throwaway database, a per-test reset

The integration tier boots the actual application, not a mock of it. The abstraction at its center
is [`IIntegrationTestFixture`](#iintegrationtestfixture)
(`MMCA.Common.Testing/IIntegrationTestFixture.cs:8`): a two-method contract, `CreateClient()`
(`IIntegrationTestFixture.cs:11`) and `ResetDatabaseAsync()` (`IIntegrationTestFixture.cs:19`), that
hides how the host and its database are provisioned. Its remarks are load-bearing: a host running
multiple physical data sources (database per service, see
[primer](00-primer.md#2-architectural-styles-this-codebase-commits-to) and
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) must reset **every**
relational source, and a fixture can resolve `IEntityDataSourceRegistry` / `IDataSourceResolver`
from the booted host to enumerate them (`IIntegrationTestFixture.cs:13-18`).

[`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture)
(`MMCA.Common.Testing/IntegrationTestBase.cs:13`) is the per-test base every integration test class
inherits. It implements xUnit's `IAsyncLifetime`, so `InitializeAsync` resets the database before
each test (`IntegrationTestBase.cs:31`) and `DisposeAsync` disposes the HTTP client after
(`IntegrationTestBase.cs:34-39`). It exposes typed HTTP helpers (`GetAsync<T>`, `PostAsync<T>`,
`PutAsync<T>`, `PutAsync`, `DeleteAsync`, `IntegrationTestBase.cs:51-72`), bearer-token management
(`SetBearerToken` / `ClearAuthentication`, `IntegrationTestBase.cs:42-48`), and a thread-safe
`NextId()` counter seeded at 1000 (`IntegrationTestBase.cs:16,75`) so parallel tests never collide
on generated identifiers. Downstream projects subclass it to add domain-specific auth and entity
helpers.

[`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint)
(`MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27`) is the concrete fixture
scaffolding. `InitializeAsync` (`SqlServerIntegrationTestFixtureBase.cs:67`) mints a GUID-suffixed
database name (`:71-72`), sets `ASPNETCORE_ENVIRONMENT=Testing` and the top-level connection string
as **process environment variables** (so the host reads them at configure-time, `:75-77`), builds the
subclass-supplied `WebApplicationFactory` (`:79`), and forces database creation by requesting the
first client, which runs the host's `Migrate` init strategy (`:81-84`). It then builds a Respawn
checkpoint that ignores `__EFMigrationsHistory` (`:90-94`); `ResetDatabaseAsync` (`:99`) replays that
checkpoint between tests, and `DisposeAsync` (`:115`) drops the throwaway database (`:167`) and
restores every pushed environment variable (`:130`, restore loop at `:157-165`, first-value-wins
bookkeeping at `:146-155` so a re-pushed key cannot clobber its own restore point). The `Testing`
environment is chosen deliberately so `appsettings.Development.json` (which points a module's
`DataSources` entry at `localhost`) does not load, leaving the resolver to collapse onto the
overridden top-level connection string, a single-database monolith shape (`:16-24`). Server selection
defaults to LocalDB but is overridable through `SqlBaseEnvironmentVariable` (`:58`, read at `:69-70`)
so CI can target a SQL service container. The fixture also exposes `ConnectionString` (`:45`) so
SQL-fidelity tests can read the raw tables, and `Services` (`:52`) so a cross-service test can
resolve a consumer-side handler out of the booted host. Because these fixtures need a reachable SQL
Server, the per-module `*.Integration.slnf` suites build in a headless sandbox but only *run* in CI.
A host that needs no database gets the second, much smaller boot path:
[`ProductionHostApplicationFactory<TEntryPoint>`](#productionhostapplicationfactorytentrypoint)
(`MMCA.Common.Testing/ProductionHostApplicationFactory.cs:22`) pins `UseEnvironment("Production")`
(`ProductionHostApplicationFactory.cs:36`) so the production-only branches (restrictive CORS, HSTS
emission) are the ones under test, and captures the started `IHost`
(`ProductionHostApplicationFactory.cs:29`) because `StopAsync` is not reachable through the
`WebApplicationFactory` surface at all.

Three helpers round out the tier. [`JwtTokenGenerator`](#jwttokengenerator)
(`MMCA.Common.Testing/JwtTokenGenerator.cs:29`) issues **RS256**-signed tokens (`GenerateToken`,
`JwtTokenGenerator.cs:111`, signing credentials built at `:129-130`) using an embedded dev RSA-2048
keypair (`JwtTokenGenerator.cs:48-95`) under a fixed `kid` of `mmca-test-key` (`:40`), so integration
tests exercise the exact JWKS/RS256 validation code path production runs
([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)); the class
remarks flag, correctly, that the committed keypair is insecure by design and must never be used in
a real deployment (`:21-27`). [`FeatureManagementTestExtensions`](#featuremanagementtestextensions)
(`MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10`) adds a `ConfigureTestFeatureFlags`
extension member (`:21`) that builds an in-memory `FeatureManagement:*` configuration (`:24-32`) so a
test `WebApplicationFactory` can flip a gate without touching `appsettings.json`.
[`EntityBuilderBase<TBuilder, TEntity>`](#entitybuilderbasetbuilder-tentity)
(`MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9`) is a minimal fluent-builder base whose single
abstract `Build()` (`:17`) returns the entity through its domain factory, so test setup specifies
only what a test cares about. Together these embody [Rubric §11, Security] (real token validation
rather than bypassed auth middleware) and [Rubric §14, Testability].

## Architecture fitness functions: rules that gate the build

The layering and DDD conventions this codebase commits to are not left to code review, they are
executed as tests. The reusable rule library lives in `MMCA.Common.Testing.Architecture` and is the
subject of **[ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)**.
Its keystone is [`IArchitectureMap`](#iarchitecturemap)
(`MMCA.Common.Testing.Architecture/IArchitectureMap.cs:39`): the single per-repo boundary every
fitness function keys off. Each repo supplies one implementation (for example
`StoreArchitectureMap`) declaring its layer and module assemblies as [`LayerRef`](#layerref) records
(`IArchitectureMap.cs:31`) tagged by the [`Layer`](#layer) enum (`IArchitectureMap.cs:9`), and
exposes them through query members such as `OfLayer`, `ModuleDomain`, `ModuleApplication`, `For`,
`ModuleOf`, and `OtherModuleNamespaces` (`IArchitectureMap.cs:51-81`). Most of that surface is
derived rather than hand-written: [`ArchitectureMapBase`](#architecturemapbase)
(`MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:11`) computes the projections from a single
`DefineLayers()` declaration (`ArchitectureMapBase.cs:22`, lazily materialized at `:13,15-16,25`),
which also centralizes every assembly and namespace string in one file so Ubuntu CI's case
sensitivity is handled in one place (`ArchitectureMapBase.cs:8-9`); it additionally ships a
`FindRepoRoot(solutionFileName)` walker (`ArchitectureMapBase.cs:79`) so doc- and
config-consistency rules can read committed files no matter what the runner's working directory is.
The shared rules consume *only* the interface, which is why one rule body runs identically across
MMCA.Common, MMCA.Store, MMCA.ADC, and Helpdesk: the map is the only thing that varies. `Layer`
deliberately includes optional layers (`Ui`, `Grpc`, `Contracts`, `ServiceHost`,
`IArchitectureMap.cs:16-19`) that a repo simply omits, so a rule iterating them is vacuously
satisfied with no compile dependency on an absent assembly (`IArchitectureMap.cs:3-8`).

The rule bodies are split across sixteen [`ArchitectureRules`](#architecturerules) partial files
(controllers, entities, events, governance, handlers, handler results, immutability, layers,
localization, localized text, modules, naming, purity, slices, specifications, and transport). The
aggregate-convention rules live inside `ArchitectureRules.Entities.cs` (for example
`DomainExposesAggregateRoots` at `MMCA.Common.Testing.Architecture/ArchitectureRules.Entities.cs:8`,
`AggregateRootsHaveResultFactory` at `:19`, and the generalized `DomainFactoriesReturnResult` at
`:53` that extends the "factories always return `Result<T>`" convention from aggregate roots to
value objects) rather than in a dedicated partial, and are surfaced through
[`AggregateConventionTestsBase`](#aggregateconventiontestsbase)
(`MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:10`). Above the rules sit
the thirty-one abstract `*TestsBase` classes under `Bases/` (`LayerDependencyTestsBase`,
`DomainPurityTestsBase`, `MicroserviceExtractionTestsBase`, `ModuleIsolationTestsBase`,
`PiiConventionTestsBase`, [`DependencyVersionTestsBase`](#dependencyversiontestsbase),
`IntegrationEventContractTestsBase`, `DataResidencyTestsBase`, `RawQueryableConventionTestsBase`,
and more), each exposing its rules as `[Fact]`s that a sealed per-repo subclass activates by
supplying its map. `AggregateConventionTestsBase` shows the shape in miniature: one abstract `Map`
property and one `[Fact]` per rule
(`MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:12-24`). The package ships
**96 test methods across those 31 bases, of which MMCA.Common's own build executes 61**
(`MMCA.Common/FACTS.md:44-48`, a generated and CI-gated count: read it there rather than restating
it elsewhere).

Failures report through [`ArchitectureAssert`](#architectureassert)
(`MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:8`), which has two overloads: one lists the
failing types from a NetArchTest `TestResult` (`ArchitectureAssert.cs:11-23`), the other lists a
reflection-derived violation set (`ArchitectureAssert.cs:26-32`). Rules NetArchTest cannot express
(method return types, generic constraints, property accessors, attribute usage) reflect over loaded
types via the internal [`RuleHelpers`](#rulehelpers)
(`MMCA.Common.Testing.Architecture/RuleHelpers.cs:14`), whose `LoadableTypes` extension property
tolerates a partially resolvable assembly by falling back to the `ReflectionTypeLoadException`'s
resolved types (`RuleHelpers.cs:19-33`), and whose `HasPublicMutableSetter` treats an `init`-only
setter as immutable by checking for the `IsExternalInit` required modifier
(`RuleHelpers.cs:121-137`). One such walk,
[`CrossEntityNavigationFinder`](#crossentitynavigationfinder)
(`MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97`), is an
`ExpressionVisitor` that collects the entity types a specification's criteria navigates to beyond
its own (`ArchitectureRules.Specifications.cs:101-119`), because in a polyglot setup that navigation
may cross a physical data source where the join is not translatable
(`ArchitectureRules.Specifications.cs:9-15`). These runtime rules are the second of two enforcement
layers, the first being the compile-time MSBuild layer guard
(`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets`, see
[group 14](group-14-module-system-composition.md));
[ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) describes
both, and this is the clearest [Rubric §34, Architecture Governance] expression in the codebase.

The fitness library reaches beyond pure layering into cross-cutting product guarantees.
[`RouteAuthorizationTestsBase`](#routeauthorizationtestsbase)
(`MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:22`, tagged rubric §25 in its
own remarks, [Rubric §25, Navigation & IA]) reflects over routable Blazor pages and asserts every
governed page keeps its `[Authorize(Roles = "...")]` gate
(`RouteAuthorizationTestsBase.cs:49-61`), so an admin route cannot regress to a bare `[Authorize]`
any authenticated user can reach. It detects `RouteAttribute` and `AuthorizeAttribute` by full-name
reflection (`RouteAuthorizationTestsBase.cs:24-25`) so the package stays free of ASP.NET references,
and a `MinimumGovernedPages` floor (`:47`, asserted at `:63-74`) guards against a moved namespace
silently emptying the scan. [`BrandColorTokenTestsBase`](#brandcolortokentestsbase)
(`MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:13`, [Rubric §20, Design System
& Theming]) reads landing-page stylesheets embedded as manifest resources and fails the build if a
host re-hardcodes the brand hex `#1565C0` instead of sourcing `var(--mmca-primary)` from the shared
token (`BrandColorTokenTestsBase.cs:15-16,41-49`), with a non-empty check on the embedded list so the
guard cannot pass vacuously (`:27-28`). [`DependencyVersionTestsBase`](#dependencyversiontestsbase)
(`MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:15`, [Rubric §32, Dependency
& Supply-Chain]) parses `Directory.Packages.props` and fails the build on two commercial-license
traps a blanket package bump would otherwise walk into unnoticed: MassTransit at major 9
(`DependencyVersionTestsBase.cs:24-37`,
[ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html)) and
SixLabors.ImageSharp at major 4, whose MSBuild targets fail at *build* time without a license key
(`DependencyVersionTestsBase.cs:47-60`).
[`ConstructorDependencyCountTestsBase`](#constructordependencycounttestsbase)
(`Bases/ConstructorDependencyCountTestsBase.cs:14`) turns the SRP judgement call into a numeric
ceiling on Application-service constructors ([Rubric §1, SOLID]), and
[`ObservabilityConventionTestsBase`](#observabilityconventiontestsbase)
(`Bases/ObservabilityConventionTestsBase.cs:30`) pairs every SLO alert a consumer's
`infra/main.bicep` provisions with a same-severity triage section in its `infra/OPERATIONS.md`, in
both directions ([Rubric §13, Observability & Operability]). Sibling bases pin integration-event
contracts ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)),
data residency, forms conventions, localization resources,
[concurrency](#concurrencyconventiontestsbase), [controller shape](#controllerconventiontestsbase),
and framework-version consistency, so the governance-as-tests pattern spans much of the 34-category
rubric.

## Component tests: real MudBlazor, faked edges

The bUnit tier renders a single Blazor component in-process with its real dependencies but stubbed
network and auth. [`BunitComponentTestBase`](#bunitcomponenttestbase)
(`MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33`) registers MudBlazor services
and puts JSInterop in loose mode so MudBlazor components that probe JS during render do not throw
(`BunitComponentTestBase.cs:42-43`), then wires a **mutable** `AuthenticationStateProvider`
(`BunitComponentTestBase.cs:97`) plus an `IsAuthenticatedAuthorizationService`
(`BunitComponentTestBase.cs:111`) so both `<AuthorizeView>` cascades and pages that inject the
provider directly behave. Tests render anonymously by default via `RenderUnderTest<TComponent>`
(`BunitComponentTestBase.cs:59`) or as a supplied `ClaimsPrincipal` via `RenderAs<TComponent>`
(`BunitComponentTestBase.cs:65`, which sets the provider and the cascading `AuthenticationState`
together at `:70-75`), with a `SetUser` hook (`:56`) for mid-test auth changes and
[`TestPrincipal`](#testprincipal)
(`MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6`) minting the authenticated principal: a
name claim, a `user_id` claim, the requested roles, and an authentication type so `IsAuthenticated`
is true (`TestPrincipal.cs:13-22`). `RenderMudProviders` (`BunitComponentTestBase.cs:83`) mounts the
popover, dialog, and snackbar providers and returns them as a `MudProviderHandles` record
(`BunitComponentTestBase.cs:92`) so components that open a dialog or raise a toast have somewhere to
render. The class is pinned to bUnit v2 (the line compatible with xUnit v3 and Microsoft Testing
Platform) and isolates every version-specific symbol here so a bUnit change touches only this file
(`BunitComponentTestBase.cs:25-31`). Localization is pre-registered (`AddLocalization`,
`BunitComponentTestBase.cs:48-52`) so components injecting `IStringLocalizer<T>`
([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) render without per-test
setup, a [Rubric §27, i18n] touch. Test bodies then read as user actions rather than DOM queries
through [`BunitInteractionExtensions`](#bunitinteractionextensions)
(`MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:12`), a generic
`extension<TComponent>(IRenderedComponent<TComponent>)` block (`:14`) offering `FindButtonByText`
(`:18`, which throws listing every button present when nothing matches), `ClickButtonByText` (`:28`),
and `HasText` (`:32`), all keyed on accessible text rather than brittle CSS paths.

HTTP-backed UI services are exercised without a server through
[`CapturingHttpMessageHandler`](#capturinghttpmessagehandler)
(`MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18`), a canned-response,
request-recording `HttpMessageHandler` supporting both a responder delegate
(`CapturingHttpMessageHandler.cs:38`) and route registration (`SetResponse`,
`CapturingHttpMessageHandler.cs:48`), with registered routes consulted first and unmatched requests
returning 404 to mirror the WebAPI's not-found behavior
(`CapturingHttpMessageHandler.cs:7-17,90-108`); it rebuilds each response fresh so a Polly retry
never reuses a consumed `HttpContent` (`CapturingHttpMessageHandler.cs:112-121`), and records every
request as a `CapturedRequest` (`CapturingHttpMessageHandler.cs:129`) against a registered `Route`
(`CapturingHttpMessageHandler.cs:110`). [`UiHttpServiceHarness`](#uihttpserviceharness)
(`MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:12`) wraps that handler with a
[`FreshApiClientFactory`](#freshapiclientfactory) (`UiHttpServiceHarness.cs:73`) returning a fresh
client per call, which is load-bearing because the UI services dispose the client after each request,
so a caching factory would hand later calls a disposed one (`UiHttpServiceHarness.cs:66-80`), plus a
fixed-token [`StubTokenStorageService`](#stubtokenstorageservice) (`UiHttpServiceHarness.cs:48,61`),
all on a `https://gateway.test/` base address (`UiHttpServiceHarness.cs:15`). Tests that would rather
wire the pieces individually reach for [`HttpTestDoubles`](#httptestdoubles)
(`MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:12`), which exposes the same factory and
token stub standalone (`:23,28`) alongside the canned `JsonResponse`/`EmptyResponse`/`ProblemResponse`
builders (`:33,37,44`) that reproduce the shapes the WebAPI actually emits.
[`MarkupSnapshot`](#markupsnapshot) (`MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21`)
adds dependency-free golden-markup regression testing: `Match` (`MarkupSnapshot.cs:31`) normalizes
the per-render GUIDs MudBlazor injects (`MarkupSnapshot.cs:64-70`), compares against a committed
baseline under `Snapshots/` next to the calling test (located through a `[CallerFilePath]` argument,
`MarkupSnapshot.cs:31,37`), and returns a [`MarkupSnapshotResult`](#markupsnapshotresult)
(`MarkupSnapshot.cs:104`) for the caller to assert on, which keeps the shipped package free of an
assertion-library dependency (`MarkupSnapshot.cs:10-12`). `UPDATE_SNAPSHOTS=1` rewrites baselines
(`MarkupSnapshot.cs:41-46`) and a missing baseline is written but reported as a non-match so a
regression cannot slip through on an absent snapshot (`MarkupSnapshot.cs:48-54`). This tier is
[Rubric §28, Front-End Testing] and [Rubric §18, UI Architecture].

## End-to-end tests: a real browser, accessibility and performance as gates

The E2E tier drives a real browser through Playwright. [`PlaywrightFixture`](#playwrightfixture)
(`MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6`) is an xUnit collection fixture (its
collection definition sits beside it at `PlaywrightFixture.cs:39-43`) that launches the engine
selected from configuration, `chromium`, `firefox`, or `webkit`, with unknown values falling back to
Chromium (`PlaywrightFixture.cs:17-22`). That environment-selected engine is what lets CI run the
same suite as a cross-browser matrix, [Rubric §22, Responsive/Cross-Browser]; in MMCA.Common's
`ui-e2e` job all three engines are required merge gates
(`MMCA.Common/.github/workflows/ci.yml:236-240`). Headless mode, slow motion, base URL, timeouts,
trace capture, and the seeded admin/user credentials all come from
[`E2ETestConfiguration`](#e2etestconfiguration)
(`MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8`), whose nested
`AdminCredentials` (`E2ETestConfiguration.cs:66`) and `UserCredentials`
(`E2ETestConfiguration.cs:78`) let a downstream project set app-specific defaults through a
`[ModuleInitializer]` while environment variables always win. Two of its knobs exist purely to
de-flake CI: `AuthTimeout` (`E2ETestConfiguration.cs:27`) tunes the slowest step, the post-auth
round-trip, independently of the 30-second general default (`:18-19`), and `AuthGraceTimeout`
(`E2ETestConfiguration.cs:38`, default 15 seconds) gives the success signal a window to appear after
a transient error alert flashes during the success-path reload.

[`E2ETestBase`](#e2etestbase) (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:8`) is the
per-test base on top of that fixture. It opens a fresh browser context per test with
`IgnoreHTTPSErrors` and the configured base URL (`E2ETestBase.cs:19-37`), optionally records a
Playwright trace (`:31-34`) and, when `E2E_TRACE` names a directory, keeps only the traces of tests
that failed so a full-suite run yields exactly the inspectable failures (`:55-77`). Its `LoginAsync`
(`E2ETestBase.cs:85`) clears both token stores before signing in (localStorage for the WASM host and
the HttpOnly session cookie for the Server host, `:87-109`), and `WaitForAuthResultAsync` (`:201`)
races three signals so success detection does not depend on the logout button having hydrated
(`:203-213`), treating only an error alert still on the auth page after the grace window as a real
failure (`:217-223`). `ScanAsync` (`:281`) and `ScanGridAsync` (`:271`) wrap the accessibility gate
for settled pages and for MudDataGrid list pages respectively, the latter waiting for a data row and
for the loading bar to disappear before scanning.

The hard part of Blazor E2E is timing, and [`PageExtensions`](#pageextensions)
(`MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:19`) is where that knowledge is
centralized, as C# `extension(IPage)` and `extension(ILocator)` blocks (`PageExtensions.cs:21,185`,
see [primer](00-primer.md#c-extensiont-types--read-this-once)). The app uses InteractiveAuto with
prerendering, so a page appears as static HTML before the runtime wires its event handlers.
`WaitForBlazorAsync` (`PageExtensions.cs:27`) waits for `window.Blazor._internal` then two animation
frames plus a 500 ms settle before any interaction (`PageExtensions.cs:32-40`);
`GotoAndWaitForBlazorAsync` (`:47`) pairs navigation with it and deliberately waits on `Load` rather
than `NetworkIdle`, because the persistent SignalR WebSocket means network idle never arrives
(`:50-52`); `BlazorNavigateAsync` (`:62`) routes client-side so a protected page is not
re-prerendered without its token, polling `window.location` instead of `WaitForURLAsync` because a
same-document navigation fires no load event (`:76-82`); and `GotoProtectedAsync` (`:104`) loads a
public page first when the runtime is not yet up. `FillAndVerifyAsync` (`:197`) fills a field then
auto-waits until the value sticks, retyping character by character if hydration wiped it
(`:212-214`), and `ClickAndVerifyAsync` (`:230`) and `ClickAndWaitForUrlAsync` (`:273`) retry a click
until its visible effect appears so a click that beats hydration is not silently swallowed. These
helpers encode hard-won lessons about the prerender and hydration race and are shared by every page
object.

Accessibility and performance are asserted here, not deferred to a separate audit.
`AssertNoAccessibilityViolationsAsync` (`PageExtensions.cs:157`) runs an axe-core scan and throws
[`AccessibilityViolationException`](#accessibilityviolationexception)
(`MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7`) with a compact
per-node summary of every violation (`PageExtensions.cs:170-181`), so an inaccessible page fails the
build, [Rubric §21, Accessibility]. The scan scope itself is shipped as [`AxeOptions`](#axeoptions)
(`MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9`): `Wcag21Aa` (`AxeOptions.cs:17`) pins the
documented target of WCAG 2.1 AA tags (`AxeOptions.cs:19-23`) and deliberately excludes axe's
advisory best-practice rules, and `Wcag21AaExceptMudPagerCombobox` (`AxeOptions.cs:35`) is the one
documented carve-out, disabling only `aria-input-field-name` for MudBlazor 9.6.0's unlabeled pager
select (`AxeOptions.cs:26-33,42-45`). [`WebVitalsCollector`](#webvitalscollector)
(`MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:17`) installs
`PerformanceObserver`-based Core Web Vitals capture (LCP, CLS, FCP, TTFB, INP) as an init script
before first paint (`InstallAsync`, `WebVitalsCollector.cs:37`, script at `:23-32`), reads the
accumulated values back as a [`WebVitalsSample`](#webvitalssample) (`CollectAsync`,
`WebVitalsCollector.cs:44,73`), and writes a citable JSON artifact under `WEB_VITALS_OUTPUT_DIR`
(`WriteArtifactAsync`, `WebVitalsCollector.cs:60`) for CI, [Rubric §23, Front-End Performance] (the
source tags it rubric §12). LCP and CLS are Chromium-only, so on Firefox and WebKit those fields stay
0 and the observers fail silently rather than throwing (`WebVitalsCollector.cs:12-15,19-22`). The
reusable identity page objects [`LoginPage`](#loginpage)
(`MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6`), [`RegisterPage`](#registerpage)
(`MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:6`), and [`ProfilePage`](#profilepage)
(`MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:6`) wrap the framework's real auth surfaces with
role- and label-based locators (`LoginPage.cs:12-18`) and route their own fills through the anti-race
helper (`LoginPage.cs:31-32`, invoked at `:25-26`); downstream apps add their own family, for example
the `MMCA.ADC.E2E.Tests` page objects for events, sessions, speakers, rooms, questions, and feedback.
Whole *workflows* ship too, not just page objects: six abstract suites under
`MMCA.Common.Testing.E2E/Workflows/` (`AuthorizationTestsBase`, `UserLoginTestsBase`,
`UserRegistrationTestsBase`, `LogoutTestsBase`, `ProfileManagementTestsBase`, and
`UserPreferencesTestsBase`) are authored once and re-run per consumer. Their shape is the same
supply-only-your-facts contract as the fitness bases:
[`AuthorizationTestsBase`](#authorizationtestsbase)
(`MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:18`) asks the subclass only
for its route lists (`ProtectedPaths` `:26`, `PublicPaths` `:29`, optional `AuthenticatedUserPath`
`:35` and `AdminPaths` `:44`) and owns the assertions, including the non-empty guard that keeps the
anonymous-redirect check from passing vacuously (`:49-50`).

## The Gallery harness

Component and E2E coverage of MMCA.Common's *own* UI needs a page to render, but the framework is not
a runnable app. `MMCA.Common.UI.Gallery` is a deliberately backend-less Blazor host that renders the
real `MMCA.Common.UI` auth pages (`/login`, `/register`), the shared notification pages, and a
primitives showcase (`/components`), so a real-browser axe scan can run inside MMCA.Common's own CI
(`MMCA.Common.UI.Gallery/GalleryHost.cs:15-19`, host built by `BuildApp` at `:28`). It is kept
**outside** `MMCA.Common.slnx` (together with `MMCA.Common.UI.E2E.Tests`) so the unit-test run stays
fast; the CI `ui-e2e` job builds both by csproj path and scans the gallery
(`MMCA.Common/.github/workflows/ci.yml:223-227,260-264`). Because the E2E suite self-hosts it
in-process, where the entry assembly is the test host and the environment is Production, the host
also has to point the static-web-assets loader at the gallery's own runtime manifest and force it on,
otherwise the auth pages render unstyled, never become interactive, and axe's contrast checks are
meaningless (`GalleryHost.cs:38-48`).

The host runs without a backend by registering stubs before `AddUIShared` so its `TryAdd*`
registrations defer to them (`GalleryHost.cs:55-63`): [`NoOpAuthUIService`](#noopauthuiservice),
[`NullTokenStorageService`](#nulltokenstorageservice)
(`MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:10`),
[`NullTokenRefresher`](#nulltokenrefresher)
(`MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:9`), and
[`GalleryAuthenticationStateProvider`](#galleryauthenticationstateprovider), plus canned notification
services ([`StubNotificationInboxUIService`](#stubnotificationinboxuiservice),
[`StubPushNotificationUIService`](#stubpushnotificationuiservice)) so the bell and the inbox render
populated markup (`GalleryHost.cs:78-80`), and one empty
[`GalleryUIModule`](#galleryuimodule) (`GalleryHost.cs:85`) so the shared Router discovers the
gallery's own page alongside the real ones. Because the notification pages carry a real
`[Authorize]` that `MapRazorComponents` surfaces as endpoint metadata, the gallery also needs a
genuine authentication scheme: [`GalleryFakeAuthenticationHandler`](#galleryfakeauthenticationhandler)
(`MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:19`, registered at
`GalleryHost.cs:69-73`) authenticates only requests carrying the `gallery_auth=1` cookie
(`GalleryFakeAuthenticationHandler.cs:26,30-39`), so the guarded pages are scanned signed in while
`/login`, `/register`, and `/components` are scanned in their deliberate anonymous state
(`GalleryFakeAuthenticationHandler.cs:8-18`). The gallery is also where the i18n evidence is
produced: it enables the `qps-Ploc` pseudo-locale unconditionally (`GalleryHost.cs:94-103`), which
real hosts keep Development-only, because the pseudo-localization pass is a required CI gate for
[Rubric §27, i18n] and this host is unpackaged test infrastructure that is never deployed.

## Contract, pipeline, and benchmark bases

The last family pins guarantees that live in the composition of the stack rather than in any one
type, and it is the subject of
**[ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html)**:
these suites ship in `MMCA.Common.Testing` as abstract behavioral bases and every one of them runs
against a host that was actually booted. [`SecurityHeadersTestsBase`](#securityheaderstestsbase)
(`MMCA.Common.Testing/SecurityHeadersTestsBase.cs:16`, [Rubric §11, Security] and [Rubric §26,
Front-End Security]) probes an always-responding endpoint (`ProbePath`, default `/alive`,
`SecurityHeadersTestsBase.cs:19`) and asserts the hardened header set: `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a
`Permissions-Policy` containing `geolocation=()`, a `Content-Security-Policy` containing
`frame-ancestors 'none'`, and, in the Production environment, HSTS
(`SecurityHeadersTestsBase.cs:29-35`). Its siblings
[`OpenApiContractTestsBase<TFixture>`](#openapicontracttestsbasetfixture)
(`MMCA.Common.Testing/OpenApiContractTestsBase.cs:21`, with a `MinimumPathCount` floor at `:37`, a
pinned `CorePublicResources` list at `:50`, and deliberately no committed snapshot file so a new
controller can never leave a stale baseline behind, `:14-16`),
[`ProblemDetailsContractTestsBase<TFixture>`](#problemdetailscontracttestsbasetfixture)
(`MMCA.Common.Testing/ProblemDetailsContractTestsBase.cs:21`, asserting the RFC 9457 shape across
both error-shaping paths, model validation at `:30` and the framework's `HandleFailure` mapping at
`:42`, through one shared `AssertProblemDetailsShapeAsync` at `:67`), and
[`ServiceInfoVersioningContractTestsBase<TFixture>`](#serviceinfoversioningcontracttestsbasetfixture)
(`MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19`, driving `/ServiceInfo` at both
`api-version: 1.0` and `2.0` and checking the deprecated/supported reporting headers at `:38,:54`)
all subclass [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) and pin the
corresponding API contracts, [Rubric §9, API & Contract Design]. The non-HTTP member of the family is
[`GracefulShutdownTestsBase<TEntryPoint>`](#gracefulshutdowntestsbasetentrypoint)
(`MMCA.Common.Testing/GracefulShutdownTestsBase.cs:24`, [Rubric §29, Resilience & Business
Continuity]): it boots a host through `ProductionHostApplicationFactory`, calls a real
`IHost.StopAsync` under a bounded token defaulting to 20 seconds (`:28,:55-56`), and asserts
`ApplicationStopping` then `ApplicationStopped` fired (`:58-61`). The failure it catches, a hosted
service that refuses to drain, is invisible in production until it wedges a rolling deploy.

Two bases guard the CQRS pipeline itself.
[`DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult)
(`MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:36`) is the opt-in fitness function for
[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html): it builds a real
`ServiceCollection` through the repo's own registration sequence (`ConfigureServices`, `:44`),
resolves the decorated handlers, unwraps each decorator's private inner-handler field by reflection
so it verifies the constructed object graph rather than the registration list (`:98-118`), and asserts
the runtime nesting is exactly FeatureGate, Logging, Caching, Validating, Transactional, handler for
commands and FeatureGate, Logging, Caching, handler for queries
(`DecoratorPipelineOrderTestsBase.cs:47-62`, asserted by the two `[Fact]`s at `:64-70`). Because
Scrutor's `TryDecorate` applies decorators in reverse registration order, an innocent-looking reorder
of the `AddApplicationDecorators()` lines silently changes runtime behavior, and this base turns that
into a test failure (see [group 5](group-05-cqrs-pipeline.md)).
[`HandlerTestBase<THandler>`](#handlertestbasethandler)
(`MMCA.Common.Testing/HandlerTestBase.cs:38`) is the fast unit-tier counterpart for exercising a
single handler without a host: it owns a `Mock<IUnitOfWork>` whose `SaveChangesAsync` is
pre-configured to succeed (`HandlerTestBase.cs:41-42,45`), a `NullLogger<THandler>` (`:48`), and
`RegisterRepository<TEntity, TIdentifierType>()` (`:56`) / `RegisterReadRepository<TEntity,
TIdentifierType>()` (`:72`) helpers that wire a repository mock into the read and write accessors
(the read-only variant exists for child entities, which expose no read-write repository).

A smaller fourth tier measures rather than asserts behavior. `MMCA.Common.Benchmarks`
(BenchmarkDotNet) covers the per-request query pipeline, where the dynamic-LINQ predicate is
re-parsed per call and the shaper reflects over DTO properties
(`MMCA.Common.Benchmarks/QueryPipelineBenchmarks.cs:9-17`), and the specification hot path
(`MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:8-14`), both with `[MemoryDiagnoser]` allocation
tracking. Its results are compared in CI by `build/perfgate` against the committed
`MMCA.Common/Tests/Performance/perf-baseline.json`
(`MMCA.Common/.github/workflows/ci.yml:371`), so moving a number has to be a deliberate, reviewed
change, [Rubric §12, Performance & Scalability]. The same job family carries one more quiet gate
worth knowing: the unit run is invoked with `--minimum-expected-tests 2000`
(`MMCA.Common/.github/workflows/ci.yml:144`), so a discovery regression that silently drops thousands
of tests fails the build instead of reporting a green, empty run.

The takeaway for a new engineer: pick the tier that matches what you are proving (a fast unit test
for domain logic, bUnit for a component, an integration fixture for a full request path, an E2E page
object for a browser flow, a `*TestsBase` subclass for an architectural invariant, a contract base
for a runtime guarantee of the composed host, a benchmark for an allocation budget), and the reusable
base you need is already in one of the four `MMCA.Common.Testing.*` packages. Adoption is opt-in per
host in both governance tiers, which is the standing caveat in ADR-015 and ADR-058 alike: the
framework ships the gate, a host gets it only once someone writes the subclass. Every remaining
concrete test class is cataloged by project in the companion per-project test rollup for this chapter.

### EntityBuilderBase<TBuilder, TEntity>
> MMCA.Common.Testing · `MMCA.Common.Testing.Builders` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9` · Level 0 · class (abstract)

- **What it is**: the tiny root of the framework's fluent test-data builders. A subclass fixes sensible
  defaults for one entity type so a test only has to state the properties it actually cares about, then
  calls `Build()` to materialize the entity through its real domain factory.
- **Depends on**: nothing first-party, and no BCL surface beyond `object`. Two type parameters and one
  abstract method is the whole type (`EntityBuilderBase.cs:9-18`).
- **Concept introduced, the Test Data Builder plus the self-referencing generic (CRTP).**
  `[Rubric §14, Testability]` assesses how easily the code can be exercised in isolation; a builder base
  is a textbook §14 affordance, it removes the copy-pasted setup that otherwise bloats every arrange
  step. The signature `EntityBuilderBase<TBuilder, TEntity> where TBuilder : EntityBuilderBase<TBuilder,
  TEntity>` (`EntityBuilderBase.cs:9-10`) is the curiously-recurring template pattern: a concrete builder
  passes *itself* as `TBuilder`, so the `WithX(...)` methods a subclass adds can return the concrete
  builder type and keep a fluent chain strongly typed without a cast.
- **Walkthrough**
  - `Build()` (`EntityBuilderBase.cs:17`): the single abstract member. The XML doc
    (`EntityBuilderBase.cs:12-15`) records the contract, the subclass calls the entity's
    [`Result`](group-01-result-error-handling.md#result)-returning factory
    ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)) and throws if it failed, so
    a builder never yields a domain object that violated its invariants. The base deliberately owns no
    state and no default `WithX` helpers, those live on each concrete builder because defaults are
    per-entity.
- **Why it's built this way**: keeping the base to one abstract method means it adds zero coupling and
  zero opinions beyond "a builder produces a `TEntity`". The CRTP is the only structural rule it
  enforces, and it exists purely so fluent chaining stays type-safe down in the subclasses.
- **Where it's used**: the domain-test builders in both apps subclass it, for example
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Domain.Tests/Builders/EventBuilder.cs:10`,
  `.../Builders/SessionBuilder.cs:10`, `.../Builders/SpeakerBuilder.cs:10`,
  `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/Builders/UserBuilder.cs:10`,
  `MMCA.Store/Tests/Modules/Catalog/MMCA.Store.Catalog.Domain.Tests/Builders/CategoryBuilder.cs:10`,
  `.../Builders/ProductBuilder.cs:10`,
  `MMCA.Store/Tests/Modules/Identity/MMCA.Store.Identity.Domain.Tests/Builders/CustomerBuilder.cs:11`,
  and `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Domain.Tests/Builders/OrderBuilder.cs:11`.
- **Caveats / not-in-source**: the "throws on failure" and "sensible defaults" behavior is documented on
  the base but implemented only in those subclasses, which live outside this unit.

### FeatureManagementTestExtensions
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10` · Level 0 · class (static)

- **What it is**: a one-method helper that lets an integration-test host force feature-flag values,
  overriding whatever `appsettings.json` would otherwise resolve, so a test can pin a flag on or off and
  assert both branches of a feature-gated command or query.
- **Depends on**: BCL and NuGet only, `IServiceCollection` and `IConfiguration` from
  `Microsoft.Extensions.*` plus `AddFeatureManagement` from `Microsoft.FeatureManagement`
  (`FeatureManagementTestExtensions.cs:1-3`). No first-party dependency.
- **Concept**: this is the test-side counterpart to the framework's
  [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
  the outermost link in the CQRS pipeline (taught in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)). `[Rubric §14, Testability]`
  again: a gated handler is only meaningfully testable if a test can flip its flag deterministically.
  `[Rubric §10, Cross-Cutting]` applies too, feature management
  ([ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)) is a cross-cutting
  concern, and this helper keeps its test-time configuration in one reusable place.
- **Walkthrough**
  - The whole class body is a single C# preview `extension(IServiceCollection services)` block
    (`FeatureManagementTestExtensions.cs:12`), the same extension-member style the framework uses for DI
    registration (see [primer §4](00-primer.md#c-extensiont-types-read-this-once)), not a classic
    `this`-parameter extension method.
  - `ConfigureTestFeatureFlags(Dictionary<string, bool> features)`
    (`FeatureManagementTestExtensions.cs:21-35`): projects each name-to-bool pair into an in-memory
    configuration key under the `FeatureManagement:` section (`:24-29`), registers that `IConfiguration`
    as a singleton (`:31`), calls `AddFeatureManagement` against the section (`:32`), and returns the
    collection for chaining (`:34`).
- **Why it's built this way**: pushing overrides through the real `IConfiguration` plus
  `AddFeatureManagement` path (rather than mocking an `IFeatureManager`) means the test exercises the
  same feature-evaluation code the production host runs, only the source of the flag value changes.
- **Where it's used**: it is intended for a test `WebApplicationFactory`'s `ConfigureServices`, and the
  XML doc says exactly that (`FeatureManagementTestExtensions.cs:14-18`).
- **Caveats / not-in-source**: as of this pass **no first-party caller exists**. A workspace-wide search
  finds `ConfigureTestFeatureFlags` only at its definition; every other hit is documentation. It ships in
  the package as available capability, not as a technique any suite currently uses.

### IIntegrationTestFixture
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/IIntegrationTestFixture.cs:8` · Level 0 · interface

- **What it is**: the contract every integration-test fixture implements, the two capabilities a test
  base needs from a booted host: hand me an `HttpClient`, and reset the database to clean between tests.
- **Depends on**: BCL only (`HttpClient`, `Task`). No first-party dependency, which is what lets it sit
  at Level 0 and be referenced by everything above it.
- **Concept introduced, the test fixture as an abstraction boundary.** `[Rubric §14, Testability]`: by
  depending on this interface rather than a concrete `WebApplicationFactory`, the reusable
  [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) stays host-agnostic, and each
  downstream app supplies its own concrete fixture with its own `Program`, JWT keys, and data sources.
  This is the boundary that keeps the shared test scaffolding in `MMCA.Common.Testing` and the
  app-specific wiring in each repo, which is the whole premise of
  [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html).
- **Walkthrough**
  - `CreateClient()` (`IIntegrationTestFixture.cs:11`): returns an `HttpClient` configured for the
    in-process test server.
  - `ResetDatabaseAsync()` (`IIntegrationTestFixture.cs:19`): resets the database between tests (the doc
    names Respawn as the typical mechanism). The doc comment (`IIntegrationTestFixture.cs:13-18`) records
    a load-bearing rule for the database-per-service topology
    ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)): a host with multiple
    physical data sources must reset **every** relational source, and can enumerate them by resolving
    [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry) and
    [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver) from the host's services.
- **Why it's built this way**: two members, no state, no host coupling. The interface is deliberately
  minimal so the reset strategy (single database versus multi-source) is the fixture's problem, not the
  base's.
- **Where it's used**: implemented by
  [`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint)
  (`SqlServerIntegrationTestFixtureBase.cs:27`) and through it by every per-service fixture in both apps;
  consumed as the `TFixture` constraint on [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture)
  (`IntegrationTestBase.cs:14`) and therefore by all three contract bases in this unit.

### JwtTokenGenerator
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:29` · Level 0 · class (static)

- **What it is**: a static factory that mints signed JWT bearer tokens for integration tests, so a test
  can call an authorized endpoint as any role or user without standing up the real login flow. Each
  downstream project wraps it with role-specific convenience methods (AdminToken, OrganizerToken, and so
  on, `JwtTokenGenerator.cs:10-11`).
- **Depends on**: BCL and NuGet only, `System.Globalization`, `System.IdentityModel.Tokens.Jwt`,
  `System.Security.Claims`, `System.Security.Cryptography` (RSA), and `Microsoft.IdentityModel.Tokens`
  (`JwtTokenGenerator.cs:1-5`). The generated claim layout mirrors the framework's
  [`ITokenService`](group-08-auth.md#itokenservice) so downstream auth middleware cannot tell a test
  token from a real one (`JwtTokenGenerator.cs:97-102`). The `userId` parameter is typed
  `UserIdentifierType` (`JwtTokenGenerator.cs:113`), the solution-wide identifier alias
  ([ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)).
- **Concept introduced, exercising the real RS256/JWKS path in tests.** `[Rubric §11, Security]` assesses
  how authentication and key handling are done; the deliberate choice here is that tests sign with
  **RS256** (`SecurityAlgorithms.RsaSha256`, `JwtTokenGenerator.cs:130`) using an embedded RSA-2048 dev
  keypair, the *same* asymmetric algorithm production uses, so integration tests run the identical
  JWKS/RS256 validation code path
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), taught in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) rather than a weaker HMAC
  shortcut. `[Rubric §14, Testability]` covers the ergonomics: deterministic tokens with no per-run key
  generation.
- **Walkthrough**
  - Public constants (`JwtTokenGenerator.cs:32-95`): `DefaultIssuer` (`https://localhost:6001`, line 32),
    `DefaultKeyId` (`mmca-test-key`, line 40, the `kid` the host advertises on its JWKS document), and
    the paired `DefaultPublicKeyPem` (line 48) and `DefaultPrivateKeyPem` (line 67). The class doc records
    the wiring contract: test host appsettings set `Jwt:SigningAlgorithm=RS256`, `Jwt:RsaPublicKeyPem`,
    and `Jwks:KeyId` (`JwtTokenGenerator.cs:17-19`) so
    [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) publishes a JWKS entry with the matching `kid`.
    The private key is public on purpose (`JwtTokenGenerator.cs:59-66`): `JwtSettings.Validate` insists on
    a non-empty private key when `SigningAlgorithm=RS256`, so a test host has to be able to reference it.
  - `GenerateToken(...)` (`JwtTokenGenerator.cs:111-152`): imports the PEM private key into
    `RSAParameters` inside a `using` so the `RSA` instance can be disposed without invalidating the key
    held by `SigningCredentials` (`:120-130`), assembles the standard claim set
    (`ClaimTypes.NameIdentifier`, `user_id`, `ClaimTypes.Role`, all culture-invariant) plus any
    caller-supplied extras (`:132-142`), and writes a one-hour token (`:144-151`). Defaulted parameters
    mean a caller normally passes only audience, user id, and role (`:112-118`).
- **Why it's built this way**: the whole point is fidelity. Tokens are indistinguishable in shape and
  signing algorithm from production, so auth middleware, JWKS discovery, and role checks are all under
  test, not stubbed.
- **Where it's used**: applied to a client through
  [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture)'s `SetBearerToken(...)`
  (`IntegrationTestBase.cs:42-44`), and wrapped by each app's role-specific token helpers.
- **Caveats / not-in-source**: the class doc (`JwtTokenGenerator.cs:21-27`) carries an explicit security
  warning, the embedded keypair is committed to the public git repo and is insecure by design, it exists
  only to make integration tests deterministic. Production keys are provisioned via user-secrets or Azure
  Key Vault per `JwtSettings.RsaPrivateKeyPem` and must never be this keypair.

### ProductionHostApplicationFactory<TEntryPoint>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ProductionHostApplicationFactory.cs:22` · Level 0 · class

- **What it is**: the database-free boot path for host-level tests. It is a `WebApplicationFactory` that
  pins the hosting environment to `Production` and hangs on to the started `IHost`, so a test can both
  exercise production-only middleware branches and drive the host's own lifetime.
- **Depends on**: `Microsoft.AspNetCore.Mvc.Testing`'s `WebApplicationFactory<TEntryPoint>` (extended,
  `ProductionHostApplicationFactory.cs:22`) and `Microsoft.Extensions.Hosting`'s `IHost` / `IHostBuilder`
  (`ProductionHostApplicationFactory.cs:1-2`). No first-party dependency.
- **Concept introduced, the second boot path.** The integration tier has two ways to get a running host:
  [`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint)
  for hosts that need a real database, and this one for hosts that do not (a YARP reverse-proxy gateway
  is the usual case, `ProductionHostApplicationFactory.cs:16-19`). Both are named as the two paths in
  [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html).
  `[Rubric §11, Security]` is the reason `Production` is pinned: the restrictive CORS policy, HSTS
  emission, and other production-only middleware are branches a default `Development` boot skips
  entirely, which is exactly where host misconfiguration hides
  (`ProductionHostApplicationFactory.cs:9-12`). `[Rubric §14, Testability]` covers the second half,
  capturing the host is what makes a lifetime test possible at all.
- **Walkthrough**
  - `StartedHost` (`ProductionHostApplicationFactory.cs:29`): a public property with a private setter,
    nullable because `WebApplicationFactory` builds its host lazily, so it stays null until the first
    client is created (`:25-28`).
  - `CreateHost(IHostBuilder builder)` (`ProductionHostApplicationFactory.cs:32-39`): null-guards the
    builder (`:34`), calls `builder.UseEnvironment("Production")` (`:36`), then assigns and returns
    `base.CreateHost(builder)` (`:37-38`). Three lines of override, and the assignment is the entire
    reason the class exists.
- **Why it's built this way**: `IHost.StopAsync` is not reachable through the `WebApplicationFactory`
  surface alone (`ProductionHostApplicationFactory.cs:12-14`), so a graceful-shutdown test has no handle
  to pull without this capture. The class is deliberately left unsealed and non-abstract so it can be
  used directly as an xUnit `IClassFixture<...>` with no subclass.
- **Where it's used**: as the default factory of
  [`GracefulShutdownTestsBase<TEntryPoint>`](#gracefulshutdowntestsbasetentrypoint)
  (`GracefulShutdownTestsBase.cs:31`), and directly as the class fixture of both gateway security-header
  tests (`MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/SecurityHeadersTests.cs:11-12`,
  `MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:11-12`).
- **Caveats / not-in-source**: the doc is explicit that a host which migrates or seeds on startup needs
  its own fixture (`ProductionHostApplicationFactory.cs:16-19`); this factory does nothing about a
  database.

### SecurityHeadersTestsBase
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/SecurityHeadersTestsBase.cs:16` · Level 0 · class (abstract)

- **What it is**: a one-test conformance base that asserts a booted host emits the hardened set of
  security response headers on every response, so a later pipeline refactor cannot silently drop them.
  Authored once, re-run as a thin subclass per host under test.
- **Depends on**: `AwesomeAssertions` and `Xunit` (`SecurityHeadersTestsBase.cs:1-2`). It deliberately
  does **not** extend [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture): it needs only an
  `HttpClient`, so it takes one through an abstract factory rather than inheriting the SQL fixture
  machinery.
- **Concept**: a runtime conformance check on the HTTP edge. `[Rubric §11, Security]` and
  `[Rubric §26, Front-End Security]` both assess defense in depth at the edge; this test pins the exact
  header values the shared `AddCommonSecurityHeaders` / `UseCommonSecurityHeaders` middleware (see
  [`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware),
  [ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)) is expected to emit.
  `[Rubric §14, Testability]` covers the reusable-base shape.
- **Walkthrough**
  - `ProbePath` (`SecurityHeadersTestsBase.cs:19`): overridable, defaults to `/alive` because the
    liveness endpoint always answers independent of any backend being reachable, so the header check is
    never flaky for the wrong reason (rationale in the class doc, `:12-14`).
  - `AliveResponse_CarriesHardenedSecurityHeaders` (`SecurityHeadersTestsBase.cs:21-36`): the single
    `[Fact]`. It GETs `ProbePath` (`:26-27`, threading `TestContext.Current.CancellationToken`) and
    asserts six headers (`:29-35`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
    `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` containing
    `geolocation=()`, a `Content-Security-Policy` containing `frame-ancestors 'none'`, and (because the
    host under test boots in the Production environment) an HSTS `Strict-Transport-Security` header with
    a `max-age=`.
  - `CreateClient()` (`SecurityHeadersTestsBase.cs:42`): abstract, the subclass supplies it from its
    `WebApplicationFactory` class fixture. `Header(...)` (`:44-45`) is the private helper that joins a
    header's values or returns null when the header is absent, which is what makes a missing header fail
    with a readable null-versus-expected message.
- **Why it's built this way**: pinning literal header values (not just presence) turns "we harden
  responses" into an executable, per-host guarantee, and probing `/alive` keeps the test independent of
  application state. Booting the subclass fixture in Production is what makes the HSTS assertion valid,
  which is why the two adopters pair it with
  [`ProductionHostApplicationFactory<TEntryPoint>`](#productionhostapplicationfactorytentrypoint).
- **Where it's used**: both gateway hosts subclass it with a single `CreateClient` override,
  `MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/SecurityHeadersTests.cs:11-14` and
  `MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:11-12`.

### DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:36` · Level 1 · class (abstract)

- **What it is**: an opt-in conformance base that builds a real `ServiceCollection` through a repo's own
  registration sequence, resolves the decorated command and query handlers out of the built provider, and
  asserts the *runtime object graph* nests the decorators in exactly the
  [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) order.
- **Depends on**:
  [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) from
  `MMCA.Common.Application.UseCases` (`DecoratorPipelineOrderTestsBase.cs:4`), plus `System.Reflection`,
  `Microsoft.Extensions.DependencyInjection`, `AwesomeAssertions`, and `Xunit` (`:1-5`).
- **Concept introduced, verifying a decorator chain by unwrapping the constructed graph.** The decorator
  pipeline itself is taught in
  [group-05](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult); what is new here is *how
  you prove it*. Scrutor's `TryDecorate` applies decorators in **reverse registration order**, so the
  outermost decorator is the last one registered, and an innocent-looking reorder of the
  `AddApplicationDecorators()` lines (or a module scan that runs after it) silently changes runtime
  behavior with no compile error (class doc, `DecoratorPipelineOrderTestsBase.cs:15-18`). Rather than
  inspecting the registration list, this base resolves the service and walks the real chain by reflection
  (`:27-30`). `[Rubric §6, CQRS & Event-Driven]` assesses whether the command/query pipeline is coherent
  and intentional; `[Rubric §2, Design Patterns]` assesses correct application of the decorator pattern;
  `[Rubric §14, Testability]` covers turning an ordering convention into an executable check; and
  `[Rubric §34, Architecture Governance & Documentation]` covers the fact that a decision record is
  enforced here rather than merely written down. It is also the one non-HTTP member of the
  [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html)
  conformance tier.
- **Walkthrough**
  - Four type parameters (`DecoratorPipelineOrderTestsBase.cs:32-35`): a representative command with its
    `TResult` and a representative query with its `TResult`, each of which must have a concrete
    registered handler.
  - `ConfigureServices(IServiceCollection services)` (`DecoratorPipelineOrderTestsBase.cs:44`): the one
    abstract member. The subclass registers test doubles for the decorator dependencies (`IFeatureManager`,
    [`ICorrelationContext`](group-12-api-hosting-mapping.md#icorrelationcontext),
    [`ICacheService`](group-09-caching.md#icacheservice),
    [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `ILogger<>`) and then runs the repo's
    real registration sequence, module scans first and `AddApplicationDecorators()` last (doc `:19-26`).
  - `ExpectedCommandDecorators` (`:47-54`) pins, outermost first,
    [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
    [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult),
    [`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult),
    [`ValidatingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult),
    [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult).
    `ExpectedQueryDecorators` (`:57-62`) pins FeatureGate, Logging, Caching, the query pipeline having
    neither validation nor a transaction. Both are `virtual`, so a host with a deliberately different
    chain can narrow them.
  - The two `[Fact]`s, `CommandPipeline_NestsDecorators_InAdr014Order` (`:64-66`) and
    `QueryPipeline_NestsDecorators_InAdr014Order` (`:68-70`), each hand the closed handler interface and
    the expected list to `AssertPipeline`.
  - `AssertPipeline` (`:72-91`): builds the collection, builds a provider, opens a scope (handlers are
    scoped, `:77-78`), resolves the outermost handler and asserts it is non-null with a message that
    tells the subclass author what is missing (`:80-82`). It then unwraps the chain, maps each link to a
    simple type name, and asserts every element *except the last* equals the expected decorator list in
    order (`:84-87`), finally asserting the innermost element does **not** end in `Decorator`, that is,
    it is the concrete handler (`:89-90`).
  - `UnwrapChain` (`:98-118`): walks outermost to innermost by reflecting over each object's instance
    fields (public and non-public) and picking the first value that implements the same closed handler
    interface and is not the object itself (`:105-108`), which is how it finds the compiler-generated
    backing field holding the inner handler. `SimpleTypeName` (`:120-125`) strips the generic-arity
    backtick suffix so a two-arity `LoggingCommandDecorator` compares as the plain name.
- **Why it's built this way**: asserting the constructed object graph is strictly stronger than asserting
  the registration list, it catches a decorator that was registered but never applied (for example
  because a module scan re-registered the handler afterwards). Comparing simple type names keeps the base
  free of a compile-time reference to the decorator classes, which live in `MMCA.Common.Application`.
- **Where it's used**: three subclasses today. MMCA.Common self-tests the base against its own
  registration sequence with a synthetic `PingCommand` / `PingQuery` pair
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:21-36`), and both
  apps subclass it in their architecture tiers over the real Identity pair
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:26`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:26`).
- **Caveats / not-in-source**: each subclass pins one representative command/query pair, not every
  handler, so the guard proves the *ordering* is right, not that every handler is decorated.

### GracefulShutdownTestsBase<TEntryPoint>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/GracefulShutdownTestsBase.cs:24` · Level 1 · class (abstract)

- **What it is**: a shutdown conformance base. It boots a real host, calls a real `IHost.StopAsync` under
  a bounded cancellation token, and asserts the host drained cleanly, firing `ApplicationStopping` and
  then `ApplicationStopped` inside the timeout.
- **Depends on**:
  [`ProductionHostApplicationFactory<TEntryPoint>`](#productionhostapplicationfactorytentrypoint)
  (`GracefulShutdownTestsBase.cs:31`), plus `Microsoft.Extensions.Hosting`'s `IHost` /
  `IHostApplicationLifetime`, `Microsoft.Extensions.DependencyInjection`, `AwesomeAssertions`, and `Xunit`
  (`:1-4`).
- **Concept introduced, the bounded-stop drain check.** `[Rubric §29, Resilience & Business Continuity]`
  (named in the class doc itself, `GracefulShutdownTestsBase.cs:9`) assesses whether the system survives
  planned and unplanned interruption; a rolling deploy is the planned one. The failure this catches is a
  hosted service (a warm-up runner, service discovery, proxy infrastructure) that refuses to drain, which
  in production does not announce itself: it silently wedges a rolling deploy while the platform waits out
  its termination grace period (`:13-17`). `[Rubric §13, Observability & Operability]` is the operational
  half, lifetime events firing in order are what a platform's shutdown handling depends on. The
  recovery-objective framing is
  [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html); the base
  itself is one of the six suites recorded in
  [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html).
- **Walkthrough**
  - `ShutdownTimeoutSeconds` (`GracefulShutdownTestsBase.cs:28`): `virtual`, defaults to **20** seconds.
    This number is the test: a host that drains slower than this fails.
  - `CreateFactory()` (`:31`): `virtual`, returns a plain
    `ProductionHostApplicationFactory<TEntryPoint>`. The doc says to override it only when the host needs
    a fixture beyond a Production-pinned boot (`:18-21`).
  - `Host_StopsGracefully_FiringLifetimeEventsWithinTimeout` (`:33-62`): the single `[Fact]`. It creates
    the factory (`:36`) and holds the disposal as a **separate** `ConfiguredAsyncDisposable` (`:40`),
    with an inline comment explaining why (`:38-39`): the shorter
    `await using var factory = ....ConfigureAwait(false)` form would retype `factory` and lose access to
    `CreateClient` and `StartedHost`.
  - It then creates and immediately disposes a client (`:42-45`), which is what forces the lazy host to
    build and start, asserts `StartedHost` is non-null (`:47-48`), resolves `IHostApplicationLifetime`
    (`:49`), and confirms `ApplicationStarted` already fired (`:50`).
  - The stop itself (`:55-56`): a `CancellationTokenSource` for `ShutdownTimeoutSeconds` and
    `await host.StopAsync(timeout.Token)`. Reaching the next line already means the stop returned cleanly
    inside the budget, because a wedged hosted service makes the token cancel and `StopAsync` throw
    (`:52-54`).
  - The two closing assertions (`:58-61`): `ApplicationStopping` must have fired during the shutdown, and
    `ApplicationStopped` must signal once the host has fully stopped, each with its own because-reason.
- **Why it's built this way**: the bounded token is the mechanism, not decoration. Without it a host that
  never drains would hang the test run instead of failing it, which is exactly the production symptom the
  test exists to surface. Driving a real `IHost.StopAsync` (rather than asserting registrations) is what
  makes this a runtime check.
- **Where it's used**: both gateways, each a body-less one-line subclass,
  `MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/GracefulShutdownTests.cs:9` and
  `MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/GracefulShutdownTests.cs:9`. Both run in the
  no-database host-test tier, so they are in each repo's `CI.slnf`.

### IntegrationTestBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:13` · Level 1 · class (abstract)

- **What it is**: the workhorse base class every integration test inherits. It owns the per-test HTTP
  client and lifecycle, typed request helpers, bearer-token management, and a thread-safe id counter, so
  a concrete test class is left with just its arrange/act/assert.
- **Depends on**: [`IIntegrationTestFixture`](#iintegrationtestfixture) (the `TFixture` constraint,
  `IntegrationTestBase.cs:14`), plus `Xunit`'s `IAsyncLifetime`, `System.Net.Http.Headers`, and
  `System.Net.Http.Json` (`:1-3`).
- **Concept introduced, the xUnit async test lifecycle and per-test isolation.** `[Rubric §14,
  Testability]`: the base implements `IAsyncLifetime` so `InitializeAsync` runs **before each test** and
  `DisposeAsync` **after**, and it hangs the database reset off that hook so every test starts from a
  clean database, the single most important property for reliable integration tests.
- **Walkthrough**
  - Fields and properties: a `static int _nextId = 1000` seed (`IntegrationTestBase.cs:16`), and the
    `Fixture` / `Client` protected properties (`:19-22`).
  - Constructor (`:24-28`): stores the injected fixture and eagerly creates the `HttpClient` from it.
  - `InitializeAsync` (`:31`): a `ValueTask` that awaits `Fixture.ResetDatabaseAsync()` before each test.
    `DisposeAsync` (`:34-39`): suppresses finalization and disposes the client.
  - Auth helpers: `SetBearerToken(string)` / `ClearAuthentication()` (`:42-48`) set or clear the
    `Authorization` header, the hook through which a [`JwtTokenGenerator`](#jwttokengenerator) token is
    applied.
  - Typed HTTP helpers: `GetAsync<T>` (`:51-56`, which calls `EnsureSuccessStatusCode` then
    deserializes), and `PostAsync<T>` / `PutAsync<T>` / `PutAsync` / `DeleteAsync` (`:59-72`) returning
    the raw `HttpResponseMessage` so a test can assert status codes.
  - `NextId()` (`:75`): `Interlocked.Increment` over the shared seed, so parallel tests never collide on
    generated ids.
- **Why it's built this way**: per-test database reset plus a per-test client is the isolation contract;
  centralizing the typed helpers keeps individual tests short and consistent. The static `Interlocked`
  counter is the cheapest safe way to hand out unique ids under xUnit's parallelism. Note the asymmetry:
  `GetAsync<T>` throws on a non-success status while the others hand the response back, which is what
  makes a read helper terse and a write assertion explicit.
- **Where it's used**: the direct base of all three contract test bases in this unit
  ([`OpenApiContractTestsBase<TFixture>`](#openapicontracttestsbasetfixture),
  [`ProblemDetailsContractTestsBase<TFixture>`](#problemdetailscontracttestsbasetfixture),
  [`ServiceInfoVersioningContractTestsBase<TFixture>`](#serviceinfoversioningcontracttestsbasetfixture)),
  and of every concrete integration test in the downstream apps.

### SqlServerIntegrationTestFixtureBase<TEntryPoint>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27` · Level 1 · class (abstract)

- **What it is**: the reusable fixture that boots a real service host in-process against a **throwaway
  SQL Server database**, applies the module's migrations on first start, resets data between tests with
  Respawn, and drops the database on disposal. It is the concrete engine behind
  [`IIntegrationTestFixture`](#iintegrationtestfixture) for SQL Server hosts.
- **Depends on**: [`IIntegrationTestFixture`](#iintegrationtestfixture) (implemented,
  `SqlServerIntegrationTestFixtureBase.cs:27`), plus `Microsoft.AspNetCore.Mvc.Testing`
  (`WebApplicationFactory`), `Microsoft.Data.SqlClient`, `Respawn`, and `Xunit`'s `IAsyncLifetime`
  (`:1-4`).
- **Concept introduced, the disposable-database integration fixture and environment-variable overrides.**
  `[Rubric §14, Testability]` and `[Rubric §8, Data Architecture]`: real integration coverage needs a
  real relational database, and this fixture makes that cheap and hermetic, a fresh GUID-named database
  per fixture, migrated from scratch, Respawned between tests, dropped at the end. The
  database-per-service routing
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) is why the class doc
  stresses the `DataSources` collapse onto a single overridden connection string (`:16-24`).
- **Walkthrough**
  - State (`SqlServerIntegrationTestFixtureBase.cs:30-45`): the recorded original-environment map, the
    server-base and database-name strings, the `WebApplicationFactory`, the `Respawner`, a
    `_databaseCreated` flag, and the public `Client` / `ConnectionString`. `ConnectionString` (`:45`) is
    exposed so SQL-fidelity tests can read raw tables (for example to assert an integration event landed
    in the outbox).
  - `Services` (`:52`): the booted host's root service provider, exposed so cross-service tests can
    resolve a consumer-side integration-event handler or a repository and drive the flow directly against
    the real database.
  - Abstract knobs: `SqlBaseEnvironmentVariable` (`:58`, names the env var holding the CI SQL base
    connection string), `DatabaseNamePrefix` (`:61`), and `CreateFactory()` (`:134`, where the subclass
    builds the host). `CreateClient()` (`:64`) satisfies the interface by delegating to the factory.
  - `InitializeAsync` (`:67-96`): resolves the server base from `SqlBaseEnvironmentVariable` or falls
    back to LocalDB (`:69-70`), composes a GUID-suffixed database name and connection string (`:71-72`),
    forces `ASPNETCORE_ENVIRONMENT=Testing` and pushes the top-level SQL connection string as
    environment variables (`:75-76`), lets the subclass push its own via `ConfigureTestEnvironment`
    (`:77`), and builds the factory (`:79`); creating the client is what triggers the host's `Migrate`
    init to create the database and apply the module's migrations (`:81-84`). It then builds the
    `Respawner`, ignoring `__EFMigrationsHistory` (`:86-95`).
  - `ResetDatabaseAsync` (`:99-112`): returns immediately when no respawner exists, otherwise opens a
    connection and calls `Respawner.ResetAsync`.
  - `DisposeAsync` (`:115-131`): disposes client and factory, drops the database when one was created,
    and restores the environment.
  - `ConfigureTestEnvironment` (`:142-144`) is an empty `virtual` hook receiving the setter delegate.
    `SetEnvironmentVariable` (`:146-155`) records only the **first** original value per key so re-pushing
    a key cannot clobber the restore point; `RestoreEnvironment` (`:157-165`) puts them all back and
    clears the map.
  - `DropDatabaseAsync` (`:167-188`): clears pooled connections so the database is free to drop (`:170`),
    connects to `master`, and runs a guarded `SET SINGLE_USER WITH ROLLBACK IMMEDIATE` plus
    `DROP DATABASE` (`:180-183`), with a scoped `CA2100` suppression justified because the database name
    is a server-generated GUID, never user input (`:179`).
- **Why it's built this way**: overrides go through process environment variables because the host reads
  its connection string at configure-time; forcing the `Testing` environment skips
  `appsettings.Development.json` (which would point `DataSources` at `localhost`) so the resolver
  collapses onto the single overridden top-level connection string, making the fixture behave like a
  clean single-database monolith. LocalDB-by-default keeps local runs zero-config while CI can point at a
  SQL service container.
- **Where it's used**: the base of every per-service integration fixture in both apps, four in ADC
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceIntegrationTestFixture.cs:17`,
  `.../MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementIntegrationTestFixture.cs:17`,
  `.../MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:22`,
  `.../MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationIntegrationTestFixture.cs:17`)
  and three in Store
  (`MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Infrastructure/CatalogIntegrationTestFixture.cs:16`,
  `.../MMCA.Store.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:15`,
  `.../MMCA.Store.Sales.IntegrationTests/Infrastructure/SalesIntegrationTestFixture.cs:17`). Each is then
  the `TFixture` for that service's integration and contract tests.
- **Caveats / not-in-source**: the fixture needs a reachable SQL Server, so these suites build but do not
  run without one; they execute in each repo's SQL-service CI job via the `*.Integration.slnf` filter.

### OpenApiContractTestsBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/OpenApiContractTestsBase.cs:21` · Level 2 · class (abstract)

- **What it is**: a contract conformance base that boots a host and asserts its `/openapi/v1.json`
  document is served, is a well-formed OpenAPI 3.x document, and still describes the core public
  resources, so an accidental controller or route removal fails CI instead of silently changing the
  published contract.
- **Depends on**: [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) (inherited,
  `OpenApiContractTestsBase.cs:21`), `System.Net`, `System.Text.Json`, `AwesomeAssertions`, and `Xunit`
  (`:1-4`).
- **Concept introduced, the contract guard on the live document.** `[Rubric §9, API & Contract Design]`
  assesses whether the API surface is described and kept stable; the pattern across all three Level 2
  bases is a **live-document guard with no committed snapshot** (`OpenApiContractTestsBase.cs:14-16`),
  the assertions run against the document the host actually serves, so new controllers can never leave a
  stale snapshot behind and a removed one is caught immediately. This is one of the six suites recorded
  in [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html), and
  the one with the widest adoption.
- **Walkthrough**
  - Overridable and abstract knobs: `OpenApiDocumentPath` (`:30`, defaults to `/openapi/v1.json`),
    `MinimumPathCount` (`:37`, a coarse floor under the route surface), `MinimumPathCountBecause` (`:44`,
    the failure-message reason), and `CorePublicResources` (`:50`, the resource paths that must keep
    being described).
  - `OpenApiDocument_IsServed_AsWellFormedOpenApiDescribingTheApiSurface` (`:52-65`): parses the JSON and
    asserts `openapi` starts with `3.`, `info.title` is non-empty, a `paths` object exists, and it holds
    at least `MinimumPathCount` entries.
  - `OpenApiDocument_DescribesEveryCorePublicResource` (`:67-85`): first guards against a vacuous pass
    (the subclass must pin at least one resource, `:70-71`), then checks every `CorePublicResources`
    entry is present, matching on name case-insensitively (`:77-80`) so presence, not exact casing, is
    the contract.
  - `GetOpenApiJsonAsync` (`:91-100`): clears auth (the document is anonymous outside Production),
    fetches the path, asserts 200 with a message naming the path, and returns the raw JSON.
- **Why it's built this way**: asserting the live document (rather than diffing a checked-in snapshot)
  keeps the guard maintenance-free while still catching the two failures that matter, the document
  disappearing and a public resource vanishing. The two assertions are deliberately coarse for the same
  reason: a strict shape diff would fail on every ordinary additive change.
- **Where it's used**: subclassed once per REST service host, four in ADC
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/OpenApiContractTests.cs:15`,
  `.../MMCA.ADC.Engagement.IntegrationTests/Contract/OpenApiContractTests.cs:15`,
  `.../MMCA.ADC.Identity.IntegrationTests/Contract/OpenApiContractTests.cs:16`,
  `.../MMCA.ADC.Notification.IntegrationTests/Contract/OpenApiContractTests.cs:17`) and three in Store
  (`MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/OpenApiContractTests.cs:15`,
  `.../MMCA.Store.Identity.IntegrationTests/Contract/OpenApiContractTests.cs:15`,
  `.../MMCA.Store.Sales.IntegrationTests/Contract/OpenApiContractTests.cs:15`), each supplying the
  fixture, the path floor, and the pinned resource list.

### ProblemDetailsContractTestsBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ProblemDetailsContractTestsBase.cs:21` · Level 2 · class (abstract)

- **What it is**: a contract conformance base that asserts a host's error responses are RFC 9457 Problem
  Details documents, machine-readable bodies carrying `status`, `title`, and a diagnostic extension,
  across both error-shaping paths the framework uses.
- **Depends on**: [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) (inherited,
  `ProblemDetailsContractTestsBase.cs:21`), `System.Net`, `System.Net.Http.Json`, `System.Text.Json`,
  `AwesomeAssertions`, and `Xunit` (`:1-5`). Same live-guard shape as the OpenAPI base above.
- **Concept**: still `[Rubric §9, API & Contract Design]`, here the pinned contract is the **error
  shape**. The class covers the two distinct paths that produce errors (class doc, `:10-18`): ASP.NET
  Core model validation (a 400 `application/problem+json` body) and the framework's `HandleFailure`
  `Result`-error mapping (see
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)), which turns a
  [`Result`](group-01-result-error-handling.md#result) failure such as an
  [`Error`](group-01-result-error-handling.md#error) not-found into a 404 problem
  ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) defines that edge contract).
- **Walkthrough**
  - `Validation_400_HasProblemDetailsShape` (`ProblemDetailsContractTestsBase.cs:29-39`): sends the
    subclass's validation probe, asserts the shared shape at 400, then checks the `problem+json` content
    type and the model-validation-only extensions `type`, `traceId`, and `errors` (`:35-38`).
  - `NotFound_404_HasProblemDetailsShape` (`:41-47`): sends the 404 probe and asserts the shared shape.
  - Abstract probes: `SendValidationErrorProbeAsync` (`:54`) and `SendNotFoundProbeAsync` (`:60`), the
    only app-specific pieces, authenticating first when the endpoint requires it (the docs suggest
    `pageNumber=0` against a `[Range(1, int.MaxValue)]` paged read, and reading an id that does not
    exist, `:49-60`).
  - `AssertProblemDetailsShapeAsync` (`:67-83`): the shared `protected static` assertion, JSON content
    type, echoed `status`, non-empty `title`, and at least one diagnostic extension (`errors`, `traceId`,
    or `requestId`, `:76-80`), returning the parsed body so a subclass can follow up.
- **Why it's built this way**: pinning both the validation path and the `HandleFailure` path in one base
  means a regression in either error channel breaks CI, and factoring the shape assertion into a shared
  static keeps every host's error contract identical while still letting a host with a reachable
  409-conflict path layer its own test on top (`:16-18`).
- **Where it's used**: subclassed per host, three in ADC
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ProblemDetailsContractTests.cs:20`,
  `.../MMCA.ADC.Engagement.IntegrationTests/Contract/ProblemDetailsContractTests.cs:17`,
  `.../MMCA.ADC.Identity.IntegrationTests/Contract/ProblemDetailsContractTests.cs:17`) and three in Store
  (`MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/ProblemDetailsContractTests.cs:20`,
  `.../MMCA.Store.Identity.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16`,
  `.../MMCA.Store.Sales.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16`). ADC Conference is
  the one that adds a 409 stale-`RowVersion` conflict test on top of the inherited facts.

### ServiceInfoVersioningContractTestsBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19` · Level 2 · class (abstract)

- **What it is**: a contract conformance base that proves the API-versioning machinery actually works
  across more than one version: that `/ServiceInfo` is served by both v1.0 (deprecated) and v2.0,
  selected by the `api-version` header, and that the host reports supported and deprecated versions in
  response headers.
- **Depends on**: [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) (inherited,
  `ServiceInfoVersioningContractTestsBase.cs:19`), `System.Net`, `System.Text.Json`,
  `AwesomeAssertions`, and `Xunit` (`:1-4`).
- **Concept**: `[Rubric §9, API & Contract Design]` again, the versioning axis
  ([ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html)). The class doc
  (`:8-17`) makes the point that without a second working version the whole versioning story would be
  untestable, so this base keeps the machinery *exercised* rather than merely asserted. Because the
  `ServiceInfo` controller ships in `MMCA.Common.API`
  ([`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase)), the entire
  test body is identical across repos; a subclass supplies only its fixture.
- **Walkthrough**
  - `ServiceInfo_V1_ReturnsMinimalShape_AndIsReportedDeprecated`
    (`ServiceInfoVersioningContractTestsBase.cs:27-41`): requests v1.0, asserts 200, checks
    `apiVersion == "1.0"` and that the evolved `supportedVersions` list is **absent** in the v1 shape
    (`:35-36`), then asserts an `api-deprecated-versions` response header contains `1.0` (`:38-40`).
  - `ServiceInfo_V2_ReturnsEvolvedShape_AndIsReportedSupported` (`:43-57`): requests v2.0, asserts 200,
    checks `apiVersion == "2.0"` and that `supportedVersions` contains `2.0` (`:50-52`), then asserts an
    `api-supported-versions` header advertises `2.0` (`:54-56`).
  - `GetServiceInfoAsync(string apiVersion)` (`:59-65`): clears auth and sends the GET with the
    `api-version` header set to the requested version, which is the header-based selection ADR-046
    standardizes.
- **Why it's built this way**: keeping a real deprecated v1 and a real v2 side by side, and asserting
  both the payload shapes and the `ReportApiVersions` headers, is what proves version negotiation is
  wired end to end rather than configured and forgotten.
- **Where it's used**: two adopters today, each a body-less one-line subclass,
  `MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:15` and
  `MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/ApiVersioningTests.cs:16`.
- **Caveats / not-in-source**: adoption is per-repo partial, one host each in ADC and Store, not every
  extracted REST service.

### HandlerTestBase<THandler>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/HandlerTestBase.cs:38` · Level 9 · class (abstract)

- **What it is**: the reusable Moq scaffold for command/query handler **unit** tests. It hands a derived
  test class a pre-configured `Mock<IUnitOfWork>`, a no-op logger typed to the handler under test, and
  two one-line helpers that register a repository mock into that unit of work.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype),
  [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype),
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  and
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the two generic constraints), plus `Moq`, `Microsoft.Extensions.Logging`, and `NullLogger<T>`
  (`HandlerTestBase.cs:1-5`).
- **Concept**: *the arrange-phase base class.* Where
  [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) gives an end-to-end test a booted host,
  this gives an isolated unit test a mocked persistence boundary: no database, no host, no HTTP. The
  class doc (`HandlerTestBase.cs:10-12`) frames it as the shared replacement for the per-test copy-paste
  of `Mock<IUnitOfWork>` plus `GetRepository` wiring plus `SaveChangesAsync` setup. `[Rubric §14,
  Testability]` assesses whether the design permits fast isolated tests; the fact that handlers depend on
  `IUnitOfWork` (an Application-layer abstraction) rather than a `DbContext` is what makes this scaffold
  possible at all, which is `[Rubric §3, Clean Architecture]` paying off in the test tier
  ([ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html) records
  that contract). `[Rubric §16, Maintainability]` covers the deduplication itself.
- **Walkthrough**
  - Constructor (`HandlerTestBase.cs:41-42`): a single expression-bodied statement that pre-configures
    `UnitOfWork.SaveChangesAsync(...)` to return `1`, the success path, so a happy-path test writes no
    persistence setup at all. Failure-path tests override it with their own `Setup` (doc `:32-35`).
  - `UnitOfWork` (`:45`): the `Mock<IUnitOfWork>` every registered repository is wired into, created by a
    property initializer so the constructor can configure it.
  - `Logger` (`:48`): `NullLogger<THandler>.Instance`, typed by the handler type parameter so it binds
    directly to the handler's `ILogger<THandler>` constructor parameter.
  - `RegisterRepository<TEntity, TIdentifierType>()` (`:56-64`): creates a
    `Mock<IRepository<TEntity, TIdentifierType>>`, wires that same object into **both**
    `GetRepository<...>()` and `GetReadRepository<...>()` (`:61-62`), and returns the mock for further
    `Setup` / `Verify`. Constrained to `AuditableAggregateRootEntity<TIdentifierType>` (`:57`), that is,
    to aggregate roots.
  - `RegisterReadRepository<TEntity, TIdentifierType>()` (`:72-79`): the read-only counterpart for
    non-aggregate child entities that expose no read-write repository, constrained to the looser
    `AuditableBaseEntity<TIdentifierType>` (`:73`) and wiring only `GetReadRepository<...>()` (`:77`).
- **Why it's built this way**: wiring one repository mock into both accessors matters because a handler
  may read through `GetReadRepository` and write through `GetRepository` on the same aggregate; a test
  forced to register two mocks would have to keep their state in sync. Pre-succeeding `SaveChangesAsync`
  encodes the common case so only the interesting deviation appears in a test.
- **Where it's used**: the base of handler unit-test classes across the framework and the downstream
  application modules, including the framework's own scaffold test
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/HandlerTestBaseTests.cs:12`) and dozens of ADC
  Application-tier classes (for example
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Application.Tests/Categories/UseCases/CreateConferenceCategoryHandlerTests.cs:13`,
  `MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CastVoteHandlerTests.cs:13`,
  `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/UseCases/ChangePasswordHandlerTests.cs:12`).
  The class doc carries a worked `CreateEventHandlerTests` example (`HandlerTestBase.cs:19-31`).

### ArchitectureAssert
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:8` · Level 0 · static class

- **What it is**: the shared failure-reporting helper for every architecture fitness function, a static class with two `NoViolations` overloads that turn a rule breach into a readable, offender-listing assertion failure.
- **Depends on**: `NetArchTest.Rules.TestResult` and AwesomeAssertions' `Should()` fluent API, both global-imported for the whole package (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/GlobalUsings.cs:3-4`). No first-party dependencies: this is the bottom of the fitness-function stack.
- **Concept introduced, architecture fitness functions.** A fitness function is an automated test that asserts a *structural* property of the codebase (a layer never references another, a controller is sealed) rather than a behavioral one. This package makes those rules first-class, shared code ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)). `[Rubric §14, Testability]` assesses how well invariants are guarded by executable checks; `ArchitectureAssert` is the reporting primitive that makes a failing invariant name its offenders instead of just going red. `[Rubric §34, Architecture Governance]` assesses whether architectural decisions are enforced rather than merely documented; every rule in this package funnels its verdict through here.
- **Walkthrough**
  - `NoViolations(NetArchTest.Rules.TestResult result, string reason)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:11`) returns early when `result.IsSuccessful` (line 13), otherwise null-coalesces `FailingTypes` to an empty list, joins the full names into a bullet list (lines 18-19), and asserts `IsSuccessful.Should().BeTrue(...)` with the reason plus the violation list as the `because` argument (lines 21-22).
  - `NoViolations(IEnumerable<string> violations, string reason)` (line 26) materializes the sequence once and asserts `list.Should().BeEmpty(...)` (line 30), for the reflection-derived and file-scanning rules that produce a plain string list rather than a NetArchTest result.
- **Why it's built this way**: the XML doc (lines 3-7) names it the un-drifted successor to the three per-repo `ArchitectureTestHelper.AssertNoViolations` copies: the reporting logic was duplicated in MMCA.Common, MMCA.Store, and MMCA.ADC, and centralizing it here removes the drift.
- **Where it's used**: every rule in [ArchitectureRules](#architecturerules) and several reflection-based test bases call one of these two overloads as their final step.

### BrandColorTokenTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:13` · Level 0 · abstract class

- **What it is**: an abstract xUnit test base that fails the build when a landing-page stylesheet re-hardcodes the brand hex instead of sourcing it from the shared `var(--mmca-primary)` CSS custom property.
- **Depends on**: `[Fact]` (xUnit), AwesomeAssertions, and `Assembly.GetManifestResourceStream` (BCL) to read embedded CSS. No first-party type dependency: it operates on the strings the subclass embeds.
- **Concept introduced, the drift fitness function.** Unlike a layer rule that reflects over assemblies, a drift function reads committed *text* (CSS here) and asserts a single source of truth is used. `[Rubric §20, Design System & Theming]` assesses whether visual tokens have one authoritative definition; this base guards that consumers of the framework palette cannot silently fork the primary color.
- **Walkthrough**
  - Two private constants pin the forbidden literal `#1565C0` and the required token `var(--mmca-primary)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:15-16`).
  - The subclass supplies `EmbeddedCssLogicalNames` (line 22), the manifest-resource names of its landing-page stylesheets.
  - The single `[Fact]` `LandingPageCss_SourcesBrandColorFromToken_NotHardcodedHex` (line 25) first asserts the list is non-empty (a non-vacuity guard, lines 27-28), then for each stylesheet reads it via `ReadEmbeddedCss` (line 56, which throws a clear `InvalidOperationException` when the resource is missing, lines 58-60) and records a violation when the file is blank (line 37), when the token is absent (line 43), or when the raw hex is present (line 48, matched case-insensitively so `#1565c0` cannot slip past).
  - Resources are resolved from `GetType().Assembly` (line 33), that is, the *subclass's* assembly, which is what lets a package-shipped base read a consumer's stylesheet.
- **Why it's built this way**: the doc (lines 3-11) explains the split. MMCA.Common's own [BrandColorTokenTests](#brandcolortokentests) guards the C#-to-CSS token *definition* (from `BrandColors.Primary`), while this base guards every downstream *consumer* of it, embedding the stylesheets as manifest resources so the package needs no file-system access into the consumer repo.
- **Where it's used**: subclassed once per repo that ships a branded landing page, as `BrandColorTokenTests` in `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:12` and in Store's equivalent.

### CrossEntityNavigationFinder
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97` · Level 0 · private sealed class

- **What it is**: a private `ExpressionVisitor` nested in [ArchitectureRules](#architecturerules) that walks a specification's `Criteria` lambda and collects the names of *other* entity types it navigates into.
- **Depends on**: `System.Linq.Expressions.ExpressionVisitor`, `MemberExpression`, `PropertyInfo` (BCL) and the [RuleHelpers](#rulehelpers) extension property `InheritsAuditableEntity`.
- **Concept introduced, expression-tree inspection as a fitness check.** NetArchTest reasons about assembly-level references only; to catch a rule expressed *inside* a lambda body (`s => s.Event.IsPublished`), the code instantiates the specification, reads its `Criteria` expression tree, and visits it. This backs the polyglot / database-per-service invariant ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)): a `Criteria` that navigates to an entity in another physical data source produces an untranslatable join at runtime. `[Rubric §8, Data Architecture]` assesses cross-source data access discipline; this visitor is how that discipline is machine-checked.
- **Walkthrough**
  - The primary constructor captures `ownEntityType` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97`), and `_navigated` is the accumulating `HashSet<string>` (line 99).
  - `Find(Expression body)` visits the body and returns the set (lines 101-105).
  - `VisitMember` (line 107) resolves the accessed property's type through `EntityTypeOf` (line 121) and, when the result is an auditable entity other than the specification's own type, adds its name (lines 111-115).
  - `EntityTypeOf` (line 121) treats a direct entity property as a navigation (lines 123-126) and unwraps generic collection navigations such as `ICollection<TChild>` to their element type (lines 129-136).
- **Why it's built this way**: filtering by a foreign-key column is engine-portable; navigating is not (notably on Cosmos, where the cross-source relationship is degraded out of the model). The finder is the enforcement half of `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities` (line 24), whose failure message points authors at [CrossSourceSpecification](group-03-querying-specifications.md#crosssourcespecification) instead (lines 14-15). The rule is deliberately best-effort: only parameterless specifications can be instantiated and inspected (lines 37-41), and a specification whose constructor or `Criteria` throws on standalone evaluation is skipped rather than failing the suite (lines 50-59).
- **Where it's used**: only inside that rule (line 66), which is surfaced through [SpecificationConventionTestsBase](#specificationconventiontestsbase).

### Layer
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:9` · Level 0 · enum

- **What it is**: the closed vocabulary of architectural layers a fitness function can reason about: `Shared`, `Domain`, `Application`, `Infrastructure`, `Api`, `Ui`, `Grpc`, `Contracts`, `ServiceHost` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:11-19`).
- **Depends on**: nothing; a plain enum.
- **Concept introduced**: the Clean Architecture layer taxonomy made into a type. The layer flow itself is taught in [primer §1](00-primer.md#1-the-big-picture); here it becomes an enum the rule library keys off, so a rule that iterates layers is written once against the enum rather than hard-coded per repo. `[Rubric §3, Clean Architecture]` assesses whether the layering is explicit and enforced; this enum is the shared alphabet.
- **Walkthrough**: the doc (lines 3-8) notes that `Ui`, `Grpc`, `Contracts`, and `ServiceHost` are optional: a repo simply omits them from its map when absent, so a rule iterating them is vacuously satisfied with no compile dependency on the missing assembly. [ArchitectureMapBase](#architecturemapbase)`.Segment` translates each member to its namespace segment, and two of those translations are not the identity mapping: `Api` becomes `"API"` and `ServiceHost` becomes `"Service"` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:105-117`).
- **Where it's used**: carried by [LayerRef](#layerref), projected by [IArchitectureMap](#iarchitecturemap)`.OfLayer`, and threaded through nearly every method in [ArchitectureRules](#architecturerules).

### ObservabilityConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:30` · Level 0 · abstract partial class

- **What it is**: an SLO alert-to-runbook pairing gate. It parses the SLO metric alerts a consumer's `infra/main.bicep` provisions and asserts each one keeps a matching, severity-correct triage section in that repo's `infra/OPERATIONS.md`, in both directions: a missing runbook section fails, and so does an orphan runbook section whose alert no longer exists.
- **Depends on**: `System.Globalization`, source-generated `System.Text.RegularExpressions` regexes, `Assembly.GetManifestResourceStream`, AwesomeAssertions, and `[Fact]` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:1-2`). No first-party dependency and, notably, no [IArchitectureMap](#iarchitecturemap): it reads embedded text, not assemblies.
- **Concept introduced, the documentation-pairing gate.** `[Rubric §13, Observability & Operability]` assesses whether an operator paged at 3am has usable guidance; the failure mode this base closes is the silent one, an alert added, renamed, or re-tiered while its runbook section stays behind. `[Rubric §17, DevOps]` applies because the source of truth is the IaC template itself, and `[Rubric §34, Architecture Governance]` because it makes the "every alert has a runbook" convention executable rather than aspirational.
- **Walkthrough**
  - Overridable knobs: `MinimumAlertSpecs` (line 39, default 3), the two manifest-resource logical names `BicepResource` (line 42, `infra.main.bicep`) and `RunbookResource` (line 45, `infra.OPERATIONS.md`), and `ResourceAssembly` (line 51), which defaults to `GetType().Assembly`.
  - `SloAlertSpecs_AreDiscovered_GateIsNotVacuous` (lines 53-61) is the honesty guard: discovering fewer specs than the floor means the parse anchors drifted, not that alerts disappeared.
  - `EveryProvisionedSloAlert_HasASeverityCorrectRunbookSection` (lines 63-89) matches each alert key against the runbook headings by the `-alert-` infix (line 73, the constant at line 32) and then asserts the heading also carries the `(sev N)` tag matching the bicep severity (lines 80-84).
  - `EveryRunbookAlertSection_MapsToAProvisionedAlert` (lines 91-103) is the reverse direction, flagging stale guidance.
  - `DiscoverAlertSpecs` (lines 105-126) slices the bicep between `var sloAlertSpecs` and `resource sloAlerts` (lines 109-112, each index assertion carrying its own `because`), runs `AlertKeyRegex` and `AlertSeverityRegex` over that block, and asserts the two match counts agree (line 117) so a changed spec shape fails loudly instead of silently mis-pairing. The three `[GeneratedRegex]` partial properties sit at lines 139-146, each with a 2000 ms match timeout.
  - `ReadEmbedded` (lines 131-137) throws a message naming the assembly when a resource is missing.
- **Why it's built this way**: the class doc (lines 23-28) records why the `ResourceAssembly` default is load-bearing. The base ships *inside* the framework package, so resolving resources against its own assembly would look for the consumer's bicep inside `MMCA.Common.Testing.Architecture.dll` and always throw. Defaulting to the derived type's assembly means a subclass needs no wiring beyond two `EmbeddedResource` entries in its csproj (the snippet is in the doc at lines 18-22).
- **Where it's used**: subclassed as a one-line `public sealed class ObservabilityConventionTests : ObservabilityConventionTestsBase;` in ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7`) and in Store's equivalent; see [ObservabilityConventionTests](#observabilityconventiontests). MMCA.Common carries [ObservabilityConventionTestsBaseTests](#observabilityconventiontestsbasetests) instead, a deliberate cross-assembly guard that points at fixture resources and pins the `ResourceAssembly` default (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ObservabilityConventionTestsBaseTests.cs:24-29`).

### RouteAuthorizationTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:22` · Level 0 · abstract class

- **What it is**: an abstract test base that reflects over a UI assembly's routable Blazor pages and fails the build if a page the subclass marks as governed has lost its `[Authorize(Roles = "...")]` role gate.
- **Depends on**: `[Fact]` (xUnit), AwesomeAssertions, [RuleHelpers](#rulehelpers)`.LoadableTypes`, and pure reflection over attribute instances matched by full name (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:24-25`).
- **Concept introduced, the security-regression fitness function.** `[Rubric §11, Security]` and `[Rubric §25, Navigation & IA]` assess whether protected routes stay protected; this base turns "the admin page must require the Organizer role" from a review checklist into a compiled assertion, so a page cannot silently regress from `[Authorize(Roles=...)]` to a bare `[Authorize]` reachable by any authenticated user.
- **Walkthrough**
  - The subclass supplies `TargetAssembly` (line 28), the exact `RequiredRole` (line 31), an `IsGovernedPage` strategy (line 40), and a `MinimumGovernedPages` non-vacuity floor (line 47, default 1).
  - `GovernedPages_RequireDeclaredRole` (line 50) collects pages that are routable, governed, and do not require the role, then asserts the offender set is empty, naming each offender's route templates (lines 52-60).
  - `GovernedPageSet_IsNotEmpty` (line 64) guards the guard: if a refactor moved namespaces so `IsGovernedPage` matched nothing, the first test would pass vacuously, so this one asserts the discovered count meets the floor (lines 68-73).
  - Detection is all reflection by attribute full name: `IsRoutablePage` (line 77), `RequiresRole` (line 83, which reads the `Roles` property off the attribute instance and requires an exact ordinal match, so a bare `[Authorize]` or a different role fails), the subclass helper `HasAuthorizeAttribute` (line 94), `Routes` (line 97), and the base-type walk `IsOrDerivesFrom` (line 105) that lets a derived authorize attribute still count.
- **Why it's built this way**: matching attributes by full name keeps the shared package free of an ASP.NET Core reference (lines 16-20) while still inspecting ASP.NET attributes; the package's only dependencies are NetArchTest, AwesomeAssertions, and xUnit (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/MMCA.Common.Testing.Architecture.csproj:18-20`). A reflection scan also covers future pages matching the strategy without hand-enumeration. Deliberately anonymous public pages and bare-`[Authorize]` self-service pages simply must not match `IsGovernedPage` (lines 12-15).
- **Where it's used**: subclassed per module UI test project, four times today: `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/ManagementRouteAuthorizationTests.cs:19`, `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/IdentityRouteAuthorizationTests.cs:16`, and the Catalog and Sales/Identity equivalents in Store.

### RuleHelpers
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/RuleHelpers.cs:14` · Level 0 · internal static class

- **What it is**: the internal reflection toolbox the reflection-based fitness functions share: extension members for enumerating loadable types, matching suffix conventions on generic types, detecting base types and interfaces by open generic or name prefix, and classifying property setters as mutable or `init`-only.
- **Depends on**: `System.Reflection` (`Assembly`, `Type`, `PropertyInfo`, `ReflectionTypeLoadException`, `BindingFlags`) only.
- **Concept introduced**: the doc (lines 5-9) states the premise: NetArchTest cannot inspect method return types, generic-argument constraints, property accessors, or attribute usage, so those rules reflect over loaded types directly through these helpers. `[Rubric §14, Testability]` and `[Rubric §15, Best Practices & Code Quality]` apply: the reflection subtleties (partial assembly loads, `init`-only detection) are solved once here rather than re-derived per rule.
- **Walkthrough**: the class body is three C# preview `extension(T)` blocks, so every helper is an *extension property or method*, not a classic `this`-parameter extension method (the syntax is taught in [primer §4](00-primer.md#4-c-build-and-code-style-conventions)).
  - `extension(Assembly assembly)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/RuleHelpers.cs:16`): `LoadableTypes` (line 19) tolerates a partially-resolvable assembly by catching `ReflectionTypeLoadException` and returning the types that did load through `OfType<Type>()`, which both filters nulls and narrows the element type (lines 27-31). `ConcreteClasses` (line 36) narrows that to non-abstract classes.
  - `extension(Type type)` (line 40): `SimpleName` (line 47) strips the generic-arity backtick so suffix conventions match generic types too. `InheritsGeneric` (line 58) walks the base chain and `ImplementsGeneric` (line 72) scans the interface set for an open generic. `HasBaseTypeStartingWith` (line 80) detects a framework base by full-name prefix without a compile dependency (for example FluentValidation's `AbstractValidator`). `DeclaredPublicProperties` (line 94) narrows to declared-only public instance properties. `InheritsAggregateRoot` (line 101) and `InheritsAuditableEntity` (line 108) hard-code the MMCA entity base full names ([AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) plus the [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) and [BaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#baseentitytidentifiertype) ancestors) so the entity rules can classify types cross-repo.
  - `extension(PropertyInfo property)` (line 114): `HasPublicMutableSetter` (line 121) is the immutability primitive. It reports `false` when there is no public setter, and `false` for `init`-only setters by looking for the `System.Runtime.CompilerServices.IsExternalInit` required custom modifier on the setter's return parameter (lines 131-135).
- **Why it's built this way**: every helper avoids a compile-time reference to the type it detects (base types matched by string prefix), which is what lets one rule body run identically across four repos that do not reference each other. The class carries a file-level `[SuppressMessage]` for CA1708 (lines 10-13): with multiple `extension(T)` blocks in one static class the analyzer flags the compiler-generated grouping members as case-colliding, a documented false positive.
- **Where it's used**: throughout the [ArchitectureRules](#architecturerules) partials, inside [CrossEntityNavigationFinder](#crossentitynavigationfinder), and directly by [RouteAuthorizationTestsBase](#routeauthorizationtestsbase).
- **Caveats / not-in-source**: the type is `internal`, so consumer repos cannot call these helpers directly; they reach the same behavior only through the public rules and bases. [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) is the one base that re-implements the tolerant type load privately rather than using this class.

### LayerRef
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:31` · Level 1 · sealed record

- **What it is**: an immutable record describing one assembly in a repo's architecture: its owning `Module`, its [Layer](#layer), the compiled `Assembly`, and its `RootNamespace` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:31`).
- **Depends on**: [Layer](#layer) and `System.Reflection.Assembly`.
- **Concept introduced**: the atomic unit of an architecture map. `Module` is the empty string for framework (MMCA.Common) layers that belong to no business module (lines 22-30), which is how the same record models both a module assembly (`("Catalog", Application, ...)`) and a shared framework assembly (`("", Shared, ...)`). Every projection and every isolation rule keys off that one convention.
- **Walkthrough**: a four-parameter positional `sealed record` (line 31), so it gets structural equality and immutability for free; its members are set once at construction by the map's `DefineLayers`.
- **Where it's used**: [ArchitectureMapBase](#architecturemapbase) stores a lazy `IReadOnlyList<LayerRef>` and derives every projection from it; its `Framework` and `Module` factory helpers are what build these.

### IArchitectureMap
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:39` · Level 2 · interface

- **What it is**: the single per-repo abstraction every architecture fitness function keys off. Each repo supplies one implementation declaring its layer and module assemblies; the shared rule library and abstract test bases consume *only* this interface, so a rule is written once and runs identically across MMCA.Common, MMCA.Store, MMCA.ADC, and MMCA.Helpdesk (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:33-38`).
- **Depends on**: [LayerRef](#layerref), [Layer](#layer), `System.Reflection.Assembly`.
- **Concept introduced, the architecture map as the fitness-function extension point.** This is a classic Dependency Inversion: the rules depend on an abstraction (the map), and each repo provides the concrete inventory of its assemblies. `[Rubric §1, SOLID]` (DIP) and `[Rubric §7, Microservices Readiness]` apply: the map also models the per-module layers a would-be extracted service owns, so the isolation rules can check module boundaries the same way in any repo.
- **Walkthrough**: the interface exposes identity (`RepoToken` line 42, `ModuleNames` line 45), the raw `Layers` inventory (line 48), and the projections the rules lean on: `OfLayer` (all assemblies of a kind, line 51), the per-module `ModuleDomain`/`ModuleApplication`/`ModuleShared` (lines 54-60), `Infrastructure()`/`Api()` across framework plus modules (lines 63-66), the lookups `For(module, layer)` (line 69) and `ModuleOf(assembly)` (line 72), namespace derivation `RootNamespace(module, layer)` (line 75), and `OtherModuleNamespaces` (line 81), which returns the same-layer namespaces of every *other* module (the forbidden targets for a module-isolation rule, empty for framework layers and single-module repos).
- **Why it's built this way**: funneling every rule through one interface is what removed the drifting per-repo copies of the architecture-test suite ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)); add a repo and you write one map, not a new rule set.
- **Where it's used**: held as the `protected abstract IArchitectureMap Map` on nearly every `*TestsBase` in this group and passed to nearly every method of [ArchitectureRules](#architecturerules). [ArchitectureMapBase](#architecturemapbase) is the reusable partial implementation, and [CommonArchitectureMap](#commonarchitecturemap) / [AdcArchitectureMap](#adcarchitecturemap) are two of the four concrete maps (Store and Helpdesk supply the others).

### ArchitectureMapBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:11` · Level 3 · abstract class

- **What it is**: the reusable base implementation of [IArchitectureMap](#iarchitecturemap): a repo supplies only `RepoToken` and a `DefineLayers()` declaration, and every projection, namespace derivation, and module-isolation target computation is derived here (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:3-10`).
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [LayerRef](#layerref), [Layer](#layer), `System.Lazy`, and `System.IO` (for `FindRepoRoot`).
- **Concept introduced, the template-method shape for a repo map**: the base fixes the algorithm and the subclass fills two holes. It also centralizes every namespace and assembly string in one file, which the doc (lines 8-9) notes fixes Ubuntu CI case-sensitivity in one place.
- **Walkthrough**
  - The constructor wraps `DefineLayers()` in a `Lazy<IReadOnlyList<LayerRef>>` (lines 15-16) so the assembly list materializes once, and `Layers` reads that value (line 25).
  - `ModuleNames` (line 28) filters out framework refs, then distinct-orders the module names ordinally.
  - `OfLayer` (line 35), `ModuleDomain`/`ModuleApplication`/`ModuleShared` (lines 39-45, via the private `ModuleLayer`, line 101), `Infrastructure` (line 48), and `Api` (line 51) are one-line LINQ projections over `Layers`.
  - `For` (line 54) and `ModuleOf` (line 59) are the lookups, both ordinal-comparison based.
  - `RootNamespace` (line 63) branches on module: framework layers become `MMCA.Common.{Segment}`, module layers `{RepoToken}.{module}.{Segment}`. `OtherModuleNamespaces` (line 69) maps every other module through it.
  - The static `FindRepoRoot(solutionFileName)` (line 79) walks up from `AppContext.BaseDirectory` to the directory containing the named `.slnx`, so doc and config consistency tests can read committed files regardless of the runner's working directory, throwing a clear `InvalidOperationException` when not found (lines 89-90).
  - The `protected static Framework(...)` (line 94) and `protected Module(...)` (line 98) factory helpers build [LayerRef](#layerref)s with the right namespace, and the internal `Segment` (line 105) maps each [Layer](#layer) to its namespace token, throwing `ArgumentOutOfRangeException` on an unmapped member (line 116).
- **Why it's built this way**: a per-repo map stays a flat declaration of assemblies (the two abstract members), and everything derivable is derived, so the maps cannot drift in how they compute namespaces.
- **Where it's used**: each repo's concrete map subclasses this: [CommonArchitectureMap](#commonarchitecturemap), [AdcArchitectureMap](#adcarchitecturemap), `StoreArchitectureMap`, and `HelpdeskArchitectureMap` (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/HelpdeskArchitectureMap.cs:8`), plus the private [SpecTestMap](#spectestmap) fixture inside MMCA.Common's [SpecificationFitnessTests](#specificationfitnesstests). `FindRepoRoot` is called directly by every file-reading base: [DataResidencyTestsBase](#dataresidencytestsbase), [FormsConventionTestsBase](#formsconventiontestsbase), [FrameworkVersionConsistencyTestsBase](#frameworkversionconsistencytestsbase), [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase), [RawQueryableConventionTestsBase](#rawqueryableconventiontestsbase), [StateManagementConventionTestsBase](#statemanagementconventiontestsbase), and [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase).

### ArchitectureRules
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:3` · Level 3 · static partial class

- **What it is**: the reusable rule library: one large `static partial class` split across sixteen `ArchitectureRules.*.cs` files, whose methods each assert one architectural invariant across every applicable assembly a map declares. A repo's test classes reduce to a sealed subclass of the matching `*TestsBase` supplying its own map.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [Layer](#layer), [ArchitectureAssert](#architectureassert), [RuleHelpers](#rulehelpers), NetArchTest (`Types.InAssembly(...)`), `System.Xml.Linq` for the props-file rules, and, for the specification rule, `System.Linq.Expressions` plus [CrossEntityNavigationFinder](#crossentitynavigationfinder).
- **Concept introduced, the rule as a parameterized function.** Each method takes an `IArchitectureMap` and does its own loop, so the `*TestsBase` classes are thin `[Fact]` shells that delegate. The partial is organized by concern across the files `ArchitectureRules.{Controllers, Entities, Events, Governance, HandlerResults, Handlers, Immutability, Layers, Localization, LocalizedText, Modules, Naming, Purity, Slices, Specifications, Transport}.cs`. `[Rubric §3, Clean Architecture]`, `[Rubric §4, DDD]`, `[Rubric §7, Microservices Readiness]`, and `[Rubric §34, Architecture Governance]` all apply: this is where the codebase's structural decisions become executable assertions.
- **Walkthrough**: three representative shapes.
  - *NetArchTest shape*, `ControllersDoNotDependOnInfrastructure` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:6`): loops the map's per-module API layer refs, computes the forbidden Infrastructure namespace via `map.RootNamespace(...)`, runs `Types.InAssembly(...).That().HaveNameEndingWith("Controller").ShouldNot().HaveDependencyOnAny(forbidden)`, and reports through `ArchitectureAssert.NoViolations(result, ...)` (lines 8-18).
  - *Layer-flow shape*, `ArchitectureRules.Layers.cs`: one public method per forbidden edge, `DomainDoesNotDependOnApplication` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Layers.cs:12`) through `UiDoesNotDependOnInfrastructure` (line 60), all delegating to the private `LayerNotDependOnLayer` (line 101), which loops every assembly of the `from` layer and asserts no dependency on the `to` layer's namespace. Two non-vacuity rules sit alongside them: `LayerMapDeclaresLayers` (line 72) and `ModulesDeclareLayers` (line 89).
  - *Reflection shape*, `ControllersAreSealed` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:37`): enumerates `map.Api().ConcreteClasses` (the [RuleHelpers](#rulehelpers) extension property), filters non-sealed controllers via the private `IsController` (line 70, which matches on the `Controller` suffix or an MVC base type), and asserts the string offender list is empty. `ControllersInheritApiControllerBase` (line 54) is the same shape with a caller-supplied exempt set, accepting either [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) or [EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) as the base (lines 62-63).
- **Why it's built this way**: [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) records the intent: the rule bodies live *once* here, and each repo's architecture test project is a set of sealed subclasses supplying its map, so all four repos enforce identical rules. The compile-time `MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets` guards the same layer flow at build time as a second, faster gate.
- **Where it's used**: every `*TestsBase` in this group calls into it; those `[Fact]` methods are its public surface.
- **Caveats / not-in-source**: the full method roster spans sixteen partials; only the entry file and representative methods are cited here. The authoritative fitness-method and base-class counts are generated into `MMCA.Common/FACTS.md:43-48` and CI-gated, so read them there rather than counting by hand.

### ConstructorDependencyCountTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:14` · Level 3 · abstract class

- **What it is**: a single-responsibility-ceiling fitness function: it fails the build if any Application-layer `*Service` class has a constructor with more than the repo's accepted dependency count.
- **Depends on**: [IArchitectureMap](#iarchitecturemap) (via `Map.ModuleApplication()`), `[Fact]`, AwesomeAssertions, and reflection over constructors.
- **Concept introduced, quantifying the SRP smell.** `[Rubric §1, SOLID]` assesses single-responsibility discipline; a ballooning constructor-dependency list is the canonical smell, and this base turns a previously implicit judgement call into an enforced ceiling so the next service cannot silently grow past it (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:3-13`).
- **Walkthrough**: the subclass supplies `Map` (line 16) and the `MaxConstructorDependencies` high-water mark (line 22; it is abstract, so every repo states its own number). `ApplicationServices_DoNotExceedConstructorDependencyCeiling` (line 25) scans `Map.ModuleApplication()` for concrete `*Service` classes (lines 27-31), asserts at least one was found (non-vacuity, lines 33-34), computes each service's maximum constructor parameter count with `DefaultIfEmpty(0)` so a parameterless service does not throw (lines 36-47), and asserts none exceed the ceiling, naming offenders with their counts (lines 49-53).
- **Why it's built this way**: the ceiling is raised only with a conscious decision; repos without business modules (MMCA.Common itself) have nothing to scan and do not subclass this (lines 11-12). It overlaps the arity check in [HandlerConventionTestsBase](#handlerconventiontestsbase) but scopes specifically to service facades and lets a repo pin an exact number rather than take the shared default.
- **Where it's used**: subclassed in Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ConstructorDependencyCountTests.cs:10`) and ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:17`). MMCA.Helpdesk deliberately does not adopt it and records why in a comment: its Application layer is handlers-only, and the base's anti-vacuity guard fails when it finds no `*Service` at all (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:139-141`).

### AggregateConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: the minimal DDD aggregate fitness base for repos with *no* business modules (MMCA.Common itself): it asserts the Domain layer exposes aggregate roots, each built through a static `Create(...)` factory returning `Result<T>` with no public constructor, and that every domain or value-object factory returns a `Result`.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules), `[Fact]`.
- **Concept introduced, the thin delegating test base** shared by most Level-4 types in this group: a `protected abstract IArchitectureMap Map` plus one `[Fact]` per rule that forwards to an [ArchitectureRules](#architecturerules) method, with no logic of its own. The factory-returning-[Result](group-01-result-error-handling.md#result) idiom on [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) is what these rules verify. `[Rubric §4, DDD]` assesses aggregate discipline.
- **Walkthrough**: four `[Fact]`s, each a one-line delegate: `Domain_ShouldExpose_AggregateRoots` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:15`), `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 18), `AggregateRoots_ShouldHave_NoPublicConstructors` (line 21, which targets the framework-specific `DomainAggregateRootsHaveNoPublicConstructors` rule at `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Entities.cs:90` rather than the module-scoped one at line 115), and `DomainFactories_ShouldReturn_Result` (line 24, delegating to `ArchitectureRules.DomainFactoriesReturnResult`, `ArchitectureRules.Entities.cs:53`).
- **Why it's built this way**: module-bearing repos use the fuller [EntityConventionTestsBase](#entityconventiontestsbase) instead (lines 4-8); this base exists so a module-less repo still guards its aggregates.
- **Where it's used**: subclassed only in MMCA.Common's architecture test project (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9`).

### ConcurrencyConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a one-rule delegating base asserting that every `*UpdateRequest` implements [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware), so concurrent edits surface as 409 Conflict rather than silent last-write-wins.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape from [AggregateConventionTestsBase](#aggregateconventiontestsbase). `[Rubric §8, Data Architecture]` assesses optimistic-concurrency handling; carrying a RowVersion on every update request is how that concern is enforced at the contract level.
- **Walkthrough**: one `[Fact]` `UpdateRequests_ShouldImplement_IConcurrencyAware` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:13`) delegating to `ArchitectureRules.UpdateRequestsAreConcurrencyAware(Map)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:24`). The doc notes modules with no mutable aggregate are legitimately vacuous (lines 5-6).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:54`).

### ControllerConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: the presentation-layer convention base: controllers are thin and sealed, never reach Infrastructure or EF Core directly, and inherit the framework [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) for consistent Result-to-HTTP mapping.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); it adds a `protected virtual ControllersExemptFromApiControllerBase` list (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:12`) for controllers that legitimately bypass the base (for example a webhook endpoint that owns its own response semantics). `[Rubric §9, API & Contract Design]` assesses consistent controller shape.
- **Walkthrough**: four `[Fact]`s: `Controllers_ShouldNotDependOn_Infrastructure` (line 15), `Controllers_ShouldNotDependOn_EntityFrameworkCore` (line 18), `Controllers_ShouldBe_Sealed` (line 21), and `Controllers_ShouldInherit_ApiControllerBase` (line 24, passing the exempt list). The underlying rules live in `ArchitectureRules.Controllers.cs`.
- **Where it's used**: subclassed in every repo with business modules: Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:73`).

### DataResidencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:14` · Level 4 · abstract class

- **What it is**: a compliance-drift fitness function: the data-residency statement in a repo's `PRIVACY.md` must match the region where personal data is actually provisioned, and known-stale region claims must not reappear.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, `System.IO` (`File.ReadAllText`), AwesomeAssertions.
- **Concept introduced, a document-versus-infrastructure consistency gate.** `[Rubric §30, Compliance / Privacy / Data Governance]` assesses whether privacy claims track reality; this base fails the build if either the deployed region or the privacy policy changes without the other, closing the gap where a policy once claimed a region the data never lived in (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:3-13`).
- **Walkthrough**: the subclass supplies `Map` (line 16), the optional `ForbiddenResidencyClaims` list (line 23), and implements `ExtractDeployedRegion(repoRoot)` (line 53) against its own source of truth (the doc cites ADC parsing the SQL region default out of `deploy.yml` and Store parsing `infra/DISASTER-RECOVERY.md`). The single `[Fact]` `PrivacyPolicy_DataStorageRegion_MatchesDeployedRegion` (line 26) locates the repo root via `FindRepoRoot($"{Map.RepoToken}.slnx")` (line 28), asserts the extracted region is non-blank (lines 31-32), reads `PRIVACY.md`, then asserts the normalized policy contains the region (line 37) and none of the forbidden claims (lines 40-44). `Normalize` (line 57) strips whitespace and upper-cases (`ToUpperInvariant`, per CA1308), so "West US 2" matches the "westus2" token.
- **Where it's used**: subclassed in Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DataResidencyTests.cs:12`) and ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12`). Module-less MMCA.Common has no deployed region, and Helpdesk records it as N/A for reduced-scope reasons (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:142-143`).

### DependencyVersionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:15` · Level 4 · abstract class

- **What it is**: a dependency-pin fitness function guarding two commercial-license traps at build time: MassTransit must stay below v9 and SixLabors.ImageSharp below v4, both parsed out of `Directory.Packages.props`.
- **Depends on**: [ArchitectureRules](#architecturerules)`.PinnedPackageMajorBelow` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:38`), `[Fact]`. Note there is no `Map` on this base; it reads the props file directly through the rule.
- **Concept introduced, enforcing a policy pin as a test.** `[Rubric §32, Dependency & Supply-Chain]` assesses whether risky upgrades are guarded. The doc explains both traps: MassTransit v9 fails the startup license check and crashes every broker-enabled host while CI never starts a broker, so a blanket bump otherwise stays green (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:3-6`); ImageSharp v4's MSBuild targets fail without `$(SixLaborsLicenseKey)`, so a blanket bump breaks every build (lines 39-43).
- **Walkthrough**: `MassTransit_MustNotExceed_MajorVersion8` (line 25) loops `MassTransitPackageIds` (lines 17-22: `MassTransit`, `MassTransit.RabbitMQ`, `MassTransit.Azure.ServiceBus.Core`) and calls `PinnedPackageMajorBelow(packageId, exclusiveMajorCeiling: 9, ...)`. `ImageSharp_MustNotExceed_MajorVersion3` (line 48) does the same for `ImageSharpPackageIds` (line 45) with ceiling 4. Both id lists are `virtual` so a repo can override to an empty list when it does not pin the package.
- **Why it's built this way**: the doc is explicit (lines 8-13): the consumer repos (ADC, Store) do NOT pin MassTransit (it flows transitively via `MMCA.Common.Infrastructure`), so they must not subclass this base with the default list, or the "must remain pinned" assertion would fail on a pin they do not declare. The v8 pin is enforced only in MMCA.Common, where MassTransit is actually pinned.
- **Where it's used**: subclassed only in MMCA.Common, as the body-less [DependencyVersionTests](#dependencyversiontests) (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9`).

### DomainPurityTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a framework-independence base: Domain and Shared stay free of infrastructure frameworks, and Application stays host-agnostic (no EF Core, no ASP.NET Core).
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Purity.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); it adds an `ExtraForbiddenDomainDependencies` hook (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:12`) so a repo bans its own frameworks (the doc cites Store banning "Stripe" and ADC banning "RabbitMQ"). `[Rubric §3, Clean Architecture]` and `[Rubric §4, DDD]` assess the framework-free core.
- **Walkthrough**: four `[Fact]`s: `Domain_ShouldBe_FrameworkFree` (line 15) and `Shared_ShouldBe_FrameworkFree` (line 18), both passing the extra-forbidden list, then `Application_ShouldNotDependOn_EntityFrameworkCore` (line 21) and `Application_ShouldNotDependOn_AspNetCore` (line 24).
- **Where it's used**: subclassed in all four repos (Common, Store, ADC, and Helpdesk at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:10`).

### EntityConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:9` · Level 4 · abstract class

- **What it is**: the fuller DDD entity and aggregate convention base (the module-bearing counterpart to [AggregateConventionTestsBase](#aggregateconventiontestsbase)): entities are sealed and live only in Domain, aggregate roots use a `Create(...)` factory returning `Result<T>` with no public constructor, every domain and value-object factory returns a `Result`, and DTOs and requests stay out of Domain and Infrastructure.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Entities.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §4, DDD]` and `[Rubric §3, Clean Architecture]` apply.
- **Walkthrough**: seven `[Fact]`s: `Domain_ShouldExpose_AggregateRoots` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:14`), `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 17), `AggregateRoots_ShouldHave_NoPublicConstructors` (line 20, the module-scoped rule at `ArchitectureRules.Entities.cs:115`), `DomainFactories_ShouldReturn_Result` (line 23), `DomainEntities_ShouldBe_Sealed` (line 26), `DomainEntities_ShouldReside_InDomainLayer` (line 29), and `DtosAndRequests_ShouldNotResideIn_DomainOrInfrastructure` (line 32).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:78`).

### EventConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: an integration-event convention base (the doc cites [ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)): every concrete integration event inherits [BaseIntegrationEvent](group-04-events-outbox.md#baseintegrationevent), declares an `int SchemaVersion`, and lives in a `*.IntegrationEvents` namespace in the Shared layer.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Events.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §9, API & Contract Design]` assess versioned, discoverable cross-service event contracts. It pairs with [IntegrationEventContractTestsBase](#integrationeventcontracttestsbase), which freezes the exact shape.
- **Walkthrough**: three `[Fact]`s: `IntegrationEvents_ShouldDeclare_SchemaVersion` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:13`), `IntegrationEvents_ShouldInherit_BaseIntegrationEvent` (line 16), `IntegrationEvents_ShouldResideIn_SharedIntegrationEventsNamespace` (line 19).
- **Where it's used**: subclassed in every repo that publishes integration events: Store, ADC, Helpdesk (`ArchitectureTests.cs:38`), and MMCA.Common itself under the name `EventVersioningConventionTests` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/EventVersioningConventionTests.cs:10`).

### FormsConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:15` · Level 4 · abstract class

- **What it is**: a UX-safety fitness function: every admin `*Create.razor` form under `Source/Modules` must keep its unsaved-changes guard, dirty tracking, and validated `MudForm`, so those protections cannot silently regress.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, `System.IO` file enumeration, AwesomeAssertions.
- **Concept introduced, the markup-scanning fitness function** (it reads `.razor` text, not assemblies). `[Rubric §24, Forms / Validation / UX Safety]` assesses whether navigate-away data loss and missing validation are prevented; the base checks for six literal markers (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:27-35`): `UnsavedChangesGuard`, `IsDirtyAccessor` (bound through the live accessor to pre-empt the one-render stale-`IsDirty` lag, a §19 concern), `_isDirty`, `<MudForm`, `Required="true"`, and `RequiredError`. The marker list is `virtual`, so a repo can narrow or extend it.
- **Walkthrough**: the subclass supplies `Map` (line 17) and optionally a higher `MinimumCreateForms` count (line 24, default 1). `AdminCreateForms_KeepUnsavedChangesGuardAndValidation` (line 38) resolves the repo root, enumerates `*Create.razor` under `Source/Modules` excluding `obj` and `bin` (lines 43-48), asserts the discovered count meets the floor (lines 50-51), and records a violation naming each missing marker per form (lines 53-67).
- **Why it's built this way**: self-service forms with no navigate-away step (for example a single-section Profile password or delete form) carry no guard by design and simply must not match the `*Create.razor` glob (lines 10-13).
- **Where it's used**: subclassed in the repos with admin create forms, Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/FormsConventionTests.cs:14`) and ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:14`).

### FrameworkVersionConsistencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:13` · Level 4 · abstract class

- **What it is**: an evolvability and drift fitness function that makes [ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html) executable: all `MMCA.Common.*` packages in a consumer's `Directory.Packages.props` must be pinned to one version, so a partial sweep is caught at CI time.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, `System.Xml.Linq` (`XDocument`), AwesomeAssertions.
- **Concept introduced, enforcing the lockstep release policy.** `[Rubric §16, Maintainability]` and `[Rubric §32, Dependency & Supply-Chain]` assess coordinated versioning; the framework releases in lockstep with no phased rollout ([ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html)), and this gate fails if any `MMCA.Common.*` entry diverges (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:3-11`).
- **Walkthrough**: the subclass supplies `Map` (line 15) and optionally `MinimumCommonPackageCount` (line 22, default 13). `AllMmcaCommonPackages_ArePinnedToOneVersion` (line 25) loads `Directory.Packages.props` from the repo root (lines 27-30), selects every `PackageVersion` element whose `Include` starts with `MMCA.Common.` (lines 31-41), asserts the count meets the floor (lines 43-44), asserts none has an empty version (lines 46-48), and asserts the distinct-version count is exactly one, listing what it found (lines 50-56).
- **Why it's built this way**: MMCA.Common itself does not subclass this, because it declares no `MMCA.Common.*` pins; only consumers do (lines 9-11). The default floor is deliberately loose: the doc points at `MMCA.Common/FACTS.md:19` for the authoritative released-package count, and each consumer is expected to override the floor to its own known number.
- **Where it's used**: subclassed in Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9`), ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9`), and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:47`).

### HandlerConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: the CQRS handler convention base: handlers and validators live only in Application, handlers and services do not broker other handlers, and no `*Service` exceeds the god-class constructor-arity ceiling.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Handlers.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); it adds a `MaxServiceConstructorParameters` override (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:12`, default 8, matching the rule's own default at `ArchitectureRules.Handlers.cs:44`). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §1, SOLID]` apply; the CQRS decorator pipeline itself is taught in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to).
- **Walkthrough**: six `[Fact]`s: `Handlers_ShouldResideIn_ApplicationLayer` (line 15), `Handlers_ShouldNotInject_OtherHandlers` (line 18), `ApplicationServices_ShouldNotInject_Handlers` (line 21), `ApplicationServices_ShouldNotExceed_ConstructorArity` (line 24, passing the max), `Validators_ShouldResideIn_ApplicationLayer` (line 27), `EventHandlers_ShouldResideIn_ApplicationLayer_AndBeSealed` (line 30).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:68`). [ConstructorDependencyCountTestsBase](#constructordependencycounttestsbase) is the narrower, per-repo-pinned version of the arity check.

### HandlerResultConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:16` · Level 4 · abstract class

- **What it is**: an opt-in base asserting that every concrete command or query handler's `TResult` is [Result](group-01-result-error-handling.md#result) or `Result<T>` (or a type derived from them), turning a runtime-only constraint into a build-time gate.
- **Depends on**: [IArchitectureMap](#iarchitecturemap) and [ArchitectureRules](#architecturerules) (`ApplicationLayersDeclareHandlers`, `CommandHandlersReturnResult`, `QueryHandlersReturnResult`, at `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.HandlerResults.cs:18`, `:39`, `:48`).
- **Concept introduced, closing a deliberately unconstrained generic.** The CQRS interfaces carry no compile-time constraint on `TResult` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:6-7`), but the decorator pipeline's short-circuit paths (feature gate, validation) fabricate failures through [ResultFailureFactory](group-05-cqrs-pipeline.md#resultfailurefactory), which throws `InvalidOperationException` at runtime for any non-`Result` `TResult` (lines 7-9). A handler with the wrong result type therefore compiles cleanly and only fails when a gate short-circuits it. This base moves that failure to CI. `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §14, Testability]`, and `[Rubric §15, Best Practices & Code Quality]` apply.
- **Walkthrough**: three `[Fact]`s. `ApplicationLayers_DeclareAtLeastOneHandler` (line 21) is the non-vacuity guard the doc calls out (lines 12-13): a mis-pinned assembly cannot make the other two pass by finding nothing. `CommandHandlers_Return_ResultTypes` (line 24) and `QueryHandlers_Return_ResultTypes` (line 27) delegate to the matching rules.
- **Why it's built this way**: it is opt-in and map-driven like the rest of the family, so a repo adds it next to its other architecture test classes with the same `Map` and no other wiring.
- **Where it's used**: subclassed in MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/HandlerResultConventionTests.cs:12`), Store, and ADC.

### ImmutabilityTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: an immutability convention base: DTOs, command and query messages, domain events, integration events, and value objects expose no public mutable (non-`init`) setter; value objects are additionally sealed and confined to the Shared layer.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Immutability.cs`), which uses [RuleHelpers](#rulehelpers)`.HasPublicMutableSetter` underneath.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the `init`-only versus mutable distinction is exactly what `HasPublicMutableSetter` detects via the `IsExternalInit` modifier. `[Rubric §15, Best Practices & Code Quality]` and `[Rubric §4, DDD]` assess immutable contracts and value objects.
- **Walkthrough**: five `[Fact]`s: `Dtos_ShouldBe_Immutable` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:13`), `CommandsAndQueries_ShouldBe_Immutable` (line 16), `DomainEvents_ShouldBe_Immutable` (line 19), `IntegrationEvents_ShouldBe_Immutable` (line 22), `ValueObjects_ShouldBe_ImmutableSealedAndInShared` (line 25).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:83`).

### IntegrationEventContractTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:11` · Level 4 · abstract class

- **What it is**: a frozen wire-contract guard: it rebuilds the live integration-event contract (one line per event, `FullName { Prop:Type, ... }`) and compares it to a committed snapshot the subclass supplies, so a renamed, removed, or retyped property (or a new event shipped without its consumer) fails the build.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules)`.BuildIntegrationEventContract` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Events.cs:45`), AwesomeAssertions.
- **Concept introduced, the snapshot fitness function.** `[Rubric §9, API & Contract Design]` and `[Rubric §7, Microservices Readiness]` assess whether cross-service contracts stay stable; because a consumer in another service deserializes by shape, this gate makes any contract change a deliberate, coordinated commit.
- **Walkthrough**: the subclass supplies `Map` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:13`) and the committed `ExpectedContract` snapshot (line 16). `IntegrationEventContracts_ShouldMatch_TheFrozenSnapshot` (line 19) builds the actual contract (line 21) and asserts `actual.Should().Equal(ExpectedContract, ...)` (lines 23-28), the message instructing the author to version the event and update `ExpectedContract` in the same commit when a change is intentional.
- **Where it's used**: subclassed in the repos publishing integration events: Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:88`). It complements [EventConventionTestsBase](#eventconventiontestsbase).

### LayerDependencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: the Clean Architecture layer-flow base: fifteen `[Fact]`s asserting that the map declares the expected layers at all, and that each layer references only layers below it (Domain not on Application, Infrastructure, or API; Application not on Infrastructure or API; Shared on nothing above it; UI only on Shared).
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Layers.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); this is the runtime half of the two-gate layer enforcement described in [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html), the compile-time half being `MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets`. `[Rubric §3, Clean Architecture]` is the whole point.
- **Walkthrough**
  - Two overridable declarations come first: `RequiredLayers` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:16`, defaulting to the five core layers Shared, Domain, Application, Infrastructure, Api) and `RequiredModuleLayers` (line 24, defaulting to the same list and trimmable for a deliberately thin module).
  - Two non-vacuity `[Fact]`s guard the rest: `LayerMap_DeclaresEveryExpectedLayer` (line 27) and `LayerMap_ModulesDeclareEveryExpectedLayer` (line 30). Without them a map that forgot an assembly would satisfy every dependency rule by having nothing to check.
  - Thirteen forbidden-edge `[Fact]`s follow, each a one-line delegate onto an `ArchitectureRules.Layers.cs` method: `Domain_ShouldNotDependOn_Application` (line 33) through `Ui_ShouldNotDependOn_Infrastructure` (line 69). The UI trio (lines 63-69) encodes the documented exception that UI depends only on Shared for Blazor WASM compatibility.
- **Where it's used**: subclassed in all four repos (Common at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9`, Store, ADC, and Helpdesk at `ArchitectureTests.cs:5`).

### LocalizationResourceTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: an opt-in translation-coverage gate ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)): a repo that ships localized `.resx` resources subclasses this and lists its required cultures; the build fails if any base `.resx` under `Source/` lacks a complete, non-empty sibling for a required culture.
- **Depends on**: [ArchitectureRules](#architecturerules)`.ResourceTranslationsAreComplete` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Localization.cs:23`), `[Fact]`. There is no `Map` on this base; it scans `Source/` directly through the rule.
- **Concept introduced, a coverage fitness function for i18n.** `[Rubric §27, i18n]` assesses translation completeness; this gate ensures a new English string can never ship without its translation (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:3-8`).
- **Walkthrough**: the subclass supplies `RequiredCultures` (line 13, for example `["es"]`) and optionally `MinimumBaseResources` (line 21, a non-vacuity floor whose default of 0 skips the guard). The single `[Fact]` `Translations_AreComplete_ForEveryRequiredCulture` (line 24) passes both to the rule.
- **Why it's built this way**: single-locale repos need not subclass it (the rule is vacuous for an empty list). It pairs with [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase): this gate keeps the extracted resources translated, that gate keeps literals out of markup.
- **Where it's used**: subclassed in MMCA.Common as [LocalizationResourceTests](#localizationresourcetests) (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizationResourceTests.cs:12`) and in Store, ADC, and Helpdesk under the name `TranslationCompletenessTests`; Helpdesk's requires `["es"]` with a floor of 3 (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:119-125`).

### LocalizedTextConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:13` · Level 4 · abstract class

- **What it is**: a localized-text convention gate ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)): user-visible literals must not be hard-coded in `.razor` or `.razor.cs` under `Source/` (snackbar messages, page `Title` properties, `<PageTitle>` markup, breadcrumb labels) but resolve through `IStringLocalizer` resources.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, [ArchitectureRules](#architecturerules)`.UserVisibleTextIsLocalized` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.LocalizedText.cs:47`).
- **Concept**: cross-references the markup-scanning gate idea from [FormsConventionTestsBase](#formsconventiontestsbase). `[Rubric §27, i18n]` assesses that visible strings follow the selected language.
- **Walkthrough**: the subclass supplies `Map` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:15`) and optionally `MinimumScannedFiles` (line 21, default 1) and `AllowedFiles` (line 28, whole-file exemptions; the preferred exemption is a per-line `i18n: allow` comment, per the class doc at lines 8-10). `UserVisibleText_IsLocalized` (line 31) resolves the repo root and delegates to the rule with the `Source` directory, the allowlist, and the floor (lines 33-37).
- **Where it's used**: subclassed in all four repos (Common, Store, ADC, and Helpdesk at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:131`, which sets a floor of 5). It pairs with [LocalizationResourceTestsBase](#localizationresourcetestsbase).

### MicroserviceExtractionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a transport-boundary base for the modular-monolith to microservices path: MassTransit, gRPC, and Protobuf must never leak into Domain, Application, or Shared, so a module behaves identically in-process or extracted and the split stays reversible.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Transport.cs:19`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the extraction invariant (application and domain code talks to abstractions, transport choices live at the edges) is the [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) / [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) / [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) story the doc cites (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:3-6`). `[Rubric §7, Microservices Readiness]` assesses exactly this reversibility.
- **Walkthrough**: one `[Fact]` `CoreLayers_ShouldNotDependOn_Transport` (line 13) delegating to `ArchitectureRules.TransportDoesNotLeakIntoCoreLayers(Map)`.
- **Where it's used**: subclassed in all four repos (Common at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10`, Store, ADC, and Helpdesk at `ArchitectureTests.cs:100`).

### ModuleIsolationTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a modular-monolith boundary base: a module must not reach another module's internal layers; cross-module communication goes only through the Shared (contract) layer. It is vacuous for single-module or module-less repos.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Modules.cs`), which uses `OtherModuleNamespaces` to compute the forbidden targets.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §5, Vertical Slice]` and `[Rubric §7, Microservices Readiness]` assess module autonomy. The [IModule](group-14-module-system-composition.md#imodule) system is taught in Group 14.
- **Walkthrough**: six `[Fact]`s covering each layer's isolation: `ModuleDomains_ShouldBe_Isolated` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:13`), `ModuleApplications_ShouldBe_Isolated` (line 16), `ModuleInfrastructures_ShouldBe_Isolated` (line 19), `ModuleApis_ShouldBe_Isolated` (line 22), plus the two cross-layer reach rules `ModuleDomains_ShouldNotReach_OtherModuleInfrastructures` (line 25) and `ModuleApplications_ShouldNotReach_OtherModuleInfrastructures` (line 28).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:15`, where the single-module seed makes it deliberately vacuous but future-proof).

### NamingConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a naming and sealing convention base across the CQRS plus DDD building blocks: handlers, command and query messages, validators, DTOs, domain events, invariants, EF configurations, specifications, and repositories each follow their established suffix and sealing convention.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Naming.cs`), which uses [RuleHelpers](#rulehelpers)`.SimpleName` to match suffixes on generic types.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §15, Best Practices & Code Quality]` and `[Rubric §16, Maintainability]` assess consistent, discoverable naming.
- **Walkthrough**: ten `[Fact]`s: `Handlers_ShouldBeSealed_WithHandlerSuffix` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:13`), `Commands_ShouldHave_CommandOrRequestSuffix` (line 16), `Queries_ShouldHave_QuerySuffix` (line 19), `Validators_ShouldHave_ValidatorOrRulesSuffix` (line 22), `SharedDtos_ShouldHave_DtoOrLookupSuffix` (line 25), `DomainEvents_ShouldBeSealed_InDomainEventsNamespace` (line 28), `InvariantClasses_ShouldBe_Static` (line 31), `EfConfigurations_ShouldBeSealed_WithConfigurationSuffix` (line 34), `Specifications_ShouldBeSealed_WithSpecificationSuffix` (line 37), `Repositories_ShouldHave_RepositorySuffix` (line 40).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:63`).

### PiiConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: a GDPR/CCPA right-to-erasure base ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)): any domain entity that declares a [PiiAttribute](group-02-domain-building-blocks.md#piiattribute)-marked property must implement [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable), so it has an erasure path.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Governance.cs:11`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the `[Pii]` plus `IAnonymizable` soft-delete-versus-erasure model is taught in [Group 02](group-02-domain-building-blocks.md#piiattribute) ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). `[Rubric §30, Compliance / Privacy / Data Governance]` and `[Rubric §11, Security]` assess erasure discipline.
- **Walkthrough**: one `[Fact]` `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:12`) delegating to `ArchitectureRules.EntitiesWithPiiImplementAnonymizable(Map)`.
- **Where it's used**: subclassed in all four repos (Common at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13`, Store, ADC, and Helpdesk at `ArchitectureTests.cs:105`).

### RawQueryableConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RawQueryableConventionTestsBase.cs:30` · Level 4 · abstract partial class

- **What it is**: an opt-in extraction-readiness gate: Application-layer code must not use the repository's raw `IQueryable` surfaces (`Table`, `TableNoTracking`, `TableNoTrackingSingleQuery`, `TableNoTrackingSplitQuery` on [IReadRepository<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype)), because a handler written against a raw queryable is EF-coupled and its query shape cannot cross a gRPC boundary.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, [ArchitectureAssert](#architectureassert), `System.IO` enumeration, and a source-generated `Regex` (`System.Text.RegularExpressions`).
- **Concept introduced, the honest textual scan (and its stated limits).** The doc is unusually candid about the tradeoff (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RawQueryableConventionTestsBase.cs:13-23`): NetArchTest and plain reflection cannot see member *usage* inside method bodies, and this package deliberately carries no IL or Roslyn dependency, so the rule reads `.cs` text instead. It cannot see through variable indirection (an interface alias re-exposing the queryable is missed), and because it skips only whole-line `//` comments, a match inside a string literal or trailing comment is a rare false positive. `[Rubric §7, Microservices Readiness]` is the invariant being protected; `[Rubric §8, Data Architecture]` and `[Rubric §16, Maintainability]` apply to the handler style it pushes toward (focused repository methods, readers, queriers, specifications).
- **Walkthrough**
  - `AllowedFiles` (line 38) is the adoption ratchet: a repo with existing violations subclasses, runs once, and moves the reported file names in, so new files stay clean while the list shrinks (lines 24-28).
  - `ApplicationSourceDirectories()` (line 45) defaults to locating each declared module's Application project directory under the repo's `Source/` tree by project name (lines 47-57), and is `virtual` for a custom layout.
  - The `[Fact]` `ApplicationLayer_DoesNotUseRawQueryableSurfaces` (line 61) first asserts the directory list is non-empty, with a message telling the author to override the directory hook (lines 65-66), then enumerates every `.cs` file, skipping `obj`, `bin`, and allowlisted file names (lines 71-79), and reports through `ArchitectureAssert.NoViolations` (line 84).
  - `ScanFile` (line 88) yields `fileName:lineNumber: trimmed line` for every non-comment line matching `RawQueryableAccessRegex` (line 103), a `[GeneratedRegex]` partial property matching `\.Table(NoTracking(SingleQuery|SplitQuery)?)?\b` with a 2000 ms match timeout.
- **Why it's built this way**: making the offender message carry the file and line (lines 96-98) is what makes a textual gate actionable; combined with the allowlist ratchet it can be adopted in a repo that is not yet clean.
- **Where it's used**: subclassed opt-in in MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/RawQueryableConventionTests.cs:13`), Store, and ADC. Because it is a ratchet, a repo's `AllowedFiles` override is the record of its remaining debt.

### SharedLayerTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: a Shared (contract) layer base: a module's Shared is contracts-only, so it must not depend on its own internal layers, on another module's Shared, or on EF Core.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Modules.cs:32`, `:51`, `:55`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §3, Clean Architecture]` and `[Rubric §5, Vertical Slice]` assess a clean contract boundary a would-be extracted consumer can reference safely.
- **Walkthrough**: three `[Fact]`s: `ModuleShared_ShouldNotDependOn_OwnInternalLayers` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:12`), `ModuleShared_ShouldBe_Isolated` (line 15), `ModuleShared_ShouldNotDependOn_EntityFrameworkCore` (line 18).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:20`).

### SliceCohesionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: a vertical-slice cohesion base: a use-case slice keeps its command or query, its handler, and its validator together in one namespace, so a feature is a cohesive unit rather than spread across horizontal `Handlers/` and `Validators/` folders.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Slices.cs:13`, `:41`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §5, Vertical Slice]` assesses feature cohesion. The doc notes MMCA.Common scopes to its Notifications slices while ADC and Store scope to their module Application layers (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:6-8`).
- **Walkthrough**: two `[Fact]`s: `Handlers_ShouldBeCoLocatedWith_TheirContracts` (line 15) and `Validators_ShouldBeCoLocatedWith_TheirContracts` (line 19).
- **Where it's used**: subclassed in all four repos (Common at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SliceCohesionTests.cs:10`, Store, ADC, and Helpdesk at `ArchitectureTests.cs:110`).

### SpecificationConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: an opt-in base for the Specification pattern in polyglot / database-per-service repos: it guarantees no specification filters by navigating to another entity, which would not translate when that entity lives in a different physical source.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules)`.SpecificationsDoNotNavigateToOtherEntities`, backed by [CrossEntityNavigationFinder](#crossentitynavigationfinder).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) pattern is taught in Group 03. `[Rubric §8, Data Architecture]` assesses engine-portable query design.
- **Walkthrough**: one `[Fact]` `Specifications_ShouldNotNavigate_ToOtherEntities` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:16`) delegating to the rule. The doc notes single-engine repos need not subclass it (lines 4-8).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:29`). MMCA.Common exercises the same rule from the other side, through [SpecificationFitnessTests](#specificationfitnesstests) and its private [SpecTestMap](#spectestmap) fixture.

### StateManagementConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:17` · Level 4 · abstract class

- **What it is**: a Blazor Server state-management gate: user and session state must live in per-circuit scoped services, never in mutable `static` members (which leak one user's state to another) or in singleton-registered stateful services.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, reflection over the UI assemblies, a `Source/` file scan, and `System.Runtime.CompilerServices.CompilerGeneratedAttribute`.
- **Concept introduced, a reflection plus source-scan combined gate.** `[Rubric §19, State Management]` assesses per-circuit state safety; Blazor Server shares one process across every circuit, so a static member is shared across every user (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:5-16`).
- **Walkthrough**: the subclass supplies `Map` (line 19, whose UI assemblies must be registered under `Layer.Ui`) and optionally `AllowedStaticMembers` (line 25).
  - `UiAssemblies_CarryNoMutableStaticState` (line 28) reflects over `Map.OfLayer(Layer.Ui)`, first asserting the set is non-empty (lines 32-33), then skipping enums, interfaces, and compiler-generated types (line 40) before flagging any declared static field that is not `readonly`, not `const`, and not compiler-generated, plus any settable static property, minus the exempted members (lines 45-56).
  - `UiProjects_RegisterStatefulServicesScoped` (line 66) scans `Source/` `.cs` files (skipping `obj`, `bin`, non-`.UI` paths, and `Testing` paths, lines 74-80) for a line containing both `AddSingleton` and a `StateService`/`StateContainer` name, recording `fileName:lineNumber` as an offender (lines 85-90).
  - The private `GetLoadableTypes` (line 99) repeats the tolerant load locally rather than using the internal [RuleHelpers](#rulehelpers), and `IsCompilerGenerated` (line 111) treats any member name containing `<` as generated, or one carrying `CompilerGeneratedAttribute`.
- **Where it's used**: subclassed in the repos with Blazor UI assemblies: MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:11`), Store, and ADC.

### UIArchitectureConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:14` · Level 4 · abstract class

- **What it is**: a UI-architecture convention gate holding the container and presentational split with two mechanical line-count caps: a `*.razor.cs` code-behind stays within `MaxCodeBehindLines`, and a `.razor` file's inline `@code` block stays within `MaxInlineCodeLines`.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, `System.IO` file enumeration, AwesomeAssertions.
- **Concept introduced, enforcing a design convention by file metrics.** `[Rubric §18, UI Architecture]` assesses the container/presentational discipline; a ballooning code-behind signals page logic that belongs in an injected UI service or an extracted sub-component, and putting a number on it moves the judgement from review to CI (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:3-13`).
- **Walkthrough**: the subclass supplies `Map` (line 16); the caps `MaxCodeBehindLines` (line 22, default 400), `MaxInlineCodeLines` (line 29, default 120), `MinimumCodeBehindFiles` (line 35, a non-vacuity floor, default 1), and `ExcludedPathFragments` (line 41) are all overridable.
  - `CodeBehinds_StayWithinTheLineCap` (line 44) enumerates `*.razor.cs`, asserts the floor (lines 48-49), and flags files over the cap with their line counts (lines 51-59).
  - `RazorFiles_KeepInlineCodeBlocksSmall` (line 63) finds each `.razor` file's `@code` line and measures the tail block from there to end of file (line 77), flagging it when it exceeds the inline cap.
  - `EnumerateSourceFiles` (line 89) drives both, resolving the repo root and excluding `obj`, `bin`, and the excluded fragments.
- **Caveats / not-in-source**: the inline-`@code` measurement assumes the block is the file's tail (stated in the doc at lines 24-28), so a `.razor` file with markup after its `@code` block would over-count.
- **Where it's used**: subclassed in the repos with Blazor UI: MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/UIArchitectureConventionTests.cs:11`), Store, and ADC.

### AccessibilityViolationException
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7` · Level 0 · sealed class

- **What it is**: the exception thrown when an axe-core accessibility scan finds one or more WCAG violations on the page under test.
- **Depends on**: `System.Exception` (BCL) only. Its XML doc names the single thrower, [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync` (`MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:3-6`).
- **Concept introduced, the accessibility gate as a hard failure.** Rather than logging a warning or returning a result object, a violated a11y scan throws, so a consumer E2E `[Fact]` that calls `AssertNoAccessibilityViolationsAsync` goes red and names the offending elements. `[Rubric §21, Accessibility]` assesses whether accessibility is verified rather than assumed; a dedicated exception type makes an a11y regression a first-class, catchable build failure. `[Rubric §28, Front-End Testing]` assesses whether the UI is exercised through realistic automated checks; this is the failure primitive those checks throw.
- **Walkthrough**: three constructors, the parameterless, message, and message-plus-inner overloads (`AccessibilityViolationException.cs:10`, `:15`, `:21`), the standard exception shape. It carries no extra state: the human-readable violation summary is baked into the `message` string the thrower builds.
- **Why it's built this way**: a purpose-named exception (not a bare `Exception` or `InvalidOperationException`) lets a test that deliberately probes a known-inaccessible page assert on exactly this type, and it reads clearly in a failure log.
- **Where it's used**: thrown only by [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync` (`MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:180-181`), which is in turn called by the `ScanAsync`/`ScanGridAsync` helpers on [E2ETestBase](#e2etestbase) and by the `*_ShouldHaveNoAccessibilityViolations` facts on the workflow bases.

### AdminCredentials
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:66` · Level 0 · nested static class

- **What it is**: a nested static class on [E2ETestConfiguration](#e2etestconfiguration) that resolves the seeded admin login (email and password) for E2E runs, with an environment-variable override in front of a per-app default.
- **Depends on**: `System.Environment` (BCL). It is the admin half of the credential pair; [UserCredentials](#usercredentials) is its structurally identical regular-user twin.
- **Concept**: the environment-over-default resolution taught in [E2ETestConfiguration](#e2etestconfiguration). `DefaultEmail`/`DefaultPassword` have public setters so a downstream app seeds its own admin identity from a `[ModuleInitializer]`, while `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` win when set. `[Rubric §11, Security]` assesses how test credentials are handled; keeping them out of committed app code and injectable per environment is the safe end of that.
- **Walkthrough**: `DefaultEmail` is `"admin@localhost"` and `DefaultPassword` is `"Admin123!"` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:68-69`); `Email` and `Password` read `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` and fall back to those defaults (`:71-75`).
- **Where it's used**: read by [E2ETestBase](#e2etestbase)`.LoginAsAdminAsync` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:79-80`). Both consumer suites overwrite the default from a module initializer: `admin@mmca.com` in Store (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Infrastructure/TestSetup.cs:10`) and `admin@adc.com` in ADC (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Infrastructure/TestSetup.cs:14`).

### AxeOptions
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9` · Level 0 · static class

- **What it is**: the shared axe-core run options that scope every accessibility scan to one documented target, WCAG 2.1 AA, so the framework gallery and all downstream apps scan against the same rule set.
- **Depends on**: `Deque.AxeCore.Commons` (NuGet: `AxeRunOptions`, `RunOnlyOptions`, `RuleOptions`, `MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:1`).
- **Concept introduced, the scoped accessibility target.** A raw axe run also emits "best-practice" advisories that are not conformance failures; pinning `RunOnly` to the WCAG tag set makes the gate fail only on real WCAG 2.1 AA violations (`AxeOptions.cs:11-16`). `[Rubric §21, Accessibility]` assesses whether the accessibility bar is explicit and enforced; freezing the target in one shipped object is how three repos stay honest to the same standard. `[Rubric §22, Responsive/Cross-Browser]` also applies through the pager exception below, which documents a specific third-party component limitation.
- **Walkthrough**: two static presets, both read-only properties initialized once.
  - `Wcag21Aa` (`AxeOptions.cs:17`) sets `RunOnly` to `Type = "tag"` with the four WCAG A/AA tag values `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` (`:19-23`). This is the target for every strict scan.
  - `Wcag21AaExceptMudPagerCombobox` (`:35`) repeats that tag set and adds a `Rules` dictionary disabling `aria-input-field-name` (`:42-45`), for grid list pages whose only violation is MudBlazor's internal `MudTablePager` "rows per page" select. The XML doc (`:26-34`) records the detail: MudBlazor 9.6.0 mirrored combobox semantics onto the hidden-input presenter, the pager's own select gets no accessible name, and it is not reachable from app markup (no `Label` or `aria-label` parameter on `MudTablePager`), so this is an accepted upstream limitation. The doc warns it must be used only on a page whose sole combobox is a pager.
- **Why it's built this way**: shipping the options in the package rather than re-declaring them per test guarantees every consumer scans the identical rule set; the narrowly scoped pager exception keeps one known third-party gap from forcing a blanket rule-disable across all scans.
- **Where it's used**: passed to [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync` through [E2ETestBase](#e2etestbase)`.ScanAsync` (strict) and `.ScanGridAsync` (pager exception) at `MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:276` and `:284`, and directly by the `*_ShouldHaveNoAccessibilityViolations` facts on [UserLoginTestsBase](#userlogintestsbase), [UserRegistrationTestsBase](#userregistrationtestsbase), and [ProfileManagementTestsBase](#profilemanagementtestsbase).

### E2ETestConfiguration
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8` · Level 0 · static class

- **What it is**: the single environment-variable-driven configuration surface for the whole E2E package: base URL, headless mode, timeouts, browser engine, slow-motion and trace capture, plus the nested [AdminCredentials](#admincredentials) and [UserCredentials](#usercredentials).
- **Depends on**: `System.Environment` (BCL) only.
- **Concept introduced, environment-driven test configuration.** Every knob resolves as "read an `E2E_*` environment variable, else use a default", so the same compiled suite runs against localhost on a developer box and against a CI-provisioned host with no code change. A few `Default*` properties carry public setters so a consuming app supplies app-specific defaults through a `[ModuleInitializer]`, while environment variables always take precedence (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:3-7`). `[Rubric §17, DevOps]` assesses whether the suite is CI-portable and configurable outside the binary; this class is that story. `[Rubric §22, Responsive/Cross-Browser]` applies because `Browser` selects the engine CI iterates over.
- **Walkthrough**: teaching order.
  - `DefaultBaseUrl` (settable, `https://localhost:7108`, `E2ETestConfiguration.cs:10`) and `BaseUrl`, which prefers `E2E_BASE_URL` (`:12-13`). ADC's module initializer overrides that default to `https://localhost:6002`, the port its AppHost pins the Blazor UI to (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Infrastructure/TestSetup.cs:13`).
  - `Headless` treats any value other than `"false"` as headless, compared case-insensitively (`:15-16`); `SlowMo` slows each Playwright action by an environment-set millisecond count for visual debugging, default 0 (`:45-46`).
  - `DefaultTimeout` (30_000 ms, from `E2E_TIMEOUT`, `:18-19`) is the general action timeout. `AuthTimeout` (`:27-28`) is a separately tunable ceiling for the slowest step, the post-auth wait, inheriting `DefaultTimeout` unless `E2E_AUTH_TIMEOUT` is set. `AuthGraceTimeout` (15_000 ms, `E2E_AUTH_GRACE`, `:38-39`) is the extra grace window that de-flakes the register/login success-detection race, the transient error-alert flash during a Server-mode `forceLoad`.
  - `Browser` selects `chromium` (default), `firefox`, or `webkit` from `E2E_BROWSER` (`:53-54`); `TracePath` returns a non-empty `E2E_TRACE` path or null, enabling full-speed Playwright trace capture (`:63-64`).
- **Why it's built this way**: separating `AuthTimeout` and `AuthGraceTimeout` from the general `DefaultTimeout` is deliberate. The auth round-trip (full sign-in plus `forceLoad` reload plus re-render) can spike past a normal action budget on a contended CI runner, so it is tuned independently rather than by inflating every timeout in the suite. The doc ties the grace window to the TD-06/07 contention cluster and names the rejected alternative, forcing WASM, which broke login (`:30-36`).
- **Where it's used**: read throughout [PlaywrightFixture](#playwrightfixture) (engine, headless, slow-mo) and [E2ETestBase](#e2etestbase) (base URL, timeouts, trace path, credentials).

### LoginPage
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6` · Level 0 · sealed class

- **What it is**: the Page Object for the shared `/login` screen. It exposes the login form's controls as named `ILocator` properties and offers `GotoAsync`/`LoginAsync` actions, so a test says `loginPage.LoginAsync(email, password)` instead of hand-querying the DOM.
- **Depends on**: `Microsoft.Playwright` (`IPage`, `ILocator`, `AriaRole`) and the [PageExtensions](#pageextensions) helpers `GotoAndWaitForBlazorAsync` and `FillAndVerifyAsync` (`MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:1-2`).
- **Concept introduced, the Page Object Model.** A Page Object wraps one screen behind an intention-revealing API, locating controls by their accessible name (`GetByLabel("Email")`, `GetByRole(AriaRole.Button, Name = "Sign in to your account")`) rather than by brittle CSS. That keeps tests coupled to what a user sees, not to MudBlazor's internal class names, and it centralizes each selector in one place. `[Rubric §28, Front-End Testing]` assesses whether E2E tests are maintainable; the Page Object is the canonical pattern for that. `[Rubric §21, Accessibility]` applies indirectly: locating by role and label only works if the component renders proper accessible names, so the test style pressures accessible markup.
- **Walkthrough**: a private `IPage` field set in the constructor (`LoginPage.cs:8-10`); locator properties for `EmailField`, `PasswordField`, `LoginButton`, the `ErrorAlert` (MudBlazor's `.mud-alert-text-error` class), and the `CreateAccountLink`, which the inline comment explains is a MudButton with `Href` and therefore renders as an `<a>` located by link role (`:12-18`). `GotoAsync` navigates through `GotoAndWaitForBlazorAsync("/login")` (`:20-21`); `LoginAsync` fills both fields through the shared `FillFieldAsync` and then clicks (`:23-28`). The private `FillFieldAsync` delegates to [PageExtensions](#pageextensions)`.FillAndVerifyAsync` (`:31-32`), guarding the Blazor re-hydration race without a fixed delay.
- **Where it's used**: instantiated by [UserLoginTestsBase](#userlogintestsbase) for the invalid-password, create-account-link, and accessibility facts.

### ProfilePage
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:6` · Level 0 · sealed class

- **What it is**: the Page Object for the authenticated `/profile` screen, exposing the name, address, and password sections' fields and buttons as named locators.
- **Depends on**: `Microsoft.Playwright` and [PageExtensions](#pageextensions)`.BlazorNavigateAsync` (`MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:1-2`).
- **Concept**: the Page Object Model taught in [LoginPage](#loginpage). One difference is load-bearing: `GotoAsync` uses `BlazorNavigateAsync("/profile")`, client-side routing (`ProfilePage.cs:34-35`), not a full page load, because `/profile` is `[Authorize]` and server-side rendering cannot read the JWT from browser storage, so a full load would bounce to `/login`. `[Rubric §28, Front-End Testing]` and `[Rubric §11, Security]` both apply: exercising the authenticated page correctly requires respecting the client-token boundary.
- **Walkthrough**: three grouped sets of locators. Name (`FirstNameField`, `LastNameField`, `SaveNameButton`, `:13-15`), address (`AddressLine1Field` through `CountryField` plus `SaveAddressButton`, `:18-24`), and password (`CurrentPasswordField`, `NewPasswordField` with `Exact = true` so it does not also match "Confirm New Password", `ConfirmNewPasswordField`, `ChangePasswordButton`, `:27-30`), plus a generic `ErrorAlert` located by the alert role (`:32`). This Page Object has no bulk action method: each fact drives the individual locators.
- **Where it's used**: instantiated throughout [ProfileManagementTestsBase](#profilemanagementtestsbase).

### RegisterPage
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:6` · Level 0 · sealed class

- **What it is**: the Page Object for the `/register` screen, exposing the registration form (name, email, password, plus the optional address panel) and a `RegisterAsync` action.
- **Depends on**: `Microsoft.Playwright` and [PageExtensions](#pageextensions)`.GotoAndWaitForBlazorAsync`/`FillAndVerifyAsync` (`MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:1-2`).
- **Concept**: the Page Object Model taught in [LoginPage](#loginpage), applied to a longer form. `PasswordField` uses `GetByLabel("Password", Exact = true)` so it does not also match "Confirm Password" (`RegisterPage.cs:15`), and the optional address fields sit inside an expansion panel located by its text (`:24-29`). `[Rubric §28, Front-End Testing]` applies.
- **Walkthrough**: locator properties for the five required fields plus `RegisterButton` and `ErrorAlert` (`:12-18`), the `AlreadyHaveAccountLink` sign-in link (`:21`), and the optional address panel and fields (`:24-29`). `GotoAsync` full-loads `/register` (`:31-32`); `RegisterAsync` fills the five required fields through the shared helper, reusing the same password for the confirm field, then clicks (`:34-42`); the private `FillFieldAsync` delegates to [PageExtensions](#pageextensions)`.FillAndVerifyAsync` (`:48-49`).
- **Where it's used**: instantiated by [UserRegistrationTestsBase](#userregistrationtestsbase) for all four of its facts.

### UserCredentials
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:78` · Level 0 · nested static class

- **What it is**: the regular (non-admin) counterpart to [AdminCredentials](#admincredentials), a nested static class on [E2ETestConfiguration](#e2etestconfiguration) resolving the seeded customer login, environment override in front of a per-app default.
- **Depends on**: `System.Environment` (BCL).
- **Concept**: identical in shape to [AdminCredentials](#admincredentials); only the environment-variable names and the defaults differ.
- **Walkthrough**: `DefaultEmail` is `"user@localhost"` and `DefaultPassword` is `"User123!"` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:80-81`); `Email`/`Password` prefer `E2E_CUSTOMER_EMAIL`/`E2E_CUSTOMER_PASSWORD` (`:83-87`).
- **Where it's used**: read by [E2ETestBase](#e2etestbase)`.LoginAsUserAsync` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:82-83`); the default is overridden to `customer@mmca.com` in Store and `customer@adc.com` in ADC (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Infrastructure/TestSetup.cs:11`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Infrastructure/TestSetup.cs:15`).

### WebVitalsSample
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:73` · Level 0 · sealed record

- **What it is**: an immutable record holding one page's measured Core Web Vitals: `Lcp`, `Cls`, `Fcp`, `Ttfb`, and `Inp` (milliseconds, except unitless CLS).
- **Depends on**: `System.Text.Json.Serialization.JsonPropertyName` (BCL) for the lowercase wire names.
- **Concept introduced, the vitals value object.** Each property is `init`-only with a short JSON name (`lcp`, `cls`, `fcp`, `ttfb`, `inp`, `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:75-83`), so the record deserializes directly from the `window.__vitals` JSON the browser observers accumulate. `[Rubric §23, Front-End Performance]` assesses whether client-side performance is measured; this record is the typed shape those measurements land in.
- **Walkthrough**: a sealed record with five `init` doubles and no behavior (`WebVitalsCollector.cs:73-84`). It is the deserialization target of [WebVitalsCollector](#webvitalscollector)`.CollectAsync`, which falls back to a fresh all-zero instance when the JSON deserializes to null (`:53`).
- **Where it's used**: produced by [WebVitalsCollector](#webvitalscollector)`.CollectAsync` and wrapped by [WebVitalsArtifact](#webvitalsartifact) for the JSON artifact.

### PageExtensions
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:19` · Level 1 · static class

- **What it is**: the interactivity toolbox of the E2E package: C# `extension(T)` members over Playwright's `IPage` and `ILocator` that wait for Blazor to become interactive, navigate its InteractiveAuto pages correctly, fill and click through the re-hydration race, and run an axe-core accessibility scan.
- **Depends on**: `Microsoft.Playwright` (`IPage`, `ILocator`, `Assertions`), `Deque.AxeCore.Playwright`/`Commons` (`RunAxe`, `AxeRunOptions`), and `System.Text.RegularExpressions` (`MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:1-5`). It throws [AccessibilityViolationException](#accessibilityviolationexception).
- **Concept introduced, waiting for Blazor InteractiveAuto interactivity.** The apps render with InteractiveAuto plus prerendering, so a page first appears as static HTML before the WASM runtime (or the SignalR circuit) wires event handlers; a click or fill that lands in that window is silently ignored (`PageExtensions.cs:9-14`). These helpers replace fixed sleeps with signal-based waits, which is the difference between a flaky suite and a deterministic one. `[Rubric §28, Front-End Testing]` assesses whether the suite is reliable against real render timing; `[Rubric §21, Accessibility]` applies through the axe scan; `[Rubric §22, Responsive/Cross-Browser]` because the same waits must hold on all three engines. The type also demonstrates the `extension(T)` member syntax used across the framework.
- **Walkthrough**: two extension blocks.
  - `extension(IPage page)` (`:21`). `WaitForBlazorAsync` polls for `window.Blazor?._internal` and then awaits two animation frames plus a 500 ms delay so the render pipeline flushes and handlers attach (`:27-41`). `GotoAndWaitForBlazorAsync` navigates, waits for `LoadState.Load` rather than `NetworkIdle` (which never settles under a persistent SignalR socket), then waits for interactivity (`:47-54`). `BlazorNavigateAsync` drives Blazor's client-side router through `Blazor.navigateTo`, tolerating the context-destroyed race a `forceLoad` can cause, then polls `window.location.pathname` instead of `WaitForURLAsync` (whose default Load wait hangs on a same-document navigation) and re-asserts interactivity (`:62-95`). `GotoProtectedAsync` reaches an `[Authorize]` page by first ensuring Blazor is up (loading a public page when it is not) and re-routing through `/` so the target always gets a fresh component lifecycle, then client-navigating (`:104-135`). `WaitForPageAndBlazorAsync` covers a full-page navigation's load-plus-render settle (`:141-149`). `AssertNoAccessibilityViolationsAsync` runs `RunAxe` (with optional [AxeOptions](#axeoptions)), returns early on zero violations, and otherwise builds a per-node summary and throws [AccessibilityViolationException](#accessibilityviolationexception) (`:157-182`).
  - `extension(ILocator locator)` (`:185`). `FillAndVerifyAsync` fills, then auto-waits `ToHaveValueAsync`, and if the value was wiped by re-hydration it clears the field, re-types character by character with a 20 ms delay, and re-asserts (`:197-216`). This is the single shared fill helper the base and the Page Objects all call. `ClickAndVerifyAsync` waits for interactivity, then clicks and waits a third of the timeout for the expected effect, up to three clicks in total, so a genuinely applied click is never re-issued and only a no-op click is retried (`:230-261`). `ClickAndWaitForUrlAsync` clicks a navigating link and re-clicks until the URL matches the supplied regular expression, for grid rows whose cells wrap content in `MudLink` so a row-center click lands on padding (`:273-296`).
  - The private `CompactHtml` collapses a violating node's markup to one trimmed line, truncated at 220 characters, so the failure message points at the exact offending element (`:305-314`).
- **Why it's built this way**: the fill and click helpers exist because InteractiveAuto's prerender-then-hydrate model makes a bare fill or click a race on a fast host; auto-waiting assertions with a bounded re-type or re-click are strictly safer than fixed delays, since they succeed as soon as the value or effect appears. Two `[SuppressMessage]` attributes document analyzer false positives across the `extension(T)` boundary: CA1708 on the class, where the compiler-generated grouping members read as case-colliding (`:15-18`), and IDE0051 on `CompactHtml`, which the SDK 10.0.201+ analyzer cannot see being called from inside the extension block (`:301-304`).
- **Where it's used**: throughout the Page Objects ([LoginPage](#loginpage), [ProfilePage](#profilepage), [RegisterPage](#registerpage)), inside [E2ETestBase](#e2etestbase) (`FillFieldAsync`, `ScanAsync`, `ScanGridAsync`, the navigation helpers), and directly by every workflow base in this group.

### PlaywrightFixture
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6` · Level 1 · sealed class

- **What it is**: the xUnit collection fixture that owns the Playwright driver and one launched browser for the whole E2E collection, selecting the engine from the environment.
- **Depends on**: `Microsoft.Playwright` (`IPlaywright`, `IBrowser`, `BrowserTypeLaunchOptions`) and xUnit's `IAsyncLifetime` (`MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:1-2`). It reads [E2ETestConfiguration](#e2etestconfiguration).
- **Concept introduced, the shared browser fixture.** Launching a browser is expensive, so one instance is created once per test collection and shared across every test rather than created per test. `[Rubric §22, Responsive/Cross-Browser]` assesses cross-engine coverage, and the inline comment names that rubric category explicitly (`PlaywrightFixture.cs:15-16`): environment-selecting the engine here is what lets CI run the identical suite once per browser. `[Rubric §14, Testability]` applies too, since sharing one costly resource keeps the suite fast.
- **Walkthrough**: `Playwright` and `Browser` are public properties with private setters (`:8-9`). `InitializeAsync` creates the driver (`:13`), switches on `E2ETestConfiguration.Browser.ToUpperInvariant()` to pick Firefox, WebKit, or (for any unrecognized value) Chromium (`:17-22`), and launches it with `Headless` and `SlowMo` from configuration (`:24-28`). `DisposeAsync` suppresses finalization, disposes the browser, then disposes the driver (`:31-36`).
- **Where it's used**: bound to the collection by [E2ETestCollection](#e2etestcollection) and injected into every [E2ETestBase](#e2etestbase) subclass, which opens a fresh browser context per test off this shared `Browser`.

### WebVitalsArtifact
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:87` · Level 1 · sealed record

- **What it is**: the small envelope record written to disk as `web-vitals-{label}.json`: a `Label`, the page `Path`, and the measured [WebVitalsSample](#webvitalssample).
- **Depends on**: [WebVitalsSample](#webvitalssample); serialized with `System.Text.Json`.
- **Concept**: the citable-artifact wrapper. Pairing the raw vitals with the label and path they were taken on makes the JSON file self-describing for a CI reviewer. `[Rubric §23, Front-End Performance]` assesses whether performance evidence is captured and traceable; the envelope is what makes an uploaded artifact interpretable.
- **Walkthrough**: a three-parameter positional sealed record (`MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:87`), constructed inside [WebVitalsCollector](#webvitalscollector)`.WriteArtifactAsync` and serialized with the shared `WriteIndented = true` options (`:34`, `:66-68`).
- **Where it's used**: only by [WebVitalsCollector](#webvitalscollector)`.WriteArtifactAsync`.

### E2ETestCollection
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:40` · Level 2 · sealed class

- **What it is**: the xUnit `[CollectionDefinition]` that binds [PlaywrightFixture](#playwrightfixture) to the named `"E2E"` collection, so every E2E test class shares the one launched browser.
- **Depends on**: xUnit's `ICollectionFixture<PlaywrightFixture>` and the `[CollectionDefinition]` attribute (`MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:39-40`).
- **Concept introduced, the xUnit collection fixture binding.** A collection fixture is instantiated once and shared by every test class that opts into the collection by name. This class carries a `public const string Name = "E2E"` (`:42`) used both in its own `[CollectionDefinition(Name)]` and in each test's `[Collection(E2ETestCollection.Name)]`, so the string is declared once and cannot drift. `[Rubric §14, Testability]` assesses fixture design; a single named constant binding is the robust way to share a fixture.
- **Walkthrough**: an otherwise empty class body carrying the collection definition and the `Name` constant (`:39-43`). It exists purely as an xUnit marker.
- **Where it's used**: referenced by [E2ETestBase](#e2etestbase)'s `[Collection(E2ETestCollection.Name)]` attribute (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:7`), so every workflow base and every consumer subclass inherits collection membership.

### WebVitalsCollector
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:17` · Level 2 · static class

- **What it is**: the measurement infrastructure for client-side Core Web Vitals. It installs browser `PerformanceObserver` scripts before first paint, reads the accumulated values back off a live page, and writes them as a citable JSON artifact.
- **Depends on**: `Microsoft.Playwright` (`IPage`), `System.Text.Json`, and `System.IO` (`MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:1-3`). It produces [WebVitalsSample](#webvitalssample) and [WebVitalsArtifact](#webvitalsartifact).
- **Concept introduced, in-browser performance measurement with no third-party JS.** Rather than shipping an analytics SDK, it injects a small init script that installs `PerformanceObserver`s for LCP, CLS, FCP, and INP, each wrapped in try/catch so an engine lacking an entry type leaves that metric at 0 instead of throwing, and accumulates into `window.__vitals` (`:23-32`). The type doc is explicit that this is the client-side analogue of a backend load test, not a cross-engine field measurement: LCP and CLS are Chromium-only, so on Firefox and WebKit those fields stay 0 and budget assertions pass (`:7-15`). `[Rubric §23, Front-End Performance]` and `[Rubric §12, Performance & Scalability]` assess whether user-centric performance is measured; observing the vitals APIs directly, with no network egress, is a self-contained way to do it. The same doc states the class is only the measurement infrastructure and that consumers keep their own budget-asserting tests.
- **Walkthrough**: `InstallAsync` registers the observers through `AddInitScriptAsync` so they are active on the next navigation (`:37-41`). `CollectAsync` evaluates a script that stamps TTFB from Navigation Timing and returns `window.__vitals` as JSON, deserialized into a [WebVitalsSample](#webvitalssample) (`:44-54`). `WriteArtifactAsync` resolves the output directory from `WEB_VITALS_OUTPUT_DIR` or falls back to `artifacts/` under the current directory, creates it, wraps the sample in a [WebVitalsArtifact](#webvitalsartifact), and writes `web-vitals-{label}.json` indented (`:60-69`).
- **Why it's built this way**: the observers install before the document's own scripts (through `AddInitScript`) so early metrics such as FCP are not missed, and the per-observer try/catch is what makes the same code run green on all three engines despite the Chromium-only metrics. The init script is kept as one concatenated string rather than a raw literal to stay clear of the MA0136 analyzer (`:19-22`).
- **Where it's used**: by the budget-asserting tests each repo owns, which install, navigate, collect, assert, and write the artifact for CI upload: the framework's own gallery suite (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitalsE2ETests.cs:37-41`), ADC (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:60`, `:78-79`), and Store (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/WebVitalsTests.cs:59`, `:101-102`).

### E2ETestBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:8` · Level 3 · abstract class

- **What it is**: the shared base every E2E test class derives from. It gives each test a fresh isolated browser context and page off the shared [PlaywrightFixture](#playwrightfixture) browser, plus the load-bearing auth helpers (login, register, deterministic session cleanup) and the accessibility scan helpers.
- **Depends on**: [PlaywrightFixture](#playwrightfixture), [E2ETestConfiguration](#e2etestconfiguration), [AxeOptions](#axeoptions), the [PageExtensions](#pageextensions) helpers, xUnit's `IAsyncLifetime` and `TestContext`, and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:1-3`).
- **Concept introduced, the per-test browser context.** The fixture launches one browser; this base opens a new `IBrowserContext` (an isolated cookie and storage jar) per test in `InitializeAsync` and disposes it in `DisposeAsync`, so tests cannot leak session state into each other. It is the E2E analogue of the integration-test base's per-test database reset. `[Rubric §28, Front-End Testing]` assesses realistic, isolated UI tests; `[Rubric §21, Accessibility]` applies through the scan helpers; `[Rubric §14, Testability]` through the shared, correctly sequenced auth helpers every workflow reuses. The auth-result handling also touches `[Rubric §22, Responsive/Cross-Browser]`, since the same waits must survive Server-mode and WASM render timing on any engine.
- **Walkthrough**: teaching order.
  - Lifecycle. `InitializeAsync` creates a context with `IgnoreHTTPSErrors` and the base URL, sets the default timeout from configuration, optionally starts trace capture with screenshots, snapshots, and sources when `TracePath` is set, and opens the `Page` (`:19-37`). `DisposeAsync` stops tracing, closes the page, and disposes the context (`:39-49`). The private `StopTracingAsync` (`:55-77`) carries the per-test trace policy: a plain file path keeps the single-file behavior, while a directory path writes a trace named after the current test only when that test failed (`TestContext.Current.TestState?.Result == TestResult.Failed`, `:66-71`), so a full-suite run yields just the failing traces with no overwriting.
  - Auth entry points. `LoginAsAdminAsync` and `LoginAsUserAsync` (`:79-83`) delegate to `LoginAsync` with the [AdminCredentials](#admincredentials) and [UserCredentials](#usercredentials) pair. `LoginAsync` (`:85-132`) first clears any existing session when a sign-out button is visible, removing the `auth_access_token` and `auth_refresh_token` localStorage entries and issuing a `DELETE /auth/session-cookie` fetch, guarded against the context-destroyed race from an in-flight logout (`:93-109`); it then navigates to `/login`, fills through `FillFieldAsync`, clicks, and awaits `WaitForAuthResultAsync` followed by `WaitForInteractiveOrReloadAsync`. `RegisterNewUserAsync` (`:134-167`) generates a unique `e2e-{id}@test.com` email with the fixed password `TestPass123!`, fills the register form, submits, runs the same two post-auth waits, and returns the created credentials.
  - Post-auth robustness. `WaitForInteractiveOrReloadAsync` (`:180-191`) waits for interactivity and, on either a `PlaywrightException` or a `TimeoutException`, reloads once and re-waits rather than watching the same stuck boot; the comment records why both exception types are caught (Playwright's `TimeoutException` derives from `System.TimeoutException`, not `PlaywrightException`, so an earlier single catch skipped the retry entirely) and why a reload beats a re-wait (the framework assets are now HTTP-cached, `:169-179`). `WaitForAuthResultAsync` (`:201-224`) races three signals through `Task.WhenAny`, leaving the auth page, the logout button appearing, or an error alert appearing, so success detection does not depend on the interactive button having hydrated; only an error alert still visible on the auth page after the grace window is a real failure, raised as an `InvalidOperationException` carrying the alert text. `AuthSucceededWithinGraceAsync` (`:229-247`) implements that grace window, falling back to the logout-button signal when no navigation occurs.
  - Helpers. `NavigateAndWaitAsync` (`:249-250`), the shared static `FillFieldAsync` delegating to [PageExtensions](#pageextensions)`.FillAndVerifyAsync` (`:257-258`), `UniqueId` (`:260`), and the two scan helpers. `ScanGridAsync` (`:271-277`) waits for a visible data row and for zero `[role='progressbar']` elements, then scans with [AxeOptions](#axeoptions)`.Wcag21AaExceptMudPagerCombobox`; `ScanAsync` (`:281-285`) applies the progressbar guard only and scans strictly with `Wcag21Aa`.
- **Why it's built this way**: the auth helpers encode hard-won timing knowledge once (the `forceLoad` reload, the Server-versus-WASM hydration lag, the cookie-and-localStorage dual session store), so every consumer workflow inherits a deterministic sign-in instead of re-deriving the races. Clearing both token stores is essential: the Blazor Server host is cookie-only, so a localStorage clear alone would leave the next login authenticated as the wrong user (`:88-92`). The scan split lets grid pages accept the documented pager-combobox exception while every other page stays strict, and the grid wait keys off a data row rather than the loading bar hiding, which would resolve instantly before the transient unnamed progressbar even appears (`:262-270`).
- **Where it's used**: the base class of all six workflow bases in this unit ([AuthorizationTestsBase](#authorizationtestsbase), [LogoutTestsBase](#logouttestsbase), [ProfileManagementTestsBase](#profilemanagementtestsbase), [UserLoginTestsBase](#userlogintestsbase), [UserPreferencesTestsBase](#userpreferencestestsbase), [UserRegistrationTestsBase](#userregistrationtestsbase)) and, through them and directly, every E2E test class in the ADC and Store suites.

### AuthorizationTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:18` · Level 4 · abstract class

- **What it is**: the reusable authorization workflow fitness base, authored once and re-run as a thin subclass per repo. It asserts that anonymous users are redirected off protected paths, that public paths stay reachable, that a registered non-admin can reach an authenticated page, and that a non-admin probing admin routes gets the Forbidden page.
- **Depends on**: [E2ETestBase](#e2etestbase), [PageExtensions](#pageextensions) (`GotoAndWaitForBlazorAsync`, `GotoProtectedAsync`), AwesomeAssertions, and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:1-6`).
- **Concept introduced, the authored-once workflow fitness base.** This is the pattern shared by all six bases in this unit: the framework owns the assertions and the SSR-versus-client-navigation mechanics, and each consumer supplies only its own route lists through abstract or virtual members, so identical security behavior is verified across repos without copying test bodies (`:10-17`). `[Rubric §11, Security]` assesses whether authorization is actually exercised; this base machine-checks both the anonymous-redirect and the authenticated-non-admin-escalation directions. `[Rubric §25, Navigation & IA]` applies because it pins which routes are public and which are gated.
- **Walkthrough**: the subclass supplies `ProtectedPaths` and `PublicPaths` (abstract, `:26`, `:29`) and optionally `AuthenticatedUserPath` and `AdminPaths` (virtual, defaulting to null and an empty list, `:35`, `:44`). Four facts follow. `AnonymousUser_ProtectedPages_ShouldRedirectToLogin` asserts each protected path bounces to `/login` (`:46-58`). `AnonymousUser_PublicPages_ShouldBeAccessible` asserts each public path stays put (`:60-72`). `RegisteredUser_AuthenticatedPage_ShouldBeAccessible` registers a non-admin, then client-navigates through `GotoProtectedAsync` because SSR cannot read the JWT, passing vacuously when no path is declared (`:74-93`). `RegisteredUser_AdminPages_ShouldBeForbidden` registers a non-admin, then asserts each admin path renders the shared Forbidden page, matching `h1[role='alert']` containing "Access Denied", with the comment noting that role denial is not a redirect so the page content is the only reliable signal (`:95-120`).
- **Why it's built this way**: the two optional members use a no-dynamic-skip convention (an app with no such page simply passes) because the shipped library deliberately does not reference `xunit.v3.assert` for a declared skip (`:77-78`, `:98-99`). The non-empty assertions on `ProtectedPaths` and `PublicPaths` (`:49-50`, `:63-64`) are non-vacuity guards: a repo that declares no paths fails rather than passing silently.
- **Where it's used**: subclassed in both consumer E2E suites with that app's route lists (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/AuthorizationTests.cs:11`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/AuthorizationTests.cs:11`).

### LogoutTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/LogoutTestsBase.cs:9` · Level 4 · abstract class

- **What it is**: the reusable logout workflow base. It verifies that sign-out returns the user to the login screen and that a logged-out user can no longer reach a protected page.
- **Depends on**: [E2ETestBase](#e2etestbase), [PageExtensions](#pageextensions) (`WaitForBlazorAsync`), and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Identity/LogoutTestsBase.cs:1-5`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase). `[Rubric §11, Security]` assesses session teardown; this base guards that logout genuinely revokes access rather than merely returning to a login screen visually.
- **Walkthrough**: two facts. `Logout_ShouldRedirectToLoginPage` registers, confirms the sign-out button is visible, clicks it, waits for the load state, and asserts the sign-in button appears (`:16-29`). `Logout_ShouldPreventAccessToProtectedPages` registers, waits for interactivity (because `RegisterNewUserAsync` can return with the button visible before JS interop is ready), then clicks sign-out inside `RunAndWaitForResponseAsync` so it blocks until the best-effort `DELETE /auth/session-cookie` response arrives (`:47-51`), confirms the sign-in button is visible, and then re-requests `/profile` up to six times until the server redirects to `/login` (`:64-72`), falling back to a clear URL assertion if it never does (`:75`).
- **Why it's built this way**: waiting for the cookie-clear response is the fix for a real full-speed race. At speed the test otherwise reaches `/profile` before the DELETE finishes, so the HttpOnly cookie is still present and SSR re-authenticates. The bounded re-request loop converges deterministically where any slowdown (slow-mo, or even trace capture) would have hidden the race entirely (`:42-46`, `:57-63`).
- **Where it's used**: subclassed in both consumer E2E suites (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/LogoutTests.cs:5`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/LogoutTests.cs:5`).

### ProfileManagementTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/ProfileManagementTestsBase.cs:11` · Level 4 · abstract class

- **What it is**: the reusable profile workflow base. It verifies that name, address, and password changes persist, that the profile page loads pre-filled with the registered data, an opt-in email-change journey, and that the profile page is accessibility-clean.
- **Depends on**: [E2ETestBase](#e2etestbase), [ProfilePage](#profilepage), [PageExtensions](#pageextensions), [AxeOptions](#axeoptions), AwesomeAssertions, and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Identity/ProfileManagementTestsBase.cs:1-7`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase), here driving a [ProfilePage](#profilepage). `[Rubric §24, Forms/Validation/UX Safety]` assesses whether edit-and-persist journeys work end to end; `[Rubric §21, Accessibility]` applies through the a11y fact.
- **Walkthrough**: one virtual switch, `ProfileSupportsEmailChange`, off by default (`:24`). Six facts follow. `ChangeName_ShouldUpdateProfileName` clears and fills both name fields, saves, re-navigates, and asserts the values persisted (`:26-53`); `ChangeAddress_ShouldUpdateProfileAddress` does the same for the five address fields and asserts on line 1 (`:55-78`). Both use Playwright's plain `FillAsync` rather than the re-hydration-safe helper, since the profile page is reached by client-side navigation on an already interactive runtime. `ChangePassword_WithValidCurrentPassword_ShouldSucceed` fills the three password fields through the shared `FillFieldAsync`, waits for the "Password changed successfully." snackbar, then signs out and logs back in with the new password, waiting for the logout `forceLoad`'s `/login` URL rather than `LoadState.Load` so it does not race the in-flight navigation (`:80-110`). `ChangeEmail_ShouldUpdateEmail` is opt-in and returns immediately unless `ProfileSupportsEmailChange` is overridden true (`:112-146`). `ProfilePage_ShouldLoadWithUserData` asserts the form is pre-filled from registration (`:148-166`). `ProfilePage_ShouldHaveNoAccessibilityViolations` scans with [AxeOptions](#axeoptions)`.Wcag21Aa` (`:168-181`).
- **Why it's built this way**: the email-change fact is a declared opt-in rather than a DOM probe because the previous probing version passed vacuously when the field was absent, reporting coverage for a journey the app does not offer; overriding the flag makes a missing field fail loud (`:18-23`, `:129-131`). The logout-then-login URL wait is called out in the source as the one remaining sign-out-then-login site still on the racy pattern, fixed to match [UserLoginTestsBase](#userlogintestsbase) (`:100-105`).
- **Where it's used**: subclassed in both consumer E2E suites (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:5`, plus ADC's `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs`).

### UserLoginTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/UserLoginTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: the reusable login workflow base. Valid credentials reach the home page and show the authenticated app bar, invalid credentials show an error and stay on `/login`, the create-account link navigates to `/register`, and the login page is accessibility-clean.
- **Depends on**: [E2ETestBase](#e2etestbase), [LoginPage](#loginpage), [PageExtensions](#pageextensions), [AxeOptions](#axeoptions), and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Identity/UserLoginTestsBase.cs:1-6`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase), here driving a [LoginPage](#loginpage). `[Rubric §28, Front-End Testing]` and `[Rubric §11, Security]` apply.
- **Walkthrough**: four facts. `Login_WithValidCredentials_ShouldNavigateToHomePage` registers (which auto-logs in), signs out while waiting for the `/login` URL, logs back in, and asserts the URL left `/login`, the sign-out button is visible, and the "Sign In" link is not (`:17-41`). `Login_WithInvalidPassword_ShouldShowError` drives `LoginPage.LoginAsync` with a nonexistent account and asserts the error alert appears and the URL stays on `/login` (`:43-57`). `Login_NavigateToCreateAccount_ShouldGoToRegisterPage` clicks the create-account link and asserts `/register` (`:59-71`). `LoginPage_ShouldHaveNoAccessibilityViolations` scans with [AxeOptions](#axeoptions)`.Wcag21Aa` (`:73-84`).
- **Why it's built this way**: the explicit wait for the logout `forceLoad`'s `/login` URL rather than `LoadState.Load` (`:23-28`) is the fix (v1.103.1) for the sign-out-then-login race, where the current document's load event had already fired so the wait returned immediately and the pre-login cleanup evaluate died with "execution context was destroyed".
- **Where it's used**: subclassed in both consumer E2E suites (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/UserLoginTests.cs:5`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/UserLoginTests.cs:5`).

### UserPreferencesTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Preferences` · `MMCA.Common.Testing.E2E/Workflows/Preferences/UserPreferencesTestsBase.cs:21` · Level 4 · abstract class

- **What it is**: the reusable culture-switch and theme-toggle workflow base. It verifies that switching to Spanish localizes and persists, that toggling dark mode applies and persists, and that both controls are reachable on a mobile viewport.
- **Depends on**: [E2ETestBase](#e2etestbase), [PageExtensions](#pageextensions) (`GotoAndWaitForBlazorAsync`), AwesomeAssertions, and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Preferences/UserPreferencesTestsBase.cs:1-5`).
- **Concept introduced, the self-contained preferences fitness base.** Unlike the identity bases, this one needs no app-specific overrides: the probe page is the shared `/login`, the probe string is the localized "Welcome Back" / "Bienvenido de nuevo", and persistence is the anonymous cookie pair (`.AspNetCore.Culture` plus `mmca_theme`), all owned by Common UI in every app (`:9-20`). `[Rubric §27, i18n]` assesses whether localization actually switches and persists; `[Rubric §20, Design System & Theming]` covers the theme toggle; `[Rubric §22, Responsive/Cross-Browser]` covers the mobile-parity fact. The source doc cites [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) and [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) for the localization and theming mechanics.
- **Walkthrough**: a dark-background probe script that accepts either the raw hex `#1a2027` or its `rgba(26,32,39,1)` form, whitespace-stripped (`:25-28`), plus desktop and mobile action-cluster locators scoped by container (`.appbar-icon-actions` and `.toprow-actions`, `:37-39`) to disambiguate the duplicated NavMenu controls. Three facts follow. `CultureSwitch_ToSpanish_ShouldLocalizeAndPersist` opens the Language menu and clicks the Spanish item (its label carries the accented spelling in source) located as `.mud-popover-open .mud-menu-item` (the popover carries that class only once Blazor interactivity attached, and the items are not `.mud-list-item` and carry no menuitem role), then asserts the Spanish probe survives a fresh full page load (`:41-64`). `ThemeToggle_ToDark_ShouldApplyAndPersist` clicks the title-stable toggle (its aria-label flips with state, its title does not), asserts the palette variable flipped through `AssertDarkPaletteAsync`, asserts `localStorage` holds `mmca_theme` set to `dark`, then reloads and re-asserts (`:66-85`). `MobileViewport_CultureAndTheme_ShouldBeReachable` sets a 390x844 viewport and asserts the controls come from NavMenu's top row, then actually toggles the theme there rather than only checking that it rendered (`:87-101`). The private `AssertDarkPaletteAsync` polls the probe script with a 15 s ceiling (`:103-107`).
- **Why it's built this way**: the mobile fact pins the v1.103.0 regression where the controls lived only in the app bar, hidden below 1024px; the selectors mirror the gallery's own `MobileTopRowE2ETests` exactly because the MudMenu activator exposes no literal `aria-label` attribute, so raw CSS attribute selectors do not match it (`:14-19`).
- **Where it's used**: subclassed with no additions in both consumer E2E suites (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Preferences/UserPreferencesTests.cs:10`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Preferences/UserPreferencesTests.cs:10`).

### UserRegistrationTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/UserRegistrationTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: the reusable registration workflow base. Valid data navigates to the home page and logs the user in, mismatched passwords show the inline validation message and stay on `/register`, a duplicate email shows an error, and the register page is accessibility-clean.
- **Depends on**: [E2ETestBase](#e2etestbase), [RegisterPage](#registerpage), [PageExtensions](#pageextensions) (`FillAndVerifyAsync`), [AxeOptions](#axeoptions), and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Identity/UserRegistrationTestsBase.cs:1-6`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase), here driving a [RegisterPage](#registerpage). `[Rubric §24, Forms/Validation/UX Safety]` assesses client-side validation and duplicate handling; `[Rubric §21, Accessibility]` applies through the a11y fact.
- **Walkthrough**: four facts. `Register_WithValidData_ShouldNavigateToHomePage` registers a unique user through the Page Object and asserts the URL left `/register` and the sign-out button is visible (`:17-34`). `Register_WithMismatchedPasswords_ShouldShowError` fills every field through `FillAndVerifyAsync`, submits exactly once, and asserts the inline "Passwords do not match" validation text plus staying on `/register` (`:36-63`). `Register_WithDuplicateEmail_ShouldShowError` registers, then re-registers the same email and asserts the error alert (`:65-79`). `RegisterPage_ShouldHaveNoAccessibilityViolations` scans with [AxeOptions](#axeoptions)`.Wcag21Aa` (`:81-92`).
- **Why it's built this way**: the mismatched-passwords fact submits once and asserts the field-level validation text rather than re-clicking, because the `[Compare]` validation fires `OnInvalidSubmit` and a re-clicking helper would make the message flicker out from under the wait; the text is asserted (not the alert element) because it renders in both the Server-mode and WebAssembly paths, while the page-level alert appears only on the Server-mode prerender path (`:43-47`, `:56-60`).
- **Where it's used**: subclassed in both consumer E2E suites (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/UserRegistrationTests.cs:5`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/UserRegistrationTests.cs:5`).

### BunitInteractionExtensions

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:12` · Level 0 · class

- **What it is**: A static class of intention-revealing helpers over bUnit's rendered-component API so component tests read as user actions ("click the Save button", "does this text appear") instead of hand-rolled DOM queries. It deliberately prefers accessible visible text over brittle CSS-path selectors (`BunitInteractionExtensions.cs:7-11`).
- **Depends on**: bUnit's `IRenderedComponent<TComponent>` and its `FindAll`/`Markup` surface, `AngleSharp.Dom.IElement` (the DOM node type bUnit exposes), and `Microsoft.AspNetCore.Components.IComponent` (the generic constraint, `BunitInteractionExtensions.cs:1-3`). No first-party dependencies.
- **Concept introduced: C# `extension(T)` members applied to a test API.** Rather than classic `this`-parameter extension methods, this class uses the preview `extension<TComponent>(IRenderedComponent<TComponent> cut)` block (`BunitInteractionExtensions.cs:14-16`), the same construct the codebase uses for DI registration (see [primer](00-primer.md#c-extensiont-types-read-this-once)). Every member inside the block reads `cut` as if it were an instance receiver. `[Rubric §28, Front-End Testing]` assesses whether the UI has real component-level coverage that is cheap to write and read; grounding assertions in visible text is what keeps those tests resilient to markup refactors.
- **Walkthrough**: `FindButtonByText(text)` (line 18) scans `cut.FindAll("button")` and returns the first `<button>` whose `TextContent` contains `text` case-insensitively (lines 20-21); on no match it throws an `InvalidOperationException` that lists every button text present (lines 22-24), so a failing test names the actual buttons instead of a bare null-reference. `ClickButtonByText(text)` (line 28) delegates to `FindButtonByText` and calls `.Click()` on the result (line 29). `HasText(text)` (line 32) is a boolean over `cut.Markup.Contains(text, StringComparison.OrdinalIgnoreCase)` (line 33) for simple presence assertions.
- **Why it's built this way**: The diagnostic-rich throw (listing available button texts) turns the most common component-test failure, a label that moved, from an opaque null into a self-explaining message, which is the whole point of a shared test-helper layer.
- **Where it's used**: By bUnit test classes that subclass [BunitComponentTestBase](#bunitcomponenttestbase) across the MMCA repos.

### CapturedRequest

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:129` · Level 0 · record

- **What it is**: An immutable snapshot of one HTTP request a UI service sent through the test handler: method, full URI, absolute path, path plus query, Authorization header, and body text (`CapturingHttpMessageHandler.cs:125-135`).
- **Depends on**: BCL `System.Net.Http.HttpMethod` and `System.Uri` only.
- **Concept introduced**: The "record the interaction, assert on it later" side of a test double. Where a mock verifies calls inline, this positional `sealed record` (line 129) preserves each request so a test can assert on the wire-level shape after the fact. `[Rubric §14, Testability]` assesses how observable a component's outbound behavior is under test; capturing the exact Authorization header and serialized body is what lets a test prove the UI service attached the bearer token and posted the right payload.
- **Walkthrough**: Six positional members (lines 129-135): `Method`, `Uri` (nullable), `Path`, `PathAndQuery`, `Authorization` (nullable, `null` when the request carried no Authorization header), and `Body` (nullable, `null` when the request had no content). The handler populates it in `CaptureAsync` (`CapturingHttpMessageHandler.cs:81-87`), reading `uri?.AbsolutePath` and `uri?.PathAndQuery` with empty-string fallbacks and the stringified `request.Headers.Authorization`.
- **Where it's used**: Exposed as the element type of [CapturingHttpMessageHandler](#capturinghttpmessagehandler)'s `Requests` list (`CapturingHttpMessageHandler.cs:41`) and `RequestsFor(...)` query (`:60`).

### FreshApiClientFactory

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:73` · Level 0 · class

- **What it is**: An `IHttpClientFactory` test double that returns a brand-new `HttpClient` on every `CreateClient` call, all wired to one shared handler at a fixed base address. It is a primary-constructor sealed class taking the shared `HttpMessageHandler` and the base `Uri` (`UiHttpServiceHarness.cs:73`).
- **Depends on**: BCL `System.Net.Http.IHttpClientFactory`/`HttpClient`/`HttpMessageHandler`.
- **Concept introduced: the "fresh instance per call is load-bearing" contract.** The MMCA UI HTTP services dispose their `HttpClient` after each request. A factory that cached and returned the same instance would hand the second call a disposed client. So `CreateClient(name)` (line 79) always constructs `new HttpClient(handler, disposeHandler: false)` (line 80), ignoring the requested name (typically `"APIClient"`) and passing `disposeHandler: false` so the shared handler outlives each short-lived client. `[Rubric §14, Testability]`: matching the production disposal contract in the double is what keeps the test faithful to how the service actually manages its clients.
- **Walkthrough**: A single member, `CreateClient(string name)` (line 79), returning a new client on the shared `handler` with `BaseAddress = baseAddress` (line 80) so services can issue relative URIs. The name argument is accepted for interface compatibility but unused.
- **Why it's built this way**: See the class remarks (`UiHttpServiceHarness.cs:66-72`): caching the client would leak a disposed instance into later calls, so a fresh client per call is a correctness requirement, not an optimization.
- **Where it's used**: Constructed inside [UiHttpServiceHarness](#uihttpserviceharness) (`UiHttpServiceHarness.cs:47`) and offered standalone through [HttpTestDoubles](#httptestdoubles)`.ClientFactory(...)` (`HttpTestDoubles.cs:24`).

### IsAuthenticatedAuthorizationService

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:111` · Level 0 · class

- **What it is**: A private nested `IAuthorizationService` used inside [BunitComponentTestBase](#bunitcomponenttestbase) that authorizes any authenticated user and refuses anyone anonymous, regardless of the specific policy or requirement asked for (`BunitComponentTestBase.cs:111`).
- **Depends on**: `Microsoft.AspNetCore.Authorization.IAuthorizationService`/`AuthorizationResult`/`IAuthorizationRequirement`, and BCL `System.Security.Claims.ClaimsPrincipal`.
- **Concept introduced**: A coarse authorization stub for component tests. Component tests care about the two branches every `<AuthorizeView>` or `[Authorize]` page has, signed in versus signed out, not about reproducing the app's real policy set. This double collapses all policies to a single question: is the principal authenticated. `[Rubric §11, Security]` assesses how authorization is modeled; substituting a real policy evaluator with an is-authenticated check is a deliberate test-time simplification, so a bUnit test verifies a component's *render response* to authz, not the authz rules themselves (those are pinned by the fitness bases, for example [RouteAuthorizationTestsBase](#routeauthorizationtestsbase)).
- **Walkthrough**: The requirements overload of `AuthorizeAsync` (line 113) returns `AuthorizationResult.Success()` when `user.Identity?.IsAuthenticated == true`, else `AuthorizationResult.Failed()` (lines 115-117). The policy-name overload (line 119) forwards to the requirements overload with an empty requirement array (line 120), so a policy name and a requirement set both resolve to the same authenticated check.
- **Where it's used**: Registered as a singleton `IAuthorizationService` in the [BunitComponentTestBase](#bunitcomponenttestbase) constructor (`BunitComponentTestBase.cs:45`).

### MarkupSnapshotResult

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:104` · Level 0 · record struct

- **What it is**: The outcome of a [MarkupSnapshot](#markupsnapshot) comparison: a `readonly record struct` pairing `IsMatch` (true when the markup matched the committed baseline, or was refreshed) with a human-readable `Message` (`MarkupSnapshot.cs:101-104`).
- **Depends on**: nothing beyond the BCL.
- **Concept introduced: the dependency-free result object.** Because `MMCA.Common.Testing.UI` ships as a NuGet package, `MarkupSnapshot.Match` deliberately returns this value type instead of throwing an assertion-library exception, so the package pulls in no assertion dependency of its own (`MarkupSnapshot.cs:11-12`). The caller asserts on `.IsMatch` with whatever library it already uses, passing `.Message` as the failure text. `[Rubric §28, Front-End Testing]`: keeping the shipped helper assertion-agnostic is what lets every consumer repo adopt golden-markup testing without a forced test-framework choice.
- **Walkthrough**: Two positional members (line 104), `bool IsMatch` and `string Message`. A `readonly record struct` gives value semantics with no heap allocation per comparison.
- **Where it's used**: Returned from [MarkupSnapshot](#markupsnapshot)`.Match(...)` (`MarkupSnapshot.cs:31`); the caller reads `IsMatch`/`Message`.

### MudProviderHandles

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:92` · Level 0 · record

- **What it is**: A protected sealed record nested in [BunitComponentTestBase](#bunitcomponenttestbase) that bundles the three rendered MudBlazor infrastructure providers (popover, dialog, snackbar) so a test can query their markup after opening a dialog or raising a toast (`BunitComponentTestBase.cs:91-95`).
- **Depends on**: bUnit's `IRenderedComponent<T>` and MudBlazor's `MudPopoverProvider`/`MudDialogProvider`/`MudSnackbarProvider`.
- **Concept introduced**: The MudBlazor overlay providers render outside a component's own markup subtree, so a component that opens a `MudMessageBox` or raises a snackbar has nowhere to render unless those providers are mounted in the test root first. This record is just the return channel for those three handles. `[Rubric §14, Testability]`: exposing the providers as named handles is what lets a test click into a dialog's confirm button or read a toast's text.
- **Walkthrough**: Three positional members (lines 92-95), `Popover`, `Dialog`, and `Snackbar`, each an `IRenderedComponent<...>` for the corresponding provider. The record is produced by `RenderMudProviders()` (`BunitComponentTestBase.cs:83-89`), which renders each provider in turn and wraps the three in this record (line 88).
- **Where it's used**: Returned by [BunitComponentTestBase](#bunitcomponenttestbase)`.RenderMudProviders()`; tests query `Dialog` for message-box markup and `Snackbar` for toasts (`BunitComponentTestBase.cs:91`).

### MutableAuthenticationStateProvider

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:97` · Level 0 · class

- **What it is**: A private nested `AuthenticationStateProvider` inside [BunitComponentTestBase](#bunitcomponenttestbase) whose current principal can be swapped mid-test, notifying listeners each time (`BunitComponentTestBase.cs:97-109`).
- **Depends on**: `Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider`/`AuthenticationState`, and BCL `ClaimsPrincipal`.
- **Concept introduced**: Why *mutable* rather than a hardcoded-anonymous stub. The class remarks (`BunitComponentTestBase.cs:20-23`) explain it is a superset of a fixed provider: it serves both cascading `AuthenticationState` consumers and pages that call `GetAuthenticationStateAsync()` on the injected service directly, and it can flip the principal after render to simulate a login or logout during a test. `[Rubric §19, State Management]` assesses how auth state flows through the component tree; a single mutable provider that raises `NotifyAuthenticationStateChanged` is what makes both the cascade and mid-test transitions observable.
- **Walkthrough**: A primary constructor takes the `initial` principal into the private `_principal` field (lines 97-99). `SetPrincipal(principal)` (line 101) stores the new principal (line 103) and calls `NotifyAuthenticationStateChanged(Task.FromResult(new AuthenticationState(principal)))` (line 104) so subscribed `<AuthorizeView>` and `CascadingAuthenticationState` re-evaluate. `GetAuthenticationStateAsync()` (line 107) returns the current principal wrapped in an `AuthenticationState` (line 108).
- **Where it's used**: Held as the `_authProvider` field in [BunitComponentTestBase](#bunitcomponenttestbase) (`BunitComponentTestBase.cs:38`), registered as the singleton `AuthenticationStateProvider` (`:46`) and driven by `SetUser` (`:56`) and `RenderAs` (`:70`).

### Route

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:110` · Level 0 · record

- **What it is**: A private nested record inside [CapturingHttpMessageHandler](#capturinghttpmessagehandler) representing one registered canned response: the matching HTTP method and absolute path plus the status code and optional JSON body to return (`CapturingHttpMessageHandler.cs:110`).
- **Depends on**: BCL `System.Net.Http.HttpMethod`, `System.Net.HttpStatusCode`, `StringContent`, and `System.Text.Encoding`.
- **Concept introduced**: A canned-response registration as an immutable value with a small behavior attached. Beyond holding the match key, the record carries `ToResponse()` (line 112) that materializes a *fresh* `HttpResponseMessage` each call, attaching the JSON body as `StringContent` with `application/json` when present (lines 114-120). `[Rubric §14, Testability]`: building a new response per call is what keeps a canned route reusable across a Polly retry, which would otherwise re-read an already-consumed `HttpContent`.
- **Walkthrough**: Four positional members (line 110), `Method`, `Path`, `StatusCode`, `JsonBody` (nullable). `ToResponse()` creates `new HttpResponseMessage(StatusCode)` (line 114) and, when `JsonBody is not null`, sets `Content` to a UTF-8 `StringContent` of the JSON (lines 116-118).
- **Where it's used**: Registered into the handler's `_routes` list by `SetResponse` (`CapturingHttpMessageHandler.cs:56`) and matched, last registration winning, in `Respond` (`CapturingHttpMessageHandler.cs:93-100`).

### TestPrincipal

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6` · Level 0 · class

- **What it is**: A static factory for `ClaimsPrincipal` instances used in bUnit component tests: it mints authenticated principals with the claims the app's pages actually read (`TestPrincipal.cs:5-6`).
- **Depends on**: BCL `System.Security.Claims.ClaimsPrincipal`/`ClaimsIdentity`/`Claim`/`ClaimTypes`.
- **Concept introduced**: The distinction between an *anonymous* and an *authenticated* identity in claims-based auth turns on whether the `ClaimsIdentity` carries an authentication type. `AuthenticatedUser` (line 13) passes `authenticationType: "TestAuth"` (line 21) so `Identity.IsAuthenticated` is true (contrast [BunitComponentTestBase](#bunitcomponenttestbase)'s `Anonymous`, `BunitComponentTestBase.cs:36`, which passes none). The identity carries a `ClaimTypes.Name`, a `user_id` claim read by pages such as Identity's Profile, and one `ClaimTypes.Role` per supplied role so `<AuthorizeView Roles="...">` matches (`TestPrincipal.cs:15-21`). `[Rubric §11, Security]`: modeling the exact claim shape the pages consume is what lets a component test exercise the authorized branch faithfully rather than a hand-waved "logged in" flag.
- **Walkthrough**: `AuthenticatedUser(userId = "1", name = "Test User", params string[] roles)` (line 13) builds the claim list (lines 15-20) and returns the authenticated principal (line 21). `Organizer(userId = "1")` (line 25) is a convenience wrapper calling `AuthenticatedUser` with the name `"Organizer User"` and the `Organizer` role for the common admin-branch case (line 26).
- **Where it's used**: Passed to [BunitComponentTestBase](#bunitcomponenttestbase)`.RenderAs<TComponent>(principal, ...)` (`BunitComponentTestBase.cs:65`) to render a component as an authenticated (or organizer) user.

### BunitComponentTestBase

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33` · Level 1 · class

- **What it is**: The shared abstract base class for bUnit component tests across the MMCA repos. It boots a bUnit render context pre-wired with real MudBlazor services, loose-mode JSInterop, permissive-but-real auth doubles, and localization, so a derived test can render one Blazor component in isolation and drive it (`BunitComponentTestBase.cs:12-32`).
- **Depends on**: bUnit's `BunitContext` (the v2 base it extends, line 33), MudBlazor services (`AddMudServices`, plus the popover/dialog/snackbar providers), `Microsoft.AspNetCore.Components.Authorization`, `Microsoft.AspNetCore.Authorization`, and `Microsoft.Extensions.Localization` (`AddLocalization`). It composes the nested [MutableAuthenticationStateProvider](#mutableauthenticationstateprovider), [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice), and [MudProviderHandles](#mudproviderhandles), and pairs with [TestPrincipal](#testprincipal).
- **Concept introduced: component testing (the bUnit tier of the pyramid).** This is the shared substrate the chapter overview names as moving part 3. A component test renders a single Blazor component with its *real* dependencies (actual MudBlazor, actual localization) but faked network and auth edges, then asserts on the produced markup. Two setup details are load-bearing: `JSInterop.Mode = JSRuntimeMode.Loose` (line 43) so MudBlazor components that probe JS during render return defaults instead of throwing, and `AddLocalization()` (line 52) so components injecting `IStringLocalizer<T>` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)) render localized markup with no per-test setup, resolving to the neutral resources in the component's own assembly (`BunitComponentTestBase.cs:48-50`). `[Rubric §28, Front-End Testing]` assesses real component-level coverage; `[Rubric §14, Testability]` assesses how cheaply a unit renders in isolation, and registering real MudBlazor with faked edges is the balance this base strikes.
- **Walkthrough**: `Anonymous` (line 36) is a `static readonly ClaimsPrincipal` over an empty `ClaimsIdentity` (no authentication type, so not authenticated). The constructor (lines 40-53) calls `AddMudServices()` (line 42), sets loose JSInterop (line 43), `AddAuthorizationCore()` (line 44), registers the [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice) singleton (line 45) and the [MutableAuthenticationStateProvider](#mutableauthenticationstateprovider) singleton (line 46), then `AddLogging()` and `AddLocalization()` (lines 51-52). `SetUser(principal)` (line 56) swaps the injected provider's principal mid-test without re-rendering a new root. `RenderUnderTest<TComponent>(parameters)` (line 59) renders as `Anonymous` (line 62); `RenderAs<TComponent>(principal, parameters)` (line 65) sets the provider's principal (line 70), then renders while adding a cascading `AuthenticationState` value so both the cascade and the injected provider agree (lines 71-75). `RenderMudProviders()` (line 83) mounts the three overlay providers (lines 85-87) and returns them as [MudProviderHandles](#mudproviderhandles) (line 88).
- **Why it's built this way**: The class is deliberately pinned to bUnit v2 (the line compatible with xUnit v3 and Microsoft Testing Platform) and isolates every version-specific symbol, `BunitContext` and `Render<T>`, in this one file, so a future bUnit restore that resolves v1.x needs changes *only here* while derived tests keep calling `RenderUnderTest`/`RenderAs` (`BunitComponentTestBase.cs:24-31`). Driving both the cascade and the injected provider from one principal (rather than picking one) is what makes the base serve both `<AuthorizeView>` cascades and pages that inject the provider directly (`:20-23`).
- **Where it's used**: The base for the bUnit test classes in `MMCA.Common.*.Tests`, `MMCA.ADC.*.Tests`, and `MMCA.Store.*.Tests`, cataloged in the companion per-project rollup.

### CapturingHttpMessageHandler

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18` · Level 1 · class

- **What it is**: A canned-response, request-capturing `HttpMessageHandler` for unit-testing HTTP-backed UI services with no server. It answers requests from registered routes or a responder delegate, returns 404 for anything unmatched, and records every request it saw (`CapturingHttpMessageHandler.cs:7-18`).
- **Depends on**: BCL `System.Net.Http.HttpMessageHandler`, `System.Text.Json`, `System.Net.HttpStatusCode`, and `System.Text.Encoding`. It produces [CapturedRequest](#capturedrequest) records and holds [Route](#route) registrations.
- **Concept introduced: faking the HTTP edge at the handler.** UI services take an `IHttpClientFactory` and talk to the WebAPI over `HttpClient`. Substituting *this* handler under the client lets a test drive those services with zero network, controlling every response and inspecting every request. Two configuration styles coexist: a responder delegate passed to the ctor (invoked once per request, so repeated calls get fresh responses), or route registration via `SetResponse`; registered routes are consulted first and an unmatched request falls through to the responder, or returns a 404 with an empty body, which mirrors the WebAPI's not-found behavior and keeps incidental refresh calls out of each test's setup (`CapturingHttpMessageHandler.cs:7-17`). `[Rubric §14, Testability]`: a single handler that both stubs responses and records requests is what lets one test control inputs and assert outputs at the wire boundary.
- **Walkthrough**: The static `WebJson` options (line 20) use `JsonSerializerDefaults.Web` so serialized bodies match what the WebAPI sends. The parameterless ctor (line 30) selects route-registration mode; the `Func<HttpRequestMessage, HttpResponseMessage>` ctor (line 38) selects responder-delegate mode. `Requests` (line 41) exposes every recorded [CapturedRequest](#capturedrequest) in order. `SetResponse(method, absolutePath, statusCode, body)` (line 48) serializes `body` via a switch, `null` stays null, a raw `string` passes through as-is, any other object is serialized with web defaults (lines 50-55), then registers a [Route](#route) (line 56). `RequestsFor(method, absolutePath)` (line 60) filters the recorded requests by method and case-insensitive path (lines 62-63). `SendAsync` (line 66) captures the request first (awaiting `CaptureAsync`, lines 72-88, which reads the body and pulls the Authorization header) then calls `Respond` (line 69). `Respond` (line 90) matches the last route registered for the method and path (last-wins, lines 93-100), else invokes the responder (lines 102-105), else returns a 404 (line 107).
- **Why it's built this way**: Building each response fresh (via [Route](#route)`.ToResponse()` or a per-request responder) is required so a Polly retry pipeline in the service under test never reuses a consumed `HttpContent` (`CapturingHttpMessageHandler.cs:14-16`); last-registration-wins on routes lets a test override an earlier default without clearing state.
- **Where it's used**: Wrapped by [UiHttpServiceHarness](#uihttpserviceharness) (`UiHttpServiceHarness.cs:24,39`), offered directly to tests, and its response bodies are commonly built with [HttpTestDoubles](#httptestdoubles).

### MarkupSnapshot

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21` · Level 1 · class

- **What it is**: A minimal, dependency-free render-snapshot (golden-markup) regression helper for bUnit tests. It captures a component's rendered markup, normalizes the non-deterministic per-render bits MudBlazor injects, and compares against a committed baseline under a `Snapshots/` folder next to the calling test (`MarkupSnapshot.cs:6-20`).
- **Depends on**: BCL `System.Runtime.CompilerServices` (`[CallerFilePath]`), `System.Text.RegularExpressions` (source-generated regexes), and `System.IO`. Returns a [MarkupSnapshotResult](#markupsnapshotresult).
- **Concept introduced: golden-markup snapshot testing.** Instead of pixel screenshots (OS-dependent, per-platform golden management), this compares *normalized markup*, which is deterministic and OS-independent, so it runs identically on every CI platform (`MarkupSnapshot.cs:14-16`). A committed `.html` baseline is the golden; an unintended structural change to a shared primitive fails the build. The workflow is review-and-commit: `UPDATE_SNAPSHOTS=1` rewrites baselines after an intentional change, and a *missing* baseline is written but reported as a non-match so a regression can never slip through on an absent snapshot (`MarkupSnapshot.cs:16-19`). `[Rubric §28, Front-End Testing]`: markup snapshots are the low-cost regression net for the shared UI primitives.
- **Walkthrough**: `Match(markup, snapshotName, [CallerFilePath] callerFilePath)` (line 31) guards its inputs (lines 33-34), normalizes the markup (line 36), and resolves the baseline path as `Snapshots/{snapshotName}.html` next to the caller (lines 37-39). If `UPDATE_SNAPSHOTS=1` it writes the actual and returns a match (lines 41-46); if the baseline is absent it writes it and returns a *non*-match with a review-and-commit message (lines 48-54); otherwise it reads the expected, normalizes line endings, and returns match or a diff message (lines 56-59). `Normalize` (line 64) collapses per-render GUIDs, both dashed and 32-char forms, to a stable `{guid}` token and trims trailing whitespace so the comparison reacts only to real markup changes (lines 66-69). `BuildDiffMessage` (line 72) walks lines to report the first differing line with expected/actual text (lines 78-88), falling back to a length-differs message (lines 90-91). Two source-generated regexes, `GuidRegex` (line 95) and `Hex32Regex` (line 98), do the GUID normalization.
- **Why it's built this way**: Normalizing MudBlazor's per-render element-id and ARIA GUIDs is what makes the comparison stable; without it every render would differ and the test would be worthless. Keeping the helper assertion-library-free (returning [MarkupSnapshotResult](#markupsnapshotresult)) is what lets the shipped package impose no test-framework choice on consumers (`MarkupSnapshot.cs:10-12`).
- **Caveats / not-in-source**: The baseline location depends on `[CallerFilePath]` resolving to the source path present at compile time; snapshots are meant to be run and refreshed from the repo checkout that compiled the tests.

### StubTokenStorageService

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/StubTokenStorageService.cs:13` · Level 1 · class

- **What it is**: A canned [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) for UI HTTP-service tests. It returns fixed access/refresh tokens (which the services attach as the Bearer header) with no platform storage, and its token values mutate through set/clear so login/logout flows can be asserted (`StubTokenStorageService.cs:5-12`).
- **Depends on**: [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) from `MMCA.Common.UI.Services.Auth` (`StubTokenStorageService.cs:1`).
- **Concept introduced**: A stateful test double that is also *fault-injectable*. Beyond returning canned tokens, `AccessTokenProvider` (line 36) is a mutable delegate backing `GetAccessTokenAsync`, so a test can swap in a throwing delegate to simulate the prerender window where JS-interop storage access is unavailable (`StubTokenStorageService.cs:8-10`, `:31-35`). `[Rubric §26, Front-End Security]` assesses how auth tokens are handled; the double lets a test exercise the UI service's token-attachment and its failure handling without real secure storage.
- **Walkthrough**: The ctor (line 18) seeds `AccessToken`/`RefreshToken` (defaults `"test-token"`/`"test-refresh-token"`, `null` for an anonymous client) and sets `AccessTokenProvider` to return the current `AccessToken` (lines 20-22). `GetAccessTokenAsync()` (line 39) invokes the provider delegate; `GetRefreshTokenAsync()` (line 42) returns `RefreshToken`. `SetTokensAsync(accessToken, refreshToken)` (line 45) and `ClearTokensAsync()` (line 53) mutate the canned values (clear sets both to `null`, lines 55-56) so a test can assert the post-login/post-logout state via `AccessToken`/`RefreshToken`.
- **Where it's used**: Exposed as `TokenStorage` on [UiHttpServiceHarness](#uihttpserviceharness) (`UiHttpServiceHarness.cs:61`) and built by [HttpTestDoubles](#httptestdoubles)`.TokenStorage(...)` (`HttpTestDoubles.cs:29`).

### UiHttpServiceHarness

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:12` · Level 2 · class

- **What it is**: A disposable facade that owns the whole HTTP plumbing a UI HTTP-service test needs: the capturing handler, an `IHttpClientFactory` that hands out a fresh client per call, and a fixed-token storage stub, all on a shared base address (`UiHttpServiceHarness.cs:3-12`).
- **Depends on**: [CapturingHttpMessageHandler](#capturinghttpmessagehandler), [FreshApiClientFactory](#freshapiclientfactory), and [StubTokenStorageService](#stubtokenstorageservice); implements BCL `IDisposable`.
- **Concept introduced: the harness (assemble the doubles once, hand a service its edges).** Where the individual doubles are the parts, this is the one object a test constructs to get a ready-to-inject set. It mirrors [CapturingHttpMessageHandler](#capturinghttpmessagehandler)'s two configuration styles through two public ctors, then wires the client factory and token stub around one shared handler. `[Rubric §14, Testability]`: collapsing the setup to a single harness (and a single `Dispose`) is what keeps each HTTP-service test's arrange block small and consistent.
- **Walkthrough**: `DefaultBaseAddress` (line 15) is `https://gateway.test/` so services can use relative URIs. The route-mode ctor (line 23, default `accessToken = "test-token"`) constructs a plain [CapturingHttpMessageHandler](#capturinghttpmessagehandler) (line 24); the responder-mode ctor (line 35) constructs one from a `respond` delegate (line 39). Both chain to the private ctor (line 43) that stores `Handler` (line 45), resolves `BaseAddress` (falling back to the default, line 46), builds a [FreshApiClientFactory](#freshapiclientfactory) on the handler and address (line 47), and a [StubTokenStorageService](#stubtokenstorageservice) with the token (line 48). The properties `Handler` (line 52), `BaseAddress` (line 55), `ClientFactory` (line 58, typed `IHttpClientFactory`), and `TokenStorage` (line 61, typed [StubTokenStorageService](#stubtokenstorageservice) so tests can mutate it) expose the wired pieces. `Dispose()` (line 63) disposes the shared handler.
- **Why it's built this way**: A single owned handler behind both the client factory and the recorder means a test configures responses in one place and reads requests in the same place; the fresh-client-per-call factory is what keeps the harness compatible with services that dispose their clients (see [FreshApiClientFactory](#freshapiclientfactory)).
- **Where it's used**: Constructed by UI HTTP-service test classes across the repos; tests that wire the pieces individually instead use [HttpTestDoubles](#httptestdoubles).

### HttpTestDoubles

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:12` · Level 3 · class

- **What it is**: A static class of factory helpers for UI HTTP-service tests: standalone client-factory and token-storage doubles for tests that wire the pieces by hand rather than through [UiHttpServiceHarness](#uihttpserviceharness), plus the canned-response builders both styles share (`HttpTestDoubles.cs:7-12`).
- **Depends on**: [FreshApiClientFactory](#freshapiclientfactory), [StubTokenStorageService](#stubtokenstorageservice), [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice), [UiHttpServiceHarness](#uihttpserviceharness) (for `DefaultBaseAddress`), and BCL `System.Net.Http.Json` (`JsonContent`, `HttpTestDoubles.cs:1-3`).
- **Concept introduced**: The a-la-carte counterpart to the all-in-one harness. Some tests need only a response builder or only a client factory, so this class exposes the same building blocks as free functions. `[Rubric §14, Testability]`: offering both a bundled harness and loose factories keeps the setup ergonomics right whether a test wants everything or one piece.
- **Walkthrough**: `BaseAddress` (line 15) reuses [UiHttpServiceHarness](#uihttpserviceharness)`.DefaultBaseAddress` so both styles share one base URL. `ClientFactory(handler, baseAddress)` (line 23) returns a [FreshApiClientFactory](#freshapiclientfactory) on the given handler (line 24). `TokenStorage(accessToken)` (line 28) returns a [StubTokenStorageService](#stubtokenstorageservice) typed as [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) (line 29). The response builders: `JsonResponse<T>(payload, statusCode = OK)` (line 33) wraps a `JsonContent.Create(payload)` (line 34, web serializer defaults); `EmptyResponse(statusCode = NoContent)` (line 37) is a body-less response (line 38); `ProblemResponse(detail, title = "Domain Exception", statusCode = BadRequest)` (line 44) emits a ProblemDetails-shaped `{ title, detail }` body the way the WebAPI emits domain failures (line 48), so the UI-side error mapping sees the shape it expects.
- **Why it's built this way**: `ProblemResponse` deliberately mirrors the WebAPI's domain-failure envelope so a test can prove the UI service's error path (for example a `ServiceExceptionHelper`) parses real failure shapes, not an invented one (`HttpTestDoubles.cs:40-43`).
- **Where it's used**: By UI HTTP-service test classes that hand-wire doubles or build canned responses for a [CapturingHttpMessageHandler](#capturinghttpmessagehandler) responder delegate.

### GalleryFakeAuthenticationHandler

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:19` · Level 0 · class (sealed, internal)

- **What it is**: a cookie-toggled fake ASP.NET Core authentication handler for the backend-less gallery. A request carrying `gallery_auth=1` authenticates as a fixed "Gallery Visitor" principal; every other request stays anonymous (`MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:30-39`).
- **Depends on**: `Microsoft.AspNetCore.Authentication.AuthenticationHandler<AuthenticationSchemeOptions>` (the abstract base), the base constructor triple `IOptionsMonitor<AuthenticationSchemeOptions>` / `ILoggerFactory` / `System.Text.Encodings.Web.UrlEncoder` (`GalleryFakeAuthenticationHandler.cs:19-23`), and BCL `System.Security.Claims`. No first-party dependencies.
- **Concept introduced, the backend-less gallery stub pattern and its one non-inert member.** The gallery host ([GalleryHost](#galleryhost)) renders the real `MMCA.Common.UI` components with no live API behind them, so every consumer-supplied boundary the shared UI expects is replaced by a benign stub. This type is the exception that proves the rule: it is not inert, because the shared notification pages carry a real `[Authorize]`. `MapRazorComponents` surfaces that attribute as endpoint metadata, and the authorization middleware then needs a genuine authentication scheme registered (without one it throws) and a genuine authenticated principal (without one the pages redirect to `/login` instead of rendering for the scan). The doc comment records exactly that reasoning (`GalleryFakeAuthenticationHandler.cs:8-18`). Rather than removing the guard for testability, the gallery supplies a real scheme whose only decision input is a cookie. `[Rubric §28, Front-End Testing]` assesses whether the UI has real-browser render and accessibility coverage; toggling sign-in per test with a cookie is what lets one host scan both the anonymous chrome (`/login`, `/register`, `/components`) and the signed-in guarded pages. `[Rubric §11, Security]` assesses how authentication is implemented; note the deliberate inversion here, the handler trusts an unsigned cookie value, acceptable only because this assembly is unpackaged test infrastructure (the doc comment closes with "never copy into a real host", `GalleryFakeAuthenticationHandler.cs:17`).
- **Walkthrough**: two internal constants pin the contract shared with the host and the tests, `SchemeName = "GalleryFake"` (`:25`) and `CookieName = "gallery_auth"` (`:26`). `HandleAuthenticateAsync()` (`:28`) is the single override. It short-circuits first: when `Request.Cookies["gallery_auth"]` is not exactly `"1"` it returns `AuthenticateResult.NoResult()` (`:30-33`), which means "this scheme has no opinion", leaving the request anonymous rather than failing it. Otherwise it builds a `ClaimsIdentity` with one `ClaimTypes.Name` claim of `"Gallery Visitor"` and, critically, passes `SchemeName` as the authentication type (`:35-37`): supplying an authentication type is what makes `Identity.IsAuthenticated` true. It wraps that principal in an `AuthenticationTicket` and returns `AuthenticateResult.Success` (`:38-39`). Everything is synchronous through `Task.FromResult`, so no I/O occurs.
- **Why it's built this way**: keeping the guard real and faking only the credential means the E2E scan exercises the same authorization pipeline the deployed hosts run, so an accidental loss of `[Authorize]` on the shared notification pages cannot be papered over by a permissive test host.
- **Where it's used**: registered as the default (and only) authentication scheme by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:69-72`), followed by `AddAuthorization()` (`GalleryHost.cs:73`). The cookie is seeded on the Playwright browser context by [NotificationPagesE2ETests](#notificationpagese2etests)`.SeedSignedInCookieAsync` (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:62-71`) before each of its three guarded-page scans (`:23,38,50`).

### NullTokenRefresher

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:9` · Level 1 · class (sealed, internal)

- **What it is**: an [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) that never has a session to refresh. The gallery has no API to refresh against; the stub exists only so the DI graph stays complete (`MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:5-8`).
- **Depends on**: [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) from `MMCA.Common.UI.Services.Auth`. Nothing else.
- **Concept introduced**: the purest instance of the stub pattern introduced in [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler), collapsing an outbound boundary to a constant. `[Rubric §14, Testability]` assesses how cheaply a component renders in isolation; reducing token refresh to a constant is what keeps the scan from ever reaching a token endpoint.
- **Walkthrough**: one member. `AcquireAccessTokenAsync(CancellationToken = default)` (`:11-12`) is an expression body returning `Task.FromResult<string?>(null)`, the interface's own "no valid session exists" answer (`MMCA.Common.UI/Services/Auth/ITokenRefresher.cs:15-20`), so any caller takes its null-token path.
- **Where it's used**: registered scoped by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:61`) in the pre-`AddUIShared` stub block. In the shared UI the only constructor taking an `ITokenRefresher` is `AuthUIService` (`MMCA.Common.UI/Services/Auth/AuthUIService.cs:18`), which the gallery replaces with [NoOpAuthUIService](#noopauthuiservice), so this registration is graph-completeness insurance rather than a live collaborator.

### NullTokenStorageService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:10` · Level 1 · class (sealed, internal)

- **What it is**: an in-memory-empty [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice): there is no stored session in the gallery. It exists so the [AuthDelegatingHandler](group-15-common-ui-framework.md#authdelegatinghandler) that `AddUIShared` registers resolves cleanly, and it is never actually invoked because the gallery makes no API calls (`MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:5-9`).
- **Depends on**: [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) from `MMCA.Common.UI.Services.Auth`.
- **Concept introduced**: the same stub pattern as [NullTokenRefresher](#nulltokenrefresher), covering storage rather than refresh, and the first place where a stub exists purely to satisfy a *transitive* constructor. `AddUIShared` registers [AuthDelegatingHandler](group-15-common-ui-framework.md#authdelegatinghandler) as transient and attaches it to the named `"APIClient"` pipeline (`MMCA.Common.UI/DependencyInjection.cs:57,73`), and that handler's primary constructor takes an `ITokenStorageService` (`MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9-10`). Nothing in `AddUIShared` supplies one, so the host must. `[Rubric §26, Front-End Security]` assesses how auth tokens are stored and handled; this stub deliberately holds nothing, so the test host persists no credential material at all, not even in memory.
- **Walkthrough**: four members, each inert but shape-complete so DI binds. `GetAccessTokenAsync()` (`:12`) and `GetRefreshTokenAsync()` (`:14`) return `Task.FromResult<string?>(null)`; `SetTokensAsync(accessToken, refreshToken)` (`:16`) and `ClearTokensAsync()` (`:18`) discard their inputs and return `Task.CompletedTask`.
- **Where it's used**: registered scoped by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:60`), inside the block placed ahead of `AddUIShared` (`GalleryHost.cs:55-63`).
- **Caveats / not-in-source**: unlike [NoOpAuthUIService](#noopauthuiservice), this registration is not a `TryAdd` override. `AddUIShared` makes no `ITokenStorageService` registration of its own (`MMCA.Common.UI/DependencyInjection.cs:27-98`); the concrete storage services are supplied per host head (for example `WasmTokenStorageService` and `ServerTokenStorageService`), so in the gallery this stub is the only registration rather than a winning one.

### GalleryUIModule

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:13` · Level 3 · class (sealed, internal)

- **What it is**: a minimal [IUIModule](group-15-common-ui-framework.md#iuimodule) whose `Assembly` is the gallery itself, so the shared Blazor Router (`Routes.razor`, which scans `UIModules.Select(m => m.Assembly)`) discovers the gallery's own `/components` showcase page. Its nav links make the host browsable when run interactively (`MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:8-12`).
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) and [NavItem](group-15-common-ui-framework.md#navitem) from `MMCA.Common.UI.Common`, plus `MudBlazor.Icons` and BCL `System.Reflection.Assembly`.
- **Concept introduced**: the UI-module contribution pattern (taught with [IUIModule](group-15-common-ui-framework.md#iuimodule) in the Common UI framework group) reused for a test host: a module contributes route-bearing assemblies and nav links to the shared shell. `[Rubric §18, UI Architecture]` assesses how the front end composes independently-owned UI slices; the gallery participates in the exact module-discovery mechanism the real apps use, which is what makes the E2E evidence say something about *that mechanism* rather than about a bespoke test shell. `[Rubric §25, Navigation & IA]`: the three nav entries flow through the same `NavItem` contract the deployed apps' menus are built from.
- **Walkthrough**: `NavItems` (`:15`) is a collection-expression `IReadOnlyList<NavItem>` of three entries, Login (`/login`), Register (`/register`), and Components (`/components`), each pairing a label, a route, and a MudBlazor Material icon (`:17-19`). `Assembly` (`:22`) is an expression-bodied property returning `typeof(GalleryUIModule).Assembly`, so the Router additionally scans the gallery assembly for routable components, which is how `MMCA.Common.UI.Gallery/Pages/ComponentsGallery.razor` becomes reachable.
- **Where it's used**: registered as a singleton `IUIModule` by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:85`); the page it makes routable is what `ComponentsPageE2ETests` scans.

### StubNotificationInboxUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/StubNotificationInboxUIService.cs:11` · Level 3 · class (sealed, internal)

- **What it is**: a canned [INotificationInboxUIService](group-15-common-ui-framework.md#inotificationinboxuiservice) returning fixed inbox data so [NotificationBell](group-15-common-ui-framework.md#notificationbell) and the notification inbox page render populated, real markup for the axe and render scans, with no backend (`MMCA.Common.UI.Gallery/Stubs/StubNotificationInboxUIService.cs:7-10`).
- **Depends on**: [INotificationInboxUIService](group-15-common-ui-framework.md#inotificationinboxuiservice) from `MMCA.Common.UI.Services.Notifications`, the [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) and [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata) result types from `MMCA.Common.Shared.Abstractions`, the [UserNotificationDTO](group-10-notifications.md#usernotificationdto) contract, and the solution-wide `UserNotificationIdentifierType` alias.
- **Concept introduced**: the stub pattern extended from inert no-ops to *canned data*. For components whose whole purpose is displaying content, an empty stub renders an empty (and therefore untested) tree, so this stub returns representative rows instead. `[Rubric §28, Front-End Testing]`: populated markup is what lets axe evaluate contrast, roles, and the read/unread affordances against a realistic notification list rather than an empty state.
- **Walkthrough**: `GetInboxAsync(pageNumber = 1, pageSize = 20, cancellationToken)` (`:13-14`) builds a two-item `UserNotificationDTO[]` (`:16-29`): an unread "Welcome to MMCA" with a fixed UTC `SentOn` of 2026-01-02 09:00, and a read "Scheduled maintenance" carrying both `ReadOn` and `SentOn`, so the inbox exercises both visual states. It wraps them in a `PagedCollectionResult<UserNotificationDTO>` with `new PaginationMetadata(items.Length, pageSize, pageNumber)` (`:30-31`), so the pager renders from real metadata rather than a hardcoded count. `GetUnreadCountAsync()` (`:34`) returns a constant `3` so the bell badge renders non-empty. `MarkReadAsync(id, ct)` (`:36-37`) and `MarkAllReadAsync(ct)` (`:39`) are no-ops returning `Task.CompletedTask`, so the buttons are present and clickable without any state change.
- **Where it's used**: registered scoped by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:79`), alongside the scoped [NotificationState](group-15-common-ui-framework.md#notificationstate) (`GalleryHost.cs:78`). The scan that consumes it is [NotificationPagesE2ETests](#notificationpagese2etests)`.NotificationInbox_Renders_AndHasNoWcag21AaViolations` (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:35-45`), which asserts the "Mark All as Read" button and the "Welcome to MMCA" row are visible before running the [AxeOptions](#axeoptions)`.Wcag21Aa` scan.
- **Caveats / not-in-source**: the badge count `3` (`:34`) is a hardcoded display value and does not reconcile with the two rows `GetInboxAsync` returns; it exists to render a non-empty badge for the scan, not to be internally consistent.

### StubPushNotificationUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/StubPushNotificationUIService.cs:11` · Level 3 · class (sealed, internal)

- **What it is**: a canned [IPushNotificationUIService](group-15-common-ui-framework.md#ipushnotificationuiservice) so the notification history and compose pages render populated, real markup for the axe and render scans, with no backend (`MMCA.Common.UI.Gallery/Stubs/StubPushNotificationUIService.cs:7-10`).
- **Depends on**: [IPushNotificationUIService](group-15-common-ui-framework.md#ipushnotificationuiservice) from `MMCA.Common.UI.Services.Notifications`, [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) and [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata), plus the [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) and [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) contracts.
- **Concept introduced**: the same canned-data variant of the stub pattern as [StubNotificationInboxUIService](#stubnotificationinboxuiservice), applied to the send and history side. `[Rubric §24, Forms/Validation/UX Safety]`: the compose page is a form, and echoing the submitted `Title` and `Body` back in the returned DTO lets the render smoke reach the post-submit state without a real send.
- **Walkthrough**: `SendAsync(request, cancellationToken)` (`:13-14`) is an expression body returning a single `PushNotificationDTO` that echoes `request.Title` and `request.Body` and fixes the rest, `Id = 99`, `SentByUserId = 1`, `RecipientCount = 42`, `Status = "Sent"`, `CreatedOn` 2026-01-04 10:00 UTC (`:15-19`). `GetHistoryAsync(pageNumber = 1, pageSize = 10, cancellationToken)` (`:21-22`) builds a two-item history array (`:24-36`): one row with `Status = "Sent"` and one with `Status = "Failed"`, both with `RecipientCount = 128`, so the history table renders both status treatments, then wraps them in a `PagedCollectionResult<PushNotificationDTO>` with `PaginationMetadata` (`:37-38`).
- **Where it's used**: registered scoped by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:80`). The scans that consume it are [NotificationPagesE2ETests](#notificationpagese2etests)`.NotificationHistory_Renders_AndHasNoWcag21AaViolations` and `.NotificationCompose_Renders_AndHasNoWcag21AaViolations` (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:20-33,47-57`); the history scan runs under [AxeOptions](#axeoptions)`.Wcag21AaExceptMudPagerCombobox` because MudBlazor 9.6.0's pager combobox has no accessible name and is not fixable from app markup (`NotificationPagesE2ETests.cs:29-32`).

### NoOpAuthUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:12` · Level 6 · class (sealed, internal)

- **What it is**: a no-op [IAuthUIService](group-15-common-ui-framework.md#iauthuiservice) for the backend-less gallery. The gallery renders the real Login and Register pages for accessibility and render-smoke scanning only, so every operation returns a benign default (`MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:6-11`).
- **Depends on**: [IAuthUIService](group-15-common-ui-framework.md#iauthuiservice) from `MMCA.Common.UI.Services.Auth`, and the [LoginRequest](group-08-auth.md#loginrequest), [RegisterRequest](group-08-auth.md#registerrequest), and [AuthenticationResponse](group-08-auth.md#authenticationresponse) contracts from `MMCA.Common.Shared.Auth`.
- **Concept introduced, registration order as the override mechanism.** This stub is registered *before* `AddUIShared`, whose `TryAddScoped<IAuthUIService, AuthUIService>()` (`MMCA.Common.UI/DependencyInjection.cs:76-77`) then defers to it, exactly as the class doc comment states (`NoOpAuthUIService.cs:9-11`). `TryAdd*` is first-registration-wins, so a test host overrides only the boundaries it names and inherits every other registration the shared UI makes, with no fork of the composition root. `[Rubric §11, Security]` assesses how authentication is handled; here the client-side auth boundary is neutralized entirely so the scan touches the real login and register markup without any credential flow. `[Rubric §14, Testability]`: substituting the top-level UI auth service for constants is what makes those pages renderable in isolation.
- **Walkthrough**: `LastError` (`:14`) is always `null`, so no error alert renders. `LoginAsync`, `RegisterAsync`, and `ExchangeOAuthCodeAsync` (`:16,19,22`) each return `Task.FromResult<AuthenticationResponse?>(null)`, meaning "no authenticated session" on the interface's own terms. `LogoutAsync()` (`:25`) returns `Task.CompletedTask`. `TryRefreshTokenAsync(ct)` (`:27`) and `ChangePasswordAsync(currentPassword, newPassword, ct)` (`:30`) both return `Task.FromResult(false)`. Every path is inert but shape-complete, so the pages bind, render, and stay in their signed-out state for the axe pass.
- **Why it's built this way**: placing the stub ahead of `AddUIShared` exploits the shared UI's `TryAdd*` idempotence rather than requiring the shared registration extension to grow test hooks, which keeps the production DI code free of test-only branches.
- **Where it's used**: registered scoped by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:59`), the first of the pre-`AddUIShared` stub registrations; consumed indirectly by the `LoginPageE2ETests` and `RegisterPageE2ETests` scans of the real shared auth pages.

### GalleryAuthenticationStateProvider

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryAuthenticationStateProvider.cs:16` · Level 7 · class (sealed, internal)

- **What it is**: the gallery's Blazor `AuthenticationStateProvider`. It mirrors the request's authentication in *both* render phases, so `AuthorizeView` and `CascadingAuthenticationState` agree with whatever [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler) decided for the request. Without the `gallery_auth` cookie both phases yield anonymous, preserving the deliberate signed-out chrome of the login, register, and components scans (`MMCA.Common.UI.Gallery/Stubs/GalleryAuthenticationStateProvider.cs:6-15`).
- **Depends on**: `Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider` (the abstract base) and `IHostEnvironmentAuthenticationStateProvider` (the interface the Blazor Server host calls into) at `:16-17`, `IHttpContextAccessor` injected as a primary-constructor parameter (`:16`), and BCL `ClaimsPrincipal` / `ClaimsIdentity`.
- **Concept introduced, the two render phases of interactive-server Blazor.** A page first renders as static SSR inside the HTTP request, then, once the circuit connects, re-renders interactively over a WebSocket where there is no ambient `HttpContext`. An auth-state provider therefore has to answer correctly in two different worlds. This class handles both: SSR reads the request user through `IHttpContextAccessor`, and for the interactive circuit the framework pushes the handshake user in through `IHostEnvironmentAuthenticationStateProvider.SetAuthenticationState`. The doc comment records that this replaced a former always-anonymous stub, which could not represent the signed-in state the guarded notification pages now need (`:7-9`). `[Rubric §19, State Management]` assesses how client state is owned and propagated; auth state is the canonical cascading state, and this shows the two supply routes it has under interactive server rendering. `[Rubric §28, Front-End Testing]`: getting both phases right is what stops a guarded page from flipping to a signed-out tree mid-scan and producing a false pass on the wrong markup.
- **Walkthrough**: `Anonymous` (`:19-20`) is a `static readonly AuthenticationState` wrapping an empty `ClaimsPrincipal(new ClaimsIdentity())`, unauthenticated precisely because no authentication type is supplied (contrast [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler), which passes one). `_hostState` (`:22`) is the nullable task the framework may have pushed in. `GetAuthenticationStateAsync()` (`:24`) checks `_hostState` first and returns it verbatim when present (`:26-29`): the circuit's handshake user always wins. Otherwise it falls back to the SSR path, reading `httpContextAccessor.HttpContext?.User` (`:31`) and returning a new `AuthenticationState(user)` only when `user?.Identity?.IsAuthenticated == true`, else the shared `Anonymous` (`:32-34`). Both branches use `Task.FromResult`, so no async machinery is allocated per call. `SetAuthenticationState(Task<AuthenticationState>)` (`:37-38`) is the `IHostEnvironmentAuthenticationStateProvider` implementation and simply stores the task; it does not call `NotifyAuthenticationStateChanged`, because the framework sets it before the first interactive render.
- **Why it's built this way**: the gallery mirrors rather than fabricates. Deriving the component-tree state from whatever the request actually authenticated as keeps one source of truth (the cookie) for the middleware, the endpoint authorization, and the render tree, so a scan cannot land in a split state where the endpoint admitted the request but the tree still renders signed-out.
- **Where it's used**: registered scoped as the `AuthenticationStateProvider` by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:63`), immediately after `AddHttpContextAccessor()` (`GalleryHost.cs:62`), which supplies its dependency.
- **Caveats / not-in-source**: the class implements `IHostEnvironmentAuthenticationStateProvider` but is registered only under the `AuthenticationStateProvider` service type (`GalleryHost.cs:63`). Whether the Blazor Server host resolves this same instance when it calls `SetAuthenticationState` is framework behavior and is not determinable from this repository's source.

### GalleryHost

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery` · `MMCA.Common.UI.Gallery/GalleryHost.cs:21` · Level 8 · class (public, static)

- **What it is**: a static builder that assembles the entire backend-less Blazor gallery host. It renders the real `MMCA.Common.UI` auth pages (`/login`, `/register`), the shared notification pages (`/notifications`, `/notifications/inbox`, `/notifications/send`), and a primitives showcase (`/components`) against stub implementations of every consumer boundary, so a real-browser axe accessibility scan can run against the shared UI inside `MMCA.Common`'s own CI (`MMCA.Common.UI.Gallery/GalleryHost.cs:15-19`).
- **Depends on**: ASP.NET Core `WebApplication` / `WebApplicationBuilder`, MudBlazor (`AddMudServices`, `GalleryHost.cs:53`), the shared `MMCA.Common.UI` surface (`AddUIShared`, the gallery's own `App` root component, and `MMCA.Common.UI._Imports` as the additional-assembly marker), and [SupportedCultures](group-12-api-hosting-mapping.md#supportedcultures) from `MMCA.Common.Shared.Globalization`. It wires in every stub in this unit: [NoOpAuthUIService](#noopauthuiservice), [NullTokenStorageService](#nulltokenstorageservice), [NullTokenRefresher](#nulltokenrefresher), [GalleryAuthenticationStateProvider](#galleryauthenticationstateprovider), [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler), [StubNotificationInboxUIService](#stubnotificationinboxuiservice), [StubPushNotificationUIService](#stubpushnotificationuiservice), and [GalleryUIModule](#galleryuimodule), plus the shared [NotificationState](group-15-common-ui-framework.md#notificationstate).
- **Concept introduced, a self-hostable test host as one buildable unit.** The whole host build lives in `BuildApp(string[] args)` (`:28`) rather than in `Program.cs`, so two callers share the identical configured app: the `dotnet run` entry point, which `RunAsync()`s it (`MMCA.Common.UI.Gallery/Program.cs:7-8`), and the E2E collection fixture [GalleryHostFixture](#galleryhostfixture), which `StartAsync()`s it on an ephemeral Kestrel port. `[Rubric §28, Front-End Testing]` assesses real-browser UI coverage; this host is the render target for the cross-browser `ui-e2e` axe and render matrix. `[Rubric §33, Developer Experience]`: `Program.cs:3-6` records the rationale, one `BuildApp` for both entry points avoids the separate `dotnet run` plus health-poll that made ADC's e2e cold start fragile.
- **Walkthrough**:
  - **Assembly name and base dir** (`:33-34`): `typeof(GalleryHost).Assembly.GetName().Name` is captured without a null-forgiving operator; the comment at `:30-32` explains that CI's nullable analysis treats `AssemblyName.Name` as non-null and would flag `!` as an unnecessary suppression (IDE0370), and the value is only interpolated into a filename, which is null-safe either way.
  - **Static web assets** (`:45-48`): the load-bearing fix. RCL `_content/*` CSS and JS plus `_framework/blazor.web.js` resolve from the *entry* assembly's manifests and auto-load only in Development; when the E2E suite self-hosts in-process the entry assembly is the test host and the environment is Production, so neither default holds. The loader is pointed explicitly at `{galleryAssemblyName}.staticwebassets.runtime.json` and forced on with `UseStaticWebAssets()`. Without it (comment, `:38-44`) the pages render unstyled and never become interactive, so axe's contrast checks would be meaningless and the page would never signal Blazor readiness.
  - **Rendering services** (`:50-53`): `AddRazorComponents().AddInteractiveServerComponents()`, then `AddMudServices()`.
  - **Boundary stubs, before `AddUIShared`** (`:59-63`): scoped `IAuthUIService`, `ITokenStorageService`, and `ITokenRefresher`, then `AddHttpContextAccessor()` and the scoped `AuthenticationStateProvider`. The ordering comment (`:55-58`) states the mechanism, `AddUIShared`'s `TryAdd*` registrations defer to whatever is already present.
  - **Real authentication and authorization** (`:69-73`): `AddAuthentication(GalleryFakeAuthenticationHandler.SchemeName)` plus `AddScheme<AuthenticationSchemeOptions, GalleryFakeAuthenticationHandler>(...)`, then `AddAuthorization()`, because the notification pages' `[Authorize]` surfaces as endpoint metadata (comment, `:65-68`).
  - **Canned notification boundaries** (`:78-80`): scoped `NotificationState`, `INotificationInboxUIService`, and `IPushNotificationUIService`, so the notification pages discovered from the `MMCA.Common.UI` assembly render populated markup (comment, `:75-77`).
  - **Module contribution** (`:85`): the singleton `IUIModule`, so the shared Router discovers the gallery's own `/components` page.
  - **Shared UI** (`:90`): `AddUIShared(builder.Configuration)` registers the `ApiSettings` / `LayoutSettings` binding, the `"APIClient"` HttpClient, and the remaining shared services; the in-memory `Api:ApiEndpoint` from `appsettings.json` satisfies validation, and the client is never invoked because `IAuthUIService` is stubbed (comment, `:87-89`).
  - **Request localization** (`:99-103`): builds `galleryCultures` as `[.. SupportedCultures.All, SupportedCultures.PseudoLocale]` and applies it as the supported and supported-UI culture set over `SupportedCultures.Default`. The comment (`:94-98`) is explicit that this mirrors the real hosts' [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) allowlist but additionally enables `qps-Ploc` *unconditionally*, because this host is unpackaged test infrastructure that is never deployed and the pseudo pass here is a required CI gate ([PseudoLocalizationE2ETests](#pseudolocalizatione2etests), the rubric §27 resource-round-trip and text-expansion evidence). Production keeps `qps-Ploc` Development-only via `UseCommonRequestLocalization`. `[Rubric §27, i18n]`.
  - **Middleware** (`:107-112`): `UseAuthentication()` then `UseAuthorization()` (WebApplication inserts `UseRouting` ahead of them automatically), then `UseAntiforgery()`, required because Razor Component endpoints carry anti-forgery metadata even though the gallery's interactive forms never POST over HTTP.
  - **Endpoints** (`:116-125`): `MapStaticAssets` is given the gallery's own `{galleryAssemblyName}.staticwebassets.endpoints.json` for the same in-process self-host reason as above; a `/health` endpoint returns `Results.Ok("Healthy")` (`:119`); and `MapRazorComponents<App>().AddInteractiveServerRenderMode().AddAdditionalAssemblies(typeof(MMCA.Common.UI._Imports).Assembly)` (`:123-125`) makes the real shared pages routable alongside the gallery's own.
  - **Return** (`:127`): the built-but-not-started `WebApplication`, leaving the start mode to the caller.
- **Why it's built this way**: keeping the whole build in `BuildApp` rather than `Program.cs` lets the E2E fixture host the identical configured app in-process on a real bound port via `StartAsync`, not `WebApplicationFactory`'s in-memory TestServer, which Playwright cannot reach over the wire. [GalleryHostFixture](#galleryhostfixture) therefore clears the URLs, binds `http://127.0.0.1:0`, and reads the ephemeral address back from `IServerAddressesFeature` (`MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryHostFixture.cs:26-38`). This is deliberate CI infrastructure and is never deployed.
- **Where it's used**: consumed by `MMCA.Common.UI.Gallery/Program.cs:7` (the `dotnet run` entry) and by every E2E test through [GalleryHostFixture](#galleryhostfixture) (`MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryHostFixture.cs:26`), against which the axe and render suite runs: `LoginPageE2ETests`, `RegisterPageE2ETests`, `ComponentsPageE2ETests`, [NotificationPagesE2ETests](#notificationpagese2etests), `DarkModeE2ETests`, `MobileTopRowE2ETests`, `WebVitalsE2ETests`, and [PseudoLocalizationE2ETests](#pseudolocalizatione2etests).
- **Caveats / not-in-source**: two notes. First, `MMCA.Common.UI.Gallery` and `MMCA.Common.UI.E2E.Tests` are deliberately excluded from `MMCA.Common.slnx` (per the repo `CLAUDE.md`) so the unit-test run stays fast; they build only by csproj path and run only in CI's `ui-e2e` job. Second, the class summary (`GalleryHost.cs:15-19`) still describes the host as rendering the auth pages and `/components` with an "anonymous auth state", which lags the code: `BuildApp` now also serves the guarded notification pages and registers [GalleryAuthenticationStateProvider](#galleryauthenticationstateprovider), which mirrors the request rather than forcing anonymous.

### BrandColorTokenTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:12` · Level 1 · class

- **What it is** - ADC's binding of the brand-token drift guard: a sealed subclass whose single override names the conference landing page's scoped stylesheet, so the rule can assert that page sources the primary brand color from the shared CSS custom property instead of re-hardcoding the hex.
- **Depends on** - [BrandColorTokenTestsBase](#brandcolortokentestsbase) (`BrandColorTokenTests.cs:12`). Notably it does *not* supply an [IArchitectureMap](#iarchitecturemap): this base reads manifest resources, not assemblies, so it needs no layer inventory. The real wiring lives in the csproj, which embeds `Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.css` under the logical name `ADCHome.Shared.razor.css` (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:11-13`).
- **Concept introduced: the embedded-resource fitness input.** Most rules in this project reflect over compiled assemblies. This one has to read a *text* asset that lives in another project entirely, and a test cannot rely on a relative file path surviving the runner's working directory. The pattern is to embed the file as a manifest resource of the test assembly at build time and address it by a stable logical name; the base then resolves it from `GetType().Assembly` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:33`,`:58`), which is the derived type's assembly, so each repo gets its own asset with no extra plumbing. `[Rubric §20 - Design System & Theming]` assesses whether the visual language has a single source of truth; the base fails the build if the stylesheet omits `var(--mmca-primary)` or re-introduces the literal `#1565C0` (`BrandColorTokenTestsBase.cs:15-16`,`:41-49`), which is exactly how a per-host copy silently drifts from the framework palette.
- **Walkthrough** - one member. `EmbeddedCssLogicalNames` (`BrandColorTokenTests.cs:14-17`) is a one-entry collection expression, `"ADCHome.Shared.razor.css"`. The list is a list because Store embeds two copies (server and client renders of its landing page); ADC ships one shared scoped stylesheet in Conference.UI that both UI hosts render, so one entry covers both. Everything else is inherited: the base's single `[Fact]` asserts the list is non-empty (a vacuity guard), reads each resource, and records a violation for an empty stylesheet, a missing token, or a re-introduced hex (`BrandColorTokenTestsBase.cs:25-53`). The live stylesheet consumes the token in three places (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.css:215`,`:252`,`:277`).
- **Why it's built this way** - the class doc comment (`BrandColorTokenTests.cs:3-11`) draws the division of labor: MMCA.Common's own `BrandColorTokenTests` guards the C#-to-CSS token *definition* (`BrandColors.Primary` flowing into `app.css`, see [BrandColors](group-15-common-ui-framework.md#brandcolors)), and this class guards the ADC *consumer* of it. Splitting definition from consumption is what makes the guard catch a drift in either direction.
- **Where it's used** - discovered by xUnit v3 in the `MMCA.ADC.Architecture.Tests` project, which is a member of `MMCA.ADC.CI.slnf` (`MMCA.ADC/MMCA.ADC.CI.slnf:58`) and therefore runs in the `build-and-test` job of `deploy.yml` (`MMCA.ADC/.github/workflows/deploy.yml:99`,`:194`). No database, no browser.

### ObservabilityConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7` · Level 1 · class

- **What it is** - the alert-to-runbook pairing gate for ADC: a body-less sealed subclass (`public sealed class ObservabilityConventionTests : ObservabilityConventionTestsBase;`, `ObservabilityConventionTests.cs:7`) that turns on a rule asserting every SLO metric alert ADC provisions in Bicep keeps a matching, severity-correct triage section in its operations runbook.
- **Depends on** - [ObservabilityConventionTestsBase](#observabilityconventiontestsbase) (`ObservabilityConventionTests.cs:7`). Beyond it the dependency is entirely csproj-side: `infra/main.bicep` and `infra/OPERATIONS.md` are embedded under the logical names `infra.main.bicep` and `infra.OPERATIONS.md` (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:17-22`). It supplies no [IArchitectureMap](#iarchitecturemap): the rule reads embedded text, not assemblies.
- **Concept introduced: the identity-only subclass.** This is the most extreme form of the thin-subclass pattern in the repo: the class declares no members at all, using the C# semicolon-bodied class form. Its entire contribution is *existing in this assembly*, because the base resolves its embedded resources from `ResourceAssembly`, which defaults to `GetType().Assembly` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:51`). The inline comment says exactly that: "this repo supplies only its identity" (`ObservabilityConventionTests.cs:3-6`). `[Rubric §13 - Observability & Operability]` assesses whether operational signals come with actionable response paths; the base's three facts assert the alert specs are discovered at all (a floor of 3, `ObservabilityConventionTestsBase.cs:39`,`:54-61`), that every provisioned alert has a `### ...-alert-<key>` runbook heading carrying its `(sev N)` tag (`:64-89`), and that no orphan runbook section survives an alert's removal (`:92-103`).
- **Walkthrough** - no members. The interesting state is in the two embedded files. ADC's `sloAlertSpecs` block declares exactly three alerts, `failed-requests` (severity 2), `server-response-time` (severity 3), and `dependency-failures` (severity 2) (`MMCA.ADC/infra/main.bicep:238-261`), and the runbook carries the three matching headings with their severities spelled into the heading text (`MMCA.ADC/infra/OPERATIONS.md:15`,`:29`,`:42`). ADC does not override `MinimumAlertSpecs`, so it sits exactly at the base's default floor of 3: adding a fourth alert is free, but removing one fails the vacuity guard rather than silently shrinking the gate.
- **Why it's built this way** - alerts and runbooks rot apart the moment they live in different review paths. Parsing the IaC template for the alert set and the markdown for the response set, then asserting a bijection, makes them change together or not at all. The severity check closes the subtler drift: an alert re-tiered from sev 3 to sev 2 without the runbook's escalation guidance moving is the failure mode this catches.
- **Caveats / not-in-source** - the base parses the Bicep between the literal anchors `var sloAlertSpecs` and `resource sloAlerts` (`ObservabilityConventionTestsBase.cs:109-114`). Alert-like blocks elsewhere in the template (for example the `outbox-dead-letter` and `sql-dependency-failures` keys at `MMCA.ADC/infra/main.bicep:315`,`:321`) fall outside that window and are not covered by this gate.
- **Where it's used** - runs with the rest of the architecture suite in the `build-and-test` job.

### TranslationCompletenessTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:12` · Level 5 · class

- **What it is** - ADC's translation-coverage gate: every base `*.resx` under `Source/` must have a complete, non-empty Spanish sibling, so adding an English key without its translation fails CI instead of silently shipping a half-translated UI.
- **Depends on** - [LocalizationResourceTestsBase](#localizationresourcetestsbase) (`TranslationCompletenessTests.cs:12`). Like the two gates above it takes no map: the underlying rule locates the scan root by walking up to `Directory.Packages.props` and appending `Source` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Localization.cs:30`).
- **Concept introduced: the non-vacuity floor.** A file-scanning rule has a failure mode a reflection rule does not: point it at the wrong directory and it passes having checked nothing. The countermeasure used throughout this suite is a minimum-discovery assertion. Here `MinimumBaseResources => 40` (`TranslationCompletenessTests.cs:16`) is that floor, and the doc comment (`:8-10`) records the reasoning: ADC has more than forty localized resource sets across the three module UIs, the hosts' landing page, the nav-item descriptors, and the API error resources, so a near-zero count means the scan path moved, not that the translations vanished. The repo currently holds 53 base `.resx` files under `Source/`, comfortably above the floor. `[Rubric §27 - i18n]` assesses whether localization is complete and enforced rather than aspirational; this is the "resources are translated" half of that story, paired with [LocalizedTextConventionTests](#localizedtextconventiontests), which is the "strings are not hard-coded" half.
- **Walkthrough** - two overrides. `RequiredCultures => ["es"]` (`TranslationCompletenessTests.cs:14`) names Spanish as the one non-default culture; the rule short-circuits to a no-op for an empty list, which is how single-locale repos opt out (`ArchitectureRules.Localization.cs:25-28`). `MinimumBaseResources => 40` (`:16`) sets the floor. The rule itself enumerates every `*.resx` that is not culture-specific and not under `bin`/`obj` (`ArchitectureRules.Localization.cs:32-36`), then for each one reports a violation if the `<stem>.es.resx` sibling is missing entirely or is missing a non-empty value for any key the base file declares (`:53-67`). Non-string resources (anything carrying a `type` or `mimetype` attribute) are skipped so embedded images do not need translating (`:87-90`).
- **Why it's built this way** - [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (multi-locale i18n) supersedes the earlier single-locale [ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html), and the class doc comment (`TranslationCompletenessTests.cs:4`) says so directly. Key-level comparison rather than file-existence is what makes the gate useful: a Spanish file that exists but lags three keys behind is the realistic drift, and it fails here.
- **Where it's used** - runs with the rest of the architecture suite in the `build-and-test` job.

### DecoratorPipelineOrderTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:25` · Level 8 · class

- **What it is** - the one class in this unit that builds a real dependency-injection container instead of scanning metadata. It runs ADC's genuine registration sequence, resolves a real Identity command and query handler, and asserts the runtime decorator nesting is exactly the documented pipeline order.
- **Depends on** - [DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult) closed over four real ADC types: [ChangePreferencesCommand](group-24-identity-module.md#changepreferencescommand), [Result](group-01-result-error-handling.md#result), [GetUserPreferencesQuery](group-24-identity-module.md#getuserpreferencesquery), and `Result<`[UserPreferencesResponse](group-24-identity-module.md#userpreferencesresponse)`>` (`DecoratorPipelineOrderTests.cs:25-26`). Its `ConfigureServices` pulls in [ICorrelationContext](group-12-api-hosting-mapping.md#icorrelationcontext), [ICacheService](group-09-caching.md#icacheservice), and [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) as Moq doubles, plus externals `Microsoft.FeatureManagement.IFeatureManager`, `NullLogger<>`, `IServiceCollection`, and Moq itself (`:31-35`). This is why the csproj references `MMCA.Common.Testing` and `Moq` alongside the architecture package (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:42-44`).
- **Concept introduced: a fitness function over the composed object graph, not the type graph.** Every other rule in this unit asks a static question ("does this assembly reference that namespace"). This one asks a *composition* question that no amount of reflection over types can answer, because the answer depends on registration order. Scrutor's `TryDecorate` applies decorators in reverse registration order, so the last registered decorator ends up outermost; reordering two innocuous-looking lines in `AddApplicationDecorators()`, or scanning a module's handlers *after* that call, silently changes runtime behavior with no compile error. The base builds the provider, resolves the closed handler interface, and unwraps the chain by reflecting over each decorator's private inner-handler field, so it verifies the actual constructed graph (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:72-118`). `[Rubric §6 - CQRS & Event-Driven]` assesses whether the command/query pipeline is explicit and consistent; `[Rubric §2 - Design Patterns]` applies too, since the decorator chain is the pattern under test. `[Rubric §14 - Testability]` is the meta-point: the ordering constraint was previously a comment in `CLAUDE.md` and is now an assertion.
- **Walkthrough** - one override, `ConfigureServices(IServiceCollection services)` (`DecoratorPipelineOrderTests.cs:28`), in two deliberate halves.
  - *Test doubles for the decorator constructor dependencies* (`:31-35`): singleton `Mock.Of<IFeatureManager>()`, `Mock.Of<ICorrelationContext>()`, and `Mock.Of<ICacheService>()`; a **scoped** factory for `Mock.Of<IUnitOfWork>()` (scoped because the transactional decorator resolves it per scope); and the open generic `ILogger<>` mapped to `NullLogger<>`. These exist only so the decorators can be constructed, never to be asserted on.
  - *The real registration sequence* (`:39-41`): `services.AddApplication()`, then `ScanModuleApplicationServices<MMCA.ADC.Identity.Application.ClassReference>()`, then `AddApplicationDecorators()` last. The comment above it (`:37-38`) states the load-bearing rule: the module handler scan must run first, because `TryDecorate` can only wrap handlers that are already registered.
  - The two inherited `[Fact]`s do the asserting. `CommandPipeline_NestsDecorators_InAdr014Order` expects FeatureGate, Logging, Caching, Validating, Transactional, then the concrete handler; `QueryPipeline_NestsDecorators_InAdr014Order` expects FeatureGate, Logging, Caching, then the handler (queries have no validating or transactional stage) (`DecoratorPipelineOrderTestsBase.cs:47-70`). The final assertion is that the innermost element does *not* end in `Decorator` (`:89-90`), which is what proves the chain terminates at the real handler.
- **Why it's built this way** - [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) fixes the pipeline order, and the choice of a *real* ADC command/query pair rather than a synthetic one is deliberate: a synthetic handler would prove the base works, while `ChangePreferencesCommand` and `GetUserPreferencesQuery` prove ADC's own registration sequence produces the documented graph. The class doc comment (`DecoratorPipelineOrderTests.cs:16-24`) records that this is an opt-in v1.120.0 fitness function.
- **Where it's used** - runs in the architecture suite alongside the metadata rules; it needs no database and no host, only a `ServiceCollection`.
- **Caveats / not-in-source** - the chain is unwrapped by finding the first field whose value implements the same closed handler interface (`DecoratorPipelineOrderTestsBase.cs:105-108`). That relies on the compiler-generated backing field of a primary-constructor parameter; a decorator that stored its inner handler in some other shape would not be walked the same way. Nothing in the current decorator set does that, but it is a property of the implementation rather than a guarantee.

### AdcArchitectureMap

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:8` · Level 9 · class

- **What it is** - the single piece of repo-specific truth every ADC architecture rule keys off: a flat declaration of which compiled assembly plays which layer, for the MMCA.Common framework and for each of ADC's three mapped business modules.
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (`internal sealed class AdcArchitectureMap : ArchitectureMapBase`, `AdcArchitectureMap.cs:8`) and one anchor type per mapped assembly: [Result](group-01-result-error-handling.md#result), [BaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#baseentitytidentifiertype), [EntityQueryService<TEntity, TEntityDTO, TIdentifierType>](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype), [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext), and [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) for the framework (`:15-19`); [User](group-24-identity-module.md#user), [UserDTO](group-24-identity-module.md#userdto), [IdentityModule](group-24-identity-module.md#identitymodule) for Identity (`:22-27`); [Event](group-17-conference-domain.md#event), [EventDTO](group-17-conference-domain.md#eventdto), [ConferenceModule](group-20-conference-api-grpc.md#conferencemodule) for Conference (`:30-35`); and [UserSessionBookmark](group-22-engagement-module.md#usersessionbookmark), [UserSessionBookmarkDTO](group-22-engagement-module.md#usersessionbookmarkdto), [EngagementModule](group-22-engagement-module.md#engagementmodule) for Engagement (`:38-43`). The `System.Reflection` and `MMCA.Common.Testing.Architecture` namespaces arrive through the project's global usings (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/GlobalUsings.cs:1-5`), which is why none of the classes in this unit carry using directives.
- **Concept introduced: two ways to name an assembly, and why both appear.** The map has to turn "the Identity module's Application layer" into a `System.Reflection.Assembly` instance. Where a layer has a convenient public type, the map anchors on it (`typeof(Identity.Domain.Users.User).Assembly`, `:22`), which is refactor-safe: rename the assembly and the code still compiles and still resolves. Where it does not, the map falls back to `Assembly.Load("MMCA.ADC.Identity.Application")` (`:23`), a string that only works because the csproj carries a `ProjectReference` to that project so the DLL is next to the test assembly at run time (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:46-65`). The trade is stated plainly in the doc comment (`AdcArchitectureMap.cs:3-7`). `[Rubric §3 - Clean Architecture]` assesses whether layer boundaries are explicit and enforced; this map is the machine-readable statement of ADC's boundaries, and it is what lets one rule body in `MMCA.Common.Testing.Architecture` run identically here, in Store, and in Common. `[Rubric §7 - Microservices Readiness]` also applies: because the map records the (module, layer) pair for every assembly, the isolation rules can compute what a would-be extracted service is allowed to touch.
- **Walkthrough** - two members, both required by the base.
  - `RepoToken => "MMCA.ADC"` (`:10`) is the repo's assembly and namespace prefix. It does more than label: the base derives module namespaces from it (`{RepoToken}.{module}.{Segment}`, `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:98-99`), and every file-reading rule locates the repo root by searching upward for `{RepoToken}.slnx` (`ArchitectureMapBase.cs:79-91`). Get this string wrong and half the suite stops finding files.
  - `DefineLayers()` (`:12-44`) returns a collection expression of `LayerRef` entries in four blocks. The five `Framework(...)` calls (`:15-19`) register the MMCA.Common layers with an empty module name, which is the convention that distinguishes a framework layer from a module layer everywhere downstream. The three `Module(...)` blocks register six layers each (Domain, Application, Infrastructure, Shared, Api, Ui) for Identity, Conference, and Engagement. `ModuleNames` is then derived, not declared: the base filters the entries with a non-empty module and orders them ordinally (`ArchitectureMapBase.cs:28-32`), which is how `["Conference", "Engagement", "Identity"]` falls out of this file without being written anywhere.
- **Why it's built this way** - [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) records the intent: rule bodies live once in the shared package and each repo writes one map instead of a parallel rule set. Anchoring by type where possible and centralizing every assembly string in one file is also what keeps Ubuntu CI's case-sensitive paths a one-file problem (`ArchitectureMapBase.cs:8-9`).
- **Where it's used** - supplied as the `Map` property by twenty-five of the thirty classes in this unit, from [ConcurrencyConventionTests](#concurrencyconventiontests) through [UIArchitectureConventionTests](#uiarchitectureconventiontests). It is the ADC counterpart of [CommonArchitectureMap](#commonarchitecturemap).
- **Caveats / not-in-source** - two gaps are deliberate and worth knowing. First, the **Notification module is not mapped at all**: it is API-plus-Application only, so it has no Domain/Shared/Infrastructure layer to declare, and [RawQueryableConventionTests](#rawqueryableconventiontests) has to append its Application project by hand to keep it under that one rule (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/RawQueryableConventionTests.cs:21-30`). Second, the doc comment says Application and Infrastructure assemblies are loaded by name, but the six `Layer.Ui` entries are loaded by name too (`:27`,`:35`,`:43`); the comment under-describes the code. Neither the gateway, the four service hosts, the `.Contracts` gRPC projects, nor the MAUI/Web UI hosts appear in the map, so no rule in this unit reflects over them.

### ConcurrencyConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:3` · Level 10 · class

- **What it is** - ADC's binding of the optimistic-concurrency rule: every `*UpdateRequest` in the mapped assemblies must implement [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware), so a concurrent edit surfaces as 409 Conflict rather than a silent last-write-wins.
- **Depends on** - [ConcurrencyConventionTestsBase](#concurrencyconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`ConcurrencyConventionTests.cs:3-5`).
- **Concept introduced: the canonical thin-subclass shape.** This is the plain form every remaining class in this unit repeats: `public sealed class X : XBase { protected override IArchitectureMap Map { get; } = new AdcArchitectureMap(); }`. Six lines, one property initializer, zero rule logic. The `Map` is a get-only auto-property with an initializer rather than an expression body, so one map instance is built per test class instance and its `Lazy<IReadOnlyList<LayerRef>>` materializes the assembly list once. `[Rubric §8 - Data Architecture]` assesses concurrency control; carrying a row version on the update contract is where that gets enforced at the API boundary.
- **Walkthrough** - one member, the `Map` override (`:5`). The single inherited `[Fact]` delegates to `ArchitectureRules.UpdateRequestsAreConcurrencyAware(Map)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:13`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### ConstructorDependencyCountTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:17` · Level 10 · class

- **What it is** - the single-responsibility ceiling for ADC: no Application-layer `*Service` class may declare a constructor with more than seven dependencies.
- **Depends on** - [ConstructorDependencyCountTestsBase](#constructordependencycounttestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`ConstructorDependencyCountTests.cs:17-19`).
- **Concept introduced: a ceiling is only a ceiling at the high-water mark.** The base makes `MaxConstructorDependencies` abstract precisely so each repo states its own number, and the number is meant to sit at the largest conforming class, not comfortably above it. The doc comment on this class (`:10-15`) is an unusually candid record of getting that wrong and fixing it: the ceiling was 8 while nothing in the mapped Application assemblies exceeded 7, so a service could have grown to 8 without the guard ever objecting, "which is the one thing a ceiling exists to prevent." It was tightened to 7 on 2026-07-28. `[Rubric §1 - SOLID]` assesses single-responsibility discipline; a ballooning constructor list is the canonical smell, and this converts a review judgement into a build failure.
- **Walkthrough** - two overrides. `Map` (`:19`) and `MaxConstructorDependencies => 7` (`:21`). The base scans `Map.ModuleApplication()` for concrete classes whose name ends in `Service`, asserts the scan found at least one (vacuity guard), takes each type's largest constructor parameter count, and reports offenders by full name and count (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:27-53`). The current high-water mark is [AuthenticationService](group-24-identity-module.md#authenticationservice), whose primary constructor takes seven parameters (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:35-42`); the doc comment (`ConstructorDependencyCountTests.cs:6-9`) notes that [IExternalLoginEmailVerifier](group-24-identity-module.md#iexternalloginemailverifier) was a conscious addition for the OAuth auto-link verified-email gate rather than a bundle added to dodge the guard.
- **Why it's built this way** - a cohesive facade legitimately needs several collaborators; an arbitrary low cap would just push developers into hiding dependencies behind a bag object. Pinning the number to the observed maximum means the next increase has to be an explicit edit to this file, which is a decision point rather than an accident.
- **Caveats / not-in-source** - the class doc comment says the high-water mark of 7 is "shared by `AuthenticationService` ... and [CreateSessionHandler](group-18-conference-application.md#createsessionhandler)" (`:6`,`:9`), but the base's scan filters on the `Service` name suffix (`ConstructorDependencyCountTestsBase.cs:29-30`), so a `*Handler` type is not in this rule's scope. A separate, looser arity check with a default cap of 8 runs over Application services through [HandlerConventionTests](#handlerconventiontests) (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:12`,`:24`); ADC does not override that one, so the two gates coexist with this class holding the tighter number.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### ControllerConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:3` · Level 10 · class

- **What it is** - the presentation-layer conventions for ADC's controllers: thin (no Infrastructure or EF Core dependency), sealed, and inheriting the framework's [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) so `Result` values map to HTTP status codes one way everywhere.
- **Depends on** - [ControllerConventionTestsBase](#controllerconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`ControllerConventionTests.cs:3-5`).
- **Concept introduced: the justified exemption list.** Three of the four inherited facts are absolute, but `ControllersExemptFromApiControllerBase` is a deliberate escape hatch, and the discipline is that every entry carries its reason in the same file. ADC lists two (`:11-15`): [OAuthController](group-24-identity-module.md#oauthcontroller), which drives the OAuth2 redirect/challenge/cookie flow and returns framework `Challenge`/`Redirect` results rather than domain `Result`s, and [ServiceInfoController](group-20-conference-api-grpc.md#serviceinfocontroller), an anonymous version-discovery diagnostic. The comment above the list (`:7-10`) is the justification. `[Rubric §9 - API & Contract Design]` assesses consistency of the HTTP surface; the exemptions are readable precisely because the rule forces them to be written down.
- **Walkthrough** - two overrides. `Map` (`:5`) and `ControllersExemptFromApiControllerBase` (`:11-15`), a two-entry collection expression of fully-qualified type names. The base's four `[Fact]`s each delegate to an `ArchitectureRules` method, with the exempt set passed only to the last (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:15-24`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### DataResidencyTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12` · Level 10 · class

- **What it is** - a compliance drift gate: the data-residency statement published in ADC's `PRIVACY.md` must name the region where personal data is actually provisioned, and must not carry a stale claim.
- **Depends on** - [DataResidencyTestsBase](#dataresidencytestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`DataResidencyTests.cs:12-14`), plus BCL `File`/`Path` and AwesomeAssertions used directly inside the override.
- **Concept introduced: pinning a public promise to a deployment fact.** A privacy policy is a legal statement that lives in markdown, which means nothing keeps it aligned with the infrastructure it describes. The base inverts that by making the *deployment* the source of truth and the policy the thing that must agree: it calls the repo's `ExtractDeployedRegion`, then asserts the normalized policy text contains the normalized region and none of the forbidden claims (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:28-45`). Normalization strips whitespace and upper-cases, which is what lets "West US 2" in prose match the `westus2` region token (`:55-58`). `[Rubric §30 - Compliance/Privacy/Data Governance]` assesses whether data-governance claims are true and maintained; this makes an out-of-date policy a red build.
- **Walkthrough** - three overrides.
  - `Map` (`:14`), used only to locate the repo root via `{RepoToken}.slnx`.
  - `ForbiddenResidencyClaims => ["central United States"]` (`:16`) blocks the specific stale statement that once contradicted the deployed region from being re-introduced.
  - `ExtractDeployedRegion(string repoRoot)` (`:20-31`) is the repo-specific half. It reads `.github/workflows/deploy.yml`, finds the literal marker `SQL_LOCATION_OVERRIDE:-`, asserts the marker exists with a clear `because` (`:26-27`), and returns the run of letters and digits that follows. Today that yields `westus2` from `SQL_LOCATION="${SQL_LOCATION_OVERRIDE:-westus2}"` (`MMCA.ADC/.github/workflows/deploy.yml:894`). The published policy states account data lives in an Azure SQL Database in the West US 2 region (`MMCA.ADC/PRIVACY.md:53`,`:61`), which is what makes the assertion pass.
- **Why it's built this way** - the doc comment (`DataResidencyTests.cs:3-11`) explains the region split that makes this non-obvious: the QiMata Sponsorship subscription forces the SQL server into a different region from the Container Apps, so "where the app runs" and "where the PII lives" are genuinely different answers and the policy has to state the latter. Parsing the workflow default rather than a doc keeps the assertion anchored to the value that actually provisions the database.
- **Caveats / not-in-source** - the marker parse reads only the *default* in the `${VAR:-default}` expansion. If the `AZURE_SQL_LOCATION` repository variable is set to a different region at the GitHub level (`MMCA.ADC/.github/workflows/deploy.yml:859`), the deployed region and the parsed region diverge and this gate would not see it. Whether that variable is set is repository configuration and is not determinable from source.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### DomainPurityTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:3` · Level 10 · class

- **What it is** - the framework-independence rules for ADC: Domain and Shared stay free of infrastructure libraries, and Application stays host-agnostic (no EF Core, no ASP.NET Core).
- **Depends on** - [DomainPurityTestsBase](#domainpuritytestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`DomainPurityTests.cs:3-5`).
- **Concept introduced: extending a shared forbidden list with a repo-specific ban.** The base ships a default set of forbidden Domain dependencies and exposes `ExtraForbiddenDomainDependencies` so each repo can name the infrastructure it happens to use. ADC adds `"RabbitMQ"` (`:9`) because it runs on a broker (RabbitMQ locally, Azure Service Bus in production), and a broker client leaking into Domain or Shared would couple the pure layers to a transport. The comment records exactly that (`:7-8`); Store's equivalent bans `"Stripe"`. `[Rubric §3 - Clean Architecture]` assesses dependency direction; `[Rubric §7 - Microservices Readiness]` applies because a Domain that knows about the broker cannot be lifted into a service that uses a different one.
- **Walkthrough** - two overrides, `Map` (`:5`) and `ExtraForbiddenDomainDependencies => ["RabbitMQ"]` (`:9`). The base runs four `[Fact]`s: Domain framework-free, Shared framework-free (both receiving the extra list), Application not depending on EF Core, and Application not depending on ASP.NET Core (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:15-24`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### EntityConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:3` · Level 10 · class

- **What it is** - the DDD entity and aggregate rules for ADC's three module Domain layers: entities are sealed and live only in Domain, aggregate roots are built through a static `Create(...)` factory returning `Result<T>` with no public constructor, every domain and value-object factory returns a `Result`, and DTOs/requests stay out of Domain and Infrastructure.
- **Depends on** - [EntityConventionTestsBase](#entityconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`EntityConventionTests.cs:3-5`).
- **Concept** - the thin-subclass shape introduced at [ConcurrencyConventionTests](#concurrencyconventiontests). `[Rubric §4 - DDD]` assesses aggregate discipline; the factory-returning-[Result](group-01-result-error-handling.md#result) idiom on [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) is what these seven facts verify across [User](group-24-identity-module.md#user), [Event](group-17-conference-domain.md#event), [UserSessionBookmark](group-22-engagement-module.md#usersessionbookmark) and their siblings.
- **Walkthrough** - one member, the `Map` override (`:5`). Seven inherited `[Fact]`s, each a one-line delegate to `ArchitectureRules` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:14-32`). Note this is the module-bearing base; MMCA.Common uses the narrower `AggregateConventionTestsBase` instead, because a module-less repo has no `ModuleDomain()` to scan.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### EventConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/EventConventionTests.cs:3` · Level 10 · class

- **What it is** - the integration-event shape rules: every concrete integration event inherits [BaseIntegrationEvent](group-04-events-outbox.md#baseintegrationevent), declares an `int SchemaVersion`, and lives in a `*.IntegrationEvents` namespace inside the Shared layer.
- **Depends on** - [EventConventionTestsBase](#eventconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`EventConventionTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). `[Rubric §6 - CQRS & Event-Driven]` assesses event-driven discipline; the namespace and inheritance rules are what let the outbox and the broker treat these types uniformly, and the `SchemaVersion` requirement is [ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) made structural. Unlike MMCA.Common's counterpart, this one is *not* vacuous: ADC ships three concrete integration events, frozen by name and shape in [IntegrationEventContractTests](#integrationeventcontracttests).
- **Walkthrough** - one member, the `Map` override (`:5`); three inherited `[Fact]`s delegating to `ArchitectureRules` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:12-19`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### FormsConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:14` · Level 10 · class

- **What it is** - the UX-safety gate for ADC's forms: every admin create form keeps its unsaved-changes guard, dirty tracking, validated `MudForm`, and error summary, and the one form that legitimately falls outside that glob (the Identity Profile page) gets its own hand-written fact instead of an exemption.
- **Depends on** - [FormsConventionTestsBase](#formsconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`FormsConventionTests.cs:14-16`), plus BCL `File`/`Path`/`StringComparison` and AwesomeAssertions inside the added fact.
- **Concept introduced: covering the exception rather than exempting it.** The base scans `Source/Modules` for `*Create.razor` and requires six literal markers in each (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:27-35`,`:43-67`). ADC's Profile form is a single-section password and delete form with no navigate-away step, so it carries no guard by design and does not match the glob. The easy move would be to note that and move on; instead this class adds a second `[Fact]` that asserts the Profile form's *own* safety markers. That is the pattern worth copying: when a convention does not apply, assert the substitute convention rather than leaving a hole. `[Rubric §24 - Forms/Validation/UX Safety]` assesses whether users are protected from losing work and from unclear validation; `[Rubric §19 - State Management]` is implicated by the `IsDirtyAccessor` marker, which exists because binding the guard to the lagging `IsDirty` parameter leaves it one render behind.
- **Walkthrough** - four members.
  - `Map` (`:16`) and `MinimumCreateForms => 6` (`:18`), the non-vacuity floor matching ADC's six Conference create forms (Event, Session, Room, Question, Speaker, ConferenceCategory, per the doc comment `:5-6`).
  - `RequiredMarkers` (`:24-29`) *extends* rather than replaces the base list, using `.. base.RequiredMarkers` in a collection expression and adding two: the per-form `<MudAlert Severity="Severity.Error"` summary and the localized `Validation.CorrectFollowing` heading key.
  - `ProfileForm_KeepsErrorSummaryAndPasswordValidation()` (`:31-62`) is the added fact. It resolves the repo root through `ArchitectureMapBase.FindRepoRoot($"{Map.RepoToken}.slnx")` (`:34`), builds the path to `Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor` (`:35-36`), asserts the file exists at all (`:38-39`, the vacuity guard), then requires four markers: the MudAlert summary, `Errors.Length: > 0` (proving the summary renders from the live `MudForm` error list rather than a static string), and the `ValidateNewPassword` / `ValidateConfirmPassword` wiring for min-length and match validation (`:43-49`). It closes with two counting assertions: at least three `Required="true"` and at least three `RequiredError` occurrences, so all three password fields (current, new, confirm) keep both the requirement and its user-facing message (`:58-61`).
  - `CountOccurrences(string, string)` (`:64-74`) is a private static helper doing a non-overlapping ordinal scan, used only by the two counting assertions.
- **Why it's built this way** - markup conventions cannot be reflected over; a scoped textual scan for load-bearing markers is the honest instrument, and it is why the assertions are phrased as "at least N" rather than exact counts.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### FrameworkVersionConsistencyTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9` · Level 10 · class

- **What it is** - the lockstep-versioning gate: every `MMCA.Common.*` package pinned in ADC's `Directory.Packages.props` must share one version, so a partial sweep fails at CI time instead of producing a mismatched framework surface at run time.
- **Depends on** - [FrameworkVersionConsistencyTestsBase](#frameworkversionconsistencytestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`FrameworkVersionConsistencyTests.cs:9-11`).
- **Concept introduced: a policy turned executable.** [ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html) says the framework packages release together and consumers sweep all of them in one pass, with no phased rollout. That is a process rule, and process rules decay. The base makes it structural: it loads the props file with `XDocument`, selects every `PackageVersion` whose `Include` starts with `MMCA.Common.`, asserts the count clears a floor, asserts none has an empty version, and asserts the distinct version count is exactly one (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:30-56`). `[Rubric §16 - Maintainability]` assesses whether the codebase resists drift; `[Rubric §32 - Dependency & Supply-Chain]` applies to the pin discipline itself.
- **Walkthrough** - one member, the `Map` override (`:11`), used only to find the repo root. ADC does not override `MinimumCommonPackageCount`, so the base default of 13 applies (`FrameworkVersionConsistencyTestsBase.cs:22`); ADC currently pins 15 `MMCA.Common.*` packages, all at the same version (`MMCA.ADC/Directory.Packages.props:123-126` and the entries following).
- **Why it's built this way** - MMCA.Common deliberately does not subclass this base: it declares no `MMCA.Common.*` pins of its own, so the rule would have nothing to parse (`FrameworkVersionConsistencyTestsBase.cs:10-11`). Only consumers run it.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job; in practice it is the guard that catches a half-finished version sweep in a pull request.

### HandlerConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:3` · Level 10 · class

- **What it is** - the CQRS placement rules for ADC: handlers and validators live only in Application, handlers do not inject other handlers, Application services do not inject handlers, domain event handlers are sealed and in Application, and no `*Service` exceeds the shared constructor-arity cap.
- **Depends on** - [HandlerConventionTestsBase](#handlerconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`HandlerConventionTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). `[Rubric §6 - CQRS & Event-Driven]` assesses whether the handler model stays clean; the "no handler brokers another handler" rule is the important one, because handler-calls-handler is how a decorator pipeline quietly gets bypassed (the inner call runs with no logging, caching, validation, or transaction).
- **Walkthrough** - one member, the `Map` override (`:5`). Six inherited `[Fact]`s (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:15-30`). ADC does not override `MaxServiceConstructorParameters`, so the shared default of 8 applies here (`:12`) while [ConstructorDependencyCountTests](#constructordependencycounttests) holds the tighter ADC-specific ceiling of 7.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### HandlerResultConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/HandlerResultConventionTests.cs:8` · Level 10 · class

- **What it is** - a build-time gate on handler return types: every ADC command and query handler's `TResult` must be [Result](group-01-result-error-handling.md#result) or `Result<T>`.
- **Depends on** - [HandlerResultConventionTestsBase](#handlerresultconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`HandlerResultConventionTests.cs:8-10`).
- **Concept introduced: promoting a deferred runtime constraint to a compile-time gate.** [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) deliberately place no generic constraint on `TResult`, which keeps the interfaces general. But the decorator pipeline's short-circuit paths (the feature gate and the validating decorator) have to fabricate a failure value without calling the handler, and they do it through [ResultFailureFactory](group-05-cqrs-pipeline.md#resultfailurefactory), which throws at run time for any non-`Result` `TResult`. So the constraint exists; it is just deferred to the first request that trips a short-circuit. This rule moves it to CI (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:3-9`). `[Rubric §6 - CQRS & Event-Driven]` and `[Rubric §15 - Best Practices & Code Quality]` both apply: a latent runtime crash becomes a red build.
- **Walkthrough** - one member, the `Map` override (`:10`). Three inherited `[Fact]`s: a non-vacuity assertion that the mapped Application assemblies actually declare handlers, then the command and query return-type rules (`HandlerResultConventionTestsBase.cs:21-27`). The doc comment on this class (`HandlerResultConventionTests.cs:3-7`) records it as an opt-in v1.120.0 fitness function.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### ImmutabilityTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:3` · Level 10 · class

- **What it is** - the immutability rules for ADC's contracts: DTOs, command and query messages, domain events, integration events, and value objects expose no public mutable setters, and value objects are additionally sealed and confined to Shared.
- **Depends on** - [ImmutabilityTestsBase](#immutabilitytestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`ImmutabilityTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). `[Rubric §4 - DDD]` and `[Rubric §15 - Best Practices & Code Quality]` apply: `required`/`init` members make a contract un-mutatable after construction, which matters most for messages that cross a process boundary, where a mutated payload mid-pipeline is nearly impossible to diagnose.
- **Walkthrough** - one member, the `Map` override (`:5`); five inherited `[Fact]`s (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:12-25`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### IntegrationEventContractTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:3` · Level 10 · class

- **What it is** - a frozen snapshot of ADC's cross-service asynchronous wire contract. The committed list of integration events and their property shapes must match what the assemblies actually declare, property for property.
- **Depends on** - [IntegrationEventContractTestsBase](#integrationeventcontracttestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`IntegrationEventContractTests.cs:3-5`). The three snapshotted events are [SpeakerLinkedToUser](group-17-conference-domain.md#speakerlinkedtouser), [SpeakerUnlinkedFromUser](group-17-conference-domain.md#speakerunlinkedfromuser), and [UserRegistered](group-24-identity-module.md#userregistered) (`:11-13`).
- **Concept introduced: approval testing for a wire contract.** A consumer in another service deserializes these events by shape, not by reference: rename a property, retype it, or ship a brand-new event without its consumer, and nothing in the compiler notices, because publisher and subscriber are separate processes reading the same broker. The base rebuilds the live contract by reflecting over every concrete class implementing `IIntegrationEvent` across the map's assemblies, ordering both the events and each event's declared public instance properties ordinally, and rendering them as `FullName { Prop:Type, ... }` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Events.cs:45-58`); it then compares that list to the committed one with an ordered `Equal` (`Bases/IntegrationEventContractTestsBase.cs:21-28`). The ordinal ordering is what makes the snapshot stable across compilers and platforms. `[Rubric §9 - API & Contract Design]` assesses contract discipline; `[Rubric §6 - CQRS & Event-Driven]` and `[Rubric §7 - Microservices Readiness]` apply because these three events are the entire asynchronous API between ADC's four services.
- **Walkthrough** - two overrides. `Map` (`:5`) and `ExpectedContract` (`:9-14`), three literal lines pinning the exact namespace, type name, and property set of each event, including CLR type names (`SpeakerId:Guid`, `UserId:Int32`). The comment above the list (`:7-8`) states the update protocol: change it *deliberately*, versioning the event or coordinating the consumer rollout in the same commit.
- **Why it's built this way** - these are the flows the cross-service tier actually exercises: Identity publishes `UserRegistered` and Conference auto-links a speaker by email match, and Conference publishes the speaker link/unlink pair that Identity consumes to set or clear `User.LinkedSpeakerId`. Because delivery runs through the outbox and the broker ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) persistence, [ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html) versioning), an in-flight message can outlive a deploy, so a silent shape change breaks messages already on the wire.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job. It is the fast, no-infrastructure counterpart to the Testcontainers cross-service tier, which exercises the same three events end to end through a real broker.

### LayerDependencyTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3` · Level 10 · class

- **What it is** - the Clean Architecture layer-flow rules for ADC: Domain depends on nothing above it, Application never reaches Infrastructure or API, Infrastructure never reaches API, Shared depends on none of them, and UI never reaches Domain, Application, or Infrastructure.
- **Depends on** - [LayerDependencyTestsBase](#layerdependencytestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`LayerDependencyTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). `[Rubric §3 - Clean Architecture]` is the whole point of this class. Two of the base's fifteen facts are meta-rules rather than dependency rules: `LayerMap_DeclaresEveryExpectedLayer` and `LayerMap_ModulesDeclareEveryExpectedLayer` assert the map itself declares the five core layers and that every module registers them (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:16-30`), so a module accidentally dropped from [AdcArchitectureMap](#adcarchitecturemap) fails loudly instead of quietly removing itself from every other rule.
- **Walkthrough** - one member, the `Map` override (`:5`). ADC does not override `RequiredLayers` or `RequiredModuleLayers`, so all three mapped modules must declare Shared, Domain, Application, Infrastructure, and Api; each declares those five plus Ui. Thirteen dependency `[Fact]`s follow, one per forbidden edge (`LayerDependencyTestsBase.cs:33-69`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job. MMCA.Common enforces the same flow a second time at compile time through its `LayerEnforcement.targets`; ADC gets only the runtime gate, because its projects do not import those targets.

### LocalizedTextConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:14` · Level 10 · class

- **What it is** - the other half of ADC's i18n gate: user-visible literals must not be hard-coded in `.razor` or `.razor.cs` files under `Source/`. Snackbar messages, page `Title` properties, `<PageTitle>` markup, breadcrumb labels, and [NavItem](group-15-common-ui-framework.md#navitem) titles all have to resolve through `IStringLocalizer` resources.
- **Depends on** - [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`LocalizedTextConventionTests.cs:14-16`).
- **Concept introduced: the per-line escape marker.** Some literals are correct: a brand name, a piece of content data. A whole-file exemption would be too blunt, so the rule honors a same-line `i18n: allow` comment and skips that line entirely (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.LocalizedText.cs:82-85`). That keeps the exemption visible at the exact place it applies, which is the same discipline as [ControllerConventionTests](#controllerconventiontests)'s justified exemption list, at line granularity. The regexes are anchored to catch only the literal forms: `Snackbar.Add(` followed immediately by a quote matches, while `Snackbar.Add(L["..."])` or a variable argument does not (`ArchitectureRules.LocalizedText.cs:7-9`). The `NavItem` case carries a nuance worth knowing: a nav row may keep a literal title *if* it also declares a `TitleResource`, because the shared NavMenu then treats the literal as a resource key resolved at render time (`:108-115`). `[Rubric §27 - i18n]` assesses whether the localization posture is enforced rather than swept once and left to rot.
- **Walkthrough** - two overrides. `Map` (`:16`), used to find the repo root, and `MinimumScannedFiles => 60` (`:18`), the non-vacuity floor. The scan enumerates both `*.razor` and `*.razor.cs` under `Source/` (`ArchitectureRules.LocalizedText.cs:52-54`), so the floor of 60 sits below the combined count while still catching a scan root that moved; the doc comment notes ADC has roughly 77 razor files across the three module UIs and the UI hosts (`LocalizedTextConventionTests.cs:11-12`).
- **Why it's built this way** - the doc comment (`:4-5`) points at [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) superseding the single-locale [ADR-011](https://ivanball.github.io/docs/adr/011-single-locale-i18n.html). This gate keeps strings *out* of markup; [TranslationCompletenessTests](#translationcompletenesstests) keeps the extracted resources *translated*. Neither alone is sufficient: externalize without translating and the UI falls back to English; translate without externalizing and new literals leak in behind the gate.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### MicroserviceExtractionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3` · Level 10 · class

- **What it is** - the transport-boundary rule: MassTransit, gRPC, and Protobuf must never appear in Domain, Application, or Shared, so a module behaves identically in-process or extracted and the split stays reversible.
- **Depends on** - [MicroserviceExtractionTestsBase](#microserviceextractiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`MicroserviceExtractionTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). This rule is load-bearing for ADC specifically: its four modules already run as separate service hosts, collaborating over gRPC and a broker, so the invariant "application and domain code talks to abstractions, transport lives at the edges" is what keeps that topology from calcifying. Application code sees [IMessageBus](group-04-events-outbox.md#imessagebus), never a MassTransit type. `[Rubric §7 - Microservices Readiness]` assesses exactly this; [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html), and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) are the decisions it protects.
- **Walkthrough** - one member, the `Map` override (`:5`); one inherited `[Fact]` delegating to `ArchitectureRules.TransportDoesNotLeakIntoCoreLayers(Map)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:13`). It pairs with [DomainPurityTests](#domainpuritytests)'s extra `"RabbitMQ"` ban, which covers the concrete broker client this rule's abstraction-level ban does not name.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### ModuleIsolationTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3` · Level 10 · class

- **What it is** - the modular-monolith boundary rules: no module may reach into another module's Domain, Application, Infrastructure, or API. Cross-module communication goes through the Shared contract layer only.
- **Depends on** - [ModuleIsolationTestsBase](#moduleisolationtestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`ModuleIsolationTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). The mechanism is worth noticing: the base computes each rule's forbidden targets from `IArchitectureMap.OtherModuleNamespaces(module, layer)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:81`), so adding a fourth mapped module to [AdcArchitectureMap](#adcarchitecturemap) automatically extends every isolation rule to it with no edit here. `[Rubric §7 - Microservices Readiness]` and `[Rubric §3 - Clean Architecture]` apply; this is the rule that keeps Conference-to-Engagement traffic on the interface-and-gRPC path described in ADC's `CLAUDE.md` rather than on a direct project reference.
- **Walkthrough** - one member, the `Map` override (`:5`); six inherited `[Fact]`s covering the four same-layer isolation checks plus two cross-layer ones (a module's Domain or Application reaching another module's Infrastructure) (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:12-28`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### NamingConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:3` · Level 10 · class

- **What it is** - the suffix and sealing conventions across ADC's CQRS and DDD building blocks: handlers, command and query messages, validators, DTOs, domain events, invariant classes, EF configurations, specifications, and repositories each keep their established name shape.
- **Depends on** - [NamingConventionTestsBase](#namingconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`NamingConventionTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). Naming looks cosmetic until you notice how much of this codebase keys off it: the DI scan registers handlers and validators by suffix, and several other rules in this unit select their subjects by name (`*Service`, `*UpdateRequest`, `*Create.razor`). A misnamed type is not just untidy, it is invisible to the machinery. `[Rubric §15 - Best Practices & Code Quality]` and `[Rubric §16 - Maintainability]` apply.
- **Walkthrough** - one member, the `Map` override (`:5`); ten inherited `[Fact]`s, each delegating to an `ArchitectureRules` method (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:12-40`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### PiiConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3` · Level 10 · class

- **What it is** - the right-to-erasure structural gate: any domain entity declaring a [PiiAttribute](group-02-domain-building-blocks.md#piiattribute)-marked property must implement [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable), so it has an erasure path.
- **Depends on** - [PiiConventionTestsBase](#piiconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`PiiConventionTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). Unlike MMCA.Common's counterpart, which is structurally vacuous because the framework ships no PII-bearing entity of its own, ADC's version has real subjects: [User](group-24-identity-module.md#user) and its siblings carry personal data. `[Rubric §30 - Compliance/Privacy/Data Governance]` assesses whether erasure is a designed capability rather than an ad-hoc script; [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) separates soft-delete (reversible, the default) from erasure (irreversible, subject-requested), and this rule ensures the second path exists wherever it is legally required.
- **Walkthrough** - one member, the `Map` override (`:5`); one inherited `[Fact]` delegating to `ArchitectureRules.EntitiesWithPiiImplementAnonymizable(Map)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:12`).
- **Caveats / not-in-source** - this is a structural check only: it asserts the erasure method *exists*, not that it erases correctly. The behavioral proof lives in MMCA.Common's [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests), which pushes a representative subject through redaction and anonymization.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### RawQueryableConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/RawQueryableConventionTests.cs:11` · Level 10 · class

- **What it is** - the extraction-readiness gate on query style: Application-layer code must not use the repository's raw `IQueryable` surfaces (`Table`, `TableNoTracking`, `TableNoTrackingSingleQuery`, `TableNoTrackingSplitQuery` on [IReadRepository<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype)). ADC carries an explicit allowlist of eight existing files.
- **Depends on** - [RawQueryableConventionTestsBase](#rawqueryableconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`RawQueryableConventionTests.cs:11-13`), plus `ArchitectureMapBase.FindRepoRoot` and BCL `Path` used directly in the directory override.
- **Concept introduced: the ratchet allowlist.** Adopting a rule in a codebase that already violates it has two bad options: fix everything first (blocks the rule indefinitely) or weaken the rule (makes it useless). The ratchet is the third: turn the rule on at full strength, record today's violations by file name, and let the list only shrink. New code is blocked from day one; existing code is scheduled rather than ignored. The doc comment states the policy in one line: "Shrink it over time; never grow it without the same scrutiny" (`RawQueryableConventionTests.cs:9`). `[Rubric §7 - Microservices Readiness]` is the reason the rule exists: a handler written against a raw `IQueryable` is EF-coupled, and its query shape cannot cross a gRPC boundary, so the module quietly loses its extraction path. `[Rubric §8 - Data Architecture]` applies to the query-style question itself.
- **Walkthrough** - three overrides.
  - `Map` (`:13`).
  - `ApplicationSourceDirectories()` (`:21-30`) is an iterator that yields everything the base found (one directory per mapped module's Application project) and then appends `Source/Modules/Notification/MMCA.ADC.Notification.Application`. The `<remarks>` (`:16-20`) explains why: the thin Notification module is not in [AdcArchitectureMap](#adcarchitecturemap), so without this the rule would silently skip it. This is the clearest example in the unit of a map gap being patched at the rule level rather than by distorting the map.
  - `AllowedFiles` (`:33-52`) is the ratchet, eight entries in four commented groups: the Engagement live layer's conference-day hot-path aggregations ([LivePollResultsBuilder](group-23-engagement-live-layer.md#livepollresultsbuilder), [SessionQuestionViewBuilder](group-23-engagement-live-layer.md#sessionquestionviewbuilder), [GetModerationQueueHandler](group-23-engagement-live-layer.md#getmoderationqueuehandler), [GetSessionQuestionsHandler](group-23-engagement-live-layer.md#getsessionquestionshandler)), which need GROUP BY and COUNT shapes the focused repository surface cannot express; the Engagement bookmarks pair ([BookmarkCountService](group-22-engagement-module.md#bookmarkcountservice), [GetUserBookmarksHandler](group-22-engagement-module.md#getuserbookmarkshandler)); Identity's server-side user-list projection ([GetUsersHandler](group-24-identity-module.md#getusershandler)); and Notification's GDPR export joins ([UserNotificationExportService](group-10-notifications.md#usernotificationexportservice)). Each group's comment records that the queries stay inside one database, which is what makes the exemption defensible.
  - The base does the scanning: a line-oriented regex over `.cs` files, skipping `bin`/`obj` and allowlisted file names, reporting `file:line: text` for each hit (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RawQueryableConventionTestsBase.cs:68-104`).
- **Caveats / not-in-source** - the base is candid about its own limits (`RawQueryableConventionTestsBase.cs:13-23`): NetArchTest and plain reflection cannot see member *usage* inside method bodies, and the package deliberately carries no IL or Roslyn dependency, so this is a textual scan. It cannot follow variable indirection through an interface alias, and it skips only whole-line `//` comments, so a match inside a string literal or a trailing comment is a possible false positive. Those are recorded in `AllowedFiles` with a justification, same as a real violation.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### SharedLayerTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:3` · Level 10 · class

- **What it is** - the contracts-only rules for each module's Shared layer: it must not depend on its own module's internal layers, on another module's Shared, or on EF Core.
- **Depends on** - [SharedLayerTestsBase](#sharedlayertestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`SharedLayerTests.cs:3-5`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests). Shared is the only layer other modules and other *services* are allowed to reference, which is why it has its own rule set rather than being covered by the general layer flow: a Shared project that quietly pulls in its own Domain drags the whole module across every boundary that consumes the contract. `[Rubric §3 - Clean Architecture]` and `[Rubric §9 - API & Contract Design]` apply.
- **Walkthrough** - one member, the `Map` override (`:5`); three inherited `[Fact]`s (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:11-18`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### SliceCohesionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:8` · Level 10 · class

- **What it is** - the vertical-slice rules: every `Application/{Aggregate}/UseCases/{Operation}/` slice keeps its command or query, its handler, and its validator in one namespace, so a feature is a cohesive unit rather than three files in three horizontal folders.
- **Depends on** - [SliceCohesionTestsBase](#slicecohesiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`SliceCohesionTests.cs:8-10`).
- **Concept** - the thin-subclass shape from [ConcurrencyConventionTests](#concurrencyconventiontests), with the added observation that co-location is not aesthetic: a slice whose handler drifts into a shared `Handlers/` folder is a slice that cannot be moved, deleted, or extracted as a unit. `[Rubric §5 - Vertical Slice]` assesses exactly this; the class doc comment states the failure it prevents, "a handler stranded from its contract" (`:6`).
- **Walkthrough** - one member, the `Map` override (`:10`); two inherited `[Fact]`s, one for handlers and one for validators (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:14-20`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### SpecificationConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8` · Level 10 · class

- **What it is** - the polyglot-safety rule for specifications: no [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) may filter by navigating to another entity, because such a predicate cannot translate if that entity ever moves to a different data source.
- **Depends on** - [SpecificationConventionTestsBase](#specificationconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`SpecificationConventionTests.cs:8-10`).
- **Concept introduced: keeping a guard on after the trial that motivated it was reverted.** The comment on this class (`:3-7`) is the interesting part: ADC opts into this rule *even though every entity currently routes to SQL Server*. The Conference Session-to-Cosmos and Room-to-SQLite polyglot trial was reverted, but the framework extension points were kept ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), so the guard stays on as a forward safeguard. That is a deliberate choice with a cost (a rule that constrains code for a capability nobody uses today) and a payoff (the constraint stays cheap because it is never violated, whereas retrofitting it later would mean rewriting live specifications). The prescribed alternative when a cross-entity filter is genuinely needed is [CrossSourceSpecification](group-03-querying-specifications.md#crosssourcespecification). `[Rubric §8 - Data Architecture]` and `[Rubric §7 - Microservices Readiness]` apply, and [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) is the standing reason a navigation might stop translating.
- **Walkthrough** - one member, the `Map` override (`:10`); one inherited `[Fact]` delegating to `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities(Map)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:16-17`). The rule's own discriminating proof (it must flag a navigating specification and leave a scalar-only one alone) lives in MMCA.Common's [SpecificationFitnessTests](#specificationfitnesstests).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### StateManagementConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:9` · Level 10 · class

- **What it is** - the per-circuit state rules for ADC's UI: the three module UI assemblies carry no mutable static state, and no production UI project registers a `*StateService` or `*StateContainer` as a singleton.
- **Depends on** - [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`StateManagementConventionTests.cs:9-11`).
- **Concept introduced: why a static field is a security bug in Blazor Server.** One server process serves every user, each in their own circuit, so a mutable static member is shared across all of them: one user's selection, filter, or identity leaks into another's session. The class doc comment says it plainly, "a static member is shared across every Blazor Server circuit" (`:6-7`). The base attacks it from two directions: reflection over the map's `Layer.Ui` assemblies flags any non-`readonly`, non-`const` static field or any settable static property, skipping compiler-generated members (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:28-63`), and a source scan over `Source/` flags any line that registers a stateful service as a singleton (`:66-97`). `[Rubric §19 - State Management]` assesses ownership and propagation of client state; `[Rubric §11 - Security]` and `[Rubric §26 - Front-End Security]` apply because the failure mode is cross-user leakage, not a rendering bug.
- **Walkthrough** - one member, the `Map` override (`:11`). ADC overrides nothing else: it declares no `AllowedStaticMembers`, so its UI assemblies are held to the rule with no exceptions (MMCA.Common, by contrast, whitelists one write-once wiring point). The first fact also asserts the map registers at least one `Layer.Ui` assembly (`:32-33`), which is why the six `Ui` entries in [AdcArchitectureMap](#adcarchitecturemap) are load-bearing rather than decorative.
- **Where it's used** - runs in the architecture suite in the `build-and-test` job.

### UIArchitectureConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:10` · Level 10 · class

- **What it is** - two mechanical caps that hold the container/presentational split in ADC's UI: every `*.razor.cs` code-behind under `Source/` stays within 400 lines, and every `.razor` file's inline `@code` block stays within 120 lines.
- **Depends on** - [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap) (`UIArchitectureConventionTests.cs:10-12`).
- **Concept introduced: proxying a qualitative convention with a countable one.** "Keep pages presentational and push logic into services" is a code-review sentence, not an assertion. Line count is a crude proxy, and the base says so by naming the caps a *convention* rather than a limit; 400 was chosen to sit above every conforming page in the family repos while still failing the known oversized dashboards (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:18-22`). The value of a crude proxy is that it cannot be argued with in review. `[Rubric §18 - UI Architecture]` assesses front-end composition, and the class doc comment records the payoff: the gate "subsumes TD-13", the oversized Conference dashboards having been split to conform when it landed (`UIArchitectureConventionTests.cs:7-8`).
- **Walkthrough** - one member, the `Map` override (`:12`), used to find the repo root. ADC accepts every default: `MaxCodeBehindLines => 400`, `MaxInlineCodeLines => 120`, `MinimumCodeBehindFiles => 1`, and an empty `ExcludedPathFragments`. The inline-block measure is deliberately approximate, counting from the first line starting with `@code` to end of file, on the convention that the block is the file's tail (`UIArchitectureConventionTestsBase.cs:24-29`,`:71-77`).
- **Where it's used** - runs in the architecture suite in the `build-and-test` job. It is the structural companion to the bUnit component tests and the Playwright accessibility scans: this one governs how the UI is *organized*, those govern how it *behaves*.

### NavigationContractTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/NavigationContractTests.cs:17` · Level 1 · class
- **What it is** - a documentation-drift gate for navigation (rubric §25): it asserts that the "Routes shipped by the framework" table in `NavigationFlow.md` stays in lockstep with the routable pages the `MMCA.Common.UI` assembly actually ships, and that each route's documented auth posture matches the `[Authorize]` reality on the page.
- **Depends on** - [UISharedAssemblyReference](group-15-common-ui-framework.md#uisharedassemblyreference) (the reflection anchor for the shared UI assembly, `NavigationContractTests.cs:82`), plus externals: ASP.NET Core `RouteAttribute` and `AuthorizeAttribute` (the route/guard metadata reflected over, `:84`,`:90`), a source-generated `Regex` via `[GeneratedRegex]` (`:116`), the embedded `NavigationFlow.md` manifest resource (`:102`; wired by the csproj at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MMCA.Common.Architecture.Tests.csproj:11`-`:13`), xUnit `[Fact]`, and AwesomeAssertions.
- **Concept introduced** - *documentation as an executable contract.* This is the first place a test asserts a hand-authored markdown doc against live code reality rather than the reverse. `NavigationFlow.md` lives next to the framework code (it is an embedded resource of this test project, per `MMCA.Common/CLAUDE.md`) precisely so this gate can parse it; a page added, removed, or re-routed without the doc moving in the same change fails the build, and so does an auth-posture lie in either direction. [Rubric §25 - Navigation & IA] assesses whether routing and information architecture are deliberate and documented; this test turns the route table into a build-enforced invariant instead of review discipline. [Rubric §11 - Security] / [Rubric §26 - Front-End Security] also apply: a route the doc calls Authenticated must carry `[Authorize]`, and a route it calls Anonymous must not, so a mis-documented guard cannot pass silently. [Rubric §34 - Architecture Governance & Documentation] is the umbrella: the documentation is proven current by CI.
- **Walkthrough** - two constants pin the contract: `MinimumRoutes = 8` (`:19`) and `DocResource = "NavigationFlow.md"` (`:20`). Three `[Fact]`s enforce it. `RoutablePages_AreDiscovered_GateIsNotVacuous` (`:22`-`:26`) asserts reflection finds at least eight routed pages, so a broken anchor cannot let the whole gate pass having scanned nothing. `EveryRoutablePage_IsDocumented_AndEveryDocumentedRoute_Exists` (`:28`-`:41`) computes the set difference both ways: `undocumented` routes (real but missing from the doc, `:34`) and `phantom` routes (documented but no longer real, `:35`) must both be empty. `EveryDocumentedAuthPosture_MatchesTheRouteAttributeReality` (`:43`-`:77`) walks each documented route, skips ones the set-equality fact already reports as phantoms (`:52`-`:55`), classifies the auth cell as `Authenticated...`, `Anonymous`, or `Any` (`:57`-`:59`), and flags three violation kinds: an unrecognized posture string (`:61`-`:64`), a doc that promises authentication where the page carries no `[Authorize]` (`:65`-`:68`), and a doc that promises an open route where the page is actually guarded (`:69`-`:72`). Two private helpers supply the two sides: `DiscoverRoutedPages` (`:79`-`:98`) reflects over the shared-UI assembly, collecting each `RouteAttribute.Template` and whether the type carries `[Authorize]` (inherited attributes included, `:90`); `DiscoverDocumentedRoutes` (`:100`-`:114`) reads the embedded doc, throwing a clear `InvalidOperationException` when the resource is missing (`:102`-`:103`), and extracts route rows via the source-generated `RouteRowRegex` (`:116`-`:117`, a 2000ms-timeout `[GeneratedRegex]` partial property).
- **Why it's built this way** - `NavigationFlow.md` is deliberately kept in MMCA.Common next to the routed pages (not in the Website docs library) so this gate can embed and parse it; making route and auth-posture documentation a compiled assertion is what keeps a public navigation contract from rotting. [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) establishes the fitness-function approach this class applies to documentation.
- **Where it's used** - an independent class in the `MMCA.Common.Architecture.Tests` suite; it runs in CI's `build-and-test` job (fast, no database) and has no Store/ADC counterpart because it guards the framework's own shared-UI route table.

### ObservabilityConventionTestsBaseTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ObservabilityConventionTestsBaseTests.cs:14` · Level 1 · class
- **What it is** - a cross-assembly regression guard for the shared SLO alert-to-runbook pairing rule. It subclasses [ObservabilityConventionTestsBase](#observabilityconventiontestsbase) from an assembly other than the one the base ships in, re-points it at a fixture IaC pair embedded in this test project, and asserts the base resolves its manifest resources from the *derived* type's assembly.
- **Depends on** - [ObservabilityConventionTestsBase](#observabilityconventiontestsbase) (`public sealed class ObservabilityConventionTestsBaseTests : ObservabilityConventionTestsBase`, `ObservabilityConventionTestsBaseTests.cs:14`) and the two fixture resources embedded by the csproj under the logical names `fixtures.observability-main.bicep` and `fixtures.observability-OPERATIONS.md` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MMCA.Common.Architecture.Tests.csproj:17`-`:22`). Externals: `System.Reflection.Assembly`, xUnit `[Fact]`, AwesomeAssertions.
- **Concept introduced** - *proving a shipped base class's defaults from outside its own assembly.* The rule library ships as the `MMCA.Common.Testing.Architecture` package ([ArchitectureRules](#architecturerules) plus its `*TestsBase` family), so a base can carry a default that is only ever wrong for a *consumer*: `ResourceAssembly => GetType().Assembly` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:51`) must bind to the subclass's assembly, because the base's own assembly never contains a consumer's bicep. Testing that default inside the base's own assembly would prove nothing (both assemblies would be the same one), so the guard is deliberately located here, one assembly away. [Rubric §13 - Observability & Operability] assesses whether alerts stay operable, and the rule this class exercises is the one that keeps every provisioned SLO alert paired with a severity-correct runbook section. [Rubric §14 - Testability] applies because this is a meta-test that keeps a shared gate honest, and [Rubric §33 - Developer Experience] because the alternative failure mode is a break that surfaces only in the first downstream repo to adopt the base.
- **Walkthrough** - two property overrides re-point the base's resource names at the fixtures: `BicepResource => "fixtures.observability-main.bicep"` (`:16`) and `RunbookResource => "fixtures.observability-OPERATIONS.md"` (`:18`), replacing the base defaults `infra.main.bicep` / `infra.OPERATIONS.md` (`ObservabilityConventionTestsBase.cs:42`,`:45`). One own `[Fact]`, `ResourceAssembly_DefaultsToTheDerivedTypesAssembly` (`:24`-`:29`), asserts the resolved `ResourceAssembly` is the same object as this class's assembly and is *not* the base's assembly. Inheritance supplies the rest: the three base `[Fact]`s (`ObservabilityConventionTestsBase.cs:53`-`:103`) run against the fixture pair, so the whole discovery-and-pairing path is exercised across the assembly boundary. The fixture bicep declares exactly three well-formed specs plus the two parse anchors the base looks for, `var sloAlertSpecs` and `resource sloAlerts` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Fixtures/observability-main.bicep:6`-`:25`), which meets the base's default `MinimumAlertSpecs => 3` (`ObservabilityConventionTestsBase.cs:39`); the fixture runbook carries a matching `### fixture-alert-<key> (sev N)` heading per spec (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Fixtures/observability-OPERATIONS.md:9`-`:19`), so both pairing directions and the severity check pass.
- **Why it's built this way** - the class doc records the exact regression it exists for (`:5`-`:13`): resolving against the base's own assembly instead of the subclass's is a silent break, since the framework's CI would stay green and only the first adopting consumer would fail. Keeping the guard in a different assembly is the only way to make that difference observable. It is the packaging discipline [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html) describes for shipped conformance suites, applied to a fitness base; the rule it guards implements the alerting side of [ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html).
- **Where it's used** - an independent class in the Common architecture suite. The real adopters are [ObservabilityConventionTests](#observabilityconventiontests) in MMCA.ADC and MMCA.Store (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7`, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ObservabilityConventionTests.cs:7`), which subclass the same base with no overrides at all and rely entirely on the default this class pins.
- **Caveats / not-in-source** - the fixture bicep is deliberately minimal (its own header comment says so, `observability-main.bicep:1`-`:4`): it proves the base's parse-and-pair logic, not that any real consumer template is well formed. The consumers' own subclasses do that against their real `infra/` files.

### FitnessPrincipal
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:43` · Level 4 · class
- **What it is** - a throwaway "principal" entity used only as test data for the specification-navigation fitness function. It is the entity that a dependent record points at, so a specification can be written that tries to reach across the navigation into it.
- **Depends on** - [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (it is a `public sealed class FitnessPrincipal : AuditableBaseEntity<int>`, `SpecificationFitnessTests.cs:43`).
- **Concept introduced** - *test fixture entities for a fitness function.* A fitness function is an executable architecture rule (see [ArchitectureRules](#architecturerules)); to prove such a rule actually fires you feed it a deliberately-crafted model rather than the real domain. `FitnessPrincipal` is one half of that crafted model: a bare aggregate-shaped type carrying a single scalar (`IsActive`, `SpecificationFitnessTests.cs:45`) so a specification can navigate to it. [Rubric §14 - Testability] assesses whether rules are provable with focused inputs; this fixture exists precisely so the guard is tested against a known-unsafe shape instead of hoping a real specification trips it.
- **Walkthrough** - one auto-property, `bool IsActive` (`SpecificationFitnessTests.cs:45`). That is the only member; identity and audit fields come from the base. It is the navigation target referenced by [FitnessDependent](#fitnessdependent).Principal. Deriving from `AuditableBaseEntity<int>` is load-bearing rather than cosmetic: the rule's navigation walker only counts a property as an entity navigation when its type (or its collection element type) inherits the auditable entity base (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:121`-`:139`).
- **Why it's built this way** - the fitness test must be *non-vacuous*: it needs a real cross-entity navigation to flag. A minimal principal with a single scalar is the smallest thing a specification can legally navigate into.
- **Where it's used** - referenced by [FitnessDependent](#fitnessdependent) and, through it, by [NavigatingSpec](#navigatingspec); the whole fixture set drives [SpecificationFitnessTests](#specificationfitnesstests).

### DataSubjectSample
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:79` · Level 5 · class
- **What it is** - a representative "data subject" fixture: a single object that carries `[Pii]` members alongside non-PII fields and implements an in-place erasure path, so the framework's privacy machinery can be exercised end to end against a realistic shape.
- **Depends on** - [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) (it is `private sealed class DataSubjectSample : IAnonymizable`, `PiiErasureContractFitnessTests.cs:79`), [PiiAttribute](group-02-domain-building-blocks.md#piiattribute) (marks `Email`/`FullName`, `PiiErasureContractFitnessTests.cs:91`,`:94`), and [Result](group-01-result-error-handling.md#result) (returned from `Anonymize`, `PiiErasureContractFitnessTests.cs:99`).
- **Concept introduced** - *closing a vacuous fitness function with a stand-in data subject.* The framework's `[Pii] => IAnonymizable` scan ([PiiConventionTests](#piiconventiontests)) has nothing to assert because MMCA.Common ships no PII-bearing domain entity of its own. Rather than invent a fake aggregate in the Domain layer, this fixture models the exact contract a consumer PII aggregate (for example MMCA.ADC's `User`) must satisfy, and lets [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests) prove the three §30 mechanisms compose. [Rubric §30 - Compliance/Privacy/Data Governance] assesses whether erasure, redaction, and masking actually work together; this sample is the vehicle that keeps the framework's proof of that non-vacuous.
- **Walkthrough** - public constants publish the expected before/after values so the tests can assert without magic literals: `SampleId = 7`, `PublicCity = "Atlanta"`, `OriginalEmail`, `OriginalFullName` (`PiiErasureContractFitnessTests.cs:81`-`:84`), plus private anonymized placeholders (`:86`-`:87`). `Id` (`:89`) and `City` (`:97`) are non-PII `init` pass-through fields; `Email` and `FullName` are `[Pii]` with private setters (`:91`-`:95`), which is what lets `Anonymize` rewrite them in place while no caller outside the type can. `Anonymize()` (`:99`-`:105`) overwrites both PII fields with the fixed placeholders and returns `Result.Success()`; because it re-applies constants, calling it twice is idempotent by construction (`:101`).
- **Why it's built this way** - [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) (soft-delete versus erasure) requires that a right-to-erasure path be idempotent and leave no clear-text behind. The fixture encodes that contract in the smallest object that can be pushed through `PiiRedactor` and `Anonymize` together.
- **Where it's used** - the sole fixture for [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests).

### DependencyVersionTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9` · Level 5 · class
- **What it is** - the MMCA.Common binding of the shared dependency-pin rule: a one-line sealed subclass that turns on the checks enforcing this repo's two commercial-license package ceilings, MassTransit below major 9 and SixLabors.ImageSharp below major 4.
- **Depends on** - [DependencyVersionTestsBase](#dependencyversiontestsbase) (`public sealed class DependencyVersionTests : DependencyVersionTestsBase;`, `DependencyVersionTests.cs:9`), which in turn calls `ArchitectureRules.PinnedPackageMajorBelow` against this repo's `Directory.Packages.props`.
- **Concept introduced** - *the thin-subclass fitness pattern.* Almost every rule in this project lives once in the reusable `MMCA.Common.Testing.Architecture` package as an abstract `*TestsBase`, and each repo activates it with a near-empty subclass. This is the first of many such subclasses; the body-less form here is the extreme case (no configuration at all: the declaration ends at its semicolon, `DependencyVersionTests.cs:9`). [Rubric §32 - Dependency & Supply-Chain] assesses guarding against risky dependency drift; the base parses the pinned versions and fails the build before either ceiling is crossed, so a "just bump the version" edit cannot slip through.
- **Walkthrough** - no members; the entire behavior is inherited. The base contributes two `[Fact]`s. `MassTransit_MustNotExceed_MajorVersion8` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:24`-`:37`) walks the three MassTransit package ids `MassTransit`, `MassTransit.RabbitMQ`, and `MassTransit.Azure.ServiceBus.Core` (`:17`-`:22`) with an `exclusiveMajorCeiling` of 9, because v9 requires a commercial license (`MT_LICENSE`) and every broker-enabled host fails its startup license check without one, while CI never starts a broker so the build would otherwise stay green (`:32`-`:35`). `ImageSharp_MustNotExceed_MajorVersion3` (`:47`-`:60`) does the same for `SixLabors.ImageSharp` (`:45`) with a ceiling of 4, because ImageSharp v4's MSBuild targets fail at *build* time without a `$(SixLaborsLicenseKey)` (`:55`-`:58`). Both id lists are `protected virtual`, so a repo that pins neither package can override them to an empty list and make the rule vacuous.
- **Why it's built this way** - the pins are real only in MMCA.Common (where these packages are actually declared); ADC and Store inherit MassTransit transitively through `MMCA.Common.Infrastructure` and deliberately do not subclass the base, because the default list would assert a `Directory.Packages.props` entry they do not declare (`DependencyVersionTestsBase.cs:8`-`:13`). See [ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html), which records the lockstep-versioning policy and the license-ceiling pattern these two facts implement.
- **Where it's used** - run by the `MMCA.Common.Architecture.Tests` suite in CI's `build-and-test` job.

### FitnessDependent
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:34` · Level 5 · class
- **What it is** - the other half of the specification-navigation fixture: an entity that holds a foreign-key scalar and a navigation to a [FitnessPrincipal](#fitnessprincipal), so both a safe (scalar-only) and an unsafe (navigating) specification can be written over it.
- **Depends on** - [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`public sealed class FitnessDependent : AuditableBaseEntity<int>`, `SpecificationFitnessTests.cs:34`) and [FitnessPrincipal](#fitnessprincipal) (the `Principal?` navigation, `:38`).
- **Concept introduced** - cross-references the fixture concept introduced by [FitnessPrincipal](#fitnessprincipal). This type adds the parts a specification can filter on: `PrincipalId` (scalar FK, `:36`), a nullable `Principal` navigation (`:38`), and a `Flag` scalar (`:40`). The scalar-versus-navigation split is the whole point: it lets one fixture support both the pattern the rule must flag and the pattern it must leave alone.
- **Walkthrough** - three auto-properties: `int PrincipalId` (`:36`), `FitnessPrincipal? Principal` (`:38`), `bool Flag` (`:40`). [ScalarOnlySpec](#scalaronlyspec) filters on `PrincipalId`/`Flag`; [NavigatingSpec](#navigatingspec) reaches through `Principal`.
- **Where it's used** - the entity type parameter for both [NavigatingSpec](#navigatingspec) and [ScalarOnlySpec](#scalaronlyspec) in [SpecificationFitnessTests](#specificationfitnesstests).

### LocalizationResourceTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizationResourceTests.cs:12` · Level 5 · class
- **What it is** - the MMCA.Common binding of the resource-completeness rule: it asserts the framework's own `.resx` files fully translate every supported non-default culture, deriving the required-culture set from the live allowlist rather than restating it.
- **Depends on** - [LocalizationResourceTestsBase](#localizationresourcetestsbase) (base rule, `LocalizationResourceTests.cs:12`) and [SupportedCultures](group-12-api-hosting-mapping.md#supportedcultures) (source of the required cultures, `:15`).
- **Concept introduced** - *deriving a gate's expectations from the same allowlist production uses.* Instead of hardcoding "translate Spanish," the override computes `RequiredCultures` as `SupportedCultures.All` minus `SupportedCultures.Default` (`:14`-`:17`), so adding a locale to the app automatically extends the coverage requirement. [Rubric §27 - i18n] assesses whether localization is complete and enforced; this gate makes a missing translation a build failure and self-updates when the supported set grows.
- **Walkthrough** - two overrides. `RequiredCultures` (`:14`-`:17`) filters `SupportedCultures.All` to the non-default entries; the allowlist is `["en-US", "es"]` with `Default = "en-US"` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:12`,`:18`), so the required set is today exactly `es`. `MinimumBaseResources => 3` (`:21`) sets a non-vacuous floor: the scan must find at least three base resources (ErrorResources for the API, plus SharedResource and MudTranslations for the UI), so a wrong scan root or repo re-layout cannot let the gate pass having checked nothing. The base's default for that floor is zero, which skips the guard entirely (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:21`), so overriding it here is what makes the gate honest.
- **Why it's built this way** - [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (localization) requires supported cultures to be fully translated; the derived allowlist plus the minimum-count floor turn that into a self-maintaining CI gate. The pseudo-locale `qps-Ploc` is deliberately kept out of `SupportedCultures.All` (`SupportedCultures.cs:28`) precisely so this gate does not demand a `.qps-Ploc.resx` sibling.
- **Where it's used** - run by the `MMCA.Common.Architecture.Tests` suite.

### NavigatingSpec
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:49` · Level 6 · class
- **What it is** - the deliberately-unsafe fixture specification: its `Criteria` navigates from the dependent into a related entity, the exact pattern the fitness function must flag.
- **Depends on** - [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (`private sealed class NavigatingSpec : Specification<FitnessDependent, int>`, `SpecificationFitnessTests.cs:49`) and [FitnessDependent](#fitnessdependent)/[FitnessPrincipal](#fitnessprincipal) (the entities it filters over).
- **Concept introduced** - *why cross-entity navigation in a specification is unsafe across data sources.* Under database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), a `d => d.Principal!.IsActive` predicate (`:51`) assumes the related entity lives in the same queryable model; once the principal is extracted to another physical source, that navigation cannot translate to SQL (and on Cosmos the cross-source navigation is degraded out of the model entirely, `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:9`-`:15`). The fitness function `SpecificationsDoNotNavigateToOtherEntities` treats it as a violation. [Rubric §7 - Microservices Readiness] assesses whether the code stays extractable; this fixture is the negative example that proves the readiness guard fires.
- **Walkthrough** - one member, an overridden `Criteria` expression that dereferences the `Principal` navigation (`:51`). Being parameterless matters: the rule only instantiates and inspects specifications that expose a parameterless constructor (`ArchitectureRules.Specifications.cs:38`-`:41`), so a fixture with constructor dependencies would be skipped and prove nothing. The test asserts the rule's exception message contains this type's name.
- **Where it's used** - the "should be flagged" input to [SpecificationFitnessTests](#specificationfitnesstests); paired with [ScalarOnlySpec](#scalaronlyspec).

### PiiErasureContractFitnessTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19` · Level 6 · class
- **What it is** - a non-vacuous §30 fitness test that pushes a representative `[Pii]` data subject through the framework's own privacy machinery, proving that PII detection, redaction/masking, and in-place erasure compose end to end rather than each being verified in isolation.
- **Depends on** - [DataSubjectSample](#datasubjectsample) (the fixture), [PiiRedactor](group-02-domain-building-blocks.md#piiredactor), [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable), and [Result](group-01-result-error-handling.md#result). Externals: xUnit `[Fact]`, AwesomeAssertions.
- **Concept introduced** - *a contract-composition fitness function.* Where [PiiConventionTests](#piiconventiontests) is a structural scan (does every `[Pii]` type also implement `IAnonymizable`), this test exercises the *behavior* the scan presumes. It is the pattern for proving a cross-cutting compliance contract actually holds when its parts run together. [Rubric §30 - Compliance/Privacy/Data Governance] assesses that erasure and log-masking genuinely protect subject data; this test is the framework's executable evidence.
- **Walkthrough** - four `[Fact]`s, each isolating one link in the contract. `DataSubject_DeclaresPii_SoTheContractIsNotVacuous` (`:21`-`:24`) asserts `PiiRedactor.HasPii` recognizes the sample, so the later guards assert against something real. `PiiRedactor_MasksEveryPiiMember_AndPassesThroughNonPii` (`:26`-`:35`) redacts an instance and checks `Email`/`FullName` become `PiiRedactor.RedactedToken` while `Id`/`City` pass through unchanged (`:31`-`:34`). `PiiRedactor_LeaksNoClearTextPii_ToLogsOrTelemetry` (`:37`-`:50`) verifies neither the redacted dictionary values (`:42`-`:44`) nor `RedactToString` output (`:46`-`:49`) contain the original email or name, covering both the structured-log and the flat-string rendering paths. `DataSubject_ImplementsErasureSeam_AndAnonymizeErasesPii_Idempotently` (`:52`-`:72`) asserts the sample is `IAnonymizable` (`:56`), that `Anonymize()` succeeds and changes the PII fields (`:59`-`:62`), that a second call also succeeds and leaves the fields erased (idempotence, `:64`-`:66`, [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)), and finally that an anonymized subject *still* leaks no original clear text when redacted (`:69`-`:71`), proving erasure and redaction compose.
- **Why it's built this way** - the plain `[Pii] => IAnonymizable` scan is vacuous in the framework (no PII entity in Common's Domain); this test closes that gap by forcing the machinery through a stand-in subject, so the §30 guarantee is proven, not merely assumed. Consumers (MMCA.ADC's `User`) run the same contract against their real aggregates.
- **Where it's used** - an independent test class in the Common architecture suite.

### ScalarOnlySpec
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:55` · Level 6 · class
- **What it is** - the deliberately-safe counterpart to [NavigatingSpec](#navigatingspec): its `Criteria` filters only on the entity's own scalar columns, the pattern the fitness function must leave alone.
- **Depends on** - [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (`private sealed class ScalarOnlySpec : Specification<FitnessDependent, int>`, `SpecificationFitnessTests.cs:55`) and [FitnessDependent](#fitnessdependent).
- **Concept introduced** - cross-references the navigation-safety concept from [NavigatingSpec](#navigatingspec); this is the positive example. A predicate over the entity's own scalars (`d => d.PrincipalId == 1 && d.Flag`, `:57`) translates to SQL on any engine and survives extraction, so the rule must not flag it. Having both a flagged and an un-flagged fixture is what makes the test prove the rule discriminates rather than just always throwing.
- **Walkthrough** - one overridden `Criteria` filtering on `PrincipalId` and `Flag` (`:57`). The test asserts the rule's exception message does *not* contain this type's name.
- **Where it's used** - the "should not be flagged" input to [SpecificationFitnessTests](#specificationfitnesstests).

### CommonArchitectureMap
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:15` · Level 7 · class
- **What it is** - the architecture map for the MMCA.Common framework: it names each package's layer and pins the layer to a concrete assembly, so the shared rule library knows which assembly is Shared, Domain, Application, and so on for this repo.
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (`internal sealed class CommonArchitectureMap : ArchitectureMapBase`, `CommonArchitectureMap.cs:15`), the [Layer](#layer) enum, and one anchor type per package (`Result`, `BaseEntity<>`, `DomainEventDispatcher`, `ApplicationDbContext`, `ApiControllerBase`, `ResultGrpcExtensions`, `UISharedAssemblyReference`, `CommonArchitectureMap.cs:21`-`:27`).
- **Concept introduced** - *the map as the single point of repo-specific truth for architecture rules.* The rule bodies live once in `MMCA.Common.Testing.Architecture` and are parameterized by an [IArchitectureMap](#iarchitecturemap); each repo supplies exactly one map so the same rules run identically across Common, Store, and ADC. Because Common is a module-less framework, every layer is registered as a *framework* layer via the `Framework(...)` helper rather than a module layer. [Rubric §3 - Clean Architecture] assesses whether layer boundaries are explicit and enforced; this map is the machine-readable statement of those boundaries.
- **Walkthrough** - `RepoToken => "MMCA.Common"` (`:17`) identifies the repo and is what the source-scanning rules use to locate the repo root (they look for `{RepoToken}.slnx`). `DefineLayers()` (`:19`-`:28`) returns one `Framework(Layer.X, anchorType.Assembly)` entry per package, using a single anchor type to resolve each assembly (mirrors the old `PackageAssemblies` helper): Shared, Domain, Application, Infrastructure, Api, Grpc, and Ui (`:21`-`:27`). The doc comment (`:8`-`:13`) records a deliberate omission: `MMCA.Common.UI.Maui` ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)) is absent because its four MAUI TFM assemblies cannot load in the ubuntu net10.0 test process, so its UI+Shared boundary is enforced at compile time by `EnforceUIMauiLayerBoundary` in `Source/Build/MMCA.Common.LayerEnforcement.targets` and the windows `build-maui` CI job instead.
- **Why it's built this way** - one map per repo keeps the rule bodies DRY and identical everywhere (see the "Architecture Enforcement" section in `MMCA.Common/CLAUDE.md`); anchoring by type keeps the assembly reference refactor-safe.
- **Where it's used** - supplied as `Map` by nearly every `*ConventionTests`/`*DependencyTests` subclass in this unit, and is the pattern [SpecTestMap](#spectestmap) collapses to a single layer.

### FrameworkSanityTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:13` · Level 7 · class
- **What it is** - the home for the few architecture checks that are Common-only and do not generalize into the shared rule library: the `MMCA.Common.Grpc` transport boundary and the placement of the `IMessageBus`, `IJwksProvider`, and `ILiveChannelPublisher` abstractions.
- **Depends on** - [IMessageBus](group-04-events-outbox.md#imessagebus), [IJwksProvider](group-08-auth.md#ijwksprovider), [ILiveChannelPublisher](group-10-notifications.md#ilivechannelpublisher), and the NetArchTest `Types` query API routed through [ArchitectureAssert](#architectureassert).
- **Concept introduced** - *repo-specific sanity next to the shared library.* Not every rule fits the parameterized base classes; some assert facts true only of the framework repo. Keeping them in one explicitly-named class documents the boundary between "shared rule applied here" and "Common-only invariant." [Rubric §7 - Microservices Readiness] (transport isolation) and [Rubric §3 - Clean Architecture] (abstraction placement) both apply: gRPC is pure transport and must not couple to Domain/Application/Infrastructure, and the cross-cutting abstractions must sit in the layer their consumers depend on.
- **Walkthrough** - three private static `Assembly` accessors anchor the Grpc, Application, and Infrastructure assemblies by an anchor type each (`:15`-`:19`). Three `[Fact]`s assert `MMCA.Common.Grpc` has no dependency on Domain, Application, or Infrastructure (`:21`-`:34`) via the `AssertNoDependency` helper (`:51`-`:59`), which runs a `Types.InAssembly(...).ShouldNot().HaveDependencyOnAny(...)` NetArchTest query and routes the result through `ArchitectureAssert.NoViolations` (`:58`). Three more `[Fact]`s assert placement by comparing the abstraction's declaring assembly against the anchored layer assembly: `IMessageBus` lives in Application (`:37`-`:39`), `IJwksProvider` in Infrastructure because it handles crypto/PEM material (`:42`-`:44`), and `ILiveChannelPublisher` in Application beside `IPushNotificationSender` (`:47`-`:49`).
- **Why it's built this way** - the message-bus abstraction must stay in Application so application code depends on transport through it (extraction boundary, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)); the JWKS provider is crypto and belongs in Infrastructure ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). These are load-bearing placements, so they get their own asserted facts.
- **Where it's used** - an independent class in the Common architecture suite; it has no counterpart in Store/ADC because only Common owns the Grpc package and defines these abstractions.

### SpecificationFitnessTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:13` · Level 7 · class
- **What it is** - the test that verifies the `SpecificationsDoNotNavigateToOtherEntities` fitness function actually discriminates: it must flag a specification that navigates into another entity and must leave a scalar-only specification alone.
- **Depends on** - [ArchitectureRules](#architecturerules) (the rule under test), and its own nested fixtures [SpecTestMap](#spectestmap), [FitnessDependent](#fitnessdependent), [FitnessPrincipal](#fitnessprincipal), [NavigatingSpec](#navigatingspec), [ScalarOnlySpec](#scalaronlyspec).
- **Concept introduced** - *testing the test: verifying a fitness function is neither vacuous nor over-broad.* A rule that never fires is useless; a rule that flags everything is worse. This class proves the specification-navigation guard does exactly one thing by feeding it both a positive and a negative fixture in a single run. [Rubric §14 - Testability] assesses whether the guardrails themselves are trustworthy; this is the meta-test that earns that trust, and [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) is the decision that makes such guardrails build-gating in the first place.
- **Walkthrough** - one `[Fact]`, `Rule_FlagsNavigatingSpecification_ButNotScalarSpecification` (`:15`-`:24`). It wraps the rule call in an `act` delegate, `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities(new SpecTestMap())` (`:18`), captures the thrown exception through `Should().Throw<Exception>().Which` (`:20`), and asserts its message contains `NavigatingSpec` and the word "navigates" while *not* containing `ScalarOnlySpec` (`:21`-`:23`). Both halves matter: the first two assertions prove the rule fires, the third proves it does not over-report. The nested types below the fact supply the model: `SpecTestMap` (`:26`), the two entities (`:34`,`:43`), and the two specifications (`:49`,`:55`).
- **Why it's built this way** - the navigation rule protects future extraction (a navigating specification cannot cross a data-source boundary, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)); a discriminating test keeps the rule honest as it evolves.
- **Where it's used** - an independent class in the Common architecture suite.

### SpecTestMap
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:26` · Level 7 · class
- **What it is** - a minimal architecture map used only by [SpecificationFitnessTests](#specificationfitnesstests): it registers this test assembly as the single Application layer so the specification-navigation rule has a model to scan.
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (`private sealed class SpecTestMap : ArchitectureMapBase`, `SpecificationFitnessTests.cs:26`) and the [Layer](#layer) enum.
- **Concept introduced** - cross-references the map concept from [CommonArchitectureMap](#commonarchitecturemap). Where the real map spans seven packages, this one collapses to a single self-referential Application layer (`Framework(Layer.Application, typeof(SpecificationFitnessTests).Assembly)`, `:31`) because the fixtures (the two specifications and two entities) live in the test assembly itself. It is the smallest map that lets a fitness function run against hand-crafted types; the rule scans Application and Domain layers for specification subclasses (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:30`-`:33`), so one Application entry is enough.
- **Walkthrough** - `RepoToken => "MMCA.Common"` (`:28`) and a one-entry `DefineLayers()` (`:30`-`:31`) pointing at this assembly.
- **Where it's used** - instantiated once inside [SpecificationFitnessTests](#specificationfitnesstests)'s single fact.

### AggregateConventionTests, DomainPurityTests, EventVersioningConventionTests, HandlerResultConventionTests, LayerDependencyTests, LocalizedTextConventionTests, MicroserviceExtractionTests, PiiConventionTests, RawQueryableConventionTests, SliceCohesionTests, StateManagementConventionTests, UIArchitectureConventionTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · (see per-type table) · Level 8 · class

These twelve sealed classes share one shape: each is a **thin subclass of a shared `*TestsBase` rule** from the `MMCA.Common.Testing.Architecture` package, supplying the repo's [CommonArchitectureMap](#commonarchitecturemap) (and, for a few, one extra override) so the same rule body runs identically across MMCA.Common, MMCA.Store, and MMCA.ADC. This is the [Rubric §34 - Architecture Governance & Documentation] and [Rubric §14 - Testability] story: architecture conventions are executable and enforced in CI rather than left to review, and the rule logic lives in exactly one place ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)). See the thin-subclass pattern introduced by [DependencyVersionTests](#dependencyversiontests). The canonical body of each rule is the corresponding `*TestsBase`; these subclasses only wire in the map and any repo-specific floor or allowlist. Each fails the `build-and-test` CI job on violation, and several are deliberately *vacuous today* (they assert nothing until the framework grows a type that could break the convention, at which point they fire).

| Type | File:Line | Base rule | What it enforces / what differs |
|------|-----------|-----------|----------------------------------|
| `AggregateConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9` | [AggregateConventionTestsBase](#aggregateconventiontestsbase) | Four facts: Domain exposes aggregate roots, each has a `Result<T>`-returning static `Create` factory and no public constructor, and every domain factory returns `Result`. The minimal variant for repos with no business modules; module-bearing repos use the fuller [EntityConventionTestsBase](#entityconventiontestsbase). Supplies only `Map` (`:11`). [Rubric §4 - DDD.] |
| `DomainPurityTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9` | [DomainPurityTestsBase](#domainpuritytestsbase) | Four facts: Domain and Shared stay framework-free, and Application depends on neither EF Core nor ASP.NET Core. Supplies only `Map` (`:11`); the base's `ExtraForbiddenDomainDependencies` hook (used by Store for "Stripe", ADC for "RabbitMQ") stays empty here. [Rubric §3 - Clean Architecture.] |
| `EventVersioningConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/EventVersioningConventionTests.cs:10` | [EventConventionTestsBase](#eventconventiontestsbase) | Three facts: every integration event declares an `int SchemaVersion`, inherits `BaseIntegrationEvent`, and lives in a `*.IntegrationEvents` namespace in Shared ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)). Supplies only `Map` (`:12`). Vacuous today: the framework ships no concrete integration event (`EventVersioningConventionTests.cs:7`-`:8`). [Rubric §6 - CQRS & Event-Driven.] |
| `HandlerResultConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/HandlerResultConventionTests.cs:12` | [HandlerResultConventionTestsBase](#handlerresultconventiontestsbase) | Every concrete command/query handler's `TResult` must be `Result` or `Result<T>` (the pipeline otherwise only enforces this at runtime, when `ResultFailureFactory` throws on a short-circuit); scans the framework's Notifications handlers. The base leads with a non-vacuity fact asserting the map's Application assemblies actually contain handlers, so a mis-pinned assembly cannot pass silently. Supplies only `Map` (`:14`). [Rubric §6 - CQRS & Event-Driven.] |
| `LayerDependencyTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9` | [LayerDependencyTestsBase](#layerdependencytestsbase) | Fourteen facts covering Clean Architecture layer-flow (Domain, Application, Infrastructure, Shared, and Ui each reference only what they may) plus two map-completeness facts requiring the five core layers to be declared. Supplies only `Map` (`:11`), so the default `RequiredLayers` (Shared, Domain, Application, Infrastructure, Api) applies. [Rubric §3 - Clean Architecture.] |
| `LocalizedTextConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizedTextConventionTests.cs:11` | [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase) | Shared `MMCA.Common.UI` ships no hard-coded user-visible literals: snackbar messages, page titles, `<PageTitle>` markup, and breadcrumb labels must resolve through `IStringLocalizer` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). A source scan over `Source/`, with per-line `i18n: allow` exemptions. Also overrides `MinimumScannedFiles => 20` (`:16`) against a base default of 1, so a wrong scan root is caught. [Rubric §27 - i18n.] |
| `MicroserviceExtractionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10` | [MicroserviceExtractionTestsBase](#microserviceextractiontestsbase) | One fact: Domain/Application/Shared stay free of MassTransit/Grpc/Protobuf, so a module behaves identically in-process or extracted ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). Supplies only `Map` (`:12`); Common-only transport sanity lives in [FrameworkSanityTests](#frameworksanitytests) instead (`MicroserviceExtractionTests.cs:7`-`:8`). [Rubric §7 - Microservices Readiness.] |
| `PiiConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13` | [PiiConventionTestsBase](#piiconventiontestsbase) | One fact: every domain entity declaring a `[Pii]` property implements `IAnonymizable` ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). Supplies only `Map` (`:15`). Structurally vacuous in the framework; the machinery is proven non-vacuously by [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests). [Rubric §30 - Compliance/Privacy.] |
| `RawQueryableConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/RawQueryableConventionTests.cs:13` | [RawQueryableConventionTestsBase](#rawqueryableconventiontestsbase) | Bans the raw `IQueryable` repository surfaces (`Table`, `TableNoTracking*`) in Application code via a textual scan; a raw-queryable handler is EF-coupled and cannot move behind a gRPC boundary. Because Common declares no modules, it overrides `ApplicationSourceDirectories()` (`:18`-`:22`) to scan the framework's own `Source/Core/MMCA.Common.Application` project, and overrides `AllowedFiles` (`:25`-`:37`) to whitelist the deliberate composition root `EntityQueryService.cs` and the five Notifications handlers whose cross-entity joins are the documented exception. Supplies `Map` at `:15`. [Rubric §8 - Data Architecture.] |
| `SliceCohesionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SliceCohesionTests.cs:10` | [SliceCohesionTestsBase](#slicecohesiontestsbase) | Two facts: handlers and validators each sit in the same namespace as the command/query they serve, so a Notifications use-case slice stays one cohesive unit. Supplies only `Map` (`:12`). [Rubric §5 - Vertical Slice.] |
| `StateManagementConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:11` | [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) | Two facts: reflection over the map's `Layer.Ui` assemblies fails on any mutable static field or settable static property (a static is shared across every Blazor Server circuit), and a source scan fails if a UI project registers a `*StateService`/`*StateContainer` as a singleton. Overrides `AllowedStaticMembers` to whitelist `MMCA.Common.UI.Pages.Common.ErrorMessages._localizer`, a write-once wiring point, not per-user state (`:21`-`:22`). [Rubric §19 - State Management.] |
| `UIArchitectureConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/UIArchitectureConventionTests.cs:11` | [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase) | Two facts holding the container/presentational split with mechanical caps: every `*.razor.cs` code-behind stays within `MaxCodeBehindLines` (default 400) and every `.razor` inline `@code` block within `MaxInlineCodeLines` (default 120). Supplies only `Map` (`:13`), so both defaults apply. [Rubric §18 - UI Architecture.] |

- **Why they're built this way** - see the two-layer "Architecture Enforcement" model in `MMCA.Common/CLAUDE.md`: rules are enforced at compile time (`Source/Build/MMCA.Common.LayerEnforcement.targets`) and at runtime here, with the runtime bodies factored into one shared package so Common, Store, and ADC stay identical. Each subclass exists only so xUnit discovers the rule in this repo's assembly with this repo's map.
- **Where they're used** - all twelve run in the `MMCA.Common.Architecture.Tests` project during CI's `build-and-test` job (fast, no database).

## Per-project test rollup

This guide treats **tests as grouped, not sectioned per `[Fact]`** (the logged exception in the
charter): the reusable test *bases*, the shared architecture-fitness library and its per-repo thin
subclasses, and the component **Gallery** harness each get their own `###` treatment in the earlier parts
of this chapter, but the bulk of the suite, **1,121 individual test types across 41 projects**, is rolled
up here. Each row below names a test project (assembly), the count of test types it contributes to the
1,121, **what** it covers, and its **style** (unit / integration / component / E2E / performance-smoke).
Counts reconcile exactly to the unit input.

A few cross-cutting facts hold for every row, so they are stated once here rather than repeated:

- **Stack.** Every project is **xUnit v3** run under the **Microsoft Testing Platform** (not VSTest,
  `global.json` sets `"runner": "Microsoft.Testing.Platform"`), with **AwesomeAssertions** for fluent
  asserts, **Moq** for test doubles, and **coverlet** for coverage (see for example
  `MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/MMCA.Common.Testing.Tests.csproj:8`). The lone
  exception is `MMCA.Common.Benchmarks`, a **BenchmarkDotNet** executable (not a test project). See
  [primer §3](00-primer.md#3-the-external-stack-bcl--nuget-external-level-0) for the platform/runner
  externals. MMCA.Common's CI runs the whole solution behind a discovery floor,
  `--minimum-expected-tests 2000` (`MMCA.Common/.github/workflows/ci.yml:144`), so a regression that
  silently stops discovering thousands of tests fails the build instead of passing quietly.
- **Layering mirror.** The ADC module suites repeat the same seven-project shape per module
  (`{Module}.{Shared,Domain,Application,Infrastructure,API,UI}.Tests` + a per-service
  `{Module}.IntegrationTests`), so once you understand the Conference column you understand Engagement
  and Identity: they differ only in volume, not in kind. Notification is the deliberate exception, a
  thinner module with only `API`, `Application`, and `IntegrationTests` projects, because its domain and
  persistence live in `MMCA.Common` and are tested there.
- **Fitness tests and shared bases live elsewhere.** `MMCA.Common.Architecture.Tests` and
  `MMCA.ADC.Architecture.Tests` (the NetArchTest layer/purity/extraction suites, thin subclasses of the
  shared [`ArchitectureRules`](#architecturerules) rule library) are **not** in this table: they are
  covered as first-class sections earlier in this chapter. The same is true of the shared test *bases*
  ([`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture),
  [`HandlerTestBase<THandler>`](#handlertestbasethandler),
  [`BunitComponentTestBase`](#bunitcomponenttestbase),
  [`ProductionHostApplicationFactory<TEntryPoint>`](#productionhostapplicationfactorytentrypoint),
  [`SecurityHeadersTestsBase`](#securityheaderstestsbase),
  [`GracefulShutdownTestsBase<TEntryPoint>`](#gracefulshutdowntestsbasetentrypoint), the Playwright
  fixtures) and the `MMCA.Common.UI.Gallery` harness. The counts below therefore move when a repo adopts
  one of those bases: ADC's Gateway suite dropped a local host factory the week it took the shared one.
- **Four projects sit outside `MMCA.Common.slnx` on purpose.** `MMCA.Common.UI.Gallery`,
  `MMCA.Common.UI.E2E.Tests`, `MMCA.Common.Benchmarks`, and `MMCA.Common.Infrastructure.Redis.Tests` are
  absent from the solution file so that `dotnet test --solution MMCA.Common.slnx` never needs Playwright
  browsers, a Docker daemon, or a multi-iteration timing run. CI builds and runs each one by csproj path
  in its own job (`ui-e2e`, `performance-smoke`, `redis-integration`).
- **Two integration tiers, deliberately split.** Each service has a per-service `*.IntegrationTests`
  project that boots **one** host through `WebApplicationFactory<Program>` with cross-service gRPC edges
  faked and no broker (these gate deploy via the `integration-tests` CI job and need a real SQL Server
  named by `ADC_TEST_SQL_BASE`). Separately, `MMCA.ADC.CrossService.IntegrationTests` and
  `MMCA.ADC.ServiceBusEmulator.IntegrationTests` run against **Testcontainers** to prove the genuine
  broker and gRPC round-trips: both live in the non-gating
  `MMCA.ADC/.github/workflows/cross-service-tests.yml`, whose *recency* (not its result) gates deploys
  through the `cross-service-freshness` job at `MMCA.ADC/.github/workflows/deploy.yml:627`, a 5-day
  window set by `FRESHNESS_DAYS` at `MMCA.ADC/.github/workflows/deploy.yml:637`.
  `[Rubric §14, Testability]` (assesses how thoroughly and at what cost the system can be verified): the
  count and spread below, heavy at the inner Application/Domain layers, thinner at the edges, with a
  dedicated integration + E2E tier, is the classic healthy **test pyramid**, and the fact that the volume
  concentrates in fast in-memory unit layers keeps the feedback loop cheap.

### MMCA.Common, the framework suite (Tests/ mirrors Source/)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.Common.Shared.Tests` | 23 | The innermost layer: the `Result`/`Error`/`ErrorType` pattern, value objects (`Money`, `Email`, `Address`, `DateRange`, …) and their factory-method invariants, DTO/paging contracts, and the striped keyed lock behind [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) (mutual exclusion per key, independent progress across stripes, release on the exception path, and a bounded table size no matter how many caller-supplied keys arrive, `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Concurrency/KeyedSemaphoreStripeTests.cs:12`). Pure **unit** tests, no DI or DB. |
| `MMCA.Common.Domain.Tests` | 43 | The entity hierarchy (`BaseEntity`→`AuditableBaseEntity`→`AuditableAggregateRootEntity`), domain-event collection, `SetItems<T>`/`GetChildOrNotFound<T>`, specifications, and the `PiiAttribute`/anonymization boundary plus the logging/telemetry redaction half of the `[Pii]` contract (masks marked members so a data subject's values never reach logs, [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) / §30). Pure **unit** tests over the framework domain primitives. |
| `MMCA.Common.Application.Tests` | 164 | The CQRS engine: the decorator pipeline in its registered nesting order (FeatureGate→Logging→Caching→Validating→Transactional→handler, `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:88`), the opt-in MiniProfiler decorators added by `AddApplicationProfiling` (`.../DependencyInjection.cs:185`) and the `CqrsMetrics` counters/histograms (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:20`), `ModuleLoader` topological ordering, `DomainEventDispatcher` plus the swallow-and-log `SafeDomainEventHandler` base (`.../DomainEvents/SafeDomainEventHandlerTests.cs:9`), validation, the [`IMessageBus`](group-04-events-outbox.md#imessagebus) abstraction, entity-query projection/paging and the per-type filter strategies, the cross-source [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification) helper ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), the magic-byte upload sniffer behind [`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer) (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ImageContentSnifferTests.cs:12`, [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)), and the notification read handlers driven by an injected `TimeProvider` test clock. Two of its newer files are worth calling out because they defend non-obvious properties rather than behavior: `PagingMathTests` pins the page arithmetic (`.../Services/Query/PagingMathTests.cs:12`), and `QueryFilterServicePropertyCacheTests` asserts on the real static property cache inside [`QueryFilterService`](group-03-querying-specifications.md#queryfilterservice) to prove that caching a *miss* never happens, since filter names arrive in the query string and a negatively-cached miss would let any caller grow a process-lifetime dictionary one bogus name at a time while the request still returned a tidy 400 (`.../Services/Filtering/QueryFilterServicePropertyCacheTests.cs:14`, §11/§12). The framework's largest suite; fast **unit** tests with mocked infrastructure. |
| `MMCA.Common.Infrastructure.Tests` | 185 | The widest layer: EF repositories + Unit of Work, the multi-database resolver/registry (`DataSourceResolver`, `EntityDataSourceRegistry`, `DbContextFactory`) with its transaction coverage (`.../Persistence/DbContextFactoryTransactionTests.cs:28`) and the cross-data-source degrade convention (`.../Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:24`), the **outbox** processor (eligibility/smart-wait/retry) plus its wake signal (`.../Persistence/OutboxSignalTests.cs:13`) and the consumer-side [`EfInboxStore`](group-04-events-outbox.md#efinboxstore) idempotency ledger (`.../Persistence/Inbox/EfInboxStoreTests.cs:27`, [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)), caching, JWT issuance + JWKS + the login-attempt lockout service (`.../Auth/LoginProtectionServiceTests.cs:14`), column-level encryption (`.../Persistence/EncryptedStringConverterTests.cs:6`), the filtered-unique-index soft-delete convention (`.../Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs:23`), image processing (`.../Services/ImageSharpImageProcessorTests.cs:15`, [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)), the SignalR push + live-channel plumbing, the message-bus implementations, the polyglot Cosmos-config portability suite ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), and the in-repo disaster-recovery database-restore drill (`.../Resilience/DatabaseRestoreDrillTests.cs:18`, a CI-gated RTO baseline, [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) / §29). Three of its files are pure **§12 performance guards** and are the only place the emitted SQL or the tracker's work is inspected at all: `QueryParameterizationTests` asserts that the dynamic-LINQ filter and sort strategies send their values as SQL *parameters* rather than inlined literals, which is what decides whether SQL Server reuses a plan and whether EF's compiled-query cache hits (`.../Persistence/QueryParameterizationTests.cs:26`); `SaveChangeDetectionTests` pins that a save runs change detection exactly once (two interceptors scan the `ChangeTracker` from `SavingChanges` and EF detects again on its own, and `Entries<T>()` memoizes nothing, so each scan used to pay a full snapshot comparison over every tracked entity and property) *and* pins that suppressing the extra passes lost the tracker no actual changes (`.../Persistence/SaveChangeDetectionTests.cs:24`); and `PeriodicBackgroundServiceTests` drives [`PeriodicBackgroundService`](group-07-persistence-ef-core.md#periodicbackgroundservice) deterministically through a `FakeTimeProvider` clock to cover the enablement gate, the startup delay, interval-driven cycles, and the failing-cycle-never-kills-the-loop contract (`.../Services/PeriodicBackgroundServiceTests.cs:15`). Mostly **unit** with EF-InMemory/SQLite boundaries (no real SQL Server here). |
| `MMCA.Common.Infrastructure.Redis.Tests` | 1 | The one tier in the framework that runs the shipped cache against a **real Redis**. The unit tier mocks `IDistributedCache`, which means it asserts the calls the cache makes and never the storage format Redis ends up holding, and that is a blind spot with teeth: Redis keys are typed, `INCR` creates a **string**, and the `IDistributedCache` Redis provider stores every entry as a **hash** of `absexp`/`sldexp`/`data`, so mixing the two at one key round-trips flawlessly against a mock and answers `WRONGTYPE` in production, on the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) rate-limit and lockout counters. `DistributedCacheServiceRedisTests` starts a `redis:7-alpine` Testcontainer, builds [`DistributedCacheService`](group-09-caching.md#distributedcacheservice) exactly as `AddCaching` does when both a distributed cache and a multiplexer are registered, and proves the increment→read round-trip, that increments carry a TTL so a counter can never lock a subject out forever, that concurrent writers may undercount but must never leave the key unreadable (the honest statement of the current read-modify-write contract), prefix invalidation over a real `SCAN`, and a plain set/get/remove smoke (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Redis.Tests/DistributedCacheServiceRedisTests.cs:27`). Needs Docker, so it is outside the slnx and runs in the `redis-integration` CI job (`MMCA.Common/.github/workflows/ci.yml:611`). **Integration** style. |
| `MMCA.Common.API.Tests` | 66 | The presentation pipeline: `ApiControllerBase.HandleFailure` `ErrorType`→HTTP mapping, the exception-handler chain, the `[Idempotent]` filter + `Idempotency-Key` replay, permission policies/ownership filters, correlation, the JWKS and OIDC-discovery endpoints, the session-cookie auth handler/refresher/jar, the shared notification + device controllers, the public-endpoint output-cache policy, the database-initialization startup (the SQLite-`EnsureCreated`-under-`Migrate` path, [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), and the error-message **localization** edge (localizes the human-readable message while leaving the machine `Code`/ProblemDetails `title` untouched and degrading to English when no localizer is present, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / §27). Its rate-limiting pair is worth reading together ([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), §11): `RateLimitPartitionTests` drives the global limiter's exemption and partition-key logic directly (infrastructure paths and gRPC content types bypass, anonymous traffic gets the no-limiter partition, an authenticated caller partitions by name then `user_id` then remote IP) and then the per-IP anti-spray policy, which deliberately **fails open**, since an unattributable request (the in-process `TestServer` has a null `RemoteIpAddress`) gets no limiter rather than sharing one bucket with every other unattributable caller (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/RateLimitPartitionTests.cs:16` and `:80`); `AuthControllerBaseRateLimitTests` then asserts the *attachment* by reflection, because the policy is applied with an attribute and a dropped attribute breaks nothing loudly (the endpoint simply stops being throttled), so it pins `LoginAsync`/`RegisterAsync` carrying the auth-IP policy and pins `RefreshAsync` deliberately **not** carrying it, since refresh is automatic and every Blazor Server circuit shares the UI host's IP (`.../Controllers/AuthControllerBaseRateLimitTests.cs:16`). **Unit** tests of middleware/filters/controllers in isolation. |
| `MMCA.Common.Grpc.Tests` | 13 | The gRPC transport boundary: `Result`↔`RpcException` round-tripping, the JWT-forwarding client interceptor, and the Polly **resilience** pipeline on typed clients (retry, circuit-breaker, and fault-injection). **Unit** tests asserting [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) / [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) behavior. |
| `MMCA.Common.Aspire.Tests` | 12 | The hosting/observability extensions: `OutboxPollFilterProcessor` (drops recurring outbox-poll spans from telemetry export), the `SecurityHeadersMiddleware`, the startup **warm-up** gate (the readiness health check reports Unhealthy while warming so `/health/ready` keeps a cold replica out of rotation, then Healthy once the gate opens, `MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Warmup/WarmupReadinessHealthCheckTests.cs:11`, §29), the head-based trace-sampling cost knob (a ratio in (0,1) opts in, anything else samples everything so a typo cannot silently drop all telemetry, `.../Telemetry/TracesSampleRatioTests.cs:11`, §31), and the metrics-instrumentation toggle (`.../Telemetry/MetricsInstrumentationToggleTests.cs:12`). Its newest file guards the one deliberate asymmetry in `AddInfrastructureHealthChecks`: a missing SQL connection string throws at startup when the host requires it, while absent Redis/RabbitMQ skip silently, and the optional checks carry `HealthCheckTags.Optional` so they never gate `/health/ready` (an untagged Redis check would turn a cache blip, which [`DistributedCacheService`](group-09-caching.md#distributedcacheservice) already degrades around, into every replica leaving rotation at once, `.../Health/InfrastructureHealthChecksTests.cs:16` and `:76`, §29). **Unit** suite over the Aspire service-defaults package. |
| `MMCA.Common.Testing.Tests` | 9 | The suite that tests the **test framework itself**, so a regression in the shared scaffolding fails here rather than silently weakening every consumer suite: `HandlerTestBaseTests` drives [`HandlerTestBase<THandler>`](#handlertestbasethandler) exactly as a consumer handler test would, registering repositories and relying on the pre-wired unit of work (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/HandlerTestBaseTests.cs:12`), and `DecoratorPipelineOrderTests` runs [`DecoratorPipelineOrderTestsBase<…>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult) against MMCA.Common's own `AddApplication → ScanModuleApplicationServices → AddApplicationDecorators` sequence to prove the resolved pipelines nest in the [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) order (`.../DecoratorPipelineOrderTests.cs:20`). **Unit** style. |
| `MMCA.Common.UI.Tests` | 71 | Shared Blazor components (delete-confirmation, empty-state, the mobile card/infinite-scroll lists, notification bell/inbox/list/send pages, primitives), the MudBlazor theme/provider harness, HTTP-resilience/service-exception helpers, list-page state/query-state services, the primitive markup snapshots, the auth-form view-model validation (§24), and the i18n globalization pair (the `[!!…!!]` bracket-sentinel pseudo-localizer and the `ResxMudLocalizer` MudBlazor-chrome boundary, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / §27) plus the auth-aware nav menu and its mobile top-row. Rendered with **bUnit** (component-render unit tests via [`BunitComponentTestBase`](#bunitcomponenttestbase)). |
| `MMCA.Common.UI.Web.Tests` | 4 | The Blazor Server web-host pieces: `ServerTokenStorageService` (during SSR prerender tokens come from the HttpOnly session cookies; on the interactive circuit the access token is held in memory, hydrated single-flight, and refreshed proactively near expiry, while the refresh token is never readable), the server form-factor probe, and `BlazorCspPolicyProvider`, which pins the enforced production Content-Security-Policy verbatim (connect-src locked to the configured API/Gateway origin, no `unsafe-eval`, permissive Report-Only degradation on an unparseable endpoint, §26). **Unit** tests. |
| `MMCA.Common.UI.E2E.Tests` | 11 | **Playwright** axe-core (WCAG 2.1 AA) + render-smoke over the backend-less **Gallery** host (real Login/Register pages, the primitives/components showcase, and the shared Notification pages against stubbed collaborators), plus the dark-mode toggle, a Web-Vitals probe, and two i18n/mobile-parity gates: a `qps-Ploc` pseudo-locale round-trip asserting the `[!!` sentinel and no horizontal overflow under ~40% text expansion ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / §27), and the culture+theme controls pinned into the mobile top-row below 1024px ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) / §22). Deliberately outside `MMCA.Common.slnx`; runs in CI's `ui-e2e` job across chromium, firefox, and webkit. **E2E/accessibility** style. `[Rubric §21, Accessibility]` (assesses automated a11y gating): this is where the framework proves zero axe violations before downstream apps consume the pages. |
| `MMCA.Common.Benchmarks` | 6 | A BenchmarkDotNet **performance-smoke** executable covering the two DB-free hot paths. `SpecificationBenchmarks` measures the per-instance compiled-expression cache behind [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)`.IsSatisfiedBy` (a cached-compile baseline vs. the recompile-each-call anti-pattern) and the `And`/`Or` composition cost (`MMCA.Common/Tests/Performance/MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:14`); `QueryPipelineBenchmarks` adds the read side, which runs on every list request in every consumer and regresses silently because the dynamic-LINQ predicate is re-parsed per call and the shaper reflects over the DTO: a single `CONTAINS` filter, a three-strategy mixed filter, dynamic sorting, and full-field vs. sparse-`fields=` shaping of a 100-row page (`.../QueryPipelineBenchmarks.cs:17`). Deliberately **outside `MMCA.Common.slnx`** (like the Gallery), but not on-demand-only: CI's `performance-smoke` job runs the suite with `--job Short --exporters json` and then `build/perfgate` compares the results against the committed `Tests/Performance/perf-baseline.json`, failing on any violation of its allocation ceilings or machine-independent ratio floors, and on a rule naming a benchmark that produced no measurement, so the gate cannot pass vacuously (`MMCA.Common/.github/workflows/ci.yml:362` and `:371`). Moving a number deliberately means updating the baseline in the same PR. `[Rubric §12, Performance & Scalability]` (assesses measured, not assumed, hot-path cost): this is the evidence harness, and the baseline file turns it from a runs-clean smoke into a regression gate. **Performance-smoke** style. |

### MMCA.ADC, Conference module (the largest application module)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Conference.Shared.Tests` | 17 | Conference DTOs, requests, enums, and DTO/request mappers (the manual-mapping/Mapperly boundary, [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)). Pure **unit** tests. |
| `MMCA.ADC.Conference.Domain.Tests` | 22 | The Conference aggregates (Event, Session, Speaker, Room, Category, Question/Answer): factory-method `Result<T>` outcomes, invariants, state transitions, and emitted domain events. **Unit** tests. |
| `MMCA.ADC.Conference.Application.Tests` | 136 | The command/query handlers for the Conference controllers, validators, navigation populators, the **Sessionize import** orchestrator + sync strategies (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Application.Tests/Events/UseCases/RefreshFromSessionizeHandlerTests.cs:12`), and the event/session live-window validation served to the live layer over gRPC (`.../Events/EventLiveValidationServiceTests.cs:13`, [`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterhandler) and its cross-source filter query, [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). It also carries the AI-scoring background queue (`.../Sessions/DecisionSupport/SessionScoringQueueTests.cs:11`, [`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue)) and the sessions-by-speaker filter handler, whose specification resolves the `SessionSpeaker` join down to an engine-portable ID-list criteria so the speaker pages and speaker dashboard filter server-side instead of pulling the whole catalog (`.../Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandlerTests.cs:16`, [`GetSessionsBySpeakerFilterHandler`](group-18-conference-application.md#getsessionsbyspeakerfilterhandler), §12). The biggest application suite in ADC; fast **unit** tests with mocked repositories/services. |
| `MMCA.ADC.Conference.Infrastructure.Tests` | 7 | Conference-specific EF configurations, the module DB seeder, the Sessionize HTTP client, and the Anthropic-backed session-scoring service (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Infrastructure.Tests/Services/AnthropicScoringServiceTests.cs:12`). Small **unit** suite over faked HTTP handlers. |
| `MMCA.ADC.Conference.API.Tests` | 16 | Conference REST controllers (events, sessions, speakers, rooms, categories, questions/answers, session selection), the module's permission grants, and the Conference error-resource localization completeness check (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Localization/ConferenceErrorResourcesTests.cs:15`, §27). **Unit** tests of the API layer. |
| `MMCA.ADC.Conference.UI.Tests` | 27 | Conference Blazor pages and components: the public event/session/speaker detail + filtered list pages, the management CRUD forms and management-route authorization, the organizer feedback dashboards, the speaker dashboard, the session-selection dashboard with its AI-score and speaker-overlap views (`.../Pages/SessionSelection/SessionSelectionAiScoresTests.cs:15`), and the share/QR/add-to-calendar buttons (`.../Components/QrCodeButtonTests.cs:14`). Rendered with **bUnit** (`BunitTestBase` over the shared [`BunitComponentTestBase`](#bunitcomponenttestbase)). **Component** tests. |
| `MMCA.ADC.Conference.IntegrationTests` | 36 | Boots the **Conference service host** via `WebApplicationFactory<Program>` (gRPC peers faked, JWT re-pointed at an in-process test key) and drives real HTTP per role (Anonymous/Attendee/Speaker/Organizer), plus OpenAPI contract-snapshot, API-versioning, optimistic-concurrency, soft-delete + audit-stamp fidelity, idempotency replay, output-cache eviction, the `includeChildren` regression, and the in-process `CrossServiceUserRegisteredTests` (the Identity→Conference `UserRegistered` auto-link handler). **Integration** style; needs a real SQL Server (`ADC_TEST_SQL_BASE`), runs in the deploy-gating `integration-tests` CI job. |

### MMCA.ADC, Engagement module (bookmarks, feedback, and the conference-day live layer)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Engagement.Shared.Tests` | 2 | Bookmark/feedback/live DTOs, requests, and mappers. **Unit**. |
| `MMCA.ADC.Engagement.Domain.Tests` | 6 | The `UserSessionBookmark`, event/session feedback, and conference-day live-layer aggregates (`LivePoll` + `SessionQuestion`): factory `Result<T>` outcomes, invariants, and domain events. **Unit**. |
| `MMCA.ADC.Engagement.Application.Tests` | 30 | Bookmark, feedback, and live-layer (poll / session-question) add/remove/query handlers and validators, including the cross-module `ISessionBookmarkValidationService` / `IBookmarkCountService` / `IEventLiveValidationService` gRPC collaborators (stubbed), the poll-results builder (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.Application.Tests/LivePolls/Services/LivePollResultsBuilderTests.cs:16`), and the best-effort `ILiveChannelPublisher` ingress together with the queue that decouples it from the request path (`.../Live/LiveChannelPublishQueueTests.cs:8`, [`LiveChannelPublishQueue`](group-22-engagement-module.md#livechannelpublishqueue)). **Unit**. |
| `MMCA.ADC.Engagement.Infrastructure.Tests` | 4 | Engagement EF configuration plus the live-channel publish processor that fans domain changes out to the SignalR hub (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure.Tests/Live/LiveChannelPublishProcessorTests.cs:10`). **Unit**. |
| `MMCA.ADC.Engagement.API.Tests` | 6 | The Bookmarks/Feedback/Live REST controllers in isolation. **Unit**. |
| `MMCA.ADC.Engagement.UI.Tests` | 19 | Engagement Blazor renders and their UI services: the bookmark UI, the session/event feedback pages, the conference-day live/presenter surfaces (Happening Now, live poll, session Q&A, the moderation panel), the live-channel join/reconnect path (`.../Pages/LiveChannelJoinTests.cs:37`), and the session-reminder planner/coordinator (`.../Services/SessionReminderPlannerTests.cs:11`). **Component** (bUnit). |
| `MMCA.ADC.Engagement.IntegrationTests` | 13 | Boots the **Engagement service host** via `WebApplicationFactory<Program>` and exercises the bookmark/feedback/live workflows + authorization over real HTTP. **Integration**; real SQL Server, deploy-gating CI job. |

### MMCA.ADC, Identity module (User aggregate + JWT/JWKS + external OAuth)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Identity.Shared.Tests` | 3 | Identity DTOs/requests and mappers (`User`, roles, `LinkedSpeakerId`). **Unit**. |
| `MMCA.ADC.Identity.Domain.Tests` | 4 | The `User`/`UserRole` aggregate factories, invariants, anonymization, and speaker-linking domain events. **Unit**. |
| `MMCA.ADC.Identity.Application.Tests` | 21 | Registration/login/profile/role/preferences handlers and validators, the external-OAuth (Google/GitHub) exchange, and the `SpeakerLinkedToUser`/`SpeakerUnlinkedFromUser` integration-event handlers. **Unit**. |
| `MMCA.ADC.Identity.Infrastructure.Tests` | 4 | Identity EF config/repository, RS256 token issuance, and the JWKS provider. **Unit**. |
| `MMCA.ADC.Identity.API.Tests` | 7 | The Auth REST controller, the JWKS endpoint, and identity middleware in isolation. **Unit**. |
| `MMCA.ADC.Identity.UI.Tests` | 6 | Identity Blazor pages (login/register/profile/user-management) rendered with **bUnit**. **Component**. |
| `MMCA.ADC.Identity.IntegrationTests` | 33 | Boots the **Identity service host** via `WebApplicationFactory<Program>` and drives the full auth surface over real HTTP: registration, login and its anonymous edge cases, claims, profile, user preferences, soft-deleted-user handling, the external-OAuth challenge/exchange, GDPR user export (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Attendee/UserExportTests.cs:16`), and JWKS discovery. It also carries the two contract guards (OpenAPI snapshot and the RFC 9457 Problem Details subclass over [`ProblemDetailsContractTestsBase<TFixture>`](#problemdetailscontracttestsbasetfixture), `.../Contract/ProblemDetailsContractTests.cs:16`, §9), the compliance pair that proves erasure works end to end and that PII never reaches the log pipeline (`.../Compliance/ErasureAndPiiLoggingTests.cs:19`, [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) / §30), an outbox-fidelity guard asserting registration atomically enqueues `UserRegistered` into `[dbo].[OutboxMessages]` (`.../Data/OutboxFidelityTests.cs:17`), and the in-process `CrossServiceSpeakerLinkTests`. **Integration**; real SQL Server, deploy-gating CI job. |

### MMCA.ADC, Notification module (push + inbox on top of the framework's notification types)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Notification.API.Tests` | 1 | `NotificationModuleTests` pins the module contract itself: its `Name`, its declared `Dependencies` on Identity, `RequiresDependencies`, and the `RegisterDisabledStubs` path that keeps the cross-module `IUserNotificationExportService` resolvable as a singleton `DisabledUserNotificationExportService` when the module is switched off (`MMCA.ADC/Tests/Modules/Notification/MMCA.ADC.Notification.API.Tests/NotificationModuleTests.cs:7`). **Unit**. |
| `MMCA.ADC.Notification.Application.Tests` | 5 | The module's two application services plus its DI registration: `AttendeeNotificationRecipientProvider` resolving broadcast recipients through the Identity `IAttendeeQueryService` gRPC contract (`MMCA.ADC/Tests/Modules/Notification/MMCA.ADC.Notification.Application.Tests/AttendeeNotificationRecipientProviderTests.cs:7`), `UserNotificationExportService` assembling a data-subject export from the user-notification and push-notification repositories over `InMemoryQueryableExecutor` on top of [`HandlerTestBase<THandler>`](#handlertestbasethandler) (`.../UserNotificationExportServiceTests.cs:11`, §30), and `AddModuleNotificationApplication` proving both are registered against their interfaces (`.../DependencyInjectionTests.cs:9`). **Unit**. |
| `MMCA.ADC.Notification.IntegrationTests` | 8 | Boots the **Notification service host** via `WebApplicationFactory<Program>` (the Identity recipient-lookup gRPC client faked by `FakeAttendeeQueryService`) and exercises the push-notification REST endpoints + inbox (`NotificationsController`/`InboxController` from `MMCA.Common.API`, `MMCA.ADC/Tests/Integration/MMCA.ADC.Notification.IntegrationTests/Notifications/NotificationControllerTests.cs:16`), an OpenAPI contract snapshot (`.../Contract/OpenApiContractTests.cs:16`), and the real-time SignalR [`NotificationHub`](group-10-notifications.md#notificationhub): a live `HubConnection` asserts authenticated connect, anonymous rejection (the hub carries `[Authorize]`), and a POST-triggered broadcast reaching the connected recipient (`.../Notifications/NotificationHubTests.cs:15`). **Integration**; real SQL Server (`ADC_TEST_SQL_BASE`), deploy-gating CI job. |

### MMCA.ADC, host, cross-service, and end-to-end suites

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Gateway.Tests` | 5 | Boots the real **YARP Gateway** host in-process and asserts three operational guarantees, two of them with no test body in this repo at all: since the v1.131.0 uplift the host fixture and the test bodies come from `MMCA.Common.Testing`, so ADC supplies only the entry point. `SecurityHeadersTests` is a four-line subclass of [`SecurityHeadersTestsBase`](#securityheaderstestsbase) that hands it a client from the shared [`ProductionHostApplicationFactory<Program>`](#productionhostapplicationfactorytentrypoint) class fixture (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:11`); the base probes `/alive`, which always answers regardless of backend reachability, and pins `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`, and (because the factory pins the `Production` environment, `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ProductionHostApplicationFactory.cs:36`) HSTS (§26). `GracefulShutdownTests` is a body-less subclass of [`GracefulShutdownTestsBase<TEntryPoint>`](#gracefulshutdowntestsbasetentrypoint) closed over the Gateway's `Program` (`.../GracefulShutdownTests.cs:9`): the base boots the host, stops it under a 20-second bounded token, and asserts `ApplicationStopping` then `ApplicationStopped` fired, so a hosted service that refuses to drain fails here instead of silently wedging a rolling deploy (§29). The third is ADC-specific and stays local: `RouteMapTests` asserts the full YARP route table forwards each pattern to the service that owns it, by swapping the real `IHttpForwarder` for `RecordingHttpForwarder`, a fake that never proxies and echoes the destination prefix into a response header, so all 24 mapped routes plus a 404-on-unmapped case are asserted in-process with no backends (`.../RouteMapTests.cs:19`, the local `RouteMapApplicationFactory` at `:99`, the fake at `:120`). The Gateway is a pure reverse proxy (no DbContext/broker) so the boot needs no SQL. **Integration** style. |
| `MMCA.ADC.CrossService.IntegrationTests` | 12 | The **real-broker + real-gRPC** tier: boots all three REST hosts (Identity/Conference/Engagement) in one process against a **Testcontainers** SQL Server and a **Testcontainers** RabbitMQ, so the genuine MassTransit outbox → broker → consumer round-trip (`UserRegistered` auto-link, `SpeakerLinked`/`SpeakerUnlinked` back-link) and the real Conference → Engagement bookmark-count gRPC read run end to end, over a sequential env-boot fixture and a smoke gate that fails first if the container/host wiring is wrong. **Integration** style; needs **Docker**, runs in the weekday-nightly `cross-service` job (`MMCA.ADC/.github/workflows/cross-service-tests.yml:74`, scheduled by the `0 6 * * 1-5` cron at `.../cross-service-tests.yml:30`), not in `Integration.slnf`. This is the job whose recency the `cross-service-freshness` deploy gate keys off. |
| `MMCA.ADC.ServiceBusEmulator.IntegrationTests` | 3 | **Broker-parity smoke** (§33): production runs on Azure Service Bus while local development runs RabbitMQ, so Service-Bus-specific transport behavior is otherwise observable only in the deployed environment. This tier runs MassTransit v8 against the official **Service Bus emulator** container with ADC's real integration-event contracts and proves the two transport-specific behaviors: admin-plane topology provisioning (topic per message type, subscription, receive-endpoint queue) and the AMQP publish → topic → subscription → consume round-trip (`MMCA.ADC/Tests/Integration/MMCA.ADC.ServiceBusEmulator.IntegrationTests/ServiceBusRoundTripSmokeTests.cs:22`). One warm collection-scoped emulator serves the whole tier because of the emulator's connection and admin-operation quotas, and the fixture's static constructor lowers MassTransit's process-global TTL/auto-delete defaults beneath the emulator's maximum, which is why this tier lives in its **own** test process (`.../Infrastructure/ServiceBusEmulatorFixture.cs:22`). Read the current CI status honestly: the job is `continue-on-error` with an 8-minute cap and, since 2026-07-24, **dispatch-only** (`if: … && github.event_name == 'workflow_dispatch'`, `MMCA.ADC/.github/workflows/cross-service-tests.yml:144`), because the emulator's floating companion SQL image hung container startup and was killed at the timeout on 7 of 7 measured runs, producing no signal while burning runner minutes and forcing every cross-service run to conclude `cancelled`. Nothing gates on it (the freshness gate keys off the `cross-service` job specifically), so unscheduling it changed no deploy precondition; run it by hand when validating a fix for the startup hang. **Integration** style; needs **Docker**. |
| `MMCA.ADC.E2E.Tests` | 60 | **Playwright** end-to-end against the running Aspire stack, using a Page-Object model (`PageObjects/`) and `E2ETestBase` login helpers, organized by actor workflow (Organizer/Speaker/Attendee/Identity/Preferences) plus the Engagement live-poll and feedback flows, real-time notification push, a Web-Vitals budget check, and an `AccessibilityTests` axe sweep. Runs once per engine via `E2E_BROWSER` (chromium/firefox/webkit); the chromium leg gates deploy through `e2e-gate` while firefox and webkit stay on the Mon/Thu schedule. The largest single project here and the source of most of the chapter's recorded E2E debugging history. `[Rubric §28, Front-End Testing]` + `[Rubric §22, Responsive/Cross-Browser]`: this suite is the cross-browser, real-user-flow safety net. **E2E** style. |

**Reconciliation.** Common: 23+43+164+185+1+66+13+12+9+71+4+11+6 = **608** (13 projects).
ADC Conference: 17+22+136+7+16+27+36 = **261** (7). ADC Engagement: 2+6+30+4+6+19+13 = **80** (7).
ADC Identity: 3+4+21+4+7+6+33 = **78** (7). ADC Notification: 1+5+8 = **14** (3).
ADC host/cross-service/E2E: 5+12+3+60 = **80** (4).
**Total = 608+261+80+78+14+80 = 1,121**, across **41 projects**, matching the unit input exactly.


---
[⬅ Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)](group-26-device-capability-layer.md)  •  [Index](00-index.md)  •  [Coverage audit ➡](99-coverage-audit.md)
