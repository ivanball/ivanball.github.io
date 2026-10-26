# ADR-016: Lockstep Package Versioning and the MassTransit-v8 Pin

## Status
Accepted (2026-07-15). Amended (2026-07-28): the fitness function then gated two commercial-license
majors (MassTransit and SixLabors.ImageSharp; the ImageSharp gate was removed in v1.258.0), so the
decision is restated as the pattern rather than the single pin; the consumer framing is corrected (Store and ADC each declare a
`MassTransit.Azure.ServiceBus.Core` entry of their own for the Service Bus emulator test tier), as is
the claim that framework-to-app (`[C->A]`) changes are non-breaking. Amended (2026-08-01): Store now
has its own `.github/dependabot.yml` (added 2026-07-29) mirroring ADC's, so the trade-off that rested
on Store having no such file is restated, and the ADC `MassTransit.Azure.ServiceBus.Core` citation is
rebased onto its current lines. Amended (2026-08-14): every `Directory.Packages.props` citation is
rebased onto its current lines, and the versions are restated per repo (Common is on MassTransit
8.5.10 and was then on `SixLabors.ImageSharp` 3.1.12, removed in v1.258.0; Store and ADC still declare
`MassTransit.Azure.ServiceBus.Core` 8.5.5). Amended (2026-08-28): a **Transport exit options**
section records the three candidates for an eventual move off MassTransit v8 and the one place a
candidate would be tried. Nothing about the pin, the gate or the dependency set changes. See also
[ADR-101](101-common-metapackage.md) (2026-08-29, v1.170.0): the `MMCA.Common` metapackage releases at
the same version off the same tag like every other package, so it is one more entry a consumer sweeps
in the same pass, and pinning six dependencies at its own version is only safe because of the lockstep
rule decided here. Amended (2026-08-31): Store's and ADC's own `MassTransit.Azure.ServiceBus.Core`
entries are 8.5.10, the same patch as Common's three MassTransit entries, which supersedes the 8.5.5
figure in the 2026-08-14 entry and retires the note that the app-side entry trailed within v8; the
`Directory.Packages.props`, `DependencyInjection.cs` and `MessageBusSettings.cs` citations are
rebased onto their current lines. The pin, the gate and the dependency set are unchanged.
Amended (2026-09-01): the emulator proving ground named in **Transport exit options** is authoritative
and deploy-gating in both consumers (ADC on 2026-08-31 as TD-17, Store immediately after), so the
"advisory by design so it can never gate a deploy" clause is restated; its fixture now ships as
`ServiceBusEmulatorFixtureBase` in `MMCA.Common.Testing` (v1.178.0), which is why the tier's
MassTransit v8 constraint is enforced in framework code rather than in two copies. The
`using MassTransit` surface in **Transport exit options** is recounted from source and restated as
eight files across two packages (the six that reference MassTransit types, plus the two that lower
the emulator's entity-quota defaults), and the `MessageBusSettings.cs`, `IntegrationEventConsumer.cs`,
`UpcastingIntegrationEventConsumer.cs` and Service-Bus-side `DependencyInjection.cs` citations are
rebased onto their current lines. The pin, the gate and the dependency set are unchanged.
Amended (2026-09-19): the `using MassTransit` surface in **Transport exit options** is recounted from
source and restated as nine files across two packages, eight of them in `MMCA.Common.Infrastructure`
(the added file is `Messaging/Consumers/ConsumerOriginRestore.cs`, which takes the consume context's
`Headers`), which supersedes the eight-file figure in the 2026-09-01 entry; the split between
type-referencing and quota-lowering files is corrected, because the emulator pair references
`IServiceBusBusFactoryConfigurator` and `IBusControl` in addition to setting the statics, so every
file in the set references a MassTransit type. The pin, the gate and the dependency set are
unchanged, and the three candidates are unchanged.
Revised 2026-10-01: the current-state text and citations are refreshed against source, with the
shared MassTransit patch at 8.5.11 in all three repos; the pin, the gate and the dependency set are
unchanged.
Revised 2026-10-06: the ordered replacement list in **Transport exit options** is ceded to ADR-118,
which accepted Wolverine first and a raw-SDK adapter second and rejects a commercial v9, so the three
2026-08-28 candidates remain only as the record of the first sketch.
Revised 2026-10-07: the emulator proving ground is restated as a five-day recency gate (a red
nightly blocks a deploy only once the last run green on both broker jobs is stale), and the Store
props and both `cross-service-tests.yml` anchors are rebased.
Revised 2026-10-21: MMCA.Common #576 tightened the dependabot half of the ImageSharp pin from a
semver-major ignore to a `>= 3.2.0` version range (of the two gated packages, only MassTransit keeps
a semver-major ignore), and the record now discloses that source disagrees on whether ImageSharp
3.2.0+ already needs a commercial key (the new dependabot comment) or only v4 does (the fitness
function and the `Directory.Packages.props` comment); anchors are rebased. That ImageSharp pin,
its gate and its dependabot range were all removed in v1.258.0 (see the 2026-10-25 revision).
Revised 2026-10-25: SixLabors.ImageSharp has left the framework (replaced by SkiaSharp in v1.258.0,
and image processing itself left the framework in v1.259.0), so the ImageSharp gate, its package-id
list and its dependabot ignore are gone and MassTransit below major 9 is the only license-boundary
pin; the ceiling now reads all five MassTransit packages Common pins, on the shared 8.5.12 patch,
and the anchors are rebased.

## Context
MMCA.Common publishes its `MMCA.Common.*` NuGet package set (see `FACTS.md` for the authoritative
list and count) consumed by three downstream repos: the two
production apps (Store, ADC) and the reference seed Helpdesk (which defaults to local-source mode but
declares the same `MMCA.Common.*` package versions in its own `Directory.Packages.props`).
Two related governance questions had no recorded answer:

1. **How do the packages version and roll out?** Independent per-package versions invite a
   combinatorial compatibility matrix ("which `.Domain` works with which `.Infrastructure`?"), and a
   phased / opt-in rollout across consumers invites long-lived version skew between the apps and the
   framework.
2. **Can dependencies float?** A routine "update all NuGet packages" sweep repeatedly pulled
   `MassTransit` to v9, which requires a commercial license (`MT_LICENSE`) and crashes every
   broker-enabled service at startup.

## Decision
1. **Version the whole `MMCA.Common.*` package set in lockstep.** All packages share one version (MinVer, derived from
   a single `vX.Y.Z` git tag); a release tags every package (see `FACTS.md` for the authoritative list and count)
   at the same version. SemVer and the
   breaking-change policy live in `common-VERSIONING.md` in `docs-src/guides/`.
2. **Sweep every consumer in one pass, with no phased rollout.** A framework change ships and all
   consumers bump every `MMCA.Common.*` entry in their `Directory.Packages.props` together.
   The two production apps (Store, ADC) now **commit NuGet lock files** (`RestorePackagesWithLockFile`,
   R7/TD-01), so each one's sweep is a version bump **plus a restore that regenerates its lock files**
   (the same `audit=all` / `--force-evaluate` mechanics Common already uses); Helpdesk, which defaults
   to local-source mode, keeps no lock files. What makes the one-pass sweep safe is not that
   framework-to-app (`[C->A]`) changes are non-breaking: breaking changes ship deliberately, as
   MINOR bumps, and the version number is therefore not a breakage signal on its own
   (`Website/docs-src/guides/common-VERSIONING.md:44-50`). It is safe because every first-party
   caller moves in the same change set, an API removal is proven against Helpdesk's source build
   first (`common-VERSIONING.md:69-70`), and there is no `[Obsolete]` grace period to keep in step
   (`common-VERSIONING.md:72-78`).
3. **Pin a commercial-license dependency below its paid major, enforced by a fitness function.**
   `DependencyVersionTestsBase` parses `Directory.Packages.props` and fails the build when a pinned
   package reaches the major where its licensing changes (ADR-015), and the same major is mirrored
   as a dependabot ignore so the bump is never even proposed. MassTransit is the instance that
   applies today, and the only one: every MassTransit package Common pins stays below major 9 (v9
   demands `MT_LICENSE` at startup, so every broker-enabled host crashes without one). The gate
   reads five package ids, `MassTransit`, `MassTransit.RabbitMQ`,
   `MassTransit.Azure.ServiceBus.Core`, `MassTransit.AmazonSQS` and
   `MassTransit.SqlTransport.PostgreSQL`, against an exclusive ceiling of 9
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:16-41`,
   the list at `:18-25`, the test at `:27-40`, the ceiling at `:34`). All five are pinned on 8.5.12
   under the v8 comment (`MMCA.Common/Directory.Packages.props:119-124`, the entries at `:125-127`,
   `:130` and `:136`), and dependabot ignores every `MassTransit*` semver-major update
   (`MMCA.Common/.github/dependabot.yml:57-60`). SixLabors.ImageSharp was a second instance (gated
   below major 4) until v1.258.0, which removed the package, its fitness test, its package-id list
   and its dependabot ignore (`MMCA.Common/CHANGELOG.md:23`); see the 2026-10-25 revision.

   The assertions run in MMCA.Common only, the one repo that subclasses the base
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DependencyVersionTests.cs:9`).
   Helpdesk declares no MassTransit package. Store and ADC take `MassTransit`,
   `MassTransit.RabbitMQ` and `MassTransit.SqlTransport.PostgreSQL` transitively through
   `MMCA.Common.Infrastructure`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/MMCA.Common.Infrastructure.csproj:48-49`,
   `:53`), and `MassTransit.Azure.ServiceBus.Core` through `MMCA.Common.Azure` and
   `MMCA.Common.Testing.Azure` (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/MMCA.Common.Azure.csproj:28`,
   `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Azure/MMCA.Common.Testing.Azure.csproj:21`),
   which both declare (`MMCA.ADC/Directory.Packages.props:128-129`,
   `MMCA.Store/Directory.Packages.props:17-18`). Each **also** declares one MassTransit entry of its
   own: `MassTransit.Azure.ServiceBus.Core` 8.5.12 for the Service Bus emulator test tier, carrying
   a comment that names Common's lockstep v8 pin (`MMCA.ADC/Directory.Packages.props:68-73`,
   `MMCA.Store/Directory.Packages.props:92-97`). Common's own MassTransit entries are on that same
   8.5.12 (`MMCA.Common/Directory.Packages.props:125-127`), so all three repos sit on one patch
   version. Alignment there is a convention the app-side comments carry, not something the gate
   enforces: Store's comment names the lockstep pin without a patch number
   (`MMCA.Store/Directory.Packages.props:93-94`), so it holds across patch bumps, while ADC's still
   names 8.5.11 above an 8.5.12 entry (`MMCA.ADC/Directory.Packages.props:69`, `:73`).
   What the pin governs, and what the fitness function reads, is the major, so an app-side entry on
   a different v8 patch would still be inside the decision.
   They still do not subclass the test: its default list also names the four package ids they do
   not declare, and the rule fails on a pin it cannot find
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.Governance.cs:42-45`).

## Rationale
- **One version, one compatibility story.** Lockstep removes the N-package matrix: "everything on
  `vX.Y.Z`" is the only supported combination, which is the right trade for a small team.
- **No skew.** Sweeping all consumers at once keeps the framework and both apps converged rather than
  drifting across releases.
- **A license pin is a build gate, not a comment.** A blanket "update all packages" sweep does not
  read license terms. It pulled MassTransit to v9 once already, and because CI never starts a broker
  the build stayed green while every host was primed to crash at startup. What stops it is the pair:
  the dependabot ignore keeps the proposal from being raised, and the fitness function catches it
  when a hand edit raises it to the gated major anyway (which is exactly the invariant-over-discipline
  posture of ADR-015). The gate reads majors only, so a license line drawn inside a major would
  need more than this pair.

## Trade-offs
- A consumer cannot adopt a single package in isolation: it takes the whole set at the new version.
- Lockstep will bump a package whose code did not change (acceptable: the version means "compatible
  with this set," not "this package changed").
- The pin forgoes the newer major (MassTransit v9) until a licensing decision is made; bumping it
  is a deliberate, multi-step change, not a one-line version edit.
- The gate reads MMCA.Common's `Directory.Packages.props` and nothing else, so the
  `MassTransit.Azure.ServiceBus.Core` entry Store and ADC each declare for their emulator tier sits
  outside its reach. What holds those two at v8 is that neither repo lets dependabot touch NuGet at
  all: each carries a `dependabot.yml` scoped to the github-actions and docker ecosystems only
  (`MMCA.ADC/.github/dependabot.yml:7`, `:28`, `MMCA.Store/.github/dependabot.yml:15`, `:32`), whose
  own comment says NuGet is deliberately excluded because `MMCA.Common.*` bumps happen solely through
  this ADR's lockstep sweep and MassTransit must stay v8 (`MMCA.ADC/.github/dependabot.yml:1-4`,
  `MMCA.Store/.github/dependabot.yml:6-8`, the latter added 2026-07-29), plus review.

## Transport exit options
The ordered list of what replaces MassTransit is owned by
[ADR-118](118-message-transport-library-policy.md) (Accepted 2026-09-11), which is the later decision
and supersedes the candidate list below wherever the two differ: its decision 4 fixes the replacement
order as Wolverine first and a raw-SDK adapter second, and its decision 5 rejects a commercial
MassTransit v9 outright. This section keeps the surface inventory, the trial point and the proving
ground, which ADR-118 relies on, and records the 2026-08-28 candidates as they were first sketched.

The pin has a horizon. MassTransit v8 is the free major and its community support ends at the end of
2026 (a maintainer statement about the package, not something this repository can assert), so
"stay on v8" is a decision with an expiry rather than a permanent one. Nothing changes today; the
candidates are recorded now so the eventual move is a comparison and not a scramble.

What makes any of them a bounded change is where MassTransit actually sits. The whole
`using MassTransit` surface is **nine files across two packages**. Eight are in
`MMCA.Common.Infrastructure`: `Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:2`,
`Messaging/BrokerMessageBus.cs:2`, `Messaging/Consumers/IntegrationEventConsumer.cs:1`,
`Messaging/Consumers/IntegrationEventConsumerExtensions.cs:2`,
`Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:3`,
`Messaging/Consumers/FaultIntegrationEventConsumer.cs:1`,
`Messaging/Consumers/ConsumerOriginRestore.cs:2` and `Messaging/ServiceBusEmulatorSupport.cs:4`;
the ninth is `Source/Hosting/MMCA.Common.Testing/Fixtures/ServiceBusEmulatorFixtureBase.cs:5`. The
last two are the emulator test tier rather than the transport: each one lowers the process-global
`MassTransit.AzureServiceBusTransport.Defaults` entity quotas the emulator rejects
(`ServiceBusEmulatorSupport.cs:115-117`, `ServiceBusEmulatorFixtureBase.cs:74-76`), a v8 constraint
that moves with that tier, not with the bus. Every one of the nine references a MassTransit **type**,
so none of them is an unused import: `IConsumer<T>`, `ConsumeContext<T>`, `IPublishEndpoint` and
`IBusRegistrationConfigurator` across the seven transport-side files, plus `Fault<T>`
(`FaultIntegrationEventConsumer.cs:27`) and an explicit implementation of
`IEndpointRegistrationConfigurator` (`IntegrationEventConsumerExtensions.cs:189`), where
`ConsumerOriginRestore` takes the consume context's `Headers`
(`Messaging/Consumers/ConsumerOriginRestore.cs:35`); the emulator pair adds
`IServiceBusBusFactoryConfigurator` (`ServiceBusEmulatorSupport.cs:87`) and `IBusControl`
(`ServiceBusEmulatorFixtureBase.cs:68`) on top of the quota statics.
Application, Domain and Shared never reference it:
`IMessageBus` is the Application-layer abstraction
(`MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:28`) and
`BrokerMessageBus` is its only broker implementation (`BrokerMessageBus.cs:43`), which is the
boundary ADR-008's `MicroserviceExtractionTests` already keep enforced.

Three candidates as first sketched, **none implemented and none evaluated against a running broker
here** (ADR-118 decision 5 has since rejected candidate 2, and its decision 4 ranks a raw-SDK
adapter, the shape of candidate 3, second behind Wolverine):

1. **The OpenTransit community fork of MassTransit v8.** Cheapest on paper, a package id swap under
   the same API. No repo in this workspace references it, and the part that would decide it is Azure
   Service Bus parity, since production runs Service Bus while local runs RabbitMQ
   (`DependencyInjection.Messaging.cs:271`, `:302`). Its release status and its parity are external facts this
   record cannot verify and does not assert.
2. **A commercial MassTransit v9 license.** The straight-line option: the pin exists only because v9
   demands `MT_LICENSE` at startup and every broker-enabled host crashes without it
   (`MMCA.Common/Directory.Packages.props:120-124`). A license retires the gate rather than routing
   around it, at a recurring cost.
3. **A direct `Azure.Messaging.ServiceBus` implementation of `IMessageBus`.** The largest and the
   most owned. Publishing is one class (`BrokerMessageBus.cs:43`), but the consume side is where the
   library earns its keep: three consumers ride `IConsumer<T>` (`IntegrationEventConsumer.cs:42`,
   `UpcastingIntegrationEventConsumer.cs:36`, `FaultIntegrationEventConsumer.cs:27`) and the
   transport wiring supplies exponential in-process retry plus second-level delayed redelivery
   (`DependencyInjection.Messaging.cs:279-296` on RabbitMQ, where the redelivery half is opt-in
   behind `EnableDelayedRedelivery` and off by default, `:322-336` on Service Bus, where it is
   unconditional, the two-level argument at `:245-250`), all of which would be hand-written. It also drops RabbitMQ, which the local
   Aspire stack provisions.

The trial point is the same for all three and it is additive: a new case in the `MessageBusProvider`
switch inside `ConfigureBrokerTransport`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:264`, switch at `:269`,
enum at `Messaging/MessageBusSettings.cs:236`), so a candidate ships **beside** RabbitMQ and Service
Bus instead of replacing either, and a consumer opts in by configuration. The two artifacts that move
with a decision are the pin
(`MMCA.Common/Directory.Packages.props:119-124`, the five entries at `:125-127`, `:130` and `:136`)
and the fitness function that reads it
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:18-25`,
the major ceiling at `:27-40`), plus the dependabot ignore they are paired with
(`MMCA.Common/.github/dependabot.yml:57-60`).

A proving ground already exists: both consumers' nightlies run an Azure Service Bus emulator smoke
against their real integration-event contracts, and the tier is authoritative rather than advisory
(`MMCA.ADC/.github/workflows/cross-service-tests.yml:142`, the gating rationale at `:116-126`,
and the equivalent `servicebus-emulator-smoke` job in
`MMCA.Store/.github/workflows/cross-service-tests.yml:141`, rationale at `:121-135`; the deploy-side
halves are recorded in ADR-066 and ADR-064). The deploy gate is a recency gate, not a per-run one:
`cross-service-freshness` requires the `cross-service` and `servicebus-emulator-smoke` jobs to have
both succeeded in one completed run of `cross-service-tests.yml` (whatever triggered it, so a
dispatched green run counts too) within `window-days: '5'`
(`MMCA.ADC/.github/workflows/deploy.yml:885-906`, window at `:898`, `same-run` at `:903`;
`MMCA.Store/.github/workflows/deploy.yml:827-848`, window at `:840`, `same-run` at `:845`).
The proof's age is floored to whole days and the gate fails only when that age exceeds the window
(`MMCA.Common/.github/actions/freshness-gate/action.yml:25-26`, `:143-145`), so a red nightly blocks
a deploy only once the last run green on both jobs is six or more whole days old.
Any transport candidate has somewhere to be exercised that is not production.

## Alternatives rejected
- **Opt-in flags and compatibility shims for a framework change, with consumers upgraded per page or
  per PR.** Declined outright: no `virtual` opt-in properties, no parallel old and new code paths, no
  sequencing that leaves a consumer half upgraded. The rejection was made concrete against a proposed
  `UseQueryStringState` flag on `DataGridListPageBase`, which would have kept unconverted pages
  working until each was migrated; every consumer page in MMCA.ADC and MMCA.Store was updated in the
  same change instead. What removes the usual reason to phase a sweep is the `local.props`
  source-mapping path, which makes a lockstep cross-repo change practical without a NuGet publish
  round trip. A half-upgraded codebase is the cost this record is spending lockstep releases to
  avoid, so re-introducing one per feature would defeat the decision above.

## Revision (2026-10-01)
No decision, pin, gate or rationale changed: MassTransit stays below major 9 and ImageSharp below
major 4, and every repo still sits on one MassTransit patch. The current-state text is refreshed to
match source. The shared patch is now 8.5.11 in all three repos
(`MMCA.Common/Directory.Packages.props:128-130`, `MMCA.ADC/Directory.Packages.props:65`,
`MMCA.Store/Directory.Packages.props:93`), and Store's emulator-tier comment, which named 8.5.10, now names the pin
without a patch number (`MMCA.Store/Directory.Packages.props:89-90`). `MMCA.Common.Infrastructure` references all three
MassTransit packages, so `MassTransit.Azure.ServiceBus.Core` also flows transitively
(`MMCA.Common.Infrastructure.csproj:50-52`). The Store and ADC `dependabot.yml` files now also
manage the docker ecosystem, still excluding NuGet (`MMCA.ADC/.github/dependabot.yml:28`,
`MMCA.Store/.github/dependabot.yml:32`). The transport wiring lives in
`DependencyInjection.Messaging.cs`, and RabbitMQ second-level redelivery is opt-in behind
`EnableDelayedRedelivery` (default false), while Service Bus applies it unconditionally
(`DependencyInjection.Messaging.cs:246-251`, `:277`). The `Directory.Packages.props`,
`dependabot.yml`, `MMCA.Common.Infrastructure.csproj`, `BrokerMessageBus.cs`, consumer,
`MessageBusSettings.cs`, `cross-service-tests.yml` and `common-VERSIONING.md` citations are
rebased onto their current lines; the nine-file `using MassTransit` count is unchanged.

## Revision (2026-10-06)
- **Transport exit options** and **Related** now cede the ordered replacement list to
  [ADR-118](118-message-transport-library-policy.md) (Accepted 2026-09-11; decision 4 orders
  Wolverine first and a raw-SDK adapter second, decision 5 rejects a commercial v9), replacing the
  claim that the two lists are unreconciled and that neither was adopted. The three 2026-08-28
  candidates stay as the record of the first sketch. The pin, the gate and the dependency set are
  unchanged.
- The MassTransit type list for the transport-side files now also names `Fault<T>`
  (`FaultIntegrationEventConsumer.cs:27`) and the explicit `IEndpointRegistrationConfigurator`
  implementation (`IntegrationEventConsumerExtensions.cs:189`), which matter when sizing a
  hand-written adapter.
- Facts recorded in the 2026-10-01 revision now sit at: the three MassTransit entries
  `MMCA.Common/Directory.Packages.props:124-126`, the `MMCA.Common.Infrastructure.csproj` references
  at `:52-54`, and the redelivery posture in `DependencyInjection.Messaging.cs:252-257`, with the
  RabbitMQ `EnableDelayedRedelivery` gate at `:283`.
- Every live-section anchor (`Directory.Packages.props`, `MMCA.Common.Infrastructure.csproj`,
  `DependencyInjection.Messaging.cs`, `IntegrationEventConsumerExtensions.cs`,
  `ConsumerOriginRestore.cs`) was re-verified against current source and rebased where it had moved.

## Revision (2026-10-07)
Re-verified against current source. The pin, the gate and the dependency set are unchanged:
MassTransit stays below major 9, ImageSharp below major 4, and all three repos sit on MassTransit
8.5.11 (`MMCA.Common/Directory.Packages.props:124-126`, `MMCA.ADC/Directory.Packages.props:65`,
`MMCA.Store/Directory.Packages.props:89`). The gate itself did not change (`window-days: '5'` with
`required-jobs-mode: same-run` was already in place); what changed is this record's description
of it, plus anchors moved by the 2026-10-07 workflow pruning in MMCA.ADC #258 and MMCA.Store #197.

1. **Transport exit options** no longer says a transport regression blocks the next deploy. The
   `cross-service-freshness` step is a recency gate: it passes on the newest completed run of
   `cross-service-tests.yml` (any trigger, so a dispatched green run counts) in which
   `cross-service` and `servicebus-emulator-smoke` both succeeded within `window-days: '5'`
   (`MMCA.ADC/.github/workflows/deploy.yml:883-888`, `MMCA.Store/.github/workflows/deploy.yml:838-843`),
   with the age floored to whole days and compared as greater-than
   (`MMCA.Common/.github/actions/freshness-gate/action.yml:25-26`, `:143-145`), so a red nightly
   blocks a deploy only once that last proving run is six or more whole days old
   (`MMCA.ADC/.github/workflows/deploy.yml:867`, `MMCA.Store/.github/workflows/deploy.yml:824`).
2. Anchors rebased after MMCA.ADC #258 and MMCA.Store #197 (both "ci: prune unneeded workflow jobs
   and steps", 2026-10-07) shifted them: Store's emulator-tier comment block
   `MMCA.Store/Directory.Packages.props:84-87` (the patch-agnostic pin sentence at `:85-86`) and its
   entry at `:89`, previously `:88-90` and `:93`; the ADC `servicebus-emulator-smoke` job
   `MMCA.ADC/.github/workflows/cross-service-tests.yml:142` with its AUTHORITATIVE (TD-17) rationale
   at `:116-126`, previously `:159` and `:132-143`; the Store job
   `MMCA.Store/.github/workflows/cross-service-tests.yml:141` with its rationale at `:121-135`,
   previously `:160` and `:140-154`. The ADC comment and entry
   `MMCA.ADC/Directory.Packages.props:60-65` are unchanged. The earlier anchors were exact when the
   2026-10-01 and 2026-10-06 revisions recorded them.

## Revision (2026-10-21)
Re-verified against current source. The pin, the gate and the dependency set are unchanged:
MassTransit stays below major 9 and ImageSharp below major 4 in the fitness function, and all three
repos sit on MassTransit 8.5.11 (`MMCA.Common/Directory.Packages.props:124-126`,
`MMCA.ADC/Directory.Packages.props:65`, `MMCA.Store/Directory.Packages.props:92`). What moved is the
dependabot half of the ImageSharp pin: MMCA.Common #576 (2026-10-21) replaced its semver-major
ignore with a version range and rewrote its comment, so the record follows, plus anchors.

1. Decision 3 no longer says each gated package is mirrored as a dependabot major-update ignore,
   which was accurate until #576. Of the two gated packages only MassTransit still is
   (`update-types: ["version-update:semver-major"]`, `MMCA.Common/.github/dependabot.yml:59-60`);
   ImageSharp is now ignored by the version range `>= 3.2.0` (`:64-65`), which tightens the
   dependabot side from v3 to 3.1.x and is tighter than the major-4 gate.
2. Decision 3 now discloses that source is internally inconsistent about ImageSharp licensing:
   `MMCA.Common/.github/dependabot.yml:61-63` says 3.2.0+ already requires a commercial key at build
   time, while `DependencyVersionTestsBase.cs:43` and `:58-59`, `MMCA.Common/Directory.Packages.props:134-138`
   and `MMCA.Common/Directory.Build.props:35-36`, `:45` place the licensing line at v4, and the gate
   checks only major below 4 (`:55`). The HELD comment (`Directory.Packages.props:141-143`) treats
   the Split License as within the commercial-package exclusion. The record states these and does
   not adjudicate; which is right is an external licensing fact. Under the dependabot reading, a
   hand edit to 3.2.x passes the gate and is stopped by the build itself, not by the dependabot range,
   and **Rationale** now says the gate reads majors only.
3. Anchors re-verified against current source: `DependencyVersionTestsBase.cs` class at `:16-62`,
   the MassTransit package-id list at `:18-23` and the major ceiling at `:25-38` (previously
   `:17-60`, `:17-22`, `:24-37`); the three `MMCA.Common.Infrastructure.csproj` MassTransit
   references at `:55-57` (previously `:52-54`); Store's emulator-tier comment and entry at
   `MMCA.Store/Directory.Packages.props:87-92` with the patch-agnostic pin sentence at `:88-89`
   (previously `:84-89` and `:85-86`); the `cross-service-freshness` step at
   `MMCA.ADC/.github/workflows/deploy.yml:885-906` (window `:898`, `same-run` `:903`) and
   `MMCA.Store/.github/workflows/deploy.yml:827-848` (window `:840`, `same-run` `:845`), previously
   `:883-888` and `:838-843`. The freshness-gate floor and comparison
   (`MMCA.Common/.github/actions/freshness-gate/action.yml:25-26`, `:143-145`) are unchanged.

## Revision (2026-10-25, ImageSharp leaves the framework)
Re-verified against current source (MMCA.Common `main` at v1.260.0, MMCA.ADC and MMCA.Store `main`).
The MassTransit ceiling is unchanged: every MassTransit package Common pins stays below major 9, and
all three repos sit on MassTransit 8.5.12 (`MMCA.Common/Directory.Packages.props:125-127`, `:130`,
`:136`, `MMCA.ADC/Directory.Packages.props:73`, `MMCA.Store/Directory.Packages.props:97`). What moved
is the second instance of the pattern, which no longer exists.

1. **SixLabors.ImageSharp is gone from the framework.** v1.258.0 (MMCA.Common #603) moved image
   normalization from ImageSharp to SkiaSharp (MIT) and removed, with the package,
   `DependencyVersionTestsBase.ImageSharp_MustNotExceed_MajorVersion3`, `ImageSharpPackageIds` and
   the five ImageSharp `NuGetAuditSuppress` entries (`MMCA.Common/CHANGELOG.md:23`,
   `MMCA.Common/UPGRADING.md:67-68`). The dependabot ignore went with it: the only package-specific
   license ignore left is `MassTransit*` (`MMCA.Common/.github/dependabot.yml:57-60`), and
   `MMCA.Common/Directory.Build.props:33-36` now says no NuGet advisory is accepted. v1.259.0
   (MMCA.Common #608) then removed image processing from the framework altogether, SkiaSharp
   included, because its native libraries were copied into every project referencing
   `MMCA.Common.Infrastructure` and ran consumer CI runners out of disk (`MMCA.Common/CHANGELOG.md:17`).
2. Decision 3, **Rationale** and **Trade-offs** therefore name MassTransit as the only gated
   package. The general rule is unchanged: a license-boundary major is pinned with a fitness test
   plus a dependabot ignore. The licensing inconsistency the 2026-10-21 revision disclosed (whether
   ImageSharp 3.2.0+ or only v4 needed a key) is moot with the package gone, so Decision 3 no longer
   carries it.
3. The MassTransit gate itself widened in v1.258.0: `MassTransitPackageIds` now also lists
   `MassTransit.AmazonSQS` and `MassTransit.SqlTransport.PostgreSQL`, so it reads five ids
   (`DependencyVersionTestsBase.cs:18-25`; `MMCA.Common/CHANGELOG.md:33`). The base class now spans
   `:16-41`, the test `:27-40`, the ceiling `:34` (previously `:16-62`, `:18-23`, `:25-38`). Store
   and ADC still declare none of the other four ids, so **Context** now says four.
4. Context anchors rebased. `MMCA.Common.Infrastructure.csproj` references `MassTransit` and
   `MassTransit.RabbitMQ` at `:48-49` and `MassTransit.SqlTransport.PostgreSQL` at `:53` (previously
   three MassTransit references at `:55-57`); `MassTransit.Azure.ServiceBus.Core` now flows from
   `MMCA.Common.Azure.csproj:28` and `MMCA.Common.Testing.Azure.csproj:21`. The pin comment is at
   `MMCA.Common/Directory.Packages.props:119-124` (previously `:119-123`), its entries at `:125-127`
   (previously `:124-126`); the ADC emulator-tier comment and entry at
   `MMCA.ADC/Directory.Packages.props:68-73` (previously `:60-65`), Store's at
   `MMCA.Store/Directory.Packages.props:92-97` with the patch-agnostic sentence at `:93-94`
   (previously `:87-92` and `:88-89`).

## Related
ADR-015 (the fitness function that enforces the pins), ADR-003 / ADR-006 (MassTransit is the broker
transport behind the outbox and database-per-service flows).
[ADR-118](118-message-transport-library-policy.md) owns the exit strategy and the ordered
replacement list (Wolverine first, a raw-SDK adapter second, a commercial v9 rejected); it is the
later decision, so where its list and the 2026-08-28 candidates in **Transport exit options** differ,
ADR-118 governs. No replacement is implemented yet.
