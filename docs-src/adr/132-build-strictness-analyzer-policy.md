# ADR-132: Build Strictness: Analyzers at Error Severity, a Shared Baseline, and CI Test Floors

## Status
Accepted (2026-10-07). The policy predates this record: all four .NET repos have built this way for
some time, and this is the first written decision for it rather than the start of the practice.
Revised 2026-10-21: the four repos now pin identical analyzer versions (the pins stay per repo),
Common's source-only PublicApiAnalyzers group is recorded, and the props, workflow and coverage-gate
anchors are re-pointed.

## Context
Four repos (`MMCA.Common`, `MMCA.ADC`, `MMCA.Store`, `MMCA.Helpdesk`) share one framework, one set of
conventions, and a large share of their code is written or edited by agents. A convention that lives
only in prose is applied unevenly; a convention the compiler enforces is applied on every build. Two
gaps follow from that. First, a warning that does not fail the build is a warning nobody reads, and
four repos with four slightly different rule sets mean that code which is clean in one repo fails in
another when it moves. Second, a green CI run proves only that the tests which ran passed: a broken
filter, a discovery failure, or a deleted test project can turn a suite into zero tests and still
report success, and coverage can erode one untested change at a time with no single PR looking
responsible.

Several existing records already lean on this posture without stating it:
[ADR-015](015-architecture-fitness-functions.md) (fitness tests as executable conventions),
[ADR-049](049-library-configureawait-policy.md) (CA2007 is only meaningful because it errors),
[ADR-109](109-feature-by-folder-convention.md) (IDE0130 under TreatWarningsAsErrors), and the other CI
gates ([ADR-060](060-performance-regression-gate.md), [ADR-063](063-accessibility-conformance-gate.md),
[ADR-092](092-web-vitals-budget-gate.md)). This record states the policy they assume.

## Decision
1. **Warnings are errors, for the compiler and for code analysis alike.** Every repo's root
   `Directory.Build.props` sets `TreatWarningsAsErrors` and `CodeAnalysisTreatWarningsAsErrors` to
   `true` (`MMCA.Common/Directory.Build.props:7`, `:13`; `MMCA.ADC/Directory.Build.props:10`, `:13`;
   `MMCA.Store/Directory.Build.props:10`, `:13`; `MMCA.Helpdesk/Directory.Build.props:13`, `:16`).
   All four also pin `AnalysisLevel` to `latest`, set `AnalysisMode` to `All` and turn on
   `EnforceCodeStyleInBuild` (`MMCA.Common/Directory.Build.props:11`, `:12`, `:14`;
   `MMCA.ADC/Directory.Build.props:11`, `:12`, `:14`; `MMCA.Store/Directory.Build.props:11`, `:12`,
   `:14`; `MMCA.Helpdesk/Directory.Build.props:14`, `:15`, `:17`), so IDE-only style rules run in the
   command-line build too.
2. **Five third-party analyzer packages run on every project in the strict build.** Meziantou,
   Microsoft.VisualStudio.Threading, Roslynator, SonarAnalyzer and StyleCop are referenced from the
   root props of each repo (`MMCA.Common/Directory.Build.props:131-150`,
   `MMCA.ADC/Directory.Build.props:117-136`, `MMCA.Store/Directory.Build.props:117-136`,
   `MMCA.Helpdesk/Directory.Build.props:48-67`). Two kinds of project are outside it. Docker Compose
   `.dcproj` projects are excluded by the condition on that item group
   (`MMCA.Common/Directory.Build.props:130`, `MMCA.ADC/Directory.Build.props:116`,
   `MMCA.Store/Directory.Build.props:116`, `MMCA.Helpdesk/Directory.Build.props:47`), because they
   have no compiler to run an analyzer in. Common adds a sixth analyzer,
   Microsoft.CodeAnalysis.PublicApiAnalyzers (the RS0016/RS0017 public API baseline), only on its
   `Source` projects, never on a `.dcproj` and never on `MMCA.Common.UI.Maui` (`MMCA.Common/Directory.Build.props:111-118`). Common's two build tools, the FACTS generator and the perf
   gate, are isolated from the strict build through `MMCA.Common/build/Directory.Build.props`
   (`MMCA.Common/build/facts/facts.csproj:5`) and turn off `TreatWarningsAsErrors`,
   `EnforceCodeStyleInBuild` and `RunAnalyzers` (`MMCA.Common/build/facts/facts.csproj:14-16`,
   `MMCA.Common/build/perfgate/perfgate.csproj:14-16`). The packages are pinned
   through Central Package Management (`MMCA.Common/Directory.Packages.props:230`, `:236-239`, PublicApiAnalyzers at `:235`;
   `MMCA.ADC/Directory.Packages.props:42-46`; `MMCA.Store/Directory.Packages.props:61-64`, `:73`;
   `MMCA.Helpdesk/Directory.Packages.props:35-39`). The pins are per repo and are not required to
   match; today all four carry the same versions (Meziantou `3.0.315`, Threading `18.12.1`,
   Roslynator `5.0.1`, SonarAnalyzer `10.35.0.4138`, StyleCop `1.2.0-beta.556`).
