# ADR-132: Build Strictness: Analyzers at Error Severity, a Shared Baseline, and CI Test Floors

## Status
Accepted (2026-10-07). The policy predates this record: all four .NET repos have built this way for
some time, and this is the first written decision for it rather than the start of the practice.
Revised 2026-10-21: the four repos now pin identical analyzer versions (the pins stay per repo),
Common's source-only PublicApiAnalyzers group is recorded, and the props, workflow and coverage-gate
anchors are re-pointed.
Revised 2026-10-26: Meziantou moves to `3.0.317` in all four repos, Common's AWS LocalStack and
Google Cloud emulator floors are recorded, and the props and workflow anchors are re-pointed.
Revised 2026-10-28: anchors refreshed after a 32-line shift in Common's `ci.yml` moved the floor
and coverage-gate lines, and the baseline comparison run is re-dated.
Revised 2026-11-23: three analyzer pins move (StyleCop now stable `1.3.180`), Common's unit floor is
per framework leg (`11250`) with `22500` on the release run, four Common job floors move (two lower,
two higher), both
consumers gain integration-tier coverage floors and Store's line filter drops the service hosts, the
comparison script runs three checks, and the pin-divergence report in `/nuget-audit` is recorded.

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
   `true` (`MMCA.Common/Directory.Build.props:19`, `:25`; `MMCA.ADC/Directory.Build.props:51`, `:54`;
   `MMCA.Store/Directory.Build.props:48`, `:51`; `MMCA.Helpdesk/Directory.Build.props:13`, `:16`).
   All four also pin `AnalysisLevel` to `latest`, set `AnalysisMode` to `All` and turn on
   `EnforceCodeStyleInBuild` (`MMCA.Common/Directory.Build.props:23`, `:24`, `:26`;
   `MMCA.ADC/Directory.Build.props:52`, `:53`, `:55`; `MMCA.Store/Directory.Build.props:49`, `:50`,
   `:52`; `MMCA.Helpdesk/Directory.Build.props:14`, `:15`, `:17`), so IDE-only style rules run in the
   command-line build too.
2. **Five third-party analyzer packages run on every project in the strict build.** Meziantou,
   Microsoft.VisualStudio.Threading, Roslynator, SonarAnalyzer and StyleCop are referenced from the
   root props of each repo (`MMCA.Common/Directory.Build.props:168-187`,
   `MMCA.ADC/Directory.Build.props:152-171`, `MMCA.Store/Directory.Build.props:149-168`,
   `MMCA.Helpdesk/Directory.Build.props:33-52`). Two kinds of project are outside it. Docker Compose
   `.dcproj` projects are excluded by the condition on that item group
   (`MMCA.Common/Directory.Build.props:167`, `MMCA.ADC/Directory.Build.props:151`,
   `MMCA.Store/Directory.Build.props:148`, `MMCA.Helpdesk/Directory.Build.props:32`), because they
   have no compiler to run an analyzer in. Common adds a sixth analyzer,
   Microsoft.CodeAnalysis.PublicApiAnalyzers (the RS0016/RS0017 public API baseline), only on its
   `Source` projects, never on a `.dcproj` and never on `MMCA.Common.UI.Maui` (`MMCA.Common/Directory.Build.props:148-155`). Common's two build tools, the FACTS generator and the perf
   gate, are isolated from the strict build through `MMCA.Common/build/Directory.Build.props`
   (`MMCA.Common/build/facts/facts.csproj:5`) and turn off `TreatWarningsAsErrors`,
   `EnforceCodeStyleInBuild` and `RunAnalyzers` (`MMCA.Common/build/facts/facts.csproj:14-16`,
   `MMCA.Common/build/perfgate/perfgate.csproj:14-16`). The packages are pinned
   through Central Package Management (`MMCA.Common/Directory.Packages.props:363`, `:369-372`, PublicApiAnalyzers at `:368`;
   `MMCA.ADC/Directory.Packages.props:97-101`; `MMCA.Store/Directory.Packages.props:86-89`, `:98`;
   `MMCA.Helpdesk/Directory.Packages.props:32-36`). The pins are per repo and are not required to
   match; today all four carry the same versions (Meziantou `3.0.342`, Threading `18.12.1`,
   Roslynator `5.0.1`, SonarAnalyzer `10.37.0.15768`, StyleCop `1.3.180`, a stable release).
