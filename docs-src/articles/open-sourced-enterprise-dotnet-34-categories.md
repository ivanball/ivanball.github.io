# I open-sourced the enterprise .NET plumbing I never want to rewrite, and graded it against 34 categories

> Series: MMCA.Common · Article #1 (cornerstone) · Pillar P1/P4 · Rubric: all
> Status: grounded in `MMCA.Common/README.md`, `MMCA.Common/CLAUDE.md`,
> `Website/docs-src/governance/common-ArchitectureScorecard.md`, `Website/docs-src/onboarding/00-index.md`. No em
> dashes. Current facts (19 packages, 125 ADRs, two-axis index M 97.0% / I 86.0%).

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

MMCA.Common is a set of **nineteen NuGet packages** that give you a DDD + Clean Architecture + CQRS
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
couple to Domain, Application, or Infrastructure. The rest of the UI family builds on `UI` rather than
the layer stack: `UI.Web` is the web-host UI package, and `UI.Maui` (the one MAUI-target package)
depends on `UI` plus `Shared` only (ADR-042).

Two more packages sit outside the stack entirely. `Gateway` is the YARP edge that fronts the service
hosts once modules are extracted (ADR-008), and `AI` is a governed boundary for language-model calls,
isolated, versioned, evaluated, observed, and bounded in one package so a second AI feature inherits
the rules instead of copying them (ADR-120). The nineteenth package is `MMCA.Common` itself: a
metapackage that ships no assembly, one `PackageReference` in place of the six a standard application
host always takes (ADR-101).

Adding it to a solution you already have is one line, and each package transitively pulls the layers
beneath it:

```powershell
dotnet add package MMCA.Common.API
```

`API` brings `Infrastructure`, which brings `Application`, `Domain`, and `Shared`. The other packages
(`Grpc`, `UI`, `UI.Web`, `UI.Maui`, `Aspire`, `Aspire.Hosting`, `Gateway`, `AI`, and five `Testing.*`
packages) are opt-in for the surface you need.

Starting from nothing is a different command, because a package reference is not an application. A
solution on this framework is twelve projects and roughly 6,600 lines of plumbing before any business
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

Those fitness functions do not live as copy-pasted test code in three repos. They live once, in a
shipped package, `MMCA.Common.Testing.Architecture`, which exposes a reusable rule library and abstract
test bases (**136 test methods across 53 base classes**). MMCA.Common's own build runs
267 of them; the two consumer apps subclass the same bases and supply their own architecture map,
so the rules are literally identical across all three codebases.

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
**maturity index of 97.0% and an implementation index of 86.0%** across all 34 categories
(internationalization ships in the framework as en-US plus Spanish under ADR-027, which supersedes the
single-locale ADR-011, so it scores on both axes like every other category; nothing is excluded as
N/A). Then I committed the full evaluation to the repo, with every category's two scores, the evidence,
and the honest gaps.

The rubric itself is versioned. Version 2 (ADR-110) keeps all 34 categories and scores category 10 as
**Messaging & Integration Architecture** (Maturity 4 / Implementation 9) and category 16 as **AI-Native
Application Architecture** (Maturity 3 / Implementation 6), which is where the governed language-model
boundary is graded.

The pattern in the scores is the same line from earlier: **every category that earned top marks was
backed by a fitness function or a compile-time guard. Every category capped lower either left the
design to code review, or has its real proof living downstream in a consumer app.** Clean Architecture,
SOLID, microservices readiness, CQRS, and testability all sit at Maturity 4 / Implementation 9, and all
of them are enforced automatically.

Implementation is the weaker axis on purpose. A framework ships mature, well-governed mechanisms whose
full execution often completes in the apps that consume it. Deployment, resilience recovery, and
data-migration gating all score higher on maturity than on implementation precisely because the
substance they reward (infrastructure-as-code, a drilled restore, a CI migration step) lives in
MMCA.ADC and MMCA.Store, not in a library.

The headline gap the rubric named was **Compliance and Privacy**: soft-delete everywhere and no
right-to-erasure path, which is the exact GDPR conflict the rubric names. I wrote that down rather than
hiding it, and it became ADR-005, a real anonymization extension point, and a PII fitness function that fails the
build. That is the whole point of scoring yourself in public: the gaps turn into the roadmap.

## It runs in production, on two real apps

MMCA.Common is not a toy. Two deployed apps consume the same nineteen packages:

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

