# ADR-147: Test Gaps Found by Risk Ratchets and Traceability Fitness Functions (Baselines Only Shrink)

## Status
Accepted (2026-11-16). The shared action, the three fitness bases and the route recorder are released in MMCA.Common v1.295.0 (`MMCA.Common/CHANGELOG.md:7`, entries at `:17` to `:20`); MMCA.ADC and MMCA.Store adopt them.

## Context

Each repo gates coverage with line and branch floors: MMCA.Common's required `coverage` job (`MMCA.Common/.github/workflows/ci.yml:458`), and in each consumer a unit-tier line floor and an Application-layer branch floor (`MMCA.ADC/.github/workflows/deploy.yml:422`, `:458`; `MMCA.Store/.github/workflows/deploy.yml:379`, `:412`). A floor says how much code is tested. It does not say where the next test should go, and it stays green while a small, high-risk path has no test at all: a revenue path at 0% in both the unit and the integration tier sits comfortably under a passing repo-wide percentage, because the many easy lines elsewhere carry the average.

Three further gaps had no signal at all:

- **Entry points measured on the wrong tier.** A controller action that a unit test constructs and calls with mocked services reads as covered in the unit report, although no request ever reached it through routing, authorization, model binding and a real database. Only the integration report says whether an entry point was exercised end to end inside the host.
- **Pages with no browser test.** End-to-end tests run the app out of process, so they produce no code coverage, and nothing tied an `@page` route to a test that opens it.
- **Manual cases with an unchecked automation claim.** Each consumer keeps its manual test suite in the repo (`MMCA.ADC/Docs/ManualTestSuite/README.md:5`), one `### <id> <title>` heading per case. The suite's hand-kept `Auto:` flag claims the Playwright suite covers a case (`MMCA.Store/Docs/ManualTestSuite/README.md:19`), but it names no test and nothing verifies it, so a manual run cannot tell which cases automation really covers.

This ADR builds on [ADR-015](015-architecture-fitness-functions.md) (rule bodies shipped once in `MMCA.Common.Testing.Architecture` and subclassed per repo) and follows the gate shape of [ADR-060](060-performance-regression-gate.md) (a committed, reviewable baseline that a pull request must edit deliberately to move a number).

## Decision

**Gaps are found by deterministic checks against committed baselines that only shrink. A new risk fails; existing debt is listed, reviewable, and can only be removed.**

### The coverage ratchet: one shared action, two checks

`coverage-ratchet` is a composite action in MMCA.Common (`MMCA.Common/.github/actions/coverage-ratchet/action.yml:1-11`) that runs `ratchet.ps1` with every input passed through the environment, never spliced into the script (`action.yml:48-57`). All three repos call the same implementation; the consumers reference it at `ivanball/MMCA.Common/.github/actions/coverage-ratchet@main` (`MMCA.ADC/.github/workflows/deploy.yml:922`).

The script reads one or more Cobertura reports and keys each method as `Class::Method` with the class name stripped of its namespace, so a namespace move does not churn a baseline (`MMCA.Common/.github/actions/coverage-ratchet/ratchet.ps1:11-12`, `:66`). An async state machine (`Outer.<Name>d__N.MoveNext`) is folded into the method it implements, and lambdas and display classes are skipped (`:49`, `:62-63`). Across several reports each method takes its best line rate, so the tiers are a union (`:73-80`). Generated files and `obj/` paths are skipped (`:59`).

- **`check: crap`** computes CRAP as `cx^2 * (1 - cov)^3 + cx` (`ratchet.ps1:9`, `:101`). It fails on a method above the threshold (default 30, `action.yml:30-33`) that the baseline does not list, and on a baselined method whose CRAP rose past its recorded value plus 0.5 (`ratchet.ps1:126-133`).
- **`check: entrypoints`** fails on a method of an entry-point class (a regex over the short class name, default `Controller$`, `action.yml:34-37`), other than a constructor or a property accessor, at 0% line coverage in every report given, that the baseline does not list (`ratchet.ps1:103-104`).
- **Stale entries warn and never fail.** A baselined method that is now under the line, covered or gone is reported as a warning asking for its removal (`ratchet.ps1:135`, `:139`), so improving coverage never turns a build red.
- **It fails closed.** No report, an unreadable report, a missing baseline in check mode, or zero methods matching `include` is an error, never a pass (`ratchet.ps1:42`, `:89`, `:91`, `:117`).
- **`mode: write-baseline`** writes the baseline from the current reports and exits 0 (`ratchet.ps1:108-115`). The baseline is sorted text, one `Class::Method<TAB>value` per line, so its diff is reviewable.

