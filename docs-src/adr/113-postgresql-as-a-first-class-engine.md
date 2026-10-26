# ADR-113: PostgreSQL as a First-Class Engine

## Status
Accepted (2026-09-09). Extends [ADR-006](006-database-per-service.md) (one sealed context class per
engine) and [ADR-018](018-polyglot-persistence.md) (engine as a routing decision) with a fourth
engine. Revised 2026-10-01 (the Helpdesk canary and the `--database postgresql` template choice
are shipped, the canary as an advisory template-generated job; see Revision below). Revised
2026-10-06: engine behavior is delegated to a `PostgreSQLDataSourceEngine` in the `DataSourceEngines`
registry rather than per-site switch arms. Revised 2026-10-07: anchors refreshed after the
v1.233.0 release. Revised 2026-10-21: anchors refreshed after the v1.250.0 release and the
Helpdesk template-staging changes. Revised 2026-10-25: PostgreSQL connection customization goes
through `INpgsqlDataSourceConfigurator`, one shared `NpgsqlDataSource` per connection string for the
context, the readiness check and the PostgreSql broker, with the RDS and Cloud SQL IAM token
providers as its users; decisions 2 and 8 are extended and decision 10 is new. See Revision
(2026-10-25) at the end. Revised 2026-10-26: decision 4 corrected (SQLite quotes outbox filter
columns with double quotes like PostgreSQL, and only SQL Server and Cosmos answer brackets), decision
9 gains the periodic-password-provider test, and anchors refreshed after the v1.257.0 and v1.261.0
releases.

## Context
The framework has shipped three database engines since its first release: SQL Server, Azure Cosmos DB
and SQLite. Every one of them is reached the same way, because [ADR-006](006-database-per-service.md)
fixed the shape: **one sealed `DbContext` class per engine, one instance per physical database**, over
the abstract `ApplicationDbContext`. [ADR-018](018-polyglot-persistence.md) then made polyglot
persistence a routing decision rather than a rewrite: an entity declares its engine on its
configuration base class, and `DataSourceResolver` / `EntityDataSourceRegistry` decide which physical
database it lands in.

PostgreSQL was absent from that list, and its absence is not a technical gap so much as an
evaluation one. In the 2026-09-09 framework gap analysis, a survey of ten "top .NET open-source
backend" lists used to position this framework, PostgreSQL is named in six and is the default engine
in most of the repositories studied. A reader who runs on PostgreSQL, sees SQL Server / Cosmos /
SQLite and stops reading has never reached the architecture the framework is actually about. The
engine list is the first filter, and the framework was failing it.

The one-context-per-engine design is what makes closing that gap contained rather than invasive. A
new engine is not a new abstraction: it is a configuration base, a sealed context, a design-time
factory, one engine class in the `DataSourceEngines` registry, an AppHost extension and a health
check. Nothing in Domain, Application, or any consumer's handler code has an opinion about it.

Three things about PostgreSQL are genuinely different from the engines already supported, and each
one produces a runtime failure rather than a compile error:

1. **Identifier quoting inside index predicates.** The framework's outbox declares three partial
   indexes whose filters were written as SQL Server literals (`[ProcessedOn] IS NULL`). SQLite
   accepts bracketed identifiers for SQL Server compatibility; PostgreSQL rejects them outright, at
   `CREATE INDEX`.
2. **Boolean comparison.** The soft-delete predicate is `IsDeleted = 0`. On PostgreSQL the column is
   a real `boolean`, and comparing one with an integer is a type error, so the partial unique index
   that lets a soft-deleted row free its unique slot never gets created at all.
3. **Timestamp kinds.** Npgsql maps `DateTime` to `timestamp with time zone` and refuses to write a
   value whose `Kind` is not `Utc`. The framework's own stamps are always UTC (the audit interceptor
   uses `TimeProvider.GetUtcNow().UtcDateTime`), but a consumer's own property, a value deserialized
   from JSON, or a value read from a legacy row can arrive `Unspecified`, and that single value
   throws at save time.

Every one of those builds a perfectly valid EF model. A model-level test cannot see any of them.

