# ADR-031: Config-Driven Feature Flags with Dual-Surface Enforcement

## Status
Accepted (2026-06-27). Revised 2026-08-18 (a targeting-context accessor is now registered, so the
built-in Targeting and Percentage filters give consistent per-user bucketing across replicas; the
last Trade-offs entry is narrowed accordingly. See the Revision (2026-08-18) at the end). Revised
2026-08-31 (the targeting identifier is the JWT `sub` claim read through `FindUserIdValue()`, not a
`user_id` claim; the Revision section is corrected accordingly).

Revised 2026-09-11 (the flag-debt trade-off is closed on the framework side: `[FeatureFlag]` declares a
flag's lifetime, removal date and owner, `FeatureFlagRegistry` reports a host's own inventory, and two
fitness rules behind `FeatureFlagLifecycleTestsBase` fail the build for an undeclared flag or a
temporary one past its date; adoption is per repo, like every other fitness base. See the Revision
(2026-09-11) at the end.)

## Context
The apps need to decouple *release* from *deploy*: ship code dark, flip a kill switch, or roll a feature
out to a percentage of users without a redeploy. A flag has to be enforceable at **two** different points
of the request path (the HTTP edge (an MVC action) and inside the CQRS pipeline (a command or query))
because a feature can be reachable from either. ADR-014 already names a `FeatureGate` decorator as the
outermost slot of the command/query pipeline, but it only decides the *decorator ordering*; it does not
decide the provider, the controller-edge surface, the disabled-response convention, or the rollout
filters. This ADR records those.

## Decision
Standardize on **`Microsoft.FeatureManagement`**, configured from the `"FeatureManagement"` configuration
section and registered once in `AddAPI`
(`services.AddFeatureManagement()` + `services.AddSingleton<IDisabledFeaturesHandler,
DisabledFeatureHandler>()`, `MMCA.Common.API/DependencyInjection.cs:91-93`), with the built-in
**Percentage / TimeWindow / Targeting** filters available for progressive rollout. The same flag *name*
is enforced at two independent surfaces:

