# ADR-014: CQRS Handlers with a Decorator Pipeline

## Status
Accepted. Revised 2026-07-19 (Transactional semantics: rollback on business failure + post-commit
event dispatch; see Revision below). Revised 2026-08-18 (**the pipeline order changed**: an
Authorization decorator was inserted between FeatureGate and Logging, and a Timeout decorator between
Validating and Transactional, on both the command and the query chain; the order is now pinned by a
shipped conformance test. The order stated in the Decision below is the pre-2026-08-18 one: read the
Revision (2026-08-26) at the end for the current chain). Revised 2026-08-26 (a Validating decorator
joins the **query** chain, and the registration sequence gains a sealed composition path plus a
fitness hook). Revised 2026-08-31 (correction: both Validating decorators run **every** registered
validator and union the failures, they do not stop at the first registration; the sealed composition
path is the shipped idiom in all seven production service hosts; citations refreshed).

## Context
Commands and queries share cross-cutting concerns: validation, transactions, cache invalidation,
logging / timing, and feature gating. Putting that logic inside each handler scatters it, makes the
ordering between concerns implicit, and couples use-case logic to infrastructure. We wanted each
handler to hold only its use-case logic, with the cross-cutting concerns applied uniformly and in a
known, intentional order, regardless of whether the handler is invoked from REST, gRPC, or an
integration-event consumer.

## Decision
Use single-responsibility handlers behind a Scrutor-composed decorator pipeline.

- `ICommandHandler<TCommand, TResult>` and `IQueryHandler<TQuery, TResult>`
  (`MMCA.Common.Application`) are one handler per use case, each returning `Result` / `Result<T>`
  (ADR-013).
- Cross-cutting concerns are decorators registered with Scrutor `TryDecorate` in
  `AddApplicationDecorators()`. Because `TryDecorate` applies in **reverse** registration order (last
  registered is outermost), the execution order (outermost to innermost) is (**superseded by the
  Revision (2026-08-18)**, which inserts Authorization and Timeout into both chains):
  - **Commands:** FeatureGate -> Logging -> Caching -> Validating -> Transactional -> Handler
  - **Queries:** FeatureGate -> Logging -> Caching -> Handler
  - plus an optional pair of `Profiling` decorators (`ProfilingCommandDecorator` /
    `ProfilingQueryDecorator`) registered by a **separate** opt-in `AddApplicationProfiling()` call,
    not by `AddApplicationDecorators()`. No consumer host wires it today.
- **The order is load-bearing and hard-coded** (not config-driven): validation runs *before* the
  transaction opens (an invalid command never touches the DB), cache invalidation runs *outside* the
  transaction boundary (a rolled-back command does not evict valid cache), logging wraps the whole
  pipeline to time it, and the feature gate short-circuits first.
- **Decoration is opt-in per concern** via marker interfaces: `ITransactional`, `ICacheInvalidating`
  (with `CachePrefix`), `IQueryCacheable` (with `CacheKey` + `CacheDuration`). A handler that
  implements none simply skips that decorator's work, so messages pay only for the concerns they
  declare.
