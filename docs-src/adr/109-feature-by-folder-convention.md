# ADR-109: Feature-by-Folder Layout as an Enforced Convention

## Status
Accepted (2026-09-03; folder inventory and IDE0130 exception list refreshed 2026-09-19). Revised 2026-10-01: citations re-anchored. Revised 2026-10-06: module-name consumers moved to the per-engine data-source engines, PostgreSQL added. Revised 2026-10-07: Decision 8 narrowed to the sub-folder names that actually shift the derived module, the stale exemption-prose trade-off dropped, anchors refreshed after the v1.233.0 release. Revised 2026-10-21: Decision 1 now lists the
`Exports` folder that ADC Conference's Application and Shared carry without a Domain twin, anchors
refreshed after the v1.250.0 release. Revised 2026-10-26: Decision 7 and the trade-offs now count
four MMCA.Common IDE0130 exceptions (six workspace-wide) after the Aspire extension-folder
exceptions were removed, anchors refreshed after the v1.261.0 release. Revised 2026-10-28:
Decision 2 now names the module-wide `wwwroot/`, `Authorization/` and `Resources/` folders beside
the UI and API technical roots, anchors refreshed after the v1.265.1 release.

## Context
The rubric's section 5 asks that "code is organized by feature/capability, so a change touches one
cohesive slice", with features "grouped by use case ..., not by horizontal technical folders"
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:211`, `:214`). ADR-015
already gates the *contents* of a slice: `SliceCohesionTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/SliceCohesionTestsBase.cs`)
fails a build when a handler is stranded from its command or query contract.

Nothing gated the *shape of the tree* until 2026-09-02, when a folder-width fitness function and a
repo-wide reorganization shipped together (`MMCA.Common/CHANGELOG.md:2586-2589`, `:2619-2623`). That
reorganization, and a second pass the next day (`:2527-2533`), were both marked **Breaking**, because in
this workspace namespaces follow folders: moving a file renames a namespace, and a namespace is
public API on a package family released in lockstep (ADR-016). Two consecutive MMCA.Common
releases (v1.183.0 and v1.184.0) were therefore layout releases, and they are what forced
`UPGRADING.md` into existence (`MMCA.Common/CHANGELOG.md:2574-2575`).

The convention itself is written down only in the workspace `CLAUDE.md` and in the rubric text
above. The bill it produces (public namespace renames, a scripted consumer sweep, an UPGRADING
protocol, and doc citations that rot underneath it) is recorded nowhere as a decision. This record
states it.

## Decision
**Folder structure is a governed architectural property, not a matter of taste: an aggregate or
feature names a folder, a folder holds at most twelve direct code files, namespaces follow folders,
and a layout change ships as a breaking release with a migration map.**

1. **The aggregate names the first folder level in Domain, Application and Shared.** MMCA.ADC's
   Conference module carries `Activities`, `Categories`, `Events`, `Partners`, `Questions`,
   `SessionAssets`, `Sessions`, `Speakers` and `Sponsors` directly under
   `Source/Modules/Conference/MMCA.ADC.Conference.Domain/`, and all nine names recur under
   `.Application/` and `.Shared/`. The match is not exact in the other direction: `.Application/`
   also carries `Common`, `Exports` and `Users`, and `.Shared/` also carries `Authorization`,
   `Exports` and `Rooms`, none of which has a Domain folder, so the rule is that an aggregate names a folder in every layer that
   has code for it, not that the three layers hold identical folder sets. MMCA.Helpdesk's
   single-module seed shows the minimal case: one
   `Tickets` folder under `Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/`, `.Application/`
   and `.Shared/`.

2. **In UI, API and Infrastructure the first level is a technical root and the aggregate sits
   beneath it.** The roots in use are `Pages/`, `Services/` and `Components/`
   (`MMCA.ADC.Conference.UI/`), `Controllers/` (`MMCA.ADC.Conference.API/`) and `Persistence/`
   (`MMCA.ADC.Conference.Infrastructure/`), with the aggregate folders one level down:
   `UI/Pages/Speakers`, `UI/Services/Speakers`, `API/Controllers/Speakers`,
   `Infrastructure/Persistence/EntityConfiguration/Speakers`. The UI and API first levels also carry
   module-wide technical folders that hold no aggregate: `UI/wwwroot/`, `API/Authorization/` (one
   extension file) and `API/Resources/` (the module's error resources). Infrastructure is a documented partial
   exception: beside `Persistence/`, its first level also carries aggregate names for external
   adapters, `Events/Sessionize/` and `Sessions/Scoring/`. MMCA.ADC's own `CLAUDE.md` states that
   shape as the rule for the repo, "external adapters sitting under their aggregate"
   (`MMCA.ADC/AGENTS.md:101`, which `MMCA.ADC/CLAUDE.md` imports).

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
   (`Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/FolderWidthTests.cs:16`), MMCA.ADC
   (`Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/FolderWidthTests.cs:10`), MMCA.Store
   (`Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/FolderWidthTests.cs:9`) and
   MMCA.Helpdesk (`Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/FolderWidthTests.cs:8`), each
   supplying only its `RepoRoot`. Only MMCA.Common overrides `ExemptFolderSuffixes`, with three
   one-concept folders: `MMCA.Common.Application/UseCases/Decorators`, its test twin, and
   `MMCA.Common.Domain/Interfaces` (`FolderWidthTests.cs:26-31`). ADC, Store and Helpdesk run
   against the empty default (`FolderWidthTestsBase.cs:29`). The base is public API and is baselined
   under the ADR-015 gate (`Testing.Architecture/PublicAPI.Shipped.txt:131-133`, `:377`,
   `:614-615`).

7. **Namespaces follow folders, so a folder move is a compile error until every namespace moves with
   it.** The shared analyzer baseline sets `dotnet_style_namespace_match_folder = true:warning`
   (`MMCA.Common/.editorconfig:90`) and `TreatWarningsAsErrors` is on repo-wide
   (`MMCA.Common/Directory.Build.props:7`), so IDE0130 fails the build. The exceptions are named per
   path: four in MMCA.Common (`.editorconfig:860-866` for the reasons), three of them the flat public
   surfaces consumers subclass (`Testing.Architecture/Bases/` at `:867`, `Testing.Architecture/Rules/`
   at `:870`, `Testing.UI/Infrastructure/` at `:873`), and the fourth a test fake that carries a
   consumer-shaped namespace because the convention under test keys on namespace shape
   (`Tests/Presentation/MMCA.Common.API.Tests/Fakes/` at `:876`), and one each in ADC and Store for the MAUI head's per-TFM `Platforms/` bootstrap
   files (`MMCA.ADC/.editorconfig:848-858`, `MMCA.Store/.editorconfig:837-846`).

8. **A folder inside a module project is never named `Domain`, `Application`, `Infrastructure`,
   `API` or `UI`.** `ModuleNameConventions.GetModuleName` derives the owning module from the
   namespace, taking the segment before the first layer segment
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:38-51`):
   `Domain` matches at any index from 1 up (`:41-43`) and the other four match only at index 3 or
   later (`:17`, `:48-50`). A `Domain` sub-folder therefore shifts the derived module in any project
   other than Domain, because `Domain` wins wherever it appears (`:41-45`). The other four take the
   first match, so under a project whose own layer segment already sits at index 3 (for example
   `MMCA.ADC.Conference.Application`) they still yield `Conference`, and they shift the module only
   in a project whose layer is not in that list, such as Shared (`:17`, `:48-50`). That name is load-bearing: it is the SQL Server schema
   (`Infrastructure/Persistence/DataSources/Engines/SQLServerDataSourceEngine.cs:101`), the
   PostgreSQL schema (`PostgreSQLDataSourceEngine.cs:100`), the Cosmos container
   (`CosmosDataSourceEngine.cs:95`), each engine reached from
   `EntityTypeConfiguration.cs:77`, the logical data-source name for unit-of-work routing
   (`Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:181`), all four through the
   internal `Infrastructure/Persistence/NamespaceConventions.cs:20-21` wrapper, and the module tag on
   every CQRS log line (`Application/UseCases/Decorators/LoggingCommandDecorator.cs:95`,
   `LoggingQueryDecorator.cs:89`). The derivation is locked by
   `Tests/Core/MMCA.Common.Shared.Tests/Conventions/ModuleNameConventionsTests.cs`. This half of the
   convention is enforced by review only: no fitness rule checks folder names.

