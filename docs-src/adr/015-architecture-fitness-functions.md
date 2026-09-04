# ADR-015: Architecture Invariants Enforced as Fitness Functions

## Status
Accepted. Revised 2026-08-18 (two new rule families, namespace dependency cycles and trailing
`CancellationToken` declarations, plus a **third enforcement layer**: a compile-time public-API surface
gate with committed baselines. The "in two layers" framing in the Decision below is superseded; see the
Revision (2026-08-18) at the end). Revised again the same day for the Section B wave: two further rule
families join the library, a `.proto` wire-contract gate and an idempotency-intent gate, and the counts
move to **104 test methods across 36 bases**, superseding the 102/34 figure the first revision
recorded. See the second section, Revision (2026-08-18): Section B rule families. Revised 2026-08-18
against the released framework v1.154.0: MMCA.Common's own build then executed **99** of the 104 methods
and the public-API baselines then held **5,150 declarations**. Revised 2026-08-23: the method and base
counts moved again and are no longer restated in this record's live text, since `MMCA.Common/FACTS.md`
owns them (`:46`, `:49`) and is drift-gated in CI; the Decision's `--minimum-expected-tests` figure is
corrected to the floor CI actually applies. See Revision (2026-08-23) at the end. Revised 2026-09-01:
the public-API gate's file, declaration and coverage figures are corrected in place (sixteen baseline
pairs, one per published package except `MMCA.Common.UI.Maui`, with the package count left to
`MMCA.Common/FACTS.md`), and three citations are re-anchored. See Revision (2026-09-01) at the end.
Revised 2026-09-03: the one accepted namespace cycle changed shape (its middle node is `Messaging`, not
the dissolved `Settings` folder), the shared rule library and MMCA.Common's own subclasses moved into
feature folders, and the unshipped-baseline declaration figure is re-counted. See
Revision (2026-09-03) at the end.

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
other test (the whole-solution run that carries them is additionally floored at
`--minimum-expected-tests 2000`, `.github/workflows/ci.yml:144`, so a discovery or filter regression
that silently drops the suite fails the job instead of passing green on a handful of tests). Centralizing the rules in a package, rather than copying them per repo, means a new
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
`Tests/Architecture/MMCA.Common.Architecture.Tests`, which is inside `MMCA.Common.slnx` (`:52`) and
therefore runs in the `build-and-test` job (`.github/workflows/ci.yml:135-144`), and the public API
gate fails that same job's build step (`ci.yml:106-108`); `build-and-test` is one of the eight required
gates on `main` (`CONTRIBUTING.md:60-61`). One caveat: a docs-only PR skips restore, build and test by
path filter (`ci.yml:103,107,136`) while still reporting green, so none of this fires on a
documentation change.

### `ArchitectureRules.Cycles`: namespace dependency cycles
`NamespacesHaveNoDependencyCycles(map, allowedCycleNamespaces)`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Cycles.cs:45-47`)
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
(`Bases/Layering/NamespaceCycleTestsBase.cs:15`, test at `:29`) and override `AllowedCycleNamespaces`. Note that
the XML doc on both the rule (`:41-43`) and the base (`NamespaceCycleTestsBase.cs:22-23`) describes the
check in terms of the cycle's *path*; the code is the stricter whole-component test above, and the code
is what runs.

MMCA.Common has exactly one accepted tangle, inside `MMCA.Common.Infrastructure`:
`root -> Messaging -> Persistence -> root`
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/NamespaceCycleTests.cs:42-47`),
and the subclass justifies it **per edge** rather than as a blanket allowance (`:13-41`): the
composition root binds the buses and their settings, the buses **are** the outbox transport
(`InProcessEventBus` and `BrokerEventBus` enqueue `OutboxMessage` rows and wake the `OutboxProcessor`
through `IOutboxSignal`, so splitting the two would put half of one delivery guarantee on each side of
a package boundary), and the `EntityTypeConfiguration*` shims carry the `[UseDataSource]` /
`[UseDatabase]` marker attributes that live in the root namespace precisely because consumers annotate
their own configurations with them. All three namespaces ship in one assembly and one package, so none
is independently extractable and the tangle costs nothing the layer rules were protecting. The middle
node changed with the 2026-09 feature-by-folder reorganization and the subclass records the change
itself (`:38-40`): the `Settings` folder dissolved into the features it configured, and the tenancy
validator that carried the old `Settings -> Persistence` edge now lives in `Persistence/Tenancy`.

