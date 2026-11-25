# Two real apps on one framework: a conference platform and a store

> Series: MMCA.Common · Article #41 (case study) · Pillar P6 · Rubric: §4, §5, §7, §10, §32 · ADR-016 · ADR-118 · ADR-141 ·
> Status: grounded in `MMCA.ADC/README.md`, `MMCA.ADC/AGENTS.md`, `MMCA.Store/README.md`,
> `MMCA.Store/AGENTS.md`, `MMCA.Common/FACTS.md`, `MMCA.Common/build/Frameworks.props`, both consumers' `Directory.Packages.props` and `Directory.Build.props`, `Website/docs-src/adr/141-two-framework-lines-from-one-tree.md`, and `Website/docs-src/governance/common-ArchitectureScorecard.md` (the §4/§5 downstream-evidence rows).
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
  activities, partners and session assets, across twenty-three domain REST controllers),
- **Engagement** (session bookmarks, the event and session feedback screens, check-ins, attendee
  badges and leaderboard points, and the conference-day live layer: the `LivePolls` and
  `SessionQuestions` aggregates behind Happening Now, the session Live view, and the presenter UI),
- **Notification** (a thin SignalR module hosting the real-time notification hub).

It is deployed to Azure Container Apps, one container image per deployable (the four services, the
Gateway, and the web UI), and a merge to `main` is the deploy: the required test checks (build,
integration and coverage) gate the pull request against the exact tree that merges, and the merge push runs the
chromium end-to-end tier when the diff touches the UI, refuses to deploy when a scheduled tier such as
the cross-service or load run has no recent success, then builds the images and rolls the release out. That is a harder claim than "it builds": the framework is carrying a six-image
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
defined in `*.Contracts` projects) and asynchronously over a broker using the outbox pattern. User
tokens are signed with RS256 and validated through JWKS discovery, with no shared secret. Each app
makes one deliberate exception for service-to-service gRPC: a few internal edges (Identity's Customers
edge in Store; Identity's VerifiedUserLookup and Notification's LiveChannelPush edges in ADC) require
an internal or service-only caller, so the calling service attaches an HS256 service token on the
calls that have no user token to forward.

None of that topology is hand-rolled per app. It comes from the framework:

- **The same packages, at the same number.** MMCA.Common publishes thirty packages, and each app pins
  the subset it uses at one identical version literal: ADC pins twenty-six `MMCA.Common.*` entries
  (`.Shared`, `.Domain`, `.Application`, `.Infrastructure`, `.AI`, `.AI.Anthropic`, `.AI.Testing`,
  `.API`, `.Grpc`, `.Gateway`, `.Passkeys`, `.ServiceHost`, `.Mcp`, `.UI`, `.UI.Maui`, `.UI.Web`,
  `.Aspire`, `.Aspire.Hosting`, `.Azure`, `.Azure.Startup`, `.Testing`, `.Testing.Architecture`,
  `.Testing.Aspire`, `.Testing.Azure`, `.Testing.E2E`, `.Testing.UI`), Store pins twenty of those,
  taking none of the `.AI` packages and none of `.Passkeys`, `.Mcp` or `.Testing.Aspire`.
- **The same patterns.** `Result<T>` for error flow, the CQRS command/query split with the same
  decorator order (commands run ViewAs then FeatureGate then Authorization then Logging then Caching
  then Validating then Timeout then Transactional then the handler; queries run FeatureGate then
  Authorization then Logging then Caching then Validating then Timeout then the handler), the
  `AuditableAggregateRootEntity` base with `AddDomainEvent()`, the transactional outbox captured in
  `SaveChangesAsync()`, and database-per-service routing by logical data source name. Both apps run one
  SQL database per service (`ADC_Identity`, `ADC_Conference`, and so on for ADC; `Store_Catalog`,
  `Store_Sales`, `Store_Identity` for Store), each with its own `OutboxMessages` table so no service
  races another for outbox rows.
