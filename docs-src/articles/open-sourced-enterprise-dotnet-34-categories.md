# I open-sourced the enterprise .NET plumbing I never want to rewrite, and graded it against 34 categories

> Series: MMCA.Common · Article #1 (cornerstone) · Pillar P1/P4 · Rubric: all
> Status: grounded in `MMCA.Common/README.md`, `MMCA.Common/AGENTS.md`, `MMCA.Common/FACTS.md`,
> `MMCA.Common/build/Frameworks.props`, `Website/docs-src/governance/common-ArchitectureScorecard.md`,
> `Website/docs-src/onboarding/00-index.md`. No em dashes. Current facts (30 packages, 147 ADRs, two-axis index
> M 97.3% / I 85.1%).

**Subtitle:** A .NET 10 and .NET 11 framework for DDD, Clean Architecture, and CQRS, built as a modular monolith
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

It is called **MMCA.Common** (Modular Monolith Clean Architecture), it targets .NET 10 and .NET 11
from one source tree, and this article is the front door to a series that teaches it one pattern at a time.

## What it is

MMCA.Common is a set of **thirty NuGet packages** that give you a DDD + Clean Architecture + CQRS
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
ships the replay harness that pins prompt contracts. `Azure`, `Azure.Startup`, `Aws`, and `Gcp` are the
cloud vendor adapters (ADR-134): the core packages reference no cloud SDK, and each of `Azure`, `Aws`, and
`Gcp`, built on `Infrastructure` and `Aspire`, adds one registration call per vendor capability (file storage,
push, secrets and, for AWS and Azure, a broker transport), while `Azure.Startup` carries the Azure start-up
pieces (Key Vault configuration, the Azure Monitor exporter, the DataProtection key ring) with no persistence
or messaging dependency, and `Testing.Azure` is the matching test-side fixture ([the adapter pattern in
full](cloud-neutral-vendor-adapters.md)).

Three more opt-in packages build on top of the stack rather than inside it: `Passkeys` adds WebAuthn
sign-in and a second factor on `Application` (ADR-139), `Mcp` serves a Model Context Protocol endpoint over
a host's read-only tools on `API` (ADR-138), and `ServiceHost` is the composed, cloud-neutral service-host
start-up over `API`, `Aspire`, and `Grpc`. The thirtieth package is `MMCA.Common` itself:
a metapackage that ships no assembly, one `PackageReference` in place of the six a standard application
host always takes (ADR-101).

Adding it to a solution you already have is one line, and each package transitively pulls the layers
beneath it:

```powershell
dotnet add package MMCA.Common.API
```

`API` brings `Infrastructure`, which brings `Application`, `Domain`, and `Shared`. The other packages
(`Grpc`, `UI`, `UI.Web`, `UI.Maui`, `Aspire`, `Aspire.Hosting`, `Gateway`, `Passkeys`, `Mcp`,
`ServiceHost`, the four `AI` packages, the `Azure`, `Azure.Startup`, `Aws`, and `Gcp` adapters, and six
`Testing.*` packages) are opt-in for the surface you need.

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
2. **At runtime**, by fitness functions on the framework's own metadata-based rule engine that assert the same rules against the compiled
   assemblies.

Those fitness functions do not live as copy-pasted test code in each repo. They live once, in a
shipped package, `MMCA.Common.Testing.Architecture`, which exposes a reusable rule library and abstract
test bases (**186 test methods across 74 base classes**). MMCA.Common's own build executes 767 fitness
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
- A transport-agnostic **`IMessageBus`**, selected by configuration. The outbox drains integration
  events through it **in-process** today (`InProcessMessageBus`) and over a **broker** the day a module
  becomes its own service (`BrokerMessageBus`), while application code publishes through `IEventBus` and
  never names the transport. Application, Domain, and Shared are forbidden from referencing the broker
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
**maturity index of 97.3% and an implementation index of 85.1%** across all 34 categories
(internationalization ships in the framework as en-US plus Spanish under ADR-027, which supersedes the
single-locale ADR-011, so it scores on both axes like every other category; nothing is excluded as
N/A). Then I published the full evaluation on the framework's documentation site, with every category's
two scores, the evidence, and the honest gaps.