**The rule is a signature-level statement and says so.** The testing package carries no IL or Roslyn
dependency, so this is pure reflection: a reference that exists only inside a method body (a local, a
constructor call, a static call) is invisible to it, and compiler-generated closure and iterator types
are skipped deliberately so the result stays signature-level rather than half-body (`:30-36`). A clean
report therefore means no structural cycle, never zero coupling. That is the same honest limitation
the Trade-offs above already record for the reflection-based rules, stated at the rule this time.

### `ArchitectureRules.CancellationTokens`: trailing cancellation tokens
`AsyncMethodsDeclareTrailingCancellationToken(map, exemptMethods)`
(`.../Rules/Cqrs/ArchitectureRules.CancellationTokens.cs:35-37`) requires every method returning `Task`,
`Task<T>`, `ValueTask` or `ValueTask<T>`, **declared** (not inherited) as a public member of a
publicly-visible type in an `Application` or `Infrastructure` assembly, to take a `CancellationToken`
as its last parameter named exactly `cancellationToken` (`:15-18`, layer scope at `:45-47`, awaitable
check at `:105-112`, trailing check at `:120-122`, with distinct diagnostics for a misnamed versus a
mispositioned parameter at `:129-131`). Members are bound `Public | Instance | Static | DeclaredOnly`
(`:73-74`), so public **static** methods are in scope and inherited members are not. A method with no
parameters is not excused: the token would simply be its only parameter (`:17-18`).

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
API, with the reason recorded beside the entry (`:30-34`, and the base's own wording at
`Bases/Cqrs/CancellationTokenConventionTestsBase.cs:21-26`).

The suite found exactly two real violations, both on `NotificationHub`
(`.../Cqrs/CancellationTokenConventionTests.cs:23-27`), and they are the interesting case because the
exemption is not a waiver. A SignalR hub method signature **is** the client-visible RPC contract, bound
by name and argument list by the dispatcher, and every shipped consumer's client already invokes
`JoinChannelAsync` / `LeaveChannelAsync` (the two exemption entries, `:25-26`) with one argument, so
adding a parameter would break the wire contract (`:14-22`). The work was made cancellable anyway: both methods pass `Context.ConnectionAborted` straight
into their group calls, so the token is there, just not through a parameter reflection can see. The
exemption records a genuine blind spot in the rule rather than an accepted defect.

### A third enforcement layer: the public API surface gate
This is the structural change to the Decision above, which framed enforcement as two layers (an MSBuild
project-reference guard and a NetArchTest suite). The gate is neither: it is a **compile-time analyzer
with a committed baseline**, `Microsoft.CodeAnalysis.PublicApiAnalyzers` 5.6.0
(`MMCA.Common/Directory.Packages.props:199`), applied to every `Source` project through one
`Directory.Build.props` ItemGroup rather than per csproj (`:86-93`), with `PublicAPI.Shipped.txt` and
`PublicAPI.Unshipped.txt` added as `AdditionalFiles` (`:91-92`). Sixteen projects carry the pair, one
for every published package except the single exclusion below.
**`MMCA.Common.UI.Maui` is deliberately excluded** and the condition says why (`:82-84`): it lives
outside `MMCA.Common.slnx` and builds only on the windows `build-maui` job across four MAUI TFMs
(ADR-042), "so its baseline could neither be bootstrapped nor kept honest from the normal build".

The gate is exactly two rules: **RS0016** fails the build on a public member absent from
`PublicAPI.Shipped.txt` and **RS0017** on a declared member that disappeared
(`Directory.Build.props:77-80`, intent stated at `:26` and `.editorconfig:888-890`). Neither is
explicitly set to `error`: both are left at the repository's global analyzer-error default
(`dotnet_analyzer_diagnostic.severity = error`, `.editorconfig:312`, plus `TreatWarningsAsErrors`,
`Directory.Build.props:7`), so they are errors by inheritance rather than by their own entry.
Widening or breaking a package's shipped surface therefore becomes a reviewable diff in a text file
instead of something a consumer discovers after the release.

