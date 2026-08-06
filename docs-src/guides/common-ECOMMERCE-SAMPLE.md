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
`Name` and the scaffold's `RequesterUserId` becomes a `decimal Price`. Work the layers below in order:
Shared first (every layer above compiles against those contracts), then Domain, Application,
Infrastructure, API, and the tests. Every file shown is the finished file from the build-verified
sample, so you can paste it as-is.

All paths are relative to the solution root (`MMCA.ECommerce`), and every command is PowerShell.

### 4.1 Shared contracts

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Shared/MMCA.ECommerce.Products.GlobalUsings.IdentifierType.cs`.
`--flat` already left you a single alias; only the comment still speaks in the plural. The whole file
is now:

```csharp
// Products module entity identifier type aliases.
// The Product aggregate uses a database-generated integer ID (the [IdValueGenerated] attribute on the
// domain entity). This file is linked into every project solution-wide via Directory.Build.props,
// so the aliases are visible everywhere. Always use the alias instead of the raw type.
global using ProductIdentifierType = int;
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/ProductDTO.cs`. The
scaffold's `Title` and `RequesterUserId` become `Name` and `Price`:

```csharp
using MMCA.Common.Shared.DTOs;

namespace MMCA.ECommerce.Products.Shared.Products;

/// <summary>
/// Read model for a <c>Product</c> aggregate returned by the API. Exposes the current
/// <see cref="RowVersion"/> so a client can echo it back on <c>ProductUpdateRequest</c> (ADR-035).
/// </summary>
public record class ProductDTO : IBaseDTO<ProductIdentifierType>, IConcurrencyAware
{
    public required ProductIdentifierType Id { get; init; }

    /// <inheritdoc />
    public byte[]? RowVersion { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required decimal Price { get; init; }
}
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/ProductUpdateRequest.cs`.
Same rename, and `Price` is `required` like the other two, so a client cannot silently blank a price by
omitting it. Keep the `*UpdateRequest` suffix exactly: the shared `UpdateRequestsAreConcurrencyAware`
fitness rule finds it by name, and a rename silently drops the request out of that rule's scope:

```csharp
using MMCA.Common.Shared.DTOs;

namespace MMCA.ECommerce.Products.Shared.Products;

/// <summary>
/// Request body for updating a product's name, description, and price (the product id comes from the
/// route). Round-trips the optimistic-concurrency token per ADR-035: the client echoes the
/// <see cref="RowVersion"/> it last read so a conflicting concurrent edit surfaces as 409 instead
/// of silently last-write-winning. Named with the <c>*UpdateRequest</c> suffix so the shared
/// <c>UpdateRequestsAreConcurrencyAware</c> fitness rule covers it.
/// </summary>
public sealed record class ProductUpdateRequest : IConcurrencyAware
{
    /// <inheritdoc />
    public byte[]? RowVersion { get; init; }

    /// <summary>The new name.</summary>
    public required string Name { get; init; }

    /// <summary>The new description.</summary>
    public required string Description { get; init; }

    /// <summary>The new price; must be greater than zero.</summary>
    public required decimal Price { get; init; }
}
```

**Create** `Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/IntegrationEvents/ProductCreatedIntegrationEvent.cs`:

```csharp
using MMCA.Common.Domain.DomainEvents;

namespace MMCA.ECommerce.Products.Shared.Products.IntegrationEvents;

/// <summary>
/// Raised when a product is created. Lives in the Shared layer so other modules (or extracted
/// services) can consume it without referencing Products.Domain. Carries the framework
/// <see cref="BaseIntegrationEvent.SchemaVersion"/> (default 1, ADR-010): a breaking change uses a
/// new event type plus an upcaster, never a silent reshape of this contract.
/// </summary>
/// <param name="ProductId">The newly created product's database-generated identifier.</param>
/// <param name="Name">The product name at creation time.</param>
/// <param name="Price">The product price at creation time.</param>
public sealed record class ProductCreatedIntegrationEvent(
    ProductIdentifierType ProductId,
    string Name,
    decimal Price)
    : BaseIntegrationEvent;
```

**Delete** the scaffolded event it replaces, which carried `RequesterUserId` and a name nobody in a
catalog would use:

```powershell
Remove-Item Source\Modules\Products\MMCA.ECommerce.Products.Shared\Products\IntegrationEvents\ProductOpenedIntegrationEvent.cs
```

### 4.2 Domain

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/ProductInvariants.cs`
with the complete file below. `EnsureTitleIsValid` becomes `EnsureNameIsValid` (codes
`Product.Name.Empty` and `Product.Name.TooLong`), the description rule is untouched, and
`EnsurePriceIsValid` is new. The string rules still delegate to the framework's `CommonInvariants`, so
each field keeps its distinct empty vs too-long error code; the price is the only app-specific rule:

```csharp
using MMCA.Common.Domain.Invariants;
using MMCA.Common.Shared.Abstractions;

namespace MMCA.ECommerce.Products.Domain.Products;

/// <summary>
/// Business invariants for the <c>Product</c> aggregate. Each method returns a <see cref="Result"/>
/// so callers can compose them with <see cref="Result.Combine(System.ReadOnlySpan{Result})"/>.
/// The string checks delegate to the framework's <see cref="CommonInvariants"/> helpers, so each
/// field reports a distinct empty vs too-long error; only the app-specific price rule and the
/// length constants live here.
/// </summary>
public static class ProductInvariants
{
    public const int NameMaxLength = 200;
    public const int DescriptionMaxLength = 4000;

    public static Result EnsureNameIsValid(string name, string source)
        => Result.Combine(
            CommonInvariants.EnsureStringIsNotEmpty(name, "Product.Name.Empty", "Product name cannot be empty.", source, nameof(name)),
            CommonInvariants.EnsureStringMaxLength(name, NameMaxLength, "Product.Name.TooLong", $"Product name cannot exceed {NameMaxLength} characters.", source, nameof(name)));

    public static Result EnsureDescriptionIsValid(string description, string source)
        => Result.Combine(
            CommonInvariants.EnsureStringIsNotEmpty(description, "Product.Description.Empty", "Product description cannot be empty.", source, nameof(description)),
            CommonInvariants.EnsureStringMaxLength(description, DescriptionMaxLength, "Product.Description.TooLong", $"Product description cannot exceed {DescriptionMaxLength} characters.", source, nameof(description)));

    public static Result EnsurePriceIsValid(decimal price, string source)
        => price <= 0
            ? Result.Failure(Error.Invariant(
                code: "Product.InvalidPrice",
                message: "Product price must be greater than zero.",
                source: source,
                target: nameof(price)))
            : Result.Success();
}
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/Product.cs` with the
complete file below. Note what is deliberately absent: there is no "Added" domain event, because the
id is database-generated and would still be 0 at factory time:

```csharp
using MMCA.Common.Domain.Attributes;
using MMCA.Common.Domain.Entities;
using MMCA.Common.Domain.Enums;
using MMCA.Common.Domain.Extensions;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Products.Domain.Products.DomainEvents;

namespace MMCA.ECommerce.Products.Domain.Products;

/// <summary>
/// Catalog product aggregate root. Created through the <see cref="Create"/> factory (returns a
/// <see cref="Result{T}"/>), mutated through guarded methods that raise <see cref="ProductChanged"/>
/// domain events. A leaf aggregate: it owns no child entities.
/// </summary>
[IdValueGenerated]
public sealed class Product : AuditableAggregateRootEntity<ProductIdentifierType>
{
    public string Name { get; private set; }
    public string Description { get; private set; }
    public decimal Price { get; private set; }

    private Product(string name, string description, decimal price)
    {
        Name = name;
        Description = description;
        Price = price;
    }

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

        bool isIdValueGenerated = typeof(Product).IsIdValueGenerated;

        var product = new Product(name, description, price)
        {
            Id = isIdValueGenerated ? default : id!.Value,
        };

        // No "Added" domain event here: the Id is database-generated (still 0 at this point), so an
        // event captured now would carry a meaningless id. Creation is signalled by the
        // ProductCreatedIntegrationEvent that CreateProductHandler publishes AFTER the commit, with the
        // real id.
        return Result.Success(product);
    }

    public Result UpdateDetails(string name, string description, decimal price)
    {
        var validation = Result.Combine(
            ProductInvariants.EnsureNameIsValid(name, nameof(UpdateDetails)),
            ProductInvariants.EnsureDescriptionIsValid(description, nameof(UpdateDetails)),
            ProductInvariants.EnsurePriceIsValid(price, nameof(UpdateDetails)));
        if (validation.IsFailure)
        {
            return validation;
        }

        Name = name;
        Description = description;
        Price = price;
        AddDomainEvent(new ProductChanged(DomainEntityState.Updated, Id));

        return Result.Success();
    }

    public override Result Delete()
    {
        var result = base.Delete();
        if (result.IsFailure)
        {
            return result;
        }

        AddDomainEvent(new ProductChanged(DomainEntityState.Deleted, Id));

        return result;
    }
}
```

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/DomainEvents/ProductChanged.cs`:
the event no longer fires on creation, so change the first summary line (the scaffold says "opened,
mutated, or deleted"):

```csharp
/// Domain event raised when a <c>Product</c> is mutated or deleted. Captured into the
```

### 4.3 Application

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequest.cs`:

```csharp
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Products.Application.Products.UseCases.Create;

/// <summary>
/// Command/request to create a new product. Used directly as the command (validated by the pipeline's
/// Validating decorator via <see cref="ProductCreateRequestValidator"/>); implements
/// <see cref="ICacheInvalidating"/> so cached product reads are evicted after a successful create.
/// </summary>
public record class ProductCreateRequest : ICreateRequest, ICacheInvalidating
{
    public string CachePrefix => ProductCacheKeys.Prefix;

    public required string Name { get; init; }
    public required string Description { get; init; }
    public required decimal Price { get; init; }
}
```

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequestMapper.cs`:
only the factory call changes. Replace the `return` statement with:

```csharp
        return Task.FromResult(Product.Create(
            id: null,
            name: request.Name,
            description: request.Description,
            price: request.Price));
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequestValidator.cs`.
The rules mirror the invariants and reuse their constants, so a limit is stated once:

```csharp
using FluentValidation;
using MMCA.ECommerce.Products.Domain.Products;

namespace MMCA.ECommerce.Products.Application.Products.UseCases.Create;

/// <summary>
/// FluentValidation rules for <see cref="ProductCreateRequest"/>, applied by the pipeline's
/// Validating decorator before the transaction opens.
/// </summary>
public sealed class ProductCreateRequestValidator : AbstractValidator<ProductCreateRequest>
{
    public ProductCreateRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(ProductInvariants.NameMaxLength);
        RuleFor(x => x.Description).NotEmpty().MaximumLength(ProductInvariants.DescriptionMaxLength);
        RuleFor(x => x.Price).GreaterThan(0m);
    }
}
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/CreateProductHandler.cs`.
This is the file that shows the whole write path in one screen, so it is worth reading rather than
just pasting: domain factory, unit of work, then the renamed integration event published *after* the
commit, carrying the name and the price instead of a requester id:

```csharp
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Application.UseCases;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Products.Application.Products.DTOs;
using MMCA.ECommerce.Products.Domain.Products;
using MMCA.ECommerce.Products.Shared.Products;
using MMCA.ECommerce.Products.Shared.Products.IntegrationEvents;

namespace MMCA.ECommerce.Products.Application.Products.UseCases.Create;

/// <summary>
/// Creates a new product: maps the request through the domain factory, persists via the unit of work
/// (which stamps audit fields and dispatches domain events), then publishes the
/// <see cref="ProductCreatedIntegrationEvent"/> for cross-module/cross-service consumers. Wrapped by
/// the decorator pipeline (logging, caching, validating, transactional) once
/// <c>AddApplicationDecorators()</c> runs.
/// </summary>
public sealed class CreateProductHandler(
    IUnitOfWork unitOfWork,
    IEntityRequestMapper<Product, ProductCreateRequest, ProductIdentifierType> requestMapper,
    IEventBus eventBus,
    ProductDTOMapper dtoMapper) : ICommandHandler<ProductCreateRequest, Result<ProductDTO>>
{
    public async Task<Result<ProductDTO>> HandleAsync(ProductCreateRequest command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var result = await requestMapper.CreateEntityAsync(command, cancellationToken).ConfigureAwait(false);
        if (result.IsFailure)
        {
            return Result.Failure<ProductDTO>(result.Errors);
        }

        var entity = result.Value!;
        var repository = unitOfWork.GetRepository<Product, ProductIdentifierType>();

        await repository.AddAsync(entity, cancellationToken).ConfigureAwait(false);
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        // Published after the commit so the database-generated product id is populated by the time the
        // event reaches consumers. The publisher persists the event to the outbox and dispatches it
        // in-process today, and will route it over a broker once Products is extracted, with no handler
        // code change required.
        await eventBus.PublishAsync(
            new ProductCreatedIntegrationEvent(entity.Id, entity.Name, entity.Price),
            cancellationToken).ConfigureAwait(false);

        return Result.Success(dtoMapper.MapToDTO(entity));
    }
}
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductCommand.cs`:

```csharp
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Products.Application.Products.UseCases.Update;

/// <summary>
/// Command to update a product's name, description, and price. Evicts cached product reads on success.
/// Carries the client's last-seen concurrency token (ADR-035); null skips the conflict check.
/// </summary>
public sealed record UpdateProductCommand(
    ProductIdentifierType ProductId,
    string Name,
    string Description,
    decimal Price)
    : ICacheInvalidating
{
    /// <summary>The client's last-seen concurrency token; null skips the conflict check (ADR-035).</summary>
    public byte[]? RowVersion { get; init; }

    public string CachePrefix => ProductCacheKeys.Prefix;
}
```

**Create** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductCommandValidator.cs`.
The scaffold validates only the create path; a catalog that accepts a negative price on update is a
catalog with a hole in it:

```csharp
using FluentValidation;
using MMCA.ECommerce.Products.Domain.Products;

namespace MMCA.ECommerce.Products.Application.Products.UseCases.Update;

/// <summary>
/// FluentValidation rules for <see cref="UpdateProductCommand"/>, applied by the pipeline's
/// Validating decorator before the transaction opens. Mirrors the create-side rules so a bad payload
/// is rejected at the boundary instead of reaching the aggregate.
/// </summary>
public sealed class UpdateProductCommandValidator : AbstractValidator<UpdateProductCommand>
{
    public UpdateProductCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(ProductInvariants.NameMaxLength);
        RuleFor(x => x.Description).NotEmpty().MaximumLength(ProductInvariants.DescriptionMaxLength);
        RuleFor(x => x.Price).GreaterThan(0m);
    }
}
```

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductHandler.cs`.
`UpdateDetails` takes a third argument now. Change the summary and the call:

```csharp
/// Updates a product's name, description, and price through the aggregate root, then returns the
/// refreshed DTO.
```

```csharp
        var result = product.UpdateDetails(command.Name, command.Description, command.Price);
