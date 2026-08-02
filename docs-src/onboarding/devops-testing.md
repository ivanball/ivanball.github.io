# Testing Architecture & Solution Composition

> **Chapter scope note.** The tier chapters (`tier-00` through the sweep) document every type
> in the production codebase one by one. Test types are the logged exception: this chapter covers
> the **1,246** types that live in test projects, grouped by project purpose and foundational
> infrastructure, not written as one section per `[Fact]`. Individual test methods are cited only
> as worked examples. Cross-reference the tier chapters for the production types being tested.
> The counts come from the Roslyn inventory (`00-inventory.md:23-117`), which scans
> `MMCA.Common/Source`, `MMCA.Common/Tests`, `MMCA.ADC/Source` and `MMCA.ADC/Tests` only
> (`00-inventory.md:3-4`): MMCA.Store and MMCA.Helpdesk test types are named in this chapter where
> they carry a decision, but they are not in those totals.

This chapter teaches the complete testing architecture of the MMCA workspace: how the solutions are
sliced, which CI filter sees which tests, how Microsoft Testing Platform differs from VSTest, the
shipped testing-infrastructure NuGet packages, the NetArchTest fitness-function suites that act
as executable governance, the runtime conformance suites that check a really booted host, the
integration and E2E strategies, three worked examples, and the CI gates that decide which tier
blocks which merge.

---

## 1. Solution composition and the test runner

### Solution files: slnx vs. slnf

The two deployed apps use the same two-file pattern; MMCA.Common and MMCA.Helpdesk ship a `.slnx`
only, because their solutions are already fast enough not to need a CI subset:

| File | Purpose |
|---|---|
| `MMCA.Common.slnx` | Full human solution, all source + most test projects (no `.slnf`) |
| `MMCA.Helpdesk.slnx` | Full seed solution, three test projects, no database needed (no `.slnf`) |
| `MMCA.ADC.slnx` | Full human solution, all source + all 30 test projects |
| `MMCA.ADC.CI.slnf` | CI fast path, source + unit/architecture/UI/host tests only |
| `MMCA.ADC.Integration.slnf` | SQL-gated per-service integration tests only |
| `MMCA.Store.CI.slnf` / `MMCA.Store.Integration.slnf` | Store's pair, mirroring the ADC split |

`MMCA.ADC.CI.slnf` (`MMCA.ADC/MMCA.ADC.CI.slnf:1-63`) includes 33 source projects and 23 test
projects: every per-module unit and UI suite across Identity, Conference, Engagement and
Notification, plus `MMCA.ADC.Architecture.Tests`, `MMCA.ADC.Gateway.Tests` and
`MMCA.ADC.Services.Tests`. It deliberately excludes:

- the four per-service integration projects (`MMCA.ADC.{Identity,Conference,Engagement,Notification}.IntegrationTests`)
- the two Testcontainers tiers (`MMCA.ADC.CrossService.IntegrationTests`, `MMCA.ADC.ServiceBusEmulator.IntegrationTests`)
- `Tests/E2E/MMCA.ADC.E2E.Tests`
- the Aspire `AppHost`, the MAUI `MMCA.ADC.UI` project, and the frozen combined migrations archive

Why: the integration tests need a real SQL Server (the `ADC_TEST_SQL_BASE` connection string points
to a CI SQL service container), the Testcontainers tiers need a Docker daemon, and the E2E tests need
the full Aspire stack running. None of that is available in the fast build job, so each is gated by
its own job with its own prerequisites.

**Read the gating carefully, it is easy to state wrongly.** ADC's `integration-tests` job is
**pull-request-only** (`MMCA.ADC/.github/workflows/deploy.yml:389`) and is **not** in the `deploy`
job's `needs` list (`deploy.yml:866`). The comment above that list spells out the reasoning
(`deploy.yml:867-869`): with strict branch protection the PR validated the exact merge tree, so
`build-and-test`, `integration-tests` and `coverage` are required PR checks rather than push-time
deploy gates, and they are not re-run on the merge push. What actually blocks the deploy is
`supply-chain`, `cost-guard`, the three freshness gates, the chromium `e2e-gate`, `foundation` and
`build-images`. [Rubric §17, DevOps & Deployment]: §17 assesses how consistently CI/CD enforces
quality gates; the two-filter pattern is how the build stays fast on every push while the
SQL-dependent tier still has to be green before a PR can merge at all.

`MMCA.ADC.Integration.slnf` (`MMCA.ADC/MMCA.ADC.Integration.slnf:4-9`) contains exactly four
projects, one per service host: Identity, Conference, Engagement and Notification. These are the
per-service `WebApplicationFactory` integration tests that replaced the combined
`MMCA.ADC.IntegrationTests` project, which has since been **deleted from disk**, not merely
excluded (`MMCA.ADC/MMCA.ADC.slnx:106-113` records the removal, along with the removal of
`MMCA.ADC.WebAPI.Tests`, whose middleware coverage was consolidated upstream into
`MMCA.Common.API.Tests`).

