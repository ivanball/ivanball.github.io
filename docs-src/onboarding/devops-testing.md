# Testing Architecture & Solution Composition

> **Chapter scope note.** The tier chapters (`tier-00` through the sweep) document every type
> in the production codebase one by one. Test types are the logged exception: this chapter covers
> the ~784 types that live in test projects, grouped by project purpose and foundational
> infrastructure, not written as one section per `[Fact]`. Individual test methods are cited only
> as worked examples. Cross-reference the tier chapters for the production types being tested.

This chapter teaches the complete testing architecture of the MMCA workspace: how the solutions are
sliced, which CI filter sees which tests, how Microsoft Testing Platform differs from VSTest, the
shipped testing-infrastructure NuGet packages, the NetArchTest fitness-function suites that act
as executable governance, the integration and E2E strategies, and three worked examples that tie
the pieces together.

---

## 1. Solution composition and the test runner

### Solution files: slnx vs. slnf

Both repos use the same two-file pattern:

| File | Purpose |
|---|---|
| `MMCA.Common.slnx` | Full human solution, all source + most test projects |
| `MMCA.ADC.slnx` | Full human solution, all source + all in-scope test projects |
| `MMCA.ADC.CI.slnf` | CI fast path, source + unit/arch/WebAPI tests only (excludes Integration, E2E, AppHost, MAUI) |
| `MMCA.ADC.Integration.slnf` | SQL-gated integration tests only |
| `MMCA.Store.CI.slnf` | Store CI fast path, mirrors the ADC pattern |

`MMCA.ADC.CI.slnf` (`MMCA.ADC/MMCA.ADC.CI.slnf`) includes every source project and every
unit/architecture/WebAPI test project, but deliberately excludes:

- `Tests/Integration/MMCA.ADC.Identity.IntegrationTests`
- `Tests/Integration/MMCA.ADC.Conference.IntegrationTests`
- `Tests/Integration/MMCA.ADC.Engagement.IntegrationTests`
- `Tests/E2E/MMCA.ADC.E2E.Tests`
- The Aspire `AppHost` and MAUI UI projects

Why: the integration tests need a real SQL Server (the `ADC_TEST_SQL_BASE` connection string points
to a CI SQL service container), and the E2E tests need the full Aspire stack running. Neither is
available in the fast build job, so they are deliberately gated behind a second CI job
(`integration-tests`) that provisions SQL. That job gates the `deploy` job, the full integration
suite (~290 tests across the three per-service projects) must pass before any code ships.
[Rubric §17, DevOps & Deployment]: §17 assesses how consistently CI/CD enforces quality gates;
the two-filter pattern is how the build stays fast on every push while the SQL-dependent gate still
blocks deployment.

`MMCA.ADC.Integration.slnf` (`MMCA.ADC/MMCA.ADC.Integration.slnf`) contains exactly three
projects (`MMCA.ADC.Identity.IntegrationTests`, `MMCA.ADC.Conference.IntegrationTests`,
`MMCA.ADC.Engagement.IntegrationTests`), these are the per-service `WebApplicationFactory`
integration tests that replaced the now-retired combined `MMCA.ADC.IntegrationTests` project.
The old project (`Tests/Integration/MMCA.ADC.IntegrationTests`) is still on disk but is excluded
from `MMCA.ADC.slnx` because it referenced the deleted `MMCA.ADC.WebAPI` host; its 34 types are
being re-homed onto the per-service projects.

`MMCA.Common.slnx` (`MMCA.Common/MMCA.Common.slnx`) includes all thirteen source packages, the four
Core (`.Shared`, `.Domain`, `.Application`, `.Infrastructure`), three Presentation (`.API`, `.Grpc`,
`.UI`), two Aspire (`.Aspire`, `.Aspire.Hosting`), and four Testing (`.Testing`, `.Testing.Architecture`,
`.Testing.E2E`, `.Testing.UI`), plus nine test projects. Two projects are **intentionally absent from
the `.slnx`**:

- `Tests/Presentation/MMCA.Common.UI.Gallery`, a backend-less Blazor host that renders the real
  `LoginPage`, `RegisterPage`, and a UI-primitives showcase; it exists solely to give Playwright
  something to hit.
- `Tests/Presentation/MMCA.Common.UI.E2E.Tests`, the axe-core + render-smoke suite that hits
  the Gallery.

Both are excluded so `dotnet test --solution MMCA.Common.slnx` stays fast (no browser, no
network). They run in the dedicated `ui-e2e` CI job, built by csproj path:
`dotnet test --project Tests/Presentation/MMCA.Common.UI.E2E.Tests/MMCA.Common.UI.E2E.Tests.csproj`.
[Rubric §28, Front-End Testing & Quality]: §28 assesses whether UI components have automated
tests; the Gallery + E2E split is the mechanism that adds browser-level coverage without slowing
the primary test loop.

### Microsoft Testing Platform (MTP), not VSTest

All three repos share one `global.json` structure:

```json
{
  "test": {
    "runner": "Microsoft.Testing.Platform"
  }
}
```

(`MMCA.Common/global.json:1-5`, identical in `MMCA.ADC/global.json` and `MMCA.Store/global.json`)

This selects **MTP** as the test runner instead of the legacy VSTest runner. The practical
consequences:

1. **Exit code 8**, if a test project discovers zero tests MTP exits 8, not 0. Every CI
   `dotnet test` call includes `--minimum-expected-tests 1` to surface this as a visible failure
   rather than a silent skip (see `MMCA.Common/CLAUDE.md`).

2. **Filter syntax differs.** You pass a `--` separator and then MTP's own filter flags:
   ```bash
   # Run a single test class
   dotnet test --project Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests \
     -- -class "*UserTests*"

   # Run a single test method
   dotnet test --project Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests \
     -- -method "*Create_WithValidData_ReturnsSuccess*"
   ```
   The flags are `-class` and `-method`, not the VSTest `--filter FullyQualifiedName~...` form.
   Always target `--project <csproj>`, never a bare directory path.

3. **Running compiled test binaries directly.** Because the headless CI environment has no
   reachable SQL, integration tests build but cannot be run-verified via `dotnet test`. The
   workaround is to run the compiled `.Tests.exe` directly for unit tests:
   `./bin/Release/net10.0/MMCA.Common.Shared.Tests.exe`, the MTP binary is self-contained.
   [Rubric §33, Developer Experience & Inner Loop]: §33 assesses the friction of the local
   development cycle; MTP's self-hosted test binaries and the explicit `--minimum-expected-tests`
   guard both reduce "tests silently went away" surprises.

