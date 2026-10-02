# Scaffold a .NET modular monolith in one command, then build your first module

> Series: MMCA.Common · Article #39 (tutorial) · Pillar P5 · Groups G02,G05,G14 · Rubric §33 · ADR-065 ·
> Status: grounded in `MMCA.Common/AGENTS.md` ("DI Registration Sequence", "CQRS Decorator Pipeline"),
> `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs` and `DependencyInjection.ModuleScanning.cs`,
> the MMCA.Helpdesk seed (`Source/Hosts/MMCA.Helpdesk.Web/Program.cs`,
> `templates/mmca-module/.template.config/template.json`, `build/templates/overlay/mmca-app/README.md`),
> `Website/docs-src/adr/065-scaffolding-templates.md`, `Website/docs-src/guides/common-TEMPLATES.md`, and the overviews of
> `Website/docs-src/onboarding/group-14-module-system-composition.md`, `group-02-domain-building-blocks.md`,
> `group-05-cqrs-pipeline.md`. No em dashes.

**Subtitle:** One command writes the solution. The seven steps after it are the ones worth
understanding, because they are what makes the generated code safe to change.

---

Most "add a feature" guides skip the parts that actually keep a codebase honest a year later. They show
you a controller and a service class and call it a vertical slice. Then the aggregate has a public
setter, the handler opens its own transaction by hand, validation lives in three places, and nobody can
say which module owns which table.

MMCA.Common has opinions about all of that, and they are enforced opinions: a domain aggregate with no
public constructor, a use case that is a thin handler wrapped by a fat decorator pipeline, and a module
that declares its own dependencies so the host can assemble everything in the right order.

The framework ships a `dotnet new` pack, so you type none of that plumbing (ADR-065). Hand-rolling it
costs a day before you write a line of business logic, and ADR-065 measures that starting cost against
the framework's reference app: 12 projects, 136 files, and 11,532 lines of plumbing, an 827-line
`.editorconfig` among them, plus the 100-line `Directory.Packages.props` that carries every package pin
(58 of them in the seed today), several of those lines load-bearing in ways nothing tells you about
until much later.

That changes what a tutorial like this is for. Step 0 gets you a green solution in about a minute.
Steps 1 through 7 are the reasoning behind code you already have, which is what you need before you
change it. The example is a `Coupon` aggregate in a `Promotions` module, but every step maps directly
onto the real Conference, Sales, and Catalog modules in the consumer apps.

## Prerequisites

- **.NET 10 SDK.** The framework targets `net10.0` with `LangVersion: preview` for C# extension types.
- Familiarity with the layer flow: API/Grpc -> Infrastructure -> Application -> Domain -> Shared. Your
  module's code lives in those layers, and the framework forbids inward layers from referencing
  outward ones (a topic for the fitness-test tutorial).
- The conventions in your head: factory methods return `Result<T>` instead of throwing; commands and
  queries are separate; private fields are `_camelCase`; `TreatWarningsAsErrors` is on.

No credentials and no private feed: the packages are on nuget.org.

The example types below are **representative** of the module shape, not copied verbatim from a specific
file. They follow the documented base classes and conventions exactly.

## Step 0: scaffold the solution

```powershell
dotnet new install MMCA.Templates
dotnet new mmca-app -n Contoso.Support --module Orders --aggregate Order
cd Contoso.Support

dotnet build Contoso.Support.slnx          # warning-free under all five analyzers
dotnet test  --solution Contoso.Support.slnx   # passing, fitness rules included, no database
```

Three names, all independent: the solution (also your root namespace), the first module in plural
PascalCase, and its aggregate root in singular PascalCase. Everything derived from them follows, from
the routes and the identifier alias to the cache-key prefix and the Blazor pages.

You get twelve projects in the default shape: five module layers, a REST API host, a Blazor Server and
MudBlazor UI host, an Aspire AppHost (`--no-aspire` leaves it out), a per-database migrations project,
and three test projects. The aggregate arrives fully worked, in the same shape the rest of this article
explains.