3. **Every analyzer diagnostic defaults to error severity.** The shared `.editorconfig` block sets
   `dotnet_analyzer_diagnostic.severity = error` (`MMCA.Common/.editorconfig:313`, the same line in
   `MMCA.ADC/.editorconfig:313`, `MMCA.Store/.editorconfig:313` and `MMCA.Helpdesk/.editorconfig:313`);
   individual rules are then relaxed or disabled by name, with the reason beside them, rather than
   the default being lowered.
4. **One analyzer baseline, shared above a marker.** Each repo's root `.editorconfig` states the
   contract at its head (`MMCA.Common/.editorconfig:5`) and carries the `# REPO-SPECIFIC DELTAS`
   marker at `:797` in all four files (`MMCA.ADC/.editorconfig:797`, `MMCA.Store/.editorconfig:797`,
   `MMCA.Helpdesk/.editorconfig:797`). Everything above the marker is meant to be identical across
   the four repos; per-repo overrides go below it.
5. **The shared block is checked by a script, and an edit to it triggers a reminder.**
   `Tools/Scripts/compare-analyzer-config.ps1` (workspace root) reads all four files as lines
   (`:34`, called at `:42`), finds the marker (`:39`, `:43`, an error when it is missing at `:44`),
   keeps the lines above it (`:45`), compares each slice against Common's with `Compare-Object`
   (`:48`), and flags a line that appears on one side only (`:50`). The same script runs two more
   checks (`:8-19`): an ordered, case-sensitive comparison of the shared block between the BEGIN and
   END SHARED CONSUMER BUILD BASELINE markers in the ADC and Store `Directory.Build.props`
   (`:59-88`), and whole-file identity, line endings ignored, of `global.json` in all four repos and
   of `Directory.Build.targets`, `nuget.config` and `local.props.template` in ADC and Store
   (`:90-106`). Any of the three failing exits `1` (`:110`), otherwise it exits `0` (`:114`); it
   passed all three on 2026-11-23. The `.editorconfig` check is line-set equality, not byte equality
   (`:12-13`): reading by line drops line endings, and a default `Compare-Object` is case-insensitive
   and does not compare line order, so a CRLF/LF difference, a case-only change or a reordered block
   passes (the contract header at `MMCA.Common/.editorconfig:6` calls the block byte-identical, which
   overstates what is checked). The post-edit hook does not run the script itself: on an edit to any
   of the four `.editorconfig` files it emits a FOLLOW-UP REQUIRED message naming the script and the
   obligation to mirror an above-marker change (`.claude/hooks/post-edit-followups.sh:24-31`), and it
   emits a similar message for the ADC and Store shared build files (`:34-38`).
6. **CI asserts a minimum test count, so an empty run fails.** The solution-wide unit runs carry
   `--minimum-expected-tests`. Common runs its unit suite once per framework leg
   (`build-and-test-tfm`, matrix `net10.0`/`net11.0`, `MMCA.Common/.github/workflows/ci.yml:100`,
   `:110`) with a per-leg floor of `11250` (`:177`, rationale at `:171-175`), and its release run
   covers both frameworks in one pass with `22500` (`MMCA.Common/.github/workflows/release.yml:101`).
   ADC carries `5000` on its `net11.0` unit run (`MMCA.ADC/.github/workflows/deploy.yml:448`,
   rationale at `:438-444`) and again on its `net10.0` leg (`:606-609`), Store `2650`
   (`MMCA.Store/.github/workflows/deploy.yml:363`, rationale at `:355`), Helpdesk `1`
   (`MMCA.Helpdesk/.github/workflows/ci.yml:122`). The integration tiers carry their own (ADC `450` at
   `MMCA.ADC/.github/workflows/deploy.yml:1036`, Store `250` at
   `MMCA.Store/.github/workflows/deploy.yml:802`), as do Common's gallery E2E (`ci.yml:489`, `1`),
   Redis (`:1065`, `14`), per-engine PostgreSQL and SQL Server (`:1125`, `12`; `:1185`, `5`), AWS
   LocalStack (`:1245`, `13`), Google Cloud emulator (`:1312`, `14`) and AppHost (`:1402`, `1`) jobs,
   Common's Helpdesk canary (`ci.yml:811`, `40`), ADC's AppHost tests
   (`MMCA.ADC/.github/workflows/apphost-tests.yml:98`, `1`, rationale at `:13`) and both consumers'
   cross-service jobs (`1` each, `MMCA.ADC/.github/workflows/cross-service-tests.yml:114`, `:173`;
   `MMCA.Store/.github/workflows/cross-service-tests.yml:119`, `:172`). Adoption is not universal: the
   ADC and Store browser E2E runs carry no floor (`MMCA.ADC/.github/workflows/e2e.yml:424-427`,
   `MMCA.Store/.github/workflows/e2e.yml:464-468`), and ADC's live AI judge omits it on purpose,
   because without its API key every case skips (`MMCA.ADC/.github/workflows/deploy.yml:704`, note at
   `:705-707`), while the gating golden-replay and prompt-contract step in the same job keeps a floor
   of `1` (`MMCA.ADC/.github/workflows/deploy.yml:702`, step at `:695`, rationale at `:696-697`).
