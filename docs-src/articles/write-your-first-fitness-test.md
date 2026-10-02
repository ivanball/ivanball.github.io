# Write your first architecture fitness test

> Series: MMCA.Common · Article #40 (tutorial) · Pillar P5 · Group G25 · Rubric §34 · ADR-015 ·
> Status: grounded in `Website/docs-src/adr/015-architecture-fitness-functions.md`,
> `MMCA.Common/AGENTS.md` ("Architecture", the two enforcement gates), `MMCA.Common/README.md` (Testing.Architecture
> package row), and `Docs/Onboarding/parts/group-28-testing-infrastructure-p00.md` (assembled and
> published as `Website/docs-src/onboarding/group-28-testing-infrastructure.md`). No em dashes.

**Subtitle:** Your Clean Architecture diagram is a hope, not a guarantee, until something fails the
build when it is violated. Here is how to add NetArchTest fitness functions to your own solution in
under an hour, by inheriting a rule library instead of writing one.

---

Every codebase has a layering diagram. Domain depends on nothing above it; Application does not know
about EF Core; the message broker stays at the edges. The diagram lives in a README, or a wiki, or a
senior engineer's head, and it is true on the day it is drawn.

Then time passes. A handler needs an entity by id, so someone adds a `using` for the DbContext namespace
to the Application layer because it was right there. A domain class references `Microsoft.AspNetCore.Http`
to read a header "just this once." Each step is reasonable in isolation, and each one quietly erodes the
boundary the diagram promised. By the time anyone notices, the dependency graph is a plate of spaghetti
and the diagram is a historical document.

Code review is supposed to catch this, and it does, sometimes, when the reviewer happens to know the
rule and happens to look at the right line. That is not enforcement; that is luck. ADR-015 in
MMCA.Common takes the other position: **if an architectural rule matters, it should be an automated
check that fails the build, not a comment that depends on a reviewer.** This tutorial shows you how to
add those checks to your own solution, and the surprising part is how little code you write to get a
large rule library.

## Why rules-as-code beats review

Before the steps, the thesis, because it shapes everything below. An architecture invariant is easy to
state ("Domain depends on nothing above it") and easy to erode by accident. "Remember the rule" does not
survive a growing change history across a growing team. Turning "do not do X" into a red build is the
only enforcement that scales: it is impartial, it never gets tired, and it catches the violation in the
pull request that introduced it, not three months later in a refactor.

MMCA.Common enforces its layer rules **twice**, on purpose:

1. **At compile time**, by an MSBuild target (`MMCA.Common.LayerEnforcement.targets`) that inspects
   project references in a pre-build step and fails the build with a descriptive error if a layer
   references a forbidden upstream layer. Fastest possible feedback, catches the most common mistake.
2. **At runtime**, by NetArchTest fitness functions that assert the same rules against the compiled
   assemblies, catching the subtler violations a project-reference check cannot see (a type in the
   wrong namespace, a transitive `using`, a missing convention).

A third gate sits alongside those two, and ADR-015 as revised records the enforcement as running in
three layers. It is neither MSBuild nor NetArchTest: `Microsoft.CodeAnalysis.PublicApiAnalyzers` runs on
every published package except `MMCA.Common.UI.Maui` (excluded by name, because it builds only on the
Windows MAUI job outside the main solution) against a committed `PublicAPI.Shipped.txt` baseline (one
per gated package, twenty-one files), so adding or removing a public member fails the compile until that
text file is updated in the same pull request. It guards the shipped package surface rather than layer
flow, which is why the two speeds above are the ones this tutorial teaches.

This article is about adding the second layer to your own code, and optionally the first.

## Prerequisites

- A .NET solution with a layered shape you want to protect. The MMCA layers are
  API/Grpc -> Infrastructure -> Application -> Domain -> Shared, but the rule library generalizes.
- **Microsoft Testing Platform** as your test runner (MMCA.Common uses it via `global.json` with
  xUnit v3). The fitness tests run inside the normal `dotnet test` tier, so they gate CI like any other
  test.
