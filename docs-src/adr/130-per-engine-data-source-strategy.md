# ADR-130: Per-Engine Data Source Strategy (Engine Facts Instead of Branching on the Enum)

## Status
Accepted (2026-10-01). Shipped in MMCA.Common v1.218.0 (`MMCA.Common/CHANGELOG.md:279`). Revised
2026-10-06: the release status now records v1.218.0 as shipped. Refines [ADR-018](018-polyglot-persistence.md) (engine as
a routing decision) and [ADR-113](113-postgresql-as-a-first-class-engine.md) (the fourth engine)
without changing [ADR-006](006-database-per-service.md) (one sealed context class per engine, one
instance per database). Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

## Context
MMCA.Common persists through four engines named by one shipped public enum, `DataSource`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:6`):
`CosmosDB` (`:9`), `Sqlite` (`:12`), `SQLServer` (`:15`) and `PostgreSQL` (`:22`), the last appended
rather than inserted because the three before it are public API with fixed ordinals (`:17-21`).

Every place the framework behaved differently per engine named an enum value or sniffed the EF
provider name, so the knowledge of what one engine can do was spread over the resolver, context
creation, model building, conventions, the soft-delete filter, the audit row-version stamp, the read
repository, transactions, migration targets and the startup initializer. Adding PostgreSQL under
ADR-113 meant finding every one of those branches by hand, and nothing in the compiler points at a
branch that was missed. Two engine facts also lived in odd places: whether a context
could hold the outbox was a separate `ApplicationDbContext.SupportsOutbox` override, and the SQL
Server identity-insert path sat inside the context factory under an engine-specific name,
`RequestIdentityInsert`. SQLite also quoted identifiers two ways: its soft-delete filter used double
quotes while its filtered-index predicates used SQL Server brackets. The prior shape is described in
the two MMCA.Common commits that replaced it, aa8297fb (the contract) and 23eff3a0 (the routing).

## Decision
One internal strategy object per engine answers every engine question, looked up through a static
registry keyed by the shipped enum. Call sites read engine facts; they no longer name an engine.

- **The contract.** `IDataSourceEngine`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/IDataSourceEngine.cs:18`)
  groups its members in three kinds (`:14-15`): DESCRIPTIVE facts (substitution priority, entity
  configuration interface, migrations setting name, connection identity, and the connection-string
  and migrations-assembly readers, `:29-69`), one `Capabilities` value (`:74`), and BEHAVIOUR hooks
  where the engine must act rather than answer (context creation, key and table mapping, INCLUDE
  columns, column quoting, the soft-delete filter and the explicit-key dialect, `:83-119`). The enum
  value stays the engine's identity (`:20-21`).
- **The registry is static.** `DataSourceEngines`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/DataSourceEngines.cs:19`)
  holds the four engines in one array (`:22-28`), indexes them in a frozen dictionary (`:30-31`), and
  exposes `For(DataSource)`, which throws `InvalidOperationException` for an unregistered value
  (`:40-43`), and `All` (`:34`). Its remarks record why it is not a DI service (`:9-12`) and that a
  fifth engine is one class plus one line in the array (`:15-16`).
- **The enum and its ordinals stay.** `DataSource` is unchanged; the registry is keyed by it
  (`DataSourceEngines.cs:30-31`), so configuration, `[UseDataSource]` attributes and anything that
  persisted or serialized an ordinal keep working.
- **Capabilities are only the facts that differ.** `DataSourceEngineCapabilities`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/DataSourceEngineCapabilities.cs:23-28`)
  has five members, and its remarks state the rule (`:5-7`): anything that splits the engines exactly
  along the relational line is one `IsRelational` flag, which covers same-source `.Include()`,
  transactions, raw SQL, indexes, foreign-key delete behavior, `Any(predicate)` translation and the
  framework's own tables (`:15-19`). The other four are `Migrations` (a three-value `MigrationPolicy`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/MigrationPolicy.cs:8-20`),
  `ConnectionStringRequired`, `NullsSortFirstAscending`, and `RowVersion` (a three-value
  `RowVersionStrategy`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/RowVersionStrategy.cs:8-17`).
  The four engines answer:

  | Engine | Substitution priority | Migrations | Connection string required | IsRelational | Nulls first ascending | RowVersion | Explicit-key dialect | Column quoting |
  |---|---|---|---|---|---|---|---|---|
  | SQL Server | 0 | Always | yes | yes | yes | StoreGenerated | itself | `[col]` |
  | PostgreSQL | 1 | WhenAssemblyConfigured | no | yes | no | ClientStamped | none | `"col"` |
  | SQLite | 2 | WhenAssemblyConfigured | no | yes | yes | ClientStamped | none | `"col"` |
  | Cosmos DB | 3 | Never | no | no | yes | None | none | `[col]` (unused) |

  Sources: `SQLServerDataSourceEngine.cs:29`, `:42-46`, `:49`, `:114`;
  `PostgreSQLDataSourceEngine.cs:27`, `:40-44`, `:47`, `:113`; `SqliteDataSourceEngine.cs:26`,
  `:39-43`, `:46`, `:112`; `CosmosDataSourceEngine.cs:28`, `:42-46`, `:49`, `:114` (all under
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/`). Cosmos builds
  no soft-delete filter (`CosmosDataSourceEngine.cs:117`).