---

## 2. Test project layout

The inventory below is drawn from `00-inventory.md` (test-assembly counts) and the solution files
above. Counts are distinct types per project as reported by the Roslyn inventory scan.

### MMCA.Common, 391 test types across 9 in-solution projects + 2 out-of-solution

**Unit, Core layer**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Shared.Tests` | 18 | Unit tests for the Result pattern, `Error`, `ErrorType`, value objects, DTO contracts |
| `MMCA.Common.Domain.Tests` | 40 | Unit tests for entity hierarchy, aggregate root, domain events, specifications, soft-delete |
| `MMCA.Common.Application.Tests` | 130 | Unit tests for CQRS dispatcher, decorator pipeline, module loader, `IMessageBus`, validators |
| `MMCA.Common.Infrastructure.Tests` | 133 | Unit/integration tests for EF base contexts, outbox processor, repository, caching, JWT generation, JWKS provider, data-source resolver |

**Unit, Presentation layer**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.API.Tests` | 33 | Tests for `ApiControllerBase`, exception handlers, idempotency filter, middleware, JWKS endpoint |
| `MMCA.Common.Grpc.Tests` | 3 | Tests for `GrpcResultExceptionInterceptor`, `JwtForwardingClientInterceptor`, Result↔RpcException mapping |
| `MMCA.Common.UI.Tests` | 13 | bUnit component tests for shared Blazor components (login/register forms, nav, theming) |

**Hosting**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Aspire.Tests` | 4 | Tests for `AddServiceDefaults`, health-check registration, `OutboxPollFilterProcessor` telemetry suppression |

**Architecture**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Architecture.Tests` | 8 | NetArchTest layer dependency, domain purity, microservice extraction, PII/`IAnonymizable`, aggregate factory, MassTransit v8 pin |

**Out-of-solution (UI/E2E, run via dedicated CI job)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.UI.Gallery` | 6 | Backend-less Blazor host; renders real Login/Register pages + primitives showcase for Playwright to hit |
| `MMCA.Common.UI.E2E.Tests` | 7 | Playwright axe-core accessibility scans + render smoke against the Gallery; asserts WCAG 2.1 AA |

### MMCA.ADC, 393 test types across 22 in-solution projects (E2E in slnx but not slnf)

**Unit, per-module, per-layer (Identity module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Identity.Domain.Tests` | 4 | `User` aggregate factory methods, invariants, soft-delete |
| `MMCA.ADC.Identity.Application.Tests` | 14 | Command/query handler tests for register, login, profile management |
| `MMCA.ADC.Identity.Shared.Tests` | 3 | DTO/enum tests |
| `MMCA.ADC.Identity.API.Tests` | 6 | Controller helper tests, rate-limit bypass |
| `MMCA.ADC.Identity.Infrastructure.Tests` | 4 | Token service, JWKS provider, EF configuration |
| `MMCA.ADC.Identity.UI.Tests` | 5 | bUnit tests for `Profile`, login route authorization |

