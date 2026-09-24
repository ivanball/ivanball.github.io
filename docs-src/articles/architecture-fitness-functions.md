# Architecture fitness functions: rules that fail the build, not a wiki page

> Series: MMCA.Common · Article #34 (deep-dive) · Pillar P4 · Group G28 · Rubric §3,§12,§34 ·
> Status: grounded in `MMCA.Common/CLAUDE.md` (Architecture Enforcement section),
> `MMCA.Common/README.md` (package table),
> `Website/docs-src/adr/015-architecture-fitness-functions.md`,
> `Website/docs-src/adr/060-performance-regression-gate.md`,
> `Website/docs-src/adr/062-slo-alerting-as-code.md`,
> `Website/docs-src/adr/105-data-residency-build-gate.md`,
> `Website/docs-src/adr/109-feature-by-folder-convention.md`, and
> `Website/docs-src/onboarding/group-28-testing-infrastructure.md`. No em dashes.

**Subtitle:** The inward-dependency rule everyone agrees on is the one everyone eventually breaks. Here
is how MMCA.Common enforces it twice, defines the rules once, and makes them identical across four
codebases.

---

Open almost any Clean Architecture README and you will find a diagram with arrows pointing inward, and a
sentence that says the Domain layer must not depend on EF Core or ASP.NET. Everyone nods. Everyone
agrees. And then, eighteen months later, somebody adds a `[Table]` attribute to a domain entity because
it was convenient, the reviewer was busy, and nothing stopped them. The arrows in the diagram were
never connected to anything that runs.

That is the difference between a convention and a fitness function. A convention is a sentence in a doc.
A fitness function is a check that fails the build. MMCA.Common is built on the conviction that **if a
rule matters, it should be a check, not a comment**, and the layer-dependency rule is enforced not once
but twice, on purpose.

## Why a diagram is not enforcement

The inward-dependency rule is the load-bearing wall of Clean Architecture. The whole value proposition,
business logic that is independent of frameworks, UI, and data stores, collapses the moment Domain
starts referencing EF Core. And it is precisely the rule that erodes quietly, one convenient shortcut
at a time, because each individual violation looks harmless in the PR that introduces it.

Code review is the usual line of defense, and it is the wrong tool. Reviewers do not hold the full
dependency graph in their heads. They cannot see that a new `ProjectReference` three layers down now
lets Domain transitively reach a serialization library. They get tired, they trust the author, and new
contributors do not even know the rule exists. The rubric this framework is scored against
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`, category 3 Clean Architecture and category 34 Architecture
Governance) makes the point bluntly: architecture rules that exist "only as prose nobody checks" are a
red flag. The fix is to make conformance executable.

## Enforced twice: compile-time and runtime

MMCA.Common enforces the dependency rules through two independent gates, and the redundancy is
deliberate (`MMCA.Common/CLAUDE.md`, Architecture Enforcement section).

**1. Compile-time, via MSBuild.** `Source/Build/MMCA.Common.LayerEnforcement.targets` is imported from
`Directory.Build.props` for every `MMCA.Common.*` project under `Source/`. It runs in a
`BeforeTargets="ResolveProjectReferences"` step, inspects the project's `ProjectReference` list, and
**fails the build** with a descriptive error if a layer references a forbidden upstream layer. This is
the fastest possible feedback: you cannot even compile a violation. The wall is checked before the code
exists.

**2. Runtime, via NetArchTest.** `Tests/Architecture/MMCA.Common.Architecture.Tests` (built on
NetArchTest.eNhancedEdition) asserts the same rules against the *compiled assembly dependencies*. This
catches what the project-reference check cannot: a forbidden type reach that arrives transitively
rather than through a direct `ProjectReference`. A dependency several packages deep can surface a type
that no `.csproj` names directly, so a project-reference scan never sees it, while an assembly-level
test that walks the compiled dependency graph does.

Why both? Because they fail at different times and catch different things. The MSBuild guard is
instant and stops the obvious direct violation before compilation. The NetArchTest suite is
comprehensive and stops the subtle transitive one. The rubric explicitly rewards this: maturity level 4
means "enforced automatically," and two complementary gates are about as enforced as a rule gets. The
guidance in the contributor doc is correspondingly blunt: when you add a new layer rule, add it in
**both** places.

One boundary is worth naming: both gates assert structure and registration, never what a booted host
actually does, so the conformance suites that prove the framework's runtime contracts against a host
that really started are a separate shipped tier, covered in Article 35.

## Defined once, identical everywhere

Here is the part that makes the fitness functions scale across more than one repo without rotting into
three slightly-different copies.

The rule *bodies* do not live in the test project. They live once, in a shipped NuGet package:
`MMCA.Common.Testing.Architecture` (package 15 of the nineteen the framework publishes, with
`FACTS.md` the canonical count). That
package defines:

- `ArchitectureRules`, the reusable rule library that expresses the actual assertions.
- A set of 53 abstract `*TestsBase` classes holding 136 `[Fact]`s (for example
  `LayerDependencyTestsBase`, `DomainPurityTestsBase`, `MicroserviceExtractionTestsBase`,
  `PiiConventionTestsBase`, `FolderWidthTestsBase`, `DataResidencyTestsBase`).
- One extension point, `IArchitectureMap`, that every base class is parameterized by, with a shipped
  `ArchitectureMapBase` that implements it so a per-repo map is a flat declaration of assemblies.

Each repo supplies exactly **one** map implementation that declares its own layer and module
assemblies, and its arch-test classes shrink to thin sealed subclasses (three to ten lines) that
inherit the real `[Fact]`s.

```csharp
// In MMCA.Common: one anchor type per package, then the test class is a 3-line subclass.
internal sealed class CommonArchitectureMap : ArchitectureMapBase { /* layer + module assemblies */ }

