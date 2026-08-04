# Getting Started: Build a New App on MMCA.Common

MMCA.Common is a .NET 10 framework for DDD, Clean Architecture, and CQRS, shipped as a set of
lockstep-versioned NuGet packages (the authoritative list and count live in
[FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md)). Its core promise: **build a
modular monolith now, and extract a module into its own microservice later, without a rewrite.**

Standing that up by hand means 12 projects and roughly 5,300 lines before a line of your own
business logic, several of them load-bearing in ways nothing tells you about until much later. So
you do not type it. One command writes the whole thing, green:

```bash
dotnet new install MMCA.Templates
dotnet new mmca-app -n Contoso.Support --module Orders --aggregate Order
```

The six steps below take that from nothing to a running, migrated, browsable app. Everything after
them is optional depth.

> **Adding the framework to a solution that already exists?** The template creates a solution; it
> cannot retrofit one. Take the [build-by-hand walkthrough](common-BUILD-BY-HAND.md) instead. It is
> also where to read *what* the scaffold handed you and why, once you want to change it.

---

## Before you start

- **.NET 10 SDK.** The framework targets `net10.0` with `LangVersion: preview` for C# extension types.
- **Docker Desktop.** Aspire provisions SQL Server as a container, so you do not install one.
- **EF Core tools:** `dotnet tool install --global dotnet-ef`.

No credentials, tokens, or extra feeds. `MMCA.Templates` and every `MMCA.Common.*` package restore
from nuget.org (see [ADR-053](../adr/053-dual-registry-package-publishing.md)).

---

## 1. Install the template pack

```bash
dotnet new install MMCA.Templates
```

Four templates arrive: `mmca-app` (a whole solution), `mmca-module` (a business module across all
five layers), and `mmca-command` / `mmca-query` (a single vertical slice).

## 2. Generate the solution

```bash
dotnet new mmca-app -n Contoso.Support --module Orders --aggregate Order
cd Contoso.Support
```

Three names, and they are independent: the **solution** (also your root namespace), the first
**module** in plural PascalCase, and that module's **aggregate root** in singular PascalCase.
`--module Billing --aggregate Invoice` is equally fine. Everything derived from them follows: routes,
the Aspire database resource, the identifier alias, the cache-key prefix, the resource strings, and
the Blazor pages.

Two more parameters are worth knowing on day one:

- `--framework-version` pins the `MMCA.Common.*` set, defaulting to the version the pack was cut
  against. Every package in the set moves together and there is no phased rollout
  ([ADR-016](../adr/016-lockstep-versioning-masstransit-pin.md)); a fitness rule fails the build if
  the pins ever disagree.
- `--local-mmca` emits a `local.props` that builds against `../MMCA.Common/Source` by
  `ProjectReference` instead of the published packages. Use it only when your app sits beside the
  framework source in the same workspace.

The full parameter table is in the [templates guide](common-TEMPLATES.md).

## 3. Build and test before you change anything

```bash
dotnet build Contoso.Support.slnx
dotnet test  --solution Contoso.Support.slnx
```

That is a warning-free build with `TreatWarningsAsErrors` and all five analyzers at error severity,
and a passing test run including the architecture-fitness rules, with **no database needed**. If it
is not green, that is a template bug rather than yours: the pack is generated from the reference app
whose CI keeps it building, and a separate smoke job builds two generated solutions in package mode
on every change.

Getting a green baseline **first** is the point of this step. It is the line you bisect against
later.

## 4. Create the first migration

The scaffold ships the migrations project and its design-time factory; the migration itself
describes your entities, so it is yours to generate:

```bash
dotnet ef migrations add InitialCreate \
  --project Source/Hosting/Contoso.Support.Migrations.SqlServer.Orders \
  --startup-project Source/Hosting/Contoso.Support.Migrations.SqlServer.Orders \
  --context SQLServerDbContext
```

Always pass `--context SQLServerDbContext`. There is exactly one concrete context class per database
engine; module contexts are abstract and only declare their `DbSet`s
([ADR-006](../adr/006-database-per-service.md)). You get **one migrations project per (future)
service database** even while you are a monolith, which is what makes extraction later cost no
migration rework.