`MMCA.Common.slnx` (`MMCA.Common/MMCA.Common.slnx:1-48`) includes fourteen of the fifteen source
packages: the four Core (`.Shared`, `.Domain`, `.Application`, `.Infrastructure`), four Presentation
(`.API`, `.Grpc`, `.UI`, `.UI.Web`), two Aspire (`.Aspire`, `.Aspire.Hosting`), and four Testing
(`.Testing`, `.Testing.Architecture`, `.Testing.E2E`, `.Testing.UI`), plus **eleven** test projects.
The fifteenth package, `MMCA.Common.UI.Maui`, sits **outside the `.slnx`** on purpose: its four MAUI
target frameworks cannot build on the ubuntu runners the solution's CI uses, so it is built and packed
by dedicated windows jobs
([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Four test
projects are **also intentionally absent from the `.slnx`**:

- `Tests/Presentation/MMCA.Common.UI.Gallery`, a backend-less Blazor host that renders the real
  login and register pages, a UI-primitives showcase and the notification pages; it exists solely to
  give Playwright something to hit.
- `Tests/Presentation/MMCA.Common.UI.E2E.Tests`, the axe-core + render-smoke suite that hits
  the Gallery.
- `Tests/Core/MMCA.Common.Infrastructure.Redis.Tests`, which runs `DistributedCacheService` against a
  real Redis via Testcontainers (so the unit loop needs no Docker).
- `Tests/Performance/MMCA.Common.Benchmarks`, the BenchmarkDotNet suite behind the ADR-060
  performance gate (see section 7).

The first two are excluded so `dotnet test --solution MMCA.Common.slnx` stays fast (no browser, no
network); the other two so it needs no Docker. Each runs in its own CI job, built by csproj path, for
example `dotnet test --project Tests/Presentation/MMCA.Common.UI.E2E.Tests/MMCA.Common.UI.E2E.Tests.csproj`
(`MMCA.Common/.github/workflows/ci.yml:301`).
[Rubric §28, Front-End Testing & Quality]: §28 assesses whether UI components have automated
tests; the Gallery + E2E split is the mechanism that adds browser-level coverage without slowing
the primary test loop.

### Microsoft Testing Platform (MTP), not VSTest

All four repos share one `global.json` structure:

```json
{
  "test": {
    "runner": "Microsoft.Testing.Platform"
  }
}
```

(`MMCA.Common/global.json:1-5`, identical in `MMCA.ADC/global.json`, `MMCA.Store/global.json` and
`MMCA.Helpdesk/global.json`)

This selects **MTP** as the test runner instead of the legacy VSTest runner. The practical
consequences:

1. **Exit code 8**, if a test project discovers zero tests MTP exits 8, not 0. Every CI
   `dotnet test` call passes `--minimum-expected-tests` with a floor sized to the tier it runs, so
   a discovery regression is a visible failure rather than a silent skip: `2000` for the whole
   MMCA.Common solution (`MMCA.Common/.github/workflows/ci.yml:144`), `1` for the browser tier
   (`ci.yml:301`), `40` for the cross-repo Helpdesk canary (`ci.yml:492`), and `1` for each of
   ADC's two solution filters (`MMCA.ADC/.github/workflows/deploy.yml:219,456`).

2. **Filter syntax differs.** You pass a `--` separator and then MTP's own filter flags:
   ```bash
   # Run a single test class
   dotnet test --project Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/MMCA.ADC.Identity.Domain.Tests.csproj \
     -- --filter-class "*UserTests*"

   # Run a single test method
   dotnet test --project Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/MMCA.ADC.Identity.Domain.Tests.csproj \
     -- --filter-method "*Create_WithValidData_ReturnsSuccess*"
   ```
   The flags are `--filter-class` and `--filter-method`, not the VSTest `--filter FullyQualifiedName~...`
   form. Always target `--project <csproj>`, never a bare directory path. Passing the wrong flag is a
   quiet failure mode: the run exits non-zero having discovered zero tests rather than telling you the
   filter was unrecognized.

3. **Running compiled test binaries directly.** Because the headless CI environment has no
   reachable SQL, integration tests build but cannot be run-verified via `dotnet test`. The
   workaround is to run the compiled `.Tests.exe` directly for unit tests:
   `./bin/Release/net10.0/MMCA.Common.Shared.Tests.exe`, the MTP binary is self-contained.
   [Rubric §33, Developer Experience & Inner Loop]: §33 assesses the friction of the local
   development cycle; MTP's self-hosted test binaries and the explicit `--minimum-expected-tests`
   guard both reduce "tests silently went away" surprises.

---

## 2. Test project layout

The inventory below is drawn from `00-inventory.md:23-117` (test-assembly counts) and the solution
files above. Counts are distinct types per project as reported by the Roslyn inventory scan, not
`[Fact]` counts.

### MMCA.Common, 659 test types across 11 in-solution projects + 27 across 4 out-of-solution

**Unit, Core layer**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Shared.Tests` | 25 | Unit tests for the Result pattern, `Error`, `ErrorType`, value objects, DTO contracts, supported cultures |
| `MMCA.Common.Domain.Tests` | 43 | Unit tests for entity hierarchy, aggregate root, domain events, specifications, soft-delete, PII redaction |
| `MMCA.Common.Application.Tests` | 175 | Unit tests for CQRS dispatcher, decorator pipeline, module loader, `IMessageBus`, validators, query pipeline |
| `MMCA.Common.Infrastructure.Tests` | 204 | Unit/integration tests for EF base contexts, outbox processor, repository, caching, JWT generation, JWKS provider, data-source resolver |

**Unit, Presentation layer**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.API.Tests` | 67 | Tests for `ApiControllerBase`, exception handlers, idempotency filter, middleware, JWKS endpoint (also the consolidated home of the ADC/Store middleware coverage) |
| `MMCA.Common.Grpc.Tests` | 15 | Tests for `GrpcResultExceptionInterceptor`, `JwtForwardingClientInterceptor`, Result to `RpcException` mapping |
| `MMCA.Common.UI.Tests` | 78 | bUnit component tests for shared Blazor components (login/register forms, nav, theming, notification pages) |
| `MMCA.Common.UI.Web.Tests` | 4 | The Blazor Web host layer: `ServerTokenStorageService`, `BlazorCspPolicyProvider`, `WebFormFactor` |

**Hosting**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Aspire.Tests` | 13 | Tests for `AddServiceDefaults`, health-check registration, `OutboxPollFilterProcessor` telemetry suppression |
| `MMCA.Common.Testing.Tests` | 9 | The framework dogfooding its own shipped test bases: `DecoratorPipelineOrderTests` over a synthetic `PingCommand`/`PingQuery` pair, and `HandlerTestBaseTests` |

**Architecture**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Architecture.Tests` | 26 | 19 fitness-function classes (see section 4) plus `CommonArchitectureMap` and their fixtures |

**Out-of-solution (each run by its own dedicated CI job)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.UI.Gallery` | 9 | Backend-less Blazor host; renders the real login/register pages, a primitives showcase and the notification pages for Playwright to hit |
| `MMCA.Common.UI.E2E.Tests` | 11 | Playwright axe-core WCAG 2.1 AA scans, render smoke, dark mode, web vitals, pseudo-localization and mobile top row against the Gallery |
| `MMCA.Common.Infrastructure.Redis.Tests` | 1 | `DistributedCacheService` against a real Redis via Testcontainers (storage FORMAT fidelity: a mocked `IDistributedCache` cannot answer WRONGTYPE) |
| `MMCA.Common.Benchmarks` | 6 | BenchmarkDotNet hot-path suite behind the ADR-060 performance gate (section 7) |

### MMCA.ADC, 560 test types across 30 in-solution projects

**Unit, per-module, per-layer (Identity module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Identity.Domain.Tests` | 4 | `User` aggregate factory methods, invariants, soft-delete |
| `MMCA.ADC.Identity.Application.Tests` | 21 | Command/query handler tests for register, login, external OAuth, profile management |
| `MMCA.ADC.Identity.Shared.Tests` | 3 | DTO/enum tests |
| `MMCA.ADC.Identity.API.Tests` | 7 | Controller helper tests, rate-limit bypass |
| `MMCA.ADC.Identity.Infrastructure.Tests` | 4 | Token service, JWKS provider, EF configuration |
| `MMCA.ADC.Identity.UI.Tests` | 6 | bUnit tests for `Profile`, login route authorization |

**Unit, per-module, per-layer (Conference module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Conference.Domain.Tests` | 22 | Event/Session/Speaker aggregate factory, invariants, domain events |
| `MMCA.ADC.Conference.Application.Tests` | 142 | Handler tests for the Conference controllers' use cases (bulk) |
| `MMCA.ADC.Conference.Shared.Tests` | 17 | DTO validation, enum coverage |
| `MMCA.ADC.Conference.API.Tests` | 16 | Controller registration, route tests |
| `MMCA.ADC.Conference.Infrastructure.Tests` | 10 | EF configuration, repository behavior |
| `MMCA.ADC.Conference.UI.Tests` | 28 | bUnit tests for session/speaker components and dashboards |

**Unit, per-module, per-layer (Engagement module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Engagement.Domain.Tests` | 6 | Bookmark, LivePoll and SessionQuestion aggregates |
| `MMCA.ADC.Engagement.Application.Tests` | 30 | Bookmark, feedback and live-layer command/query handlers |
| `MMCA.ADC.Engagement.Shared.Tests` | 2 | DTO tests |
| `MMCA.ADC.Engagement.API.Tests` | 6 | Controller surface |
| `MMCA.ADC.Engagement.Infrastructure.Tests` | 4 | EF config |
| `MMCA.ADC.Engagement.UI.Tests` | 21 | bUnit tests for the conference-day live surfaces (Happening Now, session Live, presenter UI) |

**Unit, per-module (Notification module, API + Application only)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Notification.Application.Tests` | 5 | Live-channel publish path |
| `MMCA.ADC.Notification.API.Tests` | 1 | `NotificationHub` surface |

**Architecture**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Architecture.Tests` | 30 | 29 fitness-function classes (see section 4) plus `AdcArchitectureMap` |

**Hosts and services**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Gateway.Tests` | 5 | YARP route map, plus the two ADR-058 conformance subclasses (`SecurityHeadersTests`, `GracefulShutdownTests`) against a Production-pinned Gateway boot |
| `MMCA.ADC.Services.Tests` | 5 | The gRPC export services and their adapters, with a `FakeServerCallContext` |

**Integration (per-service WebApplicationFactory, in `MMCA.ADC.Integration.slnf` only)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Identity.IntegrationTests` | 33 | Full HTTP tests of the Identity service host against real SQL Server; auth flows, OAuth challenges, attendee/organizer access, outbox fidelity |
| `MMCA.ADC.Conference.IntegrationTests` | 36 | Full HTTP tests of the Conference service host, plus its 409-conflict ProblemDetails extension and the versioning contract |
| `MMCA.ADC.Engagement.IntegrationTests` | 13 | Full HTTP tests of the Engagement service host |
| `MMCA.ADC.Notification.IntegrationTests` | 8 | Full HTTP tests of the Notification service host |

**Testcontainers tiers (in `MMCA.ADC.slnx` but in neither `.slnf`; need Docker)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.CrossService.IntegrationTests` | 12 | Boots the three REST hosts in one process against real SQL Server + RabbitMQ containers; exercises the genuine outbox to broker to consumer round-trip and the Conference to Engagement gRPC read |
| `MMCA.ADC.ServiceBusEmulator.IntegrationTests` | 3 | MassTransit smoke against the official Azure Service Bus emulator (broker parity) |

**E2E (in `MMCA.ADC.slnx` but excluded from both `.slnf` filters)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.E2E.Tests` | 60 | Playwright browser-automation tests across login, register, conference browsing, bookmark and live flows, plus the 20-scan `AccessibilityTests` suite; requires the Aspire stack running |

### Test-type totals

- **MMCA.Common:** the 11 in-solution projects sum to 25 + 43 + 175 + 204 + 67 + 15 + 78 + 4 + 13 +
  9 + 26 = **659**; the 4 out-of-solution projects add 9 + 11 + 1 + 6 = **27**, for **686**.
- **MMCA.ADC:** 45 (Identity) + 235 (Conference) + 69 (Engagement) + 6 (Notification) + 30
  (architecture) + 90 (four integration projects) + 15 (two Testcontainers tiers) + 5 (Gateway) + 5
  (Services) + 60 (E2E) = **560**.
- **Combined test projects: 1,246.** Separately, the four shipped testing packages contribute
  another **89** types (`MMCA.Common.Testing` 14, `.Testing.Architecture` 39, `.Testing.E2E` 21,
  `.Testing.UI` 15): those are shipped product, not tests, which is why they are counted apart.

[Rubric §14, Testability & Test Strategy]: §14 assesses the breadth and meaningfulness of the
test suite across all layers; the project layout above, unit per layer, arch per repo,
integration per service, Testcontainers for the cross-service round-trip, E2E for browser flows,
demonstrates deliberate stratification rather than a single catch-all integration tier.

---

## 3. Shipped testing-infrastructure packages

MMCA.Common ships **four** of its fifteen packages as testing infrastructure that downstream apps
consume as NuGet references rather than writing their own harness (`MMCA.Common/FACTS.md:19,33-36`):

- `MMCA.Common.Testing` (14 types), integration-test base, JWT generator, SQL fixture base, handler
  scaffold, entity builders, and the six ADR-058 runtime conformance bases (this section).
- `MMCA.Common.Testing.E2E` (21 types), Playwright fixtures, Blazor nav helpers, Identity and
  Preferences workflow bases, page objects, the `AxeOptions` accessibility contract and a web-vitals
  collector (this section).
- `MMCA.Common.Testing.UI` (15 types), bUnit component-test base, MudBlazor provider harness, HTTP
  test doubles and a markup snapshot helper (this section; see the bUnit worked example in section 6).
- `MMCA.Common.Testing.Architecture` (39 types), the shared NetArchTest fitness-function rule library
  plus 31 abstract test bases (covered in section 4, where each repo's `*.Architecture.Tests` consumes it).

### MMCA.Common.Testing

`MMCA.Common/Source/Hosting/MMCA.Common.Testing/`, 14 types, shipped as `MMCA.Common.Testing`.

#### `IIntegrationTestFixture`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IIntegrationTestFixture.cs:8`

The shared contract between a `WebApplicationFactory` fixture and `IntegrationTestBase<TFixture>`.
Two members: `CreateClient()` (line 11) returns an `HttpClient` configured for the test server, and
`ResetDatabaseAsync()` (line 19) resets the database between tests. The doc comment
(`IIntegrationTestFixture.cs:13-18`) explicitly notes that fixtures for database-per-service hosts
must reset **every** relational source by enumerating `IEntityDataSourceRegistry` and
`IDataSourceResolver`, this is the database-per-microservice
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) implication for test
cleanup. Each concrete fixture implements this by opening a per-source `SqlConnection` and calling
`Respawner.ResetAsync`.

#### `IntegrationTestBase<TFixture>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs:13`

The abstract base class all integration test classes inherit from. Generic on `TFixture :
IIntegrationTestFixture`. Implements xUnit v3's `IAsyncLifetime`:

- `InitializeAsync()` calls `Fixture.ResetDatabaseAsync()` before each test, so tests always start
  from a clean database state (line 31).
- `DisposeAsync()` disposes the test `HttpClient` after each test (lines 34-39).
- `SetBearerToken(string token)` writes a `Bearer` `Authorization` header onto `Client`
  (lines 42-44).
- `ClearAuthentication()` removes it (lines 47-48).
- `GetAsync<T>`, `PostAsync<T>`, `PutAsync<T>`, `PutAsync` (no body), `DeleteAsync`, typed HTTP
  helpers (lines 51-72).
- `NextId()`, thread-safe `Interlocked.Increment` over a static counter starting at 1000,
  giving tests unique integer IDs without collisions under parallel execution (line 75).

Downstream projects extend this by adding role helpers. For example,
`IdentityIntegrationTestBase` (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:12`)
adds `AuthenticateAsOrganizer(userId)` (line 18), `AuthenticateAsAttendee(userId)` (line 22), and
`AuthenticateAsSpeaker(userId, speakerId)` (line 26), each calls
`SetBearerToken(JwtTokenGenerator.GenerateToken(...))`.

#### `SqlServerIntegrationTestFixtureBase<TEntryPoint>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27`

The shared implementation of `IIntegrationTestFixture` for a service host backed by a throwaway SQL
Server database. It owns the whole lifecycle, so a consumer's fixture is only the host-specific
delta (see section 5 for the walkthrough). Two abstract members name the repo's conventions:
`SqlBaseEnvironmentVariable` (line 58, e.g. `ADC_TEST_SQL_BASE`) and `DatabaseNamePrefix` (line 61);
one abstract `CreateFactory()` (line 134) supplies the `WebApplicationFactory`, and one virtual
`ConfigureTestEnvironment` (line 142) pushes host-specific settings.

#### `ProductionHostApplicationFactory<TEntryPoint>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/ProductionHostApplicationFactory.cs:22`

The database-free boot path. It pins `UseEnvironment("Production")` (line 36) so the tests exercise
the branches a default `Development` boot skips (restrictive CORS, HSTS emission), and it captures
the started `IHost` in `StartedHost` (line 29) because `IHost.StopAsync` is not reachable through the
`WebApplicationFactory` surface. That capture is what makes the graceful-shutdown suite possible.

#### `HandlerTestBase<THandler>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/HandlerTestBase.cs:38`

A reusable Moq scaffold for command/query handler unit tests, replacing the per-class copy-paste of
`Mock<IUnitOfWork>` plus `GetRepository` wiring plus `SaveChangesAsync` setup. `UnitOfWork` (line 45)
arrives with `SaveChangesAsync` pre-configured to return 1 (line 42); `Logger` (line 48) is a
`NullLogger<THandler>`. Derived classes call `RegisterRepository<TEntity, TIdentifierType>()` per
aggregate the handler touches.

#### The six runtime conformance bases (ADR-058)

The bases above are plumbing. The six below are the runtime-contract half of the fitness story:
NetArchTest can prove a controller lives in the right assembly, it cannot prove a booted host answers
a bad page number with an RFC 9457 problem document. Every one of these runs against a host that was
**actually booted**
([ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html)).

| Base | File | What it asserts |
|---|---|---|
| `ProblemDetailsContractTestsBase<TFixture>` | `ProblemDetailsContractTestsBase.cs:21` | Both error-shaping paths: ASP.NET Core model validation (400, `application/problem+json` with `type`/`traceId`/`errors`, line 30) and the framework's `HandleFailure` Result mapping (404, line 42) |
| `OpenApiContractTestsBase<TFixture>` | `OpenApiContractTestsBase.cs:21` | The live `/openapi/v1.json` document is OpenAPI 3.x (line 53) and still describes the pinned `CorePublicResources` (line 50) above a `MinimumPathCount` floor (line 37). No committed snapshot: a new controller can never leave a stale one behind (line 16) |
| `ServiceInfoVersioningContractTestsBase<TFixture>` | `ServiceInfoVersioningContractTestsBase.cs:19` | `/ServiceInfo` served at both `api-version: 1.0` (deprecated, line 28) and `2.0` (line 44), with the `api-deprecated-versions` / `api-supported-versions` reporting headers |
| `SecurityHeadersTestsBase` | `SecurityHeadersTestsBase.cs:16` | Six hardened response headers on `/alive` (lines 29-35), including `Content-Security-Policy: frame-ancestors 'none'` and an HSTS `max-age` |
| `GracefulShutdownTestsBase<TEntryPoint>` | `GracefulShutdownTestsBase.cs:24` | A real `IHost.StopAsync` under a bounded 20-second token (lines 28, 55-56) fires `ApplicationStopping` then `ApplicationStopped` (lines 58, 60) |
| `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>` | `DecoratorPipelineOrderTestsBase.cs:36` | The ADR-014 nesting, read off the constructed object graph via each decorator's private inner-handler field, not off the registration list (expected orders at lines 47 and 57) |

Five of the six reach the host through `IIntegrationTestFixture`; the security-headers base takes a
bare `CreateClient()` (`SecurityHeadersTestsBase.cs:42`) and the decorator base needs no host at all,
only a `ConfigureServices` that runs the repo's real registration sequence
(`DecoratorPipelineOrderTestsBase.cs:44`).

**Adoption is deliberately partial, and uneven per suite.** This is the honest inventory, not a claim
of completeness:

- **OpenAPI** is the only one with full coverage of the extracted REST hosts: all four ADC services
  and all three Store services subclass it.
- **ProblemDetails** covers all three Store services and three of the four ADC services;
  **ADC Notification has no problem-details subclass**. ADC Conference extends the base with a 409
  stale-`RowVersion` conflict test of its own.
- **ServiceInfo versioning** is subclassed once per repo, on ADC Conference
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:15`)
  and Store Catalog. That keeps the versioning machinery exercised but leaves the other five REST
  hosts unguarded.
- **Security headers and graceful shutdown** are subclassed **only on the two Gateway hosts**
  (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:12` and
  `GracefulShutdownTests.cs:9`, plus the Store pair). No service host asserts either today.
- **Decorator order** is subclassed once per consumer, both against the Identity module's
  `ChangePreferencesCommand` / `GetUserPreferencesQuery` pair
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:26`). MMCA.Common
  dogfoods the only base it can, since it ships no host of its own: a synthetic `PingCommand`/`PingQuery`
  pair (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:21`).
- **MMCA.Helpdesk adopts none of them.** The seed demonstrates the structural tier and not the runtime
  tier.

Each unguarded host is a gap in the record, not a decision that the contract does not apply to it.

#### `JwtTokenGenerator`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:29`

A static class that mints RS256 JWT tokens for test consumption. Key design decisions visible in
the source:

- **RS256 matches production.** The generator uses `RSA.Create()` + `ImportFromPem` + `RsaSecurityKey`
  (lines 123-129), matching the algorithm configured by `AddCommonAuthentication` in the real host.
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
  (line 111) exports the RSA parameters before disposal (line 126), creates `RsaSecurityKey`
  (line 129), and writes the `NameIdentifier` / `user_id` / `role` claims to match the shape
  `ITokenService` produces in production (lines 132-137).

#### `EntityBuilderBase<TBuilder, TEntity>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9`

A fluent-builder generic base for test entity construction. Subclasses configure sensible defaults
(so tests only set the property under test) and implement the abstract `Build()` (line 17), which
calls the domain factory method and throws on a `Failure` result. This keeps test arrange code
readable without exposing EF's parameterless constructor. [Rubric §14, Testability]: builder
patterns are a classic indicator of testability investment; the shared base means every downstream
module gets fluent builders "for free" by subclassing.

#### `FeatureManagementTestExtensions`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10`

A C# preview `extension(IServiceCollection services)` block (line 12) exposing
`ConfigureTestFeatureFlags(Dictionary<string, bool>)` (line 21), which injects an in-memory
`IConfiguration` and registers `AddFeatureManagement` against it. Call this in a
`WebApplicationFactory.ConfigureServices` override to override feature flags from
`appsettings.json`. Allows integration tests to exercise both the flag-on and flag-off code
paths without changing the real config file.

### MMCA.Common.Testing.E2E

`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/`, 21 types, shipped as
`MMCA.Common.Testing.E2E`. [Rubric §28, Front-End Testing & Quality]: §28 assesses whether UI
components have browser-level automated coverage; this package is the shared foundation for that
coverage.

#### `E2ETestConfiguration`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8`

All E2E configuration is environment-variable driven. Properties:

| Variable | Default | Effect |
|---|---|---|
| `E2E_BASE_URL` | `https://localhost:7108` | Target app URL (overridden per downstream project), line 13 |
| `E2E_HEADLESS` | `true` (absent = headless) | Set `false` to watch tests visually, line 16 |
| `E2E_TIMEOUT` | `30_000` ms | Per-action Playwright timeout, line 19 |
| `E2E_AUTH_TIMEOUT` | inherits `E2E_TIMEOUT` | The post-auth wait, tunable apart because login is the slowest step and spikes on a contended runner, line 28 |
| `E2E_AUTH_GRACE` | `15_000` ms | Grace window in which a transient error alert during a successful `forceLoad` is not treated as a failure, line 39 |
| `E2E_SLOWMO` | `0` ms | Delay between Playwright actions (for visual debugging), line 46 |
| `E2E_BROWSER` | `chromium` | Engine: `chromium`, `firefox`, or `webkit`; unknown values fall back to Chromium, line 54 |
| `E2E_TRACE` | unset | A file path (or a directory, for per-failing-test traces) to capture a full-speed Playwright trace, line 64 |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | `admin@localhost` / `Admin123!` | Seeded admin credentials, lines 72, 75 |
| `E2E_CUSTOMER_EMAIL` / `E2E_CUSTOMER_PASSWORD` | `user@localhost` / `User123!` | Seeded user credentials, lines 84, 87 |

Downstream projects supply app-specific defaults via `[ModuleInitializer]` on the `Default*`
setters. Environment variables always take precedence. [Rubric §22, Responsive & Cross-Browser]:
`E2E_BROWSER` is the mechanism for running the same suite against all three browser engines in CI.

#### `PlaywrightFixture` + `E2ETestCollection`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6`

`PlaywrightFixture` is an xUnit v3 `IAsyncLifetime` collection fixture. `InitializeAsync()` (line 11)
creates a `IPlaywright` instance, then resolves the browser type from `E2ETestConfiguration.Browser`
via a switch on the upper-cased value (lines 17-22): `"FIREFOX"` to `Playwright.Firefox`,
`"WEBKIT"` to `Playwright.Webkit`, any other value to `Playwright.Chromium`. The comment above the
switch (lines 15-16) calls out the rubric §22 cross-browser intent explicitly. `DisposeAsync`
(line 31) disposes browser and playwright in order. `E2ETestCollection` (line 40) is the xUnit
`[CollectionDefinition]` that wires the fixture to all classes decorated with
`[Collection(E2ETestCollection.Name)]`.

#### `E2ETestBase`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:8`

The abstract base all E2E test classes inherit from. Decorates itself `[Collection(E2ETestCollection.Name)]`
(line 7) so it receives the `PlaywrightFixture` singleton. `InitializeAsync()` (line 19) creates a
fresh `IBrowserContext` (with `IgnoreHTTPSErrors: true` for local dev TLS), sets `DefaultTimeout`
from config, optionally starts a trace, and opens a new `IPage` per test. `DisposeAsync()` (line 39)
stops any trace, closes the page and disposes the context, guaranteeing test isolation at the
browser-session level.

Key methods:

- `LoginAsync(email, password)` (line 85), clears any existing session from **both** token stores
  (localStorage for WASM/MAUI hosts and the HttpOnly session cookie for the Blazor Server host,
  lines 93-109; clearing only localStorage would leave the next login authenticated as the wrong
  user), navigates to `/login`, fills email and password via `FillFieldAsync`, clicks "Sign in", then
  settles the result through `WaitForAuthResultAsync` (line 201).
- `WaitForAuthResultAsync(authPagePath, operation)` (line 201) races **three** signals with
  `Task.WhenAny` (line 210): the `forceLoad` URL change away from the auth page, the logout button
  appearing, and an error alert appearing. The URL change is the interactivity-independent success
  signal; only an error alert still showing on the auth page after the grace window
  (`AuthSucceededWithinGraceAsync`, line 229) is a real failure, and it throws
  `InvalidOperationException` with the alert text so tests get a meaningful message rather than a
  timeout.
- `LoginAsAdminAsync()` (line 79) / `LoginAsUserAsync()` (line 82) delegate to `LoginAsync` with
  credentials from `E2ETestConfiguration`.
- `RegisterNewUserAsync(firstName?, lastName?)` (line 134), synthesizes a unique email with
  `Guid.NewGuid().ToString("N")[..8]`, fills the registration form, submits, and settles through
  the same three-signal wait.
- `WaitForInteractiveOrReloadAsync()` (line 180), waits for interactivity after a post-auth
  `forceLoad` and, if that fails, **reloads once** and waits again rather than re-waiting on the
  same stalled boot. It catches `TimeoutException` as well as `PlaywrightException`, because
  Playwright's timeout derives from `System.TimeoutException` and the narrower catch skipped the
  retry entirely.
- `FillFieldAsync(ILocator, string)` (line 257), delegates to `PageExtensions.FillAndVerifyAsync`,
  the shared Blazor re-hydration guard (see below).
- `UniqueId()` (line 260), eight-char GUID fragment for unique test data.
- `ScanGridAsync()` (line 271) and `ScanAsync()` (line 281), the two accessibility entry points.
  `ScanAsync` waits for any loading bar to clear then asserts the strict `AxeOptions.Wcag21Aa`
  (line 284); `ScanGridAsync` additionally waits for a seeded data row (line 273) then asserts with
  the one recorded exception, `AxeOptions.Wcag21AaExceptMudPagerCombobox` (line 276). **Which helper
  a page uses is the declaration of which rule set applies to it.**

#### `AxeOptions`, the named WCAG 2.1 AA contract (ADR-063)
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9`

"Run axe" is not a contract: axe ships advisory best-practice rules alongside the WCAG rule sets, so
two repos running the same tool with different options measure different things. `AxeOptions` makes
the target a shipped, versioned symbol
([ADR-063](https://ivanball.github.io/docs/adr/063-accessibility-conformance-gate.html)).

- `Wcag21Aa` (line 17) pins every scan to a `RunOnly` tag list of exactly `wcag2a`, `wcag2aa`,
  `wcag21a`, `wcag21aa` (line 22): levels A and AA across WCAG 2.0 and 2.1. axe's best-practice
  rules are deliberately out of scope (lines 12-15), which is what makes the gate blockable: every
  failure is a real conformance violation, never an advisory finding.
- `Wcag21AaExceptMudPagerCombobox` (line 35) carries the same four tags (line 40) and disables a
  single rule, `aria-input-field-name` (line 44). It is the **only** recorded exception, and it
  exists for pages whose sole combobox is MudBlazor's own `MudTablePager` "rows per page" select:
  MudBlazor 9.6.0 mirrored combobox semantics onto the MudSelect presenter but gives the pager's
  select no accessible name, and `MudTablePager` exposes no `Label`/`aria-label` parameter, so it is
  not fixable from app markup (lines 26-33). Every other WCAG 2.1 AA rule still runs on those pages.
  The trade-off is real: the rule is disabled for the whole page scan, not just the pager node, so
  the "use only where the sole combobox is a pager" convention is enforced by review, not by the
  compiler.

Writing the exception as a second named constant rather than a suppression flag forces the caller to
say which contract it is scanning under, and keeps the justification attached to the thing excepted.

#### `PageExtensions`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:19`

C# preview `extension(IPage page)` and `extension(ILocator locator)` blocks that isolate Blazor
InteractiveAuto rendering quirks:

- `WaitForBlazorAsync(timeout)` (line 27), polls `window.Blazor?._internal` until truthy
  (the runtime is ready), then evaluates two `requestAnimationFrame` + 500ms to let the
  render pipeline flush. Without this, event handlers are not attached and clicks/fills are
  silently ignored.
- `GotoAndWaitForBlazorAsync(path)` (line 47), combines `GotoAsync` + `WaitForLoadStateAsync(Load)`
  (not `NetworkIdle`, Blazor's SignalR WebSocket keeps a persistent connection open, so
  `NetworkIdle` is never reached) + `WaitForBlazorAsync`.
- `BlazorNavigateAsync(path)` (line 62), uses `Blazor.navigateTo` for client-side SPA
  navigation (avoids a full page reload), then polls `window.location.pathname` rather than calling
  `WaitForURLAsync` (whose default `WaitUntil=Load` hangs on a same-document navigation, lines 76-79).
- `GotoProtectedAsync(path)` (line 104), the auth-protected variant: SSR cannot read JWTs from
  localStorage, so a full page load to an `[Authorize]` page redirects to `/login`. This ensures the
  runtime is available (loading a public page first if needed) and re-routes via `"/"` so the target
  path always triggers a fresh component lifecycle.
- `WaitForPageAndBlazorAsync()` (line 141), waits for `Load` state + render flush; use
  after link/button clicks that trigger full-page navigation.
- `FillAndVerifyAsync(value, timeout)` (line 197), fills a form field then asserts
  `ToHaveValueAsync` with Playwright's built-in retry. If the pre-render value was wiped by
  re-hydration (a common Blazor InteractiveAuto timing bug), it falls back to `PressSequentiallyAsync`
  with 20ms key delay and re-asserts. This is the single shared fill helper for the whole E2E layer.
- `ClickAndVerifyAsync(expected, timeout)` (line 230), the submit-side counterpart: a click that
  lands before the runtime wires `@onclick` is silently ignored, so this clicks, waits a slice of the
  timeout for the visible effect, and re-asserts interactivity before retrying. A genuinely applied
  click surfaces its effect within one slice, so there is no double submit.
- `ClickAndWaitForUrlAsync(page, urlPattern)` (line 273), the navigation-side counterpart, for
  in-cell grid links (clicking the row itself lands on cell padding between the inline anchors and
  does nothing).
- `AssertNoAccessibilityViolationsAsync(options?)` (line 157), runs `page.RunAxe()` from
  `Deque.AxeCore.Playwright`, collects violations, and throws `AccessibilityViolationException`
  (line 180) if any are found. The message carries each rule's impact, id, help text, node count and
  the offending markup compacted to one line per node (lines 170-178), so a red gate points at the
  element rather than at a dashboard. [Rubric §21, Accessibility]: §21 assesses whether the app meets
  WCAG 2.1 AA; this extension method is the single enforcement point.

#### `AccessibilityViolationException`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7`

A typed exception thrown by `AssertNoAccessibilityViolationsAsync`. Giving axe-core violations
their own exception type means test runners display the violation summary in the failure message
without requiring the test author to parse raw JSON.

#### `WebVitalsCollector`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs`

Collects Core Web Vitals from a live page so a budget can be asserted in the browser tier;
MMCA.Common's `WebVitalsE2ETests` is its worked consumer.

#### Page objects: `LoginPage`, `RegisterPage`, `ProfilePage`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/PageObjects/`

Pre-built page-object models for the three Identity pages that every downstream app shares.
`LoginPage` and `RegisterPage` encapsulate form locators and the fill/submit sequence; they use
`FillAndVerifyAsync` internally. `ProfilePage` exposes profile-field locators and the "Change
Password" / "Delete Account" button locators. Downstream projects extend by composition or
inheritance.

#### Workflow base classes
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/`

Six abstract test bases: five for the standard Identity workflows
(`UserLoginTestsBase`, `UserRegistrationTestsBase`, `ProfileManagementTestsBase`, `LogoutTestsBase`,
`AuthorizationTestsBase`, all under `Workflows/Identity/`) and one for user preferences
(`Workflows/Preferences/UserPreferencesTestsBase.cs`). Each extends `E2ETestBase`, provides
concrete `[Fact]` methods that apply to any app using `MMCA.Common`'s Identity UI, and the login,
register and profile bases each call `AssertNoAccessibilityViolationsAsync(AxeOptions.Wcag21Aa)`
once the page is interactive (`UserLoginTestsBase.cs:83`, `UserRegistrationTestsBase.cs:91`,
`ProfileManagementTestsBase.cs:180`). A downstream app's E2E suite inherits from these bases and
optionally overrides or adds app-specific assertions.
[Rubric §21, Accessibility]: axe-core is called **in the base**, not in the consumer, so an app that
adopts the Identity workflow tests cannot accidentally adopt them without the a11y scan. Opting out
is visible, because it means not subclassing the base: MMCA.Store subclasses all three, MMCA.ADC
subclasses login and register but derives its `ProfileManagementTests` from `E2ETestBase` directly
(its profile page supports only password change and account deletion), and MMCA.Helpdesk has no E2E
project at all.

### MMCA.Common.Testing.UI

`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/`, 15 types, shipped as `MMCA.Common.Testing.UI`.
This is the bUnit half of the two-tier UI strategy, consumed by every `*.UI.Tests` project across the
repos.

- `BunitComponentTestBase` (`Infrastructure/BunitComponentTestBase.cs:33`) extends bUnit v2's
  `BunitContext` and, in its constructor (lines 40-53), registers MudBlazor services, puts JSInterop
  in `Loose` mode (so MudBlazor components that probe JS during render do not throw), adds
  `AddAuthorizationCore` with a permissive-but-real `IsAuthenticatedAuthorizationService`, registers a
  **mutable** `AuthenticationStateProvider`, and adds logging plus localization (so components that
  inject `IStringLocalizer<T>` render without per-test setup).
- The provider is mutable (`MutableAuthenticationStateProvider`, line 97) because it must serve both
  cascading-`AuthenticationState` consumers and pages that call `GetAuthenticationStateAsync()` on the
  injected service. `RenderAs<TComponent>(principal, parameters)` (line 65) sets the principal and
  renders with a matching cascading value; `RenderUnderTest<TComponent>` (line 59) is the anonymous
  shortcut; `SetUser` (line 56) changes the principal mid-test.
- `RenderMudProviders()` (line 83) renders MudBlazor's popover, dialog and snackbar providers into the
  test's render root so a component that opens a `MudMessageBox` or raises a snackbar has somewhere to
  render, returning the handles as a `MudProviderHandles` record (line 92).
- The remaining types are supporting doubles: `TestPrincipal`, `MarkupSnapshot`,
  `BunitInteractionExtensions`, `HttpTestDoubles`, `CapturingHttpMessageHandler`,
  `StubTokenStorageService`, and `UiHttpServiceHarness`.
- The class remarks (lines 25-31) record the version pin worth knowing: it is written against bUnit v2
  (the line compatible with xUnit v3 and Microsoft Testing Platform), and if a restore ever resolves
  v1.x, this file is the only place that changes.

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

**The rule bodies live once, in a shipped package.** `MMCA.Common.Testing.Architecture` holds the
reusable rule library (the `ArchitectureRules.*` partial classes: `Layers`, `Purity`, `Transport`,
`Modules`, `Handlers`, `Entities`, `Naming`, `Events`, `Controllers`, `Governance`,
`HandlerResults`, `Immutability`, `Slices`, `Specifications`, `Localization`, `LocalizedText`) and
**31 abstract `*TestsBase` classes**, one per rule family, in `Bases/`, all parameterized by an
`IArchitectureMap`. The package declares **96 test methods across those 31 bases**, and MMCA.Common's
own build executes **61** of them: the methods of the bases its arch-tests subclass, plus its
Common-only direct tests (`MMCA.Common/FACTS.md:44,47-48`, which is generated from source and
CI-gated, so it is the number to quote rather than a hand count).

Each repo's `*.Architecture.Tests` project consumes the package and supplies its own map:
`CommonArchitectureMap` (MMCA.Common, every layer is a framework layer, one anchor type per package),
`AdcArchitectureMap` (adds the per-module Identity/Conference/Engagement layers),
`StoreArchitectureMap` and `HelpdeskArchitectureMap`. A concrete test class is then a short sealed
subclass, e.g.:

```csharp
public sealed class LayerDependencyTests : LayerDependencyTestsBase
{
    protected override IArchitectureMap Map { get; } = new CommonArchitectureMap();
}
```

(`MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9-12`). The map's anchor types
(`CommonArchitectureMap.cs:21-27`, e.g. `typeof(Common.Domain.Entities.BaseEntity<>).Assembly` at
line 22) mean the assembly path is always the one actually compiled into the test run, not a
hard-coded path. Because all four repos drive the same rule bodies, the architecture rules stay
identical across them and a fix to a rule propagates with the next package bump rather than needing a
hand-copy. `MMCA.Common.UI.Maui` is deliberately absent from the Common map
(`CommonArchitectureMap.cs:9-13`): its four MAUI TFM assemblies cannot load in the ubuntu-run
`net10.0` test process, so its layer boundary is enforced at compile time by
`EnforceUIMauiLayerBoundary` and the windows `build-maui` job instead.

The walkthroughs below describe **what each rule enforces** (and the count of facts it produces);
the rule *implementations* live in the shared package's `ArchitectureRules.*` + `*TestsBase` files,
not in the per-repo test class.

### MMCA.Common.Architecture.Tests, 26 types

Located at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/`. Nineteen are fitness-function
classes; the rest are `CommonArchitectureMap` and per-test fixtures. Thin subclasses of the shared
bases: `LayerDependencyTests`, `DomainPurityTests`, `MicroserviceExtractionTests`, `PiiConventionTests`,
`AggregateConventionTests`, `DependencyVersionTests`, `EventVersioningConventionTests`,
`SliceCohesionTests`, `HandlerResultConventionTests`, `RawQueryableConventionTests`,
`UIArchitectureConventionTests`, `StateManagementConventionTests`, `LocalizationResourceTests`,
`LocalizedTextConventionTests`. Five are Common-only direct tests, not subclasses of a mapped rule:
`FrameworkSanityTests`, `PiiErasureContractFitnessTests`, `SpecificationFitnessTests`,
`NavigationContractTests`, and `ObservabilityConventionTestsBaseTests`.

Three of those five deserve naming, because they exist to stop a gate becoming a decoration:

- `PiiErasureContractFitnessTests` forces a representative `[Pii]`-carrying data subject through
  `PiiRedactor` and `IAnonymizable` end to end, because the mapped `PiiConventionTests` scan is
  structurally vacuous in a framework that ships no data-subject entity.
- `SpecificationFitnessTests` tests the rule itself: it asserts
  `SpecificationsDoNotNavigateToOtherEntities` flags a navigating specification and does **not** flag
  a scalar one.
- `ObservabilityConventionTestsBaseTests` subclasses `ObservabilityConventionTestsBase` from a
  *different assembly* than the base, because the base must read the embedded IaC resources of the
  subclass's assembly. Resolving against the base's own assembly would be a silent break that the
  framework's own CI would never catch.

#### `LayerDependencyTests`
`MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9`

15 `[Fact]` methods from `LayerDependencyTestsBase`
(`MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:26-69`): two anti-vacuity guards
plus one per forbidden directed edge in the layer graph.

- `LayerMap_DeclaresEveryExpectedLayer` and `LayerMap_ModulesDeclareEveryExpectedLayer` (2 facts,
  lines 27 and 30). These assert the map actually declares the five core layers (line 17) and that
  every declared module registers them too, so a map that quietly stopped covering an assembly cannot
  leave the rules below passing on nothing.
- `Domain_ShouldNotDependOn_Application/Infrastructure/Api` (3 facts, lines 33-39)
- `Application_ShouldNotDependOn_Infrastructure/Api` (2 facts, lines 42-45)
- `Infrastructure_ShouldNotDependOn_Api` (1 fact, line 48)
- `Shared_ShouldNotDependOn_Domain/Application/Infrastructure/Api` (4 facts, lines 51-60)
- `Ui_ShouldNotDependOn_Domain/Application/Infrastructure` (3 facts, lines 63-69)

The last three confirm the two deliberate exceptions to the standard stack (`UI` and `Grpc` depend
only on `Shared`) are honored in the other direction, `UI` must not depend on Application,
Infrastructure, or Domain.

#### `DomainPurityTests`
`MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9`

4 facts (`Bases/DomainPurityTestsBase.cs:14-24`). Two assert Domain and Shared contain no reference to
the forbidden framework list, which lives once in `ArchitectureRules.Purity`
(`ArchitectureRules.Purity.cs:9-22`): `Microsoft.AspNetCore`, `Microsoft.EntityFrameworkCore`,
`Serilog`, `AutoMapper`, `Newtonsoft.Json`, `FluentValidation`, `Scrutor`, `MudBlazor`, `Polly`,
`Stripe`, `StackExchange.Redis`. The other two assert Application depends on neither
`Microsoft.EntityFrameworkCore` nor `Microsoft.AspNetCore`. A repo extends the list rather than
replacing it: `ExtraForbiddenDomainDependencies` (base line 12) is how ADC adds `RabbitMQ`
(`MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:9`).
[Rubric §3, Clean Architecture]: this is the runtime enforcement that the domain is genuinely
framework-independent, not just convention.

#### `MicroserviceExtractionTests`
`MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10`

One fact, `CoreLayers_ShouldNotDependOn_Transport`
(`Bases/MicroserviceExtractionTestsBase.cs:13`), enforcing the transport-isolation invariant for
microservice extraction ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)):
MassTransit, gRPC and Protobuf must never leak into Domain, Application or Shared, so a module
behaves identically in-process or extracted and the split stays reversible.

The Common-only sanity checks the shared library does not generalize live in **`FrameworkSanityTests`**
(`MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:13`), not in `MicroserviceExtractionTests`.
Six facts (lines 21-49): `Grpc` must not depend on `Domain`, `Application` or `Infrastructure`
(lines 22, 27, 32); `IMessageBus` lives in `Application` (line 37); `IJwksProvider` lives in
`Infrastructure` (line 42); and `ILiveChannelPublisher` lives in `Application` beside
`IPushNotificationSender`, so application code stays transport-free (line 47). These pin the
abstractions and the transport package to their correct layer so a future refactor cannot quietly
move them. They are Common-only because MMCA.Common is the one repo that owns the
`MMCA.Common.Grpc` transport package and defines those abstractions
(`FrameworkSanityTests.cs:9-11`).

#### `PiiConventionTests`
`MMCA.Common.Architecture.Tests/PiiConventionTests.cs:14`

1 fact, `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable`
(`Bases/PiiConventionTestsBase.cs:12`): any domain entity bearing a `[Pii]`-decorated property must
implement `IAnonymizable` ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)),
so it has an erasure path. The scan passes vacuously in the framework (MMCA.Common's Domain ships no
data-subject type) and fails the build the moment one is added without an erasure path. That vacuity
is exactly why `PiiErasureContractFitnessTests` exists beside it.
[Rubric §30, Compliance, Privacy & Data Governance]: §30 assesses whether GDPR/CCPA erasure
obligations are structurally enforced; the pair is the structural gate plus its non-vacuous proof.

