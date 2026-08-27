# Getting Started: Build a New App on MMCA.Common

MMCA.Common is a .NET 10 framework for DDD, Clean Architecture, and CQRS, shipped as a set of
lockstep-versioned NuGet packages (the authoritative list and count live in
[FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md)). Its core promise: **build a
modular monolith now, and extract a module into its own microservice later, without a rewrite.**

Standing that up by hand means 12 projects and roughly 6,600 lines before a line of your own
business logic, several of them load-bearing in ways nothing tells you about until much later. So
you do not type it. One command writes the whole thing, green:

```powershell
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

```powershell
dotnet new install MMCA.Templates
```

Four templates arrive: `mmca-app` (a whole solution), `mmca-module` (a business module across all
five layers), and `mmca-command` / `mmca-query` (a single vertical slice).

## 2. Generate the solution

```powershell
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

```powershell
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

```powershell
dotnet ef migrations add InitialCreate `
  --project Source/Hosting/Contoso.Support.Migrations.SqlServer.Orders `
  --startup-project Source/Hosting/Contoso.Support.Migrations.SqlServer.Orders `
  --context SQLServerDbContext
```

Always pass `--context SQLServerDbContext`. There is exactly one concrete context class per database
engine; module contexts are abstract and only declare their `DbSet`s
([ADR-006](../adr/006-database-per-service.md)). You get **one migrations project per (future)
service database** even while you are a monolith, which is what makes extraction later cost no
migration rework.

## 5. Run it

```powershell
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

**Using-directive and alias order.** `using Contoso.Support.Orders.Shared;` sorts above
`MMCA.Common.*`, but `using Zeta.App.Orders.Shared;` sorts below it, so no checked-in order survives
every name; `SA1211` is the same story for the identifier-alias file. Both ship as suggestions in a
marked `SCAFFOLD DELTA` block at the bottom of the generated `.editorconfig`, alongside `IDE0021`
(which is there for the shape flags: turning several axes off can leave the aggregate's private
constructor with a single statement). Sort them, then delete the whole block once you have stopped
scaffolding:

```powershell
dotnet format analyzers Contoso.Support.slnx --diagnostics SA1210 SA1211 --severity info
```

**Your integration-event wire contract.** Integration events cross service boundaries, so a renamed
or retyped property breaks consumers elsewhere. `IntegrationEventContractTestsBase` fails the build
on a silent reshape, but only against a contract **you** froze: its frozen literal lists members
alphabetically, so one inherited from a sample module is wrong the moment your aggregate is not
called `Ticket`. Add the subclass to `ArchitectureTests.cs`, run it once, and paste in what the
failure prints:

```powershell
dotnet test --project Tests/Architecture/Contoso.Support.Architecture.Tests/Contoso.Support.Architecture.Tests.csproj `
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

```powershell
cd Source/Modules/Orders/Contoso.Support.Orders.Application/Orders/UseCases

dotnet new mmca-command -n TransferOrder --app Contoso.Support --module Orders --aggregate Order --domain-method TransferToRequester

dotnet new mmca-query -n GetOrderByNumber --app Contoso.Support --module Orders --aggregate Order --child-collection Comments
```

Handlers, validators, and mappers are convention-scanned, so there is no DI registration to add.
Four things do need you.

**Write the `--domain-method` on your aggregate first.** The generated handler *calls* it, and the
scaffold cannot invent your business rule, so until the method exists the slice does not compile:
`'Order' does not contain a definition for 'TransferToRequester'`. The example (the order was opened
on behalf of the wrong customer; move it) is deliberately not a status transition: the scaffolded
`ChangeStatus` already owns that axis, and a second door to the same state would let callers bypass
whichever rule the new method added. It moves `RequesterUserId`, a field the scaffold already
persists, so nothing changes in the Shared layer or the database. Here is the whole of it, in the
two files it touches.

The rule goes in the invariants class, not in the method, so it can be composed with
`Result.Combine` and asserted directly in a domain test. It reuses a rule the scaffold already
enforces for comments: `Closed` is terminal:

```csharp
// Source/Modules/Orders/Contoso.Support.Orders.Domain/Orders/OrderInvariants.cs
public static Result EnsureStatusAllowsTransfer(OrderStatus status, string source)
    => status == OrderStatus.Closed
        ? Result.Failure(Error.Invariant(
            code: "Order.Transfer.Closed",
            message: "A closed order cannot be transferred to another requester.",
            source: source,
            target: nameof(status)))
        : Result.Success();