Get that green **before** you change anything. It is the line you bisect against later, and if it is
not green that is a template bug rather than yours: the pack is generated from the framework's runnable
reference app, and a `template-smoke` CI job generates three solutions from it (two module shapes and
one SQLite solution without an AppHost) and builds and tests each in package mode.

One thing the scaffold deliberately does not hand over, because a rename or a shape flag invalidates
it and no fixed value is right for every name you could pick: **declaration order, plus one
constructor shape**. Three analyzer rules, and only three, ship dropped to `suggestion` in a marked
block appended to the *staged* `.editorconfig`; every other analyzer stays at error. `SA1210` cannot
sort your namespace against `MMCA.Common.*` without knowing your name: an app namespace sorts above it
for `Contoso.Support` and below it for `Zeta.App`, so no checked-in order survives both. `SA1211` is
the same story one level down, on the identifier-alias file whose aliases re-sort when a shape flag
renames them. `IDE0021` is the flags rather than the renames: the aggregate's private constructor
assigns one property per optional axis, so `--no-status --no-description --no-owner` together leave it
with a single statement, which the baseline then wants as an expression body. It is one-time, and the
generated README carries the exact commands (one `dotnet format analyzers` run restores the two
ordering rules; `IDE0021` is not fixable that way, so you fold the constructor by hand and delete the
line).

Your integration-event wire contract is not on that list: it arrives already frozen. The generated
`IntegrationEventContractTests` holds your own event, under the names you scaffolded with, and passes
on the first run. When you add or reshape an event on purpose, you version it and update
`ExpectedContract` in the same commit.

Now the part worth reading.

## Step 1: define the aggregate with a private constructor and a `Result` factory

Open the Domain layer of the module you just generated (`Source/Modules/Orders/...Orders.Domain/`), or
start a fresh one there. An aggregate root inherits from `AuditableAggregateRootEntity<TId>`, the top
rung of the framework's three-rung entity chain:

```
BaseEntity<TId>  ->  AuditableBaseEntity<TId>  ->  AuditableAggregateRootEntity<TId>
```

`BaseEntity<TId>` gives you a `required init` identifier (set once at construction, immutable after,
while EF still materializes through the parameterless constructor). `AuditableBaseEntity<TId>` adds the
audit fields (`CreatedOn/By`, `LastModifiedOn/By`) and the soft-delete `IsDeleted` flag, all stamped
automatically. `AuditableAggregateRootEntity<TId>` adds the domain-event collection and aggregate
helpers.

The load-bearing idiom is the **private constructor plus static `Create` factory returning
`Result<T>`**. You cannot `new` an invalid aggregate into existence; the factory is the only door, and
it enforces the invariants:

```csharp
// Domain layer (representative)
public sealed class Coupon : AuditableAggregateRootEntity<CouponIdentifierType>
{
    public string Code { get; private set; }
    public decimal PercentOff { get; private set; }
    public bool IsActive { get; private set; }

    private Coupon() { }   // EF materializes through this; callers cannot use it

    public static Result<Coupon> Create(string code, decimal percentOff)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return Result.Failure<Coupon>(CouponErrors.CodeRequired);
        }

        if (percentOff is <= 0 or > 100)
        {
            return Result.Failure<Coupon>(CouponErrors.PercentOutOfRange);
        }

        var coupon = new Coupon
        {
            Id = default,            // DB-generated identity; the factory leaves it
            Code = code.Trim(),
            PercentOff = percentOff,
            IsActive = true,
        };

        return Result.Success(coupon);
    }
}
```

Two things to notice. The setters are `private` so state changes only through methods on the aggregate.
And the factory returns `Result<Coupon>`, never throws, so a caller handles an invalid coupon as a value,
not an exception. This is the SOLID-and-DDD story in miniature: the factory is the single place
invariants live.

## Step 2: raise a domain event with `AddDomainEvent`