#### `AggregateConventionTests`
`MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9`

4 facts checking DDD factory conventions (`Bases/AggregateConventionTestsBase.cs:14-24`). This is the
minimal aggregate base, for repos with no business modules; module-bearing repos use the fuller
`EntityConventionTestsBase` instead (base doc, lines 4-8).

- `Domain_ShouldExpose_AggregateRoots` (line 15), asserts the filter finds at least one aggregate
  root, guarding against the whole class becoming vacuous.
- `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 18), every aggregate root is built
  via a static `Create(...)` returning `Result<T>`.
- `AggregateRoots_ShouldHave_NoPublicConstructors` (line 21), the factory is the only way in.
- `DomainFactories_ShouldReturn_Result` (line 24), the same Result-returning convention holds for
  every domain and value-object `Create`.

[Rubric §4, Domain-Driven Design]: §4 assesses whether the domain model is authentic DDD; factory
method plus `Result<T>` return plus no public constructor is the DDD "a factory prevents invalid
entity construction" pattern, here enforced automatically rather than by review.

#### `DependencyVersionTests`
`MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9`

A one-line subclass of `DependencyVersionTestsBase`, which holds two facts, one per commercial-license
trap. Each loops an overridable package-id list and calls `ArchitectureRules.PinnedPackageMajorBelow`,
which parses `Directory.Packages.props` by walking up from `AppContext.BaseDirectory`:

- `MassTransit_MustNotExceed_MajorVersion8` (`Bases/DependencyVersionTestsBase.cs:25`) over the three
  MassTransit ids (lines 17-22): `MassTransit`, `MassTransit.RabbitMQ`,
  `MassTransit.Azure.ServiceBus.Core`, with an exclusive major ceiling of 9.
- `ImageSharp_MustNotExceed_MajorVersion3` (line 48) over `SixLabors.ImageSharp` (line 45), ceiling 4.
  ImageSharp v4 needs a Six Labors license key at **build** time, so a blanket bump breaks every build.

MMCA.Common is the only repo that declares this class, and deliberately so: the consumers do **not**
pin MassTransit (it flows transitively through `MMCA.Common.Infrastructure`), so subclassing with the
default list would assert a pin they do not declare (base doc, lines 8-13). [Rubric §32, Dependency &
Supply-Chain]: §32 assesses whether dependency versions are tracked, pinned, and protected against
accidental bumps; this is the build-time gate for the most dangerous version upgrades in the codebase.
(See the primer `00-primer.md#nuget-lock-files--pinned-audited-sources` for context.)