```

And the method itself:

```csharp
// Source/Modules/Orders/Contoso.Support.Orders.Domain/Orders/Order.cs
public Result TransferToRequester(int requesterUserId)
{
    if (RequesterUserId == requesterUserId)
    {
        return Result.Success();
    }

    var validation = OrderInvariants.EnsureStatusAllowsTransfer(Status, nameof(TransferToRequester));
    if (validation.IsFailure)
    {
        return validation;
    }

    RequesterUserId = requesterUserId;
    AddDomainEvent(new OrderChanged(DomainEntityState.Updated, Id));

    return Result.Success();
}
```

Four things in that shape are the conventions, not decoration. It returns `Result` rather than
throwing, which is what lets the handler short-circuit on `IsFailure` and the edge map the failure to
RFC 9457 ProblemDetails. Transferring an order to the requester it already has succeeds rather than
failing, so a retried command is not an error. `AddDomainEvent` is what makes the change observable
in-process after `SaveChanges`. And the mutation goes through the aggregate, never through the
handler setting `RequesterUserId` itself. `ChangeStatus` in
[Phase 3a](common-BUILD-BY-HAND.md#3a-domain-aggregate-invariants-events) is the same shape with a
different rule.

**Give the command its payload.** `--domain-method` carries only a name, so the scaffolded record
holds just the aggregate id and the generated handler calls `order.TransferToRequester()` with no
arguments. Two one-line edits finish the slice: add the field to the command record, and pass it at
the call site (rewrite the scaffolded summary comments while you are in there; they describe the
delete slice the template is staged from):

```csharp
public sealed record TransferOrderCommand(OrderIdentifierType OrderId, int RequesterUserId) : ICacheInvalidating
```

```csharp
var result = order.TransferToRequester(command.RequesterUserId);
```

**Name a child collection when the handler needs one eager-loaded.** Both slices load through
`GetByIdAsync`, whose `includes:` argument is required, so there is always a list. The
`--child-collection Comments` above names the one collection a scaffolded `Order` owns; pass whichever
navigation that handler needs, and pass a name your aggregate actually has, since this is the argument
that ends up inside `nameof(...)`. Leave the parameter off and the handler passes an empty list, which
is what you want when the command only touches the aggregate root.

**Keep the query's `CacheKey` inside your module's `*CacheKeys.Prefix`,** because a key that drifts
out of the prefix goes stale silently.

**A second module** across all five layers plus its test and migrations projects:

```powershell
pwsh build/add-module.ps1 -Name Billing -Aggregate Invoice
```

That script ships inside every solution `mmca-app` generates. It runs `dotnet new mmca-module` (the
same shape options, as PowerShell switches) and then applies all seven wire-ups the template can only
print, because `dotnet new` cannot patch files that already exist: the solution entries, the host and
architecture-test project references, the identifier-alias link, the five architecture-map lines,
`AddErrorResources`, the module's own Aspire database and data-source routing, and the first EF
migration. Until those are done the module is invisible to the host and to the fitness rules. The
[templates guide](common-TEMPLATES.md) documents the script and lists each wire-up as the manual
fallback.

---

## Surface the slice at the edge

The scaffold stops at the handler, and the template's closing instructions tell you to map the
command in your module's controller. Every write in the generated app follows the same four touch
points, with `ChangeStatus` as the worked example to mirror in each one.

**A request record in Shared**, carrying only the payload; the order id comes from the route, the
same split `ChangeOrderStatusRequest` uses:

```csharp
// Source/Modules/Orders/Contoso.Support.Orders.Shared/Orders/TransferOrderRequest.cs
public sealed record TransferOrderRequest(int RequesterUserId);
```

**A controller endpoint.** Reads come from `EntityControllerBase`; writes inject their handler
directly. Add `ICommandHandler<TransferOrderCommand, Result> transferHandler` to the controller's
primary constructor and map it:

```csharp
/// <summary>Transfers an order to another requester.</summary>
[HttpPut("{id}/transfer")]
[ProducesResponseType(StatusCodes.Status204NoContent)]
[ProducesResponseType(StatusCodes.Status400BadRequest)]
[ProducesResponseType(StatusCodes.Status404NotFound)]
public async Task<IActionResult> TransferAsync(
    OrderIdentifierType id,
    TransferOrderRequest request,
    CancellationToken cancellationToken)
{
    ArgumentNullException.ThrowIfNull(request);

    var result = await transferHandler.HandleAsync(
        new TransferOrderCommand(id, request.RequesterUserId),
        cancellationToken).ConfigureAwait(false);
    return result.IsFailure ? HandleFailure(result.Errors) : NoContent();
}
```

The command returns plain `Result`, so success maps to `204 No Content`; a command that returns the
refreshed DTO maps to `Ok(result.Value)` the way `ChangeStatusAsync` does.

**A method on the typed client** (`SupportApiClient` in the UI host), which runs server-side and
reaches the API through Aspire service discovery, so there is no CORS and no token. The client
**returns a `Result` and throws nothing for a server answer**, so the method signature says it can
fail:

```csharp
public Task<Result> TransferOrderAsync(int id, int requesterUserId, CancellationToken cancellationToken = default) =>
    HttpResultExecutor.ExecuteAsync(
        async () =>
        {
            using var response = await httpClient
                .PutAsJsonAsync(string.Create(CultureInfo.InvariantCulture, $"/Orders/{id}/transfer"), new { RequesterUserId = requesterUserId }, cancellationToken)
                .ConfigureAwait(false);

            return await ProblemDetailsResultReader.ReadAsync(response, cancellationToken).ConfigureAwait(false);
        },
        cancellationToken);
