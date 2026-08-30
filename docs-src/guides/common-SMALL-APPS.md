# Small Apps: the lowest floor MMCA.Common has

Two `mmca-app` options decide the shape of the **solution** rather than the shape of the sample
module, and together they are the smallest thing the framework generates:

```powershell
dotnet new install MMCA.Templates
dotnet new mmca-app -n Contoso.Notes --module Notes --aggregate Note --database sqlite --no-aspire
```

That is two hosts, one module, one database file, and `dotnet run`. No Docker, no SQL Server, no
orchestrator, and no broker. Everything else is the same framework the two production applications
run on: the same `Result` pipeline, the same CQRS decorators, the same soft delete, audit stamping,
health endpoints and OpenAPI document, and the same extraction path when the app outgrows its own
shape.

This guide is the positioning of that shape: what it costs, what it does not, and which switch to
flip when one of its assumptions stops holding. For the full-shape path (SQL Server, Aspire, six
steps from nothing to a running app) read [Getting Started](common-GETTING-STARTED.md) instead; for
every parameter of every template, the [templates guide](common-TEMPLATES.md).

---

## Why this shape exists

The default `mmca-app` output is a twelve-project solution: five module layers, a REST API host, a
Blazor UI host, an Aspire AppHost, a migrations project, and three test projects. It assumes Docker
is running, because the AppHost provisions SQL Server as a container, and it assumes you want an
orchestrator.

Those assumptions are right for an application that will grow modules, be deployed to Container Apps,
and eventually extract a service. They are the wrong first question for an internal tool, a workshop
sample, a proof of concept, or the app someone wants to read on a plane. Until this release the
framework had one answer for all of them, and it started with "install Docker Desktop".

`--database sqlite --no-aspire` removes the two assumptions and nothing else:

| | Default shape | Small-app shape |
|---|---|---|
| Projects | 12 | 11 (no AppHost) |
| Database | SQL Server in a container | one SQLite file beside the host |
| Startup | `dotnet run` the AppHost | `dotnet run` each host |
| Prerequisites | .NET 10 SDK, Docker Desktop, `dotnet-ef` | .NET 10 SDK and `dotnet-ef` (the first migration is required before the first run) |
| Service discovery | Aspire resolves `web` for the UI | the UI's `Api:BaseAddress` names the API's dev URL |
| Messaging | in-process, with the outbox running | in-process, outbox off (see below) |
| Tenants | two, one of them database-per-tenant | one (`acme`) |

The two options are independent and compose with each other and with every module-shape flag, so
`--database sqlite` on its own is an Aspire solution whose one data source happens to be a file (the
AppHost declares it with `WithSqliteDataSource` and has no container to wait for), and `--no-aspire`
on its own is a two-host SQL Server solution you start yourself.

---

## The five-minute path

### 1. Scaffold

```powershell
dotnet new install MMCA.Templates
dotnet new mmca-app -n Contoso.Notes --module Notes --aggregate Note --database sqlite --no-aspire
cd Contoso.Notes
```

