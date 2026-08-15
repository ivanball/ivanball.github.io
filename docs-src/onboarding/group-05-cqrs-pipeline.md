# 5. CQRS: Commands, Queries & the Decorator Pipeline

**What this group covers.** Every write and every read in an MMCA application is a *use case*: a
small, single-purpose object (a command or a query) handed to a handler that does exactly one thing.
This group is the framework's implementation of **CQRS** (Command/Query Responsibility Segregation)
and the cross-cutting pipeline wrapped around it. There are four families:

1. **The two handler contracts**, [`ICommandHandler<in TCommand, TResult>`](#icommandhandlerin-tcommand-tresult)
   and [`IQueryHandler<in TQuery, TResult>`](#iqueryhandlerin-tquery-tresult), plus the payload
   markers that describe a use case's shape: [`ICommandWithRequest<out TRequest>`](#icommandwithrequestout-trequest)
   (a command that embeds a request DTO) and [`ICreateRequest`](#icreaterequest) (the constraint that
   ties a create DTO to its mapper).
2. **The decorator pipeline**: five command decorators
   ([`FeatureGateCommandDecorator<TCommand, TResult>`](#featuregatecommanddecoratortcommand-tresult),
   [`LoggingCommandDecorator<TCommand, TResult>`](#loggingcommanddecoratortcommand-tresult),
   [`CachingCommandDecorator<TCommand, TResult>`](#cachingcommanddecoratortcommand-tresult),
   [`ValidatingCommandDecorator<TCommand, TResult>`](#validatingcommanddecoratortcommand-tresult),
   [`TransactionalCommandDecorator<TCommand, TResult>`](#transactionalcommanddecoratortcommand-tresult)),
   three query decorators
   ([`FeatureGateQueryDecorator<TQuery, TResult>`](#featuregatequerydecoratortquery-tresult),
   [`LoggingQueryDecorator<TQuery, TResult>`](#loggingquerydecoratortquery-tresult),
   [`CachingQueryDecorator<TQuery, TResult>`](#cachingquerydecoratortquery-tresult)), an optional
   profiling pair ([`ProfilingCommandDecorator<TCommand, TResult>`](#profilingcommanddecoratortcommand-tresult),
   [`ProfilingQueryDecorator<TQuery, TResult>`](#profilingquerydecoratortquery-tresult)), and the
   helpers they lean on: [`ResultFailureFactory`](#resultfailurefactory), [`CqrsMetrics`](#cqrsmetrics),
   [`TenantCacheKey`](#tenantcachekey), and the two lock tables
   [`QueryCacheKeyLocks`](#querycachekeylocks) and [`CacheKeyLocks`](#cachekeylocks).
3. **The opt-in marker interfaces** that let one use case switch one concern on:
   [`ITransactional`](#itransactional), [`ICacheInvalidating`](#icacheinvalidating),
   [`IQueryCacheable`](#iquerycacheable), [`IFeatureGated`](#ifeaturegated).
4. **The Application-layer contracts that sit beside the pipeline**, implemented in Infrastructure and
   consumed by use cases: [`ITenantContext`](#itenantcontext) (which tenant this scope runs as),
   [`IDistributedLock`](#idistributedlock) (mutual exclusion across replicas),
   [`IScheduledJob`](#ischeduledjob) (recurring work on a cron schedule), and
   [`IAuditTrailReader`](#iaudittrailreader) (the recorded change history of one entity).

This is the central column of `[Rubric §6, CQRS & Event-Driven]` (reads separated from writes,
intent-revealing use cases) and `[Rubric §10, Cross-Cutting Concerns]` (the place those concerns are
implemented once, uniformly, instead of scattered through handlers). The governing decision is
[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html), revised 2026-07-19 for
the transactional semantics described below.

## The shape: thin handlers, fat pipeline

A handler is deliberately tiny. [`ICommandHandler<in TCommand, TResult>`](#icommandhandlerin-tcommand-tresult)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandHandler.cs:9`) and
[`IQueryHandler<in TQuery, TResult>`](#iqueryhandlerin-tquery-tresult)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/IQueryHandler.cs:9`) are one method each,
`Task<TResult> HandleAsync(T, CancellationToken cancellationToken = default)`, with `in`
(contravariant) variance on the input (`ICommandHandler.cs:17`, `IQueryHandler.cs:17`). `TResult` is
almost always the [`Result`](group-01-result-error-handling.md#result) or `Result<T>` of the
[Result pattern](00-primer.md#2-architectural-styles-this-codebase-commits-to)
([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)): a handler returns a failure
value, it does not throw for expected error paths. **Commands** mutate state; **queries** are
side-effect-free reads. Splitting the two into distinct interfaces is what lets the container apply a
*different* set of cross-cutting concerns to each (writes get validation and transactions, reads get
result caching), and it is the boundary `[Rubric §1, SOLID]` rewards: each handler has one reason to
change, and each decorator one responsibility.

Everything that is *not* the business logic of a use case lives outside the handler, in a stack of
**decorators**. A decorator implements the same handler interface, takes the next handler in through
its primary constructor (`inner`), does its cross-cutting job, and delegates. Because each decorator
*is* an `ICommandHandler`/`IQueryHandler`, they nest arbitrarily and the concrete handler at the
bottom never knows it is wrapped. This is the textbook **Decorator pattern**
(`[Rubric §2, Design Patterns]`), applied at the application boundary so that logging, caching,
validation, feature flags, and transactions are each written *once* and reused by every handler in
every module, and so that the same behavior applies whether the call arrives over REST, gRPC, or an
integration-event consumer.

## How the pipeline is assembled (Scrutor, registration versus execution order)

The wiring lives in `DependencyInjection.cs`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:21`), exposed as
`extension(IServiceCollection services)` members (the C# `extension(T)` syntax,
[primer §4](00-primer.md#c-extensiont-types-read-this-once)). The sequence a host must follow is
strict and ordered:

1. `AddApplication()` registers the core singletons (settings facade, event dispatcher, navigation
   metadata, the [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline)) and
   Common's own validators (`DependencyInjection.cs:29-43`).
2. `ScanModuleApplicationServices<TAssemblyMarker>()` runs **once per module** and uses **Scrutor**
   assembly scanning to register domain and integration event handlers (singleton), DTO and request
   mappers (scoped), and every concrete `ICommandHandler<,>`/`IQueryHandler<,>` (scoped), plus
   FluentValidation validators (`DependencyInjection.cs:115-179`).
3. `AddApplicationDecorators()` is called **last** (`DependencyInjection.cs:89-106`). It uses Scrutor's
   `TryDecorate` to wrap the already-registered handlers. **This ordering is load-bearing**:
   `TryDecorate` can only wrap registrations that already exist, which is why decorators must come
   after every module's handler scan.

The subtle rule is **registration order versus execution order**. `TryDecorate` applies decorators in
*reverse* registration order, so the **last** one registered becomes the **outermost** wrapper. The
command registrations (`DependencyInjection.cs:94-98`), read top to bottom, therefore list
innermost-first, and the XML doc above them draws the resulting nesting
(`DependencyInjection.cs:53-61`):

```
FeatureGateCommandDecorator            outermost (registered last)
  -> LoggingCommandDecorator
    -> CachingCommandDecorator
      -> ValidatingCommandDecorator
        -> TransactionalCommandDecorator    innermost (registered first)
          -> ConcreteHandler                the actual business logic
```

The query side (`DependencyInjection.cs:101-103`) is lighter, since there is nothing to validate or
commit on a read:

```
FeatureGateQueryDecorator
  -> LoggingQueryDecorator
    -> CachingQueryDecorator
      -> ConcreteHandler
```

A separate, optional call layers MiniProfiler on top:
`AddApplicationProfiling()` (`DependencyInjection.cs:219-225`) registers
[`ProfilingCommandDecorator<TCommand, TResult>`](#profilingcommanddecoratortcommand-tresult)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ProfilingCommandDecorator.cs:11`,
one `MiniProfiler.Current?.Step(...)` around the inner call at `ProfilingCommandDecorator.cs:17`) and
its read twin [`ProfilingQueryDecorator<TQuery, TResult>`](#profilingquerydecoratortquery-tresult)
(`.../Decorators/ProfilingQueryDecorator.cs:11`). No host in this workspace calls it today: the only
call sites are the framework's own `DependencyInjectionTests`
(`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DependencyInjectionTests.cs:148`), which matches
[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)'s note that the
profiling pair is opt-in and unwired.

## Why this exact order, and what each layer guards

The nesting order is a deliberate cost-and-correctness argument, spelled out in the registration
XML-doc (`DependencyInjection.cs:72-86`):

- **Feature-gating is outermost** so a disabled feature is rejected with *zero* downstream work: no
  log scope, no cache touch, no validation, no transaction.
  [`FeatureGateCommandDecorator<TCommand, TResult>`](#featuregatecommanddecoratortcommand-tresult)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs:18`)
  and its read twin [`FeatureGateQueryDecorator<TQuery, TResult>`](#featuregatequerydecoratortquery-tresult)
  (`.../Decorators/FeatureGateQueryDecorator.cs:18`) call `IFeatureManager.IsEnabledAsync` only when
  the use case opts in via [`IFeatureGated`](#ifeaturegated) (`FeatureGateCommandDecorator.cs:48-52`)
  and short-circuit with a `NotFound` failure carrying the code `Feature.Disabled`
  (`FeatureGateCommandDecorator.cs:55-57`). A disabled feature reads as "this does not exist" rather
  than "you may not", which is the deliberate posture of
  [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html).
- **Logging sits just inside the gate** so it measures only *enabled* executions.
  [`LoggingCommandDecorator<TCommand, TResult>`](#loggingcommanddecoratortcommand-tresult)
  (`.../Decorators/LoggingCommandDecorator.cs:14`) opens a source-generated structured-logging scope
  carrying the command name and the `CorrelationId` from
  [`ICorrelationContext`](group-12-api-hosting-mapping.md#icorrelationcontext)
  (`LoggingCommandDecorator.cs:25`, `LoggingCommandDecorator.cs:66-67`), times the whole inner
  pipeline with `Stopwatch.GetTimestamp()`/`Stopwatch.GetElapsedTime` rather than a `Stopwatch`
  instance (one fewer allocation per command, `LoggingCommandDecorator.cs:29-36`), and separates three
  outcomes: `completed`, `failed` (a `Result` in a failure state, logged at Warning with an error
  summary) and `exception` (logged at Error, then rethrown), at `LoggingCommandDecorator.cs:38-58`.
  Each outcome is also recorded to the [`CqrsMetrics`](#cqrsmetrics) duration histogram tagged
  `command` and `outcome` (`LoggingCommandDecorator.cs:69-73`). This is the RED (Rate, Errors,
  Duration) anchor of `[Rubric §13, Observability & Operability]`
  ([ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html)). The read side
  [`LoggingQueryDecorator<TQuery, TResult>`](#loggingquerydecoratortquery-tresult)
  (`.../Decorators/LoggingQueryDecorator.cs:13`) is the same shape against
  `CqrsMetrics.QueryDuration` (`LoggingQueryDecorator.cs:67-68`).
- **Cache invalidation sits outside validation and outside the transaction**, so the cache is only
  cleared after a valid, committed mutation.
  [`CachingCommandDecorator<TCommand, TResult>`](#cachingcommanddecoratortcommand-tresult)
  (`.../Decorators/CachingCommandDecorator.cs:32`) calls `ICacheService.RemoveByPrefixAsync` only when
  the command opts in via [`ICacheInvalidating`](#icacheinvalidating), its prefix is non-blank, and
  the result is not a failure (`CachingCommandDecorator.cs:76-78`). Three details there are worth
  memorizing: the blank-prefix guard is the opt-out *and* a safety catch, since
  `RemoveByPrefixAsync("")` would evict the entire cache (`CachingCommandDecorator.cs:74-75`); the
  eviction runs with `CancellationToken.None` and swallows every fault into a warning, because the
  command has already committed and a cache outage must not turn a committed write into a failure
  (`CachingCommandDecorator.cs:86-103`); and a second, delayed eviction fires after
  `ReInvalidationDelay` (5 seconds by default, `CachingCommandDecorator.cs:60`) to remove an entry
  that an in-flight read repopulated with pre-write state (`CachingCommandDecorator.cs:91-96`,
  `CachingCommandDecorator.cs:113-126`). On the read side,
  [`CachingQueryDecorator<TQuery, TResult>`](#cachingquerydecoratortquery-tresult)
  (`.../Decorators/CachingQueryDecorator.cs:34`) serves hits without touching the handler
  (`CachingQueryDecorator.cs:79-84`), stores only non-failure results
  (`CachingQueryDecorator.cs:109-114`), and is **fail-open** throughout: a failed read is logged and
  treated as a miss, a failed populate returns the answer uncached, and only
  `OperationCanceledException` escapes the guard (`CachingQueryDecorator.cs:116-122`,
  `CachingQueryDecorator.cs:155-170`). Both halves are the pipeline's
  `[Rubric §12, Performance & Scalability]` story
  ([ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html)).
- **Validation sits outside the transaction** so a malformed command never opens a database
  transaction. [`ValidatingCommandDecorator<TCommand, TResult>`](#validatingcommanddecoratortcommand-tresult)
  (`.../Decorators/ValidatingCommandDecorator.cs:24`) takes `IEnumerable<IValidator<TCommand>>` and
  keeps the first (`ValidatingCommandDecorator.cs:29`), passes straight through when there is none
  (`ValidatingCommandDecorator.cs:57-60`), and on failure converts the FluentValidation result into
  [`Error`](group-01-result-error-handling.md#error) values and returns a typed failure *without ever
  calling the handler* (`ValidatingCommandDecorator.cs:68-72`). Commands that embed a request DTO via
  [`ICommandWithRequest<out TRequest>`](#icommandwithrequestout-trequest) get a validator wired
  automatically: the module scan reflects over the assembly and `TryAdd`s a
  [`CommandRequestValidator<TCommand, TRequest>`](group-06-validation.md#commandrequestvalidatortcommand-trequest)
  for each (`DependencyInjection.cs:158-176`), with `TryAdd` semantics so an explicit
  `IValidator<TCommand>` always wins. That whole story belongs to
  [G06, Validation](group-06-validation.md) (`[Rubric §24, Forms, Validation & UX Safety]`).
- **Transaction is innermost** (closest to the handler) so the unit-of-work boundary is as tight as
  possible. [`TransactionalCommandDecorator<TCommand, TResult>`](#transactionalcommanddecoratortcommand-tresult)
  (`.../Decorators/TransactionalCommandDecorator.cs:18`) is sixteen lines (18-33): pass through unless the
  command implements [`ITransactional`](#itransactional)
  (`TransactionalCommandDecorator.cs:26-27`), otherwise hand the inner call to
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork)`.ExecuteInTransactionAsync`
  (`TransactionalCommandDecorator.cs:29-31`). Everything interesting happens on the other side of that
  call, in [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory)
  (`[Rubric §8, Data Architecture]`), and it is worth reading:
  **a returned failed `Result` rolls the transaction back, exactly like an exception**
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:562-568`);
  the call is re-entrant, so a nested transaction joins the ambient one and only the outermost call
  begins, commits, or rolls back (`DbContextFactory.cs:512-513`); in-process domain event dispatch is
  deferred until after a successful commit and dropped on rollback (`DbContextFactory.cs:448-452`,
  `DbContextFactory.cs:576-578`); and a failure of the *commit itself* is never retried, surfacing as
  `TransactionCommitAmbiguousException` instead (`DbContextFactory.cs:539-540`).

## Opt-in by marker interface, pay only for what you use

The pipeline is registered for *every* handler, but most decorators are dormant unless the use case
asks for them. The switch is a set of tiny **marker / role interfaces** in
`MMCA.Common.Application.UseCases`:

- [`ITransactional`](#itransactional)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ITransactional.cs:6`): an empty marker,
  declared with the interface-body-less syntax, meaning "open a transaction".
- [`ICacheInvalidating`](#icacheinvalidating) (`.../UseCases/ICacheInvalidating.cs:8`): exposes a
  `CachePrefix` string to evict after success (`ICacheInvalidating.cs:14`).
- [`IQueryCacheable`](#iquerycacheable) (`.../UseCases/IQueryCacheable.cs:8`): exposes a `CacheKey`
  plus a `CacheDuration` (`IQueryCacheable.cs:14-19`).
- [`IFeatureGated`](#ifeaturegated) (`.../UseCases/IFeatureGated.cs:10`): exposes a `FeatureName` that
  must match a key in the `FeatureManagement` configuration section (`IFeatureGated.cs:13-16`).

Each decorator does an `is`-check (`command is not ITransactional`, `query is not IQueryCacheable`,
and so on) and passes straight through when the interface is absent. This is
`[Rubric §2, Design Patterns]` (marker interfaces as declarative opt-in) layered with
`[Rubric §1, SOLID]` Open/Closed: a new handler turns a concern on by implementing an interface, with
no decorator, registration, or pipeline change. A command that reads nothing pays nothing for
transactions, and an uncached query pays nothing for caching, while the *capability* is uniformly
present. Adoption is honest about that: `IQueryCacheable` is wired and unit-tested, but exactly one
production query implements it today, ADC's `GetNowNextQuery`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:23`),
plus the reference apps (Helpdesk's `GetTicketByIdQuery`,
`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/Tickets/UseCases/GetById/GetTicketByIdQuery.cs:23`).
MMCA.Store has no `IQueryCacheable` query at all; its public reads cache at the HTTP `OutputCache`
layer instead ([ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).

## Tenant scoping and the two lock tables

Both caching decorators are multi-tenant aware, and the reason is a nice illustration of where a
cross-cutting concern has to live. `ICacheService` is a **singleton** and therefore cannot see the
scoped tenant, so two tenants computing the same cache key would serve each other's rows. Isolation
is applied where the key is *computed* instead: [`TenantCacheKey`](#tenantcachekey)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TenantCacheKey.cs:25`) turns a
key or prefix into `t:{tenantId}:{key}` when [`ITenantContext`](#itenantcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ITenantContext.cs:22`) reports a resolved
tenant, and returns it untouched when it does not (`TenantCacheKey.cs:37-40`). The scoped form is a
**prefix, not a suffix**, precisely so prefix eviction keeps working: a command's invalidation can
only reach its own tenant's entries (`TenantCacheKey.cs:15-19`). Because the query decorator uses the
same helper for its reads (`CachingQueryDecorator.cs:63-64`) and the command decorator for its
evictions (`CachingCommandDecorator.cs:82`), reads and invalidations stay symmetric by construction.
`ITenantContext` is injected as an optional constructor parameter defaulting to `null`
(`CachingQueryDecorator.cs:38`, `CachingCommandDecorator.cs:36`), so a single-tenant host keeps
byte-identical cache keys to the pre-tenancy framework
([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)); the interface itself
refuses to change tenant mid-scope, accepting the value it already holds and throwing on a different
one (`ITenantContext.cs:33-41`).

The read path also guards against **cache stampede**. On a miss,
[`CachingQueryDecorator<TQuery, TResult>`](#cachingquerydecoratortquery-tresult) takes a per-key lock
and re-checks the cache inside it, so on expiry of a hot key exactly one caller runs the handler and
the rest are served the fresh entry (`CachingQueryDecorator.cs:89-96`). The lock table is
[`QueryCacheKeyLocks`](#querycachekeylocks) (`.../Decorators/CachingQueryDecorator.cs:194`), a
non-generic holder around a [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) so that
every closed generic decorator shares one table rather than one per closed type
(`CachingQueryDecorator.cs:173-197`). Its sibling [`CacheKeyLocks`](#cachekeylocks)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:142`) does the same job
for the default `ICacheService.GetOrCreateAsync` implementation, and is deliberately a *separate*
table: different call sites over different keys, where sharing stripes would only widen the
unrelated-key collisions striping already tolerates (`ICacheService.cs:135-141`). Both are striped
rather than one semaphore per key, and both are honest about the limit: the lock is per process, so
across replicas stampede protection is at most one handler execution per instance, not one
cluster-wide (`CachingQueryDecorator.cs:186-192`).

## Two supporting pieces, and a worked example

Two small helpers make the short-circuit decorators possible.
[`ResultFailureFactory`](#resultfailurefactory)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ResultFailureFactory.cs:11`)
builds a delegate that manufactures a `TResult` failure from an error list, taking a direct cast for
non-generic `Result` and compiling an expression tree once per closed `Result<T>`
(`ResultFailureFactory.cs:22-41`), and throwing `InvalidOperationException` for anything else
(`ResultFailureFactory.cs:43-45`). The feature-gate and validating decorators cache that delegate in a
static field but build it **lazily, on the first short-circuit**, not in a static constructor: since
Scrutor's `TryDecorate` is unconditional, an eager initializer turned an unsupported `TResult` into a
`TypeInitializationException` at *resolve* time for a handler that never short-circuits
(`FeatureGateCommandDecorator.cs:27-43`, `ValidatingCommandDecorator.cs:36-52`). That comment is a
good example of the guide's general rule: read the remarks, they usually record a bug that was paid
for once. [`CqrsMetrics`](#cqrsmetrics) (`.../Decorators/CqrsMetrics.cs:16`) is the internal static
holder of the `MMCA.Common.Cqrs` OpenTelemetry meter (`CqrsMetrics.cs:19-21`) and its four
instruments: command and query duration histograms in milliseconds
(`CqrsMetrics.cs:24-33`) and the query cache hit/miss counters the caching decorator increments
(`CqrsMetrics.cs:36-55`, recorded at `CachingQueryDecorator.cs:82`, `:94`, `:104`). The meter name is
duplicated as a literal in MMCA.Common.Aspire because that package has no reference to Application
(`CqrsMetrics.cs:9-10`), which is the one place this group's metrics leak into another layer.

The reusable [`DeleteEntityCommand<TEntity, TIdentifierType>`](#deleteentitycommandtentity-tidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityCommand.cs:11`) and its
[`DeleteEntityHandler<TEntity, TIdentifierType>`](#deleteentityhandlertentity-tidentifiertype)
(`.../UseCases/DeleteEntityHandler.cs:14`) are the canonical end-to-end example: a single generic
command/handler pair that deletes *any*
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
(`DeleteEntityHandler.cs:17`) rather than forcing every module to author `DeleteSessionCommand`,
`DeleteSpeakerCommand`, and so on. The handler resolves the repository from
[`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), returns a `NotFound`
[`Error`](group-01-result-error-handling.md#error) stamped with its source and the entity type name
when the row is missing (`DeleteEntityHandler.cs:25-28`), calls the aggregate's own `Delete()` (which
enforces invariants and may raise domain events), and saves **only** when that succeeded
(`DeleteEntityHandler.cs:30-32`). The command itself is a one-property record that implements
[`ICacheInvalidating`](#icacheinvalidating) with a defaulted `CachePrefix` of
`typeof(TEntity).FullName + ":"` (`DeleteEntityCommand.cs:20`), because the generic controller
constructs the command itself and cannot supply one; setting it to an empty string is the documented
opt-out, and matches the blank-prefix guard in the caching decorator. Note that the `TEntity` type
parameter earns its keep twice over: it distinguishes `DeleteEntityCommand<Session, int>` from
`DeleteEntityCommand<Speaker, int>` so DI routes each to its own handler, *and* it supplies that
default cache prefix (`DeleteEntityCommand.cs:4-6`).

## The other Application-layer contracts in this group

Four contracts sit beside the pipeline rather than inside it. They are declared here, in the
Application layer, and implemented in Infrastructure or the composition root, which is what keeps a
use case that depends on one extractable into its own service.

[`IDistributedLock`](#idistributedlock)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IDistributedLock.cs:30`) is best-effort
mutual exclusion on a logical key across every replica of a service. Its single method
`TryAcquireAsync(key, ttl, wait, cancellationToken)` returns an `IAsyncDisposable` handle or `null`
when the key was still held after `wait` elapsed (`IDistributedLock.cs:59-63`). The XML doc is
explicit about the three things that make it safe to use: it is not reentrant
(`IDistributedLock.cs:20-22`), the TTL is a crash guard rather than a lease you may rely on, so a
paused holder can lose the lock without knowing (`IDistributedLock.cs:24-28`), and release is
owner-scoped and idempotent (`IDistributedLock.cs:54-58`). No decorator takes it; its in-framework
caller is the API idempotency filter, which needs its execute-then-store window to be exclusive across
replicas ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)), and the
implementation ([`RedisDistributedLock`](group-14-module-system-composition.md#redisdistributedlock)
or the warn-once [`InProcessDistributedLock`](group-14-module-system-composition.md#inprocessdistributedlock))
is chosen at the composition root ([G14](group-14-module-system-composition.md)).

[`IScheduledJob`](#ischeduledjob) (`.../Interfaces/IScheduledJob.cs:36`) is recurring work driven by a
five-field cron expression parsed by Cronos, with three members: a stable `Name` that doubles as the
primary key of the persisted job row (`IScheduledJob.cs:44`), a default `CronExpression` a host may
override per job through `Scheduler:Jobs:{Name}:Cron` (`IScheduledJob.cs:68`, `IScheduledJob.cs:63-66`),
and `ExecuteAsync` (`IScheduledJob.cs:78`). Four behaviors documented on the interface shape how you
write one: jobs resolve **scoped**, in a fresh DI scope per execution, so they may take a unit of work
and must hold no state between runs (`IScheduledJob.cs:9-14`); a claim lease in the job store makes an
occurrence run exactly once across replicas (`IScheduledJob.cs:16-21`); missed occurrences do **not**
pile up, so work that must not be skipped has to be idempotent and range-driven rather than one-run-per-tick
(`IScheduledJob.cs:23-29`); and a thrown exception is caught, logged and stamped as a failed outcome
without retry inside the occurrence (`IScheduledJob.cs:31-34`). The runner lives in
[`ScheduledJobRunner`](group-14-module-system-composition.md#scheduledjobrunner)
([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)).

[`IAuditTrailReader`](#iaudittrailreader) (`.../Interfaces/IAuditTrailReader.cs:20`) reads the
recorded change history of one entity, keyed by the entity's full CLR type name and the invariant
string form of its primary key (composite keys joined with `|` in model key order), paged and newest
first (`IAuditTrailReader.cs:22-42`). It is registered only by `AddAuditTrail`, so a host that never
opted in has nothing to resolve (`IAuditTrailReader.cs:6-7`), and the framework deliberately ships the
read without an endpoint or page, because who may see an entity's history is an application decision
(`IAuditTrailReader.cs:10-15`). The implementation is
[`AuditTrailReader`](group-07-persistence-ef-core.md#audittrailreader) over the rows written by
[`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor)
([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)); this is
`[Rubric §30, Compliance, Privacy & Data Governance]` territory.

[`ICreateRequest`](#icreaterequest) (`.../Interfaces/ICreateRequest.cs:8`) is the smallest type in the
group: an empty marker used purely as a generic constraint by
[`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype)
so request-to-entity mapping is type-safe (`ICreateRequest.cs:3-6`). It pairs with
[`ICommandWithRequest<out TRequest>`](#icommandwithrequestout-trequest)
(`.../UseCases/ICommandWithRequest.cs:14`), whose single covariant `Request` property
(`ICommandWithRequest.cs:17`) is what the module scan looks for when it auto-registers the delegating
validator described above.

## Where this fits, and the failure-mode contract

These contracts sit in the **Application** layer of Clean Architecture
([primer §1](00-primer.md#1-the-big-picture)), above Domain and below Infrastructure and the API. The
API layer ([G12](group-12-api-hosting-mapping.md)) resolves a closed handler from DI and calls
`HandleAsync`; the decorators it gets are invisible to the caller, and returned `Result` failures are
translated to HTTP status codes by
[`ApiControllerBase`](group-12-api-hosting-mapping.md#apicontrollerbase). Domain events raised inside
the transaction reach the outbox on save ([G04](group-04-events-outbox.md),
[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). And because the only
things handlers and decorators depend on are abstractions,
[`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
[`ICacheService`](group-09-caching.md#icacheservice),
[`ICorrelationContext`](group-12-api-hosting-mapping.md#icorrelationcontext),
[`ITenantContext`](#itenantcontext), `IFeatureManager`, `IValidator<T>`, the whole pipeline survives a
module being extracted into its own service unchanged (`[Rubric §7, Microservices Readiness]`,
[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and
[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).

The contract to memorize, because the rest of the system relies on it, has three clauses. On a
**business failure** (a `Result` with `IsFailure`, no exception thrown) the transaction is **rolled
back**, atomicity over partial persistence, and cache invalidation is skipped
(`DependencyInjection.cs:82-83`, enforced at `DbContextFactory.cs:562-568` and
`CachingCommandDecorator.cs:76-78`). On an **exception** the transaction also rolls back and the
exception propagates outward through every decorator, which logs it and tags the metric `exception`
(`DependencyInjection.cs:84`, `LoggingCommandDecorator.cs:52-58`). And on the read side only
non-failure results are ever cached (`CachingQueryDecorator.cs:109`). Note the revision history here:
rollback-on-business-failure is the *current* semantic, adopted in the 2026-07-19 revision of
[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html); older prose that said
a business failure still commits describes a framework version that no longer exists. The asymmetry
that remains, failures are values that flow through the pipeline while exceptions are escapes that
unwind it, is the same Result-pattern discipline the whole codebase is built on, expressed here as the
rules of the pipeline.

### ICacheInvalidating
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICacheInvalidating.cs:8` · Level 0 · interface

- **What it is**: an opt-in interface for commands that should evict cached entries after a successful mutation. Implementing it exposes a `CachePrefix` string; [CachingCommandDecorator<TCommand, TResult>](#cachingcommanddecoratortcommand-tresult) calls `ICacheService.RemoveByPrefixAsync` with that prefix once `HandleAsync` returns a non-failure result.
- **Depends on**: nothing first-party at the interface level. Works in concert with [ICacheService](group-09-caching.md#icacheservice) (the eviction mechanism), is tenant-scoped through [ITenantContext](#itenantcontext), and shares the opt-in-by-implementing pattern with [ITransactional](#itransactional).
- **Concept introduced, prefix-based cache invalidation as an opt-in pipeline concern.** `[Rubric §12, Performance & Scalability]` assesses caching strategy and how stale reads are avoided; prefix-scoped eviction keeps read caches coherent after writes without the command site knowing individual cache keys. Naming the prefix (for example the aggregate's full type name plus `:`) scopes eviction to only the affected segment. This is also `[Rubric §2, Design Patterns]`: Decorator plus a presence-as-signal interface, the same shape [ITransactional](#itransactional) introduces. Note where the interface sits: it is implemented by the **command record**, not by the handler, because the decorator's type check is `command is ICacheInvalidating` (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingCommandDecorator.cs:76`).
- **Walkthrough**: line 8 declares `public interface ICacheInvalidating`; line 14 declares its only member, `string CachePrefix { get; }`. Three behaviors of the consuming decorator are worth carrying here because they are the contract in practice. (1) **Empty means opt out.** The decorator guards on `!string.IsNullOrWhiteSpace(cacheInvalidating.CachePrefix)` (`CachingCommandDecorator.cs:77`) and the comment on line 75 says why the guard is load-bearing: `RemoveByPrefixAsync("")` would evict the entire cache. (2) **Tenant scoping is applied for you.** The prefix is run through `TenantCacheKey.Scope(tenantContext, ...)` (`CachingCommandDecorator.cs:82`, helper at `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TenantCacheKey.cs:37-38`), so a resolved tenant evicts only its own keyspace. (3) **Eviction happens twice.** The first `RemoveByPrefixAsync` runs with `CancellationToken.None` so cleanup outlives a caller that walked away (`CachingCommandDecorator.cs:86-89`), and a delayed second eviction (`ReInvalidationDelay`, five seconds, `CachingCommandDecorator.cs:60`, scheduled at `:96`) removes an entry that an in-flight read repopulated with pre-write state. Both evictions are best-effort: a failure is caught and logged, never surfaced to a command that already committed (`CachingCommandDecorator.cs:98-103`).
- **Why it's built this way**: decoupling *what* to invalidate (the command's concern, via `CachePrefix`) from *how* to invalidate (the decorator plus `ICacheService`) keeps handlers free of cache-infrastructure knowledge and makes invalidation testable in isolation. A business `Result.Failure` still returns through the pipeline but **skips** invalidation, because the decorator checks `!IsFailure(result)` (`CachingCommandDecorator.cs:78`): only a genuine success evicts.
- **Where it's used**: broadly adopted on the write side. Source search finds 44 references across `MMCA.ADC/Source` (Conference category/event/session/speaker/sponsor mutations, Identity user mutations) and 42 across `MMCA.Store/Source` (catalog, sales-cart, identity mutations). The framework's own [DeleteEntityCommand<TEntity, TIdentifierType>](#deleteentitycommandtentity-tidentifiertype) implements it with a defaulted prefix. Consumed exclusively by [CachingCommandDecorator<TCommand, TResult>](#cachingcommanddecoratortcommand-tresult).

---

### ICommandHandler<in TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandHandler.cs:9` · Level 0 · interface

- **What it is**: the CQRS command-handler contract: one method, `HandleAsync`, that accepts a mutation command and returns a result, typically [Result](group-01-result-error-handling.md#result) or `Result<T>`.
- **Depends on**: BCL only (`Task`, `CancellationToken`). Implementations return types from `MMCA.Common.Shared` ([Result](group-01-result-error-handling.md#result) / `Result<T>`, with failures described by [Error](group-01-result-error-handling.md#error)).
- **Concept introduced, the CQRS command side.** `[Rubric §6, CQRS & Event-Driven]` assesses the separation of mutating writes from side-effect-free reads; **commands** express intent to change state (create, update, delete) and return a [Result](group-01-result-error-handling.md#result). `[Rubric §1, SOLID]`: a one-method interface gives each handler a single responsibility and, via contravariance, clean substitutability. Implementations are auto-discovered by Scrutor (`ScanModuleApplicationServices<TAssemblyMarker>()` scans for `ICommandHandler<,>` and registers them scoped, `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:144-148`) and then wrapped by a layered decorator pipeline. The **verified registration** in `DependencyInjection.cs:94-98` registers, innermost to outermost, `Transactional`, `Validating`, `Caching`, `Logging`, `FeatureGate`; because Scrutor's `TryDecorate` applies decorators in *reverse* registration order, the **execution order is** [FeatureGateCommandDecorator<TCommand, TResult>](#featuregatecommanddecoratortcommand-tresult), [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult), [CachingCommandDecorator<TCommand, TResult>](#cachingcommanddecoratortcommand-tresult), [ValidatingCommandDecorator<TCommand, TResult>](#validatingcommanddecoratortcommand-tresult), [TransactionalCommandDecorator<TCommand, TResult>](#transactionalcommanddecoratortcommand-tresult), then the concrete handler. That ordering is load-bearing and is the subject of **[ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)** (the CQRS decorator pipeline). The default `CancellationToken = default` (line 17) lets token-less callers invoke handlers while still letting every implementation honour cancellation.
- **Walkthrough**: line 9 declares `public interface ICommandHandler<in TCommand, TResult>`. The `in` variance on `TCommand` is contravariant: a handler accepting a base command can stand in where a handler of a derived command is expected. Line 17 declares the sole member, `Task<TResult> HandleAsync(TCommand command, CancellationToken cancellationToken = default);`.
- **Why it's built this way**: a thin one-method interface keeps handlers focused; the decorator pipeline adds cross-cutting concerns without each handler knowing about them. A single open-generic interface is exactly what lets Scrutor register every closed handler in one assembly pass and lets the decorator chain wrap them generically. The registration order constraint is documented in `MMCA.Common/CLAUDE.md`: `AddApplicationDecorators()` runs **last**, because `TryDecorate` can only wrap handlers already in the container.
- **Where it's used**: every command handler in ADC and Store implements it, plus the framework's own [DeleteEntityHandler<TEntity, TIdentifierType>](#deleteentityhandlertentity-tidentifiertype) and the notification command handlers (G10).
- **Caveats / not-in-source**: `ProfilingCommandDecorator` exists but is **not** in the standard pipeline; it is added only by the separate opt-in `AddApplicationProfiling()` (`DependencyInjection.cs:219-221`).

---

### ICommandWithRequest<out TRequest>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ICommandWithRequest.cs:14` · Level 0 · interface

- **What it is**: a contract for commands that embed a request DTO as a `Request` property, enabling automatic FluentValidation of that DTO by the validating decorator before the handler runs.
- **Depends on**: nothing first-party at the interface level. The validation plumbing resolves FluentValidation's `IValidator<TRequest>` from DI through the framework-supplied [CommandRequestValidator<TCommand, TRequest>](group-06-validation.md#commandrequestvalidatortcommand-trequest) and is enforced by [ValidatingCommandDecorator<TCommand, TResult>](#validatingcommanddecoratortcommand-tresult). Cross-reference [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult).
- **Concept introduced, automatic validator wiring via an interface contract.** `[Rubric §24, Forms, Validation & UX Safety]` assesses how server-side validation is centralised rather than scattered; instead of each handler calling `_validator.ValidateAsync(command.Request)`, module scanning reflects over the assembly, finds every type closing `ICommandWithRequest<>`, builds the closed `CommandRequestValidator<TCommand, TRequest>` and registers it as `IValidator<TCommand>` with **`TryAdd` semantics** (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:158-176`). `TryAddTransient` at line 175 is what makes an explicitly written `IValidator<TCommand>` win: the auto-wired validator only fills the gap. `[Rubric §1, SOLID]` (open for extension, closed for modification): a new command gets validation for free by implementing the interface, with no decorator or registration change.
- **Walkthrough**: line 14 declares `public interface ICommandWithRequest<out TRequest>`. The `out` (covariant) position means a command whose request is a derived type satisfies a constraint expecting the base request type. Line 17 declares `TRequest Request { get; }`, the embedded payload, typically deserialized from the HTTP body. The XML doc on lines 5-11 is the contract for the auto-registration described above.
- **Why it's built this way**: it collapses the usual web-API sequence (receive body, map to command, validate body, call handler) into "map to command that implements `ICommandWithRequest`, decorator validates, handler runs", removing per-handler validation boilerplate.
- **Where it's used**: on the write commands whose payload is a request record rather than a flat set of positional parameters. Source search finds 7 files in `MMCA.ADC/Source` (for example `UpdateEventCommand`, `UpdateSponsorCommand`, `ChangePasswordCommand`) and 15 files in `MMCA.Store/Source` (catalog rename/change commands, inventory adjust and bulk-set, cart add-item, customer change-name/email/address). Commands that carry their parameters positionally simply do not implement it and pass the validating decorator unchanged.

---

### ICreateRequest
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICreateRequest.cs:8` · Level 0 · interface (marker, empty)

- **What it is**: an empty marker interface for "create" request DTOs, used as a generic type constraint by [IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) to distinguish create-mapping from update-mapping at the type-system level.
- **Depends on**: nothing. Same presence-as-signal marker pattern as [ITransactional](#itransactional).
- **Concept introduced, type-system constraints as documentation and enforcement.** `[Rubric §9, API & Contract Design]` assesses how request contracts are modelled and kept unambiguous; tagging a DTO as "this is a create" lets generic mapper infrastructure (G12) refuse anything that is not a create request on the create-mapping path, catching a wiring mistake at compile time rather than at runtime.
- **Walkthrough**: the body is empty (`{ }`, lines 9-10); the XML doc on lines 3-7 names the single consumer. All of the type's value is in the hierarchy.
- **Why it's built this way**: a mapper constrained to `where TCreateRequest : ICreateRequest` makes it impossible to pass an update-request DTO into the create-mapping path, with no runtime check needed.
- **Where it's used**: implemented by create-request DTOs in every module. Source search finds 6 in `MMCA.ADC/Source` (`SessionCreateRequest`, `SpeakerCreateRequest`, `SponsorCreateRequest`, `QuestionCreateRequest`, `ConferenceCategoryCreateRequest`, and one more) and 8 in `MMCA.Store/Source` (`ProductCreateRequest`, `ProductVariantCreateRequest`, `CategoryCreateRequest`, `OrderCreateRequest`, `CustomerCreateRequest`, `ShoppingCartCreateRequest`, `ShoppingCartItemCreateRequest`, `InventoryItemCreateRequest`). Consumed as a generic constraint by [IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (G12).

---

### IDistributedLock
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IDistributedLock.cs:30` · Level 0 · interface

- **What it is**: a one-method contract for mutual exclusion on a logical string key across *every replica* of a service. `TryAcquireAsync` hands back an `IAsyncDisposable` handle whose disposal releases the lock, or `null` when the key was still held elsewhere after the caller's wait elapsed.
- **Depends on**: BCL only (`Task`, `TimeSpan`, `IAsyncDisposable`, `CancellationToken`), no first-party types. Its two implementations live in Infrastructure: [InProcessDistributedLock](group-14-module-system-composition.md#inprocessdistributedlock) and [RedisDistributedLock](group-14-module-system-composition.md#redisdistributedlock). Contrast the per-process [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe), which is exactly what this interface exists to outgrow.
- **Concept introduced, cross-replica mutual exclusion as an Application-layer abstraction.** `[Rubric §12, Performance & Scalability]` assesses whether a design still holds once the service scales out horizontally, and the XML doc opens with precisely that failure (`IDistributedLock.cs:6-13`): a `SemaphoreSlim` (or a striped one) serializes callers *inside one process*, so a service running more than one replica executes an "only one of these at a time" section once per replica. `[Rubric §29, Resilience, Reliability & Business Continuity]` assesses behavior under partial failure; this contract is documented as **best-effort, not a consensus protocol** (`IDistributedLock.cs:23-28`): a holder paused past its time-to-live loses the lock without being told, so the guarded section must stay correct (merely slower, or duplicated) when exclusion is lost. The doc states the usage rule bluntly: take the lock to *collapse duplicate work*, never as the only guard on a correctness invariant that persistence can enforce. `[Rubric §3, Clean Architecture]` assesses whether the core depends on abstractions while technology choices sit at the edge; the contract carries no transport type at all, so the StackExchange.Redis dependency stays in Infrastructure and callers here never see it.
- **Walkthrough**: line 30 declares the interface; lines 59-63 declare its single member, `Task<IAsyncDisposable?> TryAcquireAsync(string key, TimeSpan ttl, TimeSpan wait, CancellationToken cancellationToken = default)`. Every parameter carries a contract the implementations must honour. `key` is the logical name that callers sharing one backing store have to agree on (line 36). `ttl` is the **crash guard**: how long the lock survives with no explicit release, so a holder that dies mid-section cannot wedge the key; it must sit comfortably above the guarded section's expected duration, because work that outlives the TTL is no longer protected (lines 37-42). `wait` is how long to block for a current holder, and `TimeSpan.Zero` makes the call a single non-blocking attempt (lines 43-46). The token cancels *the wait*, not the work that follows it (line 47). The return contract matters as much as the parameters: `null` means "still held elsewhere after `wait` elapsed", and the handle is meant to be disposed inside an `await using` so release happens even when the guarded work throws (lines 48-53). Release is **owner-scoped and idempotent** (lines 54-58): disposing a handle whose TTL already lapsed is a no-op, not a release of whatever holder now owns the key. Two remarks bound usage further: implementations are singletons and must be safe to call concurrently (line 17), and the lock is **not reentrant**, so a caller that already holds `key` and asks for it again waits for itself and then fails to acquire (lines 20-21).
- **Why it's built this way**: [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) records the change that introduced it. The idempotency filter's execute-then-store window used to be guarded only by a process-local striped semaphore, which stops serializing anything the moment a service runs more than one replica, and both deployed apps do. Putting the contract in `MMCA.Common.Application.Interfaces` rather than Infrastructure is what lets the API filter depend on "a lock" while the Redis-versus-process-local decision stays a composition-root concern.
- **Where it's used**: the Infrastructure composition root registers exactly one implementation inside `AddCaching` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:191-204`, see [DependencyInjection](group-14-module-system-composition.md#dependencyinjection)): [RedisDistributedLock](group-14-module-system-composition.md#redisdistributedlock) when an `IConnectionMultiplexer` is resolvable, the warn-once [InProcessDistributedLock](group-14-module-system-composition.md#inprocessdistributedlock) otherwise. The one in-framework consumer is [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter), which resolves it from request services (`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:150`) and spans the double-check plus action plus cache-store window with a 30-second `ttl` (`IdempotencyFilter.cs:99`) and a 5-second `wait` (`IdempotencyFilter.cs:106`, both passed at `:252`); when that wait expires with nothing cached it answers a 409 in-flight-duplicate result instead of executing a second time (`IdempotencyFilter.cs:263-275`).
- **Caveats / not-in-source**: verified by source search across the workspace, no ADC or Store type takes an `IDistributedLock` today; the framework's own idempotency filter is the only production caller. The filter also resolves it with `GetService<IDistributedLock>()` and falls back to the striped-semaphore path when the result is `null` (`IdempotencyFilter.cs:150-155`), even though `AddCaching` registers an implementation unconditionally, so that fallback is reachable only in a host that never calls `AddCaching` (or a test building its own provider). A lock backend that throws is also survivable: the filter records a degraded metric and executes without exclusion (`IdempotencyFilter.cs:255-260`).

---

### IFeatureGated
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/IFeatureGated.cs:10` · Level 0 · interface

- **What it is**: an opt-in interface that puts both commands and queries behind a Microsoft.FeatureManagement flag. When the named feature is disabled, the gate short-circuits and returns a failure result without calling the handler.
- **Depends on**: nothing first-party at the interface level. Enforcement lives in [FeatureGateCommandDecorator<TCommand, TResult>](#featuregatecommanddecoratortcommand-tresult) and [FeatureGateQueryDecorator<TQuery, TResult>](#featuregatequerydecoratortquery-tresult), which depend on `IFeatureManager` (Microsoft.FeatureManagement) and call `IsEnabledAsync(FeatureName)` (`IFeatureGated.cs:5-8`).
- **Concept introduced, feature flags as a cross-cutting pipeline concern.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether concerns like flags, logging, and caching are factored out of business logic; the gate sits at the handler boundary as the **outermost** decorator on both sides (see [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult) and [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult)), so no caller needs a flag check and the handler has no flag knowledge. As with [ITransactional](#itransactional), the interface goes on the **command or query record**, not on the handler: the decorators test `command is not IFeatureGated` / `query is not IFeatureGated` and pass everything else straight through (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs:48`, `.../FeatureGateQueryDecorator.cs:48`).
- **Walkthrough**: line 10 declares `public interface IFeatureGated`; line 16 declares `string FeatureName { get; }`, which must match a key in the `FeatureManagement` configuration section (documented on lines 12-15).
- **Why it's built this way**: putting the gate in the pipeline applies it uniformly to every gated command and query with zero per-handler boilerplate, and one interface serves both sides because a feature-gate decorator is registered against both handler interfaces.
- **Where it's used**: sparingly and deliberately, on the two operations that genuinely need a runtime kill switch. `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/VerifyPayment/VerifyPaymentCommand.cs:20` combines it with [ICacheInvalidating](#icacheinvalidating), and `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:13` combines it with [ICacheInvalidating](#icacheinvalidating) and [ITransactional](#itransactional). Feature-name constants live in per-module `*Features` classes to avoid magic strings (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/SalesFeatures.cs:6`, `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/CatalogFeatures.cs:6`, [ConferenceFeatures](group-17-conference-domain.md#conferencefeatures), [EngagementFeatures](group-22-engagement-module.md#engagementfeatures)), and each doc comment notes that the same constant serves both the `[FeatureGate]` attribute on a controller and this interface on a command. Feature state is read from configuration at runtime.

---

### IQueryCacheable
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/IQueryCacheable.cs:8` · Level 0 · interface

- **What it is**: the query-side opt-in for caching. A query implements this to declare a `CacheKey` (the exact lookup key for this query's result) and a `CacheDuration` (per-query TTL); [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult) checks the cache on the way in and stores the result on a miss.
- **Depends on**: nothing first-party. Query-side companion to [ICacheInvalidating](#icacheinvalidating); implemented through [ICacheService](group-09-caching.md#icacheservice) and tenant-scoped through [ITenantContext](#itenantcontext) exactly as the write side is.
- **Concept introduced, per-query cache keys and staleness budgets.** `[Rubric §12, Performance & Scalability]`. `CacheKey` must encode every query parameter that affects the result, and the XML doc gives the shape (`"Catalog:Products:page=1&size=10"`, `IQueryCacheable.cs:10-13`); omit a parameter and the cache answers one query shape with another's result. `CacheDuration` gives per-query TTL control so a hot, stable list can cache longer than volatile data, and putting it on the interface rather than in configuration keeps each query the owner of its own staleness budget.
- **Walkthrough**: line 8 declares `public interface IQueryCacheable`; line 14 declares `string CacheKey { get; }`, computed from the query's own properties; line 19 declares `TimeSpan CacheDuration { get; }`.
- **Why it's built this way**: opt-in means only queries that genuinely benefit (frequently called, expensive, not user-specific) pay the serialization and staleness cost. A query that does not implement it hits the decorator's early return and goes straight to the handler.
- **Where it's used**: exactly **one production query** today. Verified by source search across ADC and Store, the only production implementer is ADC's `GetNowNextQuery` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:23`, see [GetNowNextQuery](group-18-conference-application.md#getnownextquery)): a hot, public, non-user-specific home-screen "now / next" read. Its `CacheKey` (lines 26-35) is built as `{Session full type name}:NowNext:{event id or "current"}`, deliberately under the same `Session` aggregate prefix the session write commands use as their `CachePrefix`, and its `CacheDuration` is 30 seconds (line 38). `MMCA.Store/Source` has no implementer at all. The framework's own test queries in `CachingQueryDecoratorTests` exercise the decorator directly.
- **Caveats / not-in-source**: the read-cache mechanism is fully functional and unit-tested, but adoption is one query, so do not assume an arbitrary existing query is cached through this path. Production read-side caching is mostly done a layer up, at HTTP, through ASP.NET Core OutputCache policies on the Conference read controllers. The query's own doc comment (`GetNowNextQuery.cs:13-20`) is candid that prefix eviction only engages once an `IConnectionMultiplexer` is registered, so the 30-second TTL, not prefix invalidation, is the real staleness backstop on the deployed services.

---

### IQueryHandler<in TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/IQueryHandler.cs:9` · Level 0 · interface

- **What it is**: the CQRS query-handler contract: `HandleAsync` accepts a read-only query and returns a result without mutating state.
- **Depends on**: BCL only. Mirrors [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult) on the read side.
- **Concept introduced, the lighter read pipeline.** `[Rubric §6, CQRS & Event-Driven]`: this is the query half of the segregation. Queries carry no side effects, so their decorator stack is shorter. The **verified registration** in `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:101-103` registers, innermost to outermost, `Caching`, `Logging`, `FeatureGate`, so the **execution order is** [FeatureGateQueryDecorator<TQuery, TResult>](#featuregatequerydecoratortquery-tresult), [LoggingQueryDecorator<TQuery, TResult>](#loggingquerydecoratortquery-tresult), [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult), then the concrete handler. Notably absent versus the command side: **Validating** and **Transactional**. Queries do not mutate, so neither concern applies, and that asymmetry is the clearest single expression of CQRS in this codebase.
- **Walkthrough**: line 9 declares `public interface IQueryHandler<in TQuery, TResult>` with the same contravariant `in` on the query type. Line 17 declares `Task<TResult> HandleAsync(TQuery query, CancellationToken cancellationToken = default);`.
- **Why it's built this way**: an identical shape to `ICommandHandler` (for the same Scrutor-discoverability and open-generic decorator reasons), but a separate interface so DI can tell "this is a query" from "this is a command" and apply the correct, lighter decorator set.
- **Where it's used**: every read handler in ADC and Store, plus the framework's notification query handlers (G10). Closed implementations are registered scoped by `ScanModuleApplicationServices<TAssemblyMarker>()` (`DependencyInjection.cs:150-154`).
- **Caveats / not-in-source**: like the command side, `ProfilingQueryDecorator` is added only by the opt-in `AddApplicationProfiling()` (`DependencyInjection.cs:219-222`), not by the standard pipeline.

---

### IScheduledJob
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IScheduledJob.cs:36` · Level 0 · interface

- **What it is**: the contract for a unit of recurring work driven by a cron schedule: a stable `Name`, a default `CronExpression`, and an `ExecuteAsync` that runs one occurrence.
- **Depends on**: BCL only (`Task`, `CancellationToken`). Executed by [ScheduledJobRunner](group-14-module-system-composition.md#scheduledjobrunner), persisted as [ScheduledJobEntry](group-14-module-system-composition.md#scheduledjobentry) rows, configured through [SchedulerSettings](group-14-module-system-composition.md#schedulersettings) and [ScheduledJobOverrideSettings](group-14-module-system-composition.md#scheduledjoboverridesettings), and cron-parsed by Cronos (NuGet).
- **Concept introduced, recurring work as a first-class Application abstraction.** `[Rubric §13, Observability & Operability]` assesses whether operators can see and steer background work; a job here is a named row with a schedule, an outcome and a last error, not an anonymous `Timer`. `[Rubric §7, Microservices Readiness]` and `[Rubric §29, Resilience]` assess behavior under scale-out and partial failure, and the interface's own doc is where the hard rules are written down (`IScheduledJob.cs:8-35`), so read them as contract, not commentary:
  - **Lifetime**: jobs are resolved **scoped**, in a fresh DI scope per execution, exactly like a request. A job may take scoped dependencies (a unit of work, a repository, a command handler) and must hold no state between runs, because the previous instance is already disposed (lines 9-14; the runner does exactly this at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:523-525`).
  - **Single runner across replicas**: every replica runs a scheduler, but an occurrence executes once, because the persistent job store hands out a claim lease per row and only the claim winner runs (lines 16-21; the claim is a conditional update at `ScheduledJobRunner.cs:402-439`). A replica that dies mid-execution releases its claim implicitly when the lease expires.
  - **Missed occurrences do not pile up**: after an outage the job runs **once** and its next run is computed from the current instant, not from the backlog (lines 23-29; `ScheduledJobRunner.cs:480` computes the next occurrence from `completedOn`). Work that must not be skipped therefore has to be idempotent and range-driven, processing everything since the last successful run rather than relying on one run per tick.
  - **Failures are recorded, not fatal**: an exception from `ExecuteAsync` is caught, logged and stamped on the row as a failed outcome while the schedule advances and the loop survives; there is no retry inside an occurrence (lines 31-33; `ScheduledJobRunner.cs:546-550`). A cancellation at host shutdown is deliberately *not* recorded as a failure: it rethrows and the leased row becomes claimable again (`ScheduledJobRunner.cs:539-544`).
- **Walkthrough**: line 44 declares `string Name { get; }`, the stable identity that is also the primary key of the persisted row, so renaming it strands the old row and starts a new schedule, and two registered jobs must never share it (lines 38-43). Line 68 declares `string CronExpression { get; }`, a **five-field** expression (`minute hour day-of-month month day-of-week`) parsed by Cronos, with worked examples on lines 51-56. Two properties of that field are load-bearing: **all times are UTC**, never a local or configured zone, so a schedule never shifts, doubles or vanishes across a daylight-saving transition (lines 57-62), and the value is only the **default**, overridden per job by `Scheduler:Jobs:{Name}:Cron` in configuration whenever that key is present (lines 63-66; resolution at `ScheduledJobRunner.cs:162`). Line 78 declares `Task ExecuteAsync(CancellationToken cancellationToken)`, whose token is cancelled on host shutdown; work that ignores it delays shutdown and can outlive its claim lease (lines 73-76).
- **Why it's built this way**: [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) records the design. Keeping the interface in Application (with no EF, no `IHostedService`, no cron library type in its signature) is what lets a module declare recurring work without taking an Infrastructure dependency, and lets the runner, the persistence of job state and the claim protocol all stay replaceable. Registration is deliberately split in two: `AddScheduledJobs(configuration)` enables the runner once per host (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:304-318`), while `AddScheduledJob<TJob>()` adds one job (`:339-345`). The two are order-free, both use `TryAddEnumerable` so a double call cannot produce two runners racing the same rows (`:311-315`), and registering the scheduler is not the same as turning it on: everything stays inert until `Scheduler:Enabled` is true (`:298-302`).
- **Where it's used**: the framework ships exactly one implementation, `AuditTrailCleanupJob` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailCleanupJob.cs:55`, see [AuditTrailCleanupJob](group-07-persistence-ef-core.md#audittrailcleanupjob)), named `"audit-trail-cleanup"` and scheduled `"0 3 * * *"` (daily at 03:00 UTC, `:63` and `:67`). It is registered by `AddAuditTrail` rather than by `AddScheduledJobs`, which keeps the trail and the scheduler independent features (`Infrastructure/DependencyInjection.cs:388-391`).
- **Caveats / not-in-source**: verified by source search, neither `MMCA.ADC/Source` nor `MMCA.Store/Source` implements `IScheduledJob` today; the retention job is the only job in the workspace. Retention therefore only happens in a host that enables both features: registering the trail without the scheduler records every change and purges nothing, leaving `AuditTrail:RetentionDays` inert (`Infrastructure/DependencyInjection.cs:363-369`).

---

### ITenantContext
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ITenantContext.cs:22` · Level 0 · interface

- **What it is**: the scoped ambient contract for "which tenant is this scope running as": a nullable `TenantId`, an `IsResolved` flag, and a `SetTenant` that may be called once per scope.
- **Depends on**: BCL only. Implemented by [TenantContext](group-07-persistence-ef-core.md#tenantcontext) in Infrastructure, populated at the edge by [TenantResolutionMiddleware](group-12-api-hosting-mapping.md#tenantresolutionmiddleware), and consumed by the caching decorators in this group plus the persistence layer (G07). Configured through [TenancySettings](group-14-module-system-composition.md#tenancysettings). Deliberately mirrors [ICorrelationContext](group-12-api-hosting-mapping.md#icorrelationcontext).
- **Concept introduced, ambient scope state with an honest "unset" value.** `[Rubric §11, Security]` assesses whether data isolation is enforced structurally rather than remembered per query; every tenant-aware read filter, save interceptor and cache key reads this one object, so a handler cannot forget to scope itself. `[Rubric §10, Cross-Cutting Concerns]`: like the correlation id, the value is captured once at the edge and flows implicitly for the rest of the scope. The interesting design decision is the one the doc calls out (`ITenantContext.cs:10-15`): unlike the correlation id there is **no generated fallback**. An unresolved tenant is a meaningful state (a background service, a seeder, an admin flow) and reads as "see everything", so inventing a value would silently scope a system operation to a tenant that does not exist.
- **Walkthrough**: line 28 declares `string? TenantId { get; }`, null until resolved. Line 31 declares `bool IsResolved { get; }`. Line 41 declares `void SetTenant(string tenantId)`, and its contract is the strict part: it throws `ArgumentException` on a null, empty or whitespace id (line 37) and `InvalidOperationException` when a *different* tenant was already resolved for this scope (lines 38-40), while accepting the value it already holds. The rationale is on lines 16-20: **one scope, one tenant**, because a scope whose tenant changed mid-flight has already read rows under the previous tenant and there is no honest way to reconcile that afterwards. The implementation matches exactly (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TenantContext.cs:20-44`), and its `InvalidOperationException` message tells the caller to start a new scope.
- **Why it's built this way**: [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) records the multi-tenancy model. Putting the contract in Application, not Infrastructure, is what lets the Application-layer caching decorators scope their keys without referencing EF Core: [CachingCommandDecorator<TCommand, TResult>](#cachingcommanddecoratortcommand-tresult) and [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult) both take it as an **optional** constructor parameter defaulting to `null` (`.../Decorators/CachingCommandDecorator.cs:36`, `.../Decorators/CachingQueryDecorator.cs:38`), so a single-tenant host that never calls `AddMultiTenancy` resolves them unchanged and pays nothing.
- **Where it's used**: registered scoped in `AddMultiTenancy` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:452`). Written at the edge by [TenantResolutionMiddleware](group-12-api-hosting-mapping.md#tenantresolutionmiddleware) from a claim or a header (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:52`), and re-asserted onto a fresh scope by every background path that fans out per tenant: [OutboxProcessor](group-04-events-outbox.md#outboxprocessor) (`.../Persistence/Outbox/OutboxProcessor.cs:246`), `OutboxCleanupService` (`:100`), [AuditTrailCleanupJob](group-07-persistence-ef-core.md#audittrailcleanupjob) (`:106`), and startup database initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:128`). Read by `DbContextFactory` for per-tenant routing (`.../DbContexts/Factory/DbContextFactory.cs:44`, also optional) and by both caching decorators through `TenantCacheKey.Scope` (`.../Decorators/TenantCacheKey.cs:37-38`).
- **Caveats / not-in-source**: verified by source search, neither ADC nor Store resolves or sets `ITenantContext` today. Multi-tenancy is a shipped, tested framework capability that no deployed app has opted into, so every scope in production runs unresolved and the tenant-scoped cache keys and query filters are no-ops there.

---

### ITransactional
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/ITransactional.cs:6` · Level 0 · interface (marker)

- **What it is**: a C# empty-body interface (`public interface ITransactional;`) that a **command** implements to opt in to database-transaction wrapping by [TransactionalCommandDecorator<TCommand, TResult>](#transactionalcommanddecoratortcommand-tresult).
- **Depends on**: nothing (BCL only).
- **Concept introduced, marker interfaces as opt-in decorator switches.** `[Rubric §2, Design Patterns]` assesses the deliberate, idiomatic use of patterns; a **marker interface** carries no members, so its mere presence on a type is the signal. The decorator's whole dispatch is `if (command is not ITransactional)` followed by a pass-through (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:25-26`). Read that line carefully: the marker goes on the **command record**, not on the handler class, which is the same convention [IFeatureGated](#ifeaturegated) and [ICacheInvalidating](#icacheinvalidating) follow. This is also `[Rubric §1, SOLID]` (open for extension): the pipeline gains new transactional commands with no change to any existing decorator. The semicolon-body syntax (`interface ITransactional;`, line 6) is the idiomatic zero-member declaration and is used consistently across the framework's markers.
- **Walkthrough**: the entire file body is `public interface ITransactional;` at line 6, under the doc comment on lines 3-5. No members; the type *is* the message.
- **Why it's built this way**: keeping transaction scope opt-in spares single-statement commands the cost of an explicit `BEGIN TRANSACTION` / `COMMIT` around a save that is already atomic. Commands that mutate multiple aggregates opt in. The behavior that comes with opting in is documented in `MMCA.Common/CLAUDE.md` and worth knowing before you add the marker: exceptions **and** business failures (`Result.Failure`) both roll back, and in-process domain event dispatch is deferred until after a successful commit, so handlers never act on state that could still roll back.
- **Where it's used**: sparingly, on genuinely multi-aggregate writes. Source search finds 3 files in `MMCA.ADC/Source` (`RefreshFromSessionizeCommand`, `LinkUserToSpeakerCommand`, `UnlinkUserFromSpeakerCommand`) and 2 in `MMCA.Store/Source` (`UploadProductImageCommand`, `ReorderProductImagesCommand`). Inspected at execution time by [TransactionalCommandDecorator<TCommand, TResult>](#transactionalcommanddecoratortcommand-tresult), the **innermost** command decorator, so it sits closest to the handler (see the registration note under [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult)).

---

### DeleteEntityCommand<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityCommand.cs:11` · Level 1 · record (sealed)

- **What it is**: a generic delete command carrying the entity's primary key `Id` plus a cache prefix to evict. The `TEntity` type parameter does double duty: it discriminates handlers in DI, and it supplies the default `CachePrefix`.
- **Depends on**: [ICacheInvalidating](#icacheinvalidating) (implemented, line 11) and BCL reflection (`typeof(TEntity).FullName`). Participates in the pipeline described under [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); handled generically by [DeleteEntityHandler<TEntity, TIdentifierType>](#deleteentityhandlertentity-tidentifiertype).
- **Concept introduced, a type parameter as both a dispatch key and a data source.** `[Rubric §1, SOLID]` assesses single responsibility and extension without modification; one closed handler per entity type keeps dispatch unambiguous. `[Rubric §6, CQRS & Event-Driven]` assesses the write/read segregation; this is a pure write command. Without `TEntity`, every delete command sharing a `TIdentifierType` (say `int`) would collapse onto one closed generic and Scrutor-based handler registration would be ambiguous. The second use is newer and more interesting: because the generic controller constructs this command itself, no caller is in a position to pass a cache prefix, so the command computes the conventional one.
- **Walkthrough**: line 11 declares `public sealed record DeleteEntityCommand<TEntity, TIdentifierType>(TIdentifierType Id) : ICacheInvalidating`; the record primary constructor makes `Id` a positional `init` property, and `sealed` prevents inheritance. Line 12 constrains `where TIdentifierType : notnull`, forbidding a nullable key type. Line 20 implements the interface member: `public string CachePrefix { get; init; } = typeof(TEntity).FullName + ":";`. Two things follow from that one line. It is `init`, so a caller that wants a narrower prefix can set one at construction. And its default is the aggregate-prefix convention every consumer already keys its cached reads under, which is exactly the prefix ADC's cached `GetNowNextQuery` sits behind (see [IQueryCacheable](#iquerycacheable)). Setting it to an empty string is the documented **opt-out** (lines 14-19), and it works because the caching decorator refuses a blank prefix rather than evicting the whole cache.
- **Why it's built this way**: it avoids hand-writing a bespoke `DeleteSessionCommand`, `DeleteSpeakerCommand` and so on in every module; one generic command plus one generic handler covers the boilerplate while the type system still routes each call to the correct closed handler. Defaulting the prefix rather than leaving it blank means the generic delete path invalidates caches by default, which is the safe direction for a mutation whose call site cannot make the decision.
- **Where it's used**: the aggregate-root controllers' delete actions ([AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest), G12) dispatch `DeleteEntityCommand<TEntity, Id>`; each module resolves either the generic default handler or a custom override.

---

### IAuditTrailReader
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IAuditTrailReader.cs:20` · Level 1 · interface

- **What it is**: the one-method read surface over the recorded change history of a single entity: one page of changes, newest first.
- **Depends on**: [AuditTrailEntryDTO](group-14-module-system-composition.md#audittrailentrydto) (its return payload, `using` at line 1). Implemented by [AuditTrailReader](group-07-persistence-ef-core.md#audittrailreader) over the [AuditTrailEntry](group-07-persistence-ef-core.md#audittrailentry) rows written by the audit-trail save interceptor.
- **Concept introduced, shipping the read without shipping the exposure.** `[Rubric §30, Compliance, Privacy & Data Governance]` assesses whether a system can answer "who changed this, and when"; the trail is that answer, and this is how an application asks. `[Rubric §11, Security]` assesses authorization placement, and the doc is explicit about the boundary it draws (`IAuditTrailReader.cs:10-15`): there is deliberately **no shipped endpoint or page** in v1, because who may see an entity's history is an application decision (an admin screen, a support tool, a data-subject request) rather than a framework one. Consumers wrap this in whatever query and authorization their domain calls for. `[Rubric §3, Clean Architecture]`: the contract speaks in strings and DTOs with no EF type in its signature, so the Application layer can offer history without knowing where rows live.
- **Walkthrough**: lines 37-42 declare the single member, `Task<IReadOnlyList<AuditTrailEntryDTO>> GetForEntityAsync(string entityType, string entityKey, int page = 1, int pageSize = 50, CancellationToken cancellationToken = default)`. The two identity parameters are string-typed on purpose, because they must match what the interceptor recorded: `entityType` is the full CLR type name (line 25-28, for example `typeof(Order).FullName`) and `entityKey` is the invariant string form of the primary key, with composite parts joined by `|` in the model's key order (lines 29-32). Paging is forgiving rather than validating: values below 1 are treated as 1 for both `page` and `pageSize` (lines 33-34, enforced at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailReader.cs:50-51`). Ordering is part of the contract, not an implementation detail (lines 18, 23): newest change first, so the first page is the most recent activity. The implementation orders by `ChangedOn` descending with `Id` descending as the tie-break (`AuditTrailReader.cs:63-64`), which is what makes paging stable when several properties change in one save.
- **Why it's built this way**: [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) records the trail. The interface exists at all so the read is testable and swappable, and it returns a DTO rather than the entity so the Application layer never handles a tracked row. The implementation is honest about a v1 limitation worth knowing before you build on it (`AuditTrailReader.cs:16-25`): trail rows are written to whichever database holds the entity that changed, which is what makes the write atomic, but this reader queries exactly one of them, the `Default` database of the engine named by `AuditTrail:DataSource`. For a monolith that is the whole trail; for a database-per-module host it is only the modules living in the default database.
- **Where it's used**: registered scoped by `AddAuditTrail` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:386`), which is opt-in per host: a host that never calls it has no implementation to resolve (`IAuditTrailReader.cs:6-7`). The reader returns an empty list rather than throwing when the trail table is absent from the model (`AuditTrailReader.cs:56-59`), so registering the feature before flipping `AuditTrail:Enabled` is safe.
- **Caveats / not-in-source**: verified by source search, no ADC or Store type consumes `IAuditTrailReader` today. Framework capability, no application consumer yet.

---

### CacheKeyLocks
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICacheService.cs:142` · Level 2 · class (static, internal)

- **What it is**: a two-line internal holder for the process-wide stripe table that the default `ICacheService.GetOrCreateAsync<T>` implementation uses to keep concurrent misses on one key from all running the factory.
- **Depends on**: [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) (`MMCA.Common.Shared.Concurrency`, `using` at `ICacheService.cs:1`). Used only by [ICacheService](group-09-caching.md#icacheservice)'s default interface method.
- **Concept introduced, cache stampede protection and why the lock table is striped.** `[Rubric §12, Performance & Scalability]` assesses behavior under load, and this is the classic thundering-herd guard: on a cold key, N concurrent readers would otherwise all miss, all call the expensive factory, and all write the same value. The interesting part is the *shape* of the guard. A per-key semaphore table forces a bad choice, spelled out on `ICacheService.cs:135-140`: drop the entry on release and two callers can run concurrently, or never drop it and a parameterized cache key grows the table without bound. Striping sidesteps both by hashing keys onto a fixed number of semaphores ([KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) defaults to 256 stripes, `MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:25`) and accepting that two unrelated keys occasionally share one. That is a fixed, bounded cost, and the stripes are never disposed because the table outlives every caller.
- **Walkthrough**: line 142 declares `internal static class CacheKeyLocks`; line 145 declares its only member, `internal static readonly KeyedSemaphoreStripe Locks = new()`. The consuming sequence is the double-checked idiom at `ICacheService.cs:107-124`: a lock-free `GetAsync` fast path returns immediately on a hit (lines 107-110), then the stripe is taken (line 112), then the key is re-read inside the stripe (lines 116-118) so the waiters see what the winner just wrote, and only a still-missing key runs the factory and stores it (lines 120-122). The class doc (lines 127-133) explains the non-generic holder: statics on a generic method's declaring type would already be shared, but a holder keeps the table addressable and matches the sibling `QueryCacheKeyLocks` in the caching decorator (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:194-197`).
- **Why it's built this way**: the two tables are separate **on purpose** (`ICacheService.cs:137-140`): these are different call sites over different keys, so sharing stripes would only widen the unrelated-key collisions striping already tolerates. Two limits of the mechanism are documented on the member it guards (`ICacheService.cs:80-97`) and matter more than the class itself. First, **caching here is unconditional**: whatever the factory returns is stored, including a failed [Result](group-01-result-error-handling.md#result), which is exactly why the caching decorators do NOT route through `GetOrCreateAsync` and keep their own read/execute/write sequence. Second, **stampede protection is per process**: the stripe table is process-wide, so with several replicas over one shared cache the factory can still run once per replica; a cluster-wide guarantee would need an [IDistributedLock](#idistributedlock) and is deliberately not attempted here.
- **Where it's used**: only by the default implementation of `ICacheService.GetOrCreateAsync<T>` (`ICacheService.cs:112`). Backing stores with a native two-level primitive (`HybridCacheService`, see [HybridCacheService](group-09-caching.md#hybridcacheservice)) override the method and never touch this table.
- **Caveats / not-in-source**: the type is `internal`, so it is not part of the public package surface and cannot be referenced or replaced from a consumer app; it is documented here because the behavior it produces is visible to anyone calling `GetOrCreateAsync`.

---

### DeleteEntityHandler<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:14` · Level 8 · class

- **What it is**: the *generic* delete handler that works for any aggregate root, implementing `ICommandHandler<DeleteEntityCommand<TEntity, TIdentifierType>, Result>` (line 16).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (primary-constructor injected, line 15); constrained `where TEntity : AuditableAggregateRootEntity<TIdentifierType>` ([AuditableAggregateRootEntity<TIdentifierType>](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), line 17) and `where TIdentifierType : notnull` (line 18). Returns [Result](group-01-result-error-handling.md#result) with failures described by [Error](group-01-result-error-handling.md#error); handles [DeleteEntityCommand<TEntity, TIdentifierType>](#deleteentitycommandtentity-tidentifiertype).
- **Concept reinforced, one handler, every aggregate.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §1, SOLID]` (do not repeat yourself, single responsibility). The body (`DeleteEntityHandler.cs:21-35`) is the delete template made generic: get the repository through `unitOfWork.GetRepository<TEntity, TIdentifierType>()` (line 25); load by id and return `Error.NotFound`, stamped with the handler name via `WithSource` and the entity name via `WithTarget`, when the row is missing (lines 26-28); call `entity.Delete()`, which soft-deletes and may enforce rules or raise domain events (line 30); and `SaveChangesAsync` **only when** `result.IsSuccess` (lines 31-32), returning the entity's own `Result` either way (line 34). This is the default that the aggregate-root controllers' delete slot resolves to, unless a module registers a custom override (ADC's `DeleteEventHandler`, for instance, needs a cross-aggregate cascade).
- **Why it's built this way**: most deletes are identical (load, `Delete()`, save), so the framework supplies the handler once on top of Common's soft-delete convention ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)); a module overrides only when there is a cascade or an extra rule. Returning the entity's own `Delete()` result lets a domain-level refusal (for example "cannot delete a published event") propagate as a value rather than an exception.
- **Where it's used**: registered generically and consumed by the aggregate-root controller delete actions ([AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>](group-12-api-hosting-mapping.md#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest), G12).
- **Caveats / not-in-source**: the command it handles does **not** implement [ITransactional](#itransactional), so a delete that raises domain events relies on `SaveChangesAsync` writing the data plus its outbox rows in one transaction rather than on a handler-level transaction; the outbox is the durability mechanism ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). It *does* get cache invalidation for free, because [DeleteEntityCommand<TEntity, TIdentifierType>](#deleteentitycommandtentity-tidentifiertype) implements [ICacheInvalidating](#icacheinvalidating) with a defaulted prefix.

### CqrsMetrics
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs:16` · Level 0 · class (static, internal)

- **What it is**: an `internal static` class that owns one `System.Diagnostics.Metrics.Meter` and four instruments: two duration histograms (`cqrs.command.duration`, `cqrs.query.duration`) and two cache counters (`cqrs.query.cache.hit`, `cqrs.query.cache.miss`). The logging decorators record duration on every command and query; the caching query decorator records the hit/miss counters. Together they give RED (Rate / Errors / Duration) instrumentation for the whole CQRS pipeline, plus a cache hit ratio.
- **Depends on**: BCL only (`System.Diagnostics.Metrics`, `CqrsMetrics.cs:1`). Recorded into by [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult), [LoggingQueryDecorator<TQuery, TResult>](#loggingquerydecoratortquery-tresult), and [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult).
- **Concept introduced, BCL-native metrics + RED instrumentation.** `[Rubric §13, Observability & Operability]` assesses whether every unit of work emits rate, error, and latency signals an operator can dashboard and alert on. A single histogram tagged by `outcome` supplies all three dimensions at once: the measurement value is duration, the count is the rate, and the count filtered to a failure `outcome` is the error rate (the class doc says exactly this, `CqrsMetrics.cs:5-10`). Using `System.Diagnostics.Metrics` rather than a third-party client means the OpenTelemetry SDK exports these once a host registers the meter name. The doc comment notes the meter name is duplicated as a literal string in `MMCA.Common.Aspire` because that package holds no reference to Application (`CqrsMetrics.cs:9-10`), and the literal is verifiably there: `.AddMeter("MMCA.Common.Cqrs")` in the Aspire service defaults (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:161`, beside the Outbox, Idempotency, and Scheduler meters). The two names agree today, but nothing in the compiler enforces that they keep agreeing.
- **Walkthrough**
  - `MeterName` (`CqrsMetrics.cs:19`): `internal const string = "MMCA.Common.Cqrs"`, the single name a host registers for export.
  - `Meter` (`CqrsMetrics.cs:21`): a `private static readonly Meter` created once at class initialization, so no instrument is re-registered per decorator instance.
  - `CommandDuration` (`CqrsMetrics.cs:24-27`) and `QueryDuration` (`CqrsMetrics.cs:30-33`): `internal static readonly Histogram<double>` instruments named `cqrs.command.duration` / `cqrs.query.duration`, unit `"ms"`, each described as tagged by name and outcome.
  - `QueryCacheHits` (`CqrsMetrics.cs:36-39`) and `QueryCacheMisses` (`CqrsMetrics.cs:42-45`): `Counter<long>` instruments named `cqrs.query.cache.hit` / `cqrs.query.cache.miss`, unit `"{query}"`. Charting one over their sum is the per-query hit ratio, which is how an operator spots a cache that has quietly stopped serving reads (`CqrsMetrics.cs:11-14`).
  - `RecordCacheHit` / `RecordCacheMiss` (`CqrsMetrics.cs:49-55`): one-line helpers that `Add(1, ...)` with a single `query` tag. Exposing methods rather than the raw counters keeps the tag name spelled once.
  - Visibility: everything is `internal`, so only decorators in this assembly can record measurements and no external code can pollute the series.
- **Why it's built this way**: one static holder avoids the duplicate-instrument problem that would follow from each closed generic decorator creating its own meter, and the tag dimension (rather than one counter per outcome) is the idiomatic OpenTelemetry shape for RED.
- **Where it's used**: [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult) records `CommandDuration` (`LoggingCommandDecorator.cs:69-73`); [LoggingQueryDecorator<TQuery, TResult>](#loggingquerydecoratortquery-tresult) records `QueryDuration` (`LoggingQueryDecorator.cs:67-71`); [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult) calls `RecordCacheHit` / `RecordCacheMiss` (`CachingQueryDecorator.cs:82`, `:94`, `:104`).
- **Caveats / not-in-source**: the `outcome` tag values are set by the logging decorators, not here. They are `"completed"`, `"failed"`, or `"exception"` (`LoggingCommandDecorator.cs:42`, `:47`, `:56`), a three-valued dimension rather than a bare success/failure pair.

---

### ProfilingCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ProfilingCommandDecorator.cs:11` · Level 1 · class (sealed)

- **What it is**: a decorator that wraps command handler execution in a MiniProfiler step, so each command shows up as a timed node in a MiniProfiler trace.
- **Depends on**: `StackExchange.Profiling` (NuGet, MiniProfiler, `ProfilingCommandDecorator.cs:1`); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult) (both the inner handler it wraps and the interface it implements, `ProfilingCommandDecorator.cs:11-12`).
- **Concept introduced, opt-in profiling kept out of the standard pipeline.** `[Rubric §13, Observability & Operability]` assesses developer-facing profiling for pinpointing where time goes inside a request. This is the plain Decorator shape (a handler holding a handler), but unlike the five standard decorators it is **not** registered by `AddApplicationDecorators()` (`DependencyInjection.cs:89-106`). It is added only by the separate `AddApplicationProfiling()` extension (`DependencyInjection.cs:219-225`), so a host that never calls that method never pays for it.
- **Walkthrough**: `HandleAsync` (`ProfilingCommandDecorator.cs:15`) opens `using var step = MiniProfiler.Current?.Step($"CommandHandler: {typeof(TCommand).Name}")` (`ProfilingCommandDecorator.cs:17`) and then awaits the inner handler (`ProfilingCommandDecorator.cs:18`). The null-conditional `?.Step(...)` makes the whole body a no-op when no MiniProfiler is ambient for the current request, so there is no measurable cost when profiling is off; the step name carries the command type name so the profile is readable.
- **Why it's built this way**: keeping profiling in its own opt-in decorator (rather than folding it into the always-on logging decorator) means the profiler overhead and its ambient-profiler dependency exist only when a host explicitly turns it on.
- **Where it's used**: registered by `AddApplicationProfiling()` (`DependencyInjection.cs:221`) to wrap every command handler. Its counterpart middleware is wired in the API layer (see [MiniProfilerExtensions](group-12-api-hosting-mapping.md#miniprofilerextensions)).
- **Caveats / not-in-source**: no host in this workspace calls `AddApplicationProfiling()` today. A repo-wide search for the method name finds only its declaration (`DependencyInjection.cs:219`) and its unit test (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DependencyInjectionTests.cs`), so this decorator is a tested extension point with no current adopter.

---

### ProfilingQueryDecorator<TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ProfilingQueryDecorator.cs:11` · Level 1 · class (sealed)

- **What it is**: the query-side twin of [ProfilingCommandDecorator<TCommand, TResult>](#profilingcommanddecoratortcommand-tresult). Same shape, one method, wrapping an [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult) (`ProfilingQueryDecorator.cs:11-12`).
- **Depends on**: `StackExchange.Profiling` (NuGet); [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult).
- **Concept reinforced**: see [ProfilingCommandDecorator<TCommand, TResult>](#profilingcommanddecoratortcommand-tresult). `[Rubric §13, Observability & Operability]`. Also registered only by the opt-in `AddApplicationProfiling()` (`DependencyInjection.cs:222`), never by the standard `AddApplicationDecorators()`.
- **Walkthrough**: `HandleAsync` (`ProfilingQueryDecorator.cs:15`) opens `MiniProfiler.Current?.Step($"QueryHandler: {typeof(TQuery).Name}")` (`ProfilingQueryDecorator.cs:17`), a no-op when the profiler is inactive, then awaits the inner query handler (`ProfilingQueryDecorator.cs:18`).
- **Where it's used**: registered by `AddApplicationProfiling()` to wrap every query handler; like its command twin, no host calls that method today.

---

### TenantCacheKey
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TenantCacheKey.cs:25` · Level 1 · class (static, internal)

- **What it is**: a two-member `internal static` helper that turns a cache key (or a cache prefix) into its tenant-scoped form. Both caching decorators run every key they touch through this one method, which is what keeps reads and invalidations pointing at the same entries.
- **Depends on**: [ITenantContext](#itenantcontext) (`MMCA.Common.Application.Interfaces`, `TenantCacheKey.cs:1`, `:37`). Nothing else, not even the cache abstraction: this type only computes strings.
- **Concept introduced, tenant isolation applied where the key is computed.** `[Rubric §11, Security]` assesses whether one customer's data can reach another; `[Rubric §30, Compliance, Privacy & Data Governance]` assesses tenant data boundaries. The problem the class doc states (`TenantCacheKey.cs:9-14`) is a lifetime mismatch: `ICacheService` is a **singleton** and cannot see the scoped tenant, so if two tenants both computed the cache key `products`, the cache would happily serve one tenant's rows to the other. The framework's answer is not a tenant-aware cache but a tenant-aware key, computed once in one place so the query decorator's read and the command decorator's eviction cannot drift apart. The scoped form is deliberately a **prefix**, not a suffix (`TenantCacheKey.cs:15-19`), because prefix eviction is the invalidation primitive: evicting `t:acme:products` removes exactly that tenant's product entries, and no command in one tenant can evict another tenant's cache. Multi-tenancy as a whole is [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html), which is opt-in.
- **Walkthrough**
  - `Marker` (`TenantCacheKey.cs:28`): `internal const string Marker = "t:"`, the two-character opener of a scoped key. The doc comment gives the reason it is short: it is on every key (`TenantCacheKey.cs:27`).
  - `Scope(ITenantContext?, string)` (`TenantCacheKey.cs:37-40`): the whole implementation is one expression. The pattern `tenantContext is { IsResolved: true, TenantId: { } tenantId }` (`TenantCacheKey.cs:38`) tests three things at once: the context is not null (a host that never registered tenancy passes `null`), it has resolved a tenant, and `TenantId` is non-null, binding it in the same test. When all three hold it returns `string.Concat("t:", tenantId, ":", key)`; otherwise it returns `key` **unchanged** (`TenantCacheKey.cs:39-40`).
- **Why it's built this way**: the untouched-key fallback is the upgrade story (`TenantCacheKey.cs:20-23`): a single-tenant host has byte-identical keys to the pre-tenancy framework, so upgrading orphans no cache entry and changes no behavior. Centralizing the transformation in one `internal static` method rather than duplicating a `$"t:{id}:{key}"` interpolation in each decorator is what makes the symmetry argument checkable: there is exactly one function to read.
- **Where it's used**: [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult) calls it from `EffectiveKey` (`CachingQueryDecorator.cs:63-64`) for both the cache key and the stampede lock key; [CachingCommandDecorator<TCommand, TResult>](#cachingcommanddecoratortcommand-tresult) calls it on the command's `CachePrefix` before eviction (`CachingCommandDecorator.cs:82`).
- **Caveats / not-in-source**: `Scope` does nothing to sanitize `tenantId` or `key`, so a tenant id containing `:` would produce an ambiguous key. Whether the tenant resolver can ever yield such an id is decided in [ITenantContext](#itenantcontext)'s implementation, not here.

---

### QueryCacheKeyLocks
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:194` · Level 2 · class (static, internal)

- **What it is**: a tiny `internal static` holder for the process-wide lock set used by [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult) for cache-stampede protection. It declares one member: a [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe), a fixed-width set of pre-allocated semaphores that cache keys are hashed onto.
- **Depends on**: [KeyedSemaphoreStripe](group-08-auth.md#keyedsemaphorestripe) (`MMCA.Common.Shared.Concurrency`, the only type it holds; BCL `SemaphoreSlim` underneath). Consumed exclusively by [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult).
- **Concept introduced, why a shared lock table must live in a non-generic class.** `[Rubric §12, Performance & Scalability]` assesses whether a cache guards against the stampede (thundering herd) in which many concurrent requests all miss a just-expired hot key and all run the expensive query at once. The lock has to be shared by every request for the same key, but the decorator is an open generic. A `static` field on a generic type is **per closed type**, so `CachingQueryDecorator<QueryA, ...>` and `CachingQueryDecorator<QueryB, ...>` would each get their own lock set and never serialize against each other on a shared key. Hoisting the field into this non-generic holder (the doc comment states exactly this rationale, `CachingQueryDecorator.cs:173-177`) gives every closed decorator one table.
- **Walkthrough**: `Locks` (`CachingQueryDecorator.cs:197`) is `internal static readonly KeyedSemaphoreStripe Locks = new()`, the default-width stripe set: 256 stripes (`KeyedSemaphoreStripe.cs:25`, `:30-33`), every semaphore allocated up front in the constructor as `new SemaphoreSlim(1, 1)` (`KeyedSemaphoreStripe.cs:42-47`). Keys are **bucketed, not distinguished**: `GetStripe` folds an ordinal string hash onto a stripe index, `(uint)string.GetHashCode(key, StringComparison.Ordinal) % (uint)Width` (`KeyedSemaphoreStripe.cs:73`), so two unrelated cache keys can land on the same stripe and briefly serialize against each other. A caller takes a stripe with `await Locks.AcquireAsync(key, cancellationToken)` and releases it by disposing the returned [Releaser](group-08-auth.md#releaser) handle (`KeyedSemaphoreStripe.cs:60-65`, `:78-86`). There is no add or remove lifecycle at all: nothing is inserted on a miss, nothing is evicted on release, and the stripes are never disposed because the holder lives for the process (`KeyedSemaphoreStripe.cs:18-21`).
- **Why it's built this way**: the remarks (`CachingQueryDecorator.cs:178-185`) name the defect this shape avoids. One semaphore per key in a `ConcurrentDictionary` forces a choice between two bugs: removing the entry when the last holder releases opens a window in which one caller waits on a semaphore that is no longer in the table while a second caller creates a fresh one (both then run concurrently, defeating the lock), and never removing it lets a cache key that embeds a user id or a filter value grow the table without bound. A fixed-width stripe set has neither problem, and the collision it introduces is harmless for a double-check-locking caller, which re-reads its own key's cache entry after acquiring (`CachingQueryDecorator.cs:91-96`). It is the same primitive and the same double-check pattern that [IdempotencyFilter](group-12-api-hosting-mapping.md#idempotencyfilter) falls back on; the caching strategy as a whole is [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html).
- **Where it's used**: only by [CachingQueryDecorator<TQuery, TResult>](#cachingquerydecoratortquery-tresult), whose slow (cache-miss) path wraps the double-check and the handler call in `using (await QueryCacheKeyLocks.Locks.AcquireAsync(cacheKey, cancellationToken))` (`CachingQueryDecorator.cs:89`). The key passed in is the tenant-scoped one, so tenants do not queue behind each other by accident (`CachingQueryDecorator.cs:74-76`).
- **Caveats / not-in-source**: the lock is per-process (`CachingQueryDecorator.cs:186-192`). Across several app instances sharing one distributed cache, stampede protection is best-effort: at most one handler execution per instance, not one cluster-wide. The remarks call that duplication harmless (equal content, last write wins) and state that a cluster-wide guarantee would need a distributed lock and is deliberately not attempted here.

---

### LoggingCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:14` · Level 3 · class (sealed, partial)

- **What it is**: the observability decorator on the command side. It opens a correlated logging scope, times the full inner pipeline, logs start / completion / failure / exception, and records the duration into [CqrsMetrics](#cqrsmetrics). In the standard pipeline it is the second-outermost command decorator, just inside FeatureGate.
- **Depends on**: [CqrsMetrics](#cqrsmetrics); [ICorrelationContext](group-12-api-hosting-mapping.md#icorrelationcontext) (supplies `CorrelationId`, `LoggingCommandDecorator.cs:16`, `:23`); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); [Result](group-01-result-error-handling.md#result) (pattern-matched to detect failure); `Microsoft.Extensions.Logging` and `System.Diagnostics` (BCL).
- **Concept introduced, structured logging plus metrics as a single cross-cutting stage.** `[Rubric §13, Observability & Operability]` assesses whether every command emits correlated, structured logs and a latency/outcome metric with no per-handler boilerplate; `[Rubric §10, Cross-Cutting Concerns]` assesses factoring that out of business logic. Every command is logged and measured uniformly whether or not it is cached, validated, or transactional, because this decorator sits above all of those in the chain. `[Rubric §12, Performance & Scalability]` also applies: the hot path uses the `[LoggerMessage]` source generator, a source-generated scope, and a raw `Stopwatch` timestamp instead of a `Stopwatch` instance, so it avoids message interpolation, per-call dictionary boxing, and one allocation per command.
- **Walkthrough**
  - Names and correlation (`LoggingCommandDecorator.cs:22-23`): `typeof(TCommand).Name` and `correlationContext.CorrelationId`, both read once.
  - Scope (`LoggingCommandDecorator.cs:25`): `using (BeginCommandScope(logger, commandName, correlationId))` opens a structured scope so inner decorators and the handler share `CommandName` + `CorrelationId`. `BeginCommandScope` is a `static readonly Func<ILogger, string, string, IDisposable?>` built from `LoggerMessage.DefineScope<string, string>` (`LoggingCommandDecorator.cs:66-67`), the allocation-light alternative to an anonymous-dictionary `BeginScope` (the comment at `:62-65` says so).
  - Start (`LoggingCommandDecorator.cs:27`): `LogCommandStarted` at `Debug` (`LoggingCommandDecorator.cs:77-78`), deliberately not `Information`. The inline comment (`:75-76`) gives the reason: the completion line already carries name and duration, and two `Information` rows per command doubles ingestion cost for no diagnostic gain.
  - Timing (`LoggingCommandDecorator.cs:32`): `Stopwatch.GetTimestamp()`, with `Stopwatch.GetElapsedTime(startTimestamp)` computed in each branch (`:36`, `:54`). The comment (`:29-31`) records both the motive (one fewer allocation than a `Stopwatch` instance, same resolution) and the invariant it preserves: elapsed is captured **before** logging, so the recorded duration stays the handler's.
  - Failure branch (`LoggingCommandDecorator.cs:38-43`): on `Result { IsFailure: true }` it joins `Errors` into a `"{Code}: {Message}"` summary, logs `LogCommandFailed` at `Warning` (`:83-84`), and records the duration with outcome `"failed"`. A business failure is a `Warning`, not an `Error`: it is an expected outcome, not a defect.
  - Success branch (`LoggingCommandDecorator.cs:44-48`): `LogCommandCompleted` at `Information` (`:80-81`) and outcome `"completed"`.
  - Exception branch (`LoggingCommandDecorator.cs:52-58`): recomputes elapsed, logs `LogCommandException` at `Error` (`:86-87`), records outcome `"exception"`, then **rethrows** so no decorator swallows a fault.
  - `RecordDuration` (`LoggingCommandDecorator.cs:69-73`): the one place that touches `CqrsMetrics.CommandDuration`, tagging `command` and `outcome`.
- **Why it's built this way**: `partial class` plus `[LoggerMessage]` (`LoggingCommandDecorator.cs:77-87`) is the .NET-recommended high-performance structured-logging shape, and the three-valued `outcome` tag lets one histogram separate success from domain failure from a genuine exception on a dashboard.
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:97`), fourth of five command registrations, which under Scrutor's reverse-order decoration makes it the second-outermost wrapper on every command handler.
- **Caveats / not-in-source**: the outcome is recorded per branch, not in a `finally`. A cancellation that surfaces as an exception therefore lands in the `"exception"` bucket like any other throw; there is no separate `"cancelled"` outcome.

---

### LoggingQueryDecorator<TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:13` · Level 3 · class (sealed, partial)

- **What it is**: the query-side twin of [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult): correlated scope, timestamp-based timing, completion / failure / exception logging, and a [CqrsMetrics](#cqrsmetrics) duration recording.
- **Depends on**: [CqrsMetrics](#cqrsmetrics); [ICorrelationContext](group-12-api-hosting-mapping.md#icorrelationcontext); [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult); [Result](group-01-result-error-handling.md#result); `Microsoft.Extensions.Logging`, `System.Diagnostics`.
- **Concept reinforced**: see [LoggingCommandDecorator<TCommand, TResult>](#loggingcommanddecoratortcommand-tresult). `[Rubric §13, Observability & Operability]` and `[Rubric §10, Cross-Cutting Concerns]`.
- **Walkthrough**: `HandleAsync` (`LoggingQueryDecorator.cs:19`) opens `BeginQueryScope(logger, queryName, correlationId)` (`:24`), a source-generated `LoggerMessage.DefineScope<string, string>` (`:64-65`), then times the inner handler from a `Stopwatch.GetTimestamp()` (`:29`, `:33`). The branch structure matches the command side exactly: `Result { IsFailure: true }` produces an error summary, `LogQueryFailed` at `Warning` (`:76-77`) and outcome `"failed"` (`:35-40`); success logs `LogQueryCompleted` and outcome `"completed"` (`:41-45`); an exception logs `LogQueryException` at `Error` (`:79-80`), records `"exception"`, and rethrows (`:49-55`). `RecordDuration` (`:67-71`) writes `CqrsMetrics.QueryDuration` tagged `query` + `outcome`. Two differences from the command side are worth noting: query **completion** logs at `Debug` (`LoggingQueryDecorator.cs:73`), not `Information`, since reads are far more frequent than writes, and there is **no** "started" log line at all, so a query emits one row per execution.
- **Why it's built this way**: the scope comment (`LoggingQueryDecorator.cs:59-63`) records the reason it matches the command decorator rather than using a dictionary: the previous `BeginScope(new Dictionary<string, object>)` allocated a dictionary and boxed the scope state on every query, at every log level, including when logging was disabled entirely.
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:102`) to wrap every query handler, immediately inside the feature gate.

---

### ResultFailureFactory
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ResultFailureFactory.cs:11` · Level 3 · class (static, internal)

- **What it is**: an `internal static` helper that builds a delegate turning an `IEnumerable<Error>` into a `TResult` failure, working for both non-generic [Result](group-01-result-error-handling.md#result) and generic `Result<T>`, without constraining the caller's `TResult`.
- **Depends on**: [Result](group-01-result-error-handling.md#result) and [Error](group-01-result-error-handling.md#error) (`MMCA.Common.Shared.Abstractions`, `ResultFailureFactory.cs:2`); BCL `System.Linq.Expressions` and `System.Reflection`.
- **Concept introduced, short-circuiting an unconstrained generic pipeline.** `[Rubric §15, Best Practices & Code Quality]` assesses how cleanly the codebase solves an awkward generic problem. The decorators need to *fail* a handler call without running the inner handler, but their `TResult` is an open type parameter that is either `Result` or `Result<T>`; you cannot write `return Result.Failure<T>(...)` when you do not know `T`. Constraining `TResult : Result` would change the handler interface contract for every handler in both apps, so instead this factory isolates the reflection to one place and, for the generic branch, compiles it into a delegate so the per-call cost is a plain invocation rather than `MethodInfo.Invoke` (the doc comment states this, `ResultFailureFactory.cs:16-17`).
- **Walkthrough**
  - `Build<TResult>()` (`ResultFailureFactory.cs:20`): the single entry point, returning `Func<IEnumerable<Error>, TResult>`.
  - Non-generic branch (`ResultFailureFactory.cs:22-25`): when `typeof(TResult) == typeof(Result)`, returns `errors => (TResult)(object)Result.Failure(errors)`. The double cast through `object` is what the compiler requires with an unconstrained `TResult`.
  - Generic branch (`ResultFailureFactory.cs:27-41`): when `TResult` is a closed `Result<>`, it takes the inner type (`:29`), reflects the public static `Result.Failure` overload that is a generic method definition with a single `IEnumerable<Error>` parameter (`:30-35`), closes it over the inner type with `MakeGenericMethod` (`:36`), then builds and compiles `Expression.Lambda<Func<IEnumerable<Error>, TResult>>(Expression.Call(failureMethod, errorsParam), errorsParam)` (`:38-40`). The overload filter is specific on purpose: matching on name alone would be ambiguous across `Result.Failure`'s overload set.
  - Guard (`ResultFailureFactory.cs:43-45`): any other `TResult` throws `InvalidOperationException` naming the unsupported type and the two it does support.
- **Why it's built this way**: compiling the expression once per closed type keeps the short-circuit path reflection-free after the first build, and centralizing the one piece of generic reflection keeps the three decorators that need it readable.
- **Where it's used**: called lazily through a `CreateFailure()` helper by [FeatureGateCommandDecorator<TCommand, TResult>](#featuregatecommanddecoratortcommand-tresult) (`FeatureGateCommandDecorator.cs:43`), [FeatureGateQueryDecorator<TQuery, TResult>](#featuregatequerydecoratortquery-tresult) (`FeatureGateQueryDecorator.cs:43`), and [ValidatingCommandDecorator<TCommand, TResult>](#validatingcommanddecoratortcommand-tresult) (`ValidatingCommandDecorator.cs:52`).
- **Caveats / not-in-source**: the guard throw is the reason all three callers build lazily rather than in a static initializer. A handler whose `TResult` is neither `Result` nor `Result<T>` is legal against [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult), and an eager build would turn that into a `TypeInitializationException` at DI resolve time (`FeatureGateCommandDecorator.cs:27-35`).

---

### CachingCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingCommandDecorator.cs:32` · Level 4 · class (sealed, partial)

- **What it is**: the caching decorator on the command side. It caches nothing; it **invalidates** cached read data after a successful mutation, and only when the command opts in via [ICacheInvalidating](#icacheinvalidating) with a non-blank prefix. It evicts twice: once immediately, once after a short delay.
- **Depends on**: [ICacheInvalidating](#icacheinvalidating) (the opt-in marker exposing `CachePrefix`); [ICacheService](group-09-caching.md#icacheservice) (the eviction mechanism); [ITenantContext](#itenantcontext) (optional, defaulted to `null`) and [TenantCacheKey](#tenantcachekey) (prefix scoping); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); [Result](group-01-result-error-handling.md#result) (pattern-matched to detect failure); `Microsoft.Extensions.Logging`.
- **Concept introduced, invalidate on success only, and best-effort at that.** `[Rubric §12, Performance & Scalability]` assesses whether write-side invalidation keeps read caches coherent without over-evicting; `[Rubric §29, Resilience & Business Continuity]` assesses what a dependency outage does to a request. Three invariants are stated in the class doc and enforced in code. (1) Eviction fires only when the command implements [ICacheInvalidating](#icacheinvalidating) **and** returned a non-failure result (`CachingCommandDecorator.cs:12-15`): a business failure now rolls the transaction back (see [TransactionalCommandDecorator<TCommand, TResult>](#transactionalcommanddecoratortcommand-tresult)), so evicting valid entries on failure would cost concurrent readers a needless miss for nothing. (2) Invalidation is non-cancellable and never propagates a fault (`CachingCommandDecorator.cs:16-22`): the command has already committed by the time this runs, so a cache outage must not turn a committed command into a failure. (3) Under multi-tenancy the prefix is scoped with the same transformation the query decorator applies to its keys (`CachingCommandDecorator.cs:23-28`), which is the property that makes eviction hit exactly the entries this tenant's queries wrote.
- **Walkthrough**
  - Primary constructor (`CachingCommandDecorator.cs:32-36`): inner handler, [ICacheService](group-09-caching.md#icacheservice), a typed logger, and `ITenantContext? tenantContext = null`. The optional tenant parameter is what keeps the type resolvable in a host that never registered tenancy.
  - Secondary constructor (`CachingCommandDecorator.cs:49-52`): a two-argument overload that forwards a `NullLogger`. Its doc (`:38-48`) is explicit that it exists only for source compatibility with consumers that construct the decorator directly (tests pinned to a released package version), and that DI never selects it because container resolution prefers the logger-bearing constructor.
  - `ReInvalidationDelay` (`CachingCommandDecorator.cs:60`): `internal TimeSpan`, default `TimeSpan.FromSeconds(5)`, settable so a test does not have to wait out the production delay (`:54-59`).
  - `InvalidationFollowUp` (`CachingCommandDecorator.cs:66`): `internal Task`, initialized to `Task.CompletedTask`, holding the most recent delayed eviction. It is exposed so the fire-and-forget task is observed rather than dropped, and so a test can await it deterministically (`:62-65`).
  - `HandleAsync` (`CachingCommandDecorator.cs:69`): awaits `inner.HandleAsync(...)` **first** (`:71`), so the mutation always runs before any cache decision.
  - Guard (`CachingCommandDecorator.cs:76-78`): three conditions, `command is ICacheInvalidating cacheInvalidating`, `!string.IsNullOrWhiteSpace(cacheInvalidating.CachePrefix)`, and `!IsFailure(result)`. The blank-prefix test is load-bearing and the comment says why (`:73-75`): `RemoveByPrefixAsync("")` would evict the entire cache, so an empty prefix is both an opt-out and a foot-gun guard.
  - Scoping (`CachingCommandDecorator.cs:82`): `TenantCacheKey.Scope(tenantContext, cacheInvalidating.CachePrefix)`.
  - First eviction (`CachingCommandDecorator.cs:88-89`): `RemoveByPrefixAsync(cachePrefix, CancellationToken.None)`. Passing `None` rather than the request token is deliberate (`:86-87`): the cleanup must outlive a caller that has already walked away.
  - Delayed re-eviction (`CachingCommandDecorator.cs:96`, implemented at `:113-126`): `ReInvalidateAfterDelayAsync` waits `ReInvalidationDelay` then evicts the same prefix again. The comment (`:91-95`) names the race it closes: a read that missed the cache *before* this command committed can still be running its handler against pre-write state and populate the entry *after* the first eviction, so a single eviction can leave a stale entry behind.
  - Fault handling (`CachingCommandDecorator.cs:98-103` and `:120-125`): both evictions catch `Exception` (with an explicit `CA1031` suppression and a justification comment) and log `LogCacheInvalidationFailed` at `Warning` (`:128-135`), whose message ends with the operational consequence: stale entries expire on their own TTL.
  - `IsFailure` (`CachingCommandDecorator.cs:141-142`): `result is Shared.Abstractions.Result { IsFailure: true }`, pattern matching because `TResult` is not constrained to a `Result` type, so one test covers both `Result` and `Result<T>`.
- **Why it's built this way**: the command names *what* to evict (its `CachePrefix`); the decorator plus [ICacheService](group-09-caching.md#icacheservice) own *how* and *when*. Handlers stay free of cache-infrastructure knowledge, and the pipeline position (outside the transaction, per [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)) is what makes "after a committed mutation" true rather than aspirational.
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:96`) around every command handler; it engages only for commands whose `TCommand` implements [ICacheInvalidating](#icacheinvalidating), which is broadly adopted across ADC and Store write commands.
- **Caveats / not-in-source**: the delayed re-eviction narrows the repopulate window but does not close it. A read whose handler runs longer than `ReInvalidationDelay` (5s) can still repopulate a stale entry after the second eviction; the code's own answer to that residue is the entry's TTL (`CachingCommandDecorator.cs:20-21`).

---

### CachingQueryDecorator<TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:34` · Level 4 · class (sealed, partial)

- **What it is**: the read-caching decorator. On a cache hit it returns the stored result without touching the inner handler; on a miss it runs the handler once (under a per-key lock) and caches the non-failure result. It engages only for queries that opt in via [IQueryCacheable](#iquerycacheable), and it never lets a cache fault fail a query.
- **Depends on**: [IQueryCacheable](#iquerycacheable) (exposes `CacheKey` + `CacheDuration`); [ICacheService](group-09-caching.md#icacheservice); [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult); [QueryCacheKeyLocks](#querycachekeylocks) (the shared stripe table); [TenantCacheKey](#tenantcachekey) and [ITenantContext](#itenantcontext) (optional); [CqrsMetrics](#cqrsmetrics); [Result](group-01-result-error-handling.md#result); `Microsoft.Extensions.Logging`.
- **Concept introduced, stampede protection by per-key double-check locking, and a fail-open cache.** `[Rubric §12, Performance & Scalability]` assesses read-side caching and, critically, what happens when a hot key expires under load: a naive cache lets every concurrent request miss and all run the expensive query at once. `[Rubric §29, Resilience & Business Continuity]` assesses degradation under a dependency outage. The class doc states the fail-open principle plainly (`CachingQueryDecorator.cs:15-23`): the cache is an optimization, never the system of record, so a cache outage must degrade the application to uncached reads rather than turn every cacheable query into a 500. Both the read and the populate log at `Warning` and swallow the fault, and `OperationCanceledException` is deliberately excluded from the guard so a genuinely cancelled request still surfaces exactly as the inner handler would.
- **Walkthrough**
  - Constructors (`CachingQueryDecorator.cs:34-54`): the primary takes the inner handler, `ICacheService`, a typed logger, and `ITenantContext? tenantContext = null`; a two-argument secondary overload forwards a `NullLogger` and exists only for source compatibility with consumers that construct the decorator directly (`:40-48`), never selected by DI.
  - `EffectiveKey` (`CachingQueryDecorator.cs:63-64`): `TenantCacheKey.Scope(tenantContext, cacheable.CacheKey)`. With no tenant resolved the key is byte-identical to the query's own.
  - Opt-out (`CachingQueryDecorator.cs:69-70`): `query is not IQueryCacheable` short-circuits straight to the inner handler, so non-cacheable queries pay one type test.
  - One key for three operations (`CachingQueryDecorator.cs:74-76`): the comment states the invariant, read, stampede lock, and populate must all use the same tenant-scoped key, or one tenant would wait on another's lock and read another's entry.
  - Fast path (`CachingQueryDecorator.cs:79-84`): a lock-free `TryReadAsync`; a non-null hit records `CqrsMetrics.RecordCacheHit(queryName)` and returns with no lock taken.
  - Slow path (`CachingQueryDecorator.cs:89`): `using (await QueryCacheKeyLocks.Locks.AcquireAsync(cacheKey, cancellationToken))` waits on the stripe the key hashes to and releases it when the `using` block exits, so only one request per stripe proceeds.
  - Double-check (`CachingQueryDecorator.cs:91-96`): inside the lock it re-reads; a waiter that arrived while the leader populated records a hit and returns the fresh entry without re-running the query.
  - Miss accounting (`CachingQueryDecorator.cs:104`): `RecordCacheMiss` is called at exactly one point, and the comment (`:98-103`) explains why that point: a request that misses the fast path, takes the lock and misses the double-check has read the cache twice but executed once, so counting at the reads would double-count it. A read that *failed* also lands here and counts as a miss, which is correct because the query went uncached either way.
  - Populate (`CachingQueryDecorator.cs:106-123`): the leader runs `inner.HandleAsync(...)`, then stores via `SetAsync(cacheKey, result, cacheable.CacheDuration, cancellationToken)` **only** when the result is not `Result { IsFailure: true }` (`:109`), so failures are never cached. The `SetAsync` is wrapped in `try`/`catch (Exception ex) when (ex is not OperationCanceledException)` and a failure logs `LogCachePopulateFailed` (`:121`, message at `:129-136`) while still returning the handler's answer.
  - `TryReadAsync` (`CachingQueryDecorator.cs:155-170`): the fail-open read. A cache fault logs `LogCacheReadFailed` (`:138-145`) and returns `default`, which the caller treats as a miss; cancellation is again excluded from the catch filter (`:165`).
- **Why it's built this way**: per-query `CacheKey` and `CacheDuration` owned by the query, plus stampede-safe locking and fail-open cache calls, gives a correct application-layer read cache that cannot become a new single point of failure. Keeping the stripe table in the non-generic [QueryCacheKeyLocks](#querycachekeylocks) is what lets all closed decorators share one lock per key.
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:101`) as the **innermost** query decorator, directly around the concrete handler. In the two production apps it engages for exactly one query: ADC's `GetNowNextQuery` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:23`), described there as a hot, public, non-user-specific read. A search of `MMCA.Store/Source` finds no [IQueryCacheable](#iquerycacheable) implementor at all, so for Store this decorator is a pass-through today; the framework's own `ExportUserDataHandlerBase` and the sample apps (Helpdesk `GetTicketByIdQuery`, ECommerce `GetProductByIdQuery` / `GetOrderByIdQuery`) are the other adopters. Production read caching is otherwise done at the HTTP edge with output caching (the two-tier model of [ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html)).
- **Caveats / not-in-source**: the same file also declares the [QueryCacheKeyLocks](#querycachekeylocks) holder below the class (`CachingQueryDecorator.cs:194`), documented as its own type in this group. Note also that the stampede lock protects one process only; see the caveat under [QueryCacheKeyLocks](#querycachekeylocks).

---

### FeatureGateCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs:18` · Level 4 · class (sealed)

- **What it is**: the outermost standard command decorator. When a command implements [IFeatureGated](#ifeaturegated) and its feature flag is off, it short-circuits with a `NotFound` failure before any logging, caching, validation, or transaction work happens.
- **Depends on**: [IFeatureGated](#ifeaturegated) (the opt-in marker exposing `FeatureName`); [Error](group-01-result-error-handling.md#error) / [ErrorType](group-01-result-error-handling.md#errortype); [ResultFailureFactory](#resultfailurefactory); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); `Microsoft.FeatureManagement.IFeatureManager` (NuGet, `FeatureGateCommandDecorator.cs:1`, `:20`).
- **Concept introduced, feature-flag gating as a pipeline stage.** `[Rubric §10, Cross-Cutting Concerns]` assesses centralized feature-flag enforcement rather than a flag check duplicated in every handler. Registered last among the command decorators (`DependencyInjection.cs:98`) and therefore applied outermost, a disabled feature is rejected first, so no downstream work happens (the class doc says exactly this, `FeatureGateCommandDecorator.cs:11-14`). Commands that do not implement [IFeatureGated](#ifeaturegated) pass through on a single type test.
- **Walkthrough**
  - `_createFailure` (`FeatureGateCommandDecorator.cs:36`): a nullable `static Func<IEnumerable<Error>, TResult>?`, one per closed generic type.
  - `CreateFailure()` (`FeatureGateCommandDecorator.cs:42-43`): `_createFailure ??= ResultFailureFactory.Build<TResult>()`, built **on the first short-circuit**, not eagerly. The remarks (`:27-35`) record the bug that forced this: an eager static initializer turned an unsupported `TResult` into a `TypeInitializationException` at **resolve** time (Scrutor's `TryDecorate` is unconditional) for a handler that never short-circuits at all. A benign duplicate build under a race produces an equivalent delegate, so no lock is needed, and the happy path never touches the field.
  - `HandleAsync` (`FeatureGateCommandDecorator.cs:46`): `command is not IFeatureGated` passes straight through (`:48-49`); otherwise `await featureManager.IsEnabledAsync(featureGated.FeatureName)` (`:51`, async so a remote or config-backed flag store works). Enabled runs the inner handler (`:52`); disabled returns `createFailure([Error.NotFoundError("Feature.Disabled", $"Feature '{...}' is not currently available.")])` (`:54-57`).
- **Why it's built this way**: putting the gate in a decorator means handlers never inject `IFeatureManager`; a command opts in simply by implementing [IFeatureGated](#ifeaturegated). Returning `NotFound` rather than `Forbidden` tells the client the operation "does not currently exist" instead of leaking that it exists but is withheld.
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:98`) as the outermost decorator on every command handler; it engages only for commands implementing [IFeatureGated](#ifeaturegated).

---

### FeatureGateQueryDecorator<TQuery, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/FeatureGateQueryDecorator.cs:18` · Level 4 · class (sealed)

- **What it is**: the query-side twin of [FeatureGateCommandDecorator<TCommand, TResult>](#featuregatecommanddecoratortcommand-tresult): the outermost standard query decorator, rejecting a gated query with a `NotFound` failure when its feature flag is off.
- **Depends on**: [IFeatureGated](#ifeaturegated); [Error](group-01-result-error-handling.md#error) / [ErrorType](group-01-result-error-handling.md#errortype); [ResultFailureFactory](#resultfailurefactory); [IQueryHandler<in TQuery, TResult>](#iqueryhandlerin-tquery-tresult); `Microsoft.FeatureManagement`.
- **Concept reinforced**: an identical pattern to [FeatureGateCommandDecorator<TCommand, TResult>](#featuregatecommanddecoratortcommand-tresult), including the same lazy-build remarks. `[Rubric §10, Cross-Cutting Concerns]`. The class doc (`FeatureGateQueryDecorator.cs:11-14`) says "before logging or caching work": queries have no validation or transaction stage, so the list of things it front-runs is shorter than the command side's.
- **Walkthrough**: `_createFailure` (`FeatureGateQueryDecorator.cs:36`) plus `CreateFailure()` (`:42-43`) build the failure delegate on first short-circuit for the reason given at `:27-35`. `HandleAsync` (`:46`) type-tests [IFeatureGated](#ifeaturegated) (`:48-49`), calls `IsEnabledAsync` (`:51`), and returns the same `Error.NotFoundError("Feature.Disabled", ...)` failure when disabled (`:54-57`).
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:103`) as the outermost decorator on every query handler.

---

### ValidatingCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:24` · Level 4 · class (sealed, partial)

- **What it is**: the decorator that runs FluentValidation against a command before the handler executes, turning validation failures into a [Result](group-01-result-error-handling.md#result) failure so the handler is never called with invalid input. It sits between Caching (outer) and Transactional (inner).
- **Depends on**: `FluentValidation.IValidator<TCommand>` (NuGet, injected as `IEnumerable<IValidator<TCommand>>` from DI, `ValidatingCommandDecorator.cs:26`); [Error](group-01-result-error-handling.md#error); [ResultFailureFactory](#resultfailurefactory); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult); the `ToErrors` extension from `MMCA.Common.Application.Extensions` (`:3`, `:68`); `Microsoft.Extensions.Logging`.
- **Concept introduced, automatic validation as a pipeline stage.** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether server-side validation is applied consistently rather than hand-called per handler; `[Rubric §1, SOLID]` (SRP) assesses that validation is this decorator's single job and not the handler's. Placing it before [TransactionalCommandDecorator<TCommand, TResult>](#transactionalcommanddecoratortcommand-tresult) (stated in the class doc, `ValidatingCommandDecorator.cs:16-20`) means an invalid command never opens a database transaction. Commands with no registered validator pass straight through, so validation is present-when-registered rather than a hard requirement.
- **Walkthrough**
  - `_validator` (`ValidatingCommandDecorator.cs:29`): `validators.FirstOrDefault()`, the first registered `IValidator<TCommand>` or `null`, resolved once at construction. Injecting the enumerable rather than the validator itself is what lets a command have none without a DI resolution failure.
  - `_createFailure` / `CreateFailure()` (`ValidatingCommandDecorator.cs:45`, `:51-52`): the same lazily-built [ResultFailureFactory](#resultfailurefactory) delegate, with the same remarks about the eager-initializer bug it avoids (`:36-44`).
  - `HandleAsync` (`ValidatingCommandDecorator.cs:55`): a null `_validator` passes through (`:57-60`); otherwise `await _validator.ValidateAsync(command, cancellationToken)` (`:62`), and a valid result passes through (`:63-66`).
  - Failure (`ValidatingCommandDecorator.cs:68-72`): `validationResult.ToErrors(typeof(TCommand).Name).ToList()` converts FluentValidation failures into an [Error](group-01-result-error-handling.md#error) list, logs it, and returns `createFailure(errors)`. The whole command's errors are returned at once, not the first one.
  - Logging (`ValidatingCommandDecorator.cs:75-84`): `partial` plus `[LoggerMessage]` generates the low-allocation `LogValidationFailure(logger, commandName, errorCount)` at `Debug`, with a small private instance overload (`:83-84`) that supplies the logger and the command name so the call site stays one argument.
- **Why it's built this way**: it removes the "inject `IValidator<T>` and call `ValidateAsync` by hand" boilerplate from every handler; short-circuiting before the transaction stage spares the database work on invalid input; and failing to a `Result` rather than throwing keeps validation on the same error channel as domain rules.
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:95`). Every command with a matching `IValidator<TCommand>` in DI is validated here, including the auto-wired [CommandRequestValidator<TCommand, TRequest>](group-06-validation.md#commandrequestvalidatortcommand-trequest) that `ScanModuleApplicationServices` registers for commands implementing [ICommandWithRequest<out TRequest>](#icommandwithrequestout-trequest).
- **Caveats / not-in-source**: only the **first** registered validator runs (`ValidatingCommandDecorator.cs:29`). Two `IValidator<TCommand>` registrations for the same command silently means the second never executes.

---

### TransactionalCommandDecorator<TCommand, TResult>
> MMCA.Common.Application · `MMCA.Common.Application.UseCases.Decorators` · `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:18` · Level 8 · class (sealed)

- **What it is**: the innermost standard command decorator, closest to the concrete handler. It wraps the handler in a database transaction only when the command opts in via [ITransactional](#itransactional); every other command passes straight through.
- **Depends on**: [ITransactional](#itransactional) (the opt-in marker); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (supplies `ExecuteInTransactionAsync`, `TransactionalCommandDecorator.cs:1`, `:20`); [ICommandHandler<in TCommand, TResult>](#icommandhandlerin-tcommand-tresult).
- **Concept introduced, declarative transaction boundaries via a marker.** `[Rubric §2, Design Patterns]` assesses the deliberate use of the Decorator pattern; `[Rubric §10, Cross-Cutting Concerns]` assesses handling transactions once rather than per handler; `[Rubric §8, Data Architecture]` assesses deliberate transaction boundaries. The mechanism is tiny (a decorator that *is* an `ICommandHandler` holding an inner `ICommandHandler`), and almost all of the behavior lives one layer down in [DbContextFactory](group-07-persistence-ef-core.md#dbcontextfactory). Because it is registered first (`DependencyInjection.cs:94`) it is applied innermost, so the transaction opens closest to the handler and **inside** cache invalidation, which is what makes "invalidate after a committed mutation" true.
- **Walkthrough**
  - `HandleAsync` (`TransactionalCommandDecorator.cs:23`): `if (command is not ITransactional) return await inner.HandleAsync(...)` (`:26-27`), so most commands skip the transaction machinery entirely on one type test.
  - Transactional path (`TransactionalCommandDecorator.cs:29-31`): `unitOfWork.ExecuteInTransactionAsync(ct => inner.HandleAsync(command, ct), cancellationToken)`, passing the handler call as a delegate so the factory owns begin, commit, and rollback.
- **Why it's built this way**: opt-in via a marker means only handlers that mutate multiple aggregates (or write an aggregate plus outbox rows across steps) pay for a transaction, and the boundary is declared on the command, a domain-adjacent type, rather than buried in handler code. Because transactions are per physical data source with no two-phase commit, cross-source consistency is the outbox's job, not this decorator's ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The composition itself (a Scrutor decorator chain over thin handlers, with a load-bearing order) is [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).
- **Where it's used**: registered by `AddApplicationDecorators()` (`DependencyInjection.cs:94`) as the innermost command decorator. In the two production apps the marker is adopted narrowly: ADC has three commands (`LinkUserToSpeakerCommand`, `UnlinkUserFromSpeakerCommand`, `RefreshFromSessionizeCommand`), and Store's include `CheckOutCommand`, `VerifyPaymentCommand`, `ProcessPaymentWebhookCommand`, `BulkSetInventoryCommand`, `UploadProductImageCommand`, and `ReorderProductImagesCommand`.
- **Caveats / not-in-source**: three behaviors a reader will attribute to this file actually live in [DbContextFactory](group-07-persistence-ef-core.md#dbcontextfactory), and the class doc here (`TransactionalCommandDecorator.cs:9-14`, which mentions only exceptions) is narrower than what the code does. (1) A returned **failed** `Result` rolls the transaction back exactly like an exception (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:562-569`, rationale at `:466-470`): atomicity over partial persistence, the 2026-07-19 revision of ADR-014. (2) The call is **re-entrant**: a nested `ExecuteInTransactionAsync` joins the ambient transaction instead of opening a second one, so an `ITransactional` command whose handler also opens a transaction no longer throws (`DbContextFactory.cs:505-513`, `:461-465`). (3) A failure of the **commit** itself is never retried and surfaces as [TransactionCommitAmbiguousException](group-07-persistence-ef-core.md#transactioncommitambiguousexception) (`DbContextFactory.cs:539-540`, `:484-491`). In-process domain event dispatch is also deferred until after a successful commit and dropped on rollback (`DbContextFactory.cs:471-476`).


---
[⬅ Domain & Integration Events + Outbox Dual-Dispatch](group-04-events-outbox.md)  •  [Index](00-index.md)  •  [Validation ➡](group-06-validation.md)
