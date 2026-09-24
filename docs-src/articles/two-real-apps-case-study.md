# Two real apps on one framework: a conference platform and a store

> Series: MMCA.Common · Article #41 (case study) · Pillar P6 · Rubric: §4, §5, §7, §10, §32 · ADR-016 ·
> Status: grounded in `MMCA.ADC/README.md`, `MMCA.ADC/CLAUDE.md`, `MMCA.Store/README.md`,
> `MMCA.Store/CLAUDE.md`, and `Website/docs-src/governance/common-ArchitectureScorecard.md` (the §4/§5 downstream-evidence rows).
> No em dashes.

**Subtitle:** A framework's README can claim anything. The real test is whether two unrelated
applications, with different domains and different deployments, can both run on it without forking it.
Here are the two that do.

---

Every architecture framework looks clean in its own repository. The author controls the examples, the
tests pass, the diagrams are tidy. The question a senior engineer actually asks is harder: **does this
survive contact with a real domain, real users, and a real deployment, or is it a toy that only its
author can run?**

MMCA.Common answers that question with two applications built on it. They are not demos in a `samples/`
folder. They are separate repositories with their own business domains, their own databases, their own
CI/CD, and their own production deployments to Azure. Both consume the framework's published packages
at one lockstep version, and they prove different things the framework cannot prove about itself.

This article is the case study. It is also the honest part: the framework's own scorecard flags that a
few categories are demonstrated mainly in these consumer apps, not in the framework, and that is exactly
why the apps matter.

## The two apps

**MMCA.ADC** is the Atlanta Developers Conference application. Its domain is events: conferences,
sessions, speakers, rooms, categories, and the questions attendees ask. It carries four modules:

- **Identity** (the `User` aggregate, JWT auth, plus social login via Google and GitHub),
- **Conference** (events, sessions, speakers, rooms, categories, questions and answers, social
  activities, partners and session assets, across eighteen domain REST controllers),
- **Engagement** (session bookmarks, event and session feedback, and the conference-day live layer:
  the `LivePolls` and `SessionQuestions` aggregates behind Happening Now, the session Live view, and
  the presenter UI),
- **Notification** (a thin SignalR module hosting the real-time notification hub).

It is deployed to Azure Container Apps, one container image per deployable (the four services, the
Gateway, and the web UI), and a merge to `main` is the deploy: the pipeline builds, tests, and rolls
the release out. That is a harder claim than "it builds": the framework is carrying a six-image
production topology, not a sample project.

**MMCA.Store** is an e-commerce application. Its domain is selling things: a product catalog, orders and
carts, and the payment plumbing around them. It carries three modules:

- **Catalog** (`Category`, `Product`, `ProductVariant` with an owned `VariantDiscount` resolved by
  `GetEffectivePrice(now)`, plus the `Reviews` aggregate: `ProductReview` and `VerifiedPurchase`, with
  a derived `RatingSummary` owned by `Product`),
- **Sales** (`Order` with `OrderLine` and an owned `Shipment`, `ShoppingCart`, `InventoryItem`, plus
  Stripe payment integration and a webhook route the Gateway keeps on HTTP/1.1),
- **Identity** (the `User` aggregate, `Customer` entity, JWT auth with refresh tokens).

These are genuinely different bounded contexts. A `Speaker` linked to a `User` by email and a
`ProductVariant` that fans out into a zero-stock `InventoryItem` are not the same shape of problem. That
difference is the point. A framework that only fits one domain is a template; a framework that fits two
unrelated domains is infrastructure.

## What they actually share

Both apps sit at the **same architecture stage**, and that is deliberate. Each one has its modules
extracted into separate service hosts (one process per module) behind a YARP reverse-proxy Gateway
pinned to `https://localhost:6001`. Services talk to each other synchronously over gRPC (typed clients
defined in `*.Contracts` projects) and asynchronously over a broker using the outbox pattern. Tokens are
signed with RS256 and validated through JWKS discovery, with no shared secret.

None of that topology is hand-rolled per app. It comes from the framework:

