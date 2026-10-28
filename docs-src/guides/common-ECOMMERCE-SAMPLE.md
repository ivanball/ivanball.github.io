# Build MMCA.ECommerce: a Two-Module Store from the Templates

_As of: 2026-10-28 (MMCA.Templates 1.23.0, framework v1.265.1)._

MMCA.ECommerce is the simplest e-commerce application on the
[MMCA.Common](https://www.nuget.org/packages?q=MMCA.Common) framework: a **Products** catalog
module and an **Orders** module with line items, behind a REST API host and a Blazor Server +
MudBlazor UI host, orchestrated by Aspire. No Identity module, no payment provider, no search: two
aggregates, wired end to end through all five layers, with the architecture fitness rules watching.

This guide builds it from nothing, and the point is *how little of it you type*. The
[getting-started guide](common-GETTING-STARTED.md) scaffolds one module and stops; this one takes
the same scaffold to a working two-module domain. `MMCA.Templates` generates the solution,
both modules, the hosts, the tests, and the migrations projects, and the `build/add-module.ps1`
script it ships inside every generated app performs the wire-ups `dotnet new` cannot patch into
existing files. That leaves your hands on two things only: the domain code that is genuinely yours,
and the UI pages that show it. Every step below is build-verified against what the templates
generate, every test count is the one that run observed, and every path is relative to the
solution root of the tree you generate.

---

## Before you start

- **.NET 10 SDK** (the framework targets `net10.0` with `LangVersion: preview`).
- **Docker Desktop** (Aspire provisions SQL Server as a container).
- **EF Core tools**: `dotnet tool install --global dotnet-ef`.
- Commands are shown for **PowerShell** (`pwsh`, cross-platform). Almost everything is plain
  `dotnet` CLI, so any shell works, but step 3 runs a `.ps1` script, so `pwsh` has to be on PATH.
- On Windows, keep the folder you generate into short (for example `C:\src`): the deepest build
  outputs sit about 130 characters below the solution root, and a path past 260 characters fails the
  build with `MSB3030 Could not copy the file` unless long paths are enabled.

This guide follows the current `MMCA.Templates` (**1.23.0**): `--title`, `--event-verb`,
`--no-owner`, `--no-description`, the shipped `build/add-module.ps1`, the framework's generic update
slice, and the shipped wire-contract test all appear below as that pack generates them.

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

Five options do most of the work. Three remove an axis a catalog product does not have, and the
code for an axis you turn off is never generated: `--flat` drops the child collection entirely,
`--no-status` drops the status axis, and `--no-owner` drops the `RequesterUserId` property and
everything that named it. Two are renames: `--title Name` renames the aggregate's main text
property everywhere (property, invariant, error codes, max-length constant, DTO, requests, EF column,
validator rule, UI resources, domain tests), and `--event-verb Created` gives you
`ProductCreatedIntegrationEvent` and its `ProductCreatedHandler` instead of the sample's `Opened`
pair. The [templates guide](common-TEMPLATES.md) lists exactly what each one generates or omits.
Together those two are the entire rename pass, so step 4 has exactly one property left to add.

One command, and the whole monolith exists: the Products module across all five layers, the REST
host, the Blazor UI host, the Aspire AppHost, a migrations project, three test projects including the
architecture fitness rules, and `build/add-module.ps1`.

Get your green baseline before changing anything:

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test  --solution MMCA.ECommerce.slnx
```

That is a warning-free build under five analyzers at error severity and **129 passing tests**, with no
database needed. (The unflagged scaffold ships more, because each axis carries tests of its own; 129
is the flat, status-less, owner-less baseline.) This is the line you bisect against later.

## 3. Add the Orders module

```powershell
pwsh build/add-module.ps1 -Name Orders -Aggregate Order -Child Item `
  -NoOwner -NoDescription -Title CustomerName -EventVerb Placed -SkipMigration
```

`build/add-module.ps1` ships inside the solution you just generated. It runs `dotnet new mmca-module`
with the shape options passed through, then performs every wire-up the template can only print. Run
it from the solution root: it refuses to run anywhere else, and discovers everything else there at
run time.

`-Child Item` gives an `OrderItem` entity and DTO, `AddItem` / `EditItem` / `RemoveItem` slices,
`/items` routes, and an `OrderItemIdentifierType` alias. `-Title CustomerName` and `-EventVerb
Placed` are the two renames. `-NoOwner` and `-NoDescription` drop the two axes an order does not
need, while `-NoStatus` is deliberately absent because an order genuinely has a lifecycle.
`EditItem` is the one generated name that does not survive the reshape: an order line is not edited
freely, only re-quantified, so step 5 renames that slice to `ChangeItemQuantity`. `-SkipMigration`
avoids creating the Orders migration against the still-unreshaped scaffold, since step 7 would delete
and regenerate it anyway.

### What the script just wired

The script ends by listing every edit it applied. Nine existing files are touched (commit the
scaffold before running it and `git diff` shows exactly these): the eight new projects in
`MMCA.ECommerce.slnx`; the Orders API and migrations `ProjectReference`s on the web host and **all
five** layers on the architecture-test project; the identifier-alias `<Compile Include ... Link>`
block in `Directory.Build.props`; five `Module(...)` lines in `ECommerceArchitectureMap.cs`, without
which the layering and isolation rules silently stop covering the module
([ADR-015](../adr/015-architecture-fitness-functions.md)); the two registrations the web host's
`Program.cs` owns, `typeof(OrdersModule).Assembly` in the assembly list handed to
`ModuleLoader.DiscoverAndRegister` (an assembly no code path has touched is never loaded, so without
it the module compiles and registers nothing) and `services.AddErrorResources<OrdersErrorResources>();`;
the `Orders.OrderPlaced.v1 { OrderId:Int32 }` entry appended to `ExpectedContract` in
`ArchitectureTests.cs`, so the frozen wire contract keeps passing with a second module in it; and the
AppHost plus `appsettings.json` database wiring below. Every edit is anchored on something the
scaffold generated, and a missing anchor aborts the run with the manual edit printed instead, so a
half-wired solution is never the outcome of a silent skip. The
[templates guide](common-TEMPLATES.md) documents the script in full.

### The database wiring, and why it is per module

Every module database carries its own `OutboxMessages`/`InboxMessages` tables in `dbo`, so two
modules migrated into one database collide on them. One database per module is also exactly the
topology that makes extraction free later
([ADR-006](../adr/006-database-per-service.md)). In
`Source/Hosting/MMCA.ECommerce.AppHost/Program.cs`
the script added `sql.AddDatabase("ecommerce-orders", "ECommerce_Orders")` and chained
`.WithSQLServerDataSource(ordersDb, "Orders")` onto the web project, above the first module's call.
Note what it did **not** do: the first module keeps the database the scaffold gave it, so the pair is
`ecommerce` / `ECommerce` for Products, not a matched `_Products` / `_Orders` set, and it keeps the
explicit `ConnectionStrings__SQLServerConnectionString` override that pins the top-level connection
string (and so the `Default` source) to that database, because `WithSQLServerDataSource` injects only
the module's own `DataSources` entry. The `WaitFor(sql)` on the web project stays as
generated: the host CREATES the databases via EF `Migrate` at startup, so waiting on a database
resource would deadlock, because it never exists until the app that is waiting runs.

In `Source/Hosts/MMCA.ECommerce.Web/appsettings.json`
the script enabled the module under `Modules` and added a `DataSources` section with an entry per
module, each holding a connection string (derived from the one already there with the database name
swapped) and that module's `SQLServerMigrationsAssembly`. Those connection strings are the
design-time and no-Aspire fallback: under Aspire every `WithSQLServerDataSource` call overrides them,
which is why the Products module actually lands in `ECommerce` and not in the `ECommerce_Products`
the file names. The migrations assembly per entry is what matters in both modes.

Two normalizations in the same file are easy to miss and expensive to omit, and the script does both.
First, the top-level `SQLServerMigrationsAssembly` pin is **deleted** (the connection string itself
stays: it is the `Default` fallback the `[Required]` validation and health checks use). The scaffold
pinned the Products assembly there because it had one module and no `DataSources` section. From here
on every module names its migrations assembly on its own `DataSources` entry, and an entry whose
connection string equals the top-level one collapses onto `Default` and contributes its assembly
there. A second declaration at top level would have to agree with whichever entry collapses: today
that is Products, because the AppHost pins the top-level connection to it, but the day the top-level
connection names the other database, startup fails because the sources collapsing onto one physical
database declare conflicting migrations assemblies. Second, a top-level
`"Outbox": { "DatabaseName": "Products" }` is added, pinning where handler-published integration
events are written. `IEventBus` persists them to ONE configured outbox source per host, defaulting to
`Default`, which is whichever database the top-level connection string names. The AppHost pins that
to the first module, but `appsettings.json`, a deployment, or a hand edit can name another, and an
implicit outbox would silently move with it.

Build and test again: still green, now at **164 tests** with the Orders module's scaffolded suites
included. There is no new kind of thing in the solution, just a second copy of the shape you already
had, this time with its child collection and status axis intact. Neither database has a schema until
step 7 creates the migrations.

## 4. Reshape Products into a catalog product

The scaffolded module arrives as the template's worked example in *your* namespaces, already shaped
by the flags in step 2: no children, no status, no requester, `Name` instead of `Title`, and a
`ProductCreated` event. What is left is a single property. A catalog entry is `Name`, `Description`,
**`Price`**, and `Price` is the one thing no flag could have generated, because the invariant it
needs is yours. Every convention stays as generated: `Result`-returning factory, invariants composed
with `Result.Combine`, guarded mutations raising domain events, the caching pair, the integration
event through the outbox.

Each table below is one layer's edit sequence, top to bottom: Shared first (every layer above
compiles against those contracts), then Domain, Application, Infrastructure, API, and the tests.
Every edit is to a file the scaffold generated, and the snippets show the code that changes. A new
public member needs a `/// <summary>` doc comment (a new `record` parameter a `<param>` tag), because
the documentation analyzers run at error severity. All paths are relative to the solution root, and
every command is PowerShell.