7. **CI enforces line-coverage floors per tier, not on the merged report.** Common gates the
   unit, architecture and bUnit tier with generated code excluded at `68.3` percent
   (`MMCA.Common/.github/workflows/ci.yml:603`, comparison at `:618`), merging the two per-framework
   unit reports first (`:608-615`), and says why the merged all-tier report is not used: the gallery
   E2E tier dilutes it (`:600`, rationale at `:597-602`). ADC gates its own code (filtered to
   `MMCA.ADC.*` minus the test, `*.Service` host and `*.Contracts` assemblies,
   `MMCA.ADC/.github/workflows/deploy.yml:486`) at `55.5` percent line coverage (`:488`, comparison at
   `:490`) and adds an Application-layer branch floor of `77.5` percent (filter `:515`, floor `:524`,
   comparison `:526`), which also fails when the report covers fewer than four Application
   assemblies (`:518`); both run on the `net11.0` unit leg only. Store does
   the same over `MMCA.Store.*` minus tests, the `*.Service` hosts and `*.Contracts`
   (`MMCA.Store/.github/workflows/deploy.yml:400`, the host exclusion explained at `:390-392`)
   at `51.6` percent line (`:402`, `:404`) and `72.8` percent Application-layer branch (`:435`, `:437`),
   which also fails when the report covers fewer than three Application assemblies (`:429`). Both
   consumers also gate the integration tier on an Infrastructure+API line floor (ADR-147): ADC
   `42.5` percent (`MMCA.ADC/.github/workflows/deploy.yml:1065`, filter `:1057`, at least six
   assemblies `:1060`, rationale `:1040-1046`), Store `33.0` percent
   (`MMCA.Store/.github/workflows/deploy.yml:830`, filter `:822`, at least five assemblies `:825`,
   rationale `:806-811`). Every consumer floor fails closed when its coverage file is missing
   (`MMCA.ADC/.github/workflows/deploy.yml:479-482`, `:509-512`, `:1050-1053`;
   `MMCA.Store/.github/workflows/deploy.yml:396`, `:423`, `:815-818`). Common also runs a
   non-required CRAP-score risk ratchet over the unit and Testcontainers reports
   (`MMCA.Common/.github/workflows/ci.yml:620-624`, ADR-147), which is outside this floor policy.
   Helpdesk has no coverage floor in its CI. The
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
  exit code. Its `.editorconfig` check covers line content, not case, order or line endings; the
  props-block check is ordered and case-sensitive (`:77`), and the whole-file check is
  case-sensitive with line endings ignored (`:101`).
- **Count floors turn "zero tests ran" into a failure.** A discovery or filter breakage is otherwise
  indistinguishable from a passing suite.