**Unit, per-module, per-layer (Conference module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Conference.Domain.Tests` | 14 | Event/Session/Speaker aggregate factory, invariants, domain events |
| `MMCA.ADC.Conference.Application.Tests` | 120 | Handler tests for all 14 Conference controllers' use cases (bulk) |
| `MMCA.ADC.Conference.Shared.Tests` | 13 | DTO validation, enum coverage |
| `MMCA.ADC.Conference.API.Tests` | 13 | Controller registration, route tests |
| `MMCA.ADC.Conference.Infrastructure.Tests` | 5 | EF configuration, repository behavior |
| `MMCA.ADC.Conference.UI.Tests` | 7 | bUnit tests for session/speaker card components |

**Unit, per-module, per-layer (Engagement module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Engagement.Domain.Tests` | 2 | Bookmark aggregate |
| `MMCA.ADC.Engagement.Application.Tests` | 8 | Bookmark command/query handlers |
| `MMCA.ADC.Engagement.Shared.Tests` | 2 | DTO tests |
| `MMCA.ADC.Engagement.API.Tests` | 2 | Controller surface |
| `MMCA.ADC.Engagement.Infrastructure.Tests` | 2 | EF config |

**Architecture**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Architecture.Tests` | 15 | NetArchTest layer dependency, module isolation, domain purity, microservice extraction/transport, PII/`IAnonymizable`, naming conventions, entity conventions, handler conventions, concurrency, DTO placement, controller conventions, integration-event contracts |

**Integration (per-service WebApplicationFactory, in `MMCA.ADC.Integration.slnf` only)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Identity.IntegrationTests` | 14 | Full HTTP tests of the Identity service host against real SQL Server; auth flows, attendee/organizer access, outbox fidelity |
| `MMCA.ADC.Conference.IntegrationTests` | 25 | Full HTTP tests of the Conference service host |
| `MMCA.ADC.Engagement.IntegrationTests` | 7 | Full HTTP tests of the Engagement service host |

**WebAPI middleware**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.WebAPI.Tests` | 1 | Host-neutral unit tests for `MMCA.Common.API` exception handlers |

**E2E (in `MMCA.ADC.slnx` but excluded from both `.slnf` filters)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.E2E.Tests` | 49 | Playwright browser-automation tests across login, register, conference browsing, bookmark flows; requires Aspire stack running |

**Out-of-scope (not in slnx)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.IntegrationTests` | 34 | Legacy combined integration tests (referenced deleted `MMCA.ADC.WebAPI` host); excluded, being re-homed |

### MMCA.Common test-type totals

Summing the 9 in-solution projects: 18 + 40 + 130 + 133 + 33 + 3 + 13 + 4 + 8 = **382** plus
the 2 out-of-solution projects adding 6 + 7 = **395 total** (inventory shows 391 in-solution,
minor rounding from the scan).

### MMCA.ADC test-type totals

Summing the in-scope ADC projects: 4+14+3+6+4+5 + 14+120+13+13+5+7 + 2+8+2+2+2 + 15 + 14+25+7 +
1 + 49 = **334** (inventory shows 393 counting the out-of-slnx `MMCA.ADC.IntegrationTests`).

**Combined test-type count reconciliation:**
The inventory lists 784 total test/testing types when all test projects and the shipped
infrastructure packages (the four testing packages, `MMCA.Common.Testing`, `.Testing.E2E`,
`.Testing.UI`, `.Testing.Architecture`; e.g. `MMCA.Common.Testing` = 5, `MMCA.Common.Testing.E2E` = 15)
are summed. The breakdown: ~391 MMCA.Common test/testing types + ~393 MMCA.ADC test types = 784.

[Rubric §14, Testability & Test Strategy]: §14 assesses the breadth and meaningfulness of the
test suite across all layers; the project layout above, unit per layer, arch per repo,
integration per service, E2E for browser flows, demonstrates deliberate stratification rather
than a single catch-all integration tier.

---

## 3. Shipped testing-infrastructure packages

MMCA.Common ships **four** testing-infrastructure packages that downstream apps consume as NuGet
references rather than writing their own harness infrastructure:

- `MMCA.Common.Testing`, integration-test base, JWT generator, fixtures, entity builders (this section).
- `MMCA.Common.Testing.E2E`, Playwright fixtures, Blazor nav helpers, Identity page objects, axe-core
  enforcement (this section).
- `MMCA.Common.Testing.UI`, bUnit component-test base + MudBlazor provider harness (used by the
  per-module `*.UI.Tests` projects; see the bUnit worked example in §6).
- `MMCA.Common.Testing.Architecture`, the shared NetArchTest fitness-function rule library + abstract
  test bases (the 13th framework package; covered in §4, where each repo's `*.Architecture.Tests` consumes
  it).

### MMCA.Common.Testing

`MMCA.Common/Source/Hosting/MMCA.Common.Testing/`, 5 types, shipped as `MMCA.Common.Testing`.

#### `IIntegrationTestFixture`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IIntegrationTestFixture.cs:1`

The shared contract between a `WebApplicationFactory` fixture and `IntegrationTestBase<TFixture>`.
Two members: `CreateClient()` returns an `HttpClient` configured for the test server, and
`ResetDatabaseAsync()` resets the database between tests. The doc comment (`IIntegrationTestFixture.cs:16-20`)
explicitly notes that fixtures for database-per-service hosts must reset **every** relational source
by enumerating `IEntityDataSourceRegistry` and `IDataSourceResolver`, this is the
database-per-microservice (ADR-006) implication for test cleanup. Each concrete fixture implements
this by opening a per-source `SqlConnection` and calling `Respawner.ResetAsync`.

#### `IntegrationTestBase<TFixture>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:13`

The abstract base class all integration test classes inherit from. Generic on `TFixture :
IIntegrationTestFixture`. Implements xUnit v3's `IAsyncLifetime`:

- `InitializeAsync()` calls `Fixture.ResetDatabaseAsync()` before each test, so tests always start
  from a clean database state (line 31).
- `DisposeAsync()` disposes the test `HttpClient` after each test (line 33-38).
- `SetBearerToken(string token)` writes a `Bearer` `Authorization` header onto `Client`
  (line 43-44).
- `ClearAuthentication()` removes it (line 47-48).
- `GetAsync<T>`, `PostAsync<T>`, `PutAsync<T>`, `PutAsync` (no body), `DeleteAsync`, typed HTTP
  helpers (lines 51-75).
- `NextId()`, thread-safe `Interlocked.Increment` over a static counter starting at 1000,
  giving tests unique integer IDs without collisions under parallel execution (line 75).

Downstream projects extend this by adding role helpers. For example,
`IdentityIntegrationTestBase` (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:13`)
adds `AuthenticateAsOrganizer(userId)`, `AuthenticateAsAttendee(userId)`, and
`AuthenticateAsSpeaker(userId, speakerId)`, each calls `SetBearerToken(JwtTokenGenerator.GenerateToken(...))`.

#### `JwtTokenGenerator`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:29`

A static class that mints RS256 JWT tokens for test consumption. Key design decisions visible in
the source:

- **RS256 matches production.** The generator uses `RSA.Create()` + `ImportFromPem` + `RsaSecurityKey`
  (lines 122-129), matching the algorithm configured by `AddCommonAuthentication` in the real host.
  Integration tests therefore exercise the actual JWKS/RS256 validation path, not a relaxed HMAC
  shortcut. [Rubric §11, Security]: §11 assesses how well the test suite validates the security
  model; using the same algorithm in tests as in production is a direct embodiment.
- **Committed keypair, documented as insecure.** `DefaultPublicKeyPem` and `DefaultPrivateKeyPem`
  (lines 48-95) are embedded in the source and committed to the public repo. The class doc
  (lines 21-27) explicitly warns: "⚠ Security note: the embedded RSA keypair is committed to the
  public git repo and is therefore insecure by design, it exists solely to make integration tests
  deterministic without a per-run key-generation step. Never configure a production deployment
  with this keypair."
- **`DefaultKeyId = "mmca-test-key"`** (line 40), the `kid` claim that test host appsettings
  expose via `Jwks:KeyId`, so `RsaJwksProvider` publishes a JWKS entry with the same `kid` and
  the middleware's key resolution succeeds.
- `GenerateToken(audience, userId, role, additionalClaims?, privateKeyPem?, issuer?, keyId?)`
  (line 111) exports the RSA parameters before disposal (line 124), creates `RsaSecurityKey`,
  and writes the `sub` / `user_id` / `role` claims to match the shape `ITokenService` produces
  in production (lines 131-137).

#### `EntityBuilderBase<TBuilder, TEntity>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9`

A fluent-builder generic base for test entity construction. Subclasses configure sensible defaults
(so tests only set the property under test) and implement `Build()`, which calls the domain factory
method and throws on a `Failure` result. This keeps test arrange code readable without exposing
EF's parameterless constructor. [Rubric §14, Testability]: builder patterns are a classic
indicator of testability investment; the shared base means every downstream module gets fluent
builders "for free" by subclassing.

#### `FeatureManagementTestExtensions`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:12`

A static extension on `IServiceCollection` (`ConfigureTestFeatureFlags(Dictionary<string, bool>)`,
line 21) that injects an in-memory `IConfiguration` and registers `AddFeatureManagement` against
it. Call this in a `WebApplicationFactory.ConfigureServices` override to override feature flags
from `appsettings.json`. Allows integration tests to exercise both the flag-on and flag-off code
paths without changing the real config file.

### MMCA.Common.Testing.E2E

`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/`, 15 types, shipped as
`MMCA.Common.Testing.E2E`. [Rubric §28, Front-End Testing & Quality]: §28 assesses whether UI
components have browser-level automated coverage; this package is the shared foundation for that
coverage.

#### `E2ETestConfiguration`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8`

All E2E configuration is environment-variable driven. Properties:

| Variable | Default | Effect |
|---|---|---|
| `E2E_BASE_URL` | `https://localhost:7108` | Target app URL (overridden per downstream project) |
| `E2E_HEADLESS` | `true` (absent = headless) | Set `false` to watch tests visually |
| `E2E_TIMEOUT` | `30_000` ms | Per-action Playwright timeout |
| `E2E_SLOWMO` | `0` ms | Delay between Playwright actions (for visual debugging) |
| `E2E_BROWSER` | `chromium` | Engine: `chromium`, `firefox`, or `webkit` |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | `admin@localhost` / `Admin123!` | Seeded admin credentials |
| `E2E_CUSTOMER_EMAIL` / `E2E_CUSTOMER_PASSWORD` | `user@localhost` / `User123!` | Seeded user credentials |

Downstream projects supply app-specific defaults via `[ModuleInitializer]` on the `Default*`
setters. Environment variables always take precedence. [Rubric §22, Responsive & Cross-Browser]:
`E2E_BROWSER` is the mechanism for running the same suite against all three browser engines in CI.

#### `PlaywrightFixture` + `E2ETestCollection`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6`

`PlaywrightFixture` is an xUnit v3 `IAsyncLifetime` collection fixture. `InitializeAsync()` (line 12)
creates a `IPlaywright` instance, then resolves the browser type from `E2ETestConfiguration.Browser`
via a switch on the upper-cased value (lines 17-22): `"FIREFOX"` → `Playwright.Firefox`,
`"WEBKIT"` → `Playwright.Webkit`, any other value → `Playwright.Chromium`. The comment on line 21
calls out the rubric §22 cross-browser intent explicitly. `DisposeAsync` (line 26) disposes browser
and playwright in order. `E2ETestCollection` is the xUnit `[CollectionDefinition]` that wires the
fixture to all classes decorated with `[Collection(E2ETestCollection.Name)]`.

#### `E2ETestBase`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:7`

The abstract base all E2E test classes inherit from. Decorates itself `[Collection(E2ETestCollection.Name)]`
so it receives the `PlaywrightFixture` singleton. `InitializeAsync()` (line 18) creates a fresh
`IBrowserContext` (with `IgnoreHTTPSErrors: true` for local dev TLS) and a new `IPage` per test,
setting `DefaultTimeout` from config. `DisposeAsync()` (line 27) closes the page and disposes
the context, guaranteeing test isolation at the browser-session level.

Key methods:

- `LoginAsync(email, password)` (line 43), navigates to `/login`, fills email and password via
  `FillFieldAsync` (guarded against Blazor re-hydration), clicks the "Sign in" button, then races
  the logout button against an error alert using `Task.WhenAny` (line 72). If the error alert wins,
  throws `InvalidOperationException` with the alert text, tests get a meaningful failure message
  rather than a timeout.
- `LoginAsAdminAsync()` / `LoginAsUserAsync()`, delegate to `LoginAsync` with credentials from
  `E2ETestConfiguration`.
- `RegisterNewUserAsync(firstName?, lastName?)` (line 86), synthesizes a unique email with
  `Guid.NewGuid().ToString("N")[..8]`, fills the registration form, submits, and races the same
  logout-button / error-alert pair for completion.
- `FillFieldAsync(ILocator, string)` (line 136), delegates to `PageExtensions.FillAndVerifyAsync`,
  the shared Blazor re-hydration guard (see below).
- `UniqueId()` (line 139), eight-char GUID fragment for unique test data.

#### `PageExtensions`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:13`

Extension methods on `IPage` and `ILocator` that isolate Blazor InteractiveAuto rendering quirks:

- `WaitForBlazorAsync(page, timeout)` (line 19), polls `window.Blazor?._internal` until truthy
  (the WASM runtime is ready), then evaluates two `requestAnimationFrame` + 500ms to let the
  render pipeline flush. Without this, event handlers are not attached and clicks/fills are
  silently ignored.
- `GotoAndWaitForBlazorAsync(page, path)` (line 37), combines `GotoAsync` + `WaitForLoadStateAsync(Load)`
  (not `NetworkIdle`, Blazor's SignalR WebSocket keeps a persistent connection open, so
  `NetworkIdle` is never reached) + `WaitForBlazorAsync`.
- `BlazorNavigateAsync(page, path)` (line 49), uses `Blazor.navigateTo` for client-side SPA
  navigation (avoids a full page reload), then waits for `window.location.pathname` to change
  and the render cycle to flush. Used for auth-protected pages when already logged in.
- `WaitForPageAndBlazorAsync(page)` (line 71), waits for `Load` state + render flush; use
  after link/button clicks that trigger full-page navigation.
- `FillAndVerifyAsync(field, value, timeout)` (line 91), fills a form field then asserts
  `ToHaveValueAsync` with Playwright's built-in retry. If the pre-render value was wiped by
  re-hydration (a common Blazor InteractiveAuto timing bug), it falls back to `PressSequentiallyAsync`
  with 20ms key delay and re-asserts. This is the single shared fill helper for the whole E2E layer.
- `AssertNoAccessibilityViolationsAsync(page, options?)` (line 118), runs `page.RunAxe()` from
  `Deque.AxeCore.Playwright`, collects violations, and throws `AccessibilityViolationException`
  if any are found. The exception message includes impact, rule ID, help text, and node count per
  violation. [Rubric §21, Accessibility]: §21 assesses whether the app meets WCAG 2.1 AA; this
  extension method is the single enforcement point.

#### `AccessibilityViolationException`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs`

A typed exception thrown by `AssertNoAccessibilityViolationsAsync`. Giving axe-core violations
their own exception type means test runners display the violation summary in the failure message
without requiring the test author to parse raw JSON.

#### Page objects: `LoginPage`, `RegisterPage`, `ProfilePage`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/PageObjects/`

Pre-built page-object models for the three Identity pages that every downstream app shares.
`LoginPage` and `RegisterPage` encapsulate form locators and the fill/submit sequence; they use
`FillAndVerifyAsync` internally. `ProfilePage` exposes profile-field locators and the "Change
Password" / "Delete Account" button locators. Downstream projects extend by composition or
inheritance.

#### Workflow base classes: `UserLoginTestsBase`, `UserRegistrationTestsBase`, `ProfileManagementTestsBase`, `LogoutTestsBase`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/Identity/`

Abstract test bases for the four standard Identity workflows. Each extends `E2ETestBase`, provides
concrete `[Fact]` methods that apply to any app using `MMCA.Common`'s Identity UI, and calls
`AssertNoAccessibilityViolationsAsync` after the page is interactive. A downstream app's E2E suite
inherits from these bases and optionally overrides or adds app-specific assertions.
[Rubric §21, Accessibility]: axe-core is called at the workflow level, not just on the page
object, so new flows inherit the a11y check without extra work.

---

## 4. Architecture fitness tests, executable governance

[Rubric §34, Architecture Governance & Documentation]: §34 assesses whether architectural
decisions are documented, enforced, and kept honest over time; fitness functions are the "enforced"
axis. [Rubric §3, Clean Architecture]: §3 assesses whether the layering is real (code can't
reference upward) or aspirational (rules stated in a README but never enforced). The architecture
tests make the rules real.

The primer explains (`00-primer.md#architecture-enforcement-is-doubled-fitness-functions`) that
layer rules are enforced **twice**: at compile-time (the MSBuild `.targets` file) and at runtime
(NetArchTest). This section covers the runtime half.

### NetArchTest.eNhancedEdition, the mechanism

NetArchTest works on compiled assemblies, not source. It loads an `Assembly` and applies
`Types.InAssembly(assembly).ShouldNot().HaveDependencyOnAny(namespacePrefix).GetResult()`.
`GetResult()` returns a `TestResult` with a `IsSuccessful` flag and a list of failing type names.
The shared `ArchitectureAssert.NoViolations(result, reason)` method converts a failure
into an xUnit assertion failure whose message includes the reason string and the offending type
names, so a developer adding a forbidden reference sees exactly which type broke the rule and why.

**The rule bodies live once, in a shipped package.** The 13th framework package,
`MMCA.Common.Testing.Architecture`, holds the reusable rule library (`ArchitectureRules.*` partial
classes, `Layers`, `Purity`, `Transport`, `Modules`, `Handlers`, `Entities`, `Naming`, etc.) and a set
of abstract `*TestsBase` classes (one per rule family, in `Bases/`), all parameterized by an
`IArchitectureMap`. Each repo's `*.Architecture.Tests` project consumes the package and supplies its own
map: `CommonArchitectureMap` (MMCA.Common, every layer is a framework layer, one anchor type per package)
and `AdcArchitectureMap` (MMCA.ADC, adds the per-module Identity/Conference/Engagement layers). A
concrete test class is then a ~10-line sealed subclass, e.g.:

```csharp
public sealed class LayerDependencyTests : LayerDependencyTestsBase
{
    protected override IArchitectureMap Map { get; } = new CommonArchitectureMap();
}
```

(`MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9-12`). The map's anchor types
(`CommonArchitectureMap.cs:15-21`, e.g. `typeof(Common.Domain.Entities.BaseEntity<>).Assembly`) mean the
assembly path is always the one actually compiled into the test run, not a hard-coded path. Because both
repos drive the same rule bodies, the architecture rules stay identical across all three repos and a
fix to a rule propagates with the next package bump rather than needing a hand-copy.

The walkthroughs below describe **what each rule enforces** (and the count of facts/theories it produces);
the rule *implementations* now live in the shared package's `ArchitectureRules.*` + `*TestsBase` files,
not in the per-repo test class.

### MMCA.Common.Architecture.Tests, 8 types

Located at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/`. The 8 are thin subclasses:
`LayerDependencyTests`, `DomainPurityTests`, `MicroserviceExtractionTests`, `PiiConventionTests`,
`AggregateConventionTests`, `DependencyVersionTests`, `EventVersioningConventionTests`, and
`FrameworkSanityTests` (the last holds the Common-only checks the shared library does not generalize).

#### `LayerDependencyTests`
`MMCA.Common.Architecture.Tests/LayerDependencyTests.cs`

13 `[Fact]` methods, one per forbidden directed edge in the layer graph:

- `Shared_ShouldNotDependOn_Domain/Application/Infrastructure/Api` (4 facts)
- `Domain_ShouldNotDependOn_Application/Infrastructure/Api` (3 facts)
- `Application_ShouldNotDependOn_Infrastructure/Api` (2 facts)
- `Infrastructure_ShouldNotDependOn_Api` (1 fact)
- `UI_ShouldNotDependOn_Application/Infrastructure/Domain` (3 facts)

The last three confirm the two deliberate exceptions to the standard stack (`UI` and `Grpc` depend
only on `Shared`) are honored in the other direction, `UI` must not depend on Application,
Infrastructure, or Domain.

#### `DomainPurityTests`
`MMCA.Common.Architecture.Tests/DomainPurityTests.cs`

4 facts asserting that Domain and Shared contain no references to:
`Microsoft.AspNetCore`, `Microsoft.EntityFrameworkCore`, `Serilog`, `AutoMapper`,
`Newtonsoft.Json`, `FluentValidation`, `Scrutor`, `MudBlazor`, `Polly`, `Stripe`,
`StackExchange.Redis` (the forbidden-dependency list now lives in the shared
`ArchitectureRules.Purity` partial in `MMCA.Common.Testing.Architecture`).
Application additionally must not depend on `Microsoft.EntityFrameworkCore` or `Microsoft.AspNetCore`.
[Rubric §3, Clean Architecture]: this is the runtime enforcement that the domain is genuinely
framework-independent, not just convention.

#### `MicroserviceExtractionTests`
`MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs`

Enforces the transport-isolation invariant for microservice extraction (ADR-007/ADR-008):
`Application`, `Domain`, and `Shared` must not reference `MassTransit`; transport (gRPC / MassTransit)
belongs only in Infrastructure and the transport-edge packages. The rule body is the shared
`MicroserviceExtractionTestsBase` over `CommonArchitectureMap`.

The Common-only sanity checks that the shared library does not generalize, `Grpc` must not depend on
`Domain`/`Application`/`Infrastructure`, `IMessageBus` lives in `Application`, and `IJwksProvider` lives
in `Infrastructure`, now live in **`FrameworkSanityTests`**
(`MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:20-43`), not in `MicroserviceExtractionTests`.
These pin the abstractions and the transport package to their correct layer so a future refactor doesn't
quietly move them.

#### `PiiConventionTests`
`MMCA.Common.Architecture.Tests/PiiConventionTests.cs`

1 fact: any type in `MMCA.Common.Domain` bearing a `[Pii]`-decorated property must implement
`IAnonymizable` (ADR-005). The test passes vacuously today (the framework ships no PII-bearing data
subject entity), and fails the build the moment one is added without an erasure path.
[Rubric §30, Compliance, Privacy & Data Governance]: §30 assesses whether GDPR/CCPA erasure
obligations are structurally enforced; this test is the structural gate.

#### `AggregateConventionTests`
`MMCA.Common.Architecture.Tests/AggregateConventionTests.cs`

2 facts checking DDD factory-method conventions via reflection (NetArchTest cannot inspect method
return types, so the file uses `Assembly.GetTypes()` directly):

- `Domain_ShouldExpose_AggregateRoots`, asserts the filter finds at least one aggregate root
  (guards against the test becoming vacuous).
- `AggregateRoots_ShouldHave_StaticCreateFactory_ReturningResultOfTheAggregate`, walks every
  non-abstract type inheriting `AuditableAggregateRootEntity<>`, asserts it has a public static
  `Create(...)` method whose return type is `Result<TAggregate>`. [Rubric §4, Domain-Driven Design]:
  §4 assesses whether the domain model is authentic DDD; the factory-method + `Result<T>` return
  is the DDD "factory prevents invalid entity construction" pattern, here enforced automatically.

#### `DependencyVersionTests`
`MMCA.Common.Architecture.Tests/DependencyVersionTests.cs`

3 `[Theory]` rows (one per MassTransit package: `MassTransit`, `MassTransit.RabbitMQ`,
`MassTransit.Azure.ServiceBus.Core`): parse `Directory.Packages.props` by walking up from
`AppContext.BaseDirectory` until the file is found, extract the `<PackageVersion Include="MassTransit"
Version="..."/>` attribute, and assert `version.Major < 9`. The class is a bare subclass of the shared
`DependencyVersionTestsBase` (which holds the parsing + theory rows); MMCA.Common is the only repo that
declares it, because it is the one that actually pins MassTransit. The failure message explains exactly
why: "MassTransit v9 requires a commercial license (MT_LICENSE); without it every broker-enabled
host fails the startup license check and crashes." [Rubric §32, Dependency & Supply-Chain]: §32
assesses whether dependency versions are tracked, pinned, and protected against accidental bumps;
`DependencyVersionTests` is the build-time gate for the most dangerous version upgrade in the
codebase. (See the primer `00-primer.md#nuget-lock-files--pinned-audited-sources` for context.)

### MMCA.ADC.Architecture.Tests, 15 types

Located at `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/`. Like the Common project, these
are thin subclasses of the shared `*TestsBase` classes from `MMCA.Common.Testing.Architecture`
(referenced as a NuGet package, `MMCA.ADC.Architecture.Tests.csproj:25`), each supplying `AdcArchitectureMap`,
the map that adds the per-module Identity/Conference/Engagement layers on top of the Common framework
layers. The rule bodies are shared; only the map differs from the Common repo.

#### `LayerDependencyTests` (ADC)
`MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs`

Extends the Common checks to the ADC module assemblies. Uses `[Theory, InlineData("Identity"),
InlineData("Conference"), InlineData("Engagement")]` to parameterize, a single fact body run
three times. Checks all forbidden pairs: module Domain must not depend on its own Application,
Infrastructure, or API; module Application must not depend on its own Infrastructure or API;
module Infrastructure must not depend on its own API. Additionally checks that `MMCA.Common.Domain`
and `MMCA.Common.Application` (via `ModuleAssemblies.CommonDomain/CommonApplication`) hold the
same inward rules when consumed in ADC.

#### `ModuleIsolationTests`
`MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs`

The cross-module boundary rules, the modular monolith's core governance. Each parameterized
theory for the three modules: a module's Domain must not depend on any other module's Domain;
a module's Application must not depend on any other module's Application; Infrastructure must not
cross into other Infrastructure; API must not cross into other API. Two additional rules: a
module's Domain must not touch other Infrastructure, and a module's Application must not touch
other Infrastructure. Cross-module communication is allowed only through `*.Shared` (contract)
layers and DI-injected interfaces. The "all other modules' namespaces at this layer" list is generated
dynamically by the shared `ModuleIsolationTestsBase` / `ArchitectureRules.Modules` from the modules
declared in `AdcArchitectureMap`.

#### `MicroserviceExtractionTests` (ADC)
`MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs`

The transport-isolation rule applied across all ADC module layers. The shared rule's transport
namespace set covers `MassTransit`, `Grpc`, and `Google.Protobuf`. For Domain, Application, and Shared
of all three modules, plus the Common Domain/Application layers, none of these transport namespaces
may appear. Transport belongs only in Infrastructure, the `*.Service` hosts, and `*.Contracts` projects.
A NetArchTest quirk worth knowing: it matches by namespace *prefix*, so `'Grpc'` catches
`Grpc.Core` / `Grpc.Net.*` / `Grpc.AspNetCore` but NOT the project's own `MMCA.Common.Grpc` (which starts
with `MMCA`), so the rule does not accidentally flag the framework's own transport package.

#### `PiiConventionTests` (ADC)
`MMCA.ADC.Architecture.Tests/PiiConventionTests.cs`

The ADC variant scans **all** module domain assemblies (`ModuleAssemblies.AllModuleDomainAssemblies`,
an array of Identity + Conference + Engagement domains). It first asserts the list is non-empty
(the test must not become vacuous), then checks every `[Pii]`-decorated entity implements
`IAnonymizable`. The doc comment notes the deliberate scope: the Identity `User` aggregate is
PII-bearing; the Conference `Speaker` is not, because speaker names and emails are public agenda
content sourced from Sessionize, not app-user PII subject to the privacy policy's erasure right.

#### Additional ADC-only test classes

| Class | File | Focus |
|---|---|---|
| `DomainPurityTests` | `DomainPurityTests.cs` | Framework-independence of all module Domain layers |
| `HandlerConventionTests` | `HandlerConventionTests.cs` | All command/query handlers properly implement the right interface |
| `ConcurrencyConventionTests` | `ConcurrencyConventionTests.cs` | Async handler methods accept `CancellationToken` as final parameter |
| `ControllerConventionTests` | `ControllerConventionTests.cs` | Controllers inherit `ApiControllerBase`, declare `[ApiVersion]` |
| `EntityConventionTests` | `EntityConventionTests.cs` | Entities inherit the correct base class |
| `NamingConventionTests` | `NamingConventionTests.cs` | Handler/repo/service naming follows conventions |
| `EventConventionTests` | `EventConventionTests.cs` | Domain events follow naming/shape conventions |
| `ImmutabilityTests` | `ImmutabilityTests.cs` | DTOs/events/value objects are immutable (records, no public setters) |
| `SharedLayerTests` | `SharedLayerTests.cs` | Shared projects contain only DTOs, enums, identifier aliases |
| `IntegrationEventContractTests` | `IntegrationEventContractTests.cs` | Integration events implement the correct interface, are records, and are in the correct namespace |
| `DataResidencyTests` | `DataResidencyTests.cs` | Compliance drift guard (§30): the data-residency region in `PRIVACY.md` must match the SQL region in `deploy.yml`, does not use `AdcArchitectureMap` (reads the files directly) |

---

## 5. Integration and E2E strategy

### Per-service integration tests (SQL-gated)

The three integration test projects (`MMCA.ADC.Identity.IntegrationTests`,
`MMCA.ADC.Conference.IntegrationTests`, `MMCA.ADC.Engagement.IntegrationTests`) each boot their
service in-process with `WebApplicationFactory<Program>`. The concrete fixture for each service
(e.g. `IdentityIntegrationTestFixture`,
`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs`)
implements `IIntegrationTestFixture` and handles the full lifecycle:

1. **Database creation.** A throwaway SQL Server database is created with a GUID-embedded name
   (`ADC_IdentityIntegrationTest_{Guid:N}`) on the server given by `ADC_TEST_SQL_BASE`. If the
   env var is absent, it defaults to `(localdb)\MSSQLLocalDB` (line 26-27).
2. **Environment injection.** Before the host builds, connection strings, JWT keypair, JWKS
   settings, and rate-limit thresholds are injected via `Environment.SetEnvironmentVariable`
   (lines 102-117). Using process environment variables (rather than `ConfigureAppConfiguration`)
   is necessary because the host reads these at configure-time before `WebApplicationFactory`'s
   `ConfigureServices` override runs. The saved original values are restored in `RestoreEnvironment`
   after the fixture disposes.
3. **Schema migration.** Creating the first `HttpClient` forces `Program.cs` to run, which
   calls `InitializeDatabaseAsync(DatabaseInitStrategy.Migrate)`, the migrations are applied to
   the fresh database automatically (line 58-59).
4. **Per-test reset via Respawn.** `Respawner.CreateAsync` (line 63) configures Respawn to delete
   all rows except `__EFMigrationsHistory`. Each test calls `ResetDatabaseAsync()` through
   `IntegrationTestBase.InitializeAsync()` before its body runs. This is faster than dropping/re-creating
   the database and handles foreign key cascades automatically.
5. **Disposal.** On fixture disposal, `SqlConnection.ClearAllPools()` releases connection pool
   handles (line 143), then a raw `DROP DATABASE` command removes the throwaway database.

Cross-service gRPC edges are faked for isolation: the non-Identity services re-point their
`AddForwardedJwtBearer` scheme at the in-process test key, and gRPC clients that would call other
services use stub implementations. This keeps each integration suite testing only its own service's
behavior. [Rubric §14, Testability]: §14 awards credit for isolation, per-test DB reset plus
per-service `WebApplicationFactory` means each test is truly independent.

### MMCA.Common unit-level infrastructure tests

`MMCA.Common.Infrastructure.Tests` (133 types) uses SQLite-backed `EnsureCreated` contexts for
tests that need a real EF pipeline. SQLite avoids the SQL Server dependency entirely, which is why
`MMCA.Common` builds and tests without any SQL Server or Docker in the local environment. The tradeoff
is that SQLite doesn't support all SQL Server features (e.g., row-level locking, certain index
hints), but EF Core's cross-provider abstraction is sufficient for the behaviors being tested
(outbox persistence, repository queries, soft-delete filters).

