# The test pyramid, not the ice-cream cone: 2,254 fast tests, zero Docker

> Series: MMCA.Common · Article #35 (deep-dive) · Pillar P4 · Group G26 · Rubric §14 ·
> Status: grounded in `MMCA.Common/CLAUDE.md` (Testing and Build & Test Commands sections),
> `Website/docs-src/governance/common-ArchitectureScorecard.md` (§14, §28),
> `Website/docs-src/adr/058-runtime-conformance-suites-as-a-package.md`,
> `Website/docs-src/adr/063-accessibility-conformance-gate.md`,
> `Website/docs-src/adr/117-apphost-integration-test-base.md`, and
> `Website/docs-src/onboarding/group-28-testing-infrastructure.md`. No em dashes.

**Subtitle:** A suite you run constantly is worth more than a suite you run nervously. Here is how
MMCA.Common keeps 2,254 tests fast enough to live in the inner loop, with real-database
integration coverage and no Docker in sight.

---

There is a failure mode that almost every long-lived codebase drifts into, and it has a name: the
ice-cream cone. The pyramid is inverted. A thin layer of unit tests sits at the bottom, and the bulk of
the verification is a fat layer of slow, flaky, Docker-dependent end-to-end tests at the top. The suite
takes twenty minutes, fails intermittently for reasons nobody can reproduce, and developers stop running
it locally because the inner loop is too painful. The tests that were supposed to give you confidence
instead give you a reason to avoid them.

MMCA.Common deliberately builds the right shape. **About 2,254 `[Fact]`/`[Theory]`, weighted to Core,**
form a correct, non-inverted pyramid, with a wide base that runs in milliseconds and needs no database
and no Docker. That number, and the architecture behind it, is the single most-cited evidence in the
framework's testability score: category 14 stands at **maturity 4 / implementation 9**, carried by
the enforced coverage floor and the size of the suite behind it.

## Why the shape matters more than the count