```

The `includes: []` argument is already right: `--flat` generated this handler against an aggregate
with nothing to eager-load.

**Edit** the Delete slice, both doc-only. In
`Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Delete/DeleteProductCommand.cs`,
drop the mention of cascading children:

```csharp
/// Command to soft-delete a product. Evicts cached reads on success.
```

In `.../UseCases/Delete/DeleteProductHandler.cs`, replace the two summary lines with:

```csharp
/// Soft-deletes a product through the aggregate root (loaded tracked so the state change is captured).
/// The EF global query filter then excludes it from subsequent reads.
```

**Edit** the GetById slice, also doc-only. In
`.../UseCases/GetById/GetProductByIdQuery.cs`, change the first summary line:

```csharp
/// Query for a single product.
```

In `.../UseCases/GetById/GetProductByIdHandler.cs`, change the summary line:

```csharp
/// Loads a single product and maps it to a DTO.
```

Both handlers resolve their repository through `IUnitOfWork`, never by constructor-injecting
`IRepository<,>`: a directly injected repository is not enlisted in the unit of work's transaction, and
mocks happily hide the difference until a real database run. The scaffold already does this; keep it.

**Create** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/IntegrationEventHandlers/ProductCreatedHandler.cs`:

```csharp
using Microsoft.Extensions.Logging;
using MMCA.Common.Application.Interfaces;
using MMCA.ECommerce.Products.Shared.Products.IntegrationEvents;

namespace MMCA.ECommerce.Products.Application.Products.IntegrationEventHandlers;

/// <summary>
/// Consumes <see cref="ProductCreatedIntegrationEvent"/>. In this monolith seed it just logs; in a real
/// system this is where a search-index/notification/analytics side effect would live. The same handler
/// runs in-process now and over the broker once the Products module is extracted (ADR-003 / ADR-008).
/// Auto-discovered by Scrutor (singleton lifetime); the dispatcher routes the outbox-published event here.
/// </summary>
public sealed partial class ProductCreatedHandler(ILogger<ProductCreatedHandler> logger)
    : IIntegrationEventHandler<ProductCreatedIntegrationEvent>
{
    public Task HandleAsync(ProductCreatedIntegrationEvent integrationEvent, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(integrationEvent);

        LogProductCreated(logger, integrationEvent.ProductId, integrationEvent.Name, integrationEvent.SchemaVersion);

        return Task.CompletedTask;
    }

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Integration event: product {ProductId} '{Name}' created (schema v{SchemaVersion}).")]
    private static partial void LogProductCreated(ILogger logger, int productId, string name, int schemaVersion);
}
```

**Delete** the handler it replaces. The module's DI is convention-scanned, so a deleted handler simply
stops being discovered; there is no registration to unpick:

```powershell
Remove-Item Source\Modules\Products\MMCA.ECommerce.Products.Application\Products\IntegrationEventHandlers\ProductOpenedHandler.cs
```

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/DomainEventHandlers/ProductChangedAuditHandler.cs`:
one doc line, naming the handler that now audits creation. Change the second-to-last summary line to:

```csharp
/// Creation is audited separately by the integration-event consumer (<c>ProductCreatedHandler</c>),
```

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Application/DependencyInjection.cs`: one
comment, because the aggregate is now known to be a leaf rather than merely un-eager-loaded. Replace
the three-line comment above the `TryAddScoped<INavigationPopulator<Product>, ...>` call with:

```csharp
            // The Product aggregate is a leaf (no child entities and no cross-source navigations), so a
            // null populator suffices here (swap for a custom INavigationPopulator<Product> once the
            // query service needs to batch-load related data).
```

### 4.4 Infrastructure

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Infrastructure/Persistence/EntityConfiguration/ProductConfiguration.cs`.
`base.Configure` still supplies the id, the soft-delete flag and its query filter, the audit columns,
and the concurrency token, so only the product's own columns are here. `Price` is
`decimal(18,2)` explicitly: SQL Server's default for a mapped decimal is `decimal(18,0)`, which would
round every price to whole currency units. The filtered index moves from the scaffold's
`RequesterUserId` to `Name`, which is what a catalog is actually browsed by:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration;
using MMCA.ECommerce.Products.Domain.Products;

namespace MMCA.ECommerce.Products.Infrastructure.Persistence.EntityConfiguration;

/// <summary>
/// EF Core configuration for the <see cref="Product"/> aggregate. <c>base.Configure</c> wires the Id,
/// soft-delete flag + query filter, audit fields, and concurrency token from the framework base.
/// </summary>
internal sealed class ProductConfiguration : EntityTypeConfigurationSQLServer<Product, ProductIdentifierType>
{
    public override void Configure(EntityTypeBuilder<Product> builder)
    {
        base.Configure(builder);

        builder.Property(p => p.Name)
            .HasMaxLength(ProductInvariants.NameMaxLength)
            .IsRequired();

        builder.Property(p => p.Description)
            .HasMaxLength(ProductInvariants.DescriptionMaxLength)
            .IsRequired();

        // Money column: fixed precision so rounding is decided by the schema, not by the provider default.
        builder.Property(p => p.Price)
            .HasColumnType("decimal(18,2)")
            .IsRequired();

        builder.HasIndex(p => p.Name)
            .HasFilter("[IsDeleted] = 0");
    }
}
```

Nothing else in Infrastructure changes: `--flat` already emitted a `ModuleApplicationDbContext` with
one `DbSet`.

### 4.5 API

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.API/Controllers/ProductsController.cs`. The
routes, the injected handlers, and the inherited list/paged reads are all unchanged; five small edits
retarget the wording and the one call that names the reshaped fields. The class summary becomes:

```csharp
/// REST API for catalog products. Read endpoints (GetAll / paged) come from
/// <see cref="EntityControllerBase{TEntity, TDTO, TId}"/>; create, update, and delete operations
/// inject handlers directly. Failures map to RFC 9457 ProblemDetails via <c>HandleFailure</c>.
```

and the three action summaries lose their references to children and to a title:

```csharp
    /// <summary>Gets a single product.</summary>
```

```csharp
    /// <summary>Updates a product's name, description, and price.</summary>
```

```csharp
    /// <summary>Soft-deletes a product.</summary>
```

The one line of real code is the command construction in `UpdateAsync`:

```csharp
            new UpdateProductCommand(id, request.Name, request.Description, request.Price) { RowVersion = request.RowVersion },
```

**Edit** the two error-resource files. In
`Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.resx` and its
`.es.resx` sibling, keep the resx envelope exactly as generated (the `<xsd:schema>` block and the four
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

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.cs`:
the doc comment cites a code that no longer exists. Change the example code and the constant it names:

```csharp
/// domain error <c>Code</c> (e.g. <c>"Product.InvalidPrice"</c>, see <c>ProductInvariants</c>) and resolved
/// by the shared <c>IErrorLocalizer</c> after the host registers this type via
/// <c>AddErrorResources&lt;ProductsErrorResources&gt;()</c>. The length limits are baked into the values
/// because they are compile-time constants (<c>ProductInvariants.NameMaxLength</c> etc.); an unmapped
```

At this point the solution builds again. The tests do not yet.

### 4.6 Tests

**Edit** `Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/MMCA.ECommerce.Products.Application.Tests.csproj`.
The handler tests need the framework's test base and a mocking library, neither of which the
application-test scaffold references. Add two lines at the top of the package `ItemGroup` so it reads:

```xml
  <ItemGroup>
    <PackageReference Include="MMCA.Common.Testing" />
    <PackageReference Include="Moq" />
    <PackageReference Include="xunit.v3" />
```

No version attributes: both packages are already pinned in the solution's `Directory.Packages.props`
under Central Package Management, so a version here would be an error rather than a nicety.

**Rewrite** `Tests/Modules/Products/MMCA.ECommerce.Products.Domain.Tests/Products/ProductTests.cs`
with the complete file below (13 tests). Read the accumulation test near the end: `Result.Combine`
reports every broken invariant at once, which is the behavior that makes one round trip enough for a
form:

```csharp
using AwesomeAssertions;
using MMCA.Common.Domain.Enums;
using MMCA.ECommerce.Products.Domain.Products;
using MMCA.ECommerce.Products.Domain.Products.DomainEvents;

namespace MMCA.ECommerce.Products.Domain.Tests.Products;

public class ProductTests
{
    [Fact]
    public void Create_WithValidData_ReturnsSuccess()
    {
        var result = Product.Create(id: null, "Mechanical keyboard", "Hot-swappable, 87 keys.", price: 129.99m);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Mechanical keyboard");
        result.Value.Description.Should().Be("Hot-swappable, 87 keys.");
        result.Value.Price.Should().Be(129.99m);
    }

    [Fact]
    public void Create_DoesNotRaiseDomainEvent_CreationIsSignalledByIntegrationEvent()
    {
        var result = Product.Create(id: null, "Name", "Description", price: 10m);

        result.IsSuccess.Should().BeTrue();
        // The aggregate omits an "Added" domain event because the Id is DB-generated; the create
        // handler publishes ProductCreatedIntegrationEvent (with the real id) after commit instead.
        result.Value!.DomainEvents.Should().BeEmpty();
    }

    [Fact]
    public void Create_WithEmptyName_ReturnsFailure()
    {
        var result = Product.Create(id: null, "   ", "Description", price: 10m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Name.Empty");
    }

    [Fact]
    public void Create_WithNameOverMaxLength_ReturnsFailure()
    {
        string name = new('x', ProductInvariants.NameMaxLength + 1);

        var result = Product.Create(id: null, name, "Description", price: 10m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Name.TooLong");
    }

    [Fact]
    public void Create_WithEmptyDescription_ReturnsFailure()
    {
        var result = Product.Create(id: null, "Name", "   ", price: 10m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Description.Empty");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-0.01)]
    public void Create_WithNonPositivePrice_ReturnsFailure(decimal price)
    {
        var result = Product.Create(id: null, "Name", "Description", price);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
    }

    [Fact]
    public void Create_ReportsEveryBrokenInvariant_NotJustTheFirst()
    {
        // Result.Combine accumulates: an empty name, an empty description, and a zero price all
        // surface together so the caller sees one complete failure instead of three round trips.
        var result = Product.Create(id: null, "  ", "  ", price: 0m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Name.Empty");
        result.Errors.Should().Contain(e => e.Code == "Product.Description.Empty");
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
    }

    [Fact]
    public void UpdateDetails_WithValidData_UpdatesFieldsAndRaisesEvent()
    {
        var product = CreateProduct();

        var result = product.UpdateDetails("New name", "New description", price: 49.50m);

        result.IsSuccess.Should().BeTrue();
        product.Name.Should().Be("New name");
        product.Description.Should().Be("New description");
        product.Price.Should().Be(49.50m);
        product.DomainEvents.OfType<ProductChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void UpdateDetails_WithEmptyName_ReturnsFailure()
    {
        var product = CreateProduct();

        var result = product.UpdateDetails("   ", "New description", price: 49.50m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Name.Empty");
        product.DomainEvents.Should().BeEmpty("a rejected mutation raises nothing");
    }

    [Fact]
    public void UpdateDetails_WithNonPositivePrice_ReturnsFailure()
    {
        var product = CreateProduct();

        var result = product.UpdateDetails("New name", "New description", price: 0m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
        product.Price.Should().Be(10m, "the aggregate is unchanged when an invariant fails");
    }

    [Fact]
    public void Delete_SoftDeletesProductAndRaisesDeletedEvent()
    {
        var product = CreateProduct();

        var result = product.Delete();

        result.IsSuccess.Should().BeTrue();
        product.IsDeleted.Should().BeTrue();
        product.DomainEvents.OfType<ProductChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Deleted);
    }

    private static Product CreateProduct() =>
        Product.Create(id: null, "Name", "Description", price: 10m).Value!;
}
```

**Rewrite** `Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/Caching/ProductCacheInvalidationTests.cs`
with the complete file below (4 tests). The last test is the one that earns its keep: nothing at
compile time ties a command's `CachePrefix` to a query's `CacheKey`, so this is what stops a rename
from quietly leaving stale reads behind:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.UseCases;
using MMCA.Common.Application.UseCases.Decorators;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Products.Application.Products;
using MMCA.ECommerce.Products.Application.Products.UseCases.Create;
using MMCA.ECommerce.Products.Application.Products.UseCases.Delete;
using MMCA.ECommerce.Products.Application.Products.UseCases.GetById;
using MMCA.ECommerce.Products.Application.Products.UseCases.Update;
using MMCA.ECommerce.Products.Shared.Products;

namespace MMCA.ECommerce.Products.Application.Tests.Caching;

/// <summary>
/// Worked example of the framework's caching pair: a query that implements
/// <see cref="IQueryCacheable"/> is served from cache until a command that implements
/// <see cref="ICacheInvalidating"/> evicts its prefix, and only when that command succeeds.
/// <para>
/// The two real framework decorators are wired around stub handlers, so the tests exercise the
/// extension point rather than the database, and they hold against any cache substrate: the double
/// below is a plain dictionary, not <c>IMemoryCache</c> and not Redis.
/// </para>
/// </summary>
public class ProductCacheInvalidationTests
{
    private const ProductIdentifierType ProductId = 7;

    [Fact]
    public async Task Read_IsServedFromTheCache_OnTheSecondCall()
    {
        var cache = new DictionaryCache();
        var handler = new CountingQueryHandler(ProductResult());
        var read = new CachingQueryDecorator<GetProductByIdQuery, Result<ProductDTO>>(handler, cache);

        var first = await read.HandleAsync(new GetProductByIdQuery(ProductId));
        var second = await read.HandleAsync(new GetProductByIdQuery(ProductId));

        first.IsSuccess.Should().BeTrue();
        second.IsSuccess.Should().BeTrue();
        handler.Invocations.Should().Be(1, "the second read is a cache hit and never reaches the handler");
        cache.Keys.Should().ContainSingle().Which.Should().StartWith(
            ProductCacheKeys.Prefix,
            "a read stored outside the prefix the commands invalidate could never be evicted");
    }