```

The two halves are what make the signature honest.
`ProblemDetailsResultReader` (`MMCA.Common.Shared.Http`) converts the **response**: a 2xx is a
success, and anything else is parsed back out of the RFC 9457 body into the errors the server
described, with the original `ErrorType` preserved. `HttpResultExecutor` (`MMCA.Common.UI.Services`)
converts the **absence of a response**: a refused connection, a DNS failure, a dropped socket or a
client timeout becomes a failure coded `Http.TransportFailure` or `Http.Timeout` instead of an
exception. Your own cancellation still propagates, so a disposed component is never reported back
as an error to render.

A method that returns a value reads the same way, with the generic overload:

```csharp
public Task<Result<OrderDTO>> GetOrderAsync(int id, CancellationToken cancellationToken = default) =>
    HttpResultExecutor.ExecuteAsync(
        async () =>
        {
            using var response = await httpClient
                .GetAsync(new Uri(string.Create(CultureInfo.InvariantCulture, $"Orders/{id}"), UriKind.Relative), cancellationToken)
                .ConfigureAwait(false);

            return await ProblemDetailsResultReader.ReadAsync<OrderDTO>(response, cancellationToken: cancellationToken).ConfigureAwait(false);
        },
        cancellationToken);
```

Neither type needs registering: both are static, so the client just needs
`using MMCA.Common.Shared.Abstractions;` (for `Result`), `using MMCA.Common.Shared.Http;` and
`using MMCA.Common.UI.Services;`. The host still registers only
`AddHttpClient<SupportApiClient>(...)`.

**The page plus its resource pair.** Add a panel to `OrderDetail.razor` shaped like the Status one (a
`MudNumericField` for the new requester id and a button), with a `@code` handler shaped like
`ChangeStatusAsync`. Because the client returns a `Result`, the handler **branches instead of
catching**:

```csharp
var result = await Api.TransferOrderAsync(Id, _transferRequesterUserId);
if (result.IsSuccess)
{
    Snackbar.Add(L["Snackbar.Transferred"], Severity.Success);
    await LoadAsync();
}
else
{
    Snackbar.Add(L["Snackbar.TransferFailed", result.LocalizedErrorMessage(L) ?? string.Empty], Severity.Error);
}
```

`LocalizedErrorMessage` comes from `ResultUiExtensions` (`@using MMCA.Common.UI.Common` in
`_Imports.razor`); it composes the failure's distinct messages, most severe first, resolving each as
a resource key with pass-through, so a message the API already translated renders as-is. For a
result that carries a value, `result.TryGetValue(out var dto)` unwraps it inside the same
conditional. A form that wants an inline block rather than a snackbar can drop the shared
`<ErrorSummary Result="_result" Localizer="L" />` component into its markup instead, which renders
nothing when there is nothing to say.

Every new `L[...]` key needs an entry in **both** `OrderDetail.resx` and `OrderDetail.es.resx`; a
key missing from one language renders as the raw key name, not a fallback.

Two conventions pay off here without extra work. The command's `ICacheInvalidating` prefix means the
page's reload after a transfer reads fresh data, not a stale cache entry. And transferring a closed
order exercises the whole error pipeline end to end: the invariant fails, `HandleFailure` maps it to
RFC 9457 ProblemDetails, `ProblemDetailsResultReader` reads it back into a failed `Result` with its
category intact, and the snackbar shows "A closed order cannot be transferred to another requester."

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
- **[Build MMCA.ECommerce](common-ECOMMERCE-SAMPLE.md)**: the next step after this guide: the same
  scaffold taken to a two-module store (Products + Orders with line items), with the minimum
  hand-written code.
- **The ADRs** ([index](../adr/README.md)): the *why* behind every pattern you just used.
- **The [onboarding guide](../onboarding/00-index.md)**: a type-by-type tour of the framework internals.
- **MMCA.ADC and MMCA.Store**: two complete, production apps to copy patterns from. ADC is the richer
  one (four modules, OAuth social login, SignalR notifications); Store is the simpler one.
