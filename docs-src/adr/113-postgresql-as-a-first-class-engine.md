# ADR-113: PostgreSQL as a First-Class Engine

## Status
Accepted (2026-09-09). Extends [ADR-006](006-database-per-service.md) (one sealed context class per
engine) and [ADR-018](018-polyglot-persistence.md) (engine as a routing decision) with a fourth
engine.

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
factory, a branch in each place the engine set is enumerated, an AppHost extension and a health
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
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:18-22`)
   is declared last rather than alphabetically. The three existing members are shipped public API
   with fixed ordinal values (`CosmosDB = 0`, `Sqlite = 1`, `SQLServer = 2`), and renumbering them
   would break every consumer that persisted or serialized one. The addition is purely additive:
   no existing public signature changes.

2. **One sealed context, built like the SQL Server one.** `PostgreSQLDbContext`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:23`)
   calls `UseNpgsql` with the resolved connection string, the per-source migrations assembly, the
   configured command timeout and the same retry-on-failure posture `SQLServerDbContext` uses
   (`PostgreSQLDbContext.cs:52-72`), and suppresses `PendingModelChangesWarning` for the same
   microservice-extraction reason. `PhysicalDbContextFactory` gains one switch arm
   (`.../DbContexts/Factory/PhysicalDbContextFactory.cs:47`) and
   `ApplyConfigurationsForEntitiesInContext` one more
   (`.../DbContexts/ApplicationDbContext.cs:831`).

3. **The mapping is the SQL Server mapping, not PostgreSQL house style.**
   `EntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationPostgreSQL.cs:21-22`)
   is a shim carrying `[UseDataSource(DataSource.PostgreSQL)]`, exactly like its SQL Server and
   SQLite peers, and the engine-aware base handles PostgreSQL in the SAME switch arm as SQL Server:
   a table per entity inside the module schema, PascalCase identifiers, an identity key. Moving an
   entity between the two engines is a base-class change with no configuration-body edits, which is
   the ADR-018 promise. **No `snake_case` naming convention is imposed.** A naming-convention plugin
   is a host-level choice with real migration consequences, and imposing one would make the two
   engines' schemas diverge for a reason that has nothing to do with either engine's capabilities.