- **The same packages, at the same number.** MMCA.Common publishes nineteen packages, and each app pins
  the subset it uses at one identical version literal: ADC pins eighteen `MMCA.Common.*` entries
  (`.Shared`, `.Domain`, `.Application`, `.Infrastructure`, `.AI`, `.API`, `.Grpc`, `.Gateway`, `.UI`,
  `.UI.Maui`, `.UI.Web`, `.Aspire`, `.Aspire.Hosting`, `.Testing`, `.Testing.Architecture`,
  `.Testing.Aspire`, `.Testing.E2E`, `.Testing.UI`), Store pins seventeen of those, taking no `.AI`.
- **The same patterns.** `Result<T>` for error flow, the CQRS command/query split with the same
  decorator order (commands run FeatureGate then Authorization then Logging then Caching then
  Validating then Timeout then Transactional then the handler; queries run FeatureGate then
  Authorization then Logging then Caching then Validating then Timeout then the handler), the
  `AuditableAggregateRootEntity` base with `AddDomainEvent()`, the transactional outbox captured in
  `SaveChangesAsync()`, and database-per-service routing by logical data source name. Both apps run one
  SQL database per service (`ADC_Identity`, `ADC_Conference`, and so on for ADC; `Store_Catalog`,
  `Store_Sales`, `Store_Identity` for Store), each with its own `OutboxMessages` table so no service
  races another for outbox rows.
- **The same fitness rules, applied to their own code.** This is the part most "reference architecture"
  repos skip. The architecture tests are not copy-pasted into each app. The rule bodies live once in the
  `MMCA.Common.Testing.Architecture` package as a rule library plus abstract test bases parameterized by
  an `IArchitectureMap`. Each app supplies **its own map** (one anchor type per package) and subclasses
  the same bases, so the layer, purity, and extraction rules are literally identical across MMCA.Common,
  MMCA.ADC, and MMCA.Store. The transport-leakage rule that forbids Domain and Application from touching
  MassTransit applies to all three the same way.

The shared abstractions are exactly the swap points the framework promises. The same `IMessageBus`-backed
event that fires in-process in a monolith fires over a broker once the module is its own service, and
the consuming app does not change its handler code to make that switch.

## How a framework change ships

The interesting operational property is not that the apps share code. It is **how a change to the shared
code reaches them.** There is no phased rollout, no opt-in flag, no per-consumer compatibility shim.

The release is a lockstep sweep:

1. Tag a new MMCA.Common version (the version comes from the git tag via MinVer). All nineteen packages
   publish at that same version.
2. In each consumer, bump every `MMCA.Common.*` entry in `Directory.Packages.props` to the new version
   in one pass. ADC keeps its eighteen entries and Store its seventeen on the same number.
3. Build, run the fitness tests and the rest of the suite, deploy.

The framework's versioning policy doc (`common-VERSIONING.md`, canonical in the published docs
library rather than in the framework repo) states the policy
plainly: the packages are versioned and released together as a single unit (the authoritative list and
count live in `FACTS.md`), versions come from MinVer git
tags, and consumers are swept in one pass with no phased rollout. That is
a real constraint, and it is the trade the framework makes on purpose: every consumer stays on one
coherent version of the contract, so there is never a matrix of "ADC is on 1.74 but Store is on 1.71 of
three of the packages." The cost is that a breaking change has to be absorbed everywhere at once, which
is why breaking changes go through a new event type plus an upcaster rather than a silent reshape (the
event-schema-versioning ADR), and why the MassTransit v8 pin is guarded by a test in the framework
rather than a comment.

## What each app proves that the framework cannot

A framework can demonstrate a pattern. It cannot, by itself, demonstrate that the pattern survives a
real domain and a real deployment. That is the division of labor between MMCA.Common and its consumers.