public sealed class LayerDependencyTests : LayerDependencyTestsBase
{
    protected override IArchitectureMap Map { get; } = new CommonArchitectureMap();
    // The [Fact]s live in the base. This subclass just supplies the map.
}
```

MMCA.Store, MMCA.ADC and MMCA.Helpdesk consume the same package and supply their own maps
(`StoreArchitectureMap`, `AdcArchitectureMap`, `HelpdeskArchitectureMap`), so the reference app is held
to the framework's own layering, module-isolation and transport-at-edges rules rather than exempted
from them. The consequence is that **the same compiled rule runs identically across all four
codebases.** "Domain must not depend on Application" is one rule body, not four drifting copies. When
the rule improves, every consumer inherits the improvement on the next package bump. One shared package
also means no per-repo `ArchitectureTestHelper` duplication, and so none of the drift that four copies
of a rule invite: exactly the kind of drift fitness functions are
supposed to prevent. It is also a maintainability win
in its own right (rubric category 16): one rule evolves, all consumers inherit the fix.

A small honest detail: a few checks genuinely do not generalize, so they stay local. The
`MMCA.Common.Grpc` boundary check and the `IMessageBus` / `IJwksProvider` placement checks live in
`FrameworkSanityTests` in the Common repo only, because they are about Common's own internal structure.
And `DependencyVersionTests` (parsing `Directory.Packages.props` to fail the build if MassTransit's
major version reaches 9, the v8 licensing pin) is subclassed only in Common, because only Common
actually declares that pin.

## The rules that matter most

Three example rule families show what fitness functions actually assert.

**`LayerDependencyTests`.** The inward-dependency rule: API reaches down to Infrastructure,
Infrastructure to Application, Application to Domain, Domain to Shared, and never the other way. (UI and
Grpc are deliberate exceptions, depending only on Shared, so the test encodes that too.)

**`DomainPurityTests`.** Domain must be framework-pure, and the rule names the ban explicitly rather
than gesturing at it: a ten-entry assembly-dependency list covering `Microsoft.AspNetCore`,
`Microsoft.EntityFrameworkCore`, `Serilog`, `AutoMapper`, `Newtonsoft.Json`, `FluentValidation`,
`Scrutor`, `MudBlazor`, `Polly` and `StackExchange.Redis`, which each repo can extend with its
own bans through an override, a payment SDK or a broker client being the example the rule itself names. Sibling facts hold Shared to the same list and keep Application off EF
Core and ASP.NET Core. That is what lets the scorecard record this framework's domain as verified
framework-free, which is the kind of claim a fitness function lets you make with confidence instead of
hope.

**`MicroserviceExtractionTests`.** This one guards the framework's central thesis, that a module can be
lifted out of the monolith into its own service without rewriting application code. The invariant is
that application and domain code talk to abstractions while transport choices live at the edges. So the
rule asserts that **Application, Domain, and Shared must never reference MassTransit directly.** They
depend on `IMessageBus`, and Infrastructure supplies the broker implementation. If the transport
library ever leaks upward, the build fails. The reliability boundary and the extraction boundary are
protected by the same mechanism.

This is also where the doubled enforcement lifts category 3 and category 34 into the top maturity band
(Maturity 4) in the scorecard (Implementation 9 and 8, respectively): the rules that protect the
architecture are the ones that fail the build, not the ones written in a doc.

### A convention becomes a test: twelve files per folder

The clearest case for turning a convention into an executable rule is the one that reads least like
architecture: how wide a folder is allowed to get. The layout rule is module by project, feature by
folder, use case by leaf, and its failure mode is gradual. A folder named for an aggregate collects one
more file per sprint, nobody objects to any single one of them, and eighteen months later it is a
technical bucket wearing a feature's name. `FolderWidthTestsBase` makes that drift a red build:
`MaxDirectFiles` defaults to 12, and the one inherited `[Fact]`, `Folders_stay_narrow`, walks the
repo's `Source/` and `Tests/` trees through `ArchitectureRules.FoldersStayNarrow` (ADR-109). A subclass
supplies a repo root and nothing else.

```csharp
// MMCA.Helpdesk: the entire subclass. The [Fact] and every counting rule live in the base.
public sealed class FolderWidthTests : FolderWidthTestsBase
{
    protected override string RepoRoot { get; } = ArchitectureMapBase.FindRepoRoot("MMCA.Helpdesk.slnx");
}
```

The counting rules are the decision, not an implementation detail, and they are what keeps the gate
credible. A `.razor` component and its co-located code-behind count as one unit, so a component folder
is measured in components rather than in files; a `.resx` does not count at all; generated files never
count; and whole trees whose shape nobody chose are skipped outright by path segment, `bin`, `obj`,
`Migrations`, `Platforms`, `Resources` and `wwwroot` among them. Without those exclusions an EF
`Migrations/` folder would go red every month for a reason no author controls, and a rule that fires on
something nobody chose is a rule teams learn to suppress.

All four repos subclass it, and every exemption is code rather than a note in a doc: only MMCA.Common
overrides `ExemptFolderSuffixes`, which means each allowed wide folder is a line in a diff somebody
approved. One naming rule travels with the width rule: a folder inside a module project is never called
`Domain`, `Application`, `Infrastructure`, `API` or `UI`, because `ModuleNameConventions.GetModuleName`
derives the owning module from the namespace by taking the segment before the first layer segment, and
that derived name is load-bearing (it is the SQL Server schema). A sub-folder borrowing a layer name
would silently re-home a module, which is exactly the class of mistake a convention in prose cannot
catch.

### The gate that reads a privacy policy

The same technique reaches a claim that is not about code at all. Each deployed app publishes a privacy
policy telling a user which region their personal data is stored in. That sentence is typed once, by a
human, while the region it describes lives in infrastructure code that moves for reasons having nothing
to do with the policy. When the two diverge nothing breaks: no test goes red, no alert fires, and the
app keeps serving traffic while a public commitment about a named jurisdiction is false (ADR-105).

`DataResidencyTestsBase` turns that into a build failure. The subclass supplies its map and implements
exactly one method, `ExtractDeployedRegion`, which parses the region out of its own repo's
infrastructure source of truth. The inherited `[Fact]`,
`PrivacyPolicy_DataStorageRegion_MatchesDeployedRegion`, reads `PRIVACY.md` and asserts it states that
region, comparing whitespace-insensitively and case-insensitively so a policy's "West US 2" matches a
workflow's `westus2`. A `ForbiddenResidencyClaims` list blocks the other direction: a stale region, or
one copied from a sibling repo's policy, cannot quietly return.

The two deployed apps parse different files, which is the whole reason only the assertion lives in the
base. MMCA.ADC reads the SQL region default out of its deploy workflow, because its subscription forces
the SQL server into a different region from its Container Apps, and it still blocks by name the stale
"central United States" claim its policy once carried. MMCA.Store reads the single-region sentence in
its disaster-recovery runbook and forbids ADC's two regions from being copied across. A compliance
statement is usually the last thing anybody thinks of as testable, and it is one of the few that a
build can check outright.

## Freezing the wire: the contract no single repo's build can see

A `.proto` file is not source in the ordinary sense. It is a published contract, and what makes it
dangerous is that breaking it looks exactly like editing a local file. Renumber a field, retype one,
rename an rpc, flip a streaming flag: your repo compiles, your tests pass, and every deployed peer built
against the previous generation is now wrong. Nothing in a single repository's build notices, because
everything the change breaks lives in another process.

The framework freezes both halves of that surface. `IntegrationEventContractTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/IntegrationEventContractTestsBase.cs:11`)
pins every integration-event payload against a committed contract. `ProtoContractTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/ProtoContractTestsBase.cs:19`) does
the same for the synchronous half, the gRPC protos, so a renumbered field, a retyped one, a renamed rpc
or a flipped streaming flag fails a build instead of reaching a release on code review alone. Both ship
in the `MMCA.Common.Testing.Architecture` package (ADR-015).

The subclass is three declarations and one inherited `[Fact]`: the solution file that marks the repo root
(`:22`), the `.proto` files to pin as repo-root-relative paths (`:25`), and the committed snapshot itself
(`:30`), with the fact at `:32-34`. The rule body,
`ArchitectureRules.ProtoContractsMatchFrozenList`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Protos.cs:37`), resolves
the repo root (`:45`), re-reads the real files from the working tree, rebuilds the contract, and diffs it
against the frozen list **in both directions**: a line present in the protos but not frozen, and a line
frozen but no longer present, are each a violation with its own prefix (`:67-70`). That is the same
both-directions discipline the navigation-doc gate uses below, aimed at a wire format instead of a table.