The test-count number is not the point. The shape is. The rubric (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`,
category 14) describes a healthy pyramid as "many fast unit tests on domain and application, fewer
integration, few E2E," and names the inverted pyramid, "mostly slow E2E, flaky tests, tests disabled
without tracking," as the headline red flag.

The reason is the inner loop. A wide base of fast tests is one you run after every change, which means
defects surface in seconds, while you still have the context to fix them. A top-heavy suite is one you
run at the end, in CI, after you have moved on, which means defects surface as a red build an hour later
with no context. Speed is not a vanity metric. It is what determines whether the tests are part of how
you write code or a tax you pay at the end.

## The base: fast, pure, no infrastructure

The wide base of the MMCA.Common pyramid is pure unit tests with no I/O
(`Website/docs-src/onboarding/group-28-testing-infrastructure.md`): domain entity factories and invariants, value
objects, the `Result`/`Error` primitives, CQRS handlers with mocked repositories, FluentValidation
validators, and DTO and request mappers. These dominate the type count and run in-memory in
milliseconds. The whole reason this layer can be wide is the framework's design: Clean Architecture
keeps the Domain framework-pure and the Application layer testable without infrastructure, so the
logic worth testing is reachable without booting a host or touching a database.

Two design choices keep this layer honest. First, time is injected: tests use `FakeTimeProvider` rather
than `DateTime.Now`, so time-dependent logic (audit stamping, outbox eligibility delays) is
deterministic instead of flaky. Second, there is no shared mutable infrastructure to coordinate, so the
tests are isolated and parallelizable by construction.

## The middle: real SQLite, two real databases, still no Docker

Above the base sit the persistence and EF-configuration tests, and this is where the "no Docker" claim
gets interesting. Rather than mock the ORM (which proves nothing about whether your EF model actually
builds) or spin up a SQL Server container (which is slow and adds a runtime dependency to the inner
loop), the framework exercises a **real EF Core stack against embedded SQLite.** That means real model
building: entity configurations, the outbox, repositories, and the multi-data-source resolver are
verified against a real database engine, just a fast embedded one.

The standout here is `MultiSourceSqliteIntegrationTests`, which validates the database-per-service
routing over **two real SQLite databases**, a throwaway GUID-named file per logical source under the
temp directory. It proves the framework's hardest data-architecture claims against actual databases
rather than a stub: entity routing through the unit of work, per-source outbox capture, the collapse of
two logical source names sharing one connection onto a single context, and cross-source navigation
population through `NavigationLoader`. The Data Architecture category, whose evidence list names the same
cross-source degrade convention, scores maturity 4 in the evaluation, and this tier does it all without a
container.

Above that tier, integration tests boot a whole service host through `WebApplicationFactory<Program>`
and hit it over HTTP with a real, resettable database. This is also where the framework's
**ship-the-test-base-as-a-package** decision pays off, which I will come back to.

## The cap, and an orthogonal tier

At the top of the pyramid are the component tests (bUnit, rendering Blazor components in isolation) and
the end-to-end tests (Playwright, driving a real browser). These are deliberately the *thinnest* layer,
the few broad journeys that justify their cost.

Sitting *outside* the pyramid entirely is a fourth, orthogonal tier: the architecture-fitness tests.
They assert structural rules over compiled assemblies (the layer-dependency, domain-purity, and
microservice-extraction rules) and need neither a database nor a browser. They are the cheapest,
fastest tier of all, pure reflection, and they catch a class of regression that no functional test
would.

## Shipped test packages: consumers do not re-invent the harness

Five of the framework's nineteen published NuGet packages are test *infrastructure*, not test code, and this is
how the pyramid stays consistent across three codebases instead of being rebuilt three times:

- `MMCA.Common.Testing`, the integration base: `IntegrationTestBase<TFixture>` supplies a configured
  `HttpClient`, bearer-token management, typed `GetAsync<T>`/`PostAsync<T>`/`PutAsync<T>`/`DeleteAsync`
  helpers, per-test database reset, and a thread-safe ID counter. `JwtTokenGenerator` signs RS256 tokens
  with an embedded dev keypair so tests exercise the same JWKS validation path production runs.
- `MMCA.Common.Testing.E2E`, the Playwright base: browser fixtures, Blazor-aware navigation helpers that
  handle the InteractiveAuto hydration race, Identity page objects, and abstract workflow bases for the
  Login, Register, Profile, Logout, password-reset and authorization journeys, four of which close with
  an axe-core WCAG 2.1 AA assertion.
- `MMCA.Common.Testing.UI`, the bUnit base: `BunitComponentTestBase` registers MudBlazor's services,
  configures loose JSInterop, and wires real auth doubles so component tests resolve `<AuthorizeView>`
  cascades.
- `MMCA.Common.Testing.Aspire`, the AppHost base: `AppHostFixtureBase` boots a real AppHost once per
  test collection and waits on each resource's own readiness signal, while `AppHostTestBase<TFixture>`
  hands a test a client bound to a named resource plus typed health, readiness and JWKS assertions.
- `MMCA.Common.Testing.Architecture`, the fitness-rule library: the architecture rules defined once and
  consumed by each repo's thin test suite.

```csharp
// A downstream integration test: a few lines of fixture glue, then real HTTP calls.
public sealed class CatalogTests : IntegrationTestBase<CatalogFixture>
{
    public CatalogTests(CatalogFixture fixture) : base(fixture) { }

    [Fact]
    public async Task Get_returns_seeded_product()
    {
        var product = await GetAsync<ProductDto>("/api/products/1");
        product.Name.Should().Be("Widget");
    }
    // HttpClient, auth token, typed helpers, and per-test DB reset all come from the base.
}
```

The rubric calls this out explicitly under category 14: "Shared test infrastructure (page objects,
fixtures, base classes) reused across consumers, not duplicated." ADC and Store write integration tests
with a few lines of fixture glue instead of re-deriving the HTTP, auth, and reset plumbing. One base
evolves, all consumers inherit the fix.

That first package carries more than an integration base, though. `MMCA.Common.Testing` also ships the
framework's **runtime conformance suites** (ADR-058): seven abstract contract bases, one per runtime
contract, that a consuming host subclasses to prove it wired the framework correctly.

- `ProblemDetailsContractTestsBase<TFixture>` asserts both error-shaping paths, ASP.NET Core model
  validation (400, `application/problem+json` carrying `type`, `traceId`, and `errors`) and the
  framework's `HandleFailure` Result mapping (404), against one shared
  `AssertProblemDetailsShapeAsync` check.
- `OpenApiContractTestsBase<TFixture>` asserts the served `/openapi/v1.json` is OpenAPI 3.x and still
  describes every public resource the host pinned.
- `ServiceInfoVersioningContractTestsBase<TFixture>` drives `/ServiceInfo` at `api-version: 1.0` and
  then `2.0` and checks the deprecated and supported reporting headers.
- `SecurityHeadersTestsBase` probes `/alive` and pins six response headers, including
  `Content-Security-Policy: frame-ancestors 'none'` and an HSTS `max-age`.
- `GracefulShutdownTestsBase<TEntryPoint>` calls a real `IHost.StopAsync` under a bounded token and
  asserts `ApplicationStopping` then `ApplicationStopped` fired.
- `MmcaGatewayHardeningTestsBase<TEntryPoint>` drives a booted gateway through eight edge gates: the
  per-client-IP rate limiter and its bypass list, the tighter named policy on the credential route, a
  correlation id generated when the caller supplies none and echoed when it does, one readiness check
  per downstream service, an active health probe on every cluster, and partitioning by the forwarded
  client IP rather than the proxy IP.
- `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>` resolves the
  decorated handler out of a built provider and walks the constructed object graph, asserting the
  documented nesting order.

This is the boundary against the architecture-fitness tier from the section above. Those rules assert
structure and registration, and their ADR draws that line itself in its trade-offs: "The tests assert
**structure / registration**, not runtime behavior." Fitness functions check shape. These check
behavior, and nothing here is inferred from a registration list. Service hosts boot through
`SqlServerIntegrationTestFixtureBase<TEntryPoint>`, which creates a GUID-named throwaway SQL Server
database, lets the host's own migrate-on-start strategy apply the schema, resets data between tests
with Respawn, and drops the database on disposal. Database-free hosts (the two YARP gateways) boot
through `ProductionHostApplicationFactory<TEntryPoint>`, which pins `UseEnvironment("Production")` so
the production-only branches (restrictive CORS, HSTS emission) are the ones actually under test, and
captures the started `IHost`, because `StopAsync` is not reachable through the `WebApplicationFactory`
surface at all.

The cost of adopting one stays small, which is the point of writing the body once: a subclass supplies
two probe requests, or a path-count floor plus a pinned resource list, or a client factory, and the two
gateway shutdown subclasses are single-line declarations with no body. There are no committed snapshots
either. The OpenAPI guard asserts against the live document rather than a checked-in file, so a new
controller can never leave a stale snapshot behind.

Adoption is partial, and that is worth reporting as an inventory rather than a clean sweep. The OpenAPI
guard and the problem-details guard both run on every extracted REST host: four ADC services and three
Store services. Versioning is subclassed once per repo (ADC Conference and Store Catalog), enough to keep
the machinery exercised and no more; Article 44 takes that one apart in detail. Security headers run on
four hosts, the two Gateways plus both web heads, while graceful shutdown stays **on the two Gateways
only**, so no service host asserts that contract. And MMCA.Helpdesk, the minimal reference app, takes the
two bases that need no booted service: it subclasses `DecoratorPipelineOrderTestsBase` and the
`MiddlewarePipelineOrderTestsBase` that ships beside the conformance suites, and leaves the HTTP contracts
to the two larger apps. Shipping a base is not the same as gating a host, and the inventory, not the
package list, is the honest answer to "is this contract actually guarded here."

## The AppHost tier: a compiled claim about the composition

There is one file the tiers above never execute: the AppHost. It is the only place that states how a
whole stack fits together, which project resources exist, which database each one owns, which broker they
share, where JWKS discovery points, and the `WaitFor` graph that orders the startup. A solution build
type-checks that file and never runs it, so a resource renamed on one side of a `WithReference` still
compiles. The in-process integration tier boots hosts directly through `WebApplicationFactory`, which is
the point of that tier and also means it never sees the orchestration. The E2E tier runs against a
deployed environment, by which time a composition mistake is an incident rather than a test failure.
ADR-117 closes that gap as a package rather than a per-repo copy, and both consumer smoke tiers subclass
it.

`AppHostFixtureBase` is a collection fixture: it boots the real AppHost once through an
`IDistributedApplicationTestingBuilder`, starts it, waits for the resources to report ready, and hands the
running `DistributedApplication` to every test in the collection. The wait is the design point. "The
application started" only means the orchestrator launched the processes, so the fixture awaits each
resource's own health signal instead: resources that carry a health check are awaited healthy, resources
that carry none can only be awaited Running, and the fixture says which happened rather than pretending
the two are the same. Teardown stops and disposes the application and restores every environment variable
the fixture pushed, so one collection cannot leak key material into the next.

A missing precondition is a skip, not a failure, and that is what keeps the tier honest on a laptop.
`AppHostEnvironmentGate` reads the opt-in variable `MMCA_APPHOST_TESTS` and the default requirement is
that variable plus a container runtime, so the tier is off unless you ask for it; when something is
missing, `SkipReason` carries a sentence a human can act on and nothing is started. The fixture also mints
an ephemeral RS256 keypair into `E2E_JWT_*` when the environment has none, because an Identity resource
without key material answers every request including its liveness probe with a 500, never turns healthy,
and takes every `WaitFor` edge behind it down with it. That failure mode is in the record because it cost
an eight-day red nightly to diagnose.

`AppHostTestBase<TFixture>` then gives a test the two things only a running stack can hand it, an
`HttpClient` bound to a named resource and a resolved connection string, plus typed assertions over the
wiring contracts: `AssertHealthyAsync`, `AssertAliveAsync`, `AssertReadyAsync`, `AssertJwksAsync` and
`AssertH2cAsync`. The probe paths are constants (`/health`, `/alive`, `/health/ready`,
`/.well-known/jwks.json`) mirrored from the framework's own, with a unit test cross-asserting each pair so
a rename cannot silently orphan a probe. One rule is written into the constant's own documentation: a
startup gate probes liveness, never readiness, because a readiness endpoint aggregates downstream checks
and gating startup on it can deadlock the dependency graph.

```csharp
// Illustrative: the consumer names the AppHost, the base owns boot, readiness, skip, and teardown.
public sealed class MyAppHostFixture : AppHostFixtureBase<Projects.MyApp_AppHost>
{
    protected override AppHostEnvironmentRequirement RequiredEnvironment =>
        AppHostEnvironmentRequirement.OptIn | AppHostEnvironmentRequirement.Docker;
}

public sealed class StackSmokeTests(MyAppHostFixture fixture) : AppHostTestBase<MyAppHostFixture>(fixture)
{
    [Fact]
    public async Task Identity_publishes_its_key_set()
    {
        Assert.SkipWhen(!Fixture.IsAvailable, Fixture.SkipReason!);
        await AssertJwksAsync("identity");
    }
}
```

## Accessibility as a shipped test contract

The E2E package carries one more contract, and it is the tier where a published standard turns into a
build failure instead of a review comment. ADR-063 records it: WCAG 2.1 AA ships as a named constant in
`MMCA.Common.Testing.E2E` rather than as a setting each repo retypes.

`AxeOptions.Wcag21Aa` pins every axe scan to exactly four tags, `wcag2a`, `wcag2aa`, `wcag21a`, and
`wcag21aa`: levels A and AA across WCAG 2.0 and 2.1. What is left out is the load-bearing part. axe's
"best-practice" rules are deliberately outside the target, and that exclusion is what makes the check
blockable rather than advisory. Best-practice findings are opinions, A and AA findings are a standard,
and a gate that can go red on an opinion gets demoted to a suggestion within a month.

A violation is a thrown failure, not a report. `AssertNoAccessibilityViolationsAsync` runs axe and
throws `AccessibilityViolationException` carrying each rule's impact, id, help text, and the offending
markup compacted to one line per node, so a red gate points at the element. The package's Identity
workflow bases call it themselves: `UserLoginTestsBase`, `UserRegistrationTestsBase`,
`ProfileManagementTestsBase`, and `PasswordResetTestsBase` each end their journey by asserting against
`AxeOptions.Wcag21Aa`, so an app that subclasses them inherits the scan without writing one. For its own
pages a consumer picks between two helpers on `E2ETestBase`, and the pick is the declaration of which rule
set applies: `ScanAsync` waits for any loading bar to clear and asserts the strict options, `ScanGridAsync`
waits for a seeded data row and asserts with the one recorded exception.

There is exactly one exception, and it exists as a second option value rather than a suppression flag.
`Wcag21AaExceptMudPagerCombobox` carries the same four tags and disables a single rule,
`aria-input-field-name`, for pages whose only combobox is MudBlazor's own `MudTablePager` "rows per
page" select, which gets no accessible name and exposes no `Label` parameter to fix it from app markup.
Every other WCAG 2.1 AA rule still runs on those pages. One named, scoped, recorded exception is the
honest shape here: the caller has to say which contract it is scanning under, and the cost is written
down rather than buried, because the rule is off for the whole page scan and not just for the pager
node.

Enforcement then differs per repo, and precision matters more than a slogan. MMCA.Common scans its own
backend-less gallery across chromium, firefox, and webkit, and all three are required merge checks. ADC
and Store run a chromium-only leg against the full Aspire stack as a deploy gate, and that gate is
scoped to UI changes, so a backend-only or infra-only deploy legitimately skips it: "deployed" does not
always mean "axe ran on this commit". MMCA.Helpdesk adopts none of it. It pins the package version,
references it from no project, and has no E2E test project at all, so the seed demonstrates the layers
and not this contract.

## Runner and gate: xUnit v3, MTP, and a coverage floor

A detail that trips up people coming from older .NET projects: the suite runs on the **Microsoft Testing
Platform (MTP), not VSTest**, configured in `global.json`, with **xUnit v3**, AwesomeAssertions, and
Moq. To run one class or method you target the project and pass an MTP filter after `--`
(`-- --filter-class "*FooTests*"` or `-- --filter-method "*Pattern*"`). One sharp edge worth knowing: every test
project must contain at least one test or MTP exits with code 8, so the unit run floors at
`--minimum-expected-tests 2000` (the suite is about 2,254): a discovery or filter regression that
silently drops thousands of tests fails the job instead of passing green with a handful discovered.

And the suite is a real gate, not a suggestion. CI collects coverage via `dotnet-coverage` (which wraps
the MTP run and returns its exit code, so a test failure still fails the build) and **enforces a
coverage floor**: the unit tier must stay at or above **68.3%** line coverage (measured about 70.3%) as
a regression backstop, gated on the unit tier alone rather than a gallery-diluted merged report, and
the floor only ever moves upward.

## Trade-offs, honestly

The shape is right, but the scorecard names real gaps and one is squarely in the testing story.

- **The UI tier's visual check is markup-deep, not pixel-deep.** The framework ships roughly a dozen
  reusable Blazor primitives in `MMCA.Common.UI`, some with real branching logic (`MobileCardList`,
  `MobileInfiniteScrollList`), and the pyramid carries a fast base layer *for the UI* under them: the
  `MMCA.Common.Testing.UI` bUnit base backs their component tests, a real-browser render-smoke gate
  runs in CI, and a render-snapshot regression tier diffs their markup against committed baselines.
  Category 28 (Front-End Testing) scores maturity 4 / implementation 9 on that evidence. The limit is
  what a snapshot compares: markup structure, not rendered pixels.
- **SQLite is not SQL Server.** The middle tier is fast precisely because it uses SQLite, which means
  SQL-Server-specific behavior (certain query translations, concurrency-token semantics) is validated
  against an approximation. The scorecard's Data Architecture row is candid about the surrounding
  shape: it holds maturity at 4 with implementation at 9, and ADR-018 records the non-SQL engines as
  deliberately latent, with no production entity on them. The trade buys a fast, Docker-free inner loop
  at the cost of needing the consumer apps and CI to cover the SQL-Server-specific paths.
- **The honest limit is mutation testing, not coverage.** The unit tier holds a **68.3%** line-coverage
  floor (measured about 70.3%), enforced in CI and ratcheted up as the suite grows rather than left as
  an aspiration. What holds category 14 below the top band is a single Exemplary gap: there is no
  mutation testing on the Core tier, so a green suite proves the lines run, not that every assertion
  would catch a mutant. That is a real limit, stated plainly.

None of these argue against the pyramid. They are the cost of keeping the base fast and honest about
what each tier actually proves.

## Apply this even without MMCA

The shape ports to any stack:

1. **Make the base fast enough to run on every save.** No Docker, no network, no shared database in the
   layer you run constantly. If your unit tests need a container, they are not unit tests.
2. **Use a real but embedded database for persistence tests.** A throwaway SQLite file (or your stack's
   equivalent) proves the ORM mapping actually builds without the cost of a container. Mocking the ORM
   proves nothing.
3. **Inject time and other ambient state.** A `FakeTimeProvider`-style swap point turns flaky time-dependent
   tests into deterministic ones.
4. **Ship your test harness, do not copy it.** If you have more than one service, put the fixtures, page
   objects, and base classes in a shared package so every consumer reuses one evolving harness.
5. **Gate it, then ratchet.** A modest coverage floor that only goes up beats an aspirational target
   nobody enforces.

The rule of thumb is the title: build the pyramid, not the ice-cream cone. A suite you run constantly,
because it is fast and green, is worth more than a comprehensive suite you run nervously, because it is
slow and flaky.

---

**What we covered:** why the pyramid's shape matters more than its count, the fast no-Docker base
(pure unit tests plus `FakeTimeProvider`), the real-SQLite middle tier with two databases in
`MultiSourceSqliteIntegrationTests`, the thin bUnit/Playwright cap and the orthogonal fitness-test tier,
the five shipped test packages that let consumers reuse the harness, the seven runtime conformance bases
that prove a really-booted host wired the framework's contracts (ADR-058) and their partial adoption, the
AppHost tier that compiles a claim about the composition itself (ADR-117), WCAG 2.1 AA shipped as a named
axe target with one recorded exception (ADR-063), the xUnit v3 / MTP runner and the CI coverage floor, and
the UI tier's honest limit: markup-deep snapshots rather than pixel-deep rendering.

**Next in the series:** soft-delete vs the right to erasure, the GDPR conflict that was this
framework's lowest-scoring category, and the boundary that resolved it.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the Testing section of the
contributor guide, or `dotnet add package MMCA.Common.Testing` and reuse the integration base in your
own app.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 The Testing and Build & Test Commands sections (`CLAUDE.md`) are in the repo; the testability
  score (§14/§28) is the current number in `Website/docs-src/governance/common-ArchitectureScorecard.md`.

*Tags: .NET, Testing, C Sharp, Software Architecture, Test Automation*

*Notes (this run, re-verified at framework v1.205.0, snapshot 2026-09-17 (`MMCA.Common/FACTS.md:4,14`),
against `Website/docs-src/governance/common-ArchitectureScorecard.md:5,88,94,120,121`,
`MMCA.Common/.github/workflows/ci.yml:180,183,467-468,481`, and `MMCA.Common/FACTS.md:19,35-39`):
verified names/facts: the suite is about 2,254 `[Fact]`/`[Theory]`, weighted to Core
(`common-ArchitectureScorecard.md:94` §14, maturity 4 / implementation 9, "counts re-synced 2026-09-14";
`ci.yml:180` comment, which floors the run at 2000 and puts the suite at about 2,254, above the
`--minimum-expected-tests 2000` run at `:183`). The prior 1,880 across 262 files is sixteenth-wave history, not a current figure, so the H1, the
subtitle and the opening paragraph were re-cut to the current number this run. `FakeTimeProvider`,
`MultiSourceSqliteIntegrationTests`
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:42-52`:
two GUID-named `.db` files under `Path.GetTempPath()` `:44-45`, wired as `SourceA`/`SourceB` Sqlite
connection strings `:50-51`), which is why the middle tier is described as embedded SQLite rather than
SQLite in-memory this run: the standout suite is file-backed. xUnit v3 + Microsoft Testing Platform (not
VSTest, per `global.json`); the unit-tier coverage floor 68.3% measured about 70.3% (`ci.yml:467-468`
comment, `awk -v m="68.3"` at `:481`). Five Testing.* packages of the nineteen published
(`FACTS.md:19` "Published packages - 19"; `Testing` `:35`, `Testing.Architecture` `:36`, `Testing.Aspire`
`:37`, `Testing.E2E` `:38`, `Testing.UI` `:39`), so the package bullets gained the `MMCA.Common.Testing.Aspire`
entry this run. `IntegrationTestBase<TFixture>`, `JwtTokenGenerator` (RS256), `BunitComponentTestBase`.
§14 and §28 both hold at maturity 4 / implementation 9, and §14 is held below 10 by the one remaining
Exemplary gap, no mutation testing on the Core tier (`common-ArchitectureScorecard.md:94`). The latest full
re-score is the thirty-sixth wave (2026-09-19, framework v1.205.0, git HEAD `90ffa7a`, clean tree,
`common-ArchitectureScorecard.md:5`, which also records rubric v2 per ADR-110 and §16 scored from this
cycle, so Sigma-weight is 82): no maturity value and no implementation value moved, three maturity
proposals and eight implementation proposals were refuted on the adversarial pass and held at prior, so
Maturity is 97.0% (318/328) (`:120`) and Implementation is 86.0% (705/820) (`:121`). §8 Data Architecture
is maturity 4 / implementation 9 on weight 3 (`:88`), its evidence names
`CrossDataSourceDegradeConvention` and records ADR-018's non-SQL engines as deliberately latent with no
production entity, so the trade-off bullet's "implementation at 8" was corrected this run. The rubric's
pyramid and inverted-pyramid wording is in
`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`. The onboarding anchor moved: the testing
group is `Website/docs-src/onboarding/group-28-testing-infrastructure.md` (group-27 is now
`group-27-common-ai-integration.md`), which also fixed a dead published link in the paste render. The
illustrative `CatalogTests` snippet is composed for shape; the base type and helpers are real.
Runtime conformance suites re-read this run against
`Website/docs-src/adr/058-runtime-conformance-suites-as-a-package.md`, which is Accepted 2026-07-28 and
revised 2026-08-14, 2026-08-18, 2026-08-23 and 2026-09-03 (`:4`): **seven** contract bases, one per runtime
contract (`:27`), all under `MMCA.Common/Source/Hosting/MMCA.Common.Testing/Conformance/` in namespace
`MMCA.Common.Testing.Conformance`. The seventh, added by the 2026-09-03 revision, is
`MmcaGatewayHardeningTestsBase<TEntryPoint>` (`MmcaGatewayHardeningTestsBase.cs:39`), which drives a booted
gateway through eight edge gates: rate limiter and bypass list, the tighter named policy on the credential
route, correlation id generated or echoed, one readiness check per downstream service, an active health
probe per cluster, and partitioning by the forwarded client IP (ADR-058 `:47-52`). The other six are
`ProblemDetailsContractTestsBase<TFixture>`, `OpenApiContractTestsBase<TFixture>`,
`ServiceInfoVersioningContractTestsBase<TFixture>`, `SecurityHeadersTestsBase`,
`GracefulShutdownTestsBase<TEntryPoint>` and `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult,
TQuery, TQueryResult>` (ADR-058 `:30-54`). An eighth base ships in that same folder without being one of
ADR-058's seven runtime contracts, `MiddlewarePipelineOrderTestsBase`
(`MiddlewarePipelineOrderTestsBase.cs:29`). The structure-vs-behavior boundary is ADR-015's own trade-off,
"The tests assert **structure / registration**, not runtime behavior"
(`Website/docs-src/adr/015-architecture-fitness-functions.md`). Adoption inventory re-verified by reading
the subclasses: problem details now covers all seven extracted REST hosts, because ADC Notification gained
one
(`MMCA.ADC/Tests/Integration/MMCA.ADC.Notification.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16-17`,
`: ProblemDetailsContractTestsBase<NotificationIntegrationTestFixture>(fixture)`), so the prior "all of
those except ADC Notification" and the adjacent "the OpenAPI guard is the only one on every extracted REST
host" were both corrected out. Security headers is now subclassed on four hosts, the two Gateways plus both
web heads (`MMCA.ADC/Tests/Hosts/MMCA.ADC.UI.Web.Tests/SecurityHeadersTests.cs:17-18` and
`MMCA.Store/Tests/Hosts/MMCA.Store.UI.Web.Tests/SecurityHeadersTests.cs:17-18`, each overriding
`CreateClient()` off its own host factory); graceful shutdown remains Gateway-only. MMCA.Helpdesk no longer
adopts none of them: `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/DecoratorPipelineOrderTests.cs:13,35-37`
imports `MMCA.Common.Testing.Conformance` and subclasses `DecoratorPipelineOrderTestsBase`, and
`.../MiddlewarePipelineOrderTests.cs:1,15` subclasses `MiddlewarePipelineOrderTestsBase` for the ADR-079
edge pipeline; that project carries the `MMCA.Common.Testing` reference itself
(`MMCA.Helpdesk.Architecture.Tests.csproj:24,26`), and Helpdesk pins all four
`MMCA.Common.Testing*` packages at 1.205.0 (`MMCA.Helpdesk/Directory.Packages.props:93-96`). Its test tree
is `Tests/Architecture` plus `Tests/Modules`, with no E2E project, which is what keeps the accessibility
section's Helpdesk sentence true.
AppHost tier added this run against `Website/docs-src/adr/117-apphost-integration-test-base.md` (Accepted
2026-09-09, revised 2026-09-11 and 2026-09-19; both consumer tiers subclass the package, `:8-10`; the gap
statement, a build never runs the AppHost and the in-process tier bypasses the orchestration, `:16-29`).
Read from source in `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/`: `AppHostFixtureBase`
(`Fixtures/AppHostFixtureBase.cs:38`, an `IAsyncLifetime` collection fixture) evaluates the precondition
gate first and returns without starting anything when it yields a reason (`:104-108`), boots through
`CreateBuilderAsync` returning an `IDistributedApplicationTestingBuilder` (`:169`, implemented by
`AppHostFixtureBase<TAppHost>`, `Fixtures/AppHostFixtureBase.Generic.cs:20`), then builds, starts and waits
per resource (`:123-127`); readiness-not-liveness and the healthy-versus-Running distinction are the class
docstring's own words (`:22-28`); teardown stops, disposes and restores every pushed environment variable
(`:135-159`). The gate is `Preconditions/AppHostEnvironmentGate.cs`: opt-in variable `MMCA_APPHOST_TESTS`
(`:16`) with the skip sentence at `:48-50`, surfaced as `SkipReason` (`AppHostFixtureBase.cs:53`) and
`IsAvailable` (`:56`); the default requirement is opt-in plus Docker (`:76-77`), and `SuppliesE2eRsaKeys`
(`:89`) mints an ephemeral RS256 keypair when `E2E_JWT_*` is absent, because an Identity resource with no
key material answers every request including `/alive` with a 500 and never turns healthy (ADR-117 `:42-53`,
where the ADC nightly ran red from 2026-09-01 to the 2026-09-09 root cause). `AppHostTestBase<TFixture>`
(`Fixtures/AppHostTestBase.cs:29`) supplies `CreateHttpClient` (`:44`), `GetConnectionStringAsync` (`:54`),
`CreateBearerToken` (`:74`) and the typed assertions `AssertHealthyAsync` (`:98`), `AssertAliveAsync`
(`:113`), `AssertReadyAsync` (`:127`), `AssertJwksAsync` (`:147`) and `AssertH2cAsync` (`:203`); the skip
call stays in the consuming project (`:20-24`). Probe paths are constants mirrored from the framework and
cross-asserted by a unit test (`Probes/AppHostProbePaths.cs:3-13`): `/health` (`:18`), `/alive` (`:26`),
`/health/ready` (`:32`), `/.well-known/jwks.json` (`:35`), with "a startup gate probes liveness, never
readiness" and the deadlock reason at `:20-25`. The AppHost snippet is illustrative of that documented
shape; the base types, the `RequiredEnvironment` override and the `Assert.SkipWhen(!Fixture.IsAvailable,
Fixture.SkipReason!)` line are real (`AppHostFixtureBase.cs:35,76-77`).
Accessibility section re-verified against `Website/docs-src/adr/063-accessibility-conformance-gate.md`
(Accepted 2026-08-01, `:4`, revised 2026-08-14, 2026-08-23, 2026-08-31 and 2026-09-01, `:4-14`; the
2026-08-23 revision records the fourth asserting Identity workflow base, `:6-8`). `AxeOptions.Wcag21Aa`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:17`) pins a `RunOnly` tag
list of exactly `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` (`:22`), with axe best-practice rules
deliberately out of scope (`:12-15`); the one exception `Wcag21AaExceptMudPagerCombobox` (`:35`) repeats
those four tags (`:40`) and disables only `aria-input-field-name` (`:44`), scoped to pages whose sole
combobox is `MudTablePager`'s unlabelled select (`:26-33`). `AssertNoAccessibilityViolationsAsync`
(`Infrastructure/PageExtensions.cs`) throws `AccessibilityViolationException` carrying impact, id, help text
and one compacted markup line per node. Four Identity workflow bases assert with `AxeOptions.Wcag21Aa`, not
three: `Workflows/Identity/UserLoginTestsBase.cs:82`, `UserRegistrationTestsBase.cs:95`,
`ProfileManagementTestsBase.cs:178` and `PasswordResetTestsBase.cs:88` and `:99`. The same folder also holds
`LogoutTestsBase.cs` and `AuthorizationTestsBase.cs`, neither of which calls
`AssertNoAccessibilityViolationsAsync`, which is why the Testing.E2E bullet now says four of the named
journeys close with an axe assertion rather than attaching the parenthetical to all of them; the package's
`Workflows/` folder also carries `Globalization/` and `Preferences/` bases. The two consumer helpers are
`ScanAsync` and `ScanGridAsync` on `Infrastructure/E2ETestBase.cs`. Enforcement per repo: Common's `ui-e2e`
job runs a `chromium, firefox, webkit` matrix and all three are required merge gates; ADC and Store call the
reusable E2E workflow chromium-only behind a UI-change filter that lets it skip; MMCA.Helpdesk pins
`MMCA.Common.Testing.E2E` at 1.205.0 (`MMCA.Helpdesk/Directory.Packages.props:94`) and has no E2E project.*

- Full series index: https://ivanball.github.io/writing.html