3. **Every analyzer diagnostic defaults to error severity.** The shared `.editorconfig` block sets
   `dotnet_analyzer_diagnostic.severity = error` (`MMCA.Common/.editorconfig:312`, the same line in
   `MMCA.ADC/.editorconfig:312`, `MMCA.Store/.editorconfig:312` and `MMCA.Helpdesk/.editorconfig:312`);
   individual rules are then relaxed or disabled by name, with the reason beside them, rather than
   the default being lowered.
4. **One analyzer baseline, shared above a marker.** Each repo's root `.editorconfig` states the
   contract at its head (`MMCA.Common/.editorconfig:5`) and carries the `# REPO-SPECIFIC DELTAS`
   marker at `:821` in all four files (`MMCA.ADC/.editorconfig:821`, `MMCA.Store/.editorconfig:821`,
   `MMCA.Helpdesk/.editorconfig:821`). Everything above the marker is meant to be identical across
   the four repos; per-repo overrides go below it.
5. **The shared block is checked by a script, and an edit to it triggers a reminder.**
   `Tools/Scripts/compare-analyzer-config.ps1` (workspace root) reads all four files as lines
   (`:25`), finds the marker (`:19`, `:26`), keeps the lines above it (`:28`), compares each slice
   against Common's with `Compare-Object` (`:34`), and exits `1` when a line appears on one side only
   (`:47`); it reported no such line on 2026-10-07. The check is line-set equality, not byte equality:
   reading by line drops line endings, and a default `Compare-Object` is case-insensitive and does not
   compare line order, so a CRLF/LF difference, a case-only change or a reordered block passes. The
   post-edit hook does not run
   the script itself: on an edit to any of the four `.editorconfig` files it emits a FOLLOW-UP
   REQUIRED message naming the script and the obligation to mirror an above-marker change
   (`.claude/hooks/post-edit-followups.sh:23-26`).
6. **CI asserts a minimum test count, so an empty run fails.** The solution-wide unit runs carry
   `--minimum-expected-tests`: Common `2000` (`MMCA.Common/.github/workflows/ci.yml:163`, and again
   in `release.yml:89`), ADC `5000` (`MMCA.ADC/.github/workflows/deploy.yml:366`), Store `2650`
   (`MMCA.Store/.github/workflows/deploy.yml:338`), Helpdesk `1`
   (`MMCA.Helpdesk/.github/workflows/ci.yml:104`). The integration tiers carry their own (ADC `450` at
   `MMCA.ADC/.github/workflows/deploy.yml:730`, Store `250` at
   `MMCA.Store/.github/workflows/deploy.yml:677`), as do Common's gallery E2E (`ci.yml:292`), Redis
   (`:767`), per-engine PostgreSQL and SQL Server (`:804`, `:844`) and AppHost (`:891`) jobs,
   Common's Helpdesk canary (`ci.yml:527`, `40`)
   and both consumers' cross-service jobs
   (`MMCA.ADC/.github/workflows/cross-service-tests.yml:110`, `:169`;
   `MMCA.Store/.github/workflows/cross-service-tests.yml:114`, `:167`). Adoption is not universal: the
   ADC and Store browser E2E runs carry no floor (`MMCA.ADC/.github/workflows/e2e.yml:335-337`,
   `MMCA.Store/.github/workflows/e2e.yml:394-397`), and ADC's live AI judge omits it on purpose,
   because without its API key every case skips (`MMCA.ADC/.github/workflows/deploy.yml:557-560`),
   while the gating golden-replay and prompt-contract step in the same job keeps a floor of `1`
   (`MMCA.ADC/.github/workflows/deploy.yml:555`, rationale at `:549-550`).
