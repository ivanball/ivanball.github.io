# Write your first architecture fitness test

> Series: MMCA.Common · Article #40 (tutorial) · Pillar P5 · Group G28 · Rubric §34 · ADR-015 ·
> Status: grounded in `Website/docs-src/adr/015-architecture-fitness-functions.md`,
> `MMCA.Common/CLAUDE.md` ("Architecture Enforcement"), `MMCA.Common/README.md` (Testing.Architecture
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
Windows MAUI job outside the main solution) against a committed `PublicAPI.Shipped.txt` baseline (5,034
declarations across eighteen files), so adding or removing a public member fails the compile until that
text file is updated in the same pull request. It guards the shipped package surface rather than layer
flow, which is why the two speeds above are the ones this tutorial teaches.

This article is about adding the second layer to your own code, and optionally the first.

## Prerequisites

- A .NET solution with a layered shape you want to protect. The MMCA layers are
  API/Grpc -> Infrastructure -> Application -> Domain -> Shared, but the rule library generalizes.
- **Microsoft Testing Platform** as your test runner (MMCA.Common uses it via `global.json` with
  xUnit v3). The fitness tests run inside the normal `dotnet test` tier, so they gate CI like any other
  test.
- The package you are about to install: **`MMCA.Common.Testing.Architecture`**, one of the nineteen
  packages the framework publishes. Its README row describes it exactly: "`IArchitectureMap` + reusable
  NetArchTest rule library + abstract test bases (consumed by each repo's `*.Architecture.Tests`)."

The key design idea: the rule *bodies* ship in the package once. You do not copy them. You supply a tiny
map of your assemblies and subclass the bases, and you inherit roughly the same suite that runs across
MMCA.Common, MMCA.Store, MMCA.ADC and MMCA.Helpdesk (136 test methods across 53 abstract `*TestsBase`
classes; the framework's own build executes 267 of them).

> **If you scaffolded with `dotnet new mmca-app`, steps 1 through 4 are already done.** The generated
> solution ships the architecture-test project, the `IArchitectureMap`, and every applicable base
> subclassed (31 sealed subclasses in the current reference-app seed), including the wire-contract
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
library, the diagnostic helpers, and the 53 abstract `*TestsBase` classes. You will not write rule
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
framework's own `CommonArchitectureMap` is module-less (every layer is a framework layer, one anchor per
package); ADC's `AdcArchitectureMap` adds module entries the same way. Your map looks like one of those,
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

The other bases cover more ground when you are ready: `MicroserviceExtractionTestsBase` (no MassTransit
in Application/Domain/Shared), entity and aggregate conventions (aggregates have no public constructors,
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
test steps with `--minimum-expected-tests` (`1` on the ADC and Store CI runs, `2000` on MMCA.Common's own
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

*Notes: verified facts (this run, 2026-09-19, against framework v1.205.0, `MMCA.Common/FACTS.md:14`,
snapshot dated 2026-09-17 at `:4`): the framework publishes **19** packages (`MMCA.Common/FACTS.md:19`),
with `MMCA.Common.Testing.Architecture` at position 15 in that list (`:36`), so the prerequisite bullet
reads "one of the nineteen packages" (corrected this run from "fifteen"). Fitness counts corrected this
run: 104 -> **136** test methods across 36 -> **53** abstract `*TestsBase` classes
(`MMCA.Common/FACTS.md:48`), and 99 -> **267** executed by MMCA.Common's own build (`:51`); the pair
appears in the key-design-idea paragraph and in the Step 1 package description, and ADR-015 has stopped
restating either figure. The consumer list corrected from three repos to four:
`Website/docs-src/adr/015-architecture-fitness-functions.md:59-62` names Common / Store / ADC / Helpdesk,
each supplying one `IArchitectureMap` (`CommonArchitectureMap`, `StoreArchitectureMap`,
`AdcArchitectureMap`, `HelpdeskArchitectureMap`), and the Helpdesk arch-test project is on disk at
`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/`. Scaffold callout rewritten this
run rather than renumbered: staging ships the wire-contract freeze rather than deleting it
(`MMCA.Helpdesk/build/templates/stage.ps1:1297`, the block headed "the wire-contract freeze SHIPS, and is
guarded rather than deleted"), the guard asserts that exactly one `IntegrationEventContractTests` class
is present (`:1315-1320`), and the staged app "arrives with its OWN contract already frozen, under its
own names, green on the first test run" (`:1306-1307`). The old callout text ("every applicable base
subclassed but one", "nineteen from the current reference-app seed") and the trade-off bullet that
depended on it were both replaced for that reason. Seed size counted this run: **31** sealed `*TestsBase`
subclasses in the reference app, 25 in
`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs` plus six
single-class siblings in the same folder (`ServiceContractPurityTests`, `MiddlewarePipelineOrderTests`,
`FolderWidthTests`, `DeleteBehaviorConventionTests`, `ContractImplementationTests`,
`AnonymousEndpointTests`). The rewritten trade-off bullet is grounded in the base class itself: the
member list inside each event's braces is compared as a SET, not a sequence, with a missing member, an
extra member, a changed type and any change to the set of events all still failures
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/IntegrationEventContractTestsBase.cs:11-15`),
the comparison helper reporting an empty list when the two agree "member order aside" (`:41`), and
`ExpectedContract` declared at `:23`; `stage.ps1:1299-1301` names that set comparison as the reason the
freeze can ship in the template. README package row quoted verbatim from `MMCA.Common/README.md:81`
(anchor corrected this run from `:79`; the quoted text is unchanged). `LayerDependencyTestsBase` holds
**15** `[Fact]`s, as the body and the illustrative code comment say: 13 forbidden-edge rules
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/LayerDependencyTestsBase.cs:59-96`)
plus two non-vacuity guards, `LayerMap_DeclaresEveryExpectedLayer` (`:52-53`) and
`LayerMap_ModulesDeclareEveryExpectedLayer` (`:55-56`), whose default required layers are the five core
ones (`:16-17`); the file sits under `Bases/Layering/`, so every anchor for it is re-read this run.
`DomainPurityTestsBase` asserts Domain/Shared framework-freedom plus Application host-agnosticism
(`.../Bases/Layering/DomainPurityTestsBase.cs:14-24`) and exposes `ExtraForbiddenDomainDependencies`
(`:12`). The "Stripe is only a doc-comment example" claim is corrected in both directions: Store's
subclass bans `["RabbitMQ", "Stripe"]`
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Layering/DomainPurityTests.cs:11`, reason at
`:7-10`), and the base doc comment names the two generically as "a payment SDK or a broker client"
(`DomainPurityTestsBase.cs:5-6`). Engine NetArchTest.eNhancedEdition 1.4.5
(`MMCA.Common/Directory.Packages.props:272`, anchor corrected this run from `:200`); the runner is
Microsoft Testing Platform (`MMCA.Common/global.json:2-3`). The CI-floor sentence corrected from "every
test step": the two quoted values hold (`MMCA.Common/.github/workflows/ci.yml:183` carries 2000 on the
solution-wide run, `MMCA.ADC/.github/workflows/deploy.yml:309` and `:447` carry 1, and
`MMCA.Store/.github/workflows/deploy.yml:244` and `:404` carry 1), Common's Helpdesk canary step carries
40 (`ci.yml:594`) and its UI E2E job carries 1 (`ci.yml:346`), while ADC's live-judge step deliberately
carries none and the workflow states the reason (`MMCA.ADC/.github/workflows/deploy.yml:506`). ADR-015
states the 2000 floor with its own file:line
(`Website/docs-src/adr/015-architecture-fitness-functions.md:66-68`) rather than a generic 1, and
`FrameworkSanityTests` is named at `:87`; both anchors are corrected this run. Compile-time import
verified at `MMCA.Common/Directory.Build.props:141` (anchor corrected this run from `:123-124`), running
`BeforeTargets="ResolveProjectReferences"`
(`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:21`); the article's representative
snippet shows only the `Source`-directory half of that condition. Public-API gate re-read:
`Microsoft.CodeAnalysis.PublicApiAnalyzers` 5.6.0 (`MMCA.Common/Directory.Packages.props:226`) is
referenced from one `Directory.Build.props` ItemGroup whose condition excludes `MMCA.Common.UI.Maui` by
name (`MMCA.Common/Directory.Build.props:86`, rationale at `:76-84`), with `PublicAPI.Shipped.txt` and
`PublicAPI.Unshipped.txt` added as `AdditionalFiles` (`:91-92`), and the gate is exactly two rules,
RS0016 on an undeclared public member and RS0017 on a declared member that disappeared (`:78-79`). The
baseline size corrected from "about 5,150 declarations across fourteen files" to **5,034 declarations
across eighteen files** (`Website/docs-src/adr/015-architecture-fitness-functions.md:208`, with the
2026-09-19 revision recording the move to eighteen pairs at `:506-533`); the eighteen
`PublicAPI.Shipped.txt` files under `MMCA.Common/Source/` were counted independently this run, and the
5,034 total is taken from ADR-015 rather than recounted line by line. Header grounding corrected: the
chapter is G28, published at `Website/docs-src/onboarding/group-28-testing-infrastructure.md` and
authored as 30 parts under `Docs/Onboarding/parts/`, `group-28-testing-infrastructure-p00.md` through
`-p29.md`; `group-27-*` is the AI-integration chapter
(`Website/docs-src/onboarding/group-27-common-ai-integration.md`), which is why the old G27 anchors and
the old `-p07.md` citation no longer resolve. Sources: ADR-015 (Accepted,
`Website/docs-src/adr/015-architecture-fitness-functions.md:4`), `MMCA.Common/CLAUDE.md`,
`MMCA.Common/README.md`, `MMCA.Common/FACTS.md`. The code blocks labeled representative use `MyApp*`
placeholder names against the verified `ArchitectureMapBase` / `*TestsBase` API shape; they are not
copied verbatim from any repo.*

- Full series index: https://ivanball.github.io/writing.html