State changes that other parts of the system care about are announced as **domain events**. You do not
publish them directly; you record them on the aggregate, and the framework turns them into durable
outbox rows in the same transaction that saves the data.

Add a business method that mutates state and records the event:

```csharp
// On the Coupon aggregate (representative)
public Result Deactivate()
{
    if (!IsActive)
    {
        return Result.Failure(CouponErrors.AlreadyInactive);
    }

    IsActive = false;
    AddDomainEvent(new CouponDeactivated(Id, Code));
    return Result.Success();
}
```

The sequence is always: the aggregate mutates its own state, then calls `AddDomainEvent(...)`, and the
event sits in the aggregate's collection until `SaveChanges` runs. At save time the framework stamps the
audit fields, captures the domain events, serializes them to `OutboxMessage` rows, commits data and
outbox in one transaction, then dispatches in-process and marks the rows processed. You write one line;
the durability and the eventual broker delivery come for free (the transactional-outbox article covers
that machine in full).

`AddDomainEvent` lives on `AuditableAggregateRootEntity<TId>`, so any aggregate can raise events, and
nothing in the Domain layer knows or cares how they will eventually be delivered.

## Step 3: write the command and its handler

A write is a *use case*: a small command object handed to a handler that does exactly one thing. The
handler implements `ICommandHandler<TCommand, TResult>`, which is a single method,
`Task<TResult> HandleAsync(TCommand, CancellationToken)`, returning `Result` or `Result<T>`.

Keep the handler thin. It loads the aggregate, calls a business method, and saves. Everything
cross-cutting (logging, caching, transactions) is added by the pipeline, not by the handler.

```csharp
// Application layer (representative)
// The command is a plain record; the result type is declared on the handler below.
public sealed record CreateCouponCommand(string Code, decimal PercentOff)
    : ITransactional;   // ITransactional opts into a DB transaction

public sealed class CreateCouponHandler(ICouponRepository repository)
    : ICommandHandler<CreateCouponCommand, Result<CouponIdentifierType>>
{
    public async Task<Result<CouponIdentifierType>> HandleAsync(
        CreateCouponCommand command, CancellationToken cancellationToken)
    {
        var couponResult = Coupon.Create(command.Code, command.PercentOff);
        if (couponResult.IsFailure)
        {
            return Result.Failure<CouponIdentifierType>(couponResult.Errors);
        }

        await repository.AddAsync(couponResult.Value, cancellationToken);
        return Result.Success(couponResult.Value.Id);
    }
}
```

The marker interface `ITransactional` is the whole transaction opt-in. It is an empty interface; the
type *is* the message. When the command implements it, the `TransactionalCommandDecorator` wraps the
handler in `IUnitOfWork.ExecuteInTransactionAsync` and rolls back on an exception. A handler that does
not need a transaction (a single `SaveChanges` whose atomicity the outbox already guarantees) simply
does not implement the marker. There is a sibling marker, `ICacheInvalidating`, that exposes a
`CachePrefix` to evict on success the same way.

## Step 4: add a FluentValidation validator

Input validation does not belong in the handler. Write a `FluentValidation` validator for the command,
and the pipeline runs it automatically before the handler ever executes:

```csharp
// Application layer (representative)
public sealed class CreateCouponCommandValidator : AbstractValidator<CreateCouponCommand>
{
    public CreateCouponCommandValidator()
    {
        RuleFor(c => c.Code).NotEmpty().MaximumLength(32);
        RuleFor(c => c.PercentOff).InclusiveBetween(0.01m, 100m);
    }
}
```

This is structural validation (shape, length, range). It complements the domain factory's invariant
checks rather than replacing them: the validator rejects obviously malformed input cheaply at the edge,
and `Coupon.Create` still enforces the business rules that must hold no matter how the call arrived. The
validator is auto-discovered by convention scanning in the next step, so you do not register it by hand.

## Step 5: implement `IModule`