7. **CI enforces a line-coverage floor on the unit tier, not the merged report.** Common gates the
   unit, architecture and bUnit tier with generated code excluded at `68.3` percent
   (`MMCA.Common/.github/workflows/ci.yml:395-396`, comparison at `:409`), and says why the merged
   report is not used: the gallery E2E tier dilutes it (`:395`). ADC gates its own code (filtered to
   `MMCA.ADC.*` minus the test, `*.Service` host and `*.Contracts` assemblies,
   `MMCA.ADC/.github/workflows/deploy.yml:404`) at `55.5` percent line coverage (`:406`, comparison at
   `:408`) and adds an Application-layer branch floor of `77.5` percent (filter `:433`, floor `:442`,
   comparison `:444`), which also fails when the report covers fewer than four Application
   assemblies (`:436`). Store does
   the same over `MMCA.Store.*` minus tests and `*.Contracts` (`MMCA.Store/.github/workflows/deploy.yml:372`)
   at `51.6` percent line (`:374`, `:376`) and `72.8` percent Application-layer branch (`:407`, `:409`),
   which also fails when the report covers fewer than three Application assemblies (`:401`). Both
   consumers' line and branch floors fail closed when the coverage file is missing
   (`MMCA.ADC/.github/workflows/deploy.yml:397-399`, `:427-429`,
   `MMCA.Store/.github/workflows/deploy.yml:368`, `:395`). Helpdesk has no coverage floor in its CI. The
   values are configuration and change by ratchet; current test counts and measured coverage belong
   to `MMCA.Common/FACTS.md` and are not restated here.

## Rationale
- **Errors are feedback that cannot be skipped.** An analyzer error sits inside the build loop, names
  the rule and the line, and needs no reviewer, which makes it the cheapest available enforcement for
  a convention and the one an agent cannot route around by not noticing.
- **Error-by-default with named relaxations keeps the exceptions visible.** Starting from
  `dotnet_analyzer_diagnostic.severity = error` means every rule that does not apply here is turned
  off by name with a reason, so the exception list is reviewable rather than implied by silence.
- **One baseline makes code portable across the four repos.** Code moved from a consumer into Common
  (or copied from the Helpdesk template into a new app) meets the same rules on arrival, and a fix
  for an analyzer finding is the same fix everywhere.
- **A mechanical comparison beats a remembered one.** A changed or missing rule line in an 800-line
  file is invisible to a reader; `compare-analyzer-config.ps1` makes it a one-command check with an
  exit code (for line content, not for case, order or line endings).
- **Count floors turn "zero tests ran" into a failure.** A discovery or filter breakage is otherwise
  indistinguishable from a passing suite.
- **Unit-tier coverage is the stable number to gate.** It moves with code that has tests, not with
  how much of the UI an E2E gallery happened to exercise, so a drop is a real regression.

## Trade-offs
- **Build time.** Five analyzer packages plus code-style enforcement on every project in the strict build lengthen every
  build, locally and in CI.
- **Suppression pressure.** Error severity makes suppressing a rule the fastest way to green, and a
  suppression added to make something pass looks the same in a diff as a deliberate relaxation. The
  defense is review of `.editorconfig` and `NoWarn` changes, not this policy.
- **CI-only analyzer failures.** Local `local.props` source mode can build green while package-mode
  CI fails on an analyzer, so a green local build is not proof of a green CI run, and some changes
  need a CI round-trip to surface their findings.
- **A shared-block edit is a four-repo change.** Any edit above the marker must be mirrored into the
  other three repos, each through its own PR, or `compare-analyzer-config.ps1` reports drift. The
  hook only reminds; it does not block.
- **Analyzer pins can drift between repos.** The baseline is shared but the package versions are
  pinned per repo, so a bump in one repo lets a rule behave differently there until the others
  follow. The four pins match today, but only manual sweeps keep them aligned (the `/push-release`
  consumer sweep, or the one-pass bump rule in `/nuget-audit`, `.claude/commands/nuget-audit.md:25`);
  no automated check compares the analyzer pins across repos.
