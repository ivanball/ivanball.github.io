# ADR-018: Polyglot Persistence (Multiple Storage Engines Behind One Model)

## Status
Accepted. The framework plumbing is complete, covered by unit and integration tests
(`DataSourceResolverTests`, `CrossDataSourceDegradeConventionTests`, `EntityTypeConfigurationTests`,
`CosmosConfigurationPortabilityTests`, `MultiSourceSqliteIntegrationTests`, and others), and shipped to
production (the engine-agnostic plumbing released in Common v1.79.0; see `FACTS.md` for the current
framework version). No production entity routes to a non-SQL-Server engine today. An end-to-end
trial (ADC's Conference `Session` to Cosmos DB and `Room` to SQLite, with its child entities) was built
and tested locally, then deliberately reverted to all-SQL-Server while every framework extension point was kept.
Moving an aggregate to another engine later is a config-base-class change plus connection strings (and
one AppHost helper line), not a rewrite. This ADR records the decision and the extension point, because the
machinery is load-bearing and already in production. Revised 2026-08-29 (v1.170.0): a request for an
engine the host configures **nowhere** is served from the engine it does configure, so the
"engines never collapse into each other" rule in Decision item 4 now has one bounded exception. See
the Revision at the end.
Revised 2026-09-09: a fourth engine, PostgreSQL, joins the set
([ADR-113](113-postgresql-as-a-first-class-engine.md)). It takes the same switch arm as SQL Server in
the engine-aware configuration base
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:72-73`),
so the `[UseDataSource]` axis grows by one member.
Revised 2026-09-11: the Decision below now reads four engines throughout. The 2026-09-09 note also
claimed no Decision item changed, which was wrong: the engine enum, the context list, the
connection-string keys and the health-check rule each name PostgreSQL today. ADR-113 owns the
PostgreSQL specifics (provider, naming conventions, migrations); this record keeps only the shape of
the engine axis.

## Context
ADR-006 (database-per-service) splits storage along the **Name** axis: several physically separate
databases, all on the same engine (SQL Server), one per service. A second, orthogonal axis is the
storage **Engine** itself. Not every aggregate fits a relational store equally well:

- High-volume public read models (for example the conference's published-session surface) suit a
  document store with cheap horizontal reads.
- Transactional modules (Identity, Sales) want relational integrity and JOINs.
- Small, self-contained, or edge/offline data suits an embedded file database.

Putting every aggregate on SQL Server is a default, not a decision. We wanted the engine to be a
**per-aggregate choice driven by access pattern**, without that choice leaking into domain or
application code, and without rewriting an entity to move it between engines.

The `DataSourceKey(Engine, Name)` pair already present for ADR-006 carries an `Engine` component, so
routing by engine was a natural extension of the same resolver, registry, and context factory rather
than a separate subsystem.

## Decision
Support four storage engines behind one entity model and one set of repository abstractions, selected
per entity configuration.

1. **`DataSource` engine enum:** `SQLServer` (full relational JOINs), `CosmosDB` (document store, no
   cross-container JOINs), `Sqlite` (JOINs within one file), `PostgreSQL` (full relational JOINs,
   ADR-113). `PostgreSQL` is appended rather than inserted alphabetically, because the three members
   above it are shipped public API whose ordinal values consumers have persisted
   (`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:6-23`).
   `DataSourceKey(Engine, Name)` identifies a physical source: the **Name** axis is ADR-006, the
   **Engine** axis is this ADR.
2. **Engine is a one-line declaration on the entity's configuration.** A configuration derives from an
   engine shim base (`EntityTypeConfigurationSQLServer` / `EntityTypeConfigurationPostgreSQL` /
   `EntityTypeConfigurationCosmos` / `EntityTypeConfigurationSqlite`), or annotates
   `[UseDataSource(DataSource.X)]` directly
   (`Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:13`). The
   engine-aware `EntityTypeConfiguration<TEntity, TId>` reads that attribute and applies the matching
   mapping (table + schema for SQL Server and PostgreSQL, which share one switch arm, table for
   SQLite, container + partition key for Cosmos) plus
   the right key generation (server identity, vs. client-side `CosmosIntIdValueGenerator`, vs. never).
   The configuration **body is portable**: moving an entity between engines is a single attribute
   change with no body edits.
3. **One concrete context per engine, one instance per database.** `SQLServerDbContext`,
   `PostgreSQLDbContext`
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:23`),
   `SqliteDbContext`, and `CosmosDbContext` are sealed contexts over the abstract `ApplicationDbContext`.
   Combined with ADR-006's "one instance per `DataSourceKey`", a host materializes one context instance
   per physical (engine, name) source.