- **Per-tier coverage is the stable number to gate.** A unit or integration floor moves with code
  that tier tests, not with how much of the UI an E2E gallery happened to exercise, so a drop is a
  real regression.

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
  follow. The four pins match today, kept aligned by the one-pass bump rule in `/nuget-audit`
  (`.claude/commands/nuget-audit.md:27`, with the analyzer group a lockstep family at `:47`). Its
  inventory script reports cross-repo version divergence per package
  (`Tools/Scripts/nuget-audit-inventory.ps1:165`, count printed at `:201`), but only when the audit
  runs it on demand (`.claude/commands/nuget-audit.md:75`): no CI gate or schedule compares the pins.
  Common's Dependabot `analyzers` group (`MMCA.Common/.github/dependabot.yml:19-25`) can move
  Common's pins ahead of the consumers between audits.
- **Floors lag and can be gamed.** A count floor set below the real count lets a large deletion pass,
  a coverage floor kept two points under the measured value absorbs small regressions, and both rise
  only when someone ratchets them. A count floor can also be lowered on purpose, in the PR that
  deletes tests (`MMCA.Common/.github/workflows/ci.yml:174`); Common's Redis and AWS LocalStack floors
  sit one lower than in the 2026-10-28 revision. Coverage measures lines executed, not behavior asserted, so a test
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

## Revision (2026-10-26)
Re-verified against current source. The policy and every floor value are unchanged: warnings as
errors, five analyzer packages on every non-`.dcproj` project, Common's source-only
PublicApiAnalyzers group, error-by-default severity, the shared `.editorconfig` block above the
marker at `:821`, count floors Common `2000`, ADC `5000`, Store `2650`, Helpdesk `1`, and coverage
floors `68.3`, `55.5`/`77.5` and `51.6`/`72.8`. What moved is one analyzer pin, two Common floored
jobs not yet listed, and most props and workflow anchors.

1. Meziantou.Analyzer is now `3.0.317` in all four repos
   (`MMCA.Common/Directory.Packages.props:286`, `MMCA.ADC/Directory.Packages.props:50`,
   `MMCA.Store/Directory.Packages.props:66`, `MMCA.Helpdesk/Directory.Packages.props:35`); the other
   four pins are unchanged and still identical, so Decision 2 records `3.0.317`.
2. Common's CI also floors its AWS LocalStack job (`--minimum-expected-tests 14`,
   `MMCA.Common/.github/workflows/ci.yml:940`) and its Google Cloud emulator job (`14`, `:987`);
   Decision 6 now lists both.
3. Anchors re-verified against current source: analyzer item groups
   `MMCA.Common/Directory.Build.props:113`, `:114-133`; `MMCA.ADC/Directory.Build.props:100`,
   `:101-120`; `MMCA.Store/Directory.Build.props:102`, `:103-122`;
   `MMCA.Helpdesk/Directory.Build.props:32`, `:33-52`; PublicApiAnalyzers group
   `MMCA.Common/Directory.Build.props:94-101`. Pins: `MMCA.Common/Directory.Packages.props:286`,
   `:292-295`, PublicApiAnalyzers `5.6.0` at `:291`; `MMCA.ADC/Directory.Packages.props:50-54`;
   `MMCA.Store/Directory.Packages.props:66-69`, `:78`. Floors: ADC unit
   `MMCA.ADC/.github/workflows/deploy.yml:367`, ADC integration `:731`, Store integration
   `MMCA.Store/.github/workflows/deploy.yml:678`; Common gallery E2E
   `MMCA.Common/.github/workflows/ci.yml:345`, Helpdesk canary `:580`, Redis `:820`, PostgreSQL
   `:860`, SQL Server `:900`, AppHost `:1034`. ADC AI evaluation: golden replay
   `MMCA.ADC/.github/workflows/deploy.yml:556`, rationale `:550-551`, live judge `:558-561`. ADC
   browser E2E `MMCA.ADC/.github/workflows/e2e.yml:360-362`. Common coverage gate: rationale
   `MMCA.Common/.github/workflows/ci.yml:448-449`, comparison `:462`. ADC coverage gate: filter
   `MMCA.ADC/.github/workflows/deploy.yml:405`, floor `:407`, comparison `:409`, fail-closed
   `:398-400`; branch filter `:434`, assembly count `:437`, floor `:443`, comparison `:445`,
   fail-closed `:428-430`. Unchanged and confirmed: the Decision 1 and 3 to 5 anchors,
   `MMCA.Helpdesk/Directory.Packages.props:35-39`, Common `ci.yml:163` and `release.yml:89`, Store
   `deploy.yml:338`, `:368`, `:372-376`, `:395`, `:401`, `:407`, `:409`,
   `MMCA.Store/.github/workflows/e2e.yml:394-397`, Helpdesk `ci.yml:104`, and the cross-service
   floors.

