# ADR-065: Scaffolding templates derived from the reference app

**Status:** Accepted (2026-08-02)

## Context

[Getting Started](../guides/common-GETTING-STARTED.md) is accurate and complete, and phases 1 through
6 of it are transcription work. Its own instruction for the load-bearing parts is "copy
`MMCA.Helpdesk/Directory.Build.props`", "copy MMCA.ADC's `.editorconfig` verbatim", "copy the
relevant rows from MMCA.ADC/Directory.Packages.props".

Measured against MMCA.Helpdesk, the deliberately minimal seed, a brand-new app on the framework
starts by hand-creating **12 projects, around 85 files, and roughly 5,300 lines** before a line of
its own business logic: an 823-line `.editorconfig`, a 127-line `Directory.Packages.props` carrying
114 pins, a 75-line `Directory.Build.props`, the 75-line local-source swap in
`Directory.Build.targets`, the module project set, the vertical slice, the migrations project and
its design-time factory, two hosts, the Aspire AppHost, six `.resx` pairs, and the architecture map
with its fitness subclasses.

Several of those lines are load-bearing and quiet about it. `AddApplicationDecorators()` must be the
last DI call. The AppHost must `WaitFor` the SQL server and not the database resource. A missing
AppHost `launchSettings.json` presents as a hang. A module absent from `IArchitectureMap` silently
stops being covered by the layering and isolation rules (ADR-015).

The framework is published credential-free on nuget.org (ADR-053), so the distance between "read the
guide" and "have a green solution" is now the adoption bottleneck rather than access.

## Decision

Ship a `dotnet new` template pack, **`MMCA.Templates`**, containing four templates:

| Short name | Generates |
|---|---|
| `mmca-app` | the whole solution: build plumbing, one module across five layers, both hosts, the AppHost, migrations, and the test projects |
| `mmca-module` | a new business module: five layer projects, both test projects, a migrations project |
| `mmca-command` | one write-side vertical slice (command record + handler) |
| `mmca-query` | one read-side vertical slice (cacheable query record + handler) |

**The template content is the MMCA.Helpdesk reference application itself, staged at pack time.**
`.template.config/` lives at that repo's root; `build/templates/stage.ps1` copies the tree, drops
the files belonging to the seed's own repo rather than to a generated app, and lays a small overlay
on top. No copy of the solution exists anywhere else. Everything else (renaming `MMCA.Helpdesk` to
the adopter's name, `Tickets` to their module, `Ticket` to their aggregate) is `dotnet new` doing
symbol replacement at instantiation.

The pack is published from MMCA.Helpdesk on a `templates-vX.Y.Z` tag, under its own nuget.org
trusted-publishing policy.

**Two things the scaffold deliberately does not hand over**, because a rename invalidates them and
no fixed value is correct for every generated name:

- **Using-directive order.** An app namespace sorts above `MMCA.Common.*` for `Contoso.Support` and
  below it for `Zeta.App`. `SA1210` has no notion of blank-line-separated groups, so no checked-in
  order survives both. Staging appends a scoped `SA1210 = suggestion` delta to the **staged**
  `.editorconfig`; the seed's own copy, which is the shared analyzer baseline that
  `Tools/Scripts/compare-analyzer-config.ps1` holds identical across the four repos, is untouched.
  The other 213 severities stay at error, and the generated README carries the
  `dotnet format analyzers --diagnostics SA1210` command that restores full strictness.
- **The `IntegrationEventContractTests` subclass.** `IntegrationEventContractTestsBase` compares a
  checked-in literal against the actual events with members sorted alphabetically, so
  `{ RequesterUserId, TicketId }` is right for `Ticket` and wrong for `Invoice`. The subclass is
  removed at stage time (deleted, not commented out: `S125` is a warning and `TreatWarningsAsErrors`
  makes that a build error), and the generated README carries the class to paste plus the command
  that prints the value to freeze.

`mmca-module` additionally prints five wire-ups `dotnet new` cannot perform: the solution entries,
the host and architecture-test project references, the identifier-alias `<Compile Include ... Link>`
block, the five `IArchitectureMap` lines, and the host's `AddErrorResources<>` call.

**The correctness gate is a `template-smoke` CI job in MMCA.Helpdesk**, not the seed's own build. The
seed builds in local-source mode against `MMCA.Common@main`; a generated app builds in package mode
against a released version, and a source-mode build can pass where package-mode Release fails on an
analyzer. The smoke generates two solutions whose names share no substring with the seed, sweeps for
residual `Helpdesk` / `Ticket` tokens, builds package-mode, runs the tests, then generates a module
and applies all five printed wire-ups.

## Rationale

**Deriving from the seed rather than maintaining a template tree** is the whole design. A
hand-maintained copy of a 12-project solution drifts within one release, and drift in a scaffold is
invisible until an adopter's first build fails. Because the seed is the template, the app whose CI
keeps it green is exactly what adopters receive.

**A template pack rather than a workspace script.** A PowerShell generator under `Tools/` would have
been faster to write and is useless to anyone outside this workspace. The framework is public and
credential-free; `dotnet new install MMCA.Templates` is the install path an outside adopter expects.

**Named `MMCA.Templates`, not `MMCA.Common.Templates`.** The `MMCA.Common.*` names carry the ADR-016
lockstep-versioning contract and ship from the MMCA.Common repo under its own trusted-publishing
policy. This package ships from a different repo on a different cadence and pins the framework
version as a `--framework-version` parameter instead. Keeping it outside that family also leaves
`FACTS.md`'s package count at 15, since its generator counts only packable projects under
`MMCA.Common/Source/`, so the CI drift gate is unaffected.

**The token sweep is in the gate on purpose.** `sourceName` and the symbol replacements run as
separate passes, so a token that only ever appears nested inside another (`Ticket` inside `Tickets`,
`Helpdesk` inside `MMCA.Helpdesk`) is precisely where a rename half-applies, and it half-applies
silently: the output still compiles, it just carries someone else's domain vocabulary.

## Trade-offs

- **Two documented one-time fixups** in every generated app, above. The alternative to the `SA1210`
  delta was moving every app-local `using` into per-project global usings, which is not rename-stable
  either once a project's usings span more than one second-level segment, and which costs the seed
  the didactic value of showing where each type comes from.
- **`mmca-module` cannot finish the job.** Five edits stay manual because `dotnet new` cannot patch
  existing files. They are printed as post-action instructions and applied by the smoke job, so they
  cannot silently go stale, but a new module is not usable until a human makes them.
- **The template lags a framework release by one step.** `--framework-version` defaults to whatever
  the seed pins, so a `MMCA.Common` release needs the seed bumped and the pack re-tagged before the
  default is current. Adopters can pass the flag in the meantime.
- **`release-templates.yml`'s filename is load-bearing.** Trusted publishing is keyless OIDC pinned
  to owner, repository, and workflow filename, with no API-key fallback, so renaming that file
  breaks publishing silently. Same property as the MMCA.Common release workflow (ADR-053).
- **The generated app's first test run is 90 tests, not 91**, and its fitness subclass count is one
  below the seed's, until the adopter freezes their own wire contract.