4. **Configuration drives routing.** `DataSourceResolver` builds a per-engine logical-to-physical map
   from the engine-specific connection strings (`SQLServerConnectionString` /
   `PostgreSQLConnectionString` / `CosmosConnectionString` / `SqliteConnectionString`, one switch arm
   each at `DataSourceResolver.cs:483-499`, plus `CosmosDatabaseName` and a migrations assembly for the
   two server engines, `SQLServerMigrationsAssembly` and `PostgreSQLMigrationsAssembly`, which SQLite
   and Cosmos leave empty at the top level (`:247-254`) and which a named entry can override per source
   (`DataSourceEntrySettings.cs:35`)), read from either
   configuration shape: the top-level `ConnectionStrings` section, or a named entry under `DataSources`.
   Either shape supplies an engine's `Default` source on its own. The top-level value is the first
   answer; where it names nothing for that engine and the named entries declare exactly one distinct
   database on it, that database is the host's single database and becomes `Default`, which is what lets
   a host declare its databases only under `DataSources` and still route the framework-owned tables
   (outbox, inbox, scheduled jobs, audit trail) that resolve to the `Default` name
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:202-237`).
   Several distinct databases with no top-level value leave `Default` empty, since there is no single
   answer: a genuinely multi-database host names the one it wants shared by adding a
   `DataSources:Default` entry. Logical names with no entry for an engine collapse onto that engine's
   `Default`; engines never collapse into each other. `EntityDataSourceRegistry` (and the
   `DataSourceService` facade) eagerly map every entity to its physical source up front, so routing
   never depends on a model already being built.
5. **Cross-engine relationships auto-degrade.** `CrossDataSourceDegradeConvention` removes FK constraints
   and navigations whose ends live in different physical sources (which now includes different engines);
   scalar FK columns plus a compensating index survive. Runtime joins flow through `INavigationPopulator`
   (ADR-002); cross-source consistency flows through the outbox (ADR-003).
6. **Cosmos specifics.** All of a module's entities share one container (so intra-module relationships
   and the navigation populators work), the entity Id is the partition key, Ids are generated client-side
   (`CosmosIntIdValueGenerator`, since a document store has no server identity), and relational-only
   constructs (indexes) are stripped at model-build time.
7. **The host surface reads the same two shapes.** The Aspire AppHost helpers
   `With{SQLServer,PostgreSQL,Cosmos,Sqlite}DataSource` inject the `DataSources__{logicalName}__*`
   environment variables for the source they attach
   (`Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:493`, `:523`, `:552-553`, `:577`). The
   database health checks enumerate the top-level section and every named
   entry, deduplicated by connection string, so each physical database contributes exactly one readiness
   check and the entries that collapse onto one database contribute one between them
   (the per-engine enumeration at `Source/Hosting/MMCA.Common.Aspire/Extensions.cs:606-643`,
   registered at `:556-587`). The requirement that a host have a
   database at all is engine-agnostic: `AddInfrastructureHealthChecks(requireDatabase)` is satisfied by
   SQL Server, PostgreSQL or SQLite, declared in either shape (`:305-309`, the rule at `:565-571`).

## Rationale
- **Right store per access pattern, as a configuration decision.** The engine becomes an attribute on a
  configuration class, not a rewrite. The same domain entity, application handler, and repository code
  run unchanged whichever engine backs the aggregate.
- **One mental model, one set of extension points.** Polyglot persistence reuses the exact resolver, registry,
  context-factory, and degrade-convention machinery that database-per-service already needed, so there
  is no parallel data layer to maintain.
- **Portability lowers the cost of being wrong.** Because the configuration body is engine-agnostic, an
  aggregate that turns out to be a poor fit for its engine can be moved with an attribute change plus a
  data migration, not a code rewrite.

## Trade-offs
- **No cross-engine JOINs, FKs, or transactions.** This is the ADR-006 cost made sharper: across engines
  it is a hard limit, not a deployment choice. A query spanning engines (for example a public-session
  read that needs published-event Ids from a relational source) must be split into per-engine steps
  rather than one LINQ query, and consistency across engines is eventual via the outbox. The
  `CrossSourceSpecification` helper makes that split engine-portable (resolve principal keys, then filter
  by `FK IN (keys)` with no navigation), and the `SpecificationsDoNotNavigateToOtherEntities` fitness
  rule (the `specifications` category in ADR-015) fails the build if a specification silently embeds a
  cross-engine navigation.
- **Each engine carries its own operational model.** Separate EF provider, separate migration story
  (Cosmos has no relational migrations), separate backup/restore and cost profile. Adding an engine to a
  deployment is a real operational commitment, not just a connection string.
- **Cosmos constraints leak into modeling.** Container-per-module, Id-as-partition-key, and client-side
  Id generation are not the relational defaults; an aggregate moved to Cosmos must tolerate them.
- **Latent today.** The plumbing is complete, tested, and in production, but no production entity uses a
  non-SQL engine, so the cross-engine paths (degrade across engines, the `CrossSourceSpecification`
  helper, Cosmos client-side Id generation) are proven by tests and a reverted local trial rather than by
  production load until the first migration ships.

## Related
ADR-006 (database-per-service: the **Name** axis this ADR's **Engine** axis is orthogonal to; they share
`DataSourceKey`), ADR-002 (navigation populators bridge the relationships the degrade convention strips
across sources), ADR-003 (the outbox is the cross-source, and now cross-engine, consistency mechanism),
ADR-113 (PostgreSQL as the fourth engine: provider, naming conventions, and migrations).

## Revision (2026-08-29): engine substitution for a single-engine host

Decision item 4 says engines never collapse into each other, and that held while every host in this
workspace configured SQL Server. A host that configures **only** SQLite (or only Cosmos) broke on it,
because the engine choice for the framework's own tables is not made by that host: `Outbox:DataSource`,
`Scheduler:DataSource` and `AuditTrail:DataSource` all default to `SQLServer`. Honoring that default
literally handed the scheduler, the outbox, the audit trail, the refresh-session store and
`DbContextFactory`'s transaction coordination a physical source with an empty connection string, and
the first query each ran failed with "The ConnectionString property has not been initialized"
(`Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:109-119`). The
host built, started, and reported healthy first.

The rule is now: **a request naming an engine the host configures nowhere is served from the engine the
host does configure.**

- The resolver records which engines carry a connection string anywhere, top-level or on a named
  `DataSources` entry, while it builds the per-engine maps (`DataSourceResolver.cs:68-76`, the
  predicate at `:135-140`; the named-entry half of that rule is what
  `DataSourceResolverTests.cs:351-372` exercises).
- The substitute is the first configured engine in a fixed preference order, `SQLServer`, then
  `PostgreSQL`, then `Sqlite`, then `CosmosDB` (`:29-30`, selected at `:78-81`). Relational first
  because every table the framework owns is relational, the two server engines ahead of SQLite because
  a host that configures one means it to carry those tables, and SQL Server first so a host that
  configures SQL Server at all keeps exactly the routing it had.
- `ResolveLogical` maps the requested engine through `SubstituteUnconfiguredEngine` before it looks
  anything up (`:93`, the substitution at `:128-129`), which returns the request unchanged whenever
  the host configures that engine.
- A host that configures no database at all substitutes nothing (`:41-46`): there is nothing to
  substitute to, and its startup validation is what fails, not its first query.
- A substitute other than SQL Server is announced once at startup, naming the engine and the framework
  tables it now serves (`:83-89`, message at `:501-502`).

**Nothing moves for a host that configures the requested engine**, so a SQL-Server-only host and a
genuine polyglot host that configures two engines resolve exactly as this record describes; only a
request that could not have been served at all is redirected (`:120-124`, the behavior itself at
`:128-129`). The pinned tests cover both
directions (`Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DataSourceResolverTests.cs`).

The companion change is that startup validation stopped assuming SQL Server. A `[Required]` annotation
on `SQLServerConnectionString` encoded "SQL Server is the only engine a host can boot on" and failed a
SQLite-only host whose every entity resolved to a configured database. It is replaced by
`ConnectionStringSettingsValidator`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/ConnectionStringSettingsValidator.cs:30`), registered
with `ValidateOnStart`, which accepts a connection string for **any** of the four supported engines,
either top-level or on a named `DataSources` entry (`:51-53`, the two checks at `:57-61` and
`:68-74`). The rule is not weakened for the hosts
that do run on SQL Server: a host with no connection string anywhere still fails to start, with a
message naming both configuration shapes and every engine key (`:38-44`), because silently booting one trades a clear
startup failure for a failure on the first query.