## 5. Run it

```bash
dotnet run --project Source/Hosting/Contoso.Support.AppHost
```

> **Run this from a real, interactive terminal.** Launched from a headless or background shell the
> Aspire AppHost stalls at control-plane init and no dashboard appears.

The dashboard lists three resources: `sql`, `web` (the REST API), and `ui` (Blazor Server +
MudBlazor). Open the **`ui`** endpoint to create and browse orders in the browser. To exercise the
API directly, `POST /Orders` then `GET /Orders` against the `web` endpoint; the API root `/` has no
page and returns 404 by design. Confirm 201 then 200, that audit fields are stamped, that
soft-deleted rows are filtered out, and that an outbox row was written for the
`OrderOpenedIntegrationEvent`.

The app runs **issuer-less**: with no Identity module it registers a bare auth scheme and the
controller is `[AllowAnonymous]`, so nothing blocks you on day one. Adding real RS256/JWKS auth is
under [Then what](#then-what) below.

## 6. The two one-time fixups

The scaffold deliberately does not hand these over, because renaming invalidates them and no fixed
value is right for every name you could pick. Both are covered in full in the
[templates guide](common-TEMPLATES.md).

**Using-directive order.** `using Contoso.Support.Orders.Shared;` sorts above `MMCA.Common.*`, but
`using Zeta.App.Orders.Shared;` sorts below it, so no checked-in order survives every name. `SA1210`
ships as a suggestion in a marked block at the bottom of the generated `.editorconfig`. Sort them,
then delete the block once you have stopped scaffolding:

```bash
dotnet format analyzers Contoso.Support.slnx --diagnostics SA1210 --severity error
```

**Your integration-event wire contract.** Integration events cross service boundaries, so a renamed
or retyped property breaks consumers elsewhere. `IntegrationEventContractTestsBase` fails the build
on a silent reshape, but only against a contract **you** froze: its frozen literal lists members
alphabetically, so one inherited from a sample module is wrong the moment your aggregate is not
called `Ticket`. Add the subclass to `ArchitectureTests.cs`, run it once, and paste in what the
failure prints:

```bash
dotnet test --project Tests/Architecture/Contoso.Support.Architecture.Tests/Contoso.Support.Architecture.Tests.csproj \
  -- --filter-class "*IntegrationEventContract*"
```

---

## What you were handed

```
Contoso.Support.slnx
.editorconfig                 the five analyzers at error severity
Directory.Build.props         language settings, analyzers, the identifier-alias links
Directory.Build.targets       the local-source PackageReference -> ProjectReference swap
Directory.Packages.props      Central Package Management
Source/
  Modules/Orders/             Shared, Domain, Application, Infrastructure, API
  Hosts/Contoso.Support.Web           the monolith REST API host
  Hosts/UI/Contoso.Support.UI.Web     Blazor Server + MudBlazor
  Hosting/Contoso.Support.AppHost     Aspire orchestration
  Hosting/Contoso.Support.Migrations.SqlServer.Orders
Tests/
  Modules/Orders/             domain + application tests
  Architecture/               the fitness functions, parameterized by SupportArchitectureMap
```

The `Order` aggregate arrives fully worked: a `Result`-returning factory, invariants, guarded
mutations raising domain events, a child entity, soft-delete cascade, the caching pair, an
integration event through the outbox, `en-US` and `es` resource pairs, a REST controller, and two
Blazor pages.

Eight of those lines are load-bearing and quiet about it. Read the linked phase before you touch the
code around them:

| Know this | Because | Detail |
|---|---|---|
| `AddApplicationDecorators()` is the **last** DI call | decorators wrap handlers that already exist, and modules register theirs during `ModuleLoader` | [Phase 5](common-BUILD-BY-HAND.md#phase-5-compose-the-monolith-host-and-run-it) |
| the AppHost does `WaitFor(sql)`, never `WaitFor(db)` | the host creates the database at startup, so waiting on the database resource deadlocks at "Waiting" forever | [Phase 5](common-BUILD-BY-HAND.md#the-aspire-apphost) |
| the AppHost needs its `Properties/launchSettings.json` | without it the dashboard endpoints are never configured, and a missing dashboard presents as a hang | [Phase 5](common-BUILD-BY-HAND.md#the-aspire-apphost) |
| every module must appear in `IArchitectureMap` | a module missing from the map is **silently** not covered by the layering and isolation rules | [Phase 6](common-BUILD-BY-HAND.md#the-architecture-fitness-map-mandatory) |
| caching is a **pair**, matched by string prefix | a cacheable query and its invalidating commands are wired independently, and half a pair fails silently forever | [Phase 3](common-BUILD-BY-HAND.md#caching-is-a-pair-and-you-wire-both-halves) |
| the identifier alias is linked solution-wide | `OrderIdentifierType` is one `global using` made visible everywhere by a `Directory.Build.props` block; always use the alias, never the raw `int` | [Phase 1](common-BUILD-BY-HAND.md#directorybuildprops) |
| there is **one** concrete DbContext per engine | module contexts are abstract and only list `DbSet`s; never write a concrete per-module context | [Phase 3d](common-BUILD-BY-HAND.md#3d-infrastructure-ef-configuration-the-abstract-module-context-no-concrete-per-module-context) |
| `Result<T>` replaces exceptions for business failure | factories and handlers return it, and `HandleFailure` maps `ErrorType` to RFC 9457 ProblemDetails at the edge | [Phase 3e](common-BUILD-BY-HAND.md#3e-api-controller-and-error-mapping) |

---

## Add your next feature

**A vertical slice** (the path every feature follows) is one command, run from the module's
`UseCases` folder:

```bash
cd Source/Modules/Orders/Contoso.Support.Orders.Application/Orders/UseCases

dotnet new mmca-command -n CancelOrder --app Contoso.Support --module Orders --aggregate Order --domain-method Cancel

dotnet new mmca-query -n GetOrderByNumber --app Contoso.Support --module Orders --aggregate Order --child-collection Comments
```

Handlers, validators, and mappers are convention-scanned, so there is no DI registration to add.
Three things do need you.

**Write the `--domain-method` on your aggregate first.** The generated handler *calls* it, and the
scaffold cannot invent your business rule, so until the method exists the slice does not compile:
`'Order' does not contain a definition for 'Cancel'`. Here is the whole of it for `--domain-method
Cancel`, in the three files it touches.

A new lifecycle state needs a member. The scaffolded enum has four:

```csharp
// Source/Modules/Orders/Contoso.Support.Orders.Shared/Orders/OrderStatus.cs
public enum OrderStatus
{
    Open = 0,
    InProgress = 1,
    Resolved = 2,
    Closed = 3,
    Cancelled = 4,
}
```

The rule goes in the invariants class, not in the method, so it can be composed with
`Result.Combine` and asserted directly in a domain test:

```csharp
// Source/Modules/Orders/Contoso.Support.Orders.Domain/Orders/OrderInvariants.cs
public static Result EnsureStatusAllowsCancel(OrderStatus status, string source)
    => status is OrderStatus.Resolved or OrderStatus.Closed
        ? Result.Failure(Error.Invariant(
            code: "Order.Cancel.AlreadyFinished",
            message: "A resolved or closed order cannot be cancelled.",
            source: source,
            target: nameof(status)))
        : Result.Success();
```

And the method itself:

```csharp
// Source/Modules/Orders/Contoso.Support.Orders.Domain/Orders/Order.cs
public Result Cancel()
{
    if (Status == OrderStatus.Cancelled)
    {
        return Result.Success();
    }

    var validation = OrderInvariants.EnsureStatusAllowsCancel(Status, nameof(Cancel));
    if (validation.IsFailure)
    {
        return validation;
    }

    Status = OrderStatus.Cancelled;
    AddDomainEvent(new OrderChanged(DomainEntityState.Updated, Id));

    return Result.Success();
}
```

Four things in that shape are the conventions, not decoration. It returns `Result` rather than
throwing, which is what lets the handler short-circuit on `IsFailure` and the edge map the failure to
RFC 9457 ProblemDetails. Cancelling an already-cancelled order succeeds rather than failing, so a
retried command is not an error. `AddDomainEvent` is what makes the change observable in-process
after `SaveChanges`. And the mutation goes through the aggregate, never through the handler setting
`Status` itself. `ChangeStatus` in
[Phase 3a](common-BUILD-BY-HAND.md#3a-domain-aggregate-invariants-events) is the same shape with a
different rule.

**Name a child collection when the handler needs one eager-loaded.** Both slices load through
`GetByIdAsync`, whose `includes:` argument is required, so there is always a list. The
`--child-collection Comments` above names the one collection a scaffolded `Order` owns; pass whichever
navigation that handler needs, and pass a name your aggregate actually has, since this is the argument
that ends up inside `nameof(...)`. Leave the parameter off and the handler passes an empty list, which
is what you want when the command only touches the aggregate root.

**Keep the query's `CacheKey` inside your module's `*CacheKeys.Prefix`,** because a key that drifts
out of the prefix goes stale silently.

**A second module** across all five layers plus its test and migrations projects:

```bash
dotnet new mmca-module -n Billing --app Contoso.Support --aggregate Invoice
```

`dotnet new` cannot patch files that already exist, so it **prints five wire-ups** for you to apply:
the solution entries, the host and architecture-test project references, the identifier-alias link,
the five architecture-map lines, and `AddErrorResources`. Until they are done the module is invisible
to the host and to the fitness rules. The [templates guide](common-TEMPLATES.md) lists each one with
its exact command.

---

## Then what

- **Upgrade the framework.** Bump every `MMCA.Common.*` entry in `Directory.Packages.props` together,
  in one pass. See [Phase 7](common-BUILD-BY-HAND.md#phase-7-upgrading-the-framework-version) and the
  [versioning policy](common-VERSIONING.md).
- **Add real authentication.** Copy MMCA.Store's or MMCA.ADC's Identity module and rename the
  namespaces (Store's is local-credential + RS256 only, the simpler base), set
  `Authentication:JwtBearer:Authority`, and flip the controller back to `[Authorize]`. See
  [Phase 2](common-BUILD-BY-HAND.md#phase-2-scaffold-the-module-project-set).
- **Extract a module into its own service.** The generated solution already carries the plumbing (the
  `.Contracts` proto convention and the `.Service` OpenAPI block). Your module code does not change:
  only host wiring and transport are added. See
  [Phase 8](common-BUILD-BY-HAND.md#phase-8-extract-a-module-into-its-own-service-the-payoff).

---

## Verification checklist

1. `dotnet new mmca-app -n <YourApp>` produced a solution that **builds and tests green before you
   changed anything**.
2. `dotnet build <YourApp>.slnx` is warning-free (TreatWarningsAsErrors + five analyzers). This is
   the primary automatable gate.
3. `dotnet test --solution <YourApp>.slnx` passes all three projects with no database, including
   your own frozen integration-event contract.
4. `dotnet ef migrations add InitialCreate ...` succeeds and generates your aggregate, its child
   entity, and the per-database `OutboxMessages` table.
5. Run interactively: the dashboard shows `sql`, `web`, and `ui` healthy; a `POST` then `GET` returns
   201 then 200 with audit fields stamped, soft-deleted rows filtered, and an outbox row written.

---

## Where to look next

- **[Templates](common-TEMPLATES.md)**: every parameter of all four templates, dropping the Blazor UI
  host, and how the pack is built. [ADR-065](../adr/065-scaffolding-templates.md) explains why it is
  derived from the reference app rather than maintained beside it.
- **[Build by hand](common-BUILD-BY-HAND.md)**: the same solution, phase by phase, for retrofitting
  an existing solution or for understanding what you were handed.
- **[MMCA.Helpdesk](https://github.com/ivanball/MMCA.Helpdesk)**: the runnable reference app. It *is*
  the template content, staged at pack time, so what you generated is that repo under your own names.
- **The ADRs** ([index](../adr/README.md)): the *why* behind every pattern you just used.
- **The [onboarding guide](../onboarding/00-index.md)**: a type-by-type tour of the framework internals.
- **MMCA.ADC and MMCA.Store**: two complete, production apps to copy patterns from. ADC is the richer
  one (four modules, OAuth social login, SignalR notifications); Store is the simpler one.