## Decision
**PostgreSQL is added as a fourth first-class engine, mirroring the SQL Server footprint one for one,
and differing from it only where the server forces a difference.**

1. **The engine enum grows by one member, appended.** `DataSource.PostgreSQL`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:16-22`)
   is declared last rather than alphabetically. The three existing members are shipped public API
   with fixed ordinal values (`CosmosDB = 0`, `Sqlite = 1`, `SQLServer = 2`), and renumbering them
   would break every consumer that persisted or serialized one. The addition is purely additive:
   no existing public signature changes.

2. **One sealed context, built like the SQL Server one.** `PostgreSQLDbContext`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:24`)
   calls `UseNpgsql` with the resolved connection string, the per-source migrations assembly, the
   configured command timeout and the same retry-on-failure posture `SQLServerDbContext` uses
   (`OnConfiguring` at `PostgreSQLDbContext.cs:56-80`, `ConfigureNpgsql` at `:82-106`, retry at
   `:102-105`), and suppresses `PendingModelChangesWarning` for the same microservice-extraction
   reason (`PostgreSQLDbContext.cs:77`). Everything else the engine
   contributes lives in one `PostgreSQLDataSourceEngine`
   (`.../Persistence/DataSources/Engines/PostgreSQLDataSourceEngine.cs:17`), registered in the
   `DataSourceEngines` registry (`.../DataSources/Engines/DataSourceEngines.cs:19-28`):
   `PhysicalDbContextFactory` delegates to its `CreateDbContext`
   (`.../DbContexts/Factory/PhysicalDbContextFactory.cs:32`, `PostgreSQLDataSourceEngine.cs:85`) and
   `ApplyConfigurationsForEntitiesInContext` reads its `EntityConfigurationInterface`
   (`.../DbContexts/ApplicationDbContext.cs:962`, `PostgreSQLDataSourceEngine.cs:30`). When an
   `INpgsqlDataSourceConfigurator` is registered, `UseNpgsql` receives the shared `NpgsqlDataSource`
   for the physical source's connection string instead of the string itself; with none registered the
   connection-string call is unchanged
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:63-71`,
   decision 10).

3. **The mapping is the SQL Server mapping, not PostgreSQL house style.**
   `EntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationPostgreSQL.cs:21-22`)
   is a shim carrying `[UseDataSource(DataSource.PostgreSQL)]`, exactly like its SQL Server and
   SQLite peers, and the engine-aware base delegates to the engine's `ApplyKeyAndTableMapping`
   (`EntityTypeConfiguration.cs:77`), where PostgreSQL applies the SAME mapping as SQL Server
   (`PostgreSQLDataSourceEngine.cs:92`): a table per entity inside the module schema, PascalCase identifiers, an identity key. Moving an
   entity between the two engines is a base-class change with no configuration-body edits, which is
   the ADR-018 promise. **No `snake_case` naming convention is imposed.** A naming-convention plugin
   is a host-level choice with real migration consequences, and imposing one would make the two
   engines' schemas diverge for a reason that has nothing to do with either engine's capabilities.

4. **The two predicate differences are handled at their single source.** `SoftDeleteFilterSql.Build`
   answers `"IsDeleted" = false` for PostgreSQL and keeps `[IsDeleted] = 0` for SQL Server
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:35`,
   delegating to the engine's `BuildSoftDeleteFilter`, PostgreSQL at
   `PostgreSQLDataSourceEngine.cs:116`),
   so the automatic convention and the opt-in `HasSoftDeleteFilter` extension can never disagree.
   The outbox filters are built through one `QuoteColumn` helper
   (`.../DbContexts/ApplicationDbContext.cs:619-620`, delegating to
   `SoftDeleteFilterSql.QuoteColumn` at `SoftDeleteFilterSql.cs:70-71` and on to the engine) that
   returns brackets for SQL Server (`.../DataSources/Engines/SQLServerDataSourceEngine.cs:114`) and
   SQL-standard double quotes for PostgreSQL (`PostgreSQLDataSourceEngine.cs:113`) and SQLite
   (`SqliteDataSourceEngine.cs:112`, whose soft-delete filter is `"IsDeleted" = 0` at `:115`).
   Cosmos answers brackets too (`CosmosDataSourceEngine.cs:114`) but builds no soft-delete filter
   (`null` at `:117`). `IncludeColumns` (`.../DbContexts/ApplicationDbContext.cs:645-649`) asks the
   engine for the provider's own `IncludeProperties` overload (`PostgreSQLDataSourceEngine.cs:109-110`),
   so each provider gets its own form.