## Revision (2026-10-28)
Re-verified against current source. The policy and every floor value are unchanged: count floors
Common `2000` (`MMCA.Common/.github/workflows/ci.yml:163`, `release.yml:89`), gallery E2E `1`,
Helpdesk canary `40`, Redis `15`, PostgreSQL `11`, SQL Server `3`, AWS LocalStack `14`, Google
Cloud emulator `14`, AppHost `1`, and the Common unit-tier coverage floor `68.3`. What moved is the
Common `ci.yml` anchors, which shifted by 32 lines.

1. `Tools/Scripts/compare-analyzer-config.ps1` reported the shared baseline identical across the
   four repos on 2026-10-28 (exit `0`); its anchors (`:19`, `:25`, `:26`, `:28`, `:34`, `:47`) and
   the hook anchor (`.claude/hooks/post-edit-followups.sh:23-26`) hold. Decision 5 now records that
   run in place of the 2026-10-07 one.
2. Anchors re-verified against current source: Common floored jobs, gallery E2E
   `MMCA.Common/.github/workflows/ci.yml:377`, Helpdesk canary `:612`, Redis `:852`, PostgreSQL
   `:892`, SQL Server `:932`, AWS LocalStack `:972`, Google Cloud emulator `:1019`, AppHost `:1066`.
   Common coverage gate: step `MMCA.Common/.github/workflows/ci.yml:483`, rationale `:477-482` with
   the gallery E2E dilution clause at `:480`, floor and comparison `:494`.

## Revision (2026-11-23)
Re-verified against current source. The policy shape is unchanged: warnings as errors, five analyzer
packages on every non-`.dcproj` project, Common's source-only PublicApiAnalyzers group,
error-by-default severity, the shared `.editorconfig` block above the marker, count floors on every
gating suite except browser E2E and the live AI judge, and the line and branch floors `68.3`,
`55.5`/`77.5` and `51.6`/`72.8`. What moved is three analyzer pins, the Common unit floor, four Common
job floors, the consumer coverage gates, the comparison script and hook, and nearly every anchor.

1. The analyzer pins now read Meziantou `3.0.342`, SonarAnalyzer `10.37.0.15768` and StyleCop
   `1.3.180` (a stable release, no longer a beta) in all four repos, Threading and Roslynator
   unchanged (`MMCA.Common/Directory.Packages.props:363`, `:369-372`;
   `MMCA.ADC/Directory.Packages.props:97-101`; `MMCA.Store/Directory.Packages.props:86-89`, `:98`;
   `MMCA.Helpdesk/Directory.Packages.props:32-36`). Decision 2 records them.
2. Common's unit suite now runs once per framework (`MMCA.Common/.github/workflows/ci.yml:100`,
   `:110`) with a per-leg floor of `11250` (`:177`), while `release.yml` keeps a combined floor of
   `22500` (`MMCA.Common/.github/workflows/release.yml:101`). The coverage gate merges the two
   per-framework unit reports (`ci.yml:608-615`). Decision 6 and Decision 7 now say so.
3. Common job floors changed: Redis `14` (was `15`), PostgreSQL `12` (was `11`), SQL Server `5` (was
   `3`), AWS LocalStack `13` (was `14`); Google Cloud emulator `14`, AppHost `1`, gallery E2E `1` and
   Helpdesk canary `40` are unchanged (`MMCA.Common/.github/workflows/ci.yml:1065`, `:1125`, `:1185`,
   `:1245`, `:1312`, `:1402`, `:489`, `:811`). Because two of them fell, the Trade-offs bullet on
   floors now says a floor can be lowered deliberately (`ci.yml:174`).
4. ADC also floors its `net10.0` unit leg at `5000` (`MMCA.ADC/.github/workflows/deploy.yml:606-609`)
   and its AppHost tests at `1` (`MMCA.ADC/.github/workflows/apphost-tests.yml:98`); Decision 6 lists
   both.
