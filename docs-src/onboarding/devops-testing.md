# Testing Architecture & Solution Composition

> **Chapter scope note.** The tier chapters (`tier-00` through the sweep) document every type
> in the production codebase one by one. Test types are the logged exception: this chapter covers
> the **2,190** types that live in test projects, grouped by project purpose and foundational
> infrastructure, not written as one section per `[Fact]`. Individual test methods are cited only
> as worked examples. Cross-reference the tier chapters for the production types being tested.
> The counts come from the Roslyn inventory (`00-inventory.md:25-123`), which scans
> `MMCA.Common/Source`, `MMCA.Common/Tests`, `MMCA.ADC/Source` and `MMCA.ADC/Tests` only
> (`00-inventory.md:3-4`): MMCA.Store and MMCA.Helpdesk test types are named in this chapter where
> they carry a decision, but they are not in those totals.

This chapter teaches the complete testing architecture of the MMCA workspace: how the solutions are
sliced, which CI filter sees which tests, how Microsoft Testing Platform differs from VSTest, the
shipped testing-infrastructure NuGet packages, the NetArchTest fitness-function suites that act
as executable governance, the runtime conformance suites that check a really booted host, the
integration and E2E strategies, three worked examples, and the CI gates that decide which tier
blocks which merge or which deploy, including the freshness gates that block on a proof produced
elsewhere, the behavioral gate over the AI session scorer, and the two cross-repo gates that build a
different repo than the one being changed.

---

## 1. Solution composition and the test runner

### Solution files: slnx vs. slnf

The two deployed apps use the same two-file pattern; MMCA.Common and MMCA.Helpdesk ship a `.slnx`
only, because their solutions are already fast enough not to need a CI subset:

| File | Purpose |
|---|---|
| `MMCA.Common.slnx` | Full human solution, 16 source projects + 14 test projects (no `.slnf`) |
| `MMCA.Helpdesk.slnx` | Full seed solution, three test projects, no database needed (no `.slnf`) |
| `MMCA.ADC.slnx` | Full human solution, all source + all 30 in-solution test projects |
| `MMCA.ADC.CI.slnf` | CI fast path, source + unit/architecture/UI/host tests only |
| `MMCA.ADC.Integration.slnf` | SQL-gated per-service integration tests only |
| `MMCA.Store.CI.slnf` / `MMCA.Store.Integration.slnf` | Store's pair, mirroring the ADC split |

`MMCA.ADC.CI.slnf` (`MMCA.ADC/MMCA.ADC.CI.slnf:1-64`) includes 33 source projects
(`MMCA.ADC.CI.slnf:5-37`) and 24 test projects (`MMCA.ADC.CI.slnf:38-61`): every per-module unit and
UI suite across Identity, Conference, Engagement and Notification, the AI scoring evaluation suite
`MMCA.ADC.Conference.Scoring.Evaluation.Tests` (`MMCA.ADC.CI.slnf:49`), plus
`MMCA.ADC.Architecture.Tests`, `MMCA.ADC.Gateway.Tests` and `MMCA.ADC.Services.Tests`
(`MMCA.ADC.CI.slnf:59-61`). It deliberately excludes:

- the four per-service integration projects (`MMCA.ADC.{Identity,Conference,Engagement,Notification}.IntegrationTests`)
- the two Testcontainers tiers (`MMCA.ADC.CrossService.IntegrationTests`, `MMCA.ADC.ServiceBusEmulator.IntegrationTests`)
- `Tests/E2E/MMCA.ADC.E2E.Tests`
- the Aspire `AppHost`, the MAUI `MMCA.ADC.UI` project, and the frozen combined migrations archive

Why: the integration tests need a real SQL Server (the `ADC_TEST_SQL_BASE` connection string points
to a CI SQL service container), the Testcontainers tiers need a Docker daemon, and the E2E tests need
the full Aspire stack running. None of that is available in the fast build job, so each is gated by
its own job with its own prerequisites.

**Read the gating carefully, it is easy to state wrongly.** ADC's `integration-tests` job is
**pull-request-only** (`MMCA.ADC/.github/workflows/deploy.yml:619`, with the reasoning at
`deploy.yml:614-618`) and is **not** in the `deploy` job's `needs` list (`deploy.yml:1237`). Its
sibling `build-and-test` is pull-request-only for the same stated reason (`deploy.yml:207-210`). The
comment above the `needs` list spells it out (`deploy.yml:1238-1250`): with strict branch protection
the PR validated the exact merge tree, so those jobs are required PR checks rather than push-time
deploy gates, and they are not re-run on the merge push. The required contexts are exactly four,
`build-and-test`, `supply-chain`, `integration-tests` and `coverage`, as the repo's own contributing
guide records twice (`MMCA.ADC/CONTRIBUTING.md:38-41` and `CONTRIBUTING.md:80-81`).

What actually blocks the deploy is `supply-chain`, `cost-guard`, the **four** freshness gates
(`dr-freshness`, `load-freshness`, `cross-service-freshness`, `cross-browser-freshness`),
`foundation`, `build-images`, the always-on `ai-eval-gate` (section 7), and then
**exactly one of two complementary test gates**: the chromium `e2e-gate` on a UI diff, or
`backend-test-gate` on every other code diff (`deploy.yml:1237`, condition at `deploy.yml:1269-1284`).
`backend-test-gate` (`deploy.yml:410`) exists because those PR-only checks plus a ui-scoped
`e2e-gate` composed into a hole: a backend-only push to `main` ran **no tests at all** before rolling
out, with the post-deploy smoke gate as the only backstop, which is detection after the rollout
rather than prevention (`deploy.yml:391-404`). Its `if` is the exact complement of `e2e-gate`'s
(`deploy.yml:412` versus `deploy.yml:772`), so one of the two always runs on a code deploy, at zero
added minutes on a UI deploy and one `CI.slnf` pass on a backend-only one. It deliberately runs
`MMCA.ADC.CI.slnf` and skips coverage collection (`deploy.yml:406-409`, run step at
`deploy.yml:438`): coverage is a review-time regression signal, not a rollout gate. It restores with
`--locked-mode` against the committed lock files (`deploy.yml:428`), so the gate cannot silently
resolve a different graph than the PR validated.
[Rubric §17, DevOps & Deployment]: §17 assesses how consistently CI/CD enforces quality gates; the
two-filter pattern is how the build stays fast on every push while the SQL-dependent tier still has
to be green before a PR can merge at all, and the complementary pair is how "no production deploy
without test execution" survives both of those optimizations.

**MMCA.Store has no `backend-test-gate`.** Its `deploy` job needs
`[changes, supply-chain, cost-guard, dr-freshness, load-freshness, cross-service-freshness, e2e-gate, foundation, build-images]`
(`MMCA.Store/.github/workflows/deploy.yml:945`), so a Store backend-only deploy still relies on the
post-deploy smoke gate. That is a real asymmetry between the two apps, not a documentation gap.

`MMCA.ADC.Integration.slnf` (`MMCA.ADC/MMCA.ADC.Integration.slnf:5-8`) contains exactly four
projects, one per service host: Identity, Conference, Engagement and Notification. These are the
per-service `WebApplicationFactory` integration tests that replaced the combined
`MMCA.ADC.IntegrationTests` project, which has since been **deleted from disk**, not merely
excluded (`MMCA.ADC/MMCA.ADC.slnx:106-113` records the removal, along with the removal of
`MMCA.ADC.WebAPI.Tests`, whose middleware coverage was consolidated upstream into
`MMCA.Common.API.Tests`). `MMCA.Store.Integration.slnf` is the same shape over Catalog, Sales and
Identity (`MMCA.Store/MMCA.Store.Integration.slnf:5-7`).