- **HTTP edge:** `[FeatureGate("X")]` (`Microsoft.FeatureManagement.Mvc`) on a controller or action. When
  `X` is off, `DisabledFeatureHandler` returns an **RFC 9457 ProblemDetails `404`** ("Feature not
  available"), matching the standard `ApiControllerBase.HandleFailure` error shape.
- **CQRS pipeline:** a command/query implements `IFeatureGated` (exposing `FeatureName`). The
  `FeatureGateCommandDecorator` / `FeatureGateQueryDecorator` (the **outermost** decorator (ADR-014))
  checks `IFeatureManager.IsEnabledAsync(FeatureName)` and, when off, short-circuits with
  `Error.NotFoundError("Feature.Disabled", …)` (`ErrorType.NotFound`) **before** any logging, caching,
  validation, or transaction work.
- **Disabled = `404` (NotFound), never `403`.** Both surfaces return not-found, so a disabled feature is
  indistinguishable from a nonexistent one: it hides the feature's existence rather than advertising a
  forbidden capability.
- **Flag names are module constants** (`CatalogFeatures` / `SalesFeatures` in Store,
  `ConferenceFeatures` / `EngagementFeatures` in ADC) that match keys in each service's
  `"FeatureManagement"` config, so a flag flips at config + restart, not at deploy. The framework itself
  uses `[FeatureGate]` (e.g. the notification controllers), and the decorators ship with unit tests.

## Rationale
- **Release decoupled from deploy.** A kill switch or a percentage rollout becomes a configuration change,
  not a code change: the central reason feature management exists.
- **Two surfaces because the enforcement points see different request shapes.** Gating both the edge
  *and* the handler with one flag name keeps controller and use case in agreement, so a disabled feature
  is unreachable from either entry instead of leaking through the one that was missed.
- **The `404` convention reuses the existing edge.** Both surfaces emit the same Result→ProblemDetails
  not-found shape (ADR-013), so a disabled feature looks like any other not-found and leaks nothing about
  hidden functionality.

## Trade-offs
- **The two enforcement points must agree.** A flag gated on the controller but not the handler (or vice
  versa) is a half-protected feature; no fitness rule asserts both are wired, so coherence is a
  convention/audit concern.
- **Flag debt.** Every flag is a branch that must eventually be removed. The framework now ships the
  expiry check it used to lack (`[FeatureFlag]` plus two fitness rules; see the Revision (2026-09-11)),
  but the gate is adopted per repo: a repo that has not subclassed `FeatureFlagLifecycleTestsBase`
  still carries its flag debt uncounted.
- **Per-service configuration.** The same flag name must be present in each service that enforces it. A
  missing key resolves to **disabled** (`IsEnabledAsync`'s default): fail-safe for a kill switch, but it
  will silently hide a feature you meant to ship if the key is forgotten.
- **Rollout state is per instance unless a context is wired.** Percentage/Targeting bucketing is
  evaluated locally, so consistent assignment across replicas/users needs a deliberate targeting context;
  out of the box the rollout is per-process.

## Revision (2026-08-18)
**Progressive rollout is now usable, because the targeting context exists.** The Decision above listed
the Percentage / TimeWindow / Targeting filters as "available", and the last Trade-offs entry recorded
the catch: without a targeting context wired, bucketing is evaluated per process, so a percentage
rollout assigns a user differently on each replica and a user can see a feature appear and disappear
between requests.

`CurrentUserTargetingContextAccessor`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs:54-55`)
implements `ITargetingContextAccessor` and is registered inside `AddAPI` as
`services.AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()`, preceded by
`AddHttpContextAccessor()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:90-92`,
rationale at `:84-89`). It takes `IHttpContextAccessor` rather than the scoped `ICurrentUserService`
precisely because `WithTargeting` registers the accessor as a singleton. `UserId` resolves to the JWT
`sub` claim through `user.FindUserIdValue()`, falling back to `Identity.Name` (`:86`), and `Groups`
accepts role claims under `ClaimTypes.Role`, `"role"` or `"roles"` (`:76-82`), so a rollout can target
a role as well as a user. An unauthenticated or absent principal yields an empty context rather than an
exception (`:67-74`), which keeps anonymous traffic evaluating to the flag's non-targeted result
instead of failing. `FindUserIdValue`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:26-28`) reads the raw
`sub` claim (`AuthClaimTypes.Subject`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:25`) and falls back to the mapped
`ClaimTypes.NameIdentifier` the JWT bearer handler produces, so targeting buckets on exactly the
identifier `CurrentUserService` and the idempotency filter read.

**No decorator changed.** `FeatureGateCommandDecorator` still depends only on `IFeatureManager` and
still calls `IsEnabledAsync(featureGated.FeatureName)` with no targeting argument (`:20`, `:51`); the
targeting context is resolved inside the filter through the registered accessor. Both enforcement
surfaces therefore inherit consistent bucketing with no change at either call site, which is the
property that made this a registration-only change.

The Trade-offs entry above is **narrowed, not removed**: bucketing is now consistent across replicas
for any host that goes through `AddAPI`, but it is only as consistent as the `sub` claim is
stable, and a flag whose filter is configured without a targeting audience still behaves exactly as
before.

## Related
ADR-014 (the decorator pipeline whose outermost slot `FeatureGate` fills, and the ordering that puts it
first, now with Authorization registered directly inside it so a disabled feature does not leak which
permission guards it), ADR-013 (the `Result` / `Error` and ProblemDetails edge the disabled responses
reuse), ADR-019 / ADR-020 / ADR-021 / ADR-026 (the other opt-in, audit-the-inventory capabilities),
ADR-020 (the role vocabulary the targeting accessor reads as `Groups`).

## Revision (2026-09-11)
**The expiry gap the Trade-offs recorded is closed.** "The framework provides no expiry or staleness
check" was true from this record's acceptance until now. What it cost was never the flag itself but
the branch behind it: once a rollout finishes, the losing branch is unreachable code that no test, no
coverage report and no reviewer is prompted to notice.

**A flag declares its lifecycle on the constant.** `[FeatureFlag]`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs:32`) takes a
`FeatureFlagLifetime` (`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagLifetime.cs:9`,
`Permanent` at `:15`, `Temporary` at `:21`) and carries an optional `Owner`
(`FeatureFlagAttribute.cs:52`) and a `RemoveBy` written as ISO `yyyy-MM-dd` (`:46`, the format constant
at `:35`, the parser at `:60`). `RemoveBy` is required on a temporary flag and forbidden on a permanent
one, which is what keeps a removal date meaningful rather than decorative.

**The inventory is readable at runtime.** `FeatureFlagRegistry`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagRegistry.cs:35`) describes the
`public const string` fields of every static `*Features` class in an assembly (`:46`, `:64`, the class
test at `:77`, the field selection at `:91`) as `FeatureFlagDescriptor` records (`:17`) carrying field
name, flag name, lifetime, removal date and owner, so an administration surface reporting a host's
flags does not have to re-derive the `*Features` convention for itself.

**Two fitness rules make it a build gate.** `ArchitectureRules.FeatureFlagsDeclareLifetime`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.FeatureFlags.cs:28`)
fails for a constant with no attribute (`:42`), for a permanent flag that sets `RemoveBy` (`:46`), and
for a temporary flag whose date is missing or unparseable (`:51`).
`TemporaryFeatureFlagsAreNotPastRemoveBy` (`:70`) fails for any temporary flag whose date has passed
(`:77`), naming the flag, the date and the owner. The second rule is the dead-toggle detector: the red
build is what tells you the rollout finished and the branch it chose between can go. Both are exposed
as facts on `FeatureFlagLifecycleTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/FeatureFlagLifecycleTestsBase.cs:10`,
the two facts at `:20`-`:25`, the architecture map at `:12`), whose `Today` is a `protected virtual`
property (`:18`) so a repo can pin the judgement date rather than let the build's clock decide when a
toggle goes red.

**Adoption is per repo, and the framework annotates its own flags.** Like every fitness base
([ADR-058](058-runtime-conformance-suites-as-a-package.md)), the gate exists only where a repo subclasses it,
so this closes the trade-off for an adopting repo and leaves it open for one that changes nothing; it
is additive, and a consumer that adopts none of it keeps building exactly as before. The framework's
own two flags are annotated `Permanent`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationFeatures.cs:11`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:11`). The fix for a flag that
goes red is to delete the flag and the branch it no longer chooses between, not to push the date out.
