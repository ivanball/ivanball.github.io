# Feature Flags in the CQRS Pipeline: Gate Commands, Not Code

> Series: MMCA.Common · Article #45 (deep-dive) · Pillar P2 · Group G05 · Rubric §6 · ADR-031 ·
> Status: grounded in `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs`,
> `FeatureGateQueryDecorator.cs`, `UseCases/Markers/IFeatureGated.cs`, `MMCA.Common.Application/DependencyInjection.cs`,
> `MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs`, `FeatureFlagRegistry.cs`,
> `MMCA.Common.Testing.Architecture/Bases/Governance/FeatureFlagLifecycleTestsBase.cs`,
> `MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs`,
> `MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs`, `MMCA.Common.API/DependencyInjection.cs`,
> `MMCA.Common.API/Middleware/ErrorHttpMapping.cs`, `Website/docs-src/adr/031-feature-flag-management.md`, `Website/docs-src/onboarding/group-05-cqrs-pipeline.md`,
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
   `Error.NotFoundError("Feature.Disabled", ...)` (`FeatureGateCommandDecorator.cs:59-62`), without ever
   invoking the handler.

Manufacturing that typed failure is the one subtle piece. `TResult` is unconstrained (it is `Result` for
some handlers and `Result<T>` for others), so the decorator cannot just `new` up a failure. It holds a
static delegate field, `_createFailure` (`FeatureGateCommandDecorator.cs:38`), filled once per closed
generic type by the `CreateFailure()` accessor through `ResultFailureFactory.Build`
(`FeatureGateCommandDecorator.cs:44-45`), which turns an error list into the right `TResult` failure with no
per-call reflection. The field is built on the first short-circuit, not eagerly, so the happy path never
touches it (`FeatureGateCommandDecorator.cs:29-37`).

The last, load-bearing detail is where the decorator sits. In `AddApplicationDecorators` the feature gate
is registered last on both sides (`DependencyInjection.cs:140` for commands, `:148` for queries). Because
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
disabled-response handler (`MMCA.Common.API/DependencyInjection.cs:104-107`), which brings the built-in
Percentage, TimeWindow, and Targeting filters, with the Targeting filter's per-user audience already
supplied, so "roll this out to 10 percent of users" is a config change (a Targeting rollout with a
`DefaultRolloutPercentage`), not a code change. Second, flag
names are module constants, not magic strings scattered through handlers: `SalesFeatures.PaymentVerification`
= `"Sales.PaymentVerification"` (`SalesFeatures.cs:23`), `ConferenceFeatures.SessionizeIntegration` =
`"Conference.SessionizeIntegration"` (`ConferenceFeatures.cs:23`), `NotificationFeatures.PushNotifications`
= `"Notification.PushNotifications"` (`NotificationFeatures.cs:12`). ADC's `RefreshFromSessionizeCommand`
gates the Sessionize sync this way (`RefreshFromSessionizeCommand.cs:15,21`), ADC's
`ScoreEventSessionsInternalCommand` gates the paid AI session-scoring pass
(`ScoreEventSessionsInternalCommand.cs:39,48`), and Store's `VerifyPaymentCommand`
gates the direct Stripe verification path (`VerifyPaymentCommand.cs:20,35`).

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
each error's code and message (`ErrorHttpMapping.cs:62-70`), with the message localized by code
(`:66`) through the `IErrorLocalizer` that `AddAPI` always registers (`MMCA.Common.API/DependencyInjection.cs:110`,
`:125`). Under the default culture the caller sees the `Feature.Disabled` code and the same generic
"The requested feature is not currently available." wording the edge uses as its detail
(`FeatureGateCommandDecorator.cs:60-62`). Under a Spanish request culture the CQRS message comes back
translated (`ErrorResources.es.resx:196-197`) while the edge detail stays in English
(`DisabledFeatureHandler.cs:23`), so the two bodies agree on meaning rather than on exact words. The flag name stays out of the message on purpose, because the
message reaches the user verbatim and the name is internal; clients branch on the code
(`FeatureGateCommandDecorator.cs:56-58`). Turning a flag off makes the feature answer not-found and say
that a feature is unavailable, not report a locked door.

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
  fitness base, the gate exists only where a repo subclasses it (all four repos do: Common and ADC and
  Store each in a `FeatureFlagLifecycleTests` class, Helpdesk in `ArchitectureTests.cs:210`, ADR-031), so
  adoption stays a per-repo choice, and a `Permanent` flag is deliberately outside the expiry check, so the
  judgement about whether a capability toggle has outlived its branch is still a human one.
