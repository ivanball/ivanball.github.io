# Feature Flags in the CQRS Pipeline: Gate Commands, Not Code

> Series: MMCA.Common · Article #45 (deep-dive) · Pillar P2 · Group G05 · Rubric §6 · ADR-031 ·
> Status: grounded in `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs`,
> `FeatureGateQueryDecorator.cs`, `UseCases/Markers/IFeatureGated.cs`, `MMCA.Common.Application/DependencyInjection.cs`,
> `MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs`, `FeatureFlagRegistry.cs`,
> `MMCA.Common.Testing.Architecture/Bases/Governance/FeatureFlagLifecycleTestsBase.cs`,
> `MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs`,
> `MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs`, `MMCA.Common.API/DependencyInjection.cs`,
> `MMCA.Common.API/Middleware/ErrorHttpMapping.cs`, `MMCA.Common.Infrastructure/FeatureFlags/StoredOverrideFeatureDefinitionProvider.cs`,
> `Website/docs-src/adr/031-feature-flag-management.md`, `Website/docs-src/onboarding/group-05-cqrs-pipeline.md`,
> and the real gated use cases in ADC and Store. No em dashes.

**Subtitle:** Decoupling release from deploy means shipping code dark and flipping a switch. Here is how
MMCA.Common gates commands and queries with feature flags at the front of the decorator pipeline, so a
handler never checks a flag itself, and a disabled feature is rejected before any work runs.

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
front of the pipeline, and a one-property marker interface that a use case implements to opt in.

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

## The MMCA answer: a front-of-pipeline decorator plus a marker interface

The whole mechanism is two small types plus a registration.

The opt-in signal is `IFeatureGated` (`UseCases/Markers/IFeatureGated.cs:10`), an interface with exactly
one member, `string FeatureName { get; }` (`IFeatureGated.cs:16`). A command or query implements it to
declare "I am gated behind this flag." The name has to match a key in the `"FeatureManagement"`
configuration section.

The enforcement is a pair of decorators, one per handler side. `FeatureGateCommandDecorator<TCommand,
TResult>` (`FeatureGateCommandDecorator.cs:21`) wraps `ICommandHandler`, and its query twin
`FeatureGateQueryDecorator<TQuery, TResult>` (`FeatureGateQueryDecorator.cs:20`) wraps `IQueryHandler`.
Both do the identical three-step thing in `HandleAsync`:

1. If the command or query is `not IFeatureGated`, call the inner handler and return
   (`FeatureGateCommandDecorator.cs:51-52`). A use case that does not opt in pays nothing.
2. If it is gated, check `featureManager.IsEnabledAsync(featureGated.FeatureName)`
   (`FeatureGateCommandDecorator.cs:54`). Enabled means delegate to the inner handler as normal.
3. If the flag is off, short-circuit: build and return a failure result carrying
   `Error.NotFoundError("Feature.Disabled", ...)` (`FeatureGateCommandDecorator.cs:60-63`), without ever
   invoking the handler.

Manufacturing that typed failure is the one subtle piece. `TResult` is unconstrained (it is `Result` for
some handlers and `Result<T>` for others), so the decorator cannot just `new` up a failure. It holds a
static delegate field, `_createFailure` (`FeatureGateCommandDecorator.cs:39`), filled once per closed
generic type by the `CreateFailure()` accessor through `ResultFailureFactory.Build`
(`FeatureGateCommandDecorator.cs:45-46`), which turns an error list into the right `TResult` failure with no
per-call reflection. The field is built on the first short-circuit, not eagerly, so the happy path never
touches it (`FeatureGateCommandDecorator.cs:30-38`).