A **module** is the unit of cohesion above a feature slice. It implements `IModule`: a display `Name`,
an optional `Dependencies` list of other module names, a `RequiresDependencies` flag, and a single
`Register(services, configuration, applicationSettings)` method that wires all of the module's services.
The interface ships default-implemented members (`Dependencies => []`, `RequiresDependencies => false`,
an empty `RegisterDisabledStubs`), so a minimal module implements only `Name` and `Register`:

```csharp
// Application layer (representative)
public sealed class PromotionsModule : IModule
{
    public string Name => "Promotions";

    // This module reads coupon usage from Sales, so declare the dependency.
    public IReadOnlyList<string> Dependencies => ["Sales"];

    public void Register(
        IServiceCollection services,
        IConfigurationBuilder configuration,
        ApplicationSettings applicationSettings)
    {
        services.AddScoped<ICouponRepository, CouponRepository>();
        // handlers, validators, and mappers are picked up by convention scanning (next step)
    }
}
```

`Dependencies` is what lets the framework do something genuinely useful: `ModuleLoader` discovers every
`IModule` in the assemblies the host names and registers them in **topological order** (Kahn's
algorithm) based on declared dependencies, so a module is always wired after the modules it depends on.
`ModulesSettings` (the `"Modules"` config section) can disable a module; disabled modules receive stub
registrations so cross-module interfaces stay resolvable. That last detail is the extraction boundary: a
module that depends on a now-remote module keeps compiling and resolving because the stub stands in
until a gRPC client takes over.

## Step 6: register in the exact DI sequence

This is the step the most experienced developers still get wrong, because one ordering rule is
load-bearing. `AddApplicationDecorators()` must run after every module's handler scan, because Scrutor's
`TryDecorate` can only wrap handlers that are already registered. That is the only constraint that
matters here. Registrations that are not handlers (infrastructure, API, telemetry, options) can sit on
either side of it: DI dependencies resolve at runtime, not at registration time, so the infrastructure
that backs the decorated handlers can be registered before or after them. The generated host spells the
sequence out by hand:

```csharp
// Host composition root: the generated Web/Program.cs, abridged (representative module names)
services.AddApplication();                              // core services, event dispatcher
services.AddInfrastructure(builder.Configuration);      // repos, UoW, DbContexts, caching, outbox
services.AddAPI(modulesSettings);                       // controllers, idempotency, exception handlers
services.AddErrorResources<OrdersErrorResources>();     // one per module: error-code translations
services.AddErrorResources<PromotionsErrorResources>();

moduleLoader.DiscoverAndRegister(
    services, builder.Configuration, applicationSettings, modulesSettings,
    builder.Environment.EnvironmentName,
    [typeof(OrdersModule).Assembly, typeof(PromotionsModule).Assembly]); // each module scans itself

services.AddBrokerMessaging(builder.Configuration);
services.AddApplicationDecorators();                    // MUST be last: Scrutor wraps existing handlers
```

The rules embedded in that order:

- **`ScanModuleApplicationServices<TMarker>()`** runs once per module, from inside that module's own
  registration, which `ModuleLoader` reaches through the module's `Register`. It auto-registers that
  module's domain-event and integration-event handlers (singleton), DTO and request mappers, DTO
  projectors and update appliers (scoped), command and query handlers (scoped), and FluentValidation
  validators. This is why you did not register the validator from Step 4 or the handler from Step 3 by
  hand: convention scanning found them by the marker type's assembly.
- **`AddApplicationDecorators()` must be last** of the Application registrations. It uses Scrutor's
  `TryDecorate` to wrap every already-registered handler, then **seals** the pipeline. A module scan
  that runs after the seal throws an `InvalidOperationException` naming the call, so a misplaced scan
  fails at startup instead of running undecorated. A handler registered by hand after the seal is the
  one case that still slips through: it runs with no transactions, no caching, no logging, and no error
  to tell you.