The shipped baselines hold **5,034 declarations** across the sixteen files (5,050 non-empty lines, each
file opening with a `#nullable enable` header; two of them, `MMCA.Common.Gateway` and the `MMCA.Common`
metapackage, hold the header alone). The `PublicAPI.Unshipped.txt` files are no longer header-only
stubs: fourteen of the sixteen now carry **1,486 declarations** of surface added since their shipped
baseline was last written, the two exceptions being `MMCA.Common.UI.Web` and the `MMCA.Common`
metapackage. **What is baselined is the surface as of this branch**, which is whichever release
`MMCA.Common/FACTS.md:14` currently names (v1.154.0 when this revision was written; the figures above
were re-counted on 2026-09-03), so they cover the Section A additions this
revision described plus every wave that followed, not a frozen picture of one release. The
start version is no longer uncited: the gate shipped in v1.153.0, whose changelog entry names
`Microsoft.CodeAnalysis.PublicApiAnalyzers` on every in-slnx Source project with committed baselines as
one of three new build gates (`MMCA.Common/CHANGELOG.md:1480-1486`, the analyzer named on `:1484`,
under the v1.153.0 heading at `:1425`). The discipline therefore begins with
v1.153.0 rather than applying retroactively.

Three rules from the same analyzer are off, each with the reason recorded rather than silently
suppressed (`.editorconfig:893-902`): **RS0026 / RS0027** (no multiple public overloads with optional
parameters) because the surface being baselined already ships those pairs, mostly the repository read
and query methods, so obeying the rule now would mean a breaking signature change on every consumer
("off rather than silently baselined as a lie"); and **RS0041** (no oblivious reference types in public
members) because every hit is inside Razor generated code that is not nullable-annotated and is not
ours to annotate. RS0041 additionally sits in the global `NoWarn` (`Directory.Build.props:22-27`), and
the duplication is load-bearing rather than sloppy: a `dotnet_diagnostic` severity does not reach
generated code, so the `.editorconfig` entry alone would not suppress it. RS0051-RS0056, the
internal-API analog over `InternalAPI.Shipped.txt`, are off too (`.editorconfig:903-910`): only the
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
- **The public API gate covers every published package except one, and only in MMCA.Common.** The
  package list and count live in `MMCA.Common/FACTS.md` and are deliberately not restated here.
  `MMCA.Common.UI.Maui`
  is excluded for build-topology reasons even though it has its own required windows build gate, so
  "every shipped package's surface is gated" would be an overstatement. ADC, Store and Helpdesk publish
  nothing and get no baselines, which leaves the three enforcement layers unevenly distributed across
  the four repos.

## Revision (2026-08-18): Section B rule families
A second entry on the same date, kept separate rather than folded into the one above because it lands
with a different wave and changes a number that revision states. Two rule families join the shared
library, and both are **consumer-facing**: the framework ships the rule and exercises it, but the thing
being pinned lives in a consumer repository.

**The counts in the preceding revision are superseded.** `MMCA.Common/FACTS.md:44` read, on the date of
this entry, 104 test methods across 36 abstract `*TestsBase` classes, of which MMCA.Common's own build
executed 99 (`FACTS.md:47`), where the entry above recorded 102 across 34 with 87 executed (both are
themselves superseded: see Revision (2026-08-23)). Those figures were
correct when written and are left in place, consistent with how this library treats a superseded count.
Cite `FACTS.md` rather than either number: it is generated by `FactsGenerator` and gated against drift
in CI, so it cannot quietly disagree with the code the way a transcribed figure can.

### `ArchitectureRules.Protos`: the gRPC wire contract gets the freeze integration events already had
[ADR-010](010-integration-event-schema-versioning.md) made every integration-event payload a versioned,
contract-tested shape. The other cross-service wire format, [ADR-007](007-grpc-extraction.md)'s
protobuf contracts, had nothing equivalent: renumbering a field or flipping a streaming flag is a
silent, binary-compatible-looking change that breaks every deployed peer, and only a code review stood
between it and a release.