### E2E tests

`MMCA.ADC.E2E.Tests` (49 types) and `MMCA.Common.UI.E2E.Tests` (7 types) require either the
full Aspire stack (`dotnet run --project Source/Hosting/MMCA.ADC.AppHost`) or the Gallery
backend (`MMCA.Common.UI.Gallery`) respectively. The Aspire AppHost starts SQL Server, Redis,
RabbitMQ, MailDev, all four service hosts, the Gateway, and the UI, it cannot be launched
headlessly in a background bash shell (it stalls at the control-plane init). The CI workaround
documented in the codebase is a pre-warmed Aspire environment with a timeout guard.

The cross-browser matrix runs the same suite three times by varying `E2E_BROWSER`:
`chromium` → `firefox` → `webkit`. Mobile is covered by responsive layout testing (grid→card at
narrow viewport), not a separate app. [Rubric §22, Responsive & Cross-Browser/Device]: §22
assesses whether the browser support matrix is exercised; the `E2E_BROWSER` env var is the
mechanism. [Rubric §21, Accessibility]: the `AssertNoAccessibilityViolationsAsync` call in
workflow bases and in `MMCA.Common.UI.E2E.Tests` is the runtime axe-core gate for WCAG 2.1 AA.

---

## 6. Worked examples

Three examples tie the infrastructure above to real test code.

