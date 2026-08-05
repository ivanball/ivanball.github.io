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

No credentials, tokens, or extra feeds: `MMCA.Templates` and every `MMCA.Common.*` package restore
from nuget.org ([ADR-053](../adr/053-dual-registry-package-publishing.md)).

---

## 1. Install the template pack

```bash
dotnet new install MMCA.Templates
```

## 2. Generate the solution with the Products module

```bash
dotnet new mmca-app -n MMCA.ECommerce --module Products --aggregate Product
cd MMCA.ECommerce
```

One command, and the whole monolith exists: the Products module across Shared, Domain, Application,
Infrastructure, and API, the REST host, the Blazor UI host, the Aspire AppHost, a migrations project
for the module's database, and three test projects including the architecture fitness rules.

Get your green baseline before changing anything:

```bash
dotnet build MMCA.ECommerce.slnx
dotnet test  --solution MMCA.ECommerce.slnx
```

That is a warning-free build under five analyzers at error severity and 90 passing tests, with no
database needed. This baseline is the line you bisect against later.

## 3. Add the Orders module

```bash
dotnet new mmca-module -n Orders --app MMCA.ECommerce --aggregate Order
```

Eight more projects appear (the five layers, two test projects, one migrations project). `dotnet new`
cannot patch files that already exist, so the template prints the wire-ups it needs from you. Here
they are, concretely, for this app:

**a. Add the projects to the solution:**

```bash
dotnet sln MMCA.ECommerce.slnx add Source/Modules/Orders/*/*.csproj Tests/Modules/Orders/*/*.csproj Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Orders/*.csproj
```

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

Build and test again: still green, now with the Orders module's scaffolded tests included. There is
no new kind of thing in the solution, just a second copy of the shape you already had.

## 4. Reshape Products into a catalog product

Both scaffolded modules arrive as the template's worked example (a title, a description, a status,
a growable child collection): a placeholder domain in *your* namespaces, meant to be reshaped. The
reshape is ordinary editing, and every convention stays: `Result`-returning factory, invariants
composed with `Result.Combine`, guarded mutations raising domain events, the caching pair, the
integration event through the outbox.

`Product` becomes the whole catalog entry: `Name`, `Description`, `Price`. The child entity and the
status go away entirely, which makes Products the minimal single-entity module:

```csharp
// Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/Product.cs
[IdValueGenerated]
public sealed class Product : AuditableAggregateRootEntity<ProductIdentifierType>
{
    public string Name { get; private set; }
    public string Description { get; private set; }
    public decimal Price { get; private set; }

    public static Result<Product> Create(
        ProductIdentifierType? id, string name, string description, decimal price)
    { /* Result.Combine of the three invariants; no "Added" domain event: the id is
         database-generated, creation is signalled after commit by ProductCreatedIntegrationEvent */ }

    public Result UpdateDetails(string name, string description, decimal price) { /* raises ProductChanged */ }
    public override Result Delete() { /* soft delete; raises ProductChanged(Deleted) */ }
}
```

The full change set, layer by layer (each file is small; follow the
[repo](https://github.com/ivanball/MMCA.ECommerce/tree/main/Source/Modules/Products) where this
table abbreviates):

| Layer | Change |
|---|---|
| Domain | `Product` as above; `ProductInvariants` gains `EnsurePriceIsValid`; delete `ProductComment` |
| Shared | `ProductDTO { Id, RowVersion, Name, Description, Price }`; create/update requests to match; `ProductOpenedIntegrationEvent` renamed `ProductCreatedIntegrationEvent(ProductId, Name, Price)`; delete comment/status DTOs and requests |
| Application | keep the Create/Update/Delete/GetById use cases (reshaped payloads); delete the comment and status slices; the caching pair stays keyed through `ProductCacheKeys` |
| Infrastructure | `ProductConfiguration`: `Name` max 200, `Description` max 4000, `Price decimal(18,2)`; delete the comment configuration; the module context drops to one `DbSet<Product>` |
| API | `ProductsController` keeps the inherited reads plus `POST /Products`, `PUT /Products/{id}`, `DELETE /Products/{id}`; error resources cover exactly the codes the invariants use, in both languages |
| Tests | the domain and application suites assert the new invariants and use cases (29 tests in the sample) |

## 5. Reshape Orders into an order with line items

Orders keeps the child-collection pattern the template scaffolded, retargeted: `OrderComment`
becomes `OrderItem`, and the free-form status becomes a lifecycle.

```csharp
// Source/Modules/Orders/MMCA.ECommerce.Orders.Domain/Orders/Order.cs
[IdValueGenerated]
public sealed class Order : AuditableAggregateRootEntity<OrderIdentifierType>
{
    public string CustomerName { get; private set; }
    public OrderStatus Status { get; private set; }          // Pending -> Paid -> Shipped; Cancelled from Pending/Paid

    [Navigation(IsCollection = true)]
    public IReadOnlyCollection<OrderItem> Items => _items.AsReadOnly();
    public decimal Total => _items.Where(i => !i.IsDeleted).Sum(i => i.UnitPrice * i.Quantity);

    public static Result<Order> Create(OrderIdentifierType? id, string customerName) { /* Status = Pending */ }
    public Result<OrderItem> AddItem(OrderItemIdentifierType? id, int productId, string productName, decimal unitPrice, int quantity) { }
    public Result ChangeItemQuantity(OrderItemIdentifierType itemId, int quantity) { }
    public Result RemoveItem(OrderItemIdentifierType itemId) { }
    public Result ChangeStatus(OrderStatus newStatus) { /* transition guard; Shipped and Cancelled are terminal */ }
}
```

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

The layer-by-layer sweep mirrors the Products table (full files in the
[repo](https://github.com/ivanball/MMCA.ECommerce/tree/main/Source/Modules/Orders)): DTOs and
requests for items and status changes, `AddItem`/`ChangeItemQuantity`/`RemoveItem`/`ChangeStatus`
use cases beside the scaffolded Create/Update/Delete/GetById, `OrderItemConfiguration` with
`UnitPrice decimal(18,2)`, controller routes `POST /Orders/{id}/items`,
`PUT /Orders/{id}/items/{itemId}`, `DELETE /Orders/{id}/items/{itemId}`, `PUT /Orders/{id}/status`,
and the renamed `OrderPlacedIntegrationEvent`. The sample's Orders suites hold 56 tests, including
the full status lifecycle and the cascade soft-delete of items.

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
Delete the files under
`Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Products/Migrations/` and generate both fresh
(`migrations add` never opens a database connection):

```bash
dotnet ef migrations add InitialCreate \
  --project Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Products \
  --startup-project Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Products \
  --context SQLServerDbContext

dotnet ef migrations add InitialCreate \
  --project Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Orders \
  --startup-project Source/Hosting/MMCA.ECommerce.Migrations.SqlServer.Orders \
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

Then, from a **real, interactive terminal** (launched headless, the AppHost stalls at control-plane
init and looks like a hang):

```bash
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
