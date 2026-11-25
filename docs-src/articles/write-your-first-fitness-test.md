# Write your first architecture fitness test

> Series: MMCA.Common · Article #40 (tutorial) · Pillar P5 · Group G25 · Rubric §34 · ADR-015 ·
> Status: grounded in `Website/docs-src/adr/015-architecture-fitness-functions.md`,
> `MMCA.Common/AGENTS.md` ("Architecture", the two enforcement gates), `MMCA.Common/README.md` (Testing.Architecture
> package row), and `Docs/Onboarding/parts/group-29-testing-infrastructure-p00.md` (assembled and
> published as `Website/docs-src/onboarding/group-29-testing-infrastructure.md`). No em dashes.

**Subtitle:** Your Clean Architecture diagram is a hope, not a guarantee, until something fails the
build when it is violated. Here is how to add architecture fitness functions to your own solution in
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
2. **At runtime**, by fitness functions on the package's own metadata-based rule engine that assert the same rules against the compiled
   assemblies, catching the subtler violations a project-reference check cannot see (a type in the
   wrong namespace, a transitive `using`, a missing convention).

A third gate sits alongside those two, and ADR-015 as revised records the enforcement as running in
three layers. It is neither MSBuild nor the runtime rule suite: `Microsoft.CodeAnalysis.PublicApiAnalyzers` runs on
every published package except `MMCA.Common.UI.Maui` (excluded by name, because it builds only on the
Windows MAUI job outside the main solution) against committed baselines (a `PublicAPI.Shipped.txt` /
`PublicAPI.Unshipped.txt` pair per gated package, twenty-nine pairs), so adding or removing a public
member fails the compile until the change is declared in that package's `PublicAPI.Unshipped.txt` in the
same pull request; the release step then folds every unshipped file into its shipped baseline. It guards the shipped package surface rather than layer
flow, which is why the two speeds above are the ones this tutorial teaches.

This article is about adding the second layer to your own code, and optionally the first.

## Prerequisites

- A .NET solution with a layered shape you want to protect. The MMCA layers are
  API -> Infrastructure -> Application -> Domain -> Shared (UI and Grpc depend on Shared only), but the
  rule library generalizes.
- **Microsoft Testing Platform** as your test runner (MMCA.Common uses it via `global.json` with
  xUnit v3). The fitness tests run inside the normal `dotnet test` tier, so they gate CI like any other
  test.
