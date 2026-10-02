# I open-sourced the enterprise .NET plumbing I never want to rewrite, and graded it against 34 categories

> Series: MMCA.Common · Article #1 (cornerstone) · Pillar P1/P4 · Rubric: all
> Status: grounded in `MMCA.Common/README.md`, `MMCA.Common/AGENTS.md`, `MMCA.Common/FACTS.md`,
> `Website/docs-src/governance/common-ArchitectureScorecard.md`, `Website/docs-src/onboarding/00-index.md`. No em
> dashes. Current facts (22 packages, 131 ADRs, two-axis index M 96.6% / I 86.0%).

**Subtitle:** A .NET 10 framework for DDD, Clean Architecture, and CQRS, built as a modular monolith
that extracts to microservices without a rewrite, and scored in the open against a 34-category rubric.

---

I have lost count of how many times I have rebuilt the same plumbing.

Error handling. The CQRS wiring. A transactional outbox. JWT and JWKS auth. Multi-database routing.
Audit fields. The test harness. On every new enterprise .NET project, the same set of cross-cutting
concerns gets rebuilt, usually from scratch, usually a little worse than last time because the
deadline was closer.

So I did the obvious thing and extracted it once, properly, into a framework I could reuse. Then I did
the less obvious thing: I open-sourced it under the Apache 2.0 license, and I graded it against a 34-category
architecture rubric in public, gaps and all.

It is called **MMCA.Common** (Modular Monolith Clean Architecture), it targets .NET 10, and this
article is the front door to a series that teaches it one pattern at a time.

## What it is

MMCA.Common is a set of **twenty-two NuGet packages** that give you a DDD + Clean Architecture + CQRS
foundation as a **modular monolith**, plus the extraction boundaries to pull a module out into its own microservice
later without rewriting application code.

The packages layer strictly, each one only depending on the layers below it:

```
API              (presentation / controllers)
     ↓
Infrastructure   (EF Core, caching, JWT, JWKS, outbox, message bus, SignalR)
     ↓
Application      (CQRS handlers, decorators, module system, IMessageBus)
     ↓
Domain           (entities, aggregates, domain events, specifications)
     ↓
Shared           (Result pattern, errors, DTOs, value objects)
```

A few packages sit off to the side of that stack rather than on top of it. `UI` and `Grpc` depend on
`Shared` only: the Blazor `UI` stays WebAssembly-friendly, and `Grpc` is pure transport that must not
couple to Domain, Application, or Infrastructure. `UI.Maui` (the one MAUI-target package) depends on
`UI` plus `Shared` only (ADR-042). `UI.Web` is the one UI package that sits above the stack instead: it
is the Blazor Web host layer, referencing `UI`, `API`, and `Aspire` directly, which is exactly what keeps
those server dependencies out of the WebAssembly-safe `UI`.

More packages sit outside the stack entirely. `Gateway` is the YARP edge that fronts the service
hosts once modules are extracted (ADR-008). The `AI` family is a governed boundary for language-model
calls (ADR-120): `AI` isolates, versions, evaluates, observes, and bounds every call so a second AI
feature inherits the rules instead of copying them; `AI.Anthropic` and `AI.OpenAI` are provider adapters
that each register one provider factory, so the governed package never names a vendor; and `AI.Testing`
ships the replay harness that pins prompt contracts. The twenty-second package is `MMCA.Common` itself:
a metapackage that ships no assembly, one `PackageReference` in place of the six a standard application
host always takes (ADR-101).

Adding it to a solution you already have is one line, and each package transitively pulls the layers
beneath it:

```powershell
dotnet add package MMCA.Common.API
```

`API` brings `Infrastructure`, which brings `Application`, `Domain`, and `Shared`. The other packages
(`Grpc`, `UI`, `UI.Web`, `UI.Maui`, `Aspire`, `Aspire.Hosting`, `Gateway`, the four `AI` packages, and
five `Testing.*` packages) are opt-in for the surface you need.

Starting from nothing is a different command, because a package reference is not an application. A
solution on this framework is twelve projects and roughly 9,000 lines of C# and Razor before any business
logic, so the framework ships a `dotnet new` pack that writes all of it:

```powershell
dotnet new install MMCA.Templates
dotnet new mmca-app -n Contoso.Support --module Orders --aggregate Order
```

That generates a warning-free build under five analyzers and a passing test run including the
architecture-fitness rules, with no database needed. The template content **is** the framework's
runnable reference app, staged at pack time rather than copied, so what you generate is the app whose
CI keeps it green, under your own names.