`ArchitectureRules.Protos`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Protos.cs:37`)
parses a
repository's `.proto` files and compares them against a frozen list. What is pinned is exactly the
wire: the `package`; every service rpc with its name, request and response types and **both** streaming
flags (`:198-208`, `:299-312`); every message field with its name, declared type, label and **number**
(`:219-227`); every enum value with its number (`:211-217`); and nested types under their qualified
name (`:234-241`). A `oneof` is transparent, its members pinned as ordinary fields (`:182-185`).

What is **deliberately not pinned** is `syntax`, `import` and every `option`, `csharp_namespace`
included (`:27-31`). The line is drawn at "would a deployed peer notice": a reordered import or a
changed file-level option produces the same bytes on the wire, and pinning them would turn a formatting
change into a red build. Consumers subclass `ProtoContractTestsBase`
(`.../Bases/Contracts/ProtoContractTestsBase.cs:19`), supplying `SolutionFileName`, `ProtoFiles` and
`FrozenProtoContracts`, with one `[Fact]` as the whole body (`:32-34`).

**MMCA.Common ships no `.proto` of its own and does not subclass the base.** The only proto files in
the repository are a matched fixture pair,
`Tests/Architecture/MMCA.Common.Architecture.Tests/TestData/fitness-catalog.proto` and its deliberately
drifted twin, driven through the rule by five `[Fact]`s in `ProtoContractFitnessTests`
(`.../Contracts/ProtoContractFitnessTests.cs:14`, the fixture pair at `:20-22`, the cases at `:44`, `:52`, `:66`,
`:76` and `:89`). A clean fixture proves the
parser accepts a real contract and a drifted one proves the rule actually fails, a missing path fails
loudly rather than pinning an empty contract (`:76-87`), and one case asserts the unpinned `syntax`,
`import` and `option` lines really are ignored (`:89-98`), which is the only way
a rule whose subject lives in another repository can be tested by the repository that owns it.

### The idempotency-intent gate
`IdempotencyConventionTestsBase` requires every `[HttpPost]` action to declare `[Idempotent]` or
`[NonIdempotent(justification)]`, inherit-aware, over concrete controllers. It is the same
invariant-over-discipline move this record has made for resilience, event versioning and concurrency,
applied to a decision that was previously expressed by an attribute's absence. The rule, its scope
limits (POST only, simple-name matching) and the auth controllers' declarations are recorded where they
belong, in [ADR-017](017-request-idempotency.md)'s Revision (2026-08-18).

### What this revision costs
- **A frozen list is another baseline to maintain.** `FrozenProtoContracts` is the same shape of
  obligation as `PublicAPI.Shipped.txt` above: a deliberate contract change means editing the list in
  the same PR, and an author who does not know the gate exists meets it as a failing test.
- **The unpinned options are not entirely harmless.** Changing `csharp_namespace` breaks the generated
  client code in every consumer even though the wire is untouched, and this gate passes it. The rule
  protects the protocol, not the compile, and that distinction is easy to misread as "protos are
  gated".
- **Both new families are consumer-facing, so Common's own green build proves less than usual.** The
  proto rule is exercised against fixtures rather than a real contract, and the idempotency rule needs
  a consumer's controllers to have anything to say. The count of methods the framework executes (99 of
  104) is the honest version of that gap.
- **Six rule families now carry an exemption, allowance or scope limit each.** Accepted cycles,
  exempted hub methods, unpinned proto options, POST-only intent: every family ships with a documented
  hole, which is what keeps them adoptable and also what makes "the suite is green" a weaker statement
  than it sounds.

## Revision (2026-08-23): superseded counts, a re-anchored citation, and the real test floor
No rule family joined or left the library in this entry. It corrects three things the two 2026-08-18
revisions above state, and it is kept as its own entry rather than edited into them because those
entries were correct when written.

**The counts are superseded a second time, and this record stops restating them.**
`MMCA.Common/FACTS.md` is generated by `FactsGenerator` and gated against drift in CI, so it is the
only place either figure can be read without a transcription risk. As of 2026-08-23 (framework
v1.160.0, `FACTS.md:4`, `:14`) it reads **110 test methods across 38 abstract `*TestsBase` classes**
(`FACTS.md:44`), of which MMCA.Common's own build executes **129** (`FACTS.md:47`), where the first
revision recorded 102 across 34 with 87 executed and the Section B entry recorded 104 across 36 with 99
executed. Read `FACTS.md`, not this paragraph, for the current values.

**The "N of M executed" framing in the Section B cost list no longer parses, and that is the honest
correction, not a rounding.** The executed figure now exceeds the shipped method count because it
counts the methods of the bases MMCA.Common subclasses **plus** its Common-only direct tests
(`FrameworkSanityTests`, `SpecificationFitnessTests`), which `FACTS.md:47` says in its own parenthetical.
So "the framework executes 99 of 104" cannot be restated as "129 of 110": the two numbers are no longer
a subset and its container. The gap that bullet was pointing at, consumer-facing families whose subject
lives in another repository, is unchanged and still real (the proto rule runs against fixtures, the
idempotency rule needs a consumer's controllers); it simply cannot be measured by subtracting one
`FACTS.md` line from the other any more.

**The Decision's test-count floor was wrong and is corrected in place.** The architecture tests have no
floor of their own: they run inside the whole-solution step of `build-and-test`, which is floored at
`--minimum-expected-tests 2000` against a suite of roughly 2,254 (`.github/workflows/ci.yml:141-144`).
The value 1 belongs to a different job entirely, the `ui-e2e` matrix, which runs the out-of-slnx
`MMCA.Common.UI.E2E.Tests` project by path (`ci.yml:301`). The correction makes the guard weaker than
the Decision claimed in one specific way worth naming: a floor of 2,000 over a 2,254-test suite would
not notice the architecture suite disappearing on its own, only a collapse of the whole run. A
per-project floor is only available to a job that runs one project by path, which is what the `ui-e2e`
job does and the solution-wide run cannot.

**One citation was re-anchored, not rewritten.** The v1.153.0 changelog bullet naming
`Microsoft.CodeAnalysis.PublicApiAnalyzers` is verbatim unchanged but has moved to
`MMCA.Common/CHANGELOG.md:1480-1486` (its release heading at `:1425`) as newer releases were prepended
above it. Line-anchored citations into an append-at-top file are a known cost of citing this precisely;
the alternative, citing nothing, is worse. The anchors above are the current ones and are re-anchored
in place on each audit, since a pointer that has drifted is broken rather than merely superseded.

## Revision (2026-09-01): the public API gate's real coverage, and re-anchored citations
No rule family joined or left the library in this entry and no decision changed. It corrects the
public-API figures the first 2026-08-18 revision recorded, which had gone stale as the framework grew,
and it re-anchors three citations that moved.

**The gate is wider than this record said, and the coverage ratio is retired rather than updated.**
Sixteen `Source` projects carry the `PublicAPI.Shipped.txt` / `PublicAPI.Unshipped.txt` pair, one for
every published package except `MMCA.Common.UI.Maui`, where the first revision counted fourteen
projects and described the gate as covering "14 of the 15 packages". The package count is no longer
restated in this record at all: `MMCA.Common/FACTS.md` owns the package list and is generated and
drift-gated in CI, and a transcribed "N of M" here is precisely the figure that went stale. What this
record states instead is the shape of the coverage, which the MSBuild condition itself guarantees:
every `Source` project except the one the condition names by hand
(`MMCA.Common/Directory.Build.props:86`).

**The declaration figures were re-counted and the unshipped files are no longer empty.** The shipped
baselines hold 5,034 declarations across 5,050 non-empty lines, where the first revision recorded 5,150
across 5,164 for fourteen files, and the `PublicAPI.Unshipped.txt` files, described in that revision as
holding the `#nullable enable` header and nothing else, now carry 1,457 declarations between fourteen
of the sixteen. That is the gate working, not a backlog: surface added since a baseline was last
written has to be declared somewhere for the build to stay green, and the unshipped file is where it
lands. Both figures are a reading of one branch on one date and will move with the next wave, which is
why the sentence around them points at `FACTS.md:14` for the release they describe.

