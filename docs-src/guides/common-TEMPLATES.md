# Templates: scaffolding an MMCA app

`MMCA.Templates` is a `dotnet new` pack that scaffolds solutions, modules, and vertical slices on the
[MMCA.Common](https://www.nuget.org/packages?q=MMCA.Common) framework. It exists because standing up
a new app by hand meant 12 projects and roughly 5,300 lines before a line of business logic, several
of them load-bearing in ways nothing tells you about until much later. See
[ADR-065](../adr/065-scaffolding-templates.md) for the reasoning,
[Getting Started](common-GETTING-STARTED.md) for the six-step path from nothing to a running app,
[Small Apps](common-SMALL-APPS.md) for the `--database sqlite --no-aspire` floor, and
[Building by Hand](common-BUILD-BY-HAND.md) for what the generated code actually does, phase by phase.

```powershell
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
| `mmca-command` | one write-side slice: command record + validator + handler | your module's `UseCases` folder |
| `mmca-query` | one read-side slice: cacheable query record + handler | your module's `UseCases` folder |

`mmca-app` also lays down `build/add-module.ps1` inside the solution it generates (its own section
below): it drives `mmca-module` and then performs every wire-up `dotnet new` cannot reach.

---

## `mmca-app`

| Parameter | Default | Meaning |
|---|---|---|
| `-n, --name` | `MMCA.App` | solution name and root namespace, for example `Contoso.Support` |
| `-m, --module` | `Tickets` | the first business module, plural PascalCase |
| `-p:a, --aggregate` | `Ticket` | that module's aggregate root, singular PascalCase |
| `-c, --child` | `Comment` | the aggregate's child entity, singular PascalCase (1.3.0) |
| `--title` | `Title` | the aggregate's main text property, singular PascalCase (1.4.0) |
| `--event-verb` | `Opened` | verb naming the creation integration event, past tense PascalCase (1.4.0) |
| `--flat` | off | generate the module with no child collection at all (1.3.0) |
| `--no-status` | off | generate the module with no status axis (1.3.0) |
| `--no-description` | off | generate the module with no long-text property (1.4.0) |
| `--no-owner` | off | generate the module with no owning-user property (1.4.0) |
| `--database` | `sqlserver` | relational engine for the sample module: `sqlserver` or `sqlite` |
| `--no-aspire` | off | generate the solution with no Aspire AppHost |
| `-f, --framework-version` | the version the pack was cut against | the `MMCA.Common.*` version to pin |
| `--local-mmca` | off | emit a `local.props` that builds against `../MMCA.Common/Source` instead of the published packages |
| `--no-restore` | off | skip the restore after generation |

The module and aggregate names are independent, so `--module Billing --aggregate Invoice` is fine.
Everything derived from them follows: routes, the Aspire database resource, the design-time
connection-string environment variable, the identifier alias, the cache-key prefix, the resource
strings, and the Blazor pages.

### Shaping the sample module

Six options decide what the generated aggregate is made of, so you stop deleting or renaming the
sample's shape by hand after the fact. `--child`, `--flat` and `--no-status` arrived in
`MMCA.Templates` **1.3.0**; `--title`, `--event-verb`, `--no-description` and `--no-owner` in
**1.4.0**. Four of them are shape decisions and two are renames.

**The four shape flags** remove an axis. The code for an axis you turn off is never generated, so
there is nothing to delete afterwards:

| Option | What it drops |
|---|---|
| `--flat` | the child collection entirely: no child entity, DTO, requests, mapper, EF configuration, `Add`/`Edit`/`Remove` slices, controller endpoints, identifier alias, or tests |
| `--no-status` | the status axis: no status enum, no `ChangeStatus` slice, request, or endpoint, no `Status` property, no status invariant or tests |
| `--no-description` | the long-text property: no `Description` property or invariant, no max-length constant, no DTO, request, or command field, no validator rule, no EF max-length configuration, no error-resource entries, no UI field, no tests |
| `--no-owner` | the owning-user property: no `RequesterUserId` property, no create-request field or validator rule, no member on the creation integration event, no EF index, no UI field or column, no tests |

Reach for them when the aggregate genuinely lacks the axis, which is more common than the sample
suggests: a catalog product, a customer, a price list, a tax rate. Passing all four leaves a leaf
aggregate that is nothing but its own scalar fields, which is the smallest honest starting point the
pack can generate, and it still arrives with the full five-layer wiring and a green test run.

**The two renames** are plain substring replacements rather than shape decisions. `--child` renames
the child concept everywhere; the generated type is `<aggregate><child>`, so:

```powershell
dotnet new mmca-app -n Contoso.Shipping --module Shipments --aggregate Shipment --child Line
```

gives you a `ShipmentLine` entity and DTO, `AddLine` / `EditLine` / `RemoveLine` use-case slices,
`/lines` routes on the controller, an `AddLineRequest` / `EditLineRequest` pair, and a
`ShipmentLineIdentifierType` alias. The plural comes from an English pluralizer (`Line` to `Lines`,
`Entry` to `Entries`, `Box` to `Boxes`), so an irregular noun is the one case you rename by hand.
`--child` is ignored under `--flat`, since there is no child left to name.

`--title` renames the aggregate's main text property, and everything that names it moves with it: the
domain property and its invariant, the `<Aggregate>.<Title>.Empty` / `.TooLong` error codes, the
`<Title>MaxLength` constant, the DTO and request properties, the EF column, the FluentValidation
rule, the UI field and column resources, and the domain tests. A camel-case form is derived for
parameters, private fields, named arguments and `nameof()` targets, using first-letter lowering
rather than full lowering so a multi-word value stays a valid identifier (`CustomerName` to
`customerName`, not `customername`). The price of a substring replacement is that the camel-case form
also reaches **English prose**: with a multi-word `--title`, the two shipped error messages arrive
reading "Order customerName cannot be empty." Identifiers have to compile; those two strings are a
one-line edit in the module's error resources after generating.

`--event-verb` names the creation integration event's verb, past tense. `--aggregate Order
--event-verb Placed` gives `OrderPlacedIntegrationEvent` and its `OrderPlacedHandler` consumer. The
id is database-generated, so this event is published AFTER the commit by the create handler rather
than raised as a domain event by the factory, which is why naming it is a rename and not a shape
decision.

Passing **any** of the four shape flags also drops the sample's checked-in migration, because that
migration describes the full shape (child table, status column, owner index) and would be wrong on
arrival. Generate your own `InitialCreate` against the shape you asked for;
`Migrations/.editorconfig` still ships, since `dotnet ef` never recreates it.

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
through the outbox, `en-US` and `es` resource pairs, a REST controller, and two Blazor pages. The
child entity and the status axis are optional: see the shape options below.

That is twelve projects. Two of them are decided by the solution-shape options below: the AppHost
disappears under `--no-aspire`, and the migrations project is named for the engine
(`Contoso.Support.Migrations.Sqlite.Orders` under `--database sqlite`).

### Shaping the solution

Two options decide the shape of the **solution** rather than of the module. They compose with each
other and with all six module options, and `--database sqlite --no-aspire` together are the
small-app floor that [Small Apps](common-SMALL-APPS.md) is written about.

| Option | Default | What changes |
|---|---|---|
| `--database sqlserver\|sqlite` | `sqlserver` | The relational engine. Under `sqlite`: entity configurations inherit `EntityTypeConfigurationSqlite`, the migrations project becomes `<App>.Migrations.Sqlite.<Module>` against `Microsoft.EntityFrameworkCore.Sqlite`, the design-time factory becomes `DesignTimeSqliteDbContextFactory` over `SqliteDbContext`, the API host asks for a database rather than for SQL Server specifically (`AddInfrastructureHealthChecks(requireDatabase: true)`), the app is configured single-tenant, and the whole database is one file beside the host. |
| `--no-aspire` | off | No orchestration project: no AppHost, no `Aspire.Hosting.*` pins, and the UI host reaches the API at the fixed dev address `https://localhost:60801` instead of through service discovery. Both hosts keep `AddServiceDefaults()` and `MapDefaultEndpoints()`, so telemetry, `/health` + `/alive` and the resilience pipeline are all still there and adding an AppHost later is additive. |

```powershell
dotnet new mmca-app -n Contoso.Notes --module Notes --aggregate Note --database sqlite --no-aspire
```

Three properties are worth knowing before you pick:

- **`--database` is a swap, not a removal.** Unlike the four module-shape flags, which take an axis
  away, this one exchanges one engine's code for another's. Everything above the configuration base
  is untouched: the same module, handlers, controller and tests build against either engine, which
  is the point of the framework's data-source routing
  ([ADR-018](../adr/018-polyglot-persistence.md)).
- **`--database sqlite` drops the checked-in sample migration**, for the same reason any shape flag
  does and for a second one: those migrations are SQL Server DDL and their model snapshot names
  `SQLServerDbContext`. Run `dotnet ef migrations add InitialCreate` against the generated
  `.Migrations.Sqlite.<Module>` project with `--context SqliteDbContext`, and run it **before the
  first run of the API host**. The generated `DataSources` entry names a `SqliteMigrationsAssembly`,
  and a SQLite source that names one is migrated at startup rather than created outright, so an empty
  migrations assembly leaves the host with an empty database file and a first request that fails on a
  missing table. The generated README says the same thing in its own "Before the first run" section.
- **`--database` reaches `mmca-module`, `--no-aspire` does not, and neither reaches the slice
  templates.** A module is not engine-neutral (its EF configurations inherit an engine-specific
  configuration base and its migrations project references an engine-specific provider), so
  `mmca-module` declares the engine option in its own right and `build/add-module.ps1` passes it
  through. Only the app owns an orchestration project, so `--no-aspire` stays `mmca-app`'s alone;
  `mmca-command` and `mmca-query` carry no engine coupling at all.

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

### The one-time fixup

One thing the scaffold deliberately does not hand over, because renaming invalidates it and no fixed
value is right for every name you could pick.

**Using-directive and alias order.** `using Contoso.Support.Orders.Shared;` sorts above
`MMCA.Common.*`, but `using Zeta.App.Orders.Shared;` sorts below it. `SA1210` has no notion of
blank-line-separated groups, so no checked-in order survives both, and `SA1211` is the same story for
the identifier-alias file, whose aliases sort differently depending on the aggregate and child names
you asked for. Both ship as suggestions, via a clearly marked `SCAFFOLD DELTA` block at the bottom of
the generated `.editorconfig`. Sort them with:

```powershell
dotnet format analyzers Contoso.Support.slnx --diagnostics SA1210 SA1211 --severity info
```

That block relaxes a **third** rule, `IDE0021`, and it is there for the shape flags rather than the
renames: the aggregate's private constructor assigns one property per optional axis, so turning
several of them off can leave it with a single statement, which the baseline would then require you
to write as an expression body. Fold it to an expression body by hand (or add your own second
property) and the line has nothing left to relax. Only those three rules are relaxed; every other
analyzer stays at error severity throughout. Every `mmca-command` / `mmca-query` slice arrives with
the same using skew, so either re-run the format command after scaffolding, or leave the block until
you have stopped scaffolding and then delete the whole thing.

**Why the pack does not run that command for you.** A `dotnet new` run-script post action needs
`--allow-scripts yes` on the command line and **prompts** otherwise, which would stall the pack's own
smoke job and every adopter's scripted generation; it would also run before the solution has been
built. A post action was evaluated on that basis and deliberately not added. The `.editorconfig`
delta plus the command above is the supported answer.

### Your integration-event contract ships frozen

This used to be a second fixup: a subclass to paste in, run once, and fill from the failure. It is
now emitted by the template, holding **your** event under the names you scaffolded with, and it
passes on arrival.

What made that possible is that `IntegrationEventContractTestsBase` compares each event's member
list as a **set** rather than a sequence. JSON carries no member order, so reordering two properties
changes nothing a consumer can observe, and the aggregate's own id moving position in the literal is
no longer a difference. Everything observable is still a failure: a missing member, an extra member,
a changed type, and any change to the set of events itself.

`build/add-module.ps1` appends each new module's integration event to `ExpectedContract` as one of
its wire-ups, so adding a second module does not turn your next test run red either. When you evolve
an event on purpose, version it ([ADR-010](../adr/010-integration-event-schema-versioning.md)) and
update the literal in the same commit; the failure prints the live value to paste:

```powershell
dotnet test --project Tests/Architecture/Contoso.Support.Architecture.Tests/Contoso.Support.Architecture.Tests.csproj `
  -- --filter-class "*IntegrationEventContract*"
```

---

## `mmca-module`

```powershell
cd Contoso.Support
dotnet new mmca-module -n Billing --app Contoso.Support --aggregate Invoice
```

| Parameter | Default | Meaning |
|---|---|---|
| `-n, --name` | none | the module, plural PascalCase, for example `Billing` |
| `--app` | none | your solution / root namespace, for example `Contoso.Support` (required) |
| `-p:a, --aggregate` | none | the module's aggregate root, singular PascalCase (required) |
| `-c, --child` | `Comment` | the aggregate's child entity, singular PascalCase (1.3.0) |
| `--title` | `Title` | the aggregate's main text property, singular PascalCase (1.4.0) |
| `--event-verb` | `Opened` | verb naming the creation integration event, past tense PascalCase (1.4.0) |
| `--flat` | off | generate the module with no child collection at all (1.3.0) |
| `--no-status` | off | generate the module with no status axis (1.3.0) |
| `--no-description` | off | generate the module with no long-text property (1.4.0) |
| `--no-owner` | off | generate the module with no owning-user property (1.4.0) |
| `--database` | `sqlserver` | relational engine for this module: `sqlserver` or `sqlite` (1.7.0) |

The six shape options behave exactly as they do for `mmca-app`, and they are per module: a solution
can hold a flat, status-less catalog module beside one whose aggregate owns a growing child
collection and a guarded lifecycle. The one difference is that `--title` here does not reach UI
resources, because `mmca-module` generates no Blazor pages.

`--database` is the seventh, and it is not a shape option: it **must match the engine the surrounding
solution was generated with**, because the engine decides which configuration base the module's EF
configurations inherit and which provider package its migrations project references, and a module
built for the other engine does not compile in the solution it was added to. Under
`--database sqlite` the migrations project arrives named `.Migrations.Sqlite.<Module>` against
`Microsoft.EntityFrameworkCore.Sqlite`, with a `DesignTimeSqliteDbContextFactory` over
`SqliteDbContext`, and the wire-up instructions it prints name `SqliteMigrationsAssembly`.
`build/add-module.ps1` detects the solution's engine and passes this flag for you.

**If your solution came from `mmca-app`, use `build/add-module.ps1` instead** (below): it runs this
template and then applies every wire-up the template can only print.

```powershell
dotnet new mmca-module -n Orders --app Contoso.Shop --aggregate Order --child Item
```

That produces an `OrderItem` entity and DTO, `AddItem` / `EditItem` / `RemoveItem` slices, `/items`
routes, and an `OrderItemIdentifierType` alias, with no post-generation renaming.

Generates eight projects into the right places: the five layer projects under
`Source/Modules/<Module>/`, both test projects under `Tests/Modules/<Module>/`, and a migrations
project under `Source/Hosting/`. The migrations project ships **without** a `Migrations/` folder: you
create the first one against your own entities.

### The wire-ups it prints

`dotnet new` cannot patch files that already exist, so it prints seven items (the six below plus the
first migration). **`build/add-module.ps1` performs all of them for you**, so read this list as the
manual fallback, or as the answer to "what did that script just do to my solution". Until they are
done the module is invisible to the host and to the fitness rules; the first two are what make it
compile.

1. **Solution.** `dotnet sln <App>.slnx add Source/Modules/<Module>/*/*.csproj Tests/Modules/<Module>/*/*.csproj Source/Hosting/<App>.Migrations.SqlServer.<Module>/*.csproj`
   (bash globbing; in PowerShell expand with `(Get-ChildItem ...).FullName`, as the printed
   instructions now show)
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
6. **Database.** An AppHost database resource plus a `DataSources` entry per module in the Web
   host's appsettings, the top-level migrations-assembly pin deleted, and a top-level
   `"Outbox": { "DatabaseName": "<FirstModule>" }` pin (IEventBus writes handler-published
   integration events to one configured outbox source per host). The
   [ecommerce sample guide](common-ECOMMERCE-SAMPLE.md) walks each edit.

Then create the first migration:

```powershell
dotnet ef migrations add InitialCreate `
  --project Source/Hosting/Contoso.Support.Migrations.SqlServer.Billing `
  --startup-project Source/Hosting/Contoso.Support.Migrations.SqlServer.Billing `
  --context SQLServerDbContext
```

Every path and context name above carries the engine, so on a `--database sqlite` module the project
is `Contoso.Support.Migrations.Sqlite.Billing` and the context is `SqliteDbContext`. There the
migration is required before the next run of the API host rather than optional: a SQLite source that
names a migrations assembly is migrated at startup instead of created outright.

---

## `build/add-module.ps1`

Since **1.4.0** every solution `mmca-app` generates ships this script, and it is the supported way to
add a second module. It runs `mmca-module` with your shape options passed through, then performs the
seven printed wire-ups plus an eighth of its own: the new module's integration event is appended to
`ExpectedContract` in your architecture tests, so the frozen wire contract stays green. The
orchestration step is skipped rather than failed when the solution has no AppHost (a `--no-aspire`
app), where a `DataSources` entry is the whole database wire-up.

```powershell
pwsh build/add-module.ps1 -Name Orders -Aggregate Order -Child Item -EventVerb Placed
```

| Parameter | Maps to | Meaning |
|---|---|---|
| `-Name` | `-n` | the module, plural PascalCase |
| `-Aggregate` | `--aggregate` | the module's aggregate root, singular PascalCase |
| `-Child` | `--child` | rename the child entity |
| `-Title` | `--title` | rename the aggregate's main text property |
| `-EventVerb` | `--event-verb` | verb of the creation integration event |
| `-Flat` | `--flat` | no child collection |
| `-NoStatus` | `--no-status` | no status axis |
| `-NoOwner` | `--no-owner` | no owning-user property |
| `-NoDescription` | `--no-description` | no long-text property |
| `-Database` | `--database` | override the engine the solution is read to be running on: `sqlserver` or `sqlite` (1.7.0) |
| `-SkipMigration` | | print the `dotnet ef migrations add` command instead of running it |

Run it with `-?` for the full help, and run it **from the solution root**: it refuses to run anywhere
else, and everything else it discovers there at run time (the solution file, which is also the app's
root namespace, the modules already present, the relational engine the solution runs on, and the web
host, AppHost and architecture-test projects by glob). Nothing about the app that generated it is
baked in, which is why it ships `copyOnly`,
verbatim, with no token replacement at all: the flag names it passes through have to survive whatever
`--title` / `--event-verb` / `--child` values your solution was generated with.

Four properties worth knowing before you run it:

- **The engine is detected, so `-Database` is the exception rather than the rule.** The script reads
  it off the API host's own `appsettings.json`, from the key spelling inside the top-level
  `ConnectionStrings` section (`SQLServerConnectionString` or `SqliteConnectionString`). That file
  was picked over the alternatives because it is the file the script also **writes**: detecting from
  the same place the new data source is written into is what makes the two impossible to disagree.
  The existing `<App>.Migrations.<Engine>.<Module>` folder is then cross-checked against that
  reading, and a disagreement stops the run rather than adding a project half the solution cannot
  compile against. Pass `-Database` when a solution has grown a second engine and the detection can
  no longer answer for the module you are adding; either way the preflight summary echoes the engine
  and says whether it was read or passed.
- **It fails fast rather than half-applying.** A `Name` already under `Source/Modules` is refused
  before anything is generated, and a `.slnx` count other than one, a missing host project, or an
  ambiguous architecture map all stop the run at preflight.
- **Every edit is anchored, and a missing anchor throws with the manual edit printed.** The edits are
  anchored text insertions, never a parse-and-reserialize round trip, so `git diff` after the run
  shows the added lines and nothing else. If the scaffold's shape has moved (or you reworked a file
  by hand), the script writes nothing and hands you the exact edit to make instead.
- **A rerun is safe.** Each step detects its own work and skips it with a note, so a run that died at
  step 7 can be fixed and rerun from the top.

`-SkipMigration` is worth passing when the module is about to be reshaped: the migration would
describe the scaffolded entities, and you would delete and regenerate it anyway. The script also
degrades to printing the command on its own when the `dotnet-ef` tool is not installed, rather than
failing a run whose other steps landed. On a SQLite solution it warns in both of those cases that the
migration is required before the next run of the API host, since the host migrates a SQLite source
that names a migrations assembly instead of creating it outright.

Two things it deliberately does not do: the Blazor UI pages for the new module, and that module's
page-level localization resources. It prints both reminders when it finishes. The
[ecommerce sample guide](common-ECOMMERCE-SAMPLE.md) is a worked two-module run.

---

## `mmca-command` and `mmca-query`

Run these from the module's `UseCases` folder. Each creates a folder named after the slice holding
its two files.

```powershell
cd Source/Modules/Billing/Contoso.Support.Billing.Application/Billing/UseCases

dotnet new mmca-command -n ArchiveInvoice --app Contoso.Support --module Billing `
  --aggregate Invoice --domain-method Archive

dotnet new mmca-query -n GetInvoiceByNumber --app Contoso.Support --module Billing `
  --aggregate Invoice --child-collection Comments
```

| Parameter | Applies to | Meaning |
|---|---|---|
| `-n, --name` | both | the use case, PascalCase; names the folder, the namespace segment, and both types |
| `--app` | both | your solution / root namespace (required) |
| `-m, --module` | both | the module this slice goes into (required) |
| `-p:a, --aggregate` | both | the aggregate the handler loads (required) |
| `--domain-method` | `mmca-command` | the guarded method the command calls on the aggregate |
| `--child-collection` | both | navigation to eager-load; unset loads the aggregate root alone |

`--child-collection` exists because both handlers load through `GetByIdAsync`, whose `includes:`
argument is **required**: there is always a list, so the only question is what goes in it. Naming a
navigation eager-loads it, and leaving the parameter off passes an empty list. The name goes straight
into `nameof(...)`, so pass one your aggregate actually has (`Comments` is the only one a scaffolded
aggregate owns). Before `MMCA.Templates` 1.1.0 the slices named the reference app's own child
collection unconditionally, which did not compile on an aggregate shaped differently.

Handlers are convention-scanned by Scrutor, so there is no DI registration to add. Two things do
need you:

- **The command slice calls `--domain-method` on your aggregate**, and the scaffold cannot invent it.
  Add that method returning `Result` before the slice compiles, or the generated handler fails with
  `'Invoice' does not contain a definition for 'Archive'`. `dotnet new` prints the same reminder as a
  post-action; the [getting-started guide](common-GETTING-STARTED.md#add-your-next-feature) shows the
  shape to copy.
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
`template-smoke` job generates **three** solutions whose names share no substring with the seed,
sweeps each for residual and for missing tokens, builds package-mode and runs the tests. The three
are shapes rather than names: one with every module axis turned off plus a `--title` rename, one
fully default (which is what makes the absence sweeps non-vacuous), and one solution shape,
`--database sqlite --no-aspire`.

**Two of the three go on to add a second module through `build/add-module.ps1`**, for reasons neither
subsumes. The first proves the **wire-ups**: every edit the script makes, the child rename, the
module-only axes, the slices, and the refused rerun, on the default engine. The sqlite case proves
the **engine reaches the second module**, because `--database` is declared twice, once per
`template.json`, staged by two separate passes, so a module added to a sqlite solution can come out
SQL-Server-shaped with every one of the first case's assertions still green. It asserts what a second
sqlite module has to be: a `.Migrations.Sqlite.<Module>` project with a `DesignTimeSqliteDbContextFactory`
and no SQL Server residue in any of its files, two `DataSources` entries pinned to their own
`SqliteMigrationsAssembly` values and pointing at **separate** files (one shared file would collide
the two modules' outbox tables), the outbox pinned to the first module, a migration created against
`SqliteDbContext`, and a green Release build and test run of the two-module solution. That run is
deliberately thin (no slices, no child rename, no rerun check) to keep the third case's wall clock
down, and only the first case scaffolds slices.

To work on the templates:

```powershell
git clone https://github.com/ivanball/MMCA.Helpdesk
cd MMCA.Helpdesk
pwsh build/templates/smoke.ps1        # stage, pack, install, generate, build, test
```