### 4.1 Shared contracts

Under `Source/Modules/Products/MMCA.ECommerce.Products.Shared/`:

| File | Action | What changes |
|---|---|---|
| `Products/ProductDTO.cs` | edit | one property: `public required decimal Price { get; init; }` |
| `Products/ProductUpdateRequest.cs` | edit | the same `required decimal Price`, required like the other two, so a client cannot silently blank a price by omitting it. Keep the `*UpdateRequest` suffix exactly: the shared `UpdateRequestsAreNotConcurrencyAware` fitness rule finds it by name and fails it if it carries a concurrency token, which travels in the `If-Match` header instead ([ADR-035](../adr/035-optimistic-concurrency.md)), and a rename silently drops the request out of that rule's scope |
| `Products/IntegrationEvents/ProductCreatedIntegrationEvent.cs` | edit | the event was generated carrying the product id alone; it gains `Name` and `Price`: `ProductCreatedIntegrationEvent(ProductIdentifierType ProductId, string Name, decimal Price)` |

### 4.2 Domain

Under `Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/`:

| File | Action | What changes |
|---|---|---|
| `ProductInvariants.cs` | edit | the two string rules arrive correct; `EnsurePriceIsValid` is new |
| `Product.cs` | edit | a `public decimal Price { get; private set; }` property, a third `price` parameter on the private constructor, on `Create`, and on `UpdateDetails`, and the price invariant added to both `Result.Combine` calls |

The string rules still delegate to the framework's `CommonInvariants`, so each field keeps its
distinct empty vs too-long error code. The price is the only app-specific rule, appended to
`ProductInvariants.cs`:

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

The aggregate is the other edit, and `Product.cs` is worth reading rather than editing blind.
`Create` accumulates all three invariants through `Result.Combine` before it constructs anything,
`UpdateDetails` runs the same three and raises `ProductChanged(DomainEntityState.Updated, Id)` only
once they passed (it assigns `Price = price;` beside the other two fields), and `Delete()` calls
`base.Delete()` then raises the Deleted event. The edited factory, with the comment that explains an
absence kept as generated:

```csharp
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
        /* return Result.Failure<Product> on breach, then construct
           new Product(name, description, price) with Id = isIdValueGenerated ? default : id!.Value */

        // No "Added" domain event here: the Id is database-generated (still 0 at this point), so an
        // event captured now would carry a meaningless id. Creation is signalled by the
        // ProductCreatedIntegrationEvent that CreateProductHandler publishes AFTER the commit, with the
        // real id.
        return Result.Success(product);
    }
```

### 4.3 Application

Under `Source/Modules/Products/MMCA.ECommerce.Products.Application/`:

