# Build MMCA.ECommerce: a Two-Module Store from the Templates

[MMCA.ECommerce](https://github.com/ivanball/MMCA.ECommerce) is the simplest e-commerce application
on the [MMCA.Common](https://www.nuget.org/packages?q=MMCA.Common) framework: a **Products** catalog
module and an **Orders** module with line items, behind a REST API host and a Blazor Server +
MudBlazor UI host, orchestrated by Aspire. No Identity module, no payment provider, no search: two
aggregates, wired end to end through all five layers, with the architecture fitness rules watching.

This guide builds it from nothing, and the point is *how little of it you type*. The
[getting-started guide](common-GETTING-STARTED.md) scaffolds one module and stops; this one takes
the same scaffold to a working two-module domain. The `MMCA.Templates` pack generates the solution,
both modules, the hosts, the tests, and the migrations projects; your hands touch three things: the
wire-ups `dotnet new` cannot patch into existing files, the domain code that is genuinely yours, and
the UI pages that show it. Every step below maps to real, build-verified code in the
[MMCA.ECommerce repo](https://github.com/ivanball/MMCA.ECommerce), so wherever this guide abbreviates,
the repo is the full answer.

---

## Before you start

- **.NET 10 SDK** (the framework targets `net10.0` with `LangVersion: preview`).
- **Docker Desktop** (Aspire provisions SQL Server as a container).
- **EF Core tools**: `dotnet tool install --global dotnet-ef`.
- Commands are shown for **PowerShell** (`pwsh`, cross-platform). Almost everything is plain
  `dotnet` CLI, so any shell works; the one step where the shell genuinely matters (3a) says so
  inline. Plain cmd is the one to avoid: it cannot expand wildcards at all.

No credentials, tokens, or extra feeds: `MMCA.Templates` and every `MMCA.Common.*` package restore
from nuget.org ([ADR-053](../adr/053-dual-registry-package-publishing.md)).

---

## 1. Install the template pack

```powershell
dotnet new install MMCA.Templates
```

## 2. Generate the solution with the Products module

```powershell
dotnet new mmca-app -n MMCA.ECommerce --module Products --aggregate Product --flat --no-status
cd MMCA.ECommerce
```

Two flags do most of this guide's old work for you. `--flat` generates the module without a child
collection: no child entity, DTO, requests, mapper, EF configuration, `Add`/`Edit`/`Remove` slices,
controller endpoints, identifier alias, or tests. `--no-status` generates it without a status axis: no
status enum, no `ChangeStatus` slice, request or endpoint, no `Status` property, and no status
invariant or tests. A catalog product is exactly that shape: it is a leaf aggregate with no growable
children, and it has no lifecycle state, so asking for the sample's ticket-shaped child collection and
four-state enum only to delete them again is work with no payoff. Both flags arrived in
`MMCA.Templates` 1.3.0.

One command, and the whole monolith exists: the Products module across Shared, Domain, Application,
Infrastructure, and API, the REST host, the Blazor UI host, the Aspire AppHost, a migrations project
for the module's database, and three test projects including the architecture fitness rules.

Get your green baseline before changing anything:

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test  --solution MMCA.ECommerce.slnx
```

That is a warning-free build under five analyzers at error severity and **81 passing tests**, with no
database needed. (The unflagged scaffold ships more, because the child and status axes carry tests of
their own; 81 is the flat, status-less baseline.) This is the line you bisect against later.

## 3. Add the Orders module

```powershell
dotnet new mmca-module -n Orders --app MMCA.ECommerce --aggregate Order --child Item
```

`--child` renames the child concept throughout the generated module. The type it produces is
`<aggregate><child>`, so `--aggregate Order --child Item` gives you an `OrderItem` entity, an
`OrderItemDTO`, `AddItem` / `EditItem` / `RemoveItem` use-case slices, `/items` routes on the
controller, and an `OrderItemIdentifierType` alias. Nothing here needs a find-and-replace pass
afterwards. `EditItem` is the one name that does not survive the reshape: an order line is not edited
freely, only re-quantified, so step 5 renames that slice to `ChangeItemQuantity`. Orders keeps the
status axis, because an order genuinely has a lifecycle, so `--no-status` is deliberately absent here.
`--child` is ignored under `--flat`, which is why step 2 did not pass one.

Eight more projects appear (the five layers, two test projects, one migrations project). `dotnet new`
cannot patch files that already exist, so the template prints the wire-ups it needs from you. Its
first six printed items map one for one onto sub-steps a to f below, including the top-level `Outbox`
pin in 3f, and the printed solution command now carries a PowerShell no-glob form beside the bash
one; the seventh printed item is the first migration, which this guide defers to step 7 because both
modules get theirs in one pass there. Here they are, concretely, for this app:

**a. Add the projects to the solution.** `dotnet sln add` does not expand wildcards itself, so the
`Get-ChildItem` calls expand them before dotnet sees the paths (in bash, plain globs like
`Source/Modules/Orders/*/*.csproj` work directly):

```powershell
dotnet sln MMCA.ECommerce.slnx add (Get-ChildItem Source\Modules\Orders\*\*.csproj).FullName (Get-ChildItem Tests\Modules\Orders\*\*.csproj).FullName (Get-ChildItem Source\Hosting\MMCA.ECommerce.Migrations.SqlServer.Orders\*.csproj).FullName
```

Expect eight `Project ... added to the solution` lines.

**b. Reference the module from the host and the fitness tests.** In
`Source/Hosts/MMCA.ECommerce.Web/MMCA.ECommerce.Web.csproj`, add `ProjectReference`s to
`MMCA.ECommerce.Orders.API` and `MMCA.ECommerce.Migrations.SqlServer.Orders`. In
`Tests/Architecture/MMCA.ECommerce.Architecture.Tests/MMCA.ECommerce.Architecture.Tests.csproj`, add
`ProjectReference`s to **all five** Orders layer projects.

**c. Link the identifier alias solution-wide.** In `Directory.Build.props`, duplicate the Products
`<Compile Include ... Link>` block for
`Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\MMCA.ECommerce.Orders.GlobalUsings.IdentifierType.cs`
with `Condition="'$(MSBuildProjectName)' != 'MMCA.ECommerce.Orders.Shared'"`.

**d. Register the module in the architecture map.** Five lines in
`Tests/Architecture/MMCA.ECommerce.Architecture.Tests/ECommerceArchitectureMap.cs`, one per layer. A
module missing from the map is silently not covered by the layering and isolation rules.

**e. Register the error translations.** In `Source/Hosts/MMCA.ECommerce.Web/Program.cs`, next to the
Products line:

```csharp
services.AddErrorResources<OrdersErrorResources>();
```

**f. Give the module its own database.** Every module database carries its own
`OutboxMessages`/`InboxMessages` tables in `dbo`, so two modules migrated into one database would
collide on them. One database per module is also exactly the topology that makes extraction free later
([ADR-006](../adr/006-database-per-service.md)). In the AppHost:

```csharp
var productsDb = sql.AddDatabase("ecommerce-products", "ECommerce_Products");
var ordersDb = sql.AddDatabase("ecommerce-orders", "ECommerce_Orders");

// WaitFor the SQL server (healthy once the container accepts connections), not the database
// resource. The web host CREATES the database via EF Migrate at startup, so waiting on the
// database's existence would deadlock: it never exists until the app that is waiting runs.
var web = builder.AddProject<Projects.MMCA_ECommerce_Web>("web")
    .WithSQLServerDataSource(productsDb, "Products")
    .WithSQLServerDataSource(ordersDb, "Orders")
    .WaitFor(sql)
    .WithExternalHttpEndpoints();
```

And in `Source/Hosts/MMCA.ECommerce.Web/appsettings.json`, enable the module and map each logical
source to its connection string and migrations assembly (the `DataSources` section is the
database-per-module routing table; Aspire overrides the connection strings at run time):

```json
"Modules": {
  "Products": { "Enabled": true },
  "Orders": { "Enabled": true }
},
"DataSources": {
  "Products": {
    "SQLServerConnectionString": "Server=localhost;Database=ECommerce_Products;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True",
    "SQLServerMigrationsAssembly": "MMCA.ECommerce.Migrations.SqlServer.Products"
  },
  "Orders": {
    "SQLServerConnectionString": "Server=localhost;Database=ECommerce_Orders;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True",
    "SQLServerMigrationsAssembly": "MMCA.ECommerce.Migrations.SqlServer.Orders"
  }
}
```

In the same file, **delete the `SQLServerMigrationsAssembly` line from the top-level
`ConnectionStrings` section** (keep the connection string itself: it is the `Default` fallback the
`[Required]` validation and health checks use). The scaffold pinned the Products assembly there
because it had one module and no `DataSources` section. With two modules under Aspire, each
`WithSQLServerDataSource` call also rewrites the top-level connection string and the last one wins,
so one module always collapses onto the `Default` source; if `Default` still pins the *other*
module's migrations assembly, startup fails fast with "conflicting SQLServerMigrationsAssembly
values". Once every module declares its assembly in its own `DataSources` entry, the top-level pin
has no remaining job.

Finally, add a top-level `Outbox` section pinning where handler-published integration events are
written. `IEventBus` persists them to ONE configured outbox source per host, defaulting to
`Default`, and with two modules under Aspire `Default` is whichever module's connection string
happened to win the top-level slot. Pin it explicitly so event publishing does not depend on wiring
order (and so, mid-guide, a created Product does not try to outbox into the not-yet-migrated Orders
database and fail with "Invalid object name 'dbo.OutboxMessages'"):

```json
"Outbox": {
  "DatabaseName": "Products"
}
```

Build and test again: still green, now with the Orders module's scaffolded tests included. There is
no new kind of thing in the solution, just a second copy of the shape you already had, this time with
its child collection and status axis intact. If curiosity makes you run the app now, know that the
Orders database has no schema until step 7 creates its migration: Orders endpoints fail, and the
background outbox poller logs "Outbox processing failed for data source SQLServer/Default" every few
seconds until then. Harmless, and it stops on the first run after step 7.

## 4. Reshape Products into a catalog product

The scaffolded module arrives as the template's worked example (a title, a description, a requester
id): a placeholder domain in *your* namespaces, meant to be reshaped. The flags in step 2 already
removed the parts a catalog product would never own, so what is left is a genuine property reshape
rather than a demolition. Every convention stays: `Result`-returning factory, invariants composed with
`Result.Combine`, guarded mutations raising domain events, the caching pair, the integration event
through the outbox.

`Product` becomes the whole catalog entry: `Name`, `Description`, `Price`. Concretely, `Title` becomes
`Name` and the scaffold's `RequesterUserId` becomes a `decimal Price`. Each table below is one layer's
edit sequence, top to bottom: Shared first (every layer above compiles against those contracts), then
Domain, Application, Infrastructure, API, and the tests. "Replace with" means the linked file is the
whole finished file from the build-verified sample, so you can copy it as-is.

All paths are relative to the solution root (`MMCA.ECommerce`), and every command is PowerShell.

### 4.1 Shared contracts

Under `Source/Modules/Products/MMCA.ECommerce.Products.Shared/`:

| File | Action | What changes |
|---|---|---|
| [MMCA.ECommerce.Products.GlobalUsings.IdentifierType.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Shared/MMCA.ECommerce.Products.GlobalUsings.IdentifierType.cs) | edit | `--flat` already left a single alias, so only the comment still speaks in the plural; the alias stays `global using ProductIdentifierType = int;` |
| `Products/`[ProductDTO.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/ProductDTO.cs) | replace with | the scaffold's `Title` and `RequesterUserId` become `Name` and `Price` |
| `Products/`[ProductUpdateRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/ProductUpdateRequest.cs) | replace with | same rename, and `Price` is `required` like the other two, so a client cannot silently blank a price by omitting it. Keep the `*UpdateRequest` suffix exactly: the shared `UpdateRequestsAreConcurrencyAware` fitness rule finds it by name, and a rename silently drops the request out of that rule's scope |
| `Products/IntegrationEvents/`[ProductCreatedIntegrationEvent.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/IntegrationEvents/ProductCreatedIntegrationEvent.cs) | create | the creation event, carrying the product id, the name, and the price |
| `Products/IntegrationEvents/ProductOpenedIntegrationEvent.cs` | delete | the scaffolded event it replaces, which carried `RequesterUserId` and a name nobody in a catalog would use |

```powershell
Remove-Item Source\Modules\Products\MMCA.ECommerce.Products.Shared\Products\IntegrationEvents\ProductOpenedIntegrationEvent.cs
```

### 4.2 Domain

Under `Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/`:

| File | Action | What changes |
|---|---|---|
| [ProductInvariants.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/ProductInvariants.cs) | replace with | `EnsureTitleIsValid` becomes `EnsureNameIsValid` (codes `Product.Name.Empty` and `Product.Name.TooLong`), the description rule is untouched, and `EnsurePriceIsValid` is new |
| [Product.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/Product.cs) | replace with | the three reshaped properties, the `Create` factory, `UpdateDetails`, and the soft-delete override |
| `DomainEvents/`[ProductChanged.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/DomainEvents/ProductChanged.cs) | edit | the event no longer fires on creation, so the first summary line (the scaffold says "opened, mutated, or deleted") becomes `/// Domain event raised when a <c>Product</c> is mutated or deleted. Captured into the` |

The string rules still delegate to the framework's `CommonInvariants`, so each field keeps its distinct
empty vs too-long error code. The price is the only app-specific rule, and the one part of
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
(`/* ... */` marks elided members): a `Result`-returning factory that accumulates every invariant
before it constructs anything, and a guarded mutation that raises its domain event only once the
validation passed. Note what is deliberately absent: there is no "Added" domain event, because the id
is database-generated and would still be 0 at factory time.

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

        /* construct, with Id = isIdValueGenerated ? default : id!.Value */

        // No "Added" domain event here: the Id is database-generated (still 0 at this point), so an
        // event captured now would carry a meaningless id. Creation is signalled by the
        // ProductCreatedIntegrationEvent that CreateProductHandler publishes AFTER the commit, with the
        // real id.
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
| `Products/UseCases/Create/`[ProductCreateRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequest.cs) | replace with | the create command carries `Name`, `Description`, `Price` |
| `Products/UseCases/Create/`[ProductCreateRequestMapper.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequestMapper.cs) | edit | only the factory call changes (fragment below) |
| `Products/UseCases/Create/`[ProductCreateRequestValidator.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequestValidator.cs) | replace with | the rules mirror the invariants and reuse their constants, so a limit is stated once |
| `Products/UseCases/Create/`[CreateProductHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/CreateProductHandler.cs) | replace with | the whole write path on one screen, worth reading rather than just pasting: domain factory, unit of work, then the renamed integration event published *after* the commit, carrying the name and the price instead of a requester id |
| `Products/UseCases/Update/`[UpdateProductCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductCommand.cs) | replace with | the same three fields, plus the client's last-seen `RowVersion` (ADR-035) |
| `Products/UseCases/Update/`[UpdateProductCommandValidator.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductCommandValidator.cs) | create | the scaffold validates only the create path, and a catalog that accepts a negative price on update is a catalog with a hole in it |
| `Products/UseCases/Update/`[UpdateProductHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductHandler.cs) | edit | `UpdateDetails` takes a third argument now, so the call becomes `var result = product.UpdateDetails(command.Name, command.Description, command.Price);` and the summary follows it (fragment below). The `includes: []` argument is already right, because `--flat` generated this handler against an aggregate with nothing to eager-load |
| `Products/UseCases/Delete/`[DeleteProductCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Delete/DeleteProductCommand.cs) | edit | doc-only: drop the mention of cascading children, so the summary reads `/// Command to soft-delete a product. Evicts cached reads on success.` |
| `Products/UseCases/Delete/`[DeleteProductHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Delete/DeleteProductHandler.cs) | edit | doc-only: two summary lines (fragment below) |
| `Products/UseCases/GetById/`[GetProductByIdQuery.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/GetById/GetProductByIdQuery.cs) | edit | doc-only: the first summary line becomes `/// Query for a single product.` |
| `Products/UseCases/GetById/`[GetProductByIdHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/GetById/GetProductByIdHandler.cs) | edit | doc-only: the summary line becomes `/// Loads a single product and maps it to a DTO.` |
| `Products/IntegrationEventHandlers/`[ProductCreatedHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/IntegrationEventHandlers/ProductCreatedHandler.cs) | create | consumes the new event; in this monolith seed it just logs, and it is where a search-index, notification, or analytics side effect would live |
| `Products/IntegrationEventHandlers/ProductOpenedHandler.cs` | delete | the handler it replaces; the module's DI is convention-scanned, so a deleted handler simply stops being discovered and there is no registration to unpick |
| `Products/DomainEventHandlers/`[ProductChangedAuditHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/DomainEventHandlers/ProductChangedAuditHandler.cs) | edit | one doc line, naming the handler that now audits creation: the second-to-last summary line becomes `/// Creation is audited separately by the integration-event consumer (<c>ProductCreatedHandler</c>),` |
| [DependencyInjection.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Application/DependencyInjection.cs) | edit | one comment, because the aggregate is now known to be a leaf rather than merely un-eager-loaded (fragment below) |

The fragments, in table order: the `ProductCreateRequestMapper` return statement, the
`UpdateProductHandler` summary, the two `DeleteProductHandler` summary lines, the deletion, and the
three-line `DependencyInjection` comment above the `TryAddScoped<INavigationPopulator<Product>, ...>`
call.

```csharp
        return Task.FromResult(Product.Create(
            id: null,
            name: request.Name,
            description: request.Description,
            price: request.Price));
```

```csharp
/// Updates a product's name, description, and price through the aggregate root, then returns the
/// refreshed DTO.
```

```csharp
/// Soft-deletes a product through the aggregate root (loaded tracked so the state change is captured).
/// The EF global query filter then excludes it from subsequent reads.
```

```powershell
Remove-Item Source\Modules\Products\MMCA.ECommerce.Products.Application\Products\IntegrationEventHandlers\ProductOpenedHandler.cs
```

```csharp
            // The Product aggregate is a leaf (no child entities and no cross-source navigations), so a
            // null populator suffices here (swap for a custom INavigationPopulator<Product> once the
            // query service needs to batch-load related data).
```

Both the Delete and GetById handlers resolve their repository through `IUnitOfWork`, never by
constructor-injecting `IRepository<,>`: a directly injected repository is not enlisted in the unit of
work's transaction, and mocks happily hide the difference until a real database run. The scaffold
already does this; keep it.

### 4.4 Infrastructure

**Replace** `Source/Modules/Products/MMCA.ECommerce.Products.Infrastructure/Persistence/EntityConfiguration/ProductConfiguration.cs`
with [ProductConfiguration.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.Infrastructure/Persistence/EntityConfiguration/ProductConfiguration.cs).
`base.Configure` still supplies the id, the soft-delete flag and its query filter, the audit columns,
and the concurrency token, so only the product's own columns are there. `Price` is `decimal(18,2)`
explicitly: SQL Server's default for a mapped decimal is `decimal(18,0)`, which would round every price
to whole currency units. The filtered index moves from the scaffold's `RequesterUserId` to `Name`,
which is what a catalog is actually browsed by. Nothing else in Infrastructure changes: `--flat`
already emitted a `ModuleApplicationDbContext` with one `DbSet`.

### 4.5 API

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.API/Controllers/ProductsController.cs`
([finished file](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.API/Controllers/ProductsController.cs)).
The routes, the injected handlers, and the inherited list/paged reads are all unchanged; five small
edits retarget the wording and the one call that names the reshaped fields. The three action summaries
lose their references to children and to a title, becoming
`/// <summary>Gets a single product.</summary>`,
`/// <summary>Updates a product's name, description, and price.</summary>`, and
`/// <summary>Soft-deletes a product.</summary>`. The class summary becomes:

```csharp
/// REST API for catalog products. Read endpoints (GetAll / paged) come from
/// <see cref="EntityControllerBase{TEntity, TDTO, TId}"/>; create, update, and delete operations
/// inject handlers directly. Failures map to RFC 9457 ProblemDetails via <c>HandleFailure</c>.
```

and the one line of real code is the command construction in `UpdateAsync`:

```csharp
            new UpdateProductCommand(id, request.Name, request.Description, request.Price) { RowVersion = request.RowVersion },
```

**Edit** the two error-resource files,
[ProductsErrorResources.resx](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.resx)
and
[ProductsErrorResources.es.resx](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.es.resx).
Keep the resx envelope exactly as generated (the `<xsd:schema>` block and the four
`<resheader>` elements) and replace **only** the `<data>` elements: the scaffold ships four
(`Product.Description.*`, `Product.Title.*`), and the reshaped module needs the five below. Every code
here is one an invariant in 4.2 actually emits, and an unmapped code degrades gracefully to its English
message, so a typo shows up as English text in a Spanish browser rather than as an exception. The
Spanish descriptions also need a pass: the scaffold's token substitution left them saying "del
product":

| `data name` | `.resx` value (en) | `.es.resx` value (es) |
|---|---|---|
| `Product.Description.Empty` | Product description cannot be empty. | La descripción del producto no puede estar vacía. |
| `Product.Description.TooLong` | Product description cannot exceed 4000 characters. | La descripción del producto no puede superar los 4000 caracteres. |
| `Product.Name.Empty` | Product name cannot be empty. | El nombre del producto no puede estar vacío. |
| `Product.Name.TooLong` | Product name cannot exceed 200 characters. | El nombre del producto no puede superar los 200 caracteres. |
| `Product.InvalidPrice` | Product price must be greater than zero. | El precio del producto debe ser mayor que cero. |

Each entry is a `<data name="..." xml:space="preserve">` element wrapping a single `<value>`, exactly
like the ones you are replacing.

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.cs`
([finished file](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.cs)):
the doc comment cites a code that no longer exists. Change the example code and the constant it names:

```csharp
/// domain error <c>Code</c> (e.g. <c>"Product.InvalidPrice"</c>, see <c>ProductInvariants</c>) and resolved
/// by the shared <c>IErrorLocalizer</c> after the host registers this type via
/// <c>AddErrorResources&lt;ProductsErrorResources&gt;()</c>. The length limits are baked into the values
/// because they are compile-time constants (<c>ProductInvariants.NameMaxLength</c> etc.); an unmapped
```

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
| `MMCA.ECommerce.Products.Application.Tests/Caching/`[ProductCacheInvalidationTests.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/Caching/ProductCacheInvalidationTests.cs) | replace with | 4 tests wiring the two real framework decorators around stub handlers. The last one earns its keep: nothing at compile time ties a command's `CachePrefix` to a query's `CacheKey`, so this is what stops a rename from quietly leaving stale reads behind |
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

Orders keeps the child-collection pattern the template scaffolded, retargeted. `--child Item` already
did the naming for you: the entity is `OrderItem`, the slices are `AddItem` / `EditItem` /
`RemoveItem`, the routes are `/items`. What is left is the domain itself, and the free-form status
becomes a lifecycle.

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
`Body` and `AuthorUserId`, `OrderStatus` is `Open` / `InProgress` / `Resolved` / `Closed`, and the
aggregate has `Title`, `Description`, and `RequesterUserId`.

### 5.1 Shared contracts

The identifier aliases need no edit at all: `--child Item` already emitted `OrderIdentifierType` and
`OrderItemIdentifierType`. Under `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/`:

| File | Action | What changes |
|---|---|---|
| [OrderStatus.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderStatus.cs) | replace with | the scaffold ships a flat set of ticket states; this is a lifecycle (`Pending`, `Paid`, `Shipped`, `Cancelled`), and its doc comment is where the legal transitions are written down for a reader who will not go looking for the invariant |
| [OrderDTO.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderDTO.cs) | replace with | `Title`, `Description`, and `RequesterUserId` collapse into `CustomerName`, and `Total` is new. The `Total` remarks are load-bearing documentation, not decoration: only the detail read eager-loads `Items`, so `Total` is 0 on the list and paged projections, and the fix for a caller who needs the number is to ask the detail endpoint, not to widen the list query |
| [OrderItemDTO.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderItemDTO.cs) | replace with | the scaffold's `Body` and `AuthorUserId` become the four snapshot properties |
| [OrderUpdateRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderUpdateRequest.cs) | replace with | small, and the `*UpdateRequest` suffix must survive: the shared `UpdateRequestsAreConcurrencyAware` fitness rule matches on that name |
| [AddOrderItemRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/AddOrderItemRequest.cs) | create | read its doc comment: the caller supplies the name and price to snapshot, and that is the wire-level half of the module-isolation decision above |
| [ChangeOrderItemQuantityRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/ChangeOrderItemQuantityRequest.cs) | create | replaces the scaffold's free-text `EditItemRequest(string Body)` |
| `IntegrationEvents/`[OrderPlacedIntegrationEvent.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/IntegrationEvents/OrderPlacedIntegrationEvent.cs) | create | the placement event, carrying the order id and the customer name |
| `AddItemRequest.cs`, `EditItemRequest.cs`, `IntegrationEvents/OrderOpenedIntegrationEvent.cs` | delete | the three Shared files the reshape replaces |

[ChangeOrderStatusRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/ChangeOrderStatusRequest.cs)
stays exactly as generated: `record ChangeOrderStatusRequest(OrderStatus Status)` is already the right
shape, and the enum it names is the one you just rewrote.

```powershell
Remove-Item `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\AddItemRequest.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\EditItemRequest.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\IntegrationEvents\OrderOpenedIntegrationEvent.cs
```

### 5.2 Domain

Under `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/`:

| File | Action | What changes |
|---|---|---|
| [OrderInvariants.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderInvariants.cs) | replace with | six methods and eight error codes: the two customer-name codes, the two product-name codes, the unit price, the quantity, the item lock, and the status transition. Every one of them is a code you will localize in 5.5 |
| [OrderItem.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderItem.cs) | replace with | `Body` and `AuthorUserId` become the four snapshot properties, and `EditBody` becomes `ChangeQuantity` |
| [Order.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/Order.cs) | replace with | `CustomerName` plus a guarded `Status`, a computed `Total`, and item mutations that ask the status first |
| `DomainEvents/OrderChanged.cs` | leave | unlike Products, the scaffolded Orders event summary already reads correctly for an aggregate whose creation is signalled by an integration event |

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

    public Result<OrderItem> AddItem(
        OrderItemIdentifierType? id,
        int productId,
        string productName,
        decimal unitPrice,
        int quantity)
    {
        var validation = OrderInvariants.EnsureStatusAllowsItemChanges(Status, nameof(AddItem));
        if (validation.IsFailure)
        {
            return Result.Failure<OrderItem>(validation.Errors);
        }

        /* OrderItem.Create(...), _items.Add(item), then OrderChanged(DomainEntityState.Updated, Id) */
    }

    /* UpdateDetails(customerName) validates and assigns; ChangeItemQuantity(itemId, quantity) and
       RemoveItem(itemId) open with the same EnsureStatusAllowsItemChanges guard, then
       GetChildOrNotFound(_items, itemId, ...) and either item.ChangeQuantity(quantity) or
       item.Delete(). Each raises OrderChanged(DomainEntityState.Updated, Id) on success */

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
| [OrderConfiguration.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/OrderConfiguration.cs) | replace with | the customer-name column and filtered index, the string-persisted status, `builder.Ignore(o => o.Total)`, and the items relationship |
| [OrderItemConfiguration.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/OrderItemConfiguration.cs) | replace with | the item's own columns; the `using Microsoft.EntityFrameworkCore;` at the top is new, because `HasColumnType` needs it |

Two lines in `OrderConfiguration` are easy to skip and expensive to omit: `Status` is persisted as a
**string** (that is the scaffold's line, kept), so a later reordering of the enum cannot silently
reinterpret stored rows, and `builder.Ignore(o => o.Total)` keeps EF from trying to map the computed
getter (without it the model build fails outright). On the item, `UnitPrice` gets an explicit
`decimal(18,2)` rather than the SQL Server default, so a price never silently rounds on the way in.
`ModuleApplicationDbContext` needs no edit: `--child Item` already declared `DbSet<OrderItem>`
alongside `DbSet<Order>`.

### 5.4 Application

An order is placed empty and grows lines afterwards, so the create payload is just a customer name.
Under `Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/`:

| File | Action | What changes |
|---|---|---|
| `UseCases/Create/`[OrderCreateRequest.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Create/OrderCreateRequest.cs) | replace with | one field, `CustomerName`; the order starts Pending and empty |
| `UseCases/Create/`[OrderCreateRequestMapper.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Create/OrderCreateRequestMapper.cs) | edit | the doc comment gains an `n` (`/// Maps an <see cref="OrderCreateRequest"/> to a new <see cref="Order"/> via the domain factory.`) and the factory call loses two arguments (fragment below) |
| `UseCases/Create/`[OrderCreateRequestValidator.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Create/OrderCreateRequestValidator.cs) | replace with | drops to one rule, so the constructor becomes an expression body |
| `UseCases/Create/`[CreateOrderHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Create/CreateOrderHandler.cs) | edit | two summary lines, `/// Places a new order: maps the request through the domain factory, persists via the unit of work` and `/// <see cref="OrderPlacedIntegrationEvent"/> for cross-module/cross-service consumers. Wrapped by`, plus the published event: `new OrderPlacedIntegrationEvent(entity.Id, entity.CustomerName),`. The handler still publishes after the commit, so the database-generated id is populated by the time the event reaches consumers |
| `UseCases/Update/`[UpdateOrderCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Update/UpdateOrderCommand.cs) | replace with | the record loses two parameters |
| `UseCases/Update/`[UpdateOrderHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Update/UpdateOrderHandler.cs) | edit | the summary becomes `/// Updates an order's customer name through the aggregate root, then returns the refreshed DTO.` and the call into the aggregate becomes `var result = order.UpdateDetails(command.CustomerName);` |
| `UseCases/AddItem/`[AddItemCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/AddItem/AddItemCommand.cs) | replace with | the two scaffolded scalars become four, and the doc comment records why they travel on the command instead of being looked up |
| `UseCases/AddItem/`[AddItemHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/AddItem/AddItemHandler.cs) | edit | the summary gains an `n` (`/// Loads the order (tracked, with its items), appends an item through the aggregate root, and`) and the aggregate call takes the four scalars (fragment below). It already returns `Result<OrderItemDTO>` and already loads `includes: [nameof(Order.Items)]` tracked, which is what lets the aggregate enforce the item lock and recompute the total, so neither changes |
| `UseCases/ChangeItemQuantity/`[ChangeItemQuantityCommand.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/ChangeItemQuantity/ChangeItemQuantityCommand.cs) | create | quantity is the only mutable field on a line: the product snapshot and its price stay as captured |
| `UseCases/ChangeItemQuantity/`[ChangeItemQuantityHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/ChangeItemQuantity/ChangeItemQuantityHandler.cs) | create | loads the order tracked with its items, then changes the quantity through the aggregate root |
| `UseCases/EditItem/` | delete | the slice `ChangeItemQuantity` replaces (the folder holds two files) |
| `IntegrationEventHandlers/`[OrderPlacedHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/IntegrationEventHandlers/OrderPlacedHandler.cs) | create | consumes the placement event; in this seed it just logs, and it is where a notification, email, or analytics side effect would live |
| `IntegrationEventHandlers/OrderOpenedHandler.cs` | delete | the handler it replaces |
| `DomainEventHandlers/`[OrderChangedAuditHandler.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/DomainEventHandlers/OrderChangedAuditHandler.cs) | edit | one doc line, naming the handler that now audits creation: the second-to-last summary line becomes `/// Creation is audited separately by the integration-event consumer (<c>OrderPlacedHandler</c>),` |

The two multi-line fragments, in table order: the `OrderCreateRequestMapper` factory call, then the
`AddItemHandler` call into the aggregate.

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

The deletions remove three items, because the `EditItem` folder holds two files:

```powershell
Remove-Item -Recurse `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\UseCases\EditItem, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\IntegrationEventHandlers\OrderOpenedHandler.cs
```

Nothing else in the Application layer moves. The Delete, GetById, and ChangeStatus slices, both DTO
mappers, `OrderCacheKeys`, and `DependencyInjection.cs` are all correct exactly as `--child Item`
generated them, because each of them talks about items and none of them names a renamed field.

### 5.5 API

**Replace** `Source/Modules/Orders/MMCA.ECommerce.Orders.API/Controllers/OrdersController.cs` with
[OrdersController.cs](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.API/Controllers/OrdersController.cs).
The routes are unchanged, including `POST /Orders/{id}/items`, `PUT /Orders/{id}/items/{itemId}`, and
`DELETE /Orders/{id}/items/{itemId}`: `--child Item` produced them. What changes is the injected
`ChangeItemQuantityCommand` handler in place of the `EditItemCommand` one, the action renamed from
`EditItemAsync` to `ChangeItemQuantityAsync`, and the two new request types.

**Edit** the two error-resource files,
[OrdersErrorResources.resx](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.resx)
and
[OrdersErrorResources.es.resx](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.es.resx).
Keep the resx envelope exactly as generated (the `<xsd:schema>` block and the four
`<resheader>` elements) and replace **only** the `<data>` elements: delete the seven scaffolded ones
(`Order.Closed`, `Order.Title.*`, `Order.Description.*`, `Order.Item.Body.*`) and add the eight below,
in this order. That is one entry per code `OrderInvariants` can emit, which is what makes the
Pending-only lock and the lifecycle guard reach the user in their own language rather than as a raw
code:

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
like the ones you are replacing.

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.cs`
([the finished file](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.cs)):
the doc comment cites a code that no longer exists. Change the example code and the constant it names:

```csharp
/// domain error <c>Code</c> (e.g. <c>"Order.CustomerName.Empty"</c>, see <c>OrderInvariants</c>) and
/// resolved by the shared <c>IErrorLocalizer</c> after the host registers this type via
/// <c>AddErrorResources&lt;OrdersErrorResources&gt;()</c>. The length limits are baked into the values
/// because they are compile-time constants (<c>OrderInvariants.CustomerNameMaxLength</c> etc.); an
/// unmapped code degrades gracefully to its English message.
```

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
Central Package Management.

Then the test files themselves, all under `Tests/Modules/Orders/`:

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
mistake the `ProductName` / `UnitPrice` snapshot exists to make unnecessary.

As in step 4, a single class or method needs a Microsoft Testing Platform filter **after a bare `--`**
(these projects are MTP, not VSTest, so a filter placed before the separator runs zero tests):

```powershell
dotnet test --project Tests/Modules/Orders/MMCA.ECommerce.Orders.Domain.Tests/MMCA.ECommerce.Orders.Domain.Tests.csproj -- --filter-method "*ChangeStatus*"
```

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
- [Orders.razor](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Pages/Orders.razor):
  create an order by customer name, list orders.
- [OrderDetail.razor](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Pages/OrderDetail.razor):
  edit the customer name, walk the status lifecycle (the page offers only the
  transitions the domain allows), and manage items while the order is Pending. The add-item form is
  a product picker filled from `GetProductsAsync()`: selecting a product snapshots its id, name, and
  price into the request, which is the UI half of the module-isolation decision above.

[MainLayout.razor](https://github.com/ivanball/MMCA.ECommerce/blob/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Layout/MainLayout.razor)
carries the chrome around them: the Products and Orders app-bar links, the culture switcher, and the
theme toggle, over the framework's `MmcaThemeProviders`.

Every string goes through the `L[...]` localizer, and every key needs an entry in both the `.resx`
and `.es.resx` file beside the page. The
[UI host in the repo](https://github.com/ivanball/MMCA.ECommerce/tree/main/Source/Hosts/UI/MMCA.ECommerce.UI.Web)
is the complete reference.

## 7. Create the migrations

Neither module has a migration yet: a `--flat` or `--no-status` scaffold deliberately drops the
template's sample migration (it described the sample shape), and `mmca-module` never ships one.
Each `Migrations` folder does carry an `.editorconfig` that keeps analyzer enforcement off
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
generated value could be right): re-sort the using directives and freeze your integration-event
wire contract. Both are described in the
[getting-started guide](common-GETTING-STARTED.md#6-the-two-one-time-fixups); the sample has both
applied, so its `IntegrationEventContractTests` freezes `ProductCreatedIntegrationEvent` and
`OrderPlacedIntegrationEvent` exactly as shipped.

> **Re-running the walkthrough on the same machine?** The Aspire SQL container is persistent by
> design, so databases created by an earlier MMCA.ECommerce build survive a re-scaffold, and their
> migration history will not match your fresh migrations: startup then fails with "There is already
> an object named 'InboxMessages' in the database". Drop the stale `ECommerce_*` databases (or
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

1. Baseline green immediately after `mmca-app`, before any edit.
2. After the Orders wire-ups: still green, both modules' tests running.
3. After both reshapes: `dotnet build MMCA.ECommerce.slnx` warning-free and
   `dotnet test --solution MMCA.ECommerce.slnx` fully green (the sample lands at 158 tests), with
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
- **[Templates](common-TEMPLATES.md)**: every parameter of all four templates.
- **[Building by hand](common-BUILD-BY-HAND.md)**: what each generated file does and why.
- **[MMCA.Helpdesk](https://github.com/ivanball/MMCA.Helpdesk)**: the reference app the templates
  are staged from.