### MMCA.ADC.Architecture.Tests, 30 types

Located at `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/`: 29 fitness-function classes
plus `AdcArchitectureMap`. Like the Common project, most are thin subclasses of the shared
`*TestsBase` classes from `MMCA.Common.Testing.Architecture`, referenced as a NuGet package
(`MMCA.ADC.Architecture.Tests.csproj:41`; the project also references `MMCA.Common.Testing` at line
43 for `DecoratorPipelineOrderTestsBase`). Each supplies `AdcArchitectureMap`
(`AdcArchitectureMap.cs:8`), which declares the five MMCA.Common framework layers (lines 15-19) and
then six layers each for Identity, Conference and Engagement (lines 22-40). The rule bodies are
shared; only the map and the per-repo overrides differ.

The csproj also embeds three files as resources (`MMCA.ADC.Architecture.Tests.csproj:11-22`), because
three of the gates read artifacts rather than assemblies: the shared `ADCHome.razor.css` for the
brand-token guard, and `infra/main.bicep` plus `infra/OPERATIONS.md` for the SLO alert-to-runbook
pairing guard.

#### `LayerDependencyTests` (ADC)
`MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3`

The same 15 facts as the Common subclass, but the map iterates every framework layer **and** every
declared module layer, so each rule runs once per assembly. The two anti-vacuity guards matter more
here: `LayerMap_ModulesDeclareEveryExpectedLayer` fails if a module stops declaring one of the five
core layers, which is what stops a new module silently escaping the dependency rules.

