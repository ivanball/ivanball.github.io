# ADR-109: Feature-by-Folder Layout as an Enforced Convention

## Status
Accepted (2026-09-03).

## Context
The rubric's section 5 asks that "code is organized by feature/capability, so a change touches one
cohesive slice", with features "grouped by use case ..., not by horizontal technical folders"
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:195`, `:197`, `:200`). ADR-015
already gates the *contents* of a slice: `SliceCohesionTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/SliceCohesionTestsBase.cs`)
fails a build when a handler is stranded from its command or query contract.

Nothing gated the *shape of the tree* until 2026-09-02, when a folder-width fitness function and a
repo-wide reorganization shipped together (`MMCA.Common/CHANGELOG.md:88-93`, `:123-127`). That
reorganization, and a second pass the next day (`:29-37`), were both marked **Breaking**, because in
this workspace namespaces follow folders: moving a file renames a namespace, and a namespace is
public API on a package family released in lockstep (ADR-016). Two of the last three MMCA.Common
releases were therefore layout releases, and they are what forced `UPGRADING.md` into existence
(`MMCA.Common/CHANGELOG.md:78-79`).

The convention itself is written down only in the workspace `CLAUDE.md` and in the rubric text
above. The bill it produces (public namespace renames, a scripted consumer sweep, an UPGRADING
protocol, and doc citations that rot underneath it) is recorded nowhere as a decision. This record
states it.

## Decision
**Folder structure is a governed architectural property, not a matter of taste: an aggregate or
feature names a folder, a folder holds at most twelve direct code files, namespaces follow folders,
and a layout change ships as a breaking release with a migration map.**

1. **The aggregate names the first folder level in Domain, Application and Shared.** MMCA.ADC's
   Conference module carries `Activities`, `Categories`, `Events`, `Questions`, `Sessions`,
   `Speakers` and `Sponsors` directly under
   `Source/Modules/Conference/MMCA.ADC.Conference.Domain/`, and the same names under
   `.Application/` and `.Shared/`. MMCA.Helpdesk's single-module seed shows the minimal case: one
   `Tickets` folder under `Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/`, `.Application/`
   and `.Shared/`.

2. **In UI, API and Infrastructure the first level is a technical root and the aggregate sits
   beneath it.** The roots in use are `Pages/`, `Services/` and `Components/`
   (`MMCA.ADC.Conference.UI/`), `Controllers/` (`MMCA.ADC.Conference.API/`) and `Persistence/`
   (`MMCA.ADC.Conference.Infrastructure/`), with the aggregate folders one level down:
   `UI/Pages/Speakers`, `UI/Services/Speakers`, `API/Controllers/Speakers`,
   `Infrastructure/Persistence/EntityConfiguration/Speakers`.

3. **The aggregate carries the same plural name in every project of the module.** `Speakers` appears
   in the Conference module's Domain, Application, Shared, `UI/Pages`, `UI/Services`,
   `API/Controllers` and `Infrastructure/Persistence/EntityConfiguration` trees, so a reader who
   knows the aggregate knows the path in every layer.

4. **No folder holds more than twelve direct code files.** `FolderWidthTestsBase.MaxDirectFiles`
   defaults to 12
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/FolderWidthTestsBase.cs:23`,
   test method at `:31-33`) and the rule body is
   `ArchitectureRules.FoldersStayNarrow(repoRoot, maxDirectFiles, exemptFolderSuffixes)`
   (`Rules/Governance/ArchitectureRules.FolderWidth.cs:34`), whose failure message tells the author
   to "split it by feature or aggregate" (`:69-70`). It walks the filesystem rather than IL,
   "because the defect is a layout one" (`:9-11`), over both the `Source/` and `Tests/` trees
   (`:42`).

5. **The counting rules are part of the decision.** Only files directly in a folder count
   (`:91`, `:98`). A `.razor` component counts once and its co-located `X.razor.cs` counts with it
   (`:105-120`, the pairing at `:117-119`); a `.resx` never counts, since only `.razor` and `.cs`
   files are code units (`:107-112`); generated files (`*.g.cs`, `*.generated.cs`, `*.Designer.cs`)
   never count (`:123-126`). Whole trees whose shape nobody chose are skipped by path segment:
   `bin`, `obj`, `Migrations`, `Platforms`, `Resources`, `node_modules`, `wwwroot` and `.git`
   (`:78-82`).

