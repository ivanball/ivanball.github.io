# 27. Testing & Quality Infrastructure

**What this group covers.** Everything the codebase uses to *prove* itself: the four reusable
test-support packages that ship out of `MMCA.Common/Source/Hosting` (`MMCA.Common.Testing`,
`MMCA.Common.Testing.E2E`, `MMCA.Common.Testing.UI`, `MMCA.Common.Testing.Architecture`), the
architecture-fitness rule library that gates the build, the backend-less component Gallery harness, and
the many per-repo test projects that consume all of it. The distinction to hold onto while reading:
most of the *types* in this group are reusable **bases, fixtures, harnesses, and helpers** compiled
into and shipped by MMCA.Common, while the concrete `[Fact]`-bearing test classes that subclass them
live in each consumer repo (`MMCA.Common.*.Tests`, `MMCA.ADC.*.Tests`, `MMCA.Store.*.Tests`). Those
individual test classes are cataloged by project in the companion rollup section; this chapter teaches
the *machinery* they stand on.

There are five moving parts, and they map onto the test pyramid plus one governance layer:

1. **Integration-test scaffolding** ([`IIntegrationTestFixture`](#iintegrationtestfixture),
   [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture),
   [`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint),
   [`JwtTokenGenerator`](#jwttokengenerator), [`FeatureManagementTestExtensions`](#featuremanagementtestextensions),
   [`EntityBuilderBase<TBuilder, TEntity>`](#entitybuilderbasetbuilder-tentity)) boots a real service
   host in-process against a throwaway SQL Server database and drives it over HTTP.
2. **Architecture fitness functions** ([`IArchitectureMap`](#iarchitecturemap), [`Layer`](#layer),
   [`LayerRef`](#layerref), [`ArchitectureAssert`](#architectureassert), [`RuleHelpers`](#rulehelpers),
   [`CrossEntityNavigationFinder`](#crossentitynavigationfinder), the eighteen `ArchitectureRules.*`
   partial files, and the thirty abstract `*TestsBase` classes including
   [`RouteAuthorizationTestsBase`](#routeauthorizationtestsbase) and
   [`BrandColorTokenTestsBase`](#brandcolortokentestsbase)) turn architectural rules into build-gating
   assertions that run identically across every repo.
3. **Component (bUnit) testing** ([`BunitComponentTestBase`](#bunitcomponenttestbase),
   [`TestPrincipal`](#testprincipal), [`CapturingHttpMessageHandler`](#capturinghttpmessagehandler),
   [`UiHttpServiceHarness`](#uihttpserviceharness), [`MarkupSnapshot`](#markupsnapshot)) render Blazor
   components in isolation with real MudBlazor services and faked HTTP/auth edges.
4. **End-to-end (Playwright) testing** ([`PlaywrightFixture`](#playwrightfixture),
   [`E2ETestConfiguration`](#e2etestconfiguration), [`PageExtensions`](#pageextensions), [`AxeOptions`](#axeoptions),
   [`AccessibilityViolationException`](#accessibilityviolationexception), [`WebVitalsCollector`](#webvitalscollector),
   and the reusable page objects [`LoginPage`](#loginpage) / [`RegisterPage`](#registerpage) /
   [`ProfilePage`](#profilepage)) drive a real browser against a running app, asserting accessibility and
   performance alongside behavior.
5. **Contract and pipeline bases** ([`SecurityHeadersTestsBase`](#securityheaderstestsbase),
   [`OpenApiContractTestsBase<TFixture>`](#openapicontracttestsbasetfixture),
   [`ProblemDetailsContractTestsBase<TFixture>`](#problemdetailscontracttestsbasetfixture),
   [`ServiceInfoVersioningContractTestsBase<TFixture>`](#serviceinfoversioningcontracttestsbasetfixture),
   [`DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult),
   [`HandlerTestBase<THandler>`](#handlertestbasethandler)) pin cross-cutting HTTP and pipeline
   guarantees so a refactor cannot silently drop them.

This whole group is the [Rubric §14, Testability] story made concrete: the framework does not merely
*permit* testing, it ships the reusable substrate so every consumer tests the same way. The front-end
slices additionally carry [Rubric §21, Accessibility], [Rubric §22, Responsive/Cross-Browser],
[Rubric §23, Front-End Performance], and [Rubric §28, Front-End Testing]; the fitness library carries
[Rubric §34, Architecture Governance & Documentation].

## Integration tests: a real host, a throwaway database, a per-test reset

The integration tier boots the actual application, not a mock of it. The abstraction at its center is
[`IIntegrationTestFixture`](#iintegrationtestfixture)
(`MMCA.Common.Testing/IIntegrationTestFixture.cs:8`): a two-method contract, `CreateClient()`
(`IIntegrationTestFixture.cs:11`) and `ResetDatabaseAsync()` (`IIntegrationTestFixture.cs:19`), that
hides how the host and its database are provisioned. Its remarks are load-bearing: a host running
multiple physical data sources (database per service, see
[primer](00-primer.md#2-architectural-styles-this-codebase-commits-to) and ADR-006) must reset **every**
relational source, and a fixture can resolve `IEntityDataSourceRegistry` / `IDataSourceResolver` from
the booted host to enumerate them (`IIntegrationTestFixture.cs:13-18`).

[`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture)
(`MMCA.Common.Testing/IntegrationTestBase.cs:13`) is the per-test base every integration test class
inherits. It implements xUnit's `IAsyncLifetime`, so `InitializeAsync` resets the database before each
test (`IntegrationTestBase.cs:31`) and `DisposeAsync` disposes the HTTP client after
(`IntegrationTestBase.cs:34`). It exposes typed HTTP helpers (`GetAsync<T>`, `PostAsync<T>`,
`PutAsync<T>`, `PutAsync`, `DeleteAsync`, `IntegrationTestBase.cs:51-72`), bearer-token management
(`SetBearerToken` / `ClearAuthentication`, `IntegrationTestBase.cs:42-48`), and a thread-safe
`NextId()` counter seeded at 1000 (`IntegrationTestBase.cs:16,75`) so parallel tests never collide on
generated identifiers. Downstream projects subclass it to add domain-specific auth and entity helpers.

[`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint)
(`MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27`) is the concrete fixture scaffolding.
`InitializeAsync` (`SqlServerIntegrationTestFixtureBase.cs:67`) mints a GUID-suffixed database name,
sets `ASPNETCORE_ENVIRONMENT=Testing` and the top-level connection string as **process environment
variables** (so the host reads them at configure-time, `:74-77`), builds the subclass-supplied
`WebApplicationFactory` (`:79`), and forces database creation by requesting the first client, which runs
the host's `Migrate` init strategy (`:81-84`). It then builds a Respawn checkpoint that ignores
`__EFMigrationsHistory` (`:90-94`); `ResetDatabaseAsync` (`:99`) replays that checkpoint between tests,
and `DisposeAsync` (`:115`) drops the throwaway database and restores every pushed environment variable
(`:125-130`). The `Testing` environment is chosen deliberately so `appsettings.Development.json` (which
points a module's `DataSources` entry at `localhost`) does not load, leaving the resolver to collapse
onto the overridden top-level connection string, a single-database monolith shape (`:16-24`). Server
selection defaults to LocalDB but is overridable through `SqlBaseEnvironmentVariable` (`:58`, read at
`:69-70`) so CI can target a SQL service container. Because these fixtures need a reachable SQL Server,
the per-module `*.Integration.slnf` suites build in a headless sandbox but only *run* in CI.

Three helpers round out the tier. [`JwtTokenGenerator`](#jwttokengenerator)
(`MMCA.Common.Testing/JwtTokenGenerator.cs:29`) issues **RS256**-signed tokens (`GenerateToken`,
`JwtTokenGenerator.cs:111`) using an embedded dev RSA-2048 keypair (`JwtTokenGenerator.cs:48-95`) under a
fixed `kid` of `mmca-test-key` (`:40`), so integration tests exercise the exact JWKS/RS256 validation code
path production runs (ADR-004); the class remarks flag, correctly, that the committed keypair is insecure
by design and must never be used in a real deployment (`:21-27`). [`FeatureManagementTestExtensions`](#featuremanagementtestextensions)
(`MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10`) adds a `ConfigureTestFeatureFlags`
extension member (`:21`) that builds an in-memory `FeatureManagement:*` configuration so a test
`WebApplicationFactory` can flip a gate without touching `appsettings.json`.
[`EntityBuilderBase<TBuilder, TEntity>`](#entitybuilderbasetbuilder-tentity)
(`MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9`) is a minimal fluent-builder base whose single
abstract `Build()` (`:17`) returns the entity through its domain factory, so test setup specifies only
what a test cares about. Together these embody [Rubric §11, Security] (real token validation rather than
bypassed auth middleware) and [Rubric §14, Testability].

## Architecture fitness functions: rules that gate the build

The layering and DDD conventions this codebase commits to are not left to code review, they are executed
as tests. The reusable rule library lives in `MMCA.Common.Testing.Architecture` and is the subject of
**ADR-015**. Its keystone is [`IArchitectureMap`](#iarchitecturemap)
(`MMCA.Common.Testing.Architecture/IArchitectureMap.cs:39`): the single per-repo boundary every fitness
function keys off. Each repo supplies one implementation (for example `StoreArchitectureMap`) declaring
its layer and module assemblies as [`LayerRef`](#layerref) records (`IArchitectureMap.cs:31`) tagged by the
[`Layer`](#layer) enum (`IArchitectureMap.cs:9`), and exposes them through query members such as
`OfLayer`, `ModuleDomain`, `ModuleApplication`, `For`, `ModuleOf`, and `OtherModuleNamespaces`
(`IArchitectureMap.cs:51-81`). The shared rules consume *only* the interface, which is why one rule body
runs identically across MMCA.Common, MMCA.Store, MMCA.ADC, and Helpdesk: the map is the only thing that
varies. `Layer` deliberately includes optional layers (`Ui`, `Grpc`, `Contracts`, `ServiceHost`,
`IArchitectureMap.cs:16-19`) that a repo simply omits, so a rule iterating them is vacuously satisfied
with no compile dependency on an absent assembly (`IArchitectureMap.cs:3-8`).

The rule bodies are split across sixteen `ArchitectureRules.*` partial files (layers, purity, handlers,
handler results, entities, events, modules, slices, naming, transport, controllers,
immutability, governance, localization, localized text, and specifications; aggregate-convention
rules live inside `ArchitectureRules.Entities.cs` and are exercised through
`Bases/AggregateConventionTestsBase.cs`, not a dedicated partial), and the thirty abstract
`*TestsBase` classes under `Bases/` (`LayerDependencyTestsBase`, `DomainPurityTestsBase`,
`MicroserviceExtractionTestsBase`, `ModuleIsolationTestsBase`, `PiiConventionTestsBase`,
`DependencyVersionTestsBase`, `IntegrationEventContractTestsBase`, `DataResidencyTestsBase`, and more)
each expose a rule as one `[Fact]` that a sealed per-repo subclass activates by supplying its map.
Failures report through [`ArchitectureAssert`](#architectureassert)
(`MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:8`), which has two overloads: one lists the
failing types from a NetArchTest `TestResult` (`ArchitectureAssert.cs:11-23`), the other lists a
reflection-derived violation set (`ArchitectureAssert.cs:26-32`). Rules NetArchTest cannot express
(method return types, generic constraints, property accessors, attribute usage) reflect over loaded types
via the internal [`RuleHelpers`](#rulehelpers) (`MMCA.Common.Testing.Architecture/RuleHelpers.cs:14`),
whose `LoadableTypes` extension property tolerates a partially resolvable assembly by falling back to the
`ReflectionTypeLoadException`'s resolved types (`RuleHelpers.cs:19-33`). One such walk,
[`CrossEntityNavigationFinder`](#crossentitynavigationfinder)
(`MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97`), is an `ExpressionVisitor`
that collects the entity types a specification's criteria navigates to beyond its own
(`ArchitectureRules.Specifications.cs:99-105`). These runtime rules are the second of two enforcement
layers, the first being the compile-time MSBuild layer guard
(`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets`, see
[group 14](group-14-module-system-composition.md)); ADR-015 describes both, and this is the clearest
[Rubric §34, Architecture Governance] expression in the codebase.

The fitness library reaches beyond pure layering into cross-cutting product guarantees.
[`RouteAuthorizationTestsBase`](#routeauthorizationtestsbase)
(`MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:22`, tagged rubric §25 in its own
remarks, [Rubric §25, Navigation & IA]) reflects over routable Blazor pages and asserts every governed
page keeps its `[Authorize(Roles = "...")]` gate, so an admin route cannot regress to a bare
`[Authorize]`. It detects `RouteAttribute` and `AuthorizeAttribute` by full-name reflection
(`RouteAuthorizationTestsBase.cs:24-25`) so the package stays free of ASP.NET references, and a
`MinimumGovernedPages` floor (`:47`) guards against a moved namespace silently emptying the scan.
[`BrandColorTokenTestsBase`](#brandcolortokentestsbase)
(`MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:13`, [Rubric §20, Design System &
Theming]) reads landing-page stylesheets embedded as manifest resources and fails the build if a host
re-hardcodes the brand hex `#1565C0` instead of sourcing `var(--mmca-primary)` from the shared token
(`BrandColorTokenTestsBase.cs:15-16,24`). Sibling bases pin integration-event contracts (ADR-010), the
MassTransit-v8 major-version policy (`DependencyVersionTestsBase`), data residency, forms conventions,
localization resources, concurrency, and constructor dependency counts, so the governance-as-tests
pattern spans much of the 34-category rubric.

## Component tests: real MudBlazor, faked edges

The bUnit tier renders a single Blazor component in-process with its real dependencies but stubbed
network and auth. [`BunitComponentTestBase`](#bunitcomponenttestbase)
(`MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33`) registers MudBlazor services and
puts JSInterop in loose mode so MudBlazor's JS probes do not throw during render
(`BunitComponentTestBase.cs:42-43`), then wires a **mutable** `AuthenticationStateProvider`
(`BunitComponentTestBase.cs:97`) plus an `IsAuthenticatedAuthorizationService`
(`BunitComponentTestBase.cs:111`) so both `<AuthorizeView>` cascades and pages that inject the provider
directly behave. Tests render anonymously by default via `RenderUnderTest<TComponent>`
(`BunitComponentTestBase.cs:59`) or as a supplied `ClaimsPrincipal` via `RenderAs<TComponent>`
(`BunitComponentTestBase.cs:65`), with [`TestPrincipal`](#testprincipal)
(`MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6`) minting the authenticated principal
(authentication type, `user_id` claim, name, roles, `TestPrincipal.cs:13-20`). `RenderMudProviders`
(`BunitComponentTestBase.cs:83`) mounts the popover, dialog, and snackbar providers and returns them as a
`MudProviderHandles` record (`BunitComponentTestBase.cs:92`) so components that open a dialog or raise a
toast have somewhere to render. The class is pinned to bUnit v2 (the line compatible with xUnit v3 and
Microsoft Testing Platform) and isolates every version-specific symbol here so a bUnit change touches
only this file (`BunitComponentTestBase.cs:24-31`). Localization is pre-registered (`AddLocalization`,
`BunitComponentTestBase.cs:48-52`) so components injecting `IStringLocalizer<T>` (ADR-027) render without
per-test setup, an [Rubric §27, i18n] touch.

HTTP-backed UI services are exercised without a server through [`CapturingHttpMessageHandler`](#capturinghttpmessagehandler)
(`MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18`), a canned-response,
request-recording `HttpMessageHandler` supporting both a responder delegate
(`CapturingHttpMessageHandler.cs:38`) and route registration, with unmatched requests returning 404 to
mirror the WebAPI's not-found behavior (`CapturingHttpMessageHandler.cs:7-17`); it rebuilds each response
fresh so a Polly retry never reuses a consumed `HttpContent`, and records every request as a
`CapturedRequest` (`CapturingHttpMessageHandler.cs:129`) against a registered `Route`
(`CapturingHttpMessageHandler.cs:110`). [`UiHttpServiceHarness`](#uihttpserviceharness)
(`MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:12`) wraps that handler with a
`FreshApiClientFactory` (`UiHttpServiceHarness.cs:73`) returning a fresh `"APIClient"` per call (the
services dispose each client, so the same instance must never come back twice) plus a fixed-token storage
stub, on a `https://gateway.test/` base address (`UiHttpServiceHarness.cs:15`).
[`MarkupSnapshot`](#markupsnapshot) (`MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21`) adds
dependency-free golden-markup regression testing: it normalizes the per-render GUIDs MudBlazor injects,
compares against a committed baseline under `Snapshots/` next to the calling test, and returns a
`MarkupSnapshotResult` (`MarkupSnapshot.cs:104`) for the caller to assert on; `UPDATE_SNAPSHOTS=1`
rewrites baselines and a missing baseline is written but reported as a non-match so a regression cannot
slip through (`MarkupSnapshot.cs:6-20`). This tier is [Rubric §28, Front-End Testing] and [Rubric §18, UI
Architecture].

## End-to-end tests: a real browser, accessibility and performance as gates

The E2E tier drives a real browser through Playwright. [`PlaywrightFixture`](#playwrightfixture)
(`MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6`) is an xUnit collection fixture that
launches the engine selected from configuration, `chromium`, `firefox`, or `webkit`, with unknown values
falling back to Chromium (`PlaywrightFixture.cs:16-22`). That environment-selected engine is what lets CI
run the same suite as a cross-browser matrix, [Rubric §22, Responsive/Cross-Browser]; in MMCA.Common's
`ui-e2e` job all three engines are required merge gates. Headless mode, slow motion, base URL, timeouts,
trace capture, and the seeded admin/user credentials all come from
[`E2ETestConfiguration`](#e2etestconfiguration) (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8`),
whose nested `AdminCredentials` (`E2ETestConfiguration.cs:66`) and `UserCredentials`
(`E2ETestConfiguration.cs:78`) let a downstream project set app-specific defaults through a
`[ModuleInitializer]` while environment variables always win.

The hard part of Blazor E2E is timing, and [`PageExtensions`](#pageextensions)
(`MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:19`) is where that knowledge is centralized, as
C# `extension(IPage)` and `extension(ILocator)` blocks (`PageExtensions.cs:21,185`, see
[primer](00-primer.md#c-extensiont-types-read-this-once)). The app uses InteractiveAuto with
prerendering, so a page appears as static HTML before the runtime wires its event handlers.
`WaitForBlazorAsync` (`PageExtensions.cs:27`) waits for `window.Blazor._internal` then two animation
frames plus a 500 ms settle before any interaction (`PageExtensions.cs:32-40`);
`GotoAndWaitForBlazorAsync` (`:47`) pairs navigation with it and deliberately waits on `Load` rather than
`NetworkIdle`, because the persistent SignalR WebSocket means network idle never arrives (`:50-52`);
`BlazorNavigateAsync` (`:62`) routes client-side so a protected page is not re-prerendered without its
token. `FillAndVerifyAsync` (`:197`) fills a field then auto-waits until the value sticks, retyping
character by character if hydration wiped it (`:212-214`), and `ClickAndVerifyAsync` (`:230`) and
`ClickAndWaitForUrlAsync` (`:273`) retry a click until its visible effect appears so a click that beats
hydration is not silently swallowed. These helpers encode hard-won lessons about the prerender and
hydration race and are shared by every page object.

Accessibility and performance are asserted here, not deferred to a separate audit.
`AssertNoAccessibilityViolationsAsync` (`PageExtensions.cs:157`) runs an axe-core scan and throws
[`AccessibilityViolationException`](#accessibilityviolationexception)
(`MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7`) with a compact per-node
summary of every violation (`PageExtensions.cs:170-181`), so an inaccessible page fails the build,
[Rubric §21, Accessibility]. The scan scope itself is shipped as [`AxeOptions`](#axeoptions)
(`MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9`): `Wcag21Aa` (`AxeOptions.cs:17`) pins the
documented target of WCAG 2.1 AA tags and deliberately excludes axe's advisory best-practice rules, and
`Wcag21AaExceptMudPagerCombobox` (`AxeOptions.cs:35`) is the one documented carve-out for MudBlazor
9.6.0's unlabeled pager select (`AxeOptions.cs:26-33`). [`WebVitalsCollector`](#webvitalscollector)
(`MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:17`) installs `PerformanceObserver`-based
Core Web Vitals capture (LCP, CLS, FCP, TTFB, INP) as an init script before first paint (`InstallAsync`,
`WebVitalsCollector.cs:37`), reads the accumulated values back as a `WebVitalsSample` (`CollectAsync`,
`WebVitalsCollector.cs:44,73`), and writes a citable JSON artifact under `WEB_VITALS_OUTPUT_DIR`
(`WriteArtifactAsync`, `WebVitalsCollector.cs:60`) for CI, [Rubric §23, Front-End Performance] (the source
tags it rubric §12). LCP and CLS are Chromium-only, so on Firefox and WebKit those fields stay 0 and the
observers fail silently rather than throwing (`WebVitalsCollector.cs:11-14,19-21`). The reusable identity
page objects [`LoginPage`](#loginpage) (`MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6`),
[`RegisterPage`](#registerpage) (`MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:6`), and
[`ProfilePage`](#profilepage) (`MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:6`) wrap the framework's
real auth surfaces with role- and label-based locators (`LoginPage.cs:12-18`) and route their own fills
through the anti-race helper (`LoginPage.cs:31-32`, invoked at `:25-26`); downstream apps add their own family, for example the
`MMCA.ADC.E2E.Tests` page objects for events, sessions, speakers, rooms, questions, and feedback.

## The Gallery harness

Component and E2E coverage of MMCA.Common's *own* UI needs a page to render, but the framework is not a
runnable app. `MMCA.Common.UI.Gallery` is a deliberately backend-less Blazor host that renders the real
`MMCA.Common.UI` auth pages (`/login`, `/register`), the shared notification pages, and a primitives
showcase (`/components`), so a real-browser axe scan can run inside MMCA.Common's own CI
(`MMCA.Common.UI.Gallery/GalleryHost.cs:15-20`). It is kept **outside** `MMCA.Common.slnx` (together with
`MMCA.Common.UI.E2E.Tests`) so the unit-test run stays fast; the CI `ui-e2e` job builds both by csproj
path and scans the gallery. The host runs without a backend by registering stubs before `AddUIShared` so
its `TryAdd*` registrations defer to them (`GalleryHost.cs:55-63`): `NoOpAuthUIService`,
[`NullTokenStorageService`](#nulltokenstorageservice)
(`MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:10`), [`NullTokenRefresher`](#nulltokenrefresher)
(`MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:9`), and
[`GalleryAuthenticationStateProvider`](#galleryauthenticationstateprovider)
(`MMCA.Common.UI.Gallery/Stubs/GalleryAuthenticationStateProvider.cs:16`), which mirrors the request's
authentication in both render phases. Because the notification pages carry a real `[Authorize]` that
`MapRazorComponents` surfaces as endpoint metadata, the gallery also needs a genuine authentication
scheme: [`GalleryFakeAuthenticationHandler`](#galleryfakeauthenticationhandler)
(`MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:19`) authenticates only requests
carrying the `gallery_auth=1` cookie (`GalleryFakeAuthenticationHandler.cs:26,30`), so the guarded pages
are scanned signed in while `/login`, `/register`, and `/components` are scanned in their deliberate
anonymous state (`GalleryFakeAuthenticationHandler.cs:8-17`).

## Contract and pipeline bases

The last family pins guarantees that live in the composition of the stack rather than in any one type.
[`SecurityHeadersTestsBase`](#securityheaderstestsbase) (`MMCA.Common.Testing/SecurityHeadersTestsBase.cs:16`,
[Rubric §11, Security] and [Rubric §26, Front-End Security]) probes an always-responding endpoint
(`ProbePath`, default `/alive`, `SecurityHeadersTestsBase.cs:19`) and asserts the hardened header set:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
strict-origin-when-cross-origin`, a `Permissions-Policy` containing `geolocation=()`, a
`Content-Security-Policy` containing `frame-ancestors 'none'`, and, in the Production environment, HSTS
(`SecurityHeadersTestsBase.cs:30-36`). Its siblings
[`OpenApiContractTestsBase<TFixture>`](#openapicontracttestsbasetfixture)
(`MMCA.Common.Testing/OpenApiContractTestsBase.cs:21`),
[`ProblemDetailsContractTestsBase<TFixture>`](#problemdetailscontracttestsbasetfixture)
(`MMCA.Common.Testing/ProblemDetailsContractTestsBase.cs:21`), and
[`ServiceInfoVersioningContractTestsBase<TFixture>`](#serviceinfoversioningcontracttestsbasetfixture)
(`MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19`) all subclass
[`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) and pin the corresponding API
contracts, [Rubric §9, API & Contract Design].

Two bases guard the CQRS pipeline itself.
[`DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult)
(`MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:36`) is the opt-in fitness function for ADR-014:
it builds a real `ServiceCollection` through the repo's own registration sequence, resolves the decorated
handlers, unwraps each decorator's private inner-handler field by reflection, and asserts the runtime
nesting is exactly FeatureGate, Logging, Caching, Validating, Transactional, handler for commands and
FeatureGate, Logging, Caching, handler for queries (`DecoratorPipelineOrderTestsBase.cs:9-30`). Because
Scrutor's `TryDecorate` applies decorators in reverse registration order, an innocent-looking reorder of
the `AddApplicationDecorators()` lines silently changes runtime behavior, and this base turns that into a
test failure (see [group 5](group-05-cqrs-pipeline.md)). [`HandlerTestBase<THandler>`](#handlertestbasethandler)
(`MMCA.Common.Testing/HandlerTestBase.cs:38`) is the fast unit-tier counterpart for exercising a single
handler without a host.

The takeaway for a new engineer: pick the tier that matches what you are proving (a fast unit test for
domain logic, bUnit for a component, an integration fixture for a full request path, an E2E page object
for a browser flow, a `*TestsBase` subclass for an architectural invariant), and the reusable base you
need is already in one of the four `MMCA.Common.Testing.*` packages. Every remaining concrete test class
is cataloged by project in the companion per-project test rollup for this chapter.

### ObservabilityConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:17` · Level 0 · class (sealed partial)

- **What it is**: an SLO alert-to-runbook pairing gate. It reads the Azure alerts that `infra/main.bicep`
  provisions and asserts that every one keeps a matching, severity-correct triage section in
  `infra/OPERATIONS.md`, so an alert cannot be added, renamed, or re-tiered without its runbook moving in
  the same change.
- **Depends on**: BCL only (`System.Globalization`, `System.Text.RegularExpressions`,
  `System.Reflection` for the executing assembly). Both `infra/main.bicep` and `infra/OPERATIONS.md` are
  embedded as manifest resources (`ObservabilityConventionTests.cs:20-21`, wired in the csproj), so the
  gate reads them without touching the filesystem.
- **Concept introduced, the architecture fitness function.** A fitness function is a plain unit test whose
  subject is not application logic but a rule the architecture must keep obeying, so a governance decision
  becomes an executable, CI-enforced guard instead of a review-time convention. `[Rubric §13,
  Observability & Operability]` assesses whether the running system can be operated: alerts that page a
  human are worthless without a runbook, and this test pins the alert-runbook pairing at build time.
  `[Rubric §34, Architecture Governance & Documentation]` applies too, this is documentation kept honest
  by code rather than by discipline.
- **Walkthrough**
  - Constants (`ObservabilityConventionTests.cs:19-22`): `MinimumAlertSpecs = 3` (the non-vacuous floor),
    the two embedded-resource logical names, and the `-alert-` infix that ties a bicep key to a runbook
    heading.
  - `SloAlertSpecs_AreDiscovered_GateIsNotVacuous` (`:25-32`): asserts the parser finds at least three
    specs, so a drifted parse anchor fails loudly rather than passing an empty gate.
  - `EveryProvisionedSloAlert_HasASeverityCorrectRunbookSection` (`:35-60`): for each discovered
    `(key, severity)` it finds the `### ...-alert-{key}` heading and checks the heading carries the
    matching `(sev N)` tag (`:51-55`).
  - `EveryRunbookAlertSection_MapsToAProvisionedAlert` (`:63-74`): the reverse direction, an orphan
    runbook section whose alert no longer exists fails the build.
  - `DiscoverAlertSpecs` (`:76-97`): slices the bicep between `var sloAlertSpecs` and
    `resource sloAlerts` (`:80-85`), then runs the source-generated `AlertKeyRegex` / `AlertSeverityRegex`
    over that block and asserts the key and severity counts match (`:86-88`).
  - Source-generated regexes (`:110-117`): `[GeneratedRegex]` partial properties with a 2 second match
    timeout, the compile-time-safe way to parse the two infra files.
- **Why it's built this way**: reading the real embedded infra files (not a hand-maintained list) means the
  gate tracks whatever is actually deployed, and the minimum-spec floor is what keeps a parser regression
  from silently disabling the whole guard.
- **Where it's used**: run as part of the ADC architecture-test tier in `CI.slnf`; no database needed.
- **Caveats / not-in-source**: the test asserts the pairing between the bicep spec and the runbook markdown;
  whether Azure actually raised an alert at runtime is outside its scope.

### BrandColorTokenTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:12` · Level 1 · class (sealed)

- **What it is**: a brand-token drift guard. It asserts the conference landing page's shared scoped
  stylesheet sources the primary brand color from the `var(--mmca-primary)` CSS custom property rather than
  re-hardcoding the hex value.
- **Depends on**: the shared [`BrandColorTokenTestsBase`](#brandcolortokentestsbase) (extended,
  `BrandColorTokenTests.cs:12`). The base owns the scan and assertion; this subclass only names the
  embedded stylesheet.
- **Concept**: a design-system fitness test. `[Rubric §20, Design System & Theming]` assesses whether the
  UI derives from tokens rather than scattered literals; the base guards the C#-to-CSS token definition in
  MMCA.Common, and this subclass guards the ADC consumer of that token
  (`BrandColorTokenTests.cs:3-10`).
- **Walkthrough**
  - `EmbeddedCssLogicalNames` (`:14-17`): the single override, listing `ADCHome.Shared.razor.css`, the
    shared scoped stylesheet rendered by both UI hosts, embedded into this assembly so a re-introduced
    literal fails the build.
- **Why it's built this way**: a subclass supplies only the file names because the drift rule itself lives
  once in the base and is reused across every repo that consumes the brand token.
- **Where it's used**: ADC architecture-test tier; no database needed.

### TranslationCompletenessTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:12` · Level 5 · class (sealed)

- **What it is**: an internationalization completeness gate. It asserts every base `*.resx` under `Source/`
  has a complete, non-empty Spanish `.es.resx` sibling, so adding an English key without its Spanish
  counterpart fails CI instead of silently shipping a half-translated UI.
- **Depends on**: the shared [`LocalizationResourceTestsBase`](#localizationresourcetestsbase) (extended,
  `TranslationCompletenessTests.cs:12`).
- **Concept**: an i18n fitness test. `[Rubric §27, i18n]` assesses whether localization is complete and
  enforced rather than aspirational; this gate makes translation parity a build-time invariant, backed by
  ADR-027 (which supersedes the single-locale ADR-011, `TranslationCompletenessTests.cs:4`).
- **Walkthrough**
  - `RequiredCultures` (`:14`): `["es"]`, the one culture that must exist for every base resource set.
  - `MinimumBaseResources` (`:16`): `40`, the non-vacuous floor, ADC has 40-plus localized resource sets
    across the three module UIs, the UI hosts' landing page, nav-item descriptors, and API error-resource
    sets, so a near-zero discovery count means the scan path drifted.
- **Why it's built this way**: pinning both the required culture and the discovery floor turns "we support
  Spanish" into an executable, non-vacuous guarantee.
- **Where it's used**: ADC architecture-test tier; no database needed.

### DecoratorPipelineOrderTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:25` · Level 8 · class (sealed)

- **What it is**: a fitness function for the CQRS decorator pipeline. It builds the Identity module's real
  registration sequence and asserts the resolved runtime nesting is exactly the expected order for both a
  command and a query, so a re-ordered or dropped decorator is caught at build time rather than surfacing
  as a subtle runtime bug.
- **Depends on**: the shared
  [`DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult)
  (extended, `DecoratorPipelineOrderTests.cs:25-26`), instantiated over the real Identity pair
  [`ChangePreferencesCommand`](group-24-identity-module.md#changepreferencescommand) /
  [`GetUserPreferencesQuery`](group-24-identity-module.md#getuserpreferencesquery) returning
  [`Result`](group-01-result-error-handling.md#result). It uses `Moq` for the decorator constructor
  dependencies and the framework DI extensions `AddApplication` / `ScanModuleApplicationServices` /
  `AddApplicationDecorators` (`DecoratorPipelineOrderTests.cs:1-12`).
- **Concept**: the decorator pipeline is introduced in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to); this test pins its ordering.
  `[Rubric §6, CQRS & Event-Driven]` assesses whether the command/query pipeline is coherent and
  composable; the ordering is load-bearing because Scrutor's `TryDecorate` can only wrap handlers already
  registered, so decorators must be added last (`DecoratorPipelineOrderTests.cs:37-41`).
- **Walkthrough**
  - `ConfigureServices` (`:28-42`): registers test doubles for each decorator constructor dependency
    (`IFeatureManager`, `ICorrelationContext`, `ICacheService`, `IUnitOfWork`, `ILogger<>` via
    `NullLogger<>`, `:31-35`), then reproduces the genuine registration sequence: handler scan first via
    `ScanModuleApplicationServices<...ClassReference>`, decorators last via `AddApplicationDecorators`
    (`:39-41`).
  - The asserted nesting (base-supplied, documented at `:22-23`): FeatureGate -> Logging -> Caching ->
    Validating -> Transactional -> Handler for commands, and FeatureGate -> Logging -> Caching -> Handler
    for queries (queries skip validation and the transaction).
- **Why it's built this way**: exercising the module's real registration order against real command/query
  types (rather than asserting a static list) proves the pipeline the production host actually resolves,
  making the ADR-014 ordering executable (`DecoratorPipelineOrderTests.cs:17`).
- **Where it's used**: ADC architecture-test tier; no database needed.
- **Caveats / not-in-source**: this is described as an opt-in v1.120.0 fitness function
  (`DecoratorPipelineOrderTests.cs:17`), so it exercises one representative pair, not every handler.

### AdcArchitectureMap
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:8` · Level 9 · class (sealed, internal)

- **What it is**: the single source of truth that tells every convention test which assembly is which layer
  of which module. It maps the MMCA.Common framework layers plus the Identity, Conference, and Engagement
  modules, pinning each `(module, layer)` to one anchor type so the fitness functions can reason about
  dependencies structurally.
- **Depends on**: the shared [`ArchitectureMapBase`](#architecturemapbase) (extended,
  `AdcArchitectureMap.cs:8`), whose `Framework(...)` / `Module(...)` helpers and
  [`LayerRef`](#layerref) / [`Layer`](#layer) types it composes, and `System.Reflection`'s
  `Assembly.Load`. Every anchor type it references (for example
  [`Result`](group-01-result-error-handling.md#result),
  [`BaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#baseentitytidentifiertype),
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase),
  [`User`](group-24-identity-module.md#user),
  [`Event`](group-17-conference-domain.md#event),
  [`UserSessionBookmark`](group-22-engagement-module.md#usersessionbookmark)) is a real type from the
  layer it pins.
- **Concept introduced, the architecture map as the linchpin of every convention test.** Rather than each
  test re-discovering assemblies, one map declares the topology and every `*ConventionTestsBase` consumes
  it through the [`IArchitectureMap`](#iarchitecturemap) abstraction. `[Rubric §3, Clean Architecture]`
  assesses whether layer boundaries are explicit and enforced; this map is the machine-readable statement
  of those boundaries. `[Rubric §7, Microservices Readiness]` applies because the map enumerates each
  module's six layers (Domain, Application, Infrastructure, Shared, Api, Ui), the same boundaries the modules
  extract along.
- **Walkthrough**
  - `RepoToken` (`AdcArchitectureMap.cs:10`): `"MMCA.ADC"`, used by the base to locate the repo root
    (`{RepoToken}.slnx`).
  - `DefineLayers` (`:12-44`): a collection expression of `LayerRef`s. The five framework layers are pinned
    by a concrete MMCA.Common type's assembly (`:15-19`); each module then pins its Domain / Shared / Api /
    Ui by an anchor type and its Application / Infrastructure by `Assembly.Load` by name, because those
    assemblies lack a convenient public anchor (`:22-43`).
- **Why it's built this way**: pinning by a real type means the map cannot reference an assembly that does
  not exist, and centralizing the topology in one class is what lets ~25 convention tests each be a
  two-line subclass that only supplies `Map`.
- **Where it's used**: instantiated as the `Map` property of every convention-test subclass in this unit
  (for example [`LayerDependencyTests`](#layerdependencytests),
  [`ModuleIsolationTests`](#moduleisolationtests),
  [`MicroserviceExtractionTests`](#microserviceextractiontests)).

### ConcurrencyConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared
  [`ConcurrencyConventionTestsBase`](#concurrencyconventiontestsbase), which enforces the framework's
  optimistic-concurrency conventions across the mapped assemblies.
- **Depends on**: the base (extended, `ConcurrencyConventionTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: reuses the concurrency convention taught by the base. `[Rubric §8, Data Architecture]` is the
  relevant lens, concurrency handling is a data-integrity concern the base pins.
- **Walkthrough**
  - `Map` (`ConcurrencyConventionTests.cs:5`): the only override, `new AdcArchitectureMap()`.
- **Where it's used**: ADC architecture-test tier; no database needed.

### ConstructorDependencyCountTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:11` · Level 10 · class (sealed)

- **What it is**: a single-responsibility ceiling guard. It caps how many constructor dependencies an
  Application-layer service may take, so a class silently accreting collaborators fails CI.
- **Depends on**: the shared
  [`ConstructorDependencyCountTestsBase`](#constructordependencycounttestsbase) (extended,
  `ConstructorDependencyCountTests.cs:11`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: a SOLID fitness test. `[Rubric §1, SOLID]` assesses cohesion and single responsibility; a
  high constructor-dependency count is the classic smell this guard makes visible.
- **Walkthrough**
  - `Map` (`:13`) and `MaxConstructorDependencies` (`:15`): the ceiling is `8`. The XML doc records that the
    high-water mark is [`AuthenticationService`](group-24-identity-module.md#authenticationservice) at 8, a
    cohesive auth facade whose 8th dependency
    ([`IExternalLoginEmailVerifier`](group-24-identity-module.md#iexternalloginemailverifier)) was a
    conscious raise for the OAuth verified-email gate, not an artificial bundle
    (`ConstructorDependencyCountTests.cs:5-9`).
- **Why it's built this way**: the ceiling is meant to be raised consciously (with the rationale recorded)
  rather than dodged by hiding dependencies behind a bundle.
- **Where it's used**: ADC architecture-test tier; no database needed.

### ControllerConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:3` · Level 10 · class (sealed)

- **What it is**: an API-consistency guard. It asserts every controller routes through
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) (and its `Result`-to-HTTP
  mapping), with a small, justified exemption list.
- **Depends on**: the shared [`ControllerConventionTestsBase`](#controllerconventiontestsbase) (extended,
  `ControllerConventionTests.cs:3`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §9, API & Contract Design]`, uniform error shaping is a contract-design property,
  and this guard keeps every domain controller on the shared mapping.
- **Walkthrough**
  - `ControllersExemptFromApiControllerBase` (`:11-15`): two deliberate exemptions, `OAuthController` (which
    drives the OAuth2 redirect/challenge/cookie flow) and `ServiceInfoController` (an anonymous
    version-discovery diagnostic), neither of which returns domain `Result`s, so both extend `ControllerBase`
    directly (`ControllerConventionTests.cs:7-10`).
- **Where it's used**: ADC architecture-test tier; no database needed.

### DataResidencyTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12` · Level 10 · class (sealed)

- **What it is**: a compliance-drift guard. It asserts the data-residency statement published in
  `PRIVACY.md` matches the Azure region where personal data is actually provisioned, so a stale privacy
  claim cannot outlive a region change.
- **Depends on**: the shared [`DataResidencyTestsBase`](#dataresidencytestsbase) (extended,
  `DataResidencyTests.cs:12`) and [`AdcArchitectureMap`](#adcarchitecturemap), plus `System.IO` to read the
  deploy workflow.
- **Concept**: `[Rubric §30, Compliance/Privacy/Data Governance]` assesses whether privacy statements track
  reality; account data and session bookmarks live in Azure SQL, whose region is the source of truth here
  (`DataResidencyTests.cs:6-10`).
- **Walkthrough**
  - `ForbiddenResidencyClaims` (`:16`): blocks the stale `"central United States"` statement that once
    contradicted the deployed region.
  - `ExtractDeployedRegion` (`:20-31`): the app-specific hook, reads `.github/workflows/deploy.yml` and
    parses the `SQL_LOCATION_OVERRIDE:-<region>` default (`:24-30`), asserting the marker exists so the
    parse cannot silently pass.
- **Why it's built this way**: deriving the deployed region from the actual deploy workflow (not a hand-kept
  constant) means the privacy claim is checked against the region CI would really provision, which for ADC
  differs from the Container Apps region because the QiMata sponsorship forces SQL into another region
  (`DataResidencyTests.cs:6-10`).
- **Where it's used**: ADC architecture-test tier; no database needed.

### DomainPurityTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a Clean Architecture guard that keeps infrastructure concerns out of the Domain and Shared
  layers, extended here to also forbid the broker client.
- **Depends on**: the shared [`DomainPurityTestsBase`](#domainpuritytestsbase) (extended,
  `DomainPurityTests.cs:3`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §3, Clean Architecture]` and `[Rubric §4, DDD]`, a pure domain has no outward
  dependencies, so the guard keeps the dependency arrows pointing inward.
- **Walkthrough**
  - `Map` (`:5`) and `ExtraForbiddenDomainDependencies` (`:9`): adds `"RabbitMQ"` to the framework-default
    forbidden list, because ADC runs on a broker (RabbitMQ locally, Azure Service Bus in production) and its
    client must never leak into Domain or Shared (`DomainPurityTests.cs:7-8`).
- **Where it's used**: ADC architecture-test tier; no database needed.

### EntityConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared [`EntityConventionTestsBase`](#entityconventiontestsbase),
  which enforces the framework's entity conventions (factory methods, encapsulated state, audit/soft-delete
  contracts) across the mapped Domain assemblies.
- **Depends on**: the base (extended, `EntityConventionTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §4, DDD]`, the entity conventions are the DDD building-block rules taught in
  [group-02](group-02-domain-building-blocks.md); the base pins them and this subclass applies them to ADC.
- **Walkthrough**
  - `Map` (`EntityConventionTests.cs:5`): the only override, `new AdcArchitectureMap()`.
- **Where it's used**: ADC architecture-test tier; no database needed.

### EventConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/EventConventionTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared [`EventConventionTestsBase`](#eventconventiontestsbase),
  which enforces the framework's domain-event conventions (naming, immutability, past-tense records) across
  the mapped assemblies.
- **Depends on**: the base (extended, `EventConventionTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §6, CQRS & Event-Driven]`, domain events are the event half of the pattern; the base
  pins their shape.
- **Walkthrough**
  - `Map` (`EventConventionTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### FormsConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:14` · Level 10 · class (sealed)

- **What it is**: a UX-safety convention guard. It asserts the six Conference create forms each keep their
  unsaved-changes guard, dirty tracking, a validated form with required-field errors, and a per-form error
  summary, and it adds a bespoke check for the Identity Profile form.
- **Depends on**: the shared [`FormsConventionTestsBase`](#formsconventiontestsbase) (extended,
  `FormsConventionTests.cs:14`), [`AdcArchitectureMap`](#adcarchitecturemap), `AwesomeAssertions`, and
  `System.IO`.
- **Concept**: `[Rubric §24, Forms/Validation/UX Safety]` assesses whether forms protect the user against
  lost work and unclear validation; this guard pins those markers so a form cannot silently drop them
  (`FormsConventionTests.cs:3-13`).
- **Walkthrough**
  - `MinimumCreateForms` (`:18`): `6`, the Event/Session/Room/Question/Speaker/ConferenceCategory create
    forms.
  - `RequiredMarkers` (`:24-29`): extends the base set with the per-form `MudAlert` error summary and the
    localized `Validation.CorrectFollowing` heading.
  - `ProfileForm_KeepsErrorSummaryAndPasswordValidation` (`:31-62`): a bespoke `[Fact]` for the Identity
    Profile form, which is a single-section password/delete form with no navigate-away step and so does not
    match the base's `*Create.razor` glob (`:3-13`). It locates `Profile.razor` via the map's repo root
    (`:34-38`), asserts the error-summary and password-validation markers are present (`:43-56`), and counts
    at least three `Required="true"` and three `RequiredError` markers for the current/new/confirm password
    fields (`:58-61`).
- **Why it's built this way**: the shared markers cover the standard create forms, and the extra `[Fact]`
  covers the one form whose shape differs, so no UX-safety guard is left un-verified.
- **Where it's used**: ADC architecture-test tier; no database needed.

### FrameworkVersionConsistencyTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9` · Level 10 · class (sealed)

- **What it is**: an evolvability/drift gate. It asserts every `MMCA.Common.*` package pinned in
  `Directory.Packages.props` shares one version, so a partial framework sweep is caught at CI time instead
  of producing a subtly mismatched surface at runtime.
- **Depends on**: the shared
  [`FrameworkVersionConsistencyTestsBase`](#frameworkversionconsistencytestsbase) (extended,
  `FrameworkVersionConsistencyTests.cs:9`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §16, Maintainability]` and `[Rubric §32, Dependency & Supply-Chain]`, the
  lockstep-versioning rule (ADR-016) is made executable here, matching the no-phased-rollout policy
  (`FrameworkVersionConsistencyTests.cs:3-7`).
- **Walkthrough**
  - `Map` (`:11`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### HandlerConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared
  [`HandlerConventionTestsBase`](#handlerconventiontestsbase), which enforces the framework's CQRS
  handler conventions (naming, one-handler-per-request, layer placement).
- **Depends on**: the base (extended, `HandlerConventionTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §6, CQRS & Event-Driven]`, handler shape is pinned once in the base.
- **Walkthrough**
  - `Map` (`HandlerConventionTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### HandlerResultConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/HandlerResultConventionTests.cs:8` · Level 10 · class (sealed)

- **What it is**: a fitness function asserting every ADC command/query handler returns
  [`Result`](group-01-result-error-handling.md#result) or `Result<T>`, turning the decorator pipeline's
  runtime `ResultFailureFactory` constraint into a build-time gate.
- **Depends on**: the shared [`HandlerResultConventionTestsBase`](#handlerresultconventiontestsbase)
  (extended, `HandlerResultConventionTests.cs:8`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §6, CQRS & Event-Driven]`, the Result pattern (taught in
  [group-01](group-01-result-error-handling.md#result)) is the universal handler return; this gate proves
  the pipeline's failure-mapping decorator can wrap every handler
  (`HandlerResultConventionTests.cs:3-7`).
- **Walkthrough**
  - `Map` (`:10`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.
- **Caveats / not-in-source**: labelled an opt-in v1.120.0 fitness function
  (`HandlerResultConventionTests.cs:3-6`).

### ImmutabilityTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared [`ImmutabilityTestsBase`](#immutabilitytestsbase), which
  enforces the framework's immutability conventions (`required`/`init` members, no public setters on value
  objects and messages).
- **Depends on**: the base (extended, `ImmutabilityTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §4, DDD]` and `[Rubric §15, Best Practices & Code Quality]`, immutability of value
  objects and DTOs is pinned by the base.
- **Walkthrough**
  - `Map` (`ImmutabilityTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### IntegrationEventContractTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a frozen-wire-contract guard for the cross-service async API. It pins the exact shape of
  every integration event that crosses the outbox-to-broker boundary, so evolving one is a deliberate,
  reviewed change rather than an accidental break of a downstream consumer.
- **Depends on**: the shared [`IntegrationEventContractTestsBase`](#integrationeventcontracttestsbase)
  (extended, `IntegrationEventContractTests.cs:3`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §7, Microservices Readiness]` and `[Rubric §9, API & Contract Design]`, the
  integration event is the wire contract between services, so a snapshot test protects consumers exactly as
  the outbox pattern (ADR-003) protects delivery.
- **Walkthrough**
  - `ExpectedContract` (`:9-14`): the pinned list, `SpeakerLinkedToUser` and `SpeakerUnlinkedFromUser`
    (`{ SpeakerId:Guid, UserId:Int32 }`) and `UserRegistered`
    (`{ Email, FirstName, LastName, Role:String, UserId:Int32 }`), each with its full property signature.
    The comment records the intent: update deliberately, versioning or coordinating the consumer rollout in
    the same commit (`IntegrationEventContractTests.cs:7-8`).
- **Why it's built this way**: freezing the property signatures (not just the type names) means a renamed or
  retyped field breaks CI, forcing the wire evolution to be conscious.
- **Where it's used**: ADC architecture-test tier; no database needed.

### LayerDependencyTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3` · Level 10 · class (sealed)

- **What it is**: the core Clean Architecture guard. It asserts each layer only depends on the layers it is
  allowed to, using the [`AdcArchitectureMap`](#adcarchitecturemap) topology.
- **Depends on**: the shared [`LayerDependencyTestsBase`](#layerdependencytestsbase) (extended,
  `LayerDependencyTests.cs:3`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §3, Clean Architecture]`, this is the canonical dependency-rule fitness function
  (Domain depends on nothing outward, Infrastructure and Api depend inward), enforced from the map.
- **Walkthrough**
  - `Map` (`LayerDependencyTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### LocalizedTextConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:14` · Level 10 · class (sealed)

- **What it is**: a localized-text convention gate. It asserts user-visible literals are not hard-coded in
  `.razor` / `.razor.cs` under `Source/`, so snackbar messages, page titles, breadcrumb labels, and nav-item
  titles resolve through `IStringLocalizer` resources instead.
- **Depends on**: the shared [`LocalizedTextConventionTestsBase`](#localizedtextconventiontestsbase)
  (extended, `LocalizedTextConventionTests.cs:14`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §27, i18n]`, this is the source-code companion to
  [`TranslationCompletenessTests`](#translationcompletenesstests): that one checks resx parity, this one
  checks that visible strings actually route through resources (ADR-027,
  `LocalizedTextConventionTests.cs:3-13`). Deliberate literals (the conference brand name, content data)
  are exempted per line with an `i18n: allow` marker.
- **Walkthrough**
  - `MinimumScannedFiles` (`:18`): `60`, the non-vacuous floor, ADC has about 77 razor files, so a near-zero
    discovery count means the scan path drifted.
- **Where it's used**: ADC architecture-test tier; no database needed.

### MicroserviceExtractionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared
  [`MicroserviceExtractionTestsBase`](#microserviceextractiontestsbase), which asserts each module stays
  independently extractable (no cross-module domain references, communication only through interfaces).
- **Depends on**: the base (extended, `MicroserviceExtractionTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §7, Microservices Readiness]`, this guard keeps the modular-monolith-to-services
  path (ADRs 007/008) real, which matters especially for ADC because its modules are already extracted into
  separate service hosts.
- **Walkthrough**
  - `Map` (`MicroserviceExtractionTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### ModuleIsolationTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared [`ModuleIsolationTestsBase`](#moduleisolationtestsbase),
  which asserts one module's internals are not referenced by another module directly.
- **Depends on**: the base (extended, `ModuleIsolationTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §7, Microservices Readiness]`, module isolation is the companion rule to
  extraction, taught alongside the module system in [group-14](group-14-module-system-composition.md).
- **Walkthrough**
  - `Map` (`ModuleIsolationTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### NamingConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared [`NamingConventionTestsBase`](#namingconventiontestsbase),
  which enforces the framework's type-naming conventions (commands, queries, handlers, DTOs, specifications).
- **Depends on**: the base (extended, `NamingConventionTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §15, Best Practices & Code Quality]`, consistent naming is what lets the other
  convention tests target types by suffix.
- **Walkthrough**
  - `Map` (`NamingConventionTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### PiiConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared [`PiiConventionTestsBase`](#piiconventiontestsbase),
  which asserts personal-data fields carry the framework's `PiiAttribute` so erasure and export can find
  them.
- **Depends on**: the base (extended, `PiiConventionTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §30, Compliance/Privacy/Data Governance]`, the `PiiAttribute` / soft-delete-vs-erasure
  model (ADR-005) is pinned by the base so no PII field goes unmarked.
- **Walkthrough**
  - `Map` (`PiiConventionTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### RawQueryableConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/RawQueryableConventionTests.cs:11` · Level 10 · class (sealed)

- **What it is**: a fitness function that forbids Application-layer code from using the repository's raw
  `IQueryable` surfaces (`Table` / `TableNoTracking*`), because raw-queryable handlers are EF-coupled and
  cannot move behind a gRPC boundary. An allowlist pins ADC's existing deliberate uses so only new code is
  blocked.
- **Depends on**: the shared [`RawQueryableConventionTestsBase`](#rawqueryableconventiontestsbase) (extended,
  `RawQueryableConventionTests.cs:11`), [`AdcArchitectureMap`](#adcarchitecturemap), and `System.IO`.
- **Concept**: `[Rubric §7, Microservices Readiness]`, keeping handlers off raw EF surfaces is what lets a
  module later be served over gRPC; the allowlist is an adoption ratchet, meant to shrink over time and
  never grow without scrutiny (`RawQueryableConventionTests.cs:3-9`).
- **Walkthrough**
  - `ApplicationSourceDirectories` (`:21-30`): overrides the base enumeration to also include the thin
    Notification module's Application project (which the map does not declare), so it falls under the same
    rule (`:15-20`).
  - `AllowedFiles` (`:33-52`): the pinned exemptions, Engagement live-layer hot-path aggregations, bookmark
    count/projection queries, the Identity user-list paging projection, and the Notification GDPR export
    join, each annotated with why it is intra-module and safe.
- **Why it's built this way**: an allowlist rather than a blanket ban lets the rule land against an existing
  codebase while still blocking new raw-queryable handlers.
- **Where it's used**: ADC architecture-test tier; no database needed.
- **Caveats / not-in-source**: labelled an opt-in v1.120.0 fitness function
  (`RawQueryableConventionTests.cs:3-6`).

### SharedLayerTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:3` · Level 10 · class (sealed)

- **What it is**: a thin ADC binding of the shared [`SharedLayerTestsBase`](#sharedlayertestsbase), which
  asserts the Shared layer holds only contracts (DTOs, integration events, interfaces) and no
  implementation or infrastructure.
- **Depends on**: the base (extended, `SharedLayerTests.cs:3`) and
  [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §3, Clean Architecture]`, the Shared layer is the module's public contract surface;
  the base keeps it thin so cross-module references stay contract-only.
- **Walkthrough**
  - `Map` (`SharedLayerTests.cs:5`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### SliceCohesionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:8` · Level 10 · class (sealed)

- **What it is**: a vertical-slice cohesion guard. It asserts every module's
  `Application/{Aggregate}/UseCases/{Operation}/` slice keeps its command or query, its handler, and its
  validator in one namespace, so a handler cannot be stranded from its contract.
- **Depends on**: the shared [`SliceCohesionTestsBase`](#slicecohesiontestsbase) (extended,
  `SliceCohesionTests.cs:8`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §5, Vertical Slice]`, slice cohesion is the physical expression of the
  organize-by-feature principle; the base pins the folder-to-namespace shape
  (`SliceCohesionTests.cs:3-7`).
- **Walkthrough**
  - `Map` (`:10`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### SpecificationConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8` · Level 10 · class (sealed)

- **What it is**: a cross-source specification guard. It asserts no specification filters by navigating to
  another entity (which would not translate if that entity later moved to a different data source),
  steering such filters onto [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification)
  instead.
- **Depends on**: the shared [`SpecificationConventionTestsBase`](#specificationconventiontestsbase)
  (extended, `SpecificationConventionTests.cs:8`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §8, Data Architecture]`, this keeps the polyglot-persistence extension point (ADR-018) usable.
  The comment records that ADC's Session-to-Cosmos / Room-to-SQLite trial was reverted but the framework
  extension points were kept, so this guard stays on as a forward safeguard even though every entity currently routes
  to SQL Server (`SpecificationConventionTests.cs:3-7`).
- **Walkthrough**
  - `Map` (`:10`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### StateManagementConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:9` · Level 10 · class (sealed)

- **What it is**: a state-management convention guard. It asserts the module UI assemblies carry no mutable
  static state (a static member is shared across every Blazor Server circuit) and that stateful UI services
  stay scoped, so the per-circuit state model is CI-enforced.
- **Depends on**: the shared [`StateManagementConventionTestsBase`](#statemanagementconventiontestsbase)
  (extended, `StateManagementConventionTests.cs:9`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §19, State Management]`, in Blazor Server a static field leaks state across users,
  so the base pins the scoped-per-circuit model (`StateManagementConventionTests.cs:3-8`).
- **Walkthrough**
  - `Map` (`:11`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### UIArchitectureConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:10` · Level 10 · class (sealed)

- **What it is**: a UI-architecture convention guard. It asserts every code-behind under `Source/` stays
  within the 400-line convention cap and inline `@code` blocks stay small, so the
  container/presentational split is enforced by CI rather than by review.
- **Depends on**: the shared [`UIArchitectureConventionTestsBase`](#uiarchitectureconventiontestsbase)
  (extended, `UIArchitectureConventionTests.cs:10`) and [`AdcArchitectureMap`](#adcarchitecturemap).
- **Concept**: `[Rubric §18, UI Architecture]`, the size cap is a proxy for keeping presentation thin and
  logic in services; the comment notes this gate subsumed TD-13 (the oversized Conference dashboards were
  split to conform when it landed, `UIArchitectureConventionTests.cs:3-9`).
- **Walkthrough**
  - `Map` (`:12`): the only override.
- **Where it's used**: ADC architecture-test tier; no database needed.

### EntityBuilderBase<TBuilder, TEntity>
> MMCA.Common.Testing · `MMCA.Common.Testing.Builders` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9` · Level 0 · class (abstract)

- **What it is**: the tiny root of the framework's fluent test-data builders. A subclass fixes sensible
  defaults for one entity type so a test only has to state the properties it actually cares about, then
  calls `Build()` to materialize the entity through its real domain factory.
- **Depends on**: nothing first-party. Two type parameters and one abstract method, no BCL surface
  beyond `object`.
- **Concept introduced, the Test Data Builder + self-referencing generic (CRTP).** `[Rubric §14,
  Testability]` assesses how easily the code can be exercised in isolation; a builder base is a
  textbook §14 affordance, it removes the copy-pasted setup that otherwise bloats every arrange step.
  The signature `EntityBuilderBase<TBuilder, TEntity> where TBuilder : EntityBuilderBase<TBuilder,
  TEntity>` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9-10`) is the
  curiously-recurring template pattern: a concrete builder passes *itself* as `TBuilder`, so the
  `WithX(...)` methods a subclass adds can return the concrete builder type and keep a fluent chain
  strongly typed without a cast.
- **Walkthrough**
  - `Build()` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Builders/EntityBuilderBase.cs:17`): the
    single abstract member. The XML doc
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Builders/EntityBuilderBase.cs:12-15`) records the
    contract, the subclass calls the entity's
    [`Result`](group-01-result-error-handling.md#result)-returning factory and throws if it failed, so
    a builder never yields a domain object that violated its invariants. The base deliberately owns no
    state and no default `WithX` helpers, those live on each concrete builder because defaults are
    per-entity.
- **Why it's built this way**: keeping the base to one abstract method means it adds zero coupling and
  zero opinions beyond "a builder produces a `TEntity`". The CRTP is the only structural rule it
  enforces, and it exists purely so fluent chaining stays type-safe down in the subclasses.
- **Where it's used**: subclassed in each downstream test project's builders (per module), consumed by
  the integration and domain tests that need pre-populated aggregates.
- **Caveats / not-in-source**: the "throws on failure" and "sensible defaults" behavior is documented
  on the base but implemented only in subclasses, which live outside this unit.

### FeatureManagementTestExtensions
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10` · Level 0 · class (static)

- **What it is**: a one-method helper that lets an integration-test host force feature-flag values,
  overriding whatever `appsettings.json` would otherwise resolve, so a test can pin a flag on or off
  and assert both branches of a feature-gated command or query.
- **Depends on**: BCL / NuGet only, `IServiceCollection` and `IConfiguration`
  (`Microsoft.Extensions.*`) plus `AddFeatureManagement` from `Microsoft.FeatureManagement`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:1-3`). No
  first-party dependency.
- **Concept**: this is the test-side counterpart to the framework's
  [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult),
  the outermost link in the CQRS pipeline (taught in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)). `[Rubric §14,
  Testability]` again: a gated handler is only meaningfully testable if a test can flip its flag
  deterministically; `[Rubric §10, Cross-Cutting]` applies too, feature management is a cross-cutting
  concern, and this helper keeps its test-time configuration in one reusable place.
- **Walkthrough**
  - The whole class body is a single C# preview `extension(IServiceCollection services)` block
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:12`), the same
    extension-member style the framework uses for DI registration, not a classic `this`-parameter
    extension method.
  - `ConfigureTestFeatureFlags(Dictionary<string, bool> features)`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:21-35`):
    projects each `name -> bool` pair into an in-memory configuration key under the
    `FeatureManagement:` section
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:24-29`),
    registers that `IConfiguration` as a singleton, calls `AddFeatureManagement` against the section
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:31-32`), and
    returns the collection for chaining.
- **Why it's built this way**: pushing overrides through the real `IConfiguration` + `AddFeatureManagement`
  path (rather than mocking an `IFeatureManager`) means the test exercises the same feature-evaluation
  code the production host runs, only the source of the flag value changes.
- **Where it's used**: called from a test `WebApplicationFactory`'s `ConfigureServices` in downstream
  integration-test fixtures that need to toggle a gated slice.

### IIntegrationTestFixture
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/IIntegrationTestFixture.cs:8` · Level 0 · interface

- **What it is**: the contract every integration-test fixture implements, the two capabilities a test
  base needs from a booted host: hand me an `HttpClient`, and reset the database to clean between
  tests.
- **Depends on**: BCL only (`HttpClient`, `Task`). No first-party dependency, which is what lets it sit
  at Level 0 and be referenced by the test base above it.
- **Concept introduced, the test fixture as an abstraction boundary.** `[Rubric §14, Testability]`:
  by depending on this interface rather than a concrete `WebApplicationFactory`, the reusable
  [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) stays host-agnostic, each downstream
  app supplies its own concrete fixture with its own `Program`, JWT keys, and data sources. This is
  the boundary that keeps the shared test scaffolding in `MMCA.Common.Testing` and the app-specific
  wiring in each repo.
- **Walkthrough**
  - `CreateClient()` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IIntegrationTestFixture.cs:11`):
    returns an `HttpClient` configured for the in-process test server.
  - `ResetDatabaseAsync()`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IIntegrationTestFixture.cs:19`): resets the
    database between tests (the doc names Respawn as the typical mechanism). The doc comment
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IIntegrationTestFixture.cs:13-18`) records a
    load-bearing rule for the database-per-service topology (ADR-006): a host with multiple physical
    data sources must reset **every** relational source, and can enumerate them by resolving
    `IEntityDataSourceRegistry` / `IDataSourceResolver` from the host's services.
- **Why it's built this way**: two members, no state, no host coupling. The interface is deliberately
  minimal so that the reset strategy (single database vs. multi-source) is the fixture's problem, not
  the base's.
- **Where it's used**: implemented by [`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint)
  and by each app's concrete fixtures; consumed as the `TFixture` constraint on
  [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) and every contract test base in this
  group.

### JwtTokenGenerator
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:29` · Level 0 · class (static)

- **What it is**: a static factory that mints signed JWT bearer tokens for integration tests, so a test
  can call an authorized endpoint as any role/user without standing up the real login flow. Each
  downstream project wraps it with role-specific convenience methods (AdminToken, OrganizerToken, ...).
- **Depends on**: BCL / NuGet only, `System.IdentityModel.Tokens.Jwt`, `System.Security.Claims`,
  `System.Security.Cryptography` (RSA), and `Microsoft.IdentityModel.Tokens`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:1-5`). The generated claim
  layout mirrors the framework's [`ITokenService`](group-08-auth.md#itokenservice) so downstream auth
  middleware cannot tell a test token from a real one
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:97-102`). The `userId`
  parameter is typed `UserIdentifierType`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:113`), the solution-wide
  identifier alias.
- **Concept introduced, exercising the real RS256/JWKS path in tests.** `[Rubric §11, Security]`
  assesses how authentication and key handling are done; the deliberate choice here is that tests sign
  with **RS256** (`SecurityAlgorithms.RsaSha256`,
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:130`) using an embedded RSA-2048
  dev keypair, the *same* asymmetric algorithm production uses, so integration tests run the identical
  JWKS/RS256 validation code path (ADR-004 authentication dual-fetch, taught in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) rather than a weaker HMAC
  shortcut. `[Rubric §14, Testability]` covers the ergonomics: deterministic tokens with no per-run
  key generation.
- **Walkthrough**
  - Public constants (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:32-95`):
    `DefaultIssuer` (`https://localhost:6001`, line 32), `DefaultKeyId` (`mmca-test-key`, line 40, the
    `kid` the host advertises on its JWKS document), and the paired `DefaultPublicKeyPem` (line 48) /
    `DefaultPrivateKeyPem` (line 67). The class doc records the wiring contract: test host appsettings
    set `Jwt:SigningAlgorithm=RS256`, `Jwt:RsaPublicKeyPem`, and `Jwks:KeyId` (lines 17-19) so
    [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) publishes a JWKS entry with the matching
    `kid`.
  - `GenerateToken(...)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:111-152`):
    imports the PEM private key into `RSAParameters` inside a `using` so the `RSA` instance can be
    disposed without invalidating the key held by `SigningCredentials` (lines 120-130), assembles the
    standard claim set (`ClaimTypes.NameIdentifier`, `user_id`, `ClaimTypes.Role`) plus any
    caller-supplied extras (lines 132-142), and writes a one-hour token (lines 144-151). Defaulted
    parameters mean a caller normally passes only audience, user id, and role (lines 112-118).
- **Why it's built this way**: the whole point is fidelity, tokens are indistinguishable in shape and
  signing algorithm from production, so auth middleware, JWKS discovery, and role checks are all under
  test, not stubbed.
- **Where it's used**: called by [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture)
  subclasses via `SetBearerToken(...)`, wrapped by each app's role-specific token helpers.
- **Caveats / not-in-source**: the class doc
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:21-27`) carries an explicit
  security warning, the embedded keypair is committed to the public git repo and is insecure by design,
  it exists only to make integration tests deterministic. Production keys are provisioned via
  user-secrets / Azure Key Vault per `JwtSettings.RsaPrivateKeyPem` and must never be this keypair.

### SecurityHeadersTestsBase
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/SecurityHeadersTestsBase.cs:16` · Level 0 · class (abstract)

- **What it is**: a one-test fitness base that asserts a booted host emits the hardened set of security
  response headers on every response, so a later pipeline refactor cannot silently drop them. Authored
  once, re-run as a thin subclass per host under test.
- **Depends on**: `AwesomeAssertions` and `Xunit`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SecurityHeadersTestsBase.cs:1-2`). It does not
  extend the integration base, it only needs an `HttpClient`, so it takes one via an abstract factory
  rather than inheriting the SQL fixture machinery.
- **Concept**: a security fitness test. `[Rubric §11, Security]` assesses defense-in-depth at the HTTP
  edge; this test pins the exact header values the shared `AddCommonSecurityHeaders` /
  `UseCommonSecurityHeaders` middleware (see
  [`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware)) is
  expected to emit. `[Rubric §14, Testability]` covers the reusable-base shape.
- **Walkthrough**
  - `ProbePath` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SecurityHeadersTestsBase.cs:19`):
    overridable, defaults to `/alive` because the liveness endpoint always answers independent of any
    backend being reachable, so the header check is never flaky for the wrong reason (rationale in the
    class doc, lines 12-14).
  - `AliveResponse_CarriesHardenedSecurityHeaders`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SecurityHeadersTestsBase.cs:21-36`): the single
    `[Fact]`. It GETs `ProbePath` (lines 26-27, threading `TestContext.Current.CancellationToken`) and
    asserts `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
    strict-origin-when-cross-origin`, a `Permissions-Policy` containing `geolocation=()`, a
    `Content-Security-Policy` containing `frame-ancestors 'none'`, and (because the host under test
    boots in the Production environment) an HSTS `Strict-Transport-Security` header with a `max-age=`
    (lines 29-35).
  - `CreateClient()` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SecurityHeadersTestsBase.cs:42`):
    abstract, the subclass supplies it from its `WebApplicationFactory` class fixture. `Header(...)`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SecurityHeadersTestsBase.cs:44-45`) is the private
    helper that joins a header's values or returns null when the header is absent.
- **Why it's built this way**: pinning literal header values (not just presence) turns "we harden
  responses" into an executable, per-host guarantee, and probing `/alive` keeps the test independent of
  application state. Booting the subclass fixture in Production is what makes the HSTS assertion valid.
- **Where it's used**: subclassed by each host's security-header fitness test (typically the gateway).

### DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:36` · Level 1 · class (abstract)

- **What it is**: an opt-in fitness base that builds a real `ServiceCollection` through a repo's own
  registration sequence, resolves the decorated command and query handlers out of the built provider,
  and asserts the *runtime object graph* nests the decorators in exactly the ADR-014 order.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
  and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult)
  from `MMCA.Common.Application.UseCases`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:4`), plus
  `System.Reflection`, `Microsoft.Extensions.DependencyInjection`, `AwesomeAssertions`, and `Xunit`
  (lines 1-5).
- **Concept introduced, verifying a decorator chain by unwrapping the constructed graph.** The
  decorator pipeline itself is taught in
  [group-05](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult); what is new here is
  *how you prove it*. Scrutor's `TryDecorate` applies decorators in **reverse registration order**, so
  the outermost decorator is the last one registered, and an innocent-looking reorder of the
  `AddApplicationDecorators()` lines (or a module scan that runs after it) silently changes runtime
  behavior with no compile error (class doc, lines 15-18). Rather than inspecting the registration
  list, this base resolves the service and walks the real chain by reflection (lines 27-30).
  `[Rubric §6, CQRS & Event-Driven]` assesses whether the command/query pipeline is coherent and
  intentional; `[Rubric §2, Design Patterns]` assesses correct application of the decorator pattern;
  `[Rubric §14, Testability]` covers turning an ordering convention into an executable check; and
  `[Rubric §34, Architecture Governance]` covers the fact that a decision record (ADR-014) is enforced
  here rather than merely written down.
- **Walkthrough**
  - Four type parameters (lines 32-35): a representative command with its `TResult` and a
    representative query with its `TResult`, each of which must have a concrete registered handler.
  - `ConfigureServices(IServiceCollection services)`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:44`): the one
    abstract member. The subclass registers test doubles for the decorator dependencies
    (`IFeatureManager`, `ICorrelationContext`, `ICacheService`, `IUnitOfWork`, `ILogger<>`) and then
    runs the repo's real registration sequence, module scans first and `AddApplicationDecorators()`
    last (doc lines 19-26).
  - `ExpectedCommandDecorators` (lines 47-54) pins, outermost first, `FeatureGateCommandDecorator`,
    `LoggingCommandDecorator`, `CachingCommandDecorator`, `ValidatingCommandDecorator`,
    `TransactionalCommandDecorator`. `ExpectedQueryDecorators` (lines 57-62) pins
    `FeatureGateQueryDecorator`, `LoggingQueryDecorator`, `CachingQueryDecorator`, the query pipeline
    having neither validation nor a transaction. Both are `virtual`, so a host with a deliberately
    different chain can narrow them.
  - The two `[Fact]`s, `CommandPipeline_NestsDecorators_InAdr014Order` (lines 64-66) and
    `QueryPipeline_NestsDecorators_InAdr014Order` (lines 68-70), each hand the closed handler interface
    and the expected list to `AssertPipeline`.
  - `AssertPipeline` (lines 72-91): builds the collection, builds a provider, opens a scope (handlers
    are scoped), resolves the outermost handler and asserts it is non-null with a message that tells
    the subclass author what is missing (lines 80-82). It then unwraps the chain, maps each link to a
    simple type name, and asserts every element *except the last* equals the expected decorator list in
    order (lines 84-87), finally asserting the innermost element does **not** end in `Decorator`, that
    is, it is the concrete handler (lines 89-90).
  - `UnwrapChain` (lines 98-118): walks outermost to innermost by reflecting over each object's
    instance fields (public and non-public) and picking the first value that implements the same closed
    handler interface and is not the object itself (lines 105-108), which is how it finds the
    compiler-generated backing field holding the inner handler. `SimpleTypeName` (lines 120-125) strips
    the generic-arity backtick suffix so a two-arity `LoggingCommandDecorator` compares as the plain
    name.
- **Why it's built this way**: asserting the constructed object graph is strictly stronger than
  asserting the registration list, it catches a decorator that was registered but never applied (for
  example because a module scan re-registered the handler afterwards). Comparing simple type names
  keeps the base free of a compile-time reference to the decorator classes, which live in
  `MMCA.Common.Application`.
- **Where it's used**: opt-in, a repo subclasses it once with one representative command/query pair
  and its own registration sequence.
- **Caveats / not-in-source**: the base ships in the package, but which repos have subclassed it is not
  determinable from this file.

### IntegrationTestBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:13` · Level 1 · class (abstract)

- **What it is**: the workhorse base class every integration test inherits. It owns the per-test HTTP
  client and lifecycle, typed request helpers, bearer-token management, and a thread-safe id counter,
  so a concrete test class is left with just its arrange/act/assert.
- **Depends on**: [`IIntegrationTestFixture`](#iintegrationtestfixture) (the `TFixture` constraint,
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:14`), plus `Xunit`'s
  `IAsyncLifetime` and `System.Net.Http.Json`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:1-3`).
- **Concept introduced, the xUnit async test lifecycle + per-test isolation.** `[Rubric §14,
  Testability]`: the base implements `IAsyncLifetime` so `InitializeAsync` runs **before each test** and
  `DisposeAsync` **after**, and it hangs the database reset off that hook so every test starts from a
  clean database, the single most important property for reliable integration tests.
- **Walkthrough**
  - Fields / properties: a `static int _nextId = 1000` seed
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:16`), and the `Fixture` /
    `Client` protected properties (lines 19-22).
  - Constructor (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:24-28`): stores
    the injected fixture and eagerly creates the `HttpClient` from it.
  - `InitializeAsync` (line 31): a `ValueTask` that awaits `Fixture.ResetDatabaseAsync()` before each
    test. `DisposeAsync` (lines 34-39): suppresses finalization and disposes the client.
  - Auth helpers: `SetBearerToken(string)` / `ClearAuthentication()` (lines 42-48) set or clear the
    `Authorization` header, the hook through which a
    [`JwtTokenGenerator`](#jwttokengenerator) token is applied.
  - Typed HTTP helpers: `GetAsync<T>` (lines 51-56, which calls `EnsureSuccessStatusCode` then
    deserializes), and `PostAsync<T>` / `PutAsync<T>` / `PutAsync` / `DeleteAsync` (lines 59-72)
    returning the raw `HttpResponseMessage` so a test can assert status codes.
  - `NextId()` (line 75): `Interlocked.Increment` over the shared seed, so parallel tests never collide
    on generated ids.
- **Why it's built this way**: per-test database reset plus a per-test client is the isolation contract;
  centralizing the typed helpers keeps individual tests short and consistent. The static
  `Interlocked` counter is the cheapest safe way to hand out unique ids under xUnit's parallelism.
- **Where it's used**: the direct base of all three contract test bases below, and of every concrete
  integration test in the downstream apps.

### SqlServerIntegrationTestFixtureBase<TEntryPoint>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27` · Level 1 · class (abstract)

- **What it is**: the reusable fixture that boots a real service host in-process against a **throwaway
  SQL Server database**, applies the module's migrations on first start, resets data between tests with
  Respawn, and drops the database on disposal. It is the concrete engine behind
  [`IIntegrationTestFixture`](#iintegrationtestfixture) for SQL Server hosts.
- **Depends on**: [`IIntegrationTestFixture`](#iintegrationtestfixture) (implemented, line 27), plus
  `Microsoft.AspNetCore.Mvc.Testing` (`WebApplicationFactory`), `Microsoft.Data.SqlClient`, `Respawn`,
  and `Xunit`'s `IAsyncLifetime`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:1-4`).
- **Concept introduced, the disposable-database integration fixture + environment-variable overrides.**
  `[Rubric §14, Testability]` and `[Rubric §8, Data Architecture]`: real integration coverage needs a
  real relational database, and this fixture makes that cheap and hermetic, a fresh GUID-named database
  per fixture, migrated from scratch, Respawned between tests, dropped at the end. The
  database-per-service routing (ADR-006) is why the class doc stresses the `DataSources` collapse onto a
  single overridden connection string (lines 16-24).
- **Walkthrough**
  - State (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:30-45`):
    the recorded original-environment map, the server-base / database-name strings, the
    `WebApplicationFactory`, the `Respawner`, a `_databaseCreated` flag, and the public `Client` /
    `ConnectionString`. `ConnectionString` (line 45) is exposed so SQL-fidelity tests can read raw
    tables (for example to assert an integration event landed in the outbox).
  - `Services` (line 52): the booted host's root service provider, exposed so cross-service tests can
    resolve a consumer-side `IIntegrationEventHandler<T>` or a repository and drive the
    integration-event flow directly against the real database.
  - Abstract knobs: `SqlBaseEnvironmentVariable` (line 58, names the env var holding the CI SQL base
    connection string), `DatabaseNamePrefix` (line 61), and `CreateFactory()` (line 134, where the
    subclass builds the host). `CreateClient()` (line 64) satisfies the interface by delegating to the
    factory.
  - `InitializeAsync` (lines 67-96): resolves the server base from `SqlBaseEnvironmentVariable` or falls
    back to LocalDB (lines 69-70), composes a GUID-suffixed database name and connection string (lines
    71-72), forces `ASPNETCORE_ENVIRONMENT=Testing` and pushes the top-level SQL connection string as
    environment variables (lines 75-76), lets the subclass push its own via `ConfigureTestEnvironment`
    (line 77), and builds the factory (line 79); creating the client is what triggers the host's
    `Migrate` init to create the database and apply the module's migrations (lines 81-84). It then
    builds the `Respawner`, ignoring `__EFMigrationsHistory` (lines 86-95).
  - `ResetDatabaseAsync` (lines 99-112): returns immediately when no respawner exists, otherwise opens a
    connection and calls `Respawner.ResetAsync`.
  - `DisposeAsync` (lines 115-131): disposes client and factory, drops the database when one was
    created, and restores the environment.
  - `ConfigureTestEnvironment` (lines 142-144) is an empty `virtual` hook receiving the setter delegate.
    `SetEnvironmentVariable` (lines 146-155) records only the **first** original value per key so
    re-pushing a key cannot clobber the restore point; `RestoreEnvironment` (lines 157-165) puts them
    all back and clears the map.
  - `DropDatabaseAsync` (lines 167-188): clears pooled connections so the database is free to drop (line
    170), connects to `master`, and runs a guarded `SET SINGLE_USER WITH ROLLBACK IMMEDIATE` +
    `DROP DATABASE` (lines 180-183), with a scoped `CA2100` suppression justified because the database
    name is a server-generated GUID, never user input (line 179).
- **Why it's built this way**: overrides go through process environment variables because the host reads
  its connection string at configure-time; forcing the `Testing` environment skips
  `appsettings.Development.json` (which would point `DataSources` at `localhost`) so the resolver
  collapses onto the single overridden top-level connection string, making the fixture behave like a
  clean single-database monolith. LocalDB-by-default keeps local runs zero-config while CI can point at
  a SQL service container.
- **Where it's used**: the base of each app's per-service integration fixture (Identity / Conference /
  Engagement and equivalents), which is then the `TFixture` for that service's integration and contract
  tests.
- **Caveats / not-in-source**: the fixture needs a reachable SQL Server, so it builds but does not run
  without one; these suites run in CI's SQL-service job.

### OpenApiContractTestsBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/OpenApiContractTestsBase.cs:21` · Level 2 · class (abstract)

- **What it is**: a contract fitness base that boots a host and asserts its `/openapi/v1.json` document
  is served, is a well-formed OpenAPI 3.x document, and still describes the core public resources, so an
  accidental controller/route removal fails CI instead of silently changing the published contract.
- **Depends on**: [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) (inherited,
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing/OpenApiContractTestsBase.cs:21`), `System.Net`,
  `System.Text.Json`, `AwesomeAssertions`, `Xunit` (lines 1-4).
- **Concept introduced, the contract guard on the live document.** `[Rubric §9, API & Contract
  Design]` assesses whether the API surface is described and kept stable; the pattern across all three
  Level 2 bases is a **live-document guard with no committed snapshot**
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/OpenApiContractTestsBase.cs:14-16`), the assertions
  run against the document the host actually serves, so new controllers can never leave a stale
  snapshot behind and a removed one is caught immediately.
- **Walkthrough**
  - Overridable / abstract knobs: `OpenApiDocumentPath` (line 30, defaults to `/openapi/v1.json`),
    `MinimumPathCount` (line 37, a coarse floor under the route surface), `MinimumPathCountBecause`
    (line 44, the failure-message reason), and `CorePublicResources` (line 50, the resource paths that
    must keep being described).
  - `OpenApiDocument_IsServed_AsWellFormedOpenApiDescribingTheApiSurface` (lines 52-65): parses the JSON
    and asserts `openapi` starts with `3.`, `info.title` is non-empty, a `paths` object exists, and it
    holds at least `MinimumPathCount` entries.
  - `OpenApiDocument_DescribesEveryCorePublicResource` (lines 67-85): first guards against a vacuous
    pass (the subclass must pin at least one resource, lines 70-71), then checks every
    `CorePublicResources` entry is present, matching on name case-insensitively (lines 77-80) so
    presence, not exact casing, is the contract.
  - `GetOpenApiJsonAsync` (lines 91-100): clears auth (the document is anonymous outside Production),
    fetches the path, asserts 200, and returns the raw JSON.
- **Why it's built this way**: asserting the live document (rather than diffing a checked-in snapshot)
  keeps the guard maintenance-free while still catching the two failures that matter, the document
  disappearing and a public resource vanishing.
- **Where it's used**: subclassed once per service host (`OpenApiContractTests` in each app), supplying
  the fixture, the path floor, and the pinned resource list.

### ProblemDetailsContractTestsBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ProblemDetailsContractTestsBase.cs:21` · Level 2 · class (abstract)

- **What it is**: a contract fitness base that asserts a host's error responses are RFC 9457 Problem
  Details documents, machine-readable bodies carrying `status`, `title`, and a diagnostic extension,
  across both error-shaping paths the framework uses.
- **Depends on**: [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) (inherited,
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ProblemDetailsContractTestsBase.cs:21`), `System.Net`,
  `System.Net.Http.Json`, `System.Text.Json`, `AwesomeAssertions`, `Xunit` (lines 1-5). Same live-guard
  shape as the OpenAPI base above.
- **Concept**: still `[Rubric §9, API & Contract Design]`, here the pinned contract is the **error
  shape**. The class covers the two distinct paths that produce errors (class doc, lines 10-18):
  ASP.NET Core model validation (a 400 `application/problem+json` body) and the framework's
  `HandleFailure` `Result`-error mapping (see
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)), which turns a
  [`Result`](group-01-result-error-handling.md#result) failure such as an
  [`Error`](group-01-result-error-handling.md#error) not-found into a 404 problem.
- **Walkthrough**
  - `Validation_400_HasProblemDetailsShape` (lines 29-39): sends the subclass's validation probe,
    asserts the shared shape at 400, then checks the `problem+json` content type and the
    model-validation-only extensions `type`, `traceId`, and `errors`.
  - `NotFound_404_HasProblemDetailsShape` (lines 41-47): sends the 404 probe and asserts the shared
    shape.
  - Abstract probes: `SendValidationErrorProbeAsync` (line 54) and `SendNotFoundProbeAsync` (line 60),
    the only app-specific pieces, authenticating first when the endpoint requires it.
  - `AssertProblemDetailsShapeAsync` (lines 67-83): the shared `protected static` assertion, JSON
    content type, echoed `status`, non-empty `title`, and at least one diagnostic extension (`errors`,
    `traceId`, or `requestId`), returning the parsed body so a subclass can follow up (for example a
    host with a reachable 409-conflict path adds its own conflict test reusing this helper, doc lines
    16-18).
- **Why it's built this way**: pinning both the validation path and the `HandleFailure` path in one base
  means a regression in either error channel breaks CI, and factoring the shape assertion into a shared
  static keeps every host's error contract identical.
- **Where it's used**: subclassed as `ProblemDetailsContractTests` per host, plus per-host conflict tests
  layered on `AssertProblemDetailsShapeAsync`.

### ServiceInfoVersioningContractTestsBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19` · Level 2 · class (abstract)

- **What it is**: a contract fitness base that proves the API-versioning machinery actually works across
  more than one version, that `/ServiceInfo` is served by both v1.0 (deprecated) and v2.0, selected by
  the `api-version` header, and that the host reports supported/deprecated versions in response
  headers.
- **Depends on**: [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) (inherited,
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19`),
  `System.Net`, `System.Text.Json`, `AwesomeAssertions`, `Xunit` (lines 1-4).
- **Concept**: `[Rubric §9, API & Contract Design]` again, the versioning axis. The class doc
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:8-17`)
  makes the point that without a second working version the whole versioning story would be untestable,
  so this base keeps the machinery *exercised* rather than merely asserted. Because the `ServiceInfo`
  controller ships in `MMCA.Common.API`
  ([`ServiceInfoControllerBase`](group-12-api-hosting-mapping.md#serviceinfocontrollerbase)), the entire
  test body is identical across repos; a subclass supplies only its fixture.
- **Walkthrough**
  - `ServiceInfo_V1_ReturnsMinimalShape_AndIsReportedDeprecated` (lines 27-41): requests v1.0, asserts
    200, checks `apiVersion == "1.0"` and that the evolved `supportedVersions` list is **absent** in the
    v1 shape (lines 35-36), then asserts an `api-deprecated-versions` response header contains `1.0`
    (lines 38-40).
  - `ServiceInfo_V2_ReturnsEvolvedShape_AndIsReportedSupported` (lines 43-57): requests v2.0, asserts
    200, checks `apiVersion == "2.0"` and that `supportedVersions` contains `2.0` (lines 50-52), then
    asserts an `api-supported-versions` header advertises `2.0` (lines 54-56).
  - `GetServiceInfoAsync(string apiVersion)` (lines 59-65): clears auth and sends the GET with the
    `api-version` header set to the requested version.
- **Why it's built this way**: keeping a real deprecated v1 and a real v2 side by side, and asserting both
  the payload shapes and the `ReportApiVersions` headers, is what proves version negotiation is wired
  end to end rather than configured and forgotten.
- **Where it's used**: subclassed per host as the service-info versioning fitness test, fixture only.

### HandlerTestBase<THandler>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/HandlerTestBase.cs:38` · Level 9 · class (abstract)

- **What it is**: the reusable Moq scaffold for command/query handler **unit** tests. It hands a derived
  test class a pre-configured `Mock<IUnitOfWork>`, a no-op logger typed to the handler under test, and
  two one-line helpers that register a repository mock into that unit of work.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype),
  [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype),
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the two generic constraints), plus `Moq`, `Microsoft.Extensions.Logging`, and `NullLogger<T>`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/HandlerTestBase.cs:1-5`).
- **Concept**: *the arrange-phase base class.* Where
  [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) gives an end-to-end test a booted host,
  this gives an isolated unit test a mocked persistence boundary: no database, no host, no HTTP. The
  class doc (lines 10-12) frames it as the shared replacement for the per-test copy-paste of
  `Mock<IUnitOfWork>` + `GetRepository` wiring + `SaveChangesAsync` setup. `[Rubric §14, Testability]`
  assesses whether the design permits fast isolated tests; the fact that handlers depend on
  `IUnitOfWork` (an Application-layer abstraction) rather than a `DbContext` is what makes this scaffold
  possible at all, which is `[Rubric §3, Clean Architecture]` paying off in the test tier. `[Rubric §16,
  Maintainability]` covers the deduplication itself.
- **Walkthrough**
  - Constructor (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/HandlerTestBase.cs:41-42`): a single
    expression-bodied statement that pre-configures `UnitOfWork.SaveChangesAsync(...)` to return `1`,
    the success path, so a happy-path test writes no persistence setup at all. Failure-path tests
    override it with their own `Setup` (doc lines 32-35).
  - `UnitOfWork` (line 45): the `Mock<IUnitOfWork>` every registered repository is wired into, created
    by a property initializer so the constructor can configure it.
  - `Logger` (line 48): `NullLogger<THandler>.Instance`, typed by the handler type parameter so it binds
    directly to the handler's `ILogger<THandler>` constructor parameter.
  - `RegisterRepository<TEntity, TIdentifierType>()` (lines 56-64): creates a
    `Mock<IRepository<TEntity, TIdentifierType>>`, wires that same object into **both**
    `GetRepository<...>()` and `GetReadRepository<...>()` (lines 61-62), and returns the mock for
    further `Setup`/`Verify`. Constrained to `AuditableAggregateRootEntity<TIdentifierType>` (line 57),
    that is, to aggregate roots.
  - `RegisterReadRepository<TEntity, TIdentifierType>()` (lines 72-79): the read-only counterpart for
    non-aggregate child entities that expose no read-write repository, constrained to the looser
    `AuditableBaseEntity<TIdentifierType>` (line 73) and wiring only `GetReadRepository<...>()`.
- **Why it's built this way**: wiring one repository mock into both accessors matters because a handler
  may read through `GetReadRepository` and write through `GetRepository` on the same aggregate; a test
  forced to register two mocks would have to keep their state in sync. Pre-succeeding `SaveChangesAsync`
  encodes the common case so only the interesting deviation appears in a test.
- **Where it's used**: the base of handler unit-test classes across the framework and the downstream
  application modules; the class doc carries a worked `CreateEventHandlerTests` example (lines 19-31).

### ArchitectureAssert
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:8` · Level 0 · static class

- **What it is**: the shared failure-reporting helper for every architecture fitness function, a static class with two `NoViolations` overloads that turn a rule breach into a readable, offender-listing assertion failure.
- **Depends on**: `NetArchTest.Rules.TestResult` (NuGet) and AwesomeAssertions' `Should()` fluent API. No first-party dependencies: this is the bottom of the fitness-function stack.
- **Concept introduced, architecture fitness functions.** A fitness function is an automated test that asserts a *structural* property of the codebase (a layer never references another, a controller is sealed) rather than a behavioral one. This package makes those rules first-class, shared code. `[Rubric §14, Testability]` assesses how well invariants are guarded by executable checks; `ArchitectureAssert` is the reporting primitive that makes a failing invariant name its offenders instead of just going red. `[Rubric §34, Architecture Governance]` assesses whether architectural decisions are enforced rather than merely documented; every rule in this package funnels its verdict through here.
- **Walkthrough**
  - `NoViolations(NetArchTest.Rules.TestResult result, string reason)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:11`) returns early when `result.IsSuccessful` (line 13), otherwise joins the `FailingTypes` full names into a bullet list (lines 18-19) and asserts `IsSuccessful.Should().BeTrue(...)` with the reason plus the violation list as the `because` argument (lines 21-22).
  - `NoViolations(IEnumerable<string> violations, string reason)` (line 26) materializes the sequence and asserts `list.Should().BeEmpty(...)` (line 30), for the reflection-derived and file-scanning rules that produce a plain string list rather than a NetArchTest result.
- **Why it's built this way**: the XML doc (lines 3-7) names it the un-drifted successor to the three per-repo `ArchitectureTestHelper.AssertNoViolations` copies: the reporting logic was duplicated in MMCA.Common, MMCA.Store, and MMCA.ADC, and centralizing it here removes the drift.
- **Where it's used**: every rule in [ArchitectureRules](#architecturerules) and every reflection-based test base calls one of these two overloads as its final step.

### BrandColorTokenTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:13` · Level 0 · abstract class

- **What it is**: an abstract xUnit test base that fails the build when a landing-page stylesheet re-hardcodes the brand hex instead of sourcing it from the shared `var(--mmca-primary)` CSS custom property.
- **Depends on**: `[Fact]` (xUnit), AwesomeAssertions, and `Assembly.GetManifestResourceStream` (BCL) to read embedded CSS. No first-party type dependency: it operates on the strings the subclass embeds.
- **Concept introduced, the drift fitness function.** Unlike a layer rule that reflects over assemblies, a drift function reads committed *text* (CSS here) and asserts a single source of truth is used. `[Rubric §20, Design System & Theming]` assesses whether visual tokens have one authoritative definition; this base guards that consumers of the framework palette cannot silently fork the primary color.
- **Walkthrough**
  - Two private constants pin the forbidden literal `#1565C0` and the required token `var(--mmca-primary)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:15-16`).
  - The subclass supplies `EmbeddedCssLogicalNames` (line 22), the manifest-resource names of its landing-page stylesheets.
  - The single `[Fact]` `LandingPageCss_SourcesBrandColorFromToken_NotHardcodedHex` (line 25) first asserts the list is non-empty (a non-vacuity guard, lines 27-28), then for each stylesheet reads it via `ReadEmbeddedCss` (line 56, which throws when the resource is missing, lines 58-60) and records a violation when the file is blank (line 37), when the token is absent (line 43), or when the raw hex is present (line 48).
- **Why it's built this way**: the doc (lines 4-11) explains the split. MMCA.Common's own `BrandColorTokenTests` guards the C#-to-CSS token *definition* (from `BrandColors.Primary`), while this base guards every downstream *consumer* of it, embedding the stylesheets as manifest resources so the package needs no file-system access into the consumer repo.
- **Where it's used**: subclassed once per repo that ships a branded landing page (Store, ADC).

### CrossEntityNavigationFinder
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97` · Level 0 · private sealed class

- **What it is**: a private `ExpressionVisitor` nested in [ArchitectureRules](#architecturerules) that walks a specification's `Criteria` lambda and collects the names of *other* entity types it navigates into.
- **Depends on**: `System.Linq.Expressions.ExpressionVisitor`, `MemberExpression`, `PropertyInfo` (BCL) and the [RuleHelpers](#rulehelpers) extension member `InheritsAuditableEntity`.
- **Concept introduced, expression-tree inspection as a fitness check.** NetArchTest reasons about assembly-level references only; to catch a rule expressed *inside* a lambda body (`s => s.Event.IsPublished`), the code instantiates the specification, reads its `Criteria` expression tree, and visits it. This backs the polyglot / database-per-service invariant (ADR-006): a `Criteria` that navigates to an entity in another physical data source produces an untranslatable join at runtime. `[Rubric §8, Data Architecture]` assesses cross-source data access discipline; this visitor is how that discipline is machine-checked.
- **Walkthrough**
  - The primary constructor captures `ownEntityType` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97`), and `_navigated` is the accumulating set (line 99).
  - `Find(Expression body)` visits the body and returns the set (lines 101-105).
  - `VisitMember` (line 107) resolves the accessed property's type through `EntityTypeOf` (line 121) and, when the result is an auditable entity other than the specification's own type, adds its name (lines 111-115).
  - `EntityTypeOf` (line 121) treats a direct entity property as a navigation (lines 123-126) and unwraps generic collection navigations such as `ICollection<TChild>` to their element type (lines 129-136).
- **Why it's built this way**: filtering by a foreign-key column is engine-portable; navigating is not (notably on Cosmos, where the cross-source relationship is degraded out of the model). The finder is the enforcement half of `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities` (line 24), whose failure message points authors at [CrossSourceSpecification](group-03-querying-specifications.md#crosssourcespecification) instead (lines 14-15). Only parameterless specifications can be instantiated and inspected; ones with constructor dependencies are skipped (lines 37-41).
- **Where it's used**: only inside that rule (line 66), which is surfaced through [SpecificationConventionTestsBase](#specificationconventiontestsbase).

### Layer
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:9` · Level 0 · enum

- **What it is**: the closed vocabulary of architectural layers a fitness function can reason about: `Shared`, `Domain`, `Application`, `Infrastructure`, `Api`, `Ui`, `Grpc`, `Contracts`, `ServiceHost` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:11-19`).
- **Depends on**: nothing; a plain enum.
- **Concept introduced**: the Clean Architecture layer taxonomy made into a type. The layer flow itself is taught in [primer §1](00-primer.md#1-the-big-picture); here it becomes an enum the rule library keys off, so a rule that iterates layers is written once against the enum rather than hard-coded per repo. `[Rubric §3, Clean Architecture]` assesses whether the layering is explicit and enforced; this enum is the shared alphabet.
- **Walkthrough**: the doc (lines 3-8) notes that `Ui`, `Grpc`, `Contracts`, and `ServiceHost` are optional: a repo simply omits them from its map when absent, so a rule iterating them is vacuously satisfied with no compile dependency on the missing assembly. [ArchitectureMapBase](#architecturemapbase)`.Segment` translates each member to its namespace segment (for example `Api` to `"API"` and `ServiceHost` to `"Service"`, `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:105-117`).
- **Where it's used**: carried by [LayerRef](#layerref), projected by [IArchitectureMap](#iarchitecturemap)`.OfLayer`, and threaded through nearly every method in [ArchitectureRules](#architecturerules).

### RouteAuthorizationTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:22` · Level 0 · abstract class

- **What it is**: an abstract test base that reflects over a UI assembly's routable Blazor pages and fails the build if a page the subclass marks as governed has lost its `[Authorize(Roles = "...")]` role gate.
- **Depends on**: `[Fact]` (xUnit), AwesomeAssertions, [RuleHelpers](#rulehelpers)`.LoadableTypes`, and pure reflection over attribute instances by full name (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:24-25`).
- **Concept introduced, the security-regression fitness function.** `[Rubric §11, Security]` and `[Rubric §25, Navigation & IA]` assess whether protected routes stay protected; this base turns "the admin page must require the Organizer role" from a review checklist into a compiled assertion, so a page cannot silently regress from `[Authorize(Roles=...)]` to a bare `[Authorize]` reachable by any authenticated user.
- **Walkthrough**
  - The subclass supplies `TargetAssembly` (line 28), the exact `RequiredRole` (line 31), an `IsGovernedPage` strategy (line 40), and a `MinimumGovernedPages` non-vacuity floor (line 47, default 1).
  - `GovernedPages_RequireDeclaredRole` (line 50) collects pages that are routable, governed, and do not require the role, then asserts the offender set is empty, naming each offender's route templates (lines 52-60).
  - `GovernedPageSet_IsNotEmpty` (line 64) guards the guard: if a refactor moved namespaces so `IsGovernedPage` matched nothing, the first test would pass vacuously, so this one asserts the discovered count meets the floor (lines 68-73).
  - Detection is all reflection by attribute full name: `IsRoutablePage` (line 77), `RequiresRole` (line 83, which reads the `Roles` property off the attribute instance and requires an exact ordinal match, so a bare `[Authorize]` or a different role fails), the subclass helper `HasAuthorizeAttribute` (line 94), `Routes` (line 97), and the base-type walk `IsOrDerivesFrom` (line 105).
- **Why it's built this way**: matching attributes by full name keeps the shared package free of an ASP.NET Core reference while still inspecting ASP.NET attributes (lines 16-20); a reflection scan also covers future pages matching the strategy without hand-enumeration. Deliberately anonymous public pages and bare-`[Authorize]` self-service pages simply must not match `IsGovernedPage` (lines 12-15).
- **Where it's used**: subclassed per module UI assembly in Store and ADC.

### RuleHelpers
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/RuleHelpers.cs:14` · Level 0 · internal static class

- **What it is**: the internal reflection toolbox the reflection-based fitness functions share: extension members for enumerating loadable types, matching suffix conventions on generic types, detecting base types and interfaces by open generic or name prefix, and classifying property setters as mutable or `init`-only.
- **Depends on**: `System.Reflection` (`Assembly`, `Type`, `PropertyInfo`, `ReflectionTypeLoadException`, `BindingFlags`) only.
- **Concept introduced**: the doc (lines 5-9) states the premise: NetArchTest cannot inspect method return types, generic-argument constraints, property accessors, or attribute usage, so those rules reflect over loaded types directly through these helpers. `[Rubric §14, Testability]` and `[Rubric §15, Best Practices]` apply: the reflection subtleties (partial assembly loads, `init`-only detection) are solved once here rather than re-derived per rule.
- **Walkthrough**: the class body is three C# preview `extension(T)` blocks, so every helper is an *extension property or method*, not a classic `this`-parameter extension method.
  - `extension(Assembly assembly)` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/RuleHelpers.cs:16`): `LoadableTypes` (line 19) tolerates a partially-resolvable assembly by catching `ReflectionTypeLoadException` and returning the types that did load through `OfType<Type>()`, which both filters nulls and narrows the element type (lines 27-31). `ConcreteClasses` (line 36) narrows that to non-abstract classes.
  - `extension(Type type)` (line 40): `SimpleName` (line 47) strips the generic-arity backtick so suffix conventions match generic types too. `InheritsGeneric` (line 58) walks the base chain and `ImplementsGeneric` (line 72) scans the interface set for an open generic. `HasBaseTypeStartingWith` (line 80) detects a framework base by full-name prefix without a compile dependency (for example FluentValidation's `AbstractValidator`). `DeclaredPublicProperties` (line 94) narrows to declared-only public instance properties. `InheritsAggregateRoot` (line 101) and `InheritsAuditableEntity` (line 108) hard-code the MMCA entity base full names ([AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) plus the `AuditableBaseEntity` and `BaseEntity` ancestors) so the entity rules can classify types cross-repo.
  - `extension(PropertyInfo property)` (line 114): `HasPublicMutableSetter` (line 121) is the immutability primitive. It reports `false` when there is no public setter, and `false` for `init`-only setters by looking for the `System.Runtime.CompilerServices.IsExternalInit` required custom modifier on the setter's return parameter (lines 131-135).
- **Why it's built this way**: every helper avoids a compile-time reference to the type it detects (base types matched by string prefix), which is what lets one rule body run identically across three repos that do not reference each other. The class carries a file-level `[SuppressMessage]` for CA1708 (lines 10-13): with multiple `extension(T)` blocks in one static class the analyzer flags the compiler-generated grouping members as case-colliding, a documented false positive.
- **Where it's used**: throughout the [ArchitectureRules](#architecturerules) partials, inside [CrossEntityNavigationFinder](#crossentitynavigationfinder), and directly by [RouteAuthorizationTestsBase](#routeauthorizationtestsbase).
- **Caveats / not-in-source**: the type is `internal`, so consumer repos cannot call these helpers directly; they reach the same behavior only through the public rules and bases.

### LayerRef
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:31` · Level 1 · sealed record

- **What it is**: an immutable record describing one assembly in a repo's architecture: its owning `Module`, its [Layer](#layer), the compiled `Assembly`, and its `RootNamespace` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:31`).
- **Depends on**: [Layer](#layer) and `System.Reflection.Assembly`.
- **Concept introduced**: the atomic unit of an architecture map. `Module` is the empty string for framework (MMCA.Common) layers that belong to no business module (lines 22-30), which is how the same record models both a module assembly (`("Catalog", Application, ...)`) and a shared framework assembly (`("", Shared, ...)`). Every projection and every isolation rule keys off that one convention.
- **Walkthrough**: a four-parameter positional `sealed record` (line 31), so it gets structural equality and immutability for free; its members are set once at construction by the map's `DefineLayers`.
- **Where it's used**: [ArchitectureMapBase](#architecturemapbase) stores a lazy `IReadOnlyList<LayerRef>` and derives every projection from it; its `Framework` and `Module` factory helpers are what build these.

### IArchitectureMap
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:39` · Level 2 · interface

- **What it is**: the single per-repo abstraction every architecture fitness function keys off. Each repo supplies one implementation declaring its layer and module assemblies; the shared rule library and abstract test bases consume *only* this interface, so a rule is written once and runs identically across MMCA.Common, MMCA.Store, and MMCA.ADC (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:33-38`).
- **Depends on**: [LayerRef](#layerref), [Layer](#layer), `System.Reflection.Assembly`.
- **Concept introduced, the architecture map as the fitness-function extension point.** This is a classic Dependency Inversion: the rules depend on an abstraction (the map), and each repo provides the concrete inventory of its assemblies. `[Rubric §1, SOLID]` (DIP) and `[Rubric §7, Microservices Readiness]` apply: the map also models the per-module layers a would-be extracted service owns, so the isolation rules can check module boundaries the same way in any repo.
- **Walkthrough**: the interface exposes identity (`RepoToken` line 42, `ModuleNames` line 45), the raw `Layers` inventory (line 48), and the projections the rules lean on: `OfLayer` (all assemblies of a kind, line 51), the per-module `ModuleDomain`/`ModuleApplication`/`ModuleShared` (lines 54-60), `Infrastructure()`/`Api()` across framework plus modules (lines 63-66), the lookups `For(module, layer)` (line 69) and `ModuleOf(assembly)` (line 72), namespace derivation `RootNamespace(module, layer)` (line 75), and `OtherModuleNamespaces` (line 81), which returns the same-layer namespaces of every *other* module (the forbidden targets for a module-isolation rule, empty for framework layers and single-module repos).
- **Why it's built this way**: funneling every rule through one interface is what removed three drifting copies of the architecture-test suite; add a repo and you write one map, not a new rule set.
- **Where it's used**: held as the `protected abstract IArchitectureMap Map` on nearly every `*TestsBase` in this group and passed to nearly every method of [ArchitectureRules](#architecturerules). [ArchitectureMapBase](#architecturemapbase) is the reusable partial implementation, and [CommonArchitectureMap](#commonarchitecturemap) / [AdcArchitectureMap](#adcarchitecturemap) are two concrete maps.

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
  - The `protected static Framework(...)` (line 94) and `protected Module(...)` (line 98) factory helpers build [LayerRef](#layerref)s with the right namespace, and the internal `Segment` (line 105) maps each [Layer](#layer) to its namespace token.
- **Why it's built this way**: a per-repo map stays a flat declaration of assemblies (the two abstract members), and everything derivable is derived, so the maps cannot drift in how they compute namespaces.
- **Where it's used**: each repo's concrete map subclasses this ([CommonArchitectureMap](#commonarchitecturemap), [AdcArchitectureMap](#adcarchitecturemap), and Store's equivalent). `FindRepoRoot` is called directly by every file-reading base: [DataResidencyTestsBase](#dataresidencytestsbase), [FormsConventionTestsBase](#formsconventiontestsbase), [FrameworkVersionConsistencyTestsBase](#frameworkversionconsistencytestsbase), [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase), [RawQueryableConventionTestsBase](#rawqueryableconventiontestsbase), [StateManagementConventionTestsBase](#statemanagementconventiontestsbase), and [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase).

### ArchitectureRules
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:3` · Level 3 · static partial class

- **What it is**: the reusable rule library: one large `static partial class` split across sixteen `ArchitectureRules.*.cs` files, whose methods each assert one architectural invariant across every applicable assembly a map declares. A repo's test classes reduce to a sealed subclass of the matching `*TestsBase` supplying its own map.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [Layer](#layer), [ArchitectureAssert](#architectureassert), [RuleHelpers](#rulehelpers), NetArchTest (`Types.InAssembly(...)`), and, for the specification rule, `System.Linq.Expressions` plus [CrossEntityNavigationFinder](#crossentitynavigationfinder).
- **Concept introduced, the rule as a parameterized function.** Each method takes an `IArchitectureMap` and does its own loop, so the `*TestsBase` classes are thin `[Fact]` shells that delegate. The partial is organized by concern across the files `ArchitectureRules.{Controllers, Entities, Events, Governance, HandlerResults, Handlers, Immutability, Layers, Localization, LocalizedText, Modules, Naming, Purity, Slices, Specifications, Transport}.cs`. `[Rubric §3, Clean Architecture]`, `[Rubric §4, DDD]`, `[Rubric §7, Microservices Readiness]`, and `[Rubric §34, Governance]` all apply: this is where the codebase's structural decisions become executable assertions.
- **Walkthrough**: three representative shapes.
  - *NetArchTest shape*, `ControllersDoNotDependOnInfrastructure` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:6`): loops the map's per-module API layer refs, computes the forbidden Infrastructure namespace via `map.RootNamespace(...)`, runs `Types.InAssembly(...).That().HaveNameEndingWith("Controller").ShouldNot().HaveDependencyOnAny(forbidden)`, and reports through `ArchitectureAssert.NoViolations(result, ...)` (lines 8-18).
  - *Layer-flow shape*, `ArchitectureRules.Layers.cs`: one public method per forbidden edge, `DomainDoesNotDependOnApplication` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Layers.cs:12`) through `UiDoesNotDependOnInfrastructure` (line 60), all delegating to the private `LayerNotDependOnLayer` (line 101), which loops every assembly of the `from` layer and asserts no dependency on the `to` layer's namespace. Two non-vacuity rules sit alongside them: `LayerMapDeclaresLayers` (line 72) and `ModulesDeclareLayers` (line 89).
  - *Reflection shape*, `ControllersAreSealed` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:37`): enumerates `map.Api().ConcreteClasses` (the [RuleHelpers](#rulehelpers) extension property), filters non-sealed controllers via the private `IsController` (line 70, which matches on the `Controller` suffix or an MVC base type), and asserts the string offender list is empty. `ControllersInheritApiControllerBase` (line 54) is the same shape with a caller-supplied exempt set, accepting either `ApiControllerBase` or `EntityControllerBase` as the base (lines 62-63).
- **Why it's built this way**: the MMCA.Common CLAUDE.md records the intent: the rule bodies live *once* here, and each repo's architecture test project is a set of sealed subclasses supplying its map, so all three repos enforce identical rules. The compile-time `Source/Build/MMCA.Common.LayerEnforcement.targets` guards the same layer flow at build time as a second gate.
- **Where it's used**: every `*TestsBase` in this group calls into it; those `[Fact]` methods are its public surface.
- **Caveats / not-in-source**: the full method roster spans sixteen partials; only the entry file and representative methods are cited here. The authoritative fitness-method count lives in `MMCA.Common/FACTS.md`, which is generated and CI-gated.

### ConstructorDependencyCountTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:14` · Level 3 · abstract class

- **What it is**: a single-responsibility-ceiling fitness function: it fails the build if any Application-layer `*Service` class has a constructor with more than the repo's accepted dependency count.
- **Depends on**: [IArchitectureMap](#iarchitecturemap) (via `Map.ModuleApplication()`), `[Fact]`, AwesomeAssertions, and reflection over constructors.
- **Concept introduced, quantifying the SRP smell.** `[Rubric §1, SOLID]` assesses single-responsibility discipline; a ballooning constructor-dependency list is the canonical smell, and this base turns a previously implicit judgement call into an enforced ceiling so the next service cannot silently grow past it (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:3-13`).
- **Walkthrough**: the subclass supplies `Map` (line 16) and the `MaxConstructorDependencies` high-water mark (line 22; it is abstract, so every repo states its own number). `ApplicationServices_DoNotExceedConstructorDependencyCeiling` (line 25) scans `Map.ModuleApplication()` for concrete `*Service` classes (lines 27-31), asserts at least one was found (non-vacuity, lines 33-34), computes each service's maximum constructor parameter count (lines 36-44), and asserts none exceed the ceiling, naming offenders with their counts (lines 45-53).
- **Why it's built this way**: the ceiling is raised only with a conscious decision; repos without business modules (MMCA.Common itself) have nothing to scan and do not subclass this (lines 11-12). It overlaps the arity check in [HandlerConventionTestsBase](#handlerconventiontestsbase) but scopes specifically to service facades and lets a repo pin an exact number rather than take the shared default.
- **Where it's used**: subclassed in Store and ADC against their Application services.

### AggregateConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: the minimal DDD aggregate fitness base for repos with *no* business modules (MMCA.Common itself): it asserts the Domain layer exposes aggregate roots, each built through a static `Create(...)` factory returning `Result<T>` with no public constructor.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules), `[Fact]`.
- **Concept introduced, the thin delegating test base** shared by most Level-4 types in this group: a `protected abstract IArchitectureMap Map` plus one `[Fact]` per rule that forwards to an [ArchitectureRules](#architecturerules) method, with no logic of its own. The factory-returning-[Result](group-01-result-error-handling.md#result) idiom on [AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) is what these rules verify. `[Rubric §4, DDD]` assesses aggregate discipline.
- **Walkthrough**: three `[Fact]`s, each a one-line delegate: `Domain_ShouldExpose_AggregateRoots` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:13`), `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 16), and `AggregateRoots_ShouldHave_NoPublicConstructors` (line 19, which targets the framework-specific `DomainAggregateRootsHaveNoPublicConstructors` rule rather than the module one).
- **Why it's built this way**: module-bearing repos use the fuller [EntityConventionTestsBase](#entityconventiontestsbase) instead (lines 4-6); this base exists so a module-less repo still guards its aggregates.
- **Where it's used**: subclassed in MMCA.Common's architecture test project.

### ConcurrencyConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a one-rule delegating base asserting that every `*UpdateRequest` implements [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware), so concurrent edits surface as 409 Conflict rather than silent last-write-wins.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape from [AggregateConventionTestsBase](#aggregateconventiontestsbase). `[Rubric §8, Data Architecture]` assesses optimistic-concurrency handling; carrying a RowVersion on every update request is how that concern is enforced at the contract level.
- **Walkthrough**: one `[Fact]` `UpdateRequests_ShouldImplement_IConcurrencyAware` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:13`) delegating to `ArchitectureRules.UpdateRequestsAreConcurrencyAware(Map)`. The doc notes modules with no mutable aggregate are legitimately vacuous (lines 5-6).
- **Where it's used**: subclassed in Store and ADC.

### ControllerConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: the presentation-layer convention base: controllers are thin and sealed, never reach Infrastructure or EF Core directly, and inherit the framework [ApiControllerBase](group-12-api-hosting-mapping.md#apicontrollerbase) for consistent Result-to-HTTP mapping.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); it adds a `protected virtual ControllersExemptFromApiControllerBase` list (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:12`) for controllers that legitimately bypass the base (for example a webhook endpoint that owns its own response semantics). `[Rubric §9, API & Contract Design]` assesses consistent controller shape.
- **Walkthrough**: four `[Fact]`s: `Controllers_ShouldNotDependOn_Infrastructure` (line 15), `Controllers_ShouldNotDependOn_EntityFrameworkCore` (line 18), `Controllers_ShouldBe_Sealed` (line 21), and `Controllers_ShouldInherit_ApiControllerBase` (line 24, passing the exempt list). The underlying rules live in `ArchitectureRules.Controllers.cs`.
- **Where it's used**: subclassed per repo with business modules (Store, ADC).

### DataResidencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:14` · Level 4 · abstract class

- **What it is**: a compliance-drift fitness function: the data-residency statement in a repo's `PRIVACY.md` must match the region where personal data is actually provisioned, and known-stale region claims must not reappear.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, `System.IO` (`File.ReadAllText`), AwesomeAssertions.
- **Concept introduced, a document-versus-infrastructure consistency gate.** `[Rubric §30, Compliance / Privacy / Data Governance]` assesses whether privacy claims track reality; this base fails the build if either the deployed region or the privacy policy changes without the other, closing the gap where a policy once claimed a region the data never lived in (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:3-13`).
- **Walkthrough**: the subclass supplies `Map` (line 16), the optional `ForbiddenResidencyClaims` list (line 23), and implements `ExtractDeployedRegion(repoRoot)` (line 53) against its own source of truth (the doc cites ADC parsing the SQL region default out of `deploy.yml` and Store parsing `infra/DISASTER-RECOVERY.md`). The single `[Fact]` `PrivacyPolicy_DataStorageRegion_MatchesDeployedRegion` (line 26) locates the repo root via `FindRepoRoot($"{Map.RepoToken}.slnx")` (line 28), asserts the extracted region is non-blank (lines 31-32), reads `PRIVACY.md`, then asserts the normalized policy contains the region (line 37) and none of the forbidden claims (lines 40-44). `Normalize` (line 57) strips whitespace and upper-cases, so "West US 2" matches the "westus2" token.
- **Where it's used**: subclassed in Store and ADC (module-less MMCA.Common has no deployed region).

### DependencyVersionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:15` · Level 4 · abstract class

- **What it is**: a dependency-pin fitness function guarding two commercial-license traps at build time: MassTransit must stay below v9 and SixLabors.ImageSharp below v4, both parsed out of `Directory.Packages.props`.
- **Depends on**: [ArchitectureRules](#architecturerules)`.PinnedPackageMajorBelow`, `[Fact]`. Note there is no `Map` on this base; it reads the props file directly through the rule.
- **Concept introduced, enforcing a policy pin as a test.** `[Rubric §32, Dependency & Supply-Chain]` assesses whether risky upgrades are guarded. The doc explains both traps: MassTransit v9 fails the startup license check and crashes every broker-enabled host while CI never starts a broker, so a blanket bump otherwise stays green (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:3-6`); ImageSharp v4's MSBuild targets fail without `$(SixLaborsLicenseKey)`, so a blanket bump breaks every build (lines 39-43).
- **Walkthrough**: `MassTransit_MustNotExceed_MajorVersion8` (line 25) loops `MassTransitPackageIds` (line 17: `MassTransit`, `MassTransit.RabbitMQ`, `MassTransit.Azure.ServiceBus.Core`) and calls `PinnedPackageMajorBelow(packageId, exclusiveMajorCeiling: 9, ...)`. `ImageSharp_MustNotExceed_MajorVersion3` (line 48) does the same for `ImageSharpPackageIds` (line 45) with ceiling 4. Both id lists are `virtual` so a repo can override to an empty list when it does not pin the package.
- **Why it's built this way**: the doc is explicit (lines 8-13): the consumer repos (ADC, Store) do NOT pin MassTransit (it flows transitively via `MMCA.Common.Infrastructure`), so they must not subclass this base with the default list, or the "must remain pinned" assertion would fail on a pin they do not declare. The v8 pin is enforced only in MMCA.Common, where MassTransit is actually pinned.
- **Where it's used**: subclassed only in MMCA.Common's `DependencyVersionTests`.

### DomainPurityTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a framework-independence base: Domain and Shared stay free of infrastructure frameworks, and Application stays host-agnostic (no EF Core, no ASP.NET Core).
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); it adds an `ExtraForbiddenDomainDependencies` hook (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:12`) so a repo bans its own frameworks (the doc cites Store banning "Stripe" and ADC banning "RabbitMQ"). `[Rubric §3, Clean Architecture]` and `[Rubric §4, DDD]` assess the framework-free core.
- **Walkthrough**: four `[Fact]`s: `Domain_ShouldBe_FrameworkFree` (line 15) and `Shared_ShouldBe_FrameworkFree` (line 18), both passing the extra-forbidden list, then `Application_ShouldNotDependOn_EntityFrameworkCore` (line 21) and `Application_ShouldNotDependOn_AspNetCore` (line 24).
- **Where it's used**: subclassed in all three repos.

### EntityConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: the fuller DDD entity and aggregate convention base (the module-bearing counterpart to [AggregateConventionTestsBase](#aggregateconventiontestsbase)): entities are sealed and live only in Domain, aggregate roots use a `Create(...)` factory returning `Result<T>` with no public constructor, and DTOs and requests stay out of Domain and Infrastructure.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §4, DDD]` and `[Rubric §3, Clean Architecture]` apply.
- **Walkthrough**: six `[Fact]`s: `Domain_ShouldExpose_AggregateRoots` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:13`), `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 16), `AggregateRoots_ShouldHave_NoPublicConstructors` (line 19), `DomainEntities_ShouldBe_Sealed` (line 22), `DomainEntities_ShouldReside_InDomainLayer` (line 25), `DtosAndRequests_ShouldNotResideIn_DomainOrInfrastructure` (line 28).
- **Where it's used**: subclassed in Store and ADC.

### EventConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: an integration-event convention base (the doc cites ADR-010): every concrete integration event inherits [BaseIntegrationEvent](group-04-events-outbox.md#baseintegrationevent), declares an `int SchemaVersion`, and lives in a `*.IntegrationEvents` namespace in the Shared layer.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §9, API & Contract Design]` assess versioned, discoverable cross-service event contracts. It pairs with [IntegrationEventContractTestsBase](#integrationeventcontracttestsbase), which freezes the exact shape.
- **Walkthrough**: three `[Fact]`s: `IntegrationEvents_ShouldDeclare_SchemaVersion` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:13`), `IntegrationEvents_ShouldInherit_BaseIntegrationEvent` (line 16), `IntegrationEvents_ShouldResideIn_SharedIntegrationEventsNamespace` (line 19).
- **Where it's used**: subclassed in repos that publish integration events (Store, ADC).

### FormsConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:15` · Level 4 · abstract class

- **What it is**: a UX-safety fitness function: every admin `*Create.razor` form under `Source/Modules` must keep its unsaved-changes guard, dirty tracking, and validated `MudForm`, so those protections cannot silently regress.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, `System.IO` file enumeration, AwesomeAssertions.
- **Concept introduced, the markup-scanning fitness function** (it reads `.razor` text, not assemblies). `[Rubric §24, Forms / Validation / UX Safety]` assesses whether navigate-away data loss and missing validation are prevented; the base checks for six literal markers (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:27-35`): `UnsavedChangesGuard`, `IsDirtyAccessor` (bound through the live accessor to pre-empt the one-render stale-`IsDirty` lag, a §19 concern), `_isDirty`, `<MudForm`, `Required="true"`, and `RequiredError`.
- **Walkthrough**: the subclass supplies `Map` (line 17) and optionally a higher `MinimumCreateForms` count (line 24, default 1). `AdminCreateForms_KeepUnsavedChangesGuardAndValidation` (line 38) resolves the repo root, enumerates `*Create.razor` under `Source/Modules` excluding `obj` and `bin` (lines 43-48), asserts the discovered count meets the floor (lines 50-51), and records a violation naming each missing marker per form (lines 53-67).
- **Why it's built this way**: self-service forms with no navigate-away step (for example a single-section Profile password or delete form) carry no guard by design and simply must not match the `*Create.razor` glob (lines 10-13).
- **Where it's used**: subclassed in repos with admin create forms (Store, ADC).

### FrameworkVersionConsistencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:13` · Level 4 · abstract class

- **What it is**: an evolvability and drift fitness function that makes ADR-016 executable: all `MMCA.Common.*` packages in a consumer's `Directory.Packages.props` must be pinned to one version, so a partial sweep is caught at CI time.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, `System.Xml.Linq` (`XDocument`), AwesomeAssertions.
- **Concept introduced, enforcing the lockstep release policy.** `[Rubric §16, Maintainability]` and `[Rubric §32, Dependency & Supply-Chain]` assess coordinated versioning; the framework releases in lockstep with no phased rollout (ADR-016), and this gate fails if any `MMCA.Common.*` entry diverges (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:3-11`).
- **Walkthrough**: the subclass supplies `Map` (line 15) and optionally `MinimumCommonPackageCount` (line 22, default 13). `AllMmcaCommonPackages_ArePinnedToOneVersion` (line 25) loads `Directory.Packages.props` from the repo root (lines 27-30), selects every `PackageVersion` element whose `Include` starts with `MMCA.Common.` (lines 31-41), asserts the count meets the floor (lines 43-44), asserts none has an empty version (lines 46-48), and asserts the distinct-version count is exactly one, listing what it found (lines 50-56).
- **Why it's built this way**: MMCA.Common itself does not subclass this, because it declares no `MMCA.Common.*` pins; only consumers do (lines 9-11). The default of 13 is a deliberately loose floor: the doc points at `MMCA.Common/FACTS.md` for the released package count (15 as of framework v1.121.0, `MMCA.Common/FACTS.md:19`), and each consumer is expected to override it to its own known count.
- **Where it's used**: subclassed in Store and ADC.

### HandlerConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: the CQRS handler convention base: handlers and validators live only in Application, handlers and services do not broker other handlers, and no `*Service` exceeds the god-class constructor-arity ceiling.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); it adds a `MaxServiceConstructorParameters` override (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:12`, default 8). `[Rubric §6, CQRS]` and `[Rubric §1, SOLID]` apply; the CQRS decorator pipeline itself is taught in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to).
- **Walkthrough**: six `[Fact]`s: `Handlers_ShouldResideIn_ApplicationLayer` (line 15), `Handlers_ShouldNotInject_OtherHandlers` (line 18), `ApplicationServices_ShouldNotInject_Handlers` (line 21), `ApplicationServices_ShouldNotExceed_ConstructorArity` (line 24, passing the max), `Validators_ShouldResideIn_ApplicationLayer` (line 27), `EventHandlers_ShouldResideIn_ApplicationLayer_AndBeSealed` (line 30).
- **Where it's used**: subclassed in all three repos. [ConstructorDependencyCountTestsBase](#constructordependencycounttestsbase) is the narrower, per-repo-pinned version of the arity check.

### HandlerResultConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:16` · Level 4 · abstract class

- **What it is**: an opt-in base asserting that every concrete command or query handler's `TResult` is [Result](group-01-result-error-handling.md#result) or `Result<T>` (or a type derived from them), turning a runtime-only constraint into a build-time gate.
- **Depends on**: [IArchitectureMap](#iarchitecturemap) and [ArchitectureRules](#architecturerules) (`ApplicationLayersDeclareHandlers`, `CommandHandlersReturnResult`, `QueryHandlersReturnResult`, at `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.HandlerResults.cs:18`, `:39`, `:48`).
- **Concept introduced, closing a deliberately unconstrained generic.** The CQRS interfaces carry no compile-time constraint on `TResult` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:6-7`), but the decorator pipeline's short-circuit paths (feature gate, validation) fabricate failures through [ResultFailureFactory](group-05-cqrs-pipeline.md#resultfailurefactory), which throws `InvalidOperationException` at runtime for any non-`Result` `TResult` (lines 7-9). A handler with the wrong result type therefore compiles cleanly and only fails when a gate short-circuits it. This base moves that failure to CI. `[Rubric §6, CQRS]`, `[Rubric §14, Testability]`, and `[Rubric §15, Best Practices]` apply.
- **Walkthrough**: three `[Fact]`s. `ApplicationLayers_DeclareAtLeastOneHandler` (line 21) is the non-vacuity guard the doc calls out (lines 12-13): a mis-pinned assembly cannot make the other two pass by finding nothing. `CommandHandlers_Return_ResultTypes` (line 24) and `QueryHandlers_Return_ResultTypes` (line 27) delegate to the matching rules.
- **Why it's built this way**: it is opt-in and map-driven like the rest of the family, so a repo adds it next to its other architecture test classes with the same `Map` and no other wiring.
- **Where it's used**: subclassed in the repos' architecture test projects alongside the other `*Tests` classes.

### ImmutabilityTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: an immutability convention base: DTOs, command and query messages, domain events, integration events, and value objects expose no public mutable (non-`init`) setter; value objects are additionally sealed and confined to the Shared layer.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules), which uses [RuleHelpers](#rulehelpers)`.HasPublicMutableSetter` underneath.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the `init`-only versus mutable distinction is exactly what `HasPublicMutableSetter` detects via the `IsExternalInit` modifier. `[Rubric §15, Best Practices]` and `[Rubric §4, DDD]` assess immutable contracts and value objects.
- **Walkthrough**: five `[Fact]`s: `Dtos_ShouldBe_Immutable` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:13`), `CommandsAndQueries_ShouldBe_Immutable` (line 16), `DomainEvents_ShouldBe_Immutable` (line 19), `IntegrationEvents_ShouldBe_Immutable` (line 22), `ValueObjects_ShouldBe_ImmutableSealedAndInShared` (line 25).
- **Where it's used**: subclassed in all three repos.

### IntegrationEventContractTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:11` · Level 4 · abstract class

- **What it is**: a frozen wire-contract guard: it rebuilds the live integration-event contract (one line per event, `FullName { Prop:Type, ... }`) and compares it to a committed snapshot the subclass supplies, so a renamed, removed, or retyped property (or a new event shipped without its consumer) fails the build.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules)`.BuildIntegrationEventContract`, AwesomeAssertions.
- **Concept introduced, the snapshot fitness function.** `[Rubric §9, API & Contract Design]` and `[Rubric §7, Microservices Readiness]` assess whether cross-service contracts stay stable; because a consumer in another service deserializes by shape, this gate makes any contract change a deliberate, coordinated commit.
- **Walkthrough**: the subclass supplies `Map` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:13`) and the committed `ExpectedContract` snapshot (line 16). `IntegrationEventContracts_ShouldMatch_TheFrozenSnapshot` (line 19) builds the actual contract (line 21) and asserts `actual.Should().Equal(ExpectedContract, ...)` (lines 23-28), the message instructing the author to version the event and update `ExpectedContract` in the same commit when a change is intentional.
- **Where it's used**: subclassed in repos publishing integration events (Store, ADC). It complements [EventConventionTestsBase](#eventconventiontestsbase).

### LayerDependencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: the Clean Architecture layer-flow base: fifteen `[Fact]`s asserting that the map declares the expected layers at all, and that each layer references only layers below it (Domain not on Application, Infrastructure, or API; Application not on Infrastructure or API; Shared on nothing above it; UI only on Shared).
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules) (`ArchitectureRules.Layers.cs`).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); this is the runtime half of the two-gate layer enforcement, the compile-time half being `Source/Build/MMCA.Common.LayerEnforcement.targets`. `[Rubric §3, Clean Architecture]` is the whole point.
- **Walkthrough**
  - Two overridable declarations come first: `RequiredLayers` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:16`, defaulting to the five core layers Shared, Domain, Application, Infrastructure, Api) and `RequiredModuleLayers` (line 24, defaulting to the same list and trimmable for a deliberately thin module).
  - Two non-vacuity `[Fact]`s guard the rest: `LayerMap_DeclaresEveryExpectedLayer` (line 27) and `LayerMap_ModulesDeclareEveryExpectedLayer` (line 30). Without them a map that forgot an assembly would satisfy every dependency rule by having nothing to check.
  - Thirteen forbidden-edge `[Fact]`s follow, each a one-line delegate onto an `ArchitectureRules.Layers.cs` method: `Domain_ShouldNotDependOn_Application` (line 33) through `Ui_ShouldNotDependOn_Infrastructure` (line 69). The UI trio (lines 63-69) encodes the documented exception that UI depends only on Shared for Blazor WASM compatibility.
- **Where it's used**: subclassed in all three repos.

### LocalizationResourceTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: an opt-in translation-coverage gate (ADR-027): a repo that ships localized `.resx` resources subclasses this and lists its required cultures; the build fails if any base `.resx` under `Source/` lacks a complete, non-empty sibling for a required culture.
- **Depends on**: [ArchitectureRules](#architecturerules)`.ResourceTranslationsAreComplete`, `[Fact]`. There is no `Map` on this base; it scans `Source/` directly through the rule.
- **Concept introduced, a coverage fitness function for i18n.** `[Rubric §27, i18n]` assesses translation completeness; this gate ensures a new English string can never ship without its translation (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:3-8`).
- **Walkthrough**: the subclass supplies `RequiredCultures` (line 13, for example `["es"]`) and optionally `MinimumBaseResources` (line 21, a non-vacuity floor whose default of 0 skips the guard). The single `[Fact]` `Translations_AreComplete_ForEveryRequiredCulture` (line 24) passes both to the rule.
- **Why it's built this way**: single-locale repos need not subclass it (the rule is vacuous for an empty list). It pairs with [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase): this gate keeps the extracted resources translated, that gate keeps literals out of markup.
- **Where it's used**: subclassed in localized repos.

### LocalizedTextConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:13` · Level 4 · abstract class

- **What it is**: a localized-text convention gate (ADR-027): user-visible literals must not be hard-coded in `.razor` or `.razor.cs` under `Source/` (snackbar messages, page `Title` properties, `<PageTitle>` markup, breadcrumb labels) but resolve through `IStringLocalizer` resources.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, [ArchitectureRules](#architecturerules)`.UserVisibleTextIsLocalized`.
- **Concept**: cross-references the markup-scanning gate idea from [FormsConventionTestsBase](#formsconventiontestsbase). `[Rubric §27, i18n]` assesses that visible strings follow the selected language.
- **Walkthrough**: the subclass supplies `Map` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:15`) and optionally `MinimumScannedFiles` (line 21, default 1) and `AllowedFiles` (line 28, whole-file exemptions; the preferred exemption is a per-line `i18n: allow` comment). `UserVisibleText_IsLocalized` (line 31) resolves the repo root and delegates to the rule with the `Source` directory, the allowlist, and the floor (lines 33-37).
- **Where it's used**: subclassed in localized repos. It pairs with [LocalizationResourceTestsBase](#localizationresourcetestsbase).

### MicroserviceExtractionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a transport-boundary base for the modular-monolith to microservices path: MassTransit, gRPC, and Protobuf must never leak into Domain, Application, or Shared, so a module behaves identically in-process or extracted and the split stays reversible.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the extraction invariant (application and domain code talks to abstractions, transport choices live at the edges) is the ADR-006/007/008 story the doc cites (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:3-6`). `[Rubric §7, Microservices Readiness]` assesses exactly this reversibility.
- **Walkthrough**: one `[Fact]` `CoreLayers_ShouldNotDependOn_Transport` (line 13) delegating to `ArchitectureRules.TransportDoesNotLeakIntoCoreLayers(Map)`.
- **Where it's used**: subclassed in all three repos.

### ModuleIsolationTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a modular-monolith boundary base: a module must not reach another module's internal layers; cross-module communication goes only through the Shared (contract) layer. It is vacuous for single-module or module-less repos.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules), which uses `OtherModuleNamespaces` to compute the forbidden targets.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §5, Vertical Slice]` and `[Rubric §7, Microservices Readiness]` assess module autonomy. The [IModule](group-14-module-system-composition.md#imodule) system is taught in Group 14.
- **Walkthrough**: six `[Fact]`s covering each layer's isolation: `ModuleDomains_ShouldBe_Isolated` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:13`), `ModuleApplications_ShouldBe_Isolated` (line 16), `ModuleInfrastructures_ShouldBe_Isolated` (line 19), `ModuleApis_ShouldBe_Isolated` (line 22), plus the two cross-layer reach rules `ModuleDomains_ShouldNotReach_OtherModuleInfrastructures` (line 25) and `ModuleApplications_ShouldNotReach_OtherModuleInfrastructures` (line 28).
- **Where it's used**: subclassed in multi-module repos (Store, ADC).

### NamingConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:8` · Level 4 · abstract class

- **What it is**: a naming and sealing convention base across the CQRS plus DDD building blocks: handlers, command and query messages, validators, DTOs, domain events, invariants, EF configurations, specifications, and repositories each follow their established suffix and sealing convention.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules), which uses [RuleHelpers](#rulehelpers)`.SimpleName` to match suffixes on generic types.
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §15, Best Practices]` and `[Rubric §16, Maintainability]` assess consistent, discoverable naming.
- **Walkthrough**: ten `[Fact]`s: `Handlers_ShouldBeSealed_WithHandlerSuffix` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:13`), `Commands_ShouldHave_CommandOrRequestSuffix` (line 16), `Queries_ShouldHave_QuerySuffix` (line 19), `Validators_ShouldHave_ValidatorOrRulesSuffix` (line 22), `SharedDtos_ShouldHave_DtoOrLookupSuffix` (line 25), `DomainEvents_ShouldBeSealed_InDomainEventsNamespace` (line 28), `InvariantClasses_ShouldBe_Static` (line 31), `EfConfigurations_ShouldBeSealed_WithConfigurationSuffix` (line 34), `Specifications_ShouldBeSealed_WithSpecificationSuffix` (line 37), `Repositories_ShouldHave_RepositorySuffix` (line 40).
- **Where it's used**: subclassed in all three repos.

### PiiConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: a GDPR/CCPA right-to-erasure base (ADR-005): any domain entity that declares a [PiiAttribute](group-02-domain-building-blocks.md#piiattribute)-marked property must implement [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable), so it has an erasure path.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the `[Pii]` plus `IAnonymizable` soft-delete-versus-erasure model is taught in [Group 02](group-02-domain-building-blocks.md#piiattribute) (ADR-005). `[Rubric §30, Compliance / Privacy]` and `[Rubric §11, Security]` assess erasure discipline.
- **Walkthrough**: one `[Fact]` `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:12`) delegating to `ArchitectureRules.EntitiesWithPiiImplementAnonymizable(Map)`.
- **Where it's used**: subclassed in repos with PII-bearing entities (Store, ADC).

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
- **Why it's built this way**: making the offender message carry the file and line (line 98) is what makes a textual gate actionable; combined with the allowlist ratchet it can be adopted in a repo that is not yet clean.
- **Where it's used**: subclassed opt-in by repos on the extraction path. Because it is a ratchet, a repo's `AllowedFiles` override is the record of its remaining debt.

### SharedLayerTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:7` · Level 4 · abstract class

- **What it is**: a Shared (contract) layer base: a module's Shared is contracts-only, so it must not depend on its own internal layers, on another module's Shared, or on EF Core.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §3, Clean Architecture]` and `[Rubric §5, Vertical Slice]` assess a clean contract boundary a would-be extracted consumer can reference safely.
- **Walkthrough**: three `[Fact]`s: `ModuleShared_ShouldNotDependOn_OwnInternalLayers` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:12`), `ModuleShared_ShouldBe_Isolated` (line 15), `ModuleShared_ShouldNotDependOn_EntityFrameworkCore` (line 18).
- **Where it's used**: subclassed in multi-module repos (Store, ADC).

### SliceCohesionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: a vertical-slice cohesion base: a use-case slice keeps its command or query, its handler, and its validator together in one namespace, so a feature is a cohesive unit rather than spread across horizontal `Handlers/` and `Validators/` folders.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)). `[Rubric §5, Vertical Slice]` assesses feature cohesion. The doc notes MMCA.Common scopes to its Notifications slices while ADC and Store scope to their module Application layers (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:6-8`).
- **Walkthrough**: two `[Fact]`s: `Handlers_ShouldBeCoLocatedWith_TheirContracts` (line 15) and `Validators_ShouldBeCoLocatedWith_TheirContracts` (line 19).
- **Where it's used**: subclassed in all three repos.

### SpecificationConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: an opt-in base for the Specification pattern in polyglot / database-per-service repos: it guarantees no specification filters by navigating to another entity, which would not translate when that entity lives in a different physical source.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureRules](#architecturerules)`.SpecificationsDoNotNavigateToOtherEntities`, backed by [CrossEntityNavigationFinder](#crossentitynavigationfinder).
- **Concept**: cross-references the delegating-base shape ([AggregateConventionTestsBase](#aggregateconventiontestsbase)); the [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) pattern is taught in Group 03. `[Rubric §8, Data Architecture]` assesses engine-portable query design.
- **Walkthrough**: one `[Fact]` `Specifications_ShouldNotNavigate_ToOtherEntities` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:16`) delegating to the rule. The doc notes single-engine repos need not subclass it (lines 4-8).
- **Where it's used**: subclassed only in polyglot-capable repos.

### StateManagementConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:17` · Level 4 · abstract class

- **What it is**: a Blazor Server state-management gate: user and session state must live in per-circuit scoped services, never in mutable `static` members (which leak one user's state to another) or in singleton-registered stateful services.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, reflection over the UI assemblies, a `Source/` file scan, and `System.Runtime.CompilerServices.CompilerGeneratedAttribute`.
- **Concept introduced, a reflection plus source-scan combined gate.** `[Rubric §19, State Management]` assesses per-circuit state safety; Blazor Server shares one process across every circuit, so a static member is shared across every user (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:5-16`).
- **Walkthrough**: the subclass supplies `Map` (line 19, whose UI assemblies must be registered under `Layer.Ui`) and optionally `AllowedStaticMembers` (line 25).
  - `UiAssemblies_CarryNoMutableStaticState` (line 28) reflects over `Map.OfLayer(Layer.Ui)`, first asserting the set is non-empty (lines 32-33), then flagging any declared static field that is not `readonly`, not `const`, and not compiler-generated, plus any settable static property, minus the exempted members (lines 45-56).
  - `UiProjects_RegisterStatefulServicesScoped` (line 66) scans `Source/` `.cs` files (skipping `obj`, `bin`, non-`.UI` paths, and `Testing` paths, lines 74-80) for a line containing both `AddSingleton` and a `StateService`/`StateContainer` name, recording `fileName:lineNumber` as an offender (lines 85-90).
  - The private `GetLoadableTypes` (line 99) repeats the tolerant load locally rather than using the internal [RuleHelpers](#rulehelpers), and `IsCompilerGenerated` (line 111) treats any member name containing `<` as generated.
- **Where it's used**: subclassed in repos with Blazor Server UI (Store, ADC).

### UIArchitectureConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:14` · Level 4 · abstract class

- **What it is**: a UI-architecture convention gate holding the container and presentational split with two mechanical line-count caps: a `*.razor.cs` code-behind stays within `MaxCodeBehindLines`, and a `.razor` file's inline `@code` block stays within `MaxInlineCodeLines`.
- **Depends on**: [IArchitectureMap](#iarchitecturemap), [ArchitectureMapBase](#architecturemapbase)`.FindRepoRoot`, `System.IO` file enumeration, AwesomeAssertions.
- **Concept introduced, enforcing a design convention by file metrics.** `[Rubric §18, UI Architecture]` assesses the container/presentational discipline; a ballooning code-behind signals page logic that belongs in an injected UI service or an extracted sub-component, and putting a number on it moves the judgement from review to CI (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:3-13`).
- **Walkthrough**: the subclass supplies `Map` (line 16); the caps `MaxCodeBehindLines` (line 22, default 400), `MaxInlineCodeLines` (line 29, default 120), `MinimumCodeBehindFiles` (line 35, a non-vacuity floor, default 1), and `ExcludedPathFragments` (line 41) are all overridable.
  - `CodeBehinds_StayWithinTheLineCap` (line 44) enumerates `*.razor.cs`, asserts the floor (lines 48-49), and flags files over the cap with their line counts (lines 51-59).
  - `RazorFiles_KeepInlineCodeBlocksSmall` (line 63) finds each `.razor` file's `@code` line and measures the tail block from there to end of file (line 77), flagging it when it exceeds the inline cap.
  - `EnumerateSourceFiles` (line 89) drives both, resolving the repo root and excluding `obj`, `bin`, and the excluded fragments.
- **Caveats / not-in-source**: the inline-`@code` measurement assumes the block is the file's tail (stated in the doc at lines 25-27), so a `.razor` file with markup after its `@code` block would over-count.
- **Where it's used**: subclassed in repos with Blazor UI (Store, ADC).

### AccessibilityViolationException

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7` · Level 0 · class

- **What it is**: the sealed exception thrown when an axe-core accessibility scan finds one or more WCAG violations on the page under test.
- **Depends on**: `System.Exception` (BCL) only. It is raised by [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync` and referenced in that method's XML doc (`MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:4`).
- **Concept introduced, the accessibility gate as a hard failure.** Rather than logging a warning or returning a result object, a violated a11y scan throws, so a consumer E2E `[Fact]` that calls `AssertNoAccessibilityViolationsAsync` goes red and names the offending elements. `[Rubric §21, Accessibility]` assesses whether accessibility is verified rather than assumed; a dedicated exception type makes an a11y regression a first-class, catchable build failure. `[Rubric §28, Front-End Testing]` assesses whether the UI is exercised through realistic automated checks; this is the failure primitive those checks throw.
- **Walkthrough**: three constructors, the parameterless, message, and message-plus-inner overloads (`AccessibilityViolationException.cs:10`, `:15`, `:21`), following the standard exception shape. It carries no extra state; the human-readable violation summary is baked into the `message` string the thrower builds.
- **Why it's built this way**: a purpose-named exception (not a bare `Exception` or `InvalidOperationException`) lets a test that deliberately probes a known-inaccessible page assert on exactly this type, and reads clearly in a failure log.
- **Where it's used**: thrown only by [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync`, which is in turn called by the `ScanAsync`/`ScanGridAsync` helpers on [E2ETestBase](#e2etestbase) and the `*_ShouldHaveNoAccessibilityViolations` facts on the workflow bases.

### AdminCredentials

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:66` · Level 0 · class

- **What it is**: a nested static class on [E2ETestConfiguration](#e2etestconfiguration) that resolves the seeded admin login (email and password) for E2E runs, with an environment-variable override in front of a per-app default.
- **Depends on**: `System.Environment` (BCL). It is the admin half of the credential pair; [UserCredentials](#usercredentials) is its structurally identical regular-user twin.
- **Concept**: the env-over-default resolution taught in [E2ETestConfiguration](#e2etestconfiguration). `DefaultEmail`/`DefaultPassword` are settable so a downstream app seeds its own admin identity (via a `[ModuleInitializer]`), while `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` win when set. `[Rubric §11, Security]` assesses how test credentials are handled; keeping them out of source and injectable per environment is the safe end of that.
- **Walkthrough**: `DefaultEmail` = `"admin@localhost"` and `DefaultPassword` = `"Admin123!"` (`E2ETestConfiguration.cs:68-69`); `Email` and `Password` read `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` and fall back to the defaults (`:71-75`).
- **Where it's used**: read by [E2ETestBase](#e2etestbase)`.LoginAsAdminAsync` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:79-80`).

### AxeOptions

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9` · Level 0 · static class

- **What it is**: the shared axe-core run options that scope every accessibility scan to one documented target, WCAG 2.1 AA, so the gallery and all downstream apps scan against the same rule set.
- **Depends on**: `Deque.AxeCore.Commons` (NuGet: `AxeRunOptions`, `RunOnlyOptions`, `RuleOptions`, `AxeOptions.cs:1`).
- **Concept introduced, the scoped accessibility target.** A raw axe run also emits "best-practice" advisories that are not conformance failures; pinning `RunOnly` to the WCAG tag set (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) makes the gate fail only on real WCAG 2.1 AA violations. `[Rubric §21, Accessibility]` assesses whether the accessibility bar is explicit and enforced; freezing the target in one shared object is how three repos stay honest to the same standard. `[Rubric §22, Responsive/Cross-Browser]` also applies via the pager exception below, which documents a specific cross-component limitation.
- **Walkthrough**: two static presets.
  - `Wcag21Aa` (`AxeOptions.cs:17`) sets `RunOnly` to `Type = "tag"` with the four WCAG A/AA tag values (`:19-23`), the default target for every strict scan.
  - `Wcag21AaExceptMudPagerCombobox` (`:35`) is the same tag set plus the `aria-input-field-name` rule disabled (`:42-45`), for grid list pages whose only violation is MudBlazor 9.6.0's unlabeled `MudTablePager` "rows per page" select. The XML doc (`:26-34`) records this as an accepted upstream limitation, not reachable from app markup, and warns it must be used only where the sole combobox is a pager.
- **Why it's built this way**: shipping the options in the package (not re-declaring them per test) guarantees every consumer scans the identical rule set; the narrowly scoped pager exception keeps one known third-party gap from forcing a blanket rule-disable across all scans.
- **Where it's used**: passed to [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync` through [E2ETestBase](#e2etestbase)`.ScanAsync` (strict) and `.ScanGridAsync` (pager exception), and directly by the `*_ShouldHaveNoAccessibilityViolations` facts on the workflow bases.

### E2ETestConfiguration

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8` · Level 0 · static class

- **What it is**: the single environment-variable-driven configuration surface for the whole E2E package: base URL, headless mode, timeouts, browser engine, slow-motion and trace capture, plus the nested [AdminCredentials](#admincredentials) and [UserCredentials](#usercredentials).
- **Depends on**: `System.Environment` (BCL) only.
- **Concept introduced, environment-driven test configuration.** Every knob resolves as "read an `E2E_*` environment variable, else use a default", so the same compiled test suite runs against localhost on a developer box and against a CI-provisioned host without a code change. A few `Default*` properties are settable so a consuming app can supply app-specific defaults through a `[ModuleInitializer]` while environment variables always take precedence (`E2ETestConfiguration.cs:3-7`). `[Rubric §17, DevOps]` assesses whether the suite is CI-portable and configurable outside the binary; this class is that story. `[Rubric §22, Responsive/Cross-Browser]` applies because `Browser` selects the engine CI iterates over.
- **Walkthrough**: teaching order.
  - `DefaultBaseUrl` (settable, `https://localhost:7108`, `E2ETestConfiguration.cs:10`) and `BaseUrl`, which prefers `E2E_BASE_URL` (`:12-13`).
  - `Headless` treats any value other than `"false"` as headless (`:15-16`); `SlowMo` slows each Playwright action by an env-set millisecond count for visual debugging (`:45-46`).
  - `DefaultTimeout` (30_000 ms, from `E2E_TIMEOUT`, `:18-19`) is the general action timeout; `AuthTimeout` (`:27-28`) is a separately tunable ceiling for the slowest step, the post-auth wait, inheriting `DefaultTimeout` unless `E2E_AUTH_TIMEOUT` is set; `AuthGraceTimeout` (15_000 ms, `E2E_AUTH_GRACE`, `:38-39`) is the extra grace window that de-flakes the register/login success-detection race (the transient error-alert flash during a Server-mode `forceLoad`).
  - `Browser` selects `chromium` (default), `firefox`, or `webkit` from `E2E_BROWSER` (`:53-54`); `TracePath` returns a non-empty `E2E_TRACE` path or null for full-speed Playwright trace capture (`:63-64`).
- **Why it's built this way**: separating `AuthTimeout` and `AuthGraceTimeout` from the general `DefaultTimeout` is deliberate: the auth round-trip (full sign-in plus `forceLoad` reload plus re-render) can spike past a normal action budget on a contended CI runner, so it is tuned independently rather than inflating every timeout in the suite. The doc ties the grace window to the TD-06/07 contention cluster (`:33-36`).
- **Where it's used**: read throughout [PlaywrightFixture](#playwrightfixture) (engine, headless, slow-mo) and [E2ETestBase](#e2etestbase) (base URL, timeouts, trace path, credentials).

### LoginPage

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6` · Level 0 · sealed class

- **What it is**: the Page Object for the shared `/login` screen: it exposes the login form's controls as named `ILocator` properties and offers `GotoAsync`/`LoginAsync` actions, so a test says `loginPage.LoginAsync(email, password)` instead of hand-querying the DOM.
- **Depends on**: `Microsoft.Playwright` (`IPage`, `ILocator`, `AriaRole`) and the [PageExtensions](#pageextensions) helpers `GotoAndWaitForBlazorAsync` and `FillAndVerifyAsync` (`LoginPage.cs:1-2`).
- **Concept introduced, the Page Object Model.** A Page Object wraps one screen behind an intention-revealing API, locating controls by their accessible name (`GetByLabel("Email")`, `GetByRole(AriaRole.Button, Name = "Sign in to your account")`) rather than by brittle CSS. That keeps tests coupled to what a user sees, not to MudBlazor's internal class names, and it centralizes each selector in one place. `[Rubric §28, Front-End Testing]` assesses whether E2E tests are maintainable; the Page Object is the canonical pattern for that. `[Rubric §21, Accessibility]` applies indirectly: locating by role and label only works if the component renders proper accessible names, so the test style pressures accessible markup.
- **Walkthrough**: a private `IPage` field set in the constructor (`LoginPage.cs:8-10`); locator properties for `EmailField`, `PasswordField`, `LoginButton`, `ErrorAlert`, and the `CreateAccountLink` (a MudButton with `Href`, so it renders as an `<a>` located by link role, `:12-18`). `GotoAsync` navigates via `GotoAndWaitForBlazorAsync("/login")` (`:20-21`); `LoginAsync` fills both fields through the shared `FillFieldAsync` then clicks (`:23-28`). The private `FillFieldAsync` delegates to [PageExtensions](#pageextensions)`.FillAndVerifyAsync` (`:31-32`), guarding the Blazor re-hydration race without a fixed delay.
- **Where it's used**: instantiated by [UserLoginTestsBase](#userlogintestsbase) for the invalid-password, create-account-link, and a11y facts.

### ProfilePage

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:6` · Level 0 · sealed class

- **What it is**: the Page Object for the authenticated `/profile` screen, exposing the name, address, and password sections' fields and buttons as named locators.
- **Depends on**: `Microsoft.Playwright` and [PageExtensions](#pageextensions)`.BlazorNavigateAsync` (`ProfilePage.cs:1-2`).
- **Concept**: the Page Object Model taught in [LoginPage](#loginpage). One difference is load-bearing: `GotoAsync` uses `BlazorNavigateAsync("/profile")` (client-side routing, `:34-35`), not a full page load, because `/profile` is `[Authorize]` and server-side rendering cannot read the JWT from browser storage (a full load would bounce to `/login`). `[Rubric §28, Front-End Testing]` and `[Rubric §11, Security]` both apply: exercising the authenticated page correctly requires respecting the client-token boundary.
- **Walkthrough**: three grouped sets of locators, name (`FirstNameField`, `LastNameField`, `SaveNameButton`, `:13-15`), address (`AddressLine1Field` through `CountryField` plus `SaveAddressButton`, `:18-24`), and password (`CurrentPasswordField`, `NewPasswordField` with `Exact = true` to disambiguate from "Confirm New Password", `ConfirmNewPasswordField`, `ChangePasswordButton`, `:27-30`), plus a generic `ErrorAlert` by alert role (`:32`). This Page Object has no bulk action method; each fact drives the individual locators.
- **Where it's used**: instantiated throughout [ProfileManagementTestsBase](#profilemanagementtestsbase).

### RegisterPage

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:6` · Level 0 · sealed class

- **What it is**: the Page Object for the `/register` screen, exposing the registration form (name, email, password, optional address panel) and a `RegisterAsync` action.
- **Depends on**: `Microsoft.Playwright` and [PageExtensions](#pageextensions)`.GotoAndWaitForBlazorAsync`/`FillAndVerifyAsync` (`RegisterPage.cs:1-2`).
- **Concept**: the Page Object Model taught in [LoginPage](#loginpage), applied to a longer form. `PasswordField` uses `GetByLabel("Password", Exact = true)` so it does not also match "Confirm Password" (`RegisterPage.cs:15`), and the optional address fields sit inside an expansion panel located by its text (`:23-29`). `[Rubric §28, Front-End Testing]` applies.
- **Walkthrough**: locator properties for the five required fields plus `RegisterButton` and `ErrorAlert` (`:12-18`), the `AlreadyHaveAccountLink` sign-in link (`:21`), and the optional address panel and fields (`:24-29`). `GotoAsync` full-loads `/register` (`:31-32`); `RegisterAsync` fills the five required fields via the shared helper (using the same password for confirm) and clicks (`:34-42`); the private `FillFieldAsync` delegates to [PageExtensions](#pageextensions)`.FillAndVerifyAsync` (`:48-49`).
- **Where it's used**: instantiated by [UserRegistrationTestsBase](#userregistrationtestsbase) and [UserLoginTestsBase](#userlogintestsbase).

### UserCredentials

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:78` · Level 0 · class

- **What it is**: the regular (non-admin) counterpart to [AdminCredentials](#admincredentials): a nested static class on [E2ETestConfiguration](#e2etestconfiguration) resolving the seeded customer login, env-override in front of a per-app default.
- **Depends on**: `System.Environment` (BCL).
- **Concept**: identical in shape to [AdminCredentials](#admincredentials); only the environment-variable names and defaults differ.
- **Walkthrough**: `DefaultEmail` = `"user@localhost"`, `DefaultPassword` = `"User123!"` (`E2ETestConfiguration.cs:80-81`); `Email`/`Password` prefer `E2E_CUSTOMER_EMAIL`/`E2E_CUSTOMER_PASSWORD` (`:83-87`).
- **Where it's used**: read by [E2ETestBase](#e2etestbase)`.LoginAsUserAsync` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:82-83`).

### WebVitalsSample

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:73` · Level 0 · record

- **What it is**: an immutable record holding one page's measured Core Web Vitals: `Lcp`, `Cls`, `Fcp`, `Ttfb`, and `Inp` (milliseconds, except unitless CLS).
- **Depends on**: `System.Text.Json.Serialization.JsonPropertyName` (BCL) for the lowercase wire names.
- **Concept introduced, the vitals value object.** Each property is `init`-only with a short JSON name (`lcp`, `cls`, `fcp`, `ttfb`, `inp`, `WebVitalsCollector.cs:75-83`), so the record deserializes directly from the `window.__vitals` JSON the browser observers accumulate. `[Rubric §23, Front-End Performance]` assesses whether client-side performance is measured; this record is the typed shape those measurements land in.
- **Walkthrough**: a sealed record with five `init` doubles (`WebVitalsCollector.cs:73-84`); it has no behavior, it is the deserialization target of [WebVitalsCollector](#webvitalscollector)`.CollectAsync` (`:53`).
- **Where it's used**: produced by [WebVitalsCollector](#webvitalscollector)`.CollectAsync` and wrapped by [WebVitalsArtifact](#webvitalsartifact) for the JSON artifact.

### PageExtensions

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:19` · Level 1 · static class

- **What it is**: the interactivity toolbox of the E2E package: C# `extension(T)` members over Playwright's `IPage` and `ILocator` that wait for Blazor to become interactive, navigate its InteractiveAuto pages correctly, fill and click through the re-hydration race, and run an axe-core accessibility scan.
- **Depends on**: `Microsoft.Playwright` (`IPage`, `ILocator`, `Assertions`), `Deque.AxeCore.Playwright`/`Commons` (`RunAxe`, `AxeRunOptions`), and `System.Text.RegularExpressions` (`PageExtensions.cs:1-5`). It throws [AccessibilityViolationException](#accessibilityviolationexception).
- **Concept introduced, waiting for Blazor InteractiveAuto interactivity.** The apps render with InteractiveAuto plus prerendering, so a page first appears as static HTML before the WASM runtime (or SignalR circuit) wires event handlers; a click or fill that lands in that window is silently ignored. These helpers replace fixed sleeps with signal-based waits, which is the difference between a flaky suite and a deterministic one. `[Rubric §28, Front-End Testing]` assesses whether the suite is reliable against real render timing; `[Rubric §21, Accessibility]` applies via the axe scan; `[Rubric §22, Responsive/Cross-Browser]` because the same waits must hold on all three engines. The type also carries the `extension(T)` DI-style member syntax used across the framework.
- **Walkthrough**: two extension blocks.
  - `extension(IPage page)`: `WaitForBlazorAsync` polls for `window.Blazor?._internal` then waits two animation frames plus a short delay for the render pipeline to flush (`PageExtensions.cs:27-41`); `GotoAndWaitForBlazorAsync` navigates, waits for `LoadState.Load` (not `NetworkIdle`, which never settles under a persistent SignalR socket), then waits for interactivity (`:47-54`); `BlazorNavigateAsync` drives Blazor's client-side router via `Blazor.navigateTo`, tolerating the context-destroyed race from a `forceLoad`, then polls `window.location.pathname` rather than `WaitForURLAsync` (whose default Load wait hangs on same-document nav) (`:62-95`); `GotoProtectedAsync` reaches an `[Authorize]` page by first ensuring Blazor is up (loading a public page if needed) then client-navigating, because SSR cannot read the JWT from storage (`:104-135`); `WaitForPageAndBlazorAsync` covers a full-page navigation's load-plus-render settle (`:141-149`); `AssertNoAccessibilityViolationsAsync` runs `RunAxe` (with optional [AxeOptions](#axeoptions)), and on any violation builds a per-node summary and throws [AccessibilityViolationException](#accessibilityviolationexception) (`:157-182`).
  - `extension(ILocator locator)`: `FillAndVerifyAsync` fills then auto-waits `ToHaveValueAsync`, and on a wiped value re-types character-by-character and re-asserts, the single shared fill helper that defeats the re-hydration race (`:197-216`); `ClickAndVerifyAsync` clicks a submit button and polls for the visible effect, re-asserting interactivity and re-clicking a no-op click without double-submitting a successful one (`:230-261`); `ClickAndWaitForUrlAsync` clicks a navigating link and re-clicks until the URL matches, for grid rows whose cells wrap content in `MudLink` (`:273-296`).
  - The private `CompactHtml` collapses a violating node's markup to one trimmed line for the failure message (`:305-314`).
- **Why it's built this way**: the fill and click helpers exist because InteractiveAuto's prerender-then-hydrate model makes a bare fill or click a race on a fast host; auto-waiting assertions with a bounded re-type/re-click are strictly safer than fixed delays (they succeed as soon as the value or effect appears, and only retry a genuine no-op). Two `[SuppressMessage]` attributes document analyzer false positives across the `extension(T)` boundary: CA1708 on the class (`:15-18`) and IDE0051 on `CompactHtml` (`:301-304`).
- **Where it's used**: throughout the Page Objects ([LoginPage](#loginpage), [ProfilePage](#profilepage), [RegisterPage](#registerpage)), [E2ETestBase](#e2etestbase) (its `FillFieldAsync`, `ScanAsync`, `ScanGridAsync`), and the workflow bases.

### PlaywrightFixture

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6` · Level 1 · sealed class

- **What it is**: the xUnit collection fixture that owns the Playwright driver and one launched browser for the whole E2E collection, selecting the engine from the environment.
- **Depends on**: `Microsoft.Playwright` (`IPlaywright`, `IBrowser`, `BrowserTypeLaunchOptions`) and xUnit's `IAsyncLifetime` (`PlaywrightFixture.cs:1-2`). It reads [E2ETestConfiguration](#e2etestconfiguration).
- **Concept introduced, the shared browser fixture.** Launching a browser is expensive, so one instance is created once per test collection and shared across every test, rather than per test. `InitializeAsync` builds the Playwright driver, maps `E2E_BROWSER` to Chromium/Firefox/WebKit (unknown values fall back to Chromium), and launches it with the headless and slow-mo settings; `DisposeAsync` tears both down. `[Rubric §22, Responsive/Cross-Browser]` assesses cross-engine coverage; env-selecting the engine here is what lets CI run the identical suite once per browser. `[Rubric §14, Testability]` applies: sharing one costly resource keeps the suite fast.
- **Walkthrough**: `Playwright` and `Browser` are exposed with private setters (`PlaywrightFixture.cs:8-9`). `InitializeAsync` creates the driver (`:13`), switches on `E2ETestConfiguration.Browser.ToUpperInvariant()` to pick the browser type (`:17-22`), and launches with `Headless`/`SlowMo` from config (`:24-28`). `DisposeAsync` suppresses finalization, disposes the browser, then the driver (`:31-36`).
- **Where it's used**: bound to the collection by [E2ETestCollection](#e2etestcollection) and injected into every [E2ETestBase](#e2etestbase) subclass, which creates a fresh browser context per test off the shared `Browser`.

### WebVitalsArtifact

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:87` · Level 1 · record

- **What it is**: the small envelope record written to disk as `web-vitals-{label}.json`: a `Label`, the page `Path`, and the measured [WebVitalsSample](#webvitalssample).
- **Depends on**: [WebVitalsSample](#webvitalssample); serialized with `System.Text.Json`.
- **Concept**: the citable-artifact wrapper. Pairing the raw vitals with the label and path they were taken on makes the JSON file self-describing for a CI reviewer. `[Rubric §23, Front-End Performance]` assesses whether performance evidence is captured and traceable; the envelope is what makes an uploaded artifact interpretable.
- **Walkthrough**: a three-parameter positional `sealed record` (`WebVitalsCollector.cs:87`), constructed inside [WebVitalsCollector](#webvitalscollector)`.WriteArtifactAsync` and serialized indented (`:66-68`).
- **Where it's used**: only by [WebVitalsCollector](#webvitalscollector)`.WriteArtifactAsync`.

### E2ETestCollection

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:40` · Level 2 · sealed class

- **What it is**: the xUnit `[CollectionDefinition]` that binds [PlaywrightFixture](#playwrightfixture) to the named `"E2E"` collection, so every E2E test class shares the one launched browser.
- **Depends on**: xUnit's `ICollectionFixture<PlaywrightFixture>` and the `[CollectionDefinition]` attribute (`PlaywrightFixture.cs:39-40`).
- **Concept introduced, the xUnit collection fixture binding.** A collection fixture is instantiated once and shared by all test classes that opt into the collection by name. This class carries a `public const string Name = "E2E"` (`PlaywrightFixture.cs:42`) used both in its own `[CollectionDefinition(Name)]` and in each test's `[Collection(E2ETestCollection.Name)]`, so the string is declared once and cannot drift. `[Rubric §14, Testability]` assesses fixture design; a single named constant binding is the robust way to share a fixture.
- **Walkthrough**: an empty class body carrying the collection definition and the `Name` constant (`PlaywrightFixture.cs:39-43`); it exists purely as an xUnit marker.
- **Where it's used**: referenced by [E2ETestBase](#e2etestbase)'s `[Collection(E2ETestCollection.Name)]` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:7`), so every workflow base inherits collection membership.

### WebVitalsCollector

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:17` · Level 2 · static class

- **What it is**: the measurement infrastructure for client-side Core Web Vitals: it installs browser `PerformanceObserver` scripts before first paint, reads the accumulated values back off a live page, and writes them as a citable JSON artifact.
- **Depends on**: `Microsoft.Playwright` (`IPage`), `System.Text.Json`, and `System.IO` (`WebVitalsCollector.cs:1-3`). It produces [WebVitalsSample](#webvitalssample) and [WebVitalsArtifact](#webvitalsartifact).
- **Concept introduced, in-browser performance measurement with no third-party JS.** Rather than shipping an analytics SDK, it injects a small init script that installs `PerformanceObserver`s for LCP, CLS, FCP, and INP, each wrapped in try/catch so an engine lacking an entry type leaves that metric at 0 instead of throwing, and accumulates into `window.__vitals` (`WebVitalsCollector.cs:23-32`). This is the client-side analogue of a backend load test, not a cross-engine field measurement (LCP/CLS are Chromium-only, so on Firefox/WebKit those fields stay 0 and budget assertions pass). `[Rubric §23, Front-End Performance]` and `[Rubric §12, Performance & Scalability]` assess whether real user-centric performance is measured; observing the vitals APIs directly, with no network egress, is a self-contained way to do it. The type-level doc states it is only the measurement infrastructure: consumers keep their own budget-asserting tests (`:14-15`).
- **Walkthrough**: `InstallAsync` registers the observers via `AddInitScriptAsync` so they are active on the next navigation (`WebVitalsCollector.cs:37-41`); `CollectAsync` evaluates a script that stamps TTFB from Navigation Timing and returns `window.__vitals` as JSON, deserialized to a [WebVitalsSample](#webvitalssample) (`:44-54`); `WriteArtifactAsync` resolves the output directory from `WEB_VITALS_OUTPUT_DIR` (or `artifacts/` under the CWD), wraps the sample in a [WebVitalsArtifact](#webvitalsartifact), and writes `web-vitals-{label}.json` indented (`:60-69`).
- **Why it's built this way**: the observers install before the document's own scripts (via `AddInitScript`) so early metrics like FCP are not missed; the per-observer try/catch is what makes the same code run green on all three engines despite Chromium-only metrics. The init script is kept as one concatenated string to stay clear of the MA0136 analyzer (`:19-22`).
- **Where it's used**: called by the consumer repos' Web-Vitals budget tests (for example ADC's E2E suite), which install, navigate, collect, assert against a budget, and write the artifact for CI upload.

### E2ETestBase

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:8` · Level 3 · abstract class

- **What it is**: the shared base every E2E test class derives from. It gives each test a fresh isolated browser context and page off the shared [PlaywrightFixture](#playwrightfixture) browser, plus the load-bearing auth helpers (login, register, deterministic logout cleanup) and the accessibility scan helpers.
- **Depends on**: [PlaywrightFixture](#playwrightfixture), [E2ETestConfiguration](#e2etestconfiguration), [AxeOptions](#axeoptions), the [PageExtensions](#pageextensions) helpers, xUnit's `IAsyncLifetime` and `TestContext`, and `Microsoft.Playwright` (`E2ETestBase.cs:1-3`).
- **Concept introduced, the per-test browser context.** The fixture launches one browser; this base opens a new `IBrowserContext` (an isolated cookie/storage jar) per test in `InitializeAsync` and disposes it in `DisposeAsync`, so tests do not leak session state into each other (`E2ETestBase.cs:19-49`). It is the E2E analogue of the integration-test base's per-test database reset. `[Rubric §28, Front-End Testing]` assesses realistic, isolated UI tests; `[Rubric §21, Accessibility]` via the scan helpers; `[Rubric §14, Testability]` via the shared, correctly-sequenced auth helpers that every workflow reuses. The auth-result handling also touches `[Rubric §22, Responsive/Cross-Browser]` since the same waits must survive Server-mode and WASM render timing on any engine.
- **Walkthrough**: teaching order.
  - Lifecycle: `InitializeAsync` creates a context with `IgnoreHTTPSErrors` and the base URL, sets the default timeout, optionally starts trace capture when `TracePath` is set, and opens the `Page` (`E2ETestBase.cs:19-37`); `DisposeAsync` stops tracing (writing a failure-only trace when `E2E_TRACE` names a directory), closes the page, and disposes the context (`:39-77`).
  - Auth entry points: `LoginAsAdminAsync`/`LoginAsUserAsync` (`:79-83`) delegate to `LoginAsync`, which first clears any existing session (covering both localStorage tokens and the HttpOnly session cookie via a `DELETE /auth/session-cookie`, guarded against the context-destroyed race), navigates to `/login`, fills through `FillFieldAsync`, clicks, then awaits `WaitForAuthResultAsync` and `WaitForInteractiveOrReloadAsync` (`:85-132`). `RegisterNewUserAsync` generates a unique email, fills the register form, submits, and runs the same post-auth waits, returning the created credentials (`:134-167`).
  - Post-auth robustness: `WaitForInteractiveOrReloadAsync` waits for interactivity and, on either a `PlaywrightException` or a `TimeoutException`, reloads once and re-waits rather than re-watching a stuck boot (the fix documented against a real contended-runner failure, `:169-191`); `WaitForAuthResultAsync` races three signals (leaving the auth page, the logout button appearing, or an error alert) so success detection does not depend on the interactive button having hydrated, treating only a persistent on-page error alert as a real failure (`:193-224`); `AuthSucceededWithinGraceAsync` extends that with the grace window (`:226-247`).
  - Helpers: `NavigateAndWaitAsync` (`:249-250`), the shared `FillFieldAsync` delegating to [PageExtensions](#pageextensions)`.FillAndVerifyAsync` (`:257-258`), `UniqueId` (`:260`), and the two scan helpers: `ScanGridAsync` waits for a data row and zero progressbars then scans with [AxeOptions](#axeoptions)`.Wcag21AaExceptMudPagerCombobox` (`:271-277`), while `ScanAsync` scans the settled page strictly with `Wcag21Aa` (`:281-285`).
- **Why it's built this way**: the auth helpers encode hard-won timing knowledge (the `forceLoad` reload, the Server-vs-WASM hydration lag, the cookie-vs-localStorage dual session store) once, so every consumer workflow inherits a deterministic sign-in rather than re-deriving the races. Clearing both token stores is essential: the Blazor Server host is cookie-only, so a localStorage clear alone would leave the next login authenticated as the wrong user (`:88-92`). The scan split lets grid pages accept the documented pager-combobox exception while every other page stays strict.
- **Where it's used**: the base class of all six workflow bases in this unit ([AuthorizationTestsBase](#authorizationtestsbase), [LogoutTestsBase](#logouttestsbase), [ProfileManagementTestsBase](#profilemanagementtestsbase), [UserLoginTestsBase](#userlogintestsbase), [UserPreferencesTestsBase](#userpreferencestestsbase), [UserRegistrationTestsBase](#userregistrationtestsbase)) and, through them, every consumer repo's E2E suite.

### AuthorizationTestsBase

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:18` · Level 4 · abstract class

- **What it is**: the reusable authorization workflow fitness base: authored once, re-run as a thin subclass per repo. It asserts anonymous users are redirected off protected paths, public paths stay reachable, a registered non-admin can reach an authenticated page, and a non-admin probing admin routes hits the Forbidden page.
- **Depends on**: [E2ETestBase](#e2etestbase), [PageExtensions](#pageextensions) (`GotoAndWaitForBlazorAsync`, `GotoProtectedAsync`), AwesomeAssertions, and `Microsoft.Playwright` (`AuthorizationTestsBase.cs:1-6`).
- **Concept introduced, the authored-once workflow fitness base.** The pattern shared by all six bases in this unit: the framework owns the assertions and the SSR/client-navigation mechanics, and each consumer supplies only its own route lists through abstract/virtual members, so identical security behavior is verified across repos without copying test bodies. `[Rubric §11, Security]` assesses whether authorization is actually exercised; this base machine-checks both the anonymous-redirect and the authenticated-non-admin-escalation directions. `[Rubric §25, Navigation & IA]` applies because it pins which routes are public versus gated.
- **Walkthrough**: the subclass supplies `ProtectedPaths`, `PublicPaths` (abstract, `AuthorizationTestsBase.cs:26-29`), and optionally `AuthenticatedUserPath` and `AdminPaths` (virtual, `:35`, `:44`). Four facts: `AnonymousUser_ProtectedPages_ShouldRedirectToLogin` asserts each protected path bounces to `/login` (`:46-58`); `AnonymousUser_PublicPages_ShouldBeAccessible` asserts each public path stays put (`:60-72`); `RegisteredUser_AuthenticatedPage_ShouldBeAccessible` registers a non-admin then client-navigates via `GotoProtectedAsync` (SSR cannot read the JWT), passing vacuously when no path is declared (`:74-93`); `RegisteredUser_AdminPages_ShouldBeForbidden` registers a non-admin then asserts each admin path renders the shared Forbidden page (`h1[role='alert']` containing "Access Denied"), noting role denial is not a redirect so the page content is the only reliable signal (`:95-120`).
- **Why it's built this way**: the two optional-path members use a no-dynamic-skip convention (an app with no such page simply passes) because the shipped library deliberately does not reference xunit.v3.assert for a declared skip (`:77-78`). The non-empty assertions on `ProtectedPaths`/`PublicPaths` (`:49-50`, `:63-64`) are non-vacuity guards: a repo that declares no paths fails rather than passing silently.
- **Where it's used**: subclassed in each consumer repo's E2E suite (Store, ADC) with that app's route lists.

### LogoutTestsBase

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/LogoutTestsBase.cs:9` · Level 4 · abstract class

- **What it is**: the reusable logout workflow base: it verifies sign-out returns to `/login` and that a logged-out user can no longer reach a protected page.
- **Depends on**: [E2ETestBase](#e2etestbase), [PageExtensions](#pageextensions) (`WaitForBlazorAsync`), AwesomeAssertions, and `Microsoft.Playwright` (`LogoutTestsBase.cs:1-5`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase). `[Rubric §11, Security]` assesses session teardown; this base guards that logout genuinely revokes access, not just visually returns to a login screen.
- **Walkthrough**: two facts. `Logout_ShouldRedirectToLoginPage` registers, confirms the sign-out button, clicks it, and asserts the sign-in button reappears (`LogoutTestsBase.cs:16-29`). `Logout_ShouldPreventAccessToProtectedPages` registers, waits for interactivity, then clicks sign-out inside `RunAndWaitForResponseAsync` so it blocks until the best-effort `DELETE /auth/session-cookie` completes (`:31-51`), then re-requests `/profile` up to six times until the server redirects to `/login` (`:64-72`), falling back to a clear URL assertion if it never does (`:75`).
- **Why it's built this way**: waiting for the cookie-clear response is the fix for a real full-speed race: at speed the test otherwise reaches `/profile` before the DELETE finishes, so the HttpOnly cookie is still present and SSR re-authenticates. The bounded re-request loop converges deterministically where a slowdown (slow-mo or trace capture) would have hidden the race entirely (`:42-46`, `:57-63`).
- **Where it's used**: subclassed in each consumer repo's E2E suite.

### ProfileManagementTestsBase

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/ProfileManagementTestsBase.cs:11` · Level 4 · abstract class

- **What it is**: the reusable profile workflow base: it verifies name, address, and password changes persist, that the profile page loads with the registered data, an opt-in email-change journey, and that the profile page is accessibility-clean.
- **Depends on**: [E2ETestBase](#e2etestbase), [ProfilePage](#profilepage), [PageExtensions](#pageextensions), AwesomeAssertions, and `Microsoft.Playwright` (`ProfileManagementTestsBase.cs:1-7`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase), here driving a [ProfilePage](#profilepage). `[Rubric §24, Forms/Validation/UX Safety]` assesses whether edit-and-persist journeys work end to end; `[Rubric §21, Accessibility]` via the a11y fact.
- **Walkthrough**: a `ProfileSupportsEmailChange` virtual, off by default (`ProfileManagementTestsBase.cs:24`). Six facts: `ChangeName_ShouldUpdateProfileName` and `ChangeAddress_ShouldUpdateProfileAddress` edit, save, reload, and assert persistence (`:26-78`); `ChangePassword_WithValidCurrentPassword_ShouldSucceed` changes the password, then logs out and back in with the new one, waiting for the logout `forceLoad`'s `/login` URL rather than `LoadState.Load` to avoid racing the in-flight navigation (`:80-110`); `ChangeEmail_ShouldUpdateEmail` is opt-in and passes vacuously unless `ProfileSupportsEmailChange` is overridden true (`:112-146`); `ProfilePage_ShouldLoadWithUserData` asserts the form is pre-filled from registration (`:148-166`); `ProfilePage_ShouldHaveNoAccessibilityViolations` scans with [AxeOptions](#axeoptions)`.Wcag21Aa` (`:168-181`).
- **Why it's built this way**: the email-change fact is a declared opt-in rather than a DOM probe because the previous probing version passed vacuously when the field was absent, reporting coverage for a journey the app does not offer; overriding the flag makes a missing field fail loud (`:18-23`). The logout-then-login URL wait is called out as the last site still on the racy pattern, fixed to match `UserLoginTestsBase` (`:100-105`).
- **Where it's used**: subclassed in each consumer repo's E2E suite.

### UserLoginTestsBase

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/UserLoginTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: the reusable login workflow base: valid credentials reach the home page and show the authenticated app bar, invalid credentials show an error and stay on `/login`, the create-account link navigates to `/register`, and the login page is accessibility-clean.
- **Depends on**: [E2ETestBase](#e2etestbase), [LoginPage](#loginpage), [PageExtensions](#pageextensions), and `Microsoft.Playwright` (`UserLoginTestsBase.cs:1-6`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase), here driving a [LoginPage](#loginpage). `[Rubric §28, Front-End Testing]` and `[Rubric §11, Security]` apply.
- **Walkthrough**: four facts. `Login_WithValidCredentials_ShouldNavigateToHomePage` registers (which auto-logs-in), logs out waiting for the `/login` URL (not `LoadState.Load`, to avoid racing the in-flight logout), logs back in, and asserts the URL left `/login`, the sign-out button is visible, and the sign-in link is not (`UserLoginTestsBase.cs:17-41`). `Login_WithInvalidPassword_ShouldShowError` drives `LoginPage.LoginAsync` with bad credentials and asserts the error alert plus staying on `/login` (`:43-57`). `Login_NavigateToCreateAccount_ShouldGoToRegisterPage` clicks the create-account link and asserts `/register` (`:59-71`). `LoginPage_ShouldHaveNoAccessibilityViolations` scans with [AxeOptions](#axeoptions)`.Wcag21Aa` (`:73-84`).
- **Why it's built this way**: the explicit wait for the logout `forceLoad`'s `/login` URL (`:23-28`) is the fix (v1.103.1) for the sign-out-then-login race where the pre-login cleanup evaluate died with "execution context was destroyed".
- **Where it's used**: subclassed in each consumer repo's E2E suite.

### UserPreferencesTestsBase

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Preferences` · `MMCA.Common.Testing.E2E/Workflows/Preferences/UserPreferencesTestsBase.cs:21` · Level 4 · abstract class

- **What it is**: the reusable culture-switch and theme-toggle workflow base: it verifies switching to Spanish localizes and persists, toggling dark mode applies and persists, and that both controls are reachable on a mobile viewport.
- **Depends on**: [E2ETestBase](#e2etestbase), [PageExtensions](#pageextensions) (`GotoAndWaitForBlazorAsync`), AwesomeAssertions, and `Microsoft.Playwright` (`UserPreferencesTestsBase.cs:1-5`).
- **Concept introduced, the self-contained preferences fitness base.** Unlike the identity bases it needs no app-specific overrides: the probe page is the shared `/login`, the probe string is the localized "Welcome Back"/"Bienvenido de nuevo", and persistence is the anonymous cookie pair (`.AspNetCore.Culture` plus `mmca_theme`), all owned by Common UI in every app (`UserPreferencesTestsBase.cs:9-20`). `[Rubric §27, i18n]` assesses whether localization actually switches and persists; `[Rubric §20, Design System & Theming]` for the theme toggle; `[Rubric §22, Responsive/Cross-Browser]` for the mobile-parity fact.
- **Walkthrough**: a dark-background probe script accepting either the hex or rgba palette value (`UserPreferencesTestsBase.cs:25-28`), and desktop/mobile action-cluster locators scoped by container to disambiguate the duplicated NavMenu controls (`:37-39`). Three facts: `CultureSwitch_ToSpanish_ShouldLocalizeAndPersist` picks Espanol from the language menu and asserts the Spanish probe survives a reload (`:41-64`); `ThemeToggle_ToDark_ShouldApplyAndPersist` toggles dark, asserts the palette variable flipped and `mmca_theme` is persisted in localStorage, then survives a reload (`:66-85`); `MobileViewport_CultureAndTheme_ShouldBeReachable` sets a 390x844 viewport and asserts the controls come from NavMenu's top row (`:87-101`).
- **Why it's built this way**: the mobile fact pins the v1.103.0 regression where the controls lived only in the app bar, hidden below 1024px; the selectors mirror the gallery's own tests exactly because the MudMenu activator exposes no literal `aria-label`, so raw CSS attribute selectors do not match it (`:14-19`). It cites ADR-027/028 for the localization and theming mechanics.
- **Where it's used**: subclassed in each consumer repo's E2E suite.

### UserRegistrationTestsBase

> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common.Testing.E2E/Workflows/Identity/UserRegistrationTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: the reusable registration workflow base: valid data navigates to the home page and logs in, mismatched passwords show the validation message and stay on `/register`, a duplicate email shows an error, and the register page is accessibility-clean.
- **Depends on**: [E2ETestBase](#e2etestbase), [RegisterPage](#registerpage), [PageExtensions](#pageextensions) (`FillAndVerifyAsync`), and `Microsoft.Playwright` (`UserRegistrationTestsBase.cs:1-6`).
- **Concept**: the authored-once workflow base taught in [AuthorizationTestsBase](#authorizationtestsbase), here driving a [RegisterPage](#registerpage). `[Rubric §24, Forms/Validation/UX Safety]` assesses client-side validation and duplicate handling; `[Rubric §21, Accessibility]` via the a11y fact.
- **Walkthrough**: four facts. `Register_WithValidData_ShouldNavigateToHomePage` registers a unique user and asserts the URL left `/register` and the sign-out button is visible (`UserRegistrationTestsBase.cs:17-34`). `Register_WithMismatchedPasswords_ShouldShowError` fills through the re-hydration-safe helper, submits once, and asserts the inline "Passwords do not match" validation text plus staying on `/register` (`:36-63`). `Register_WithDuplicateEmail_ShouldShowError` registers, then re-registers the same email and asserts the error alert (`:65-79`). `RegisterPage_ShouldHaveNoAccessibilityViolations` scans with [AxeOptions](#axeoptions)`.Wcag21Aa` (`:81-92`).
- **Why it's built this way**: the mismatched-passwords fact submits exactly once and asserts the field-level validation text (present in both Server and WASM render modes) rather than re-clicking, because the `[Compare]` validation fires `OnInvalidSubmit` and a re-clicking helper would make the alert flicker out from under the wait (`:43-47`, `:56-60`).
- **Where it's used**: subclassed in each consumer repo's E2E suite.

### BunitInteractionExtensions

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:12` · Level 0 · class

- **What it is**: A static class of intention-revealing helpers over bUnit's rendered-component API so component tests read as user actions ("click the Save button", "does this text appear") instead of hand-rolled DOM queries. It deliberately prefers accessible visible text over brittle CSS-path selectors (`BunitInteractionExtensions.cs:7-11`).
- **Depends on**: bUnit's `IRenderedComponent<TComponent>` and its `FindAll`/`Markup` surface, `AngleSharp.Dom.IElement` (the DOM node type bUnit exposes), and `Microsoft.AspNetCore.Components.IComponent` (the generic constraint). No first-party dependencies.
- **Concept introduced: C# `extension(T)` members applied to a test API.** Rather than classic `this`-parameter extension methods, this class uses the preview `extension<TComponent>(IRenderedComponent<TComponent> cut)` block (`BunitInteractionExtensions.cs:14-16`), the same construct the codebase uses for DI registration (see [primer](00-primer.md#c-extensiont-types-read-this-once)). Every member inside the block reads `cut` as if it were an instance receiver. `[Rubric §28 - Front-End Testing]` assesses whether the UI has real component-level coverage that is cheap to write and read; grounding assertions in visible text is what keeps those tests resilient to markup refactors.
- **Walkthrough**: `FindButtonByText(text)` (line 18) scans `cut.FindAll("button")` and returns the first `<button>` whose `TextContent` contains `text` case-insensitively (lines 20-21); on no match it throws an `InvalidOperationException` that lists every button text present (lines 22-24), so a failing test names the actual buttons instead of a bare null-reference. `ClickButtonByText(text)` (line 28) delegates to `FindButtonByText` and calls `.Click()` on the result. `HasText(text)` (line 32) is a boolean over `cut.Markup.Contains(text, StringComparison.OrdinalIgnoreCase)` for simple presence assertions.
- **Why it's built this way**: The diagnostic-rich throw (listing available button texts) turns the most common component-test failure, a label that moved, from an opaque null into a self-explaining message, which is the whole point of a shared test-helper layer.
- **Where it's used**: By every bUnit test class that subclasses [BunitComponentTestBase](#bunitcomponenttestbase) across the MMCA repos.

### CapturedRequest

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:129` · Level 0 · record

- **What it is**: An immutable snapshot of one HTTP request a UI service sent through the test handler: method, full URI, absolute path, path plus query, Authorization header, and body text (`CapturingHttpMessageHandler.cs:125-135`).
- **Depends on**: BCL `System.Net.Http.HttpMethod` and `System.Uri` only.
- **Concept introduced**: The "record the interaction, assert on it later" side of a test double. Where a mock verifies calls inline, this positional `record` (line 129) preserves each request so a test can assert on the wire-level shape after the fact. `[Rubric §14 - Testability]` assesses how observable a component's outbound behavior is under test; capturing the exact Authorization header and serialized body is what lets a test prove the UI service attached the bearer token and posted the right payload.
- **Walkthrough**: Six positional members: `Method`, `Uri` (nullable), `Path`, `PathAndQuery`, `Authorization` (nullable, `null` when the request carried no Authorization header), and `Body` (nullable, `null` when the request had no content). The handler populates it in `CaptureAsync` (`CapturingHttpMessageHandler.cs:81-87`), reading `uri?.AbsolutePath` and `uri?.PathAndQuery` and the stringified `request.Headers.Authorization`.
- **Where it's used**: Exposed as the element type of [CapturingHttpMessageHandler](#capturinghttpmessagehandler)'s `Requests` list and `RequestsFor(...)` query.

### FreshApiClientFactory

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:73` · Level 0 · class

- **What it is**: An `IHttpClientFactory` test double that returns a brand-new `HttpClient` on every `CreateClient` call, all wired to one shared handler at a fixed base address. It is a primary-constructor class taking the shared `HttpMessageHandler` and the base `Uri` (`UiHttpServiceHarness.cs:73`).
- **Depends on**: BCL `System.Net.Http.IHttpClientFactory`/`HttpClient`/`HttpMessageHandler`.
- **Concept introduced: the "fresh instance per call is load-bearing" contract.** The real MMCA UI HTTP services dispose their `HttpClient` after each request. A factory that cached and returned the same instance would hand the second call a disposed client. So `CreateClient(name)` (line 79) always constructs `new HttpClient(handler, disposeHandler: false)` (line 80), ignoring the requested name (typically `"APIClient"`) and passing `disposeHandler: false` so the shared handler outlives each short-lived client. `[Rubric §14 - Testability]`: matching the production disposal contract in the double is what keeps the test faithful to how the service actually manages its clients.
- **Walkthrough**: A single member, `CreateClient(string name)` (line 79), returning a new client on the shared `handler` with `BaseAddress = baseAddress` so services can issue relative URIs. The name argument is accepted for interface compatibility but unused.
- **Why it's built this way**: See the class remarks (`UiHttpServiceHarness.cs:66-72`): caching the client would leak a disposed instance into later calls, so a fresh client per call is a correctness requirement, not an optimization.
- **Where it's used**: Constructed inside [UiHttpServiceHarness](#uihttpserviceharness) (`UiHttpServiceHarness.cs:47`) and offered standalone through [HttpTestDoubles](#httptestdoubles)`.ClientFactory(...)`.

### IsAuthenticatedAuthorizationService

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:111` · Level 0 · class

- **What it is**: A private nested `IAuthorizationService` used inside [BunitComponentTestBase](#bunitcomponenttestbase) that authorizes any authenticated user and refuses anyone anonymous, regardless of the specific policy or requirement asked for (`BunitComponentTestBase.cs:111`).
- **Depends on**: `Microsoft.AspNetCore.Authorization.IAuthorizationService`/`AuthorizationResult`/`IAuthorizationRequirement`, and BCL `System.Security.Claims.ClaimsPrincipal`.
- **Concept introduced**: A coarse authorization stub for component tests. Component tests care about the two branches every `<AuthorizeView>` or `[Authorize]` page has, signed in versus signed out, not about reproducing the app's real policy set. This double collapses all policies to a single question: is the principal authenticated. `[Rubric §11 - Security]` assesses how authorization is modeled; substituting a real policy evaluator with an is-authenticated check is a deliberate test-time simplification, so a bUnit test verifies a component's *render response* to authz, not the authz rules themselves (those are pinned by the fitness bases in the overview).
- **Walkthrough**: The requirements overload of `AuthorizeAsync` (line 113) returns `AuthorizationResult.Success()` when `user.Identity?.IsAuthenticated == true`, else `AuthorizationResult.Failed()` (lines 115-117). The policy-name overload (line 119) forwards to the requirements overload with an empty requirement array, so a policy name and a requirement set both resolve to the same authenticated check.
- **Where it's used**: Registered as a singleton `IAuthorizationService` in the [BunitComponentTestBase](#bunitcomponenttestbase) constructor (`BunitComponentTestBase.cs:45`).

### MarkupSnapshotResult

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:104` · Level 0 · record struct

- **What it is**: The outcome of a [MarkupSnapshot](#markupsnapshot) comparison: a `readonly record struct` pairing `IsMatch` (true when the markup matched the committed baseline, or was refreshed) with a human-readable `Message` (`MarkupSnapshot.cs:101-104`).
- **Depends on**: nothing beyond the BCL.
- **Concept introduced: the dependency-free result object.** Because `MMCA.Common.Testing.UI` ships as a NuGet package, `MarkupSnapshot.Match` deliberately returns this value type instead of throwing an assertion-library exception, so the package pulls in no assertion dependency of its own (`MarkupSnapshot.cs:11-12`). The caller asserts on `.IsMatch` with whatever library it already uses, passing `.Message` as the failure text. `[Rubric §28 - Front-End Testing]`: keeping the shipped helper assertion-agnostic is what lets every consumer repo adopt golden-markup testing without a forced test-framework choice.
- **Walkthrough**: Two positional members, `bool IsMatch` and `string Message`. A `readonly record struct` gives value semantics with no heap allocation per comparison.
- **Where it's used**: Returned from [MarkupSnapshot](#markupsnapshot)`.Match(...)`; the caller reads `IsMatch`/`Message`.

### MudProviderHandles

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:92` · Level 0 · record

- **What it is**: A protected sealed record nested in [BunitComponentTestBase](#bunitcomponenttestbase) that bundles the three rendered MudBlazor infrastructure providers (popover, dialog, snackbar) so a test can query their markup after opening a dialog or raising a toast (`BunitComponentTestBase.cs:91-95`).
- **Depends on**: bUnit's `IRenderedComponent<T>` and MudBlazor's `MudPopoverProvider`/`MudDialogProvider`/`MudSnackbarProvider`.
- **Concept introduced**: The MudBlazor overlay providers render outside a component's own markup subtree, so a component that opens a `MudMessageBox` or raises a snackbar has nowhere to render unless those providers are mounted in the test root first. This record is just the return channel for those three handles. `[Rubric §14 - Testability]`: exposing the providers as named handles is what lets a test click into a dialog's confirm button or read a toast's text.
- **Walkthrough**: Three positional members, `Popover`, `Dialog`, and `Snackbar`, each an `IRenderedComponent<...>` for the corresponding provider. The record is produced by `RenderMudProviders()` (`BunitComponentTestBase.cs:83-89`), which renders each provider and wraps the three in this record.
- **Where it's used**: Returned by [BunitComponentTestBase](#bunitcomponenttestbase)`.RenderMudProviders()`; tests query `Dialog` for message-box markup and `Snackbar` for toasts.

### MutableAuthenticationStateProvider

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:97` · Level 0 · class

- **What it is**: A private nested `AuthenticationStateProvider` inside [BunitComponentTestBase](#bunitcomponenttestbase) whose current principal can be swapped mid-test, notifying listeners each time (`BunitComponentTestBase.cs:97-109`).
- **Depends on**: `Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider`/`AuthenticationState`, and BCL `ClaimsPrincipal`.
- **Concept introduced**: Why *mutable* rather than a hardcoded-anonymous stub. The class remarks (`BunitComponentTestBase.cs:20-23`) explain it is a superset of a fixed provider: it serves both cascading `AuthenticationState` consumers and pages that call `GetAuthenticationStateAsync()` on the injected service directly, and it can flip the principal after render to simulate a login/logout during a test. `[Rubric §19 - State Management]` assesses how auth state flows through the component tree; a single mutable provider that raises `NotifyAuthenticationStateChanged` is what makes both the cascade and mid-test transitions observable.
- **Walkthrough**: A primary constructor takes the `initial` principal into the private `_principal` field (lines 97-99). `SetPrincipal(principal)` (line 101) stores the new principal and calls `NotifyAuthenticationStateChanged(Task.FromResult(new AuthenticationState(principal)))` (line 104) so subscribed `<AuthorizeView>` and `CascadingAuthenticationState` re-evaluate. `GetAuthenticationStateAsync()` (line 107) returns the current principal wrapped in an `AuthenticationState`.
- **Where it's used**: Held as the `_authProvider` field in [BunitComponentTestBase](#bunitcomponenttestbase) (`BunitComponentTestBase.cs:38`), registered as the singleton `AuthenticationStateProvider` (line 46) and driven by `SetUser`/`RenderAs`.

### Route

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:110` · Level 0 · record

- **What it is**: A private nested record inside [CapturingHttpMessageHandler](#capturinghttpmessagehandler) representing one registered canned response: the matching HTTP method and absolute path plus the status code and optional JSON body to return (`CapturingHttpMessageHandler.cs:110`).
- **Depends on**: BCL `System.Net.Http.HttpMethod`, `System.Net.HttpStatusCode`, `StringContent`, and `System.Text.Encoding`.
- **Concept introduced**: A canned-response registration as an immutable value with a small behavior attached. Beyond holding the match key, the record carries `ToResponse()` (line 112) that materializes a *fresh* `HttpResponseMessage` each call, attaching the JSON body as `StringContent` with `application/json` when present (lines 114-120). `[Rubric §14 - Testability]`: building a new response per call is what keeps a canned route reusable across a Polly retry, which would otherwise re-read an already-consumed `HttpContent`.
- **Walkthrough**: Four positional members, `Method`, `Path`, `StatusCode`, `JsonBody` (nullable). `ToResponse()` creates `new HttpResponseMessage(StatusCode)` and, when `JsonBody is not null`, sets `Content` to a UTF-8 `StringContent` of the JSON.
- **Where it's used**: Registered into the handler's `_routes` list by `SetResponse` (`CapturingHttpMessageHandler.cs:56`) and matched (last registration wins) in `Respond` (`CapturingHttpMessageHandler.cs:93-99`).

### TestPrincipal

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6` · Level 0 · class

- **What it is**: A static factory for `ClaimsPrincipal` instances used in bUnit component tests: it mints authenticated principals with the claims the app's pages actually read (`TestPrincipal.cs:5-6`).
- **Depends on**: BCL `System.Security.Claims.ClaimsPrincipal`/`ClaimsIdentity`/`Claim`/`ClaimTypes`.
- **Concept introduced**: The distinction between an *anonymous* and an *authenticated* identity in claims-based auth turns on whether the `ClaimsIdentity` carries an authentication type. `AuthenticatedUser` (line 13) passes `authenticationType: "TestAuth"` (line 21) so `Identity.IsAuthenticated` is true (contrast [BunitComponentTestBase](#bunitcomponenttestbase)'s `Anonymous`, which passes none). The identity carries a `ClaimTypes.Name`, a `user_id` claim read by pages such as Identity's Profile, and one `ClaimTypes.Role` per supplied role so `<AuthorizeView Roles="...">` matches (`TestPrincipal.cs:15-21`). `[Rubric §11 - Security]`: modeling the exact claim shape the pages consume is what lets a component test exercise the authorized branch faithfully rather than a hand-waved "logged in" flag.
- **Walkthrough**: `AuthenticatedUser(userId = "1", name = "Test User", params string[] roles)` (line 13) builds the claim list and returns the authenticated principal. `Organizer(userId = "1")` (line 25) is a convenience wrapper calling `AuthenticatedUser` with the `Organizer` role for the common admin-branch case.
- **Where it's used**: Passed to [BunitComponentTestBase](#bunitcomponenttestbase)`.RenderAs<TComponent>(principal, ...)` to render a component as an authenticated (or organizer) user.

### BunitComponentTestBase

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33` · Level 1 · class

- **What it is**: The shared base class for bUnit component tests across the MMCA repos. It boots a bUnit render context pre-wired with real MudBlazor services, loose-mode JSInterop, permissive-but-real auth doubles, and localization, so a derived test can render one Blazor component in isolation and drive it (`BunitComponentTestBase.cs:12-32`).
- **Depends on**: bUnit's `BunitContext` (the v2 base it extends), MudBlazor services (`AddMudServices`, the popover/dialog/snackbar providers), `Microsoft.AspNetCore.Components.Authorization`, `Microsoft.AspNetCore.Authorization`, and `Microsoft.Extensions.Localization` (`AddLocalization`). It composes the nested [MutableAuthenticationStateProvider](#mutableauthenticationstateprovider), [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice), and [MudProviderHandles](#mudproviderhandles), and pairs with [TestPrincipal](#testprincipal).
- **Concept introduced: component testing (the bUnit tier of the pyramid).** This is the shared substrate the overview names as moving part #3. A component test renders a single Blazor component with its *real* dependencies (actual MudBlazor, actual localization) but faked network and auth edges, then asserts on the produced markup. Two setup details are load-bearing: `JSInterop.Mode = JSRuntimeMode.Loose` (line 43) so MudBlazor components that probe JS during render return defaults instead of throwing, and `AddLocalization()` (line 52) so components injecting `IStringLocalizer<T>` (ADR-027) render localized markup with no per-test setup. `[Rubric §28 - Front-End Testing]` assesses real component-level coverage; `[Rubric §14 - Testability]` assesses how cheaply a unit renders in isolation, and registering real MudBlazor with faked edges is the balance this base strikes.
- **Walkthrough**: `Anonymous` (line 36) is a `static readonly ClaimsPrincipal` over an empty `ClaimsIdentity` (no authentication type, so not authenticated). The constructor (lines 40-53) calls `AddMudServices()`, sets loose JSInterop, `AddAuthorizationCore()`, registers the [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice) singleton and the [MutableAuthenticationStateProvider](#mutableauthenticationstateprovider) singleton, then `AddLogging()` and `AddLocalization()`. `SetUser(principal)` (line 56) swaps the injected provider's principal mid-test. `RenderUnderTest<TComponent>(parameters)` (line 59) renders as `Anonymous`; `RenderAs<TComponent>(principal, parameters)` (line 65) sets the provider's principal, then renders adding a cascading `AuthenticationState` value so both the cascade and the injected provider agree (lines 70-75). `RenderMudProviders()` (line 83) mounts the three overlay providers and returns them as [MudProviderHandles](#mudproviderhandles).
- **Why it's built this way**: The class is deliberately pinned to bUnit v2 (the line compatible with xUnit v3 and Microsoft Testing Platform) and isolates every version-specific symbol, `BunitContext` and `Render<T>`, in this one file, so a future bUnit restore that resolves v1.x needs changes *only here* while derived tests keep calling `RenderUnderTest`/`RenderAs` (`BunitComponentTestBase.cs:24-31`). Driving both the cascade and the injected provider from one principal (rather than picking one) is what makes the base serve both `<AuthorizeView>` cascades and pages that inject the provider directly.
- **Where it's used**: The base for every bUnit test class in `MMCA.Common.*.Tests`, `MMCA.ADC.*.Tests`, and `MMCA.Store.*.Tests`, cataloged in the companion rollup.

### CapturingHttpMessageHandler

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18` · Level 1 · class

- **What it is**: A canned-response, request-capturing `HttpMessageHandler` for unit-testing HTTP-backed UI services with no server. It answers requests from registered routes or a responder delegate, returns 404 for anything unmatched, and records every request it saw (`CapturingHttpMessageHandler.cs:7-18`).
- **Depends on**: BCL `System.Net.Http.HttpMessageHandler`, `System.Text.Json`, `HttpStatusCode`. It produces [CapturedRequest](#capturedrequest) records and holds [Route](#route) registrations.
- **Concept introduced: faking the HTTP edge at the handler.** UI services take an `IHttpClientFactory` and talk to the WebAPI over `HttpClient`. Substituting *this* handler under the client lets a test drive those services with zero network, controlling every response and inspecting every request. Two configuration styles coexist: a responder delegate passed to the ctor (invoked once per request, so repeated calls get fresh responses), or route registration via `SetResponse`; registered routes are consulted first and an unmatched request falls through to the responder, or returns a 404 with an empty body, which mirrors the WebAPI's not-found behavior and keeps incidental refresh calls out of each test's setup (`CapturingHttpMessageHandler.cs:7-17`). `[Rubric §14 - Testability]`: a single handler that both stubs responses and records requests is what lets one test control inputs and assert outputs at the wire boundary.
- **Walkthrough**: The static `WebJson` options (line 20) use `JsonSerializerDefaults.Web` so serialized bodies match what the WebAPI sends. The parameterless ctor (line 30) selects route-registration mode; the `Func<HttpRequestMessage, HttpResponseMessage>` ctor (line 38) selects responder-delegate mode. `Requests` (line 41) exposes every recorded [CapturedRequest](#capturedrequest) in order. `SetResponse(method, absolutePath, statusCode, body)` (line 48) registers a [Route](#route), serializing `body` via a switch: `null` stays null, a raw `string` passes through as-is, any other object is serialized with web defaults (lines 50-56). `RequestsFor(method, absolutePath)` (line 60) filters the recorded requests by method and case-insensitive path. `SendAsync` (line 66) captures the request first (awaiting `CaptureAsync`, lines 72-88, which reads the body and pulls the Authorization header) then calls `Respond`. `Respond` (line 90) matches the last route registered for the method and path (last-wins, lines 93-99), else invokes the responder, else returns a 404 (lines 102-107).
- **Why it's built this way**: Building each response fresh (via [Route](#route)`.ToResponse()` or a per-request responder) is required so a Polly retry pipeline in the service under test never reuses a consumed `HttpContent` (`CapturingHttpMessageHandler.cs:14-16`); last-registration-wins on routes lets a test override an earlier default without clearing state.
- **Where it's used**: Wrapped by [UiHttpServiceHarness](#uihttpserviceharness), offered directly to tests, and its response bodies are commonly built with [HttpTestDoubles](#httptestdoubles).

### MarkupSnapshot

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21` · Level 1 · class

- **What it is**: A minimal, dependency-free render-snapshot (golden-markup) regression helper for bUnit tests. It captures a component's rendered markup, normalizes the non-deterministic per-render bits MudBlazor injects, and compares against a committed baseline under a `Snapshots/` folder next to the calling test (`MarkupSnapshot.cs:6-20`).
- **Depends on**: BCL `System.Runtime.CompilerServices` (`[CallerFilePath]`), `System.Text.RegularExpressions` (source-generated regexes), and `System.IO`. Returns a [MarkupSnapshotResult](#markupsnapshotresult).
- **Concept introduced: golden-markup snapshot testing.** Instead of pixel screenshots (OS-dependent, per-platform golden management), this compares *normalized markup*, which is deterministic and OS-independent, so it runs identically on every CI platform (`MarkupSnapshot.cs:14-16`). A committed `.html` baseline is the golden; an unintended structural change to a shared primitive fails the build. The workflow is review-and-commit: `UPDATE_SNAPSHOTS=1` rewrites baselines after an intentional change, and a *missing* baseline is written but reported as a non-match so a regression can never slip through on an absent snapshot (`MarkupSnapshot.cs:16-19`). `[Rubric §28 - Front-End Testing]`: markup snapshots are the low-cost regression net for the shared UI primitives.
- **Walkthrough**: `Match(markup, snapshotName, [CallerFilePath] callerFilePath)` (line 31) guards its inputs, normalizes the markup, and resolves the baseline path as `Snapshots/{snapshotName}.html` next to the caller (lines 36-39). If `UPDATE_SNAPSHOTS=1` it writes the actual and returns a match (lines 41-46); if the baseline is absent it writes it and returns a *non*-match with a review-and-commit message (lines 48-54); otherwise it reads the expected, normalizes line endings, and returns match or a diff message (lines 56-59). `Normalize` (line 64) collapses per-render GUIDs, both dashed and 32-char forms, to a stable `{guid}` token and trims trailing whitespace so the comparison reacts only to real markup changes (lines 66-69). `BuildDiffMessage` (line 72) walks lines to report the first differing line with expected/actual text (lines 78-88). Two source-generated regexes, `GuidRegex` (line 95) and `Hex32Regex` (line 98), do the GUID normalization.
- **Why it's built this way**: Normalizing MudBlazor's per-render element-id and ARIA GUIDs is what makes the comparison stable; without it every render would differ and the test would be worthless. Keeping the helper assertion-library-free (returning [MarkupSnapshotResult](#markupsnapshotresult)) is what lets the shipped package impose no test-framework choice on consumers.
- **Caveats / not-in-source**: The baseline location depends on `[CallerFilePath]` resolving to the source path present at compile time; snapshots are meant to be run and refreshed from the repo checkout that compiled the tests.

### StubTokenStorageService

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/StubTokenStorageService.cs:13` · Level 1 · class

- **What it is**: A canned [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) for UI HTTP-service tests. It returns fixed access/refresh tokens (which the services attach as the Bearer header) with no platform storage, and its token values mutate through set/clear so login/logout flows can be asserted (`StubTokenStorageService.cs:5-12`).
- **Depends on**: [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) from `MMCA.Common.UI.Services.Auth`.
- **Concept introduced**: A stateful test double that is also *fault-injectable*. Beyond returning canned tokens, `AccessTokenProvider` (line 36) is a mutable delegate backing `GetAccessTokenAsync`, so a test can swap in a throwing delegate to simulate the prerender window where JS-interop storage access is unavailable (`StubTokenStorageService.cs:8-10,31-35`). `[Rubric §26 - Front-End Security]` assesses how auth tokens are handled; the double lets a test exercise the UI service's token-attachment and its failure handling without real secure storage.
- **Walkthrough**: The ctor (line 18) seeds `AccessToken`/`RefreshToken` (defaults `"test-token"`/`"test-refresh-token"`, `null` for an anonymous client) and sets `AccessTokenProvider` to return the current `AccessToken`. `GetAccessTokenAsync()` (line 39) invokes the provider delegate; `GetRefreshTokenAsync()` (line 42) returns `RefreshToken`. `SetTokensAsync(accessToken, refreshToken)` (line 45) and `ClearTokensAsync()` (line 53) mutate the canned values (clear sets both to `null`) so a test can assert the post-login/post-logout state via `AccessToken`/`RefreshToken`.
- **Where it's used**: Exposed as `TokenStorage` on [UiHttpServiceHarness](#uihttpserviceharness) (`UiHttpServiceHarness.cs:61`) and built by [HttpTestDoubles](#httptestdoubles)`.TokenStorage(...)`.

### UiHttpServiceHarness

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:12` · Level 2 · class

- **What it is**: A disposable facade that owns the whole HTTP plumbing a UI HTTP-service test needs: the capturing handler, an `IHttpClientFactory` that hands out a fresh client per call, and a fixed-token storage stub, all on a shared base address (`UiHttpServiceHarness.cs:3-12`).
- **Depends on**: [CapturingHttpMessageHandler](#capturinghttpmessagehandler), [FreshApiClientFactory](#freshapiclientfactory), and [StubTokenStorageService](#stubtokenstorageservice); implements BCL `IDisposable`.
- **Concept introduced: the harness (assemble the doubles once, hand a service its edges).** Where the individual doubles are the parts, this is the one object a test constructs to get a ready-to-inject set. It mirrors [CapturingHttpMessageHandler](#capturinghttpmessagehandler)'s two configuration styles through two public ctors, then wires the client factory and token stub around one shared handler. `[Rubric §14 - Testability]`: collapsing the setup to a single harness (and a single `Dispose`) is what keeps each HTTP-service test's arrange block small and consistent.
- **Walkthrough**: `DefaultBaseAddress` (line 15) is `https://gateway.test/` so services can use relative URIs. The route-mode ctor (line 23, default `accessToken = "test-token"`) constructs a plain [CapturingHttpMessageHandler](#capturinghttpmessagehandler); the responder-mode ctor (line 35) constructs one from a `respond` delegate. Both chain to the private ctor (line 43) that stores `Handler`, resolves `BaseAddress` (falling back to the default), builds a [FreshApiClientFactory](#freshapiclientfactory) on the handler and address, and a [StubTokenStorageService](#stubtokenstorageservice) with the token. The properties `Handler` (line 52), `BaseAddress` (line 55), `ClientFactory` (line 58, typed `IHttpClientFactory`), and `TokenStorage` (line 61, typed [StubTokenStorageService](#stubtokenstorageservice) so tests can mutate it) expose the wired pieces. `Dispose()` (line 63) disposes the shared handler.
- **Why it's built this way**: A single owned handler behind both the client factory and the recorder means a test configures responses in one place and reads requests in the same place; the fresh-client-per-call factory is what keeps the harness compatible with services that dispose their clients (see [FreshApiClientFactory](#freshapiclientfactory)).
- **Where it's used**: Constructed by UI HTTP-service test classes across the repos; tests that wire the pieces individually instead use [HttpTestDoubles](#httptestdoubles).

### HttpTestDoubles

> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:12` · Level 3 · class

- **What it is**: A static class of factory helpers for UI HTTP-service tests: standalone client-factory and token-storage doubles for tests that wire the pieces by hand rather than through [UiHttpServiceHarness](#uihttpserviceharness), plus the canned-response builders both styles share (`HttpTestDoubles.cs:7-12`).
- **Depends on**: [FreshApiClientFactory](#freshapiclientfactory), [StubTokenStorageService](#stubtokenstorageservice), [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice), [UiHttpServiceHarness](#uihttpserviceharness) (for `DefaultBaseAddress`), and BCL `System.Net.Http.Json` (`JsonContent`).
- **Concept introduced**: The a-la-carte counterpart to the all-in-one harness. Some tests need only a response builder or only a client factory, so this class exposes the same building blocks as free functions. `[Rubric §14 - Testability]`: offering both a bundled harness and loose factories keeps the setup ergonomics right whether a test wants everything or one piece.
- **Walkthrough**: `BaseAddress` (line 15) reuses [UiHttpServiceHarness](#uihttpserviceharness)`.DefaultBaseAddress` so both styles share one base URL. `ClientFactory(handler, baseAddress)` (line 23) returns a [FreshApiClientFactory](#freshapiclientfactory) on the given handler. `TokenStorage(accessToken)` (line 28) returns a [StubTokenStorageService](#stubtokenstorageservice). The response builders: `JsonResponse<T>(payload, statusCode = OK)` (line 33) wraps a `JsonContent.Create(payload)` (web serializer defaults); `EmptyResponse(statusCode = NoContent)` (line 37) is a body-less response; `ProblemResponse(detail, title = "Domain Exception", statusCode = BadRequest)` (line 44) emits a ProblemDetails-shaped `{ title, detail }` body the way the WebAPI emits domain failures, so the UI-side error mapping sees the shape it expects.
- **Why it's built this way**: `ProblemResponse` deliberately mirrors the WebAPI's domain-failure envelope so a test can prove the UI service's error path (for example a `ServiceExceptionHelper`) parses real failure shapes, not an invented one (`HttpTestDoubles.cs:40-43`).
- **Where it's used**: By UI HTTP-service test classes that hand-wire doubles or build canned responses for a [CapturingHttpMessageHandler](#capturinghttpmessagehandler) responder delegate.

### GalleryFakeAuthenticationHandler

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:19` · Level 0 · class

- **What it is**: A cookie-toggled fake ASP.NET Core authentication handler for the backend-less gallery. A request that carries `gallery_auth=1` authenticates as a fixed "Gallery Visitor" principal; every other request stays anonymous (`MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:30-39`).
- **Depends on**: `Microsoft.AspNetCore.Authentication.AuthenticationHandler<AuthenticationSchemeOptions>` (the abstract base), `IOptionsMonitor<AuthenticationSchemeOptions>`, `ILoggerFactory`, and `System.Text.Encodings.Web.UrlEncoder` (the base constructor triple, lines 20-23), plus BCL `System.Security.Claims`. No first-party dependencies.
- **Concept introduced: the "backend-less gallery stub" pattern, and its one non-inert member.** The gallery host (see [GalleryHost](#galleryhost)) renders the real `MMCA.Common.UI` components with no live API behind them, so every consumer-supplied service the shared UI expects is replaced by a benign stub. This type is the exception that proves the rule: it is not inert, because two of the scanned page families carry a real `[Authorize]`. `MapRazorComponents` surfaces that attribute as endpoint metadata, and the authorization middleware then requires a genuine authentication scheme to be registered (without one it throws) and a genuine authenticated principal (without one the pages redirect to `/login` instead of rendering). The doc comment at lines 8-18 records exactly that reasoning. Rather than removing the guard for testability, the gallery supplies a real scheme whose only decision input is a cookie. `[Rubric §28 - Front-End Testing]` assesses whether the UI has real-browser render and a11y coverage; toggling sign-in per test with a cookie is what lets one host scan both the anonymous chrome (`/login`, `/register`, `/components`) and the signed-in guarded pages. `[Rubric §11 - Security]` assesses how authentication is implemented; note the deliberate inversion here, the handler trusts an unsigned cookie value, which is acceptable only because this assembly is unpackaged test infrastructure (the doc comment closes at line 17 with "never copy into a real host").
- **Walkthrough**: Two internal constants pin the contract shared with the host and the tests: `SchemeName = "GalleryFake"` (line 25) and `CookieName = "gallery_auth"` (line 26). `HandleAuthenticateAsync()` (line 28) is the single override. It first short-circuits: if `Request.Cookies["gallery_auth"]` is not exactly `"1"` it returns `AuthenticateResult.NoResult()` (lines 30-33), which means "this scheme has no opinion", leaving the request anonymous rather than failing it. Otherwise it builds a `ClaimsIdentity` carrying one `ClaimTypes.Name` claim of `"Gallery Visitor"` and, critically, passes `SchemeName` as the authentication type (lines 35-37): supplying an authentication type is what makes `Identity.IsAuthenticated` true. It wraps that principal in an `AuthenticationTicket` and returns `AuthenticateResult.Success` (lines 38-39). Everything is synchronous, returned through `Task.FromResult`, so no I/O occurs.
- **Why it's built this way**: Keeping the guard real and faking only the credential means the E2E scan exercises the same authorization pipeline the deployed hosts run, so an accidental loss of `[Authorize]` on the shared notification pages is not papered over by a permissive test host.
- **Where it's used**: Registered as the default (and only) authentication scheme by [GalleryHost](#galleryhost) at `MMCA.Common.UI.Gallery/GalleryHost.cs:69-72`, followed by `AddAuthorization()` at line 73. The cookie is set on the Playwright browser context by `NotificationPagesE2ETests.SeedSignedInCookieAsync` (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:63-70`) before each of the three guarded-page scans.

### NullTokenRefresher

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:9` · Level 1 · class

- **What it is**: An [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) implementation that has no session to refresh. The gallery has no API to refresh a token against; the stub exists only so the DI graph stays complete (doc comment, lines 5-8).
- **Depends on**: [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) from `MMCA.Common.UI.Services.Auth`. Nothing else.
- **Concept introduced**: A pure instance of the backend-less gallery stub pattern introduced in [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler): replace an outbound boundary with a constant. `[Rubric §14 - Testability]` assesses how cheaply a component can be exercised in isolation; the token-refresh boundary collapses to a constant so the refresh plumbing the shared UI registers never contacts a token endpoint during the scan.
- **Walkthrough**: One member. `AcquireAccessTokenAsync(CancellationToken = default)` (line 11) is an expression body returning `Task.FromResult<string?>(null)`: no token, therefore no refresh attempt, and callers take their null-token path.
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `MMCA.Common.UI.Gallery/GalleryHost.cs:61`, ahead of `AddUIShared`.

### NullTokenStorageService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:10` · Level 1 · class

- **What it is**: An empty [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice): there is no stored session in the gallery. It exists so the `AuthDelegatingHandler` that `AddUIShared` registers resolves cleanly, even though it is never actually invoked because the gallery makes no API calls (doc comment, lines 5-9).
- **Depends on**: [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) from `MMCA.Common.UI.Services.Auth`.
- **Concept introduced**: The same stub pattern as [NullTokenRefresher](#nulltokenrefresher), covering storage rather than refresh. `[Rubric §26 - Front-End Security]` assesses how tokens are stored and handled; this stub deliberately holds nothing, so no credential material is ever persisted by the test host, not even in memory.
- **Walkthrough**: Four members, each inert but shape-complete so DI binds: `GetAccessTokenAsync()` and `GetRefreshTokenAsync()` (lines 12, 14) return `Task.FromResult<string?>(null)`; `SetTokensAsync(accessToken, refreshToken)` (line 16) and `ClearTokensAsync()` (line 18) discard their inputs and return `Task.CompletedTask`.
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `MMCA.Common.UI.Gallery/GalleryHost.cs:60`, before `AddUIShared` so the shared UI's `TryAdd*` registration defers to this stub.

### GalleryUIModule

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:13` · Level 3 · class

- **What it is**: A minimal [IUIModule](group-15-common-ui-framework.md#iuimodule) whose `Assembly` is the gallery itself, so the shared Blazor Router (`Routes.razor`, which scans `UIModules.Select(m => m.Assembly)`) discovers the gallery's own `/components` showcase page. Its nav items make the host browsable when run interactively (doc comment, lines 8-12).
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) and [NavItem](group-15-common-ui-framework.md#navitem) from `MMCA.Common.UI.Common`, plus `MudBlazor.Icons` and BCL `System.Reflection.Assembly`.
- **Concept introduced**: The UI module contribution pattern (introduced with [IUIModule](group-15-common-ui-framework.md#iuimodule) in the Common UI framework group) reused here for a test host: a module contributes route-bearing assemblies and nav links to the shared shell. `[Rubric §18 - UI Architecture]` assesses how the front end composes independently-owned UI slices; the gallery participates in the exact same module-discovery mechanism the real apps use, which is what makes the scan evidence about that mechanism rather than about a bespoke test shell. `[Rubric §25 - Navigation & IA]`: the three nav entries flow through the same `NavItem` contract the deployed apps' menus are built from.
- **Walkthrough**: `NavItems` (line 15) is a collection-expression `IReadOnlyList<NavItem>` of three entries, Login (`/login`), Register (`/register`), and Components (`/components`), each pairing a label, a route, and a MudBlazor Material icon (lines 17-19). `Assembly` (line 22) is an expression-bodied property returning `typeof(GalleryUIModule).Assembly`, so the Router additionally scans the gallery assembly for routable components, which is how `Pages/ComponentsGallery.razor` becomes reachable.
- **Where it's used**: Registered as a singleton `IUIModule` by [GalleryHost](#galleryhost) at `MMCA.Common.UI.Gallery/GalleryHost.cs:85`.

### StubNotificationInboxUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/StubNotificationInboxUIService.cs:11` · Level 3 · class

- **What it is**: A canned [INotificationInboxUIService](group-15-common-ui-framework.md#inotificationinboxuiservice) that returns fixed inbox data so `NotificationBell` and the notification inbox page render populated, real markup for the axe and render E2E scans, with no backend.
- **Depends on**: [INotificationInboxUIService](group-15-common-ui-framework.md#inotificationinboxuiservice) from `MMCA.Common.UI.Services.Notifications`, the [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) and [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata) result types from `MMCA.Common.Shared.Abstractions`, the [UserNotificationDTO](group-10-notifications.md#usernotificationdto) contract, and the `UserNotificationIdentifierType` alias.
- **Concept introduced**: The stub pattern extended from inert no-ops to *canned data*. For components whose whole purpose is displaying content, an empty stub would render an empty (and therefore untested) tree, so this stub returns representative rows instead. `[Rubric §28 - Front-End Testing]`: populated markup is what lets axe evaluate contrast, roles, and the read/unread affordances against a realistic notification list rather than an empty state.
- **Walkthrough**: `GetInboxAsync(pageNumber = 1, pageSize = 20, cancellationToken)` (lines 13-14) builds a two-item `UserNotificationDTO[]` (lines 16-29): an unread "Welcome to MMCA" with a fixed UTC `SentOn` of 2026-01-02 09:00, and a read "Scheduled maintenance" carrying both `ReadOn` and `SentOn`, so the inbox exercises both visual states. It wraps them in a `PagedCollectionResult<UserNotificationDTO>` with `new PaginationMetadata(items.Length, pageSize, pageNumber)` (lines 30-31), so the pager renders from real metadata. `GetUnreadCountAsync()` (line 34) returns a constant `3` so the bell badge renders non-empty. `MarkReadAsync(id, ct)` (line 36) and `MarkAllReadAsync(ct)` (line 39) are no-ops returning `Task.CompletedTask`, so the buttons are present and clickable without any state change.
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `MMCA.Common.UI.Gallery/GalleryHost.cs:79`, alongside the scoped [NotificationState](group-15-common-ui-framework.md#notificationstate) (line 78). The scan that consumes it is `NotificationPagesE2ETests.NotificationInbox_Renders_AndHasNoWcag21AaViolations` (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:36-44`), which asserts the "Welcome to MMCA" row is visible before running axe.
- **Caveats / not-in-source**: The badge count `3` (line 34) is a hard-coded display value and does not reconcile with the two rows `GetInboxAsync` returns; it exists purely to render a non-empty badge for the scan, not to be internally consistent.

### StubPushNotificationUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/StubPushNotificationUIService.cs:11` · Level 3 · class

- **What it is**: A canned [IPushNotificationUIService](group-15-common-ui-framework.md#ipushnotificationuiservice) so the notification history and compose pages render populated, real markup for the axe and render E2E scans, with no backend.
- **Depends on**: [IPushNotificationUIService](group-15-common-ui-framework.md#ipushnotificationuiservice) from `MMCA.Common.UI.Services.Notifications`, [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) and [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata), plus the [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) and [SendPushNotificationRequest](group-10-notifications.md#sendpushnotificationrequest) contracts.
- **Concept introduced**: The same canned-data variant of the stub pattern as [StubNotificationInboxUIService](#stubnotificationinboxuiservice), applied to the send and history side. `[Rubric §24 - Forms/Validation/UX Safety]`: the compose page is a form, and echoing the submitted `Title`/`Body` back in the returned DTO lets the render smoke exercise the post-submit state without a real send.
- **Walkthrough**: `SendAsync(request, cancellationToken)` (lines 13-14) is an expression body returning a single `PushNotificationDTO` that echoes `request.Title` and `request.Body` and fixes the rest: `Id = 99`, `SentByUserId = 1`, `RecipientCount = 42`, `Status = "Sent"`, `CreatedOn` 2026-01-04 10:00 UTC (lines 15-19). `GetHistoryAsync(pageNumber = 1, pageSize = 10, cancellationToken)` (lines 21-22) builds a two-item history array (lines 24-36): one row with `Status = "Sent"` and one with `Status = "Failed"`, both with `RecipientCount = 128`, so the history table renders both status treatments, then wraps them in a `PagedCollectionResult<PushNotificationDTO>` with `PaginationMetadata` (lines 37-38).
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `MMCA.Common.UI.Gallery/GalleryHost.cs:80`. The scans that consume it are `NotificationHistory_Renders_AndHasNoWcag21AaViolations` and `NotificationCompose_Renders_AndHasNoWcag21AaViolations` (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:20-57`); the history scan runs under the `Wcag21AaExceptMudPagerCombobox` axe options because the MudBlazor 9.6.0 pager combobox has no accessible name and is not fixable from app markup (`MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:29-32`).

### NoOpAuthUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:12` · Level 6 · class

- **What it is**: A no-op [IAuthUIService](group-15-common-ui-framework.md#iauthuiservice) for the backend-less gallery. The gallery renders the real Login and Register pages for a11y and render-smoke scanning only, so every operation returns a benign default.
- **Depends on**: [IAuthUIService](group-15-common-ui-framework.md#iauthuiservice) from `MMCA.Common.UI.Services.Auth`, and the [LoginRequest](group-08-auth.md#loginrequest), [RegisterRequest](group-08-auth.md#registerrequest), and [AuthenticationResponse](group-08-auth.md#authenticationresponse) contracts from `MMCA.Common.Shared.Auth`.
- **Concept introduced: registration order as the override mechanism.** This stub is registered *before* `AddUIShared`, whose internal `TryAddScoped<IAuthUIService, AuthUIService>()` then defers to it, exactly as the class doc comment states (lines 6-11). `TryAdd*` is first-registration-wins, so a test host overrides only the boundaries it names and inherits every other registration the shared UI makes, with no fork of the composition root. `[Rubric §11 - Security]` assesses how authentication is handled; here the client-side auth boundary is neutralized entirely so the scan touches the real login and register markup without any credential flow. `[Rubric §14 - Testability]`: substituting the top-level UI auth service for constants is what makes those pages renderable in isolation.
- **Walkthrough**: `LastError` (line 14) is always `null`, so no error alert renders. `LoginAsync`, `RegisterAsync`, and `ExchangeOAuthCodeAsync` (lines 16, 19, 22) each return `Task.FromResult<AuthenticationResponse?>(null)`, meaning "no authenticated session" on the interface's own terms. `LogoutAsync()` (line 25) returns `Task.CompletedTask`. `TryRefreshTokenAsync(ct)` (line 27) and `ChangePasswordAsync(currentPassword, newPassword, ct)` (line 30) both return `Task.FromResult(false)`. Every path is inert but shape-complete, so the pages bind, render, and stay in their signed-out state for the axe pass.
- **Why it's built this way**: Placing the stub ahead of `AddUIShared` exploits the shared UI's `TryAdd*` idempotence rather than requiring the shared registration extension to grow test hooks, which keeps the production DI code free of test-only branches.
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `MMCA.Common.UI.Gallery/GalleryHost.cs:59`, the first of the pre-`AddUIShared` stub registrations.

### GalleryAuthenticationStateProvider

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common.UI.Gallery/Stubs/GalleryAuthenticationStateProvider.cs:16` · Level 7 · class

- **What it is**: The gallery's Blazor `AuthenticationStateProvider`. It mirrors the request's authentication in *both* render phases, so `AuthorizeView` and `CascadingAuthenticationState` agree with what [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler) decided for the request. Without the `gallery_auth` cookie both phases yield anonymous, preserving the deliberate signed-out chrome of the login, register, and components scans (doc comment, lines 6-15).
- **Depends on**: `Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider` (the abstract base) and `IHostEnvironmentAuthenticationStateProvider` (the interface the Blazor Server host calls into), `IHttpContextAccessor` injected as a primary-constructor parameter (line 16), and BCL `ClaimsPrincipal`/`ClaimsIdentity`.
- **Concept introduced: the two render phases of interactive-server Blazor.** A page first renders as static SSR inside the HTTP request, then, once the circuit connects, re-renders interactively over a WebSocket where there is no ambient `HttpContext`. An auth-state provider therefore has to answer correctly in two different worlds. This class handles both: SSR reads the request user through `IHttpContextAccessor`, and for the interactive circuit the framework pushes the handshake user in through `IHostEnvironmentAuthenticationStateProvider.SetAuthenticationState`. The doc comment (lines 7-9) records that this replaced a former always-anonymous stub, which could not represent the signed-in state the guarded notification pages now need. `[Rubric §19 - State Management]` assesses how client state is owned and propagated; auth state is the canonical cascading state, and this shows the two supply routes it has under interactive server rendering. `[Rubric §28 - Front-End Testing]`: getting both phases right is what stops a guarded page from flipping to a signed-out tree mid-scan and producing a false axe pass on the wrong markup.
- **Walkthrough**: `Anonymous` (lines 19-20) is a `static readonly AuthenticationState` wrapping an empty `ClaimsPrincipal(new ClaimsIdentity())`, unauthenticated precisely because no authentication type is supplied (contrast [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler), which passes one). `_hostState` (line 22) is the nullable task the framework may have pushed in. `GetAuthenticationStateAsync()` (line 24) checks `_hostState` first and returns it verbatim when present (lines 26-29): the circuit's handshake user always wins. Otherwise it falls back to the SSR path, reading `httpContextAccessor.HttpContext?.User` (line 31) and returning a new `AuthenticationState(user)` only when `user?.Identity?.IsAuthenticated == true`, else the shared `Anonymous` (lines 32-34). Both branches use `Task.FromResult`, so no async machinery is allocated per call. `SetAuthenticationState(Task<AuthenticationState>)` (lines 37-38) is the `IHostEnvironmentAuthenticationStateProvider` implementation and simply stores the task; note that it does not call `NotifyAuthenticationStateChanged`, because the framework sets it before the first interactive render.
- **Why it's built this way**: The gallery deliberately mirrors rather than fabricates. Deriving the component-tree state from whatever the request actually authenticated as keeps one source of truth (the cookie) for the middleware, the endpoint authorization, and the render tree, so a scan cannot land in a split-brain state where the endpoint admitted the request but the tree still renders signed-out.
- **Where it's used**: Registered scoped as the `AuthenticationStateProvider` by [GalleryHost](#galleryhost) at `MMCA.Common.UI.Gallery/GalleryHost.cs:63`, immediately after `AddHttpContextAccessor()` (line 62) which supplies its dependency.
- **Caveats / not-in-source**: The class implements `IHostEnvironmentAuthenticationStateProvider` but is registered only under the `AuthenticationStateProvider` service type (`MMCA.Common.UI.Gallery/GalleryHost.cs:63`). Whether the Blazor Server host resolves the same instance when it calls `SetAuthenticationState` is framework behavior and is not determinable from this repository's source.

### GalleryHost

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery` · `MMCA.Common.UI.Gallery/GalleryHost.cs:21` · Level 8 · class

- **What it is**: A static builder that assembles the entire backend-less Blazor gallery host. It renders the real `MMCA.Common.UI` auth pages (`/login`, `/register`), the shared notification pages (`/notifications`, `/notifications/inbox`, `/notifications/send`), and a primitives showcase (`/components`), all against stub implementations of every consumer boundary, so a real-browser axe accessibility scan can run against the shared UI inside `MMCA.Common`'s own CI.
- **Depends on**: ASP.NET Core `WebApplication`/`WebApplicationBuilder`, MudBlazor (`AddMudServices`, line 53), the shared `MMCA.Common.UI` surface (`AddUIShared`, `App`, `_Imports`), and [SupportedCultures](group-12-api-hosting-mapping.md#supportedcultures) from `MMCA.Common.Shared.Globalization`. It wires in every stub in this unit: [NoOpAuthUIService](#noopauthuiservice), [NullTokenStorageService](#nulltokenstorageservice), [NullTokenRefresher](#nulltokenrefresher), [GalleryAuthenticationStateProvider](#galleryauthenticationstateprovider), [GalleryFakeAuthenticationHandler](#galleryfakeauthenticationhandler), [StubNotificationInboxUIService](#stubnotificationinboxuiservice), [StubPushNotificationUIService](#stubpushnotificationuiservice), and [GalleryUIModule](#galleryuimodule), plus the shared [NotificationState](group-15-common-ui-framework.md#notificationstate).
- **Concept introduced: a self-hostable test host as one buildable unit.** The whole host build lives in `BuildApp(string[] args)` rather than in `Program.cs`, so two callers share the identical configured app: the `dotnet run` entry point, which `RunAsync()`s it (`MMCA.Common.UI.Gallery/Program.cs:7-8`), and the E2E collection fixture [GalleryHostFixture](#galleryhostfixture), which `StartAsync()`s it on an ephemeral Kestrel port. `[Rubric §28 - Front-End Testing]` assesses real-browser UI coverage; this host is the render target for the cross-browser `ui-e2e` axe and render matrix. `[Rubric §33 - Developer Experience]`: `MMCA.Common.UI.Gallery/Program.cs:3-6` records the rationale, one `BuildApp` for both entry points avoids the separate `dotnet run` plus health-poll that made ADC's cold start fragile.
- **Walkthrough**:
  - **Assembly name and base dir** (lines 33-34): `typeof(GalleryHost).Assembly.GetName().Name` is captured without a null-forgiving operator; the comment at lines 30-32 explains that CI's nullable analysis treats `AssemblyName.Name` as non-null and would flag `!` as an unnecessary suppression (IDE0370), and the value is only interpolated into a filename, which is null-safe either way.
  - **Static web assets** (lines 45-48): the load-bearing fix. RCL `_content/*` CSS and JS and `_framework/blazor.web.js` resolve from the *entry* assembly's manifests and auto-load only in Development; when the E2E suite self-hosts in-process the entry assembly is the test host and the environment is Production, so neither default holds. The loader is pointed explicitly at `{galleryAssemblyName}.staticwebassets.runtime.json` and forced on with `UseStaticWebAssets()`. Without it (comment, lines 38-44) the pages render unstyled and never become interactive, so axe's contrast checks would be meaningless and the page would never signal Blazor readiness.
  - **Rendering services** (lines 50-53): `AddRazorComponents().AddInteractiveServerComponents()` then `AddMudServices()`.
  - **Boundary stubs, before `AddUIShared`** (lines 59-63): scoped `IAuthUIService`, `ITokenStorageService`, and `ITokenRefresher`, then `AddHttpContextAccessor()` and the scoped `AuthenticationStateProvider`. The ordering comment (lines 55-58) states the mechanism: `AddUIShared`'s `TryAdd*` registrations defer to whatever is already present.
  - **Real authentication and authorization** (lines 69-73): `AddAuthentication(GalleryFakeAuthenticationHandler.SchemeName)` plus `AddScheme<AuthenticationSchemeOptions, GalleryFakeAuthenticationHandler>(...)`, then `AddAuthorization()`, because the notification pages' `[Authorize]` surfaces as endpoint metadata (comment, lines 65-68).
  - **Canned notification boundaries** (lines 78-80): scoped `NotificationState`, `INotificationInboxUIService`, and `IPushNotificationUIService`, so the notification pages discovered from the `MMCA.Common.UI` assembly render populated markup.
  - **Module contribution** (line 85): the singleton `IUIModule`, so the shared Router discovers the gallery's own `/components` page.
  - **Shared UI** (line 90): `AddUIShared(builder.Configuration)` registers `ApiSettings`/`LayoutSettings` binding, the `"APIClient"` HttpClient, and the remaining shared services; the in-memory `Api:ApiEndpoint` from `appsettings.json` satisfies validation, and the client is never invoked because `IAuthUIService` is stubbed (comment, lines 87-89).
  - **Request localization** (lines 99-103): builds `galleryCultures` as `[.. SupportedCultures.All, SupportedCultures.PseudoLocale]` and applies it as the supported and supported-UI culture set over `SupportedCultures.Default`. The comment (lines 94-98) is explicit that this mirrors the real hosts' ADR-027 allowlist but additionally enables `qps-Ploc` *unconditionally*, because this host is unpackaged test infrastructure that is never deployed and the pseudo pass here is a required CI gate (`PseudoLocalizationE2ETests`, the rubric §27 resource-round-trip and text-expansion evidence). Production keeps `qps-Ploc` Development-only via `UseCommonRequestLocalization`.
  - **Middleware** (lines 107-112): `UseAuthentication()` then `UseAuthorization()` (WebApplication inserts `UseRouting` ahead of them automatically), then `UseAntiforgery()`, required because Razor Component endpoints carry anti-forgery metadata even though the gallery's interactive forms never POST over HTTP.
  - **Endpoints** (lines 116-125): `MapStaticAssets` is given the gallery's own `{galleryAssemblyName}.staticwebassets.endpoints.json` for the same in-process self-host reason as above; a `/health` endpoint returns `Results.Ok("Healthy")` (line 119); and `MapRazorComponents<App>().AddInteractiveServerRenderMode().AddAdditionalAssemblies(typeof(MMCA.Common.UI._Imports).Assembly)` makes the real shared pages routable alongside the gallery's own.
  - **Return** (line 127): the built-but-not-started `WebApplication`, leaving the start mode to the caller.
- **Why it's built this way**: Keeping the whole build in `BuildApp` rather than `Program.cs` lets the E2E fixture host the identical configured app in-process on a real bound port via `StartAsync`, not `WebApplicationFactory`'s in-memory TestServer, which Playwright cannot reach over the wire. [GalleryHostFixture](#galleryhostfixture) therefore binds `http://127.0.0.1:0` and reads the ephemeral address back from `IServerAddressesFeature` (`MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryHostFixture.cs:26-38`). This is deliberate CI infrastructure and is never deployed.
- **Where it's used**: Consumed by `MMCA.Common.UI.Gallery/Program.cs:7` (the `dotnet run` entry) and by every E2E test through [GalleryHostFixture](#galleryhostfixture) (`MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryHostFixture.cs:26`), which the axe and render suite (Login, Register, Components, Notifications, DarkMode, MobileTopRow, WebVitals, PseudoLocalization) runs against.
- **Caveats / not-in-source**: `MMCA.Common.UI.Gallery` and `MMCA.Common.UI.E2E.Tests` are deliberately excluded from `MMCA.Common.slnx` (per the repo `CLAUDE.md`) so the unit-test run stays fast; they build only by csproj path and run only in CI's `ui-e2e` job.

### NavigationContractTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/NavigationContractTests.cs:17` · Level 1 · class
- **What it is** - a documentation-drift gate for navigation (rubric §25): it asserts that the "Routes shipped by the framework" table in `NavigationFlow.md` stays in lockstep with the routable pages the `MMCA.Common.UI` assembly actually ships, and that each route's documented auth posture matches the `[Authorize]` reality on the page.
- **Depends on** - [UISharedAssemblyReference](group-15-common-ui-framework.md#uisharedassemblyreference) (the reflection anchor for the shared UI assembly, `NavigationContractTests.cs:82`), plus externals: ASP.NET Core `RouteAttribute` and `AuthorizeAttribute` (the route/guard metadata reflected over, `:84`,`:90`), a source-generated `Regex` via `[GeneratedRegex]` (`:116`), the embedded `NavigationFlow.md` manifest resource (`:102`), xUnit `[Fact]`, and AwesomeAssertions.
- **Concept introduced** - *documentation as an executable contract.* This is the first place a test asserts a hand-authored markdown doc against live code reality rather than the reverse. `NavigationFlow.md` lives next to the framework code (it is an embedded resource of this test project, per `MMCA.Common/CLAUDE.md`) precisely so this gate can parse it; a page added, removed, or re-routed without the doc moving in the same change fails the build, and so does an auth-posture lie in either direction. [Rubric §25 - Navigation & IA] assesses whether routing and information architecture are deliberate and documented; this test turns the route table into a build-enforced invariant instead of review discipline. [Rubric §11 - Security] / [Rubric §26 - Front-End Security] also apply: a route the doc calls Authenticated must carry `[Authorize]`, and a route it calls Anonymous must not, so a mis-documented guard cannot pass silently. [Rubric §34 - Architecture Governance & Documentation] is the umbrella: the documentation is proven current by CI.
- **Walkthrough** - two constants pin the contract: `MinimumRoutes = 8` (`:19`) and `DocResource = "NavigationFlow.md"` (`:20`). Three `[Fact]`s enforce it. `RoutablePages_AreDiscovered_GateIsNotVacuous` (`:22`-`:26`) asserts reflection finds at least eight routed pages, so a broken anchor cannot let the whole gate pass having scanned nothing. `EveryRoutablePage_IsDocumented_AndEveryDocumentedRoute_Exists` (`:28`-`:41`) computes the set difference both ways: `undocumented` routes (real but missing from the doc) and `phantom` routes (documented but no longer real) must both be empty. `EveryDocumentedAuthPosture_MatchesTheRouteAttributeReality` (`:43`-`:77`) walks each documented route, classifies its auth cell as `Authenticated...`, `Anonymous`, or `Any` (`:57`-`:59`), and flags three violation kinds: an unrecognized posture string (`:61`-`:64`), a doc that promises authentication where the page carries no `[Authorize]` (`:65`-`:68`), and a doc that promises an open route where the page is actually guarded (`:69`-`:72`). Two private helpers supply the two sides: `DiscoverRoutedPages` (`:79`-`:98`) reflects over the shared-UI assembly, collecting each `RouteAttribute.Template` and whether the type carries `[Authorize]`; `DiscoverDocumentedRoutes` (`:100`-`:114`) reads the embedded doc and extracts route rows via the source-generated `RouteRowRegex` (`:116`-`:117`, a 2000ms-timeout `[GeneratedRegex]` partial property).
- **Why it's built this way** - `NavigationFlow.md` is deliberately kept in MMCA.Common next to the routed pages (not in the Website docs library) so this gate can embed and parse it; making route and auth-posture documentation a compiled assertion is what keeps a public navigation contract from rotting.
- **Where it's used** - an independent class in the `MMCA.Common.Architecture.Tests` suite; it runs in CI's `build-and-test` job (fast, no database) and has no Store/ADC counterpart because it guards the framework's own shared-UI route table.

### FitnessPrincipal
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:43` · Level 4 · class
- **What it is** - a throwaway "principal" entity used only as test data for the specification-navigation fitness function. It is the entity that a dependent record points at, so a specification can be written that tries to reach across the navigation into it.
- **Depends on** - [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (it is a `public sealed class FitnessPrincipal : AuditableBaseEntity<int>`, `SpecificationFitnessTests.cs:43`).
- **Concept introduced** - *test fixture entities for a fitness function.* A fitness function is an executable architecture rule (see [ArchitectureRules](#architecturerules)); to prove such a rule actually fires you feed it a deliberately-crafted model rather than the real domain. `FitnessPrincipal` is one half of that crafted model: a bare aggregate-shaped type carrying a single scalar (`IsActive`, `SpecificationFitnessTests.cs:45`) so a specification can navigate to it. [Rubric §14 - Testability] assesses whether rules are provable with focused inputs; this fixture exists precisely so the guard is tested against a known-unsafe shape instead of hoping a real specification trips it.
- **Walkthrough** - one auto-property, `bool IsActive` (`SpecificationFitnessTests.cs:45`). That is the only member; identity and audit fields come from the base. It is the navigation target referenced by [FitnessDependent](#fitnessdependent).Principal.
- **Why it's built this way** - the fitness test must be *non-vacuous*: it needs a real cross-entity navigation to flag. A minimal principal with a single scalar is the smallest thing a specification can legally navigate into.
- **Where it's used** - referenced by [FitnessDependent](#fitnessdependent) and, through it, by [NavigatingSpec](#navigatingspec); the whole fixture set drives [SpecificationFitnessTests](#specificationfitnesstests).

### DataSubjectSample
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:79` · Level 5 · class
- **What it is** - a representative "data subject" fixture: a single object that carries `[Pii]` members alongside non-PII fields and implements an in-place erasure path, so the framework's privacy machinery can be exercised end to end against a realistic shape.
- **Depends on** - [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) (it is `private sealed class DataSubjectSample : IAnonymizable`, `PiiErasureContractFitnessTests.cs:79`), [PiiAttribute](group-02-domain-building-blocks.md#piiattribute) (marks `Email`/`FullName`, `PiiErasureContractFitnessTests.cs:91`,`:94`), and [Result](group-01-result-error-handling.md#result) (returned from `Anonymize`, `PiiErasureContractFitnessTests.cs:99`).
- **Concept introduced** - *closing a vacuous fitness function with a stand-in data subject.* The framework's `[Pii] => IAnonymizable` scan ([PiiConventionTests](#piiconventiontests)) has nothing to assert because MMCA.Common ships no PII-bearing domain entity of its own. Rather than invent a fake aggregate in the Domain layer, this fixture models the exact contract a consumer PII aggregate (for example MMCA.ADC's `User`) must satisfy, and lets [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests) prove the three §30 mechanisms compose. [Rubric §30 - Compliance/Privacy/Data Governance] assesses whether erasure, redaction, and masking actually work together; this sample is the vehicle that keeps the framework's proof of that non-vacuous.
- **Walkthrough** - public constants publish the expected before/after values so the tests can assert without magic literals: `SampleId = 7`, `PublicCity = "Atlanta"`, `OriginalEmail`, `OriginalFullName` (`PiiErasureContractFitnessTests.cs:81`-`:84`), plus private anonymized placeholders (`:86`-`:87`). `Id` (`:89`) and `City` (`:97`) are non-PII pass-through fields; `Email` and `FullName` are `[Pii]` with private setters (`:91`-`:95`). `Anonymize()` (`:99`-`:105`) overwrites both PII fields with the fixed placeholders and returns `Result.Success()`; because it re-applies constants, calling it twice is idempotent by construction.
- **Why it's built this way** - ADR-005 (soft-delete versus erasure) requires that a right-to-erasure path be idempotent and leave no clear-text behind. The fixture encodes that contract in the smallest object that can be pushed through `PiiRedactor` and `Anonymize` together.
- **Where it's used** - the sole fixture for [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests).

### DependencyVersionTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9` · Level 5 · class
- **What it is** - the MMCA.Common binding of the shared dependency-pin rule: a one-line sealed subclass that turns on the check enforcing the MassTransit-v8-only policy for this repo.
- **Depends on** - [DependencyVersionTestsBase](#dependencyversiontestsbase) (`public sealed class DependencyVersionTests : DependencyVersionTestsBase;`, `DependencyVersionTests.cs:9`).
- **Concept introduced** - *the thin-subclass fitness pattern.* Almost every rule in this project lives once in the reusable `MMCA.Common.Testing.Architecture` package as an abstract `*TestsBase`, and each repo activates it with a near-empty subclass. This is the first of many such subclasses; the body-less form here is the extreme case (no configuration at all). [Rubric §32 - Dependency & Supply-Chain] assesses guarding against risky dependency drift; the base parses this repo's `Directory.Packages.props` and fails the build if the MassTransit major reaches 9 (v9 requires a commercial license), so a "just bump the version" edit cannot slip through.
- **Walkthrough** - no members; the entire behavior is inherited. The base reads `Directory.Packages.props` and asserts the pin. This subclass exists only so xUnit discovers and runs it in the Common test assembly.
- **Why it's built this way** - the pin is real only in MMCA.Common (where MassTransit is actually declared); ADC and Store inherit it transitively and deliberately do not subclass the base, because the default rule would fail parsing a pin they do not declare.
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
- **Walkthrough** - two overrides. `RequiredCultures` (`:14`-`:17`) filters `SupportedCultures.All` to the non-default entries (today just `es`). `MinimumBaseResources => 3` (`:21`) sets a non-vacuous floor: the scan must find at least three base resources (ErrorResources for the API, plus SharedResource and MudTranslations for the UI), so a wrong scan root or repo re-layout cannot let the gate pass having checked nothing.
- **Why it's built this way** - ADR-027 (localization) requires supported cultures to be fully translated; the derived allowlist plus the minimum-count floor turn that into a self-maintaining CI gate.
- **Where it's used** - run by the `MMCA.Common.Architecture.Tests` suite.

### NavigatingSpec
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:49` · Level 6 · class
- **What it is** - the deliberately-unsafe fixture specification: its `Criteria` navigates from the dependent into a related entity, the exact pattern the fitness function must flag.
- **Depends on** - [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (`private sealed class NavigatingSpec : Specification<FitnessDependent, int>`, `SpecificationFitnessTests.cs:49`) and [FitnessDependent](#fitnessdependent)/[FitnessPrincipal](#fitnessprincipal) (the entities it filters over).
- **Concept introduced** - *why cross-entity navigation in a specification is unsafe across data sources.* Under database-per-service (ADR-006), a `d => d.Principal!.IsActive` predicate (`:51`) assumes the related entity lives in the same queryable model; once the principal is extracted to another physical source, that navigation cannot translate to SQL. The fitness function `SpecificationsDoNotNavigateToOtherEntities` treats it as a violation. [Rubric §7 - Microservices Readiness] assesses whether the code stays extractable; this fixture is the negative example that proves the readiness guard fires.
- **Walkthrough** - one member, an overridden `Criteria` expression that dereferences the `Principal` navigation (`:51`). The test asserts the rule's exception message contains this type's name.
- **Where it's used** - the "should be flagged" input to [SpecificationFitnessTests](#specificationfitnesstests); paired with [ScalarOnlySpec](#scalaronlyspec).

### PiiErasureContractFitnessTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19` · Level 6 · class
- **What it is** - a non-vacuous §30 fitness test that pushes a representative `[Pii]` data subject through the framework's own privacy machinery, proving that PII detection, redaction/masking, and in-place erasure compose end to end rather than each being verified in isolation.
- **Depends on** - [DataSubjectSample](#datasubjectsample) (the fixture), [PiiRedactor](group-02-domain-building-blocks.md#piiredactor), [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable), and [Result](group-01-result-error-handling.md#result). Externals: xUnit `[Fact]`, AwesomeAssertions.
- **Concept introduced** - *a contract-composition fitness function.* Where [PiiConventionTests](#piiconventiontests) is a structural scan (does every `[Pii]` type also implement `IAnonymizable`), this test exercises the *behavior* the scan presumes. It is the pattern for proving a cross-cutting compliance contract actually holds when its parts run together. [Rubric §30 - Compliance/Privacy/Data Governance] assesses that erasure and log-masking genuinely protect subject data; this test is the framework's executable evidence.
- **Walkthrough** - four `[Fact]`s, each isolating one link in the contract. `DataSubject_DeclaresPii_SoTheContractIsNotVacuous` (`:21`-`:24`) asserts `PiiRedactor.HasPii` recognizes the sample, so the later guards assert against something real. `PiiRedactor_MasksEveryPiiMember_AndPassesThroughNonPii` (`:26`-`:35`) redacts an instance and checks `Email`/`FullName` become `RedactedToken` while `Id`/`City` pass through unchanged. `PiiRedactor_LeaksNoClearTextPii_ToLogsOrTelemetry` (`:37`-`:50`) verifies neither the redacted dictionary values nor `RedactToString` output contain the original email or name. `DataSubject_ImplementsErasureSeam_AndAnonymizeErasesPii_Idempotently` (`:52`-`:72`) asserts the sample is `IAnonymizable`, that `Anonymize()` succeeds and changes the PII fields, that a second call also succeeds (idempotence, ADR-005), and finally that an anonymized subject *still* leaks no original clear text when redacted, proving erasure and redaction compose.
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
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (`internal sealed class CommonArchitectureMap : ArchitectureMapBase`, `CommonArchitectureMap.cs:15`), and one anchor type per package (for example `Result`, `BaseEntity<>`, `DomainEventDispatcher`, `ApplicationDbContext`, `ApiControllerBase`, `ResultGrpcExtensions`, `UISharedAssemblyReference`, `CommonArchitectureMap.cs:21`-`:27`).
- **Concept introduced** - *the map as the single point of repo-specific truth for architecture rules.* The rule bodies live once in `MMCA.Common.Testing.Architecture` and are parameterized by an [IArchitectureMap](#iarchitecturemap); each repo supplies exactly one map so the same rules run identically across Common, Store, and ADC. Because Common is a module-less framework, every layer is registered as a *framework* layer via the `Framework(...)` helper rather than a module layer. [Rubric §3 - Clean Architecture] assesses whether layer boundaries are explicit and enforced; this map is the machine-readable statement of those boundaries.
- **Walkthrough** - `RepoToken => "MMCA.Common"` (`:17`) identifies the repo. `DefineLayers()` (`:19`-`:28`) returns one `Framework(Layer.X, anchorType.Assembly)` entry per package, using a single anchor type to resolve each assembly (mirrors the old `PackageAssemblies` helper). The doc comment (`:8`-`:13`) records a deliberate omission: `MMCA.Common.UI.Maui` (ADR-042) is absent because its four MAUI TFM assemblies cannot load in the ubuntu net10.0 test process, so its UI+Shared boundary is enforced at compile time by `EnforceUIMauiLayerBoundary` instead.
- **Why it's built this way** - one map per repo keeps the rule bodies DRY and identical everywhere (see the "Architecture Enforcement" section in `MMCA.Common/CLAUDE.md`); anchoring by type keeps the assembly reference refactor-safe.
- **Where it's used** - supplied as `Map` by nearly every `*ConventionTests`/`*DependencyTests` subclass in this unit, and is the pattern [SpecTestMap](#spectestmap) collapses to a single layer.

### FrameworkSanityTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:13` · Level 7 · class
- **What it is** - the home for the few architecture checks that are Common-only and do not generalize into the shared rule library: the `MMCA.Common.Grpc` transport boundary and the placement of the `IMessageBus`, `IJwksProvider`, and `ILiveChannelPublisher` abstractions.
- **Depends on** - [IMessageBus](group-04-events-outbox.md#imessagebus), [IJwksProvider](group-08-auth.md#ijwksprovider), [ILiveChannelPublisher](group-10-notifications.md#ilivechannelpublisher), and the NetArchTest `Types`/`ArchitectureAssert` helpers ([ArchitectureAssert](#architectureassert)).
- **Concept introduced** - *repo-specific sanity next to the shared library.* Not every rule fits the parameterized base classes; some assert facts true only of the framework repo. Keeping them in one explicitly-named class documents the boundary between "shared rule applied here" and "Common-only invariant." [Rubric §7 - Microservices Readiness] (transport isolation) and [Rubric §3 - Clean Architecture] (abstraction placement) both apply: gRPC is pure transport and must not couple to Domain/Application/Infrastructure, and the cross-cutting abstractions must sit in the layer their consumers depend on.
- **Walkthrough** - three private static `Assembly` accessors anchor the Grpc, Application, and Infrastructure assemblies (`:15`-`:19`). Three `[Fact]`s assert `MMCA.Common.Grpc` has no dependency on Domain, Application, or Infrastructure (`:21`-`:34`) via the `AssertNoDependency` helper (`:51`-`:59`), which runs a `Types.InAssembly(...).ShouldNot().HaveDependencyOnAny(...)` NetArchTest query and routes the result through `ArchitectureAssert.NoViolations`. Three more `[Fact]`s assert placement: `IMessageBus` lives in Application (`:37`-`:39`), `IJwksProvider` in Infrastructure because it handles crypto/PEM material (`:42`-`:44`), and `ILiveChannelPublisher` in Application beside `IPushNotificationSender` (`:47`-`:49`).
- **Why it's built this way** - the message-bus abstraction must stay in Application so application code depends on transport through it (extraction boundary, ADR-007); the JWKS provider is crypto and belongs in Infrastructure (ADR-004). These are load-bearing placements, so they get their own asserted facts.
- **Where it's used** - an independent class in the Common architecture suite; it has no counterpart in Store/ADC because only Common owns the Grpc package and defines these abstractions.

### SpecificationFitnessTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:13` · Level 7 · class
- **What it is** - the test that verifies the `SpecificationsDoNotNavigateToOtherEntities` fitness function actually discriminates: it must flag a specification that navigates into another entity and must leave a scalar-only specification alone.
- **Depends on** - [ArchitectureRules](#architecturerules) (the rule under test), and its own nested fixtures [SpecTestMap](#spectestmap), [FitnessDependent](#fitnessdependent), [FitnessPrincipal](#fitnessprincipal), [NavigatingSpec](#navigatingspec), [ScalarOnlySpec](#scalaronlyspec).
- **Concept introduced** - *testing the test: verifying a fitness function is neither vacuous nor over-broad.* A rule that never fires is useless; a rule that flags everything is worse. This class proves the specification-navigation guard does exactly one thing by feeding it both a positive and a negative fixture in a single run. [Rubric §14 - Testability] assesses whether the guardrails themselves are trustworthy; this is the meta-test that earns that trust.
- **Walkthrough** - one `[Fact]`, `Rule_FlagsNavigatingSpecification_ButNotScalarSpecification` (`:15`-`:24`). It invokes `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities(new SpecTestMap())` (`:18`), captures the thrown exception, and asserts its message contains `NavigatingSpec` and the word "navigates" while *not* containing `ScalarOnlySpec` (`:21`-`:23`). The nested types below the fact supply the model: `SpecTestMap` (`:26`), the two entities (`:34`,`:43`), and the two specifications (`:49`,`:55`).
- **Why it's built this way** - the navigation rule protects future extraction (a navigating specification cannot cross a data-source boundary, ADR-006); a discriminating test keeps the rule honest as it evolves.
- **Where it's used** - an independent class in the Common architecture suite.

### SpecTestMap
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:26` · Level 7 · class
- **What it is** - a minimal architecture map used only by [SpecificationFitnessTests](#specificationfitnesstests): it registers this test assembly as the single Application layer so the specification-navigation rule has a model to scan.
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (`private sealed class SpecTestMap : ArchitectureMapBase`, `SpecificationFitnessTests.cs:26`).
- **Concept introduced** - cross-references the map concept from [CommonArchitectureMap](#commonarchitecturemap). Where the real map spans seven packages, this one collapses to a single self-referential Application layer (`Framework(Layer.Application, typeof(SpecificationFitnessTests).Assembly)`, `:31`) because the fixtures (the two specifications and two entities) live in the test assembly itself. It is the smallest map that lets a fitness function run against hand-crafted types.
- **Walkthrough** - `RepoToken => "MMCA.Common"` (`:28`) and a one-entry `DefineLayers()` (`:30`-`:31`) pointing at this assembly.
- **Where it's used** - instantiated once inside [SpecificationFitnessTests](#specificationfitnesstests)'s single fact.

### AggregateConventionTests, DomainPurityTests, EventVersioningConventionTests, HandlerResultConventionTests, LayerDependencyTests, LocalizedTextConventionTests, MicroserviceExtractionTests, PiiConventionTests, RawQueryableConventionTests, SliceCohesionTests, StateManagementConventionTests, UIArchitectureConventionTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · (see per-type table) · Level 8 · class

These twelve sealed classes share one shape: each is a **thin subclass of a shared `*TestsBase` rule** from the `MMCA.Common.Testing.Architecture` package, supplying the repo's [CommonArchitectureMap](#commonarchitecturemap) (and, for a few, one extra override) so the same rule body runs identically across MMCA.Common, MMCA.Store, and MMCA.ADC. This is the [Rubric §34 - Architecture Governance & Documentation] and [Rubric §14 - Testability] story: architecture conventions are executable and enforced in CI rather than left to review, and the rule logic lives in exactly one place. See the thin-subclass pattern introduced by [DependencyVersionTests](#dependencyversiontests). The canonical body of each rule is the corresponding `*TestsBase`; these subclasses only wire in the map and any repo-specific floor or allowlist. Each fails the `build-and-test` CI job on violation, and several are deliberately *vacuous today* (they assert nothing until the framework grows a type that could break the convention, at which point they fire).

| Type | File:Line | Base rule | What it enforces / what differs |
|------|-----------|-----------|----------------------------------|
| `AggregateConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9` | [AggregateConventionTestsBase](#aggregateconventiontestsbase) | DDD aggregate-root factory rules for the framework's own aggregates. Supplies only `Map` (`:11`). [Rubric §4 - DDD.] |
| `DomainPurityTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9` | [DomainPurityTestsBase](#domainpuritytestsbase) | Domain/Shared stay framework-free and Application stays host-agnostic. Supplies only `Map` (`:11`). [Rubric §3 - Clean Architecture.] |
| `EventVersioningConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/EventVersioningConventionTests.cs:10` | [EventConventionTestsBase](#eventconventiontestsbase) | Integration-event `SchemaVersion`/`BaseIntegrationEvent`/namespace rules (ADR-010). Supplies only `Map` (`:12`). Vacuous today: the framework ships no concrete integration event. [Rubric §6 - CQRS & Event-Driven.] |
| `HandlerResultConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/HandlerResultConventionTests.cs:12` | [HandlerResultConventionTestsBase](#handlerresultconventiontestsbase) | Every concrete command/query handler's `TResult` must be `Result` or `Result<T>` (the pipeline otherwise only enforces this at runtime); scans the framework's Notifications handlers. Supplies only `Map` (`:14`). [Rubric §6 - CQRS & Event-Driven.] |
| `LayerDependencyTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9` | [LayerDependencyTestsBase](#layerdependencytestsbase) | Clean Architecture layer-flow (each layer references only layers below). Supplies only `Map` (`:11`). [Rubric §3 - Clean Architecture.] |
| `LocalizedTextConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizedTextConventionTests.cs:11` | [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase) | Shared `MMCA.Common.UI` ships no hard-coded user-visible literals; everything resolves through `IStringLocalizer` (ADR-027). Also overrides `MinimumScannedFiles => 20` (`:16`) so a wrong scan root is caught. [Rubric §27 - i18n.] |
| `MicroserviceExtractionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10` | [MicroserviceExtractionTestsBase](#microserviceextractiontestsbase) | Domain/Application/Shared stay free of MassTransit/Grpc/Protobuf (transport lives at the edges). Supplies only `Map` (`:12`). [Rubric §7 - Microservices Readiness.] |
| `PiiConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13` | [PiiConventionTestsBase](#piiconventiontestsbase) | `[Pii] => IAnonymizable` right-to-erasure scan (ADR-005). Supplies only `Map` (`:15`). Structurally vacuous in the framework; the machinery is proven non-vacuously by [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests). [Rubric §30 - Compliance/Privacy.] |
| `RawQueryableConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/RawQueryableConventionTests.cs:13` | [RawQueryableConventionTestsBase](#rawqueryableconventiontestsbase) | Bans raw `IQueryable` in Application code, scanning the framework's own `Source/Core/MMCA.Common.Application` project (`ApplicationSourceDirectories`, `:18`-`:22`). Beyond `Map` (`:15`) it overrides `AllowedFiles` (`:25`-`:37`) to whitelist the deliberate composition root `EntityQueryService.cs` and the five Notifications inbox handlers whose cross-entity joins are the documented exception. [Rubric §8 - Data Architecture.] |
| `SliceCohesionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SliceCohesionTests.cs:10` | [SliceCohesionTestsBase](#slicecohesiontestsbase) | Each Notifications use-case slice keeps command/query, handler, and validator in one namespace. Supplies only `Map` (`:12`). [Rubric §5 - Vertical Slice.] |
| `StateManagementConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:11` | [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) | `MMCA.Common.UI` carries no mutable static state and keeps stateful services scoped (per-circuit model). Overrides `AllowedStaticMembers` to whitelist `ErrorMessages._localizer`, a write-once wiring point, not per-user state (`:21`-`:22`). [Rubric §19 - State Management.] |
| `UIArchitectureConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/UIArchitectureConventionTests.cs:11` | [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase) | Shared pages/primitives keep code-behind within the convention cap and inline `@code` blocks small (container/presentational split). Supplies only `Map` (`:13`). [Rubric §18 - UI Architecture.] |

- **Why they're built this way** - see the two-layer "Architecture Enforcement" model in `MMCA.Common/CLAUDE.md`: rules are enforced at compile time (LayerEnforcement.targets) and at runtime here, with the runtime bodies factored into one shared package so Common, Store, and ADC stay identical. Each subclass exists only so xUnit discovers the rule in this repo's assembly with this repo's map.
- **Where they're used** - all twelve run in the `MMCA.Common.Architecture.Tests` project during CI's `build-and-test` job (fast, no database).

## Per-project test rollup

This guide treats **tests as grouped, not sectioned per `[Fact]`** (the logged exception in the
charter): the reusable test *bases*, the shared architecture-fitness library and its per-repo thin
subclasses, and the component **Gallery** harness each get their own `###` treatment in the earlier parts
of this chapter, but the bulk of the suite, **1,094 individual test types across 40 projects**, is rolled
up here. Each row below names a test project (assembly), the count of test types it contributes to the
1,094, **what** it covers, and its **style** (unit / integration / component / E2E / performance-smoke).
Counts reconcile exactly to the unit input.

A few cross-cutting facts hold for every row, so they are stated once here rather than repeated:

- **Stack.** Every project is **xUnit v3** run under the **Microsoft Testing Platform** (not VSTest,
  `global.json` sets `"runner": "Microsoft.Testing.Platform"`), with **AwesomeAssertions** for fluent
  asserts, **Moq** for test doubles, and **coverlet** for coverage (see for example
  `MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/MMCA.Common.Testing.Tests.csproj:7`). The lone
  exception is `MMCA.Common.Benchmarks`, a **BenchmarkDotNet** executable (not a test project). See
  [primer §3](../00-primer.md#3-the-external-stack-bcl--nuget--external-level-0) for the platform/runner
  externals.
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
  [`BunitComponentTestBase`](#bunitcomponenttestbase), the Playwright fixtures) and the
  `MMCA.Common.UI.Gallery` harness.
- **Two integration tiers, deliberately split.** Each service has a per-service `*.IntegrationTests`
  project that boots **one** host through `WebApplicationFactory<Program>` with cross-service gRPC edges
  faked and no broker (these gate deploy via the `integration-tests` CI job and need a real SQL Server
  named by `ADC_TEST_SQL_BASE`). Separately, `MMCA.ADC.CrossService.IntegrationTests` and
  `MMCA.ADC.ServiceBusEmulator.IntegrationTests` run against **Testcontainers** to prove the genuine
  broker and gRPC round-trips: both live in the non-gating nightly
  `MMCA.ADC/.github/workflows/cross-service-tests.yml`, whose *recency* (not its result) gates deploys
  through the `cross-service-freshness` job at
  `MMCA.ADC/.github/workflows/deploy.yml:620` (a 5-day window).
  `[Rubric §14, Testability]` (assesses how thoroughly and at what cost the system can be verified): the
  count and spread below, heavy at the inner Application/Domain layers, thinner at the edges, with a
  dedicated integration + E2E tier, is the classic healthy **test pyramid**, and the fact that the volume
  concentrates in fast in-memory unit layers keeps the feedback loop cheap.

### MMCA.Common, the framework suite (Tests/ mirrors Source/)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.Common.Shared.Tests` | 22 | The innermost layer: the `Result`/`Error`/`ErrorType` pattern, value objects (`Money`, `Email`, `Address`, `DateRange`, …) and their factory-method invariants, and DTO/paging contracts. Pure **unit** tests, no DI or DB. |
| `MMCA.Common.Domain.Tests` | 43 | The entity hierarchy (`BaseEntity`→`AuditableBaseEntity`→`AuditableAggregateRootEntity`), domain-event collection, `SetItems<T>`/`GetChildOrNotFound<T>`, specifications, and the `PiiAttribute`/anonymization boundary plus the logging/telemetry redaction half of the `[Pii]` contract (masks marked members so a data subject's values never reach logs, ADR-005 / §30). Pure **unit** tests over the framework domain primitives. |
| `MMCA.Common.Application.Tests` | 161 | The CQRS engine: the decorator pipeline in its registered nesting order (FeatureGate→Logging→Caching→Validating→Transactional→handler, `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:88`), the opt-in MiniProfiler decorators added by `AddApplicationProfiling` (`.../DependencyInjection.cs:185`) and the `CqrsMetrics` counters/histograms (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:20`), `ModuleLoader` topological ordering, `DomainEventDispatcher` plus the swallow-and-log `SafeDomainEventHandler` base (`.../DomainEvents/SafeDomainEventHandlerTests.cs:9`), validation, the [`IMessageBus`](group-04-events-outbox.md#imessagebus) abstraction, entity-query projection/paging and the per-type filter strategies, the cross-source [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification) helper (ADR-018), the magic-byte upload sniffer behind [`ImageContentSniffer`](group-07-persistence-ef-core.md#imagecontentsniffer) (`.../ImageContentSnifferTests.cs:12`, ADR-045), and the notification read handlers driven by an injected `TimeProvider` test clock. The framework's largest suite; fast **unit** tests with mocked infrastructure. |
| `MMCA.Common.Infrastructure.Tests` | 171 | The widest layer: EF repositories + Unit of Work, the multi-database resolver/registry (`DataSourceResolver`, `EntityDataSourceRegistry`, `DbContextFactory`) and the cross-data-source degrade convention (`.../Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:24`), the **outbox** processor (eligibility/smart-wait/retry) and the consumer-side [`EfInboxStore`](group-04-events-outbox.md#efinboxstore) idempotency ledger (`.../Persistence/Inbox/EfInboxStoreTests.cs:27`, ADR-021), caching, JWT issuance + JWKS + the login-attempt lockout service (`.../Auth/LoginProtectionServiceTests.cs:14`), column-level encryption (`.../Persistence/EncryptedStringConverterTests.cs:6`), the filtered-unique-index soft-delete convention (`.../Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs:23`), image processing (`.../Services/ImageSharpImageProcessorTests.cs:15`, ADR-045), the SignalR push + live-channel plumbing, the message-bus implementations, the polyglot Cosmos-config portability suite (ADR-018), and the in-repo disaster-recovery database-restore drill (`.../Resilience/DatabaseRestoreDrillTests.cs`, a CI-gated RTO baseline, ADR-009 / §29). Mostly **unit** with EF-InMemory/SQLite boundaries (no real SQL Server here). |
| `MMCA.Common.API.Tests` | 65 | The presentation pipeline: `ApiControllerBase.HandleFailure` `ErrorType`→HTTP mapping, the exception-handler chain, the `[Idempotent]` filter + `Idempotency-Key` replay, the authenticated-only global rate limiter's partition logic (`.../Startup/RateLimitPartitionTests.cs`, ADR-019), permission policies/ownership filters, correlation, the JWKS and OIDC-discovery endpoints, the session-cookie auth handler/refresher/jar, the shared notification + device controllers, the public-endpoint output-cache policy, the database-initialization startup (the SQLite-`EnsureCreated`-under-`Migrate` path, ADR-018), and the error-message **localization** edge (localizes the human-readable message while leaving the machine `Code`/ProblemDetails `title` untouched and degrading to English when no localizer is present, ADR-027 / §27). **Unit** tests of middleware/filters/controllers in isolation. |
| `MMCA.Common.Grpc.Tests` | 13 | The gRPC transport boundary: `Result`↔`RpcException` round-tripping, the JWT-forwarding client interceptor, and the Polly **resilience** pipeline on typed clients (retry, circuit-breaker, and fault-injection). **Unit** tests asserting ADR-007 / ADR-009 behavior. |
| `MMCA.Common.Aspire.Tests` | 11 | The hosting/observability extensions: `OutboxPollFilterProcessor` (drops recurring outbox-poll spans from telemetry export), the `SecurityHeadersMiddleware`, the startup **warm-up** gate (holds readiness closed until first-request warm-up completes so a rolling deploy never serves a cold replica, §29), the head-based trace-sampling cost knob (a ratio in (0,1) opts in, anything else samples everything, §31), and the metrics-instrumentation toggle (`.../Telemetry/MetricsInstrumentationToggleTests.cs:12`). **Unit** suite over the Aspire service-defaults package. |
| `MMCA.Common.Testing.Tests` | 9 | The suite that tests the **test framework itself**, so a regression in the shared scaffolding fails here rather than silently weakening every consumer suite: `HandlerTestBaseTests` drives [`HandlerTestBase<THandler>`](#handlertestbasethandler) exactly as a consumer handler test would, registering repositories and relying on the pre-wired unit of work (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/HandlerTestBaseTests.cs:12`), and `DecoratorPipelineOrderTests` runs [`DecoratorPipelineOrderTestsBase<…>`](#decoratorpipelineordertestsbasetcommand-tcommandresult-tquery-tqueryresult) against MMCA.Common's own `AddApplication → ScanModuleApplicationServices → AddApplicationDecorators` sequence to prove the resolved pipelines nest in the ADR-014 order (`.../DecoratorPipelineOrderTests.cs:20`). **Unit** style. |
| `MMCA.Common.UI.Tests` | 71 | Shared Blazor components (delete-confirmation, empty-state, the mobile card/infinite-scroll lists, notification bell/inbox/list/send pages, primitives), the MudBlazor theme/provider harness, HTTP-resilience/service-exception helpers, list-page state/query-state services, the primitive markup snapshots, the auth-form view-model validation (§24), and the i18n globalization pair (the `[!!…!!]` bracket-sentinel pseudo-localizer and the `ResxMudLocalizer` MudBlazor-chrome boundary, ADR-027 / §27) plus the auth-aware nav menu and its mobile top-row. Rendered with **bUnit** (component-render unit tests via [`BunitComponentTestBase`](#bunitcomponenttestbase)). |
| `MMCA.Common.UI.Web.Tests` | 4 | The Blazor Server web-host pieces: `ServerTokenStorageService` (during SSR prerender tokens come from the HttpOnly session cookies; on the interactive circuit the access token is held in memory, hydrated single-flight, and refreshed proactively near expiry, while the refresh token is never readable), the server form-factor probe, and `BlazorCspPolicyProvider`, which pins the enforced production Content-Security-Policy verbatim (connect-src locked to the configured API/Gateway origin, no `unsafe-eval`, permissive Report-Only degradation on an unparseable endpoint, §26). **Unit** tests. |
| `MMCA.Common.UI.E2E.Tests` | 11 | **Playwright** axe-core (WCAG 2.1 AA) + render-smoke over the backend-less **Gallery** host (real Login/Register pages, the primitives/components showcase, and the shared Notification pages against stubbed collaborators), plus the dark-mode toggle, a Web-Vitals probe, and two i18n/mobile-parity gates: a `qps-Ploc` pseudo-locale round-trip asserting the `[!!` sentinel and no horizontal overflow under ~40% text expansion (ADR-027 / §27), and the culture+theme controls pinned into the mobile top-row below 1024px (ADR-028 / §22). Deliberately outside `MMCA.Common.slnx`; runs in CI's `ui-e2e` job. **E2E/accessibility** style. `[Rubric §21, Accessibility]` (assesses automated a11y gating): this is where the framework proves zero axe violations before downstream apps consume the pages. |
| `MMCA.Common.Benchmarks` | 4 | A BenchmarkDotNet **performance-smoke** executable for the DB-free query hot path: `SpecificationBenchmarks` measures the per-instance compiled-expression cache behind [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)`.IsSatisfiedBy` (a cached-compile baseline vs. the recompile-each-call anti-pattern) and the `And`/`Or` composition cost. Deliberately **outside `MMCA.Common.slnx`** (like the Gallery), run on demand with `dotnet run -c Release` (append `-- --job Dry` for a seconds-long correctness smoke). `[Rubric §12, Performance & Scalability]` (assesses measured, not assumed, hot-path cost): this is the evidence harness for the spec cache. **Performance-smoke** style. |

### MMCA.ADC, Conference module (the largest application module)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Conference.Shared.Tests` | 17 | Conference DTOs, requests, enums, and DTO/request mappers (the manual-mapping/Mapperly boundary, ADR-001). Pure **unit** tests. |
| `MMCA.ADC.Conference.Domain.Tests` | 22 | The Conference aggregates (Event, Session, Speaker, Room, Category, Question/Answer): factory-method `Result<T>` outcomes, invariants, state transitions, and emitted domain events. **Unit** tests. |
| `MMCA.ADC.Conference.Application.Tests` | 134 | The command/query handlers for the Conference controllers, validators, navigation populators, the **Sessionize import** orchestrator + sync strategies (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Application.Tests/Events/UseCases/RefreshFromSessionizeHandlerTests.cs`), and the event/session live-window validation served to the live layer over gRPC (`.../Events/EventLiveValidationServiceTests.cs`, [`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterhandler) and its cross-source filter query, ADR-018). The biggest application suite in ADC; fast **unit** tests with mocked repositories/services. |
| `MMCA.ADC.Conference.Infrastructure.Tests` | 7 | Conference-specific EF configurations, the module DB seeder, the Sessionize HTTP client, and the Anthropic-backed session-scoring service (`.../MMCA.ADC.Conference.Infrastructure.Tests/Services/AnthropicScoringServiceTests.cs:12`). Small **unit** suite over faked HTTP handlers. |
| `MMCA.ADC.Conference.API.Tests` | 16 | Conference REST controllers (events, sessions, speakers, rooms, categories, questions/answers, session selection), the module's permission grants, and the Conference error-resource localization completeness check (`.../MMCA.ADC.Conference.API.Tests/Localization/ConferenceErrorResourcesTests.cs:15`, §27). **Unit** tests of the API layer. |
| `MMCA.ADC.Conference.UI.Tests` | 27 | Conference Blazor pages and components: the public event/session/speaker detail + filtered list pages, the management CRUD forms and management-route authorization, the organizer feedback dashboards, the speaker dashboard, the session-selection dashboard with its AI-score and speaker-overlap views (`.../Pages/SessionSelection/SessionSelectionAiScoresTests.cs:15`), and the share/QR/add-to-calendar buttons (`.../Components/QrCodeButtonTests.cs:14`). Rendered with **bUnit** (`BunitTestBase` over the shared [`BunitComponentTestBase`](#bunitcomponenttestbase)). **Component** tests. |
| `MMCA.ADC.Conference.IntegrationTests` | 36 | Boots the **Conference service host** via `WebApplicationFactory<Program>` (gRPC peers faked, JWT re-pointed at an in-process test key) and drives real HTTP per role (Anonymous/Attendee/Speaker/Organizer), plus OpenAPI contract-snapshot, API-versioning, optimistic-concurrency, soft-delete + audit-stamp fidelity, idempotency replay, output-cache eviction, the `includeChildren` regression, and the in-process `CrossServiceUserRegisteredTests` (the Identity→Conference `UserRegistered` auto-link handler). **Integration** style; needs a real SQL Server (`ADC_TEST_SQL_BASE`), runs in the deploy-gating `integration-tests` CI job. |

### MMCA.ADC, Engagement module (bookmarks, feedback, and the conference-day live layer)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Engagement.Shared.Tests` | 2 | Bookmark/feedback/live DTOs, requests, and mappers. **Unit**. |
| `MMCA.ADC.Engagement.Domain.Tests` | 6 | The `UserSessionBookmark`, event/session feedback, and conference-day live-layer aggregates (`LivePoll` + `SessionQuestion`): factory `Result<T>` outcomes, invariants, and domain events. **Unit**. |
| `MMCA.ADC.Engagement.Application.Tests` | 27 | Bookmark, feedback, and live-layer (poll / session-question) add/remove/query handlers and validators, including the cross-module `ISessionBookmarkValidationService` / `IBookmarkCountService` / `IEventLiveValidationService` gRPC collaborators (stubbed) and the best-effort `ILiveChannelPublisher` ingress. **Unit**. |
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
| `MMCA.ADC.Identity.IntegrationTests` | 33 | Boots the **Identity service host** via `WebApplicationFactory<Program>` and drives the full auth surface over real HTTP: registration, login and its anonymous edge cases, claims, profile, user preferences, soft-deleted-user handling, the external-OAuth challenge/exchange, GDPR user export (`.../Attendee/UserExportTests.cs:16`), and JWKS discovery. It also carries the two contract guards (OpenAPI snapshot and the RFC 9457 Problem Details subclass over [`ProblemDetailsContractTestsBase<TFixture>`](#problemdetailscontracttestsbasetfixture), `.../Contract/ProblemDetailsContractTests.cs:17`, §9), the compliance pair that proves erasure works end to end and that PII never reaches the log pipeline (`.../Compliance/ErasureAndPiiLoggingTests.cs:19`, ADR-005 / §30), an outbox-fidelity guard asserting registration atomically enqueues `UserRegistered` into `[dbo].[OutboxMessages]` (`.../Data/OutboxFidelityTests.cs:17`), and the in-process `CrossServiceSpeakerLinkTests`. **Integration**; real SQL Server, deploy-gating CI job. |

### MMCA.ADC, Notification module (push + inbox on top of the framework's notification types)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Notification.API.Tests` | 1 | `NotificationModuleTests` pins the module contract itself: its `Name`, its declared `Dependencies` on Identity, `RequiresDependencies`, and the `RegisterDisabledStubs` path that keeps the cross-module `IUserNotificationExportService` resolvable as a singleton `DisabledUserNotificationExportService` when the module is switched off (`MMCA.ADC/Tests/Modules/Notification/MMCA.ADC.Notification.API.Tests/NotificationModuleTests.cs:7`). **Unit**. |
| `MMCA.ADC.Notification.Application.Tests` | 5 | The module's two application services plus its DI registration: `AttendeeNotificationRecipientProvider` resolving broadcast recipients through the Identity `IAttendeeQueryService` gRPC contract (`.../AttendeeNotificationRecipientProviderTests.cs:7`), `UserNotificationExportService` assembling a data-subject export from the user-notification and push-notification repositories over `InMemoryQueryableExecutor` on top of [`HandlerTestBase<THandler>`](#handlertestbasethandler) (`.../UserNotificationExportServiceTests.cs:11`, §30), and `AddModuleNotificationApplication` proving both are registered against their interfaces (`.../DependencyInjectionTests.cs:9`). **Unit**. |
| `MMCA.ADC.Notification.IntegrationTests` | 8 | Boots the **Notification service host** via `WebApplicationFactory<Program>` (the Identity recipient-lookup gRPC client faked by `FakeAttendeeQueryService`) and exercises the push-notification REST endpoints + inbox (`NotificationsController`/`InboxController` from `MMCA.Common.API`, `.../Notifications/NotificationControllerTests.cs:16`), an OpenAPI contract snapshot (`.../Contract/OpenApiContractTests.cs:16`), and the real-time SignalR `NotificationHub`: a live `HubConnection` asserts authenticated connect, anonymous rejection (the hub carries `[Authorize]`), and a POST-triggered broadcast reaching the connected recipient (`.../Notifications/NotificationHubTests.cs:15`). **Integration**; real SQL Server (`ADC_TEST_SQL_BASE`), deploy-gating CI job. |

### MMCA.ADC, host, cross-service, and end-to-end suites

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Gateway.Tests` | 6 | Boots the real **YARP Gateway** host in-process (`GatewayApplicationFactory`, pinned to `Production` so HSTS and the realistic non-development CORS branch run) and asserts three operational guarantees: every response carries the hardened security response headers on `/alive` (`.../SecurityHeadersTests.cs:11`, §26), the host **shuts down gracefully** within its bounded stop timeout, firing `ApplicationStopping`/`ApplicationStopped` (`.../GracefulShutdownTests.cs:14`, §29), and the full YARP route table forwards each pattern to the service that owns it, asserted by swapping the real `IHttpForwarder` for a recording fake that echoes the destination prefix into a response header so no backends are needed (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/RouteMapTests.cs:19`). The Gateway is a pure reverse proxy (no DbContext/broker) so the boot needs no SQL. **Integration** style. |
| `MMCA.ADC.CrossService.IntegrationTests` | 12 | The **real-broker + real-gRPC** tier: boots all three REST hosts (Identity/Conference/Engagement) in one process against a **Testcontainers** SQL Server and a **Testcontainers** RabbitMQ, so the genuine MassTransit outbox → broker → consumer round-trip (`UserRegistered` auto-link, `SpeakerLinked`/`SpeakerUnlinked` back-link) and the real Conference → Engagement bookmark-count gRPC read run end to end, over a sequential env-boot fixture and a smoke gate that fails first if the container/host wiring is wrong. **Integration** style; needs **Docker**, runs in the non-gating nightly cross-service workflow (not in `Integration.slnf`). |
| `MMCA.ADC.ServiceBusEmulator.IntegrationTests` | 3 | **Broker-parity smoke** (§33): production runs on Azure Service Bus while local development runs RabbitMQ, so Service-Bus-specific transport behavior used to be observable only in the deployed environment. This tier runs MassTransit v8 against the official **Service Bus emulator** container with ADC's real integration-event contracts and proves the two transport-specific behaviors: admin-plane topology provisioning (topic per message type, subscription, receive-endpoint queue) and the AMQP publish → topic → subscription → consume round-trip (`MMCA.ADC/Tests/Integration/MMCA.ADC.ServiceBusEmulator.IntegrationTests/ServiceBusRoundTripSmokeTests.cs:22`). One warm collection-scoped emulator serves the whole tier because of the emulator's 10-connection and roughly one-admin-operation-per-second quotas, the image is pinned to `2.0.1` (the admin plane arrived in 2.0.0 and is the tier's whole premise), and the fixture's static constructor lowers MassTransit's process-global TTL/auto-delete defaults beneath the emulator's one-hour maximum, which is why this tier lives in its **own** test process (`.../Infrastructure/ServiceBusEmulatorFixture.cs:22`). **Integration** style; needs **Docker**, runs in the same nightly workflow. |
| `MMCA.ADC.E2E.Tests` | 60 | **Playwright** end-to-end against the running Aspire stack, using a Page-Object model (`PageObjects/`) and `E2ETestBase` login helpers, organized by actor workflow (Organizer/Speaker/Attendee/Identity/Preferences) plus the Engagement live-poll and feedback flows, real-time notification push, a Web-Vitals budget check, and an `AccessibilityTests` axe sweep. Runs once per engine via `E2E_BROWSER` (chromium/firefox/webkit). The largest single project here and the source of most of the chapter's recorded E2E debugging history. `[Rubric §28, Front-End Testing]` + `[Rubric §22, Responsive/Cross-Browser]`: this suite is the cross-browser, real-user-flow safety net. **E2E** style. |

**Reconciliation.** Common: 22+43+161+171+65+13+11+9+71+4+11+4 = **585** (12 projects).
ADC Conference: 17+22+134+7+16+27+36 = **259** (7). ADC Engagement: 2+6+27+4+6+19+13 = **77** (7).
ADC Identity: 3+4+21+4+7+6+33 = **78** (7). ADC Notification: 1+5+8 = **14** (3).
ADC host/cross-service/E2E: 6+12+3+60 = **81** (4).
**Total = 585+259+77+78+14+81 = 1,094**, across **40 projects**, matching the unit input exactly.


---
[⬅ Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)](group-26-device-capability-layer.md)  •  [Index](00-index.md)  •  [Coverage audit ➡](99-coverage-audit.md)