#### `ModuleIsolationTests`
`MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3`

The cross-module boundary rules, the modular monolith's core governance: a module's Domain must not
depend on any other module's Domain, its Application not on another's Application, Infrastructure
not on another's Infrastructure, API not on another's API, and neither Domain nor Application may
reach into another module's Infrastructure. Cross-module communication is allowed only through
`*.Shared` (contract) layers and DI-injected interfaces. The "all other modules' namespaces at this
layer" list is generated dynamically by `ModuleIsolationTestsBase` / `ArchitectureRules.Modules` from
the modules declared in `AdcArchitectureMap`, so adding a module extends the rule with no edit here.

#### `MicroserviceExtractionTests` (ADC)
`MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3`

The same single transport-isolation fact, applied across all ADC module layers. The shared rule's
transport namespace set covers `MassTransit`, `Grpc`, and `Google.Protobuf`. For Domain, Application
and Shared of all three modules, plus the Common Domain/Application layers, none of these may appear.
Transport belongs only in Infrastructure, the `*.Service` hosts, and `*.Contracts` projects.
A NetArchTest quirk worth knowing: it matches by namespace *prefix*, so `'Grpc'` catches
`Grpc.Core` / `Grpc.Net.*` / `Grpc.AspNetCore` but NOT the project's own `MMCA.Common.Grpc` (which starts
with `MMCA`), so the rule does not accidentally flag the framework's own transport package.