- Handlers, validators, and mappers are auto-registered by convention (module handler scanning, driven
  by `ModuleLoader.DiscoverAndRegister` in the service hosts, or `ScanModuleApplicationServices<TMarker>()`
  directly); `AddApplicationDecorators()` MUST be called **last**, after every module's concrete handlers
  exist, so `TryDecorate` can find them. The hand-written form of that sequence is `AddApplication` ->
  `AddInfrastructure` -> `AddAPI` -> module handler scan via `ModuleLoader.DiscoverAndRegister` ->
  `AddApplicationDecorators`, and `MMCA.Helpdesk.Web` still ends its host wiring that way
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:120`). The seven production service hosts
  compose the same sequence through `AddMmcaApplicationPipeline(pipeline => ...)` instead, which runs it
  in order and seals it (see the Revision (2026-08-26) below): ADC Identity / Conference / Engagement /
  Notification (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:284`, `...Conference.Service/Program.cs:345`,
  `...Engagement.Service/Program.cs:274`, `...Notification.Service/Program.cs:211`) and Store Identity /
  Catalog / Sales (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:202`,
  `...Catalog.Service/Program.cs:225`, `...Sales.Service/Program.cs:225`). Only that decorators-last
  ordering is load-bearing; the relative position of `AddInfrastructure`/`AddAPI` is not.

## Rationale
- **Thin, testable handlers.** A handler has no transaction, logging, or caching plumbing, so it is
  unit-tested in isolation.
- **One place to read and change the pipeline.** The order is explicit and intentional, documented
  inline at the registration site, not emergent from scattered code.
- **Transport-agnostic.** The pipeline runs around the handler itself, so REST, gRPC, and event
  consumers all get the same behavior; HTTP middleware would only cover the REST path.

## Trade-offs
- **Registration order is the reverse of execution order** (a Scrutor foot-gun), mitigated by the
  inline ordering comments in `AddApplicationDecorators()`.
- Decorators must be registered after handlers, so the DI sequence is a constraint consumers cannot
  reorder freely.
- A new cross-cutting concern means a new decorator inserted at the correct depth; placing it wrong can
  silently change semantics (for example, validating *inside* the transaction).

## Revision (2026-07-19)
Two Transactional-decorator semantics changed with the 2026-07-19 full review:

- **A returned business failure now rolls the transaction back.** Previously a handler returning
  `Result.Failure` committed whatever it had already saved (only exceptions rolled back), so a
  handler that saved and then failed a later invariant left the partial mutation committed. In a
  framework that mandates Result-over-exceptions (ADR-013), failure values must get the same
  atomicity as thrown exceptions: `DbContextFactory.ExecuteInTransactionAsync` inspects the
  returned `Result` and calls `RollbackTransaction()` when `IsFailure` is true. Cache invalidation
  was already skipped on failure; that is unchanged.
- **In-process domain event dispatch is deferred until after commit.** Post-save dispatch captured
  during an active transaction is queued (`DomainEventSaveChangesInterceptor` deferred table) and
  flushed only after a successful commit; rollback (including the new business-failure rollback)
  drops it. Handlers therefore never act on state that could still roll back, and a retrying
  execution strategy cannot dispatch the same events once per attempt. The events' outbox rows roll
  back with the data, so nothing is delivered on either failure path.

The pipeline order and the "cache invalidation outside the transaction" rule are unchanged.

## Revision (2026-08-18)
**Two decorators were added to both chains, so the order recorded in the Decision above is no longer
the shipped one.** The registration site is unchanged in kind: `AddApplicationDecorators()`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:115`) still uses Scrutor
`TryDecorate` and still documents the reverse-registration rule inline (`:57-60`), now with ASCII
nesting diagrams of both chains beside it (`:61-85`, command chain at `:61-73`, query chain at
`:75-85`). The literal registration sequence is `:129-135` for commands and `:138-143` for queries, so
the execution order (outermost to innermost) is now:

- **Commands:** FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout ->
  Transactional -> Handler
- **Queries:** FeatureGate -> Authorization -> Logging -> Caching -> Timeout -> Handler

**Both new decorators are opt-in by marker**, consistent with the existing `ITransactional` /
`IQueryCacheable` / `ICacheInvalidating` model, so a use case that declares neither pays nothing.