5. **Timestamps are normalized in the model, never with the process-wide switch.**
   `PostgreSQLDbContext.ConfigureConventions` maps every `DateTime` (and, through the same entry,
   every `DateTime?`) to `timestamp with time zone` through `UtcDateTimeConverter`
   (`PostgreSQLDbContext.cs:116-126`, the `DateTime` mapping at `:123-125`,
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/UtcDateTimeConverter.cs:25-40`).
   The converter treats `Unspecified` as already-UTC (the framework's own convention) and genuinely
   converts a `Local` value rather than relabelling it. **`Npgsql.EnableLegacyTimestampBehavior` is
   deliberately NOT used**: it is an `AppContext` switch that changes the mapping for every Npgsql
   connection in the process, including ones the framework does not own, and it stores timestamps
   without a time zone, which loses the guarantee that a stored audit stamp means UTC.

6. **A PostgreSQL source migrates only when it names a migrations assembly.**
   `PhysicalDataSource.UsesMigrations` answers true for PostgreSQL only when
   `PostgreSQLMigrationsAssembly` is set (`.../DataSources/PhysicalDataSource.cs:42-48`, the engine
   declaring `MigrationPolicy.WhenAssemblyConfigured` at `PostgreSQLDataSourceEngine.cs:40`), which is
   the SQLite rule rather than the SQL Server one. SQL Server always migrates because hosts have
   depended on that since the first release; PostgreSQL ships with no such host, so a source with
   nothing to apply is created outright by `DatabaseInitializationExtensions`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:90-105`)
   instead of being migrated into an empty schema. `DesignTimeDbContextHelper.CreatePostgreSQL`
   (`.../DbContexts/Design/DesignTimeDbContextHelper.cs:74`) scaffolds the migrations when a host
   wants them.

