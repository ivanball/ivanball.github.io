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
commands, outermost to innermost, is seven decorators deep:

```
FeatureGate -> Authorization -> Logging -> Caching ->
Validating -> Timeout -> Transactional -> Concrete Handler
```

And for queries, one decorator shorter: everything the command chain carries except the transaction.

```
FeatureGate -> Authorization -> Logging -> Caching ->
Validating -> Timeout -> Concrete Handler
```

(The framework also ships an optional pair of MiniProfiler decorators, `ProfilingCommandDecorator` and
`ProfilingQueryDecorator`, registered only by a separate opt-in `AddApplicationProfiling()` call; called
after `AddApplicationDecorators()`, they wrap both chains from the outside. No consumer host calls it
today.)

Each position is a deliberate cost-and-correctness argument:

- **Feature-gating is outermost** so a disabled feature is rejected with zero downstream work: no
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
carries an ASCII nesting diagram of both chains in its own doc comment.

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
- **A success commits and then invalidates the cache.** Only a success reaches `CommitTransaction()`.
  In-process domain events are flushed *after* the commit, so a handler never acts on state that could
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

Each decorator does an `is`-check (`command is ITransactional`, `command is IRequiresPermission`, and so
on) and passes straight through when the interface is absent. A read-only command pays nothing for
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
the pipeline on the service collection as its final act, and every registration method that could add
handlers afterwards (the module scan, the entity CRUD helpers) checks the seal first and throws an
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
soft-deleted-user check -> authorization -> output cache -> JWKS + OIDC discovery -> controllers
```

Four of those orderings are load-bearing, two of them strict adjacencies, and the builder re-validates
every one of them while it builds the step list, each with its reason carried in the exception it would
throw:

- **The pre-forwarded capture immediately before forwarded headers.** The capture step stashes the real
  transport scheme and host before `UseForwardedHeaders` rewrites them from the `X-Forwarded-*` headers,
  which is what keeps the OIDC discovery document's `jwks_uri` pointing at an address the caller can
  actually reach. Those captured values are only faithful if nothing rewrites the request in between, so
  the two steps have to be adjacent, not merely ordered.
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
`Tenancy:Enabled`. The soft-deleted-user check (which sits between the limiter and authorization so a
revoked account is rejected before any endpoint gets to authorize it) has no setting at all: on every
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
  a seal on the service collection that every later registration method has to check.
- **A new concern means a new decorator at the correct depth.** Inserting it at the wrong position can
  silently change semantics, as with validating inside the transaction. Adding to the pipeline requires
  understanding the ordering argument, not just appending a class. Authorization and
  timeout show why: both sit *between* other decorators, and placing either one wrong is a
  correctness bug rather than a style choice.
- **The chain is deep.** Every command walks seven decorators and every query six, even when it declares
  none of the markers, because each one is registered unconditionally and decides at runtime whether it
  has work to do. The pass-through cost of an `is`-check is small, but it is not zero, and it grows every
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

The takeaway is the line ADR-014 is built around: **if a concern is cross-cutting, it should wrap the
handler, not live inside it. The order it wraps in is a design decision you write down once, not an
accident you rediscover per file.**

---

**What we covered:** why cross-cutting concerns scattered into handlers drift and hide their ordering, how
the MMCA.Common pipeline wraps every command with `FeatureGate -> Authorization -> Logging -> Caching ->
Validating -> Timeout -> Transactional` decorators in a deliberate order (and every query with the same
chain minus the transaction), how `ITransactional` / `ICacheInvalidating` / `IQueryCacheable` /
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

*Notes: 2026-10-08 refresh against MMCA.Common v1.233.0. The anchors named in the 2026-10-08 entry
were re-read this run and corrected in place below; every other anchor carries from the 2026-10-02
refresh (MMCA.Common v1.221.0), which re-read all of them unless marked otherwise and replaced the
2026-09-19 ledger, because most of its line numbers had moved and `DependencyInjection.cs` is split
into three partial files.
**2026-10-08 entry (MMCA.Common v1.233.0).** Three body changes. (1) Profiling: `AddApplicationProfiling()`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:160`, doc "Registers
MiniProfiler decorators" `:156`) registers the pair at `:162-163` with no toggle; it wraps from the
outside only when called after `AddApplicationDecorators()`, and a Grep of `MMCA.ADC/Source`,
`MMCA.Store/Source` and `MMCA.Helpdesk/Source` finds no call (ADR-014 `:56-58`: "No consumer host wires
it today"). The parenthetical is narrowed to that. (2) Commit ambiguity: a handler exception rolls back
(`DbContextFactory.cs:664-667`), but a failed commit is never retried or rolled back and surfaces as
`TransactionCommitAmbiguousException` (rationale `:532-537`, thrown past the execution strategy at
`:592-593`); the success bullet gained that clause and the exception bullet is scoped to the handler.
(3) Edge invariants: `Build()` (`MiddlewarePipelineBuilder.cs:252`) carries two `RequireImmediatelyBefore`
(`:254-257`, `:259-262`) and two `RequirePrecedes` (`:264-267`, `:269-272`), so "four adjacencies" is
now "four orderings, two of them strict adjacencies", and the startup re-validation sentence says
"orderings". Re-anchored in place: `FeatureGateCommandDecorator.cs:60`, ADR-014 (`:79-80`,
`:225-232`, `:371`, `:380`), `DbContextFactory.cs` (all +7), `WebApplicationExtensions.cs`
(`ApplyPipeline` `:170`, `IsLocalRedirectTarget` `:159`). Header left citing `MMCA.Common/AGENTS.md`:
its "DI Registration Sequence" (`:72`, sentence `:74`) says `AddMmcaApplicationPipeline` runs
`AddInfrastructure(config)` and `AddAPI(modulesSettings)`, but the method (`DependencyInjection.cs:207-216`)
runs only `AddApplication()`, the configure delegate and `AddApplicationDecorators()`; the body follows
the code, and the AGENTS.md drift is reported for its owner.
**2026-10-02 body corrections.** (1) Header: `MMCA.Common/CLAUDE.md` is a five-line `@AGENTS.md`
import, so the header cites `MMCA.Common/AGENTS.md`, where "DI Registration Sequence" is at `:72`,
"CQRS Decorator Pipeline" at `:76` and the two chain lines at `:81-82`. (2) Validation: the body said
the decorator "resolves the registered `IValidator<TCommand>`" (singular).
`ValidatingCommandDecorator` takes `IEnumerable<IValidator<TCommand>> validators`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:34`),
loops over every one sequentially (`:74-84`, with the DbContext-not-thread-safe reason in the comment
at `:70-72`), accumulates the errors (`:83`) and returns one failure carrying the union (`:94`).
ADR-014 records this as the 2026-08-31 correction (`Website/docs-src/adr/014-cqrs-decorator-pipeline.md:11-12`).
The `ErrorType.Validation` and HTTP 400 parts hold: `Error.Validation(...)` at
`MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:21`, and
`[ErrorType.Validation] = StatusCodes.Status400BadRequest` at
`MMCA.Common.API/Middleware/ErrorHttpMapping.cs:22`. (3) Edge conditionals: the body said tenant
resolution and the soft-deleted-user check are each "gated by its own settings". Only tenant
resolution is: its step comment (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:111-112`)
says it is inert unless the host called `AddMultiTenancy` and set `Tenancy:Enabled`.
`SoftDeletedUserMiddleware` (`MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:33`) has no
options: an unauthenticated request (no `UserId`) passes through (`:74-80`), a cached deleted marker
answers 401 on every host (`:102-108`), and the database fallback runs only when
`GetService<ISoftDeletedUserValidator>()` resolves (`:111`), otherwise the request passes through
(`:112-118`). The paragraph is rewritten to say exactly that.
**Decorator chain (unchanged behavior, re-anchored).** `AddApplicationDecorators` is at
`MMCA.Common.Application/DependencyInjection.cs:114-153`: commands registered `:134-140`
(`TransactionalCommandDecorator` innermost at `:134`, `FeatureGateCommandDecorator` outermost at
`:140`), queries `:143-148` (`TimeoutQueryDecorator` innermost at `:143`, `FeatureGateQueryDecorator`
outermost at `:148`), `SealPipeline(services)` at `:150`. The XML doc carries the command diagram from
`:61`, the query diagram from `:74`, and the rationale list from `:86` to `:110`, including the
query-side validation placement at `:96-100` ("On the query side it sits INSIDE caching", `:98`) and
the business-failure sentence at `:107-108`. Optional profiling: `AddApplicationProfiling()` registers
`ProfilingCommandDecorator` and `ProfilingQueryDecorator` at `:162-163`. ADR-014 states both current
chains in its Revision (2026-08-26) at `:225-232`, records the shared authorization gate in its
Revision (2026-09-19) from `:371` (`Evaluate` at `:380`), and states the decorators-last scope at
`:79-80`. Order pinned by `DecoratorPipelineOrderTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Conformance/DecoratorPipelineOrderTestsBase.cs:38`),
`protected virtual` lists at `:49` (commands) and `:61` (queries, `ValidatingQueryDecorator` at
`:67`); the framework subclass
(`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/Conformance/DecoratorPipelineOrderTests.cs:23`)
overrides only `ConfigureServices` (`:26`).
**Per-decorator behavior.** `FeatureGateCommandDecorator` short-circuits with `Error.NotFoundError(...)`
(`UseCases/Decorators/FeatureGateCommandDecorator.cs:60`). Both authorization decorators call
`AuthorizationGate.Evaluate` (`AuthorizationCommandDecorator.cs:62`, `AuthorizationQueryDecorator.cs:57`);
the gate is at `AuthorizationGate.cs:40`, with the permission check at `:46-56`, the MFA step-up at
`:60-68` and the capability-first comment at `:58-59` (audit-file anchors; only the `Evaluate` line
was re-read this run). `LoggingCommandDecorator` uses `Stopwatch.GetTimestamp()` (`:39`) and
`Stopwatch.GetElapsedTime()` (`:43`) and records `failed` (`:49`), `completed` (`:54`) and
`exception` (`:76`) through `RecordDuration` (`:97`). `TimeoutCommandDecorator` (`:35`) passes a
budget `<= TimeSpan.Zero` through (`:65`), calls `CancelAfter` (`:69`), runs the inner handler on
`budget.Token` (`:73`) and maps its own expiry to `Request.TimedOut` (`:82`).
`CachingCommandDecorator` (`:33`, `ICacheService` at `:35`, optional `ITenantContext?` at `:37`,
`ReInvalidationDelay` at `:45`) invalidates only when `command is ICacheInvalidating` and the result is
not a failure (`:61-63`, `IsFailure` at `:126`). `TransactionalCommandDecorator` (`:22`) passes
non-`ITransactional` commands through (`:30`) and otherwise calls
`unitOfWork.ExecuteInTransactionAsync` (`:33`).
**Transactional path.** `DbContextFactory.ExecuteInTransactionAsync`
(`MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:551`) runs each
attempt through `RunTransactionalAttemptAsync` (`:606`): the quoted business-failure snippet is
`:615-621` (rollback at `:620`), then `FlushEnrolledCommandsBeforeCommitAsync` (`:625`, declared
`:681`) saves enrolled internal-command rows and throws on any other unsaved tracked change, then
`TryCommit()` (called `:627`, declared `:719`, `context.Database.CommitTransaction()` at `:738`), and
deferred domain events flush post-commit through `FlushDeferredAsync` (`:641`). The pre-commit flush
is not described in the body: it does not change the three outcomes the article lists.
**DI sequence.** The pipeline-sealed guard: `ThrowIfPipelineSealed` in
`DependencyInjection.ModuleScanning.cs:49` (module scan) and `DependencyInjection.Crud.cs:80,142,193`
(CRUD helpers); the quoted `InvalidOperationException` message is at `DependencyInjection.cs:314-318`.
`AddMmcaApplicationPipeline(Action<MmcaApplicationPipelineBuilder>?)` is at `:207` and its XML doc
example (the article's `ScanModule` / `Register` snippet) at `:200-203`. The seal guards only the
framework registration methods; `VerifyDecoratorPipeline()` (`:244`) is the opt-in fitness check, and
the body's scoping ("every registration method that could add handlers afterwards") stays accurate.
Helpdesk wires the sequence by hand with `AddApplicationDecorators()` last:
`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:132`, after `AddApplication()` `:78`,
`AddInfrastructure` `:79`, `AddAPI` `:101`, `DiscoverAndRegister` `:116`, `AddBrokerMessaging` `:130`.
Markers: `Markers/` holds eight interfaces (`ICacheInvalidating`, `IFeatureGated`, `IHasTimeout`,
`IQueryCacheable`, `IRequiresMfa`, `IRequiresPermission`, `ISharedQueryCache`, `ITransactional`); the
ones the body names are `ITransactional.cs:6`, `ICacheInvalidating.cs:8,14`, `IQueryCacheable.cs:23,28`,
`IRequiresPermission.cs:34,41`, `IHasTimeout.cs:14,21`, `IRequiresMfa.cs:28`. Handler contracts:
`UseCases/Contracts/ICommandHandler.cs:17`, `UseCases/Contracts/IQueryHandler.cs:17`.
**HTTP edge.** `MiddlewarePipelineBuilder.CreateDefault()` spans `:31-151`. Step anchors: exception
handler `:35`, correlation id `:39`, request localization `:43`, pre-forwarded capture `:50`, forwarded
headers `:65` (options from `CommonForwardedHeaders.Create()` at `:69`; `KnownProxies` and
`KnownIPNetworks` cleared at `MMCA.Common.API/Startup/CommonForwardedHeaders.cs:49-50`), HTTPS redirect
`:72` (SEC-Common-44 protocol comment `:79-84`, `UseWhen(... IsCleartextHttp2 ...)` `:85-87`, the
predicate declared `:350`), response compression `:90`, routing `:94`, CORS `:98`, authentication
`:104`, tenant resolution `:108`, rate limiting `:116`, soft-deleted-user filter `:124`, authorization
`:128`, output cache `:132`, JWKS `:136`, OIDC discovery `:145`, controllers `:149`. `Build()` (`:252`)
enforces the four invariants at `:254-257` (capture immediately before forwarded headers), `:259-262`
(authentication immediately before tenant resolution), `:264-267` (authentication precedes rate
limiting, ADR-019) and `:269-272` (forwarded headers precede the HTTPS redirect).
`WebApplicationExtensions.cs` holds the `extension(WebApplication app)` block (`:37`), both
`UseCommonMiddlewarePipeline` overloads (`:48`, `:60`) and the private `ApplyPipeline` they route
through (`:170`), alongside `UseCommonRequestLocalization` (`:73`), two `MapCultureEndpoint` overloads
(`:102`, `:115`) and `IsLocalRedirectTarget` (`:159`). The order is frozen by
`MiddlewarePipelineOrderTestsBase` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Conformance/MiddlewarePipelineOrderTestsBase.cs:29`),
`ExpectedStepNames` at `:38` with `PreForwardedCapture` at `:43`. ADR-079's header records the
protocol-keyed exemption and the `CommonForwardedHeaders.Create()` factory
(`Website/docs-src/adr/079-shared-http-middleware-pipeline.md:9-16`). Adopters re-read this run:
`MMCA.ADC.Conference.Service/Program.cs:442`, `MMCA.ADC.Identity.Service/Program.cs:345`,
`MMCA.ADC.Engagement.Service/Program.cs:320`, `MMCA.ADC.Notification.Service/Program.cs:262`,
`MMCA.Store.Sales.Service/Program.cs:299`, `MMCA.Store.Identity.Service/Program.cs:299`,
`MMCA.Store.Catalog.Service/Program.cs:320`, `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:142`.
**Mapping.** Rubric sections re-anchored in `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`:
section 1 (SOLID) `:122`, section 6 (CQRS and event-driven) `:229`, section 10 (Messaging and
integration) `:329`. Section 10 matches the README mapping row but the body carries no messaging
content; the ADR cell lists 014 and 079 while the README row (`Website/docs-src/articles/README.md:17`)
lists 014/031/079. Both cells are left unchanged this run and raised for an owner decision. Dropped
from the previous ledger: the About-the-author package note (`FACTS.md:19` reads 22 packages, and the
body has no About-the-author section) and the "five markers" count (eight today).*

- Full series index: https://ivanball.github.io/writing.html
