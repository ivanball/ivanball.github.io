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
dotnet new mmca-app -n MMCA.ECommerce --module Products --aggregate Product
cd MMCA.ECommerce
```

One command, and the whole monolith exists: the Products module across Shared, Domain, Application,
Infrastructure, and API, the REST host, the Blazor UI host, the Aspire AppHost, a migrations project
for the module's database, and three test projects including the architecture fitness rules.

Get your green baseline before changing anything:

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test  --solution MMCA.ECommerce.slnx
```

That is a warning-free build under five analyzers at error severity and 90 passing tests, with no
database needed. This baseline is the line you bisect against later.

## 3. Add the Orders module

```powershell
dotnet new mmca-module -n Orders --app MMCA.ECommerce --aggregate Order
```

Eight more projects appear (the five layers, two test projects, one migrations project). `dotnet new`
cannot patch files that already exist, so the template prints the wire-ups it needs from you. Here
they are, concretely, for this app:

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

**f. Give the module its own database.** This is the one step the template's printed instructions do
not cover, and it matters: every module database carries its own `OutboxMessages`/`InboxMessages`
tables in `dbo`, so two modules migrated into one database would collide on them. One database per
module is also exactly the topology that makes extraction free later
([ADR-006](../adr/006-database-per-service.md)). In the AppHost:

```csharp
var productsDb = sql.AddDatabase("ecommerce-products", "ECommerce_Products");
var ordersDb = sql.AddDatabase("ecommerce-orders", "ECommerce_Orders");

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
no new kind of thing in the solution, just a second copy of the shape you already had. If curiosity
makes you run the app now, know that the Orders database has no schema until step 7 creates its
migration: Orders endpoints fail, and the background outbox poller logs "Outbox processing failed
for data source SQLServer/Default" every few seconds until then. Harmless, and it stops on the
first run after step 7.

## 4. Reshape Products into a catalog product

Both scaffolded modules arrive as the template's worked example (a title, a description, a status,
a growable child collection): a placeholder domain in *your* namespaces, meant to be reshaped. The
reshape is ordinary editing, and every convention stays: `Result`-returning factory, invariants
composed with `Result.Combine`, guarded mutations raising domain events, the caching pair, the
integration event through the outbox.

`Product` becomes the whole catalog entry: `Name`, `Description`, `Price`. The child entity and the
status go away entirely, which makes Products the minimal single-entity module. Work the phases
below in order: the deletions first (so nothing compiles against a type you are about to reshape),
then Domain, Shared, Application, Infrastructure, API, and the tests. Every file shown is the
finished file from the build-verified sample, so you can paste it as-is.

All paths are relative to the solution root (`MMCA.ECommerce`), and every command is PowerShell.

### 4.1 Delete the ticket-shaped surface

The scaffold's child entity, its status enum, and the four child/status use-case slices have no place
in a catalog product. Delete them in one pass, before touching anything else, so the compiler errors
you see afterwards are only the ones the reshape is supposed to produce. The four `UseCases` folders
hold two files each, so this removes 18 files:

```powershell
Remove-Item -Recurse `
  Source\Modules\Products\MMCA.ECommerce.Products.Domain\Products\ProductComment.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Shared\Products\ProductStatus.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Shared\Products\ProductCommentDTO.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Shared\Products\AddCommentRequest.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Shared\Products\EditCommentRequest.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Shared\Products\ChangeProductStatusRequest.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Shared\Products\IntegrationEvents\ProductOpenedIntegrationEvent.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Application\Products\DTOs\ProductCommentDTOMapper.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Application\Products\IntegrationEventHandlers\ProductOpenedHandler.cs, `
  Source\Modules\Products\MMCA.ECommerce.Products.Application\Products\UseCases\AddComment, `
  Source\Modules\Products\MMCA.ECommerce.Products.Application\Products\UseCases\ChangeStatus, `
  Source\Modules\Products\MMCA.ECommerce.Products.Application\Products\UseCases\EditComment, `
  Source\Modules\Products\MMCA.ECommerce.Products.Application\Products\UseCases\RemoveComment, `
  Source\Modules\Products\MMCA.ECommerce.Products.Infrastructure\Persistence\EntityConfiguration\ProductCommentConfiguration.cs
```

Nothing else references those files by path: the module's DI is convention-scanned, so a deleted
handler simply stops being discovered. The solution will not build again until 4.6 is done.

### 4.2 Domain

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/ProductInvariants.cs`
with the complete file below. The string rules still delegate to the framework's `CommonInvariants`
(so each field keeps its distinct empty vs too-long error code); the only app-specific rule is the
price:

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
/// domain events. A flat aggregate: name, description, and price, with no child entities.
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

### 4.3 Shared contracts

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Shared/MMCA.ECommerce.Products.GlobalUsings.IdentifierType.cs`.
Only one entity survives, so the child alias goes and the comment drops to the singular. The whole
file is now:

```csharp
// Products module entity identifier type aliases.
// The aggregate uses a database-generated integer ID (the [IdValueGenerated] attribute on the
// domain entity). This file is linked into every project solution-wide via Directory.Build.props,
// so the alias is visible everywhere. Always use the alias instead of the raw type.
global using ProductIdentifierType = int;
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/ProductDTO.cs`:

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
Keep the `*UpdateRequest` suffix exactly: the shared `UpdateRequestsAreConcurrencyAware` fitness rule
finds it by name, and a rename silently drops the request out of that rule's scope:

```csharp
using MMCA.Common.Shared.DTOs;

namespace MMCA.ECommerce.Products.Shared.Products;

/// <summary>
/// Request body for updating a product's name, description, and price (the product id comes from
/// the route). Round-trips the optimistic-concurrency token per ADR-035: the client echoes the
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

    /// <summary>The new unit price.</summary>
    public required decimal Price { get; init; }
}
```

**Create** `Source/Modules/Products/MMCA.ECommerce.Products.Shared/Products/IntegrationEvents/ProductCreatedIntegrationEvent.cs`
(replacing the `ProductOpenedIntegrationEvent` you deleted in 4.1):

```csharp
using MMCA.Common.Domain.DomainEvents;

namespace MMCA.ECommerce.Products.Shared.Products.IntegrationEvents;

/// <summary>
/// Raised when a product is added to the catalog. Lives in the Shared layer so other modules (or
/// extracted services) can consume it without referencing Products.Domain. Carries the framework
/// <see cref="BaseIntegrationEvent.SchemaVersion"/> (default 1, ADR-010): a breaking change uses a
/// new event type plus an upcaster, never a silent reshape of this contract.
/// </summary>
/// <param name="ProductId">The new product's database-generated identifier.</param>
/// <param name="Name">The product name at creation time.</param>
/// <param name="Price">The product price at creation time.</param>
public sealed record class ProductCreatedIntegrationEvent(
    ProductIdentifierType ProductId,
    string Name,
    decimal Price)
    : BaseIntegrationEvent;
```

### 4.4 Application

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/DTOs/ProductDTOMapper.cs`.
There is no child mapper any more, so the primary-constructor parameter and the `[UseMapper]` field
both go. Replace everything from the doc comment down to the `MapToDTO` declaration with:

```csharp
/// <summary>
/// Maps the <see cref="Product"/> aggregate to <see cref="ProductDTO"/> (Mapperly).
/// </summary>
[Mapper]
public sealed partial class ProductDTOMapper
    : IEntityDTOMapper<Product, ProductDTO, ProductIdentifierType>
{
    public partial ProductDTO MapToDTO(Product entity);
```

**Create** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/IntegrationEventHandlers/ProductCreatedHandler.cs`
(replacing the deleted `ProductOpenedHandler`):

```csharp
using Microsoft.Extensions.Logging;
using MMCA.Common.Application.Interfaces;
using MMCA.ECommerce.Products.Shared.Products.IntegrationEvents;

namespace MMCA.ECommerce.Products.Application.Products.IntegrationEventHandlers;

/// <summary>
/// Consumes <see cref="ProductCreatedIntegrationEvent"/>. In this monolith seed it just logs; in a real
/// system this is where a search-index/pricing/analytics side effect would live. The same handler runs
/// in-process now and over the broker once the Products module is extracted (ADR-003 / ADR-008).
/// Auto-discovered by Scrutor (singleton lifetime); the dispatcher routes the outbox-published event here.
/// </summary>
public sealed partial class ProductCreatedHandler(ILogger<ProductCreatedHandler> logger)
    : IIntegrationEventHandler<ProductCreatedIntegrationEvent>
{
    public Task HandleAsync(ProductCreatedIntegrationEvent integrationEvent, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(integrationEvent);

        LogProductCreated(logger, integrationEvent.ProductId, integrationEvent.Name, integrationEvent.Price, integrationEvent.SchemaVersion);

        return Task.CompletedTask;
    }

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Integration event: product {ProductId} '{Name}' created at price {Price} (schema v{SchemaVersion}).")]
    private static partial void LogProductCreated(ILogger logger, int productId, string name, decimal price, int schemaVersion);
}
```

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/DomainEventHandlers/ProductChangedAuditHandler.cs`:
one doc line, naming the handler that now audits creation. Change the second-to-last summary line to:

```csharp
/// Creation is audited separately by the integration-event consumer (<c>ProductCreatedHandler</c>),
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/ProductCreateRequest.cs`:

```csharp
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Products.Application.Products.UseCases.Create;

/// <summary>
/// Command/request to add a new product to the catalog. Used directly as the command (validated by the
/// pipeline's Validating decorator via <see cref="ProductCreateRequestValidator"/>); implements
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
        RuleFor(x => x.Price).GreaterThan(0);
    }
}
```

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Create/CreateProductHandler.cs`.
This is the file that shows the whole write path in one screen, so it is worth reading rather than
just pasting: domain factory, unit of work, then the integration event published *after* the commit:

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
/// Adds a new product to the catalog: maps the request through the domain factory, persists via the
/// unit of work (which stamps audit fields and dispatches domain events), then publishes the
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
/// Validating decorator before the transaction opens. Mirrors the create validator so a bad payload
/// is rejected at the edge on both write paths, not only on create.
/// </summary>
public sealed class UpdateProductCommandValidator : AbstractValidator<UpdateProductCommand>
{
    public UpdateProductCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(ProductInvariants.NameMaxLength);
        RuleFor(x => x.Description).NotEmpty().MaximumLength(ProductInvariants.DescriptionMaxLength);
        RuleFor(x => x.Price).GreaterThan(0);
    }
}
```

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Update/UpdateProductHandler.cs`.
The aggregate is flat now, so the read needs no includes, and `UpdateDetails` takes a third argument.
Change the summary line, the `includes:` argument, and the call:

```csharp
/// Updates a product's name, description, and price through the aggregate root, then returns the
/// refreshed DTO.
```

```csharp
            includes: [],
```

```csharp
        var result = product.UpdateDetails(command.Name, command.Description, command.Price);
```

**Edit** the Delete slice. In
`Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/Delete/DeleteProductCommand.cs`,
change the summary (there are no children to cascade to):

```csharp
/// <summary>
/// Command to soft-delete a product. Evicts cached reads on success.
/// </summary>
```

In `.../UseCases/Delete/DeleteProductHandler.cs`, change the summary and drop the include:

```csharp
/// <summary>
/// Soft-deletes a product through the aggregate root (loaded tracked so the flag is persisted).
/// The EF global query filter then excludes it from subsequent reads.
/// </summary>
```

```csharp
            includes: [],
```

**Edit** the GetById slice. In
`Source/Modules/Products/MMCA.ECommerce.Products.Application/Products/UseCases/GetById/GetProductByIdQuery.cs`,
change the first summary line:

```csharp
/// Query for a single (non-deleted) product.
```

In `.../UseCases/GetById/GetProductByIdHandler.cs`, the read has no children to eager-load and never
writes, so it moves to the **read** repository and its two-argument `GetByIdAsync` overload. Replace
the summary and the two lines that obtain the product:

```csharp
/// <summary>
/// Loads a single product and maps it to a DTO. The aggregate is flat, so the read needs no includes.
/// </summary>
```

```csharp
        var repository = unitOfWork.GetReadRepository<Product, ProductIdentifierType>();
        var product = await repository.GetByIdAsync(query.Id, cancellationToken).ConfigureAwait(false);