- **The same fitness rules, applied to their own code.** This is the part most "reference architecture"
  repos skip. The architecture tests are not copy-pasted into each app. The rule bodies live once in the
  `MMCA.Common.Testing.Architecture` package as a rule library plus abstract test bases parameterized by
  an `IArchitectureMap`. Each app supplies **its own map** (one entry per layer assembly, tagged with
its module and layer) and subclasses
  the same bases, so the layer, purity, and extraction rules are literally identical across MMCA.Common,
  MMCA.ADC, and MMCA.Store. The transport-leakage rule that forbids Domain, Application and Shared from
  referencing a broker client applies to all three the same way.

The shared abstractions are exactly the swap points the framework promises. The same `IMessageBus`-backed
event that fires in-process in a monolith fires over a broker once the module is its own service, and
the consuming app does not change its handler code to make that switch.

## How a framework change ships

The interesting operational property is not that the apps share code. It is **how a change to the shared
code reaches them.** There is no phased rollout, no opt-in flag, no per-consumer compatibility shim.

The release is a lockstep sweep:

1. Tag a new MMCA.Common version (the release version is the git tag itself; every other build
   carries a `0.0.0-dev` placeholder). All thirty packages publish at that same version.
2. In each consumer, bump every `MMCA.Common.*` entry in `Directory.Packages.props` to the new version
   in one pass. ADC keeps its twenty-six entries and Store its twenty on the same number.
3. Build, run the fitness tests and the rest of the suite, deploy.

The framework's versioning policy doc (`common-VERSIONING.md`, canonical in the published docs
library rather than in the framework repo) states the policy
plainly: the packages are versioned and released together as a single unit (the authoritative list and
count live in `FACTS.md`), a release takes its version from its git
tag, and consumers are swept in one pass with no phased rollout. That is
a real constraint, and it is the trade the framework makes on purpose: every consumer stays on one
coherent version of the contract, so there is never a matrix of "ADC is on 1.74 but Store is on 1.71 of
three of the packages." The cost is that a breaking change has to be absorbed everywhere at once, which
is why breaking changes go through a new event type plus an upcaster rather than a silent reshape (the
event-schema-versioning ADR), and why the messaging-library policy (no MassTransit: the broker
transports are framework code over the vendor SDKs) is guarded by a fitness test in the framework
rather than a comment, failing the build on any `MassTransit*` package pin in any repo that runs it.

## Two framework lines, one release

The lockstep sweep has a second dimension: the two apps do not run on the same .NET version. ADC
builds and deploys `net11.0` by default, while Store stays on `net10.0`. The framework does not answer
that with a release branch per framework. It builds two framework lines from one source tree
(ADR-141):

- **Libraries multi-target; applications switch.** Every packaged MMCA.Common library builds for both
  `net10.0` and `net11.0`, named once as `MmcaNetVersions` in `MMCA.Common/build/Frameworks.props`, so
  one package version carries an asset for each framework. An application does not multi-target: one
  `MmcaNet` property in its `Directory.Build.props` picks exactly one line. ADC defaults to `net11.0`
  and keeps `net10.0` as a permanent second line (`-p:MmcaNet=net10.0`), gated by a required
  `build-and-test-net10` check that runs the same suites on the older framework. Store defaults to
  `net10.0` and builds no second line in CI, and MMCA.Helpdesk, a third consumer, targets `net10.0` too.
- **Version-specific code is forward-only.** It is written only as `#if NET11_0_OR_GREATER`, with the
  existing code as the `#else` branch, never as `#if NET10_0`. Retiring a framework is removing it from
  the list and deleting the `#else` branches.
- **The public API is identical on both lines.** Every packable project except the MAUI package
  carries one `PublicAPI.Shipped.txt`, and the analyzer checks it once per target framework, so a member
  present on one framework only fails the build on the other.

That is what lets two apps on two .NET versions stay on one package version: ADC and Store bump the
same `MMCA.Common.*` literal in the same sweep, and each restores the asset for its own framework. The
cost lands in the framework and in ADC: Common's test run roughly doubles, and ADC carries a second set
of lock files for its second line.

## What each app proves that the framework cannot