What gets pinned is exactly what a peer can observe: the `package`, every rpc with its name, request and
response types and **both** streaming flags (`:198-208`), every message field with its name, declared
type, label and **number** (`:219-227`), and every enum value with its number (`:211-217`). Nested
messages and enums are qualified under their parent, while a `oneof` contributes no name segment because
on the wire it does not (`:182-184`). Deliberately not pinned: `syntax`, `import` and every `option`,
`csharp_namespace` included (`:27-31`). The line is drawn at "would a deployed peer notice." Pin the
file-level options and a reordered import turns into a red build, which is the fastest way to teach a
team to regenerate the snapshot without reading it.

Adoption is the shape this tier always uses. MMCA.ADC's subclass pins the seven protos its four
`*.Contracts` projects compile, against seventy-six frozen lines
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Contracts/ProtoContractTests.cs:9-18`, list at `:20-97`);
MMCA.Store's pins four
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Contracts/ProtoContractTests.cs:13-19`). MMCA.Common
ships no `.proto` of its own, because it supplies the gRPC plumbing and not the contracts, so it
deliberately does not subclass. It drives the rule through a matched fixture pair instead, a clean proto
and a deliberately drifted twin, which is the only way a repo can test a rule whose subject lives
somewhere else: the clean file proves the parser accepts a real contract, and the drifted one proves the
rule actually fails, reporting both sides of a renumbered field
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ProtoContractFitnessTests.cs:52-64`) and
naming a missing file explicitly rather than silently pinning an empty contract (`:76-87`).

Two honest costs. The frozen list is another committed baseline, the same obligation as the performance
baseline further down: an intended contract change means regenerating the snapshot by printing
`ArchitectureRules.BuildProtoContract(...)` for the same files, coordinating the peer rollout, and
committing the new list in that same change, never editing one line to turn a red test green. Both
consumer files say precisely that in a comment above the list
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Contracts/ProtoContractTests.cs:21-24`). And the
unpinned options are not entirely harmless: changing `csharp_namespace` breaks the generated client code
in every consumer while the wire stays byte-identical, and this gate passes it. The rule protects the
protocol, not the compile, and that distinction is easy to misread as "protos are gated."

## The other kind of fitness test: documentation as a contract

Everything above tests code against code. There is a second family that tests **documentation against
code**, and it is the one that stops a doc from rotting the moment someone ships a feature.

`NavigationFlow.md` is not a wiki page. It is an embedded resource, and a test diffs its routes table
against every routable page discovered by reflection, in both directions:

```csharp
undocumented.Should().BeEmpty(
    because: "every routable page in MMCA.Common.UI must appear in NavigationFlow.md's routes table; add the new route (with its auth posture) in the same change (rubric §25)");
phantom.Should().BeEmpty(
    because: "NavigationFlow.md promises routes that no longer exist; remove or re-route the stale rows in the same change (rubric §25)");
```

