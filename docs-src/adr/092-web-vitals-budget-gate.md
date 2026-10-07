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
  the published package `MMCA.Common.Testing.E2E`, `MMCA.Common/FACTS.md:41`) installs
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
- **Every run leaves a citable artifact and a citable line.** `WriteArtifactAsync` (`:63`) writes
  `web-vitals-{label}.json` (`:70`) as a `WebVitalsArtifact` envelope (`:90`) wrapping the measured
  `WebVitalsSample` (`:76`), under `WEB_VITALS_OUTPUT_DIR` or `artifacts/` beneath the working
  directory (`:65-66`); `Describe` (`:118`) renders the same sample as one invariant-culture line
  (`:122-124`) that `AssertWithinBudget` writes to test output.
- **The measurement flow is shipped, not hand-rolled per repo.** `MeasureWebVitalsAsync`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsPageExtensions.cs:32`,
  an `extension(IPage)` block at `:15`) installs the collector, navigates, optionally drives one
  scripted interaction against a named input placeholder, collects, writes the artifact and asserts
  the budget, in that order (`:43-44`, `:46-57`, `:59-62`). A second member,
  `MeasureWebVitalsWithInteractionAsync` (`:84`), takes a `Func<IPage, Task>` interaction instead of a
  placeholder for the interactions that form cannot express, and carries its own name rather than
  overloading the first, whose optional parameters would make the two ambiguous at the call site
  (`:70-72`). Install-before-navigate is the load-bearing part: observers installed after the
  navigation record no LCP, FCP or TTFB for that load (`:5-11`). Every suite routes through the block (ADC
  `WebVitalsTests.cs:109`, `:75`; Store `:118`, `:58`; the framework gallery `WebVitalsE2ETests.cs:58`,
  `:66`, `:74`, `:96`); Store's product-detail test is the one caller that still drives the collector
  directly, because it reaches its page by navigation rather than by path (Store
  `WebVitalsTests.cs:86-102`, `InstallAsync` at `:88`, `CollectAsync` at `:98`, `WriteArtifactAsync`
  at `:99`).
- **Both deployed apps assert the shipped defaults.** ADC's `WebVitalsTests`
  (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:32`) holds one shared
  `WebVitalsBudget` constructed with no arguments (`:36`, stated at `:34-35`) and measures four
  surfaces: home (`:44-45`), the public events entry point including its redirect (`:55-56`), the
  session list (`:69`) and login (`:91-92`). Store's
  (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/WebVitalsTests.cs:25`) holds the same shared
  no-argument budget (`:29`) over home (`:38-39`), the catalog browse page (`:53-72`) and login
  (`:75-76`); only product detail, reached by navigation rather than a hard-coded id (`:86-102`),
  still constructs the defaults inline (`:101`). Both drive one scripted search interaction on their
  grid page through `MeasureWebVitalsWithInteractionAsync` so the event-timing observer records an
  INP sample (ADC `:75-86`, Store `:58-69`): the search field comes from a page object
  (`PublicSessionListPage.cs:11`, `CatalogBrowsePage.cs:10`, both still located by placeholder text),
  and a field that is not visible within 15 seconds fails the test rather than skipping the
  interaction (ADC `:82`, Store `:65`; rationale at ADC `:64-68`, Store `:46-51`). No consumer passes
  the extension's best-effort `interactionPlaceholder` parameter (`WebVitalsPageExtensions.cs:46-57`).
  Both apps wrap the plain measurement in a private `MeasureAndAssertAsync` that re-asserts the
  returned sample at the call site (ADC `:107-112`, Store `:116-121`), and the interaction tests
  re-assert inline (ADC `:88`, Store `:71`).
- **The numbers are calibrated against measured maxima, not picked to be safe.** ADC's remarks record
  LCP 624 / FCP 444 / TTFB 27 ms / CLS 0.005 / INP 32 on run 29146540154, roughly 4x to 30x headroom
  (`MMCA.ADC/.../WebVitalsTests.cs:22-24`); Store's record LCP 172 / FCP 172 / TTFB 26 ms / CLS 0 /
  INP 24 on run 29146556386, roughly 10x to 30x
  (`MMCA.Store/.../WebVitalsTests.cs:17-19`). Both were calibrated 2026-07-11.
- **The assertions ride the deploy gate because the workflow runs the whole project.** `e2e.yml` runs
  `dotnet test --project ...E2E.Tests.csproj` with no filter (ADC `.github/workflows/e2e.yml:334-337`,
  Store `:394-397`) and points `WEB_VITALS_OUTPUT_DIR` at the uploaded diagnostics directory (ADC
  `:312`, Store `:383`). `deploy.yml` calls that workflow chromium-only as `e2e-gate` (ADC
  `deploy.yml:792-807`, chromium at `:806`; Store `:751-765`, chromium at `:764`), and the `deploy`
  job both lists it in `needs` (ADC `:1145`, Store `:1083`) and requires it to be `success` or
  `skipped` (ADC `:1182`, Store `:1116`). A
  front-end performance budget is therefore a production precondition on the same footing as the SBOM,
  the cost guard and the freshness gates, and `deploy.yml` says so where the k6 gate is defined (ADC
  `:847-848`, Store `:804-805`).
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
the package (`MMCA.Helpdesk/Directory.Packages.props:94`) but has no E2E test project at all, so the
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
  filter (ADC `deploy.yml:803`, Store `:761`) and `deploy` accepts `skipped` for it (ADC `:1182`,
  Store `:1116`), so a backend-only or infra-only deploy ships with no Web Vitals measurement of that
  commit. The test gate on such a deploy is the pull request's required checks (ADC `:798-800`,
  Store `:757-759`), which run no browser, so they leave this budget unmeasured on those deploys.
  Same intended cost trade as the accessibility gate, and the same caveat: "deployed"
  does not always mean "the budget ran on this commit".
- **It never runs on a pull request.** The E2E project is in neither solution filter and the gate is
  push/dispatch only (ADC `deploy.yml:803`, Store `:761`), so a regression is caught between merge and
  rollout, not before merge.
- **The measured configuration is not the production one.** CI pins the UI to `InteractiveServer`
  (ADC `e2e.yml:226`, Store `:229`), so the numbers describe Server-mode prerender-then-hydrate under
  runner contention, not production's `InteractiveAuto` on real hardware (ADC
  `WebVitalsTests.cs:18-21`, the caveat ADR-056 also records).
- **A marginal breach can be retried away.** The suite runs with `--retry-failed-tests 2` (ADC
  `e2e.yml:337`, Store `:396`), which is what absorbs a contention spike but also means a budget that
  fails once and passes twice reports green.
- **LCP and CLS are Chromium-only.** On Firefox and WebKit those observers fail silently and the
  fields stay 0, so the assertions pass vacuously (`WebVitalsCollector.cs:14-16`). The deploy gate is
  chromium-only, so this is real only for MMCA.Common's three-engine `ui-e2e` matrix
  (`MMCA.Common/.github/workflows/ci.yml:223`, matrix at `:232`), where two of the three legs assert LCP and CLS against
  nothing. The gallery's `AssertSomethingWasMeasured` guard catches only the total-vacuity case
  (nothing measured at all), not this per-metric one.
- **Coverage is a hand-picked page list.** Four pages in ADC and four in Store, against far larger
  inventories. Nothing forces a new page to acquire a budget, so breadth grows by discipline, the same
  caveat as the accessibility suites.
- **One page per app gets an INP sample.** In both apps the interaction is page-specific, a search
  box on the single grid page (ADC `WebVitalsTests.cs:64-86`, Store `:41-69`), and a missing field
  now fails the test rather than being skipped (ADC `:82`, Store `:65`); on every other measured page
  INP stays 0 and its assertion is skipped, so interaction latency is asserted on one page per app.
  The gallery is the only other place in the adoption set that drives one, on each of its three
  pages (`WebVitalsE2ETests.cs:88-116`).
- **The green-run artifact is written but not kept.** Both workflows upload the diagnostics bundle
  only on failure (ADC `e2e.yml:360-365`, Store `:457-462`), and MMCA.Common's `ui-e2e` job sets no
  `WEB_VITALS_OUTPUT_DIR` at all (its test step sets only `E2E_HEADLESS` and `E2E_BROWSER`,
  `ci.yml:289-291`) and uploads no Web Vitals artifact of its own (its one upload is Playwright
  traces, on failure only, `ci.yml:294-300`), so the JSON
  lands beside the test binaries and is discarded with the runner. There is no time series: the
  sample line in the run log is the only surviving record of a green run.
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