- **Rollout bucketing is per user only through the Targeting filter, and only as stable as the claim
  behind it.** Filters evaluate locally in each process, so consistent assignment needs a targeting
  context, and the framework supplies one: `CurrentUserTargetingContextAccessor`
  (`CurrentUserTargetingContextAccessor.cs:54-55`) implements `ITargetingContextAccessor` and is wired by
  `AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()`
  (`MMCA.Common.API/DependencyInjection.cs:105-106`), so in every host that goes through `AddAPI` a
  Targeting-filter rollout gives a given user the same answer on every replica. The built-in Percentage
  filter never reads that context: it activates on a random percentage at each evaluation, so a
  Percentage-filter flag can flip between requests for the same user, and a rollout that must be sticky
  uses Targeting with a `DefaultRolloutPercentage` (ADR-031). The residual caveat is that the stickiness
  is only as stable as the identifier behind it: the accessor sets `UserId` from `FindUserIdValue()`
  (`CurrentUserTargetingContextAccessor.cs:86`), which reads the JWT `sub` claim
  (`AuthClaimTypes.Subject`, `AuthClaimTypes.cs:34`) and falls back to the mapped
  `ClaimTypes.NameIdentifier` (`ClaimsPrincipalExtensions.cs:26-28`) and then to `Identity.Name`. An
  anonymous caller gets an empty context (`:67-74`), so it matches no named user or group.
- **It is opt-in, and the pipeline side is adopted narrowly.** Three use cases implement
  `IFeatureGated` across both apps, all of them commands: ADC's `RefreshFromSessionizeCommand`
  (`RefreshFromSessionizeCommand.cs:15`) and `ScoreEventSessionsInternalCommand`
  (`ScoreEventSessionsInternalCommand.cs:39`), and Store's `VerifyPaymentCommand` (`VerifyPaymentCommand.cs:20`).
  The scoring command is a durable internal command that the framework's processor runs through the same
  decorator pipeline, because the dispatcher resolves the decorated `ICommandHandler` from the container
  (`InternalCommandDispatcher.cs:11-18`). The processor completes a queued row only on success
  (`InternalCommandProcessor.cs:415-421`), so with the flag off the gate's failure is treated like any
  other failed `Result`: the row spends an attempt and is rescheduled with backoff, then dead-lettered as
  `attempts_exhausted` once the attempt budget is spent (`:423-425`, `:450-461`). Its trigger endpoint also carries
  `[FeatureGate(ConferenceFeatures.SessionScoring)]` (`SessionSelectionController.cs:134`), so that flag is
  enforced at both surfaces. No query is gated. The flag inventory is wider than the pipeline usage:
  thirteen flag-name constants
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
4. **Return not-found, never forbidden**, for a disabled feature, and say in the body that the feature is
   unavailable, so turning a flag off reads as "not here right now" rather than a capability behind a locked door.
5. **Name flags as constants next to the module** they belong to, matched to config keys, so a flag flips
   at config-and-restart and there are no magic strings in handlers.

The takeaway: **a feature flag is a cross-cutting concern, so put it where the other cross-cutting concerns
live. Gate the pipeline at its outermost edge with a one-property marker interface, and your handlers stay
flag-free, your kill switch rejects with zero wasted work, and a disabled feature answers not-found before
any of it runs.**

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

