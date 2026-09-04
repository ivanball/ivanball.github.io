# ADR-092: Core Web Vitals Budget as a Shipped Test Contract and Deploy Gate

## Status
Accepted (2026-08-23). Revised 2026-09-01: the measurement flow itself now ships as the one-call
`IPage.MeasureWebVitalsAsync` extension that every suite routes through, the framework gallery
measures three pages against a `WebVitalsBudget` plus an anti-vacuity guard rather than three local
constants over two pages, and the ADC and Store `deploy.yml` line anchors were refreshed.

## Context
Rubric section 23 asks for client-side performance that is measured rather than assumed, naming Core
Web Vitals (LCP, INP, CLS) or an equivalent as the evidence
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:606`, category at `:596`). It is the
client-side complement of section 12 (`:349`), which the backend already answers two ways: ADR-060
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
Ship the measurement infrastructure, the one-call measurement flow and the assert mechanics in
`MMCA.Common.Testing.E2E`, default the budget to the Core Web Vitals good band, and let the
assertions ride the existing deploy-gating E2E suite.

- **The collector is a shipped, dependency-free measurement type.** `WebVitalsCollector`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:20`, in
  the published package `MMCA.Common.Testing.E2E`, `MMCA.Common/FACTS.md:36`) installs
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
- **One shipped call owns the whole measurement flow.** `MeasureWebVitalsAsync`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsPageExtensions.cs:32`,
  an `extension(IPage)` block at `:15`) installs the collector, navigates, optionally drives one
  scripted interaction, collects, writes the artifact and asserts the budget, in that order (`:43-44`,
  `:46-57`, `:59-62`). Install-before-navigate is the load-bearing part: observers installed after the
  navigation record no LCP, FCP or TTFB for that load (`:5-11`). Every suite routes through it (ADC
  `WebVitalsTests.cs:90`, Store `:42`, `:52`, `:62`, the framework gallery `WebVitalsE2ETests.cs:40`,
  `:48`, `:56`); Store's product-detail test is the one caller that still drives the collector
  directly, because it reaches its page by navigation rather than by path (Store
  `WebVitalsTests.cs:76-89`).
- **Both deployed apps assert the shipped defaults.** ADC's `WebVitalsTests`
  (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:29`) holds one shared
  `WebVitalsBudget` constructed with no arguments (`:39`, stated at `:37-38`) and measures four
  surfaces: home (`:48`), the public events entry point including its redirect (`:59`), the session
  list (`:68`) and login (`:72`). Store's
  (`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/WebVitalsTests.cs:25`) constructs the same
  defaults inline (`:42`, `:55`, `:62`, `:89`) over home (`:41`), the
  catalog browse page (`:51`), login (`:61`) and product detail reached by navigation rather than a
  hard-coded id (`:81`). Both pass one scripted search interaction to the measurement call on their
  grid page so the event-timing observer records an INP sample (ADC `:35`, `:69`; Store `:57`), and
  ADC wraps the call in a private `MeasureAndAssertAsync` that re-asserts the returned sample at the
  ADC call site (`:88-93`).
- **The numbers are calibrated against measured maxima, not picked to be safe.** ADC's remarks record
  LCP 624 / FCP 444 / TTFB 27 ms / CLS 0.005 / INP 32 on run 29146540154, roughly 4x to 30x headroom
  (`MMCA.ADC/.../WebVitalsTests.cs:19-21`); Store's record LCP 172 / FCP 172 / TTFB 26 ms / CLS 0 /
  INP 24 on run 29146556386, roughly 10x to 30x
  (`MMCA.Store/.../WebVitalsTests.cs:17-19`). Both were calibrated 2026-07-11.
- **The assertions ride the deploy gate because the workflow runs the whole project.** `e2e.yml` runs
  `dotnet test --project ...E2E.Tests.csproj` with no filter (ADC `.github/workflows/e2e.yml:326-329`,
  Store `:369-372`) and points `WEB_VITALS_OUTPUT_DIR` at the uploaded diagnostics directory (ADC
  `:304`, Store `:364`). `deploy.yml` calls that workflow chromium-only as `e2e-gate` (ADC
  `deploy.yml:677-692`, Store `:634-649`), and the `deploy` job both lists it in `needs` (ADC
  `:1054`, Store `:999`) and requires it to be `success` or `skipped` (ADC `:1092`, Store `:1038`). A
  front-end performance budget is therefore a production precondition on the same footing as the SBOM,
  the cost guard and the freshness gates, and `deploy.yml` says so where the k6 gate is defined (ADC
  `:754-755`, Store `:709-713`).