The rubric itself is versioned. Version 2 (ADR-110) keeps all 34 categories and scores category 10 as
**Messaging & Integration Architecture** (Maturity 4 / Implementation 8) and category 16 as **AI-Native
Application Architecture** (Maturity 4 / Implementation 8), which is where the governed language-model
boundary is graded.

The pattern in the scores is the same line from earlier: **every category that earned top marks was
backed by a fitness function or a compile-time guard. Every category capped lower either has its real
proof living downstream in a consumer app, or carries a named in-repo residual the scorecard writes
down.** Clean Architecture, microservices readiness, CQRS, and testability all sit at Maturity 4 /
Implementation 9, and all of them are enforced automatically. SOLID sits lower, at Maturity 3 /
Implementation 8, for exactly that reason: the principles are applied throughout, and SRP, DIP and the
throw half of LSP are enforced automatically, but OCP and ISP have no automated gate. Its Implementation
8 is held by named code gaps (a base context that resolves about nineteen collaborators through
`GetService`, one SQL Server-named unique-violation detector serving every engine, a few very large
classes). Messaging holds at Implementation 8 the same way: the shared receive pipeline dead-letters a
poison message but never replays it, and no shipped alert watches its fault counter; the live-broker CI
tiers (PostgreSql, RabbitMQ, SQS/SNS against LocalStack, and Azure Service Bus against its emulator) are
not required checks; and a framework saga orchestrator stays a documented deferral (ADR-086).

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
is more than **12,000 fast tests** per target framework in a correct pyramid with no Docker or database
dependency, held above an 11,250-test zero-discovery floor on each framework leg by CI, so the inner
loop stays quick and a filter regression that silently drops tests fails the build.

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
- Read the full 34-category scorecard, gaps included:
  `https://ivanball.github.io/docs/governance/common-ArchitectureScorecard.html`
- `dotnet new install MMCA.Templates` then `dotnet new mmca-app -n Your.App`, and tell me what breaks.

Next up: how a modular monolith becomes microservices without a rewrite, and
why that extraction point is something you build now, not a migration you survive later.

---

*Tags: .NET, C Sharp, Software Architecture, Microservices, Open Source*