**Three citations were re-anchored, not rewritten.** The `Microsoft.CodeAnalysis.PublicApiAnalyzers`
`PackageVersion` moved to `MMCA.Common/Directory.Packages.props:199` (a `Meziantou.Analyzer` entry was
inserted above it in the Analyzers block); the v1.153.0 changelog bullet moved to
`MMCA.Common/CHANGELOG.md:1480-1486` under its heading at `:1425`, the append-at-top cost the
2026-08-23 entry above predicted; and the proto fixture pair's citation now names the test class and
its five cases (`ProtoContractFitnessTests.cs:14`, `:20-22`, `:44`, `:52`, `:66`, `:76`, `:89`) rather
than a line inside that file's XML doc comment. The two `FACTS.md` pointers in the Status block moved
from `:44` / `:47` to `:46` / `:49` as that generated file grew; the dated readings inside the
revisions above keep their own anchors, since re-pointing a historical number at a line that now says
something else would be worse than leaving it dated.

## Revision (2026-09-03): the accepted cycle's middle node, the feature-folder move, re-anchored citations
No rule family joined or left the library in this entry and no decision changed. One accepted allowance
changed shape, the files that hold the rules and the tests moved, and the citations that moved with them
are re-anchored.

**The one accepted namespace cycle now runs through `Messaging`, not `Settings`.** The tangle inside
`MMCA.Common.Infrastructure` is `root -> Messaging -> Persistence -> root`
(`.../Layering/NamespaceCycleTests.cs:42-47`), and the middle edge's justification changed with it: the
buses **are** the outbox transport (`InProcessEventBus` and `BrokerEventBus` enqueue `OutboxMessage`
rows and wake the `OutboxProcessor` through `IOutboxSignal`), where the old `Settings -> Persistence`
edge rested on `TenancySettingsValidator` taking an optional `IDataSourceResolver`. The `Settings`
folder dissolved into the features it configured and the tenancy validator now lives in
`Persistence/Tenancy`, which the subclass records in its own XML doc (`:38-40`). The shape of the
allowance is unchanged: still exactly one accepted component, still checked against the whole strongly
connected component rather than a path, so a fourth namespace joining it still fails. The Section A
passage is rewritten in place rather than kept dated, because it describes a live allowance rather than
a reading taken on a date.