Both directions matter, and the second is the one teams forget. A doc that is missing your new page is
merely incomplete. A doc that still promises three pages you deleted is actively lying, and it is the
kind of lie nobody notices until someone plans work against it. Making `phantom` a build failure means
the stale row cannot survive the change that made it stale.

The test goes one step further and asserts the documented **auth posture** matches the `[Authorize]`
reality on each page. That turns the navigation doc into a security-relevant artifact: if you drop an
`[Authorize]` attribute and the table still says the route is protected, the build fails rather than
the doc quietly becoming wrong about who can reach it.

`FormsConventionTestsBase` applies the same idea to UX guarantees rather than prose. It asserts every
admin create form keeps its `UnsavedChangesGuard` bound through a live `IsDirtyAccessor`, plus dirty
tracking and a validated `MudForm`, so the "you have unsaved changes" protection cannot silently
regress on one screen out of forty. It also asserts a **minimum discovered form count**, which is the
detail that makes it real: without that floor, a refactor that stopped the reflection from finding any
forms would leave the test passing vacuously over an empty set, which is the classic way a convention
gate dies without anyone noticing.

That vacuity guard is the transferable lesson here. A rule that silently matches nothing is worse than
no rule, because it reports success. Any reflection-driven gate you write needs an assertion that it
actually found the things it claims to be checking.

## The same family, aimed at operations: every alert needs a runbook

The newest member of that family points the idea at your on-call rotation. An alert with no triage
steps is a page with no next step, and a runbook section for an alert that no longer exists is worse
than useless: it is stale guidance somebody follows at 3am. Both directions rot quietly, because
nothing compares the two files. `ObservabilityConventionTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:30`)
ships in the same `MMCA.Common.Testing.Architecture` package and turns the pairing into a build
failure (ADR-062).

It fails in three distinct ways. An SLO alert declared in the consumer's Bicep template with no `###`
section in `infra/OPERATIONS.md` whose heading carries the matching `-alert-<key>` infix is a
violation, and so is a heading that does carry the key but not the alert's current severity as
`(sev N)` (`:64-84`), which means re-tiering an alert without moving its triage steps is a red build
rather than a surprise at 3am. In the other direction, an orphan runbook section whose alert the
template no longer provisions is a violation too (`:92-103`). And discovering fewer than
`MinimumAlertSpecs` specs, default 3 (`:39`), is itself a failure (`:54-60`).

That third rule is the same fail-closed property the forms floor and the cost gate below both rely
on, and it earns its keep here more than anywhere: discovery parses the template between two literal
anchors, `var sloAlertSpecs` and `resource sloAlerts` (`:109-114`), and a rename would otherwise leave
a gate that pairs zero alerts against zero runbook sections and reports success. A key count that
disagrees with the severity count fails for the same reason (`:117`).

Adoption is the shape the rest of this tier already uses. MMCA.ADC and MMCA.Store each embed their
real `infra/main.bicep` and `infra/OPERATIONS.md` as manifest resources
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:17-22`)
and declare a subclass whose only body is a raised floor, `protected override int MinimumAlertSpecs
=> 4;`, because each repo provisions four specs
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:13`).
Leaving the shipped default of 3 in place would let the gate pass on three discovered specs if the
parse anchors ever drifted, which is the vacuity trap one level up. The
base reads those resources from `ResourceAssembly`, which defaults to the *derived* type's assembly
(`:51`), because resolving against its own would look for the consumer's template inside the
framework package and always throw. MMCA.Helpdesk declares no subclass at all: an
inapplicable gate rather than an unadopted one. The honest limit is that this is a text gate over
infrastructure-as-code. It proves the two files agree; it does not prove the deployment ran or that
the query behind an alert measures what it claims. The alerting mechanism itself sits with the
telemetry it watches, in Article 48.

## The third kind: a fitness function for cost

Structural rules assert shape. Documentation rules assert honesty. There is a third thing worth failing
a build over, and it is the one most teams leave to a dashboard: cost. MMCA.Common has a BenchmarkDotNet
harness for its database-free hot paths, and a harness a maintainer runs by hand proves nothing about
the pull request in front of them, so the harness got a gate (ADR-060).

The mechanics are ordinary. A dedicated CI job, `Performance gate (BenchmarkDotNet Short + baseline
verify)`, runs the suite with `--filter "*" --job Short --exporters json` (the filter because
BenchmarkDotNet otherwise prompts for a selection and would hang the runner), then runs a small
dependency-free checker, `build/perfgate`, over the exported JSON artifacts. It compares them against a
**committed** baseline file, `Tests/Performance/perf-baseline.json`, not against a stored previous run.
Moving a number on purpose therefore means editing the baseline in the same PR as the change that moves
it. That choice is the reviewable one: the number lives in the diff, so deliberately paying more is a line
somebody sees and questions in the same PR as the code that spends it. A gate comparing against the
previous run would ratchet silently, every PR only slightly worse than the last, and the sum invisible.

The interesting decision is what gets an absolute number and what does not.

**Allocations are gated absolutely.** Eight per-benchmark ceilings, one for every benchmark in the
suite, in managed bytes per operation, compared strictly: measured above the ceiling is a violation.
Bytes per operation do not depend on how busy the runner is, which is exactly why an absolute number is
legitimate there. The committed values carry roughly 25% headroom over the measurement, so the gate is a
ratchet with slack rather than a tripwire.

**Latency is gated only as a ratio between two benchmarks, never as an absolute time.** This is the part
worth stealing. CI runs on shared hosted runners where wall-clock timings move run to run by more than
most regressions worth catching, so an absolute threshold is either tight enough to go red on a noisy
neighbour or loose enough never to fire at all. A ratio rule instead names a slow benchmark, a fast
benchmark, and a floor; the checker divides their means from the same run and fails when the quotient
drops below the floor. Both benchmarks ran in the same process, on the same machine, under the same
noise, so whatever slows one slows the other and the machine cancels out of the quotient. One floor is
committed today: the specification's cached compiled delegate must stay at least 1000x faster than the
recompile-every-call anti-pattern, against a measured value of roughly 120,000x. Delete the cache and
the ratio collapses toward 1, where no amount of runner noise can hide it. The gate asks "does the cache
still exist," which survives a noisy measurement, instead of "is the cache exactly this fast," which
does not.

