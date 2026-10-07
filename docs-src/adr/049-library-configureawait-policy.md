# ADR-049: Library-Scoped ConfigureAwait(false) Policy (CA2007)

## Status
Accepted (2026-07-20; measurements re-anchored 2026-08-07, 2026-08-14, 2026-08-18, 2026-08-23,
2026-08-31, 2026-09-01, 2026-09-03, 2026-09-11, 2026-09-19, 2026-10-01, 2026-10-06 and 2026-10-07).
Revised 2026-09-19: the framework site counts and the consumer-scale upper bound are re-measured, and
the occurrence-versus-line delta still turns on the same two ADC handler lines. The policy, the gate
and the exemption are unchanged.
Revised 2026-10-06: the UI exemption is restated as leaving the rule unenforced in mixed UI-package
code (those packages now call `ConfigureAwait(false)` 154 times), and the drift script is no longer
credited with guarding the repo-delta section.
Revised 2026-10-07: the consumer-scale figure is re-measured after ADC growth (ADC 1,544 occurrences,
2,359 combined) and the `.editorconfig` gate and exemption anchors are refreshed.

## Context
MMCA.Common ships as NuGet packages consumed by host applications, not as an application itself.
Library code that awaits without `ConfigureAwait(false)` captures the caller's `SynchronizationContext`
and resumes on it. In ASP.NET Core hosts there is no synchronization context, so the capture is a
no-op; that is why the workspace baseline disables the ConfigureAwait analyzers everywhere
(`CA2007`, `MA0004`, `RCS1090`, `VSTHRD111` in each repo's `.editorconfig`), and for the three
application repos (Store, ADC, Helpdesk) that remains the right call.

But the framework's packages do not get to choose their callers. `MMCA.Common.UI.Maui` (ADR-042)
runs inside MAUI, which HAS a UI synchronization context, and any future non-ASP.NET consumer
(WPF/WinForms tooling, a console host with a custom context) inherits the same exposure: a
context-capturing await inside the packages is the classic library deadlock and needless
context-hopping cost. Until now the framework relied on the ASP.NET-only assumption instead of the
standard .NET library guidance (libraries call `ConfigureAwait(false)`; applications do not need to).

## Decision
Packaged non-UI framework code awaits with `ConfigureAwait(false)`; UI component packages and
application code do not.

- **Enforcement is a build gate, not a convention.** The MMCA.Common `.editorconfig` repo-delta
  section raises `CA2007` to `warning` for `[Source/**.cs]` (a build error under
  `TreatWarningsAsErrors`), scoped back to `none` for `[Source/Presentation/MMCA.Common.UI*/**.cs]`.
  Tests keep the baseline (xUnit has no synchronization context worth preserving, and test code is
  not shipped).
- **UI component packages are excluded deliberately.** The exemption glob covers the whole
  `MMCA.Common.UI*` family, which is three packaged projects, not two: `MMCA.Common.UI` (the Blazor
  component library), `MMCA.Common.UI.Web` (the Blazor Web host services) and `MMCA.Common.UI.Maui`
  (the MAUI capability adapters). Their component code must resume on the renderer/UI context, where
  `ConfigureAwait(false)` would be a bug, but the packages also hold code that does not (service
  plumbing, token storage, the server-side same-origin proxy in `MMCA.Common.UI.Web/SameOriginProxy/`)
  and calls `ConfigureAwait(false)` on purpose. The exemption is therefore a choice to leave the rule
  unenforced in mixed UI-package code and decide per call site, not a claim that the call is wrong
  everywhere in those packages.
- **The application repos keep the baseline.** Store, ADC and Helpdesk are ASP.NET Core hosts
  (plus Blazor/MAUI heads); `CA2007`/`MA0004` stay off in the shared analyzer baseline, per the
  same guidance that libraries and applications have opposite defaults.
- **One analyzer owns the rule.** `CA2007` is the enforced gate; the overlapping `MA0004`,
  `RCS1090` and `VSTHRD111` stay disabled so a violation reports once, not four times.

## Rationale
- **Correctness for the one consumer that already has a context.** The MAUI head consumes
  Infrastructure/Application/API packages through DI; a sync-over-async call anywhere in that stack
  (or a consumer's `.GetAwaiter().GetResult()` bridge) deadlocks only when the library captured the
  context. `ConfigureAwait(false)` removes the failure mode at the source.
- **Standard .NET library guidance, applied at the boundary where it holds.** The rule is scoped to
  exactly the code that ships in packages; it is not blanket-applied to the apps, where it would be
  360+ sites of pure noise (measured across Store/ADC before this decision, and the current scale is
  far past that: a raw `\bawait\b` scan of `*.cs` on 2026-10-07 counts 815 occurrences in
  `MMCA.Store/Source` and 1,544 in `MMCA.ADC/Source`, 2,359 combined, which is the upper bound on the
  CA2007 sites the rule would open there).
- **Mechanical, with the enforcement and the remediation at different levels.** The build gate is the
  enforced half: a new context-capturing await in packaged non-UI code fails the build, so it costs no
  review effort. The remediation is a convention rather than an artifact: `dotnet format analyzers
  --diagnostics CA2007` fixes a batch in place, but no script, CI step or `CONTRIBUTING.md` entry
  invokes it, so it is guidance for whoever trips the gate and not automation the repo runs.

## Trade-offs
- **Visual noise in framework source.** Every await in `Source/` (except UI packages) carries
  `.ConfigureAwait(false)` (324 sites at adoption; 1,148 gated sites as of the 2026-10-06 snapshot,
  out of 1,302 across `Source/` once the 154 calls in the exempt UI packages are counted back in).
  The gate makes it uniform, so the noise is consistent rather than sporadic.
- **A per-repo delta in an otherwise shared analyzer baseline.** The workspace keeps one
  byte-identical `.editorconfig` baseline across the four repos; this policy lives in the marked
  repo-delta section of MMCA.Common's file (`MMCA.Common/.editorconfig:821-838`), so the divergence
  is documented. It is not mechanically guarded: the workspace drift script
  (`Tools\Scripts\compare-analyzer-config.ps1`) compares only the lines before the
  `# REPO-SPECIFIC DELTAS` marker (`Tools/Scripts/compare-analyzer-config.ps1:26-28`), so it guards
  the shared baseline (including `CA2007` at `none`, `MMCA.Common/.editorconfig:348`) and would not
  notice the gate at `:834-835` or the exemption at `:837-838` being changed or deleted.
- **UI exclusion relies on project naming.** The `MMCA.Common.UI*` path glob is what exempts the
  component packages; a renamed or relocated UI project would silently fall under the gate (the
  build would fail loudly on the first missing `ConfigureAwait`, so the failure is visible, just
  not self-explaining).

## Related
ADR-042 (the MAUI package whose synchronization context motivates the policy), ADR-027 (the same
"machine-boundary hygiene as a build gate" posture applied to culture-explicit formatting via
MA0076), ADR-015 (fitness-function philosophy: invariants enforced by the build, not by review).

## Revision (2026-08-07)
An audit against the code. The policy did not change; three statements about it did.

1. **The exemption covers three packages, not the two the Decision named.** The glob is
   `[Source/Presentation/MMCA.Common.UI*/**.cs]` with severity `none`
   (`MMCA.Common/.editorconfig:831-832`), sitting under the `[Source/**.cs]` gate at `:828-829`, and
   `Source/Presentation/` holds three projects whose names start with `MMCA.Common.UI`:
   `MMCA.Common.UI` (`Source/Presentation/MMCA.Common.UI/MMCA.Common.UI.csproj`),
   `MMCA.Common.UI.Web` (`Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj`) and
   `MMCA.Common.UI.Maui` (`Source/Presentation/MMCA.Common.UI.Maui/MMCA.Common.UI.Maui.csproj`). All
   three are packaged (`MMCA.Common.UI.Web` declares `<PackageId>MMCA.Common.UI.Web</PackageId>` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:3`), so naming only
   two of them left a reader concluding that `MMCA.Common.UI.Web` was gated when it is not. The
   exclusion is right on the merits (its services run on the Blazor circuit and the SSR prerender
   path, for example `ServerTokenStorageService` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:18`),
   but it was undocumented. The Decision bullet now names the family and all three members.
2. **The site counts are re-measured and dated.** The "324 sites at adoption" figure is a
   2026-07-20 snapshot and stays as history. Measured on 2026-08-07, `MMCA.Common/Source/**/*.cs`
   holds 719 `ConfigureAwait(false)` occurrences across 147 files, of which 90 sit inside the exempt
   packages (`MMCA.Common.UI` 47, `MMCA.Common.UI.Maui` 41, `MMCA.Common.UI.Web` 2), leaving 629
   under the gate. The consumer-scale figure in the Rationale is likewise re-anchored: a raw `await`
   scan gives 593 occurrences in `MMCA.Store/Source/**/*.cs` (112 files) and 1,175 in
   `MMCA.ADC/Source/**/*.cs` (217 files). Raw `await` overcounts CA2007 sites (it catches
   `await using`, `await foreach` and awaits the analyzer would not flag), so those two numbers are
   an upper bound, which is the same direction the original "360+" phrasing pointed.
3. **"Mechanical and self-maintaining" conflated an enforced gate with an unenforced habit.** The
   gate is real and enforced: `warning` under `TreatWarningsAsErrors` (`true` at
   `MMCA.Common/Directory.Build.props:7`, with `CodeAnalysisTreatWarningsAsErrors` at `:13` and
   CA2007 absent from every `NoWarn` list) is a build error. The remediation command is not backed
   by any repo artifact: nothing in the repo invokes `dotnet format analyzers --diagnostics CA2007`,
   so the Rationale now presents it as guidance for a developer who trips the gate, not as tooling
   the build or CI runs.

## Revision (2026-08-14)
A re-measurement only. The policy, the gate and the exemption are unchanged; the counts the document
quotes were a week old and had moved by roughly 9%.

1. **Framework site counts, measured 2026-08-14.** `MMCA.Common/Source/**/*.cs` now holds 786
   `ConfigureAwait(false)` occurrences across 158 files, of which 93 sit inside the exempt UI
   packages (`MMCA.Common.UI` 49 across 15 files, `MMCA.Common.UI.Maui` 42 across 16 files,
   `MMCA.Common.UI.Web` 2 in 1 file), leaving 693 under the gate. The 2026-08-07 figures the previous
   revision recorded (719 / 147 files, 90 exempt, 629 gated) stay in that revision as the history of
   that measurement; the Trade-offs entry now carries today's numbers. "324 sites at adoption"
   remains the 2026-07-20 snapshot and is unchanged.
2. **Consumer-scale upper bound, measured 2026-08-14.** A raw `\bawait\b` scan gives 616 occurrences
   across 118 files in `MMCA.Store/Source/**/*.cs` and 1,380 across 259 files in
   `MMCA.ADC/Source/**/*.cs`, 1,996 combined, up from 593 / 1,175 on 2026-08-07 (ADC accounts for
   most of the growth, which is the conference feature work shipped that week). Raw `await` still
   overcounts CA2007 sites, so this is an upper bound and it points the same way the original "360+"
   phrasing did: only harder. The Rationale now names the pattern (`\bawait\b`) so the figure is
   reproducible rather than method-dependent.
3. **Everything else re-verified and unchanged.** The `[Source/**.cs]` gate at `warning`
   (`MMCA.Common/.editorconfig:828-829`) with the `[Source/Presentation/MMCA.Common.UI*/**.cs]`
   exemption at `none` (`:831-832`), the three packaged `MMCA.Common.UI*` projects (including
   `<PackageId>MMCA.Common.UI.Web</PackageId>` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:3` and
   `ServerTokenStorageService` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:18`),
   `TreatWarningsAsErrors` (`MMCA.Common/Directory.Build.props:7`) with
   `CodeAnalysisTreatWarningsAsErrors` at `:13` and CA2007 in no `NoWarn` list, and the absence of any
   repo artifact invoking `dotnet format analyzers --diagnostics CA2007` all still hold as written.

## Revision (2026-08-18)
A re-measurement only, in the same terms as the 2026-08-14 pass. The policy, the gate and the
exemption are unchanged; two of the three counted figures moved.

1. **Framework site counts, measured 2026-08-18.** `MMCA.Common/Source/**/*.cs` now holds 811
   `ConfigureAwait(false)` occurrences across 168 files, of which 93 sit inside the exempt UI
   packages (`MMCA.Common.UI` 49 across 15 files, `MMCA.Common.UI.Maui` 42 across 16 files,
   `MMCA.Common.UI.Web` 2 in 1 file), leaving 718 under the gate. The exempt split is unchanged from
   2026-08-14, so all 25 new occurrences (and all 10 new files) landed in gated code. The 2026-08-14
   figures (786 / 158 files, 93 exempt, 693 gated) and the 2026-08-07 figures (719 / 147 files,
   90 exempt, 629 gated) stay in their own revisions as the history of those measurements; the
   Trade-offs entry now carries today's numbers. "324 sites at adoption" remains the 2026-07-20
   snapshot and is unchanged.
2. **Consumer-scale upper bound, measured 2026-08-18.** A raw `\bawait\b` scan gives 616 occurrences
   across 118 files in `MMCA.Store/Source/**/*.cs` (identical to 2026-08-14: Store did not move) and
   1,386 across 261 files in `MMCA.ADC/Source/**/*.cs` (up from 1,380 across 259 files), 2,002
   combined. ADC again accounts for all of the growth. Raw `await` still overcounts CA2007 sites, so
   this stays an upper bound and it points the same way the original "360+" phrasing did.
3. **The gate, the exemption and the enforcement are re-verified as written.** The `[Source/**.cs]`
   gate at `warning` (`MMCA.Common/.editorconfig:828-829`), the
   `[Source/Presentation/MMCA.Common.UI*/**.cs]` exemption at `none` (`:831-832`), the three packaged
   `MMCA.Common.UI*` projects, and `TreatWarningsAsErrors` (`MMCA.Common/Directory.Build.props:7`)
   with `CodeAnalysisTreatWarningsAsErrors` at `:13`, all still hold. The statement that no repo
   artifact invokes `dotnet format analyzers --diagnostics CA2007` was not re-searched in this pass;
   it carries forward from the 2026-08-07 revision that established it.

## Revision (2026-08-23)
A re-measurement only, in the same terms as the 2026-08-18 pass. The policy, the gate and the
exemption are unchanged; both counted figures moved.

1. **Framework site counts, measured 2026-08-23.** `MMCA.Common/Source/**/*.cs` now holds 860
   `ConfigureAwait(false)` occurrences across 176 files, of which 93 sit inside the exempt UI
   packages (`MMCA.Common.UI` 49 across 15 files, `MMCA.Common.UI.Maui` 42 across 16 files,
   `MMCA.Common.UI.Web` 2 in 1 file), leaving 767 under the gate. The exempt split is unchanged from
   both 2026-08-14 and 2026-08-18, so all 49 new occurrences (and all 8 new files) landed in gated
   code, which is what a working gate looks like: every await added to packaged non-UI code in the
   last five days carries the call. The 2026-08-18 figures (811 / 168 files, 93 exempt, 718 gated),
   the 2026-08-14 figures (786 / 158 files, 93 exempt, 693 gated) and the 2026-08-07 figures
   (719 / 147 files, 90 exempt, 629 gated) stay in their own revisions as the history of those
   measurements; the Trade-offs entry now carries today's numbers. "324 sites at adoption" remains
   the 2026-07-20 snapshot and is unchanged.
2. **Consumer-scale upper bound, measured 2026-08-23.** A raw `\bawait\b` scan gives 617 occurrences
   across 119 files in `MMCA.Store/Source/**/*.cs` (up from 616 across 118 files: Store is
   effectively flat) and 1,462 across 272 files in `MMCA.ADC/Source/**/*.cs` (up from 1,386 across
   261 files), 2,079 combined. ADC again accounts for essentially all of the growth. Raw `await`
   still overcounts CA2007 sites, so this stays an upper bound and it points the same way the
   original "360+" phrasing did.
3. **The gate, the exemption and the enforcement are re-verified as written.** The `[Source/**.cs]`
   gate at `warning` (`MMCA.Common/.editorconfig:828-829`), the
   `[Source/Presentation/MMCA.Common.UI*/**.cs]` exemption at `none` (`:831-832`), the three packaged
   `MMCA.Common.UI*` projects (including `<PackageId>MMCA.Common.UI.Web</PackageId>` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:3` and
   `ServerTokenStorageService` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:18`),
   and `TreatWarningsAsErrors` (`MMCA.Common/Directory.Build.props:7`) with
   `CodeAnalysisTreatWarningsAsErrors` at `:13` and CA2007 in no `NoWarn` list, all still hold. The
   statement that no repo artifact invokes `dotnet format analyzers --diagnostics CA2007` was
   re-checked this pass against MMCA.Common's workflow files only (no match); the broader claim
   still rests on the 2026-08-07 revision that established it.

## Revision (2026-08-31)
A re-measurement plus a correction to two file anchors. The policy, the gate and the exemption are
unchanged. Every counted figure moved, two of the surrounding narratives did not survive the
re-measurement, and the `.editorconfig` line anchors this document has cited since 2026-08-07 shifted.

1. **Framework site counts, measured 2026-08-31.** `MMCA.Common/Source/**/*.cs` now holds 1,012
   `ConfigureAwait(false)` occurrences across 197 files, of which 102 sit inside the exempt UI
   packages across 35 files (`MMCA.Common.UI` 49 across 15 files, `MMCA.Common.UI.Maui` 51 across
   19 files, `MMCA.Common.UI.Web` 2 in 1 file), leaving 910 under the gate across 162 files. **The
   exempt split is no longer unchanged.** It held flat at 93 through 2026-08-14, 2026-08-18 and
   2026-08-23, and the earlier revisions read that as evidence that every new await landed in gated
   code; `MMCA.Common.UI.Maui` has since grown from 42 across 16 files to 51 across 19, so the
   "all new occurrences landed in gated code" reading does not carry forward to this window. The
   gate claim it was standing in for is unaffected: the exempt projects are exempt by design, and
   growth there is Blazor/MAUI components resuming on the renderer context, exactly what the
   exclusion is for. The 2026-08-23 figures (860 / 176 files, 93 exempt, 767 gated), the 2026-08-18
   figures (811 / 168 files, 93 exempt, 718 gated), the 2026-08-14 figures (786 / 158 files,
   93 exempt, 693 gated) and the 2026-08-07 figures (719 / 147 files, 90 exempt, 629 gated) stay in
   their own revisions as the history of those measurements; the Trade-offs entry now carries today's
   numbers. "324 sites at adoption" remains the 2026-07-20 snapshot and is unchanged.
2. **Consumer-scale upper bound, measured 2026-08-31, and it fell.** A raw `\bawait\b` scan gives
   569 occurrences across 102 files in `MMCA.Store/Source/**/*.cs` (down from 617 across 119 files)
   and 1,291 across 246 files in `MMCA.ADC/Source/**/*.cs` (down from 1,462 across 272 files), 1,860
   combined, down from 2,079. Both consumers shrank in this window, which is the first time either
   has: the work that landed in it collapses duplicated code paths and moves module CRUD onto the
   framework's generic write-side handlers, so it deletes application code rather than adding it.
   **The "the scale has only grown" and "ADC accounts for essentially all of the growth" framings
   are retired.** The figure is a snapshot of how much noise the rule would open in the apps, not a
   trend line, and the Rationale now reads that way. Raw `await` still overcounts CA2007 sites (it
   catches `await using`, `await foreach` and awaits the analyzer would not flag), so this stays an
   upper bound, and at 1,860 it points the same way the original "360+" phrasing did.
3. **The two `.editorconfig` anchors moved four lines down.** The gate header `[Source/**.cs]` is at
   `MMCA.Common/.editorconfig:832` with `dotnet_diagnostic.CA2007.severity = warning` at `:833`, and
   the `[Source/Presentation/MMCA.Common.UI*/**.cs]` exemption header is at `:835` with
   `dotnet_diagnostic.CA2007.severity = none` at `:836`. The shift is not a policy change: a comment
   block now occupies `:827-831` and states the rationale (packaged libraries must not capture the
   caller's context, UI packages excluded, apps keep the baseline) in the file itself. The
   `:828-829` and `:831-832` citations in the 2026-08-07, 2026-08-14, 2026-08-18 and 2026-08-23
   revisions were correct at those dates and are superseded by these.
4. **Everything else re-verified as written.** CA2007 appears in exactly three places in
   `MMCA.Common/.editorconfig`: the shared-baseline `none` at `:348`, the gate `warning` at `:833`
   and the UI exemption `none` at `:836`. No `Tests`-scoped override exists, so test code inherits
   the baseline `none`, as the Decision says. The other three repos keep the baseline untouched
   (`CA2007` at `:348`, `MA0004` at `:536`, `RCS1090` at `:635`, `VSTHRD111` at `:712`, all `none`
   in `MMCA.ADC/.editorconfig`, `MMCA.Store/.editorconfig` and `MMCA.Helpdesk/.editorconfig`
   alike), and the marked delta section that carries this policy names
   `Tools\Scripts\compare-analyzer-config.ps1` as its verifier at `MMCA.Common/.editorconfig:821-824`.
   The three packaged `MMCA.Common.UI*` projects still stand (including
   `<PackageId>MMCA.Common.UI.Web</PackageId>` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:3` and
   `ServerTokenStorageService` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:18`),
   as does the enforcement: `TreatWarningsAsErrors` at `MMCA.Common/Directory.Build.props:7`,
   `CodeAnalysisTreatWarningsAsErrors` at `:13`, and CA2007 absent from all three `NoWarn` lists
   (`:27`, `:32`, `:38`).
5. **The remediation command still has no repo artifact, now checked workspace-wide.** The
   2026-08-23 pass could only re-check MMCA.Common's workflow files and left the broader claim
   resting on 2026-08-07; this pass searched the whole workspace. Every `dotnet format analyzers`
   occurrence outside this ADR targets the using-ordering rules SA1210/SA1211 (for example
   `Website/docs-src/guides/common-GETTING-STARTED.md:156` and
   `MMCA.Helpdesk/build/templates/stage.ps1:1093`); nothing anywhere invokes it with
   `--diagnostics CA2007`. The Rationale's framing of the command as guidance for whoever trips the
   gate, not automation the repo runs, is confirmed without a hedge.

## Revision (2026-09-01)
A re-measurement only, in the same terms as the 2026-08-31 pass. The policy, the gate and the
exemption are unchanged, the `.editorconfig` anchors that shifted last pass are still where that
pass put them, and both counted figures moved by about one percent.

1. **Framework site counts, measured 2026-09-01.** `MMCA.Common/Source/**/*.cs` now holds 1,024
   `ConfigureAwait(false)` occurrences across 199 files, of which 102 sit inside the exempt UI
   packages across 35 files (`MMCA.Common.UI` 49 across 15 files, `MMCA.Common.UI.Maui` 51 across
   19 files, `MMCA.Common.UI.Web` 2 in 1 file), leaving 922 under the gate across 164 files. The
   exempt split is identical to 2026-08-31, so all 12 new occurrences and both new files landed in
   gated code. That is one observation over a one-day window, not the multi-day flat stretch the
   pre-2026-08-31 revisions over-read into a rule, and it is recorded as such. The 2026-08-31
   figures (1,012 / 197 files, 102 exempt, 910 gated), the 2026-08-23 figures (860 / 176 files,
   93 exempt, 767 gated), the 2026-08-18 figures (811 / 168 files, 93 exempt, 718 gated), the
   2026-08-14 figures (786 / 158 files, 93 exempt, 693 gated) and the 2026-08-07 figures
   (719 / 147 files, 90 exempt, 629 gated) stay in their own revisions as the history of those
   measurements; the Trade-offs entry now carries today's numbers. "324 sites at adoption" remains
   the 2026-07-20 snapshot and is unchanged.
2. **Consumer-scale upper bound, measured 2026-09-01.** A raw `\bawait\b` scan gives 570
   occurrences across 105 files in `MMCA.Store/Source/**/*.cs` (up from 569 across 102 files) and
   1,299 across 256 files in `MMCA.ADC/Source/**/*.cs` (up from 1,291 across 246 files), 1,869
   combined, up from 1,860. The one-window shrink recorded on 2026-08-31 did not continue, and both
   consumers are close to flat; consistent with that revision, the figure stays a snapshot of how
   much noise the rule would open in the apps rather than a trend line. One methodology note, in the
   spirit of the 2026-08-14 pass that named the pattern so the figure would be reproducible: these
   are occurrence counts, not counts of matching lines, and the two differ by exactly one, in ADC,
   where `SessionScoringProcessor` puts two awaits on a single line (`await using var claim = await
   ...` at
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/SessionScoringProcessor.cs:177`);
   a per-line scan reports 1,298 for ADC and 1,868 combined. Raw `await` still overcounts CA2007
   sites either way (it catches `await using`, `await foreach` and awaits the analyzer would not
   flag), so this remains an upper bound.
3. **The gate, the exemption and the enforcement are re-verified as written.** CA2007 appears in
   exactly three places in `MMCA.Common/.editorconfig`: the shared-baseline `none` at `:348`, the
   `[Source/**.cs]` gate header at `:832` with `dotnet_diagnostic.CA2007.severity = warning` at
   `:833`, and the `[Source/Presentation/MMCA.Common.UI*/**.cs]` exemption header at `:835` with
   `dotnet_diagnostic.CA2007.severity = none` at `:836`. The rationale comment block still occupies
   `:827-831` and the delta marker naming `Tools\Scripts\compare-analyzer-config.ps1` still sits at
   `:821-824`. No `Tests`-scoped override exists, so test code inherits the baseline `none`. The
   other three repos keep the baseline untouched (`CA2007` at `:348`, `MA0004` at `:536`, `RCS1090`
   at `:635`, `VSTHRD111` at `:712`, all `none` in `MMCA.ADC/.editorconfig`,
   `MMCA.Store/.editorconfig` and `MMCA.Helpdesk/.editorconfig` alike). The three packaged
   `MMCA.Common.UI*` projects still stand (including `<PackageId>MMCA.Common.UI.Web</PackageId>` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:3` and
   `ServerTokenStorageService` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:18`),
   as does the enforcement: `TreatWarningsAsErrors` at `MMCA.Common/Directory.Build.props:7`,
   `CodeAnalysisTreatWarningsAsErrors` at `:13`, and CA2007 absent from all three `NoWarn` lists
   (`:27`, `:32`, `:38`).
4. **The remediation command still has no repo artifact.** The workspace-wide search the 2026-08-31
   pass introduced was re-run: every `dotnet format analyzers` occurrence outside this ADR still
   targets the using-ordering rules SA1210/SA1211 (for example
   `Website/docs-src/guides/common-GETTING-STARTED.md:156` and
   `MMCA.Helpdesk/build/templates/stage.ps1:1093`), and nothing invokes it with
   `--diagnostics CA2007`.

## Revision (2026-09-03)
A re-measurement plus one anchor correction, in the same terms as the 2026-09-01 pass. The policy,
the gate and the exemption are unchanged, the `.editorconfig` anchors are still where the 2026-08-31
pass put them, and the counted figures moved by well under one percent.

1. **Framework site counts, measured 2026-09-03.** `MMCA.Common/Source/**/*.cs` now holds 1,030
   `ConfigureAwait(false)` occurrences across 200 files, of which 102 sit inside the exempt UI
   packages across 35 files (`MMCA.Common.UI` 49 across 15 files, `MMCA.Common.UI.Maui` 51 across
   19 files, `MMCA.Common.UI.Web` 2 in 1 file), leaving 928 under the gate across 165 files. The
   exempt split is identical to 2026-08-31 and 2026-09-01, so all 6 new occurrences and the single
   new file landed in gated code; as the previous pass recorded, that is one observation over a
   two-day window and not a rule. No line in `Source/` carries two `ConfigureAwait(false)` calls, so
   the occurrence count and the matching-line count are the same number here. The 2026-09-01 figures
   (1,024 / 199 files, 102 exempt, 922 gated), the 2026-08-31 figures (1,012 / 197 files,
   102 exempt, 910 gated), the 2026-08-23 figures (860 / 176 files, 93 exempt, 767 gated), the
   2026-08-18 figures (811 / 168 files, 93 exempt, 718 gated), the 2026-08-14 figures
   (786 / 158 files, 93 exempt, 693 gated) and the 2026-08-07 figures (719 / 147 files, 90 exempt,
   629 gated) stay in their own revisions as the history of those measurements; the Trade-offs entry
   now carries today's numbers. "324 sites at adoption" remains the 2026-07-20 snapshot and is
   unchanged.
2. **Consumer-scale upper bound, measured 2026-09-03.** A raw `\bawait\b` scan gives 570 occurrences
   across 105 files in `MMCA.Store/Source/**/*.cs` (identical to 2026-09-01: Store did not move) and
   1,298 across 255 files in `MMCA.ADC/Source/**/*.cs` (down from 1,299 across 256 files), 1,868
   combined. Consistent with 2026-08-31, the figure stays a snapshot of how much noise the rule would
   open in the apps rather than a trend line. The occurrence-versus-line note from 2026-09-01 still
   holds and still turns on one line: `SessionScoringProcessor` puts two awaits on a single line
   (`await using var claim = await ...`), so a per-line scan reports 1,297 for ADC and 1,867
   combined. That file moved with the folder reorganization and now sits at
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringProcessor.cs:177`;
   the `.../Conference.Infrastructure/Services/SessionScoringProcessor.cs:177` path the 2026-09-01
   revision cites was correct at that date and is superseded by this one. Raw `await` still
   overcounts CA2007 sites (it catches `await using`, `await foreach` and awaits the analyzer would
   not flag), so this remains an upper bound.
3. **The gate, the exemption and the enforcement are re-verified as written.** CA2007 appears in
   exactly three places in `MMCA.Common/.editorconfig`: the shared-baseline `none` at `:348`, the
   `[Source/**.cs]` gate header at `:832` with `dotnet_diagnostic.CA2007.severity = warning` at
   `:833`, and the `[Source/Presentation/MMCA.Common.UI*/**.cs]` exemption header at `:835` with
   `dotnet_diagnostic.CA2007.severity = none` at `:836`. The rationale comment block still occupies
   `:827-831` and the delta marker naming `Tools\Scripts\compare-analyzer-config.ps1` still sits at
   `:821-824`. No `Tests`-scoped override exists, so test code inherits the baseline `none`. The
   other three repos keep the baseline untouched (`CA2007` at `:348`, `MA0004` at `:536`, `RCS1090`
   at `:635`, `VSTHRD111` at `:712`, all `none` in `MMCA.ADC/.editorconfig`,
   `MMCA.Store/.editorconfig` and `MMCA.Helpdesk/.editorconfig` alike). The three packaged
   `MMCA.Common.UI*` projects still stand (including `<PackageId>MMCA.Common.UI.Web</PackageId>` at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:3`), as does the
   enforcement: `TreatWarningsAsErrors` at `MMCA.Common/Directory.Build.props:7`,
   `CodeAnalysisTreatWarningsAsErrors` at `:13`, and CA2007 absent from all three `NoWarn` lists
   (`:27`, `:32`, `:38`).
4. **The `ServerTokenStorageService` anchor was off by one and is corrected wherever it appears.**
   The declaration `public sealed class ServerTokenStorageService(` sits at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:18`;
   line 17 is the closing `/// </summary>` tag of its doc comment. The `:17` citation carried
   forward unchanged from the 2026-08-07 revision through every pass since, and now reads `:18` in
   all of them.
5. **The remediation command still has no repo artifact.** The workspace-wide search was re-run:
   every `dotnet format analyzers` occurrence outside this ADR targets the using-ordering rules
   SA1210/SA1211 (for example `Website/docs-src/guides/common-GETTING-STARTED.md:156` and
   `MMCA.Helpdesk/build/templates/stage.ps1:1093`), and nothing invokes it with
   `--diagnostics CA2007`.

## Revision (2026-09-11)
A re-measurement plus one anchor correction, in the same terms as the 2026-09-03 pass. The policy,
the gate and the exemption are unchanged and the `.editorconfig` anchors are still where the
2026-08-31 pass put them, but every counted figure moved well past the sub-one-percent drift the
last two passes recorded.

1. **Framework site counts, measured 2026-09-11.** `MMCA.Common/Source/**/*.cs` now holds 1,169
   `ConfigureAwait(false)` occurrences across 231 files, of which 110 sit inside the exempt UI
   packages across 37 files (`MMCA.Common.UI` 56 across 17 files, `MMCA.Common.UI.Maui` 52 across
   19 files, `MMCA.Common.UI.Web` 2 in 1 file), leaving 1,059 under the gate across 194 files. The
   exempt split, identical from 2026-08-31 through 2026-09-03, moved this time: `MMCA.Common.UI`
   gained 7 occurrences and 2 files and `MMCA.Common.UI.Maui` gained 1 occurrence, so growth is no
   longer confined to gated code. No line in `Source/` carries two `ConfigureAwait(false)` calls, so
   the occurrence count and the matching-line count are the same number here (1,169 both ways). The
   2026-09-03 figures (1,030 / 200 files, 102 exempt, 928 gated) and every earlier set stay in their
   own revisions as the history of those measurements; the Trade-offs entry now carries today's
   numbers. "324 sites at adoption" remains the 2026-07-20 snapshot and is unchanged.
2. **Consumer-scale upper bound, measured 2026-09-11.** A raw `\bawait\b` scan gives 781 occurrences
   across 144 files in `MMCA.Store/Source/**/*.cs` (up from 570 across 105 files) and 1,359 across
   264 files in `MMCA.ADC/Source/**/*.cs` (up from 1,298 across 255 files), 2,140 combined. The Store
   move is the largest this ADR has recorded. The gRPC service hosts under `MMCA.Store/Source/Services`
   (`MMCA.Store.Catalog.Service`, `MMCA.Store.Identity.Service`, `MMCA.Store.Sales.Service` and their
   `Contracts` projects) account for only 24 of those occurrences across 11 files, so the bulk of the
   growth sits in existing module code. Consistent with every pass since 2026-08-31, the figure stays
   a snapshot of how much noise the rule would open in the apps rather than a trend line. Raw `await`
   still overcounts CA2007 sites (it catches `await using`, `await foreach` and awaits the analyzer
   would not flag), so this remains an upper bound.
3. **The occurrence-versus-line delta now turns on two lines, and `SessionScoringProcessor` is gone.**
   The file cited by the 2026-09-01 and 2026-09-03 revisions
   (`.../Conference.Infrastructure/Sessions/Scoring/SessionScoringProcessor.cs:177`) no longer exists
   anywhere under `MMCA.ADC/Source`; the work moved into Application-layer handlers. The
   `await using var claim = await ...` pattern now sits on exactly two lines,
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommandHandler.cs:75`
   and
   `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:147`,
   so a per-line scan reports 1,357 for ADC and 2,138 combined. `MMCA.Store/Source` carries no
   double-await line, so its 781 occurrences and 781 matching lines are the same number.
4. **The gate, the exemption and the enforcement are re-verified as written.** CA2007 appears in
   exactly three places in `MMCA.Common/.editorconfig`: the shared-baseline `none` at `:348`, the
   `[Source/**.cs]` gate header at `:832` with `dotnet_diagnostic.CA2007.severity = warning` at
   `:833`, and the `[Source/Presentation/MMCA.Common.UI*/**.cs]` exemption header at `:835` with
   `dotnet_diagnostic.CA2007.severity = none` at `:836`. The rationale comment block still occupies
   `:827-831` and the delta marker naming `Tools\Scripts\compare-analyzer-config.ps1` still sits at
   `:821-824`. No `Tests`-scoped override exists, so test code inherits the baseline `none`. The
   packaged `MMCA.Common.UI*` projects still stand (including the `<PackageId>MMCA.Common.UI.Web</PackageId>`
   at `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:3`), as does the
   enforcement: `TreatWarningsAsErrors` at `MMCA.Common/Directory.Build.props:7`,
   `CodeAnalysisTreatWarningsAsErrors` at `:13`, and CA2007 absent from all three `NoWarn` lists
   (`:27`, `:32`, `:38`).
5. **The remediation command still has no repo artifact, and its two example anchors have shifted.**
   A workspace-wide search finds `dotnet format analyzers ... --diagnostics CA2007` nowhere outside
   this ADR. Every other `dotnet format analyzers` occurrence targets the using-ordering rules
   SA1210/SA1211, and the two examples earlier revisions cite now sit at
   `Website/docs-src/guides/common-GETTING-STARTED.md:162` and
   `MMCA.Helpdesk/build/templates/stage.ps1:1235`; the `:156` and `:1093` citations in the revisions
   above were correct at their dates and are superseded by these.

## Revision (2026-09-19)
A re-measurement in the same terms as the 2026-09-11 pass, covering the two counted figures that
move (framework sites and the consumer-scale upper bound) and the occurrence-versus-line delta that
depends on them. The policy, the gate and the exemption are unchanged.

1. **Framework site counts, measured 2026-09-19.** `MMCA.Common/Source/**/*.cs` now holds 1,186
   `ConfigureAwait(false)` occurrences across 232 files, of which 110 sit inside the exempt UI
   packages across 37 files (`MMCA.Common.UI` 56 across 17 files, `MMCA.Common.UI.Maui` 52 across
   19 files, `MMCA.Common.UI.Web` 2 in 1 file), leaving 1,076 under the gate across 195 files. The
   exempt split is identical to the 2026-09-11 split, so all 17 new occurrences and the one new file
   are gated code and growth is back inside the gate. No line in `Source/` carries two
   `ConfigureAwait(false)` calls, so the occurrence count and the matching-line count are still the
   same number (1,186 both ways). The 2026-09-11 figures (1,169 / 231 files, 110 exempt, 1,059
   gated) and every earlier set stay in their own revisions as the history of those measurements;
   the Trade-offs entry now carries today's numbers. "324 sites at adoption" remains the 2026-07-20
   snapshot and is unchanged.
2. **Consumer-scale upper bound, measured 2026-09-19.** A raw `\bawait\b` scan gives 779 occurrences
   across 143 files in `MMCA.Store/Source/**/*.cs` (down from 781 across 144 files) and 1,453 across
   281 files in `MMCA.ADC/Source/**/*.cs` (up from 1,359 across 264 files), 2,232 combined. ADC
   carries all of the growth this pass; Store gave back two occurrences and one file after the large
   move the 2026-09-11 pass recorded. The scan is scoped to `*.cs`, as this figure has been since
   adoption: `.razor` files would add 9 occurrences across 2 files in Store and 27 across 10 files in
   ADC and are deliberately outside it. Raw `await` still overcounts CA2007 sites (it catches
   `await using`, `await foreach` and awaits the analyzer would not flag), so this remains an upper
   bound and a snapshot of how much noise the rule would open in the apps rather than a trend line.
3. **The occurrence-versus-line delta still turns on the same two lines.** The
   `await using var claim = await ...` pattern sits on exactly two lines under `MMCA.ADC/Source`,
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommandHandler.cs:75`
   and
   `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:147`,
   both unmoved from the 2026-09-11 pass, so a per-line scan reports 1,451 for ADC and 2,230
   combined. `MMCA.Store/Source` carries no double-await line, so its 779 occurrences and 779
   matching lines are the same number.

## Revision (2026-10-01)
A count and anchor refresh only. No decision or rationale changed: the policy, the gate
(`MMCA.Common/.editorconfig:833`) and the UI exemption (`:836`) stand as written. The Rationale and
Trade-offs figures are refreshed to the measurements below; the earlier revisions keep theirs as
history. Framework counts are taken at MMCA.Common `main` `eeb87e6c`; Store counts at
`origin/main` `53acbe40`.

1. **Framework site counts.** `MMCA.Common/Source/**/*.cs` holds 1,234 `ConfigureAwait(false)`
   occurrences across 242 files (1,234 matching lines, so no line carries two), of which 119 sit
   inside the exempt UI packages across 39 files (`MMCA.Common.UI` 63 across 19 files,
   `MMCA.Common.UI.Maui` 54 across 19 files, `MMCA.Common.UI.Web` 2 in 1 file), leaving 1,115 under
   the gate across 203 files. The exempt split moved (`MMCA.Common.UI` gained 7 occurrences and 2
   files, `MMCA.Common.UI.Maui` 2 occurrences), so growth is not confined to gated code this window.
2. **Consumer-scale upper bound.** A raw `\bawait\b` scan gives 793 occurrences across 152 files in
   `MMCA.Store/Source/**/*.cs` and 1,490 across 291 files in `MMCA.ADC/Source/**/*.cs`, 2,283
   combined. `.razor` files, still outside the scan, would add 9 occurrences across 2 files in Store
   and 23 across 9 files in ADC.
3. **The occurrence-versus-line delta still turns on two lines.** The
   `await using var claim = await ...` pattern sits at
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommandHandler.cs:78`
   (previously `:75`) and
   `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:147`,
   so a per-line scan reports 1,488 for ADC and 2,281 combined. Store carries no double-await line
   (793 both ways).
4. **The remediation examples moved.** The two `dotnet format analyzers` examples that target
   SA1210/SA1211 now sit at `Website/docs-src/guides/common-GETTING-STARTED.md:186` and
   `MMCA.Helpdesk/build/templates/stage.ps1:1236`, superseding the `:162` and `:1235` citations in
   the 2026-09-11 revision.

## Revision (2026-10-06)
A content correction plus a count and anchor refresh. The gate (`MMCA.Common/.editorconfig:832-833`)
and the UI exemption (`:835-836`) are unchanged; two statements about them were not accurate.

1. **The UI exemption is not "the call would be a bug" everywhere.** The exempt packages now hold
   154 `ConfigureAwait(false)` calls across 43 files: `MMCA.Common.UI` 76 across 20 files,
   `MMCA.Common.UI.Maui` 54 across 19, `MMCA.Common.UI.Web` 24 across 4
   (`SameOriginProxy/SameOriginApiProxyEndpoint.cs` 15, `SameOriginProxy/SameOriginProxyTransformer.cs` 5,
   `Services/ServerTokenStorageService.cs` 3, `SameOriginProxy/SessionHandoffEndpoints.cs` 1). Even
   `ServerTokenStorageService`, which earlier revisions cite as the exemplar of circuit-bound code
   (its declaration is now at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:30`),
   calls it at `:99`, `:155` and `:161`. The Decision now describes the exemption as leaving the rule
   unenforced in mixed UI-package code, and the 2026-08-31 reading that exempt-package growth "is
   Blazor/MAUI components resuming on the renderer context" does not hold.
2. **The drift script does not guard this policy.** `Tools/Scripts/compare-analyzer-config.ps1`
   diffs only the lines before the `# REPO-SPECIFIC DELTAS` marker (`:26-28`), so it guards the
   shared baseline, not the repo-delta section holding the gate. The Trade-offs entry now says so.
   The marker comment at `MMCA.Common/.editorconfig:821-824` describes the script accurately.
3. **Framework site counts.** `MMCA.Common/Source/**/*.cs` holds 1,302 `ConfigureAwait(false)`
   occurrences across 249 files (no line carries two), 154 of them exempt across 43 files, leaving
   1,148 under the gate across 206 files.
4. **Consumer-scale upper bound.** A raw `\bawait\b` scan of `*.cs` gives 815 occurrences across 154
   files in `MMCA.Store/Source` and 1,540 across 301 files in `MMCA.ADC/Source`, 2,355 combined.
   The two `await using var claim = await ...` lines are still the only double-await lines,
   `ScoreEventSessionsInternalCommandHandler.cs:83` (previously `:78`) and
   `SubmitQuestionHandler.cs:147`, so a per-line scan reports 1,538 for ADC and 2,353 combined;
   Store has none.
5. **Anchors re-verified against current source.** `TreatWarningsAsErrors` at
   `MMCA.Common/Directory.Build.props:7` and `CodeAnalysisTreatWarningsAsErrors` at `:13` hold, and
   the three `NoWarn` lists now sit at `:30`, `:35` and `:41`, none naming CA2007. The SA1210/SA1211
   remediation examples sit at `Website/docs-src/guides/common-GETTING-STARTED.md:190` and
   `MMCA.Helpdesk/build/templates/stage.ps1:1236`; nothing invokes `--diagnostics CA2007`.

## Revision (2026-10-07)
Re-verified against current source. The policy, the gate and the UI exemption are unchanged, and the
framework site counts in the Trade-offs entry were not re-measured this pass. What moved is the
consumer-scale figure, which grew with new ADC code, and the `.editorconfig` anchors.

1. **The consumer-scale figure is re-measured.** ADC grew by four `await` lines since the 2026-10-06
   pass (1,538 matching lines then, 1,542 now, still across 301 files), so its occurrence count moves
   from 1,540 to 1,544. A per-file line count understates occurrences only where a line holds two
   tokens: `SubmitQuestionHandler.cs` reports 9 lines but holds 10 `await` tokens. Measured
   2026-10-07, a raw `\bawait\b` scan of
   `*.cs` gives 1,542 matching lines across 301 files in `MMCA.ADC/Source` and 815 across 154 files
   in `MMCA.Store/Source`. The only double-await lines are still the two
   `await using var claim = await distributedLock` lines,
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommandHandler.cs:83`
   and
   `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:147`,
   so ADC holds 1,544 occurrences and the combined figure is 2,359 occurrences (2,357 matching
   lines). Store has no double-await line, so its 815 is the same both ways. The Rationale now
   carries the occurrence figures. Raw `await` still overcounts CA2007 sites, so this remains an
   upper bound.
2. **Anchors re-verified against current source:** the `MMCA.Common/.editorconfig` rationale comment
   block grew to `:827-833`, moving the `[Source/**.cs]` gate to `:834-835` and the
   `[Source/Presentation/MMCA.Common.UI*/**.cs]` exemption to `:837-838` (previously `:832-833` and
   `:835-836`), so the repo-delta section now spans `:821-838`; the shared-baseline `CA2007` `none`
   stays at `:348` and the marker naming `Tools\Scripts\compare-analyzer-config.ps1` at `:821-824`.
   `Tools/Scripts/compare-analyzer-config.ps1:26-28` still slices only the lines before the marker.
   `TreatWarningsAsErrors` at `MMCA.Common/Directory.Build.props:7`,
   `CodeAnalysisTreatWarningsAsErrors` at `:13`, and the three `NoWarn` lists at `:30`, `:35` and
   `:41` (none naming CA2007) hold.