**ADC proves real bounded contexts and real eventing.** Identity publishing `UserRegistered` so
Conference can auto-link a speaker by email match is a genuine cross-context workflow, not a contrived
one. Conference calling Engagement's bookmark-count service over gRPC, with a disabled-module stub
standing in when Engagement is not co-hosted, is the extraction boundary working in a running system
rather than in a unit test. And the deployment is the operability proof: four services plus a gateway
and a web UI, each
service owning its own database and its own `OutboxMessages` table, rolled to Azure Container Apps.

**Store proves a second, independent shape.** Catalog publishing `ProductVariantChanged` so Sales
auto-creates a zero-stock inventory record is a different integration than ADC's, with a different
consistency story (publish-after-commit so the database-generated variant ID is known). Store also
exercises surfaces ADC does not: Stripe payments with a webhook, and compensating saga handlers that
restore inventory on order cancellation. Ownership authorization is not one of them: both apps
configure the framework's `OwnerOrAdminFilter`, Store over customer-owned rows and ADC over its
bookmark list endpoints, which is a nice illustration of the same extension point landing in two
different vocabularies. Notably,
Store and ADC **deliberately diverge** on one point: when a user registers, Store raises an in-process
*domain* event (its `Customer` lives in the same Identity service) while ADC raises a cross-service
*integration* event. Same idea, different mechanism, each correct for its topology. A framework that
forced them to be identical would be wrong; the framework lets each app make the right local call.

## The honest note

Here is the caveat the framework writes about itself. It is not a preamble or a methodology section:
it is written into the category rows. Because the framework is a library and not a runnable app, a
few categories can only be judged on the substrate it provides, not on realized behavior. The §4
Domain-Driven Design row holds its implementation score at 8 because strategic DDD is "still realized
downstream (only Notifications lives here)", and the §5 Vertical Slice Architecture row holds at 8
because "the enforced in-repo slicing surface is still the Notifications family": the framework ships
a second sliced family (the `Users` use cases, thirteen abstract handler bases across nine folders) and
the slice gate does reach abstract bases, but twelve of the thirteen declare their handler contract over
a generic parameter and are exempt by design, and every one of them logs through the shared
`UserUseCaseLog` switchboard, so the family deepens the pattern without widening the enforced surface.
**For both, the real surface lives in MMCA.Store and MMCA.ADC.** For performance and
cost, the framework ships an in-repo BenchmarkDotNet hot-path harness (§12) and a released cost guide
(§31); only full load/stress data lives in the consumer apps.

That is not a weakness to hide; it is the reason the two apps exist. The framework supplies the base
classes, the enforced layering, and the extraction points. The apps supply the proof that those things
hold up against two different real domains and two different production deployments. The
framework's two-axis evaluation scores it at roughly 97% maturity and 86% implementation (97.0% and 86.0%
exactly), with implementation
the weaker axis precisely because some of the most important "does this actually model a domain well"
evidence lives downstream, in the consumers, where it should.

## What we covered / Next

**What we covered:** two unrelated applications, a conference platform and an e-commerce store, both
running on the same MMCA.Common packages at the same lockstep version and the same architecture stage;
what they share (the packages, the same fitness rules via their own architecture maps, the same
Result/CQRS/outbox/
database-per-service patterns); how a framework change ships as a lockstep sweep with no phased rollout;
what each app proves that the framework cannot (real bounded contexts, real eventing, real production
deployments); and the framework's own honest note, written into the §4 and §5 scorecard rows, that a
few categories are best evidenced in these consumers.

**Next in the series:** a device-capability layer that lets one Blazor UI run in a browser and inside a
native MAUI phone app, talking to native hardware through small per-capability contracts chosen at DI
composition per host.

---

*MMCA.Common is Apache-2.0 licensed and open source. The fastest way to judge whether it is a toy is to look at
what runs on it. Star the repo, skim the scorecard's §4 and §5 rows (the downstream-evidence note is the
honest part), or `dotnet add package MMCA.Common.API` and build your own third app on it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- The 34-category scorecard, including those downstream-evidence rows, is published in the docs site.

*Tags: .NET, Software Architecture, Microservices, DDD, Open Source*