#### `PiiConventionTests` (ADC)
`MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3`

The same rule, but the ADC map makes it non-vacuous: the Identity `User` aggregate is PII-bearing, so
the `[Pii]` to `IAnonymizable` check actually has a subject. The Conference `Speaker` is deliberately
not marked, because speaker names and emails are public agenda content sourced from Sessionize, not
app-user PII subject to the privacy policy's erasure right.

#### The remaining ADC classes

The first group is bare subclasses, one line of map and nothing else. The second group carries a
per-repo override, which is where the interesting decisions live.

| Class | Focus |
|---|---|
| `DomainPurityTests` | Framework-independence of all module Domain layers; adds `RabbitMQ` to the forbidden list (line 9) |
| `HandlerConventionTests` | Command/query handlers implement the right interface |
| `ConcurrencyConventionTests` | Every `*UpdateRequest` implements `IConcurrencyAware` (the ADR-035 optimistic-concurrency round-trip) |
| `EntityConventionTests` | Entities inherit the correct base class and use `Create(...)` factories |
| `NamingConventionTests` | Handler/repo/service naming follows conventions |
| `EventConventionTests` | Integration events inherit `BaseIntegrationEvent`, declare a `SchemaVersion`, live in a `*.IntegrationEvents` namespace (ADR-010) |
| `ImmutabilityTests` | DTOs, events and value objects are immutable (records, no public setters) |
| `SharedLayerTests` | Shared projects contain only DTOs, enums, identifier aliases |
| `SliceCohesionTests` | Each `Application/{Aggregate}/UseCases/{Operation}/` slice keeps its command/query, handler and validator in one namespace (§5) |
| `MicroserviceExtractionTests`, `LayerDependencyTests`, `ModuleIsolationTests`, `PiiConventionTests` | Covered above |
| `HandlerResultConventionTests` | Every handler's `TResult` is `Result` or `Result<T>`, turning the pipeline's runtime `ResultFailureFactory` constraint into a build-time gate |
| `FrameworkVersionConsistencyTests` | All `MMCA.Common.*` pins in `Directory.Packages.props` share one version: ADR-016 lockstep made executable, so a partial sweep reds at CI time |
| `SpecificationConventionTests` | No specification filters by navigating to another entity (which would not translate if that entity moved data source); kept on as a forward safeguard after the Cosmos/SQLite trial was reverted (ADR-018) |
| `StateManagementConventionTests` | The three module UI assemblies carry no mutable static state (a static member is shared across every Blazor Server circuit) and stateful UI services stay scoped (§19) |
| `UIArchitectureConventionTests` | Every code-behind under `Source/` stays within the 400-line cap and inline `@code` blocks stay small (§18) |

| Class with a per-repo override | The decision it encodes |
|---|---|
| `ControllerConventionTests` | Controllers inherit `ApiControllerBase` and declare `[ApiVersion]`, with exactly two exemptions (lines 11-15): `OAuthController` drives the OAuth2 redirect/challenge flow and `ServiceInfoController` is an anonymous version-discovery diagnostic, so neither returns domain Results |
| `IntegrationEventContractTests` | Freezes the cross-service async wire contract as three literal signatures (lines 9-14): `SpeakerLinkedToUser`, `SpeakerUnlinkedFromUser`, `UserRegistered`. Reshaping one without versioning it reds the build |
| `ConstructorDependencyCountTests` | Single-responsibility ceiling of 7 (line 21). The comment (lines 10-15) records why it was tightened from 8: nothing exceeded 7, so the gate carried a phantom slot of headroom, which is the one thing a ceiling exists to prevent |
| `RawQueryableConventionTests` | Application code must not use the repository's raw `IQueryable` surfaces (EF-coupled handlers cannot move behind a gRPC boundary). The allowlist is an adoption ratchet pinning existing deliberate uses so only NEW code is blocked; it also appends the unmapped thin Notification module (lines 21-30) |
| `FormsConventionTests` | The six Conference create forms keep their `UnsavedChangesGuard`, dirty tracking, validated `MudForm` and per-form error summary (§24), plus a bespoke fact for the Identity Profile form, which does not match the `*Create.razor` glob (line 32) |
| `LocalizedTextConventionTests` | No hard-coded user-visible literals in `.razor`; `MinimumScannedFiles = 60` (line 18) is the anti-vacuity floor against ADC's ~77 razor files |
| `TranslationCompletenessTests` | Every base `.resx` has a complete, non-empty `.es.resx` sibling; `MinimumBaseResources = 40` (line 16) is the floor (§27, ADR-027) |
| `BrandColorTokenTests` | The shared `ADCHome` stylesheet sources the primary brand color from `var(--mmca-primary)`, not a re-hardcoded hex (§20). Reads the embedded CSS, not an assembly |
| `DataResidencyTests` | The data-residency statement in `PRIVACY.md` must match the region where PII is actually provisioned, extracted from the `SQL_LOCATION_OVERRIDE` default in `deploy.yml` (lines 20-31). `ForbiddenResidencyClaims` blocks the stale "central United States" wording that once contradicted the deployed region (§30) |
| `ObservabilityConventionTests` | Every provisioned SLO alert in `infra/main.bicep` keeps a matching, severity-correct section in `infra/OPERATIONS.md`, and no orphan runbook sections exist (§13). Reads the two embedded resources |
| `DecoratorPipelineOrderTests` | The ADR-058 runtime conformance base, driven against the real `ChangePreferencesCommand` / `GetUserPreferencesQuery` pair through the Identity module's genuine registration sequence (lines 28-40) |

### The same rules in Store and Helpdesk

MMCA.Store's `MMCA.Store.Architecture.Tests` subclasses the same bases over `StoreArchitectureMap`.
MMCA.Helpdesk is the interesting case, because it is the reference app: its whole architecture suite
is **one file** of 19 one-line subclasses over `HelpdeskArchitectureMap`
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:5-137`),
which is the intended cost of adoption made visible. Its trailing comment (lines 139-143) is worth
reading: it records which bases are **not** adopted and why, separating "legitimately inapplicable"
(`ConstructorDependencyCountTestsBase` deliberately fails when it finds no Application `*Service`, and
this seed's Application layer is handlers-only; `DataResidency`/`BrandColorToken`/`FormsConvention` are
reduced-scope) from an enforcement gap. That distinction is the difference between an audited inventory
and an unexamined one.

---

## 5. Integration and E2E strategy

### Per-service integration tests (SQL-gated)

The four integration test projects (Identity, Conference, Engagement, Notification) each boot their
service in-process with `WebApplicationFactory<Program>`. **The lifecycle is not written per repo:**
it lives once in `SqlServerIntegrationTestFixtureBase<TEntryPoint>`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27`), and the
concrete fixture supplies only the host-specific delta. Reading the base is what tells you what a
test run actually does:

1. **Database creation.** A throwaway SQL Server database is created with a GUID-embedded name,
   `{DatabaseNamePrefix}_{Guid:N}` (line 71), on the server given by the repo's
   `SqlBaseEnvironmentVariable`. If that variable is absent it defaults to
   `(localdb)\MSSQLLocalDB` (lines 69-70).
