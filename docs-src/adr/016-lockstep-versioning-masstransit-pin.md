# ADR-016: Lockstep Package Versioning and the MassTransit-v8 Pin

## Status
Accepted (2026-07-15). Amended (2026-07-28): the fitness function now gates two commercial-license
majors (MassTransit and SixLabors.ImageSharp), so the decision is restated as the pattern rather than
the single pin; the consumer framing is corrected (Store and ADC each declare a
`MassTransit.Azure.ServiceBus.Core` entry of their own for the Service Bus emulator test tier), as is
the claim that framework-to-app (`[C->A]`) changes are non-breaking. Amended (2026-08-01): Store now
has its own `.github/dependabot.yml` (added 2026-07-29) mirroring ADC's, so the trade-off that rested
on Store having no such file is restated, and the ADC `MassTransit.Azure.ServiceBus.Core` citation is
rebased onto its current lines. Amended (2026-08-14): every `Directory.Packages.props` citation is
rebased onto its current lines, and the versions are restated per repo (Common is on MassTransit
8.5.10 and `SixLabors.ImageSharp` 3.1.12; Store and ADC still declare
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
   (`Website/docs-src/guides/common-VERSIONING.md:43-50`). It is safe because every first-party
   caller moves in the same change set, an API removal is proven against Helpdesk's source build
   first (`common-VERSIONING.md:67-68`), and there is no `[Obsolete]` grace period to keep in step
   (`common-VERSIONING.md:66-72`).
3. **Pin a commercial-license dependency below its paid major, enforced by a fitness function.**
   `DependencyVersionTestsBase` parses `Directory.Packages.props` and fails the build when a pinned
   package reaches the major where its licensing changes (ADR-015). Two are gated today: MassTransit
   below major 9 (v9 demands `MT_LICENSE` at startup, so every broker-enabled host crashes without
   one) and `SixLabors.ImageSharp` below major 4 (v4 demands a Six Labors key at BUILD time, so its
   MSBuild targets fail outright), each mirrored as a dependabot major-update ignore so the bump is
   never even proposed
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:17-60`,
   `MMCA.Common/Directory.Packages.props:90-97`, `MMCA.Common/.github/dependabot.yml:57-60`).
   MassTransit is the original instance; ImageSharp is what showed the rule generalizes.

   The assertions run in MMCA.Common only, the one repo that subclasses the base
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DependencyVersionTests.cs:9`).
   Helpdesk declares neither package. Store and ADC take `MassTransit` and `MassTransit.RabbitMQ`
   transitively through `MMCA.Common.Infrastructure`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/MMCA.Common.Infrastructure.csproj:34-36`),
   but each **does** declare one MassTransit entry of its own: `MassTransit.Azure.ServiceBus.Core`
   8.5.10 for the Service Bus emulator test tier, carrying a comment that names Common's lockstep v8
   pin (`MMCA.ADC/Directory.Packages.props:60-65`, `MMCA.Store/Directory.Packages.props:83-88`).
   Common's own three MassTransit entries are on that same 8.5.10
   (`MMCA.Common/Directory.Packages.props:95-97`), so all three repos sit on one patch version.
   Alignment there is a convention the app-side comments carry, not something the gate enforces:
   what the pin governs, and what the fitness function reads, is the major, so an app-side entry on
   a different v8 patch would still be inside the decision.
   They still do not subclass the test: its default list also names the two package ids they do not
   declare, and the rule fails on a pin it cannot find
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.Governance.cs:42-45`).

## Rationale
- **One version, one compatibility story.** Lockstep removes the N-package matrix: "everything on
  `vX.Y.Z`" is the only supported combination, which is the right trade for a small team.
- **No skew.** Sweeping all consumers at once keeps the framework and both apps converged rather than
  drifting across releases.
- **A license pin is a build gate, not a comment.** A blanket "update all packages" sweep does not
  read license terms. It pulled MassTransit to v9 once already, and because CI never starts a broker
  the build stayed green while every host was primed to crash at startup; ImageSharp v4 fails louder
  (the build itself) but arrives by exactly the same route. What stops both is the pair: the
  dependabot ignore keeps the proposal from being raised, and the fitness function catches it when a
  hand edit raises it anyway (which is exactly the invariant-over-discipline posture of ADR-015).