*Notes / honest gaps: every figure below was re-read from source on 2026-09-19. The two-axis scores are the
current indices in the canonical `Website/docs-src/governance/common-ArchitectureScorecard.md` (Maturity 97.0% =
318/328, `common-ArchitectureScorecard.md:120`; Implementation 86.0% = 705/820,
`common-ArchitectureScorecard.md:121`), from the thirty-sixth-wave full re-score (2026-09-19, framework v1.205.0),
in which no value moved on either axis. Implementation stays the weaker axis by design, by about 11.0 points
(`common-ArchitectureScorecard.md:123`). The denominators are rubric version 2's (ADR-110,
`common-ArchitectureScorecard.md:5`), which keeps all 34 categories and scores category 10 as Messaging &
Integration Architecture at Maturity 4 / Implementation 9 (`common-ArchitectureScorecard.md:90`) and category 16
as AI-Native Application Architecture at Maturity 3 / Implementation 6 (`common-ArchitectureScorecard.md:96`);
those two names are the rubric's own headings
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:329,469`). No category is excluded as N/A
(`common-ArchitectureScorecard.md:124`), and ADR-027 multi-locale i18n (en-US plus Spanish) supersedes the
single-locale ADR-011 (`Website/docs-src/adr/README.md:39,23`). The package count (19, `FACTS.md:19`) was read
from `FACTS.md`, the CI-gated source of truth; its list carries `MMCA.Common.AI` (`FACTS.md:22`),
`MMCA.Common.Gateway` (`FACTS.md:34`), five `Testing.*` packages (`FACTS.md:35-39`) and the `MMCA.Common`
metapackage (`FACTS.md:40`). Gateway is the YARP edge of ADR-008 (`Website/docs-src/adr/README.md:20`), AI is the
governed language-model boundary of ADR-120 (`Website/docs-src/adr/README.md:132`), and the metapackage that
ships no assembly in place of the Core 6 is ADR-101 (`Website/docs-src/adr/README.md:113`). `FACTS.md` delegates
the ADR count and range to the canonical index (125 accepted ADRs, 001-125,
`Website/docs-src/adr/README.md:6`); the framework version pinned in `FACTS.md:14` is v1.205.0 and `FACTS.md:4`
dates that generated snapshot 2026-09-17. Lockstep holds: both consumers pin 1.205.0
(`MMCA.Store/Directory.Packages.props:8-14`, `MMCA.ADC/Directory.Packages.props:104-113`). The
136-test-methods-across-53-abstract-`*TestsBase`-classes figure, and the 267 of them MMCA.Common's own build
executes, are `FACTS.md:48` and `FACTS.md:51`. The UI family off to the side of the layer stack: `UI` and `Grpc`
depend on `Shared` only, `UI.Web` is the web-host UI package, and `UI.Maui` (the one MAUI-target package) depends
on `UI` plus `Shared` only (ADR-042, `Website/docs-src/adr/README.md:54`). The fast-test figure is the
scorecard's category 14 row (roughly 2,254 `[Fact]`/`[Theory]`, counts re-synced 2026-09-14,
`common-ArchitectureScorecard.md:94`), and the 2,000-test zero-discovery floor is the literal
`--minimum-expected-tests 2000` on the unit tier (`MMCA.Common/.github/workflows/ci.yml:183`); both keep moving,
so re-read before publishing. The scorecard's own Top-5-strengths block still quotes an older 1,880-across-262-files
count (`common-ArchitectureScorecard.md:133`), which is a scorecard-side follow-up to reconcile in the Website
repo rather than article drift, so this article cites the category 14 row instead. The twelve-projects and
roughly-6,600-lines figure is anchored on `Website/docs-src/guides/common-GETTING-STARTED.md:10` ("12 projects and
roughly 6,600 lines before a line of your own"). The Compliance and Privacy gap is real but answered: ADR-005 plus
an `IAnonymizable` erasure extension point and a PII fitness function, so the "scored, then fixed" framing is
deliberate. The five categories in the top-marks paragraph are category 1 SOLID
(`common-ArchitectureScorecard.md:81`), category 3 Clean Architecture (`:83`), category 6 CQRS & Event-Driven
(`:86`), category 7 Microservices Readiness (`:87`) and category 14 Testability & Test Strategy (`:94`), all at
Maturity 4 / Implementation 9; the paragraph claims those scores rather than exclusivity, because 4/9 is a band
shared with many rows, category 8 Data Architecture among them (`common-ArchitectureScorecard.md:88`). Two claims
are deliberately left as written because read-only repo files cannot settle them. First, "the framework ships a
`dotnet new` pack" whose content is staged at pack time: the staging mechanism is real but lives in MMCA.Helpdesk
(`MMCA.Helpdesk/build/templates/stage.ps1`), not in MMCA.Common, so the wording is loose about which repo
produces the pack. Second, the "two deployed apps" claim: both repos ship a `deploy.yml` and both pin the same
framework version, but live-in-Azure state is not provable from repo files read-only.*

- Full series index: https://ivanball.github.io/writing.html