A framework can demonstrate a pattern. It cannot, by itself, demonstrate that the pattern survives a
real domain and a real deployment. That is the division of labor between MMCA.Common and its consumers.

**ADC proves real bounded contexts and real eventing.** Identity publishing `UserRegistered` so
Conference can auto-link a speaker by a verified email match is a genuine cross-context workflow, not a contrived
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
consumer repos": the framework ships a second sliced family (the `Users` use cases, fifteen abstract
handler bases across ten folders) and the slice gate does reach abstract bases, but fourteen of the
fifteen declare their handler contract over a generic parameter and are exempt by design, so the
family deepens the pattern without widening the enforced surface.
**For both, the real surface lives in MMCA.Store and MMCA.ADC.** For performance and
cost, the framework ships an in-repo BenchmarkDotNet hot-path harness plus a weekly load tier on SQLite
(§12) and a released cost guide (§31); what a library cannot carry is capacity-provisioning evidence,
which only a deployed app can supply.

That is not a weakness to hide; it is the reason the two apps exist. The framework supplies the base
classes, the enforced layering, and the extraction points. The apps supply the proof that those things
hold up against two different real domains and two different production deployments. The
framework's two-axis evaluation scores it at roughly 97% maturity and 85% implementation (97.3% and 85.1%
exactly), with implementation
the weaker axis precisely because some of the most important "does this actually model a domain well"
evidence lives downstream, in the consumers, where it should.

## What we covered / Next