```

Resolve the repository through `IUnitOfWork` like this, never by constructor-injecting
`IRepository<,>`: a directly injected repository is not enlisted in the unit of work's transaction,
and mocks happily hide the difference until a real database run.

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Application/DependencyInjection.cs`: one
comment, because the aggregate no longer has children. Replace the three-line comment above the
`TryAddScoped<INavigationPopulator<Product>, ...>` call with:

```csharp
            // The Product aggregate is flat (no navigation properties), so a null populator suffices
            // here (swap for a custom INavigationPopulator<Product> once the query service needs to
            // batch-load a related aggregate).
```

### 4.5 Infrastructure

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.Infrastructure/Persistence/EntityConfiguration/ProductConfiguration.cs`.
`base.Configure` still supplies the id, the soft-delete flag and its query filter, the audit columns,
and the concurrency token, so only the product's own columns are here. `Price` is
`decimal(18,2)` explicitly: SQL Server's default for a mapped decimal is `decimal(18,0)`, which would
round every price to whole currency units:

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

        builder.Property(p => p.Price)
            .HasColumnType("decimal(18,2)")
            .IsRequired();

        // Filtered to live rows only: the catalog is browsed and searched by name, and soft-deleted
        // products are excluded by the global query filter anyway.
        builder.HasIndex(p => p.Name)
            .HasFilter("[IsDeleted] = 0");
    }
}
```

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs`:
delete the child `DbSet` line so the body is exactly:

```csharp
    internal DbSet<Product> Products { get; set; }
```

### 4.6 API

**Rewrite** `Source/Modules/Products/MMCA.ECommerce.Products.API/Controllers/ProductsController.cs`.
The list and paged reads are inherited from `EntityControllerBase`; only the detail read and the
three writes are declared here:

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
using MMCA.ECommerce.Products.Application.Products.UseCases.Create;
using MMCA.ECommerce.Products.Application.Products.UseCases.Delete;
using MMCA.ECommerce.Products.Application.Products.UseCases.GetById;
using MMCA.ECommerce.Products.Application.Products.UseCases.Update;
using MMCA.ECommerce.Products.Domain.Products;
using MMCA.ECommerce.Products.Shared.Products;

namespace MMCA.ECommerce.Products.API.Controllers;

/// <summary>
/// REST API for catalog products. Read endpoints (GetAll / paged) come from
/// <see cref="EntityControllerBase{TEntity, TDTO, TId}"/>; create, update, and delete inject handlers
/// directly. Failures map to RFC 9457 ProblemDetails via <c>HandleFailure</c>.
/// </summary>
[ApiController]
[Route("[controller]")]
[ApiVersion("1.0")]
// [AllowAnonymous] because this monolith seed ships without an Identity issuer. Once you add the
// Identity module (GETTING-STARTED.md Phase 8) and set Authentication:JwtBearer:Authority, switch
// this to [Authorize] (optionally with a policy) to require authenticated callers.
[AllowAnonymous]
public sealed class ProductsController(
    IEntityQueryService<Product, ProductDTO, ProductIdentifierType> queryService,
    IQueryHandler<GetProductByIdQuery, Result<ProductDTO>> getByIdHandler,
    ICommandHandler<ProductCreateRequest, Result<ProductDTO>> createHandler,
    ICommandHandler<UpdateProductCommand, Result<ProductDTO>> updateHandler,
    ICommandHandler<DeleteProductCommand, Result> deleteHandler,
    ILogger<ProductsController> logger)
    : EntityControllerBase<Product, ProductDTO, ProductIdentifierType>(queryService, logger)
{
    /// <summary>Gets a single product.</summary>
    [HttpGet("{id}/details")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductDTO>> GetDetailsAsync(
        ProductIdentifierType id,
        CancellationToken cancellationToken)
    {
        var result = await getByIdHandler.HandleAsync(new GetProductByIdQuery(id), cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value);
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ProductDTO>> CreateAsync(
        ProductCreateRequest request,
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
        var locationUri = new Uri(string.Create(CultureInfo.InvariantCulture, $"Products/{dto.Id}"), UriKind.Relative);
        return Created(locationUri, dto);
    }

    /// <summary>Updates a product's name, description, and price.</summary>
    [HttpPut("{id}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductDTO>> UpdateAsync(
        ProductIdentifierType id,
        ProductUpdateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var result = await updateHandler.HandleAsync(
            new UpdateProductCommand(id, request.Name, request.Description, request.Price) { RowVersion = request.RowVersion },
            cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : Ok(result.Value);
    }

    /// <summary>Soft-deletes a product.</summary>
    [HttpDelete("{id}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteAsync(
        ProductIdentifierType id,
        CancellationToken cancellationToken)
    {
        var result = await deleteHandler.HandleAsync(new DeleteProductCommand(id), cancellationToken).ConfigureAwait(false);
        return result.IsFailure ? HandleFailure(result.Errors) : NoContent();
    }
}
```

**Edit** the two error-resource files. In
`Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.resx` and its
`.es.resx` sibling, keep the resx envelope exactly as generated (the `<xsd:schema>` block and the
four `<resheader>` elements) and replace **only** the `<data>` elements: delete the seven scaffolded
ones (`Product.Closed`, `Product.Title.*`, `Product.Description.*`, `Product.Comment.Body.*`) and add
the five below, in this order. Every code here is one an invariant in 4.2 actually emits, and an
unmapped code degrades gracefully to its English message, so a typo shows up as English text in a
Spanish browser rather than as an exception:

| `data name` | `.resx` value (en) | `.es.resx` value (es) |
|---|---|---|
| `Product.Description.Empty` | Product description cannot be empty. | La descripción del producto no puede estar vacía. |
| `Product.Description.TooLong` | Product description cannot exceed 4000 characters. | La descripción del producto no puede superar los 4000 caracteres. |
| `Product.InvalidPrice` | Product price must be greater than zero. | El precio del producto debe ser mayor que cero. |
| `Product.Name.Empty` | Product name cannot be empty. | El nombre del producto no puede estar vacío. |
| `Product.Name.TooLong` | Product name cannot exceed 200 characters. | El nombre del producto no puede superar los 200 caracteres. |