### Example A, Architecture fitness function (`DependencyVersionTests`)

The per-repo class is a bare subclass; the `[Theory]` body lives once in the shared base:

```csharp
// MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9-11
public sealed class DependencyVersionTests : DependencyVersionTestsBase { }

// the rows + parsing live in the shipped package:
// MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs
[Theory]
[InlineData("MassTransit")]
[InlineData("MassTransit.RabbitMQ")]
[InlineData("MassTransit.Azure.ServiceBus.Core")]
public void MassTransit_MustNotExceedMajorVersion8(string packageId)
{
    var version = ReadPinnedVersion(packageId);         // parse Directory.Packages.props
    version.Should().NotBeNull(because: $"...");
    version!.Major.Should().BeLessThan(9,
        because: "MassTransit v9 requires a commercial license ...");
}
```

**Why this test exists and what it protects.** MassTransit v9 introduced a mandatory commercial
license check (`MT_LICENSE`). A broker-enabled service that starts without it crashes at startup,
but the crash happens at runtime, not at compile time, and CI never starts the broker. So a
`dotnet outdated --upgrade` that silently bumped MassTransit from 8.5.5 to 9.x would compile,
pass all tests, deploy, and then crash in production. `DependencyVersionTests` makes this a
build-time failure: the shared base parses `Directory.Packages.props` directly, not the compiled
assembly, so the failure happens in the `build-and-test` job before any code ships. This is the
pattern of a fitness function: an executable rule that enforces a policy that cannot be expressed
as a type error. [Rubric §32, Dependency & Supply-Chain]: this is the highest-signal embodiment
of §32 in the codebase, a deliberate, documented pin with an automated gate.