The last, load-bearing detail is where the decorator sits. In `AddApplicationDecorators` the feature gate
is the last standard decorator registered on the query side (`DependencyInjection.cs:167`), and on the
command side it is registered just before `ViewAsCommandDecorator` (`:158`, then `:159`). Because the
pipeline applies decorators in reverse registration order (ADR-014), last-registered is outermost: the
feature gate is the outermost query decorator, and on commands it sits directly inside the view-as guard,
which refuses every command from a read-only view-as caller before the flag is read (ADR-137;
`FeatureGateCommandDecorator.cs:14-16`). A command runs view-as, feature gate, authorization, logging,
caching, validation, timeout, transaction, handler (`DependencyInjection.cs:79-87`); a query runs feature
gate, authorization, logging, caching, validation, timeout, handler (`:93-99`). An opt-in MiniProfiler pair
(`AddApplicationProfiling`, `:179-182`) can wrap the whole chain for diagnostics when a host turns it on;
nothing else stands in front. A disabled feature is rejected with zero downstream work: no permission
check, no log scope, no cache touch, no validator, no timeout budget, no `BEGIN TRANSACTION`.

Here is the shape, drawn from the real decorator and two real gated use cases:

```csharp
// The opt-in marker (IFeatureGated.cs)
public interface IFeatureGated
{
    string FeatureName { get; }  // must match a "FeatureManagement" config key
}

// A real gated command (VerifyPaymentCommand.cs, Store Sales)
public sealed record VerifyPaymentCommand(OrderIdentifierType OrderId)
    : ICacheInvalidating<Order>, IFeatureGated, IHasTimeout
{
    public TimeSpan Timeout => TimeSpan.FromSeconds(20);
    public string FeatureName => SalesFeatures.PaymentVerification;  // "Sales.PaymentVerification"
}

// The feature-gate decorator, the whole enforcement (FeatureGateCommandDecorator.cs)
public async Task<TResult> HandleAsync(TCommand command, CancellationToken cancellationToken = default)
{
    if (command is not IFeatureGated featureGated)
        return await inner.HandleAsync(command, cancellationToken).ConfigureAwait(false);

    if (await featureManager.IsEnabledAsync(featureGated.FeatureName).ConfigureAwait(false))
        return await inner.HandleAsync(command, cancellationToken).ConfigureAwait(false);

    // The message reaches the user verbatim, so it is the generic wording DisabledFeatureHandler
    // uses for a [FeatureGate] endpoint; the flag name is internal and stays out of it. Clients
    // branch on the Feature.Disabled code.
    var createFailure = CreateFailure();
    return createFailure([Error.NotFoundError(
        "Feature.Disabled",
        "The requested feature is not currently available.")]);
}
```

(This block is a faithful composite: the interface and the `HandleAsync` body are verbatim from source,
and `VerifyPaymentCommand` is a real gated command, shown together so the opt-in and the enforcement read
in one place. See the Notes ledger for the exact files and lines.)

Two things make this more than a toy. First, the provider is real: `AddAPI` registers
`services.AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()` plus the
disabled-response handler (`MMCA.Common.API/DependencyInjection.cs:107-110`), which brings the built-in
Percentage, TimeWindow, and Targeting filters, with the Targeting filter's per-user audience already
supplied, so "roll this out to 10 percent of users" is a config change (a Targeting rollout with a
`DefaultRolloutPercentage`), not a code change. Second, flag
names are module constants, not magic strings scattered through handlers: `SalesFeatures.PaymentVerification`
= `"Sales.PaymentVerification"` (`SalesFeatures.cs:23`), `ConferenceFeatures.SessionizeIntegration` =
`"Conference.SessionizeIntegration"` (`ConferenceFeatures.cs:23`), `NotificationFeatures.PushNotifications`
= `"Notification.PushNotifications"` (`NotificationFeatures.cs:12`). ADC's `RefreshFromSessionizeCommand`
gates the Sessionize sync this way (`RefreshFromSessionizeCommand.cs:15,18`), ADC's
`ScoreEventSessionsInternalCommand` gates the paid AI session-scoring pass
(`ScoreEventSessionsInternalCommand.cs:37,47`), and Store's `VerifyPaymentCommand`
gates the direct Stripe verification path (`VerifyPaymentCommand.cs:20,32`).

## The second surface, and why disabled means 404

