# 5. CQRS: Commands, Queries & the Decorator Pipeline

**What this group covers.** Every write and every read in an MMCA application is a *use case*, a
small, single-purpose object (a command or a query) handed to a handler that does exactly one thing.
This group is the framework's implementation of **CQRS** (Command/Query Responsibility Segregation):
the two handler contracts ([`ICommandHandler<in TCommand, TResult>`](#icommandhandlerin-tcommand-tresult),
[`IQueryHandler<in TQuery, TResult>`](#iqueryhandlerin-tquery-tresult)), the **decorator pipeline**
that wraps them with cross-cutting concerns (feature-gating, logging+metrics, caching, validation,
transactions, profiling), the small **opt-in marker interfaces** that let an individual handler switch
each concern on, and one generic reusable use case ([`DeleteEntityCommand<TEntity, TIdentifierType>`](#deleteentitycommandtentity-tidentifiertype)
+ [`DeleteEntityHandler<TEntity, TIdentifierType>`](#deleteentityhandlertentity-tidentifiertype)) that
shows the whole machine in motion. This is the central column of `[Rubric §6, CQRS & Event-Driven]`
(separation of reads from writes, intent-revealing use cases) and `[Rubric §10, Cross-Cutting
Concerns]` (the place those concerns are implemented once, uniformly, instead of scattered through
handlers).

## The shape: thin handlers, fat pipeline

A handler is deliberately tiny. [`ICommandHandler<in TCommand, TResult>`](#icommandhandlerin-tcommand-tresult)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandHandler.cs:9`) and
[`IQueryHandler<in TQuery, TResult>`](#iqueryhandlerin-tquery-tresult)
(`.../IQueryHandler.cs:9`) are one method each, `Task<TResult> HandleAsync(T, CancellationToken)`,
with `in` (contravariant) variance on the input. `TResult` is almost always the
[`Result`](group-01-result-error-handling.md#result) / `Result<T>` of the
[Result pattern](00-primer.md#2-architectural-styles-this-codebase-commits-to): a handler returns a
failure value, it does not throw for expected error paths. **Commands** mutate state and return a
`Result`; **queries** are side-effect-free reads. Splitting the two into distinct interfaces is what
lets the container apply a *different* set of cross-cutting concerns to each (writes get transactions
and validation; reads get result caching), and it is the boundary `[Rubric §1, SOLID]` rewards: each
handler has one reason to change, and each decorator a single responsibility.

Everything that is *not* the business logic of a use case lives outside the handler, in a stack of
**decorators**. A decorator implements the same handler interface, takes the next handler in via its
constructor (`inner`), does its cross-cutting job, and delegates. Because each decorator *is* an
`ICommandHandler`/`IQueryHandler`, you can nest them arbitrarily and the concrete handler at the
bottom never knows it is wrapped. This is the textbook **Decorator pattern** (`[Rubric §2, Design
Patterns]`), applied to the application boundary so that logging, caching, validation, feature flags,
and transactions are each written *once* and reused by every handler in every module.

## How the pipeline is assembled (Scrutor, registration vs. execution order)

The wiring lives in `DependencyInjection.cs`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs`), exposed as
`extension(IServiceCollection)` members (the C# `extension(T)` syntax,
[primer §4](00-primer.md#c-extensiont-types--read-this-once)). The sequence a host must follow is
strict and ordered:

1. `AddApplication()` registers the core singletons (event dispatcher, navigation metadata, the
   [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline)) and Common's own
   validators (`DependencyInjection.cs:29-43`).
2. `ScanModuleApplicationServices<TMarker>()` is called **once per module** and uses **Scrutor**
   assembly scanning to register every concrete `ICommandHandler<,>`/`IQueryHandler<,>` (scoped),
   plus DTO/request mappers and FluentValidation validators (`DependencyInjection.cs:115-179`).
3. `AddApplicationDecorators()` is called **last** (`DependencyInjection.cs:89-106`). It uses Scrutor's
   `TryDecorate` to wrap the already-registered handlers. **This ordering matters**: `TryDecorate` can
   only wrap registrations that already exist, which is why decorators must come after every module's
   handler scan.

The subtle rule is **registration order vs. execution order**. `TryDecorate` applies decorators in
*reverse* registration order, the **last** one registered becomes the **outermost** wrapper. So the
command registrations (`DependencyInjection.cs:94-98`), read top-to-bottom, list innermost-first:

```
FeatureGateCommandDecorator         ← outermost (registered last)
  → LoggingCommandDecorator
    → CachingCommandDecorator
      → ValidatingCommandDecorator
        → TransactionalCommandDecorator   ← innermost (registered first)
          → ConcreteHandler               ← the actual business logic
```

The query side (`DependencyInjection.cs:101-103`) is lighter, there is nothing to validate or commit
on a read:

```
FeatureGateQueryDecorator
  → LoggingQueryDecorator
    → CachingQueryDecorator
      → ConcreteHandler
```

A separate optional call, `AddApplicationProfiling()` (`DependencyInjection.cs:186-192`), layers
[`ProfilingCommandDecorator<TCommand, TResult>`](#profilingcommanddecoratortcommand-tresult) /
[`ProfilingQueryDecorator<TQuery, TResult>`](#profilingquerydecoratortquery-tresult) (MiniProfiler)
on top, used only where step-level timing is wanted.

## Why this exact order, and what each layer guards

The nesting order is a deliberate cost-and-correctness argument, spelled out in the registration
XML-doc (`DependencyInjection.cs:73-86`):

- **Feature-gating is outermost** so a disabled feature is rejected with *zero* downstream work, no
  log scope, no cache touch, no validation, no transaction. [`FeatureGateCommandDecorator<TCommand, TResult>`](#featuregatecommanddecoratortcommand-tresult)
  (`.../Decorators/FeatureGateCommandDecorator.cs:18`) and its query twin
  [`FeatureGateQueryDecorator<TQuery, TResult>`](#featuregatequerydecoratortquery-tresult) check
  `IFeatureManager.IsEnabledAsync` only when the use case opts in via [`IFeatureGated`](#ifeaturegated),
  and short-circuit with a `NotFound` failure when the flag is off.
- **Logging sits just inside the gate** so it measures only *enabled* executions. [`LoggingCommandDecorator<TCommand, TResult>`](#loggingcommanddecoratortcommand-tresult)
  (`.../Decorators/LoggingCommandDecorator.cs:14`) opens a structured-logging scope carrying the
  `CorrelationId` (from [`ICorrelationContext`](group-12-api-hosting-mapping.md#icorrelationcontext))
  and the command name, times the *whole* inner pipeline with a `Stopwatch`, distinguishes
  success / business-failure / exception outcomes, and, in its `finally` block, records the duration
  to the [`CqrsMetrics`](#cqrsmetrics) OpenTelemetry histogram tagged by command name and outcome.
  This is the RED-metrics (Rate/Errors/Duration) anchor of `[Rubric §13, Observability &
  Operability]`. The query-side [`LoggingQueryDecorator<TQuery, TResult>`](#loggingquerydecoratortquery-tresult)
  does the same for reads.
- **Cache invalidation sits outside validation** so the cache is only cleared after a *valid,
  committed* mutation; a validation failure or rollback leaves the cache intact.
  [`CachingCommandDecorator<TCommand, TResult>`](#cachingcommanddecoratortcommand-tresult)
  (`.../Decorators/CachingCommandDecorator.cs:16`) calls `ICacheService.RemoveByPrefixAsync` only when
  the command opts in via [`ICacheInvalidating`](#icacheinvalidating) **and** the `Result` is not a
  failure. On the read side, [`CachingQueryDecorator<TQuery, TResult>`](#cachingquerydecoratortquery-tresult)
  serves cache hits and stores non-failure results for queries that implement
  [`IQueryCacheable`](#iquerycacheable); on a cold-key miss it holds a per-key `SemaphoreSlim` from the
  process-wide [`QueryCacheKeyLocks`](#querycachekeylocks) table so only one caller repopulates the key
  while the rest wait for the fresh entry (cache-stampede protection).
  (`[Rubric §12, Performance & Scalability]`.)
- **Validation sits outside the transaction** so a malformed command never opens a database
  transaction. [`ValidatingCommandDecorator<TCommand, TResult>`](#validatingcommanddecoratortcommand-tresult)
  (`.../Decorators/ValidatingCommandDecorator.cs:24`) resolves the registered `IValidator<TCommand>`,
  and on failure returns a `Result` failure built from the validation errors *without ever calling the
  handler*. Commands that embed a request DTO via [`ICommandWithRequest<out TRequest>`](#icommandwithrequestout-trequest)
  get a validator wired automatically (the
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  registered in the module scan, `DependencyInjection.cs:160-176`), that whole story belongs to
  [G06, Validation](group-06-validation.md). (`[Rubric §24, Forms, Validation & UX Safety]`.)
- **Transaction is innermost** (closest to the handler) so the unit-of-work boundary is as tight as
  possible. [`TransactionalCommandDecorator<TCommand, TResult>`](#transactionalcommanddecoratortcommand-tresult)
  (`.../Decorators/TransactionalCommandDecorator.cs:18`) wraps the handler in
  `IUnitOfWork.ExecuteInTransactionAsync` **only** when the command implements [`ITransactional`](#itransactional);
  on an exception the transaction rolls back. Crucially, a *business failure* (`Result.IsFailure`,
  no exception) still commits, because nothing was mutated, while cache invalidation is skipped.
  (`[Rubric §8, Data Architecture]`.)

## Opt-in by marker interface, pay only for what you use

The pipeline is registered for *every* handler, but most decorators are dormant unless the use case
asks for them. That switch is a set of tiny **marker / role interfaces** in
`MMCA.Common.Application.UseCases`:

- [`ITransactional`](#itransactional) (empty marker), open a DB transaction.
- [`ICacheInvalidating`](#icacheinvalidating), exposes a `CachePrefix` to evict after success.
- [`IQueryCacheable`](#iquerycacheable), exposes a `CacheKey` + `CacheDuration` for read caching.
- [`IFeatureGated`](#ifeaturegated), exposes a `FeatureName` to check before running.

Each decorator does an `is`-check (`command is ITransactional`, `query is IQueryCacheable`, …) and
passes straight through when the interface is absent. This is `[Rubric §2, Design Patterns]` (marker
interfaces as declarative opt-in) layered with `[Rubric §1, SOLID]` Open/Closed: a new handler turns
a concern on by implementing an interface, no decorator, registration, or pipeline change. The result
is that a read-only command pays nothing for transactions, and an un-cached query pays nothing for
caching, while the *capability* is uniformly present. (Verified-by-source caveat surfaced in the
per-type sections: [`IQueryCacheable`](#iquerycacheable) is wired, unit-tested, and adopted by exactly
**one production query** today, ADC's `GetNowNextQuery` ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8); every other read still caches
at the HTTP `OutputCache` layer instead.)

## Two supporting pieces, and a worked example

Two small helpers make the short-circuit decorators possible. [`ResultFailureFactory`](#resultfailurefactory)
(`.../Decorators/ResultFailureFactory.cs:11`) builds, and caches per closed generic, a delegate that
manufactures a `Result` or `Result<T>` failure from an error list; the feature-gate and validating
decorators use it to return a typed failure even though their `TResult` is unconstrained.
[`CqrsMetrics`](#cqrsmetrics) (`.../Decorators/CqrsMetrics.cs:12`) is the internal static holder of the
`MMCA.Common.Cqrs` OpenTelemetry meter and its command/query duration histograms, emitted by the
logging decorators, exported by hosts that register the meter (the Aspire service defaults do).

The reusable [`DeleteEntityCommand<TEntity, TIdentifierType>`](#deleteentitycommandtentity-tidentifiertype)
(`.../UseCases/DeleteEntityCommand.cs:12`) and its
[`DeleteEntityHandler<TEntity, TIdentifierType>`](#deleteentityhandlertentity-tidentifiertype)
(`.../UseCases/DeleteEntityHandler.cs:14`) are the canonical end-to-end example: a single generic
command/handler pair that deletes *any*
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
rather than forcing every module to author `DeleteSessionCommand`, `DeleteSpeakerCommand`, and so on.
The handler fetches via [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork)'s repository,
returns a `NotFound` [`Error`](group-01-result-error-handling.md#error) when the row is missing, calls
the aggregate's own `Delete()` (which enforces invariants and may raise domain events), and saves only
on success. A teaching detail worth holding onto: the `TEntity` type parameter is a **phantom**, never
read at runtime, present purely so DI can tell `DeleteEntityCommand<Session, int>` apart from
`DeleteEntityCommand<Speaker, int>` and route each to its own handler (hence the documented
`#pragma warning disable S2326`, `DeleteEntityCommand.cs:11`).

## Where this fits, and the failure-mode contract

These contracts sit in the **Application** layer of Clean Architecture
([primer §1](00-primer.md#1-the-big-picture)), above Domain, below Infrastructure and the API. The
API layer ([G12](group-12-api-hosting-mapping.md)) resolves a closed handler from DI and calls
`HandleAsync`; the decorators it gets are invisible to the caller. Returned `Result` failures are
translated to HTTP status codes by
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase). The transaction's domain
events feed the outbox ([G04](group-04-events-outbox.md), [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)) on save. And because the *only*
thing the handlers and decorators depend on are abstractions, [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
[`ICacheService`](group-09-caching.md#icacheservice), [`ICorrelationContext`](group-12-api-hosting-mapping.md#icorrelationcontext),
`IFeatureManager`, `IValidator<T>`, the whole pipeline survives a module being extracted into its own
service unchanged (`[Rubric §7, Microservices Readiness]`; ADRs 007/008).

The contract to memorize, because the rest of the system relies on it
(`DependencyInjection.cs:80-85`): on a **business failure** (`Result.IsFailure`, no exception) the
transaction still commits but cache invalidation is skipped; on an **exception** the transaction rolls
back and the exception propagates outward through every decorator (logging records it, metrics tag it
`exception`). Reads cache only non-failure results. That asymmetry, failures are values that flow
through the pipeline, exceptions are escapes that unwind it, is the same Result-pattern discipline the
whole codebase is built on, expressed here as the rules of the pipeline.

### DeleteEntityCommand<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityCommand.cs:12` · Level 0 · record (sealed)

- **What it is**: a generic delete command carrying only the entity's primary key `Id`. The phantom `TEntity` type parameter exists solely for DI type discrimination: `DeleteEntityCommand<Session, int>` and `DeleteEntityCommand<Speaker, int>` are distinct closed types that resolve to distinct handlers.
- **Depends on**: BCL only. Participates in the handler pipeline described under [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); handled generically by [DeleteEntityHandler<TEntity, TIdentifierType>](#deleteentityhandlertentity-tidentifiertype).
- **Concept introduced, phantom type parameters for handler dispatch.** `[Rubric §1, SOLID]` assesses whether each type has one responsibility and is open for extension without modification; here one handler per entity keeps SRP clean. `[Rubric §6, CQRS & Event-Driven]` assesses whether writes (commands) are segregated from reads (queries); this is a pure write command. Without `TEntity`, every delete command sharing a `TIdentifierType` (e.g. `int`) would collapse onto the same closed generic, making Scrutor-based handler registration ambiguous. The `#pragma warning disable S2326` suppression (line 11) acknowledges that SonarAnalyzer flags the "unused type parameter", the suppression is intentional and documented in both the XML doc (`DeleteEntityCommand.cs:4-9`) and the inline comment. The `where TIdentifierType : notnull` constraint (line 13) forbids nullable identifier types.
- **Walkthrough**: line 12: `public sealed record DeleteEntityCommand<TEntity, TIdentifierType>(TIdentifierType Id)`. The record primary constructor makes `Id` a positional `init` property; `sealed` prevents inheritance. The S2326 suppression brackets only this single declaration (lines 11/14).
- **Why it's built this way**: it avoids hand-writing a bespoke `DeleteSessionCommand`, `DeleteSpeakerCommand`, … in every module; the one generic command + one generic handler covers the boilerplate while the type system still routes each call to the correct closed handler.
- **Where it's used**: the aggregate-root controllers' delete actions (`AggregateRootEntityControllerBase`, G12) dispatch `DeleteEntityCommand<TEntity, Id>`; each module registers the matching handler (the generic default, or a custom override).

---

### ICacheInvalidating
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICacheInvalidating.cs:8` · Level 0 · interface

- **What it is**: an opt-in interface for commands that should evict cached entries after a successful mutation. Implementing it exposes a `CachePrefix` string; [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult) calls `ICacheService.RemoveByPrefixAsync(CachePrefix)` after `HandleAsync` succeeds.
- **Depends on**: nothing first-party at the interface level. Works in concert with [ICacheService](group-09-caching.md#icacheservice) (the eviction mechanism) and shares the marker/opt-in pattern with [ITransactional](#itransactional).
- **Concept introduced, prefix-based cache invalidation as an opt-in pipeline concern.** `[Rubric §12, Performance & Scalability]` assesses caching strategy and how stale reads are avoided; prefix-scoped eviction keeps read caches coherent after writes without the command site knowing individual cache keys. Naming the prefix (e.g. `"Catalog:Products"`) scopes eviction to only the affected segment. This reuses the marker/opt-in pattern that [ITransactional](#itransactional) introduces, `[Rubric §2, Design Patterns]` (Decorator + a presence-as-signal marker interface).
- **Walkthrough**: line 8: `public interface ICacheInvalidating`. Line 14: `string CachePrefix { get; }`, the only member. Commands typically return the prefix from a constant to avoid magic strings.
- **Why it's built this way**: decoupling *what* to invalidate (the command's concern, via `CachePrefix`) from *how* to invalidate (the decorator + `ICacheService`) keeps handlers free of cache-infrastructure knowledge and makes invalidation testable in isolation. Per `MMCA.Common/CLAUDE.md`, a business `Result.Failure` still commits the transaction but **skips** invalidation, only a genuine success evicts.
- **Where it's used**: broadly adopted: ~33+ write commands across ADC (Conference category/event/session/speaker mutations) and Store (catalog, sales-cart, identity mutations) implement it. Consumed exclusively by [CachingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult).

---

### ICommandHandler<in TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandHandler.cs:9` · Level 0 · interface

- **What it is**: the CQRS command-handler contract: one method, `HandleAsync`, that accepts a mutation command and returns a result, typically [Result](group-01-result-error-handling.md#result) or `Result<T>`.
- **Depends on**: BCL only (`Task`, `CancellationToken`). Implementations return types from `MMCA.Common.Shared` (`Result`/`Result<T>`).
- **Concept introduced, the CQRS command side.** `[Rubric §6, CQRS & Event-Driven]` assesses the separation of mutating writes from side-effect-free reads; **commands** express intent to change state (create, update, delete) and return a [Result](group-01-result-error-handling.md#result). `[Rubric §1, SOLID]`: a one-method interface gives each handler a single responsibility and, via contravariance, clean substitutability. Implementations are auto-discovered by Scrutor and then wrapped by a layered decorator pipeline. The **verified registration** in `DependencyInjection.cs:94-98` registers (innermost→outermost) `Transactional → Validating → Caching → Logging → FeatureGate`; because Scrutor's `TryDecorate` applies decorators in *reverse* registration order, the **execution order is** `FeatureGate → Logging → Caching → Validating → Transactional → concrete handler`. That exact ordering is load-bearing and is the subject of **[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)** (the CQRS decorator pipeline). The default `CancellationToken = default` lets token-less callers invoke handlers while still letting every implementation honour cancellation.
- **Walkthrough**: line 9: `public interface ICommandHandler<in TCommand, TResult>`. The `in` variance on `TCommand` is contravariant: a handler accepting a base command can stand in where a handler of a derived command is expected. Line 17: `Task<TResult> HandleAsync(TCommand command, CancellationToken cancellationToken = default);`, the sole member.
- **Why it's built this way**: a thin one-method interface keeps handlers focused; the decorator pipeline adds cross-cutting concerns without each handler knowing about them. A single open-generic interface is exactly what lets Scrutor register every closed handler in one assembly pass and lets the decorator chain wrap them generically.
- **Where it's used**: every command handler in ADC and Store implements it, plus the framework's own [DeleteEntityHandler<TEntity, TIdentifierType>](#deleteentityhandlertentity-tidentifiertype) and the notification command handlers (G10). `ScanModuleApplicationServices<TMarker>()` registers the closed implementations; the decorator extensions (`AddApplicationDecorators`, called **last**) wrap them.
- **Caveats / not-in-source**: `ProfilingCommandDecorator` exists but is **not** in the standard pipeline; it is added only by the separate opt-in `AddApplicationProfiling()` (`DependencyInjection.cs:188`).

---

### ICommandWithRequest<out TRequest>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandWithRequest.cs:14` · Level 0 · interface

- **What it is**: a contract for commands that embed a request DTO as a `Request` property, enabling automatic FluentValidation of that DTO by the validating decorator before the handler runs.
- **Depends on**: nothing first-party at the interface level; the validation plumbing resolves FluentValidation's `IValidator<TRequest>` from DI and is enforced by [ValidatingCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#validatingcommanddecoratortcommand-tresult) via the framework-supplied [CommandRequestValidator<TCommand, TRequest>](group-06-validation.md#commandrequestvalidatortcommand-trequest). Cross-reference [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult).
- **Concept introduced, automatic validator wiring via an interface contract.** `[Rubric §24, Forms, Validation & UX Safety]` assesses how server-side validation is centralised rather than scattered; instead of each handler calling `_validator.ValidateAsync(command.Request)`, the framework auto-registers a `CommandRequestValidator<TCommand, TRequest>` for any command implementing this interface using **`TryAdd` semantics**: so an explicit `IValidator<TCommand>` always wins and the auto-wired one only fills the gap (`ICommandWithRequest.cs:6-11`). `[Rubric §1, SOLID]` (OCP): new commands get validation for free by implementing the interface, with no decorator or registration change.
- **Walkthrough**: line 14: `public interface ICommandWithRequest<out TRequest>`. The `out` (covariant) position means a command whose request is a derived type satisfies a constraint expecting the base request type. Line 17: `TRequest Request { get; }`, the embedded payload, typically deserialized from the HTTP body.
- **Why it's built this way**: it collapses the typical web-API pattern ("receive body → map to command → validate body → call handler") into "map to command (which implements `ICommandWithRequest`) → decorator validates → handler runs," removing per-handler validation boilerplate.
- **Where it's used**: implemented by the bulk of write commands in ADC and Store where the command wraps a request record from the HTTP body.

---

### ICreateRequest
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICreateRequest.cs:8` · Level 0 · interface (marker, empty)

- **What it is**: an empty marker interface for "create" request DTOs, used as a generic type constraint by `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` to distinguish create-mapping from update-mapping at the type-system level.
- **Depends on**: nothing. Same presence-as-signal marker pattern as [ITransactional](#itransactional).
- **Concept introduced, type-system constraints as documentation *and* enforcement.** `[Rubric §9, API & Contract Design]` assesses how request contracts are modelled and kept unambiguous; tagging a DTO as "this is a create" lets generic mapper infrastructure (G12) refuse anything that is not a create request on the create-mapping path, catching wiring mistakes at compile time rather than at runtime.
- **Walkthrough**: the body is empty (`{ }`, lines 8-10). All of its value is in the type hierarchy.
- **Why it's built this way**: a mapper constrained to `where TCreateRequest : ICreateRequest` makes it impossible to pass an update-request DTO into the create-mapping path, with no runtime check needed.
- **Where it's used**: implemented by create-request DTOs in every module (e.g. `EventCreateRequest`, `SessionCreateRequest`, `SpeakerCreateRequest`, `ProductCreateRequest`). Consumed as a generic constraint by [IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (G12).

---

### IFeatureGated
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/IFeatureGated.cs:10` · Level 0 · interface

- **What it is**: an opt-in interface that causes both command and query handlers to be gated by Microsoft.FeatureManagement before execution. When the named feature is disabled, the gate short-circuits and returns a failure result without calling the handler.
- **Depends on**: nothing first-party at the interface level; enforcement lives in [FeatureGateCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult) and [FeatureGateQueryDecorator<TQuery, TResult>](group-05-cqrs-pipeline.md#featuregatequerydecoratortquery-tresult), which depend on `IFeatureManager` (Microsoft.FeatureManagement) and call `IsEnabledAsync(FeatureName)` (`IFeatureGated.cs:5-8`).
- **Concept introduced, feature flags as a cross-cutting pipeline concern.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether concerns like flags, logging, and caching are factored out of business logic; the gate sits at the handler boundary (the **outermost** command decorator, see [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult)), so no caller needs a flag check and the handler has no flag knowledge. Feature-name constants live in module classes (e.g. [NotificationFeatures](group-10-notifications.md#notificationfeatures)) to avoid magic strings.
- **Walkthrough**: line 10: `public interface IFeatureGated`. Line 16: `string FeatureName { get; }`, must match a key in the `FeatureManagement` configuration section.
- **Why it's built this way**: putting the gate in the pipeline applies it uniformly to every gated handler with zero per-handler boilerplate, and the same interface serves commands *and* queries because a feature-gate decorator is registered for both handler base interfaces.
- **Where it's used**: implemented by handlers for features under controlled rollout (e.g. notification push features in ADC). Feature state is read from `appsettings.json` / Azure App Configuration at runtime.

---

### IQueryCacheable
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/IQueryCacheable.cs:8` · Level 0 · interface

- **What it is**: the query-side opt-in for caching: a query implements this to declare a `CacheKey` (the exact lookup key for this query's result) and a `CacheDuration` (per-query TTL). [CachingQueryDecorator<TQuery, TResult>](group-05-cqrs-pipeline.md#cachingquerydecoratortquery-tresult) checks the cache on the way in and stores the result on a miss.
- **Depends on**: nothing first-party. Query-side companion to [ICacheInvalidating](#icacheinvalidating); implemented through [ICacheService](group-09-caching.md#icacheservice).
- **Concept introduced**: `[Rubric §12, Performance & Scalability]`. `CacheKey` must encode every query parameter that affects the result (e.g. `"Catalog:Products:page=1&size=10"`, `IQueryCacheable.cs:11-12`); omit one and the cache returns stale results for a different query shape. `CacheDuration` gives per-query TTL control so high-volume stable lists can cache longer than volatile data, and, being on the interface, not in config, keeps each query the owner of its own staleness budget.
- **Walkthrough**: line 8: `public interface IQueryCacheable`. Line 14: `string CacheKey { get; }`, computed from the query's own properties. Line 19: `TimeSpan CacheDuration { get; }`.
- **Why it's built this way**: opt-in means only queries that genuinely benefit (frequently-called, expensive, not user-specific) pay the serialization overhead.
- **Where it's used**: adopted by exactly **one production query** today. Verified by source search across all three repos, the only production type implementing `IQueryCacheable` is ADC's `GetNowNextQuery` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:23`, added [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8): a hot, public, non-user-specific home-screen "now / next" read that keys under the `Session` aggregate prefix with a 30-second `CacheDuration`, and is guarded by `GetNowNextQueryCacheTests.cs`. The framework's own `CacheableTestQuery` / `StampedeTestQuery` (`CachingQueryDecoratorTests.cs`) still exercise the decorator directly. Every other query falls through the decorator's early-return (no-cache) path, and production read-side caching is otherwise done at the HTTP layer via **ASP.NET Core OutputCache**, the Conference read controllers (`EventsController`, `SessionsController`, `SessionSpeakersController`, …) use named output-cache policies configured by `AddOutputCache` in the service `Program.cs` files. Contrast the write-side sibling [ICacheInvalidating](#icacheinvalidating), which **is** broadly adopted. One honest caveat: prefix eviction for `GetNowNextQuery` only engages once an `IConnectionMultiplexer` is registered (not wired on the deployed services today), so its 30-second TTL, not prefix invalidation, is currently the real staleness backstop.
- **Caveats / not-in-source**: the read-cache *mechanism* is fully functional, unit-tested, and adopted by exactly one production query (`GetNowNextQuery`) today; most reads still cache at the HTTP layer. If you add a hot, non-user-specific query you can opt in by implementing this, but do **not** assume an arbitrary existing query is cached through this path (they mostly aren't).

---

### IQueryHandler<in TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/IQueryHandler.cs:9` · Level 0 · interface

- **What it is**: the CQRS query-handler contract: `HandleAsync` accepts a read-only query and returns a result without mutating state.
- **Depends on**: BCL only. Mirrors [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult) on the read side.
- **Concept introduced**: `[Rubric §6, CQRS & Event-Driven]`: the query side of the segregation. Queries carry no side effects, so their decorator pipeline is lighter. The **verified registration** in `DependencyInjection.cs:101-103` registers (innermost→outermost) `Caching → Logging → FeatureGate`, so the **execution order is** `FeatureGate → Logging → Caching → concrete handler`. Notably absent versus the command side: the **Validating** and **Transactional** decorators, queries don't mutate, so neither concern applies.
- **Walkthrough**: line 9: `public interface IQueryHandler<in TQuery, TResult>`, same contravariant `in` on the query type. Line 17: `Task<TResult> HandleAsync(TQuery query, CancellationToken cancellationToken = default);`.
- **Why it's built this way**: an identical shape to `ICommandHandler` (for the same Scrutor-discoverability and open-generic decorator reasons), but kept as a separate interface so DI can tell "this is a query" from "this is a command" and apply the correct, lighter decorator set.
- **Where it's used**: every read handler in ADC and Store, plus the framework's notification query handlers (G10). A dispatcher / direct DI resolution invokes the correct closed implementation.
- **Caveats / not-in-source**: like the command side, `ProfilingQueryDecorator` is added only by the opt-in `AddApplicationProfiling()` (`DependencyInjection.cs:189`), not the standard pipeline.

---

### ITransactional
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ITransactional.cs:6` · Level 0 · interface (marker)

- **What it is**: a C# empty-body interface (`public interface ITransactional;`) that command handlers implement to opt in to database-transaction wrapping by [TransactionalCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult).
- **Depends on**: nothing (BCL only).
- **Concept introduced, marker interfaces as opt-in decorator switches.** `[Rubric §2, Design Patterns]` assesses the deliberate, idiomatic use of patterns; a **marker interface** carries no members, its mere presence on a type is the signal. The transactional decorator checks `handler is ITransactional` before opening a transaction. This is also `[Rubric §1, SOLID]` (OCP): the pipeline is open for extension (new handlers opt in by implementing this) with no change to existing decorators. The C# semicolon-body syntax (`interface ITransactional;`, line 6) is the idiomatic zero-member declaration, adopted consistently across the framework's marker interfaces.
- **Walkthrough**: the entire file body is `public interface ITransactional;` at line 6. No members; the type *is* the message.
- **Why it's built this way**: keeping transaction scope opt-in spares read-only or single-statement commands the overhead of `BEGIN TRANSACTION / COMMIT`. Handlers that mutate multiple aggregates (or write an aggregate plus an outbox row) opt in; lightweight commands don't.
- **Where it's used**: implemented by multi-aggregate / outbox-writing command handlers. Inspected at resolution time by [TransactionalCommandDecorator<TCommand, TResult>](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult), the **innermost** command decorator (so it sits closest to the handler, see the registration note under [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult)).

---

### DeleteEntityHandler<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:14` · Level 8 · class

- **What it is**: the *generic* delete handler that works for any aggregate root, registered for [DeleteEntityCommand<TEntity, TIdentifierType>](#deleteentitycommandtentity-tidentifiertype).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (constructor-injected, line 15); constrained `where TEntity : AuditableAggregateRootEntity<TIdentifierType>` ([AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), line 17) and `where TIdentifierType : notnull` (line 18). Returns [Result](group-01-result-error-handling.md#result); implements [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult).
- **Concept reinforced, one handler, every aggregate.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §1, SOLID]` (DRY/SRP). The body (`DeleteEntityHandler.cs:21-35`) is the delete template made generic: get the repository via `unitOfWork.GetRepository<TEntity, TIdentifierType>()` (line 25); load by id and return `Error.NotFound` (sourced/targeted with the handler and entity names) if missing (lines 26-28); call `entity.Delete()`, which soft-deletes and may enforce rules / raise domain events (line 30); and `SaveChangesAsync` **only when** `result.IsSuccess` (lines 31-32). This is the default the aggregate-root controllers' delete slot resolves to, *unless* a module registers a custom override (e.g. ADC's `DeleteEventHandler`, which needs a cross-aggregate cascade).
- **Why it's built this way**: most deletes are identical (load → `Delete()` → save), so the framework supplies the handler once via Common's `Delete()` + soft-delete convention ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)); a module overrides only when there is a cascade or extra rule. Returning the entity's own `Delete()` `Result` lets a domain-level refusal (e.g. "cannot delete a published event") propagate without an exception.
- **Where it's used**: registered generically; consumed by the aggregate-root controller delete actions ([AggregateRootEntityControllerBase<...>](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest), G12).
- **Caveats / not-in-source**: `DeleteEntityHandler` is **not** marked [ITransactional](#itransactional), so a delete that raises domain events relies on `SaveChangesAsync` writing the data + outbox rows atomically rather than on an explicit handler-level transaction; the outbox is the durability mechanism ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).

### CqrsMetrics
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs:12` · Level 0 · class (static, internal)

- **What it is**: an `internal static` class that owns one `System.Diagnostics.Metrics.Meter` and two duration histograms (`cqrs.command.duration`, `cqrs.query.duration`). The logging decorators record into these on every command and query, giving RED (Rate / Errors / Duration) instrumentation for the whole CQRS pipeline.
- **Depends on**: BCL only (`System.Diagnostics.Metrics`). Recorded into by [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult) and [LoggingQueryDecorator<TQuery, TResult>](#loggingquerydecoratortquery-tresult).
- **Concept introduced, BCL-native metrics + RED instrumentation.** `[Rubric §13, Observability & Operability]` assesses whether every unit of work emits rate, error, and latency signals that an operator can dashboard and alert on. A single histogram tagged by `outcome` supplies all three dimensions at once: the measurement value is duration, the count is the rate, and the count filtered to a failure `outcome` is the error rate. Using `System.Diagnostics.Metrics` (not a third-party client) means the OpenTelemetry SDK exports these automatically once a host registers the meter name; the Aspire service defaults (`ConfigureOpenTelemetry`) do exactly that. The doc comment (`CqrsMetrics.cs:8-10`) notes the meter name is duplicated as a literal string in `MMCA.Common.Aspire` because that package holds no reference to Application, so both registrations must agree on the name by hand.
- **Walkthrough**
  - `MeterName` (`CqrsMetrics.cs:15`): `internal const string = "MMCA.Common.Cqrs"`, the single name a host registers for export.
  - `Meter` (`CqrsMetrics.cs:17`): a `private static readonly Meter` created once at class initialization, so no instrument is re-registered across decorator instances.
  - `CommandDuration` (`CqrsMetrics.cs:20-23`) and `QueryDuration` (`CqrsMetrics.cs:26-29`): `internal static readonly Histogram<double>` instruments named `cqrs.command.duration` / `cqrs.query.duration`, unit `"ms"`. `internal` visibility means only decorators in this assembly can record measurements, so no external code can pollute the series.
- **Why it's built this way**: one static holder avoids the duplicate-instrument warnings that would fire if each closed decorator created its own meter, and `internal` keeps the recording surface closed to the pipeline. The tag dimension (rather than three separate counters) is the idiomatic OpenTelemetry shape for RED.
- **Where it's used**: [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult) records `CommandDuration` in its `finally`; [LoggingQueryDecorator<TQuery, TResult>](#loggingquerydecoratortquery-tresult) records `QueryDuration`. `MMCA.Common.Aspire` registers the meter name for OTel export.
- **Caveats / not-in-source**: the `outcome` tag values are set by the logging decorators, not here: they are `"completed"`, `"failed"`, or `"exception"` (see [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult)), not a bare success/failure pair.

---

### QueryCacheKeyLocks
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:71` · Level 0 · class (static, internal)

- **What it is**: a tiny `internal static` holder for the process-wide table of per-cache-key locks used by [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult) for cache-stampede protection. It exposes a single field: a `ConcurrentDictionary<string, SemaphoreSlim>`.
- **Depends on**: BCL only (`System.Collections.Concurrent`, `System.Threading.SemaphoreSlim`). Consumed exclusively by [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult).
- **Concept introduced, why the lock table lives in a non-generic class.** `[Rubric §12, Performance & Scalability]` assesses whether a cache guards against the stampede (thundering herd) where many concurrent requests all miss a just-expired hot key and all run the expensive query at once. The lock table must be shared by every request for the same key, but the decorator is an open generic (`CachingQueryDecorator<TQuery, TResult>`): a `static` field on a generic type is per closed type, so `CachingQueryDecorator<QueryA, ...>` and `CachingQueryDecorator<QueryB, ...>` would get separate tables and never serialize on a shared key. Hoisting the table into this non-generic holder (the doc comment states this rationale, `CachingQueryDecorator.cs:66-70`) gives every closed decorator one shared table keyed by the cache-key string.
- **Walkthrough**: `Locks` (`CachingQueryDecorator.cs:74`): `internal static readonly ConcurrentDictionary<string, SemaphoreSlim>` built with `StringComparer.Ordinal` (exact, culture-insensitive key comparison). Entries are added on a miss and eagerly removed when no waiters remain, so the table does not grow unbounded (see the `finally` block of the decorator).
- **Why it's built this way**: it is the same per-key double-check-locking pattern as [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter), factored into a shared, non-generic table so the generic decorator can still coordinate across all closed instantiations.
- **Where it's used**: only by [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult), which calls `QueryCacheKeyLocks.Locks.GetOrAdd(...)` on the slow (cache-miss) path.

---

### ProfilingCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ProfilingCommandDecorator.cs:11` · Level 1 · class (sealed)

- **What it is**: a decorator that wraps command handler execution in a MiniProfiler step, so each command shows up as a timed node in a MiniProfiler trace.
- **Depends on**: `StackExchange.Profiling` (NuGet, MiniProfiler); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult) (the inner handler it wraps and the interface it implements).
- **Concept introduced, opt-in performance profiling separate from the standard pipeline.** `[Rubric §13, Observability & Operability]` assesses developer-facing profiling for pinpointing where time goes inside a request. This is the classic Decorator shape (a handler that holds a handler), but unlike the five standard decorators it is **not** registered by `AddApplicationDecorators()`. It is added only by the separate `AddApplicationProfiling()` extension (`DependencyInjection.cs:188`), which a host calls when it wants MiniProfiler; production hosts that do not enable MiniProfiler never pay for it.
- **Walkthrough**: `HandleAsync` (`ProfilingCommandDecorator.cs:15`) opens `using var step = MiniProfiler.Current?.Step($"CommandHandler: {typeof(TCommand).Name}")` (`ProfilingCommandDecorator.cs:17`) then awaits the inner handler. The null-conditional `?.Step(...)` makes the whole thing a no-op when MiniProfiler is not active for the current request, so there is no cost when profiling is off; the step name carries the command type name for a readable profile.
- **Why it's built this way**: keeping profiling in its own opt-in decorator (rather than in the always-on logging decorator) means the profiler overhead and its ambient-profiler dependency only exist when a host explicitly turns it on.
- **Where it's used**: registered by `AddApplicationProfiling()` (`DependencyInjection.cs:186-192`) to wrap every command handler; only active behind the MiniProfiler middleware wired in the API layer (see [MiniProfilerExtensions](group-12-api-hosting-mapping.md#miniprofilerextensions)).

---

### ProfilingQueryDecorator<TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ProfilingQueryDecorator.cs:11` · Level 1 · class (sealed)

- **What it is**: the query-side twin of [ProfilingCommandDecorator<TCommand, TResult>](#profilingcommanddecoratortcommand-tresult). Same shape, one method, wrapping an [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult).
- **Depends on**: `StackExchange.Profiling` (NuGet); [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult).
- **Concept reinforced**: see [ProfilingCommandDecorator<TCommand, TResult>](#profilingcommanddecoratortcommand-tresult). `[Rubric §13, Observability & Operability]`. Also registered only by the opt-in `AddApplicationProfiling()` (`DependencyInjection.cs:189`), never by the standard `AddApplicationDecorators()`.
- **Walkthrough**: `HandleAsync` (`ProfilingQueryDecorator.cs:15`) opens `MiniProfiler.Current?.Step($"QueryHandler: {typeof(TQuery).Name}")` (`ProfilingQueryDecorator.cs:17`), a no-op when the profiler is inactive, then awaits the inner query handler.
- **Where it's used**: registered by `AddApplicationProfiling()` to wrap every query handler; active only behind the MiniProfiler middleware.

---

### CachingCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingCommandDecorator.cs:16` · Level 3 · class (sealed)

- **What it is**: the caching decorator on the command side. It does not cache anything; it **invalidates** cached read data after a successful mutation, but only when the command opts in via [ICacheInvalidating](#icacheinvalidating).
- **Depends on**: [ICacheInvalidating](#icacheinvalidating) (the opt-in marker exposing `CachePrefix`); [ICacheService](group-09-caching.md#icacheservice) (the eviction mechanism); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); [Result](group-01-result-error-handling.md#result) (matched to detect failure).
- **Concept introduced, invalidate-on-success, never on failure.** `[Rubric §12, Performance & Scalability]` assesses whether write-side invalidation keeps read caches coherent without over-evicting. The invariant (doc comment `CachingCommandDecorator.cs:9-12`) is that eviction fires only when the command both implements [ICacheInvalidating](#icacheinvalidating) and returned a non-failure result: a business failure did not mutate anything, so evicting valid cache entries on failure would just cost concurrent readers a needless miss. In the pipeline this decorator sits between Logging (outer) and Validating (inner), so invalidation runs after the transaction has committed (see the registration order under [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult)).
- **Walkthrough**
  - `HandleAsync` (`CachingCommandDecorator.cs:21`): awaits `inner.HandleAsync(...)` first (`CachingCommandDecorator.cs:23`), so the mutation always runs before any cache decision.
  - Invalidation guard (`CachingCommandDecorator.cs:26`): `command is ICacheInvalidating cacheInvalidating && !IsFailure(result)`; on both being true it calls `cacheService.RemoveByPrefixAsync(cacheInvalidating.CachePrefix, ...)` (`CachingCommandDecorator.cs:28`), evicting the whole prefix segment the command declared.
  - `IsFailure` (`CachingCommandDecorator.cs:39-40`): `result is Shared.Abstractions.Result { IsFailure: true }`, pattern matching because `TResult` is not constrained to a `Result` type, so this handles both `Result` and `Result<T>` uniformly.
- **Why it's built this way**: the command names *what* to evict (its `CachePrefix`); the decorator plus [ICacheService](group-09-caching.md#icacheservice) own *how*. Handlers stay free of cache-infrastructure knowledge, and the success-only rule matches the pipeline contract that a `Result.Failure` still commits but skips invalidation (`DependencyInjection.cs:80-84`).
- **Where it's used**: wraps every command handler; only commands whose `TCommand` implements [ICacheInvalidating](#icacheinvalidating) actually evict (broadly adopted across ADC and Store write commands, see [ICacheInvalidating](#icacheinvalidating)).

---

### CachingQueryDecorator<TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:16` · Level 3 · class (sealed)

- **What it is**: the read-caching decorator. On a cache hit it returns the stored result without touching the inner handler; on a miss it runs the handler once (under a per-key lock) and caches the non-failure result. It only engages for queries that opt in via [IQueryCacheable](#iquerycacheable).
- **Depends on**: [IQueryCacheable](#iquerycacheable) (exposes `CacheKey` + `CacheDuration`); [ICacheService](group-09-caching.md#icacheservice); [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult); [QueryCacheKeyLocks](#querycachekeylocks) (the shared lock table); [Result](group-01-result-error-handling.md#result).
- **Concept introduced, cache-stampede protection via per-key double-check locking.** `[Rubric §12, Performance & Scalability]` assesses read-side caching and, critically, what happens when a hot key expires under load. A naive cache would let every concurrent request miss and all run the expensive query at once (the thundering-herd problem). This decorator instead uses the same double-check pattern as [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter): a fast lock-free hit path, and a slow path where exactly one request holds a per-key `SemaphoreSlim` from [QueryCacheKeyLocks](#querycachekeylocks) and populates the cache while the rest wait and are then served the freshly cached entry.
- **Walkthrough**
  - Opt-out (`CachingQueryDecorator.cs:23-24`): `query is not IQueryCacheable` short-circuits straight to the inner handler, so non-cacheable queries pay nothing.
  - Fast path (`CachingQueryDecorator.cs:27-30`): a lock-free `cacheService.GetAsync<TResult>(cacheable.CacheKey, ...)`; a non-null hit returns immediately with no lock taken.
  - Slow path (`CachingQueryDecorator.cs:35-36`): `QueryCacheKeyLocks.Locks.GetOrAdd(cacheable.CacheKey, static _ => new SemaphoreSlim(1, 1))` then `await keyLock.WaitAsync(...)`, so only one request per key proceeds.
  - Double-check (`CachingQueryDecorator.cs:39-42`): inside the lock it re-reads the cache; a waiter that arrived while the leader populated returns the fresh entry without re-running the query.
  - Populate (`CachingQueryDecorator.cs:44-51`): the leader runs `inner.HandleAsync(...)` and stores the result via `SetAsync(cacheable.CacheKey, result, cacheable.CacheDuration, ...)` **only** when the result is not `Result { IsFailure: true }`, so failures are never cached.
  - Cleanup (`CachingQueryDecorator.cs:57-61`): the `finally` releases the semaphore and eagerly removes it from the table when `keyLock.CurrentCount == 1` (no waiters), keeping the lock table bounded.
- **Why it's built this way**: per-query `CacheKey`/`CacheDuration` (owned by the query) plus stampede-safe locking gives a correct, self-cleaning application-layer read cache. Keeping the semaphore table in the non-generic [QueryCacheKeyLocks](#querycachekeylocks) is what lets all closed decorators share one lock per key.
- **Where it's used**: wraps every query handler; it engages for the one production query that opts in (ADC's [`GetNowNextQuery`](#iquerycacheable), [ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html) Wave 8) and is a pass-through for every other query today. As verified for [IQueryCacheable](#iquerycacheable), production read caching is otherwise done at the HTTP layer with ASP.NET Core OutputCache. This decorator is a tested extension point with a single in-use adopter rather than a broadly-relied-on one.
- **Caveats / not-in-source**: the class file also declares the [QueryCacheKeyLocks](#querycachekeylocks) holder below it (`CachingQueryDecorator.cs:71`), which is documented as its own type in this group.

---

### LoggingCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:14` · Level 3 · class (sealed, partial)

- **What it is**: the observability decorator on the command side. It opens a correlated logging scope, times the full inner pipeline with a `Stopwatch`, logs start/completion/failure/exception, and records the duration into [CqrsMetrics](#cqrsmetrics). In the standard pipeline it is the second-outermost command decorator (just inside FeatureGate).
- **Depends on**: [CqrsMetrics](#cqrsmetrics); [ICorrelationContext](group-12-api-hosting-mapping.md#icorrelationcontext) (supplies the `CorrelationId`); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); [Result](group-01-result-error-handling.md#result); `Microsoft.Extensions.Logging` (BCL/NuGet).
- **Concept introduced, structured logging + metrics as a single cross-cutting stage.** `[Rubric §13, Observability & Operability]` assesses whether every command emits correlated, structured logs and a latency/outcome metric without per-handler boilerplate; `[Rubric §10, Cross-Cutting Concerns]` assesses factoring that out of business logic. Every command is logged and measured uniformly regardless of whether it is cached, validated, or transactional, because this decorator sits above those in the chain. `[Rubric §12, Performance & Scalability]` also applies: the log paths use the `[LoggerMessage]` source generator and a source-generated scope, so the hot path avoids interpolation and per-call dictionary boxing.
- **Walkthrough**
  - Scope (`LoggingCommandDecorator.cs:25`): `using (BeginCommandScope(logger, commandName, correlationId))` opens a structured scope so inner decorators and the handler share `CommandName` + `CorrelationId`. `BeginCommandScope` is a `static readonly` `LoggerMessage.DefineScope<string, string>(...)` (`LoggingCommandDecorator.cs:70-71`), the allocation-light alternative to an anonymous-dictionary `BeginScope`.
  - Start (`LoggingCommandDecorator.cs:27`): `LogCommandStarted` at `Debug` (`LoggingCommandDecorator.cs:75`), deliberately not `Information` (the completion line already carries name and duration, and two `Information` rows per command would double ingestion cost, per the inline comment).
  - Timing + outcome (`LoggingCommandDecorator.cs:29-30`): `Stopwatch.StartNew()`, `outcome = "completed"` default.
  - Failure branch (`LoggingCommandDecorator.cs:36-41`): on `Result { IsFailure: true }`, sets `outcome = "failed"`, builds an error summary from `Errors`, and logs `LogCommandFailed` at `Warning` (a business failure is not an exception).
  - Success (`LoggingCommandDecorator.cs:44`): `LogCommandCompleted` at `Information`.
  - Exception branch (`LoggingCommandDecorator.cs:49-55`): `outcome = "exception"`, `LogCommandException` at `Error`, then rethrow.
  - Metric (`LoggingCommandDecorator.cs:57-62`): the `finally` always records `CqrsMetrics.CommandDuration` tagged `command` and `outcome`, so a metric point is emitted even on a throw.
- **Why it's built this way**: `partial class` + `[LoggerMessage]` (`LoggingCommandDecorator.cs:75-85`) is the .NET-recommended high-performance structured logging shape; the three-valued `outcome` tag (`"completed"` / `"failed"` / `"exception"`) lets a dashboard separate success from domain failure from a genuine exception on one histogram.
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:97`) to wrap every command handler.

---

### LoggingQueryDecorator<TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:13` · Level 3 · class (sealed, partial)

- **What it is**: the query-side twin of [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult): correlated scope, `Stopwatch` timing, completion/failure/exception logging, and a [CqrsMetrics](#cqrsmetrics) duration recording.
- **Depends on**: [CqrsMetrics](#cqrsmetrics); [ICorrelationContext](group-12-api-hosting-mapping.md#icorrelationcontext); [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult); [Result](group-01-result-error-handling.md#result); `Microsoft.Extensions.Logging`.
- **Concept reinforced**: see [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult). `[Rubric §13, Observability & Operability]` and `[Rubric §10, Cross-Cutting Concerns]`.
- **Walkthrough**: `HandleAsync` (`LoggingQueryDecorator.cs:19`) opens a `BeginScope` with a `Dictionary` keyed `CorrelationId` + `QueryName` (`LoggingQueryDecorator.cs:24-28`), times the inner handler, and in the `finally` records `CqrsMetrics.QueryDuration` tagged `query` + `outcome` (`LoggingQueryDecorator.cs:59-63`). Two differences from the command side are worth noting: (1) query **completion** logs at `Debug` (`LoggingQueryDecorator.cs:67`), not `Information`, since reads are far more frequent than writes; and (2) the scope uses a plain `Dictionary` rather than the source-generated `DefineScope` the command decorator uses. Failure still logs `Warning` (`LoggingQueryDecorator.cs:70`) and exception `Error` (`LoggingQueryDecorator.cs:73`).
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:102`) to wrap every query handler.

---

### ResultFailureFactory
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ResultFailureFactory.cs:11` · Level 3 · class (static, internal)

- **What it is**: an `internal static` helper that builds a cached delegate turning an `IEnumerable<Error>` into a `TResult` failure, working for both non-generic [Result](group-01-result-error-handling.md#result) and generic `Result<T>`, without constraining the caller's `TResult`.
- **Depends on**: [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error); BCL (`System.Linq.Expressions`, `System.Reflection`).
- **Concept introduced, short-circuiting an unconstrained generic pipeline.** `[Rubric §15, Best Practices & Code Quality]` assesses how the codebase solves an awkward generic problem cleanly. The decorators need to *fail* a handler call without running the inner handler, but their `TResult` is an open type parameter that is either `Result` or `Result<T>`; you cannot write `return Result.Failure<T>(...)` when you do not know `T`. Constraining `TResult : Result` would break the handler interface contract, so instead this factory isolates the reflection to one place and, for the generic branch, compiles it into a delegate so the per-call cost is a plain invocation, not `MethodInfo.Invoke`.
- **Walkthrough**
  - `Build<TResult>()` (`ResultFailureFactory.cs:20`): the single entry point.
  - Non-generic branch (`ResultFailureFactory.cs:22-24`): when `TResult == Result`, returns `errors => (TResult)(object)Result.Failure(errors)`.
  - Generic branch (`ResultFailureFactory.cs:27-41`): when `TResult` is a closed `Result<>`, it reflects the static generic `Result.Failure` overload taking `IEnumerable<Error>` (`ResultFailureFactory.cs:30-36`), closes it over the inner type, and compiles an `Expression.Lambda<Func<IEnumerable<Error>, TResult>>` (`ResultFailureFactory.cs:38-40`). The reflection and compilation happen once per closed type, at warm-up.
  - Guard (`ResultFailureFactory.cs:43-45`): any other `TResult` throws `InvalidOperationException` naming the unsupported type.
- **Why it's built this way**: compiling the expression once per type keeps the short-circuit path allocation-light and reflection-free after warm-up, and centralizes the one piece of generic reflection so the decorators stay readable.
- **Where it's used**: cached into a `static readonly CreateFailure` field by [FeatureGateCommandDecorator<TCommand, TResult>](#featuregatecommanddecoratortcommand-tresult), [FeatureGateQueryDecorator<TQuery, TResult>](#featuregatequerydecoratortquery-tresult), and [ValidatingCommandDecorator<TCommand, TResult>](#validatingcommanddecoratortcommand-tresult).

---

### FeatureGateCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs:18` · Level 4 · class (sealed)

- **What it is**: the outermost standard command decorator. When a command implements [IFeatureGated](#ifeaturegated) and its feature flag is off, it short-circuits with a `NotFound` failure, before any logging, caching, validation, or transaction work.
- **Depends on**: [IFeatureGated](#ifeaturegated) (the opt-in marker exposing `FeatureName`); [Error](group-01-result-error-handling.md#error) / [ErrorType](group-01-result-error-handling.md#errortype); [ResultFailureFactory](#resultfailurefactory); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); `Microsoft.FeatureManagement.IFeatureManager` (NuGet).
- **Concept introduced, feature-flag gating in the pipeline.** `[Rubric §10, Cross-Cutting Concerns]` assesses centralized feature-flag enforcement rather than a flag check duplicated in every handler. Registered as the outermost command decorator (`DependencyInjection.cs:98`), a disabled feature is rejected first, so no downstream work happens. Commands that do not implement [IFeatureGated](#ifeaturegated) pass through via a type test at no cost. `[Rubric §12, Performance & Scalability]` also applies through the cached `CreateFailure` delegate.
- **Walkthrough**
  - `CreateFailure` (`FeatureGateCommandDecorator.cs:27`): `static readonly Func<IEnumerable<Error>, TResult>` built once per closed type via [ResultFailureFactory](#resultfailurefactory).`Build<TResult>()`.
  - `HandleAsync` (`FeatureGateCommandDecorator.cs:30`): `command is not IFeatureGated` passes straight through (`FeatureGateCommandDecorator.cs:32`); otherwise `await featureManager.IsEnabledAsync(featureGated.FeatureName)` (`FeatureGateCommandDecorator.cs:35`, async to support remote/config-backed flag stores). Enabled runs the inner handler; disabled returns `CreateFailure([Error.NotFoundError("Feature.Disabled", ...)])` (`FeatureGateCommandDecorator.cs:38-40`).
- **Why it's built this way**: putting the gate in a decorator means handlers never inject `IFeatureManager`; a command opts in simply by implementing [IFeatureGated](#ifeaturegated). Returning `NotFound` (not `Forbidden`) tells the client the endpoint "does not currently exist" rather than "is forbidden to you".
- **Where it's used**: registered by `AddApplicationDecorators()` as the outermost decorator on every command handler; engages only for commands implementing [IFeatureGated](#ifeaturegated).

---

### FeatureGateQueryDecorator<TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateQueryDecorator.cs:18` · Level 4 · class (sealed)

- **What it is**: the query-side twin of [FeatureGateCommandDecorator<TCommand, TResult>](#featuregatecommanddecoratortcommand-tresult): the outermost standard query decorator, rejecting a gated query with `NotFound` when its feature flag is off.
- **Depends on**: [IFeatureGated](#ifeaturegated); [Error](group-01-result-error-handling.md#error) / [ErrorType](group-01-result-error-handling.md#errortype); [ResultFailureFactory](#resultfailurefactory); [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult); `Microsoft.FeatureManagement`.
- **Concept reinforced**: identical pattern to [FeatureGateCommandDecorator<TCommand, TResult>](#featuregatecommanddecoratortcommand-tresult). `[Rubric §10, Cross-Cutting Concerns]`. The doc comment (`FeatureGateQueryDecorator.cs:12-14`) says "before logging or caching work": queries have no validation or transaction stage, so the list of things it front-runs is shorter.
- **Walkthrough**: `CreateFailure` (`FeatureGateQueryDecorator.cs:27`) cached per type; `HandleAsync` (`FeatureGateQueryDecorator.cs:30`) type-tests [IFeatureGated](#ifeaturegated), calls `IsEnabledAsync` (`FeatureGateQueryDecorator.cs:35`), and returns the same `Error.NotFoundError("Feature.Disabled", ...)` failure when disabled (`FeatureGateQueryDecorator.cs:38-40`).
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:103`) as the outermost decorator on every query handler.

---

### ValidatingCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:24` · Level 4 · class (sealed, partial)

- **What it is**: the decorator that runs FluentValidation against a command before the handler executes, turning validation failures into a [Result](group-01-result-error-handling.md#result) failure so the handler is never called with invalid input. It sits between Caching (outer) and Transactional (inner).
- **Depends on**: `FluentValidation.IValidator<TCommand>` (NuGet, resolved from DI); [Error](group-01-result-error-handling.md#error); [ResultFailureFactory](#resultfailurefactory); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); the `ToErrors` extension (`MMCA.Common.Application.Extensions`).
- **Concept introduced, automatic validation as a pipeline stage.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether server-side validation is applied consistently rather than hand-called per handler; `[Rubric §1, SOLID]` (SRP) assesses that validation is this decorator's single job and not the handler's. Placing it before [TransactionalCommandDecorator<TCommand, TResult>](#transactionalcommanddecoratortcommand-tresult) (doc comment `ValidatingCommandDecorator.cs:17-20`) means a syntactically invalid command never opens a database transaction. Commands with no registered validator pass straight through, so validation is present-when-registered, not a hard requirement.
- **Walkthrough**
  - `_validator` (`ValidatingCommandDecorator.cs:29`): `validators.FirstOrDefault()`, the first registered `IValidator<TCommand>` or null, resolved once at construction.
  - `CreateFailure` (`ValidatingCommandDecorator.cs:36`): the cached [ResultFailureFactory](#resultfailurefactory) delegate.
  - `HandleAsync` (`ValidatingCommandDecorator.cs:39`): a null `_validator` passes through (`ValidatingCommandDecorator.cs:41-44`); otherwise `await _validator.ValidateAsync(command, ...)` (`ValidatingCommandDecorator.cs:46`), and a valid result passes through (`ValidatingCommandDecorator.cs:47-50`).
  - Failure (`ValidatingCommandDecorator.cs:52-55`): `validationResult.ToErrors(typeof(TCommand).Name)` converts FluentValidation failures into an [Error](group-01-result-error-handling.md#error) list, logs at `Debug`, and returns `CreateFailure(errors)`.
  - Logging (`ValidatingCommandDecorator.cs:58-67`): `partial` + `[LoggerMessage]` generates the low-allocation `LogValidationFailure(logger, commandName, errorCount)`.
- **Why it's built this way**: it removes the "inject `IValidator<T>` and call `ValidateAsync` by hand" boilerplate from every handler; short-circuiting before the transaction stage spares the database from work on invalid input; failing to a `Result` (not throwing) keeps validation on the same error channel as domain rules.
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:95`); every command with a matching `IValidator<TCommand>` in DI (including the auto-wired `CommandRequestValidator<TCommand, TRequest>` from `ScanModuleApplicationServices`) is validated here.

---

### TransactionalCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:18` · Level 8 · class (sealed)

- **What it is**: the innermost standard command decorator (closest to the concrete handler). It wraps the handler in a database transaction only when the command opts in via [ITransactional](#itransactional); non-transactional commands pass straight through.
- **Depends on**: [ITransactional](#itransactional) (the opt-in marker); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (supplies `ExecuteInTransactionAsync`); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult).
- **Concept introduced, declarative transaction boundaries via a marker.** `[Rubric §2, Design Patterns]` assesses the deliberate use of the Decorator pattern; `[Rubric §10, Cross-Cutting Concerns]` assesses handling transactions once rather than per handler; `[Rubric §8, Data Architecture]` assesses deliberate transaction boundaries. The mechanism is small: a decorator that *is* an `ICommandHandler` holding an inner `ICommandHandler`. Because it is registered innermost (`DependencyInjection.cs:94`), the transaction opens closest to the handler and inside cache invalidation, so a business `Result.Failure` still commits (no data changed) while invalidation is skipped by the caching decorator outside it (the ordering contract described under [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult)).
- **Walkthrough**
  - `HandleAsync` (`TransactionalCommandDecorator.cs:23`): `if (command is not ITransactional) return await inner.HandleAsync(...)` (`TransactionalCommandDecorator.cs:26-27`), so most commands skip transaction machinery entirely.
  - Transactional path (`TransactionalCommandDecorator.cs:29-31`): otherwise `unitOfWork.ExecuteInTransactionAsync(ct => inner.HandleAsync(command, ct), cancellationToken)`, which commits on success and rolls back on any exception before it propagates.
- **Why it's built this way**: opt-in via a marker means only handlers that mutate multiple aggregates (or write an aggregate plus an outbox row) pay for a transaction, and the boundary is declared on the command (a domain-adjacent type), not buried in handler code. Because transactions are per physical data source with no two-phase commit, cross-source consistency is the outbox's job, not this decorator's ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The pipeline composition (Decorator over a base class) is what lets each concern live in its own type and be ordered at registration ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)).
- **Where it's used**: registered by `AddApplicationDecorators()` as the innermost command decorator; transparently active for any [ITransactional](#itransactional) command across both apps (for example handlers that create an aggregate and enqueue outbox events atomically).
- **Caveats / not-in-source**: the framework's generic `DeleteEntityHandler` is deliberately **not** [ITransactional](#itransactional): a soft-delete that raises domain events relies on `SaveChangesAsync` writing data and outbox rows in one transaction rather than on this decorator (see the note on `DeleteEntityHandler` in the sibling section for this group).


---
[⬅ Domain & Integration Events + Outbox Dual-Dispatch](group-04-events-outbox.md)  •  [Index](00-index.md)  •  [Validation ➡](group-06-validation.md)