7. **Configuration keys mirror SQL Server's, per engine.** `PostgreSQLConnectionString` and
   `PostgreSQLMigrationsAssembly` exist on both the top-level `ConnectionStrings` section and each
   named `DataSources` entry, and the resolver reads each engine's OWN top-level migrations assembly,
   so a mixed-engine host can never scaffold its PostgreSQL Default source from the SQL Server
   snapshot. Per-tenant routing takes `PostgreSQLConnectionString` too. In the resolver's substitute
   ordering (which serves the framework's own SQL-Server-defaulted tables on a single-engine host)
   PostgreSQL sits between SQL Server and SQLite: a host that configures a server engine means it to
   carry the outbox, inbox, scheduler and audit-trail tables.

8. **Readiness and orchestration are peers, not extras.**
   `AddInfrastructureHealthChecks()` registers an `AddNpgSql` check per declared PostgreSQL database
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Health.cs:238-243`, through
   `PostgreSqlHealthCheckRegistration.Register` at `:242`, which wraps `AddNpgSql` at
   `.../Health/PostgreSqlHealthCheckRegistration.cs:32-33`), named `postgresql` for the first one
   (`Extensions.Health.cs:273`), and `WithPostgreSQLDataSource(database, logicalName)`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:561`) wires a service
   project to its own `PostgresDatabaseResource` with the same reference / `WaitFor` / environment
   shape `WithSQLServerDataSource` uses. **No Aspire client integration is added**
   (`Aspire.Npgsql.EntityFrameworkCore.PostgreSQL`), because the SQL Server path does not use one
   either: the framework owns its own context construction, and taking an Aspire client package for
   one engine and not the others would make the two paths asymmetric for no gain. When a configurator
   is registered the check probes through the same shared data source, which it resolves as a keyed
   service by connection string
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Health/PostgreSqlHealthCheckRegistration.cs:45`), so
   MMCA.Common.Aspire reaches it without referencing MMCA.Common.Infrastructure
   (`.../DbContexts/NpgsqlDataSources.cs:13-16`).

9. **The engine is proved against a real server, not a model.**
   `Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests` is a Testcontainers project outside
   `MMCA.Common.slnx` (the posture `Tests/Core/MMCA.Common.Infrastructure.Redis.Tests` established:
   Docker-gated, own CI job, kept out of the fast solution-wide unit loop), run by the
   `postgresql-integration` CI job (`MMCA.Common/.github/workflows/ci.yml:822`). It creates the whole
   schema, round-trips an auditable entity's UTC audit stamps (`PostgreSQLPersistenceTests.cs:119-120`),
   proves a soft-deleted row is hidden (`:145-146`) AND frees its unique slot (`:179-180`), writes and
   drains the outbox row of a local domain event, and writes the outbox row of an integration event
   and asserts it stays pending for `OutboxProcessor`
   (`Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests/PostgreSQLPersistenceTests.cs:204-248`).
   The three failures listed in the Context section are each caught by one of those, and by nothing
   in the unit tier. A further test authenticates through a periodic password provider on the
   configured data source (`PostgreSQLPersistenceTests.cs:254-255`, decision 10).

10. **Connection customization is one extension point, and cloud IAM authentication is its two users.**
    `INpgsqlDataSourceConfigurator`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/INpgsqlDataSourceConfigurator.cs:23`,
    `Configure` at `:27`) is registered through `AddNpgsqlDataSourceConfigurator`
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Persistence.cs:24`), which
    adds a keyed `NpgsqlDataSource` singleton whose key is the connection string (`:32-34`). The
    container therefore builds one data source per distinct connection string, runs every registered
    configurator on its builder and disposes it (`.../DbContexts/NpgsqlDataSources.cs:8-11`, `:42-56`),
    and `PostgreSQLDbContext`, the readiness check and the PostgreSql broker transport
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlBrokerTransport.cs:94-102`,
    [ADR-066](066-broker-transport-selection.md)) all resolve the same instance
    (`NpgsqlDataSources.cs:29-32`). With none registered nothing is built and every path keeps the raw
    connection string (`INpgsqlDataSourceConfigurator.cs:12-13`, `NpgsqlDataSources.cs:15-16`); SQL
    Server, SQLite and Cosmos sources never reach a configurator (`INpgsqlDataSourceConfigurator.cs:19-20`).
    Two adapter calls register one: `AddAwsRdsIamAuthentication`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:107`, gated on
    `Rds:IamAuthentication:Enabled`, `MMCA.Common/Source/Hosting/MMCA.Common.Aws/Rds/RdsIamAuthenticationSettings.cs:11`, `:14`)
    and `AddCloudSqlIamAuthentication`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:90`, gated on
    `CloudSql:IamAuthentication:Enabled`, `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/CloudSql/CloudSqlIamAuthenticationSettings.cs:13`, `:16`).
    Each hands Npgsql a periodic password provider
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Rds/RdsIamAuthenticationConfigurator.cs:39`,
    `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/CloudSql/CloudSqlIamAuthenticationConfigurator.cs:54`)
    that retries a failed fetch after 30 seconds (`RdsIamAuthenticationConfigurator.cs:27`,
    `CloudSqlIamAuthenticationConfigurator.cs:29`). The RDS token refreshes every 10 minutes
    (`RdsIamAuthenticationConfigurator.cs:24`). The Cloud SQL token, an OAuth2 access token for the
    `sqlservice.login` scope (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/CloudSql/CloudSqlAccessTokenSource.cs:15`),
    refreshes every minute (`CloudSqlIamAuthenticationConfigurator.cs:26`) because Google's credential
    hands out its cached token until fewer than 225 seconds remain and blocks for a new one only under
    60, while Npgsql reuses whatever it was handed for the whole interval (`:16-21`). Both send the token
    as the password, so both reject a connection string below `SSL Mode=Require`
    (`RdsIamAuthenticationConfigurator.cs:110-117`, `CloudSqlIamAuthenticationConfigurator.cs:100-107`)
    and expect no password in it (`MMCA.Common/CHANGELOG.md:77`, `:83`). Neither reaches SQL Server:
    RDS and Cloud SQL offer no IAM database authentication for it
    (`AwsServiceCollectionExtensions.cs:98`, `GcpServiceCollectionExtensions.cs:80`), so an RDS SQL
    Server password connection string stays in Secrets Manager (`MMCA.Common/CHANGELOG.md:77`). The
    PostgreSQL tier covers a periodic password provider and the PostgreSql broker transport
    (`MMCA.Common/CHANGELOG.md:90`).

