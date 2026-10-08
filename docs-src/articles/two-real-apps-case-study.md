# Two real apps on one framework: a conference platform and a store

> Series: MMCA.Common · Article #41 (case study) · Pillar P6 · Rubric: §4, §5, §7, §10, §32 · ADR-016 ·
> Status: grounded in `MMCA.ADC/README.md`, `MMCA.ADC/AGENTS.md`, `MMCA.Store/README.md`,
> `MMCA.Store/AGENTS.md`, `MMCA.Common/FACTS.md`, both consumers' `Directory.Packages.props`, and `Website/docs-src/governance/common-ArchitectureScorecard.md` (the §4/§5 downstream-evidence rows).
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

- **Identity** (the `User` aggregate, JWT auth, plus social login via Google, GitHub and Sign in with Apple),
- **Conference** (events, sessions, speakers, rooms, categories, questions and answers, social
  activities, partners and session assets, across twenty-two domain REST controllers),
- **Engagement** (session bookmarks, event and session feedback, and the conference-day live layer:
  the `LivePolls` and `SessionQuestions` aggregates behind Happening Now, the session Live view, and
  the presenter UI),
- **Notification** (a thin SignalR module hosting the real-time notification hub).

It is deployed to Azure Container Apps, one container image per deployable (the four services, the
Gateway, and the web UI), and a merge to `main` is the deploy: the full build and test tiers gate the
pull request against the exact tree that merges, and the merge push builds the images and rolls the
release out. That is a harder claim than "it builds": the framework is carrying a six-image
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

- **The same packages, at the same number.** MMCA.Common publishes twenty-two packages, and each app pins
  the subset it uses at one identical version literal: ADC pins nineteen `MMCA.Common.*` entries
  (`.Shared`, `.Domain`, `.Application`, `.Infrastructure`, `.AI`, `.AI.Anthropic`, `.AI.Testing`,
  `.API`, `.Grpc`, `.Gateway`, `.UI`, `.UI.Maui`, `.UI.Web`, `.Aspire`, `.Aspire.Hosting`, `.Testing`,
  `.Testing.Architecture`, `.Testing.E2E`, `.Testing.UI`), Store pins sixteen of those, taking none of
  the `.AI` packages.
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

1. Tag a new MMCA.Common version (the version comes from the git tag via MinVer). All twenty-two packages
   publish at that same version.
2. In each consumer, bump every `MMCA.Common.*` entry in `Directory.Packages.props` to the new version
   in one pass. ADC keeps its nineteen entries and Store its sixteen on the same number.
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
one. Conference calling Engagement's bookmark-count service over gRPC, through an adapter that implements
the same `IBookmarkCountService` interface the in-process call uses (each service host loads only its
own module, so the gRPC client is what answers), is the extraction boundary working in a running system
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
Domain-Driven Design row holds its implementation score at 8 on two open criteria, the first being that
strategic DDD "is realized downstream, since the Domain layer holds one aggregate family
(Notifications) plus auth support types". The §5 Vertical Slice Architecture row holds at 8 because
Common "is an SDK with no business use-case slices of its own", so "slice cohesion is proven in the
consumer repos": the framework ships a second sliced family (the `Users` use cases, thirteen abstract
handler bases across nine folders) and the slice gate does reach abstract bases, but twelve of the
thirteen declare their handler contract over a generic parameter and are exempt by design, so the
family deepens the pattern without widening the enforced surface.
**For both, the real surface lives in MMCA.Store and MMCA.ADC.** For performance and
cost, the framework ships an in-repo BenchmarkDotNet hot-path harness plus a weekly load tier on SQLite
(§12) and a released cost guide (§31); what a library cannot carry is capacity-provisioning evidence,
which only a deployed app can supply.

That is not a weakness to hide; it is the reason the two apps exist. The framework supplies the base
classes, the enforced layering, and the extraction points. The apps supply the proof that those things
hold up against two different real domains and two different production deployments. The
framework's two-axis evaluation scores it at roughly 97% maturity and 86% implementation (96.6% and 86.0%
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