- **Floors lag and can be gamed.** A count floor set below the real count lets a large deletion pass,
  a coverage floor kept two points under the measured value absorbs small regressions, and both rise
  only when someone ratchets them. Coverage measures lines executed, not behavior asserted, so a test
  that runs code without checking it raises the number. Floors are also uneven: the ADC and Store browser E2E
  runs carry no count floor (Common's gallery E2E does), and Helpdesk's coverage is not gated.

## Revision (2026-10-21)
Re-verified against current source. The policy is unchanged: warnings as errors, five analyzer
packages on every non-`.dcproj` project except Common's `build/` tools
(`MMCA.Common/build/Directory.Build.props:3-7`, `MMCA.Common/build/facts/facts.csproj:16`), error-by-default severity, the shared `.editorconfig` block
above the marker at `:821`, and the same test-count and coverage floor values. What moved is the
analyzer pin picture, one unrecorded Common analyzer, and most props and workflow anchors.

1. The analyzer pins now match in all four repos: Meziantou `3.0.315`, Threading `18.12.1`,
   Roslynator `5.0.1`, SonarAnalyzer `10.35.0.4138`, StyleCop `1.2.0-beta.556`
   (`MMCA.Common/Directory.Packages.props:230`, `:236-239`; `MMCA.ADC/Directory.Packages.props:42-46`;
   `MMCA.Store/Directory.Packages.props:61-64`, `:73`; `MMCA.Helpdesk/Directory.Packages.props:35-39`).
   The pins stay per repo, so Decision 2 drops the divergence example and the Trade-offs bullet now
   describes drift as a possibility rather than a current state.
2. Common's `Source` projects (not `.dcproj`, not `MMCA.Common.UI.Maui`) also reference
   Microsoft.CodeAnalysis.PublicApiAnalyzers (`MMCA.Common/Directory.Build.props:111-118`, pinned
   `5.6.0` at `MMCA.Common/Directory.Packages.props:235`); Decision 2 now records it.
3. In ADC's AI evaluation job the gating golden-replay and prompt-contract step carries
   `--minimum-expected-tests 1` (`MMCA.ADC/.github/workflows/deploy.yml:555`); only the live judge
   omits it (`:557-560`). The ADC Application-layer branch floor also fails closed on a missing file
   (`:427-429`) and when fewer than four assemblies are covered (`:436`).
4. Anchors re-verified against current source: analyzer item groups
   `MMCA.Common/Directory.Build.props:130`, `:131-150`; `MMCA.ADC/Directory.Build.props:116`,
   `:117-136`; `MMCA.Store/Directory.Build.props:116`, `:117-136`;
   `MMCA.Helpdesk/Directory.Build.props:47`, `:48-67`. Floors: ADC unit
   `MMCA.ADC/.github/workflows/deploy.yml:366`, ADC integration `:730`, Store integration
   `MMCA.Store/.github/workflows/deploy.yml:677`; Common Redis `MMCA.Common/.github/workflows/ci.yml:767`,
   PostgreSQL `:804`, SQL Server `:844`, AppHost `:891`. ADC coverage gate: filter
   `MMCA.ADC/.github/workflows/deploy.yml:404`, floor `:406`, comparison `:408`, fail-closed
   `:397-399`; branch filter `:433`, floor `:442`, comparison `:444`. Unchanged and confirmed:
   the Decision 1 and 3 to 5 anchors, Common `ci.yml:163`, `:292`, `:395-396`, `:409`, `:527`, and
   Store `deploy.yml:338`, `:368`, `:372-376`, `:407`, `:409`.

## Related
[ADR-015](015-architecture-fitness-functions.md) (fitness tests, the other executable-convention
layer), [ADR-016](016-lockstep-versioning-masstransit-pin.md) (lockstep package versioning, which
governs the `MMCA.Common.*` pins but not the analyzer pins here),
[ADR-049](049-library-configureawait-policy.md) (CA2007, enforced only because it errors),
[ADR-060](060-performance-regression-gate.md), [ADR-063](063-accessibility-conformance-gate.md) and
[ADR-092](092-web-vitals-budget-gate.md) (the other CI gates),
[ADR-109](109-feature-by-folder-convention.md) (IDE0130 under TreatWarningsAsErrors).
