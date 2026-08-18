# ADR-031: Config-Driven Feature Flags with Dual-Surface Enforcement

## Status
Accepted (2026-06-27). Revised 2026-08-18 (a targeting-context accessor is now registered, so the
built-in Targeting and Percentage filters give consistent per-user bucketing across replicas; the
last Trade-offs entry is narrowed accordingly. See the Revision (2026-08-18) at the end).

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
- **Flag debt.** Every flag is a branch that must eventually be removed; the framework provides no expiry
  or staleness check.
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
(`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs:51-52`)
implements `ITargetingContextAccessor` and is registered inside `AddAPI` as
`services.AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()`, preceded by
`AddHttpContextAccessor()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:90-92`,
rationale at `:84-89`). It takes `IHttpContextAccessor` rather than the scoped `ICurrentUserService`
precisely because `WithTargeting` registers the accessor as a singleton. `UserId` resolves to the
`user_id` claim falling back to `Identity.Name` (`:86`, claim constant at `:55`), and `Groups` accepts
role claims under `ClaimTypes.Role`, `"role"` or `"roles"` (`:76-82`), so a rollout can target a role
as well as a user. An unauthenticated or absent principal yields an empty context rather than an
exception (`:67-74`), which keeps anonymous traffic evaluating to the flag's non-targeted result
instead of failing.

**No decorator changed.** `FeatureGateCommandDecorator` still depends only on `IFeatureManager` and
still calls `IsEnabledAsync(featureGated.FeatureName)` with no targeting argument (`:20`, `:51`); the
targeting context is resolved inside the filter through the registered accessor. Both enforcement
surfaces therefore inherit consistent bucketing with no change at either call site, which is the
property that made this a registration-only change.

The Trade-offs entry above is **narrowed, not removed**: bucketing is now consistent across replicas
for any host that goes through `AddAPI`, but it is only as consistent as the `user_id` claim is
stable, and a flag whose filter is configured without a targeting audience still behaves exactly as
before.

## Related
ADR-014 (the decorator pipeline whose outermost slot `FeatureGate` fills, and the ordering that puts it
first, now with Authorization registered directly inside it so a disabled feature does not leak which
permission guards it), ADR-013 (the `Result` / `Error` and ProblemDetails edge the disabled responses
reuse), ADR-019 / ADR-020 / ADR-021 / ADR-026 (the other opt-in, audit-the-inventory capabilities),
ADR-020 (the role vocabulary the targeting accessor reads as `Groups`).