### Rollout: the Helpdesk canary and the template axis
Both live in MMCA.Helpdesk, outside the framework: a framework capability lands in a release, and a
consumer adopts it after that release, which is the same order every other framework change has
taken.

1. **MMCA.Helpdesk canary.** The `postgresql-canary` CI job
   (`MMCA.Helpdesk/.github/workflows/ci.yml:146-155`) is ADVISORY: `continue-on-error: true` and not
   a required check, so it reds for visibility without failing the run. It runs
   `build/templates/canary-postgresql.ps1`, which generates an app with `--database postgresql`,
   builds and tests it in package mode against the released framework, scaffolds its first migration
   and applies it to a `postgres:17` service container (`ci.yml:157-158`, `ci.yml:191-195`), then
   asserts the schema landed (`ci.yml:202-208`). The seed itself stays SQL Server: no
   `Migrations.PostgreSQL` project is checked in, entity configurations reach
   `EntityTypeConfigurationPostgreSQL` through the template rename, and the AppHost's
   `WithPostgreSQLDataSource` branch is injected at staging time
   (`MMCA.Helpdesk/build/templates/stage.ps1:428-475`).
2. **Template axis.** `MMCA.Helpdesk/.template.config/template.json` carries a `database` choice
   parameter with `sqlserver`, `sqlite` and `postgresql` (`template.json:264`) and two derived
   symbols, `engineName` and `engineNameUpper`, that rename the migrations project, the provider
   package ids, the design-time helper call, the context class, the configuration base and the
   connection-string settings. For `--database postgresql` both derive `PostgreSQL`
   (`template.json:74-91`): the framework spells this engine the same way in both positions, which is
   the one place this choice is simpler than the other two. The two package ids the rename cannot
   reach (the EF provider and the readiness check) are injected by `stage.ps1:489-520`.

## Rationale
The shape follows from the alternatives that were weighed and declined:

- **A `snake_case` naming convention by default.** Rejected. It is the PostgreSQL community norm, but
  it would make the same entity produce two different schemas depending on engine, break the
  "change the base class and nothing else" property this framework sells, and force a consumer
  migrating between engines into a full rename migration. A host that wants it adds a naming plugin;
  the framework does not decide it.
- **`Npgsql.EnableLegacyTimestampBehavior = true`.** Rejected: a process-wide `AppContext` switch that
  reaches connections the framework does not own, and it stores `timestamp without time zone`, which
  gives up the guarantee that a stored stamp means UTC. A model-scoped converter has the same effect
  with none of the blast radius.
- **`xmin` as the concurrency token.** Rejected for now. Npgsql's `UseXminAsConcurrencyToken()` is the
  native answer, but the framework's `RowVersion` is a declared `byte[]` property on
  `AuditableBaseEntity`, and mixing a shadow system column with it would make PostgreSQL the one
  engine whose entity shape differs. PostgreSQL takes the same application-managed concurrency token
  SQLite already uses ([ADR-035](035-optimistic-concurrency.md)).
- **A shared `RelationalDbContext` base for SQL Server and PostgreSQL.** Rejected:
  [ADR-006](006-database-per-service.md) is explicit that the context class is per ENGINE, and the two
  contexts differ in provider call, retry API and conventions. A shared base would save a dozen lines
  and add an inheritance level the extraction story has to reason about.