The action carries its own self-test (`MMCA.Common/.github/actions/coverage-ratchet/test/Test-Ratchet.ps1`), which MMCA.Common's job runs before the ratchet (`MMCA.Common/.github/workflows/ci.yml:533-534`).

### Where each check runs and what it reads

- **MMCA.Common** runs `check: crap` only, in the `coverage-risk` job (`MMCA.Common/.github/workflows/ci.yml:523-558`). It merges the unit report with the reports of the five Testcontainers integration jobs, which upload them as `integration-coverage-*` (`ci.yml:940-942`), against `.github/coverage-baselines/crap.txt`. The shipped `Testing.*` packages are measured; test projects, the migrations fixture, benchmarks and the deployment sample are not (`ci.yml:555-557`). Common has no API host of its own, so the entry-point check belongs to the consumers.
- **MMCA.ADC and MMCA.Store** run both checks in a `coverage-risk` job on pull requests (`MMCA.ADC/.github/workflows/deploy.yml:892-942`, `MMCA.Store/.github/workflows/deploy.yml:763-813`). `check: crap` reads the unit and the integration report together (`MMCA.ADC/.github/workflows/deploy.yml:925`). **`check: entrypoints` reads the integration report only** (`:935`). Each consumer's entry-point regex names its controllers, its gRPC services and its integration-event handlers by the event they consume, because those handlers end in `Handler` like command handlers (`:939-942`; `MMCA.Store/.github/workflows/deploy.yml:813`). Both consumers' CRAP baselines are empty files (`MMCA.ADC/.github/coverage-baselines/crap.txt`, `MMCA.Store/.github/coverage-baselines/crap.txt`), so any method above 30 fails. Their entry-point baselines list only integration-event handlers, which the unit and cross-service tiers cover (`MMCA.Store/.github/coverage-baselines/entrypoints.txt:1-7`).
- **An integration-tier floor** sits beside the ratchet: a line floor over each consumer's Infrastructure and API assemblies, measured on the integration report, about two points under the measured value and ratcheted up as the tier grows (`MMCA.ADC/.github/workflows/deploy.yml:813-821`, floor at `:840`; `MMCA.Store/.github/workflows/deploy.yml:685-692`, floor at `:711`).

### Gates start non-required

Every `coverage-risk` job is outside the required checks and is promoted after about ten green runs (`MMCA.Common/.github/workflows/ci.yml:516-522`, `MMCA.ADC/.github/workflows/deploy.yml:892-898`, `MMCA.Store/.github/workflows/deploy.yml:763-769`). It is deliberately absent from the required `coverage` job's `needs`, which stays `[changes, build-and-test]` (`MMCA.Common/.github/workflows/ci.yml:459`): a failed non-required job in a required job's `needs` would skip that job, and a skipped required check posts green. For the same reason the Common integration artifacts are named `integration-coverage-*`, not `coverage-*`, which the required job downloads (`ci.yml:940-941`). In the consumers it is also absent from the deploy job's `needs` (`MMCA.ADC/.github/workflows/deploy.yml:1334`).

### Three traceability fitness bases

Each is a thin abstract base in `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/TestGaps/` with its rule body in `Rules/Governance/ArchitectureRules.TestGaps.cs`, the split ADR-015 uses. All three read source text under the repo root, skipping `bin`, `obj`, `node_modules` and `.git` (`ArchitectureRules.TestGaps.cs:302`), so the architecture test project needs no reference to the test assemblies.