| File | Action | What changes |
|---|---|---|
| `Products/UseCases/Create/ProductCreateRequest.cs` | edit | the create command gains `public required decimal Price { get; init; }` |
| `Products/UseCases/Create/ProductCreateRequestMapper.cs` | edit | the factory call gains `price:` (fragment below). The scaffold keeps that call on one line and says why in a comment: an argument list cannot lose a middle element to a whole-line conditional, so the reference repo's staging script rewrites it per shape. Once the shape is yours, the comment goes with it |
| `Products/UseCases/Create/ProductCreateRequestValidator.cs` | edit | one rule, `RuleFor(x => x.Price).GreaterThan(0m);`. The other two mirror the invariants and reuse their constants, so a limit is stated once |
| `Products/UseCases/Create/CreateProductHandler.cs` | edit | the whole write path on one screen, worth reading rather than just editing: domain factory, unit of work, then the integration event published *after* the commit, which now carries the name and the price: `new ProductCreatedIntegrationEvent(entity.Id, entity.Name, entity.Price),` |
| `Products/UseCases/Update/ProductUpdateApplier.cs` | edit | the update slice is the framework's generic `UpdateEntityCommand<Product, ProductUpdateRequest, ProductIdentifierType>`, run by the generic handler `AddEntityCrud` registers, and this applier is the module's whole part in it: `UpdateDetails` takes a third argument, `entity.UpdateDetails(request.Name, request.Description, request.Price)` |
| `Products/UseCases/Update/ProductUpdateRequestValidator.cs` | edit | one rule, `RuleFor(x => x.Price).GreaterThan(0m);`. The scaffold already mirrors the create validator field for field, because an update that accepted what a create refuses would let a product reach a state it could never have been created in |
| `Products/IntegrationEventHandlers/ProductCreatedHandler.cs` | edit | the consumer arrives generated and wired; it logs the new `Name` too (a `{ProductName}` placeholder in the `[LoggerMessage]` template and a `string productName` parameter on the partial method), and it is where a search-index, notification, or analytics side effect would live |

The `ProductCreateRequestMapper` fragment:

```csharp
        return Task.FromResult(Product.Create(
            id: null,
            name: request.Name,
            description: request.Description,
            price: request.Price));
```

The DTO mapper and projector need no edit: both are Mapperly-generated, so `Price` maps by name.
Both the Delete and GetById handlers resolve their repository through `IUnitOfWork`, never by
constructor-injecting `IRepository<,>`: a directly injected repository is not enlisted in the unit of
work's transaction, and mocks happily hide the difference until a real database run. The scaffold
already does this; keep it.

A few doc comments still describe the template's support-ticket example. Rewording them is optional
and changes no behavior.

### 4.4 Infrastructure

**Edit** `Source/Modules/Products/MMCA.ECommerce.Products.Infrastructure/Persistence/EntityConfiguration/ProductConfiguration.cs`.
`base.Configure` still supplies the id, the soft-delete flag and its query filter, the audit columns,
and the concurrency token, so only the product's own columns are there. Three usings come first:
`using Microsoft.EntityFrameworkCore;` (which `HasColumnType` needs),
`using MMCA.Common.Application.Interfaces.Infrastructure.Persistence;` (for `DataSource`), and
`using MMCA.Common.Infrastructure.Persistence.Configuration;` (for `HasSoftDeleteFilter`). Then two
additions after the `Description` property:

```csharp
        // Explicit precision: SQL Server maps an unannotated decimal to decimal(18,0), which would
        // round every price to whole currency units.
        builder.Property(p => p.Price)
            .HasColumnType("decimal(18,2)")
            .IsRequired();

        // A catalog is browsed by name.
        builder.HasIndex(p => p.Name)
            .HasSoftDeleteFilter(DataSource.SQLServer);
```

The index is filtered with the framework's `HasSoftDeleteFilter`, never a SQL literal, so it stays
engine-aware and follows a renamed column. Nothing else in Infrastructure changes: `--flat` already
emitted a `ModuleApplicationDbContext` with one `DbSet`.

### 4.5 API

`Source/Modules/Products/MMCA.ECommerce.Products.API/Controllers/ProductsController.cs` needs no
edit. The routes, the injected handlers, and the inherited list/paged reads are all unchanged.
`UpdateAsync` constructs the generic command from the request whole, with the concurrency token read
from the `If-Match` header that `[SupportsIfMatch]` requires
([ADR-035](../adr/035-optimistic-concurrency.md)), so the action names no product field and `Price`
reaches the applier with no edit here:

```csharp
            new UpdateEntityCommand<Product, ProductUpdateRequest, ProductIdentifierType>(
                id,
                request,
                SupportsIfMatchAttribute.RequiredToken(HttpContext)),
```

**Edit** the two error-resource files, `Resources/ProductsErrorResources.resx` and
`Resources/ProductsErrorResources.es.resx` in the same project.
Keep the resx envelope exactly as generated (the `<xsd:schema>` block and the four `<resheader>`
elements) and touch only the `<data>` elements. `--title Name` already named the four scaffolded
codes correctly, so the English file needs a single new entry; the Spanish file needs that entry plus
a pass over the four it shipped, because the template's token substitution left them saying "del
product" and "el titulo" where the property is now a name:

| `data name` | `.resx` value (en) | `.es.resx` value (es) |
|---|---|---|
| `Product.Description.Empty` | Product description cannot be empty. | La descripcion del producto no puede estar vacia. |
| `Product.Description.TooLong` | Product description cannot exceed 4000 characters. | La descripcion del producto no puede superar los 4000 caracteres. |
| `Product.Name.Empty` | Product name cannot be empty. | El nombre del producto no puede estar vacio. |
| `Product.Name.TooLong` | Product name cannot exceed 200 characters. | El nombre del producto no puede superar los 200 caracteres. |
| `Product.InvalidPrice` | Product price must be greater than zero. | El precio del producto debe ser mayor que cero. |

(The Spanish values are shown without accents; type them with the accents your locale expects.)
Every code here is one an invariant in 4.2 actually emits, and an unmapped code degrades gracefully
to its English message, so a typo shows up as English text in a Spanish browser rather than as an
exception. Each entry is a `<data name="..." xml:space="preserve">` element wrapping a single
`<value>`, exactly like the ones you are editing.

At this point every source project builds, the UI host included. The solution build still fails, in
the two Products test projects only (16 errors, `CS9035` and `CS7036`, all on the missing `Price`),
until 4.6.

### 4.6 Tests

No project file changes: the scaffolded test projects already reference `xunit.v3`,
`AwesomeAssertions` and `Moq`. The test files, under `Tests/Modules/Products/`:

| File | Action | What it covers |
|---|---|---|
| `MMCA.ECommerce.Products.Domain.Tests/Products/ProductTests.cs` | edit | 9 tests over the aggregate. The five scaffolded tests pass a price as the fourth `Create` argument and the third `UpdateDetails` argument (the update test also asserts it), and four new ones cover the price: a `[Theory]` over `0` and `-1` expecting `Product.InvalidPrice`, the accumulation test below, and `UpdateDetails` with a zero price leaving the name, the price, and the domain events untouched |
| `MMCA.ECommerce.Products.Application.Tests/Caching/ProductCacheInvalidationTests.cs` | edit | the scaffolded tests pass once their fixtures carry a price: `Price = 10m,` in the `ProductUpdateRequest`, `ProductCreateRequest`, and `ProductDTO` initializers. The suite is what stops a rename from quietly leaving stale reads behind, because nothing at compile time ties a command's `CachePrefix` to a query's `CacheKey` |
| `MMCA.ECommerce.Products.Application.Tests/Concurrency/ProductConcurrencyTokenTests.cs` | edit | `Price = 10m,` in the `ProductUpdateRequest` initializer and a price on the `Product.Create` call |
| `MMCA.ECommerce.Products.Application.Tests/Deletion/DeleteProductCascadeTests.cs` | edit | `Price = 10m,` in the `ProductCreateRequest` initializer |
| `MMCA.ECommerce.Products.Application.Tests/Projections/ProductDTOProjectorTests.cs` | edit | a price on the `Product.Create` call; the projection-equals-mapper assertion then covers `Price` too |

