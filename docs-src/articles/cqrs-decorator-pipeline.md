# The CQRS decorator pipeline: logging, caching, and transactions without touching a handler

> Series: MMCA.Common · Article #7 (deep-dive) · Pillar P2 · Group G05 · Rubric §1,§6,§10 ·
> ADR-014, ADR-079 · Status: grounded in `Website/docs-src/adr/014-cqrs-decorator-pipeline.md`,
> `Website/docs-src/adr/079-shared-http-middleware-pipeline.md`, `MMCA.Common/AGENTS.md`
> (the "CQRS Decorator Pipeline" and "DI Registration Sequence" sections), and
> `Website/docs-src/onboarding/group-05-cqrs-pipeline.md`. No em dashes.

**Subtitle:** Cross-cutting concerns belong around a handler, not inside it. Here is a Scrutor-composed
decorator pipeline where logging, caching, and transactions wrap every command and query, and a handler
stays a single method of business logic.

---

Open a command handler in a typical .NET service and count how much of it is the actual use case.

You will find a transaction scope. A log line at the start and a stopwatch at the end. A cache eviction
call after the save. Maybe a feature-flag check up top. Somewhere in the middle, four lines that are the
thing the handler is actually for. The cross-cutting concerns outnumber the business logic, they are
copy-pasted into every handler with subtle drift, and the order they run in is whatever order someone
typed them.

That is the problem the CQRS decorator pipeline solves. A handler holds only its use-case logic. Logging,
caching, validation, and transactions live in decorators that wrap the handler uniformly, in a known
order, and the handler never knows they are there.

## Why it matters

The scattered approach fails in two specific ways.

First, **drift**. When the transaction boilerplate lives in every handler, one handler eventually forgets
it, or wraps the wrong span, or commits before it should. There is no single place to read "how do we do
transactions here," so the answer is "differently in each file."

Second, **implicit ordering**. The order in which cross-cutting concerns run is load-bearing, and when it
is emergent from hand-written code nobody can see it. Should validation run before or after the
transaction opens? Should cache invalidation happen inside the transaction or after the commit? These are
correctness questions, and scattered code answers them by accident.

The decorator pipeline makes both problems go away: each concern is written once, and the order is
declared in one place on purpose.

## The shape: thin handlers, fat pipeline

Every write and every read in MMCA.Common is a use case behind one of two interfaces:

```csharp
public interface ICommandHandler<in TCommand, TResult>
{
    Task<TResult> HandleAsync(TCommand command, CancellationToken cancellationToken = default);
}

public interface IQueryHandler<in TQuery, TResult>
{
    Task<TResult> HandleAsync(TQuery query, CancellationToken cancellationToken = default);
}
```

One method each. `TResult` is almost always a `Result` or `Result<T>` (the railway error type from
ADR-013): a handler returns a failure value, it does not throw for expected error paths. Commands mutate
state, queries are side-effect-free reads, and splitting them into two interfaces is what lets the
container apply a *different* set of concerns to each. Writes get transactions and validation, reads get
result caching.

A decorator implements the *same* interface, takes the next handler in via its constructor, does its one
cross-cutting job, and delegates. Because each decorator is itself an `ICommandHandler` or
`IQueryHandler`, they nest arbitrarily, and the concrete handler at the bottom never knows it is wrapped.
That is the textbook Decorator pattern applied to the application boundary.

## How the pipeline is assembled, and why order is the whole game