- **`HandlerTestCoverageTestsBase`** (`HandlerTestCoverageTestsBase.cs:16`): every concrete command and query handler in the map's module Application assemblies (`ArchitectureRules.TestGaps.cs:208-214`) is named, as a whole identifier, in at least one `*.cs` file under `TestsRoots` (default `Tests`, `HandlerTestCoverageTestsBase.cs:24`; rule at `ArchitectureRules.TestGaps.cs:42-77`). `AllowedUntestedHandlers` (`HandlerTestCoverageTestsBase.cs:27`) exempts a handler, and an entry that names no handler fails as stale, so the list only shrinks (`ArchitectureRules.TestGaps.cs:67-69`). `MinimumHandlers` (`HandlerTestCoverageTestsBase.cs:33`) fails a map that resolved too few handlers to mean anything (`:39-43`).
- **`PageE2ECoverageTestsBase`** (`PageE2ECoverageTestsBase.cs:15`): every `@page` route under `SourceRoot` is matched by a string literal in the E2E sources (default `Tests/E2E`, `:24`). A `{param}` segment matches any one segment or an interpolation hole; query strings, fragments and a leading `{BaseUrl}` hole are ignored, and matching ignores case and a trailing slash (`ArchitectureRules.TestGaps.cs:90-94`, rule at `:100-134`). `AllowedUntestedRoutes` (`PageE2ECoverageTestsBase.cs:27`) lists, by reason, the routes an E2E run cannot reach. Both consumers allowlist one route, `/settings/device`, as device-only: the MAUI head routes it and the web head never serves it (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/TestGaps/PageE2ECoverageTests.cs:17-22`, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/TestGaps/PageE2ECoverageTests.cs:17-22`). `MinimumRoutes` (`PageE2ECoverageTestsBase.cs:30`) is the non-vacuity floor.
- **`ManualCaseTraitTestsBase`** (`ManualCaseTraitTestsBase.cs:14`): every `[Trait("Case", "<id>")]` under `TestsRoot` (`ArchitectureRules.TestGaps.cs:27`) names a case that exists as a `### <id> ` heading in `SuiteFolder` (default `Docs/ManualTestSuite`, `ManualCaseTraitTestsBase.cs:23`; heading regex at `ArchitectureRules.TestGaps.cs:24`; rule at `:156-181`). A missing suite folder fails rather than skips (`:162-168`). `MinimumLinkedCases` (`ManualCaseTraitTestsBase.cs:26`) floors the number of distinct linked cases (`ArchitectureRules.TestGaps.cs:188-205`), so a deleted link turns the build red; an adopter raises it as links are added (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/TestGaps/ManualCaseTraitTests.cs:13`).

### Manual cases link to tests through a trait

The link between a manual case and the automated test that verifies it lives on the test, as `[Trait("Case", "<id>")]` (for example `MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:45`), at whichever tier verifies it: unit, integration or E2E. There is no separate mapping file. The trait scan, not the hand-kept `Auto:` flag, decides how much of a case a manual validation run repeats by hand in the workspace's manual-validation procedure: every P1 case, every unlinked case and every MAUI-only case runs in full; a case whose linked tests all passed in a CI run on the build under test is spot-checked on a rotating sample and otherwise reported as passed by CI, with the run and the test names.

### An E2E-infeasible case moves down a tier

A case an E2E run cannot drive reliably is not forced into the E2E suite. Its automated test belongs at the lowest tier that can exercise the behaviour. Two cases show the rule: MMCA.Store's X-17, a session surviving access-token expiry through silent refresh (`MMCA.Store/Docs/ManualTestSuite/04-cross.md:332`), is covered by unit tests of the cookie-session refresher on a fake clock (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs`), because an E2E run cannot wait out a real token lifetime; and MMCA.ADC's A-46, social sign-up after the provider round trip (`MMCA.ADC/Docs/ManualTestSuite/02-attendee.md:210`), is covered by an Identity integration test that fakes only the provider's code exchange and drives the real completion, code exchange and terms-acceptance endpoints (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Auth/SocialSignUpTermsAcceptanceTests.cs`), because a real social provider's challenge cannot run in CI. A trait links a case only to tests in the case's own repo, so X-17's lower-tier test lives in MMCA.Common without a Store trait, and the case stays P1 and runs by hand.

### A complex but covered method is a refactor target

CRAP of a fully covered method equals its cyclomatic complexity (`cov = 1` in `ratchet.ps1:101`), so no test can bring a method with complexity above 30 under the threshold. Such a method is refactored, not tested: MMCA.ADC's asset icon lookup became a `FrozenDictionary` instead of a switch (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/SessionAssets/SessionAssetDisplay.cs:22-37`), and MMCA.Store's guest order page moved its status line, items and account panel into child components (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/GuestOrders/GuestOrderStatusBanner.razor.cs:12`). Where a refactor is not yet worth it, the method stays in the baseline: MMCA.Common's `crap.txt` keeps the numeric filter strategies' `Apply`, `ModuleLoader::TopologicalSort` and `MiddlewarePipelineBuilder::CreateDefault` as refactor targets, beside helpers of the shipped `Testing.*` packages that need a browser or an AppHost (`MMCA.Common/.github/coverage-baselines/crap.txt`).