The accumulation test is the one worth reading: `Result.Combine` reports every broken invariant at
once, which is the behavior that makes one round trip enough for a form:

```csharp
    [Fact]
    public void Create_WithEveryFieldInvalid_ReportsEveryBrokenInvariant()
    {
        var result = Product.Create(id: null, string.Empty, string.Empty, 0m);

        result.IsFailure.Should().BeTrue();
        result.Errors.Select(e => e.Code).Should().BeEquivalentTo(
            "Product.Name.Empty",
            "Product.Description.Empty",
            "Product.InvalidPrice");
    }
```

### 4.7 Verify the Products reshape

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test --project Tests/Modules/Products/MMCA.ECommerce.Products.Domain.Tests/MMCA.ECommerce.Products.Domain.Tests.csproj
dotnet test --project Tests/Modules/Products/MMCA.ECommerce.Products.Application.Tests/MMCA.ECommerce.Products.Application.Tests.csproj
```

Expect a warning-free build (five analyzers at error severity, `TreatWarningsAsErrors`), then
**9/9** passing in the Products domain suite and **17/17** in the Products application suite. No
database is involved in either.

To run a single class or method, pass a Microsoft Testing Platform filter **after a bare `--`**;
these projects are MTP, not VSTest, so a VSTest-style `--filter` before the separator silently runs
zero tests and still exits non-zero:

```powershell
dotnet test --project Tests/Modules/Products/MMCA.ECommerce.Products.Domain.Tests/MMCA.ECommerce.Products.Domain.Tests.csproj -- --filter-class "*ProductTests*"
```

The full solution run is red at this point, in the architecture suite: `ProductCreatedIntegrationEvent`
gained `Name` and `Price`, so it differs from the frozen wire contract. Step 8 updates that
literal once both creation events have their final shape.

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
`Body` and `AuthorUserId`, `OrderStatus` is `Open` / `InProgress` / `Resolved` / `Closed`, and the
only item guard is `EnsureStatusAllowsItems`, which refuses a `Closed` order with `Order.Closed`.

### 5.1 Shared contracts

The identifier aliases need no edit: `-Child Item` emitted both `OrderIdentifierType` and
`OrderItemIdentifierType`, and the one thing that is off about that file (their sort order) is what
the `SA1211` fixup in step 8 settles. Under
`Source/Modules/Orders/MMCA.ECommerce.Orders.Shared/Orders/`:

| File | Action | What changes |
|---|---|---|
| `OrderStatus.cs` | rewrite | the scaffold ships a flat set of ticket states; this is a lifecycle (`Pending = 0`, `Paid = 1`, `Shipped = 2`, `Cancelled = 3`), and its doc comment is where the legal transitions are written down (Pending to Paid or Cancelled, Paid to Shipped or Cancelled, the last two terminal) for a reader who will not go looking for the invariant |
| `OrderDTO.cs` | edit | `public decimal Total { get; init; }` is new. Its remarks are load-bearing documentation, not decoration: only the detail read eager-loads `Items`, so `Total` is 0 on the list and paged projections, and the fix for a caller who needs the number is to ask the detail endpoint, not to widen the list query |
| `OrderItemDTO.cs` | edit | the scaffold's `Body` and `AuthorUserId` become the four snapshot properties: `required int ProductId`, `required string ProductName`, `required decimal UnitPrice`, `required int Quantity` |
| `OrderUpdateRequest.cs` | leave | the `*UpdateRequest` suffix must survive: the shared `UpdateRequestsAreNotConcurrencyAware` fitness rule matches on that name |
| `AddOrderItemRequest.cs` | create | the caller supplies the name and price to snapshot, and that is the wire-level half of the module-isolation decision above (record below) |
| `ChangeOrderItemQuantityRequest.cs` | create | replaces the scaffold's free-text `EditItemRequest(string Body)` (record below) |
| `IntegrationEvents/OrderPlacedIntegrationEvent.cs` | edit | the event name and its consumer arrived generated; the payload gains `CustomerName`: `OrderPlacedIntegrationEvent(OrderIdentifierType OrderId, string CustomerName)` |
| `AddItemRequest.cs`, `EditItemRequest.cs` | delete | the two the new request records replace |

The two new request records, each with a `<summary>` and one `<param>` tag per parameter:

```csharp
public sealed record AddOrderItemRequest(int ProductId, string ProductName, decimal UnitPrice, int Quantity);

public sealed record ChangeOrderItemQuantityRequest(int Quantity);
```

`ChangeOrderStatusRequest.cs` stays exactly as generated:
`record ChangeOrderStatusRequest(OrderStatus Status)` is already the right shape, and the enum it
names is the one you just rewrote.

```powershell
Remove-Item `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\AddItemRequest.cs, `
  Source\Modules\Orders\MMCA.ECommerce.Orders.Shared\Orders\EditItemRequest.cs