- **An Aspire client integration (`Aspire.Npgsql.EntityFrameworkCore.PostgreSQL`).** Rejected for
  symmetry: the SQL Server path takes no equivalent package, and the framework constructs its own
  contexts per physical source, which is precisely what the Aspire client integration would try to
  own.

## Trade-offs
- **Every consumer's package graph gains `Npgsql.EntityFrameworkCore.PostgreSQL`.** It is referenced
  unconditionally from `MMCA.Common.Infrastructure`, exactly as the Cosmos, SQLite and SQL Server
  providers are: a host that configures no PostgreSQL connection string never builds the context, so
  the cost is one entry in a lock file. `AspNetCore.HealthChecks.NpgSql` and a direct `Npgsql` pin
  land on `MMCA.Common.Aspire` for the readiness check, and `Aspire.Hosting.PostgreSQL` on
  `MMCA.Common.Aspire.Hosting` for the resource type.
- **Npgsql versions on its own cadence.** Its package tracks the EF Core MAJOR (10.x) rather than the
  exact patch the Microsoft-owned providers share, so the dependency sweep must not expect one
  version across all four providers.
- **The engine set is enumerated in one place.** Engine-specific behavior lives in one
  `IDataSourceEngine` implementation per engine, listed once in the `DataSourceEngines` registry
  (`.../DataSources/Engines/DataSourceEngines.cs:19-28`), and every former switch site asks
  `DataSourceEngines.For(engine)` instead. That is the containment the one-context-per-engine
  design buys: a fifth engine is one new engine class plus one registry line
  (`DataSourceEngines.cs:15-16`), and an unregistered value throws at `For`
  (`DataSourceEngines.cs:40-43`).
- **A namespace-cycle constraint surfaced.** Passing the engine into `ConfigureScheduler`'s model
  lambda by reading it off the context made that lambda capture `this`, which the compiler emits as
  a method ON `ApplicationDbContext` whose `EntityTypeBuilder<ScheduledJobEntry>` parameter reflects
  as a `Persistence -> Scheduling` reference and widens the one accepted namespace cycle. The engine
  is read into a local before the lambda instead. The fitness rule
  ([ADR-015](015-architecture-fitness-functions.md)) caught it; the note is recorded so the next
  engine does not rediscover it.
- **No shipped application runs on PostgreSQL.** The framework's own tier proves the provider and
  the advisory Helpdesk canary above proves a generated `--database postgresql` app builds and
  migrates against a real server, but the Helpdesk seed, ADC and Store all stay on SQL Server
  (none of their `Source/` trees derives from `EntityTypeConfigurationPostgreSQL`).

## Revision (2026-10-01)
The two rollout follow-ups are no longer plans. The Helpdesk canary ships as the advisory
`postgresql-canary` job (`MMCA.Helpdesk/.github/workflows/ci.yml:146-155`, `continue-on-error`,
not a required check), and its shape differs from the one first proposed: instead of a checked-in
`MMCA.Helpdesk.Migrations.PostgreSQL.Tickets` project and an AppHost edit in the seed, it generates
an app with `--database postgresql` through `build/templates/canary-postgresql.ps1`, scaffolds the
first migration and applies it to a `postgres:17` container, with the `WithPostgreSQLDataSource`
branch injected by `MMCA.Helpdesk/build/templates/stage.ps1:430-451`. The template's `postgresql`
choice is shipped (`MMCA.Helpdesk/.template.config/template.json:264`, both derived symbols
`PostgreSQL` at `template.json:74-91`). Decision 9 is corrected: the framework tier drains the
outbox row of a local domain event only and asserts an integration event's row stays pending
(`Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests/PostgreSQLPersistenceTests.cs:217-260`).
The trade-off on consumer coverage now says what remains true: no shipped application runs on the
engine. Citations refreshed: `PostgreSQLDbContext.cs:51-82` (retry `:74-77`, warning `:82`),
`ApplicationDbContext.cs:961`, `:619-620` and `:645-651`, `PhysicalDataSource.cs:41-47`, the
readiness check moved to `MMCA.Common.Aspire/Extensions.Health.cs:232` and `:263`, and the
`postgresql-integration` job to `ci.yml:881`. The engine decision and its rationale are unchanged.

