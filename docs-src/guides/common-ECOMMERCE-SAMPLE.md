# Build MMCA.ECommerce: a Two-Module Store from the Templates

[MMCA.ECommerce](https://github.com/ivanball/MMCA.ECommerce) is the simplest e-commerce application
on the [MMCA.Common](https://www.nuget.org/packages?q=MMCA.Common) framework: a **Products** catalog
module and an **Orders** module with line items, behind a REST API host and a Blazor Server +
MudBlazor UI host, orchestrated by Aspire. No Identity module, no payment provider, no search: two
aggregates, wired end to end through all five layers, with the architecture fitness rules watching.

This guide builds it from nothing, and the point is *how little of it you type*. The
[getting-started guide](common-GETTING-STARTED.md) scaffolds one module and stops; this one takes
the same scaffold to a working two-module domain. `MMCA.Templates` 1.4.0 generates the solution,
both modules, the hosts, the tests, and the migrations projects, and the `build/add-module.ps1`
script it ships inside every generated app performs the wire-ups `dotnet new` cannot patch into
existing files. That leaves your hands on two things only: the domain code that is genuinely yours,
and the UI pages that show it. Every step below maps to real, build-verified code in the
[MMCA.ECommerce repo](https://github.com/ivanball/MMCA.ECommerce), so wherever this guide
abbreviates, the repo is the full answer.

---

## Before you start

- **.NET 10 SDK** (the framework targets `net10.0` with `LangVersion: preview`).
- **Docker Desktop** (Aspire provisions SQL Server as a container).
- **EF Core tools**: `dotnet tool install --global dotnet-ef`.
- Commands are shown for **PowerShell** (`pwsh`, cross-platform). Almost everything is plain
  `dotnet` CLI, so any shell works, but step 3 runs a `.ps1` script, so `pwsh` has to be on PATH.

`MMCA.Templates` **1.4.0** is the floor for this guide: `--title`, `--event-verb`, `--no-owner`,
`--no-description` and the shipped `build/add-module.ps1` all arrive in it, and each one deletes a
step the 1.3.0 version of this walkthrough asked you to do by hand.

No credentials, tokens, or extra feeds: `MMCA.Templates` and every `MMCA.Common.*` package restore
from nuget.org ([ADR-053](../adr/053-dual-registry-package-publishing.md)).

---

## 1. Install the template pack

```powershell
dotnet new install MMCA.Templates
```

## 2. Generate the solution with the Products module

```powershell
dotnet new mmca-app -n MMCA.ECommerce --module Products --aggregate Product `
  --flat --no-status --no-owner --title Name --event-verb Created
cd MMCA.ECommerce
```

Five options do most of this guide's old work. Three remove an axis the sample module has and a
catalog product does not: `--flat` generates no child collection at all (no child entity, DTO,
requests, mapper, EF configuration, `Add`/`Edit`/`Remove` slices, controller endpoints, identifier
alias, or tests), `--no-status` generates no status axis, and `--no-owner` generates no
`RequesterUserId` property, create-request field, validator rule, integration-event member, EF index,
UI field, or tests. The other two are renames: `--title Name` renames the aggregate's main text
property everywhere it is named (the property and its invariant, the `Product.Name.Empty` /
`Product.Name.TooLong` codes, the `NameMaxLength` constant, the DTO and request properties, the EF
column, the validator rule, the UI field and column resources, and the domain tests), and
`--event-verb Created` names the creation integration event, giving you
`ProductCreatedIntegrationEvent` and its `ProductCreatedHandler` consumer rather than the sample's
`Opened` pair. Together they are the entire rename pass this guide used to spend a section on, so
step 4 has exactly one property left to add.

One command, and the whole monolith exists: the Products module across Shared, Domain, Application,
Infrastructure, and API, the REST host, the Blazor UI host, the Aspire AppHost, a migrations project
for the module's database, three test projects including the architecture fitness rules, and
`build/add-module.ps1`.

Get your green baseline before changing anything:

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test  --solution MMCA.ECommerce.slnx
```

That is a warning-free build under five analyzers at error severity and **81 passing tests**, with no
database needed. (The unflagged scaffold ships more, because each axis carries tests of its own; 81
is the flat, status-less, owner-less baseline.) This is the line you bisect against later.

## 3. Add the Orders module

```powershell
pwsh build/add-module.ps1 -Name Orders -Aggregate Order -Child Item `
  -NoOwner -NoDescription -Title CustomerName -EventVerb Placed -SkipMigration
```

`build/add-module.ps1` ships inside the solution you just generated. It runs
`dotnet new mmca-module` with the shape flags passed through (its PowerShell parameters map one for
one onto the template's options), and then performs every wire-up the template can only print. Run it
from the solution root: it refuses to run anywhere else, and everything else about the solution (its
name, which is also the root namespace, the module already here, the web host, the AppHost, the
architecture-test project and its map) it discovers at run time.

The flags: `-Child Item` renames the child concept, so the type is `OrderItem` with an
`OrderItemDTO`, `AddItem` / `EditItem` / `RemoveItem` slices, `/items` routes, and an
`OrderItemIdentifierType` alias; `-Title CustomerName` and `-EventVerb Placed` are the two renames;
`-NoOwner` and `-NoDescription` drop the two axes an order does not need. Orders keeps the status
axis, because an order genuinely has a lifecycle, so `-NoStatus` is deliberately absent. `EditItem`
is the one generated name that does not survive the reshape: an order line is not edited freely, only
re-quantified, so step 5 renames that slice to `ChangeItemQuantity`. `-SkipMigration` is deliberate
too: without it the script creates the Orders migration immediately, against the still-unreshaped
scaffold, and step 7 would delete and regenerate it anyway.

### What the script just wired

The run prints each edit as it lands, and `git diff` shows six existing files touched: the eight new
projects in `MMCA.ECommerce.slnx`; the Orders `ProjectReference`s on the web host and **all five**
layers on the architecture-test project; the identifier-alias `<Compile Include ... Link>` block in
`Directory.Build.props`; five `Module(...)` lines in `ECommerceArchitectureMap.cs`, without which the
layering and isolation rules silently stop covering the module
([ADR-015](../adr/015-architecture-fitness-functions.md)); the
`services.AddErrorResources<OrdersErrorResources>();` call in the web host's `Program.cs`, the one
registration the host still owns because `ModuleLoader` discovers the `IModule` itself; and the
AppHost plus `appsettings.json` database wiring below. Every edit is anchored on something the
scaffold generated, and a missing anchor aborts the run with the manual edit printed instead, so a
half-wired solution is never the outcome of a silent skip. The
[templates guide](common-TEMPLATES.md) documents the script in full.

### The database wiring, and why it is per module

Every module database carries its own `OutboxMessages`/`InboxMessages` tables in `dbo`, so two
modules migrated into one database collide on them. One database per module is also exactly the
topology that makes extraction free later
([ADR-006](../adr/006-database-per-service.md)). In
[the AppHost](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosting/MMCA.ECommerce.AppHost/Program.cs)
the script added `sql.AddDatabase("ecommerce-orders", "ECommerce_Orders")` and chained
`.WithSQLServerDataSource(ordersDb, "Orders")` onto the web project. Note what it did **not** do: the
first module keeps the database the scaffold gave it, so the pair is `ecommerce` / `ECommerce` for
Products, not a matched `_Products` / `_Orders` set. The `WaitFor(sql)` on the web project stays as
generated: the host CREATES the databases via EF `Migrate` at startup, so waiting on a database
resource would deadlock, because it never exists until the app that is waiting runs.

In
[appsettings.json](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/MMCA.ECommerce.Web/appsettings.json)
the script enabled the module under `Modules` and added a `DataSources` section with an entry per
module, each holding a connection string (derived from the one already there with the database name
swapped) and that module's `SQLServerMigrationsAssembly`. Those connection strings are the
design-time and no-Aspire fallback: under Aspire every `WithSQLServerDataSource` call overrides them,
which is why the Products module actually lands in `ECommerce` and not in the `ECommerce_Products`
the file names. The migrations assembly per entry is what matters in both modes.

Two normalizations in the same file are easy to miss and expensive to omit, and the script does both.
First, the top-level `SQLServerMigrationsAssembly` pin is **deleted** (the connection string itself
stays: it is the `Default` fallback the `[Required]` validation and health checks use). The scaffold
pinned the Products assembly there because it had one module and no `DataSources` section. With two
modules under Aspire, every `WithSQLServerDataSource` call also rewrites the top-level connection
string and the last one wins, so one module always collapses onto `Default`; a top-level pin naming
the *other* module's assembly then fails startup with "conflicting SQLServerMigrationsAssembly
values". Second, a top-level `"Outbox": { "DatabaseName": "Products" }` is added, pinning where
handler-published integration events are written. `IEventBus` persists them to ONE configured outbox
source per host, defaulting to `Default`, and `Default` is whichever module's call ran last. Pinned
to the first module, event publishing no longer depends on wiring order (and, mid-guide, a created
Product does not try to outbox into the not-yet-migrated Orders database).

Build and test again: still green, now at **99 tests** with the Orders module's scaffolded suites
included. There is no new kind of thing in the solution, just a second copy of the shape you already
had, this time with its child collection and status axis intact. Neither database has a schema until
step 7 creates the migrations.

## 4. Reshape Products into a catalog product

The scaffolded module arrives as the template's worked example in *your* namespaces, already shaped
by the flags in step 2: no children, no status, no requester, `Name` instead of `Title`, and a
`ProductCreated` event. What is left is a single property: a catalog entry is `Name`,
`Description`, **`Price`**, and `Price` is the one thing no flag could have generated, because the
invariant it needs is yours.

Every convention stays: `Result`-returning factory, invariants composed with `Result.Combine`,
guarded mutations raising domain events, the caching pair, the integration event through the outbox.

Each table below is one layer's edit sequence, top to bottom: Shared first (every layer above
compiles against those contracts), then Domain, Application, Infrastructure, API, and the tests.
"Replace with" means the linked file is the whole finished file from the build-verified sample, so
you can copy it as-is. All paths are relative to the solution root, and every command is PowerShell.

### 4.1 Shared contracts

Under `Source/Modules/Products/MMCA.ECommerce.Products.Shared/`:

| File | Action | What changes |
|---|---|---|
| `Products/`[ProductDTO.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/ProductDTO.cs) | edit | one line: `public required decimal Price { get; init; }` |
| `Products/`[ProductUpdateRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/ProductUpdateRequest.cs) | edit | `Price` is `required` like the other two, so a client cannot silently blank a price by omitting it. Keep the `*UpdateRequest` suffix exactly: the shared `UpdateRequestsAreConcurrencyAware` fitness rule finds it by name, and a rename silently drops the request out of that rule's scope |
| `Products/IntegrationEvents/`[ProductCreatedIntegrationEvent.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/IntegrationEvents/ProductCreatedIntegrationEvent.cs) | edit | the event was generated carrying the product id alone; it gains `Name` and `Price` |

### 4.2 Domain

Under `Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/`:

| File | Action | What changes |
|---|---|---|
| [ProductInvariants.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/ProductInvariants.cs) | edit | the two string rules arrive correct; `EnsurePriceIsValid` is new |
| [Product.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/Product.cs) | replace with | the `Price` property, the private constructor, the `Create` factory, and `UpdateDetails` |

The string rules still delegate to the framework's `CommonInvariants`, so each field keeps its
distinct empty vs too-long error code. The price is the only app-specific rule, and the one part of
[ProductInvariants.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/ProductInvariants.cs)
worth reading rather than pasting:

```csharp
    public static Result EnsurePriceIsValid(decimal price, string source)
        => price <= 0
            ? Result.Failure(Error.Invariant(
                code: "Product.InvalidPrice",
                message: "Product price must be greater than zero.",
                source: source,
                target: nameof(price)))
            : Result.Success();
```

The aggregate is the other one. This is an **excerpt** of
[Product.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/Product.cs)
(`/* ... */` marks elided bodies): a `Result`-returning factory that accumulates every invariant
before it constructs anything, and a guarded mutation that raises its domain event only once the
validation passed. Note what is deliberately absent: there is no "Added" domain event, because the id
is database-generated and would still be 0 at factory time, which is why creation is signalled after
the commit by `ProductCreatedIntegrationEvent` instead.

```csharp
[IdValueGenerated]
public sealed class Product : AuditableAggregateRootEntity<ProductIdentifierType>
{
    public string Name { get; private set; }
    public string Description { get; private set; }
    public decimal Price { get; private set; }

    /* private Product(name, description, price) assigns the three fields */

    public static Result<Product> Create(
        ProductIdentifierType? id,
        string name,
        string description,
        decimal price)
    {
        var validation = Result.Combine(
            ProductInvariants.EnsureNameIsValid(name, nameof(Create)),
            ProductInvariants.EnsureDescriptionIsValid(description, nameof(Create)),
            ProductInvariants.EnsurePriceIsValid(price, nameof(Create)));
        if (validation.IsFailure)
        {
            return Result.Failure<Product>(validation.Errors);
        }

        /* construct with Id = isIdValueGenerated ? default : id!.Value, raise NO domain event */
        return Result.Success(product);
    }

    public Result UpdateDetails(string name, string description, decimal price)
    {
        /* the same three invariants, combined and returned on failure, then: */
        Name = name;
        Description = description;
        Price = price;
        AddDomainEvent(new ProductChanged(DomainEntityState.Updated, Id));

        return Result.Success();
    }

    /* Delete() calls base.Delete(), then raises ProductChanged(DomainEntityState.Deleted, Id) */
}
```

### 4.3 Application

Under `Source/Modules/Products/MMCA.ECommerce.Products.Application/`:

| File | Action | What changes |
|---|---|---|
| `Products/UseCases/Create/`[ProductCreateRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequest.cs) | edit | the create command gains `Price` |
| `Products/UseCases/Create/`[ProductCreateRequestMapper.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequestMapper.cs) | edit | the factory call gains `price:` (fragment below). The scaffold keeps that call on one line and says why in a comment: an argument list cannot lose a middle element to a whole-line conditional, so the staging script rewrites it per shape. Once the shape is yours, the comment goes with it |
| `Products/UseCases/Create/`[ProductCreateRequestValidator.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequestValidator.cs) | edit | one rule, `RuleFor(x => x.Price).GreaterThan(0m);`. The other two mirror the invariants and reuse their constants, so a limit is stated once |
| `Products/UseCases/Create/`[CreateProductHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/CreateProductHandler.cs) | edit | the whole write path on one screen, worth reading rather than just pasting: domain factory, unit of work, then the integration event published *after* the commit, now carrying the name and the price |
| `Products/UseCases/Update/`[UpdateProductCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductCommand.cs) | edit | a fourth positional parameter, `decimal Price`; the client's last-seen `RowVersion` ([ADR-035](../adr/035-optimistic-concurrency.md)) stays as generated |
| `Products/UseCases/Update/`[UpdateProductCommandValidator.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductCommandValidator.cs) | create | the scaffold validates only the create path, and a catalog that accepts a negative price on update is a catalog with a hole in it |
| `Products/UseCases/Update/`[UpdateProductHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductHandler.cs) | edit | `UpdateDetails` takes a third argument now: `var result = product.UpdateDetails(command.Name, command.Description, command.Price);` |
| `Products/IntegrationEventHandlers/`[ProductCreatedHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/IntegrationEventHandlers/ProductCreatedHandler.cs) | edit | the consumer arrives generated and wired; it logs the new `Name` too, and it is where a search-index, notification, or analytics side effect would live |

The `ProductCreateRequestMapper` fragment:

```csharp
        return Task.FromResult(Product.Create(
            id: null,
            name: request.Name,
            description: request.Description,
            price: request.Price));
```

Both the Delete and GetById handlers resolve their repository through `IUnitOfWork`, never by
constructor-injecting `IRepository<,>`: a directly injected repository is not enlisted in the unit of
work's transaction, and mocks happily hide the difference until a real database run. The scaffold
already does this; keep it.

**Doc-comment-only touch-ups**, if you want a tree identical to the sample's, none of which changes
behavior: `--flat` removes the child collection but leaves four summaries in `UseCases/Delete/` and
`UseCases/GetById/` still mentioning children, the
[identifier-alias file](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Shared/MMCA.ECommerce.Products.GlobalUsings.IdentifierType.cs)
still speaks of aliases in the plural where it now declares one,
[ProductChanged.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/DomainEvents/ProductChanged.cs)
says the event fires on creation (it does not), and the populator comment in
[DependencyInjection.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/DependencyInjection.cs)
can now say the aggregate is a leaf rather than merely un-eager-loaded.

### 4.4 Infrastructure

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Infrastructure/Persistence/EntityConfiguration/ProductConfiguration.cs`
([finished file](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Infrastructure/Persistence/EntityConfiguration/ProductConfiguration.cs)).
`base.Configure` still supplies the id, the soft-delete flag and its query filter, the audit columns,
and the concurrency token, so only the product's own columns are there. Three additions: a
`using Microsoft.EntityFrameworkCore;` (which `HasColumnType` needs), `Price` as `decimal(18,2)`
explicitly, because SQL Server's default for a mapped decimal is `decimal(18,0)` and would round
every price to whole currency units, and a filtered index on `Name`, which is what a catalog is
actually browsed by. Nothing else in Infrastructure changes: `--flat` already emitted a
`ModuleApplicationDbContext` with one `DbSet`.

### 4.5 API

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.API/Controllers/ProductsController.cs`
([finished file](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.API/Controllers/ProductsController.cs)).
The routes, the injected handlers, and the inherited list/paged reads are all unchanged. One line of
real code changes, the command construction in `UpdateAsync`:

```csharp
            new UpdateProductCommand(id, request.Name, request.Description, request.Price) { RowVersion = request.RowVersion },
```

The rest is wording: the class summary says "support products" and the three action summaries still
mention children and a generic "editable details".

**Edit** the two error-resource files,
[ProductsErrorResources.resx](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.resx)
and
[ProductsErrorResources.es.resx](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.es.resx).
Keep the resx envelope exactly as generated (the `<xsd:schema>` block and the four `<resheader>`
elements) and touch only the `<data>` elements. `--title Name` already named the four scaffolded
codes correctly, so the English file needs a single new entry; the Spanish file needs that entry plus
a pass over the four it shipped, because the template's token substitution left them saying "del
product" and "el titulo" where the property is now a name:

| `data name` | `.resx` value (en) | `.es.resx` value (es) |
|---|---|---|
| `Product.Description.Empty` | Product description cannot be empty. | La descripción del producto no puede estar vacía. |
| `Product.Description.TooLong` | Product description cannot exceed 4000 characters. | La descripción del producto no puede superar los 4000 caracteres. |
| `Product.Name.Empty` | Product name cannot be empty. | El nombre del producto no puede estar vacío. |
| `Product.Name.TooLong` | Product name cannot exceed 200 characters. | El nombre del producto no puede superar los 200 caracteres. |
| `Product.InvalidPrice` | Product price must be greater than zero. | El precio del producto debe ser mayor que cero. |

Every code here is one an invariant in 4.2 actually emits, and an unmapped code degrades gracefully
to its English message, so a typo shows up as English text in a Spanish browser rather than as an
exception. Each entry is a `<data name="..." xml:space="preserve">` element wrapping a single
`<value>`, exactly like the ones you are editing. The
[anchor type's](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.cs)
doc comment cites `"Product.Name.Empty"` as its example; the sample points it at
`"Product.InvalidPrice"` instead, purely so the example is the code you just wrote.

At this point the solution builds again. The tests do not yet.

### 4.6 Tests

**Edit** [MMCA.ECommerce.Products.Application.Tests.csproj](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/MMCA.ECommerce.Products.Application.Tests.csproj).
The handler tests need the framework's test base and a mocking library, neither of which the
application-test scaffold references. Add two lines at the top of the package `ItemGroup` so it reads:

```xml
  <ItemGroup>
    <PackageReference Include="MMCA.Common.Testing" />
    <PackageReference Include="Moq" />
    <PackageReference Include="xunit.v3" />
```

No version attributes: both packages are already pinned in the solution's `Directory.Packages.props`
under Central Package Management, so a version here would be an error rather than a nicety. Then the
test files themselves, under `Tests/Modules/Products/`:

| File | Action | What it covers |
|---|---|---|
| `MMCA.ECommerce.Products.Domain.Tests/Products/`[ProductTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Products/MMCA.ECommerce.Products.Domain.Tests/Products/ProductTests.cs) | replace with | 13 tests over the aggregate. Read the accumulation test near the end: `Result.Combine` reports every broken invariant at once, which is the behavior that makes one round trip enough for a form |
| `MMCA.ECommerce.Products.Application.Tests/Caching/`[ProductCacheInvalidationTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/Caching/ProductCacheInvalidationTests.cs) | edit | the 4 scaffolded tests still pass; their fixtures gain a price and become a catalog product instead of a support ticket. The last one earns its keep: nothing at compile time ties a command's `CachePrefix` to a query's `CacheKey`, so this is what stops a rename from quietly leaving stale reads behind |
| `MMCA.ECommerce.Products.Application.Tests/UseCases/`[CreateProductHandlerTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/UseCases/CreateProductHandlerTests.cs) | create | 3 tests: the request maps through the domain factory, the aggregate is added and committed, and the integration event is published AFTER the save so it carries the database-generated id |
| `MMCA.ECommerce.Products.Application.Tests/UseCases/`[UpdateProductHandlerTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/UseCases/UpdateProductHandlerTests.cs) | create | 4 tests: a missing aggregate is a NotFound failure, an invariant breach never reaches the save, and the client's concurrency token is stamped back per ADR-035 before the mutation |
| `MMCA.ECommerce.Products.Application.Tests/UseCases/`[DeleteProductHandlerTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/UseCases/DeleteProductHandlerTests.cs) | create | 2 tests: the aggregate is loaded tracked, soft-deleted through its own guarded method, and committed once |
| `MMCA.ECommerce.Products.Application.Tests/UseCases/`[GetProductByIdHandlerTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/UseCases/GetProductByIdHandlerTests.cs) | create | 3 tests; its `GetReadRepository` assertion is what pins the read path to a non-tracking read |

The four handler classes all extend the framework's `HandlerTestBase<THandler>`, whose
`RegisterRepository` wires a mocked repository into a mocked unit of work, so the handler resolves it
exactly the way it does at run time.

### 4.7 Verify the Products reshape

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test --project Tests/Modules/Products/MMCA.ECommerce.Products.Domain.Tests/MMCA.ECommerce.Products.Domain.Tests.csproj
dotnet test --project Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/MMCA.ECommerce.Products.Application.Tests.csproj
```

Expect a warning-free build (five analyzers at error severity, `TreatWarningsAsErrors`), then
**13/13** passing in the Products domain suite and **16/16** in the Products application suite. No
database is involved in either.

To run a single class or method, pass a Microsoft Testing Platform filter **after a bare `--`**;
these projects are MTP, not VSTest, so a VSTest-style `--filter` before the separator silently runs
zero tests and still exits non-zero:

```powershell
dotnet test --project Tests/Modules/Products/MMCA.ECommerce.Products.Domain.Tests/MMCA.ECommerce.Products.Domain.Tests.csproj -- --filter-class "*ProductTests*"
```

The full solution run is still red at this point: the Orders module is untouched, and its scaffolded
suites are about to be replaced in step 5.

## 5. Reshape Orders into an order with line items

Orders keeps the child-collection pattern the template scaffolded, retargeted. `-Child Item` already
did the naming (the entity is `OrderItem`, the slices are `AddItem` / `EditItem` / `RemoveItem`, the
routes are `/items`), `-Title CustomerName` already named the text property, and `-EventVerb Placed`
already produced `OrderPlacedIntegrationEvent`. What is left is the domain itself: the free-form
status becomes a lifecycle, and the child entity becomes a snapshot of something another module owns.

Two decisions here carry the architecture lesson of the whole sample:

- **`OrderItem` snapshots `ProductId`, `ProductName`, and `UnitPrice` at add time.** The Orders
  module has **zero** references to the Products module: the module isolation fitness rule fails the
  build otherwise. What a customer ordered at yesterday's price is historical fact, so the snapshot
  is not denormalization guilt: it is the correct domain model, and it is what keeps the module
  extractable into its own service ([ADR-008](../adr/008-service-extraction-topology.md)).
- **Item mutations are Pending-only, enforced by an invariant** (`Order.ItemsLocked`), and status
  transitions follow a guarded lifecycle (`Order.InvalidStatusTransition`). Both surface through the
  whole error pipeline: `Result.Failure` in the domain, RFC 9457 ProblemDetails at the edge, a
  localized snackbar message in the UI.

The phase order matches step 4, with Infrastructure pulled up ahead of Application: Orders grows new
types rather than only renaming them, and it is easier to settle the entities and their mapping before
the slices that orchestrate them. The scaffolded before-state, for orientation: `OrderItem` carries
`Body` and `AuthorUserId`, and `OrderStatus` is `Open` / `InProgress` / `Resolved` / `Closed`.

### 5.1 Shared contracts

The identifier aliases need no edit: `-Child Item` emitted both `OrderIdentifierType` and
`OrderItemIdentifierType`, and the one thing that is off about that file (their sort order) is what
the `SA1211` fixup in step 8 settles. Under
`Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/`:

| File | Action | What changes |
|---|---|---|
| [OrderStatus.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderStatus.cs) | replace with | the scaffold ships a flat set of ticket states; this is a lifecycle (`Pending`, `Paid`, `Shipped`, `Cancelled`), and its doc comment is where the legal transitions are written down for a reader who will not go looking for the invariant |
| [OrderDTO.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderDTO.cs) | edit | `Total` is new. Its remarks are load-bearing documentation, not decoration: only the detail read eager-loads `Items`, so `Total` is 0 on the list and paged projections, and the fix for a caller who needs the number is to ask the detail endpoint, not to widen the list query |
| [OrderItemDTO.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderItemDTO.cs) | replace with | the scaffold's `Body` and `AuthorUserId` become the four snapshot properties |
| [OrderUpdateRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderUpdateRequest.cs) | edit | doc-only, but the `*UpdateRequest` suffix must survive: the shared `UpdateRequestsAreConcurrencyAware` fitness rule matches on that name |
| [AddOrderItemRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/AddOrderItemRequest.cs) | create | read its doc comment: the caller supplies the name and price to snapshot, and that is the wire-level half of the module-isolation decision above |
| [ChangeOrderItemQuantityRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/ChangeOrderItemQuantityRequest.cs) | create | replaces the scaffold's free-text `EditItemRequest(string Body)` |
| `IntegrationEvents/`[OrderPlacedIntegrationEvent.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/IntegrationEvents/OrderPlacedIntegrationEvent.cs) | edit | the event name and its consumer arrived generated; the payload gains `CustomerName` |
| `AddItemRequest.cs`, `EditItemRequest.cs` | delete | the two the new request records replace |

[ChangeOrderStatusRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/ChangeOrderStatusRequest.cs)
stays exactly as generated: `record ChangeOrderStatusRequest(OrderStatus Status)` is already the right
shape, and the enum it names is the one you just rewrote.

```powershell
Remove-Item `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\AddItemRequest.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\EditItemRequest.cs
```

### 5.2 Domain

Under `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/`:

| File | Action | What changes |
|---|---|---|
| [OrderInvariants.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderInvariants.cs) | replace with | six methods and eight error codes: the two customer-name codes, the two product-name codes, the unit price, the quantity, the item lock, and the status transition. Every one of them is a code you will localize in 5.5 |
| [OrderItem.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderItem.cs) | replace with | `Body` and `AuthorUserId` become the four snapshot properties, and `EditBody` becomes `ChangeQuantity` |
| [Order.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/Order.cs) | replace with | a guarded `Status`, a computed `Total`, and item mutations that ask the status first |
| `DomainEvents/OrderChanged.cs` | leave | unlike Products, the scaffolded Orders event summary already reads correctly for an aggregate whose creation is signalled by an integration event |

`EnsureCustomerNameIsValid` is generated but its two messages are not quite English: `--title` is a
substring replacement, so the camel-case identifier form reaches the shipped prose and the message
arrives as "Order customerName cannot be empty." Fixing those two strings (and their resx twins in
5.5) is a documented one-line consequence of a multi-word `--title`, not a surprise.

The two app-specific rules at the bottom of `OrderInvariants` (`Order.ItemsLocked` and
`Order.InvalidStatusTransition`) are the invariant half of the second architecture decision. Its
transition switch lists every enum member explicitly rather than leaning on the discard arm, which is
both what `IDE0072` asks for and what turns adding a status into a compile-time prompt to decide where
it can go.

In [OrderItem.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderItem.cs),
`ProductId` is a plain `int`, deliberately not a `ProductIdentifierType` and deliberately not a
foreign key: the Orders module must not name a Products type at all. The four snapshot properties and
the comment above them are the point of the file:

```csharp
    // Product snapshot, not a live reference: the name and the price are copied in at the moment
    // the item is added, so a later catalog rename or repricing cannot rewrite what was ordered.
    // It is also what keeps this module free of any reference to the Products module: the caller
    // hands over the four scalars and the order owns them from then on.
    public int ProductId { get; private set; }

    public string ProductName { get; private set; }

    public decimal UnitPrice { get; private set; }

    public int Quantity { get; private set; }
```

Below is an **excerpt** of
[Order.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/Order.cs)
(`/* ... */` marks elided bodies and members). Three things to notice while pasting the real file:
every item mutation asks `EnsureStatusAllowsItemChanges` **first**, `Total` is computed rather than
stored (so it cannot drift from the lines), and re-asserting the current status is an idempotent no-op
success that raises no event, which is what makes a retried status call safe. The cascade soft-delete
in `Delete()` is the scaffold's, kept as generated.

```csharp
[IdValueGenerated]
public sealed class Order : AuditableAggregateRootEntity<OrderIdentifierType>
{
    public string CustomerName { get; private set; }

    public OrderStatus Status { get; private set; }

    private readonly List<OrderItem> _items = [];

    [Navigation(IsCollection = true)]
    public IReadOnlyCollection<OrderItem> Items => _items.AsReadOnly();

    /// <summary>
    /// The order total, derived from the live items rather than stored: a persisted copy is one
    /// more thing that can disagree with the rows it summarizes. Soft-deleted items are excluded,
    /// and <c>OrderConfiguration</c> tells EF to ignore this property so no column is mapped.
    /// It therefore reads 0 whenever the item collection was not loaded (the list query path).
    /// </summary>
    public decimal Total => _items.Where(i => !i.IsDeleted).Sum(i => i.UnitPrice * i.Quantity);

    /* private Order(customerName) sets the name and Status = OrderStatus.Pending; Create(id,
       customerName) validates the name and raises no "Added" event, because the Id is
       database-generated and still 0 there: OrderPlacedIntegrationEvent carries the real one */

    /* AddItem(id, productId, productName, unitPrice, quantity), ChangeItemQuantity(itemId,
       quantity) and RemoveItem(itemId) ALL open with
           OrderInvariants.EnsureStatusAllowsItemChanges(Status, nameof(...))
       and return its errors on failure. Then AddItem calls OrderItem.Create(...) and _items.Add,
       while the other two resolve the line through GetChildOrNotFound(_items, itemId, ...) and
       call item.ChangeQuantity(quantity) or item.Delete(). Each raises
       OrderChanged(DomainEntityState.Updated, Id) on success. UpdateDetails(customerName)
       validates the name and assigns it, with no status guard: renaming the customer is legal
       at any point in the lifecycle */

    public Result ChangeStatus(OrderStatus newStatus)
    {
        // Re-asserting the status the order already has is a no-op success, not a transition:
        // an at-least-once delivered command must not fail on its second arrival.
        if (Status == newStatus)
        {
            return Result.Success();
        }

        var validation = OrderInvariants.EnsureStatusTransitionIsValid(Status, newStatus, nameof(ChangeStatus));
        if (validation.IsFailure)
        {
            return validation;
        }

        Status = newStatus;
        AddDomainEvent(new OrderChanged(DomainEntityState.Updated, Id));

        return Result.Success();
    }

    /* Delete() calls base.Delete(), soft-deletes every live item, then raises the Deleted event */
}
```

### 5.3 Infrastructure

Under `Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/`:

| File | Action | What changes |
|---|---|---|
| [OrderConfiguration.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/OrderConfiguration.cs) | edit | `builder.Ignore(o => o.Total)`, a filtered index on `CustomerName`, and the `using Microsoft.EntityFrameworkCore;` those need. The customer-name column, the string-persisted status, and the items relationship all arrive generated |
| [OrderItemConfiguration.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/OrderItemConfiguration.cs) | replace with | the item's four columns; the `using Microsoft.EntityFrameworkCore;` at the top is new, because `HasColumnType` needs it |

Two lines are easy to skip and expensive to omit: `Status` is persisted as a **string** (that is the
scaffold's line, kept), so a later reordering of the enum cannot silently reinterpret stored rows, and
`builder.Ignore(o => o.Total)` keeps EF from trying to map the computed getter (without it the model
build fails outright). On the item, `UnitPrice` gets an explicit `decimal(18,2)` rather than the SQL
Server default, so a price never silently rounds on the way in. `ModuleApplicationDbContext` needs no
edit: `-Child Item` already declared `DbSet<OrderItem>` alongside `DbSet<Order>`.

### 5.4 Application

An order is placed empty and grows lines afterwards, so the create payload is just a customer name,
which is what `-NoDescription -NoOwner -Title CustomerName` already generated. Under
`Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/`:

| File | Action | What changes |
|---|---|---|
| `UseCases/Create/`[OrderCreateRequestMapper.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Create/OrderCreateRequestMapper.cs) | edit | the one-line factory call and its staging comment become the plain named-argument form (fragment below) |
| `UseCases/Create/`[CreateOrderHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Create/CreateOrderHandler.cs) | edit | one line of code, the published event: `new OrderPlacedIntegrationEvent(entity.Id, entity.CustomerName),`. The handler still publishes after the commit, so the database-generated id is populated by the time the event reaches consumers |
| `UseCases/Update/`[UpdateOrderCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Update/UpdateOrderCommand.cs) | edit | the positional list is already right; the scaffold's one-line form and its `<remarks>` about optional axes are what go |
| `UseCases/AddItem/`[AddItemCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/AddItem/AddItemCommand.cs) | replace with | the two scaffolded scalars become four, and the doc comment records why they travel on the command instead of being looked up |
| `UseCases/AddItem/`[AddItemHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/AddItem/AddItemHandler.cs) | edit | the aggregate call takes the four scalars (fragment below). It already returns `Result<OrderItemDTO>` and already loads `includes: [nameof(Order.Items)]` tracked, which is what lets the aggregate enforce the item lock and recompute the total, so neither changes |
| `UseCases/ChangeItemQuantity/`[ChangeItemQuantityCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/ChangeItemQuantity/ChangeItemQuantityCommand.cs) | create | quantity is the only mutable field on a line: the product snapshot and its price stay as captured |
| `UseCases/ChangeItemQuantity/`[ChangeItemQuantityHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/ChangeItemQuantity/ChangeItemQuantityHandler.cs) | create | loads the order tracked with its items, then changes the quantity through the aggregate root |
| `UseCases/EditItem/` | delete | the slice `ChangeItemQuantity` replaces (the folder holds two files) |
| `IntegrationEventHandlers/`[OrderPlacedHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/IntegrationEventHandlers/OrderPlacedHandler.cs) | edit | the consumer arrives generated and wired; it logs the new `CustomerName` too |

```csharp
        return Task.FromResult(Order.Create(
            id: null,
            customerName: request.CustomerName));
```

```csharp
        var result = order.AddItem(
            id: null,
            command.ProductId,
            command.ProductName,
            command.UnitPrice,
            command.Quantity);
```

```powershell
Remove-Item -Recurse `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\UseCases\EditItem
```

Nothing else in the Application layer moves. The Delete, GetById, RemoveItem and ChangeStatus slices,
the create validator, both DTO mappers, `OrderCacheKeys`, the audit domain-event handler, and
`DependencyInjection.cs` are all correct exactly as generated, because each of them talks about items
and none of them names a renamed field. Two more files carry doc-comment-only differences from the
sample ([OrderCreateRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Create/OrderCreateRequest.cs)
and [UpdateOrderHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Update/UpdateOrderHandler.cs)),
which you can skip.

### 5.5 API

**Replace** `Source/Modules/Orders/MMCA.ECommerce.Orders.API/Controllers/OrdersController.cs` with
[OrdersController.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.API/Controllers/OrdersController.cs).
The routes are unchanged, including `POST /Orders/{id}/items`, `PUT /Orders/{id}/items/{itemId}`, and
`DELETE /Orders/{id}/items/{itemId}`: `-Child Item` produced them. What changes is the injected
`ChangeItemQuantityCommand` handler in place of the `EditItemCommand` one, the action renamed from
`EditItemAsync` to `ChangeItemQuantityAsync`, and the two new request types.

**Edit** the two error-resource files,
[OrdersErrorResources.resx](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.resx)
and
[OrdersErrorResources.es.resx](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.es.resx).
Keep the resx envelope exactly as generated (the `<xsd:schema>` block and the four `<resheader>`
elements) and touch only the `<data>` elements: delete the three the reshape retires
(`Order.Closed`, `Order.Item.Body.*`), reword the two `Order.CustomerName.*` values the camel-case
substitution left as "customerName", and add the six new ones. The eight below, in this order, are
one entry per code `OrderInvariants` can emit, which is what makes the Pending-only lock and the
lifecycle guard reach the user in their own language rather than as a raw code:

| `data name` | `.resx` value (en) | `.es.resx` value (es) |
|---|---|---|
| `Order.CustomerName.Empty` | Order customer name cannot be empty. | El nombre del cliente del pedido no puede estar vacío. |
| `Order.CustomerName.TooLong` | Order customer name cannot exceed 200 characters. | El nombre del cliente del pedido no puede superar los 200 caracteres. |
| `Order.Item.ProductName.Empty` | Item product name cannot be empty. | El nombre del producto de la línea no puede estar vacío. |
| `Order.Item.ProductName.TooLong` | Item product name cannot exceed 200 characters. | El nombre del producto de la línea no puede superar los 200 caracteres. |
| `Order.InvalidUnitPrice` | Item unit price must be greater than zero. | El precio unitario de la línea debe ser mayor que cero. |
| `Order.InvalidQuantity` | Item quantity must be greater than zero. | La cantidad de la línea debe ser mayor que cero. |
| `Order.ItemsLocked` | Items can only be changed while the order is pending. | Las líneas solo se pueden modificar mientras el pedido está pendiente. |
| `Order.InvalidStatusTransition` | The order cannot move to that status from its current one. | El pedido no puede pasar a ese estado desde el estado actual. |

Each entry is a `<data name="..." xml:space="preserve">` element wrapping a single `<value>`, exactly
like the ones you are replacing. The module's `OrdersErrorResources.cs` anchor type needs no edit:
`-Title CustomerName` already made its example code the one that exists.

The solution builds again at this point.

### 5.6 Tests

**Edit** [MMCA.ECommerce.Orders.Application.Tests.csproj](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/MMCA.ECommerce.Orders.Application.Tests.csproj).
The handler tests mock the unit of work directly, so this project needs Moq (and nothing else new).
Add one entry to the package `ItemGroup` so it reads:

```xml
  <ItemGroup>
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="AwesomeAssertions" />
    <!-- Moq for the handler tier: the repository / unit-of-work / event-bus boundaries are faked so
         the handler tests stay database-free. Version is centrally pinned in Directory.Packages.props. -->
    <PackageReference Include="Moq" />
```

No version attribute: `Moq` is already pinned in the solution's `Directory.Packages.props` under
Central Package Management. Then the test files themselves, all under `Tests/Modules/Orders/`:

| File | Action | What it covers |
|---|---|---|
| `MMCA.ECommerce.Orders.Domain.Tests/Orders/`[OrderTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Orders/MMCA.ECommerce.Orders.Domain.Tests/Orders/OrderTests.cs) | replace with | 33 tests over the aggregate, the item lock, and the lifecycle. Keep the comment inside `Total_ExcludesSoftDeletedItems` verbatim: it documents a real consequence of database-generated ids (every unpersisted line still carries Id 0, so `GetChildOrNotFound` resolves the first live one), and without it the `RemoveItem(itemId: 0)` call below it looks like a mistake |
| `MMCA.ECommerce.Orders.Application.Tests/Caching/`[OrderCacheInvalidationTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/Caching/OrderCacheInvalidationTests.cs) | replace with | 4 tests. The last one enumerates **all seven** order commands, so a new slice added later without a `CachePrefix` is caught here rather than in production |
| `MMCA.ECommerce.Orders.Application.Tests/Orders/`[OrderHandlerTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/Orders/OrderHandlerTests.cs) | create | 19 tests, one class covering every Orders use case. Every handler in the module has the same shape, so one set of fakes covers all of them, and the shared `HandlerMocks` helper is what keeps the file from repeating that setup nine times |

### 5.7 Verify both reshapes

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test --project Tests/Modules/Orders/MMCA.ECommerce.Orders.Domain.Tests/MMCA.ECommerce.Orders.Domain.Tests.csproj
dotnet test --project Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/MMCA.ECommerce.Orders.Application.Tests.csproj
dotnet test --project Tests/Architecture/MMCA.ECommerce.Architecture.Tests/MMCA.ECommerce.Architecture.Tests.csproj
```

Expect a warning-free build, then **33/33** passing in the Orders domain suite, **23/23** in the
Orders application suite, and **72/72** in the architecture suite. No database is involved in any of
them.

That last run is the one worth watching, and it is only worth watching because *both* modules were
reshaped: a flat, status-less catalog module beside an aggregate that owns a growing child collection
and a guarded lifecycle is what makes the layering, module-isolation, and event-convention rules say
something. Two copies of the same generated shape would pass them vacuously. If it reds on isolation,
the cause is almost always an accidental `using` of a Products type inside Orders, which is exactly the
mistake the `ProductName` / `UnitPrice` snapshot exists to make unnecessary. Single-test runs need the
same MTP filter after a bare `--` as in 4.7, for example
`-- --filter-method "*ChangeStatus*"`.

The whole solution is green from here: `dotnet test --solution MMCA.ECommerce.slnx` runs everything in
one pass and lands at **157** tests (158 once step 8 freezes your integration-event wire contract).

## 6. Point the UI at the new domain

The scaffolded Blazor host already has the load-bearing parts: the typed
[ECommerceApiClient](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Services/ECommerceApiClient.cs)
calling the API server-side through Aspire service discovery (no CORS, no token), the
`en`/`es` resource pairs, and the theme/culture chrome. Reshape the Products pages to
Name/Description/Price, and add two Orders pages that mirror them. All four live under
`Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Pages/`:

- [Products.razor](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Pages/Products.razor)
  and
  [ProductDetail.razor](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Pages/ProductDetail.razor):
  the catalog list and the create/edit form, on Name/Description/Price.
- [Orders.razor](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Pages/Orders.razor)
  and
  [OrderDetail.razor](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Pages/OrderDetail.razor):
  create and list orders, then edit the customer name, walk the status lifecycle (the page offers
  only the transitions the domain allows), and manage items while the order is Pending. The add-item
  form is a product picker filled from `GetProductsAsync()`: selecting a product snapshots its id,
  name, and price into the request, which is the UI half of the module-isolation decision above.

Mirror the scaffold's page conventions when you write the Orders pages, because an older sample would
not have them: a page opens with `<PageHeading Text="@(L["Browser.Tab"].Value)" />` and marks its
panels with `<SectionHeading>` (both generated components, not MudBlazor ones), the delete dialog and
the required-field warning read the fixed chrome keys `Dialog.Delete.Heading` and
`Snackbar.RequiredFields`, and the required-field check accumulates one line at a time
(`missingRequired = missingRequired || string.IsNullOrWhiteSpace(_field);`) rather than as one
compound condition, so an optional axis can drop a line without breaking the expression.

Three files outside `Pages/` also move: the UI project needs a `ProjectReference` to
`MMCA.ECommerce.Orders.Shared` (contracts only, never a module's Application or Domain layer),
`Components/_Imports.razor` gains `@using System.Globalization` for the currency formatting, and
[MainLayout.razor](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Layout/MainLayout.razor)
gains the Products and Orders app-bar links. Every string goes through the `L[...]` localizer, and
every key needs an entry in both the `.resx` and `.es.resx` file beside the page; the
[UI host in the repo](https://github.com/ivanball/MMCA.ECommerce/tree/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web)
is the complete reference.

## 7. Create the migrations

Neither module has a migration yet: any shape flag makes `mmca-app` drop the template's sample
migration (it described the sample shape), and `-SkipMigration` in step 3 deferred the Orders one to
here. Each `Migrations` folder does carry an `.editorconfig` that keeps analyzer enforcement off
generated migration code; `dotnet ef` never creates that file, so leave it alone. Generate both
migrations fresh (`migrations add` never opens a database connection):

```powershell
dotnet ef migrations add InitialCreate `
  --project Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Products `
  --startup-project Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Products `
  --context SQLServerDbContext

dotnet ef migrations add InitialCreate `
  --project Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Orders `
  --startup-project Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Orders `
  --context SQLServerDbContext
```

Each migration creates its module's tables in the module schema plus that database's own
outbox/inbox tables: two databases, two outboxes, no contention.

## 8. The two one-time fixups, then run it

Apply the two fixups the scaffold deliberately leaves to you (they are name-dependent, so no
generated value could be right). First, sort the using directives and the identifier aliases:

```powershell
dotnet format analyzers MMCA.ECommerce.slnx --diagnostics SA1210 SA1211 --severity info
```

Then delete the `SCAFFOLD DELTA` block at the bottom of `.editorconfig`, which restores the full
analyzer baseline. It relaxes three rules, not two: `SA1210` and `SA1211` for the sort order the
command above just fixed, and `IDE0021` because a heavily flagged aggregate can end up with a private
constructor holding a single statement, which the baseline would require you to write as an
expression body. This sample never trips that: both aggregates assign at least two fields, so the
`IDE0021` line has nothing to relax and goes with the rest of the block.

Second, freeze your integration-event wire contract by adding the `IntegrationEventContractTests`
subclass to `ArchitectureTests.cs`, running it once, and pasting in what the failure prints. Both
fixups are described in full in the
[getting-started guide](common-GETTING-STARTED.md#6-the-two-one-time-fixups); the sample has both
applied, so its frozen list names `ProductCreatedIntegrationEvent` and `OrderPlacedIntegrationEvent`
exactly as shipped, and the suite goes from 72 to 73.

> **Re-running the walkthrough on the same machine?** The Aspire SQL container is persistent by
> design, so databases created by an earlier MMCA.ECommerce build survive a re-scaffold, and their
> migration history will not match your fresh migrations: startup then fails with "There is already
> an object named 'InboxMessages' in the database". Drop the stale `ECommerce*` databases (or
> remove the `sql-*` container in Docker) before the first run.

Then, from a **real, interactive terminal** (launched headless, the AppHost stalls at control-plane
init and looks like a hang):

```powershell
dotnet run --project Source/Hosting/MMCA.ECommerce.AppHost
```

The dashboard shows `sql`, `web`, and `ui`. Open **`ui`**: create a couple of products with prices,
place an order, add items from the product picker, watch the total, mark it Paid then Shipped, and
try to add an item afterwards to see the domain say no, in your browser's language. The app runs
issuer-less by design: no Identity module ships in this sample, the API is `[AllowAnonymous]`, and
adding real RS256/JWKS auth later is the getting-started guide's "Then what" path.

---

## Verification checklist

1. Baseline green immediately after `mmca-app`, before any edit: **81 tests**.
2. After `build/add-module.ps1`: still green at **99 tests**, both modules' scaffolded suites running.
3. After both reshapes: `dotnet build MMCA.ECommerce.slnx` warning-free and
   `dotnet test --solution MMCA.ECommerce.slnx` fully green (the sample lands at **158 tests**), with
   the architecture rules passing: layering, module isolation, event conventions, and your frozen
   wire contract.
4. Both `InitialCreate` migrations generated, each with its module's tables plus its own
   `OutboxMessages` table.
5. Interactively: products created, an order walked Pending to Shipped, items locked after Pending,
   and an outbox row written per placed order.

---

## Where to look next

- **[MMCA.ECommerce](https://github.com/ivanball/MMCA.ECommerce)**: the finished result of this
  guide, build- and test-verified.
- **[Getting started](common-GETTING-STARTED.md)**: the single-module path, the vertical-slice
  templates (`mmca-command` / `mmca-query`), and the framework-upgrade and extraction notes.
- **[Templates](common-TEMPLATES.md)**: every parameter of all four templates, plus
  `build/add-module.ps1`.
- **[Building by hand](common-BUILD-BY-HAND.md)**: what each generated file does and why.
- **[MMCA.Helpdesk](https://github.com/ivanball/MMCA.Helpdesk)**: the reference app the templates
  are staged from.
