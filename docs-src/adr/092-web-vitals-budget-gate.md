# ADR-092: Core Web Vitals Budget as a Shipped Test Contract and Deploy Gate

## Status
Accepted (2026-08-23). Revised 2026-09-01: the measurement flow itself now ships as an `IPage`
extension that every suite routes through, and the framework gallery measures three pages against a
`WebVitalsBudget` plus an anti-vacuity guard rather than three local constants over two pages.
Revised 2026-09-19: the extension block ships a second member,
`MeasureWebVitalsWithInteractionAsync`; the gallery has stepped its ceilings down from the opening
set, now specifies all five metrics and drives an interaction on one of its three pages; and Store
now carries the same `backend-test-gate` pairing that only ADC had.
Revised 2026-10-01: citations refreshed and the gallery interaction sentence corrected.
Revised 2026-10-06: both apps drive their INP interaction through `MeasureWebVitalsWithInteractionAsync`
with a failing visibility check, and the gallery now gates on the good band with a 200 ms INP
ceiling sampled on all three pages.
Revised 2026-10-07: both apps removed `backend-test-gate` from their deploys, so ADC's deploy now
carries two conditional gates (`e2e-gate`, `ai-eval-gate`) and Store's one (`e2e-gate`), and
MMCA.Common's `ui-e2e` job no longer uploads an E2E coverage file, only Playwright traces on failure.
Revised 2026-10-21: anchors refreshed after later edits to both apps' `deploy.yml` files and the
Helpdesk package pins.
Revised 2026-10-26: anchors refreshed after later edits to both apps' `deploy.yml` files, ADC's
`e2e.yml`, MMCA.Common's `ci.yml` and `FACTS.md`.
Revised 2026-10-28: anchors refreshed after an apt-mirror step moved MMCA.Common's `ui-e2e` test
step in `ci.yml`.
Revised 2026-11-23: the green-run Trade-offs bullet now records that both apps upload their TRX
results on every run while the Web Vitals JSON uploads only on failure, and anchors refreshed after
later edits to both apps' test classes and workflows, MMCA.Common's `ci.yml`, `FACTS.md` and the
Helpdesk package pins.

## Context
Rubric section 23 asks for client-side performance that is measured rather than assumed, naming Core
Web Vitals (LCP, INP, CLS) or an equivalent as the evidence
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:648`, category at `:638`). It is the
client-side complement of section 12 (`:380`), which the backend already answers two ways: ADR-060
gates MMCA.Common's hot paths on a committed BenchmarkDotNet baseline, and the deployed apps run a k6
load test against read endpoints on a schedule.

Neither reaches the browser. A benchmark measures managed allocations and a ratio between two methods
in one process; k6 measures what the server returns, not when a page paints, whether it shifts under
the reader, or how long the first interaction takes to be handled. A Blazor render-mode change, a
heavier prerender payload, an unsized image, or a chrome change that reflows after hydration are all
invisible to both, and all of them are what the reader experiences as "slow".

The measurement problem is the mirror image of ADR-060's. There, absolute wall-clock latency on a
shared runner was too noisy to assert. Here the numbers are noisy too (a two-core hosted runner
carrying SQL Server, Redis, RabbitMQ, every service, the UI and Playwright at once), but the metric
has something a microbenchmark does not: an externally defined "good" band that is orders of
magnitude above the measured values on this hardware. That gap is what makes an absolute client-side
ceiling assertable where an absolute nanosecond count is not.

The third problem is placement. A number captured in a report nobody reads is not a budget. To be one
it has to fail something, and the only place a real engine already runs against a real stack is the
Playwright suite that ADR-063 made a deploy gate for accessibility.

## Decision
Ship the measurement infrastructure, the measurement flow and the assert mechanics in
`MMCA.Common.Testing.E2E`, default the budget to the Core Web Vitals good band, and let the
assertions ride the existing deploy-gating E2E suite.

- **The collector is a shipped, dependency-free measurement type.** `WebVitalsCollector`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:20`, in
  the published package `MMCA.Common.Testing.E2E`, `MMCA.Common/FACTS.md:50`) installs
  `PerformanceObserver` hooks as a Playwright init script so they exist before first paint
  (`InstallAsync`, `:40`, script at `:26-35`), accumulating LCP, CLS, FCP and an event-timing INP
  sample into `window.__vitals`. `CollectAsync` (`:47`) reads them back and stamps TTFB from
  Navigation Timing (`:52-54`). No third-party JS and no network egress: every observer is wrapped in
  `try/catch` so an engine lacking the entry type leaves that metric at 0 rather than throwing
  (`:22-25`).