## Revision (2026-10-06)
- Engine-specific behavior no longer sits in per-site switches over `DataSource`: it lives in
  `PostgreSQLDataSourceEngine` (`.../DataSources/Engines/PostgreSQLDataSourceEngine.cs:17`), one of
  four `IDataSourceEngine` classes listed in the `DataSourceEngines` registry
  (`DataSourceEngines.cs:19-28`). Decisions 2, 3, 4 and 6 now name the delegation
  (`PhysicalDbContextFactory.cs:32`, `ApplicationDbContext.cs:955`, `EntityTypeConfiguration.cs:77`,
  `SoftDeleteFilterSql.cs:35`, `PhysicalDataSource.cs:42-48`) and the PostgreSQL implementation of
  each; the behavior, including the SQL Server mapping PostgreSQL shares, is unchanged.
- The Context's list of what a new engine needs and the trade-off on engine enumeration are
  corrected: a fifth engine is one engine class plus one registry line (`DataSourceEngines.cs:15-16`),
  not a new arm in every switch.
- Anchors re-verified against current source (`ApplicationDbContext.cs:618-619` and `:644-648`,
  `IDataSourceService.cs:16-22`, `DatabaseInitializationExtensions.cs:93-99`).

## Revision (2026-10-07)
Re-verified against current source. The engine decision, its rationale and every behavior described
above are unchanged; only line anchors moved.

1. Anchors re-verified against current source: `ApplicationDbContext.cs:956`
   (`EntityConfigurationInterface`, Decision 2), `ApplicationDbContext.cs:619-620` (`QuoteColumn`) and
   `:645-649` (`IncludeColumns`, Decision 4), `SoftDeleteFilterSql.cs:70-71` (`QuoteColumn`; `Build`
   stays at `:35`), `DatabaseInitializationExtensions.cs:90-105` (the migration-less loop, its
   `UsesMigrations` skip at `:99` and `EnsureCreatedAsync` at `:104-105`, Decision 6), and the
   `postgresql-integration` job at `MMCA.Common/.github/workflows/ci.yml:828` (Decision 9).

## Revision (2026-10-21)
Re-verified against current source. The engine decision, its rationale and every behavior described
above are unchanged; only line anchors moved.