1. **Authorization, keyed on `IRequiresPermission`.** The marker is a single member,
   `string Permission { get; }`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/IRequiresPermission.cs:16,23`).
   `AuthorizationCommandDecorator<TCommand, TResult>`
   (`.../UseCases/Decorators/AuthorizationCommandDecorator.cs:26-29`) and its query twin
   (`AuthorizationQueryDecorator.cs:21-24`) take `ICurrentUserService` and `IPermissionRegistry`, and
   resolve the check as `permissionRegistry.HasPermission(currentUser.Roles, requiresPermission.Permission)`
   (`AuthorizationCommandDecorator.cs:61`, `AuthorizationQueryDecorator.cs:56`), against
   `bool HasPermission(IEnumerable<string> roles, string permission)`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/IPermissionRegistry.cs:28`) and the
   `IEnumerable<string> Roles` default interface member on `ICurrentUserService`
   (`.../Interfaces/Infrastructure/ICurrentUserService.cs:45`). A denial returns
   `Error.Forbidden("Authorization.PermissionDenied", ...)` (`:68-71` / `:63-66`) rather than
   throwing, so it short-circuits as an ordinary ADR-013 failure value; a request that does not
   implement the marker passes straight through (`:58-59` / `:53-54`). Denials are counted on
   `cqrs.authorization.denied.count` (counter `AuthorizationDenied`, unit `{request}`, tag
   `request_type`, `.../Decorators/CqrsMetrics.cs:53-56,76-77`) on the existing `MMCA.Common.Cqrs`
   meter (`CqrsMetrics.cs:24`, ADR-041). This is the pipeline-side surface of ADR-020's permission
   registry, which previously had only the `[HasPermission]` controller attribute.
2. **Timeout, keyed on `IHasTimeout`.** The marker is `TimeSpan Timeout { get; }`
   (`.../UseCases/IHasTimeout.cs:14,21`), a `TimeSpan` rather than a seconds int, and a value
   `<= TimeSpan.Zero` means "no budget, pass through" (`:17-20`, guard at
   `TimeoutCommandDecorator.cs:63`). The decorator links a fresh source to the caller's token
   (`CancellationTokenSource.CreateLinkedTokenSource(cancellationToken)` plus
   `budget.CancelAfter(hasTimeout.Timeout)`, `TimeoutCommandDecorator.cs:66-67`) and invokes the inner
   handler with `budget.Token` (`:71`). On expiry it returns
   `Error.Failure("Request.TimedOut", ...)` (`:79-84`); `Request.TimedOut` is the error **code** and
   the `ErrorType` is `Failure`, because the ADR-013 taxonomy has no timeout member (rationale at
   `TimeoutCommandDecorator.cs:12-17`). **Caller cancellation still propagates unchanged**: the catch
   is filtered as
   `catch (OperationCanceledException) when (budget.IsCancellationRequested && !cancellationToken.IsCancellationRequested)`
   (`:73`), so a client that aborted fails the filter and the exception keeps travelling rather than
   being reported as a timeout. Expiries are counted on `cqrs.timeout.count` (counter
   `TimeoutExpired`, unit `{request}`, tag `request_type`, `CqrsMetrics.cs:59-62,81-82`, recorded at
   `TimeoutCommandDecorator.cs:76`). The query twin is identical (`TimeoutQueryDecorator.cs:63-84`).

**Two placements are load-bearing and are argued in code, not only here.** Authorization sits
**outside** caching deliberately: a cache lookup ahead of the permission check would serve another
caller's rows to a principal not allowed to run the query, so a denied request must neither read nor
populate the cache (`DependencyInjection.cs:93-95`, restated at
`AuthorizationCommandDecorator.cs:13-16`, which also notes that a denied command never starts a
transaction and never runs validation). FeatureGate stays outside Authorization so that a disabled
feature does not leak which permission guards it (`DependencyInjection.cs:89-92`), which preserves
ADR-031's "disabled is indistinguishable from nonexistent" property. Timeout sits **inside**
validation and **outside** the transaction, so an invalid command never consumes budget and an expired
budget still unwinds through the transactional decorator's rollback path.