Each entry is a `<data name="..." xml:space="preserve">` element wrapping a single `<value>`, exactly
like the ones you are replacing.

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.API/Resources/ProductsErrorResources.cs`:
the doc comment cites a code that no longer exists. Change the example code and the constant it names:

```csharp
/// domain error <c>Code</c> (e.g. <c>"Product.InvalidPrice"</c>, see <c>ProductInvariants</c>) and
/// resolved by the shared <c>IErrorLocalizer</c> after the host registers this type via
/// <c>AddErrorResources&lt;ProductsErrorResources&gt;()</c>. The length limits are baked into the values
/// because they are compile-time constants (<c>ProductInvariants.NameMaxLength</c> etc.); an unmapped
```

At this point the solution builds again. The tests do not yet.

### 4.7 Tests

**Rewrite** `Tests/Modules/Products/MMCA.ECommerce.Products.Domain.Tests/Products/ProductTests.cs`
with the complete file below (13 tests). Read the accumulation test in the middle: `Result.Combine`
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
        var result = Product.Create(id: null, "Espresso Machine", "A compact home espresso machine.", price: 499.99m);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Espresso Machine");
        result.Value.Description.Should().Be("A compact home espresso machine.");
        result.Value.Price.Should().Be(499.99m);
    }

    [Fact]
    public void Create_DoesNotRaiseDomainEvent_CreationIsSignalledByIntegrationEvent()
    {
        var result = Product.Create(id: null, "Espresso Machine", "A compact home espresso machine.", price: 499.99m);

        result.IsSuccess.Should().BeTrue();
        // The aggregate omits an "Added" domain event because the Id is DB-generated; the create
        // handler publishes ProductCreatedIntegrationEvent (with the real id) after commit instead.
        result.Value!.DomainEvents.Should().BeEmpty();
    }

    [Fact]
    public void Create_WithEmptyName_ReturnsFailure()
    {
        var result = Product.Create(id: null, "   ", "A compact home espresso machine.", price: 499.99m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Name.Empty");
    }

    [Fact]
    public void Create_WithTooLongName_ReturnsFailure()
    {
        string name = new('n', ProductInvariants.NameMaxLength + 1);

        var result = Product.Create(id: null, name, "A compact home espresso machine.", price: 499.99m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Name.TooLong");
    }

    [Fact]
    public void Create_WithEmptyDescription_ReturnsFailure()
    {
        var result = Product.Create(id: null, "Espresso Machine", "   ", price: 499.99m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Description.Empty");
    }

    [Fact]
    public void Create_WithTooLongDescription_ReturnsFailure()
    {
        string description = new('d', ProductInvariants.DescriptionMaxLength + 1);

        var result = Product.Create(id: null, "Espresso Machine", description, price: 499.99m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Description.TooLong");
    }

    [Fact]
    public void Create_WithZeroPrice_ReturnsFailure()
    {
        var result = Product.Create(id: null, "Espresso Machine", "A compact home espresso machine.", price: 0m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
    }

    [Fact]
    public void Create_WithNegativePrice_ReturnsFailure()
    {
        var result = Product.Create(id: null, "Espresso Machine", "A compact home espresso machine.", price: -1m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
    }

    [Fact]
    public void Create_ReportsEveryBrokenInvariant_NotJustTheFirst()
    {
        // Result.Combine accumulates: one round trip tells the caller everything that is wrong.
        var result = Product.Create(id: null, "   ", "   ", price: 0m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Name.Empty");
        result.Errors.Should().Contain(e => e.Code == "Product.Description.Empty");
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
    }

    [Fact]
    public void UpdateDetails_WithValidData_UpdatesNameDescriptionAndPrice()
    {
        var product = CreateProduct();

        var result = product.UpdateDetails("Espresso Machine Pro", "Now with a milk frother.", price: 649.00m);

        result.IsSuccess.Should().BeTrue();
        product.Name.Should().Be("Espresso Machine Pro");
        product.Description.Should().Be("Now with a milk frother.");
        product.Price.Should().Be(649.00m);
    }

    [Fact]
    public void UpdateDetails_RaisesProductChangedUpdated()
    {
        var product = CreateProduct();

        product.UpdateDetails("Espresso Machine Pro", "Now with a milk frother.", price: 649.00m);

        product.DomainEvents.OfType<ProductChanged>()
            .Should().ContainSingle().Which.State.Should().Be(DomainEntityState.Updated);
    }

    [Fact]
    public void UpdateDetails_WithEmptyName_ReturnsFailureAndRaisesNoEvent()
    {
        var product = CreateProduct();

        var result = product.UpdateDetails("   ", "Now with a milk frother.", price: 649.00m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.Name.Empty");
        product.DomainEvents.Should().BeEmpty("a rejected update must not announce a change that never happened");
    }

    [Fact]
    public void Delete_SoftDeletesProductAndRaisesDeletedEvent()
    {
        var product = CreateProduct();

        var result = product.Delete();

        result.IsSuccess.Should().BeTrue();
        product.IsDeleted.Should().BeTrue();
        product.DomainEvents.OfType<ProductChanged>()
            .Should().ContainSingle().Which.State.Should().Be(DomainEntityState.Deleted);
    }

    private static Product CreateProduct() =>
        Product.Create(id: null, "Espresso Machine", "A compact home espresso machine.", price: 499.99m).Value!;
}
```

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
            new StubCommandHandler(ProductResult(price: 649.00m)), cache);

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
        new ProductCreateRequest { Name = "Espresso Machine", Description = "A compact home espresso machine.", Price = 499.99m },
        UpdateCommand(),
        new DeleteProductCommand(ProductId),
    ];

    private static UpdateProductCommand UpdateCommand() =>
        new(ProductId, "Espresso Machine Pro", "Now with a milk frother.", Price: 649.00m);

    private static Result<ProductDTO> ProductResult(decimal price = 499.99m) =>
        Result.Success(new ProductDTO
        {
            Id = ProductId,
            Name = "Espresso Machine",
            Description = "A compact home espresso machine.",
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
`Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/Products/UseCases/`. They all
extend the framework's `HandlerTestBase<THandler>`, whose `RegisterRepository` wires a mocked
repository into a mocked unit of work, so the handler resolves it exactly the way it does at run time.

`.../Products/UseCases/Create/CreateProductHandlerTests.cs`:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Testing;
using MMCA.ECommerce.Products.Application.Products.DTOs;
using MMCA.ECommerce.Products.Application.Products.UseCases.Create;
using MMCA.ECommerce.Products.Domain.Products;
using MMCA.ECommerce.Products.Shared.Products.IntegrationEvents;
using Moq;

namespace MMCA.ECommerce.Products.Application.Tests.Products.UseCases.Create;

/// <summary>
/// Unit tests for <see cref="CreateProductHandler"/>. The repository and the event bus are mocks
/// (via the framework's <see cref="HandlerTestBase{THandler}"/>); the request mapper and the DTO
/// mapper are the real ones, so the domain factory really runs.
/// </summary>
public sealed class CreateProductHandlerTests : HandlerTestBase<CreateProductHandler>
{
    private readonly Mock<IRepository<Product, ProductIdentifierType>> _products;
    private readonly Mock<IEventBus> _eventBus = new();
    private readonly CreateProductHandler _sut;

    public CreateProductHandlerTests()
    {
        _products = RegisterRepository<Product, ProductIdentifierType>();
        _sut = new CreateProductHandler(
            UnitOfWork.Object,
            new ProductCreateRequestMapper(),
            _eventBus.Object,
            new ProductDTOMapper());
    }

    [Fact]
    public async Task HandleAsync_WithAValidRequest_AddsTheProductAndSaves()
    {
        var result = await _sut.HandleAsync(ValidRequest());

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Espresso Machine");
        result.Value.Price.Should().Be(499.99m);
        _products.Verify(r => r.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()), Times.Once);
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_PublishesProductCreated_AfterTheCommit()
    {
        await _sut.HandleAsync(ValidRequest());

        _eventBus.Verify(
            b => b.PublishAsync(
                It.Is<ProductCreatedIntegrationEvent>(e => e.Name == "Espresso Machine" && e.Price == 499.99m),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WhenTheDomainFactoryRejectsTheRequest_PersistsAndPublishesNothing()
    {
        var request = ValidRequest() with { Price = 0m };

        var result = await _sut.HandleAsync(request);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Product.InvalidPrice");
        _products.Verify(r => r.AddAsync(It.IsAny<Product>(), It.IsAny<CancellationToken>()), Times.Never);
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        _eventBus.Verify(
            b => b.PublishAsync(It.IsAny<ProductCreatedIntegrationEvent>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    private static ProductCreateRequest ValidRequest() => new()
    {
        Name = "Espresso Machine",
        Description = "A compact home espresso machine.",
        Price = 499.99m,
    };
}
```

`.../Products/UseCases/Update/UpdateProductHandlerTests.cs`:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Shared.Abstractions;
using MMCA.Common.Testing;
using MMCA.ECommerce.Products.Application.Products.DTOs;
using MMCA.ECommerce.Products.Application.Products.UseCases.Update;
using MMCA.ECommerce.Products.Domain.Products;
using Moq;

namespace MMCA.ECommerce.Products.Application.Tests.Products.UseCases.Update;

/// <summary>
/// Unit tests for <see cref="UpdateProductHandler"/>: the happy path, the ADR-035 concurrency stamp,
/// and the missing-aggregate path.
/// </summary>
public sealed class UpdateProductHandlerTests : HandlerTestBase<UpdateProductHandler>
{
    private const ProductIdentifierType ProductId = 7;

    private readonly Mock<IRepository<Product, ProductIdentifierType>> _products;
    private readonly UpdateProductHandler _sut;

    public UpdateProductHandlerTests()
    {
        _products = RegisterRepository<Product, ProductIdentifierType>();
        _sut = new UpdateProductHandler(UnitOfWork.Object, new ProductDTOMapper());
    }

    [Fact]
    public async Task HandleAsync_WithAnExistingProduct_UpdatesAndReturnsTheRefreshedDTO()
    {
        var product = ExistingProduct();

        var result = await _sut.HandleAsync(UpdateCommand());

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Espresso Machine Pro");
        result.Value.Price.Should().Be(649.00m);
        product.Description.Should().Be("Now with a milk frother.");
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_StampsTheClientsRowVersion_SoAConflictingEditFails()
    {
        var product = ExistingProduct();
        byte[] rowVersion = [1, 2, 3];

        await _sut.HandleAsync(UpdateCommand() with { RowVersion = rowVersion });

        _products.Verify(r => r.SetOriginalRowVersion(product, rowVersion), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WithAnUnknownProduct_ReturnsNotFoundAndSavesNothing()
    {
        _products
            .Setup(r => r.GetByIdAsync(
                ProductId,
                It.IsAny<IEnumerable<string>>(),
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);

        var result = await _sut.HandleAsync(UpdateCommand());

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == Error.NotFound.Code);
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    private static UpdateProductCommand UpdateCommand() =>
        new(ProductId, "Espresso Machine Pro", "Now with a milk frother.", Price: 649.00m);

    private Product ExistingProduct()
    {
        var product = Product
            .Create(id: null, "Espresso Machine", "A compact home espresso machine.", price: 499.99m).Value!;

        _products
            .Setup(r => r.GetByIdAsync(
                ProductId,
                It.IsAny<IEnumerable<string>>(),
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);

        return product;
    }
}
```

`.../Products/UseCases/Delete/DeleteProductHandlerTests.cs`:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Shared.Abstractions;
using MMCA.Common.Testing;
using MMCA.ECommerce.Products.Application.Products.UseCases.Delete;
using MMCA.ECommerce.Products.Domain.Products;
using Moq;

namespace MMCA.ECommerce.Products.Application.Tests.Products.UseCases.Delete;

/// <summary>
/// Unit tests for <see cref="DeleteProductHandler"/>. Delete is a soft delete through the aggregate
/// root, so the assertions are about the flag and the save, not about a row disappearing.
/// </summary>
public sealed class DeleteProductHandlerTests : HandlerTestBase<DeleteProductHandler>
{
    private const ProductIdentifierType ProductId = 7;

    private readonly Mock<IRepository<Product, ProductIdentifierType>> _products;
    private readonly DeleteProductHandler _sut;

    public DeleteProductHandlerTests()
    {
        _products = RegisterRepository<Product, ProductIdentifierType>();
        _sut = new DeleteProductHandler(UnitOfWork.Object);
    }

    [Fact]
    public async Task HandleAsync_WithAnExistingProduct_SoftDeletesTheAggregate()
    {
        var product = ExistingProduct();

        var result = await _sut.HandleAsync(new DeleteProductCommand(ProductId));

        result.IsSuccess.Should().BeTrue();
        product.IsDeleted.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_WithAnExistingProduct_SavesOnce()
    {
        ExistingProduct();

        await _sut.HandleAsync(new DeleteProductCommand(ProductId));

        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HandleAsync_WithAnUnknownProduct_ReturnsNotFoundAndSavesNothing()
    {
        _products
            .Setup(r => r.GetByIdAsync(
                ProductId,
                It.IsAny<IEnumerable<string>>(),
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);

        var result = await _sut.HandleAsync(new DeleteProductCommand(ProductId));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == Error.NotFound.Code);
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    private Product ExistingProduct()
    {
        var product = Product
            .Create(id: null, "Espresso Machine", "A compact home espresso machine.", price: 499.99m).Value!;

        _products
            .Setup(r => r.GetByIdAsync(
                ProductId,
                It.IsAny<IEnumerable<string>>(),
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);

        return product;
    }
}
```

`.../Products/UseCases/GetById/GetProductByIdHandlerTests.cs`. Its two-argument `GetByIdAsync` setup
and the `GetReadRepository` verification are what pin the read-path change you made in 4.4:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Shared.Abstractions;
using MMCA.Common.Testing;
using MMCA.ECommerce.Products.Application.Products.DTOs;
using MMCA.ECommerce.Products.Application.Products.UseCases.GetById;
using MMCA.ECommerce.Products.Domain.Products;
using Moq;

namespace MMCA.ECommerce.Products.Application.Tests.Products.UseCases.GetById;

/// <summary>
/// Unit tests for <see cref="GetProductByIdHandler"/>: the read maps every field, misses surface as
/// a NotFound failure rather than a null, and a query never writes.
/// </summary>
public sealed class GetProductByIdHandlerTests : HandlerTestBase<GetProductByIdHandler>
{
    private const ProductIdentifierType ProductId = 7;

    private readonly Mock<IRepository<Product, ProductIdentifierType>> _products;
    private readonly GetProductByIdHandler _sut;

    public GetProductByIdHandlerTests()
    {
        _products = RegisterRepository<Product, ProductIdentifierType>();
        _sut = new GetProductByIdHandler(UnitOfWork.Object, new ProductDTOMapper());
    }

    [Fact]
    public async Task HandleAsync_WithAnExistingProduct_MapsEveryField()
    {
        GivenAnExistingProduct();

        var result = await _sut.HandleAsync(new GetProductByIdQuery(ProductId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Espresso Machine");
        result.Value.Description.Should().Be("A compact home espresso machine.");
        result.Value.Price.Should().Be(499.99m);
    }

    [Fact]
    public async Task HandleAsync_WithAnUnknownProduct_ReturnsNotFound()
    {
        _products
            .Setup(r => r.GetByIdAsync(ProductId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Product?)null);

        var result = await _sut.HandleAsync(new GetProductByIdQuery(ProductId));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == Error.NotFound.Code);
    }

    [Fact]
    public async Task HandleAsync_ReadsThroughTheReadRepository_AndWritesNothing()
    {
        GivenAnExistingProduct();

        await _sut.HandleAsync(new GetProductByIdQuery(ProductId));

        UnitOfWork.Verify(u => u.GetReadRepository<Product, ProductIdentifierType>(), Times.Once);
        UnitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    private void GivenAnExistingProduct()
    {
        var product = Product
            .Create(id: null, "Espresso Machine", "A compact home espresso machine.", price: 499.99m).Value;

        _products
            .Setup(r => r.GetByIdAsync(ProductId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(product);
    }
}
```

### 4.8 Verify the Products reshape

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

Orders keeps the child-collection pattern the template scaffolded, retargeted: `OrderComment`
becomes `OrderItem`, and the free-form status becomes a lifecycle.

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

The phase order is different from step 4 on purpose. Orders grows new types rather than only
shedding them, and every layer above compiles against the Shared contracts, so those come first;
the domain follows, then the application slices that orchestrate it, then persistence, the API, and
the tests. As before, every file shown is the finished file from the build-verified sample. All
paths are relative to the solution root, and every command is PowerShell.

### 5.1 Shared contracts

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/MMCA.ECommerce.Orders.GlobalUsings.IdentifierType.cs`:
rename the child alias from the scaffold's `OrderCommentIdentifierType`, and put the aggregate first.
The whole file is now:

```csharp
// Orders module entity identifier type aliases.
// Both entities use database-generated integer IDs (the [IdValueGenerated] attribute on the
// domain entities). This file is linked into every project solution-wide via Directory.Build.props,
// so the aliases are visible everywhere. Always use the alias instead of the raw type.
global using OrderIdentifierType = int;
global using OrderItemIdentifierType = int;
```

This file is linked into every project by `Directory.Build.props` (step 3c), so the rename lands
solution-wide the moment you save it.

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderStatus.cs`. The scaffold
ships a flat set of ticket states; this is a lifecycle, and the doc comment is where the legal
transitions are written down for a reader who will not go looking for the invariant:

```csharp
namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Lifecycle status of a customer order. The aggregate owns the legal transitions:
/// Pending to Paid to Shipped, with Cancelled reachable from Pending or Paid.
/// Shipped and Cancelled are terminal, and items can only change while the order is Pending.
/// </summary>
public enum OrderStatus
{
    /// <summary>Placed but not yet paid. The only status in which line items can change.</summary>
    Pending = 0,

    /// <summary>Payment cleared. The line items are locked from here on.</summary>
    Paid = 1,

    /// <summary>Handed to the carrier. Terminal.</summary>
    Shipped = 2,

    /// <summary>Cancelled before shipping. Terminal.</summary>
    Cancelled = 3,
}
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderItemDTO.cs`:

```csharp
using MMCA.Common.Shared.DTOs;

namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Read model for an <c>OrderItem</c> line. <see cref="ProductName"/> and <see cref="UnitPrice"/>
/// are the values snapshotted when the line was added, not a live catalog lookup, so an order shows
/// what the customer actually bought at the price they actually paid.
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

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/OrderDTO.cs`. The `Total`
remarks are load-bearing documentation, not decoration: only the detail read eager-loads `Items`, so
`Total` is 0 on the list and paged projections, and the fix for a caller who needs the number is to
ask the detail endpoint, not to widen the list query:

```csharp
using MMCA.Common.Shared.DTOs;

namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Read model for an <c>Order</c> aggregate returned by the API. Exposes the current
/// <see cref="RowVersion"/> so a client can echo it back on <c>OrderUpdateRequest</c> (ADR-035).
/// </summary>
public record class OrderDTO : IBaseDTO<OrderIdentifierType>, IConcurrencyAware
{
    public required OrderIdentifierType Id { get; init; }

    /// <inheritdoc />
    public byte[]? RowVersion { get; init; }
    public required string CustomerName { get; init; }
    public required OrderStatus Status { get; init; }

    /// <summary>
    /// The order total, computed by the aggregate as the sum of unit price times quantity across its
    /// still-active line items.
    /// <para>
    /// Only the detail read (<c>GET /Orders/{id}/details</c>) eager-loads <see cref="Items"/>. The
    /// inherited list and paged reads do not, so on those paths <see cref="Items"/> comes back empty
    /// and this reads 0. That is the intended shape of a list projection rather than a defect: ask
    /// the detail endpoint when the total matters, and do not widen the list query to chase it.
    /// </para>
    /// </summary>
    public decimal Total { get; init; }

    public IReadOnlyCollection<OrderItemDTO> Items { get; init; } = [];
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
/// Request body for appending a line item to an order (the order id comes from the route). The
/// caller supplies the product name and unit price to snapshot; the Orders module never reads them
/// back from the catalog, which is what keeps it free of any reference to the Products module.
/// </summary>
/// <param name="ProductId">The catalog product identifier.</param>
/// <param name="ProductName">The product name to snapshot onto the line.</param>
/// <param name="UnitPrice">The unit price to snapshot onto the line.</param>
/// <param name="Quantity">The number of units.</param>
public sealed record AddOrderItemRequest(int ProductId, string ProductName, decimal UnitPrice, int Quantity);
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/ChangeOrderItemQuantityRequest.cs`:

```csharp
namespace MMCA.ECommerce.Orders.Shared.Orders;

/// <summary>
/// Request body for re-quantifying a line item (the order id and item id come from the route).
/// </summary>
/// <param name="Quantity">The new number of units.</param>
public sealed record ChangeOrderItemQuantityRequest(int Quantity);
```

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/ChangeOrderStatusRequest.cs`:
the record itself already has the right shape, so only the doc comment changes, to say who owns the
rules:

```csharp
/// <summary>
/// Request body for changing an order's status (the order id comes from the route). The aggregate
/// rejects anything that is not a legal transition.
/// </summary>
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

**Delete** the four Shared files the reshape replaces:

```powershell
Remove-Item `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\IntegrationEvents\OrderOpenedIntegrationEvent.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\OrderCommentDTO.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\AddCommentRequest.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\EditCommentRequest.cs
```

### 5.2 Domain

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderInvariants.cs` with the
complete file below. Eight error codes live here, and every one of them is a code you will localize
in 5.5: the two customer-name codes, the two product-name codes, the unit price, the quantity, the
item lock, and the status transition. The two app-specific rules at the bottom (`Order.ItemsLocked`
and `Order.InvalidStatusTransition`) are the invariant half of the second architecture decision:

```csharp
using MMCA.Common.Domain.Invariants;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Shared.Orders;

namespace MMCA.ECommerce.Orders.Domain.Orders;

/// <summary>
/// Business invariants for the <c>Order</c> aggregate. Each method returns a <see cref="Result"/>
/// so callers can compose them with <see cref="Result.Combine(System.ReadOnlySpan{Result})"/>.
/// The string checks delegate to the framework's <see cref="CommonInvariants"/> helpers, so each
/// field reports a distinct empty vs too-long error; only the app-specific rules (the item lock and
/// the status lifecycle) and the length constants live here.
/// </summary>
public static class OrderInvariants
{
    /// <summary>Maximum length of <c>Order.CustomerName</c>.</summary>
    public const int CustomerNameMaxLength = 200;

    /// <summary>Maximum length of <c>OrderItem.ProductName</c>.</summary>
    public const int ProductNameMaxLength = 200;

    /// <summary>Rejects an empty or over-long customer name.</summary>
    /// <param name="customerName">The candidate customer name.</param>
    /// <param name="source">The calling member, echoed into the error for diagnostics.</param>
    /// <returns>Success, or a failure carrying <c>Order.CustomerName.Empty</c> / <c>Order.CustomerName.TooLong</c>.</returns>
    public static Result EnsureCustomerNameIsValid(string customerName, string source)
        => Result.Combine(
            CommonInvariants.EnsureStringIsNotEmpty(customerName, "Order.CustomerName.Empty", "Customer name cannot be empty.", source, nameof(customerName)),
            CommonInvariants.EnsureStringMaxLength(customerName, CustomerNameMaxLength, "Order.CustomerName.TooLong", $"Customer name cannot exceed {CustomerNameMaxLength} characters.", source, nameof(customerName)));

    /// <summary>Rejects an empty or over-long product name on a line item.</summary>
    /// <param name="productName">The candidate product name snapshot.</param>
    /// <param name="source">The calling member, echoed into the error for diagnostics.</param>
    /// <returns>Success, or a failure carrying <c>Order.Item.ProductName.Empty</c> / <c>Order.Item.ProductName.TooLong</c>.</returns>
    public static Result EnsureProductNameIsValid(string productName, string source)
        => Result.Combine(
            CommonInvariants.EnsureStringIsNotEmpty(productName, "Order.Item.ProductName.Empty", "Order item product name cannot be empty.", source, nameof(productName)),
            CommonInvariants.EnsureStringMaxLength(productName, ProductNameMaxLength, "Order.Item.ProductName.TooLong", $"Order item product name cannot exceed {ProductNameMaxLength} characters.", source, nameof(productName)));

    /// <summary>Rejects a non-positive unit price. A zero-price line is a pricing bug, not a discount.</summary>
    /// <param name="unitPrice">The candidate unit price.</param>
    /// <param name="source">The calling member, echoed into the error for diagnostics.</param>
    /// <returns>Success, or a failure carrying <c>Order.InvalidUnitPrice</c>.</returns>
    public static Result EnsureUnitPriceIsValid(decimal unitPrice, string source)
        => unitPrice <= 0
            ? Result.Failure(Error.Invariant(
                code: "Order.InvalidUnitPrice",
                message: "Order item unit price must be greater than zero.",
                source: source,
                target: nameof(unitPrice)))
            : Result.Success();

    /// <summary>Rejects a non-positive quantity. Removing a line is <c>RemoveItem</c>, not a zero quantity.</summary>
    /// <param name="quantity">The candidate quantity.</param>
    /// <param name="source">The calling member, echoed into the error for diagnostics.</param>
    /// <returns>Success, or a failure carrying <c>Order.InvalidQuantity</c>.</returns>
    public static Result EnsureQuantityIsValid(int quantity, string source)
        => quantity <= 0
            ? Result.Failure(Error.Invariant(
                code: "Order.InvalidQuantity",
                message: "Order item quantity must be greater than zero.",
                source: source,
                target: nameof(quantity)))
            : Result.Success();

    /// <summary>
    /// Guards every line-item mutation: an order's contents are only editable while it is Pending,
    /// because once payment has cleared the total the customer was charged is settled.
    /// </summary>
    /// <param name="status">The order's current status.</param>
    /// <param name="source">The calling member, echoed into the error for diagnostics.</param>
    /// <returns>Success, or a failure carrying <c>Order.ItemsLocked</c>.</returns>
    public static Result EnsureStatusAllowsItemChanges(OrderStatus status, string source)
        => status == OrderStatus.Pending
            ? Result.Success()
            : Result.Failure(Error.Invariant(
                code: "Order.ItemsLocked",
                message: "Order items can only be changed while the order is pending.",
                source: source,
                target: nameof(status)));

    /// <summary>
    /// Guards the status lifecycle: Pending to Paid to Shipped, with Cancelled reachable from
    /// Pending or Paid. Shipped and Cancelled are terminal.
    /// </summary>
    /// <param name="currentStatus">The order's current status.</param>
    /// <param name="newStatus">The requested status.</param>
    /// <param name="source">The calling member, echoed into the error for diagnostics.</param>
    /// <returns>Success, or a failure carrying <c>Order.InvalidStatusTransition</c>.</returns>
    public static Result EnsureStatusTransitionIsValid(OrderStatus currentStatus, OrderStatus newStatus, string source)
        => IsTransitionAllowed(currentStatus, newStatus)
            ? Result.Success()
            : Result.Failure(Error.Invariant(
                code: "Order.InvalidStatusTransition",
                message: "That order status transition is not allowed.",
                source: source,
                target: nameof(newStatus)));

    private static bool IsTransitionAllowed(OrderStatus currentStatus, OrderStatus newStatus) =>
        currentStatus switch
        {
            OrderStatus.Pending => newStatus is OrderStatus.Paid or OrderStatus.Cancelled,
            OrderStatus.Paid => newStatus is OrderStatus.Shipped or OrderStatus.Cancelled,
            OrderStatus.Shipped => false,
            OrderStatus.Cancelled => false,
            _ => false,
        };
}
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/OrderItem.cs`. `ProductId` is a
plain `int`, deliberately not a `ProductIdentifierType` and deliberately not a foreign key: the
Orders module must not name a Products type at all:

```csharp
using MMCA.Common.Domain.Attributes;
using MMCA.Common.Domain.Entities;
using MMCA.Common.Domain.Extensions;
using MMCA.Common.Shared.Abstractions;

namespace MMCA.ECommerce.Orders.Domain.Orders;

/// <summary>
/// A line item on an <see cref="Order"/>. Child entity of the Order aggregate; created and managed
/// through the aggregate root, never directly.
/// <para>
/// <see cref="ProductName"/> and <see cref="UnitPrice"/> are deliberately snapshotted onto the line
/// rather than read back from the Products module: an order records what the customer bought at the
/// price they paid, so a later catalog rename or repricing must not rewrite history. That snapshot
/// is also why the Orders module holds zero references to Products, which is what keeps the
/// module-isolation fitness rules green. <see cref="ProductId"/> is a scalar reference, not a
/// cross-module foreign key.
/// </para>
/// </summary>
[IdValueGenerated]
public sealed class OrderItem : AuditableBaseEntity<OrderItemIdentifierType>
{
    [Navigation]
    public Order? Order { get; set; }

    public OrderIdentifierType OrderId { get; init; }

    /// <summary>The catalog product this line refers to, held as a plain scalar (no FK to Products).</summary>
    public int ProductId { get; private set; }

    /// <summary>The product name as it read when the line was added.</summary>
    public string ProductName { get; private set; }

    /// <summary>The price per unit as it read when the line was added.</summary>
    public decimal UnitPrice { get; private set; }

    /// <summary>How many units of the product this line covers. Always greater than zero.</summary>
    public int Quantity { get; private set; }

    private OrderItem(int productId, string productName, decimal unitPrice, int quantity)
    {
        ProductId = productId;
        ProductName = productName;
        UnitPrice = unitPrice;
        Quantity = quantity;
    }

    /// <summary>Factory for a new line item. Called by <see cref="Order.AddItem"/>, never directly.</summary>
    /// <param name="id">The explicit id, ignored because this entity uses database-generated ids.</param>
    /// <param name="productId">The catalog product identifier.</param>
    /// <param name="productName">The product name to snapshot onto the line.</param>
    /// <param name="unitPrice">The unit price to snapshot onto the line.</param>
    /// <param name="quantity">The number of units.</param>
    /// <returns>The new line item, or the composed invariant failures.</returns>
    public static Result<OrderItem> Create(
        OrderItemIdentifierType? id,
        int productId,
        string productName,
        decimal unitPrice,
        int quantity)
    {
        var validation = Result.Combine(
            OrderInvariants.EnsureProductNameIsValid(productName, nameof(Create)),
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

    /// <summary>Re-quantifies the line. The price snapshot is untouched.</summary>
    /// <param name="quantity">The new number of units.</param>
    /// <returns>Success, or <c>Order.InvalidQuantity</c>.</returns>
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
event, which is what makes a retried status call safe:

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
/// Customer order aggregate root. Created through the <see cref="Create"/> factory (returns a
/// <see cref="Result{T}"/>), mutated through guarded methods that raise <see cref="OrderChanged"/>
/// domain events. Line items are growable children managed via <see cref="AddItem"/>,
/// <see cref="ChangeItemQuantity"/>, and <see cref="RemoveItem"/>, and only while the order is
/// <see cref="OrderStatus.Pending"/>.
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
    /// The order total, computed from the live line items rather than stored, so it can never drift
    /// out of step with them. Soft-deleted (removed) lines are excluded. Not a mapped column:
    /// <c>OrderConfiguration</c> ignores it, and a read that did not eager-load
    /// <see cref="Items"/> reads 0 here.
    /// </summary>
    public decimal Total => _items.Where(i => !i.IsDeleted).Sum(i => i.UnitPrice * i.Quantity);

    private Order(string customerName)
    {
        CustomerName = customerName;
        Status = OrderStatus.Pending;
    }

    /// <summary>Places a new, empty order for a customer.</summary>
    /// <param name="id">The explicit id, ignored because this aggregate uses database-generated ids.</param>
    /// <param name="customerName">The customer the order is for.</param>
    /// <returns>A Pending order with no items, or the invariant failures.</returns>
    public static Result<Order> Create(OrderIdentifierType? id, string customerName)
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

    /// <summary>Appends a line item. Allowed only while the order is Pending.</summary>
    /// <param name="id">The explicit child id, ignored because line items use database-generated ids.</param>
    /// <param name="productId">The catalog product identifier.</param>
    /// <param name="productName">The product name to snapshot onto the line.</param>
    /// <param name="unitPrice">The unit price to snapshot onto the line.</param>
    /// <param name="quantity">The number of units.</param>
    /// <returns>The new line, or <c>Order.ItemsLocked</c> / the line's own invariant failures.</returns>
    public Result<OrderItem> AddItem(
        OrderItemIdentifierType? id,
        int productId,
        string productName,
        decimal unitPrice,
        int quantity)
    {
        var statusValidation = OrderInvariants.EnsureStatusAllowsItemChanges(Status, nameof(AddItem));
        if (statusValidation.IsFailure)
        {
            return Result.Failure<OrderItem>(statusValidation.Errors);
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

    /// <summary>Renames the customer on the order. Allowed in any status.</summary>
    /// <param name="customerName">The new customer name.</param>
    /// <returns>Success, or the customer-name invariant failures.</returns>
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

    /// <summary>Re-quantifies an existing line. Allowed only while the order is Pending.</summary>
    /// <param name="itemId">The line item identifier.</param>
    /// <param name="quantity">The new number of units.</param>
    /// <returns>Success, or <c>Order.ItemsLocked</c> / NotFound / <c>Order.InvalidQuantity</c>.</returns>
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

    /// <summary>Removes (soft-deletes) a line. Allowed only while the order is Pending.</summary>
    /// <param name="itemId">The line item identifier.</param>
    /// <returns>Success, or <c>Order.ItemsLocked</c> / NotFound.</returns>
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

    /// <summary>
    /// Moves the order along its lifecycle. Re-asserting the current status is a no-op success (an
    /// idempotent retry is not an error and raises no event); anything else must be a legal
    /// transition per <see cref="OrderInvariants.EnsureStatusTransitionIsValid"/>.
    /// </summary>
    /// <param name="newStatus">The requested status.</param>
    /// <returns>Success, or <c>Order.InvalidStatusTransition</c>.</returns>
    public Result ChangeStatus(OrderStatus newStatus)
    {
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

    /// <summary>Soft-deletes the order and cascade-soft-deletes its still-active line items.</summary>
    /// <returns>The base result, with the cascade and the Deleted domain event applied on success.</returns>
    public override Result Delete()
    {
        var result = base.Delete();
        if (result.IsFailure)
        {
            return result;
        }

        foreach (var item in _items.Where(i => !i.IsDeleted))
        {
            item.Delete();
        }

        AddDomainEvent(new OrderChanged(DomainEntityState.Deleted, Id));

        return result;
    }
}
```

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/DomainEvents/OrderChanged.cs`:
the event no longer fires on creation, so change the first summary line (the scaffold says "opened,
mutated, or deleted"):

```csharp
/// Domain event raised when an <c>Order</c> is mutated or deleted. Captured into the outbox by
```

**Delete** the scaffolded child entity:

```powershell
Remove-Item Source\Modules\Orders\MMCA.ECommerce.Orders.Domain\Orders\OrderComment.cs
```

### 5.3 Application

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/DTOs/OrderItemDTOMapper.cs`:

```csharp
using MMCA.Common.Application.Interfaces;
using MMCA.ECommerce.Orders.Domain.Orders;
using MMCA.ECommerce.Orders.Shared.Orders;
using Riok.Mapperly.Abstractions;

namespace MMCA.ECommerce.Orders.Application.Orders.DTOs;

/// <summary>
/// Maps <see cref="OrderItem"/> child entities to <see cref="OrderItemDTO"/> (Mapperly).
/// </summary>
[Mapper]
public sealed partial class OrderItemDTOMapper
    : IEntityDTOMapper<OrderItem, OrderItemDTO, OrderItemIdentifierType>
{
    public partial OrderItemDTO MapToDTO(OrderItem entity);

    public IReadOnlyCollection<OrderItemDTO> MapToDTOs(IReadOnlyCollection<OrderItem> entityCollection)
    {
        ArgumentNullException.ThrowIfNull(entityCollection);
        return [.. entityCollection.Select(MapToDTO)];
    }
}
```

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/DTOs/OrderDTOMapper.cs`:
retarget the child mapper and extend the doc comment to record why a list-projection DTO carries a
zero total. Replace the doc comment, the class declaration, and the `[UseMapper]` field with:

```csharp
/// <summary>
/// Maps the <see cref="Order"/> aggregate to <see cref="OrderDTO"/> (Mapperly), delegating child
/// line-item mapping to <see cref="OrderItemDTOMapper"/>. The aggregate's computed
/// <see cref="Order.Total"/> maps onto <see cref="OrderDTO.Total"/> by name, so a DTO built from an
/// order whose items were not eager-loaded carries a total of 0 (see the remarks on the DTO).
/// </summary>
[Mapper]
public sealed partial class OrderDTOMapper(OrderItemDTOMapper orderItemDTOMapper)
    : IEntityDTOMapper<Order, OrderDTO, OrderIdentifierType>
{
    [UseMapper]
    private readonly OrderItemDTOMapper _orderItemDTOMapper = orderItemDTOMapper;
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/IntegrationEventHandlers/OrderPlacedHandler.cs`:

```csharp
using Microsoft.Extensions.Logging;
using MMCA.Common.Application.Interfaces;
using MMCA.ECommerce.Orders.Shared.Orders.IntegrationEvents;

namespace MMCA.ECommerce.Orders.Application.Orders.IntegrationEventHandlers;

/// <summary>
/// Consumes <see cref="OrderPlacedIntegrationEvent"/>. In this monolith seed it just logs; in a real
/// system this is where a confirmation email, a fulfilment hand-off, or an analytics side effect
/// would live. The same handler runs in-process now and over the broker once the Orders module is
/// extracted (ADR-003 / ADR-008). Auto-discovered by Scrutor (singleton lifetime); the dispatcher
/// routes the outbox-published event here.
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

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/DomainEventHandlers/OrderChangedAuditHandler.cs`:
one doc line, naming the handler that now audits creation. Change the second-to-last summary line to:

```csharp
/// Creation is audited separately by the integration-event consumer (<c>OrderPlacedHandler</c>),
```

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
/// An order is created empty: line items are appended afterwards through <c>AddItemCommand</c>.
/// </summary>
public record class OrderCreateRequest : ICreateRequest, ICacheInvalidating
{
    public string CachePrefix => OrderCacheKeys.Prefix;

    public required string CustomerName { get; init; }
}
```

`.../UseCases/Create/OrderCreateRequestMapper.cs`:

```csharp
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Domain.Orders;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.Create;

/// <summary>
/// Maps an <see cref="OrderCreateRequest"/> to a new <see cref="Order"/> via the domain factory.
/// </summary>
public sealed class OrderCreateRequestMapper
    : IEntityRequestMapper<Order, OrderCreateRequest, OrderIdentifierType>
{
    public Task<Result<Order>> CreateEntityAsync(OrderCreateRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        return Task.FromResult(Order.Create(
            id: null,
            customerName: request.CustomerName));
    }
}
```

`.../UseCases/Create/OrderCreateRequestValidator.cs` (one rule now, so the constructor is an
expression body):

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

`.../UseCases/Create/CreateOrderHandler.cs`:

```csharp
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Application.UseCases;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Application.Orders.DTOs;
using MMCA.ECommerce.Orders.Domain.Orders;
using MMCA.ECommerce.Orders.Shared.Orders;
using MMCA.ECommerce.Orders.Shared.Orders.IntegrationEvents;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.Create;

/// <summary>
/// Places a new order: maps the request through the domain factory, persists via the unit of work
/// (which stamps audit fields and dispatches domain events), then publishes the
/// <see cref="OrderPlacedIntegrationEvent"/> for cross-module/cross-service consumers. Wrapped by
/// the decorator pipeline (logging, caching, validating, transactional) once
/// <c>AddApplicationDecorators()</c> runs.
/// </summary>
public sealed class CreateOrderHandler(
    IUnitOfWork unitOfWork,
    IEntityRequestMapper<Order, OrderCreateRequest, OrderIdentifierType> requestMapper,
    IEventBus eventBus,
    OrderDTOMapper dtoMapper) : ICommandHandler<OrderCreateRequest, Result<OrderDTO>>
{
    public async Task<Result<OrderDTO>> HandleAsync(OrderCreateRequest command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        var result = await requestMapper.CreateEntityAsync(command, cancellationToken).ConfigureAwait(false);
        if (result.IsFailure)
        {
            return Result.Failure<OrderDTO>(result.Errors);
        }

        var entity = result.Value!;
        var repository = unitOfWork.GetRepository<Order, OrderIdentifierType>();

        await repository.AddAsync(entity, cancellationToken).ConfigureAwait(false);
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        // Published after the commit so the database-generated order id is populated by the time the
        // event reaches consumers. The publisher persists the event to the outbox and dispatches it
        // in-process today, and will route it over a broker once Orders is extracted, with no handler
        // code change required.
        await eventBus.PublishAsync(
            new OrderPlacedIntegrationEvent(entity.Id, entity.CustomerName),
            cancellationToken).ConfigureAwait(false);

        return Result.Success(dtoMapper.MapToDTO(entity));
    }
}
```

**Edit** the four scaffolded slices that survive. Every one of them keeps
`includes: [nameof(Order.Items)]`: the aggregate has to have its lines in memory to enforce the item
lock and recompute the total, and a rename of `Items` would break these silently if they were
strings, which is why `nameof` is used.

In `.../UseCases/Update/UpdateOrderCommand.cs`, the record loses the description parameter. The full
signature and its doc parameters are now:

```csharp
/// <param name="OrderId">The order to update.</param>
/// <param name="CustomerName">The new customer name.</param>
public sealed record UpdateOrderCommand(
    OrderIdentifierType OrderId,
    string CustomerName)
    : ICacheInvalidating
```

In `.../UseCases/Update/UpdateOrderHandler.cs`, change the summary and the call into the aggregate:

```csharp
/// <summary>
/// Updates an order's customer name through the aggregate root, then returns the refreshed DTO.
/// Loads the items too so the returned DTO carries the real total.
/// </summary>
```

```csharp
            includes: [nameof(Order.Items)],
```

```csharp
        var result = order.UpdateDetails(command.CustomerName);
```

In `.../UseCases/Delete/DeleteOrderCommand.cs`, change the summary and add the parameter doc:

```csharp
/// <summary>
/// Command to soft-delete an order (and cascade-soft-delete its line items). Evicts cached reads on success.
/// </summary>
/// <param name="OrderId">The order to soft-delete.</param>
```

In `.../UseCases/Delete/DeleteOrderHandler.cs`, change the summary and the include:

```csharp
/// <summary>
/// Soft-deletes an order through the aggregate root (loaded tracked with its line items so the
/// cascade soft-deletes them too). The EF global query filter then excludes it from subsequent reads.
/// </summary>
```

```csharp
            includes: [nameof(Order.Items)],
```

In `.../UseCases/GetById/GetOrderByIdQuery.cs`, change the first summary line:

```csharp
/// Query for a single order including its (non-deleted) line items and computed total.
```

In `.../UseCases/GetById/GetOrderByIdHandler.cs`, change the summary and the include:

```csharp
/// <summary>
/// Loads a single order with its line items (the list endpoint omits children, and therefore reports
/// a total of 0) and maps it to a DTO.
/// </summary>
```

```csharp
            includes: [nameof(Order.Items)],
```

In `.../UseCases/ChangeStatus/ChangeOrderStatusCommand.cs`, change the doc comment (the record shape
is already right):

```csharp
/// <summary>
/// Command to move an order along its lifecycle. Evicts cached order reads on success. The
/// aggregate, not this command, decides whether the transition is legal.
/// </summary>
/// <param name="OrderId">The order to move.</param>
/// <param name="Status">The requested status.</param>
```

In `.../UseCases/ChangeStatus/ChangeOrderStatusHandler.cs`, change the summary and the include:

```csharp
/// <summary>
/// Changes an order's status through the aggregate root, then returns the refreshed DTO. An illegal
/// transition comes back as <c>Order.InvalidStatusTransition</c> and nothing is saved.
/// </summary>
```

```csharp
            includes: [nameof(Order.Items)],
```

**Create** the three line-item slices. Each is a command plus a handler, and each handler follows the
same shape: load the order tracked with its items, call the aggregate, save only if the aggregate
said yes.

`.../UseCases/AddItem/AddItemCommand.cs`:

```csharp
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.AddItem;

/// <summary>
/// Command to append a line item to an existing order. Implements <see cref="ICacheInvalidating"/>
/// so cached order reads are evicted after a successful add (the total moves with every line).
/// </summary>
/// <param name="OrderId">The order to append to.</param>
/// <param name="ProductId">The catalog product identifier.</param>
/// <param name="ProductName">The product name to snapshot onto the line.</param>
/// <param name="UnitPrice">The unit price to snapshot onto the line.</param>
/// <param name="Quantity">The number of units.</param>
public sealed record AddItemCommand(
    OrderIdentifierType OrderId,
    int ProductId,
    string ProductName,
    decimal UnitPrice,
    int Quantity) : ICacheInvalidating
{
    public string CachePrefix => OrderCacheKeys.Prefix;
}
```

`.../UseCases/AddItem/AddItemHandler.cs`:

```csharp
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Application.UseCases;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Application.Orders.DTOs;
using MMCA.ECommerce.Orders.Domain.Orders;
using MMCA.ECommerce.Orders.Shared.Orders;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.AddItem;

/// <summary>
/// Loads the order (tracked, with its line items), appends a line through the aggregate root, and
/// saves. Demonstrates the canonical eager-load-then-mutate idiom for adding a child to an aggregate:
/// the items have to be in memory for the aggregate to enforce its own rules and recompute the total.
/// </summary>
public sealed class AddItemHandler(
    IUnitOfWork unitOfWork,
    OrderItemDTOMapper itemDTOMapper) : ICommandHandler<AddItemCommand, Result<OrderItemDTO>>
{
    public async Task<Result<OrderItemDTO>> HandleAsync(AddItemCommand command, CancellationToken cancellationToken = default)
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
            return Result.Failure<OrderItemDTO>(
                Error.NotFound.WithSource(nameof(AddItemHandler)).WithTarget(nameof(Order)));
        }

        var result = order.AddItem(
            id: null,
            command.ProductId,
            command.ProductName,
            command.UnitPrice,
            command.Quantity);
        if (result.IsFailure)
        {
            return Result.Failure<OrderItemDTO>(result.Errors);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return Result.Success(itemDTOMapper.MapToDTO(result.Value!));
    }
}
```

`.../UseCases/ChangeItemQuantity/ChangeItemQuantityCommand.cs`:

```csharp
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.ChangeItemQuantity;

/// <summary>
/// Command to re-quantify an existing line item on an order. Evicts cached order reads on success.
/// </summary>
/// <param name="OrderId">The order that owns the line.</param>
/// <param name="ItemId">The line item to re-quantify.</param>
/// <param name="Quantity">The new number of units.</param>
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
/// Re-quantifies a line item through the order aggregate (loaded tracked with its line items).
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

`.../UseCases/RemoveItem/RemoveItemCommand.cs`:

```csharp
using MMCA.Common.Application.UseCases;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.RemoveItem;

/// <summary>
/// Command to remove (soft-delete) a line item from an order. Evicts cached order reads on success.
/// </summary>
/// <param name="OrderId">The order that owns the line.</param>
/// <param name="ItemId">The line item to remove.</param>
public sealed record RemoveItemCommand(
    OrderIdentifierType OrderId,
    OrderItemIdentifierType ItemId) : ICacheInvalidating
{
    public string CachePrefix => OrderCacheKeys.Prefix;
}
```

`.../UseCases/RemoveItem/RemoveItemHandler.cs`:

```csharp
using MMCA.Common.Application.Interfaces.Infrastructure;
using MMCA.Common.Application.UseCases;
using MMCA.Common.Shared.Abstractions;
using MMCA.ECommerce.Orders.Domain.Orders;

namespace MMCA.ECommerce.Orders.Application.Orders.UseCases.RemoveItem;

/// <summary>
/// Removes (soft-deletes) a line item through the order aggregate (loaded tracked with its line
/// items). The line stays in the table with <c>IsDeleted</c> set and drops out of the total.
/// </summary>
public sealed class RemoveItemHandler(IUnitOfWork unitOfWork)
    : ICommandHandler<RemoveItemCommand, Result>
{
    public async Task<Result> HandleAsync(RemoveItemCommand command, CancellationToken cancellationToken = default)
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
                Error.NotFound.WithSource(nameof(RemoveItemHandler)).WithTarget(nameof(Order)));
        }

        var result = order.RemoveItem(command.ItemId);
        if (result.IsFailure)
        {
            return result;
        }

        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return Result.Success();
    }
}
```

**Delete** the comment mapper, the old integration-event handler, and the three comment slices (six
files across the three folders, eight items in all):

```powershell
Remove-Item -Recurse `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\DTOs\OrderCommentDTOMapper.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\IntegrationEventHandlers\OrderOpenedHandler.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\UseCases\AddComment, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\UseCases\EditComment, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\UseCases\RemoveComment
```

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.Application/DependencyInjection.cs`: one
comment, so it names line items rather than comments. Replace the three-line comment above the
`TryAddScoped<INavigationPopulator<Order>, ...>` call with:

```csharp
            // The Order aggregate has children but eager loading goes through repository includes,
            // so a null populator suffices here (swap for a custom INavigationPopulator<Order> if the
            // query service needs to batch-load line items).
```

### 5.4 Infrastructure

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/OrderConfiguration.cs`.
Two lines here are easy to skip and expensive to omit: `Status` is persisted as a **string**, so a
later reordering of the enum cannot silently reinterpret stored rows, and `builder.Ignore(o => o.Total)`
keeps EF from trying to map the computed getter (without it the model build fails outright):

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

        // Total is derived from the line items on every read, so there is no column to keep in sync.
        // Without this Ignore, EF would try to map a getter-only property and fail the model build.
        builder.Ignore(o => o.Total);

        builder.HasIndex(p => p.CustomerName)
            .HasFilter("[IsDeleted] = 0");

        builder.HasMany(p => p.Items)
            .WithOne(i => i.Order)
            .HasForeignKey(i => i.OrderId)
            .IsRequired();
    }
}
```

**Create** `Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/OrderItemConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration;
using MMCA.ECommerce.Orders.Domain.Orders;

namespace MMCA.ECommerce.Orders.Infrastructure.Persistence.EntityConfiguration;

/// <summary>
/// EF Core configuration for the <see cref="OrderItem"/> child entity. The parent
/// <see cref="OrderConfiguration"/> owns the relationship; this configures the line's own columns.
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
            .HasMaxLength(OrderInvariants.ProductNameMaxLength)
            .IsRequired();

        // Money is decimal(18,2), never the SQL Server default decimal(18,0), which would silently
        // round every cent off the line and therefore off the order total.
        builder.Property(p => p.UnitPrice)
            .HasColumnType("decimal(18,2)")
            .IsRequired();

        builder.Property(p => p.Quantity)
            .IsRequired();
    }
}
```

**Delete** the scaffolded comment configuration:

```powershell
Remove-Item Source\Modules\Orders\MMCA.ECommerce.Orders.Infrastructure\Persistence\EntityConfiguration\OrderCommentConfiguration.cs
```

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs`:
retarget the child `DbSet` so the body is exactly:

```csharp
    internal DbSet<Order> Orders { get; set; }
    internal DbSet<OrderItem> OrderItems { get; set; }
```

### 5.5 API

**Rewrite** `Source/Modules/Orders/MMCA.ECommerce.Orders.API/Controllers/OrdersController.cs`. The
list and paged reads still come from `EntityControllerBase`; everything else is an injected handler,
one per use case, which is why the constructor is long and each action is three lines:

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
/// <see cref="EntityControllerBase{TEntity, TDTO, TId}"/>; create, update, status, and line-item
/// operations inject handlers directly. Failures map to RFC 9457 ProblemDetails via <c>HandleFailure</c>.
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
    /// <summary>Gets a single order including its line items and computed total.</summary>
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

    /// <summary>Places a new (empty) order for a customer.</summary>
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

    /// <summary>Moves an order along its lifecycle. An illegal transition comes back as 400.</summary>
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

    /// <summary>Soft-deletes an order (and cascade-soft-deletes its line items).</summary>
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

    /// <summary>Appends a line item to a pending order.</summary>
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

    /// <summary>Re-quantifies a line item on a pending order.</summary>
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

    /// <summary>Removes (soft-deletes) a line item from a pending order.</summary>
    [HttpDelete("{id}/items/{itemId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
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
`.es.resx` sibling, keep the resx envelope exactly as generated (the `<xsd:schema>` block and the
four `<resheader>` elements) and replace **only** the `<data>` elements: delete the seven scaffolded
ones (`Order.Closed`, `Order.Title.*`, `Order.Description.*`, `Order.Comment.Body.*`) and add the
eight below, in this order. That is one entry per code `OrderInvariants` can emit, which is what
makes the Pending-only lock and the lifecycle guard reach the user in their own language rather than
as a raw code:

| `data name` | `.resx` value (en) | `.es.resx` value (es) |
|---|---|---|
| `Order.CustomerName.Empty` | Customer name cannot be empty. | El nombre del cliente no puede estar vacío. |
| `Order.CustomerName.TooLong` | Customer name cannot exceed 200 characters. | El nombre del cliente no puede superar los 200 caracteres. |
| `Order.InvalidQuantity` | Order item quantity must be greater than zero. | La cantidad de la línea del pedido debe ser mayor que cero. |
| `Order.InvalidStatusTransition` | That order status transition is not allowed. | Ese cambio de estado del pedido no está permitido. |
| `Order.InvalidUnitPrice` | Order item unit price must be greater than zero. | El precio unitario de la línea del pedido debe ser mayor que cero. |
| `Order.Item.ProductName.Empty` | Order item product name cannot be empty. | El nombre del producto de la línea del pedido no puede estar vacío. |
| `Order.Item.ProductName.TooLong` | Order item product name cannot exceed 200 characters. | El nombre del producto de la línea del pedido no puede superar los 200 caracteres. |
| `Order.ItemsLocked` | Order items can only be changed while the order is pending. | Las líneas del pedido solo se pueden modificar mientras el pedido está pendiente. |

Each entry is a `<data name="..." xml:space="preserve">` element wrapping a single `<value>`, exactly
like the ones you are replacing.

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.API/Resources/OrdersErrorResources.cs`: the doc
comment cites a code that no longer exists. Change the example code and the constant it names:

```csharp
/// domain error <c>Code</c> (e.g. <c>"Order.ItemsLocked"</c>, see <c>OrderInvariants</c>) and resolved
/// by the shared <c>IErrorLocalizer</c> after the host registers this type via
/// <c>AddErrorResources&lt;OrdersErrorResources&gt;()</c>. The length limits are baked into the values
/// because they are compile-time constants (<c>OrderInvariants.CustomerNameMaxLength</c> etc.); an
```

The solution builds again at this point.

### 5.6 Tests

**Rewrite** `Tests/Modules/Orders/MMCA.ECommerce.Orders.Domain.Tests/Orders/OrderTests.cs` with the
complete file below (33 tests). Keep the class remarks verbatim: they document a real consequence of
database-generated ids that the tests then lean on deliberately, and without them the two tests that
pass an id of 0 look like mistakes:

```csharp
using AwesomeAssertions;
using MMCA.Common.Domain.Enums;
using MMCA.ECommerce.Orders.Domain.Orders;
using MMCA.ECommerce.Orders.Domain.Orders.DomainEvents;
using MMCA.ECommerce.Orders.Shared.Orders;

namespace MMCA.ECommerce.Orders.Domain.Tests.Orders;

/// <summary>
/// Aggregate tests for <see cref="Order"/>.
/// <para>
/// One thing to know before reading the line-item tests: <see cref="OrderItem"/> is
/// <c>[IdValueGenerated]</c>, so a line that has never been persisted still carries Id 0, and every
/// unpersisted line on the same order therefore shares that Id. The framework's
/// <c>GetChildOrNotFound</c> resolves the FIRST non-deleted match, so <c>ChangeItemQuantity(0, ...)</c>
/// and <c>RemoveItem(0)</c> address the first still-active line. That is the real behavior of a
/// database-generated key in a pure in-memory test, not a defect to work around: the tests below
/// lean on it deliberately rather than faking ids the database would have assigned.
/// </para>
/// </summary>
public class OrderTests
{
    // ── Create ──
    [Fact]
    public void Create_WithValidCustomerName_ReturnsPendingOrderWithNoItems()
    {
        var result = Order.Create(id: null, "Ada Lovelace");

        result.IsSuccess.Should().BeTrue();
        result.Value!.CustomerName.Should().Be("Ada Lovelace");
        result.Value.Status.Should().Be(OrderStatus.Pending);
        result.Value.Items.Should().BeEmpty();
        result.Value.Total.Should().Be(0m);
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

    // ── UpdateDetails ──
    [Fact]
    public void UpdateDetails_WithValidCustomerName_UpdatesAndRaisesEvent()
    {
        var order = CreatePendingOrder();

        var result = order.UpdateDetails("Grace Hopper");

        result.IsSuccess.Should().BeTrue();
        order.CustomerName.Should().Be("Grace Hopper");
        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void UpdateDetails_WithEmptyCustomerName_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.UpdateDetails("   ");

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.Empty");
    }

    [Fact]
    public void UpdateDetails_WithTooLongCustomerName_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.UpdateDetails(new string('x', OrderInvariants.CustomerNameMaxLength + 1));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.TooLong");
    }

    // ── AddItem ──
    [Fact]
    public void AddItem_OnPendingOrder_AddsItemAndRaisesEvent()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 3);

        result.IsSuccess.Should().BeTrue();
        result.Value!.ProductName.Should().Be("Blue Widget");
        result.Value.UnitPrice.Should().Be(9.99m);
        result.Value.Quantity.Should().Be(3);
        order.Items.Should().ContainSingle();
        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void AddItem_WithEmptyProductName_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "   ", unitPrice: 9.99m, quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.Item.ProductName.Empty");
        order.Items.Should().BeEmpty();
    }

    [Fact]
    public void AddItem_WithTooLongProductName_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(
            id: null,
            productId: 11,
            new string('x', OrderInvariants.ProductNameMaxLength + 1),
            unitPrice: 9.99m,
            quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.Item.ProductName.TooLong");
    }

    [Fact]
    public void AddItem_WithZeroUnitPrice_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 0m, quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidUnitPrice");
    }

    [Fact]
    public void AddItem_WithNegativeUnitPrice_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: -1m, quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidUnitPrice");
    }

    [Fact]
    public void AddItem_WithZeroQuantity_ReturnsFailure()
    {
        var order = CreatePendingOrder();

        var result = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 0);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidQuantity");
    }

    [Fact]
    public void AddItem_OnPaidOrder_ReturnsItemsLocked()
    {
        var order = CreatePaidOrder();

        var result = order.AddItem(id: null, productId: 12, "Red Widget", unitPrice: 5m, quantity: 1);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.ItemsLocked");
    }

    // ── ChangeItemQuantity ──
    [Fact]
    public void ChangeItemQuantity_OnPendingOrder_UpdatesQuantityAndRaisesEvent()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 1).Value!;

        var result = order.ChangeItemQuantity(item.Id, quantity: 4);

        result.IsSuccess.Should().BeTrue();
        item.Quantity.Should().Be(4);
        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void ChangeItemQuantity_WithUnknownId_ReturnsFailure()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 1);

        var result = order.ChangeItemQuantity(itemId: 999, quantity: 4);

        result.IsFailure.Should().BeTrue();
    }

    [Fact]
    public void ChangeItemQuantity_WithZeroQuantity_ReturnsFailure()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 2).Value!;

        var result = order.ChangeItemQuantity(item.Id, quantity: 0);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidQuantity");
        item.Quantity.Should().Be(2);
    }

    [Fact]
    public void ChangeItemQuantity_OnPaidOrder_ReturnsItemsLocked()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 2).Value!;
        order.ChangeStatus(OrderStatus.Paid);

        var result = order.ChangeItemQuantity(item.Id, quantity: 5);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.ItemsLocked");
        item.Quantity.Should().Be(2);
    }

    // ── RemoveItem ──
    [Fact]
    public void RemoveItem_OnPendingOrder_SoftDeletesItemAndRaisesEvent()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 1).Value!;

        var result = order.RemoveItem(item.Id);

        result.IsSuccess.Should().BeTrue();
        item.IsDeleted.Should().BeTrue();
        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    [Fact]
    public void RemoveItem_WithUnknownId_ReturnsFailure()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 1);

        var result = order.RemoveItem(itemId: 999);

        result.IsFailure.Should().BeTrue();
    }

    [Fact]
    public void RemoveItem_OnPaidOrder_ReturnsItemsLocked()
    {
        var order = CreatePendingOrder();
        var item = order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 1).Value!;
        order.ChangeStatus(OrderStatus.Paid);

        var result = order.RemoveItem(item.Id);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.ItemsLocked");
        item.IsDeleted.Should().BeFalse();
    }

    // ── ChangeStatus ──
    [Fact]
    public void ChangeStatus_PendingToPaid_Succeeds()
    {
        var order = CreatePendingOrder();

        var result = order.ChangeStatus(OrderStatus.Paid);

        result.IsSuccess.Should().BeTrue();
        order.Status.Should().Be(OrderStatus.Paid);
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
    public void ChangeStatus_PendingToShipped_ReturnsInvalidTransition()
    {
        var order = CreatePendingOrder();

        var result = order.ChangeStatus(OrderStatus.Shipped);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidStatusTransition");
        order.Status.Should().Be(OrderStatus.Pending);
    }

    [Fact]
    public void ChangeStatus_ToTheSameStatus_IsANoOpSuccessAndRaisesNoEvent()
    {
        var order = CreatePendingOrder();

        var result = order.ChangeStatus(OrderStatus.Pending);

        result.IsSuccess.Should().BeTrue();
        order.Status.Should().Be(OrderStatus.Pending);
        order.DomainEvents.Should().BeEmpty("re-asserting the current status is an idempotent retry, not a change");
    }

    [Fact]
    public void ChangeStatus_FromShipped_IsTerminal()
    {
        var order = CreatePaidOrder();
        order.ChangeStatus(OrderStatus.Shipped);

        var result = order.ChangeStatus(OrderStatus.Cancelled);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidStatusTransition");
        order.Status.Should().Be(OrderStatus.Shipped);
    }

    [Fact]
    public void ChangeStatus_FromCancelled_IsTerminal()
    {
        var order = CreatePendingOrder();
        order.ChangeStatus(OrderStatus.Cancelled);

        var result = order.ChangeStatus(OrderStatus.Paid);

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidStatusTransition");
        order.Status.Should().Be(OrderStatus.Cancelled);
    }

    [Fact]
    public void ChangeStatus_RaisesUpdatedDomainEvent()
    {
        var order = CreatePendingOrder();

        order.ChangeStatus(OrderStatus.Paid);

        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Updated);
    }

    // ── Delete ──
    [Fact]
    public void Delete_SoftDeletesOrderAndCascadesToItems()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 1);
        order.AddItem(id: null, productId: 12, "Red Widget", unitPrice: 4.50m, quantity: 2);

        var result = order.Delete();

        result.IsSuccess.Should().BeTrue();
        order.IsDeleted.Should().BeTrue();
        order.Items.Should().OnlyContain(i => i.IsDeleted);
        order.DomainEvents.OfType<OrderChanged>()
            .Should().Contain(e => e.State == DomainEntityState.Deleted);
    }

    // ── Total ──
    [Fact]
    public void Total_SumsUnitPriceTimesQuantityAcrossItems()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 3);
        order.AddItem(id: null, productId: 12, "Red Widget", unitPrice: 4.50m, quantity: 2);

        order.Total.Should().Be(9.99m * 3 + 4.50m * 2);
    }

    [Fact]
    public void Total_ExcludesRemovedItems()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 3);
        order.AddItem(id: null, productId: 12, "Red Widget", unitPrice: 4.50m, quantity: 2);

        // Both lines are unpersisted and therefore share Id 0, so this removes the FIRST still-active
        // line (see the class remarks): the Blue Widget line, leaving only the Red Widget line.
        var result = order.RemoveItem(itemId: 0);

        result.IsSuccess.Should().BeTrue();
        order.Total.Should().Be(4.50m * 2);
    }

    // ── Helpers ──
    private static Order CreatePendingOrder() =>
        Order.Create(id: null, "Ada Lovelace").Value!;

    private static Order CreatePaidOrder()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 1);
        order.ChangeStatus(OrderStatus.Paid);
        return order;
    }
}
```

**Edit** `Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/MMCA.ECommerce.Orders.Application.Tests.csproj`.
The handler tests mock the unit of work directly, so this project needs Moq (and nothing else new).
Add one line to the package `ItemGroup` so it reads:

```xml
  <ItemGroup>
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="AwesomeAssertions" />
    <PackageReference Include="Moq" />
