# One entity model, four databases: polyglot persistence behind a single attribute

> Series: MMCA.Common · Article #11 (deep-dive) · Pillar P3 · Group G07,G03 · Rubric §8 · ADR-018, ADR-113 ·
> Status: grounded in `Website/docs-src/onboarding/group-07-persistence-ef-core.md`,
> `group-03-querying-specifications.md`, ADR-018, ADR-113. No em dashes.

**Subtitle:** A domain entity should not know which database engine stores it. Here is a design where
the same entity moves between SQL Server, PostgreSQL, Cosmos DB, and SQLite by changing one attribute,
with zero edits to the domain or application layer, plus the honest note that the machinery is shipped
and tested but not yet running in production.

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
thin base classes. Moving an entity between engines is a one-token change, and nothing above the
configuration class has to know it happened.

## Two axes, not one

This is the companion to the database-per-service article (Article 10), and the two are deliberately
orthogonal. It helps to name the axes.

Database-per-service (ADR-006) is the **Name axis**: *which physical database* owns an entity, so that
the Conference module's data and the Engagement module's data sit in separate databases that can be
deployed and scaled independently. Article 10 covers that axis in full.

Polyglot persistence (ADR-018, extended to a fourth engine by ADR-113) is the **Engine axis**: *which
storage technology* backs an entity, SQL Server vs PostgreSQL vs Cosmos DB vs SQLite, independent of
which logical database it belongs to. The two compose. An entity has a Name (its database) and an
Engine (its technology), and you can change one without touching the other. This article is about the
Engine axis.

## The configuration hierarchy: where the engine lives

Every entity in the framework gets an EntityConfiguration class. The relevant inheritance chain is
short and worth holding in your head.

At the bottom is `EntityTypeConfigurationBase<TEntity, TIdentifierType>`. It does exactly one
cross-cutting thing: if the entity is an aggregate root, it tells EF to ignore the in-memory
`DomainEvents` collection so EF never tries to persist it. That is all. It knows nothing about
engines.

Above it sits the piece that ADR-018 added: a single, engine-aware
`EntityTypeConfiguration<TEntity, TIdentifierType>` base. This one class carries *all* the
table-versus-container, schema, and key-mapping logic for every engine. Its `Configure` method reads
the `[UseDataSource(...)]` attribute off the concrete configuration, and if the attribute is absent it
throws `InvalidOperationException` at startup. A configuration with no declared engine is a hard error,
not a silent default. Then it dispatches to a `protected static ApplyEngineConventions` helper that is
a `switch` over the engine, four cases in three branches:

- **SQL Server and PostgreSQL**, one shared branch deliberately: `ToTable(Name, schema)` where the
  schema is the module name derived from the entity's namespace (the segment before "Domain"),
  `HasKey(Id)`, and identity-column key generation. PostgreSQL takes the SQL Server mapping unchanged,
  module schema and PascalCase identifiers included, so an entity moves between the two engines by
  changing its configuration base class and nothing else (ADR-113). PostgreSQL house style (snake_case,
  the public schema) is a consumer's naming-convention plugin, not a framework decision.
- **SQLite**: `ToTable(Name)` with no schema, `HasKey(Id)`, and SQLite identity columns.
- **Cosmos DB**: `ToContainer(moduleName).HasPartitionKey(Id)`, one container per module so a module's
  entities and their relationships co-locate, `HasKey(Id)`, and a client-side
  `CosmosIntIdValueGenerator` for keys (Cosmos has no server-side `IDENTITY`).
- **Anything else**: a `default` branch that throws `InvalidOperationException`. An engine with no
  mapping fails loudly instead of falling through to a relational guess.

Key generation is conditional in every branch: the engine's generator applies only when the entity's
identifier is store-generated (`typeof(TEntity).IsIdValueGenerated`), and otherwise the key is
`ValueGeneratedNever()`, so an entity that supplies its own ids keeps them on every engine.

On top of that single base sit four **thin shims**: `EntityTypeConfigurationSQLServer`,
`EntityTypeConfigurationPostgreSQL`, `EntityTypeConfigurationCosmos`, and
`EntityTypeConfigurationSqlite`. Each one is a one-line class. Its entire body is the attribute plus an
empty derivation. Here is the SQL Server shim, near enough verbatim:

```csharp
[UseDataSource(DataSource.SQLServer)]
public abstract class EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>
    : EntityTypeConfiguration<TEntity, TIdentifierType>
    where TEntity : AuditableBaseEntity<TIdentifierType>
    where TIdentifierType : notnull
{
    // no Configure override; all mapping lives in the engine-aware base
}
```

The PostgreSQL, Cosmos, and SQLite shims are identical except for the attribute value
(`DataSource.PostgreSQL`, `DataSource.CosmosDB`, `DataSource.Sqlite`). They exist purely so that a
consumer can express the engine choice by *which base class they derive from*, without ever typing the
attribute themselves.

## The entity move is one token