**What we covered:** two unrelated applications, a conference platform and an e-commerce store, both
running on the same MMCA.Common packages at the same lockstep version and the same architecture stage;
what they share (the packages, the same fitness rules via their own architecture maps, the same
Result/CQRS/outbox/
database-per-service patterns); how a framework change ships as a lockstep sweep with no phased rollout;
how two framework lines from one tree let the apps sit on different .NET versions at one package version;
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

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`, snapshot dated
2026-11-25 at `:4`); prior passes 2026-10-29, 2026-10-22, 2026-10-08 and 2026-10-02. 2026-11-25 entry,
changed claims: the framework publishes 30 packages (`MMCA.Common/FACTS.md:20`, the metapackage
thirtieth at `:52`); ADC pins twenty-six `MMCA.Common.*` entries, all at 1.319.0
(`MMCA.ADC/Directory.Packages.props:143-198`, `.Passkeys` `:163`, `.ServiceHost` `:166`, `.Mcp` `:170`,
`.Azure.Startup` `:179`, `.Testing.Aspire` `:191`), and Store pins twenty, all at 1.319.0 and every one
in ADC's list (`MMCA.Store/Directory.Packages.props:28-53`, `.Azure.Startup` `:41`, `.ServiceHost`
`:44`, `.Grpc` `:94`, `.Aspire.Hosting` `:129`), with no `.AI`, `.Passkeys`, `.Mcp` or `.Testing.Aspire`
entry (counted this run); the Conference module's
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/` tree holds 26 controller
classes, 23 of them domain controllers (the one added since the last count is
`Controllers/Events/RoomCheckInCodesController.cs`) plus `ServiceInfoController`,
`FeatureFlags/AdminFeatureFlagsController` and `AuditHistory/AuditHistoryController` (Glob this run);
the command pipeline gains `ViewAsCommandDecorator` as its outermost decorator (ADR-137), registered
last at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:159` after
Transactional `:151` through FeatureGate `:158` (Scrutor `TryDecorate`, innermost first), with the
query order unchanged at `:162-167`; the service-to-service exception is stated for both apps, because
ADC's Identity VerifiedUserLookup edge requires `InternalCaller`, Notification's LiveChannelPush edge
requires `ServiceCaller`, and Engagement attaches the HS256 `Grpc:ServiceToken`
(`MMCA.ADC/AGENTS.md:72`), while Store's Customers edge, with Sales attaching the token, is at
`MMCA.Store/AGENTS.md:63`; the MassTransit pin sentence is replaced by the messaging-library ban,
`DependencyVersionTestsBase.MassTransit_MustNotBeReferenced`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:10-18`,
ADR-118, `MMCA.Common/AGENTS.md:45`); the transport-leakage rule is restated as Domain, Application and
Shared never referencing a broker client (`MMCA.Common/AGENTS.md:151`,
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/MicroserviceExtractionTestsBase.cs:5`,
the client names at `Rules/Layering/ArchitectureRules.Transport.cs:7`, `:17-18`); the `Users` family is
fifteen `*HandlerBase.cs` files across ten folders under
`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/` (the two added since the last count:
`SignInLinks/RedeemSignInLinkHandlerBase.cs:58`, `SignInLinks/SendSignInLinkHandlerBase.cs:44`), and
only `GetPreferences/GetUserPreferencesHandlerBase.cs:19-20` implements a concrete contract
(`IQueryHandler<GetUserPreferencesQuery, Result<UserPreferencesResponse>>`); the framework's
implementation index is 85.1% (698/820), maturity unchanged at 97.3% (319/328)
(`Website/docs-src/governance/common-ArchitectureScorecard.md:10-11`, evidence as of 2026-11-23 at
v1.315.0 at `:5`). Added this run: the "Two framework lines, one release" section, grounded in
`Website/docs-src/adr/141-two-framework-lines-from-one-tree.md` (decisions 1, 2, 3 and 6, and the
trade-offs on test time and ADC's two lock file sets), `MMCA.Common/build/Frameworks.props:11-17` (the
forward-only `#if NET11_0_OR_GREATER` rule and the identical public API) and `:23` (`MmcaNetVersions` =
`net10.0;net11.0`); ADC at `MMCA.ADC/Directory.Build.props:7-8` (net11.0 with net10.0 as the permanent
second line), `:17` (`MmcaDefaultNet` = `net11.0`), `:41-42` (`MmcaNet` feeds `TargetFramework`), `:89`
(the per-line lock file), and the `build-and-test-net10` job at `MMCA.ADC/.github/workflows/deploy.yml:561`;
Store at `MMCA.Store/Directory.Build.props:14` (`MmcaDefaultNet` = `net10.0`) with no second line in CI
(`:7-8`); Helpdesk at `MMCA.Helpdesk/Directory.Build.props:9`. Re-checked this run and unchanged: the
query decorator order; the release version is the git tag and every other build carries `0.0.0-dev`
(`MMCA.Common/Directory.Build.props:90`, `Website/docs-src/guides/common-VERSIONING.md:27`); the category 4 row
text "realized downstream, since the Domain layer holds one aggregate family (Notifications) plus auth
support types" (`Website/docs-src/governance/common-ArchitectureScorecard.md:69`) and the category 5 row text
"is an SDK with no business use-case slices of its own", "slice cohesion is proven in the consumer
repos" (`:70`); categories 12 and 31 at `:77` and `:96`. Source disagreement recorded, not resolved: the audit reports
that `MMCA.ADC/AGENTS.md:64` counts 25 Conference controllers including `ServiceInfoController`, while
disk holds 26; `Website/docs-src/guides/common-VERSIONING.md:103` still describes a MassTransit v8 pin.
Carried from the 2026-10-29 and earlier passes, not re-read line by line this run (the audit confirmed
27 body claims against disk): module contents and Store's aggregates, the topology (Gateway on
`https://localhost:6001`, gRPC via `*.Contracts`, outbox to a broker), the deploy gates, the two
eventing flows and the Store-side divergence note, the `OwnerOrAdminFilter` placements, the speaker
auto-link `EmailVerified` check
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:14-18`),
`IArchitectureMap` keyed by `LayerRef(Module, Layer, Assembly, RootNamespace)`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/IArchitectureMap.cs:31`),
`BookmarkCountServiceGrpcAdapter` registered by `AddEngagementBookmarkCountClient`
(`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:49`), and Apache-2.0 at
`MMCA.Common/LICENSE:2`. Removed in an earlier pass and still out: the "real attendees used it" framing,
which no repo document supports. The scorecard's original-snapshot-then-re-scored framing stands; the
earlier single-axis 80% figure survives only in git history and is a history assertion.*

- Full series index: https://ivanball.github.io/writing.html