*Notes / honest gaps: every figure below was re-verified from source on 2026-11-25 against MMCA.Common v1.319.0
(`MMCA.Common/FACTS.md:4,14`). The 2026-11-25 pass changed owned figures, anchors and three source-derived
sentences. The package count moved from 26 to 30 (`FACTS.md:20`; the new entries are `MMCA.Common.Passkeys` `:29`,
`MMCA.Common.Mcp` `:33`, `MMCA.Common.Azure.Startup` `:42` and `MMCA.Common.ServiceHost` `:45`), so the metapackage
is the thirtieth (`FACTS.md:52`), the opt-in list names the four, and a new sentence places them: `Passkeys`
references `Application` (`FACTS.md:67`; ADR-139 at `Website/docs-src/adr/README.md:152`), `Mcp` references `API`
(`FACTS.md:71`; ADR-138 at `README.md:151`), `ServiceHost` references `API`, `Grpc` and `Aspire` (`FACTS.md:83`), and
`Azure.Startup` references only `Aspire` (`FACTS.md:80`) and is referenced by `Azure` (`:79`); each description
follows its csproj `<Description>` (`MMCA.Common/Source/{Core/MMCA.Common.Passkeys,Presentation/MMCA.Common.Mcp,
Hosting/MMCA.Common.ServiceHost,Hosting/MMCA.Common.Azure.Startup}/*.csproj:4`). The framework-target wording moved
from ".NET 10" to ".NET 10 and .NET 11 from one source tree" (`MMCA.Common/build/Frameworks.props:23`,
`MmcaNetVersions` = `net10.0;net11.0`; ADR-141 at `Website/docs-src/adr/README.md:154`). The fitness suite moved from
160 / 64 / 479 to 186 / 74 / 767 (`FACTS.md:98,101`). The ADR count moved from 136 to 147
(`Website/docs-src/adr/README.md:6`). The Implementation index moved from 85.4% (700/820) to 85.1% (698/820)
(`common-ArchitectureScorecard.md:11`); Maturity holds at 97.3% = 319/328 (`:10`). Category 16 AI-Native moved from
Implementation 9 to 8 (`:81`; held at 8 on the partial guardrail and evaluation criteria, `:16`). The SOLID
`GetService` count moved from about thirteen to about nineteen (`:66`). The Messaging held-at-8 sentence was
rewritten from the category 10 row (`:75`): the row records the opt-in RabbitMQ delayed redelivery as gone
(per-interval delay queues), live-broker CI tiers for all four transports (`postgresql-integration`,
`rabbitmq-integration`, `aws-integration` and `azure-integration`, cited by the row at
`MMCA.Common/.github/workflows/ci.yml:1080,1140,1251,1377`, none of them a required check per the CI section of
`MMCA.Common/AGENTS.md`), and the reasons that remain (the pipeline dead-letters but never replays,
`broker.fault.count` drives no shipped alert, and the ADR-086 orchestrator deferral). The `IMessageBus` bullet, which
the audit marked UNVERIFIABLE because "the same code dispatches" read as if application code called `IMessageBus`,
was reworded and is settled from source: application code publishes through `IEventBus.PublishAsync`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventBus.cs:13,20`; the SaveChanges flow
section of `MMCA.Common/AGENTS.md`), `IMessageBus` (`Application/Messaging/IMessageBus.cs:29`) is the transport the
outbox processor publishes through (`Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:26,107`),
selected by `MessageBus:Provider` (`Infrastructure/Messaging/BrokerMessageBus.cs:15`), and both
`InProcessMessageBus` (`Infrastructure/Messaging/InProcessMessageBus.cs:18`) and `BrokerMessageBus` (`:46`) exist.
The fast-test figure moved from "more than 9,000" to "more than 12,000 per target framework", and the
zero-discovery floor from 2,000 to 11,250 on each framework leg (`--minimum-expected-tests 11250`,
`MMCA.Common/.github/workflows/ci.yml:185`); the suite size is the CI comment's measured 12579 on net10.0 and 25161
across both frameworks (`ci.yml:170-171`, a local measurement dated 2026-11-22, not a CI run summary read this
pass), and `release.yml:102` keeps a 22500 floor for its combined two-framework run; both numbers keep moving, so
re-read before publishing. The lockstep pins moved from 1.265.1 to 1.319.0.
The two-axis scores are the current indices in the canonical `Website/docs-src/governance/common-ArchitectureScorecard.md`
(Maturity `:10`, Implementation `:11`), evidence dated 2026-11-23 at v1.315.0 with facts re-verified 2026-11-24 at
v1.318.0 (`:5,6`). The article keeps its deliberate framing (scored against the original committed snapshot, then
fixed, then re-scored): category 1 SOLID sits at Maturity 3 / Implementation 8 (`:66`) as one of four categories
below Maturity 4 (`:13`), so SOLID stays off the top-marks list and is named as the counter-example. The SOLID
sentence follows that row: SRP, DIP and the throw half of LSP are enforced automatically, Maturity 3 because OCP and
ISP have no automated gate, and Implementation 8 held by `ApplicationDbContext` resolving about 19 distinct
collaborators through `GetService`, one SqlServer-named unique-violation detector for every engine, and very large
classes (all `:66`). 18 categories sit at Implementation 8 or below (`:14`), most of the weight is consumer-owned
(categories 17, 29, 30 and 31, `:16`), and the rest carry named in-repo residuals, Messaging among them with no lever
identified yet (`:16`). Implementation stays the weaker axis by about 12.2 points (`:12`). The denominators are rubric
version 2's (ADR-110, `common-ArchitectureScorecard.md:3,5`, `Website/docs-src/adr/README.md:123`), which keeps all
34 categories and scores category 10 as Messaging & Integration Architecture at Maturity 4 / Implementation 8 (`:75`)
and category 16 as AI-Native Application Architecture at Maturity 4 / Implementation 8 (`:81`); those two names are
the rubric's own headings (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:329,469`). No category is
excluded as N/A (`common-ArchitectureScorecard.md:105`), and ADR-027 multi-locale i18n (en-US plus Spanish)
supersedes the single-locale ADR-011 (`Website/docs-src/adr/README.md:40,24`). The top-marks paragraph names
category 3 Clean Architecture (`common-ArchitectureScorecard.md:68`), category 6 CQRS & Event-Driven (`:71`),
category 7 Microservices Readiness (`:72`) and category 14 Testability & Test Strategy (`:79`), all at Maturity 4 /
Implementation 9; it claims those scores rather than exclusivity, because 4/9 is a band shared with other rows,
category 8 Data Architecture among them (`:73`). The weaker-axis paragraph cites category 17 DevOps & Deployment at
Maturity 3 / Implementation 8 (`:82`, full CD machinery in consumer repos) and category 29 Resilience & Business
Continuity at Maturity 4 / Implementation 8 (`:94`, production recovery targets against real cloud backups are
consumer infrastructure). The scorecard is canonical in the Website docs site and MMCA.Common carries only a link to
it (`MMCA.Common/README.md:56`, `MMCA.Common/AGENTS.md:178`).
The package list (`FACTS.md:20-52`, the CI-gated source of truth) carries `MMCA.Common.AI` (`:23`), the provider
adapters `AI.Anthropic` and `AI.OpenAI` (`:24-25`, each referencing `MMCA.Common.AI` at
`MMCA.Common/Source/Core/MMCA.Common.AI.{Anthropic,OpenAI}/*.csproj:12` and registering one `IAiProviderFactory` per
`MMCA.Common/AGENTS.md:61`), `AI.Testing` (`:37`), the cloud vendor adapters `MMCA.Common.Aws`, `.Azure` and `.Gcp`
(`:40,41,44`, each referencing `Infrastructure` and `Aspire` per `:78,79,82`; the capability list in the body follows
each adapter's csproj `<Description>`), `Azure.Startup` (`:42`), `MMCA.Common.Gateway` (`:43`), six `Testing.*`
packages (`:46-51`) and the `MMCA.Common` metapackage (`:52`). Gateway is the YARP edge of ADR-008
(`Website/docs-src/adr/README.md:21`), the AI family is the governed language-model boundary of ADR-120 (`:133`), the
vendor adapters are ADR-134 (`:147`), and the metapackage that ships no assembly in place of the Core 6 is ADR-101
(`:114`; the six references at `MMCA.Common/Source/MMCA.Common/MMCA.Common.csproj:22-27`). The UI family: `UI` and
`Grpc` depend on `Shared` only and `UI.Maui` (the one MAUI-target package) depends on `UI` (`FACTS.md:70,72,73`;
ADR-042 at `Website/docs-src/adr/README.md:55`); `UI.Web` references `UI`, `API`, `Aspire` and `Shared` directly
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/MMCA.Common.UI.Web.csproj:42-44,48`), so it sits above the layer
stack, not beside it. Lockstep holds: every `MMCA.Common.*` pin reads 1.319.0 in Store (20 of 20,
`MMCA.Store/Directory.Packages.props:28-129`), ADC (26 of 26, `MMCA.ADC/Directory.Packages.props:143-198`) and
Helpdesk (14 of 14, `MMCA.Helpdesk/Directory.Packages.props:82-98`). "Two deployed apps are built on it" stands in
place of a shared package count, because neither app pins every published package. The 186 test methods across 74
abstract `*TestsBase` classes and the 767 fitness tests MMCA.Common's own build executes are `FACTS.md:98` and
`FACTS.md:101`. `FACTS.md:99-100` names Common, ADC and Store as the subclassing repos; MMCA.Helpdesk is added from
source, with its own map at `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ServiceContractPurityTests.cs:11`
(`HelpdeskArchitectureMap`); no per-repo executed counts are claimed for the consumers. The twelve-projects and
roughly-9,000-lines figure is anchored on `Website/docs-src/guides/common-GETTING-STARTED.md:10`, the commands on
`:15-16`. The Compliance and Privacy gap is real but answered: ADR-005 (`Website/docs-src/adr/README.md:18`) plus an
`IAnonymizable` erasure extension point (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:22`)
and a PII fitness function (`PiiConventionTestsBase`,
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/PiiConventionTestsBase.cs:19`), so the
"scored, then fixed" framing is deliberate. Apache-2.0 is `MMCA.Common/Directory.Build.props:94`. Two claims are
deliberately left as written because read-only repo files cannot settle them. First, "the framework ships a
`dotnet new` pack" whose content is staged at pack time: the staging mechanism is real but lives in MMCA.Helpdesk
(`MMCA.Helpdesk/build/templates/stage.ps1`), not in MMCA.Common, so the wording is loose about which repo produces
the pack. Second, the "two deployed apps" claim: both repos ship a `deploy.yml` and both pin the same framework
version, but live-in-Azure state is not provable from repo files read-only.*

- Full series index: https://ivanball.github.io/writing.html
