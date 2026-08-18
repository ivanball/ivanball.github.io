# ADR-015: Architecture Invariants Enforced as Fitness Functions

## Status
Accepted. Revised 2026-08-18 (two new rule families, namespace dependency cycles and trailing
`CancellationToken` declarations, plus a **third enforcement layer**: a compile-time public-API surface
gate with committed baselines. The "in two layers" framing in the Decision below is superseded; see the
Revision (2026-08-18) at the end).

## Context
The codebase rests on invariants that are easy to state and easy to erode by accident: clean-
architecture layer flow (Domain depends on nothing above it), module isolation (no module reaches into
another's internals), transport staying at the edge (no MassTransit / gRPC / Protobuf in Domain /
Application / Shared, ADR-006/007/008), every integration event declaring a `SchemaVersion`
(ADR-010), every outbound client wiring resilience (ADR-009), and the MassTransit-v8 pin (ADR-016).
"Remember the rule" does not survive a growing change history. Several existing ADRs already rely on
"a fitness function enforces this" without an ADR that establishes the approach itself.

## Decision
Enforce architectural invariants as **automated checks that gate the build**, in two layers
(**a third joined them on 2026-08-18**: see the Revision at the end).

1. **Compile-time guard.** `MMCA.Common.LayerEnforcement.targets` (imported for every `Source/` project)
   inspects `ProjectReference`s in a pre-build step and **fails the build** before tests run if a layer
   references a forbidden upstream layer. This catches the most common mistake (a bad project reference)
   with the fastest possible feedback.
2. **Runtime fitness functions.** A shared `MMCA.Common.Testing.Architecture` package
   holds the rule bodies once: an `ArchitectureRules.*` library (layers, modules, transport, events,
   entities, handlers, naming, controllers, immutability, governance, purity, specifications, slices,
   and localization in two rules: resx translation-coverage and no-hardcoded-UI-literal text, among
   others) plus
   abstract `*TestsBase` classes parameterized by an `IArchitectureMap`. Each repo
   (Common / Store / ADC / Helpdesk) supplies a single `IArchitectureMap` implementation
   (`CommonArchitectureMap`, `StoreArchitectureMap`, `AdcArchitectureMap`, `HelpdeskArchitectureMap`)
   declaring its layer and module assemblies, then inherits the test bases. The same rules run
   identically everywhere via NetArchTest over the compiled assemblies.

These tests run inside the normal `dotnet test` / CI tier, so a violated invariant fails CI like any
other test (CI additionally guards with `--minimum-expected-tests 1` so an empty suite cannot pass
silently). Centralizing the rules in a package, rather than copying them per repo, means a new
invariant is written once and inherited by every consumer.

## Rationale
- **Invariant over discipline.** Turning "do not do X" into a red build is the only enforcement that
  scales. It is the same lever used by the layer rules, the resilience gate (ADR-009), the
  event-version gate (ADR-010), and the MassTransit pin (ADR-016).
- **Write once, run everywhere.** The `IArchitectureMap` extension point keeps the four repos' rules in lockstep
  with zero duplication; a rule change lands for all consumers at once.
- **Two layers, two speeds.** The MSBuild guard fails at compile time on the common case; the
  NetArchTest suite catches the subtler assembly-level violations a project-reference check cannot see.

## Trade-offs
- The tests assert **structure / registration**, not runtime behavior. ADR-009's test proves a client
  *wires* resilience, not that its policy values are correct; parameter tuning stays a review concern.
- Some rules are necessarily reflection / convention based (naming, namespace shape) and can be
  brittle; keeping them in the shared library means a fix propagates everywhere in one change.
- A consumer must implement `IArchitectureMap` and subclass the bases to get the gating (opt-in wiring),
  even though the framework ships the rules. Common-only checks that cannot generalize live in
  `FrameworkSanityTests`.

## Revision (2026-08-18)
Two new rule families joined the shared library, and a **third enforcement layer** joined the two the
Decision above describes. The counts in `MMCA.Common/FACTS.md` move with them: **102 test methods
across 34 abstract `*TestsBase` classes**, of which MMCA.Common's own build executes **87**
(`FACTS.md:44-48`). Those are method counts derived lexically by `FactsGenerator`
(`MMCA.Common/build/facts/FactsGenerator.cs:138-151`, `:155-170`, `:178`), so a `[Theory]` counts once
regardless of how many data rows it runs: they are not test-case counts.