- **The budget is a record whose defaults are the good band.** `WebVitalsBudget` (`:103`) defaults to
  `Lcp = 2500`, `Fcp = 1800`, `Ttfb = 800`, `Cls = 0.1` and `Inp = 500` (`:104-108`): the Core Web
  Vitals good thresholds for LCP, FCP and CLS, plus a TTFB ceiling and a single-interaction INP
  sample ceiling. The parameters are defaulted, not constants, so a consumer whose measured maxima
  justify tighter numbers passes its own (`:92-96`).
- **A breach is a thrown test failure naming the page.** `AssertWithinBudget` (`:137`) asserts each
  metric with `Should().BeLessThanOrEqualTo` (`:143-146`) and formats every failure as
  `{metric} {measured} exceeded budget {budget} on {path}` (`:154-157`), so a red gate points at the
  page rather than at a dashboard.
- **A zero INP is skipped, not read as a pass.** The INP assertion runs only when a sample was
  actually recorded (`:148-151`): no interaction clearing the observer's 16 ms `durationThreshold`
  (`:35`) leaves the field at 0, which must mean neither pass-by-absence nor failure.
- **Every run writes a citable artifact and a citable line.** `WriteArtifactAsync` (`:63`) writes
  `web-vitals-{label}.json` (`:70`) as a `WebVitalsArtifact` envelope (`:90`) wrapping the measured
  `WebVitalsSample` (`:76`), under `WEB_VITALS_OUTPUT_DIR` or `artifacts/` beneath the working
  directory (`:65-66`); `Describe` (`:118`) renders the same sample as one invariant-culture line
  (`:122-124`) that `AssertWithinBudget` writes to test output. Which of the two a run keeps is a
  workflow choice, recorded under Trade-offs.