A feature can be reachable from the CQRS pipeline, but it can also be reachable straight from an MVC
action that never dispatches a command. So the same flag name is enforced at a second, independent
surface at the HTTP edge (ADR-031). There you put `[FeatureGate("X")]` (from `Microsoft.FeatureManagement.Mvc`)
on the controller or action; the framework's own push-device controller carries
`[FeatureGate(NotificationFeatures.PushNotifications)]` on the class
(`MMCA.Common.API/Controllers/Notifications/DevicesController.cs:24`), not app-specific code in ADC.
When the flag is off, `DisabledFeatureHandler`
(`DisabledFeatureHandler.cs:14`) writes an RFC 9457 ProblemDetails response with status
`404 Not Found`, the title `"Feature not available"` and the detail
`"The requested feature is not currently available."` (`DisabledFeatureHandler.cs:19-27`).

Both surfaces agree on one convention that is worth stating plainly: a disabled feature returns
not-found, never `403 Forbidden`. The pipeline decorator short-circuits with `ErrorType.NotFound`; the
edge handler returns `404`. Neither answer looks like a permissions problem, but neither body is
anonymous either (ADR-031). The edge body is titled "Feature not available" (`DisabledFeatureHandler.cs:22`).
The CQRS failure travels through the Result to ProblemDetails mapping, whose `errors` extension serializes
each error's code and message (`ErrorHttpMapping.cs:65-74`), with the message localized by code
(`:69`) through the `IErrorLocalizer` that `AddAPI` always registers (`MMCA.Common.API/DependencyInjection.cs:113`,
`:128`). Under the default culture the caller sees the `Feature.Disabled` code and the same generic
"The requested feature is not currently available." wording the edge uses as its detail
(`FeatureGateCommandDecorator.cs:61-63`). Under a Spanish request culture the CQRS message comes back
translated (`ErrorResources.es.resx:205-206`) while the edge detail stays in English
(`DisabledFeatureHandler.cs:23`), so the two bodies agree on meaning rather than on exact words. The flag name stays out of the message on purpose, because the
message reaches the user verbatim and the name is internal; clients branch on the code
(`FeatureGateCommandDecorator.cs:57-59`). Turning a flag off makes the feature answer not-found and say
that a feature is unavailable, not report a locked door.

## Trade-offs, honestly

- **The two surfaces must be kept in agreement by hand.** Gating the controller but not the command (or
  the reverse) leaves a half-protected feature reachable through the entry you missed. ADR-031 is explicit
  that no fitness rule asserts both are wired, so coherence is a convention and an audit concern, not
  something the build enforces.
- **A missing config key resolves to disabled, unless a stored override defines the flag.** `IsEnabledAsync`
  returns false for a name that is not in the `"FeatureManagement"` section. That is the right default for
  a kill switch (fail safe), but it also means forgetting to add the key in a given service silently hides
  a feature you meant to ship. Per service, the flag has to be present. The one exception is opt-in: a host
  that calls `AddReloadableFeatureFlags` (`MMCA.Common.Infrastructure/DependencyInjection.FeatureFlags.cs:47`)
  layers `StoredOverrideFeatureDefinitionProvider` over the configured provider, which answers a flag from
  its stored override first (`StoredOverrideFeatureDefinitionProvider.cs:43-50`, override branch `:45-49`),
  also yields overrides that configuration never mentions (`:65-69`), and makes a flip take effect on the
  next evaluation with no restart (`:16-18`). There a missing key means off only while no override exists
  (ADR-031). ADC's Conference and Engagement services opt in (`MMCA.ADC.Conference.Service/Program.cs:309`,
  `MMCA.ADC.Engagement.Service/Program.cs:130`); Store does not.
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
  fitness base, the gate exists only where a repo subclasses it (all four repos do: Common and ADC and
  Store each in a `FeatureFlagLifecycleTests` class, Helpdesk in `ArchitectureTests.cs:210`, ADR-031), so
  adoption stays a per-repo choice, and a `Permanent` flag is deliberately outside the expiry check, so the
  judgement about whether a capability toggle has outlived its branch is still a human one.
