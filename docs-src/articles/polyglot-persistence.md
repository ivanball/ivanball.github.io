# One entity model, four databases: polyglot persistence behind a single attribute

> Series: MMCA.Common · Article #11 (deep-dive) · Pillar P3 · Group G07,G03 · Rubric §8 · ADR-018, ADR-113, ADR-130 ·
> Status: grounded in `Website/docs-src/onboarding/group-07-persistence-ef-core.md`,
> `group-03-querying-specifications.md`, ADR-018, ADR-113, ADR-130. No em dashes.

**Subtitle:** A domain entity should not know which database engine stores it. Here is a design where
the same entity moves between SQL Server, PostgreSQL, Cosmos DB, and SQLite by changing one attribute
(plus the host's connection string for the target engine), with no edit to the domain entity, plus the
honest note that the plumbing runs in production while every production entity lives on SQL Server.

---

Pick an entity. A `Session`, say. Where does it live? In almost every codebase the answer is welded
into the entity itself, or at least into its persistence configuration: a SQL table here, a Cosmos
container there, and switching between them means rewriting the mapping, the key strategy, the
queries, and usually a few handlers that quietly assumed a relational JOIN was available. The storage
engine becomes a load-bearing decision you made on day one with the least information you will ever
have.

That coupling is expensive in two directions. If you guessed SQL Server and later want a document
store for a high-write, schema-loose entity, you are looking at a migration project, not a config
change. And if you guessed Cosmos and later need a relational JOIN, you are stuck writing application
side joins forever. The engine choice wants to be reversible. It almost never is.

MMCA.Common makes it reversible. A domain entity carries no persistence-engine choice at all. It is a
plain class. What decides whether it is stored in SQL Server, PostgreSQL, Cosmos DB, or SQLite is a
single `[UseDataSource(<engine>)]` attribute on its EntityConfiguration, carried for you by one of four
thin base classes. Moving an entity between engines is a one-token change in that configuration, plus
the target engine's connection string and one AppHost line, and the entity itself never has to know it
happened.

## Two axes, not one

This is the companion to the database-per-service article (Article 10), and the two are deliberately
orthogonal. It helps to name the axes.

Database-per-service (ADR-006) is the **Name axis**: *which physical database* owns an entity, so that
the Conference module's data and the Engagement module's data sit in separate databases that can be
deployed and scaled independently. Article 10 covers that axis in full.

Polyglot persistence (ADR-018, extended to a fourth engine by ADR-113, and organized as one strategy
object per engine by ADR-130) is the **Engine axis**: *which storage technology* backs an entity, SQL
Server vs PostgreSQL vs Cosmos DB vs SQLite, independent of which logical database it belongs to. The
two compose. An entity has a Name (its database) and an Engine (its technology), and you can change
one without touching the other. This article is about the Engine axis.

## The configuration hierarchy: where the engine lives

Every entity in the framework gets an EntityConfiguration class. The relevant inheritance chain is
short and worth holding in your head.

At the bottom is `EntityTypeConfigurationBase<TEntity, TIdentifierType>`. It does exactly one
cross-cutting thing: if the entity is an aggregate root, it tells EF to ignore the in-memory
`DomainEvents` collection so EF never tries to persist it. That is all. It knows nothing about
engines.

Above it sits the piece that ADR-018 added: a single, engine-aware
`EntityTypeConfiguration<TEntity, TIdentifierType>` base. Its `Configure` method reads the
`[UseDataSource(...)]` attribute off the concrete configuration, and if the attribute is absent it
throws `InvalidOperationException` as the model is built. A configuration with no declared engine is
a hard error, not a silent default. Then it hands the entity to a `protected static
ApplyEngineConventions` helper, and that helper holds no branching at all. Its body is one call:
`DataSourceEngines.For(engine).ApplyKeyAndTableMapping<TEntity, TIdentifierType>(builder)`.

The per-engine knowledge lives one level down, in one strategy class per engine (ADR-130).
`IDataSourceEngine` is the internal contract every engine implements: descriptive facts, a small
`Capabilities` record (is the engine relational, how it migrates, how it stamps the row version), and
a handful of behaviour hooks, one of which is the key-and-table mapping. `DataSourceEngines` is a
static registry that holds the four strategies in one array and looks them up by the `DataSource`
enum value. The four mappings:

- **SQL Server**: `ToTable(Name, schema)` where the schema is the module name derived from the
  entity's namespace (the segment before "Domain"), `HasKey(Id)`, and `ValueGeneratedOnAdd()` for a
  store-generated key.
- **PostgreSQL**: deliberately the same code as SQL Server, module schema and PascalCase identifiers
  included, so an entity moves between the two engines by changing its configuration base class and
  nothing else (ADR-113). PostgreSQL house style (snake_case, the public schema) is a consumer's
  naming-convention plugin, not a framework decision.
- **SQLite**: `ToTable(Name)` with no schema, `HasKey(Id)`, and an identity column
  (`ValueGeneratedOnAdd().UseIdentityColumn(1, 1)`).
- **Cosmos DB**: `ToContainer(moduleName).HasPartitionKey(Id)`, one container per module so a module's
  entities and their relationships co-locate, `HasKey(Id)`, and a client-side
  `CosmosIntIdValueGenerator` for keys (Cosmos has no server-side `IDENTITY`).
- **Anything else**: `DataSourceEngines.For` throws `InvalidOperationException` for a value with no
  registered strategy. An engine with no mapping fails loudly instead of falling through to a
  relational guess.

Key generation is conditional in every strategy: the engine's generator applies only when the
entity's identifier is store-generated (`typeof(TEntity).IsIdValueGenerated`), and otherwise the key
is `ValueGeneratedNever()`, so an entity that supplies its own ids keeps them on every engine.

The registry is static on purpose: model-building code (this configuration base, the EF conventions,
the soft-delete SQL builder) runs where no DI container is reachable, and the engine set is a closed
enum only the framework extends. A fifth engine is one strategy class plus one line in the registry.
What keeps it that way is a source-scanning fitness test, `DataSourceBranchingFitnessTests`, which
fails the test run on any reference to a concrete engine value outside the strategies and a short,
reasoned allow-list, and also fails when an allow-list entry goes stale. A new `switch` over the
engine cannot quietly reappear in a call site.

On top of the engine-aware base sit four **thin shims**: `EntityTypeConfigurationSQLServer`,
`EntityTypeConfigurationPostgreSQL`, `EntityTypeConfigurationCosmos`, and
`EntityTypeConfigurationSqlite`. None of them has a body. Each is the attribute plus a
semicolon-terminated derivation. Here is the SQL Server shim, verbatim apart from its doc comment:

```csharp
[UseDataSource(DataSource.SQLServer)]
public abstract class EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>
    : EntityTypeConfiguration<TEntity, TIdentifierType>
    where TEntity : AuditableBaseEntity<TIdentifierType>
    where TIdentifierType : notnull;
```

The PostgreSQL, Cosmos, and SQLite shims are identical except for the attribute value
(`DataSource.PostgreSQL`, `DataSource.CosmosDB`, `DataSource.Sqlite`). They exist purely so that a
consumer can express the engine choice by *which base class they derive from*, without ever typing the
attribute themselves.

## The code change is one token

So what does it take to move `Session` from SQL Server to Cosmos? You change its configuration's base
class from `EntityTypeConfigurationSQLServer<Session, ...>` to
`EntityTypeConfigurationCosmos<Session, ...>`. Or, equivalently, you derive from the engine-aware base
directly and put `[UseDataSource(DataSource.CosmosDB)]` on the class. That is the change in code. The
host has to configure the target engine as well: a Cosmos connection string and one AppHost helper
line sit alongside the base-class change. Without them the resolver serves the entity from the engine
the host does configure (the nuance below), so the token alone does not move the storage.

```csharp
// Before: relational
public sealed class SessionConfiguration
    : EntityTypeConfigurationSQLServer<Session, SessionIdentifierType>
{
    public override void Configure(EntityTypeBuilder<Session> builder)
    {
        base.Configure(builder);
        // relationships, column lengths, indexes...
    }
}

// After: document store. Same body. One base class changed.
public sealed class SessionConfiguration
    : EntityTypeConfigurationCosmos<Session, SessionIdentifierType>
{
    public override void Configure(EntityTypeBuilder<Session> builder)
    {
        base.Configure(builder);
        // relationships, column lengths, indexes...
    }
}
```

The `Session` entity class does not change, and neither do the DTOs and mappers. The command and query
handlers keep their code as long as they stay inside what the target engine supports: Cosmos has no
database transactions, no raw SQL, no `.Include()` between entities of the same source, and no
`Any(predicate)` translation, so a handler that leans on one of those needs attention before a Cosmos
move. Routing is the job of the `EntityDataSourceRegistry`,
a singleton built lazily on first access: it reflects over the configuration assemblies, reads each
config's `[UseDataSource]` attribute (and its logical database name), resolves the pair through
`IDataSourceResolver` into a `DataSourceKey`, and records the result in a frozen lookup, rescanning
once on a miss so a module assembly loaded later is still found. The right `DbContext`
(`SQLServerDbContext`, `PostgreSQLDbContext`, `CosmosDbContext`, or `SqliteDbContext`, all sealed
subclasses of the abstract `ApplicationDbContext`, one class per engine) is then built per data source,
and the whole save and query pipeline routes through it without any caller knowing which engine
answered.

One nuance keeps that honest. The attribute declares the engine, and the resolver honors it whenever
the host configures that engine. A host that does not configure the declared engine (a SQL Server
configuration running in a PostgreSQL-only host, say) is served from the engine it does configure,
rather than handed an empty connection string. `EntityTypeConfiguration` exposes that answer as
`EffectiveEngine`, so any hand-written SQL in a configuration body, such as an index filter, targets
the engine actually being built.

## When a relationship crosses an engine boundary

A document store cannot enforce a foreign key into a SQL table. So the moment `Session` moves to
Cosmos while the `Event` it references stays in SQL Server, the relationship between them spans two
physical sources, and EF cannot model it the usual way. Two mechanisms catch this, and both run
without you writing a line of code.

The first is `CrossDataSourceDegradeConvention`, an EF model-finalizing convention. For each model it
builds, it finds relationships whose two ends resolve to different physical databases and degrades
them: it removes the foreign-key constraint, keeps the scalar FK *column* (plus a compensating index
so the value stays queryable), ignores the CLR navigation members that point at the foreign entity,
and removes the foreign entity type from this model entirely. The scalar FK survives, so a logical
join is still possible through a batch loader; what disappears is the impossible cross-database
constraint. The compensating index is deliberately **skipped on Cosmos**, because Cosmos auto-indexes
every property and rejects explicit index definitions (adding one would fail model validation). The
convention reads that from the engine's `IsRelational` capability, and the skip exists precisely so
the same configuration body stays portable to Cosmos with no edits.

The most important property of this convention: when every entity collapses onto one database (the
monolith case), nothing is foreign and the convention is a structural no-op. The degraded model is
byte-for-byte the single-database model. The boundary exists and is tested, but it costs nothing when
unused.

## Keeping a cross-source predicate translatable

Degrading the relationship solves the schema. It does not solve the *query*. Suppose you want all
sessions whose event is published. Written the obvious way, that is a navigation:

```csharp
// Not translatable once Session and Event live in different engines.
s => s.Event.IsPublished
```

Once `Session` is in Cosmos and `Event` is in SQL Server, EF cannot translate that. The navigation has
been degraded out of the Cosmos model entirely. You cannot JOIN across physical sources, full stop.

The engine-portable answer is **resolve-then-filter-by-FK**, and the framework packages it in
`CrossSourceSpecification`. Its single `BuildAsync` method does two things. First it resolves the
matching principal keys: it runs a scalar query against the principal's *own* data source (here, "give
me the ids of all published events") and materializes them into a list. Then it returns an
`InlineSpecification` whose criteria is the engine-portable expression
`localPredicate AND principalKeys.Contains(dependent.ForeignKey)`. Every provider translates that:
SQL Server emits an `IN` clause, Cosmos emits `ARRAY_CONTAINS`.

```csharp
// Engine-portable. Works whether Session is on SQL Server, PostgreSQL, SQLite, or Cosmos.
var spec = await CrossSourceSpecification.BuildAsync<Session, SessionIdentifierType,
                                                     Event, EventIdentifierType>(
    unitOfWork,
    principalPredicate: e => e.IsPublished,        // run against Event's source
    dependentForeignKey: s => s.EventId,           // the surviving scalar FK on Session
    localPredicate: s => !s.IsCancelled);          // optional local filter
```

Two details make this honest rather than magic. The predicate is combined with `Expression.AndAlso`,
not `Expression.Invoke`, so the resulting tree stays translatable on every provider (an
`ExpressionVisitor` rebinds the local predicate onto the FK selector's parameter so the two trees
share one lambda parameter). And the returned `InlineSpecification` drops straight into the existing
`IEntityQueryService` / read-repository `specification` argument, so the rest of the read pipeline does
not know anything unusual happened. ADC Conference's public-session filter
(`GetPublicSessionFilterHandler`, built on `CrossSourceSpecification.BuildAsync`) is written this way:
it resolves published `Event` ids and filters `Session.EventId IN (...)`, which is portable across all
four engines.

There is even a fitness rule that enforces this discipline: an opt-in
`SpecificationsDoNotNavigateToOtherEntities` test fails the test run if a specification navigates
across an entity boundary the way the un-translatable version above does.

## The honest adoption note

Here is the part most articles would quietly omit. All of the above is shipped and tested, and the
engine-agnostic plumbing is in production: every ADC entity configuration runs through the engine-aware
base, the degrade convention is registered on every context (a structural no-op there, since nothing
is foreign), and `CrossSourceSpecification.BuildAsync` answers ADC's public session reads. What is not
in production is a second engine. No production entity routes to anything other than SQL Server.

Today, every current production entity configuration uses the `EntityTypeConfigurationSQLServer`
base. ADC runs SQL Server only, across four databases (the Name axis), with no entity on PostgreSQL,
Cosmos, or SQLite in production. The SQLite engine backs the fast test database in MMCA.Common's own
infrastructure tests, and the Cosmos engine path is exercised by a portability test whose
configuration declares `[UseDataSource(DataSource.CosmosDB)]` on the engine-aware base. ADC
Conference actually *trialed* the `Session`-to-Cosmos and `Room`-to-SQLite move (the worked example
throughout this article): it was built and locally tested, then **deliberately reverted to
all-SQL-Server**, with every framework extension point kept in place. The unified base and its four
engine strategies, the cross-source degrade convention, the Cosmos-index skip, the `EnsureCreated`
path for a source that names no migrations assembly (always on Cosmos, and on SQLite or PostgreSQL
until one is configured), the cross-source specification, and the fitness rule are all in place and
green.

So treat PostgreSQL, Cosmos, and SQLite as supported, exercised extension points rather than dormant
ones, but do not read this as "ADC is polyglot in production." It is not. The capability is real and
has been trialed end to end, but no production entity routes to a non-SQL-Server engine today. Saying
so is the point of the §8 evaluation:
plumbing that is load-bearing on one engine is a different thing from an entity that a second engine
serves in daily production, and conflating them is how architecture diagrams start lying.

## Trade-offs, honestly

- **Cosmos has no JOINs, and the framework does not pretend otherwise.** The whole
  resolve-then-filter-by-FK machinery exists *because* you cannot join across containers or across
  physical sources. Cross-source navigation goes through batch loaders, and cross-source consistency
  is the outbox's job (ADR-003), not a transaction's. There is no two-phase commit across engines, and
  Cosmos has no database transactions at all (nor raw SQL, nor `Any(predicate)` translation), so a
  handler that relies on one of them is not portable to Cosmos.
- **`CrossSourceSpecification` fits bounded principal sets.** It materializes the matching principal
  keys and embeds them in the predicate. That is ideal for "published events" or "active tenants," but
  an unbounded principal set would inline a very large `IN` list. The class documents this limit
  explicitly; it is a tool for the common bounded shape, not a general join replacement.
- **Concurrency tokens differ by engine.** Each strategy declares its row-version strategy. SQL Server
  maps `RowVersion` to a server-generated `rowversion`; SQLite has no server-generated equivalent, so
  the same token is client-stamped there, and PostgreSQL takes that same client-stamped token rather
  than its native `xmin`, so it is not the one engine whose entity shape differs (ADR-113). Cosmos
  declares no row-version strategy at all, so a Cosmos-stored entity has no optimistic-concurrency
  token. The entity model is one, but the concurrency mechanics underneath are not identical across
  engines, and you should know which you are getting.
- **Cosmos has no durable outbox.** The outbox path runs only when the context's engine reports
  `IsRelational` (and the host has the outbox enabled). Cosmos reports `IsRelational: false`, and
  `CosmosDbContext` leaves `OutboxMessage` out of its model, so domain events from a Cosmos-stored
  aggregate are dispatched in-process only, with no durable outbox row to replay from. That is a real
  reliability difference from the relational path, and it is a deliberate consequence of Cosmos having
  no relational `OutboxMessages` table.
- **One engine in production, not four.** As above: the plumbing runs in production on SQL Server, ADC
  trialed the Cosmos/SQLite move and rolled it back to all-SQL-Server, and no production entity is
  served by a second engine.
  Validate the engine behavior you depend on against your own data before you lean on it in production.

None of these are reasons to weld the engine choice back into the entity. They are the reasons to keep
the engine choice in one attribute, where you can see it, test it, and change it.

## Apply this even without MMCA

The pattern ports to any stack with EF Core or a comparable configuration-driven ORM:

1. Keep the **entity engine-free**. The domain class is a plain object. The persistence engine is a
   property of the *configuration*, not the entity.
2. Put the engine choice behind a **single attribute or base class**, and make a missing engine a
   **startup error**, never a silent default. Loud beats subtle.
3. **Give each engine one strategy object** that answers every engine question (mapping, capabilities,
   dialect), looked up by the engine value, so call sites read engine facts instead of branching on
   the engine. A new engine is then one class and one registry line, and a text-scan test can keep new
   branches from creeping back into call sites.
4. **Degrade cross-engine relationships automatically** at model-build time: drop the impossible
   constraint, keep the scalar FK column, and make it a no-op when everything is on one engine.
5. For cross-engine filters, **resolve principal keys first, then filter by `foreignKey IN (keys)`**.
   That predicate is translatable on every engine; a navigation is not.
6. **Document the adoption state honestly.** "Built and tested" and "running in production" are
   different claims. Say which one you mean.

The takeaway: **an entity should not know what database it lives in. Move the engine choice into one
attribute and the storage technology becomes a reversible decision instead of a permanent one, even if
you do not flip it on day one.**

---

**What we covered:** why welding an entity to a storage engine is an expensive, usually irreversible
decision, how MMCA.Common's engine-aware `EntityTypeConfiguration` base, its four per-engine
strategies, and four thin `EntityTypeConfigurationSQLServer/PostgreSQL/Cosmos/Sqlite` shims re-point
the same entity to a different engine through one `[UseDataSource]` attribute, how
`CrossDataSourceDegradeConvention` and `CrossSourceSpecification` keep cross-engine relationships and
predicates working without rewrites, and the honest note that the plumbing runs in ADC production while
every production entity lives on SQL Server.

**Next in the series:** navigation populators, the batch-loader that replaces EF Include chains
once a relationship crosses a data-source boundary.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the persistence chapter of the
onboarding guide, or `dotnet add package MMCA.Common.Infrastructure` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, C Sharp, Software Architecture, Databases, EF Core*

*Notes: re-verified 2026-10-08 against MMCA.Common v1.233.0 (`MMCA.Common/FACTS.md:14`) and the ADR
record. Changed this run: the "None of it is running in production yet" adoption claim (body, subtitle,
trade-off bullet, recap) now follows ADR-018, which records the engine-agnostic plumbing as shipped to
production and load-bearing with no production entity on a non-SQL-Server engine
(`Website/docs-src/adr/018-polyglot-persistence.md:6-8`, `:12-13`): every ADC configuration derives
from `EntityTypeConfigurationSQLServer` (30 under `MMCA.ADC/Source`, zero Cosmos/Sqlite/PostgreSQL
bases in ADC or Store) and so runs through the engine-aware base
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:77`),
the degrade convention is registered on every context
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:387`),
and `CrossSourceSpecification.BuildAsync` runs on ADC read paths
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:29`,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Common/PublicConferenceVisibility.cs:63`,
called from `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/Sessions/SessionsController.cs:81`).
"That is the change" / "one-token change" now names the host side too: ADR-018 counts connection
strings and one AppHost helper line (`018-polyglot-persistence.md:11-12`), and an unconfigured target
engine is substituted (`DataSourceResolver.cs:128-129`). "Handlers do not change" is now conditional on
the engine's capabilities, and the Cosmos trade-off names the missing transactions, raw SQL and
`Any(predicate)` translation
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/DataSourceEngineCapabilities.cs:14-19`,
`CosmosDataSourceEngine.cs:13-16`). The Cosmos compensating-index skip is no longer attributed to
ADR-018 (ADR-018 items 5-6 at `018-polyglot-persistence.md:115-133` only say indexes are stripped);
it is the convention's own `IsRelational` read
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:66`,
rationale `:102-105`). Anchors corrected in place below: outbox gating, ADR-113 ordinals, `xmin`, and
no-shipped-PostgreSQL lines, and the resolver substitution range. Earlier pass: re-verified 2026-10-02
against MMCA.Common v1.221.0 source and the ADR record (the per-engine strategy shipped in v1.218.0,
ADR-130). Re-read in that pass: the engine-aware base implements the four
provider marker interfaces
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:27-32`),
throws `InvalidOperationException` when `[UseDataSource]` is missing (`:43-46`), records
`EffectiveEngine` (`:48-49`, documented at `:54-61`), and its `protected static ApplyEngineConventions`
(`:69`, rationale comment `:73-76`) is the single call
`DataSourceEngines.For(engine).ApplyKeyAndTableMapping<TEntity, TIdentifierType>(builder)` (`:77`).
The contract is `IDataSourceEngine`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/IDataSourceEngine.cs:18`,
`Capabilities` `:74`, `ApplyKeyAndTableMapping` `:95-97`); the static registry is `DataSourceEngines`
(`DataSourceEngines.cs:19`, four engines in one array `:22-28`, frozen lookup `:30-31`, `For` throws
`InvalidOperationException` for an unregistered value `:40-43`, fifth engine = one class plus one line
`:15-16`, static rather than DI `:9-12`). Per-engine mappings (all in `.../DataSources/Engines/`):
`SQLServerDataSourceEngine.cs:94-107` (table + module schema `:101`, "Shared verbatim with PostgreSQL"
`:100`, `ValueGeneratedOnAdd` `:104`), `PostgreSQLDataSourceEngine.cs:98-103` ("Deliberately identical
to SQL Server" `:98`), `SqliteDataSourceEngine.cs:97-100` (no schema, `UseIdentityColumn(1, 1)`),
`CosmosDataSourceEngine.cs:86-102` (container per module `:94-96`, `CosmosIntIdValueGenerator` `:99`).
Capabilities: SQL Server `MigrationPolicy.Always` / `StoreGenerated` (`SQLServerDataSourceEngine.cs:42`,
`:46`), PostgreSQL and SQLite `WhenAssemblyConfigured` / `ClientStamped`
(`PostgreSQLDataSourceEngine.cs:40`, `:44`; `SqliteDataSourceEngine.cs:39`, `:43`), Cosmos `Never` /
`IsRelational: false` / `RowVersionStrategy.None` (`CosmosDataSourceEngine.cs:42-46`); the policy enum
is `MigrationPolicy.cs:8-20`. The branching gate is
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DataSourceBranchingFitnessTests.cs:71`
(stale allow-list entries `:83`). The four shims are semicolon-terminated declarations:
`EntityTypeConfigurationSQLServer.cs:16-20`, `EntityTypeConfigurationPostgreSQL.cs:21-22`,
`EntityTypeConfigurationSqlite.cs:16-17`, `EntityTypeConfigurationCosmos.cs:17-18`.
`EntityDataSourceRegistry`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21-23`)
is built lazily and rescanned once on a miss (`:16-17`, `:61-63`) over a `FrozenDictionary` of
`DataSourceKey` (`:25-28`). Engine substitution for an unconfigured engine is
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:109-129`.
Outbox gating is `context.Engine.Capabilities.IsRelational && outboxEnabled`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:257`,
in-process-only branch `:292-298`, synchronous save path `:141`); `CosmosDbContext` ignores `OutboxMessage` (`CosmosDbContext.cs:124`);
`SupportsOutbox` has no hit under `Persistence/DbContexts` and ADR-130 records its removal
(`Website/docs-src/adr/130-per-engine-data-source-strategy.md:91-95`). The Cosmos engine test is
`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:101-103`.
ADR-130 status and refinement of ADR-018/113: `130-per-engine-data-source-strategy.md:3-8`. ADR-113:
accepted and revised `Website/docs-src/adr/113-postgresql-as-a-first-class-engine.md:4-7`, `xmin`
rejected for the shared client-stamped token `:194-198`, no shipped application on PostgreSQL (advisory
Helpdesk canary only) `:232-235`. The ADC trial-and-revert is recorded at
`Website/docs-src/adr/018-polyglot-persistence.md:8-10` (moved from the adc scorecard section 8 note,
which no longer mentions it). Changed in the 2026-10-02 pass: the enum `switch` description, the `default: throw`
branch, the `SupportsOutbox` override, the "resolved once at startup" registry wording, the
SQLite-only `EnsureCreated` attribution, and the "Cosmos base ... factory test" coverage claim were
replaced with the source above; Cosmos's missing concurrency token and the engine-substitution nuance
were added. Carried forward without a re-read in either pass:
`DataSource` ordinals (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:22`;
ADR-113 `:55-59`), `CrossDataSourceDegradeConvention`, `CrossSourceSpecification.BuildAsync`,
`NamespaceConventions`, the four sealed context declarations, the
`SpecificationsDoNotNavigateToOtherEntities` rule, `GetPublicSessionFilterHandler`, and ADC's
all-SQL-Server configurations. The `SessionConfiguration` / `Session` / `Event` code snippets are
illustrative of the shape described in the source, not copied verbatim from a single cited file.*

- Full series index: https://ivanball.github.io/writing.html