*Notes: verified names and behaviors from THIS run (2026-10-29, MMCA.Common v1.265.1; prior runs
2026-10-22 at v1.250.0, 2026-10-08 at v1.233.0 and 2026-10-02 at v1.221.0). 2026-10-29 entry (v1.265.1):
ADR-031's Revision (2026-10-26) (`Website/docs-src/adr/031-feature-flag-management.md:242-277`) restates
the targeting trade-off, so two body passages were corrected. The `AddAPI` paragraph and the rollout
trade-off previously credited the Percentage filter with per-user stickiness; only the Targeting filter
reads the context (accessor XML doc `CurrentUserTargetingContextAccessor.cs:8-14`, ADR-031 `:91-102`),
the Percentage filter is random per evaluation, and a sticky rollout uses Targeting with
`DefaultRolloutPercentage` (the `Microsoft.FeatureManagement` 4.8.0 package source, pinned at
`MMCA.Common/Directory.Packages.props:32`, was not read; the claim rests on ADR-031). The anonymous
empty-context sentence (`:67-74`) replaces the previous "no targeting audience" sentence. The flag-debt
bullet previously said a repo that has not subclassed the gate carries its debt uncounted, which reads
as if one had not; all four repos subclass `FeatureFlagLifecycleTestsBase`
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/FeatureFlagLifecycleTests.cs:13`,
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/FeatureFlagLifecycleTests.cs:9`,
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/FeatureFlagLifecycleTests.cs:9`,
`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:210`). The
`AddAPI` registration (`DependencyInjection.cs:104-107`, comment `:94-96`) and the accessor anchors
(`:54-55`, `:86`) were re-read and hold. ADR-031 anchors refreshed (see below). 2026-10-22 entry (v1.250.0): every anchor below was
re-read against current source this run and holds unchanged, except the ADR-031 anchors, which all moved
down one line after its 2026-10-21 Status line (see below). Two body corrections: (1) the scoring-command
sentence previously said a flag-off failure completes the queued row rather than retrying it, citing the
command's XML doc (`ScoreEventSessionsInternalCommand.cs:41-47`), which still says so; the processor does
not do that. `InternalCommandDispatcher` resolves the closed, decorated `ICommandHandler<TCommand, Result>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandDispatcher.cs:11-18`,
`:75`); `InternalCommandProcessor` completes a row only when `IsSuccess` is true (`InternalCommandProcessor.cs:415-421`)
and sends every failed `Result` to `RecordFailedAttemptAsync` (`:423-425`, method `:435-462`), which
dead-letters as `attempts_exhausted` at `MaxAttempts` (`:450-456`) and otherwise schedules a retry
(`:459`); nothing special-cases `Feature.Disabled`. (2) The localization clause previously read "when the
host registers an `IErrorLocalizer`"; `AddAPI` always calls `AddErrorLocalization()`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:110`), which `TryAddSingleton`s
`IErrorLocalizer` (`:125`), and `ErrorResources.es.resx:196-197` translates `Feature.Disabled` while
`DisabledFeatureHandler.cs:23` hardcodes English, so the identical-wording claim is scoped to the default
culture. 2026-10-08 entry (v1.233.0): the CQRS disabled message is the generic
"The requested feature is not currently available." in both decorators
(`FeatureGateCommandDecorator.cs:60-62`, `FeatureGateQueryDecorator.cs:59-61`), with the reason in a
source comment (`FeatureGateCommandDecorator.cs:56-58`), as ADR-031's Revision (2026-10-06) records
(`Website/docs-src/adr/031-feature-flag-management.md:192-212`); the code block, step 3 and the 404
paragraph were corrected from the previous flag-naming message `$"Feature '{featureGated.FeatureName}' is
not currently available."`. `HandleAsync` now spans `FeatureGateCommandDecorator.cs:48-63` and
`FeatureGateQueryDecorator.cs:48-62`. `DisabledFeatureHandler` class re-anchored `:13` to `:14`, result
`:18-26` to `:19-27`, `Title` `:21` to `:22`, `Detail` `:23` added. `BuildErrorsExtension` re-anchored
`:62-69` to `:62-70`, with `Message` localized by `Code` through `IErrorLocalizer` when one is registered
(`ErrorHttpMapping.cs:66`). `[FeatureGate(ConferenceFeatures.SessionScoring)]` re-anchored
`SessionSelectionController.cs:125` to `:134`. ADR-031 anchors refreshed (see below).
`IFeatureGated` interface with sole member `string FeatureName { get; }`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Markers/IFeatureGated.cs:10,16`).
`FeatureGateCommandDecorator<TCommand, TResult>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs:20`):
pass-through when `not IFeatureGated` (`:50-51`), `IFeatureManager.IsEnabledAsync(FeatureName)` (`:53`),
short-circuit through `CreateFailure()` (`:59`) with `Error.NotFoundError("Feature.Disabled", ...)` and the
generic message that keeps the flag name out (`:60-62`, reason in the comment `:56-58`).
The cached failure factory is the static field `_createFailure` (`:38`), filled lazily by the
`CreateFailure()` accessor via `ResultFailureFactory.Build<TResult>()` (`:44-45`) on the first
short-circuit, not in a static initializer (remarks `:29-37`); the previous ledger called the delegate
`CreateFailure` and implied eager construction, corrected in the 2026-10-02 run.
`FeatureGateQueryDecorator<TQuery, TResult>` is the identical shape on the query side
(`.../Decorators/FeatureGateQueryDecorator.cs:20`, `_createFailure` `:38`, `HandleAsync` `:48-62`, `Error.NotFoundError` `:59-61`).
Registration as outermost decorator on both sides in `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs`
(re-anchored in the 2026-10-02 run, previously `:143`/`:151`): commands `TransactionalCommandDecorator` (`:134`),
`TimeoutCommandDecorator` (`:135`), `ValidatingCommandDecorator` (`:136`), `CachingCommandDecorator` (`:137`),
`LoggingCommandDecorator` (`:138`), `AuthorizationCommandDecorator` (`:139`), `FeatureGateCommandDecorator`
(`:140`); queries `TimeoutQueryDecorator` (`:143`), `ValidatingQueryDecorator` (`:144`), `CachingQueryDecorator`
(`:145`), `LoggingQueryDecorator` (`:146`), `AuthorizationQueryDecorator` (`:147`), `FeatureGateQueryDecorator`
(`:148`). The XML doc draws the same nesting, commands at `:61-71` and queries at `:74-83`;
reverse-registration-order = outermost is ADR-014 (referenced via `group-05-cqrs-pipeline.md`).
`NotFoundError` yields `ErrorType.NotFound` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:56`).
HTTP edge: `AddHttpContextAccessor()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:104`),
`AddFeatureManagement().WithTargeting<CurrentUserTargetingContextAccessor>()` (`:105-106`) and
`AddSingleton<IDisabledFeaturesHandler, DisabledFeatureHandler>()` (`:107`) (built-in
Percentage/TimeWindow/Targeting filters noted in the surrounding comment, `:94-96`); `DisabledFeatureHandler`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:14`) writes a
`404` RFC 9457 ProblemDetails (`:19-27`) titled "Feature not available" (`:22`) with the detail "The
requested feature is not currently available." (`:23`) and no `errors` extension; the CQRS failure's
`errors` extension is built by `BuildErrorsExtension`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:62-70`), which serializes
`Code` and `Message` (the message localized by code through the `IErrorLocalizer` `AddAPI` registers, `:66`). `[FeatureGate(NotificationFeatures.PushNotifications)]` on the framework's
`DevicesController` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:24`).
The 404 paragraph, Apply item 4 and the takeaway were rewritten in the 2026-10-02 run: the previous text said a disabled
feature is indistinguishable from a nonexistent one, which ADR-031's Revision (2026-10-01) records the code
does not do.
Flag-name constants, each preceded by `[FeatureFlag(FeatureFlagLifetime.Permanent, Owner = ...)]`, counted
in the 2026-10-02 run as thirteen in six `*Features` classes (previously twelve):
`NotificationFeatures.cs:12` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/`, attribute `:11`),
`PrivacyFeatures.cs:12` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/`, attribute `:11`),
`CatalogFeatures.cs:21` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/`, attribute `:20`),
`SalesFeatures.cs:23` = `"Sales.PaymentVerification"` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/`, attribute `:22`),
`ConferenceFeatures.cs:23` = `"Conference.SessionizeIntegration"` (attribute `:22`) and `ConferenceFeatures.cs:38`
= `"Conference.SessionScoring"` (attribute `:37`) (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/`),
`EngagementFeatures.cs:22,34,46,59,71,83,95` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/`).
Real gated use cases, counted in the 2026-10-02 run as three (previously two), all commands, no query gated:
`VerifyPaymentCommand : ICacheInvalidating, IFeatureGated, IHasTimeout`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/VerifyPayment/VerifyPaymentCommand.cs:20`,
`Timeout` 20 s `:29`, `FeatureName => SalesFeatures.PaymentVerification` `:35`);
`RefreshFromSessionizeCommand : ICacheInvalidating, IFeatureGated`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:15`,
`FeatureName => ConferenceFeatures.SessionizeIntegration` `:21`; deliberately not `ITransactional` per its
XML doc `:9-12`, so the previous ledger's `ITransactional` was wrong);
`ScoreEventSessionsInternalCommand : IInternalCommand, IRequiresPermission, IHasTimeout, IFeatureGated`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommand.cs:39`,
`FeatureName => ConferenceFeatures.SessionScoring` `:48`; its XML doc `:41-47` claims a failure completes
the row rather than retrying, which the processor contradicts, see the 2026-10-22 entry); its trigger endpoint
carries `[FeatureGate(ConferenceFeatures.SessionScoring)]`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:134`).
Flag lifecycle: `[FeatureFlag]`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/FeatureFlags/FeatureFlagAttribute.cs:32`) with `Lifetime` (`:38`),
`RemoveBy` (`:46`, ISO format constant `:35`, parser `:60`) and `Owner` (`:52`); `FeatureFlagLifetime`
(`FeatureFlagLifetime.cs:9`, `Permanent` `:15`, `Temporary` `:21`); `FeatureFlagRegistry`
(`FeatureFlagRegistry.cs:35`); the two fitness rules `ArchitectureRules.FeatureFlagsDeclareLifetime`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.FeatureFlags.cs:28`)
and `TemporaryFeatureFlagsAreNotPastRemoveBy` (`:70`), exposed as facts on `FeatureFlagLifecycleTestsBase`
(`.../Bases/Governance/FeatureFlagLifecycleTestsBase.cs:10`, facts `:20-25`, `protected virtual Today` `:18`).
Conventions and trade-offs from `Website/docs-src/adr/031-feature-flag-management.md`, re-anchored in the
2026-10-29 run: the `404` convention with bodies that each state a feature is unavailable (Decision bullet
`:55-61`), two enforcement points agree only by convention with no fitness rule (`:80-82`), flag debt with
the expiry check shipped and adopted in all four repos (`:83-87`), missing key resolves to disabled and is
fail-safe (`:88-90`), only the Targeting filter is sticky per user (`:91-102`). The Status lists seven
revisions (2026-08-18 `:4-6`, 2026-08-31 `:6-8`, 2026-09-11 `:10-14`, 2026-10-01 `:16-18`, 2026-10-06
`:20-22`, 2026-10-21 `:22-23`, 2026-10-26 `:23-26`; the 2026-10-21 section is at `:228-240`, the
2026-10-26 section at `:242-277`). Revision (2026-10-01) (`:190-204`) corrects the anonymous-404 reading;
Revision (2026-10-06) (`:206-226`) removes the flag name from the CQRS message and drove the 2026-10-08
run's rewrite. The flag-debt trade-off follows the Revision (2026-09-11) (`:147-188`) and the Revision
(2026-10-26) item 2; the targeting caveat follows the Trade-offs entry `:91-102` and the Revision
(2026-10-26) item 1, which narrows the Revision (2026-08-18) (section `:104`, narrowing paragraph
`:135-138`) to the Targeting filter.
The targeting identifier is the JWT `sub` claim (`AuthClaimTypes.Subject`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthClaimTypes.cs:34`) read through `FindUserIdValue()`
(`ClaimsPrincipalExtensions.cs:26-28`, falling back to the mapped `ClaimTypes.NameIdentifier`), used at
`CurrentUserTargetingContextAccessor.cs:86` with a final fallback to `Identity.Name`; the accessor implements
`ITargetingContextAccessor` at
`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs:54-55`.
The single code block is an illustrative composite: the `IFeatureGated` body and the `HandleAsync` body are
verbatim source, including the three-line source comment (re-checked this run against
`FeatureGateCommandDecorator.cs:48-63`); `VerifyPaymentCommand`
is a real gated command shown with its three markers and its 20-second timeout; the three are shown together
for reading, not as one contiguous file. Rubric tag §6 (CQRS & Event-Driven Design,
`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:229`): rubric v2 replaced §10 with Messaging &
Integration Architecture and scores the former Cross-Cutting Concerns facets in §5, §6, §9, §12, §17 and §29
(`:15-18`), with §10 itself pointing at §6 for the in-process command/query pipeline (`:331`).*

- Full series index: https://ivanball.github.io/writing.html