**Both new families are required merge gates, not advisory.** They live in
`Tests/Architecture/MMCA.Common.Architecture.Tests`, which is inside `MMCA.Common.slnx` (`:46`) and
therefore runs in the `build-and-test` job (`.github/workflows/ci.yml:135-144`), and the public API
gate fails that same job's build step (`ci.yml:106-108`); `build-and-test` is one of the eight required
gates on `main` (`CONTRIBUTING.md:60-61`). One caveat: a docs-only PR skips restore, build and test by
path filter (`ci.yml:103,107,136`) while still reporting green, so none of this fires on a
documentation change.

### `ArchitectureRules.Cycles`: namespace dependency cycles
`NamespacesHaveNoDependencyCycles(map, allowedCycleNamespaces)`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Cycles.cs:45-47`)
builds a namespace graph for **every** layer in the map (`:54`, so all seven for MMCA.Common) and
reports each strongly connected component in it. Nodes are the layer's root namespace plus one segment
beneath it (`:137`) and edges never cross assemblies (`:104`). Components are found by mutual
reachability over a boolean transitive closure rather than by Tarjan or Kosaraju (`:292`, `:310`), with
a breadth-first search picking the shortest path to display (`:330`). Edges are the type **signature
surface**: base types, implemented interfaces, field and property types, method return and parameter
types (declared members, public and non-public), and attribute types, with generic arguments and
array/by-ref/pointer element types recursively expanded (`:25-27`, implemented at `:174-212`). Types
outside the layer's root namespace are ignored.

The exemption hook is checked against the **whole strongly connected component, not a single namespace
and not merely the displayed path**: `component.TrueForAll(allowed.Contains)` (`:61`, rationale at
`:58-60`), so an allowance can never hide a new cycle that merely touches an accepted namespace, and a
fourth namespace joining an accepted tangle still fails. Consumers subclass `NamespaceCycleTestsBase`
(`Bases/NamespaceCycleTestsBase.cs:15`, test at `:29`) and override `AllowedCycleNamespaces`. Note that
the XML doc on both the rule (`:41-43`) and the base (`NamespaceCycleTestsBase.cs:22-23`) describes the
check in terms of the cycle's *path*; the code is the stricter whole-component test above, and the code
is what runs.

MMCA.Common has exactly one accepted tangle, inside `MMCA.Common.Infrastructure`:
`root -> Settings -> Persistence -> root`
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/NamespaceCycleTests.cs:39-44`), and
the subclass justifies it **per edge** rather than as a blanket allowance (`:13-38`): the composition
root binds every settings class, `TenancySettingsValidator` takes an optional `IDataSourceResolver` so
a tenant override naming a non-existent physical source fails the boot instead of silently resolving
cross-tenant, and the `EntityTypeConfiguration*` shims carry the `[UseDataSource]` / `[UseDatabase]`
marker attributes that live in the root namespace precisely because consumers annotate their own
configurations with them. All three namespaces ship in one assembly and one package, so none is
independently extractable and the tangle costs nothing the layer rules were protecting.

**The rule is a signature-level statement and says so.** The testing package carries no IL or Roslyn
dependency, so this is pure reflection: a reference that exists only inside a method body (a local, a
constructor call, a static call) is invisible to it, and compiler-generated closure and iterator types
are skipped deliberately so the result stays signature-level rather than half-body (`:30-36`). A clean
report therefore means no structural cycle, never zero coupling. That is the same honest limitation
the Trade-offs above already record for the reflection-based rules, stated at the rule this time.