    [Fact]
    public async Task SuccessfulCommand_EvictsThePrefix_SoTheNextReadMisses()
    {
        var cache = new DictionaryCache();
        var queryHandler = new CountingQueryHandler(ProductResult());
        var read = new CachingQueryDecorator<GetProductByIdQuery, Result<ProductDTO>>(queryHandler, cache);
        var write = new CachingCommandDecorator<UpdateProductCommand, Result<ProductDTO>>(
            new StubCommandHandler(ProductResult(price: 19.99m)), cache);

        await read.HandleAsync(new GetProductByIdQuery(ProductId));
        await read.HandleAsync(new GetProductByIdQuery(ProductId));
        queryHandler.Invocations.Should().Be(1, "the cache is warm before the write");

        var written = await write.HandleAsync(UpdateCommand());

        written.IsSuccess.Should().BeTrue();
        cache.Keys.Should().BeEmpty("a successful command evicts everything under its CachePrefix");

        var afterWrite = await read.HandleAsync(new GetProductByIdQuery(ProductId));

        afterWrite.IsSuccess.Should().BeTrue();
        queryHandler.Invocations.Should().Be(2, "the read after the write is a miss and re-runs the handler");
    }

    [Fact]
    public async Task FailedCommand_LeavesTheCachedReadInPlace()
    {
        var cache = new DictionaryCache();
        var queryHandler = new CountingQueryHandler(ProductResult());
        var read = new CachingQueryDecorator<GetProductByIdQuery, Result<ProductDTO>>(queryHandler, cache);
        var write = new CachingCommandDecorator<UpdateProductCommand, Result<ProductDTO>>(
            new StubCommandHandler(Result.Failure<ProductDTO>(Error.NotFound)), cache);

        await read.HandleAsync(new GetProductByIdQuery(ProductId));

        var written = await write.HandleAsync(UpdateCommand());

        written.IsFailure.Should().BeTrue();
        cache.RemoveByPrefixCalls.Should().Be(0, "a command that persisted nothing must not evict valid entries");

        await read.HandleAsync(new GetProductByIdQuery(ProductId));

        queryHandler.Invocations.Should().Be(1, "the entry survived the failed write, so this read is still a hit");
    }

    [Fact]
    public void EveryProductCommand_InvalidatesThePrefixTheReadIsKeyedUnder()
    {
        // Nothing at compile time ties CachePrefix to CacheKey: the decorator matches them as
        // strings. This is the test that keeps a renamed key from silently going stale.
        string readKey = new GetProductByIdQuery(ProductId).CacheKey;

        foreach (var command in AllProductCommands())
        {
            command.CachePrefix.Should().Be(ProductCacheKeys.Prefix);
            readKey.Should().StartWith(
                command.CachePrefix,
                $"{command.GetType().Name} would otherwise leave the cached product read behind");
        }
    }

    private static IEnumerable<ICacheInvalidating> AllProductCommands() =>
    [
        new ProductCreateRequest { Name = "Mechanical keyboard", Description = "Hot-swappable, 87 keys.", Price = 129.99m },
        UpdateCommand(),
        new DeleteProductCommand(ProductId),
    ];

    private static UpdateProductCommand UpdateCommand() =>
        new(ProductId, "Mechanical keyboard", "Hot-swappable, 87 keys.", Price: 129.99m);

    private static Result<ProductDTO> ProductResult(decimal price = 129.99m) =>
        Result.Success(new ProductDTO
        {
            Id = ProductId,
            Name = "Mechanical keyboard",
            Description = "Hot-swappable, 87 keys.",
            Price = price,
        });

    /// <summary>Counts how often the real handler is reached, which is what a cache hit prevents.</summary>
    private sealed class CountingQueryHandler(Result<ProductDTO> result)
        : IQueryHandler<GetProductByIdQuery, Result<ProductDTO>>
    {
        public int Invocations { get; private set; }

        public Task<Result<ProductDTO>> HandleAsync(
            GetProductByIdQuery query,
            CancellationToken cancellationToken = default)
        {
            Invocations++;
            return Task.FromResult(result);
        }
    }

    /// <summary>Stands in for the persistence-backed command handler, returning a fixed outcome.</summary>
    private sealed class StubCommandHandler(Result<ProductDTO> result)
        : ICommandHandler<UpdateProductCommand, Result<ProductDTO>>
    {
        public Task<Result<ProductDTO>> HandleAsync(
            UpdateProductCommand command,
            CancellationToken cancellationToken = default) => Task.FromResult(result);
    }

    /// <summary>
    /// Substrate-independent cache double. The behavior under test is prefix eviction, which every
    /// <see cref="ICacheService"/> implementation owes regardless of where it stores entries.
    /// </summary>
    private sealed class DictionaryCache : ICacheService
    {
        private readonly Dictionary<string, object> _entries = new(StringComparer.Ordinal);

        public int RemoveByPrefixCalls { get; private set; }

        public IReadOnlyCollection<string> Keys => _entries.Keys.ToArray();

        public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult(_entries.TryGetValue(key, out var value) ? (T)value : default);

        public Task SetAsync<T>(
            string key,
            T value,
            TimeSpan? expiration = null,
            CancellationToken cancellationToken = default)
        {
            if (value is not null)
            {
                _entries[key] = value;
            }

            return Task.CompletedTask;
        }

        public Task RemoveAsync(string key, CancellationToken cancellationToken = default)
        {
            _entries.Remove(key);
            return Task.CompletedTask;
        }

        public Task RemoveByPrefixAsync(string prefix, CancellationToken cancellationToken = default)
        {
            RemoveByPrefixCalls++;

            foreach (string key in _entries.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToArray())
            {
                _entries.Remove(key);
            }

            return Task.CompletedTask;
        }
    }
}
```

**Create** the four handler test classes, one per use case, under
`Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/UseCases/`. They all extend the
framework's `HandlerTestBase<THandler>`, whose `RegisterRepository` wires a mocked repository into a
mocked unit of work, so the handler resolves it exactly the way it does at run time.

`.../UseCases/CreateProductHandlerTests.cs` (3 tests):

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Domain.Interfaces;
using MMCA.Common.Testing;
using MMCA.ECommerce.Products.Application.Products.DTOs;
using MMCA.ECommerce.Products.Application.Products.UseCases.Create;
using MMCA.ECommerce.Products.Domain.Products;
using MMCA.ECommerce.Products.Shared.Products.IntegrationEvents;
using Moq;

namespace MMCA.ECommerce.Products.Application.Tests.UseCases;

/// <summary>
/// Unit tests for <see cref="CreateProductHandler"/>: the request maps through the domain factory, the
/// aggregate is added and committed, and the integration event is published AFTER the save so it
/// carries the database-generated id.
/// </summary>
public class CreateProductHandlerTests : HandlerTestBase<CreateProductHandler>
{
    private readonly Mock<IRepository<Product, ProductIdentifierType>> _repository;
    private readonly Mock<IEventBus> _eventBus = new();
    private readonly CreateProductHandler _sut;

    public CreateProductHandlerTests()
    {
        _repository = RegisterRepository<Product, ProductIdentifierType>();
        _sut = new CreateProductHandler(
            UnitOfWork.Object,
            new ProductCreateRequestMapper(),
            _eventBus.Object,
            new ProductDTOMapper());
    }

    [Fact]
    public async Task HandleAsync_WithValidRequest_PersistsAndReturnsTheDTO()
    {
        var result = await _sut.HandleAsync(Request());

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Mechanical keyboard");
        result.Value.Description.Should().Be("Hot-swappable, 87 keys.");
        result.Value.Price.Should().Be(129.99m);
        _repository.Verify(r => r.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()), Times.Once);
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WithValidRequest_PublishesTheCreatedIntegrationEvent()
    {
        await _sut.HandleAsync(Request());

        _eventBus.Verify(
            b => b.PublishAsync(
                It.Is<IIntegrationEvent>(e =>
                    e is ProductCreatedIntegrationEvent
                    && ((ProductCreatedIntegrationEvent)e).Name == "Mechanical keyboard"
                    && ((ProductCreatedIntegrationEvent)e).Price == 129.99m),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WithNonPositivePrice_FailsWithoutTouchingPersistence()
    {
        var result = await _sut.HandleAsync(Request(price: 0m));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
        _repository.Verify(r => r.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()), Times.Never);
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        _eventBus.Verify(
            b => b.PublishAsync(It.IsAny<IIntegrationEvent>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    private static ProductCreateRequest Request(decimal price = 129.99m) => new()
    {
        Name = "Mechanical keyboard",
        Description = "Hot-swappable, 87 keys.",
        Price = price,
    };
}
```

`.../UseCases/UpdateProductHandlerTests.cs` (4 tests):

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Testing;
using MMCA.ECommerce.Products.Application.Products.DTOs;
using MMCA.ECommerce.Products.Application.Products.UseCases.Update;
using MMCA.ECommerce.Products.Domain.Products;
using Moq;

namespace MMCA.ECommerce.Products.Application.Tests.UseCases;

/// <summary>
/// Unit tests for <see cref="UpdateProductHandler"/>: a missing aggregate is a NotFound failure, an
/// invariant breach never reaches the save, and the client's concurrency token is stamped back per
/// ADR-035 before the mutation.
/// </summary>
public class UpdateProductHandlerTests : HandlerTestBase<UpdateProductHandler>
{
    private static readonly byte[] RowVersion = [1, 2, 3, 4];

    private readonly Mock<IRepository<Product, ProductIdentifierType>> _repository;
    private readonly UpdateProductHandler _sut;

    public UpdateProductHandlerTests()
    {
        _repository = RegisterRepository<Product, ProductIdentifierType>();
        _sut = new UpdateProductHandler(UnitOfWork.Object, new ProductDTOMapper());
    }