2. **Environment injection.** Before the host builds, `ASPNETCORE_ENVIRONMENT=Testing` and the
   connection string are pushed as **process environment variables** (lines 75-76), then the
   subclass pushes its own (line 77). Process variables rather than `ConfigureAppConfiguration`
   because the host reads these at configure-time, before `WebApplicationFactory`'s
   `ConfigureServices` override runs. Pinning `Testing` also stops `appsettings.Development.json`
   loading, whose `DataSources` entry would point the module at `localhost` (base doc, lines 18-21).
   Only the **first** original value per key is recorded (line 149), so re-pushing a key cannot
   clobber the restore point, and every one is restored on disposal (line 157).
3. **Schema migration.** Creating the first `HttpClient` (line 83) forces `Program.cs` to run, which
   calls `InitializeDatabaseAsync(DatabaseInitStrategy.Migrate)`: the host's own init strategy
   applies the migrations, so the schema under test is the one production produces, not a fixture's
   guess.
4. **Per-test reset via Respawn.** `Respawner.CreateAsync` (line 90) configures Respawn to delete
   all rows except `__EFMigrationsHistory` (line 93). Each test calls `ResetDatabaseAsync()`
   (line 99) through `IntegrationTestBase.InitializeAsync()` before its body runs. This is faster
   than dropping and re-creating the database and handles foreign key cascades automatically.
5. **Disposal.** `SqlConnection.ClearAllPools()` releases pooled connections so the database is free
   to drop (line 170), then a `SET SINGLE_USER WITH ROLLBACK IMMEDIATE` + `DROP DATABASE` removes it
   (lines 180-183). The GUID name is server-generated, never user input, which is why the CA2100
   suppression there is safe (line 179).