1. Anchors re-verified against current source: `ApplicationDbContext.cs:962` (`EntityConfigurationInterface`
   read inside `ApplyConfigurationsForEntitiesInContext` at `:960`, Decision 2),
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:560`
   (`WithPostgreSQLDataSource`; its peer `WithSQLServerDataSource` at `:530`, Decision 8), the
   `postgresql-integration` job at `MMCA.Common/.github/workflows/ci.yml:769` (Decision 9), the
   injected AppHost branch at `MMCA.Helpdesk/build/templates/stage.ps1:428-475` (comment `:428-432`,
   `WithPostgreSQLDataSource` call `:461`, Rollout 1), and the two package ids at `stage.ps1:489-520`
   (`Directory.Packages.props` pins `:499-500`, `AspNetCore.HealthChecks.NpgSql` `:509`,
   `Npgsql.EntityFrameworkCore.PostgreSQL` `:518`, Rollout 2; the `Aspire.Hosting.PostgreSQL` entry at
   `:480-488` renames cleanly and is not one of them).

## Revision (2026-10-25)
The engine decision, its mapping and its rationale are unchanged. v1.257.0 gives the engine one
connection-customization extension point.

1. **New decision 10:** `INpgsqlDataSourceConfigurator` and `AddNpgsqlDataSourceConfigurator`
   (`INpgsqlDataSourceConfigurator.cs:23`, `DependencyInjection.Persistence.cs:24`;
   `MMCA.Common/CHANGELOG.md:25`) and their two IAM users, `AddAwsRdsIamAuthentication` and
   `AddCloudSqlIamAuthentication` (`MMCA.Common/CHANGELOG.md:15`, `:21`).
2. **Decisions 2 and 8 extended** with the shared data source the context and the readiness check
   take when a configurator is registered (`PostgreSQLDbContext.cs:63-71`,
   `PostgreSqlHealthCheckRegistration.cs:45`). The PostgreSql broker transport that also runs on it is
   recorded in [ADR-066](066-broker-transport-selection.md), and
   [ADR-130](130-per-engine-data-source-strategy.md) records why the engine strategy is untouched.
3. The other `PostgreSQLDbContext.cs` and `Extensions.Health.cs` anchors in decisions 2 and 8 were not
   re-verified in this pass and are left as recorded on 2026-10-21.

## Revision (2026-10-26)
Re-verified against current source. The engine decision, its mapping, its timestamp handling and its
rationale are unchanged. One statement in decision 4 was wrong and is corrected, decision 9 names a
test added with decision 10, and the anchors left unverified on 2026-10-25 are re-pointed.

1. **Decision 4 corrected.** `QuoteColumn` does not answer brackets for every engine except
   PostgreSQL: SQLite answers SQL-standard double quotes (`SqliteDataSourceEngine.cs:112`) and builds
   `"IsDeleted" = 0` (`:115`), as `ApplicationDbContext.cs:613-614` states. Only SQL Server
   (`SQLServerDataSourceEngine.cs:114`) and Cosmos (`CosmosDataSourceEngine.cs:114`, whose soft-delete
   filter is `null` at `:117`) answer brackets. The claim that SQL Server and SQLite literals are
   byte-identical is removed.
2. **Decision 9 extended** with `APeriodicPasswordProvider_AuthenticatesThroughTheConfiguredDataSource`
   (`PostgreSQLPersistenceTests.cs:254-255`), and the outbox tests re-scoped to `:204-248`.
3. Anchors re-verified against current source: `PostgreSQLDbContext.cs:24` (class), `:56-80`
   (`OnConfiguring`, `UseNpgsql` at `:66` and `:70`), `:77` (`PendingModelChangesWarning`),
   `:82-106` (`ConfigureNpgsql`, retry `:102-105`), `:116-126` (`ConfigureConventions`, mapping
   `:123-125`); `UtcDateTimeConverter.cs:25-40` unchanged; `Extensions.Health.cs:238-243` (PostgreSQL
   loop, `Register` at `:242`), `PostgreSqlHealthCheckRegistration.cs:32-33` (`AddNpgSql`) and `:45`,
   `Extensions.Health.cs:273` (`postgresql` name); `MMCA.Common.Aspire.Hosting/Extensions.cs:561`
   (`WithPostgreSQLDataSource`; `WithSQLServerDataSource` at `:531`); the `postgresql-integration`
   job at `MMCA.Common/.github/workflows/ci.yml:822`; `PostgreSQLPersistenceTests.cs:119-120`,
   `:145-146`, `:179-180`; and the v1.257.0 entries at `MMCA.Common/CHANGELOG.md:77`
   (`AddAwsRdsIamAuthentication`), `:83` (`AddCloudSqlIamAuthentication`), `:87`
   (`AddNpgsqlDataSourceConfigurator`) and `:90` (PostgreSQL tier).

## Related
[ADR-006](006-database-per-service.md) (one sealed context per engine, one instance per database),
[ADR-018](018-polyglot-persistence.md) (the engine axis this record adds a member to),
[ADR-035](035-optimistic-concurrency.md) (the application-managed `RowVersion` token PostgreSQL takes
instead of `xmin`),
[ADR-095](095-soft-delete-unique-indexes.md) (the partial unique index whose predicate the boolean
comparison broke),
[ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md) (the AppHost resource helper this
engine gains),
[ADR-114](114-internal-commands-durable-job-queue.md) (the job-queue table that reuses this record's
`QuoteColumn` / `IncludeColumns` helpers),
[ADR-115](115-strongly-typed-identifiers-opt-in.md) (the one base-context registration that reaches
this fourth engine with no engine branch).