- The package you are about to install: **`MMCA.Common.Testing.Architecture`**, one of the twenty-two
  packages the framework publishes. Its README row describes it exactly: "`IArchitectureMap` + reusable
  NetArchTest rule library + abstract test bases (consumed by each repo's `*.Architecture.Tests`)."

The key design idea: the rule *bodies* ship in the package once. You do not copy them. You supply a tiny
map of your assemblies and subclass the bases, and you inherit roughly the same suite that runs across
MMCA.Common, MMCA.Store, MMCA.ADC and MMCA.Helpdesk (141 test methods across 55 abstract `*TestsBase`
classes; the framework's own build executes 339 of them).

> **If you scaffolded with `dotnet new mmca-app`, steps 1 through 4 are already done.** The generated
> solution ships the architecture-test project, the `IArchitectureMap`, and every applicable base
> subclassed (32 sealed subclasses in the current reference-app seed), including the wire-contract
> freeze, which arrives frozen under your own names and green on the first `dotnet test`. Read those
> steps anyway to know what you have, then skip to Step 5. If you are retrofitting an existing
> solution, the steps are the work.

## Step 1: install the package and create a test project

Add a dedicated architecture-test project (mirroring how the framework keeps
`Tests/Architecture/*.Architecture.Tests`), and reference the package:

```powershell
dotnet add package MMCA.Common.Testing.Architecture
```

The package brings the NetArchTest engine (NetArchTest.eNhancedEdition), the `ArchitectureRules` rule
library, the diagnostic helpers, and the 55 abstract `*TestsBase` classes. You will not write rule
logic; you will point the rules at your assemblies and subclass the bases.

## Step 2: implement `IArchitectureMap`, one anchor type per layer

This is the only real work, and it is small. `IArchitectureMap` is the single extension point every rule is
parameterized by. You declare your layers (and modules, if you have them) by pinning **one anchor type
per layer or package**: a type whose assembly the rules scan. Subclass `ArchitectureMapBase`, override
`RepoToken` and `DefineLayers()`, and return a handful of one-line `Framework(...)` / `Module(...)`
entries:

```csharp
// Your solution's MyApp.Architecture.Tests project (representative)
internal sealed class MyAppArchitectureMap : ArchitectureMapBase
{
    public override string RepoToken => "MyApp";

    // One anchor type per layer; the type's assembly IS the layer.
    protected override IEnumerable<LayerRef> DefineLayers() =>
    [
        Framework(Layer.Shared,         typeof(MyApp.Shared.Result).Assembly),
        Framework(Layer.Domain,         typeof(MyApp.Domain.Entities.BaseEntity<>).Assembly),
        Framework(Layer.Application,    typeof(MyApp.Application.DependencyInjection).Assembly),
        Framework(Layer.Infrastructure, typeof(MyApp.Infrastructure.ApplicationDbContext).Assembly),
        Framework(Layer.Api,            typeof(MyApp.Api.ApiControllerBase).Assembly),

        // If you have modules, declare each module's layers the same way:
        // Module("Sales", Layer.Domain, typeof(MyApp.Sales.Domain.Order).Assembly),
    ];
}
```

That is the "what to scan" half. The package's `ArchitectureRules` are the "what to assert" half. The
framework's own `CommonArchitectureMap` is module-less (every layer is a framework layer, seven `Framework(...)`
entries, one anchor per layer it scans); ADC's `AdcArchitectureMap` adds module entries the same way. Your map looks like one of those,
scaled to your solution.

## Step 3: subclass the test bases to inherit the rule library

Now your test classes shrink to thin sealed subclasses that supply the map and inherit the `[Fact]`s.
Two of the most valuable bases to start with:

```csharp
// Layer-flow rules: 15 facts (13 forbidden edges + 2 map guards) (representative)
public sealed class LayerDependencyTests : LayerDependencyTestsBase
{
    protected override IArchitectureMap Map { get; } = new MyAppArchitectureMap();
}

// Domain/Shared framework-purity rules (representative)
public sealed class DomainPurityTests : DomainPurityTestsBase
{
    protected override IArchitectureMap Map { get; } = new MyAppArchitectureMap();
}
```

That is genuinely the whole test class: three lines plus the override. What you just inherited:

- **`LayerDependencyTestsBase`** asserts the inward dependency rule across every assembly your map
  declares: Domain must not depend on Application/Infrastructure/API, Application must not depend on
  Infrastructure/API, and so on, with one named `[Fact]` per forbidden edge. A named test per edge ("UI
  references Domain") gives you a precise red instead of an opaque "layering broken." Thirteen of its
  fifteen `[Fact]`s are those edges; the other two assert that your map actually declares every expected
  layer, and that every module declares its layers, so the edge rules cannot pass vacuously against a
  map that forgot an assembly.
- **`DomainPurityTestsBase`** asserts that Domain and Shared stay free of infrastructure frameworks and
  that Application stays host-agnostic (no EF Core, no ASP.NET Core in Application). It even exposes a
  `protected virtual ExtraForbiddenDomainDependencies` so your repo can *add* bans on top of the shared
  list (Store's subclass bans `"RabbitMQ"` and `"Stripe"` from Domain, the broker client and the payment
  SDK, which the base names only generically in its doc comment as "a payment SDK or a broker client")
  without editing the package.

The other bases cover more ground when you are ready: `MicroserviceExtractionTestsBase` (no MassTransit,
gRPC or Protobuf in Application/Domain/Shared), entity and aggregate conventions (aggregates have no public constructors,
a `Result`-returning `Create` factory, entities are sealed and live in the Domain layer), concurrency
awareness, controller conventions, and PII conventions (`[Pii]` implies `IAnonymizable`). You opt into
each by adding a subclass.

## Step 4: run the suite under Microsoft Testing Platform

The fitness tests are ordinary tests in your test tier, so they run with the same command as everything
else:

```powershell
# Run just the architecture suite
dotnet test --project Tests/Architecture/MyApp.Architecture.Tests

# Target one rule by method (Microsoft Testing Platform filter, after --)
dotnet test --project Tests/Architecture/MyApp.Architecture.Tests -- --filter-method "*Domain_ShouldNot*"
```

Because they run in the normal tier, a violated invariant fails CI exactly like a failing unit test. One
operational note: Microsoft Testing Platform fails the build if a test project discovers zero tests, so
make sure your subclasses are public and actually inherit `[Fact]`s. The framework's CI even floors its
test steps with `--minimum-expected-tests` (`1` on the ADC CI runs, `2650` on the Store CI runs, `2000` on MMCA.Common's own
solution-wide run, `40` on its Helpdesk canary) so neither an empty suite nor a silently shrunken one can
pass. Where a step carries no floor the workflow says why, as ADC's live-judge step does: every case
there skips itself without an API key, and a zero-run must not red the deploy.

Now introduce a violation on purpose to feel the payoff: add a project reference from your Domain project
to your Infrastructure project, or a `using Microsoft.EntityFrameworkCore;` to a Domain class, and run
the suite. You get a named red, in the pull request, with the offending type called out. That is the
difference between a diagram and a guarantee.

## Step 5 (optional): add the compile-time layer guard too

The runtime suite is the broad net. For the single most common mistake, a bad project reference, you can
get even faster feedback by also adding the compile-time guard, so the build fails before tests even
run. MMCA.Common does this with an MSBuild target imported for every source project. The shape:

```xml
<!-- Imported from Directory.Build.props for each layer project (representative) -->
<Import Project="$(MSBuildThisFileDirectory)Source\Build\MMCA.Common.LayerEnforcement.targets"
        Condition="$(MSBuildProjectDirectory.Contains('Source'))" />
```

The target runs in a `BeforeTargets="ResolveProjectReferences"` step, inspects each project's
`ProjectReference` set, and fails the build with a descriptive error if a layer references a forbidden
upstream layer. This is the "two speeds" design from ADR-015: the MSBuild guard catches the common case
at compile time on the developer's machine; the NetArchTest suite catches the subtler assembly-level
violations a reference check cannot see. ADR-015 frames that pair as "two speeds"; counting the public
API surface gate described earlier, enforcement runs in three layers, so what pairs here is the speeds,
not the layer count. When you change project references or move a type between layers, expect both
gates to react, and add new rules in both places.

## Trade-offs and gotchas, honestly

ADR-015 names its own rough edges, and you should know them before you trust the green:

- **The tests assert structure and registration, not runtime behavior.** A fitness test can prove a
  client *wires* a resilience policy; it cannot prove the policy values are correct. Parameter tuning
  stays a review concern. Do not mistake a green arch suite for "the architecture is good," only for
  "these specific invariants hold."
- **Convention-based rules can be brittle.** Rules that match on naming or namespace shape are inherently
  fuzzier than a hard layer ban. The mitigation is exactly why the rules live in a shared package: a fix
  to a brittle rule propagates to every consumer in one change instead of being patched three times.
- **It is opt-in wiring.** The framework ships the rules, but a consumer must implement
  `IArchitectureMap` and subclass the bases to get the gating. The rules do not enforce themselves until
  you wire them. Common-only checks that cannot generalize live in a separate `FrameworkSanityTests`
  rather than the shared bases.
- **An empty suite is a false negative.** If your subclasses do not inherit any `[Fact]`s (wrong
  accessibility, missing override), the runner may discover zero tests and either fail loudly or, worse,
  give you a green that proves nothing. The `--minimum-expected-tests` floor exists precisely for this.
- **A frozen wire contract is only as strong as the care taken updating it.** `IntegrationEventContractTestsBase`
  freezes your cross-service API: you override `ExpectedContract` with the shape of every integration
  event, so a silent reshape fails the build. The base compares the members inside each event's braces as
  a **set**, not a sequence, because JSON carries no member order and failing a build over a reordered
  property trains the one gate that guards real breakage to be updated by rote. Everything observable
  stays a failure: a missing member, an extra member, a changed type, and any change to the set of events
  itself. That set comparison is also what lets `dotnet new mmca-app` ship the freeze rather than skip it,
  with the staging pass asserting that exactly one such class is present instead of deleting it, so a
  generated app carries its own contract under its own names. The discipline is yours: when a red is
  intentional, version the event and coordinate the consumer rollout in the same change, rather than
  pasting the new shape in and moving on.

None of these undercut the core value. They are the reasons to scope your rules deliberately and read
the failures, not just the color.

## Apply this even without MMCA

If you are not on MMCA.Common, the pattern still ports to any .NET stack with NetArchTest:

1. Write each invariant as a **named test**, one per forbidden edge, so a failure points at the exact
   rule, not "layering is wrong."
2. Pin assemblies through **anchor types**, not string names, so a rename does not silently disable a
   rule.
3. Run the suite in your **normal test tier** so it gates CI, and guard against a zero-discovery suite
   that passes vacuously.
4. For the common case (bad project references), add a **compile-time** check too, so the fastest
   feedback catches the most frequent mistake.

The rule of thumb is the takeaway: a rule that lives only in a diagram or a reviewer's memory will be
violated. Make it a check, and it becomes a guarantee.

---

**What we covered:** why rules-as-code beats code review for architecture invariants, installing
`MMCA.Common.Testing.Architecture`, implementing `IArchitectureMap` with one anchor type per layer,
subclassing `LayerDependencyTestsBase` and `DomainPurityTestsBase` to inherit a large rule library,
running the suite under Microsoft Testing Platform, and optionally adding the compile-time MSBuild layer
guard for the fastest feedback on the common case. ADR-015 is the decision behind all of it.

**Next in the series:** two real apps on one framework, the proof that every pattern in this series
holds in two unrelated production systems.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-015, or
`dotnet add package MMCA.Common.Testing.Architecture` and protect your layers.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- ADR-015 (architecture fitness functions): `Website/docs-src/adr/015-architecture-fitness-functions.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Testing, Clean Architecture*

*Notes: verified facts (this run, 2026-10-02, against framework v1.221.0, `MMCA.Common/FACTS.md:14`,
snapshot dated 2026-10-02 at `:4`): the framework publishes **22** packages (`MMCA.Common/FACTS.md:19`),
with `MMCA.Common.Testing.Architecture` at position 18 in that list (`:39`), so the prerequisite bullet
reads "one of the twenty-two packages" (corrected this run from "nineteen"). Fitness counts corrected
this run: 136 -> **141** test methods across 53 -> **55** abstract `*TestsBase` classes
(`MMCA.Common/FACTS.md:51`), and 267 -> **339** executed by MMCA.Common's own build (`:54`); the pair
appears in the key-design-idea paragraph and in the Step 1 package description. Four consumers each
supply one `IArchitectureMap` (`Website/docs-src/adr/015-architecture-fitness-functions.md:63`:
`CommonArchitectureMap`, `StoreArchitectureMap`, `AdcArchitectureMap`, `HelpdeskArchitectureMap`), while
`FACTS.md:53` lists only Common, ADC and Store; the article follows ADR-015 because the Helpdesk subclasses
are on disk (counted below). Scaffold callout seed size corrected 31 -> **32** sealed `*TestsBase`
subclasses in the reference app: 25 in
`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs` (`:5` through
`:210`) plus seven single-class siblings in the same folder (`ServiceContractPurityTests.cs:9`,
`MiddlewarePipelineOrderTests.cs:15`, `AnonymousEndpointTests.cs:17`, `DeleteBehaviorConventionTests.cs:20`,
`FolderWidthTests.cs:8`, `ContractImplementationTests.cs:12`, and `DecoratorPipelineOrderTests.cs:35-36`,
whose base list wraps onto the next line, which is why the previous run's single-line count missed it);
`TicketsExportScopeTests.cs:22` is sealed but has no base, so it is not counted. The wire-contract
freeze ships in the template (`MMCA.Helpdesk/build/templates/stage.ps1:1298`, the block headed "the
wire-contract freeze SHIPS, and is guarded rather than deleted"), the SET comparison is named as the
reason at `:1300-1301`, the staged app "arrives with its OWN contract already frozen" at `:1307`, and the
guard asserting exactly one `IntegrationEventContractTests` class is at `:1316-1320` (all four anchors
corrected this run, previously off by one). The trade-off bullet is grounded in the base class: members
compared as a SET, not a sequence, with missing, extra, retyped members and event-set changes all still
failures
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/IntegrationEventContractTestsBase.cs:11-15`),
`ExpectedContract` declared at `:33` and the comparison helper's "member order aside" at `:58` (both
corrected this run from `:23` and `:41`). README package row quoted verbatim from `MMCA.Common/README.md:85`
(anchor corrected this run from `:81`; text unchanged). `CommonArchitectureMap` is module-less with seven
`Framework(...)` entries, one per layer (Shared, Domain, Application, Infrastructure, Api, Grpc, Ui)
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:21-27`); the body
claim "one anchor per package" (which echoes that file's own doc comment at `:7`) is narrowed this run to
"one anchor per layer it scans", since seven anchors cover twenty-two packages and `MMCA.Common.UI.Maui`
is deliberately absent (`:9-12`). `MicroserviceExtractionTestsBase` description widened this run to
match the rule list, which bans `MassTransit`, `Grpc` and `Google.Protobuf`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:13-15`).
Engine NetArchTest.eNhancedEdition 1.4.5 (`MMCA.Common/Directory.Packages.props:275`, corrected from
`:272`); `Microsoft.CodeAnalysis.PublicApiAnalyzers` 5.6.0 (`:228`, corrected from `:226`). The CI-floor
sentence corrected for Store: ADC still carries 1 (`MMCA.ADC/.github/workflows/deploy.yml:346` and
`:527`), Store's CI.slnf runs carry **2650** (`MMCA.Store/.github/workflows/deploy.yml:334` and `:564`;
its Integration run carries 250 at `:755`, not stated in the body), MMCA.Common's solution-wide run carries
2000 (`MMCA.Common/.github/workflows/ci.yml:161`), its Helpdesk canary 40 (`:580`) and its UI E2E job 1
(`:324`); ADC's live-judge step carries no floor and states why (`MMCA.ADC/.github/workflows/deploy.yml:587`).
ADR-015 restates the 2000 floor with `ci.yml:161` (`Website/docs-src/adr/015-architecture-fitness-functions.md:69`),
frames the pair as "two layers, two speeds" (`:79`) and names `FrameworkSanityTests` (`:89`). MTP's
zero-discovery failure is exit code 8 (`MMCA.Common/AGENTS.md:38`). Compile-time import at
`MMCA.Common/Directory.Build.props:144-145` (corrected from `:141`), whose condition requires both a
`Source` directory and a project name starting with `MMCA.Common`; the article's representative snippet
shows only the `Source` half. Public-API gate re-read: one ItemGroup excluding `MMCA.Common.UI.Maui` by
name (`MMCA.Common/Directory.Build.props:89`, rationale `:79-88`), RS0016 / RS0017 named at `:81-82`, and
`PublicAPI.Shipped.txt` / `PublicAPI.Unshipped.txt` as `AdditionalFiles` (`:94-95`), all corrected from
`:86`, `:76-84`, `:78-79`, `:91-92`. The baseline file count corrected 18 -> **21** `PublicAPI.Shipped.txt`
files under `MMCA.Common/Source/` (Glob this run; ADR-015 agrees at `:34` and `:557`). The declaration
count is removed from the body this run rather than restated: ADR-015 records 7,881 (`:562`), the audit
counted 8,020, and this run's recount of non-empty, non-header lines across the 21 files gives 8,024, so
no single figure is stable enough to print; ADR-015's figure looks stale after v1.221.0. Header grounding
corrected: `MMCA.Common/CLAUDE.md` is a stub importing `AGENTS.md`, and the two-gates rule lives in
`MMCA.Common/AGENTS.md` section "Architecture" ("Two enforcement gates; add new rules in BOTH", `:68`).
G25 is published at `Website/docs-src/onboarding/group-28-testing-infrastructure.md` and authored as 35
parts under `Docs/Onboarding/parts/`, `group-28-testing-infrastructure-p00.md` through `-p34.md` (Glob this
run; previously 30). Carried from the 2026-10-02 audit as CONFIRMED and not re-read in this apply pass:
`LayerDependencyTestsBase` holds 15 `[Fact]`s, 13 edges plus two map guards
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/LayerDependencyTestsBase.cs:52`);
`DomainPurityTestsBase` and its `ExtraForbiddenDomainDependencies` (`.../Bases/Layering/DomainPurityTestsBase.cs:12`);
Store's `["RabbitMQ", "Stripe"]` ban
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Layering/DomainPurityTests.cs:11`);
`ArchitectureMapBase` `RepoToken` / `DefineLayers` / `Framework` / `Module` (`ArchitectureMapBase.cs:19`,
`:22`, `:94`, `:98`); `AdcArchitectureMap` module entries
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:28`); entity conventions
(`.../Bases/Domain/EntityConventionTestsBase.cs:18-30`) and PII (`PiiConventionTestsBase.cs:12`);
`BeforeTargets="ResolveProjectReferences"` (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:21`);
MTP via `MMCA.Common/global.json:3`. Open item outside this file: `Website/docs-src/articles/README.md:50`
maps article 40 to G25, which contradicts this header's G28. Sources: ADR-015, `MMCA.Common/AGENTS.md`,
`MMCA.Common/README.md`, `MMCA.Common/FACTS.md`. The code blocks labeled representative use `MyApp*`
placeholder names against the verified `ArchitectureMapBase` / `*TestsBase` API shape; they are not
copied verbatim from any repo.*

- Full series index: https://ivanball.github.io/writing.html
