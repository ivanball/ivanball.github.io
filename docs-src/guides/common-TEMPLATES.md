# Templates: scaffolding an MMCA app

`MMCA.Templates` is a `dotnet new` pack that scaffolds solutions, modules, and vertical slices on the
[MMCA.Common](https://www.nuget.org/packages?q=MMCA.Common) framework. It exists because standing up
a new app by hand meant 12 projects and roughly 5,300 lines before a line of business logic, several
of them load-bearing in ways nothing tells you about until much later. See
[ADR-065](../adr/065-scaffolding-templates.md) for the reasoning,
[Getting Started](common-GETTING-STARTED.md) for the six-step path from nothing to a running app, and
[Building by Hand](common-BUILD-BY-HAND.md) for what the generated code actually does, phase by phase.

```bash
dotnet new install MMCA.Templates
dotnet new mmca-app -n Contoso.Support --module Orders --aggregate Order
cd Contoso.Support
dotnet build Contoso.Support.slnx
dotnet test  --solution Contoso.Support.slnx
```

That is a warning-free build under all five analyzers and a passing test run, including the
architecture-fitness rules, with no database needed.

| Short name | Generates | Run it from |
|---|---|---|
| `mmca-app` | the whole solution | anywhere; it creates the solution directory |
| `mmca-module` | a business module across all five layers, both test projects, a migrations project | your solution root |
| `mmca-command` | one write-side slice: command record + handler | your module's `UseCases` folder |
| `mmca-query` | one read-side slice: cacheable query record + handler | your module's `UseCases` folder |

---

## `mmca-app`

| Parameter | Default | Meaning |
|---|---|---|
| `-n, --name` | `MMCA.App` | solution name and root namespace, for example `Contoso.Support` |
| `-m, --module` | `Tickets` | the first business module, plural PascalCase |
| `-a, --aggregate` | `Ticket` | that module's aggregate root, singular PascalCase |
| `-f, --framework-version` | the version the pack was cut against | the `MMCA.Common.*` version to pin |
| `--local-mmca` | off | emit a `local.props` that builds against `../MMCA.Common/Source` instead of the published packages |
| `--no-restore` | off | skip the restore after generation |

The module and aggregate names are independent, so `--module Billing --aggregate Invoice` is fine.
Everything derived from them follows: routes, the Aspire database resource, the design-time
connection-string environment variable, the identifier alias, the cache-key prefix, the resource
strings, and the Blazor pages.

**What you get** (names shown for `-n Contoso.Support --module Orders --aggregate Order`):

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
mutations raising domain events, a child entity, soft-delete cascade, the caching pair (a cacheable
read plus invalidating commands, both keyed through one `*CacheKeys` type), an integration event
through the outbox, `en-US` and `es` resource pairs, a REST controller, and two Blazor pages.

### Dropping the Blazor UI host

There is no `--ui` flag: a conditional big enough to remove a host cannot be expressed without
`#if` regions that would either break the reference app's own build or leave it compiling the
wrong variant. Removing it afterwards is five steps, and **four of them fail loudly while the fifth
does not**, so do them together:

1. Delete `Source/Hosts/UI/`.
2. Remove the `<Project Path="Source/Hosts/UI/..." />` line from the `.slnx`.
3. Remove the UI `ProjectReference` from `<App>.AppHost.csproj`. Aspire generates the
   `Projects.<App>_UI_Web` type from that reference, so the AppHost will not compile until it goes.
4. Remove the `builder.AddProject<Projects.<App>_UI_Web>("ui")` block from the AppHost `Program.cs`.
5. **Drop the `var web = ` prefix from the block above it.** `web` existed only for the UI's
   `WithReference(web)` / `WaitFor(web)`. Left assigned and unread it is an unused local, which is
   `IDE0059` **and** `S1481`, both at error severity, so the build fails on a line you never
   touched.

The API host, the module, the migrations project, and all three test projects are unaffected.

### The two one-time fixups

The scaffold deliberately does not hand these over, because renaming invalidates them and no fixed
value is right for every name you could pick.

**1. Using-directive order.** `using Contoso.Support.Orders.Shared;` sorts above `MMCA.Common.*`,
but `using Zeta.App.Orders.Shared;` sorts below it. `SA1210` has no notion of blank-line-separated
groups, so no checked-in order survives both. It ships as a suggestion, via a clearly marked block at
the bottom of the generated `.editorconfig`. Sort them with:

```bash
dotnet format analyzers Contoso.Support.slnx --diagnostics SA1210 --severity error
```

Every `mmca-command` / `mmca-query` slice arrives with the same skew, so either re-run that after
scaffolding, or leave the block until you have stopped scaffolding and then delete it. Every other
analyzer stays at error severity throughout.

**2. Your integration-event wire contract.** Integration events cross service boundaries over the
broker, so a renamed, removed, or retyped property breaks consumers in another service.
`IntegrationEventContractTestsBase` fails the build on a silent reshape, but only against a contract
**you** froze: one inherited from a sample module guarantees nothing, and its frozen literal lists
members alphabetically, so `{ RequesterUserId, TicketId }` stops being correct the moment `Ticket`
becomes `Order`. Add the subclass to your `ArchitectureTests.cs`:

```csharp
public sealed class IntegrationEventContractTests : IntegrationEventContractTestsBase
{
    protected override IArchitectureMap Map { get; } = new SupportArchitectureMap();

    // Frozen wire contract. Update DELIBERATELY when evolving an integration event
    // (version it per ADR-010; never a silent reshape).
    protected override IReadOnlyList<string> ExpectedContract =>
    [
        // paste the actual value from the failing run
    ];
}
```

then run it once and paste what the failure prints:

```bash
dotnet test --project Tests/Architecture/Contoso.Support.Architecture.Tests/Contoso.Support.Architecture.Tests.csproj \
  -- --filter-class "*IntegrationEventContract*"
```

---

## `mmca-module`

```bash
cd Contoso.Support
dotnet new mmca-module -n Billing --app Contoso.Support --aggregate Invoice
```

| Parameter | Meaning |
|---|---|
| `-n, --name` | the module, plural PascalCase, for example `Billing` |
| `--app` | your solution / root namespace, for example `Contoso.Support` (required) |
| `-a, --aggregate` | the module's aggregate root, singular PascalCase (required) |

Generates eight projects into the right places: the five layer projects under
`Source/Modules/<Module>/`, both test projects under `Tests/Modules/<Module>/`, and a migrations
project under `Source/Hosting/`. The migrations project ships **without** a `Migrations/` folder: you
create the first one against your own entities.

### The five wire-ups it prints

`dotnet new` cannot patch files that already exist, so it prints these. Until they are done the
module is invisible to the host and to the fitness rules; the first two are what make it compile.

1. **Solution.** `dotnet sln <App>.slnx add Source/Modules/<Module>/*/*.csproj Tests/Modules/<Module>/*/*.csproj Source/Hosting/<App>.Migrations.SqlServer.<Module>/*.csproj`
2. **Project references.** `<App>.Web.csproj` needs `<App>.<Module>.API` and
   `<App>.Migrations.SqlServer.<Module>`. `<App>.Architecture.Tests.csproj` needs **all five** layer
   projects, because the map in step 4 names a type from each.
3. **Identifier alias.** Copy the existing `<Compile Include ... Link>` block in
   `Directory.Build.props` and point it at the new module's `*.GlobalUsings.IdentifierType.cs`.
   Without it the alias is invisible outside its own project.
4. **Architecture map.** Five lines in your `*ArchitectureMap.cs`, one per layer. **A module missing
   from the map is silently not covered by the layering and isolation rules** (ADR-015).
5. **Host.** `services.AddErrorResources<<Module>ErrorResources>();` next to the existing ones.
   `ModuleLoader` discovers the `IModule` itself, so nothing else needs registering.

Then create the first migration:

```bash
dotnet ef migrations add InitialCreate \
  --project Source/Hosting/Contoso.Support.Migrations.SqlServer.Billing \
  --startup-project Source/Hosting/Contoso.Support.Migrations.SqlServer.Billing \
  --context SQLServerDbContext
```

---

## `mmca-command` and `mmca-query`

Run these from the module's `UseCases` folder. Each creates a folder named after the slice holding
its two files.

```bash
cd Source/Modules/Billing/Contoso.Support.Billing.Application/Billing/UseCases

dotnet new mmca-command -n ArchiveInvoice --app Contoso.Support --module Billing \
  --aggregate Invoice --domain-method Archive

dotnet new mmca-query -n GetInvoiceByNumber --app Contoso.Support --module Billing \
  --aggregate Invoice
```

| Parameter | Applies to | Meaning |
|---|---|---|
| `-n, --name` | both | the use case, PascalCase; names the folder, the namespace segment, and both types |
| `--app` | both | your solution / root namespace (required) |
| `-m, --module` | both | the module this slice goes into (required) |
| `-a, --aggregate` | both | the aggregate the handler loads (required) |
| `--domain-method` | `mmca-command` | the guarded method the command calls on the aggregate |

Handlers are convention-scanned by Scrutor, so there is no DI registration to add. Three things do
need you:

- **The command slice calls `--domain-method` on your aggregate**, and the scaffold cannot invent it.
  Add that method returning `Result` before the slice compiles, or the generated handler fails with
  `'Invoice' does not contain a definition for 'Archive'`. `dotnet new` prints the same reminder as a
  post-action; the [getting-started guide](common-GETTING-STARTED.md#add-your-next-feature) shows the
  shape to copy.
- **Check the handler's `includes:`.** The command slice is a rename of the reference app's delete
  slice, which loads its aggregate's child collection, so the generated handler arrives with
  `includes: [nameof(Invoice.Comments)]`. `--aggregate` substitutes the aggregate name but nothing
  substitutes the navigation name, so that line compiles only while your aggregate still has the
  scaffolded `Comments` collection. Retarget it at your own child collection, or drop the argument
  when the method only touches the root.
- **Keep the query's `CacheKey` inside your module's `*CacheKeys.Prefix`.** The caching decorator
  matches cacheable reads to invalidating commands **by string prefix**, so a key that drifts out of
  the prefix goes stale silently and nothing fails.

Map both in your module's controller: reads generally come from `EntityControllerBase`, and writes
inject handlers directly.

---

## How the pack is built

The template content is the [MMCA.Helpdesk](https://github.com/ivanball/MMCA.Helpdesk) reference
application itself, staged at pack time. There is no second copy of the solution, so the template
cannot drift from the app whose CI keeps it building.

That also means the seed's green CI is **not** the template's gate. The seed builds in local-source
mode against `MMCA.Common@main`, while a generated app builds in package mode against a released
version, and a source-mode build can pass where package-mode Release fails on an analyzer. A separate
`template-smoke` job generates two solutions whose names share no substring with the seed, sweeps for
residual tokens, builds package-mode, runs the tests, and applies the five module wire-ups.

To work on the templates:

```bash
git clone https://github.com/ivanball/MMCA.Helpdesk
cd MMCA.Helpdesk
pwsh build/templates/smoke.ps1        # stage, pack, install, generate, build, test
```