```

### 5.2 Domain

Under `Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/`:

| File | Action | What changes |
|---|---|---|
| `OrderInvariants.cs` | rewrite | six methods and eight error codes: the two customer-name codes, the two product-name codes, the unit price, the quantity, the item lock, and the status transition. Every one of them is a code you will localize in 5.5. `ItemBodyMaxLength`, `EnsureItemBodyIsValid` and `EnsureStatusAllowsItems` go; `ProductNameMaxLength = 200`, `EnsureProductNameIsValid`, `EnsureUnitPriceIsValid`, `EnsureQuantityIsValid`, `EnsureStatusAllowsItemChanges` and `EnsureStatusTransitionIsValid` arrive |
| `OrderItem.cs` | rewrite | `Body` and `AuthorUserId` become the four snapshot properties, the private constructor and `Create` take them (`Create(id, productId, productName, unitPrice, quantity)`, combining the product-name, unit-price and quantity invariants), and `EditBody` becomes `ChangeQuantity(int quantity)` |
| `Order.cs` | edit | a guarded `Status` that starts at `OrderStatus.Pending`, a computed `Total`, and item mutations that ask the status first (details below) |
| `DomainEvents/OrderChanged.cs` | leave | unlike Products, the scaffolded Orders event summary already reads correctly for an aggregate whose creation is signalled by an integration event |

`EnsureCustomerNameIsValid` is generated but its two messages are not quite English: `--title` is a
substring replacement, so the camel-case identifier form reaches the shipped prose and the message
arrives as "Order customerName cannot be empty." Fixing those two strings to "Order customer name
..." (and their resx twins in 5.5) is a documented one-line consequence of a multi-word `--title`,
not a surprise.

The new methods follow the shape of the generated ones: the product name delegates to
`CommonInvariants` like the customer name (`Order.Item.ProductName.Empty` / `.TooLong`), and the unit
price and the quantity are `<= 0` checks returning `Error.Invariant` with `Order.InvalidUnitPrice` and
`Order.InvalidQuantity`. The two app-specific rules at the bottom (`Order.ItemsLocked`, returned
whenever `status != OrderStatus.Pending`, and `Order.InvalidStatusTransition`) are the invariant half
of the second architecture decision. The transition switch lists every enum member explicitly rather
than leaning on the discard arm, which is both what `IDE0072` asks for and what turns adding a status
into a compile-time prompt to decide where it can go:

```csharp
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
```

In `OrderItem.cs`, `ProductId` is a plain `int`, deliberately not a `ProductIdentifierType` and
deliberately not a foreign key: the Orders module must not name a Products type at all. The four
snapshot properties and the comment above them are the point of the file:

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

The edits to `Order.cs`, in file order: the constructor sets `Status = OrderStatus.Pending;`; a
`Total` property follows `Items`; `AddItem(id, string body, int authorUserId)` becomes
`AddItem(id, int productId, string productName, decimal unitPrice, int quantity)` and hands those to
`OrderItem.Create`; `EditItem(itemId, string body)` becomes `ChangeItemQuantity(itemId, int quantity)`
and calls `item.ChangeQuantity(quantity)`; every `EnsureStatusAllowsItems` guard becomes
`EnsureStatusAllowsItemChanges`; and `ChangeStatus` runs `EnsureStatusTransitionIsValid(Status,
newStatus, nameof(ChangeStatus))` after its early return and before it assigns. Notice three things
on the way past:

- **Every item mutation asks `EnsureStatusAllowsItemChanges` first.** `AddItem`,
  `ChangeItemQuantity` and `RemoveItem` all open with that guard and return its errors before they
  touch the collection, which is where the Pending-only rule actually lives. `UpdateDetails` does
  not: renaming the customer is legal at any point in the lifecycle.
- **`Total` is computed, never stored**
  (`public decimal Total => _items.Where(i => !i.IsDeleted).Sum(i => i.UnitPrice * i.Quantity);`), so
  it cannot drift from the lines it summarizes, and it reads 0 whenever the collection was not loaded.
- **Re-asserting the current status is an idempotent no-op success that raises no event.**
  `ChangeStatus` returns `Result.Success()` before consulting the transition rule when
  `Status == newStatus` (the scaffold's early return, kept), which is what makes an at-least-once
  delivered command safe on its second arrival.

`Create` raises no "Added" event for the same reason `Product.Create` does not, and the cascade
soft-delete in `Delete()` is the scaffold's, kept as generated.

### 5.3 Infrastructure

Under `Source/Modules/Orders/MMCA.ECommerce.Orders.Infrastructure/Persistence/EntityConfiguration/`:

| File | Action | What changes |
|---|---|---|
| `OrderConfiguration.cs` | edit | `builder.Ignore(p => p.Total)`, a filtered index on `CustomerName` (`builder.HasIndex(p => p.CustomerName).HasSoftDeleteFilter(DataSource.SQLServer);`), and the two usings that index needs, `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` and `MMCA.Common.Infrastructure.Persistence.Configuration` (`Microsoft.EntityFrameworkCore` is already there). The customer-name column, the string-persisted status, and the items relationship all arrive generated |
| `OrderItemConfiguration.cs` | edit | the `Body` and `AuthorUserId` columns become the item's four: `ProductId` required, `ProductName` with `HasMaxLength(OrderInvariants.ProductNameMaxLength)`, `UnitPrice` with `HasColumnType("decimal(18,2)")`, and `Quantity` required; the `using Microsoft.EntityFrameworkCore;` at the top is new, because `HasColumnType` needs it |

`builder.Ignore(p => p.Total)` states in the mapping that `Total` is a computed getter and never a
column. `Status` stays persisted as a **string** (the scaffold's line, kept), so a later reordering of
the enum cannot silently reinterpret stored rows, and `UnitPrice` gets an explicit `decimal(18,2)` so
a price never rounds on the way in. `ModuleApplicationDbContext` needs no edit: `-Child Item` already
declared `DbSet<OrderItem>` alongside `DbSet<Order>`.

### 5.4 Application

An order is placed empty and grows lines afterwards, so the create payload is just a customer name,
which is what `-NoDescription -NoOwner -Title CustomerName` already generated. Under
`Source/Modules/Orders/MMCA.ECommerce.Orders.Application/Orders/`:

| File | Action | What changes |
|---|---|---|
| `UseCases/Create/OrderCreateRequestMapper.cs` | edit | delete the staging comment above the factory call; the call itself, `Order.Create(id: null, customerName: request.CustomerName)`, is already right |
| `UseCases/Create/CreateOrderHandler.cs` | edit | one line of code, the published event: `new OrderPlacedIntegrationEvent(entity.Id, entity.CustomerName),`. The handler still publishes after the commit, so the database-generated id is populated by the time the event reaches consumers |
| `UseCases/Update/` | leave | the update slice is the framework's generic `UpdateEntityCommand`, so there is no module command to edit: `OrderUpdateHandler` (kept because it eager-loads the items the update response carries), `OrderUpdateApplier` and `OrderUpdateRequestValidator` arrive shaped by the flags |
| `UseCases/AddItem/AddItemCommand.cs` | edit | the two scaffolded scalars become four: `AddItemCommand(OrderIdentifierType OrderId, int ProductId, string ProductName, decimal UnitPrice, int Quantity)`, and the doc comment records why they travel on the command instead of being looked up |
| `UseCases/AddItem/AddItemCommandValidator.cs` | edit | the scaffolded rule validates the retired `Body`; validate the snapshot instead, mirroring `OrderInvariants`: `RuleFor(x => x.ProductName).NotEmpty().MaximumLength(OrderInvariants.ProductNameMaxLength);`, `RuleFor(x => x.UnitPrice).GreaterThan(0m);`, `RuleFor(x => x.Quantity).GreaterThan(0);` |
| `UseCases/AddItem/AddItemHandler.cs` | edit | the aggregate call in `Apply` takes the four scalars (fragment below). The handler derives from the framework's `AddChildEntityHandlerBase`, already answers with the new item's `OrderItemDTO`, and its `Includes` override already names `nameof(Order.Items)`, so the order is loaded tracked with its lines, which is what lets the aggregate enforce the item lock and recompute the total |
| `UseCases/EditItem/` | rename | the slice becomes `UseCases/ChangeItemQuantity/` (commands below), its three files and types become `ChangeItemQuantityCommand`, `ChangeItemQuantityCommandValidator` and `ChangeItemQuantityHandler`, and the namespace follows the folder. Quantity is the only mutable field on a line, so the command's `string Body` becomes `int Quantity`, the validator rule becomes `RuleFor(x => x.Quantity).GreaterThan(0);`, and the handler's `MutateAsync` calls `order.ChangeItemQuantity(command.ItemId, command.Quantity)`. The command keeps its required `RowVersion`, because the endpoint stays conditional on `If-Match` |
| `IntegrationEventHandlers/OrderPlacedHandler.cs` | edit | the consumer arrives generated and wired; it logs the new `CustomerName` too |

```csharp
        return parent.AddItem(
            id: null,
            command.ProductId,
            command.ProductName,
            command.UnitPrice,
            command.Quantity);