- **Rollout bucketing is per user only through the Targeting filter, and only as stable as the claim
  behind it.** Filters evaluate locally in each process, so consistent assignment needs a targeting
  context, and the framework supplies one: `CurrentUserTargetingContextAccessor`
  (`CurrentUserTargetingContextAccessor.cs:68-69`) implements `ITargetingContextAccessor` and is wired by
  `AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()`
  (`MMCA.Common.API/DependencyInjection.cs:108-109`), so in every host that goes through `AddAPI` a
  Targeting-filter rollout gives a given user the same answer on every replica. The built-in Percentage
  filter never reads that context: it activates on a random percentage at each evaluation, so a
  Percentage-filter flag can flip between requests for the same user, and a rollout that must be sticky
  uses Targeting with a `DefaultRolloutPercentage` (ADR-031). The residual caveat is that the stickiness
  is only as stable as the identifier behind it: the accessor sets `UserId` from `FindUserIdValue()`
  (`CurrentUserTargetingContextAccessor.cs:121`), which reads the JWT `sub` claim
  (`AuthClaimTypes.Subject`, `AuthClaimTypes.cs:34`) and falls back to the mapped
  `ClaimTypes.NameIdentifier` (`ClaimsPrincipalExtensions.cs:26-28`) and then to `Identity.Name`. Groups
  are the caller's role claims plus, when the request has resolved a tenant, the group `tenant:<tenantId>`
  (`:110-117`, `ResolveTenantGroups` at `:128-132`), so an audience group such as `tenant:acme` turns a
  flag on for one tenant. An anonymous caller gets no user id and only that tenant group, if any
  (`:101-108`), so it matches no named user or role, and a targeted feature is off for it unless the
  audience opts everyone in or names its tenant (`:37-39`).
- **It is opt-in, and the pipeline side is adopted narrowly.** Three use cases implement
  `IFeatureGated` across both apps, all of them commands: ADC's `RefreshFromSessionizeCommand`
  (`RefreshFromSessionizeCommand.cs:15`) and `ScoreEventSessionsInternalCommand`
  (`ScoreEventSessionsInternalCommand.cs:37`), and Store's `VerifyPaymentCommand` (`VerifyPaymentCommand.cs:20`).
  The scoring command is a durable internal command that the framework's processor runs through the same
  decorator pipeline, because the dispatcher resolves the decorated `ICommandHandler` from the container
  (`InternalCommandDispatcher.cs:11-18`). The processor completes a queued row only on success
  (`InternalCommandProcessor.cs:468-472`), so with the flag off the gate's failure is treated like any
  other failed `Result`: the row spends an attempt and is rescheduled with backoff, then dead-lettered as
  `attempts_exhausted` once the attempt budget is spent (`:477`, method `:489`, `:515`, `:521`). Its trigger endpoint also carries
  `[FeatureGate(ConferenceFeatures.SessionScoring)]` (`SessionSelectionController.cs:135`), so that flag is
  enforced at both surfaces. No query is gated. The flag inventory is wider than the pipeline usage:
  fourteen flag-name constants
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
2. Put the gate **at the front of the pipeline** (outermost, or directly inside a guard that refuses every
   request first) so a disabled feature is rejected before logging, caching, validation, or a transaction.
   The cheapest request is the one you decline first.
3. **Manufacture a typed failure**, do not throw, when the flag is off. In a Result-based codebase that is
   a not-found value flowing back through the pipeline; the caller translates it to a `404`.
4. **Return not-found, never forbidden**, for a disabled feature, and say in the body that the feature is
   unavailable, so turning a flag off reads as "not here right now" rather than a capability behind a locked door.
5. **Name flags as constants next to the module** they belong to, matched to config keys, so a flag flips
   at config-and-restart and there are no magic strings in handlers.

The takeaway: **a feature flag is a cross-cutting concern, so put it where the other cross-cutting concerns
live. Gate the pipeline at its front with a one-property marker interface, and your handlers stay
flag-free, your kill switch rejects with zero wasted work, and a disabled feature answers not-found before
any of it runs.**

---