6. **All four repos run the gate, and every exemption is code.** `FolderWidthTests` subclasses the
   base in MMCA.Common
   (`Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/FolderWidthTests.cs:18`), MMCA.ADC
   (`Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/FolderWidthTests.cs:10`), MMCA.Store
   (`Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/FolderWidthTests.cs:9`) and
   MMCA.Helpdesk (`Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/FolderWidthTests.cs:8`), each
   supplying only its `RepoRoot`. Only MMCA.Common overrides `ExemptFolderSuffixes`, with three
   one-concept folders: `MMCA.Common.Application/UseCases/Decorators`, its test twin, and
   `MMCA.Common.Domain/Interfaces` (`FolderWidthTests.cs:28-33`). ADC, Store and Helpdesk run
   against the empty default (`FolderWidthTestsBase.cs:29`). The base is public API and is baselined
   under the ADR-015 gate (`Testing.Architecture/PublicAPI.Unshipped.txt:94-100`).

7. **Namespaces follow folders, so a folder move is a compile error until every namespace moves with
   it.** The shared analyzer baseline sets `dotnet_style_namespace_match_folder = true:warning`
   (`MMCA.Common/.editorconfig:90`) and `TreatWarningsAsErrors` is on repo-wide
   (`MMCA.Common/Directory.Build.props:7`), so IDE0130 fails the build. The exceptions are named per
   path: six in MMCA.Common for the flat public surfaces consumers subclass and two Aspire extension
   folders (`.editorconfig:858-866` for the reasons, globs at `:867`, `:870`, `:873`, `:876`,
   `:879`, `:882`), and one each in ADC and Store for the MAUI head's per-TFM `Platforms/` bootstrap
   files (`MMCA.ADC/.editorconfig:848-857`, `MMCA.Store/.editorconfig:837-846`).

