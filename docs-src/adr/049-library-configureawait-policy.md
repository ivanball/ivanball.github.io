# ADR-049: Library-Scoped ConfigureAwait(false) Policy (CA2007)

## Status
Accepted (2026-07-20; measurements re-anchored 2026-08-07, 2026-08-14, 2026-08-18, 2026-08-23,
2026-08-31 and 2026-09-01).

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
  (the MAUI capability adapters). Their continuations must resume on the renderer/UI context;
  `ConfigureAwait(false)` there would be a bug, not hygiene.
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
  far past that: a raw `\bawait\b` scan on 2026-09-01 counts 570 occurrences in `MMCA.Store/Source`
  and 1,299 in `MMCA.ADC/Source`, 1,869 combined, which is the upper bound on the CA2007 sites the
  rule would open there).
- **Mechanical, with the enforcement and the remediation at different levels.** The build gate is the
  enforced half: a new context-capturing await in packaged non-UI code fails the build, so it costs no
  review effort. The remediation is a convention rather than an artifact: `dotnet format analyzers
  --diagnostics CA2007` fixes a batch in place, but no script, CI step or `CONTRIBUTING.md` entry
  invokes it, so it is guidance for whoever trips the gate and not automation the repo runs.

## Trade-offs
- **Visual noise in framework source.** Every await in `Source/` (except UI packages) carries
  `.ConfigureAwait(false)` (324 sites at adoption; 922 gated sites as of the 2026-09-01 snapshot, out
  of 1,024 across `Source/` once the exempt UI packages are counted back in). The gate makes it
  uniform, so the noise is consistent rather than sporadic.
- **A per-repo delta in an otherwise shared analyzer baseline.** The workspace keeps one
  byte-identical `.editorconfig` baseline across the four repos; this policy lives in the marked
  repo-delta section of MMCA.Common's file and is verified by the workspace drift script
  (`Tools\Scripts\compare-analyzer-config.ps1`), so the divergence is documented and guarded.
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
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17`),
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
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17`),
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
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17`),
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
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17`),
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
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17`),
   as does the enforcement: `TreatWarningsAsErrors` at `MMCA.Common/Directory.Build.props:7`,
   `CodeAnalysisTreatWarningsAsErrors` at `:13`, and CA2007 absent from all three `NoWarn` lists
   (`:27`, `:32`, `:38`).
4. **The remediation command still has no repo artifact.** The workspace-wide search the 2026-08-31
   pass introduced was re-run: every `dotnet format analyzers` occurrence outside this ADR still
   targets the using-ordering rules SA1210/SA1211 (for example
   `Website/docs-src/guides/common-GETTING-STARTED.md:156` and
   `MMCA.Helpdesk/build/templates/stage.ps1:1093`), and nothing invokes it with
   `--diagnostics CA2007`.
