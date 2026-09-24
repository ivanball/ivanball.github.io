# Feature Flags in the CQRS Pipeline: Gate Commands, Not Code

> Series: MMCA.Common · Article #45 (deep-dive) · Pillar P2 · Group G05 · Rubric §6 · ADR-031 ·
> Status: grounded in `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs`,
> `FeatureGateQueryDecorator.cs`, `UseCases/Markers/IFeatureGated.cs`, `MMCA.Common.Application/DependencyInjection.cs`,
> `MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs`, `FeatureFlagRegistry.cs`,
> `MMCA.Common.Testing.Architecture/Bases/Governance/FeatureFlagLifecycleTestsBase.cs`,
> `MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs`,
> `MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs`, `MMCA.Common.API/DependencyInjection.cs`,
> `Website/docs-src/adr/031-feature-flag-management.md`, `Website/docs-src/onboarding/group-05-cqrs-pipeline.md`,
> and the real gated use cases in ADC and Store. No em dashes.

**Subtitle:** Decoupling release from deploy means shipping code dark and flipping a switch. Here is how
MMCA.Common gates commands and queries with feature flags at the outermost decorator, so a handler never
checks a flag itself, and a disabled feature is rejected before any work runs.

---

Product wants to ship a feature dark: merge it now, turn it on later, and be able to kill it in seconds
if it misbehaves in production. The mechanism is a feature flag, and the first instinct is almost always
the wrong one.

The wrong one looks like this. You inject an `IFeatureManager` into the handler that does the work, and
at the top of the method you write `if (!await featureManager.IsEnabledAsync("X")) return ...`. It works.
Then the same feature turns out to be reachable from a second endpoint, so you copy the check there too.
Then a third handler needs a different flag, and now every use case in the module opens with a few lines
of flag plumbing that has nothing to do with the business logic underneath it. The flag check has become
a cross-cutting concern that you are pasting by hand into every place it applies.

That is exactly the kind of concern MMCA.Common refuses to let leak into handlers. Logging, caching,
validation, and transactions already live in the decorator pipeline, written once and applied to every
handler. Feature gating is the same shape of problem, so it gets the same treatment: a decorator at the
outermost slot, and a one-property marker interface that a use case implements to opt in.

## Why it matters

A feature flag is a branch in production behavior, and branches that are copy-pasted drift. If the gate
lives inside the handler, then whether a feature is on is decided in as many places as the feature is
reachable from, and nothing forces those places to agree. Miss one and you have a half-protected feature:
disabled on the button the UI shows, still live on the endpoint a script can call.

There is also a cost argument. If the flag check is the first line of the handler, then everything the
request touches on the way to that handler (a log scope opened, a cache looked at, a validator resolved,
a database transaction begun) has already happened by the time you discover the feature is off. A kill
switch you flip during an incident should reject the request with as little machinery spun up as
possible, not do most of the work and then decline at the last moment.

And the deepest reason: a handler that checks its own flag knows about feature management. That is one
more ambient dependency in code whose entire job is supposed to be a single use case. The pipeline exists
so that the handler can stay ignorant of logging, caching, transactions, and flags alike, and be the same
code whether it runs in a monolith or an extracted service.

## The MMCA answer: an outermost decorator plus a marker interface

The whole mechanism is two small types plus a registration.

The opt-in signal is `IFeatureGated` (`UseCases/Markers/IFeatureGated.cs:10`), an interface with exactly
one member, `string FeatureName { get; }` (`IFeatureGated.cs:16`). A command or query implements it to
declare "I am gated behind this flag." The name has to match a key in the `"FeatureManagement"`
configuration section.

The enforcement is a pair of decorators, one per handler side. `FeatureGateCommandDecorator<TCommand,
TResult>` (`FeatureGateCommandDecorator.cs:20`) wraps `ICommandHandler`, and its query twin
`FeatureGateQueryDecorator<TQuery, TResult>` (`FeatureGateQueryDecorator.cs:20`) wraps `IQueryHandler`.
Both do the identical three-step thing in `HandleAsync`:

1. If the command or query is `not IFeatureGated`, call the inner handler and return
   (`FeatureGateCommandDecorator.cs:50-51`). A use case that does not opt in pays nothing.
2. If it is gated, check `featureManager.IsEnabledAsync(featureGated.FeatureName)`
   (`FeatureGateCommandDecorator.cs:53`). Enabled means delegate to the inner handler as normal.
3. If the flag is off, short-circuit: build and return a failure result carrying
   `Error.NotFoundError("Feature.Disabled", ...)` (`FeatureGateCommandDecorator.cs:56-59`), without ever
   invoking the handler.

Manufacturing that typed failure is the one subtle piece. `TResult` is unconstrained (it is `Result` for
some handlers and `Result<T>` for others), so the decorator cannot just `new` up a failure. It holds a
cached delegate, `CreateFailure`, built once per closed generic type via `ResultFailureFactory.Build`
(`FeatureGateCommandDecorator.cs:44-45`), which turns an error list into the right `TResult` failure with no
per-call reflection.

The last, load-bearing detail is where the decorator sits. In `AddApplicationDecorators` the feature gate
is registered last on both sides (`DependencyInjection.cs:143` for commands, `:151` for queries). Because
the pipeline applies decorators in reverse registration order (ADR-014), last-registered is outermost, so
the feature gate is the first decorator every request meets. A command runs feature gate, authorization,
logging, caching, validation, timeout, transaction, handler; a query runs feature gate, authorization,
logging, caching, validation, timeout, handler. A disabled feature is rejected with zero downstream work: no
permission check, no log scope, no cache touch, no validator, no timeout budget, no `BEGIN TRANSACTION`.

Here is the shape, drawn from the real decorator and two real gated use cases:

```csharp
// The opt-in marker (IFeatureGated.cs)
public interface IFeatureGated
{
    string FeatureName { get; }  // must match a "FeatureManagement" config key
}

// A real gated command (VerifyPaymentCommand.cs, Store Sales)
public sealed record VerifyPaymentCommand(OrderIdentifierType OrderId)
    : ICacheInvalidating, IFeatureGated, IHasTimeout
{
    public TimeSpan Timeout => TimeSpan.FromSeconds(20);
    public string CachePrefix => $"{typeof(Order).FullName}:";
    public string FeatureName => SalesFeatures.PaymentVerification;  // "Sales.PaymentVerification"
}

// The outermost decorator, the whole enforcement (FeatureGateCommandDecorator.cs)
public async Task<TResult> HandleAsync(TCommand command, CancellationToken cancellationToken = default)
{
    if (command is not IFeatureGated featureGated)
        return await inner.HandleAsync(command, cancellationToken).ConfigureAwait(false);

    if (await featureManager.IsEnabledAsync(featureGated.FeatureName).ConfigureAwait(false))
        return await inner.HandleAsync(command, cancellationToken).ConfigureAwait(false);

    var createFailure = CreateFailure();
    return createFailure([Error.NotFoundError(
        "Feature.Disabled",
        $"Feature '{featureGated.FeatureName}' is not currently available.")]);
}
```

(This block is a faithful composite: the interface and the `HandleAsync` body are verbatim from source,
and `VerifyPaymentCommand` is a real gated command, shown together so the opt-in and the enforcement read
in one place. See the Notes ledger for the exact files and lines.)