- **`AddMmcaApplicationPipeline(pipeline => ...)`** is the framework's preferred form of the same
  sequence: it runs `AddApplication()`, then your callback (module scans, a `ModuleLoader` run, broker
  wiring), then `AddApplicationDecorators()`, so the handler registrations cannot land on the wrong side
  of the decorators. The generated host keeps the explicit calls shown above.

## Step 7: watch the decorator pipeline kick in, for free

With the sequence correct, every command and query handler is now wrapped, in this execution order:

```
Commands: FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout -> Transactional -> Handler
Queries:  FeatureGate -> Authorization -> Logging -> Caching -> Validating -> Timeout -> Handler
```

You wrote a thin handler. The pipeline added the rest, driven by the marker interfaces:

- **FeatureGate** is outermost and short-circuits the call when the feature flag for that command or
  query is turned off.
- **Authorization** comes next, and sits outside caching on purpose. Commands and queries that
  implement `IRequiresPermission` are checked against the permission registry for the current user's
  roles (and those that implement `IRequiresMfa` against the `mfa` claim), and a denial short-circuits
  with a `Forbidden` error, so a denied query never reads from or populates the cache.
- **Logging** records the full pipeline duration via `ICorrelationContext`, for every handler, with no
  per-handler code.
- **Caching** runs for queries that implement `IQueryCacheable` (supplying `CacheKey` + `CacheDuration`),
  and invalidates for commands that implement `ICacheInvalidating` (on success, outside the transaction
  boundary).
- **Validating** runs FluentValidation on both sides. On a command it runs before the transaction
  opens. On a query it sits inside Caching by design, because a cached entry was already validated
  when it was produced, so a cache hit skips the validator along with the handler.
- **Timeout** gives commands and queries that implement `IHasTimeout` their own execution budget: the
  handler runs under a linked token cancelled when the budget expires, and expiry comes back as a
  `Request.TimedOut` failure rather than an exception, while caller cancellation still propagates as
  one. A budget of zero or less passes straight through.
- **Transactional** opens a DB transaction only when the command implements `ITransactional`, and rolls
  back on an exception. A business failure (`Result.Failure`) also rolls the transaction back:
  `ExecuteInTransactionAsync` inspects the returned value and, on `Result { IsFailure: true }`, calls
  `RollbackTransaction()` and skips the commit, choosing atomicity over partial persistence. Cache
  invalidation runs only on success, so a failed command evicts nothing either way.

Your `CreateCouponCommand` from Step 3 implemented `ITransactional`, so it now runs inside a transaction
automatically. You never wrote `BeginTransaction`. That is the payoff of the shape: the handler stays
about the use case, and the cross-cutting concerns are written once, in the framework, and reused by
every handler in every module.

## The next slice, and the next module

You will repeat that shape for every feature you add, so the pack scaffolds it too, which keeps it from
drifting one hand-typed slice at a time. A single vertical slice is one command, run from the module's
`UseCases` folder:

```powershell
dotnet new mmca-command -n CancelOrder --app Contoso.Support --module Orders `
  --aggregate Order --domain-method Cancel

dotnet new mmca-query -n GetOrderByNumber --app Contoso.Support --module Orders `
  --aggregate Order
```

Handlers are convention-scanned, so there is nothing to register. Two things still need you: add the
`--domain-method` guarded method to your aggregate before the command slice compiles, and keep the
query's `CacheKey` inside your module's `*CacheKeys.Prefix`. The caching decorator matches cacheable
reads to invalidating commands **by string prefix**, so a key that drifts out of it goes stale silently.

A whole second module, across all five layers plus its test and migrations projects:

```powershell
dotnet new mmca-module -n Billing --app Contoso.Support --aggregate Invoice
```

Here is the boundary where generated code stops and you start. `dotnet new` cannot patch files that
already exist, so `mmca-module` **prints seven numbered wire-ups it cannot perform**, and until they
are done the module is invisible to the host and to the fitness rules. If your solution came from
`mmca-app`, you do not type any of them: that solution ships its own `build/add-module.ps1`, and the
printed text opens by telling you to run it instead, because it invokes the template and then performs
all seven itself. The list is the fallback for a hand-built solution, and the best description of what
the script is doing on your behalf:

1. **Solution.** Add the eight new projects (five layer projects, both test projects, and the
   migrations project) to the `.slnx`.
2. **Project references.** The Web host needs the module's API project and its migrations project. The
   architecture-test project needs **all five** layer projects, because the map in step 4 names a type
   from each.
3. **Identifier alias.** Copy the existing `<Compile Include ... Link>` block in
   `Directory.Build.props` and point it at the new module's `*.GlobalUsings.IdentifierType.cs`. Without
   it the alias is invisible outside its own project.
4. **Architecture map.** Five lines in your `*ArchitectureMap.cs`, one per layer. **A module missing
   from the map is silently not covered by the layering and isolation rules.** No error, no warning:
   the rules simply stop watching the code you just added.
5. **Host.** Two edits in the Web host's `Program.cs`. Add `typeof(BillingModule).Assembly` to the
   list handed to `ModuleLoader.DiscoverAndRegister`: discovery scans only the assemblies the host
   names, so a module left out of that list registers nothing. Then add one
   `services.AddErrorResources<BillingErrorResources>();` next to the existing ones.
6. **Database.** The module gets its own: an `AddDatabase` / `WithSQLServerDataSource` pair in the
   AppHost, `Modules` / `DataSources` / `Outbox` entries in the Web host's `appsettings.json`, and the
   deletion of the now-conflicting top-level `SQLServerMigrationsAssembly`. Every module database
   carries its own outbox and inbox tables, so two modules migrated into one database collide on them,
   and naming the outbox source explicitly is what stops it from moving the day you reorder those
   calls.
7. **First migration.** `dotnet ef migrations add InitialCreate` against the new migrations project.

The first two are what make it compile, so they fail loudly. Numbers three and four do not, and neither
does the module-assembly half of number five, which is why they are worth reading twice. And the honest
reading of the script is not that the wire-ups stopped mattering: it is that the one code path CI
exercises applies them for you, on a solution the template generated.

## Trade-offs and gotchas, honestly

The shape buys consistency, and it asks for discipline in return:

- **The DI order is guarded, but not completely.** `AddApplicationDecorators()` seals the pipeline, so
  a module scan placed after it throws at startup. A handler registered by hand after it still runs
  undecorated with no warning. The generated solution ships `DecoratorPipelineOrderTests`, which builds
  the module's registration sequence and asserts the decorator nesting for one command and one query,
  and the framework exposes `VerifyDecoratorPipeline()` for a fitness test that checks every handler
  (the next article covers fitness tests).
- **Markers are easy to forget.** `ITransactional` and `ICacheInvalidating` are opt-in by presence.
  Forget the marker and you lose the behavior silently. The upside (no behavior you did not ask for) is
  also the trap (no behavior you forgot to ask for).
- **Validation lives in two places by design.** Cheap structural checks in the FluentValidation
  validator, business invariants in the domain factory. That is intentional layering, not duplication,
  but it does mean a rule can be enforced at the wrong altitude if you are not deliberate.
- **Topological ordering depends on accurate `Dependencies`.** If a module reads from another but does
  not declare it, the loader may wire it too early. Declare every cross-module dependency you actually
  take.
- **Soft-delete is the default.** Your aggregate is never hard-deleted; `IsDeleted` is set and global
  query filters hide it. Plan for the data to persist, which matters for both storage and privacy.
- **A scaffold is a starting point, not an understanding.** The generated solution is green on day one,
  which is exactly what makes it easy to change something load-bearing without noticing. The marker
  interfaces, the architecture map, and the host's list of module assemblies are the places where a
  wrong edit fails silently rather than loudly.

None of these are reasons to fight the shape. They are the reasons to learn it once and let it carry
every module after.

---