**The order is now pinned by a test rather than by comments alone.** `DecoratorPipelineOrderTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:38`) resolves the
handlers from a real `ServiceCollection` and unwraps the constructed object graph by reflection
(`:105-125`), asserting both sequences outermost-first (`:49-58` commands, `:61-69` queries) and that
the innermost element is not itself a decorator (`:96-97`). Both expected sequences are
`protected virtual`, so a consumer with a different chain can override them. MMCA.Common subclasses it
against its own registration sequence
(`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:21-39`) without
overriding either list, so the base order is pinned in Common's default test pass. ADC, Store and
Helpdesk each subclass the same base
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:27`,
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:27`,
`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/DecoratorPipelineOrderTests.cs:34`),
and none of the three overrides either list: the only definitions of `ExpectedCommandDecorators` and
`ExpectedQueryDecorators` workspace-wide are the base's own
(`DecoratorPipelineOrderTestsBase.cs:49,61`). All four repos therefore pin the same chain against
their own genuine registration sequence. This closes the "one place to read the pipeline" claim in the Rationale, which until now rested
entirely on the inline comments the Trade-offs cite as the mitigation for the Scrutor foot-gun.

The trade-off list above gains one entry by construction: the chain is now seven decorators deep for a
command that declares every marker, and two of the seven were inserted between existing neighbours, so
the "placing it wrong can silently change semantics" warning is no longer hypothetical. The caching
and transactional placements from the original record are unchanged.

## Revision (2026-08-26)
**One decorator joins the query chain, and the registration sequence stops being a rule consumers
have to remember.** The query line in the Revision (2026-08-18) above is superseded; the shipped
execution order (outermost to innermost) is now:

- **Commands:** FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout ->
  Transactional -> Handler
- **Queries:** FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout -> Handler

1. **Validation is no longer command-only.** `ValidatingQueryDecorator<TQuery, TResult>`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ValidatingQueryDecorator.cs:34-37`)
   is the twin of the command decorator: the same validator resolution, in which **every** registered
   `IValidator<TQuery>` runs, in registration order. The constructor takes
   `IEnumerable<IValidator<TQuery>> validators` (`:36`), materialized once into an array (`:39`) and
   iterated sequentially (`:76-86`, errors appended at `:85`), so every broken rule from every
   validator is unioned into one `Result` failure. Running the whole set rather than the first
   registration is deliberate on both sides: a request commonly carries a module-authored validator
   beside a framework or cross-cutting one, and honoring only the first turns the others into dead code
   whose rules go silently unenforced, while running them all lets the caller see every broken rule in
   one response instead of one per round trip (`ValidatingCommandDecorator.cs:18-21`, command loop at
   `:73-83`). The sequential walk is also deliberate: a validator may read through a scoped repository,
   and a `DbContext` is not thread-safe (`ValidatingQueryDecorator.cs:73-74`). The pass-through when a
   query has no validator is an array-length check, so a query type that registers none pays
   `_validators.Length == 0` (`:68-71`, twin note at `:13-19`). Queries carrying paging, filter or sort
   input therefore reject a malformed request the way commands do instead of pushing the bad values
   into the data source (`:16-18`). The failure is built through the same reflection-built factory as
   the command side (`:62-63`), lazily on the first short-circuit rather than in a static initializer,
   because Scrutor decorates unconditionally and an eager initializer would turn an unsupported
   `TResult` into a `TypeInitializationException` at resolve time for a query that never fails
   validation (`:46-55`).
2. **Its placement is the interesting part: inside Caching, outside Timeout.** The registration sits
   between the caching and timeout decorators
   (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:139`, chain diagram at
   `:75-85`). Validation sits **inside** caching deliberately, which is the opposite of the command
   side's outside-the-transaction placement and follows from what a cache hit means: an entry can only
   exist because the same query already passed validation when that entry was first produced, so
   re-validating on a hit spends work to reach a conclusion already reached (`:97-101`, restated at
   `ValidatingQueryDecorator.cs:25-27`). It sits **outside** the timeout for the mirror of the
   command-side reason, so a caller is not charged a slice of its execution budget for validating its
   own bad input (`ValidatingQueryDecorator.cs:27-29`, `DependencyInjection.cs:104-107`).