## The one thing that makes it different

Plenty of repositories will sell you Clean Architecture. The difference here is that the rules are not
prose in a README. They are **executable, and they fail the build.**

The inward-pointing dependency rule (Domain must never reference EF Core or ASP.NET) is enforced
**twice**, on purpose:

1. **At compile time**, by an MSBuild target (`MMCA.Common.LayerEnforcement.targets`) that inspects
   project references and fails the build with a descriptive error if a layer reaches into a layer it
   should not.
2. **At runtime**, by NetArchTest fitness functions that assert the same rules against the compiled
   assemblies.

Those fitness functions do not live as copy-pasted test code in each repo. They live once, in a
shipped package, `MMCA.Common.Testing.Architecture`, which exposes a reusable rule library and abstract
test bases (**141 test methods across 55 base classes**). MMCA.Common's own build executes 339 fitness
tests built on them. MMCA.ADC and MMCA.Store subclass the same bases and supply their own architecture
map, and so does MMCA.Helpdesk, the reference app the templates are staged from, so the rules are
literally identical in every codebase that runs them.

This is the line I care about most: **if a rule matters, it should be a check, not a comment.**

## Modular monolith now, microservices later, no rewrite

The other thesis baked into the framework is that "monolith vs microservices" is a false binary. You
build the extraction point now and cut the service when (if) you actually need to.

The extraction boundaries are real and tested, not slideware:

- **Database-per-service**, even inside the monolith. Every entity resolves to a physical data source;
  a host with no extra configuration behaves exactly like a single-database monolith, and the same code
  runs against per-service databases once you split them (ADR-006).
- A transport-agnostic **`IMessageBus`**. The same code dispatches events **in-process** today
  (`InProcessMessageBus`) and over a **broker** the day a module becomes its own service
  (`BrokerMessageBus`). Application, Domain, and Shared are forbidden from referencing the broker
  library directly, and a fitness test enforces it.
- A transactional **outbox** so that split never loses an event (its own deep-dive later in the series).
- **gRPC contracts**, **JWKS cross-service auth**, and **Aspire hosting** extensions for the extracted
  topology (ADRs 004, 007, 008, 012).

The point is reversibility. Transport choices live at the edges; your business logic does not know or
care whether the module next door is a method call or a network hop.

## I scored it on two axes, then published every gap

Here is the part that usually gets left out of "look at my framework" posts.

I graded MMCA.Common against a 34-category architecture rubric (backend, front-end, and
operational/governance categories), scoring each category on two axes: **Maturity** (how well-governed
the process is) and **Implementation** (how much substance is actually executed). It sits at a
**maturity index of 96.6% and an implementation index of 86.0%** across all 34 categories
(internationalization ships in the framework as en-US plus Spanish under ADR-027, which supersedes the
single-locale ADR-011, so it scores on both axes like every other category; nothing is excluded as
N/A). Then I committed the full evaluation to the repo, with every category's two scores, the evidence,
and the honest gaps.

The rubric itself is versioned. Version 2 (ADR-110) keeps all 34 categories and scores category 10 as
**Messaging & Integration Architecture** (Maturity 4 / Implementation 9) and category 16 as **AI-Native
Application Architecture** (Maturity 4 / Implementation 9), which is where the governed language-model
boundary is graded.

The pattern in the scores is the same line from earlier: **every category that earned top marks was
backed by a fitness function or a compile-time guard. Every category capped lower either left the
design to code review, or has its real proof living downstream in a consumer app.** Clean Architecture,
microservices readiness, CQRS, and testability all sit at Maturity 4 / Implementation 9, and all of them
are enforced automatically. SOLID sits lower, at Maturity 3 / Implementation 8, for exactly that reason:
the principles are applied throughout, but only two of the five are enforced automatically.

Implementation is the weaker axis on purpose. A framework ships mature, well-governed mechanisms whose
full execution often completes in the apps that consume it. Deployment and resilience recovery both
stop at Implementation 8 precisely because the substance they reward (a real deploy, production
recovery targets proven against real cloud backups) lives in the consuming apps, not in a library.

The headline gap the rubric named was **Compliance and Privacy**: soft-delete everywhere and no
right-to-erasure path, which is the exact GDPR conflict the rubric names. I wrote that down rather than
hiding it, and it became ADR-005, a real anonymization extension point, and a PII fitness function that fails the
build. That is the whole point of scoring yourself in public: the gaps turn into the roadmap.