The wiring uses [Scrutor](https://github.com/khellang/Scrutor)'s `TryDecorate`, and there is one rule you
have to internalize: **`TryDecorate` applies decorators in reverse registration order. The last one
registered becomes the outermost wrapper.**

So reading the registrations top to bottom lists innermost first. The resulting execution order for
commands, outermost to innermost, is eight decorators deep:

```
ViewAs -> FeatureGate -> Authorization -> Logging -> Caching ->
Validating -> Timeout -> Transactional -> Concrete Handler
```

And for queries, two decorators shorter: everything the command chain carries except the view-as guard
and the transaction.

```
FeatureGate -> Authorization -> Logging -> Caching ->
Validating -> Timeout -> Concrete Handler
```

(The framework also ships an optional pair of MiniProfiler decorators, `ProfilingCommandDecorator` and
`ProfilingQueryDecorator`, registered only by a separate opt-in `AddApplicationProfiling()` call; called
after `AddApplicationDecorators()`, they wrap both chains from the outside. The composed service host
`AddMmcaServiceHost` makes that call, with the profiler's services and middleware, only when
`ApplicationSettings:UseMiniProfiler` is true, which it is not by default.)

Each position is a deliberate cost-and-correctness argument:

- **The view-as guard is outermost on commands, and exists only there.** A staff user viewing the app as
  another user (ADR-137) can read but never write in that user's name, so while the caller holds a
  view-as token every command is refused with `Error.Forbidden("Auth.ViewAsReadOnly", ...)` before any
  feature-flag lookup, permission check, log scope, validation, or transaction. The HTTP edge already
  refuses unsafe methods for such a caller; this is the second layer, the one that also covers a command
  sent from a GET handler or a hub method. An ordinary caller pays one claim lookup and passes straight
  through. Queries carry no such guard, because reading is exactly what a view-as session is for.
- **Feature-gating is outermost on queries, and directly inside the view-as guard on commands,** so a
  disabled feature is rejected with zero downstream work: no
  permission lookup, no log scope, no cache touch, no validation, no transaction. It short-circuits with
  a `NotFound` failure when the flag is off. It also sits outside the permission check on purpose: a
  feature that is off must answer the same way for every caller rather than leaking which permission
  guards it.
- **Authorization sits directly inside the gate** and outside caching. Both decorators delegate to one
  shared `AuthorizationGate.Evaluate(...)` helper that answers with a denial `Error` or with `null`, and
  it applies two checks in order. First the capability check: a request declaring `IRequiresPermission`
  is granted when the permission registry grants one of the caller's roles, or when the principal
  carries a matching permission claim, and is otherwise denied with
  `Error.Forbidden("Authorization.PermissionDenied", ...)` without invoking the handler. Second the
  step-up check: a request marked `IRequiresMfa` is denied with
  `Error.Forbidden("Authorization.MultiFactorRequired", ...)` unless the principal presented a second
  factor, and absence denies, because there is no "this account has no second factor, let it through"
  branch. Capability first is deliberate, so a caller who does not hold the capability at all is
  answered by the capability gate and never learns which use cases additionally demand a step-up. The
  placement in the chain is the whole point: a cache lookup ahead of the permission check would serve
  another caller's rows to a principal not allowed to run the query, and a denied command never starts
  a transaction or runs validation either.
- **Logging sits inside the gate and the permission check** so it measures only *enabled, authorized*
  executions. It opens a structured log scope carrying the correlation id, times the whole inner pipeline
  with `Stopwatch.GetTimestamp()` (a timestamp rather than a `Stopwatch` instance, one fewer allocation
  per command), distinguishes success from business-failure from exception, and records the duration to
  an OpenTelemetry histogram on every path: `completed`, `failed`, and `exception`.
- **Caching sits outside validation** so the cache is only touched after a valid, committed mutation. A
  validation failure or a rollback leaves the cache intact.
- **Validation sits outside the transaction** so a malformed command never opens a database transaction.
  The validating decorator takes every registered `IValidator<TCommand>`, runs them one after another
  (sequentially on purpose, since a validator may reach the database through a scoped repository and a
  `DbContext` is not thread-safe), and, when any of them fails, returns one `Result` failure carrying the
  union of their errors, each tagged `ErrorType.Validation` (which the API edge maps to HTTP 400),
  *without ever calling the handler*. Those validators are composed from reusable rule fragments rather than copy-pasted
  per command, a validation kit that gets its own deep-dive later in the series. On the query side the
  same concern sits one layer deeper, *inside* caching, for a deliberate reason: a cached entry can only
  exist because the same query already passed validation when that entry was produced, so re-validating
  on a cache hit spends work to reach a conclusion already reached.
- **The timeout budget sits inside validation and outside the transaction**, so it covers the database
  work that actually hangs, never charges the caller for validation time, and cancels the transaction
  instead of leaving it open. On the query side it is innermost, so a cache hit is served without
  starting a budget at all.
- **Transaction is innermost**, closest to the handler, so the unit-of-work boundary is as tight as
  possible.

Place a decorator at the wrong depth and you silently change semantics: validate *inside* the transaction
and you open a database transaction for a request you were going to reject anyway. Cache *outside* the
permission check and you hand one caller's rows to another. That is exactly why the order is hard-coded
and documented inline at the registration site, not config-driven, and why the registration method
carries a text nesting diagram of both chains in its own doc comment.

## Transactional behavior, in detail

The transactional decorator wraps the handler in `IUnitOfWork.ExecuteInTransactionAsync` **only when the
command implements `ITransactional`**. Three outcomes, three behaviors:

- **An exception from the handler rolls back.** The transaction unwinds, nothing is persisted.
- **A business failure (`Result.IsFailure`, no exception) also rolls back.** This is the subtle one. A
  failed `Result` means the handler decided "no" through a value rather than an exception, and the unit of
  work treats that decision exactly like a thrown fault:
  `if (result is Result { IsFailure: true }) { RollbackTransaction(); return (result, null); }`. Atomicity wins
  over partial persistence, so any writes the handler made before returning the failure are discarded, and
  the deferred domain events roll back with them. Cache invalidation is skipped as well, because nothing
  committed and there is nothing stale to evict.
- **A success commits and then invalidates the cache.** Only a success reaches `CommitTransaction()`,
  and only after one pre-commit check: internal-command rows the handler enrolled are saved inside the
  transaction, but any other tracked change it left unsaved throws an `InvalidOperationException`
  and the whole unit rolls back, because committing would silently discard that change while
  reporting success. A nested transactional call joins the outer transaction and leaves the commit to
  the outermost call. In-process domain events are flushed *after* the commit, so a handler never acts on state that could
  still roll back, and cache eviction runs *outside* the transaction boundary against committed state.
  The one failure this cannot classify is the commit itself: the database may have applied the
  transaction and lost only the acknowledgement, so a failed commit is never retried or treated as a
  rollback. It surfaces as a `TransactionCommitAmbiguousException`, its writes possibly durable, and
  the caller owns recovery.

That "a business failure rolls back like an exception" rule is the kind of decision that, in scattered
code, would be implemented three different ways in three handlers. Here it is one place, one behavior,
every command.

## Opt in by marker interface: pay only for what you use

The pipeline is registered for *every* handler, but most decorators are dormant unless the use case asks
for them, through a set of tiny marker interfaces:

```csharp
// Open a DB transaction around this command.
public sealed record PlaceOrderCommand(...) : ITransactional;

// Evict cached reads under "Catalog:Products" after this command succeeds.
public sealed record UpdateProductCommand(...) : ICacheInvalidating
{
    public string CachePrefix => "Catalog:Products";
}

// Read-through cache this query under a stable key.
public sealed record GetProductQuery(...) : IQueryCacheable
{
    public string CacheKey => $"Catalog:Products:{ProductId}";
    public TimeSpan CacheDuration => TimeSpan.FromMinutes(5);
}

// Deny this command with a Forbidden failure unless the caller holds the permission.
public sealed record DeleteProductCommand(...) : IRequiresPermission
{
    public string Permission => "catalog.products.delete";
}

// Give this query its own execution budget.
public sealed record GetSalesReportQuery(...) : IHasTimeout
{
    public TimeSpan Timeout => TimeSpan.FromSeconds(10);
}
```

Each marker-driven decorator does an `is`-check (`command is ITransactional`, `command is
IRequiresPermission`, and so on) and passes straight through when the interface is absent. Three
decorators carry no marker: logging always runs, validation passes straight through when no
validator is registered for the request, and the view-as guard keys on the caller's token rather than
on the request. A read-only command pays nothing for
transactions. An un-cached query pays nothing for caching. A request that declares no permission is not
silently public, it just stays behind the endpoint's `[Authorize]` policy: the decorator is a defense in
depth layer that moves the capability check next to the use case, so a command reached through gRPC, a
scheduled job, or another module is checked the same way it is over HTTP. A timeout of `TimeSpan.Zero` or
less means "no budget" and passes the caller's token through untouched, because a misconfigured value must
not fail every request instantly. The *capability* is uniformly present for
every handler, but the *cost* is opt-in per handler. Leaving a marker off is a genuine decision too, not
just an oversight: a command whose writes already flush through a single atomic `SaveChangesAsync` gains
nothing from `ITransactional` except a wider lock window across whatever the handler runs first (a
cross-service price fetch, say), so it deliberately stays unmarked and lets optimistic concurrency guard
the read-then-write gap.

This is the Open/Closed Principle made literal. A new handler turns a concern on by implementing an
interface. There is no decorator to write, no registration to add, no pipeline to touch. The pipeline is
closed for modification and open for extension, and "extension" is one interface on a record.

## The DI sequence that makes it work

Because `TryDecorate` can only wrap registrations that already exist, the decorators must be registered
*after* every module's concrete handlers. One step of this sequence is load-bearing, and only one:

```csharp
services.AddApplication()                              // core services, event dispatcher
    .AddInfrastructure(configuration)
    .AddAPI(modulesSettings)
    .ScanModuleApplicationServices<ModuleAClassRef>()  // Module A handlers, validators, mappers
    .ScanModuleApplicationServices<ModuleBClassRef>()  // Module B handlers, validators, mappers
    .AddApplicationDecorators();                       // MUST be last: TryDecorate wraps existing handlers
```

ADR-014 is precise about the scope of the constraint: only the decorators-last ordering is
load-bearing, and the relative position of `AddInfrastructure` and `AddAPI` is not. Hosts are free to
arrange those two however they like.

`AddApplicationDecorators()` **must be last** among the application registrations. Call it before a
module's handler scan and `TryDecorate` finds nothing to wrap, so that module's handlers would run with
no logging, no caching, and no transactions.

Which is why the framework does not leave that to the host's memory. `AddApplicationDecorators()` seals
the pipeline on the service collection as its final act, and the registration methods that add
handlers in bulk (the module scan, the entity CRUD helpers) check the seal first and throw an
`InvalidOperationException` naming the caller: *"anything registered now would run completely
undecorated. Move this call before AddApplicationDecorators(), or compose the whole sequence with
AddMmcaApplicationPipeline(...)"*. The constraint is real either way; the difference is that violating
it stops the host at startup with the fix in the message, instead of booting a service that quietly
does less.

The suggestion in that message is the shorter road. `AddMmcaApplicationPipeline(configure)` composes the
whole sequence itself: it registers the application services, hands a builder to the delegate for the
module scans and anything else the host wants registered, and finishes with
`AddApplicationDecorators()`, so the ordering rule is executed by the framework rather than remembered
by the host:

```csharp
services.AddMmcaApplicationPipeline(pipeline => pipeline
    .ScanModule<TicketsClassReference>()
    .Register(s => moduleLoader.DiscoverAndRegister(
        s, configuration, appSettings, moduleSettings, environmentName, moduleAssemblies)));
```


## The same argument, one layer out: the HTTP pipeline

The decorator chain covers everything that happens once a command or query reaches a handler. But the
request had to cross an edge to get there, and that edge is an ordered chain too: ASP.NET Core
middleware. It has exactly the same failure mode. Put the rate limiter before authentication and it
partitions every request as anonymous. Put a tenant resolver before authentication and it reads an
empty principal. Redirect a gRPC call to HTTPS and the call breaks. Each of those compiles, passes
every analyzer, and reads as correct.

So the framework treats the edge the way it treats the decorators: one fixed order, written down
once, called by every host. `UseCommonMiddlewarePipeline()` is a single extension method over
`WebApplication` that registers the whole edge and finishes by mapping controllers:

```
exception handler -> correlation id -> request localization -> pre-forwarded capture ->
forwarded headers -> HTTPS redirect (skipped for cleartext HTTP/2) -> response compression ->
routing -> CORS -> authentication -> tenant resolution -> rate limiter ->
soft-deleted-user check -> view-as guard -> authorization -> output cache ->
JWKS + OIDC discovery -> controllers
```

The builder re-validates four of those orderings while it builds the step list, two of them strict
adjacencies, each with its reason carried in the exception it would throw. Three are load-bearing; the
fourth pins a step nothing reads:

- **The pre-forwarded capture immediately before forwarded headers.** The capture step stashes the real
  transport scheme and host before `UseForwardedHeaders` rewrites them from the `X-Forwarded-*` headers.
  Those captured values are only faithful if nothing rewrites the request in between, so the two steps
  have to be adjacent, not merely ordered. No reader of the captured values exists in the framework,
  though: the OIDC discovery document derives its `jwks_uri` from the configured `Jwt:Issuer`, not from
  the request. ADR-079 records the step as costing one delegate per request without being load-bearing,
  and the adjacency guards the capture's fidelity rather than a live consumer.
- **Forwarded headers before the HTTPS redirect.** The redirect decision has to see the proxy-reported
  scheme from `X-Forwarded-Proto` rather than the internal transport scheme.
- **Authentication immediately before tenant resolution.** The claim-first tenant strategy reads the
  request principal, which carries the token's claims only once authentication has run.
- **Authentication before the rate limiter.** The global partition keys on the authenticated
  principal and routes anonymous traffic down a no-limiter branch, so an unpopulated user makes every
  request look anonymous and the per-user cap never engages.

The gRPC exemption on the HTTPS redirect is a step predicate rather than an ordering rule, and it is keyed
on the protocol Kestrel negotiated, not on the request's content type. The step runs ahead of routing,
so no endpoint metadata exists yet; what does exist is the negotiated protocol, which no header can
fake. Cleartext HTTP/2 is exactly the gRPC-over-plaintext case that a 307 would break, and every
browser-reachable request is HTTP/1.1 or HTTP/2 over TLS, so it keeps being redirected instead of being
served plaintext on the strength of a forged header.

The pieces that only some hosts need are registered unconditionally too. Tenant resolution is
always in the chain and stays inert unless the host called `AddMultiTenancy` and set
`Tenancy:Enabled`. The view-as guard (ADR-137) is always present too: a request without a view-as
token passes on one claim lookup, a view-as request with any method other than GET, HEAD, or OPTIONS
is answered 403 (bar the end-view-as action and endpoints a host marks read-only), and while
`ViewAs:Enabled` is false every view-as request is answered 401. The soft-deleted-user check (which
sits after the limiter and ahead of the view-as guard and authorization, so a revoked account is
rejected before any endpoint gets to authorize it) has no setting at all: on every
host it answers an authenticated request with a 401 when the shared cache carries that user's
deleted marker, and only a host that registers an `ISoftDeletedUserValidator` (the one hosting
Identity) falls back to the database on a cache miss, while every other host passes the request
through. That keeps the edge literally one shape on every host rather than a per-host permutation, so
a diff between two hosts' pipelines is empty by construction. Every REST and gRPC service host in both
production applications calls the method, and so does the reference app.

The edge carries the same two defenses as the decorator chain it mirrors. First, **the order is
frozen by a test, not by review**. Every step is named and the defaults are seeded by a builder, so
the order is data: a conformance test base mirroring the decorator one asserts the step sequence in
the fast unit tier, and a reorder goes red before the semantics go quiet. Swapping two steps still
compiles and still passes every analyzer, but it no longer passes the test pass. Second, **the
extension point is scoped**. The method takes an optional configure delegate: a host can insert,
replace, or remove steps by name, and the builder re-validates the load-bearing orderings at
startup, so a customized edge fails while the host is starting instead of misordering silently. A
host whose edge is genuinely different still composes its own, which is what the Blazor UI hosts and
the YARP gateways do; the escape hatch comes in two sizes, not one.

## Trade-offs, honestly

The pipeline is not free, and ADR-014 names the rough edges:

- **Registration order is the reverse of execution order.** This is a genuine Scrutor foot-gun. The
  framework mitigates it with inline ordering comments at the registration site, but you do have to keep
  "last registered is outermost" in your head when reading the code.
- **Decorators must come after handlers.** That one step of the DI sequence is a constraint, not a
  suggestion, and the guard that turns violating it into a startup exception is itself extra machinery:
  a seal on the service collection that each handler-registering method has to check.
- **A new concern means a new decorator at the correct depth.** Inserting it at the wrong position can
  silently change semantics, as with validating inside the transaction. Adding to the pipeline requires
  understanding the ordering argument, not just appending a class. Authorization and
  timeout show why: both sit *between* other decorators, and placing either one wrong is a
  correctness bug rather than a style choice.
- **The chain is deep.** Every command walks eight decorators and every query six, even when it declares
  none of the markers, because each one is registered unconditionally and decides at runtime whether it
  has work to do. The pass-through cost of a dormant decorator is small, but it is not zero, and it grows every
  time a concern is added.

The response to the third one is the interesting part, because the order is defended by more than
comments and review. A reusable conformance test base resolves the
handlers from a real service collection, unwraps the constructed object graph by reflection, and asserts
both sequences outermost-first, including that the innermost element is not itself a decorator. Both
expected sequences are `protected virtual`, so a consumer whose chain differs can override them.
MMCA.Common subclasses it against its own registration sequence without overriding either list, so the
default order is pinned in the framework's own test pass. Move a `TryDecorate` line and the test goes
red before the semantics go quiet.

None of these are reasons to scatter the concerns back into the handlers. They are the reasons to keep
the ordering documented in one place, pinned by a test, and to treat the DI sequence as load-bearing.

## Apply this even without MMCA

The idea ports to any DI container that supports decoration (Scrutor for Microsoft.Extensions.DI,
or the equivalent in your stack):

1. Define a **single handler interface** per category (command, query) returning a result type, and keep
   handlers to one use case each.
2. Write each cross-cutting concern as a **decorator** over that interface, not as code inside handlers.
3. **Declare the order explicitly** in one place, and write down *why* each concern is at its depth
   (validation before the transaction, cache eviction after the commit).
4. Make decoration **opt-in by marker interface** so handlers pay only for the concerns they declare.

The takeaway is the argument ADR-014's Context makes, in one line: **if a concern is cross-cutting, it should wrap the
handler, not live inside it. The order it wraps in is a design decision you write down once, not an
accident you rediscover per file.**

---

**What we covered:** why cross-cutting concerns scattered into handlers drift and hide their ordering, how
the MMCA.Common pipeline wraps every command with `ViewAs -> FeatureGate -> Authorization -> Logging ->
Caching -> Validating -> Timeout -> Transactional` decorators in a deliberate order (and every query with
the same chain minus the view-as guard and the transaction), how `ITransactional` / `ICacheInvalidating` / `IQueryCacheable` /
`IRequiresPermission` / `IRequiresMfa` / `IHasTimeout` make each concern opt-in, why
`AddApplicationDecorators()` must be registered last and how sealing the pipeline turns forgetting that
into a startup exception, how a conformance test pins the order instead of leaving it to comments, and
how the same fixed-order argument runs one layer out at the HTTP edge through a single shared
middleware pipeline.

**Next in the series:** the reusable validation kit that plugs into this pipeline's Validating
decorator, composed from shared rule fragments instead of copy-pasted per command.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-014 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- ADR-014 (CQRS decorator pipeline): `Website/docs-src/adr/014-cqrs-decorator-pipeline.md` in the docs site.
- ADR-079 (shared HTTP middleware pipeline): `Website/docs-src/adr/079-shared-http-middleware-pipeline.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, CQRS, Design Patterns*

*Notes: 2026-11-25 refresh, re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`).
Anchors below were opened this run unless marked "carried" (last re-read 2026-10-29, not reopened this
run). `DependencyInjection.cs` is split into four partial files (main, `Crud`, `ModuleScanning`, `Extensibility`).
**2026-11-25 entry (MMCA.Common v1.319.0).** One behavior change reaches the body: the view-as guard (ADR-137).
(1) Command chain: `AddApplicationDecorators` (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:132-172`)
registers eight command decorators at `:152-159`, `ViewAsCommandDecorator` last at `:159` ("outermost: a view-as
caller is read-only (ADR-137)"), so "seven decorators deep" is eight, and the chain diagram, the trade-off count and the
closing summary gain `ViewAs`. Queries stay six (`:162-167`), so the query chain is "two decorators shorter". The doc
comment's command diagram (`:79-87`) and its feature-gate rationale item (`:105-109`, "Feature gating is outermost on
queries, and on commands sits directly inside the view-as guard") match; the feature-gate bullet is reworded to that.
`DecoratorPipelineOrderTestsBase` pins ViewAs first (summary `:14`, `ExpectedCommandDecorators` `:49`,
`"ViewAsCommandDecorator"` `:51`). (2) New bullet: `ViewAsCommandDecorator`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ViewAsCommandDecorator.cs:21`) passes through
unless `currentUser.User.IsViewAs()` (`:38-39`) and otherwise returns `Error.Forbidden("Auth.ViewAsReadOnly", ...)`
(`:42-44`); its summary (`:9-17`) states the second-layer role, the GET-handler and hub case and the one-claim-lookup
cost. (3) Marker sentence: "Two decorators carry no marker" is three, since the view-as guard keys on the caller (`:38`).
(4) HTTP edge: `MiddlewarePipelineBuilder.CreateDefault()`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:31-159`, 19 named steps)
carries `ViewAsGuard` at `:127` (comment `:128-132`) between `SoftDeletedUserFilter` `:123` and `Authorization` `:136`;
the diagram gains the step, and the soft-deleted sentence places it after the limiter and ahead of the view-as guard
and authorization. `ViewAsGuardMiddleware` (`MMCA.Common.API/Middleware/ViewAsGuardMiddleware.cs:42`, summary `:14-32`):
a request without the view-as claim passes (`:58-62`), `ViewAs:Enabled` false answers 401 (`:66-71`), an unsafe method
answers 403 unless it is the end-view-as action or a host-marked read-only endpoint (`:74-78`; safe methods GET, HEAD,
OPTIONS at `:107`), and a dead grant answers 401 (`:81-84`). `MiddlewarePipelineOrderTestsBase.ExpectedStepNames`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Conformance/MiddlewarePipelineOrderTestsBase.cs:40`) lists `ViewAsGuard`
at `:55`, between `SoftDeletedUserFilter` `:54` and `Authorization` `:56`, so the "frozen by a test" paragraph holds.
(5) The audit's UNVERIFIABLE marker claim is settled as accurate (see Markers); no body text changed for it.
**Decorator chain (re-read 2026-11-25).** Query registrations run from `TimeoutQueryDecorator` innermost `:162` to
`FeatureGateQueryDecorator` outermost `:167`; `SealPipeline(services)` `:169`. Rationale list `:103-128`: authorization
`:110-112`, query-side validation inside caching `:114-118`, cache invalidation `:119-120`, timeout `:121-124`,
business failure `:125-126`. Optional profiling: `AddApplicationProfiling()` `:179` registers `ProfilingCommandDecorator`
and `ProfilingQueryDecorator` at `:181-182` with no toggle. Order pinned by `DecoratorPipelineOrderTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Conformance/DecoratorPipelineOrderTestsBase.cs:38`), `protected virtual`
lists at `:49` (commands) and `:62` (queries). Carried: the framework subclass
(`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/Conformance/DecoratorPipelineOrderTests.cs:23`) overrides only
`ConfigureServices` (`:26`); `AddMmcaServiceHost` calls `AddApplicationProfiling()` only when
`ApplicationSettings:UseMiniProfiler` is true (also stated in `MMCA.Common/AGENTS.md`, CQRS section); ADR-014 states both
chains in its Revision (2026-08-26) from `:234`, the shared authorization gate from `:380` (`Evaluate` `:389`) and the
decorators-last scope at `:88-89`.
**Per-decorator behavior (re-read 2026-11-25).** `FeatureGateCommandDecorator` passes non-`IFeatureGated` commands
through (`:51`) and short-circuits with `Error.NotFoundError(...)` (`:61`); its summary places it inside
`ViewAsCommandDecorator` (`:14`). Both authorization decorators call `AuthorizationGate.Evaluate`
(`AuthorizationCommandDecorator.cs:63`, `AuthorizationQueryDecorator.cs:58`); the gate checks `IRequiresPermission` at
`AuthorizationGate.cs:46` (`Error.Forbidden` `:52`) and the MFA step-up at `:60` (`Error.Forbidden` `:64`).
`ValidatingCommandDecorator` passes through on `_validators.Length == 0` (`:65`; query twin `:69`).
`TimeoutCommandDecorator` passes a non-`IHasTimeout` command or a budget `<= TimeSpan.Zero` through (`:65`) and maps its
own expiry to `Error.Failure(...)` (`:81`). `CachingCommandDecorator` invalidates only when `command is
ICacheInvalidating` (`:61`); `CachingQueryDecorator` passes non-`IQueryCacheable` queries through (`:64`).
`TransactionalCommandDecorator` passes non-`ITransactional` commands through (`:30`) and otherwise calls
`unitOfWork.ExecuteInTransactionAsync` (`:33`). Carried: `LoggingCommandDecorator` timestamp and histogram anchors
(`:39`, `:43`, `:49`, `:54`, `:76`, `:97`), the sequential validator loop (`ValidatingCommandDecorator.cs:34`, `:70-94`),
`ValidationFailureExtensions.cs:21` and `ErrorHttpMapping.cs:22`.
**Transactional path (re-read 2026-11-25).** `DbContextFactory.ExecuteInTransactionAsync`
(`MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:578`) runs each attempt through
`RunTransactionalAttemptAsync` (called `:610`); the quoted business-failure test is `:642` (abridged in the body), then
`FlushEnrolledCommandsBeforeCommitAsync` (called `:652`, declared `:716`), then `TryCommit()` (called `:654`, declared
`:754`, `context.Database.CommitTransaction()` `:773`, `TransactionCommitAmbiguousException` built `:781`), and deferred
domain events flush post-commit through `FlushDeferredAsync` (`:668`). Carried: the re-entrant join, the pre-commit
throw that rolls the unit back, and the commit-ambiguity rationale (2026-10-29 lines, not reopened this run).
**DI sequence (re-read 2026-11-25).** `ThrowIfPipelineSealed` is called by the module scan
(`DependencyInjection.ModuleScanning.cs:49`), the CRUD helpers (`DependencyInjection.Crud.cs:80,142,193`),
`AddApplicationDecorators` (`DependencyInjection.cs:134`) and `AddMmcaApplicationPipeline` (`:228`; method `:226`, XML
example `:219-222`, sequence `:230-234`); the guard is declared `:329` with the quoted message at `:333-337`, and
`SealPipeline` sets the seal at `:326-327`. `VerifyDecoratorPipeline()` is the opt-in fitness check (doc from `:237`).
Carried: `AddNotificationApplicationServices()` does not check the seal
(`MMCA.Common.Application/Notifications/DependencyInjection.cs:36`, `:56-69`); Helpdesk composes with
`AddMmcaApplicationPipeline` (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:121`, `AddInfrastructure` `:77`
and `AddAPI` `:99` outside, `DiscoverAndRegister` `:125` and `AddBrokerMessaging` `:139` inside), as do the production
service hosts (for example `MMCA.ADC.Conference.Service/Program.cs:429`, `MMCA.Store.Catalog.Service/Program.cs:267`).
**Markers (re-read 2026-11-25).** `UseCases/Markers/` holds eight interfaces plus the `EntityCachePrefix` helper
(`EntityCachePrefix.cs:9`): `ITransactional.cs:6`, `ICacheInvalidating.cs:8` (`CachePrefix` `:22`, generic
`ICacheInvalidating<TEntity>` `:39`), `IQueryCacheable.cs:8` (`CacheKey` `:23`, `CacheDuration` `:28`),
`IRequiresPermission.cs:34` (`Permission` `:41`), `IHasTimeout.cs:14` (`Timeout` `:21`), `IRequiresMfa.cs:28`,
`IFeatureGated.cs:10`, `ISharedQueryCache.cs:21`. Carried: handler contracts `UseCases/Contracts/ICommandHandler.cs:9`
and `UseCases/Contracts/IQueryHandler.cs:9`.
**HTTP edge (re-read 2026-11-25).** `CreateDefault()` step anchors: exception handler `:35`, correlation id `:39`, request
localization `:43`, pre-forwarded capture `:50`, forwarded headers `:64`, HTTPS redirect `:71` (`IsCleartextHttp2`
predicate used `:85`, declared `:358`), response compression `:89`, routing `:93`, CORS `:97`, authentication `:103`,
tenant resolution `:107` (inert-unless comment `:108-111`), rate limiting `:115` (ADR-019 comment `:116-119`),
soft-deleted-user filter `:123`, view-as guard `:127`, authorization `:136`, output cache `:140`, JWKS `:144`, OIDC
discovery `:153`, controllers `:157`. `Build()` enforces four invariants (summary `:234-256`): capture immediately before
forwarded headers `:262-264`, authentication immediately before tenant resolution `:267-269`, authentication precedes
rate limiting `:272-274`, forwarded headers precede the HTTPS redirect `:277-279`. Carried: the capture's "nothing reads
the captured Items" comment, `OidcDiscoveryEndpointExtensions.cs:62`, `CommonForwardedHeaders.cs:49-50`,
`SoftDeletedUserMiddleware.cs:37`, `:72-78`, `:105-122`, `WebApplicationExtensions.cs` (`:38`, `:49`, `:61`, `:171`),
ADR-079 (`Website/docs-src/adr/079-shared-http-middleware-pipeline.md:9-16`, `:229-241`), and the adopters'
`UseCommonMiddlewarePipeline()` calls (ADC Conference `:461`, Identity `:373`, Engagement `:338`, Notification `:281`;
Store Sales `:320`, Identity `:318`, Catalog `:331`; Helpdesk `:149`).
**Mapping.** Carried: rubric sections 1 (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:122`), 6 (`:229`)
and 10 (`:329`); the header ADR cell lists 014 and 079 per the 2026-10-22 owner decision, matching the README row. The
view-as guard rests on ADR-137, which neither the header ADR cell nor the README row names; left for the mapping owner,
since the README row is outside this run's scope.
**History.** The 2026-10-29, 2026-10-22, 2026-10-19, 2026-10-08 and 2026-10-02 refreshes added the commit pre-flush and
re-entrant join, framed the pre-forwarded capture as not load-bearing, narrowed the seal scope to the module scan and
CRUD helpers, scoped the marker `is`-check sentence, framed the takeaway as ADR-014's Context, narrowed the profiling
parenthetical, added commit ambiguity, made the edge "four orderings, two strict adjacencies", made validators plural
and corrected the edge conditionals. Their full evidence is in this file's Website repo history.*

- Full series index: https://ivanball.github.io/writing.html