- The package you are about to install: **`MMCA.Common.Testing.Architecture`**, one of the thirty
  packages the framework publishes. Its README row describes it exactly: "`IArchitectureMap` + reusable
  metadata-based architecture rule library + abstract test bases (consumed by each repo's `*.Architecture.Tests`)."

The key design idea: the rule *bodies* ship in the package once. You do not copy them. You supply a tiny
map of your assemblies and subclass the bases, and you inherit roughly the same suite that runs across
MMCA.Common, MMCA.Store, MMCA.ADC and MMCA.Helpdesk (186 test methods across 74 abstract `*TestsBase`
classes; the framework's own build executes 767 of them).

> **If you scaffolded with `dotnet new mmca-app`, steps 1 through 4 are already done.** The generated
> solution ships the architecture-test project, the `IArchitectureMap`, and the reference app's set of
> base subclasses (46 sealed subclasses in the current seed), including the wire-contract
> freeze, which arrives frozen under your own names and green on the first `dotnet test`. Read those
> steps anyway to know what you have, then skip to Step 5. If you are retrofitting an existing
> solution, the steps are the work.

## Step 1: install the package and create a test project

Add a dedicated architecture-test project (mirroring how the framework keeps
`Tests/Architecture/*.Architecture.Tests`), and reference the package:

```powershell
dotnet add package MMCA.Common.Testing.Architecture
```

The package brings its own rule engine (`ArchitectureTypes`, which reads your compiled assemblies
through `System.Reflection.Metadata` and needs no third-party package), the `ArchitectureRules` rule
library, the diagnostic helpers, and the 74 abstract `*TestsBase` classes. You will not write rule
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
entries, one anchor per layer it scans); ADC's `AdcArchitectureMap` adds one `Module(...)` entry per
module and layer, pinning an anchor type where a public one is handy and loading the remaining
assemblies by name with `Assembly.Load`, as its doc comment states. Your map looks like one of those,
scaled to your solution. One map per solution is the usual shape, not a limit: MMCA.Common also runs a
second map, `FrameworkModuleArchitectureMap`, that registers its own Shared, Domain and Application
assemblies as one `Module(...)` named `Framework`, so the module-scoped DDD rules (sealed entities, no
public aggregate constructors, immutable DTOs) actually run over the aggregates the framework ships.

## Step 3: subclass the test bases to inherit the rule library

Now your test classes shrink to thin sealed subclasses that supply the map and inherit the `[Fact]`s.
Two of the most valuable bases to start with:

```csharp
// Layer-flow rules: 18 facts (16 forbidden edges + 2 map guards) (representative)
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
  references Domain") gives you a precise red instead of an opaque "layering broken." Sixteen of its
  eighteen `[Fact]`s are those edges; the other two assert that your map actually declares every expected
  layer, and that every module declares its layers, so the edge rules cannot pass vacuously against a
  map that forgot an assembly. Grpc is the one optional layer: a map that declares no Grpc assembly
  satisfies the three Grpc edges vacuously, by design.
- **`DomainPurityTestsBase`** asserts that Domain and Shared stay free of infrastructure frameworks and
  that Application stays host-agnostic (no EF Core, no ASP.NET Core in Application). It even exposes a
  `protected virtual ExtraForbiddenDomainDependencies` so your repo can *add* bans on top of the shared
  list (Store's subclass bans `"RabbitMQ"` and `"Stripe"` from Domain, the broker client and the payment
  SDK, which the base names only generically in its doc comment as "a payment SDK or a broker client")
  without editing the package.

The other bases cover more ground when you are ready: `MicroserviceExtractionTestsBase` (no broker client such as
RabbitMQ, Azure Service Bus, Amazon SQS or SNS, and no MassTransit, gRPC or Protobuf in Application/Domain/Shared), entity and aggregate conventions (aggregates have no public constructors,
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
test steps with `--minimum-expected-tests` (`5000` on each of ADC's two framework legs, `2650` on Store's CI run, `11250` on each of
MMCA.Common's own two framework legs, `40` on its Helpdesk canary) so neither an empty suite nor a silently shrunken one can
pass. Where a step carries no floor the workflow says why, as ADC's live-judge step does: every case
there skips itself without an API key, and a zero-run must not red the deploy.

Now introduce a violation on purpose to feel the payoff: add a project reference from your Domain project
to your Infrastructure project, or a `using Microsoft.EntityFrameworkCore;` to a Domain class, and run
the suite. You get a named red, in the pull request, with the offending type called out. That is the
difference between a diagram and a guarantee.

## Step 5 (optional): add the compile-time layer guard too

The runtime suite is the broad net. For the single most common mistake, a bad project reference, you can
get even faster feedback by also adding the compile-time guard, so the build fails before tests even
run. MMCA.Common does this with an MSBuild targets file imported for every one of its own source
projects (the condition scopes it to projects under `Source` whose name starts with `MMCA.Common`; use
your own prefix). The shape:

```xml
<!-- Imported from Directory.Build.props for each layer project (representative) -->
<Import Project="$(MSBuildThisFileDirectory)Source\Build\MMCA.Common.LayerEnforcement.targets"
        Condition="$(MSBuildProjectDirectory.Contains('Source')) AND $(MSBuildProjectName.StartsWith('MMCA.Common'))" />
```

The file holds fourteen targets of the same `BeforeTargets="ResolveProjectReferences"` shape, each guarding
one reference rule; the layer target is the one to copy first. It inspects each project's
`ProjectReference` set, and fails the build with a descriptive error if a layer references a forbidden
upstream layer. This is the "two speeds" design from ADR-015: the MSBuild guard catches the common case
at compile time on the developer's machine; the runtime rule suite catches the subtler assembly-level
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

If you are not on MMCA.Common, the pattern still ports to any .NET stack with an architecture-test library
such as NetArchTest or ArchUnitNET:

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

*Notes: verified facts (re-verified 2026-11-25 against MMCA.Common v1.319.0, `MMCA.Common/FACTS.md:14`,
snapshot "As of: 2026-11-25" at `:4`). Changed in the 2026-11-25 run: fitness counts 160 -> **186** test
methods across 64 -> **74** abstract `*TestsBase` classes (`MMCA.Common/FACTS.md:98`) and 479 -> **767**
executed by MMCA.Common's own build (`:101`), swept in the key-design-idea paragraph and the Step 1 package
description; published packages 26 -> **30** (`:20`), with `MMCA.Common.Testing.Architecture` at item 25
(`:47`), so the prerequisite reads "one of the thirty"; Shipped/Unshipped pairs 25 -> **29** (Glob this
run: 29 `PublicAPI.Shipped.txt` and 29 `PublicAPI.Unshipped.txt` under `MMCA.Common/Source`, matching
ADR-015's 2026-11-23 revision, "the public API gate covers 29 projects",
`Website/docs-src/adr/015-architecture-fitness-functions.md:60-62`; thirty packages less the excluded
`MMCA.Common.UI.Maui`). Prerequisite layer flow corrected from "API/Grpc -> Infrastructure -> ..." to
`API -> Infrastructure -> Application -> Domain -> Shared` with UI and Grpc on Shared only
(`MMCA.Common/AGENTS.md` section "Architecture"; the base asserts `Grpc_ShouldNotDependOn_Domain` /
`_Application` / `_Infrastructure` at
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/LayerDependencyTestsBase.cs:99-106`).
`LayerDependencyTestsBase` holds **18** `[Fact]`s (was 15): two map guards (`:52-56`) and 16 edges
(`:59` through `:106`: Domain x3, Application x2, Infrastructure x1, Shared x4, Ui x3, Grpc x3), swept in
the code-block comment and the bullet; the Grpc edges are commented as optional and satisfied vacuously by a
map with no Grpc assembly (`:98`), while the required layers default to the five core layers (`:13`), so the
bullet names that exception. Scaffold callout seed size 32 -> **46** sealed `*TestsBase` subclasses in the
reference app (counted this run): 27 in
`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs` (`:5` through
`:231`) plus 19 in sibling files (`AnonymousEndpointTests.cs:17`, `Caching/HelpdeskCacheInvalidationConventionTests.cs:11`,
`ContractImplementationTests.cs:12`, six under `Cqrs/`, `DecoratorPipelineOrderTests.cs:37-38` whose base
list wraps, `DeleteBehaviorConventionTests.cs:20`, four under `Domain/`, `FolderWidthTests.cs:8`,
`Layering/CrossModuleReferenceTests.cs:9`, `MiddlewarePipelineOrderTests.cs:15`,
`ServiceContractPurityTests.cs:9`); twelve more sealed classes in the folder (`HelpdeskArchitectureMap`,
`TicketsExportScopeTests.cs:22`, `DesignTimeFactoryHostSettingsTests.cs:28`, the `Persistence/` and
`Tickets/` tests) take no `*TestsBase` base and are not counted. `MicroserviceExtractionTestsBase` bullet
widened to the real list: `MassTransit`, `RabbitMQ.Client`, `Azure.Messaging.ServiceBus`, `Amazon.SQS`,
`Amazon.SimpleNotificationService`, `Grpc` and `Google.Protobuf`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Transport.cs:14-23`,
doc comment `:5-13`). CI floors re-read this run: MMCA.Common floors each framework leg at
`--minimum-expected-tests 11250` (`MMCA.Common/.github/workflows/ci.yml:185`, rationale `:170-174`, which
also names the 22500 two-framework floor in `release.yml`; ADR-015 records the single 2000 floor as replaced
at `:60-61`); its Helpdesk canary carries 40 (`:816`) and its UI E2E job 1 (`:496`, not stated in the body).
ADC carries 5000 on both CI.slnf legs, net11.0 (`MMCA.ADC/.github/workflows/deploy.yml:448`, solution-wide
rationale `:438-444`) and net10.0 (`:611`), so the body reads "each of ADC's two framework legs"; Store's
2650 sits on one CI.slnf run (`MMCA.Store/.github/workflows/deploy.yml:375`). The ADC live-judge no-floor
sentence was confirmed by this run's audit and not re-anchored here. Step 5 target count ten -> **fourteen**,
each `BeforeTargets="ResolveProjectReferences"`
(`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:20-21`, `EnforceSharedLayerBoundary`, through
`:327-328`, `EnforceAzureStartupBoundary`). Re-anchored this run: the compile-time import and its two-part
condition `MMCA.Common/Directory.Build.props:189-190`; the public-API ItemGroup excluding
`MMCA.Common.UI.Maui` by name `:134` (rationale `:126-130`, RS0016 / RS0017 at `:38` and `:126`),
`PublicAPI.Shipped.txt` / `PublicAPI.Unshipped.txt` as `AdditionalFiles` `:139-140`; README package row
quoted verbatim from `MMCA.Common/README.md:92`; ADR-015 frames "two layers, two speeds" at `:130`, names
`FrameworkSanityTests` at `:140` and records the three-layer correction at `:297`. The runtime engine is the
package's own metadata-based `ArchitectureTypes` (`MMCA.Common/AGENTS.md` "Two enforcement gates");
NetArchTest left the framework in v1.318.0 (ADR-015 amendment 2026-11-24, `:65-69`), so the old
`Directory.Packages.props` NetArchTest anchor is dropped and the body's only NetArchTest mention is the
generic library suggestion in "Apply this even without MMCA". Onboarding grounding unchanged:
`Website/docs-src/onboarding/group-29-testing-infrastructure.md`, authored as **61** parts
`Docs/Onboarding/parts/group-29-testing-infrastructure-p00.md` through `-p60.md` (Glob this run). Carried
over without re-reading in this apply (the audit confirmed the claims they back, so only a line number may
have moved): `CommonArchitectureMap.cs:21-27` (seven `Framework(...)` entries), `FrameworkModuleArchitectureMap.cs:16-28`,
`AdcArchitectureMap.cs:28-54`, `ArchitectureMapBase.cs:19`, `:22`, `:94`, `:98`, `DomainPurityTestsBase.cs:6`,
`:12`, Store's `["RabbitMQ", "Stripe"]` ban at `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Layering/DomainPurityTests.cs:11`,
`IntegrationEventContractTestsBase.cs:11-15`, `:33`, `:58`, `EntityConventionTestsBase.cs:18-30`,
`PiiConventionTestsBase.cs:7`, the Helpdesk template freeze at `MMCA.Helpdesk/build/templates/stage.ps1:1309-1332`,
MTP via `MMCA.Common/global.json:3`, and MTP's zero-discovery exit code 8 (`MMCA.Common/AGENTS.md`
Gotchas). Earlier runs (2026-10-22, 2026-10-29) changed the fitness counts, package and pair counts, the
scaffold callout wording, the ADC map sentence and the Step 5 snippet; this ledger supersedes their anchors.
Sources: ADR-015, `MMCA.Common/AGENTS.md`, `MMCA.Common/README.md`, `MMCA.Common/FACTS.md`. The code blocks
labeled representative use `MyApp*` placeholder names against the verified `ArchitectureMapBase` /
`*TestsBase` API shape; they are not copied verbatim from any repo.*

- Full series index: https://ivanball.github.io/writing.html