## It runs in production, on two real apps

MMCA.Common is not a toy. Two deployed apps are built on it:

- **MMCA.ADC**, the Atlanta Developers Conference app, deployed to Azure and used to run a live event.
- **MMCA.Store**, an e-commerce app with Catalog, Sales, and Identity modules and Stripe integration.

Both run on the same framework version, swept in lockstep when the framework releases. The test suite
is roughly **2,254 fast tests** in a correct pyramid with no Docker or database dependency, held above
a 2,000-test zero-discovery floor by CI, so the inner loop stays quick and a filter regression that
silently drops tests fails the build.

## What this series will cover

Over the coming weeks I will take one pattern per article and go deep:

- The `Result<T>` railway that retired exceptions-as-control-flow.
- The transactional outbox, in full.
- Database-per-service inside a monolith.
- The CQRS decorator pipeline (logging, caching, transactions, without touching a handler).
- Navigation populators that replace EF `Include` chains.
- JWKS cross-service auth without a shared secret.
- Architecture fitness functions you can add to your own codebase this week.

Each article stands alone if you land on it from a search, and links into the rest if you want the
whole curriculum.

## Try it, or come argue with me

MMCA.Common is Apache-2.0 licensed and open source. The fastest way to form an opinion is to read the
scorecard (the gaps are the honest part) and skim the ADRs (the "why" behind each decision).

- ⭐ Star the repo: `https://github.com/ivanball/MMCA.Common`
- Read the full 34-category scorecard in the repo, gaps included.
- `dotnet new install MMCA.Templates` then `dotnet new mmca-app -n Your.App`, and tell me what breaks.

Next up: how a modular monolith becomes microservices without a rewrite, and
why that extraction point is something you build now, not a migration you survive later.

---

*Tags: .NET, C Sharp, Software Architecture, Microservices, Open Source*