`MMCA.Common.slnx` (`MMCA.Common/MMCA.Common.slnx:1-54`) includes sixteen of the seventeen published
packages (`MMCA.Common/FACTS.md:19-38`): the meta package `MMCA.Common` (line 8), four Core
(`.Shared`, `.Domain`, `.Application`, `.Infrastructure`, lines 11-14), four Presentation (`.API`,
`.Grpc`, `.UI`, `.UI.Web`, lines 17-20), and seven Hosting (`.Aspire`, `.Aspire.Hosting`, `.Gateway`,
`.Testing`, `.Testing.Architecture`, `.Testing.E2E`, `.Testing.UI`, lines 23-29), plus **fourteen**
test projects (lines 33-52). The seventeenth package, `MMCA.Common.UI.Maui`, sits **outside the
`.slnx`** on purpose: its four MAUI target frameworks cannot build on the ubuntu runners the
solution's CI uses, so it is built and packed by a dedicated windows job
(`MMCA.Common/.github/workflows/ci.yml:160`, rationale at `ci.yml:155-159`, build step at
`ci.yml:221`,
[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Four test
projects are **also intentionally absent from the `.slnx`**:

- `Tests/Presentation/MMCA.Common.UI.Gallery`, a backend-less Blazor host that renders the real
  login and register pages, a UI-primitives showcase and the notification pages; it exists solely to
  give Playwright something to hit (`ci.yml:223-225`).
- `Tests/Presentation/MMCA.Common.UI.E2E.Tests`, the axe-core + render-smoke suite that hits
  the Gallery.
- `Tests/Core/MMCA.Common.Infrastructure.Redis.Tests`, which runs `DistributedCacheService` against a
  real Redis via Testcontainers (so the unit loop needs no Docker).
- `Tests/Performance/MMCA.Common.Benchmarks`, the BenchmarkDotNet suite behind the ADR-060
  performance gate (see section 7).

The exclusions are not all for the same reason, and the comments say which is which. The gallery pair
and the benchmark suite are out so `dotnet test --solution MMCA.Common.slnx` stays fast (no browser
install, no benchmark wall clock: `ci.yml:226-227` and `ci.yml:330-331`); the Redis project is out
because it needs a **Docker daemon** the fast unit loop must not require (`ci.yml:749-750`,
`ci.yml:775-776`). Each runs in its own CI job, built by csproj path, for example
`dotnet test --project Tests/Presentation/MMCA.Common.UI.E2E.Tests/MMCA.Common.UI.E2E.Tests.csproj`
(`ci.yml:301`) and the Redis tier at `ci.yml:777`.
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
   (`ci.yml:301`), `40` for the cross-repo Helpdesk canary (`ci.yml:536`), and `1` for four of
   ADC's five test invocations (`MMCA.ADC/.github/workflows/deploy.yml:300,438,493,686`). The
   `backend-test-gate` step comment states the reasoning in one line: a filter or discovery breakage
   that runs zero tests must fail here, not report a vacuous pass (`deploy.yml:436-437`). The one
   invocation deliberately without a floor is the paid live judge of `ai-eval-gate`
   (`deploy.yml:495-504`): without `ANTHROPIC_API_KEY` every case skips itself dynamically, and a
   zero-run there must not red a deploy on a repo whose secret is absent (`deploy.yml:497-499`).

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

The inventory below is drawn from `00-inventory.md:25-123` (test-assembly counts) and the solution
files above. Counts are distinct types per project as reported by the Roslyn inventory scan, not
`[Fact]` counts.

### MMCA.Common, 1,383 test types across 14 in-solution projects + 37 across 4 out-of-solution

**Unit, Core layer**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Shared.Tests` | 45 | Unit tests for the Result pattern, `Error`, `ErrorType`, value objects, DTO contracts, supported cultures |
| `MMCA.Common.Domain.Tests` | 62 | Unit tests for entity hierarchy, aggregate root, domain events, specifications, soft-delete, PII redaction |
| `MMCA.Common.Application.Tests` | 343 | Unit tests for CQRS dispatcher, decorator pipeline, module loader, `IMessageBus`, validators, query pipeline, the exportable-user-data handler base, tenant-scoped cache keys and `ICacheService.GetOrCreate` |
| `MMCA.Common.Infrastructure.Tests` | 403 | Unit/integration tests for EF base contexts, outbox processor, repository, caching, JWT generation, JWKS provider, data-source resolver, plus the `Scheduling/`, `Persistence/Tenancy/`, `Persistence/AuditTrail/` and hybrid-cache subtrees |
| `MMCA.Common.Infrastructure.Tests.MigrationsFixture` | 1 | A single-type companion project that gives the infrastructure suite a real migrations assembly to point EF at |

**Unit, Presentation layer**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.API.Tests` | 138 | Tests for `ApiControllerBase`, exception handlers, idempotency filter, the shared middleware pipeline, JWKS endpoint (also the consolidated home of the ADC/Store middleware coverage), session-cookie auth, CSV export and tenant resolution |
| `MMCA.Common.Grpc.Tests` | 16 | Tests for `GrpcResultExceptionInterceptor`, `JwtForwardingClientInterceptor`, Result to `RpcException` mapping |
| `MMCA.Common.UI.Tests` | 127 | bUnit component tests for shared Blazor components (login/register forms, nav, theming, notification pages) |
| `MMCA.Common.UI.Web.Tests` | 4 | The Blazor Web host layer: `ServerTokenStorageService`, `BlazorCspPolicyProvider`, `WebFormFactor` |

**Hosting**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Aspire.Tests` | 44 | Tests for `AddServiceDefaults`, health-check registration, `OutboxPollFilterProcessor` telemetry suppression, the warmup readiness gate, metrics/trace-ratio toggles, security headers, Key Vault configuration, data protection and the Kestrel endpoint extensions |
| `MMCA.Common.Aspire.Hosting.Tests` | 4 | The AppHost-side resource builders the framework ships for consumer AppHosts |
| `MMCA.Common.Gateway.Tests` | 7 | The shared YARP gateway kit: the rate-limit partitioning, correlation and downstream-readiness behavior the two app gateways inherit |
| `MMCA.Common.Testing.Tests` | 27 | The framework dogfooding its own shipped test bases and helpers: `DecoratorPipelineOrderTests` and `MiddlewarePipelineOrderTests`, `MmcaGatewayHardeningTestsBaseTests`, `HandlerTestBaseTests`, `CrossServiceFixtureBaseTests`, `ServiceBusEmulatorFixtureBaseTests`, `DependencyInjectionAssertTests`, `FeatureManagementTestExtensionsTests`, `JwtTokenGeneratorTests`, `RateLimiterTestExtensionsTests`, `RecordingHttpForwarderTests` and `TestPollingTests` |

**Architecture**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Architecture.Tests` | 162 | 47 test source files (thin subclasses of the shared bases plus the Common-only `*FitnessTests` family), `CommonArchitectureMap`, and the fake modules and probe fixtures the adversarial suites drive (see section 4) |

**Out-of-solution (each run by its own dedicated CI job)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.UI.Gallery` | 11 | Backend-less Blazor host; renders the real login/register pages, a primitives showcase and the notification pages for Playwright to hit |
| `MMCA.Common.UI.E2E.Tests` | 18 | Playwright axe-core WCAG 2.1 AA scans, render smoke, dark mode, web vitals, pseudo-localization and mobile top row against the Gallery |
| `MMCA.Common.Infrastructure.Redis.Tests` | 2 | `DistributedCacheService` against a real Redis via Testcontainers (storage FORMAT fidelity: a mocked `IDistributedCache` cannot answer WRONGTYPE) |
| `MMCA.Common.Benchmarks` | 6 | BenchmarkDotNet hot-path suite behind the ADR-060 performance gate (section 7) |

### MMCA.ADC, 769 test types across 32 in-solution projects + 1 out-of-solution

**Unit, per-module, per-layer (Identity module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Identity.Domain.Tests` | 4 | `User` aggregate factory methods, invariants, soft-delete |
| `MMCA.ADC.Identity.Application.Tests` | 30 | Command/query handler tests for register, login, external OAuth, profile management, plus the GDPR export path and the per-module export sections |
| `MMCA.ADC.Identity.Shared.Tests` | 3 | DTO/enum tests |
| `MMCA.ADC.Identity.API.Tests` | 8 | Controller helper tests, rate-limit bypass |
| `MMCA.ADC.Identity.Infrastructure.Tests` | 9 | Token service, JWKS provider, EF configuration, the refresh-session store |
| `MMCA.ADC.Identity.UI.Tests` | 7 | bUnit tests for `Profile`, login route authorization |

**Unit, per-module, per-layer (Conference module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Conference.Domain.Tests` | 28 | Event/Session/Speaker/Sponsor aggregate factories, invariants, domain events |
| `MMCA.ADC.Conference.Application.Tests` | 165 | Handler tests for the Conference controllers' use cases (bulk), including the `Sponsors/` create, update, public-filter and mapper tests |
| `MMCA.ADC.Conference.Shared.Tests` | 17 | DTO validation, enum coverage |
| `MMCA.ADC.Conference.API.Tests` | 20 | Controller registration, route tests, `SponsorsControllerTests` and `EntityExportAuthorizationTests` |
| `MMCA.ADC.Conference.Infrastructure.Tests` | 15 | EF entity configuration, module seeding, the Sessionize import and the AI session-scoring services |
| `MMCA.ADC.Conference.Scoring.Evaluation.Tests` | 11 | The AI session scorer's behavioural suite: `GoldenReplayTests`, `PromptContractTests` and the opt-in `LiveJudgeTests` (`MMCA.ADC/MMCA.ADC.slnx:88`, in `CI.slnf:49`). Its 11 types are inside the 769 below (`00-inventory.md`, 2026-09-05 scan); the gate that runs it is in section 7 |
| `MMCA.ADC.Conference.UI.Tests` | 53 | bUnit tests for session/speaker components and dashboards, the sponsor create/detail pages and the public sponsor list |

**Unit, per-module, per-layer (Engagement module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Engagement.Domain.Tests` | 11 | Bookmark, LivePoll and SessionQuestion aggregates, plus `CheckIn`, `PointsEntry` and the leaderboard opt-in |
| `MMCA.ADC.Engagement.Application.Tests` | 66 | Bookmark, feedback and live-layer handlers, plus the `CheckIns/` subtree (attendee, manual, room and sponsor-visit check-in, badge issue, attendance stats) and the `Points/` subtree (awarder, leaderboard, my-points, organizer overview, and the domain/integration-event points handlers) |
| `MMCA.ADC.Engagement.Shared.Tests` | 7 | DTO tests, plus the badge payload, check-in scope names and settings, and the points settings and subject keys |
| `MMCA.ADC.Engagement.API.Tests` | 10 | Controller surface (bookmarks, live polls, session questions, check-ins, points) and the module's permission grants |
| `MMCA.ADC.Engagement.Infrastructure.Tests` | 4 | EF config |
| `MMCA.ADC.Engagement.UI.Tests` | 36 | bUnit tests for the conference-day live surfaces (Happening Now, session Live, presenter UI), the QR check-in pages, the points pages, and `CurrentEventNotificationScopeProviderTests` |

**Unit, per-module (Notification module, API + Application only)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Notification.Application.Tests` | 5 | Live-channel publish path |
| `MMCA.ADC.Notification.API.Tests` | 1 | `NotificationHub` surface |

**Architecture**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Architecture.Tests` | 44 | 42 fitness-function classes plus `AdcArchitectureMap` (see section 4) |

**Hosts and services**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Gateway.Tests` | 8 | YARP route map, the ADR-058 conformance subclasses `SecurityHeadersTests`, `GracefulShutdownTests` and `GatewayHardeningTests` against a Production-pinned Gateway boot, plus `AppHostBicepParityTests`, which reads the AppHost and the production Bicep as text (see section 4) |
| `MMCA.ADC.Services.Tests` | 5 | The gRPC export services and their adapters, with a `FakeServerCallContext` |

**Integration (per-service WebApplicationFactory, in `MMCA.ADC.Integration.slnf` only)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Identity.IntegrationTests` | 34 | Full HTTP tests of the Identity service host against real SQL Server; auth flows, OAuth challenges, attendee/organizer access, outbox fidelity |
| `MMCA.ADC.Conference.IntegrationTests` | 37 | Full HTTP tests of the Conference service host, plus its 409-conflict ProblemDetails extension and the versioning contract |
| `MMCA.ADC.Engagement.IntegrationTests` | 22 | Full HTTP tests of the Engagement service host, including the check-in authorization and scan, room-check-in and sponsor-visit round trips and the points award round trip |
| `MMCA.ADC.Notification.IntegrationTests` | 9 | Full HTTP tests of the Notification service host, including its problem-details and OpenAPI contract subclasses |

**Testcontainers tiers (in `MMCA.ADC.slnx` but in neither `.slnf`; need Docker)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.CrossService.IntegrationTests` | 13 | Boots the three REST hosts in one process against real SQL Server + RabbitMQ containers; exercises the genuine outbox to broker to consumer round-trip and the Conference to Engagement gRPC read |
| `MMCA.ADC.ServiceBusEmulator.IntegrationTests` | 3 | MassTransit smoke against the official Azure Service Bus emulator (broker parity) |

**E2E (in `MMCA.ADC.slnx` but excluded from both `.slnf` filters)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.E2E.Tests` | 84 | Playwright browser-automation tests across login, register, password reset, conference browsing, organizer management, bookmark and live flows, plus the 31-scan `AccessibilityTests` suite (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:17`, 31 `[Fact]` methods, each one `ScanAsync`/`ScanGridAsync` call); requires the Aspire stack running |

**Out-of-solution**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.AppHost.SmokeTests` | 1 | `AppHostCompositionSmokeTests`: boots the real Aspire stack and asserts the composition. Deliberately outside every `.slnx`/`.slnf` and restored/built by explicit path (`MMCA.ADC/.github/workflows/cross-service-tests.yml:197-198,216,263`) |

### Test-type totals

- **MMCA.Common:** the 14 in-solution projects sum to 45 + 62 + 343 + 403 + 1 + 138 + 16 + 127 + 4 +
  44 + 4 + 7 + 27 + 162 = **1,383**; the 4 out-of-solution projects add 11 + 18 + 2 + 6 = **37**, for
  **1,420**.
- **MMCA.ADC:** 61 (Identity) + 309 (Conference, incl. the 11-type scoring evaluation suite) + 134 (Engagement) + 6 (Notification) + 44
  (architecture) + 102 (four integration projects) + 16 (two Testcontainers tiers) + 8 (Gateway) + 5
  (Services) + 84 (E2E) = **769** in-solution, plus the 1-type AppHost smoke project = **770**.
- **Combined test projects: 2,190.** Separately, the four shipped testing packages contribute
  another **126** types (`MMCA.Common.Testing` 23, `.Testing.Architecture` 57, `.Testing.E2E` 30,
  `.Testing.UI` 16): those are shipped product, not tests, which is why they are counted apart.

[Rubric §14, Testability & Test Strategy]: §14 assesses the breadth and meaningfulness of the
test suite across all layers; the project layout above, unit per layer, arch per repo,
integration per service, Testcontainers for the cross-service round-trip, E2E for browser flows,
demonstrates deliberate stratification rather than a single catch-all integration tier.

---

## 3. Shipped testing-infrastructure packages

MMCA.Common ships **four** of its seventeen packages as testing infrastructure that downstream apps
consume as NuGet references rather than writing their own harness (`MMCA.Common/FACTS.md:19,34-37`):

- `MMCA.Common.Testing` (23 types), integration-test base, JWT generator, SQL fixture base, handler
  scaffold, entity builders, and the eight runtime conformance bases (this section).
- `MMCA.Common.Testing.E2E` (30 types), Playwright fixtures, Blazor nav helpers, Identity,
  Preferences and Globalization workflow bases, five page objects, the `AxeOptions` accessibility
  contract, the `AuthOutcomeRules` post-submit classifier, and a web-vitals collector plus its
  page extension (`WebVitalsCollector.cs`, `WebVitalsPageExtensions.cs`) (this section).
- `MMCA.Common.Testing.UI` (16 types), bUnit component-test base, MudBlazor provider harness, HTTP
  test doubles, an error-summary helper and a markup snapshot helper (this section; see the bUnit
  worked example in section 6).
- `MMCA.Common.Testing.Architecture` (57 types), the shared NetArchTest fitness-function rule library
  plus 46 abstract test bases (covered in section 4, where each repo's `*.Architecture.Tests` consumes it).

### MMCA.Common.Testing

`MMCA.Common/Source/Hosting/MMCA.Common.Testing/`, 23 types, shipped as `MMCA.Common.Testing`.

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
- `NextId()`, thread-safe `Interlocked.Increment` over a static counter starting at 1000
  (line 16), giving tests unique integer IDs without collisions under parallel execution (line 75).

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

The database-free boot path. Its `CreateHost` override (line 32) pins `UseEnvironment("Production")`
(line 36) so the tests exercise the branches a default `Development` boot skips (restrictive CORS,
HSTS emission), and it captures the started `IHost` in `StartedHost` (line 29, assigned at line 37)
because `IHost.StopAsync` is not reachable through the `WebApplicationFactory` surface. That capture
is what makes the graceful-shutdown suite possible.

#### `HandlerTestBase<THandler>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/HandlerTestBase.cs:38`

A reusable Moq scaffold for command/query handler unit tests, replacing the per-class copy-paste of
`Mock<IUnitOfWork>` plus `GetRepository` wiring plus `SaveChangesAsync` setup. `UnitOfWork` (line 45)
arrives with `SaveChangesAsync` pre-configured to return 1 (constructor, line 41); `Logger` (line 48)
is a `NullLogger<THandler>`. Derived classes call `RegisterRepository<TEntity, TIdentifierType>()`
(line 56) or `RegisterReadRepository<TEntity, TIdentifierType>()` (line 72) per aggregate the handler
touches.

#### The eight runtime conformance bases (ADR-058)

The bases above are plumbing. The eight below are the runtime-contract half of the fitness story:
NetArchTest can prove a controller lives in the right assembly, it cannot prove a booted host answers
a bad page number with an RFC 9457 problem document. All but one run against a host that was
**actually booted**
([ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html)).

| Base | File | What it asserts |
|---|---|---|
| `ProblemDetailsContractTestsBase<TFixture>` | `ProblemDetailsContractTestsBase.cs:21` | Both error-shaping paths: ASP.NET Core model validation (400, `application/problem+json` with `type`/`traceId`/`errors`, fact at line 29) and the framework's `HandleFailure` Result mapping (404, fact at line 41), each driven by an abstract probe the subclass supplies (lines 54, 60) |
| `OpenApiContractTestsBase<TFixture>` | `OpenApiContractTestsBase.cs:21` | The live `/openapi/v1.json` document (path at line 30) still describes the pinned `CorePublicResources` (line 50, fact at line 67) above a `MinimumPathCount` floor (line 37, asserted at line 64). No committed snapshot: a new controller can never leave a stale one behind |
| `ServiceInfoVersioningContractTestsBase<TFixture>` | `ServiceInfoVersioningContractTestsBase.cs:19` | `/ServiceInfo` served at both `api-version: 1.0` (deprecated, fact at line 27) and `2.0` (fact at line 43), with the `api-deprecated-versions` / `api-supported-versions` reporting headers |
| `SecurityHeadersTestsBase` | `SecurityHeadersTestsBase.cs:16` | Hardened response headers on the `ProbePath`, `/alive` by default (line 19, fact at line 21), including `Content-Security-Policy: frame-ancestors 'none'` and an HSTS `max-age` |
| `GracefulShutdownTestsBase<TEntryPoint>` | `GracefulShutdownTestsBase.cs:24` | A real `IHost.StopAsync` under a bounded 20-second budget (`ShutdownTimeoutSeconds`, line 28) fires `ApplicationStopping` then `ApplicationStopped` (fact at line 33) |
| `MmcaGatewayHardeningTestsBase<TEntryPoint>` | `MmcaGatewayHardeningTestsBase.cs:38` | Eight gateway gates against a real Production boot: per-route throttling (line 125), a tighter named policy (line 147), bypassed paths (line 183), correlation-id generation and echo (lines 210, 228), a readiness check per downstream service (line 245), an active `/alive` probe on every cluster (line 273), and rate-limit partitioning by the **forwarded** client IP rather than the proxy IP (line 309) |
| `MiddlewarePipelineOrderTestsBase` | `MiddlewarePipelineOrderTestsBase.cs:29` | The 18-step edge pipeline runs in exactly the documented order, outermost first (`ExpectedStepNames`, lines 38-57; fact at line 60), and `Build()`'s load-bearing adjacency checks still pass (fact at line 69) |
| `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>` | `DecoratorPipelineOrderTestsBase.cs:38` | The ADR-014 nesting, read off the constructed object graph via each decorator's private inner-handler field, not off the registration list (expected orders at lines 49 and 61, facts at 71 and 75) |

The two newest are worth reading for the shape of the problem they solve. `MiddlewarePipelineOrderTestsBase`
builds no `WebApplication` at all: the steps are pure data until they are applied, so it runs in the
fast unit tier with no database and no host (`MiddlewarePipelineOrderTestsBase.cs:24-27`). Its value
is that several adjacencies are load-bearing (pre-forwarded capture immediately before
`UseForwardedHeaders`, authentication immediately before tenant resolution, authentication before the
rate limiter per ADR-019, forwarded headers before the HTTPS redirect) and a reorder that breaks one
fails at runtime in ways that look like configuration bugs: an unreachable `jwks_uri`, a tenant that
never resolves, a per-user rate cap that never engages (lines 13-18, restated in the assertion's
because-reason at line 66). The list it compares against is the framework's own 18-step default,
declared once as data (`MiddlewarePipelineOrderTestsBase.cs:40-57`). `MmcaGatewayHardeningTestsBase` goes the other way and needs the real
host, but it drives it through `TestServer.SendAsync` rather than an `HttpClient`, because the
limiter partitions on `Connection.RemoteIpAddress`, which a `TestServer` request leaves null; the kit
deliberately fails open on an unresolvable IP, so a client-driven test could never observe a 429
(lines 22-26). Each of its tests uses its own RFC 5737 TEST-NET-3 client IP so the shared host gives
every one a fresh window (lines 27-28).

Five of the eight reach the host through `IIntegrationTestFixture`; the security-headers base takes a
bare `CreateClient()` (`SecurityHeadersTestsBase.cs:42`), the gateway-hardening base takes a
`WebApplicationFactory` (line 60), and the decorator and middleware bases need no host at all.

**Adoption is now near-complete on the REST hosts, and still uneven on the host-level gates.** This is
the honest inventory:

- **OpenAPI and ProblemDetails** both cover **all four** ADC services and **all three** Store
  services. ADC Notification, which previously had no problem-details subclass, now has one
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Notification.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16`).
  ADC Conference extends the base with a 409 stale-`RowVersion` conflict test of its own.
- **ServiceInfo versioning** is subclassed once per repo, on ADC Conference
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:15`)
  and Store Catalog. That keeps the versioning machinery exercised but leaves the other five REST
  hosts unguarded.
- **Security headers, graceful shutdown and gateway hardening** are subclassed **only on the two
  Gateway hosts** (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:12`,
  `GracefulShutdownTests.cs:9`, `GatewayHardeningTests.cs:28`, plus the Store trio). No service host
  asserts any of them today.
- **Decorator order and middleware order** are subclassed in **all four repos**: ADC and Store from
  their architecture suites (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:28`,
  `MiddlewarePipelineOrderTests.cs:15`), Helpdesk from its own
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/DecoratorPipelineOrderTests.cs:35`,
  `MiddlewarePipelineOrderTests.cs:15`), and MMCA.Common dogfooding both against a synthetic
  `PingCommand`/`PingQuery` pair and the framework's own default pipeline
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:22`,
  `MiddlewarePipelineOrderTests.cs:10`).
- **MMCA.Helpdesk now adopts two of the eight.** The seed used to demonstrate only the structural
  tier; the two host-free order gates were the cheapest runtime bases to adopt, and it adopted them.
  The six that need a booted host it still does not.

Each unguarded host is a gap in the record, not a decision that the contract does not apply to it.

#### `JwtTokenGenerator`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/JwtTokenGenerator.cs:30`

A static class that mints RS256 JWT tokens for test consumption. Key design decisions visible in
the source:

- **RS256 matches production.** The generator uses `RSA.Create()` + `ImportFromPem` + `RsaSecurityKey`
  (lines 124-130), matching the algorithm configured by `AddCommonAuthentication` in the real host.
  Integration tests therefore exercise the actual JWKS/RS256 validation path, not a relaxed HMAC
  shortcut. [Rubric §11, Security]: §11 assesses how well the test suite validates the security
  model; using the same algorithm in tests as in production is a direct embodiment.
- **Committed keypair, documented as insecure.** `DefaultPublicKeyPem` (line 49) and
  `DefaultPrivateKeyPem` (line 68) are embedded in the source and committed to the public repo. The
  class doc explicitly warns that the embedded RSA keypair is insecure by design and exists solely to
  make integration tests deterministic without a per-run key-generation step, and that no production
  deployment may be configured with it.
- **`DefaultKeyId = "mmca-test-key"`** (line 41) and `DefaultIssuer` (line 33), the `kid` and issuer
  that test host appsettings expose via `Jwks:KeyId`, so `RsaJwksProvider` publishes a JWKS entry with
  the same `kid` and the middleware's key resolution succeeds.
- `GenerateToken(audience, userId, role, additionalClaims?, privateKeyPem?, issuer?, keyId?)`
  (line 112) exports the RSA parameters before disposal (line 127), creates `RsaSecurityKey`
  (line 130), and writes **`NameIdentifier` and `Role`** (lines 139-140). The duplicate custom
  `user_id` claim that used to ride alongside `NameIdentifier` is gone, and the comment above the
  list says why (lines 133-136): `NameIdentifier` is what the JWT bearer handler produces for a real
  token's `sub` under its default inbound mapping, so a test token carrying it reaches every reader
  the same way a production one does, and two claims for one identity can disagree.
- `ConfigureInProcessTokenValidation(options, audience)` (line 170) is the companion that points a
  host's `JwtBearerOptions` at the same committed key, for suites that boot a host in-process rather
  than fetching a JWKS document over HTTP.

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
`ConfigureTestFeatureFlags(...)` (line 35). Call it in a `WebApplicationFactory.ConfigureServices`
override to override feature flags from `appsettings.json`. The doc comment records the trap it was
written around (lines 18-24): the flags are **layered on top of** the `IConfiguration` the host
already registered and the resulting root is registered in its place, because .NET DI hands a
non-collection dependency the last registration, so building a flags-only root would silently give
every component constructed afterwards a configuration containing nothing but `FeatureManagement`.

#### The cross-service, gateway and polling helpers

Five more shipped types close out the package, all of them for the tiers above the unit loop:

- `CrossServiceFixtureBase` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/CrossServiceFixtureBase.cs:41`)
  and its `CrossServiceDataSource` record (line 15) are the scaffolding for the cross-service
  real-broker tier: several service hosts booted in **one** process against a real Testcontainers SQL
  Server and a real Testcontainers RabbitMQ. The class remarks (lines 26-39) record the load-bearing
  constraint: each host reads its connection string, message-bus provider and JWT settings from
  configuration at configure-time, before `builder.Build()` and therefore before a
  `WebApplicationFactory` config delta could apply, so **process environment variables are the only
  override channel** (`SetEnvironmentVariable`, line 187) and the hosts must be booted strictly
  sequentially, re-pointing the connection string between boots (`SetHostConnectionString`, line 177).
  ADC's `CrossServiceFixture`
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:23`)
  is its one subclass, carrying only the ADC-specific parts.
- `ServiceBusEmulatorFixtureBase` is the equivalent scaffold for the Azure Service Bus emulator tier,
  so the broker-parity smoke does not re-implement container lifecycle either.
- `RecordingHttpForwarder` is the `IHttpForwarder` double a gateway conformance subclass swaps in, so
  a proxied route answers immediately instead of trying to reach a service-discovery name that
  resolves to nothing in-process (`MmcaGatewayHardeningTestsBase.cs:30-35`), and
  `RateLimiterTestExtensions` supplies `NeutralizeGlobalRateLimiter`, the escape hatch an integration
  fixture uses when a suite must issue more requests from one IP than production would allow.
- `DependencyInjectionAssert` (`DependencyInjectionAssert.cs:13`) asserts the fluent-registration
  contract: `ReturnsSameCollection` (line 21) proves a registration extension hands back the very
  `IServiceCollection` it was given. An extension that returns a different collection silently drops
  every registration chained after it, and nothing else catches that because the dropped services are
  simply absent (lines 6-11).
- `TestPolling.PollUntilAsync` (`TestPolling.cs:22`) is the poll-with-timeout helper for
  eventually-consistent assertions, defaulting to a 60-second budget and a 500ms interval. It returns
  the **last probed value** either way, so a timeout fails on the test's real assertion message
  rather than on a bare timeout.

### MMCA.Common.Testing.E2E

`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/`, 30 types, shipped as
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
setters (for example `DefaultBaseUrl`, line 10). Environment variables always take precedence.
[Rubric §22, Responsive & Cross-Browser]: `E2E_BROWSER` is the mechanism for running the same suite
against all three browser engines in CI.

#### `PlaywrightFixture` + `E2ETestCollection`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6`

`PlaywrightFixture` is an xUnit v3 `IAsyncLifetime` collection fixture. `InitializeAsync()` (line 11)
creates a `IPlaywright` instance, then resolves the browser type from `E2ETestConfiguration.Browser`
via a switch on the upper-cased value (lines 17-22): `"FIREFOX"` to `Playwright.Firefox`,
`"WEBKIT"` to `Playwright.Webkit`, any other value to `Playwright.Chromium`. The comment above the
switch (lines 15-16) calls out the rubric §22 cross-browser intent explicitly. `DisposeAsync`
(line 31) disposes browser and playwright in order, and it null-guards both (lines 35-43) because a
failed `InitializeAsync` (no browser binaries, a launch timeout) leaves them null despite the `null!`
declarations, and the `NullReferenceException` from disposal then replaced the real launch error in
the run output. `E2ETestCollection` (line 48) is the xUnit `[CollectionDefinition]` that wires the
fixture to all classes decorated with `[Collection(E2ETestCollection.Name)]`.

#### `E2ETestBase`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:9`

The abstract base all E2E test classes inherit from. Decorates itself `[Collection(E2ETestCollection.Name)]`
(line 8) so it receives the `PlaywrightFixture` singleton. `InitializeAsync()` (line 20) creates a
fresh `IBrowserContext` (with `IgnoreHTTPSErrors: true` for local dev TLS), sets `DefaultTimeout`
from config, optionally starts a trace, and opens a new `IPage` per test. `DisposeAsync()` (line 40)
stops any trace, closes the page and disposes the context, guaranteeing test isolation at the
browser-session level.

Key methods:

- `LoginAsync(email, password)` (line 98), clears any existing session from **both** token stores
  (localStorage for WASM/MAUI hosts and the HttpOnly session cookie for the Blazor Server host;
  clearing only localStorage would leave the next login authenticated as the wrong user), navigates
  to `/login`, fills email and password via `FillFieldAsync`, clicks "Sign in", then settles the
  result through `WaitForAuthResultAsync` (line 136).
- `WaitForAuthResultAsync(authPagePath, operation)` (line 214) races **three** signals with
  `Task.WhenAny` (line 228): the `forceLoad` URL change away from the auth page (line 219), the
  logout button appearing (line 223), and an error alert appearing (line 225). The URL change is the
  interactivity-independent success signal, which matters because under Blazor Server prerender on a
  contended runner the interactive "Sign out" button can hydrate long after a successful login
  (comment, lines 206-213). The losing tasks are explicitly observed (lines 232-234, helper at line
  272) so their timeouts do not surface as unobserved-task failures in an unrelated test.
- **The verdict is a pure function, not inline branching.** The three observed booleans go through
  `AuthOutcomeRules.Classify` (line 236, defined at
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AuthOutcomeRules.cs:38`), which
  returns one of three outcomes (`AuthOutcome`, `AuthOutcomeRules.cs:4`): `Succeeded`, `ErrorShown`,
  `Silent`. Navigation away or a visible logout control wins outright, so an error alert flashed on
  the way out is not a failure (`AuthOutcomeRules.cs:30-34`). Pulling the classification out of the
  browser code is what makes the four-way decision unit-testable without Playwright
  (`AuthOutcomeRules.cs:16-27`).
- **`Silent` is the case the design exists for, and it now fails.** Both non-success outcomes get the
  grace window once (`AuthSucceededWithinGraceAsync`, line 282, called at line 248), because a slow
  Server-mode success can still be finishing when all three waits time out. After that, `ErrorShown`
  throws with the alert text (lines 253-257) and `Silent` throws naming the elapsed budget and the
  current URL (lines 263-267). A submit that produces neither a navigation nor a rendered error (a
  500 that renders nothing, a dropped request, a JS exception mid-submit) used to let the wait return
  normally, and the caller's follow-up interactivity wait was already satisfied by the
  still-rendered auth page, so login and registration reported success on a sign-in that never
  happened and the real failure surfaced much later as an unrelated assertion (lines 259-262).
- `LoginAsAdminAsync()` (line 92) / `LoginAsUserAsync()` (line 95) delegate to `LoginAsync` with
  credentials from `E2ETestConfiguration`.
- `RegisterNewUserAsync(firstName?, lastName?)` (line 147), synthesizes a unique email, fills the
  registration form, submits, and settles through the same three-signal wait (line 170).
- `WaitForInteractiveOrReloadAsync()` (line 193), waits for interactivity after a post-auth
  `forceLoad` and, if that fails, **reloads once** and waits again rather than re-waiting on the
  same stalled boot. It catches `TimeoutException` as well as `PlaywrightException`, because
  Playwright's timeout derives from `System.TimeoutException` and the narrower catch skipped the
  retry entirely.
- `NavigateAndWaitAsync(path)` (line 302) and `FillFieldAsync(ILocator, string)` (line 310), which
  delegates to `PageExtensions.FillAndVerifyAsync`, the shared Blazor re-hydration guard (see below).
- `UniqueId()` (line 313), eight-char GUID fragment for unique test data.
- `ScanGridAsync()` (line 324) and `ScanAsync()` (line 334), the two accessibility entry points.
  `ScanAsync` waits for any loading bar to clear then asserts the strict `AxeOptions.Wcag21Aa`
  (line 337); `ScanGridAsync` additionally waits for a seeded data row (line 326) then asserts with
  the one recorded exception, `AxeOptions.Wcag21AaExceptMudPagerCombobox` (line 329). **Which helper
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
  compiler (line 33).

Writing the exception as a second named constant rather than a suppression flag forces the caller to
say which contract it is scanning under, and keeps the justification attached to the thing excepted.

#### `PageExtensions`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:23`

C# preview `extension(IPage page)` (line 62) and `extension(ILocator locator)` (line 335) blocks that
isolate Blazor InteractiveAuto rendering quirks:

- `WaitForBlazorAsync(timeout)` (line 85), polls `window.Blazor?._internal` until truthy
  (the runtime is ready), then lets the render pipeline flush. Without this, event handlers are not
  attached and clicks/fills are silently ignored.
- `GotoAndWaitForBlazorAsync(path)` (line 103), combines `GotoAsync` + `WaitForLoadStateAsync(Load)`
  (not `NetworkIdle`, Blazor's SignalR WebSocket keeps a persistent connection open, so
  `NetworkIdle` is never reached) + `WaitForBlazorAsync` (line 109).
- `BlazorNavigateAsync(path)` (line 118), uses `Blazor.navigateTo` for client-side SPA
  navigation (avoids a full page reload), then polls `window.location.pathname` (line 137) rather
  than calling `WaitForURLAsync`, whose default `WaitUntil=Load` hangs on a same-document navigation
  and leaves the page perpetually "navigating", blocking later actions (lines 132-135).
- `GotoProtectedAsync(path)` (line 160), the auth-protected variant: SSR cannot read JWTs from
  localStorage, so a full page load to an `[Authorize]` page redirects to `/login`. This ensures the
  runtime is available (loading a public page first if needed, line 177) and re-routes via `"/"`
  (line 186) so the target path always triggers a fresh component lifecycle.
- `WaitForPageAndBlazorAsync()` (line 197), waits for `Load` state + render flush; use
  after link/button clicks that trigger full-page navigation.
- Three grid helpers close the gap between "the request finished" and "the DOM settled" on the
  MudBlazor data grids every list page uses: `SearchAndWaitForRowAsync` (line 233),
  `ConfirmDeleteAsync` (line 266) and `WaitForGridToSettleAsync` (line 293). A server-side grid
  re-renders after its own fetch, so asserting immediately after a click reads the pre-fetch rows.
- `FillAndVerifyAsync(value, timeout)` (line 347), fills a form field then asserts
  `ToHaveValueAsync` with Playwright's built-in retry. If the pre-render value was wiped by
  re-hydration (a common Blazor InteractiveAuto timing bug), it falls back to `PressSequentiallyAsync`
  and re-asserts. This is the single shared fill helper for the whole E2E layer.
- `ClickAndVerifyAsync(expected, timeout)` (line 380), the submit-side counterpart: a click that
  lands before the runtime wires `@onclick` is silently ignored, so this clicks, waits a slice of the
  timeout for the visible effect, and re-asserts interactivity before retrying (line 403). A
  genuinely applied click surfaces its effect within one slice, so there is no double submit.
- `ClickAndWaitForUrlAsync(page, urlPattern)` (line 423), the navigation-side counterpart, for
  in-cell grid links (clicking the row itself lands on cell padding between the inline anchors and
  does nothing).
- `AssertNoAccessibilityViolationsAsync(options?)` (line 307), runs `page.RunAxe()` from
  `Deque.AxeCore.Playwright`, collects violations, and throws `AccessibilityViolationException`
  (line 330) if any are found. The message carries each rule's impact, id, help text, node count and
  the offending markup compacted to one line per node (lines 320-328), so a red gate points at the
  element rather than at a dashboard. [Rubric §21, Accessibility]: §21 assesses whether the app meets
  WCAG 2.1 AA; this extension method is the single enforcement point.

The file also carries two documented analyzer suppressions worth knowing about before you edit it
(lines 17-22): CA1708 fires falsely when one static class holds multiple `extension(T)` blocks, and
IDE0051 in SDK 10.0.201+ does not track references that cross an extension-block boundary, so
private members consumed only from inside a block read as unused.

#### `AccessibilityViolationException`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7`

A typed exception thrown by `AssertNoAccessibilityViolationsAsync`. Giving axe-core violations
their own exception type means test runners display the violation summary in the failure message
without requiring the test author to parse raw JSON.

#### `WebVitalsCollector`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs`

Collects Core Web Vitals from a live page so a budget can be asserted in the browser tier;
MMCA.Common's `WebVitalsE2ETests` is its worked consumer.

#### Page objects
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/PageObjects/`

Five pre-built page-object models for the Identity pages every downstream app shares: `LoginPage`,
`RegisterPage`, `ProfilePage`, `ForgotPasswordPage` and `ResetPasswordPage`. The form-bearing ones
encapsulate locators and the fill/submit sequence and use `FillAndVerifyAsync` internally;
`ProfilePage` exposes profile-field locators and the "Change Password" / "Delete Account" button
locators. Downstream projects extend by composition or inheritance.

#### Workflow base classes
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/`

Eight abstract test bases: six for the standard Identity workflows (`UserLoginTestsBase`,
`UserRegistrationTestsBase`, `ProfileManagementTestsBase`, `LogoutTestsBase`,
`AuthorizationTestsBase` and `PasswordResetTestsBase`, all under `Workflows/Identity/`), one for user
preferences (`Workflows/Preferences/UserPreferencesTestsBase.cs`) and one for pseudo-localization
(`Workflows/Globalization/PseudoLocalizationTestsBase.cs`). Each extends `E2ETestBase`, provides
concrete `[Fact]` methods that apply to any app using `MMCA.Common`'s Identity UI, and the login,
register, profile and password-reset bases call
`AssertNoAccessibilityViolationsAsync(AxeOptions.Wcag21Aa)` once the page is interactive
(`UserLoginTestsBase.cs:83`, `UserRegistrationTestsBase.cs:91`, `ProfileManagementTestsBase.cs:180`,
`PasswordResetTestsBase.cs:88,99`).
[Rubric §21, Accessibility]: axe-core is called **in the base**, not in the consumer, so an app that
adopts the Identity workflow tests cannot accidentally adopt them without the a11y scan. Opting out
is visible, because it means not subclassing the base: MMCA.ADC subclasses login, register, logout,
authorization and password reset but derives its `ProfileManagementTests` from `E2ETestBase` directly
(`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:8`), because its
profile page supports only password change and account deletion, and MMCA.Helpdesk has no E2E project
at all.

### MMCA.Common.Testing.UI

`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/`, 16 types, shipped as `MMCA.Common.Testing.UI`.
This is the bUnit half of the two-tier UI strategy, consumed by every `*.UI.Tests` project across the
repos.

- `BunitComponentTestBase` (`Infrastructure/BunitComponentTestBase.cs:37`) extends bUnit v2's
  `BunitContext` and, in its constructor (line 44), registers MudBlazor services (line 46), the
  vendor-neutral toast/confirm facades every migrated page injects (line 53), puts JSInterop in
  `Loose` mode (line 55, so MudBlazor components that probe JS during render do not throw), adds
  `AddAuthorizationCore` with a permissive-but-real `IsAuthenticatedAuthorizationService` (lines
  56-57), registers a **mutable** `AuthenticationStateProvider` (line 58), adds logging plus
  localization (lines 63-64, so components that inject `IStringLocalizer<T>` render without per-test
  setup), and `TryAdd`s `TimeProvider.System` (line 70) so a test that drives time deterministically
  can register a fake instead.
- The provider is mutable (`MutableAuthenticationStateProvider`, line 162) because it must serve both
  cascading-`AuthenticationState` consumers and pages that call `GetAuthenticationStateAsync()` on the
  injected service (class remarks, lines 25-27). `RenderAs<TComponent>(principal, parameters)`
  (line 130) sets the principal and renders with a matching cascading value;
  `RenderUnderTest<TComponent>` (line 124) is the anonymous shortcut; `SetUser` (line 121) changes the
  principal mid-test.
- `RenderMudProviders()` (line 148) renders MudBlazor's popover, dialog and snackbar providers into the
  test's render root so a component that opens a `MudMessageBox` or raises a snackbar has somewhere to
  render, returning the handles as a `MudProviderHandles` record (line 157).
  `ConfigureDataGridListPageHost` (line 100) is the shared arrange step for the grid-backed list pages.
- The remaining types are supporting doubles: `TestPrincipal`, `MarkupSnapshot`,
  `BunitInteractionExtensions`, `ErrorSummaryExtensions`, `HttpTestDoubles`,
  `CapturingHttpMessageHandler`, `StubTokenStorageService`, and `UiHttpServiceHarness`.
- The class remarks (lines 29-35) record the version pin worth knowing: it is written against bUnit v2
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
reusable rule library, now **29 `ArchitectureRules.*` partial classes**
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/`: `Layers`, `Purity`, `Transport`,
`Modules`, `Handlers`, `Entities`, `Naming`, `Events`, `Controllers`, `Governance`, `HandlerResults`,
`Immutability`, `Slices`, `Specifications`, `Localization`, `LocalizedText`, `CancellationTokens`,
`CascadeSoftDelete`, `CommandValidators`, `Contracts`, `Cycles`, `DomainEventHandlerSaves`,
`DomainThrows`, `ErrorCatalog`, `Idempotency`, `Markup`, `Protos`, `SoftDelete`, `Upcasters`), plus a
`CallGraphIndex` for the rules that must follow a call chain rather than a type reference, and
**46 abstract `*TestsBase` classes** in `Bases/`, all parameterized by an `IArchitectureMap`. The
package declares **123 test methods across those 46 bases**, and MMCA.Common's own build executes
**196** of them: the methods of the bases its arch-tests subclass, plus its Common-only direct tests
(`MMCA.Common/FACTS.md:46,49`, which is generated from source and CI-gated, so it is the number to
quote rather than a hand count).

Each repo's `*.Architecture.Tests` project consumes the package and supplies its own map:
`CommonArchitectureMap` (MMCA.Common, every layer is a framework layer, one anchor type per package),
`AdcArchitectureMap` (adds the per-module Identity/Conference/Engagement/Notification layers),
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
`EnforceUIMauiLayerBoundary` in `Source/Build/MMCA.Common.LayerEnforcement.targets` and the windows
`build-maui` job instead.

The walkthroughs below describe **what each rule enforces** (and the count of facts it produces);
the rule *implementations* live in the shared package's `ArchitectureRules.*` + `*TestsBase` files,
not in the per-repo test class.

### MMCA.Common.Architecture.Tests, 158 types

Located at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/`. Of its 49 `.cs` files,
**forty-seven declare test classes**; one more is `CommonArchitectureMap` and the last is
`GlobalUsings.cs`. The rest of the 158 inventoried types are the fakes, drifted probes and fixtures
the adversarial suites drive. The project falls into two halves:

**Thin subclasses of a shared mapped base** (about half the files): `LayerDependencyTests`,
`DomainPurityTests`, `MicroserviceExtractionTests`, `PiiConventionTests`, `AggregateConventionTests`,
`DependencyVersionTests`, `EventVersioningConventionTests`, `SliceCohesionTests`,
`HandlerResultConventionTests`, `RawQueryableConventionTests`, `UIArchitectureConventionTests`,
`StateManagementConventionTests`, `LocalizationResourceTests`, `LocalizedTextConventionTests`,
`AnonymousEndpointTests`, `CancellationTokenConventionTests`, `CascadeSoftDeleteConventionTests`,
`ConcurrencyConventionTests`, `ContractImplementationTests`, `IdempotencyConventionTests`,
`NamespaceCycleTests`, `ServiceContractPurityTests`, `SoftDeleteEnforcementTests`, plus the two
conformance subclasses over fake modules (`FakeLeafModuleConformanceTests` and
`FakeDependentModuleConformanceTests`, `ModuleConformanceTestsBaseTests.cs:51,60`).

**Common-only direct tests that guard the rules themselves.** This is the half that has grown most,
and it is the interesting one: a `*FitnessTests` file exists wherever a mapped rule would otherwise
pass vacuously in a framework that ships no business module, or where the rule's own logic needed
adversarial coverage. The family is `PiiErasureContractFitnessTests`, `SpecificationFitnessTests`,
`CancellationTokenFitnessTests`, `CascadeSoftDeleteFitnessTests`,
`CommandValidatorCoverageFitnessTests`, `DomainEventHandlerSaveFitnessTests`,
`DomainThrowFitnessTests`, `ErrorCatalogFitnessTests`, `EventScopeFitnessTests`,
`EventUpcasterFitnessTests`, `IdempotencyFitnessTests`, `NamespaceCycleFitnessTests`,
`PasswordHashingFitnessTests`, `ProtoContractFitnessTests`, `SoftDeleteEnforcementFitnessTests` and
`SortableColumnFitnessTests`, alongside `FrameworkSanityTests`, `NavigationContractTests`,
`LayerDependencyOverrideTests`, `AnonymousEndpointTestsBaseTests`,
`IntegrationEventContractTestsBaseTests`, `ModuleIsolationTestsBaseTests`,
`ObservabilityConventionTestsBaseTests` and `ModuleConformanceTestsBaseTests`.

Four of them deserve naming, because they exist to stop a gate becoming a decoration:

- `PiiErasureContractFitnessTests` forces a representative `[Pii]`-carrying data subject through
  `PiiRedactor` and `IAnonymizable` end to end, because the mapped `PiiConventionTests` scan is
  structurally vacuous in a framework that ships no data-subject entity.
- `SpecificationFitnessTests` tests the rule itself: it asserts
  `SpecificationsDoNotNavigateToOtherEntities` flags a navigating specification and does **not** flag
  a scalar one.
- `ObservabilityConventionTestsBaseTests` subclasses `ObservabilityConventionTestsBase` from a
  *different assembly* than the base (line 14), because the base must read the embedded IaC resources
  of the subclass's assembly. Resolving against the base's own assembly would be a silent break that
  the framework's own CI would never catch.
- `ModuleConformanceTestsBaseTests` (`ModuleConformanceTestsBaseTests.cs:86`) is adversarial coverage
  for `ModuleConformanceTestsBase<TModule>`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ModuleConformanceTestsBase.cs:21`),
  the base the consumer repos' near-identical `{X}ModuleTests` files collapse into. Its four facts
  (lines 39, 45, 58, 64) assert name, dependencies, `RequiresDependencies` and disabled-stub
  registration; the drift tests assert each check actually **fails** on the drift it claims to catch,
  driven by a `private` drifted subclass (line 131) so xUnit does not collect its deliberately failing
  inherited facts as tests of their own. Another runs the base against a leaf module that overrides
  neither member, proving the base reaches `IModule`'s **default interface implementations** rather
  than members on the concrete type, which is the one thing that would break silently across the
  package boundary.

#### `LayerDependencyTests`
`MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9`

15 `[Fact]` methods from `LayerDependencyTestsBase`
(`MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:52-96`): two anti-vacuity guards
plus one per forbidden directed edge in the layer graph.

- `LayerMap_DeclaresEveryExpectedLayer` and `LayerMap_ModulesDeclareEveryExpectedLayer` (2 facts,
  lines 53 and 56). These assert the map actually declares the required layers (`RequiredLayers`,
  line 16; `RequiredModuleLayers`, line 27) and that every declared module registers them too, so a
  map that quietly stopped covering an assembly cannot leave the rules below passing on nothing. A
  module with a deliberately different shape declares that in
  `ModuleRequiredLayerOverrides` (line 49) rather than by being skipped.
- `Domain_ShouldNotDependOn_Application/Infrastructure/Api` (3 facts, lines 60-66)
- `Application_ShouldNotDependOn_Infrastructure/Api` (2 facts, lines 69-72)
- `Infrastructure_ShouldNotDependOn_Api` (1 fact, line 75)
- `Shared_ShouldNotDependOn_Domain/Application/Infrastructure/Api` (4 facts, lines 78-87)
- `Ui_ShouldNotDependOn_Domain/Application/Infrastructure` (3 facts, lines 90-96)

The last three confirm the two deliberate exceptions to the standard stack (`UI` and `Grpc` depend
only on `Shared`) are honored in the other direction, `UI` must not depend on Application,
Infrastructure, or Domain.

#### `DomainPurityTests`
`MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9`

4 facts (`Bases/DomainPurityTestsBase.cs:15,18,21,24`). Two assert Domain and Shared contain no
reference to the forbidden framework list, which lives once in `ArchitectureRules.Purity`
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
`MassTransit`, `Grpc` and `Google.Protobuf` (`ArchitectureRules.Transport.cs:13-15`) must never leak
into Domain, Application or Shared, so a module behaves identically in-process or extracted and the
split stays reversible.

The Common-only sanity checks the shared library does not generalize live in **`FrameworkSanityTests`**
(`MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:13`), not in `MicroserviceExtractionTests`.
Six facts (lines 22-47): `Grpc` must not depend on `Domain`, `Application` or `Infrastructure`
(lines 22, 27, 32); `IMessageBus` lives in `Application` (line 37); `IJwksProvider` lives in
`Infrastructure` (line 42); and `ILiveChannelPublisher` lives in `Application` (line 47), so
application code stays transport-free. These pin the abstractions and the transport package to their
correct layer so a future refactor cannot quietly move them. They are Common-only because MMCA.Common
is the one repo that owns the `MMCA.Common.Grpc` transport package and defines those abstractions
(`FrameworkSanityTests.cs:9-11`).

#### `PiiConventionTests`
`MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13`

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

4 facts checking DDD factory conventions (`Bases/AggregateConventionTestsBase.cs:15,18,21,24`). This
is the minimal aggregate base, for repos with no business modules; module-bearing repos use the
fuller `EntityConventionTestsBase` instead.

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
  MassTransit ids (line 17): `MassTransit`, `MassTransit.RabbitMQ`,
  `MassTransit.Azure.ServiceBus.Core`, with an exclusive major ceiling of 9 (line 31).
- `ImageSharp_MustNotExceed_MajorVersion3` (line 48) over `SixLabors.ImageSharp` (line 45), ceiling 4
  (line 54). ImageSharp v4 needs a Six Labors license key at **build** time, so a blanket bump breaks
  every build.

MMCA.Common is the only repo that declares this class, and deliberately so: the consumers do **not**
pin MassTransit (it flows transitively through `MMCA.Common.Infrastructure`), so subclassing with the
default list would assert a pin they do not declare (base doc, lines 7-14). [Rubric §32, Dependency &
Supply-Chain]: §32 assesses whether dependency versions are tracked, pinned, and protected against
accidental bumps; this is the build-time gate for the most dangerous version upgrades in the codebase.
(See the primer `00-primer.md#nuget-lock-files--pinned-audited-sources` for context.)

### MMCA.ADC.Architecture.Tests, 43 types

Located at `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/`: 42 fitness-function classes
plus `AdcArchitectureMap`. Like the Common project, most are thin subclasses of the shared
`*TestsBase` classes from `MMCA.Common.Testing.Architecture`, referenced as a NuGet package
(`MMCA.ADC.Architecture.Tests.csproj:41`; the project also references `MMCA.Common.Testing` at line
43 for `DecoratorPipelineOrderTestsBase` and `MiddlewarePipelineOrderTestsBase`). Each supplies
`AdcArchitectureMap` (`AdcArchitectureMap.cs:14`), which declares the five MMCA.Common framework
layers (lines 21-25) and then the module layers: six each for Identity (28-33), Conference (36-41)
and Engagement (44-49), and **three** for Notification (52-54), which owns no aggregate and no
persistence and therefore ships no Domain, Infrastructure or UI assembly (type comment, lines 8-11).
`LayerDependencyTests` records that shape in its per-module required-layer override rather than
skipping the module, which keeps full enforcement on the other three. The rule bodies are shared;
only the map and the per-repo overrides differ.

The csproj also embeds three files as resources (`MMCA.ADC.Architecture.Tests.csproj:7-23`), because
three of the gates read artifacts rather than assemblies: the shared `ADCHome.razor.css` for the
brand-token guard (lines 11-13), and `infra/main.bicep` plus `infra/OPERATIONS.md` for the SLO
alert-to-runbook pairing guard (lines 17-22).

#### `LayerDependencyTests` (ADC)
`MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3`

The same 15 facts as the Common subclass, but the map iterates every framework layer **and** every
declared module layer, so each rule runs once per assembly. The two anti-vacuity guards matter more
here: `LayerMap_ModulesDeclareEveryExpectedLayer` fails if a module stops declaring one of the layers
its override says it has, which is what stops a new module silently escaping the dependency rules.

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

The same single transport-isolation fact, applied across all ADC module layers. For Domain,
Application and Shared of every module, plus the Common Domain/Application layers, none of
`MassTransit`, `Grpc` or `Google.Protobuf` may appear. Transport belongs only in Infrastructure, the
`*.Service` hosts, and `*.Contracts` projects. A NetArchTest quirk worth knowing, recorded in the
rule itself (`ArchitectureRules.Transport.cs:9`): it matches by namespace *prefix*, so `'Grpc'`
catches `Grpc.Core` / `Grpc.Net.*` / `Grpc.AspNetCore` but NOT the project's own `MMCA.Common.Grpc`
(which starts with `MMCA`), so the rule does not accidentally flag the framework's own transport
package.

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
| `AnonymousEndpointTests` | Every `[AllowAnonymous]` endpoint is a declared, reviewed exception rather than an accident (§11) |
| `CascadeSoftDeleteConventionTests` | Soft-deleting a parent cascades to the children the model says it owns |
| `ContractImplementationTests` / `ServiceContractPurityTests` | The gRPC service contracts and their implementations stay on the right side of the transport boundary |
| `DomainEventHandlerSaveTests` | A domain-event handler does not call `SaveChangesAsync` inside the dispatching transaction |
| `DomainThrowTests` | Domain code returns `Result` failures rather than throwing |
| `ErrorCatalogTests` | Error codes come from the shared catalog, not ad-hoc strings |
| `IdempotencyConventionTests` | Every POST action declares `[Idempotent]` or `[NonIdempotent("why")]` |
| `ProtoContractTests` | The `.proto` contracts keep their field numbering and reserved ranges |
| `SoftDeleteEnforcementTests` | Queries and deletes go through the soft-delete path, never a hard delete |
| `SortableColumnConventionTests` | Every grid column advertised as sortable maps to a real orderable property |
| `MicroserviceExtractionTests`, `LayerDependencyTests`, `ModuleIsolationTests`, `PiiConventionTests` | Covered above |
| `HandlerResultConventionTests` | Every handler's `TResult` is `Result` or `Result<T>`, turning the pipeline's runtime `ResultFailureFactory` constraint into a build-time gate |
| `FrameworkVersionConsistencyTests` | All `MMCA.Common.*` pins in `Directory.Packages.props` share one version: ADR-016 lockstep made executable, so a partial sweep reds at CI time |
| `SpecificationConventionTests` | No specification filters by navigating to another entity (which would not translate if that entity moved data source); kept on as a forward safeguard after the Cosmos/SQLite trial was reverted (ADR-018) |
| `StateManagementConventionTests` | The module UI assemblies carry no mutable static state (a static member is shared across every Blazor Server circuit) and stateful UI services stay scoped (§19) |
| `UIArchitectureConventionTests` | Every code-behind under `Source/` stays within the line cap and inline `@code` blocks stay small (§18) |
| `MiddlewarePipelineOrderTests` | The ADR-058 edge-pipeline order base, subclassed with an empty body because ADC's hosts call the zero-argument `UseCommonMiddlewarePipeline()` overload (line 15) |

| Class with a per-repo override | The decision it encodes |
|---|---|
| `ControllerConventionTests` | Controllers inherit `ApiControllerBase` and declare `[ApiVersion]`, with an explicit exemption list (line 11): `OAuthController` drives the OAuth2 redirect/challenge flow and `ServiceInfoController` is an anonymous version-discovery diagnostic, so neither returns domain Results |
| `IntegrationEventContractTests` | Freezes the cross-service async wire contract as literal signatures (line 9). Reshaping one without versioning it reds the build |
| `ConstructorDependencyCountTests` | Single-responsibility ceiling of **9** (line 24). The doc comment (lines 10-17) is the whole point of the class: it was 8 while the comment claimed `AuthenticationService` had 8 dependencies when it had 7, so the gate carried a phantom slot of headroom and was tightened to the real mark on 2026-07-28; it then moved to 9 when refresh tokens became multi-device sessions and the framework's `AuthenticationServiceBase` took on the session store and its options. Both additions are framework-imposed collaborators of the same facade rather than a second responsibility, so the honest response was a raised ceiling and not an artificial bundle |
| `RawQueryableConventionTests` | Application code must not use the repository's raw `IQueryable` surfaces (EF-coupled handlers cannot move behind a gRPC boundary). `AllowedFiles` (line 33) is an adoption ratchet pinning existing deliberate uses so only NEW code is blocked; `ApplicationSourceDirectories()` (line 21) appends the Notification module's Application project by path so the thin module is scanned under the same rule |
| `FormsConventionTests` | The Conference create forms keep their `UnsavedChangesGuard`, dirty tracking, validated `MudForm` and per-form error summary (§24); `MinimumCreateForms => 8` (line 21) is the anti-vacuity floor and `RequiredMarkers` (line 40) is the marker set, plus a bespoke fact for the Identity Profile form, which does not match the `*Create.razor` glob |
| `LocalizedTextConventionTests` | No hard-coded user-visible literals in `.razor`; `MinimumScannedFiles = 60` (line 18) is the anti-vacuity floor |
| `TranslationCompletenessTests` | Every base `.resx` has a complete, non-empty `.es.resx` sibling (`RequiredCultures`, line 14); `MinimumBaseResources = 40` (line 16) is the floor (§27, ADR-027) |
| `CommandValidatorCoverageTests` | Every handled, data-carrying command has a real validator, with a `MinimumCommands` floor so the module dropping out of the map fails loudly rather than passing vacuously |
| `BrandColorTokenTests` | The shared `ADCHome` stylesheet sources the primary brand color from `var(--mmca-primary)`, not a re-hardcoded hex (§20). Reads the embedded CSS, not an assembly |
| `DataResidencyTests` | The data-residency statement in `PRIVACY.md` must match the region where PII is actually provisioned, extracted by `ExtractDeployedRegion` (line 20) from `deploy.yml`. `ForbiddenResidencyClaims` (line 16) blocks the stale "central United States" wording that once contradicted the deployed region (§30) |
| `ObservabilityConventionTests` | Every provisioned SLO alert in `infra/main.bicep` keeps a matching, severity-correct section in `infra/OPERATIONS.md`, and no orphan runbook sections exist (§13). Reads the two embedded resources |
| `DecoratorPipelineOrderTests` | The ADR-058 runtime conformance base, driven against the real `ChangePreferencesCommand` / `GetUserPreferencesQuery` pair through the Identity module's genuine registration sequence (line 28) |

### The topology gate that reads the AppHost and the Bicep

Three of the ADC architecture gates read artifacts rather than assemblies. A fourth of the same shape
lives outside the architecture project, in the Gateway suite:
`AppHostBicepParityTests` (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/AppHostBicepParityTests.cs:24`).

The service-discovery topology is declared **twice** and nothing connects the two declarations. The
Aspire AppHost's `WithReference(peer)` calls inject `services__{peer}__{endpoint}__0` environment
variables for local development and the E2E stack; `infra/main.bicep` hand-writes the same variables
onto each production container app. So a new cross-service call wired in the AppHost boots locally,
passes every test, and then fails in production with an unresolvable service name, and the reverse
case (a Bicep entry for an edge that no longer exists) is dead configuration nobody notices
(class doc, lines 7-16).

Two facts close the loop in both directions:
`EveryAppHostServiceReference_HasAMatchingBicepServiceDiscoveryEntry` (line 53) and
`EveryBicepServiceDiscoveryEntry_HasAMatchingAppHostReference` (line 73). Three details are worth
reading:

- **Both files are read as text, not executed** (lines 17-22). The AppHost is a
  `DistributedApplication` that hangs when started headless, and Bicep is not executable in a test
  process at all. `ReadAppHostEdges` (line 98) parses `Source/Hosting/MMCA.ADC.AppHost/Program.cs`
  statement by statement, mapping each `AddProject<Projects.X>("name")` variable to its Aspire
  resource name (lines 104-105) and attributing every `WithReference` to the resource the statement
  is about (lines 112-128), so both the chained and the standalone call forms are counted. The parse
  is deliberately narrow so reformatting either file does not move the gate.
- **The exception list carries reasons, not just names.** `KnownAppHostOnlyEdges` (line 43) holds the
  five UI edges that production deliberately does not wire as service discovery, and the remarks
  above it (lines 31-42) say why: the Blazor server head reaches only the gateway, through
  `Api__ApiEndpoint`, because one of its consumers is a SignalR `HubConnection` that builds its own
  message handler and never sees the service-discovery handler, while the WASM client needs the
  separately-configured browser-reachable `Api__WasmApiEndpoint`. The comment states the operating
  rule plainly: an unexplained entry is indistinguishable from the drift the test exists to catch
  (lines 28-29).
- **The parse is guarded against becoming vacuous.** The reverse fact asserts the Bicep edge set is
  non-empty first, on the grounds that an empty parse means the test stopped reading the file rather
  than that the file is clean (line 85).

[Rubric §17, DevOps & Deployment]: §17 assesses whether the deployment configuration is verified
rather than trusted; this is a unit-tier test that gates a production infrastructure fact, at no
Azure cost and no container start. [Rubric §13, Observability & Operability]: an unresolvable
service name is a production-only failure with a confusing signature, and this converts it into a
build-time one.

### The same rules in Store and Helpdesk

MMCA.Store's `MMCA.Store.Architecture.Tests` subclasses the same bases over `StoreArchitectureMap`,
and adds the same two order gates (`DecoratorPipelineOrderTests.cs:28`,
`MiddlewarePipelineOrderTests.cs:15`).

MMCA.Helpdesk is the interesting case, because it is the reference app: the bulk of its architecture
suite is **one file** of 21 one-line subclasses over `HelpdeskArchitectureMap`
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs`, 181 lines),
which is the intended cost of adoption made visible. Five siblings sit beside it where a subclass
needed more than one line: `AnonymousEndpointTests`, `ContractImplementationTests`,
`ServiceContractPurityTests`, `DecoratorPipelineOrderTests` and `MiddlewarePipelineOrderTests`.

Two details in that file are worth reading. Several subclasses carry a short comment explaining why
the seed opts in even where the rule is vacuous today: `SpecificationConventionTests` is vacuous
because Tickets has no specifications, but keeps the reference app consistent and guards future ones
(lines 25-28), while `EventConventionTests` is explicitly non-vacuous because Tickets ships
`TicketOpenedIntegrationEvent`, which closed an enforcement gap where the rule was only subclassed in
ADC and Store (lines 34-37). And `CommandValidatorCoverageTests` sets `MinimumCommands => 6` against
7 real commands (lines 167-174), with the reasoning that the floor should sit just below the true
count so a rename does not trip it while the module dropping out of the map still does.

The trailing comment (lines 177-181) is the part to read last: it records which bases are **not**
adopted and why, separating "legitimately inapplicable" (`ConstructorDependencyCountTestsBase`
deliberately fails when it finds no Application `*Service`, and this seed's Application layer is
handlers-only; `DataResidency`/`BrandColorToken`/`FormsConvention` are reduced-scope) from an
enforcement gap, and it names the trigger for adopting the first one (the moment an Application
`*Service` appears, at ceiling 7 to match ADC). That distinction is the difference between an audited
inventory and an unexamined one.

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
   `(localdb)\MSSQLLocalDB` (line 70).
2. **Environment injection.** Before the host builds, `ASPNETCORE_ENVIRONMENT=Testing` and the
   connection string are pushed as **process environment variables** (lines 75-76), then the
   subclass pushes its own (line 77). Process variables rather than `ConfigureAppConfiguration`
   because the host reads these at configure-time, before `WebApplicationFactory`'s
   `ConfigureServices` override runs. Pinning `Testing` also stops `appsettings.Development.json`
   loading, whose `DataSources` entry would point the module at `localhost` (line 74).
   Only the **first** original value per key is recorded (line 149), so re-pushing a key cannot
   clobber the restore point, and every one is restored on disposal (lines 159-164).
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
   (lines 182-183). The GUID name is server-generated, never user input, which is why the CA2100
   suppression there is safe (line 179).

The Identity fixture is what is left after all that:
`IdentityIntegrationTestFixture` (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:22`)
declares `ADC_TEST_SQL_BASE` (line 24) and `ADC_IdentityIntegrationTest` (line 26), returns its
factory (line 28), and overrides `ConfigureTestEnvironment` (line 39) with the Identity-specific
concerns: re-pointing the named `DataSources__Identity__SQLServerConnectionString` entry at the same
throwaway database (line 46, because identical strings collapse onto one physical source and keep the
module's tables in the test database), the committed RS256 test keypair and `kid` (lines 49-53), a
lifted registration throttle so the register tests can create several accounts from one IP
(lines 55-56), and dummy OAuth client credentials so the Google/GitHub challenge endpoints wire up
without any real provider call (lines 62-66). It is left **non-sealed** (doc, lines 18-21) so
`JwksEnabledIdentityFixture` can add the single JWKS-publishing delta. The web-application factory
beside it neutralizes the global rate limiter for the same reason
(`IdentityTestWebApplicationFactory.cs:47`).

Cross-service gRPC edges are faked for isolation: the non-Identity services re-point their
`AddForwardedJwtBearer` scheme at the in-process test key, and gRPC clients that would call other
services use stub implementations. This keeps each integration suite testing only its own service's
behavior. [Rubric §14, Testability]: §14 awards credit for isolation, per-test DB reset plus
per-service `WebApplicationFactory` means each test is truly independent.

### Testcontainers tiers: where the fakes stop

The fakes above are the point of the per-service tier, and also its limit: nothing in it exercises a
real broker or a real cross-service call. Two Docker-dependent projects close that gap, both in
`MMCA.ADC.slnx` but in neither `.slnf`, so a full `dotnet test --solution MMCA.ADC.slnx` needs a
Docker daemon (`MMCA.ADC.slnx:99-102` records exactly that).

- `MMCA.ADC.CrossService.IntegrationTests` (13 types) boots the three REST hosts in one process
  against real SQL Server and RabbitMQ containers and drives the genuine outbox to broker to
  consumer round-trip (the `UserRegistered` speaker auto-link, the `SpeakerLinked`/`Unlinked`
  back-link) plus the real Conference to Engagement gRPC read.
- `MMCA.ADC.ServiceBusEmulator.IntegrationTests` (3 types) smokes MassTransit against the official
  Azure Service Bus emulator for broker parity.

Neither is in `deploy.needs`, because the gating jobs have no Docker daemon. Both instead run on a
weekday-nightly schedule (`cross-service-tests.yml:31`, cron `0 6 * * 1-5`, jobs `cross-service` at
line 75 and `servicebus-emulator-smoke` at line 153) and their **recency** gates the deploy through
`cross-service-freshness` (`MMCA.ADC/.github/workflows/deploy.yml:815`, `FRESHNESS_DAYS: "5"` at line
825): the deploy fails if the last successful nightly proving **both** tiers is stale
(`deploy.yml:808-814`). The emulator smoke has been **authoritative** rather than advisory since
2026-08-31 (`cross-service-tests.yml:126-135`), and the same comment records the standing rule: if it
goes red, fix it or dispatch a green run, do not re-add `continue-on-error` to unblock a deploy. The
window was widened from 3 to 5 days when the nightly moved to weekdays plus skip-if-unchanged, so a
legitimate weekend or holiday gap does not red the gate (`deploy.yml:823-824`). Both jobs also sit
behind a `should-run` guard (`cross-service-tests.yml:50`) that skips a night with no new commits.
That is the general pattern for a tier too expensive to run per-deploy: gate
on the freshness of the evidence rather than on the run itself. MMCA.Store mirrors the arrangement
with `MMCA.Store.CrossService.IntegrationTests` and `MMCA.Store.ServiceBusEmulator.IntegrationTests`
behind its own `cross-service-freshness` gate (`MMCA.Store/.github/workflows/deploy.yml:716`).

A third nightly job, `apphost-smoke` (`cross-service-tests.yml:199`), boots the real Aspire stack and
asserts its composition. It is **`continue-on-error: true`** (line 204) and, unlike the emulator smoke
above it, the `cross-service-freshness` deploy gate does not look at it at all, so nothing it does can
ever gate a deploy (lines 189-195). The comment says why plainly: it is the widest possible assertion
(it pulls and starts four containers before a single process runs) and its failure modes are still
unproven, so it reds the job for visibility without failing the run, and it should be promoted out of
`continue-on-error` only after it earns a track record, or deleted if it proves to be a flake
generator. That is what an honestly staged new gate looks like.

### MMCA.Common unit-level infrastructure tests

`MMCA.Common.Infrastructure.Tests` (380 types) uses SQLite-backed `EnsureCreated` contexts for
tests that need a real EF pipeline, with `MMCA.Common.Infrastructure.Tests.MigrationsFixture` beside
it as the real migrations assembly those tests point EF at. SQLite avoids the SQL Server dependency
entirely, which is why `MMCA.Common` builds and tests without any SQL Server or Docker in the local
environment. The tradeoff is that SQLite does not support all SQL Server features (row-level locking,
certain index hints), but EF Core's cross-provider abstraction is sufficient for the behaviors being
tested (outbox persistence, repository queries, soft-delete filters). Where the storage FORMAT itself
is the thing under test, SQLite is not enough: `MMCA.Common.Infrastructure.Redis.Tests` exists
precisely because a counter written as a string and read back as a hash round-trips fine against a
mocked `IDistributedCache` and answers WRONGTYPE against a real server, so that one project runs Redis
via Testcontainers, out of the slnx, in its own CI job (`MMCA.Common/.github/workflows/ci.yml:742,777`).

### E2E tests

`MMCA.ADC.E2E.Tests` (84 types) and `MMCA.Common.UI.E2E.Tests` (18 types) require either the
full Aspire stack (`dotnet run --project Source/Hosting/MMCA.ADC.AppHost`) or the Gallery
backend (`MMCA.Common.UI.Gallery`) respectively. The Aspire AppHost starts SQL Server, Redis,
RabbitMQ, MailDev, all four service hosts, the Gateway, and the UI; it cannot be launched
headlessly in a local background shell (it stalls at control-plane init), which is why the browser
tier is a CI concern and an interactive-terminal concern, never a background one. In CI, where Docker
is available, `e2e.yml` brings the stack up with `dotnet run` on the AppHost and the hang does not
occur (`MMCA.ADC/.github/workflows/e2e.yml:4-5`).

That workflow is also where the cold-start hardening lives, and it is worth reading because cold start
is the dominant cause of red E2E runs (`e2e.yml:14-22`). Two steps do the work: a **per-service**
readiness gate that waits until the UI, Identity (the login path) and Conference (the data path) each
return 200 through the Gateway, not just the UI aggregate, so the suite never starts against a
half-warm backend; and a warm-up step that JITs every service's hot path before the timed suite,
including a **real admin login POST** that exercises the Identity DB user lookup, the password hash
and RS256 signing, which a UI-only warm-up never touched. `E2E_TIMEOUT` stays at 45 seconds for the
residual first-navigation latency (line 22). The note beneath them (lines 23-25) is the kind of thing
worth keeping: a red run here is residual cold-start timeouts, not an a11y or product regression, so
do not "fix" it by disabling prerender.

The cross-browser matrix runs the same suite once per engine by varying `E2E_BROWSER`:
`chromium`, `firefox`, `webkit`. Mobile is covered by responsive layout testing (grid to card at a
narrow viewport), not a separate app. [Rubric §22, Responsive & Cross-Browser/Device]: §22
assesses whether the browser support matrix is exercised; the `E2E_BROWSER` env var is the
mechanism.

**Where the engines actually run differs by repo, and the reason is cost.** The Gallery is
backend-less, so MMCA.Common runs all three engines on every PR and all three are required merge
checks. A full Aspire-stack leg costs roughly twenty to twenty-five minutes, so ADC and Store run
**chromium only** on the deploy path (`e2e.yml:8-11`, the reusable-workflow input at `e2e.yml:31-36`)
and lean on the Common matrix for engine coverage. Their firefox and webkit legs stay on a **Mon/Thu**
schedule (`e2e.yml:49-50`), and since 2026-07-29 the two crons are separate entries rather than one
`1,4` expression specifically so the matrix can branch on `github.event.schedule`: **Monday runs
firefox, Thursday runs webkit**, halving the nightly spend from about 100 to about 50 minutes a week
while still exercising each engine every week (lines 44-48). A manual dispatch still gets all three.
Section 7 has the gate wiring.

[Rubric §21, Accessibility]: the `AssertNoAccessibilityViolationsAsync` call in the shipped workflow
bases, in each app's own `AccessibilityTests`, and in `MMCA.Common.UI.E2E.Tests` is the runtime
axe-core gate for WCAG 2.1 AA. Coverage beyond the shared bases is hand-maintained: nothing forces a
new page into `AccessibilityTests`, and today that suite holds 31 scans in ADC
(`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:17`) and 23 in Store
(`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/AccessibilityTests.cs`), against
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
// MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:17-35
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
then crash in production. That is not hypothetical: the base's own reason string records that a
blanket update reintroduced v9 once before while the build stayed green
(`Bases/DependencyVersionTestsBase.cs:32-35`). `DependencyVersionTests` makes it a build-time
failure: the shared rule parses `Directory.Packages.props` directly, not the compiled assembly, so
the failure happens in the `build-and-test` job before any code ships. The sibling fact
(`ImageSharp_MustNotExceed_MajorVersion3`, line 48) guards the same shape of trap: ImageSharp v4's
MSBuild targets fail without a license key, so a blanket bump breaks the build outright
(lines 43-45).

This is the pattern of a fitness function: an executable rule that enforces a policy that cannot be
expressed as a type error. The override points (`MassTransitPackageIds`, `ImageSharpPackageIds`) are
part of the design, because a repo that does not declare a pin must not assert one: the consumers
inherit MassTransit transitively and deliberately do not subclass this base at all.
[Rubric §32, Dependency & Supply-Chain]: this is the highest-signal embodiment
of §32 in the codebase, a deliberate, documented pin with an automated gate.

### Example B, Integration test base usage (`IdentityIntegrationTestBase`)

```csharp
// MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:12-19
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
3. The test calls `AuthenticateAsAttendee(userId)` (line 22) which calls `SetBearerToken(...)`,
   subsequent `Client.GetAsync(...)` / `PostAsync(...)` calls carry the `Bearer` header.
4. `IntegrationTestBase.DisposeAsync()` disposes `Client`.
5. After all tests run, `IdentityIntegrationTestFixture.DisposeAsync()` drops the throwaway
   database.

The test author writes only the business assertion. All boilerplate (token minting, HTTP client,
DB reset, teardown) is in the shared infrastructure. This is exactly why the shared package exists.
[Rubric §14, Testability]: the fixture isolation + shared infrastructure is a direct measure
of the §14 "integration test isolation" criterion.

### Example C, bUnit component test (`ProfileTests`)

```csharp
// MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/Profile/ProfileTests.cs:18-70
public sealed class ProfileTests : BunitTestBase
{
    public ProfileTests()
    {
        // Every Result-returning member needs an explicit setup: an unstubbed Task<Result>
        // hands back null, not a success.
        var users = new Mock<IUserUIService>();
        users
            .Setup(x => x.GetMyAvatarUrlAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(string.Empty));

        Services.AddSingleton(users.Object);
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
}
```

**Almost none of the harness is in this repo.** The repo-local `BunitTestBase`
(`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/BunitTestBase.cs:16`) is three lines: it
inherits `BunitComponentTestBase` from the shipped `MMCA.Common.Testing.UI` package and adds exactly
one thing, `Services.AddDeviceCapabilityDefaults()` (line 18), the framework's device-capability
defaults covering the media picker the profile pages inject (the ADR-042/045 capability abstraction).
Individual tests override it with recording mocks, last registration wins.

Everything the test actually uses comes from the shared base
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:37`):
MudBlazor services, the UI facades, `JSInterop.Mode = JSRuntimeMode.Loose` (so MudBlazor's JS calls
do not throw), `AddAuthorizationCore`, localization, and the **mutable**
`AuthenticationStateProvider` (the `MutableAuthenticationStateProvider` inner class, line 162) that
`ProfilePage` injects directly. `RenderAs<TComponent>(principal, parameters)` (line 130) sets the
provider's principal, then renders the component with a cascading `AuthenticationState` wrapping the
same principal; `RenderUnderTest<TComponent>` (line 124) is the anonymous shortcut. The provider is
mutable rather than a hardcoded-anonymous one precisely so it serves both consumers: components that
read the cascading `AuthenticationState` and pages that call `GetAuthenticationStateAsync()` on the
injected service.

The test constructs `UserWithId` (a principal with a `user_id` claim, line 20) and `UserWithoutId`
(a principal without it, line 23), then asserts the render states: profile actions present
(fact at line 40) and the error state when the claim is missing (fact at line 63). A third fact
(line 52) asserts the fallback avatar carries an accessible name, with a comment naming why
(lines 55-56): MudAvatar renders `role="img"`, and the deploy-gating Profile WCAG scan's
`role-img-alt` rule requires a name even in the no-photo state. That is the two tiers meeting: a
browser-tier a11y failure was cheaper to pin at the component tier. `cut.WaitForAssertion` is bUnit's
polling assertion, retrying until the assertion passes or a timeout elapses, handling Blazor's async
rendering cycle.

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
| Unit + architecture + bUnit, again | none | ADC `backend-test-gate` over `CI.slnf`, push-only, non-UI diffs | **The deploy**, on every backend-only ADC code deploy |
| AI golden replay + prompt contract | none, no API key, no network | ADC `ai-eval-gate`, push-only, every code diff | **The deploy**, on every ADC code deploy |
| AI live judge (paid model calls) | `ANTHROPIC_API_KEY` | ADC `ai-eval-gate`, only when the diff touches the scoring code | The deploy, on a scoring-code deploy |
| Unit + architecture, seed | none, no database | Helpdesk `build-and-test` over `MMCA.Helpdesk.slnx`, against MMCA.Common **source** | Merge, on Helpdesk PRs |
| Runtime conformance, host-free order gates | none | Same job as the unit tier, all four repos | Merge |
| Runtime conformance, Gateway trio | none (Production-pinned boot) | Same job as the unit tier | Merge |
| Topology parity (AppHost vs. Bicep) | none, text parse | ADC `MMCA.ADC.Gateway.Tests`, so the unit tier | Merge, and the deploy through `backend-test-gate` |
| Runtime conformance, HTTP suites | real SQL Server | ADC/Store `integration-tests` over `Integration.slnf` | Merge (PR-only required check), **not** the deploy |
| Testcontainers cross-service / broker | Docker | Nightly `cross-service-tests.yml` | The deploy, indirectly, via `cross-service-freshness` |
| AppHost composition smoke | Docker | Nightly `cross-service-tests.yml`, `continue-on-error` | Nothing, deliberately |
| Browser (gallery) | Playwright, no backend | Common `ui-e2e`, three engines | Merge, all three engines |
| Browser (full stack) | full Aspire stack | ADC/Store `e2e-gate`, chromium only | The deploy, when the change is ui-scoped |
| Browser (full stack), firefox and webkit | full Aspire stack | ADC `e2e.yml` on alternating weekly crons, one engine each | The deploy, indirectly, via `cross-browser-freshness` |
| Benchmarks | none | Common `performance-smoke` | Merge |
| Cross-repo consumer canary | ephemeral SQL Server | Common `consumer-source-build`, building Helpdesk against this PR's framework source | Merge, on MMCA.Common PRs |
| Template generation smoke | none | Helpdesk `template-smoke`, package mode from nuget.org | Merge, on Helpdesk PRs |

### The accessibility gate (ADR-063)

MMCA.Common's `ui-e2e` job (`MMCA.Common/.github/workflows/ci.yml:228`) builds the out-of-slnx
gallery plus E2E project and runs the axe scans across a `chromium, firefox, webkit` matrix
(`ci.yml:236-237`), one engine per leg via `E2E_BROWSER` (`ci.yml:298`), with `fail-fast: false`
(line 235) so each engine reports independently. **All three are required merge checks**, three of
the eight enumerated in `MMCA.Common/CONTRIBUTING.md:60-71` (firefox was promoted 2026-07-12 and
webkit 2026-07-16 after 11 consecutive green main runs, `ci.yml:238-240` and
`CONTRIBUTING.md:63-65`). That file also names the live ruleset as authoritative over its own copy
(`CONTRIBUTING.md:75-77`), which is the right instinct for any list of gates.

The deployed apps gate the deploy instead: ADC's `e2e-gate` (`MMCA.ADC/.github/workflows/deploy.yml:761`)
calls the reusable `e2e.yml` (line 773) with `browsers: '["chromium"]'` (line 775), and the `deploy`
job waits on it (line 1237). Store's is the same shape at `MMCA.Store/.github/workflows/deploy.yml:584,594,945`.

**The deploy gate is ui-scoped and may legitimately skip.** Both apps gate `e2e-gate` on a `ui` change
filter (`MMCA.ADC/.github/workflows/deploy.yml:772`), and the `deploy` job's condition accepts
`success` **or** `skipped` for that need while requiring `success` from every unconditional one
(`deploy.yml:1282`). That asymmetry is deliberate and was learned the hard way: under default
`success()` semantics a legitimately skipped `e2e-gate` cascaded into a skipped deploy, so a
green run shipped nothing (`deploy.yml:1256-1259`).

On ADC the cost of that fix is now bounded rather than open-ended. `backend-test-gate` carries the
exact complementary condition and the same success-or-skipped allowance (`deploy.yml:1283`), so a
skipped `e2e-gate` means a *run* `backend-test-gate` and the invariant "no production deploy without
test execution" holds without making either gate unconditional (`deploy.yml:1261-1268`). What a
backend-only ADC deploy still ships without is a **browser scan**: axe did not run on that commit, and
the post-deploy smoke gate is the backstop for anything the unit tier cannot see. On MMCA.Store, which
has no `backend-test-gate`, the original exposure remains: a backend-only deploy runs no test tier at
all on the push.

MMCA.Helpdesk adopts none of the browser tier: it pins the package version but no project references
it, and the repo has no E2E test project at all, so the seed shows a reader no worked example of
adopting the scan.

### The cross-engine freshness gate (rubric §22)

Moving firefox and webkit off the deploy gate bought about 40 minutes per UI deploy, and it opened a
hole of the same shape the broker tier once had: the nightly `e2e.yml` matrix is `fail-fast: false`
with `continue-on-error` on the non-chromium legs, so those legs could stay red for weeks without
blocking a single deploy. The proof was produced and then discarded
(`MMCA.ADC/.github/workflows/deploy.yml:982-1003`). `cross-browser-freshness` (`deploy.yml:1004`)
closes it the way `cross-service-freshness` closes the broker one: it does not run the engines, it
refuses to deploy unless a recent run passed on **each** of them.

- **Push-only** (`deploy.yml:1007`), like every other freshness gate: a PR is not a rollout.
- **A 10-day window** (`deploy.yml:1013`). The two engines alternate on separate weekly crons
  (Monday firefox, Thursday webkit), so the window is a 7-day cadence plus slack for a skipped
  night (the nightly's should-run guard skips a night with no new commits) and for a manual re-run
  landing late.
- **The check is per job, not per run.** It walks completed `e2e.yml` runs newest first and takes
  the first one in which the job named `E2E (<engine>)` itself concluded `success`, regardless of
  the run's conclusion. The run conclusion is unusable in both directions: `continue-on-error` means
  an engine's red need not red the run, another job's red can red a run in which this engine passed,
  and the should-run guard can conclude a run `success` with every leg skipped. Each engine is
  resolved independently, because their proofs normally come from two different runs, and the older
  of the two decides the gate (failure messages at `deploy.yml:1070-1072`).
- **Break-glass is loud, not silent.** A `workflow_dispatch` skip requires a justification; without
  one the step fails rather than waving the deploy through, and with one it writes a warning and a
  step-summary block naming what was not verified. The skip path exits `success` inside the step,
  which is why `deploy`'s condition can demand `success` from this need unconditionally
  (`deploy.yml:1279`).

[Rubric §22, Responsive & Cross-Browser]: §22 assesses whether the app is verified on more than one
rendering engine; this gate is what makes the nightly cross-engine matrix *enforced* coverage rather
than a report nobody reads, without putting two more browser legs on the per-deploy critical path.

### The AI scoring evaluation gate (TD-22)

The AI session scorer is the one place in this repo where behavior can change with **no code
change**: a prompt edit, a model deprecation or a provider-side contract change all move the numbers
an organizer uses to accept or decline talks, and every unit test in `CI.slnf` stays green through
all three (`MMCA.ADC/.github/workflows/deploy.yml:440-446`). `ai-eval-gate` (`deploy.yml:461`) is the
behavioral check, and it is split into two tiers by cost.

**Tier 1, golden replay plus prompt contract, always.** The step runs the evaluation project with
`--filter-not-trait "Category=AiEval.Live"` and a `--minimum-expected-tests 1` floor
(`deploy.yml:486-493`). No API key and no network: seven recorded proposals in
`Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests/Golden/` are replayed through
the **real** `AnthropicScoringService` against a handler that answers with the response recorded for
that case. `GoldenCase` keeps that response as a raw `JsonElement` so the handler returns exactly the
bytes that were recorded rather than a re-serialization of a parsed shape
(`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests/GoldenCase.cs:11`).
`GoldenReplayTests` (`GoldenReplayTests.cs:25`) pins both directions at once: the replay handler
asserts what goes **out** (the delimited envelope and the untrusted-input brief are on the wire for
every case, including the no-speakers one and the injection attempt) and the theory asserts what
comes **back** still parses, still succeeds and still produces the same weighted overall inside the
band the case declares (`GoldenReplayTests.cs:47-49`). Its handler captures assertion failures rather
than throwing them, because an exception raised inside the handler would be swallowed by the
service's never-throws contract and re-reported as a generic scoring failure, hiding what actually
broke (`GoldenReplayTests.cs:155-161`). A second fact guards the corpus itself: at least six unique
cases, and `injection-attempt` and `no-speakers` must both still be present, because a corpus that
quietly shrank to one happy path would keep the theory green while measuring nothing
(`GoldenReplayTests.cs:85-94`).

`PromptContractTests` (`PromptContractTests.cs:29`) is the versioning half. It renders the prompt for
one canonical proposal fixed in the test file rather than read from the corpus (so editing a golden
case cannot change what the hash covers), hashes it, and requires the hash recorded for the current
`PromptVersion` in `Golden/prompt-versions.json` to match (`PromptContractTests.cs:47`). Both failure
modes are real and both fail loudly: a prompt edit without a version bump breaks the hash, and a
version bump without a recorded hash breaks the key lookup, each with the fix spelled out in the
assertion message. Two smaller facts pin the version string as a dated `yyyy-MM-dd.N` contract that
fits the `nvarchar(32)` column it is persisted into (`PromptContractTests.cs:68`) and pin both halves
of the assembled prompt: the reviewer brief, the anti-injection `UntrustedInputBrief` paragraph, the
`<session_proposal>` envelope, and the rule that an absent tagline is omitted rather than emitted
empty (`PromptContractTests.cs:78`).

**Tier 2, the live judge, only when the scoring code changed.** `LiveJudgeTests`
(`LiveJudgeTests.cs:27`) carries `[Trait("Category", "AiEval.Live")]` (line 52) and makes real paid
Anthropic calls for each golden proposal, asserting the overall lands in the case's band. The deploy
runs it only when `needs.changes.outputs.scoring == 'true'` (`deploy.yml:495-504`), and that filter
is deliberately **narrow**: unlike `code` and `ui` it does not fail safe to true on an unrecognized
path, because a false positive here spends money on every unrelated deploy while the key-free tier
already runs unconditionally (`deploy.yml:147-151`, the three matched paths at `deploy.yml:153-155`).
The whole-diff fail-safe still applies one level up: when the push range cannot be determined the
classifier sets `scoring=true` along with everything else (`deploy.yml:91-94`, `deploy.yml:106-109`).
Without `ANTHROPIC_API_KEY` each case calls `Assert.Skip` (`LiveJudgeTests.cs:62`), reported as
skipped and never as passed, which is why that step alone carries no `--minimum-expected-tests`
floor.

Two choices are worth naming. The gate runs on `code == 'true'` (`deploy.yml:463`), the same
condition as the `CI.slnf` tiers rather than the ui/backend split, because the replay tier is cheap
and its whole point is catching what the other two gates cannot see; and the live bands are wide on
purpose, because a judge model is not deterministic and a flaky gate gets ignored
(`deploy.yml:452-456`).
[Rubric §14, Testability & Test Strategy]: §14 assesses whether the suite meaningfully covers the
system's real behavior; a deterministic replay of recorded provider responses is how a
non-deterministic dependency becomes testable at all, and the corpus-shape fact is how the tier
avoids the vacuous-pass failure mode every golden suite has.
[Rubric §11, Security]: §11 assesses how the security model is validated; the injection-attempt case
and the `UntrustedInputBrief` assertion mean the prompt-injection defence is pinned by a test that
fails when the paragraph stops being emitted, not by a comment.

### The performance-regression gate (ADR-060)

Rubric §12 asks for hot-path efficiency that is measured, not assumed. The design problem is the
runner: CI runs on shared GitHub-hosted Ubuntu, where wall-clock timings move run to run by more than
most regressions worth catching, so an absolute latency assertion is either tight enough to red on a
noisy neighbour or loose enough never to fire
([ADR-060](https://ivanball.github.io/docs/adr/060-performance-regression-gate.html)). The answer
splits the baseline by measurement stability.

- **A dedicated job measures, then verifies.** `performance-smoke` (`MMCA.Common/.github/workflows/ci.yml:332`),
  named "Performance gate (BenchmarkDotNet Short + baseline verify)" (`ci.yml:333`), runs the
  suite with `--filter "*" --job Short --exporters json` (`ci.yml:362`) and then runs `build/perfgate`
  over the exported artifacts (`ci.yml:371`). `--job Short` is 3 warmup plus 3 iterations, chosen to
  produce real measurements inside a bounded budget; `--filter "*"` is required because
  BenchmarkDotNet otherwise prompts for a selection and would hang the runner (`ci.yml:359-361`).
- **The baseline is a committed JSON file**, `Tests/Performance/perf-baseline.json` (`ci.yml:371`),
  not a stored previous run. A gate comparing against the previous run ratchets silently: every PR is
  only slightly worse than the last, and the sum is invisible. A committed number is a line a reviewer
  questions in the same PR as the code that spends it.
- **Allocations are gated absolutely**, because bytes per operation do not depend on how busy the
  runner is.
- **Latency is gated only as a ratio between two benchmarks in the same run.** Both run in the same
  process, on the same machine, under the same noise, so the machine cancels out of the quotient. The
  committed floor asks "does the cache still exist", which survives a noisy measurement, rather than
  "is the cache exactly this fast", which does not. **No absolute latency threshold exists anywhere in
  the gate.**
- **A missing measurement fails, it does not pass.** Every benchmark named by a rule must be present
  in the results or the verifier reports that the gate would be vacuous and fails. Zero exported
  artifacts is a failure rather than an empty pass, and a benchmark reporting no allocation data fails
  with an instruction to keep `[MemoryDiagnoser]` on the suite. Vacuity is the failure mode a
  benchmark gate actually has: a renamed method or a filter selecting nothing would leave a gate that
  passes while measuring nothing, which is worse than no gate because it reads as evidence
  (`ci.yml:326-331`).

The job is a **required merge gate**, not advisory: it is the eighth of the eight contexts listed in
`MMCA.Common/CONTRIBUTING.md:68-71`, which also names raising a ceiling to silence a red gate as
defeating it. That last part is enforced by review, not by the tool.

**This gate is MMCA.Common only.** The harness, the baseline and the verifier exist in that repo and
nowhere else. ADC and Store have no benchmark suite and no perfgate; their performance artifact is a
periodic k6 load test against deployed read endpoints whose recency is gated by `load-freshness`
(`MMCA.ADC/.github/workflows/deploy.yml:756`), not a pull-request gate. Helpdesk has neither.
Consumers inherit the framework's bounded hot paths through the released packages, not the gate over
their own code.

### The two cross-repo gates, and MMCA.Helpdesk's own CI

Two gates run a *different repo's* code than the one being changed, and both exist because a green
build in one repo has repeatedly proved nothing about the other.

**MMCA.Common's consumer canary** (`consumer-source-build`,
`MMCA.Common/.github/workflows/ci.yml:446`) checks MMCA.Helpdesk out as a sibling and builds it
against **this PR's** framework source, so a breaking public-API change reds here rather than after a
release plus a lockstep sweep (`ci.yml:435-445`). Helpdesk is the right canary precisely because it is
minimal: no database and no GitHub Packages token, and its committed `local.props` already swaps the
`MMCA.Common.*` package references for project references into `../MMCA.Common/Source`. The job also
proves the framework's **migration** path end to end, applying the consumer's real EF migrations to an
ephemeral SQL Server (`ci.yml:443-445`), and it runs the seed's suite with a floor of `40`
(`ci.yml:536`). It was promoted to a required merge gate on 2026-07-16 after nine consecutive green
runs (`ci.yml:441-442`).

**MMCA.Helpdesk's own `ci.yml`** is the other half of that pair, and it is deliberately small. It runs
on pull requests and pushes to `main` (`MMCA.Helpdesk/.github/workflows/ci.yml:3-7`) with one
`build-and-test` job (line 14) that checks MMCA.Common out as a source companion (line 39) and runs
the whole seed solution with no database:
`dotnet test --solution MMCA.Helpdesk.slnx -c Release --no-build --minimum-expected-tests 1`
(line 60). The header comment states the boundary the seed keeps (lines 9-12): domain plus
architecture run headless here, and the Aspire round-trip is not run at all.

The step worth reading is **"Resolve MMCA.Common ref (same-name branch, else main)"** (line 28). Both
repos gate on the other's `main`, so a breaking framework change and its consumer adaptation would
deadlock each other: neither PR can go green alone. The convention resolves it without a bypass. Name
the adaptation branch here identically to the framework branch, and this step builds against that
branch instead of `main` (lines 24-27, resolution at lines 31-37). No match means `main`, so the
normal case costs nothing.

A second job, `template-smoke` (line 76), is not redundant with the first, and the comment above it
says why in two numbered points (lines 62-75). This repo **is** the source of the `MMCA.Templates`
`dotnet new` pack, so there is no second copy to drift; `build-and-test` builds in **local-source**
mode against MMCA.Common's `main`, while a generated app builds in **package** mode against a
released version from nuget.org, and a source-mode build can pass where a package-mode Release build
fails on an analyzer. The job therefore checks out no MMCA.Common at all (lines 86-87), which is
exactly the credential-free public install path being proven, and runs `build/templates/smoke.ps1`
(line 89). That script packs the template, installs it, generates three deliberately different apps
and restores, builds and tests each, then sweeps the generated tree for residual `Helpdesk` / `Ticket`
tokens, because `sourceName` and the symbol replacements run as separate passes and a token nested
inside another (`Ticket` inside `Tickets`) is where a rename silently half-applies
(`MMCA.Helpdesk/build/templates/smoke.ps1:13`, case rationale at lines 77-101).
[Rubric §33, Developer Experience & Inner Loop]: §33 assesses the friction of adopting and working in
the codebase; a template that generates an app which does not build is the highest-friction failure
this workspace can ship, and this is the gate that catches it.

### Coverage floors

Coverage is enforced as a floor, not reported as a number, and every floor is scoped so it measures
the code it claims to measure.

- **MMCA.Common:** the `coverage` job merges the tiers with ReportGenerator and fails if the **unit
  tier drops below 68.3% line coverage** (`MMCA.Common/.github/workflows/ci.yml:433`). It gates the
  unit tier rather than the merged report because the gallery E2E tier dilutes it, and it excludes
  generated code (`*.generated.cs` / `*.g.cs`) because source generators emit large uncovered files
  that otherwise tank the number: 45.3% raw versus 61.9% hand-written on the run that prompted the
  filter (`ci.yml:416-421`, assembly and file filters applied at `ci.yml:430`). It runs only when
  `build-and-test` succeeded, so an upstream failure does
  not add a confusing secondary coverage failure (`ci.yml:425`).
- **MMCA.ADC:** two floors run inside `build-and-test`, both PR-only. The global unit-tier floor sits
  at **55.5%** (`MMCA.ADC/.github/workflows/deploy.yml:319`), measured over **ADC's own code only**.
  The comment above it (`deploy.yml:298-311`) is the part worth reading: the raw cobertura also
  instruments the consumed framework assemblies (tested in their own repo, near 0% here), plus the
  service hosts and the protobuf-dominated contracts assemblies, and leaving them in deflated the
  number to something that measured nothing (26.8% raw, then 52.8% versus 62.5% filtered after the
  service-host assemblies appeared). The assembly filter is what makes the floor mean what it says,
  and it is one line: `+MMCA.ADC.*;-*.Tests;-MMCA.ADC.*.Service;-MMCA.ADC.*.Contracts`
  (`deploy.yml:317`). A second, tighter floor gates **Application-layer branch coverage at 77.5%**
  (`deploy.yml:351`) over `+MMCA.ADC.*.Application` only (`deploy.yml:342`), because the repo-wide
  average is dominated by UI, Infrastructure and generated code, and because the business decisions
  it wants to measure are branches rather than lines (`deploy.yml:325-336`). It carries its own
  anti-vacuity guard: if the filtered report covers fewer than four assemblies (Conference,
  Engagement, Identity, Notification) the step fails outright, on the grounds that a filter matching
  nothing would make the floor pass vacuously (`deploy.yml:344-348`).
- **MMCA.Store:** the equivalent unit-tier floor sits at **51.6%**
  (`MMCA.Store/.github/workflows/deploy.yml:255`).
- **MMCA.Helpdesk has no coverage floor at all**, and that is consistent with what it is. The seed's
  job is to be readable and adoptable, so its CI asserts that the suite builds and runs
  (`MMCA.Helpdesk/.github/workflows/ci.yml:60`) rather than holding a percentage a reader would have
  to maintain while learning the framework.

[Rubric §17, DevOps & Deployment]: the whole table above is §17's subject. A tier that runs and
blocks nothing is documentation; a tier that blocks something is a gate. The two most instructive
entries are the two ends of that spectrum in the same nightly workflow: `cross-service` blocks the
deploy through a freshness gate, and `apphost-smoke` deliberately blocks nothing until it earns the
right to.

---

## Quick reference: rubric categories touched in this chapter

| Category | Where explained |
|---|---|
| §3 Clean Architecture (enforced) | §4 LayerDependencyTests, DomainPurityTests |
| §4 Domain-Driven Design | §4 AggregateConventionTests factory-method rules |
| §9 API Design & Contracts | §3 the ADR-058 ProblemDetails, OpenAPI and versioning bases |
| §11 Security (test RS256 keypair) | §3 JwtTokenGenerator design note; §3 SecurityHeadersTestsBase and MmcaGatewayHardeningTestsBase; §7 the prompt-contract test that pins the anti-injection brief |
| §12 Performance & Efficiency | §7 the ADR-060 benchmark baseline gate |
| §13 Observability & Operability | §4 ObservabilityConventionTests alert-to-runbook pairing, and AppHostBicepParityTests turning an unresolvable service name into a build failure |
| §14 Testability & Test Strategy | §1 CI filter rationale, §2 project layout, §5 integration strategy, §7 the AI scoring evaluation gate and the coverage floors |
| §17 DevOps & Deployment | §1 two-filter CI rationale and the complementary deploy gates, §4 the AppHost/Bicep topology parity gate, §7 the tier-to-gate map |
| §21 Accessibility (a11y) | §3 AxeOptions and AssertNoAccessibilityViolationsAsync, §5 E2E strategy, §7 the ADR-063 gate |
| §22 Responsive & Cross-Browser | §3 PlaywrightFixture engine selection, §5 the alternating-engine nightly |
| §28 Front-End Testing & Quality | §2 UI/E2E project layout, §3 Testing.E2E and Testing.UI packages, §6 bUnit example |
| §29 Resilience | §3 GracefulShutdownTestsBase |
| §30 Compliance, Privacy & Data Governance | §4 PiiConventionTests + PiiErasureContractFitnessTests, DataResidencyTests |
| §32 Dependency & Supply-Chain | §4 DependencyVersionTests, §6 Example A |
| §33 Developer Experience & Inner Loop | §1 MTP filter syntax, self-hosted test binaries; §7 the consumer canary, the same-name-branch convention that keeps it from deadlocking, and the template generation smoke |
| §34 Architecture Governance & Documentation | §4 overall fitness-function framing |

---

## Cross-links

- Primer: [`00-primer.md#5-the-solution--test-layout`](00-primer.md#5-the-solution--test-layout)
 , solution files, MTP runner, slnx-excluded UI projects
- Primer: [`00-primer.md#architecture-enforcement-is-doubled-fitness-functions`](00-primer.md#architecture-enforcement-is-doubled-fitness-functions)
 , compile-time + runtime double enforcement explained
- Devops/CI chapter: `devops-cicd.md`, CI job definitions, the `integration-tests` job that uses
  `MMCA.ADC.Integration.slnf`, the `ui-e2e` job that builds the Gallery + E2E tests by csproj path,
  and the deploy-side jobs (`foundation`, `build-images`, the smoke gate and rollback) that this
  chapter only names as the backstop behind the test tiers
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