The third property connects straight back to the minimum-form-count floor above: **the gate is
fail-closed against vacuity.** A rule naming a benchmark that is absent from the results is a violation,
and the failure message says so in those words, that the gate would be vacuous. An empty results
directory is a failure rather than an empty pass. A benchmark that reports no allocation data fails with
an instruction to keep `[MemoryDiagnoser]` on the suite. Without those three checks a renamed method or
a filter that selected nothing would leave a gate that passes while measuring nothing, which is worse
than no gate because it reads as evidence.

One scope note, because overclaiming here would be precisely the sin this article is about: **this gate
is MMCA.Common only.** The harness, the baseline, and the checker exist in that repo and nowhere else.
The deployed apps' performance artifact is a different instrument entirely: MMCA.ADC's `Load Test
(k6)` workflow runs against deployed read endpoints on demand and on a monthly schedule, never on a
pull request. Consumers inherit the framework's bounded hot paths through the released
packages; they do not inherit the gate.

## Trade-offs, honestly

Fitness functions are not free, and the scorecard does not pretend otherwise.

- **They only cover what you write a rule for.** Read the scorecard category by category and the
  pattern is hard to miss: a category sits in the top maturity band when a fitness function stands
  behind it, and stays capped when the design is right but enforcement was left to review. DDD
  invariants and slice cohesion are the worked example of both halves. Each was review-only, and each
  moved up only once a rule existed: an `AggregateConventionTests` gate pinning `Create` to
  `Result<T>`, and a `SliceCohesionTestsBase` that fails the build when a handler or validator is
  stranded from its same-assembly command contract. A fitness-function culture creates a blind spot:
  the dimensions you have not yet written a rule for feel safe because the build is green, when they
  are merely unchecked.
- **Assembly-level tests have edges.** A rule only inspects the assemblies and types you point it at, so
  a forbidden reach outside that scope can slip through unnoticed. The tool sees what you aim it at;
  coverage is a design decision, not automatic.
- **A cost gate is only as sharp as its measurement.** The performance job runs the Short configuration
  (three warmup plus three iterations) to fit a 15-minute budget, which is plenty for a 1000x ratio floor
  and for counting bytes and useless for spotting a five-percent slowdown. Add roughly 25% headroom in
  the ceilings and exactly one ratio floor across the eight benchmarks, and the honest claim is that it
  catches collapses and new allocations, not creep. Nothing but review stops someone raising a ceiling to
  turn a red gate green.
- **Prose masquerading as enforcement is the real trap.** The framework's own backlog records the
  failure mode in its own history: a blanket dependency update reintroduced the known-bad MassTransit
  v9, and the response at the time was a comment, not a rule. Only the `DependencyVersionTests` gate
  described above made a repeat impossible. The counterpart is instructive too: the last misleading
  "MassTransit will retry" comment in that family was not retired by a gate but by somebody running a
  repo-wide search and recording that it returned zero matches. A fitness-function culture must be
  ruthless that a comment describing a check is not a check.
- **Two gates mean two places to update.** Add a layer rule and you maintain both the MSBuild target and
  the NetArchTest suite. That is the cost of catching both direct and transitive violations, and the
  contributor doc calls it out so nobody forgets the second one.

None of these argue against fitness functions. They argue for treating "is this rule actually enforced,
or do I just believe it is" as a question you keep asking.

## Apply this even without MMCA

The pattern ports to any stack and most of it is one afternoon of work:

1. **Pick the one rule you would be most upset to see violated silently.** For most teams that is the
   inward-dependency rule. Write a test that fails when it breaks (NetArchTest or ArchUnitNET in .NET,
   ArchUnit in the JVM world, dependency-cruiser or eslint boundaries in JS).
2. **Add a second, cheaper gate where you can.** A project-reference or import-lint check at build time
   gives instant feedback before the slower assembly-level test runs.
3. **Define the rule body once and parameterize the inputs.** If you have more than one service or repo,
   ship the rules as a shared library with a per-repo map so they cannot drift.
4. **Audit your comments for fake enforcement.** Every "this must always be X" comment is a candidate to
   become a test. If it cannot become a test, at least stop pretending the comment enforces anything.

The rule of thumb is the whole article in one line: **a design rule that is not a check is a hope, and
hope is not an architecture.** If a rule matters, make it fail the build.

---

**What we covered:** why a diagram is not enforcement, how MMCA.Common guards the inward-dependency rule
twice (compile-time MSBuild plus runtime NetArchTest), how the rule bodies live once in
`MMCA.Common.Testing.Architecture` and run identically across four repos via `IArchitectureMap`, the
three rule families that matter most (`LayerDependencyTests`, `DomainPurityTests`,
`MicroserviceExtractionTests`), how a folder-width rule turns a layout convention into a build failure
and a residency gate turns a published privacy claim into one, how a committed `.proto` snapshot
freezes the gRPC wire contract in both
directions, how the same package pairs every provisioned SLO alert to a
severity-correct runbook section, how the same idea extends to cost through a committed benchmark baseline
that gates allocations absolutely and latency only as a ratio, and the honest limit that you only
enforce what you write a rule for.

**Next in the series:** the test pyramid behind these fitness functions, roughly 2,254 fast tests with
no Docker and no database.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the Architecture Enforcement section
of the contributor guide, or add one NetArchTest rule to your own codebase this week and watch it catch
something.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 The package table (`README.md`) and the Architecture Enforcement section (`CLAUDE.md`) are in the
  repo.