### An opt-in E2E route recorder

`E2ERouteRecorder` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ERouteRecorder.cs:21`) records which pages and API paths each E2E test reaches. It is off unless `E2E_ROUTE_LOG_DIR` is set (`:8-13`, `:23`), and `E2ETestBase` attaches it with one call (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:44-46`). It records main-frame navigations, client-side ones included, and the context's non-navigation requests, and flushes when the page or the context closes (`E2ERouteRecorder.cs:107-115`). Each test writes its own JSON Lines file, so parallel tests never share one (`:11-13`). **Only the path is written** (`url.AbsolutePath`, `:133`): query strings and fragments, where guest-order tokens and sign-in links travel, never reach the log, and requests to any origin other than the UI host and `E2E_API_BASE_URL` are ignored (`:14-18`, `:128-131`). Both consumers set the variable in `e2e.yml` and upload the log on every run, pass or fail (`MMCA.ADC/.github/workflows/e2e.yml:353`, `:384`; `MMCA.Store/.github/workflows/e2e.yml:390`, `:454`).

### Numbers come from scripts

Every count and ranking is computed by a script, never by a model. The ratchet is one, and a workspace detection script (not part of any product repo) merges the newest CI coverage artifacts, the `@page` routes, the E2E literals and route log, the manual suite and its traits into one ranked gap report per repo, using the same method keys and CRAP formula as the ratchet, with a recommended tier per gap and complex-but-covered methods set apart as refactor targets.

## Rationale

- **Risk, not volume, picks the next test.** CRAP weighs complexity against coverage, so an untested branchy method outranks a thousand easy lines, and an entry point at 0% on the integration tier is a named method, not a fraction of a percentage. A floor cannot express either.
- **A ratchet makes new code meet the bar without a big-bang cleanup.** Existing debt is listed in the baseline and never fails the build; only a new entry or a risen value does. The baseline is a reviewable file in the diff, the shape ADR-060 already uses for performance, so adding to it is a visible decision in a pull request rather than a silent drift.
- **Integration coverage is the honest signal for an entry point.** A unit test of a controller proves the method's own logic, not that the request pipeline reaches it; reading the integration report alone keeps a mocked call from passing as coverage.
- **The test carries the link.** A trait sits beside the assertion it describes, moves with the test and is deleted with it, which the linked-case floor then catches. The fitness rule holds every link to a real case id, so a link cannot rot silently the way the `Auto:` flag could.
- **Source-text rules stay fast and need no references.** The three bases follow ADR-015: one rule body in Common, a thin subclass per repo, a red build instead of a review comment.
- **Starting non-required is how a new gate earns trust.** Coverage jitter or a parser edge case shows up in the first runs without blocking merges; promotion follows a record of green runs.

## Trade-offs