- **The framework measures its own UI, under its own looser numbers.** `WebVitalsE2ETests`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitals/WebVitalsE2ETests.cs:15`) measures the
  backend-less in-process gallery on three pages, login (`:40`), components (`:48`) and grid (`:56`),
  through the same shipped extension, against a `WebVitalsBudget` of LCP 8000 ms, FCP 8000 ms, TTFB
  4000 ms and CLS 0.25 (`:29-30`, constants at `:17-19`). FCP is pinned to the LCP ceiling rather than
  left on the package default, so the effective gate is the three metrics the gallery gates on
  (`:21-27`): the gallery is a backstop against catastrophic regression in the shared chrome (a render
  loop, a giant synchronous asset, a layout-shifting theme change), not a calibrated app budget
  (`:7-14`). Each test adds one in-class guard, `AssertSomethingWasMeasured` (`:42`, `:50`, `:58`,
  defined at `:66-69`), which fails when neither TTFB nor FCP was recorded, so an all-zero sample
  cannot clear every ceiling by never having been measured.
- **The regression behaviour is pinned by unit tests, not by the browser runs.**
  `WebVitalsBudgetTests` (`.../MMCA.Common.UI.E2E.Tests/WebVitals/WebVitalsBudgetTests.cs:12`) starts no
  browser and covers exactly what only ever fires on a regression: that the defaults are the good
  band (`:17-26`), that each of the five metrics fails when it exceeds its ceiling (`:45-56`), that a
  0 INP is skipped (`:58-64`), that a caller-supplied budget is honoured in both directions
  (`:66-73`), and the exact text of the sample line (`:32-43`).

Adoption is the two deployed apps plus the framework gallery. **MMCA.Helpdesk has neither**: it pins
the package (`MMCA.Helpdesk/Directory.Packages.props:84`) but has no E2E test project at all, so the
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
  ceiling (ADC `WebVitalsTests.cs:19-21`) makes the headroom a reviewable fact and makes a future
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
  filter (ADC `deploy.yml:688`, Store `:645`) and `deploy` accepts `skipped` for it (ADC `:1092`,
  Store `:1038`), so a backend-only or infra-only deploy ships with no Web Vitals measurement of that
  commit. ADC pairs the gate with a `backend-test-gate` carrying the exact inverse condition
  (`deploy.yml:394`, `:396`), but that job runs no browser, so it leaves this budget unmeasured on
  those deploys. Same intended cost trade as the accessibility gate, and the same caveat: "deployed"
  does not always mean "the budget ran on this commit".
- **It never runs on a pull request.** The E2E project is in neither solution filter and the gate is
  push/dispatch only (ADC `deploy.yml:688`, Store `:645`), so a regression is caught between merge and
  rollout, not before merge.
- **The measured configuration is not the production one.** CI pins the UI to `InteractiveServer`
  (ADC `e2e.yml:218`, Store `:210`), so the numbers describe Server-mode prerender-then-hydrate under
  runner contention, not production's `InteractiveAuto` on real hardware (ADC
  `WebVitalsTests.cs:15-18`, the caveat ADR-056 also records).
- **A marginal breach can be retried away.** The suite runs with `--retry-failed-tests 2` (ADC
  `e2e.yml:329`, Store `:372`), which is what absorbs a contention spike but also means a budget that
  fails once and passes twice reports green.
- **LCP and CLS are Chromium-only.** On Firefox and WebKit those observers fail silently and the
  fields stay 0, so the assertions pass vacuously (`WebVitalsCollector.cs:14-16`). The deploy gate is
  chromium-only, so this is real only for MMCA.Common's three-engine `ui-e2e` matrix
  (`MMCA.Common/.github/workflows/ci.yml:237`), where two of the three legs assert LCP and CLS against
  nothing. The gallery's `AssertSomethingWasMeasured` guard catches only the total-vacuity case
  (nothing measured at all), not this per-metric one.
- **Coverage is a hand-picked page list.** Four pages in ADC and four in Store, against far larger
  inventories. Nothing forces a new page to acquire a budget, so breadth grows by discipline, the same
  caveat as the accessibility suites.
- **Only pages with a search box get an INP sample.** The interaction is best-effort and page-specific
  (ADC `WebVitalsTests.cs:31-35`, Store `:44-49`); on every other measured page INP stays 0 and its
  assertion is skipped, so interaction latency is asserted on one page per app.
- **The green-run artifact is written but not kept.** Both workflows upload the diagnostics bundle
  only on failure (ADC `e2e.yml:355-359`, Store `:398-404`), and MMCA.Common's `ui-e2e` job sets no
  `WEB_VITALS_OUTPUT_DIR` at all and uploads only Playwright traces (`ci.yml:316-322`), so the JSON
  lands beside the test binaries and is discarded with the runner. There is no time series: the
  sample line in the run log is the only surviving record of a green run.
- **Nothing stops a ceiling being raised to silence a red gate.** As with ADR-060's baseline, the
  defaults are a value in source and widening them is a reviewable diff, not a tool-enforced one.

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