5. Both consumers gate the integration tier on an Infrastructure+API line floor, ADC `42.5`
   (`MMCA.ADC/.github/workflows/deploy.yml:1065`) and Store `33.0`
   (`MMCA.Store/.github/workflows/deploy.yml:830`), so Decision 7 is no longer unit-tier only and its
   bold lead now says the floors are per tier. Store's unit line filter now also excludes `MMCA.Store.*.Service`
   (`MMCA.Store/.github/workflows/deploy.yml:400`, reason at `:390-392`).
6. `Tools/Scripts/compare-analyzer-config.ps1` now runs three checks (`:8-19`), the `.editorconfig`
   line-set comparison plus an ordered comparison of the ADC/Store shared `Directory.Build.props`
   block (`:59-88`) and a whole-file identity check of the shared root files (`:90-106`); it passed
   all three on 2026-11-23 (exit `0`). The post-edit hook also reminds on the ADC/Store shared build
   files (`.claude/hooks/post-edit-followups.sh:34-38`). Decision 5 records both.
7. The pin-alignment rule in `/nuget-audit` is at `.claude/commands/nuget-audit.md:27` (not `:25`),
   and its inventory script reports cross-repo divergence on demand
   (`Tools/Scripts/nuget-audit-inventory.ps1:165`, `:201`); `/push-release` does not touch analyzer
   pins, so the Trade-offs bullet no longer credits it.
8. Anchors re-verified against current source: props `MMCA.Common/Directory.Build.props:19`, `:23-26`,
   analyzer group `:167`, `:168-187`, PublicApiAnalyzers group `:148-155`;
   `MMCA.ADC/Directory.Build.props:51-55`, `:151`, `:152-171`; `MMCA.Store/Directory.Build.props:48-52`,
   `:148`, `:149-168`. Severity line `.editorconfig:313` and marker `:797` in all four repos. Script
   `Tools/Scripts/compare-analyzer-config.ps1:34`, `:39`, `:42-45`, `:48`, `:50`, `:110`, `:114`; hook
   `.claude/hooks/post-edit-followups.sh:24-31`. Floors: ADC unit
   `MMCA.ADC/.github/workflows/deploy.yml:448`, integration `:1036`, AI golden replay `:702`, live
   judge `:704-707`; Store unit `MMCA.Store/.github/workflows/deploy.yml:363`, integration `:802`;
   Helpdesk `MMCA.Helpdesk/.github/workflows/ci.yml:122`; cross-service
   `MMCA.ADC/.github/workflows/cross-service-tests.yml:114`, `:173`,
   `MMCA.Store/.github/workflows/cross-service-tests.yml:119`, `:172`; browser E2E
   `MMCA.ADC/.github/workflows/e2e.yml:424-427`, `MMCA.Store/.github/workflows/e2e.yml:464-468`.
   Coverage: Common `MMCA.Common/.github/workflows/ci.yml:603`, `:597-602`, `:600`, `:618`; ADC
   `MMCA.ADC/.github/workflows/deploy.yml:486`, `:488`, `:490`, `:479-482`, `:515`, `:518`, `:524`,
   `:526`, `:509-512`; Store `MMCA.Store/.github/workflows/deploy.yml:402`, `:404`, `:396`, `:426`,
   `:429`, `:435`, `:437`, `:423`. Unchanged and confirmed: `MMCA.Helpdesk/Directory.Build.props:13-17`,
   `:32`, `:33-52`, and `MMCA.Common/.editorconfig:5`.

## Related
[ADR-015](015-architecture-fitness-functions.md) (fitness tests, the other executable-convention
layer), [ADR-016](016-lockstep-versioning-masstransit-pin.md) (lockstep package versioning, which
governs the `MMCA.Common.*` pins but not the analyzer pins here),
[ADR-049](049-library-configureawait-policy.md) (CA2007, enforced only because it errors),
[ADR-060](060-performance-regression-gate.md), [ADR-063](063-accessibility-conformance-gate.md) and
[ADR-092](092-web-vitals-budget-gate.md) (the other CI gates),
[ADR-109](109-feature-by-folder-convention.md) (IDE0130 under TreatWarningsAsErrors).
