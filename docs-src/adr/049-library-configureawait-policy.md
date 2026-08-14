# ADR-049: Library-Scoped ConfigureAwait(false) Policy (CA2007)

## Status
Accepted (2026-07-20; measurements re-anchored 2026-08-07 and 2026-08-14).

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
  360+ sites of pure noise (measured across Store/ADC before this decision, and the scale has only
  grown: a raw `\bawait\b` scan on 2026-08-14 counts 616 occurrences in `MMCA.Store/Source` and 1,380
  in `MMCA.ADC/Source`, 1,996 combined, which is the upper bound on the CA2007 sites the rule would
  open there).
- **Mechanical, with the enforcement and the remediation at different levels.** The build gate is the
  enforced half: a new context-capturing await in packaged non-UI code fails the build, so it costs no
  review effort. The remediation is a convention rather than an artifact: `dotnet format analyzers
  --diagnostics CA2007` fixes a batch in place, but no script, CI step or `CONTRIBUTING.md` entry
  invokes it, so it is guidance for whoever trips the gate and not automation the repo runs.

## Trade-offs
- **Visual noise in framework source.** Every await in `Source/` (except UI packages) carries
  `.ConfigureAwait(false)` (324 sites at adoption; 693 gated sites as of the 2026-08-14 snapshot, out
  of 786 across `Source/` once the exempt UI packages are counted back in). The gate makes it uniform,
  so the noise is consistent rather than sporadic.
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
