# CI/CD and Operations

This chapter walks the GitHub Actions workflows that govern MMCA, from the framework's continuous
integration and lockstep NuGet release in `MMCA.Common`, through the ADC application's build/test/deploy
pipeline, end-to-end Playwright testing, cost-guard automation, performance load testing, and the
repository-automation workflows (the Claude review pair and the weekly MAUI dependency audit). (Two
further ADC workflows, `dr-drill.yml` and the weekday-nightly `cross-service-tests.yml`, are covered in
the cross-workflow summary at the end rather than given their own sections.) For each workflow you
will learn the triggers, the job/step sequence with file-and-line citations, and, critically, *why* each
gate exists and what would break without it. Rubric categories are tagged inline so you can connect each
pipeline decision to its architecture-quality axis. Cross-links to the primer and other tier chapters are
included throughout.

---

## MMCA.Common, `ci.yml`

**File:** `MMCA.Common/.github/workflows/ci.yml`

### What it is

The continuous-integration workflow for the MMCA.Common framework. Because the published packages
(the authoritative id list and count live in [`MMCA.Common/FACTS.md`](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md))
are consumed by every downstream application, a regression here propagates to both `MMCA.ADC` and
`MMCA.Store`. The workflow runs **ten jobs**: a `changes` classifier that every other job keys off
(`ci.yml:36`), a fast `build-and-test` covering unit and architecture tests with coverage collection
(`ci.yml:72`), a windows `build-maui` for the one package that cannot compile on Ubuntu
(`ci.yml:160`), a `ui-e2e` cross-browser matrix for real-browser accessibility and render-smoke testing
(`ci.yml:228`), a `performance-smoke` benchmark gate (`ci.yml:332`), a `coverage` job that merges the
coverage tiers and enforces a floor (`ci.yml:376`), and three canaries that catch failure modes the
solution build cannot see: `consumer-source-build` (`ci.yml:446`), `package-consumption`
(`ci.yml:634`), and `sample-deployment-validate` (`ci.yml:725`), plus `redis-integration`
(`ci.yml:741`) for the one component whose storage format only a real server can falsify.

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
`Application.Tests`, `Infrastructure.Tests`, `API.Tests`, `Grpc.Tests`, `UI.Tests`, `UI.Web.Tests`,
`Aspire.Tests`, `Aspire.Hosting.Tests`, `Gateway.Tests`, `Testing.Tests`, plus the
`Infrastructure.Tests.MigrationsFixture` helper project, `MMCA.Common.slnx:33-49`) plus
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

This job (`ci.yml:332-371`) runs the BenchmarkDotNet harness and then compares the results against a
committed baseline, which makes it two gates in one. Its context, `Performance gate (BenchmarkDotNet
Short + baseline verify)`, is one of the eight required merge gates on `main`
(`MMCA.Common/CONTRIBUTING.md:60-71`).

The run itself (`ci.yml:356-362`) uses `--filter "*"` and `--job Short`:

```bash
dotnet run -c Release --project Tests/Performance/MMCA.Common.Benchmarks --no-launch-profile -- --filter "*" --job Short --exporters json
```

`--filter "*"` selects every benchmark non-interactively, and without it BenchmarkDotNet prompts for a
selection and hangs in CI. `--job Short` (3 warmup + 3 iterations) produces real measurements in under a
minute instead of a full multi-iteration timing run. `--no-launch-profile` keeps it deterministic on
hosted runners.

Then `build/perfgate` (`ci.yml:364-371`) compares the exported results against
`Tests/Performance/perf-baseline.json` and fails on any violation. The baseline holds two kinds of
assertion, and the difference matters: deterministic **allocation ceilings** (byte counts, which are
stable across machines) and machine-independent **ratio floors**, such as the compiled-expression
specification cache staying at least 1000x ahead of the recompile anti-pattern. Wall-clock times are not
asserted, because a shared hosted runner cannot deliver them reproducibly. Moving a number deliberately
means updating the baseline file in the same PR.

[Rubric §12, Performance & Scalability] is served in the only form CI can honestly provide: not "is it
fast" but "did the property that makes it fast stop holding".

### Job: `coverage`, merge report and coverage floor

This job (`ci.yml:376-433`) runs after both test jobs (`needs: [changes, build-and-test, ui-e2e]`, `if:
always()`). It downloads the `coverage-*` artifacts, merges the unit/architecture/bUnit and E2E cobertura
tiers with ReportGenerator (`+MMCA.*;-*.Tests`, generated `*.generated.cs`/`*.g.cs` filtered out), and
publishes the summary to the run's Step Summary (`ci.yml:393-406`).

It then **enforces a coverage floor** (`ci.yml:422-433`) as a regression backstop: the *unit tier alone*
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

**`consumer-source-build`** (`ci.yml:446-622`) is a cross-repo pre-merge canary, and it now proves two
different things. It checks out MMCA.Helpdesk as a sibling directory (`ci.yml:463-494`) and builds and
tests it against *this PR's* framework source, so a breaking public-API change fails here rather than
surfacing after a release and a lockstep sweep. Helpdesk is the ideal canary precisely because it is
minimal: a single-module app that needs no database and no GitHub Packages token to compile, shipping a
committed `local.props` that swaps the `MMCA.Common.*` `PackageReference`s for `ProjectReference`s into
`../MMCA.Common/Source`. The sibling checkout layout is what makes that relative path resolve to the PR's
own checkout. Its test step (`ci.yml:531-536`) carries the same discovery floor idea as `build-and-test`,
set to 40 against a suite of about 91 (`ci.yml:534-535`). Promoted to a required gate on 2026-07-16 after
9 consecutive green runs (`ci.yml:441-442`).

Two additions are worth reading closely. First, the job resolves which Helpdesk ref to build
(`ci.yml:474-483`): if a branch with the **same name** as this PR's head branch exists on
`ivanball/MMCA.Helpdesk`, the canary builds that pair together; otherwise it builds Helpdesk `main`. That
convention is what makes a deliberate breaking framework change landable at all. Helpdesk's own CI builds
against MMCA.Common `main`, so neither repo can adapt first while the canary pins the other's `main`: a
mutual deadlock, resolved by letting one PR name its counterpart branch (`ci.yml:469-473`).

Second, the job runs the consumer's **real EF migrations against a real SQL Server**. An ephemeral
`mcr.microsoft.com/mssql/server:2022-latest` container starts *before* the build so it warms up while the
solution compiles (`ci.yml:514-522`), `go-sqlcmd` is installed as a single static binary rather than the
mssql-tools deb (`ci.yml:540-544`), a 30 x 5s poll waits on a real `SELECT 1` rather than on Docker's
notion of "running" (`ci.yml:548-561`), and `dotnet ef database update` applies the Tickets migrations
with the same `dotnet-ef 10.0.8` the consumers deploy with (`ci.yml:565-590`). The reason is stated in
the comment (`ci.yml:569-577`): `migrations add` and the model-drift gate never open a connection, so
neither notices a framework change that breaks the generated DDL, the history table, or the design-time
context wiring. `database update` does.

The step after it is the one that makes the apply falsifiable (`ci.yml:597-622`). `dotnet ef database
update` exits 0 on a no-op, so a wiring mistake that applied nothing would pass silently. The assertion
step therefore reads `__EFMigrationsHistory` for at least one row and checks that both a module table
(`Tickets.Ticket`) and a **framework** table (`dbo.OutboxMessages`) exist. The framework table is the
half that belongs to MMCA.Common, so a change that stops the framework's own tables reaching a consumer's
schema fails right here rather than at a consumer's deploy. The job's timeout was raised to 30 minutes to
pay for the container, the poll and the apply (`ci.yml:450-452`), and the throwaway SA password is inline
rather than a secret so the gate still runs from a fork (`ci.yml:453-457`).

[Rubric §8, Data Architecture] is served in a way no build-only canary can reach: the framework's
migration path is exercised end to end, on a real engine, by a real consumer.

**`package-consumption`** (`ci.yml:634-717`) closes the gap that the previous job cannot: source-mode
builds bind `ProjectReference`s, so pack breaks (NU5xxx) and package-mode-only restore, analyzer, and
reference failures stay invisible to them. The comment records that this failure mode shipped **twice**
before the job existed (`ci.yml:624-633`). So this job packs every slnx package into a local folder feed
under a CI-only version (`PACK_VERSION` at `ci.yml:639-640`, packed at `ci.yml:660-662`, with
`MinVerSkip=true` so the consumer can pin the packed version exactly), then scaffolds a throwaway
consumer (`ci.yml:664-712`) whose `nuget.config` maps `MMCA.Common.*` to that feed and everything else to
nuget.org, and builds it (`ci.yml:714-717`).

The throwaway consumer lives in `RUNNER_TEMP`, **outside the repo checkout**, and that placement is the
whole point: inside the checkout it would inherit `Directory.Build.props` and `Directory.Packages.props`
and stop resembling a real downstream app. It references the meta set (`API` + `Infrastructure` +
`Testing.Architecture`) to pull the full package graph transitively, and compiles one smoke type against
`Result` to prove the references actually bind rather than merely resolve.

**`sample-deployment-validate`** (`ci.yml:725-739`) type-checks the `samples/deployment` Bicep templates
with `az bicep build`, no cloud credentials required. A library cannot deploy itself, so this IaC/OIDC
reference is documentation that would otherwise rot unobserved; compiling it on every PR keeps it honest.
A real what-if or deploy stays a consumer-side concern, since ADC's and Store's `deploy.yml` are the
production-proven versions.

### Job: `redis-integration`

The last job (`ci.yml:741-777`) runs `MMCA.Common.Infrastructure.Redis.Tests` against a real Redis via
Testcontainers, which Ubuntu runners support with no extra setup since they ship a Docker daemon. Like the
E2E and benchmark projects it lives outside `MMCA.Common.slnx` so the fast solution-wide unit loop never
requires Docker, and is therefore built and run by path.

The comment (`ci.yml:746-750`) states the falsifiability argument better than a summary can:
`DistributedCacheService` is the one place where the **storage format** matters, and a
`Mock<IDistributedCache>` cannot express it. Redis keys are typed, so a counter written as a string and
read back as a hash round-trips perfectly against a mock and answers `WRONGTYPE` against a server. A test
that cannot fail against a mock is not a test of the thing you care about.

Its heavy step is code-guarded like every other job (`ci.yml:770-777`) so a docs-only PR does not pull a
Redis image, while the job itself still runs and posts its context green, keeping it safe to add to branch
protection.

---

## MMCA.Common, `release.yml`

**File:** `MMCA.Common/.github/workflows/release.yml`

### What it is

The lockstep NuGet release workflow. When a maintainer pushes a `vX.Y.Z` git tag, this workflow
deterministically derives the version, packs every published package, generates a CycloneDX SBOM (a hard
gate), and pushes to **both** GitHub Packages and nuget.org (ADR-053). Every package. One tag. One
version. Every time. The authoritative package list and count live in
[`MMCA.Common/FACTS.md`](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md), which CI regenerates
from source and gates on (see the FACTS drift step in `ci.yml` above): read the count there rather than
from any prose.

They are packed by **two jobs, not one**, and the split follows the solution boundary exactly. The ubuntu
`publish` job runs `dotnet pack MMCA.Common.slnx` (`release.yml:46-47`), which packs every packable
project the solution contains (`MMCA.Common.slnx:8-29`). The windows `publish-maui` job packs the one
remaining package, `MMCA.Common.UI.Maui`, by csproj path (`release.yml:128-129`), because its four MAUI
target frameworks need workloads that Ubuntu runners do not carry
(**[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)**), which is
also why that project stays out of the solution. Both jobs derive their version from the same
`GITHUB_REF_NAME` (`release.yml:36-38`, `release.yml:120-123`), so the lockstep release stays whole
across the runner split.

### Why lockstep matters