### `ArchitectureRules.CancellationTokens`: trailing cancellation tokens
`AsyncMethodsDeclareTrailingCancellationToken(map, exemptMethods)`
(`.../ArchitectureRules.CancellationTokens.cs:35-37`) requires every method returning `Task`,
`Task<T>`, `ValueTask` or `ValueTask<T>`, **declared** (not inherited) as a public member of a
publicly-visible type in an `Application` or `Infrastructure` assembly, to take a `CancellationToken`
as its last parameter named exactly `cancellationToken` (`:15-18`, layer scope at `:45-47`, awaitable
check at `:105-112`, trailing check at `:120-122`, with distinct diagnostics for a misnamed versus a
mispositioned parameter at `:129-131`). Members are bound `Public | Instance | Static | DeclaredOnly`
(`:73-74`), so public **static** methods are in scope and inherited members are not. A method with no
parameters is not excused: the token would simply be its only parameter (`:18-19`).

The stated reason is mechanical pass-through rather than tidiness: a uniform trailing position and
name is what lets the ADR-014 decorator pipeline, the ADR-055 repositories and the generated clients
forward a linked token without special-casing each call, and an async method that cannot be cancelled
leaves work running against the database after its caller is gone (`:9-13`), which is exactly what the
new Timeout decorator's budget and a stopping host both produce.

Exemptions come in two kinds. **Automatic** ones cover signatures the repository does not own
(`:20-27`, implemented at `:95`, `:99-102`, `:148-149`): `Dispose` / `DisposeAsync`,
compiler-generated and special-name members (property accessors, operators, event accessors), members
of delegate types, an override of a base method declared outside the map's assemblies, and an implicit
implementation of an interface method declared outside them (`IHostedService.StartAsync`,
`IHealthCheck`, framework middleware). **Declared** ones go through
`CancellationTokenConventionTestsBase.CancellationTokenExemptMethods` in `"TypeName.MethodName"` form,
which the rule documents as being for cases where adding the parameter would break a shipped public
API, with the reason recorded beside the entry (`:44-48`).

The suite found exactly two real violations, both on `NotificationHub`
(`.../CancellationTokenConventionTests.cs:23-27`), and they are the interesting case because the
exemption is not a waiver. A SignalR hub method signature **is** the client-visible RPC contract, bound
by name and argument list by the dispatcher, and every shipped consumer's client already invokes
`JoinChannel` / `LeaveChannel` with one argument, so adding a parameter would break the wire contract
(`:14-22`). The work was made cancellable anyway: both methods pass `Context.ConnectionAborted` straight
into their group calls, so the token is there, just not through a parameter reflection can see. The
exemption records a genuine blind spot in the rule rather than an accepted defect.

### A third enforcement layer: the public API surface gate
This is the structural change to the Decision above, which framed enforcement as two layers (an MSBuild
project-reference guard and a NetArchTest suite). The gate is neither: it is a **compile-time analyzer
with a committed baseline**, `Microsoft.CodeAnalysis.PublicApiAnalyzers` 5.6.0
(`MMCA.Common/Directory.Packages.props:164`), applied to every `Source` project through one
`Directory.Build.props` ItemGroup rather than per csproj (`:78-85`), with `PublicAPI.Shipped.txt` and
`PublicAPI.Unshipped.txt` added as `AdditionalFiles` (`:83-84`). Fourteen projects carry the pair.
**`MMCA.Common.UI.Maui` is deliberately excluded** and the condition says why (`:73-76`): it lives
outside `MMCA.Common.slnx` and builds only on the windows `build-maui` job across four MAUI TFMs
(ADR-042), "so its baseline could neither be bootstrapped nor kept honest from the normal build".

The gate is exactly two rules: **RS0016** fails the build on a public member absent from
`PublicAPI.Shipped.txt` and **RS0017** on a declared member that disappeared
(`Directory.Build.props:68-71`, intent stated at `:26` and `.editorconfig:880-884`). Neither is
explicitly set to `error`: both are left at the repository's global analyzer-error default
(`dotnet_analyzer_diagnostic.severity = error`, `.editorconfig:312`, plus `TreatWarningsAsErrors`,
`Directory.Build.props:7`), so they are errors by inheritance rather than by their own entry.
Widening or breaking a package's shipped surface therefore becomes a reviewable diff in a text file
instead of something a consumer discovers after the release.