*Notes / honest gaps: every figure below was re-read from source on 2026-10-02 against framework v1.221.0
(`MMCA.Common/FACTS.md:4,14`). The two-axis scores are the current indices in the canonical
`Website/docs-src/governance/common-ArchitectureScorecard.md` (Maturity 96.6% = 317/328,
`common-ArchitectureScorecard.md:9`; Implementation 86.0% = 705/820, `common-ArchitectureScorecard.md:10`),
evidence dated 2026-10-01 at v1.218.0 (`common-ArchitectureScorecard.md:5`). The article keeps its deliberate
framing (scored against the original committed snapshot, then re-scored): this run moved Maturity from 97.0%
(318/328) to 96.6% because category 1 SOLID dropped to Maturity 3 / Implementation 8
(`common-ArchitectureScorecard.md:12,65`, "only SRP and DIP are enforced automatically"), so SOLID left the
top-marks list and is named as the counter-example. Implementation stays the weaker axis by design, by about 10.6
points (`common-ArchitectureScorecard.md:11`). The denominators are rubric version 2's (ADR-110,
`common-ArchitectureScorecard.md:3,5`, `Website/docs-src/adr/README.md:123`), which keeps all 34 categories and
scores category 10 as Messaging & Integration Architecture at Maturity 4 / Implementation 9
(`common-ArchitectureScorecard.md:74`) and category 16 as AI-Native Application Architecture at Maturity 4 /
Implementation 9 (`common-ArchitectureScorecard.md:80`; was 3/6 in the 2026-09-19 notes); those two names are the
rubric's own headings (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:329,469`). No category is
excluded as N/A (`common-ArchitectureScorecard.md:104`), and ADR-027 multi-locale i18n (en-US plus Spanish)
supersedes the single-locale ADR-011 (`Website/docs-src/adr/README.md:40,24`). The top-marks paragraph names
category 3 Clean Architecture (`common-ArchitectureScorecard.md:67`), category 6 CQRS & Event-Driven (`:70`),
category 7 Microservices Readiness (`:71`) and category 14 Testability & Test Strategy (`:78`), all at Maturity 4
/ Implementation 9; it claims those scores rather than exclusivity, because 4/9 is a band shared with other rows,
category 8 Data Architecture among them (`:72`). The weaker-axis paragraph cites category 17 DevOps & Deployment
at Maturity 3 / Implementation 8 (`:81`, full CD machinery in consumer repos) and category 29 Resilience &
Business Continuity at Maturity 4 / Implementation 8 (`:93`, production RTO/RPO against real cloud backups is
consumer IaC); the earlier "score higher on maturity" wording no longer held for category 17 (75% against 80%
normalized), and the "data-migration gating" item maps to no single scorecard row, so both were narrowed to
the shared Implementation 8 cap. The package count (22, `FACTS.md:19`) was read from `FACTS.md`, the CI-gated
source of truth; its list carries `MMCA.Common.AI` (`FACTS.md:22`), the provider adapters `AI.Anthropic` and
`AI.OpenAI` (`FACTS.md:23-24`, each referencing `MMCA.Common.AI` at
`MMCA.Common/Source/Core/MMCA.Common.AI.{Anthropic,OpenAI}/*.csproj:12` and registering one
`IAiProviderFactory` per `MMCA.Common/AGENTS.md:141`), `AI.Testing` (`FACTS.md:34`), `MMCA.Common.Gateway`
(`FACTS.md:37`), five `Testing.*` packages (`FACTS.md:38-42`) and the `MMCA.Common` metapackage
(`FACTS.md:43`). Gateway is the YARP edge of ADR-008 (`Website/docs-src/adr/README.md:21`), the AI family is the
governed language-model boundary of ADR-120 (`Website/docs-src/adr/README.md:133`), and the metapackage that
ships no assembly in place of the Core 6 is ADR-101 (`Website/docs-src/adr/README.md:114`; the six references at
`MMCA.Common/Source/MMCA.Common/MMCA.Common.csproj:26-31`). `FACTS.md` delegates the ADR count and range to the
canonical index (131 accepted ADRs, 001-131, `Website/docs-src/adr/README.md:6`). Lockstep holds: every
`MMCA.Common.*` pin reads 1.221.0 in Store (`MMCA.Store/Directory.Packages.props:8-113`), ADC
(`MMCA.ADC/Directory.Packages.props:103-139`) and Helpdesk (`MMCA.Helpdesk/Directory.Packages.props:82-98`).
"Two deployed apps are built on it" replaces "consume the same nineteen packages", because neither app pins every
published package. The 141-test-methods-across-55-abstract-`*TestsBase`-classes figure and the 339 fitness tests
MMCA.Common's own build executes are `FACTS.md:51` and `FACTS.md:54-55`. `FACTS.md:52-53` names Common, ADC and
Store as the subclassing repos; MMCA.Helpdesk is added from source, with 33 `*TestsBase` subclass declarations
across 8 files in `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/` and its own map at
`ServiceContractPurityTests.cs:11` (`HelpdeskArchitectureMap`); no per-repo executed counts are claimed for the
consumers. The UI family: `UI` and `Grpc` depend on `Shared` only and `UI.Maui` (the one MAUI-target package)
depends on `UI` plus `Shared` only (ADR-042, `Website/docs-src/adr/README.md:55`); `UI.Web` references `UI`,
`API` and `Aspire` directly (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:40-42`),
so it sits above the layer stack, not beside it. The fast-test figure is the scorecard's category 14 row (roughly
2,254 `[Fact]`/`[Theory]`, `common-ArchitectureScorecard.md:78`, matching the Top-5 strengths block at `:45`, so
the earlier 1,880 follow-up is resolved), and the 2,000-test zero-discovery floor is the literal
`--minimum-expected-tests 2000` on the unit tier (`MMCA.Common/.github/workflows/ci.yml:161`); both keep moving,
so re-read before publishing. The twelve-projects and roughly-9,000-lines figure is anchored on
`Website/docs-src/guides/common-GETTING-STARTED.md:10` ("12 projects and roughly 9,000 lines of C# and Razor"),
the commands on `:15-16`. The Compliance and Privacy gap is real but answered: ADR-005
(`Website/docs-src/adr/README.md:18`) plus an `IAnonymizable` erasure extension point
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:22`) and a PII fitness function
(`PiiConventionTestsBase`, `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/PiiConventionTestsBase.cs:7`),
so the "scored, then fixed" framing is deliberate. Apache-2.0 is `MMCA.Common/Directory.Build.props:49`. Two
claims are deliberately left as written because read-only repo files cannot settle them. First, "the framework
ships a `dotnet new` pack" whose content is staged at pack time: the staging mechanism is real but lives in
MMCA.Helpdesk (`MMCA.Helpdesk/build/templates/stage.ps1`), not in MMCA.Common, so the wording is loose about which
repo produces the pack. Second, the "two deployed apps" claim: both repos ship a `deploy.yml` and both pin the
same framework version, but live-in-Azure state is not provable from repo files read-only.*

- Full series index: https://ivanball.github.io/writing.html