Two things make this more than a toy. First, the provider is real: `AddAPI` registers
`services.AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()` plus the
disabled-response handler (`MMCA.Common.API/DependencyInjection.cs:104-107`), which brings the built-in
Percentage, TimeWindow, and Targeting filters with a per-user audience already supplied, so "roll this
out to 10 percent" is a config change, not a code change. Second, flag
names are module constants, not magic strings scattered through handlers: `SalesFeatures.PaymentVerification`
= `"Sales.PaymentVerification"` (`SalesFeatures.cs:23`), `ConferenceFeatures.SessionizeIntegration` =
`"Conference.SessionizeIntegration"` (`ConferenceFeatures.cs:23`), `NotificationFeatures.PushNotifications`
= `"Notification.PushNotifications"` (`NotificationFeatures.cs:12`). ADC's `RefreshFromSessionizeCommand`
gates the Sessionize sync this way (`RefreshFromSessionizeCommand.cs:13,19`); Store's `VerifyPaymentCommand`
gates the direct Stripe verification path (`VerifyPaymentCommand.cs:20,35`).

## The second surface, and why disabled means 404

A feature can be reachable from the CQRS pipeline, but it can also be reachable straight from an MVC
action that never dispatches a command. So the same flag name is enforced at a second, independent
surface at the HTTP edge (ADR-031). There you put `[FeatureGate("X")]` (from `Microsoft.FeatureManagement.Mvc`)
on the controller or action; the framework's own push-device controller carries
`[FeatureGate(NotificationFeatures.PushNotifications)]` on the class
(`MMCA.Common.API/Controllers/Notifications/DevicesController.cs:24`), not app-specific code in ADC.
When the flag is off, `DisabledFeatureHandler`
(`DisabledFeatureHandler.cs:13`) writes an RFC 9457 ProblemDetails response with status
`404 Not Found` and the title `"Feature not available"` (`DisabledFeatureHandler.cs:18-26`).

Both surfaces agree on one convention that is worth stating plainly: a disabled feature returns
not-found, never `403 Forbidden`. The pipeline decorator short-circuits with `ErrorType.NotFound`; the
edge handler returns `404`. A disabled feature is therefore indistinguishable from a nonexistent one. That
is deliberate: `404` hides the feature's existence rather than advertising a capability the caller is not
allowed to use. Turning a flag off makes the feature vanish, not merely refuse.

## Trade-offs, honestly

- **The two surfaces must be kept in agreement by hand.** Gating the controller but not the command (or
  the reverse) leaves a half-protected feature reachable through the entry you missed. ADR-031 is explicit
  that no fitness rule asserts both are wired, so coherence is a convention and an audit concern, not
  something the build enforces.
- **A missing config key resolves to disabled.** `IsEnabledAsync` returns false for a name that is not in
  the `"FeatureManagement"` section. That is the right default for a kill switch (fail safe), but it also
  means forgetting to add the key in a given service silently hides a feature you meant to ship. Per
  service, the flag has to be present.
- **Flag debt is declared on the constant, and the expiry gate is opt-in per repo.** Every flag is a
  branch that has to be removed once the feature is permanent, so a flag constant carries its own
  lifecycle: `[FeatureFlag]` (`FeatureFlagAttribute.cs:32`) takes a `FeatureFlagLifetime` (`:38`,
  `Permanent` and `Temporary` at `FeatureFlagLifetime.cs:15,21`) plus an optional `Owner` (`:52`) and a
  `RemoveBy` date written as ISO `yyyy-MM-dd` (`:46`), required on a temporary flag and forbidden on a
  permanent one. `FeatureFlagRegistry` (`FeatureFlagRegistry.cs:35`) reads a host's own inventory off the
  `*Features` classes, and two fitness rules turn the date into a build gate:
  `ArchitectureRules.FeatureFlagsDeclareLifetime` (`ArchitectureRules.FeatureFlags.cs:28`) fails on a
  constant with no attribute, and `TemporaryFeatureFlagsAreNotPastRemoveBy` (`:70`) fails the day a
  temporary flag passes its date, naming the flag, the date and the owner. Both are exposed as facts on
  `FeatureFlagLifecycleTestsBase` (`:10`, the two facts at `:20-25`). The limits are real: like every
  fitness base, the gate exists only where a repo subclasses it, so a repo that has not still carries its
  flag debt uncounted (ADR-031), and a `Permanent` flag is deliberately outside the expiry check, so the
  judgement about whether a capability toggle has outlived its branch is still a human one.
