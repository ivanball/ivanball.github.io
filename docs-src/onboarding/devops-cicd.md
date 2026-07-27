# CI/CD and Operations

This chapter walks the GitHub Actions workflows that govern MMCA, from the framework's continuous
integration and lockstep NuGet release in `MMCA.Common`, through the ADC application's build/test/deploy
pipeline, end-to-end Playwright testing, cost-guard automation, performance load testing, and the one-time
data-migration cutover that enacted the database-per-service architecture ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). (A seventh ADC
workflow, `dr-drill.yml`, is summarized in the cross-workflow table at the end rather than given its own
section.) For each workflow you
will learn the triggers, the job/step sequence with file-and-line citations, and, critically, *why* each
gate exists and what would break without it. Rubric categories are tagged inline so you can connect each
pipeline decision to its architecture-quality axis. Cross-links to the primer and other tier chapters are
included throughout.

---

## MMCA.Common, `ci.yml`

**File:** `MMCA.Common/.github/workflows/ci.yml`

### What it is

The continuous-integration workflow for the MMCA.Common framework. Because the fifteen packages are
consumed by every downstream application, a regression here propagates to both `MMCA.ADC` and
`MMCA.Store`. The workflow runs **nine jobs**: a `changes` classifier that every other job keys off, a
fast `build-and-test` covering unit and architecture tests (with coverage collection), a windows
`build-maui` for the one package that cannot compile on Ubuntu, a `ui-e2e` cross-browser matrix for
real-browser accessibility and render-smoke testing, a `performance-smoke` benchmark gate, a `coverage`
job that merges the coverage tiers and enforces a floor, and three canaries that catch failure modes the
solution build cannot see: `consumer-source-build`, `package-consumption`, and
`sample-deployment-validate`, plus `redis-integration` for the one component whose storage format only a
real server can falsify.

That job count is the interesting fact about this workflow. A framework cannot verify itself by compiling
itself: most of these jobs exist because a green `dotnet build` on the framework's own solution has, at
some point, coexisted with a broken consumer, a broken package, or a broken deployment sample.

[Rubric §17, DevOps & Deployment] assesses whether CI/CD is automated, gates are meaningful, and
deployments are reproducible. This workflow embodies §17 as the automated gate that every MMCA.Common
change must pass before it can influence downstream consumers.

### Triggers

```yaml
# ci.yml:14-16
on:
  pull_request:
    branches: [main]
```

**Pull requests only.** There is deliberately no `push: [main]` trigger, and the comment above the
trigger (`ci.yml:3-13`) records why: `main` is protected with "Require branches to be up to date before
merging", so a `pull_request` check runs against `refs/pull/N/merge`, which is `main` already merged into
the PR head. Under squash merge that merge result **is** the tree that lands on `main`, so a
push-triggered re-run only re-verified an already-verified tree. The comment carries the measurement that
settled it: 30 such runs over three days in July 2026, 266 wasted minutes, competing for the same
concurrency slots as the PR runs they duplicated.

Release verification does not depend on this, which is what makes the deletion safe: `release.yml` runs
its own restore, build, and test against the `v*` tag before publishing.

```yaml
# ci.yml:18-23
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
  PLAYWRIGHT_BROWSERS_PATH: ${{ github.workspace }}/.ms-playwright
```

The first var forces GitHub's bundled JavaScript actions onto the Node 24 runtime, avoiding deprecation
warnings that would surface as build noise. The second redirects Playwright's browser install out of
`~/.cache/ms-playwright` and into the workspace, which is what lets `actions/cache` carry the browser
binaries between runs. It has to be workflow-level rather than step-level because both the install step
and the test run read it.

```yaml
# ci.yml:27-29
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Pushing to a PR again supersedes the still-running check set, since a stale run's result is never
actionable. The `cancel-in-progress` expression is guarded on `event_name` rather than hardcoded to
`true` so that a future non-PR trigger cannot cancel itself.

### Job: `changes`, the docs-only short-circuit

The first job (`ci.yml:36-70`) classifies the diff and exposes a single `code` output (`ci.yml:39-40`)
that every heavy step below is guarded on. It walks the changed files against the base ref and sets
`code=false` only when **every** changed path ends in `.md`.

The design detail worth internalizing is that the flag guards **steps, not jobs**. All eight required
status contexts must still post green on a docs-only PR, and a skipped job posts no context at all, so
guarding at job level would leave branch protection waiting forever on checks that never arrive. Guarding
at step level means the jobs all run, do almost nothing, and report green.

The classifier is fail-safe in both directions (`ci.yml:52-59`): an unresolvable base ref or a failed
`git diff` sets `code=true` and runs the full pipeline. Guessing "code changed" wastes runner minutes;
guessing "docs only" ships an unverified change.

One step deliberately escapes the guard, covered next.

### Job: `build-and-test`

**Runs on:** `ubuntu-latest` (`ci.yml:74`). The Ubuntu runner matters: the Linux file system is
case-sensitive, so path-casing bugs that Windows masks are caught in CI. This is a deliberate choice
documented in `MMCA.Common/CLAUDE.md` ("CI runs on Ubuntu, file paths are case-sensitive").

**Step 1, Checkout with full history** (`ci.yml:76-78`):

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0 # MinVer needs full history
```

`fetch-depth: 0` fetches all tags and the complete git history. Without it, MinVer (the version-derivation
tool) cannot walk back to find the nearest `vX.Y.Z` tag and would produce an unstable pre-release version
string. Shallow clones (the GitHub default of depth 1) silently break reproducible versioning.

**Step 2, .NET 10 setup** (`ci.yml:80-92`): `actions/setup-dotnet@v6` pinned to `10.0.x` ensures the
runner matches the `<TargetFramework>net10.0</TargetFramework>` in every project. It also caches
`~/.nuget/packages`, keyed on the committed lock files **plus** `Directory.Packages.props`, because
`build/facts` and `build/perfgate` have no lock file and the repo does not pass `--locked-mode`, so the
props file is what actually pins their versions. The cache itself is gated on the `code` flag
(`ci.yml:89`): on a docs-only PR every restore step is skipped, `~/.nuget/packages` is never created, and
setup-dotnet's cache-save step would otherwise fail the whole job with "Cache folder path does not exist
on disk".

**Step 3, Verify FACTS.md is current** (`ci.yml:97-100`):

```bash
dotnet run --project build/facts -- . --check
```

A fast, dependency-free drift gate. `build/facts` recomputes the framework-wide facts from source (version
from the git tag, package count, ADR range, fitness-method and base-class counts) and fails if the
committed `FACTS.md` disagrees. Regenerate with `dotnet run --project build/facts -- .`.

This is the one step **not** guarded on the `code` flag, and the comment (`ci.yml:98-99`) explains why:
`FACTS.md` is itself markdown, so a docs-only PR is exactly the kind of change that can make it drift.
The gate has to run precisely when everything else is skipped.

[Rubric §26, Documentation & Knowledge Management] is served here in the only way that survives contact
with time: the numbers other documents are told to link rather than restate are themselves machine-checked
against the code.

**Step 4, Restore** (`ci.yml:102-104`):

```bash
dotnet restore MMCA.Common.slnx
```

MMCA.Common uses NuGet lock files (`RestorePackagesWithLockFile`) and pins `packageSourceMapping` to
nuget.org only, no `GITHUB_TOKEN` is needed to restore. This is explicitly documented in
`MMCA.Common/CLAUDE.md` ("building/testing Common needs NO GitHub token"). The lock file makes the
restore reproducible: the exact dependency graph is committed and any unexpected transitive upgrade fails
the restore.

[Rubric §32, Dependency & Supply-Chain] assesses whether package sources are pinned, audited, and
supply-chain risks are visible. The pinned source mapping plus committed lock files are the §32
implementation: a compromised or mutated transitive package cannot silently enter the build.

**Step 5, Build in Release mode** (`ci.yml:106-108`):

```bash
dotnet build MMCA.Common.slnx -c Release --no-restore
```

Building in `Release` mode matters because the five analyzers (Meziantou, SonarAnalyzer, StyleCop,
Roslynator, Microsoft.VisualStudio.Threading) run at error severity. Some analyzer rules only trigger
in Release (e.g. certain null-forgiving suppression patterns). `TreatWarningsAsErrors` is globally
enabled; a single analyzer finding fails the build. The `--no-restore` flag re-uses the locked packages
from Step 4.

[Rubric §15, Best Practices & Code Quality] (quality enforcement via analyzers at error severity) is
realized here: the build *is* the static-analysis gate.

**Step 6, Vulnerability audit** (`ci.yml:110-129`):

```bash
dotnet list MMCA.Common.slnx package --vulnerable --include-transitive > audit.log 2>&1 || true
cat audit.log
suppressed=$(grep -E '<NuGetAuditSuppress\b' Directory.Build.props | grep -oE 'GHSA-[a-z0-9-]+' | sort -u | paste -sd'|' -)
vulns=$(grep -E '^[[:space:]]*>[[:space:]]' audit.log || true)
# drop any vulnerable-package row whose advisory is in the suppressed list, then fail on the rest
if printf '%s' "$vulns" | grep -q .; then
  echo "::error::Non-suppressed vulnerable NuGet packages detected, see log above"; exit 1
fi
```

`dotnet list package --vulnerable` queries NuGet's vulnerability database for every direct and transitive
dependency and writes any hits to `audit.log`. The `|| true` prevents an API-call failure from masking the
parse. The gate is not a simple sentinel grep: because `dotnet list --vulnerable` ignores
`NuGetAuditSuppress`, the step honors the same accepted-advisory list itself, it extracts every suppressed
`GHSA-...` id from `Directory.Build.props` (the single source of truth), filters those advisories out of
the vulnerable-package rows (the `>`-prefixed lines), and fails only if a *non-suppressed* vulnerable row
remains (e.g. the unpatched SQLite advisory is an accepted exception).

Note how narrowly the extraction is scoped (`ci.yml:118-120`): it greps `<NuGetAuditSuppress` lines
specifically, not the whole file, so a GHSA id merely *mentioned in a comment* about a non-accepted
advisory cannot silently suppress it here. A looser grep would have turned prose into policy.

Why this gate exists and why it comes *before* tests: a vulnerable dependency that reaches the published
packages is a supply-chain liability for every downstream consumer. Catching it before the release
workflow runs (and before the package is published) is cheaper than retracting a published version.

[Rubric §32, Dependency & Supply-Chain] is directly served by this step. [Rubric §11, Security]
(assesses whether secrets, auth, and dependency security are properly managed) is also touched: the
vulnerability audit ensures the framework's own dependencies do not carry known CVEs.

