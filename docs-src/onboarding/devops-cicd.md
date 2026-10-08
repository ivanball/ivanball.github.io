# CI/CD and Operations

This chapter walks the GitHub Actions workflows that govern MMCA, from the framework's continuous
integration and lockstep NuGet release in `MMCA.Common`, through the ADC application's build/test/deploy
pipeline, end-to-end Playwright testing, cost-guard automation, performance load testing, and the
repository-automation workflow (the weekly MAUI dependency audit). (Two
further ADC workflows, `dr-drill.yml` and the weekday-nightly `cross-service-tests.yml`, are covered in
the cross-workflow summary at the end rather than given their own sections.) For each workflow you
will learn the triggers, the job/step sequence with file-and-line citations, and, critically, *why* each
gate exists and what would break without it. Rubric categories are tagged inline so you can connect each
pipeline decision to its architecture-quality axis. Cross-links to the primer and other tier chapters are
included throughout.

Two hardening conventions run through every workflow below and are not repeated in each section: every
third-party action is pinned to a commit SHA with its version in a trailing comment, and every `${{ ... }}`
value that reaches a shell body arrives through a step-level `env:` block instead of being interpolated
into the script text (`MMCA.ADC/.github/workflows/deploy.yml:81-87`,
`MMCA.Common/.github/workflows/ci.yml:58-62`). A template value is pasted in before the shell parses the
line, so a ref name or a dispatch input carrying shell metacharacters would otherwise run as code, and a
mutable action tag can be repointed at malicious code while a SHA cannot.

---

## MMCA.Common, `ci.yml`

**File:** `MMCA.Common/.github/workflows/ci.yml`

### What it is

The continuous-integration workflow for the MMCA.Common framework. Because the published packages
(the authoritative id list and count live in [`MMCA.Common/FACTS.md`](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md))
are consumed by every downstream application, a regression here propagates to both `MMCA.ADC` and
`MMCA.Store`. The workflow runs **thirteen jobs**: a `changes` classifier that every other job keys off
(`ci.yml:45`), a fast `build-and-test` covering unit and architecture tests with coverage collection
(`ci.yml:87`), a windows `build-maui` for the one package that cannot compile on Ubuntu
(`ci.yml:179`), a `ui-e2e` cross-browser matrix for real-browser accessibility and render-smoke testing
(`ci.yml:223`), a `performance-smoke` benchmark gate (`ci.yml:310`), a `coverage` job that turns the
unit tier into a report and enforces a floor (`ci.yml:357`), three canaries that catch failure modes the
solution build cannot see: `consumer-source-build` (`ci.yml:422`), `package-consumption`
(`ci.yml:640`) and `sample-deployment-validate` (`ci.yml:766`), and four engine-or-orchestrator tiers
for the components whose behavior only a real server can falsify: `redis-integration` (`ci.yml:784`),
`postgresql-integration` (`ci.yml:828`), `sqlserver-integration` (`ci.yml:865`) and the blocking
`apphost-testing` (`ci.yml:905`).


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
# ci.yml:27-32
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
# ci.yml:36-38
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Pushing to a PR again supersedes the still-running check set, since a stale run's result is never
actionable. The `cancel-in-progress` expression is guarded on `event_name` rather than hardcoded to
`true` so that a future non-PR trigger cannot cancel itself.

### Job: `changes`, the docs-only short-circuit

The first job (`ci.yml:45-85`) classifies the diff and exposes a single `code` output (`ci.yml:48-49`)
that every heavy step below is guarded on. It walks the changed files against the base ref and sets
`code=false` only when **every** changed path ends in `.md`.

The design detail worth internalizing is that the flag guards **steps, not jobs**. All eight required
status contexts must still post green on a docs-only PR, and a skipped job posts no context at all, so
guarding at job level would leave branch protection waiting forever on checks that never arrive. Guarding
at step level means the jobs all run, do almost nothing, and report green.

The classifier is fail-safe in both directions (`ci.yml:67-74`): an unresolvable base ref or a failed
`git diff` sets `code=true` and runs the full pipeline. Guessing "code changed" wastes runner minutes;
guessing "docs only" ships an unverified change.

One step deliberately escapes the guard, covered next.

### Job: `build-and-test`

**Runs on:** `ubuntu-latest` (`ci.yml:89`). The Ubuntu runner matters: the Linux file system is
case-sensitive, so path-casing bugs that Windows masks are caught in CI. This is a deliberate choice
documented in `MMCA.Common/CLAUDE.md` ("CI runs on Ubuntu, file paths are case-sensitive").
The job is bounded at `timeout-minutes: 15` (`ci.yml:92`), about twice the slowest of four recent code PR
runs per the comment (`ci.yml:90-91`), so a hung restore or test host fails the job instead of holding a
runner for GitHub's 6-hour default. The `coverage` job gets the same treatment at 5 minutes
(`ci.yml:361-363`).

**Step 1, Checkout with full history** (`ci.yml:94-97`):

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
  with:
    persist-credentials: false
    fetch-depth: 0 # MinVer needs full history
```

`fetch-depth: 0` fetches all tags and the complete git history. Without it, MinVer (the version-derivation
tool) cannot walk back to find the nearest `vX.Y.Z` tag and would produce an unstable pre-release version
string. Shallow clones (the GitHub default of depth 1) silently break reproducible versioning.

**Step 2, .NET 10 setup** (`ci.yml:99-113`): `actions/setup-dotnet@v6` pinned to `10.0.x` ensures the
runner matches the `<TargetFramework>net10.0</TargetFramework>` in every project. It also caches
`~/.nuget/packages`, keyed on the committed lock files **plus** `Directory.Packages.props`, because
`build/facts` and `build/perfgate` have no lock file and the repo does not pass `--locked-mode`, so the
props file is what actually pins their versions. The cache itself is gated on the `code` flag
(`ci.yml:107`): on a docs-only PR every restore step is skipped, `~/.nuget/packages` is never created, and
setup-dotnet's cache-save step would otherwise fail the whole job with "Cache folder path does not exist
on disk".

**Step 3, Verify FACTS.md is current** (`ci.yml:115-121`):

```bash
dotnet run --project build/facts -- . --check
```

A fast, dependency-free drift gate. `build/facts` recomputes the framework-wide facts from source (version
from the git tag, package count, fitness-method and base-class counts) and fails if the committed
`FACTS.md` disagrees. Regenerate with `dotnet run --project build/facts -- .`. The ADR count and range are
deliberately not in that list: the comment (`ci.yml:116`) records that the Website ADR index owns
them, so the one number the framework repo cannot see is not checked against a stale copy.

This is the one step **not** guarded on the `code` flag, and the comment (`ci.yml:119-120`) explains why:
`FACTS.md` is itself markdown, so a docs-only PR is exactly the kind of change that can make it drift.
The gate has to run precisely when everything else is skipped.

[Rubric §26, Documentation & Knowledge Management] is served here in the only way that survives contact
with time: the numbers other documents are told to link rather than restate are themselves machine-checked
against the code.

**Step 4, Restore** (`ci.yml:123-132`):

```bash
dotnet restore MMCA.Common.slnx --locked-mode
```

MMCA.Common uses NuGet lock files (`RestorePackagesWithLockFile`) and pins `packageSourceMapping` to
nuget.org only, no `GITHUB_TOKEN` is needed to restore. This is explicitly documented in
`MMCA.Common/CLAUDE.md` ("building/testing Common needs NO GitHub token"). The lock file makes the
restore reproducible: the exact dependency graph is committed and any unexpected transitive upgrade fails
the restore. `--locked-mode` (`ci.yml:125-132`) is what makes that binding rather than advisory: the
restore either reproduces the committed `packages.lock.json` graph or fails, so CI cannot build, audit and
pack a graph nobody reviewed. A deliberate dependency change regenerates the lock files locally with
`dotnet restore --force-evaluate` and commits them in the same pull request. Every project in
`MMCA.Common.slnx` has a lock file; the three that do not (`build/facts`, `build/perfgate` and the
Benchmarks project) sit outside the solution and are unaffected.


[Rubric §32, Dependency & Supply-Chain] assesses whether package sources are pinned, audited, and
supply-chain risks are visible. The pinned source mapping plus committed lock files are the §32
implementation: a compromised or mutated transitive package cannot silently enter the build.

**Step 5, Build in Release mode** (`ci.yml:134-136`):

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

**Step 6, Vulnerability audit** (`ci.yml:138-148`):

```yaml
- name: Audit dependencies (fail on known vulnerabilities)
  if: needs.changes.outputs.code == 'true'
  uses: ./.github/actions/nuget-vulnerability-audit
  with:
    solution: MMCA.Common.slnx