```

No version attribute: `Moq` is already pinned in the solution's `Directory.Packages.props` under
Central Package Management.

**Rewrite** `Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/Caching/OrderCacheInvalidationTests.cs`
with the complete file below (4 tests). The last one enumerates **all seven** order commands, so a
new slice added later without a `CachePrefix` is caught here rather than in production:

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
        var write = new CachingCommandDecorator<ChangeOrderStatusCommand, Result<OrderDTO>>(
            new StubCommandHandler(OrderResult(OrderStatus.Paid)), cache);

        await read.HandleAsync(new GetOrderByIdQuery(OrderId));
        await read.HandleAsync(new GetOrderByIdQuery(OrderId));
        queryHandler.Invocations.Should().Be(1, "the cache is warm before the write");

        var written = await write.HandleAsync(new ChangeOrderStatusCommand(OrderId, OrderStatus.Paid));

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
        var write = new CachingCommandDecorator<ChangeOrderStatusCommand, Result<OrderDTO>>(
            new StubCommandHandler(Result.Failure<OrderDTO>(Error.NotFound)), cache);

        await read.HandleAsync(new GetOrderByIdQuery(OrderId));

        var written = await write.HandleAsync(new ChangeOrderStatusCommand(OrderId, OrderStatus.Paid));

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
        new UpdateOrderCommand(OrderId, "Grace Hopper"),
        new DeleteOrderCommand(OrderId),
        new ChangeOrderStatusCommand(OrderId, OrderStatus.Paid),
        new AddItemCommand(OrderId, ProductId: 11, "Blue Widget", UnitPrice: 9.99m, Quantity: 3),
        new ChangeItemQuantityCommand(OrderId, ItemId: 1, Quantity: 5),
        new RemoveItemCommand(OrderId, ItemId: 1),
    ];

    private static Result<OrderDTO> OrderResult(OrderStatus status = OrderStatus.Pending) =>
        Result.Success(new OrderDTO
        {
            Id = OrderId,
            CustomerName = "Ada Lovelace",
            Status = status,
            Total = 29.97m,
            Items =
            [
                new OrderItemDTO
                {
                    Id = 1,
                    ProductId = 11,
                    ProductName = "Blue Widget",
                    UnitPrice = 9.99m,
                    Quantity = 3,
                },
            ],
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
        : ICommandHandler<ChangeOrderStatusCommand, Result<OrderDTO>>
    {
        public Task<Result<OrderDTO>> HandleAsync(
            ChangeOrderStatusCommand command,
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
(19 tests, one class covering every Orders use case). Note the single `SetupGetById` helper: its
`asTracking` argument is what distinguishes the read handler from the write handlers, so a handler
that silently switched tracking mode would fail here:

```csharp
using AwesomeAssertions;
using MMCA.Common.Application.Interfaces;
using MMCA.Common.Application.Interfaces.Infrastructure;
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
/// Handler-level tests for every Orders use case. The unit of work and its repository are mocked, so
/// these cover the handler's own job (load, delegate to the aggregate, save or not, shape the result)
/// without a database; the aggregate's rules themselves are covered in the Domain tests.
/// </summary>
public sealed class OrderHandlerTests
{
    private const OrderIdentifierType OrderId = 7;