*Notes: ADC/Store claims are limited to what `MMCA.ADC/README.md`, `MMCA.ADC/CLAUDE.md`,
`MMCA.Store/README.md`, and `MMCA.Store/CLAUDE.md` support (modules, topology, the lockstep package
pins, the two divergent eventing flows). Removed in an earlier pass and still out: the "was used to run
an actual live event" and "real attendees used it" framing, which no repo document supports. What the
tree does state, re-read this run: deploy to Azure Container Apps on a push to `main`
(`MMCA.ADC/CLAUDE.md:83`), one Dockerfile per deployable across the four services plus the Gateway and
UI.Web (`:68`), and each service owning its own database and its own `dbo.OutboxMessages` (`:62`).
Packages and versions verified this run: the framework publishes nineteen packages
(`MMCA.Common/FACTS.md:19`, enumerated at `:22-40`) at v1.205.0 (`:14`, snapshot dated 2026-09-17 at
`:4`), and the changelog's newest dated entry is `## [1.205.0] - 2026-09-17`
(`MMCA.Common/CHANGELOG.md:9`, with 1.204.0 at `:15`). The consumers pin subsets, not the whole set, and
each subset is in lockstep: ADC carries eighteen `MMCA.Common.*` entries, all at 1.205.0
(`MMCA.ADC/Directory.Packages.props:102-132`, `.Grpc` at `:102`, `.AI` at `:110`, `.Gateway` at `:118`,
`.UI.Maui` at `:132`), and Store carries seventeen, also all at 1.205.0 and with no `.AI` entry
(`MMCA.Store/Directory.Packages.props:8-26`, `.Grpc` at `:73`, `.Aspire.Hosting` at `:111`), including
the one MAUI-TFM package `MMCA.Common.UI.Maui` in both. Corrected this run: the previous ledger recorded
fifteen packages at v1.154.0 and a "same fifteen entries" claim for both consumers; both the count and
the equality were wrong. Corrected this run: the query chain is six decorators, not five. Execution
order is FeatureGate then Authorization then Logging then Caching then Validating then Timeout then
Transactional then the handler for commands, and FeatureGate then Authorization then Logging then
Caching then Validating then Timeout then the handler for queries (`MMCA.Common/CLAUDE.md:80`), read off
the Scrutor `TryDecorate` registration order (innermost first) at
`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:137-143` for commands and
`:146-151` for queries, where `ValidatingQueryDecorator` sits at `:147`. The scorecard's §1 SOLID
evidence column (`Website/docs-src/governance/common-ArchitectureScorecard.md:81`) still carries the
older decorator string and a stale `Application/DependencyInjection.cs:94-103` range, so that row is
itself drifted and is not the anchor for this claim: source plus `MMCA.Common/CLAUDE.md` are. Counted
this run rather than quoted: the Conference module's
`Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/` folder holds eighteen domain REST
controllers (Activities, CategoryItems, ConferenceCategories, EventQuestionAnswers, Events,
EventSpeakers, Partners, Questions, Rooms, SessionAssets, SessionCategoryItems, SessionQuestionAnswers,
SessionSelection, SessionSpeakers, Sessions, SpeakerCategoryItems, Speakers, Sponsors) plus the shared
`ServiceInfoController`; `MMCA.ADC/CLAUDE.md:50` states seventeen and owns the domain list (events,
sessions, speakers, rooms, categories, questions/answers, social activities, partners, session assets),
so the article states the counted figure and that doc line is itself one behind. Store module contents
re-read this run: Catalog owns `Category`, `Product`, `ProductVariant` plus the `Reviews` aggregate
(`ProductReview`, `VerifiedPurchase`) with a derived `RatingSummary` owned by `Product`, and a variant
carries an owned `VariantDiscount` resolved by `GetEffectivePrice(now)` (`MMCA.Store/CLAUDE.md:49`);
Sales owns `Order` (plus `OrderLine` and an owned `Shipment`), `ShoppingCart` and `InventoryItem` with
Stripe payments (`:50`), and the Sales cluster keeps YARP's HTTP/1.1-capable defaults for REST plus the
Stripe webhook (`:44`). Dropped this run: `ShoppingCartItem` and "hierarchical categories, variant
pricing and SKUs", none of which those lines state. ADC's Engagement module owns session bookmarks,
feedback and the conference-day live layer (LivePolls + SessionQuestions, Happening Now / session Live /
presenter UI, `MMCA.ADC/CLAUDE.md:51`); ownership authorization is not ADC-absent, ADC configures
MMCA.Common's `OwnerOrAdminFilter` on the Bookmarks list endpoints in `AddModuleEngagementAPI`
(`:66`); and the BR-207 divergence from Store is recorded as deliberate at `:57`. `VERSIONING.md` does
not live in MMCA.Common, it is `Website/docs-src/guides/common-VERSIONING.md`, which states that the
packages are versioned and released together as a single unit with the authoritative list and count in
FACTS.md (`:5-7`, so the earlier "states fifteen packages" note is retired: the doc states no count),
MinVer from annotated git tags (`:25`), no opt-in flags or phased rollouts (`:67`), and the
fitness-tested MassTransit v8 pin (`:87`). Scorecard numbers re-read this run: the framework's two-axis
index is Maturity 97.0% (318/328) and Implementation 86.0% (705/820)
(`Website/docs-src/governance/common-ArchitectureScorecard.md:120-121`), nothing is excluded from the
denominators (`:124`), and the latest cycle is the thirty-sixth-wave full 34-category re-score of
2026-09-19 at v1.205.0 (git HEAD `90ffa7a`, clean tree), which moved no score: ten first-pass lifts came
back FLAG and were refuted on the adversarial pass (header line `:5`). The earlier 314/324 and 687/810
denominators were pre-rubric-v2; under ADR-110 the weight sum is 82, §10 is Messaging & Integration
Architecture and §16 is AI-Native Application Architecture, which this article does not evidence: its
categories are §4, §5, §7, §10 and §32. The downstream-evidence caveat is written into the rows
themselves: §4 DDD holds at 8 with strategic DDD "still realized downstream (only Notifications lives
here)" (`:84`), and §5 VSA holds at 8 on "the enforced in-repo slicing surface is still the Notifications
family" (`:85`). Corrected this run: the stated reason for that §5 cap moved. v1.203.0 (commit
`630afc9`) widened both slice rules to every Application class including abstract bases
(`Rules/Cqrs/ArchitectureRules.Slices.cs:39,69`), so "outside the concrete-class slice gate" is not the
cap; the row records that 12 of the 13 Users bases declare their contract over a generic parameter and
stay exempt by design, that the family is 13 bases across 9 folders rather than five handlers, and that
each use case still edits the shared `UserUseCaseLog` switchboard. Performance and cost are not "no
in-repo evidence": §12 ships a repeatable BenchmarkDotNet hot-path harness (`:92`) and §31 cites a
released cost guide (`:111`, the doc itself is `Website/docs-src/guides/common-COST.md`), with full
load/stress data living in the consumer apps. The two consumer scorecards sit on the same instrument:
ADC scores Maturity 98.5% (319/324) and Implementation 86.2% (698/810) on its thirty-second-cycle full
re-score of 2026-09-16 at pin v1.204.0, git HEAD `631c7ba6`, its Implementation axis up from 85.4%
(692/810) (`Website/docs-src/governance/adc-ArchitectureScorecard.md:92-93`), and Store scores Maturity
97.8% (309/316) and Implementation 83.9% (663/790) on its 2026-09-04 full re-score, the first against
rubric v2, which moved no score (`Website/docs-src/governance/store-ArchitectureScorecard.md:57-58`,
header `:5`). That two-axis scorecard is canonical in the Website docs library since the 2026-07-20
centralization (it is no longer carried in MMCA.Common), and it replaced an earlier single-axis 80%
snapshot that survives only in git history and is therefore not checkable from the working tree: the
original-snapshot-then-fixed-then-re-scored framing stands, the 80% figure is a history assertion.*

- Full series index: https://ivanball.github.io/writing.html