**What we covered:** why a flag check inside a handler is a copy-paste cross-cutting concern, how
`IFeatureGated` plus the front-of-pipeline `FeatureGateCommandDecorator` / `FeatureGateQueryDecorator` gate
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

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (prior runs 2026-10-29, 2026-10-22,
2026-10-08 and 2026-10-02). 2026-11-25 entry, body corrections: (1) Decorator position. The command
chain registers `FeatureGateCommandDecorator` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:158`)
and then `ViewAsCommandDecorator` (`:159`), so ViewAs is outermost on commands and the feature gate sits
directly inside it (decorator doc `FeatureGateCommandDecorator.cs:14-16`; nesting doc `DependencyInjection.cs:79-87`;
ADR-031 Revision (2026-11-23) item 1, `Website/docs-src/adr/031-feature-flag-management.md:408-416`, and
Decision bullet `:63-71`). The query chain still ends with `FeatureGateQueryDecorator` (`:167`, doc `:93-99`).
The subtitle, the opening, the section heading, the registration paragraph, Apply item 2, the takeaway and
the recap were reworded from "outermost" to "front of the pipeline". The optional `ProfilingCommandDecorator`
/ `ProfilingQueryDecorator` pair is registered by `AddApplicationProfiling` (`:179-182`); it is outermost only
when a host enables `ApplicationSettings:UseMiniProfiler` (per `MMCA.Common/AGENTS.md`, the
`AddMmcaServiceHost` call site was not read this run), so the registration paragraph names it as an opt-in
wrapper. (2) Code block: `VerifyPaymentCommand` is `ICacheInvalidating<Order>, IFeatureGated, IHasTimeout`
with no `CachePrefix` member
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/VerifyPayment/VerifyPaymentCommand.cs:20`,
`Timeout` 20 s `:29`, `FeatureName` `:32`); the `CachePrefix` line was dropped. (3) Missing-key trade-off
qualified for the opt-in stored-override layer: `AddReloadableFeatureFlags`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.FeatureFlags.cs:47`),
`StoredOverrideFeatureDefinitionProvider` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/FeatureFlags/StoredOverrideFeatureDefinitionProvider.cs:43-50`,
override branch `:45-49`, enumeration of config-unknown overrides `:65-69`, no-restart remark `:16-18`),
ADR-031 Trade-offs `:107-114` and Decision `:79-83`; adopted at
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:309` and
`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:130`; no `AddReloadableFeatureFlags` call
under `MMCA.Store/Source`. Apply item 5 stays generic advice. (4) Targeting: the accessor adds
`tenant:<tenantId>` to the groups (`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs:110-117`,
`ResolveTenantGroups` `:128-132`, `TenantGroupPrefix` `:75`), and an anonymous caller gets `UserId = null`
with only the tenant group (`:101-108`, doc `:37-39`; ADR-031 Trade-offs `:115-128` and Revision
(2026-11-07) `:305`); the "empty context" sentence was replaced. (5) Count: fourteen flag-name constants,
not thirteen. `EngagementFeatures` holds eight
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/EngagementFeatures.cs:22,34,46,59,71,83,95,108`,
each preceded by `[FeatureFlag(FeatureFlagLifetime.Permanent, Owner = "ADC Engagement")]`, `Tickets` =
`"Engagement.Tickets"` at `:108`, attribute `:107`). The other six: `NotificationFeatures.cs:12`,
`PrivacyFeatures.cs:12` (Common Shared), `ConferenceFeatures.cs:23,38` (ADC), `CatalogFeatures.cs:21`,
`SalesFeatures.cs:23` (Store), carried from the 2026-10-02 count and not re-read this run.
Re-anchored this run (all read): `FeatureGateCommandDecorator<TCommand, TResult>` `:21`, pass-through
`:51-52`, `IsEnabledAsync` `:54`, `CreateFailure()` `:60`, `Error.NotFoundError` with the generic message
`:61-63`, source comment `:57-59`, `_createFailure` `:39`, accessor `:45-46`, remarks `:30-38`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs`).
`AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs`): built-in filters
comment `:97-98`, `AddHttpContextAccessor` `:107`, `WithTargeting` `:108-109`, `IDisabledFeaturesHandler`
`:110`, `AddErrorLocalization()` `:113`, `TryAddSingleton<IErrorLocalizer, ErrorLocalizer>` `:128`.
`BuildErrorsExtension` `:65-74`, localized `Message` `:69`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs`). Spanish
`Feature.Disabled` at `MMCA.Common/Source/Presentation/MMCA.Common.API/Resources/ErrorResources.es.resx:205-206`.
Accessor class `CurrentUserTargetingContextAccessor.cs:68-69`, `UserId` `:121`.
`RefreshFromSessionizeCommand : ICacheInvalidating<Event>, IFeatureGated`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:15`,
`FeatureName` `:18`). `ScoreEventSessionsInternalCommand : IInternalCommand, IRequiresPermission, IHasTimeout, IFeatureGated`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommand.cs:37`,
`FeatureName` `:47`); its XML doc agrees with the processor (`:44`: retries with backoff and dead-letters
at `InternalCommands:MaxAttempts`), so the earlier doc-contradiction note is retired. Trigger endpoint
`[FeatureGate(ConferenceFeatures.SessionScoring)]` at
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:135`.
`InternalCommandProcessor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandProcessor.cs`):
success branch `:468-472` (`IsSuccess` `:468`, `CompleteAsync` `:470`), `RecordFailedAttemptAsync` call `:477`,
method `:489`, `attempts_exhausted` dead-letter `:515`, `ScheduleRetryAsync` `:521`.
`Microsoft.FeatureManagement` 4.8.0 is pinned at `MMCA.Common/Directory.Packages.props:88` (package source
not read; the Percentage-is-random claim rests on ADR-031 Trade-offs `:125-128`). ADR-031 anchors: HTTP
edge Decision `:57-62`, CQRS Decision `:63-71`, 404 convention `:72-78`, flag constants `:79-84`,
Trade-offs `:98-128` (two surfaces `:99-101`, flag debt and four-repo adoption `:102-106`, per-service
configuration plus overrides `:107-114`, Targeting only sticky `:115-128`), Revision (2026-10-26) `:268`,
Revision (2026-11-07) `:305`, Revision (2026-11-08) `:327`, Revision (2026-11-23) `:402`.
Carried from prior runs, not re-read this run (the findings audit confirmed them): `IFeatureGated.cs:10,16`;
`FeatureGateQueryDecorator.cs:20` (`_createFailure` `:38`, accessor `:44-45`, remarks `:29-37`,
`HandleAsync` `:48-62`, `Error.NotFoundError` `:59-61`, the last also cited at ADR-031 `:78`);
`DisabledFeatureHandler.cs:14`, result `:19-27` (ADR-031 `:59`), `Title` `:22`, `Detail` `:23`;
`DevicesController.cs:24`; `Error.cs:56` (`NotFoundError` yields `ErrorType.NotFound`);
`InternalCommandDispatcher.cs:11-18`; `AuthClaimTypes.cs:34`; `ClaimsPrincipalExtensions.cs:26-28`;
the flag lifecycle anchors `FeatureFlagAttribute.cs:32,38,46,52`, `FeatureFlagLifetime.cs:15,21`,
`FeatureFlagRegistry.cs:35`, `ArchitectureRules.FeatureFlags.cs:28,70`, `FeatureFlagLifecycleTestsBase.cs:10,20-25`;
and the four lifecycle subclasses
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/FeatureFlagLifecycleTests.cs:13`,
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/FeatureFlagLifecycleTests.cs:9`,
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/FeatureFlagLifecycleTests.cs:9`,
`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:210`).
The single code block is an illustrative composite: the `IFeatureGated` body and the `HandleAsync` body are
verbatim source, including the three-line source comment (re-checked this run against
`FeatureGateCommandDecorator.cs:49-64`); `VerifyPaymentCommand` is a real gated command shown with its three
markers, its 20-second timeout and its flag name; the three are shown together for reading, not as one
contiguous file. Reverse-registration-order = outermost is ADR-014 (referenced via `group-05-cqrs-pipeline.md`);
the view-as guard is ADR-137. Rubric tag §6 (CQRS & Event-Driven Design,
`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:229`): rubric v2 replaced §10 with Messaging &
Integration Architecture and scores the former Cross-Cutting Concerns facets in §5, §6, §9, §12, §17 and §29
(`:15-18`), with §10 itself pointing at §6 for the in-process command/query pipeline (`:331`); carried, not
re-read this run.*

- Full series index: https://ivanball.github.io/writing.html