So what does it take to move `Session` from SQL Server to Cosmos? You change its configuration's base
class from `EntityTypeConfigurationSQLServer<Session, ...>` to
`EntityTypeConfigurationCosmos<Session, ...>`. Or, equivalently, you derive from the engine-aware base
directly and put `[UseDataSource(DataSource.CosmosDB)]` on the class. That is the change.

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

The `Session` entity class does not change. The command handlers do not change. The query handlers do
not change. The DTOs and mappers do not change. The engine is resolved once at startup by the
`EntityDataSourceRegistry`, which reflects over the configuration assemblies, reads each config's
`[UseDataSource]` attribute, and records the engine in a frozen lookup. The right `DbContext`
(`SQLServerDbContext`, `PostgreSQLDbContext`, `CosmosDbContext`, or `SqliteDbContext`, all sealed
subclasses of the abstract `ApplicationDbContext`, one class per engine) is then built per data source,
and the whole save and query pipeline routes through it without any caller knowing which engine
answered.

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
every property and rejects explicit index definitions (adding one would fail model validation). That
Cosmos-index skip was added with ADR-018 precisely so the same configuration body stays portable to
Cosmos with no edits.

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
`SpecificationsDoNotNavigateToOtherEntities` test fails the build if a specification navigates across
an entity boundary the way the un-translatable version above does.

## The honest adoption note

Here is the part most articles would quietly omit. All of the above is shipped and tested. None of it
is running in production yet.

Today, every current production entity configuration uses the `…SQLServer` base. ADC runs SQL Server
only, across four databases (the Name axis), with no entity on PostgreSQL, Cosmos, or SQLite in
production. The SQLite base backs the fast test database in MMCA.Common's own infrastructure tests;
the Cosmos base is exercised by portability tests and a factory test. ADC Conference actually *trialed* the `Session`→Cosmos
and `Room`→SQLite move (the worked example throughout this article): it was built and locally tested,
then **deliberately reverted to all-SQL-Server**, with every framework extension point kept in place. The unified
base, the cross-source degrade convention, the Cosmos-index skip, the SQLite `EnsureCreated` path, the
cross-source specification, and the fitness rule are all in place and green.

So treat PostgreSQL, Cosmos, and SQLite as supported, exercised extension points rather than dormant
ones, but do not read this as "ADC is polyglot in production." It is not. The capability is real and
has been trialed end to end, but no production entity routes to a non-SQL engine today. Saying so is
the point of the §8 evaluation:
an extension point that is built and tested but not yet load-bearing is a different thing from one that is in daily
production, and conflating them is how architecture diagrams start lying.

## Trade-offs, honestly

- **Cosmos has no JOINs, and the framework does not pretend otherwise.** The whole
  resolve-then-filter-by-FK machinery exists *because* you cannot join across containers or across
  physical sources. Cross-source navigation goes through batch loaders, and cross-source consistency
  is the outbox's job (ADR-003), not a transaction's. There is no two-phase commit across engines.
- **`CrossSourceSpecification` fits bounded principal sets.** It materializes the matching principal
  keys and embeds them in the predicate. That is ideal for "published events" or "active tenants," but
  an unbounded principal set would inline a very large `IN` list. The class documents this limit
  explicitly; it is a tool for the common bounded shape, not a general join replacement.
- **Concurrency tokens differ by engine.** SQL Server maps `RowVersion` to a server-generated
  `rowversion`; SQLite has no server-generated equivalent, so the same token is application-managed
  there, and PostgreSQL takes that same application-managed token rather than its native `xmin`, so it
  is not the one engine whose entity shape differs (ADR-113). The entity model is one, but the
  optimistic-concurrency mechanics underneath are not
  identical across engines, and you should know which you are getting.
- **Cosmos has no durable outbox.** `CosmosDbContext` overrides `SupportsOutbox` to `false`. Domain
  events from a Cosmos-stored aggregate are dispatched in-process only, with no durable outbox row to
  replay from. That is a real reliability difference from the relational path, and it is a deliberate
  consequence of Cosmos having no relational `OutboxMessages` table.
- **Trialed, then reverted, not deployed.** As above: the extension points are built and tested, ADC trialed the
  Cosmos/SQLite move and rolled it back to all-SQL-Server, and no production polyglot entity has shipped.
  Validate the engine behavior you depend on against your own data before you lean on it in production.

None of these are reasons to weld the engine choice back into the entity. They are the reasons to keep
the engine choice in one attribute, where you can see it, test it, and change it.

## Apply this even without MMCA

The pattern ports to any stack with EF Core or a comparable configuration-driven ORM:

1. Keep the **entity engine-free**. The domain class is a plain object. The persistence engine is a
   property of the *configuration*, not the entity.
2. Put the engine choice behind a **single attribute or base class**, and make a missing engine a
   **startup error**, never a silent default. Loud beats subtle.