3. **`AddMmcaApplicationPipeline(pipeline => ...)` is the composition path, and it seals.**
   (`DependencyInjection.cs:612-621`.) It runs `AddApplication()`, then the caller's handler
   registrations through a small builder (module scans, a `ModuleLoader` run, cross-service client
   registrations that replace a handler's dependencies:
   `.../MMCA.Common.Application/MmcaApplicationPipelineBuilder.cs`, argument contract at
   `DependencyInjection.cs:578-585`), then `AddApplicationDecorators()`, in that order (`:616-620`,
   equivalence spelled out at `:591-598`). Closing the pipeline registers a private marker type on the
   service collection (`:145`, marker at `:699`, registered at `:712-713`, probe at `:701-710`), and any
   later `AddApplicationDecorators`, `ScanModuleApplicationServices` or second
   `AddMmcaApplicationPipeline` **throws** naming the mistake (`:715-725`, guards at `:117`, `:182`,
   `:614`). The same guard now also fronts the three generic-CRUD registration helpers, which close
   handler types over an entity and are therefore just as order-sensitive: `AddEntityCrud` (`:335`),
   `AddEntityUpdateVerb` (`:397`) and `AddEntityUpdate` (`:448`). That converts the one
   load-bearing ordering rule of this record (decorators last, because `TryDecorate` only wraps
   registrations that already exist) from a documented convention whose violation is silent (a handler
   registered afterwards runs with no feature gate, no authorization, no validation, no timeout and no
   transaction, and nothing fails at startup to say so: `:594-597`) into a startup exception.
   Registrations that are not handlers stay outside the call: their order relative to the decorators
   does not matter (`:599-602`).
4. **`VerifyDecoratorPipeline()` is the fitness hook.** (`DependencyInjection.cs:649-691`.) Never
   called automatically, it asserts that the pipeline was closed at all (`:651-656`) and that every
   registered `ICommandHandler<,>` / `IQueryHandler<,>` entry is wrapped, throwing with each unwrapped
   registration named (`:682-690`, formatting at `:727-738`). The check is registration-shape only: it
   reads `ServiceDescriptor` entries and never builds a provider, so a fitness test does not have to
   register a double for every decorator dependency (`:634-638`). What it can see is a consequence of
   how Scrutor works: decoration rewrites a handler's descriptor into a factory over a keyed copy of
   the original, so a surviving implementation type on the effective (last non-keyed) registration is
   proof nothing wrapped it (`:639-647`, the effective-descriptor pass at `:658-674`, the predicate at
   `:677`). The outermost decorator's type cannot be read back at all after decoration, since it
   exists only inside a closure (`:645-646`), which is why this complements rather than replaces
   `DecoratorPipelineOrderTestsBase`: that base resolves the real object graph to assert the *order*,
   this one asserts *coverage* without a provider.

The trade-off list gains nothing new in kind: a command that declares every marker is now seven
decorators deep and a query six, and the "registration order is the reverse of execution order"
foot-gun is unchanged, but its worst outcome (a handler that quietly runs undecorated) is now a throw
rather than a silence.

## Related
ADR-013 (Result, the short-circuit currency of the pipeline, and the `Failure` error type the timeout
decorator reuses because the taxonomy has no timeout member), ADR-003 (handlers raise domain events
that the outbox drains after `SaveChanges`; its 2026-07-19 revision pairs with this one), ADR-020 (the
`IPermissionRegistry` and role-to-permission model the Authorization decorator consumes: this is its
pipeline-side surface beside the `[HasPermission]` controller attribute), ADR-041 (the
`MMCA.Common.Cqrs` meter the two new counters join), ADR-031 (the feature gate that stays outermost so
a disabled feature does not reveal which permission guards it), ADR-026 (the caching substrate the
Authorization decorator is deliberately placed outside of), ADR-058 (the runtime conformance suites a
consumer subclasses; the decorator-order base is one of them).