```

```powershell
$slice = 'Source\Modules\Orders\MMCA.ECommerce.Orders.Application\Orders\UseCases'
Rename-Item "$slice\EditItem" ChangeItemQuantity
Rename-Item "$slice\ChangeItemQuantity\EditItemCommand.cs" ChangeItemQuantityCommand.cs
Rename-Item "$slice\ChangeItemQuantity\EditItemCommandValidator.cs" ChangeItemQuantityCommandValidator.cs
Rename-Item "$slice\ChangeItemQuantity\EditItemHandler.cs" ChangeItemQuantityHandler.cs
```

Nothing else in the Application layer moves. The Delete, GetById, RemoveItem and ChangeStatus slices,
the create validator, all three DTO mappers (Mapperly maps the new item properties by name), the DTO
projector, `OrderCacheKeys`, the audit domain-event handler, and `DependencyInjection.cs` are all
correct exactly as generated, because each of them talks about items and none of them names a
renamed field.

### 5.5 API

**Edit** `Source/Modules/Orders/MMCA.ECommerce.Orders.API/Controllers/OrdersController.cs`.
The routes are unchanged, including `POST /Orders/{id}/items`, `PUT /Orders/{id}/items/{itemId}`, and
`DELETE /Orders/{id}/items/{itemId}`: `-Child Item` produced them. What changes is the
`using ...UseCases.EditItem;` (now `...UseCases.ChangeItemQuantity;`), the injected
`ICommandHandler<ChangeItemQuantityCommand, Result>` in place of the `EditItemCommand` one, the action
renamed from `EditItemAsync` to `ChangeItemQuantityAsync`, and the two new request types:
`AddItemAsync` takes an `AddOrderItemRequest` and builds
`new AddItemCommand(id, request.ProductId, request.ProductName, request.UnitPrice, request.Quantity)`,
and `ChangeItemQuantityAsync` takes a `ChangeOrderItemQuantityRequest` and builds
`new ChangeItemQuantityCommand(id, itemId, request.Quantity)`.

**Edit** the two error-resource files, `Resources/OrdersErrorResources.resx` and
`Resources/OrdersErrorResources.es.resx` in the same project.
Keep the resx envelope exactly as generated (the `<xsd:schema>` block and the four `<resheader>`
elements) and touch only the `<data>` elements: delete the three the reshape retires
(`Order.Closed`, `Order.Item.Body.*`), reword the two `Order.CustomerName.*` values the camel-case
substitution left as "customerName", and add the six new ones. The eight below, in this order, are
one entry per code `OrderInvariants` can emit, which is what makes the Pending-only lock and the
lifecycle guard reach the user in their own language rather than as a raw code:

| `data name` | `.resx` value (en) | `.es.resx` value (es) |
|---|---|---|
| `Order.CustomerName.Empty` | Order customer name cannot be empty. | El nombre del cliente del pedido no puede estar vacio. |
| `Order.CustomerName.TooLong` | Order customer name cannot exceed 200 characters. | El nombre del cliente del pedido no puede superar los 200 caracteres. |
| `Order.Item.ProductName.Empty` | Item product name cannot be empty. | El nombre del producto de la linea no puede estar vacio. |
| `Order.Item.ProductName.TooLong` | Item product name cannot exceed 200 characters. | El nombre del producto de la linea no puede superar los 200 caracteres. |
| `Order.InvalidUnitPrice` | Item unit price must be greater than zero. | El precio unitario de la linea debe ser mayor que cero. |
| `Order.InvalidQuantity` | Item quantity must be greater than zero. | La cantidad de la linea debe ser mayor que cero. |
| `Order.ItemsLocked` | Items can only be changed while the order is pending. | Las lineas solo se pueden modificar mientras el pedido esta pendiente. |
| `Order.InvalidStatusTransition` | The order cannot move to that status from its current one. | El pedido no puede pasar a ese estado desde el estado actual. |

Each entry is a `<data name="..." xml:space="preserve">` element wrapping a single `<value>`, exactly
like the ones you are replacing. The module's `OrdersErrorResources.cs` anchor type needs no edit:
`-Title CustomerName` already made its example code the one that exists.

Every source project builds again at this point. The solution build fails only in the two Orders
test projects (23 errors on the retired `EditItem` slice, `OrderStatus` members, and `AddItem`
signature) until 5.6.

### 5.6 Tests

Leave `Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/MMCA.ECommerce.Orders.Application.Tests.csproj`
as generated: it already references `Moq` beside `xunit.v3` and `AwesomeAssertions`, so it needs
nothing new. Then the test files themselves, all under `Tests/Modules/Orders/`:

| File | Action | What it covers |
|---|---|---|
| `MMCA.ECommerce.Orders.Domain.Tests/Orders/OrderTests.cs` | rewrite | 27 tests over the aggregate, the item lock, and the lifecycle: creation as Pending with a zero total, the product snapshot on `AddItem`, accumulated item invariants, `Order.ItemsLocked` on add, change and remove after Pending, `Total` over live lines, `ChangeItemQuantity`, a `[Theory]` over the four allowed and four refused transitions, the idempotent re-assert, `UpdateDetails` after Pending, and the cascade delete. Keep the comment inside `Total_ExcludesSoftDeletedItems` (below): it documents a real consequence of database-generated ids, and without it the `RemoveItem(itemId: 0)` call looks like a mistake |
| `MMCA.ECommerce.Orders.Application.Tests/Caching/OrderCacheInvalidationTests.cs` | edit | the scaffolded suite discovers every `ICacheInvalidating` command and fails by name when one has no builder, so `EditItemCommand` becomes `ChangeItemQuantityCommand` (built as `new ChangeItemQuantityCommand(OrderId, ItemId: 1, Quantity: 3) { RowVersion = ClientToken }`) in both its `HandListedBeforeDiscovery` list and its `HandWrittenBuilders()` table, the `AddItemCommand` builder passes the snapshot (`new AddItemCommand(OrderId, ProductId: 1, "Espresso cup", 12.50m, Quantity: 1)`), and the fixture statuses `OrderStatus.Closed` and `OrderStatus.Open` become `OrderStatus.Paid` and `OrderStatus.Pending`. That discovery is what catches a slice added later without a `CachePrefix` here rather than in production |
| `MMCA.ECommerce.Orders.Application.Tests/Concurrency/OrderConcurrencyTokenTests.cs` | edit | the same `EditItem` to `ChangeItemQuantity` retarget (using, test name, handler type, command), `OrderStatus.Paid` for `Closed`, and the new `AddItem` arguments |
| `MMCA.ECommerce.Orders.Application.Tests/Deletion/DeleteOrderCascadeTests.cs` and `.../Projections/OrderDTOProjectorTests.cs` | edit | each `AddItem(id: null, "...", authorUserId: N)` call becomes `AddItem(id: null, productId: N, "...", 10m, 1)` |

```csharp
    [Fact]
    public void Total_ExcludesSoftDeletedItems()
    {
        var order = CreatePendingOrder();
        order.AddItem(id: null, productId: 1, "Cup", 12.50m, 2);
        order.AddItem(id: null, productId: 2, "Saucer", 4m, 3);

        // Ids are database-generated, so every line that has not been persisted still carries Id 0,
        // and GetChildOrNotFound resolves the first live one: this removes the cup, not the saucer.
        order.RemoveItem(itemId: 0);

        order.Total.Should().Be(12m);
    }