- **Rollout bucketing is per user, but only as stable as the claim behind it.** Percentage and
  Targeting filters evaluate locally, so consistent assignment needs a targeting context, and the
  framework supplies one: `CurrentUserTargetingContextAccessor`
  (`CurrentUserTargetingContextAccessor.cs:54-55`) implements `ITargetingContextAccessor` and is wired by
  `AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()`
  (`MMCA.Common.API/DependencyInjection.cs:105-106`), so every host that goes through `AddAPI` buckets a
  given user the same way on every replica (ADR-031). The residual caveat is that the stickiness is only
  as stable as the identifier behind it: the accessor sets `UserId` from `FindUserIdValue()`
  (`CurrentUserTargetingContextAccessor.cs:86`), which reads the JWT `sub` claim
  (`AuthClaimTypes.Subject`, `AuthClaimTypes.cs:34`) and falls back to the mapped
  `ClaimTypes.NameIdentifier` (`ClaimsPrincipalExtensions.cs:26-28`) and then to `Identity.Name`. A filter
  configured with no targeting audience gains no stickiness from the accessor at all.
- **It is opt-in, and the pipeline side is adopted narrowly.** Exactly two use cases implement
  `IFeatureGated` across both apps, both of them commands: ADC's `RefreshFromSessionizeCommand`
  (`RefreshFromSessionizeCommand.cs:13`) and Store's `VerifyPaymentCommand` (`VerifyPaymentCommand.cs:20`).
  No query is gated. The flag inventory is wider than the pipeline usage: twelve flag-name constants
  across six `*Features` classes (Common's Notifications and Privacy, ADC's Conference and Engagement,
  Store's Catalog and Sales), every one of them annotated `Permanent`, with the rest enforced at the HTTP
  edge by `[FeatureGate]`. It is a capability the pipeline offers uniformly, not something every handler
  uses.

None of these are reasons to check flags inside handlers instead. They are the reasons to keep flag names
in one constant per module and to treat every flag as something you will later delete.

## Apply this even without MMCA

The pattern ports to any pipeline that already wraps its handlers (MediatR behaviors, an interceptor,
your own decorator chain):

1. Make feature gating **a marker interface with one property**, not a base-class method or an attribute
   the handler reads. The use case declares the flag name; it does not perform the check.
2. Put the gate **at the outermost position** so a disabled feature is rejected before logging, caching,
   validation, or a transaction. The cheapest request is the one you decline first.
3. **Manufacture a typed failure**, do not throw, when the flag is off. In a Result-based codebase that is
   a not-found value flowing back through the pipeline; the caller translates it to a `404`.
4. **Return not-found, never forbidden**, for a disabled feature, so turning a flag off hides the feature
   rather than announcing a capability behind a locked door.
5. **Name flags as constants next to the module** they belong to, matched to config keys, so a flag flips
   at config-and-restart and there are no magic strings in handlers.

The takeaway: **a feature flag is a cross-cutting concern, so put it where the other cross-cutting concerns
live. Gate the pipeline at its outermost edge with a one-property marker interface, and your handlers stay
flag-free, your kill switch rejects with zero wasted work, and a disabled feature simply is not there.**

---

**What we covered:** why a flag check inside a handler is a copy-paste cross-cutting concern, how
`IFeatureGated` plus the outermost `FeatureGateCommandDecorator` / `FeatureGateQueryDecorator` gate
commands and queries with zero handler involvement, how the same flag name is enforced at the HTTP edge by
`[FeatureGate]` and `DisabledFeatureHandler`, and why a disabled feature returns `404` rather than `403`.

**Previously in the series (Article 44):** HTTP API versioning, proven not just claimed, a header-based
setup with a fitness contract that proves two live versions coexist.

**Next in the series (Article 46):** Field-Level Encryption in EF Core: AES-GCM for PII Columns, encrypting
sensitive values at the property boundary so they are ciphertext at rest and plaintext only in the domain.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR behind this
pattern (ADR-031), or `dotnet add package MMCA.Common.Application` and gate your first command.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, C Sharp, Software Architecture, CQRS, Feature Flags*

*Notes: verified names and behaviors from THIS run.
`IFeatureGated` interface with sole member `string FeatureName { get; }`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Markers/IFeatureGated.cs:10,16`; the file lives
under `UseCases/Markers/`, namespace `MMCA.Common.Application.UseCases.Markers`, and the older
`UseCases/IFeatureGated.cs` path cited in the previous ledger does not exist).
`FeatureGateCommandDecorator<TCommand, TResult>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs:20`):
pass-through when `not IFeatureGated` (`:50-51`), `IFeatureManager.IsEnabledAsync(FeatureName)` (`:53`),
short-circuit with `Error.NotFoundError("Feature.Disabled", ...)` (`:56-59`), cached `CreateFailure`
delegate via `ResultFailureFactory.Build<TResult>()` (`:44-45`).
`FeatureGateQueryDecorator<TQuery, TResult>` is the identical shape on the query side
(`.../Decorators/FeatureGateQueryDecorator.cs:20,48-60`).
Registration as outermost decorator on both sides: command gate registered last (`DependencyInjection.cs:143`),
query gate registered last (`DependencyInjection.cs:151`) in `MMCA.Common.Application/DependencyInjection.cs`;
the full chains re-read this run are commands `TransactionalCommandDecorator` (`:137`), `TimeoutCommandDecorator`
(`:138`), `ValidatingCommandDecorator` (`:139`), `CachingCommandDecorator` (`:140`), `LoggingCommandDecorator`
(`:141`), `AuthorizationCommandDecorator` (`:142`), `FeatureGateCommandDecorator` (`:143`), and queries
`TimeoutQueryDecorator` (`:146`), `ValidatingQueryDecorator` (`:147`), `CachingQueryDecorator` (`:148`),
`LoggingQueryDecorator` (`:149`), `AuthorizationQueryDecorator` (`:150`), `FeatureGateQueryDecorator` (`:151`):
six query stages, with `Validating` between `Caching` and `Timeout`, drawn the same way in the XML doc at
`:79-85`; reverse-registration-order = outermost is ADR-014 (referenced via `group-05-cqrs-pipeline.md`).
HTTP edge: `AddHttpContextAccessor()` (`MMCA.Common.API/DependencyInjection.cs:104`),
`AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()` (`:105-106`) and
`AddSingleton<IDisabledFeaturesHandler, DisabledFeatureHandler>()` (`:107`) (built-in
Percentage/TimeWindow/Targeting filters noted in the surrounding comment, `:94-96`); `DisabledFeatureHandler`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13`) writes a
`404` RFC 9457 ProblemDetails titled "Feature not available" (`:18-26`); `[FeatureGate(...)]` on
`DevicesController`, confirmed this run as an MMCA.Common framework controller (namespace
`MMCA.Common.API.Controllers.Notifications`), not ADC-authored code
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:24`).
Flag-name constants, each preceded by its `[FeatureFlag(FeatureFlagLifetime.Permanent, Owner = ...)]`:
`SalesFeatures.PaymentVerification = "Sales.PaymentVerification"`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/SalesFeatures.cs:23`, attribute `:22`),
`ConferenceFeatures.SessionizeIntegration = "Conference.SessionizeIntegration"`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/ConferenceFeatures.cs:23`, attribute `:22`),
`NotificationFeatures.PushNotifications = "Notification.PushNotifications"`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/NotificationFeatures.cs:12`, attribute `:11`).
Real gated use cases: `VerifyPaymentCommand : ICacheInvalidating, IFeatureGated, IHasTimeout` with
`Timeout => TimeSpan.FromSeconds(20)` (`:29`) and `FeatureName => SalesFeatures.PaymentVerification` (`:35`)
(`MMCA.Store/.../Orders/UseCases/VerifyPayment/VerifyPaymentCommand.cs:20`);
`RefreshFromSessionizeCommand : ICacheInvalidating, ITransactional, IFeatureGated` with
`FeatureName => ConferenceFeatures.SessionizeIntegration`
(`MMCA.ADC/.../Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:13,19`).
Inventory counted this run: those two commands are the only `IFeatureGated` implementations in ADC and Store
and no query is gated; twelve flag constants live in six `*Features` classes (`NotificationFeatures.cs:12`,
`PrivacyFeatures.cs:12`, `CatalogFeatures.cs:21`, `SalesFeatures.cs:23`, `ConferenceFeatures.cs:23`,
`EngagementFeatures.cs:22,34,46,59,71,83,95`), all annotated `Permanent`.
Flag lifecycle, read this run: `[FeatureFlag]`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs:32`) with `Lifetime` (`:38`),
`RemoveBy` (`:46`, ISO format constant `:35`, parser `:60`) and `Owner` (`:52`); `FeatureFlagLifetime`
(`FeatureFlagLifetime.cs:9`, `Permanent` `:15`, `Temporary` `:21`); `FeatureFlagRegistry`
(`FeatureFlagRegistry.cs:35`); the two fitness rules `ArchitectureRules.FeatureFlagsDeclareLifetime`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.FeatureFlags.cs:28`)
and `TemporaryFeatureFlagsAreNotPastRemoveBy` (`:70`), exposed as facts on `FeatureFlagLifecycleTestsBase`
(`.../Bases/Governance/FeatureFlagLifecycleTestsBase.cs:10`, facts `:20-25`, `protected virtual Today` `:18`).
Conventions and trade-offs from `Website/docs-src/adr/031-feature-flag-management.md`: the `404` convention
reusing the not-found edge (`:55-57`), two surfaces agree only by convention with no fitness rule (`:60-62`),
flag debt now says the expiry check ships and adoption is per repo (`:63-66`), missing key resolves to
disabled and is fail-safe (`:67-69`). The record carries three revisions in its Status (2026-08-18 `:4-6`,
2026-08-31 `:6-8`, 2026-09-11 `:10-14`); the flag-debt trade-off was rewritten this run against the
Revision (2026-09-11) section (`:117-158`), and the targeting caveat against the narrowing paragraph
(`:105-108`). The targeting identifier is the JWT `sub` claim (`AuthClaimTypes.Subject`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:34`) read through `FindUserIdValue()`
(`ClaimsPrincipalExtensions.cs:26-28`, falling back to the mapped `ClaimTypes.NameIdentifier`), used at
`CurrentUserTargetingContextAccessor.cs:86` with a final fallback to `Identity.Name`; the accessor implements
`ITargetingContextAccessor` at
`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs:54-55`.
There is no `user_id` claim or constant in the accessor; the previous ledger's `user_id` reading was wrong.
The single code block is an illustrative composite: the `IFeatureGated` body and the `HandleAsync` body are
verbatim source; `VerifyPaymentCommand` is a real gated command shown with its three markers and its
20-second timeout; the three are shown together for reading, not as one contiguous file. Rubric tag moved
from §10 to §6 (CQRS & Event-Driven Design, `Website/docs-src/governance/ArchitectureEvaluationCriteria.md:229`),
because rubric v2 replaced §10 with Messaging & Integration Architecture and scores the former
Cross-Cutting Concerns facets in §5, §6, §9, §12, §17 and §29 (`:15-18`), with §10 itself pointing at §6 for
the in-process command/query pipeline (`:331`).*

- Full series index: https://ivanball.github.io/writing.html