- **Text matching is approximate.** A handler named only in a comment or a `nameof` counts as tested, and two handlers with the same simple name in different modules share one match. The ratchet catches what a name match misses: a handler with no real test shows up as a CRAP or entry-point entry.
- **The page rule checks that a literal exists, not that a test opens it.** A route string in a page object that no test calls still satisfies it. The route recorder is the runtime counterpart, and it feeds the gap report rather than a gate.
- **Only the handler allowlist fails stale entries.** A route left on `AllowedUntestedRoutes` after a test starts reaching it is not reported (`ArchitectureRules.TestGaps.cs:119-129`); review removes it.
- **CRAP ignores branch coverage.** The formula uses the line rate (`ratchet.ps1:101`), so a fully executed method with an untaken branch scores as covered. The Application-layer branch floors cover that dimension at layer level only.
- **The consumer action pin floats.** The consumers call the action at `@main`, so a change to the ratchet reaches them without a release; the self-test in Common's CI is what guards it.
- **A non-required gate can be ignored.** Until promotion a red `coverage-risk` does not block a merge, so it relies on the author reading it.
- **The recorder does not measure server code.** It records what the browser asked for, not which server methods ran; what E2E alone covers on the server stays unmeasured.

## Alternatives rejected

Weighed 2026-11-15 unless stated.

- **A global coverage target (80%).** Rejected: it rewards the easiest lines and says nothing about where the risk is; the existing floors already bound volume. Revisit never as a replacement for the ratchet; a floor may still rise beside it.
- **Diff coverage on changed lines.** Rejected: it treats a one-line getter and a twenty-branch method alike and ignores risk weight. Revisit if a change type appears that the CRAP and entry-point checks both miss.
- **Mutation testing in CI.** Rejected on runtime and because Stryker.NET cannot mutate Razor projects under the current SDK; it stays in the test-authoring loop, where each new test is shown to kill a mutant before it lands. Revisit when a mutation run fits a CI job's budget and supports every project type.
- **A CRAP gate on existing code.** Rejected: failing on legacy debt forces a big-bang cleanup before the gate can be wired at all. The baseline lists the debt instead.
- **Regenerating a baseline to clear a red ratchet** (2026-11-15, on the gate's first real catch: a new method above 30 and a baselined method that rose). Rejected: it waves the finding through and turns the ratchet into a recorder. The fix moved the flagged wiring into the recorder, where unit tests cover it. `write-baseline` is for adopting the gate and for dropping stale entries after an improvement; an entry is added only as a reviewed, deliberate decision. Revisit never.
- **A separate mapping file from manual cases to tests.** Rejected: a file apart from the tests drifts as tests are renamed, moved or deleted; the trait lives on the test. Revisit if a case must be linked to something that is not a test method.
- **One pull request per untested method.** Rejected on pull-request and review volume; the gap report is worked in waves per repo. Revisit if review capacity, not authoring, becomes the constraint.
- **E2E server coverage by static instrumentation of the service assemblies** (deferred, not rejected). The trait links already answer which journeys lack E2E; instrumentation would only add which server code E2E alone reaches. Revisit if the gap report leaves E2E-only areas that cannot otherwise be judged.

## Consequences

- **A new handler, page or risky method needs a test or a reviewed baseline or allowlist entry.** The fitness bases fail the build; the ratchet fails `coverage-risk` until it is promoted to required.
- **Per adopter**: subclass the three bases with `RepoRoot`, the map and the floors (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/TestGaps/HandlerTestCoverageTests.cs:8-16`); create both baselines with `mode: write-baseline` from a downloaded set of CI reports; add a `coverage-risk` job outside the required and deploy `needs`; set `E2E_ROUTE_LOG_DIR` and upload the route log; tag the tests behind each manual case with its `Case` trait and set `MinimumLinkedCases` to the linked count.
- **A new integration event** needs its handler's event prefix added to the consumer's `entrypoint-classes` regex, or its handler is not checked (`MMCA.ADC/.github/workflows/deploy.yml:939-941`).
- **What to watch.** Promote each `coverage-risk` job to required after about ten green runs; delete stale baseline entries when the job warns; and when a manual case gains a test at a lower tier in its own repo (as A-46 did), add its trait and raise `MinimumLinkedCases`.