3. **Centralize the per-engine mapping** in one place (one `switch` over the engine), so the four
   engine shims share identical logic and cannot drift.
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
decision, how MMCA.Common's engine-aware `EntityTypeConfiguration` base plus four thin
`…SQLServer/PostgreSQL/Cosmos/Sqlite` shims re-point the same entity to a different engine through one
`[UseDataSource]` attribute, how `CrossDataSourceDegradeConvention` and `CrossSourceSpecification` keep
cross-engine relationships and predicates working without rewrites, and the honest note that this is
shipped and tested but not yet running in ADC production.

**Next in the series:** navigation populators, the batch-loader that replaces EF Include chains
once a relationship crosses a data-source boundary.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the persistence chapter of the
onboarding guide, or `dotnet add package MMCA.Common.Infrastructure` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, C Sharp, Software Architecture, Databases, EF Core*

*Notes: verified this run against MMCA.Common v1.205.0 source and the ADR record. The engine set is
four: `DataSource` is an enum of `CosmosDB`, `Sqlite`, `SQLServer` (lines 12 and 15) and `PostgreSQL`,
appended last rather than inserted alphabetically so the three shipped ordinals stay fixed
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:22`;
the ordinal argument is `Website/docs-src/adr/113-postgresql-as-a-first-class-engine.md:52-56`).
`UseDataSourceAttribute` / `[UseDataSource]` and `EntityTypeConfigurationBase<TEntity, TIdentifierType>`
are unchanged. The engine-aware `EntityTypeConfiguration<TEntity, TIdentifierType>` base implements the
four provider marker interfaces `IEntityTypeConfigurationSQLServer` / `IEntityTypeConfigurationPostgreSQL`
/ `IEntityTypeConfigurationSqlite` / `IEntityTypeConfigurationCosmos`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:29-34`),
throws `InvalidOperationException` when the attribute is missing (`:45-48`) and dispatches to
`protected static ApplyEngineConventions` (`:59`), whose `switch` is four cases in three branches:
`case DataSource.SQLServer:` and `case DataSource.PostgreSQL:` share one mapping branch deliberately
(`:72-73`, with the in-code rationale at `:67-71`), then `DataSource.Sqlite` (`:82`), then
`DataSource.CosmosDB` (`:91`), then `default: throw` (`:104`). Key generation in every branch is
conditional on `typeof(TEntity).IsIdValueGenerated` (`:63`) and falls back to `ValueGeneratedNever()`.
The four shims are `EntityTypeConfigurationSQLServer` (`EntityTypeConfigurationSQLServer.cs:17`),
`EntityTypeConfigurationPostgreSQL` (`EntityTypeConfigurationPostgreSQL.cs:22`, carrying
`[UseDataSource(DataSource.PostgreSQL)]`), `EntityTypeConfigurationSqlite`
(`EntityTypeConfigurationSqlite.cs:17`) and `EntityTypeConfigurationCosmos`
(`EntityTypeConfigurationCosmos.cs:18`). The four sealed contexts over the abstract
`ApplicationDbContext` are `SQLServerDbContext`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:15`),
`PostgreSQLDbContext` (`PostgreSQLDbContext.cs:23`, whose mapping conventions deliberately match the
SQL Server ones, `:15-21`), `CosmosDbContext` (`CosmosDbContext.cs:15`, `SupportsOutbox => false`) and
`SqliteDbContext` (`SqliteDbContext.cs:12`). Also carried forward from the previous verification:
`EntityDataSourceRegistry`, `CrossDataSourceDegradeConvention` (Cosmos compensating-index skip),
`CosmosIntIdValueGenerator`, `NamespaceConventions`, `CrossSourceSpecification.BuildAsync` returning
`InlineSpecification` (`localPredicate AND principalKeys.Contains(fk)`, `Expression.AndAlso` not
`Expression.Invoke`), and the `SpecificationsDoNotNavigateToOtherEntities` fitness rule. PostgreSQL
arrives as the fourth first-class engine in ADR-113 (accepted 2026-09-09,
`Website/docs-src/adr/113-postgresql-as-a-first-class-engine.md:4-6`); that record also rejects
`xmin` as the concurrency token in favor of the framework's application-managed `RowVersion`
(`:177-181`). Honest gaps: ADC runs SQL Server only in production (all current production configs use
the SQLServer base); the ADC Conference Session-to-Cosmos / Room-to-SQLite move was trialed (built and
locally tested) then deliberately reverted to all-SQL-Server with the extension points kept, per the
`Website/docs-src/governance/adc-ArchitectureScorecard.md` section 8 note; and ADR-113 records that
PostgreSQL is not yet exercised by a consumer either (`:212-213`). Carried forward without a re-read
this run: the "portability tests and a factory test" description of the Cosmos test coverage, and the
attribution of the `EnsureCreated` path to SQLite rather than to a data source that names no
migrations assembly. The `SessionConfiguration` / `Session` / `Event` code snippets are illustrative of
the shape described in the source, not copied verbatim from a single cited file.*

- Full series index: https://ivanball.github.io/writing.html