    [Fact]
    public async Task HandleAsync_WithValidCommand_UpdatesAndReturnsTheRefreshedDTO()
    {
        var product = ExistingProduct();
        GivenProductIsFound(product);

        var result = await _sut.HandleAsync(Command());

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Wireless mouse");
        result.Value.Price.Should().Be(59.95m);
        product.Name.Should().Be("Wireless mouse");
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_StampsTheClientRowVersionBeforeMutating()
    {
        var product = ExistingProduct();
        GivenProductIsFound(product);

        await _sut.HandleAsync(Command());

        _repository.Verify(r => r.SetOriginalRowVersion(product, RowVersion), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WhenTheProductIsMissing_ReturnsNotFound()
    {
        GivenProductIsFound(null);

        var result = await _sut.HandleAsync(Command());

        result.IsFailure.Should().BeTrue();
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task HandleAsync_WithNonPositivePrice_FailsWithoutSaving()
    {
        var product = ExistingProduct();
        GivenProductIsFound(product);

        var result = await _sut.HandleAsync(Command(price: -1m));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
        product.Price.Should().Be(129.99m, "a rejected mutation leaves the aggregate untouched");
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    private static Product ExistingProduct() =>
        Product.Create(id: null, "Mechanical keyboard", "Hot-swappable, 87 keys.", price: 129.99m).Value!;

    private static UpdateProductCommand Command(decimal price = 59.95m) =>
        new(ProductId: 7, "Wireless mouse", "Silent click, 4000 dpi.", price) { RowVersion = RowVersion };

    private void GivenProductIsFound(Product? product) =>
        _repository
            .Setup(r => r.GetByIdAsync(
                7,
                It.IsAny<IEnumerable<string>>(),
                true,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);
}
```

`.../UseCases/DeleteProductHandlerTests.cs` (2 tests):

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Domain.Enums;
using MMCA.Common.Testing;
using MMCA.ECommerce.Products.Application.Products.UseCases.Delete;
using MMCA.ECommerce.Products.Domain.Products;
using MMCA.ECommerce.Products.Domain.Products.DomainEvents;
using Moq;

namespace MMCA.ECommerce.Products.Application.Tests.UseCases;

/// <summary>
/// Unit tests for <see cref="DeleteProductHandler"/>: the aggregate is loaded tracked, soft-deleted
/// through its own guarded method (which raises the Deleted domain event), and committed once.
/// </summary>
public class DeleteProductHandlerTests : HandlerTestBase<DeleteProductHandler>
{
    private readonly Mock<IRepository<Product, ProductIdentifierType>> _repository;
    private readonly DeleteProductHandler _sut;

    public DeleteProductHandlerTests()
    {
        _repository = RegisterRepository<Product, ProductIdentifierType>();
        _sut = new DeleteProductHandler(UnitOfWork.Object);
    }

    [Fact]
    public async Task HandleAsync_SoftDeletesTheProductAndRaisesTheDeletedEvent()
    {
        var product = ExistingProduct();
        GivenProductIsFound(product);

        var result = await _sut.HandleAsync(new DeleteProductCommand(7));

        result.IsSuccess.Should().BeTrue();
        product.IsDeleted.Should().BeTrue();
        product.DomainEvents.OfType<ProductChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Deleted);
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WhenTheProductIsMissing_ReturnsNotFound()
    {
        GivenProductIsFound(null);

        var result = await _sut.HandleAsync(new DeleteProductCommand(7));

        result.IsFailure.Should().BeTrue();
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    private static Product ExistingProduct() =>
        Product.Create(id: null, "Mechanical keyboard", "Hot-swappable, 87 keys.", price: 129.99m).Value!;

    private void GivenProductIsFound(Product? product) =>
        _repository
            .Setup(r => r.GetByIdAsync(
                7,
                It.IsAny<IEnumerable<string>>(),
                true,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);
}
```

`.../UseCases/GetProductByIdHandlerTests.cs` (3 tests). Its `GetReadRepository` assertion is what pins
the read path to a non-tracking read:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Testing;
using MMCA.ECommerce.Products.Application.Products.DTOs;
using MMCA.ECommerce.Products.Application.Products.UseCases.GetById;
using MMCA.ECommerce.Products.Domain.Products;
using Moq;

namespace MMCA.ECommerce.Products.Application.Tests.UseCases;

/// <summary>
/// Unit tests for <see cref="GetProductByIdHandler"/>: a no-tracking read that maps the aggregate to
/// its DTO, or reports NotFound when the id resolves to nothing (soft-deleted rows are filtered out
/// by the EF global query filter, so they arrive here as null).
/// </summary>
public class GetProductByIdHandlerTests : HandlerTestBase<GetProductByIdHandler>
{
    private readonly Mock<IRepository<Product, ProductIdentifierType>> _repository;
    private readonly GetProductByIdHandler _sut;

    public GetProductByIdHandlerTests()
    {
        _repository = RegisterRepository<Product, ProductIdentifierType>();
        _sut = new GetProductByIdHandler(UnitOfWork.Object, new ProductDTOMapper());
    }

    [Fact]
    public async Task HandleAsync_WhenTheProductExists_ReturnsTheMappedDTO()
    {
        GivenProductIsFound(ExistingProduct());

        var result = await _sut.HandleAsync(new GetProductByIdQuery(7));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Mechanical keyboard");
        result.Value.Description.Should().Be("Hot-swappable, 87 keys.");
        result.Value.Price.Should().Be(129.99m);
    }

    [Fact]
    public async Task HandleAsync_ReadsWithoutTracking()
    {
        GivenProductIsFound(ExistingProduct());

        await _sut.HandleAsync(new GetProductByIdQuery(7));

        _repository.Verify(
            r => r.GetByIdAsync(7, It.IsAny<IEnumerable<string>>(), false, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WhenTheProductIsMissing_ReturnsNotFound()
    {
        GivenProductIsFound(null);

        var result = await _sut.HandleAsync(new GetProductByIdQuery(7));

        result.IsFailure.Should().BeTrue();
    }

    private static Product ExistingProduct() =>
        Product.Create(id: null, "Mechanical keyboard", "Hot-swappable, 87 keys.", price: 129.99m).Value!;

    private void GivenProductIsFound(Product? product) =>
        _repository
            .Setup(r => r.GetByIdAsync(
                7,
                It.IsAny<IEnumerable<string>>(),
                false,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);
}
```

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
the slices that orchestrate them. As before, every file shown is the finished file from the
build-verified sample. All paths are relative to the solution root, and every command is PowerShell.

The scaffolded before-state, for orientation: `OrderItem` carries `Body` and `AuthorUserId`,
`OrderStatus` is `Open` / `InProgress` / `Resolved` / `Closed`, and the aggregate has `Title`,
`Description`, and `RequesterUserId`.

### 5.1 Shared contracts

The identifier aliases need no edit at all: `--child Item` already emitted `OrderIdentifierType` and
`OrderItemIdentifierType`.

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderStatus.cs`. The scaffold
ships a flat set of ticket states; this is a lifecycle, and the doc comment is where the legal
transitions are written down for a reader who will not go looking for the invariant:

```csharp
namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Lifecycle status of an order. The legal transitions are Pending to Paid to Shipped, with
/// Cancelled reachable from Pending or Paid; Shipped and Cancelled are terminal.
/// <c>OrderInvariants.EnsureStatusTransitionIsValid</c> is the single place that rule is enforced.
/// </summary>
public enum OrderStatus
{
    Pending = 0,
    Paid = 1,
    Shipped = 2,
    Cancelled = 3,
}
```

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderDTO.cs`. `Title`,
`Description`, and `RequesterUserId` collapse into `CustomerName`, and `Total` is new. The `Total`
remarks are load-bearing documentation, not decoration: only the detail read eager-loads `Items`, so
`Total` is 0 on the list and paged projections, and the fix for a caller who needs the number is to
ask the detail endpoint, not to widen the list query:

```csharp
using MMCA.Common.Shared.DTOs;

namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Read model for an <c>Order</c> aggregate returned by the API. Exposes the current
/// <see cref="RowVersion"/> so a client can echo it back on <c>OrderUpdateRequest</c> (ADR-035).
/// <para>
/// <see cref="Total"/> is computed by the aggregate from its live items, so it only carries a
/// meaningful figure when <see cref="Items"/> was loaded. The list path (GetAll / paged) does not
/// include the child collection, so <see cref="Items"/> comes back empty there and
/// <see cref="Total"/> reads 0. Call the details endpoint when the total matters.
/// </para>
/// </summary>
public record class OrderDTO : IBaseDTO<OrderIdentifierType>, IConcurrencyAware
{
    public required OrderIdentifierType Id { get; init; }

    /// <inheritdoc />
    public byte[]? RowVersion { get; init; }
    public required string CustomerName { get; init; }
    public required OrderStatus Status { get; init; }

    /// <summary>Sum of unit price times quantity over the live items; 0 on the list path.</summary>
    public decimal Total { get; init; }
    public IReadOnlyCollection<OrderItemDTO> Items { get; init; } = [];
}
```

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderItemDTO.cs`. The
scaffold's `Body` and `AuthorUserId` become the four snapshot properties:

```csharp
using MMCA.Common.Shared.DTOs;

namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Read model for an <c>OrderItem</c> child entity. Carries the product snapshot the order captured
/// when the item was added, not a live lookup against another module.
/// </summary>
public record class OrderItemDTO : IBaseDTO<OrderItemIdentifierType>
{
    public required OrderItemIdentifierType Id { get; init; }
    public required int ProductId { get; init; }
    public required string ProductName { get; init; }
    public required decimal UnitPrice { get; init; }
    public required int Quantity { get; init; }
}
```

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderUpdateRequest.cs`. It is
small, and the `*UpdateRequest` suffix must survive: the shared `UpdateRequestsAreConcurrencyAware`
fitness rule matches on that name:

```csharp
using MMCA.Common.Shared.DTOs;

namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Request body for updating an order's customer name (the order id comes from the route).
/// Round-trips the optimistic-concurrency token per ADR-035: the client echoes the
/// <see cref="RowVersion"/> it last read so a conflicting concurrent edit surfaces as 409 instead
/// of silently last-write-winning. Named with the <c>*UpdateRequest</c> suffix so the shared
/// <c>UpdateRequestsAreConcurrencyAware</c> fitness rule covers it.
/// </summary>
public sealed record class OrderUpdateRequest : IConcurrencyAware
{
    /// <inheritdoc />
    public byte[]? RowVersion { get; init; }

    /// <summary>The new customer name.</summary>
    public required string CustomerName { get; init; }
}
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/AddOrderItemRequest.cs`. Read
the doc comment: the caller supplies the name and price to snapshot, and that is the wire-level half
of the module-isolation decision above:

```csharp
namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Request body for adding an item to an order (the order id comes from the route). The caller
/// supplies the product snapshot, so the Orders module never has to reach into another module.
/// </summary>
/// <param name="ProductId">The identifier of the product being ordered.</param>
/// <param name="ProductName">The product name as of the moment the item was added.</param>
/// <param name="UnitPrice">The unit price as of the moment the item was added.</param>
/// <param name="Quantity">How many units were ordered.</param>
public sealed record AddOrderItemRequest(
    int ProductId,
    string ProductName,
    decimal UnitPrice,
    int Quantity);
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/ChangeOrderItemQuantityRequest.cs`,
which replaces the scaffold's free-text `EditItemRequest(string Body)`:

```csharp
namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Request body for changing an item's quantity (the order id and item id come from the route).
/// </summary>
/// <param name="Quantity">The new quantity; must be greater than zero.</param>
public sealed record ChangeOrderItemQuantityRequest(int Quantity);
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/IntegrationEvents/OrderPlacedIntegrationEvent.cs`:

```csharp
using MMCA.Common.Domain.DomainEvents;

namespace MMCA.ECommerce.Orders.Shared.Orders.IntegrationEvents;

/// <summary>
/// Raised when an order is placed. Lives in the Shared layer so other modules (or extracted
/// services) can consume it without referencing Orders.Domain. Carries the framework
/// <see cref="BaseIntegrationEvent.SchemaVersion"/> (default 1, ADR-010): a breaking change uses a
/// new event type plus an upcaster, never a silent reshape of this contract.
/// </summary>
/// <param name="OrderId">The newly placed order's database-generated identifier.</param>
/// <param name="CustomerName">The customer the order was placed for.</param>
public sealed record class OrderPlacedIntegrationEvent(
    OrderIdentifierType OrderId,
    string CustomerName)
    : BaseIntegrationEvent;
```

**Delete** the three Shared files the reshape replaces. `ChangeOrderStatusRequest.cs` stays exactly as
generated: `record ChangeOrderStatusRequest(OrderStatus Status)` is already the right shape, and the
enum it names is the one you just rewrote.

```powershell
Remove-Item `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\AddItemRequest.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\EditItemRequest.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\IntegrationEvents\OrderOpenedIntegrationEvent.cs
```

### 5.2 Domain

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderInvariants.cs` with the
complete file below. Six methods, eight error codes, and every one of those codes is a code you will
localize in 5.5: the two customer-name codes, the two product-name codes, the unit price, the
quantity, the item lock, and the status transition. The two app-specific rules at the bottom
(`Order.ItemsLocked` and `Order.InvalidStatusTransition`) are the invariant half of the second
architecture decision. The transition switch lists every enum member explicitly rather than leaning on
the discard arm, which is both what `IDE0072` asks for and what turns adding a status into a
compile-time prompt to decide where it can go:

```csharp
using MMCA.Common.Domain.Invariants;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Shared.Orders;

namespace MMCA.ECommerce.Orders.Domain.Orders;

/// <summary>
/// Business invariants for the <c>Order</c> aggregate. Each method returns a <see cref="Result"/>
/// so callers can compose them with <see cref="Result.Combine(System.ReadOnlySpan{Result})"/>.
/// The string checks delegate to the framework's <see cref="CommonInvariants"/> helpers, so each
/// field reports a distinct empty vs too-long error; only the app-specific rules and the
/// length constants live here.
/// </summary>
public static class OrderInvariants
{
    public const int CustomerNameMaxLength = 200;
    public const int ItemProductNameMaxLength = 200;

    public static Result EnsureCustomerNameIsValid(string customerName, string source)
        => Result.Combine(
            CommonInvariants.EnsureStringIsNotEmpty(customerName, "Order.CustomerName.Empty", "Order customer name cannot be empty.", source, nameof(customerName)),
            CommonInvariants.EnsureStringMaxLength(customerName, CustomerNameMaxLength, "Order.CustomerName.TooLong", $"Order customer name cannot exceed {CustomerNameMaxLength} characters.", source, nameof(customerName)));

    public static Result EnsureItemProductNameIsValid(string productName, string source)
        => Result.Combine(
            CommonInvariants.EnsureStringIsNotEmpty(productName, "Order.Item.ProductName.Empty", "Item product name cannot be empty.", source, nameof(productName)),
            CommonInvariants.EnsureStringMaxLength(productName, ItemProductNameMaxLength, "Order.Item.ProductName.TooLong", $"Item product name cannot exceed {ItemProductNameMaxLength} characters.", source, nameof(productName)));

    public static Result EnsureUnitPriceIsValid(decimal unitPrice, string source)
        => unitPrice > 0m
            ? Result.Success()
            : Result.Failure(Error.Invariant(
                code: "Order.InvalidUnitPrice",
                message: "Item unit price must be greater than zero.",
                source: source,
                target: nameof(unitPrice)));

    public static Result EnsureQuantityIsValid(int quantity, string source)
        => CommonInvariants.EnsureIntIsPositive(
            quantity,
            "Order.InvalidQuantity",
            "Item quantity must be greater than zero.",
            source,
            nameof(quantity));

    /// <summary>
    /// Item add / change / remove is only legal while the order is still Pending: once it is paid
    /// the line items are what was charged, so they stop being editable.
    /// </summary>
    public static Result EnsureStatusAllowsItemChanges(OrderStatus status, string source)
        => status == OrderStatus.Pending
            ? Result.Success()
            : Result.Failure(Error.Invariant(
                code: "Order.ItemsLocked",
                message: "Items can only be changed while the order is pending.",
                source: source,
                target: nameof(status)));

    /// <summary>
    /// The one place the order lifecycle is encoded: Pending to Paid to Shipped, Cancelled from
    /// Pending or Paid, and nothing at all out of the two terminal states. Every enum member has
    /// its own arm so adding a status is a compile-time prompt to decide where it can go.
    /// </summary>
    public static Result EnsureStatusTransitionIsValid(OrderStatus current, OrderStatus next, string source)
    {
        bool allowed = current switch
        {
            OrderStatus.Pending => next is OrderStatus.Paid or OrderStatus.Cancelled,
            OrderStatus.Paid => next is OrderStatus.Shipped or OrderStatus.Cancelled,
            OrderStatus.Shipped => false,
            OrderStatus.Cancelled => false,
            _ => false,
        };

        return allowed
            ? Result.Success()
            : Result.Failure(Error.Invariant(
                code: "Order.InvalidStatusTransition",
                message: "The order cannot move to that status from its current one.",
                source: source,
                target: nameof(next)));
    }
}
```

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderItem.cs`. `Body` and
`AuthorUserId` become the four snapshot properties, and `EditBody` becomes `ChangeQuantity`.
`ProductId` is a plain `int`, deliberately not a `ProductIdentifierType` and deliberately not a
foreign key: the Orders module must not name a Products type at all:

```csharp
using MMCA.Common.Domain.Attributes;
using MMCA.Common.Domain.Entities;
using MMCA.Common.Domain.Extensions;
using MMCA.Common.Shared.Abstractions;

namespace MMCA.ECommerce.Orders.Domain.Orders;

/// <summary>
/// A line item on an <see cref="Order"/>. Child entity of the Order aggregate; created and managed
/// through the aggregate root, never directly.
/// </summary>
[IdValueGenerated]
public sealed class OrderItem : AuditableBaseEntity<OrderItemIdentifierType>
{
    [Navigation]
    public Order? Order { get; set; }

    public OrderIdentifierType OrderId { get; init; }

    // Product snapshot, not a live reference: the name and the price are copied in at the moment
    // the item is added, so a later catalog rename or repricing cannot rewrite what was ordered.
    // It is also what keeps this module free of any reference to the Products module: the caller
    // hands over the four scalars and the order owns them from then on.
    public int ProductId { get; private set; }

    public string ProductName { get; private set; }

    public decimal UnitPrice { get; private set; }

    public int Quantity { get; private set; }

    private OrderItem(int productId, string productName, decimal unitPrice, int quantity)
    {
        ProductId = productId;
        ProductName = productName;
        UnitPrice = unitPrice;
        Quantity = quantity;
    }

    public static Result<OrderItem> Create(
        OrderItemIdentifierType? id,
        int productId,
        string productName,
        decimal unitPrice,
        int quantity)
    {
        var validation = Result.Combine(
            OrderInvariants.EnsureItemProductNameIsValid(productName, nameof(Create)),
            OrderInvariants.EnsureUnitPriceIsValid(unitPrice, nameof(Create)),
            OrderInvariants.EnsureQuantityIsValid(quantity, nameof(Create)));
        if (validation.IsFailure)
        {
            return Result.Failure<OrderItem>(validation.Errors);
        }

        bool isIdValueGenerated = typeof(OrderItem).IsIdValueGenerated;

        var item = new OrderItem(productId, productName, unitPrice, quantity)
        {
            Id = isIdValueGenerated ? default : id!.Value,
        };

        return Result.Success(item);
    }

    /// <summary>
    /// Changes how many units were ordered. The unit price stays frozen at its snapshot value: a
    /// quantity edit is not a repricing.
    /// </summary>
    public Result ChangeQuantity(int quantity)
    {
        var validation = OrderInvariants.EnsureQuantityIsValid(quantity, nameof(ChangeQuantity));
        if (validation.IsFailure)
        {
            return validation;
        }

        Quantity = quantity;

        return Result.Success();
    }
}
```

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/Order.cs` with the complete
file below. Three things to notice while pasting: every item mutation asks
`EnsureStatusAllowsItemChanges` **first**, `Total` is computed rather than stored (so it cannot drift
from the lines), and re-asserting the current status is an idempotent no-op success that raises no
event, which is what makes a retried status call safe. The cascade soft-delete in `Delete()` is the
scaffold's, kept as generated:

```csharp
using MMCA.Common.Domain.Attributes;
using MMCA.Common.Domain.Entities;
using MMCA.Common.Domain.Enums;
using MMCA.Common.Domain.Extensions;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Domain.Orders.DomainEvents;
using MMCA.ECommerce.Orders.Shared.Orders;

namespace MMCA.ECommerce.Orders.Domain.Orders;

/// <summary>
/// Customer-order aggregate root. Created through the <see cref="Create"/> factory (returns a
/// <see cref="Result{T}"/>), mutated through guarded methods that raise <see cref="OrderChanged"/>
/// domain events. Line items are growable children managed via <see cref="AddItem"/>, and only
/// while the order is still Pending.
/// </summary>
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

    private Order(string customerName)
    {
        CustomerName = customerName;
        Status = OrderStatus.Pending;
    }

    public static Result<Order> Create(
        OrderIdentifierType? id,
        string customerName)
    {
        var validation = OrderInvariants.EnsureCustomerNameIsValid(customerName, nameof(Create));
        if (validation.IsFailure)
        {
            return Result.Failure<Order>(validation.Errors);
        }

        bool isIdValueGenerated = typeof(Order).IsIdValueGenerated;

        var order = new Order(customerName)
        {
            Id = isIdValueGenerated ? default : id!.Value,
        };

        // No "Added" domain event here: the Id is database-generated (still 0 at this point), so an
        // event captured now would carry a meaningless id. Creation is signalled by the
        // OrderPlacedIntegrationEvent that CreateOrderHandler publishes AFTER the commit, with the
        // real id.
        return Result.Success(order);
    }

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

        var itemResult = OrderItem.Create(id, productId, productName, unitPrice, quantity);
        if (itemResult.IsFailure)
        {
            return Result.Failure<OrderItem>(itemResult.Errors);
        }

        var item = itemResult.Value!;
        _items.Add(item);
        AddDomainEvent(new OrderChanged(DomainEntityState.Updated, Id));

        return Result.Success(item);
    }

    public Result UpdateDetails(string customerName)
    {
        var validation = OrderInvariants.EnsureCustomerNameIsValid(customerName, nameof(UpdateDetails));
        if (validation.IsFailure)
        {
            return validation;
        }

        CustomerName = customerName;
        AddDomainEvent(new OrderChanged(DomainEntityState.Updated, Id));

        return Result.Success();
    }

    public Result ChangeItemQuantity(OrderItemIdentifierType itemId, int quantity)
    {
        var statusValidation = OrderInvariants.EnsureStatusAllowsItemChanges(Status, nameof(ChangeItemQuantity));
        if (statusValidation.IsFailure)
        {
            return statusValidation;
        }

        var itemResult = GetChildOrNotFound(_items, itemId, nameof(ChangeItemQuantity));
        if (itemResult.IsFailure)
        {
            return Result.Failure(itemResult.Errors);
        }

        var changeResult = itemResult.Value!.ChangeQuantity(quantity);
        if (changeResult.IsFailure)
        {
            return changeResult;
        }

        AddDomainEvent(new OrderChanged(DomainEntityState.Updated, Id));

        return Result.Success();
    }

    public Result RemoveItem(OrderItemIdentifierType itemId)
    {
        var statusValidation = OrderInvariants.EnsureStatusAllowsItemChanges(Status, nameof(RemoveItem));
        if (statusValidation.IsFailure)
        {
            return statusValidation;
        }

        var itemResult = GetChildOrNotFound(_items, itemId, nameof(RemoveItem));
        if (itemResult.IsFailure)
        {
            return Result.Failure(itemResult.Errors);
        }

        var deleteResult = itemResult.Value!.Delete();
        if (deleteResult.IsFailure)
        {
            return deleteResult;
        }

        AddDomainEvent(new OrderChanged(DomainEntityState.Updated, Id));

        return Result.Success();
    }

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

    public override Result Delete()
    {
        var result = base.Delete();
        if (result.IsFailure)
        {
            return result;
        }

        foreach (var item in _items.Where(c => !c.IsDeleted))
        {
            item.Delete();
        }

        AddDomainEvent(new OrderChanged(DomainEntityState.Deleted, Id));

        return result;
    }
}
```

`OrderChanged.cs` needs no edit: unlike Products, the scaffolded Orders event summary already reads
correctly for an aggregate whose creation is signalled by an integration event.

### 5.3 Infrastructure

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/OrderConfiguration.cs`.
Two lines here are easy to skip and expensive to omit: `Status` is persisted as a **string** (that is
the scaffold's line, kept), so a later reordering of the enum cannot silently reinterpret stored rows,
and `builder.Ignore(o => o.Total)` keeps EF from trying to map the computed getter (without it the
model build fails outright):

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration;
using MMCA.ECommerce.Orders.Domain.Orders;

namespace MMCA.ECommerce.Orders.Infrastructure.Persistence.EntityConfiguration;

/// <summary>
/// EF Core configuration for the <see cref="Order"/> aggregate. <c>base.Configure</c> wires the Id,
/// soft-delete flag + query filter, audit fields, and concurrency token from the framework base.
/// </summary>
internal sealed class OrderConfiguration : EntityTypeConfigurationSQLServer<Order, OrderIdentifierType>
{
    public override void Configure(EntityTypeBuilder<Order> builder)
    {
        base.Configure(builder);

        builder.Property(p => p.CustomerName)
            .HasMaxLength(OrderInvariants.CustomerNameMaxLength)
            .IsRequired();

        builder.Property(p => p.Status)
            .HasConversion<string>()
            .HasMaxLength(32)
            .IsRequired();

        // Total is derived from the items in the domain, so there is no column to map. Without this
        // EF would try to persist a read-only property and fail at model build.
        builder.Ignore(o => o.Total);

        builder.HasIndex(p => p.CustomerName)
            .HasFilter("[IsDeleted] = 0");

        builder.HasMany(p => p.Items)
            .WithOne(c => c.Order)
            .HasForeignKey(c => c.OrderId)
            .IsRequired();
    }
}
```

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/OrderItemConfiguration.cs`.
The `using Microsoft.EntityFrameworkCore;` at the top is new, because `HasColumnType` needs it:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration;
using MMCA.ECommerce.Orders.Domain.Orders;

namespace MMCA.ECommerce.Orders.Infrastructure.Persistence.EntityConfiguration;

/// <summary>
/// EF Core configuration for the <see cref="OrderItem"/> child entity. The parent
/// <see cref="OrderConfiguration"/> owns the relationship; this configures the item's own columns.
/// </summary>
internal sealed class OrderItemConfiguration
    : EntityTypeConfigurationSQLServer<OrderItem, OrderItemIdentifierType>
{
    public override void Configure(EntityTypeBuilder<OrderItem> builder)
    {
        base.Configure(builder);

        builder.Property(p => p.ProductId)
            .IsRequired();

        builder.Property(p => p.ProductName)
            .HasMaxLength(OrderInvariants.ItemProductNameMaxLength)
            .IsRequired();

        // Money column: an explicit scale, not the SQL Server decimal default, so a price never
        // silently rounds on the way in.
        builder.Property(p => p.UnitPrice)
            .HasColumnType("decimal(18,2)")
            .IsRequired();

        builder.Property(p => p.Quantity)
            .IsRequired();
    }
}
```

`ModuleApplicationDbContext` needs no edit: `--child Item` already declared `DbSet<OrderItem>`
alongside `DbSet<Order>`.

### 5.4 Application

**Rewrite** the Create slice. An order is placed empty and grows lines afterwards, so the create
payload is just a customer name.

`Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/UseCases/Create/OrderCreateRequest.cs`:

```csharp
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.Create;

/// <summary>
/// Command/request to place a new order. Used directly as the command (validated by the pipeline's
/// Validating decorator via <see cref="OrderCreateRequestValidator"/>); implements
/// <see cref="ICacheInvalidating"/> so cached order reads are evicted after a successful create.
/// The order starts Pending and empty; items are added afterwards through the items endpoints.
/// </summary>
public record class OrderCreateRequest : ICreateRequest, ICacheInvalidating
{
    public string CachePrefix => OrderCacheKeys.Prefix;

    public required string CustomerName { get; init; }
}
```

In `.../UseCases/Create/OrderCreateRequestMapper.cs`, the doc comment gains an `n` and the factory
call loses two arguments:

```csharp
/// Maps an <see cref="OrderCreateRequest"/> to a new <see cref="Order"/> via the domain factory.
```

```csharp
        return Task.FromResult(Order.Create(
            id: null,
            customerName: request.CustomerName));
```

`.../UseCases/Create/OrderCreateRequestValidator.cs` drops to one rule, so the constructor becomes an
expression body:

```csharp
using FluentValidation;
using MMCA.ECommerce.Orders.Domain.Orders;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.Create;

/// <summary>
/// FluentValidation rules for <see cref="OrderCreateRequest"/>, applied by the pipeline's
/// Validating decorator before the transaction opens.
/// </summary>
public sealed class OrderCreateRequestValidator : AbstractValidator<OrderCreateRequest>
{
    public OrderCreateRequestValidator() =>
        RuleFor(x => x.CustomerName).NotEmpty().MaximumLength(OrderInvariants.CustomerNameMaxLength);
}
```

In `.../UseCases/Create/CreateOrderHandler.cs`, two summary lines and one call change. The handler
still publishes after the commit, so the database-generated id is populated by the time the event
reaches consumers:

```csharp
/// Places a new order: maps the request through the domain factory, persists via the unit of work
```

```csharp
/// <see cref="OrderPlacedIntegrationEvent"/> for cross-module/cross-service consumers. Wrapped by
```

```csharp
            new OrderPlacedIntegrationEvent(entity.Id, entity.CustomerName),
```

**Rewrite** `.../UseCases/Update/UpdateOrderCommand.cs`: the record loses two parameters.

```csharp
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.Update;

/// <summary>
/// Command to update an order's customer name. Evicts cached order reads on success.
/// Carries the client's last-seen concurrency token (ADR-035); null skips the conflict check.
/// </summary>
public sealed record UpdateOrderCommand(
    OrderIdentifierType OrderId,
    string CustomerName)
    : ICacheInvalidating
{
    /// <summary>The client's last-seen concurrency token; null skips the conflict check (ADR-035).</summary>
    public byte[]? RowVersion { get; init; }

    public string CachePrefix => OrderCacheKeys.Prefix;
}
```

In `.../UseCases/Update/UpdateOrderHandler.cs`, change the summary and the call into the aggregate:

```csharp
/// Updates an order's customer name through the aggregate root, then returns the refreshed DTO.
```

```csharp
        var result = order.UpdateDetails(command.CustomerName);
```

**Rewrite** `.../UseCases/AddItem/AddItemCommand.cs`. The two scaffolded scalars become four, and the
doc comment records why they travel on the command instead of being looked up:

```csharp
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.AddItem;

/// <summary>
/// Command to append an item to an existing order. Carries the product snapshot (id, name, unit
/// price) rather than only a product id, so the Orders module never calls into another module to
/// resolve it. Implements <see cref="ICacheInvalidating"/> so cached order reads are evicted after
/// a successful add.
/// </summary>
public sealed record AddItemCommand(
    OrderIdentifierType OrderId,
    int ProductId,
    string ProductName,
    decimal UnitPrice,
    int Quantity)
    : ICacheInvalidating
{
    public string CachePrefix => OrderCacheKeys.Prefix;
}
```

In `.../UseCases/AddItem/AddItemHandler.cs`, the summary gains an `n` and the aggregate call takes the
four scalars. The handler already returns `Result<OrderItemDTO>` and already loads
`includes: [nameof(Order.Items)]` tracked, which is what lets the aggregate enforce the item lock and
recompute the total, so neither changes:

```csharp
/// Loads the order (tracked, with its items), appends an item through the aggregate root, and
```

```csharp
        var result = order.AddItem(
            id: null,
            command.ProductId,
            command.ProductName,
            command.UnitPrice,
            command.Quantity);
```

**Create** the `ChangeItemQuantity` slice, which replaces the scaffold's `EditItem`. Quantity is the
only mutable field on a line: the product snapshot and its price stay as captured.

`.../UseCases/ChangeItemQuantity/ChangeItemQuantityCommand.cs`:

```csharp
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeItemQuantity;

/// <summary>
/// Command to change the quantity of an existing item on an order. Quantity is the only mutable
/// field on an item: the product snapshot and its price stay as captured.
/// </summary>
public sealed record ChangeItemQuantityCommand(
    OrderIdentifierType OrderId,
    OrderItemIdentifierType ItemId,
    int Quantity) : ICacheInvalidating
{
    public string CachePrefix => OrderCacheKeys.Prefix;
}
```

`.../UseCases/ChangeItemQuantity/ChangeItemQuantityHandler.cs`:

```csharp
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Application.UseCases;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Domain.Orders;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeItemQuantity;

/// <summary>
/// Changes an item's quantity through the order aggregate (loaded tracked with its items).
/// </summary>
public sealed class ChangeItemQuantityHandler(IUnitOfWork unitOfWork)
    : ICommandHandler<ChangeItemQuantityCommand, Result>
{
    public async Task<Result> HandleAsync(ChangeItemQuantityCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var repository = unitOfWork.GetRepository<Order, OrderIdentifierType>();
        var order = await repository.GetByIdAsync(
            command.OrderId,
            includes: [nameof(Order.Items)],
            asTracking: true,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        if (order is null)
        {
            return Result.Failure(
                Error.NotFound.WithSource(nameof(ChangeItemQuantityHandler)).WithTarget(nameof(Order)));
        }

        var result = order.ChangeItemQuantity(command.ItemId, command.Quantity);
        if (result.IsFailure)
        {
            return result;
        }

        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return Result.Success();
    }
}
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/IntegrationEventHandlers/OrderPlacedHandler.cs`:

```csharp
using Microsoft.Extensions.Logging;
using MMCA.Common.Application.Interfaces;
using MMCA.ECommerce.Orders.Shared.Orders.IntegrationEvents;

namespace MMCA.ECommerce.Orders.Application.Orders.IntegrationEventHandlers;

/// <summary>
/// Consumes <see cref="OrderPlacedIntegrationEvent"/>. In this monolith seed it just logs; in a real
/// system this is where a notification/email/analytics side effect would live. The same handler runs
/// in-process now and over the broker once the Orders module is extracted (ADR-003 / ADR-008).
/// Auto-discovered by Scrutor (singleton lifetime); the dispatcher routes the outbox-published event here.
/// </summary>
public sealed partial class OrderPlacedHandler(ILogger<OrderPlacedHandler> logger)
    : IIntegrationEventHandler<OrderPlacedIntegrationEvent>
{
    public Task HandleAsync(OrderPlacedIntegrationEvent integrationEvent, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(integrationEvent);

        LogOrderPlaced(logger, integrationEvent.OrderId, integrationEvent.CustomerName, integrationEvent.SchemaVersion);

        return Task.CompletedTask;
    }

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Integration event: order {OrderId} placed for {CustomerName} (schema v{SchemaVersion}).")]
    private static partial void LogOrderPlaced(ILogger logger, int orderId, string customerName, int schemaVersion);
}
```

**Delete** the slice and the handler they replace. The `EditItem` folder holds two files, so this
removes three items:

```powershell
Remove-Item -Recurse `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\UseCases\EditItem, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\IntegrationEventHandlers\OrderOpenedHandler.cs
```

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/DomainEventHandlers/OrderChangedAuditHandler.cs`:
one doc line, naming the handler that now audits creation. Change the second-to-last summary line to:

```csharp
/// Creation is audited separately by the integration-event consumer (<c>OrderPlacedHandler</c>),
```

Nothing else in the Application layer moves. The Delete, GetById, and ChangeStatus slices, both DTO
mappers, `OrderCacheKeys`, and `DependencyInjection.cs` are all correct exactly as `--child Item`
generated them, because each of them talks about items and none of them names a renamed field.

### 5.5 API

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.API/Controllers/OrdersController.cs`. The
routes are unchanged, including `POST /Orders/{id}/items`, `PUT /Orders/{id}/items/{itemId}`, and
`DELETE /Orders/{id}/items/{itemId}`: `--child Item` produced them. What changes is the injected
`ChangeItemQuantityCommand` handler in place of the `EditItemCommand` one, the action renamed from
`EditItemAsync` to `ChangeItemQuantityAsync`, and the two new request types:

```csharp
using System.Globalization;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using MMCA.Common.API.Controllers;
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.UseCases;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.AddItem;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeItemQuantity;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeStatus;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Create;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Delete;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.GetById;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.RemoveItem;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Update;
using MMCA.ECommerce.Orders.Domain.Orders;
using MMCA.ECommerce.Orders.Shared.Orders;

namespace MMCA.ECommerce.Orders.API.Controllers;

/// <summary>
/// REST API for customer orders. Read endpoints (GetAll / paged) come from
/// <see cref="EntityControllerBase{TEntity, TDTO, TId}"/>; the write operations inject their
/// handlers directly. Failures map to RFC 9457 ProblemDetails via <c>HandleFailure</c>.
/// </summary>
[ApiController]
[Route("[controller]")]
[ApiVersion("1.0")]
// [AllowAnonymous] because this monolith seed ships without an Identity issuer. Once you add the
// Identity module (GETTING-STARTED.md Phase 8) and set Authentication:JwtBearer:Authority, switch
// this to [Authorize] (optionally with a policy) to require authenticated callers.
[AllowAnonymous]
public sealed class OrdersController(
    IEntityQueryService<Order, OrderDTO, OrderIdentifierType> queryService,
    IQueryHandler<GetOrderByIdQuery, Result<OrderDTO>> getByIdHandler,
    ICommandHandler<OrderCreateRequest, Result<OrderDTO>> createHandler,
    ICommandHandler<UpdateOrderCommand, Result<OrderDTO>> updateHandler,
    ICommandHandler<ChangeOrderStatusCommand, Result<OrderDTO>> changeStatusHandler,
    ICommandHandler<DeleteOrderCommand, Result> deleteHandler,
    ICommandHandler<AddItemCommand, Result<OrderItemDTO>> addItemHandler,
    ICommandHandler<ChangeItemQuantityCommand, Result> changeItemQuantityHandler,
    ICommandHandler<RemoveItemCommand, Result> removeItemHandler,
    ILogger<OrdersController> logger)
    : EntityControllerBase<Order, OrderDTO, OrderIdentifierType>(queryService, logger)
{
    /// <summary>Gets a single order by id, with its items (and therefore a real Total).</summary>
    [HttpGet("{id}/details")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderDTO>> GetDetailsAsync(
        OrderIdentifierType id,
        CancellationToken cancellationToken)
    {
        var result = await getByIdHandler.HandleAsync(new GetOrderByIdQuery(id), cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value);
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<OrderDTO>> CreateAsync(
        OrderCreateRequest request,
        CancellationToken cancellationToken)
    {
        var result = await createHandler.HandleAsync(request, cancellationToken).ConfigureAwait(false);
        if (result.IsFailure)
        {
            return HandleFailure(result.Errors);
        }

        // Build a relative Location URI directly rather than CreatedAtAction(nameof(GetByIdAsync), ...):
        // route-link generation against the versioned base GetById route throws "No route matches the
        // supplied values".
        var dto = result.Value!;
        var locationUri = new Uri(string.Create(CultureInfo.InvariantCulture, $"Orders/{dto.Id}"), UriKind.Relative);
        return Created(locationUri, dto);
    }

    /// <summary>Updates an order's customer name.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderDTO>> UpdateAsync(
        OrderIdentifierType id,
        OrderUpdateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await updateHandler.HandleAsync(
            new UpdateOrderCommand(id, request.CustomerName) { RowVersion = request.RowVersion },
            cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value);
    }

    /// <summary>Changes an order's status.</summary>
    [HttpPut("{id}/status")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderDTO>> ChangeStatusAsync(
        OrderIdentifierType id,
        ChangeOrderStatusRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await changeStatusHandler.HandleAsync(
            new ChangeOrderStatusCommand(id, request.Status),
            cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value);
    }

    /// <summary>Soft-deletes an order, cascading to its children.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteAsync(
        OrderIdentifierType id,
        CancellationToken cancellationToken)
    {
        var result = await deleteHandler.HandleAsync(new DeleteOrderCommand(id), cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : NoContent();
    }

    [HttpPost("{id}/items")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderItemDTO>> AddItemAsync(
        OrderIdentifierType id,
        AddOrderItemRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await addItemHandler.HandleAsync(
            new AddItemCommand(id, request.ProductId, request.ProductName, request.UnitPrice, request.Quantity),
            cancellationToken).ConfigureAwait(false);
        if (result.IsFailure)
        {
            return HandleFailure(result.Errors);
        }

        return Ok(result.Value);
    }

    /// <summary>Changes the quantity of an existing item.</summary>
    [HttpPut("{id}/items/{itemId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ChangeItemQuantityAsync(
        OrderIdentifierType id,
        OrderItemIdentifierType itemId,
        ChangeOrderItemQuantityRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await changeItemQuantityHandler.HandleAsync(
            new ChangeItemQuantityCommand(id, itemId, request.Quantity),
            cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : NoContent();
    }

    /// <summary>Removes (soft-deletes) an item from an order.</summary>
    [HttpDelete("{id}/items/{itemId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RemoveItemAsync(
        OrderIdentifierType id,
        OrderItemIdentifierType itemId,
        CancellationToken cancellationToken)
    {
        var result = await removeItemHandler.HandleAsync(
            new RemoveItemCommand(id, itemId),
            cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : NoContent();
    }
}
```

**Edit** the two error-resource files. In
`Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.resx` and its
`.es.resx` sibling, keep the resx envelope exactly as generated (the `<xsd:schema>` block and the four
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

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.cs`: the doc
comment cites a code that no longer exists. Change the example code and the constant it names:

```csharp
/// domain error <c>Code</c> (e.g. <c>"Order.CustomerName.Empty"</c>, see <c>OrderInvariants</c>) and
/// resolved by the shared <c>IErrorLocalizer</c> after the host registers this type via
/// <c>AddErrorResources&lt;OrdersErrorResources&gt;()</c>. The length limits are baked into the values
/// because they are compile-time constants (<c>OrderInvariants.CustomerNameMaxLength</c> etc.); an
/// unmapped code degrades gracefully to its English message.
```

The solution builds again at this point.

### 5.6 Tests

**Edit** `Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/MMCA.ECommerce.Orders.Application.Tests.csproj`.
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

**Rewrite** `Tests/Modules/Orders/MMCA.ECommerce.Orders.Domain.Tests/Orders/OrderTests.cs` with the
complete file below (33 tests). Keep the comment inside `Total_ExcludesSoftDeletedItems` verbatim: it
documents a real consequence of database-generated ids (every unpersisted line still carries Id 0, so
`GetChildOrNotFound` resolves the first live one), and without it the `RemoveItem(itemId: 0)` call
below it looks like a mistake:

```csharp
using AwesomeAssertions;
using MMCA.Common.Domain.Enums;
using MMCA.ECommerce.Orders.Domain.Orders;
using MMCA.ECommerce.Orders.Domain.Orders.DomainEvents;
using MMCA.ECommerce.Orders.Shared.Orders;

namespace MMCA.ECommerce.Orders.Domain.Tests.Orders;

public class OrderTests
{
    // ---- Create -------------------------------------------------------------------------------
    [Fact]
    public void Create_WithValidData_StartsPendingAndEmpty()
    {
        var result = Order.Create(id: null, "Ada Lovelace");

        result.IsSuccess.Should().BeTrue();
        result.Value!.CustomerName.Should().Be("Ada Lovelace");
        result.Value.Status.Should().Be(OrderStatus.Pending);
        result.Value.Items.Should().BeEmpty();
    }

    [Fact]
    public void Create_DoesNotRaiseDomainEvent_CreationIsSignalledByIntegrationEvent()
    {
        var result = Order.Create(id: null, "Ada Lovelace");

        result.IsSuccess.Should().BeTrue();
        // The aggregate omits an "Added" domain event because the Id is DB-generated; the create
        // handler publishes OrderPlacedIntegrationEvent (with the real id) after commit instead.
        result.Value!.DomainEvents.Should().BeEmpty();
    }

    [Fact]
    public void Create_WithEmptyCustomerName_ReturnsFailure()
    {
        var result = Order.Create(id: null, "   ");

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.Empty");
    }

    [Fact]
    public void Create_WithTooLongCustomerName_ReturnsFailure()
    {
        var result = Order.Create(id: null, new string('x', OrderInvariants.CustomerNameMaxLength + 1));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.TooLong");
    }

    // ---- UpdateDetails ------------------------------------------------------------------------
    [Fact]
    public void UpdateDetails_WithValidName_UpdatesCustomerNameAndRaisesEvent()
    {
        var order = CreatePendingOrder();

        var result = order.UpdateDetails("Grace Hopper");

        result.IsSuccess.Should().BeTrue();
        order.CustomerName.Should().Be("Grace Hopper");
        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void UpdateDetails_WithEmptyName_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.UpdateDetails("   ");

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.Empty");
        order.CustomerName.Should().Be("Ada Lovelace");
    }

    // ---- AddItem ------------------------------------------------------------------------------
    [Fact]
    public void AddItem_OnPendingOrder_AddsItemAndRaisesEvent()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 49.99m, quantity: 2);

        result.IsSuccess.Should().BeTrue();
        result.Value!.ProductId.Should().Be(11);
        result.Value.ProductName.Should().Be("Keyboard");
        result.Value.UnitPrice.Should().Be(49.99m);
        result.Value.Quantity.Should().Be(2);
        order.Items.Should().ContainSingle();
        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void AddItem_WithEmptyProductName_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "  ", unitPrice: 10m, quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.Item.ProductName.Empty");
        order.Items.Should().BeEmpty();
    }

    [Fact]
    public void AddItem_WithTooLongProductName_ReturnsFailure()
    {
        var order = CreatePendingOrder();
        string name = new('x', OrderInvariants.ItemProductNameMaxLength + 1);

        var result = order.AddItem(id: null, productId: 11, name, unitPrice: 10m, quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.Item.ProductName.TooLong");
    }

    [Fact]
    public void AddItem_WithZeroUnitPrice_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 0m, quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidUnitPrice");
    }

    [Fact]
    public void AddItem_WithZeroQuantity_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 0);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidQuantity");
    }

    [Fact]
    public void AddItem_OnPaidOrder_ReturnsItemsLocked()
    {
        var order = CreatePaidOrder();

        var result = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.ItemsLocked");
    }

    // ---- ChangeItemQuantity -------------------------------------------------------------------
    [Fact]
    public void ChangeItemQuantity_UpdatesQuantityAndLeavesTheSnapshotPriceAlone()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 49.99m, quantity: 1).Value!;

        var result = order.ChangeItemQuantity(item.Id, quantity: 3);

        result.IsSuccess.Should().BeTrue();
        item.Quantity.Should().Be(3);
        item.UnitPrice.Should().Be(49.99m, "a quantity edit is not a repricing");
    }

    [Fact]
    public void ChangeItemQuantity_RaisesUpdatedDomainEvent()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1).Value!;
        order.ClearDomainEvents();

        var result = order.ChangeItemQuantity(item.Id, quantity: 2);

        result.IsSuccess.Should().BeTrue();
        order.DomainEvents.OfType<OrderChanged>()
            .Should().ContainSingle(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void ChangeItemQuantity_WithZeroQuantity_ReturnsFailure()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1).Value!;

        var result = order.ChangeItemQuantity(item.Id, quantity: 0);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidQuantity");
        item.Quantity.Should().Be(1);
    }

    [Fact]
    public void ChangeItemQuantity_UnknownId_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.ChangeItemQuantity(itemId: 999, quantity: 2);

        result.IsFailure.Should().BeTrue();
    }

    [Fact]
    public void ChangeItemQuantity_OnPaidOrder_ReturnsItemsLocked()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1).Value!;
        order.ChangeStatus(OrderStatus.Paid);

        var result = order.ChangeItemQuantity(item.Id, quantity: 5);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.ItemsLocked");
        item.Quantity.Should().Be(1);
    }