8. **A folder inside a module project is never named `Domain`, `Application`, `Infrastructure`,
   `API` or `UI`.** `ModuleNameConventions.GetModuleName` derives the owning module from the
   namespace, taking the segment before the first layer segment
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:38-51`):
   `Domain` matches at any index from 1 up (`:41-43`) and the other four match only at index 3 or
   later (`:17`, `:48-50`). A sub-folder carrying one of those names therefore shifts the derived
   module. That name is load-bearing: it is the SQL Server schema
   (`Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:66`),
   the Cosmos container (`:87`), the logical data-source name for unit-of-work routing
   (`Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:181`) and the module tag on
   every CQRS log line (`Application/UseCases/Decorators/LoggingCommandDecorator.cs:77`,
   `LoggingQueryDecorator.cs:75`). The derivation is locked by
   `Tests/Core/MMCA.Common.Shared.Tests/Conventions/ModuleNameConventionsTests.cs`. This half of the
   convention is enforced by review only: no fitness rule checks folder names.

9. **The move is scripted, not hand-edited.** `Tools/Scripts/move-namespace.ps1` rewrites namespaces
   and usings repo-wide and across the consumers, and `Tools/Scripts/auto-add-usings.py` plus
   `Tools/Scripts/fix-build-usings.py` settle the usings the compiler then reports. The framework's
   own changelog names the script as the consumer sweep (`MMCA.Common/CHANGELOG.md:34-36`,
   `:92-93`).

10. **A layout change ships as a breaking minor release with an old-to-new map.** v1.183.0 dissolved
    `MMCA.Common.Infrastructure.Services` and `.Settings` into the features they implement and split
    the UI capability, service and component grab-bags (`CHANGELOG.md:88-114`), and added the
    folder-width rule (`:123-127`). v1.184.0 split the eight remaining flat public namespaces
    (`:29-37`, `:41-74`) and added `UPGRADING.md` (`:78-79`). There is no dual-namespace grace
    release and no `[Obsolete]` shim, because C# cannot forward a type across namespaces inside one
    assembly (`MMCA.Common/UPGRADING.md:9-11`); the first-party consumers are swept in the same
    release (`UPGRADING.md:34-36`).

## Rationale
- **A wide folder has stopped naming a feature.** The rule's own statement of intent is that a
  folder "that accumulates dozens of direct code files has stopped naming a feature and started
  naming a technical bucket, which is exactly the horizontal layout vertical slicing exists to
  avoid" (`ArchitectureRules.FolderWidth.cs:6-9`). A count is a cheap proxy that a reviewer will not
  forget to apply.
- **Filesystem checks are cheap and exact.** The rule reads directories instead of reflecting over
  assemblies (`:9-11`), so it costs nothing at test time and reports a repo-relative path an author
  can act on (`:61`, `:74-75`).
- **Written once, inherited four times.** The base plus per-repo subclass shape is the ADR-015
  pattern, so the cap, the counting rules and the skip list move for every repo in one framework
  release.
- **Namespace-follows-folder is what makes layout enforceable at all.** Without IDE0130 at warning
  under `TreatWarningsAsErrors`, "the folder names the feature" would be a review convention that
  decays silently. With it, the compiler holds the tree and the namespace in agreement.
- **Exemptions belong in code.** A deliberately flat folder is listed as a string in the repo's own
  subclass with a documented reason (`FolderWidthTests.cs:22-33`), so the exception is reviewable in
  a diff rather than being an unwritten habit.

## Trade-offs
- **Layout changes are public API breaks on a lockstep package family.** Because the namespace is
  the folder, a reorganization is a breaking release for every consumer (ADR-016), with no
  deprecation window: the old namespaces stop existing in the release that introduces the new ones
  (`UPGRADING.md:9-11`). Two consecutive framework releases, v1.183.0 and v1.184.0, were exactly
  that.
- **Documentation citations rot underneath the moves, and they did.** The 2026-09-03 ADR audit
  classified 56 of its 84 needs-edit records as citation-only drift, almost all of it a folder segment
  the v1.183.0 to v1.185.0 moves introduced (`Rules/`, `Bases/Governance/`, `Messaging/`, `Auth/`,
  `Services/Api/`, `Startup/Pipeline/`) that the cited path no longer carried, and the MMCA.Common
  scorecard's section 5 row still cites the pre-move `ArchitectureRules.Slices.cs`
  (`governance/common-ArchitectureScorecard.md:77`). Every one of those is a path-only break with
  the behavior unchanged, which is precisely what makes it easy to miss.
- **The gate counts; it does not read names.** Nothing verifies that a folder is named after an
  aggregate, that the plural name matches across projects, or that no sub-folder is called `Domain`.
  A repo can satisfy the twelve-file cap with twelve technical buckets, and Decision point 8 is
  carried by review.
- **The cap is a round number and the exemption match is loose.** Twelve is a `virtual` default with
  no derivation (`FolderWidthTestsBase.cs:23`), and an exemption matches by
  `relativeFolder.EndsWith(suffix)` (`ArchitectureRules.FolderWidth.cs:85-86`), so a short suffix
  can exempt more folders than its author intended.
- **The skip list hides real trees.** `Resources` and `wwwroot` are skipped outright by segment
  (`:78-82`), so a localization or asset folder can grow without bound even when its shape is
  authored rather than generated.
- **The exemption prose drifts from the exemption list.** MMCA.Common's `FolderWidthTests` class
  summary still describes the pre-v1.184.0 set (application contracts, CQRS primitives, shared auth
  contracts, API startup extensions, the integration-test package root:
  `FolderWidthTests.cs:9-16`), while the live list holds three entries (`:28-33`), and the
  folder-width gate is not mentioned at all in the scorecard row that summary points at.
- **Namespace-follows-folder is not universal.** Eight documented IDE0130 exclusions
  (`MMCA.Common/.editorconfig:867-883`, `MMCA.ADC/.editorconfig:856-857`,
  `MMCA.Store/.editorconfig:845-846`) mean that in those trees a folder move renames nothing, so the
  property a reader relies on holds almost everywhere rather than everywhere.

## Related
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function tier this rule joins, and the
public-API baseline that records `FolderWidthTestsBase`),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (lockstep versioning: a layout change lands in
every package at one version and every consumer bumps in one pass),
[ADR-059](059-module-contract-and-composition.md) (the module contract whose project-per-layer shape
is the level above "feature by folder"),
[ADR-106](106-extension-members-as-public-di-surface.md) (the other convention whose cost is paid in
the public API surface of a lockstep-released package family),
[ADR-053](053-dual-registry-package-publishing.md) (the dual-registry publish that carries a renamed
namespace to consumers outside this workspace).