- **The measurement flow is shipped, not hand-rolled per repo.** `MeasureWebVitalsAsync`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsPageExtensions.cs:31`,
  an `extension(IPage)` block at `:14`) installs the collector, navigates, optionally drives one
  scripted interaction against a named input placeholder, collects, writes the artifact and asserts
  the budget, in that order (`:42-43`, `:45-56`, `:58-61`). A second member,
  `MeasureWebVitalsWithInteractionAsync` (`:83`), takes a `Func<IPage, Task>` interaction instead of a
  placeholder for the interactions that form cannot express, and carries its own name rather than
  overloading the first, whose optional parameters would make the two ambiguous at the call site
  (`:69-71`). Install-before-navigate is the load-bearing part: observers installed after the
  navigation record no LCP, FCP or TTFB for that load (`:5-11`). Every suite routes through the block (ADC
  `WebVitalsTests.cs:113`, `:78`; Store `:122`, `:60`; the framework gallery `WebVitalsE2ETests.cs:58`,
  `:66`, `:74`, `:96`); Store's product-detail test is the one caller that still drives the collector
  directly, because it reaches its page by navigation rather than by path (Store
  `WebVitalsTests.cs:88-106`, `InstallAsync` at `:92`, `CollectAsync` at `:102`, `WriteArtifactAsync`
  at `:103`).
- **Both deployed apps assert the shipped defaults.** ADC's `WebVitalsTests`
  (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:32`) holds one shared
  `WebVitalsBudget` constructed with no arguments (`:36`, stated at `:34-35`) and measures four
  surfaces: home (`:46-47`), the public events entry point including its redirect (`:58-59`), the
  session list (`:73`) and login (`:96-97`). Store's
  (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/WebVitalsTests.cs:25`) holds the same shared
  no-argument budget (`:29`) over home (`:39-40`), the catalog browse page (`:53-74`) and login
  (`:78-79`); only product detail, reached by navigation rather than a hard-coded id (`:88-106`),
  still constructs the defaults inline (`:105`). Both drive one scripted search interaction on their
  grid page through `MeasureWebVitalsWithInteractionAsync` so the event-timing observer records an
  INP sample (ADC `:78-89`, Store `:60-71`): the search field comes from a page object
  (`PublicSessionListPage.cs:11`, `CatalogBrowsePage.cs:10`, both still located by placeholder text),
  and a field that is not visible within 15 seconds fails the test rather than skipping the
  interaction (ADC `:85`, Store `:67`; rationale at ADC `:66-70`, Store `:47-52`). No consumer passes
  the extension's best-effort `interactionPlaceholder` parameter (`WebVitalsPageExtensions.cs:45-56`).
  Both apps wrap the plain measurement in a private `MeasureAndAssertAsync` that re-asserts the
  returned sample at the call site (ADC `:111-116`, Store `:120-125`), and the interaction tests
  re-assert inline (ADC `:91`, Store `:73`).
- **The numbers are calibrated against measured maxima, not picked to be safe.** ADC's remarks record
  LCP 624 / FCP 444 / TTFB 27 ms / CLS 0.005 / INP 32 on run 29146540154, roughly 4x to 30x headroom
  (`MMCA.ADC/.../WebVitalsTests.cs:22-24`); Store's record LCP 172 / FCP 172 / TTFB 26 ms / CLS 0 /
  INP 24 on run 29146556386, roughly 10x to 30x
  (`MMCA.Store/.../WebVitalsTests.cs:17-19`). Both were calibrated 2026-07-11.
- **The assertions ride the deploy gate because the workflow runs the whole project.** `e2e.yml` runs
  `dotnet test --project ...E2E.Tests.csproj` with no filter (ADC `.github/workflows/e2e.yml:424-427`,
  Store `:464-468`) and points `WEB_VITALS_OUTPUT_DIR` at the uploaded diagnostics directory (ADC
  `:382`, Store `:450`). `deploy.yml` calls that workflow chromium-only as `e2e-gate` (ADC
  `deploy.yml:1201`, chromium at `:1215`; Store `:965`, chromium at `:978`), and the `deploy`
  job both lists it in `needs` (ADC `:1571`, Store `:1318`) and requires it to be `success` or
  `skipped` (ADC `:1608`, Store `:1351`). A
  front-end performance budget is therefore a production precondition on the same footing as the SBOM,
  the cost guard and the freshness gates, and `deploy.yml` says so where the k6 gate is defined (ADC
  `:1259-1260`, Store `:1021-1022`).
- **The framework measures its own UI, under the good band and a tighter INP ceiling.**
  `WebVitalsE2ETests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitals/WebVitalsE2ETests.cs:17`) measures the
  backend-less in-process gallery on three pages, login (`:56-61`), components (`:64-69`) and grid
  (`:72-77`), through the same shipped extension, against a `WebVitalsBudget` of LCP 2500 ms, FCP
  1800 ms, TTFB 800 ms, CLS 0.1 and INP 200 ms (constants at `:19-23`, assembled at `:47-48`). The
  first four equal the package defaults (`WebVitalsCollector.cs:104-107`); INP 200 ms is tighter than
  the 500 ms default (`:108`) that both apps take. The documentation records that these replace the
  interim 4000/3000/1500/0.1/500 set after the gallery measured well inside it (`:42-46`). The three
  load tests drive no interaction; a separate theory, `Interaction_IsSampled_AndWithinInpBudget`
  (`:88-116`, one row per page at `:89-91`), drives one plain interaction on each page (typing into
  the email field, clicking a toggle, clicking a grid row: `:119-125`) through
  `MeasureWebVitalsWithInteractionAsync` (`:96`). It also installs an Event Timing probe script
  (`:33-40`, added at `:94`), skips only when the engine exposes neither the `event` nor the
  `first-input` entry type (`:102-105`), fails when the interaction produced no timing entry
  (`:112`), and asserts INP at or under 200 ms (`:113-115`), so INP is sampled on all three gallery
  pages. Every test adds one in-class guard, `AssertSomethingWasMeasured` (`:60`, `:68`, `:76`,
  `:97`, defined at `:141-144`), which fails when neither TTFB nor FCP was recorded, so an all-zero
  sample cannot clear every ceiling by never having been measured.
- **The regression behaviour is pinned by unit tests, not by the browser runs.**
  `WebVitalsBudgetTests` (`.../MMCA.Common.UI.E2E.Tests/WebVitals/WebVitalsBudgetTests.cs:12`) starts no
  browser and covers exactly what only ever fires on a regression: that the defaults are the good
  band (`:17-26`), that each of the five metrics fails when it exceeds its ceiling (`:45-56`), that a
  0 INP is skipped (`:58-64`), that a caller-supplied budget is honoured in both directions
  (`:66-73`), and the exact text of the sample line (`:32-43`).

Adoption is the two deployed apps plus the framework gallery. **MMCA.Helpdesk has neither**: it pins
the package (`MMCA.Helpdesk/Directory.Packages.props:95`) but has no E2E test project at all, so the
seed carries no worked example of a client-side budget, the same gap ADR-063 records for
accessibility.

## Rationale
- **The good band is an external contract, which is what makes an absolute ceiling defensible here.**
  ADR-060 refused absolute latency because a nanosecond count is a property of the runner. LCP 2500 ms
  is not a claim about this runner: it is the published threshold the metric is defined against, and
  the measured values sit 4x to 30x below it. The noise floor of a two-core hosted runner fits inside
  that gap with room to spare, so the assertion survives a noisy neighbour and still fires on a real
  regression.
- **Calibrating against observed maxima is what separates a budget from a backstop.** Numbers chosen
  by feel end up either flaky or vacuous. Recording the run id and the measured maximum next to the
  ceiling (ADC `WebVitalsTests.cs:22-24`) makes the headroom a reviewable fact and makes a future
  tightening an evidence-based edit rather than a guess.
- **Ship the mechanics, keep the numbers with the consumer.** The install-before-navigate ordering,
  the assert body, the message format, the artifact shape and the INP-zero carve-out are subtle and
  identical everywhere, so they belong in the package (`WebVitalsCollector.cs:16-18`,
  `WebVitalsPageExtensions.cs:5-11`). The ceilings depend on hosting and runner, so they
  belong to the app. Defaulted record parameters express exactly that split: both apps happen to take
  the defaults today, and either can tighten without a framework change.
- **Reuse the gate that already exists.** A separate performance workflow would be another
  twenty-minute Aspire boot and another thing to keep green. Because the suite runs the whole project,
  adding a test class added a deploy-gating budget at zero marginal CI cost, the same lever ADR-063
  used for accessibility.
- **A single-interaction sample is honest about what it is.** Field INP is a p75 over real sessions
  and cannot be produced by one scripted click. Naming the metric `INP-sample` in the output line
  (`WebVitalsCollector.cs:124`) and in the parameter documentation (`:102`) keeps the assertion from
  claiming more than it measured.
- **Artifacts make a red gate diagnosable and a green one auditable.** The JSON envelope plus the
  one-line record mean a reviewer can compare today's numbers against the calibration run instead of
  re-running the suite to find out what happened.

## Trade-offs
- **The gate is ui-scoped and may legitimately skip.** Both apps gate `e2e-gate` on a `ui` change
  filter (ADC `deploy.yml:1212`, Store `:975`) and `deploy` accepts `skipped` for it (ADC `:1608`,
  Store `:1351`), so a backend-only or infra-only deploy ships with no Web Vitals measurement of that
  commit. The test gate on such a deploy is the pull request's required checks (ADC `:1207-1211`,
  Store `:971-974`), which run no browser, so they leave this budget unmeasured on those deploys.
  Same intended cost trade as the accessibility gate, and the same caveat: "deployed"
  does not always mean "the budget ran on this commit".
- **It never runs on a pull request.** The E2E project is in neither solution filter and the gate is
  push/dispatch only (ADC `deploy.yml:1212`, Store `:975`), so a regression is caught between merge and
  rollout, not before merge.
- **The measured configuration is not the production one.** CI pins the UI to `InteractiveServer`
  (ADC `e2e.yml:282`, Store `:290`), so the numbers describe Server-mode prerender-then-hydrate under
  runner contention, not production's `InteractiveAuto` on real hardware (ADC
  `WebVitalsTests.cs:18-21`, the caveat ADR-056 also records).
- **A marginal breach can be retried away.** The suite runs with `--retry-failed-tests 2` (ADC
  `e2e.yml:426`, Store `:466`), which is what absorbs a contention spike but also means a budget that
  fails once and passes twice reports green.
- **LCP and CLS are Chromium-only.** On Firefox and WebKit those observers fail silently and the
  fields stay 0, so the assertions pass vacuously (`WebVitalsCollector.cs:14-16`). The deploy gate is
  chromium-only, so this is real only for MMCA.Common's three-engine `ui-e2e` matrix
  (`MMCA.Common/.github/workflows/ci.yml:331`, matrix at `:340`), where two of the three legs assert LCP and CLS against
  nothing. The gallery's `AssertSomethingWasMeasured` guard catches only the total-vacuity case
  (nothing measured at all), not this per-metric one.
- **Coverage is a hand-picked page list.** Four pages in ADC and four in Store, against far larger
  inventories. Nothing forces a new page to acquire a budget, so breadth grows by discipline, the same
  caveat as the accessibility suites.
- **One page per app gets an INP sample.** In both apps the interaction is page-specific, a search
  box on the single grid page (ADC `WebVitalsTests.cs:66-89`, Store `:42-71`), and a missing field
  now fails the test rather than being skipped (ADC `:85`, Store `:67`); on every other measured page
  INP stays 0 and its assertion is skipped, so interaction latency is asserted on one page per app.
  The gallery is the only other place in the adoption set that drives one, on each of its three
  pages (`WebVitalsE2ETests.cs:88-116`).
- **The green-run JSON is written but not kept.** Both apps write the JSON into the
  `artifacts/` directory that only the failure-only diagnostics bundle uploads (ADC `e2e.yml:473-483`,
  `if: failure()` at `:477`; Store `:547-557`, `:551`), so a green run's `web-vitals-*.json` is
  discarded with the runner. MMCA.Common's `ui-e2e` job sets no `WEB_VITALS_OUTPUT_DIR` at all (its
  test step sets only `E2E_HEADLESS` and `E2E_BROWSER`, `ci.yml:486-488`) and uploads no Web Vitals
  artifact of its own (its one upload is Playwright traces, on failure only, `ci.yml:491-497`), so
  there the JSON lands in `artifacts/` under the test run's working directory
  (`WebVitalsCollector.cs:65-66`), which no step uploads. What both apps do keep from every run,
  pass or fail, is the TRX results folder (ADC `e2e.yml:444-453`, Store `:519-528`, 14-day
  retention), uploaded for its per-test durations (ADC `:445-446`, Store `:520-521`); whether each
  TRX result also carries the test's output, and so the sample line, is not stated by either
  workflow. That folder is the only place a green run's numbers can survive, and it expires, so
  there is no time series.
- **Nothing stops a ceiling being raised to silence a red gate.** As with ADR-060's baseline, the
  defaults are a value in source and widening them is a reviewable diff, not a tool-enforced one.

## Revision (2026-10-01)
No decision or rationale changed. One sentence is corrected: the gallery's components test was
described as the only case in the whole adoption set that drives an interaction, but ADC's session
list and Store's catalog page also drive one through the placeholder path (ADC
`WebVitalsTests.cs:69`, Store `:57`), as the Decision and Trade-offs already say. It now reads as the
one gallery case and the only caller of `MeasureWebVitalsWithInteractionAsync`
(`WebVitalsE2ETests.cs:61-65`). Citations are refreshed for the rubric
(`ArchitectureEvaluationCriteria.md:648`, `:638`, `:380`), `FACTS.md:41`, the gallery tests
(`WebVitalsE2ETests.cs:47`, `:61`, `:73`, guard `:83-86`), both `e2e.yml` and `deploy.yml` files
(ADC `deploy.yml:827-842`, Store `:799-814`; Store's test step now pipes through `tee` under
`pipefail`, Store `e2e.yml:392-397`), MMCA.Common `ci.yml:248` and the Helpdesk pin
(`Directory.Packages.props:94`).

## Revision (2026-10-06)
No decision or rationale changed. Corrections:
- Both apps now drive their grid-page search through `MeasureWebVitalsWithInteractionAsync` with a
  page-object locator that fails the test when the field is absent (ADC `WebVitalsTests.cs:74-85`,
  Store `:58-69`); no consumer passes the best-effort `interactionPlaceholder` parameter any more, so
  the 2026-10-01 statement that the gallery components test is the only caller of that member no
  longer holds (callers: ADC `:74`, Store `:58`, gallery `WebVitalsE2ETests.cs:96`).
- Store now holds one shared no-argument budget (`:29`) and the same `MeasureAndAssertAsync` helper
  as ADC (`:116-121`); only product detail still constructs the defaults inline (`:101`).
- The gallery budget is now LCP 2500 / FCP 1800 / TTFB 800 / CLS 0.1 / INP 200
  (`WebVitalsE2ETests.cs:19-23`), so the "looser numbers", the pending step-down and the
  catastrophic-backstop description are dropped; INP is sampled on all three gallery pages by a
  separate theory (`:88-116`) rather than on the components page alone, and the guard now sits at
  `:141-144`.
- ADC's `deploy` job now carries a third conditional gate, `ai-eval-gate`, alongside `e2e-gate` and
  `backend-test-gate` (ADC `deploy.yml:1242`, `:1266-1269`, `:1289`); the e2e-gate treatment is
  unchanged.
- Line anchors for both apps' test classes, both `deploy.yml` files and the gallery tests were
  re-verified against current source.

## Revision (2026-10-07)
Re-verified against current source. The decision, the budget, the measurement flow and the
chromium-only, ui-scoped `e2e-gate` itself are unchanged. Three workflow jobs or steps that earlier
text described accurately were removed from source on 2026-10-07, and one of those removals changes
the test posture of a deploy that skips this gate.
1. `backend-test-gate` was removed from both apps. ADC #258 (2026-10-07) removed the job, its entry
   in `deploy.needs` and its `success`-or-`skipped` condition; Store #197 (2026-10-07) did the same.
   The 2026-09-19 Status sentence (Store "carries the same `backend-test-gate` pairing") and the
   2026-10-06 item (ADC's `ai-eval-gate` sits "alongside `e2e-gate` and `backend-test-gate`") were
   true when written and describe the earlier workflows.
2. That job was what ran when the ui-scoped `e2e-gate` skipped. With it gone, a backend-only or
   infra-only deploy runs no deploy-time test job at all: ADC's `deploy.needs` holds `e2e-gate` and
   `ai-eval-gate` as its only conditional gates (ADC `deploy.yml:1145`, each accepted as `success` or
   `skipped` at `:1182-1183`, `ai-eval-gate` defined at `:509`), and Store's holds only `e2e-gate`
   (Store `deploy.yml:1083`, described as its one conditional gate at `:1104`, condition `:1116`).
   Both workflows now name the pull request's `build-and-test` required checks as the test gate for
   such a deploy, relying on branch protection to make the merged tree the PR-tested tree (ADC
   `deploy.yml:798-800`, Store `deploy.yml:757-759`); the first Trade-offs bullet says so.
3. MMCA.Common #523 (2026-10-07) removed the chromium leg's `coverage-e2e` upload from the `ui-e2e`
   job. Its one remaining upload is Playwright traces on failure (`ci.yml:294-300`); the Trade-offs
   bullet now says so.
4. Anchors re-verified against current source: ADC `WebVitalsTests.cs` class `:32`, budget `:36`
   (comment `:34-35`), interaction `:75-86`, visibility `:82`, rationale `:64-68`,
   `MeasureAndAssertAsync` `:107-112`, inline assert `:88`, callers `:109` and `:75`, calibration
   `:22-24`, caveat `:18-21`, trade-off span `:64-86`; ADC `deploy.yml` `e2e-gate` `:792-807`
   (chromium `:806`), `needs` `:1145`, success-or-skipped `:1182`, Web Vitals comment `:847-848`;
   Store `deploy.yml` `e2e-gate` `:751-765` (chromium `:764`), `needs` `:1083`, success-or-skipped
   `:1116`, Web Vitals comment `:804-805`; MMCA.Common `ci.yml` `ui-e2e` `:223`, matrix `:232`.

## Revision (2026-10-21)
Re-verified against current source. The decision, the budget, the measurement flow, the chromium-only
ui-scoped `e2e-gate`, ADC's two conditional gates and Store's one are unchanged, as is Helpdesk's
lack of any E2E test project. Only line anchors moved, after later edits to both `deploy.yml` files
and the Helpdesk package pins; the dated revisions above keep the anchors they were written with.
1. Anchors re-verified against current source: ADC `deploy.yml` `e2e-gate` `:799-822` (ui-scoped
   `if` `:818`, chromium `:821`, PR-checks comment `:813-817`), Web Vitals comment `:862-863`,
   `needs` `:1160`, success-or-skipped `:1197-1198`, `ai-eval-gate` defined at `:523`; Store
   `deploy.yml` `e2e-gate` `:753-767` (ui-scoped `if` `:763`, chromium `:766`, PR-checks comment
   `:759-762`), Web Vitals comment `:806-807`, `needs` `:1098`, one-conditional-gate comment
   `:1119-1120`, success-or-skipped `:1131`; Store `e2e.yml` failure-only upload `:458-463`;
   `MMCA.Helpdesk/Directory.Packages.props:93`.

## Revision (2026-10-26)
Re-verified against current source. The decision, the budget, the measurement flow, the
chromium-only ui-scoped `e2e-gate`, ADC's two conditional gates (`e2e-gate`, `ai-eval-gate`) and
Store's one (`e2e-gate`), the failure-only diagnostics upload and MMCA.Common's lack of any
`WEB_VITALS_OUTPUT_DIR` are unchanged. Only line anchors moved; the dated revisions above keep the
anchors they were written with.
1. Anchors re-verified against current source: `MMCA.Common/FACTS.md:45` (the
   `MMCA.Common.Testing.E2E` package entry); ADC `deploy.yml` `e2e-gate` `:808-823` (ui-scoped `if`
   `:819`, chromium `:822`, PR-checks comment `:814-818`), Web Vitals comment `:863-864`, `needs`
   `:1161`, success-or-skipped `:1198-1199`; Store `deploy.yml` `e2e-gate` `:754-768` (ui-scoped `if`
   `:764`, chromium `:767`, PR-checks comment `:760-763`), Web Vitals comment `:807-808`, `needs`
   `:1099`, success-or-skipped `:1132`; ADC `e2e.yml` `dotnet test` `:360-362` (retry `:362`),
   `WEB_VITALS_OUTPUT_DIR` `:327`, `E2E_FORCE_SERVER` `:241`, failure-only upload `:390-396`;
   MMCA.Common `ci.yml` `ui-e2e` `:223`, matrix `:232`, test-step env `:342-344`, failure-only trace
   upload `:347-353`.

## Revision (2026-10-28)
Re-verified against current source. The decision, the budget, the measurement flow, the
chromium-only ui-scoped `e2e-gate`, the failure-only diagnostics upload and MMCA.Common's lack of
any `WEB_VITALS_OUTPUT_DIR` in its `ui-e2e` job are unchanged, as are both apps' recorded
calibration maxima (ADC `WebVitalsTests.cs:22-24`, Store `:17-19`). Only line anchors in
MMCA.Common's `ci.yml` moved, after an apt-mirror step was inserted ahead of the `ui-e2e` test step;
the dated revisions above keep the anchors they were written with.
1. Anchors re-verified against current source: MMCA.Common `ci.yml` `ui-e2e` `:223`, matrix `:232`,
   test step `:372`, test-step env `:374-376` (`E2E_HEADLESS` `:375`, `E2E_BROWSER` `:376`),
   failure-only trace upload `:379-385` (`if: failure()` `:380`).

## Revision (2026-11-23)
Re-verified against current source. The decision, the budget, the measurement flow, the
chromium-only ui-scoped `e2e-gate`, ADC's two conditional gates and Store's one, the four measured
pages per app, the failure-only diagnostics upload, MMCA.Common's lack of any
`WEB_VITALS_OUTPUT_DIR` and Helpdesk's lack of any E2E test project are unchanged. One Trade-offs
sentence is corrected and the rest are anchor moves; the dated revisions above keep the anchors
they were written with.
1. The green-run Trade-offs bullet said the sample line in the run log is the only surviving record
   of a green run, and that the JSON lands beside the test binaries. Both apps point
   `WEB_VITALS_OUTPUT_DIR` at `$GITHUB_WORKSPACE/artifacts` (ADC `e2e.yml:382`, Store `:450`), which
   only the failure-only diagnostics bundle uploads (ADC `:473-483`, Store `:547-557`); in
   MMCA.Common the JSON goes to `artifacts/` under the run's working directory
   (`WebVitalsCollector.cs:65-66`), which no step uploads. Both apps upload the TRX results folder on
   every run with 14-day retention (ADC `:444-453`, Store `:519-528`), the one green-run record that
   can carry the sample line. The Decision bullet on the artifact now says the run writes it rather
   than leaves it. The bullets now say so.
2. Anchors re-verified against current source: `MMCA.Common/FACTS.md:50` (the
   `MMCA.Common.Testing.E2E` package entry); `WebVitalsPageExtensions.cs` `MeasureWebVitalsAsync`
   `:31`, `extension(IPage)` `:14`, flow `:42-43` / `:45-56` / `:58-61`,
   `MeasureWebVitalsWithInteractionAsync` `:83`, naming rationale `:69-71`; ADC `WebVitalsTests.cs`
   home `:46-47`, events entry `:58-59`, sessions `:73`, login `:96-97`, interaction `:78-89`,
   visibility `:85`, rationale `:66-70`, `MeasureAndAssertAsync` `:111-116`, inline assert `:91`,
   callers `:113` and `:78`, trade-off span `:66-89`; Store `WebVitalsTests.cs` home `:39-40`,
   catalog `:53-74`, interaction `:60-71`, visibility `:67`, rationale `:47-52`, login `:78-79`,
   product detail `:88-106` (`InstallAsync` `:92`, `CollectAsync` `:102`, `WriteArtifactAsync`
   `:103`, inline budget `:105`), `MeasureAndAssertAsync` `:120-125`, inline assert `:73`, callers
   `:122` and `:60`, trade-off span `:42-71`; ADC `deploy.yml` `e2e-gate` `:1201` (ui-scoped `if`
   `:1212`, chromium `:1215`, PR-checks comment `:1207-1211`), Web Vitals comment `:1259-1260`,
   `needs` `:1571`, success-or-skipped `:1608-1609`, `ai-eval-gate` defined at `:670`; Store
   `deploy.yml` `e2e-gate` `:965` (ui-scoped `if` `:975`, chromium `:978`, PR-checks comment
   `:971-974`), Web Vitals comment `:1021-1022`, `needs` `:1318`, one-conditional-gate comment
   `:1339-1340`, success-or-skipped `:1351`; ADC `e2e.yml` `dotnet test` `:424-427` (retry `:426`),
   `E2E_FORCE_SERVER` `:282`; Store `e2e.yml` `dotnet test` `:464-468` (retry `:466`),
   `E2E_FORCE_SERVER` `:290`; MMCA.Common `ci.yml` `ui-e2e` `:331`, matrix `:340`, test-step env
   `:486-488`, failure-only trace upload `:491-497` (`if: failure()` `:492`);
   `MMCA.Helpdesk/Directory.Packages.props:95`.

## Related
[ADR-063](063-accessibility-conformance-gate.md) (the structural sibling: the same package, the same
Playwright suite and the same deploy gate, applied to WCAG 2.1 AA instead of load performance),
[ADR-060](060-performance-regression-gate.md) (the backend half of rubric section 12: a committed
BenchmarkDotNet baseline gating MMCA.Common pull requests, where this gates the two consumer apps'
deploys at the browser),
[ADR-056](056-blazor-render-mode-strategy.md) (the render-mode decision these numbers measure, and
which already cites this suite for the Server-mode-in-CI caveat),
[ADR-015](015-architecture-fitness-functions.md) (the invariant-over-discipline posture applied to
structure, of which this is the client-side runtime-cost instance),
[ADR-041](041-observability-and-telemetry.md) (production telemetry, which observes server-side cost after
deploy where this fails a client-side budget before rollout).