**The rules and the tests moved into feature folders, and no rule body moved with them.** The shared
library now groups its rules and bases by concern: `Rules/Layering/ArchitectureRules.Cycles.cs`,
`Rules/Cqrs/ArchitectureRules.CancellationTokens.cs`, `Rules/Contracts/ArchitectureRules.Protos.cs`,
`Bases/Layering/NamespaceCycleTestsBase.cs`, `Bases/Cqrs/CancellationTokenConventionTestsBase.cs` and
`Bases/Contracts/ProtoContractTestsBase.cs`. MMCA.Common's own subclasses follow the same split
(`Layering/NamespaceCycleTests.cs`, `Cqrs/CancellationTokenConventionTests.cs`,
`Contracts/ProtoContractFitnessTests.cs`, with `FrameworkSanityTests` under `Governance/` and
`SpecificationFitnessTests` under `Domain/`). Every line anchor inside those files still resolves, so
only the directory segment of each citation changed: this is a re-anchor, not a rewrite.

**The unshipped declaration figure was re-counted; the shipped one had not moved.** The
`PublicAPI.Unshipped.txt` files hold **1,486 declarations** across 1,502 non-empty lines, where the
2026-09-01 entry read 1,457, and still exactly fourteen of the sixteen carry content (the two
header-only exceptions are still `MMCA.Common.UI.Web` and the `MMCA.Common` metapackage). The shipped
baselines are unchanged at 5,034 across 5,050 non-empty lines. That the unshipped side grows between
audits while the shipped side holds is the gate behaving as designed: surface added since a baseline
was last written lands in the unshipped file and stays there until a release rolls it over.

**The other re-anchored citations.** The architecture test project's entry in `MMCA.Common.slnx` moved
from `:46` to `:52`. The v1.153.0 changelog bullet moved a second time, to
`MMCA.Common/CHANGELOG.md:1480-1486` (the analyzer named on `:1484`) under its heading at `:1425`; that
is the append-at-top cost the 2026-08-23 entry predicted, now on its second occurrence, and it is
re-anchored in the two revision entries that cite it as well as in the live text. The three
`.editorconfig` blocks for the public API gate are `:888-890` (the intent), `:893-902` (the three rules
turned off with their reasons) and `:903-910` (RS0051-RS0056). The token rule's "a method with no
parameters is not excused" sentence spans `:17-18`, not `:18-19`. The declared-exemption doc is the
rule's `exemptMethods` `<param>` at `:30-34`, where `:44-48` had pointed into the method body. And the
two exempted hub methods are entered as `JoinChannelAsync` and `LeaveChannelAsync`, which is the form
the rule matches, so the Section A passage now uses those names rather than the shorter ones the
surrounding XML doc prose uses.

**One known-broken pointer is left broken on purpose.** The dated `FACTS.md` readings inside the
revisions above keep their original anchors under the convention the 2026-09-01 entry set, so
`FACTS.md:44` and `:47` as cited there no longer point at the lines those numbers were read from. The
live pointers in the Status block, `FACTS.md:46` and `:49`, do still resolve to the method and executed
counts. Re-pointing a historical reading at a line that now says something else would be worse than
leaving it dated, but a reader following one of those anchors should expect to land on unrelated text.

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