4. **The two predicate differences are handled at their single source.** `SoftDeleteFilterSql.Build`
   answers `"IsDeleted" = false` for PostgreSQL and keeps `[IsDeleted] = 0` for SQL Server
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:34-47`),
   so the automatic convention and the opt-in `HasSoftDeleteFilter` extension can never disagree.
   The outbox filters are built through one `QuoteColumn` helper
   (`.../DbContexts/ApplicationDbContext.cs:548`) that returns the bracketed form for every
   engine except PostgreSQL, so the literals SQL Server and SQLite have always produced are
   byte-identical. `IncludeColumns` (`.../DbContexts/ApplicationDbContext.cs:574`) picks the
   provider's own `IncludeProperties` overload for the same reason.

5. **Timestamps are normalized in the model, never with the process-wide switch.**
   `PostgreSQLDbContext.ConfigureConventions` maps every `DateTime` (and, through the same entry,
   every `DateTime?`) to `timestamp with time zone` through `UtcDateTimeConverter`
   (`PostgreSQLDbContext.cs:95-105`,
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/UtcDateTimeConverter.cs:25-40`).
   The converter treats `Unspecified` as already-UTC (the framework's own convention) and genuinely
   converts a `Local` value rather than relabelling it. **`Npgsql.EnableLegacyTimestampBehavior` is
   deliberately NOT used**: it is an `AppContext` switch that changes the mapping for every Npgsql
   connection in the process, including ones the framework does not own, and it stores timestamps
   without a time zone, which loses the guarantee that a stored audit stamp means UTC.

6. **A PostgreSQL source migrates only when it names a migrations assembly.**
   `PhysicalDataSource.UsesMigrations` answers true for PostgreSQL only when
   `PostgreSQLMigrationsAssembly` is set (`.../DataSources/PhysicalDataSource.cs:63-70`), which is
   the SQLite rule rather than the SQL Server one. SQL Server always migrates because hosts have
   depended on that since the first release; PostgreSQL ships with no such host, so a source with
   nothing to apply is created outright by `DatabaseInitializationExtensions`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:70-71`)
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
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:580`), named `postgresql` for the
   first one, and `WithPostgreSQLDataSource(database, logicalName)`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:513`) wires a service
   project to its own `PostgresDatabaseResource` with the same reference / `WaitFor` / environment
   shape `WithSQLServerDataSource` uses. **No Aspire client integration is added**
   (`Aspire.Npgsql.EntityFrameworkCore.PostgreSQL`), because the SQL Server path does not use one
   either: the framework owns its own context construction, and taking an Aspire client package for
   one engine and not the others would make the two paths asymmetric for no gain.

9. **The engine is proved against a real server, not a model.**
   `Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests` is a Testcontainers project outside
   `MMCA.Common.slnx` (the posture `Tests/Core/MMCA.Common.Infrastructure.Redis.Tests` established:
   Docker-gated, own CI job, kept out of the fast solution-wide unit loop), run by the
   `postgresql-integration` CI job (`MMCA.Common/.github/workflows/ci.yml:847`). It creates the whole
   schema, round-trips an auditable entity's UTC audit stamps, proves a soft-deleted row is hidden AND
   frees its unique slot, and writes and drains outbox rows for both a local domain event and an
   integration event. The three failures listed in the Context section are each caught by one of
   those, and by nothing in the unit tier.

### Rollout: the Helpdesk canary and the template axis
Both are follow-ups, deliberately NOT in the PR that introduces the engine: a framework capability
lands in a release, and a consumer adopts it after that release, which is the same order every other
framework change has taken.

1. **MMCA.Helpdesk canary (one PR after the release).** Helpdesk is the runnable reference app and
   the CI consumer canary, and it already builds against framework source through its checked-in
   `local.props`. A `--database postgresql` shape of it exercises the whole path end to end: entity
   configurations on `EntityTypeConfigurationPostgreSQL`, a
   `MMCA.Helpdesk.Migrations.PostgreSQL.Tickets` project scaffolded through
   `DesignTimeDbContextHelper.CreatePostgreSQL`, and the AppHost using
   `WithPostgreSQLDataSource`. The `consumer-source-build` CI job's SQL half (start a server, apply
   real migrations, assert `__EFMigrationsHistory` and the framework's own `dbo.OutboxMessages`
   table exist) is the shape to mirror for it.
2. **Template axis.** `MMCA.Helpdesk/.template.config/template.json` already carries a `database`
   choice parameter with `sqlserver` and `sqlite` and two derived symbols, `engineName`
   (`SqlServer` / `Sqlite`) and `engineNameUpper` (`SQLServer` / `Sqlite`), that rename the
   migrations project, the provider package ids, the design-time helper call, the context class, the
   configuration base and the connection-string settings. The proposal is a third choice,
   `--database postgresql`, whose derived values are `PostgreSQL` for BOTH symbols: the framework
   spells this engine the same way in both positions, which is the one place the new choice is
   simpler than the existing two. Cutting it is a template re-pack (`templates-vX.Y.Z`), so it rides
   the release after the canary proves the shape.

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
- **The engine set is now enumerated in more places.** Every switch over `DataSource` that previously
  listed three members lists four, and IDE0072 makes a missed one a build error rather than a silent
  default. That is the containment the one-context-per-engine design buys: the compiler names the
  sites a fifth engine would have to touch.
- **A namespace-cycle constraint surfaced.** Passing the engine into `ConfigureScheduler`'s model
  lambda by reading it off the context made that lambda capture `this`, which the compiler emits as
  a method ON `ApplicationDbContext` whose `EntityTypeBuilder<ScheduledJobEntry>` parameter reflects
  as a `Persistence -> Scheduling` reference and widens the one accepted namespace cycle. The engine
  is read into a local before the lambda instead. The fitness rule
  ([ADR-015](015-architecture-fitness-functions.md)) caught it; the note is recorded so the next
  engine does not rediscover it.
- **PostgreSQL is not yet exercised by a consumer.** The framework's own tier proves the provider;
  no shipped application runs on it. The Helpdesk canary above closes that.

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