**Steps 7 and 8, Test with coverage and the discovery-regression floor** (`ci.yml:131-144`):

```bash
dotnet tool install --global dotnet-coverage
dotnet-coverage collect -f cobertura -o coverage.unit.cobertura.xml \
  "dotnet test --solution MMCA.Common.slnx -c Release --no-build --minimum-expected-tests 2000"
```

The test run is wrapped in `dotnet-coverage collect` (installed in the step before), which emits a
cobertura report and returns the inner test command's exit code, so a test failure still gates the build,
coverage itself is report-only (the `coverage` job below consumes it).

`--minimum-expected-tests 2000` is the load-bearing number. It is a Microsoft Testing Platform (MTP) flag
that fails the run when fewer than N tests are discovered, and the floor sits just under the real suite
size of roughly 2,254 (`ci.yml:141-142`). A floor of 1 would only catch a project that discovered nothing
at all; a floor near the true count catches the far more common and far more dangerous failure, a
discovery or filter regression that silently drops thousands of tests and reports green with a handful
run. The solution test suite covers the per-layer projects (`Shared.Tests`, `Domain.Tests`,
`Application.Tests`, `Infrastructure.Tests`, `API.Tests`, `Grpc.Tests`, `UI.Tests`, `Aspire.Tests`) plus
`Architecture.Tests` (NetArchTest layer/purity/extraction fitness functions, see
[the doubled architecture-enforcement / fitness functions](00-primer.md#architecture-enforcement-is-doubled-fitness-functions-rubric-34-3)).

[Rubric §14, Testability & Test Strategy] assesses whether tests actually run and cover the system. The
`--minimum-expected-tests` floor is a mechanical enforcement of §14: you cannot merge a change that
quietly stops running the suite.

The unit-tier cobertura report is uploaded as the `coverage-unit` artifact (`ci.yml:146-152`) for the
`coverage` job to merge and gate on, under `if: always()` so a failing run still yields its partial
coverage data.

### Job: `build-maui`, the one package Ubuntu cannot compile

`MMCA.Common.UI.Maui` multi-targets net10.0-android/ios/maccatalyst/windows, which needs the MAUI
workloads, which Ubuntu runners do not have. So it stays **out of `MMCA.Common.slnx`** and builds in its
own `windows-latest` job (`ci.yml:160-221`), the same mechanism that keeps the gallery and UI E2E projects
out of the fast unit run ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
It is a required merge gate alongside `build-and-test`.

There are no tests here, and the comment says why (`ci.yml:158-159`): the capability contracts and their
browser fallbacks are covered in `MMCA.Common.UI.Tests` on ubuntu, while the MAUI implementations are thin
Essentials wrappers exercised on-device. A test that only proves a wrapper forwards a call is not worth a
windows runner.

The job is the **critical path of the whole CI run** (measured at 7.1 to 8.2 minutes, and the only windows
runner), which is why two steps exist purely to make it cheaper. `Resolve SDK version and root`
(`ci.yml:188-198`) computes a cache key from the resolved SDK version, deriving the SDK root from `dotnet`
itself rather than trusting `$DOTNET_ROOT` to be exported, since an empty value there would silently turn
the cache paths into garbage and miss forever. `Cache MAUI workload packs` (`ci.yml:200-211`) then carries
the `sdk-manifests`, `packs`, `metadata`, `library-packs`, and `template-packs` directories between runs,
keyed so that an SDK feature-band bump busts it.

`dotnet workload install maui` still runs on a cache hit (`ci.yml:213-217`), deliberately: it is a no-op
that reconciles the manifest, and it is the only thing that lets a partially-restored cache self-heal
instead of failing the build underneath it.

### Job: `ui-e2e`, accessibility and render-smoke gate

This job (`ci.yml:228-322`) runs in parallel with `build-and-test`, on its own `ubuntu-latest` runner,
with a 20-minute timeout (`ci.yml:232`). It is a **cross-browser matrix** over `chromium`, `firefox`, and
`webkit` (`ci.yml:233-237`) with `fail-fast: false`, so one engine's failure does not cancel the others.

**All three engines are required merge gates.** The matrix was introduced with the non-chromium legs
non-blocking, then promoted as each proved itself: firefox on 2026-07-12 after a clean observed streak,
webkit on 2026-07-16 after 11 consecutive green runs since its last flake (`ci.yml:238-240`). There is no
`continue-on-error` in this job today. A webkit red blocks the merge like any other check.

Its purpose is to catch two failure classes the unit-test job cannot: WCAG 2.1 AA accessibility violations
in the shared Blazor UI components, and rendering regressions (a component that compiles but throws during
render).

**Why a separate job?** The gallery host (`Tests/Presentation/MMCA.Common.UI.Gallery`) and the E2E test
project (`Tests/Presentation/MMCA.Common.UI.E2E.Tests`) are **intentionally excluded from
`MMCA.Common.slnx`** (`ci.yml:223-227` comment). Playwright requires a full browser install (several
hundred megabytes) and a browser-capable runner config. Including these in `dotnet test --solution` would
slow every CI run for every code change, most of which do not touch the UI. Keeping the E2E gate separate
means the unit/arch job stays fast while accessibility remains enforced.

**Step-by-step:**

1. **Checkout** (`ci.yml:242-244`): `fetch-depth: 0` (the comment notes "MinVer needs full history"), same
   as `build-and-test`.

2. **Build the E2E project directly** (`ci.yml:260-264`):
   ```bash
   dotnet build Tests/Presentation/MMCA.Common.UI.E2E.Tests/MMCA.Common.UI.E2E.Tests.csproj -c Release
   ```
   Building by csproj path, not solution, ensures only the gallery and E2E graphs are compiled (restore
   included). The E2E project references MMCA.Common source projects directly (via project references, not
   NuGet packages), so no `GITHUB_TOKEN` is needed.

3. **Cache and install Playwright for the matrix browser** (`ci.yml:269-287`):
   ```bash
   script=$(find Tests/Presentation/MMCA.Common.UI.E2E.Tests/bin/Release -name playwright.ps1 | head -1)
   if [ "${{ steps.playwright-cache.outputs.cache-hit }}" = "true" ]; then
     pwsh "$script" install-deps ${{ matrix.browser }}
   else
     pwsh "$script" install --with-deps ${{ matrix.browser }}
   fi
   ```
   Browser binaries run 100 to 300 MB per engine and were re-downloaded on all three legs of every run,
   which is what the workflow-level `PLAYWRIGHT_BROWSERS_PATH` and this cache step (`ci.yml:269-275`)
   exist to stop. The cache key includes the engine, since each leg installs only its own.

   The install branches on the cache hit, and the distinction is the useful part: OS-level shared
   libraries and fonts live outside the cached directory, so a restored cache still needs `install-deps`,
   the cheap half of `--with-deps`. Skipping it entirely on a hit would produce a browser that cannot
   launch. The `playwright.ps1` script is emitted into the build output by the Playwright MSBuild
   integration; `find` locates it dynamically so the step does not hard-code a .NET version suffix.

4. **Run the E2E suite** (`ci.yml:289-306`): the chromium leg installs `dotnet-coverage`
   (`ci.yml:289-291`) and wraps the run in `dotnet-coverage collect`; the firefox and webkit legs run the
   same command plain (`eval "$CMD"`). The inner command is:
   ```yaml
   env:
     E2E_HEADLESS: "true"
     E2E_BROWSER: ${{ matrix.browser }}
   run: dotnet test --project Tests/Presentation/MMCA.Common.UI.E2E.Tests/MMCA.Common.UI.E2E.Tests.csproj -c Release --no-build -- --minimum-expected-tests 1
   ```
   `E2E_HEADLESS: true` runs the browser without a display server (no Xvfb needed). `E2E_BROWSER` selects
   the engine; `MMCA.Common.Testing.E2E`'s `PlaywrightFixture` reads this env var. The
   `-- --minimum-expected-tests 1` suffix is the MTP filter separator, the same class of guard as in
   `build-and-test` though at a floor of 1 rather than 2000.

   The suite self-hosts the gallery (`MMCA.Common.UI.Gallery`) in-process, then scans the Login and
   Register pages plus a primitives showcase with **axe-core** (via `Deque.AxeCore.Playwright`) at
   WCAG 2.1 AA conformance level. Any failing violation causes a test failure, which fails the job.

   [Rubric §21, Accessibility (a11y)] (assesses whether the UI is programmatically tested against a
   standard like WCAG 2.1 AA) is enforced here. [Rubric §28, Front-End Testing & Quality] (assesses
   whether browser-level tests catch rendering and functional regressions) is also embodied: the render
   smoke confirms that the real component tree renders without exceptions in a real browser context.

5. **Upload coverage and Playwright traces**, the chromium leg uploads its E2E cobertura report as the
   `coverage-e2e` artifact (`ci.yml:308-314`), and on failure each leg uploads its traces
   (`ci.yml:316-322`):
   ```yaml
   if: failure()
   uses: actions/upload-artifact@v7
   with:
     name: ui-e2e-traces-${{ matrix.browser }}
     path: Tests/Presentation/MMCA.Common.UI.E2E.Tests/bin/Release/net10.0/playwright-traces/**
     if-no-files-found: ignore
   ```
   Playwright traces (HAR + screenshots + video) are produced only on failure and uploaded as a
   per-browser GitHub artifact. `if-no-files-found: ignore` prevents the upload step from failing if no
   trace was recorded (e.g. the failure occurred before any browser interaction). This is a
   developer-experience detail: without traces, diagnosing a flaky E2E failure in CI requires reproducing
   it locally.

   [Rubric §33, Developer Experience & Inner Loop] (assesses whether CI gives developers actionable
   feedback fast) is served: the trace artifact turns an opaque CI failure into a reproducible debugging
   session.

### Job: `performance-smoke`, benchmarks plus a committed baseline

This job (`ci.yml:330-369`) runs the BenchmarkDotNet harness and then compares the results against a
committed baseline, which makes it two gates in one.

The run itself (`ci.yml:354-360`) uses `--filter "*"` and `--job Short`:

```bash
dotnet run -c Release --project Tests/Performance/MMCA.Common.Benchmarks --no-launch-profile -- --filter "*" --job Short --exporters json
```

`--filter "*"` selects every benchmark non-interactively, and without it BenchmarkDotNet prompts for a
selection and hangs in CI. `--job Short` (3 warmup + 3 iterations) produces real measurements in under a
minute instead of a full multi-iteration timing run. `--no-launch-profile` keeps it deterministic on
hosted runners.

Then `build/perfgate` (`ci.yml:362-369`) compares the exported results against
`Tests/Performance/perf-baseline.json` and fails on any violation. The baseline holds two kinds of
assertion, and the difference matters: deterministic **allocation ceilings** (byte counts, which are
stable across machines) and machine-independent **ratio floors**, such as the compiled-expression
specification cache staying at least 1000x ahead of the recompile anti-pattern. Wall-clock times are not
asserted, because a shared hosted runner cannot deliver them reproducibly. Moving a number deliberately
means updating the baseline file in the same PR.

[Rubric §12, Performance & Scalability] is served in the only form CI can honestly provide: not "is it
fast" but "did the property that makes it fast stop holding".

### Job: `coverage`, merge report and coverage floor

This job (`ci.yml:374-431`) runs after both test jobs (`needs: [changes, build-and-test, ui-e2e]`, `if:
always()`). It downloads the `coverage-*` artifacts, merges the unit/architecture/bUnit and E2E cobertura
tiers with ReportGenerator (`+MMCA.*;-*.Tests`, generated `*.generated.cs`/`*.g.cs` filtered out), and
publishes the summary to the run's Step Summary (`ci.yml:391-404`).

It then **enforces a coverage floor** (`ci.yml:420-431`) as a regression backstop: the *unit tier alone*
(not the gallery-diluted merged report) must stay at **68.3% line coverage or better** with generated code
excluded, and only when `build-and-test` succeeded, so that an upstream failure does not add a confusing
secondary coverage failure.

Two decisions are encoded in that number. Generated code is excluded because source generators (for
example Microsoft.AspNetCore.OpenApi) emit large uncovered files that otherwise tank the figure: 45.3% raw
versus 61.9% hand-written, measured 2026-06-19. And the floor sits about 2 points below the 70.3% measured
after the July 2026 coverage program (session auth, broker bus, Grpc/OAuth/JWKS, UI services), leaving
just enough slack to avoid false reds while still catching a real regression. It is meant to be ratcheted
up as coverage grows.

[Rubric §14, Testability & Test Strategy] is served: the coverage floor is a mechanical regression
backstop on top of the `--minimum-expected-tests` guard.

### The three canaries, and why a framework needs them

The remaining jobs all exist for the same reason: **a green solution build does not prove the framework
works for anyone who is not the framework.**

**`consumer-source-build`** (`ci.yml:441-490`) is a cross-repo pre-merge canary. It checks out
MMCA.Helpdesk as a sibling directory (`ci.yml:453-462`) and builds and tests it against *this PR's*
framework source, so a breaking public-API change fails here rather than surfacing after a release and a
lockstep sweep. Helpdesk is the ideal canary precisely because it is minimal: a single-module app that
needs no database and no GitHub Packages token, shipping a committed `local.props` that swaps the
`MMCA.Common.*` `PackageReference`s for `ProjectReference`s into `../MMCA.Common/Source`. The sibling
checkout layout is what makes that relative path resolve to the PR's own checkout. Its test step
(`ci.yml:485-490`) carries the same discovery floor idea as `build-and-test`, set to 40 against a suite of
about 44. Promoted to a required gate on 2026-07-16 after 9 consecutive green runs.

**`package-consumption`** (`ci.yml:502-585`) closes the gap that the previous job cannot: source-mode
builds bind `ProjectReference`s, so pack breaks (NU5xxx) and package-mode-only restore, analyzer, and
reference failures stay invisible to them. The comment records that this failure mode shipped **twice**
before the job existed. So this job packs every slnx package into a local folder feed (`ci.yml:528-530`),
then scaffolds a throwaway consumer (`ci.yml:532-580`) whose `nuget.config` maps `MMCA.Common.*` to that
feed and everything else to nuget.org, and builds it.

The throwaway consumer lives in `RUNNER_TEMP`, **outside the repo checkout**, and that placement is the
whole point: inside the checkout it would inherit `Directory.Build.props` and `Directory.Packages.props`
and stop resembling a real downstream app. It references the meta set (`API` + `Infrastructure` +
`Testing.Architecture`) to pull the full package graph transitively, and compiles one smoke type against
`Result` to prove the references actually bind rather than merely resolve.

**`sample-deployment-validate`** (`ci.yml:593-607`) type-checks the `samples/deployment` Bicep templates
with `az bicep build`, no cloud credentials required. A library cannot deploy itself, so this IaC/OIDC
reference is documentation that would otherwise rot unobserved; compiling it on every PR keeps it honest.
A real what-if or deploy stays a consumer-side concern, since ADC's and Store's `deploy.yml` are the
production-proven versions.

### Job: `redis-integration`

The last job (`ci.yml:609-645`) runs `MMCA.Common.Infrastructure.Redis.Tests` against a real Redis via
Testcontainers, which Ubuntu runners support with no extra setup since they ship a Docker daemon. Like the
E2E and benchmark projects it lives outside `MMCA.Common.slnx` so the fast solution-wide unit loop never
requires Docker, and is therefore built and run by path.

The comment (`ci.yml:614-618`) states the falsifiability argument better than a summary can:
`DistributedCacheService` is the one place where the **storage format** matters, and a
`Mock<IDistributedCache>` cannot express it. Redis keys are typed, so a counter written as a string and
read back as a hash round-trips perfectly against a mock and answers `WRONGTYPE` against a server. A test
that cannot fail against a mock is not a test of the thing you care about.

Its heavy step is code-guarded like every other job (`ci.yml:638-642`) so a docs-only PR does not pull a
Redis image, while the job itself still runs and posts its context green, keeping it safe to add to branch
protection.

---

## MMCA.Common, `release.yml`

**File:** `MMCA.Common/.github/workflows/release.yml`

### What it is

The lockstep NuGet release workflow. When a maintainer pushes a `vX.Y.Z` git tag, this workflow
deterministically derives the version, packs all fifteen packages, generates a CycloneDX SBOM (a hard
gate), and pushes to **both** GitHub Packages and nuget.org (ADR-053). Fifteen packages. One tag. One
version. Every time.

The fifteen are packed by two jobs, not one: the ubuntu `publish` job packs the fourteen projects that
sit in `MMCA.Common.slnx`, and a second `publish-maui` job on windows packs `MMCA.Common.UI.Maui` from
the same tag, because its four MAUI target frameworks need workloads that Ubuntu runners do not carry
(**[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)**). Both jobs
derive their version from the same tag, so the lockstep release stays whole.

### Why lockstep matters

MMCA.Common's fifteen packages form a coherent framework layer. A consumer's `Directory.Packages.props`
references all fifteen at the same version number. If they could release independently, a consumer bumping
only some of them would import incompatible API surfaces, for example, an `Application` handler
interface that references a `Shared` type that was renamed in `Shared` v2 but not yet reflected in the
old `Application` v1. Lockstep eliminates this class of dependency mismatch entirely. This policy is
**[ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html)** (lockstep versioning + the MassTransit-v8 pin), documented in the [versioning policy](https://ivanball.github.io/docs/guides/common-VERSIONING.html)
and in `MMCA.Common/CLAUDE.md` ("consumers bump every entry together in their `Directory.Packages.props`,
no phased rollout"), and enforced as a build gate (`DependencyVersionTests` fails the build if
MassTransit's major reaches 9).

[Rubric §32, Dependency & Supply-Chain] is embodied: the lockstep mechanism means a consumer's
`Directory.Packages.props` is the single source of truth for which generation of the framework is in use,
with no possibility of a half-upgraded state. (The fifteen are the four core, `.Shared`, `.Domain`,
`.Application`, `.Infrastructure`; five presentation, `.API`, `.Grpc`, `.UI`, `.UI.Web`, `.UI.Maui`;
two Aspire, `.Aspire`, `.Aspire.Hosting`; and four testing, `.Testing`, `.Testing.E2E`, `.Testing.UI`,
`.Testing.Architecture`.)

[Rubric §17, DevOps & Deployment] is embodied: releasing is a tag-driven, automated, reproducible action
with no manual steps after the tag is pushed.

### Trigger

```yaml
# release.yml:3-5
on:
  push:
    tags: ['v*']
```

Any tag matching `v*` (e.g. `v1.52.0`) triggers the workflow. There is no branch condition, releases
can be cut from any state of the repository that has a valid tag. In practice, releases are always cut
from `main`.

### Job: `publish`

**Permissions** (`release.yml:13-16`):
```yaml
permissions:
  packages: write
  contents: read
  id-token: write # OIDC token for nuget.org trusted publishing (ADR-053)
```

`packages: write` is required to push to GitHub Packages using `GITHUB_TOKEN`. `contents: read` is the
minimum for checkout. `id-token: write` lets the job mint an OIDC token, which is what it trades for a
short-lived nuget.org key in step 11. No other permissions are granted, least-privilege OAuth scope for
the token.

[Rubric §11, Security] (assesses secrets, OIDC, and minimal-permission token usage) is served: the job
token only has write access to Packages, not to repo contents, issues, or deployments, and the public
registry is reached with no stored API key at all.

**Step 1, Checkout with full history** (`release.yml:18-20`): `fetch-depth: 0` for MinVer, same as CI.

**Step 2, .NET 10 setup** (`release.yml:22-31`): same as CI, including the NuGet cache keyed on the
committed lock files plus `Directory.Packages.props`.

**Step 3, Restore** (`release.yml:33-34`): `dotnet restore MMCA.Common.slnx`, lock files apply; no
`GITHUB_TOKEN` needed.

**Step 4, Determine version from tag** (`release.yml:36-38`):
```bash
echo "VERSION=${GITHUB_REF_NAME#v}" >> $GITHUB_OUTPUT
```
`GITHUB_REF_NAME` is the full tag name (e.g. `v1.52.0`). The `#v` parameter expansion strips the leading
`v`, yielding `1.52.0`. This string is then passed to the build and pack steps as an explicit version
override.

**Step 5, Build with explicit version** (`release.yml:40-41`):
```bash
dotnet build MMCA.Common.slnx -c Release --no-restore -p:MinVerSkip=true -p:Version=${{ steps.version.outputs.VERSION }}
```
`-p:MinVerSkip=true` disables MinVer's git-tag-based version derivation and `-p:Version=...` injects the
tag-derived version directly. This pattern avoids a subtle race: if MinVer ran here, it would derive the
version from the tag, which should be the same value, but in edge cases (e.g. detached HEAD, retagged
commit) the two sources could diverge. Making the version explicit from the start removes the ambiguity.

**Step 6, Test** (`release.yml:43-44`):
```bash
dotnet test --solution MMCA.Common.slnx -c Release --no-build
```
Tests run again (no `--minimum-expected-tests 1` here, the release workflow is not the primary test
gate; CI already covered this). This is a belt-and-suspenders pass to ensure the tagged commit is green
before packaging.

**Step 7, Pack** (`release.yml:46-47`):
```bash
dotnet pack MMCA.Common.slnx -c Release --no-build -o ./nupkgs -p:MinVerSkip=true -p:PackageVersion=${{ steps.version.outputs.VERSION }}
```
`dotnet pack` over the entire solution packs the fourteen packable projects it contains (`Source/**`) in
one command. `-p:PackageVersion` sets the NuGet package version metadata. `-o ./nupkgs` collects all
`.nupkg` files in one directory for the push step. The fourteen packages produced here all share the same
version string. The fifteenth, `MMCA.Common.UI.Maui`, is not in the solution and is packed by the
`publish-maui` windows job into its own `./nupkgs-maui` directory from the same tag (ADR-042).

**Steps 8 and 9, SBOM generation and upload** (`release.yml:53-65`):
```yaml
- name: Generate SBOM (CycloneDX)
  run: |
    dotnet tool install --global CycloneDX
    dotnet CycloneDX MMCA.Common.slnx --output ./sbom --json
    ls -la ./sbom
    test -n "$(ls -A ./sbom 2>/dev/null)" || { echo "::error::SBOM generation produced no output"; exit 1; }
- name: Upload SBOM
  uses: actions/upload-artifact@v7
  with:
    name: sbom
    path: ./sbom
    if-no-files-found: error
```
CycloneDX generates a Software Bill of Materials, a machine-readable inventory of every dependency's
identity, version, and license. The SBOM is now a **hard gate** (the comment on `release.yml:49-52` records
that it "was continue-on-error while the tooling was being validated in CI, now promoted to a blocking
step"): a failed generation, an *empty* `./sbom` directory, or a missing artifact (`if-no-files-found:
error`) fails the release. Every published version must ship a verifiable SBOM.

[Rubric §30, Compliance, Privacy & Data Governance] (assesses whether supply-chain and licensing
obligations are tracked) is served: the SBOM is the machine-readable artifact that fulfills the
"know your dependencies" requirement for regulated or commercially-distributed software, and gating on it
guarantees no version ships without one.

**Step 10, Push to GitHub Packages** (`release.yml:67-68`):
```bash
dotnet nuget push ./nupkgs/*.nupkg \
  --source "https://nuget.pkg.github.com/ivanball/index.json" \
  --api-key ${{ secrets.GITHUB_TOKEN }} \
  --skip-duplicate
```
`--skip-duplicate` means an accidental re-push of an already-published version does not fail the
workflow, it silently skips duplicates. This is important because `dotnet nuget push ./nupkgs/*.nupkg`
expands the glob before the push, and if the fourteen packages happen to be in non-alphabetical order, a
partial push followed by a retry would otherwise fail on already-uploaded packages.

`GITHUB_TOKEN` is automatically provided by GitHub Actions when `packages: write` is in the job
permissions. No external secret is needed.

**Steps 11 and 12, Push to nuget.org via trusted publishing** (`release.yml:79-88`):
```yaml
- name: NuGet login (OIDC to short-lived key)
  if: github.repository_owner == 'ivanball'
  uses: NuGet/login@v1
  id: nuget-login
  with:
    user: ivanball # nuget.org profile name, not an email; public, so not a secret
- name: Push to nuget.org
  if: github.repository_owner == 'ivanball'
  run: dotnet nuget push ./nupkgs/*.nupkg --source "https://api.nuget.org/v3/index.json" --api-key ${{ steps.nuget-login.outputs.NUGET_API_KEY }} --skip-duplicate
```
Every release goes to **both** registries
(**[ADR-053](https://ivanball.github.io/docs/adr/053-dual-registry-package-publishing.html)**). The reason
is install friction: GitHub Packages' NuGet registry demands a PAT with `read:packages` even for public
packages, so a stranger following the README could not restore. nuget.org is the public install path;
GitHub Packages remains the internal one.

The interesting part is the auth. There is **no stored API key**: `NuGet/login` exchanges the job's OIDC
token for a key that lives one hour, so there is no long-lived secret to leak or rotate. The exchange is
governed by a policy on nuget.org pinned to this owner, this repository, and **this workflow file** by
their permanent GitHub ids, which is why `release.yml` cannot be renamed without breaking publishing, and
why a fork cannot publish. The key is requested immediately before the push because it is single-use and
short-lived. The `if: github.repository_owner == 'ivanball'` guard keeps a fork's release run from
failing on an exchange it can never satisfy.

[Rubric §11, Security] again: this is the strongest form of the "no long-lived credentials in CI"
property, since there is no secret to steal even momentarily.

### Job: `publish-maui`

A second job on `windows-latest` (`release.yml:93-165`) packs the fifteenth package,
`MMCA.Common.UI.Maui`, which multi-targets net10.0-android/ios/maccatalyst/windows and therefore cannot
build on the ubuntu runner at all (ADR-042). It installs the MAUI workload, derives the version from the
same tag, builds and packs by csproj path into `./nupkgs-maui`, applies the same SBOM hard gate scoped to
that one project, and pushes to both registries. Because both jobs key off `GITHUB_REF_NAME`, the two
runners produce the same version string and lockstep survives the split.

Two details are load-bearing. The nuget.org trusted-publishing policy is keyed on the workflow **file**,
so one policy covers both jobs, but each job needs its own `id-token: write` and its own exchange: a
short-lived key is single-use and cannot cross a job boundary. And every `dotnet nuget push` step here
sets `shell: bash` (`release.yml:148`, `release.yml:164`), because the windows-default PowerShell passes
`*.nupkg` through unexpanded and the push then fails with "File does not exist" on the un-globbed pattern.

The cost of the split is release surface: two runners must both succeed for a release to be whole.

---

## MMCA.ADC, `deploy.yml`

**File:** `MMCA.ADC/.github/workflows/deploy.yml`

### What it is

The primary CI/CD pipeline for the Atlanta Developers Conference application. It runs on every push to
`main`, on every pull request targeting `main`, and on manual `workflow_dispatch`. On a push to `main` (or
dispatch) it also deploys to Azure; on a pull request it only runs the build and test jobs as a merge gate.

### Triggers and concurrency

```yaml
# deploy.yml:3-8
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
```

```yaml
# deploy.yml:23-26
concurrency:
  group: prod-azure
  cancel-in-progress: false
```

The `prod-azure` concurrency group serializes all production Azure mutations. `cancel-in-progress: false`
means a second push to `main` while a deploy is in flight does not cancel the running deploy, it waits.
This is deliberately conservative: an in-flight deploy that gets cancelled mid-Bicep-apply or mid-
migration can leave the environment in a partially-updated state. The one-time `cutover-per-service-dbs.yml`
workflow shares the same group (`cutover-per-service-dbs.yml:38-39`) for the same reason: a standard push
cannot roll container-app revisions while the cutover is migrating data.

[Rubric §29, Resilience, Reliability & Business Continuity] (assesses whether the system has deployment
patterns that protect against partial-update failures) is served by the non-cancellable concurrency
group: it is a mechanical guarantee that two competing mutations cannot interleave.

**Permissions** (`deploy.yml:16-19`):
```yaml
permissions:
  id-token: write
  contents: read
  packages: read
```
`id-token: write` enables OIDC-based Azure login (no long-lived credential stored as a secret). The Azure
login step (`azure/login@v3`) exchanges the OIDC token for a scoped Azure access token at runtime. No
static client secret is ever stored in GitHub. `packages: read` is needed for `GITHUB_TOKEN`-authenticated
NuGet restore of the MMCA.Common packages.

[Rubric §11, Security] is embodied: OIDC federated identity eliminates the secret-rotation burden and
the credential-leak surface area of a static client secret. The federated credential is scoped to the
`production` environment, so only runs that target that environment can obtain the Azure token.

### Job: `build-and-test`

**Step 1, Restore** (`deploy.yml:40-42`):
```yaml
- name: Restore dependencies
  run: dotnet restore MMCA.ADC.CI.slnf
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
`MMCA.ADC.CI.slnf` is the CI solution filter, it excludes the MAUI UI project (whose `maui-android`
workload is not on Ubuntu runners), the AppHost (Aspire orchestration), and the integration and E2E test
projects. The filter gives a fast, reliable build without requiring workloads beyond the standard .NET SDK.
`GITHUB_TOKEN` is passed as an env var so the NuGet credential provider can authenticate to GitHub
Packages and pull the fifteen MMCA.Common packages.

**Step 2, Build** (`deploy.yml:44-45`): `dotnet build MMCA.ADC.CI.slnf --no-restore -c Release`, same
TreatWarningsAsErrors + five-analyzer enforcement as Common.

**Step 3, Unit and architecture tests with coverage** (`deploy.yml:47-65`):
```bash
dotnet tool install --global dotnet-coverage
dotnet-coverage collect -f cobertura -o coverage.unit.cobertura.xml \
  "dotnet test --solution MMCA.ADC.CI.slnf --no-build -c Release --minimum-expected-tests 1"
```
As in Common's CI, the run is wrapped in `dotnet-coverage collect` (it returns the inner exit code so a
failure still gates) and uploaded as the `coverage-unit` artifact (`deploy.yml:59-65`) for the report-only
`coverage` job. Same `--minimum-expected-tests 1` guard. Covers unit tests for all module layers plus
`Architecture.Tests` (NetArchTest fitness functions, layer flow, domain purity, module isolation).

[Rubric §14, Testability & Test Strategy] is served: architecture tests enforce that the modular
structure is not accidentally violated by a new project reference (e.g. `Domain` referencing
`Infrastructure`).

**Step 4, EF migrations model-drift gate** (`deploy.yml:70-83`):
```bash
for module in Identity Conference Engagement Notification; do
  project="Source/Hosting/MMCA.ADC.Migrations.SqlServer.$module"
  dotnet ef migrations has-pending-model-changes \
    --project "$project" --startup-project "$project" \
    --context SQLServerDbContext --configuration Release --no-build
done
```
`dotnet ef migrations has-pending-model-changes` compares the EF design-time model to the committed
migration snapshot **without connecting to a database**. If a developer changes an entity configuration
(adds a column, renames a property) but forgets to author a new migration, this step fails the build. The
comment on `deploy.yml:70-74` states the rationale: "a drift here means the deploy's idempotent migration
script would not capture the schema change."

This is one of the most important gates in the pipeline. An entity model that diverges from the migration
history means the production schema diverges from the application's EF model, a runtime crash on first
query of the changed entity. The gate catches it at build time, before any container image is pushed. It
is doubly important now that `deploy.yml` has *no* sqlcmd migration step: this build-time gate is the
guarantee that the services' startup `Migrate()` always has a migration to apply for every model change.

The `--no-build` flag reuses the Release build from Step 2, so there is no rebuild overhead. `dotnet-ef`
is installed globally (version `10.0.8`) in the step before this one (`deploy.yml:67-68`).

[Rubric §8, Data Architecture] (assesses whether schema management is automated, versioned, and safe)
is directly served. [Rubric §17, DevOps & Deployment] is served: the migration gate is the CI
enforcement of the "migrations-before-code" discipline.

### Job: `supply-chain`

This job runs in parallel with `build-and-test` on every push and PR. It is non-gating (`continue-on-
error: true` on every step), it produces artifacts, not failures.

**What it produces** (`deploy.yml:104-129`):
- `supply-chain/deprecated.txt`, packages that NuGet marks as deprecated (i.e. the publisher has
  flagged them as obsolete or replaced).
- `supply-chain/vulnerable.txt`, packages with known CVEs (same data as the `build-and-test` audit
  in Common's CI, but here it is an artifact rather than a gate, the gate is NuGetAudit during
  `dotnet restore` in the build step).
- `supply-chain/adc-sbom.json`, CycloneDX SBOM for the ADC dependency graph.
- `supply-chain/licenses.json`, license metadata for every transitive package (via `nuget-license`).

The comment on `deploy.yml:85-88` explains the design: "Non-gating (the vulnerability GATE is NuGetAudit
during restore in build-and-test / the Docker builds); these steps add the bill-of-materials and
license/deprecation reports NuGetAudit does not produce."

[Rubric §32, Dependency & Supply-Chain] is served: the SBOM and license report are the artifact tier of
supply-chain hygiene. [Rubric §30, Compliance, Privacy & Data Governance] is touched: the license report
is the mechanism for discovering GPL or AGPL dependencies that would create licensing obligations.

### Job: `integration-tests`

This job is a required dependency of `deploy` (`deploy.yml:244`):
```yaml
needs: [build-and-test, integration-tests]
```
It runs the per-service `WebApplicationFactory` integration tests against a real SQL Server service
container, covering approximately 290 tests across Identity, Conference, and Engagement. It gates every
production deploy.

**SQL Server service container** (`deploy.yml:139-147`):
```yaml
services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server:2022-latest
    env:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: "Adc_Integration!Test1"
      MSSQL_PID: Developer
    ports:
      - 1433:1433
```
An ephemeral SQL Server Developer Edition container starts alongside the job. The password is hardcoded
(`deploy.yml:138`, `deploy.yml:144`) because it is a throwaway SA credential for an ephemeral container,
not a production secret, not stored in GitHub Secrets. The comment on `deploy.yml:136` states this
explicitly: "Throwaway SA password, not a secret."

**Wait-for-SQL-Server gate** (`deploy.yml:161-172`): A 30-iteration poll loop (5-second sleep each)
using `sqlcmd` to execute `SELECT 1`. SQL Server takes 10–20 seconds to initialize in a fresh container;
proceeding immediately would cause the restore or build to fail with a connection error. The loop exits
early on success, not after the full 150-second maximum.

**Integration test run** (`deploy.yml:185-191`): like the unit tier, the test command is wrapped in
`dotnet-coverage collect` (emitting the `coverage.integration.cobertura.xml` artifact):
```yaml
env:
  ADC_TEST_SQL_BASE: "Server=localhost,1433;User Id=sa;Password=${{ env.MSSQL_SA_PASSWORD }};TrustServerCertificate=True;Encrypt=False;"
run: dotnet test --solution MMCA.ADC.Integration.slnf --no-build -c Release --minimum-expected-tests 1
```
The `ADC_TEST_SQL_BASE` connection string is consumed by `IntegrationTestBase` to provision per-test
databases (each test gets a fresh database, reset between tests). `MMCA.ADC.Integration.slnf` is a
separate solution filter that includes only the integration test projects; the build step immediately
before (`deploy.yml:179-180`) targets this filter.

[Rubric §14, Testability & Test Strategy] is served at a higher tier than the unit tests: these tests
exercise real EF migrations, real HTTP middleware, real domain logic through a real SQL Server engine. A
bug that only manifests under an actual database connection (e.g. a LINQ translation error, a migration
column type mismatch) is caught here before it reaches production.

### Job: `deploy`

Runs only on push to `main` or `workflow_dispatch` (never on pull requests):

```yaml
# deploy.yml:247
if: github.event_name != 'pull_request'
```

**Phase 1, Azure login and foundation infrastructure** (`deploy.yml:257-271`):
```yaml
- name: Log in to Azure
  uses: azure/login@v3
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Deploy foundation infrastructure
  uses: azure/arm-deploy@v2
  with:
    resourceGroupName: ${{ env.AZURE_RESOURCE_GROUP }}
    template: infra/foundation.bicep
    parameters: environmentName=${{ env.ENVIRONMENT_NAME }}
```
`foundation.bicep` provisions the two durable resources needed before container images can be pushed:
Azure Container Registry (ACR) and Log Analytics Workspace. These resources must exist before Docker
pushes can succeed, so they are deployed first in their own Bicep step. The outputs of this step
(`acrName`, `acrLoginServer`, `logAnalyticsName`) are consumed by every subsequent step.

**Phase 2, Container image builds and pushes** (`deploy.yml:274-329`):

After `az acr login` (`deploy.yml:274-275`), six images are built and pushed: Gateway, UI, Conference,
Identity, Engagement, Notification. Each is its own step but they follow the same pattern (the four
back-end services live under `Source/Services/`, while the Gateway and UI Dockerfiles live under
`Source/Hosts/`, e.g. Gateway is `Source/Hosts/MMCA.ADC.Gateway/Dockerfile` at `deploy.yml:279` and UI is
`Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile` at `deploy.yml:288`):
```bash
docker build -f <Dockerfile path> \
  --build-arg GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }} \
  -t ${{ steps.foundation.outputs.acrLoginServer }}/mmca-adc-{service}:${{ github.sha }} \
  -t ${{ steps.foundation.outputs.acrLoginServer }}/mmca-adc-{service}:latest \
  .
docker push ${{ steps.foundation.outputs.acrLoginServer }}/mmca-adc-{service} --all-tags
```
`--build-arg GITHUB_TOKEN` passes the token into the Docker build context so the Dockerfile's
`dotnet restore` step can pull MMCA.Common packages from GitHub Packages. Images are tagged with both
`${{ github.sha }}` (the exact commit hash, immutable, traceable) and `latest` (for convenience in
manual operations). The SHA-tagged image is what the Bicep deploy uses; `latest` is a reference only.

[Rubric §17, DevOps & Deployment] is served: each image is uniquely identified by the commit SHA,
making every deployment fully traceable to its source code.

**Phase 3, Deployment parameters file** (`deploy.yml:334-447`):

Rather than passing `key=value` pairs inline to `arm-deploy`, the step builds a JSON parameters file
from scratch using `jq` (there is no committed parameters template, see the IaC chapter's note that
`infra/main.parameters.json` does not exist). The `jq --arg` flag properly JSON-escapes multiline values (critical for the RSA PEM keys,
which contain newlines). Optional parameters (RSA keys, OAuth credentials, Anthropic API key, SMTP
config, alert email) are conditionally appended only if their env vars are non-empty:

```bash
if [ -n "$RSA_PRIVATE_KEY" ] && [ -n "$RSA_PUBLIC_KEY" ]; then
  jq --arg k "$RSA_PRIVATE_KEY" '.parameters.rsaPrivateKeyPem = {"value": $k}' ...
fi
```

This pattern means the deployment is not blocked if an optional secret has not been configured, it
simply omits that parameter, and the Bicep template's `@secure()` `param` falls back to its default
(typically an empty string, which disables the feature). For example, if `JWT_RSA_PRIVATE_KEY_PEM` is
not set, the Identity service falls back to HS256 signing.

There is an important SQL location note in the Bicep parameters step (`deploy.yml:353-358`): Azure SQL
is region-gated on the QiMata Sponsorship subscription, `eastus2` (where `acc-rg` lives) does not
allow `Microsoft.Sql`, so SQL Server and databases are deployed to `westus2` while Container Apps remain
in the RG's location. The `SQL_LOCATION="${SQL_LOCATION_OVERRIDE:-westus2}"` line defaults to `westus2`
but honors the `AZURE_SQL_LOCATION` repo variable (passed in as `SQL_LOCATION_OVERRIDE` at `deploy.yml:337`)
so a different subscription or region can override it.

**Phase 3 (continued), Application infrastructure** (`deploy.yml:449-455`):

```yaml
- name: Deploy application infrastructure
  id: deploy
  uses: azure/arm-deploy@v2
  with:
    template: infra/main.bicep
    parameters: /tmp/deploy-params.json
```

`main.bicep` provisions the Container Apps Environment, six Container Apps (one per service + Gateway +
UI), Azure Service Bus (Standard tier, with Manage rights for MassTransit topology), Azure SQL Server
and four per-service databases, App Insights, SLO alerts, and the monthly cost budget. (See the IaC
chapter for the full resource inventory, note Redis is *not* provisioned by `main.bicep`.) The
`environmentName=prod` parameter selects the environment-specific naming convention.

**Phase 4, Database migrations: there is no sqlcmd backstop** (`deploy.yml:457-467`):

Phase 4 is a comment block, not a step. The deploy **deliberately does not run an external `sqlcmd`
migration step**. Each service self-applies its own migrations at startup
(`ApplicationSettings__DatabaseInitStrategy=Migrate`) as the **sole migrator**, and `minReplicas: 1`
guarantees exactly one replica migrates before the revision serves. The comment (`deploy.yml:458-467`)
records *why* the previous backstop was removed: a `sqlcmd` step here would race the container's startup
`Migrate()` on a fresh per-service DB, both applying the same `InitialCreate` concurrently and
non-atomically, leaving a table created **without** its `__EFMigrationsHistory` row (Msg 2714 "object
already exists" on every retry, exactly what wedged MMCA.Store's first per-service deploy). The
build-and-test model-drift gate still guarantees a migration exists for every model change, so removing
the backstop does not weaken the schema-safety story.

[Rubric §8, Data Architecture] and [Rubric §17, DevOps & Deployment] are both served here: per-service,
single-applier, idempotent-by-construction migration is the data-architecture discipline made operational
without a racing dual-applier.

**Phase 5, Post-deploy smoke gate with automatic rollback** (`deploy.yml:469-531`):

The smoke test probes three endpoints after the new revision is active:
```bash
probe() {
  for i in $(seq 1 12); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo 000)
    [ "$code" = "200" ] && return 0
    sleep 10
  done
  return 1
}

probe "https://${GATEWAY_FQDN}/health"
probe "https://${GATEWAY_FQDN}/.well-known/jwks.json"
probe "https://${UI_FQDN}/"
```

Each probe polls up to 12 times (10-second intervals, 15-second curl timeout), two minutes total per
endpoint. The three probes together exercise: Container Apps routing (Gateway health), cross-service
dependency (JWKS endpoint exercises Identity, which must have reached its database and loaded its RSA
keys), and the Blazor UI host.

The comment on `deploy.yml:470-473` explains why JWKS is the key probe: "a backend-through-gateway path
(JWKS exercises Identity, this is what catches a service that deployed but can't reach its secrets/DB)."

If any probe fails, the rollback path (`deploy.yml:518-530`) activates:
```bash
for app in $APPS; do
  prev=$(az containerapp revision list ... --query "reverse(sort_by(...))[1].name" ...)
  az containerapp revision copy -g "$RG" -n "$app" --from-revision "$prev"
done
exit 1
```
Every Container App is rolled back to its previous (provisioned) revision by copying it. The rollback is
best-effort (individual rollback failures are logged but do not prevent other apps from rolling back), and
the job exits with code 1 so the failure is visible in the GitHub workflow run.

There is also an informational security-headers check (`deploy.yml:504-511`, labeled TD-09) that confirms
the Gateway emits `X-Content-Type-Options: nosniff`. This check is explicitly non-gating (it cannot trip
the rollback) because a missing header is a hardening gap, not a "revision not serving" condition.

[Rubric §29, Resilience, Reliability & Business Continuity] is directly embodied: the smoke gate with
automatic rollback means a broken deploy is both detected and partially self-corrected within minutes.
[Rubric §13, Observability & Operability] (assesses whether failures surface actionable signals) is
served: the workflow fails loudly with the specific failing endpoint printed, and the rollback log names
each app and its rollback revision.

---

## MMCA.ADC, `e2e.yml`

**File:** `MMCA.ADC/.github/workflows/e2e.yml`

### What it is

The full-stack Playwright E2E test workflow. It brings up the complete Aspire stack (SQL Server + Redis +
RabbitMQ + four services + Gateway + UI) inside the CI runner, then runs the Playwright suite against it
across a `chromium`/`firefox`/`webkit` matrix.

[Rubric §28, Front-End Testing & Quality] (assesses whether browser-level tests cover real user
journeys in a production-like environment) is the primary category this workflow serves.

### Trigger, `workflow_dispatch` + nightly, not yet a merge gate

```yaml
# e2e.yml:26-30
on:
  workflow_dispatch:
  schedule:
    # Nightly ~07:00 UTC so cold-start/cross-browser flakiness surfaces on a cadence, off the deploy path.
    - cron: "0 7 * * *"
```

It runs on manual dispatch **and** nightly (`cron: "0 7 * * *"`). The workflow header comment
(`e2e.yml:3-24`) explains that it is "Still NOT a push/PR gate: bringing up SQL + Redis + RabbitMQ + 4
services + Gateway + UI in CI is being hardened via scheduled runs first. Once it's reliably green across
engines, promote it to a merge gate." This is honest operational practice: a flaky E2E gate is worse than
no gate because developers start ignoring it. The nightly cadence surfaces cold-start/cross-browser
flakiness without blocking the delivery pipeline.

The engine comes from the **job matrix** (`e2e.yml:56-57`), not a workflow input, `chromium` is the
canonical engine and `firefox`/`webkit` are advisory (`continue-on-error: ${{ matrix.browser != 'chromium'
}}`, `e2e.yml:59`). `E2E_BROWSER` is set from `matrix.browser` and consumed by
`MMCA.Common.Testing.E2E`'s `PlaywrightFixture`.

### Job: `e2e` (50-minute timeout, cross-browser matrix)

The 50-minute timeout (`e2e.yml:52`) reflects the cumulative startup time of the Aspire stack: SQL Server
container initialization (~15–20s), broker startup, all four services booting and running their
`DatabaseInitStrategy=Migrate` initialization, the per-service readiness gate, the warm-up pass, and actual
test execution. The timeout must be generous enough that a slow runner does not fail a legitimate green
run. The matrix is `fail-fast: false` so one engine's flake does not cancel the others.

**Step 1, Trust the dev HTTPS certificate** (`e2e.yml:68-69`):
```bash
dotnet dev-certs https --trust || dotnet dev-certs https
```
The `--trust` flag only succeeds on a runner that supports certificate trust stores (Linux runners may
not). The `|| dotnet dev-certs https` fallback generates the certificate without trusting it. Playwright
probes use `-k` (skip verification) for the HTTPS UI endpoint, so the certificate does not need to be
trusted for the test suite, the certificate only needs to exist so the Aspire AppHost can bind to HTTPS.

**Step 2, Build** (`e2e.yml:71-79`):
```bash
dotnet build Source/Hosting/MMCA.ADC.AppHost -c Release
dotnet build Tests/E2E/MMCA.ADC.E2E.Tests -c Release
```
Both project graphs are built directly (not via the `.slnx`) to avoid pulling in the MAUI UI project,
which requires a `maui-android` workload not available on standard Ubuntu runners (`e2e.yml:72-74`
comment). `GITHUB_TOKEN` is passed for NuGet restore of MMCA.Common packages.

**Step 3, Install Playwright browsers** (`e2e.yml:81-84`):
Same `find ... playwright.ps1` pattern as `MMCA.Common/ci.yml`'s `ui-e2e` job, with the matrix browser
engine.

**Step 4, Start the Aspire stack** (`e2e.yml:86-98`):
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out artifacts/jwt-priv.pem
openssl rsa -pubout -in artifacts/jwt-priv.pem -out artifacts/jwt-pub.pem
export E2E_JWT_PRIVATE_KEY_PEM="$(cat artifacts/jwt-priv.pem)"
export E2E_JWT_PUBLIC_KEY_PEM="$(cat artifacts/jwt-pub.pem)"
nohup dotnet run --project Source/Hosting/MMCA.ADC.AppHost -c Release --no-build \
  > artifacts/apphost.log 2>&1 &
echo "APPHOST_PID=$!" >> "$GITHUB_ENV"
rm -f artifacts/jwt-priv.pem artifacts/jwt-pub.pem
```
An ephemeral RSA keypair is generated at CI startup and exported as env vars. The AppHost forwards these
to the Identity service, which needs an RSA key to sign RS256 tokens. Without this, Identity would fall
back to HS256 (or refuse to start if configured to require RS256). The private key file is deleted
immediately after being read into the env var, it is never written to an artifact or log.

The AppHost runs in the background (`nohup ... &`). Its PID is saved to `$GITHUB_ENV` so the "Stop Aspire
stack" step can kill it at the end. The stdout/stderr stream goes to `artifacts/apphost.log` so any
startup failure is visible in the uploaded artifact.

[Rubric §11, Security] is served: the ephemeral keypair is generated fresh per run (no long-lived key
material in secrets), and the private key file is deleted before any subsequent step runs.

**Step 5, Wait for the stack (per-service readiness gate)** (`e2e.yml:100-123`):
```bash
ready() {
  ui=$(curl -k -s -o /dev/null -w '%{http_code}' --max-time 10 "$UI_URL/health")
  id=$(curl -k -s -o /dev/null -w '%{http_code}' --max-time 10 "$GATEWAY_URL/.well-known/jwks.json")
  conf=$(curl -k -s -o /dev/null -w '%{http_code}' --max-time 20 "$GATEWAY_URL/Events")
  [ "$ui" = "200" ] && [ "$id" = "200" ] && [ "$conf" = "200" ]
}
for i in $(seq 1 90); do
  if ready; then echo "stack ready after ~${i}0s"; exit 0; fi
  sleep 10
done
```
This is **not** just a UI-health poll: it gates on *every* service the suite depends on, each probed
through the Gateway on an anonymous endpoint so a 200 means the service is up *and* its EF model + SQL pool
are built, UI `/health` (the Blazor host), `/.well-known/jwks.json` (Identity, the login path), and
`/Events` (Conference, the data path). 90 iterations × 10 seconds = up to 15 minutes. A half-warm backend
is exactly what produced the historical login/data-page timeouts, so the suite does not start until all
three are green (`UI_URL`/`GATEWAY_URL` are pinned to `https://localhost:6002`/`6001` in the workflow env).

**Step 6, Warm up services incl. the login path** (`e2e.yml:125-167`): a best-effort step (never fails
the job) that JITs each service's hot path before the timed suite, two passes over the anonymous
Conference endpoints plus a **real admin login POST** to `/Auth/login` that exercises Identity's
DB user-lookup + password-hash verify + RS256 signing (the dominant cold-start login-timeout culprit a
UI-only warm-up never touched), and a prerender warm-up of the UI host's `/`, `/login`, `/register`.

**Step 7, Run E2E tests** (`e2e.yml:169-197`):
```yaml
env:
  E2E_BASE_URL: ${{ env.UI_URL }}
  E2E_HEADLESS: "true"
  E2E_BROWSER: ${{ matrix.browser }}
  E2E_TIMEOUT: "45000"
  E2E_AUTH_TIMEOUT: "60000"
run: >-
  dotnet test --project Tests/E2E/MMCA.ADC.E2E.Tests/MMCA.ADC.E2E.Tests.csproj
  -c Release --no-build
  --retry-failed-tests 2 --retry-failed-tests-max-percentage 40
```
`E2E_BASE_URL` points the Playwright tests at the live Aspire-hosted UI. `E2E_TIMEOUT: 45000` (raised from
20000) absorbs residual first-navigation cold-start latency on a 2-core runner, and `E2E_AUTH_TIMEOUT:
60000` gives the auth round-trip its own headroom. `--retry-failed-tests 2
--retry-failed-tests-max-percentage 40` (MTP's retry extension) re-runs only the failed tests up to twice,
but skips retry when >40% of tests fail (a real breakage, not a contention spike). No coverage is collected
here because the app runs out-of-process (the in-process integration tier in `deploy.yml` is the backend
coverage signal).

**Steps 8–10, Collect logs, stop stack, upload diagnostics** (`e2e.yml:198-224`): on `always()` the job
collects each service's Serilog file into `artifacts/service-logs`, kills the AppHost, and uploads the
per-browser `e2e-diagnostics-${{ matrix.browser }}` artifact (AppHost log + service logs + probe capture)
so startup failures (where no tests ran at all) still produce a diagnostic artifact.

[Rubric §33, Developer Experience & Inner Loop] is served: the diagnostics upload makes CI failures
diagnosable without local reproduction of the full Aspire stack.

---

## MMCA.ADC, `cost-guard.yml`

**File:** `MMCA.ADC/.github/workflows/cost-guard.yml`

### What it is

A scheduled, read-only FinOps check that confirms the production Azure footprint is at its cost baseline.
It detects a specific operational anti-pattern: a conference-day surge scale-up (SQL tier upgrade + higher
Container App replica caps) that was never reverted after the event.

[Rubric §31, Cost Efficiency / FinOps] (assesses whether cloud resource costs are governed and
optimized, with visibility into spend) is the primary category this workflow serves. The workflow
header comment (`cost-guard.yml:3-8`) states its purpose precisely: "a scheduled, READ-ONLY check that
the production footprint is still at its cost baseline... It complements the cost budget in main.bicep
(which alerts on $ spend) by flagging the *configuration* drift directly."

### Why this workflow exists

Conference-day surges are deliberate: SQL tier is upgraded from Basic to S4, Container App replica caps
are increased from 2 to 8. After the event, both must be reverted manually (or by re-running `deploy.yml`).
There is no automated revert, reverting automatically would require knowing when the conference is over,
which is operational context the CI system does not have. Instead, the cost-guard detects the failure to
revert and produces a GitHub workflow failure (which notifies via GitHub) every Monday until it is fixed.

The 2026 conference-day memory (`project_adc_2026_actual_load.md`) records that the surge was
over-provisioned relative to actual load. The cost-guard exists in part because the cost of a forgotten
surge is non-trivial: SQL Server Standard S4 costs roughly 60× more per DTU than Basic tier.

### Triggers

```yaml
# cost-guard.yml:10-13
on:
  schedule:
    - cron: "0 7 * * 1" # Mondays 07:00 UTC
  workflow_dispatch:
```

Weekly on Monday mornings (UTC), early in the work week so a drift is noticed promptly, with time to
investigate before the next week. `workflow_dispatch` allows a manual run at any time (e.g. to verify
that a revert applied correctly).

### Job: `surge-drift`

**Environment: `production`** (`cost-guard.yml:27`): this scopes the OIDC token to the same federated
credential as `deploy.yml`, giving the read-only Azure CLI calls access to the production resource group
without a separate credential.

**Step, Check replica caps and SQL tiers** (`cost-guard.yml:36-82`):

```bash
BASELINE_MAX_REPLICAS: "2"   # cost-guard.yml:21

for app in $(az containerapp list -g "$rg" --query "[?starts_with(name, 'adc-')].name" -o tsv); do
  max=$(az containerapp show ... --query "properties.template.scale.maxReplicas" -o tsv)
  if [ "${max:-0}" -gt "$BASELINE_MAX_REPLICAS" ]; then status="⚠️ DRIFT"; drift=1; fi
done

for server in $(az sql server list ...); do
  for db in $(az sql db list ...); do
    tier=$(az sql db show ... --query "sku.tier" -o tsv)
    if [ "$tier" != "Basic" ]; then status="⚠️ DRIFT"; drift=1; fi
  done
done

if [ "$drift" -ne 0 ]; then
  echo "❌ Surge drift detected, ... Reset to baseline ..."
  exit 1
fi
```

The baseline is defined directly in the workflow file:
- `BASELINE_MAX_REPLICAS: "2"`, maximum replicas per Container App at rest.
- SQL tier must be `"Basic"`, the lowest Azure SQL tier, sufficient for ADC's off-conference workload
  and priced at a few dollars per month.

Every `adc-*` Container App and every `adc-*` SQL server/database in the resource group is checked. The
results are written to the GitHub Step Summary as a Markdown table, so the check result is visible in the
GitHub Actions UI without opening the logs.

The workflow **never mutates anything**, it is read-only. On drift it fails and prints instructions
(`cost-guard.yml:78`), but it does not attempt to downscale automatically. The operator must choose how
to revert (typically by re-running `deploy.yml`, which re-applies the Bicep baseline).

[Rubric §31, Cost Efficiency / FinOps] is directly embodied. [Rubric §34, Architecture Governance &
Documentation] (assesses whether operational decisions are recorded and enforced) is also served: the
cost guard is the enforcement mechanism for the "revert after event" policy, governance made executable.

---

## MMCA.ADC, `load-test.yml`

**File:** `MMCA.ADC/.github/workflows/load-test.yml`

### What it is

A k6 load test targeting the output-cached Conference read endpoints through the production Gateway. It
establishes a repeatable performance baseline and alerts on threshold breaches via GitHub workflow failure.

[Rubric §12, Performance & Scalability] (assesses whether the system has been load-tested and has
defined capacity thresholds) is the primary category served. The workflow header comment (`load-test.yml:3-7`)
describes it as "a repeatable k6 load test against the public, output-cached Conference read endpoints
through the Gateway. Read-only and safe against prod."

### Why only the Conference read endpoints?

The Conference module's read endpoints (events, sessions, speakers, rooms, categories) are output-cached
with 5-minute TTL and tag-based invalidation. They are the highest-traffic paths under conference-day
load, and they are read-only (safe to hammer in production). The Engagement write endpoints (bookmarks)
and Identity endpoints (auth) have different performance profiles and carry real-write risk, they are
not targeted by this load test.

### Triggers

```yaml
# load-test.yml:8-18
on:
  workflow_dispatch:
    inputs:
      peak_vus:
        description: "Peak concurrent virtual users"
        default: "67" # observed 2026 conference-day peak
      base_url:
        description: "Target base URL (blank = discover the prod Gateway)"
        default: ""
  schedule:
    - cron: "0 6 1 * *" # 06:00 UTC, 1st of each month (off-peak)
```

The default `peak_vus: "67"` is explicitly annotated as "observed 2026 conference-day peak", the actual
measured concurrent-user count from the 2026 conference (recorded in `project_adc_2026_actual_load.md`).
This makes the load test meaningful rather than arbitrary: it verifies that the system can handle *what it
actually handled* in production.

The monthly schedule runs at 06:00 UTC on the 1st, off-peak, minimizing interference with real users.

### Job: `k6`

**Environment: `production`** (`load-test.yml:31`): OIDC-scoped to the production federated credential
so the Azure CLI step can discover the Gateway FQDN from the resource group.

**Step, Resolve target URL** (`load-test.yml:42-55`):
```bash
url="${{ inputs.base_url }}"
if [ -z "$url" ]; then
  fqdn=$(az containerapp list -g "$AZURE_RESOURCE_GROUP" \
    --query "[?contains(name, 'gateway')].properties.configuration.ingress.fqdn | [0]" -o tsv)
  url="https://$fqdn"
fi
echo "url=$url" >> "$GITHUB_OUTPUT"
```
If `base_url` is blank (the normal case), the step queries Azure for the Gateway's FQDN dynamically.
This means the load test does not need to be updated when the resource group or environment name changes,
it discovers the target at runtime. An explicit `base_url` input allows targeting a non-production
environment (e.g. a staging slot) without modifying the workflow.

**Step, Run k6** (`load-test.yml:57-63`):
```bash
docker run --rm -i \
  -e BASE_URL='${{ steps.target.outputs.url }}' \
  -e PEAK_VUS='${{ inputs.peak_vus || '40' }}' \
  -v "$PWD/Tests/Load/k6:/scripts" \
  grafana/k6 run /scripts/conference-read-load.js
```
k6 runs in Docker (`grafana/k6` image), with the k6 script directory mounted as a volume. `PEAK_VUS` and
`BASE_URL` are passed as environment variables into the k6 runtime. The k6 script is at
`Tests/Load/k6/conference-read-load.js`. Note: the content of the k6 script (thresholds, ramping
profile, endpoint list) is not determinable from the workflow file alone, it lives in the script.

The `|| '40'` fallback in `PEAK_VUS` (`load-test.yml:61`) is a safety net: if the scheduled run (which
has no `inputs.peak_vus` value because inputs are only set on `workflow_dispatch`) reaches this
expression, it defaults to 40 VUs rather than empty, which k6 would interpret as 0.

[Rubric §12, Performance & Scalability] is served: the load test documents the observed conference-day
peak as the benchmark VU count and verifies the system can sustain it within the defined thresholds.
[Rubric §29, Resilience, Reliability & Business Continuity] is also touched: a load test that catches
a threshold regression before the next conference is a proactive resilience measure.

---

## MMCA.ADC, `cutover-per-service-dbs.yml`

**File:** `MMCA.ADC/.github/workflows/cutover-per-service-dbs.yml`

### What it is

A one-time, manually-triggered workflow that migrated the four empty per-service databases
(`ADC_Identity`, `ADC_Conference`, `ADC_Engagement`, `ADC_Notification`) and copied the legacy
`AtlDevCon` data into them, enacting [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (database-per-service) in production.

The workflow header (`cutover-per-service-dbs.yml:3-14`) states its scope: "ONE-TIME, manually-triggered
workflow... Run this AFTER commit 1 is deployed and BEFORE commit 2 (the container-app flip) is merged."

### Why this workflow exists, the [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) context

Before [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), all four ADC services shared a single `AtlDevCon` database and a single `OutboxMessages`
table. Every service's `OutboxProcessor` polled the same table with no origin filter, they raced to
claim each other's outbox rows. [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (2026-06-07) adopted database-per-service to eliminate this race
and give each service its own schema evolution path. The cutover workflow enacted that decision in
production by:

1. Creating the four per-service databases (via `main.bicep`).
2. Applying each database's migration baseline (its full schema history).
3. Copying the relevant data from `AtlDevCon` into the correct per-service database.
4. Leaving `AtlDevCon` completely untouched as a read-only archive and rollback path.

[Rubric §8, Data Architecture] (assesses schema management, migration safety, and data-migration
strategy) is embodied: the cutover is a phased, gated, non-destructive migration with explicit outbox-
drain and deployment-state pre-conditions.

[Rubric §17, DevOps & Deployment] is served: the cutover is an automated, auditable, idempotent workflow
rather than a manual script run ad-hoc.

### Trigger, manual with required confirmation

```yaml
# cutover-per-service-dbs.yml:17-25
on:
  workflow_dispatch:
    inputs:
      confirm:
        description: 'Type "cutover" to confirm the one-time production data migration'
        required: true
      freeze_traffic:
        description: 'Disable gateway ingress during the copy (recommended)'
        type: boolean
        default: false
```

The `confirm` input requires the operator to type the exact word `"cutover"`, the first step validates
this (`cutover-per-service-dbs.yml:48-53`):
```bash
if [ "${{ inputs.confirm }}" != "cutover" ]; then
  echo "::error::Confirmation input must be exactly 'cutover'."
  exit 1
fi
```
This guard prevents accidental triggering, a workflow_dispatch from a mobile device or a mis-click
without typing the confirmation string will fail immediately before any Azure operation. This is a UX
safety mechanism borrowed from runbook practice.

The optional `freeze_traffic` boolean (`cutover-per-service-dbs.yml:22-25`, default `false`) controls
whether the Gateway's ingress is disabled during the data copy to eliminate the drift window (new writes
arriving during the copy that would not be captured). The `Re-enable gateway ingress` step
(`cutover-per-service-dbs.yml:168-172`) runs on `if: ${{ always() && inputs.freeze_traffic }}`, the
`always()` guard ensures that a step failure after the freeze but before the re-enable does not leave the
Gateway permanently down.

### Concurrency: shares `prod-azure` group

```yaml
# cutover-per-service-dbs.yml:37-39
concurrency:
  group: prod-azure
  cancel-in-progress: false
```

The cutover shares the same group as `deploy.yml` (`deploy.yml:24`). This ensures that if a push to
`main` triggers a deploy while the cutover is running (or vice versa), they do not interleave. A standard
deploy rolling new container-app revisions while the cutover is copying data would be catastrophic,
services pointing at both the old and new databases simultaneously.

### Job: `cutover`, step-by-step

**GATE 1, Assert the app is still on AtlDevCon** (`cutover-per-service-dbs.yml:69-81`):
```bash
N=$(az containerapp show -n adc-prod-identity -g "$AZURE_RESOURCE_GROUP" \
  --query "length(properties.template.containers[0].env[?name=='DataSources__Identity__SQLServerConnectionString'])" -o tsv)
if [ "$N" != "0" ]; then
  echo "::error::adc-prod-identity already carries per-service DB config, commit 2 deployed before the cutover ran."
  exit 1
fi
```
This gate checks whether `adc-prod-identity` already has the per-service database connection string in
its environment. If it does, "commit 2" (the container-app flip) has already been deployed, meaning the
services have already auto-migrated and seeded the per-service databases, running the copy on top would
silently skip already-seeded tables (the copy script uses skip-if-nonempty logic). The gate prevents a
re-run from corrupting freshly-seeded production data.

**Discover SQL server FQDN** (`cutover-per-service-dbs.yml:83-90`): Queries Azure for the first SQL
server whose name starts with `adc-prod-sql-`, the naming convention established by `main.bicep`. The
FQDN is stored as a step output and reused in all subsequent SQL-targeting steps.

**Freeze gateway traffic (optional)** (`cutover-per-service-dbs.yml:99-101`):
```bash
if: ${{ inputs.freeze_traffic }}
run: az containerapp ingress disable -n adc-prod-gateway -g "$AZURE_RESOURCE_GROUP"
```
Disabling the Gateway ingress stops new user traffic from reaching the services during the copy window.
New writes during the copy would be captured in `AtlDevCon`'s outbox but not in the per-service
databases (which are the copy targets). The freeze eliminates this window. The tradeoff is a brief user-
visible outage; the operator chooses based on the data's staleness tolerance.

**GATE 2, Outbox drain gate** (`cutover-per-service-dbs.yml:102-117`):
```bash
PENDING=$(sqlcmd -S ... -d AtlDevCon ... -Q "SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.OutboxMessages WHERE ProcessedOn IS NULL;")
if [ "$PENDING" != "0" ]; then
  echo "::error::AtlDevCon outbox not drained ($PENDING unprocessed rows)."
  exit 1
fi
```
The outbox gate runs *after* the optional freeze, so no new rows can appear while the count is being
read. An unprocessed outbox row represents a domain event that has not been delivered, if the data copy
ran with pending outbox rows, the integration events for those rows would be delivered after the cutover
and might update rows in `AtlDevCon` (which is the source) rather than in the per-service databases (the
new targets). The gate ensures all in-flight events are settled before the copy begins.

[Rubric §29, Resilience, Reliability & Business Continuity] is served: the outbox drain gate ensures
consistency at the migration boundary. An undrained outbox means the data snapshot is not quiescent.

**Generate per-service migration scripts** (`cutover-per-service-dbs.yml:119-135`):
A `dotnet ef migrations script --idempotent` per module for each of the four per-module migration
projects, producing `/tmp/migrations-${MODULE}.sql`. (`deploy.yml` no longer runs migrations at all, each
service self-applies at startup, so this is the only workflow that generates and applies migration scripts
via `sqlcmd`, and only for this one-time cutover.) `GITHUB_TOKEN` authenticates NuGet restore of the
MMCA.Common.Infrastructure package, which the migration projects depend on.

**Apply migrations to the four databases** (`cutover-per-service-dbs.yml:137-146`): Each `ADC_${MODULE}`
database receives its full schema via the idempotent migration script applied with `sqlcmd`.

**Copy AtlDevCon data** (`cutover-per-service-dbs.yml:148-162`):
```powershell
./scripts/copy-atldevcon-to-per-service-dbs.azure.ps1 `
  -ServerFqdn $env:SQL_SERVER `
  -AdminUser adcadmin `
  -AdminPassword $env:SQL_PASSWORD `
  -VerifyCounts
```
The PowerShell script (not included in this workflow's file, it is in `scripts/`) uses `SqlBulkCopy`
(via the `SqlServer` PowerShell module, installed in the preceding step) to transfer data table-by-table
from `AtlDevCon` into the four per-service databases. `-VerifyCounts` asserts row counts match between
source and target after the copy. `AtlDevCon` is never modified, it is read-only throughout.

**Re-enable gateway ingress** (`cutover-per-service-dbs.yml:164-172`):
```yaml
if: ${{ always() && inputs.freeze_traffic }}
run: az containerapp ingress enable -n adc-prod-gateway -g "$AZURE_RESOURCE_GROUP" --type external --target-port 8080 --transport http
```
`always()` ensures the Gateway is re-enabled even if a later step failed, so the site is never left in
a permanently-disabled state. The explicit `--type external --target-port 8080 --transport http` args
are required because `az containerapp ingress enable` does not accept a bare `enable` without specifying
the ingress configuration.

[Rubric §8, Data Architecture] and [Rubric §29, Resilience, Reliability & Business Continuity] are
both embodied: the two-gate (deployment-state + outbox-drain) precondition sequence, the traffic freeze
option, the non-destructive read-only copy, the row-count verification, and the always-run re-enable all
contribute to a migration pattern that minimizes data loss risk and recovery time.

---

## Cross-workflow summary

| Workflow | Trigger | Gates production | Mutates Azure |
|---|---|---|---|
| `MMCA.Common/ci.yml` | PR → main (no push trigger) | No (framework gate) | No |
| `MMCA.Common/release.yml` | `v*` tag | No (publish gate) | No (GitHub Packages + nuget.org) |
| `MMCA.ADC/deploy.yml` | push → main / dispatch | Yes | Yes |
| `MMCA.ADC/e2e.yml` | nightly 07:00 UTC / dispatch | No (pending promotion) | No |
| `MMCA.ADC/cost-guard.yml` | Monday 07:00 UTC / dispatch | No | No (read-only) |
| `MMCA.ADC/load-test.yml` | monthly / dispatch | No | No (read-only) |
| `MMCA.ADC/dr-drill.yml` | dispatch | No | No (restores a throwaway copy, then deletes it) |
| `MMCA.ADC/cutover-per-service-dbs.yml` | dispatch (one-time) | N/A (complete) | Yes (one-time) |

(`dr-drill.yml` is the [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) §29 restore drill: it PITR-restores a *copy* of a chosen database, times the
restore for the RTO record, verifies it comes back Online, then deletes the copy, the live databases are
never touched. It is not given its own section above, but it is part of the workflow set.)

The Azure-mutating workflows (`deploy.yml`, `cutover-per-service-dbs.yml`) share the `prod-azure`
concurrency group with `cancel-in-progress: false`, ensuring the two cannot interleave. All Azure access
uses OIDC federated identity (no static client secrets). The `.slnf`/`.slnx` test runs pass
`--minimum-expected-tests` to prevent empty or silently-truncated test suites from passing: ADC's runs
floor at 1, while MMCA.Common's `build-and-test` floors at 2000 against a suite of roughly 2,254, so a
discovery regression that drops thousands of tests fails instead of reporting green.

---

## Rubric category index for this chapter

| Category | Where primarily embodied |
|---|---|
| §8 Data Architecture | `deploy.yml` build-time EF model-drift gate (migrations applied by services at startup, not by `deploy.yml`); `cutover-per-service-dbs.yml` gates |
| §11 Security | OIDC in `deploy.yml`/`load-test.yml`/`cost-guard.yml`/`cutover`; ephemeral RSA key in `e2e.yml`; least-privilege tokens in `release.yml` |
| §12 Performance & Scalability | `load-test.yml` k6 baseline at observed peak VUs |
| §13 Observability & Operability | Smoke-gate failure output and rollback log in `deploy.yml`; AppHost log artifact in `e2e.yml` |
| §14 Testability & Test Strategy | `--minimum-expected-tests` floors in all test steps (2000 for MMCA.Common's suite, 1 for ADC's); the 68.3% unit coverage floor in `ci.yml` `coverage`; integration tests gate `deploy`; architecture fitness functions in `build-and-test` |
| §17 DevOps & Deployment | The full workflow set collectively; SHA-tagged images; phased Bicep deploy; smoke+rollback |
| §21 Accessibility | `ci.yml` `ui-e2e` axe-core WCAG 2.1 AA gate on every MMCA.Common pull request, across all three browser engines |
| §28 Front-End Testing & Quality | `ci.yml` `ui-e2e` render smoke; `e2e.yml` full Playwright suite |
| §29 Resilience & Business Continuity | `prod-azure` concurrency group; smoke+rollback in `deploy.yml`; outbox drain gate in `cutover`; `dr-drill.yml` PITR restore drill ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) objectives) |
| §30 Compliance & Privacy | SBOM generation in `release.yml` and `deploy.yml`; license report in `deploy.yml` supply-chain job |
| §31 Cost / FinOps | `cost-guard.yml` surge-drift detection and Monday notifications |
| §32 Dependency & Supply-Chain | Lock files + source mapping in MMCA.Common; vulnerability audit in `ci.yml`; SBOM artifacts |
| §33 Developer Experience | Playwright trace upload on failure in `ci.yml`; AppHost log in `e2e.yml`; step summaries in `cost-guard.yml` |
| §34 Architecture Governance | `cost-guard.yml` as executable governance for the surge-revert policy; concurrency group as deployment-ordering governance |