*Notes: refreshed 2026-10-08 against framework v1.233.0 (previous pass 2026-10-02 at v1.221.0).
2026-10-08 entry (Common v1.233.0): ADC's pin count corrected to nineteen and Store's to sixteen, with
`.Testing.Aspire` dropped from ADC's list (no `MMCA.Common.Testing.Aspire` entry in either
`Directory.Packages.props`; ADC entries at `MMCA.ADC/Directory.Packages.props:99-131`, Store at
`MMCA.Store/Directory.Packages.props:8-22`, `:72`, `:107`, all 1.233.0); ADC social login corrected to
Google, GitHub and Sign in with Apple (`MMCA.ADC/AGENTS.md:49`,
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:11`); the deploy
sentence corrected so tests gate the pull request and the merge push builds and deploys, because
`build-and-test` runs only on `pull_request` against the exact merge tree
(`MMCA.ADC/.github/workflows/deploy.yml:220-225`) and no post-merge job repeats the test tiers
(`MMCA.ADC/AGENTS.md:86`); the performance clause corrected because the §12 row records an in-repo load
tier run weekly on SQLite, not a required check, and names capacity-provisioning evidence as the gap
(`Website/docs-src/governance/common-ArchitectureScorecard.md:76`); framework version, changelog,
consumer pins and all three scorecard headers re-anchored in place below, and the Store Implementation
index moves to 83.2% (657/790). Passages below that say "this run" date from the 2026-10-02 pass
unless this entry re-anchored them. ADC/Store claims are limited to what
`MMCA.ADC/README.md`, `MMCA.ADC/AGENTS.md`, `MMCA.Store/README.md`, and `MMCA.Store/AGENTS.md` support
(modules, topology, the lockstep package pins, the two divergent eventing flows). Both repos'
`CLAUDE.md` files are six-line stubs that import `AGENTS.md`, so every former `CLAUDE.md:N` anchor is
re-pointed at `AGENTS.md` this run. Removed in an earlier pass and still out: the "was used to run an
actual live event" and "real attendees used it" framing, which no repo document supports. Topology
re-read this run: each app's modules run as separate service hosts behind a YARP Gateway pinned to
`https://localhost:6001`, with gRPC via `*.Contracts` and the outbox to a broker
(`MMCA.ADC/AGENTS.md:7`, `MMCA.Store/AGENTS.md:7`); RS256 plus JWKS discovery with no shared secret
(`MMCA.ADC/AGENTS.md:58`, `MMCA.Store/AGENTS.md:59`); deploy to Azure Container Apps on a push to
`main` (`MMCA.ADC/AGENTS.md:83`); one Dockerfile per deployable across the four services plus the
Gateway and UI.Web (`:68`); each service owning its own database and its own `dbo.OutboxMessages`
(`:62`, databases named at `:26`; Store's at `MMCA.Store/AGENTS.md:26`). Packages and versions
verified this run: the framework publishes twenty-two packages (`MMCA.Common/FACTS.md:19`, enumerated
at `:22-43`) at v1.233.0 (`:14`, snapshot dated 2026-10-07 at `:4`), and the changelog's newest
released entry is `## [1.233.0] - 2026-10-07` (`MMCA.Common/CHANGELOG.md:13`, below `## [Unreleased]`
at `:7`, with 1.232.1 at `:29` and 1.232.0 at `:38`). The consumers pin subsets, each in lockstep: ADC
carries nineteen `MMCA.Common.*` entries, all at 1.233.0 (`MMCA.ADC/Directory.Packages.props:99-131`,
`.Grpc` at `:99`, `.AI` at `:107`, `.AI.Anthropic` at `:110`, `.AI.Testing` at `:113`, `.Gateway` at
`:121`, `.UI.Maui` at `:131`; it does not pin `.AI.OpenAI`, `.Testing.Aspire` or the `MMCA.Common`
package), and Store carries sixteen, also all at 1.233.0 and with no `.AI` entry
(`MMCA.Store/Directory.Packages.props:8-22`, `.Grpc` at `:72`, `.Aspire.Hosting` at `:107`), including `MMCA.Common.UI.Maui` in both. Corrected this run: the package count (`.AI.Anthropic`,
`.AI.OpenAI`, `.AI.Testing` are new) and ADC's entry count, both of which trailed the current release. Decorator order is FeatureGate then Authorization then Logging then Caching then Validating
then Timeout then Transactional then the handler for commands, and the same minus Transactional for
queries (`MMCA.Common/AGENTS.md:81-82`), read off the Scrutor `TryDecorate` registration order
(innermost first) at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:134-140`
for commands and `:143-148` for queries, where `ValidatingQueryDecorator` sits at `:144` (re-anchored
this run from `:137-143`, `:146-151`, `:147`, and from the retired `MMCA.Common/CLAUDE.md:80`). Counted
this run rather than quoted: the Conference module's
`Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/` tree holds twenty-two domain REST
controllers in feature subfolders (Activities, CategoryItems, ConferenceCategories, EventLifecycle,
EventQuestionAnswers, Events, EventSpeakers, Partners, Questions, Rooms, SessionAssets, SessionCalendar,
SessionCategoryItems, SessionQuestionAnswers, SessionSelection, SessionSpeakers, Sessions,
SpeakerCategoryItems, SpeakerLinks, Speakers, SpeakerSessions, Sponsors) plus the root
`ServiceInfoController`; the four added since the last count are EventLifecycle
(`Controllers/Events/EventLifecycleController.cs`), SessionCalendar, SpeakerLinks and SpeakerSessions.
`MMCA.ADC/AGENTS.md:50` still states seventeen and owns the domain list, so the article states the
counted figure and that doc line is behind. Corrected this run: the bookmark-count sentence no longer
credits a disabled-module stub for the extracted topology. Service hosts load only their own module and
register no disabled-dependency stub (`MMCA.ADC/AGENTS.md:43`); Conference calls Engagement's
`IBookmarkCountService` via gRPC (`:50`) through adapters implementing the same in-process interfaces
(`:56`), registered by `AddEngagementBookmarkCountClient`, which replaces whatever is registered with
`BookmarkCountServiceGrpcAdapter`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:49`).
`DisabledBookmarkCountService`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/EngagementModule.cs:32`) covers only a
host where the Engagement module is disabled. Store module contents re-read this run: Catalog owns
`Category`, `Product`, `ProductVariant` with an owned `VariantDiscount` resolved by
`GetEffectivePrice(now)`, plus the `Reviews` aggregate (`ProductReview`, `VerifiedPurchase`) with a
derived `RatingSummary` owned by `Product` (`MMCA.Store/AGENTS.md:49`); Sales owns `Order` (plus
`OrderLine` and an owned `Shipment`), `ShoppingCart` and `InventoryItem` with Stripe payments (`:50`);
Identity owns `User`, `Customer` and JWT auth with refresh tokens (`:51`); the Sales cluster keeps
YARP's HTTP/1.1-capable defaults for REST plus the Stripe webhook (`:44`). Catalog's
`ProductVariantChanged` publishes after commit so the database-generated ID is known (`:56`), the
in-process domain-event divergence from ADC is recorded at `:58`, compensating saga handlers restore
inventory (`:102`), and Store configures `OwnerOrAdminFilter` (`:103`). ADC's Identity offers
Google, GitHub and Sign in with Apple social login (`MMCA.ADC/AGENTS.md:49`); Engagement owns bookmarks, feedback and the
conference-day live layer (`:51`); Notification is the thin SignalR module (`:52`); ADC configures
`OwnerOrAdminFilter` on the Bookmarks list endpoints in `AddModuleEngagementAPI` (`:66`); and the
BR-207 `UserRegistered` flow and its deliberate divergence from Store are at `:57`. Shared fitness
rules: rule bodies live once in `MMCA.Common.Testing.Architecture`, parameterized by `IArchitectureMap`,
and Store and ADC subclass the same bases (`MMCA.Common/AGENTS.md:70`); Application, Domain and Shared
never reference MassTransit, and `IMessageBus` is served by `InProcessMessageBus` or `BrokerMessageBus`
(`:129`; `MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:28`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessMessageBus.cs:19`,
`BrokerMessageBus.cs:43`); the MassTransit v8 pin is guarded by `DependencyVersionTests`
(`MMCA.Common/AGENTS.md:40`). `Website/docs-src/guides/common-VERSIONING.md` states that the packages
are versioned and released together as a single unit with the authoritative list and count in FACTS.md
(`:5-7`), MinVer from annotated git tags (`:25`), no opt-in flags or phased rollouts (`:67`), and the
MassTransit v8 pin (`:87`). Scorecard numbers re-read this run: the framework's two-axis index is
Maturity 96.6% (317/328) and Implementation 86.0% (705/820)
(`Website/docs-src/governance/common-ArchitectureScorecard.md:9-10`), evidence as of 2026-10-07 at
v1.233.0, git HEAD `55e427b3`, clean tree (`:5`), 34 rows with nothing excluded from the denominators
and a weight sum of 82 (`:104`). The downstream-evidence caveat is written into the rows themselves: category 4
DDD holds at 8 on two open criteria, strategic DDD realized downstream with one Domain aggregate family
(Notifications) plus auth support types, and a plain-string tenant identifier (`:68`); category 5 VSA holds at
8 because Common has no business use-case slices of its own, so slice cohesion is proven in the
consumer repos, with generic-parameter handler bases exempt by design (`:69`). Corrected this run: the
article's two quoted row phrases ("still realized downstream (only Notifications lives here)" and "the
enforced in-repo slicing surface is still the Notifications family") are no longer in the scorecard and
are replaced by the current row text; the shared logging-switchboard clause is removed, because a
Grep over `MMCA.Common/Source` finds no such type (the bases are `partial` classes taking their own
`ILogger`, for example `ChangePasswordHandlerBase.cs:42`). The `Users` family is thirteen
`*HandlerBase.cs` files across nine folders under
`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/`; only
`GetPreferences/GetUserPreferencesHandlerBase.cs:21-22` declares a concrete contract, and the slice
rules document abstract-base scanning at
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.Slices.cs:27-32`,
with the two rules at `:35` and `:65` scanning every Application class at `:39` and `:69`. Performance
and cost are not "no in-repo evidence": category 12 ships a repeatable BenchmarkDotNet hot-path harness as a required merge gate plus a load
tier (`Tests/Performance/MMCA.Common.LoadTests`: 10k outbox messages, 100k-row paged queries, 50
concurrent reads) run weekly on SQLite and not as a required check, held at 8 because a library carries
no capacity-provisioning evidence (`:76`), and category 31 cites a released cost guide (`:95`, the doc
itself is `Website/docs-src/guides/common-COST.md`). The two consumer scorecards sit on the same
instrument: ADC scores Maturity 96.9% (314/324) and Implementation 86.0% (697/810), evidence as of
2026-10-07 at pin v1.233.0, git HEAD `665b2d3c`, clean tree
(`Website/docs-src/governance/adc-ArchitectureScorecard.md:9-10`, header `:5`), and Store scores
Maturity 97.5% (308/316) and Implementation 83.2% (657/790), evidence as of 2026-10-07 at pin v1.233.0,
git HEAD `d50926ed`, clean tree (`Website/docs-src/governance/store-ArchitectureScorecard.md:9-10`,
header `:5`).
Corrected this run: the previous Common, ADC and Store index figures are retired in favor of these.
Apache-2.0 at `MMCA.Common/LICENSE:2`. That two-axis scorecard is canonical in the Website docs library
since the 2026-07-20 centralization (it is no longer carried in MMCA.Common), and it replaced an
earlier single-axis 80% snapshot that survives only in git history and is therefore not checkable from
the working tree: the original-snapshot-then-fixed-then-re-scored framing stands, the 80% figure is a
history assertion.*

- Full series index: https://ivanball.github.io/writing.html