```

The step is a call into a composite action in the same repository,
`.github/actions/nuget-vulnerability-audit/action.yml`, and the comment (`ci.yml:140-143`) says why the
logic moved there: ADC and Store `deploy.yml` run the very same action by ref
(`ivanball/MMCA.Common/.github/actions/...@main`), so the framework and its consumers share ONE
implementation instead of a per-repository copy that drifts
([ADR-038](https://ivanball.github.io/docs/adr/038-supply-chain-provenance.html)). The action takes a
`solution`, an optional `props-file` (default `Directory.Build.props`) and an optional `report-path`
(default `audit.log`) (`nuget-vulnerability-audit/action.yml:13-24`).

Inside it (`nuget-vulnerability-audit/action.yml:35-65`), `dotnet list package --vulnerable
--include-transitive` queries NuGet's vulnerability database for every direct and transitive dependency
and writes the report. The gate then **fails closed** (SEC-Common-62) on two assertions before it will
trust an empty result: the command's exit code must be 0 (`:41-43`), and the report must carry a
recognised header, either the sources header or a per-project verdict line (`:46-48`). Without those two
checks, every way the tool itself can fail (an advisory-feed timeout, an auth or proxy error, a renamed
output) produced an empty grep and a green "no vulnerabilities".

Only then does it apply the accept-list. Because `dotnet list --vulnerable` ignores `NuGetAuditSuppress`,
the action honors the same accepted-advisory list itself: it extracts the suppressed `GHSA-...` ids from
`Directory.Build.props` (the single source of truth), filters those advisories out of the vulnerable-package
rows (the `>`-prefixed lines), and fails only if a *non-suppressed* vulnerable row remains (`:58-64`).

Note how narrowly the extraction is scoped (`nuget-vulnerability-audit/action.yml:49-55`): it matches
only real `<NuGetAuditSuppress ... Include="GHSA-..."` elements, not every `GHSA-` string in the file,
so a GHSA id merely *mentioned in a comment* about a non-accepted advisory cannot silently suppress it
here. A looser grep would have turned prose into policy.

Why this gate exists and why it comes *before* tests: a vulnerable dependency that reaches the published
packages is a supply-chain liability for every downstream consumer. Catching it before the release
workflow runs (and before the package is published) is cheaper than retracting a published version.

[Rubric §32, Dependency & Supply-Chain] is directly served by this step. [Rubric §11, Security]
(assesses whether secrets, auth, and dependency security are properly managed) is also touched: the
vulnerability audit ensures the framework's own dependencies do not carry known CVEs.

**Steps 7 and 8, Test with coverage and the discovery-regression floor** (`ci.yml:150-163`):

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
size of roughly 2,254 (`ci.yml:160-161`). A floor of 1 would only catch a project that discovered nothing
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

The unit-tier cobertura report is uploaded as the `coverage-unit` artifact (`ci.yml:165-171`) for the
`coverage` job to merge and gate on, under `if: always()` so a failing run still yields its partial
coverage data.

### Job: `build-maui`, the one package Ubuntu cannot compile

`MMCA.Common.UI.Maui` multi-targets net10.0-android/ios/maccatalyst/windows, which needs the MAUI
workloads, which Ubuntu runners do not have. So it stays **out of `MMCA.Common.slnx`** and builds in its
own `windows-latest` job (`ci.yml:179-216`), the same mechanism that keeps the gallery and UI E2E projects
out of the fast unit run ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)).
It is a required merge gate alongside `build-and-test`.

There are no tests here, and the comment says why (`ci.yml:177-178`): the capability contracts and their
browser fallbacks are covered in `MMCA.Common.UI.Tests` on ubuntu, while the MAUI implementations are thin
Essentials wrappers exercised on-device. A test that only proves a wrapper forwards a call is not worth a
windows runner.

The job is the **critical path of the whole CI run** (the only windows runner), and the largest single
cost in it is the MAUI workload. `Install MAUI workload` runs a plain `dotnet workload install maui` on
every code run with no workload cache, and the comment records why, by measurement (`ci.yml:206-212`):
saving the 2.2 GB of packs took 430 seconds, a cache hit still spent 225 seconds restoring plus 192 in
the install, and a cache saved by a `pull_request` run is only visible to that same PR, so every cached
variant was slower than the plain install (about 380 seconds). A cache is a bet that restoring is
cheaper than recomputing; for a payload this size on a windows runner, it is not.

### Job: `ui-e2e`, accessibility and render-smoke gate

This job (`ci.yml:223-300`) runs in parallel with `build-and-test`, on its own `ubuntu-latest` runner,
with a 20-minute timeout (`ci.yml:227`). It is a **cross-browser matrix** over `chromium`, `firefox`, and
`webkit` (`ci.yml:228-232`) with `fail-fast: false`, so one engine's failure does not cancel the others.

**All three engines are required merge gates.** The matrix was introduced with the non-chromium legs
non-blocking, then promoted as each proved itself: firefox on 2026-07-12 after a clean observed streak,
webkit on 2026-07-16 after 11 consecutive green runs since its last flake (`ci.yml:233-235`). There is no
`continue-on-error` in this job today. A webkit red blocks the merge like any other check.

Its purpose is to catch two failure classes the unit-test job cannot: WCAG 2.1 AA accessibility violations
in the shared Blazor UI components, and rendering regressions (a component that compiles but throws during
render).

**Why a separate job?** The gallery host (`Tests/Presentation/MMCA.Common.UI.Gallery`) and the E2E test
project (`Tests/Presentation/MMCA.Common.UI.E2E.Tests`) are **intentionally excluded from
`MMCA.Common.slnx`** (`ci.yml:218-222` comment). Playwright requires a full browser install (several
hundred megabytes) and a browser-capable runner config. Including these in `dotnet test --solution` would
slow every CI run for every code change, most of which do not touch the UI. Keeping the E2E gate separate
means the unit/arch job stays fast while accessibility remains enforced.

**Step-by-step:**

1. **Checkout** (`ci.yml:237-240`): `fetch-depth: 0` (the comment notes "MinVer needs full history"), same
   as `build-and-test`.

2. **Build the E2E project directly** (`ci.yml:258-262`):
   ```bash
   dotnet build Tests/Presentation/MMCA.Common.UI.E2E.Tests/MMCA.Common.UI.E2E.Tests.csproj -c Release
   ```
   Building by csproj path, not solution, ensures only the gallery and E2E graphs are compiled (restore
   included). The E2E project references MMCA.Common source projects directly (via project references, not
   NuGet packages), so no `GITHUB_TOKEN` is needed.

3. **Cache and install Playwright for the matrix browser** (`ci.yml:267-285`):
   ```bash
   script=$(find Tests/Presentation/MMCA.Common.UI.E2E.Tests/bin/Release -name playwright.ps1 | head -1)
   if [ "${{ steps.playwright-cache.outputs.cache-hit }}" = "true" ]; then
     pwsh "$script" install-deps ${{ matrix.browser }}
   else
     pwsh "$script" install --with-deps ${{ matrix.browser }}
   fi
   ```
   Browser binaries run 100 to 300 MB per engine and were re-downloaded on all three legs of every run,
   which is what the workflow-level `PLAYWRIGHT_BROWSERS_PATH` and this cache step (`ci.yml:267-273`)
   exist to stop. The cache key includes the engine, since each leg installs only its own.

   The install branches on the cache hit, and the distinction is the useful part: OS-level shared
   libraries and fonts live outside the cached directory, so a restored cache still needs `install-deps`,
   the cheap half of `--with-deps`. Skipping it entirely on a hit would produce a browser that cannot
   launch. The `playwright.ps1` script is emitted into the build output by the Playwright MSBuild
   integration; `find` locates it dynamically so the step does not hard-code a .NET version suffix.

4. **Run the E2E suite** (`ci.yml:287-292`): every leg runs the same plain `dotnet test` command, code-guarded
   like the other heavy steps, with no coverage collection (E2E coverage is not part of the merged report).
   The step is:
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

5. **Upload Playwright traces on failure**: each leg uploads its traces (`ci.yml:294-300`):
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

This job (`ci.yml:310-352`) runs the BenchmarkDotNet harness and then compares the results against a
committed baseline, which makes it two gates in one. Its context, `Performance gate (BenchmarkDotNet
Short + baseline verify)`, is one of the eight required merge gates on `main`
(`MMCA.Common/CONTRIBUTING.md:60-71`).

The run itself (`ci.yml:337-343`) uses `--filter "*"` and `--job Short`:

```bash
dotnet run -c Release --project Tests/Performance/MMCA.Common.Benchmarks --no-launch-profile -- --filter "*" --job Short --exporters json
```

`--filter "*"` selects every benchmark non-interactively, and without it BenchmarkDotNet prompts for a
selection and hangs in CI. `--job Short` (3 warmup + 3 iterations) produces real measurements in under a
minute instead of a full multi-iteration timing run. `--no-launch-profile` keeps it deterministic on
hosted runners.

Then `build/perfgate` (`ci.yml:345-352`) compares the exported results against
`Tests/Performance/perf-baseline.json` and fails on any violation. The baseline holds two kinds of
assertion, and the difference matters: deterministic **allocation ceilings** (byte counts, which are
stable across machines) and machine-independent **ratio floors**, such as the compiled-expression
specification cache staying at least 1000x ahead of the recompile anti-pattern. Wall-clock times are not
asserted, because a shared hosted runner cannot deliver them reproducibly. Moving a number deliberately
means updating the baseline file in the same PR.

[Rubric §12, Performance & Scalability] is served in the only form CI can honestly provide: not "is it
fast" but "did the property that makes it fast stop holding".

### Job: `coverage`, merge report and coverage floor

This job (`ci.yml:354-409`) runs after `build-and-test` regardless of its outcome (`needs: [changes,
build-and-test]`, `if: always()`, `ci.yml:357-359`). It downloads the `coverage-*` artifacts, turns the
unit/architecture/bUnit cobertura into a ReportGenerator report (`+MMCA.*;-*.Tests`), and publishes the
summary to the run's Step Summary (`ci.yml:369-390`). The `ui-e2e` browser tier collects no coverage.

It then **enforces a coverage floor** (`ci.yml:398-409`) as a regression backstop: the unit tier must
stay at **68.3% line coverage or better** with generated `*.generated.cs`/`*.g.cs` code excluded
(`ci.yml:406-409`), and only when `build-and-test` succeeded, so that an upstream failure does not add a
confusing secondary coverage failure (`ci.yml:399-400`).

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

**`consumer-source-build`** (`ci.yml:422-628`) is a cross-repo pre-merge canary, and it now proves two
different things. It checks out MMCA.Helpdesk as a sibling directory (`ci.yml:444-483`) and builds and
tests it against *this PR's* framework source, so a breaking public-API change fails here rather than
surfacing after a release and a lockstep sweep. Helpdesk is the ideal canary precisely because it is
minimal: a single-module app that needs no database and no GitHub Packages token to compile, shipping a
committed `local.props` that swaps the `MMCA.Common.*` `PackageReference`s for `ProjectReference`s into
`../MMCA.Common/Source`. The sibling checkout layout is what makes that relative path resolve to the PR's
own checkout. Its test step (`ci.yml:522-527`) carries the same discovery floor idea as `build-and-test`,
set to 40 against a suite of about 91 (`ci.yml:525-526`). Promoted to a required gate on 2026-07-16 after
9 consecutive green runs (`ci.yml:417-418`).

Two additions are worth reading closely. First, the job resolves which Helpdesk ref to build
(`ci.yml:456-471`): if a branch with the **same name** as this PR's head branch exists on
`ivanball/MMCA.Helpdesk`, the canary builds that pair together; otherwise it builds Helpdesk `main`. That
convention is what makes a deliberate breaking framework change landable at all. Helpdesk's own CI builds
against MMCA.Common `main`, so neither repo can adapt first while the canary pins the other's `main`: a
mutual deadlock, resolved by letting one PR name its counterpart branch (`ci.yml:451-455`).

Second, the job runs the consumer's **real EF migrations against a real SQL Server**. An ephemeral
SQL Server container starts *before* the build so it warms up while the solution compiles
(`ci.yml:501-513`). Its image is the job-level `SQLSERVER_IMAGE`, pinned to one cumulative update,
`mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04`, rather than `2022-latest` (`ci.yml:438-442`):
this is a required gate, so a new CU must not change what it runs without a reviewed diff, and the
comment ties the tag to the `sqlserver-integration` tier, which pins the same one ("bump both").
`go-sqlcmd` is installed as a single static binary rather than the mssql-tools deb, and is itself pinned
(`ci.yml:529-548`): a fixed `SQLCMD_VERSION` (`v1.10.0`) is downloaded to `$RUNNER_TEMP` and checked
against `SQLCMD_SHA256` with `sha256sum -c` before `sudo tar` extracts it, because piping
`releases/latest` straight into a root `tar` ran whatever the newest upload was, unchecked. Version and
digest are bumped together. A 30 x 5s poll waits on a real `SELECT 1` rather than on Docker's
notion of "running" (`ci.yml:550-565`), and `dotnet ef database update` applies the Tickets migrations
with the same `dotnet-ef 10.0.8` the consumers deploy with (`ci.yml:567-594`). The reason is stated in
the comment (`ci.yml:573-577`): `migrations add` and the model-drift gate never open a connection, so
neither notices a framework change that breaks the generated DDL, the history table, or the design-time
context wiring. `database update` does.

The step after it is the one that makes the apply falsifiable (`ci.yml:596-628`). `dotnet ef database
update` exits 0 on a no-op, so a wiring mistake that applied nothing would pass silently. The assertion
step therefore reads `__EFMigrationsHistory` for at least one row and checks that both a module table
(`Tickets.Ticket`) and a **framework** table (`dbo.OutboxMessages`) exist. The framework table is the
half that belongs to MMCA.Common, so a change that stops the framework's own tables reaching a consumer's
schema fails right here rather than at a consumer's deploy. The job's timeout was raised to 30 minutes to
pay for the container, the poll and the apply (`ci.yml:426-428`), and the throwaway SA password is inline
rather than a secret so the gate still runs from a fork (`ci.yml:430-433`).

[Rubric §8, Data Architecture] is served in a way no build-only canary can reach: the framework's
migration path is exercised end to end, on a real engine, by a real consumer.

**`package-consumption`** (`ci.yml:640-758`) closes the gap that the previous job cannot: source-mode
builds bind `ProjectReference`s, so pack breaks (NU5xxx) and package-mode-only restore, analyzer, and
reference failures stay invisible to them. The comment records that this failure mode shipped **twice**
before the job existed (`ci.yml:630-639`). So this job packs every slnx package into a local folder feed
under a CI-only version (`PACK_VERSION` at `ci.yml:645-646`, packed at `ci.yml:669-671`, with
`MinVerSkip=true` so the consumer can pin the packed version exactly), then scaffolds a throwaway
consumer (`ci.yml:673-721`) whose `nuget.config` maps `MMCA.Common.*` to that feed and everything else to
nuget.org, and builds it (`ci.yml:723-726`).

The throwaway consumer lives in `RUNNER_TEMP`, **outside the repo checkout**, and that placement is the
whole point: inside the checkout it would inherit `Directory.Build.props` and `Directory.Packages.props`
and stop resembling a real downstream app. It references the meta set (`API` + `Infrastructure` +
`Testing.Architecture`) to pull the full package graph transitively, and compiles one smoke type against
`Result` to prove the references actually bind rather than merely resolve.

The job's last step, **Layer rules ship with the packages** (`ci.yml:728-758`), proves something a
successful consumer build cannot. `MMCA.Common.Shared` carries a `buildTransitive` targets file
(`Source/Build/MMCA.Common.Shared.targets`) that gives any consumer project named
`{App}.{Module}.{Layer}` compile-time layer rules with no opt-in: `MMCA0001` for a forbidden project
reference, `MMCA0002` for a forbidden package reference (the comment at `ci.yml:730-734` ties it to
[ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html) and
[ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html)). The step
writes three kinds of probe project next to the throwaway consumer: one positive probe
(`Probe.Sample.Application` referencing `Probe.Sample.Domain`, which must build, `ci.yml:750-752`) and two
negative ones (`Probe.BadPackage.Domain` pulling `MMCA.Common.Infrastructure`, which must fail with
`MMCA0002`, and `Probe.BadProject.Domain` referencing an Application project, which must fail with
`MMCA0001`, `ci.yml:753-757`). The helper `expect_error` (`ci.yml:744-749`) fails the step both when a
negative probe builds and when it fails for a reason other than the expected code.

Why the negatives are the point: a passing positive probe on its own would also pass if the targets file
were silently missing from the package, so only the two probes that must break prove the import reaches
a package-mode consumer and that both error codes fire. [Rubric section 34, Governance] assesses whether
architectural rules are enforced mechanically rather than by review; here the rules travel with the
package and CI proves they arrive, which is the consumer-side twin of the
[doubled fitness functions](00-primer.md#architecture-enforcement-is-doubled-fitness-functions-rubric-34-3).

**`sample-deployment-validate`** (`ci.yml:766-782`) type-checks the `samples/deployment` Bicep templates
with `az bicep build`, no cloud credentials required. A library cannot deploy itself, so this IaC/OIDC
reference is documentation that would otherwise rot unobserved; compiling it on every PR keeps it honest.
A real what-if or deploy stays a consumer-side concern, since ADC's and Store's `deploy.yml` are the
production-proven versions.

### Job: `redis-integration`

`redis-integration` (`ci.yml:784-826`) runs `MMCA.Common.Infrastructure.Redis.Tests` against a real Redis via
Testcontainers, which Ubuntu runners support with no extra setup since they ship a Docker daemon. Like the
E2E and benchmark projects it lives outside `MMCA.Common.slnx` so the fast solution-wide unit loop never
requires Docker, and is therefore built and run by path.

The comment (`ci.yml:789-793`) states the falsifiability argument better than a summary can:
[`DistributedCacheService`](group-09-caching.md#distributedcacheservice) is the one place where the **storage format** matters, and a
`Mock<IDistributedCache>` cannot express it. Redis keys are typed, so a counter written as a string and
read back as a hash round-trips perfectly against a mock and answers `WRONGTYPE` against a server. A test
that cannot fail against a mock is not a test of the thing you care about.

Its heavy step is code-guarded like every other job (`ci.yml:816-826`) so a docs-only PR does not pull a
Redis image, while the job itself still runs and posts its context green, keeping it safe to add to branch
protection. The test step carries `--minimum-expected-tests 15` (`ci.yml:823-826`), and the comment says
why the number is exactly 15: it is the `[Fact]` count in the project (5 `DistributedCacheService` plus 10
`HybridCacheService`), so a tier that silently discovers fewer tests fails, and adding a test means raising
the floor in the same PR. The same exact-count floor applies to the two database tiers below.

### Jobs: `postgresql-integration`, `sqlserver-integration` and `apphost-testing`

`postgresql-integration` (`ci.yml:828-863`) is the Redis argument applied to the second database engine.
The PostgreSQL provider is the one place where the SQL the framework *emits* matters, and a model
assertion cannot express it: the comment is specific about the failure class (`ci.yml:833-838`), a
partial-index predicate written the SQL Server way (`[ProcessedOn] IS NULL`), a soft-delete predicate
comparing a boolean to `0`, and a `DateTime` whose `Kind` is not UTC all build a perfectly valid EF model
and are rejected by the server. The job runs `MMCA.Common.Infrastructure.PostgreSQL.Tests` against a real
PostgreSQL over Testcontainers (`ci.yml:854-863`), built and run by path for the same reason the Redis
tier is: the project sits outside `MMCA.Common.slnx` so the fast unit loop never requires Docker. Its floor
is `--minimum-expected-tests 7`, the `[Fact]` count in `PostgreSQLPersistenceTests.cs` (`ci.yml:861-863`).

`sqlserver-integration` (`ci.yml:865-903`) completes the set for the default engine. The comment
(`ci.yml:872-878`) names what neither a mock nor SQLite can express on SQL Server, which is **session
state and server-generated values**: `SET IDENTITY_INSERT` holds only on the session that ran it, a
`rowversion` is issued by the server on every write, and the outbox row must reach the database in the
same `SaveChanges` as its aggregate. The job runs the shipped
[`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) and
[`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory) against a real SQL Server over
Testcontainers. Its timeout is 20 minutes, the PostgreSQL tier's 15 plus headroom for the larger image pull
and slower engine start (`ci.yml:869-871`), and the image tag is the same pinned `2022-CU27-ubuntu-22.04`
the `consumer-source-build` canary uses, which is why the canary's comment says to bump both
(`ci.yml:438-442`). The heavy step is code-guarded with the job still posting green (`ci.yml:894-898`),
the project is outside `MMCA.Common.slnx` and run by path, and the floor is
`--minimum-expected-tests 3`, the `[Fact]` count in `SQLServerPersistenceTests.cs` (`ci.yml:899-903`).
It is **not a required check yet**: the comment records that promoting it is a branch-protection setting,
not a workflow change (`ci.yml:877-878`).

`apphost-testing` (`ci.yml:905-950`) is the only tier that starts a real orchestrator. It boots the sample
AppHost through `Aspire.Hosting.Testing` and closes the one layer nothing else executes, the AppHost
wiring itself (`ci.yml:913-916`): the solution build never runs an AppHost, and every in-process test tier
boots hosts directly through `WebApplicationFactory`, bypassing the orchestration, so a renamed resource,
an unresolvable reference or a `WaitFor` cycle is invisible everywhere else. Three properties are worth
carrying away. It is **blocking**: a red fails the run, though it is not a required merge check
(`ci.yml:910-911`). It needs neither a container runtime nor a development certificate, because the
sample AppHost declares two resources over one sample project, one with a SQLite file and one on the
Http2-only h2c profile; the comment names the step a consumer stack with an `https` launch profile adds,
`dotnet dev-certs https --trust`, since a resource probed over untrusted TLS never turns healthy
(`ci.yml:918-921`). And the test step opts in through `MMCA_APPHOST_TESTS` (`ci.yml:937-950`), the
environment gate the fixture reads, so a developer machine and every other CI job skip the collection
with a named reason instead of paying for an orchestrator, while `--minimum-expected-tests 1` makes a
silently skipped tier visible here rather than passing as a no-op.

[Rubric §14, Testability & Test Strategy] is served by both jobs the way the Redis tier serves it: each
covers a failure class that is structurally invisible to a mock, to a model assertion, or to a build.

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
`publish` job runs `dotnet pack MMCA.Common.slnx` (`release.yml:75-76`), which packs every packable
project the solution contains (`MMCA.Common.slnx:8-29`). The windows `publish-maui` job packs the one
remaining package, `MMCA.Common.UI.Maui`, by csproj path (`release.yml:189-190`), because its four MAUI
target frameworks need workloads that Ubuntu runners do not carry
(**[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)**), which is
also why that project stays out of the solution. Both jobs derive their version from the same
`GITHUB_REF_NAME` (`release.yml:65-67`, `release.yml:181-184`), so the lockstep release stays whole
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

**Permissions** (`release.yml:17-20`):
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

**The `release` environment and the merged-main assertion.** Publishing to nuget.org is irreversible, a
version can never be withdrawn (ADR-053), so the job declares `environment: release` (`release.yml:15-18`)
and waits on that environment's protection rules (a required reviewer, and a deployment policy limited to
`v*` tags) before it runs at all. The first step after checkout then refuses to publish a tag that is not
reachable from `origin/main` (`release.yml:35-46`): it fetches the branch tip and fails unless
`git merge-base --is-ancestor` places the tagged commit on merged `main`. The job is bounded at
`timeout-minutes: 15` (`release.yml:15`), about twice the slowest recent tag run, so a hung restore,
test or push fails instead of holding a runner for six hours. `publish-maui` deliberately keeps 40
minutes (`release.yml:147-153`): it declares no `needs:` on `publish` and runs in parallel with it, so the main
package set is usually already on nuget.org by the time it pushes (nothing enforces that order), and a
timeout there would leave a half-published release. A `v*` tag is the one ref pushed
directly, outside the branch-protection pull-request flow, and this workflow re-runs only restore, build,
test and SBOM, so the ancestry check is what makes the checks that ran on the merged pull request (the
FACTS drift gate, the vulnerability audit, the Helpdesk consumer canary, the package-consumption canary,
`ui-e2e`, the perf gate) the checks that actually covered the tree being published. `publish-maui` carries
the same assertion (`release.yml:154-164`), because it publishes from the same tag.


**Step 1, Checkout with full history** (`release.yml:23-26`): `fetch-depth: 0` for MinVer, same as CI,
with `persist-credentials: false` so the checkout token is not left behind in the workspace.

**Step 2, .NET 10 setup** (`release.yml:48-57`): same as CI, including the NuGet cache keyed on the
committed lock files plus `Directory.Packages.props`.

**Step 3, Restore** (`release.yml:58-64`): `dotnet restore MMCA.Common.slnx --locked-mode`, so the
packages that are about to be packed, SBOM'd and pushed irreversibly come from the committed lock graph
rather than from whatever the feed resolves at tag time; no `GITHUB_TOKEN` is needed.


**Step 4, Determine version from tag** (`release.yml:65-67`):
```bash
echo "VERSION=${GITHUB_REF_NAME#v}" >> $GITHUB_OUTPUT
```
`GITHUB_REF_NAME` is the full tag name (e.g. `v1.52.0`). The `#v` parameter expansion strips the leading
`v`, yielding `1.52.0`. This string is then passed to the build and pack steps as an explicit version
override.

**Step 5, Build with explicit version** (`release.yml:72-73`):
```bash
dotnet build MMCA.Common.slnx -c Release --no-restore -p:MinVerSkip=true -p:Version=${{ steps.version.outputs.VERSION }}
```
`-p:MinVerSkip=true` disables MinVer's git-tag-based version derivation and `-p:Version=...` injects the
tag-derived version directly. This pattern avoids a subtle race: if MinVer ran here, it would derive the
version from the tag, which should be the same value, but in edge cases (e.g. detached HEAD, retagged
commit) the two sources could diverge. Making the version explicit from the start removes the ambiguity.

**Step 5b, Audit dependencies** (`release.yml:75-83`): the same
`./.github/actions/nuget-vulnerability-audit` composite action that `ci.yml` `build-and-test` runs, with
the same accept-list (`NuGetAuditSuppress` in `Directory.Build.props`) and the same fail-closed
behavior, re-run on the tag build. The comment (`release.yml:75-78`) gives the reason: the graph that
gets packed is restored from the lock files here, and an advisory published between the PR run and the
tag must stop a nuget.org push that can never be withdrawn.

**Step 6, Test** (`release.yml:85-87`):
```bash
dotnet test --solution MMCA.Common.slnx -c Release --no-build --minimum-expected-tests 2000
```
Tests run again on the tagged commit, with the same 2000-test floor as `ci.yml` `build-and-test`. The
comment (`release.yml:86-87`) states why the floor is repeated here: a discovery or filter regression that
silently drops thousands of tests must fail the release, not publish behind a near-empty green run.

**Step 7, Pack** (`release.yml:89-90`):
```bash
dotnet pack MMCA.Common.slnx -c Release --no-build -o ./nupkgs -p:MinVerSkip=true -p:PackageVersion=${{ steps.version.outputs.VERSION }}
```
`dotnet pack` over the entire solution packs every packable project it contains (`Source/**`) in
one command. `-p:PackageVersion` sets the NuGet package version metadata. `-o ./nupkgs` collects all
`.nupkg` files in one directory for the push step. The packages produced here all share the same
version string. `MMCA.Common.UI.Maui` is not in the solution and is packed by the `publish-maui` windows
job into its own `./nupkgs-maui` directory from the same tag (ADR-042).

**Steps 8 and 9, SBOM generation and upload** (`release.yml:90-101`):
```yaml
- name: Attest build provenance (nupkgs)
  uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
  with:
    subject-path: ./nupkgs/*.nupkg
- name: Generate SBOM (CycloneDX)
  uses: ./.github/actions/cyclonedx-sbom
  with:
    solution: MMCA.Common.slnx
    output-dir: ./sbom
- name: Upload SBOM
  uses: actions/upload-artifact@v7
  with:
    name: sbom
    path: ./sbom
    if-no-files-found: error
```
Two supply-chain artifacts follow the pack. **Build provenance** (`release.yml:78-84`):
`actions/attest-build-provenance` writes a signed SLSA attestation binding each `.nupkg` to this workflow,
this commit and this repository. GitHub stores it, and anyone holding a downloaded package can check it with
`gh attestation verify <file>.nupkg --owner ivanball`. It needs the `attestations: write` permission the job
declares (`release.yml:21`; `publish-maui` declares its own at `release.yml:156` and attests its package at
`release.yml:195-198`). It answers the question an SBOM cannot: not what is inside the package, but whether
this exact file was built by this pipeline from this commit ([ADR-038](https://ivanball.github.io/docs/adr/038-supply-chain-provenance.html)).

CycloneDX generates a Software Bill of Materials, a machine-readable inventory of every dependency's
identity, version, and license. The SBOM is a **hard gate** (`release.yml:86-94`): the step calls the shared
composite action `.github/actions/cyclonedx-sbom`, the same one ADC and Store `deploy.yml` run by ref, which
fails the release when generation fails OR the BOM lists zero components
(`MMCA.Common/.github/actions/cyclonedx-sbom/action.yml:68-71`); a missing artifact then fails the upload
(`if-no-files-found: error`). Every published version must ship a verifiable SBOM.

[Rubric §30, Compliance, Privacy & Data Governance] (assesses whether supply-chain and licensing
obligations are tracked) is served: the SBOM is the machine-readable artifact that fulfills the
"know your dependencies" requirement for regulated or commercially-distributed software, and gating on it
guarantees no version ships without one.

**Step 10, Push to GitHub Packages** (`release.yml:103-104`):
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

**Steps 11 and 12, Push to nuget.org via trusted publishing** (`release.yml:115-124`):
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

A second job on `windows-latest` (`release.yml:146-257`), with no `needs:` on `publish` so the two run in
parallel (`release.yml:149-150`), packs the one out-of-solution package,
`MMCA.Common.UI.Maui`, which multi-targets net10.0-android/ios/maccatalyst/windows and therefore cannot
build on the ubuntu runner at all (ADR-042). It installs the MAUI workload (`release.yml:178-179`),
derives the version from the same tag (`release.yml:181-184`), builds and packs by csproj path into
`./nupkgs-maui` (`release.yml:186-190`), applies the same SBOM hard gate scoped to that one project
(`release.yml:200-214`), and pushes to both registries (`release.yml:216-236`). Because both jobs key off
`GITHUB_REF_NAME`, the two runners produce the same version string and lockstep survives the split.

Two details are load-bearing, and the comment states them (`release.yml:222-225`). The nuget.org
trusted-publishing policy is keyed on the workflow **file**, so one policy covers both jobs, but each job
needs its own `id-token: write` (`release.yml:136-140`) and its own exchange: a short-lived key is
single-use and cannot cross a job boundary. And every `dotnet nuget push` step here sets `shell: bash`
(`release.yml:219`, `release.yml:235`), because the windows-default PowerShell passes `*.nupkg` through
unexpanded and the push then fails with "File does not exist" on the un-globbed pattern.

The cost of the split is release surface: two runners must both succeed for a release to be whole.

---

## MMCA.ADC, `deploy.yml`

**File:** `MMCA.ADC/.github/workflows/deploy.yml`

### What it is

The primary CI/CD pipeline for the Atlanta Developers Conference application. It runs on every push to
`main`, on every pull request targeting `main`, and on manual `workflow_dispatch`. On a push to `main` (or
dispatch) it deploys to Azure; on a pull request it runs the validation jobs only, as a merge gate.

It is **thirteen jobs**, and the shape of the split is the interesting fact. A `changes` classifier
(`deploy.yml:65`) that everything keys off; four pull-request-only validation jobs, `build-and-test`
(`:220`), `wasm-payload-budget` (`:476`), `integration-tests` (`:641`) and `coverage` (`:743`); a
`supply-chain` job (`:577`) that runs on every PR and on a code push and gates the deploy; four proof
gates that run only on the deploy path, `ai-eval-gate` (`:522`), `cost-guard` (`:783`), `e2e-gate`
(`:806`) and `freshness` (`:831`, one job whose four steps carry the gate names `dr-freshness`,
`load-freshness`, `cross-service-freshness` and `cross-browser-freshness`); and three deploy-path jobs,
`foundation` (`:954`), `build-images` (`:1012`) and `deploy` (`:1156`).

Three structural decisions explain most of that. Validation is PR-only because branch protection
enforces admins and requires branches to be up to date, so the PR's `build-and-test` already tested the
exact tree that merges and is the test gate for the deploy (`deploy.yml:1160-1162`). Phase 1 and Phase 2
(foundation Bicep, then the image builds) live in their own jobs so they run **concurrently with** the
roughly 20-minute `e2e-gate` instead of behind it (`deploy.yml:946-953`, `:1174-1176`); `deploy` itself
is Phase 3 onward and consumes the prebuilt image tags. And the gates that remain on the deploy path
cover what the PR run cannot see: `e2e-gate` the full stack in a browser on a UI diff, `ai-eval-gate`
the paid live judge of the one component whose behavior can change with no code change at all
(`:501-521`), and `freshness` the age of the scheduled proofs, including the firefox and webkit coverage
that stays off the per-deploy critical path (`:823-830`).

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
the four `freshness` steps read run history through the Actions API, **and** `e2e-gate` needs it here
because a reusable workflow can never request more than its caller holds, so `e2e.yml`'s own
skip-if-unchanged guard would die on "Resource not accessible by integration" if the caller did not grant
it. A `permissions:` block is a ceiling for every workflow it calls, not just for its own steps.

[Rubric §11, Security] is embodied: OIDC federated identity eliminates the secret-rotation burden and
the credential-leak surface area of a static client secret. The federated credential is scoped to the
`production` environment (`deploy.yml:1139-1144`), so only jobs that declare `environment: production` can
obtain the Azure token.

### Job: `changes`, the docs-only short-circuit and the per-image dirty map

The first job (`deploy.yml:62-210`) classifies the diff and exposes **nine** outputs
(`deploy.yml:65-74`), which is where it differs from Common's single-flag version:

- `code`: false only when every changed path ends in `.md` (`deploy.yml:134-137`).
- `ui`: true only when the diff can change what a browser sees, that is the UI hosts, the Gateway, the
  AppHost, the E2E project, a module-owned Blazor UI project, a workflow file, or a build-wide file such
  as `Directory.Packages.props` or a `.slnx`/`.slnf` (`deploy.yml:140-153`).
- `scoring`: true only for the three trees that own the AI session scorer, its use case and its
  evaluation suite (`deploy.yml:159-164`), the flag that selects the paid half of `ai-eval-gate`.
- six `img_*` flags, one per container image (`deploy.yml:168-198`), the per-leg dirty map the
  `build-images` matrix consumes.

The flags are consumed differently, and the difference is the point. `code` guards the **heavy steps**
inside the required PR jobs, so a docs-only PR still runs every required job and posts every required
status green while doing almost nothing; it additionally gates the deploy-path jobs off entirely
(`deploy.yml:50-54`). `ui` gates `e2e-gate`, which costs roughly 20 minutes on every deploy: an
infra-only or backend-only change cannot change what the browser renders, so it does not pay for a browser
run (`deploy.yml:56-58`). The `img_*` flags let a build leg whose image is clean skip the build and push
entirely.

All nine outputs are fail-safe in both directions, with one deliberate exception noted below. An unknown push range (a new branch or a forced ref,
where `github.event.before` is empty or all zeros) sets `code`, `ui`, `scoring` and every image to true
rather than
guessing from a single commit (`deploy.yml:95-106`), and a failed `git diff` does the same
(`deploy.yml:109-121`). Inside the classifier loop the default arm of each `case` is also `true`
(`deploy.yml:136`, `:152`, `:195-197`), so an unrecognized path counts as code, as UI-affecting, and as
dirtying every image. Over-running CI wastes runner minutes; under-running it ships an unverified change.
The exception is `scoring`, whose per-path default arm is empty rather than `true` (`deploy.yml:163`):
its only consumer is the paid live-judge step of `ai-eval-gate`, so a false positive there spends money
on every unrelated deploy, while the two key-free tiers of that gate already run unconditionally
(`deploy.yml:154-158`).

The `ui` classifier carries a scar worth reading: `Source/Modules/*.UI/*` and `Source/Modules/*.UI.*/*`
are listed explicitly ahead of the general `Source/Modules/*` arm (`deploy.yml:150-151`), because
module-owned Blazor UI ships to the browser and the earlier ordering had swallowed it into the
backend-only bucket.

**The `img_*` map is a fan-in graph, not a path-to-image mapping**, and that is the part worth
internalizing. First match wins, so the shared trees are listed before the per-image ones
(`deploy.yml:166-167`). Build-wide inputs (version pins, MSBuild props, the SDK band, the feed config,
the solution files, any lock file, this workflow, the Aspire AppHost and migrations tree) dirty **every**
image (`deploy.yml:173-175`). A module's `.Shared` project carries the DTOs and identifier aliases that
every service host *and* the Blazor UI compile against, so one `.Shared` edit dirties everything that
ships module code, and only the Gateway (pure YARP over packages, referencing no module) escapes
(`deploy.yml:176-181`). A `.proto` or adapter change in any `.Contracts` project dirties all four service
images, because every service is both a gRPC server and a client of its peers (`deploy.yml:182-185`).
Only after those does a per-service or per-host path map to its single image (`deploy.yml:186-192`).

[Rubric §31, Cost Efficiency / FinOps] is served here in a form that costs nothing at runtime: the
classifier is one `git diff` and a `case` loop, and it removes both the browser leg and up to six image
builds from deploys that cannot need them.

### Job: `build-and-test`

**Pull-request-only** (`deploy.yml:213,201`): `needs: changes` plus `if: github.event_name ==
'pull_request'`. The comment gives the rationale (`deploy.yml:222-224`): under strict
require-branches-up-to-date protection the PR validates the exact tree that merges, so re-running the full
CI on the post-merge push is redundant. Every heavy step below additionally carries `if:
needs.changes.outputs.code == 'true'`, so a docs-only PR still posts this job's required status green.
No post-merge job re-runs these tiers on the push: branch protection enforces admins as well as strict
up-to-date checks, so this PR run is the test gate for the deploy (`deploy.yml:1160-1162`).

**Step 1, Setup and restore** (`deploy.yml:284-297`):
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
`~/.nuget/packages` on `**/packages.lock.json` (`deploy.yml:293`), and the comment records the
reasoning (`deploy.yml:289-292`): the committed lock files make the key exact, and locked mode means a
cache hit is authoritative because the restore cannot resolve anything the key did not account for.

**Step 2, Build** (`deploy.yml:301-303`): `dotnet build MMCA.ADC.CI.slnf --no-restore -c Release`, same
TreatWarningsAsErrors + five-analyzer enforcement as Common.

**Navigation contract fetch** (`deploy.yml:338-348`). Before the tests run, the job downloads the published
`adc-NavigationFlow.md` from the Website repository's `main` branch and exports its path as
`ADC_NAVIGATION_DOC` (`deploy.yml:344-348`). `NavigationContractTests` compares ADC's `@page` routes and
their access attributes with that document's Route Contract table (`deploy.yml:340-342`). Because the
contract lives in another repository, the comment states the ordering rule outright: a route or guard
change needs its Website doc PR merged first, or this run fails on the drift (`deploy.yml:342-343`). The
step runs under `set -euo pipefail` with `curl -fsSL` (`deploy.yml:345-346`), so an HTTP error fails the
step instead of handing the test a missing file.

[Rubric §14, Testability & Test Strategy] (assesses whether the important behavior is pinned by automated
tests) is served: the route and guard map a reader relies on in the navigation guide is checked against
the code on every PR, so the document cannot silently drift from the `@page` attributes it describes.

**Step 3, Unit and architecture tests with coverage** (`deploy.yml:350-366`):
```bash
dotnet tool install --global dotnet-coverage
dotnet-coverage collect -f cobertura -o coverage.unit.cobertura.xml \
  "dotnet test --solution MMCA.ADC.CI.slnf --no-build -c Release --minimum-expected-tests 5000"
```
As in Common's CI, the run is wrapped in `dotnet-coverage collect` (it returns the inner exit code so a
failure still gates) and uploaded as the `coverage-unit` artifact (`deploy.yml:368-376`, retention trimmed
to 14 days) for the report-only `coverage` job. Coverage is not checked in this step: the two floor steps below fail the build (`deploy.yml:352-355`). The
`--minimum-expected-tests 5000` floor is solution-wide (`dotnet test` aggregates it across every test app):
5000 is the `MMCA.ADC.CI.slnf` total of 5032 measured on one PR run, rounded down to the nearest 50 so a few
deleted tests do not trip it while a discovery or filter breakage that silently drops a whole project does
(`deploy.yml:356-360`). The same comment records why this step is the production test gate: branch
protection enforces admins and requires an up-to-date branch, so this run covers the exact tree that merges
and no post-merge job repeats it (`deploy.yml:360-362`). Every global tool this workflow installs is pinned to an exact
version (`dotnet-coverage` 18.11.0 and `dotnet-reportgenerator-globaltool` 5.5.11, at `deploy.yml:336`
and `:401`; the CycloneDX tool is installed inside the shared SBOM action), so a tool release cannot
change what a gate measures between two runs of the same commit.
 Covers unit tests
for all module layers plus `Architecture.Tests` (NetArchTest fitness functions, layer flow, domain purity,
module isolation).

[Rubric §14, Testability & Test Strategy] is served: architecture tests enforce that the modular
structure is not accidentally violated by a new project reference (e.g. `Domain` referencing
`Infrastructure`).

**Step 4, Unit-tier coverage floor** (`deploy.yml:378-408`). Unlike Common, ADC enforces its floor **here**
rather than in the `coverage` job, and the comment says why (`deploy.yml:380-381`): `build-and-test` is a
required PR check, while `coverage` is report-only and absent from `deploy`'s `needs`, so a floor living
there would gate nothing. The floor is **55.5%** line coverage (`deploy.yml:406`), measured with
ReportGenerator over `+MMCA.ADC.*;-*.Tests;-MMCA.ADC.*.Service;-MMCA.ADC.*.Contracts` (`deploy.yml:404`).

Every term in that filter is a correction of a measurement that lied. `+MMCA.ADC.*` excludes the consumed
MMCA.Common assemblies, which are tested in their own repo and instrument at near zero here, deflating the
figure to about 26.8%. The `*.Service` and `*.Contracts` exclusions were added on 2026-08-01 when
`MMCA.ADC.Services.Tests` first pulled the service hosts and the gRPC contracts into the unit cobertura:
hosts are integration-tier subjects (`Program.cs`, Kestrel config, warm-up) and contracts are dominated by
protobuf-generated plumbing, so both deflate the unit number without measuring unit code, 52.8% raw versus
62.5% filtered on the same run (`deploy.yml:387-392`). A coverage floor is only a regression backstop if
the number it watches moves for the reason you think it does.

**Step 5, Application-layer branch coverage floor** (`deploy.yml:410-444`). A second, narrower gate reads
the same cobertura file, and the reason it exists is the sharpest coverage argument in the repository
(`deploy.yml:412-418`). The repo-wide floor above is a blunt average dominated by UI, Infrastructure and
generated code, so a command handler can lose every branch it had and the global number barely moves. The
Application layer is where the business decisions live (guards, authorization short-circuits, retry and
conflict paths), and those are **branches**, not lines: a handler can be fully line-covered by one happy
path while every failure branch goes unexercised. So this gate measures branch coverage
(`deploy.yml:440`) over the four `Source/Modules/*/*.Application` assemblies only
(`-assemblyfilters:'+MMCA.ADC.*.Application;-*.Tests'`, `deploy.yml:432-433`), with a floor of **77.5%**
(`deploy.yml:442`), about two points under the 79.7% measured on 2026-08-26 across the full unit tier.

The step's most transferable line is the guard *before* the measurement (`deploy.yml:434-439`): if the
report covers fewer than four assemblies it fails outright, because a filter that matched nothing would
otherwise let the floor pass vacuously. That is the same instinct as the `--minimum-expected-tests` floors
throughout this chapter: a gate whose input went missing must be indistinguishable from a gate that failed.

**Step 6, EF migrations model-drift gate** (`deploy.yml:450-465`):
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
comment at `deploy.yml:453` names the comparison:
the design-time model against the committed migration snapshot.

This is one of the most important gates in the pipeline. An entity model that diverges from the migration
history means the production schema diverges from the application's EF model, a runtime crash on first
query of the changed entity. The gate catches it at build time, before any container image is pushed. It
is doubly important now that `deploy.yml` has *no* sqlcmd migration step: this build-time gate is the
guarantee that the services' startup `Migrate()` always has a migration to apply for every model change.

The `--no-build` flag reuses the Release build from Step 2, so there is no rebuild overhead. `dotnet-ef`
is installed globally (version `10.0.8`) in the step before this one (`deploy.yml:446-448`), the same pin
MMCA.Common's Helpdesk canary uses so the two exercise the same tool.

[Rubric §8, Data Architecture] (assesses whether schema management is automated, versioned, and safe)
is directly served. [Rubric §17, DevOps & Deployment] is served: the migration gate is the CI
enforcement of the "migrations-before-code" discipline.

**The expand/contract migration guard** (`deploy.yml:226-274`) is the job's *first* step, ahead of even
the .NET SDK setup, because it needs nothing but `git`, `awk` and `grep`:

```yaml
# deploy.yml:226-227
- name: Expand/contract migration guard (schema rollback safety)
  if: needs.changes.outputs.code == 'true'
```

It is the other half of the schema-safety story the model-drift gate starts. The drift gate proves a
migration *exists* for every model change; this one proves the migration is safe to be rolled back past.
The post-deploy smoke gate's remedy (Phase 5 below) is a container-app **revision** rollback, and a
revision rollback does **not** revert schema: each service self-applies its migrations at startup, so the
previous release comes back up against the *new* schema. A `DropColumn`, `DropTable` or `DropIndex` in
the migration that just shipped therefore breaks one-release-back compatibility, and the rollback that
was supposed to rescue the deploy fails on the way back down. The step comment (`deploy.yml:228-239`)
states exactly that chain.

The rule: for every migration file **added** by the pull request, if the `Up()` body contains
`DropColumn`, `DropTable` or `DropIndex` and does not contain `EXPAND-CONTRACT-OVERRIDE`, fail
(`deploy.yml:266-269`). Three scoping decisions carry the design:

- The file set is `git diff --diff-filter=A --name-only "origin/<base>...HEAD"` (`deploy.yml:250-251`),
  path-scoped to `Source/Hosting/MMCA.ADC.Migrations.SqlServer.*/Migrations/*.cs`. Only *added* files
  count, so the four per-service migrations projects are covered and nothing else in the tree is.
- `.Designer.cs` files are skipped (`deploy.yml:262-264`), they carry the model snapshot, not operations.
- Only the `Up()` body is scanned, extracted with `awk` between the `Up(` and `Down(` signatures
  (`deploy.yml:265`). Every additive migration's `Down()` legitimately drops what `Up()` added, and
  `Down()` never runs at startup (down-migration is explicit tooling only), so scanning the whole file
  would fail every ordinary migration.

The escape hatch exists because the *contract* half of an expand/contract sequence genuinely is a drop,
and it is correct once the expand half has been in production for a release. It is documented as
`// EXPAND-CONTRACT-OVERRIDE: <reason>` but enforced as a bare substring match (`deploy.yml:267`), so the
comment form is convention, not syntax, and one occurrence anywhere in the `Up()` body exempts **every**
destructive operation in that migration. The marker is a prompt for the reviewer to ask "has the expand
half already shipped?", not a machine-checked proof that it has.

The checkout immediately above sets `fetch-depth: 0` for this step alone, and says so
(`deploy.yml:223-224`): without full history the base diff cannot resolve. That coupling produces the
most transferable lesson in the whole job. There is deliberately no `|| true` on the diff: when it fails,
the step prints an error naming `fetch-depth` and exits 1 (`deploy.yml:245-254`). A gate that cannot
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

**OpenAPI documents are current** (`deploy.yml:297-312`) is a contract-first gate that runs right after
the Release build. Each `*.Service` host writes `openapi/<host>.json` during that build (the
`MmcaGenerateOpenApiDocument` target in `Directory.Build.props`, per the comment at `deploy.yml:299-302`), and
the four documents are committed. The step asserts that exactly four documents are tracked
(`deploy.yml:305-308`) and that `git diff --exit-code` over `Source/Services/*/openapi/*.json` is empty
(`deploy.yml:309-311`). A PR that changes a route, parameter, status code or response shape without
committing the regenerated document therefore fails, so the contract change is a reviewable diff instead of
a runtime surprise. When it fails, **Upload the regenerated OpenAPI documents** (`deploy.yml:314-324`, under
`if: failure()`) publishes the runner's regenerated files as the `openapi-regenerated` artifact with a
seven-day retention: those files ARE the expected contract, so the fix is a download and a commit rather than
guessing from a `--stat` line, and a green run leaves no artifact behind. Both steps are guarded on the `code`
flag like the rest of the job.

### Job: `ai-eval-gate`, the behavior that changes without a code change

`ai-eval-gate` (`deploy.yml:501-568`) exists for the one component in this repository whose behavior can
move while every unit test stays green: the AI session scorer that ranks submitted talks for organizers.
The comment states the case (`deploy.yml:502-504`): a prompt edit, a model deprecation, or a
provider-side contract change each moves the numbers an organizer uses to accept or decline a talk.

**The evaluation has two tiers split by cost, and the split decides where each one runs**
(`deploy.yml:508-521`):

1. **Golden replay plus prompt contract.** No API key and no network: recorded proposals are replayed
   through the real scoring service, and the rendered prompt is hashed against the hash recorded for the
   current `PromptVersion`. This is the tier that catches a prompt edit that forgot to bump the version,
   a delimiter that stopped being emitted, and a change to the weighting math. These tests carry no
   trait, so they run on every pull request in `build-and-test`'s `MMCA.ADC.CI.slnf` pass, against the
   exact tree that merges (`deploy.yml:512-513`).
2. **Live judge.** Real paid calls to the configured AI provider's API for each golden proposal,
   asserting the overall score lands in the case's band. The bands are deliberately wide: a judge model
   is not deterministic, and a flaky gate gets ignored (`deploy.yml:514-516`).

The job exists for the second tier, so it runs only on a code deploy whose diff touches the scoring code,
`if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true' &&
needs.changes.outputs.scoring == 'true'` (`deploy.yml:524`), precisely because it costs money; every
other deploy skips it, and `deploy` accepts `skipped` (`deploy.yml:518-521`). It restores and builds one
project by path, `Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests`, with
`--locked-mode` (`deploy.yml:539-545`), so it never pays for the full solution, and it re-runs the replay
tier first as a cheap precondition for spending on the judge, with `--filter-not-trait
"Category=AiEval.Live" --minimum-expected-tests 1` (`deploy.yml:547-554`): a filter breakage that runs
zero tests must red the gate rather than report a vacuous pass.

Two details in the live step are worth reading. It sets **no** `--minimum-expected-tests` floor, and the
comment says why (`deploy.yml:557-559`): without `AI_API_KEY` every case skips itself dynamically,
reported as skipped and never as passed, so a zero-run must not red the deploy on a repository whose
secret is absent. And the key arrives as a step-scoped `env` from `secrets.ANTHROPIC_API_KEY` mapped to
the provider-neutral variable `AI_API_KEY` (`deploy.yml:565-568`; the secret keeps its name because it
holds an Anthropic credential, and only the variable the test reads is neutral), never as a build
argument or a workflow input.

This is also why `scoring` is the one classifier output that does **not** fail safe to `true`
(`deploy.yml:162`): a false positive there spends money on an unrelated deploy, while the key-free tier
already runs on every PR, so the narrow set costs nothing in coverage.

[Rubric §14, Testability & Test Strategy] assesses whether the system's behavior is actually verified
rather than merely compiled. The golden replay is the honest answer for a non-deterministic component:
the deterministic parts (prompt rendering, version pinning, weighting math) are asserted exactly, and the
non-deterministic part is asserted as a band. [Rubric §31, Cost Efficiency / FinOps] is served by the
tier split itself: the gate that costs money runs only for the diffs that can change what it measures.

### Job: `supply-chain`

This job (`deploy.yml:577`) runs on every pull request and on every code push, `if: github.event_name ==
'pull_request' || needs.changes.outputs.code == 'true'` (`deploy.yml:579`), so a docs-only push skips it
along with the deploy. Unlike the other validation jobs it is **not** PR-only: it is in `deploy`'s `needs`
list (`deploy.yml:1159`) and its result must be `success` for the deploy to proceed (`deploy.yml:1191`).
Both of its steps that matter are gates, and the comment above the job splits them by event
(`deploy.yml:570-576`): the vulnerability audit runs on both events, the SBOM on the pull request only.

**The two gates:**

- **Vulnerability audit** (`deploy.yml:599-612`) fails on any vulnerable-package row except advisories
  accepted via `NuGetAuditSuppress` in `Directory.Build.props`. It is no longer a copy of Common's gate: it
  calls the shared composite action `ivanball/MMCA.Common/.github/actions/nuget-vulnerability-audit@main`
  (`deploy.yml:608-612`), the implementation Common's `ci.yml` runs by path, so the fail-closed exit-code and
  report-header checks and the narrow `<NuGetAuditSuppress ... Include="GHSA-..."` accept-list reading
  described in the Common section above apply here unchanged. The comment (`deploy.yml:601-607`) gives the
  reason: one implementation for the framework and its consumers instead of a copy per repository that
  drifts ([ADR-038](https://ivanball.github.io/docs/adr/038-supply-chain-provenance.html)). ADC passes `report-path: supply-chain/vulnerable.txt`, so the raw report still
  lands in the artifact uploaded on the pull request. NuGetAudit at restore already gates the build; this makes the job a
  deploy-gating belt-and-suspenders check.

- **CycloneDX SBOM** (`deploy.yml:614-628`) must exist **and contain components**, and it is generated on
  the pull request only (`deploy.yml:615`). It calls the shared `cyclonedx-sbom@main` action
  (`deploy.yml:623-628`) with `name: MMCA.ADC.CI` and `filename: adc-sbom.json`; the action fails unless
  the file exists and `jq '.components | length'` is greater than zero
  (`MMCA.Common/.github/actions/cyclonedx-sbom/action.yml:68-71`), because a zero-component skeleton
  passes a plain file-size check, which is exactly how an empty SBOM once went unnoticed. The comment
  (`deploy.yml:616-622`) records three further choices: the action normalises the `.slnf` itself; the
  first-party action is referenced by branch rather than by SHA on purpose, since MMCA.Common `main` is
  PR-protected and a ref is what keeps the consumer gate from drifting away from the framework's; and the
  step is PR-only because branch protection requires an up-to-date branch, so the PR's SBOM describes
  the exact lock files that merge. On a push the job adds only what can be new, the restore and the
  audit, which catch an advisory published after the PR ran (`deploy.yml:573-575`).

The vulnerability report and the SBOM upload as the `supply-chain-reports` artifact with a 14-day
retention, on the pull request only (`deploy.yml:630-639`).

A `.slnf` records Windows-style project paths, and on the Linux runner a backslash is an ordinary
filename character, so a tool that opens those paths directly resolves **zero** projects. `dotnet list`
is unaffected because MSBuild normalizes separators, but CycloneDX once emitted an empty SBOM this way.
That is why the job passes the **original** `MMCA.ADC.CI.slnf` to the SBOM action (`deploy.yml:625`) and
leaves the forward-slash normalization to the action itself
(`MMCA.Common/.github/actions/cyclonedx-sbom/action.yml:58-61`), and why `--set-name MMCA.ADC.CI` lives
inside that action too, driven by the `name: MMCA.ADC.CI` input (`deploy.yml:626`, applied at
`action.yml:65`): it pins the BOM metadata component to a stable name.

One scope limit is worth naming here, because a separate workflow exists to cover it: this job audits
`MMCA.ADC.CI.slnf`, which deliberately excludes the MAUI head, so the largest dependency graph in the
repo is invisible to it. That gap is closed weekly by `maui-audit.yml`, covered in the repository
automation section below.

The transferable lesson is the one the empty SBOM taught: a supply-chain artifact that is generated but
never asserted on is indistinguishable from one that was never generated.

[Rubric §32, Dependency & Supply-Chain] is served, now as a gate rather than a report: a non-suppressed
vulnerable package blocks the production deploy, and a component-less SBOM blocks the merge, so every
merged tree carries a machine-readable inventory of what it ships.

### Job: `integration-tests`

This job is **pull-request-only** (`deploy.yml:653,544`), and `deploy` does not list it:
```yaml
needs: changes
if: github.event_name == 'pull_request'
```
It runs the per-service `WebApplicationFactory` integration tests against a real SQL Server, covering
roughly 420 test methods across the four projects `MMCA.ADC.Integration.slnf` lists: Identity,
Conference, Engagement and Notification (`MMCA.ADC.Integration.slnf:5-8`).

How it protects production is worth being precise about, because the mechanism is not the one you
would guess. This job never runs on the push to `main`, and it is absent from `deploy`'s `needs`
list (`deploy.yml:1159`); the only job that consumes it is `coverage` (`deploy.yml:744`). The protection
comes from branch protection instead: admins are enforced and `main` requires branches to be up to date,
so the PR check runs against the exact merge tree that will land (`deploy.yml:1160-1162`). The practical
consequence is that a `workflow_dispatch` run of `deploy.yml` does not re-run the integration tier at
all, and that no deploy-path job re-runs the PR's test tiers: the PR checks are the test gate, with
`e2e-gate` adding the browser tier on a UI diff.

**SQL Server as a guarded step, not a `services:` block** (`deploy.yml:667-675`):
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
(`deploy.yml:654-658`). MMCA.Common's Helpdesk canary now uses the identical pattern for its migration
apply (`MMCA.Common/.github/workflows/ci.yml:543-546`).

The password lives in the job's `env:` (`deploy.yml:662-663`) because it is a throwaway SA credential for
an ephemeral container, not a production secret, and not stored in GitHub Secrets. The comment states it
explicitly (`deploy.yml:657-658`): "Throwaway SA password, not a secret."

**Wait-for-SQL-Server gate** (`deploy.yml:691-703`): a 30-iteration poll loop (5-second sleep each) using
`sqlcmd` (installed by the step at `deploy.yml:685-689`) to execute `SELECT 1`. SQL Server takes 10 to 20
seconds to initialize in a fresh container; proceeding immediately would fail the restore or build with a
connection error. The loop exits early on success rather than running the full 150-second maximum, and
exits 1 if the server never answers, so a container that failed to boot is a job failure rather than a
confusing downstream test error.

**Integration test run** (`deploy.yml:719-726`): like the unit tier, the test command is wrapped in
`dotnet-coverage collect` (emitting the `coverage.integration.cobertura.xml` artifact at
`deploy.yml:728-736`):
```yaml
env:
  ADC_TEST_SQL_BASE: "Server=localhost,1433;User Id=sa;Password=${{ env.MSSQL_SA_PASSWORD }};TrustServerCertificate=True;Encrypt=False;"
run: dotnet test --solution MMCA.ADC.Integration.slnf --no-build -c Release --minimum-expected-tests 1
```
The `ADC_TEST_SQL_BASE` connection string is consumed by `IntegrationTestBase` to provision per-test
databases (each test gets a fresh database, reset between tests). `MMCA.ADC.Integration.slnf` is a
separate solution filter that includes only the four integration test projects; the restore and build
steps immediately before (`deploy.yml:705-713`) target the same filter, restore in `--locked-mode` like
`build-and-test`.

[Rubric §14, Testability & Test Strategy] is served at a higher tier than the unit tests: these tests
exercise real EF migrations, real HTTP middleware, real domain logic through a real SQL Server engine. A
bug that only manifests under an actual database connection (e.g. a LINQ translation error, a migration
column type mismatch) is caught here before it reaches production.

### Job: `coverage`, report-only by design

This job (`deploy.yml:740-784`) downloads both `coverage-*` artifacts, merges the unit/architecture/bUnit
and integration cobertura tiers with ReportGenerator over `+MMCA.*;-*.Tests`, writes the summary to the
run's Step Summary, and uploads the HTML report (`deploy.yml:762-784`).

Two conditions are worth reading together. `needs: [changes, build-and-test, integration-tests]` with `if:
always() && github.event_name == 'pull_request'` (`deploy.yml:741-742`) means it runs after both test
jobs regardless of their outcome, so a failing run still yields its partial coverage picture. And it is
**not** in `deploy`'s `needs` (`deploy.yml:1319`), which is the deliberate part: this job never blocks
anything. That is precisely why ADC's coverage **floors** live in `build-and-test` instead
(`deploy.yml:321-391`, above). Splitting them this way keeps the enforcement on a required check and the
merged report where it is useful, on the pull request.

[Rubric §14, Testability & Test Strategy] is served in two tiers here: the floors are the gate, the merged
report is the visibility.

### Job: `cost-guard`, a scheduled check promoted to a deploy gate

```yaml
# deploy.yml:789-792
cost-guard:
  if: github.event_name != 'pull_request'
  uses: ./.github/workflows/cost-guard.yml
  secrets: inherit
```

The FinOps surge-drift check gets its own section further down as a standalone workflow. What matters
here is the four-line job that makes it a gate: `deploy.yml` calls `cost-guard.yml` as a **reusable
workflow** and lists it in `deploy`'s `needs` (`deploy.yml:1319`, required `success` at `:1356`), so a
production deploy cannot proceed while a conference-day scale-up is still un-reverted (`deploy.yml:786-788`).

It is skipped on pull requests because there is no production OIDC there, and `deploy` is PR-skipped
anyway. The cost of the gate is under a minute of read-only `az` queries, which is what makes reusing the
weekly cron's own workflow the cheap option rather than a duplicated inline check.

[Rubric §31, Cost Efficiency / FinOps] is served in the strongest available form: an un-reverted surge
does not merely raise an alert, it stops the next deploy until someone reverts it.

### Job: `e2e-gate`, one chromium leg against the full Aspire stack

```yaml
# deploy.yml:806-821
e2e-gate:
  needs: changes
  if: github.event_name != 'pull_request' && needs.changes.outputs.ui == 'true'
  uses: ./.github/workflows/e2e.yml
  with:
    browsers: '["chromium"]'
  secrets: inherit
```

The same reusable-workflow shape as `cost-guard`, pointed at `e2e.yml`. This is the §28 merge-gate
promotion of 2026-07-02 (`deploy.yml:798-805`): the Playwright suite runs against the full Aspire stack
(SQL Server, Redis, RabbitMQ, four services, Gateway, UI) before a deploy is allowed to roll.

Three scoping decisions carry it, and each is a cost or a correctness trade made explicit:

- **Chromium only.** The gate runs one engine instead of three (2026-07-18), and firefox plus webkit
  cross-browser coverage stays on `e2e.yml`'s own schedule. One engine still catches the regression class
  that matters on the deploy path; three paid triple for information that changes on the scale of a
  release.
- **Gated on `ui`, not `code`** (`deploy.yml:808-810`). At roughly 20 minutes this is the most expensive
  gate in the pipeline, and an infra-only, script-only or backend-only deploy cannot change what the
  browser sees. The comment says why the deploy that skips it is not untested (`deploy.yml:812-816`):
  the PR's `build-and-test` (the `CI.slnf` unit, architecture and bUnit tiers) is the test gate, because
  branch protection enforces admins and requires an up-to-date branch, so that run covers the exact tree
  that merges; and the post-deploy smoke gate probes Conference, Engagement and Notification through the
  Gateway and auto-rolls-back behind it. It also names the revert, change `ui` back to `code`, which is
  the right thing for a cost optimization to document.
- **`success` or `skipped`.** In `deploy`'s condition the unconditional gates must all be `success`, but
  `e2e-gate` may also be `skipped` (`deploy.yml:1196`). That exception is the whole reason `deploy` uses
  `always()` plus explicit per-need results instead of default `success()` semantics, covered under the
  `deploy` job below.

The advice in the comment is worth keeping (`deploy.yml:804-805`): if a genuine contention flake blocks a
deploy, re-run the job and read its trace artifact before demoting the gate over a single red.

[Rubric §28, Front-End Testing & Quality] is served: a browser-level regression in a UI-affecting change
cannot reach production.

### Job: `freshness` (steps `dr-freshness`, `load-freshness`, `cross-service-freshness`, `cross-browser-freshness`)

One job, four near-identical steps, one idea: **a deploy blocks on the age of out-of-band verification,
not only on the tests that are green in this run**. Each step asks the Actions API for the newest
qualifying run of one scheduled workflow and fails when that proof is older than its window, or when
there is no qualifying run at all. Each step's `name` and `id` is the gate's name, so a red step reads
exactly as the gate it is (`deploy.yml:823-830`).

| Step | Proof it demands | Producing workflow | Window |
|---|---|---|---|
| `dr-freshness` (`deploy.yml:844`) | a real PITR restore drill with its RTO timing | `dr-drill.yml` | 8 days (`deploy.yml:853`) |
| `load-freshness` (`deploy.yml:863`) | the k6 capacity run at the observed peak | `load-test.yml` | 35 days (`deploy.yml:872`) |
| `cross-service-freshness` (`deploy.yml:884`) | the Testcontainers outbox to broker to consumer round-trip **and** the Service Bus emulator parity smoke | `cross-service-tests.yml` | 5 days (`deploy.yml:897`) |
| `cross-browser-freshness` (`deploy.yml:923`) | a successful firefox **and** webkit leg of the Playwright suite | `e2e.yml` | 10 days (`deploy.yml:936`) |

Every step calls the shared composite action `ivanball/MMCA.Common/.github/actions/freshness-gate@main`
(`deploy.yml:849`, `:868`, `:891`, `:931`), one implementation for every consumer
([ADR-038](https://ivanball.github.io/docs/adr/038-supply-chain-provenance.html)). The action lists a
workflow's runs unfiltered and filters them client-side, paging as needed, because the server-side
`status=completed` and `status=success` listings have served stale pages that hid the newest runs
(`MMCA.Common/.github/actions/freshness-gate/action.yml:13-14`, request at `:166`). The job runs only on a
code push or dispatch, `if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true'`
(`deploy.yml:833`), with a five-minute timeout and only two read privileges, `actions: read` plus
`contents: read` (`deploy.yml:835-838`): it reads run history and runs nothing, no restore, no k6, no
Docker daemon. Steps two to four carry `if: ${{ !cancelled() }}` (`deploy.yml:865`, `:886`, `:925`), so
one stale proof never hides the state of the others, and the job fails when any step fails. And
`freshness` sits in `deploy`'s `needs` list (`deploy.yml:1159`), which is the entire point: a stale proof
blocks the production deploy.

That `needs` edge is what separates a gate from a report. A scheduled workflow nobody watches can sit
unrun or red for weeks while deploys ship daily, and the recovery-objective evidence still technically
"exists". Making recency a dependency prices the verification correctly too: the expensive run stays on
its cron, the deploy pays for a lookup. Each window is the producing cadence plus slack (weekly drill and
an 8-day window, monthly k6 and a 35-day window, alternating weekly browser crons and a 10-day window),
so an on-schedule producer never trips the gate.

`cross-browser-freshness` closes a hole the cost reduction opened. The deploy-gating `e2e-gate` runs
**chromium only**, so firefox and webkit coverage lives on `e2e.yml`'s alternating weekly crons; this
step makes that coverage mandatory again without putting either engine back on the roughly 20-minute
per-deploy critical path, which is exactly how the step's own comment states it (`deploy.yml:907-911`).

Like `cross-service-freshness`, it refuses to trust a run's conclusion, and here it resolves each engine
**separately** (`required-jobs-mode: per-job`, `deploy.yml:938-942`): it walks the last 40 completed
`e2e.yml` runs and, for each engine, takes the newest run in which the job named `E2E (<engine>)` itself
concluded `success`, so the two proofs normally come from two different runs and either one missing or
stale fails the step (`deploy.yml:926-930`). The comment gives the reason the run conclusion is a lying
proxy (`deploy.yml:918-922`): the matrix is `fail-fast: false` with the non-chromium legs
`continue-on-error` on the schedule, so a run's conclusion says nothing about whether a given engine
actually passed; and `e2e.yml`'s own should-run guard can make a run conclude `success` with every leg
**skipped**. Asking the jobs API which leg passed is the only question whose answer means what the gate
needs it to mean.

The 10-day window is the per-engine weekly cadence (Monday firefox, Thursday webkit) plus slack for a
skipped or re-run night (`deploy.yml:913-916`, `:935-936`), and the break-glass is the same as for the
other three steps, described below.

[Rubric §28, Front-End Testing & Quality] assesses whether browser-level tests catch rendering and
functional regressions. This gate is how cross-engine coverage (which the workflow labels rubric §22)
stays enforceable while only one engine runs per deploy: the proof still has to exist and still has to
be recent, it just does not have to be produced by this run.

`cross-service-freshness` is the one worth reading closely, because it does **not** trust the run's
conclusion, and because what it demands was widened on 2026-08-31 (TD-17). It walks the last 25
*completed* runs of `cross-service-tests.yml` (any conclusion) and counts a run only when **both** the
`cross-service` job (the Testcontainers RabbitMQ outbox to broker to consumer round-trip) and the
`servicebus-emulator-smoke` job (Azure Service Bus emulator topology plus AMQP round-trip) concluded
`success` in that same run (`required-jobs-mode: same-run`, `deploy.yml:899-903`).

That second job used to be advisory (`continue-on-error`), which meant broker parity against the
transport production actually runs was measured nightly and then thrown away, since a red there blocked
nothing (`cross-service-tests.yml:116-122`). Making it authoritative is what turns "the outbox reaches
*a* broker" into "the outbox reaches *both* the test broker and the production transport's emulator".

The run conclusion is not a usable proxy, and the step's comment says why (`deploy.yml:887-890`): the
skip-if-unchanged guard can make a run conclude `success` with the test jobs **skipped**, so no
round-trip executed, and keying off the run would accept a proof that never happened. Counting any
*completed* run works in the other direction too: a run cancelled after both broker jobs passed still
holds a genuine, recent proof, and it counts. The per-job check is honest both ways because it counts a
run only when both named jobs actually ran and passed. And the workflow's own comment states the
counterpart rule for whoever finds this red (`cross-service-tests.yml:124-126`): fix it or dispatch a
green run, do not re-add `continue-on-error` to unblock a deploy. The sanctioned escape hatch is the
break-glass below, which forces a written justification into the run summary.

Its window was widened from 3 to 5 days on 2026-07-18 (`deploy.yml:895-897`) when `cross-service-tests.yml`
moved to weekdays plus the skip-if-unchanged guard: the last successful nightly can legitimately be about
four days old across a weekend or a holiday. A window narrower than the producing cadence is a gate that
fails for calendar reasons, and a gate that fails for calendar reasons trains people to reach for the
break-glass.

**Break-glass** is two `workflow_dispatch` inputs, `skip_freshness_gates` and `skip_justification`
(`deploy.yml:13-18`), passed to every step as `skip` and `skip-justification` (`deploy.yml:855-856`,
`:874-875`, `:904-905`, `:943-944`). Inside the action the skip takes effect only together with a
non-empty justification, which is recorded in the step summary and as a warning
(`MMCA.Common/.github/actions/freshness-gate/action.yml:60-65`), and a justified skip exits `success`
(`deploy.yml:1180-1181`). Three properties make it a sound escape hatch rather than a hole: it is
unreachable on a push (the inputs exist only on a dispatch), one flag covers all four steps so an
operator in a hurry does not disable them one at a time, and its cost is a permanent attributable record
in the run summary instead of a quiet edit to a `needs:` list. Note the interaction with `deploy`'s
condition (`deploy.yml:1193`): a broken-glass step still reports `success`, which is what lets the
deploy condition demand `success` from `freshness` without special-casing.

MMCA.Store runs the same single job with the same four steps
(`MMCA.Store/.github/workflows/deploy.yml:774`, steps at `:788`, `:806`, `:825`, `:856`), and its
`deploy` needs list matches (`MMCA.Store/.github/workflows/deploy.yml:1083`), minus `ai-eval-gate`,
which is an ADC addition.

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
# deploy.yml:1134-1149
foundation:
  needs: changes
  if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true'
  environment: production
  outputs:
    acrName: ${{ steps.foundation.outputs.acrName }}
    acrLoginServer: ${{ steps.foundation.outputs.acrLoginServer }}
    logAnalyticsName: ${{ steps.foundation.outputs.logAnalyticsName }}
```

`infra/foundation.bicep` (`deploy.yml:1160-1166`) provisions the durable resources that must exist
before a container image can be pushed at all: the Log Analytics workspace
(`infra/foundation.bicep:28-29`) and the Basic-tier Azure Container Registry
(`infra/foundation.bicep:50-56`), whose admin user is disabled because both the apps (AcrPull) and the
deploy (AcrPush) authenticate as managed identities (`infra/foundation.bicep:58-60`). It was split out
of `deploy` on 2026-07-21 so image builds can run **concurrently with** the roughly 20-minute
`e2e-gate` instead of serially after it (`deploy.yml:1126-1133`).

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

Its three outputs are promoted to **job** outputs (`deploy.yml:1145-1149`) for a concrete reason: `acrName`
is derived inside Bicep from `uniqueString(resourceGroup().id, environmentName)` and therefore cannot be
recomputed by a later job. A downstream job either receives it or guesses wrong.

**`environment: production` is load-bearing here, and not for approvals** (`deploy.yml:1139-1144`). The
federated identity credential's subject is `repo:ivanball/ADC:environment:production`. A job without an
`environment:` presents `repo:ivanball/ADC:ref:refs/heads/main` instead, and `azure/login` fails with
AADSTS700213, "No matching federated identity record". Every job that runs `azure/login` needs the
declaration. The comment even cites the run that proved it on MMCA.Store. This is the single most
transferable OIDC gotcha in the repository.

### Job: `build-images`, Phase 2

Six images are built and pushed, one per matrix leg (`deploy.yml:1195-1216`): `mmca-adc-gateway`,
`mmca-adc-ui`, `mmca-adc-conference`, `mmca-adc-identity`, `mmca-adc-engagement`,
`mmca-adc-notification`. The Gateway and UI Dockerfiles live under `Source/Hosts/`
(`Source/Hosts/MMCA.ADC.Gateway/Dockerfile` at `deploy.yml:1200`,
`Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile` at `:1203`); the four back-end services live under
`Source/Services/` (`:1205-1216`). `fail-fast: false` (`deploy.yml:1196`) so one image's failure does not
cancel the other five.

These were previously six sequential `docker build` steps inside `deploy`, measured at 928 seconds on one
run (`deploy.yml:1169-1170`). One matrix leg per image makes the phase cost roughly the **slowest** image
(about 4 minutes) rather than their sum, and because the job no longer sits behind `e2e-gate` the whole
phase hides underneath that gate and leaves the critical path entirely.

**Each leg is now individually gated on whether its image is dirty.** The matrix carries a `changed`
column fed from the `changes` job's `img_*` map (`deploy.yml:1199-1216`), and the build-and-push step only
runs when it is `'true'` (`deploy.yml:1236-1237`). A clean leg takes the other branch and re-tags instead
(`deploy.yml:1270-1283`):

The re-tag branch does one more thing, and it is a cost-control interaction worth knowing
(`deploy.yml:1284-1314`). After minting the sha tag it re-imports that same sha back onto `:latest`. The
daily `purge-old-images` ACR task keeps only the three most recently updated tags per repository and
deletes anything older than three days, and importing a new sha tag does not touch `:latest`, so after a
few deploys that leave an image clean the very tag this branch reads from would age out, get purged, and
fail the next clean leg (which blocks the whole deploy, since `deploy` requires `build-images` to
succeed). Re-importing the identical digest is a registry-side manifest copy: `:latest` keeps pointing at
the same image and only its timestamp moves. The build-and-push branch already pushes `:latest` on every
build, so both branches keep the tag alive.

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
(`deploy.yml:1363`), so gating with a job-level `if` (or letting a leg skip) would turn the whole job
`skipped` and silently cancel the deploy (`deploy.yml:1183-1187`).

Nothing is rolled out here (`deploy.yml:1173-1176`). Images are tagged with both `${{ github.sha }}` (the
exact commit, immutable and traceable) and `latest`, and pushed to ACR (`deploy.yml:1244-1246`), but
`deploy` still waits on every gate before `main.bicep` points any container app at them. A red gate
therefore leaves an unreferenced image in ACR, which the scheduled purge task in `foundation.bicep`
reaps. Building speculatively is only safe when publishing and *referencing* are separate acts.

**The token is a BuildKit secret, not a build arg** (`deploy.yml:1252-1253`, comment `:1178-1181`):

```yaml
secrets: |
  github_token=${{ secrets.GITHUB_TOKEN }}
```

`--build-arg` bakes a value into the image layer where `docker history` can read it back; a BuildKit
secret is mounted only for the `RUN` steps that need it (restore and publish) and never enters a layer.
`DOCKER_BUILDKIT=1` is set explicitly so the requirement fails loudly rather than silently degrading. The
comment adds a detail worth keeping (`deploy.yml:1247-1251`): secret *content* is not part of the cache
key (only the instruction text is), so rotating the token does not needlessly bust the restore layer,
which is safe because the package set is pinned by the committed lock files and a
`Directory.Packages.props` change lands in the same `COPY` layer and busts it anyway.

**The layer cache is in ACR, not `type=gha`** (`deploy.yml:1260-1261`), and the comment
(`deploy.yml:1254-1259`) is a small masterclass in cache sizing. The GitHub Actions cache has a hard 10 GB
per-repo quota with LRU eviction; six images exporting `mode=max` multi-stage SDK layers plus a large
NuGet layer each would thrash it into a near-zero hit rate while still paying the export cost. The
registry the job already authenticates to has no quota and costs pennies. `mode=max` rather than `min` is
required because `min` caches only the final stage, which is exactly the one that is cheap: the expensive
layers are restore and publish, inside the build stage. Buildx with the `docker-container` driver
(`deploy.yml:1230-1234`) is what makes an external cache possible at all, since the default driver cannot
import or export one.

[Rubric §17, DevOps & Deployment] is served: each image is uniquely identified by the commit SHA,
making every deployment fully traceable to its source code. [Rubric §11, Security] is served by the
BuildKit-secret handling: no credential is recoverable from a published layer.

### Job: `deploy`

Runs only on push to `main` or `workflow_dispatch`, never on pull requests, and only when every gate
above has reported. Its `needs` list is the pipeline in one line (`deploy.yml:1159`):

```yaml
needs: [changes, supply-chain, cost-guard, freshness, e2e-gate, ai-eval-gate, foundation, build-images]
```

Note what is *not* there: `build-and-test`, `integration-tests` and `coverage`. Those are the required PR
checks, and they are the test gate: branch protection enforces admins and requires an up-to-date branch,
so the PR run covers the exact tree that merges and no post-merge job re-runs those tiers
(`deploy.yml:1160-1162`). A docs-only push skips `supply-chain`, `cost-guard` and `freshness` along
with the deploy itself (`deploy.yml:1171-1172`).

The condition itself (`deploy.yml:1186-1197`) is `always()` plus an explicit result check per dependency
rather than the default `success()` semantics, and the comment records the incident that forced it
(`deploy.yml:1178-1181`). Because `e2e-gate` is `ui`-scoped, it legitimately **skips** on a backend-only
merge, and under `success()` a skipped dependency cascades into a skipped `deploy`: a run went fully green
and shipped nothing. So every unconditional gate must be `success` (none of them skips on a code deploy,
since the freshness break-glass exits success inside each step), while the **two conditional** gates may
be `success` **or** `skipped`: `e2e-gate` (`deploy.yml:1196`), which runs on a UI diff, and
`ai-eval-gate` (`deploy.yml:1197`), which runs on a scoring-code diff (`deploy.yml:1183-1185`). The
post-deploy smoke gate is the post-rollout backstop behind both.

That is the general lesson: `needs` expresses ordering, but "did this dependency actually pass" and "did
this dependency run" are different questions, and default `success()` semantics answer them together.

The job declares `environment: production` (`deploy.yml:1367`) and opens with a checkout and its own
`azure/login@v3` (`deploy.yml:1369-1376`), for the federated-credential reason described under
`foundation`. Everything below is Phase 3 onward.

**Phase 3, Deployment parameters file** (`deploy.yml:1381-1585`):

Rather than passing `key=value` pairs inline to `arm-deploy`, the step builds a JSON parameters file
from scratch using `jq` (there is no committed parameters template, see the IaC chapter's note that
`infra/main.parameters.json` does not exist). The `jq --arg` flag properly JSON-escapes multiline values (critical for the RSA PEM keys,
which contain newlines). The base parameter set is always present (`deploy.yml:1438-1469`), including the
six SHA-tagged image references read from `needs.foundation.outputs.acrLoginServer`. Optional parameters
(OAuth credentials, the AI provider key (`AI_API_KEY`, fed to the Bicep `aiApiKey` parameter), SMTP config, the synthetic-traffic key, managed-identity SQL
settings) are conditionally appended only if their env vars are non-empty:

```bash
# deploy.yml:1479-1482
if [ -n "$OAUTH_GITHUB_CLIENT_ID" ]; then
  jq --arg k "$OAUTH_GITHUB_CLIENT_ID" '.parameters.githubOAuthClientId = {"value": $k}' ...
fi
```

This pattern means the deployment is not blocked if an optional secret has not been configured, it
simply omits that parameter, and the Bicep template's `@secure()` `param` falls back to its default
(typically an empty string, which disables the feature). Sign in with Apple is the clearest example: all
four pieces (`client id`, `team id`, `key id`, private key PEM) are appended independently
(`deploy.yml:1498-1514`), and the provider only activates when the template receives the full set.

**Two parameters are deliberately not optional, and both are fail-fast.** The step's first action is a
check on an unset `ALERT_EMAIL` repo variable (`deploy.yml:1412-1418`), whose error message states the
reasoning: alerts that notify nobody are silent failures, so `infra/main.bicep` *requires*
`alertEmailAddress` and the deploy refuses to proceed rather than shipping SLO, outbox and availability
alerts into the void. The second is the RSA key pair (`deploy.yml:1420-1426`): Identity signs RS256 and
publishes `/.well-known/jwks.json` from those keys, there is no other signing path, and `main.bicep`
declares both parameters without a default, so an unset `JWT_RSA_PRIVATE_KEY_PEM` or
`JWT_RSA_PUBLIC_KEY_PEM` fails here rather than producing an Identity service that cannot mint a token.
The keys are then appended unconditionally (`deploy.yml:1471-1476`). Catching both here turns an opaque
Bicep validation error into an actionable one naming the variable or secret to set.

The **synthetic-traffic key** (`deploy.yml:1544-1550`) is a small but instructive optional parameter. It
carries the shared secret the Gateway's edge rate limiter accepts as a bypass, and `load-test.yml` sends
the same value as an `X-Synthetic-Traffic-Key` header, so the monthly k6 capacity proof measures backend
capacity rather than the per-IP rate-limit window
([ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html) amendment). Unset
leaves the bypass off, which is the correct default: a rate-limit bypass that exists by default is not a
rate limiter.

The managed-identity SQL parameters (`deploy.yml:1567-1585`) are the opposite case, optional and
default-off by design: without the `SQL_AAD_ADMIN_LOGIN`, `SQL_AAD_ADMIN_OID` and
`USE_MANAGED_IDENTITY_SQL` repo variables, `main.bicep` keeps its defaults (no Entra admin, password
auth) and the deploy is unchanged. The comment stages the rollout and warns that flipping
`USE_MANAGED_IDENTITY_SQL=true` before the per-database grants exist costs the apps their SQL
connectivity (`deploy.yml:1579-1581`).

There is an important SQL location note in the Bicep parameters step (`deploy.yml:1430-1435`): Azure SQL
is region-gated on the QiMata Sponsorship subscription, `eastus2` (where `acc-rg` lives) does not
allow `Microsoft.Sql`, so SQL Server and databases are deployed to `westus2` while Container Apps remain
in the RG's location. The `SQL_LOCATION="${SQL_LOCATION_OVERRIDE:-westus2}"` line (`deploy.yml:1435`)
defaults to `westus2` but honors the `AZURE_SQL_LOCATION` repo variable (passed in as
`SQL_LOCATION_OVERRIDE` at `deploy.yml:1384`) so a different subscription or region can override it.

**Phase 3 (continued), Application infrastructure** (`deploy.yml:1597-1603`):

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

**Phase 4, Database migrations: there is no sqlcmd backstop** (`deploy.yml:1455-1468`):

Phase 4 is a comment block, not a step. The deploy **deliberately does not run an external `sqlcmd`
migration step**. Each service self-applies its own migrations at startup
(`ApplicationSettings__DatabaseInitStrategy=Migrate`) as the **sole migrator** of its database.
Every replica of a service migrates before it serves, and concurrent replicas are safe because EF Core
serializes `MigrateAsync` with an `sp_getapplock` migrations lock, so `minReplicas: 1` is a cost floor, not
a race guard (`deploy.yml:1463-1466`). The comment (`deploy.yml:1456-1463`)
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
(`deploy.yml:1617-1788`):

Phase 5 is **two gates in one step**, in a deliberate order, because they answer different questions
(`deploy.yml:1617-1638`).

**5a, the revision-activation gate** (`deploy.yml:1663-1710`) is the newer half, and it exists because of
a four-day production incident. For every app, the **newest** revision by `createdTime` must report
`healthState` `Healthy`, `runningState` `Running` or `RunningAtMaxScale`, and `trafficWeight` 100. The
predicate is factored into its own helper so the rollback below can reuse it (`deploy.yml:1677-1681`),
and the poll is thirty attempts at twenty seconds, ten minutes per app (`deploy.yml:1683-1704`):

```bash
# deploy.yml:1668-1674
revision_status() {
  local app="$1" json
  json=$(az containerapp revision list -g "$RG" -n "$app" \
    --query "reverse(sort_by(@, &properties.createdTime))[0].[name, properties.healthState, properties.runningState, properties.trafficWeight]" \
    -o json 2>/dev/null || echo "null")
  printf '%s' "$json" | jq -r 'if type == "array" then map(if . == null then "" else . end) | @tsv else "" end' 2>/dev/null || echo ""
}
```

That proves the code just built is the code now serving, and the HTTP probes below **cannot** prove it.
The comment names the incident that made the gap concrete (`deploy.yml:1620-1629`): every probe enters
through the Gateway, and a healthy Gateway keeps serving from the *previous* backend revision when the new
one never goes ready. So an untagged Aspire Redis health check running `CLUSTER INFO` against Azure
Managed Redis made `/health/ready` throw on every probe, every backend revision reported
`ActivationFailed`, the older revision kept 100% of the traffic, every probe answered 200 or 401 from the
old code, and this step reported success on each deploy for four days (2026-08-29 to 2026-09-02).

The `-o json` plus `jq` shape is itself a fix, and the comment states the trap plainly
(`deploy.yml:1663-1667`): a **top-level** JMESPath multiselect list rendered with `-o tsv` prints one
element **per line**, not one tab-separated row. The positional `read` therefore captured the revision
name and left health, running state and traffic weight empty, and the gate failed every app on a
perfectly healthy fleet. Fetching JSON and letting `jq` join it (with nulls mapped to empty strings so
the field count never collapses) is what makes the positional read honest. The transferable lesson is
the one the outage taught: a smoke test that reaches your system through a load balancer verifies
*something is serving*, not *your new code is serving*, and only the control plane can tell you which.

**5b, the reachability probes** (`deploy.yml:1716-1727`) are the older half, six endpoints covering every
deployable:
```bash
probe "https://${GATEWAY_FQDN}/health"
probe "https://${GATEWAY_FQDN}/.well-known/jwks.json"
probe "https://${GATEWAY_FQDN}/Events"
probe "https://${GATEWAY_FQDN}/Bookmarks" 401
probe "https://${GATEWAY_FQDN}/Notifications/inbox" 401
probe "https://${UI_FQDN}/"
```

Each probe polls up to 12 times (10-second intervals, 15-second curl timeout, `deploy.yml:1652-1661`),
two minutes total per endpoint. Together they exercise Container Apps routing (Gateway `/health`),
Identity (JWKS, which must have reached its database and loaded its RSA keys), Conference (anonymous
`GET /Events`), Engagement (`/Bookmarks`), Notification (`/Notifications/inbox`), and the Blazor UI host.
The comment (`deploy.yml:1631-1635`) notes the probe set mirrors `e2e.yml`'s warm-up URLs, which is what
makes it the post-rollout backstop behind the PR's `build-and-test` and, on a UI diff, `e2e-gate`.

**The two `401` expectations are the interesting part.** `probe` takes an expected status defaulting to
200, and for the auth-gated Engagement and Notification endpoints the asserted status is *exactly* 401
(`deploy.yml:1649-1651`, `:1722-1725`). A 401 from the service is the healthy signal: it proves the
request traversed Gateway to service to auth pipeline. A 5xx, a 404, or a `000` connection failure does
not. Accepting "any non-2xx" would have made those two probes unfalsifiable, which is the failure mode a
smoke test can least afford.

If **either** gate fails, the rollback path (`deploy.yml:1743-1788`) activates, and it now carries two
guards that the original loop did not.

**Guard 1 re-reads the app before rolling it back** (`deploy.yml:1749-1756`). The rollback loop runs
once for the whole fleet, but the smoke gate can fail for a reason that has nothing to do with a given
app, so each iteration re-checks that app's newest revision through the same `revision_serving`
predicate and skips it when it is already healthy, running and taking 100% of the traffic. Without that
check, one failed probe would take five healthy apps down with it.

**Guard 2 is in the query that picks the target revision** (`deploy.yml:1757-1768`):
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
five (`deploy.yml:1744-1746`), but a partial rollback is then reported loudly: the names of the apps that
failed to roll back are written to the Step Summary under "Smoke gate failed AND rollback incomplete"
(`deploy.yml:1779-1784`). The comment states the principle directly, a fleet split across revisions needs
immediate manual attention and must never look like a clean auto-revert. Either way the job exits 1
(`deploy.yml:1788`).

There is also an informational security-headers check (`deploy.yml:1729-1736`, labeled TD-09) that
confirms the Gateway emits `X-Content-Type-Options: nosniff`. This check is explicitly non-gating (it
cannot trip the rollback) because a missing header is a hardening gap, not a "revision not serving"
condition.

[Rubric §29, Resilience, Reliability & Business Continuity] is directly embodied: the activation and smoke
gates with automatic rollback mean a broken deploy is both detected and partially self-corrected within
minutes. [Rubric §13, Observability & Operability] (assesses whether failures surface actionable signals)
is served: the activation loop prints each app's newest revision with its health, running state and
traffic weight on every attempt (`deploy.yml:1698`), the workflow fails loudly with the specific failing
endpoint printed, and the rollback log names each app and its rollback revision.

**Post-deploy, reclaiming BuildKit cache storage** (`deploy.yml:1790-1808`):

The last step in the job is housekeeping, not a gate:

```bash
az acr run \
  --registry ${{ needs.foundation.outputs.acrName }} \
  --cmd "acr purge --filter 'buildcache:.*' --ago 1h --keep 10 --untagged" \
  /dev/null
```

It runs the same `buildcache` purge the scheduled ACR task in `foundation.bicep` runs daily, but right
after the deploy that created the garbage. The comment gives the reason (`deploy.yml:1790-1795`): every
`cache-to=...,mode=max` push orphans the previous deploy's untagged cache manifests, and reclaiming them
within minutes rather than within a day is what keeps a Basic-tier registry under its 10 GB included
storage instead of paying overage on a day's worth of them.

Two details are deliberate. It is `continue-on-error: true` (`deploy.yml:1802`) because it runs *after*
the rollout and the smoke gate, so a throttled ACR task or a transient auth failure must never fail a
deploy that has already shipped successfully. And the `/dev/null` argument is the build context, which
`az acr run` requires positionally and this command does not use (`deploy.yml:1799-1800`).

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
(`e2e.yml:138-141`):

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
`:128-137`). The schedule was cut from Mon-Fri to twice weekly on 2026-07-24: at five nights times about
25 minutes per leg it was the single largest billed line item in the repo, and twice a week still catches
an engine-specific regression well inside a release cycle. Alternating engines followed on 2026-07-29,
halving the nightly spend from roughly 100 to 50 minutes a week while still exercising each engine every
week. And chromium is off the nightly entirely, because every push to `main` already runs a full chromium
leg through `e2e-gate`, so a scheduled chromium leg would re-test an already-tested tree. What the nightly
uniquely buys is the *other two* engines.

`continue-on-error` encodes the same split (`e2e.yml:147`):

```yaml
continue-on-error: ${{ github.event_name == 'schedule' && matrix.browser != 'chromium' }}
```

Note the `event_name` clause. On the **scheduled** nightly, non-chromium legs stay advisory so a one-off
engine flake alerts without blocking anything. In the **deploy gate** (where `event_name` is the caller's
push or dispatch) every invoked engine can fail the gate, promoted 2026-07-16 after eight consecutive
fully-green nightly matrices (`e2e.yml:142-146`). The same matrix leg is advisory or blocking depending on
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

A five-minute pre-job (`e2e.yml:86-112`) that compares the default branch's head SHA against the head SHA
of the last **successful** run of this workflow. If they match, there is nothing new to soak and the
matrix is skipped. Any non-schedule event returns `run=true` immediately (`e2e.yml:100-102`), so a manual
dispatch and the deploy gate always run.

This guard is the reason `deploy.yml`'s `cross-service-freshness` cannot trust a run **conclusion**: the
sibling `cross-service-tests.yml` carries the same guard, and a skipped matrix still concludes `success`.
It is also why this workflow needs `actions: read` (`e2e.yml:55-57`), and by extension why `deploy.yml`
has to grant it too.

### Job: `e2e` (120-minute timeout, cross-browser matrix)

The 120-minute timeout (`e2e.yml:123`) is a spend guard, not a pace budget, and the comment explains the
raise from the previous 50 (`e2e.yml:119-122`): full-time tracing slows the suite, and a retry-heavy night
burns one to two minutes per failed try, so a 2026-07-02 nightly hit a 70-minute cap mid-retry with 21
first-pass failures. A cap that cancels a run destroys the pass/fail count you needed; 120 lets even a bad
night finish and report real numbers. The matrix is `fail-fast: false` (`e2e.yml:126`) so one engine's
flake does not cancel the others.

**Step 1, Trust the dev HTTPS certificate** (`e2e.yml:160-161`):
```bash
dotnet dev-certs https --trust || dotnet dev-certs https
```
The `--trust` flag only succeeds on a runner that supports certificate trust stores (Linux runners may
not). The `|| dotnet dev-certs https` fallback generates the certificate without trusting it. Playwright
probes use `-k` (skip verification) for the HTTPS UI endpoint, so the certificate does not need to be
trusted for the test suite, the certificate only needs to exist so the Aspire AppHost can bind to HTTPS.

**Step 2, Build** (`e2e.yml:163-171`):
```bash
dotnet build Source/Hosting/MMCA.ADC.AppHost -c Release
dotnet build Tests/E2E/MMCA.ADC.E2E.Tests -c Release
```
Both project graphs are built directly (not via the `.slnx`) to avoid pulling in the MAUI UI project,
which requires a `maui-android` workload not available on standard Ubuntu runners (`e2e.yml:164-166`
comment). `GITHUB_TOKEN` is passed for NuGet restore of MMCA.Common packages. The setup step above caches
`~/.nuget/packages` on the committed lock files (`e2e.yml:155-158`), which is worth the key precisely
because this leg sits on the deploy critical path.

**Step 3, Cache and install Playwright browsers** (`e2e.yml:177-193`):
The same cache-then-branch pattern as `MMCA.Common/ci.yml`'s `ui-e2e` job, with the matrix browser engine.
Binaries run 100 to 300 MB per engine, so `PLAYWRIGHT_BROWSERS_PATH` redirects the install into the
workspace where `actions/cache` can carry it (`e2e.yml:77-80`), and the key includes the engine because
each leg installs only its own. On a cache hit the step runs `install-deps` rather than `install
--with-deps` (`e2e.yml:187-193`): the OS-level shared libraries live outside the cached directory, so a
restored cache still needs the cheap half.

**Step 4, Start the Aspire stack** (`e2e.yml:195-225`):
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

The AppHost runs in the background (`nohup ... &`), and its stdout/stderr stream goes to
`artifacts/apphost.log` (`e2e.yml:228`). There is no separate stop step: the stack ends with the job's
runner. Diagnostics are failure-only: on a red run the workflow collects the service logs and uploads
the AppHost log, the service logs and the probe output as one artifact (`e2e.yml:339-362`), so a green
run pays nothing for them.

Two further env exports in the same step shape how the suite runs.
`E2E_LIFT_REGISTRATION_THROTTLE=true` (`e2e.yml:214`) lifts Identity's BR-213 registration throttle, which
would otherwise 401 the suite's many register-from-one-IP accounts past the default of 10 per hour.
`E2E_FORCE_SERVER=true` (`e2e.yml:221`) pins the UI to InteractiveServer for the suite while production
stays InteractiveAuto: under InteractiveAuto each test's second page load switches to the
background-downloaded WASM bundle, whose runtime boot on a 2-core runner exceeds every suite wait. The
comment (`e2e.yml:207-213`) is emphatic that the opposite fix, forcing WASM outright, was tried and is
unviable in CI, because the Blazor readiness signal passes during prerender and the tests then interact
with a dead DOM: no click lands, no error appears, and the suite stalls to the job cap with zero passes.
It is a good reminder that a readiness signal which fires before the page is interactive is worse than no
signal.

[Rubric §11, Security] is served: the ephemeral keypair is generated fresh per run (no long-lived key
material in secrets), and the private key file is deleted before any subsequent step runs.

**Step 5, Wait for the stack (per-service readiness gate)** (`e2e.yml:227-250`):
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

**Step 6, Warm up services incl. the login path** (`e2e.yml:252-294`): a best-effort step (never fails
the job) that JITs each service's hot path before the timed suite, two passes over nine Gateway endpoints
covering all four services (`e2e.yml:263-272`, where Engagement's `/Bookmarks` and Notification's
`/Notifications/inbox` answer 401 and still warm their request pipeline), plus a **real admin login POST**
to `/Auth/login` that exercises Identity's DB user-lookup + password-hash verify + RS256 signing (the
dominant cold-start login-timeout culprit a UI-only warm-up never touched), and a prerender warm-up of the
UI host's `/`, `/login`, `/register`. It closes by capturing a verbose Gateway-to-Conference probe into
`artifacts/conference-probe.txt` for cross-referencing against the service logs (`e2e.yml:287-293`).

**Step 7, Run E2E tests** (`e2e.yml:296-332`):
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
60000` gives the auth round-trip its own headroom (`e2e.yml:309-318`). `--retry-failed-tests 2
--retry-failed-tests-max-percentage 40` (MTP's retry extension) re-runs only the failed tests up to twice,
but skips retry when more than 40% of tests fail (a real breakage, not a contention spike). No coverage is
collected here because the app runs out-of-process (the in-process integration tier in `deploy.yml` is the
backend coverage signal, `e2e.yml:297-300`).

Two of those env vars are outputs rather than settings. `WEB_VITALS_OUTPUT_DIR` (`e2e.yml:305-307`) is
where `WebVitalsTests` writes its client-side measurements, so the [Rubric §12, Performance &
Scalability] budgets are enforced inside the deploy-gating chromium leg rather than only by the monthly
k6 run. `E2E_TRACE` with its **trailing slash** selects directory mode, one `<TestName>.zip` per *failed*
test (`e2e.yml:319-324`), which is what makes a red run diagnosable offline instead of by re-running it.

**Steps 8 to 10, Collect logs, stop stack, upload diagnostics** (`e2e.yml:334-365`): on `always()` the job
collects the Serilog rolling files of the four services **and** of the UI host into `artifacts/service-logs`
(`e2e.yml:334-349`) and kills the AppHost (`e2e.yml:351-353`). One glob, `MMCAADC*.txt`, matches both
`MMCAADC<Module>Service<date>.txt` and `MMCAADCUIWeb<date>.txt` (`e2e.yml:336-337`, `e2e.yml:345`). The UI
host log matters because the UI host runs the Blazor Server circuit the suite drives, so a circuit drop or a
prerender failure shows up there and in no service log. The step searches the working tree, `$HOME` and
`/tmp` and flattens every hit into one folder (`e2e.yml:344-348`), because the directory each file lands in
depends on the working directory Aspire launches the process from, and the AppHost orchestrator log only
carries orchestration chatter, never the processes' own logs (`e2e.yml:338-341`). The upload, however, is
**failure-only** (`if: failure()`, `e2e.yml:359`) with a 3-day retention (`e2e.yml:365`): the bundle runs about 350 MB per browser, and a green run produces no per-test
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
header comment (`cost-guard.yml:3-10`) states its purpose precisely: "a scheduled, READ-ONLY check that
the production footprint is still at its cost baseline... It complements the cost budget in main.bicep
(which alerts on $ spend) by flagging the *configuration* drift directly."

### Why this workflow exists

The conference-day surge is declared in IaC: `conferenceMode` in `main.bicep` moves the attendee
hot-path databases from Basic to S2 and raises the scaled Container Apps' replica cap from 2 to 4
(`MMCA.ADC/infra/main.bicep:181`, `:192`). One repository variable, `CONFERENCE_MODE_UNTIL`,
switches it: every deploy on or before that date applies the surge and the first deploy after it
reverts it (`MMCA.ADC/infra/OPERATIONS.md:320-325`). The cost-guard reads the same variable
(`MMCA.ADC/.github/workflows/cost-guard.yml:60-63`): inside the window a surged footprint is
expected; after it, a surge still live fails the Monday run as the reminder but passes as the deploy
gate, because that deploy IS the revert; with the variable unset, any surge is an out-of-band scale-up
and blocks every production deploy until it is reset (`MMCA.ADC/infra/OPERATIONS.md:377`).

The cost-guard exists because a forgotten surge is not cheap: each surged database runs at S2
(50 DTU) instead of Basic (5 DTU) (`MMCA.ADC/infra/main.bicep:181`), around the clock until reverted.

### Triggers

```yaml
# cost-guard.yml:12-19
on:
  schedule:
    - cron: "0 7 * * 1" # Mondays 07:00 UTC
  workflow_dispatch:
  workflow_call:
```

Weekly on Monday mornings (UTC), early in the work week so a drift is noticed promptly, with time to
investigate before the next week. `workflow_dispatch` allows a manual run at any time (e.g. to verify
that a revert applied correctly). The bare `workflow_call` (`cost-guard.yml:16-19`) is what promotes the
check to a deploy gate: it takes no inputs, so the deploy pays only the invocation, and the comment notes
that being read-only is what makes it safe to run on the deploy path.

### Job: `surge-drift`

**Environment: `production`** (`cost-guard.yml:34`): this scopes the OIDC token to the same federated
credential as `deploy.yml`, giving the read-only Azure CLI calls access to the production resource group
without a separate credential. As with `deploy.yml`'s own jobs, the declaration is required for the token
subject to match, not merely for an approval gate.

**Step, Check replica caps and SQL tiers** (`cost-guard.yml:43-88`):

```bash
BASELINE_MAX_REPLICAS: "2"   # cost-guard.yml:27

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
(`cost-guard.yml:84-87`), but it does not attempt to downscale automatically. The operator must choose how
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
(`deploy.yml:1544-1550`), so the bypass exists in production only when it has been configured
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

**Step, Resolve target URL** (`load-test.yml:48-63`):
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
URL (`load-test.yml:59`). An explicit `base_url` input allows targeting a non-production environment
(e.g. a staging slot) without modifying the workflow.

**Step, Run k6** (`load-test.yml:65-85`):
```bash
docker run --rm -i \
  -e BASE_URL="$BASE_URL" \
  -e PEAK_VUS="$PEAK_VUS" \
  -e SYNTHETIC_TRAFFIC_KEY="$SYNTHETIC_TRAFFIC_KEY" \
  -v "$PWD/Tests/Load/k6:/scripts" \
  grafana/k6@sha256:23f2279054c3e01535455c4d92914a625df12aeb631ea0e3ea7a43f96bcbc843 run /scripts/conference-read-load.js

```
k6 runs in Docker, and the image is **pinned by digest** rather than by name (`load-test.yml:85`): an
unpinned `grafana/k6` resolved `:latest` at run time, and this step is handed the synthetic-traffic key
that skips both Gateway rate limiters, so the version comment above the command and the digest are bumped
together (`load-test.yml:66-72`). The script directory is mounted as a volume. `BASE_URL`, `PEAK_VUS` and
`SYNTHETIC_TRAFFIC_KEY` reach the container as environment variables, each first declared in the step's
own `env:` block and referenced as `"$VAR"` (`load-test.yml:73-76`), so a secret containing a quote cannot
break the command apart and no secret is part of the command line the runner logs. The last of the three
is what the script sends as the `X-Synthetic-Traffic-Key` header described above.
 The k6 script is at
`Tests/Load/k6/conference-read-load.js`. Note: the content of the k6 script (thresholds, ramping
profile, endpoint list) is not determinable from the workflow file alone, it lives in the script.

The `|| '40'` fallback in `PEAK_VUS` (`load-test.yml:75`) is a safety net: if the scheduled run (which
has no `inputs.peak_vus` value because inputs are only set on `workflow_dispatch`) reaches this
expression, it defaults to 40 VUs rather than empty, which k6 would interpret as 0.

[Rubric §12, Performance & Scalability] is served: the load test documents the observed conference-day
peak as the benchmark VU count and verifies the system can sustain it within the defined thresholds.
[Rubric §29, Resilience, Reliability & Business Continuity] is also touched: a load test that catches
a threshold regression before the next conference is a proactive resilience measure.

---

## Repository automation: the MAUI audit

**File:** `MMCA.ADC/.github/workflows/maui-audit.yml`

This workflow never builds, tests or deploys anything. It exists to cover a supply-chain gap that the
pipelines above structurally cannot reach.

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
on the restore (`maui-audit.yml:93-96`) and `--framework` on the audit read of the resulting assets file
(`maui-audit.yml:128-129`). The comment argues the coverage is close to full, since the managed
MMCA/Maui/BlazorWebView package set is shared across every head and only the small platform-binding tail is
Apple-only, and that a `macos-latest` runner would close that tail at ten times the per-minute cost for a
weekly advisory sweep.

Three details in the restore step repay reading (`maui-audit.yml:71-110`):

- **Try the plain restore first.** Hosted images ship a moving set of preinstalled workloads, so on many
  runs `maui-android` is already there and `dotnet workload install` is pure waste. The step attempts the
  restore, and only pays for the install if it fails.
- **Only for a missing-workload failure.** If the restore log carries no `NETSDK1147`, `NETSDK1139` or
  `workload` diagnostic, the step errors out rather than installing a workload
  (`maui-audit.yml:104-107`). Installing something on an unrelated failure would mask the real error, which
  is the same fail-closed instinct as the expand/contract guard's missing `|| true`.
- **The lock file is redirected for this restore, never disabled** (`maui-audit.yml:78-91`,
  `:95-96`). `Directory.Build.props` turns lock files on repo-wide, and a single-TFM restore would
  otherwise rewrite the MAUI project's `packages.lock.json` (and those of every project it references)
  into an android-only shape. Harmless on a throwaway runner, but this job doubles as the local
  reproduction recipe, and committing that truncated lock would be a genuine regression. Passing
  `RestorePackagesWithLockFile=false` is not an option: NuGet raises NU1005, a hard error, whenever that
  property is false and a `packages.lock.json` already exists, which is every project in this graph, so
  that flag failed every run of this workflow. The restore instead points `NuGetLockFilePath` into the
  gitignored `obj/` folder and sets `RestoreLockedMode=false`, the same mechanism `Directory.Build.props`
  uses for local source mode: the committed locks are neither read nor written.


The audit step itself is the same contract as `deploy.yml`'s: fail on any vulnerable-package row except
an advisory accepted via `NuGetAuditSuppress` in `Directory.Build.props`, re-applying that list by hand
because `dotnet list --vulnerable` ignores it (`maui-audit.yml:112-169`). It carries the same two
fail-closed properties as that copy (`maui-audit.yml:124-145`): it keeps the tool's exit code instead of
swallowing it, and it demands a recognized result header before trusting the report, so a feed timeout or
an MSBuild evaluation error cannot pass the gate with an empty match set; and its accept-list is scraped
only from real `<NuGetAuditSuppress ... Include="GHSA-..."` elements.
 `--no-restore` is required
rather than an optimization (`maui-audit.yml:119-120`): without it `dotnet list` re-runs an unscoped
restore and drags the Apple TFMs back in, which cannot resolve on Linux. Both outcomes write a Step
Summary block (`maui-audit.yml:150-168`), the clean one repeating the macOS scope note so a green result
is never mistaken for full coverage. The audit is the whole job: it uploads no report artifact, and its
result lives in the Step Summary and the job status.

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

(`dr-drill.yml` is the [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) §29 restore drill: it PITR-restores a *copy* of a chosen database, times the
restore for the RTO record, verifies it comes back Online, then deletes the copy, the live databases are
never touched (`dr-drill.yml:3-5`, Monday 06:00 UTC cron at `dr-drill.yml:31-33`). A scheduled run picks
its target by **rotating** across the four live per-service databases by ISO week number, so each one
gets a recovery proof roughly monthly (`dr-drill.yml:7-10`, selection at `dr-drill.yml:70-76`); a
dispatch names the database explicitly through a `choice` input (`dr-drill.yml:18-26`). One drill a week
that always restored the same database would prove the *procedure*, not the fleet. The `drill` job runs
under a 60-minute cap (`dr-drill.yml:49`), and the comment above it (`dr-drill.yml:42-48`) says why it is
not 30: the 2026-09-14 scheduled drill was killed at the old 30-minute limit and recorded no proof. A
measured PITR restore of an `ADC_*` database takes minutes, but Azure SQL queues the restore on the
platform and its duration varies run to run, so 60 leaves headroom for a slow one (MMCA.Store raised the
same job to 60 after the same failure). The cap is load-bearing beyond the drill itself: `dr-freshness`
consumes this workflow's last success, so a drill that times out does not merely lose one run, it moves
the deploy toward a hard block.
`cross-service-tests.yml`
(`cross-service-tests.yml:6-10`) is the Testcontainers tier that boots the three REST hosts in one process
against a real SQL Server **and** a real RabbitMQ, exercising the genuine outbox to broker to consumer
round-trip and the real Conference to Engagement gRPC read. It must never enter `deploy.needs`, and the
reason is mechanical rather than stylistic: Testcontainers needs a Docker daemon that the gating
`integration-tests` job does not have (`cross-service-tests.yml:12-22`). Its second job,
`servicebus-emulator-smoke`, has been **authoritative since 2026-08-31** and is one of the two jobs the
freshness gate requires (`cross-service-tests.yml:116-126`). The workflow has three jobs, the
`should-run` guard, `cross-service` and `servicebus-emulator-smoke` (`cross-service-tests.yml:51`, `:79`,
`:142`), and no AppHost job: the full Aspire composition is booted by `e2e.yml`, which starts the
consumer AppHost for every Playwright run (`e2e.yml:228`), and the framework's own AppHost tier is the
blocking `apphost-testing` job in MMCA.Common's `ci.yml`, covered above. Neither workflow is given its
own section above, but both are part of the workflow set.)

The drill also cleans up when it does not finish. The script deletes its restored copy in a `finally` block,
but a job cancelled at `timeout-minutes` never reaches it, and the weekly rotation means the next run targets
a different database, so its stale-name check would not remove the leftover either; the comment
(`dr-drill.yml:96-100`) records the 2026-09-14 scheduled run that left `ADC_Engagement-drill` at Basic-tier
cost for five days. The **Remove leftover drill copies** step (`dr-drill.yml:101-112`) runs under
`if: always()`, so on cancel and on failure too, finds the `adc-prod-sql-*` server (warning and exiting
cleanly when there is none) and deletes every database on it whose name ends in `-drill`, not just this run's.
[Rubric section 31, Cost/FinOps] assesses whether spend is bounded by design rather than by vigilance; this
step makes an interrupted drill self-correcting instead of a silent standing charge.

`deploy.yml` on push or dispatch holds the `prod-azure` concurrency group with `cancel-in-progress:
false`, so a deploy is never interrupted mid-migration, and its comment records the standing rule that
any other workflow mutating production Azure state joins the same group (`deploy.yml:38-47`).
`dr-drill.yml` does, in both apps: it creates and deletes a database on the production server, so it
takes the same never-cancelled group (`dr-drill.yml:38-44`,
`MMCA.Store/.github/workflows/dr-drill.yml:39-45`). `deploy.yml`'s pull-request runs use a separate
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
([ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html)). And one gates nothing at
all by design: `maui-audit.yml` notifies rather than blocks, because a weekly
advisory sweep is useful precisely when it is not on the critical path. A
scheduled workflow only governs anything once something in the delivery path depends either on it having
run, or on it having run recently.

---

## Rubric category index for this chapter

| Category | Where primarily embodied |
|---|---|
| §8 Data Architecture | `deploy.yml` build-time EF model-drift gate (migrations applied by services at startup, not by `deploy.yml`); the expand/contract migration guard in `build-and-test` ([ADR-057](https://ivanball.github.io/docs/adr/057-expand-contract-schema-evolution-gate.html)); the real `dotnet ef database update` plus schema assertions in `ci.yml`'s Helpdesk canary |
| §11 Security | OIDC in `deploy.yml`/`load-test.yml`/`cost-guard.yml`, each job scoped by `environment: production` to match the federated credential subject; the GitHub token as a BuildKit secret (never a layer) in `build-images`; ephemeral RSA key in `e2e.yml`; least-privilege tokens in `release.yml`; read-only permissions plus SHA-pinned actions in both repositories' Claude workflows |
| §12 Performance & Scalability | `load-test.yml` k6 baseline at observed peak VUs with the synthetic-traffic bypass so it measures backend capacity rather than the rate limiter, kept current by the `load-freshness` deploy gate (35 days); client-side Web Vitals budgets measured by `WebVitalsTests` inside the deploy-gating chromium `e2e-gate` |
| §13 Observability & Operability | Revision-activation polling output, six-endpoint smoke-gate output and rollback log (including the partial-rollback step summary) in `deploy.yml`; AppHost log and per-failed-test traces in `e2e.yml` |
| §14 Testability & Test Strategy | `--minimum-expected-tests` floors in all test steps (2000 for MMCA.Common's suite, 40 for the Helpdesk canary, 1 for ADC's); the 68.3% unit coverage floor in `ci.yml` `coverage`, ADC's 55.5% line floor and 77.5% Application-layer branch floor in `deploy.yml` `build-and-test`; the PR's required `build-and-test` as the test gate for every deploy, since branch protection enforces admins and strict up-to-date checks so the PR run covers the exact merged tree; the golden replay and prompt-contract tiers in that PR pass, plus the paid live judge of `ai-eval-gate` on a scoring-code deploy, for the AI session scorer, whose behavior can move with no code change; architecture fitness functions in `build-and-test` |
| §17 DevOps & Deployment | The full workflow set collectively; SHA-tagged images with per-image dirty gating and registry-side re-tagging; the `foundation`/`build-images`/`deploy` phase split that hides image builds under the e2e gate; revision-activation gate plus smoke and rollback; the four proof-of-recency gates in `deploy.needs` and their justification-required break-glass ([ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html)) |
| §21 Accessibility | `ci.yml` `ui-e2e` axe-core WCAG 2.1 AA gate on every MMCA.Common pull request, across all three browser engines |
| §28 Front-End Testing & Quality | `ci.yml` `ui-e2e` render smoke; `e2e.yml` full Playwright suite, deploy-gating on chromium via `deploy.yml`'s `e2e-gate`, with the firefox/webkit legs of the alternating weekly matrix made mandatory by the `cross-browser-freshness` recency gate |
| §29 Resilience & Business Continuity | `prod-azure` concurrency group; the revision-activation gate that proves the new code is actually serving, plus the two-guard rollback in `deploy.yml` (never undo a healthy activation, never copy back a deactivated revision), kept viable by the expand/contract migration guard (revision rollback does not revert schema); `dr-drill.yml` PITR restore drill ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) objectives) rotating across the four live databases and enforced fresh within 8 days by `dr-freshness` |
| §30 Compliance & Privacy | SBOM generation in `release.yml` (both the ubuntu and windows pack jobs) and, as a component-count-asserting gate, in `deploy.yml`'s `supply-chain` on the pull request |
| §31 Cost / FinOps | `cost-guard.yml` surge-drift detection: Monday notifications plus a blocking `deploy.yml` gate; the docs-only, `ui`-scoped and per-image short-circuits in the `changes` job; ACR-hosted layer cache in `build-images`, paired with the daily `purge-old-images` ACR task in `foundation.bicep` and the post-deploy `buildcache` purge that reclaims the manifests each deploy orphans; `maui-audit.yml` as a weekly sweep rather than a per-PR workload install |
| §32 Dependency & Supply-Chain | Lock files + source mapping in MMCA.Common; `--locked-mode` restores against ADC's committed lock files; suppress-aware vulnerability audit in `ci.yml`, as a deploy gate in ADC's `supply-chain`, and weekly over the MAUI graph in `maui-audit.yml`; SBOM artifacts; SHA-pinned actions and env-passed shell inputs across both repositories |
| §33 Developer Experience | Playwright trace upload on failure in `ci.yml` and `e2e.yml`; AppHost + service logs in `e2e.yml`; step summaries in `cost-guard.yml`, `maui-audit.yml` and the freshness gates; the same-name-branch canary convention that lets a breaking framework change land with its consumer adaptation |
| §34 Architecture Governance | `cost-guard.yml` as executable governance for the surge-revert policy; concurrency group as deployment-ordering governance |