### Example B, Integration test base usage (`IdentityIntegrationTestBase`)

```csharp
// MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:11
[Collection(IdentityIntegrationTestCollection.Name)]
public abstract class IdentityIntegrationTestBase(IdentityIntegrationTestFixture fixture)
    : IntegrationTestBase<IdentityIntegrationTestFixture>(fixture)
{
    private const string Audience = "AtlDevConapi";

    protected void AuthenticateAsOrganizer(UserIdentifierType userId = 1)
        => SetBearerToken(JwtTokenGenerator.GenerateToken(Audience, userId, "Organizer"));
    // ...
}
```

A concrete test (`AttendeeAuthTests`, `AttendeeProfileTests`, etc.) inherits
`IdentityIntegrationTestBase`. The lifecycle is:

1. `IdentityIntegrationTestFixture` starts once per collection (xUnit class fixture), migrates
   the database, and creates the `Respawner`.
2. `IntegrationTestBase.InitializeAsync()` calls `Fixture.ResetDatabaseAsync()` before each test.
3. The test calls `AuthenticateAsAttendee(userId)` which calls `SetBearerToken(...)`, subsequent
   `Client.GetAsync(...)` / `PostAsync(...)` calls carry the `Bearer` header.
4. `IntegrationTestBase.DisposeAsync()` disposes `Client`.
5. After all tests run, `IdentityIntegrationTestFixture.DisposeAsync()` drops the throwaway
   database.