9. **The move is scripted, not hand-edited.** `Tools/Scripts/move-namespace.ps1` rewrites namespaces
   and usings repo-wide and across the consumers, and `Tools/Scripts/auto-add-usings.py` plus
   `Tools/Scripts/fix-build-usings.py` settle the usings the compiler then reports. The framework's
   own changelog names the script as the consumer sweep (`MMCA.Common/CHANGELOG.md:2530-2532`,
   `:2588-2589`).

10. **A layout change ships as a breaking minor release with an old-to-new map.** v1.183.0 dissolved
    `MMCA.Common.Infrastructure.Services` and `.Settings` into the features they implement and split
    the UI capability, service and component grab-bags (`CHANGELOG.md:2593-2611`), and added the
    folder-width rule (`:2619-2623`). v1.184.0 split the eight remaining flat public namespaces
    (`:2527-2533`, `:2537-2568`) and added `UPGRADING.md` (`:2574-2575`). There is no dual-namespace grace
    release and no `[Obsolete]` shim, because C# cannot forward a type across namespaces inside one
    assembly (`MMCA.Common/UPGRADING.md:10-12`); the first-party consumers are swept in the same
    release (`UPGRADING.md:32-33`).

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
  subclass with a documented reason (`FolderWidthTests.cs:20-31`), so the exception is reviewable in
  a diff rather than being an unwritten habit.