*Tags: Software Architecture, .NET, C Sharp, Testing, Clean Architecture*

*Notes: every anchor below was re-opened and read on 2026-09-19 against MMCA.Common v1.205.0; nothing is carried
forward. Counts come from the CI-gated `MMCA.Common/FACTS.md` ("As of: 2026-09-17 (framework v1.205.0)" at `:4`,
"Current: v1.205.0" at `:14`): 136 test methods across 53 abstract `*TestsBase` classes (`:48`), of which
MMCA.Common's own build executes 267 (`:51`), and `MMCA.Common.Testing.Architecture` is package 15 of the 19
published (`FACTS.md:19` for the count, `:36` for its position in the numbered list). The earlier
"FACTS.md wins over a stale scorecard" paragraph is dropped because the two now agree: row 14 Testability & Test
Strategy restates "136 methods across 53 abstract bases (ADR-015) ... Common's own build executes 267, per
FACTS.md" (`Website/docs-src/governance/common-ArchitectureScorecard.md:94`), and that same row is the source for
the next-article pyramid figure, "~2,254 [Fact]/[Theory]" (`:94`); the older 262-file count has no current source
and is dropped rather than restated. Scorecard indices are Maturity 97.0% (318/328) at `:120` and Implementation
86.0% (705/820) at `:121`, set by the thirty-sixth-wave full re-score (2026-09-19, v1.205.0, `:5`); row N now sits
at line 80+N, so §3 Clean Architecture is `:83` (Maturity 4 / Implementation 9, "domain verified framework-free"),
§4 Domain-Driven Design `:84` (the `AggregateConventionTests` gate pinning `Create` to `Result<T>`), §5 Vertical
Slice Architecture `:85` (slice cohesion "machine-enforced" by `SliceCohesionTestsBase`), §16 Maintainability
`:96`, §26 Front-End Security `:106`, §32 `:112` (the ADR-016 fitness function behind the dependency pin) and §34
Architecture Governance & Docs `:114` (Maturity 4 / Implementation 8, "Strong, not Exemplary").
The four-codebase correction this pass: MMCA.Helpdesk consumes the same package and supplies
`HelpdeskArchitectureMap : ArchitectureMapBase`, whose own summary states that "the layering, module-isolation,
and transport-at-edges rules run identically here (ADR-015)"
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/HelpdeskArchitectureMap.cs:4-8`), alongside
`ArchitectureTests`, `FolderWidthTests`, `ContractImplementationTests`, `ServiceContractPurityTests`,
`DecoratorPipelineOrderTests`, `MiddlewarePipelineOrderTests`, `AnonymousEndpointTests` and
`DeleteBehaviorConventionTests` in that same folder, so the subtitle, the "identical everywhere" section and the
closing summary all read four codebases rather than three. `AdcArchitectureMap` and `StoreArchitectureMap` were
read this pass through their consumers rather than by line anchor
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/DataResidencyTests.cs:14`,
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/DataResidencyTests.cs:14`), so the prior
`:8` anchors on the map files are dropped rather than repeated unverified. The `DomainPurityTests` ban list is
`ArchitectureRules.ForbiddenDomainDependencies`, TEN entries and no `Stripe` among them: Microsoft.AspNetCore,
Microsoft.EntityFrameworkCore, Serilog, AutoMapper, Newtonsoft.Json, FluentValidation, Scrutor, MudBlazor, Polly,
StackExchange.Redis
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Purity.cs:9-21`,
its "repos may extend this via the extra parameter (e.g. a payment SDK or a broker client)" remark at `:5-8`),
applied by `DomainIsFrameworkFree` as a NetArchTest `HaveDependencyOnAny` assertion per Domain assembly (`:23-36`)
with the sibling `SharedIsFrameworkFree` at `:38`; `Stripe` is gone from the list and the article's ban sentence
was corrected accordingly. Every rule and base file moved into an area subfolder since the last pass, so all
package-internal anchors were rewritten: `Bases/Contracts/ProtoContractTestsBase.cs`,
`Bases/Contracts/IntegrationEventContractTestsBase.cs`, `Bases/Governance/ObservabilityConventionTestsBase.cs`,
`Bases/Governance/FolderWidthTestsBase.cs`, `Bases/Governance/DataResidencyTestsBase.cs`,
`Bases/Layering/DomainPurityTestsBase.cs`, `Bases/Ui/FormsConventionTestsBase.cs`,
`Rules/Contracts/ArchitectureRules.Protos.cs` and `Rules/Layering/ArchitectureRules.Purity.cs`; the line numbers
inside each file still hold. Added this pass, subsection "A convention becomes a test: twelve files per folder",
grounded in `Website/docs-src/adr/109-feature-by-folder-convention.md` (Accepted 2026-09-03, folder inventory
refreshed 2026-09-19) and read in source: `FolderWidthTestsBase` is declared at
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/FolderWidthTestsBase.cs:14`, with
`MaxDirectFiles` defaulting to 12 (`:23`), `RepoRoot` abstract (`:20`), `ExemptFolderSuffixes` defaulting to empty
(`:29`) and the single inherited `[Fact] Folders_stay_narrow` delegating to
`ArchitectureRules.FoldersStayNarrow(RepoRoot, MaxDirectFiles, ExemptFolderSuffixes)` (`:31-33`); the counting
rules (a `.razor` component and its code-behind count as one unit, resource and generated files do not count, and
`bin`, `obj`, `Migrations`, `Platforms`, `Resources`, `wwwroot` are skipped outright) are the base's own summary
(`:3-13`), restated as decision points 5 and 6 of ADR-109, which also records that all four repos subclass it and
that only MMCA.Common overrides `ExemptFolderSuffixes` (109:66-76). The Helpdesk subclass in the code block is
verbatim (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/FolderWidthTests.cs:8-11`), and the
sibling subclasses are `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/FolderWidthTests.cs`,
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/FolderWidthTests.cs` and
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/FolderWidthTests.cs`. The module-name
sentence is ADR-109 decision point 8: `ModuleNameConventions.GetModuleName` derives the owning module from the
namespace by taking the segment before the first layer segment
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:38-51`) and that derived name is
the SQL Server schema (109:105-110). Also added this pass, subsection "The gate that reads a privacy policy",
grounded in `Website/docs-src/adr/105-data-residency-build-gate.md` (Accepted 2026-09-01) and read in source:
`DataResidencyTestsBase` is declared at
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DataResidencyTestsBase.cs:14` with
the abstract `Map` (`:16`), the `ForbiddenResidencyClaims` default (`:23`), the inherited `[Fact]
PrivacyPolicy_DataStorageRegion_MatchesDeployedRegion` (`:26`) that resolves the repo root through
`ArchitectureMapBase.FindRepoRoot` (`:28`), reads `PRIVACY.md` (`:34`) and asserts it contains the parsed region
(`:37-38`) before rejecting each forbidden claim (`:40-44`), the abstract `ExtractDeployedRegion` hook (`:53`) and
the whitespace-insensitive, case-insensitive `Normalize` (`:55-58`). Only the two deployed apps subclass it, which
is the scope ADR-105 states ("Both deployed apps publish a privacy policy at their repo root", 105:7-8): MMCA.ADC
parses the `SQL_LOCATION_OVERRIDE` default out of `.github/workflows/deploy.yml` and blocks the stale "central
United States" claim
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/DataResidencyTests.cs:12,16,20-30`), and
MMCA.Store parses the "one region (" sentence in `infra/DISASTER-RECOVERY.md` and forbids "West US 2" and "East US
2" from being copied in from a sibling repo
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/DataResidencyTests.cs:12,16,20-25`).
The documentation-as-contract section: the quoted `because:` strings are verbatim from
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/NavigationContractTests.cs:40` and `:42`, inside
the fact declared at `:31`, and the auth-posture sibling is
`EveryDocumentedAuthPosture_MatchesTheRouteAttributeReality` (`:46`, its assertion at `:78`). The forms gate is
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Ui/FormsConventionTestsBase.cs`:
`AdminCreateForms_KeepUnsavedChangesGuardAndValidation` (`:38`), the `MinimumCreateForms` vacuity floor with its
"so the convention is actually verified" rationale (`:50-51`), and the violation assertion naming
`UnsavedChangesGuard`, a live `IsDirtyAccessor`, dirty tracking and a validated `MudForm` under rubric §24
(`:66-67`). Verified names this pass: `MMCA.Common.LayerEnforcement.targets`,
`Tests/Architecture/MMCA.Common.Architecture.Tests`, NetArchTest.eNhancedEdition,
`MMCA.Common.Testing.Architecture`, `ArchitectureRules`, `IArchitectureMap`, `ArchitectureMapBase`,
`CommonArchitectureMap`, `AdcArchitectureMap`, `StoreArchitectureMap`, `HelpdeskArchitectureMap`,
`LayerDependencyTests(Base)`, `DomainPurityTests(Base)`, `MicroserviceExtractionTests(Base)`,
`PiiConventionTestsBase`, `FolderWidthTests(Base)`, `DataResidencyTests(Base)`, `FrameworkSanityTests`,
`DependencyVersionTests`, `ProtoContractTests(Base)`, `IntegrationEventContractTestsBase`,
`ObservabilityConventionTests(Base)`, `FormsConventionTestsBase`, `SliceCohesionTestsBase`,
`AggregateConventionTests`, `ModuleNameConventions`. The wire-freeze section:
`Bases/Contracts/ProtoContractTestsBase.cs` declares the base at `:19` with `SolutionFileName` (`:22`),
`ProtoFiles` (`:25`), `FrozenProtoContracts` (`:30`) and its single `[Fact]
ProtoContracts_ShouldMatch_TheFrozenSnapshot` (`:32-34`); the "regenerate deliberately, never edit to make a red
test go green" instruction is the base's own remark (`:13-16`), which also states that MMCA.Common ships no
`.proto` and does not subclass (`:9-11`). The rule body is
`Rules/Contracts/ArchitectureRules.Protos.cs`: `ProtoContractsMatchFrozenList` (`:37`) resolving the repo root
(`:45`), the two-direction diff (`:67-70`), rpcs with both streaming flags (`:198-208`), fields with label, type
and number (`:219-227`), enum values with numbers (`:211-217`), the transparent `oneof` (`:182-184`) and the
deliberately unpinned `syntax`/`import`/`option` set including `csharp_namespace` (`:27-31`). The async
counterpart is `Bases/Contracts/IntegrationEventContractTestsBase.cs:11`. Consumer wiring read in both repos:
MMCA.ADC pins seven protos from its four `*.Contracts` projects
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Contracts/ProtoContractTests.cs:3,9-18`) against a
frozen list starting at `:20`, and MMCA.Store pins FOUR, corrected this pass from three
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Contracts/ProtoContractTests.cs:13-19`:
product_variants.proto, user_catalog_export.proto, customer_service.proto and user_sales_export.proto), with the
regenerate-deliberately comment above its list now at `:21-24`. The framework's fixture-pair exercise is
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ProtoContractFitnessTests.cs:14`, the
renumbered-field case (`:52-64`) and the explicit missing-file case (`:76-87`). The ADR framing is ADR-015's
Revision (2026-08-18) at `Website/docs-src/adr/015-architecture-fitness-functions.md:240-284`. The alert-runbook
section: `Bases/Governance/ObservabilityConventionTestsBase.cs` declares the base at `:30`, the
`MinimumAlertSpecs` floor of 3 at `:39` asserted by `SloAlertSpecs_AreDiscovered_GateIsNotVacuous` (`:54-60`), the
missing-section and wrong-severity violations in `EveryProvisionedSloAlert_HasASeverityCorrectRunbookSection`
(`:64-84`, the `-alert-` infix constant at `:32`), the orphan direction in
`EveryRunbookAlertSection_MapsToAProvisionedAlert` (`:92-103`), the literal parse anchors `var sloAlertSpecs` /
`resource sloAlerts` (`:109-114`), the key-count-versus-severity-count assertion (`:117`) and `ResourceAssembly`
defaulting to the derived type's assembly (`:51`). The "body-less subclass" claim is corrected this pass: neither
consumer subclass is body-less, both raise the floor with `protected override int MinimumAlertSpecs => 4;` because
each repo declares four specs, and both files moved into `Governance/`
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:7,13` and
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/ObservabilityConventionTests.cs:7,13`,
each carrying the same "leaving the default here would let the gate pass vacuously" comment at `:9-12`); the
embedded `infra.main.bicep` / `infra.OPERATIONS.md` pair is at
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:17-22`. MMCA.Helpdesk
declares no observability subclass in its architecture-test project (directory listing read this pass); the
earlier "has no Bicep at all" half of that sentence was not re-verified this pass and is dropped rather than
repeated. The text-gate limit is ADR-062's own trade-off,
"It is a text gate over IaC, not a check against deployed state ... It proves the two files agree; it does not
prove the deployment ran, the rule exists in Azure, or the KQL is valid"
(`Website/docs-src/adr/062-slo-alerting-as-code.md:272-274`, the floor-keeps-a-text-gate-honest bullet at `:264`).
The cost gate: the CI job is `performance-smoke` (`MMCA.Common/.github/workflows/ci.yml:377`) named `Performance
gate (BenchmarkDotNet Short + baseline verify)` (`:378`) with `timeout-minutes: 15` (`:381`); the measure step
runs `--filter "*" --job Short --exporters json` (`:410`) with its non-interactive-filter and
3-warmup/3-iteration rationale in the comment above it (`:408`), and the `build/perfgate` verify step is `:419`
(every anchor in this paragraph shifted by roughly +45 lines since the last pass). The checker is
`MMCA.Common/build/perfgate/Program.cs`: strict allocation comparison (`:67-70`), the ratio floor computed as
`mean(slow)/mean(fast)` (`:88-91`), and the vacuity failures, a rule naming a benchmark missing from the results
(`:59-62`), a benchmark reporting no allocation data (`:63-66`), either side of a ratio floor missing (`:82-86`)
and an empty results directory (`:29-33`). The baseline is `MMCA.Common/Tests/Performance/perf-baseline.json`:
eight `allocationCeilingsBytes` entries (`:3-12`) and one ratio floor, `IsSatisfiedBy_RecompileEachCall` over
`IsSatisfiedBy_CachedCompile` at `minRatio` 1000 (`:13-19`), with the roughly-25%-headroom, ~120,000x-measured and
update-in-the-same-PR statements in its header comment (`:2`). The
"useless for spotting a five-percent slowdown" characterization is ADR-060's own, "The Short job cannot see small
latency regressions" (`Website/docs-src/adr/060-performance-regression-gate.md:143-145`, the exact phrase at
`:145`; note that ADR's own `ci.yml:332-333` anchor at `:36` is stale and was not used as a source here). The
deployed apps' k6 artifact was re-read for MMCA.ADC only: `Load Test (k6)`
(`MMCA.ADC/.github/workflows/load-test.yml:1`) on `workflow_dispatch` (`:14`) plus a monthly
`cron: "0 6 1 * *"` (`:23`); the parallel MMCA.Store workflow was not re-opened this pass, so the scope note names
MMCA.ADC only, and the earlier "MMCA.ADC and MMCA.Store have no benchmark suite / MMCA.Helpdesk has neither"
glob result was not re-run and is dropped. The trade-offs bullet on prose masquerading as enforcement is
regrounded on the still-open §16 Maintainability entry recording that a blanket NuGet update reintroduced
known-bad MassTransit v9 and was "fixed by a comment, not a rule"
(`Website/docs-src/governance/common-RemediationBacklog.md:1611`), with the struck-through counterpart, the
retired "MassTransit will retry" comment whose repo-wide search "returns zero matches ... verified 2026-08-14", at
`:1597`. The Article 35 pointer rests on ADR-015's stated boundary, that the tests assert "structure /
registration", not runtime behavior (`Website/docs-src/adr/015-architecture-fitness-functions.md:81`), and on
ADR-058 shipping the booted-host conformance bases in the `MMCA.Common.Testing` package
(`Website/docs-src/adr/058-runtime-conformance-suites-as-a-package.md:22-27`). The header moves to Group G28 and
its grounding onboarding file to `Website/docs-src/onboarding/group-28-testing-infrastructure.md:1`, the
testing-infrastructure chapter having been renumbered again (`group-27-common-ai-integration.md` now holds G27);
ADR-105 and ADR-109 are added to the Status block for the two new subsections. Correction to a note carried from a
prior pass: the direct `<PackageReference>` in `Source/Core/MMCA.Common.Application/MMCA.Common.Application.csproj`
is `MiniProfiler.Shared` at `:21`, and `MiniProfiler.AspNetCore.Mvc` appears only in the comments at `:12` and
`:17` as the package deliberately NOT referenced, so the prior claim that it was a direct reference is retired.
Earlier coverage additions retained: the documentation-as-contract section (2026-07-27), the cost gate
(2026-07-28, ADR-060), the alert-runbook section (2026-08-01, ADR-062) and the wire-freeze section (2026-08-20,
ADR-015 Revision).*

- Full series index: https://ivanball.github.io/writing.html