Add `--flat` if the aggregate owns no child collection; the four module-shape flags all still apply
(see the [templates guide](common-TEMPLATES.md#shaping-the-sample-module)).

### 2. Build and test before you change anything

```powershell
dotnet build Contoso.Notes.slnx
dotnet test  --solution Contoso.Notes.slnx
```

Warning-free under all five analyzers with `TreatWarningsAsErrors`, and a passing run of the domain,
application and architecture-fitness tests, with no database. That green line is what you bisect
against later.

### 3. Create the first migration, before the first run

This step is required rather than tidy-up. The scaffold ships the migrations project
(`Source/Hosting/Contoso.Notes.Migrations.Sqlite.Notes`) and its design-time factory but no
migration, because the sample one is SQL Server DDL against a different shape. The generated
`DataSources:Notes` entry names a `SqliteMigrationsAssembly`, and a SQLite source that names one is
**migrated** at startup rather than created outright, so an empty migrations assembly leaves you with
an empty file and a first request that fails on a missing table.

```powershell
dotnet ef migrations add InitialCreate `
  --project Source/Hosting/Contoso.Notes.Migrations.Sqlite.Notes `
  --startup-project Source/Hosting/Contoso.Notes.Migrations.Sqlite.Notes `
  --context SqliteDbContext
```

`--context SqliteDbContext` because there is exactly one concrete context class per engine; module
contexts are abstract and only declare their `DbSet`s
([ADR-006](../adr/006-database-per-service.md)). `dotnet ef` is a global tool rather than part of the
SDK: install it with `dotnet tool install --global dotnet-ef` if the command is not found. The
design-time factory in that project opens no connection for `migrations add`, so this needs no
running database, and every later schema change is the same two steps: add the migration, restart the
host.

### 4. Run the API

```powershell
dotnet run --project Source/Hosts/Contoso.Notes.Web
```

The host listens on `https://localhost:60801` (and `http://localhost:60802`), from its own
`Properties/launchSettings.json`. On startup it applies the migrations to `notes.db` beside the host,
under the generated `DatabaseInitStrategy: "Migrate"`. `EnsureCreated` is what a SQLite source gets
only when no migrations assembly is configured for it, which is not the shape this scaffold
generates.

`GET /health` and `/alive` are live, the health check gates readiness on the SQLite connection, and
the API root `/` has no page and returns 404 by design.

### 5. Call it, with the tenant header

The generated app has tenancy enabled with one tenant, `acme`, and resolution is claim first then the
`X-Tenant-Id` header. It runs issuer-less, so no request carries a claim: **send the header on every
write.**

```bash
curl -k -X POST https://localhost:60801/Notes \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: acme" \
  -d '{"title":"First note","description":"Written by curl","requesterUserId":1}'

curl -k -H "X-Tenant-Id: acme" https://localhost:60801/Notes
```

Expect 201 then 200, with audit fields stamped, soft-deleted rows filtered out, and the `Note`
aggregate's creation integration event dispatched in process.

### 6. Browse the UI

```powershell
dotnet run --project Source/Hosts/UI/Contoso.Notes.UI.Web
```

In a second terminal, with the API already up: the UI's first page render calls it. The Blazor host
reads the API address from `Api:BaseAddress` in its own `appsettings.json`, fixed at the API's
development URL, and sends `X-Tenant-Id` from `Api:TenantId` (default `acme`) on every call, so the
browser path needs no header from you. Change the API's port in `launchSettings.json` and change
`Api:BaseAddress` with it.

---

## What you get anyway

Nothing in the framework is disabled by this shape. The application code is identical to the
SQL-Server-plus-Aspire output: the engine is a configuration-base choice plus a connection string,
which is what [ADR-018](../adr/018-polyglot-persistence.md) exists to make true.

- **The `Result` pattern end to end** ([ADR-013](../adr/013-result-pattern.md)): expected failures
  are values with a transport-agnostic `ErrorType`, mapped to RFC 9457 ProblemDetails at the edge and
  read back into typed errors by the UI's own client, which returns `Result` and throws nothing for a
  server answer ([ADR-094](../adr/094-client-entity-data-access.md)).
- **The CQRS decorator pipeline** ([ADR-014](../adr/014-cqrs-decorator-pipeline.md)): feature gate,
  authorization, logging, caching, validation, timeout and transaction, in that order, wrapped around
  convention-scanned handlers, with the ordering sealed so a late registration throws instead of
  going unwrapped.
- **Soft delete with filtered unique indexes** ([ADR-005](../adr/005-soft-delete-vs-erasure.md),
  [ADR-095](../adr/095-soft-delete-unique-indexes.md)) and audit fields stamped by the context on
  every save.
- **Optimistic concurrency** ([ADR-035](../adr/035-optimistic-concurrency.md)): the `RowVersion`
  round trip and its 409 / 412 answers.
- **Health, telemetry and resilience.** Both hosts still call `AddServiceDefaults()` and
  `MapDefaultEndpoints()`, so OpenTelemetry, `/health` + `/alive`, warm-up readiness
  ([ADR-025](../adr/025-startup-warmup-readiness.md)) and the standard HTTP resilience handler
  ([ADR-009](../adr/009-resilience-and-recovery-objectives.md)) are all present with no orchestrator
  above them. That is what makes adding an AppHost later additive.
- **The architecture fitness functions** ([ADR-015](../adr/015-architecture-fitness-functions.md)),
  including your own frozen integration-event wire contract, which the template now emits already
  passing.
- **The generic entity surface** ([ADR-034](../adr/034-generic-entity-query-layer.md)): list, paged,
  lookup, by-id, CSV export, sparse fieldsets, dynamic filters, sort and pagination, inherited by
  every entity. Aggregates you add later can also take the generic write side
  ([ADR-099](../adr/099-generic-write-side-entity-commands.md)) and skip the create, update and
  delete handlers entirely; the scaffolded module keeps its hand-written ones, because they are what
  the reference app exists to show you.
- **Multi-tenancy, audit trail and the scheduled-job runner**, all switched on in the generated
  `appsettings.json` and all running against the one SQLite file.

---

## What is deliberately off

- **The transactional outbox.** With in-process messaging (the default, since no `MessageBus:Provider`
  is configured) the outbox resolves off: events are dispatched inside the process that raised them,
  no `OutboxMessages` rows are written, and neither `OutboxProcessor` nor `OutboxCleanupService`
  starts. The host says so once at startup, naming what that costs (a failed handler is not retried,
  and a crash between the commit and the dispatch loses the event) and the setting that restores it.
  The table stays part of the model, so turning it on is a restart and never a migration
  ([ADR-100](../adr/100-outbox-opt-in-resolved-from-messaging-mode.md)).
- **A broker.** No RabbitMQ, no Azure Service Bus, and therefore no consumer-side inbox either: there
  is no redelivery to deduplicate ([ADR-021](../adr/021-consumer-inbox-idempotency.md)).
- **An Identity module.** The app runs issuer-less: it registers a bare authentication scheme and the
  generated controller is `[AllowAnonymous]`, so nothing blocks the first call. Permission-gated
  commands are denied rather than allowed if you declare one without registering a registry, and the
  framework logs that misconfiguration the first time a permission is actually checked.
- **A second tenant.** The SQL Server output demonstrates both isolation modes (shared schema and
  database per tenant); the SQLite output configures one tenant, because database per tenant needs a
  second server-backed database.
- **Redis, output caching at the edge, and a gateway.** All configuration-gated in the framework and
  unconfigured here: caching falls back to the in-memory store
  ([ADR-026](../adr/026-caching-strategy.md)).

---

## Adding a second module

`mmca-module` takes `--database sqlserver|sqlite`, and a solution generated by `mmca-app` adds its
modules through `build/add-module.ps1`, which reads the engine off the API host's own
`appsettings.json`: the key spelling inside the top-level `ConnectionStrings` section
(`SQLServerConnectionString` or `SqliteConnectionString`) is the detection, and it is the same file
the script writes the new data source into, so the two cannot disagree. The existing
`<App>.Migrations.<Engine>.<Module>` folder is cross-checked against that reading, and a
disagreement stops the run rather than adding a project half the solution cannot compile against.
`-Database sqlserver|sqlite` overrides both, which is the answer for a solution that has grown a
second engine.

So a second module on a SQLite app is SQLite-shaped end to end: its EF configurations inherit
`EntityTypeConfigurationSqlite`, its migrations project is `<App>.Migrations.Sqlite.<Module>` over
`Microsoft.EntityFrameworkCore.Sqlite` with a `DesignTimeSqliteDbContextFactory`, and its
`DataSources` entry names its own file plus its own `SqliteMigrationsAssembly`. Each module gets its
own file rather than sharing one, which is database per module on this engine too: the framework
tables a source carries (its own `OutboxMessages` among them) stay inside it. The script creates the
module's first migration as its last step; `-SkipMigration` defers it, which is a deliberate decision
on this engine for the reason step 3 gives, since the host migrates that source at startup instead of
creating it.

---

## Two limitations worth knowing before you start

**1. Writes need the `X-Tenant-Id` header.** The generated app enables tenancy with
`RequireTenant: false`, so an unresolved caller reads across tenants, but a **write** with no tenant
resolved is refused rather than inserting an untenanted row (the column is not nullable). The refusal
reaches the caller as a **400** carrying RFC 9457 ProblemDetails titled "Tenant write rejected",
whose detail names what to do (supply the configured tenant claim or header) and deliberately echoes
back neither the entity type nor any tenant id. Send `X-Tenant-Id: acme` on every write, as the
quickstart above does and as the UI host already does. Removing the header requirement means either
giving the app a real issuer whose tokens carry a `tenant_id` claim, or turning tenancy off in
`appsettings.json`.

**2. It is a development shape, not a deployment posture.** One file, and one process writing to it.
Nothing here says a SQLite host cannot be deployed, only that this guide does not describe how, and
that the framework's deployment story ([ADR-030](../adr/030-startup-sole-migrator.md),
[ADR-093](../adr/093-container-image-posture.md)) is written for the SQL Server shape.

---

## When to flip each switch

Each of these is additive: the code you have written does not change, and the change is confined to
configuration or to a host project.

| Signal | Switch | What it costs |
|---|---|---|
| More than one writer process, or a real deployment target | **SQL Server**: `--database sqlserver` on a new scaffold, or swap the entity configuration bases and connection string on an existing one | A container or a server, and the migrations project's provider. The module code is unchanged: the engine is a configuration-base choice ([ADR-018](../adr/018-polyglot-persistence.md)). |
| A third process to start, or you want the dashboard, service discovery and health-based startup ordering | **Aspire**: add an AppHost project that references the two hosts, and replace the UI's fixed `Api:BaseAddress` with `WithReference` | One project. Both hosts already call `AddServiceDefaults()`, which is the half that would have been a rewrite ([ADR-098](../adr/098-aspire-orchestration-not-testing-or-dashboards.md)). |
| An event must survive a crash, or a handler failure must be retried | **The outbox**: `MessageBus:EnableOutbox=true` | A restart. Two background services and a poll loop start; the table is already in the model, so there is no migration ([ADR-100](../adr/100-outbox-opt-in-resolved-from-messaging-mode.md)). |
| A second process must consume your events | **A broker**: configure `MessageBus:Provider` | The broker itself. The outbox then resolves ON automatically and the inbox with it; explicitly disabling the outbox under a broker is refused at startup ([ADR-003](../adr/003-outbox-dual-dispatch.md), [ADR-021](../adr/021-consumer-inbox-idempotency.md)). |
| Real users, roles, or a per-user tenant claim | **An Identity module**: copy MMCA.Store's or MMCA.ADC's and rename the namespaces, set `Authentication:JwtBearer:Authority`, switch the controller to `[Authorize]` | The module and its database. It also retires limitation 1 above, because the tenant then arrives as a claim ([ADR-004](../adr/004-authentication-dual-fetch.md), [ADR-020](../adr/020-permission-based-authorization.md)). |
| One module needs its own scaling, deploy cadence, or database | **Extraction**: a service host, a gateway, per-service databases and JWKS discovery | Host wiring only. Domain, Application, Shared, Infrastructure and API code do not change, which is the promise the whole shape exists to keep ([ADR-008](../adr/008-service-extraction-topology.md)). Extract on an observable constraint, not on principle. |

---

## Where to look next

- **[Getting started](common-GETTING-STARTED.md)**: the full-shape path, in six steps, with Aspire
  and SQL Server.
- **[Templates](common-TEMPLATES.md)**: every parameter of all four templates, including the two
  solution-shape options this guide is about.
- **[Building by hand](common-BUILD-BY-HAND.md)**: what the generated code does, phase by phase, and
  the route for retrofitting a solution the template cannot create.
- **[MMCA.Helpdesk](https://github.com/ivanball/MMCA.Helpdesk)**: the reference app the template is
  staged from, so what you generated is that repository under your own names.
- **The ADRs** ([index](../adr/README.md)): the reasoning behind every pattern above.