```

### 5.7 Verify both reshapes

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test --project Tests/Modules/Orders/MMCA.ECommerce.Orders.Domain.Tests/MMCA.ECommerce.Orders.Domain.Tests.csproj
dotnet test --project Tests/Modules/Orders/MMCA.ECommerce.Orders.Application.Tests/MMCA.ECommerce.Orders.Application.Tests.csproj
dotnet test --project Tests/Architecture/MMCA.ECommerce.Architecture.Tests/MMCA.ECommerce.Architecture.Tests.csproj
```

Expect a warning-free build, then **27/27** passing in the Orders domain suite, **21/21** in the
Orders application suite, and the architecture suite at 106 of 107, the one failure being
`IntegrationEventContractTests`, which step 8 settles. No database is involved in any of them.

That last run is the one worth watching, and it is only worth watching because *both* modules were
reshaped: a flat, status-less catalog module beside an aggregate that owns a growing child collection
and a guarded lifecycle is what makes the layering, module-isolation, and event-convention rules say
something. Two copies of the same generated shape would pass them vacuously. If it reds on isolation,
the cause is almost always an accidental `using` of a Products type inside Orders, which is exactly the
mistake the `ProductName` / `UnitPrice` snapshot exists to make unnecessary. Single-test runs need the
same MTP filter after a bare `--` as in 4.7, for example
`-- --filter-method "*ChangeStatus*"`.

`dotnet test --solution MMCA.ECommerce.slnx` runs everything in one pass, and it goes fully green once
step 8 brings the frozen integration-event wire contract up to date.

## 6. Point the UI at the new domain

The scaffolded Blazor host already has the load-bearing parts: the typed `ECommerceApiClient`
(`Source/Hosts/UI/MMCA.ECommerce.UI.Web/Services/ECommerceApiClient.cs`)
calling the API server-side through Aspire service discovery (no CORS, no token), the
`en`/`es` resource pairs, and the theme/culture chrome. What it does not have is the new domain, so
the client grows first, then the pages.

**The client.** `CreateProductAsync` and `UpdateProductAsync` gain a `decimal price` parameter
(before the cancellation token, and before `rowVersion` on the update) and send
`new { Name = name, Description = description, Price = price }`. The Orders calls copy the shape of
the Products ones: `GetOrdersAsync` (`GET Orders`, read as `CollectionResult<OrderDTO>`),
`GetOrderAsync` (`GET Orders/{id}/details`), `CreateOrderAsync`, `UpdateOrderAsync`,
`ChangeOrderStatusAsync` (`PUT /Orders/{id}/status` with a `ChangeOrderStatusRequest`),
`AddOrderItemAsync` (an `AddOrderItemRequest`), `ChangeOrderItemQuantityAsync`,
`RemoveOrderItemAsync`, and `DeleteOrderAsync`. Three rules come from the controller's attributes and
the analyzers. The writes marked `[SupportsIfMatch]` (update, status, item quantity) go through the
existing `ConditionalPut` helper with the order's `RowVersion`. The two `[Idempotent]` posts (create,
add item) send a fresh `Idempotency-Key` header per user action. And a helper that sends a request it
did not build takes a `Func<HttpRequestMessage>` and disposes the message inside, because handing it
a constructed `HttpRequestMessage` trips `CA2000`.

**The pages.** Reshape the Products pages to Name/Description/Price, and add two Orders pages that
mirror them. All four live under `Source/Hosts/UI/MMCA.ECommerce.UI.Web/Components/Pages/`:

- `Products.razor` and `ProductDetail.razor`: the catalog list and the create/edit form, on
  Name/Description/Price. The price is a `MudNumericField<decimal>` with its own invalid flag
  (`_priceInvalid = _price <= 0;`) and focus target, and the list shows it formatted with
  `ToString("C", CultureInfo.CurrentCulture)`.
- `Orders.razor` and `OrderDetail.razor` (`@page "/orders"` and `@page "/orders/{Id:int}"`):
  create and list orders, then edit the customer name, walk the status lifecycle (the page offers
  only the transitions the domain allows), and manage items while the order is Pending. The add-item
  form is a product picker filled from `GetProductsAsync()`: selecting a product snapshots its id,
  name, and price into the `AddOrderItemRequest`, which is the UI half of the module-isolation
  decision above. A page that names `Result` (a write helper typed `Func<Task<Result>>`, for example)
  needs `@using MMCA.Common.Shared.Abstractions`, which `_Imports.razor` does not carry.

Mirror the scaffold's page conventions: a page opens with
`<PageHeading Text="@(L["Browser.Tab"].Value)" />` and marks its panels with `<SectionHeading>`
(both generated components, not MudBlazor ones), the delete dialog and the required-field warning
read the fixed chrome keys `Dialog.Delete.Heading` and `Snackbar.RequiredFields`, and the
required-field check accumulates one line at a time
(`missingRequired = missingRequired || _priceInvalid;`) rather than as one compound condition, so an
optional axis can drop a line without breaking the expression.