**What we covered:** scaffolding the whole solution with `dotnet new mmca-app` and the one fixup it
deliberately leaves you, the aggregate with a private constructor and a `Result` factory, raising a
domain event with `AddDomainEvent`, a thin command handler marked `ITransactional`, a FluentValidation
validator, the `IModule` contract with `Name` and `Dependencies`, the DI sequence (each module's
`ScanModuleApplicationServices<T>()` reached through `ModuleLoader.DiscoverAndRegister`, then
`AddApplicationDecorators()` last, sealing the pipeline), the decorator pipeline that wraps every
handler automatically, and the seven wire-ups `mmca-module` prints because `dotnet new` cannot patch
files that already exist (a solution generated by `mmca-app` applies all seven for you through its own
`build/add-module.ps1`).

**Next in the series:** write your first architecture fitness test, so the conventions in this article
become a red build instead of a code-review comment.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read ADR-065 on why the template is
generated from the reference app rather than maintained beside it, or scaffold a solution and tell me
what breaks.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- Templates guide: `https://ivanball.github.io/docs/guides/common-TEMPLATES.html`
- Getting started: `https://ivanball.github.io/docs/guides/common-GETTING-STARTED.html`

*Tags: .NET, C Sharp, Domain Driven Design, CQRS, Software Architecture*