- **Call sites read the engine.** A context exposes its engine as `ApplicationDbContext.Engine`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:61`).
  The resolver orders substitution by `SubstitutionPriority`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:36`)
  and reads migration policy and connection strings through the engine (`:394`, `:451`, `:471`,
  `:501`, `:504`); `PhysicalDataSource.UsesMigrations` switches on `Migrations`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:42`);
  the row-version mapping and stamp read `RowVersion`
  (`ApplicationDbContext.cs:592`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:67`);
  include support reads `IsRelational`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceService.cs:32`);
  context creation, key mapping and the soft-delete SQL call the behaviour hooks
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:32`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:77`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:35`, `:70`).
  The one policy constant that still names an engine is the resolver's framework default,
  `SQLServer` (`DataSourceResolver.cs:23`).
- **Outbox support is the engine's relational flag.** `ApplicationDbContext.SupportsOutbox` is gone;
  the outbox routing decision reads `context.Engine.Capabilities.IsRelational`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:82`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:70`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:257`).
- **Explicit-key insert is engine-neutral at the API.** `IUnitOfWork.RequestIdentityInsert` is renamed
  `RequestExplicitKeyInsert`, with no alias
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:45`,
  documented at `:38-44`), and so are `IDbContextFactory`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IDbContextFactory.cs:40`)
  and `DbContextFactory`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:322`).
  The engine-specific half is `IExplicitKeyInsertDialect`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/IExplicitKeyInsertDialect.cs:13`),
  which finds the per-table groups (`:21`, grouped as `ExplicitKeyInsertGroup`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/ExplicitKeyInsertGroup.cs:12`)
  and builds the toggle statement (`:28`); the factory keeps the engine-neutral rounds (`:5-11`) and
  uses the dialect only when the engine has one (`DbContextFactory.cs:293`). SQL Server is its own
  dialect (`SQLServerDataSourceEngine.cs:19`, `:49`) and emits `SET IDENTITY_INSERT [schema].[table] ON` or `OFF`
  (`:163`); the other three return `null`, so the save runs unchanged.
- **Raw SQL is registered only where it can run.** `AddRawSqlQueryExecutor`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:400`, called at `:116`)
  resolves the host's framework default engine and registers `IRawSqlQueryExecutor` only when that
  engine is relational (`:409-411`). A Cosmos-default host gets no registration, so a service that
  injects the executor fails at container validation instead of on its first statement (`:391-396`).
  Both branches are tested
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/DependencyInjectionInfrastructureTests.cs:273`,
  `:294`).
- **SQLite quotes with double quotes everywhere.** `SqliteDataSourceEngine.QuoteColumn` returns
  `"col"` (`SqliteDataSourceEngine.cs:111-112`), the same form as its soft-delete filter (`:115`), so
  filtered-index predicates on SQLite (the outbox, internal-command and push-notification `DedupKey`
  filters) change from `[Column]` to `"Column"`.