    // ---- RemoveItem ---------------------------------------------------------------------------
    [Fact]
    public void RemoveItem_SoftDeletesItem()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1).Value!;

        var result = order.RemoveItem(item.Id);

        result.IsSuccess.Should().BeTrue();
        item.IsDeleted.Should().BeTrue();
    }

    [Fact]
    public void RemoveItem_UnknownId_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.RemoveItem(itemId: 999);

        result.IsFailure.Should().BeTrue();
    }

    [Fact]
    public void RemoveItem_OnPaidOrder_ReturnsItemsLocked()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1).Value!;
        order.ChangeStatus(OrderStatus.Paid);

        var result = order.RemoveItem(item.Id);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.ItemsLocked");
        item.IsDeleted.Should().BeFalse();
    }

    // ---- Lifecycle ----------------------------------------------------------------------------
    [Fact]
    public void ChangeStatus_PendingToPaid_Succeeds()
    {
        var order = CreatePendingOrder();

        var result = order.ChangeStatus(OrderStatus.Paid);

        result.IsSuccess.Should().BeTrue();
        order.Status.Should().Be(OrderStatus.Paid);
        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void ChangeStatus_PaidToShipped_Succeeds()
    {
        var order = CreatePaidOrder();

        var result = order.ChangeStatus(OrderStatus.Shipped);

        result.IsSuccess.Should().BeTrue();
        order.Status.Should().Be(OrderStatus.Shipped);
    }

    [Fact]
    public void ChangeStatus_PendingToCancelled_Succeeds()
    {
        var order = CreatePendingOrder();

        var result = order.ChangeStatus(OrderStatus.Cancelled);

        result.IsSuccess.Should().BeTrue();
        order.Status.Should().Be(OrderStatus.Cancelled);
    }

    [Fact]
    public void ChangeStatus_PaidToCancelled_Succeeds()
    {
        var order = CreatePaidOrder();

        var result = order.ChangeStatus(OrderStatus.Cancelled);

        result.IsSuccess.Should().BeTrue();
        order.Status.Should().Be(OrderStatus.Cancelled);
    }

    [Fact]
    public void ChangeStatus_PendingToShipped_ReturnsInvalidStatusTransition()
    {
        var order = CreatePendingOrder();

        var result = order.ChangeStatus(OrderStatus.Shipped);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidStatusTransition");
        order.Status.Should().Be(OrderStatus.Pending, "a rejected transition leaves the order where it was");
    }

    [Fact]
    public void ChangeStatus_FromShipped_IsTerminal()
    {
        foreach (var target in OtherStatuses(OrderStatus.Shipped))
        {
            var order = CreatePaidOrder();
            order.ChangeStatus(OrderStatus.Shipped);

            var result = order.ChangeStatus(target);

            result.IsFailure.Should().BeTrue($"Shipped is terminal, so it cannot move to {target}");
            result.Errors.Should().Contain(e => e.Code == "Order.InvalidStatusTransition");
        }
    }

    [Fact]
    public void ChangeStatus_FromCancelled_IsTerminal()
    {
        foreach (var target in OtherStatuses(OrderStatus.Cancelled))
        {
            var order = CreatePendingOrder();
            order.ChangeStatus(OrderStatus.Cancelled);

            var result = order.ChangeStatus(target);

            result.IsFailure.Should().BeTrue($"Cancelled is terminal, so it cannot move to {target}");
            result.Errors.Should().Contain(e => e.Code == "Order.InvalidStatusTransition");
        }
    }

    [Fact]
    public void ChangeStatus_ToTheSameStatus_IsANoOpSuccess()
    {
        var order = CreatePaidOrder();
        order.ClearDomainEvents();

        var result = order.ChangeStatus(OrderStatus.Paid);

        result.IsSuccess.Should().BeTrue("a redelivered command must not fail on its second arrival");
        order.Status.Should().Be(OrderStatus.Paid);
        order.DomainEvents.Should().BeEmpty("nothing changed, so nothing is announced");
    }

    // ---- Delete -------------------------------------------------------------------------------
    [Fact]
    public void Delete_SoftDeletesOrderAndCascadesToItems()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1);
        order.AddItem(id: null, productId: 12, "Mouse", unitPrice: 5m, quantity: 2);

        var result = order.Delete();

        result.IsSuccess.Should().BeTrue();
        order.IsDeleted.Should().BeTrue();
        order.Items.Should().OnlyContain(c => c.IsDeleted);
    }

    [Fact]
    public void Delete_RaisesDeletedDomainEvent()
    {
        var order = CreatePendingOrder();
        order.ClearDomainEvents();

        var result = order.Delete();

        result.IsSuccess.Should().BeTrue();
        order.DomainEvents.OfType<OrderChanged>()
            .Should().ContainSingle(e => e.State == DomainEntityState.Deleted);
    }

    // ---- Total --------------------------------------------------------------------------------
    [Fact]
    public void Total_OnANewOrder_IsZero()
    {
        var order = CreatePendingOrder();

        order.Total.Should().Be(0m);
    }

    [Fact]
    public void Total_SumsUnitPriceTimesQuantityAcrossItems()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 49.99m, quantity: 2);
        order.AddItem(id: null, productId: 12, "Mouse", unitPrice: 25.50m, quantity: 3);

        order.Total.Should().Be(99.98m + 76.50m);
    }

    [Fact]
    public void Total_ExcludesSoftDeletedItems()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 50m, quantity: 2);
        order.AddItem(id: null, productId: 12, "Mouse", unitPrice: 25m, quantity: 1);
        order.Total.Should().Be(125m);

        // Ids are database-generated, so every item created in memory still carries Id 0. The
        // framework's GetChildOrNotFound matches on id among the live children, so RemoveItem(0)
        // resolves to the FIRST live item rather than to a chosen one: an in-memory test can only
        // remove them in order. Against a real database each item has a distinct id and the lookup
        // is exact. The assertion below is written against that first-live-item behavior on purpose.
        var removed = order.RemoveItem(itemId: 0);

        removed.IsSuccess.Should().BeTrue();
        order.Total.Should().Be(25m, "the soft-deleted keyboard line no longer counts");
    }

    // ---- Helpers ------------------------------------------------------------------------------
    private static Order CreatePendingOrder() =>
        Order.Create(id: null, "Ada Lovelace").Value!;

    private static Order CreatePaidOrder()
    {
        var order = CreatePendingOrder();
        order.ChangeStatus(OrderStatus.Paid);
        return order;
    }

    private static IEnumerable<OrderStatus> OtherStatuses(OrderStatus current) =>
        Enum.GetValues<OrderStatus>().Where(s => s != current);
}
```

**Rewrite** `Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/Caching/OrderCacheInvalidationTests.cs`
with the complete file below (4 tests). The last one enumerates **all seven** order commands, so a new
slice added later without a `CachePrefix` is caught here rather than in production:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.UseCases;
using MMCA.Common.Application.UseCases.Decorators;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Application.Orders;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.AddItem;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeItemQuantity;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeStatus;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Create;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Delete;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.GetById;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.RemoveItem;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Update;
using MMCA.ECommerce.Orders.Shared.Orders;

namespace MMCA.ECommerce.Orders.Application.Tests.Caching;

/// <summary>
/// Worked example of the framework's caching pair: a query that implements
/// <see cref="IQueryCacheable"/> is served from cache until a command that implements
/// <see cref="ICacheInvalidating"/> evicts its prefix, and only when that command succeeds.
/// <para>
/// The two real framework decorators are wired around stub handlers, so the tests exercise the
/// extension point rather than the database, and they hold against any cache substrate: the double
/// below is a plain dictionary, not <c>IMemoryCache</c> and not Redis.
/// </para>
/// </summary>
public class OrderCacheInvalidationTests
{
    private const OrderIdentifierType OrderId = 7;

    [Fact]
    public async Task Read_IsServedFromTheCache_OnTheSecondCall()
    {
        var cache = new DictionaryCache();
        var handler = new CountingQueryHandler(OrderResult());
        var read = new CachingQueryDecorator<GetOrderByIdQuery, Result<OrderDTO>>(handler, cache);

        var first = await read.HandleAsync(new GetOrderByIdQuery(OrderId));
        var second = await read.HandleAsync(new GetOrderByIdQuery(OrderId));

        first.IsSuccess.Should().BeTrue();
        second.IsSuccess.Should().BeTrue();
        handler.Invocations.Should().Be(1, "the second read is a cache hit and never reaches the handler");
        cache.Keys.Should().ContainSingle().Which.Should().StartWith(
            OrderCacheKeys.Prefix,
            "a read stored outside the prefix the commands invalidate could never be evicted");
    }

    [Fact]
    public async Task SuccessfulCommand_EvictsThePrefix_SoTheNextReadMisses()
    {
        var cache = new DictionaryCache();
        var queryHandler = new CountingQueryHandler(OrderResult());
        var read = new CachingQueryDecorator<GetOrderByIdQuery, Result<OrderDTO>>(queryHandler, cache);
        var write = new CachingCommandDecorator<UpdateOrderCommand, Result<OrderDTO>>(
            new StubCommandHandler(OrderResult()), cache);

        await read.HandleAsync(new GetOrderByIdQuery(OrderId));
        await read.HandleAsync(new GetOrderByIdQuery(OrderId));
        queryHandler.Invocations.Should().Be(1, "the cache is warm before the write");

        var written = await write.HandleAsync(new UpdateOrderCommand(OrderId, "Grace Hopper"));

        written.IsSuccess.Should().BeTrue();
        cache.Keys.Should().BeEmpty("a successful command evicts everything under its CachePrefix");

        var afterWrite = await read.HandleAsync(new GetOrderByIdQuery(OrderId));

        afterWrite.IsSuccess.Should().BeTrue();
        queryHandler.Invocations.Should().Be(2, "the read after the write is a miss and re-runs the handler");
    }

    [Fact]
    public async Task FailedCommand_LeavesTheCachedReadInPlace()
    {
        var cache = new DictionaryCache();
        var queryHandler = new CountingQueryHandler(OrderResult());
        var read = new CachingQueryDecorator<GetOrderByIdQuery, Result<OrderDTO>>(queryHandler, cache);
        var write = new CachingCommandDecorator<UpdateOrderCommand, Result<OrderDTO>>(
            new StubCommandHandler(Result.Failure<OrderDTO>(Error.NotFound)), cache);

        await read.HandleAsync(new GetOrderByIdQuery(OrderId));

        var written = await write.HandleAsync(new UpdateOrderCommand(OrderId, "Grace Hopper"));

        written.IsFailure.Should().BeTrue();
        cache.RemoveByPrefixCalls.Should().Be(0, "a command that persisted nothing must not evict valid entries");

        await read.HandleAsync(new GetOrderByIdQuery(OrderId));

        queryHandler.Invocations.Should().Be(1, "the entry survived the failed write, so this read is still a hit");
    }

    [Fact]
    public void EveryOrderCommand_InvalidatesThePrefixTheReadIsKeyedUnder()
    {
        // Nothing at compile time ties CachePrefix to CacheKey: the decorator matches them as
        // strings. This is the test that keeps a renamed key from silently going stale.
        string readKey = new GetOrderByIdQuery(OrderId).CacheKey;

        foreach (var command in AllOrderCommands())
        {
            command.CachePrefix.Should().Be(OrderCacheKeys.Prefix);
            readKey.Should().StartWith(
                command.CachePrefix,
                $"{command.GetType().Name} would otherwise leave the cached order read behind");
        }
    }

    private static IEnumerable<ICacheInvalidating> AllOrderCommands() =>
    [
        new OrderCreateRequest { CustomerName = "Ada Lovelace" },
        new UpdateOrderCommand(OrderId, "Ada Lovelace"),
        new DeleteOrderCommand(OrderId),
        new ChangeOrderStatusCommand(OrderId, OrderStatus.Paid),
        new AddItemCommand(OrderId, ProductId: 11, "Keyboard", UnitPrice: 49.99m, Quantity: 2),
        new ChangeItemQuantityCommand(OrderId, ItemId: 1, Quantity: 3),
        new RemoveItemCommand(OrderId, ItemId: 1),
    ];

    private static Result<OrderDTO> OrderResult() =>
        Result.Success(new OrderDTO
        {
            Id = OrderId,
            CustomerName = "Ada Lovelace",
            Status = OrderStatus.Pending,
            Total = 99.98m,
        });

    /// <summary>Counts how often the real handler is reached, which is what a cache hit prevents.</summary>
    private sealed class CountingQueryHandler(Result<OrderDTO> result)
        : IQueryHandler<GetOrderByIdQuery, Result<OrderDTO>>
    {
        public int Invocations { get; private set; }

        public Task<Result<OrderDTO>> HandleAsync(
            GetOrderByIdQuery query,
            CancellationToken cancellationToken = default)
        {
            Invocations++;
            return Task.FromResult(result);
        }
    }

    /// <summary>Stands in for the persistence-backed command handler, returning a fixed outcome.</summary>
    private sealed class StubCommandHandler(Result<OrderDTO> result)
        : ICommandHandler<UpdateOrderCommand, Result<OrderDTO>>
    {
        public Task<Result<OrderDTO>> HandleAsync(
            UpdateOrderCommand command,
            CancellationToken cancellationToken = default) => Task.FromResult(result);
    }

    /// <summary>
    /// Substrate-independent cache double. The behavior under test is prefix eviction, which every
    /// <see cref="ICacheService"/> implementation owes regardless of where it stores entries.
    /// </summary>
    private sealed class DictionaryCache : ICacheService
    {
        private readonly Dictionary<string, object> _entries = new(StringComparer.Ordinal);

        public int RemoveByPrefixCalls { get; private set; }

        public IReadOnlyCollection<string> Keys => _entries.Keys.ToArray();

        public Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult(_entries.TryGetValue(key, out var value) ? (T)value : default);

        public Task SetAsync<T>(
            string key,
            T value,
            TimeSpan? expiration = null,
            CancellationToken cancellationToken = default)
        {
            if (value is not null)
            {
                _entries[key] = value;
            }

            return Task.CompletedTask;
        }

        public Task RemoveAsync(string key, CancellationToken cancellationToken = default)
        {
            _entries.Remove(key);
            return Task.CompletedTask;
        }

        public Task RemoveByPrefixAsync(string prefix, CancellationToken cancellationToken = default)
        {
            RemoveByPrefixCalls++;

            foreach (string key in _entries.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToArray())
            {
                _entries.Remove(key);
            }

            return Task.CompletedTask;
        }
    }
}
```