Every string goes through the `L[...]` localizer, and every key needs an entry in both the `.resx`
and `.es.resx` file beside the page: `Field.Price`, `Column.Price` and `Validation.PricePositive` on
the Products pair, and a fresh pair per Orders page (start from a copy of `Products.resx` with its
`<data>` elements removed, which keeps the envelope). Status labels read well as `Status.{value}`
keys (`L[$"Status.{order.Status}"]`), one per `OrderStatus` member.

Four files outside `Pages/` also move. The UI project needs a `ProjectReference` to
`..\..\..\Modules\Orders\MMCA.ECommerce.Orders.Shared\MMCA.ECommerce.Orders.Shared.csproj` (contracts
only, never a module's Application or Domain layer). `Components/_Imports.razor` gains
`@using System.Globalization` for the currency formatting and
`@using MMCA.ECommerce.Orders.Shared.Orders`. And `Components/Layout/MainLayout.razor` gains the
Products and Orders app-bar links (`<MudButton Href="/products" ...>` and `Href="/orders"`, before
the `<MudSpacer />`). Its `L` is the framework's `SharedResource` localizer, which has no key for
either link, so inject a second one, `IStringLocalizer<MainLayout>`, and give it a
`MainLayout.resx` / `MainLayout.es.resx` pair beside the layout.

Build the solution once more: it is warning-free with the pages in.

## 7. Create the migrations

Neither module has a migration yet: any shape flag makes `mmca-app` drop the template's sample one
(it described the sample shape), and `-SkipMigration` deferred the Orders one to here. Each
`Migrations` folder does carry an `.editorconfig` that keeps analyzer enforcement off generated
migration code, and `dotnet ef` never recreates it, so leave it alone. Generate both fresh
(`migrations add` never opens a database connection):

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

Each migration creates its module's tables in the module schema (`Products.Product`, and
`Orders.Order` plus `Orders.OrderItem`) plus that database's own `dbo` infrastructure tables
(`OutboxMessages`, `InboxMessages`, `InternalCommands`, `AuditTrailEntries`, and `ScheduledJobs` in
the Products database, which is the pinned outbox source): two databases, two outboxes, no
contention. `Price` and `UnitPrice` come out as `decimal(18,2)`, and both name indexes carry the
`[IsDeleted] = 0` filter.

## 8. The two one-time fixups, then run it

Apply the two one-time fixups: the sort order the scaffold deliberately leaves to you (it is
name-dependent, so no generated value could be right), and the wire-contract update your reshape made
necessary. First, sort the using directives and the identifier aliases:

```powershell
dotnet format analyzers MMCA.ECommerce.slnx --diagnostics SA1210 SA1211 --severity info
```

Then delete the `SCAFFOLD DELTA` block at the bottom of `.editorconfig` (from its dashed comment
rule to the end of the file), which restores the full analyzer baseline. For this shape the block
holds two severity lines, `SA1210` and `SA1211`, for the sort order the command above just fixed. Its
comment also explains `IDE0021`, which a heavily flagged aggregate can need relaxed when its private
constructor ends up holding a single statement (the baseline would then require an expression body).
This sample never trips that: both aggregates assign at least two fields. The build stays green with
the block gone.

Second, bring the frozen integration-event wire contract up to date. `ArchitectureTests.cs` ships an
`IntegrationEventContractTests` subclass holding the Products event as scaffolded, and
`build/add-module.ps1` appended `Orders.OrderPlaced.v1 { OrderId:Int32 }`. Entries are keyed on each
event's `[EventName]` wire identity, not its CLR type name. Both reshapes added members, so the test
fails and lists each one (`Orders.OrderPlaced.v1: EXTRA member CustomerName:String`, and `Name:String`
and `Price:Decimal` on `Products.ProductCreated.v1`). Set `MMCA_CONTRACT_SNAPSHOT_OUT` to a file path
and re-run it to get the live contract as ready-to-paste literals:

```powershell
$env:MMCA_CONTRACT_SNAPSHOT_OUT = "$PWD\contract.txt"
dotnet test --project Tests/Architecture/MMCA.ECommerce.Architecture.Tests/MMCA.ECommerce.Architecture.Tests.csproj -- --filter-class "*IntegrationEventContractTests*"
Remove-Item Env:MMCA_CONTRACT_SNAPSHOT_OUT
```

Replace the two `ExpectedContract` entries with what the file holds, which is the wire contract
evolving on purpose rather than by accident
([ADR-010](../adr/010-integration-event-schema-versioning.md)):

```csharp
        "Orders.OrderPlaced.v1 { CustomerName:String, OrderId:Int32 }",
        "Products.ProductCreated.v1 { Name:String, Price:Decimal, ProductId:Int32 }",
```

The [getting-started guide](common-GETTING-STARTED.md#6-the-one-time-fixup) covers the sort fixup and
the frozen contract in full. Then the final pass:

```powershell
dotnet build MMCA.ECommerce.slnx
dotnet test  --solution MMCA.ECommerce.slnx
```

A warning-free build and **181 passing tests**: 9 Products domain, 17 Products application, 27
Orders domain, 21 Orders application, and 107 architecture.

> **Re-running the walkthrough on the same machine?** The Aspire SQL container is persistent by
> design, so databases created by an earlier MMCA.ECommerce build survive a re-scaffold, and their
> migration history will not match your fresh migrations: startup then fails with "There is already
> an object named 'InboxMessages' in the database". Drop the stale `ECommerce*` databases (or
> remove the `sql-*` container in Docker) before the first run.

Then, from a **real, interactive terminal** (headless, the AppHost stalls at control-plane init and
looks like a hang):

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

1. Baseline green immediately after `mmca-app`, before any edit: **129 tests**.
2. After `build/add-module.ps1`: still green at **164 tests**, both modules' scaffolded suites running.
3. After both reshapes and the fixups: `dotnet build MMCA.ECommerce.slnx` warning-free and
   `dotnet test --solution MMCA.ECommerce.slnx` fully green at **181 tests**, with the architecture
   rules passing: layering, module isolation, event conventions, and your updated frozen wire
   contract.
4. Both `InitialCreate` migrations generated, each with its module's tables plus its own
   `OutboxMessages` table.
5. Interactively: products created, an order walked Pending to Shipped, items locked after Pending,
   and an outbox row written per placed order.

---

## Where to look next

- **[Getting started](common-GETTING-STARTED.md)**: the single-module path, the vertical-slice
  templates (`mmca-command` / `mmca-query`), and the framework-upgrade and extraction notes.
- **[Templates](common-TEMPLATES.md)**: every parameter of all four templates, plus
  `build/add-module.ps1`.
- **[Building by hand](common-BUILD-BY-HAND.md)**: what each generated file does and why.
- **[MMCA.Helpdesk](https://github.com/ivanball/MMCA.Helpdesk)**: the reference app the templates
  are staged from.