The test author writes only the business assertion. All boilerplate (token minting, HTTP client,
DB reset, teardown) is in the shared infrastructure. This is exactly why the shared package exists.
[Rubric §14, Testability]: the fixture isolation + shared infrastructure is a direct measure
of the §14 "integration test isolation" criterion.

### Example C, bUnit component test (`ProfileTests`)

```csharp
// MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/Profile/ProfileTests.cs:32
public sealed class ProfileTests : BunitTestBase
{
    public ProfileTests()
    {
        Services.AddSingleton(Mock.Of<IUserUIService>());
        Services.AddSingleton(Mock.Of<IAuthUIService>());
    }

    [Fact]
    public void WhenAuthenticatedWithUserId_RendersProfileActions()
    {
        var cut = RenderAs<ProfilePage>(UserWithId, _ => { });
        cut.WaitForAssertion(() =>
        {
            cut.Markup.Should().Contain("Change Password");
            cut.Markup.Should().Contain("Delete My Account");
        });
    }

    [Fact]
    public void WhenUserIdClaimMissing_RendersErrorState()
    {
        var cut = RenderAs<ProfilePage>(UserWithoutId, _ => { });
        cut.WaitForAssertion(() => cut.Markup.Should().Contain("Unable to load profile."));
    }
}
```

