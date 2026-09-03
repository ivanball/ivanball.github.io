# Versioning & Breaking-Change Policy

MMCA.Common publishes its NuGet packages (the authoritative list and count live in
[FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md)) versioned and released
**together** as a single unit. They share one version number so a consumer never has to reason about cross-package
compatibility. (`MMCA.Common.UI.Maui` rides the same tag but is built and packed by a dedicated
windows job in `release.yml`, since its MAUI target frameworks cannot build on the ubuntu runner.)

Every release goes to **two registries** ([ADR-053](../adr/053-dual-registry-package-publishing.md)):
nuget.org (the public install path, credential-free) and GitHub Packages (retained for versions
predating nuget.org publishing, which were not backfilled). One tag drives both pushes. The nuget.org
push authenticates with **OIDC trusted publishing**, not a stored API key: each publishing job mints a
short-lived key immediately before the push, so no long-lived credential exists in the repository.

## Semantic Versioning

Versions follow [SemVer 2.0](https://semver.org/): `MAJOR.MINOR.PATCH`:

- **MAJOR**: reserved (see "Breaking changes within 1.x" below).
- **MINOR**: new capability, and the channel breaking changes currently ship in.
- **PATCH**: backward-compatible bug fix.

Versions are produced by **MinVer** from annotated git tags of the form `vMAJOR.MINOR.PATCH`
(e.g. `v1.51.0`). Untagged builds get a height-based pre-release suffix. There is no hand-edited
version property; tag the commit and the release workflow packs and pushes.

## What counts as breaking

A change is **breaking** if it is any of:

- Removing or renaming a public type/member, or changing a signature.
- Changing the meaning of an existing configuration key, or changing a default in a way that
  alters runtime behavior for an unchanged consumer (e.g. the `Outbox:RetentionDays` default,
  call these out in [CHANGELOG.md](https://github.com/ivanball/MMCA.Common/blob/main/CHANGELOG.md) under **Changed (Behavior)**).
- Tightening a base-class contract (e.g. making a virtual member abstract, or a factory now
  returning `Result<T>` where it returned a bare entity).
- Removing or narrowing a supported transport/provider/data-source engine.

Additive, opt-in changes (new settings with safe defaults, new overloads, new interfaces) are not
breaking.

## Breaking changes within 1.x

**Breaking changes ship as MINOR bumps, not MAJOR ones**, and the version number is therefore not a
reliable breakage signal on its own. This is deliberate and follows from the lockstep model: the
framework and every first-party consumer are released and swept by the same owner in one pass
([ADR-016](../adr/016-lockstep-versioning-masstransit-pin.md)), so a removal is only ever observed
together with the change set that fixes it. Recent examples: `v1.79.0` renamed the Aspire.Hosting
extension `WithDataSource` to `WithSQLServerDataSource`, and `v1.123.0` removed the
`IIntegrationEventPublisher` interface and its `IntegrationEventPublisher` adapter outright, callers
moving to `IEventBus`.

**What this means for you:** read the
[CHANGELOG](https://github.com/ivanball/MMCA.Common/blob/main/CHANGELOG.md) before every bump, not
just before a major one. Each release that contains a breaking change opens with a bold
**Breaking:** line and lists the affected APIs under **Removed** or **Changed (Behavior)**. For the
releases that move namespaces (the feature-by-folder passes, v1.183.0 onward), the repo root
[UPGRADING.md](https://github.com/ivanball/MMCA.Common/blob/main/UPGRADING.md) keeps the durable
old-to-new map per release plus the mechanical `using` fix; the same map opens the pull request that
made the change. Pin an exact version and upgrade deliberately; do not use a floating version range.

## Consumer rollout

Per project convention, framework upgrades are **swept across all consumers in one pass**:
there are no opt-in flags or phased rollouts for a MMCA.Common change. When a release contains a
breaking change, the consuming repos (MMCA.ADC, MMCA.Store, MMCA.Helpdesk) are updated in the same
change set. For an API **removal**, MMCA.Helpdesk is swapped first: it builds against framework
source, so it is the gate that proves the replacement API compiles before the packages are cut.

## Deprecation

There is **no `[Obsolete]` grace period** today. Because the lockstep sweep updates every first-party
caller in the same change set, a superseded API is removed in the release that supersedes it rather
than marked obsolete and carried. `[Obsolete]` is used only where the compiler warning is the point
(steering authors away from a pattern that still compiles, e.g. composed sentences that cannot be
translated under [ADR-027](../adr/027-multi-locale-i18n.md)), not as a removal countdown.

The replacement is always named in the CHANGELOG entry alongside the removal. If external adoption
makes a grace period worthwhile, the change is to add one here first, not to assume one exists.

## Supply chain

- All package versions are centrally pinned (`Directory.Packages.props`).
- NuGet **lock files** are committed for reproducible restores.
- `MassTransit` is pinned to **v8** by policy (v9 needs a commercial license), enforced by a
  fitness test, not just a comment.
- A **CycloneDX SBOM** is produced at release; dependency vulnerabilities are audited in CI.