The Identity fixture is what is left after all that:
`IdentityIntegrationTestFixture` (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:22`)
declares `ADC_TEST_SQL_BASE` (line 24) and `ADC_IdentityIntegrationTest` (line 26), returns its
factory (line 28), and overrides `ConfigureTestEnvironment` (line 39) with the four Identity-specific
concerns: the committed RS256 test keypair and `kid` (lines 43-46), a lifted registration throttle so
the register tests can create several accounts from one IP (line 49), and dummy OAuth client
credentials so the Google/GitHub challenge endpoints wire up without any real provider call
(lines 55-59). It is left **non-sealed** (doc, lines 17-20) so `JwksEnabledIdentityFixture` can add
the single JWKS-publishing delta.

Cross-service gRPC edges are faked for isolation: the non-Identity services re-point their
`AddForwardedJwtBearer` scheme at the in-process test key, and gRPC clients that would call other
services use stub implementations. This keeps each integration suite testing only its own service's
behavior. [Rubric §14, Testability]: §14 awards credit for isolation, per-test DB reset plus
per-service `WebApplicationFactory` means each test is truly independent.

### Testcontainers tiers: where the fakes stop

The fakes above are the point of the per-service tier, and also its limit: nothing in it exercises a
real broker or a real cross-service call. Two Docker-dependent projects close that gap, both in
`MMCA.ADC.slnx` but in neither `.slnf`, so a full `dotnet test --solution MMCA.ADC.slnx` needs a
Docker daemon.

- `MMCA.ADC.CrossService.IntegrationTests` (12 types) boots the three REST hosts in one process
  against real SQL Server and RabbitMQ containers and drives the genuine outbox to broker to
  consumer round-trip (the `UserRegistered` speaker auto-link, the `SpeakerLinked`/`Unlinked`
  back-link) plus the real Conference to Engagement gRPC read.
- `MMCA.ADC.ServiceBusEmulator.IntegrationTests` (3 types) smokes MassTransit against the official
  Azure Service Bus emulator for broker parity.

Neither is in `deploy.needs`, because the gating jobs have no Docker daemon. CrossService instead
runs on a weekday-nightly schedule (`cross-service-tests.yml`) and its **recency** gates the deploy
through `cross-service-freshness` (`MMCA.ADC/.github/workflows/deploy.yml:663-675`): the deploy fails
if the last successful run is stale. That is the general pattern for a tier too expensive to run
per-deploy: gate on the freshness of the evidence rather than on the run itself. MMCA.Store mirrors
the arrangement exactly, with `MMCA.Store.CrossService.IntegrationTests` and
`MMCA.Store.ServiceBusEmulator.IntegrationTests` behind its own `cross-service-freshness` gate.

### MMCA.Common unit-level infrastructure tests

`MMCA.Common.Infrastructure.Tests` (204 types) uses SQLite-backed `EnsureCreated` contexts for
tests that need a real EF pipeline. SQLite avoids the SQL Server dependency entirely, which is why
`MMCA.Common` builds and tests without any SQL Server or Docker in the local environment. The tradeoff
is that SQLite does not support all SQL Server features (row-level locking, certain index
hints), but EF Core's cross-provider abstraction is sufficient for the behaviors being tested
(outbox persistence, repository queries, soft-delete filters). Where the storage FORMAT itself is the
thing under test, SQLite is not enough: `MMCA.Common.Infrastructure.Redis.Tests` exists precisely
because a counter written as a string and read back as a hash round-trips fine against a mocked
`IDistributedCache` and answers WRONGTYPE against a real server, so that one project runs Redis via
Testcontainers, out of the slnx.

### E2E tests

`MMCA.ADC.E2E.Tests` (60 types) and `MMCA.Common.UI.E2E.Tests` (11 types) require either the
full Aspire stack (`dotnet run --project Source/Hosting/MMCA.ADC.AppHost`) or the Gallery
backend (`MMCA.Common.UI.Gallery`) respectively. The Aspire AppHost starts SQL Server, Redis,
RabbitMQ, MailDev, all four service hosts, the Gateway, and the UI; it cannot be launched
headlessly in a background shell (it stalls at control-plane init), which is why the browser tier is
a CI concern and an interactive-terminal concern, never a background one.

The cross-browser matrix runs the same suite once per engine by varying `E2E_BROWSER`:
`chromium`, `firefox`, `webkit`. Mobile is covered by responsive layout testing (grid to card at a
narrow viewport), not a separate app. [Rubric §22, Responsive & Cross-Browser/Device]: §22
assesses whether the browser support matrix is exercised; the `E2E_BROWSER` env var is the
mechanism.

**Where the engines actually run differs by repo, and the reason is cost.** The Gallery is
backend-less, so MMCA.Common runs all three engines on every PR and all three are required merge
checks. A full Aspire-stack leg costs roughly twenty minutes, so ADC and Store run **chromium only**
on the deploy path and lean on the Common matrix for engine coverage; their firefox and webkit legs
stay on a Mon/Thu schedule in `e2e.yml`. Section 7 has the gate wiring.

[Rubric §21, Accessibility]: the `AssertNoAccessibilityViolationsAsync` call in the shipped workflow
bases, in each app's own `AccessibilityTests`, and in `MMCA.Common.UI.E2E.Tests` is the runtime
axe-core gate for WCAG 2.1 AA. Coverage beyond the shared bases is hand-maintained: nothing forces a
new page into `AccessibilityTests`, and today that suite holds 20 scans in ADC
(`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:17`) and 22 in Store, against
far larger page inventories.

---

## 6. Worked examples

Three examples tie the infrastructure above to real test code.

### Example A, Architecture fitness function (`DependencyVersionTests`)

The per-repo class is a bare subclass; the facts, the package lists and the parsing live once in the
shared base:

```csharp
// MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9
public sealed class DependencyVersionTests : DependencyVersionTestsBase;

// the lists + parsing live in the shipped package:
// MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:17-37
protected virtual IReadOnlyList<string> MassTransitPackageIds =>
[
    "MassTransit",
    "MassTransit.RabbitMQ",
    "MassTransit.Azure.ServiceBus.Core",
];

[Fact]
public void MassTransit_MustNotExceed_MajorVersion8()
{
    foreach (var packageId in MassTransitPackageIds)
    {
        ArchitectureRules.PinnedPackageMajorBelow(   // parses Directory.Packages.props
            packageId,
            exclusiveMajorCeiling: 9,
            reason: "MassTransit v9 requires a commercial license (MT_LICENSE); ...");
    }
}
```

**Why this test exists and what it protects.** MassTransit v9 introduced a mandatory commercial
license check (`MT_LICENSE`). A broker-enabled service that starts without it crashes at startup,
but the crash happens at runtime, not at compile time, and CI never starts the broker. So a blanket
package update that silently bumped MassTransit past v8 would compile, pass all tests, deploy, and
then crash in production. That is not hypothetical: the base's own reason string records that it
happened once before while the build stayed green
(`Bases/DependencyVersionTestsBase.cs:32-35`). `DependencyVersionTests` makes it a build-time
failure: the shared rule parses `Directory.Packages.props` directly, not the compiled assembly, so
the failure happens in the `build-and-test` job before any code ships. The sibling fact
(`ImageSharp_MustNotExceed_MajorVersion3`, line 48) guards the same shape of trap: ImageSharp v4's
MSBuild targets fail without a license key, so a blanket bump breaks the build outright.

This is the pattern of a fitness function: an executable rule that enforces a policy that cannot be
expressed as a type error. The override points (`MassTransitPackageIds`, `ImageSharpPackageIds`) are
part of the design, because a repo that does not declare a pin must not assert one: the consumers
inherit MassTransit transitively and deliberately do not subclass this base at all.
[Rubric §32, Dependency & Supply-Chain]: this is the highest-signal embodiment
of §32 in the codebase, a deliberate, documented pin with an automated gate.

### Example B, Integration test base usage (`IdentityIntegrationTestBase`)

```csharp
// MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:11-19
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
// MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/Profile/ProfileTests.cs:16-60
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

**Almost none of the harness is in this repo.** The repo-local `BunitTestBase`
(`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/BunitTestBase.cs:17`) is four lines: it
inherits `BunitComponentTestBase` from the shipped `MMCA.Common.Testing.UI` package and adds exactly
one thing, the device-capability null fallback the pages inject (`IMediaPickerService`, line 20; the
ADR-042/045 capability abstraction). Individual tests override it with recording mocks, last
registration wins.

Everything the test actually uses comes from the shared base
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33`):
MudBlazor services, `JSInterop.Mode = JSRuntimeMode.Loose` (so MudBlazor's JS calls do not throw),
`AddAuthorizationCore`, localization, and the **mutable** `AuthenticationStateProvider` (the
`MutableAuthenticationStateProvider` inner class, line 97) that `ProfilePage` injects directly.
`RenderAs<TComponent>(principal, parameters)` (line 65) sets the provider's principal, then renders
the component with a cascading `AuthenticationState` wrapping the same principal;
`RenderUnderTest<TComponent>` (line 59) is the anonymous shortcut. The provider is mutable rather
than a hardcoded-anonymous one precisely so it serves both consumers: components that read the
cascading `AuthenticationState` and pages that call `GetAuthenticationStateAsync()` on the injected
service.

The test constructs `UserWithId` (a principal with a `user_id=42` claim, line 18) and `UserWithoutId`
(a principal without it, line 21), then asserts the two render states. A third fact (line 44) asserts
the fallback avatar carries an accessible name, with a comment naming why: MudAvatar renders
`role="img"`, and the deploy-gating Profile WCAG scan's `role-img-alt` rule requires a name even in
the no-photo state. That is the two tiers meeting: a browser-tier a11y failure was cheaper to pin at
the component tier. `cut.WaitForAssertion` is bUnit's polling assertion, retrying until the assertion
passes or a timeout elapses, handling Blazor's async rendering cycle.

[Rubric §28, Front-End Testing & Quality]: bUnit tests the component's render logic in isolation
without a browser, giving fast feedback on UI states that are awkward to exercise in Playwright.
The combination of bUnit (fast, component-level) plus Playwright (slow, browser-level) is the two-tier
UI test strategy: bUnit for render-state logic, Playwright for user flows and accessibility.

---

## 7. The tiers and the gates that run them

A test tier only means something once you know what it blocks. This is the map.

| Tier | Prerequisite | Where it runs | What it blocks |
|---|---|---|---|
| Unit + architecture + bUnit | none | Common `build-and-test`; ADC/Store `build-and-test` over `CI.slnf` | Merge, on every code PR |
| Runtime conformance, Gateway pair | none (Production-pinned boot) | Same job as the unit tier | Merge |
| Runtime conformance, HTTP suites | real SQL Server | ADC/Store `integration-tests` over `Integration.slnf` | Merge (PR-only required check), **not** the deploy |
| Testcontainers cross-service / broker | Docker | Nightly `cross-service-tests.yml` | The deploy, indirectly, via `cross-service-freshness` |
| Browser (gallery) | Playwright, no backend | Common `ui-e2e`, three engines | Merge, all three engines |
| Browser (full stack) | full Aspire stack | ADC/Store `e2e-gate`, chromium only | The deploy, when the change is ui-scoped |
| Benchmarks | none | Common `performance-smoke` | Merge |

### The accessibility gate (ADR-063)

MMCA.Common's `ui-e2e` job (`MMCA.Common/.github/workflows/ci.yml:228`) builds the out-of-slnx
gallery plus E2E project and runs the axe scans across a `chromium, firefox, webkit` matrix
(`ci.yml:235-237`), one engine per leg via `E2E_BROWSER`, with `fail-fast: false` so each engine
reports independently. **All three are required merge checks**, three of the eight enumerated in
`MMCA.Common/CONTRIBUTING.md:60-71` (webkit was promoted from advisory to required on 2026-07-16,
`CONTRIBUTING.md:63-65`). That file also names the live ruleset as authoritative over its own copy
(`CONTRIBUTING.md:75-77`), which is the right instinct for any list of gates.

The deployed apps gate the deploy instead: ADC's `e2e-gate` (`MMCA.ADC/.github/workflows/deploy.yml:531`)
calls the reusable `e2e.yml` with `browsers: '["chromium"]'` (line 541), and the `deploy` job waits on
it (line 866). Store's is the same shape at `deploy.yml:532,542,857`.

**The deploy gate is ui-scoped and may legitimately skip.** Both apps gate `e2e-gate` on a `ui` change
filter (`MMCA.ADC/.github/workflows/deploy.yml:538`), and the `deploy` job's condition accepts
`success` **or** `skipped` for that one need while requiring `success` from every other
(`deploy.yml:896`). That asymmetry is deliberate and was learned the hard way: under default
`success()` semantics a legitimately skipped `e2e-gate` cascaded into a skipped deploy, so a
green run shipped nothing (`deploy.yml:879-883`). The cost of the fix is that "deployed" does not
always mean "axe ran on this commit"; a backend-only or infra-only deploy ships without a browser
scan, with the post-deploy smoke gate as the backstop.

MMCA.Helpdesk adopts none of it: it pins the package version but no project references it, and the
repo has no E2E test project at all, so the seed shows a reader no worked example of adopting the
scan.

### The performance-regression gate (ADR-060)

Rubric §12 asks for hot-path efficiency that is measured, not assumed. The design problem is the
runner: CI runs on shared GitHub-hosted Ubuntu, where wall-clock timings move run to run by more than
most regressions worth catching, so an absolute latency assertion is either tight enough to red on a
noisy neighbour or loose enough never to fire
([ADR-060](https://ivanball.github.io/docs/adr/060-performance-regression-gate.html)). The answer
splits the baseline by measurement stability.

- **A dedicated job measures, then verifies.** `performance-smoke`, named "Performance gate
  (BenchmarkDotNet Short + baseline verify)" (`MMCA.Common/.github/workflows/ci.yml:333`), runs the
  suite with `--filter "*" --job Short --exporters json` (`ci.yml:362`) and then runs `build/perfgate`
  over the exported artifacts (`ci.yml:371`). `--job Short` is 3 warmup plus 3 iterations, chosen to
  produce real measurements inside a 15-minute budget; `--filter "*"` is required because
  BenchmarkDotNet otherwise prompts for a selection and would hang the runner.
- **The baseline is a committed JSON file**, `Tests/Performance/perf-baseline.json`, not a stored
  previous run. A gate comparing against the previous run ratchets silently: every PR is only slightly
  worse than the last, and the sum is invisible. A committed number is a line a reviewer questions in
  the same PR as the code that spends it.
- **Allocations are gated absolutely**, because bytes per operation do not depend on how busy the
  runner is. Eight ceilings are committed, one per benchmark.
- **Latency is gated only as a ratio between two benchmarks in the same run.** Both run in the same
  process, on the same machine, under the same noise, so the machine cancels out of the quotient. One
  floor is committed: the recompile-every-call specification path over the cached-compile path must
  stay at or above `1000`, against a measured value around 120,000x. **No absolute latency threshold
  exists anywhere in the gate.** The floor asks "does the cache still exist", which survives a noisy
  measurement, rather than "is the cache exactly this fast", which does not.
- **A missing measurement fails, it does not pass.** Every benchmark named by a rule must be present
  in the results or the verifier reports that the gate would be vacuous and fails. Zero exported
  artifacts is a failure rather than an empty pass, and a benchmark reporting no allocation data fails
  with an instruction to keep `[MemoryDiagnoser]` on the suite. Vacuity is the failure mode a
  benchmark gate actually has: a renamed method or a filter selecting nothing would leave a gate that
  passes while measuring nothing, which is worse than no gate because it reads as evidence.

The job is a **required merge gate**, not advisory: it is the eighth of the eight contexts listed in
`MMCA.Common/CONTRIBUTING.md:68-71`, which also names raising a ceiling to silence a red gate as
defeating it. That last part is enforced by review, not by the tool.

**This gate is MMCA.Common only.** The harness, the baseline and the verifier exist in that repo and
nowhere else. ADC and Store have no benchmark suite and no perfgate; their performance artifact is a
monthly k6 load test against deployed read endpoints, which is not a pull-request gate. Helpdesk has
neither. Consumers inherit the framework's bounded hot paths through the released packages, not the
gate over their own code.

### Coverage floors

Coverage is enforced as a floor, not reported as a number.

- **MMCA.Common:** the `coverage` job merges the tiers with ReportGenerator and fails if the **unit
  tier drops below 68.3% line coverage** (`MMCA.Common/.github/workflows/ci.yml:433`). It gates the
  unit tier rather than the merged report because the gallery E2E tier dilutes it (`ci.yml:419`).
- **MMCA.ADC:** the floor runs inside `build-and-test` and sits at 55.5%
  (`MMCA.ADC/.github/workflows/deploy.yml:254`), measured over **ADC's own code only**. The comment
  above it (`deploy.yml:235-245`) is the part worth reading: the raw cobertura also instruments the
  consumed framework assemblies (tested in their own repo, near 0% here), plus the service hosts and
  the protobuf-dominated contracts assemblies, and leaving them in deflated the number to something
  that measured nothing. The assembly filter is what makes the floor mean what it says.

[Rubric §17, DevOps & Deployment]: the whole table above is §17's subject. A tier that runs and
blocks nothing is documentation; a tier that blocks something is a gate.

---

## Quick reference: rubric categories touched in this chapter

| Category | Where explained |
|---|---|
| §3 Clean Architecture (enforced) | §4 LayerDependencyTests, DomainPurityTests |
| §4 Domain-Driven Design | §4 AggregateConventionTests factory-method rules |
| §9 API Design & Contracts | §3 the ADR-058 ProblemDetails, OpenAPI and versioning bases |
| §11 Security (test RS256 keypair) | §3 JwtTokenGenerator design note; §3 SecurityHeadersTestsBase |
| §12 Performance & Efficiency | §7 the ADR-060 benchmark baseline gate |
| §14 Testability & Test Strategy | §1 CI filter rationale, §2 project layout, §5 integration strategy, §7 coverage floors |
| §17 DevOps & Deployment | §1 two-filter CI rationale, §7 the tier-to-gate map |
| §21 Accessibility (a11y) | §3 AxeOptions and AssertNoAccessibilityViolationsAsync, §5 E2E strategy, §7 the ADR-063 gate |
| §22 Responsive & Cross-Browser | §3 PlaywrightFixture engine selection, §5 E2E browser matrix |
| §28 Front-End Testing & Quality | §2 UI/E2E project layout, §3 Testing.E2E and Testing.UI packages, §6 bUnit example |
| §29 Resilience | §3 GracefulShutdownTestsBase |
| §30 Compliance, Privacy & Data Governance | §4 PiiConventionTests + PiiErasureContractFitnessTests, DataResidencyTests |
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
- Type inventory: `00-inventory.md`, the per-assembly type counts this chapter's tables are drawn from
- ADRs:
  - [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html), outbox pattern the integration tests exercise
  - [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), PiiConventionTests rationale
  - [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), per-source DB reset in `IIntegrationTestFixture`
  - [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html), MicroserviceExtractionTests rationale
  - [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html), the structural fitness tier of section 4, which stops explicitly at structure and registration
  - [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html), the runtime conformance suites of section 3, which pick up where ADR-015 stops
  - [ADR-060](https://ivanball.github.io/docs/adr/060-performance-regression-gate.html), the benchmark baseline gate
  - [ADR-063](https://ivanball.github.io/docs/adr/063-accessibility-conformance-gate.html), WCAG 2.1 AA as a shipped test contract and CI gate