## Trade-offs
- **Layout changes are public API breaks on a lockstep package family.** Because the namespace is
  the folder, a reorganization is a breaking release for every consumer (ADR-016), with no
  deprecation window: the old namespaces stop existing in the release that introduces the new ones
  (`UPGRADING.md:10-12`). Two consecutive framework releases, v1.183.0 and v1.184.0, were exactly
  that.
- **Documentation citations rot underneath the moves, and they did.** The 2026-09-03 ADR audit
  classified 56 of its 84 needs-edit records as citation-only drift, almost all of it a folder segment
  the v1.183.0 to v1.185.0 moves introduced (`Rules/`, `Bases/Governance/`, `Messaging/`, `Auth/`,
  `Services/Api/`, `Startup/Pipeline/`) that the cited path no longer carried. The MMCA.Common
  scorecard's section 5 row was one of those, and it has since been repaired: it now cites the
  post-move `Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.Slices.cs`
  (`governance/common-ArchitectureScorecard.md:69`). Every one of those is a path-only break with
  the behavior unchanged, which is precisely what makes it easy to miss, and repairing them is a
  pass of its own, separate from the move that caused them.
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
- **Namespace-follows-folder is not universal.** Six documented IDE0130 exclusions
  (`MMCA.Common/.editorconfig:867-877`, `MMCA.ADC/.editorconfig:857-858`,
  `MMCA.Store/.editorconfig:845-846`) mean that in those trees a folder move renames nothing, so the
  property a reader relies on holds almost everywhere rather than everywhere.

## Revision (2026-10-01)
No decision or rationale changed. Citations were re-anchored: the rubric section 5 text
(`ArchitectureEvaluationCriteria.md:211`, `:214`), the v1.183.0 and v1.184.0 changelog entries
(`MMCA.Common/CHANGELOG.md:1588-1691`), `UPGRADING.md:10-12` and `:32-33`, the module-name consumers
(`EntityTypeConfiguration.cs:86`, `:107`; `LoggingCommandDecorator.cs:95`;
`LoggingQueryDecorator.cs:89`), the MMCA.Common scorecard section 5 row
(`common-ArchitectureScorecard.md:69`), and MMCA.ADC's rule text, which now lives in
`MMCA.ADC/AGENTS.md:99`. The folder-width public API entries have been promoted to
`Testing.Architecture/PublicAPI.Shipped.txt:120-122`, `:336`, `:436`, `:531-532`. The Context
sentence about "the last three releases" was a point-in-time statement and now names the two
consecutive layout releases, v1.183.0 and v1.184.0.