- **Settings keep their per-engine properties.** `ConnectionStringSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/ConnectionStringSettings.cs:12`)
  and `DataSourceEntrySettings` still carry one named property per engine (for example
  `ConnectionStringSettings.cs:18`, `:28`, `:40`, `:43`;
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceEntrySettings.cs:22`,
  `:28`, `:40`, `:58`), and each engine reads its own (`SQLServerDataSourceEngine.cs:52-70`). A fifth
  engine adds one property per settings class.

A source-scanning fitness test keeps new branches out:
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DataSourceBranchingFitnessTests.cs:71`
fails on any `DataSource.<Engine>` reference or engine-context type check outside a file-level
allow-list of the reviewed remaining references (engine classes, sealed contexts naming themselves,
settings defaults, the design-time helper, the configuration shim bases, `IndexBuilderExtensions`'
default parameter, framework-default engine requests and `FrameworkDefaultEngine`), each entry
carrying its reason, and `:83` fails on an allow-list entry that no longer has a hit, so the list
cannot go stale. Its failure message names this record.

## Rationale
- **One place per engine.** An engine's behavior is now one class, and a fifth engine is one class
  plus one registry line (`DataSourceEngines.cs:15-16`); a missed branch can no longer hide in a
  call site, because call sites no longer hold engine branches.
- **Static because the consumers have no container.** Model-building conventions,
  `EntityTypeConfiguration.ApplyEngineConventions`, `SoftDeleteFilterSql` and `IndexBuilderExtensions`
  run where no service provider is reachable (`DataSourceEngines.cs:9-11`), and the engines are
  stateless facts about a closed enum only Common extends (`:11-12`), so DI would add a lookup path
  that half the callers cannot use and no extensibility.
- **Fewer, truer capabilities.** A flag per relational feature would be seven booleans that always
  move together; one `IsRelational` flag says what is actually true today
  (`DataSourceEngineCapabilities.cs:14-20`), and a capability gets its own member only when an engine
  genuinely answers differently (PostgreSQL's null ordering, SQL Server's required connection string,
  the three row-version strategies).
- **Fail at startup, not at first use.** Registering the raw-SQL executor conditionally turns a
  call-time `NotSupportedException` on Cosmos into a container-validation failure
  (`DependencyInjection.cs:391-396`), the same fail-fast stance as
  [ADR-070](070-fail-fast-configuration-contract.md).
- **One dialect per engine.** SQLite accepts both quote forms, but a model that mixes them is two
  dialects to read and to reason about; the filter and the index predicates now agree
  (`SqliteDataSourceEngine.cs:111-115`).
- **An API name that describes the request, not the engine.** `RequestExplicitKeyInsert` says what
  the caller wants; whether an engine needs a toggle to honour it is the dialect's business
  (`IExplicitKeyInsertDialect.cs:5-11`).

## Trade-offs
- **Breaking for consumers.** The `RequestIdentityInsert` rename has no alias
  (`IUnitOfWork.cs:45`); a Cosmos-default host that injects `IRawSqlQueryExecutor` now fails at
  startup (`DependencyInjection.cs:409`); and a SQLite consumer with migrations sees a model diff on
  the outbox, internal-command and push-notification filtered indexes and needs a migration.
- **Static means not replaceable.** A consumer cannot substitute or add an engine; the registry is
  internal (`DataSourceEngines.cs:19`) and so is the contract (`IDataSourceEngine.cs:18`). That is
  the intended scope, since the enum is closed.
- **`IsRelational` is coarse by design.** An engine that is relational but lacks one of the features
  it stands for (`DataSourceEngineCapabilities.cs:15-19`) would force the flag to split.
- **Settings stay engine-shaped.** Each engine is a named property on each settings class
  (`ConnectionStringSettings.cs:18-49`), so a fifth engine touches every settings class and its
  validator, not just the engine.
- **The gate is textual.** `DataSourceBranchingFitnessTests` matches source text, so a branch written
  without naming an engine value or an engine context type (for example on a provider-name string)
  passes it; review still owns that case.
- **Cosmos carries an unused quoting answer.** It returns brackets from `QuoteColumn`
  (`CosmosDataSourceEngine.cs:114`) only because the interface requires one; it builds no filtered
  index (`:117`).

## Alternatives rejected
- **Engines registered in DI** (weighed 2026-10-01). Engines as `IDataSourceEngine` services resolved
  from the container. Rejected because the conventions, `EntityTypeConfiguration` and the SQL builders
  run without a container (`DataSourceEngines.cs:9-11`), so they would need the static lookup anyway,
  leaving two lookup paths, and because the enum is closed so DI buys no extensibility (`:11-12`).
  Revisit if consumers are ever allowed to contribute an engine.
- **A dictionary-keyed per-engine settings model** (rejected 2026-10-01). One `Engines` dictionary
  keyed by engine name in place of the named per-engine properties. Rejected because it breaks every
  consumer's `appsettings` and every Bicep app setting that names those keys, for no current need:
  four engines fit four properties. Revisit if the engine count grows enough that per-property
  settings become the bottleneck, and then in a release that ships the configuration migration with
  it.
- **Keep SQLite's mixed quoting** (weighed 2026-10-01). Leaving brackets in SQLite filtered-index
  predicates would have kept existing SQLite snapshots stable with no migration. Rejected by the owner
  in favor of one dialect per engine; the cost is the one-time model diff above.
- **A capability flag per relational feature** (weighed 2026-10-01). Separate booleans for include,
  transactions, raw SQL, indexes and the rest. Rejected because every engine answers them identically
  along the relational line (`DataSourceEngineCapabilities.cs:5-7`). Revisit when an engine splits
  them.
- **Keep `SupportsOutbox` as its own override.** Rejected because the outbox needs exactly the
  relational tables `IsRelational` already describes (`DataSourceEngineCapabilities.cs:18-19`); a second
  answer to the same question can disagree with the first.

## Consequences
- **Consumer upgrade.** Rename `RequestIdentityInsert` calls to `RequestExplicitKeyInsert`; on a
  Cosmos-default host, remove any `IRawSqlQueryExecutor` dependency; on SQLite with migrations, add a
  migration for the re-quoted filtered indexes.
- **Adding an engine.** Append to `DataSource` (never insert, `IDataSourceService.cs:17-21`), write
  one `IDataSourceEngine`, add it to `DataSourceEngines.Registered` (`DataSourceEngines.cs:22-28`), and
  add one property per settings class.
- **What to watch.** Allow-list growth in `DataSourceBranchingFitnessTests`: a new entry is a new
  engine-specific site outside the strategy and needs the same justification as the existing ones.

## Revision (2026-10-06)
- **Release status.** v1.218.0 has shipped (`MMCA.Common/CHANGELOG.md:279`); the Status block no
  longer calls it unreleased.
- **Anchors.** Re-verified against current source; the audit row-version read moved to
  `AuditSaveChangesInterceptor.cs:67`, the factory's dialect use to `DbContextFactory.cs:293` and
  `RequestExplicitKeyInsert` to `DbContextFactory.cs:322`, behavior unchanged.

## Revision (2026-10-07)
Re-verified against current source. The decision, the engine contract, the capabilities table and
the call sites that read engine facts are unchanged; only line anchors moved.

1. Anchors re-verified against current source: the v1.218.0 release heading is
   `MMCA.Common/CHANGELOG.md:304` (the `:279` cited in the Status block and the 2026-10-06 revision
   falls inside the 1.219.0 section); the resolver reads migration policy and connection strings at
   `DataSourceResolver.cs:394`, `:451`, `:471`, `:501`, `:504`; the row-version mapping reads
   `RowVersion` at `ApplicationDbContext.cs:592`; the outbox routing reads `IsRelational` at
   `InProcessEventBus.cs:82` and `DomainEventSaveChangesInterceptor.cs:257` (`BrokerEventBus.cs:70`
   unchanged); and the `DataSourceEntrySettings` connection-string properties sit at
   `DataSourceEntrySettings.cs:22` (Cosmos), `:28` (PostgreSQL), `:40` (SQLite) and `:58`
   (SQL Server).

## Related
[ADR-006](006-database-per-service.md) (one sealed context per engine),
[ADR-018](018-polyglot-persistence.md) (engines behind one model and the resolver),
[ADR-113](113-postgresql-as-a-first-class-engine.md) (the fourth engine),
[ADR-030](030-startup-sole-migrator.md) (the startup migrator that reads `Migrations`),
[ADR-035](035-optimistic-concurrency.md) (the row-version token `RowVersion` maps),
[ADR-095](095-soft-delete-unique-indexes.md) (the soft-delete filtered indexes whose SQLite quoting
changed), [ADR-125](125-parameterized-sql-only.md) (the raw-SQL executor now registered
conditionally). Framework version and package figures live in `MMCA.Common/FACTS.md`.