*Notes: 2026-10-02 pass against MMCA.Common v1.221.0. Re-read directly this pass: the decorator
registration inside `AddApplicationDecorators()` at
`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:114-153` (seven command
decorators at :134-140, six query decorators at :143-148, query `Validating` registered inside
`Caching` at :144-145; registered last = outermost, so execution order is the reverse of registration
order), the `SealPipeline` call at :150, `AddMmcaApplicationPipeline` at :207-216 (calls only
`AddApplication()`, the callback, and `AddApplicationDecorators()`; its remarks at :195-196 say non-handler
registrations can stay outside the call), `VerifyDecoratorPipeline()` at :244 (never called
automatically, :221-222), and `ThrowIfPipelineSealed` throwing `InvalidOperationException` at :310-319.
`ScanModuleApplicationServices` calls `ThrowIfPipelineSealed` at
`DependencyInjection.ModuleScanning.cs:49` and scans domain-event handlers (:52), integration-event
handlers (:59), DTO mappers (:65), DTO projectors (:74), request mappers (:80), update appliers (:90),
command-aware appliers (:99), command handlers (:105), query handlers (:111), validators (:117).
`MMCA.Common/CLAUDE.md` is a six-line `@AGENTS.md` import, so the framework doc anchors moved to
`MMCA.Common/AGENTS.md`: DI Registration Sequence at :72-74 ("That ordering is the only load-bearing
part."), execution order at :81-82, per-decorator bullets at :85-91 (Authorization with `IRequiresMfa`
:86, Caching :88, Validating :89, Timeout :90, Transactional :91). Source inconsistency recorded, not
resolved: `AGENTS.md:74` says `AddMmcaApplicationPipeline` runs `AddInfrastructure` and `AddAPI`, but
the method body at `DependencyInjection.cs:207-216` does not; the article follows the code. Generated
host sequence read from `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:78-132`
(`AddApplication` :78, `AddInfrastructure` :79, `AddAPI` :101, `AddErrorResources` :106,
`ModuleLoader.DiscoverAndRegister` with the host-named assembly list :116-124, `AddBrokerMessaging`
:130, `AddApplicationDecorators` :132); the module's own scan at
`Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs:35`. Seed fitness test
`Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/DecoratorPipelineOrderTests.cs:35` (subclass of
`DecoratorPipelineOrderTestsBase`, one command plus one query, sequence at :59-61); no stage or
template exclusion names it. Transactional rollback on business failure at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:599`
(`RunTransactionalAttemptAsync`), `if (result is Result { IsFailure: true })` at :608, the "Business
failure: atomicity over partial persistence" comment at :610, `RollbackTransaction();` at :613.
`IModule` defaults at `Modules/IModule.cs:17` (`Dependencies => []`), :23 (`RequiresDependencies =>
false`), :34 (`RegisterDisabledStubs`); Kahn at `Modules/ModuleLoader.cs:275`; `ModulesSettings.SectionName
= "Modules"` at `Settings/ModulesSettings.cs:10`. Entity chain, `ICommandHandler`, `ITransactional`,
`ICacheInvalidating` and `IQueryCacheable` anchors carried from the 2026-10-02 audit's CONFIRMED verdicts
(`BaseEntity.cs:37`, `AuditableBaseEntity.cs:13`, `AuditableAggregateRootEntity.cs:13`,
`ICommandHandler.cs:9,17`, `ITransactional.cs:6`, `ICacheInvalidating.cs:14`, `IQueryCacheable.cs:23,28`),
not re-opened this pass. Scaffolding figures from `Website/docs-src/adr/065-scaffolding-templates.md`:
seed tally 12 projects, 136 files, 11,532 lines at :38-39, method re-run 2026-10-01 at :40-42 (129 files
and 10,394 lines under `Source/` and `Tests/`, plus 1,138 lines across seven root build files), the
827-line `.editorconfig` and 100-line `Directory.Packages.props` with 58 pins at :43 (the audit
re-counted the three file figures on disk). "One thing the scaffold deliberately does not hand over"
and the three relaxed rules at ADR-065 :78-97; the wire-contract freeze shipping under the adopter's
names at :99-115; the smoke job (`ci.yml:120`) generating three solutions at :157-164, cases at
`MMCA.Helpdesk/build/templates/smoke.ps1:117`, :123, :129 (Contoso.Support, Zeta.Warehouse,
Nordic.Books); `template-smoke` is advisory, the one required check being `build-and-test`
(`MMCA.Helpdesk/AGENTS.md`, Contribution Flow). Generated README
`MMCA.Helpdesk/build/templates/overlay/mmca-app/README.md`: "The one-time fixup" at :103,
`dotnet format analyzers ... --diagnostics SA1210 SA1211 --severity info` at :111, `IDE0021` hand-fold
at :117-120, "Your integration-event wire contract is already frozen" at :122-134, `--no-aspire` at
:206, seven wire-ups at :171. Wire-ups from
`MMCA.Helpdesk/templates/mmca-module/.template.config/template.json:264` (`manualInstructions`), sqlite
entry :268, server-engine entry :271, step 5 being two host edits (module assembly into the
`DiscoverAndRegister` list, then `AddErrorResources`) in both entries; ADR-065 :124-126 agrees. Source
inconsistency still recorded rather than resolved: the README says "seven wire-ups" at :171 and "six
wire-ups" at :225; the article follows `template.json`. ALL code blocks are labeled representative (the
`Coupon`/`Promotions` example is invented; the Step 6 block is an abridged shape of the generated
`Program.cs` with module names substituted). Corrections this pass: seed tally moved to the ADR's
2026-10-01 figures (136 / 11,532); smoke solution count moved to three; "two things" the scaffold leaves -> one, with the wire
contract described as shipping frozen; Step 6 rewritten to the generated host's shape (scans inside
each module's registration via `ModuleLoader`) and to the sealed pipeline (a late scan throws; only a
late hand-registered handler is silent), plus `AddMmcaApplicationPipeline`; wire-up 5 is two host
edits and its assembly half joins the silent list; `ModuleLoader` discovers modules only in the
host-named assemblies; trade-off bullets updated for the seal, `DecoratorPipelineOrderTests` and
`VerifyDecoratorPipeline`; Authorization bullet gained `IRequiresMfa`; scan list gained
integration-event handlers, projectors and appliers; all framework doc anchors moved from `CLAUDE.md`
to `AGENTS.md`; decorator anchors :117-153 -> :114-153; rollback anchors :573/:582/:584/:587 ->
:599/:608/:610/:613.*

- Full series index: https://ivanball.github.io/writing.html
