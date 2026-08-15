# 27. Testing & Quality Infrastructure

**What this group covers.** Everything the codebase uses to *prove* itself: the four reusable
test-support packages that ship out of `MMCA.Common/Source/Hosting` (`MMCA.Common.Testing`,
`MMCA.Common.Testing.Architecture`, `MMCA.Common.Testing.E2E`, `MMCA.Common.Testing.UI`, four of the
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
   [`CrossServiceFixtureBase`](#crossservicefixturebase),
   [`ProductionHostApplicationFactory<TEntryPoint>`](#productionhostapplicationfactorytentrypoint),
   [`JwtTokenGenerator`](#jwttokengenerator), [`FeatureManagementTestExtensions`](#featuremanagementtestextensions),
   [`TestPolling`](#testpolling), [`EntityBuilderBase<TBuilder, TEntity>`](#entitybuilderbasetbuilder-tentity))
   boots a real service host in-process against a throwaway SQL Server database and drives it over
   HTTP.
2. **Architecture fitness functions** ([`IArchitectureMap`](#iarchitecturemap),
   [`ArchitectureMapBase`](#architecturemapbase), [`Layer`](#layer), [`LayerRef`](#layerref),
   [`ArchitectureAssert`](#architectureassert), [`RuleHelpers`](#rulehelpers),
   [`CrossEntityNavigationFinder`](#crossentitynavigationfinder), the sixteen
   [`ArchitectureRules`](#architecturerules) partial files, and the thirty-two abstract `*TestsBase`
   classes including [`RouteAuthorizationTestsBase`](#routeauthorizationtestsbase),
   [`ModuleConformanceTestsBase<TModule>`](#moduleconformancetestsbasetmodule) and
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
   [`DependencyInjectionAssert`](#dependencyinjectionassert),
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

One tier up sits [`CrossServiceFixtureBase`](#crossservicefixturebase)
(`MMCA.Common.Testing/CrossServiceFixtureBase.cs:41`), which boots **several** hosts in one process
against a real Testcontainers SQL Server and a real Testcontainers RabbitMQ
(`CrossServiceFixtureBase.cs:2-3,18-25`), so the genuine outbox to broker to consumer round-trip is
exercised rather than faked. Each logical source it routes is a
[`CrossServiceDataSource`](#crossservicedatasource) record pairing the config key with its physical
database (`CrossServiceFixtureBase.cs:15`, list supplied by the subclass at `:60`). The design note
worth internalizing is why the hosts must boot **strictly sequentially**: every host reads its
connection string, `MessageBus` settings and JWT settings from configuration at configure-time,
before `builder.Build()`, so process environment variables are the only override channel that lands
in time, and the one genuinely per-host key is the SQL connection string
(`CrossServiceFixtureBase.cs:26-39`). A booted host has already snapshotted its connection, so
mutating the environment for the next one is safe. Two smaller decisions in the same file are worth
knowing because they are non-obvious: the databases are **pre-created** before any host boots, since
EF's `CREATE DATABASE` runs before its migration lock is taken and a double-booted host would race
itself (`CrossServiceFixtureBase.cs:107-111`), and each module is routed to a **named** data source
whose connection string differs only by `Application Name`, so EF's process-global model cache keys
each host's model separately instead of letting the first booted host win
(`CrossServiceFixtureBase.cs:231-246,260-276`). A host that needs no database at all gets the much
smaller boot path:
[`ProductionHostApplicationFactory<TEntryPoint>`](#productionhostapplicationfactorytentrypoint)
(`MMCA.Common.Testing/ProductionHostApplicationFactory.cs:22`) pins `UseEnvironment("Production")`
(`ProductionHostApplicationFactory.cs:36`) so the production-only branches (restrictive CORS, HSTS
emission) are the ones under test, and captures the started `IHost`
(`ProductionHostApplicationFactory.cs:29`) because `StopAsync` is not reachable through the
`WebApplicationFactory` surface at all.

Four helpers round out the tier. [`JwtTokenGenerator`](#jwttokengenerator)
(`MMCA.Common.Testing/JwtTokenGenerator.cs:30`) issues **RS256**-signed tokens (`GenerateToken`,
`JwtTokenGenerator.cs:112`, signing credentials built at `:130-131`) using an embedded dev RSA-2048
keypair (`DefaultPublicKeyPem` at `:49`, `DefaultPrivateKeyPem` at `:68`) under a fixed `kid` of
`mmca-test-key` (`:41`), so integration tests exercise the exact JWKS/RS256 validation code path
production runs ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html));
the class remarks flag, correctly, that the committed keypair is insecure by design and must never be
used in a real deployment (`:22-28`). [`FeatureManagementTestExtensions`](#featuremanagementtestextensions)
(`MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10`) adds a `ConfigureTestFeatureFlags`
extension member (`:21`) that builds an in-memory `FeatureManagement:*` configuration (`:24-32`) so a
test `WebApplicationFactory` can flip a gate without touching `appsettings.json`.
[`TestPolling`](#testpolling) (`MMCA.Common.Testing/TestPolling.cs:9`) replaces the pre-assert sleep
that eventually-consistent paths tempt you into: `PollUntilAsync` (`TestPolling.cs:22`) probes until
the condition holds or a 60-second budget expires at a 500 ms interval (`TestPolling.cs:31-32`) and
returns the last probed value either way, so a timeout still fails on the real assertion message.
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
satisfied with no compile dependency on an absent assembly (`IArchitectureMap.cs:3-7`).

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
the abstract `*TestsBase` classes under `Bases/` (`LayerDependencyTestsBase`,
`DomainPurityTestsBase`, `MicroserviceExtractionTestsBase`, `ModuleIsolationTestsBase`,
`PiiConventionTestsBase`, [`DependencyVersionTestsBase`](#dependencyversiontestsbase),
`IntegrationEventContractTestsBase`, `DataResidencyTestsBase`, `RawQueryableConventionTestsBase`,
and more), each exposing its rules as `[Fact]`s that a sealed per-repo subclass activates by
supplying its map. `AggregateConventionTestsBase` shows the shape in miniature: one abstract `Map`
property and one `[Fact]` per rule
(`MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:12-24`). The package ships
**100 test methods across 32 abstract `*TestsBase` classes, of which MMCA.Common's own build executes
78** (`MMCA.Common/FACTS.md:44-48`, a generated and CI-gated count: read it there rather than
restating it elsewhere).

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
silently emptying the scan. [`ModuleConformanceTestsBase<TModule>`](#moduleconformancetestsbasetmodule)
(`MMCA.Common.Testing.Architecture/Bases/ModuleConformanceTestsBase.cs:21`) pins the three-member
contract `ModuleLoader` actually registers on (`Name`, `Dependencies`, `RequiresDependencies`),
because drift in any of them does not throw, it silently reorders registration or swaps a real
service for a disabled stub (`ModuleConformanceTestsBase.cs:3-10`); it reads those members through
the `IModule` full name by reflection (`:24`) so the package stays free of the framework's
transitive graph and still dispatches to the interface's **default** implementations (`:12-17`).
[`BrandColorTokenTestsBase`](#brandcolortokentestsbase)
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
ceiling on Application-service constructors ([Rubric §1, SOLID]), with its own non-vacuity guard so
a scan that finds no services fails rather than passes
(`Bases/ConstructorDependencyCountTestsBase.cs:33-34`), and
[`ObservabilityConventionTestsBase`](#observabilityconventiontestsbase)
(`Bases/ObservabilityConventionTestsBase.cs:30`) pairs every SLO alert a consumer's
`infra/main.bicep` provisions with a same-severity triage section in its `infra/OPERATIONS.md`, in
both directions, with a minimum-spec floor so a drifted parse anchor fails loudly instead of passing
with zero discovered alerts (`Bases/ObservabilityConventionTestsBase.cs:6-13,39`, [Rubric §13,
Observability & Operability]). Sibling bases pin integration-event contracts
([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)),
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
is true (`TestPrincipal.cs:13-21`). `RenderMudProviders` (`BunitComponentTestBase.cs:83`) mounts the
popover, dialog, and snackbar providers and returns them as a [`MudProviderHandles`](#mudproviderhandles)
record (`BunitComponentTestBase.cs:92`) so components that open a dialog or raise a toast have
somewhere to render. The class is pinned to bUnit v2 (the line compatible with xUnit v3 and Microsoft
Testing Platform) and isolates every version-specific symbol here so a bUnit change touches only this
file (`BunitComponentTestBase.cs:25-31`). Localization is pre-registered (`AddLocalization`,
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
request as a [`CapturedRequest`](#capturedrequest) (`CapturingHttpMessageHandler.cs:129`) against a
registered [`Route`](#route) (`CapturingHttpMessageHandler.cs:110`).
[`UiHttpServiceHarness`](#uihttpserviceharness)
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
[`E2ETestCollection`](#e2etestcollection) definition sits beside it at `PlaywrightFixture.cs:47-51`)
that launches the engine selected from configuration, `chromium`, `firefox`, or `webkit`, with
unknown values falling back to Chromium (`PlaywrightFixture.cs:17-22`). That environment-selected
engine is what lets CI run the same suite as a cross-browser matrix, [Rubric §22,
Responsive/Cross-Browser]; in MMCA.Common's `ui-e2e` job all three engines are required merge gates
(`MMCA.Common/.github/workflows/ci.yml:237-240`). Headless mode, slow motion, base URL, timeouts,
trace capture, and the seeded admin/user credentials all come from
[`E2ETestConfiguration`](#e2etestconfiguration)
(`MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8`), whose nested
[`AdminCredentials`](#admincredentials) (`E2ETestConfiguration.cs:66`) and
[`UserCredentials`](#usercredentials) (`E2ETestConfiguration.cs:78`) let a downstream project set
app-specific defaults through a `[ModuleInitializer]` while environment variables always win. Two of
its knobs exist purely to de-flake CI: `AuthTimeout` (`E2ETestConfiguration.cs:27`) tunes the slowest
step, the post-auth round-trip, independently of the 30-second general default (`:18-19`), and
`AuthGraceTimeout` (`E2ETestConfiguration.cs:38`, default 15 seconds at `:39`) gives the success
signal a window to appear after a transient error alert flashes during the success-path reload.

[`E2ETestBase`](#e2etestbase) (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:8`) is the
per-test base on top of that fixture. It opens a fresh browser context per test with
`IgnoreHTTPSErrors` and the configured base URL (`E2ETestBase.cs:19-37`), optionally records a
Playwright trace (`:31-34`) and, when `E2E_TRACE` names a directory, keeps only the traces of tests
that failed so a full-suite run yields exactly the inspectable failures (`:63-89`, the failed-only
branch at `:78-84`). Its `LoginAsync` (`E2ETestBase.cs:97`) clears both token stores before signing
in (localStorage for the WASM host and the HttpOnly session cookie for the Server host, `:99-113`),
and `WaitForAuthResultAsync` (`:213`) races three signals so success detection does not depend on the
logout button having hydrated (`:222-225`, rationale at `:205-212`), treating only an error alert
still on the auth page after the grace window as a real failure (`:229-235`). `ScanAsync` (`:293`)
and `ScanGridAsync` (`:283`) wrap the accessibility gate for settled pages and for MudDataGrid list
pages respectively: the grid variant waits for a data row and for the loading bar to disappear before
scanning and applies the pager carve-out (`:285-288`), while the plain scan stays fully strict on
WCAG 2.1 AA (`:295-296`).

The hard part of Blazor E2E is timing, and [`PageExtensions`](#pageextensions)
(`MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:19`) is where that knowledge is
centralized, as C# `extension(IPage)` and `extension(ILocator)` blocks (`PageExtensions.cs:21,185`,
see [primer §4](00-primer.md#c-extensiont-types--read-this-once)). The app uses InteractiveAuto with
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
(`:207-215`), and `ClickAndVerifyAsync` (`:230`) and `ClickAndWaitForUrlAsync` (`:273`) retry a click
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
(`MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:20`) installs
`PerformanceObserver`-based Core Web Vitals capture (LCP, CLS, FCP, TTFB, INP) as an init script
before first paint (`InstallAsync`, `WebVitalsCollector.cs:40`, script at `:26-35`), reads the
accumulated values back as a [`WebVitalsSample`](#webvitalssample) (`CollectAsync`,
`WebVitalsCollector.cs:47,76`), and writes a citable JSON artifact under `WEB_VITALS_OUTPUT_DIR`
(`WriteArtifactAsync`, `WebVitalsCollector.cs:63`, artifact record
[`WebVitalsArtifact`](#webvitalsartifact) at `:90`) for CI, with
[`WebVitalsBudget`](#webvitalsbudget) (`:103`) as the shared assert mechanics defaulting to the Core
Web Vitals "good" band, LCP 2500 ms / FCP 1800 ms / TTFB 800 ms / CLS 0.1 / INP 500 ms
(`WebVitalsCollector.cs:104-108`), and skipping the INP assertion when no interaction cleared the
16 ms threshold (`:148-151`), [Rubric §23, Front-End Performance] (the source tags it rubric §12).
LCP and CLS are Chromium-only, so on Firefox and WebKit those fields stay 0 and the observers fail
silently rather than throwing (`WebVitalsCollector.cs:14-16,22-25`). The reusable identity page
objects [`LoginPage`](#loginpage) (`MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6`),
[`RegisterPage`](#registerpage) (`MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:6`), and
[`ProfilePage`](#profilepage) (`MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:6`) wrap the
framework's real auth surfaces with role- and label-based locators (`LoginPage.cs:12-18`) and route
their own fills through the anti-race helper (`LoginPage.cs:31-32`, invoked at `:25-26`); downstream
apps add their own family, for example the 41 `MMCA.ADC.E2E.Tests` page objects covering events,
sessions, speakers, rooms, questions, feedback, sponsors, and the QR check-in and points surfaces.
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
fast; the CI `ui-e2e` job builds that out-of-slnx graph directly by csproj path and runs the axe plus
render smoke against the gallery
(`MMCA.Common/.github/workflows/ci.yml:223-227,260-264,293-306`). Because the E2E suite self-hosts it
in-process, where the entry assembly is the test host and the environment is Production, the host
also has to point the static-web-assets loader at the gallery's own runtime manifest and force it on,
otherwise the auth pages render unstyled, never become interactive, and axe's contrast checks are
meaningless (`GalleryHost.cs:38-48`).

The host runs without a backend by registering stubs before `AddUIShared` so its `TryAdd*`
registrations defer to them (`GalleryHost.cs:55-63`): [`NoOpAuthUIService`](#noopauthuiservice)
(`MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:12`),
[`NullTokenStorageService`](#nulltokenstorageservice)
(`MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:10`),
[`NullTokenRefresher`](#nulltokenrefresher)
(`MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:9`), and
[`GalleryAuthenticationStateProvider`](#galleryauthenticationstateprovider)
(`MMCA.Common.UI.Gallery/Stubs/GalleryAuthenticationStateProvider.cs:16`), plus canned notification
services ([`StubNotificationInboxUIService`](#stubnotificationinboxuiservice)
(`Stubs/StubNotificationInboxUIService.cs:11`),
[`StubPushNotificationUIService`](#stubpushnotificationuiservice)
(`Stubs/StubPushNotificationUIService.cs:11`)) so the bell and the inbox render populated markup
(`GalleryHost.cs:78-80`), and one empty [`GalleryUIModule`](#galleryuimodule)
(`Stubs/GalleryUIModule.cs:13`, registered at `GalleryHost.cs:85`) so the shared Router discovers the
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

Three bases guard the composition of the pipeline itself.
[`DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult)
(`MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:36`) is the opt-in fitness function for
[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html): it builds a real
`ServiceCollection` through the repo's own registration sequence (`ConfigureServices`, `:44`),
resolves the decorated handlers, unwraps each decorator's private inner-handler field by reflection
so it verifies the constructed object graph rather than the registration list (`:98-118`), and asserts
the runtime nesting is exactly FeatureGate, Logging, Caching, Validating, Transactional, handler for
commands and FeatureGate, Logging, Caching, handler for queries
(`DecoratorPipelineOrderTestsBase.cs:47-62`, asserted by the two `[Fact]`s at `:64-70`, with a final
check that the innermost element is not itself a decorator at `:89-90`). Because Scrutor's
`TryDecorate` applies decorators in reverse registration order, an innocent-looking reorder of the
`AddApplicationDecorators()` lines silently changes runtime behavior, and this base turns that into a
test failure (see [group 5](group-05-cqrs-pipeline.md)).
[`DependencyInjectionAssert`](#dependencyinjectionassert)
(`MMCA.Common.Testing/DependencyInjectionAssert.cs:13`) guards the other half of that composition:
`ReturnsSameCollection` (`:21`) asserts a registration extension hands back the very
`IServiceCollection` it was given (`:29-31`), because an extension that returns a new collection
silently drops every registration chained after it and nothing else catches services that are simply
absent (`:6-11`). [`HandlerTestBase<THandler>`](#handlertestbasethandler)
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
for domain logic, bUnit for a component, an integration fixture for a full request path, a
cross-service fixture for a real broker round-trip, an E2E page object for a browser flow, a
`*TestsBase` subclass for an architectural invariant, a contract base for a runtime guarantee of the
composed host, a benchmark for an allocation budget), and the reusable base you need is already in
one of the four `MMCA.Common.Testing.*` packages. Adoption is opt-in per host in both governance
tiers, which is the standing caveat in ADR-015 and ADR-058 alike: the framework ships the gate, a
host gets it only once someone writes the subclass. Every remaining concrete test class is cataloged
by project in the companion per-project test rollup for this chapter.

### IFakeExportService
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:25` · Level 0 · interface
- **What it is** - a marker-only cross-module contract that exists purely as test data: it stands in for the kind of service one module exports and another module resolves, so the module-conformance base can be proven to reach a real DI container.
- **Depends on** - nothing. The whole declaration is `public interface IFakeExportService;` (`ModuleConformanceTestsBaseTests.cs:25`), a body-less interface using the semicolon form, with a one-line doc above it (`:24`).
- **Concept introduced** - *the cross-module export contract, in miniature.* Under the module system ([IModule](group-14-module-system-composition.md#imodule), [ModuleLoader](group-14-module-system-composition.md#moduleloader)), a module that is switched off in [ModulesSettings](group-14-module-system-composition.md#modulessettings) still has to leave behind stub registrations, otherwise every other module that resolves its exported interface fails to construct. `IFakeExportService` is the smallest possible stand-in for such an exported interface. [Rubric §14 - Testability] assesses whether a rule can be proven with focused inputs; a marker interface is the least amount of surface that still lets the fitness base observe a real `ServiceDescriptor`.
- **Walkthrough** - no members. Its only role is to be the `ServiceType` that [FakeDependentModule](#fakedependentmodule) registers a stub against (`:44`) and that [FakeDependentModuleConformanceTests](#fakedependentmoduleconformancetests) looks up in the built collection (`:74`).
- **Why it's built this way** - a real cross-module contract would drag a module's whole application surface into the framework's architecture-test assembly. A local marker keeps the fixture self-contained, which is the same discipline the rule library itself follows (it matches framework types by full name rather than referencing them).
- **Where it's used** - implemented by [DisabledFakeExportService](#disabledfakeexportservice) and registered by [FakeDependentModule](#fakedependentmodule).

### DisabledFakeExportService
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:28` · Level 1 · class
- **What it is** - the stub implementation a disabled [FakeDependentModule](#fakedependentmodule) leaves behind, so the fixture models the real "module off, contract still resolvable" behavior rather than describing it.
- **Depends on** - [IFakeExportService](#ifakeexportservice) (`public sealed class DisabledFakeExportService : IFakeExportService;`, `ModuleConformanceTestsBaseTests.cs:28`).
- **Concept** - cross-references the disabled-stub concept introduced by [IFakeExportService](#ifakeexportservice). The pairing matters: a stub type distinct from the real implementation is what lets an assertion prove *which* implementation the container holds, not merely that the service type is registered.
- **Walkthrough** - no members; a body-less sealed class with its doc comment at `:27`. It is the exact type [FakeDependentModuleConformanceTests](#fakedependentmoduleconformancetests) asserts on via `descriptor.ImplementationType.Should().Be<DisabledFakeExportService>()` (`:76`).
- **Where it's used** - registered as a singleton by `FakeDependentModule.RegisterDisabledStubs` (`:43`-`:44`).

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

### FakeDependentModule
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:31` · Level 3 · class
- **What it is** - the "hard" module fixture: a module that declares dependencies, refuses to start without them, and exports a disabled stub. It exercises every member of the module contract that a leaf module leaves at its default.
- **Depends on** - [IModule](group-14-module-system-composition.md#imodule) (`public sealed class FakeDependentModule : IModule`, `ModuleConformanceTestsBaseTests.cs:31`), [ApplicationSettings](group-14-module-system-composition.md#applicationsettings) (the `Register` parameter, `:39`), [IFakeExportService](#ifakeexportservice) / [DisabledFakeExportService](#disabledfakeexportservice) (the stub pair, `:44`), plus `IServiceCollection` and `IConfigurationBuilder` from `Microsoft.Extensions.*` (`ModuleConformanceTestsBaseTests.cs:1`-`:2`).
- **Concept introduced** - *the full module contract as a testable surface.* [IModule](group-14-module-system-composition.md#imodule) has five members, three of which are defaulted (`Dependencies => []`, `RequiresDependencies => false`, `RegisterDisabledStubs` as an empty body, `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/IModule.cs:17`,`:23`,`:34`), so the entire contract [ModuleLoader](group-14-module-system-composition.md#moduleloader) registers on can be silently wrong without a compile error. This fixture is the one that overrides all three, so the conformance base is exercised against real (not defaulted) values. [Rubric §14 - Testability] covers the fixture role; [Rubric §7 - Microservices Readiness] is what the stub half protects, a module that can be switched off without breaking the modules that import its contract is a module that can also be extracted.
- **Walkthrough**
  - `Name => "FakeDependent"` (`:33`): the key [ModulesSettings](group-14-module-system-composition.md#modulessettings) entries and other modules' dependency lists match on.
  - `Dependencies => ["FakeLeaf", "FakeOther"]` (`:35`): two entries, one of which ([FakeLeafModule](#fakeleafmodule)) exists in the fixture set and one of which deliberately does not, so the list is a pure data declaration rather than a resolvable graph.
  - `RequiresDependencies => true` (`:37`): the flag that turns a disabled dependency into a startup failure instead of a substituted stub.
  - `Register(...)` (`:39`-`:41`): an empty body. Registration behavior is not what the conformance base asserts, so the fixture spends nothing on it.
  - `RegisterDisabledStubs(IServiceCollection services)` (`:43`-`:44`): a single expression-bodied `services.AddSingleton<IFakeExportService, DisabledFakeExportService>()`, which is the only member with observable behavior and the one [FakeDependentModuleConformanceTests](#fakedependentmoduleconformancetests) inspects.
- **Why it's built this way** - the doc comment (`:30`) names the intent: this is the shape of the two real consumer modules that are not leaves (Store Sales, ADC Notification). Modeling them locally means the shared base is proven against both module shapes inside MMCA.Common's own CI, before any consumer sees it ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)).
- **Where it's used** - the `TModule` of [FakeDependentModuleConformanceTests](#fakedependentmoduleconformancetests) (`:60`) and of the deliberately-drifted [DriftedTests](#driftedtests) (`:131`).

### FakeLeafModule
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:15` · Level 3 · class
- **What it is** - the minimal module fixture: `Name` plus an empty `Register`, and nothing else. Its whole purpose is to *not* override `Dependencies` or `RequiresDependencies`, so the conformance base has to reach the interface's default implementations to read them.
- **Depends on** - [IModule](group-14-module-system-composition.md#imodule) (`public sealed class FakeLeafModule : IModule`, `ModuleConformanceTestsBaseTests.cs:15`) and [ApplicationSettings](group-14-module-system-composition.md#applicationsettings) (the `Register` parameter, `:19`).
- **Concept introduced** - *default interface implementations are only reachable through the interface.* A default member declared on `IModule` (`IModule.cs:17`,`:23`) does not exist on the concrete class, so `module.Dependencies` will not compile against `FakeLeafModule` and a reflection lookup on the concrete type finds nothing. The shared base solves this by locating the `IModule` interface by full name and reading the property off *the interface* (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleConformanceTestsBase.cs:85`-`:99`), which dispatches to the override when there is one and to the framework default when there is not. Before the base existed, the hand-written consumer tests needed an explicit `(IModule)` cast to get the same reach (class doc, `:9`-`:14`). [Rubric §14 - Testability] and [Rubric §1 - SOLID] both apply: the fixture exists so the base's interface-dispatch contract is provable rather than assumed.
- **Walkthrough** - `Name => "FakeLeaf"` (`:17`) and an empty `Register(...)` (`:19`-`:21`). That is the entire type; the absence of members is the fixture.
- **Why it's built this way** - this is the exact shape the three byte-identical consumer `{X}ModuleTests` files collapse into (class doc, `:12`-`:13`), so the leaf path is the most-travelled one and the one whose silent breakage would be widest.
- **Where it's used** - the `TModule` of [FakeLeafModuleConformanceTests](#fakeleafmoduleconformancetests) (`:51`), which in turn is driven directly by two of [ModuleConformanceTestsBaseTests](#moduleconformancetestsbasetests)'s facts (`:113`-`:129`).

### DriftedTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:131` · Level 4 · class
- **What it is** - the adversarial fixture: a conformance subclass whose three expectations are all deliberately wrong for the module it points at, so the base's assertions can be proven to actually fail on drift instead of passing regardless.
- **Depends on** - [ModuleConformanceTestsBase<TModule>](#moduleconformancetestsbasetmodule) (`private sealed class DriftedTests : ModuleConformanceTestsBase<FakeDependentModule>`, `ModuleConformanceTestsBaseTests.cs:131`) and [FakeDependentModule](#fakedependentmodule) (the module under test).
- **Concept introduced** - *negative fixtures, and hiding them from test discovery.* A fitness base that asserts nothing passes everywhere; the only way to know an assertion bites is to feed it a case that must fail. But a public subclass of an xUnit base is itself collected: its inherited `[Fact]`s would run and report as three red tests. Declaring the drifted subclass `private` (nested inside [ModuleConformanceTestsBaseTests](#moduleconformancetestsbasetests)) keeps xUnit from collecting it, while the enclosing class can still instantiate it and invoke the inherited methods directly as delegates. [Rubric §14 - Testability] assesses whether the guardrails themselves are trustworthy; this is the fixture that earns that trust. Compare [NavigatingSpec](#navigatingspec), the same negative-fixture technique applied to a specification rule.
- **Walkthrough** - three overrides, one per assertion the base makes: `ExpectedName => "NotTheDeclaredName"` (`:133`) against a module that declares `"FakeDependent"`; `ExpectedDependencies => ["FakeLeaf"]` (`:135`), dropping `"FakeOther"` so the base's `BeEquivalentTo` comparison must fail on a missing entry; and `ExpectedRequiresDependencies => false` (`:137`) against a module that declares `true`. It supplies no `AssertDisabledStubs` override, because the stub hook is not one of the assertions under adversarial test here.
- **Why it's built this way** - each drift is the exact production failure the base's `because:` reasons describe (`ModuleConformanceTestsBase.cs:42`,`:54`,`:61`): a renamed module silently drops out of its own configuration and out of other modules' graphs, a missing dependency entry lets a module register before the services it consumes, and a flipped `RequiresDependencies` swaps a hard start failure for a silently substituted stub. Pinning one fixture per failure keeps the three adversarial facts independent.
- **Where it's used** - instantiated three times inside [ModuleConformanceTestsBaseTests](#moduleconformancetestsbasetests) (`:91`,`:99`,`:107`), once per assertion being proven fatal.

### FakeDependentModuleConformanceTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:60` · Level 4 · class
- **What it is** - the positive conformance run for the non-leaf module shape: it points the shared base at [FakeDependentModule](#fakedependentmodule), states all three expectations, and supplies the one override that turns the disabled-stub hook from vacuous into an actual container assertion.
- **Depends on** - [ModuleConformanceTestsBase<TModule>](#moduleconformancetestsbasetmodule) (`ModuleConformanceTestsBaseTests.cs:60`), [FakeDependentModule](#fakedependentmodule), [IFakeExportService](#ifakeexportservice), [DisabledFakeExportService](#disabledfakeexportservice), plus `Microsoft.Extensions.DependencyInjection`'s `ServiceCollection`/`ServiceLifetime` and AwesomeAssertions.
- **Concept introduced** - *asserting a registration by its descriptor rather than by resolving it.* Instead of building a provider and resolving the service (which would need every constructor dependency to be satisfiable), the override inspects the `ServiceDescriptor` the module put in the collection: service type, implementation type, and lifetime. That is the whole of what `RegisterDisabledStubs` is contractually responsible for. [Rubric §7 - Microservices Readiness] is the payoff: the stub is what keeps a cross-module contract resolvable while its owning module is off, which is the same substitutability an extracted service relies on ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
- **Walkthrough**
  - `ExpectedName => "FakeDependent"` (`:62`).
  - `ExpectedDependencies => ["FakeOther", "FakeLeaf"]` (`:64`): note the order is deliberately the reverse of the module's own declaration (`:35`). The base compares with `BeEquivalentTo` (`ModuleConformanceTestsBase.cs:52`-`:54`), which is order-insensitive, so this fixture doubles as proof that a subclass is not accidentally pinned to declaration order.
  - `ExpectedRequiresDependencies => true` (`:66`).
  - `AssertDisabledStubs(FakeDependentModule module)` (`:68`-`:78`): builds a bare `ServiceCollection` (`:70`), calls `module.RegisterDisabledStubs(services)` (`:72`), pulls the single descriptor whose `ServiceType` is `IFakeExportService` via `SingleOrDefault` (`:74`, so a duplicate registration also fails), then asserts it is non-null (`:75`), that its `ImplementationType` is `DisabledFakeExportService` (`:76`), and that its `Lifetime` is `Singleton` (`:77`).
- **Why it's built this way** - the class doc (`:56`-`:59`) states the target shape: this mirrors the two real consumer subclasses that are not leaves (Store Sales, ADC Notification). Keeping a copy inside MMCA.Common's own suite means a change to the shared base is caught here rather than in a downstream repo after a release.
- **Where it's used** - collected directly by xUnit (it is `public sealed`, so its four inherited `[Fact]`s run as ordinary tests).

### FakeLeafModuleConformanceTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:51` · Level 4 · class
- **What it is** - the positive conformance run for the leaf module shape, and the smallest legal subclass of the shared base: one property override and nothing else.
- **Depends on** - [ModuleConformanceTestsBase<TModule>](#moduleconformancetestsbasetmodule) (`public sealed class FakeLeafModuleConformanceTests : ModuleConformanceTestsBase<FakeLeafModule>`, `ModuleConformanceTestsBaseTests.cs:51`) and [FakeLeafModule](#fakeleafmodule).
- **Concept** - cross-references the thin-subclass fitness pattern introduced by [DependencyVersionTests](#dependencyversiontests): the rule body lives once in the shipped `MMCA.Common.Testing.Architecture` package and each adopter contributes only its expectations. Here the adopter contributes exactly one line, because everything else is a framework default that the base reads through the interface. [Rubric §16 - Maintainability] is the concrete win recorded in the class doc (`:47`-`:50`): the three byte-identical consumer `{X}ModuleTests` files collapse into this shape.
- **Walkthrough** - `ExpectedName => "FakeLeaf"` (`:53`). Everything else is inherited: `ExpectedDependencies` defaults to `[]` and `ExpectedRequiresDependencies` to `false` (`ModuleConformanceTestsBase.cs:30`,`:36`), which is what makes the leaf case a check that the base reaches `IModule`'s own defaults rather than a check of the subclass's restatement of them.
- **Why it's built this way** - a leaf module is the common case, so the common case must be the cheapest to adopt. One override also keeps the fixture honest: any additional override here would hide the default-dispatch behavior the sibling facts are trying to prove.
- **Where it's used** - collected by xUnit for its four inherited `[Fact]`s, and driven directly (as a plain object) by two facts of [ModuleConformanceTestsBaseTests](#moduleconformancetestsbasetests): `Base_ReadsDefaultInterfaceImplementations_ForALeafModule` (`:113`-`:121`) and `Base_DisabledStubHook_IsVacuous_ByDefault` (`:123`-`:129`).

### FitnessPrincipal
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:43` · Level 4 · class
- **What it is** - a throwaway "principal" entity used only as test data for the specification-navigation fitness function. It is the entity that a dependent record points at, so a specification can be written that tries to reach across the navigation into it.
- **Depends on** - [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (it is a `public sealed class FitnessPrincipal : AuditableBaseEntity<int>`, `SpecificationFitnessTests.cs:43`).
- **Concept introduced** - *test fixture entities for a fitness function.* A fitness function is an executable architecture rule (see [ArchitectureRules](#architecturerules)); to prove such a rule actually fires you feed it a deliberately-crafted model rather than the real domain. `FitnessPrincipal` is one half of that crafted model: a bare entity carrying a single scalar (`IsActive`, `SpecificationFitnessTests.cs:45`) so a specification can navigate to it. [Rubric §14 - Testability] assesses whether rules are provable with focused inputs; this fixture exists precisely so the guard is tested against a known-unsafe shape instead of hoping a real specification trips it.
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
- **Caveats / not-in-source** - the class's own doc comment (`DependencyVersionTests.cs:5`-`:8`) still describes only the MassTransit trap; the ImageSharp ceiling arrived later on the base and the subclass doc was not extended. The behavior is the base's two facts, not the comment.

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
- **Walkthrough** - two members. `RequiredCultures` (`:14`-`:17`) filters `SupportedCultures.All` to the non-default entries; the allowlist is `[Default, "es"]` with `Default = "en-US"` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:12`,`:18`), so the required set is today exactly `es`. `MinimumBaseResources => 3` (`:21`) sets a non-vacuous floor: the scan must find at least three base resources (ErrorResources for the API, plus SharedResource and MudTranslations for the UI), so a wrong scan root or repo re-layout cannot let the gate pass having checked nothing. The base's default for that floor is zero, which skips the guard entirely (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:21`), so overriding it here is what makes the gate honest. The single inherited `[Fact]` is `Translations_AreComplete_ForEveryRequiredCulture` (`LocalizationResourceTestsBase.cs:23`-`:25`).
- **Why it's built this way** - [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (localization) requires supported cultures to be fully translated; the derived allowlist plus the minimum-count floor turn that into a self-maintaining CI gate. The pseudo-locale `qps-Ploc` is deliberately kept out of `SupportedCultures.All` (`SupportedCultures.cs:20`-`:28`) precisely so this gate does not demand a `.qps-Ploc.resx` sibling.
- **Where it's used** - run by the `MMCA.Common.Architecture.Tests` suite.

### ModuleConformanceTestsBaseTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:86` · Level 5 · class
- **What it is** - the meta-test for the shipped per-module conformance base: five facts that prove each of the base's assertions actually fails on the drift it claims to catch, that the base reaches `IModule`'s default implementations for a leaf module, and that its disabled-stub hook is harmlessly vacuous when a subclass does not override it.
- **Depends on** - [ModuleConformanceTestsBase<TModule>](#moduleconformancetestsbasetmodule) (the type under test), its own fixtures [DriftedTests](#driftedtests), [FakeLeafModuleConformanceTests](#fakeleafmoduleconformancetests), [FakeLeafModule](#fakeleafmodule) and [FakeDependentModule](#fakedependentmodule), plus xUnit `[Fact]` and AwesomeAssertions' `Should().Throw<Exception>()` / `NotThrow()` delegate assertions.
- **Concept introduced** - *testing a shipped test base, from the outside, by invoking its facts as delegates.* The base lives in the `MMCA.Common.Testing.Architecture` package and is consumed by five subclasses across MMCA.ADC and MMCA.Store, so a regression in it would surface as *green* consumer suites that assert nothing. This class converts each inherited `[Fact]` into a method group (`var assert = new DriftedTests().Module_ShouldDeclare_ExpectedName;`, `:91`) and asserts on the delegate's behavior, which is what lets one xUnit test observe another test method failing. [Rubric §14 - Testability] assesses whether guardrails are themselves trustworthy; [Rubric §34 - Architecture Governance & Documentation] is the reason the guardrail exists at all ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) makes module conformance build-gating); and [Rubric §33 - Developer Experience] covers the failure mode being prevented, a silent break that would only appear in a downstream repo after a release ([ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html)).
- **Walkthrough**
  - Three adversarial facts, one per assertion the base makes, each pointing at [DriftedTests](#driftedtests) and asserting the delegate throws: `Base_Fails_WhenTheNameDrifts` (`:88`-`:94`), `Base_Fails_WhenADependencyIsMissing` (`:96`-`:102`), and `Base_Fails_WhenRequiresDependenciesDrifts` (`:104`-`:110`).
  - `Base_ReadsDefaultInterfaceImplementations_ForALeafModule` (`:112`-`:121`): instantiates [FakeLeafModuleConformanceTests](#fakeleafmoduleconformancetests) and *calls* the two inherited assertions directly (`:119`-`:120`). Passing proves the base reached `IModule`'s defaults, because the leaf fixture declares neither member (inline comment, `:115`-`:116`).
  - `Base_DisabledStubHook_IsVacuous_ByDefault` (`:123`-`:129`): asserts the fourth inherited fact does *not* throw for a module that exports nothing, so a leaf subclass never has to override `AssertDisabledStubs` (the base's default is an empty body, `ModuleConformanceTestsBase.cs:77`-`:79`).
  - The nested `private sealed class DriftedTests` (`:131`-`:138`) closes the file; being private is what keeps xUnit from collecting its three deliberately-failing inherited facts as tests of their own (class doc, `:81`-`:85`).
- **Why it's built this way** - the three module members the base asserts on are the entire contract [ModuleLoader](group-14-module-system-composition.md#moduleloader) registers on (`ModuleConformanceTestsBase.cs:4`-`:10`): it topologically orders on `Dependencies`, matches [ModulesSettings](group-14-module-system-composition.md#modulessettings) entries by `Name`, and chooses between a hard start failure and stub registration from `RequiresDependencies`. None of those drifts throws at build time, so the fitness base is the only guard, and this class is the guard on the guard.
- **Where it's used** - an independent class in the Common architecture suite. The base it protects is subclassed by five real module tests: `MMCA.ADC/Tests/Modules/Notification/MMCA.ADC.Notification.API.Tests/NotificationModuleTests.cs:8`, `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.API.Tests/IdentityModuleTests.cs:5`, `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.API.Tests/SalesModuleTests.cs:5`, `MMCA.Store/Tests/Modules/Identity/MMCA.Store.Identity.API.Tests/IdentityModuleTests.cs:5`, and `MMCA.Store/Tests/Modules/Catalog/MMCA.Store.Catalog.API.Tests/CatalogModuleTests.cs:5`.
- **Caveats / not-in-source** - the three adversarial facts assert only that *an* exception is thrown (`Should().Throw<Exception>()`, `:93`,`:101`,`:109`), not which assertion produced it or what its message says. They prove the base is not vacuous; they do not pin its failure text.

### NavigatingSpec
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:49` · Level 6 · class
- **What it is** - the deliberately-unsafe fixture specification: its `Criteria` navigates from the dependent into a related entity, the exact pattern the fitness function must flag.
- **Depends on** - [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (`private sealed class NavigatingSpec : Specification<FitnessDependent, int>`, `SpecificationFitnessTests.cs:49`) and [FitnessDependent](#fitnessdependent)/[FitnessPrincipal](#fitnessprincipal) (the entities it filters over).
- **Concept introduced** - *why cross-entity navigation in a specification is unsafe across data sources.* Under database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), a `d => d.Principal!.IsActive` predicate (`:51`) assumes the related entity lives in the same queryable model; once the principal is extracted to another physical source, that navigation cannot translate to SQL (and on Cosmos the cross-source navigation is degraded out of the model entirely, `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:9`-`:15`). The fitness function `SpecificationsDoNotNavigateToOtherEntities` treats it as a violation. [Rubric §7 - Microservices Readiness] assesses whether the code stays extractable; this fixture is the negative example that proves the readiness guard fires.
- **Walkthrough** - one member, an overridden `Criteria` expression that dereferences the `Principal` navigation (`:51`). Being parameterless matters: the rule only instantiates and inspects specifications that expose a parameterless constructor (`ArchitectureRules.Specifications.cs:37`-`:41`), so a fixture with constructor dependencies would be skipped and prove nothing. The test asserts the rule's exception message contains this type's name.
- **Where it's used** - the "should be flagged" input to [SpecificationFitnessTests](#specificationfitnesstests); paired with [ScalarOnlySpec](#scalaronlyspec).

### PiiErasureContractFitnessTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19` · Level 6 · class
- **What it is** - a non-vacuous §30 fitness test that pushes a representative `[Pii]` data subject through the framework's own privacy machinery, proving that PII detection, redaction/masking, and in-place erasure compose end to end rather than each being verified in isolation.
- **Depends on** - [DataSubjectSample](#datasubjectsample) (the fixture), [PiiRedactor](group-02-domain-building-blocks.md#piiredactor), [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable), and [Result](group-01-result-error-handling.md#result). Externals: xUnit `[Fact]`, AwesomeAssertions.
- **Concept introduced** - *a contract-composition fitness function.* Where [PiiConventionTests](#piiconventiontests) is a structural scan (does every `[Pii]` type also implement `IAnonymizable`), this test exercises the *behavior* the scan presumes. It is the pattern for proving a cross-cutting compliance contract actually holds when its parts run together. [Rubric §30 - Compliance/Privacy/Data Governance] assesses that erasure and log-masking genuinely protect subject data; this test is the framework's executable evidence.
- **Walkthrough** - four `[Fact]`s, each isolating one link in the contract. `DataSubject_DeclaresPii_SoTheContractIsNotVacuous` (`:21`-`:24`) asserts `PiiRedactor.HasPii` recognizes the sample, so the later guards assert against something real. `PiiRedactor_MasksEveryPiiMember_AndPassesThroughNonPii` (`:26`-`:35`) redacts an instance and checks `Email`/`FullName` become `PiiRedactor.RedactedToken` while `Id`/`City` pass through unchanged (`:31`-`:34`). `PiiRedactor_LeaksNoClearTextPii_ToLogsOrTelemetry` (`:37`-`:50`) verifies neither the redacted dictionary values (`:42`-`:44`) nor `RedactToString` output (`:46`-`:49`) contain the original email or name, covering both the structured-log and the flat-string rendering paths. The fourth fact (`:52`-`:72`) asserts the sample is `IAnonymizable` (`:56`), that `Anonymize()` succeeds and changes the PII fields (`:59`-`:62`), that a second call also succeeds and leaves the fields erased (idempotence, `:64`-`:66`, [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)), and finally that an anonymized subject *still* leaks no original clear text when redacted (`:69`-`:71`), proving erasure and redaction compose.
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
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (`internal sealed class CommonArchitectureMap : ArchitectureMapBase`, `CommonArchitectureMap.cs:15`), the [Layer](#layer) enum, [LayerRef](#layerref), and one anchor type per package (`Result`, `BaseEntity<>`, `DomainEventDispatcher`, `ApplicationDbContext`, `ApiControllerBase`, `ResultGrpcExtensions`, `UISharedAssemblyReference`, `CommonArchitectureMap.cs:21`-`:27`).
- **Concept introduced** - *the map as the single point of repo-specific truth for architecture rules.* The rule bodies live once in `MMCA.Common.Testing.Architecture` and are parameterized by an [IArchitectureMap](#iarchitecturemap); each repo supplies exactly one map so the same rules run identically across Common, Store, and ADC. Because Common is a module-less framework, every layer is registered as a *framework* layer via the `Framework(...)` helper rather than a module layer. [Rubric §3 - Clean Architecture] assesses whether layer boundaries are explicit and enforced; this map is the machine-readable statement of those boundaries.
- **Walkthrough** - `RepoToken => "MMCA.Common"` (`:17`) identifies the repo and is what the source-scanning rules use to locate the repo root (they look for `{RepoToken}.slnx`). `DefineLayers()` (`:19`-`:28`) returns one `Framework(Layer.X, anchorType.Assembly)` entry per package, using a single anchor type to resolve each assembly (mirrors the old `PackageAssemblies` helper): Shared, Domain, Application, Infrastructure, Api, Grpc, and Ui (`:21`-`:27`). The doc comment (`:8`-`:13`) records a deliberate omission: `MMCA.Common.UI.Maui` ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)) is absent because its four MAUI TFM assemblies cannot load in the ubuntu net10.0 test process, so its UI+Shared boundary is enforced at compile time by `EnforceUIMauiLayerBoundary` in `Source/Build/MMCA.Common.LayerEnforcement.targets` and the windows `build-maui` CI job instead.
- **Why it's built this way** - one map per repo keeps the rule bodies DRY and identical everywhere (see the "Architecture Enforcement" section in `MMCA.Common/CLAUDE.md`); anchoring by type keeps the assembly reference refactor-safe.
- **Where it's used** - supplied as `Map` by nearly every `*ConventionTests`/`*DependencyTests` subclass in this unit, and is the pattern [SpecTestMap](#spectestmap) collapses to a single layer.

### FrameworkSanityTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:13` · Level 7 · class
- **What it is** - the home for the few architecture checks that are Common-only and do not generalize into the shared rule library: the `MMCA.Common.Grpc` transport boundary and the placement of the `IMessageBus`, `IJwksProvider`, and `ILiveChannelPublisher` abstractions.
- **Depends on** - [IMessageBus](group-04-events-outbox.md#imessagebus), [IJwksProvider](group-08-auth.md#ijwksprovider), [ILiveChannelPublisher](group-10-notifications.md#ilivechannelpublisher), and the NetArchTest `Types` query API routed through [ArchitectureAssert](#architectureassert).
- **Concept introduced** - *repo-specific sanity next to the shared library.* Not every rule fits the parameterized base classes; some assert facts true only of the framework repo. Keeping them in one explicitly-named class documents the boundary between "shared rule applied here" and "Common-only invariant." [Rubric §7 - Microservices Readiness] (transport isolation) and [Rubric §3 - Clean Architecture] (abstraction placement) both apply: gRPC is pure transport and must not couple to Domain/Application/Infrastructure, and the cross-cutting abstractions must sit in the layer their consumers depend on.
- **Walkthrough** - three private static `Assembly` accessors anchor the Grpc, Application, and Infrastructure assemblies by an anchor type each (`:15`-`:19`). Three `[Fact]`s assert `MMCA.Common.Grpc` has no dependency on Domain, Application, or Infrastructure (`:21`-`:34`) via the `AssertNoDependency` helper (`:51`-`:59`), which runs a `Types.InAssembly(...).ShouldNot().HaveDependencyOnAny(...)` NetArchTest query and routes the result through `ArchitectureAssert.NoViolations` (`:58`). Three more `[Fact]`s assert placement by comparing the abstraction's declaring assembly against the anchored layer assembly: `IMessageBus` lives in Application (`:36`-`:39`), `IJwksProvider` in Infrastructure because it handles crypto/PEM material (`:41`-`:44`), and `ILiveChannelPublisher` in Application beside `IPushNotificationSender` (`:46`-`:49`).
- **Why it's built this way** - the message-bus abstraction must stay in Application so application code depends on transport through it (extraction boundary, [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)); the JWKS provider is crypto and belongs in Infrastructure ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). These are load-bearing placements, so they get their own asserted facts.
- **Where it's used** - an independent class in the Common architecture suite; it has no counterpart in Store/ADC because only Common owns the Grpc package and defines these abstractions.

### SpecificationFitnessTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:13` · Level 7 · class
- **What it is** - the test that verifies the `SpecificationsDoNotNavigateToOtherEntities` fitness function actually discriminates: it must flag a specification that navigates into another entity and must leave a scalar-only specification alone.
- **Depends on** - [ArchitectureRules](#architecturerules) (the rule under test), and its own nested fixtures [SpecTestMap](#spectestmap), [FitnessDependent](#fitnessdependent), [FitnessPrincipal](#fitnessprincipal), [NavigatingSpec](#navigatingspec), [ScalarOnlySpec](#scalaronlyspec).
- **Concept introduced** - *testing the test: verifying a fitness function is neither vacuous nor over-broad.* A rule that never fires is useless; a rule that flags everything is worse. This class proves the specification-navigation guard does exactly one thing by feeding it both a positive and a negative fixture in a single run. [Rubric §14 - Testability] assesses whether the guardrails themselves are trustworthy; this is the meta-test that earns that trust, and [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) is the decision that makes such guardrails build-gating in the first place. Compare [ModuleConformanceTestsBaseTests](#moduleconformancetestsbasetests), which applies the same discipline to the module-conformance base.
- **Walkthrough** - one `[Fact]`, `Rule_FlagsNavigatingSpecification_ButNotScalarSpecification` (`:15`-`:24`). It wraps the rule call in an `act` delegate, `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities(new SpecTestMap())` (`:18`), captures the thrown exception through `Should().Throw<Exception>().Which` (`:20`), and asserts its message contains `NavigatingSpec` and the word "navigates" while *not* containing `ScalarOnlySpec` (`:21`-`:23`). Both halves matter: the first two assertions prove the rule fires, the third proves it does not over-report. The nested types below the fact supply the model: `SpecTestMap` (`:26`), the two entities (`:34`,`:43`), and the two specifications (`:49`,`:55`).
- **Why it's built this way** - the navigation rule protects future extraction (a navigating specification cannot cross a data-source boundary, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)); a discriminating test keeps the rule honest as it evolves.
- **Where it's used** - an independent class in the Common architecture suite.

### SpecTestMap
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:26` · Level 7 · class
- **What it is** - a minimal architecture map used only by [SpecificationFitnessTests](#specificationfitnesstests): it registers this test assembly as the single Application layer so the specification-navigation rule has a model to scan.
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (`private sealed class SpecTestMap : ArchitectureMapBase`, `SpecificationFitnessTests.cs:26`), the [Layer](#layer) enum, and [LayerRef](#layerref).
- **Concept introduced** - cross-references the map concept from [CommonArchitectureMap](#commonarchitecturemap). Where the real map spans seven packages, this one collapses to a single self-referential Application layer (`Framework(Layer.Application, typeof(SpecificationFitnessTests).Assembly)`, `:31`) because the fixtures (the two specifications and two entities) live in the test assembly itself. It is the smallest map that lets a fitness function run against hand-crafted types; the rule scans Application and Domain layers for specification subclasses (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:30`-`:33`), so one Application entry is enough.
- **Walkthrough** - `RepoToken => "MMCA.Common"` (`:28`) and a one-entry `DefineLayers()` (`:30`-`:31`) pointing at this assembly.
- **Where it's used** - instantiated once inside [SpecificationFitnessTests](#specificationfitnesstests)'s single fact.

### AggregateConventionTests, DomainPurityTests, EventVersioningConventionTests, HandlerResultConventionTests, LayerDependencyTests, LocalizedTextConventionTests, MicroserviceExtractionTests, PiiConventionTests, RawQueryableConventionTests, SliceCohesionTests, StateManagementConventionTests, UIArchitectureConventionTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · (see per-type table) · Level 8 · class

These twelve sealed classes share one shape: each is a **thin subclass of a shared `*TestsBase` rule** from the `MMCA.Common.Testing.Architecture` package, supplying the repo's [CommonArchitectureMap](#commonarchitecturemap) (and, for a few, one extra override) so the same rule body runs identically across MMCA.Common, MMCA.Store, and MMCA.ADC. This is the [Rubric §34 - Architecture Governance & Documentation] and [Rubric §14 - Testability] story: architecture conventions are executable and enforced in CI rather than left to review, and the rule logic lives in exactly one place ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)). See the thin-subclass pattern introduced by [DependencyVersionTests](#dependencyversiontests). The canonical body of each rule is the corresponding `*TestsBase`; these subclasses only wire in the map and any repo-specific floor or allowlist. Each fails the `build-and-test` CI job on violation, and several are deliberately *vacuous today* (they assert nothing until the framework grows a type that could break the convention, at which point they fire).

| Type | File:Line | Base rule | What it enforces / what differs |
|------|-----------|-----------|----------------------------------|
| `AggregateConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9` | [AggregateConventionTestsBase](#aggregateconventiontestsbase) | DDD aggregate-root factory rules for the framework's own aggregates: Domain exposes aggregate roots, each has a `Result<T>`-returning static `Create` factory and no public constructor. The minimal variant for repos with no business modules; module-bearing repos use the fuller [EntityConventionTestsBase](#entityconventiontestsbase). Supplies only `Map` (`:11`). [Rubric §4 - DDD.] |
| `DomainPurityTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9` | [DomainPurityTestsBase](#domainpuritytestsbase) | Domain and Shared stay framework-free, and Application stays host-agnostic (no EF Core, no ASP.NET Core). Supplies only `Map` (`:11`); the base's extra-forbidden-dependency hook (used by Store for "Stripe", ADC for "RabbitMQ") stays empty here. [Rubric §3 - Clean Architecture.] |
| `EventVersioningConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/EventVersioningConventionTests.cs:10` | [EventConventionTestsBase](#eventconventiontestsbase) | Every integration event declares a `SchemaVersion`, inherits `BaseIntegrationEvent`, and lives in an `*.IntegrationEvents` namespace in Shared ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)). Supplies only `Map` (`:12`). Vacuous today: the framework ships no concrete integration event (`EventVersioningConventionTests.cs:7`-`:8`). [Rubric §6 - CQRS & Event-Driven.] |
| `HandlerResultConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/HandlerResultConventionTests.cs:12` | [HandlerResultConventionTestsBase](#handlerresultconventiontestsbase) | Every concrete command/query handler's `TResult` must be `Result` or `Result<T>`, the constraint the decorator pipeline otherwise only enforces at runtime when `ResultFailureFactory` throws on a short-circuit (`:9`-`:10`); scans the framework's Notifications handlers. Supplies only `Map` (`:14`). [Rubric §6 - CQRS & Event-Driven.] |
| `LayerDependencyTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9` | [LayerDependencyTestsBase](#layerdependencytestsbase) | Clean Architecture layer-flow for the framework packages: Domain, Application, Infrastructure, Shared, and Ui each reference only what they may, plus map-completeness facts requiring the core layers to be declared. Supplies only `Map` (`:11`), so the base's default required-layer set applies. [Rubric §3 - Clean Architecture.] |
| `LocalizedTextConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizedTextConventionTests.cs:11` | [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase) | Shared `MMCA.Common.UI` ships no hard-coded user-visible literals: snackbar messages, page titles, `<PageTitle>` markup, and breadcrumb labels must resolve through `IStringLocalizer` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). Supplies `Map` (`:13`) and also overrides `MinimumScannedFiles => 20` (`:16`), a floor that catches a wrong scan root. [Rubric §27 - i18n.] |
| `MicroserviceExtractionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10` | [MicroserviceExtractionTestsBase](#microserviceextractiontestsbase) | Domain/Application/Shared stay free of MassTransit/Grpc/Protobuf, so a module behaves identically in-process or extracted ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)). Supplies only `Map` (`:12`); Common-only transport sanity lives in [FrameworkSanityTests](#frameworksanitytests) instead (`MicroserviceExtractionTests.cs:7`-`:8`). [Rubric §7 - Microservices Readiness.] |
| `PiiConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13` | [PiiConventionTestsBase](#piiconventiontestsbase) | Every domain entity declaring a `[Pii]` property implements `IAnonymizable` ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). Supplies only `Map` (`:15`). Structurally vacuous in the framework, and its own doc says so (`:7`-`:12`); the machinery is proven non-vacuously by [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests). [Rubric §30 - Compliance/Privacy.] |
| `RawQueryableConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/RawQueryableConventionTests.cs:13` | [RawQueryableConventionTestsBase](#rawqueryableconventiontestsbase) | Bans the raw `IQueryable` repository surfaces in Application code via a textual scan; a raw-queryable handler is EF-coupled and cannot move behind a gRPC boundary. Because Common declares no modules, it overrides `ApplicationSourceDirectories()` (`:18`-`:22`) to scan the framework's own `Source/Core/MMCA.Common.Application` project (resolving the repo root through `ArchitectureMapBase.FindRepoRoot("MMCA.Common.slnx")`, `:20`), and overrides `AllowedFiles` (`:25`-`:37`) to whitelist the deliberate composition root `EntityQueryService.cs` and the five Notifications handlers whose cross-entity joins are the documented exception. Supplies `Map` at `:15`. [Rubric §8 - Data Architecture.] |
| `SliceCohesionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SliceCohesionTests.cs:10` | [SliceCohesionTestsBase](#slicecohesiontestsbase) | Handlers and validators each sit in the same namespace as the command/query they serve, so a Notifications use-case slice stays one cohesive unit. Supplies only `Map` (`:12`). [Rubric §5 - Vertical Slice.] |
| `StateManagementConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:11` | [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) | The shared `MMCA.Common.UI` assembly carries no mutable static state (a static is shared across every Blazor Server circuit) and its stateful services stay scoped rather than singleton. Supplies `Map` (`:13`) and overrides `AllowedStaticMembers` to whitelist `MMCA.Common.UI.Pages.Common.ErrorMessages._localizer` (`:21`-`:22`), a write-once wiring point, not per-user state. [Rubric §19 - State Management.] |
| `UIArchitectureConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/UIArchitectureConventionTests.cs:11` | [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase) | Holds the container/presentational split with mechanical caps: `*.razor.cs` code-behind files and inline `@code` blocks each stay within the base's convention limit. Supplies only `Map` (`:13`), so the base's defaults apply. [Rubric §18 - UI Architecture.] |

- **Why they're built this way** - see the two-layer "Architecture Enforcement" model in `MMCA.Common/CLAUDE.md`: rules are enforced at compile time (`Source/Build/MMCA.Common.LayerEnforcement.targets`) and at runtime here, with the runtime bodies factored into one shared package so Common, Store, and ADC stay identical. Each subclass exists only so xUnit discovers the rule in this repo's assembly with this repo's map.
- **Where they're used** - all twelve run in the `MMCA.Common.Architecture.Tests` project during CI's `build-and-test` job (fast, no database).
- **Caveats / not-in-source** - the per-rule fact counts live in each `*TestsBase`, not in these subclasses; the base sections elsewhere in this chapter are the authority on exactly what each rule asserts.

### CrossServiceDataSource
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/CrossServiceFixtureBase.cs:15` · Level 0 · sealed record

- **What it is**: a two-field record naming one logical data source a cross-service fixture routes to its
  own physical database: the logical name the framework's `DataSources` configuration section keys on
  (normally the module name) and the database that name resolves to on the shared SQL Server container
  (`CrossServiceFixtureBase.cs:8-15`).
- **Depends on**: nothing. A positional `sealed record` of two strings, declared above
  [CrossServiceFixtureBase](#crossservicefixturebase) in the same file.
- **Concept**: it is the declarative half of database-per-service
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), taught in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) expressed as test data. The
  doc's own examples are the shape to hold onto: `LogicalName` is `Conference`, `DatabaseName` is
  `ADC_Conference` (`CrossServiceFixtureBase.cs:13-14`). `[Rubric §8, Data Architecture]` assesses whether
  each service owns its own store; this record is how a test fixture states that ownership once and derives
  everything else from it.
- **Walkthrough**: two positional members, `LogicalName` and `DatabaseName`
  (`CrossServiceFixtureBase.cs:15`), so it gets structural equality and immutability for free. The base
  consumes each instance three ways: the database name drives the pre-create loop
  (`CrossServiceFixtureBase.cs:213`), and the logical name drives both environment keys
  `SetNamedDataSource` pushes, `DataSources__{LogicalName}__SQLServerConnectionString` and
  `DataSources__{LogicalName}__SQLServerMigrationsAssembly` (`CrossServiceFixtureBase.cs:272-275`).
- **Where it's used**: as the `DataSources` list a subclass supplies (`CrossServiceFixtureBase.cs:60`); ADC
  declares three (`MMCA.ADC/Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:61-66`)
  and Store its own set
  (`MMCA.Store/Tests/Integration/MMCA.Store.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:29`).

### DependencyInjectionAssert
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/DependencyInjectionAssert.cs:13` · Level 0 · class (static)

- **What it is**: a one-method assertion helper for the DI registration extensions every module and layer
  exposes. It proves a registration extension hands back the very `IServiceCollection` it was given, so a
  fluent chain stays intact.
- **Depends on**: `AwesomeAssertions` and `Microsoft.Extensions.DependencyInjection`
  (`DependencyInjectionAssert.cs:1-2`). No first-party dependency.
- **Concept introduced, the fluent-contract guard.** The framework's registration methods are fluent by
  convention: hosts chain `AddApplication().AddInfrastructure(...).AddAPI(...)`. An extension that returns a
  *new* collection silently drops every registration chained after it, and no other test catches that,
  because the dropped services are simply absent rather than wrong (`DependencyInjectionAssert.cs:6-11`).
  `[Rubric §14, Testability]` assesses whether an invariant can be checked cheaply; this one turns an
  otherwise invisible composition failure into a one-line test. `[Rubric §16, Maintainability]` covers the
  convention itself: the return-the-same-collection contract is what lets host composition stay declarative.
- **Walkthrough**
  - `ReturnsSameCollection(Func<IServiceCollection, IServiceCollection> register)`
    (`DependencyInjectionAssert.cs:21-32`): null-guards the delegate (`:23`), creates the `ServiceCollection`
    itself so the call site stays one line (`:25`, the doc shows the shape at `:16-18`), invokes the
    registration under test (`:27`), and asserts `result.Should().BeSameAs(services, ...)` with a
    because-reason that spells out the consequence of failing (`:29-31`).
  - Reference equality is the whole assertion. It deliberately says nothing about *what* was registered;
    the per-module tests that call it assert their own service descriptors separately.
- **Why it's built this way**: creating the collection inside the helper is what keeps adoption free. A
  module's DI test adds one line per registration extension rather than three lines of arrange plus an
  assertion nobody remembers to write.
- **Where it's used**: across the module DI test classes in both apps, for example
  `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Infrastructure.Tests/DependencyInjectionTests.cs:29`,
  `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.API.Tests/DependencyInjectionTests.cs:63,68`,
  `MMCA.Store/Tests/Modules/Catalog/MMCA.Store.Catalog.API.Tests/DependencyInjectionTests.cs:68,73`,
  `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.API.Tests/DependencyInjectionTests.cs:26,31`, and
  `MMCA.ADC/Tests/Modules/Notification/MMCA.ADC.Notification.Application.Tests/DependencyInjectionTests.cs:35`.
  MMCA.Common self-tests the helper, including that it fails for an extension returning a different
  collection (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/DependencyInjectionAssertTests.cs:12`).

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
    [Result](group-01-result-error-handling.md#result)-returning factory
    ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)) and throws if it failed, so
    a builder never yields a domain object that violated its invariants. The base deliberately owns no
    state and no default `WithX` helpers, those live on each concrete builder because defaults are
    per-entity.
- **Why it's built this way**: keeping the base to one abstract method means it adds zero coupling and
  zero opinions beyond "a builder produces a `TEntity`". The CRTP is the only structural rule it
  enforces, and it exists purely so fluent chaining stays type-safe down in the subclasses.
- **Where it's used**: the domain-test builders in both apps subclass it, eight today:
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
  [FeatureGateCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
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
  [IntegrationTestBase<TFixture>](#integrationtestbasetfixture) stays host-agnostic, and each
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
    [IEntityDataSourceRegistry](group-07-persistence-ef-core.md#ientitydatasourceregistry) and
    [IDataSourceResolver](group-07-persistence-ef-core.md#idatasourceresolver) from the host's services.
- **Why it's built this way**: two members, no state, no host coupling. The interface is deliberately
  minimal so the reset strategy (single database versus multi-source) is the fixture's problem, not the
  base's.
- **Where it's used**: implemented by
  [SqlServerIntegrationTestFixtureBase<TEntryPoint>](#sqlserverintegrationtestfixturebasetentrypoint)
  (`SqlServerIntegrationTestFixtureBase.cs:27`) and through it by every per-service fixture in both apps;
  consumed as the `TFixture` constraint on [IntegrationTestBase<TFixture>](#integrationtestbasetfixture)
  (`IntegrationTestBase.cs:14`) and therefore by all three contract bases in this unit.

### JwtTokenGenerator
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:30` · Level 0 · class (static)

- **What it is**: a static factory that mints signed JWT bearer tokens for integration tests, plus the
  matching switch that re-points a test host's Bearer scheme at the same committed key. Together they let a
  test call an authorized endpoint as any role or user without standing up the real login flow or a
  reachable JWKS endpoint. Each downstream project wraps the generator with role-specific convenience
  methods (AdminToken, OrganizerToken, and so on, `JwtTokenGenerator.cs:11-12`).
- **Depends on**: BCL and NuGet only, `System.Globalization`, `System.IdentityModel.Tokens.Jwt`,
  `System.Security.Claims`, `System.Security.Cryptography` (RSA),
  `Microsoft.AspNetCore.Authentication.JwtBearer` (for the options type the second member configures), and
  `Microsoft.IdentityModel.Tokens` (`JwtTokenGenerator.cs:1-6`). The generated claim layout mirrors the
  framework's [ITokenService](group-08-auth.md#itokenservice) so downstream auth middleware cannot tell a
  test token from a real one (`JwtTokenGenerator.cs:99-102`). The `userId` parameter is typed
  `UserIdentifierType` (`JwtTokenGenerator.cs:114`), the solution-wide identifier alias
  ([ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)).
- **Concept introduced, exercising the real RS256 path in tests.** `[Rubric §11, Security]` assesses
  how authentication and key handling are done; the deliberate choice here is that tests sign with
  **RS256** (`SecurityAlgorithms.RsaSha256`, `JwtTokenGenerator.cs:131`) using an embedded RSA-2048 dev
  keypair, the *same* asymmetric algorithm production uses, so integration tests run the identical
  validation code path
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), taught in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) rather than a weaker HMAC
  shortcut. `[Rubric §14, Testability]` covers the ergonomics: deterministic tokens with no per-run key
  generation, and a host that validates them with no network dependency at all.
- **Walkthrough**
  - Public constants (`JwtTokenGenerator.cs:33-96`): `DefaultIssuer` (`https://localhost:6001`, line 33),
    `DefaultKeyId` (`mmca-test-key`, line 41, the `kid` the host advertises on its JWKS document), and
    the paired `DefaultPublicKeyPem` (line 49) and `DefaultPrivateKeyPem` (line 68). The class doc records
    the wiring contract: test host appsettings set `Jwt:SigningAlgorithm=RS256`, `Jwt:RsaPublicKeyPem`,
    and `Jwks:KeyId` (`JwtTokenGenerator.cs:18-20`) so
    [RsaJwksProvider](group-08-auth.md#rsajwksprovider) publishes a JWKS entry with the matching `kid`.
  - `GenerateToken(...)` (`JwtTokenGenerator.cs:112-153`): imports the PEM private key into
    `RSAParameters` inside a `using` so the `RSA` instance can be disposed without invalidating the key
    held by `SigningCredentials` (`:121-131`), assembles the standard claim set
    (`ClaimTypes.NameIdentifier`, `user_id`, `ClaimTypes.Role`, all culture-invariant) plus any
    caller-supplied extras (`:133-143`), and writes a one-hour token (`:145-152`). Defaulted parameters
    mean a caller normally passes only audience, user id, and role (`:112-119`).
  - `ConfigureInProcessTokenValidation(JwtBearerOptions options, string audience)`
    (`JwtTokenGenerator.cs:167-189`): the validation half. It nulls `Authority` and `ConfigurationManager`
    and clears `RequireHttpsMetadata` (`:171-173`) to stop OIDC/JWKS discovery outright, imports the
    **public** key (`:175-180`), and pins the token-validation parameters to that static key plus the
    fixed issuer and the caller's audience (`:182-188`). The doc explains why it has to exist (`:155-163`):
    `AddForwardedJwtBearer` otherwise fetches the issuer and signing keys from the Identity service's JWKS
    document through the gateway, which no in-process test topology serves.
- **Why it's built this way**: the whole point is fidelity. Tokens are indistinguishable in shape and
  signing algorithm from production, so auth middleware and role checks are under test rather than
  stubbed. Splitting the key material into a mint side and a validate side is what lets a single-host
  fixture and a multi-host cross-service fixture share one committed keypair.
- **Where it's used**: tokens are applied to a client through
  [IntegrationTestBase<TFixture>](#integrationtestbasetfixture)'s `SetBearerToken(...)`
  (`IntegrationTestBase.cs:42-44`) and wrapped by each app's role-specific token helpers.
  `ConfigureInProcessTokenValidation` is called from a `PostConfigure<JwtBearerOptions>` in the test
  factories of the non-Identity hosts, for example
  `MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Infrastructure/CatalogTestWebApplicationFactory.cs:34`,
  `MMCA.ADC/Tests/Integration/MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationTestWebApplicationFactory.cs:44`,
  and both Store cross-service factories
  (`MMCA.Store/Tests/Integration/MMCA.Store.CrossService.IntegrationTests/Infrastructure/CatalogCrossServiceFactory.cs:44`,
  `.../SalesCrossServiceFactory.cs:46`). It is covered directly by
  `MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/JwtTokenGeneratorTests.cs:38-94`.
- **Caveats / not-in-source**: the class doc (`JwtTokenGenerator.cs:22-28`) carries an explicit security
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
  [SqlServerIntegrationTestFixtureBase<TEntryPoint>](#sqlserverintegrationtestfixturebasetentrypoint)
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
  [GracefulShutdownTestsBase<TEntryPoint>](#gracefulshutdowntestsbasetentrypoint)
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
  does **not** extend [IntegrationTestBase<TFixture>](#integrationtestbasetfixture): it needs only an
  `HttpClient`, so it takes one through an abstract factory rather than inheriting the SQL fixture
  machinery.
- **Concept**: a runtime conformance check on the HTTP edge. `[Rubric §11, Security]` and
  `[Rubric §26, Front-End Security]` both assess defense in depth at the edge; this test pins the exact
  header values the shared `AddCommonSecurityHeaders` / `UseCommonSecurityHeaders` middleware (see
  [SecurityHeadersMiddleware](group-16-aspire-orchestration.md#securityheadersmiddleware),
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
  [ProductionHostApplicationFactory<TEntryPoint>](#productionhostapplicationfactorytentrypoint).
- **Where it's used**: both gateway hosts subclass it with a single `CreateClient` override,
  `MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/SecurityHeadersTests.cs:11-12` and
  `MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:11-12`.

### TestPolling
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/TestPolling.cs:9` · Level 0 · class (static)

- **What it is**: a poll-with-timeout helper for asynchronous integration assertions. It repeatedly probes
  a value until a condition holds or a budget runs out, and hands back the last probed value either way.
- **Depends on**: BCL only (`Task`, `DateTime`, `TimeSpan`). No first-party dependency and no assertion
  library, so the caller keeps ownership of the assertion.
- **Concept introduced, replacing the pre-assert sleep.** Anything that travels the outbox to a broker and
  back, or any other eventually-consistent path, arrives at a time the test cannot know
  (`TestPolling.cs:3-8`). A fixed `Task.Delay` before the assertion is both slow and flaky: too short and
  the suite reds intermittently, too long and every green run pays the worst case. Polling returns as soon
  as the condition holds and bounds the wait. `[Rubric §14, Testability]` assesses whether the suite is
  deterministic; `[Rubric §6, CQRS & Event-Driven]` is why the problem exists at all, since the outbox
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-pattern.html)) is asynchronous by design and
  offers no synchronous handle to await.
- **Walkthrough**
  - `PollUntilAsync<T>(Func<Task<T>> probe, Func<T, bool> isSatisfied, TimeSpan? timeout = null, TimeSpan? interval = null)`
    (`TestPolling.cs:22-41`): null-guards both delegates (`:28-29`), computes a deadline from the
    **60-second** default budget (`:31`) and a **500 ms** default interval (`:32`), probes once before the
    loop (`:33`), then loops while the condition is unmet and the deadline has not passed (`:34-38`).
  - The return is the design decision worth noticing: it returns `last` unconditionally (`:40`) rather than
    throwing on timeout, so a timed-out poll still fails on the caller's real assertion message rather than
    on a bare timeout exception (the doc states exactly this at `:11-14`).
- **Why it's built this way**: bounding the wait and returning the last value keeps two properties at once,
  a fast green path (the loop exits on the first satisfying probe) and a diagnosable red path (the failure
  message describes the domain expectation, not the plumbing).
- **Where it's used**: the cross-service tiers of both apps route every eventual assertion through it and
  say so in their own docs
  (`MMCA.Store/Tests/Integration/MMCA.Store.CrossService.IntegrationTests/Infrastructure/CrossServiceTestBase.cs:15`
  and the ADC equivalent at
  `MMCA.ADC/Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceTestBase.cs`),
  with call sites such as
  `MMCA.Store/Tests/Integration/MMCA.Store.CrossService.IntegrationTests/CrossService/ProductVariantChangedRoundTripTests.cs:28,48,51`.
  MMCA.Common covers the helper itself, including the null-argument guards
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/TestPollingTests.cs:18-63`).

### CrossServiceFixtureBase
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/CrossServiceFixtureBase.cs:41` · Level 1 · class (abstract)

- **What it is**: the shared scaffolding for the cross-service **real-broker** integration tier. It boots
  several service hosts in ONE process against a real Testcontainers SQL Server and a real Testcontainers
  RabbitMQ, so the genuine outbox to broker to consumer round-trip (and any real cross-service gRPC read)
  is exercised end to end rather than faked (`CrossServiceFixtureBase.cs:17-25`).
- **Depends on**: [CrossServiceDataSource](#crossservicedatasource) (the per-source declaration), plus
  `Microsoft.Data.SqlClient`, `Testcontainers.MsSql`, `Testcontainers.RabbitMq`, and xUnit's
  `IAsyncLifetime` (`CrossServiceFixtureBase.cs:1-4,41`).
- **Concept introduced, the multi-host in-process topology and its configuration channel.** Where
  [SqlServerIntegrationTestFixtureBase<TEntryPoint>](#sqlserverintegrationtestfixturebasetentrypoint) boots
  one host with the cross-service edges faked and no broker, this base owns a whole topology. Two
  mechanisms are load-bearing, and both are documented on the class. First, **process environment
  variables are the only override channel these hosts honour** (`CrossServiceFixtureBase.cs:26-39`): each
  host reads its connection string, `MessageBus` settings, and JWT settings from `builder.Configuration` at
  configure-time, before `builder.Build()`, which is before
  `WebApplicationFactory.ConfigureAppConfiguration` deltas apply, so in-memory config would arrive too
  late. Second, because the one genuinely per-host key is the SQL connection string, hosts must boot
  **strictly sequentially**, and that is safe precisely because a booted host has already snapshotted its
  connection (the data-source resolver, the context factory, the outbox processor, and the MassTransit bus
  are all built during `StartAsync`). `[Rubric §7, Microservices Readiness]` assesses whether extracted
  services really do collaborate over their declared transports; `[Rubric §6, CQRS & Event-Driven]` covers
  the outbox path ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-pattern.html));
  `[Rubric §8, Data Architecture]` covers database-per-service
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)); and
  `[Rubric §14, Testability]` covers shipping the whole topology as a reusable base.
- **Walkthrough**
  - State: the private `DummyBearerAuthority` constant (`CrossServiceFixtureBase.cs:45`), the
    original-environment snapshot map (`:47`), the two nullable containers (`:49-50`), and the public
    `RabbitMqConnectionString` (`:53`).
  - Subclass knobs: `DataSources` (`:60`, the logical sources in the order their databases are created),
    `MigrationsAssemblyPrefix` (`:67`, so each named source gets `{prefix}.{LogicalName}` exactly as
    production does), `BootHostsAsync` (`:143`) and `DisposeHostsAsync` (`:146`), plus the optional hooks
    `OnContainersStartedAsync` (`:152`) and `ConfigureSharedEnvironment` (`:161`).
  - `SqlServerBaseConnectionString` (`:70-72`) throws a clear `InvalidOperationException` when the
    container has not started, and the `public static ComposeConnectionString(...)` (`:82-96`) overlays a
    catalog, `TrustServerCertificate`, and an optional Application Name. It is deliberately pure and static
    so a fixture's connection-string composition is unit-testable with no Docker daemon (`:74-81`).
  - `InitializeAsync` (`:99-116`) is the whole lifecycle in seven steps: create the containers, start both
    in parallel with `Task.WhenAll` (`:102`), read the broker connection string (`:104`), run the subclass
    hook (`:105`), pre-create the databases (`:111`), push the shared environment (`:113`), then boot the
    hosts (`:115`). The pre-create step carries the sharpest comment in the file (`:107-110`):
    `CREATE DATABASE` runs *before* EF's migration lock (`sp_getapplock`) is acquired, so a host booted
    twice (the real-Kestrel double-boot pattern) would otherwise race itself; with the databases already
    present EF skips the create and the migration lock serializes the actual migration run.
  - `SetSharedEnvironment` (`:227-258`) pushes `ASPNETCORE_ENVIRONMENT=Testing` (`:229`), one named data
    source per module (`:243-246`), the real broker settings `MessageBus__Provider=RabbitMq` and
    `ConnectionStrings__rabbitmq` (`:249-250`), and the dummy Bearer authority that only has to exist so
    `AddForwardedJwtBearer`'s authority guard passes (`:255`; real validation is re-pointed at the
    committed test key by [JwtTokenGenerator](#jwttokengenerator)`.ConfigureInProcessTokenValidation`,
    `:252-254`), before handing control to the subclass (`:257`).
  - The named-source loop is the multi-host fix, and its comment (`:231-242`) is worth reading in full: EF
    Core caches a context type's model in a process-global cache keyed by (context type, source name). If
    every host let its entities collapse onto `Default` (as production does, one host per process), all
    hosts here would share ONE cached model and the first booted would win. `SetNamedDataSource`
    (`:265-276`) therefore composes each module's connection string with a distinct Application Name
    `MMCA-{LogicalName}` (`:270`) so it differs ordinally from the top-level `ConnectionStrings` value and
    the resolver keeps the named source, giving each host its own model-cache key.
  - `SetHostConnectionString` (`:177`) is the one key mutated between sequential boots, and
    `SetEnvironmentVariable` (`:187-195`) records only the **first** original value per key so re-pushing
    that key cannot clobber the restore point. `DisposeAsync` (`:119-136`) disposes the hosts, then
    RabbitMQ, then SQL, then calls `RestoreEnvironment` (`:278-286`).
  - `CreateContainers` (`:203-204`) is built inside a method rather than a field initializer so a subclass
    can be constructed and its non-container logic unit-tested on a machine with no Docker daemon, and it
    carries a documented `CS0618` suppression for the parameterless Testcontainers module builders
    (`:197-202`). `CreateDatabasesAsync` (`:207-225`) issues one guarded
    `IF DB_ID(...) IS NULL CREATE DATABASE` per source with a scoped `CA2100` suppression justified because
    the database names are the subclass's own compile-time constants (`:218`).
- **Why it's built this way**: the environment-variable channel and the sequential boot are not style
  choices, they are the only way to give several hosts distinct databases in one process given
  configure-time configuration reads. Everything genuinely per-app (which databases, how many hosts and in
  what order, which extra settings) stays behind the four abstract members.
- **Where it's used**: one fixture per app, both sealed subclasses,
  `MMCA.ADC/Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:23`
  (three databases for three REST hosts at `:61-66`, migrations prefix `MMCA.ADC.Migrations.SqlServer` at
  `:69`) and
  `MMCA.Store/Tests/Integration/MMCA.Store.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:29`.
  MMCA.Common covers the container-free half of the base through its own private `FakeCrossServiceFixture`
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/CrossServiceFixtureBaseTests.cs:13,106`).
- **Caveats / not-in-source**: this tier needs a Docker daemon. Where each repo schedules it is a CI
  decision recorded outside this class; the base itself says nothing about scheduling.

### DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:36` · Level 1 · class (abstract)

- **What it is**: an opt-in conformance base that builds a real `ServiceCollection` through a repo's own
  registration sequence, resolves the decorated command and query handlers out of the built provider, and
  asserts the *runtime object graph* nests the decorators in exactly the
  [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) order.
- **Depends on**:
  [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  and [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) from
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
    [ICorrelationContext](group-12-api-hosting-mapping.md#icorrelationcontext),
    [ICacheService](group-09-caching.md#icacheservice),
    [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), `ILogger<>`) and then runs the repo's
    real registration sequence, module scans first and `AddApplicationDecorators()` last (doc `:19-26`).
  - `ExpectedCommandDecorators` (`:47-54`) pins, outermost first,
    [FeatureGateCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
    [LoggingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult),
    [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult),
    [ValidatingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult),
    [TransactionalCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult).
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
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:20-21`), and both
  apps subclass it in their architecture tiers over the real Identity pair
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:26-27`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:26-27`).
- **Caveats / not-in-source**: each subclass pins one representative command/query pair, not every
  handler, so the guard proves the *ordering* is right, not that every handler is decorated.

### GracefulShutdownTestsBase<TEntryPoint>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/GracefulShutdownTestsBase.cs:24` · Level 1 · class (abstract)

- **What it is**: a shutdown conformance base. It boots a real host, calls a real `IHost.StopAsync` under
  a bounded cancellation token, and asserts the host drained cleanly, firing `ApplicationStopping` and
  then `ApplicationStopped` inside the timeout.
- **Depends on**:
  [ProductionHostApplicationFactory<TEntryPoint>](#productionhostapplicationfactorytentrypoint)
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
  itself is one of the suites recorded in
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
- **Depends on**: [IIntegrationTestFixture](#iintegrationtestfixture) (the `TFixture` constraint,
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
    `Authorization` header, the hook through which a [JwtTokenGenerator](#jwttokengenerator) token is
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
  ([OpenApiContractTestsBase<TFixture>](#openapicontracttestsbasetfixture),
  [ProblemDetailsContractTestsBase<TFixture>](#problemdetailscontracttestsbasetfixture),
  [ServiceInfoVersioningContractTestsBase<TFixture>](#serviceinfoversioningcontracttestsbasetfixture)),
  and of every concrete integration test in the downstream apps.

### SqlServerIntegrationTestFixtureBase<TEntryPoint>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27` · Level 1 · class (abstract)

- **What it is**: the reusable fixture that boots a real service host in-process against a **throwaway
  SQL Server database**, applies the module's migrations on first start, resets data between tests with
  Respawn, and drops the database on disposal. It is the concrete engine behind
  [IIntegrationTestFixture](#iintegrationtestfixture) for SQL Server hosts.
- **Depends on**: [IIntegrationTestFixture](#iintegrationtestfixture) (implemented,
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
  SQL service container. Note the contrast with [CrossServiceFixtureBase](#crossservicefixturebase),
  which needs the opposite (named sources per host so several EF models can coexist in one process).
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
- **Depends on**: [IntegrationTestBase<TFixture>](#integrationtestbasetfixture) (inherited,
  `OpenApiContractTestsBase.cs:21`), `System.Net`, `System.Text.Json`, `AwesomeAssertions`, and `Xunit`
  (`:1-4`).
- **Concept introduced, the contract guard on the live document.** `[Rubric §9, API & Contract Design]`
  assesses whether the API surface is described and kept stable; the pattern across all three Level 2
  bases is a **live-document guard with no committed snapshot** (`OpenApiContractTestsBase.cs:14-16`),
  the assertions run against the document the host actually serves, so new controllers can never leave a
  stale snapshot behind and a removed one is caught immediately. This is one of the suites recorded
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
- **Depends on**: [IntegrationTestBase<TFixture>](#integrationtestbasetfixture) (inherited,
  `ProblemDetailsContractTestsBase.cs:21`), `System.Net`, `System.Net.Http.Json`, `System.Text.Json`,
  `AwesomeAssertions`, and `Xunit` (`:1-5`). Same live-guard shape as the OpenAPI base above.
- **Concept**: still `[Rubric §9, API & Contract Design]`, here the pinned contract is the **error
  shape**. The class covers the two distinct paths that produce errors (class doc, `:10-18`): ASP.NET
  Core model validation (a 400 `application/problem+json` body) and the framework's `HandleFailure`
  `Result`-error mapping (see
  [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase)), which turns a
  [Result](group-01-result-error-handling.md#result) failure such as an
  [Error](group-01-result-error-handling.md#error) not-found into a 404 problem
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
- **Depends on**: [IntegrationTestBase<TFixture>](#integrationtestbasetfixture) (inherited,
  `ServiceInfoVersioningContractTestsBase.cs:19`), `System.Net`, `System.Text.Json`,
  `AwesomeAssertions`, and `Xunit` (`:1-4`).
- **Concept**: `[Rubric §9, API & Contract Design]` again, the versioning axis
  ([ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html)). The class doc
  (`:8-17`) makes the point that without a second working version the whole versioning story would be
  untestable, so this base keeps the machinery *exercised* rather than merely asserted. Because the
  `ServiceInfo` controller ships in `MMCA.Common.API`
  ([ServiceInfoControllerBase](group-12-api-hosting-mapping.md#serviceinfocontrollerbase)), the entire
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
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork),
  [IRepository<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype),
  [IReadRepository<TEntity, TIdentifierType>](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype),
  [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  and
  [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the two generic constraints), plus `Moq`, `Microsoft.Extensions.Logging`, and `NullLogger<T>`
  (`HandlerTestBase.cs:1-5`).
- **Concept**: *the arrange-phase base class.* Where
  [IntegrationTestBase<TFixture>](#integrationtestbasetfixture) gives an end-to-end test a booted host,
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
  application modules, 87 classes today, including the framework's own scaffold test
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
  - The single `[Fact]` `LandingPageCss_SourcesBrandColorFromToken_NotHardcodedHex` (line 25) first asserts the list is non-empty (a non-vacuity guard, lines 27-28), then for each stylesheet reads it via `ReadEmbeddedCss` (line 56, which throws a clear `InvalidOperationException` when the resource is missing, lines 58-60) and records a violation when the file is blank (line 37), when the token is absent (line 43), or when the raw hex is present (line 48, matched with `OrdinalIgnoreCase` so `#1565c0` cannot slip past).
  - Resources are resolved from `GetType().Assembly` (line 33), that is, the *subclass's* assembly, which is what lets a package-shipped base read a consumer's stylesheet.
- **Why it's built this way**: the doc (lines 3-11) explains the split. MMCA.Common's own [BrandColorTokenTests](#brandcolortokentests) guards the C#-to-CSS token *definition* (from `BrandColors.Primary`), while this base guards every downstream *consumer* of it, embedding the stylesheets as manifest resources so the package needs no file-system access into the consumer repo.
- **Where it's used**: subclassed once per repo that ships a branded landing page, as `BrandColorTokenTests` in ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:12`) and Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/BrandColorTokenTests.cs:10`).

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

### ModuleConformanceTestsBase<TModule>
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleConformanceTestsBase.cs:21` · Level 0 · abstract generic class

- **What it is**: a per-module conformance gate. It asserts that one module's `Name`, `Dependencies`, and `RequiresDependencies` still say what the repo expects, and gives the subclass a hook to assert what `RegisterDisabledStubs` puts in the container.
- **Depends on**: `[Fact]` (xUnit), AwesomeAssertions, and `System.Reflection` (`GetInterfaces`, `GetProperty`, `BindingFlags`). It has **no** `Map`: it reflects over a single module type, not over an assembly inventory. The contract it reads is [IModule](group-14-module-system-composition.md#imodule), matched by the full-name constant `"MMCA.Common.Application.Modules.IModule"` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleConformanceTestsBase.cs:24`).
- **Concept introduced, gating a silent-drift contract.** The three members this base checks are the whole surface `ModuleLoader` registers on: it resolves the topological (Kahn) registration order from `Dependencies`, matches `ModulesSettings` entries by `Name`, and decides between a hard start failure and stub registration from `RequiresDependencies` (doc, lines 4-10). Drift in any of the three throws nothing: it silently reorders registration, leaves a module permanently enabled, or swaps a real service for a disabled stub. That is exactly the failure class a fitness function exists for. `[Rubric §7, Microservices Readiness]` assesses whether module boundaries and their declared dependencies stay honest as modules move between hosts; `[Rubric §14, Testability]` assesses whether a silent contract is made loud; `[Rubric §34, Architecture Governance]` applies because the module contract is enforced rather than described. The module system itself is taught in [Group 14](group-14-module-system-composition.md#imodule).
- **Walkthrough**
  - The type parameter is constrained `where TModule : class, new()` (line 22), so the default `CreateModule()` is just `new()` (line 68); a module without a parameterless constructor overrides that hook.
  - Three expectation members the subclass declares: the abstract `ExpectedName` (line 27), and the virtual `ExpectedDependencies` (line 30, defaulting to the empty list for a leaf module) and `ExpectedRequiresDependencies` (line 36, defaulting to `false`).
  - Four `[Fact]`s. `Module_ShouldDeclare_ExpectedName` (line 39) compares the read `Name`, with a `because` spelling out the consequence: renaming silently disables the module's configuration and drops it from other modules' dependency graphs (line 42). `Module_ShouldDeclare_ExpectedDependencies` (line 45) casts the value to `IEnumerable<string>`, asserts it is not null (the shape `ModuleLoader` sorts on, lines 49-50), then `BeEquivalentTo` the expectation (lines 52-54). `Module_ShouldDeclare_ExpectedRequiresDependencies` (line 58) pins the flag that turns a disabled dependency into a startup failure instead of a substituted stub (line 61). `Module_ShouldRegister_ExpectedDisabledStubs` (line 64) delegates to the `AssertDisabledStubs` hook.
  - `AssertDisabledStubs` (line 77) is deliberately empty by default: a module exporting no cross-module contract registers no stubs, so the fact passes vacuously and only a module that *does* export one overrides it (doc, lines 70-75).
  - The private `ReadContractMember` (line 81) is the load-bearing mechanism. It finds the `IModule` interface on the instance by full-name match (lines 85-87), asserts the module implements it at all (lines 89-90), resolves the named public instance property off the *interface* (line 92), and reads it (line 99). Reading through the interface property dispatches to the module's override when there is one and to the framework's **default interface implementation** when there is not (comment, lines 97-98).
- **Why it's built this way**: the reflection-by-full-name approach is the same discipline the rest of the package uses, and for the same reason: it keeps the package free of the framework's transitive graph (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/MMCA.Common.Testing.Architecture.csproj:22-29`). It also buys a second property the doc calls out (lines 11-18): dispatching through the interface property is what asserts a *leaf* module against `IModule`'s defaults, the reach the hand-written per-repo tests needed an explicit `(IModule)` cast for.
- **Where it's used**: subclassed once per module across the consumer repos, five times today: ADC's `NotificationModuleTests` (`MMCA.ADC/Tests/Modules/Notification/MMCA.ADC.Notification.API.Tests/NotificationModuleTests.cs:8`, the fullest example: it expects `["Identity"]`, `RequiresDependencies` true, and overrides `AssertDisabledStubs` to assert the `IUserNotificationExportService` stub descriptor is a singleton, lines 10-31) and `IdentityModuleTests` (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.API.Tests/IdentityModuleTests.cs:5`), plus Store's Catalog, Sales, and Identity module tests. MMCA.Common holds the adversarial coverage for the base itself in [ModuleConformanceTestsBaseTests](#moduleconformancetestsbasetests), which runs it against a leaf and a dependent fake module (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:51`, `:60`) and proves each assertion actually fails on the drift it claims to catch through a private `DriftedTests` subclass (`:131`).

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
  - `DiscoverAlertSpecs` (lines 105-126) slices the bicep between `var sloAlertSpecs` and `resource sloAlerts` (lines 109-112, each index assertion carrying its own `because`), runs `AlertKeyRegex` and `AlertSeverityRegex` over that block, and asserts the two match counts agree (line 117) so a changed spec shape fails loudly instead of silently mis-pairing. `DiscoverRunbookAlertHeadings` (line 128) keeps only the `###` headings carrying the infix. The three `[GeneratedRegex]` partial properties sit at lines 139-146, each with a 2000 ms match timeout.
  - `ReadEmbedded` (lines 131-137) throws a message naming the assembly when a resource is missing.
- **Why it's built this way**: the class doc (lines 23-28) records why the `ResourceAssembly` default is load-bearing. The base ships *inside* the framework package, so resolving resources against its own assembly would look for the consumer's bicep inside `MMCA.Common.Testing.Architecture.dll` and always throw. Defaulting to the derived type's assembly means a subclass needs no wiring beyond two `EmbeddedResource` entries in its csproj (the snippet is in the doc at lines 18-22).
- **Where it's used**: subclassed as a one-line `public sealed class ObservabilityConventionTests : ObservabilityConventionTestsBase;` in ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7`) and Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ObservabilityConventionTests.cs:7`); see [ObservabilityConventionTests](#observabilityconventiontests). MMCA.Common carries [ObservabilityConventionTestsBaseTests](#observabilityconventiontestsbasetests) instead, a deliberate cross-assembly guard that repoints both resource names at local fixtures (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ObservabilityConventionTestsBaseTests.cs:16-18`) and adds one extra `[Fact]` pinning the `ResourceAssembly` default to the derived type's assembly (`:24-29`).

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
- **Where it's used**: subclassed per module UI test project, five times today: `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/ManagementRouteAuthorizationTests.cs:19`, `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/IdentityRouteAuthorizationTests.cs:16`, and Store's Catalog, Sales, and Identity equivalents (`MMCA.Store/Tests/Modules/Catalog/MMCA.Store.Catalog.UI.Tests/CatalogRouteAuthorizationTests.cs:15`, `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.UI.Tests/SalesRouteAuthorizationTests.cs:18`, `MMCA.Store/Tests/Modules/Identity/MMCA.Store.Identity.UI.Tests/IdentityRouteAuthorizationTests.cs:15`).

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
- **Where it's used**: each repo's concrete map subclasses this: [CommonArchitectureMap](#commonarchitecturemap) (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:15`), [AdcArchitectureMap](#adcarchitecturemap) (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:8`), `StoreArchitectureMap` (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/StoreArchitectureMap.cs:8`), and `HelpdeskArchitectureMap` (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/HelpdeskArchitectureMap.cs:8`), plus the private [SpecTestMap](#spectestmap) fixture inside MMCA.Common's [SpecificationFitnessTests](#specificationfitnesstests) (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:26`). `FindRepoRoot` is called directly by every file-reading base: [DataResidencyTestsBase](#dataresidencytestsbase), [FormsConventionTestsBase](#formsconventiontestsbase), [FrameworkVersionConsistencyTestsBase](#frameworkversionconsistencytestsbase), [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase), [RawQueryableConventionTestsBase](#rawqueryableconventiontestsbase), [StateManagementConventionTestsBase](#statemanagementconventiontestsbase), and [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase).

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
- **Concept**: cross-references the delegating-base shape from [AggregateConventionTestsBase](#aggregateconventiontestsbase). `[Rubric §8, Data Architecture]` assesses optimistic-concurrency handling ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)); carrying a RowVersion on every update request is how that concern is enforced at the contract level.
- **Walkthrough**: one `[Fact]` `UpdateRequests_ShouldImplement_IConcurrencyAware` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:13`) delegating to `ArchitectureRules.UpdateRequestsAreConcurrencyAware(Map)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:24`). The doc notes modules with no mutable aggregate are legitimately vacuous (lines 5-6).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ConcurrencyConventionTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:3`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:54`).

### ControllerConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: the presentation-layer convention base: controllers are thin and sealed, never reach Infrastructure or EF Core directly, and inherit the framework [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) for consistent Result-to-HTTP mapping.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); it adds a `protected virtual ControllersExemptFromApiControllerBase` list (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:12`) for controllers that legitimately bypass the base (for example a webhook endpoint that owns its own response semantics). `[Rubric §9, API & Contract Design]` assesses consistent controller shape.
- **Walkthrough**: four `[Fact]`s: `Controllers_ShouldNotDependOn_Infrastructure` (line 15), `Controllers_ShouldNotDependOn_EntityFrameworkCore` (line 18), `Controllers_ShouldBe_Sealed` (line 21), and `Controllers_ShouldInherit_ApiControllerBase` (line 24, passing the exempt list). The underlying rules live in `ArchitectureRules.Controllers.cs`.
- **Where it's used**: subclassed in every repo with business modules: Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ControllerConventionTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:3`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:73`).

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
- **Where it's used**: subclassed in all four repos (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9`, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DomainPurityTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:3`, and Helpdesk at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:10`).

### EntityConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:9` · Level 4 · abstract class

- **What it is**: the fuller DDD entity and aggregate convention base (the module-bearing counterpart to [AggregateConventionTestsBase](#aggregateconventiontestsbase)): entities are sealed and live only in Domain, aggregate roots use a `Create(...)` factory returning `Result<T>` with no public constructor, every domain and value-object factory returns a `Result`, and DTOs and requests stay out of Domain and Infrastructure.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Entities.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §4, DDD]` and `[Rubric §3, Clean Architecture]` apply.
- **Walkthrough**: seven `[Fact]`s: `Domain_ShouldExpose_AggregateRoots` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:14`), `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 17), `AggregateRoots_ShouldHave_NoPublicConstructors` (line 20, the module-scoped rule at `ArchitectureRules.Entities.cs:115`), `DomainFactories_ShouldReturn_Result` (line 23), `DomainEntities_ShouldBe_Sealed` (line 26), `DomainEntities_ShouldReside_InDomainLayer` (line 29), and `DtosAndRequests_ShouldNotResideIn_DomainOrInfrastructure` (line 32).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/EntityConventionTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:3`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:78`).

### EventConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: an integration-event convention base (the doc cites [ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)): every concrete integration event inherits [BaseIntegrationEvent](group-04-events-outbox.md#baseintegrationevent), declares an `int SchemaVersion`, and lives in a `*.IntegrationEvents` namespace in the Shared layer.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Events.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §9, API & Contract Design]` assess versioned, discoverable cross-service event contracts. It pairs with [IntegrationEventContractTestsBase](#integrationeventcontracttestsbase), which freezes the exact shape.
- **Walkthrough**: three `[Fact]`s: `IntegrationEvents_ShouldDeclare_SchemaVersion` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:13`), `IntegrationEvents_ShouldInherit_BaseIntegrationEvent` (line 16), `IntegrationEvents_ShouldResideIn_SharedIntegrationEventsNamespace` (line 19).
- **Where it's used**: subclassed in every repo that publishes integration events: Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/EventConventionTests.cs:3`), ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/EventConventionTests.cs:3`), Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:38`), and MMCA.Common itself under the name `EventVersioningConventionTests` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/EventVersioningConventionTests.cs:10`).

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
- **Why it's built this way**: MMCA.Common itself does not subclass this, because it declares no `MMCA.Common.*` pins; only consumers do (lines 9-11). The default floor is deliberately loose: the doc points at `MMCA.Common/FACTS.md` for the authoritative released-package count (lines 17-22, the count itself is generated at `MMCA.Common/FACTS.md:19`), and each consumer is expected to override the floor to its own known number.
- **Where it's used**: subclassed in Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9`), ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9`), and Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:47`).

### HandlerConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: the CQRS handler convention base: handlers and validators live only in Application, handlers and services do not broker other handlers, and no `*Service` exceeds the god-class constructor-arity ceiling.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Handlers.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); it adds a `MaxServiceConstructorParameters` override (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:12`, default 8, matching the rule's own default at `ArchitectureRules.Handlers.cs:44`). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §1, SOLID]` apply; the CQRS decorator pipeline itself is taught in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to).
- **Walkthrough**: six `[Fact]`s: `Handlers_ShouldResideIn_ApplicationLayer` (line 15), `Handlers_ShouldNotInject_OtherHandlers` (line 18), `ApplicationServices_ShouldNotInject_Handlers` (line 21), `ApplicationServices_ShouldNotExceed_ConstructorArity` (line 24, passing the max), `Validators_ShouldResideIn_ApplicationLayer` (line 27), `EventHandlers_ShouldResideIn_ApplicationLayer_AndBeSealed` (line 30).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/HandlerConventionTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:3`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:68`). [ConstructorDependencyCountTestsBase](#constructordependencycounttestsbase) is the narrower, per-repo-pinned version of the arity check.

### HandlerResultConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:16` · Level 4 · abstract class

- **What it is**: an opt-in base asserting that every concrete command or query handler's `TResult` is [Result](group-01-result-error-handling.md#result) or `Result<T>` (or a type derived from them), turning a runtime-only constraint into a build-time gate.
- **Depends on**: [IArchitectureMap](#iarchitecturemap) and [ArchitectureRules](#architecturerules) (`ApplicationLayersDeclareHandlers`, `CommandHandlersReturnResult`, `QueryHandlersReturnResult`, at `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.HandlerResults.cs:18`, `:39`, `:48`).
- **Concept introduced, closing a deliberately unconstrained generic.** The CQRS interfaces carry no compile-time constraint on `TResult` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:6-7`), but the decorator pipeline's short-circuit paths (feature gate, validation) fabricate failures through [ResultFailureFactory](group-05-cqrs-pipeline.md#resultfailurefactory), which throws `InvalidOperationException` at runtime for any non-`Result` `TResult` (lines 7-9). A handler with the wrong result type therefore compiles cleanly and only fails when a gate short-circuits it. This base moves that failure to CI. `[Rubric §6, CQRS & Event-Driven]`, `[Rubric §14, Testability]`, and `[Rubric §15, Best Practices & Code Quality]` apply.
- **Walkthrough**: three `[Fact]`s. `ApplicationLayers_DeclareAtLeastOneHandler` (line 21) is the non-vacuity guard the doc calls out (lines 12-13): a mis-pinned assembly cannot make the other two pass by finding nothing. `CommandHandlers_Return_ResultTypes` (line 24) and `QueryHandlers_Return_ResultTypes` (line 27) delegate to the matching rules.
- **Why it's built this way**: it is opt-in and map-driven like the rest of the family, so a repo adds it next to its other architecture test classes with the same `Map` and no other wiring.
- **Where it's used**: subclassed in MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/HandlerResultConventionTests.cs:12`), Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/HandlerResultConventionTests.cs:6`), and ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/HandlerResultConventionTests.cs:8`).

### ImmutabilityTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: an immutability convention base: DTOs, command and query messages, domain events, integration events, and value objects expose no public mutable (non-`init`) setter; value objects are additionally sealed and confined to the Shared layer.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Immutability.cs`), which uses [RuleHelpers](#rulehelpers)`.HasPublicMutableSetter` underneath.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the `init`-only versus mutable distinction is exactly what `HasPublicMutableSetter` detects via the `IsExternalInit` modifier. `[Rubric §15, Best Practices & Code Quality]` and `[Rubric §4, DDD]` assess immutable contracts and value objects.
- **Walkthrough**: five `[Fact]`s: `Dtos_ShouldBe_Immutable` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:13`), `CommandsAndQueries_ShouldBe_Immutable` (line 16), `DomainEvents_ShouldBe_Immutable` (line 19), `IntegrationEvents_ShouldBe_Immutable` (line 22), `ValueObjects_ShouldBe_ImmutableSealedAndInShared` (line 25).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ImmutabilityTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:3`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:83`).

### IntegrationEventContractTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:11` · Level 4 · abstract class

- **What it is**: a frozen wire-contract guard: it rebuilds the live integration-event contract (one line per event, `FullName { Prop:Type, ... }`) and compares it to a committed snapshot the subclass supplies, so a renamed, removed, or retyped property (or a new event shipped without its consumer) fails the build.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules)`.BuildIntegrationEventContract` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Events.cs:45`), AwesomeAssertions.
- **Concept introduced, the snapshot fitness function.** `[Rubric §9, API & Contract Design]` and `[Rubric §7, Microservices Readiness]` assess whether cross-service contracts stay stable; because a consumer in another service deserializes by shape, this gate makes any contract change a deliberate, coordinated commit.
- **Walkthrough**: the subclass supplies `Map` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:13`) and the committed `ExpectedContract` snapshot (line 16). `IntegrationEventContracts_ShouldMatch_TheFrozenSnapshot` (line 19) builds the actual contract (line 21) and asserts `actual.Should().Equal(ExpectedContract, ...)` (lines 23-28), the message instructing the author to version the event and update `ExpectedContract` in the same commit when a change is intentional.
- **Where it's used**: subclassed in the repos publishing integration events: Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/IntegrationEventContractTests.cs:3`), ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:3`), and Helpdesk, whose one-line snapshot is a compact worked example (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:88`, snapshot at `:94-97`). It complements [EventConventionTestsBase](#eventconventiontestsbase).

### LayerDependencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: the Clean Architecture layer-flow base: fifteen `[Fact]`s asserting that the map declares the expected layers at all, and that each layer references only layers below it (Domain not on Application, Infrastructure, or API; Application not on Infrastructure or API; Shared on nothing above it; UI only on Shared).
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Layers.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); this is the runtime half of the two-gate layer enforcement described in [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html), the compile-time half being `MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets`. `[Rubric §3, Clean Architecture]` is the whole point.
- **Walkthrough**
  - Two overridable declarations come first: `RequiredLayers` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:16`, defaulting to the five core layers Shared, Domain, Application, Infrastructure, Api) and `RequiredModuleLayers` (line 24, defaulting to the same list and trimmable for a deliberately thin module).
  - Two non-vacuity `[Fact]`s guard the rest: `LayerMap_DeclaresEveryExpectedLayer` (line 27) and `LayerMap_ModulesDeclareEveryExpectedLayer` (line 30). Without them a map that forgot an assembly would satisfy every dependency rule by having nothing to check.
  - Thirteen forbidden-edge `[Fact]`s follow, each a one-line delegate onto an `ArchitectureRules.Layers.cs` method: `Domain_ShouldNotDependOn_Application` (line 33) through `Ui_ShouldNotDependOn_Infrastructure` (line 69). The UI trio (lines 63-69) encodes the documented exception that UI depends only on Shared for Blazor WASM compatibility.
- **Where it's used**: subclassed in all four repos (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9`, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/LayerDependencyTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3`, and Helpdesk at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:5`).

### LocalizationResourceTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: an opt-in translation-coverage gate ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)): a repo that ships localized `.resx` resources subclasses this and lists its required cultures; the build fails if any base `.resx` under `Source/` lacks a complete, non-empty sibling for a required culture.
- **Depends on**: [ArchitectureRules](#architecturerules)`.ResourceTranslationsAreComplete` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Localization.cs:23`), `[Fact]`. There is no `Map` on this base; it scans `Source/` directly through the rule.
- **Concept introduced, a coverage fitness function for i18n.** `[Rubric §27, i18n]` assesses translation completeness; this gate ensures a new English string can never ship without its translation (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:3-8`).
- **Walkthrough**: the subclass supplies `RequiredCultures` (line 13, for example `["es"]`) and optionally `MinimumBaseResources` (line 21, a non-vacuity floor whose default of 0 skips the guard). The single `[Fact]` `Translations_AreComplete_ForEveryRequiredCulture` (line 24) passes both to the rule.
- **Why it's built this way**: single-locale repos need not subclass it (the rule is vacuous for an empty list). It pairs with [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase): this gate keeps the extracted resources translated, that gate keeps literals out of markup.
- **Where it's used**: subclassed in MMCA.Common as [LocalizationResourceTests](#localizationresourcetests) (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizationResourceTests.cs:12`) and in Store, ADC, and Helpdesk under the name `TranslationCompletenessTests` (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/TranslationCompletenessTests.cs:13`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:12`); Helpdesk's requires `["es"]` with a floor of 3 (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:119-125`).

### LocalizedTextConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:13` · Level 4 · abstract class

- **What it is**: a localized-text convention gate ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)): user-visible literals must not be hard-coded in `.razor` or `.razor.cs` under `Source/` (snackbar messages, page `Title` properties, `<PageTitle>` markup, breadcrumb labels) but resolve through `IStringLocalizer` resources.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, [ArchitectureRules](#architecturerules)`.UserVisibleTextIsLocalized` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.LocalizedText.cs:47`).
- **Concept**: cross-references the markup-scanning gate idea from [FormsConventionTestsBase](#formsconventiontestsbase). `[Rubric §27, i18n]` assesses that visible strings follow the selected language.
- **Walkthrough**: the subclass supplies `Map` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:15`) and optionally `MinimumScannedFiles` (line 21, default 1) and `AllowedFiles` (line 28, whole-file exemptions; the preferred exemption is a per-line `i18n: allow` comment, per the class doc at lines 8-10). `UserVisibleText_IsLocalized` (line 31) resolves the repo root and delegates to the rule with the `Source` directory, the allowlist, and the floor (lines 33-37).
- **Where it's used**: subclassed in all four repos (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizedTextConventionTests.cs:11`, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/LocalizedTextConventionTests.cs:14`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:14`, and Helpdesk at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:131`, which sets a floor of 5 at `:136`). It pairs with [LocalizationResourceTestsBase](#localizationresourcetestsbase).

### MicroserviceExtractionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a transport-boundary base for the modular-monolith to microservices path: MassTransit, gRPC, and Protobuf must never leak into Domain, Application, or Shared, so a module behaves identically in-process or extracted and the split stays reversible.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Transport.cs:19`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the extraction invariant (application and domain code talks to abstractions, transport choices live at the edges) is the [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) / [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) / [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) story the doc cites (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:3-6`). `[Rubric §7, Microservices Readiness]` assesses exactly this reversibility.
- **Walkthrough**: one `[Fact]` `CoreLayers_ShouldNotDependOn_Transport` (line 13) delegating to `ArchitectureRules.TransportDoesNotLeakIntoCoreLayers(Map)`.
- **Where it's used**: subclassed in all four repos (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10`, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/MicroserviceExtractionTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3`, and Helpdesk at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:100`).

### ModuleIsolationTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a modular-monolith boundary base: a module must not reach another module's internal layers; cross-module communication goes only through the Shared (contract) layer. It is vacuous for single-module or module-less repos.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Modules.cs`), which uses `OtherModuleNamespaces` to compute the forbidden targets.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §5, Vertical Slice]` and `[Rubric §7, Microservices Readiness]` assess module autonomy. The [IModule](group-14-module-system-composition.md#imodule) system is taught in Group 14.
- **Walkthrough**: six `[Fact]`s covering each layer's isolation: `ModuleDomains_ShouldBe_Isolated` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:13`), `ModuleApplications_ShouldBe_Isolated` (line 16), `ModuleInfrastructures_ShouldBe_Isolated` (line 19), `ModuleApis_ShouldBe_Isolated` (line 22), plus the two cross-layer reach rules `ModuleDomains_ShouldNotReach_OtherModuleInfrastructures` (line 25) and `ModuleApplications_ShouldNotReach_OtherModuleInfrastructures` (line 28).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ModuleIsolationTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:15`, where the single-module seed makes it deliberately vacuous but future-proof).

### NamingConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a naming and sealing convention base across the CQRS plus DDD building blocks: handlers, command and query messages, validators, DTOs, domain events, invariants, EF configurations, specifications, and repositories each follow their established suffix and sealing convention.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Naming.cs`), which uses [RuleHelpers](#rulehelpers)`.SimpleName` to match suffixes on generic types.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §15, Best Practices & Code Quality]` and `[Rubric §16, Maintainability]` assess consistent, discoverable naming.
- **Walkthrough**: ten `[Fact]`s: `Handlers_ShouldBeSealed_WithHandlerSuffix` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:13`), `Commands_ShouldHave_CommandOrRequestSuffix` (line 16), `Queries_ShouldHave_QuerySuffix` (line 19), `Validators_ShouldHave_ValidatorOrRulesSuffix` (line 22), `SharedDtos_ShouldHave_DtoOrLookupSuffix` (line 25), `DomainEvents_ShouldBeSealed_InDomainEventsNamespace` (line 28), `InvariantClasses_ShouldBe_Static` (line 31), `EfConfigurations_ShouldBeSealed_WithConfigurationSuffix` (line 34), `Specifications_ShouldBeSealed_WithSpecificationSuffix` (line 37), `Repositories_ShouldHave_RepositorySuffix` (line 40).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/NamingConventionTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:3`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:63`).

### PiiConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: a GDPR/CCPA right-to-erasure base ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)): any domain entity that declares a [PiiAttribute](group-02-domain-building-blocks.md#piiattribute)-marked property must implement [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable), so it has an erasure path.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Governance.cs:11`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the `[Pii]` plus `IAnonymizable` soft-delete-versus-erasure model is taught in [Group 02](group-02-domain-building-blocks.md#piiattribute) ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). `[Rubric §30, Compliance / Privacy / Data Governance]` and `[Rubric §11, Security]` assess erasure discipline.
- **Walkthrough**: one `[Fact]` `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:12`) delegating to `ArchitectureRules.EntitiesWithPiiImplementAnonymizable(Map)`.
- **Where it's used**: subclassed in all four repos (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13`, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/PiiConventionTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3`, and Helpdesk at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:105`).

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
- **Where it's used**: subclassed opt-in in MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/RawQueryableConventionTests.cs:13`), Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/RawQueryableConventionTests.cs:9`), and ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/RawQueryableConventionTests.cs:11`). Because it is a ratchet, a repo's `AllowedFiles` override is the record of its remaining debt.

### SharedLayerTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: a Shared (contract) layer base: a module's Shared is contracts-only, so it must not depend on its own internal layers, on another module's Shared, or on EF Core.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Modules.cs:32`, `:51`, `:55`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §3, Clean Architecture]` and `[Rubric §5, Vertical Slice]` assess a clean contract boundary a would-be extracted consumer can reference safely.
- **Walkthrough**: three `[Fact]`s: `ModuleShared_ShouldNotDependOn_OwnInternalLayers` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:12`), `ModuleShared_ShouldBe_Isolated` (line 15), `ModuleShared_ShouldNotDependOn_EntityFrameworkCore` (line 18).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/SharedLayerTests.cs:3`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:3`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:20`).

### SliceCohesionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: a vertical-slice cohesion base: a use-case slice keeps its command or query, its handler, and its validator together in one namespace, so a feature is a cohesive unit rather than spread across horizontal `Handlers/` and `Validators/` folders.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Slices.cs:13`, `:41`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §5, Vertical Slice]` assesses feature cohesion. The doc notes MMCA.Common scopes to its Notifications slices while ADC and Store scope to their module Application layers (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:6-8`).
- **Walkthrough**: two `[Fact]`s: `Handlers_ShouldBeCoLocatedWith_TheirContracts` (line 15) and `Validators_ShouldBeCoLocatedWith_TheirContracts` (line 19).
- **Where it's used**: subclassed in all four repos (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SliceCohesionTests.cs:10`, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/SliceCohesionTests.cs:9`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:8`, and Helpdesk at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:110`).

### SpecificationConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: an opt-in base for the Specification pattern in polyglot / database-per-service repos: it guarantees no specification filters by navigating to another entity, which would not translate when that entity lives in a different physical source.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules)`.SpecificationsDoNotNavigateToOtherEntities`, backed by [CrossEntityNavigationFinder](#crossentitynavigationfinder).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) pattern is taught in Group 03. `[Rubric §8, Data Architecture]` assesses engine-portable query design.
- **Walkthrough**: one `[Fact]` `Specifications_ShouldNotNavigate_ToOtherEntities` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:16`) delegating to the rule. The doc notes single-engine repos need not subclass it (lines 4-8).
- **Where it's used**: subclassed in Store, ADC, and Helpdesk (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/SpecificationConventionTests.cs:7`, `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8`, `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:29`). MMCA.Common exercises the same rule from the other side, through [SpecificationFitnessTests](#specificationfitnesstests) (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:13`) and its private [SpecTestMap](#spectestmap) fixture (`:26`).

### StateManagementConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:17` · Level 4 · abstract class

- **What it is**: a Blazor Server state-management gate: user and session state must live in per-circuit scoped services, never in mutable `static` members (which leak one user's state to another) or in singleton-registered stateful services.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, reflection over the UI assemblies, a `Source/` file scan, and `System.Runtime.CompilerServices.CompilerGeneratedAttribute`.
- **Concept introduced, a reflection plus source-scan combined gate.** `[Rubric §19, State Management]` assesses per-circuit state safety; Blazor Server shares one process across every circuit, so a static member is shared across every user (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:5-16`).
- **Walkthrough**: the subclass supplies `Map` (line 19, whose UI assemblies must be registered under `Layer.Ui`) and optionally `AllowedStaticMembers` (line 25).
  - `UiAssemblies_CarryNoMutableStaticState` (line 28) reflects over `Map.OfLayer(Layer.Ui)`, first asserting the set is non-empty (lines 32-33), then skipping enums, interfaces, and compiler-generated types (line 40) before flagging any declared static field that is not `readonly`, not `const`, and not compiler-generated, plus any settable static property, minus the exempted members (lines 45-56).
  - `UiProjects_RegisterStatefulServicesScoped` (line 66) scans `Source/` `.cs` files (skipping `obj`, `bin`, non-`.UI` paths, and `Testing` paths, lines 74-80) for a line containing both `AddSingleton` and a `StateService`/`StateContainer` name, recording `fileName:lineNumber` as an offender (lines 85-90).
  - The private `GetLoadableTypes` (line 99) repeats the tolerant load locally rather than using the internal [RuleHelpers](#rulehelpers), and `IsCompilerGenerated` (line 111) treats any member name containing `<` as generated, or one carrying `CompilerGeneratedAttribute`.
- **Where it's used**: subclassed in the repos with Blazor UI assemblies: MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:11`), Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/StateManagementConventionTests.cs:10`), and ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:9`).

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
- **Where it's used**: subclassed in the repos with Blazor UI: MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/UIArchitectureConventionTests.cs:11`), Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/UIArchitectureConventionTests.cs:9`), and ADC (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:10`).

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
- **Where it's used**: read by [E2ETestBase](#e2etestbase)`.LoginAsAdminAsync` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:91-92`). Both consumer suites overwrite the default from a module initializer: `admin@mmca.com` in Store (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Infrastructure/TestSetup.cs:10`) and `admin@adc.com` in ADC (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Infrastructure/TestSetup.cs:14`).

### AxeOptions
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9` · Level 0 · static class

- **What it is**: the shared axe-core run options that scope every accessibility scan to one documented target, WCAG 2.1 AA, so the framework gallery and all downstream apps scan against the same rule set.
- **Depends on**: `Deque.AxeCore.Commons` (NuGet: `AxeRunOptions`, `RunOnlyOptions`, `RuleOptions`, `MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:1`; see [primer §3](00-primer.md#3-the-external-stack-bcl--nuget-external-level-0)).
- **Concept introduced, the scoped accessibility target.** A raw axe run also emits "best-practice" advisories that are not conformance failures; pinning `RunOnly` to the WCAG tag set makes the gate fail only on real WCAG 2.1 AA violations (`AxeOptions.cs:11-16`). `[Rubric §21, Accessibility]` assesses whether the accessibility bar is explicit and enforced; freezing the target in one shipped object is how three repos stay honest to the same standard. `[Rubric §22, Responsive/Cross-Browser]` also applies through the pager exception below, which documents a specific third-party component limitation.
- **Walkthrough**: two static presets, both read-only properties initialized once.
  - `Wcag21Aa` (`AxeOptions.cs:17`) sets `RunOnly` to `Type = "tag"` with the four WCAG A/AA tag values `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` (`:19-23`). This is the target for every strict scan.
  - `Wcag21AaExceptMudPagerCombobox` (`:35`) repeats that tag set and adds a `Rules` dictionary disabling `aria-input-field-name` (`:42-45`), for grid list pages whose only violation is MudBlazor's internal `MudTablePager` "rows per page" select. The XML doc (`:26-34`) records the detail: MudBlazor 9.6.0 mirrored combobox semantics onto the hidden-input presenter, the pager's own select gets no accessible name, and it is not reachable from app markup (no `Label` or `aria-label` parameter on `MudTablePager`), so this is an accepted upstream limitation. The doc warns it must be used only on a page whose sole combobox is a pager.
- **Why it's built this way**: shipping the options in the package rather than re-declaring them per test guarantees every consumer scans the identical rule set; the narrowly scoped pager exception keeps one known third-party gap from forcing a blanket rule-disable across all scans.
- **Where it's used**: passed to [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync` through [E2ETestBase](#e2etestbase)`.ScanAsync` (strict `Wcag21Aa`, `MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:296`) and `.ScanGridAsync` (the pager exception, `:288`), and directly by the `*_ShouldHaveNoAccessibilityViolations` facts on [UserLoginTestsBase](#userlogintestsbase), [UserRegistrationTestsBase](#userregistrationtestsbase), and [ProfileManagementTestsBase](#profilemanagementtestsbase).

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
- **Where it's used**: instantiated throughout [ProfileManagementTestsBase](#profilemanagementtestsbase), and directly by ADC's own `ProfileManagementTests`, which drives the same Page Object off [E2ETestBase](#e2etestbase) instead of the shared base (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:15`).

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
- **Where it's used**: read by [E2ETestBase](#e2etestbase)`.LoginAsUserAsync` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:94-95`); the default is overridden to `customer@mmca.com` in Store and `customer@adc.com` in ADC (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Infrastructure/TestSetup.cs:11`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Infrastructure/TestSetup.cs:15`).

### WebVitalsSample
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:76` · Level 0 · sealed record

- **What it is**: an immutable record holding one page's measured Core Web Vitals: `Lcp`, `Cls`, `Fcp`, `Ttfb`, and `Inp` (milliseconds, except unitless CLS).
- **Depends on**: `System.Text.Json.Serialization.JsonPropertyName` (BCL) for the lowercase wire names.
- **Concept introduced, the vitals value object.** Each property is `init`-only with a short JSON name (`lcp`, `cls`, `fcp`, `ttfb`, `inp`, `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:78-86`), so the record deserializes directly from the `window.__vitals` JSON the browser observers accumulate. `[Rubric §23, Front-End Performance]` assesses whether client-side performance is measured; this record is the typed shape those measurements land in.
- **Walkthrough**: a sealed record with five `init` doubles and no behavior (`WebVitalsCollector.cs:76-87`). It is the deserialization target of [WebVitalsCollector](#webvitalscollector)`.CollectAsync`, which falls back to a fresh all-zero instance when the JSON deserializes to null (`:56`).
- **Where it's used**: produced by [WebVitalsCollector](#webvitalscollector)`.CollectAsync`, wrapped by [WebVitalsArtifact](#webvitalsartifact) for the JSON artifact, and asserted by [WebVitalsBudget](#webvitalsbudget)`.AssertWithinBudget`.

### PageExtensions
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:19` · Level 1 · static class

- **What it is**: the interactivity toolbox of the E2E package: C# `extension(T)` members over Playwright's `IPage` and `ILocator` that wait for Blazor to become interactive, navigate its InteractiveAuto pages correctly, fill and click through the re-hydration race, and run an axe-core accessibility scan.
- **Depends on**: `Microsoft.Playwright` (`IPage`, `ILocator`, `Assertions`), `Deque.AxeCore.Playwright`/`Commons` (`RunAxe`, `AxeRunOptions`), and `System.Text.RegularExpressions` (`MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:1-5`). It throws [AccessibilityViolationException](#accessibilityviolationexception).
- **Concept introduced, waiting for Blazor InteractiveAuto interactivity.** The apps render with InteractiveAuto plus prerendering, so a page first appears as static HTML before the WASM runtime (or the SignalR circuit) wires event handlers; a click or fill that lands in that window is silently ignored (`PageExtensions.cs:9-14`). These helpers replace fixed sleeps with signal-based waits, which is the difference between a flaky suite and a deterministic one. `[Rubric §28, Front-End Testing]` assesses whether the suite is reliable against real render timing; `[Rubric §21, Accessibility]` applies through the axe scan; `[Rubric §22, Responsive/Cross-Browser]` because the same waits must hold on all three engines. The type also demonstrates the `extension(T)` member syntax used across the framework (see [primer §4](00-primer.md#c-extensiont-types-read-this-once)).
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
- **Walkthrough**: `Playwright` and `Browser` are public properties with private setters (`:8-9`). `InitializeAsync` creates the driver (`:13`), switches on `E2ETestConfiguration.Browser.ToUpperInvariant()` to pick Firefox, WebKit, or (for any unrecognized value) Chromium (`:17-22`), and launches it with `Headless` and `SlowMo` from configuration (`:24-28`). `DisposeAsync` suppresses finalization, then disposes the browser and the driver defensively (`:31-44`): the browser is disposed only through an `is { } browser` pattern match and the driver through a null-conditional call, because a failed `InitializeAsync` (missing browser binaries, a launch timeout) leaves both null despite the `null!` declarations, and the resulting `NullReferenceException` from disposal used to replace the real launch error in the run output (`:35-37`).
- **Where it's used**: bound to the collection by [E2ETestCollection](#e2etestcollection) and injected into every [E2ETestBase](#e2etestbase) subclass, which opens a fresh browser context per test off this shared `Browser`.

### WebVitalsArtifact
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:90` · Level 1 · sealed record

- **What it is**: the small envelope record written to disk as `web-vitals-{label}.json`: a `Label`, the page `Path`, and the measured [WebVitalsSample](#webvitalssample).
- **Depends on**: [WebVitalsSample](#webvitalssample); serialized with `System.Text.Json`.
- **Concept**: the citable-artifact wrapper. Pairing the raw vitals with the label and path they were taken on makes the JSON file self-describing for a CI reviewer. `[Rubric §23, Front-End Performance]` assesses whether performance evidence is captured and traceable; the envelope is what makes an uploaded artifact interpretable.
- **Walkthrough**: a three-parameter positional sealed record (`MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:90`), constructed inside [WebVitalsCollector](#webvitalscollector)`.WriteArtifactAsync` and serialized with the shared `WriteIndented = true` options (`:37`, `:69-71`).
- **Where it's used**: only by [WebVitalsCollector](#webvitalscollector)`.WriteArtifactAsync`.

### WebVitalsBudget
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:103` · Level 1 · sealed record

- **What it is**: a per-page Core Web Vitals budget (five ceilings) plus the assertion mechanics every consumer's budget test shares: format the sample as one citable line, then assert each metric is within its ceiling.
- **Depends on**: [WebVitalsSample](#webvitalssample), `AwesomeAssertions` (the `Should().BeLessThanOrEqualTo(...)` calls, `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:4`), and `System.Globalization` for culture-invariant formatting (`:1`).
- **Concept introduced, the shared budget with consumer-owned numbers.** [WebVitalsCollector](#webvitalscollector) measures; this record decides what counts as too slow, and the split is deliberate: the *mechanics* (which metrics, how they are formatted, how a missing INP sample is treated) belong in the framework, while the *numbers* stay with each consumer, whose runners and hosting differ and therefore whose calibrated maxima differ (`WebVitalsCollector.cs:92-97`). The defaults are the Core Web Vitals "good" band, so a consumer that measured nothing tighter can take the record as-is. `[Rubric §23, Front-End Performance]` assesses whether front-end performance carries an enforced budget rather than an occasional audit; `[Rubric §12, Performance & Scalability]` is the tag the source itself uses for the collector pair. `[Rubric §17, DevOps]` applies because in both consumer repos these assertions ride the deploy-gating chromium E2E leg.
- **Walkthrough**: a positional record with five defaulted parameters, `Lcp = 2500`, `Fcp = 1800`, `Ttfb = 800`, `Cls = 0.1`, `Inp = 500` (`WebVitalsCollector.cs:103-108`), all milliseconds except the unitless CLS. Two members.
  - The static `Describe(label, path, sample)` (`:118`) renders one invariant-culture line, `[web-vitals:{label}] path=... LCP=...ms FCP=...ms CLS=... TTFB=...ms INP-sample=...ms`, with CLS at three decimals and the rest at zero (`:122-124`), which is the record a reviewer greps for next to the uploaded JSON artifact.
  - `AssertWithinBudget(sample, label, path, writeLine = null)` (`:137`) invokes the optional sink with that line (normally `ITestOutputHelper.WriteLine`, `:141`), then asserts LCP, FCP, TTFB, and CLS against their ceilings (`:143-146`). INP is asserted **only when `sample.Inp > 0`** (`:148-151`), because no interaction clearing the collector's 16 ms event threshold leaves the sample at 0, and 0 must read as neither a pass-by-absence nor a failure. Failure text comes from the private `Message` helper, which names the metric, the measured value, the ceiling, and the page path (`:154-157`).
- **Why it's built this way**: keeping the numbers consumer-side while shipping the assert body is what lets ADC and Store hold different calibrated budgets without either repo re-deriving the INP-zero rule or the message format. The 0-INP carve-out is the subtle one, and it is pinned by its own unit test rather than left to a comment (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitalsBudgetTests.cs:58-64`).
- **Where it's used**: ADC holds one static default instance and takes the framework numbers as-is (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:27`, asserted at `:79`); Store constructs one per measurement (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/WebVitalsTests.cs:68`, `:94`). The framework's own gallery suite instead asserts against local constants tuned for the backend-less host (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitalsE2ETests.cs:18-20,43-45`), and `WebVitalsBudgetTests` covers the record's mechanics without starting a browser (`WebVitalsBudgetTests.cs:12`).

### E2ETestCollection
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:48` · Level 2 · sealed class

- **What it is**: the xUnit `[CollectionDefinition]` that binds [PlaywrightFixture](#playwrightfixture) to the named `"E2E"` collection, so every E2E test class shares the one launched browser.
- **Depends on**: xUnit's `ICollectionFixture<PlaywrightFixture>` and the `[CollectionDefinition]` attribute (`MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:47-48`).
- **Concept introduced, the xUnit collection fixture binding.** A collection fixture is instantiated once and shared by every test class that opts into the collection by name. This class carries a `public const string Name = "E2E"` (`:50`) used both in its own `[CollectionDefinition(Name)]` and in each test's `[Collection(E2ETestCollection.Name)]`, so the string is declared once and cannot drift. `[Rubric §14, Testability]` assesses fixture design; a single named constant binding is the robust way to share a fixture.
- **Walkthrough**: an otherwise empty class body carrying the collection definition and the `Name` constant (`:47-51`). It exists purely as an xUnit marker, and it lives in the same file as the fixture it binds.
- **Where it's used**: referenced by [E2ETestBase](#e2etestbase)'s `[Collection(E2ETestCollection.Name)]` attribute (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:7`), so every workflow base and every consumer subclass inherits collection membership.
- **Caveats / not-in-source**: xUnit collection definitions do not cross assembly boundaries, so each consumer E2E assembly re-declares its own identically named definition over the same fixture type (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Infrastructure/E2ETestCollection.cs:7-11`).

### WebVitalsCollector
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:20` · Level 2 · static class

- **What it is**: the measurement infrastructure for client-side Core Web Vitals. It installs browser `PerformanceObserver` scripts before first paint, reads the accumulated values back off a live page, and writes them as a citable JSON artifact.
- **Depends on**: `Microsoft.Playwright` (`IPage`), `System.Text.Json`, and `System.IO` (`MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:1-5`). It produces [WebVitalsSample](#webvitalssample) and [WebVitalsArtifact](#webvitalsartifact), and pairs with [WebVitalsBudget](#webvitalsbudget).
- **Concept introduced, in-browser performance measurement with no third-party JS.** Rather than shipping an analytics SDK, it injects a small init script that installs `PerformanceObserver`s for LCP, CLS, FCP, and INP, each wrapped in try/catch so an engine lacking an entry type leaves that metric at 0 instead of throwing, and accumulates into `window.__vitals` (`:26-35`). The type doc is explicit that this is the client-side analogue of a backend load test, not a cross-engine field measurement: LCP and CLS are Chromium-only, so on Firefox and WebKit those fields stay 0 and budget assertions pass (`:9-18`). `[Rubric §23, Front-End Performance]` and `[Rubric §12, Performance & Scalability]` assess whether user-centric performance is measured; observing the vitals APIs directly, with no network egress, is a self-contained way to do it. The same doc states the class is only the measurement infrastructure, that [WebVitalsBudget](#webvitalsbudget) is the shared assert mechanics, and that consumers own which pages carry a budget and what the numbers are (`:16-18`).
- **Walkthrough**: `InstallAsync` registers the observers through `AddInitScriptAsync` so they are active on the next navigation (`:40-44`). `CollectAsync` evaluates a script that stamps TTFB from Navigation Timing and returns `window.__vitals` as JSON, deserialized into a [WebVitalsSample](#webvitalssample) (`:47-57`). `WriteArtifactAsync` resolves the output directory from `WEB_VITALS_OUTPUT_DIR` or falls back to `artifacts/` under the current directory, creates it, wraps the sample in a [WebVitalsArtifact](#webvitalsartifact), and writes `web-vitals-{label}.json` indented (`:63-72`).
- **Why it's built this way**: the observers install before the document's own scripts (through `AddInitScript`) so early metrics such as FCP are not missed, and the per-observer try/catch is what makes the same code run green on all three engines despite the Chromium-only metrics. The init script is kept as one concatenated string rather than a raw literal to stay clear of the MA0136 analyzer (`:22-25`).
- **Where it's used**: by the budget-asserting tests each repo owns, which install, navigate, collect, assert, and write the artifact for CI upload: the framework's own gallery suite (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitalsE2ETests.cs:37-41`), ADC (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:58`, `:76-77`), and Store (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/WebVitalsTests.cs:73`, `:91-92`).

### E2ETestBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:8` · Level 3 · abstract class

- **What it is**: the shared base every E2E test class derives from. It gives each test a fresh isolated browser context and page off the shared [PlaywrightFixture](#playwrightfixture) browser, plus the load-bearing auth helpers (login, register, deterministic session cleanup) and the accessibility scan helpers.
- **Depends on**: [PlaywrightFixture](#playwrightfixture), [E2ETestConfiguration](#e2etestconfiguration), [AxeOptions](#axeoptions), the [PageExtensions](#pageextensions) helpers, xUnit's `IAsyncLifetime` and `TestContext`, and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:1-3`).
- **Concept introduced, the per-test browser context.** The fixture launches one browser; this base opens a new `IBrowserContext` (an isolated cookie and storage jar) per test in `InitializeAsync` and disposes it in `DisposeAsync`, so tests cannot leak session state into each other. It is the E2E analogue of the integration-test base's per-test database reset. `[Rubric §28, Front-End Testing]` assesses realistic, isolated UI tests; `[Rubric §21, Accessibility]` applies through the scan helpers; `[Rubric §14, Testability]` through the shared, correctly sequenced auth helpers every workflow reuses. The auth-result handling also touches `[Rubric §22, Responsive/Cross-Browser]`, since the same waits must survive Server-mode and WASM render timing on any engine.
- **Walkthrough**: teaching order.
  - Lifecycle. The fixture arrives through the constructor and the current `Page` is a protected property (`:10-17`). `InitializeAsync` creates a context with `IgnoreHTTPSErrors` and the base URL, sets the default timeout from configuration, optionally starts trace capture with screenshots, snapshots, and sources when `TracePath` is set, and opens the `Page` (`:19-37`). `DisposeAsync` stops tracing, closes the page, and disposes the context, each step guarded by a null check because a failed `InitializeAsync` leaves the fields null and the resulting `NullReferenceException` would otherwise mask the real setup error (`:39-61`). The private `StopTracingAsync` (`:67-89`) carries the per-test trace policy: a plain file path keeps the single-file behavior, while a directory path writes a trace named after the current test only when that test failed (`TestContext.Current.TestState?.Result == TestResult.Failed`, `:78-84`), so a full-suite run yields just the failing traces with no overwriting.
  - Auth entry points. `LoginAsAdminAsync` and `LoginAsUserAsync` (`:91-95`) delegate to `LoginAsync` with the [AdminCredentials](#admincredentials) and [UserCredentials](#usercredentials) pair. `LoginAsync` (`:97-144`) first clears any existing session when a sign-out button is visible, removing the `auth_access_token` and `auth_refresh_token` localStorage entries and issuing a `DELETE /auth/session-cookie` fetch, guarded against the context-destroyed race from an in-flight logout (`:105-121`); it then navigates to `/login`, fills through `FillFieldAsync`, clicks, and awaits `WaitForAuthResultAsync` followed by `WaitForInteractiveOrReloadAsync`. `RegisterNewUserAsync` (`:146-179`) generates a unique `e2e-{id}@test.com` email with the fixed password `TestPass123!`, fills the register form, submits, runs the same two post-auth waits, and returns the created credentials.
  - Post-auth robustness. `WaitForInteractiveOrReloadAsync` (`:192-203`) waits for interactivity and, on either a `PlaywrightException` or a `TimeoutException`, reloads once and re-waits rather than watching the same stuck boot; the comment records why both exception types are caught (Playwright's `TimeoutException` derives from `System.TimeoutException`, not `PlaywrightException`, so an earlier single catch skipped the retry entirely) and why a reload beats a re-wait (the framework assets are now HTTP-cached, `:181-191`). `WaitForAuthResultAsync` (`:213-236`) races three signals through `Task.WhenAny`, leaving the auth page, the logout button appearing, or an error alert appearing, so success detection does not depend on the interactive button having hydrated; only an error alert still visible on the auth page after the grace window is a real failure, raised as an `InvalidOperationException` carrying the alert text. `AuthSucceededWithinGraceAsync` (`:241-259`) implements that grace window, falling back to the logout-button signal when no navigation occurs.
  - Helpers. `NavigateAndWaitAsync` (`:261-262`), the shared static `FillFieldAsync` delegating to [PageExtensions](#pageextensions)`.FillAndVerifyAsync` (`:269-270`), `UniqueId` (`:272`), and the two scan helpers. `ScanGridAsync` (`:283-289`) waits for a visible data row and for zero `[role='progressbar']` elements, then scans with [AxeOptions](#axeoptions)`.Wcag21AaExceptMudPagerCombobox`; `ScanAsync` (`:293-297`) applies the progressbar guard only and scans strictly with `Wcag21Aa`.
- **Why it's built this way**: the auth helpers encode hard-won timing knowledge once (the `forceLoad` reload, the Server-versus-WASM hydration lag, the cookie-and-localStorage dual session store), so every consumer workflow inherits a deterministic sign-in instead of re-deriving the races. Clearing both token stores is essential: the Blazor Server host is cookie-only, so a localStorage clear alone would leave the next login authenticated as the wrong user (`:99-104`). The scan split lets grid pages accept the documented pager-combobox exception while every other page stays strict, and the grid wait keys off a data row rather than the loading bar hiding, which would resolve instantly before the transient unnamed progressbar even appears (`:274-282`).
- **Where it's used**: the base class of all six workflow bases in this unit ([AuthorizationTestsBase](#authorizationtestsbase), [LogoutTestsBase](#logouttestsbase), [ProfileManagementTestsBase](#profilemanagementtestsbase), [UserLoginTestsBase](#userlogintestsbase), [UserPreferencesTestsBase](#userpreferencestestsbase), [UserRegistrationTestsBase](#userregistrationtestsbase)) and, through them and directly, every E2E test class in the ADC and Store suites (for example ADC's own `ProfileManagementTests`, which derives from this base rather than the shared profile workflow, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:8`).

### AuthorizationTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:18` · Level 4 · abstract class

- **What it is**: the reusable authorization workflow fitness base, authored once and re-run as a thin subclass per repo. It asserts that anonymous users are redirected off protected paths, that public paths stay reachable, that a registered non-admin can reach an authenticated page, and that a non-admin probing admin routes gets the Forbidden page.
- **Depends on**: [E2ETestBase](#e2etestbase), [PageExtensions](#pageextensions) (`GotoAndWaitForBlazorAsync`, `GotoProtectedAsync`), AwesomeAssertions, and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:1-6`).
- **Concept introduced, the authored-once workflow fitness base.** This is the pattern shared by all six bases in this unit: the framework owns the assertions and the SSR-versus-client-navigation mechanics, and each consumer supplies only its own route lists through abstract or virtual members, so identical security behavior is verified across repos without copying test bodies (`:10-17`). `[Rubric §11, Security]` assesses whether authorization is actually exercised; this base machine-checks both the anonymous-redirect and the authenticated-non-admin-escalation directions. `[Rubric §25, Navigation & IA]` applies because it pins which routes are public and which are gated.
- **Walkthrough**: the subclass supplies `ProtectedPaths` and `PublicPaths` (abstract, `:26`, `:29`) and optionally `AuthenticatedUserPath` and `AdminPaths` (virtual, defaulting to null and an empty list, `:35`, `:44`). Four facts follow. `AnonymousUser_ProtectedPages_ShouldRedirectToLogin` asserts each protected path bounces to `/login` (`:46-58`). `AnonymousUser_PublicPages_ShouldBeAccessible` asserts each public path stays put (`:60-72`). `RegisteredUser_AuthenticatedPage_ShouldBeAccessible` registers a non-admin, then client-navigates through `GotoProtectedAsync` because SSR cannot read the JWT, passing vacuously when no path is declared (`:74-93`). `RegisteredUser_AdminPages_ShouldBeForbidden` registers a non-admin, then asserts each admin path renders the shared Forbidden page, matching `h1[role='alert']` containing "Access Denied", with the comment noting that role denial is not a redirect so the page content is the only reliable signal (`:95-120`).
- **Why it's built this way**: the two optional members use a no-dynamic-skip convention (an app with no such page simply passes) because the shipped library deliberately does not reference `xunit.v3.assert` for a declared skip (`:77-78`, `:98-99`). The non-empty assertions on `ProtectedPaths` and `PublicPaths` (`:49-50`, `:63-64`) are non-vacuity guards: a repo that declares no paths fails rather than passing silently.
- **Where it's used**: subclassed in both consumer E2E suites with that app's route lists (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/AuthorizationTests.cs:11-21`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/AuthorizationTests.cs:11-22`); Store's subclass also adds one app-specific fact of its own, an anonymous order-detail deep link that must leak no order content (`AuthorizationTests.cs:23-37`).

### LogoutTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/LogoutTestsBase.cs:9` · Level 4 · abstract class

- **What it is**: the reusable logout workflow base. It verifies that sign-out returns the user to the login screen and that a logged-out user can no longer reach a protected page.
- **Depends on**: [E2ETestBase](#e2etestbase), [PageExtensions](#pageextensions) (`WaitForBlazorAsync`), and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Identity/LogoutTestsBase.cs:1-5`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase). `[Rubric §11, Security]` assesses session teardown; this base guards that logout genuinely revokes access rather than merely returning to a login screen visually.
- **Walkthrough**: two facts. `Logout_ShouldRedirectToLoginPage` registers, confirms the sign-out button is visible, clicks it, waits for the load state, and asserts the sign-in button appears (`:16-29`). `Logout_ShouldPreventAccessToProtectedPages` registers, waits for interactivity (because `RegisterNewUserAsync` can return with the button visible before JS interop is ready, `:40`), then clicks sign-out inside `RunAndWaitForResponseAsync` so it blocks until the best-effort `DELETE /auth/session-cookie` response arrives (`:47-51`), confirms the sign-in button is visible (`:54-55`), and then re-requests `/profile` up to six times until the server redirects to `/login` (`:64-72`), falling back to a clear URL assertion if it never does (`:75`).
- **Why it's built this way**: waiting for the cookie-clear response is the fix for a real full-speed race. At speed the test otherwise reaches `/profile` before the DELETE finishes, so the HttpOnly cookie is still present and SSR re-authenticates. The bounded re-request loop converges deterministically where any slowdown (slow-mo, or even trace capture) would have hidden the race entirely (`:42-46`, `:57-63`).
- **Where it's used**: subclassed in both consumer E2E suites (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/LogoutTests.cs:5`, `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/LogoutTests.cs:5`).

### ProfileManagementTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/ProfileManagementTestsBase.cs:11` · Level 4 · abstract class

- **What it is**: the reusable profile workflow base. It verifies that name, address, and password changes persist, that the profile page loads pre-filled with the registered data, an opt-in email-change journey, and that the profile page is accessibility-clean.
- **Depends on**: [E2ETestBase](#e2etestbase), [ProfilePage](#profilepage), [PageExtensions](#pageextensions), [AxeOptions](#axeoptions), AwesomeAssertions, and `Microsoft.Playwright` (`MMCA.Common.Testing.E2E/Workflows/Identity/ProfileManagementTestsBase.cs:1-7`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase), here driving a [ProfilePage](#profilepage). `[Rubric §24, Forms/Validation/UX Safety]` assesses whether edit-and-persist journeys work end to end; `[Rubric §21, Accessibility]` applies through the a11y fact.
- **Walkthrough**: one virtual switch, `ProfileSupportsEmailChange`, off by default (`:24`). Six facts follow. `ChangeName_ShouldUpdateProfileName` clears and fills both name fields, saves, re-navigates, and asserts the values persisted (`:26-53`); `ChangeAddress_ShouldUpdateProfileAddress` does the same for the five address fields and asserts on line 1 (`:55-78`). Both use Playwright's plain `FillAsync` rather than the re-hydration-safe helper, since the profile page is reached by client-side navigation on an already interactive runtime. `ChangePassword_WithValidCurrentPassword_ShouldSucceed` fills the three password fields through the shared `FillFieldAsync`, waits for the "Password changed successfully." snackbar, then signs out and logs back in with the new password, waiting for the logout `forceLoad`'s `/login` URL rather than `LoadState.Load` so it does not race the in-flight navigation (`:80-110`). `ChangeEmail_ShouldUpdateEmail` is opt-in and returns immediately unless `ProfileSupportsEmailChange` is overridden true (`:112-146`). `ProfilePage_ShouldLoadWithUserData` asserts the form is pre-filled from registration (`:148-166`). `ProfilePage_ShouldHaveNoAccessibilityViolations` scans with [AxeOptions](#axeoptions)`.Wcag21Aa` (`:168-181`).
- **Why it's built this way**: the email-change fact is a declared opt-in rather than a DOM probe because the previous probing version passed vacuously when the field was absent, reporting coverage for a journey the app does not offer; overriding the flag makes a missing field fail loud (`:18-23`, `:129-131`). The logout-then-login URL wait is called out in the source as the one remaining sign-out-then-login site still on the racy pattern, fixed to match [UserLoginTestsBase](#userlogintestsbase) (`:100-105`).
- **Where it's used**: subclassed only by Store, with no additions and no override of `ProfileSupportsEmailChange` (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:5`), so the email-change fact passes without exercising a journey Store offers. ADC does **not** subclass this base: its profile page supports only password change and account deletion, so `MMCA.ADC.E2E.Tests` writes its own `ProfileManagementTests` directly on [E2ETestBase](#e2etestbase) with a password-change fact and a `/profile/claims` fact (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:8`, `:10-38`, `:40-52`).

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
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:12` · Level 0 · static class

- **What it is**: a small set of intention-revealing helpers over bUnit's element API so a component test can say "click the button labelled Save" instead of hand-rolling a DOM query, deliberately preferring accessible text over brittle CSS-path selectors (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:7-11`).
- **Depends on**: no first-party types. Three externals: AngleSharp's `IElement` (the DOM node type bUnit returns, `:1`), bUnit's `IRenderedComponent<TComponent>` (`:2`), and `Microsoft.AspNetCore.Components.IComponent` as the generic constraint (`:3`). See [primer §3](00-primer.md#3-the-external-stack-bcl--nuget-external-level-0) for the external stack.
- **Concept introduced, `extension(T)` blocks used for something other than DI.** Everywhere else in this codebase the C# preview extension-member syntax registers services ([primer §4](00-primer.md#c-extensiont-types-read-this-once)); here the same feature is used to bolt query and interaction members onto a third-party generic type. The declaration is `extension<TComponent>(IRenderedComponent<TComponent> cut) where TComponent : IComponent` (`:14-16`), so the extension block is itself generic over the component type and the members inside read as instance methods on the rendered component (`cut.ClickButtonByText("Save")`). `[Rubric §28, Front-End Testing]` assesses whether UI behavior is exercised through realistic automated checks; querying by the text a user actually sees is what keeps a component test asserting on behavior rather than on markup structure. `[Rubric §16, Maintainability]` assesses how well the code resists churn; a CSS-path selector breaks on any wrapper change, while a text query survives it.
- **Walkthrough**: three members, all inside the single extension block.
  - `FindButtonByText(string text)` (`:18-25`) materializes every `<button>` via `cut.FindAll("button")` (`:20`), then takes the first whose `TextContent` contains `text` under `StringComparison.OrdinalIgnoreCase` (`:21`). On no match it throws an `InvalidOperationException` whose message enumerates the trimmed text of every button present, pipe-separated (`:22-24`), so a failing test names the buttons it could see instead of reporting a bare null.
  - `ClickButtonByText(string text)` (`:28-29`) is the action form: it delegates to `FindButtonByText` and calls bUnit's `Click()`, which raises the component's `onclick` through the renderer.
  - `HasText(string text)` (`:32-33`) is the read form, a case-insensitive `Contains` over `cut.Markup`. It answers on the whole rendered markup, not only visible text, which is the trade-off for having no dependency beyond the rendered string.
- **Why it's built this way**: the diagnostic message is the point. bUnit's own `Find(selector)` throws with the selector, which tells you nothing when the button simply rendered with different copy; listing the actual buttons turns a red test into a readable one on the first run.
- **Where it's used**: by the shared UI's own page tests, for example `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Notifications/NotificationSendTests.cs:28,55,71` and `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Notifications/NotificationInboxTests.cs:138`, and by the ADC and Store component suites that derive from [BunitComponentTestBase](#bunitcomponenttestbase).
- **Caveats / not-in-source**: `HasText` matches attribute values and element names too, since it searches raw markup; a test asserting on user-visible copy that happens to collide with a CSS class name would pass for the wrong reason.

### CapturedRequest
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:129` · Level 0 · sealed record

- **What it is**: the immutable snapshot of one HTTP request a UI service sent, recorded by [CapturingHttpMessageHandler](#capturinghttpmessagehandler) so a test can assert on what went out, not only on what came back (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:125-128`).
- **Depends on**: BCL only, `System.Net.Http.HttpMethod` and `System.Uri`. No first-party types.
- **Concept introduced, capture-then-assert on the outbound side.** A canned-response fake proves the service handles a given payload; it says nothing about whether the service built the right URL, attached the bearer token, or serialized the right body. Recording every request as a value object makes those assertions possible without a server. `[Rubric §14, Testability]` assesses how much of a component's contract can be verified in isolation; capturing the request turns the client's outbound contract (route, query string, Authorization header, body) into something a unit test can pin. `[Rubric §9, API and Contract Design]` applies indirectly: these captures are where a UI service's assumed route shape is asserted against the API's actual one.
- **Walkthrough**: six positional members (`:129-135`), each recorded by the handler's `CaptureAsync` (`:81-87`). `Method` is the verb; `Uri` is the full request URI and is nullable because `HttpRequestMessage.RequestUri` is; `Path` is `uri?.AbsolutePath` with an empty-string fallback (`:84`); `PathAndQuery` keeps the query string that `Path` drops (`:85`), which is what a paging or filter assertion needs; `Authorization` is the header rendered back to a string, or null when absent (`:86`); `Body` is the content read as text, left null when the request had no content (`:74-78`). Being a record, structural equality and a readable `ToString()` come for free, which is what makes a failing assertion legible.
- **Where it's used**: exposed as the ordered `IReadOnlyList<CapturedRequest>` on [CapturingHttpMessageHandler](#capturinghttpmessagehandler)`.Requests` (`:41`) and filtered by its `RequestsFor(method, absolutePath)` (`:60-64`); consumed by every UI HTTP-service test in the three repos, for example `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/CapturingHttpMessageHandlerTests.cs:208-209`.

### FreshApiClientFactory
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:73` · Level 0 · sealed class

- **What it is**: an `IHttpClientFactory` test double that returns a brand-new `HttpClient` on every `CreateClient` call, whatever name is asked for (in practice `"APIClient"`), all wired to one shared handler with a fixed base address (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:66-72`).
- **Depends on**: `System.Net.Http.IHttpClientFactory` and `HttpMessageHandler` (BCL). Constructed with a [CapturingHttpMessageHandler](#capturinghttpmessagehandler) in practice, by [UiHttpServiceHarness](#uihttpserviceharness) (`:47`) and by [HttpTestDoubles](#httptestdoubles)`.ClientFactory` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:23-24`).
- **Concept introduced, a fake whose lifetime semantics are load-bearing.** The shared UI services acquire a client per call and dispose it afterwards, so a factory double that caches one instance would hand the second call a disposed client and fail with an `ObjectDisposedException` that looks like a product bug. The XML doc states exactly that ("A fresh instance per call is load-bearing", `:69-71`). `[Rubric §14, Testability]` assesses whether test doubles reproduce the real collaborator's contract; matching `IHttpClientFactory`'s ownership semantics, not just its signature, is the difference between a double that works and one that misleads.
- **Walkthrough**: a primary-constructor class taking `(HttpMessageHandler handler, Uri baseAddress)` (`:73`) with one member. `CreateClient(string name)` (`:79-80`) ignores the name and returns `new HttpClient(handler, disposeHandler: false) { BaseAddress = baseAddress }`. The `disposeHandler: false` flag is the second load-bearing detail: it lets the handler outlive each client, so the recorded [CapturedRequest](#capturedrequest) list survives across calls and the harness alone owns handler disposal (`:63`).
- **Why it's built this way**: ignoring the client name keeps the double usable from any repo without knowing the named-client key the service under test resolves, while the shared handler keeps one capture log per test.
- **Where it's used**: exposed as [UiHttpServiceHarness](#uihttpserviceharness)`.ClientFactory` (`:47,58`) and returned from [HttpTestDoubles](#httptestdoubles)`.ClientFactory` (`HttpTestDoubles.cs:23-24`); the fresh-instance contract is asserted directly in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/SharedHttpTestDoublesTests.cs:24-29`.

### IsAuthenticatedAuthorizationService
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:111` · Level 0 · private sealed nested class

- **What it is**: the permissive-but-real `IAuthorizationService` that [BunitComponentTestBase](#bunitcomponenttestbase) registers, so any policy succeeds for an authenticated principal and fails for an anonymous one.
- **Depends on**: `Microsoft.AspNetCore.Authorization` (`IAuthorizationService`, `AuthorizationResult`, `IAuthorizationRequirement`, `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:3`) and BCL `ClaimsPrincipal`. Nested privately inside its only consumer.
- **Concept introduced, collapsing policy evaluation to the authentication bit.** A component test cares whether the authorized branch of `<AuthorizeView>` renders, not whether a named policy's requirement handlers are wired; re-hosting the real policy provider in every test project would couple UI tests to each app's policy catalogue. This double answers by identity alone, which keeps the render assertion honest about the branch while staying agnostic about policy names. `[Rubric §11, Security]` assesses how authorization is expressed and enforced; note the deliberate inversion here, this double grants every policy, so it proves a page renders when signed in and never proves a policy actually denies. `[Rubric §14, Testability]` assesses how cheaply a component renders in isolation; one class replaces a whole policy graph.
- **Walkthrough**: two members, both `IAuthorizationService` overloads. The requirements overload (`:113-117`) returns `AuthorizationResult.Success()` when `user.Identity?.IsAuthenticated == true` and `AuthorizationResult.Failed()` otherwise, wrapped in `Task.FromResult` so no async machinery is allocated. The policy-name overload (`:119-120`) delegates to the first with an empty requirement collection, so a `[Authorize(Policy = "X")]` component takes the same identity-only decision.
- **Where it's used**: registered as a singleton `IAuthorizationService` in the [BunitComponentTestBase](#bunitcomponenttestbase) constructor (`:45`), immediately after `AddAuthorizationCore()` (`:44`), so it wins over the core default for every derived component test.
- **Caveats / not-in-source**: role-based `<AuthorizeView Roles="...">` is evaluated by the Blazor component itself against the principal's role claims (which [TestPrincipal](#testprincipal) supplies), not by this service, so role gating still discriminates in a component test while policy gating does not.

### MarkupSnapshotResult
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:104` · Level 0 · readonly record struct

- **What it is**: the two-field outcome of a [MarkupSnapshot](#markupsnapshot) comparison, `IsMatch` plus a human-readable `Message` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:101-104`).
- **Depends on**: nothing. That is the entire design point.
- **Concept introduced, returning a result instead of asserting.** A shipped test-infrastructure package that called `Should().Be(...)` would drag an assertion library into every consumer's dependency graph and pin them to its version. Returning a value and letting the caller assert keeps the package dependency-free, which the class doc states explicitly ("kept dependency-free so the shipped package pulls in no assertion library", `:11-12`). This mirrors the [Result pattern](00-primer.md#2-architectural-styles-this-codebase-commits-to) the product code uses for expected failures, applied here to a test helper. `[Rubric §32, Dependency and Supply-Chain]` assesses how carefully the dependency surface of shipped packages is managed; a `readonly record struct` with two fields adds nothing to a consumer's transitive closure. `[Rubric §28, Front-End Testing]` is the capability this serves.
- **Walkthrough**: a positional `readonly record struct` with `bool IsMatch` (true when the markup matched the committed baseline or was just refreshed) and `string Message` (`:102-104`). `readonly` plus `struct` means no allocation per comparison; the record shape gives value equality and a printable form. Callers use it as `result.IsMatch.Should().BeTrue(result.Message)`, so the diff text that [MarkupSnapshot](#markupsnapshot)`.BuildDiffMessage` produced becomes the assertion failure message.
- **Where it's used**: returned from every branch of [MarkupSnapshot](#markupsnapshot)`.Match` (`:45,51-54,58-59`) and asserted by the golden-markup regressions in `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/PrimitivesSnapshotTests.cs:21-23,31-33`.

### MudProviderHandles
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:92` · Level 0 · protected sealed nested record

- **What it is**: the three handles returned by [BunitComponentTestBase](#bunitcomponenttestbase)`.RenderMudProviders()`, one per rendered MudBlazor provider, so a test can query the popover, dialog, or snackbar markup after triggering it (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:91`).
- **Depends on**: bUnit's `IRenderedComponent<T>` and MudBlazor's `MudPopoverProvider`, `MudDialogProvider`, and `MudSnackbarProvider` (`:92-95`, imports at `:2,7`).
- **Concept**: the provider-root problem, taught with [BunitComponentTestBase](#bunitcomponenttestbase). MudBlazor renders overlays into provider components that normally live in the app layout; in a component test there is no layout, so a dialog or snackbar has nowhere to go. Rendering the providers as separate roots gives them somewhere, and this record is how the test keeps a reference to each root to query it afterwards. `[Rubric §20, Design System and Theming]` assesses how the shared component library is adopted and exercised; overlay behavior is only testable once the design system's provider contract is honored in the test host.
- **Walkthrough**: a positional record with `Popover`, `Dialog`, and `Snackbar` (`:92-95`), constructed once in `RenderMudProviders()` after the three `Render<T>()` calls (`:85-88`). `Dialog` is the handle a test queries for `MudMessageBox` confirm buttons; `Snackbar` is the one it queries for toast text.
- **Where it's used**: returned by `RenderMudProviders()` (`:83-89`). Most callers discard the return value and only need the providers rendered, for example `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.UI.Tests/Pages/ShoppingCart/ShoppingCartListTests.cs:77,92,107,120`; a test that must click inside the dialog keeps it, as in `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/User/UserListTests.cs:119`.

### MutableAuthenticationStateProvider
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:97` · Level 0 · private sealed nested class

- **What it is**: the `AuthenticationStateProvider` [BunitComponentTestBase](#bunitcomponenttestbase) registers, holding one principal that the test can swap at any point, with change notification to listeners.
- **Depends on**: `Microsoft.AspNetCore.Components.Authorization` (`AuthenticationStateProvider`, `AuthenticationState`, `:5`) and BCL `ClaimsPrincipal`.
- **Concept introduced, the two ways a Blazor page learns who the user is.** Some components read the cascading `AuthenticationState` value; others inject `AuthenticationStateProvider` and call `GetAuthenticationStateAsync()` themselves. A hardcoded-anonymous provider serves neither well once a test needs the signed-in branch, so the base supplies a mutable one and drives both routes from the same principal. The class remark says exactly this: the provider is mutable because it is "a superset of a hardcoded-anonymous one" (`:20-23`). `[Rubric §19, State Management]` assesses how shared client state is owned and propagated; auth state is the canonical cascading state, and this is the test-side owner of it.
- **Walkthrough**: a primary-constructor class taking the initial principal (`:97`), storing it in a mutable `_principal` field (`:99`). `SetPrincipal(ClaimsPrincipal)` (`:101-105`) assigns the field and then calls the base `NotifyAuthenticationStateChanged` with a fresh `AuthenticationState`, so an already-rendered `<AuthorizeView>` re-evaluates rather than keeping its first answer. `GetAuthenticationStateAsync()` (`:107-108`) returns `Task.FromResult(new AuthenticationState(_principal))`, so no async state machine is allocated per call.
- **Where it's used**: instantiated as the base's `_authProvider` field seeded with `Anonymous` (`:38`), registered as a singleton `AuthenticationStateProvider` (`:46`), and mutated by `SetUser` (`:56`) and by every `RenderAs` call before rendering (`:70`).

### Route
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:110` · Level 0 · private sealed nested record

- **What it is**: one registered canned response inside [CapturingHttpMessageHandler](#capturinghttpmessagehandler): an HTTP method, an absolute path, a status code, an optional JSON body, and the method that turns all four into a fresh `HttpResponseMessage`.
- **Depends on**: BCL `HttpMethod`, `HttpStatusCode`, `HttpResponseMessage`, `StringContent`, and `System.Text.Encoding` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:1-2`). No first-party types.
- **Concept introduced, why the canned response is a recipe rather than an object.** `HttpContent` is consumed when read, so handing the same `HttpResponseMessage` to two calls fails the second one, and the shared UI services run behind a Polly retry pipeline that can legitimately send the same request twice. Storing the body as a string and rebuilding the response per request removes that whole class of false failure; the handler's own doc calls this out ("Responses are built fresh per request so a Polly retry pipeline never reuses a consumed `HttpContent`", `:14-16`). `[Rubric §29, Resilience and Business Continuity]` assesses how retry and recovery behavior is handled; a fake that cannot be retried would make the retry pipeline itself untestable.
- **Walkthrough**: a positional record `(HttpMethod Method, string Path, HttpStatusCode StatusCode, string? JsonBody)` (`:110`) with one method. `ToResponse()` (`:112-121`) news up an `HttpResponseMessage(StatusCode)` and, only when `JsonBody` is not null, attaches a `StringContent(JsonBody, Encoding.UTF8, "application/json")`, so a body-less status (204, 404) round-trips as a genuinely empty response rather than as an empty JSON document.
- **Where it's used**: appended by `SetResponse` (`:56`) and selected by the handler's `Respond` using `LastOrDefault` on method plus case-insensitive path (`:95-96`), which is what makes "last registration wins" true and lets a test override an earlier canned route mid-test.
- **Caveats / not-in-source**: the match ignores the query string entirely (only `AbsolutePath` is compared, `:92-96`), so two routes that differ only by query parameters cannot be registered separately. Query assertions go through [CapturedRequest](#capturedrequest)`.PathAndQuery` instead.

### TestPrincipal
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6` · Level 0 · static class

- **What it is**: the factory for the `ClaimsPrincipal` instances component tests render as, with the claim shape the shared pages actually read (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:5`).
- **Depends on**: BCL `System.Security.Claims` only (`:1`). No first-party types.
- **Concept introduced, the authenticated-identity trap.** A `ClaimsIdentity` is authenticated only when it was constructed with an authentication type; an identity built from claims alone reports `IsAuthenticated == false` and every `<AuthorizeView>` renders its anonymous branch, which is a confusing way for a test to fail. This factory always passes one (`authenticationType: "TestAuth"`, `:21`), and the base class's `Anonymous` principal deliberately omits it (`BunitComponentTestBase.cs:35-36`), so the two states are produced by the same mechanism from opposite ends. `[Rubric §11, Security]` assesses how identity and claims are modelled; encoding the app-wide `user_id` claim name in one shared factory keeps every UI test honest to the claim the product code reads.
- **Walkthrough**: two members.
  - `AuthenticatedUser(string userId = "1", string name = "Test User", params string[] roles)` (`:13-22`) builds a claim list with `ClaimTypes.Name` and a `user_id` claim (`:15-19`), appends one `ClaimTypes.Role` claim per supplied role (`:20`), and returns a `ClaimsPrincipal` over a `ClaimsIdentity` carrying `"TestAuth"` (`:21`). The `user_id` claim is the one the shared Profile page and its consumers read, which the doc records (`:8-12`).
  - `Organizer(string userId = "1")` (`:25-26`) is a named convenience over the first: an authenticated `"Organizer User"` carrying the `Organizer` role, the role ADC's organizer-only surfaces gate on.
- **Why it's built this way**: role gating in Blazor is claim-matching, not policy evaluation (the test [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice) grants every policy), so getting the role claims right on the principal is what makes an authorized-branch assertion meaningful.
- **Where it's used**: passed to [BunitComponentTestBase](#bunitcomponenttestbase)`.RenderAs` across all three repos, for example `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.UI.Tests/Pages/Order/OrderListTests.cs:90,123` (anonymous-user and `Admin`-role renders of the same page).
- **Caveats / not-in-source**: `Organizer` is ADC vocabulary living in a framework package; nothing constrains a consumer to that role name, and Store's tests pass their own roles through `AuthenticatedUser(roles: ...)` instead.

### BunitComponentTestBase
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33` · Level 1 · public abstract class

- **What it is**: the one shared base class for bUnit component tests across all three repos. It stands up MudBlazor services, puts JS interop in loose mode, wires real-but-permissive auth doubles, registers localization, and adds the render helpers (`RenderUnderTest`, `RenderAs`, `RenderMudProviders`, `SetUser`) that derived tests actually call (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:12-19`).
- **Depends on**: its three nested doubles [MutableAuthenticationStateProvider](#mutableauthenticationstateprovider), [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice), and [MudProviderHandles](#mudproviderhandles), plus [TestPrincipal](#testprincipal) as the intended source of authenticated principals. Externals: bUnit's `BunitContext` base and `JSRuntimeMode` (`:2`), MudBlazor's `AddMudServices` and the three providers (`:7-8`), and `Microsoft.Extensions.DependencyInjection` for `AddLogging`/`AddLocalization` (`:6`).
- **Concept introduced, the component test harness.** A Blazor component under test needs a renderer, a service provider, and whatever ambient services its markup injects; assembling that per test project is how three repos end up with three subtly different harnesses. This base assembles it once, in a shipped package, so a component that renders in Common's tests renders identically in ADC's and Store's. Four decisions carry the weight:
  - **Loose JS interop** (`:43`): MudBlazor components probe JS during render (measurements, popover positioning). In bUnit's default strict mode every unplanned call throws, so a test would have to pre-plan interop it does not care about; loose mode returns defaults instead.
  - **Real authorization, fake decision** (`:44-46`): `AddAuthorizationCore()` registers the genuine Blazor authorization plumbing, then the two nested doubles replace only the decision inputs. `<AuthorizeView>` therefore runs its real code path.
  - **Localization by default** (`:51-52`): the comment ties this to [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html); components inject `IStringLocalizer<T>`, so registering the open generic once lets every component test render localized markup against the neutral resources in the component's own assembly with no per-test setup (`:48-50`).
  - **Anonymous by default** (`:36,38`): the seed principal has no authentication type, so tests opt in to the authorized branch explicitly rather than inheriting it.

  `[Rubric §28, Front-End Testing]` assesses whether UI behavior is verified automatically; this base is the entry point for the entire component tier. `[Rubric §14, Testability]` assesses how cheaply a unit renders in isolation. `[Rubric §16, Maintainability]`: the class remark documents that the bUnit v2 symbols (`BunitContext`, `Render<T>`) are confined to this file, so a hypothetical downgrade to bUnit v1 changes this one class and no derived test, because derived tests only ever call `RenderUnderTest`/`RenderAs` (`:24-31`).
- **Walkthrough**: fields first, then the constructor, then the four protected helpers.
  - `Anonymous` (`:36`) is a `static readonly ClaimsPrincipal` over a bare `ClaimsIdentity`, unauthenticated precisely because no authentication type is supplied. `_authProvider` (`:38`) is the [MutableAuthenticationStateProvider](#mutableauthenticationstateprovider) seeded with it.
  - The constructor (`:40-53`) runs the five registrations described above, in order: `AddMudServices()`, loose `JSInterop.Mode`, `AddAuthorizationCore()`, the singleton [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice), the singleton provider instance, then `AddLogging()` and `AddLocalization()`.
  - `SetUser(ClaimsPrincipal)` (`:56`) forwards to `_authProvider.SetPrincipal`, changing the injected provider's answer and notifying listeners without rendering a new root, which is how a mid-test sign-in or sign-out is simulated.
  - `RenderUnderTest<TComponent>(parameters)` (`:59-62`) is the anonymous-render entry point and simply calls `RenderAs(Anonymous, parameters)`.
  - `RenderAs<TComponent>(principal, parameters)` (`:65-76`) is the one that matters: it sets the provider's principal (`:70`) and then renders with a cascading `Task<AuthenticationState>` value added ahead of the caller's parameters (`:73-74`). Driving both routes from one principal is what makes the cascading consumers and the injecting consumers agree.
  - `RenderMudProviders()` (`:83-89`) renders `MudPopoverProvider`, `MudDialogProvider`, and `MudSnackbarProvider` as separate roots and returns the [MudProviderHandles](#mudproviderhandles) triple. The doc is explicit that it must be called before the component under test (`:78-82`).
- **Why it's built this way**: registering the auth doubles as concrete instances rather than mocks means the authorization pipeline under test is the framework's own; only the two decision inputs are substituted. And keeping the version-specific bUnit symbols in one file is a deliberate blast-radius decision, recorded in the class remark rather than left to be rediscovered.
- **Where it's used**: subclassed by a thin repo-local `BunitTestBase` in each consumer, which adds only that repo's extra registrations: `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/BunitTestBase.cs:15` (theme service, culture applier, capability fallbacks), `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:19` (the [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) device-capability null fallbacks plus inert config), and the equivalent bases in ADC's Identity and Engagement suites and in Store's Sales, Catalog, and Identity UI test projects.
- **Caveats / not-in-source**: the Common consumer base carries a comment stating that the Testing.UI harness "deliberately does not reference MMCA.Common.UI" (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/BunitTestBase.cs:32`). The package does reference it: `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/MMCA.Common.Testing.UI.csproj:25` has a `ProjectReference` to `MMCA.Common.UI`, added so [StubTokenStorageService](#stubtokenstorageservice) can implement its `ITokenStorageService`. The comment's practical point still holds (the harness registers no `MMCA.Common.UI` services), but the stated reason is stale.

### CapturingHttpMessageHandler
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18` · Level 1 · sealed class

- **What it is**: the canned-response, request-recording `HttpMessageHandler` that lets an HTTP-backed UI service be unit tested with no server: it answers every request from registered routes or a responder delegate, and records what was sent (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:7-17`).
- **Depends on**: its two companions [Route](#route) (private nested) and [CapturedRequest](#capturedrequest). Externals: `System.Net.Http.HttpMessageHandler` (the BCL extension point), `System.Text.Json` for body serialization, and `System.Net`/`System.Text` (`:1-3`).
- **Concept introduced, faking at the transport boundary instead of the service boundary.** The alternative would be mocking the UI service's own interface, which proves nothing about the service. Subclassing `HttpMessageHandler` puts the fake one layer lower, so the service under test runs its real URL construction, its real serialization, its real status-code handling, and its real error mapping; only the wire is simulated. `[Rubric §14, Testability]` assesses how much real behavior a unit test covers; this is the difference between testing the service and testing a mock of it. `[Rubric §9, API and Contract Design]` applies because the registered routes are a written-down expectation of the API's shape, and `[Rubric §12, Performance and Scalability]` indirectly: the whole tier runs in-process with no sockets, which is what keeps the UI test tier in the fast unit run.
- **Walkthrough**: state, then the two configuration modes, then the send path.
  - Static `WebJson` (`:20`) is a single `JsonSerializerOptions(JsonSerializerDefaults.Web)` instance, matching what the WebAPI actually emits (camelCase, case-insensitive reads), so a body serialized here deserializes in the service exactly as a real response would.
  - `_respond` (`:22`) is the optional responder delegate; `_routes` (`:23`) and `_requests` (`:24`) are the registration and capture lists.
  - The parameterless constructor (`:30-32`) selects route-registration mode; the delegate constructor (`:38`) selects responder mode. The two are not exclusive: routes always win, and the delegate is the fallback (`:97-105`).
  - `Requests` (`:41`) exposes the captures in order as an `IReadOnlyList<CapturedRequest>`.
  - `SetResponse(method, absolutePath, statusCode, body = null)` (`:48-57`) normalizes the body through a switch: null stays null (empty body), a `string` is treated as raw JSON and passed through untouched, and anything else is serialized with `WebJson` (`:50-55`). It then appends a [Route](#route).
  - `RequestsFor(method, absolutePath)` (`:60-64`) filters the captures by verb and case-insensitive path via a collection expression, the assertion helper most tests use.
  - `SendAsync` (`:66-70`) is the override: capture first, then respond. `CaptureAsync` (`:72-88`) reads the request content to a string when present (`:74-78`) and builds the [CapturedRequest](#capturedrequest) from the URI, absolute path, path-and-query, and the Authorization header rendered to a string (`:80-87`). Reading the body here, before responding, is what makes the body assertable at all, since the content stream is consumed by the read.
  - `Respond` (`:90-108`) resolves the response in strict precedence: the last matching registered route (`:93-100`), else the responder delegate (`:102-105`), else `404 Not Found` with an empty body (`:107`). The doc explains the 404 default as deliberate, mirroring the WebAPI's not-found behavior so an incidental call (a token refresh, say) does not have to be set up in every test (`:12-14`).
- **Why it's built this way**: the two configuration modes serve two different test shapes. A service test that exercises one endpoint many ways wants the delegate ("answer everything this way"); a test that walks a multi-call flow wants named routes with last-registration-wins overrides. Supporting both in one handler avoids two parallel fakes drifting apart.
- **Where it's used**: owned by [UiHttpServiceHarness](#uihttpserviceharness) (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:24,39,45`), constructed directly by tests that wire the pieces themselves (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Services/UserServiceTests.cs:21`), and covered in its own right by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/CapturingHttpMessageHandlerTests.cs`.
- **Caveats / not-in-source**: `_requests` and `_routes` are plain `List<T>` with no synchronization (`:23-24`), so a test issuing genuinely concurrent requests through one handler is outside what this type guarantees.

### MarkupSnapshot
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21` · Level 1 · static partial class

- **What it is**: a dependency-free golden-markup regression helper. It takes a component's rendered markup, normalizes the parts that change per render, compares it to a committed baseline `.html` file next to the calling test, and returns the outcome for the caller to assert on (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:6-19`).
- **Depends on**: [MarkupSnapshotResult](#markupsnapshotresult) as its return type. Externals: `System.Text.RegularExpressions` with source-generated regexes and `System.Runtime.CompilerServices.CallerFilePathAttribute` (`:1-2`), plus BCL file I/O.
- **Concept introduced, snapshot testing without screenshots.** A pixel screenshot baseline is OS-dependent and needs per-platform golden management; normalized markup is deterministic and identical on every CI runner, which is why this comparison can live in the fast in-solution unit tier rather than in a browser job. The class doc states both halves of that trade (`:13-18`). Two policies make it safe to rely on: a baseline is refreshed only when `UPDATE_SNAPSHOTS=1` is set, and a missing baseline is written but still reported as a non-match, so a regression can never pass silently on an absent snapshot. `[Rubric §28, Front-End Testing]` assesses whether UI regressions are caught automatically; this is the structural-regression half of that (axe scans in the E2E tier are the accessibility half). `[Rubric §20, Design System and Theming]` assesses how the shared component library is governed; snapshotting the shared primitives is what makes an unintended change to a reused component fail somebody's build.
- **Walkthrough**:
  - `Match(markup, snapshotName, [CallerFilePath] callerFilePath = "")` (`:31-60`) is the whole public surface. It guards both string arguments (`:33-34`), normalizes the markup (`:36`), and locates the baseline as `Snapshots/{snapshotName}.html` in the directory of the *calling test file*, creating the folder if needed (`:37-39`). `[CallerFilePath]` is the mechanism: the compiler bakes the caller's source path in, so baselines live beside the tests that own them with no configuration.
  - Three outcomes follow. With `UPDATE_SNAPSHOTS=1` (compared ordinally, `:41`) it writes the file and returns a match with a "refreshed" message (`:42-46`). With no existing baseline it writes the file and returns a **non**-match telling you to review and commit it (`:48-54`). Otherwise it reads the baseline, normalizes its line endings and trims (`:56`), and returns match or a built diff (`:57-59`).
  - `Normalize(markup)` (`:64-70`) does the work that makes the comparison stable: CRLF to LF and trim (`:66`), then replace both GUID forms with the literal `{guid}` (`:67-68`), then right-trim every line (`:69`). MudBlazor injects fresh GUIDs into element ids and ARIA associations on every render, so without this step no snapshot would ever match twice.
  - `BuildDiffMessage` (`:72-92`) walks both line arrays to the first difference and reports the line number with the expected and actual text plus the `UPDATE_SNAPSHOTS=1` instruction (`:84-86`); if no line differs it reports a length mismatch (`:90-91`).
  - `GuidRegex` (`:94-95`) and `Hex32Regex` (`:97-98`) are `[GeneratedRegex]` partial properties, which is why the class is `partial`: the patterns compile at build time rather than being interpreted per call.
- **Why it's built this way**: writing the baseline on first run but still failing the test is the deliberate part. Writing and passing would let a regression bless itself on any machine where the file happened to be missing; failing but not writing would make creating a new snapshot a manual chore. Writing plus failing gives the file for free and forces a human to review and commit it.
- **Where it's used**: by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/PrimitivesSnapshotTests.cs:21,31`, which snapshots the shared UI primitives (`EmptyState`, `PageHeader`, and siblings) against baselines committed under that project's `Snapshots/` folder.
- **Caveats / not-in-source**: the normalizer replaces any bare 32-character hex token, so a legitimate markup value of that shape (a content hash in an asset URL, for example) would also collapse to `{guid}` and stop being compared.

### StubTokenStorageService
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/StubTokenStorageService.cs:13` · Level 1 · sealed class

- **What it is**: the canned [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) for UI HTTP-service tests. It returns fixed tokens with no platform storage behind it, lets the access-token read be swapped for a throwing delegate, and mutates its values on set and clear so login and logout flows are assertable (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/StubTokenStorageService.cs:5-12`).
- **Depends on**: [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) from `MMCA.Common.UI.Services.Auth` (`:1`), the contract the real per-head storage implementations satisfy. This single reference is why the Testing.UI package carries a `ProjectReference` to `MMCA.Common.UI` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/MMCA.Common.Testing.UI.csproj:23-25`).
- **Concept introduced, a stub with a failure switch.** Most stubs only model the happy path, which leaves the interesting branch (what the service does when storage is unreachable) untested. Blazor has a real version of that branch: during prerender, JS interop is unavailable, so a browser-storage-backed implementation throws. Exposing the read as a replaceable delegate lets a test reproduce that exact failure without a browser. `[Rubric §26, Front-End Security]` assesses how tokens are stored and attached; the stub is what lets the bearer-attachment path be asserted at all. `[Rubric §29, Resilience and Business Continuity]` assesses how failure paths are handled; the swappable delegate is the extension point for testing them.
- **Walkthrough**:
  - The constructor takes `accessToken = "test-token"` and `refreshToken = "test-refresh-token"` (`:18-23`), assigns both, and sets `AccessTokenProvider` to a closure returning the *property* `AccessToken` (`:22`), not the constructor argument, so later mutations are visible through the default provider.
  - `AccessToken` and `RefreshToken` (`:26,29`) are mutable auto-properties, readable by a test as post-condition assertions.
  - `AccessTokenProvider` (`:36`) is the swap point: replace it with a delegate that throws `InvalidOperationException` and `GetAccessTokenAsync` reproduces the prerender storage failure (`:31-35`).
  - The four interface members follow: `GetAccessTokenAsync()` invokes the provider (`:39`), `GetRefreshTokenAsync()` returns the field (`:42`), `SetTokensAsync(access, refresh)` assigns both and completes (`:45-50`), and `ClearTokensAsync()` nulls both (`:53-58`).
- **Why it's built this way**: routing the read through a delegate while set and clear mutate plain properties keeps the common case zero-ceremony (construct it and go) and the failure case one assignment away, with no separate throwing subclass to keep in sync.
- **Where it's used**: constructed by [UiHttpServiceHarness](#uihttpserviceharness) and exposed as its `TokenStorage` property (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:48,61`), returned from [HttpTestDoubles](#httptestdoubles)`.TokenStorage` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:28-29`), and covered directly by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/StubTokenStorageServiceTests.cs:19,28,38-45`.

### UiHttpServiceHarness
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:12` · Level 2 · sealed class (IDisposable)

- **What it is**: the one-line setup for a UI HTTP-service test. It owns the disposable plumbing every such test needs (the capturing handler, a fresh-client-per-call factory, and a token storage stub) so the test constructs one object and hands its parts to the service under test (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:3-11`).
- **Depends on**: [CapturingHttpMessageHandler](#capturinghttpmessagehandler), [FreshApiClientFactory](#freshapiclientfactory), and [StubTokenStorageService](#stubtokenstorageservice), all first-party in this package. Externals: `IHttpClientFactory` and `IDisposable` (BCL).
- **Concept introduced, the aggregate fixture over the three-piece boundary.** Before this type existed each repo assembled the same three collaborators by hand, which is exactly how the fresh-client rule (see [FreshApiClientFactory](#freshapiclientfactory)) gets forgotten in one repo and not another. Collecting them behind one constructor makes the correct wiring the default, and gives one `Dispose` for the one thing that actually needs it. `[Rubric §14, Testability]` assesses how cheap a correct test setup is; two lines of setup is the practical bar this clears. `[Rubric §16, Maintainability]`: with the wiring shipped in a package, a fix to the plumbing reaches ADC, Store, and Common in one version bump rather than three edits.
- **Walkthrough**:
  - `DefaultBaseAddress` (`:15`) is a `static readonly Uri` of `https://gateway.test/`, applied to every created client so services can build relative URIs the way they do against a real gateway.
  - Two public constructors mirror the handler's two modes and both funnel into one private constructor. The parameterless-ish one (`:23-26`) takes `accessToken = "test-token"` and an optional base address and builds a route-registration handler; the delegate one (`:35-41`) takes the responder and builds a responder-mode handler.
  - The private constructor (`:43-49`) is where the wiring lives: store the handler, resolve the base address against `DefaultBaseAddress`, build the [FreshApiClientFactory](#freshapiclientfactory) over that handler and address, and build the [StubTokenStorageService](#stubtokenstorageservice) with the canned token.
  - Four read-only properties expose the parts: `Handler` (`:52`) for `SetResponse` registration and request assertions, `BaseAddress` (`:55`), `ClientFactory` (`:58`) typed as `IHttpClientFactory` to hand to the service, and `TokenStorage` (`:61`) typed concretely so a test can reach `AccessTokenProvider`.
  - `Dispose()` (`:63`) disposes only the handler. The clients are the caller's to dispose, which is consistent with `disposeHandler: false` on each created client, so the capture log outlives them.
- **Why it's built this way**: passing `accessToken: null` produces an anonymous harness in one argument, which is how the "no bearer header when signed out" case is tested without a second fixture type. And keeping the two public constructors as thin forwarders means the mode choice is visible at the call site while the wiring exists once.
- **Where it's used**: the default setup for the HTTP-backed UI service tests in all three repos, for example `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/UiHttpServiceHarnessTests.cs:19-20,33,56,68` (which covers the harness itself, including the fresh-client contract) and `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.UI.Tests/Services/OrderServiceTests.cs:26,50,68`.

### HttpTestDoubles
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:12` · Level 3 · static class

- **What it is**: the a-la-carte counterpart to [UiHttpServiceHarness](#uihttpserviceharness): standalone factory helpers for tests that wire the pieces individually, plus the canned-response builders both styles share (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:7-11`).
- **Depends on**: [UiHttpServiceHarness](#uihttpserviceharness) (for the shared default base address), [FreshApiClientFactory](#freshapiclientfactory), [StubTokenStorageService](#stubtokenstorageservice), and [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) as the returned contract (`:3`). Externals: `System.Net.Http.Json.JsonContent` and `System.Net.HttpStatusCode` (`:1-2`).
- **Concept introduced, canned responses that match the real API's failure shape.** The response builders are not generic conveniences: `ProblemResponse` emits the `{ title, detail }` body that the WebAPI's exception handler actually returns for a domain failure, so the UI-side error mapping under test sees the shape it will see in production (`:40-48`). A fake that returned a bare 400 would let the mapping pass while being wrong. `[Rubric §9, API and Contract Design]` assesses whether error contracts are consistent and honored on both sides; this helper is where the UI tier's assumption about the API's error body is written down. `[Rubric §10, Cross-Cutting]` applies because that ProblemDetails shape is produced by shared middleware rather than by any one endpoint.
- **Walkthrough**: five members, all static.
  - `BaseAddress` (`:15`) is aliased to [UiHttpServiceHarness](#uihttpserviceharness)`.DefaultBaseAddress`, so both wiring styles share one origin and a test can compare across them.
  - `ClientFactory(handler, baseAddress = null)` (`:23-24`) returns a [FreshApiClientFactory](#freshapiclientfactory) over the given handler, defaulting the address to `BaseAddress`.
  - `TokenStorage(accessToken = "test-token")` (`:28-29`) returns a [StubTokenStorageService](#stubtokenstorageservice) typed as the interface; pass null for an anonymous client.
  - `JsonResponse<T>(payload, statusCode = OK)` (`:33-34`) builds a response whose content is `JsonContent.Create(payload)`, which serializes with web defaults, matching what the WebAPI sends.
  - `EmptyResponse(statusCode = NoContent)` (`:37-38`) builds a body-less response, the 204 shape a command endpoint returns.
  - `ProblemResponse(detail, title = "Domain Exception", statusCode = BadRequest)` (`:44-48`) delegates to `JsonResponse` with an anonymous `{ title, detail }` object.
- **Why it's built this way**: the harness is the right default, but a test that needs two handlers, or a handler shared with a non-HTTP collaborator, would have to fight it. Keeping the same primitives available individually means neither style forks its own copies, and the response builders stay identical across both.
- **Where it's used**: by the responder-delegate style of service test, for example `MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Services/UserServiceTests.cs:21,105,121` (a JSON page, a 204, and a ProblemDetails failure driven through the same service), and covered directly by `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Infrastructure/SharedHttpTestDoublesTests.cs:22,27-29,47-49`.
- **Caveats / not-in-source**: the responses these builders return are single-use `HttpResponseMessage` instances. Handing one to a responder delegate that returns the same instance twice would fail on a retry, which is why the delegate is invoked per request (see [Route](#route)) and why these helpers are normally called inside the delegate rather than before it.

### GalleryFakeAuthenticationHandler

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:19` · Level 0 · class (sealed, internal)

- **What it is**: a cookie-toggled fake ASP.NET Core authentication handler for the backend-less gallery. A request carrying `gallery_auth=1` authenticates as a fixed "Gallery Visitor" principal; every other request stays anonymous (`MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:30-39`).
- **Depends on**: `Microsoft.AspNetCore.Authentication.AuthenticationHandler<AuthenticationSchemeOptions>` (the abstract base), the base constructor triple `IOptionsMonitor<AuthenticationSchemeOptions>` / `ILoggerFactory` / `System.Text.Encodings.Web.UrlEncoder` (`GalleryFakeAuthenticationHandler.cs:19-23`), and BCL `System.Security.Claims`. No first-party dependencies.
- **Concept introduced, the backend-less gallery stub pattern and its one non-inert member.** The gallery host ([GalleryHost](#galleryhost)) renders the real `MMCA.Common.UI` components with no live API behind them, so every consumer-supplied boundary the shared UI expects is replaced by a benign stub. This type is the exception that proves the rule: it is not inert, because the shared notification pages carry a real `[Authorize]`. `MapRazorComponents` surfaces that attribute as endpoint metadata, and the authorization middleware then needs a genuine authentication scheme registered (without one it throws) and a genuine authenticated principal (without one the pages redirect to `/login` instead of rendering for the scan). The doc comment records exactly that reasoning (`GalleryFakeAuthenticationHandler.cs:8-18`). Rather than removing the guard for testability, the gallery supplies a real scheme whose only decision input is a cookie. `[Rubric §28, Front-End Testing]` assesses whether the UI has real-browser render and accessibility coverage; toggling sign-in per test with a cookie is what lets one host scan both the anonymous chrome (`/login`, `/register`, `/components`) and the signed-in guarded pages. `[Rubric §11, Security]` assesses how authentication is implemented; note the deliberate inversion here, the handler trusts an unsigned cookie value, acceptable only because this assembly is unpackaged test infrastructure (the doc comment closes with "never copy into a real host", `GalleryFakeAuthenticationHandler.cs:16-17`).
- **Walkthrough**: two internal constants pin the contract shared with the host and the tests, `SchemeName = "GalleryFake"` (`:25`) and `CookieName = "gallery_auth"` (`:26`). `HandleAuthenticateAsync()` (`:28`) is the single override. It short-circuits first: when `Request.Cookies["gallery_auth"]` is not exactly `"1"` it returns `AuthenticateResult.NoResult()` (`:30-33`), which means "this scheme has no opinion", leaving the request anonymous rather than failing it. Otherwise it builds a `ClaimsIdentity` with one `ClaimTypes.Name` claim of `"Gallery Visitor"` and, critically, passes `SchemeName` as the authentication type (`:35-37`): supplying an authentication type is what makes `Identity.IsAuthenticated` true. It wraps that principal in an `AuthenticationTicket` and returns `AuthenticateResult.Success` (`:38-39`). Everything is synchronous through `Task.FromResult`, so no I/O occurs.
- **Why it's built this way**: keeping the guard real and faking only the credential means the E2E scan exercises the same authorization pipeline the deployed hosts run, so an accidental loss of `[Authorize]` on the shared notification pages cannot be papered over by a permissive test host.
- **Where it's used**: registered as the default (and only) authentication scheme by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:69-72`), followed by `AddAuthorization()` (`GalleryHost.cs:73`) and the `UseAuthentication()` / `UseAuthorization()` middleware pair (`GalleryHost.cs:107-108`). The cookie is seeded on the Playwright browser context by [NotificationPagesE2ETests](#notificationpagese2etests)`.SeedSignedInCookieAsync` (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:62-71`) before each of its three guarded-page scans (`:23`, `:38`, `:50`), and by [MobileTopRowE2ETests](#mobiletoprowe2etests) for its signed-in top-row check (`MMCA.Common.UI.E2E.Tests/MobileTopRowE2ETests.cs:95`).

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
- **Concept introduced**: the same stub pattern as [NullTokenRefresher](#nulltokenrefresher), covering storage rather than refresh, and the first place where a stub exists purely to satisfy a *transitive* constructor. `AddUIShared` registers [AuthDelegatingHandler](group-15-common-ui-framework.md#authdelegatinghandler) as transient (`MMCA.Common.UI/DependencyInjection.cs:59`) and attaches it to the named `"APIClient"` pipeline (`MMCA.Common.UI/DependencyInjection.cs:81`), and that handler's primary constructor takes an `ITokenStorageService` (`MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9-10`). Nothing in `AddUIShared` supplies one, so the host must. `[Rubric §26, Front-End Security]` assesses how auth tokens are stored and handled; this stub deliberately holds nothing, so the test host persists no credential material at all, not even in memory.
- **Walkthrough**: four members, each inert but shape-complete so DI binds. `GetAccessTokenAsync()` (`:12`) and `GetRefreshTokenAsync()` (`:14`) return `Task.FromResult<string?>(null)`; `SetTokensAsync(accessToken, refreshToken)` (`:16`) and `ClearTokensAsync()` (`:18`) discard their inputs and return `Task.CompletedTask`.
- **Where it's used**: registered scoped by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:60`), inside the block placed ahead of `AddUIShared` (`GalleryHost.cs:55-63`).
- **Caveats / not-in-source**: unlike [NoOpAuthUIService](#noopauthuiservice), this registration is not a `TryAdd` override. `AddUIShared` makes no `ITokenStorageService` registration anywhere in its body (`MMCA.Common.UI/DependencyInjection.cs:29-112`); the concrete storage services are supplied per host head instead (`WasmTokenStorageService` for the WebAssembly client, and `ServerTokenStorageService` registered by `MMCA.Common.UI.Web/DependencyInjection.cs:29` for the Blazor Server head), so in the gallery this stub is the only registration rather than a winning one.

### GalleryUIModule

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:13` · Level 3 · class (sealed, internal)

- **What it is**: a minimal [IUIModule](group-15-common-ui-framework.md#iuimodule) whose `Assembly` is the gallery itself, so the shared Blazor Router (`Routes.razor`, which scans `UIModules.Select(m => m.Assembly)`) discovers the gallery's own `/components` showcase page. Its nav links make the host browsable when run interactively (`MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:8-12`).
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) and [NavItem](group-15-common-ui-framework.md#navitem) from `MMCA.Common.UI.Common`, plus `MudBlazor.Icons` and BCL `System.Reflection.Assembly`.
- **Concept introduced**: the UI-module contribution pattern (taught with [IUIModule](group-15-common-ui-framework.md#iuimodule) in the Common UI framework group) reused for a test host: a module contributes route-bearing assemblies and nav links to the shared shell. `[Rubric §18, UI Architecture]` assesses how the front end composes independently-owned UI slices; the gallery participates in the exact module-discovery mechanism the real apps use, which is what makes the E2E evidence say something about *that mechanism* rather than about a bespoke test shell. `[Rubric §25, Navigation & IA]`: the three nav entries flow through the same `NavItem` record the deployed apps' menus are built from, using only its first three positional members and leaving `RequiredRole`, `RequiredClaim`, `Section`, `Group`, and `TitleResource` at their defaults (`MMCA.Common.UI/Common/NavItem.cs:17`).
- **Walkthrough**: `NavItems` (`:15`) is a collection-expression `IReadOnlyList<NavItem>` of three entries, Login (`/login`), Register (`/register`), and Components (`/components`), each pairing a label, a route, and a MudBlazor Material icon (`:17-19`). `Assembly` (`:22`) is an expression-bodied property returning `typeof(GalleryUIModule).Assembly`, so the Router additionally scans the gallery assembly for routable components, which is how `MMCA.Common.UI.Gallery/Pages/ComponentsGallery.razor:1` (`@page "/components"`) becomes reachable. The two optional `IUIModule` members, `AppBarComponentTypes` and `LayoutComponentTypes`, are left at their interface defaults of empty lists.
- **Where it's used**: registered as a singleton `IUIModule` by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:85`); the page it makes routable is what [ComponentsPageE2ETests](#componentspagee2etests) scans.

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
- **Where it's used**: registered scoped by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:80`). The scans that consume it are [NotificationPagesE2ETests](#notificationpagese2etests)`.NotificationHistory_Renders_AndHasNoWcag21AaViolations` and `.NotificationCompose_Renders_AndHasNoWcag21AaViolations` (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:20-33`, `:47-57`); the history scan runs under [AxeOptions](#axeoptions)`.Wcag21AaExceptMudPagerCombobox` because MudBlazor 9.6.0's pager combobox has no accessible name and is not fixable from app markup (`NotificationPagesE2ETests.cs:29-32`).

### NoOpAuthUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:12` · Level 6 · class (sealed, internal)

- **What it is**: a no-op [IAuthUIService](group-15-common-ui-framework.md#iauthuiservice) for the backend-less gallery. The gallery renders the real Login and Register pages for accessibility and render-smoke scanning only, so every operation returns a benign default (`MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:6-11`).
- **Depends on**: [IAuthUIService](group-15-common-ui-framework.md#iauthuiservice) from `MMCA.Common.UI.Services.Auth`, and the [LoginRequest](group-08-auth.md#loginrequest), [RegisterRequest](group-08-auth.md#registerrequest), and [AuthenticationResponse](group-08-auth.md#authenticationresponse) contracts from `MMCA.Common.Shared.Auth`.
- **Concept introduced, registration order as the override mechanism.** This stub is registered *before* `AddUIShared`, whose `TryAddScoped<IAuthUIService, AuthUIService>()` (`MMCA.Common.UI/DependencyInjection.cs:84-85`) then defers to it, exactly as the class doc comment states (`NoOpAuthUIService.cs:9-11`). `TryAdd*` is first-registration-wins, so a test host overrides only the boundaries it names and inherits every other registration the shared UI makes, with no fork of the composition root. `[Rubric §11, Security]` assesses how authentication is handled; here the client-side auth boundary is neutralized entirely so the scan touches the real login and register markup without any credential flow. `[Rubric §14, Testability]`: substituting the top-level UI auth service for constants is what makes those pages renderable in isolation.
- **Walkthrough**: `LastError` (`:14`) is always `null`, so no error alert renders. `LoginAsync`, `RegisterAsync`, and `ExchangeOAuthCodeAsync` (`:16`, `:19`, `:22`) each return `Task.FromResult<AuthenticationResponse?>(null)`, meaning "no authenticated session" on the interface's own terms. `LogoutAsync()` (`:25`) returns `Task.CompletedTask`. `TryRefreshTokenAsync(ct)` (`:27`) and `ChangePasswordAsync(currentPassword, newPassword, ct)` (`:30`) both return `Task.FromResult(false)`. Every path is inert but shape-complete, so the pages bind, render, and stay in their signed-out state for the axe pass.
- **Why it's built this way**: placing the stub ahead of `AddUIShared` exploits the shared UI's `TryAdd*` idempotence rather than requiring the shared registration extension to grow test hooks, which keeps the production DI code free of test-only branches.
- **Where it's used**: registered scoped by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:59`), the first of the pre-`AddUIShared` stub registrations; consumed indirectly by the [LoginPageE2ETests](#loginpagee2etests) and [RegisterPageE2ETests](#registerpagee2etests) scans of the real shared auth pages.

### GalleryAuthenticationStateProvider

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryAuthenticationStateProvider.cs:16` · Level 8 · class (sealed, internal)

- **What it is**: the gallery's Blazor `AuthenticationStateProvider`. It mirrors the request's authentication in *both* render phases, so `AuthorizeView` and `CascadingAuthenticationState` agree with whatever [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler) decided for the request. Without the `gallery_auth` cookie both phases yield anonymous, preserving the deliberate signed-out chrome of the login, register, and components scans (`MMCA.Common.UI.Gallery/Stubs/GalleryAuthenticationStateProvider.cs:6-15`).
- **Depends on**: `Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider` (the abstract base) and `IHostEnvironmentAuthenticationStateProvider` (the interface the Blazor Server host calls into) at `:16-17`, `IHttpContextAccessor` injected as a primary-constructor parameter (`:16`), and BCL `ClaimsPrincipal` / `ClaimsIdentity`.
- **Concept introduced, the two render phases of interactive-server Blazor.** A page first renders as static SSR inside the HTTP request, then, once the circuit connects, re-renders interactively over a WebSocket where there is no ambient `HttpContext`. An auth-state provider therefore has to answer correctly in two different worlds. This class handles both: SSR reads the request user through `IHttpContextAccessor`, and for the interactive circuit the framework pushes the handshake user in through `IHostEnvironmentAuthenticationStateProvider.SetAuthenticationState`. The doc comment records that this replaced a former always-anonymous stub, which could not represent the signed-in state the guarded notification pages now need (`:7-9`). `[Rubric §19, State Management]` assesses how client state is owned and propagated; auth state is the canonical cascading state, and this shows the two supply routes it has under interactive server rendering. `[Rubric §28, Front-End Testing]`: getting both phases right is what stops a guarded page from flipping to a signed-out tree mid-scan and producing a false pass on the wrong markup.
- **Walkthrough**: `Anonymous` (`:19-20`) is a `static readonly AuthenticationState` wrapping an empty `ClaimsPrincipal(new ClaimsIdentity())`, unauthenticated precisely because no authentication type is supplied (contrast [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler), which passes one). `_hostState` (`:22`) is the nullable task the framework may have pushed in. `GetAuthenticationStateAsync()` (`:24`) checks `_hostState` first and returns it verbatim when present (`:26-29`): the circuit's handshake user always wins. Otherwise it falls back to the SSR path, reading `httpContextAccessor.HttpContext?.User` (`:31`) and returning a new `AuthenticationState(user)` only when `user?.Identity?.IsAuthenticated == true`, else the shared `Anonymous` (`:32-34`). Both branches use `Task.FromResult`, so no async machinery is allocated per call. `SetAuthenticationState(Task<AuthenticationState>)` (`:37-38`) is the `IHostEnvironmentAuthenticationStateProvider` implementation and simply stores the task; it does not call `NotifyAuthenticationStateChanged`.
- **Why it's built this way**: the gallery mirrors rather than fabricates. Deriving the component-tree state from whatever the request actually authenticated as keeps one source of truth (the cookie) for the middleware, the endpoint authorization, and the render tree, so a scan cannot land in a split state where the endpoint admitted the request but the tree still renders signed-out.
- **Where it's used**: registered scoped as the `AuthenticationStateProvider` by [GalleryHost](#galleryhost) (`MMCA.Common.UI.Gallery/GalleryHost.cs:63`), immediately after `AddHttpContextAccessor()` (`GalleryHost.cs:62`), which supplies its dependency.
- **Caveats / not-in-source**: the class implements `IHostEnvironmentAuthenticationStateProvider` but is registered only under the `AuthenticationStateProvider` service type (`GalleryHost.cs:63`). Whether the Blazor Server host resolves this same instance when it calls `SetAuthenticationState`, and at what point in the render sequence it does so, is framework behavior and is not determinable from this repository's source.

### GalleryHost

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery` · `MMCA.Common.UI.Gallery/GalleryHost.cs:21` · Level 9 · class (public, static)

- **What it is**: a static builder that assembles the entire backend-less Blazor gallery host. It renders the real `MMCA.Common.UI` auth pages (`/login`, `/register`), the shared notification pages (`/notifications`, `/notifications/inbox`, `/notifications/send`), and a primitives showcase (`/components`) against stub implementations of every consumer boundary, so a real-browser axe accessibility scan can run against the shared UI inside `MMCA.Common`'s own CI (`MMCA.Common.UI.Gallery/GalleryHost.cs:15-19`).
- **Depends on**: ASP.NET Core `WebApplication` / `WebApplicationBuilder`, MudBlazor (`AddMudServices`, `GalleryHost.cs:53`), the shared `MMCA.Common.UI` surface (`AddUIShared`, the gallery's own `App` root component in `MMCA.Common.UI.Gallery/Components/App.razor`, and `MMCA.Common.UI._Imports` as the additional-assembly marker), and [SupportedCultures](group-12-api-hosting-mapping.md#supportedcultures) from `MMCA.Common.Shared.Globalization`. It wires in every stub in this unit: [NoOpAuthUIService](#noopauthuiservice), [NullTokenStorageService](#nulltokenstorageservice), [NullTokenRefresher](#nulltokenrefresher), [GalleryAuthenticationStateProvider](#galleryauthenticationstateprovider), [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler), [StubNotificationInboxUIService](#stubnotificationinboxuiservice), [StubPushNotificationUIService](#stubpushnotificationuiservice), and [GalleryUIModule](#galleryuimodule), plus the shared [NotificationState](group-15-common-ui-framework.md#notificationstate).
- **Concept introduced, a self-hostable test host as one buildable unit.** The whole host build lives in `BuildApp(string[] args)` (`:28`) rather than in `Program.cs`, so two callers share the identical configured app: the `dotnet run` entry point, which `RunAsync()`s it (`MMCA.Common.UI.Gallery/Program.cs:7-8`), and the E2E collection fixture [GalleryHostFixture](#galleryhostfixture), which `StartAsync()`s it on an ephemeral Kestrel port. `[Rubric §28, Front-End Testing]` assesses real-browser UI coverage; this host is the render target for CI's `ui-e2e` job, whose chromium, firefox, and webkit matrix legs are all required merge gates (`MMCA.Common/.github/workflows/ci.yml:228`, `:236-240`). `[Rubric §33, Developer Experience]`: `Program.cs:3-6` records the rationale, one `BuildApp` for both entry points avoids the separate `dotnet run` plus health-poll that made ADC's e2e cold start fragile.
- **Walkthrough**:
  - **Assembly name and base dir** (`:33-34`): `typeof(GalleryHost).Assembly.GetName().Name` is captured without a null-forgiving operator; the comment at `:30-32` explains that CI's nullable analysis treats `AssemblyName.Name` as non-null and would flag `!` as an unnecessary suppression (IDE0370), and the value is only interpolated into a filename, which is null-safe either way.
  - **Static web assets** (`:45-48`): the load-bearing fix. RCL `_content/*` CSS and JS plus `_framework/blazor.web.js` resolve from the *entry* assembly's manifests and auto-load only in Development; when the E2E suite self-hosts in-process the entry assembly is the test host and the environment is Production, so neither default holds. The loader is pointed explicitly at `{galleryAssemblyName}.staticwebassets.runtime.json` and forced on with `UseStaticWebAssets()`. Without it (comment, `:38-44`) the pages render unstyled and never become interactive, so axe's contrast checks would be meaningless and the page would never signal Blazor readiness.
  - **Rendering services** (`:50-53`): `AddRazorComponents().AddInteractiveServerComponents()`, then `AddMudServices()`.
  - **Boundary stubs, before `AddUIShared`** (`:59-63`): scoped `IAuthUIService`, `ITokenStorageService`, and `ITokenRefresher`, then `AddHttpContextAccessor()` and the scoped `AuthenticationStateProvider`. The ordering comment (`:55-58`) states the mechanism, `AddUIShared`'s `TryAdd*` registrations defer to whatever is already present.
  - **Real authentication and authorization** (`:69-73`): `AddAuthentication(GalleryFakeAuthenticationHandler.SchemeName)` plus `AddScheme<AuthenticationSchemeOptions, GalleryFakeAuthenticationHandler>(...)`, then `AddAuthorization()`, because the notification pages' `[Authorize]` surfaces as endpoint metadata (comment, `:65-68`).
  - **Canned notification boundaries** (`:78-80`): scoped `NotificationState`, `INotificationInboxUIService`, and `IPushNotificationUIService`, so the notification pages discovered from the `MMCA.Common.UI` assembly render populated markup (comment, `:75-77`).
  - **Module contribution** (`:85`): the singleton `IUIModule`, so the shared Router discovers the gallery's own `/components` page.
  - **Shared UI** (`:90`): `AddUIShared(builder.Configuration)` registers the `ApiSettings` / `LayoutSettings` binding, the `"APIClient"` HttpClient, and the remaining shared services; the in-memory `Api:ApiEndpoint` from `appsettings.json` satisfies validation and deliberately points at the unroutable `http://api.gallery.invalid` (`MMCA.Common.UI.Gallery/appsettings.json:2-4`), and the client is never invoked because `IAuthUIService` is stubbed (comment, `:87-89`).
  - **Request localization** (`:99-103`): builds `galleryCultures` as `[.. SupportedCultures.All, SupportedCultures.PseudoLocale]` and applies it as the supported and supported-UI culture set over `SupportedCultures.Default`. The comment (`:94-98`) is explicit that this mirrors the real hosts' [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) allowlist but additionally enables `qps-Ploc` *unconditionally*, because this host is unpackaged test infrastructure that is never deployed and the pseudo pass here is a required CI gate ([PseudoLocalizationE2ETests](#pseudolocalizatione2etests), the rubric §27 resource-round-trip and text-expansion evidence). Production keeps `qps-Ploc` Development-only via `UseCommonRequestLocalization`. `[Rubric §27, i18n]` assesses whether localization is enforced rather than aspirational; this host is where the pseudo-locale evidence is produced.
  - **Middleware** (`:107-112`): `UseAuthentication()` then `UseAuthorization()` (WebApplication inserts `UseRouting` ahead of them automatically), then `UseAntiforgery()`, required because Razor Component endpoints carry anti-forgery metadata even though the gallery's interactive forms never POST over HTTP.
  - **Endpoints** (`:116-125`): `MapStaticAssets` is given the gallery's own `{galleryAssemblyName}.staticwebassets.endpoints.json` for the same in-process self-host reason as above; a `/health` endpoint returns `Results.Ok("Healthy")` (`:119`); and `MapRazorComponents<App>().AddInteractiveServerRenderMode().AddAdditionalAssemblies(typeof(MMCA.Common.UI._Imports).Assembly)` (`:123-125`) makes the real shared pages routable alongside the gallery's own.
  - **Return** (`:127`): the built-but-not-started `WebApplication`, leaving the start mode to the caller.
- **Why it's built this way**: keeping the whole build in `BuildApp` rather than `Program.cs` lets the E2E fixture host the identical configured app in-process on a real bound port via `StartAsync`, not `WebApplicationFactory`'s in-memory TestServer, which Playwright cannot reach over the wire. [GalleryHostFixture](#galleryhostfixture) therefore clears the URLs, binds `http://127.0.0.1:0`, and reads the ephemeral address back from `IServerAddressesFeature` (`MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryHostFixture.cs:26-38`). This is deliberate CI infrastructure and is never shipped: the csproj sets `IsPackable=false` and records that the project is deliberately outside `MMCA.Common.slnx` (`MMCA.Common.UI.Gallery/MMCA.Common.UI.Gallery.csproj:3-6`), so it builds only by csproj path.
- **Where it's used**: consumed by `MMCA.Common.UI.Gallery/Program.cs:7` (the `dotnet run` entry) and by every E2E test through [GalleryHostFixture](#galleryhostfixture) (`MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryHostFixture.cs:26`), against which the axe and render suite runs: [LoginPageE2ETests](#loginpagee2etests), [RegisterPageE2ETests](#registerpagee2etests), [ComponentsPageE2ETests](#componentspagee2etests), [NotificationPagesE2ETests](#notificationpagese2etests), [DarkModeE2ETests](#darkmodee2etests), [MobileTopRowE2ETests](#mobiletoprowe2etests), [StickySidebarE2ETests](#stickysidebare2etests), [WebVitalsE2ETests](#webvitalse2etests), and [PseudoLocalizationE2ETests](#pseudolocalizatione2etests).
- **Caveats / not-in-source**: the class summary (`GalleryHost.cs:15-19`) still describes the host as rendering the auth pages and `/components` with an "anonymous auth state", which lags the code: `BuildApp` now also serves the guarded notification pages and registers [GalleryAuthenticationStateProvider](#galleryauthenticationstateprovider), which mirrors the request rather than forcing anonymous.

### BrandColorTokenTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:12` · Level 1 · class (public, sealed)

- **What it is** - the ADC end of the brand-token drift guard. It is a five-line subclass of the shared [BrandColorTokenTestsBase](#brandcolortokentestsbase) that names one embedded stylesheet, `ADCHome.Shared.razor.css` (`MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:14`-`:17`); the rule body itself lives in MMCA.Common.
- **Depends on** - [BrandColorTokenTestsBase](#brandcolortokentestsbase) from the `MMCA.Common.Testing.Architecture` package (referenced at `MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:41`), plus the `EmbeddedResource` item that maps the conference landing page's scoped stylesheet into this assembly under that logical name (`MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:11`-`:13`). Externals: xUnit v3, AwesomeAssertions, and NetArchTest (`MMCA.ADC.Architecture.Tests.csproj:25`-`:27`), the last two reachable everywhere in the assembly through the global usings (`MMCA.ADC.Architecture.Tests/GlobalUsings.cs:1`-`:5`).
- **Concept introduced, the thin-subclass fitness function.** Every type in this unit follows one shape, so learn it once here. A *fitness function* is an executable test that asserts an architectural property instead of a behavior. MMCA keeps the property's logic in exactly one place, an abstract `*TestsBase` in the shared `MMCA.Common.Testing.Architecture` package, and each repo derives a sealed subclass that supplies only its own identity: which assemblies to scan, which floors and allowlists apply, which files to read. xUnit discovers `[Fact]`s on inherited members, so the subclass needs no test method of its own; deriving the class is what makes the rule run in this repo ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)). `[Rubric §34 - Architecture Governance & Documentation]` assesses whether architectural decisions are recorded and enforced rather than trusted to reviewers; here the decision is enforced by a build that goes red. `[Rubric §20 - Design System & Theming]` assesses whether a design system has one source of truth for its tokens; this rule is what stops a host copy of the landing page from re-hardcoding the brand hex.
- **Walkthrough** - one member. `EmbeddedCssLogicalNames` (`BrandColorTokenTests.cs:14`-`:17`) is a collection expression with a single entry, `"ADCHome.Shared.razor.css"`. That string is not a file path: it is the `LogicalName` the csproj assigns when it embeds `Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.css` as a manifest resource (`MMCA.ADC.Architecture.Tests.csproj:11`-`:13`), which is how a test assembly reads a file from a project it does not reference. The inherited fact `LandingPageCss_SourcesBrandColorFromToken_NotHardcodedHex` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:25`) then loads each named resource (`:56`-`:63`, throwing a clear error if the embed is missing), requires the text to contain `var(--mmca-primary)` (`:41`-`:44`), and requires it not to contain the literal `#1565C0` in any casing (`:46`-`:49`). Both constants are declared once in the base (`:15`-`:16`).
- **Why it's built this way** - the class comment records the split (`BrandColorTokenTests.cs:3`-`:11`): MMCA.Common's own `BrandColorTokenTests` guards the C#-to-CSS token *definition*, and this one guards the ADC *consumer* of it. Embedding the stylesheet rather than reading it off disk means the guard travels with the compiled test assembly and cannot be defeated by a runner whose working directory differs.
- **Where it's used** - the whole project is inside ADC's CI solution filter (`MMCA.ADC/MMCA.ADC.CI.slnf:58`), which the `build-and-test` job restores, builds, and tests on every PR and every push to `main` (`MMCA.ADC/.github/workflows/deploy.yml:124`, `:199`, `:205`, `:219`).
- **Caveats / not-in-source** - the guard only covers stylesheets that are both embedded and listed. ADC lists exactly one, so a second landing-page stylesheet added later is invisible to the rule until someone adds it to both places.

### ObservabilityConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7` · Level 1 · class (public, sealed)

- **What it is** - the SLO alert-to-runbook pairing gate for ADC, and the shortest type in this unit: a bodyless class declaration, `public sealed class ObservabilityConventionTests : ObservabilityConventionTestsBase;` (`MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7`). It overrides nothing at all.
- **Depends on** - [ObservabilityConventionTestsBase](#observabilityconventiontestsbase), plus two `EmbeddedResource` entries in the csproj that supply the files the base reads: `infra/main.bicep` under the logical name `infra.main.bicep` and `infra/OPERATIONS.md` under `infra.OPERATIONS.md` (`MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:17`-`:22`).
- **Concept introduced, identity by inheritance alone.** This is the thin-subclass pattern from [BrandColorTokenTests](#brandcolortokentests) reduced to its limit. The base defaults `ResourceAssembly` to `GetType().Assembly` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:51`), so the derived type *is* the configuration: deriving in this assembly is what points the rule at ADC's embedded bicep and runbook. The file comment states exactly that ("this repo supplies only its identity", `ObservabilityConventionTests.cs:3`-`:6`). `[Rubric §13 - Observability & Operability]` assesses whether the system can be operated under failure, which means alerts that lead somewhere; this pairs each provisioned alert with a runbook section at build time instead of at 3am.
- **Walkthrough** - no members. Everything runs from the base's three inherited facts: `SloAlertSpecs_AreDiscovered_GateIsNotVacuous` (`ObservabilityConventionTestsBase.cs:54`) enforces the non-vacuity floor of `MinimumAlertSpecs`, defaulted to 3 and not overridden here (`:39`); `EveryProvisionedSloAlert_HasASeverityCorrectRunbookSection` (`:64`) walks the alerts declared in the embedded bicep and requires a matching, severity-correct section in the embedded runbook; and `EveryRunbookAlertSection_MapsToAProvisionedAlert` (`:92`) closes the other direction, failing on an orphan runbook section for an alert that no longer exists. The resource names the base reads default to `infra.main.bicep` and `infra.OPERATIONS.md` (`:42`, `:45`), which is why the csproj logical names must match exactly.
- **Why it's built this way** - alert definitions live in infrastructure-as-code and the response procedure lives in a Markdown runbook; nothing in either file references the other, so the pairing is exactly the kind of invariant that decays silently. Embedding both into the test assembly turns the pairing into a compile-and-run artifact.
- **Where it's used** - runs with the rest of the suite in the `build-and-test` job (`MMCA.ADC/.github/workflows/deploy.yml:124`).

### TranslationCompletenessTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:12` · Level 5 · class (public, sealed)

- **What it is** - the internationalization completeness gate: every base `*.resx` under `Source/` must have a complete, non-empty Spanish `.es.resx` sibling, so adding an English key without its translation fails CI instead of shipping a half-translated UI (`MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:3`-`:11`).
- **Depends on** - [LocalizationResourceTestsBase](#localizationresourcetestsbase). Note the deliberate name divergence: the ADC subclass is named for what it guarantees (translation completeness), not for the base it derives from.
- **Concept introduced, the non-vacuity floor.** A convention scan that discovers nothing passes trivially, which is the failure mode that makes fitness functions untrustworthy over time. The MMCA bases answer it with a minimum-count floor that the subclass raises to the repo's real magnitude, so a broken scan root (a moved directory, a renamed convention, a case-sensitivity slip on the Ubuntu runner) fails loudly instead of going green while checking zero files. You will see this floor again in [FormsConventionTests](#formsconventiontests) and [LocalizedTextConventionTests](#localizedtextconventiontests). `[Rubric §27 - i18n]` assesses whether localization is enforced rather than aspirational; the gate is the enforcement, and [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (which supersedes the single-locale ADR-011) is the decision it executes.
- **Walkthrough** - two members. `RequiredCultures => ["es"]` (`TranslationCompletenessTests.cs:14`) implements the base's abstract culture list (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:13`), so Spanish is the one culture ADC contractually completes. `MinimumBaseResources => 40` (`TranslationCompletenessTests.cs:16`) raises the base's default of 0 (`LocalizationResourceTestsBase.cs:21`), which would otherwise let an empty scan pass. The inherited fact is `Translations_AreComplete_ForEveryRequiredCulture` (`LocalizationResourceTestsBase.cs:24`).
- **Why it's built this way** - the class comment justifies the floor from the repo's real shape: ADC has 40 or more localized resource sets across the three module UIs, the UI hosts' landing page, the nav-item module descriptors, and the API error-resource sets, so a near-zero discovery count means the scan path is wrong (`TranslationCompletenessTests.cs:8`-`:10`).
- **Caveats / not-in-source** - the floor is a lower bound stated in the subclass, not a count computed from the tree, so it stays correct only as long as someone raises it when the resource set grows materially.

### AdcArchitectureMap

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:8` · Level 9 · class (internal, sealed)

- **What it is** - the single declaration of what "the ADC architecture" *is*, in assembly terms: five MMCA.Common framework layers plus the Identity, Conference, and Engagement modules at six layers each, 23 entries in all (`MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:12`-`:44`). Every map-driven rule in this unit scans exactly the assemblies listed here.
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (which implements [IArchitectureMap](#iarchitecturemap)), the [Layer](#layer) enum and the [LayerRef](#layerref) record, and `System.Reflection.Assembly` (global-used at `MMCA.ADC.Architecture.Tests/GlobalUsings.cs:1`). Through its anchor types it also depends on [Result](group-01-result-error-handling.md#result), [BaseEntity&lt;TIdentifierType&gt;](group-02-domain-building-blocks.md#baseentitytidentifiertype), [EntityQueryService&lt;TEntity, TEntityDTO, TIdentifierType&gt;](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype), [ApplicationDbContext](group-07-persistence-ef-core.md#applicationdbcontext), and [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) on the framework side, and on [User](group-24-identity-module.md#user), [Event](group-17-conference-domain.md#event), [UserSessionBookmark](group-22-engagement-module.md#usersessionbookmark), their DTOs, and the three [IdentityModule](group-24-identity-module.md#identitymodule) / [ConferenceModule](group-20-conference-api-grpc.md#conferencemodule) / [EngagementModule](group-22-engagement-module.md#engagementmodule) entry points on the app side.
- **Concept introduced, the architecture map as data.** NetArchTest works on `Assembly` objects, so a fitness function needs some way to know which assembly plays which role. Rather than hard-coding assembly names inside each rule, MMCA reifies the answer in one object: a flat list of `(module, layer, assembly)` triples. [ArchitectureMapBase](#architecturemapbase) derives everything else from that list: the module-name set, per-layer projections, namespace derivation, and the module-isolation target sets (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:28`-`:72`). The consequence is that adding a module to ADC is a one-line change here, after which roughly two dozen rules start covering it. `[Rubric §3 - Clean Architecture]` assesses whether layer boundaries are real rather than aspirational, and this is the machine-readable statement of those boundaries. `[Rubric §7 - Microservices Readiness]`: the map's `Module` grouping is what lets the isolation and extraction rules ask "could this module leave the process", which for ADC is not hypothetical, since every module already runs as its own service host.
- **Walkthrough**
  - **`RepoToken => "MMCA.ADC"`** (`AdcArchitectureMap.cs:10`) is more load-bearing than it looks. The base composes namespaces from it (`{RepoToken}.{Module}.{Segment}`, `ArchitectureMapBase.cs:63`-`:66`, `:98`-`:99`), and the doc/config rules resolve the repository root by walking up from the test binary until they find `{RepoToken}.slnx` (`ArchitectureMapBase.cs:79`-`:91`), which is how [DataResidencyTests](#dataresidencytests), [FormsConventionTests](#formsconventiontests), and [RawQueryableConventionTests](#rawqueryableconventiontests) read committed files regardless of the runner's working directory.
  - **Framework layers** (`AdcArchitectureMap.cs:15`-`:19`) are declared with the `Framework(layer, assembly)` helper, which records an empty module name (`ArchitectureMapBase.cs:94`-`:95`), so they are excluded from the per-module projections. Each is pinned by an anchor type rather than a string: `Result` for Shared, `BaseEntity<>` for Domain, `EntityQueryService<,,>` for Application, `ApplicationDbContext` for Infrastructure, and `ApiControllerBase` for API. A rename or a package move breaks the compile instead of silently producing an empty scan.
  - **Module layers** (`:22`-`:43`) use the instance `Module(name, layer, assembly)` helper, three modules times six layers. Domain, Shared, and API are pinned by anchor type (`Identity.Domain.Users.User`, `Conference.Shared.Events.EventDTO`, `Engagement.API.EngagementModule`, and their siblings); Application, Infrastructure, and UI are loaded by name through `Assembly.Load` (for example `:23`, `:24`, `:27`), because, as the class comment explains, those assemblies have no convenient public anchor type (`:5`-`:6`). `Assembly.Load` succeeds here only because the csproj takes a `ProjectReference` on all eighteen module projects (`MMCA.ADC.Architecture.Tests.csproj:46`-`:65`), which is what puts the DLLs beside the test binary.
  - **Laziness** is inherited: `DefineLayers()` is materialized once through a `Lazy<IReadOnlyList<LayerRef>>` built in the base constructor (`ArchitectureMapBase.cs:13`-`:16`), so the twenty-odd subclasses that each construct their own map instance still pay the `Assembly.Load` cost only on first use.
- **Why it's built this way** - centralizing every namespace and assembly string in one file also fixes Ubuntu CI case sensitivity in one place, which the base states as an explicit goal (`ArchitectureMapBase.cs:7`-`:9`). Compare [CommonArchitectureMap](#commonarchitecturemap), the same abstraction for a repo with no business modules.
- **Where it's used** - instantiated as a field initializer by every map-driven subclass in this unit (25 of the 30 types here, all of them at Level 10), for example `ConcurrencyConventionTests.cs:5`. It is `internal`, so it never leaves this assembly.
- **Caveats / not-in-source** - the thin Notification module (API plus Application only) is deliberately absent from the map, so the module-shaped rules do not cover it; [RawQueryableConventionTests](#rawqueryableconventiontests) is the one rule that re-adds Notification by hand, and it says why (`RawQueryableConventionTests.cs:16`-`:20`). Nothing in this repository asserts that the map lists every module that exists, so a fourth mapped module would have to be added here by a human.

### DecoratorPipelineOrderTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:26` · Level 9 · class (public, sealed)

- **What it is** - the one type in this unit that builds a real DI container instead of reading metadata. It asserts that ADC's genuine registration sequence produces the [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) decorator nesting at runtime, exercised against a real Identity command/query pair (`MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:17`-`:27`).
- **Depends on** - [DecoratorPipelineOrderTestsBase&lt;TCommand, TCommandResult, TQuery, TQueryResult&gt;](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult) from the `MMCA.Common.Testing` package (`MMCA.ADC.Architecture.Tests.csproj:43`), closed over [ChangePreferencesCommand](group-24-identity-module.md#changepreferencescommand) / [Result](group-01-result-error-handling.md#result) and [GetUserPreferencesQuery](group-14-module-system-composition.md#getuserpreferencesquery) / `Result<`[UserPreferencesResponse](group-08-auth.md#userpreferencesresponse)`>` (`DecoratorPipelineOrderTests.cs:27`). Externals: `Microsoft.Extensions.DependencyInjection`, `Microsoft.FeatureManagement`, `NullLogger<>`, and Moq (`:1`-`:13`).
- **Concept introduced, an object-graph assertion.** Scrutor's `TryDecorate` applies decorators in reverse registration order, so the *last* decorator registered becomes the outermost wrapper. That makes an innocent-looking reorder of the `AddApplicationDecorators()` lines, or a module handler scan that runs after it instead of before, a silent change in runtime behavior: the code still compiles, the container still resolves, and the pipeline quietly runs validation after the transaction opens. The base turns that into a test failure by resolving the handler and walking the constructed graph via reflection over each decorator's private inner-handler field, so it verifies the objects that actually exist rather than the registration list (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:27`-`:30`, `:98`-`:118`). `[Rubric §2 - Design Patterns]` assesses whether patterns are applied deliberately and correctly; the decorator chain is the framework's central pattern and this is the only test that proves its composition. `[Rubric §14 - Testability]`: the fact that a production registration sequence can be replayed in a bare `ServiceCollection` with five mocked dependencies is itself the evidence that the composition root is not entangled with hosting.
- **Walkthrough** - one member, `ConfigureServices(IServiceCollection)` (`DecoratorPipelineOrderTests.cs:29`), which implements the base's single abstract hook (`DecoratorPipelineOrderTestsBase.cs:44`) and reads in two halves.
  - **Test doubles for the decorator constructor dependencies** (`:32`-`:36`): `Mock.Of<IFeatureManager>()`, `Mock.Of<ICorrelationContext>()`, and `Mock.Of<ICacheService>()` as singletons, a scoped `IUnitOfWork` factory, and the open generic `ILogger<>` mapped to `NullLogger<>`. These exist only so the decorators can be constructed; the test never invokes a handler.
  - **The real registration sequence** (`:40`-`:42`): `AddApplication()`, then `ScanModuleApplicationServices<MMCA.ADC.Identity.Application.ClassReference>()`, then `AddApplicationDecorators()` last. The comment states the load-bearing constraint plainly (`:38`-`:39`): TryDecorate can only wrap handlers already registered.
  - The two inherited facts then assert the chains. `CommandPipeline_NestsDecorators_InAdr014Order` (`DecoratorPipelineOrderTestsBase.cs:65`) expects FeatureGate, Logging, Caching, Validating, Transactional, then the concrete handler; `QueryPipeline_NestsDecorators_InAdr014Order` (`:69`) expects FeatureGate, Logging, Caching, then the handler (`:47`-`:62`). Both also assert the innermost element does *not* end in "Decorator" (`:89`-`:90`), so a truncated chain cannot pass.
- **Why it's built this way** - the pair was chosen for realism rather than convenience: `ChangePreferencesCommand` and `GetUserPreferencesQuery` are shipped Identity use cases, and the query's handler lives in MMCA.Common while the command's lives in ADC, so the scan-then-decorate ordering is exercised across the framework and app boundary rather than against a fixture.
- **Where it's used** - an independent class in ADC's architecture suite; nothing consumes it.
- **Caveats / not-in-source** - the chain is unwrapped by reading compiler-generated private fields, so a future decorator that stores its inner handler somewhere other than a field (a property-only or captured-closure design) would be invisible to the walk. The base flags the reflection strategy explicitly (`DecoratorPipelineOrderTestsBase.cs:93`-`:97`).

### ConcurrencyConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the guard that every update request participates in optimistic concurrency. It is also the plainest example of the Level 10 shape in this unit: a sealed class whose entire body is one line supplying the map (`MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:5`).
- **Depends on** - [ConcurrencyConventionTestsBase](#concurrencyconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced, the map-only subclass.** Seventeen types in this unit are exactly this: `protected override IArchitectureMap Map { get; } = new AdcArchitectureMap();` and nothing else. Note the property is an auto-property with an initializer, not an expression body, so each class constructs its map once per test-class instance rather than per fact. Everything else (the rule bodies, the `[Fact]` attributes, the failure messages) is inherited, which is precisely the point: MMCA.Common, MMCA.Store, and MMCA.ADC run byte-identical rule logic and differ only in what they point it at. The sections below for the other map-only subclasses do not repeat this explanation; they name the base and list what it asserts. `[Rubric §16 - Maintainability]` assesses duplication and change cost: a new rule ships to all three repos by adding a base and one derived line per repo.
- **Walkthrough** - one member, `Map` (`:5`). The inherited fact is `UpdateRequests_ShouldImplement_IConcurrencyAware` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:13`), which delegates to `ArchitectureRules.UpdateRequestsAreConcurrencyAware(Map)`. `[Rubric §8 - Data Architecture]`: an update request that does not carry a row version cannot detect a lost update, so this rule keeps [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) from being optional in practice.
- **Where it's used** - runs with the whole suite in the `build-and-test` job (`MMCA.ADC/.github/workflows/deploy.yml:124`, `:219`). The same is true of every remaining type in this unit and is not repeated below.

### ConstructorDependencyCountTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:17` · Level 10 · class (public, sealed)

- **What it is** - a single-responsibility ceiling: no service in a mapped module Application assembly may take more than seven constructor dependencies (`MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:19`-`:21`).
- **Depends on** - [ConstructorDependencyCountTestsBase](#constructordependencycounttestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced, the ratchet set to the real high-water mark.** A ceiling is only a ceiling if it sits at the current maximum. The class comment records a genuine incident (`:10`-`:15`): the limit was 8 while the largest real constructor took 7, so the gate carried a phantom slot of headroom and a service could have grown to 8 without ever tripping. It was tightened to 7 on 2026-07-28. `[Rubric §1 - SOLID]` assesses single responsibility among other things; constructor arity is the cheapest mechanical proxy for a class that has accumulated too many jobs, and the comment is careful to distinguish a cohesive facade from an artificial bundle.
- **Walkthrough** - two members. `Map` (`:19`), and `MaxConstructorDependencies => 7` (`:21`), which implements the base's abstract ceiling (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:22`). The inherited fact is `ApplicationServices_DoNotExceedConstructorDependencyCeiling` (`:25`). The comment names the two types currently at the mark, [AuthenticationService](group-24-identity-module.md#authenticationservice) and [CreateSessionHandler](group-18-conference-application.md#createsessionhandler) (`ConstructorDependencyCountTests.cs:6`-`:9`).
- **Why it's built this way** - the ceiling is meant to be raised consciously rather than drifted past, which is what the comment asks for (`:9`).
- **Caveats / not-in-source** - the sibling rule [HandlerConventionTests](#handlerconventiontests) inherits a separate, looser arity check defaulted to 8 (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:12`), so ADC effectively has two overlapping limits and this one is the binding constraint. Whether the two rules scan an identical type set is decided inside `ArchitectureRules` and is not determinable from these subclasses.

### ControllerConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the API-layer convention guard, with a two-entry exemption list for the controllers that legitimately do not route through the framework's base controller (`MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:11`-`:15`).
- **Depends on** - [ControllerConventionTestsBase](#controllerconventiontestsbase), [AdcArchitectureMap](#adcarchitecturemap), and, by name only (they are strings, not type references), [OAuthController](group-24-identity-module.md#oauthcontroller) and [ServiceInfoController](group-20-conference-api-grpc.md#serviceinfocontroller).
- **Concept introduced, the documented exemption.** A rule with no escape hatch gets deleted the first time reality disagrees with it; a rule with an undocumented escape hatch rots. The middle path here is an allowlist of fully qualified names, each justified in the comment above it (`:7`-`:10`): the OAuth controller drives a redirect, challenge, and cookie flow with an out-of-band token exchange, and the service-info controller is an anonymous version-discovery diagnostic, so neither returns a domain `Result` and neither has anything to gain from the `Result`-to-HTTP mapping in [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase). `[Rubric §9 - API & Contract Design]` assesses consistency of the HTTP surface; the rule keeps the default consistent while naming the two deliberate outliers.
- **Walkthrough** - two members. `Map` (`:5`) and `ControllersExemptFromApiControllerBase` (`:11`-`:15`), which overrides the base's empty default (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:12`). Four facts are inherited: controllers do not depend on Infrastructure (`:15`), do not depend on EF Core (`:18`), are sealed (`:21`), and inherit `ApiControllerBase` except for the exempt names (`:24`).
- **Caveats / not-in-source** - the exemptions are matched as strings, so renaming or moving either controller silently drops it from the list and turns the rule red rather than passing wrongly, which is the safe direction.

### DataResidencyTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12` · Level 10 · class (public, sealed)

- **What it is** - a compliance drift guard: the data-residency statement published in ADC's `PRIVACY.md` must match the Azure region where personal data is actually provisioned, parsed out of the deployment workflow (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:3`-`:11`).
- **Depends on** - [DataResidencyTestsBase](#dataresidencytestsbase), [AdcArchitectureMap](#adcarchitecturemap), `System.IO.File`/`Path`, and AwesomeAssertions (used directly inside the override, `:26`).
- **Concept introduced, a test as the join between a document and an infrastructure fact.** Most of the rules in this unit compare code to code. This one compares prose to infrastructure: it reads the deployed region out of the source of truth (`SQL_LOCATION="${SQL_LOCATION_OVERRIDE:-westus2}"`, `MMCA.ADC/.github/workflows/deploy.yml:949`) and then requires `PRIVACY.md` to say the same thing, comparing whitespace-insensitively and case-insensitively so "West US 2" matches the `westus2` region token (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:55`-`:58`). `[Rubric §30 - Compliance/Privacy/Data Governance]` assesses whether privacy claims are true and stay true; a policy that names a region the data never lived in is a compliance defect that no code review would catch, and this is the mechanism that closes it.
- **Walkthrough** - three members.
  - `Map` (`:14`) exists only so the base can resolve the repo root through `ArchitectureMapBase.FindRepoRoot($"{Map.RepoToken}.slnx")` (`DataResidencyTestsBase.cs:28`); no assembly scanning happens in this rule.
  - `ForbiddenResidencyClaims => ["central United States"]` (`:16`) overrides the base's empty default (`DataResidencyTestsBase.cs:23`) and blocks a specific stale statement from returning, one that once contradicted the deployed region (`DataResidencyTests.cs:9`-`:10`).
  - `ExtractDeployedRegion(string repoRoot)` (`:20`-`:31`) implements the base's abstract hook (`DataResidencyTestsBase.cs:53`). It reads `.github/workflows/deploy.yml` (`:22`), locates the literal marker `SQL_LOCATION_OVERRIDE:-` with an ordinal `IndexOf` (`:24`-`:25`), asserts the marker exists with a `because` explaining what the workflow must declare (`:26`-`:27`), then takes the alphanumeric run that follows as the region (`:29`-`:30`). Assert-then-parse rather than return-empty is exactly what the base asks implementations to do (`DataResidencyTestsBase.cs:47`-`:52`).
  - The inherited fact `PrivacyPolicy_DataStorageRegion_MatchesDeployedRegion` (`DataResidencyTestsBase.cs:26`) then asserts the normalized policy contains the normalized region (`:37`) and contains none of the forbidden claims (`:40`-`:44`).
- **Why it's built this way** - the account data and session bookmarks live in the Azure SQL database, and the QiMata Sponsorship subscription forces that SQL server into a different region from the Container Apps (`DataResidencyTests.cs:5`-`:9`), so "where the app runs" is genuinely not "where the personal data sits". Parsing the SQL region default rather than the app region encodes that distinction.
- **Caveats / not-in-source** - the parse is positional: it takes the first occurrence of the marker in `deploy.yml`. The workflow contains both a job-level `SQL_LOCATION_OVERRIDE` env binding (`deploy.yml:914`) and the shell default (`:949`), so the rule depends on the marker string `SQL_LOCATION_OVERRIDE:-` appearing only in the latter form.

### DomainPurityTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the Clean Architecture purity guard, plus one repo-specific addition: RabbitMQ is added to the forbidden-dependency list for Domain and Shared (`MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:9`).
- **Depends on** - [DomainPurityTestsBase](#domainpuritytestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced** - the map-only shape from [ConcurrencyConventionTests](#concurrencyconventiontests), extended by a one-line hook. The extra entry is not decoration: ADC runs on a broker (RabbitMQ locally, Azure Service Bus in production, `:7`-`:8`), and a broker client reference inside Domain would tie the model to a transport. `[Rubric §3 - Clean Architecture]` assesses inward-only dependencies; `[Rubric §7 - Microservices Readiness]`: keeping the transport out of the core is what makes [IMessageBus](group-04-events-outbox.md#imessagebus) substitutable between in-process and broker delivery.
- **Walkthrough** - two members: `Map` (`:5`) and `ExtraForbiddenDomainDependencies => ["RabbitMQ"]` (`:9`), overriding the base's empty default (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:12`). Four facts are inherited: Domain is framework-free (`:15`), Shared is framework-free (`:18`), Application does not depend on EF Core (`:21`), and Application does not depend on ASP.NET Core (`:24`). The extra token is passed to the first two only.

### EntityConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the DDD entity-shape guard for ADC's three module domains: aggregate roots exist, each has a `Result`-returning static factory and no public constructor, domain entities are sealed and live in the Domain layer, and DTOs or requests do not.
- **Depends on** - [EntityConventionTestsBase](#entityconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). Seven inherited facts (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:14`, `:17`, `:20`, `:23`, `:26`, `:29`, `:32`) cover aggregate-root exposure, the `Result`-returning `Create` factory, constructor visibility, factory return types, sealing, layer placement, and the DTO/request exclusion. `[Rubric §4 - DDD]` assesses whether the tactical patterns are actually applied; this is the rule that keeps the factory-plus-`Result` construction contract from being optional in a new module.

### EventConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/EventConventionTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the integration-event shape guard: every integration event declares a schema version, inherits the framework's base integration event, and lives in an `*.IntegrationEvents` namespace under Shared.
- **Depends on** - [EventConventionTestsBase](#eventconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). Three inherited facts (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:13`, `:16`, `:19`) enforce `SchemaVersion`, base-type inheritance, and namespace placement ([ADR-010](https://ivanball.github.io/docs/adr/010-integration-event-schema-versioning.html)). `[Rubric §6 - CQRS & Event-Driven]` assesses the discipline around asynchronous contracts; this rule handles the *shape*, while [IntegrationEventContractTests](#integrationeventcontracttests) freezes the *content*.

### FormsConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:14` · Level 10 · class (public, sealed)

- **What it is** - the UX-safety guard over ADC's admin forms. It configures the shared rule for the six Conference create forms and adds a hand-written fact for the Identity Profile form, which by design does not match the shared rule's glob (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:3`-`:13`).
- **Depends on** - [FormsConventionTestsBase](#formsconventiontestsbase), [AdcArchitectureMap](#adcarchitecturemap), [ArchitectureMapBase](#architecturemapbase) (called statically for the repo root, `:34`), `System.IO`, and AwesomeAssertions.
- **Concept introduced, extending a rule instead of replacing it, and covering what it cannot reach.** Two mechanisms appear here for the first time in this unit. First, `RequiredMarkers` is overridden by *spreading the base list* and appending to it (`.. base.RequiredMarkers`, `:26`), so ADC inherits the six framework markers (`UnsavedChangesGuard`, `IsDirtyAccessor`, `_isDirty`, `<MudForm`, `Required="true"`, `RequiredError`; `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:27`-`:35`) and adds two of its own without restating them. Second, when a real surface falls outside the shared rule's reach, the subclass writes the missing coverage itself rather than loosening the shared rule. `[Rubric §24 - Forms/Validation/UX Safety]` assesses whether users are protected from losing work and from unclear validation; both halves here are that protection made executable.
- **Walkthrough**
  - `Map` (`:16`) and `MinimumCreateForms => 6` (`:18`), raising the base floor of 1 (`FormsConventionTestsBase.cs:24`) to ADC's real count: Event, Session, Room, Question, Speaker, and ConferenceCategory (`FormsConventionTests.cs:5`-`:6`).
  - `RequiredMarkers` (`:24`-`:29`) appends two literals to the inherited set: the per-form `<MudAlert Severity="Severity.Error"` error summary and the localized heading key `Validation.CorrectFollowing`.
  - `ProfileForm_KeepsErrorSummaryAndPasswordValidation` (`:31`-`:62`) is the only hand-written `[Fact]` in this unit. It resolves the repo root from the map's token (`:34`), builds the path to `Source/Modules/Identity/MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor` (`:35`-`:36`), and asserts the file exists first, with a `because` explaining that a form that is not discovered is a convention that is not verified (`:38`-`:39`). It then requires four markers (`:43`-`:49`): the error summary, `Errors.Length: > 0` (the summary rendering from the live MudForm error list), and the `ValidateNewPassword` / `ValidateConfirmPassword` client-side wiring; it reports every missing marker at once rather than failing on the first (`:51`-`:56`). Finally it counts occurrences of `Required="true"` and `RequiredError`, requiring at least three of each so all three password fields stay required and keep a user-facing message (`:58`-`:61`), using the local `CountOccurrences` helper (`:64`-`:75`).
- **Why it's built this way** - the Profile form is a single-section password and delete form with no navigate-away step, so it carries no unsaved-changes guard by design and does not match the base's `*Create.razor` glob (`:9`-`:12`); the base documents exactly that exclusion (`FormsConventionTestsBase.cs:11`-`:13`). Rather than weakening the shared rule to accommodate it, ADC asserts the markers that *do* apply.
- **Caveats / not-in-source** - the hand-written fact hardcodes one file path, so moving `Profile.razor` fails the test (again, the safe direction) but adding a second self-service form gains no coverage automatically.

### FrameworkVersionConsistencyTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9` · Level 10 · class (public, sealed)

- **What it is** - the lockstep-versioning gate: every `MMCA.Common.*` package pinned in ADC's `Directory.Packages.props` must carry one and the same version, so a partial sweep fails CI instead of producing a subtly mismatched framework surface at runtime (`MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:3`-`:8`).
- **Depends on** - [FrameworkVersionConsistencyTestsBase](#frameworkversionconsistencytestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)); the map is used for its repo token, to find the props file from the repo root.
- **Concept introduced** - a policy made executable. [ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html) says consumers bump every `MMCA.Common.*` entry together, with no phased rollout. A policy that lives only in a document is enforced by memory; this rule enforces it by build. `[Rubric §32 - Dependency & Supply-Chain]` assesses how dependency versions are governed; `[Rubric §16 - Maintainability]`: a half-swept pin set is the kind of defect that surfaces as an unrelated runtime error weeks later.
- **Walkthrough** - one member, `Map` (`:11`). The inherited fact is `AllMmcaCommonPackages_ArePinnedToOneVersion` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:25`), and the base's non-vacuity floor `MinimumCommonPackageCount` stays at its default of 13 (`:22`). ADC currently pins 15 `MMCA.Common.*` packages (`MMCA.ADC/Directory.Packages.props`), so the floor is met with room to spare.

### HandlerConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the CQRS handler placement and composition guard: handlers and validators live in the Application layer, handlers do not inject other handlers, application services do not inject handlers, domain event handlers are sealed and live in Application, and application services respect a constructor-arity limit.
- **Depends on** - [HandlerConventionTestsBase](#handlerconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). Six inherited facts (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:15`, `:18`, `:21`, `:24`, `:27`, `:30`). `MaxServiceConstructorParameters` is left at the base default of 8 (`:12`); see the note under [ConstructorDependencyCountTests](#constructordependencycounttests), which sets a tighter ceiling of 7. `[Rubric §6 - CQRS & Event-Driven]` assesses whether the command/query split is structural rather than nominal; a handler that injects another handler is the classic way that split quietly becomes a call graph.

### HandlerResultConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/HandlerResultConventionTests.cs:8` · Level 10 · class (public, sealed)

- **What it is** - the gate that turns a runtime constraint into a build-time one: every ADC command and query handler's `TResult` must be [Result](group-01-result-error-handling.md#result) or `Result<T>` (`MMCA.ADC.Architecture.Tests/HandlerResultConventionTests.cs:3`-`:7`).
- **Depends on** - [HandlerResultConventionTestsBase](#handlerresultconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Concept introduced** - shifting a failure left. The decorator pipeline can short-circuit (a feature flag off, a validation failure, a cache hit), and to do that it must manufacture a failed result of the handler's `TResult`; the comment names the mechanism, `ResultFailureFactory` (`:5`-`:6`). A handler returning a bare DTO therefore compiles and registers cleanly and only explodes the first time a short-circuit fires in production. `[Rubric §6 - CQRS & Event-Driven]` and `[Rubric §14 - Testability]`: an invariant the type system cannot express is exactly what a fitness function is for.
- **Walkthrough** - one member, `Map` (`:10`). Three inherited facts (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:21`, `:24`, `:27`): the Application layers declare at least one handler (a non-vacuity check), command handlers return result types, and query handlers do too. Opt-in from v1.120.0 (`HandlerResultConventionTests.cs:3`).

### ImmutabilityTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the immutability guard across five categories of type: DTOs, commands and queries, domain events, integration events, and value objects (the last also required to be sealed and to live in Shared).
- **Depends on** - [ImmutabilityTestsBase](#immutabilitytestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). Five inherited facts (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:13`, `:16`, `:19`, `:22`, `:25`). `[Rubric §15 - Best Practices & Code Quality]` assesses whether the codebase holds its stated conventions; `required`/`init` immutability is a workspace-wide convention, and an event whose properties can be mutated after publication is a correctness hazard, not a style preference.

### IntegrationEventContractTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the frozen wire contract for ADC's cross-service asynchronous API. It commits a seven-line snapshot of every integration event's full name and property shape, and the build fails if the live contract differs (`MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:9`-`:20`).
- **Depends on** - [IntegrationEventContractTestsBase](#integrationeventcontracttestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced, the approval snapshot.** The rules above check *shape rules*; this one checks *identity*. A consumer in another service deserializes by shape, so a renamed, removed, or retyped property (or a brand-new event shipped without a consumer) breaks the contract at runtime with no compile error anywhere. The base rebuilds the live contract from the map and asserts sequence equality against the committed list (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:21`-`:28`), so any change surfaces as a diff in this file that a reviewer must consciously accept. `[Rubric §9 - API & Contract Design]` assesses contract governance, and the asynchronous contract is as much an API as the REST surface; `[Rubric §7 - Microservices Readiness]`: with all four ADC modules already running as separate services, this list is the actual coupling between them.
- **Walkthrough** - two members. `Map` (`:5`), and `ExpectedContract` (`:9`-`:20`), a collection expression of seven strings in `FullName { Prop:Type, ... }` form: `EventFeedbackSubmitted` and `SessionFeedbackSubmitted` from Conference, `SpeakerLinkedToUser` and `SpeakerUnlinkedFromUser` from Conference (the pair Identity consumes to set and clear `User.LinkedSpeakerId`), [AttendeeCheckedIn](group-22-engagement-module.md#attendeecheckedin) from Engagement, and `UserDeleted` plus [UserRegistered](group-24-identity-module.md#userregistered) from Identity. The properties are listed in sorted order, which is how a rebuilt contract stays comparable line by line.
- **Why it's built this way** - the comment states the rule of engagement (`:7`-`:8`): update the snapshot deliberately, and version the event or coordinate the consumer rollout in the same commit. The `AttendeeCheckedIn` entry carries its own inline justification (`:15`-`:16`): `SponsorId` is additive, optional, defaults to null, and is declared last precisely so a payload written before the sponsor scope existed still deserializes (confirmed in the event itself, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/CheckIns/IntegrationEvents/AttendeeCheckedIn.cs:21`, `:29`).
- **Caveats / not-in-source** - the snapshot proves that the shape has not changed, not that any consumer actually handles it. Consumer-side behavior is exercised by the cross-service Testcontainers tier, not here.

### LayerDependencyTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the Clean Architecture layer-flow guard, and the highest-fact-count rule in the unit: fifteen inherited facts covering which layer may reference which.
- **Depends on** - [LayerDependencyTestsBase](#layerdependencytestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). Two of the facts are map-completeness checks: `LayerMap_DeclaresEveryExpectedLayer` and `LayerMap_ModulesDeclareEveryExpectedLayer` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:27`, `:30`) require the five core layers Shared, Domain, Application, Infrastructure, and Api to be declared, both overall and by every mapped module (`:16`-`:24`, left at their defaults here). ADC satisfies the module half because [AdcArchitectureMap](#adcarchitecturemap) declares all six layers for each of Identity, Conference, and Engagement (`AdcArchitectureMap.cs:22`-`:43`). The remaining thirteen facts (`:33` through `:69`) assert the directed rules: Domain depends on neither Application, Infrastructure, nor Api; Application on neither Infrastructure nor Api; Infrastructure not on Api; Shared on nothing above it; and Ui on none of Domain, Application, or Infrastructure. `[Rubric §3 - Clean Architecture]` is the whole point of this rule. Note the two-gate model described in `MMCA.Common/CLAUDE.md`: the same boundaries are enforced at compile time in the framework by `MMCA.Common.LayerEnforcement.targets`, and here at test time against compiled assemblies.

### LocalizedTextConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:14` · Level 10 · class (public, sealed)

- **What it is** - the companion to [TranslationCompletenessTests](#translationcompletenesstests). Where that one asks "is every key translated", this one asks "does every user-visible string go through a key at all": no hard-coded literals in `.razor` or `.razor.cs` under `Source/` (`MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:3`-`:13`).
- **Depends on** - [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced** - the per-line escape marker. Some literals genuinely should not be translated (the conference brand name, content data), so the rule exempts them with an `i18n: allow` comment on the offending line rather than an allowlist file (`:9`-`:10`). Keeping the exemption physically next to the literal is what makes it reviewable. `[Rubric §27 - i18n]`, executing [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
- **Walkthrough** - two members. `Map` (`:16`) and `MinimumScannedFiles => 60` (`:18`), raising the base default of 1 (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:21`); the comment sizes the floor against roughly 77 razor files across the three module UIs and the UI hosts (`LocalizedTextConventionTests.cs:11`-`:12`). The inherited fact is `UserVisibleText_IsLocalized` (`LocalizedTextConventionTestsBase.cs:31`), and the base's `AllowedFiles` hook (`:28`) is left empty, so ADC exempts nothing at file granularity. The scan covers snackbar messages, page `Title` properties, `<PageTitle>` markup, breadcrumb labels, and NavItem titles, the last of which must carry a `TitleResource` (`LocalizedTextConventionTests.cs:6`-`:9`).

### MicroserviceExtractionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the single-fact guard that transport never leaks into the core layers, so a module behaves identically in-process or extracted.
- **Depends on** - [MicroserviceExtractionTestsBase](#microserviceextractiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). One inherited fact, `CoreLayers_ShouldNotDependOn_Transport` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:13`). `[Rubric §7 - Microservices Readiness]` assesses whether extraction is a configuration change or a rewrite. ADC is the repo where this rule has already been cashed in: all four modules run as separate service hosts behind a YARP gateway ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)), and the rule is what keeps the core layers clean enough for the next one.

### ModuleIsolationTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the guard that Identity, Conference, and Engagement do not reach into each other: module Domains, Applications, Infrastructures, and APIs are each isolated from their siblings, and neither Domain nor Application may reach another module's Infrastructure.
- **Depends on** - [ModuleIsolationTestsBase](#moduleisolationtestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). Six inherited facts (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:13`, `:16`, `:19`, `:22`, `:25`, `:28`). The targets are computed by the map: for each module and layer it derives the *other* modules' root namespaces (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:69`-`:72`), which is why adding a module to the map immediately expands what every other module is forbidden to touch. `[Rubric §7 - Microservices Readiness]` and `[Rubric §5 - Vertical Slice]`: cross-module collaboration in ADC goes through interfaces satisfied by gRPC clients, and this rule is what stops a direct reference from quietly becoming the cheaper option.

### NamingConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the ten-fact naming and sealing guard: handler, command, query, validator, DTO, specification, repository, and EF configuration suffixes, plus domain events sealed in a `*.DomainEvents` namespace and invariant classes static.
- **Depends on** - [NamingConventionTestsBase](#namingconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). Ten inherited facts (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:13` through `:40`). `[Rubric §15 - Best Practices & Code Quality]`, and more practically `[Rubric §16 - Maintainability]`: several framework mechanisms (the Scrutor handler scan, the DTO/mapper registration, the decorator wrapping) find their targets by convention, so a naming slip is not cosmetic, it silently un-registers a type.

### PiiConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the privacy structural guard: every domain entity declaring a [PiiAttribute](group-02-domain-building-blocks.md#piiattribute)-marked property must implement [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable), so an entity that holds personal data always has an erasure path.
- **Depends on** - [PiiConventionTestsBase](#piiconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). One inherited fact, `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:12`). `[Rubric §30 - Compliance/Privacy/Data Governance]` assesses whether privacy obligations are structural rather than procedural: soft delete is the default everywhere in MMCA, so erasure has to be an explicit, tested capability ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). Unlike its counterpart in MMCA.Common, this instance is non-vacuous: ADC's Identity domain holds real attendee data.

### RawQueryableConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/RawQueryableConventionTests.cs:11` · Level 10 · class (public, sealed)

- **What it is** - the rule that Application-layer code must not use the repository's raw `IQueryable` surfaces (`Table` / `TableNoTracking*`), carrying an eight-file allowlist that pins ADC's existing deliberate uses (`MMCA.ADC.Architecture.Tests/RawQueryableConventionTests.cs:3`-`:9`, `:33`-`:52`).
- **Depends on** - [RawQueryableConventionTestsBase](#rawqueryableconventiontestsbase), [AdcArchitectureMap](#adcarchitecturemap), [ArchitectureMapBase](#architecturemapbase) (statically, for the repo root at `:28`), and `System.IO.Path`.
- **Concept introduced, the adoption ratchet.** A convention introduced into a codebase that already violates it in eight places has two bad options: fail the build on day one, or exempt the whole layer. The ratchet is the third: enumerate the existing violations explicitly so that *new* code is what the rule blocks, then shrink the list over time. The comment states the discipline directly, "Shrink it over time; never grow it without the same scrutiny" (`:8`-`:9`). `[Rubric §8 - Data Architecture]` assesses how query access is layered; `[Rubric §7 - Microservices Readiness]` is the stated motivation: a raw-queryable handler is EF-coupled and cannot move behind a gRPC boundary (`:5`-`:6`).
- **Walkthrough** - three members.
  - `Map` (`:13`).
  - `ApplicationSourceDirectories()` (`:21`-`:30`) overrides the base's virtual enumeration (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RawQueryableConventionTestsBase.cs:45`) by yielding everything the base produces (`:23`-`:26`) and then appending one more path: `Source/Modules/Notification/MMCA.ADC.Notification.Application`, resolved from `FindRepoRoot("MMCA.ADC.slnx")` (`:28`-`:29`). The `<remarks>` explains why (`:16`-`:20`): the thin Notification module (API plus Application only) is not a mapped module, so without this it would escape the rule.
  - `AllowedFiles` (`:33`-`:52`) overrides the base's empty default (`RawQueryableConventionTestsBase.cs:38`) with eight file names, each grouped under a comment saying why it is exempt: the Engagement live layer's conference-day hot-path aggregations, which need GROUP BY and COUNT shapes the focused repository surface cannot express ([LivePollResultsBuilder](group-23-engagement-live-layer.md#livepollresultsbuilder), [SessionQuestionViewBuilder](group-23-engagement-live-layer.md#sessionquestionviewbuilder), [GetModerationQueueHandler](group-23-engagement-live-layer.md#getmoderationqueuehandler), [GetSessionQuestionsHandler](group-23-engagement-live-layer.md#getsessionquestionshandler), `:35`-`:40`); the Engagement bookmark count and page projection ([BookmarkCountService](group-22-engagement-module.md#bookmarkcountservice), [GetUserBookmarksHandler](group-22-engagement-module.md#getuserbookmarkshandler), `:42`-`:45`); Identity's server-side user list paging and sorting projection ([GetUsersHandler](group-24-identity-module.md#getusershandler), `:47`-`:48`); and Notification's GDPR export joins ([UserNotificationExportService](group-10-notifications.md#usernotificationexportservice), `:50`-`:51`). Every entry is annotated as intra-module, which is the actual test for whether an exemption is safe: the queries never cross a module boundary, so they would travel with the module if it moved.
  - The inherited fact is `ApplicationLayer_DoesNotUseRawQueryableSurfaces` (`RawQueryableConventionTestsBase.cs:61`), a textual scan rather than an assembly scan, which is why it needs directories rather than the map's assemblies.
- **Caveats / not-in-source** - `AllowedFiles` matches by file name, not by path, so two files with the same name in different modules would both be exempted. Nothing here enforces the "shrink it over time" discipline the comment asks for.

### SharedLayerTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:3` · Level 10 · class (public, sealed)

- **What it is** - the guard on the Shared layer, the one layer other modules are allowed to reference: a module's Shared project must not depend on that module's own internal layers, must not reach sibling modules, and must stay free of EF Core.
- **Depends on** - [SharedLayerTestsBase](#sharedlayertestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:5`). Three inherited facts (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:12`, `:15`, `:18`). `[Rubric §7 - Microservices Readiness]` and `[Rubric §9 - API & Contract Design]`: Shared holds the DTOs, requests, and integration events that cross a module boundary, so a dependency from Shared into Domain or Infrastructure would drag the module's internals along with its contract and make extraction impossible.

### SliceCohesionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:8` · Level 10 · class (public, sealed)

- **What it is** - the vertical-slice cohesion rule: every module's `Application/{Aggregate}/UseCases/{Operation}/` slice keeps its command or query, its handler, and its validator in one namespace, and the build fails if a handler is stranded from its contract (`MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:3`-`:7`).
- **Depends on** - [SliceCohesionTestsBase](#slicecohesiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Walkthrough** - one member, `Map` (`:10`). Two inherited facts, `Handlers_ShouldBeCoLocatedWith_TheirContracts` and `Validators_ShouldBeCoLocatedWith_TheirContracts` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:15`, `:19`). `[Rubric §5 - Vertical Slice]` assesses whether a feature is one navigable unit; the rule turns the folder convention into something the build can check, so the slice does not erode into a layer-per-type layout one refactoring at a time.

### SpecificationConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8` · Level 10 · class (public, sealed)

- **What it is** - the cross-source specification guard: no specification may filter by navigating to another entity, because such a filter would not translate if that entity later moved to a different data source. The stated alternative is [CrossSourceSpecification](group-03-querying-specifications.md#crosssourcespecification) (`MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:3`-`:7`).
- **Depends on** - [SpecificationConventionTestsBase](#specificationconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Concept introduced** - a forward safeguard for a capability that is not currently exercised. Every ADC entity routes to SQL Server today: the Conference Session-to-Cosmos and Room-to-SQLite polyglot trial was reverted, but the framework extension points were kept ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), so ADC opts into the rule anyway (`:3`-`:6`). This is worth noticing as a deliberate choice: the rule costs nothing while the repo is single-engine and prevents a class of query from being written that would have to be unwritten later.
- **Walkthrough** - one member, `Map` (`:10`). One inherited fact, `Specifications_ShouldNotNavigate_ToOtherEntities` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:16`). `[Rubric §8 - Data Architecture]`.

### StateManagementConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:9` · Level 10 · class (public, sealed)

- **What it is** - the Blazor state-ownership guard: the Identity, Conference, and Engagement UI assemblies carry no mutable static state, and stateful UI services stay scoped (`MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:3`-`:8`).
- **Depends on** - [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Concept introduced** - why this is a correctness rule and not a style rule. Under Blazor Server every user gets a circuit inside one process, so a mutable static member is shared across every connected attendee, and a singleton-registered stateful service is the same defect wearing a DI hat: one user's selection becomes everyone's. The comment says exactly this (`:6`-`:7`). `[Rubric §19 - State Management]` assesses how client state is scoped and owned; `[Rubric §11 - Security]` is the sharper edge, since cross-circuit leakage of user state is a data exposure, not just a bug.
- **Walkthrough** - one member, `Map` (`:11`). Two inherited facts, `UiAssemblies_CarryNoMutableStaticState` and `UiProjects_RegisterStatefulServicesScoped` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:28`, `:66`). The base's `AllowedStaticMembers` hook (`:25`) is left at its empty default, so ADC's module UIs have zero static-state allowances.

### UIArchitectureConventionTests

> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:10` · Level 10 · class (public, sealed)

- **What it is** - the container/presentational split enforced mechanically: every code-behind under `Source/` (module UI and UI hosts alike) stays within the 400-line convention cap, and inline `@code` blocks stay small (`MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:3`-`:9`).
- **Depends on** - [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap). Map-only shape ([ConcurrencyConventionTests](#concurrencyconventiontests)).
- **Concept introduced** - a size cap as a proxy for a structural property. Nothing can test "this component separates orchestration from presentation", but a code-behind that has grown past 400 lines has almost certainly stopped doing so. The comment records the payoff: the gate subsumes tech-debt item TD-13, because the oversized Conference dashboards were split to conform when it landed (`:7`-`:8`). That is the ratchet working in the other direction from [RawQueryableConventionTests](#rawqueryableconventiontests): instead of pinning the violations, the violations were fixed. `[Rubric §18 - UI Architecture]` assesses front-end composition and is the rule's own stated target.
- **Walkthrough** - one member, `Map` (`:12`). Two inherited facts, `CodeBehinds_StayWithinTheLineCap` and `RazorFiles_KeepInlineCodeBlocksSmall` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:44`, `:63`). All four tuning hooks stay at their base defaults: `MaxCodeBehindLines` 400 (`:22`), `MaxInlineCodeLines` 120 (`:29`), `MinimumCodeBehindFiles` 1 (`:35`), and an empty `ExcludedPathFragments` (`:41`), so ADC excludes nothing from the scan.

## Per-project test rollup

This guide treats **tests as grouped, not sectioned per `[Fact]`** (the logged exception in the
charter): the reusable test *bases*, the shared architecture-fitness library and its per-repo thin
subclasses, and the component **Gallery** harness each get their own `###` treatment in the earlier parts
of this chapter, but the bulk of the suite, **1,460 individual test types across 42 projects**, is rolled
up here. Each row below names a test project (assembly), the count of test types it contributes to the
1,460, **what** it covers, and its **style** (unit / integration / component / E2E / performance-smoke).
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
- **Two recent feature waves dominate the newer rows.** In the framework, the opt-in enterprise wave
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) multi-tenancy,
  [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) scheduler,
  [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) audit trail,
  [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) data-subject export,
  [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) HybridCache,
  [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html) CSV export) added whole
  test clusters to Infrastructure, API, Application, Shared and Aspire. In ADC, the sponsor surface and
  the QR badge check-in + points ledger
  ([ADR-072](https://ivanball.github.io/docs/adr/072-qr-badge-check-in-and-points.html), on top of
  [ADR-071](https://ivanball.github.io/docs/adr/071-barcode-scanning-and-qr-display.html)'s scan/display
  capability) added a matching cluster to every Engagement project and to the Conference domain, API and
  UI suites. Both waves are called out in the rows they land in.
- **Fitness tests and shared bases live elsewhere.** `MMCA.Common.Architecture.Tests` and
  `MMCA.ADC.Architecture.Tests` (the NetArchTest layer/purity/extraction suites, thin subclasses of the
  shared [`ArchitectureRules`](#architecturerules) rule library) are **not** in this table: they are
  covered as first-class sections earlier in this chapter. The same is true of the shared test *bases*
  ([`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture),
  [`HandlerTestBase<THandler>`](#handlertestbasethandler),
  [`BunitComponentTestBase`](#bunitcomponenttestbase),
  [`ProductionHostApplicationFactory<TEntryPoint>`](#productionhostapplicationfactorytentrypoint),
  [`SecurityHeadersTestsBase`](#securityheaderstestsbase),
  [`GracefulShutdownTestsBase<TEntryPoint>`](#gracefulshutdowntestsbasetentrypoint),
  [`ModuleConformanceTestsBase<TModule>`](#moduleconformancetestsbasetmodule),
  [`CrossServiceFixtureBase`](#crossservicefixturebase), [`JwtTokenGenerator`](#jwttokengenerator),
  [`TestPolling`](#testpolling), [`DependencyInjectionAssert`](#dependencyinjectionassert), the
  Playwright fixtures) and the `MMCA.Common.UI.Gallery` harness. The counts below therefore move when a
  repo adopts one of those bases: ADC's Gateway suite dropped a local host factory the week it took the
  shared one, and its Notification module test collapsed to a five-property subclass the week
  `ModuleConformanceTestsBase<TModule>` landed.
- **Four projects sit outside `MMCA.Common.slnx` on purpose.** `MMCA.Common.UI.Gallery`,
  `MMCA.Common.UI.E2E.Tests`, `MMCA.Common.Benchmarks`, and `MMCA.Common.Infrastructure.Redis.Tests` are
  absent from the solution file (`MMCA.Common/MMCA.Common.slnx:29` lists only the four `Tests/Core`
  projects, `:35` the four `Tests/Presentation` ones) so that `dotnet test --solution MMCA.Common.slnx`
  never needs Playwright browsers, a Docker daemon, or a multi-iteration timing run. CI builds and runs
  each one by csproj path in its own job (`ui-e2e` at `MMCA.Common/.github/workflows/ci.yml:228`,
  `performance-smoke` at `:332`, `redis-integration` at `:611`).
- **Two integration tiers, deliberately split.** Each service has a per-service `*.IntegrationTests`
  project that boots **one** host through `WebApplicationFactory<Program>` with cross-service gRPC edges
  faked and no broker (these run in the `integration-tests` CI job and need a real SQL Server named by
  `ADC_TEST_SQL_BASE`). Separately, `MMCA.ADC.CrossService.IntegrationTests` and
  `MMCA.ADC.ServiceBusEmulator.IntegrationTests` run against **Testcontainers** to prove the genuine
  broker and gRPC round-trips: both live in the non-gating
  `MMCA.ADC/.github/workflows/cross-service-tests.yml`, whose *recency* (not its result) gates deploys
  through the `cross-service-freshness` job at `MMCA.ADC/.github/workflows/deploy.yml:663`, a 5-day
  window set by `FRESHNESS_DAYS` at `MMCA.ADC/.github/workflows/deploy.yml:673`.
  `[Rubric §14, Testability]` (assesses how thoroughly and at what cost the system can be verified): the
  count and spread below, heavy at the inner Application/Domain layers, thinner at the edges, with a
  dedicated integration + E2E tier, is the classic healthy **test pyramid**, and the fact that the volume
  concentrates in fast in-memory unit layers keeps the feedback loop cheap.

### MMCA.Common, the framework suite (Tests/ mirrors Source/)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.Common.Shared.Tests` | 32 | The innermost layer: the `Result`/`Error`/`ErrorType` pattern, value objects (`Money`, `Email`, `Address`, `DateRange`, ...) and their factory-method invariants, DTO/paging contracts, and the striped keyed lock behind [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) (mutual exclusion per key, independent progress across stripes, release on the exception path, and a bounded table size no matter how many caller-supplied keys arrive, `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Concurrency/KeyedSemaphoreStripeTests.cs:12`). Two of its files defend contracts that only bite in a head with no ASP.NET pipeline: `MoneySerializationTests` pins the round trip of `Money`'s private `[JsonConstructor]`, which is also the constructor EF Core uses to materialize the owned type, so a materializer yielding a null currency must fail fast rather than surface a half-built value object (`.../ValueObjects/MoneySerializationTests.cs:11`); and `SupportedCulturesTests` pins `SupportedCultures.ResolveClosest`, the fallback chain a head applies when it resolves its own culture instead of getting request localization's `Accept-Language` matching for free, since an Android device reports a specific culture (`es-MX`) while the allowlist holds a neutral one and without the language-level match a Spanish phone would silently start in English (`.../Globalization/SupportedCulturesTests.cs:11`, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / §27). Its newest cluster covers the smart enumeration, [`Enumeration<TEnumeration>`](group-02-domain-building-blocks.md#enumerationtenumeration): reflection-based member discovery, `Result`-returning `FromValue`/`FromName` lookups (case-insensitive by name, an `UnknownValue`/`UnknownName` error rather than an exception), and **type-guarded** equality, so two enumerations that happen to share an integer value are never equal and never collide in a hash set (`.../ValueObjects/EnumerationTests.cs:10`), with the serialization half pinned separately. Pure **unit** tests, no DI or DB. |
| `MMCA.Common.Domain.Tests` | 45 | The entity hierarchy (`BaseEntity`→`AuditableBaseEntity`→`AuditableAggregateRootEntity`), domain-event collection, `SetItems<T>`/`GetChildOrNotFound<T>`, specifications, and the `PiiAttribute`/anonymization boundary plus the logging/telemetry redaction half of the `[Pii]` contract (masks marked members so a data subject's values never reach logs, [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) / §30). Its newest file covers [`OwnedByUserSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ownedbyuserspecificationtentity-tidentifiertype), the reusable "rows this caller created" criteria; the test's fake overrides the virtual `CreatedBy` getter, because that audit field is stamped by the infrastructure layer through EF's change tracker and is otherwise unsettable from a test (`MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/OwnedByUserSpecificationTests.cs:8`). Pure **unit** tests over the framework domain primitives. |
| `MMCA.Common.Application.Tests` | 211 | The CQRS engine: the decorator pipeline in its registered nesting order (FeatureGate→Logging→Caching→Validating→Transactional→handler, registered innermost-first because Scrutor's `TryDecorate` applies in reverse, `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:89`), the opt-in MiniProfiler decorators added by `AddApplicationProfiling` (`.../DependencyInjection.cs:219`) and the `CqrsMetrics` counters/histograms (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:20`), `ModuleLoader` topological ordering, `DomainEventDispatcher` plus the swallow-and-log `SafeDomainEventHandler` base (`.../DomainEvents/SafeDomainEventHandlerTests.cs:14`), validation, the [`IMessageBus`](group-04-events-outbox.md#imessagebus) abstraction, entity-query projection/paging and the per-type filter strategies, the cross-source [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification) helper ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), the magic-byte upload sniffer behind [`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer) (`.../ImageContentSnifferTests.cs:12`, [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)), and the notification read/send handlers driven by an injected `TimeProvider` test clock. Two older files are worth calling out because they defend non-obvious properties rather than behavior: `PagingMathTests` pins the page arithmetic (`.../Services/Query/PagingMathTests.cs:12`), and `QueryFilterServicePropertyCacheTests` asserts on the real static property cache inside [`QueryFilterService`](group-03-querying-specifications.md#queryfilterservice) to prove that caching a *miss* never happens, since filter names arrive in the query string and a negatively-cached miss would let any caller grow a process-lifetime dictionary one bogus name at a time while the request still returned a tidy 400 (`.../Services/Filtering/QueryFilterServicePropertyCacheTests.cs:14`, §11/§12). The **hoisted user use cases** hold a large block: `ChangePasswordHandlerBaseTests` pins verify-before-write ordering and the no-save-on-invariant-failure rule (`.../Users/ChangePasswordHandlerBaseTests.cs:15`, [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html)); `DeleteUserHandlerBaseTests` pins the owner-or-privileged-role gate, the delete-then-anonymize-then-save ordering and the post-commit queue (`.../Users/DeleteUserHandlerBaseTests.cs:14`); [`UserOwnershipRule`](group-14-module-system-composition.md#userownershiprule) gets its own tests for the self-service authorization check that was written out four times across the two apps before the hoist (`.../Users/UserOwnershipRuleTests.cs:11`); and `SoftDeletedUserValidatorTests` proves the BR-133 check is one query with the soft-delete global filter deliberately bypassed, matching only rows that exist **and** are deleted (`.../Users/SoftDeletedUserValidatorTests.cs:13`). Its newest sibling in that family is the DSAR workflow ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) / §30): `ExportUserDataHandlerBaseTests` drives [`ExportUserDataHandlerBase<TUser, TQuery>`](group-14-module-system-composition.md#exportuserdatahandlerbasetuser-tquery) through the same ownership gate, the read-only account load, and the best-effort section fan-out, where a section that throws or reports itself unavailable must **degrade** and let the rest of the package travel (a data-subject request is a legal deadline, so a partial export beats a failed one) while a *cancelled* section propagates instead (`.../Users/ExportUserDataHandlerBaseTests.cs:17`). Alongside them, [`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache) has its key shape and culture invariance pinned, because the API middleware reads that exact key (`.../Auth/SoftDeletedUserCacheTests.cs:13`); `CachingDecoratorConstructorSelectionTests` pins that the container picks the *logger-bearing* constructor on both caching decorators, since the logger-less overload exists only for source compatibility and if selection ever flipped the decorators would keep working and every test would stay green while production silently stopped reporting cache failures (`.../Decorators/CachingDecoratorConstructorSelectionTests.cs:21`); and `CachingDecoratorTenantScopingTests` covers the tenancy half of the same pair, where `ICacheService` is a singleton that cannot see the scoped tenant, so the **key transformation is the isolation**: without it two tenants computing the same query key would read each other's rows out of one entry, and command-side eviction must transform the prefix identically (`.../Decorators/CachingDecoratorTenantScopingTests.cs:16`, [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) / §11). The framework's largest suite by breadth; fast **unit** tests with mocked infrastructure. |
| `MMCA.Common.Infrastructure.Tests` | 279 | The widest layer: EF repositories + Unit of Work, the multi-database resolver/registry (`DataSourceResolver`, `EntityDataSourceRegistry`, `DbContextFactory`) with its transaction coverage (`.../Persistence/DbContextFactoryTransactionTests.cs:28`) and the cross-data-source degrade convention (`.../Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:24`), the **outbox** processor (eligibility/smart-wait/retry) plus its wake signal (`.../Persistence/OutboxSignalTests.cs:13`) and the consumer-side [`EfInboxStore`](group-04-events-outbox.md#efinboxstore) idempotency ledger (`.../Persistence/Inbox/EfInboxStoreTests.cs:27`, [ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)), caching, JWT issuance + JWKS + the login-attempt lockout service (`.../Auth/LoginProtectionServiceTests.cs:14`), column-level encryption (`.../Persistence/EncryptedStringConverterTests.cs:6`), the filtered-unique-index soft-delete convention (`.../Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs:23`), image processing (`.../Services/ImageSharpImageProcessorTests.cs:15`, [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)), the SignalR push + live-channel plumbing, the message-bus implementations, the polyglot Cosmos-config portability suite ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), and the in-repo disaster-recovery database-restore drill (`.../Resilience/DatabaseRestoreDrillTests.cs:18`, a CI-gated RTO baseline, [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) / §29). Three files are pure **§12 performance guards** and are the only place the emitted SQL or the tracker's work is inspected at all: `QueryParameterizationTests` asserts that the dynamic-LINQ filter and sort strategies send their values as SQL *parameters* rather than inlined literals, which is what decides whether SQL Server reuses a plan and whether EF's compiled-query cache hits (`.../Persistence/QueryParameterizationTests.cs:26`); `SaveChangeDetectionTests` pins that a save runs change detection exactly once *and* that suppressing the extra passes lost the tracker no actual changes (`.../Persistence/SaveChangeDetectionTests.cs:24`); and `PeriodicBackgroundServiceTests` drives [`PeriodicBackgroundService`](group-07-persistence-ef-core.md#periodicbackgroundservice) deterministically through a `FakeTimeProvider` clock to cover the enablement gate, the startup delay, interval-driven cycles, and the failing-cycle-never-kills-the-loop contract (`.../Services/PeriodicBackgroundServiceTests.cs:15`). A second cluster hardens the save path itself: `DbContextFactorySaveIntegrityTests` pins the post-loop assertion that turns silent data loss into a failure, since the save loop is bounded and in-process domain-event dispatch runs *inside* it, so a handler can leave tracked changes behind that the loop will never reach (`.../Persistence/DbContextFactorySaveIntegrityTests.cs:27`); `DbContextFactoryCommitAmbiguityTests` covers the case where a commit-phase failure has an unknowable outcome, because the database may have applied the transaction and lost only the acknowledgement (`.../Persistence/DbContextFactoryCommitAmbiguityTests.cs:32`); `DomainEventCaptureExclusionTests` proves event capture is scoped-exclusion aware (`.../Persistence/DomainEventCaptureExclusionTests.cs:26`); and `EFRepositoryAuditStampTests` pins that the repository's own save entry points stamp the acting user like the unit of work does, after they were found calling the plain EF overloads and attributing everything written through them to the system sentinel (`.../Persistence/EFRepositoryAuditStampTests.cs:25`). Two more sit outside persistence: the `IDistributedLock` pair, where [`RedisDistributedLock`](group-14-module-system-composition.md#redisdistributedlock) must acquire through a single atomic `SET NX PX` carrying a TTL and release through a compare-and-delete on the owner token (`.../Concurrency/RedisDistributedLockTests.cs:15`), with [`InProcessDistributedLock`](group-14-module-system-composition.md#inprocessdistributedlock) held to the same contract as the no-Redis fallback (`.../Concurrency/InProcessDistributedLockTests.cs:12`); and [`AzureNotificationHubDeviceRegistrar`](group-07-persistence-ef-core.md#azurenotificationhubdeviceregistrar), whose tests focus on the ownership check, since installation ids are client-supplied and the user-scoped delete must verify the `user:{id}` tag the upsert stamps before it removes anything (`.../Services/AzureNotificationHubDeviceRegistrarTests.cs:16`, [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)). The **enterprise wave** added four fresh clusters, and this is the layer that carries them. *Tenancy* ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)): `ApplicationDbContextTenantFilterTests` proves over real SQLite that the named `Tenant` global filter **composes with** `SoftDelete` rather than replacing it, that a null-tenant system context still sees every row, and that one cached model serves two tenants at once with disjoint results (`.../Persistence/Tenancy/ApplicationDbContextTenantFilterTests.cs:14`); `TenantSaveChangesInterceptorTests` covers the write side, where an insert is stamped from the scope and any modify/delete that would cross the boundary, including a reassignment of the tenant column, throws (`.../Persistence/Tenancy/TenantSaveChangesInterceptorTests.cs:12`); `TenantDataSourceTargetTests` covers the `(source, tenant)` expansion the background sweeps run on, because a tenant with its own database has its own outbox, inbox and trail tables and nothing else opens that database, so a missed pair means events that are never delivered (`.../Persistence/Tenancy/TenantDataSourceTargetTests.cs:18`); `AddMultiTenancyTests` pins the DI surface, the fail-closed defaults, and the startup validation that rejects an override on an unknown source or with no connection string (`.../Persistence/Tenancy/AddMultiTenancyTests.cs:19`); and `TenantContextTests` pins the one-write scope, where re-setting the same value is idempotent but a different value throws (`.../Services/TenantContextTests.cs:10`). *Audit trail* ([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) / §30): `AuditTrailSaveChangesInterceptorTests` asserts every case against a real SQLite round-trip, so what is asserted is what commits: one summary row per insert/delete, one row per changed property on a modify, nothing at all for an entity marked modified but unchanged, the framework's own bookkeeping types excluded, and a `[Pii]` property recording the redaction token and never the clear value (`.../Persistence/AuditTrail/AuditTrailSaveChangesInterceptorTests.cs:18`); [`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader) covers newest-first paging with clamped arguments and an empty answer when the source has no trail table (`.../Persistence/AuditTrail/AuditTrailReaderTests.cs:20`); and `AuditTrailCleanupJobTests` covers the retention purge and its two do-nothing paths (`.../Persistence/AuditTrail/AuditTrailCleanupJobTests.cs:22`). *Scheduler* ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)): [`ScheduledJobRunner`](group-14-module-system-composition.md#scheduledjobrunner) is driven over a `FakeTimeProvider` and an in-memory `ScheduledJobs` table so the schedule arithmetic is exact rather than timing-dependent, covering registration sync, the configuration override, the claim lease (a row under another replica's lease is not claimed, an expired one is reclaimed), outcome recording, and the missed-run policy where a clock that jumped past many occurrences runs **once** and advances rather than storming (`.../Scheduling/ScheduledJobRunnerTests.cs:22`); `CronosNextOccurrenceTests` pins the cron grammar, the strictly-after semantics and the UTC-only clock that keeps a schedule stable across both daylight-saving transitions (`.../Scheduling/CronosNextOccurrenceTests.cs:11`); `AddScheduledJobsTests` pins the opt-in DI shape and the off-by-default settings (`.../Scheduling/AddScheduledJobsTests.cs:16`). *HybridCache* ([ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html)): [`HybridCacheService`](group-09-caching.md#hybridcacheservice) runs against a real in-process `AddHybridCache` with a recording L2, and the key-shape assertions carry the whole design, since the service must write under a keyspace no other cache implementation can address (an entry written by the old cache at the same logical key is a **clean miss**, never the `WRONGTYPE` fault that motivated the split), plus local-copy expiry clamping and an increment path that bypasses L1 on both legs (`.../Caching/HybridCacheServiceTests.cs:22`). Finally `EnumerationValueConverterTests` pins the persistence half of the smart enum: an int column both ways, every declared member resolvable on the read leg, and a null passed through on both legs of the nullable converter (`.../Persistence/Conversions/EnumerationValueConverterTests.cs:13`). Mostly **unit** with EF-InMemory/SQLite boundaries (no real SQL Server here). |
| `MMCA.Common.Infrastructure.Redis.Tests` | 2 | The one tier in the framework that runs the shipped caches against a **real Redis**. The unit tier mocks `IDistributedCache`, which means it asserts the calls the cache makes and never the storage format Redis ends up holding, and that is a blind spot with teeth: Redis keys are typed, `INCR` creates a **string**, and the `IDistributedCache` Redis provider stores every entry as a **hash** of `absexp`/`sldexp`/`data`, so mixing the two at one key round-trips flawlessly against a mock and answers `WRONGTYPE` in production, on the [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) rate-limit and lockout counters. `DistributedCacheServiceRedisTests` starts a `redis:7-alpine` Testcontainer, builds [`DistributedCacheService`](group-09-caching.md#distributedcacheservice) exactly as `AddCaching` does when both a distributed cache and a multiplexer are registered, and proves the increment→read round-trip, that increments carry a TTL so a counter can never lock a subject out forever, that concurrent writers may undercount but must never leave the key unreadable (the honest statement of the current read-modify-write contract), prefix invalidation over a real `SCAN`, and a plain set/get/remove smoke (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Redis.Tests/DistributedCacheServiceRedisTests.cs:27`). `HybridCacheServiceRedisTests` is its [ADR-077](https://ivanball.github.io/docs/adr/077-hybridcache-substrate.html) sibling and exists for the same reason at a higher stake: only a real server can distinguish "the two substrates share a keyspace" from "they do not", so it proves an entry written by either cache is a **soft miss** (never a fault) for the other, that prefix eviction runs both patterns and also drops the evicting process's own local copy, and that increments stay monotonic across two instances sharing one Redis (`.../HybridCacheServiceRedisTests.cs:35`). Needs Docker, so the project is outside the slnx and runs in the `redis-integration` CI job (`MMCA.Common/.github/workflows/ci.yml:611`). **Integration** style. |
| `MMCA.Common.API.Tests` | 94 | The presentation pipeline: `ApiControllerBase.HandleFailure` `ErrorType`→HTTP mapping, the exception-handler chain, the `[Idempotent]` filter + `Idempotency-Key` replay, permission policies/ownership filters, correlation, the JWKS and OIDC-discovery endpoints, the session-cookie auth handler/refresher/jar, the shared notification + device controllers, the public-endpoint output-cache policy, the database-initialization startup (the SQLite-`EnsureCreated`-under-`Migrate` path, [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), and the error-message **localization** edge (localizes the human-readable message while leaving the machine `Code`/ProblemDetails `title` untouched and degrading to English when no localizer is present, [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / §27). `UserAccountAuthControllerBaseTests` covers the shared account-management controller base that landed with the hoisted user use cases above, driving change-password, preferences and delete through mocked handlers plus `ICurrentUserService` (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/UserAccountAuthControllerBaseTests.cs:16`). Its rate-limiting pair is worth reading together ([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), §11): `RateLimitPartitionTests` drives the global limiter's exemption and partition-key logic directly (infrastructure paths and gRPC content types bypass, anonymous traffic gets the no-limiter partition, an authenticated caller partitions by name then `user_id` then remote IP) and then the per-IP anti-spray policy, which deliberately **fails open**, since an unattributable request (the in-process `TestServer` has a null `RemoteIpAddress`) gets no limiter rather than sharing one bucket with every other unattributable caller (`.../Startup/RateLimitPartitionTests.cs:16` and `:80`); `AuthControllerBaseRateLimitTests` then asserts the *attachment* by reflection, because the policy is applied with an attribute and a dropped attribute breaks nothing loudly (the endpoint simply stops being throttled), so it pins `LoginAsync`/`RegisterAsync` carrying the auth-IP policy and pins `RefreshAsync` deliberately **not** carrying it, since refresh is automatic and every Blazor Server circuit shares the UI host's IP (`.../Controllers/AuthControllerBaseRateLimitTests.cs:21`). Three newer files belong to the enterprise wave. `TenantResolutionMiddlewareTests` covers [`TenantResolutionMiddleware`](group-12-api-hosting-mapping.md#tenantresolutionmiddleware) at the edge: the configured claim-then-header strategy order, the trimmed value, the fail-closed `RequireTenant` rejection as ProblemDetails, the excluded paths, and the two shapes that must pass every request straight through (tenancy disabled, and a host that never called `AddMultiTenancy`, `.../Middleware/TenantResolutionMiddlewareTests.cs:17`, [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). The CSV export pair covers [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html): [`CsvWriter`](group-12-api-hosting-mapping.md#csvwriter) is held to RFC 4180 field by field (quote only what needs it, double an embedded quote, CRLF line endings, exactly one BOM, `.../Export/CsvWriterTests.cs:8`), while `EntityControllerBaseExportTests` drives the page-loop that exists because the query pipeline has no `IAsyncEnumerable` path, asserting the fan-in across pages, the short-first-page early stop, camelCase or `fields=`-shaped headers, and the truncation marker appended exactly at the row cap including the two page-boundary edges (`.../Controllers/EntityControllerBaseExportTests.cs:23`). `DataExportControllerBaseTests` pins the shipped DSAR endpoint ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) / §30): the dated download a subject receives, the ProblemDetails failure path, and the two attributes that **are** its whole security posture, asserted directly because nothing else fails when one is dropped (the endpoint simply becomes anonymous, or becomes reachable in a host that never enabled the feature flag, `.../Controllers/Privacy/DataExportControllerBaseTests.cs:30`). **Unit** tests of middleware/filters/controllers in isolation. |
| `MMCA.Common.Grpc.Tests` | 15 | The gRPC transport boundary: `Result`↔`RpcException` round-tripping, the JWT-forwarding client interceptor, and the Polly **resilience** pipeline on typed clients (retry, circuit-breaker, and fault-injection). Its newest file covers [`GrpcResultExceptionInterceptor`](group-13-grpc-contracts.md#grpcresultexceptioninterceptor) and is a good example of a test written *around* a fixed defect: the error-carrying case keeps the shared `ToRpcException` mapping, while the empty-errors case (what the message-only constructors produce) used to discard the exception message entirely and answer a placeholder "Unspecified failure", leaving the caller with a failure and no cause; it now keeps `StatusCode.Internal` and carries the real message, because synthesizing an `Error.Failure` instead would have downgraded a server-side fault to `InvalidArgument` and blamed the caller (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/GrpcResultExceptionInterceptorTests.cs:24`). **Unit** tests asserting [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) / [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) behavior. |
| `MMCA.Common.Aspire.Tests` | 28 | The hosting/observability extensions: `OutboxPollFilterProcessor` (drops recurring outbox-poll spans from telemetry export), the `SecurityHeadersMiddleware`, the head-based trace-sampling cost knob (a ratio in (0,1) opts in, anything else samples everything so a typo cannot silently drop all telemetry, `MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Telemetry/TracesSampleRatioTests.cs:11`, §31), and the metrics-instrumentation toggle (`.../Telemetry/MetricsInstrumentationToggleTests.cs:12`). It guards the one deliberate asymmetry in `AddInfrastructureHealthChecks`: a missing SQL connection string throws at startup when the host requires it, while absent Redis/RabbitMQ skip silently, and the optional checks carry `HealthCheckTags.Optional` so they never gate `/health/ready` (an untagged Redis check would turn a cache blip, which [`DistributedCacheService`](group-09-caching.md#distributedcacheservice) already degrades around, into every replica leaving rotation at once, `.../Health/InfrastructureHealthChecksTests.cs:16` and `:76`, §29). A large half of the suite is §29 warm-up material: [`WarmupReadinessGate`](group-16-aspire-orchestration.md#warmupreadinessgate) must stay closed until warm-up finishes, then latch open idempotently and safely under concurrency (`.../Warmup/WarmupReadinessGateTests.cs:10`); the warm-up hosted service must run every `IWarmupTask` once and open the gate **even when a task fails or hangs** (bounded by a per-task timeout), so a transient dependency outage cannot wedge a replica permanently out of rotation (`.../Warmup/WarmupHostedServiceTests.cs:13`, [ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)); the readiness health check reports Unhealthy while warming so `/health/ready` keeps a cold replica out of rotation (`.../Warmup/WarmupReadinessHealthCheckTests.cs:11`); and [`SelfHttpWarmupTaskBase`](group-16-aspire-orchestration.md#selfhttpwarmuptaskbase) covers what the per-service copies each had to get right alone: port resolution under dynamic ports, the Testing short-circuit, the h2c version pin, and the non-fatal wrapper (`.../Warmup/SelfHttpWarmupTaskBaseTests.cs:28`). Three pin deployment-shaped configuration, and all three share a technique worth borrowing: assert on the *plan* a builder produced, never on a running dependency. `KestrelEndpointExtensionsTests` asserts the listener plan directly rather than through a bound server, because that plan decides whether a deployed revision answers its platform health probes at all (`.../Kestrel/KestrelEndpointExtensionsTests.cs:14`); `DataProtectionExtensionsTests` covers the two-stage gate on `AddCommonDataProtection`, where no `DataProtection:BlobStorageUri` leaves the in-memory default and takes no Azure dependency at startup while a configured URI swaps in the blob key-ring repository so every replica shares a key ring (`.../DataProtection/DataProtectionExtensionsTests.cs:19`); and `KeyVaultConfigurationExtensionsTests` covers the newest of the three, where the gate and the two malformed-configuration cases run against a real `HostApplicationBuilder` while the cases that *do* add a source run against a builder double whose configuration merely collects them, because a real `ConfigurationManager` builds and loads every source the instant it is added and loading a Key Vault source means a live call to the vault (`.../Configuration/KeyVaultConfigurationExtensionsTests.cs:27`). **Unit** suite over the Aspire service-defaults package. |
| `MMCA.Common.Testing.Tests` | 16 | The suite that tests the **test framework itself**, so a regression in the shared scaffolding fails here rather than silently weakening every consumer suite. `HandlerTestBaseTests` drives [`HandlerTestBase<THandler>`](#handlertestbasethandler) exactly as a consumer handler test would, registering repositories and relying on the pre-wired unit of work (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/HandlerTestBaseTests.cs:12`), and `DecoratorPipelineOrderTests` runs [`DecoratorPipelineOrderTestsBase<...>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult) against MMCA.Common's own `AddApplication → ScanModuleApplicationServices → AddApplicationDecorators` sequence to prove the resolved pipelines nest in the [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) order (`.../DecoratorPipelineOrderTests.cs:20`). Four files cover the helpers the cross-service tiers lean on, and each one exists because the behavior would otherwise only be observable in a Docker-bound nightly: [`CrossServiceFixtureBase`](#crossservicefixturebase)'s container-free logic (connection-string composition and the first-write-wins environment snapshot, `.../CrossServiceFixtureBaseTests.cs:13`); [`JwtTokenGenerator`](#jwttokengenerator)`.ConfigureInProcessTokenValidation`, where what matters is that JWKS/OIDC discovery is switched **off** and the static committed key takes over, because a test host that still tries to discover fails at the first authenticated request with a network error rather than an auth error (`.../JwtTokenGeneratorTests.cs:18`); [`TestPolling`](#testpolling)`.PollUntilAsync`, which must stop at the first satisfying probe and on timeout return the *last probed value* so the caller's own assertion produces the failure message instead of a bare timeout (`.../TestPollingTests.cs:11`); and [`DependencyInjectionAssert`](#dependencyinjectionassert)`.ReturnsSameCollection`, which has to fail for a registration that hands back a different collection, the failure mode that silently drops everything chained after it (`.../DependencyInjectionAssertTests.cs:12`). **Unit** style. |
| `MMCA.Common.UI.Tests` | 87 | Shared Blazor components (delete-confirmation, empty-state, the mobile card/infinite-scroll lists, notification bell/inbox/list/send pages, primitives), the MudBlazor theme/provider harness, HTTP-resilience/service-exception helpers, list-page state/query-state services, the primitive markup snapshots, the auth-form view-model validation (§24), and the i18n globalization pair (the `[!!...!!]` bracket-sentinel pseudo-localizer and the `ResxMudLocalizer` MudBlazor-chrome boundary) plus the auth-aware nav menu and its mobile top-row. On i18n ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / §27): `CultureSwitcherTests` guards that the switcher delegates to `ICultureApplier` instead of navigating to `/culture/set` itself, since that URL is a *server* endpoint and a hard-coded navigation left MAUI Blazor Hybrid heads (which host no ASP.NET pipeline) routing it through the Blazor router onto the not-found page (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Components/CultureSwitcherTests.cs:17`); [`EndpointCultureApplier`](group-15-common-ui-framework.md#endpointcultureapplier) covers the web default, which must route through `/culture/set` with a force load because only that round trip writes the cookie SSR prerender and the WASM runtime both read (`.../Globalization/EndpointCultureApplierTests.cs:15`); and `DocumentLanguageTests` covers the component that makes a hybrid head's `lang` attribute follow a culture switch, asserted here precisely because no automated accessibility gate can catch a *wrong* `lang` (axe checks presence and syntax only, `.../Components/DocumentLanguageTests.cs:13`). On theming ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)): `ThemeToggleTests` covers the app-bar Day/Dark switch, including that disposal unsubscribes so the long-lived `ThemeService` never calls back into a dead component (`.../Components/ThemeToggleTests.cs:16`); `NotificationListenerTests` locks down the same class of race for the invisible component that turns hub notifications into badge state and a snackbar (`.../Components/NotificationListenerTests.cs:23`); and `ApiUserPreferenceWriterTests` pins the two guards that keep a signed-out or stale session from spending one 401 per theme/culture toggle, a write that is best effort and whose caller never learns it failed, making a doomed request pure cost (`.../Services/ApiUserPreferenceWriterTests.cs:16`). On write safety, `EntityServiceBaseIdempotencyRetryTests` pins the `Idempotency-Key` [`EntityServiceBase<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#entityservicebasetentitydto-tidentifiertype) emits on creates and only on creates, the key staying identical across every retry of one logical operation, and the retry predicate's shape (5xx yes, 501 no, 429 yes) plus cancellation aborting the pipeline; the retried cases pay the real Polly backoff, so each is driven through the smallest attempt count that proves the behavior and asserts on captured attempts, never on wall-clock timing (`.../Services/EntityServiceBaseIdempotencyRetryTests.cs:20`). `ApiClientRegistrationTests` closes that loop by pinning that the named `"APIClient"` takes its total timeout from the shared budget rather than `HttpClient`'s uncoordinated 100s default (`.../Services/ApiClientRegistrationTests.cs:16`). Its newest three sit on the capability/JS boundary: [`LazyJsModule`](group-15-common-ui-framework.md#lazyjsmodule) pins the single-flight `import()` the UI services delegate to, because an unguarded `_module ??= await import(...)` lets two concurrent callers each start an import so the browser holds two module instances and the later assignment leaks the earlier reference, which is then never disposed, while a *failed* import must not be cached and disposal must tolerate a disconnected circuit (`.../Services/LazyJsModuleTests.cs:14`); `CapabilityFallbackTests` sweeps every null/neutral capability default ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)), each of which must degrade (report unsupported, no-op, or return empty) and **never throw**, because these are what shared components resolve on a head with no native or browser override (`.../Services/Capabilities/CapabilityFallbackTests.cs:12`); and `QrCodeImageTests` covers the managed QR render (a PNG data URI with required alt text, nothing at all for a blank payload, a re-encode when the payload or the error-correction level changes, `.../Components/QrCodeImageTests.cs:11`, [ADR-071](https://ivanball.github.io/docs/adr/071-barcode-scanning-and-qr-display.html)). Rendered with **bUnit** (component-render unit tests via [`BunitComponentTestBase`](#bunitcomponenttestbase)). |
| `MMCA.Common.UI.Web.Tests` | 4 | The Blazor Server web-host pieces: `ServerTokenStorageService` (during SSR prerender tokens come from the HttpOnly session cookies; on the interactive circuit the access token is held in memory, hydrated single-flight, and refreshed proactively near expiry, while the refresh token is never readable), the server form-factor probe, and `BlazorCspPolicyProvider`, which pins the enforced production Content-Security-Policy verbatim (connect-src locked to the configured API/Gateway origin, no `unsafe-eval`, permissive Report-Only degradation on an unparseable endpoint, §26). **Unit** tests. |
| `MMCA.Common.UI.E2E.Tests` | 13 | **Playwright** axe-core (WCAG 2.1 AA) + render-smoke over the backend-less **Gallery** host (real Login/Register pages, the primitives/components showcase, and the shared Notification pages against stubbed collaborators), plus the dark-mode toggle, a Web-Vitals budget probe, and two i18n/mobile-parity gates: a `qps-Ploc` pseudo-locale round-trip asserting the `[!!` sentinel and no horizontal overflow under ~40% text expansion ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) / §27), and the culture+theme controls pinned into the mobile top-row below 1024px ([ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html) / §22). `StickySidebarE2ETests` illustrates why a *rendered-behavior* assertion beats a CSS assertion: it keeps the desktop sidebar pinned while the page scrolls, a behavior that broke because `position: sticky` resolves against the nearest ancestor scroll container and two innocuous rules (`html, body { overflow-y: auto }` and `.page { overflow-x: hidden }`, where a non-visible `overflow-x` forces the computed `overflow-y` from visible to auto) turned content-sized ancestors that never scroll into dead scrollports; the test asserts the pinning, so it catches any future ancestor that reintroduces one (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/StickySidebarE2ETests.cs:23`). Deliberately outside `MMCA.Common.slnx`; runs in CI's `ui-e2e` job across chromium, firefox, and webkit. **E2E/accessibility** style. `[Rubric §21, Accessibility]` (assesses automated a11y gating): this is where the framework proves zero axe violations before downstream apps consume the pages. |
| `MMCA.Common.Benchmarks` | 6 | A BenchmarkDotNet **performance-smoke** executable covering the two DB-free hot paths. `SpecificationBenchmarks` measures the per-instance compiled-expression cache behind [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)`.IsSatisfiedBy` (a cached-compile baseline vs. the recompile-each-call anti-pattern) and the `And`/`Or` composition cost (`MMCA.Common/Tests/Performance/MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:14`); `QueryPipelineBenchmarks` adds the read side, which runs on every list request in every consumer and regresses silently because the dynamic-LINQ predicate is re-parsed per call and the shaper reflects over the DTO: a single `CONTAINS` filter, a three-strategy mixed filter, dynamic sorting, and full-field vs. sparse-`fields=` shaping of a 100-row page (`.../QueryPipelineBenchmarks.cs:17`). Deliberately **outside `MMCA.Common.slnx`** (like the Gallery), but not on-demand-only: CI's `performance-smoke` job (`MMCA.Common/.github/workflows/ci.yml:332`) runs the suite and then `build/perfgate` compares the results against the committed `Tests/Performance/perf-baseline.json`, failing on any violation of its allocation ceilings or machine-independent ratio floors, and on a rule naming a benchmark that produced no measurement, so the gate cannot pass vacuously (`.../ci.yml:371`). Moving a number deliberately means updating the baseline in the same PR. `[Rubric §12, Performance & Scalability]` (assesses measured, not assumed, hot-path cost): this is the evidence harness, and the baseline file turns it from a runs-clean smoke into a regression gate. **Performance-smoke** style. |

### MMCA.ADC, Conference module (the largest application module)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Conference.Shared.Tests` | 17 | Conference DTOs, requests, enums, and DTO/request mappers (the manual-mapping/Mapperly boundary, [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)). The DTO tests are deliberately shallow and cheap, pinning the required-value constructor, record equality, and the empty-collection defaults that keep a consumer from null-checking every navigation (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Shared.Tests/Events/EventDTOTests.cs:6`). Pure **unit** tests. |
| `MMCA.ADC.Conference.Domain.Tests` | 25 | The Conference aggregates (Event, Session, Speaker, Room, Category, Question/Answer, and now [`Sponsor`](group-17-conference-domain.md#sponsor)): factory-method `Result<T>` outcomes, invariants, state transitions, and emitted domain events. `SponsorTests` is the model for the newer files: a database-generated id stays default after `Create`, exactly one `SponsorChanged` added-state event is raised, each length/blank invariant fails on its own, a booth number without the exhibitor flag is accepted and kept rather than silently dropped, and the tier values are pinned **in package display order** because the public roster groups by tier and reordering the enum would silently reorder the page (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Domain.Tests/Sponsors/SponsorTests.cs:11`). `EventCascadeDeletionDomainServiceTests` grew with the same wave and is the one to read for ordering: the cascade must soft-delete sessions, rooms and sponsors before the event, must stop at the first child failure, and must leave the event undeleted when it does, so a partially cascaded delete is never committed (`.../Services/EventCascadeDeletionDomainServiceTests.cs:9`). **Unit** tests. |
| `MMCA.ADC.Conference.Application.Tests` | 148 | The command/query handlers for the Conference controllers, validators, navigation populators, the **Sessionize import** orchestrator + sync strategies (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Application.Tests/Events/UseCases/RefreshFromSessionizeHandlerTests.cs:15`), and the event/session live-window validation served to the live layer over gRPC (`.../Events/EventLiveValidationServiceTests.cs:16`, [`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterhandler) and its cross-source filter query, [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). It carries the AI-scoring background queue (`.../Sessions/DecisionSupport/SessionScoringQueueTests.cs:11`, [`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue)) and the sessions-by-speaker filter handler, whose specification resolves the `SessionSpeaker` join down to an engine-portable ID-list criteria so the speaker pages and speaker dashboard filter server-side instead of pulling the whole catalog (`.../Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandlerTests.cs:16`, [`GetSessionsBySpeakerFilterHandler`](group-18-conference-application.md#getsessionsbyspeakerfilterhandler), §12). A family of **public filter handlers** (session, session-speaker, session-category-item, event-speaker, speaker, speaker-category-item, and now sponsor) all defend the same anonymous-endpoint leak: a junction filter must select only rows whose parent is publicly visible, so a hidden session never leaks its existence through the speakers assigned to it (`.../Sessions/UseCases/GetPublicSessionSpeakerFilter/GetPublicSessionSpeakerFilterHandlerTests.cs:17`, BR-49, §11). [`ExportEventCalendarHandler`](group-18-conference-application.md#exporteventcalendarhandler) covers the whole-schedule `.ics` endpoint, which is anonymous, so unpublished and unknown events must collapse to the same NotFound (no existence oracle) and a legacy row carrying an unresolvable time zone must degrade rather than fault the request (`.../Sessions/UseCases/ExportCalendar/ExportEventCalendarHandlerTests.cs:17`). The sponsor use cases are the newest block and are deliberately plain: create/update handlers assert the mapper-failure path, the repository add, and the save, and nothing more, because the interesting behavior lives in the aggregate and in the public filter (`.../Sponsors/UseCases/CreateSponsorHandlerTests.cs:14`). The biggest application suite in ADC; fast **unit** tests with mocked repositories/services. |
| `MMCA.ADC.Conference.Infrastructure.Tests` | 13 | Conference-specific EF configurations, the module DB seeder, the Sessionize HTTP client, and the Anthropic-backed session-scoring service (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Infrastructure.Tests/Services/AnthropicScoringServiceTests.cs:12`). [`SessionScoringProcessor`](group-19-conference-infrastructure.md#sessionscoringprocessor) covers the cross-replica scoring lock and the bounded retry around it: the queue's own dedup is process-local while Conference runs two replicas, so what matters is that exactly one replica invokes the (paid) scoring handler for an event, that the lock handle is always disposed, and that a failed run is retried a bounded number of times rather than dropped or repeated forever (`.../Services/SessionScoringProcessorTests.cs:23`, §31). **Unit** suite over faked HTTP handlers and mocked locks. |
| `MMCA.ADC.Conference.API.Tests` | 18 | Conference REST controllers (events, sessions, speakers, rooms, categories, questions/answers, session selection, sponsors), the module's permission grants, and the Conference error-resource localization completeness check (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Localization/ConferenceErrorResourcesTests.cs:15`, §27). The controller tests follow one shape, visible in `SponsorsControllerTests`: success and each failure `ErrorType` map to their status code, and a **successful** mutation evicts the entity and conference cache tags while a failed one evicts nothing (`.../Controllers/SponsorsControllerTests.cs:26`). `EntityExportAuthorizationTests` is the cross-controller guard that came with [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html) and is the one to read: an action **inherited** from [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) carries no knowledge of the derived controller's read scoping, and every Conference read filter is applied in a method body (`specification: GetUserScopingSpecification()` or `BuildPublicSpecificationAsync(...)`) rather than as an attribute, so the test pins that every scoped controller declares its own `ExportAsync` and that export on the bare-`[Authorize]` controllers carries its capability (`.../Controllers/EntityExportAuthorizationTests.cs:18`, §11). **Unit** tests of the API layer. |
| `MMCA.ADC.Conference.UI.Tests` | 37 | Conference Blazor pages and components: the public event/session/speaker/sponsor detail + filtered list pages, the management CRUD forms and management-route authorization, the organizer feedback dashboards, the speaker dashboard, the session-selection dashboard with its AI-score and speaker-overlap views (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/SessionSelectionAiScoresTests.cs:15`), and the share/QR/add-to-calendar buttons (`.../Components/QrCodeButtonTests.cs:14`). One cluster is all **stale-state** guards, the failure class bUnit is uniquely good at catching: `SessionDetailRoomCacheTests` pins that navigating to a session in a *different* event refetches the per-event room lookup, since otherwise the page renders the previous event's room names and offers its rooms in the edit picker, while navigating within the same event must reuse the cache (`.../Pages/Session/SessionDetailRoomCacheTests.cs:19`); `SessionSelectionStaleResponseTests` covers M48, where the organizer dashboard fires a load per event selection and keeps a fire-and-forget score-polling loop running, and both used to write whatever came back into shared state without checking whether the selection had moved on, so a slow response for the previous event could overwrite the board or paint an error banner over it (a generation counter now supersedes in-flight work on every selection, `.../Pages/SessionSelection/SessionSelectionStaleResponseTests.cs:21`). The sponsor and speaker-QR pages are the newest: `PublicSponsorListTests` pins the roster scoping to the current-or-next event, grouping by tier in package order with a sort-then-name order inside a tier, the booth badge for exhibitors, and the sponsorship-packet call to action that must appear when the roster is empty **and** disappear entirely when no packet URL is configured (`.../Pages/Public/PublicSponsorListTests.cs:16`); `SpeakerQrTests` pins that with the `speaker_id` claim the code encodes the **absolute** public profile URL (an app-relative route is useless to another device's camera) and that without the claim the page says so rather than rendering a code that points nowhere (`.../Pages/Speaker/SpeakerQrTests.cs:17`, [ADR-071](https://ivanball.github.io/docs/adr/071-barcode-scanning-and-qr-display.html)). Rendered with **bUnit** (`BunitTestBase` over the shared [`BunitComponentTestBase`](#bunitcomponenttestbase)). **Component** tests. |
| `MMCA.ADC.Conference.IntegrationTests` | 36 | Boots the **Conference service host** via `WebApplicationFactory<Program>` (gRPC peers faked, JWT re-pointed at an in-process test key) and drives real HTTP per role (Anonymous/Attendee/Speaker/Organizer), plus OpenAPI contract-snapshot, API-versioning, optimistic-concurrency, soft-delete + audit-stamp fidelity, idempotency replay, output-cache eviction, the `includeChildren` regression, and the in-process `CrossServiceUserRegisteredTests` (the Identity→Conference `UserRegistered` auto-link handler). **Integration** style; needs a real SQL Server (`ADC_TEST_SQL_BASE`), runs in the `integration-tests` CI job. |

### MMCA.ADC, Engagement module (bookmarks, feedback, the conference-day live layer, and the badge/points wave)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Engagement.Shared.Tests` | 7 | Bookmark/feedback/live DTOs, requests, and mappers, plus the contract types the [ADR-072](https://ivanball.github.io/docs/adr/072-qr-badge-check-in-and-points.html) wave added. `BadgePayloadTests` pins the QR payload both ways: the `mmca-adc:badge:{credential}` format, a case-insensitive parse that also accepts a bare or dash-less GUID and tolerates surrounding whitespace (a camera hands over whatever it read), and a clean `false` plus an empty credential for untrusted garbage (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.Shared.Tests/CheckIns/BadgePayloadTests.cs:6`). `PointsSubjectKeysTests` pins the ledger's subject keys, whose whole job is to not collide: event, session and sponsor keys built from the *same* numeric id must stay distinct, and each must be invariant-culture stable, because the key is a persisted uniqueness constraint and a culture-dependent number format would silently create a second awardable subject (`.../Points/PointsSubjectKeysTests.cs:7`). The settings and scope-name types round out the row. **Unit**. |
| `MMCA.ADC.Engagement.Domain.Tests` | 11 | The `UserSessionBookmark`, event/session feedback, and conference-day live-layer aggregates (`LivePoll` + `SessionQuestion`), joined by the badge/points aggregates: factory `Result<T>` outcomes, invariants, and domain events. [`CheckIn`](group-22-engagement-module.md#checkin) is the richest, because one aggregate carries three scopes and the scope decides which optional id is required and which is forbidden: a session scope needs a session id, an event scope must not carry one, a sponsor scope needs a sponsor id and no session, and exactly one `AttendeeCheckedIn` event is raised carrying (or deliberately not carrying) the sponsor payload (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.Domain.Tests/CheckIns/CheckInTests.cs:8`). [`AttendeeBadge`](group-22-engagement-module.md#attendeebadge) pins the opaque credential: `Create` generates one, two calls for the same user never produce the same credential, `Regenerate` replaces it while preserving the owner, and **no** domain event is raised either way, since issuing a badge is not an engagement act (`.../Badges/AttendeeBadgeTests.cs:6`). [`LeaderboardOptIn`](group-22-engagement-module.md#leaderboardoptin) pins the display-name **snapshot** taken at opt-in, the soft-delete leave, and the reactivate path that refreshes the name and raises the added state again, while a failed invariant leaves the entity untouched and raises nothing (`.../Points/LeaderboardOptInTests.cs:8`); `PointsEntryInvariantsTests` covers the ledger row's guards field by field (`.../Points/PointsEntryInvariantsTests.cs:7`). **Unit**. |
| `MMCA.ADC.Engagement.Application.Tests` | 56 | Bookmark, feedback, and live-layer (poll / session-question) add/remove/query handlers and validators, including the cross-module `ISessionBookmarkValidationService` / `IBookmarkCountService` / `IEventLiveValidationService` gRPC collaborators (stubbed), the poll-results builder (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.Application.Tests/LivePolls/Services/LivePollResultsBuilderTests.cs:17`), and the best-effort `ILiveChannelPublisher` ingress together with the queue that decouples it from the request path (`.../Live/LiveChannelPublishQueueTests.cs:10`, [`LiveChannelPublishQueue`](group-22-engagement-module.md#livechannelpublishqueue)). The [ADR-072](https://ivanball.github.io/docs/adr/072-qr-badge-check-in-and-points.html) wave roughly doubled it, and three files carry the load-bearing rules. [`PointsAwarder`](group-22-engagement-module.md#pointsawarder) is where anti-farming and redelivery idempotency turn out to be the *same* rule: an award already present writes nothing, a rule configured to 0 (or an undefined activity) succeeds and writes nothing, an entry keeps the value it was awarded when the configuration later changes, and a save that loses the unique-index race reports **success**, including when the duplicate wording is buried in an inner exception, while any other save failure propagates (`.../Points/Services/PointsAwarderTests.cs:13`). [`CheckInAttendeeHandler`](group-22-engagement-module.md#checkinattendeehandler) pins the scan path: a repeat scan reports the original check-in and writes nothing, a session-scoped scan is filed under the session's **own** owning event (not the client's event context), an unknown and a malformed credential return the same `BadgeNotFound` (no probing oracle), and an unpublished event or a missing caller is refused (`.../CheckIns/UseCases/CheckInAttendeeHandlerTests.cs:16`). [`GetLeaderboardHandler`](group-22-engagement-module.md#getleaderboardhandler) pins the board as opt-in only (points without an opt-in never appear, and leaving removes you), ordering by total with an ordinal name tie-break, truncation to the configured size where 0 or a negative publishes nothing rather than throwing, and the **snapshotted** name being what is published (`.../Points/UseCases/GetLeaderboardHandlerTests.cs:12`). `UserDeletedPointsHandlerTests` closes the privacy loop: on `UserDeleted` the entry comes off the board and the published name is erased even for an already-left opt-in, the read deliberately looks past the soft-delete filter and tracks, and a redelivery reaches the same state while writing once (`.../Points/IntegrationEventHandlers/UserDeletedPointsHandlerTests.cs:14`, §30). **Unit**. |
| `MMCA.ADC.Engagement.Infrastructure.Tests` | 4 | Engagement EF configuration plus the live-channel publish processor that fans domain changes out to the SignalR hub (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure.Tests/Live/LiveChannelPublishProcessorTests.cs:10`). **Unit**. |
| `MMCA.ADC.Engagement.API.Tests` | 8 | The Bookmarks/Feedback/Live/CheckIns/Points REST controllers in isolation. `CheckInsControllerTests` shows the two rules that matter at this edge: `GetMyBadgeAsync` takes **no** parameter other than the cancellation token, so the identity can only come from the token and never from the request body (asserted by reflection, because adding a parameter would break nothing loudly), and a repeat scan is `Ok`, not `Conflict`, because the organizer scanning a badge twice is a normal event and an error status would train them to ignore it (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.API.Tests/Controllers/CheckInsControllerTests.cs:19`). **Unit**. |
| `MMCA.ADC.Engagement.UI.Tests` | 34 | Engagement Blazor renders and their UI services: the bookmark UI, the session/event feedback pages, the conference-day live/presenter surfaces (Happening Now, live poll, session Q&A, the moderation panel), the live-channel join/reconnect path (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.UI.Tests/Pages/LiveChannelJoinTests.cs:37`), and the session-reminder planner/coordinator (`.../Services/SessionReminderPlannerTests.cs:11`). Three cover failure classes worth reading: `LiveEventListenerResilienceTests` covers H18, where an invisible layout component rendered on every authenticated page sits under a shell with no `ErrorBoundary` above it, so anything escaping its render lifecycle tears down the Blazor circuit (a full page reload) on whatever page the user happens to be on, and the shared resilience handler raises `TimeoutRejectedException`/`BrokenCircuitException` that the service layer's narrow `HttpRequestException` catch deliberately does not cover (`.../Components/LiveEventListenerResilienceTests.cs:31`, §29); `SessionFeedbackPartialSubmitTests` pins per-answer failure isolation in the submit loop, since answers are upserted one POST at a time and a mid-loop failure has already saved some durably, so the loop must report how many landed, keep the form dirty for a retry, and neither navigate away nor claim success (`.../Pages/Feedback/SessionFeedbackPartialSubmitTests.cs:22`, §24); and [`NowNextService`](group-22-engagement-module.md#nownextservice) covers the anonymous now-next endpoint contract plus its not-found degradation (`.../Services/NowNextServiceTests.cs:13`). The badge/points surfaces are the newest. `CheckInScanTests` is the load-bearing one: on a head whose `IBarcodeScannerService.IsSupported` is false (web and Windows) the scan affordance must not render **at all** while the manual name/email search stays, because that search is the whole check-in surface there, and the scope toggle must default to Session (`.../Pages/CheckIn/CheckInScanTests.cs:23`, [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) / [ADR-072](https://ivanball.github.io/docs/adr/072-qr-badge-check-in-and-points.html)). `MyBadgeTests` and `MyPointsTests` pin the four-state render (loading, data, empty, error) for the attendee's own badge and ledger, including the leaderboard rank block and the participation switch reflecting the opt-in state on load (`.../Pages/CheckIn/MyBadgeTests.cs:18`, `.../Pages/Points/MyPointsTests.cs:18`), and `SponsorVisitTests` pins that a **repeat** visit reports the earlier one rather than an error, with distinct states for an unpublished event, an unrecognized server answer, and a failed post (`.../Pages/Sponsors/SponsorVisitTests.cs:19`). [`CurrentEventNotificationScopeProvider`](group-22-engagement-module.md#currenteventnotificationscopeprovider) covers the `event:{EventId}` key shape, the never-throw degradation to unscoped, and the five-minute cache that keeps the notification bell's 30-second poll from costing an events fetch every time (`.../Services/CurrentEventNotificationScopeProviderTests.cs:13`, §31). **Component** (bUnit). |
| `MMCA.ADC.Engagement.IntegrationTests` | 22 | Boots the **Engagement service host** via `WebApplicationFactory<Program>` and exercises the bookmark/feedback/live workflows + authorization over real HTTP, now with the badge/points tier alongside. `CheckInScanRoundTripTests` proves over a real database what the handler tests prove in memory: a second scan reports the repeat and leaves **one** row and **one** enqueued `AttendeeCheckedIn`, a stale event context is corrected to the session's own event, and `MyBadge` returns the same credential on every call (`MMCA.ADC/Tests/Integration/MMCA.ADC.Engagement.IntegrationTests/CheckIns/CheckInScanRoundTripTests.cs:23`). `PointsAwardRoundTripTests` is the one to read for the outbox idiom: the check-in and its event commit in one transaction, so each test then **drains the outbox the way `OutboxProcessor` does**, reading the persisted payload back out of `dbo.OutboxMessages`, deserializing it, and handing it to the registered handler, which keeps the assertions deterministic instead of racing a background service, and it pins that a redelivery still leaves exactly one entry and that the unique index rejects a second award for the same subject (`.../Points/PointsAwardRoundTripTests.cs:32`). `CheckInAuthorizationTests` states the authorization contract plainly: every attendee may fetch their own badge (identity from the token, never the request), while writing a check-in and reading the attendance rollup require `engagement:checkin:manage`, held only by Organizer and Admin, and anonymous callers get 401 everywhere (`.../CheckIns/CheckInAuthorizationTests.cs:14`, §11). **Integration**; real SQL Server, `integration-tests` CI job. |

### MMCA.ADC, Identity module (User aggregate + JWT/JWKS + external OAuth)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Identity.Shared.Tests` | 3 | Identity DTOs/requests and mappers (`User`, roles, `LinkedSpeakerId`). **Unit**. |
| `MMCA.ADC.Identity.Domain.Tests` | 4 | The `User`/`UserRole` aggregate factories, invariants, anonymization, and speaker-linking domain events. **Unit**. |
| `MMCA.ADC.Identity.Application.Tests` | 26 | Registration/login/profile/role/preferences handlers and validators, the external-OAuth (Google/GitHub) exchange, the `SpeakerLinkedToUser`/`SpeakerUnlinkedFromUser` integration-event handlers, and the attendee query service the Notification module reads recipients through. Its newest block is the data-subject export ([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) / §30, ADC still runs its own handler rather than the framework's endpoint): `ExportUserDataHandlerTests` pins the owner-or-organizer gate with a case-insensitive role claim, the aggregation of the Engagement and Notification sections when the peers answer, the per-section **unavailable** degradation when a peer is unreachable or throws so the rest of the package still travels, and UTC-kind timestamps out of `DateTimeKind.Unspecified` audit columns (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Application.Tests/Users/UseCases/ExportUserDataHandlerTests.cs:16`); `EngagementUserDataExportSectionTests` pins what the Engagement section actually carries, including bookmarks, submitted questions, points entries with the readable activity name, leaderboard participation, and check-ins that earned no points (a check-in is personal data whether or not it scored, `.../Users/UseCases/EngagementUserDataExportSectionTests.cs:11`); and `ExportUserDataRegistrationTests` pins that the handler is discovered through its **base class** interface by the module scan and that section registration order is preserved (`.../Users/UseCases/ExportUserDataRegistrationTests.cs:16`). **Unit**. |
| `MMCA.ADC.Identity.Infrastructure.Tests` | 4 | Identity EF config/repository, RS256 token issuance, and the JWKS provider. **Unit**. |
| `MMCA.ADC.Identity.API.Tests` | 7 | The Auth REST controller, the Users controller, the JWKS endpoint, and identity middleware in isolation. **Unit**. |
| `MMCA.ADC.Identity.UI.Tests` | 6 | Identity Blazor pages (login/register/profile/user-management) rendered with **bUnit**. **Component**. |
| `MMCA.ADC.Identity.IntegrationTests` | 33 | Boots the **Identity service host** via `WebApplicationFactory<Program>` and drives the full auth surface over real HTTP: registration, login and its anonymous edge cases, claims, profile, user preferences, soft-deleted-user handling, the external-OAuth challenge/exchange, GDPR user export against faked Engagement and Notification peers (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Attendee/UserExportTests.cs:18`), and JWKS discovery. It also carries the two contract guards (OpenAPI snapshot and the RFC 9457 Problem Details subclass over [`ProblemDetailsContractTestsBase<TFixture>`](#problemdetailscontracttestsbasetfixture), `.../Contract/ProblemDetailsContractTests.cs:16`, §9), the compliance pair that proves erasure works end to end and that PII never reaches the log pipeline (`.../Compliance/ErasureAndPiiLoggingTests.cs:19`, [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) / §30), an outbox-fidelity guard asserting registration atomically enqueues `UserRegistered` into `[dbo].[OutboxMessages]` (`.../Data/OutboxFidelityTests.cs:17`), and the in-process `CrossServiceSpeakerLinkTests`. **Integration**; real SQL Server, `integration-tests` CI job. |

### MMCA.ADC, Notification module (push + inbox on top of the framework's notification types)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Notification.API.Tests` | 1 | `NotificationModuleTests` pins the module contract itself, and it is a five-member subclass of the shared [`ModuleConformanceTestsBase<TModule>`](#moduleconformancetestsbasetmodule): it declares only `ExpectedName` ("Notification"), `ExpectedDependencies` (`["Identity"]`), `ExpectedRequiresDependencies` (true), and an `AssertDisabledStubs` override that proves `RegisterDisabledStubs` keeps the cross-module `IUserNotificationExportService` resolvable as a **singleton** `DisabledUserNotificationExportService` when the module is switched off (`MMCA.ADC/Tests/Modules/Notification/MMCA.ADC.Notification.API.Tests/NotificationModuleTests.cs:8`). The conformance assertions themselves live in the base. **Unit**. |
| `MMCA.ADC.Notification.Application.Tests` | 5 | The module's two application services plus its DI registration: `AttendeeNotificationRecipientProvider` resolving broadcast recipients through the Identity `IAttendeeQueryService` gRPC contract (`MMCA.ADC/Tests/Modules/Notification/MMCA.ADC.Notification.Application.Tests/AttendeeNotificationRecipientProviderTests.cs:7`), `UserNotificationExportService` assembling a data-subject export from the user-notification and push-notification repositories over `InMemoryQueryableExecutor` on top of [`HandlerTestBase<THandler>`](#handlertestbasethandler) (`.../UserNotificationExportServiceTests.cs:11`, §30), and `AddModuleNotificationApplication` proving both are registered against their interfaces (`.../DependencyInjectionTests.cs:10`). **Unit**. |
| `MMCA.ADC.Notification.IntegrationTests` | 9 | Boots the **Notification service host** via `WebApplicationFactory<Program>` (the Identity recipient-lookup gRPC client faked by `FakeAttendeeQueryService`) and exercises the push-notification REST endpoints + inbox (`NotificationsController`/`InboxController` from `MMCA.Common.API`, `MMCA.ADC/Tests/Integration/MMCA.ADC.Notification.IntegrationTests/Notifications/NotificationControllerTests.cs:16`), the two contract guards (an OpenAPI snapshot at `.../Contract/OpenApiContractTests.cs:16` and the Problem Details subclass this service gained most recently, `.../Contract/ProblemDetailsContractTests.cs:15`, §9), and the real-time SignalR [`NotificationHub`](group-10-notifications.md#notificationhub): a live `HubConnection` asserts authenticated connect, anonymous rejection (the hub carries `[Authorize]`), and a POST-triggered broadcast reaching the connected recipient (`.../Notifications/NotificationHubTests.cs:15`). **Integration**; real SQL Server (`ADC_TEST_SQL_BASE`), `integration-tests` CI job. |

### MMCA.ADC, host, service-adapter, cross-service, and end-to-end suites

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Gateway.Tests` | 5 | Boots the real **YARP Gateway** host in-process and asserts three operational guarantees, two of them with no test body in this repo at all: since the v1.131.0 uplift the host fixture and the test bodies come from `MMCA.Common.Testing`, so ADC supplies only the entry point. `SecurityHeadersTests` is a four-line subclass of [`SecurityHeadersTestsBase`](#securityheaderstestsbase) that hands it a client from the shared [`ProductionHostApplicationFactory<Program>`](#productionhostapplicationfactorytentrypoint) class fixture (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:11`); the base probes `/alive`, which always answers regardless of backend reachability, and pins `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`, and (because the factory pins the `Production` environment, `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ProductionHostApplicationFactory.cs:36`) HSTS (§26). `GracefulShutdownTests` is a body-less subclass of [`GracefulShutdownTestsBase<TEntryPoint>`](#gracefulshutdowntestsbasetentrypoint) closed over the Gateway's `Program` (`.../GracefulShutdownTests.cs:9`): the base boots the host, stops it under a bounded token, and asserts `ApplicationStopping` then `ApplicationStopped` fired, so a hosted service that refuses to drain fails here instead of silently wedging a rolling deploy (§29). The third is ADC-specific and stays local: `RouteMapTests` asserts the YARP route table by swapping the real `IHttpForwarder` for [`RecordingHttpForwarder`](#recordinghttpforwarder), a fake that never proxies and echoes the destination prefix into a response header, so **23** mapped patterns plus a 404-on-unmapped case are asserted in-process with no backends (`.../RouteMapTests.cs:26`, the route table at `:57`, the local `RouteMapApplicationFactory` at `:268`, the fake at `:292`). The same fake also echoes the `ForwarderRequestConfig` it was handed, so the class pins the **forwarder budget** as well: every REST route must carry the 100-second activity timeout (MMCA.Common's shared 90-second request budget plus a deliberate 10-second margin, so the forwarder outlives the backend's own budget and the client sees the backend's error rather than a gateway abort, `.../RouteMapTests.cs:49`), the SignalR hub route must carry its own 1-hour timeout because a long-lived connection would otherwise be torn down every 100 seconds (`:55`), and the HTTP/2 routes must keep their h2c-prior-knowledge version settings. **Caveat, verified in source:** the Gateway maps 26 forwarders today and the assertion table names 23 of them: `/Sponsors` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:144`), `/CheckIns` (`:148`) and `/Points` (`:150`), all three added with the sponsor and badge/points waves, are not yet in `RouteMap`, so a regression on those three patterns would not fail this suite. The Gateway is a pure reverse proxy (no DbContext/broker) so the boot needs no SQL. **Integration** style. |
| `MMCA.ADC.Services.Tests` | 5 | The only project that tests the **service-host gRPC adapters** directly rather than through a booted host. Its subject is a single, easily-missed wire contract in the data-subject export named by ADC's private `PRIVACY.md` §7 ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) / §30): SQL Server returns `DateTimeKind.Unspecified` values, and the `"O"` format omits the `Z` marker for them, so a timestamp that is genuinely UTC crosses the wire looking like a local time. `UserEngagementExportGrpcServiceTests` and `UserNotificationExportGrpcServiceTests` assert the **emit** leg (every timestamp ends with `Z` and parses back to the same instant, `MMCA.ADC/Tests/Services/MMCA.ADC.Services.Tests/Exports/UserEngagementExportGrpcServiceTests.cs:17`); the two `...GrpcAdapterTests` assert the **parse** leg, which has to survive a rolling deploy where new Identity code talks to a Notification replica still emitting the marker-less form, so both wire forms must land as `DateTimeKind.Utc` on identical ticks (`.../Exports/UserNotificationExportServiceGrpcAdapterTests.cs:15`). `FakeServerCallContext` is a minimal `ServerCallContext` that lets a server implementation be invoked directly: the export services read only the cancellation token, so nothing else has to behave (`.../Support/FakeServerCallContext.cs:10`). In `MMCA.ADC.CI.slnf` (`MMCA.ADC/MMCA.ADC.CI.slnf:60`), so it runs on every PR with no DB. **Unit** style. |
| `MMCA.ADC.CrossService.IntegrationTests` | 11 | The **real-broker + real-gRPC** tier: boots all three REST hosts (Identity/Conference/Engagement) in one process against a **Testcontainers** SQL Server and a **Testcontainers** RabbitMQ, so the genuine MassTransit outbox → broker → consumer round-trip (`UserRegistered` auto-link, `SpeakerLinked`/`SpeakerUnlinked` back-link) and the real Conference → Engagement bookmark-count gRPC read run end to end, over a sequential env-boot fixture (a subclass of the shared [`CrossServiceFixtureBase`](#crossservicefixturebase)) and a smoke gate that fails first if the container/host wiring is wrong. **Integration** style; needs **Docker**, runs in the weekday-nightly `cross-service` job (`MMCA.ADC/.github/workflows/cross-service-tests.yml:75`, scheduled by the `0 6 * * 1-5` cron at `.../cross-service-tests.yml:31`, behind a `should-run` guard that skips a night with no new commits, `.../cross-service-tests.yml:50`), not in `Integration.slnf`. This is the job whose recency the `cross-service-freshness` deploy gate keys off. |
| `MMCA.ADC.ServiceBusEmulator.IntegrationTests` | 3 | **Broker-parity smoke** (§33): production runs on Azure Service Bus while local development runs RabbitMQ, so Service-Bus-specific transport behavior is otherwise observable only in the deployed environment. This tier runs MassTransit v8 against the official **Service Bus emulator** container with ADC's real integration-event contracts and proves the two transport-specific behaviors: admin-plane topology provisioning (topic per message type, subscription, receive-endpoint queue) and the AMQP publish → topic → subscription → consume round-trip (`MMCA.ADC/Tests/Integration/MMCA.ADC.ServiceBusEmulator.IntegrationTests/ServiceBusRoundTripSmokeTests.cs:26`). The fixture is the whole lesson here. It was dispatch-only from 2026-07-24 after hanging and being killed at its timeout on 7 of 7 runs, and the cause was read at the time as the emulator's floating companion SQL image; it was not. The real cause was provisioning **volume**: the test class implemented `IAsyncLifetime`, xUnit re-instantiates a test class per `[Fact]`, and every bus start re-provisions the whole topology through an admin plane throttled at roughly one operation per second. The bus now lives on the **collection fixture** and starts once, and both startup phases are wall-clock bounded so a future hang fails with a phase-named error instead of being killed at the job timeout (which discards the step log, and is why this went unlocalized for a week): `ServiceBusEmulatorFixture` at `.../Infrastructure/ServiceBusEmulatorFixture.cs:48`, its `[CollectionDefinition]` at `:185`. It has been **back on the weekday nightly since 2026-07-29** (`MMCA.ADC/.github/workflows/cross-service-tests.yml:145`), still `continue-on-error: true` (`:150`) under a 10-minute spend cap (`:149`), and it can never gate a deploy: the freshness gate keys off the `cross-service` job specifically. **Integration** style; needs **Docker**. |
| `MMCA.ADC.E2E.Tests` | 70 | **Playwright** end-to-end against the running Aspire stack, using a Page-Object model (`PageObjects/`) and [`E2ETestBase`](#e2etestbase) login helpers, organized by actor workflow (Organizer/Speaker/Attendee/Identity/Preferences) plus the Engagement live-poll and feedback flows, real-time notification push, a Web-Vitals budget check, and an `AccessibilityTests` axe sweep that now runs **31** WCAG 2.1 AA scans across the public browse pages (events, sessions, speakers, sponsors), the organizer management lists and create forms, the speaker dashboard and QR page, Happening Now as both actors, and the badge/points/check-in/attendance surfaces (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:17`); it complements the Identity-flow scans shipped in the `MMCA.Common.Testing.E2E` workflow bases. **Caveat, verified in source:** the page objects added with the badge/points wave (`MyBadgePage`, `MyPointsPage`, `CheckInScanPage`, `OrganizerAttendancePage`, `OrganizerPointsOverviewPage`, `RoomCheckInPage`, `SponsorVisitPage`) are referenced only by `AccessibilityTests` today, so those surfaces are axe-scanned but have no workflow test driving them end to end yet. Runs once per engine via `E2E_BROWSER` (chromium/firefox/webkit); the chromium leg gates deploy through `e2e-gate` while firefox and webkit stay on the Mon/Thu schedule. The largest single project here and the source of most of the chapter's recorded E2E debugging history. `[Rubric §28, Front-End Testing]` + `[Rubric §22, Responsive/Cross-Browser]`: this suite is the cross-browser, real-user-flow safety net. **E2E** style. |

**Reconciliation.** Common: 32+45+211+279+2+94+15+28+16+87+4+13+6 = **832** (13 projects).
ADC Conference: 17+25+148+13+18+37+36 = **294** (7). ADC Engagement: 7+11+56+4+8+34+22 = **142** (7).
ADC Identity: 3+4+26+4+7+6+33 = **83** (7). ADC Notification: 1+5+9 = **15** (3).
ADC host/service-adapter/cross-service/E2E: 5+5+11+3+70 = **94** (5).
**Total = 832+294+142+83+15+94 = 1,460**, across **42 projects**, matching the unit input exactly.


---
[⬅ Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)](group-26-device-capability-layer.md)  •  [Index](00-index.md)  •  [Coverage audit ➡](99-coverage-audit.md)