`BunitTestBase` (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/BunitTestBase.cs:12`)
registers `MudBlazor.Services`, sets `JSInterop.Mode = JSRuntimeMode.Loose` (so MudBlazor's JS
calls don't throw), registers `AddAuthorizationCore`, and exposes a **mutable**
`AuthenticationStateProvider` (the `MutableAuthenticationStateProvider` inner class, line 52)
that the `ProfilePage` injects directly. `RenderAs<TComponent>(principal, parameters)` (line 39)
sets the provider's principal, then renders the component with a cascading `AuthenticationState`
wrapping the same principal. `RenderUnderTest<TComponent>` (line 34) is a shortcut for the
anonymous case.

The test constructs `UserWithId` (a principal with a `user_id=42` claim) and `UserWithoutId`
(a principal without it), then asserts the two render states. `cut.WaitForAssertion` is bUnit's
polling assertion, it retries until the assertion passes or a timeout elapses, handling
Blazor's async rendering cycle.

[Rubric §28, Front-End Testing & Quality]: bUnit tests the component's render logic in isolation
without a browser, giving fast feedback on UI states that are awkward to exercise in Playwright.
The combination of bUnit (fast, component-level) + Playwright (slow, browser-level) is the two-tier
UI test strategy: bUnit for render-state logic, Playwright for user flows and accessibility.

---

## Quick reference: rubric categories touched in this chapter

| Category | Where explained |
|---|---|
| §3 Clean Architecture (enforced) | §4 LayerDependencyTests, DomainPurityTests |
| §4 Domain-Driven Design | §4 AggregateConventionTests factory-method rule |
| §11 Security (test RS256 keypair) | §3 JwtTokenGenerator design note |
| §14 Testability & Test Strategy | §1 CI filter rationale, §2 project layout, §5 integration strategy |
| §17 DevOps & Deployment | §1 two-filter CI rationale |
| §21 Accessibility (a11y) | §3 AssertNoAccessibilityViolationsAsync, §5 E2E strategy |
| §22 Responsive & Cross-Browser | §3 PlaywrightFixture engine selection, §5 E2E browser matrix |
| §28 Front-End Testing & Quality | §2 UI/E2E project layout, §3 Testing.E2E package, §6 bUnit example |
| §30 Compliance, Privacy & Data Governance | §4 PiiConventionTests |
| §32 Dependency & Supply-Chain | §4 DependencyVersionTests, §6 Example A |
| §33 Developer Experience & Inner Loop | §1 MTP filter syntax, self-hosted test binaries |
| §34 Architecture Governance & Documentation | §4 overall fitness-function framing |

---

## Cross-links

- Primer: [`00-primer.md#5-the-solution--test-layout`](00-primer.md#5-the-solution--test-layout)
 , solution files, MTP runner, slnx-excluded UI projects
- Primer: [`00-primer.md#architecture-enforcement-is-doubled-fitness-functions`](00-primer.md#architecture-enforcement-is-doubled-fitness-functions)
 , compile-time + runtime double enforcement explained
- Devops/CI chapter: `devops-cicd.md`, CI job definitions, the `integration-tests` job that uses
  `MMCA.ADC.Integration.slnf`, the `ui-e2e` job that builds the Gallery + E2E tests by csproj path
- ADRs:
  - `ADRs/003-outbox-dual-dispatch.md`, outbox pattern the integration tests exercise
  - `ADRs/005-soft-delete-vs-erasure.md`, PiiConventionTests rationale
  - `ADRs/006-database-per-service.md`, per-source DB reset in `IIntegrationTestFixture`
  - `ADRs/007-grpc-extraction.md` and `ADRs/008-service-extraction-topology.md`, MicroserviceExtractionTests rationale