MMCA.Common's packages form a coherent framework layer. A consumer's `Directory.Packages.props`
references all of them at the same version number. If they could release independently, a consumer bumping
only some of them would import incompatible API surfaces, for example, an `Application` handler
interface that references a `Shared` type that was renamed in `Shared` v2 but not yet reflected in the
old `Application` v1. Lockstep eliminates this class of dependency mismatch entirely. This policy is
**[ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html)** (lockstep versioning + the MassTransit-v8 pin), documented in the [versioning policy](https://ivanball.github.io/docs/guides/common-VERSIONING.html)
and in `MMCA.Common/CLAUDE.md` ("consumers bump every entry together in their `Directory.Packages.props`,
no phased rollout"), and enforced as a build gate (`DependencyVersionTests` fails the build if
MassTransit's major reaches 9).

[Rubric §32, Dependency & Supply-Chain] is embodied: the lockstep mechanism means a consumer's
`Directory.Packages.props` is the single source of truth for which generation of the framework is in use,
with no possibility of a half-upgraded state. (The set spans core, presentation, hosting/gateway, Aspire
and testing layers, plus an `MMCA.Common` metapackage; the enumerated list is in
[`FACTS.md`](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md), which is generated from the
packable `Source/*` projects and is the file the CI drift gate checks.)

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
Tests run again (no `--minimum-expected-tests` floor here, the release workflow is not the primary test
gate; CI already covered this). This is a belt-and-suspenders pass to ensure the tagged commit is green
before packaging.

**Step 7, Pack** (`release.yml:46-47`):
```bash
dotnet pack MMCA.Common.slnx -c Release --no-build -o ./nupkgs -p:MinVerSkip=true -p:PackageVersion=${{ steps.version.outputs.VERSION }}
```
`dotnet pack` over the entire solution packs every packable project it contains (`Source/**`) in
one command. `-p:PackageVersion` sets the NuGet package version metadata. `-o ./nupkgs` collects all
`.nupkg` files in one directory for the push step. The packages produced here all share the same
version string. `MMCA.Common.UI.Maui` is not in the solution and is packed by the `publish-maui` windows
job into its own `./nupkgs-maui` directory from the same tag (ADR-042).

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
expands the glob before the push, so a partial push followed by a retry would otherwise fail on the
packages that already uploaded.

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

A second job on `windows-latest` (`release.yml:94-166`) packs the one out-of-solution package,
`MMCA.Common.UI.Maui`, which multi-targets net10.0-android/ios/maccatalyst/windows and therefore cannot
build on the ubuntu runner at all (ADR-042). It installs the MAUI workload (`release.yml:117-118`),
derives the version from the same tag (`release.yml:120-123`), builds and packs by csproj path into
`./nupkgs-maui` (`release.yml:125-129`), applies the same SBOM hard gate scoped to that one project
(`release.yml:131-144`), and pushes to both registries (`release.yml:146-166`). Because both jobs key off
`GITHUB_REF_NAME`, the two runners produce the same version string and lockstep survives the split.

Two details are load-bearing, and the comment states them (`release.yml:152-155`). The nuget.org
trusted-publishing policy is keyed on the workflow **file**, so one policy covers both jobs, but each job
needs its own `id-token: write` (`release.yml:97-100`) and its own exchange: a short-lived key is
single-use and cannot cross a job boundary. And every `dotnet nuget push` step here sets `shell: bash`
(`release.yml:149`, `release.yml:165`), because the windows-default PowerShell passes `*.nupkg` through
unexpanded and the push then fails with "File does not exist" on the un-globbed pattern.

The cost of the split is release surface: two runners must both succeed for a release to be whole.

---

## MMCA.ADC, `deploy.yml`

**File:** `MMCA.ADC/.github/workflows/deploy.yml`

### What it is

The primary CI/CD pipeline for the Atlanta Developers Conference application. It runs on every push to
`main`, on every pull request targeting `main`, and on manual `workflow_dispatch`. On a push to `main` (or
dispatch) it deploys to Azure; on a pull request it runs the validation jobs only, as a merge gate.

It is **sixteen jobs**, and the shape of the split is the interesting fact. A `changes` classifier
(`deploy.yml:62`) that everything keys off; three pull-request-only validation jobs, `build-and-test`
(`:205`), `integration-tests` (`:612`) and `coverage` (`:700`); a `supply-chain` job (`:512`) that runs on
both events and gates the deploy; eight proof gates that run only on the deploy path,
`backend-test-gate` (`:410`), `ai-eval-gate` (`:461`), `cost-guard` (`:749`), `e2e-gate` (`:761`),
`dr-freshness` (`:783`), `load-freshness` (`:840`), `cross-service-freshness` (`:899`) and
`cross-browser-freshness` (`:1004`); and three deploy-path jobs, `foundation` (`:1089`), `build-images`
(`:1143`) and `deploy` (`:1234`).

Three structural decisions explain most of that. Validation is PR-only because `main` requires branches to
be up to date, so the PR already tested the exact tree that merges. The old sequential Phase 1 and
Phase 2 (foundation Bicep, then six `docker build` steps) were lifted out of `deploy` into their own jobs
so they run **concurrently with** the roughly 20-minute `e2e-gate` instead of behind it
(`deploy.yml:1081-1088`, `:1123-1131`); `deploy` itself is now Phase 3 onward and consumes the prebuilt image
tags (`:1252-1254`). And because PR-only validation composed with a `ui`-scoped `e2e-gate` left a
backend-only push to `main` deploying with **no test execution at all**, `backend-test-gate` was added as
the exact complement of `e2e-gate` (`:391-409`), so exactly one of the two runs on every code deploy.
Two later gates extend the same instinct to what the test jobs cannot see: `ai-eval-gate` covers the one
component whose behavior can change with no code change at all (`:440-460`), and
`cross-browser-freshness` keeps firefox and webkit coverage mandatory without putting either engine back
on the per-deploy critical path (`:1004-1079`).

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

The dispatch trigger also carries two inputs, `skip_freshness_gates` and `skip_justification`
(`deploy.yml:8-20`), the break-glass described under the freshness gates below.

```yaml
# deploy.yml:42-44
concurrency:
  group: ${{ github.event_name == 'pull_request' && format('pr-{0}', github.ref) || 'prod-azure' }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

The group is chosen by event, and that is the whole design. Push and dispatch land on `prod-azure` with
`cancel-in-progress` false, which serializes all production Azure mutations: a second push to `main` while
a deploy is in flight does not cancel the running deploy, it waits. This is deliberately conservative,
since an in-flight deploy cancelled mid-Bicep-apply can leave the environment in a partially-updated
state. Pull requests get a per-branch `pr-<ref>` group that *does* cancel in progress, so a rapid push
burst to one PR supersedes its own earlier runs and saves the minutes (`deploy.yml:39-41`). Splitting the
group by event is what lets PR runs be cheap without ever making a deploy interruptible. The comment
states the rule for anything added later (`deploy.yml:36-38`): any other workflow that mutates production
Azure state joins the same `prod-azure` group.

[Rubric §29, Resilience, Reliability & Business Continuity] (assesses whether the system has deployment
patterns that protect against partial-update failures) is served by the non-cancellable production
concurrency group: it is a mechanical guarantee that two competing mutations cannot interleave.

**Permissions** (`deploy.yml:28-34`):
```yaml
permissions:
  id-token: write
  contents: read
  packages: read
  actions: read
```
`id-token: write` enables OIDC-based Azure login (no long-lived credential stored as a secret). The Azure
login step (`azure/login@v3`) exchanges the OIDC token for a scoped Azure access token at runtime. No
static client secret is ever stored in GitHub. `packages: read` is needed for `GITHUB_TOKEN`-authenticated
NuGet restore of the MMCA.Common packages.

`actions: read` is the least obvious of the four, and the comment above it says why (`deploy.yml:32-34`):
the three freshness gates read run history through the Actions API, **and** `e2e-gate` needs it here
because a reusable workflow can never request more than its caller holds, so `e2e.yml`'s own
skip-if-unchanged guard would die on "Resource not accessible by integration" if the caller did not grant
it. A `permissions:` block is a ceiling for every workflow it calls, not just for its own steps.

[Rubric §11, Security] is embodied: OIDC federated identity eliminates the secret-rotation burden and
the credential-leak surface area of a static client secret. The federated credential is scoped to the
`production` environment (`deploy.yml:1094-1099`), so only jobs that declare `environment: production` can
obtain the Azure token.

### Job: `changes`, the docs-only short-circuit and the per-image dirty map

The first job (`deploy.yml:62-203`) classifies the diff and exposes **nine** outputs
(`deploy.yml:65-74`), which is where it differs from Common's single-flag version:

- `code`: false only when every changed path ends in `.md` (`deploy.yml:127-130`).
- `ui`: true only when the diff can change what a browser sees, that is the UI hosts, the Gateway, the
  AppHost, the E2E project, a module-owned Blazor UI project, a workflow file, or a build-wide file such
  as `Directory.Packages.props` or a `.slnx`/`.slnf` (`deploy.yml:133-146`).
- `scoring`: true only for the three trees that own the AI session scorer, its use case and its
  evaluation suite (`deploy.yml:152-157`), the flag that selects the paid half of `ai-eval-gate`.
- six `img_*` flags, one per container image (`deploy.yml:161-191`), the per-leg dirty map the
  `build-images` matrix consumes.

The flags are consumed differently, and the difference is the point. `code` guards the **heavy steps**
inside the required PR jobs, so a docs-only PR still runs every required job and posts every required
status green while doing almost nothing; it additionally gates the deploy-path jobs off entirely
(`deploy.yml:47-51`). `ui` gates `e2e-gate`, which costs roughly 20 minutes on every deploy: an
infra-only or backend-only change cannot change what the browser renders, so it does not pay for a browser
run (`deploy.yml:53-55`), and (since TD-20) it equally selects `backend-test-gate` for exactly the
deploys `e2e-gate` skips. The `img_*` flags let a build leg whose image is clean skip the build and push
entirely.

All nine outputs are fail-safe in both directions, with one deliberate exception noted below. An unknown push range (a new branch or a forced ref,
where `github.event.before` is empty or all zeros) sets `code`, `ui`, `scoring` and every image to true
rather than
guessing from a single commit (`deploy.yml:88-99`), and a failed `git diff` does the same
(`deploy.yml:102-114`). Inside the classifier loop the default arm of each `case` is also `true`
(`deploy.yml:129`, `:145`, `:188-190`), so an unrecognized path counts as code, as UI-affecting, and as
dirtying every image. Over-running CI wastes runner minutes; under-running it ships an unverified change.
The exception is `scoring`, whose per-path default arm is empty rather than `true` (`deploy.yml:156`):
its only consumer is the paid live-judge step of `ai-eval-gate`, so a false positive there spends money
on every unrelated deploy, while the two key-free tiers of that gate already run unconditionally
(`deploy.yml:147-151`).

The `ui` classifier carries a scar worth reading: `Source/Modules/*.UI/*` and `Source/Modules/*.UI.*/*`
are listed explicitly ahead of the general `Source/Modules/*` arm (`deploy.yml:143-144`), because
module-owned Blazor UI ships to the browser and the earlier ordering had swallowed it into the
backend-only bucket.

**The `img_*` map is a fan-in graph, not a path-to-image mapping**, and that is the part worth
internalizing. First match wins, so the shared trees are listed before the per-image ones
(`deploy.yml:159-160`). Build-wide inputs (version pins, MSBuild props, the SDK band, the feed config,
the solution files, any lock file, this workflow, the Aspire AppHost and migrations tree) dirty **every**
image (`deploy.yml:166-168`). A module's `.Shared` project carries the DTOs and identifier aliases that
every service host *and* the Blazor UI compile against, so one `.Shared` edit dirties everything that
ships module code, and only the Gateway (pure YARP over packages, referencing no module) escapes
(`deploy.yml:169-174`). A `.proto` or adapter change in any `.Contracts` project dirties all four service
images, because every service is both a gRPC server and a client of its peers (`deploy.yml:175-178`).
Only after those does a per-service or per-host path map to its single image (`deploy.yml:179-185`).

[Rubric §31, Cost Efficiency / FinOps] is served here in a form that costs nothing at runtime: the
classifier is one `git diff` and a `case` loop, and it removes both the browser leg and up to six image
builds from deploys that cannot need them.

### Job: `build-and-test`

**Pull-request-only** (`deploy.yml:206,194`): `needs: changes` plus `if: github.event_name ==
'pull_request'`. The comment gives the rationale (`deploy.yml:207-209`): under strict
require-branches-up-to-date protection the PR validates the exact tree that merges, so re-running the full
CI on the post-merge push is redundant. Every heavy step below additionally carries `if:
needs.changes.outputs.code == 'true'`, so a docs-only PR still posts this job's required status green.
(The deploy-path complement of this decision is `backend-test-gate`, covered after this job.)

**Step 1, Setup and restore** (`deploy.yml:267-282`):
```yaml
- name: Restore dependencies
  run: dotnet restore MMCA.ADC.CI.slnf --locked-mode
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
`MMCA.ADC.CI.slnf` is the CI solution filter, it excludes the MAUI UI project (whose `maui-android`
workload is not on Ubuntu runners), the AppHost (Aspire orchestration), the frozen combined migrations
archive, and the integration and E2E test projects. The filter gives a fast, reliable build without
requiring workloads beyond the standard .NET SDK. `GITHUB_TOKEN` is passed as an env var so the NuGet
credential provider can authenticate to GitHub Packages and pull the MMCA.Common packages.

`--locked-mode` is what makes the NuGet cache above it trustworthy. The setup step keys
`~/.nuget/packages` on `**/packages.lock.json` (`deploy.yml:275-276`), and the comment records the
reasoning (`deploy.yml:272-274`): the committed lock files make the key exact, and locked mode means a
cache hit is authoritative because the restore cannot resolve anything the key did not account for.

**Step 2, Build** (`deploy.yml:284-286`): `dotnet build MMCA.ADC.CI.slnf --no-restore -c Release`, same
TreatWarningsAsErrors + five-analyzer enforcement as Common.

**Step 3, Unit and architecture tests with coverage** (`deploy.yml:292-300`):
```bash
dotnet tool install --global dotnet-coverage
dotnet-coverage collect -f cobertura -o coverage.unit.cobertura.xml \
  "dotnet test --solution MMCA.ADC.CI.slnf --no-build -c Release --minimum-expected-tests 1"
```
As in Common's CI, the run is wrapped in `dotnet-coverage collect` (it returns the inner exit code so a
failure still gates) and uploaded as the `coverage-unit` artifact (`deploy.yml:302-310`, retention trimmed
to 14 days) for the report-only `coverage` job. Same `--minimum-expected-tests 1` guard. Covers unit tests
for all module layers plus `Architecture.Tests` (NetArchTest fitness functions, layer flow, domain purity,
module isolation).

[Rubric §14, Testability & Test Strategy] is served: architecture tests enforce that the modular
structure is not accidentally violated by a new project reference (e.g. `Domain` referencing
`Infrastructure`).

**Step 4, Unit-tier coverage floor** (`deploy.yml:312-337`). Unlike Common, ADC enforces its floor **here**
rather than in the `coverage` job, and the comment says why (`deploy.yml:314-315`): `build-and-test` is a
required PR check, while `coverage` is report-only and absent from `deploy`'s `needs`, so a floor living
there would gate nothing. The floor is **55.5%** line coverage (`deploy.yml:335`), measured with
ReportGenerator over `+MMCA.ADC.*;-*.Tests;-MMCA.ADC.*.Service;-MMCA.ADC.*.Contracts` (`deploy.yml:333`).

Every term in that filter is a correction of a measurement that lied. `+MMCA.ADC.*` excludes the consumed
MMCA.Common assemblies, which are tested in their own repo and instrument at near zero here, deflating the
figure to about 26.8%. The `*.Service` and `*.Contracts` exclusions were added on 2026-08-01 when
`MMCA.ADC.Services.Tests` first pulled the service hosts and the gRPC contracts into the unit cobertura:
hosts are integration-tier subjects (`Program.cs`, Kestrel config, warm-up) and contracts are dominated by
protobuf-generated plumbing, so both deflate the unit number without measuring unit code, 52.8% raw versus
62.5% filtered on the same run (`deploy.yml:321-326`). A coverage floor is only a regression backstop if
the number it watches moves for the reason you think it does.

**Step 5, Application-layer branch coverage floor** (`deploy.yml:339-369`). A second, narrower gate reads
the same cobertura file, and the reason it exists is the sharpest coverage argument in the repository
(`deploy.yml:341-352`). The repo-wide floor above is a blunt average dominated by UI, Infrastructure and
generated code, so a command handler can lose every branch it had and the global number barely moves. The
Application layer is where the business decisions live (guards, authorization short-circuits, retry and
conflict paths), and those are **branches**, not lines: a handler can be fully line-covered by one happy
path while every failure branch goes unexercised. So this gate measures branch coverage
(`deploy.yml:365`) over the four `Source/Modules/*/*.Application` assemblies only
(`-assemblyfilters:'+MMCA.ADC.*.Application;-*.Tests'`, `deploy.yml:357-358`), with a floor of **77.5%**
(`deploy.yml:367`), about two points under the 79.7% measured on 2026-08-26 across the full unit tier.

The step's most transferable line is the guard *before* the measurement (`deploy.yml:360-364`): if the
report covers fewer than four assemblies it fails outright, because a filter that matched nothing would
otherwise let the floor pass vacuously. That is the same instinct as the `--minimum-expected-tests` floors
throughout this chapter: a gate whose input went missing must be indistinguishable from a gate that failed.

**Step 6, EF migrations model-drift gate** (`deploy.yml:375-389`):
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
comment on `deploy.yml:377-380` states the rationale: "a drift here means the deploy's idempotent
migration script would not capture the schema change."

This is one of the most important gates in the pipeline. An entity model that diverges from the migration
history means the production schema diverges from the application's EF model, a runtime crash on first
query of the changed entity. The gate catches it at build time, before any container image is pushed. It
is doubly important now that `deploy.yml` has *no* sqlcmd migration step: this build-time gate is the
guarantee that the services' startup `Migrate()` always has a migration to apply for every model change.

The `--no-build` flag reuses the Release build from Step 2, so there is no rebuild overhead. `dotnet-ef`
is installed globally (version `10.0.8`) in the step before this one (`deploy.yml:371-373`), the same pin
MMCA.Common's Helpdesk canary uses so the two exercise the same tool.

[Rubric §8, Data Architecture] (assesses whether schema management is automated, versioned, and safe)
is directly served. [Rubric §17, DevOps & Deployment] is served: the migration gate is the CI
enforcement of the "migrations-before-code" discipline.

**The expand/contract migration guard** (`deploy.yml:219-265`) is the job's *first* step, ahead of even
the .NET SDK setup, because it needs nothing but `git`, `awk` and `grep`:

```yaml
# deploy.yml:219-220
- name: Expand/contract migration guard (schema rollback safety)
  if: needs.changes.outputs.code == 'true'
```

It is the other half of the schema-safety story the model-drift gate starts. The drift gate proves a
migration *exists* for every model change; this one proves the migration is safe to be rolled back past.
The post-deploy smoke gate's remedy (Phase 5 below) is a container-app **revision** rollback, and a
revision rollback does **not** revert schema: each service self-applies its migrations at startup, so the
previous release comes back up against the *new* schema. A `DropColumn`, `DropTable` or `DropIndex` in
the migration that just shipped therefore breaks one-release-back compatibility, and the rollback that
was supposed to rescue the deploy fails on the way back down. The step comment (`deploy.yml:221-232`)
states exactly that chain.

The rule: for every migration file **added** by the pull request, if the `Up()` body contains
`DropColumn`, `DropTable` or `DropIndex` and does not contain `EXPAND-CONTRACT-OVERRIDE`, fail
(`deploy.yml:257-260`). Three scoping decisions carry the design:

- The file set is `git diff --diff-filter=A --name-only "origin/<base>...HEAD"` (`deploy.yml:241-242`),
  path-scoped to `Source/Hosting/MMCA.ADC.Migrations.SqlServer.*/Migrations/*.cs`. Only *added* files
  count, so the four per-service migrations projects are covered and nothing else in the tree is.
- `.Designer.cs` files are skipped (`deploy.yml:253-255`), they carry the model snapshot, not operations.
- Only the `Up()` body is scanned, extracted with `awk` between the `Up(` and `Down(` signatures
  (`deploy.yml:256`). Every additive migration's `Down()` legitimately drops what `Up()` added, and
  `Down()` never runs at startup (down-migration is explicit tooling only), so scanning the whole file
  would fail every ordinary migration.

The escape hatch exists because the *contract* half of an expand/contract sequence genuinely is a drop,
and it is correct once the expand half has been in production for a release. It is documented as
`// EXPAND-CONTRACT-OVERRIDE: <reason>` but enforced as a bare substring match (`deploy.yml:258`), so the
comment form is convention, not syntax, and one occurrence anywhere in the `Up()` body exempts **every**
destructive operation in that migration. The marker is a prompt for the reviewer to ask "has the expand
half already shipped?", not a machine-checked proof that it has.

The checkout immediately above sets `fetch-depth: 0` for this step alone, and says so
(`deploy.yml:216-217`): without full history the base diff cannot resolve. That coupling produces the
most transferable lesson in the whole job. There is deliberately no `|| true` on the diff: when it fails,
the step prints an error naming `fetch-depth` and exits 1 (`deploy.yml:236-245`). A gate that cannot
evaluate must fail closed, because the alternative is a required check that reports green while checking
nothing, and the comment records the incident that settled the point: swallowing that error is exactly
what made this check silently pass on every run in MMCA.Store between 2026-07-25 and 2026-07-28. It is
the same instinct as the `--minimum-expected-tests` floors elsewhere in this chapter: a gate whose input
went missing must be indistinguishable from a gate that failed.

MMCA.Store runs the same step in its own `build-and-test`
(`MMCA.Store/.github/workflows/deploy.yml:279`), path-scoped to
`Source/Hosting/MMCA.Store.Migrations.SqlServer.*/Migrations/*.cs`; it ships the identical
startup-migration plus revision-rollback model and had no equivalent guard before the port
(`MMCA.Store/.github/workflows/deploy.yml:289-294`).

[ADR-057](https://ivanball.github.io/docs/adr/057-expand-contract-schema-evolution-gate.html) is the
decision record. [Rubric §8, Data Architecture] is served at the level the drift gate cannot reach: not
just "a migration exists" but "the schema stays compatible with the release you can still roll back to".
[Rubric §29, Resilience, Reliability & Business Continuity] is served because it is what keeps the
automatic rollback in Phase 5 an actual recovery path rather than a hopeful one.

### Job: `backend-test-gate`, closing the "deploy with zero tests" hole

This job (`deploy.yml:410-438`) is the newest piece of the pipeline, and it exists because three
individually-sound decisions composed into a hole. `build-and-test` and `integration-tests` are both
pull-request-only (strict branch protection means the PR validated the exact merge tree), and `e2e-gate`
is scoped to `ui == 'true'` for minute savings. Put together, a **backend-only push to `main` ran no
tests at all before rolling out**, with the post-deploy smoke gate as the only backstop, which is
detection after the rollout rather than prevention. The comment states that chain in full
(`deploy.yml:391-409`).

The fix is a complement, not a new unconditional gate:

```yaml
# deploy.yml:412
if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true' && needs.changes.outputs.ui != 'true'
```

Compare it against `e2e-gate`'s condition (`deploy.yml:772`): the two are exact complements over a code
deploy, so **exactly one of them runs** on any given code deploy. The invariant "no production deploy
without test execution" therefore holds at zero added minutes on a UI deploy (where the roughly
20-minute `e2e-gate` already runs) and at the cost of one `MMCA.ADC.CI.slnf` test pass on a backend-only
deploy.

Its scope is deliberately narrow (`deploy.yml:406-409`): the same `MMCA.ADC.CI.slnf` restore, build and
test as `build-and-test` (`deploy.yml:427-438`), so unit, architecture and bUnit tiers with no Docker
daemon and no Playwright browsers. Coverage collection and both coverage floors stay in the PR-only job,
because they are a review-time regression signal rather than a rollout gate, and collecting them here
would only slow the deploy. The test step keeps `--minimum-expected-tests 1` (`deploy.yml:435-438`) for
the reason its own comment gives: a filter or discovery breakage that runs zero tests must fail the gate
rather than report a vacuous pass.

[Rubric §14, Testability & Test Strategy] is served in its most operational form: the *deploy* path, not
just the review path, is required to have executed tests. [Rubric §17, DevOps & Deployment] is served by
the way it is expressed: an invariant restored by making two conditional gates partition the space,
rather than by making one of them unconditional and paying for it on every deploy.

### Job: `ai-eval-gate`, the behavior that changes without a code change

`ai-eval-gate` (`deploy.yml:461-506`) exists for the one component in this repository whose behavior can
move while every unit test stays green: the AI session scorer that ranks submitted talks for organizers.
The comment states the case (`deploy.yml:440-444`): a prompt edit, a model deprecation, or a
provider-side contract change each moves the numbers an organizer uses to accept or decline a talk, and
none of the three is visible to `MMCA.ADC.CI.slnf`.

It runs on the same condition as the other deploy-path test gates, `github.event_name != 'pull_request'
&& needs.changes.outputs.code == 'true'` (`deploy.yml:463`), rather than on the `ui`/backend split that
separates `e2e-gate` from `backend-test-gate`. The comment gives the reason (`deploy.yml:457-460`): its
cheap tier is cheap enough to run on every code deploy, and its whole point is catching what the other
two gates cannot see. It restores and builds one project by path,
`Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests`, with `--locked-mode`
(`deploy.yml:478-484`), so it never pays for the full solution.

**The two tiers are split by cost, and that split is the design** (`deploy.yml:446-455`):

1. **Golden replay plus prompt contract**, always (`deploy.yml:486-493`). No API key and no network:
   recorded proposals are replayed through the real scoring service, and the rendered prompt is hashed
   against the hash recorded for the current `PromptVersion`. This is the tier that catches a prompt edit
   that forgot to bump the version, a delimiter that stopped being emitted, and a change to the weighting
   math. It carries `--filter-not-trait "Category=AiEval.Live" --minimum-expected-tests 1`, the same
   discovery floor every other gate step uses, because a filter breakage that runs zero tests must red the
   gate rather than report a vacuous pass (`deploy.yml:487-488`).
2. **Live judge**, only when `needs.changes.outputs.scoring == 'true'` (`deploy.yml:495-506`, gated at
   `:496`). Real paid calls to the Anthropic API for each golden proposal, asserting the overall score
   lands in the case's band. It is scoped to a diff that touches the scoring code precisely because it
   costs money, and the bands are deliberately wide: a judge model is not deterministic, and a flaky gate
   gets ignored.

Two details in the second tier are worth reading. It sets **no** `--minimum-expected-tests` floor, and
the comment says why (`deploy.yml:497-499`): without `ANTHROPIC_API_KEY` every case skips itself
dynamically, reported as skipped and never as passed, so a zero-run must not red the deploy on a
repository whose secret is absent. And the key arrives as a job-scoped `env` from
`secrets.ANTHROPIC_API_KEY` (`deploy.yml:505-506`), never as a build argument or a workflow input.

This is also why `scoring` is the one classifier output that does **not** fail safe to `true`
(`deploy.yml:147-151`): a false positive here spends money on every unrelated deploy, while the two
key-free tiers already run unconditionally, so the narrow set costs nothing in coverage.

[Rubric §14, Testability & Test Strategy] assesses whether the system's behavior is actually verified
rather than merely compiled. The golden replay is the honest answer for a non-deterministic component:
the deterministic parts (prompt rendering, version pinning, weighting math) are asserted exactly, and the
non-deterministic part is asserted as a band. [Rubric §31, Cost Efficiency / FinOps] is served by the
tier split itself: the gate that costs money runs only for the diffs that can change what it measures.

### Job: `supply-chain`

This job (`deploy.yml:512`) runs in parallel with `build-and-test` on every push and PR, and unlike the
other validation jobs it is **not** PR-only: it is in `deploy`'s `needs` list (`deploy.yml:1237`) and its
result must be `success` for the deploy to proceed (`deploy.yml:1274`). Two of its steps are gates and two
are reports, and the comment above the job draws that line explicitly (`deploy.yml:508-511`).

**The two gates:**

- **Vulnerability audit** (`deploy.yml:540-560`) fails on any vulnerable-package row except advisories
  accepted via `NuGetAuditSuppress` in `Directory.Build.props`. This mirrors Common's `ci.yml` step and
  exists for the same reason: `dotnet list --vulnerable` ignores `NuGetAuditSuppress`, so the accepted
  advisory list has to be re-applied by hand (`deploy.yml:551-556`). NuGetAudit at restore already gates
  the build; this makes the check deploy-gating as well, belt and suspenders. One detail differs from
  Common's copy and is worth knowing before you edit either file: ADC scrapes every `GHSA-` id out of
  the whole of `Directory.Build.props` (`deploy.yml:551`), while Common narrows the same scrape to
  actual `<NuGetAuditSuppress` lines (`MMCA.Common/.github/workflows/ci.yml:120`). Common's is the
  stricter reading, since under ADC's a GHSA id merely mentioned in a comment would suppress that
  advisory here.
- **CycloneDX SBOM** (`deploy.yml:574-587`) must exist **and contain components**. The comment records
  the near-miss (`deploy.yml:576-578`): the previous `test -s` check only proved the file was non-empty,
  which a zero-component skeleton passes, which is exactly how an empty SBOM went unnoticed. The step now
  asserts `jq '.components | length' > 0` (`deploy.yml:585-587`).

**The two non-gating reports** (`continue-on-error: true`) are `supply-chain/deprecated.txt`, packages the
publisher has flagged as obsolete or replaced (`deploy.yml:533-538`), and `supply-chain/licenses.json`,
license metadata for every transitive package via `nuget-license` (`deploy.yml:589-599`). All four
outputs upload as the `supply-chain-reports` artifact with a 14-day retention (`deploy.yml:601-610`).

Between the audit and the SBOM sits the step that makes both honest on Linux, **Normalize the solution
filter** (`deploy.yml:562-572`). A `.slnf` records Windows-style project paths, and on the Linux runner a
backslash is an ordinary filename character, so a tool that opens those paths directly resolves **zero**
projects. `dotnet list` is unaffected because MSBuild normalizes separators, but CycloneDX silently
emitted an empty SBOM this way. The step writes a forward-slash copy (`ci-linux.slnf`) next to the
original so the relative project paths still resolve, and feeds the tools below from it. Two follow-on
details come straight out of that: `--set-name MMCA.ADC.CI` pins the BOM metadata component, which would
otherwise take the input filename and become "ci-linux" (`deploy.yml:581-583`); and `nuget-license` cannot
take a `.slnf` at all, because it hands its `--input` straight to MSBuild, which parses the JSON as XML
and throws, so the report is fed the extracted project list via `--json-input` instead
(`deploy.yml:592-598`).

One scope limit is worth naming here, because a separate workflow exists to cover it: this job audits
`MMCA.ADC.CI.slnf`, which deliberately excludes the MAUI head, so the largest dependency graph in the
repo is invisible to it. That gap is closed weekly by `maui-audit.yml`, covered in the repository
automation section below.

The transferable lesson is the one the empty SBOM taught: a supply-chain artifact that is generated but
never asserted on is indistinguishable from one that was never generated.

[Rubric §32, Dependency & Supply-Chain] is served, now as a gate rather than a report: a non-suppressed
vulnerable package or a component-less SBOM blocks the production deploy. [Rubric §30, Compliance,
Privacy & Data Governance] is touched: the license report is the mechanism for discovering GPL or AGPL
dependencies that would create licensing obligations.

### Job: `integration-tests`

This job is **pull-request-only** (`deploy.yml:613,535`), and `deploy` does not list it:
```yaml
needs: changes
if: github.event_name == 'pull_request'
```
It runs the per-service `WebApplicationFactory` integration tests against a real SQL Server, covering
roughly 420 test methods across the four projects `MMCA.ADC.Integration.slnf` lists: Identity,
Conference, Engagement and Notification (`MMCA.ADC.Integration.slnf:5-8`).

How it protects production is worth being precise about, because the mechanism is not the one you
would guess. This job never runs on the push to `main`, and it is absent from `deploy`'s `needs`
list (`deploy.yml:1237`); the only job that consumes it is `coverage` (`:701`). The protection comes
from branch protection instead: `main` requires branches to be up to date, so the PR check runs
against the exact merge tree that will land, which the job's own comment gives as the rationale for
being PR-only (`:614-618`). The practical consequence is that a `workflow_dispatch` run of
`deploy.yml` does not re-run the integration tier at all, and that the deploy-path test coverage comes
from `e2e-gate` or `backend-test-gate` instead.

**SQL Server as a guarded step, not a `services:` block** (`deploy.yml:627-635`):
```yaml
- name: Start SQL Server
  if: needs.changes.outputs.code == 'true'
  run: |
    docker run -d --name sqlserver \
      -e ACCEPT_EULA=Y \
      -e MSSQL_SA_PASSWORD="$MSSQL_SA_PASSWORD" \
      -e MSSQL_PID=Developer \
      -p 1433:1433 \
      mcr.microsoft.com/mssql/server:2022-latest
```
An ephemeral SQL Server Developer Edition container is started by an explicit `docker run`, and the
placement is the design detail: a job-level `services:` block starts before the first step and cannot be
conditioned, so a docs-only PR would pay to pull and boot SQL Server for nothing. As a guarded step it is
skipped with everything else while the job still runs and posts its required status green
(`deploy.yml:614-618`). MMCA.Common's Helpdesk canary now uses the identical pattern for its migration
apply (`MMCA.Common/.github/workflows/ci.yml:510-513`).

The password lives in the job's `env:` (`deploy.yml:622-623`) because it is a throwaway SA credential for
an ephemeral container, not a production secret, and not stored in GitHub Secrets. The comment states it
explicitly (`deploy.yml:617-618`): "Throwaway SA password, not a secret."

**Wait-for-SQL-Server gate** (`deploy.yml:651-663`): a 30-iteration poll loop (5-second sleep each) using
`sqlcmd` (installed by the step at `deploy.yml:645-649`) to execute `SELECT 1`. SQL Server takes 10 to 20
seconds to initialize in a fresh container; proceeding immediately would fail the restore or build with a
connection error. The loop exits early on success rather than running the full 150-second maximum, and
exits 1 if the server never answers, so a container that failed to boot is a job failure rather than a
confusing downstream test error.

**Integration test run** (`deploy.yml:679-686`): like the unit tier, the test command is wrapped in
`dotnet-coverage collect` (emitting the `coverage.integration.cobertura.xml` artifact at
`deploy.yml:688-696`):
```yaml
env:
  ADC_TEST_SQL_BASE: "Server=localhost,1433;User Id=sa;Password=${{ env.MSSQL_SA_PASSWORD }};TrustServerCertificate=True;Encrypt=False;"
run: dotnet test --solution MMCA.ADC.Integration.slnf --no-build -c Release --minimum-expected-tests 1
```
The `ADC_TEST_SQL_BASE` connection string is consumed by `IntegrationTestBase` to provision per-test
databases (each test gets a fresh database, reset between tests). `MMCA.ADC.Integration.slnf` is a
separate solution filter that includes only the four integration test projects; the restore and build
steps immediately before (`deploy.yml:665-673`) target the same filter, restore in `--locked-mode` like
`build-and-test`.

[Rubric §14, Testability & Test Strategy] is served at a higher tier than the unit tests: these tests
exercise real EF migrations, real HTTP middleware, real domain logic through a real SQL Server engine. A
bug that only manifests under an actual database connection (e.g. a LINQ translation error, a migration
column type mismatch) is caught here before it reaches production.

### Job: `coverage`, report-only by design

This job (`deploy.yml:700-744`) downloads both `coverage-*` artifacts, merges the unit/architecture/bUnit
and integration cobertura tiers with ReportGenerator over `+MMCA.*;-*.Tests`, writes the summary to the
run's Step Summary, and uploads the HTML report (`deploy.yml:722-744`).

Two conditions are worth reading together. `needs: [changes, build-and-test, integration-tests]` with `if:
always() && github.event_name == 'pull_request'` (`deploy.yml:701-702`) means it runs after both test
jobs regardless of their outcome, so a failing run still yields its partial coverage picture. And it is
**not** in `deploy`'s `needs` (`deploy.yml:1237`), which is the deliberate part: this job never blocks
anything. That is precisely why ADC's coverage **floors** live in `build-and-test` instead
(`deploy.yml:312-369`, above). Splitting them this way keeps the enforcement on a required check and the
merged report where it is useful, on the pull request.

[Rubric §14, Testability & Test Strategy] is served in two tiers here: the floors are the gate, the merged
report is the visibility.

### Job: `cost-guard`, a scheduled check promoted to a deploy gate

```yaml
# deploy.yml:749-752
cost-guard:
  if: github.event_name != 'pull_request'
  uses: ./.github/workflows/cost-guard.yml
  secrets: inherit
```

The FinOps surge-drift check gets its own section further down as a standalone workflow. What matters
here is the four-line job that makes it a gate: `deploy.yml` calls `cost-guard.yml` as a **reusable
workflow** and lists it in `deploy`'s `needs` (`deploy.yml:1237`, required `success` at `:1274`), so a
production deploy cannot proceed while a conference-day scale-up is still un-reverted (`deploy.yml:746-748`).

It is skipped on pull requests because there is no production OIDC there, and `deploy` is PR-skipped
anyway. The cost of the gate is under a minute of read-only `az` queries, which is what makes reusing the
weekly cron's own workflow the cheap option rather than a duplicated inline check.

[Rubric §31, Cost Efficiency / FinOps] is served in the strongest available form: an un-reverted surge
does not merely raise an alert, it stops the next deploy until someone reverts it.

### Job: `e2e-gate`, one chromium leg against the full Aspire stack

```yaml
# deploy.yml:761-776
e2e-gate:
  needs: changes
  if: github.event_name != 'pull_request' && needs.changes.outputs.ui == 'true'
  uses: ./.github/workflows/e2e.yml
  with:
    browsers: '["chromium"]'
  secrets: inherit
```

The same reusable-workflow shape as `cost-guard`, pointed at `e2e.yml`. This is the §28 merge-gate
promotion of 2026-07-02 (`deploy.yml:754-760`): the Playwright suite runs against the full Aspire stack
(SQL Server, Redis, RabbitMQ, four services, Gateway, UI) before a deploy is allowed to roll.

Three scoping decisions carry it, and each is a cost or a correctness trade made explicit:

- **Chromium only.** The gate runs one engine instead of three (2026-07-18), and firefox plus webkit
  cross-browser coverage stays on `e2e.yml`'s own schedule. One engine still catches the regression class
  that matters on the deploy path; three paid triple for information that changes on the scale of a
  release.
- **Gated on `ui`, not `code`** (`deploy.yml:763-765`). At roughly 20 minutes this is the most expensive
  gate in the pipeline, and an infra-only, script-only or backend-only deploy cannot change what the
  browser sees. The comment names the two backstops that make the omission safe (`deploy.yml:767-771`):
  `backend-test-gate` carries the exact complementary condition and runs the CI.slnf tier instead, so the
  skipped deploy is not untested; and the post-deploy smoke gate probes Conference, Engagement and
  Notification through the Gateway and auto-rolls-back behind both. It also names the revert, change `ui`
  back to `code`, which is the right thing for a cost optimization to document.
- **`success` or `skipped`.** In `deploy`'s condition the unconditional gates must all be `success`, but
  `e2e-gate` may also be `skipped` (`deploy.yml:1282`), as may its complement `backend-test-gate`
  (`:1283`). That exception is the whole reason `deploy` uses `always()` plus explicit per-need results
  instead of default `success()` semantics, covered under the `deploy` job below.

The advice in the comment is worth keeping (`deploy.yml:759-760`): if a genuine contention flake blocks a
deploy, re-run the job and read its trace artifact before demoting the gate over a single red.

[Rubric §28, Front-End Testing & Quality] is served: a browser-level regression in a UI-affecting change
cannot reach production.

### Jobs: `dr-freshness`, `load-freshness`, `cross-service-freshness`, `cross-browser-freshness`

Four near-identical jobs, one idea: **a deploy blocks on the age of out-of-band verification, not only
on the tests that are green in this run**. Each one asks the Actions API for the newest successful run of
one scheduled workflow and fails the deploy when that proof is older than its window, or when there is no
qualifying run at all.

| Job | Proof it demands | Producing workflow | Window |
|---|---|---|---|
| `dr-freshness` (`deploy.yml:783`) | a real PITR restore drill with its RTO timing | `dr-drill.yml` | 8 days (`deploy.yml:791`) |
| `load-freshness` (`deploy.yml:840`) | the k6 capacity run at the observed peak | `load-test.yml` | 35 days (`deploy.yml:848`) |
| `cross-service-freshness` (`deploy.yml:899`) | the Testcontainers outbox to broker to consumer round-trip **and** the Service Bus emulator parity smoke | `cross-service-tests.yml` | 5 days (`deploy.yml:909`) |
| `cross-browser-freshness` (`deploy.yml:1004`) | a successful firefox **and** webkit leg of the Playwright suite | `e2e.yml` | 10 days (`deploy.yml:1013`) |

All four carry `if: github.event_name != 'pull_request'` (`deploy.yml:786`, `deploy.yml:843`,
`deploy.yml:902`, `deploy.yml:1007`) and only two read privileges, `permissions: actions: read` plus
`contents: read` (`deploy.yml:787-789`, `deploy.yml:844-846`, `deploy.yml:903-905`,
`deploy.yml:1008-1010`): nothing is writable, they read run
history and run nothing. Each has a
five-minute timeout and costs an Actions API read or two, no restore, no k6, no Docker daemon. And all
four sit in `deploy`'s `needs` list (`deploy.yml:1237`), which is the entire point: a stale proof blocks
the production deploy.

That `needs` edge is what separates a gate from a report. A scheduled workflow nobody watches can sit
unrun or red for weeks while deploys ship daily, and the recovery-objective evidence still technically
"exists". Making recency a dependency prices the verification correctly too: the expensive run stays on
its cron, the deploy pays for a lookup. Each window is the producing cadence plus slack (weekly drill and
an 8-day window, monthly k6 and a 35-day window, alternating weekly browser crons and a 10-day window),
so an on-schedule producer never trips the gate.

`cross-browser-freshness` is the newest of the four, and it closes a hole the cost reduction opened. The
deploy-gating `e2e-gate` runs **chromium only**, so firefox and webkit coverage lives on `e2e.yml`'s
alternating weekly crons; this gate makes that coverage mandatory again without putting either engine
back on the roughly 20-minute per-deploy critical path, which is exactly how `deploy`'s own comment
states it (`deploy.yml:1242-1246`).

Like `cross-service-freshness`, it refuses to trust a run's conclusion, and here it resolves each engine
**separately**: for `firefox` and then `webkit` it walks the last 40 completed `e2e.yml` runs newest
first and takes the first one in which the job named `E2E (<engine>)` itself concluded `success`
(`deploy.yml:1049-1062`), so the two proofs normally come from two different runs and the **older** of
the two decides the gate (`deploy.yml:1045-1046`). The comment gives both reasons the run conclusion is
a lying proxy, and they fail in opposite directions (`deploy.yml:1038-1044`): the matrix is `fail-fast:
false` with the non-chromium legs `continue-on-error` on the schedule, so one engine's red need not red
the run while another job's red can red a run in which this engine passed; and `e2e.yml`'s own
should-run guard can make a run conclude `success` with every leg **skipped**. Asking the jobs API which
leg passed is the only question whose answer means what the gate needs it to mean.

The 10-day window is the per-engine weekly cadence (Monday firefox, Thursday webkit) plus slack for a
skipped or re-run night (`deploy.yml:1012-1013`), and the break-glass is the same shape as the other
three: `skip_freshness_gates` without a `skip_justification` fails the step, and a justified skip is
written prominently to the step summary and exits `success`, so the deploy condition can still demand
`success` from every unconditional gate (`deploy.yml:1021-1037`).

[Rubric §28, Front-End Testing & Quality] assesses whether browser-level tests catch rendering and
functional regressions. This gate is how cross-engine coverage (which the workflow labels rubric §22)
stays enforceable while only one engine runs per deploy: the proof still has to exist and still has to
be recent, it just does not have to be produced by this run.

`cross-service-freshness` is the one worth reading closely, because it does **not** trust the run's
conclusion, and because what it demands was widened on 2026-08-31 (TD-17). It enumerates the last 25
*completed* runs of `cross-service-tests.yml` (any conclusion) and, for each, asks the jobs API whether
**both** the `cross-service` job (the Testcontainers RabbitMQ outbox to broker to consumer round-trip)
and the `servicebus-emulator-smoke` job (Azure Service Bus emulator topology plus AMQP round-trip)
concluded `success` in that same run, taking the first run where both did (`deploy.yml:954-967`). The
`jq` filter makes the requirement literal: it collects the matching job names, uniques them, and demands
a length of exactly 2 (`deploy.yml:957-959`).

That second job used to be advisory (`continue-on-error`), which meant broker parity against the
transport production actually runs was measured nightly and then thrown away, since a red there blocked
nothing (`cross-service-tests.yml:126-133`). Making it authoritative is what turns "the outbox reaches
*a* broker" into "the outbox reaches *both* the test broker and the production transport's emulator".

The comment (`deploy.yml:934-953`) gives both reasons the run conclusion remains a lying proxy, and they
fail in opposite directions:

1. The run still carries an advisory job, `apphost-smoke`, which is `continue-on-error` per
   [ADR-098](https://ivanball.github.io/docs/adr/098-aspire-orchestration-not-testing-or-dashboards.html)
   (`cross-service-tests.yml:189-204`) and can fail independently, dragging the run to `failure` or
   `cancelled` while both broker proofs genuinely passed. Keying off the run would hide a real, recent
   proof and block every deploy, which is exactly what forced break-glass while the emulator job was
   hanging (2026-07-21 to 2026-07-24).
2. The skip-if-unchanged guard can make a run conclude `success` with the test jobs **skipped**, so no
   round-trip executed. Keying off the run would accept a proof that never happened.

The per-job check is honest in both directions: it counts a run only when both named jobs actually ran
and passed, which is also why a cancelled-but-proven run still counts. And the workflow's own comment
states the counterpart rule for whoever finds this red (`cross-service-tests.yml:135-137`): fix it or
dispatch a green run, do not re-add `continue-on-error` to unblock a deploy. The sanctioned escape hatch
is the break-glass below, which forces a written justification into the run summary.

Its window was widened from 3 to 5 days on 2026-07-18 (`deploy.yml:907-909`) when `cross-service-tests.yml`
moved to weekdays plus the skip-if-unchanged guard: the last successful nightly can legitimately be about
four days old across a weekend or a holiday. A window narrower than the producing cadence is a gate that
fails for calendar reasons, and a gate that fails for calendar reasons trains people to reach for the
break-glass.

**Break-glass** is two `workflow_dispatch` inputs, `skip_freshness_gates` and `skip_justification`, read
by all three jobs. Setting the flag with an empty justification is itself an error and the job exits 1
(`deploy.yml:801-805`); with a justification, the job writes a step-summary block naming the skipped gate
and the reason plus a run annotation, then exits 0 (`deploy.yml:806-814`). Three properties make it a
sound escape hatch rather than a hole: it is unreachable on a push (the inputs exist only on a dispatch),
one flag covers all three gates so an operator in a hurry does not disable them one at a time, and its
cost is a permanent attributable record in the run summary instead of a quiet edit to a `needs:` list.
Note the interaction with `deploy`'s condition (`deploy.yml:1258-1259`, `deploy.yml:1276-1278`): a
broken-glass gate still reports `success`, which is what lets the deploy condition demand `success` from
all three without special-casing.

MMCA.Store runs all three in near-identical form
(`MMCA.Store/.github/workflows/deploy.yml:603`, `:660`, `:716`), and its `deploy` needs list matches
(`MMCA.Store/.github/workflows/deploy.yml:945`), minus the `backend-test-gate` entry, which is an ADC
addition.

[ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html) is the decision record.
[Rubric §29, Resilience, Reliability & Business Continuity] is served by `dr-freshness`: the
[ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) recovery
objectives are only real if the drill that measures them is recent. [Rubric §12, Performance &
Scalability] is served by `load-freshness` for the same reason applied to the capacity baseline.
[Rubric §6, CQRS & Event-Driven Design] is served by `cross-service-freshness`: the outbox-to-broker
delivery path has no in-process test that can falsify it, so its recency is the only continuous evidence
the event pipeline still works end to end, now across both the RabbitMQ round-trip and the Service Bus
emulator that mirrors the production transport.

### Job: `foundation`, Phase 1

```yaml
# deploy.yml:1089-1104
foundation:
  needs: changes
  if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true'
  environment: production
  outputs:
    acrName: ${{ steps.foundation.outputs.acrName }}
    acrLoginServer: ${{ steps.foundation.outputs.acrLoginServer }}
    logAnalyticsName: ${{ steps.foundation.outputs.logAnalyticsName }}
```

`infra/foundation.bicep` (`deploy.yml:1115-1121`) provisions the durable resources that must exist
before a container image can be pushed at all: the Log Analytics workspace
(`infra/foundation.bicep:28-29`) and the Basic-tier Azure Container Registry
(`infra/foundation.bicep:50-56`), whose admin user is disabled because both the apps (AcrPull) and the
deploy (AcrPush) authenticate as managed identities (`infra/foundation.bicep:58-60`). It was split out
of `deploy` on 2026-07-21 so image builds can run **concurrently with** the roughly 20-minute
`e2e-gate` instead of serially after it (`deploy.yml:1081-1088`).

A third resource rides along, and it is the reason the registry does not grow without bound: a
scheduled ACR task named `purge-old-images` (`infra/foundation.bicep:99-101`) that runs daily at
05:00 UTC (`infra/foundation.bicep:115-121`). Basic-tier ACR has no retention-policy feature, that is
Premium only, so image garbage collection has to be a task rather than a setting
(`infra/foundation.bicep:67-70`). Its encoded YAML runs `acr-cli` twice
(`infra/foundation.bicep:88-97`): the first step ages out tags untouched for 3 days while keeping the
3 most recent per repository, which is enough because a rollback only ever reaches the previous
revision; the second step, added 2026-09-02, targets the `buildcache` repository specifically with
`--ago 1h --keep 10 --untagged`. The comment records what forced the second step
(`infra/foundation.bicep:77-87`): `mode=max` cache exports write one tag per image, refreshed on every
deploy and therefore never old enough for the 3-day rule, behind a large tree of untagged layer
manifests that nothing swept. That backlog had reached about 111 GB and carried registry storage to
74 GB against the 10 GB the Basic tier includes. `--keep 10` is deliberately larger than the six live
cache tags, so the step can never delete a tag the next build is about to read.

[Rubric §31, Cost Efficiency / FinOps] is served in the form that matters for a registry: the
expensive thing is not the images you can see, it is the manifests nothing references and nothing
deletes.

The safety argument for running infrastructure before the gates is stated in the same comment and is
worth internalizing: `foundation.bicep` provisions no container apps, no SQL and no traffic-facing
resource, so applying it early cannot affect the live app, and it is an idempotent incremental deploy that
is a no-op on every run after the first. "Runs before the gates" is only acceptable because "cannot
change what users see" is a property of the template, not a hope.

Its three outputs are promoted to **job** outputs (`deploy.yml:1100-1104`) for a concrete reason: `acrName`
is derived inside Bicep from `uniqueString(resourceGroup().id, environmentName)` and therefore cannot be
recomputed by a later job. A downstream job either receives it or guesses wrong.

**`environment: production` is load-bearing here, and not for approvals** (`deploy.yml:1094-1099`). The
federated identity credential's subject is `repo:ivanball/ADC:environment:production`. A job without an
`environment:` presents `repo:ivanball/ADC:ref:refs/heads/main` instead, and `azure/login` fails with
AADSTS700213, "No matching federated identity record". Every job that runs `azure/login` needs the
declaration. The comment even cites the run that proved it on MMCA.Store. This is the single most
transferable OIDC gotcha in the repository.

### Job: `build-images`, Phase 2

Six images are built and pushed, one per matrix leg (`deploy.yml:1150-1171`): `mmca-adc-gateway`,
`mmca-adc-ui`, `mmca-adc-conference`, `mmca-adc-identity`, `mmca-adc-engagement`,
`mmca-adc-notification`. The Gateway and UI Dockerfiles live under `Source/Hosts/`
(`Source/Hosts/MMCA.ADC.Gateway/Dockerfile` at `deploy.yml:1155`,
`Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile` at `:1158`); the four back-end services live under
`Source/Services/` (`:1160-1171`). `fail-fast: false` (`deploy.yml:1151`) so one image's failure does not
cancel the other five.

These were previously six sequential `docker build` steps inside `deploy`, measured at 928 seconds on one
run (`deploy.yml:1124-1125`). One matrix leg per image makes the phase cost roughly the **slowest** image
(about 4 minutes) rather than their sum, and because the job no longer sits behind `e2e-gate` the whole
phase hides underneath that gate and leaves the critical path entirely.

**Each leg is now individually gated on whether its image is dirty.** The matrix carries a `changed`
column fed from the `changes` job's `img_*` map (`deploy.yml:1154-1171`), and the build-and-push step only
runs when it is `'true'` (`deploy.yml:1191-1192`). A clean leg takes the other branch and re-tags instead
(`deploy.yml:1225-1232`):

```yaml
az acr import \
  --name ${{ needs.foundation.outputs.acrName }} \
  --source ${{ needs.foundation.outputs.acrLoginServer }}/${{ matrix.image }}:latest \
  --image ${{ matrix.image }}:${{ github.sha }} \
  --force
```

Two things make that safe, and both are worth internalizing. `main.bicep` addresses **every** image by
`:${{ github.sha }}`, so the tag has to exist whether or not anything was rebuilt; `az acr import` is a
registry-side manifest copy, so no layer is pulled or pushed, and `--force` makes a re-run of the same
sha idempotent. And the leg **still concludes `success`** rather than skipping, which is the load-bearing
part: `deploy` gates on the job-level equality `needs.build-images.result == 'success'`
(`deploy.yml:1281`), so gating with a job-level `if` (or letting a leg skip) would turn the whole job
`skipped` and silently cancel the deploy (`deploy.yml:1138-1142`).

Nothing is rolled out here (`deploy.yml:1128-1131`). Images are tagged with both `${{ github.sha }}` (the
exact commit, immutable and traceable) and `latest`, and pushed to ACR (`deploy.yml:1199-1201`), but
`deploy` still waits on every gate before `main.bicep` points any container app at them. A red gate
therefore leaves an unreferenced image in ACR, which the scheduled purge task in `foundation.bicep`
reaps. Building speculatively is only safe when publishing and *referencing* are separate acts.

**The token is a BuildKit secret, not a build arg** (`deploy.yml:1207-1208`, comment `:1133-1136`):

```yaml
secrets: |
  github_token=${{ secrets.GITHUB_TOKEN }}
```

`--build-arg` bakes a value into the image layer where `docker history` can read it back; a BuildKit
secret is mounted only for the `RUN` steps that need it (restore and publish) and never enters a layer.
`DOCKER_BUILDKIT=1` is set explicitly so the requirement fails loudly rather than silently degrading. The
comment adds a detail worth keeping (`deploy.yml:1202-1206`): secret *content* is not part of the cache
key (only the instruction text is), so rotating the token does not needlessly bust the restore layer,
which is safe because the package set is pinned by the committed lock files and a
`Directory.Packages.props` change lands in the same `COPY` layer and busts it anyway.

**The layer cache is in ACR, not `type=gha`** (`deploy.yml:1215-1216`), and the comment
(`deploy.yml:1209-1214`) is a small masterclass in cache sizing. The GitHub Actions cache has a hard 10 GB
per-repo quota with LRU eviction; six images exporting `mode=max` multi-stage SDK layers plus a large
NuGet layer each would thrash it into a near-zero hit rate while still paying the export cost. The
registry the job already authenticates to has no quota and costs pennies. `mode=max` rather than `min` is
required because `min` caches only the final stage, which is exactly the one that is cheap: the expensive
layers are restore and publish, inside the build stage. Buildx with the `docker-container` driver
(`deploy.yml:1185-1189`) is what makes an external cache possible at all, since the default driver cannot
import or export one.

[Rubric §17, DevOps & Deployment] is served: each image is uniquely identified by the commit SHA,
making every deployment fully traceable to its source code. [Rubric §11, Security] is served by the
BuildKit-secret handling: no credential is recoverable from a published layer.

### Job: `deploy`

Runs only on push to `main` or `workflow_dispatch`, never on pull requests, and only when every gate
above has reported. Its `needs` list is the pipeline in one line (`deploy.yml:1237`):

```yaml
needs: [changes, supply-chain, cost-guard, dr-freshness, load-freshness,
        cross-service-freshness, cross-browser-freshness, e2e-gate, backend-test-gate,
        ai-eval-gate, foundation, build-images]
```

Note what is *not* there: `build-and-test`, `integration-tests` and `coverage`. Those are the required PR
checks, and with strict branch protection the PR validated the exact merge tree, so they are not re-run on
the push (`deploy.yml:1238-1250`).

The condition itself (`deploy.yml:1269-1284`) is `always()` plus an explicit result check per dependency
rather than the default `success()` semantics, and the comment records the incident that forced it
(`deploy.yml:1256-1259`). Because `e2e-gate` is `ui`-scoped, it legitimately **skips** on a backend-only
merge, and under `success()` a skipped dependency cascades into a skipped `deploy`: a run went fully green
and shipped nothing. So every unconditional gate must be `success` (none of them ever skip on a push,
since the freshness break-glass exits success inside the step), while the **three conditional** gates may
be `success` **or** `skipped`: `e2e-gate` (`deploy.yml:1282`), `backend-test-gate` (`deploy.yml:1283`)
and `ai-eval-gate` (`deploy.yml:1284`). The third is conditional only in form: it runs on any code diff,
so on a code deploy it never actually skips, and its skipped arm covers only the docs-only path where
this job does not run at all (`deploy.yml:1261-1264`).

The comment spells out why allowing two skippable gates does not reopen the hole (`deploy.yml:1261-1268`):
their conditions are exact complements over a code deploy, so exactly one of them runs every time, and the
invariant "no production deploy without test execution" holds without either gate being made
unconditional. The post-deploy smoke gate is a second line of defence rather than the only backend
backstop.

That is the general lesson: `needs` expresses ordering, but "did this dependency actually pass" and "did
this dependency run" are different questions, and default `success()` semantics answer them together.

The job declares `environment: production` (`deploy.yml:1285`) and opens with a checkout and its own
`azure/login@v3` (`deploy.yml:1287-1294`), for the federated-credential reason described under
`foundation`. Everything below is Phase 3 onward.

**Phase 3, Deployment parameters file** (`deploy.yml:1299-1487`):

Rather than passing `key=value` pairs inline to `arm-deploy`, the step builds a JSON parameters file
from scratch using `jq` (there is no committed parameters template, see the IaC chapter's note that
`infra/main.parameters.json` does not exist). The `jq --arg` flag properly JSON-escapes multiline values (critical for the RSA PEM keys,
which contain newlines). The base parameter set is always present (`deploy.yml:1352-1380`), including the
six SHA-tagged image references read from `needs.foundation.outputs.acrLoginServer`. Optional parameters
(OAuth credentials, Anthropic API key, SMTP config, the synthetic-traffic key, managed-identity SQL
settings) are conditionally appended only if their env vars are non-empty:

```bash
# deploy.yml:1390-1393
if [ -n "$OAUTH_GITHUB_CLIENT_ID" ]; then
  jq --arg k "$OAUTH_GITHUB_CLIENT_ID" '.parameters.githubOAuthClientId = {"value": $k}' ...
fi
```

This pattern means the deployment is not blocked if an optional secret has not been configured, it
simply omits that parameter, and the Bicep template's `@secure()` `param` falls back to its default
(typically an empty string, which disables the feature). Sign in with Apple is the clearest example: all
four pieces (`client id`, `team id`, `key id`, private key PEM) are appended independently
(`deploy.yml:1409-1425`), and the provider only activates when the template receives the full set.

**Two parameters are deliberately not optional, and both are fail-fast.** The step's first action is a
check on an unset `ALERT_EMAIL` repo variable (`deploy.yml:1326-1332`), whose error message states the
reasoning: alerts that notify nobody are silent failures, so `infra/main.bicep` *requires*
`alertEmailAddress` and the deploy refuses to proceed rather than shipping SLO, outbox and availability
alerts into the void. The second is the RSA key pair (`deploy.yml:1334-1340`): Identity signs RS256 and
publishes `/.well-known/jwks.json` from those keys, there is no other signing path, and `main.bicep`
declares both parameters without a default, so an unset `JWT_RSA_PRIVATE_KEY_PEM` or
`JWT_RSA_PUBLIC_KEY_PEM` fails here rather than producing an Identity service that cannot mint a token.
The keys are then appended unconditionally (`deploy.yml:1382-1387`). Catching both here turns an opaque
Bicep validation error into an actionable one naming the variable or secret to set.

The **synthetic-traffic key** (`deploy.yml:1455-1461`) is a small but instructive optional parameter. It
carries the shared secret the Gateway's edge rate limiter accepts as a bypass, and `load-test.yml` sends
the same value as an `X-Synthetic-Traffic-Key` header, so the monthly k6 capacity proof measures backend
capacity rather than the per-IP rate-limit window
([ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html) amendment). Unset
leaves the bypass off, which is the correct default: a rate-limit bypass that exists by default is not a
rate limiter.

The managed-identity SQL parameters (`deploy.yml:1469-1487`) are the opposite case, optional and
default-off by design: without the `SQL_AAD_ADMIN_LOGIN`, `SQL_AAD_ADMIN_OID` and
`USE_MANAGED_IDENTITY_SQL` repo variables, `main.bicep` keeps its defaults (no Entra admin, password
auth) and the deploy is unchanged. The comment stages the rollout and warns that flipping
`USE_MANAGED_IDENTITY_SQL=true` before the per-database grants exist costs the apps their SQL
connectivity (`deploy.yml:1481-1483`).

There is an important SQL location note in the Bicep parameters step (`deploy.yml:1344-1349`): Azure SQL
is region-gated on the QiMata Sponsorship subscription, `eastus2` (where `acc-rg` lives) does not
allow `Microsoft.Sql`, so SQL Server and databases are deployed to `westus2` while Container Apps remain
in the RG's location. The `SQL_LOCATION="${SQL_LOCATION_OVERRIDE:-westus2}"` line (`deploy.yml:1349`)
defaults to `westus2` but honors the `AZURE_SQL_LOCATION` repo variable (passed in as
`SQL_LOCATION_OVERRIDE` at `deploy.yml:1302`) so a different subscription or region can override it.

**Phase 3 (continued), Application infrastructure** (`deploy.yml:1489-1495`):

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

**Phase 4, Database migrations: there is no sqlcmd backstop** (`deploy.yml:1497-1507`):

Phase 4 is a comment block, not a step. The deploy **deliberately does not run an external `sqlcmd`
migration step**. Each service self-applies its own migrations at startup
(`ApplicationSettings__DatabaseInitStrategy=Migrate`) as the **sole migrator**, and `minReplicas: 1`
guarantees exactly one replica migrates before the revision serves. The comment (`deploy.yml:1498-1507`)
records *why* the previous backstop was removed: a `sqlcmd` step here would race the container's startup
`Migrate()` on a fresh per-service DB, both applying the same `InitialCreate` concurrently and
non-atomically, leaving a table created **without** its `__EFMigrationsHistory` row (Msg 2714 "object
already exists" on every retry, exactly what wedged MMCA.Store's first per-service deploy). The
build-and-test model-drift gate still guarantees a migration exists for every model change, so removing
the backstop does not weaken the schema-safety story.

[Rubric §8, Data Architecture] and [Rubric §17, DevOps & Deployment] are both served here: per-service,
single-applier, idempotent-by-construction migration is the data-architecture discipline made operational
without a racing dual-applier.

**Phase 5, Revision-activation gate plus post-deploy smoke gate with automatic rollback**
(`deploy.yml:1509-1670`):

Phase 5 is **two gates in one step**, in a deliberate order, because they answer different questions
(`deploy.yml:1509-1530`).

**5a, the revision-activation gate** (`deploy.yml:1555-1596`) is the newer half, and it exists because of
a four-day production incident. For every app, the **newest** revision by `createdTime` must report
`healthState` `Healthy`, `runningState` `Running` or `RunningAtMaxScale`, and `trafficWeight` 100. The
predicate is factored into its own helper so the rollback below can reuse it (`deploy.yml:1569-1573`),
and the poll is thirty attempts at twenty seconds, ten minutes per app (`deploy.yml:1576-1587`):

```bash
# deploy.yml:1560-1566
revision_status() {
  local app="$1" json
  json=$(az containerapp revision list -g "$RG" -n "$app" \
    --query "reverse(sort_by(@, &properties.createdTime))[0].[name, properties.healthState, properties.runningState, properties.trafficWeight]" \
    -o json 2>/dev/null || echo "null")
  printf '%s' "$json" | jq -r 'if type == "array" then map(if . == null then "" else . end) | @tsv else "" end' 2>/dev/null || echo ""
}
```

That proves the code just built is the code now serving, and the HTTP probes below **cannot** prove it.
The comment names the incident that made the gap concrete (`deploy.yml:1512-1521`): every probe enters
through the Gateway, and a healthy Gateway keeps serving from the *previous* backend revision when the new
one never goes ready. So an untagged Aspire Redis health check running `CLUSTER INFO` against Azure
Managed Redis made `/health/ready` throw on every probe, every backend revision reported
`ActivationFailed`, the older revision kept 100% of the traffic, every probe answered 200 or 401 from the
old code, and this step reported success on each deploy for four days (2026-08-29 to 2026-09-02).

The `-o json` plus `jq` shape is itself a fix, and the comment states the trap plainly
(`deploy.yml:1555-1559`): a **top-level** JMESPath multiselect list rendered with `-o tsv` prints one
element **per line**, not one tab-separated row. The positional `read` therefore captured the revision
name and left health, running state and traffic weight empty, and the gate failed every app on a
perfectly healthy fleet. Fetching JSON and letting `jq` join it (with nulls mapped to empty strings so
the field count never collapses) is what makes the positional read honest. The transferable lesson is
the one the outage taught: a smoke test that reaches your system through a load balancer verifies
*something is serving*, not *your new code is serving*, and only the control plane can tell you which.

**5b, the reachability probes** (`deploy.yml:1598-1609`) are the older half, six endpoints covering every
deployable:
```bash
probe "https://${GATEWAY_FQDN}/health"
probe "https://${GATEWAY_FQDN}/.well-known/jwks.json"
probe "https://${GATEWAY_FQDN}/Events"
probe "https://${GATEWAY_FQDN}/Bookmarks" 401
probe "https://${GATEWAY_FQDN}/Notifications/inbox" 401
probe "https://${UI_FQDN}/"
```

Each probe polls up to 12 times (10-second intervals, 15-second curl timeout, `deploy.yml:1544-1553`),
two minutes total per endpoint. Together they exercise Container Apps routing (Gateway `/health`),
Identity (JWKS, which must have reached its database and loaded its RSA keys), Conference (anonymous
`GET /Events`), Engagement (`/Bookmarks`), Notification (`/Notifications/inbox`), and the Blazor UI host.
The comment (`deploy.yml:1523-1527`) notes the probe set mirrors `e2e.yml`'s warm-up URLs, which is what
makes it a backend backstop behind both `e2e-gate` and `backend-test-gate`.

**The two `401` expectations are the interesting part.** `probe` takes an expected status defaulting to
200, and for the auth-gated Engagement and Notification endpoints the asserted status is *exactly* 401
(`deploy.yml:1541-1543`, `:1604-1607`). A 401 from the service is the healthy signal: it proves the
request traversed Gateway to service to auth pipeline. A 5xx, a 404, or a `000` connection failure does
not. Accepting "any non-2xx" would have made those two probes unfalsifiable, which is the failure mode a
smoke test can least afford.

If **either** gate fails, the rollback path (`deploy.yml:1625-1670`) activates, and it now carries two
guards that the original loop did not.

**Guard 1 re-reads the app before rolling it back** (`deploy.yml:1631-1638`). The rollback loop runs
once for the whole fleet, but the smoke gate can fail for a reason that has nothing to do with a given
app, so each iteration re-checks that app's newest revision through the same `revision_serving`
predicate and skips it when it is already healthy, running and taking 100% of the traffic. Without that
check, one failed probe would take five healthy apps down with it.

**Guard 2 is in the query that picks the target revision** (`deploy.yml:1639-1650`):
```bash
prev=$(az containerapp revision list -g "$RG" -n "$app" \
  --query "reverse(sort_by([?properties.provisioningState=='Provisioned' && properties.healthState=='Healthy' && properties.active==\`true\`], &properties.createdTime))[?name!='${newest}'] | [0].name" ...)
az containerapp revision copy -g "$RG" -n "$app" --from-revision "$prev" -o none
```
Three filters, each correcting a way the choice could go wrong. The original query took index `[1]` of
all *provisioned* revisions, which is only correct when the newest revision is the broken one, and a
revision that failed activation is still `Provisioned`, so `healthState == 'Healthy'` is what keeps the
selection honest. Excluding the newest **by name** keeps it correct in the other case, where the newest
is healthy and the probes failed for some other reason. And `properties.active == true` is what stops
a *deactivated* old revision, which is exactly what a **successful** activation leaves behind, from
being copied back; the incident this gate was written for had the old revision still active and healthy
alongside the failed new one, which is why the earlier query looked correct.

The loop attempts every app before reporting, so one app's rollback failure does not abandon the other
five (`deploy.yml:1626-1628`), but a partial rollback is then reported loudly: the names of the apps that
failed to roll back are written to the Step Summary under "Smoke gate failed AND rollback incomplete"
(`deploy.yml:1661-1666`). The comment states the principle directly, a fleet split across revisions needs
immediate manual attention and must never look like a clean auto-revert. Either way the job exits 1
(`deploy.yml:1670`).

There is also an informational security-headers check (`deploy.yml:1611-1618`, labeled TD-09) that
confirms the Gateway emits `X-Content-Type-Options: nosniff`. This check is explicitly non-gating (it
cannot trip the rollback) because a missing header is a hardening gap, not a "revision not serving"
condition.

[Rubric §29, Resilience, Reliability & Business Continuity] is directly embodied: the activation and smoke
gates with automatic rollback mean a broken deploy is both detected and partially self-corrected within
minutes. [Rubric §13, Observability & Operability] (assesses whether failures surface actionable signals)
is served: the activation loop prints each app's newest revision with its health, running state and
traffic weight on every attempt (`deploy.yml:1580`), the workflow fails loudly with the specific failing
endpoint printed, and the rollback log names each app and its rollback revision.

**Post-deploy, reclaiming BuildKit cache storage** (`deploy.yml:1672-1690`):

The last step in the job is housekeeping, not a gate:

```bash
az acr run \
  --registry ${{ needs.foundation.outputs.acrName }} \
  --cmd "acr purge --filter 'buildcache:.*' --ago 1h --keep 10 --untagged" \
  /dev/null
```

It runs the same `buildcache` purge the scheduled ACR task in `foundation.bicep` runs daily, but right
after the deploy that created the garbage. The comment gives the reason (`deploy.yml:1672-1677`): every
`cache-to=...,mode=max` push orphans the previous deploy's untagged cache manifests, and reclaiming them
within minutes rather than within a day is what keeps a Basic-tier registry under its 10 GB included
storage instead of paying overage on a day's worth of them.

Two details are deliberate. It is `continue-on-error: true` (`deploy.yml:1684`) because it runs *after*
the rollout and the smoke gate, so a throttled ACR task or a transient auth failure must never fail a
deploy that has already shipped successfully. And the `/dev/null` argument is the build context, which
`az acr run` requires positionally and this command does not use (`deploy.yml:1681-1682`).

[Rubric §31, Cost Efficiency / FinOps] is served by the pairing rather than by either half: the
scheduled task is the floor that catches everything, and this step is the fast path for the garbage the
deploy just produced.

---

## MMCA.ADC, `e2e.yml`

**File:** `MMCA.ADC/.github/workflows/e2e.yml`

### What it is

The full-stack Playwright E2E test workflow. It brings up the complete Aspire stack (SQL Server + Redis +
RabbitMQ + four services + Gateway + UI) inside the CI runner, then runs the Playwright suite against it
across a `chromium`/`firefox`/`webkit` matrix.

[Rubric §28, Front-End Testing & Quality] (assesses whether browser-level tests cover real user
journeys in a production-like environment) is the primary category this workflow serves.

### Triggers, three entry points including the deploy gate

```yaml
# e2e.yml:27-50
on:
  workflow_dispatch:
  workflow_call:
    inputs:
      browsers:
        description: 'JSON array of Playwright engines to run (defaults to the full matrix)'
        required: false
        type: string
  schedule:
    - cron: "0 7 * * 1"
    - cron: "0 7 * * 4"
```

Three ways in, and the engine set differs in each. **`workflow_call`** is the deploy gate: `deploy.yml`'s
`e2e-gate` job calls this workflow with `browsers: '["chromium"]'`, the §28 merge-gate promotion of
2026-07-02 (`e2e.yml:7-12`). **`workflow_dispatch`** runs the full three-engine matrix so a manual run can
reproduce anything. **`schedule`** runs one engine per night, alternating.

The alternating schedule is worth reading closely, because the mechanism is not obvious
(`e2e.yml:135-138`):

```yaml
browser: ${{ fromJson(inputs.browsers
  || (github.event.schedule == '0 7 * * 1' && '["firefox"]')
  || (github.event.schedule == '0 7 * * 4' && '["webkit"]')
  || '["chromium", "firefox", "webkit"]') }}
```

The two crons are written as **separate entries** rather than a combined `0 7 * * 1,4` precisely so the
matrix can branch on `github.event.schedule`, which carries the exact cron string that fired. Monday runs
firefox, Thursday runs webkit. The `inputs` context is empty on non-call events, so the fallback chain
resolves for dispatch and schedule alike.

Each narrowing was a deliberate cost trade with its reasoning recorded (`e2e.yml:37-48`,
`:125-134`). The schedule was cut from Mon-Fri to twice weekly on 2026-07-24: at five nights times about
25 minutes per leg it was the single largest billed line item in the repo, and twice a week still catches
an engine-specific regression well inside a release cycle. Alternating engines followed on 2026-07-29,
halving the nightly spend from roughly 100 to 50 minutes a week while still exercising each engine every
week. And chromium is off the nightly entirely, because every push to `main` already runs a full chromium
leg through `e2e-gate`, so a scheduled chromium leg would re-test an already-tested tree. What the nightly
uniquely buys is the *other two* engines.

`continue-on-error` encodes the same split (`e2e.yml:144`):

```yaml
continue-on-error: ${{ github.event_name == 'schedule' && matrix.browser != 'chromium' }}
```

Note the `event_name` clause. On the **scheduled** nightly, non-chromium legs stay advisory so a one-off
engine flake alerts without blocking anything. In the **deploy gate** (where `event_name` is the caller's
push or dispatch) every invoked engine can fail the gate, promoted 2026-07-16 after eight consecutive
fully-green nightly matrices (`e2e.yml:139-143`). The same matrix leg is advisory or blocking depending on
why it ran, which is exactly the distinction a single boolean would have flattened.

`E2E_BROWSER` is set from `matrix.browser` and consumed by `MMCA.Common.Testing.E2E`'s
`PlaywrightFixture`.

The concurrency block reads the same distinction one more time (`e2e.yml:62-64`). The group is keyed on
`github.event_name` as well as the ref, and `cancel-in-progress` is true only for `schedule` and
`workflow_dispatch`. A `workflow_call` from `deploy.yml` surfaces here as the **caller's** push or
dispatch event, so a deploy-gating leg is never cancelled by a later nightly or a flake re-run, while
cheap re-runs of the nightly still supersede each other (`e2e.yml:59-61`). Cancelling a gate that a
production deploy is waiting on would not save minutes, it would fail the deploy.

### Job: `should-run`, the skip-if-unchanged guard

A five-minute pre-job (`e2e.yml:86-109`) that compares the default branch's head SHA against the head SHA
of the last **successful** run of this workflow. If they match, there is nothing new to soak and the
matrix is skipped. Any non-schedule event returns `run=true` immediately (`e2e.yml:97-99`), so a manual
dispatch and the deploy gate always run.

This guard is the reason `deploy.yml`'s `cross-service-freshness` cannot trust a run **conclusion**: the
sibling `cross-service-tests.yml` carries the same guard, and a skipped matrix still concludes `success`.
It is also why this workflow needs `actions: read` (`e2e.yml:55-57`), and by extension why `deploy.yml`
has to grant it too.

### Job: `e2e` (120-minute timeout, cross-browser matrix)

The 120-minute timeout (`e2e.yml:120`) is a spend guard, not a pace budget, and the comment explains the
raise from the previous 50 (`e2e.yml:116-119`): full-time tracing slows the suite, and a retry-heavy night
burns one to two minutes per failed try, so a 2026-07-02 nightly hit a 70-minute cap mid-retry with 21
first-pass failures. A cap that cancels a run destroys the pass/fail count you needed; 120 lets even a bad
night finish and report real numbers. The matrix is `fail-fast: false` (`e2e.yml:123`) so one engine's
flake does not cancel the others.

**Step 1, Trust the dev HTTPS certificate** (`e2e.yml:157-158`):
```bash
dotnet dev-certs https --trust || dotnet dev-certs https
```
The `--trust` flag only succeeds on a runner that supports certificate trust stores (Linux runners may
not). The `|| dotnet dev-certs https` fallback generates the certificate without trusting it. Playwright
probes use `-k` (skip verification) for the HTTPS UI endpoint, so the certificate does not need to be
trusted for the test suite, the certificate only needs to exist so the Aspire AppHost can bind to HTTPS.

**Step 2, Build** (`e2e.yml:160-168`):
```bash
dotnet build Source/Hosting/MMCA.ADC.AppHost -c Release
dotnet build Tests/E2E/MMCA.ADC.E2E.Tests -c Release
```
Both project graphs are built directly (not via the `.slnx`) to avoid pulling in the MAUI UI project,
which requires a `maui-android` workload not available on standard Ubuntu runners (`e2e.yml:161-163`
comment). `GITHUB_TOKEN` is passed for NuGet restore of MMCA.Common packages. The setup step above caches
`~/.nuget/packages` on the committed lock files (`e2e.yml:152-155`), which is worth the key precisely
because this leg sits on the deploy critical path.

**Step 3, Cache and install Playwright browsers** (`e2e.yml:174-190`):
The same cache-then-branch pattern as `MMCA.Common/ci.yml`'s `ui-e2e` job, with the matrix browser engine.
Binaries run 100 to 300 MB per engine, so `PLAYWRIGHT_BROWSERS_PATH` redirects the install into the
workspace where `actions/cache` can carry it (`e2e.yml:77-80`), and the key includes the engine because
each leg installs only its own. On a cache hit the step runs `install-deps` rather than `install
--with-deps` (`e2e.yml:184-190`): the OS-level shared libraries live outside the cached directory, so a
restored cache still needs the cheap half.

**Step 4, Start the Aspire stack** (`e2e.yml:192-222`):
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

Two further env exports in the same step shape how the suite runs.
`E2E_LIFT_REGISTRATION_THROTTLE=true` (`e2e.yml:211`) lifts Identity's BR-213 registration throttle, which
would otherwise 401 the suite's many register-from-one-IP accounts past the default of 10 per hour.
`E2E_FORCE_SERVER=true` (`e2e.yml:218`) pins the UI to InteractiveServer for the suite while production
stays InteractiveAuto: under InteractiveAuto each test's second page load switches to the
background-downloaded WASM bundle, whose runtime boot on a 2-core runner exceeds every suite wait. The
comment (`e2e.yml:204-210`) is emphatic that the opposite fix, forcing WASM outright, was tried and is
unviable in CI, because the Blazor readiness signal passes during prerender and the tests then interact
with a dead DOM: no click lands, no error appears, and the suite stalls to the job cap with zero passes.
It is a good reminder that a readiness signal which fires before the page is interactive is worse than no
signal.

[Rubric §11, Security] is served: the ephemeral keypair is generated fresh per run (no long-lived key
material in secrets), and the private key file is deleted before any subsequent step runs.

**Step 5, Wait for the stack (per-service readiness gate)** (`e2e.yml:224-247`):
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

**Step 6, Warm up services incl. the login path** (`e2e.yml:249-291`): a best-effort step (never fails
the job) that JITs each service's hot path before the timed suite, two passes over nine Gateway endpoints
covering all four services (`e2e.yml:260-269`, where Engagement's `/Bookmarks` and Notification's
`/Notifications/inbox` answer 401 and still warm their request pipeline), plus a **real admin login POST**
to `/Auth/login` that exercises Identity's DB user-lookup + password-hash verify + RS256 signing (the
dominant cold-start login-timeout culprit a UI-only warm-up never touched), and a prerender warm-up of the
UI host's `/`, `/login`, `/register`. It closes by capturing a verbose Gateway-to-Conference probe into
`artifacts/conference-probe.txt` for cross-referencing against the service logs (`e2e.yml:284-290`).

**Step 7, Run E2E tests** (`e2e.yml:293-329`):
```yaml
env:
  E2E_BASE_URL: ${{ env.UI_URL }}
  E2E_HEADLESS: "true"
  E2E_BROWSER: ${{ matrix.browser }}
  WEB_VITALS_OUTPUT_DIR: ${{ github.workspace }}/artifacts
  E2E_TIMEOUT: "45000"
  E2E_AUTH_TIMEOUT: "60000"
  E2E_TRACE: ${{ github.workspace }}/artifacts/traces/
run: >-
  dotnet test --project Tests/E2E/MMCA.ADC.E2E.Tests/MMCA.ADC.E2E.Tests.csproj
  -c Release --no-build
  --retry-failed-tests 2 --retry-failed-tests-max-percentage 40
```
`E2E_BASE_URL` points the Playwright tests at the live Aspire-hosted UI. `E2E_TIMEOUT: 45000` (raised from
20000) absorbs residual first-navigation cold-start latency on a 2-core runner, and `E2E_AUTH_TIMEOUT:
60000` gives the auth round-trip its own headroom (`e2e.yml:306-315`). `--retry-failed-tests 2
--retry-failed-tests-max-percentage 40` (MTP's retry extension) re-runs only the failed tests up to twice,
but skips retry when more than 40% of tests fail (a real breakage, not a contention spike). No coverage is
collected here because the app runs out-of-process (the in-process integration tier in `deploy.yml` is the
backend coverage signal, `e2e.yml:294-297`).

Two of those env vars are outputs rather than settings. `WEB_VITALS_OUTPUT_DIR` (`e2e.yml:302-304`) is
where `WebVitalsTests` writes its client-side measurements, so the [Rubric §12, Performance &
Scalability] budgets are enforced inside the deploy-gating chromium leg rather than only by the monthly
k6 run. `E2E_TRACE` with its **trailing slash** selects directory mode, one `<TestName>.zip` per *failed*
test (`e2e.yml:316-321`), which is what makes a red run diagnosable offline instead of by re-running it.

**Steps 8 to 10, Collect logs, stop stack, upload diagnostics** (`e2e.yml:331-361`): on `always()` the job
collects each service's Serilog file into `artifacts/service-logs` (`e2e.yml:331-345`) and kills the
AppHost (`e2e.yml:347-349`). The upload, however, is **failure-only** (`if: failure()`, `e2e.yml:355`)
with a 3-day retention: the bundle runs about 350 MB per browser, and a green run produces no per-test
traces and needs no offline triage. Because the collect step still runs on `always()`, a startup failure
where no test ran at all is exactly the case that does get its artifact.

[Rubric §33, Developer Experience & Inner Loop] is served: the diagnostics upload makes CI failures
diagnosable without local reproduction of the full Aspire stack.

---

## MMCA.ADC, `cost-guard.yml`

**File:** `MMCA.ADC/.github/workflows/cost-guard.yml`

### What it is

A read-only FinOps check that confirms the production Azure footprint is at its cost baseline. It detects
a specific operational anti-pattern: a conference-day surge scale-up (SQL tier upgrade + higher Container
App replica caps) that was never reverted after the event. It runs weekly on a cron **and** as a reusable
workflow called by `deploy.yml`'s `cost-guard` job, so the same check is both a Monday report and a
production deploy gate.

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
revert and produces a GitHub workflow failure (which notifies via GitHub) every Monday until it is fixed,
and since its promotion to a `deploy.yml` gate it also blocks every production deploy in between
(`MMCA.ADC/infra/OPERATIONS.md:162`).

The 2026 conference-day memory (`project_adc_2026_actual_load.md`) records that the surge was
over-provisioned relative to actual load. The cost-guard exists in part because the cost of a forgotten
surge is non-trivial: SQL Server Standard S4 costs roughly 60× more per DTU than Basic tier.

### Triggers

```yaml
# cost-guard.yml:10-17
on:
  schedule:
    - cron: "0 7 * * 1" # Mondays 07:00 UTC
  workflow_dispatch:
  workflow_call:
```

Weekly on Monday mornings (UTC), early in the work week so a drift is noticed promptly, with time to
investigate before the next week. `workflow_dispatch` allows a manual run at any time (e.g. to verify
that a revert applied correctly). The bare `workflow_call` (`cost-guard.yml:14-17`) is what promotes the
check to a deploy gate: it takes no inputs, so the deploy pays only the invocation, and the comment notes
that being read-only is what makes it safe to run on the deploy path.

### Job: `surge-drift`

**Environment: `production`** (`cost-guard.yml:32`): this scopes the OIDC token to the same federated
credential as `deploy.yml`, giving the read-only Azure CLI calls access to the production resource group
without a separate credential. As with `deploy.yml`'s own jobs, the declaration is required for the token
subject to match, not merely for an approval gate.

**Step, Check replica caps and SQL tiers** (`cost-guard.yml:41-86`):

```bash
BASELINE_MAX_REPLICAS: "2"   # cost-guard.yml:25

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
(`cost-guard.yml:82-85`), but it does not attempt to downscale automatically. The operator must choose how
to revert (typically by re-running `deploy.yml`, which re-applies the Bicep baseline). Since the same run
is what `deploy.yml`'s `cost-guard` job invokes, an un-reverted surge now also blocks the next production
deploy until it is reset.

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
defined capacity thresholds) is the primary category served. The workflow header comment (`load-test.yml:3-6`)
describes it as "a repeatable k6 load test against the public, output-cached Conference read endpoints
through the Gateway. Read-only and safe against prod."

### Measuring capacity, not the rate limiter

The header carries a second paragraph that is the most instructive thing in the file
(`load-test.yml:8-11`). The run identifies itself to the Gateway's edge rate limiter with an
`X-Synthetic-Traffic-Key` header, carrying `SYNTHETIC_TRAFFIC_SECRET` and matched against
`GatewayRateLimiting:SyntheticTrafficSecret`
([ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html) amendment). The
reason is a measurement problem, not a policy one: a k6 run sends every request from one runner, so one
IP, and without the bypass the number the test reports is the per-IP rate-limit window rather than
backend capacity. The same secret is passed into `main.bicep` by `deploy.yml`
(`deploy.yml:1455-1461`), so the bypass exists in production only when it has been configured
deliberately. The bypass changes nothing else: the test stays read-only and never mutates.

### Why only the Conference read endpoints?

The Conference module's read endpoints (events, sessions, speakers, rooms, categories) are output-cached
with 5-minute TTL and tag-based invalidation. They are the highest-traffic paths under conference-day
load, and they are read-only (safe to hammer in production). The Engagement write endpoints (bookmarks)
and Identity endpoints (auth) have different performance profiles and carry real-write risk, they are
not targeted by this load test.

### Triggers

```yaml
# load-test.yml:13-23
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

**Environment: `production`** (`load-test.yml:37`): OIDC-scoped to the production federated credential
so the Azure CLI step can discover the Gateway FQDN from the resource group.

**Step, Resolve target URL** (`load-test.yml:48-61`):
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
it discovers the target at runtime. An unresolvable FQDN exits 1 rather than proceeding against an empty
URL (`load-test.yml:57`). An explicit `base_url` input allows targeting a non-production environment
(e.g. a staging slot) without modifying the workflow.

**Step, Run k6** (`load-test.yml:63-70`):
```bash
docker run --rm -i \
  -e BASE_URL='${{ steps.target.outputs.url }}' \
  -e PEAK_VUS='${{ inputs.peak_vus || '40' }}' \
  -e SYNTHETIC_TRAFFIC_KEY='${{ secrets.SYNTHETIC_TRAFFIC_SECRET }}' \
  -v "$PWD/Tests/Load/k6:/scripts" \
  grafana/k6 run /scripts/conference-read-load.js
```
k6 runs in Docker (`grafana/k6` image), with the k6 script directory mounted as a volume. `BASE_URL`,
`PEAK_VUS` and `SYNTHETIC_TRAFFIC_KEY` are passed as environment variables into the k6 runtime, the last
of which the script sends as the `X-Synthetic-Traffic-Key` header described above. The k6 script is at
`Tests/Load/k6/conference-read-load.js`. Note: the content of the k6 script (thresholds, ramping
profile, endpoint list) is not determinable from the workflow file alone, it lives in the script.

The `|| '40'` fallback in `PEAK_VUS` (`load-test.yml:67`) is a safety net: if the scheduled run (which
has no `inputs.peak_vus` value because inputs are only set on `workflow_dispatch`) reaches this
expression, it defaults to 40 VUs rather than empty, which k6 would interpret as 0.

[Rubric §12, Performance & Scalability] is served: the load test documents the observed conference-day
peak as the benchmark VU count and verifies the system can sustain it within the defined thresholds.
[Rubric §29, Resilience, Reliability & Business Continuity] is also touched: a load test that catches
a threshold regression before the next conference is a proactive resilience measure.

---

## Repository automation: the Claude review pair and the MAUI audit

**Files:** `MMCA.Common/.github/workflows/claude.yml`, `MMCA.Common/.github/workflows/claude-code-review.yml`,
`MMCA.ADC/.github/workflows/claude.yml`, `MMCA.ADC/.github/workflows/claude-code-review.yml`,
`MMCA.ADC/.github/workflows/maui-audit.yml`

Three workflows in this set never build, test or deploy anything. They exist to cover a review gap and a
supply-chain gap that the pipelines above structurally cannot reach.

### The automated Claude review (`claude-code-review.yml`)

Both MMCA.Common and MMCA.ADC run a pull-request-triggered review workflow. It is the second half of the
repositories' branch-protection posture: the ruleset requires **0 approving reviews today** while the team
is one person (`MMCA.Common/CONTRIBUTING.md:78-80`), and the automated review is what fills that space,
described in the same file as commenting on every PR but **advisory, not a gate**
(`MMCA.Common/CONTRIBUTING.md:73`). It cannot block a merge, and nothing in `deploy.yml` or `ci.yml`
waits on it.

Each job checks out the repository shallowly and runs `anthropics/claude-code-action` with the
`code-review` plugin, prompted with the PR's own coordinates
(`MMCA.Common/.github/workflows/claude-code-review.yml:39-46`,
`MMCA.ADC/.github/workflows/claude-code-review.yml:39-48`). Permissions are read-only apart from the
OIDC token: `contents: read`, `pull-requests: read`, `issues: read`, `id-token: write`
(`MMCA.Common/.github/workflows/claude-code-review.yml:27-31`). A reviewer that can read the diff and
comment does not need write access to anything.

The two copies have diverged, and each difference is a lesson:

- **Trigger set.** Common reviews on `opened`, `synchronize`, `ready_for_review` and `reopened`
  (`MMCA.Common/.github/workflows/claude-code-review.yml:4-5`). ADC dropped `synchronize` on 2026-07-18
  for minute savings (`MMCA.ADC/.github/workflows/claude-code-review.yml:5-8`): review once when a PR is
  opened, marked ready or reopened, rather than on every pushed commit, with on-demand re-review still
  available by writing `@claude` in a comment. ADC also adds `paths-ignore: "**/*.md"`
  (`MMCA.ADC/.github/workflows/claude-code-review.yml:9-10`), so a docs-only PR skips the review
  entirely, and a `concurrency` group keyed on the ref with `cancel-in-progress: true`
  (`MMCA.ADC/.github/workflows/claude-code-review.yml:12-15`), so a newer trigger supersedes an in-flight
  review instead of stacking.
- **Dependabot.** Common's job carries `if: github.actor != 'dependabot[bot]'`
  (`MMCA.Common/.github/workflows/claude-code-review.yml:15-19`), and the comment gives the mechanical
  reason: a Dependabot-triggered workflow reads the *Dependabot* secrets store, where
  `CLAUDE_CODE_OAUTH_TOKEN` is not configured, so the action failed immediately on every Dependabot PR.
  A mechanical version bump does not need an AI review, and CI still validates it.
- **Action pinning.** ADC pins the third-party action to a **commit SHA**
  (`MMCA.ADC/.github/workflows/claude-code-review.yml:41-43`,
  `MMCA.ADC/.github/workflows/claude.yml:35-37`), with the comment stating the supply-chain argument: a
  mutable tag can be repointed at malicious code, a SHA cannot, and Dependabot's `github-actions`
  ecosystem bumps it. Common still pins to a version tag
  (`MMCA.Common/.github/workflows/claude-code-review.yml:41`).

[Rubric §34, Architecture Governance & Documentation] is served: with a single maintainer and no second
human reviewer, an automated reviewer on every code PR is what keeps "reviewed" from meaning "self-merged
unread". [Rubric §32, Dependency & Supply-Chain] is served by ADC's SHA pinning, which is the standard
mitigation for a third-party action in a workflow that holds an OIDC token.

### The mention-triggered assistant (`claude.yml`)

The companion workflow is on-demand rather than automatic. It listens on four event types,
`issue_comment`, `pull_request_review_comment`, `issues` (opened or assigned) and `pull_request_review`
(`MMCA.Common/.github/workflows/claude.yml:3-11`), and its job condition requires the literal string
`@claude` in the relevant body or title (`MMCA.Common/.github/workflows/claude.yml:15-19`). Every event
arm is checked explicitly rather than with one blanket `contains()`, because the payload field differs per
event: `comment.body` for the two comment events, `review.body` for a review, and either `issue.body` or
`issue.title` for an issue.

The permission set is the same read-only shape as the review workflow plus one addition,
`actions: read` (`MMCA.Common/.github/workflows/claude.yml:21-26`), granted so the assistant can read CI
results on a PR, and re-declared as an `additional_permissions` input to the action itself
(`MMCA.Common/.github/workflows/claude.yml:40-41`). Without it, an `@claude why is CI red` cannot see the
run it is being asked about. ADC's copy is identical apart from the SHA pin
(`MMCA.ADC/.github/workflows/claude.yml:35-37`).

### `maui-audit.yml`, the weekly scan of the graph CI cannot see

The last workflow closes a real supply-chain hole, and its header states it plainly
(`MMCA.ADC/.github/workflows/maui-audit.yml:3-29`). `deploy.yml`'s gating `supply-chain` job audits
`MMCA.ADC.CI.slnf`, and the MAUI head (`Source/Hosts/UI/MMCA.ADC.UI`) is deliberately excluded from that
filter because restoring it needs the MAUI workloads and a multi-TFM restore far too slow for the per-PR
path. The consequence was that the largest and least-refreshed dependency graph in the repository, the
`Microsoft.Maui.*` packages, the Android bindings and everything they drag in transitively, had never been
scanned for advisories. The mobile app ships from that graph, so "not deploy-gating" is not the same as
"not our problem".

**The fix is a cadence change, not a cost increase** (`maui-audit.yml:14-17`): the audit runs on a
schedule instead of per PR, so a missed advisory is caught within seven days and no pull request ever pays
for a workload install. The cron is Sundays 06:00 UTC (`maui-audit.yml:32-36`), and the comment explains
even that choice: the weekday 06:00 slot already belongs to `cross-service-tests.yml`, and a slow workload
install has no reason to compete with the nightly Testcontainers tier for runner capacity.

**Its scope limit is stated rather than hidden** (`maui-audit.yml:19-25`). On `ubuntu-latest` only
`net10.0-android` can resolve, because `net10.0-ios` and `net10.0-maccatalyst` need macOS. `dotnet list
package` takes no MSBuild `-p:` properties, so the TFM is pinned in two places instead: `-p:TargetFrameworks`
on the restore (`maui-audit.yml:86-88`) and `--framework` on the audit read of the resulting assets file
(`maui-audit.yml:116-117`). The comment argues the coverage is close to full, since the managed
MMCA/Maui/BlazorWebView package set is shared across every head and only the small platform-binding tail is
Apple-only, and that a `macos-latest` runner would close that tail at ten times the per-minute cost for a
weekly advisory sweep.

Three details in the restore step repay reading (`maui-audit.yml:71-102`):

- **Try the plain restore first.** Hosted images ship a moving set of preinstalled workloads, so on many
  runs `maui-android` is already there and `dotnet workload install` is pure waste. The step attempts the
  restore, and only pays for the install if it fails.
- **Only for a missing-workload failure.** If the restore log carries no `NETSDK1147`, `NETSDK1139` or
  `workload` diagnostic, the step errors out rather than installing a workload
  (`maui-audit.yml:96-99`). Installing something on an unrelated failure would mask the real error, which
  is the same fail-closed instinct as the expand/contract guard's missing `|| true`.
- **`RestorePackagesWithLockFile=false` is forced off for this restore** (`maui-audit.yml:78-82`,
  `:88`). `Directory.Build.props` turns lock files on repo-wide, and a single-TFM restore would otherwise
  rewrite the MAUI project's `packages.lock.json` (and those of every project it references) into an
  android-only shape. Harmless on a throwaway runner, but this job doubles as the local reproduction
  recipe, and committing that truncated lock would be a genuine regression.

The audit step itself is the same contract as `deploy.yml`'s: fail on any vulnerable-package row except
an advisory accepted via `NuGetAuditSuppress` in `Directory.Build.props`, re-applying that list by hand
because `dotnet list --vulnerable` ignores it (`maui-audit.yml:104-145`). `--no-restore` is required
rather than an optimization (`maui-audit.yml:111-112`): without it `dotnet list` re-runs an unscoped
restore and drags the Apple TFMs back in, which cannot resolve on Linux. Both outcomes write a Step
Summary block (`maui-audit.yml:126-144`), the clean one repeating the macOS scope note so a green result
is never mistaken for full coverage. A deprecated-package report follows as `continue-on-error`
(`maui-audit.yml:147-153`), report-only for the same reason as in `deploy.yml`: a deprecated package is a
maintenance signal, not a security finding. Reports upload with a 14-day retention
(`maui-audit.yml:155-162`).

[Rubric §32, Dependency & Supply-Chain] is the primary category: a graph that ships to users and is never
scanned is exactly the shape a supply-chain incident takes. [Rubric §31, Cost Efficiency / FinOps] is
served by how the gap was closed, weekly rather than per PR, with an install that is skipped whenever the
runner already has the workload.

---

## Cross-workflow summary

| Workflow | Trigger | Gates production | Mutates Azure |
|---|---|---|---|
| `MMCA.Common/ci.yml` | PR → main (no push trigger) | No (framework gate) | No |
| `MMCA.Common/release.yml` | `v*` tag | No (publish gate) | No (GitHub Packages + nuget.org) |
| `MMCA.ADC/deploy.yml` | push → main / PR → main / dispatch | Yes | Yes (push and dispatch only) |
| `MMCA.ADC/e2e.yml` | Mon + Thu 07:00 UTC / dispatch / `workflow_call` from `deploy.yml` | Yes, twice: directly as the chromium `e2e-gate`, and indirectly via the `cross-browser-freshness` recency gate | No |
| `MMCA.ADC/cost-guard.yml` | Monday 07:00 UTC / dispatch / `workflow_call` from `deploy.yml` | Yes, directly, as the `cost-guard` gate | No (read-only) |
| `MMCA.ADC/load-test.yml` | monthly / dispatch | Indirectly, via the `load-freshness` recency gate | No (read-only) |
| `MMCA.ADC/dr-drill.yml` | Monday 06:00 UTC / dispatch | Indirectly, via the `dr-freshness` recency gate | No (restores a throwaway copy, then deletes it) |
| `MMCA.ADC/cross-service-tests.yml` | weeknights 06:00 UTC (Mon to Fri) / dispatch | Indirectly, via the `cross-service-freshness` recency gate | No |
| `MMCA.ADC/maui-audit.yml` | Sunday 06:00 UTC / dispatch | No (weekly advisory sweep of the graph CI cannot see) | No |
| `MMCA.Common` + `MMCA.ADC` `claude.yml` | `@claude` mention on an issue, comment or review | No (on-demand assistant) | No |
| `MMCA.Common` + `MMCA.ADC` `claude-code-review.yml` | PR opened / ready for review / reopened (Common also on `synchronize`; ADC skips docs-only) | No (advisory review, not a gate) | No |

(`dr-drill.yml` is the [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) §29 restore drill: it PITR-restores a *copy* of a chosen database, times the
restore for the RTO record, verifies it comes back Online, then deletes the copy, the live databases are
never touched (`dr-drill.yml:3-5`, Monday 06:00 UTC cron at `dr-drill.yml:31-33`). A scheduled run picks
its target by **rotating** across the four live per-service databases by ISO week number, so each one
gets a recovery proof roughly monthly (`dr-drill.yml:7-10`, selection at `dr-drill.yml:53-56`); a
dispatch names the database explicitly through a `choice` input (`dr-drill.yml:17-26`). One drill a week
that always restored the same database would prove the *procedure*, not the fleet.
`cross-service-tests.yml`
(`cross-service-tests.yml:6-10`) is the Testcontainers tier that boots the three REST hosts in one process
against a real SQL Server **and** a real RabbitMQ, exercising the genuine outbox to broker to consumer
round-trip and the real Conference to Engagement gRPC read. It must never enter `deploy.needs`, and the
reason is mechanical rather than stylistic: Testcontainers needs a Docker daemon that the gating
`integration-tests` job does not have (`cross-service-tests.yml:12-22`). Its second job,
`servicebus-emulator-smoke`, has been **authoritative since 2026-08-31** and is one of the two jobs the
freshness gate requires (`cross-service-tests.yml:126-133`); the `continue-on-error` job in that workflow
today is `apphost-smoke`, probational per ADR-098 and deliberately invisible to the gate
(`cross-service-tests.yml:189-204`). That job also carries a small supply-chain guard worth knowing
about (`cross-service-tests.yml:220-256`): its project sits outside every `.slnx` and `.slnf`, so its
committed `packages.lock.json` is covered by no gating restore, and a `Directory.Packages.props` bump
that forgets it leaves the lock resolving the old framework version while the job stays green (one lock
sat at 1.176.0 while the repo pinned 1.177.0). The step is a short Python check that every
`MMCA.Common.*` entry in the lock resolves the single central pin, and it fails on more than one pin at
all, which is the ADR-016 lockstep invariant expressed as a test. It deliberately does **not** use
`--locked-mode`: an Aspire AppHost lock carries a RID-specific `Aspire.Dashboard.Sdk.<rid>` entry, so
locked mode fails with NU1004 on a Linux runner whether or not anything drifted. Neither workflow is
given its own section above, but both are part of the workflow set.)

`deploy.yml` on push or dispatch is the only Azure-mutating workflow in the set today, and it holds the
`prod-azure` concurrency group with `cancel-in-progress: false` so a deploy is never interrupted
mid-migration; its comment records the standing rule that any future workflow mutating production Azure
state joins the same group (`deploy.yml:36-38`). `deploy.yml`'s pull-request runs use a separate
per-branch group that does cancel. All Azure access uses OIDC federated identity (no static client
secrets), and every job that logs in declares `environment: production` because the federated
credential's subject is scoped to it. The `.slnf`/`.slnx` test runs pass `--minimum-expected-tests` to
prevent empty or silently-truncated test suites from passing: ADC's runs floor at 1, while MMCA.Common's
`build-and-test` floors at 2000 against a suite of roughly 2,254 and its Helpdesk canary floors at 40
against roughly 91, so a discovery regression that drops thousands of tests fails instead of reporting
green. ADC's regression backstops are coverage floors instead, 55.5% line on its own assemblies and 77.5%
branch on the four Application-layer assemblies, both enforced in `build-and-test`.

The "Gates production" column splits three ways, and the distinction is the most portable idea in
this chapter. Two workflows gate **directly**, by being called as reusable workflows from `deploy.yml`
itself (`e2e.yml`, `cost-guard.yml`). Four gate **indirectly**: `dr-drill.yml`, `load-test.yml`,
`cross-service-tests.yml` and the firefox/webkit legs of the scheduled `e2e.yml` matrix never touch the
deploy path, but the **age** of their latest successful run is a `deploy` precondition through
`dr-freshness`, `load-freshness`, `cross-service-freshness` and `cross-browser-freshness`
([ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html)). And three gate nothing at
all by design: `maui-audit.yml` and the two Claude workflows notify rather than block, because a weekly
advisory sweep and an advisory review are useful precisely when they are not on the critical path. A
scheduled workflow only governs anything once something in the delivery path depends either on it having
run, or on it having run recently.

---

## Rubric category index for this chapter

| Category | Where primarily embodied |
|---|---|
| §8 Data Architecture | `deploy.yml` build-time EF model-drift gate (migrations applied by services at startup, not by `deploy.yml`); the expand/contract migration guard in `build-and-test` ([ADR-057](https://ivanball.github.io/docs/adr/057-expand-contract-schema-evolution-gate.html)); the real `dotnet ef database update` plus schema assertions in `ci.yml`'s Helpdesk canary |
| §11 Security | OIDC in `deploy.yml`/`load-test.yml`/`cost-guard.yml`, each job scoped by `environment: production` to match the federated credential subject; the GitHub token as a BuildKit secret (never a layer) in `build-images`; ephemeral RSA key in `e2e.yml`; least-privilege tokens in `release.yml`; read-only permissions plus a SHA-pinned action in ADC's Claude workflows |
| §12 Performance & Scalability | `load-test.yml` k6 baseline at observed peak VUs with the synthetic-traffic bypass so it measures backend capacity rather than the rate limiter, kept current by the `load-freshness` deploy gate (35 days); client-side Web Vitals budgets measured by `WebVitalsTests` inside the deploy-gating chromium `e2e-gate` |
| §13 Observability & Operability | Revision-activation polling output, six-endpoint smoke-gate output and rollback log (including the partial-rollback step summary) in `deploy.yml`; AppHost log and per-failed-test traces in `e2e.yml` |
| §14 Testability & Test Strategy | `--minimum-expected-tests` floors in all test steps (2000 for MMCA.Common's suite, 40 for the Helpdesk canary, 1 for ADC's); the 68.3% unit coverage floor in `ci.yml` `coverage`, ADC's 55.5% line floor and 77.5% Application-layer branch floor in `deploy.yml` `build-and-test`; `backend-test-gate` as the deploy-path complement of `e2e-gate`, so no code deploy ships without test execution; the golden replay and prompt-contract tiers of `ai-eval-gate` for the AI session scorer, whose behavior can move with no code change; architecture fitness functions in `build-and-test` |
| §17 DevOps & Deployment | The full workflow set collectively; SHA-tagged images with per-image dirty gating and registry-side re-tagging; the `foundation`/`build-images`/`deploy` phase split that hides image builds under the e2e gate; revision-activation gate plus smoke and rollback; the four proof-of-recency gates in `deploy.needs` and their justification-required break-glass ([ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html)) |
| §21 Accessibility | `ci.yml` `ui-e2e` axe-core WCAG 2.1 AA gate on every MMCA.Common pull request, across all three browser engines |
| §28 Front-End Testing & Quality | `ci.yml` `ui-e2e` render smoke; `e2e.yml` full Playwright suite, deploy-gating on chromium via `deploy.yml`'s `e2e-gate`, with the firefox/webkit legs of the alternating weekly matrix made mandatory by the `cross-browser-freshness` recency gate |
| §29 Resilience & Business Continuity | `prod-azure` concurrency group; the revision-activation gate that proves the new code is actually serving, plus the two-guard rollback in `deploy.yml` (never undo a healthy activation, never copy back a deactivated revision), kept viable by the expand/contract migration guard (revision rollback does not revert schema); `dr-drill.yml` PITR restore drill ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) objectives) rotating across the four live databases and enforced fresh within 8 days by `dr-freshness` |
| §30 Compliance & Privacy | SBOM generation in `release.yml` (both the ubuntu and windows pack jobs) and, as a component-count-asserting gate, in `deploy.yml`'s `supply-chain`; license report in the same job |
| §31 Cost / FinOps | `cost-guard.yml` surge-drift detection: Monday notifications plus a blocking `deploy.yml` gate; the docs-only, `ui`-scoped and per-image short-circuits in the `changes` job; ACR-hosted layer cache in `build-images`, paired with the daily `purge-old-images` ACR task in `foundation.bicep` and the post-deploy `buildcache` purge that reclaims the manifests each deploy orphans; `maui-audit.yml` as a weekly sweep rather than a per-PR workload install |
| §32 Dependency & Supply-Chain | Lock files + source mapping in MMCA.Common; `--locked-mode` restores against ADC's committed lock files; suppress-aware vulnerability audit in `ci.yml`, as a deploy gate in ADC's `supply-chain`, and weekly over the MAUI graph in `maui-audit.yml`; SBOM artifacts; the SHA-pinned Claude action in ADC |
| §33 Developer Experience | Playwright trace upload on failure in `ci.yml` and `e2e.yml`; AppHost + service logs in `e2e.yml`; step summaries in `cost-guard.yml`, `maui-audit.yml` and the freshness gates; the same-name-branch canary convention that lets a breaking framework change land with its consumer adaptation |
| §34 Architecture Governance | `cost-guard.yml` as executable governance for the surge-revert policy; the automated Claude review as the standing reviewer under a 0-approval ruleset; concurrency group as deployment-ordering governance |