## Revision (2026-10-06)
- Decision 8: the module name now reaches the database through the per-engine data-source engines
  (`SQLServerDataSourceEngine.cs:101`, `PostgreSQLDataSourceEngine.cs:100`,
  `CosmosDataSourceEngine.cs:95`, dispatched from `EntityTypeConfiguration.cs:77`), so the
  PostgreSQL schema is a fourth consumer of the `NamespaceConventions.cs:20-21` wrapper. Behavior is
  unchanged.
- Trade-offs: dropped the clause saying the scorecard section 5 row does not mention the
  folder-width gate; that row now cites `FolderWidthTests.cs:18` and `MMCA.Common.slnx:59`
  (`common-ArchitectureScorecard.md:69`).
- The 2026-10-01 revision's changelog, PublicAPI and `EntityTypeConfiguration.cs` anchors had moved:
  the v1.184.0 and v1.183.0 entries now span `MMCA.Common/CHANGELOG.md:1923-2026`, and the
  `FolderWidthTestsBase` baseline is six entries at `PublicAPI.Shipped.txt:127-129`, `:363`,
  `:584-585`.
- Anchors re-verified against current source (MMCA.Common v1.232.0).

## Revision (2026-10-07)
Re-verified against current source. The twelve-file cap, the counting rules, the three Common
exemptions, the six Common IDE0130 exceptions and the scripted move are unchanged; one Decision
sentence overstated the code, one trade-off no longer held, and the changelog, `.editorconfig`,
`FolderWidthTests` and AGENTS.md anchors moved.
1. Decision 8: narrowed "a sub-folder carrying one of those names shifts the derived module". A
   `Domain` sub-folder shifts it in any non-Domain project because `Domain` wins
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:41-45`); the
   other four take the first match (`:48-50`), so they shift it only in a project whose layer is not
   in `NonDomainLayerSegments` (`:17`), such as Shared.
2. Trade-offs: dropped the bullet saying the MMCA.Common `FolderWidthTests` class summary describes
   the pre-v1.184.0 exemption set. The summary names exactly the three live exemptions
   (`Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/FolderWidthTests.cs:10-12`),
   matching the list at `:28-30`.
3. Anchors re-verified against current source: Common `FolderWidthTests.cs:16` (class), `:26-31`
   (override), `:20-31` (override with its summary); `FolderWidthTestsBase.cs:29`;
   `MMCA.ADC/AGENTS.md:100`; `MMCA.Common/.editorconfig:860-868`, `:869`, `:872`, `:875`, `:878`,
   `:881`, `:884`, range `:869-885`; the v1.184.0 and v1.183.0 entries now span
   `MMCA.Common/CHANGELOG.md:1948-2051` (v1.184.0 Breaking `:1950-1956`, splits `:1960-1991`,
   UPGRADING.md `:1997-1998`; v1.183.0 Breaking `:2009-2012`, dissolutions `:2016-2034`,
   folder-width rule `:2042-2046`), with the script named at `:1953-1955` and `:2010-2012`
   (MMCA.Common v1.233.0, `CHANGELOG.md:7`).

## Revision (2026-10-21)
Re-verified against current source. The twelve-file cap, the counting rules, the three Common
exemptions, the six Common IDE0130 exceptions, the Store IDE0130 exception and the scripted move are
unchanged; one Decision folder inventory was incomplete, and the changelog, PublicAPI and ADC
`.editorconfig` anchors moved.
1. Decision 1: ADC Conference's `.Application/` and `.Shared/` both carry an `Exports` folder with
   no Domain twin (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Exports/`,
   `MMCA.ADC.Conference.Shared/Exports/`), so it joins the list of layer-only folders beside
   `Common`, `Users`, `Authorization` and `Rooms`. The nine Domain aggregate folders still recur in
   both layers, and the rule (an aggregate names a folder in every layer that has code for it) holds.
