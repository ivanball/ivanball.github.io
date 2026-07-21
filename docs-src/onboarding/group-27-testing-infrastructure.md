# 27. Testing & Quality Infrastructure

**What this group covers.** Everything the codebase uses to *prove* itself: the four reusable
test-support packages that ship out of `MMCA.Common/Source/Hosting` (`MMCA.Common.Testing`,
`MMCA.Common.Testing.E2E`, `MMCA.Common.Testing.UI`, `MMCA.Common.Testing.Architecture`), the
architecture-fitness rule library that gates the build, the backend-less component Gallery harness, and
the many per-repo test projects that consume all of it. The important distinction to hold onto while
reading: most of the *types* in this group are reusable **bases, fixtures, harnesses, and helpers** that
are compiled into and shipped by MMCA.Common, while the concrete `[Fact]`-bearing test classes that
subclass them live in each consumer repo (`MMCA.Common.*.Tests`, `MMCA.ADC.*.Tests`,
`MMCA.Store.*.Tests`). The individual test classes are rolled up by project in the companion rollup
section; this chapter teaches the *machinery* they stand on.

There are five moving parts, and they map cleanly onto the test pyramid plus one governance layer:

1. **Integration-test scaffolding** ([`IIntegrationTestFixture`](#iintegrationtestfixture),
   [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture),
   [`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint),
   [`JwtTokenGenerator`](#jwttokengenerator), [`FeatureManagementTestExtensions`](#featuremanagementtestextensions),
   [`EntityBuilderBase<TBuilder, TEntity>`](#entitybuilderbasetbuilder-tentity)) boots a real service host
   in-process against a throwaway SQL Server database and drives it over HTTP.
2. **Architecture fitness functions** ([`IArchitectureMap`](#iarchitecturemap), [`Layer`](#layer),
   `LayerRef`, [`ArchitectureAssert`](#architectureassert), `RuleHelpers`, the shared `ArchitectureRules.*`
   partial and the abstract `*TestsBase` library including [`RouteAuthorizationTestsBase`](#routeauthorizationtestsbase)
   and [`BrandColorTokenTestsBase`](#brandcolortokentestsbase)) turn architectural rules into build-gating
   assertions that run identically across all repos.
3. **Component (bUnit) testing** ([`BunitComponentTestBase`](#bunitcomponenttestbase),
   [`CapturingHttpMessageHandler`](#capturinghttpmessagehandler), [`MarkupSnapshot`](#markupsnapshot), and the
   `UiHttpServiceHarness`) render Blazor components in isolation with real MudBlazor services and faked
   HTTP/auth edges.
4. **End-to-end (Playwright) testing** ([`PlaywrightFixture`](#playwrightfixture), [`PageExtensions`](#pageextensions),
   [`AccessibilityViolationException`](#accessibilityviolationexception), [`WebVitalsCollector`](#webvitalscollector),
   `E2ETestConfiguration`, and the page-object family such as `LoginPage`/`RegisterPage`) drive a real
   browser against a running app, asserting accessibility and performance budgets alongside behavior.
5. **Contract/security bases** ([`SecurityHeadersTestsBase`](#securityheaderstestsbase) plus sibling
   `*ContractTestsBase` classes) pin cross-cutting HTTP guarantees so a pipeline refactor cannot silently
   drop them.

This whole group is the [Rubric §14, Testability] story made concrete: the framework does not just
*permit* testing, it ships the reusable substrate so every consumer tests the same way. The front-end
slices additionally carry [Rubric §21, Accessibility], [Rubric §22, Responsive/Cross-Browser],
[Rubric §23, Front-End Performance], and [Rubric §28, Front-End Testing]; the fitness library carries
[Rubric §34, Architecture Governance & Documentation].

## Integration tests: a real host, a throwaway database, a per-test reset

The integration tier boots the actual application, not a mock of it. The abstraction at its center is
[`IIntegrationTestFixture`](#iintegrationtestfixture)
(`MMCA.Common.Testing/IIntegrationTestFixture.cs:8`): a two-method contract, `CreateClient()` and
`ResetDatabaseAsync()`, that hides how the host and its database are provisioned. Its remarks are
load-bearing, a host running multiple physical data sources ("database per microservice", see
[primer](00-primer.md#2-architectural-styles-this-codebase-commits-to) and ADR-006) must reset **every**
relational source, and the fixture can resolve `IEntityDataSourceRegistry` / `IDataSourceResolver` from
the booted host to enumerate them.

[`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture)
(`MMCA.Common.Testing/IntegrationTestBase.cs:13`) is the per-test base every integration test class
inherits. It implements xUnit's `IAsyncLifetime` so that `InitializeAsync` resets the database before
each test (`IntegrationTestBase.cs:31`) and `DisposeAsync` disposes the HTTP client after
(`IntegrationTestBase.cs:34`). It exposes typed HTTP helpers (`GetAsync<T>`, `PostAsync<T>`,
`PutAsync<T>`, `DeleteAsync`, `IntegrationTestBase.cs:51-72`), bearer-token management
(`SetBearerToken`/`ClearAuthentication`, `IntegrationTestBase.cs:42-48`), and a thread-safe `NextId()`
counter seeded at 1000 (`IntegrationTestBase.cs:16,75`) so parallel tests never collide on generated
identifiers. Downstream projects subclass it to add domain-specific auth and entity helpers.

[`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint)
(`MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27`) is the concrete fixture scaffolding.
`InitializeAsync` (`SqlServerIntegrationTestFixtureBase.cs:67`) mints a GUID-suffixed database name, sets
`ASPNETCORE_ENVIRONMENT=Testing` and the top-level connection string as **process environment variables**
(so the host reads them at configure-time), builds the subclass-supplied `WebApplicationFactory`, and
forces database creation by requesting the first client, which runs the host's `Migrate` init strategy.
It then builds a Respawn checkpoint that ignores `__EFMigrationsHistory`
(`SqlServerIntegrationTestFixtureBase.cs:88-92`); `ResetDatabaseAsync` (`:96`) replays that checkpoint
between tests, and `DisposeAsync` (`:109`) drops the throwaway database and restores every pushed
environment variable. The `Testing` environment is chosen deliberately so `appsettings.Development.json`
(which points a module's `DataSources` entry at `localhost`) does not load, leaving the resolver to
collapse onto the overridden top-level connection string, a single-database monolith shape. Server
selection defaults to LocalDB but is overridable through `SqlBaseEnvironmentVariable`
(`SqlServerIntegrationTestFixtureBase.cs:58`) so CI can target a SQL service container. Because these
fixtures need a reachable SQL Server, the module `*.Integration.slnf` suites build in the sandbox but only
*run* in CI.

Two helpers round out the tier. [`JwtTokenGenerator`](#jwttokengenerator)
(`MMCA.Common.Testing/JwtTokenGenerator.cs:29`) issues **RS256**-signed tokens using an embedded dev RSA
keypair (`JwtTokenGenerator.cs:48-95`), so integration tests exercise the exact JWKS/RS256 validation code
path production runs (ADR-004); the class remarks flag, correctly, that the committed keypair is insecure
by design and must never be used in a real deployment. [`FeatureManagementTestExtensions`](#featuremanagementtestextensions)
(`MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10`) overrides feature flags via an in-memory
configuration so a test `WebApplicationFactory` can flip a gate without touching `appsettings.json`.
[`EntityBuilderBase<TBuilder, TEntity>`](#entitybuilderbasetbuilder-tentity)
(`MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9`) is a tiny fluent-builder base, its single abstract
`Build()` returns the entity via its domain factory so test setup only specifies what a test cares about.
Together these embody [Rubric §11, Security] (real token validation, not a bypassed auth middleware) and
[Rubric §14, Testability].

## Architecture fitness functions: rules that gate the build

The layering and DDD conventions this codebase commits to are not left to code review, they are executed
as tests. The reusable rule library lives in `MMCA.Common.Testing.Architecture` and is the subject of
**ADR-015**. Its keystone is [`IArchitectureMap`](#iarchitecturemap)
(`MMCA.Common.Testing.Architecture/IArchitectureMap.cs:39`): the single per-repo boundary that every
fitness function keys off. Each repo supplies one implementation (for example `CommonArchitectureMap`,
`StoreArchitectureMap`) declaring its layer and module assemblies through `LayerRef`
records (`IArchitectureMap.cs:31`) tagged by the [`Layer`](#layer) enum (`IArchitectureMap.cs:9`), and the
shared rules consume *only* the interface. That is why one rule body runs identically across
MMCA.Common, MMCA.Store, and MMCA.ADC (and Helpdesk): the map is the only thing that varies. The `Layer`
enum deliberately includes optional layers (`Ui`, `Grpc`, `Contracts`, `ServiceHost`) that a repo simply
omits, so a rule iterating them is vacuously satisfied with no compile dependency on an absent assembly
(`IArchitectureMap.cs:3-8`).

The rule bodies are split across the `ArchitectureRules.*` partial files (layers, purity, handlers,
entities, events, modules, slices, naming, transport, governance, localization, specifications), and the
abstract `*TestsBase` classes (`LayerDependencyTestsBase`, `DomainPurityTestsBase`,
`MicroserviceExtractionTestsBase`, `ModuleIsolationTestsBase`, and many more) each expose the rule as one
`[Fact]` that a sealed per-repo subclass activates by supplying its map. Failures report through
[`ArchitectureAssert`](#architectureassert)
(`MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:8`), which has two overloads: one lists the
failing types from a NetArchTest `TestResult` (`ArchitectureAssert.cs:11`), the other lists a
reflection-derived violation set (`ArchitectureAssert.cs:26`). Rules that NetArchTest cannot express
(method return types, generic constraints, property accessors, attribute usage) reflect over loaded types
via `RuleHelpers` (`MMCA.Common.Testing.Architecture/RuleHelpers.cs:8`), whose `GetLoadableTypes`
tolerates a partially-resolvable assembly (`RuleHelpers.cs:11`). One such reflection walk,
`CrossEntityNavigationFinder` (`MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97`),
is an `ExpressionVisitor` that finds cross-entity navigations reached from a specification's criteria.
These runtime rules are the second of two enforcement layers, the first being the compile-time MSBuild
layer guard (see [group 14](group-14-module-system-composition.md) and the Common CLAUDE.md); ADR-015
describes both, and this is the clearest [Rubric §34, Architecture Governance] expression in the codebase.

The fitness library reaches beyond pure layering into cross-cutting product guarantees.
[`RouteAuthorizationTestsBase`](#routeauthorizationtestsbase)
(`MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:22`, [Rubric §25, Navigation & IA])
reflects over routable Blazor pages and asserts every governed page keeps its `[Authorize(Roles = "...")]`
gate, so an admin route cannot regress to a bare `[Authorize]`; it detects `RouteAttribute` and
`AuthorizeAttribute` by full-name reflection so the package stays free of ASP.NET references
(`RouteAuthorizationTestsBase.cs:17-25`), and a `MinimumGovernedPages` floor guards against a moved
namespace silently emptying the scan. [`BrandColorTokenTestsBase`](#brandcolortokentestsbase)
(`MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:13`, [Rubric §20, Design System &
Theming]) reads landing-page stylesheets embedded as manifest resources and fails the build if a host
re-hardcodes the brand hex (`#1565C0`) instead of sourcing `var(--mmca-primary)` from the shared token
(`BrandColorTokenTestsBase.cs:15-16`). Sibling bases guard resilience (a drilled database restore, ADR-009),
integration-event schema versioning (ADR-010), the MassTransit-v8 pin (ADR-016), forms, localization, and
data residency, so the "governance as tests" pattern spans the full 34-category rubric.

## Component tests: real MudBlazor, faked edges

The bUnit tier renders a single Blazor component in-process with its real dependencies but stubbed
network and auth. [`BunitComponentTestBase`](#bunitcomponenttestbase)
(`MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33`) registers MudBlazor services, puts
JSInterop in loose mode so MudBlazor's JS probes do not throw during render
(`BunitComponentTestBase.cs:42-43`), and wires a **mutable** `AuthenticationStateProvider`
(`BunitComponentTestBase.cs:97`) plus an `IsAuthenticatedAuthorizationService`
(`BunitComponentTestBase.cs:111`) so both `<AuthorizeView>` cascades and pages that inject the provider
directly behave. Tests render anonymously by default via `RenderUnderTest<TComponent>`
(`BunitComponentTestBase.cs:59`) or as a supplied `ClaimsPrincipal` via `RenderAs<TComponent>`
(`BunitComponentTestBase.cs:65`), and `RenderMudProviders` (`BunitComponentTestBase.cs:83`) mounts the
popover/dialog/snackbar providers so components that open a dialog or raise a toast have somewhere to
render. The class is pinned to bUnit v2 (the line compatible with xUnit v3 / Microsoft Testing Platform),
and its remarks isolate every version-specific symbol here so a bUnit downgrade touches only this file
(`BunitComponentTestBase.cs:24-31`). Localization is pre-registered (`AddLocalization`,
`BunitComponentTestBase.cs:51-52`) so components injecting `IStringLocalizer<T>` (ADR-027) render without
per-test setup, an [Rubric §27, i18n] touch.

HTTP-backed UI services are exercised without a server through [`CapturingHttpMessageHandler`](#capturinghttpmessagehandler)
(`MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18`), a canned-response,
request-recording `HttpMessageHandler` supporting both a responder delegate and route registration, with
unmatched requests returning 404 to mirror the WebAPI's not-found behavior
(`CapturingHttpMessageHandler.cs:7-17`); it rebuilds each response fresh so a Polly retry never reuses a
consumed `HttpContent`. `UiHttpServiceHarness` (`MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:14`)
wraps that handler with an `IHttpClientFactory` that returns a fresh `"APIClient"` per call (the services
dispose each client, so the same instance must never come back twice) and a fixed-token storage stub, on a
`https://gateway.test/` base address. [`MarkupSnapshot`](#markupsnapshot)
(`MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21`) provides approval-style rendered-markup
snapshots for regression coverage. This tier is [Rubric §28, Front-End Testing] and [Rubric §18, UI
Architecture].

## End-to-end tests: a real browser, accessibility and performance as gates

The E2E tier drives a real browser through Playwright. [`PlaywrightFixture`](#playwrightfixture)
(`MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6`) is an xUnit collection fixture that
launches the engine selected from configuration, `chromium`, `firefox`, or `webkit`, with unknown values
falling back to Chromium (`PlaywrightFixture.cs:17-22`). That env-selected engine is what lets CI run the
same suite as a cross-browser matrix, [Rubric §22, Responsive/Cross-Browser] (chromium is the required
gate; firefox/webkit are advisory per the Common CLAUDE.md). Headless mode and slow-motion come from
`E2ETestConfiguration` (`MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8`).

The hard part of Blazor E2E is timing, and [`PageExtensions`](#pageextensions)
(`MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:14`) is where that knowledge is centralized. The
app uses InteractiveAuto with prerendering, so a page appears as static HTML before the WASM runtime wires
its event handlers; `WaitForBlazorAsync` (`PageExtensions.cs:20`) waits for `window.Blazor._internal` plus
two animation frames before any interaction, `FillAndVerifyAsync` (`PageExtensions.cs:154`) fills a field
then auto-waits until the value sticks (re-typing character-by-character if hydration wiped it), and
`ClickAndVerifyAsync` / `ClickAndWaitForUrlAsync` (`PageExtensions.cs:187,230`) poll a click until its
visible effect appears so a click that beats hydration is not silently swallowed. These helpers encode
hard-won lessons about the prerender/hydration race and are shared by every page object.

Accessibility and performance are asserted here, not left to a separate audit. `AssertNoAccessibilityViolationsAsync`
(`PageExtensions.cs:261`) runs an axe-core (WCAG 2.1 AA) scan and throws
[`AccessibilityViolationException`](#accessibilityviolationexception)
(`MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7`) with a compact,
per-node summary of every violation, so an inaccessible page fails the build, [Rubric §21, Accessibility].
[`WebVitalsCollector`](#webvitalscollector)
(`MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:17`) installs `PerformanceObserver`-based
Core Web Vitals capture (LCP, CLS, FCP, TTFB, INP) via an init script before first paint
(`WebVitalsCollector.cs:23-32`), reads the accumulated `WebVitalsSample` back
(`WebVitalsCollector.cs:44,73`), and writes a citable JSON artifact (`WebVitalsCollector.cs:60`) for CI,
[Rubric §23, Front-End Performance]. LCP/CLS are Chromium-only, so on Firefox/WebKit those fields stay 0
and the observers fail silently rather than throwing. The reusable identity page objects, `LoginPage`,
`RegisterPage`, `ProfilePage` (`MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6`), wrap the app's real
Login/Register/Profile surfaces with role- and label-based locators, and downstream apps (for example the
`MMCA.ADC.E2E.Tests` page-object family) add their own.

## The Gallery harness and the per-project rollup

Component and E2E coverage of MMCA.Common's *own* UI needs a page to render, but the framework is not a
runnable app. The `MMCA.Common.UI.Gallery` project is a deliberately backend-less Blazor host that renders
the real Login/Register pages plus a primitives showcase, kept **outside** `MMCA.Common.slnx` (with the
`MMCA.Common.UI.E2E.Tests` project) so the unit-test run stays fast; the CI `ui-e2e` job self-hosts it and
scans it with axe-core. It runs without a backend by registering no-op stubs:
[`AnonymousAuthenticationStateProvider`](#anonymousauthenticationstateprovider)
(`MMCA.Common.UI.Gallery/Stubs/AnonymousAuthenticationStateProvider.cs:11`), `NullTokenRefresher`, and
`NullTokenStorageService` stand in for the auth/token services the real pages inject.

Finally, contract bases pin cross-cutting HTTP guarantees. [`SecurityHeadersTestsBase`](#securityheaderstestsbase)
(`MMCA.Common.Testing/SecurityHeadersTestsBase.cs:16`, [Rubric §11, Security] / [Rubric §26, Front-End
Security]) probes an always-responding endpoint (`/alive` by default) and asserts the hardened header set
(`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Content-Security-Policy` frame-ancestors, and production HSTS, `SecurityHeadersTestsBase.cs:29-35`) so a
pipeline refactor cannot silently drop them; sibling `OpenApiContractTestsBase`,
`ProblemDetailsContractTestsBase`, and `ServiceInfoVersioningContractTestsBase` pin the corresponding API
contracts, [Rubric §9, API & Contract Design].

Every remaining concrete test class, the hundreds of `[Fact]`-bearing unit, integration, fitness,
component, and E2E classes that subclass or consume the machinery above, is cataloged by project in the
companion per-project test rollup for this chapter. The takeaway for a new engineer: pick the tier that
matches what you are proving (fast unit tests for domain logic, bUnit for a component, an integration
fixture for a full request path, an E2E page object for a browser flow, a `*TestsBase` subclass for an
architectural invariant), and the reusable base you need is already in one of the four `MMCA.Common.Testing.*`
packages.

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
  TEntity>` (`EntityBuilderBase.cs:9-10`) is the curiously-recurring template pattern: a concrete
  builder passes *itself* as `TBuilder`, so the shared `WithX(...)` methods a subclass adds can return
  the concrete builder type and keep a fluent chain strongly typed without a cast.
- **Walkthrough**
  - `Build()` (`EntityBuilderBase.cs:17`): the single abstract member. The XML doc
    (`EntityBuilderBase.cs:12-15`) records the contract, the subclass calls the entity's
    `Result<T>`-returning factory and throws if it failed, so a builder never yields a domain object
    that violated its invariants. The base deliberately owns no state and no default `WithX`
    helpers, those live on each concrete builder because defaults are per-entity.
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
  (`FeatureManagementTestExtensions.cs:1-3`). No first-party dependency.
- **Concept**: this is the test-side counterpart to the framework's FeatureGate decorator (the
  outermost link in the CQRS pipeline, taught in
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)). `[Rubric §14,
  Testability]` again: a gated handler is only meaningfully testable if a test can flip its flag
  deterministically; `[Rubric §10, Cross-Cutting]` applies too, feature management is a cross-cutting
  concern, and this helper keeps its test-time configuration in one reusable place.
- **Walkthrough**
  - `ConfigureTestFeatureFlags(this IServiceCollection, Dictionary<string, bool>)`
    (`FeatureManagementTestExtensions.cs:20-35`): a classic `this`-parameter extension method (not an
    `extension(T)` block). It projects each `name -> bool` pair into an in-memory configuration key
    under the `FeatureManagement:` section (`FeatureManagementTestExtensions.cs:24-29`), registers that
    `IConfiguration` as a singleton, then calls `AddFeatureManagement` against the section
    (`FeatureManagementTestExtensions.cs:31-32`) and returns the collection for chaining.
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
  - `CreateClient()` (`IIntegrationTestFixture.cs:11`): returns an `HttpClient` pointed at the in-process
    test server.
  - `ResetDatabaseAsync()` (`IIntegrationTestFixture.cs:19`): resets the database between tests
    (typically via Respawn). The doc comment (`IIntegrationTestFixture.cs:13-18`) records a load-bearing
    rule for the database-per-service topology (ADR-006): a host with multiple physical data sources
    must reset **every** relational source, and can enumerate them by resolving
    `IEntityDataSourceRegistry` / `IDataSourceResolver` from the host's services.
- **Why it's built this way**: two members, no state, no host coupling. The interface is deliberately
  minimal so that the reset strategy (single database vs. multi-source) is the fixture's problem, not
  the base's.
- **Where it's used**: implemented by [`SqlServerIntegrationTestFixtureBase<TEntryPoint>`](#sqlserverintegrationtestfixturebasetentrypoint)
  and by each app's concrete fixtures; consumed as the `TFixture` constraint on every integration and
  contract test base in this group.

### JwtTokenGenerator
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:29` · Level 0 · class (static)

- **What it is**: a static factory that mints signed JWT bearer tokens for integration tests, so a test
  can call an authorized endpoint as any role/user without standing up the real login flow. Each
  downstream project wraps it with role-specific convenience methods (AdminToken, OrganizerToken, ...).
- **Depends on**: BCL / NuGet only, `System.IdentityModel.Tokens.Jwt`,
  `System.Security.Cryptography` (RSA), and `Microsoft.IdentityModel.Tokens`
  (`JwtTokenGenerator.cs:1-5`). The generated claim layout mirrors the framework's
  [`ITokenService`](group-08-auth.md#itokenservice) so middleware cannot tell a test token from a
  real one.
- **Concept introduced, exercising the real RS256/JWKS path in tests.** `[Rubric §11, Security]`
  assesses how authentication and key handling are done; the deliberate choice here is that tests sign
  with **RS256** (`SecurityAlgorithms.RsaSha256`, `JwtTokenGenerator.cs:130`) using an embedded RSA-2048
  dev keypair, the *same* asymmetric algorithm production uses, so integration tests run the identical
  JWKS/RS256 validation code path (ADR-004 authentication dual-fetch, taught in
  [primer §2](00-primer.md#the-decision-records-adrs-this-guide-tags)) rather than a weaker HMAC
  shortcut. `[Rubric §14, Testability]` covers the ergonomics: deterministic tokens with no per-run
  key generation.
- **Walkthrough**
  - Public constants (`JwtTokenGenerator.cs:32-95`): `DefaultIssuer` (`https://localhost:6001`),
    `DefaultKeyId` (`mmca-test-key`, the `kid` the host advertises on its JWKS document), and the paired
    `DefaultPublicKeyPem` / `DefaultPrivateKeyPem`. Test host appsettings wire these into `Jwt:Issuer`,
    `Jwks:KeyId`, `Jwt:RsaPublicKeyPem`, and `Jwt:RsaPrivateKeyPem` so
    [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider) publishes a matching JWKS entry.
  - `GenerateToken(...)` (`JwtTokenGenerator.cs:111-152`): imports the PEM private key into
    `RSAParameters` inside a `using` so the `RSA` instance can be disposed without invalidating the
    `SigningCredentials` (`JwtTokenGenerator.cs:120-130`), assembles the standard claim set
    (`NameIdentifier`, `user_id`, `Role`) plus any caller-supplied extras
    (`JwtTokenGenerator.cs:132-142`), and writes a one-hour token
    (`JwtTokenGenerator.cs:144-151`).
- **Why it's built this way**: the whole point is fidelity, tokens are indistinguishable in shape and
  signing algorithm from production, so auth middleware, JWKS discovery, and role checks are all under
  test, not stubbed.
- **Where it's used**: called by [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture)
  subclasses via `SetBearerToken(...)`, wrapped by each app's role-specific token helpers.
- **Caveats / not-in-source**: the class doc (`JwtTokenGenerator.cs:21-27`) carries an explicit security
  warning, the embedded keypair is committed to the public repo and is insecure by design, for test
  determinism only. Production keys come from user-secrets / Key Vault via `JwtSettings.RsaPrivateKeyPem`
  and must never be this keypair.

### SecurityHeadersTestsBase
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/SecurityHeadersTestsBase.cs:16` · Level 0 · class (abstract)

- **What it is**: a one-test fitness base that asserts a booted host emits the hardened set of security
  response headers on every response, so a later pipeline refactor cannot silently drop them. Authored
  once, re-run as a thin subclass per host under test.
- **Depends on**: `AwesomeAssertions` and `Xunit` (`SecurityHeadersTestsBase.cs:1-2`). It does not
  extend the integration base, it only needs an `HttpClient`, so it takes one via an abstract factory
  rather than inheriting the SQL fixture machinery.
- **Concept**: a security fitness test. `[Rubric §11, Security]` assesses defense-in-depth at the HTTP
  edge; this test pins the exact header values the shared `AddCommonSecurityHeaders` /
  `UseCommonSecurityHeaders` middleware (see
  [`SecurityHeadersMiddleware`](group-16-aspire-orchestration.md#securityheadersmiddleware)) is expected
  to emit. `[Rubric §14, Testability]` covers the reusable-base shape.
- **Walkthrough**
  - `ProbePath` (`SecurityHeadersTestsBase.cs:19`): overridable, defaults to `/alive` because the
    liveness endpoint always answers independent of any backend being reachable, so the header check is
    never flaky for the wrong reason.
  - `AliveResponse_CarriesHardenedSecurityHeaders` (`SecurityHeadersTestsBase.cs:21-36`): the single
    `[Fact]`. It GETs `ProbePath` and asserts `X-Content-Type-Options: nosniff`, `X-Frame-Options:
    DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` containing
    `geolocation=()`, a `Content-Security-Policy` containing `frame-ancestors 'none'`, and (because the
    host under test boots in the Production environment) an HSTS `Strict-Transport-Security` header with
    a `max-age=` (`SecurityHeadersTestsBase.cs:29-35`).
  - `CreateClient()` (`SecurityHeadersTestsBase.cs:42`): abstract, the subclass supplies it from its
    `WebApplicationFactory` class fixture. `Header(...)` (`SecurityHeadersTestsBase.cs:44-45`) is the
    private helper that flattens a header's values or returns null.
- **Why it's built this way**: pinning literal header values (not just presence) turns "we harden
  responses" into an executable, per-host guarantee, and probing `/alive` keeps the test independent of
  application state. Booting the subclass fixture in Production is what makes the HSTS assertion valid.
- **Where it's used**: subclassed by each host's security-header fitness test (typically the gateway).

### IntegrationTestBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:13` · Level 1 · class (abstract)

- **What it is**: the workhorse base class every integration test inherits. It owns the per-test HTTP
  client and lifecycle, typed request helpers, bearer-token management, and a thread-safe id counter,
  so a concrete test class is left with just its arrange/act/assert.
- **Depends on**: [`IIntegrationTestFixture`](#iintegrationtestfixture) (the `TFixture` constraint,
  `IntegrationTestBase.cs:14`), plus `Xunit`'s `IAsyncLifetime` and `System.Net.Http.Json`
  (`IntegrationTestBase.cs:1-3`).
- **Concept introduced, the xUnit async test lifecycle + per-test isolation.** `[Rubric §14,
  Testability]`: the base implements `IAsyncLifetime` so `InitializeAsync` runs **before each test** and
  `DisposeAsync` **after**, and it hangs the database reset off that hook so every test starts from a
  clean database, the single most important property for reliable integration tests.
- **Walkthrough**
  - Fields / properties: a `static int _nextId = 1000` seed (`IntegrationTestBase.cs:16`), and the
    `Fixture` / `Client` protected properties (`IntegrationTestBase.cs:19-22`).
  - Constructor (`IntegrationTestBase.cs:24-28`): stores the injected fixture and eagerly creates the
    `HttpClient` from it.
  - `InitializeAsync` (`IntegrationTestBase.cs:31`): awaits `Fixture.ResetDatabaseAsync()` before each
    test. `DisposeAsync` (`IntegrationTestBase.cs:34-39`): disposes the client and suppresses finalization.
  - Auth helpers: `SetBearerToken(string)` / `ClearAuthentication()` (`IntegrationTestBase.cs:42-48`) set
    or clear the `Authorization` header, the hook through which a
    [`JwtTokenGenerator`](#jwttokengenerator) token is applied.
  - Typed HTTP helpers: `GetAsync<T>` (`IntegrationTestBase.cs:51-56`, which calls
    `EnsureSuccessStatusCode` then deserializes), `PostAsync<T>` / `PutAsync<T>` / `PutAsync` /
    `DeleteAsync` (`IntegrationTestBase.cs:59-72`) returning the raw `HttpResponseMessage` so a test can
    assert status codes.
  - `NextId()` (`IntegrationTestBase.cs:75`): `Interlocked.Increment` over the shared seed, so
    parallel tests never collide on generated ids.
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
- **Depends on**: [`IIntegrationTestFixture`](#iintegrationtestfixture) (implemented), plus
  `Microsoft.AspNetCore.Mvc.Testing` (`WebApplicationFactory`), `Microsoft.Data.SqlClient`, `Respawn`,
  and `Xunit` (`SqlServerIntegrationTestFixtureBase.cs:1-4`).
- **Concept introduced, the disposable-database integration fixture + environment-variable overrides.**
  `[Rubric §14, Testability]` and `[Rubric §8, Data Architecture]`: real integration coverage needs a
  real relational database, and this fixture makes that cheap and hermetic, a fresh GUID-named database
  per fixture, migrated from scratch, Respawned between tests, dropped at the end. The database-per-service
  routing (ADR-006) is why the doc comment stresses that hosts with multiple sources reset each one.
- **Walkthrough**
  - State (`SqlServerIntegrationTestFixtureBase.cs:30-45`): the recorded original-environment map, the
    server-base / database-name strings, the `WebApplicationFactory`, the `Respawner`, and the public
    `Client` / `ConnectionString`. `ConnectionString` is exposed so SQL-fidelity tests can read raw
    tables (for example to assert an event landed in the outbox).
  - `Services` (`SqlServerIntegrationTestFixtureBase.cs:52`): the booted host's root provider, exposed so
    cross-service tests can resolve a real `IIntegrationEventHandler<T>` or repository and drive the
    integration-event flow directly.
  - Abstract knobs: `SqlBaseEnvironmentVariable` (`:58`, names the env var holding the CI SQL base
    connection string), `DatabaseNamePrefix` (`:61`), and `CreateFactory()` (`:128`, the subclass builds
    the host).
  - `InitializeAsync` (`SqlServerIntegrationTestFixtureBase.cs:67-93`): resolves the server base from
    `SqlBaseEnvironmentVariable` or falls back to LocalDB (`:69-70`), composes a GUID-suffixed database
    name and connection string (`:71-72`), forces `ASPNETCORE_ENVIRONMENT=Testing` and pushes the
    top-level SQL connection string as env vars (`:75-76`), lets the subclass push its own via
    `ConfigureTestEnvironment` (`:77`), builds the factory, and creating the client is what triggers the
    host's `Migrate` init to create the database and apply migrations (`:81-84`); it then builds the
    `Respawner`, ignoring `__EFMigrationsHistory` (`:86-92`).
  - `ResetDatabaseAsync` (`:96-106`): opens a connection and calls `Respawner.ResetAsync`.
  - `DisposeAsync` (`:109-125`): disposes client and factory, drops the database, restores the
    environment. `SetEnvironmentVariable` (`:140-149`) records only the **first** original value per key
    so re-pushing cannot corrupt the restore point; `RestoreEnvironment` (`:151-159`) puts them all back.
  - `DropDatabaseAsync` (`:161-176`): clears pooled connections, connects to `master`, and runs a
    `SET SINGLE_USER WITH ROLLBACK IMMEDIATE` + `DROP DATABASE`, with a scoped `CA2100` suppression
    justified because the database name is a server-generated GUID, never user input.
- **Why it's built this way**: overrides go through process environment variables because the host reads
  its connection string at configure-time; forcing the `Testing` environment skips
  `appsettings.Development.json` (which would point `DataSources` at `localhost`) so the resolver
  collapses onto the single overridden top-level connection string, making the fixture behave like a
  clean single-database monolith. LocalDB-by-default keeps local runs zero-config while CI can point at
  a SQL service container.
- **Where it's used**: the base of each app's per-service integration fixture (Identity / Conference /
  Engagement and equivalents), which is then the `TFixture` for that service's integration and contract
  tests.
- **Caveats / not-in-source**: the fixture needs a reachable SQL Server, so it builds but does not run in
  the headless sandbox; these run in CI's SQL-service job.

### OpenApiContractTestsBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/OpenApiContractTestsBase.cs:21` · Level 2 · class (abstract)

- **What it is**: a contract fitness base that boots a host and asserts its `/openapi/v1.json` document
  is served, is a well-formed OpenAPI 3.x document, and still describes the core public resources, so an
  accidental controller/route removal fails CI instead of silently changing the published contract.
- **Depends on**: [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) (inherited,
  `OpenApiContractTestsBase.cs:21`), `System.Text.Json`, `AwesomeAssertions`, `Xunit`
  (`OpenApiContractTestsBase.cs:1-4`).
- **Concept introduced, the contract guard on the live document.** `[Rubric §9, API & Contract
  Design]` assesses whether the API surface is described and kept stable; the pattern across all three
  Level 2 bases is a **live-document guard with no committed snapshot** (`OpenApiContractTestsBase.cs:14-16`),
  the assertions run against the document the host actually serves, so new controllers can never leave a
  stale snapshot behind and a removed one is caught immediately.
- **Walkthrough**
  - Overridable / abstract knobs: `OpenApiDocumentPath` (`:30`, defaults to `/openapi/v1.json`),
    `MinimumPathCount` (`:37`, a coarse floor under the route surface), `MinimumPathCountBecause`
    (`:44`, the failure-message reason), and `CorePublicResources` (`:50`, the resource paths that must
    keep being described).
  - `OpenApiDocument_IsServed_AsWellFormedOpenApiDescribingTheApiSurface` (`:52-65`): parses the JSON and
    asserts `openapi` starts with `3.`, `info.title` is non-empty, a `paths` object exists, and it holds
    at least `MinimumPathCount` entries.
  - `OpenApiDocument_DescribesEveryCorePublicResource` (`:67-85`): first guards against a vacuous pass
    (the subclass must pin at least one resource), then checks every `CorePublicResources` entry is
    present, matching on name case-insensitively (`:77-80`) so presence, not exact casing, is the
    contract.
  - `GetOpenApiJsonAsync` (`:91-100`): clears auth (the document is anonymous outside Production),
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
  `ProblemDetailsContractTestsBase.cs:21`), `System.Net`, `System.Net.Http.Json`, `System.Text.Json`,
  `AwesomeAssertions`, `Xunit` (`ProblemDetailsContractTestsBase.cs:1-5`). Same live-guard shape as the
  OpenAPI base above.
- **Concept**: still `[Rubric §9, API & Contract Design]`, here the pinned contract is the **error
  shape**. The class covers the two distinct paths that produce errors (`ProblemDetailsContractTestsBase.cs:11-18`):
  ASP.NET Core model validation (a 400 `application/problem+json` body) and the framework's
  `HandleFailure` `Result`-error mapping (see
  [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase)), which turns a
  [`Result`](group-01-result-error-handling.md#result) failure such as an
  [`Error`](group-01-result-error-handling.md#error) not-found into a 404 problem.
- **Walkthrough**
  - `Validation_400_HasProblemDetailsShape` (`:29-39`): sends the subclass's validation probe, asserts
    the shared shape at 400, then checks the `problem+json` content type and the model-validation-only
    extensions `type`, `traceId`, and `errors`.
  - `NotFound_404_HasProblemDetailsShape` (`:41-47`): sends the 404 probe and asserts the shared shape.
  - Abstract probes: `SendValidationErrorProbeAsync` (`:54`) and `SendNotFoundProbeAsync` (`:60`), the
    only app-specific pieces, authenticating first when the endpoint requires it.
  - `AssertProblemDetailsShapeAsync` (`:67-83`): the shared static assertion, JSON content type,
    echoed `status`, non-empty `title`, and at least one diagnostic extension (`errors`, `traceId`, or
    `requestId`), returning the parsed body so a subclass can follow up (for example a host with a
    reachable 409-conflict path adds its own conflict test reusing this helper).
- **Why it's built this way**: pinning both the validation path and the `HandleFailure` path in one base
  means a regression in either error channel breaks CI, and factoring the shape assertion into a shared
  static keeps every host's error contract identical.
- **Where it's used**: subclassed as `ProblemDetailsContractTests` per host, plus per-host conflict tests
  layered on `AssertProblemDetailsShapeAsync`.

### ServiceInfoVersioningContractTestsBase<TFixture>
> MMCA.Common.Testing · `MMCA.Common.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19` · Level 2 · class (abstract)

- **What it is**: a contract fitness base that proves the API-versioning machinery actually works across
  more than one version, that `/ServiceInfo` is served by both v1.0 (deprecated) and v2.0, selected by
  the `api-version` header, and that the host reports supported/deprecated versions in response headers.
- **Depends on**: [`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture) (inherited,
  `ServiceInfoVersioningContractTestsBase.cs:19`), `System.Net`, `System.Text.Json`,
  `AwesomeAssertions`, `Xunit` (`ServiceInfoVersioningContractTestsBase.cs:1-4`).
- **Concept**: `[Rubric §9, API & Contract Design]` again, the versioning axis. The doc
  (`ServiceInfoVersioningContractTestsBase.cs:8-16`) makes the point that without a second working
  version the whole versioning story would be untestable, so this base keeps the machinery *exercised*
  rather than merely asserted. Because the `ServiceInfo` controller ships in `MMCA.Common.API`
  (`ServiceInfoControllerBase`, cross-referenced in
  [group-12](group-12-api-hosting-mapping.md#serviceinfocontrollerbase)), the entire test body is
  identical across repos; a subclass supplies only its fixture.
- **Walkthrough**
  - `ServiceInfo_V1_ReturnsMinimalShape_AndIsReportedDeprecated` (`:27-41`): requests v1.0, asserts 200,
    checks `apiVersion == "1.0"` and that the evolved `supportedVersions` list is **absent** in the v1
    shape, then asserts an `api-deprecated-versions` response header contains `1.0`.
  - `ServiceInfo_V2_ReturnsEvolvedShape_AndIsReportedSupported` (`:43-57`): requests v2.0, asserts 200,
    checks `apiVersion == "2.0"` and that `supportedVersions` contains `2.0`, then asserts an
    `api-supported-versions` header advertises `2.0`.
  - `GetServiceInfoAsync(string)` (`:59-65`): clears auth and sends the GET with the `api-version` header
    set to the requested version.
- **Why it's built this way**: keeping a real deprecated v1 and a real v2 side by side, and asserting both
  the payload shapes and the `ReportApiVersions` headers, is what proves version negotiation is wired
  end to end rather than configured and forgotten.
- **Where it's used**: subclassed per host as the service-info versioning fitness test, fixture only.

### ArchitectureAssert
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:8` · Level 0 · class

- **What it is** - the shared failure-reporting helper for every architecture fitness function, a static class with two `NoViolations` overloads that turn a rule breach into a readable, type-listing assertion failure.
- **Depends on** - `NetArchTest.Rules.TestResult` (NuGet) and AwesomeAssertions' `Should()` (the `.Should().BeTrue(...)`/`.Should().BeEmpty(...)` fluent API). No first-party dependencies: this is the bottom of the fitness-function stack.
- **Concept introduced** - *architecture fitness functions.* A fitness function is an automated test that asserts a structural property of the codebase (a layer never references another, a controller is sealed) rather than a behavioral one. This package makes those rules first-class, shared code. [Rubric §14 - Testability] assesses how well invariants are guarded by executable checks; `ArchitectureAssert` is the reporting primitive that makes a failing invariant name its offenders instead of just going red. [Rubric §34 - Architecture Governance] assesses whether architectural decisions are enforced rather than merely documented; every rule in this package funnels its verdict through here.
- **Walkthrough** - `NoViolations(TestResult result, string reason)` (`ArchitectureAssert.cs:11`) returns early when `result.IsSuccessful` (line 13), otherwise joins `result.FailingTypes` full names into a bullet list (lines 18-19) and asserts `IsSuccessful.Should().BeTrue(...)` with the reason plus the violation list as the `because` argument (lines 21-22). The second overload `NoViolations(IEnumerable<string> violations, string reason)` (line 26) materializes the sequence and asserts `list.Should().BeEmpty(...)` (line 30), for the reflection-derived rules that produce a plain string list rather than a NetArchTest result.
- **Why it's built this way** - the XML doc (lines 3-7) names it "the un-drifted successor to the three per-repo `ArchitectureTestHelper.AssertNoViolations` copies": the reporting logic was duplicated in MMCA.Common, MMCA.Store, and MMCA.ADC, and centralizing it here removes the drift.
- **Where it's used** - every rule in [`ArchitectureRules`](#architecturerules) and every reflection-based helper calls one of these two overloads as its final step.

### BrandColorTokenTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:13` · Level 0 · class

- **What it is** - an abstract xUnit test base that fails the build when a landing-page stylesheet re-hardcodes the brand hex instead of sourcing it from the shared `var(--mmca-primary)` CSS custom property.
- **Depends on** - `[Fact]` (xUnit), AwesomeAssertions, and `Assembly.GetManifestResourceStream` (BCL) to read embedded CSS. No first-party type dependency: it operates on strings the subclass embeds.
- **Concept introduced** - *drift fitness function.* Unlike a layer rule that reflects over assemblies, a drift function reads committed text (CSS here) and asserts a single-source-of-truth token is used. [Rubric §20 - Design System & Theming] assesses whether visual tokens have one authoritative definition; this base guards that consumers of the framework palette cannot silently fork the primary color.
- **Walkthrough** - two private constants pin the forbidden literal `#1565C0` and the required token `var(--mmca-primary)` (lines 15-16). The subclass supplies `EmbeddedCssLogicalNames` (line 22), the manifest-resource names of its landing-page stylesheets. The single `[Fact]` `LandingPageCss_SourcesBrandColorFromToken_NotHardcodedHex` (line 25) first asserts the list is non-empty (a non-vacuity guard, lines 27-28), then for each stylesheet reads it via `ReadEmbeddedCss` (line 56, which throws if the resource is missing, lines 58-60) and records a violation if the token is absent (line 41) or the raw hex is present (line 46).
- **Why it's built this way** - the doc (lines 4-11) explains the split: MMCA.Common's own `BrandColorTokenTests` guards the C#-to-CSS token *definition* (from `BrandColors.Primary`), while this base guards every downstream *consumer* of it, embedding the stylesheets as manifest resources so the package needs no file-system access to the consumer repo.
- **Where it's used** - subclassed once per repo that ships a branded landing page (Store, ADC).

### CrossEntityNavigationFinder
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97` · Level 0 · class

- **What it is** - a private `ExpressionVisitor` nested in [`ArchitectureRules`](#architecturerules) that walks a specification's `Criteria` lambda and collects the names of *other* entity types it navigates into.
- **Depends on** - `System.Linq.Expressions.ExpressionVisitor`, `MemberExpression`, `PropertyInfo` (BCL) and the [`RuleHelpers`](#rulehelpers) reflection extension `InheritsAuditableEntity()`.
- **Concept introduced** - *expression-tree inspection as a fitness check.* NetArchTest reasons about assembly-level references only; to catch a rule expressed *inside* a lambda body (`s => s.Event.IsPublished`), the code instantiates the specification, reads its `Criteria` expression tree, and visits it. This backs the polyglot / database-per-service invariant (ADR-006): a `Criteria` that navigates to an entity in another physical data source produces an untranslatable join at runtime. [Rubric §8 - Data Architecture] assesses cross-source data access discipline; this visitor is how that discipline is machine-checked.
- **Walkthrough** - the primary constructor captures `ownEntityType` (line 97). `Find(Expression body)` visits the body and returns the accumulated `_navigated` set (lines 101-105). `VisitMember` (line 107) resolves the accessed property's type through `EntityTypeOf` (line 121) and, when it is an auditable entity other than the specification's own type, adds its name (lines 111-115). `EntityTypeOf` treats a direct entity property as a navigation and unwraps generic collection navigations (`ICollection<TChild>`) to their element type (lines 121-139).
- **Why it's built this way** - filtering by a foreign-key column is engine-portable; navigating is not (notably on Cosmos, where the cross-source relationship is degraded out of the model). The finder is the enforcement half of [`ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities`](#architecturerules) (line 24).
- **Where it's used** - only inside that rule (line 66), which is surfaced through [`SpecificationConventionTestsBase`](#specificationconventiontestsbase).

### Layer
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:9` · Level 0 · enum

- **What it is** - the closed vocabulary of architectural layers a fitness function can reason about: `Shared`, `Domain`, `Application`, `Infrastructure`, `Api`, `Ui`, `Grpc`, `Contracts`, `ServiceHost` (lines 11-19).
- **Depends on** - nothing; a plain enum.
- **Concept introduced** - the Clean Architecture layer taxonomy made into a type. The layer flow itself is taught in [primer §1](00-primer.md#1-the-big-picture); here it becomes an enum the rule library keys off, so a rule that iterates layers is written once against the enum rather than hard-coded per repo. [Rubric §3 - Clean Architecture] assesses whether the layering is explicit and enforced; this enum is the shared alphabet.
- **Walkthrough** - the doc (lines 3-7) notes that `Ui`, `Grpc`, `Contracts`, and `ServiceHost` are optional: a repo simply omits them from its map when absent, so a rule iterating them is vacuously satisfied with no compile dependency on the missing assembly. [`ArchitectureMapBase.Segment`](#architecturemapbase) translates each member to its namespace segment (e.g. `Api` to `"API"`).
- **Where it's used** - carried by [`LayerRef`](#layerref), projected by [`IArchitectureMap.OfLayer`](#iarchitecturemap), and threaded through nearly every method in [`ArchitectureRules`](#architecturerules).

### RouteAuthorizationTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:22` · Level 0 · class

- **What it is** - an abstract test base that reflects over a UI assembly's routable Blazor pages and fails the build if a page the subclass marks as governed has lost its `[Authorize(Roles = "...")]` role gate.
- **Depends on** - `[Fact]` (xUnit), AwesomeAssertions, and pure reflection over attribute instances by full name (no ASP.NET reference, lines 24-25).
- **Concept introduced** - *security-regression fitness function.* [Rubric §11 - Security] and [Rubric §25 - Navigation & IA] assess whether protected routes stay protected; this base turns "the admin page must require the Organizer role" from a review checklist into a compiled assertion, so a page cannot silently regress from `[Authorize(Roles=...)]` to a bare `[Authorize]` reachable by any authenticated user.
- **Walkthrough** - the subclass supplies `TargetAssembly` (line 28), the exact `RequiredRole` (line 31), an `IsGovernedPage` strategy (line 40), and a `MinimumGovernedPages` non-vacuity floor (line 47, default 1). `GovernedPages_RequireDeclaredRole` (line 50) collects pages that are routable, governed, and do not require the role, and asserts the offender set is empty (lines 52-60). A second `[Fact]` `GovernedPageSet_IsNotEmpty` (line 64) guards the guard: if a refactor moved namespaces so `IsGovernedPage` matched nothing, the first test would pass vacuously, so this one asserts the discovered count meets the floor (lines 68-73). Detection uses `RouteAttribute`/`AuthorizeAttribute` full-name reflection (`IsRoutablePage` line 77, `RequiresRole` line 83, walking base types in `IsOrDerivesFrom` line 105).
- **Why it's built this way** - reflection by attribute full name (lines 24-25) keeps the shared package free of an ASP.NET Core reference while still inspecting ASP.NET attributes; a reflection scan also covers future pages matching the strategy without hand-enumeration.
- **Where it's used** - subclassed per module UI assembly in Store and ADC.

### RuleHelpers
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/RuleHelpers.cs:8` · Level 0 · class

- **What it is** - the internal reflection toolbox the reflection-based fitness functions share: extension methods for enumerating loadable types, matching suffix conventions on generic types, detecting base types and interfaces by open generic or name prefix, and classifying property setters as mutable vs. `init`-only.
- **Depends on** - `System.Reflection` (`Assembly`, `Type`, `PropertyInfo`, `ReflectionTypeLoadException`) only.
- **Concept introduced** - the doc (lines 3-7) states the premise: NetArchTest cannot inspect method return types, generic-argument constraints, property accessors, or attribute usage, so those rules reflect over loaded types directly through these helpers. [Rubric §14 - Testability] and [Rubric §15 - Best Practices] apply: the reflection subtleties (partial assembly loads, `init`-only detection) are solved once here rather than re-derived per rule.
- **Walkthrough** - `GetLoadableTypes` (line 11) tolerates a partially-resolvable assembly by catching `ReflectionTypeLoadException` and returning the types that did load (lines 17-21). `ConcreteClasses` (line 25) narrows to non-abstract classes. `SimpleName` (line 33) strips the generic-arity backtick so suffix conventions match generic types (`DeleteEntityCommand` with a two-arity marker becomes `DeleteEntityCommand`). `InheritsGeneric` (line 41) and `ImplementsGeneric` (line 55) walk the base chain / interface set for an open generic. `HasBaseTypeStartingWith` (line 63) detects a framework base by full-name prefix without a compile dependency (e.g. FluentValidation's open generic `AbstractValidator`). `HasPublicMutableSetter` (line 85) is the immutability primitive: it reports `false` for `init`-only setters by looking for the `IsExternalInit` required-custom-modifier (lines 93-95). The tail (`InheritsAggregateRoot` line 101, `InheritsAuditableEntity` line 105) hard-codes the MMCA entity base full names so the entity rules can classify types cross-repo.
- **Why it's built this way** - every helper avoids a compile-time reference to the type it detects (base types matched by string prefix), which is what lets one rule body run identically across three repos that do not reference each other.
- **Where it's used** - throughout [`ArchitectureRules`](#architecturerules) partials and [`CrossEntityNavigationFinder`](#crossentitynavigationfinder).

### LayerRef
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:31` · Level 1 · record

- **What it is** - an immutable record describing one assembly in a repo's architecture: its owning `Module`, its [`Layer`](#layer), the compiled `Assembly`, and its `RootNamespace` (line 31).
- **Depends on** - [`Layer`](#layer) and `System.Reflection.Assembly`.
- **Concept introduced** - the atomic unit of an architecture map. `Module` is the empty string for framework (MMCA.Common) layers that belong to no business module (lines 22-30), which is how the same record models both a module assembly (`("Catalog", Application, ...)`) and a shared framework assembly (`("", Shared, ...)`).
- **Walkthrough** - a positional `sealed record` (line 31), so it gets structural equality and immutability for free; its four fields are set once at construction by the map's `DefineLayers`.
- **Where it's used** - [`ArchitectureMapBase`](#architecturemapbase) stores a lazy `IReadOnlyList<LayerRef>` and derives every projection ([`IArchitectureMap`](#iarchitecturemap) members) from it; the `Framework`/`Module` factory helpers build these.

### IArchitectureMap
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:39` · Level 2 · interface

- **What it is** - the single per-repo abstraction every architecture fitness function keys off. Each repo supplies one implementation declaring its layer/module assemblies; the shared rule library and abstract test bases consume *only* this interface, so a rule is written once and runs identically across MMCA.Common, MMCA.Store, and MMCA.ADC (lines 33-38).
- **Depends on** - [`LayerRef`](#layerref), [`Layer`](#layer), `System.Reflection.Assembly`.
- **Concept introduced** - the *architecture map as the fitness-function extension point*. This is a classic Dependency Inversion: the rules depend on an abstraction (the map), and each repo provides the concrete inventory of its assemblies. [Rubric §1 - SOLID] (DIP) and [Rubric §7 - Microservices Readiness] apply: the map also models the per-module layers a would-be extracted service owns, so the isolation rules can check module boundaries the same way in any repo.
- **Walkthrough** - the interface exposes identity (`RepoToken` line 42, `ModuleNames` line 45), the raw `Layers` inventory (line 48), and a set of projections the rules lean on: `OfLayer` (all assemblies of a kind, line 51), the per-module `ModuleDomain`/`ModuleApplication`/`ModuleShared` (lines 54-60), `Infrastructure()`/`Api()` (lines 63-66), lookups `For(module, layer)` (line 69) and `ModuleOf(assembly)` (line 72), namespace derivation `RootNamespace(module, layer)` (line 75), and `OtherModuleNamespaces` (line 81), which returns the same-layer namespaces of every *other* module (the forbidden targets for a module-isolation rule, empty for framework layers and single-module repos).
- **Why it's built this way** - funneling every rule through one interface is what removed three drifting copies of the architecture-test suite; add a repo and you write one map, not a new rule set.
- **Where it's used** - held as the `protected abstract IArchitectureMap Map` on nearly every `*TestsBase` in this package and passed to every method of [`ArchitectureRules`](#architecturerules). [`ArchitectureMapBase`](#architecturemapbase) is the reusable partial implementation.

### ArchitectureMapBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:11` · Level 3 · class

- **What it is** - the reusable base implementation of [`IArchitectureMap`](#iarchitecturemap): a repo supplies only `RepoToken` and a `DefineLayers()` declaration, and every projection, namespace derivation, and module-isolation target computation is derived here (lines 3-10).
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`LayerRef`](#layerref), [`Layer`](#layer), `System.Lazy`, `System.IO` (for `FindRepoRoot`).
- **Concept introduced** - the *template-method* shape for a repo map: the base fixes the algorithm and the subclass fills two holes. It also centralizes every namespace/assembly string in one file, which the doc (lines 8-9) notes fixes Ubuntu CI case-sensitivity in one place.
- **Walkthrough** - the constructor wraps `DefineLayers()` in a `Lazy<IReadOnlyList<LayerRef>>` (lines 15-16) so the assembly list materializes once. `ModuleNames` (line 28) distinct-orders the non-empty module names. `OfLayer`/`ModuleDomain`/`ModuleApplication`/`ModuleShared`/`Infrastructure`/`Api` are one-line LINQ projections over `Layers` (lines 35-51). `RootNamespace` (line 63) branches on module: framework layers become `MMCA.Common.{Segment}`, module layers `{RepoToken}.{module}.{Segment}`. `OtherModuleNamespaces` (line 69) maps every other module through `RootNamespace`. The static `FindRepoRoot(solutionFileName)` (line 79) walks up from `AppContext.BaseDirectory` to the directory containing the named `.slnx`, so doc/config consistency tests can read committed files regardless of the runner's CWD (throwing if not found, lines 89-90). The `protected static Framework(...)` (line 94) and `protected Module(...)` (line 98) factory helpers build [`LayerRef`](#layerref)s, and the internal `Segment` (line 105) maps each [`Layer`](#layer) to its namespace token.
- **Why it's built this way** - a per-repo map stays a flat declaration of assemblies (the two abstracts), and everything derivable is derived, so the maps cannot drift in how they compute namespaces.
- **Where it's used** - each repo's concrete map (e.g. `CommonArchitectureMap`, `StoreArchitectureMap`) subclasses this; `FindRepoRoot` is called by every file-reading base ([`DataResidencyTestsBase`](#dataresidencytestsbase), [`FormsConventionTestsBase`](#formsconventiontestsbase), [`FrameworkVersionConsistencyTestsBase`](#frameworkversionconsistencytestsbase), [`LocalizedTextConventionTestsBase`](#localizedtextconventiontestsbase), [`StateManagementConventionTestsBase`](#statemanagementconventiontestsbase), [`UIArchitectureConventionTestsBase`](#uiarchitectureconventiontestsbase)).

### ArchitectureRules
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:3` · Level 3 · class

- **What it is** - the reusable rule library: one large `static partial class` (split across the `ArchitectureRules.*.cs` files) whose methods each assert one architectural invariant across every applicable assembly a map declares. A repo's test classes reduce to a sealed subclass of the matching `*TestsBase` supplying its own map.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`Layer`](#layer), [`ArchitectureAssert`](#architectureassert), [`RuleHelpers`](#rulehelpers), NetArchTest (`Types.InAssembly(...)`), and (for the specification rule) `System.Linq.Expressions` + [`CrossEntityNavigationFinder`](#crossentitynavigationfinder).
- **Concept introduced** - *the rule as a parameterized function.* Each method takes an `IArchitectureMap` and does its own loop, so the `*TestsBase` classes are thin `[Fact]` shells that delegate. The partial is organized by concern across the `ArchitectureRules.*.cs` files (Controllers, Entities, Events, Governance, Handlers, Immutability, Layers, Localization, LocalizedText, Modules, Naming, Purity, Slices, Specifications, Transport). [Rubric §3 - Clean Architecture], [Rubric §4 - DDD], [Rubric §7 - Microservices Readiness], and [Rubric §34 - Governance] all apply: this is where the codebase's structural decisions become executable assertions.
- **Walkthrough** - two representative shapes. The NetArchTest shape (`ControllersDoNotDependOnInfrastructure`, `ArchitectureRules.Controllers.cs:6`) loops the map's module API layers, computes the forbidden Infrastructure namespace via `map.RootNamespace(...)`, runs `Types.InAssembly(...).That().HaveNameEndingWith("Controller").ShouldNot().HaveDependencyOnAny(forbidden)`, and reports via `ArchitectureAssert.NoViolations(result, ...)` (lines 8-18). The layer-flow shape (`ArchitectureRules.Layers.cs`) exposes one method per forbidden edge (`DomainDoesNotDependOnApplication` line 12, `SharedDoesNotDependOnDomain` line 36, `UiDoesNotDependOnInfrastructure` line 60), all delegating to the private `LayerNotDependOnLayer` (line 64), which loops every assembly of the `from` layer and asserts it has no dependency on the `to` layer's namespace. The reflection shape (`ControllersAreSealed`, `ArchitectureRules.Controllers.cs:37`) enumerates `map.Api().ConcreteClasses()`, filters `IsController` non-sealed types, and asserts the string offender list is empty.
- **Why it's built this way** - the MMCA.Common CLAUDE.md records the intent: the rule bodies live *once* here, and each repo's `*.Architecture.Tests` project is a set of sealed subclasses supplying its map, so all three repos enforce identical rules (the compile-time `MMCA.Common.LayerEnforcement.targets` guards the same layer flow at build time as a second gate).
- **Where it's used** - every `*TestsBase` in this unit calls into it; the `[Fact]` methods are its public surface.
- **Caveats / not-in-source** - the full method roster spans fifteen `ArchitectureRules.*.cs` partials; only the entry file (`ArchitectureRules.Controllers.cs:3`) and representative methods are cited here.

### ConstructorDependencyCountTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:14` · Level 3 · class

- **What it is** - a single-responsibility-ceiling fitness function: it fails the build if any Application-layer `*Service` class has a constructor with more than the repo's accepted dependency count.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap) (via `Map.ModuleApplication()`), `[Fact]`, AwesomeAssertions, reflection over constructors.
- **Concept introduced** - quantifying the SRP smell. [Rubric §1 - SOLID] assesses single-responsibility discipline; a ballooning constructor-dependency list is the canonical smell, and this base turns a previously implicit judgement call into an enforced ceiling so the next service cannot silently grow past it (lines 3-13).
- **Walkthrough** - the subclass supplies `Map` (line 16) and the `MaxConstructorDependencies` high-water mark (line 22). `ApplicationServices_DoNotExceedConstructorDependencyCeiling` (line 25) scans `Map.ModuleApplication()` for concrete `*Service` classes (lines 27-31), asserts at least one was found (non-vacuity, lines 33-34), computes each service's max constructor parameter count (lines 39-44), and asserts none exceed the ceiling (lines 45-53).
- **Why it's built this way** - the ceiling is deliberately raised only with a conscious decision; repos without business modules (MMCA.Common itself) have nothing to scan and do not subclass this (lines 11-12). It overlaps the arity check in [`HandlerConventionTestsBase`](#handlerconventiontestsbase) but scopes specifically to service facades.
- **Where it's used** - subclassed in Store and ADC against their Application services.

### AggregateConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:8` · Level 4 · class

- **What it is** - the minimal DDD aggregate fitness base for repos with *no* business modules (MMCA.Common itself): it asserts the Domain layer exposes aggregate roots, each built through a static `Create(...)` factory returning `Result<T>` with no public constructor.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules), `[Fact]`.
- **Concept introduced** - the *thin delegating test base* pattern shared by most Level-4 types in this unit: a `protected abstract IArchitectureMap Map`, plus one `[Fact]` per rule that forwards to an [`ArchitectureRules`](#architecturerules) method. The factory-returning-[`Result`](group-01-result-error-handling.md#result) idiom on [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) is what these rules verify. [Rubric §4 - DDD] assesses aggregate discipline.
- **Walkthrough** - three `[Fact]`s: `Domain_ShouldExpose_AggregateRoots` (line 13), `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 16), `AggregateRoots_ShouldHave_NoPublicConstructors` (line 19), each a one-line delegate.
- **Why it's built this way** - module-bearing repos use the fuller [`EntityConventionTestsBase`](#entityconventiontestsbase) instead (lines 4-6); this base exists so a module-less repo still guards its aggregates.

### ConcurrencyConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:8` · Level 4 · class

- **What it is** - a one-rule delegating base asserting that every `*UpdateRequest` implements [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), so concurrent edits surface as 409 Conflict rather than silent last-write-wins.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape from [`AggregateConventionTestsBase`](#aggregateconventiontestsbase). [Rubric §8 - Data Architecture] assesses optimistic-concurrency handling; carrying a RowVersion on every update request is how that concern is enforced at the contract level.
- **Walkthrough** - one `[Fact]` `UpdateRequests_ShouldImplement_IConcurrencyAware` (line 13) delegating to `ArchitectureRules.UpdateRequestsAreConcurrencyAware(Map)`. The doc notes modules with no mutable aggregate are legitimately vacuous (lines 6-7).
- **Where it's used** - subclassed in Store and ADC.

### ControllerConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:7` · Level 4 · class

- **What it is** - the presentation-layer convention base: controllers are thin and sealed, never reach Infrastructure or EF Core directly, and inherit the framework [`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase) for consistent Result-to-HTTP mapping.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); adds a `protected virtual ControllersExemptFromApiControllerBase` list (line 12) for controllers that legitimately bypass the base (e.g. a payment webhook that owns its own response semantics). [Rubric §9 - API & Contract Design] assesses consistent controller shape.
- **Walkthrough** - four `[Fact]`s: `Controllers_ShouldNotDependOn_Infrastructure` (line 15), `Controllers_ShouldNotDependOn_EntityFrameworkCore` (line 18), `Controllers_ShouldBe_Sealed` (line 21), `Controllers_ShouldInherit_ApiControllerBase` (line 24, passing the exempt list). The underlying rules live in `ArchitectureRules.Controllers.cs`.
- **Where it's used** - subclassed per repo with business modules (Store, ADC).

### DataResidencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:14` · Level 4 · class

- **What it is** - a compliance-drift fitness function: the data-residency statement in a repo's `PRIVACY.md` must match the region where personal data is actually provisioned, and known-stale region claims must not reappear.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureMapBase.FindRepoRoot`](#architecturemapbase), `System.IO` (`File.ReadAllText`), AwesomeAssertions.
- **Concept introduced** - a *document-vs-infrastructure consistency* gate. [Rubric §30 - Compliance / Privacy / Data Governance] assesses whether privacy claims track reality; this base fails the build if either the deployed region or the privacy policy changes without the other, closing the gap where a policy once claimed a region the data never lived in (lines 3-13).
- **Walkthrough** - the subclass supplies `Map` (line 16), the optional `ForbiddenResidencyClaims` list (line 23), and implements `ExtractDeployedRegion(repoRoot)` (line 53) against its own source of truth (the doc cites ADC parsing `deploy.yml` and Store parsing `infra/DISASTER-RECOVERY.md`). The single `[Fact]` `PrivacyPolicy_DataStorageRegion_MatchesDeployedRegion` (line 26) locates the repo root via `FindRepoRoot($"{Map.RepoToken}.slnx")` (line 28), extracts the region, reads `PRIVACY.md`, and asserts the normalized policy contains the region and none of the forbidden claims (lines 34-44). `Normalize` (line 57) strips whitespace and upper-cases so "West US 2" matches the "westus2" token.
- **Where it's used** - subclassed in Store and ADC (module-less MMCA.Common has no deployed region).

### DependencyVersionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:15` · Level 4 · class

- **What it is** - a dependency-pin fitness function guarding two commercial-license traps at build time: MassTransit must stay below v9 and SixLabors.ImageSharp below v4, both parsed out of `Directory.Packages.props`.
- **Depends on** - [`ArchitectureRules`](#architecturerules) (`PinnedPackageMajorBelow`), `[Fact]`. (Note: no `Map` on this base; it reads the props file directly through the rule.)
- **Concept introduced** - enforcing a *policy pin as a test*. [Rubric §32 - Dependency & Supply-Chain] assesses whether risky upgrades are guarded; the doc explains both traps: MassTransit v9 fails the startup license check and crashes every broker-enabled host, and ImageSharp v4 fails the build without a license key, while CI never starts a broker so a blanket bump otherwise stays green (lines 3-13, 39-44).
- **Walkthrough** - `MassTransit_MustNotExceed_MajorVersion8` (line 25) loops `MassTransitPackageIds` (line 17, the three MassTransit package ids) and calls `PinnedPackageMajorBelow(packageId, exclusiveMajorCeiling: 9, ...)`. `ImageSharp_MustNotExceed_MajorVersion3` (line 48) does the same for `SixLabors.ImageSharp` with ceiling 4. Both id lists are `virtual` so a repo can override to an empty list when it does not pin the package.
- **Why it's built this way** - the doc is explicit (lines 8-13): consumer repos (ADC, Store) do NOT pin MassTransit (it flows transitively via `MMCA.Common.Infrastructure`), so they must not subclass this base with the default list, or the "must remain pinned" assertion would fail on a pin they do not declare. The pin is enforced only in MMCA.Common where MassTransit is actually pinned.
- **Where it's used** - subclassed only in MMCA.Common's `DependencyVersionTests`.

### DomainPurityTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:8` · Level 4 · class

- **What it is** - a framework-independence base: Domain and Shared stay free of infrastructure frameworks, and Application stays host-agnostic (no EF Core, no ASP.NET Core).
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); adds a `protected virtual ExtraForbiddenDomainDependencies` hook (line 12) so a repo bans its own frameworks (the doc cites Store banning "Stripe", ADC banning "RabbitMQ"). [Rubric §3 - Clean Architecture] and [Rubric §4 - DDD] assess the framework-free core.
- **Walkthrough** - four `[Fact]`s: `Domain_ShouldBe_FrameworkFree` (line 15), `Shared_ShouldBe_FrameworkFree` (line 18, both passing the extra-forbidden list), `Application_ShouldNotDependOn_EntityFrameworkCore` (line 21), `Application_ShouldNotDependOn_AspNetCore` (line 24).
- **Where it's used** - subclassed in all three repos.

### EntityConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:8` · Level 4 · class

- **What it is** - the fuller DDD entity/aggregate convention base (the module-bearing counterpart to [`AggregateConventionTestsBase`](#aggregateconventiontestsbase)): entities are sealed and live only in Domain, aggregate roots use a `Create(...)` factory returning `Result<T>` with no public constructor, and DTOs/requests stay out of Domain and Infrastructure.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); [Rubric §4 - DDD] and [Rubric §3 - Clean Architecture] apply.
- **Walkthrough** - six `[Fact]`s: `Domain_ShouldExpose_AggregateRoots` (line 13), `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 16), `AggregateRoots_ShouldHave_NoPublicConstructors` (line 19), `DomainEntities_ShouldBe_Sealed` (line 22), `DomainEntities_ShouldReside_InDomainLayer` (line 25), `DtosAndRequests_ShouldNotResideIn_DomainOrInfrastructure` (line 28).
- **Where it's used** - subclassed in Store and ADC.

### EventConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:8` · Level 4 · class

- **What it is** - an integration-event convention base (the doc cites ADR-010): every concrete integration event inherits [`BaseIntegrationEvent`](group-04-events-outbox.md#baseintegrationevent), declares an `int SchemaVersion`, and lives in a `*.IntegrationEvents` namespace in the Shared layer.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); [Rubric §6 - CQRS & Event-Driven] and [Rubric §9 - API & Contract Design] assess versioned, discoverable cross-service event contracts. Pairs with [`IntegrationEventContractTestsBase`](#integrationeventcontracttestsbase), which freezes the exact shape.
- **Walkthrough** - three `[Fact]`s: `IntegrationEvents_ShouldDeclare_SchemaVersion` (line 13), `IntegrationEvents_ShouldInherit_BaseIntegrationEvent` (line 16), `IntegrationEvents_ShouldResideIn_SharedIntegrationEventsNamespace` (line 19).
- **Where it's used** - subclassed in repos that publish integration events (Store, ADC).

### FormsConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:15` · Level 4 · class

- **What it is** - a UX-safety fitness function: every admin `*Create.razor` form under `Source/Modules` must keep its unsaved-changes guard, dirty tracking, and validated `MudForm`, so those protections cannot silently regress.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureMapBase.FindRepoRoot`](#architecturemapbase), `System.IO` file enumeration, AwesomeAssertions.
- **Concept introduced** - a *markup-scanning* fitness function (it reads `.razor` text, not assemblies). [Rubric §24 - Forms / Validation / UX Safety] assesses whether navigate-away data loss and missing validation are prevented; the base checks for six literal markers including `UnsavedChangesGuard`, `IsDirtyAccessor` (bound through the live accessor to pre-empt the one-render stale-`IsDirty` lag, a §19 concern), `_isDirty`, `<MudForm`, `Required="true"`, and `RequiredError` (lines 27-35).
- **Walkthrough** - the subclass supplies `Map` (line 17) and optionally a higher `MinimumCreateForms` count (line 24). `AdminCreateForms_KeepUnsavedChangesGuardAndValidation` (line 38) resolves the repo root, enumerates `*Create.razor` under `Source/Modules` excluding `obj`/`bin` (lines 41-48), asserts the discovered count meets the floor (non-vacuity, lines 50-51), and records a violation for any form missing a required marker (lines 54-64).
- **Why it's built this way** - self-service forms with no navigate-away step (e.g. a single-section Profile password/delete form) carry no guard by design and simply must not match the `*Create.razor` glob (lines 11-13).
- **Where it's used** - subclassed in repos with admin create forms (Store, ADC).

### FrameworkVersionConsistencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:13` · Level 4 · class

- **What it is** - an evolvability/drift fitness function that makes ADR-016 executable: all `MMCA.Common.*` packages in a consumer's `Directory.Packages.props` must be pinned to one version, so a partial sweep is caught at CI time.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureMapBase.FindRepoRoot`](#architecturemapbase), `System.Xml.Linq` (`XDocument`), AwesomeAssertions.
- **Concept introduced** - enforcing the *lockstep release* policy. [Rubric §16 - Maintainability] and [Rubric §32 - Dependency & Supply-Chain] assess coordinated versioning; the framework releases in lockstep with no phased rollout (ADR-016), and this gate fails if any `MMCA.Common.*` entry diverges (lines 3-12).
- **Walkthrough** - the subclass supplies `Map` (line 15) and optionally `MinimumCommonPackageCount` (line 22, default 13, the released package count per FACTS.md). `AllMmcaCommonPackages_ArePinnedToOneVersion` (line 25) loads `Directory.Packages.props`, selects every `PackageVersion` whose `Include` starts with `MMCA.Common.` (lines 30-41), asserts the count meets the floor (lines 43-44), asserts none has an empty version (lines 46-48), and asserts the distinct-version count is exactly one (lines 50-56).
- **Why it's built this way** - MMCA.Common itself does not subclass this (it declares no `MMCA.Common.*` pins; only consumers do, lines 10-11).
- **Where it's used** - subclassed in Store and ADC.

### HandlerConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:8` · Level 4 · class

- **What it is** - the CQRS handler convention base: handlers and validators live only in Application, handlers and services do not broker other handlers, and no `*Service` exceeds the god-class constructor-arity ceiling.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); adds a `MaxServiceConstructorParameters` override (line 12, default 8). [Rubric §6 - CQRS] and [Rubric §1 - SOLID] apply; the CQRS decorator pipeline itself is taught in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to).
- **Walkthrough** - six `[Fact]`s: `Handlers_ShouldResideIn_ApplicationLayer` (line 15), `Handlers_ShouldNotInject_OtherHandlers` (line 18), `ApplicationServices_ShouldNotInject_Handlers` (line 21), `ApplicationServices_ShouldNotExceed_ConstructorArity` (line 24, passing the max), `Validators_ShouldResideIn_ApplicationLayer` (line 27), `EventHandlers_ShouldResideIn_ApplicationLayer_AndBeSealed` (line 30).
- **Where it's used** - subclassed in all three repos.

### ImmutabilityTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:8` · Level 4 · class

- **What it is** - an immutability convention base: DTOs, command/query messages, domain events, integration events, and value objects expose no public mutable (non-`init`) setter; value objects are additionally sealed and confined to the Shared layer.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules) (which uses [`RuleHelpers.HasPublicMutableSetter`](#rulehelpers) under the hood).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); the `init`-only vs. mutable distinction is exactly what `HasPublicMutableSetter` detects. [Rubric §15 - Best Practices] and [Rubric §4 - DDD] assess immutable contracts and value objects.
- **Walkthrough** - five `[Fact]`s: `Dtos_ShouldBe_Immutable` (line 13), `CommandsAndQueries_ShouldBe_Immutable` (line 16), `DomainEvents_ShouldBe_Immutable` (line 19), `IntegrationEvents_ShouldBe_Immutable` (line 22), `ValueObjects_ShouldBe_ImmutableSealedAndInShared` (line 25).
- **Where it's used** - subclassed in all three repos.

### IntegrationEventContractTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:11` · Level 4 · class

- **What it is** - a frozen wire-contract guard: it rebuilds the live integration-event contract (one line per event, `FullName { Prop:Type, ... }`) and compares it to a committed snapshot the subclass supplies, so a renamed/removed/retyped property (or a new event shipped without its consumer) fails the build.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules.BuildIntegrationEventContract`](#architecturerules), AwesomeAssertions.
- **Concept introduced** - a *snapshot* fitness function. [Rubric §9 - API & Contract Design] and [Rubric §7 - Microservices Readiness] assess whether cross-service contracts stay stable; because a consumer in another service deserializes by shape, this gate makes any contract change a deliberate, coordinated commit.
- **Walkthrough** - the subclass supplies `Map` (line 13) and the committed `ExpectedContract` snapshot (line 16). `IntegrationEventContracts_ShouldMatch_TheFrozenSnapshot` (line 19) builds the actual contract via `ArchitectureRules.BuildIntegrationEventContract(Map)` and asserts `actual.Should().Equal(ExpectedContract, ...)` (lines 21-28), the message instructing the author to version the event and update `ExpectedContract` in the same commit when a change is intentional.
- **Where it's used** - subclassed in repos publishing integration events (Store, ADC). Complements [`EventConventionTestsBase`](#eventconventiontestsbase).

### LayerDependencyTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:7` · Level 4 · class

- **What it is** - the Clean Architecture layer-flow base: thirteen `[Fact]`s asserting that each layer references only layers below it (Domain not on Application/Infrastructure/API, Application not on Infrastructure/API, Shared on nothing above it, UI only on Shared).
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules) (`ArchitectureRules.Layers.cs`).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); this is the runtime half of the two-gate layer enforcement, the compile-time half being `MMCA.Common.LayerEnforcement.targets`. [Rubric §3 - Clean Architecture] is the whole point.
- **Walkthrough** - the `[Fact]`s map one-to-one to `ArchitectureRules.Layers.cs` methods: `Domain_ShouldNotDependOn_Application` (line 12) through `Ui_ShouldNotDependOn_Infrastructure` (line 48), each a one-line delegate. The UI trio encodes the documented exception that UI depends only on Shared for Blazor WASM compatibility.
- **Where it's used** - subclassed in all three repos.

### LocalizationResourceTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:10` · Level 4 · class

- **What it is** - an opt-in translation-coverage gate (ADR-027): a repo that ships localized `.resx` resources subclasses this and lists its required cultures; the build fails if any base `.resx` under `Source/` lacks a complete, non-empty sibling for a required culture.
- **Depends on** - [`ArchitectureRules.ResourceTranslationsAreComplete`](#architecturerules), `[Fact]`. (No `Map` on this base; it scans `Source/` directly through the rule.)
- **Concept introduced** - a *coverage* fitness function for i18n. [Rubric §27 - i18n] assesses translation completeness; this gate ensures a new English string can never ship without its translation (lines 3-9).
- **Walkthrough** - the subclass supplies `RequiredCultures` (line 13, e.g. `["es"]`) and optionally `MinimumBaseResources` (line 21, a non-vacuity floor, default 0). The single `[Fact]` `Translations_AreComplete_ForEveryRequiredCulture` (line 24) delegates to `ArchitectureRules.ResourceTranslationsAreComplete(RequiredCultures, MinimumBaseResources)`.
- **Why it's built this way** - single-locale repos need not subclass it (the rule is vacuous for an empty list). Pairs with [`LocalizedTextConventionTestsBase`](#localizedtextconventiontestsbase): this gate keeps the extracted resources translated, that gate keeps literals out of markup.
- **Where it's used** - subclassed in localized repos.

### LocalizedTextConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:13` · Level 4 · class

- **What it is** - a localized-text convention gate (ADR-027): user-visible literals must not be hard-coded in `.razor`/`.razor.cs` under `Source/` (snackbars, page titles, `<PageTitle>` markup, breadcrumb labels) but resolve through `IStringLocalizer` resources.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureMapBase.FindRepoRoot`](#architecturemapbase), [`ArchitectureRules.UserVisibleTextIsLocalized`](#architecturerules).
- **Concept introduced** - cross-references the markup-scanning gate idea from [`FormsConventionTestsBase`](#formsconventiontestsbase); [Rubric §27 - i18n] assesses that visible strings follow the selected language.
- **Walkthrough** - the subclass supplies `Map` (line 15) and optionally `MinimumScannedFiles` (line 21) and `AllowedFiles` (line 28, whole-file exemptions; the preferred exemption is a per-line `i18n: allow` comment). `UserVisibleText_IsLocalized` (line 31) resolves the repo root and delegates to `ArchitectureRules.UserVisibleTextIsLocalized(Source, AllowedFiles, MinimumScannedFiles)` (lines 33-37).
- **Where it's used** - subclassed in localized repos. Pairs with [`LocalizationResourceTestsBase`](#localizationresourcetestsbase).

### MicroserviceExtractionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:8` · Level 4 · class

- **What it is** - a transport-boundary base for the modular-monolith to microservices path: MassTransit, gRPC, and Protobuf must never leak into Domain, Application, or Shared, so a module behaves identically in-process or extracted and the split stays reversible.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); the extraction invariant (application/domain code talks to abstractions, transport choices live at the edges) is the ADR-006/007/008 story. [Rubric §7 - Microservices Readiness] assesses exactly this reversibility.
- **Walkthrough** - one `[Fact]` `CoreLayers_ShouldNotDependOn_Transport` (line 13) delegating to `ArchitectureRules.TransportDoesNotLeakIntoCoreLayers(Map)`.
- **Where it's used** - subclassed in all three repos.

### ModuleIsolationTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:8` · Level 4 · class

- **What it is** - a modular-monolith boundary base: a module must not reach another module's internal layers; cross-module communication goes only through the Shared (contract) layer. Vacuous for single-module or module-less repos.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules) (which uses `OtherModuleNamespaces` to compute forbidden targets).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); [Rubric §5 - Vertical Slice] and [Rubric §7 - Microservices Readiness] assess module autonomy. The [`IModule`](group-14-module-system-composition.md#imodule) system is taught in Group 14.
- **Walkthrough** - six `[Fact]`s covering each layer's isolation: `ModuleDomains_ShouldBe_Isolated` (line 13), `ModuleApplications_ShouldBe_Isolated` (line 16), `ModuleInfrastructures_ShouldBe_Isolated` (line 19), `ModuleApis_ShouldBe_Isolated` (line 22), plus `ModuleDomains_ShouldNotReach_OtherModuleInfrastructures` (line 25) and the Application equivalent (line 28).
- **Where it's used** - subclassed in multi-module repos (Store, ADC).

### NamingConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:8` · Level 4 · class

- **What it is** - a naming/sealing convention base across the CQRS + DDD building blocks: handlers, command/query messages, validators, DTOs, domain events, invariants, EF configurations, specifications, and repositories each follow their established suffix and sealing convention.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules) (which uses [`RuleHelpers.SimpleName`](#rulehelpers) to match suffixes on generic types).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); [Rubric §15 - Best Practices] and [Rubric §16 - Maintainability] assess consistent, discoverable naming.
- **Walkthrough** - ten `[Fact]`s: `Handlers_ShouldBeSealed_WithHandlerSuffix` (line 13), `Commands_ShouldHave_CommandOrRequestSuffix` (line 16), `Queries_ShouldHave_QuerySuffix` (line 19), `Validators_ShouldHave_ValidatorOrRulesSuffix` (line 22), `SharedDtos_ShouldHave_DtoOrLookupSuffix` (line 25), `DomainEvents_ShouldBeSealed_InDomainEventsNamespace` (line 28), `InvariantClasses_ShouldBe_Static` (line 31), `EfConfigurations_ShouldBeSealed_WithConfigurationSuffix` (line 34), `Specifications_ShouldBeSealed_WithSpecificationSuffix` (line 37), `Repositories_ShouldHave_RepositorySuffix` (line 40).
- **Where it's used** - subclassed in all three repos.

### PiiConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:7` · Level 4 · class

- **What it is** - a GDPR/CCPA right-to-erasure base (ADR-005): any domain entity that declares a [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute)-marked property must implement [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable), so it has an erasure path.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); the `[Pii]`/`IAnonymizable` soft-delete-vs-erasure model is taught in [Group 02](group-02-domain-building-blocks.md#piiattribute) (ADR-005). [Rubric §30 - Compliance / Privacy] and [Rubric §11 - Security] assess erasure discipline.
- **Walkthrough** - one `[Fact]` `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable` (line 12) delegating to `ArchitectureRules.EntitiesWithPiiImplementAnonymizable(Map)`.
- **Where it's used** - subclassed in repos with PII-bearing entities (Store, ADC).

### SharedLayerTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:7` · Level 4 · class

- **What it is** - a Shared (contract) layer base: a module's Shared is contracts-only, so it must not depend on its own internal layers, on another module's Shared, or on EF Core.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); [Rubric §3 - Clean Architecture] and [Rubric §5 - Vertical Slice] assess a clean contract boundary a would-be extracted consumer can reference safely.
- **Walkthrough** - three `[Fact]`s: `ModuleShared_ShouldNotDependOn_OwnInternalLayers` (line 12), `ModuleShared_ShouldBe_Isolated` (line 15), `ModuleShared_ShouldNotDependOn_EntityFrameworkCore` (line 18).
- **Where it's used** - subclassed in multi-module repos (Store, ADC).

### SliceCohesionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:10` · Level 4 · class

- **What it is** - a vertical-slice cohesion base: a use-case slice keeps its command/query, its handler, and its validator together in one namespace, so a feature is a cohesive unit rather than spread across horizontal `Handlers/`/`Validators/` folders.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules`](#architecturerules).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); [Rubric §5 - Vertical Slice] assesses feature cohesion. The doc notes MMCA.Common scopes to its Notifications slices while ADC/Store scope to their module Application layers (lines 7-9).
- **Walkthrough** - two `[Fact]`s: `Handlers_ShouldBeCoLocatedWith_TheirContracts` (line 15) and `Validators_ShouldBeCoLocatedWith_TheirContracts` (line 19).
- **Where it's used** - subclassed in all three repos.

### SpecificationConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:10` · Level 4 · class

- **What it is** - an opt-in base for the Specification pattern in polyglot / database-per-service repos: it guarantees no specification filters by navigating to another entity (which would not translate when that entity lives in a different physical source).
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities`](#architecturerules) (backed by [`CrossEntityNavigationFinder`](#crossentitynavigationfinder)).
- **Concept introduced** - cross-references the delegating-base shape ([`AggregateConventionTestsBase`](#aggregateconventiontestsbase)); the [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) pattern is taught in Group 03. [Rubric §8 - Data Architecture] assesses engine-portable query design.
- **Walkthrough** - one `[Fact]` `Specifications_ShouldNotNavigate_ToOtherEntities` (line 16) delegating to the rule. The doc notes single-engine repos need not subclass it (lines 4-8).
- **Where it's used** - subclassed only in polyglot-capable repos.

### StateManagementConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:17` · Level 4 · class

- **What it is** - a Blazor Server state-management gate: user/session state must live in per-circuit scoped services, never in mutable `static` members (which leak one user's state to another) or in singleton-registered stateful services.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureMapBase.FindRepoRoot`](#architecturemapbase), reflection over UI assemblies, and a `Source/` file scan; `System.Runtime.CompilerServices.CompilerGeneratedAttribute`.
- **Concept introduced** - a *reflection + source scan* combined gate. [Rubric §19 - State Management] assesses per-circuit state safety; Blazor Server shares one process across every circuit, so a static member is shared across every user (lines 5-16).
- **Walkthrough** - the subclass supplies `Map` (line 19, whose UI assemblies must be registered under `Layer.Ui`) and optionally `AllowedStaticMembers` (line 25). `UiAssemblies_CarryNoMutableStaticState` (line 28) reflects over `Map.OfLayer(Layer.Ui)`, asserting it is non-empty (line 32), then flags any mutable static field or settable static property that is not compiler-generated or exempted (lines 44-56). `UiProjects_RegisterStatefulServicesScoped` (line 66) scans `Source/` `.cs` files (skipping `obj`/`bin`/non-`.UI`/`Testing`) for a line that both `AddSingleton` and a `*StateService`/`*StateContainer` name, and records the file:line as an offender (lines 72-92).
- **Where it's used** - subclassed in repos with Blazor Server UI (Store, ADC).

### UIArchitectureConventionTestsBase
> MMCA.Common.Testing.Architecture · `MMCA.Common.Testing.Architecture` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:14` · Level 4 · class

- **What it is** - a UI-architecture convention gate holding the container/presentational split with two mechanical line-count caps: a `*.razor.cs` code-behind stays within `MaxCodeBehindLines`, and a `.razor` file's inline `@code` block stays within `MaxInlineCodeLines`.
- **Depends on** - [`IArchitectureMap`](#iarchitecturemap), [`ArchitectureMapBase.FindRepoRoot`](#architecturemapbase), `System.IO` file enumeration, AwesomeAssertions.
- **Concept introduced** - enforcing a design convention by *file metrics*. [Rubric §18 - UI Architecture] assesses the container/presentational discipline; a ballooning code-behind signals page logic that belongs in an injected UI service or an extracted sub-component (lines 3-13).
- **Walkthrough** - the subclass supplies `Map` (line 16); the caps `MaxCodeBehindLines` (line 22, default 400), `MaxInlineCodeLines` (line 29, default 120), `MinimumCodeBehindFiles` (line 35, non-vacuity floor), and `ExcludedPathFragments` (line 41) are overridable. `CodeBehinds_StayWithinTheLineCap` (line 44) enumerates `*.razor.cs`, asserts the floor, and flags files over the cap (lines 46-59). `RazorFiles_KeepInlineCodeBlocksSmall` (line 63) finds each `.razor` file's `@code` line and flags the tail block when it exceeds the inline cap (lines 65-86). `EnumerateSourceFiles` (line 89) drives both, excluding `obj`/`bin` and the excluded fragments.
- **Where it's used** - subclassed in repos with Blazor UI (Store, ADC).

### AccessibilityViolationException
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7` · Level 0 · sealed class

- **What it is**: the dedicated exception type the E2E accessibility gate throws when an axe-core scan finds one or more WCAG violations on the page under test (`AccessibilityViolationException.cs:7`).
- **Depends on**: BCL `System.Exception` only. First-party: it is the failure currency of [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync`, which constructs and throws it.
- **Concept introduced, a typed failure for the a11y gate.** `[Rubric §21, Accessibility]` assesses WCAG conformance of the rendered UI; giving the accessibility gate its own exception type means a violation reads distinctly from an ordinary assertion failure (a consumer can `catch (AccessibilityViolationException)` specifically, and a CI log shows *what kind* of gate failed at a glance). `[Rubric §28, Front-End Testing & Quality]` is the harness side of the same story.
- **Walkthrough**: a `sealed` exception with the three standard constructors the BCL exception-design guideline (CA1032) wants: parameterless (`:10`), message-only (`:15`), and message-plus-inner (`:21`). In practice only the message constructor is used: [PageExtensions](#pageextensions) builds a multi-line, per-violation summary and passes it to `new AccessibilityViolationException(...)` (`PageExtensions.cs:284`).
- **Why it's built this way**: the rich message lives at the call site (the scanner has the violation data); the exception stays a thin, well-formed type so the *category* of failure is unambiguous.
- **Where it's used**: thrown by [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync`, which [E2ETestBase](#e2etestbase)`.ScanAsync`/`.ScanGridAsync`, the workflow bases ([UserLoginTestsBase](#userlogintestsbase), [UserRegistrationTestsBase](#userregistrationtestsbase), [ProfileManagementTestsBase](#profilemanagementtestsbase)), and every consumer E2E a11y test surface.

### AdminCredentials
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:66` · Level 0 · static class

- **What it is**: a static nested class inside [E2ETestConfiguration](#e2etestconfiguration) that supplies the admin login (email + password) the E2E suite uses, with a settable default that an environment variable overrides (`E2ETestConfiguration.cs:66`).
- **Depends on**: BCL `Environment`; it is a member of [E2ETestConfiguration](#e2etestconfiguration).
- **Concept introduced, environment-variable-over-default test configuration.** The pattern (which [E2ETestConfiguration](#e2etestconfiguration) repeats for every knob): each value has a **settable `Default*` property** a downstream app sets once via a `[ModuleInitializer]` to provide app-specific seed data, and a **read-only getter** that reads an `E2E_*` environment variable first, falling back to the default. The environment variable always wins, so CI (or a developer) can re-point credentials without touching code, while the default keeps a local run zero-config. `[Rubric §14, Testability & Test Strategy]` (the gate is parameterized, not hard-wired); `[Rubric §11, Security]` (real credentials arrive via env injection rather than being committed, the defaults here are dev-only seed accounts).
- **Walkthrough**: `DefaultEmail` (`"admin@localhost"`, `:68`) and `DefaultPassword` (`"Admin123!"`, `:69`) are the settable defaults; `Email` (`:71`) reads `E2E_ADMIN_EMAIL` then falls back, `Password` (`:74`) reads `E2E_ADMIN_PASSWORD` then falls back.
- **Why it's built this way**: shipping a stable credential surface in the package lets the shared [E2ETestBase](#e2etestbase)`.LoginAsAdminAsync` reference `AdminCredentials.Email`/`.Password` while each consumer seeds its own admin account and CI supplies secrets.
- **Where it's used**: [E2ETestBase](#e2etestbase)`.LoginAsAdminAsync` (`E2ETestBase.cs:82`).

### AxeOptions
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9` · Level 0 · static class

- **What it is**: a static holder for the two axe-core run-options objects every E2E accessibility scan in the framework and its consumers shares: the strict `Wcag21Aa` target and a single-rule relaxation, `Wcag21AaExceptMudPagerCombobox`, for grid pages (`AxeOptions.cs:9`).
- **Depends on**: NuGet `Deque.AxeCore.Commons` (`AxeRunOptions`, `RunOnlyOptions`, `RuleOptions`), the axe-core binding introduced in the [primer's testing stack](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0). First-party: consumed by [PageExtensions](#pageextensions) and [E2ETestBase](#e2etestbase)`.ScanAsync`/`.ScanGridAsync`.
- **Concept introduced, the documented a11y target as one source of truth.** `[Rubric §21, Accessibility]` assesses *which* conformance bar is enforced; `Wcag21Aa` scopes the scan to the axe tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` (`:22`), that is WCAG 2.0 and 2.1 at levels A and AA, and deliberately leaves axe's advisory "best-practice" rules out of scope (`:11-16`) so the gate fails only on real WCAG 2.1 AA conformance violations, not on style advice. `[Rubric §28, Front-End Testing & Quality]`, `[Rubric §22, Responsive & Cross-Browser/Device]`.
- **Walkthrough**: two get-only properties.
  - `Wcag21Aa` (`:17`) initialized to an `AxeRunOptions` whose `RunOnly` is `Type = "tag"` with those four tag values (`:19-23`).
  - `Wcag21AaExceptMudPagerCombobox` (`:35`) is the same four-tag target with the single `aria-input-field-name` rule disabled (`:42-45`). The doc comment (`:26-33`) records exactly why: MudBlazor 9.6.0 mirrored combobox semantics onto the `MudSelect` presenter, so the pager's own "rows per page" select is now flagged for a missing accessible name, yet `MudTablePager` exposes no `Label`/`aria-label` parameter to fix it from app markup. It is accepted as an upstream limitation, so this option is used **only** on a page whose sole combobox is a pager; every other WCAG 2.1 AA rule still runs.
- **Why it's built this way**: defining the target once in the shipped package guarantees the framework's own gallery scans, the Identity workflow bases, and every downstream consumer scan all assert the *same* documented surface; the best-practice exclusion and the one narrowly-scoped pager exception are both stated scope decisions rather than blanket suppressions.
- **Where it's used**: `Wcag21Aa` is passed to [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync` by [E2ETestBase](#e2etestbase)`.ScanAsync` (`E2ETestBase.cs:286`) and directly by the a11y `[Fact]`s in [UserLoginTestsBase](#userlogintestsbase), [UserRegistrationTestsBase](#userregistrationtestsbase), and [ProfileManagementTestsBase](#profilemanagementtestsbase); `Wcag21AaExceptMudPagerCombobox` is used by [E2ETestBase](#e2etestbase)`.ScanGridAsync` (`E2ETestBase.cs:278`).

### E2ETestConfiguration
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8` · Level 0 · static class

- **What it is**: the central, environment-variable-driven configuration surface for the entire E2E suite: base URL, headless flag, the timeout family, slow-motion, browser engine, trace path, and the nested credential classes (`E2ETestConfiguration.cs:8`).
- **Depends on**: BCL `Environment` and `float.TryParse`; it owns the nested [AdminCredentials](#admincredentials) and [UserCredentials](#usercredentials). Consumed by [PlaywrightFixture](#playwrightfixture), [E2ETestBase](#e2etestbase), and [PageExtensions](#pageextensions).
- **Concept introduced, every E2E knob as one typed surface.** This is the type [AdminCredentials](#admincredentials) specializes: each property reads an `E2E_*` variable, falling back to a default, so the fixtures and base read a typed configuration object rather than raw environment strings scattered through the tests. `DefaultBaseUrl` is even settable (`:10`) so a consumer's `[ModuleInitializer]` can point the suite at its own host. `[Rubric §14, Testability & Test Strategy]`, `[Rubric §17, DevOps & Deployment]` (these are the CI dials), `[Rubric §22, Responsive & Cross-Browser/Device]` (the browser dial).
- **Walkthrough** (in teaching order):
  - `DefaultBaseUrl` (settable, `"https://localhost:7108"`, `:10`) and `BaseUrl` (`E2E_BASE_URL` then default, `:12-13`).
  - `Headless` (`:15-16`): defaults to headless **unless** `E2E_HEADLESS` is the literal string `"false"`, the inverted check means any other value (or none) keeps the browser headless.
  - `DefaultTimeout` (`:18-19`): `E2E_TIMEOUT` parsed as a `float`, else `30_000` ms, the general action timeout.
  - `AuthTimeout` (`:27-28`): the post-auth wait is the slowest E2E step (a full auth round-trip plus the `forceLoad` reload plus re-render), so a contended CI runner can spike past `DefaultTimeout`; this knob is tunable independently via `E2E_AUTH_TIMEOUT` and otherwise inherits `DefaultTimeout`.
  - `AuthGraceTimeout` (`:38-39`, default `15_000`): an extra grace window the post-auth wait gives the success signal (the logout button) to appear *after* a transient error alert flashed during the success-path `forceLoad`, the de-flake for the register/login success-detection race; tunable via `E2E_AUTH_GRACE`.
  - `SlowMo` (`:45-46`): per-action delay in ms (`E2E_SLOWMO`), default `0`, for watching a run visually.
  - `Browser` (`:53-54`): `E2E_BROWSER` selects `chromium` (default), `firefox`, or `webkit`; unknown values fall back to Chromium.
  - `TracePath` (`:63-64`): when `E2E_TRACE` names a path, a full-speed Playwright trace (network, DOM snapshots, console) is captured; else `null`.
- **Why it's built this way**: concentrating every dial in one typed surface keeps the fixtures and base honest (they consume config, not strings), and the settable `Default*` properties let a consumer customize without environment variables while the variables always override (the CI-secret and per-engine-matrix path).
- **Where it's used**: [PlaywrightFixture](#playwrightfixture) (engine, headless, slow-mo), [E2ETestBase](#e2etestbase) (base URL, the timeout family, trace path, credentials), and [PageExtensions](#pageextensions).

### LoginPage
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6` · Level 0 · sealed class

- **What it is**: a Playwright **Page Object** wrapping the shared UI's `/login` page, exposing its fields, buttons, and links as named locators plus a couple of navigation/login helpers (`LoginPage.cs:6`).
- **Depends on**: NuGet `Microsoft.Playwright` (`IPage`, `ILocator`, `AriaRole`); [PageExtensions](#pageextensions) (`GotoAndWaitForBlazorAsync`, `FillAndVerifyAsync`). The page it drives is the shipped Login page in the [common UI framework](group-15-common-ui-framework.md).
- **Concept introduced, the Page Object Model.** A Page Object encapsulates the locators and interactions for one screen behind intention-revealing members, so when the markup changes only the page object updates, never the dozens of tests that use it. The selectors here are **accessibility-first**: `GetByLabel("Email")` (`:12`) and `GetByRole(AriaRole.Button, Name = "Sign in to your account")` (`:14`) match the page by the same accessible names a screen-reader user perceives, not by brittle CSS paths. That is the same philosophy as the bUnit interaction helpers and [PageExtensions](#pageextensions); `[Rubric §28, Front-End Testing & Quality]` and `[Rubric §21, Accessibility]` (selecting by role/label both reads well and pressures the markup to expose real accessible names), `[Rubric §25, Navigation, Routing & Information Architecture]`.
- **Walkthrough**: the constructor captures the `IPage` (`:10`); `EmailField`/`PasswordField`/`LoginButton`/`ErrorAlert` are computed locator properties (`:12-15`); `CreateAccountLink` is matched as a **link**, not a button, because "Create Account" is a MudButton with an `Href` that renders as an `<a>` (`:17-18`). `GotoAsync` navigates to `/login` and waits for Blazor interactivity (`:20-21`); `LoginAsync` fills both fields through the shared re-hydration-safe helper then clicks (`:23-28`); the private `FillFieldAsync` delegates to [PageExtensions](#pageextensions)`.FillAndVerifyAsync` (`:31-32`).
- **Why it's built this way**: shipping the page object in the package means every consumer's login E2E reuses one vetted selector set, and routing fills through the single `FillAndVerifyAsync` keeps the InteractiveAuto hydration guard in one place.
- **Where it's used**: [UserLoginTestsBase](#userlogintestsbase) (invalid-password, create-account-link, and a11y facts) and the navigation paths of consumer login tests.

### ProfilePage
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:6` · Level 0 · sealed class

- **What it is**: the Page Object for the authenticated `/profile` page, grouping its three editable sections (name, address, password) as named locators (`ProfilePage.cs:6`).
- **Depends on**: `Microsoft.Playwright`; [PageExtensions](#pageextensions) (`BlazorNavigateAsync`). Same Page Object Model shape introduced by [LoginPage](#loginpage).
- **Concept reinforced, client-side navigation for an authenticated page.** The one structural thing to learn here is the navigation choice: `GotoAsync` calls [PageExtensions](#pageextensions)`.BlazorNavigateAsync("/profile")` (`:34-35`), **not** the full-load `GotoAndWaitForBlazorAsync` that [LoginPage](#loginpage)/[RegisterPage](#registerpage) use. `/profile` is auth-protected, and a full server-side prerender request does not carry the JWT held in browser storage, so a hard navigation would render the unauthenticated variant; the client-side router navigation preserves the logged-in session. `[Rubric §28, Front-End Testing & Quality]`, `[Rubric §24, Forms, Validation & UX Safety]` (this is the form-heavy page).
- **Walkthrough**: constructor captures `IPage` (`:10`); the **Name** section is `FirstNameField`/`LastNameField`/`SaveNameButton` (`:13-15`); the **Address** section is six fields plus `SaveAddressButton` (`:18-24`); the **Password** section is `CurrentPasswordField`/`NewPasswordField`/`ConfirmNewPasswordField`/`ChangePasswordButton` (`:27-30`), where `NewPasswordField` uses `GetByLabel("New Password", Exact = true)` (`:28`) to disambiguate it from "Confirm New Password". `ErrorAlert` is matched by the ARIA `Alert` role (`:32`).
- **Why it's built this way**: bundling the three sections in one page object lets [ProfileManagementTestsBase](#profilemanagementtestsbase)'s many facts read cleanly, and the deliberate `BlazorNavigateAsync` keeps the authenticated session intact across navigations.
- **Where it's used**: instantiated throughout [ProfileManagementTestsBase](#profilemanagementtestsbase).

### RegisterPage
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.PageObjects` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:6` · Level 0 · sealed class

- **What it is**: the Page Object for the `/register` page, exposing the registration fields (including the optional address expansion panel) and a `RegisterAsync` helper (`RegisterPage.cs:6`).
- **Depends on**: `Microsoft.Playwright`; [PageExtensions](#pageextensions) (`GotoAndWaitForBlazorAsync`, `FillAndVerifyAsync`). Same shape as [LoginPage](#loginpage); see it for the Page Object Model concept.
- **Concept reinforced**: identical accessibility-first selector and shared-fill discipline as [LoginPage](#loginpage). `[Rubric §28]`, `[Rubric §24, Forms, Validation & UX Safety]` (this page carries the `[Compare]` password-match validation the registration facts assert).
- **Walkthrough**: required fields `FirstNameField`/`LastNameField`/`EmailField`/`PasswordField`/`ConfirmPasswordField` (`:12-16`), where `PasswordField` uses `GetByLabel("Password", Exact = true)` (`:15`) to avoid matching "Confirm Password"; `RegisterButton` (`:17`); `ErrorAlert` (`:18`); the `AlreadyHaveAccountLink` "Sign In" link (`:21`); and the optional `AddressPanel` plus its five address fields (`:24-29`). `GotoAsync` does a full-load navigate-and-wait (`:31-32`); `RegisterAsync` fills all five required fields through `FillAndVerifyAsync` then clicks (`:34-42`).
- **Why it's built this way**: the same single-source selector and re-hydration-safe fill discipline as the other page objects, shipped so consumer registration E2E inherits it.
- **Where it's used**: [UserRegistrationTestsBase](#userregistrationtestsbase) (all four facts) and [UserLoginTestsBase](#userlogintestsbase)'s create-account navigation.

### UserCredentials
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:78` · Level 0 · static class

- **What it is**: the non-admin sibling of [AdminCredentials](#admincredentials), a static nested class in [E2ETestConfiguration](#e2etestconfiguration) supplying a regular user's login (`E2ETestConfiguration.cs:78`).
- **Depends on**: BCL `Environment`; member of [E2ETestConfiguration](#e2etestconfiguration).
- **Concept reinforced**: the same environment-variable-over-default shape [AdminCredentials](#admincredentials) introduced; it differs only in the defaults and the variable names. `[Rubric §14, Testability & Test Strategy]`.
- **Walkthrough**: `DefaultEmail` (`"user@localhost"`, `:80`), `DefaultPassword` (`"User123!"`, `:81`); `Email` reads `E2E_CUSTOMER_EMAIL` then default (`:83-84`), `Password` reads `E2E_CUSTOMER_PASSWORD` then default (`:86-87`). (Note the getter variables use the `CUSTOMER` prefix while the type is named `UserCredentials`, a carryover from the Store consumer, source-accurate as written.)
- **Why it's built this way**: gives [E2ETestBase](#e2etestbase)`.LoginAsUserAsync` a stable non-admin credential surface that each consumer seeds and CI overrides.
- **Where it's used**: [E2ETestBase](#e2etestbase)`.LoginAsUserAsync` (`E2ETestBase.cs:85`).

### WebVitalsSample
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:73` · Level 0 · sealed record

- **What it is**: the immutable value object holding one page's measured Core Web Vitals: LCP, CLS, FCP, TTFB, and a single-interaction INP latency sample (`WebVitalsCollector.cs:73`).
- **Depends on**: BCL `System.Text.Json.Serialization` (`JsonPropertyName`) only; it is the return type of [WebVitalsCollector](#webvitalscollector)`.CollectAsync` and the payload carried by [WebVitalsArtifact](#webvitalsartifact).
- **Concept introduced, the measured-vitals DTO.** `[Rubric §12, Performance & Scalability]` assesses whether the system measures its own performance; this record is the typed shape those numbers deserialize into off the live browser. Each property carries a lowercase `[JsonPropertyName]` (`lcp`, `cls`, `fcp`, `ttfb`, `inp`) so it round-trips cleanly with the JSON the browser accumulates in `window.__vitals`. The units are documented on the type (`:72`): milliseconds, except the unitless Cumulative Layout Shift. `[Rubric §23, Front-End Performance & Rendering]`.
- **Walkthrough**: five `double` `init`-only properties, `Lcp` (`:75`), `Cls` (`:77`), `Fcp` (`:79`), `Ttfb` (`:81`), and `Inp` (`:83`), each mapped to its short JSON key. As a `record` it is structurally-equal and immutable by construction (the value-object convention from [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Why it's built this way**: a `record` with `[JsonPropertyName]`s is the minimum needed to deserialize the browser sample into a strongly-typed object a consumer's budget assertion can read (`sample.Lcp < budget`), and its immutability means a captured measurement cannot be mutated after the fact.
- **Where it's used**: produced by [WebVitalsCollector](#webvitalscollector)`.CollectAsync` and wrapped by [WebVitalsArtifact](#webvitalsartifact); consumers assert their own budgets against it.

### PageExtensions
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:14` · Level 1 · static class

- **What it is**: the extension-method toolbox over Playwright's `IPage`/`ILocator` that papers over the Blazor InteractiveAuto prerender-then-hydrate race so E2E tests interact with a genuinely interactive page, plus the axe-scan entry point (`PageExtensions.cs:14`).
- **Depends on**: `Microsoft.Playwright` (`IPage`, `ILocator`, `Assertions`, `LoadState`, `PlaywrightException`), `Deque.AxeCore.Commons`/`Deque.AxeCore.Playwright` (`AxeRunOptions`, `RunAxe`), BCL `System.Text.RegularExpressions` (`Regex`, for the URL-match helper). First-party: it throws [AccessibilityViolationException](#accessibilityviolationexception); its callers pass [AxeOptions](#axeoptions)`.Wcag21Aa`.
- **Concept introduced, the Blazor InteractiveAuto hydration race (the central E2E problem).** The app renders with **InteractiveAuto plus prerendering**: a page first arrives as static HTML before the WebAssembly runtime (or the Server SignalR circuit) wires up the component's `@onclick`/`@oninput` handlers. A click or fill that lands before hydration is *silently dropped*, the canonical source of flaky Blazor E2E. Every helper here exists to wait for true interactivity before acting, or to retry until an action sticks. Understanding this one race explains the whole E2E layer. `[Rubric §28, Front-End Testing & Quality]`, `[Rubric §24, Forms, Validation & UX Safety]`, `[Rubric §23, Front-End Performance & Rendering]` (the helpers are timed against the render pipeline, not fixed sleeps).
- **Walkthrough** (in teaching order, the later helpers build on the first):
  - `WaitForBlazorAsync` (`:20`): the foundation. It waits for `window.Blazor?._internal` to be truthy (`:25-27`, set after the CLR or circuit is ready, checked loosely because the inner properties vary across .NET versions), then awaits two `requestAnimationFrame`s plus a `500` ms settle so the render pipeline flushes and handlers attach (`:32-33`).
  - `GotoAndWaitForBlazorAsync` (`:40`): `GotoAsync` then `WaitForLoadStateAsync(Load)` then `WaitForBlazorAsync`. It waits on `Load`, **not** `NetworkIdle`, because InteractiveAuto keeps a persistent SignalR WebSocket open so `NetworkIdle` never fires (`:43-45`).
  - `BlazorNavigateAsync` (`:55`): client-side router navigation (`Blazor.navigateTo`) for auth-protected pages when already logged in, avoiding the server prerender that lacks the stored JWT. It tolerates the JS-context-destroyed race from a `forceLoad` (`try`/`catch (PlaywrightException)`, `:59-67`), polls `window.location.pathname` instead of `WaitForURLAsync` (whose default `WaitUntil=Load` hangs on a same-document navigation, `:73-75`), and re-asserts interactivity with a guarded retry (`:80-87`).
  - `GotoProtectedAsync` (`:97`): the "open an `[Authorize]` page while logged in" helper. SSR cannot read the JWT from browser storage, so a full page load to a protected page bounces to `/login`; this first ensures the Blazor runtime is available (loading a public page if it is not, `:111-114`), then re-routes via `"/"` so navigating to the target always triggers a fresh component lifecycle (`:117-124`), then client-side-navigates via `BlazorNavigateAsync(path)` (`:127`). This is the path [AuthorizationTestsBase](#authorizationtestsbase) uses to reach an authenticated page.
  - `WaitForPageAndBlazorAsync` (`:134`): a full-load wait plus render-flush after a link/button triggers a full-page navigation (`:138-141`).
  - `FillAndVerifyAsync` (`:154`): the single shared fill helper. It `FillAsync`es the field then uses Playwright's auto-waiting `ToHaveValueAsync` to poll until the value sticks; if re-hydration wiped the pre-render value, it `ClearAsync`es and re-types **character by character** via `PressSequentiallyAsync` (individual key events the Blazor event system reliably handles after enhanced navigation) and re-asserts (`:159-171`). It replaces the duplicated fixed-delay retry loops once present in [E2ETestBase](#e2etestbase), [LoginPage](#loginpage), and [RegisterPage](#registerpage).
  - `ClickAndVerifyAsync` (`:187`): the submit-side counterpart. After `WaitForBlazorAsync`, it clicks and waits a slice of the timeout for the expected visible effect, re-asserting interactivity and re-clicking on miss, up to three attempts (`:198-217`); a genuinely applied click surfaces its effect within one slice, so a successful action is never re-issued (no double submit), only a no-op click is retried.
  - `ClickAndWaitForUrlAsync` (`:230`): the navigation-side counterpart, for an in-cell grid-row link that navigates. List pages often have no `RowClick` handler (every cell wraps its content in a `MudLink Href`), so clicking the row's center lands on cell padding and silently does nothing; this clicks the link, then verifies the URL actually matches `urlPattern` (a `Regex`), re-clicking up to three times before a final attempt, because a link click can still race a grid re-render (`:235-252`).
  - `AssertNoAccessibilityViolationsAsync` (`:261`): runs `RunAxe` (optionally with the passed [AxeOptions](#axeoptions), `:265-267`), returns if there are zero violations (`:269`), else builds a per-violation summary (impact, rule id, help text, node count, and each node's compacted markup) and throws [AccessibilityViolationException](#accessibilityviolationexception) (`:274-285`). The private `CompactHtml` (`:290`) collapses a violating node's markup to a single trimmed line capped at 220 chars (`:298`) so the failure points at the exact offending element rather than dumping multi-line HTML.
- **Why it's built this way**: every flaky-E2E failure mode of a prerendered Blazor app (dropped clicks, wiped fills, hanging same-document navigation, swallowed grid-link navigation, racy axe scans) is solved once here and shipped, so consumer tests inherit the fix instead of each reinventing racy `Task.Delay` sleeps.
- **Where it's used**: throughout [E2ETestBase](#e2etestbase), the page objects ([LoginPage](#loginpage), [ProfilePage](#profilepage), [RegisterPage](#registerpage)), [AuthorizationTestsBase](#authorizationtestsbase) (`GotoProtectedAsync`), and consumer E2E tests.

### PlaywrightFixture
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6` · Level 1 · sealed class

- **What it is**: the xUnit fixture that creates the Playwright driver and launches **one** browser, shared across an entire test collection so the expensive launch happens once (`PlaywrightFixture.cs:6`).
- **Depends on**: `Microsoft.Playwright` (`IPlaywright`, `IBrowser`, `BrowserTypeLaunchOptions`), `Xunit` (`IAsyncLifetime`); reads [E2ETestConfiguration](#e2etestconfiguration).
- **Concept introduced, the shared expensive fixture (xUnit async lifecycle).** Launching a browser process is slow, so it should happen once, not per test. `IAsyncLifetime.InitializeAsync`/`DisposeAsync` run once per fixture instance; bound to a collection (by [E2ETestCollection](#e2etestcollection)) that means once for the whole collection. `[Rubric §14, Testability & Test Strategy]`. `[Rubric §22, Responsive & Cross-Browser/Device]`: the engine is selected from [E2ETestConfiguration](#e2etestconfiguration)`.Browser` so CI can run the identical suite against each engine. `[Rubric §32, Dependency & Supply-Chain]` (Playwright is the pinned browser-automation dependency from the [primer stack](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0)).
- **Walkthrough**: `Playwright` and `Browser` are properties with private setters, `null!`-initialized to satisfy non-nullable analysis until `InitializeAsync` populates them (`:8-9`). `InitializeAsync` (`:11`) calls `Playwright.CreateAsync` (`:13`), selects the engine with a `switch` over the uppercased `Browser` value (`FIREFOX` to Firefox, `WEBKIT` to WebKit, anything else to Chromium, `:17-22`), and `LaunchAsync`es it with `Headless` and `SlowMo` from config (`:24-28`). `DisposeAsync` (`:31`) suppresses finalization, disposes the browser, then disposes the driver (`:33-36`).
- **Why it's built this way**: one browser per collection keeps the suite fast, and resolving the engine from configuration (rather than code) makes the cross-browser matrix a CI dial, not a rebuild.
- **Where it's used**: bound to the "E2E" collection by [E2ETestCollection](#e2etestcollection); injected into [E2ETestBase](#e2etestbase) and, through it, every workflow base and consumer E2E test.

### WebVitalsArtifact
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:87` · Level 1 · sealed record

- **What it is**: the envelope record serialized to the `web-vitals-{label}.json` CI artifact, pairing a scan label and the scanned page path with the measured [WebVitalsSample](#webvitalssample) (`WebVitalsCollector.cs:87`).
- **Depends on**: first-party [WebVitalsSample](#webvitalssample); BCL only otherwise. It is written by [WebVitalsCollector](#webvitalscollector)`.WriteArtifactAsync`.
- **Concept reinforced, the citable performance artifact.** `[Rubric §13, Observability & Operability]` assesses whether a system's evidence is durable and inspectable; wrapping the raw [WebVitalsSample](#webvitalssample) with its `Label` and `Path` turns an in-memory measurement into a self-describing JSON file a reviewer (or a later regression check) can open and attribute to a specific page. `[Rubric §12, Performance & Scalability]`, `[Rubric §17, DevOps & Deployment]` (it is written into the CI-uploaded `artifacts/` directory).
- **Walkthrough**: a positional record `WebVitalsArtifact(string Label, string Path, WebVitalsSample Vitals)` (`:87`), no body. The doc comment (`:86`) names its destination file.
- **Why it's built this way**: a thin envelope keeps the on-disk artifact human-readable and traceable to *which* page produced *which* numbers, without the collector having to hand-assemble JSON.
- **Where it's used**: constructed and serialized by [WebVitalsCollector](#webvitalscollector)`.WriteArtifactAsync` (`WebVitalsCollector.cs:66`).

### E2ETestCollection
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:40` · Level 2 · sealed class

- **What it is**: the xUnit collection-definition marker that binds [PlaywrightFixture](#playwrightfixture) to a named collection, so every test class in it shares the one browser (`PlaywrightFixture.cs:40`).
- **Depends on**: `Xunit` (`CollectionDefinitionAttribute`, `ICollectionFixture<T>`); first-party [PlaywrightFixture](#playwrightfixture).
- **Concept introduced, the xUnit collection definition.** A class decorated `[CollectionDefinition(Name)]` that implements `ICollectionFixture<TFixture>` declares a named test collection; any test class marked `[Collection(Name)]` then shares a single `TFixture` instance with the rest of the collection. The `const string Name` is the shared key both ends reference. `[Rubric §14, Testability & Test Strategy]`.
- **Walkthrough**: `[CollectionDefinition(Name)] sealed class E2ETestCollection : ICollectionFixture<PlaywrightFixture>` (`:39-40`) with `public const string Name = "E2E"` (`:42`). The class has no body beyond the constant; its only job is to carry the two attributes/interfaces that wire the fixture to the collection.
- **Why it's built this way**: exposing the collection name as a `const` (rather than a literal repeated in each `[Collection("E2E")]`) means the definition and its consumers cannot drift apart.
- **Where it's used**: referenced by [E2ETestBase](#e2etestbase)'s `[Collection(E2ETestCollection.Name)]` attribute (`E2ETestBase.cs:9`), which all six workflow bases and consumer tests inherit.

### WebVitalsCollector
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:17` · Level 2 · static class

- **What it is**: the client-side performance-measurement helper that installs browser `PerformanceObserver`s before first paint, reads back the accumulated Core Web Vitals off a live page, and writes them as a citable JSON artifact (`WebVitalsCollector.cs:17`).
- **Depends on**: `Microsoft.Playwright` (`IPage`, `AddInitScriptAsync`, `EvaluateAsync`), BCL `System.Text.Json`, `System.IO`, `Environment`; first-party [WebVitalsSample](#webvitalssample) (its read model) and [WebVitalsArtifact](#webvitalsartifact) (its on-disk envelope).
- **Concept introduced, in-browser Core Web Vitals as measurement infrastructure.** `[Rubric §12, Performance & Scalability]` (the doc comment names this rubric explicitly, `:11`) assesses whether performance is measured, not assumed; this class measures the four Core Web Vitals (LCP, CLS, FCP, TTFB) plus a single-interaction INP sample directly from the browser's Navigation Timing and `PerformanceObserver` APIs, with **no third-party JS and no network egress** (`:7-16`). Two properties matter for reading the numbers correctly: LCP and CLS are Chromium-only metrics, so on Firefox/WebKit those observers fail silently and the fields stay `0` (`:12-14`); and the collector is *only* the measurement rig, consumers keep their own budget-asserting tests (`:14-15`). This is the client-side analogue of a backend k6 load test. `[Rubric §23, Front-End Performance & Rendering]`, `[Rubric §13, Observability & Operability]` (the JSON artifact), `[Rubric §28, Front-End Testing & Quality]`.
- **Walkthrough** (in teaching order):
  - `InitScript` (`:23-32`): a single concatenated string (kept one-line to stay clear of the MA0136 raw-literal analyzer, `:20-22`) that seeds `window.__vitals` with five zeroed fields, then registers four `PerformanceObserver`s (largest-contentful-paint, layout-shift, paint/FCP, and event/INP), each wrapped in `try/catch` so an engine lacking an entry type leaves that metric at `0` rather than throwing.
  - `InstallAsync(IPage)` (`:37`): registers the observers via `AddInitScriptAsync` so they are active on the *next* navigation, before the document's own scripts run (`:39-40`).
  - `CollectAsync(IPage)` (`:44`): evaluates a script that stamps `ttfb` from the Navigation Timing `responseStart` and returns `JSON.stringify(window.__vitals)` (`:48-51`), then deserializes it into a [WebVitalsSample](#webvitalssample), falling back to an empty sample if deserialization returns null (`:53`).
  - `WriteArtifactAsync(label, path, sample)` (`:60`): resolves the output directory from `WEB_VITALS_OUTPUT_DIR` (set by the CI workflow to the uploaded `artifacts/` dir) or `artifacts/` under the CWD (`:62-63`), wraps the sample in a [WebVitalsArtifact](#webvitalsartifact) (`:66`), and writes indented JSON to `web-vitals-{label}.json` (`:67-68`).
- **Why it's built this way**: installing the observers via an init script before first paint is the only way to capture paint-time metrics (they cannot be observed after the fact); the `try/catch`-per-observer and Chromium-only caveat make it safe to run in the same cross-browser matrix as the a11y scans without failing on engines that lack a metric; and emitting a JSON artifact keeps the measurement durable and attributable rather than a transient log line.
- **Where it's used**: consumer front-end performance tests that install the observers, navigate, collect a [WebVitalsSample](#webvitalssample), and assert their own budgets, then write the [WebVitalsArtifact](#webvitalsartifact) for CI upload.
- **Caveats / not-in-source**: LCP and CLS read `0` on Firefox and WebKit by design; a cross-engine comparison of those two fields is not meaningful (`:12-14`).

### E2ETestBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Infrastructure` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:10` · Level 3 · abstract class

- **What it is**: the shared abstract base for every E2E test. It gives each test its own isolated browser context and page, optional trace capture, the login/registration helpers with their hardened auth-result detection, and the axe-scan helpers (`E2ETestBase.cs:10`).
- **Depends on**: `Microsoft.Playwright`, `Xunit` (`IAsyncLifetime`, `[Collection]`, `TestContext`, `TestResult`); first-party [PlaywrightFixture](#playwrightfixture), [E2ETestConfiguration](#e2etestconfiguration) (with [AdminCredentials](#admincredentials)/[UserCredentials](#usercredentials)), [PageExtensions](#pageextensions), [AxeOptions](#axeoptions). It is the E2E sibling of the component-test base [BunitComponentTestBase](#bunitcomponenttestbase) and the integration base [IntegrationTestBase&lt;TFixture&gt;](#integrationtestbasetfixture).
- **Concept introduced, per-test isolation over a shared browser.** The collection fixture supplies one `Browser`; each test still gets a fresh `BrowserContext` (a clean cookie and storage jar) and `Page` in `InitializeAsync`, disposed in `DisposeAsync`, so no test leaks session state into the next. `[Rubric §14, Testability & Test Strategy]`. `[Rubric §11, Security]`: the session-clear logic in `LoginAsync` is security-correctness in a test (it makes sure a relogin is *actually* a different principal). `[Rubric §29, Resilience, Reliability & Business Continuity]`: the conditional trace capture exists to diagnose intermittent failures.
- **Walkthrough** (in teaching order):
  - **Fields**: the injected `_fixture`, the per-test `_context`, the protected `Page`, and `static BaseUrl` from config (`:12-16`); the constructor captures the fixture (`:18-19`).
  - `InitializeAsync` (`:21`): `NewContextAsync` with `IgnoreHTTPSErrors` and the base URL (`:23-27`), `SetDefaultTimeout` (`:29`), and, when [E2ETestConfiguration](#e2etestconfiguration)`.TracePath` is set, `Tracing.StartAsync` with screenshots/snapshots/sources (`:33-36`), then `NewPageAsync` (`:38`).
  - `DisposeAsync` (`:41`): stops tracing if configured, closes the page, disposes the context (`:43-50`).
  - `StopTracingAsync` (`:57`): if `TracePath` is a directory it writes a trace named by the current test, but **only when the test failed** (`TestContext.Current.TestState?.Result == TestResult.Failed`, `:68`), sanitizing the filename of invalid chars (`:71-73`); a plain file path keeps the single-file behavior (`:64`). This is what makes a single failing test in a full-suite run individually inspectable.
  - `LoginAsAdminAsync`/`LoginAsUserAsync` (`:81-85`): convenience wrappers over `LoginAsync` with [AdminCredentials](#admincredentials)/[UserCredentials](#usercredentials).
  - `LoginAsync` (`:87`): if a logout button is already visible it first clears the existing session, covering **both** token stores, `localStorage` (the WASM/MAUI hosts) **and** the HttpOnly session cookie via a `DELETE /auth/session-cookie` (`:95-102`). The cookie clear matters: the Blazor Server host is cookie-only, so a `localStorage`-only clear would be a no-op and the next login would re-authenticate as the wrong user. (That endpoint is the one the app's own logout uses, served by [SessionCookieAuthenticationHandler](group-08-auth.md#sessioncookieauthenticationhandler).) It then navigates to `/login`, fills the fields via `FillFieldAsync`, clicks sign-in (`:113-121`), waits via `WaitForAuthResultAsync` (`:125`), and finishes with `WaitForInteractiveOrReloadAsync` (`:133`) so a caller that immediately navigates to an `[Authorize]` page does not race a not-yet-authorized render.
  - `RegisterNewUserAsync` (`:136`): mints a unique email and names, navigates to `/register`, fills the five fields, clicks create, waits via `WaitForAuthResultAsync` (`:159`), then `WaitForInteractiveOrReloadAsync` (`:166`), and returns the `(email, password)` so a caller can log back in (`:168`).
  - `WaitForInteractiveOrReloadAsync` (`:182`): the post-auth interactivity guard. It awaits `WaitForBlazorAsync`, and on failure **reloads once** and waits again rather than re-waiting on the same stuck page (`:184-192`). Two trace-proven failure modes feed it: a context-destroyed `PlaywrightException` from the in-flight `forceLoad` reload, and a `TimeoutException` when the freshly-loaded page never boots its runtime under contention; catching both (`:188`) and issuing a fresh request (whose framework assets are now HTTP-cached) gives the retry a genuinely new attempt.
  - `WaitForAuthResultAsync` (`:203`): the de-flake core. It races **three** signals with `Task.WhenAny`, the URL leaving the auth page, the logout button becoming visible, and an error alert becoming visible (`:208-215`). Success is the `forceLoad` navigating away from the auth page, an interactivity-**independent** signal; only an error alert still on the auth page after the grace window (checked via `AuthSucceededWithinGraceAsync`) counts as failure and throws `InvalidOperationException` (`:219-224`). The rationale: under Server-mode prerender on a contended runner the logout button can lag the successful navigation, so keying success off the URL change is strictly safer (it declares failure in a subset of the prior conditions, so it cannot turn a passing flow into a failing one).
  - `AuthSucceededWithinGraceAsync` (`:231`): within the grace window, treats either navigation-away or the logout button appearing as success, catching both `PlaywrightException` and `TimeoutException` from `WaitForURLAsync` (`:235-247`).
  - `NavigateAndWaitAsync` (`:251-252`), `FillFieldAsync` (delegates to [PageExtensions](#pageextensions)`.FillAndVerifyAsync`, `:259-260`), and `UniqueId` (`:262`).
  - `ScanGridAsync` (`:273`): before scanning a MudDataGrid list page it waits for a data row to be visible, because the grid renders its container before the async `ServerData` load fires and waiting for the loading bar to hide is racy (`:275-276`); it then asserts no `[role='progressbar']` remains (`:277`) and calls `AssertNoAccessibilityViolationsAsync` with [AxeOptions](#axeoptions)`.Wcag21AaExceptMudPagerCombobox` (`:278`).
  - `ScanAsync` (`:283`): asserts no `[role='progressbar']` remains (so axe sees a stable DOM), then calls [PageExtensions](#pageextensions)`.AssertNoAccessibilityViolationsAsync` with [AxeOptions](#axeoptions)`.Wcag21Aa` (`:285-286`).
- **Why it's built this way**: the base concentrates every hard-won timing fix (session clear across both token stores, three-signal auth detection, reload-once interactivity retry, grid-load-then-scan) so a consumer's E2E test is just "derive from a workflow base or call these protected helpers," not "re-derive the Blazor timing model." `[Rubric §28]`, `[Rubric §21]`.
- **Where it's used**: the base of the six workflow bases below (the five Identity ones plus [UserPreferencesTestsBase](#userpreferencestestsbase)) and of every consumer (ADC, Store, Helpdesk) E2E test class.

### AuthorizationTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:18` · Level 4 · abstract class

- **What it is**: a shipped abstract fitness base that verifies the app's authorization boundary end to end: every protected route bounces an anonymous full-page load to `/login`, every public route stays anonymously reachable, a freshly-registered non-admin user can reach a representative authenticated page, and that same non-admin is shown the shared Forbidden page (not the content) when probing admin-only routes (`AuthorizationTestsBase.cs:10-17`).
- **Depends on**: [E2ETestBase](#e2etestbase) (`Page`, `RegisterNewUserAsync`, and via [PageExtensions](#pageextensions) the `GotoAndWaitForBlazorAsync`/`GotoProtectedAsync` helpers), `AwesomeAssertions` (`Should().NotBeEmpty`), `Microsoft.Playwright`, `System.Text.RegularExpressions`, `Xunit`.
- **Concept introduced, the authorization boundary as a data-driven fitness test.** Unlike the other workflow bases (which drive one screen), this one is parameterized by route *lists* the subclass supplies, so the assertions and the SSR/client-side-navigation mechanics live here while each app plugs in its own routes. `[Rubric §11, Security]` assesses whether access control is actually enforced (not just declared); the anonymous-redirect sweep proves `[Authorize]` pages are unreachable without a session, and the admin-probe fact covers the escalation direction (a logged-in non-admin reaching for admin routes) that the anonymous test cannot. `[Rubric §26, Front-End Security]`, `[Rubric §25, Navigation, Routing & Information Architecture]`, `[Rubric §28, Front-End Testing & Quality]`.
- **Walkthrough**: the constructor forwards the fixture to the base (`:20-23`). Four members supply the app's routes: abstract `ProtectedPaths` (`:26`) and `PublicPaths` (`:29`), the nullable virtual `AuthenticatedUserPath` (`:35`, `null` when the app has no representative page), and the virtual `AdminPaths` (`:44`, empty when the app has no admin surface). `AnonymousUser_ProtectedPages_ShouldRedirectToLogin` (`:47`) guards that at least one protected path is declared (`:49-50`), then for each does a full-page load and asserts the URL matches `/login` (`:52-57`). `AnonymousUser_PublicPages_ShouldBeAccessible` (`:61`) mirrors that for public paths, asserting each stays on the requested path (`:66-71`). `RegisteredUser_AuthenticatedPage_ShouldBeAccessible` (`:75`) returns early when `AuthenticatedUserPath` is null (`:79-82`, a deliberate pass rather than a dynamic skip, because the shipped library does not reference `xunit.v3.assert`), else registers a non-admin user (`:85`), navigates client-side via `GotoProtectedAsync` (`:89`, because SSR cannot read the stored JWT), and asserts the page loads at the target URL (`:92`). `RegisteredUser_AdminPages_ShouldBeForbidden` (`:96`) uses the same no-skip convention (an empty `AdminPaths` passes, `:100-103`), registers a non-admin, and for each admin path navigates client-side and asserts the shared Forbidden page renders, its `h1[role='alert']` containing "Access Denied" (`:108-119`); role denial is not a redirect (the URL stays put), so the page content is the only reliable denial signal.
- **Why it's built this way**: authorization is exactly the kind of cross-cutting invariant that silently regresses when a new page forgets its `[Authorize]` or its role check; encoding both the anonymous-redirect sweep and the non-admin admin-probe as a shipped base means every consumer verifies them identically, and driving them off route lists (rather than hard-coded paths) keeps the base app-agnostic. The client-side `GotoProtectedAsync` for the authenticated and admin cases reflects the real InteractiveAuto auth model rather than a full-load bounce.
- **Where it's used**: subclassed per consumer Identity E2E project, each supplying its own `ProtectedPaths`/`PublicPaths` (and optionally `AuthenticatedUserPath`/`AdminPaths`).

### LogoutTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/Identity/LogoutTestsBase.cs:9` · Level 4 · abstract class

- **What it is**: a shipped abstract test base carrying two `[Fact]`s for the logout flow (redirect to login on sign-out; protected pages blocked after sign-out) that a consumer makes runnable by subclassing (`LogoutTestsBase.cs:9`).
- **Depends on**: [E2ETestBase](#e2etestbase), `Microsoft.Playwright`, `Xunit`, `System.Text.RegularExpressions`.
- **Concept introduced, the shipped abstract test base (reusable test bodies across consumers).** The framework owns the Identity workflow tests once; each downstream app declares a tiny sealed subclass that supplies the [PlaywrightFixture](#playwrightfixture) through the constructor and inherits the `[Fact]`s verbatim, so the auth UX is verified identically across ADC, Store, and Helpdesk. This is the E2E analogue of the architecture-fitness `*TestsBase` classes elsewhere in this group. `[Rubric §28, Front-End Testing & Quality]`, `[Rubric §14]`, `[Rubric §11, Security]` (correct session revocation).
- **Walkthrough**: the constructor forwards the fixture to the base (`:11-14`). `Logout_ShouldRedirectToLoginPage` (`:16`) registers (which auto-logs in), asserts the sign-out button is visible, clicks it, and asserts the sign-in button reappears (`:17-29`). `Logout_ShouldPreventAccessToProtectedPages` (`:31`) registers, ensures the circuit is interactive with `WaitForBlazorAsync` (`:40`), then clicks sign-out and **waits for the `DELETE /auth/session-cookie` response to complete** via `RunAndWaitForResponseAsync` (`:47-51`), because at full speed the test otherwise reaches `/profile` before that fetch finishes and the still-present HttpOnly cookie lets SSR re-authenticate. It confirms `/login` (`:54-55`), then makes up to six fresh `GotoAsync("/profile")` attempts until the server redirects to `/login` (`:64-72`), with a final URL assertion if it never does (`:75`).
- **Why it's built this way**: it encodes the exact logout-cookie timing race once. The bounded retry plus the explicit wait-for-response make a test deterministic at full machine speed, the subtlety that any slowdown (slow-mo, or even trace capture) masks (`:57-63`).
- **Where it's used**: subclassed by each consumer's Identity E2E project (ADC/Store/Helpdesk).

### ProfileManagementTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/Identity/ProfileManagementTestsBase.cs:11` · Level 4 · abstract class

- **What it is**: a shipped abstract base with six `[Fact]`s exercising the profile page: change name, change address, change password (with relogin), a declared-opt-in change-email journey, load-with-data, and a WCAG scan (`ProfileManagementTestsBase.cs:11`).
- **Depends on**: [E2ETestBase](#e2etestbase), [ProfilePage](#profilepage), `AwesomeAssertions` (`Should().Be`), `Microsoft.Playwright`, `Xunit`; the a11y fact uses [AxeOptions](#axeoptions)`.Wcag21Aa`. Same shipped-abstract-base shape as [LogoutTestsBase](#logouttestsbase).
- **Concept reinforced**: the reusable workflow base, plus the *declared-opt-in* convention for an app-optional journey. `[Rubric §24, Forms, Validation & UX Safety]` (this is the form-heavy page), `[Rubric §21, Accessibility]` (a scan on an authenticated page), `[Rubric §11, Security]` (the password-change-then-relogin fact proves the new credential actually took).
- **Walkthrough**: the constructor forwards the fixture (`:13-16`). A virtual `ProfileSupportsEmailChange` gates the email journey and defaults to `false` (`:24`), so an app without that feature simply passes rather than DOM-probing for the field (`:18-23`). `ChangeName_ShouldUpdateProfileName` (`:27`) registers, navigates via [ProfilePage](#profilepage), clears and fills the name fields, saves, reloads, and asserts the new names persisted with `Should().Be` (`:39-52`). `ChangeAddress_ShouldUpdateProfileAddress` (`:56`) fills the address fields, saves, reloads, and asserts line 1 persisted (`:65-77`). `ChangePassword_WithValidCurrentPassword_ShouldSucceed` (`:81`) fills current/new/confirm via `FillFieldAsync`, submits, waits for the "Password changed successfully." snackbar (`:98`), then signs out (waiting for the logout `forceLoad`'s `/login` URL rather than a load state, the v1.103.1 race fix, `:106-107`) and `LoginAsync`es with the **new** password to prove it works (`:108-109`). `ChangeEmail_ShouldUpdateEmail` (`:113`) returns early when `ProfileSupportsEmailChange` is false (`:118-121`); when a consumer opts in, a missing email field is now a real failure (`:130-131`), so it fills, saves via a "Save Email" button, reloads, and asserts the new email persisted (`:136-145`). `ProfilePage_ShouldLoadWithUserData` (`:149`) registers with explicit names and asserts the profile is pre-filled (`:162-165`). `ProfilePage_ShouldHaveNoAccessibilityViolations` (`:169`) registers (auto-login makes the authenticated profile reachable), navigates, and asserts zero WCAG 2.1 AA violations via [AxeOptions](#axeoptions)`.Wcag21Aa` (`:180`).
- **Why it's built this way**: one base proves the entire profile-edit UX (and its accessibility) once; the declared-opt-in `ProfileSupportsEmailChange` keeps the base reusable across consumers whose profile pages differ, while making the email journey fail loud for an app that actually ships it (replacing an older DOM-probe that passed vacuously when the field was absent, `:18-23`).
- **Where it's used**: subclassed per consumer Identity E2E project.

### UserLoginTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/Identity/UserLoginTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: a shipped abstract base with four `[Fact]`s for the login flow: valid login navigates home, invalid password shows an error, the create-account link routes to register, and the login page passes a WCAG scan (`UserLoginTestsBase.cs:10`).
- **Depends on**: [E2ETestBase](#e2etestbase), [LoginPage](#loginpage), `Microsoft.Playwright`, `Xunit`, `System.Text.RegularExpressions`; the a11y fact uses [AxeOptions](#axeoptions)`.Wcag21Aa`. Same shipped-abstract-base shape as [LogoutTestsBase](#logouttestsbase).
- **Concept reinforced**: the reusable workflow base. `[Rubric §28, Front-End Testing & Quality]`, `[Rubric §21, Accessibility]`, `[Rubric §11, Security]`, `[Rubric §25, Navigation, Routing & Information Architecture]`.
- **Walkthrough**: the constructor forwards the fixture (`:12-15`). `Login_WithValidCredentials_ShouldNavigateToHomePage` (`:17`) registers a fresh user, signs out (registration auto-logs in) and waits for the `/login` URL rather than a load state (`:27-28`, so the pre-login cleanup does not race the in-flight logout navigation), logs back in with `LoginAsync`, and asserts the URL is not `/login`, the sign-out button is visible, and the "Sign In" link is hidden, that is, that the authenticated state rendered (`:34-40`). `Login_WithInvalidPassword_ShouldShowError` (`:43`) drives [LoginPage](#loginpage) with bogus credentials and asserts the error alert is visible and the URL stays `/login` (`:51-56`). `Login_NavigateToCreateAccount_ShouldGoToRegisterPage` (`:59`) clicks the create-account link and asserts the URL is `/register` (`:67-70`). `LoginPage_ShouldHaveNoAccessibilityViolations` (`:73`) scans the login page for WCAG 2.1 AA violations via [AxeOptions](#axeoptions)`.Wcag21Aa` (`:83`).
- **Why it's built this way**: the four facts pin down both happy and error paths plus accessibility of the shared login page once, inherited by every consumer.
- **Where it's used**: subclassed per consumer Identity E2E project.

### UserPreferencesTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Preferences` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/Preferences/UserPreferencesTestsBase.cs:21` · Level 4 · abstract class

- **What it is**: a shipped abstract base with three `[Fact]`s for the culture-switch and theme-toggle UX (ADR-027 i18n, ADR-028 theming): switch to Spanish and persist, toggle dark mode and persist, and reach both controls on a phone-sized viewport (`UserPreferencesTestsBase.cs:21`).
- **Depends on**: [E2ETestBase](#e2etestbase), `AwesomeAssertions` (`Should().Be`), `Microsoft.Playwright`, `Xunit`. It is fully self-contained: the probe page is the shared `/login` (Common UI owns it in every app), the probe string is the localized `Auth.Login.WelcomeBack` ("Welcome Back" / "Bienvenido de nuevo"), and persistence is the anonymous cookie pair (`.AspNetCore.Culture` + `mmca_theme`), so no app-specific overrides are needed (`:9-20`).
- **Concept introduced, the preferences workflow across desktop and mobile chrome.** `[Rubric §27, Internationalization & Localization]` assesses whether a locale switch actually re-localizes and survives a reload; `[Rubric §20, Design System & Theming]` the dark-palette swap; `[Rubric §22, Responsive & Cross-Browser/Device]` that the controls remain reachable below the desktop breakpoint. The selectors are scoped by container because NavMenu's mobile control cluster stays in the DOM at desktop widths (hidden via CSS), so the desktop app-bar cluster (`.appbar-icon-actions`, `:37`) and the mobile NavMenu cluster (`.toprow-actions`, `:39`) are what disambiguate; the MudMenu activator exposes no literal `aria-label`, so the tests locate by accessible name / title (`:16-19`). `[Rubric §28, Front-End Testing & Quality]`.
- **Walkthrough**: the constructor forwards the fixture (`:30-33`); a `DarkBackgroundProbeScript` accepts either the hex or the rgba form of the dark palette background variable, whitespace-free (`:25-28`). `CultureSwitch_ToSpanish_ShouldLocalizeAndPersist` (`:42`) asserts the English probe on `/login` (`:45-46`), opens the desktop `Language` menu and picks "Español" from the open MudMenu popover (`:51-57`), then asserts the Spanish probe appears and survives a fresh full page load, that is, cookie persistence not just the in-flight request (`:61-63`). `ThemeToggle_ToDark_ShouldApplyAndPersist` (`:67`) toggles dark via the title-stable "Toggle light/dark theme" button (its `aria-label` flips with state, its `title` does not, `:71-73`), asserts the palette background flips and that `localStorage["mmca_theme"]` is `"dark"`, and that the choice survives a reload (`:78-84`). `MobileViewport_CultureAndTheme_ShouldBeReachable` (`:88`) sets a 390x844 viewport to pin the v1.103.0 regression where the controls lived only in the app bar (hidden below 1024px, the desktop [BreakpointConstants](group-15-common-ui-framework.md#breakpointconstants) boundary): it asserts the mobile `Language` button is visible and that the mobile theme toggle actually applies dark, not merely renders (`:92-101`). The private `AssertDarkPaletteAsync` (`:103`) waits on the probe script.
- **Why it's built this way**: keeping the whole flow anchored to the framework-owned `/login` page with the anonymous cookie pair makes the base drop-in for any consumer with zero configuration, and the mobile fact exists specifically because the culture/theme toggles were once app-bar-only and invisible on phones (the v1.103.0 regression) which a desktop-only test would never catch.
- **Where it's used**: subclassed per consumer preferences E2E project; its selectors mirror the framework gallery's [MobileTopRowE2ETests](#mobiletoprowe2etests) and [PseudoLocalizationE2ETests](#pseudolocalizatione2etests).

### UserRegistrationTestsBase
> MMCA.Common.Testing.E2E · `MMCA.Common.Testing.E2E.Workflows.Identity` · `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/Identity/UserRegistrationTestsBase.cs:10` · Level 4 · abstract class

- **What it is**: a shipped abstract base with four `[Fact]`s for the registration flow: valid registration navigates home, mismatched passwords show an error, a duplicate email shows an error, and the register page passes a WCAG scan (`UserRegistrationTestsBase.cs:10`).
- **Depends on**: [E2ETestBase](#e2etestbase), [RegisterPage](#registerpage), `Microsoft.Playwright`, `Xunit`, `System.Text.RegularExpressions`; the a11y fact uses [AxeOptions](#axeoptions)`.Wcag21Aa`. Same shipped-abstract-base shape as [LogoutTestsBase](#logouttestsbase).
- **Concept reinforced**: the reusable workflow base. `[Rubric §24, Forms, Validation & UX Safety]` (the `[Compare]` password-match validation), `[Rubric §28, Front-End Testing & Quality]`, `[Rubric §21, Accessibility]`.
- **Walkthrough**: the constructor forwards the fixture (`:12-15`). `Register_WithValidData_ShouldNavigateToHomePage` (`:17`) registers through [RegisterPage](#registerpage) and asserts the URL leaves `/register` and the sign-out button is visible (`:20-34`). `Register_WithMismatchedPasswords_ShouldShowError` (`:36`) fills the fields with the re-hydration-safe [PageExtensions](#pageextensions)`.FillAndVerifyAsync` so every value is bound before submit, submits **once**, and asserts the "Passwords do not match" text and that the URL stays `/register` (`:48-62`). The comment is worth reading: the `[Compare]` mismatch is caught client-side and surfaces as a field-level message under WebAssembly (a page-level `.mud-alert-text-error` alert only under the Server-mode prerender path), so the fact asserts the validation *text* present in both render modes and deliberately does **not** use a re-clicking `ClickAndVerifyAsync` (re-submitting re-runs validation and makes the alert flicker out from under the wait). `Register_WithDuplicateEmail_ShouldShowError` (`:65`) registers a user, navigates back to register, retries with the same email, and asserts the error alert appears (`:69-79`). `RegisterPage_ShouldHaveNoAccessibilityViolations` (`:81`) scans the register page via [AxeOptions](#axeoptions)`.Wcag21Aa` (`:91`).
- **Why it's built this way**: the facts pin the registration happy path, both validation failure modes (with their render-mode nuance), and accessibility once, inherited by every consumer.
- **Where it's used**: subclassed per consumer Identity E2E project.

### BunitInteractionExtensions
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:12` · Level 0 · class

- **What it is**: a static class of intention-revealing extension methods over bUnit's rendered-component API, so a component test can say "click the labelled button" or "does the markup show this text" instead of hand-rolling DOM queries (`MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:7-13`).
- **Depends on**: externals only: `AngleSharp.Dom.IElement`, bUnit's `IRenderedComponent<TComponent>`, and `Microsoft.AspNetCore.Components.IComponent` (`BunitInteractionExtensions.cs:1-3`). No first-party types.
- **Concept introduced**: *accessible-text-first component interaction*. Rather than binding a test to a brittle CSS path (`.mud-button:nth-child(2)`), these helpers locate elements by the visible text a user would read. That keeps the test coupled to behavior, not to MudBlazor's internal class names, which shift between library versions. `[Rubric §28, Front-End Testing]`: §28 assesses whether the UI is exercised through realistic, maintainable component/E2E tests; querying by button text is the maintainable end of that spectrum. `[Rubric §21, Accessibility]`: §21 assesses whether UI affordances carry accessible names; a test that can only find a control by its visible text implicitly pressures components to render readable labels.
- **Walkthrough**:
  - `FindButtonByText<TComponent>` (`BunitInteractionExtensions.cs:15-23`) calls `cut.FindAll("button")`, then returns the first whose `TextContent` contains the target (case-insensitive, `StringComparison.OrdinalIgnoreCase`). On no match it throws `InvalidOperationException` whose message enumerates every button text present (`:20-22`), so a failing test tells you what *was* on the page.
  - `ClickButtonByText<TComponent>` (`:26-28`) is the action verb: find-then-`.Click()`, expression-bodied.
  - `HasText<TComponent>` (`:31-33`) is a boolean assertion helper over `cut.Markup`, again case-insensitive.
- **Why it's built this way**: all three are generic over `TComponent : IComponent` so they attach to any rendered component without a common base. The throw-with-context pattern turns "element not found" into an actionable failure rather than a bare null-reference.
- **Where it's used**: bUnit component tests in the three repos that derive from [BunitComponentTestBase](#bunitcomponenttestbase) and drive a button-bearing page (Login, Register, and the MudBlazor primitives showcase).

### CapturedRequest
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:129` · Level 0 · record

- **What it is**: an immutable snapshot of one HTTP request the code under test sent: `Method`, full `Uri`, `Path` (absolute path), `PathAndQuery`, the `Authorization` header text, and the `Body` text (`MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:129-135`).
- **Depends on**: BCL only (`System.Net.Http.HttpMethod`, `System.Uri`); it is the record produced and stored by [CapturingHttpMessageHandler](#capturinghttpmessagehandler).
- **Concept introduced**: *request capture for behavioral assertions*. A canned-response test proves the UI service parsed the response; a captured request proves it *sent the right thing* (right verb, right route, right bearer token, right JSON body). Splitting `Path` from `PathAndQuery` lets a test assert on the route while ignoring or separately checking the query string. `[Rubric §14, Testability]`: §14 assesses whether behavior is observable in tests; recording the sent request makes the outbound contract observable without a live server.
- **Walkthrough**: a positional `sealed record` with six components; `Body` and `Authorization` are nullable because a GET has no body and an anonymous call has no bearer header (`CapturingHttpMessageHandler.cs:129-135`). It is built inside the handler's `CaptureAsync` (`CapturingHttpMessageHandler.cs:81-87`), which reads the content string once before the response is produced.
- **Where it's used**: exposed through `CapturingHttpMessageHandler.Requests` and `RequestsFor(method, path)` (`CapturingHttpMessageHandler.cs:41,60-64`) so a test can assert, for example, that exactly one POST hit `/orders/42/checkout` carrying the expected token.

### FreshApiClientFactory
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:75` · Level 0 · class

- **What it is**: an `IHttpClientFactory` test double whose `CreateClient` returns a brand-new `HttpClient` on every call, all wired to one shared handler and base address (`MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:75-83`).
- **Depends on**: BCL `System.Net.Http` (`IHttpClientFactory`, `HttpClient`, `HttpMessageHandler`); it wraps the shared [CapturingHttpMessageHandler](#capturinghttpmessagehandler) it is handed.
- **Concept introduced**: *fresh-client-per-call as a load-bearing invariant*. The MMCA UI HTTP services dispose their `HttpClient` after each request; a factory that cached one instance would hand the second request a disposed client (`UiHttpServiceHarness.cs:70-74`). So this double deliberately does the thing a production factory avoids (allocate per call) because that is exactly what the disposal contract requires under test. `[Rubric §14, Testability]`: reproducing the real `IHttpClientFactory` contract (fresh clients, one handler) lets the service under test run unchanged.
- **Walkthrough**: a primary-constructor class taking `(HttpMessageHandler handler, Uri baseAddress)` (`UiHttpServiceHarness.cs:75`). `CreateClient(string name)` ignores the name and returns `new HttpClient(handler, disposeHandler: false) { BaseAddress = baseAddress }` (`:81-82`). The `disposeHandler: false` is critical: the shared handler must outlive each client so its captured-request list survives across calls.
- **Where it's used**: constructed by [UiHttpServiceHarness](#uihttpserviceharness) (`UiHttpServiceHarness.cs:49`) and by [HttpTestDoubles](#httptestdoubles) (`HttpTestDoubles.cs:23-24`).

### IsAuthenticatedAuthorizationService
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:111` · Level 0 · class

- **What it is**: a minimal `IAuthorizationService` (a private nested type in [BunitComponentTestBase](#bunitcomponenttestbase)) that approves any request from an authenticated identity and rejects everyone else, ignoring the specific policy or requirements (`MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:111-121`).
- **Depends on**: externals: `Microsoft.AspNetCore.Authorization` (`IAuthorizationService`, `AuthorizationResult`, `IAuthorizationRequirement`) and `System.Security.Claims.ClaimsPrincipal`.
- **Concept introduced**: *permissive-but-real auth double*. Component tests need `[Authorize]`/`<AuthorizeView>` to actually evaluate, but wiring the full policy engine per test is noise. This double collapses authorization to a single axis: authenticated versus not. It is "real" enough that the authorized and anonymous branches of a component both render, yet it never encodes role/policy detail that belongs in dedicated policy tests. `[Rubric §11, Security]`: §11 assesses whether authorization is exercised rather than bypassed; using an authenticated-vs-anonymous gate keeps the auth branch under test instead of stubbing it away entirely.
- **Walkthrough**: both `AuthorizeAsync` overloads (the requirements overload `BunitComponentTestBase.cs:113-117` and the policy-name overload `:119-120`) funnel to the same check: `user.Identity?.IsAuthenticated == true ? Success() : Failed()`. The policy-name overload delegates to the requirements overload with an empty requirement list.
- **Why it's built this way**: registered as a singleton in the base ctor (`BunitComponentTestBase.cs:45`) so it is the authorization service every rendered component resolves. Pairing it with the authenticated/anonymous principal decision made by [TestPrincipal](#testprincipal) gives a component test one clean lever over "am I signed in."
- **Where it's used**: only inside [BunitComponentTestBase](#bunitcomponenttestbase); not referenced elsewhere.

### MarkupSnapshotResult
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:104` · Level 0 · record struct

- **What it is**: the tiny value returned by a [MarkupSnapshot](#markupsnapshot) comparison: `IsMatch` (did the markup equal the committed baseline, or was it refreshed) and `Message` (a human-readable description, the first differing line on a mismatch) (`MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:101-104`).
- **Depends on**: nothing (a `readonly record struct` over a `bool` and a `string`).
- **Concept introduced**: *assertion-library-free result*. The snapshot helper ships in a NuGet package and must not force a particular assertion framework on consumers, so it returns a plain struct the caller asserts on (`Match(...).IsMatch.Should().BeTrue(result.Message)`) rather than throwing an xUnit/AwesomeAssertions exception itself (see the class docs at `MarkupSnapshot.cs:10-12`). `[Rubric §28, Front-End Testing]`: keeping the primitive dependency-free lets every downstream repo's component tests reuse it regardless of their assertion stack.
- **Walkthrough**: a positional `readonly record struct` (value semantics, no heap allocation); constructed at each of `MarkupSnapshot.Match`'s four exit points (`MarkupSnapshot.cs:45,51-53,58,59`).
- **Where it's used**: the only return type of `MarkupSnapshot.Match` (`MarkupSnapshot.cs:31`).

### MudProviderHandles
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:92` · Level 0 · record

- **What it is**: a small carrier (a protected nested record on [BunitComponentTestBase](#bunitcomponenttestbase)) holding the three rendered MudBlazor infrastructure providers: `Popover`, `Dialog`, and `Snackbar` (`MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:91-95`).
- **Depends on**: bUnit `IRenderedComponent<T>` and MudBlazor `MudPopoverProvider`/`MudDialogProvider`/`MudSnackbarProvider`.
- **Concept introduced**: *provider-root plumbing for overlay components*. MudBlazor renders dialogs, message boxes, popovers, and snackbars into separate provider components, not inline where they are triggered. A component test that opens a `MudMessageBox` or raises a snackbar has nowhere for that overlay to land unless those providers were rendered first. This record bundles the three handles so a test can query the returned `Dialog`/`Snackbar` markup after triggering an overlay (`BunitComponentTestBase.cs:78-89`). `[Rubric §28, Front-End Testing]`: it makes MudBlazor's overlay behavior testable in isolation instead of untestable.
- **Walkthrough**: positional record of three typed `IRenderedComponent<...>` handles (`BunitComponentTestBase.cs:92-95`), returned by `RenderMudProviders()` which renders each provider into the test root (`:83-89`).
- **Where it's used**: returned by [BunitComponentTestBase](#bunitcomponenttestbase)'s `RenderMudProviders`; derived test classes call that before rendering a component under test that opens an overlay.

### MutableAuthenticationStateProvider
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:97` · Level 0 · class

- **What it is**: a private nested `AuthenticationStateProvider` on [BunitComponentTestBase](#bunitcomponenttestbase) whose current principal can be swapped mid-test, notifying listeners on each change (`MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:97-109`).
- **Depends on**: `Microsoft.AspNetCore.Components.Authorization` (`AuthenticationStateProvider`, `AuthenticationState`) and `System.Security.Claims.ClaimsPrincipal`.
- **Concept introduced**: *one provider serving both auth-consumption styles*. Blazor pages read the signed-in user two ways: through the cascading `AuthenticationState`/`<AuthorizeView>` and by injecting `AuthenticationStateProvider` and calling `GetAuthenticationStateAsync()` directly. A hardcoded-anonymous provider only serves the first. This mutable one is a superset: it answers `GetAuthenticationStateAsync()` from its current field *and* raises `NotifyAuthenticationStateChanged` so cascading consumers re-render when the principal changes (`BunitComponentTestBase.cs:20-24` remarks, `:101-108`). `[Rubric §19, State Management]`: §19 assesses how shared client state (here auth state) is propagated; mirroring the real notify-on-change contract keeps state-dependent components behaving as they would in production. `[Rubric §11, Security]`: it drives the same auth surface the app trusts, so auth-conditional UI is genuinely exercised.
- **Walkthrough**: primary-constructor over an initial `ClaimsPrincipal` (`BunitComponentTestBase.cs:97`) stored in a mutable `_principal` field (`:99`). `SetPrincipal` assigns the field and fires `NotifyAuthenticationStateChanged(Task.FromResult(new AuthenticationState(principal)))` (`:101-105`). `GetAuthenticationStateAsync` returns the current field wrapped in a completed task (`:107-108`).
- **Where it's used**: the single instance backing [BunitComponentTestBase](#bunitcomponenttestbase); driven by its `SetUser`/`RenderAs` methods (`BunitComponentTestBase.cs:56,70`).

### Route
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:110` · Level 0 · record

- **What it is**: a private nested record inside [CapturingHttpMessageHandler](#capturinghttpmessagehandler) describing one canned response: `Method`, `Path`, `StatusCode`, and an optional pre-serialized `JsonBody`, plus a `ToResponse()` that materializes a fresh `HttpResponseMessage` (`MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:110-122`).
- **Depends on**: BCL `System.Net.HttpStatusCode`, `System.Net.Http.HttpMethod`, `HttpResponseMessage`, `StringContent`.
- **Concept introduced**: *fresh response per match*. `ToResponse()` builds a new `HttpResponseMessage` (and, when `JsonBody` is non-null, a new UTF-8 `StringContent` at `application/json`) on every call (`CapturingHttpMessageHandler.cs:112-121`). That freshness is deliberate: a Polly retry pipeline re-sends the request, and a reused `HttpContent` would already be consumed. `[Rubric §29, Resilience & Business Continuity]`: §29 assesses whether the system survives retries/faults; because the UI stack retries via Polly, the test double must survive replays, and building responses lazily models the resilient path faithfully.
- **Walkthrough**: positional record (`CapturingHttpMessageHandler.cs:110`); `ToResponse()` sets the status, conditionally attaches JSON content, returns the message (`:112-121`). Instances are created by `SetResponse` (`:56`) and matched last-registration-wins in `Respond` (`:93-99`).
- **Where it's used**: internal to [CapturingHttpMessageHandler](#capturinghttpmessagehandler) only.

### TestPrincipal
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6` · Level 0 · class

- **What it is**: a static factory for `ClaimsPrincipal` instances used in bUnit component tests: an authenticated user with configurable id, name, and roles, plus a ready-made `Organizer` (`MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6-27`).
- **Depends on**: `System.Security.Claims` only.
- **Concept introduced**: *the authenticated-principal shape the app reads*. The identity is built with an explicit `authenticationType: "TestAuth"` (`TestPrincipal.cs:21`), which is what makes `Identity.IsAuthenticated` return true (a `ClaimsIdentity` with no authentication type is treated as anonymous, which is exactly how the base class's `Anonymous` field is built at `BunitComponentTestBase.cs:36`). It seeds the claims real pages consume: `ClaimTypes.Name`, a `user_id` claim (read by Identity's Profile page), and one `ClaimTypes.Role` per supplied role (matched by `<AuthorizeView Roles="…">`) (`TestPrincipal.cs:15-21`). `[Rubric §11, Security]`: producing the true claim set (authenticated flag, user id, roles) means auth-conditional UI is tested against the same principal shape the app trusts, not a hand-waved stand-in.
- **Walkthrough**:
  - `AuthenticatedUser(userId = "1", name = "Test User", params roles)` (`TestPrincipal.cs:13-22`) assembles the claim list, appends a role claim per entry, and returns a principal over a `ClaimsIdentity` carrying `"TestAuth"`.
  - `Organizer(userId = "1")` (`:25-26`) is a convenience overload delegating with the single `"Organizer"` role.
- **Where it's used**: passed into [BunitComponentTestBase](#bunitcomponenttestbase)'s `RenderAs`/`SetUser` to exercise the authorized branch of a component.

### BunitComponentTestBase
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33` · Level 1 · class

- **What it is**: the shared base every bUnit component test across the MMCA repos derives from. It stands up a MudBlazor-and-auth-ready render context so a test just calls `RenderUnderTest`/`RenderAs` and asserts (`MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33-53`).
- **Depends on**: bUnit `BunitContext`; MudBlazor services (`AddMudServices`, the three providers); ASP.NET Core `AddAuthorizationCore`, `AddLocalization`, `AddLogging`; and three nested doubles it owns: [MutableAuthenticationStateProvider](#mutableauthenticationstateprovider), [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice), and [MudProviderHandles](#mudproviderhandles). Authenticated principals come from [TestPrincipal](#testprincipal).
- **Concept introduced**: *the component-test fixture*, the front-end analogue of an integration-test base. bUnit renders a Blazor component into an in-memory DOM without a browser, so tests are fast and run headless in CI. This base pre-wires the four things nearly every MMCA component needs to render: MudBlazor services, loose JSInterop, an auth surface, and localization. `[Rubric §28, Front-End Testing]`: §28 assesses whether components are tested at a realistic level; a shared, correctly-wired base is what makes broad component coverage affordable. `[Rubric §14, Testability]`: centralizing the render harness removes per-test boilerplate that would otherwise drift.
- **Walkthrough**:
  - Fields: `Anonymous` is a static `ClaimsPrincipal` with a bare `ClaimsIdentity` (no auth type, so unauthenticated, `BunitComponentTestBase.cs:36`); `_authProvider` is the single [MutableAuthenticationStateProvider](#mutableauthenticationstateprovider) seeded anonymous (`:38`).
  - Ctor (`:40-53`): `Services.AddMudServices()`; sets `JSInterop.Mode = JSRuntimeMode.Loose` so MudBlazor components that probe JS during render do not throw (`:43`); `AddAuthorizationCore()`; registers [IsAuthenticatedAuthorizationService](#isauthenticatedauthorizationservice) as the singleton `IAuthorizationService` (`:45`) and `_authProvider` as the singleton `AuthenticationStateProvider` (`:46`); then `AddLogging()` + `AddLocalization()` so components injecting `IStringLocalizer<T>` (ADR-027) resolve neutral resources without per-test setup (`:48-52`).
  - `SetUser(principal)` (`:56`) swaps the provider's principal mid-test without a new render root.
  - `RenderUnderTest<TComponent>(parameters)` (`:59-62`) renders as `Anonymous`; `RenderAs<TComponent>(principal, parameters)` (`:65-76`) sets the provider's principal *and* adds the cascading `AuthenticationState`, so both the injected-provider path and the `<AuthorizeView>` cascade see the same user.
  - `RenderMudProviders()` (`:83-89`) renders the popover/dialog/snackbar providers and returns [MudProviderHandles](#mudproviderhandles).
- **Why it's built this way**: the class docs (`:20-31`) flag a deliberate version pin: it is written against bUnit v2 (base `BunitContext`, entry point `Render<T>`), the line compatible with xUnit v3 / Microsoft Testing Platform. If a restore ever resolved bUnit v1.x, the only edits are here; derived tests only touch `RenderUnderTest`/`RenderAs` and never the version-specific symbols. That is a single-point-of-change design (`[Rubric §16, Maintainability]`).
- **Where it's used**: the base class of the `*.UI.Tests` component tests in Common, Store, and ADC.

### CapturingHttpMessageHandler
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18` · Level 1 · class

- **What it is**: a `HttpMessageHandler` test double that answers HTTP-backed UI service calls with canned responses while recording every request (method, URI, Authorization header, body), so services can be unit-tested with no server (`MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:7-18`).
- **Depends on**: BCL `System.Net.Http.HttpMessageHandler`, `System.Text.Json`; produces [CapturedRequest](#capturedrequest) records and stores [Route](#route) registrations.
- **Concept introduced**: *the canned-response-plus-capture handler*, the workhorse of the UI HTTP-service tests. A real UI service builds an `HttpClient`, sends a request, and maps the response; substituting this handler lets a test define what the "server" returns and then inspect what the service sent, all in-process. It offers two configuration styles: a *responder delegate* (ctor) invoked once per request, and *route registration* via `SetResponse`. `[Rubric §14, Testability]`: the outbound request and inbound response are both fully controllable and observable. `[Rubric §9, API & Contract Design]`: canned bodies are serialized with `JsonSerializerDefaults.Web` (`CapturingHttpMessageHandler.cs:20`) to match what the WebAPI actually sends, so the test exercises the real contract shape.
- **Walkthrough**:
  - State: a static web-defaults `JsonSerializerOptions` (`CapturingHttpMessageHandler.cs:20`), an optional `_respond` delegate (`:22`), a `_routes` list of [Route](#route) (`:23`), and a `_requests` list of [CapturedRequest](#capturedrequest) (`:24`).
  - Two ctors: parameterless (route-registration mode, `:30-32`) and one taking a `Func<HttpRequestMessage, HttpResponseMessage>` (responder mode, `:38`).
  - `Requests` (`:41`) exposes the recorded requests read-only; `RequestsFor(method, absolutePath)` (`:60-64`) filters them (case-insensitive path match, query ignored).
  - `SetResponse(method, absolutePath, statusCode, body)` (`:48-57`) serializes `body` (null → empty, raw string passthrough, otherwise web-JSON) and appends a [Route](#route).
  - `SendAsync` (`:66-70`) captures the request first (awaiting `CaptureAsync`, which reads the content string, `:72-88`) then produces a response via `Respond`.
  - `Respond` (`:90-108`) consults registered routes first (`LastOrDefault`, so last-registration-wins), then the responder delegate, then falls back to a 404 with an empty body, mirroring the WebAPI's not-found behavior so incidental refresh calls stay out of each test's setup.
- **Why it's built this way**: routes-first-then-responder-then-404 is a layered default: register only the routes a test cares about, let everything else 404 harmlessly. Responses are built fresh per request (via [Route](#route)'s `ToResponse` or the once-per-request delegate) so a Polly retry never reuses a consumed `HttpContent` (`:14-16`).
- **Where it's used**: the handler behind [UiHttpServiceHarness](#uihttpserviceharness) and [FreshApiClientFactory](#freshapiclientfactory); also handed to [HttpTestDoubles](#httptestdoubles)'s `ClientFactory`.

### MarkupSnapshot
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21` · Level 1 · class

- **What it is**: a dependency-free golden-markup (render-snapshot) regression helper for bUnit tests: it captures a component's rendered markup, normalizes the non-deterministic bits, and compares against a committed baseline `.html` file (`MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:6-21`).
- **Depends on**: BCL only (`System.IO`, `System.Text.RegularExpressions` via source-generated regexes, `CallerFilePath`); returns a [MarkupSnapshotResult](#markupsnapshotresult).
- **Concept introduced**: *snapshot / golden-master testing for markup*. Instead of asserting on individual elements, you assert the whole rendered structure equals a reviewed baseline; an unintended change to a shared primitive fails the build with a diff. Unlike pixel screenshots this is deterministic and OS-independent (pure normalized text), so it runs identically on every CI platform with no per-platform golden management (`MarkupSnapshot.cs:14-19`). `[Rubric §28, Front-End Testing]`: it catches structural regressions in shared UI primitives that per-element assertions miss. `[Rubric §22, Responsive / Cross-Browser]`: because the comparison is text not pixels, one baseline holds across browsers and OSes.
- **Walkthrough**:
  - `Match(markup, snapshotName, [CallerFilePath] callerFilePath)` (`MarkupSnapshot.cs:31-60`): guards non-empty inputs (`:33-34`); normalizes the markup (`:36`); locates a `Snapshots/` folder next to the calling test file via the compiler-supplied path (`:37-39`).
  - Update mode: when `UPDATE_SNAPSHOTS=1` it rewrites the baseline and reports a match (`:41-46`).
  - Missing baseline: it writes the file but reports a *non-match* ("review and commit, then re-run") so a regression can never slip through on an absent snapshot (`:48-54`).
  - Otherwise it reads the baseline, normalizes line endings, and does an ordinal comparison, returning match or a diff message (`:56-59`).
  - `Normalize` (`:64-70`) collapses per-render GUIDs (both dashed and 32-char "N" form, via the two `GeneratedRegex` members at `:94-98`) to a `{guid}` token and trims trailing whitespace, so the comparison only reacts to real markup changes, not MudBlazor's per-render element ids.
  - `BuildDiffMessage` (`:72-92`) walks both line arrays to report the first differing line (with expected/actual), or a length-differs message.
- **Why it's built this way**: kept dependency-free (no assertion library) because it ships in a NuGet package consumed by repos with different test stacks; the caller asserts on [MarkupSnapshotResult](#markupsnapshotresult)'s `IsMatch`. The write-missing-as-failure rule enforces review-and-commit discipline for new baselines.
- **Where it's used**: component tests that snapshot shared primitives / Login-Register markup in the `*.UI.Tests` and gallery suites.

### StubTokenStorageService
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/StubTokenStorageService.cs:13` · Level 1 · class

- **What it is**: a canned `ITokenStorageService` for UI HTTP-service tests: it returns a fixed access token (which the services attach as the Bearer header) without any real platform storage (`MMCA.Common.Testing.UI/Infrastructure/StubTokenStorageService.cs:5-13`).
- **Depends on**: the first-party [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) (`MMCA.Common.UI.Services.Auth`), which it implements.
- **Concept introduced**: *token-storage double with a failure-injection lever*. Production `ITokenStorageService` reads tokens from browser storage over JS interop; under test there is no browser. This stub returns fixed tokens, but crucially exposes `AccessTokenProvider` as a mutable delegate so a test can simulate storage failures, for example the prerender window where JS interop is unavailable, by swapping in a throwing delegate (`StubTokenStorageService.cs:8-11,31-36`). `[Rubric §26, Front-End Security]`: §26 assesses how tokens are held and attached; testing both the happy path and the prerender-failure path guards the bearer-attachment logic. `[Rubric §24, Forms / Validation / UX Safety]`: modelling the storage-unavailable case keeps the UI resilient to a real Blazor prerender edge.
- **Walkthrough**:
  - Ctor `(accessToken = "test-token", refreshToken = "test-refresh-token")` (`StubTokenStorageService.cs:18-23`) seeds the two mutable token properties and sets `AccessTokenProvider` to a delegate returning the current `AccessToken`.
  - `AccessToken` / `RefreshToken` are settable (`:26,29`) and are mutated by the flow methods.
  - `GetAccessTokenAsync()` (`:39`) simply invokes `AccessTokenProvider`, which is the injection point.
  - `GetRefreshTokenAsync()` (`:42`) returns the current refresh token.
  - `SetTokensAsync` / `ClearTokensAsync` (`:45-58`) mutate the canned values so login/logout flows can be asserted via the properties.
- **Where it's used**: held by [UiHttpServiceHarness](#uihttpserviceharness)'s `TokenStorage` (`UiHttpServiceHarness.cs:50,63`) and built by [HttpTestDoubles](#httptestdoubles)'s `TokenStorage` (`HttpTestDoubles.cs:28-29`).

### UiHttpServiceHarness
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:14` · Level 2 · class

- **What it is**: a disposable one-stop fixture that owns all the HTTP plumbing a UI HTTP-service test needs: a shared capturing handler, a fresh-client factory, and a token-storage stub, ready to hand to the service under test (`MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:5-14`).
- **Depends on**: [CapturingHttpMessageHandler](#capturinghttpmessagehandler), [FreshApiClientFactory](#freshapiclientfactory), and [StubTokenStorageService](#stubtokenstorageservice); implements `IDisposable`.
- **Concept introduced**: *the assembled UI-service harness*. Levels 0 and 1 give the parts; this Level 2 type wires them together in the right relationship so a test constructs one object, hands `ClientFactory` and `TokenStorage` to the service, exercises it, then asserts on `Handler.Requests`. It is the UI-service counterpart to the integration-test base in `MMCA.Common.Testing`. `[Rubric §14, Testability]`: bundling the collaborators with their invariants (one shared handler, fresh clients, a canned token) removes the wiring mistakes each test would otherwise risk.
- **Walkthrough**:
  - `DefaultBaseAddress` is a static `https://gateway.test/` (`UiHttpServiceHarness.cs:17`) so services can use relative URIs.
  - Two public ctors mirror the handler's two modes: route-registration (`accessToken = "test-token"`, optional base address, `:25-28`) and responder-delegate (`:37-43`). Both funnel to a private ctor (`:45-51`) that creates the [CapturingHttpMessageHandler](#capturinghttpmessagehandler), a [FreshApiClientFactory](#freshapiclientfactory) over it, and a [StubTokenStorageService](#stubtokenstorageservice) with the canned token.
  - Properties expose the assembled pieces: `Handler` (the recorder/responder), `BaseAddress`, `ClientFactory` (the `IHttpClientFactory` to inject), and `TokenStorage` (`:53-63`).
  - `Dispose()` (`:65`) disposes the shared handler; the harness owns its lifetime.
- **Why it's built this way**: the private-ctor funnel guarantees the one-handler-shared-with-the-factory invariant no matter which public ctor a test picks, and passing `accessToken: null` yields an anonymous client for testing the unauthenticated path.
- **Where it's used**: the primary entry point for UI HTTP-service tests in Common and the downstream repos.

### HttpTestDoubles
> MMCA.Common.Testing.UI · `MMCA.Common.Testing.UI` · `MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:12` · Level 3 · class

- **What it is**: a static toolbox of factory helpers for UI HTTP-service tests: standalone client-factory and token-storage doubles for tests that wire the pieces individually rather than through the harness, plus the canned-response builders both styles share (`MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:7-12`).
- **Depends on**: [FreshApiClientFactory](#freshapiclientfactory), [StubTokenStorageService](#stubtokenstorageservice), [UiHttpServiceHarness](#uihttpserviceharness) (for `DefaultBaseAddress`), and [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice); BCL `System.Net.Http.Json`.
- **Concept introduced**: this is the à-la-carte alternative to [UiHttpServiceHarness](#uihttpserviceharness): when a test does not want the whole assembled fixture it can grab just a client factory or just a token stub, and it centralizes the canned-response constructors so response shapes stay consistent across tests. `[Rubric §9, API & Contract Design]`: the response builders reproduce the exact wire shapes the WebAPI emits (web-defaults JSON, ProblemDetails), so the UI-side mapping is tested against the real contract. `[Rubric §14, Testability]`: shared builders keep every test's canned responses uniform.
- **Walkthrough**:
  - `BaseAddress` reuses `UiHttpServiceHarness.DefaultBaseAddress` (`HttpTestDoubles.cs:15`) so all styles agree on the base URI.
  - `ClientFactory(handler, baseAddress?)` (`:23-24`) returns a [FreshApiClientFactory](#freshapiclientfactory) over the given shared handler.
  - `TokenStorage(accessToken)` (`:28-29`) returns a [StubTokenStorageService](#stubtokenstorageservice).
  - `JsonResponse<T>(payload, statusCode = OK)` (`:33-34`) builds a response with `JsonContent.Create` (web serializer defaults).
  - `EmptyResponse(statusCode = NoContent)` (`:37-38`) builds a body-less response.
  - `ProblemResponse(detail, title = "Domain Exception", statusCode = BadRequest)` (`:44-48`) emits a ProblemDetails-style `{ title, detail }` body the way the WebAPI reports domain failures, so UI error-mapping (e.g. a ServiceExceptionHelper) sees the shape it expects.
- **Where it's used**: component/service tests that assemble their HTTP doubles piecewise, and anywhere a canned `JsonResponse`/`EmptyResponse`/`ProblemResponse` is fed to [CapturingHttpMessageHandler](#capturinghttpmessagehandler)'s responder-delegate ctor.

### AnonymousAuthenticationStateProvider

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/AnonymousAuthenticationStateProvider.cs:11` · Level 0 · class

- **What it is**: A Blazor `AuthenticationStateProvider` that reports the user as permanently signed out. The gallery never authenticates, so the shared layout and auth pages render in their anonymous state (Login/Register links visible, no user menu) and axe scans the unauthenticated markup.
- **Depends on**: `Microsoft.AspNetCore.Components.Authorization.AuthenticationStateProvider` (the abstract base it overrides) and BCL `System.Security.Claims.ClaimsPrincipal`/`ClaimsIdentity`. No first-party dependencies.
- **Concept introduced: the "backend-less gallery stub" pattern.** The gallery host (see [GalleryHost](#galleryhost)) renders the real `MMCA.Common.UI` components with no live API behind them. Every consumer-supplied service the shared UI expects is replaced by a benign stub so the component tree resolves and renders, but no I/O ever fires. This provider is the auth-state stub: a single static `Anonymous` state returned to everyone. `[Rubric §28 - Front-End Testing]` assesses whether the UI has real-browser render/a11y coverage; this stub is what lets a headless Chromium run axe against the shared markup without a running identity service. `[Rubric §14 - Testability]` assesses how cheaply components can be exercised in isolation; substituting the auth-state boundary with a constant is the cheapest possible seam.
- **Walkthrough**: `Anonymous` (line 13) is a `static readonly AuthenticationState` wrapping an empty `ClaimsPrincipal(new ClaimsIdentity())`, an unauthenticated identity because no authentication type is supplied. `GetAuthenticationStateAsync()` (line 16) is an expression body returning `Task.FromResult(Anonymous)`, so every `AuthorizeView`/`CascadingAuthenticationState` in the tree sees the same signed-out principal with no per-call allocation.
- **Why it's built this way**: The gallery exists only for CI's a11y and render-smoke scan, so a fixed anonymous state is both correct and the least code. The class is `internal sealed` because it is wired only inside this test host.
- **Where it's used**: Registered by [GalleryHost](#galleryhost) at `GalleryHost.cs:60` as the `AuthenticationStateProvider`, alongside `AddAuthorizationCore()`.

### NullTokenRefresher

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:9` · Level 1 · class

- **What it is**: An [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) implementation that has no session to refresh. The gallery has no API to refresh a token against; the stub exists only so the DI graph stays complete.
- **Depends on**: [ITokenRefresher](group-15-common-ui-framework.md#itokenrefresher) from `MMCA.Common.UI.Services.Auth`.
- **Concept introduced**: Another instance of the backend-less gallery stub pattern introduced in [AnonymousAuthenticationStateProvider](#anonymousauthenticationstateprovider). `[Rubric §14 - Testability]`: the token-refresh boundary is replaced by a constant so the resilience/refresh plumbing the shared UI registers never actually contacts a token endpoint during the scan.
- **Walkthrough**: `AcquireAccessTokenAsync(CancellationToken)` (line 11) is an expression body returning `Task.FromResult<string?>(null)`: no token, no refresh attempt.
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `GalleryHost.cs:59`.

### NullTokenStorageService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:10` · Level 1 · class

- **What it is**: An empty [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice): there is no stored session in the gallery. It exists so the `AuthDelegatingHandler` that `AddUIShared` registers resolves cleanly, even though it is never actually invoked (the gallery makes no API calls).
- **Depends on**: [ITokenStorageService](group-15-common-ui-framework.md#itokenstorageservice) from `MMCA.Common.UI.Services.Auth`.
- **Concept introduced**: Same backend-less stub pattern as [NullTokenRefresher](#nulltokenrefresher); this one covers token storage rather than refresh. `[Rubric §26 - Front-End Security]` assesses how tokens are stored and handled; the stub deliberately holds nothing, so no credential material is ever persisted in the test host.
- **Walkthrough**: Four members, each inert: `GetAccessTokenAsync()` and `GetRefreshTokenAsync()` (lines 12, 14) return `Task.FromResult<string?>(null)`; `SetTokensAsync(accessToken, refreshToken)` (line 16) and `ClearTokensAsync()` (line 18) return `Task.CompletedTask`, discarding their inputs. The shape mirrors the real storage contract exactly so DI binds, but every path is a no-op.
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `GalleryHost.cs:58`, before `AddUIShared` so its `TryAdd*` registration defers to this stub.

### GalleryUIModule

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:13` · Level 3 · class

- **What it is**: A minimal [IUIModule](group-15-common-ui-framework.md#iuimodule) whose `Assembly` is the gallery itself, so the shared Blazor Router (`Routes.razor`, which scans `UIModules.Select(m => m.Assembly)`) discovers the gallery's own `/components` showcase page. Its nav items make the host browsable when run interactively.
- **Depends on**: [IUIModule](group-15-common-ui-framework.md#iuimodule) and [NavItem](group-15-common-ui-framework.md#navitem) from `MMCA.Common.UI.Common`, plus `MudBlazor.Icons` and BCL `System.Reflection.Assembly`.
- **Concept introduced**: The UI module contribution pattern (introduced with [IUIModule](group-15-common-ui-framework.md#iuimodule) in the Common UI framework group) reused here for a test host: a module contributes route-bearing assemblies and nav links to the shared shell. `[Rubric §18 - UI Architecture]` assesses how the front end composes independently-owned UI slices; the gallery participates in the exact same module-discovery mechanism the real apps use, which is what proves that mechanism renders correctly under scan.
- **Walkthrough**: `NavItems` (line 15) is a collection-expression `IReadOnlyList<NavItem>` of three entries (Login, Register, Components), each pairing a label, a route, and a MudBlazor icon. `Assembly` (line 22) is an expression-bodied property returning `typeof(GalleryUIModule).Assembly`, i.e. the gallery assembly, so the Router additionally scans it for routable components.
- **Where it's used**: Registered as a singleton `IUIModule` by [GalleryHost](#galleryhost) at `GalleryHost.cs:73`.

### StubNotificationInboxUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/StubNotificationInboxUIService.cs:11` · Level 3 · class

- **What it is**: A canned [INotificationInboxUIService](group-15-common-ui-framework.md#inotificationinboxuiservice) that returns fixed inbox data so `NotificationBell` and the notification inbox page render populated, real markup for the axe/render E2E scan, with no backend.
- **Depends on**: [INotificationInboxUIService](group-15-common-ui-framework.md#inotificationinboxuiservice) from `MMCA.Common.UI.Services.Notifications`, the [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) and [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata) result types, and the [UserNotificationDTO](group-10-notifications.md#usernotificationdto) contract.
- **Concept introduced**: The stub pattern extended from inert no-ops to *canned data*: for components whose whole point is to display content, an empty stub would render an empty (and therefore untested) tree, so this stub returns representative rows instead. `[Rubric §28 - Front-End Testing]`: populated markup is what lets axe evaluate contrast, roles, and read/unread affordances against a realistic notification list rather than an empty state.
- **Walkthrough**: `GetInboxAsync(pageNumber=1, pageSize=20, ct)` (line 13) builds a two-item `UserNotificationDTO[]` (lines 16-29): one unread "Welcome to MMCA" and one read "Scheduled maintenance", each with fixed UTC `SentOn`/`ReadOn` timestamps, then wraps them in a `PagedCollectionResult<UserNotificationDTO>` with a `PaginationMetadata(items.Length, pageSize, pageNumber)` (lines 30-31). `GetUnreadCountAsync()` (line 34) returns a constant `3` so the bell badge renders. `MarkReadAsync(id, ct)` and `MarkAllReadAsync(ct)` (lines 36, 39) are no-ops returning `Task.CompletedTask`.
- **Caveats / not-in-source**: The badge count `3` is a hard-coded display value and does not reconcile with the two rows `GetInboxAsync` returns; it exists purely to render a non-empty badge for the scan, not to be internally consistent.

### StubPushNotificationUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/StubPushNotificationUIService.cs:11` · Level 3 · class

- **What it is**: A canned [IPushNotificationUIService](group-15-common-ui-framework.md#ipushnotificationuiservice) so the push-notification history and compose pages render populated, real markup for the axe/render E2E scan, with no backend.
- **Depends on**: [IPushNotificationUIService](group-15-common-ui-framework.md#ipushnotificationuiservice) from `MMCA.Common.UI.Services.Notifications`, [PagedCollectionResult<T>](group-01-result-error-handling.md#pagedcollectionresultt) / [PaginationMetadata](group-01-result-error-handling.md#paginationmetadata), and the [PushNotificationDTO](group-10-notifications.md#pushnotificationdto) contract plus its `SendPushNotificationRequest`.
- **Concept introduced**: The same canned-data variant of the stub pattern as [StubNotificationInboxUIService](#stubnotificationinboxuiservice), applied to the send/history side. `[Rubric §24 - Forms/Validation/UX Safety]`: the compose page is a form, and echoing the submitted `Title`/`Body` back into a returned DTO lets the render smoke exercise the post-submit state without a real send.
- **Walkthrough**: `SendAsync(request, ct)` (line 13) returns a single `PushNotificationDTO` echoing `request.Title`/`request.Body` with fixed `Id=99`, `RecipientCount=42`, `Status="Sent"`, and a fixed UTC `CreatedOn` (lines 15-19). `GetHistoryAsync(pageNumber=1, pageSize=10, ct)` (line 21) builds a two-item history array (one `"Sent"`, one `"Failed"`) with fixed recipient counts and timestamps (lines 24-36) and wraps it in a `PagedCollectionResult<PushNotificationDTO>` with `PaginationMetadata` (lines 37-38).
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `GalleryHost.cs:68`, alongside [StubNotificationInboxUIService](#stubnotificationinboxuiservice) and the scoped `NotificationState`.

### NoOpAuthUIService

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery.Stubs` · `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:12` · Level 6 · class

- **What it is**: A no-op [IAuthUIService](group-15-common-ui-framework.md#iauthuiservice) for the backend-less gallery. The gallery renders the real Login/Register pages for a11y and render-smoke scanning only; no auth calls are exercised, so every operation returns a benign default.
- **Depends on**: [IAuthUIService](group-15-common-ui-framework.md#iauthuiservice) from `MMCA.Common.UI.Services.Auth`, and the `LoginRequest`/`RegisterRequest`/`AuthenticationResponse` auth contracts from `MMCA.Common.Shared.Auth`.
- **Concept introduced**: The registration-order aspect of the stub pattern. This stub is registered *before* `AddUIShared`, whose internal `TryAddScoped<IAuthUIService, AuthUIService>()` then defers to it (per the class doc comment, lines 6-11). `[Rubric §11 - Security]` assesses how authentication is handled; here the auth boundary is neutralized entirely so the scan touches the real login/register *markup* without any credential flow. `[Rubric §14 - Testability]`: swapping the highest-level UI auth service for a constant is what makes the pages renderable in isolation.
- **Walkthrough**: `LastError` (line 14) is always `null`. `LoginAsync`, `RegisterAsync`, and `ExchangeOAuthCodeAsync` (lines 16, 19, 22) each return `Task.FromResult<AuthenticationResponse?>(null)` (no authenticated session). `LogoutAsync()` (line 25) returns `Task.CompletedTask`. `TryRefreshTokenAsync(ct)` and `ChangePasswordAsync(current, new, ct)` (lines 27, 30) both return `Task.FromResult(false)`. Every path is inert but shape-complete so the pages bind and render.
- **Why it's built this way**: Registering the stub ahead of `AddUIShared` exploits the shared UI's `TryAdd*` idempotence (first registration wins), so the gallery overrides only the auth boundary while inheriting everything else the real UI registers.
- **Where it's used**: Registered scoped by [GalleryHost](#galleryhost) at `GalleryHost.cs:57`.

### GalleryHost

> MMCA.Common.UI.Gallery · `MMCA.Common.UI.Gallery` · `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/GalleryHost.cs:20` · Level 7 · class

- **What it is**: A static builder that assembles the backend-less Blazor gallery host. It renders the real `MMCA.Common.UI` auth pages (`/login`, `/register`) and a primitives showcase (`/components`) with the stub implementations of every consumer seam (no-op auth, anonymous auth state, null token storage, canned notifications), so a real-browser axe accessibility scan can run against the shared UI inside `MMCA.Common`'s own CI.
- **Depends on**: ASP.NET Core `WebApplication`/`WebApplicationBuilder`, MudBlazor (`AddMudServices`), and the shared `MMCA.Common.UI` surface (`AddUIShared`, `App`, `_Imports`). It wires in every stub in this unit: [NoOpAuthUIService](#noopauthuiservice), [NullTokenStorageService](#nulltokenstorageservice), [NullTokenRefresher](#nulltokenrefresher), [AnonymousAuthenticationStateProvider](#anonymousauthenticationstateprovider), [StubNotificationInboxUIService](#stubnotificationinboxuiservice), [StubPushNotificationUIService](#stubpushnotificationuiservice), and [GalleryUIModule](#galleryuimodule), plus `SupportedCultures` from `MMCA.Common.Shared.Globalization`.
- **Concept introduced: a self-hostable test host as one buildable unit.** The entire host build lives in `BuildApp(string[] args)` rather than in `Program.cs` so two callers can share it: the `dotnet run` entry point (`Program.cs:7-8`) which `RunAsync()`s it, and the E2E collection fixture (`GalleryHostFixture`) which `StartAsync()`s it on an ephemeral Kestrel port. `[Rubric §28 - Front-End Testing]` assesses real-browser UI coverage; this host is the render target for the `ui-e2e` cross-browser axe/render matrix. `[Rubric §33 - Developer Experience]`: reusing one `BuildApp` for both `dotnet run` and in-process self-host avoids the separate `dotnet run` + health-poll that made ADC's cold-start fragile (per `Program.cs:3-6`).
- **Walkthrough**: `BuildApp` (line 27) resolves the gallery assembly name without a null-forgiving operator (lines 29-32; the comment explains this dodges the IDE0370 analyzer that CI's nullable analysis would raise). It then performs the load-bearing static-web-assets fix (lines 44-47): because the E2E suite self-hosts in Production with the *test host* as entry assembly, the RCL CSS/JS and `blazor.web.js` manifest are not auto-loaded, so the loader is pointed explicitly at `{galleryAssemblyName}.staticwebassets.runtime.json` and forced on; without it the auth pages render unstyled and never become interactive, making axe's contrast checks meaningless. It adds Razor components with interactive server rendering (lines 49-50) and MudServices (line 52), then registers the stubs *before* `AddUIShared` (lines 57-73) so the shared UI's `TryAdd*` registrations defer to them, and finally calls `AddUIShared(builder.Configuration)` (line 78). After `Build()`, it configures request localization (lines 87-91) mirroring the real hosts' ADR-027 allowlist but additionally enabling the `qps-Ploc` pseudo-locale *unconditionally* (the comment, lines 82-86, notes this host is unpackaged test infrastructure and the pseudo pass is a required CI gate for `PseudoLocalizationE2ETests`, the §27 evidence; production keeps `qps-Ploc` Development-only). It then wires antiforgery (line 95), maps static assets with the gallery's own explicit endpoints manifest (lines 99-100), a `/health` endpoint (line 102), and finally maps the Razor components with `App` plus the `MMCA.Common.UI._Imports` assembly as an additional assembly (lines 106-108) so the real Login/Register/Home pages are routable. It returns the built-but-not-started app (line 110).
- **Why it's built this way**: Keeping the whole build in `BuildApp` (not `Program.cs`) lets the E2E fixture host the identical configured app in-process on a bound port, a real `StartAsync`, not `WebApplicationFactory`'s in-memory TestServer, which Playwright cannot reach over the wire, which is why the fixture at `GalleryHostFixture.cs:26-37` binds port 0 and reads the ephemeral address back. This is deliberate CI infrastructure and never deployed.
- **Where it's used**: Consumed by `Program.cs` (the `dotnet run` entry) and by every E2E test through `GalleryHostFixture` (`GalleryHostFixture.cs:26`), which the `MMCA.Common.UI.E2E.Tests` axe/render suite (Login/Register/Components/Notifications/DarkMode/WebVitals/PseudoLocalization) runs against.
- **Caveats / not-in-source**: `MMCA.Common.UI.Gallery` and `MMCA.Common.UI.E2E.Tests` are deliberately excluded from `MMCA.Common.slnx` (per the repo `CLAUDE.md`) so the unit-test job stays fast; they build only by csproj path and run only in CI's `ui-e2e` job.

### BrandColorTokenTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:11` · Level 1 · class
- **What it is**: an ADC-side brand-token drift guard. It is a two-line `sealed` subclass of the shared [BrandColorTokenTestsBase](#brandcolortokentestsbase) that names which stylesheets to police so the reusable test body does the actual work (`MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:11`).
- **Depends on**: [BrandColorTokenTestsBase](#brandcolortokentestsbase) (the shared assertion body, in `MMCA.Common.Testing.Architecture`). No first-party ADC types: the base reads the CSS out of the test assembly's embedded resources.
- **Concept introduced**: the *thin-subclass fitness test*. Nearly every fitness test in this project is a reusable rule (the `...Base` class) plus a per-repo subclass that supplies only the inputs (which files, which allowances, which thresholds). The rule lives once in `MMCA.Common.Testing.Architecture` and every consuming app subclasses it, so a fix to the rule reaches all consumers on the next package bump. `[Rubric §20 - Design System & Theming]` assesses whether brand color, spacing, and typography are centralized as tokens rather than re-hardcoded per view; this guard embodies it by failing the build if the `ADCHome` landing-page CSS re-introduces a literal hex instead of `var(--mmca-primary)`.
- **Walkthrough**: the only member is the overridden `EmbeddedCssLogicalNames` property (`MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:13`), returning the two logical resource names `ADCHome.Server.razor.css` and `ADCHome.Client.razor.css` (`MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:14`). Both stylesheets are embedded into this test assembly via the csproj so the base can load them without touching the source tree, and each copy (Server host and WebAssembly client) is checked independently.
- **Why it's built this way**: the conference landing page ships scoped CSS in both UI hosts; a drift in either copy would silently diverge the brand. The comment records the division of labor (`MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:3`): Common's own `BrandColorTokenTests` guards the C#-to-CSS token *definition*, and this ADC subclass guards the ADC *consumers* of that token.
- **Where it's used**: runs as a `[Fact]` in the `MMCA.ADC.Architecture.Tests` project, part of the `MMCA.ADC.CI.slnf` architecture-test tier.

### TranslationCompletenessTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:12` · Level 5 · class
- **What it is**: an internationalization completeness gate: it fails CI when an English resource key ships without its Spanish counterpart. A `sealed` subclass of the shared [LocalizationResourceTestsBase](#localizationresourcetestsbase) that supplies the required cultures and a non-vacuity floor (`MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:12`).
- **Depends on**: [LocalizationResourceTestsBase](#localizationresourcetestsbase). The base walks every base `*.resx` under `Source/` and asserts a complete, non-empty `.es.resx` sibling.
- **Concept introduced**: *resource-parity as a build gate*. Rather than trust reviewers to add a Spanish string every time they add an English one, the rule enumerates the resx pairs and blocks the merge on any gap. `[Rubric §27 - i18n]` assesses whether the app is genuinely localizable (every user-visible string resolved through resources, and every locale kept complete); this test enforces the "kept complete" half. See the primer for how `IStringLocalizer` resources are structured (`00-primer.md`).
- **Walkthrough**: two overrides. `RequiredCultures` returns `["es"]` (`MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:14`), so Spanish is the single required sibling locale. `MinimumBaseResources` returns `40` (`MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:16`): the floor keeps the gate honest. ADC has 40+ localized resource sets across the three module UIs, the landing page, the nav-item descriptors, and the API error resources (`MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:8`), so if the scan discovers far fewer the scan path is wrong and the test fails rather than passing vacuously.
- **Why it's built this way**: the class comment records that this supersedes the single-locale posture: ADR-027 replaces the earlier single-locale ADR-011 (`MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:4`). A half-translated UI should break the build, not ship.
- **Where it's used**: paired with [LocalizedTextConventionTests](#localizedtextconventiontests) below (that one guards that strings are externalized at all; this one guards that the externalized strings are fully translated).

### AdcArchitectureMap
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:10` · Level 9 · class
- **What it is**: the single declaration of "what the layers and modules of MMCA.ADC actually are," expressed as assemblies. It is the one input every convention/layer/isolation test in this project shares: each of the Level-10 tests below constructs `new AdcArchitectureMap()` and hands it to its reusable base rule.
- **Depends on**: [ArchitectureMapBase](#architecturemapbase) (the framework base that provides the `Framework(...)`, `Module(...)`, `RepoToken`, and `FindRepoRoot(...)` machinery), [LayerRef](#layerref) (the record each entry produces), and the [Layer](#layer) enum. Anchor types are pulled from the real production assemblies: `MMCA.Common.Shared.Abstractions.Result`, `MMCA.Common.Domain.Entities.BaseEntity<>`, `Identity.Domain.Users.User`, `Conference.Domain.Events.Event`, `Engagement.Domain.UserSessionBookmarks.UserSessionBookmark`, and so on.
- **Concept introduced**: the *architecture map*. NetArchTest rules need a set of assemblies to reason over; hard-coding assembly names in each test would be brittle and duplicated. Instead one map enumerates every (module, layer) cell once, and every rule reads it. `[Rubric §7 - Microservices Readiness]` assesses whether module boundaries are explicit and extractable; this map is the machine-readable statement of those boundaries (five framework layers plus the Identity, Conference, and Engagement modules across Domain/Application/Infrastructure/Shared/Api/Ui). `[Rubric §14 - Testability]` and `[Rubric §34 - Architecture Governance]` also apply: the map turns the intended layering into something a test can mechanically verify, so drift is caught by CI rather than by review.
- **Walkthrough**: the class is `internal sealed` and overrides two things. `RepoToken` returns `"MMCA.ADC"` (`MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:12`); the base uses it to locate the repo root (via `MMCA.ADC.slnx`). `DefineLayers()` returns the collection-expression list of `LayerRef` entries (`MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:14`). Two helper shapes appear: `Framework(Layer, assembly)` pins the five MMCA.Common layers by a stable public anchor type's assembly (`MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:17`), and `Module("Name", Layer, assembly)` pins each module layer (`MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:24`). Where a public anchor type is inconvenient (the Application/Infrastructure/UI assemblies), the entry loads the assembly by name via `Assembly.Load("MMCA.ADC.Identity.Application")` (`MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:25`); where a convenient public type exists (`Identity.Shared.Users.UserDTO`, `Identity.API.IdentityModule`), it uses `typeof(...).Assembly` instead (`MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:27`).
- **Why it's built this way**: one map, many rules. The extracted-service topology (four service hosts fronted by a YARP gateway, per the ADC CLAUDE.md and ADRs 007/008) means the module boundaries must stay real; expressing them once here lets [MicroserviceExtractionTests](#microserviceextractiontests) and [ModuleIsolationTests](#moduleisolationtests) prove no forbidden cross-module reference ever slipped in.
- **Where it's used**: every Level-10 test in this unit instantiates it as its `Map` property. It is the shared dependency that makes all those subclasses one-liners.
- **Caveats / not-in-source**: the map lists Identity, Conference, and Engagement; the thin Notification module (API + Application only per the ADC CLAUDE.md) is not pinned here, so the convention rules do not cover it.

### ConcurrencyConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:3` · Level 10 · class
- **What it is**: the ADC binding of the shared concurrency-convention rule. This is the archetypal *pass-through subclass*: its entire body is the one line that supplies the map (`MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:5`), and the reusable base holds all the assertion logic.
- **Depends on**: [ConcurrencyConventionTestsBase](#concurrencyconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: the *shared pass-through shape* that repeats across this whole unit. A rule that needs nothing but the map is expressed as `public sealed class XConventionTests : XConventionTestsBase { protected override IArchitectureMap Map { get; } = new AdcArchitectureMap(); }`. The `Map` override (`MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:5`) is the single seam; read the linked base class for what each rule actually asserts. `[Rubric §8 - Data Architecture]` applies here: the base checks that optimistic-concurrency conventions (row-version / concurrency tokens) are applied consistently across persisted entities.
- **Walkthrough**: one member: the `Map` property initialized to a fresh `AdcArchitectureMap` (`MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:5`). No other overrides, so the base's defaults stand.
- **Why it's built this way**: see [AdcArchitectureMap](#adcarchitecturemap): keeping the rule in Common and the inputs in the app is what lets a whole family of guards be two lines each.

### ConstructorDependencyCountTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:9` · Level 10 · class
- **What it is**: a single-responsibility ceiling guard: it fails if any Application service constructor injects more dependencies than an agreed maximum. A subclass of [ConstructorDependencyCountTestsBase](#constructordependencycounttestsbase) that supplies the map and the ceiling (`MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:9`).
- **Depends on**: [ConstructorDependencyCountTestsBase](#constructordependencycounttestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: *ceiling as an executable code-smell heuristic*. A large constructor argument list is a proxy for a class doing too much. `[Rubric §1 - SOLID]` assesses single-responsibility and cohesion; this test operationalizes it as a hard number rather than a review opinion.
- **Walkthrough**: two overrides: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:11`), and `MaxConstructorDependencies` = `7` (`MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:13`). The class comment names the current high-water mark: `AuthenticationService` at seven dependencies, an accepted cohesive auth facade (`MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:6`). The ceiling is set exactly at that mark, so the next service to exceed it forces a conscious decision.
- **Why it's built this way**: the ceiling is deliberately set to the existing worst case, not padded, so it stays a live tripwire.

### ControllerConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:3` · Level 10 · class
- **What it is**: a controller-shape guard: it asserts that REST controllers extend the framework's `ApiControllerBase` (so they route errors through the shared Result-to-HTTP mapping), with a per-name exemption list. A subclass of [ControllerConventionTestsBase](#controllerconventiontestsbase) (`MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:3`).
- **Depends on**: [ControllerConventionTestsBase](#controllerconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: *documented exemptions instead of silently loosened rules*. When a real controller legitimately breaks the convention, the rule stays strict and the exception is named, with a comment explaining why. `[Rubric §9 - API & Contract Design]` assesses uniform API behavior (consistent error envelopes, status mapping); this guard keeps every domain controller on the shared `ApiControllerBase.HandleFailure()` path described in the ADC CLAUDE.md.
- **Walkthrough**: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:5`). `ControllersExemptFromApiControllerBase` lists two by full name (`MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:11`): `OAuthController` (drives the OAuth2 redirect/challenge/cookie flow, returns no domain Results) and `ServiceInfoController` (an anonymous version-discovery diagnostic). Both deliberately extend `ControllerBase` directly, and the comment records the reasoning (`MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:7`).
- **Why it's built this way**: an exemption in code with a rationale is auditable; a controller quietly skipping the base class is not.

### DataResidencyTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12` · Level 10 · class
- **What it is**: a compliance drift guard: it checks that the data-residency statement published in `PRIVACY.md` matches the Azure region where personal data is actually provisioned. A subclass of [DataResidencyTestsBase](#dataresidencytestsbase) that supplies the map, a forbidden-claim list, and the region-extraction logic (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12`).
- **Depends on**: [DataResidencyTestsBase](#dataresidencytestsbase), [AdcArchitectureMap](#adcarchitecturemap), and BCL `System.IO.File`/`Path`/`String` for reading the workflow file.
- **Concept introduced**: *cross-artifact consistency as a test*. This rule does not inspect assemblies at all; it reconciles two documents (the published privacy policy and the deploy workflow's SQL region) so the legal statement cannot drift from the deployed reality. `[Rubric §30 - Compliance / Privacy / Data Governance]` assesses whether stated data-handling matches actual data location; this test makes that reconciliation mechanical.
- **Walkthrough**: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:14`). `ForbiddenResidencyClaims` blocks the stale `"central United States"` string that once contradicted the deployed region (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:16`). `ExtractDeployedRegion(repoRoot)` (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:20`) reads `.github/workflows/deploy.yml`, finds the marker `SQL_LOCATION_OVERRIDE:-` (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:24`), asserts it exists (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:26`), and returns the region default that follows it by taking characters while they are letters or digits (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:30`). The comment records why SQL sits in its own region: the QiMata sponsorship subscription forces the SQL server into a different region from the Container Apps (`MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:8`).
- **Why it's built this way**: the deploy workflow's `SQL_LOCATION` default is the single source of truth for where PII physically lives, so the privacy statement is validated against it rather than against a hand-maintained constant.

### DomainPurityTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:3` · Level 10 · class
- **What it is**: a Clean-Architecture purity guard: it fails if the Domain (or Shared) layer takes a dependency on infrastructure concerns. A near-pass-through subclass of [DomainPurityTestsBase](#domainpuritytestsbase) that adds one ADC-specific forbidden dependency (`MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:3`).
- **Depends on**: [DomainPurityTestsBase](#domainpuritytestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: extending a base *deny-list* rather than replacing it. `[Rubric §3 - Clean Architecture]` assesses the dependency rule (inner layers know nothing of outer frameworks); this test enforces it while letting each app append its own bans on top of the framework default set.
- **Walkthrough**: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:5`). `ExtraForbiddenDomainDependencies` returns `["RabbitMQ"]` (`MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:9`): ADC runs on a broker (RabbitMQ locally, Azure Service Bus in prod), so the broker client is banned from Domain/Shared on top of the framework-default forbidden list (`MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:7`).
- **Why it's built this way**: keeping the broker out of the domain preserves testability and the option to swap transports (the ADC CLAUDE.md documents the RabbitMQ-vs-Azure-Service-Bus provider switch).

### EntityConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([the shape introduced above](#concurrencyconventiontests)) that binds the entity-convention rule to ADC. Its whole body is the map override (`MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:5`).
- **Depends on**: [EntityConventionTestsBase](#entityconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §4 - DDD]`: the base verifies domain entities follow the aggregate/entity contracts (factory methods, private setters, inheritance from the `BaseEntity`/`AuditableAggregateRootEntity` hierarchy described in `00-primer.md`).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:5`).

### EventConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/EventConventionTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the domain-event convention rule to ADC (`MMCA.ADC.Architecture.Tests/EventConventionTests.cs:3`).
- **Depends on**: [EventConventionTestsBase](#eventconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §6 - CQRS & Event-Driven]`: the base checks that domain events follow the naming/shape/immutability convention (past-tense records raised via `AddDomainEvent()`).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/EventConventionTests.cs:5`).

### FormsConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:14` · Level 10 · class
- **What it is**: a UX-safety convention guard for the Blazor create forms: it asserts each keeps its unsaved-changes guard, dirty tracking, validated `MudForm`, and error summary, plus a bespoke `[Fact]` for the odd-one-out Profile form. A subclass of [FormsConventionTestsBase](#formsconventiontestsbase) that raises the marker set and adds a local test (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:14`).
- **Depends on**: [FormsConventionTestsBase](#formsconventiontestsbase), [ArchitectureMapBase](#architecturemapbase) (for `FindRepoRoot`), [AdcArchitectureMap](#adcarchitecturemap), and BCL `File`/`Path`.
- **Concept introduced**: *marker-string convention tests over markup* and augmenting a base with a hand-written `[Fact]`. Where NetArchTest reasons over assemblies, these rules read `.razor` text and assert required literal markers are present. `[Rubric §24 - Forms / Validation / UX Safety]` assesses whether forms protect the user (validation before submit, unsaved-change guards, visible error summaries); this test freezes those markers so they cannot silently regress.
- **Walkthrough**: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:16`). `MinimumCreateForms` = `6` (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:18`), the six Conference create forms (Event/Session/Room/Question/Speaker/ConferenceCategory). `RequiredMarkers` spreads the base set and appends a per-form `MudAlert` error summary and the localized `Validation.CorrectFollowing` heading (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:24`). The extra `[Fact] ProfileForm_KeepsErrorSummaryAndPasswordValidation` (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:32`) covers the Identity Profile form, which is a single-section password/delete form with no navigate-away step, so it carries no unsaved-changes guard and does not match the base's `*Create.razor` glob (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:9`). That fact loads `Profile.razor` (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:35`), asserts its four required markers (error summary, live error list, and the `ValidateNewPassword`/`ValidateConfirmPassword` wiring) (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:43`), and requires at least three `Required="true"` and three `RequiredError` occurrences for the current/new/confirm password fields (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:58`), counted via the private `CountOccurrences` helper (`MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:64`).
- **Why it's built this way**: the Profile form is a legitimate structural exception to the create-form glob, so its §24 markers are asserted directly rather than shoehorned into the shared rule (see the unsaved-changes-guard behavior noted in the auto-memory).

### FrameworkVersionConsistencyTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9` · Level 10 · class
- **What it is**: an evolvability guard that makes ADR-016 executable: it fails if the `MMCA.Common.*` packages pinned in `Directory.Packages.props` are not all on one version. A pass-through subclass of [FrameworkVersionConsistencyTestsBase](#frameworkversionconsistencytestsbase) (`MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9`).
- **Depends on**: [FrameworkVersionConsistencyTestsBase](#frameworkversionconsistencytestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §16 - Maintainability]`: the base parses the CPM manifest and asserts a single shared version, catching a partial sweep at CI time instead of at runtime (`MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:4`).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:11`).
- **Why it's built this way**: the "no phased rollout, bump every entry in lockstep" rule (ADR-016) is a policy this test turns into a gate.

### HandlerConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the CQRS handler-convention rule to ADC (`MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:3`).
- **Depends on**: [HandlerConventionTestsBase](#handlerconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §6 - CQRS & Event-Driven]`: the base checks command/query handlers implement `ICommandHandler`/`IQueryHandler` and follow the naming/placement convention that feeds the decorator pipeline (`00-primer.md`).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:5`).

### ImmutabilityTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the immutability rule to ADC (`MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:3`).
- **Depends on**: [ImmutabilityTestsBase](#immutabilitytestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §4 - DDD]`: the base verifies value objects, DTOs, commands, and events are immutable (`required`/`init` members, no public setters).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:5`).

### IntegrationEventContractTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:3` · Level 10 · class
- **What it is**: a frozen wire-contract snapshot for the cross-service async API: it pins the exact set of integration events (and their fields/types) that travel outbox-to-broker, so an accidental shape change breaks the build. A subclass of [IntegrationEventContractTestsBase](#integrationeventcontracttestsbase) supplying the expected contract (`MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:3`).
- **Depends on**: [IntegrationEventContractTestsBase](#integrationeventcontracttestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: *contract as a golden snapshot*. Integration events are a published wire contract between services; changing one silently can break a consumer running an older revision. `[Rubric §9 - API & Contract Design]` and `[Rubric §7 - Microservices Readiness]` both apply: the test forces any event evolution to be a deliberate, versioned, consumer-coordinated change (`MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:7`).
- **Walkthrough**: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:5`). `ExpectedContract` lists the three current events with their field signatures (`MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:9`): `SpeakerLinkedToUser { SpeakerId:Guid, UserId:Int32 }`, `SpeakerUnlinkedFromUser { SpeakerId:Guid, UserId:Int32 }`, and `UserRegistered { Email:String, FirstName:String, LastName:String, Role:String, UserId:Int32 }`. These match the Identity-to-Conference and Conference-to-Identity flows described in the ADC CLAUDE.md.
- **Why it's built this way**: the outbox-and-broker flow (ADR-003) crosses process boundaries, so its payload shapes are a public API surface and are guarded like one.

### LayerDependencyTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the layer-dependency rule to ADC (`MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3`). This is the headline Clean-Architecture fitness test.
- **Depends on**: [LayerDependencyTestsBase](#layerdependencytestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §3 - Clean Architecture]`: the base uses the map's layer ordering to assert every allowed direction (Domain to Application to Infrastructure to API/UI, plus Shared) and forbid the reverse, per layer, across all three modules and the framework.
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:5`).

### LocalizedTextConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:14` · Level 10 · class
- **What it is**: a localized-text convention gate: it fails if user-visible literals are hard-coded in `.razor`/`.razor.cs` instead of resolving through `IStringLocalizer`. A subclass of [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase) supplying the map and a non-vacuity floor (`MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:14`).
- **Depends on**: [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: the *externalization* half of i18n, complementing [TranslationCompletenessTests](#translationcompletenesstests) (the *completeness* half). `[Rubric §27 - i18n]`: this rule guards snackbar messages, page `Title` properties, `<PageTitle>` markup, breadcrumb labels, and NavItem titles (which must carry a `TitleResource`), with deliberate literals exempted per line by an `i18n: allow` marker (`MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:9`).
- **Walkthrough**: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:16`). `MinimumScannedFiles` = `60` (`MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:18`); ADC has ~77 razor files across the three module UIs and the UI hosts, so a near-zero discovery count means the scan path is broken and the gate must fail rather than pass vacuously (`MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:11`).
- **Why it's built this way**: supersedes single-locale ADR-011 via ADR-027 (`MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:4`); externalizing every visible string is the precondition that makes translation-completeness meaningful.

### MicroserviceExtractionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the microservice-extraction-readiness rule to ADC (`MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3`).
- **Depends on**: [MicroserviceExtractionTestsBase](#microserviceextractiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §7 - Microservices Readiness]`: the base asserts no compile-time cross-module coupling exists that would block extracting a module into its own service (the modules here are already extracted into four service hosts per ADRs 007/008, so this guard prevents regression).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:5`).

### ModuleIsolationTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the module-isolation rule to ADC (`MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3`).
- **Depends on**: [ModuleIsolationTestsBase](#moduleisolationtestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §7 - Microservices Readiness]`: the base forbids one module's internals from referencing another module's domain directly; cross-module collaboration must go through the sanctioned gRPC/interface or integration-event paths (ADC CLAUDE.md).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:5`).

### NamingConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the naming-convention rule to ADC (`MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:3`).
- **Depends on**: [NamingConventionTestsBase](#namingconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §16 - Maintainability]`: the base asserts type-name suffix conventions (handlers, validators, DTOs, configurations, and the like) so a name reliably signals a role.
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:5`).

### PiiConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the PII-convention rule to ADC (`MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3`).
- **Depends on**: [PiiConventionTestsBase](#piiconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §11 - Security]` and `[Rubric §30 - Compliance / Privacy]`: the base verifies personal-data fields are annotated with the `PiiAttribute` so the erasure/masking machinery (ADR-005) can find them.
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:5`).

### SharedLayerTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:3` · Level 10 · class
- **What it is**: a pass-through subclass ([shape](#concurrencyconventiontests)) binding the Shared-layer rule to ADC (`MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:3`).
- **Depends on**: [SharedLayerTestsBase](#sharedlayertestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §3 - Clean Architecture]`: the base asserts the Shared project stays a thin contract layer (DTOs, requests, enums, identifier aliases) with no dependency on Application/Infrastructure.
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:5`).

### SliceCohesionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:8` · Level 10 · class
- **What it is**: a vertical-slice cohesion guard: it fails the build if a handler is stranded from its command/query or validator. A pass-through subclass of [SliceCohesionTestsBase](#slicecohesiontestsbase) (`MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:8`).
- **Depends on**: [SliceCohesionTestsBase](#slicecohesiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §5 - Vertical Slice]`: the base asserts each `Application/{Aggregate}/UseCases/{Operation}/` slice keeps its command/query, handler, and validator in one namespace (`MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:4`).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:10`).

### SpecificationConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8` · Level 10 · class
- **What it is**: a cross-source specification guard: it forbids a specification from filtering by navigating to another entity, which would not translate if that entity later moved to a different data source. A pass-through subclass of [SpecificationConventionTestsBase](#specificationconventiontestsbase) (`MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8`).
- **Depends on**: [SpecificationConventionTestsBase](#specificationconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §8 - Data Architecture]`: the rule keeps specifications translatable across the polyglot-persistence boundary; the guidance is to use `CrossSourceSpecification` instead of a cross-entity navigation (`MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:3`).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:10`).
- **Why it's built this way**: the Session-to-Cosmos / Room-to-SQLite polyglot trial was reverted but the framework boundaries were kept (ADR-018), so the guard stays on as a forward safeguard (`MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:3`).

### StateManagementConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:11` · Level 10 · class
- **What it is**: a state-management convention guard for the Blazor Server circuit model: it asserts the module UI assemblies carry no mutable static state (a static member is shared across every circuit) and that stateful UI services stay scoped. A pass-through subclass of [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) (`MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:11`).
- **Depends on**: [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §19 - State Management]`: mutable static state leaks across users in a server-render model, so the per-circuit state model is CI-enforced rather than review-enforced (`MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:6`).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:13`).

### UIArchitectureConventionTests
> MMCA.ADC.Architecture.Tests · `MMCA.ADC.Architecture.Tests` · `MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:12` · Level 10 · class
- **What it is**: a UI-architecture convention guard: it asserts every code-behind under `Source/` stays within the 400-line convention cap and that inline `@code` blocks stay small, keeping the container/presentational split CI-enforced. A pass-through subclass of [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase) (`MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:12`).
- **Depends on**: [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase) and [AdcArchitectureMap](#adcarchitecturemap).
- **Concept introduced**: cross-reference only. `[Rubric §18 - UI Architecture]`: the rule caps component size so presentation logic gets split out rather than accreting; it subsumes TD-13 (the oversized Conference dashboards were split to conform when this gate landed) (`MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:9`).
- **Walkthrough**: one member: `Map` = `new AdcArchitectureMap()` (`MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:14`).

### FitnessPrincipal
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:45` · Level 4 · class
- **What it is** - a throwaway "principal" entity used only as test data for the specification-navigation fitness function. It is the entity that a dependent record points at, so a specification can be written that tries to reach across the navigation into it.
- **Depends on** - [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (it is a `public sealed class FitnessPrincipal : AuditableBaseEntity<int>`, `SpecificationFitnessTests.cs:45`).
- **Concept introduced** - *test fixture entities for a fitness function.* A fitness function is an executable architecture rule (see [ArchitectureRules](#architecturerules)); to prove such a rule actually fires you feed it a deliberately-crafted model rather than the real domain. `FitnessPrincipal` is one half of that crafted model: a bare aggregate-shaped type carrying a single scalar (`IsActive`, `SpecificationFitnessTests.cs:47`) so a specification can navigate to it. [Rubric §14 - Testability] assesses whether rules are provable with focused inputs; this fixture exists precisely so the guard is tested against a known-unsafe shape instead of hoping a real specification trips it.
- **Walkthrough** - one auto-property, `bool IsActive` (`SpecificationFitnessTests.cs:47`). That is the only member; identity and audit fields come from the base. It is the navigation target referenced by [FitnessDependent](#fitnessdependent).Principal.
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
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:36` · Level 5 · class
- **What it is** - the other half of the specification-navigation fixture: an entity that holds a foreign-key scalar and a navigation to a [FitnessPrincipal](#fitnessprincipal), so both a safe (scalar-only) and an unsafe (navigating) specification can be written over it.
- **Depends on** - [AuditableBaseEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`public sealed class FitnessDependent : AuditableBaseEntity<int>`, `SpecificationFitnessTests.cs:36`) and [FitnessPrincipal](#fitnessprincipal) (the `Principal?` navigation, `:40`).
- **Concept introduced** - cross-references the fixture concept introduced by [FitnessPrincipal](#fitnessprincipal). This type adds the parts a specification can filter on: `PrincipalId` (scalar FK, `:38`), a nullable `Principal` navigation (`:40`), and a `Flag` scalar (`:42`). The scalar-versus-navigation split is the whole point: it lets one fixture support both the pattern the rule must flag and the pattern it must leave alone.
- **Walkthrough** - three auto-properties: `int PrincipalId` (`:38`), `FitnessPrincipal? Principal` (`:40`), `bool Flag` (`:42`). [ScalarOnlySpec](#scalaronlyspec) filters on `PrincipalId`/`Flag`; [NavigatingSpec](#navigatingspec) reaches through `Principal`.
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
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:51` · Level 6 · class
- **What it is** - the deliberately-unsafe fixture specification: its `Criteria` navigates from the dependent into a related entity, the exact pattern the fitness function must flag.
- **Depends on** - [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (`private sealed class NavigatingSpec : Specification<FitnessDependent, int>`, `SpecificationFitnessTests.cs:51`) and [FitnessDependent](#fitnessdependent)/[FitnessPrincipal](#fitnessprincipal) (the entities it filters over).
- **Concept introduced** - *why cross-entity navigation in a specification is unsafe across data sources.* Under database-per-service (ADR-006), a `d => d.Principal!.IsActive` predicate (`:53`) assumes the related entity lives in the same queryable model; once the principal is extracted to another physical source, that navigation cannot translate to SQL. The fitness function `SpecificationsDoNotNavigateToOtherEntities` treats it as a violation. [Rubric §7 - Microservices Readiness] assesses whether the code stays extractable; this fixture is the negative example that proves the readiness guard fires.
- **Walkthrough** - one member, an overridden `Criteria` expression that dereferences the `Principal` navigation (`:53`). The test asserts the rule's exception message contains this type's name.
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
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:57` · Level 6 · class
- **What it is** - the deliberately-safe counterpart to [NavigatingSpec](#navigatingspec): its `Criteria` filters only on the entity's own scalar columns, the pattern the fitness function must leave alone.
- **Depends on** - [Specification<TEntity, TIdentifierType>](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (`private sealed class ScalarOnlySpec : Specification<FitnessDependent, int>`, `SpecificationFitnessTests.cs:57`) and [FitnessDependent](#fitnessdependent).
- **Concept introduced** - cross-references the navigation-safety concept from [NavigatingSpec](#navigatingspec); this is the positive example. A predicate over the entity's own scalars (`d => d.PrincipalId == 1 && d.Flag`, `:59`) translates to SQL on any engine and survives extraction, so the rule must not flag it. Having both a flagged and an un-flagged fixture is what makes the test prove the rule discriminates rather than just always throwing.
- **Walkthrough** - one overridden `Criteria` filtering on `PrincipalId` and `Flag` (`:59`). The test asserts the rule's exception message does *not* contain this type's name.
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
- **Why it's built this way** - the message-bus abstraction must stay in Application so application code depends on transport through it (extraction seam, ADR-007); the JWKS provider is crypto and belongs in Infrastructure (ADR-004). These are load-bearing placements, so they get their own asserted facts.
- **Where it's used** - an independent class in the Common architecture suite; it has no counterpart in Store/ADC because only Common owns the Grpc package and defines these abstractions.

### SpecificationFitnessTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:15` · Level 7 · class
- **What it is** - the test that verifies the `SpecificationsDoNotNavigateToOtherEntities` fitness function actually discriminates: it must flag a specification that navigates into another entity and must leave a scalar-only specification alone.
- **Depends on** - [ArchitectureRules](#architecturerules) (the rule under test), and its own nested fixtures [SpecTestMap](#spectestmap), [FitnessDependent](#fitnessdependent), [FitnessPrincipal](#fitnessprincipal), [NavigatingSpec](#navigatingspec), [ScalarOnlySpec](#scalaronlyspec).
- **Concept introduced** - *testing the test: verifying a fitness function is neither vacuous nor over-broad.* A rule that never fires is useless; a rule that flags everything is worse. This class proves the specification-navigation guard does exactly one thing by feeding it both a positive and a negative fixture in a single run. [Rubric §14 - Testability] assesses whether the guardrails themselves are trustworthy; this is the meta-test that earns that trust.
- **Walkthrough** - one `[Fact]`, `Rule_FlagsNavigatingSpecification_ButNotScalarSpecification` (`:17`-`:26`). It invokes `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities(new SpecTestMap())` (`:20`), captures the thrown exception, and asserts its message contains `NavigatingSpec` and the word "navigates" while *not* containing `ScalarOnlySpec` (`:22`-`:25`). The nested types below the fact supply the model: `SpecTestMap` (`:28`), the two entities (`:36`,`:45`), and the two specifications (`:51`,`:57`).
- **Why it's built this way** - the navigation rule protects future extraction (a navigating specification cannot cross a data-source boundary, ADR-006); a discriminating test keeps the rule honest as it evolves.
- **Where it's used** - an independent class in the Common architecture suite.

### SpecTestMap
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:28` · Level 7 · class
- **What it is** - a minimal architecture map used only by [SpecificationFitnessTests](#specificationfitnesstests): it registers this test assembly as the single Application layer so the specification-navigation rule has a model to scan.
- **Depends on** - [ArchitectureMapBase](#architecturemapbase) (`private sealed class SpecTestMap : ArchitectureMapBase`, `SpecificationFitnessTests.cs:28`).
- **Concept introduced** - cross-references the map concept from [CommonArchitectureMap](#commonarchitecturemap). Where the real map spans seven packages, this one collapses to a single self-referential Application layer (`Framework(Layer.Application, typeof(SpecificationFitnessTests).Assembly)`, `:33`) because the fixtures (the two specifications and two entities) live in the test assembly itself. It is the smallest map that lets a fitness function run against hand-crafted types.
- **Walkthrough** - `RepoToken => "MMCA.Common"` (`:30`) and a one-entry `DefineLayers()` (`:32`-`:33`) pointing at this assembly.
- **Where it's used** - instantiated once inside [SpecificationFitnessTests](#specificationfitnesstests)'s single fact.

### AggregateConventionTests, DomainPurityTests, EventVersioningConventionTests, LayerDependencyTests, LocalizedTextConventionTests, MicroserviceExtractionTests, PiiConventionTests, SliceCohesionTests, StateManagementConventionTests, UIArchitectureConventionTests
> MMCA.Common.Architecture.Tests · `MMCA.Common.Architecture.Tests` · (see per-type table) · Level 8 · class

These ten sealed classes share one shape: each is a **thin subclass of a shared `*TestsBase` rule** from the `MMCA.Common.Testing.Architecture` package, supplying the repo's [CommonArchitectureMap](#commonarchitecturemap) (and, for a few, one extra override) so the same rule body runs identically across MMCA.Common, MMCA.Store, and MMCA.ADC. This is the [Rubric §34 - Architecture Governance & Documentation] and [Rubric §14 - Testability] story: architecture conventions are executable and enforced in CI rather than left to review, and the rule logic lives in exactly one place. See the thin-subclass pattern introduced by [DependencyVersionTests](#dependencyversiontests). The canonical body of each rule is the corresponding `*TestsBase`; these subclasses only wire in the map and any repo-specific floor or allowlist. Each fails the `build-and-test` CI job on violation, and several are deliberately *vacuous today* (they assert nothing until the framework grows a type that could break the convention, at which point they fire).

| Type | File:Line | Base rule | What it enforces / what differs |
|------|-----------|-----------|----------------------------------|
| `AggregateConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9` | [AggregateConventionTestsBase](#aggregateconventiontestsbase) | DDD aggregate-root factory rules for the framework's own aggregates. Supplies only `Map` (`:11`). [Rubric §4 - DDD.] |
| `DomainPurityTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9` | [DomainPurityTestsBase](#domainpuritytestsbase) | Domain/Shared stay framework-free and Application stays host-agnostic. Supplies only `Map` (`:11`). [Rubric §3 - Clean Architecture.] |
| `EventVersioningConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/EventVersioningConventionTests.cs:10` | [EventConventionTestsBase](#eventconventiontestsbase) | Integration-event `SchemaVersion`/`BaseIntegrationEvent`/namespace rules (ADR-010). Supplies only `Map` (`:12`). Vacuous today: the framework ships no concrete integration event. [Rubric §6 - CQRS & Event-Driven.] |
| `LayerDependencyTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9` | [LayerDependencyTestsBase](#layerdependencytestsbase) | Clean Architecture layer-flow (each layer references only layers below). Supplies only `Map` (`:11`). [Rubric §3 - Clean Architecture.] |
| `LocalizedTextConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizedTextConventionTests.cs:11` | [LocalizedTextConventionTestsBase](#localizedtextconventiontestsbase) | Shared `MMCA.Common.UI` ships no hard-coded user-visible literals; everything resolves through `IStringLocalizer` (ADR-027). Also overrides `MinimumScannedFiles => 20` (`:16`) so a wrong scan root is caught. [Rubric §27 - i18n.] |
| `MicroserviceExtractionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10` | [MicroserviceExtractionTestsBase](#microserviceextractiontestsbase) | Domain/Application/Shared stay free of MassTransit/Grpc/Protobuf (transport lives at the edges). Supplies only `Map` (`:12`). [Rubric §7 - Microservices Readiness.] |
| `PiiConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13` | [PiiConventionTestsBase](#piiconventiontestsbase) | `[Pii] => IAnonymizable` right-to-erasure scan (ADR-005). Supplies only `Map` (`:15`). Structurally vacuous in the framework; the machinery is proven non-vacuously by [PiiErasureContractFitnessTests](#piierasurecontractfitnesstests). [Rubric §30 - Compliance/Privacy.] |
| `SliceCohesionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/SliceCohesionTests.cs:10` | [SliceCohesionTestsBase](#slicecohesiontestsbase) | Each Notifications use-case slice keeps command/query, handler, and validator in one namespace. Supplies only `Map` (`:12`). [Rubric §5 - Vertical Slice.] |
| `StateManagementConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:11` | [StateManagementConventionTestsBase](#statemanagementconventiontestsbase) | `MMCA.Common.UI` carries no mutable static state and keeps stateful services scoped (per-circuit model). Overrides `AllowedStaticMembers` to whitelist `ErrorMessages._localizer`, a write-once wiring seam, not per-user state (`:21`-`:22`). [Rubric §19 - State Management.] |
| `UIArchitectureConventionTests` | `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/UIArchitectureConventionTests.cs:11` | [UIArchitectureConventionTestsBase](#uiarchitectureconventiontestsbase) | Shared pages/primitives keep code-behind within the convention cap and inline `@code` blocks small (container/presentational split). Supplies only `Map` (`:13`). [Rubric §18 - UI Architecture.] |

- **Why they're built this way** - see the two-layer "Architecture Enforcement" model in `MMCA.Common/CLAUDE.md`: rules are enforced at compile time (LayerEnforcement.targets) and at runtime here, with the runtime bodies factored into one shared package so Common, Store, and ADC stay identical. Each subclass exists only so xUnit discovers the rule in this repo's assembly with this repo's map.
- **Where they're used** - all ten run in the `MMCA.Common.Architecture.Tests` project during CI's `build-and-test` job (fast, no database).

## Per-project test rollup

This guide treats **tests as grouped, not sectioned per `[Fact]`** (the logged exception in the
charter): the reusable test *bases*, the shared architecture-fitness library and its per-repo thin
subclasses, and the component **Gallery** harness each get their own `###` treatment in the earlier parts
of this chapter, but the bulk of the suite, **1,032 individual test types across 36 projects**, is rolled
up here. Each row below names a test project (assembly), the count of test types it contributes to the
1,032, **what** it covers, and its **style** (unit / integration / component / E2E / performance-smoke).
Counts reconcile exactly to the unit input.

A few cross-cutting facts hold for every row, so they are stated once here rather than repeated:

- **Stack.** Every project is **xUnit v3** run under the **Microsoft Testing Platform** (not VSTest,
  `global.json` sets `"runner": "Microsoft.Testing.Platform"`), with **AwesomeAssertions** for fluent
  asserts, **Moq** for test doubles, and **coverlet** for coverage. The lone exception is
  `MMCA.Common.Benchmarks`, a **BenchmarkDotNet** executable (not a test project). See
  [primer §3](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0) for the platform/runner
  externals.
- **Layering mirror.** The ADC module suites repeat the same seven-project shape per module
  (`{Module}.{Shared,Domain,Application,Infrastructure,API,UI}.Tests` + a per-service
  `{Module}.IntegrationTests`), so once you understand the Conference column you understand Engagement
  and Identity: they differ only in volume, not in kind.
- **Fitness tests and shared bases live elsewhere.** `MMCA.Common.Architecture.Tests` and
  `MMCA.ADC.Architecture.Tests` (the NetArchTest layer/purity/extraction suites, thin subclasses of the
  shared [`ArchitectureRules`](#architecturerules) rule library) are **not** in this table: they are
  covered as first-class sections earlier in this chapter. The same is true of the shared test *bases*
  ([`IntegrationTestBase<TFixture>`](#integrationtestbasetfixture),
  [`BunitComponentTestBase`](#bunitcomponenttestbase), the Playwright fixtures) and the
  `MMCA.Common.UI.Gallery` harness.
- **Two integration tiers, deliberately split.** Each service has a per-service `*.IntegrationTests`
  project that boots **one** host through `WebApplicationFactory<Program>` with cross-service gRPC edges
  faked and no broker (these gate deploy via the `integration-tests` CI job and need a real SQL Server
  named by `ADC_TEST_SQL_BASE`). Separately, `MMCA.ADC.CrossService.IntegrationTests` boots **all three**
  REST hosts against **Testcontainers** SQL Server + RabbitMQ to prove the genuine broker and gRPC
  round-trips (a non-gating nightly tier that needs Docker). `[Rubric §14, Testability]` (assesses how
  thoroughly and at what cost the system can be verified): the count and spread below, heavy at the inner
  Application/Domain layers, thinner at the edges, with a dedicated integration + E2E tier, is the classic
  healthy **test pyramid**, and the fact that the volume concentrates in fast in-memory unit layers keeps
  the feedback loop cheap.

### MMCA.Common, the framework suite (Tests/ mirrors Source/)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.Common.Shared.Tests` | 22 | The innermost layer: the `Result`/`Error`/`ErrorType` pattern, value objects (`Money`, `Email`, `Address`, `DateRange`, …) and their factory-method invariants, and DTO/paging contracts. Pure **unit** tests, no DI or DB. |
| `MMCA.Common.Domain.Tests` | 43 | The entity hierarchy (`BaseEntity`→`AuditableBaseEntity`→`AuditableAggregateRootEntity`), domain-event collection, `SetItems<T>`/`GetChildOrNotFound<T>`, specifications, and the `PiiAttribute`/anonymization seam plus the logging/telemetry redaction half of the `[Pii]` contract (masks marked members so a data subject's values never reach logs, ADR-005 / §30). Pure **unit** tests over the framework domain primitives. |
| `MMCA.Common.Application.Tests` | 147 | The CQRS engine: the decorator pipeline (FeatureGate→Logging→Caching→Validating→Transactional→handler), `ModuleLoader` topological ordering, `DomainEventDispatcher`, validation, the [`IMessageBus`](group-04-events-outbox.md#imessagebus) abstraction, entity-query-service projection/paging, the cross-source [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification) helper (ADR-018), and the notification read handlers driven by an injected `TimeProvider` test clock. The framework's largest suite; fast **unit** tests with mocked infrastructure. |
| `MMCA.Common.Infrastructure.Tests` | 157 | The widest layer: EF repositories + Unit of Work, the multi-database resolver/registry (`DataSourceResolver`, `EntityDataSourceRegistry`, `DbContextFactory`), the **outbox** processor (eligibility/smart-wait/retry), caching (`DistributedCacheService`/`MemoryCacheService`), JWT issuance + JWKS, the SignalR push + live-hub channel plumbing, the message-bus implementations, the polyglot Cosmos-config portability suite (ADR-018), and the in-repo disaster-recovery database-restore drill (seed → back up → simulate loss → restore → verify zero loss over ephemeral SQLite, a CI-gated RTO baseline, ADR-009 / §29). Mostly **unit** with EF-InMemory/SQLite seams (no real SQL Server here). |
| `MMCA.Common.API.Tests` | 65 | The presentation pipeline: `ApiControllerBase.HandleFailure` `ErrorType`→HTTP mapping, the exception-handler chain (consolidated here from the deleted per-consumer copies), the `[Idempotent]` filter + `Idempotency-Key` replay, the authenticated-only global rate limiter's partition logic (ADR-019), correlation, the JWKS endpoint, the session-cookie auth helpers, the database-initialization startup (the SQLite-`EnsureCreated`-under-`Migrate` path, ADR-018), and the error-message **localization** edge (localizes the human-readable message while leaving the machine `Code`/ProblemDetails `title` untouched and degrading to English when no localizer is present, ADR-027 / §27). **Unit** tests of middleware/filters/controllers in isolation. |
| `MMCA.Common.Grpc.Tests` | 13 | The gRPC transport seam: `Result`↔`RpcException` round-tripping, the JWT-forwarding client interceptor, and the Polly **resilience** pipeline on typed clients (retry, circuit-breaker, and fault-injection). **Unit** tests asserting ADR-007 / ADR-009 behavior. |
| `MMCA.Common.Aspire.Tests` | 10 | The hosting/observability extensions: `OutboxPollFilterProcessor` (drops recurring outbox-poll spans from telemetry export), the `SecurityHeadersMiddleware`, the startup **warm-up** gate (holds readiness closed until first-request warm-up completes so a rolling deploy never serves a cold replica, §29), and the head-based trace-sampling cost knob (a ratio in (0,1) opts in, anything else samples everything, §31). **Unit** suite over the Aspire service-defaults package. |
| `MMCA.Common.UI.Tests` | 71 | Shared Blazor components (delete-confirmation, empty-state, the mobile card/infinite-scroll lists, notification bell/inbox/list/send pages, primitives), the MudBlazor theme/provider harness, HTTP-resilience/service-exception helpers, list-page state/query-state services, the primitive markup snapshots, the auth-form view-model validation (§24), and the i18n globalization pair (the `[!!…!!]` bracket-sentinel pseudo-localizer and the `ResxMudLocalizer` MudBlazor-chrome seam, ADR-027 / §27) plus the auth-aware nav menu and its mobile top-row. Rendered with **bUnit** (component-render unit tests via [`BunitComponentTestBase`](#bunitcomponenttestbase)). |
| `MMCA.Common.UI.Web.Tests` | 4 | The Blazor Server web-host seams: `ServerTokenStorageService` (during SSR prerender tokens come from the HttpOnly session cookies; on the interactive circuit the access token is held in memory, hydrated single-flight, and refreshed proactively near expiry, while the refresh token is never readable) and `BlazorCspPolicyProvider`, which pins the enforced production Content-Security-Policy verbatim (connect-src locked to the configured API/Gateway origin, no `unsafe-eval`, permissive Report-Only degradation on an unparseable endpoint, §26). **Unit** tests. |
| `MMCA.Common.UI.E2E.Tests` | 11 | **Playwright** axe-core (WCAG 2.1 AA) + render-smoke over the backend-less **Gallery** host (real Login/Register pages, the primitives/components showcase, and the shared Notification pages against stubbed seams), plus two i18n/mobile-parity gates: a `qps-Ploc` pseudo-locale round-trip asserting the `[!!` sentinel and no horizontal overflow under ~40% text expansion (ADR-027 / §27), and the culture+theme controls pinned into the mobile top-row below 1024px (ADR-028 / §22). Deliberately outside `MMCA.Common.slnx`; runs in CI's `ui-e2e` job. **E2E/accessibility** style. `[Rubric §21, Accessibility]` (assesses automated a11y gating): this is where the framework proves zero axe violations before downstream apps consume the pages. |
| `MMCA.Common.Benchmarks` | 4 | A BenchmarkDotNet **performance-smoke** executable for the DB-free query hot path: `SpecificationBenchmarks` measures the per-instance compiled-expression cache behind [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype)`.IsSatisfiedBy` (a cached-compile baseline vs. the recompile-each-call anti-pattern) and the `And`/`Or` composition cost. Deliberately **outside `MMCA.Common.slnx`** (like the Gallery), run on demand with `dotnet run -c Release` (append `-- --job Dry` for a seconds-long correctness smoke). `[Rubric §12, Performance & Scalability]` (assesses measured, not assumed, hot-path cost): this is the evidence harness for the spec cache. **Performance-smoke** style. |

### MMCA.ADC, Conference module (the largest application module)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Conference.Shared.Tests` | 17 | Conference DTOs, requests, enums, and DTO/request mappers (the manual-mapping/Mapperly seam, ADR-001). Pure **unit** tests. |
| `MMCA.ADC.Conference.Domain.Tests` | 22 | The Conference aggregates (Event, Session, Speaker, Room, Category, Question/Answer): factory-method `Result<T>` outcomes, invariants, state transitions, and emitted domain events. **Unit** tests. |
| `MMCA.ADC.Conference.Application.Tests` | 139 | The command/query handlers for the Conference controllers, validators, navigation populators, the **Sessionize import** orchestrator + sync strategies (home of the Level-12 `RefreshFromSessionizeHandlerTests`), and the event/session live-window validation served to the live layer over gRPC ([`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterhandler) and its cross-source filter query, ADR-018). The biggest application suite in ADC; fast **unit** tests with mocked repositories/services. |
| `MMCA.ADC.Conference.Infrastructure.Tests` | 7 | Conference-specific EF configurations, repositories, and output-cache invalidation tags. Small **unit** suite. |
| `MMCA.ADC.Conference.API.Tests` | 15 | Conference REST controllers, authorization filters, and output-cache policies in isolation. **Unit** tests of the API layer. |
| `MMCA.ADC.Conference.UI.Tests` | 25 | Conference Blazor pages: the public event/session/speaker detail pages, the management CRUD forms (event/session/speaker/room/category/question create + list), and management-route authorization, rendered with **bUnit** (`BunitTestBase` over the shared [`BunitComponentTestBase`](#bunitcomponenttestbase)). **Component** tests. |
| `MMCA.ADC.Conference.IntegrationTests` | 36 | Boots the **Conference service host** via `WebApplicationFactory<Program>` (gRPC peers faked, JWT re-pointed at an in-process test key) and drives real HTTP per role (Anonymous/Attendee/Speaker/Organizer), plus OpenAPI contract-snapshot, API-versioning, optimistic-concurrency, soft-delete + audit-stamp fidelity, idempotency replay, output-cache eviction, the `includeChildren` regression, and the in-process `CrossServiceUserRegisteredTests` (the Identity→Conference `UserRegistered` auto-link handler). **Integration** style; needs a real SQL Server (`ADC_TEST_SQL_BASE`), runs in the deploy-gating `integration-tests` CI job. |

### MMCA.ADC, Engagement module (bookmarks, feedback, and the conference-day live layer)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Engagement.Shared.Tests` | 2 | Bookmark/feedback/live DTOs, requests, and mappers. **Unit**. |
| `MMCA.ADC.Engagement.Domain.Tests` | 6 | The `UserSessionBookmark`, event/session feedback, and conference-day live-layer aggregates (`LivePoll` + `SessionQuestion`): factory `Result<T>` outcomes, invariants, and domain events. **Unit**. |
| `MMCA.ADC.Engagement.Application.Tests` | 27 | Bookmark, feedback, and live-layer (poll / session-question) add/remove/query handlers and validators, including the cross-module `ISessionBookmarkValidationService` / `IBookmarkCountService` / `IEventLiveValidationService` gRPC seams (stubbed) and the best-effort `ILiveChannelPublisher` ingress. **Unit**. |
| `MMCA.ADC.Engagement.Infrastructure.Tests` | 2 | Engagement EF config + repository. **Unit**. |
| `MMCA.ADC.Engagement.API.Tests` | 6 | The Bookmarks/Feedback/Live REST controllers in isolation. **Unit**. |
| `MMCA.ADC.Engagement.UI.Tests` | 14 | Engagement Blazor renders: the bookmark UI, the session/event feedback pages, and the conference-day live/presenter surfaces (Happening Now, live poll, session Q&A). **Component** (bUnit). |
| `MMCA.ADC.Engagement.IntegrationTests` | 13 | Boots the **Engagement service host** via `WebApplicationFactory<Program>` and exercises the bookmark/feedback/live workflows + authorization over real HTTP. **Integration**; real SQL Server, deploy-gating CI job. |

### MMCA.ADC, Identity module (User aggregate + JWT/JWKS + external OAuth)

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Identity.Shared.Tests` | 3 | Identity DTOs/requests and mappers (`User`, roles, `LinkedSpeakerId`). **Unit**. |
| `MMCA.ADC.Identity.Domain.Tests` | 4 | The `User`/`UserRole` aggregate factories, invariants, and speaker-linking domain events. **Unit**. |
| `MMCA.ADC.Identity.Application.Tests` | 20 | Registration/login/profile/role/preferences handlers and validators, the external-OAuth (Google/GitHub) exchange, and the `SpeakerLinkedToUser`/`SpeakerUnlinkedFromUser` integration-event handlers. **Unit**. |
| `MMCA.ADC.Identity.Infrastructure.Tests` | 4 | Identity EF config/repository, RS256 token issuance, and the JWKS provider. **Unit**. |
| `MMCA.ADC.Identity.API.Tests` | 7 | The Auth REST controller, the JWKS endpoint, and identity middleware in isolation. **Unit**. |
| `MMCA.ADC.Identity.UI.Tests` | 6 | Identity Blazor pages (login/register/profile/user-management) rendered with **bUnit**. **Component**. |
| `MMCA.ADC.Identity.IntegrationTests` | 28 | Boots the **Identity service host** via `WebApplicationFactory<Program>` and drives the full auth surface: registration, login, claims, profile, user preferences, soft-deleted-user handling, the external-OAuth challenge/exchange, GDPR user export, and JWKS discovery, over real HTTP, plus the in-process `CrossServiceSpeakerLinkTests` (the Conference→Identity speaker link/unlink handler). **Integration**; real SQL Server, deploy-gating CI job. |

### MMCA.ADC, host, cross-service, notification, and end-to-end suites

| Test project (assembly) | Types | What it covers · style |
|--------------------------|-------|------------------------|
| `MMCA.ADC.Gateway.Tests` | 3 | Boots the real **YARP Gateway** host in-process (`GatewayApplicationFactory`, pinned to `Production` so HSTS and the realistic non-development CORS branch run) and asserts two operational guarantees: every response carries the hardened security response headers on `/alive` (§26) and the host **shuts down gracefully** within its bounded stop timeout, firing `ApplicationStopping`/`ApplicationStopped` (§29). The Gateway is a pure reverse proxy (no DbContext/broker) so the boot needs no SQL. **Integration** style. |
| `MMCA.ADC.Notification.IntegrationTests` | 7 | Boots the **Notification service host** via `WebApplicationFactory<Program>` (the Identity recipient-lookup gRPC client faked by `FakeAttendeeQueryService`) and exercises the push-notification REST endpoints + inbox (`NotificationsController`/`InboxController` from `MMCA.Common.API`) and the real-time SignalR `NotificationHub`: a live `HubConnection` asserts authenticated connect, anonymous rejection (the hub carries `[Authorize]`), and a POST-triggered broadcast reaching the connected recipient. **Integration**; real SQL Server (`ADC_TEST_SQL_BASE`), deploy-gating CI job. |
| `MMCA.ADC.CrossService.IntegrationTests` | 12 | The **real-broker + real-gRPC** tier: boots all three REST hosts (Identity/Conference/Engagement) in one process against a **Testcontainers** SQL Server and a **Testcontainers** RabbitMQ, so the genuine MassTransit outbox → broker → consumer round-trip (`UserRegistered` auto-link, `SpeakerLinked`/`SpeakerUnlinked` back-link) and the real Conference → Engagement bookmark-count gRPC read run end to end, over a sequential env-boot fixture and a smoke gate that fails first if the container/host wiring is wrong. **Integration** style; needs **Docker**, runs in the non-gating nightly cross-service CI job (not in `Integration.slnf`). |
| `MMCA.ADC.E2E.Tests` | 60 | **Playwright** end-to-end against the running Aspire stack, using a Page-Object model (`PageObjects/`) and `E2ETestBase` login helpers, organized by actor workflow (Organizer/Speaker/Attendee/Identity/Preferences) plus the Engagement live-poll and feedback flows, real-time notification push, a Web-Vitals budget check, and an `AccessibilityTests` axe sweep. Runs once per engine via `E2E_BROWSER` (chromium/firefox/webkit). The largest single project here and the source of most of the chapter's recorded E2E debugging history. `[Rubric §28, Front-End Testing]` + `[Rubric §22, Responsive/Cross-Browser]`: this suite is the cross-browser, real-user-flow safety net. **E2E** style. |

**Reconciliation.** Common: 22+43+147+157+65+13+10+71+4+11+4 = **547**. ADC Conference: 17+22+139+7+15+25+36 = **261**.
ADC Engagement: 2+6+27+2+6+14+13 = **70**. ADC Identity: 3+4+20+4+7+6+28 = **72**.
ADC host/cross-service/notification/E2E: 3+7+12+60 = **82**. **Total = 547+261+70+72+82 = 1,032**, across **36 projects**,
matching the unit input exactly.


---
[⬅ Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)](group-26-device-capability-layer.md)  •  [Index](00-index.md)  •  [Coverage audit ➡](99-coverage-audit.md)