    private readonly Mock<IUnitOfWork> _unitOfWork = new();
    private readonly Mock<IRepository<Order, OrderIdentifierType>> _repository = new();
    private readonly Mock<IEventBus> _eventBus = new();
    private readonly OrderItemDTOMapper _itemDTOMapper = new();
    private readonly OrderDTOMapper _dtoMapper;

    public OrderHandlerTests()
    {
        _dtoMapper = new OrderDTOMapper(_itemDTOMapper);

        _unitOfWork.Setup(u => u.GetRepository<Order, OrderIdentifierType>()).Returns(_repository.Object);
        _unitOfWork.Setup(u => u.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        _eventBus
            .Setup(b => b.PublishAsync(It.IsAny<OrderPlacedIntegrationEvent>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    // ── CreateOrderHandler ──
    [Fact]
    public async Task CreateOrder_WithValidRequest_SavesAndPublishesOrderPlaced()
    {
        var sut = CreateOrderSut();

        var result = await sut.HandleAsync(new OrderCreateRequest { CustomerName = "Ada Lovelace" });

        result.IsSuccess.Should().BeTrue();
        _repository.Verify(r => r.AddAsync(It.IsAny<Order>(), It.IsAny<CancellationToken>()), Times.Once);
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        _eventBus.Verify(
            b => b.PublishAsync(
                It.Is<OrderPlacedIntegrationEvent>(e => e.CustomerName == "Ada Lovelace"),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task CreateOrder_WithValidRequest_ReturnsPendingDTOWithNoItems()
    {
        var sut = CreateOrderSut();

        var result = await sut.HandleAsync(new OrderCreateRequest { CustomerName = "Ada Lovelace" });

        result.IsSuccess.Should().BeTrue();
        result.Value!.CustomerName.Should().Be("Ada Lovelace");
        result.Value.Status.Should().Be(OrderStatus.Pending);
        result.Value.Items.Should().BeEmpty();
        result.Value.Total.Should().Be(0m);
    }

    [Fact]
    public async Task CreateOrder_WithEmptyCustomerName_ReturnsFailureAndPublishesNothing()
    {
        var sut = CreateOrderSut();

        var result = await sut.HandleAsync(new OrderCreateRequest { CustomerName = "   " });

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.Empty");
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        _eventBus.Verify(
            b => b.PublishAsync(It.IsAny<OrderPlacedIntegrationEvent>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    // ── UpdateOrderHandler ──
    [Fact]
    public async Task UpdateOrder_WhenOrderMissing_ReturnsNotFound()
    {
        SetupGetById(null);
        var sut = new UpdateOrderHandler(_unitOfWork.Object, _dtoMapper);

        var result = await sut.HandleAsync(new UpdateOrderCommand(OrderId, "Grace Hopper"));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Type == ErrorType.NotFound);
    }

    [Fact]
    public async Task UpdateOrder_WithValidCommand_UpdatesCustomerNameAndSaves()
    {
        var order = PendingOrderWithOneItem();
        SetupGetById(order);
        var sut = new UpdateOrderHandler(_unitOfWork.Object, _dtoMapper);

        var result = await sut.HandleAsync(new UpdateOrderCommand(OrderId, "Grace Hopper"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.CustomerName.Should().Be("Grace Hopper");
        order.CustomerName.Should().Be("Grace Hopper");
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task UpdateOrder_WithEmptyCustomerName_ReturnsFailureAndDoesNotSave()
    {
        SetupGetById(PendingOrderWithOneItem());
        var sut = new UpdateOrderHandler(_unitOfWork.Object, _dtoMapper);

        var result = await sut.HandleAsync(new UpdateOrderCommand(OrderId, "   "));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.CustomerName.Empty");
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── DeleteOrderHandler ──
    [Fact]
    public async Task DeleteOrder_WhenOrderMissing_ReturnsNotFound()
    {
        SetupGetById(null);
        var sut = new DeleteOrderHandler(_unitOfWork.Object);

        var result = await sut.HandleAsync(new DeleteOrderCommand(OrderId));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Type == ErrorType.NotFound);
    }

    [Fact]
    public async Task DeleteOrder_SoftDeletesOrderAndItsItems()
    {
        var order = PendingOrderWithOneItem();
        SetupGetById(order);
        var sut = new DeleteOrderHandler(_unitOfWork.Object);

        var result = await sut.HandleAsync(new DeleteOrderCommand(OrderId));

        result.IsSuccess.Should().BeTrue();
        order.IsDeleted.Should().BeTrue();
        order.Items.Should().OnlyContain(i => i.IsDeleted);
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── GetOrderByIdHandler ──
    [Fact]
    public async Task GetOrderById_WhenOrderMissing_ReturnsNotFound()
    {
        SetupGetById(null, asTracking: false);
        var sut = new GetOrderByIdHandler(_unitOfWork.Object, _dtoMapper);

        var result = await sut.HandleAsync(new GetOrderByIdQuery(OrderId));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Type == ErrorType.NotFound);
    }

    [Fact]
    public async Task GetOrderById_ReturnsDTOWithItemsAndComputedTotal()
    {
        SetupGetById(PendingOrderWithOneItem(), asTracking: false);
        var sut = new GetOrderByIdHandler(_unitOfWork.Object, _dtoMapper);

        var result = await sut.HandleAsync(new GetOrderByIdQuery(OrderId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Items.Should().ContainSingle();
        result.Value.Items.Single().ProductName.Should().Be("Blue Widget");
        result.Value.Total.Should().Be(9.99m * 3);
    }

    // ── AddItemHandler ──
    [Fact]
    public async Task AddItem_WhenOrderMissing_ReturnsNotFound()
    {
        SetupGetById(null);
        var sut = new AddItemHandler(_unitOfWork.Object, _itemDTOMapper);

        var result = await sut.HandleAsync(new AddItemCommand(OrderId, 12, "Red Widget", 4.50m, 2));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Type == ErrorType.NotFound);
    }

    [Fact]
    public async Task AddItem_OnPendingOrder_ReturnsLineDTOAndSaves()
    {
        var order = PendingOrderWithOneItem();
        SetupGetById(order);
        var sut = new AddItemHandler(_unitOfWork.Object, _itemDTOMapper);

        var result = await sut.HandleAsync(new AddItemCommand(OrderId, 12, "Red Widget", 4.50m, 2));

        result.IsSuccess.Should().BeTrue();
        result.Value!.ProductName.Should().Be("Red Widget");
        result.Value.UnitPrice.Should().Be(4.50m);
        result.Value.Quantity.Should().Be(2);
        order.Items.Should().HaveCount(2);
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task AddItem_OnPaidOrder_ReturnsItemsLockedAndDoesNotSave()
    {
        var order = PendingOrderWithOneItem();
        order.ChangeStatus(OrderStatus.Paid);
        SetupGetById(order);
        var sut = new AddItemHandler(_unitOfWork.Object, _itemDTOMapper);

        var result = await sut.HandleAsync(new AddItemCommand(OrderId, 12, "Red Widget", 4.50m, 2));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.ItemsLocked");
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── ChangeItemQuantityHandler ──
    [Fact]
    public async Task ChangeItemQuantity_WhenOrderMissing_ReturnsNotFound()
    {
        SetupGetById(null);
        var sut = new ChangeItemQuantityHandler(_unitOfWork.Object);

        var result = await sut.HandleAsync(new ChangeItemQuantityCommand(OrderId, ItemId: 0, Quantity: 5));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Type == ErrorType.NotFound);
    }

    [Fact]
    public async Task ChangeItemQuantity_OnPendingOrder_UpdatesQuantityAndSaves()
    {
        var order = PendingOrderWithOneItem();
        SetupGetById(order);
        var sut = new ChangeItemQuantityHandler(_unitOfWork.Object);

        var result = await sut.HandleAsync(new ChangeItemQuantityCommand(OrderId, order.Items.Single().Id, Quantity: 5));

        result.IsSuccess.Should().BeTrue();
        order.Items.Single().Quantity.Should().Be(5);
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── RemoveItemHandler ──
    [Fact]
    public async Task RemoveItem_WhenOrderMissing_ReturnsNotFound()
    {
        SetupGetById(null);
        var sut = new RemoveItemHandler(_unitOfWork.Object);

        var result = await sut.HandleAsync(new RemoveItemCommand(OrderId, ItemId: 0));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Type == ErrorType.NotFound);
    }

    [Fact]
    public async Task RemoveItem_OnPendingOrder_SoftDeletesLineAndSaves()
    {
        var order = PendingOrderWithOneItem();
        SetupGetById(order);
        var sut = new RemoveItemHandler(_unitOfWork.Object);

        var result = await sut.HandleAsync(new RemoveItemCommand(OrderId, order.Items.Single().Id));

        result.IsSuccess.Should().BeTrue();
        order.Items.Single().IsDeleted.Should().BeTrue();
        order.Total.Should().Be(0m);
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── ChangeOrderStatusHandler ──
    [Fact]
    public async Task ChangeOrderStatus_WhenOrderMissing_ReturnsNotFound()
    {
        SetupGetById(null);
        var sut = new ChangeOrderStatusHandler(_unitOfWork.Object, _dtoMapper);

        var result = await sut.HandleAsync(new ChangeOrderStatusCommand(OrderId, OrderStatus.Paid));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Type == ErrorType.NotFound);
    }

    [Fact]
    public async Task ChangeOrderStatus_WithIllegalTransition_ReturnsFailureAndDoesNotSave()
    {
        SetupGetById(PendingOrderWithOneItem());
        var sut = new ChangeOrderStatusHandler(_unitOfWork.Object, _dtoMapper);

        var result = await sut.HandleAsync(new ChangeOrderStatusCommand(OrderId, OrderStatus.Shipped));

        result.IsFailure.Should().BeTrue();
        result.Errors.Should().Contain(e => e.Code == "Order.InvalidStatusTransition");
        _unitOfWork.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    // ── Helpers ──
    private CreateOrderHandler CreateOrderSut() =>
        new(_unitOfWork.Object, new OrderCreateRequestMapper(), _eventBus.Object, _dtoMapper);

    private void SetupGetById(Order? order, bool asTracking = true) =>
        _repository
            .Setup(r => r.GetByIdAsync(
                OrderId,
                It.IsAny<IEnumerable<string>>(),
                asTracking,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(order);

    private static Order PendingOrderWithOneItem()
    {
        var order = Order.Create(id: null, "Ada Lovelace").Value!;
        order.AddItem(id: null, productId: 11, "Blue Widget", unitPrice: 9.99m, quantity: 3);
        return order;
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
Orders application suite, and **72/72** in the architecture suite now that both modules are reshaped.
No database is involved in any of them.

That last run is the one worth watching: it is where layering, module isolation, and the event
conventions are enforced. If it reds on isolation, the cause is almost always an accidental `using`
of a Products type inside Orders, which is exactly the mistake the `ProductName` / `UnitPrice`
snapshot exists to make unnecessary.

As in step 4, a single class or method needs a Microsoft Testing Platform filter **after a bare `--`**
(these projects are MTP, not VSTest, so a filter placed before the separator runs zero tests):

```powershell
dotnet test --project Tests/Modules/Orders/MMCA.ECommerce.Orders.Domain.Tests/MMCA.ECommerce.Orders.Domain.Tests.csproj -- --filter-method "*ChangeStatus*"
```

The whole solution is green from here: `dotnet test --solution MMCA.ECommerce.slnx` runs everything
in one pass.

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

## 7. Regenerate the migrations

The scaffolded Products migration still describes the template's shape, and Orders has none yet.
Delete the generated migration files, but only the `*.cs`: the folder's `.editorconfig` stays, it is
what keeps analyzer enforcement off generated migration code, and `dotnet ef` never recreates it.
Then generate both fresh (`migrations add` never opens a database connection):

```powershell
Remove-Item Source\Hosting\MMCA.ECommerce.Migrations.SqlServer.Products\Migrations\*.cs

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