2. Anchors re-verified against current source: the `FolderWidthTestsBase` baseline is still six
   entries at `Testing.Architecture/PublicAPI.Shipped.txt:128-130`, `:373`, `:605-606`; the ADC MAUI
   `Platforms/` IDE0130 exception is `MMCA.ADC/.editorconfig:848-858` (section header and severity
   at `:857-858`); `MMCA.Store/.editorconfig:837-846` and `:845-846` and
   `MMCA.Common/.editorconfig:860-868`, `:869-885` hold; the v1.184.0 and v1.183.0 entries now span
   `MMCA.Common/CHANGELOG.md:2267-2370` (v1.184.0 Breaking `:2269-2275`, splits `:2279-2310`,
   UPGRADING.md `:2316-2317`; v1.183.0 Breaking `:2328-2331`, dissolutions `:2335-2353`,
   folder-width rule `:2361-2365`), with the script named at `:2272-2274` and `:2329-2331`
   (MMCA.Common v1.250.0, `CHANGELOG.md:7`).

## Revision (2026-10-26)
Re-verified against current source. The twelve-file cap, the counting rules, the three Common
exemptions, the ADC and Store IDE0130 exceptions and the scripted move are unchanged; the MMCA.Common
IDE0130 exception list shrank, and the changelog, PublicAPI and Common `.editorconfig` anchors moved.
1. Decision 7: MMCA.Common now carries four IDE0130 exceptions, not six. The two Aspire extension
   folder exceptions are gone; the remaining four are `Testing.Architecture/Bases/`
   (`MMCA.Common/.editorconfig:867-868`), `Testing.Architecture/Rules/` (`:870-871`),
   `Testing.UI/Infrastructure/` (`:873-874`) and `Tests/Presentation/MMCA.Common.API.Tests/Fakes/`
   (`:876-877`), with their reasons at `:860-866`, so the test fake is now the fourth exception.
2. Trade-offs: the documented IDE0130 exclusions number six, not eight: four in Common
   (`MMCA.Common/.editorconfig:867-877`) plus one each in ADC (`MMCA.ADC/.editorconfig:857-858`)
   and Store (`MMCA.Store/.editorconfig:845-846`), both of which hold.
3. Anchors re-verified against current source: the `FolderWidthTestsBase` baseline is still six
   entries, now at `Testing.Architecture/PublicAPI.Shipped.txt:132-134`, `:378`, `:615-616`; the
   v1.184.0 and v1.183.0 entries now span `MMCA.Common/CHANGELOG.md:2482-2585` (v1.184.0 Breaking
   `:2484-2490`, splits `:2494-2525`, UPGRADING.md `:2531-2532`; v1.183.0 Breaking `:2543-2546`,
   dissolutions `:2550-2568`, folder-width rule `:2576-2580`), with the script named at
   `:2487-2489` and `:2544-2546` (MMCA.Common v1.261.0, `CHANGELOG.md:7`).

## Revision (2026-10-28)
Re-verified against current source. The twelve-file cap, the counting rules, the three Common
exemptions, the IDE0130 exceptions and the scripted move are unchanged; one Decision folder
inventory was incomplete, and the changelog, PublicAPI and AGENTS.md anchors moved.
1. Decision 2: the UI and API first levels also carry module-wide technical folders with no
   aggregate beneath them, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/wwwroot/`,
   `MMCA.ADC.Conference.API/Authorization/` (one extension file) and
   `MMCA.ADC.Conference.API/Resources/` (the module's error resources). Infrastructure's first
   level is exactly `Events/`, `Persistence/` and `Sessions/`, and the rule holds.
2. Anchors re-verified against current source: MMCA.ADC's rule text is `MMCA.ADC/AGENTS.md:101`;
   the `FolderWidthTestsBase` baseline is still six entries, now at
   `Testing.Architecture/PublicAPI.Shipped.txt:131-133`, `:377`, `:614-615`; the v1.184.0 and
   v1.183.0 entries now span `MMCA.Common/CHANGELOG.md:2525-2628` (v1.184.0 Breaking `:2527-2533`,
   splits `:2537-2568`, UPGRADING.md `:2574-2575`; v1.183.0 Breaking `:2586-2589`, dissolutions
   `:2593-2611`, folder-width rule `:2619-2623`), with the script named at `:2530-2532` and
   `:2588-2589` (MMCA.Common v1.265.1, `CHANGELOG.md:7`).

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