**Create** `Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/Orders/OrderHandlerTests.cs`
(19 tests, one class covering every Orders use case). Every handler in the module has the same shape,
so one set of fakes covers all of them, and the shared `HandlerMocks` helper is what keeps the file
from repeating that setup nine times:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Domain.Interfaces;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Application.Orders.DTOs;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.AddItem;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeItemQuantity;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeStatus;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Create;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Delete;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.GetById;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.RemoveItem;
using MMCA.ECommerce.Orders.Application.Orders.UseCases.Update;
using MMCA.ECommerce.Orders.Domain.Orders;
using MMCA.ECommerce.Orders.Shared.Orders;
using MMCA.ECommerce.Orders.Shared.Orders.IntegrationEvents;
using Moq;

namespace MMCA.ECommerce.Orders.Application.Tests.Orders;

/// <summary>
/// One class for the whole Orders handler tier. Every handler follows the same shape (resolve the
/// repository off the unit of work, load the aggregate tracked with its items, mutate through the
/// root, save), so a single set of fakes covers all of them and the tests stay database-free.
/// </summary>
public class OrderHandlerTests
{
    private const OrderIdentifierType OrderId = 7;

    // ---- Create -------------------------------------------------------------------------------
    [Fact]
    public async Task CreateOrder_PersistsThenPublishesOrderPlacedWithTheGeneratedId()
    {
        var mocks = new HandlerMocks();
        var handler = new CreateOrderHandler(
            mocks.UnitOfWork.Object,
            new OrderCreateRequestMapper(),
            mocks.EventBus.Object,
            OrderMapper());

        var result = await handler.HandleAsync(new OrderCreateRequest { CustomerName = "Ada Lovelace" });

        result.IsSuccess.Should().BeTrue();
        result.Value!.CustomerName.Should().Be("Ada Lovelace");
        result.Value.Status.Should().Be(OrderStatus.Pending);
        mocks.Repository.Verify(x => x.AddAsync(It.IsAny<Order>(), It.IsAny<CancellationToken>()), Times.Once);
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        mocks.EventBus.Verify(
            x => x.PublishAsync(
                It.Is<IIntegrationEvent>(e => ((OrderPlacedIntegrationEvent)e).CustomerName == "Ada Lovelace"),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task CreateOrder_WhenTheFactoryRejectsTheRequest_SavesNothingAndPublishesNothing()
    {
        var mocks = new HandlerMocks();
        var handler = new CreateOrderHandler(
            mocks.UnitOfWork.Object,
            new OrderCreateRequestMapper(),
            mocks.EventBus.Object,
            OrderMapper());

        var result = await handler.HandleAsync(new OrderCreateRequest { CustomerName = "   " });

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.Empty");
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        mocks.EventBus.Verify(
            x => x.PublishAsync(It.IsAny<IIntegrationEvent>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    // ---- Update -------------------------------------------------------------------------------
    [Fact]
    public async Task UpdateOrder_WhenFound_ChangesTheCustomerNameAndSaves()
    {
        var mocks = new HandlerMocks();
        mocks.GivenOrder(PendingOrder());
        var handler = new UpdateOrderHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(new UpdateOrderCommand(OrderId, "Grace Hopper"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.CustomerName.Should().Be("Grace Hopper");
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UpdateOrder_WhenNotFound_ReturnsNotFound()
    {
        var mocks = new HandlerMocks();
        mocks.GivenNoOrder();
        var handler = new UpdateOrderHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(new UpdateOrderCommand(OrderId, "Grace Hopper"));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().ContainSingle(e => e.Type == ErrorType.NotFound);
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateOrder_StampsTheClientRowVersionBeforeMutating()
    {
        var mocks = new HandlerMocks();
        var order = PendingOrder();
        mocks.GivenOrder(order);
        byte[] rowVersion = [1, 2, 3];
        var handler = new UpdateOrderHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(
            new UpdateOrderCommand(OrderId, "Grace Hopper") { RowVersion = rowVersion });

        result.IsSuccess.Should().BeTrue();
        mocks.Repository.Verify(x => x.SetOriginalRowVersion(order, rowVersion), Times.Once);
    }

    [Fact]
    public async Task UpdateOrder_WhenTheDomainRejectsTheName_DoesNotSave()
    {
        var mocks = new HandlerMocks();
        mocks.GivenOrder(PendingOrder());
        var handler = new UpdateOrderHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(new UpdateOrderCommand(OrderId, "   "));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.Empty");
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- ChangeStatus -------------------------------------------------------------------------
    [Fact]
    public async Task ChangeStatus_OnALegalTransition_MovesTheOrderAndSaves()
    {
        var mocks = new HandlerMocks();
        var order = PendingOrder();
        mocks.GivenOrder(order);
        var handler = new ChangeOrderStatusHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(new ChangeOrderStatusCommand(OrderId, OrderStatus.Paid));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Status.Should().Be(OrderStatus.Paid);
        order.Status.Should().Be(OrderStatus.Paid);
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ChangeStatus_OnAnIllegalTransition_ReturnsFailureAndDoesNotSave()
    {
        var mocks = new HandlerMocks();
        mocks.GivenOrder(PendingOrder());
        var handler = new ChangeOrderStatusHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(new ChangeOrderStatusCommand(OrderId, OrderStatus.Shipped));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidStatusTransition");
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ChangeStatus_WhenNotFound_ReturnsNotFound()
    {
        var mocks = new HandlerMocks();
        mocks.GivenNoOrder();
        var handler = new ChangeOrderStatusHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(new ChangeOrderStatusCommand(OrderId, OrderStatus.Paid));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().ContainSingle(e => e.Type == ErrorType.NotFound);
    }

    // ---- Delete -------------------------------------------------------------------------------
    [Fact]
    public async Task DeleteOrder_WhenFound_SoftDeletesTheAggregateAndSaves()
    {
        var mocks = new HandlerMocks();
        var order = PendingOrder();
        order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1);
        mocks.GivenOrder(order);
        var handler = new DeleteOrderHandler(mocks.UnitOfWork.Object);

        var result = await handler.HandleAsync(new DeleteOrderCommand(OrderId));

        result.IsSuccess.Should().BeTrue();
        order.IsDeleted.Should().BeTrue();
        order.Items.Should().OnlyContain(i => i.IsDeleted);
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task DeleteOrder_WhenNotFound_ReturnsNotFound()
    {
        var mocks = new HandlerMocks();
        mocks.GivenNoOrder();
        var handler = new DeleteOrderHandler(mocks.UnitOfWork.Object);

        var result = await handler.HandleAsync(new DeleteOrderCommand(OrderId));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().ContainSingle(e => e.Type == ErrorType.NotFound);
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- AddItem ------------------------------------------------------------------------------
    [Fact]
    public async Task AddItem_OnAPendingOrder_AppendsTheSnapshotAndReturnsTheItemDTO()
    {
        var mocks = new HandlerMocks();
        var order = PendingOrder();
        mocks.GivenOrder(order);
        var handler = new AddItemHandler(mocks.UnitOfWork.Object, new OrderItemDTOMapper());

        var result = await handler.HandleAsync(
            new AddItemCommand(OrderId, ProductId: 11, "Keyboard", UnitPrice: 49.99m, Quantity: 2));

        result.IsSuccess.Should().BeTrue();
        result.Value!.ProductId.Should().Be(11);
        result.Value.ProductName.Should().Be("Keyboard");
        result.Value.UnitPrice.Should().Be(49.99m);
        result.Value.Quantity.Should().Be(2);
        order.Items.Should().ContainSingle();
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AddItem_WhenNotFound_ReturnsNotFound()
    {
        var mocks = new HandlerMocks();
        mocks.GivenNoOrder();
        var handler = new AddItemHandler(mocks.UnitOfWork.Object, new OrderItemDTOMapper());

        var result = await handler.HandleAsync(
            new AddItemCommand(OrderId, ProductId: 11, "Keyboard", UnitPrice: 49.99m, Quantity: 2));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().ContainSingle(e => e.Type == ErrorType.NotFound);
    }

    [Fact]
    public async Task AddItem_OnAPaidOrder_ReturnsItemsLockedAndDoesNotSave()
    {
        var mocks = new HandlerMocks();
        mocks.GivenOrder(PaidOrder());
        var handler = new AddItemHandler(mocks.UnitOfWork.Object, new OrderItemDTOMapper());

        var result = await handler.HandleAsync(
            new AddItemCommand(OrderId, ProductId: 11, "Keyboard", UnitPrice: 49.99m, Quantity: 2));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.ItemsLocked");
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- ChangeItemQuantity -------------------------------------------------------------------
    [Fact]
    public async Task ChangeItemQuantity_WhenFound_ChangesTheQuantityAndSaves()
    {
        var mocks = new HandlerMocks();
        var order = PendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1).Value!;
        mocks.GivenOrder(order);
        var handler = new ChangeItemQuantityHandler(mocks.UnitOfWork.Object);

        var result = await handler.HandleAsync(new ChangeItemQuantityCommand(OrderId, item.Id, Quantity: 4));

        result.IsSuccess.Should().BeTrue();
        item.Quantity.Should().Be(4);
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ChangeItemQuantity_WhenTheOrderIsNotFound_ReturnsNotFound()
    {
        var mocks = new HandlerMocks();
        mocks.GivenNoOrder();
        var handler = new ChangeItemQuantityHandler(mocks.UnitOfWork.Object);

        var result = await handler.HandleAsync(new ChangeItemQuantityCommand(OrderId, ItemId: 1, Quantity: 4));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().ContainSingle(e => e.Type == ErrorType.NotFound);
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- RemoveItem ---------------------------------------------------------------------------
    [Fact]
    public async Task RemoveItem_WhenFound_SoftDeletesTheItemAndSaves()
    {
        var mocks = new HandlerMocks();
        var order = PendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 10m, quantity: 1).Value!;
        mocks.GivenOrder(order);
        var handler = new RemoveItemHandler(mocks.UnitOfWork.Object);

        var result = await handler.HandleAsync(new RemoveItemCommand(OrderId, item.Id));

        result.IsSuccess.Should().BeTrue();
        item.IsDeleted.Should().BeTrue();
        mocks.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // The Pending-only guard on removal is proven at the domain tier (OrderTests) and, at this tier,
    // by AddItem_OnAPaidOrder above: the handler does not re-implement the rule, it just relays it.

    // ---- GetById ------------------------------------------------------------------------------
    [Fact]
    public async Task GetOrderById_WhenFound_MapsTheItemsAndTheComputedTotal()
    {
        var mocks = new HandlerMocks();
        var order = PendingOrder();
        order.AddItem(id: null, productId: 11, "Keyboard", unitPrice: 50m, quantity: 2);
        order.AddItem(id: null, productId: 12, "Mouse", unitPrice: 25m, quantity: 1);
        mocks.GivenOrder(order);
        var handler = new GetOrderByIdHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(new GetOrderByIdQuery(OrderId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Items.Should().HaveCount(2);
        result.Value.Total.Should().Be(125m, "the details path loads the items, so the total is real");
    }

    [Fact]
    public async Task GetOrderById_WhenNotFound_ReturnsNotFound()
    {
        var mocks = new HandlerMocks();
        mocks.GivenNoOrder();
        var handler = new GetOrderByIdHandler(mocks.UnitOfWork.Object, OrderMapper());

        var result = await handler.HandleAsync(new GetOrderByIdQuery(OrderId));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().ContainSingle(e => e.Type == ErrorType.NotFound);
    }

    // ---- Helpers ------------------------------------------------------------------------------
    private static Order PendingOrder() => Order.Create(id: null, "Ada Lovelace").Value!;

    private static Order PaidOrder()
    {
        var order = PendingOrder();
        order.ChangeStatus(OrderStatus.Paid);
        return order;
    }

    private static OrderDTOMapper OrderMapper() => new(new OrderItemDTOMapper());

    /// <summary>
    /// The three infrastructure boundaries every Orders handler sits on, pre-wired: the unit of work
    /// hands back the repository, and a save reports one affected row.
    /// </summary>
    private sealed class HandlerMocks
    {
        public HandlerMocks()
        {
            UnitOfWork.Setup(x => x.GetRepository<Order, OrderIdentifierType>()).Returns(Repository.Object);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        }

        public Mock<IUnitOfWork> UnitOfWork { get; } = new();

        public Mock<IRepository<Order, OrderIdentifierType>> Repository { get; } = new();

        public Mock<IEventBus> EventBus { get; } = new();

        public void GivenOrder(Order order) =>
            Repository
                .Setup(x => x.GetByIdAsync(
                    It.IsAny<OrderIdentifierType>(),
                    It.IsAny<IEnumerable<string>>(),
                    It.IsAny<bool>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(order);

        public void GivenNoOrder() =>
            Repository
                .Setup(x => x.GetByIdAsync(
                    It.IsAny<OrderIdentifierType>(),
                    It.IsAny<IEnumerable<string>>(),
                    It.IsAny<bool>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync((Order?)null);
    }
}
```

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

The scaffolded Blazor host already has the load-bearing parts: the typed `ECommerceApiClient`
calling the API server-side through Aspire service discovery (no CORS, no token), the
`en`/`es` resource pairs, and the theme/culture chrome. Reshape the Products pages to
Name/Description/Price, and add two Orders pages that mirror them:

- `Orders.razor`: create an order by customer name, list orders.
- `OrderDetail.razor`: edit the customer name, walk the status lifecycle (the page offers only the
  transitions the domain allows), and manage items while the order is Pending. The add-item form is
  a product picker filled from `GetProductsAsync()`: selecting a product snapshots its id, name, and
  price into the request, which is the UI half of the module-isolation decision above.

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
