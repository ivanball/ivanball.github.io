# ADR-016: Lockstep Package Versioning and the MassTransit-v8 Pin

## Status
Accepted (2026-07-15). Amended (2026-07-28): the fitness function now gates two commercial-license
majors (MassTransit and SixLabors.ImageSharp), so the decision is restated as the pattern rather than
the single pin; the consumer framing is corrected (Store and ADC each declare a
`MassTransit.Azure.ServiceBus.Core` entry of their own for the Service Bus emulator test tier), as is
the claim that framework-to-app (`[C->A]`) changes are non-breaking.

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
   first (`common-VERSIONING.md:58-64`), and there is no `[Obsolete]` grace period to keep in step
   (`common-VERSIONING.md:66-72`).
3. **Pin a commercial-license dependency below its paid major, enforced by a fitness function.**
   `DependencyVersionTestsBase` parses `Directory.Packages.props` and fails the build when a pinned
   package reaches the major where its licensing changes (ADR-015). Two are gated today: MassTransit
   below major 9 (v9 demands `MT_LICENSE` at startup, so every broker-enabled host crashes without
   one) and `SixLabors.ImageSharp` below major 4 (v4 demands a Six Labors key at BUILD time, so its
   MSBuild targets fail outright), each mirrored as a dependabot major-update ignore so the bump is
   never even proposed
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:17-60`,
   `MMCA.Common/Directory.Packages.props:54-56,66`, `MMCA.Common/.github/dependabot.yml:56-65`).
   MassTransit is the original instance; ImageSharp is what showed the rule generalizes.

   The assertions run in MMCA.Common only, the one repo that subclasses the base
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9`).
   Helpdesk declares neither package. Store and ADC take `MassTransit` and `MassTransit.RabbitMQ`
   transitively through `MMCA.Common.Infrastructure`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/MMCA.Common.Infrastructure.csproj:34-36`),
   but each **does** declare one MassTransit entry of its own: `MassTransit.Azure.ServiceBus.Core`
   8.5.5 for the Service Bus emulator test tier, carrying a comment that points back to Common's v8
   pin (`MMCA.ADC/Directory.Packages.props:90-95`, `MMCA.Store/Directory.Packages.props:116-121`).
   They still do not subclass the test: its default list also names the two package ids they do not
   declare, and the rule fails on a pin it cannot find
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:42-45`).

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
  all (ADC says so explicitly and cites this ADR, `MMCA.ADC/.github/dependabot.yml:1-4`; Store has
  no dependabot config), plus review.

## Related
ADR-015 (the fitness function that enforces the pins), ADR-003 / ADR-006 (MassTransit is the broker
transport behind the outbox and database-per-service flows).