## Trade-offs
- A consumer cannot adopt a single package in isolation: it takes the whole set at the new version.
- Lockstep will bump a package whose code did not change (acceptable: the version means "compatible
  with this set," not "this package changed").
- Each pin forgoes the newer major (MassTransit v9, ImageSharp v4) until a licensing decision is
  made; bumping one is a deliberate, multi-step change, not a one-line version edit.
- The gate reads MMCA.Common's `Directory.Packages.props` and nothing else, so the
  `MassTransit.Azure.ServiceBus.Core` entry Store and ADC each declare for their emulator tier sits
  outside its reach. What holds those two at v8 is that neither repo lets dependabot touch NuGet at
  all: each carries a `dependabot.yml` scoped to github-actions only, whose own comment says NuGet is
  deliberately excluded because `MMCA.Common.*` bumps happen solely through this ADR's lockstep sweep
  and MassTransit must stay v8 (`MMCA.ADC/.github/dependabot.yml:1-4`,
  `MMCA.Store/.github/dependabot.yml:1-8`, the latter added 2026-07-29), plus review.

## Transport exit options
The pin has a horizon. MassTransit v8 is the free major and its community support ends at the end of
2026 (a maintainer statement about the package, not something this repository can assert), so
"stay on v8" is a decision with an expiry rather than a permanent one. Nothing changes today; the
candidates are recorded now so the eventual move is a comparison and not a scramble.

What makes any of them a bounded change is where MassTransit actually sits. The whole
`using MassTransit` surface is **eight files across two packages**. Seven are in
`MMCA.Common.Infrastructure`: `Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:3`,
`Messaging/BrokerMessageBus.cs:1`, `Messaging/Consumers/IntegrationEventConsumer.cs:1`,
`Messaging/Consumers/IntegrationEventConsumerExtensions.cs:1`,
`Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:3`,
`Messaging/Consumers/FaultIntegrationEventConsumer.cs:1` and `Messaging/ServiceBusEmulatorSupport.cs:4`;
the eighth is `Source/Hosting/MMCA.Common.Testing/Fixtures/ServiceBusEmulatorFixtureBase.cs:5`. The
last two are the emulator test tier rather than the transport: each one lowers the process-global
`MassTransit.AzureServiceBusTransport.Defaults` entity quotas the emulator rejects
(`ServiceBusEmulatorSupport.cs:115-117`, `ServiceBusEmulatorFixtureBase.cs:74-76`), a v8 constraint
that moves with that tier, not with the bus. The files that reference MassTransit **types**
(`IConsumer<T>`, `ConsumeContext<T>`, `IPublishEndpoint`, `IBusRegistrationConfigurator`) are the
first six, all in `MMCA.Common.Infrastructure`. Application, Domain and Shared never reference it:
`IMessageBus` is the Application-layer abstraction
(`MMCA.Common/Source/Core/MMCA.Common.Application/Messaging/IMessageBus.cs:28`) and
`BrokerMessageBus` is its only broker implementation (`BrokerMessageBus.cs:24`), which is the
boundary ADR-008's `MicroserviceExtractionTests` already keep enforced.

Three candidates, **none adopted and none evaluated against a running broker here**:

1. **The OpenTransit community fork of MassTransit v8.** Cheapest on paper, a package id swap under
   the same API. No repo in this workspace references it, and the part that would decide it is Azure
   Service Bus parity, since production runs Service Bus while local runs RabbitMQ
   (`DependencyInjection.cs:926`, `:956`). Its release status and its parity are external facts this
   record cannot verify and does not assert.
2. **A commercial MassTransit v9 license.** The straight-line option: the pin exists only because v9
   demands `MT_LICENSE` at startup and every broker-enabled host crashes without it
   (`MMCA.Common/Directory.Packages.props:90-94`). A license retires the gate rather than routing
   around it, at a recurring cost.
3. **A direct `Azure.Messaging.ServiceBus` implementation of `IMessageBus`.** The largest and the
   most owned. Publishing is one class (`BrokerMessageBus.cs:24`), but the consume side is where the
   library earns its keep: three consumers ride `IConsumer<T>` (`IntegrationEventConsumer.cs:30`,
   `UpcastingIntegrationEventConsumer.cs:36`, `FaultIntegrationEventConsumer.cs:28`) and the
   transport wiring supplies exponential in-process retry plus second-level delayed redelivery
   (`DependencyInjection.cs:938-951` on RabbitMQ, `:980-990` on Service Bus, the two-level argument
   at `:899-913`), all of which would be hand-written. It also drops RabbitMQ, which the local
   Aspire stack provisions.

The trial point is the same for all three and it is additive: a new case in the `MessageBusProvider`
switch inside `ConfigureBrokerTransport`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:933`, switch at `:938`,
enum at `Settings/MessageBusSettings.cs:199`), so a candidate ships **beside** RabbitMQ and Service
Bus instead of replacing either, and a consumer opts in by configuration. The two artifacts that move
with a decision are the pin
(`MMCA.Common/Directory.Packages.props:90-94`, the three entries at `:95-97`) and the fitness
function that reads it
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:17-22`,
the major ceiling at `:24-37`), plus the dependabot ignore they are paired with.

A proving ground already exists: both consumers' nightlies run an Azure Service Bus emulator smoke
against their real integration-event contracts, and the tier is authoritative rather than advisory,
so a transport regression blocks the next deploy
(`MMCA.ADC/.github/workflows/cross-service-tests.yml:153-157`, the gating rationale at `:126-137`,
and the equivalent `servicebus-emulator-smoke` job in
`MMCA.Store/.github/workflows/cross-service-tests.yml`; the deploy-side halves are recorded in
ADR-066 and ADR-064). Any transport candidate has somewhere to be exercised that is not production.

## Related
ADR-015 (the fitness function that enforces the pins), ADR-003 / ADR-006 (MassTransit is the broker
transport behind the outbox and database-per-service flows).