The baselines hold **5,068 declarations** across the fourteen files (5,082 non-empty lines, each file
opening with a `#nullable enable` header), and every `PublicAPI.Unshipped.txt` contains that header and
nothing else. **What is baselined is the surface as of this branch**, which is the v1.152.0 release
plus the unreleased Section A additions: the new rule-library types above already appear in
`MMCA.Common.Testing.Architecture/PublicAPI.Shipped.txt`, so this is not a frozen picture of the last
release. The gate consequently takes effect from the next release rather than retroactively. Nothing
in the repository records a version number for that start, so treat "the discipline begins with the
next release" as the decision and not as a cited fact.

Three rules from the same analyzer are off, each with the reason recorded rather than silently
suppressed (`.editorconfig:886-895`): **RS0026 / RS0027** (no multiple public overloads with optional
parameters) because the surface being baselined already ships those pairs, mostly the repository read
and query methods, so obeying the rule now would mean a breaking signature change on every consumer
("off rather than silently baselined as a lie"); and **RS0041** (no oblivious reference types in public
members) because every hit is inside Razor generated code that is not nullable-annotated and is not
ours to annotate. RS0041 additionally sits in the global `NoWarn` (`Directory.Build.props:22-27`), and
the duplication is load-bearing rather than sloppy: a `dotnet_diagnostic` severity does not reach
generated code, so the `.editorconfig` entry alone would not suppress it. RS0051-RS0056, the
internal-API analog over `InternalAPI.Shipped.txt`, are off too (`.editorconfig:896-903`): only the
public, packaged surface is under contract.

**This formalizes what the `consumer-source-build` canary only sampled.** That CI job builds
MMCA.Helpdesk against the PR's framework source, so it catches a breaking public-API change only where
Helpdesk happens to use the member; the baselines catch it at the declaration, for the whole surface,
in the repository that owns it.

### What this revision costs
- **The Decision's "two layers" framing is now wrong as written**, and the three layers fail at three
  different moments with three different diagnostics: a `ProjectReference` violation at pre-build, a
  public-surface change at compile, a structural rule at test time.
- **A baseline is a file that must be maintained, and its failure mode is friction.** Every deliberate
  public API addition now needs a `PublicAPI.Unshipped.txt` edit in the same PR, and an author who does
  not know the gate exists meets it as an `error` on a build that was previously green.
- **Both new rules ship with a live exemption**, so neither is a clean sweep: one accepted namespace
  cycle and two exempted hub methods. Recorded that way on purpose, since a rule with no exemption hook
  either gets deleted or gets satisfied by a worse design.
- **The cycle rule cannot see method bodies and the token rule cannot see `Context.ConnectionAborted`.**
  Both are structural checks over signatures, which is the same limitation the Trade-offs above already
  accept for this whole suite, now with two more instances of it.
- **The token rule's return-type test is a closed list.** Only `Task`, `Task<T>`, `ValueTask` and
  `ValueTask<T>` qualify (`ArchitectureRules.CancellationTokens.cs:105-112`), so an
  `IAsyncEnumerable<T>` method or any custom awaitable is silently out of scope despite being exactly
  the kind of long-running work a token exists for.
- **The public API gate covers 14 of the 15 packages, and only in MMCA.Common.** `MMCA.Common.UI.Maui`
  is excluded for build-topology reasons even though it has its own required windows build gate, so
  "every shipped package's surface is gated" would be an overstatement. ADC, Store and Helpdesk publish
  nothing and get no baselines, which leaves the three enforcement layers unevenly distributed across
  the four repos.

## Related
ADR-009 (resilience gate), ADR-010 (event-version gate), ADR-016 (MassTransit pin gate, and the
lockstep release cadence the public API baseline is pinned to), ADR-006/007/008 (the transport and
module-isolation rules the suite enforces), ADR-053 (the dual-registry publishing this surface gate
protects: the packages whose consumers a breaking change reaches),
[ADR-014](014-cqrs-decorator-pipeline.md) and
[ADR-055](055-repository-and-specification-contract.md) (the decorator pipeline and repository contract
whose mechanical token pass-through the trailing-`CancellationToken` rule exists to keep possible),
ADR-058 (the runtime conformance suites, the behavioral counterpart this record deliberately scopes
itself against).
