# 7. Persistence & EF Core

**What this group covers.** This is the framework's data-access engine: everything between a domain
aggregate and a row in a database. It is the single largest group in the guide because it carries a lot
of load. One abstract [`ApplicationDbContext`](#applicationdbcontext) base with a sealed subclass per
engine ([`SQLServerDbContext`](#sqlserverdbcontext), [`CosmosDbContext`](#cosmosdbcontext),
[`SqliteDbContext`](#sqlitedbcontext)); two EF Core save interceptors that turn a plain
`SaveChangesAsync` into audit stamping plus transactional domain-event capture; a small repository
family behind an interface-segregated contract ([`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype),
[`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype),
[`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype)) coordinated by a
[`UnitOfWork`](#unitofwork); a data-source routing layer that lets every entity resolve to its own
physical database ("database per service"); two model-finalizing conventions that keep that routing
honest; an engine-portable entity-configuration hierarchy; and a supporting cast of value generators,
an encryption converter, seeders, and design-time factories. The group also hosts the framework's
non-EF storage-adjacent services: blob storage, image normalization, native push registration and
delivery, and the shared periodic-sweep base class. The whole thing is the
`[Rubric §8, Data Architecture]` chapter of the codebase, and it leans hard on
`[Rubric §7, Microservices Readiness]` and `[Rubric §3, Clean Architecture]`.

## One base context, one class per engine, one instance per database

[`ApplicationDbContext`](#applicationdbcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:35`)
is an abstract primary-constructor class over EF's `DbContext`. It holds the cross-cutting model
configuration that every engine shares: it applies a global soft-delete query filter to every non-owned
[`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) using a runtime-built
expression tree, registered as a named `"SoftDelete"` filter (`ApplicationDbContext.cs:243-257`);
it configures the `RowVersion` optimistic-concurrency token, mapped as a SQL Server `rowversion` or as
a plain application-managed token on other providers (`ApplicationDbContext.cs:270-290`); and it maps
the outbox and inbox tables so every relational database carries its own
([`OutboxMessage`](group-04-events-outbox.md#outboxmessage) at `ApplicationDbContext.cs:297-321`,
[`InboxMessage`](group-04-events-outbox.md#inboxmessage) at `ApplicationDbContext.cs:328-342`), each
with the two filtered indexes the poll path and the retention sweep need
(`IX_OutboxMessages_Pending` at `:310-313`, `IX_OutboxMessages_Processed` at `:318-320`). It also
registers four keyless [`ValReturn<T>`](#valreturnt) shapes (`ApplicationDbContext.cs:52`,
`224-227`) so raw SQL scalar queries have somewhere to land. Its `SaveChangesAsync(userId, ...)`
overload (`ApplicationDbContext.cs:80-94`) is the one entry point handlers care about: it stashes the
current user id in `CurrentSaveUserId` so the audit interceptor can read it, delegates to `base`, then
clears it in a `finally` so a later internal save cannot silently reuse the previous caller's identity.
The base also overrides both `SaveChanges` overloads purely to run change detection once per save and
suppress it for the rest, through the `DetectChangesOnce` helper and its
[`DetectChangesScope`](#detectchangesscope) disposable (`ApplicationDbContext.cs:100-173`): each
interceptor's `ChangeTracker.Entries<T>()` call would otherwise trigger a full `DetectChanges`, so a
save paid three snapshot comparisons where one suffices, and the previous auto-detect setting is
restored on the way out.

The design decision that shapes this whole group is stated in the base's own doc comment: **one context
class per engine, one instance per physical data source** (`ApplicationDbContext.cs:24-29`). The same
[`SQLServerDbContext`](#sqlserverdbcontext) class
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:13`)
is instantiated once per SQL Server database, each instance carrying a different
[`PhysicalDataSource`](#physicaldatasource) (connection string, migrations assembly, Cosmos database
name). To keep EF from silently reusing the first-built model for every database,
[`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16`)
keys EF's model cache by context type plus physical source name plus the design-time flag, and is
installed by the base in `OnConfiguring` (`ApplicationDbContext.cs:190`). This is deliberately not a
per-module context split: one sealed context per engine over the abstract base is [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)'s ruling.
`SQLServerDbContext` adds the provider-specific touches: transient-fault retry (`EnableRetryOnFailure`
with 5 attempts and a 10-second cap, `SQLServerDbContext.cs:41-44`) and a suppressed
`PendingModelChangesWarning` (`SQLServerDbContext.cs:57`) so an extracted service that registers only
its own module's entity configurations starts cleanly against a migration snapshot that captures every
module's tables. That warning suppression is a direct `[Rubric §7, Microservices Readiness]` decision,
and the source comment states the trade-off plainly: monolith hosts lose the "you forgot a migration"
safety net, so CI is expected to run `dotnet ef migrations has-pending-model-changes` as a separate
gate (`SQLServerDbContext.cs:46-56`). The retry comment also carries a rule the rest of the group
depends on: with retry-on-failure enabled a manual `BeginTransactionAsync` must run inside
`Database.CreateExecutionStrategy().ExecuteAsync` (`SQLServerDbContext.cs:38-40`).

## SaveChanges as an interceptor pipeline

The base context resolves two EF Core `SaveChangesInterceptor`s from DI in `OnConfiguring`
(`ApplicationDbContext.cs:183-185`), and together they turn a bare save into the framework's
audit-plus-outbox flow. [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:13`)
runs on `SavingChanges`: it walks every tracked
[`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), stamps `CreatedOn/By` plus
`LastModifiedOn/By` on `Added` (`:47-52`), and on `Modified` marks the two `Created*` properties
unmodified before re-stamping `LastModified*` (`:53-58`), reading the timestamp from an injected
`TimeProvider` and the user id from `CurrentSaveUserId` (falling back to `default` as the
system-operation sentinel, `AuditSaveChangesInterceptor.cs:40-41`). This is why the domain declares
audit fields with private setters and never writes them: the interceptor sets them centrally through
`entry.Property(...).CurrentValue`, bypassing setter visibility. That is the
`[Rubric §10, Cross-Cutting Concerns]` payoff, one enforcement point instead of copy-paste in every
handler.

[`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:38`)
is the producer end of the outbox, and it is the most subtle type in the group. On `SavingChanges` it
snapshots each tracked [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) and its
pending [`IDomainEvent`](group-04-events-outbox.md#idomainevent)s into an
[`AggregateCapture`](#aggregatecapture) record (`:153-156`, record at `:303`), then writes an
[`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row for each event into the same context,
so the events land in the database **in the same transaction** as the aggregate changes
(`DomainEventSaveChangesInterceptor.cs:143-202`). The routing split happens right there: an
[`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) gets a row but no in-process
dispatch (its row stays unprocessed so the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor)
publishes it over [`IMessageBus`](group-04-events-outbox.md#imessagebus)), while a local event gets both
a row and the fast in-process path (`:167-198`). Before capturing, `DiscardAbandonedCapture` detaches
the `Added` outbox rows left by a previous `SavingChanges` that never reached `SavedChanges`
(`:209-226`), which is what stops an execution-strategy retry from writing a second row per event and
publishing every integration event twice. The captured state is parked in a
[`CapturedState`](#capturedstate) record (`:312`) held in a `ConditionalWeakTable` keyed by context
(`:48`), so it is cleaned up automatically when the context is disposed.

After the save, `SavedChangesAsync` does one of two things (`DomainEventSaveChangesInterceptor.cs:232-249`).
With no ambient transaction it flushes immediately: dispatch local events through
[`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher), remove exactly the
captured events from their aggregates, mark the local outbox rows processed, and signal the outbox for
integration events (`:255-283`). With an active transaction it removes the captured events (so a second
save inside the same transaction cannot re-capture them) and parks a
[`DeferredDispatch`](#deferreddispatch) (`:319`) in a second weak table;
[`DbContextFactory`](#dbcontextfactory) then calls the static `FlushDeferredAsync` only after a
successful commit (`:120-129`) and `DropDeferred` on rollback (`:137`). That is what keeps handler side
effects from acting on state that could still roll back, and what keeps a retrying execution strategy
from dispatching the same events once per attempt. Note the precision of the clearing: the interceptor
calls `RemoveDomainEvents(capture.Events)` rather than clearing the aggregate wholesale (`:291-295`),
so an event a handler raises on the same aggregate during in-process dispatch survives to a later
capture instead of being wiped. If in-process dispatch throws, the interceptor logs a warning and
signals the outbox to retry from the persisted rows rather than losing the event (`:269-277`). The
synchronous `SavedChanges` path cannot await a dispatcher at all, so it removes the captured events,
signals the outbox, and leaves delivery entirely to it (`:100-113`). Cosmos DB has no relational outbox
table, so the base exposes a `SupportsOutbox` flag (`ApplicationDbContext.cs:63`) that
[`CosmosDbContext`](#cosmosdbcontext) overrides to `false` (`CosmosDbContext.cs:69`) and the interceptor
honors by dispatching everything in-process instead (`:193-198`). This split, atomic persistence plus
best-effort immediate dispatch with a durable fallback, is the at-least-once contract of [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html); the
consumer end lives in [Group 04](group-04-events-outbox.md).

## Repositories and the unit of work

Handlers do not touch a `DbContext` directly. They ask a [`UnitOfWork`](#unitofwork)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13`) for a repository.
The repository contract is deliberately interface-segregated
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs`, the
contract [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html) states): a handler that only needs a lookup can depend on the narrow
[`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype)
(`IRepository.cs:14`) or [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype)
(`IRepository.cs:64`); [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype)
(`IRepository.cs:110`) combines both plus four `IQueryable` surfaces (tracking, no-tracking,
single-query, split-query, `:116-125`),
[`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype)
(`IRepository.cs:133`) adds mutation, and [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype)
(`IRepository.cs:238`) is the union. That layering is the group's clearest `[Rubric §1, SOLID]`
(interface-segregation) statement, and [`ReadRepositoryExtensions`](#readrepositoryextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10`) adds the
`GetByIdOrFailAsync` convenience that turns a miss into a
[`Result`](group-01-result-error-handling.md#result) failure (`:27-48`). The concrete
[`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype)
(`.../Repositories/EFReadRepository.cs:15`) and
[`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:20`)
wrap an EF `DbSet`. The write side patches already-tracked entities in place through an O(1)
`Local.FindEntry` lookup instead of re-attaching (`EFRepository.cs:51-69`) and seeds `RowVersion`
original values for optimistic concurrency on both the aggregate and any child implementing
[`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) (`EFRepository.cs:79-100`,
[ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Two set-based escape hatches sit beside the tracked path: `ExecuteDeleteAsync`, which the
interface itself documents as bypassing domain events, audit stamps, and soft-delete
(`IRepository.cs:187-197`), and `ExecuteUpdateAsync` (`IRepository.cs:199-221`), the contention-proof
conditional update whose guard predicate lets the database arbitrate two racing callers with no
rowversion retry loop. The latter is described through the persistence-agnostic
[`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) surface and replayed onto EF's setters
builder by [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity)
(`.../Repositories/UpdatePropertySetterBuilder.cs:14`), which is what keeps EF Core out of the
Application layer, and because `ExecuteUpdate` bypasses the interceptor pipeline the repository stamps
`LastModifiedOn/By` itself unless the caller assigned them (`EFRepository.cs:125-136`).

Two factories keep the wiring honest. [`RepositoryFactory`](#repositoryfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:14`)
builds a repository over a given context and conditionally wraps it in a MiniProfiler decorator
([`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype) or
[`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype))
when `UseMiniProfiler` is on (`RepositoryFactory.cs:33-38`, `57-62`), adding timing without the base
repository knowing, and it activates both through a cached compiled `ObjectFactory` rather than
reflecting on every call (`:69-84`). [`DbContextFactory`](#dbcontextfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:18`)
is the scoped coordinator: it caches one [`ApplicationDbContext`](#applicationdbcontext) per
[`DataSourceKey`](#datasourcekey) so every repository in a scope shares one change tracker, and it
enlists a late-created context into an already-open transaction (`DbContextFactory.cs:58-73`). Its save
loop runs up to `MaxSavePasses` (3, `:30`) passes over the cached contexts, because dispatching events
in-process can materialize a context for a source nobody had touched yet (`:109-138`). Because there
can be more than one physical source in play, `ExecuteInTransactionAsync` runs the operation under the
first transactional context's execution strategy, opens a transaction per source, and commits them
sequentially with no two-phase commit (`DbContextFactory.cs:333-410`); cross-source consistency is the
outbox's job. The method is re-entrant: a nested call joins the ambient transaction instead of opening
a second one, so only the outermost call may begin, commit, roll back, or flush (`:344-345`). A
returned failed [`Result`](group-01-result-error-handling.md#result) rolls back exactly like an
exception (`:365-372`), which is what makes [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)'s Result-over-exceptions rule safe for partial
persistence; rollback also drops the deferred event dispatch (`:296-301`), and a retry resets the
change tracker first so the aborted attempt's `Added` entities are not inserted twice (`ResetForRetry`
at `:436-443`). `DbContextFactory` further carries the `SET IDENTITY_INSERT` machinery
([`IdentityInsertGroup`](#identityinsertgroup) at `:258`, the per-table save split at `:149-209`) for
importing entities with explicit database-generated ids one table at a time, and the `MigrateAsync` /
`HasPendingMigrationsAsync` sweeps over every SQL Server source in use (`:413-429`).

[`UnitOfWork`](#unitofwork) sits on top, resolving an entity's physical source through
[`IDataSourceService`](#idatasourceservice), handing the matching context to the factory, and caching the
resulting repository per closed generic interface type (`UnitOfWork.cs:33-66`). The physical creation
itself runs through [`PhysicalDbContextFactory`](#physicaldbcontextfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:16`),
a singleton that switches on the key's engine to construct the right context class
(`PhysicalDbContextFactory.cs:34-45`) and whose doc comment warns it must **never** be pooled, because
each instance carries per-source constructor state that pooling would smear across databases
(`PhysicalDbContextFactory.cs:10-14`). Three thin adapters
([`DefaultSqlServerDbContextFactory`](#defaultsqlserverdbcontextfactory),
[`DefaultSqliteDbContextFactory`](#defaultsqlitedbcontextfactory),
[`DefaultCosmosDbContextFactory`](#defaultcosmosdbcontextfactory), all in
`.../Factory/DefaultEngineDbContextFactories.cs:13-37`) preserve EF's `IDbContextFactory<TContext>` DI
surface for the Default source, and [`ApplicationDbContextEFFactory`](#applicationdbcontexteffactory)
(`.../Factory/ApplicationDbContextEFFactory.cs:14`) picks among them from the `DefaultDataSource` or
`DataSource` configuration key, defaulting to SQL Server (`:29-30`). The interfaces
([`IUnitOfWork`](#iunitofwork), [`IDbContextFactory`](#idbcontextfactory),
[`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory), [`IRepositoryFactory`](#irepositoryfactory))
keep the application layer talking to abstractions.

## Routing an entity to its database

The heart of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) is that every entity resolves to a [`DataSourceKey`](#datasourcekey)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/DataSourceKey.cs:15`), a
`(Engine, Name)` record struct where the [`DataSource`](#datasource) engine
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:6`) is
one of Cosmos DB, SQLite, or SQL Server, and `Name` is a **physical** database name defaulting to
`"Default"` (`DataSourceKey.cs:18-23`). Two layers compute this. [`DataSourceResolver`](#datasourceresolver)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:13`),
the [`IDataSourceResolver`](#idatasourceresolver) singleton
(`.../DataSources/IDataSourceResolver.cs:15`), builds the logical-to-physical map once per engine from
configuration: named sources with no
connection string, or whose connection identity equals the top-level one, **collapse onto the `Default`
source**, so a host with no `DataSources` section behaves exactly like a single-database monolith
(`DataSourceResolver.cs:94-135`), and sources sharing a connection identity collapse onto one canonical
key named after their alphabetically-first member (`DataSourceResolver.cs:172-210`). Identity is the
connection string compared ordinally, with the database name appended for Cosmos because one account
hosts many databases (`:257-260`). It fails fast when two logical names collapsing to one database
declare conflicting migrations assemblies (`DataSourceResolver.cs:229-249`) and logs a warning when a
separate SQL Server source falls back to the Default migrations assembly (`:185-193`).
[`EntityDataSourceRegistry`](#entitydatasourceregistry)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21`),
also a singleton, scans the configuration assemblies and maps each entity to its physical key, deriving
the engine from the `[UseDataSource]` attribute on the **configuration class** and the logical name from
`[UseDatabase]`, the entity's module namespace via [`NamespaceConventions`](#namespaceconventions)`.GetModuleName`,
or `Default` (`EntityDataSourceRegistry.cs:172-185`). It caches an immutable [`Snapshot`](#snapshot)
of frozen collections built on first access (`:25`, `:84-96`), rescans once on a lookup miss when the
assembly set changed so late-loaded module assemblies are picked up (`:98-113`), rejects an entity
claimed by two different sources (`:141-149`), and precomputes the distinct physical sources in use so
the outbox processor's per-poll call allocates nothing (`:81-82`, `:157-160`). Because the registry
reads the same attributes the model configuration reads, routing and model contents agree by
construction, and configurations that implement a provider interface directly without the attributed
base classes are deliberately skipped as legacy (`:174-178`). [`DataSourceService`](#datasourceservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12`) is the thin
application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry), and it answers
the one question navigation loading needs: two entities support EF `.Include()` only when their physical
keys are equal and the engine is not Cosmos (`DataSourceService.cs:31-32`).

## Two model-finalizing conventions

The base context adds both of its conventions in `ConfigureConventions` (`ApplicationDbContext.cs:196-211`),
and each exists because a cross-cutting policy above would otherwise produce an invalid or surprising
model. [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33`,
added at `ApplicationDbContext.cs:205`) is what lets routing be lazy and attribute-driven and still
produce a valid EF model. When a relationship's two ends live in different physical sources it removes
the foreign key (a database cannot enforce an FK into another database), keeps the declared scalar FK
columns plus a compensating index unless an existing index already covers them as a prefix, ignores the
CLR navigation members, and drops the foreign entity types out of this database's model entirely
(`CrossDataSourceDegradeConvention.cs:38-89`, `107-165`). It works through EF's **mutable** model API
rather than convention builders, because the soft-delete and concurrency helpers have already promoted
every entity type to the Explicit configuration source (`:22-24`, `:44-46`), it eagerly drops the
convention-created FK index before the coverage check so the column does not end up unindexed
(`:123-130`), and it skips the compensating index on Cosmos, which auto-indexes everything and rejects
explicit index definitions (`:65`, `:96-105`). Runtime navigation across sources then flows through the
[`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)
batch-loading machinery in [Group 11](group-11-navigation-populators.md). Crucially, when every entity
collapses onto one physical source (the monolith case) nothing is foreign and the convention returns
early (`:52-55`), so the model is identical to the single-database model. That is the property that lets
the same codebase run as a monolith today and as split services later without a rewrite, the core
`[Rubric §7, Microservices Readiness]` claim.

[`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention)
(`.../Conventions/SoftDeleteUniqueIndexConvention.cs:24`, added at `ApplicationDbContext.cs:210`) closes
a smaller but sharper hole. Soft-delete hides a row from queries, but a plain unique index still enforces
uniqueness against it, so "deleting" a speaker would permanently block re-creating one with the same
email. The convention appends an `IsDeleted = 0` filter to every unique index on a soft-deletable entity,
in provider-correct syntax (bracketed for SQL Server, quoted for SQLite), leaves hand-authored filters
untouched, and no-ops for Cosmos (`SoftDeleteUniqueIndexConvention.cs:33-56`). Both conventions run at
model finalization, after module configurations have declared their indexes and after EF's own
relationship discovery, which is why they can see the finished picture.

## Entity configuration and engine portability

Concrete entity configurations derive from the engine-aware
[`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:28`)
or, more commonly, one of the fixed-engine shims like
[`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype)
(`.../EntityTypeConfigurationSQLServer.cs:17`), which is that base annotated
`[UseDataSource(DataSource.SQLServer)]` (`:16`), with
[`EntityTypeConfigurationSqlite<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlitetentity-tidentifiertype)
(`.../EntityTypeConfigurationSqlite.cs:17`) and
[`EntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#entitytypeconfigurationcosmostentity-tidentifiertype)
(`.../EntityTypeConfigurationCosmos.cs:18`) as its two siblings. The base reads the attribute off its
own runtime type
and throws a clear error when it is missing (`EntityTypeConfiguration.cs:43-47`), then applies the
engine's conventions in `ApplyEngineConventions` (`:57-99`): SQL Server gets a table in a module schema
(`:65-72`), SQLite a plain table (`:74-81`), and Cosmos a per-module container with the entity id as
partition key (`:83-94`), each mapping key generation according to the entity's
[`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions)`.IsIdValueGenerated`
marker (`:61`): `ValueGeneratedOnAdd` for database identity, `ValueGeneratedNever` otherwise, or the
[`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator) for Cosmos, which has no server-side identity
and increments a process-level counter seeded from the Unix timestamp
(`.../ValueGenerators/CosmosIntIdValueGenerator.cs:16-25`). Because the engine is a single attribute and
the base implements all three provider marker interfaces
([`IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlservertentity-tidentifiertype),
[`IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlitetentity-tidentifiertype),
[`IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#ientitytypeconfigurationcosmostentity-tidentifiertype),
all over the common [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype)),
**moving an entity between engines is a one-line attribute change with no configuration-body edits**
(`EntityTypeConfiguration.cs:11-24`). The shared
[`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype)
(`.../EntityTypeConfigurationBase.cs:19`) handles the one universal concern: excluding the in-memory
`DomainEvents` collection from mapping (`:29-32`). Discovery runs through
[`ModelBuilderExtensions`](#modelbuilderextensions)`.ApplyAllConfigurations`
(`.../DbContexts/ModelBuilderExtensions.cs:10`, an `extension(ModelBuilder)` block), which the base calls
with an entity filter so each database's model receives only its own entities
(`ApplicationDbContext.cs:351-378`, filter at `ModelBuilderExtensions.cs:57-60`), over the assemblies
supplied by [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) and its
[`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider) implementation,
which scans loaded `*.Infrastructure` assemblies, excludes `Common.Infrastructure` itself, and appends
whatever a host registered through [`EntityConfigurationOptions`](#entityconfigurationoptions)
(`DefaultEntityConfigurationAssemblyProvider.cs:16-21`). Two configurations ship inside the framework
itself, [`PushNotificationConfiguration`](#pushnotificationconfiguration) and
[`UserNotificationConfiguration`](#usernotificationconfiguration)
(`.../Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:16`,
`.../UserNotificationConfiguration.cs:15`), both tagged `[UseDatabase("Notification")]` and re-declaring
the `Notification` schema because namespace derivation would otherwise resolve them to `Common`. This
engine-portability design is [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) (polyglot persistence); note the current-reality caveat: the SQLite
and Cosmos plumbing is shipped and tested, but SQL Server is the only engine backing production entities
today.

## Encryption, seeding, design time, and the shared helpers

A handful of supporting pieces round out the EF side. [`EncryptedStringConverter`](#encryptedstringconverter)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:42`)
is a value converter that transparently encrypts a string column with authenticated AES-256-GCM (a random
12-byte nonce, a 16-byte tag, stored Base64 as nonce plus ciphertext plus tag), rejecting any key that is
not exactly 32 bytes (`:44-48`, `:59-65`, `:74-117`). Its own doc comment states the constraint that
governs where it may be used: the ciphertext is non-deterministic, so the column cannot back equality
predicates, unique indexes, or server-side sorting (`:18-31`). It is the `[Rubric §11, Security]` control
that [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) points at for fields that must
remain retrievable after erasure. Its current reality matches [ADR-037](https://ivanball.github.io/docs/adr/037-field-level-encryption-at-rest.html): it is shipped and unit-tested but
**unadopted**, no entity configuration wires it (the only non-test references are its own file and the
`IAnonymizable` doc comment). On the read side, [`IQueryableExecutor`](#iqueryableexecutor) and its
implementation [`EFQueryableExecutor`](#efqueryableexecutor)
(`.../Persistence/EFQueryableExecutor.cs:11`) abstract async query materialization so higher layers can
execute an `IQueryable` without referencing EF, detecting a real EF query by its `IAsyncEnumerable<T>`
implementation and degrading to LINQ-to-Objects otherwise (`EFQueryableExecutor.cs:43`). That is what
makes the specification evaluation in [Group 03](group-03-querying-specifications.md) unit-testable
without a database, a small but real `[Rubric §14, Testability]` win.
[`ProfilingHelper`](#profilinghelper) (`.../Persistence/ProfilingHelper.cs:9`) is the MiniProfiler
step wrapper the repository decorators share, and [`PeriodicBackgroundService`](#periodicbackgroundservice)
(`.../Services/PeriodicBackgroundService.cs:20`) is the group's shared base for fixed-interval sweeps
(enablement gate, startup delay, a cycle whose failure is logged and never kills the loop, all waits on
an injected `TimeProvider` so tests drive it with a fake clock, `:31-87`). Its doc comment says plainly
that the outbox processor deliberately does not use it, because a signal-driven smart wait does not fit
a fixed interval (`:13-16`); as of this writing no type in the workspace derives from it either, so it
is shipped-and-tested rather than adopted ([ADR-052](https://ivanball.github.io/docs/adr/052-background-job-execution.html) covers in-process background work).

Seeding and design time close the loop. [`IDbSeeder`](#idbseeder) and the [`DbSeeder`](#dbseeder) base
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:7`) give
module seeders a `GetId<TIdentifier>` helper that maps integer seed ids to either `int` or a deterministic
`Guid` so seed data reproduces across key strategies (`DbSeeder.cs:20-39`). For migrations,
[`DesignTimeDbContextHelper`](#designtimedbcontexthelper)
(`.../DbContexts/Design/DesignTimeDbContextHelper.cs:34`) builds a
[`SQLServerDbContext`](#sqlserverdbcontext) for `dotnet ef` without the app's DI container: a downstream
migrations project writes a few-line `IDesignTimeDbContextFactory` (`:20-30`), and
`dotnet ef migrations add X -- --datasource Conference` selects which physical source to build against
(`:86-104`), so each database gets its own migrations project. It composes minimal stand-ins
([`ExplicitAssemblyProvider`](#explicitassemblyprovider) at `:106`,
[`NullDomainEventDispatcher`](#nulldomaineventdispatcher) at `:111`) and a
[`DesignTimeDbContextOptions`](#designtimedbcontextoptions) carrying the connection settings, then wires
the same [`DataSourceResolver`](#datasourceresolver) and [`EntityDataSourceRegistry`](#entitydatasourceregistry)
the runtime uses so the design-time model matches the runtime one (`:48-81`).

## Blobs, images, and native push

The group also carries the storage-adjacent infrastructure services that are not EF at all, each behind
an Application-layer interface with a null default so a host that has not configured the backend still
starts and degrades cleanly. [`IFileStorageService`](#ifilestorageservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11`)
stores and deletes blobs behind a [`Result`](group-01-result-error-handling.md#result)-returning API and
exposes an `IsConfigured` flag handlers can gate features on (`:14`);
[`AzureBlobFileStorageService`](#azureblobfilestorageservice)
(`.../Services/AzureBlobFileStorageService.cs:15`) is the Azure implementation over a single
pre-provisioned container, and [`NullFileStorageService`](#nullfilestorageservice)
(`.../Services/NullFileStorageService.cs:11`) fails uploads with a named error while letting deletes
succeed (`:17-25`). [`IImageProcessor`](#iimageprocessor) and
[`ImageSharpImageProcessor`](#imagesharpimageprocessor) (`.../Services/ImageSharpImageProcessor.cs:14`)
normalize untrusted uploads by decoding, baking in the EXIF orientation, center-cropping to a square,
stripping the EXIF, XMP, and IPTC profiles, and re-encoding as JPEG, so only pixels survive
(`:21-41`); the dependency-free [`ImageContentSniffer`](#imagecontentsniffer)
(`.../Interfaces/Infrastructure/ImageContentSniffer.cs:10`) is its upload-side companion, deciding the
accepted formats (JPEG, PNG, WebP) from magic bytes rather than the client-declared content type
(`:15-36`). Both are [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), and both are squarely `[Rubric §11, Security]` (EXIF GPS is PII, and a full
re-encode is the defense against polyglot payloads). On the push side,
[`INativePushSender`](#inativepushsender) and [`IPushDeviceRegistrar`](#ipushdeviceregistrar) describe
OS-level delivery and the device-installation registry that backs it ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)), implemented by
[`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender)
(`.../Services/AzureNotificationHubNativePushSender.cs:14`) and
[`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar)
(`.../Services/AzureNotificationHubDeviceRegistrar.cs:15`) over Azure Notification Hubs, with
[`NullNativePushSender`](#nullnativepushsender) and [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar)
as the unconfigured defaults. [`NativePushPayloads`](#nativepushpayloads)
(`.../Services/NativePushPayloads.cs:10`) is the pure helper that builds the FCM v1 and APNs payload
shapes (`:16-53`) and chunks user tags at the hub's 20-tag expression cap
(`NativePushPayloads.cs:13`), which is what makes those rules unit-testable without a hub. This channel
sits beside the persisted notification record and the SignalR path in
[Group 10](group-10-notifications.md).

## Where this group sits

Persistence is the concrete floor the abstract domain stands on. The entity bases and audit contracts
from [Group 02](group-02-domain-building-blocks.md) are what the interceptors stamp and the query filters
hide; the domain events aggregates raise are what [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
drains into the outbox that [Group 04](group-04-events-outbox.md) delivers; the transactional decorator in
[Group 05](group-05-cqrs-pipeline.md) is what opens the transaction whose commit releases the deferred
dispatch; the specifications and query service in [Group 03](group-03-querying-specifications.md) run
through this group's repositories and `IQueryable` surfaces; the navigation populators in
[Group 11](group-11-navigation-populators.md) fill the cross-source gaps the degrade convention opens;
and the entity-source registry answers the `.Include()` questions those populators ask. The design axes
here are two orthogonal ones, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)'s `Name` axis (which database) and [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)'s `Engine` axis (which
storage technology), collapsed behind a single [`DataSourceKey`](#datasourcekey) so application code never
has to know which it is running on. Read this group as the answer to one question the rest of the guide
keeps asking: how does a framework that describes persistence in pure domain terms actually put a row in a
database, and do it in a way that survives a module being pulled out into its own service.

### DataSource
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:6` · Level 0 · enum

- **What it is**: a three-value enum (`CosmosDB`, `Sqlite`, `SQLServer`) naming which database
  *engine* persists a given entity type. It shares a file with
  [`IDataSourceService`](#idatasourceservice) (the enum at line 6, the interface at line 24).
- **Depends on**: nothing first-party (BCL only).
- **Concept introduced, database-per-service routing at the entity level.** `[Rubric §8, Data
  Architecture]` (assesses deliberate database-per-service design, key/routing strategy, and the
  absence of implicit cross-database JOINs) and `[Rubric §7, Microservices Readiness]` (each module
  owns its own store so it can be lifted out). [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) establishes that every module owns its own
  database; `DataSource` is the *engine* axis the query pipeline reads to decide whether two entity
  navigations can be resolved with a single relational `.Include()`/JOIN or must fall back to
  cross-source batch loading. The values encode a *capability*, not just a name: the `CosmosDB` doc
  comment (`IDataSourceService.cs:8`) states "no cross-container JOINs," while `Sqlite`
  (`IDataSourceService.cs:11`) and `SQLServer` (`IDataSourceService.cs:14`) support JOINs.
- **Walkthrough**: three members, each documented with its JOIN capability, `CosmosDB`
  (`IDataSourceService.cs:9`, document store, no cross-container JOINs), `Sqlite`
  (`IDataSourceService.cs:12`, JOINs within a single file), `SQLServer` (`IDataSourceService.cs:15`,
  full relational JOIN support).
- **Why it's built this way**: encoding the JOIN-capability difference in the enum lets
  [`IDataSourceService.HaveIncludeSupport`](#idatasourceservice) answer the include-vs-batch-load
  question from a table lookup rather than scattered `if` chains, and keeps that decision in the
  framework-pure Application layer (no EF reference).
- **Where it's used**: paired with a database name in [`DataSourceKey`](#datasourcekey); resolved and
  compared by [`IDataSourceService`](#idatasourceservice); consumed by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) to
  classify each navigation as an EF include or a manual populate.

### IEntityConfigurationAssemblyProvider
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IEntityConfigurationAssemblyProvider.cs:10` · Level 0 · interface

- **What it is**: a single-method contract returning the `Assembly` list that holds EF Core entity
  type configurations, so the DbContext can discover and apply configurations without hardcoding
  module assembly-name patterns.
- **Depends on**: `System.Reflection` (BCL) only (`IEntityConfigurationAssemblyProvider.cs:1`).
- **Concept introduced, module-agnostic model assembly, keeping EF out of Application.** `[Rubric §3,
  Clean Architecture]` (the Application layer declares *what* assemblies carry configurations; the
  Infrastructure DbContext performs the EF scan) and `[Rubric §7, Microservices Readiness]` (each
  module's Infrastructure assembly holds its own configurations, so extraction is removal from a
  list, not a rewrite). In a modular monolith each module ships its own
  `IEntityTypeConfiguration<T>` classes; the DbContext's `OnModelCreating` calls
  `ApplyConfigurationsFromAssembly` for each assembly this provider returns rather than from a fixed
  list. The doc comment (`IEntityConfigurationAssemblyProvider.cs:5-9`) states exactly this.
- **Walkthrough**: one method, `IReadOnlyList<Assembly> GetConfigurationAssemblies()`
  (`IEntityConfigurationAssemblyProvider.cs:15`). Implementations aggregate the Infrastructure
  assemblies of every enabled module.
- **Why it's built this way**: routing configuration discovery through an injected provider means the
  active module set (which `ModulesSettings` can toggle) determines the model without the DbContext
  knowing any module by name, satisfying the extraction invariant of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)/[ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html).
- **Where it's used**: consumed by [`ApplicationDbContext`](#applicationdbcontext) (Infrastructure,
  this group) during model creation; registered in each app's composition root.

### ImageContentSniffer
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ImageContentSniffer.cs:10` · Level 0 · class (static)

- **What it is**: a dependency-free static helper that decides whether uploaded bytes *are* a JPEG,
  PNG, or WebP image by inspecting the leading magic bytes, never the client-declared content type or
  file extension.
- **Depends on**: nothing first-party (BCL `ReadOnlySpan<byte>`). It is the upload-side companion to
  [`IImageProcessor`](#iimageprocessor).
- **Concept introduced, magic-byte content sniffing as an upload trust boundary.** `[Rubric §11,
  Security]` (assesses validating untrusted input by its actual content, not a spoofable
  client-supplied MIME type or extension) and `[Rubric §26, Front-End Security]` where an avatar
  upload originates. The doc comment (`ImageContentSniffer.cs:3-9`) frames the division of labor
  ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)): the sniffer narrows accepted inputs to jpeg/png/webp, then the caller hands content to
  the processor whose re-encoding keeps only pixels; app-specific size limits and error codes stay in
  the calling handler.
- **Walkthrough**: four span-based predicates.
  - `IsAllowedImage(ReadOnlySpan<byte>)` (`ImageContentSniffer.cs:15`): the public entry point,
    `IsJpeg || IsPng || IsWebP`.
  - `IsJpeg` (`ImageContentSniffer.cs:21`): length >= 3 and the SOI prefix `FF D8 FF`
    (`ImageContentSniffer.cs:22`).
  - `IsPng` (`ImageContentSniffer.cs:27`): length >= 8 and a `SequenceEqual` against the exact 8-byte
    PNG signature (`ImageContentSniffer.cs:28`).
  - `IsWebP` (`ImageContentSniffer.cs:33`): length >= 12, a `RIFF` container (bytes 0-3, `"RIFF"u8`)
    declaring the `WEBP` form type (bytes 8-11, `"WEBP"u8`), at `ImageContentSniffer.cs:34-36`.
- **Why it's built this way**: `ReadOnlySpan<byte>` and UTF-8 literals (`"RIFF"u8`) mean the checks
  allocate nothing and run on the raw payload prefix; being a pure static class it can be called from
  any layer without DI. Checking bytes (not the declared type) is the security point, a client can
  rename `evil.exe` to `avatar.png` but cannot forge the leading signature and survive re-encoding.
- **Where it's used**: called by the avatar-upload handler before handing content to
  [`IImageProcessor`](#iimageprocessor) ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).

### INativePushSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/INativePushSender.cs:10` · Level 0 · interface

- **What it is**: the contract for sending OS-level push notifications to registered device
  installations, the delivery channel that reaches a phone when the app is backgrounded or killed.
- **Depends on**: the `UserIdentifierType` alias (`INativePushSender.cs:19`); BCL otherwise.
- **Concept introduced, native push as the third delivery channel.** `[Rubric §10, Cross-Cutting
  Concerns]` (a swappable delivery abstraction, defined in Application, implemented at the edge). The
  doc comment (`INativePushSender.cs:3-9`) places this beside the two other channels ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)): the
  persisted inbox record and the SignalR real-time push handled by
  [`IPushNotificationSender`](group-10-notifications.md#ipushnotificationsender). Where SignalR
  reaches a *connected* browser, native push reaches a device that is not running the app.
  Infrastructure targets Azure Notification Hubs (FCM v1 + APNs); the default is a no-op until a hub
  is configured, so a host that never sets one up degrades cleanly.
- **Walkthrough**: two methods.
  - `SendToUsersAsync(IEnumerable<UserIdentifierType> userIds, string title, string body,
    Dictionary<string,string>? metadata = null, CancellationToken)` (`INativePushSender.cs:19`):
    targets specific users, resolved to installations via user tags; `metadata` carries an optional
    deep-link route in the platform payload.
  - `BroadcastAsync(string title, string body, Dictionary<string,string>? metadata = null,
    CancellationToken)` (`INativePushSender.cs:27`): sends to every registered installation.
- **Why it's built this way**: targeting *users* rather than raw device tokens keeps the caller out
  of the tag/token bookkeeping ([`IPushDeviceRegistrar`](#ipushdeviceregistrar) owns the registry);
  the no-op default means native push is an opt-in capability, not a hard dependency.
- **Where it's used**: called by notification command handlers alongside
  [`IPushNotificationSender`](group-10-notifications.md#ipushnotificationsender); its device registry
  is maintained by [`IPushDeviceRegistrar`](#ipushdeviceregistrar).

### IQueryableExecutor
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IQueryableExecutor.cs:7` · Level 0 · interface

- **What it is**: an abstraction over the EF Core `IQueryable` operations (`Include`, `AsSplitQuery`,
  `ToListAsync`, `CountAsync`) that the Application layer needs but that would otherwise require a
  direct `Microsoft.EntityFrameworkCore` reference.
- **Depends on**: `System.Linq` (BCL) only.
- **Concept introduced, inverting EF's terminal operators out of Application.** `[Rubric §3, Clean
  Architecture]` (Application depends on an abstraction; the EF-specific implementation lives in
  Infrastructure). EF's async materializers (`ToListAsync`, `CountAsync`) and `Include` are extension
  methods in the EF assembly; calling them directly would drag EF into Application. This interface
  inverts that, Infrastructure implements each by calling EF, and Application receives the interface
  by DI. The doc comment (`IQueryableExecutor.cs:3-6`) states the intent.
- **Walkthrough**: four methods, each constrained to `where T : class` for the two queryable
  transforms.
  - `Include<T>(IQueryable<T>, string navigationPropertyPath)` (`IQueryableExecutor.cs:14`): a
    **string-based** include path (e.g. `"Order.OrderLines"`, `IQueryableExecutor.cs:12`),
    deliberately not a lambda, because the generic query pipeline builds include paths dynamically
    from navigation-property name strings.
  - `AsSplitQuery<T>(IQueryable<T>)` (`IQueryableExecutor.cs:26`): switches EF to split-query mode.
    The doc comment (`IQueryableExecutor.cs:17-25`) explains *why it matters*: paginating (Skip/Take)
    a query with collection includes in single-query mode truncates or mis-correlates child rows, so
    list reads come back with empty collections. A no-op for in-memory queryables.
  - `ToListAsync<T>(IQueryable<T>, CancellationToken)` (`IQueryableExecutor.cs:34`) and
    `CountAsync<T>(IQueryable<T>, CancellationToken)` (`IQueryableExecutor.cs:41`): the async
    materializers.
- **Why it's built this way**: the string include path (over `Expression<Func<T,TProperty>>`) is
  required because the query pipeline composes includes from runtime navigation metadata, not
  compile-time lambdas; the `AsSplitQuery` escape hatch keeps a well-known EF pagination bug from
  reaching list endpoints.
- **Where it's used**: called by the generic entity query service and the navigation populators of
  this group through the injected interface.

### IUpdatePropertySetter<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IUpdatePropertySetter.cs:13` · Level 0 · interface

- **What it is**: a persistence-agnostic builder for the SET clause of a bulk update. A handler
  describes *which* properties change and *to what*, and Infrastructure translates the description
  into the provider's set-based `UPDATE`.
- **Depends on**: `System.Linq.Expressions` (BCL, `IUpdatePropertySetter.cs:1`) only. It is the
  parameter type of
  [`IWriteRepository.ExecuteUpdateAsync`](#iwriterepositorytentity-tidentifiertype)
  (`IRepository.cs:220`).
- **Concept introduced, describing a SET clause without leaking EF Core.** `[Rubric §3, Clean
  Architecture]` (the Application layer states intent through an abstraction; the EF translation
  lives in Infrastructure) and `[Rubric §12, Performance & Scalability]` (a single set-based
  statement replaces load-mutate-save round trips). The doc comment
  (`IUpdatePropertySetter.cs:5-11`) is explicit that the shape *mirrors* EF Core's `SetPropertyCalls`
  without referencing it, which is what keeps `MMCA.Common.Application` EF-free while still offering
  EF's most useful bulk primitive.
- **Walkthrough**: two overloads of `Set`, both returning `IUpdatePropertySetter<TEntity>` so calls
  chain.
  - `Set<TProperty>(Expression<Func<TEntity,TProperty>> property, TProperty value)`
    (`IUpdatePropertySetter.cs:20`): assigns a fixed value, e.g. a status or a timestamp.
  - `Set<TProperty>(Expression<Func<TEntity,TProperty>> property,
    Expression<Func<TEntity,TProperty>> valueFactory)` (`IUpdatePropertySetter.cs:33`): assigns from
    an expression over the **current database row**. The doc comment
    (`IUpdatePropertySetter.cs:24-28`) gives the motivating case: `quantity => quantity.Amount - 5`
    becomes an atomic read-modify-write that the database itself arbitrates, so two racing callers
    cannot both win and no rowversion retry loop is needed.
- **Why it's built this way**: passing an `Action<IUpdatePropertySetter<TEntity>>` (rather than a
  dictionary or a prebuilt EF expression) keeps the call site strongly typed and refactor-safe while
  the concrete translation stays swappable per provider.
- **Where it's used**: implemented by
  [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity) (Infrastructure,
  this group), which collects the assignments (`UpdatePropertySetterBuilder.cs:16`) and replays them
  onto EF Core 10's `UpdateSettersBuilder<TSource>` (`UpdatePropertySetterBuilder.cs:52-58`). It also
  tracks assigned property names (`UpdatePropertySetterBuilder.cs:49`) so
  [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) can stamp
  `LastModifiedOn`/`LastModifiedBy` only when the caller did not
  (`EFRepository.cs:127-136`), keeping audit fields correct on a path that bypasses the save
  pipeline.

### DataSourceKey
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/DataSourceKey.cs:15` · Level 1 · record struct (readonly)

- **What it is**: the identity of a *physical* data source, a `([DataSource](#datasource) Engine,
  string Name)` pair, where `Name` distinguishes multiple databases on the same engine
  ("database per microservice").
- **Depends on**: [`DataSource`](#datasource) (Level 0).
- **Concept, physical-key comparison for include support.** `[Rubric §8, Data Architecture]`
  (database-per-service routing). A `readonly record struct` gives correct structural equality with
  zero boilerplate, which is the whole point: Application code that needs to know whether two entities
  can be joined compares their `DataSourceKey` values. The doc comment (`DataSourceKey.cs:6-11`)
  stresses that `Name` is the *physical* source name produced by the Infrastructure resolver **after
  collapsing** logical names that share a connection string, so two logical names mapping to the same
  connection string end up with the same physical key (and are joinable), while distinct databases do
  not.
- **Walkthrough**
  - The positional record `DataSourceKey(DataSource Engine, string Name)` (`DataSourceKey.cs:15`).
  - `DefaultName` (`DataSourceKey.cs:18`): the `const string = "Default"` reserved for the top-level
    `ConnectionStrings` section.
  - `Default(DataSource engine)` (`DataSourceKey.cs:23`): a static factory building the default key
    for an engine.
  - `ToString()` (`DataSourceKey.cs:26`): renders `"{Engine}/{Name}"` for diagnostics.
- **Why it's built this way**: making the key a value type with structural equality means the routing
  decision (same physical database and relational engine) is a simple `==` comparison, and a host with
  no `DataSources` configuration collapses everything onto `Default` and behaves like a single-database
  monolith ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: [`EntityDataSourceRegistry`](#entitydatasourceregistry) maps each entity type
  to a `DataSourceKey` and [`DataSourceResolver`](#datasourceresolver) performs the logical-to-physical
  collapse; [`IDataSourceService`](#idatasourceservice) resolves and compares them;
  [`DbContextFactory`](#dbcontextfactory) caches one context per key.

### IDataSourceService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:24` · Level 2 · interface

- **What it is**: resolves which physical data source ([`DataSourceKey`](#datasourcekey): engine +
  database) backs a given entity type, and determines whether two entity types support EF Core
  `.Include()` between them, all without the Application layer touching EF or Infrastructure.
- **Depends on**: [`DataSource`](#datasource) (Level 0) and [`DataSourceKey`](#datasourcekey) (Level
  1), both in the same namespace.
- **Concept introduced, multi-database service routing at the Application layer.** `[Rubric §8, Data
  Architecture]` (assesses database-per-service design, deliberate routing, and no accidental
  cross-database JOINs). The layer must decide whether a navigation between two entities can use an EF
  `.Include()`, which is valid only when both entities live in the same physical database *and* that
  engine is relational (never Cosmos). This interface answers that question without referencing EF,
  keeping Application pure ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The doc comment (`IDataSourceService.cs:18-23`) names the
  consumer:
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) uses
  it to classify navigation properties as supported or unsupported includes.
- **Walkthrough**: six members across three concerns.
  - `GetDataSourceKey(Type)` (`IDataSourceService.cs:29`) and `GetDataSourceKey(string
    entityFullName)` (`IDataSourceService.cs:34`): resolve the physical key by CLR type or full type
    name.
  - `GetDataSource(string)` (`IDataSourceService.cs:39`) and `GetDataSource(Type)`
    (`IDataSourceService.cs:44`): resolve just the engine.
  - `HaveIncludeSupport(DataSourceKey first, DataSourceKey second)` (`IDataSourceService.cs:54`): the
    crux, returns `true` only when both keys identify the same physical database and the engine is
    relational (the doc comment at `IDataSourceService.cs:46-53` notes Cosmos DB has no
    cross-document JOINs).
  - `HaveIncludeSupport(string firstEntityFullName, string secondEntityFullName)`
    (`IDataSourceService.cs:63`): the same test by entity name, resolving each side's key first.
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) replaces cross-service foreign keys with scalar columns and
  routes consistency through the outbox; to build a query the Application layer must know the routing
  topology so it can classify each navigation as "include-able" versus "manual load required."
- **Where it's used**: consumed by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) to
  drive the supported/unsupported include split, and indirectly by the query pipeline's eager-loading
  decisions. The Infrastructure implementation is a facade over
  [`EntityDataSourceRegistry`](#entitydatasourceregistry).

### IFileStorageService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11` · Level 3 · interface

- **What it is**: the contract for storing and deleting binary blobs (e.g. user avatar images).
  Implementations own the container/bucket; callers pass only a blob name scoped within it.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form (via
  `MMCA.Common.Shared.Abstractions`, `IFileStorageService.cs:1`); BCL `Stream`/`Uri`.
- **Concept introduced, the managed blob-storage boundary.** `[Rubric §8, Data Architecture]` (binary
  content lives in object storage, not the relational row) and `[Rubric §10, Cross-Cutting Concerns]`
  (a swappable storage transport behind a Result-returning interface). Per the doc comment
  (`IFileStorageService.cs:5-10`, [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)) the default implementation is unconfigured, uploads fail
  with a clear error, until a host calls `AddAzureBlobFileStorage(configuration)` with a complete
  `FileStorage` section. Returning [`Result`](group-01-result-error-handling.md#result) rather than
  throwing keeps a failed upload on the same error-flow rails as the rest of the stack (see the
  [Result pattern](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: one property and two methods.
  - `IsConfigured` (`IFileStorageService.cs:14`): whether a real store is wired, so a handler can gate
    a feature on it rather than attempt a doomed upload.
  - `UploadAsync(string blobName, Stream content, string contentType, CancellationToken)`
    (`IFileStorageService.cs:22`): uploads or overwrites a blob and returns its public absolute URL as
    `Result<Uri>`. The blob name is container-scoped, e.g. `avatars/42-a1b2c3d4.jpg`
    (`IFileStorageService.cs:17`).
  - `DeleteAsync(string blobName, CancellationToken)` (`IFileStorageService.cs:28`): deletes a blob;
    unknown names succeed (idempotent), matching at-least-once cleanup semantics.
- **Why it's built this way**: an unconfigured default plus an `IsConfigured` gate means the framework
  ships avatar support without forcing every consumer to provision blob storage; idempotent delete
  makes cleanup safe to retry.
- **Where it's used**: the avatar-upload handler, after [`ImageContentSniffer`](#imagecontentsniffer)
  and [`IImageProcessor`](#iimageprocessor) have validated and normalized the bytes ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).

### IImageProcessor
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IImageProcessor.cs:11` · Level 3 · interface

- **What it is**: the contract for normalizing an untrusted uploaded image, decoding it, correcting
  EXIF orientation, center-cropping to a square, stripping *all* metadata, and re-encoding as JPEG.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via
  `MMCA.Common.Shared.Abstractions`, `IImageProcessor.cs:1`); BCL `Stream`.
- **Concept introduced, re-encoding as an image trust boundary.** `[Rubric §11, Security]` (assesses
  neutralizing untrusted binary input) and `[Rubric §30, Compliance, Privacy & Data Governance]`
  (stripping EXIF GPS coordinates, which are PII). The doc comment (`IImageProcessor.cs:5-10`,
  [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)) makes both points: metadata removal deletes location PII, and re-encoding is the defense
  against polyglot or malformed payloads because only pixels survive the decode/re-encode round trip.
  This is the processor half of the pair that [`ImageContentSniffer`](#imagecontentsniffer) opens.
- **Walkthrough**: one method, `NormalizeToSquareJpegAsync(Stream content, int size,
  CancellationToken)` (`IImageProcessor.cs:18`), returning `Result<byte[]>` of the normalized JPEG, or
  a validation failure for undecodable content. `size` is the output square edge length in pixels
  (`IImageProcessor.cs:15`).
- **Why it's built this way**: returning bytes (not a stream to storage) keeps the processor a pure
  transform, so the handler can sniff, then normalize, then hand the result to
  [`IFileStorageService`](#ifilestorageservice); a Result failure on undecodable input keeps a bad
  upload from ever reaching storage.
- **Where it's used**: the avatar-upload handler, between [`ImageContentSniffer`](#imagecontentsniffer)
  and [`IFileStorageService`](#ifilestorageservice) ([ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)).

### IPushDeviceRegistrar
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPushDeviceRegistrar.cs:11` · Level 3 · interface

- **What it is**: maintains the device-installation registry behind
  [`INativePushSender`](#inativepushsender), tagging each installation with its owning user so sends
  can target users rather than raw device tokens.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via
  `MMCA.Common.Shared.Abstractions`, `IPushDeviceRegistrar.cs:1`),
  [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest) (from
  `MMCA.Common.Shared.Notifications.PushNotifications`, `IPushDeviceRegistrar.cs:2`), and the
  `UserIdentifierType` alias (`IPushDeviceRegistrar.cs:18`).
- **Concept, the token-registry side of native push.** `[Rubric §10, Cross-Cutting Concerns]` and
  `[Rubric §11, Security]` (installations are bound to an authenticated owner, so a send targets a
  person, not an anonymous token). The doc comment (`IPushDeviceRegistrar.cs:6-10`, [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) explains
  the split: this type owns the installation registry, tagged by user, so
  [`INativePushSender`](#inativepushsender) can send to users; the default implementation is a no-op
  until a notification hub is configured.
- **Walkthrough**: two methods.
  - `UpsertAsync(UserIdentifierType userId, DeviceInstallationRequest request, CancellationToken)`
    (`IPushDeviceRegistrar.cs:18`): creates or refreshes an installation, tagging it with the
    authenticated owner; returns [`Result`](group-01-result-error-handling.md#result).
  - `DeleteAsync(string installationId, CancellationToken)` (`IPushDeviceRegistrar.cs:24`): removes an
    installation; unknown ids succeed (idempotent).
- **Why it's built this way**: separating the *registry* (this type) from the *send*
  ([`INativePushSender`](#inativepushsender)) means the send API can target users while token
  bookkeeping stays in one place; idempotent delete makes stale-token cleanup safe to retry.
- **Where it's used**: paired with [`INativePushSender`](#inativepushsender); the concrete
  implementation targets Azure Notification Hubs ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).

### IEntityQuerier<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:64` · Level 4 · interface

- **What it is**: the collection/projection half of the repository split, `GetAllAsync`,
  `GetProjectedAsync<TResult>`, `GetAllForLookupAsync`, and two `CountAsync` overloads.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IRepository.cs:65`) and
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype)
  (the lookup projection, from `MMCA.Common.Shared.DTOs`, `IRepository.cs:3` and `IRepository.cs:87`).
- **Concept introduced, the ISP-split repository family.** `[Rubric §1, SOLID]` (Interface
  Segregation). `IRepository.cs` defines a deliberate ladder of ever-wider interfaces so a handler
  depends on exactly the surface it uses: `IEntityQuerier` (collections/projection, this type),
  [`IEntityReader`](#ientityreadertentity-tidentifiertype) (by-id lookups),
  [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype) (mutations),
  [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) (reader + querier + raw
  `IQueryable`), and [`IRepository`](#irepositorytentity-tidentifiertype) (read + write). The doc
  comment (`IRepository.cs:57-60`) says it outright: prefer this over `IReadRepository` when a handler
  needs `GetAllAsync`, `GetProjectedAsync`, or `CountAsync`. `[Rubric §12, Performance &
  Scalability]`: `GetProjectedAsync<TResult>` (`IRepository.cs:80`) accepts an
  `Expression<Func<TEntity,TResult>>` translated to SQL, so read-heavy handlers fetch only the columns
  they need.
- **Walkthrough**
  - `GetAllAsync(IEnumerable<string> includes, where?, orderBy?, select?, asTracking, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:69`): the general collection read with optional includes, filter, ordering, and
    projection; `ignoreQueryFilters` can bypass the soft-delete filter.
  - `GetProjectedAsync<TResult>(select, where?, asTracking, CancellationToken)` (`IRepository.cs:80`):
    SQL-side projection to an arbitrary result type.
  - `GetAllForLookupAsync(string nameProperty, where?, asTracking, CancellationToken)`
    (`IRepository.cs:87`): returns lightweight
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype)
    id/name pairs for dropdowns without materializing full entities.
  - `CountAsync(CancellationToken)` (`IRepository.cs:94`) and `CountAsync(where, CancellationToken)`
    (`IRepository.cs:97`): total and predicated counts.
- **Why it's built this way**: splitting reads into a focused querier lets the framework signal
  intent through the constructor dependency and keeps projection/counting off the by-id interface.
- **Where it's used**: query handlers needing collections or counts; folded into
  [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) for
  handlers that want the full read surface, and implemented concretely by
  [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype).

### IEntityReader<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:14` · Level 4 · interface

- **What it is**: the by-id half of the repository split, `GetByIdAsync` (two overloads),
  `GetByIdsAsync`, and `ExistsAsync` (two overloads), for handlers whose data access is minimal.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IRepository.cs:15`).
- **Concept, minimal data access as a declared dependency.** `[Rubric §1, SOLID]` (Interface
  Segregation, introduced on [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype)) and
  `[Rubric §8, Data Architecture]` (deliberate, minimal access patterns). The doc comment
  (`IRepository.cs:7-11`) is explicit: prefer this over `IReadRepository<>` when a handler only needs
  `GetByIdAsync` or `ExistsAsync`, because that signals minimal data access. The `ignoreQueryFilters`
  parameter on `ExistsAsync` (`IRepository.cs:47`) lets a handler check whether a *soft-deleted* entity
  exists, e.g. for conflict detection on re-creation.
- **Walkthrough**
  - `GetByIdAsync(id, CancellationToken)` (`IRepository.cs:19`): plain fetch, returns `null` if
    missing.
  - `GetByIdAsync(id, IEnumerable<string> includes, bool asTracking, CancellationToken)`
    (`IRepository.cs:24`): the eager-load overload; include paths are navigation-property names.
  - `GetByIdsAsync(ids, includes?, asTracking, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:37`): a single-query bulk fetch; the doc comment (`IRepository.cs:36`) warns it
    may return fewer entities than requested when some ids are missing or filtered.
  - `ExistsAsync(id, ignoreQueryFilters, CancellationToken)` (`IRepository.cs:45`) and
    `ExistsAsync(Expression<Func<TEntity,bool>> where, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:51`): existence checks by key or predicate.
- **Why it's built this way**: a handler that only needs a point lookup takes the narrowest interface,
  which reads clearly and mocks trivially in tests.
- **Where it's used**: command handlers that load an aggregate before mutating it; folded into
  [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype). Note that
  the [`GetByIdOrFailAsync`](#readrepositoryextensions) extension, which turns a miss into a
  [`Result`](group-01-result-error-handling.md#result) failure carrying `Error.NotFound`, hangs off
  `IReadRepository` rather than this interface and is implemented over `GetAllAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:27` and
  `:34`), so a handler that wants it must take the wider read interface.

### IWriteRepository<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:133` · Level 4 · interface

- **What it is**: the write half of the repository abstraction, `AddAsync`, `AddRangeAsync`,
  `UpdateAsync`, `UpdateRange`, two `SetOriginalRowVersion` overloads, `ExecuteDeleteAsync`,
  `ExecuteUpdateAsync`, `Save`, and `SaveChangesAsync`.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IRepository.cs:134`),
  [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) (the child-concurrency overload,
  `IRepository.cs:185`), and
  [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) (`IRepository.cs:220`).
- **Concept introduced, optimistic-concurrency wiring and change-tracking-bypass writes.** `[Rubric
  §8, Data Architecture]` (deliberate concurrency control, not accidental last-write-wins). Four
  members carry the weight:
  - `SetOriginalRowVersion(TEntity entity, byte[]? rowVersion)` (`IRepository.cs:173`): plants the
    client's last-observed `RowVersion` as the tracked entity's *original* concurrency token, so the
    next save emits `WHERE RowVersion = @original` and raises `DbUpdateConcurrencyException` (mapped
    to `409 Conflict`) if the row changed since the client read it. The doc comment
    (`IRepository.cs:165-172`) notes it is a no-op when `rowVersion` is null or empty (legacy clients
    or a first write).
  - `SetOriginalRowVersion(IRowVersioned childEntity, byte[]? rowVersion)` (`IRepository.cs:185`): the
    same protection for a tracked **child** of the aggregate (for example a `ProductVariant` under a
    `Product`). The doc comment (`IRepository.cs:175-184`) explains why a second overload exists at
    all: the repository's `TEntity` is the aggregate root, so the typed overload cannot reach
    children; this one accepts any
    [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) entity instead ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
  - `ExecuteDeleteAsync(where, CancellationToken)` (`IRepository.cs:195`): a set-based delete run
    directly in the database. The doc comment (`IRepository.cs:187-194`) warns in capitals that it
    does **not** trigger domain events, audit stamps, or soft-delete; it is for maintenance scenarios
    only.
  - `ExecuteUpdateAsync(where, Action<IUpdatePropertySetter<TEntity>> setProperties,
    CancellationToken)` (`IRepository.cs:218`): a set-based `UPDATE ... SET ... WHERE ...` as one
    atomic statement. The long doc comment (`IRepository.cs:199-217`) is the teaching text for
    contention-proof conditional updates: guard the update in `where` (for example
    `AvailableQuantity >= @qty`), and zero rows affected means the condition did not hold, so two
    racing callers can never both win and no rowversion retry loop is needed because the database
    arbitrates. It also draws the exact boundaries: domain events are bypassed, global query filters
    (soft delete) DO apply to `where`, audit fields are NOT bypassed (`LastModifiedOn`/`LastModifiedBy`
    are stamped automatically unless the caller sets them), and it runs on the ambient transaction
    when one is active, so it rolls back with the caller.
- **Walkthrough**
  - `AddAsync` / `AddRangeAsync` (`IRepository.cs:141`, `:149`): single and batch inserts.
  - `UpdateAsync` / `UpdateRange` (`IRepository.cs:157`, `:163`): mark tracked entities modified.
  - The two `SetOriginalRowVersion` overloads and the two set-based operations described above
    (`IRepository.cs:173`, `:185`, `:195`, `:218`).
  - `Save()` (`IRepository.cs:225`) and `SaveChangesAsync(CancellationToken)` (`IRepository.cs:230`):
    the synchronous and async persist, each returning the number of state entries written; the doc
    comment (`IRepository.cs:223`) prefers the async form.
- **Why it's built this way**: keeping writes in a focused interface means a query handler cannot
  accidentally acquire mutation methods, and the concurrency and set-based escape hatches are declared
  where they are visible (with their warnings attached) rather than buried in a concrete class.
- **Where it's used**: command handlers that mutate entities; folded into
  [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype). Handed out by
  [`IUnitOfWork.GetRepository`](#iunitofwork) and implemented by
  [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype).

### IReadRepository<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:110` · Level 5 · interface

- **What it is**: the full read surface, combining
  [`IEntityReader`](#ientityreadertentity-tidentifiertype) (by-id) and
  [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype) (collections), plus four
  `IQueryable<TEntity>` properties for handlers that need raw LINQ.
- **Depends on**: [`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype)
  and [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype) (both same
  file, `IRepository.cs:111`);
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (constraint, `IRepository.cs:112`).
- **Concept, composing the focused reads and exposing controlled `IQueryable`.** `[Rubric §1, SOLID]`
  (the composition point of the ISP ladder) and `[Rubric §12, Performance & Scalability]` (the query
  properties expose EF's tracking and split-query modes explicitly). The doc comment
  (`IRepository.cs:102-109`) says existing code may keep using this interface while new handlers pick
  the focused sub-interfaces for tighter ISP.
- **Walkthrough**: four `IQueryable<TEntity>` properties for handlers that must drop to raw LINQ.
  - `Table` (`IRepository.cs:116`): change-tracking enabled.
  - `TableNoTracking` (`IRepository.cs:119`): no-tracking, the read-only default.
  - `TableNoTrackingSingleQuery` (`IRepository.cs:122`): no-tracking forced to a single SQL query.
  - `TableNoTrackingSplitQuery` (`IRepository.cs:125`): no-tracking in split-query mode, avoiding the
    cartesian explosion that collection includes cause (the same concern
    [`IQueryableExecutor.AsSplitQuery`](#iqueryableexecutor) addresses).
- **Why it's built this way**: naming the tracking and query-shape choices as distinct properties
  makes an expensive default (tracking, single-query with collection includes) an explicit opt-in
  rather than an accident.
- **Where it's used**: query handlers wanting the whole read surface;
  [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) implements it;
  [`ReadRepositoryExtensions`](#readrepositoryextensions) hangs `GetByIdOrFailAsync` off it; combined
  with [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype) into
  [`IRepository`](#irepositorytentity-tidentifiertype).

### IRepository<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:238` · Level 6 · interface

- **What it is**: the combined read-write repository, extending both
  [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) and
  [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype), so a command handler that reads and
  mutates takes a single dependency.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype),
  [`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype) (both
  `IRepository.cs:238`), and
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (constraint, `IRepository.cs:239`).
- **Concept, the top of the ISP ladder.** `[Rubric §1, SOLID]`. The interface is purely
  compositional, it adds no members of its own, only the two constraints
  `where TEntity : AuditableBaseEntity<TIdentifierType>` and `where TIdentifierType : notnull`
  (`IRepository.cs:239-240`). Command handlers that both query and mutate take `IRepository`; query
  handlers take [`IReadRepository`](#ireadrepositorytentity-tidentifiertype); handlers needing only
  point lookups take [`IEntityReader`](#ientityreadertentity-tidentifiertype). Each dependency is
  explicit and minimal.
- **Walkthrough**: no members. The declaration is a semicolon-terminated interface with two bases and
  two generic constraints (`IRepository.cs:238-240`), the C# shorthand for an empty body.
- **Why it's built this way**: keeping the combined interface empty means the read and write surfaces
  each stay independently usable, while a handler that genuinely needs both still gets one
  constructor parameter.
- **Where it's used**: resolved by
  [`IUnitOfWork.GetRepository<TEntity, TId>()`](#iunitofwork);
  [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) implements it.

### EntityConfigurationOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/EntityConfigurationOptions.cs:10` · Level 0 · class

- **What it is**: an options bag that carries extra assemblies whose EF Core entity type
  configurations should be applied on top of the ones auto-discovered by name. A host or module pushes
  an `Assembly` into it during DI so its configurations are picked up without the discovery scan having
  to match it by naming convention.
- **Depends on**: `System.Reflection.Assembly` (BCL); nothing first-party. It is read by
  [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider) through
  `IOptions<EntityConfigurationOptions>`.
- **Concept introduced, options-object supplementation of convention discovery.** `[Rubric §3, Clean
  Architecture]` (assesses whether infrastructure discovers its collaborators rather than hardcoding
  references to them): the persistence layer does not reference every module's Infrastructure project,
  so a module that does not follow the `.Infrastructure` naming rule (for example a Common feature like
  Notification that lives inside `Common.Infrastructure` itself, which the auto-scan deliberately
  excludes) still gets its configurations applied by adding its assembly here.
- **Walkthrough**: one member, `List<Assembly> AdditionalAssemblies { get; } = []`
  (`EntityConfigurationOptions.cs:16`). It is initialized to an empty list and appended to via the
  standard `services.Configure<EntityConfigurationOptions>(o => o.AdditionalAssemblies.Add(...))`
  pattern during registration.
- **Why it's built this way**: an options object keeps the supplemental-assembly list open for
  extension without the provider (or the context) taking a compile-time dependency on any specific
  module. The provider merges these with the name-scanned set and de-duplicates.
- **Where it's used**: consumed by
  [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider); populated
  by Infrastructure DI registration for Common-internal feature modules.

### ModelBuilderExtensions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ModelBuilderExtensions.cs:10` · Level 0 · class

- **What it is**: an internal static helper with a single extension method, `ApplyAllConfigurations`,
  that scans an assembly for concrete classes implementing a provider-specific configuration interface,
  instantiates each through DI, and applies it to the EF model, with an optional per-entity filter.
- **Depends on**: `Microsoft.EntityFrameworkCore.ModelBuilder`, `System.Reflection`, and
  `Microsoft.Extensions.DependencyInjection.ActivatorUtilities` (all BCL/EF/NuGet). It is called by
  [`ApplicationDbContext`](#applicationdbcontext); it does not itself reference
  [`NamespaceConventions`](#namespaceconventions) or
  [`EntityConfigurationOptions`](#entityconfigurationoptions).
- **Concept introduced, reflection-driven configuration application with a DI-aware activator.**
  `[Rubric §8, Data Architecture]` (assesses deliberate, discoverable model configuration) and `[Rubric
  §2, Design Patterns]` (a generic apply-all built over EF's `ApplyConfiguration<TEntity>`): because the
  entity CLR type is only known at runtime, the method resolves EF's open generic
  `ModelBuilder.ApplyConfiguration<TEntity>(IEntityTypeConfiguration<TEntity>)` once, then closes it per
  entity via `MakeGenericMethod`. Configurations are created with `ActivatorUtilities.CreateInstance`
  (`ModelBuilderExtensions.cs:62`), so a configuration class may constructor-inject services rather than
  needing a parameterless ctor.
- **Walkthrough**:
  - Guards all four required arguments with `ArgumentNullException.ThrowIfNull`
    (`ModelBuilderExtensions.cs:31-34`).
  - Resolves the single-parameter `ApplyConfiguration` overload by reflection
    (`ModelBuilderExtensions.cs:38-40`).
  - Selects concrete, non-generic types in the assembly whose interface set contains a closed form of
    `interfaceType` (the open generic like `IEntityTypeConfigurationSQLServer<,>`)
    (`ModelBuilderExtensions.cs:42-51`).
  - For each, takes the first generic argument as the entity type, skips it when `entityFilter` returns
    false (`ModelBuilderExtensions.cs:56-60`), then instantiates via `ActivatorUtilities` and invokes
    the closed `ApplyConfiguration` (`ModelBuilderExtensions.cs:62-64`).
- **Why it's built this way**: `internal` keeps this a framework detail; modules never call it. The
  `entityFilter` parameter is the boundary that keeps each physical database's model to only its own
  entities (see [`ApplicationDbContext`](#applicationdbcontext)), and DI-based activation lets
  configurations depend on services without a parameterless-ctor constraint.
- **Where it's used**: called from
  [`ApplicationDbContext.ApplyConfigurationsForEntitiesInContext`](#applicationdbcontext), which passes
  the engine's configuration interface and a filter that matches each entity's resolved
  [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey).

### NamespaceConventions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:7` · Level 0 · class

- **What it is**: one internal static method that derives a module name from an entity type's namespace
  by returning the segment immediately preceding `Domain`. It is the single shared rule so SQL schema
  names and logical database names can never drift apart.
- **Depends on**: nothing first-party (BCL string/array only).
- **Concept introduced, convention-over-configuration naming.** `[Rubric §8, Data Architecture]`
  (assesses schema/database organization) and `[Rubric §7, Microservices Readiness]` (assesses whether
  the model splits cleanly per module): `MMCA.Store.Sales.Domain.Orders` yields `"Sales"`, which becomes
  both the `[Sales]` SQL schema and the `Sales` logical database name. A new module that follows the
  namespace pattern gets a schema and a data-source name with zero configuration; an explicit
  `[UseDatabase("X")]` attribute on a configuration overrides it when the pattern does not fit.
- **Walkthrough**: `GetModuleName(Type entityType)` (`NamespaceConventions.cs:16`) splits the namespace
  on `.`, finds the case-insensitive index of the `Domain` segment (`NamespaceConventions.cs:19-20`),
  and returns the preceding segment when that index is `>= 1`, otherwise `null`
  (`NamespaceConventions.cs:21`). The `>= 1` guard is what makes a `Domain`-first or `Domain`-less
  namespace fall through to `null`.
- **Why it's built this way**: a single authority for both derivations means the schema name and the
  database name are computed identically, so they cannot diverge. It is `internal` because callers
  should consume the resolved name, not re-derive it.
- **Where it's used**: [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry)
  falls back to it when no `[UseDatabase]` is present (`EntityDataSourceRegistry.cs:173`), and the
  `EntityTypeConfiguration` base class uses it for the SQL table schema and the Cosmos container name
  (`EntityTypeConfiguration.cs:67,88`).

### ProfilingHelper
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ProfilingHelper.cs:9` · Level 0 · class

- **What it is**: an internal static helper that wraps repository operations in a MiniProfiler timing
  step when profiling is active and is a zero-cost no-op when it is not.
- **Depends on**: `StackExchange.Profiling` (the MiniProfiler NuGet package); nothing first-party.
- **Concept introduced, opt-in per-operation timing via a null-conditional.** `[Rubric §13,
  Observability & Operability]` (assesses granular timing/instrumentation of persistence): every helper
  routes through `MiniProfiler.Current?.Step(...)` (`ProfilingHelper.cs:12`). When MiniProfiler is not
  registered, `MiniProfiler.Current` is `null`, the `?.` short-circuits, and the returned `Timing?` is
  `null`, so `using var step = ...` disposes nothing. The instrumentation can therefore live
  permanently in the decorators without a build-time toggle; the runtime cost when disabled is a single
  field read.
- **Walkthrough**:
  - `BeginStep(className, methodName)` (`ProfilingHelper.cs:11`): returns a `Timing?` named
    `MMCA.Common.Infrastructure.{className}: {methodName}`.
  - `Profile(className, methodName, Func<int>)` (`ProfilingHelper.cs:14`): opens a step and runs a
    synchronous delegate returning `int`.
  - `ProfileAsync(...)` non-generic and `ProfileAsync<T>(...)` (`ProfilingHelper.cs:20,26`): the async
    equivalents, each awaiting the delegate under the step with `ConfigureAwait(false)`.
- **Why it's built this way**: `internal` hides the profiling concern from callers outside
  Infrastructure; the null-conditional pattern means the same wrapper is safe in hot paths whether or
  not profiling is on.
- **Where it's used**: the EF repository decorators wrap every call through it (for example
  `EFRepositoryDecorator.cs:23-53` and `EFReadRepositoryDecorator.cs:31-80`);
  [`ApplicationDbContext.SaveChangesAsync`](#applicationdbcontext) opens its own MiniProfiler step
  directly (`ApplicationDbContext.cs:81`).

### ValReturn<T>
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:51` · Level 0 · class

- **What it is**: a keyless container class, nested in [`ApplicationDbContext`](#applicationdbcontext),
  used to materialize a scalar SQL result (a `bool`, `int`, `DateTime`, or `string`) from a raw query
  without a backing table.
- **Depends on**: `Microsoft.EntityFrameworkCore` and its host [`ApplicationDbContext`](#applicationdbcontext),
  which registers it as a keyless entity type.
- **Concept introduced, keyless entity types for raw scalar queries.** `[Rubric §8, Data
  Architecture]`: EF Core's `FromSql`-style scalar materialization needs a CLR class to project into.
  Rather than one ad-hoc class per scalar shape, `ValReturn<T>` is a single generic holder with one
  `Value` property that any raw query can select into as `SELECT ... AS Value`.
- **Walkthrough**: one mutable property, `T Value { get; set; } = default!` (`ApplicationDbContext.cs:54`).
  [`ApplicationDbContext.OnModelCreating`](#applicationdbcontext) registers four closed forms as keyless
  views with `HasNoKey().ToView(null)` (`ApplicationDbContext.cs:130-133`), so they map to no table and
  exist only to shape raw-query output.
- **Why it's built this way**: `internal sealed` keeps it a persistence-layer detail; the generic
  parameter avoids a proliferation of single-property result classes. `ToView(null)` marks the type as
  query-only with no schema object behind it.
- **Where it's used**: registered by [`ApplicationDbContext`](#applicationdbcontext); consumed by
  Infrastructure code that runs raw scalar SQL through EF.
- **Caveats / not-in-source**: only the four closed forms registered in `OnModelCreating` are usable;
  a fifth scalar type would need its own `HasNoKey().ToView(null)` registration.

### DefaultEntityConfigurationAssemblyProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DefaultEntityConfigurationAssemblyProvider.cs:12` · Level 1 · class

- **What it is**: the default implementation of
  [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider).
  It returns the set of assemblies whose EF entity configurations should be applied: every loaded
  assembly whose name contains `.Infrastructure` (excluding `Common.Infrastructure` itself), plus any
  assemblies explicitly registered through
  [`EntityConfigurationOptions`](#entityconfigurationoptions).
- **Depends on**: [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider)
  (the contract it implements), [`EntityConfigurationOptions`](#entityconfigurationoptions) via
  `IOptions<>`, and `System.AppDomain`/`System.Reflection` (BCL).
- **Concept introduced, name-convention assembly discovery with an explicit escape hatch.** `[Rubric
  §3, Clean Architecture]` (infrastructure finds module configurations without referencing modules) and
  `[Rubric §7, Microservices Readiness]` (each extracted service loads only its own modules'
  configuration assemblies): scanning `AppDomain.CurrentDomain.GetAssemblies()` means a host applies
  exactly the module infrastructure it has loaded, so a monolith gets all modules and an extracted
  service gets its subset, with no per-host registration list.
- **Walkthrough**: `GetConfigurationAssemblies()` (`DefaultEntityConfigurationAssemblyProvider.cs:16`)
  builds a collection expression from two spreads: the loaded assemblies whose `FullName` contains
  `.Infrastructure` and does **not** contain `Common.Infrastructure` (both matched
  `OrdinalIgnoreCase`, `DefaultEntityConfigurationAssemblyProvider.cs:18-20`), and the distinct
  `options.Value.AdditionalAssemblies` (`DefaultEntityConfigurationAssemblyProvider.cs:21`). The
  `Common.Infrastructure` exclusion is why Common-internal feature modules must opt in through
  [`EntityConfigurationOptions`](#entityconfigurationoptions).
- **Why it's built this way**: `sealed`; convention scanning keeps hosts declarative, and the
  additional-assemblies list covers the one case the convention deliberately excludes. Depending only
  on the abstraction plus options keeps the persistence layer free of module references.
- **Where it's used**: injected into [`ApplicationDbContext`](#applicationdbcontext) (as
  `IEntityConfigurationAssemblyProvider`), which iterates its assemblies inside
  `ApplyConfigurationsForEntitiesInContext`.

### EFQueryableExecutor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/EFQueryableExecutor.cs:11` · Level 1 · class

- **What it is**: the EF Core bridge for the Application layer's `IQueryableExecutor`. It exposes
  `Include`, `AsSplitQuery`, `ToListAsync`, and `CountAsync` over an `IQueryable<T>`, guarding each so
  the same code path works against a real EF queryable and against a plain in-memory `IQueryable`.
- **Depends on**: [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (the
  Application-layer contract it implements) and `Microsoft.EntityFrameworkCore`
  (`EntityFrameworkQueryableExtensions`).
- **Concept introduced, provider-agnostic query execution.** `[Rubric §14, Testability]` (assesses
  whether query logic can run without a database) and `[Rubric §3, Clean Architecture]` (keeps EF's
  async extension methods behind an Application abstraction): the Application layer builds specifications
  and calls `IQueryableExecutor` rather than EF directly, so the same handlers execute against a
  LINQ-to-Objects list in a unit test and against a SQL provider in production.
- **Walkthrough**:
  - `Include<T>` (`EFQueryableExecutor.cs:14`): calls EF's string-based `Include` on an EF queryable,
    otherwise returns the query unchanged (in-memory queries are already fully loaded).
  - `AsSplitQuery<T>` (`EFQueryableExecutor.cs:21`): applies EF's split-query behavior only on EF
    queryables, otherwise a pass-through.
  - `ToListAsync<T>` (`EFQueryableExecutor.cs:28`): uses EF's async materialization when available,
    otherwise the synchronous collection expression `[.. query]`.
  - `CountAsync<T>` (`EFQueryableExecutor.cs:34`): EF async count when available, otherwise
    `Task.FromResult(query.Count())`.
  - `IsEfQuery<T>` (`EFQueryableExecutor.cs:43`): the discriminator: an EF provider's queryable
    implements `IAsyncEnumerable<T>`, a plain LINQ-to-Objects queryable does not, so a single
    `is IAsyncEnumerable<T>` test routes each call.
- **Why it's built this way**: `internal sealed`; centralizing the EF/in-memory branch in one class
  means every consumer gets the fallback for free and no handler references EF's static extension
  methods.
- **Where it's used**: resolved as `IQueryableExecutor` by the query-side repositories and
  specification evaluation in Infrastructure.

### ApplicationDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:34` · Level 6 · class

- **What it is**: the single abstract `DbContext` base that every engine-specific context
  ([`SQLServerDbContext`](#sqlserverdbcontext), [`CosmosDbContext`](#cosmosdbcontext),
  [`SqliteDbContext`](#sqlitedbcontext)) inherits. One instance exists per **physical database**: the
  same class is instantiated multiple times, each carrying a different
  [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource) and building a model that
  contains only that database's entities.
- **Depends on**: [`AuditSaveChangesInterceptor`](group-07-persistence-ef-core.md#auditsavechangesinterceptor),
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor),
  [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory),
  [`CrossDataSourceDegradeConvention`](group-07-persistence-ef-core.md#crossdatasourcedegradeconvention),
  [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider),
  [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource),
  [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity),
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage),
  [`InboxMessage`](group-04-events-outbox.md#inboxmessage), MiniProfiler, and EF Core.
- **Concept introduced, DbContext as Unit of Work + Change Tracker.** `[Rubric §8, Data Architecture]`
  (assesses transactions, migrations, soft-delete, audit, concurrency): EF's `DbContext` is the unit of
  work, tracking every `Added`/`Modified`/`Deleted` entity since the last save and writing them in a
  single transaction. This is also `[Rubric §3, Clean Architecture]` (the EF detail stays in
  Infrastructure; domain entities carry no EF attributes) and `[Rubric §6, CQRS & Event-Driven]`
  (domain events are captured transactionally with the aggregate write). The two interceptors registered
  in `OnConfiguring` run before and after `base.SaveChangesAsync` to stamp audit fields and serialize
  domain events into the outbox, so those cross-cutting concerns live in the interceptor pipeline rather
  than inline.
- **Walkthrough**:
  - **Primary constructor** (`ApplicationDbContext.cs:34-39`): takes `DbContextOptions`, an
    `IServiceProvider`, an `IEntityConfigurationAssemblyProvider`, and the `PhysicalDataSource` this
    instance targets, delegating to `DbContext(options)`.
  - **`DataSourceKey`** (`ApplicationDbContext.cs:42`): exposes the `(engine, database name)` pair this
    context serves; **`PhysicalSource`** (`ApplicationDbContext.cs:45`) exposes the resolved connection
    info to subclasses.
  - **`ValReturn<T>`** (`ApplicationDbContext.cs:51`): the nested keyless scalar holder (documented in
    its own section above).
  - **`SupportsOutbox`** (`ApplicationDbContext.cs:62`): `internal virtual`, `true` by default; the
    Cosmos subclass overrides to `false`. Read by the domain-event interceptor.
  - **`CurrentSaveUserId`** (`ApplicationDbContext.cs:69`): `internal` audit user id, set by the public
    save overload and read by the audit interceptor; `null` marks a system operation.
  - **`SaveChangesAsync(userId, ct)`** (`ApplicationDbContext.cs:79`): the mutation entry point. Opens a
    MiniProfiler step, sets `CurrentSaveUserId`, then calls `base.SaveChangesAsync`, which fires the
    interceptor pipeline.
  - **`OnConfiguring`** (`ApplicationDbContext.cs:87`): resolves both interceptors from DI and adds them
    (`ApplicationDbContext.cs:94-96`), then replaces EF's `IModelCacheKeyFactory` with
    [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory) (`ApplicationDbContext.cs:101`)
    so each database gets its own model.
  - **`ConfigureConventions`** (`ApplicationDbContext.cs:107`): adds
    [`CrossDataSourceDegradeConvention`](group-07-persistence-ef-core.md#crossdatasourcedegradeconvention)
    at model finalization (`ApplicationDbContext.cs:115-116`), which strips FK constraints and
    navigations between entities in different physical databases (a no-op in the collapsed-monolith
    case).
  - **`OnModelCreating`** (`ApplicationDbContext.cs:124`): applies soft-delete filters and concurrency
    tokens, registers the four keyless `ValReturn<T>` views, and configures the outbox and inbox tables.
  - **`ApplySoftDeleteFilters`** (`ApplicationDbContext.cs:149`): `protected static`; iterates every
    non-owned `IAuditableEntity` type and builds an expression-tree
    `HasQueryFilter("SoftDelete", e => !e.IsDeleted)` (`ApplicationDbContext.cs:151-162`). Expression
    trees are required because the CLR type is only known at runtime; owned types are excluded because
    they inherit the parent filter. `[Rubric §5, Vertical Slice]` (global filters eliminate per-query
    `Where(!IsDeleted)` boilerplate).
  - **`ConfigureConcurrencyTokens`** (`ApplicationDbContext.cs:176`): applies `IsRowVersion()` on SQL
    Server (database-generated `rowversion`) or `IsConcurrencyToken()` elsewhere (application-managed)
    to the `RowVersion` property of every non-owned auditable entity
    (`ApplicationDbContext.cs:179-195`). EF then includes the token in `UPDATE`/`DELETE` `WHERE`
    clauses and throws `DbUpdateConcurrencyException` on conflicts. `[Rubric §8, Data Architecture]`.
  - **`ConfigureOutbox` / `ConfigureInbox`** (`ApplicationDbContext.cs:203,223`): map `OutboxMessages`
    and `InboxMessages` in `dbo`, with a filtered `IX_OutboxMessages_Pending` index on
    `[ProcessedOn] IS NULL` (`ApplicationDbContext.cs:213-215`) and a unique
    `IX_InboxMessages_MessageId` index (`ApplicationDbContext.cs:229-231`).
  - **`ApplyConfigurationsForEntitiesInContext`** (`ApplicationDbContext.cs:241`): the discovery method
    subclasses call from their `OnModelCreating`. It maps the engine to its configuration interface
    (`ApplicationDbContext.cs:243-249`), then for each assembly from the provider calls
    [`ModelBuilderExtensions.ApplyAllConfigurations`](#modelbuilderextensions) with a filter that keeps
    only entities whose registry-resolved key equals this `DataSourceKey`, or, for unregistered
    entities, only when this context is the engine's `Default` source
    (`ApplicationDbContext.cs:258-267`).
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (database-per-service) requires the same context class per
  database; without a specialized model-cache key EF would build one model and silently reuse it, so
  queries would hit tables that do not exist in the other databases. The single `ApplicationDbContext`
  is deliberately never split into per-module context classes ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The interceptor pipeline keeps
  audit and outbox concerns out of every handler.
- **Where it's used**: inherited by the three concrete contexts below; consumed by the interceptors,
  the outbox processor, and the context factories.

### DataSourceModelCacheKeyFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16` · Level 6 · class

- **What it is**: a replacement for EF Core's default `IModelCacheKeyFactory`. Where the default keys
  the model cache by context **type** alone, this keys by `(context type, data source name, design-time
  flag)`, so each physical database gets its own EF model.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext) (to read `DataSourceKey.Name`) and
  EF Core's `IModelCacheKeyFactory`.
- **Concept introduced, model caching under one-context-class-per-engine.** `[Rubric §8, Data
  Architecture]`: EF builds an in-memory model per `DbContext` type and caches it. When the same class
  serves two databases, EF would reuse the first model and the second database's entities would be
  missing. Inserting `DataSourceKey.Name` into the cache key makes EF treat "SQL Server / Conference"
  and "SQL Server / Identity" as distinct models. This is the critical enabler for [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html).
- **Walkthrough**: `Create(DbContext context, bool designTime)` (`DataSourceModelCacheKeyFactory.cs:19`)
  returns `(context.GetType(), applicationDbContext.DataSourceKey.Name, designTime)` when the context is
  an `ApplicationDbContext`, otherwise falls back to `(context.GetType(), designTime)`. The value tuple's
  structural equality is all EF needs to key its cache dictionary.
- **Why it's built this way**: the fix is minimal and lives entirely in Infrastructure through EF's
  supported extension point; no EF internals are subverted.
- **Where it's used**: registered in
  [`ApplicationDbContext.OnConfiguring`](#applicationdbcontext) via
  `optionsBuilder.ReplaceService<IModelCacheKeyFactory, DataSourceModelCacheKeyFactory>()`.

### CosmosDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:15` · Level 7 · class

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting Azure
  Cosmos DB. One instance exists per physical Cosmos data source (account plus database). It is the most
  divergent of the three concrete contexts because Cosmos is non-relational: no outbox table, no
  relational indexes, and a different `OnModelCreating` path.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource),
  [`DataSource`](group-07-persistence-ef-core.md#datasource),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage),
  [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider),
  and the Cosmos EF provider (`Microsoft.Azure.Cosmos`). `[Rubric §8, Data Architecture]` (one concrete
  context per engine) and `[Rubric §11, Security]` (the emulator-only certificate bypass).
- **Walkthrough**:
  - **4-arg constructor** (`CosmosDbContext.cs:15-20`): forwards options, service provider, assembly
    provider, and physical source to the base.
  - **Emulator detection** (`CosmosDbContext.cs:27-62`): checks the connection string for the well-known
    emulator key prefix `"C2y6yDjf5"` (`CosmosDbContext.cs:30`). The emulator path uses
    `ConnectionMode.Gateway` and `DangerousAcceptAnyServerCertificateValidator` (the self-signed cert),
    guarded by a `#pragma warning disable S4830` with a comment that this is safe only in local dev
    (`CosmosDbContext.cs:42-53`). The production path uses `ConnectionMode.Direct` with
    `MaxRequestsPerTcpConnection(20)` and `MaxTcpConnectionsPerEndpoint(32)`
    (`CosmosDbContext.cs:58-60`).
  - **`SupportsOutbox => false`** (`CosmosDbContext.cs:70`): overrides the base; Cosmos has no relational
    outbox table, so domain events are dispatched in-process only.
  - **`OnModelCreating`** (`CosmosDbContext.cs:73-95`): applies the Cosmos configurations, then
    `Ignore<OutboxMessage>()` (`CosmosDbContext.cs:78`), then removes every index from every entity type
    (`CosmosDbContext.cs:84-88`) because the provider does not support relational `HasIndex`/`HasFilter`,
    then calls `ApplySoftDeleteFilters` directly. It deliberately does **not** call
    `base.OnModelCreating` (`CosmosDbContext.cs:90-94`) because the base registers the keyless
    `ValReturn<T>` views, a relational-only construct the Cosmos provider rejects.
- **Why it's built this way**: pushing all provider differences into this subclass keeps the base and
  the entity configuration bodies engine-agnostic; stripping indexes lets one configuration body serve
  both SQL Server and Cosmos.
- **Where it's used**: instantiated per Cosmos source by the physical context factory when a data source
  resolves to the `CosmosDB` engine.
- **Caveats / not-in-source**: the emulator certificate bypass is intentionally scoped to the emulator
  key prefix; whether any production connection string could match that prefix is Not determinable from
  source.

### SqliteDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SqliteDbContext.cs:13` · Level 7 · class

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting SQLite,
  the minimal concrete context. One instance exists per physical SQLite data source (database file),
  useful for lightweight local development or testing without a SQL Server instance.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource),
  [`DataSource`](group-07-persistence-ef-core.md#datasource),
  [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider),
  and the SQLite EF provider.
- **Walkthrough**: the 4-arg constructor forwards to the base (`SqliteDbContext.cs:13-19`).
  `OnConfiguring` is just `optionsBuilder.UseSqlite(PhysicalSource.ConnectionString)`
  (`SqliteDbContext.cs:24-25`), with no retry policy (the store is file-local) and no migrations-assembly
  override. `OnModelCreating` calls `ApplyConfigurationsForEntitiesInContext(DataSource.Sqlite,
  modelBuilder)` then `base.OnModelCreating` (`SqliteDbContext.cs:31-33`), so unlike Cosmos it keeps the
  full base pipeline (soft-delete filters, concurrency tokens as application-managed tokens, outbox and
  inbox tables, and the `ValReturn<T>` views). See [`SQLServerDbContext`](#sqlserverdbcontext) for the
  shared subclass shape.
- **Why it's built this way**: SQLite needs none of the SQL Server hardening (transient-failure retry,
  per-service migrations assembly), so the override is intentionally sparse.
- **Where it's used**: instantiated per SQLite source by the physical context factory when a data source
  resolves to the `Sqlite` engine.

### SQLServerDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:14` · Level 7 · class

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting SQL
  Server, the production-primary context. One instance exists per physical SQL Server data source
  (database); its connection string and migrations assembly come from the resolved
  [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource),
  [`DataSource`](group-07-persistence-ef-core.md#datasource),
  [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider),
  and the SQL Server EF provider (`RelationalEventId`). `[Rubric §8, Data Architecture]` (one concrete
  context per engine, one instance per database) and `[Rubric §29, Resilience & Business Continuity]`
  (the retry policy is baked into the SQL Server path).
- **Walkthrough**:
  - **4-arg constructor** (`SQLServerDbContext.cs:14-19`): forwards to the base.
  - **`OnConfiguring`** (`SQLServerDbContext.cs:22-61`): calls
    `UseSqlServer(PhysicalSource.ConnectionString, sql => ...)`. The options action conditionally sets
    `sql.MigrationsAssembly(PhysicalSource.SqlServerMigrationsAssembly)` (`SQLServerDbContext.cs:31-34`)
    so each extracted service can point at its own per-module migrations project, then
    `sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10),
    errorNumbersToAdd: null)` (`SQLServerDbContext.cs:42-45`). An inline comment
    (`SQLServerDbContext.cs:38-41`) records the retry caveat: with retry enabled, any manual
    `BeginTransactionAsync` must be wrapped in `Database.CreateExecutionStrategy().ExecuteAsync`, which
    the transactional command decorator already does. Finally
    `ConfigureWarnings(w => w.Ignore(RelationalEventId.PendingModelChangesWarning))`
    (`SQLServerDbContext.cs:58`) suppresses EF Core's pending-model error.
  - **`OnModelCreating`** (`SQLServerDbContext.cs:64-68`): calls
    `ApplyConfigurationsForEntitiesInContext(DataSource.SQLServer, modelBuilder)` then
    `base.OnModelCreating`, so the full base pipeline (soft-delete, `rowversion` concurrency tokens,
    outbox/inbox tables, `ValReturn<T>` views) runs.
- **Why it's built this way**: the `PendingModelChangesWarning` suppression is required by the
  microservices-extraction design: each extracted host registers only its enabled modules'
  configurations, so its runtime model is a strict subset of the migration snapshot (the union of all
  modules), and EF Core 9+ would otherwise promote that mismatch to an error during `MigrateAsync`. The
  documented trade-off (`SQLServerDbContext.cs:55-57`): the monolith loses the "you forgot a migration"
  safety net, so CI should run `dotnet ef migrations has-pending-model-changes` against the full model
  as a separate gate. Retry-on-failure exists so cold-replica startup connections and platform replica
  replacements do not surface as user-facing 5xx ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)).
- **Where it's used**: instantiated per SQL Server source by the physical context factory; the primary
  production context in both MMCA.ADC and MMCA.Store.

### UnitOfWork
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13` · Level 8 · class

- **What it is**: the concrete implementation of
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the scoped coordinator every handler
  injects to obtain repositories and to save. It caches repositories per entity type so all operations
  in a scope share one change tracker and context.
- **Depends on**: [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory) (implemented
  by [`DbContextFactory`](group-07-persistence-ef-core.md#dbcontextfactory)),
  [`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice),
  [`IRepositoryFactory`](group-07-persistence-ef-core.md#irepositoryfactory),
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype),
  and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype).
- **Concept introduced, the Unit of Work over a database-per-service topology.** `[Rubric §2, Design
  Patterns]` (Unit of Work + Repository) and `[Rubric §8, Data Architecture]` (transactions and
  change-tracker scoping): a handler never knows which database an entity lives in. `GetRepository`
  resolves the entity's physical source, obtains the matching context, and builds a repository bound to
  it; caching that repository per scope guarantees one change tracker per database, which is what makes
  "load aggregate, mutate, one save" correct.
- **Walkthrough**:
  - **Constructor** (`UnitOfWork.cs:13-16`): stores the context factory, data-source service, and
    repository factory, null-guarding the context factory and the repository factory.
  - **`_repositories`** (`UnitOfWork.cs:23`): a `Dictionary<Type, object>` keyed by the closed generic
    repository interface (for example `IRepository<Order, int>`), so a repository is created at most
    once per entity type per scope.
  - **`GetRepository<TEntity, TIdentifierType>()`** (`UnitOfWork.cs:33-46`): on a cache miss, resolves
    the entity's `DataSourceKey` via `dataSourceService.GetDataSourceKey(typeof(TEntity))`
    (`UnitOfWork.cs:40`), asks the context factory for the matching context, and builds a read-write
    repository through the repository factory; constrained to
    `AuditableAggregateRootEntity<TIdentifierType>` so only aggregate roots get a mutable repository.
  - **`GetReadRepository<TEntity, TIdentifierType>()`** (`UnitOfWork.cs:53-66`): the same resolution but
    calls `CreateReadOnly` and accepts any `AuditableBaseEntity<TIdentifierType>`, for query handlers.
  - **Save and transaction methods** (`UnitOfWork.cs:69-91`): `SaveChangesAsync`, `Save`,
    `RequestIdentityInsert`, `BeginTransaction`, `CommitTransaction`, `RollbackTransaction`, and
    `ExecuteInTransactionAsync` all delegate straight to the context factory, because in a
    multi-database scope the factory is what coordinates saving and transacting across every context the
    scope touched.
  - **Disposal** (`UnitOfWork.cs:93-119`): implements both `Dispose` and `DisposeAsync`, disposing the
    context factory once, guarded by the `_disposed` flag.
- **Why it's built this way**: the UoW plus the factory hide the physical topology from handlers, and
  per-scope repository caching guarantees a single change tracker per database. It is `internal sealed`
  because consumers only ever see the `IUnitOfWork` abstraction (DIP).
- **Where it's used**: injected into virtually every command and query handler in Common and in both
  apps.

### DetectChangesScope
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:170` · Level 0 · struct (private readonly, nested)

- **What it is**: a two-field disposable struct nested inside
  [`ApplicationDbContext`](#applicationdbcontext) whose only job is to put EF's
  `ChangeTracker.AutoDetectChangesEnabled` flag back the way it found it when a save finishes.
- **Depends on**: `Microsoft.EntityFrameworkCore.ChangeTracking.ChangeTracker` and `System.IDisposable`
  (both external/BCL); nothing first-party beyond its enclosing context class.
- **Concept introduced, the scoped-setting guard (restore-on-dispose).** `[Rubric §12, Performance &
  Scalability]` (assesses whether hot paths avoid repeated O(n) work) and `[Rubric §15, Best Practices
  & Code Quality]` (assesses whether temporary global-state mutation is bounded rather than leaked).
  EF's `ChangeTracker.Entries<T>()` runs a full `DetectChanges` pass on every call and memoizes
  nothing. Two interceptors scan the tracker during `SavingChanges`
  ([`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor) over `IAuditableEntity` at
  `AuditSaveChangesInterceptor.cs:43`, and
  [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) over
  [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) at
  `DomainEventSaveChangesInterceptor.cs:153`), and EF then detects once more on its own before building
  the save, so a single save paid three `O(tracked entities x properties)` snapshot comparisons where
  one suffices (`ApplicationDbContext.cs:142-150`). Turning detection off for the duration of the save
  is the optimization; a `using`-scoped struct is what makes turning it back on unforgettable, including
  on the exception path.
- **Walkthrough**: the primary constructor `DetectChangesScope(ChangeTracker changeTracker, bool
  previousSetting)` (`ApplicationDbContext.cs:170`) captures the tracker and the flag value that was in
  force before suppression. `Dispose()` (`ApplicationDbContext.cs:172`) is a single expression-bodied
  assignment that writes `previousSetting` back onto `changeTracker.AutoDetectChangesEnabled`. It is
  created only by `DetectChangesOnce()` (`ApplicationDbContext.cs:160-168`), which reads the current
  setting, calls `ChangeTracker.DetectChanges()` once when detection was on
  (`ApplicationDbContext.cs:163-164`), sets the flag to `false`, and hands back the scope.
- **Why it's built this way**: `readonly struct` means no heap allocation on a path that runs on every
  save, and `private` keeps the mechanism invisible to callers. Restoring the *previous* value rather
  than hardcoding `true` is the load-bearing detail: a caller that had deliberately disabled
  auto-detect keeps its choice and never gets an unexpected detection pass on the way out
  (`ApplicationDbContext.cs:155-158`). Suppressing the remaining passes is safe because everything the
  interceptors do afterwards bypasses detection anyway: the audit interceptor writes through
  `entry.Property(...).CurrentValue` (`AuditSaveChangesInterceptor.cs:48-57`) and the domain-event
  interceptor adds outbox rows through `Add`, both of which take effect on the entry immediately.
- **Where it's used**: both save overrides that EF funnels through, `SaveChangesAsync(bool,
  CancellationToken)` (`ApplicationDbContext.cs:100-106`) and `SaveChanges(bool)`
  (`ApplicationDbContext.cs:133-137`), open one with `using var detection = DetectChangesOnce()`. The
  behavior is pinned by `SaveChangeDetectionTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/SaveChangeDetectionTests.cs:63-97`),
  which asserts audit stamps still land, that a caller's explicit `false` survives the save, and that a
  default context is left with detection enabled for the next caller.

### EntityConfigurationOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/EntityConfigurationOptions.cs:10` · Level 0 · class (sealed)

- **What it is**: an options bag that carries extra assemblies whose EF Core entity type
  configurations should be applied on top of the ones auto-discovered by name. A host or module pushes
  an `Assembly` into it during DI so its configurations are picked up without the discovery scan having
  to match it by naming convention.
- **Depends on**: `System.Reflection.Assembly` (BCL); nothing first-party. It is read by
  [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider) through
  `IOptions<EntityConfigurationOptions>` (`DefaultEntityConfigurationAssemblyProvider.cs:13`).
- **Concept introduced, options-object supplementation of convention discovery.** `[Rubric §3, Clean
  Architecture]` (assesses whether infrastructure discovers its collaborators rather than hardcoding
  references to them): the persistence layer does not reference every module's Infrastructure project,
  so a module that does not follow the `.Infrastructure` naming rule (for example a Common feature like
  Notification that lives inside `Common.Infrastructure` itself, which the auto-scan deliberately
  excludes) still gets its configurations applied by adding its assembly here. The doc comment names
  exactly that case (`EntityConfigurationOptions.cs:5-9`).
- **Walkthrough**: one member, `List<Assembly> AdditionalAssemblies { get; } = []`
  (`EntityConfigurationOptions.cs:16`). It is get-only and initialized to an empty list, so registration
  code mutates the list rather than replacing it.
- **Why it's built this way**: an options object keeps the supplemental-assembly list open for
  extension without the provider (or the context) taking a compile-time dependency on any specific
  module. The provider merges these with the name-scanned set and de-duplicates.
- **Where it's used**: written through the `AddEntityConfigurationAssembly(Assembly)` extension
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:230-240`), which
  `services.Configure<EntityConfigurationOptions>` with a contains-check so an assembly is added at most
  once; `AddNotificationInfrastructure()` (`DependencyInjection.cs:247-252`) is the one in-framework
  caller, registering the Notification module's configuration assembly. It is read by
  [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider).

### ModelBuilderExtensions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ModelBuilderExtensions.cs:10` · Level 0 · class (internal static)

- **What it is**: an internal static class holding a single extension member, `ApplyAllConfigurations`,
  that scans an assembly for concrete classes implementing a provider-specific configuration interface,
  instantiates each through DI, and applies it to the EF model, with an optional per-entity filter.
- **Depends on**: `Microsoft.EntityFrameworkCore.ModelBuilder`, `System.Reflection`, and
  `Microsoft.Extensions.DependencyInjection.ActivatorUtilities` (all BCL/EF/NuGet). It is called by
  [`ApplicationDbContext`](#applicationdbcontext); it does not itself reference
  [`NamespaceConventions`](#namespaceconventions) or
  [`EntityConfigurationOptions`](#entityconfigurationoptions).
- **Concept introduced, reflection-driven configuration application with a DI-aware activator.**
  `[Rubric §8, Data Architecture]` (assesses deliberate, discoverable model configuration) and `[Rubric
  §2, Design Patterns]` (a generic apply-all built over EF's `ApplyConfiguration<TEntity>`): because the
  entity CLR type is only known at runtime, the method resolves EF's open generic
  `ModelBuilder.ApplyConfiguration<TEntity>(IEntityTypeConfiguration<TEntity>)` once, then closes it per
  entity via `MakeGenericMethod`. Configurations are created with `ActivatorUtilities.CreateInstance`
  (`ModelBuilderExtensions.cs:62`), so a configuration class may constructor-inject services rather than
  needing a parameterless ctor. The member is declared inside a C# `extension(ModelBuilder
  modelBuilder)` block (`ModelBuilderExtensions.cs:12`), the preview extension-member syntax this
  workspace uses instead of `this`-parameter extension methods.
- **Walkthrough**:
  - Guards all four required arguments with `ArgumentNullException.ThrowIfNull`
    (`ModelBuilderExtensions.cs:31-34`).
  - Resolves the single-parameter `ApplyConfiguration` overload by reflection
    (`ModelBuilderExtensions.cs:38-40`).
  - Selects concrete, non-generic-definition types in the assembly whose interface set contains a closed
    form of `interfaceType` (the open generic like `IEntityTypeConfigurationSQLServer<,>`)
    (`ModelBuilderExtensions.cs:42-51`).
  - For each, takes the first generic argument as the entity type, skips it when `entityFilter` returns
    false (`ModelBuilderExtensions.cs:56-60`), then instantiates via `ActivatorUtilities` and invokes
    the closed `ApplyConfiguration` (`ModelBuilderExtensions.cs:62-64`).
- **Why it's built this way**: `internal` keeps this a framework detail; modules never call it. The
  `entityFilter` parameter is the boundary that keeps each physical database's model to only its own
  entities (see [`ApplicationDbContext`](#applicationdbcontext)), and DI-based activation lets
  configurations depend on services without a parameterless-ctor constraint.
- **Where it's used**: called from
  [`ApplicationDbContext.ApplyConfigurationsForEntitiesInContext`](#applicationdbcontext)
  (`ApplicationDbContext.cs:370-376`), which passes the engine's configuration interface and a filter
  that matches each entity's registry-resolved
  [`DataSourceKey`](#datasourcekey).

### NamespaceConventions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:7` · Level 0 · class (internal static)

- **What it is**: one internal static method that derives a module name from an entity type's namespace
  by returning the segment immediately preceding `Domain`. It is the single shared rule so SQL schema
  names and logical database names can never drift apart.
- **Depends on**: nothing first-party (BCL string/array only).
- **Concept introduced, convention-over-configuration naming.** `[Rubric §8, Data Architecture]`
  (assesses schema/database organization) and `[Rubric §7, Microservices Readiness]` (assesses whether
  the model splits cleanly per module): `MMCA.Store.Sales.Domain.Orders` yields `"Sales"`, which becomes
  both the `[Sales]` SQL schema and the `Sales` logical database name (the two worked examples are in
  the doc comment, `NamespaceConventions.cs:9-13`). A new module that follows the namespace pattern gets
  a schema and a data-source name with zero configuration; an explicit `[UseDatabase("X")]` attribute on
  a configuration overrides it when the pattern does not fit.
- **Walkthrough**: `GetModuleName(Type entityType)` (`NamespaceConventions.cs:16`) splits the namespace
  on `.`, defaulting to an empty array when `Namespace` is null (`NamespaceConventions.cs:18`), finds
  the case-insensitive index of the `Domain` segment (`NamespaceConventions.cs:19-20`), and returns the
  preceding segment when that index is `>= 1`, otherwise `null` (`NamespaceConventions.cs:21`). The
  `>= 1` guard is what makes a `Domain`-first or `Domain`-less namespace fall through to `null`.
- **Why it's built this way**: a single authority for both derivations means the schema name and the
  database name are computed identically, so they cannot diverge. It is `internal` because callers
  should consume the resolved name, not re-derive it.
- **Where it's used**: [`EntityDataSourceRegistry`](#entitydatasourceregistry) falls back to it when no
  `[UseDatabase]` is present (`EntityDataSourceRegistry.cs:181`), and
  [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype)
  uses it for the SQL table schema (`EntityTypeConfiguration.cs:66`, falling back to `dbo`) and the
  Cosmos container name (`EntityTypeConfiguration.cs:87`, falling back to the entity type name).

### ProfilingHelper
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ProfilingHelper.cs:9` · Level 0 · class (internal static)

- **What it is**: an internal static helper that wraps repository operations in a MiniProfiler timing
  step when profiling is active and is a no-op when it is not.
- **Depends on**: `StackExchange.Profiling` (the MiniProfiler NuGet package); nothing first-party.
- **Concept introduced, opt-in per-operation timing via a null-conditional.** `[Rubric §13,
  Observability & Operability]` (assesses granular timing/instrumentation of persistence): every helper
  routes through `MiniProfiler.Current?.Step(...)` (`ProfilingHelper.cs:11-12`). When MiniProfiler is
  not registered, `MiniProfiler.Current` is `null`, the `?.` short-circuits, and the returned `Timing?`
  is `null`, so `using var step = ...` disposes nothing. The instrumentation can therefore live
  permanently in the decorators without a build-time toggle; the runtime cost when disabled is a single
  field read.
- **Walkthrough**:
  - `BeginStep(className, methodName)` (`ProfilingHelper.cs:11-12`): returns a `Timing?` named
    `MMCA.Common.Infrastructure.{className}: {methodName}`, so every step in the profiler tree is
    self-identifying.
  - `Profile(className, methodName, Func<int>)` (`ProfilingHelper.cs:14-18`): opens a step and runs a
    synchronous delegate returning `int` (the shape of a sync `Save`).
  - `ProfileAsync(...)` non-generic and `ProfileAsync<T>(...)` (`ProfilingHelper.cs:20-24,26-30`): the
    async equivalents, each awaiting the delegate under the step with `ConfigureAwait(false)`.
- **Why it's built this way**: `internal` hides the profiling concern from callers outside
  Infrastructure; the null-conditional pattern means the same wrapper is safe in hot paths whether or
  not profiling is on.
- **Where it's used**: the EF repository decorators wrap every call through it, for example
  [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype)
  (`EFRepositoryDecorator.cs:24-65`, covering `AddAsync` through `SaveChangesAsync`) and
  [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype)
  (`EFReadRepositoryDecorator.cs:31-80`, covering `GetAllAsync` through `ExistsAsync`).
  [`ApplicationDbContext.SaveChangesAsync`](#applicationdbcontext) opens its own MiniProfiler step
  directly rather than through this helper (`ApplicationDbContext.cs:82`).

### ValReturn<T>
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:52` · Level 0 · class (internal sealed, nested)

- **What it is**: a keyless container class, nested in [`ApplicationDbContext`](#applicationdbcontext),
  used to materialize a scalar SQL result (a `bool`, `int`, `DateTime`, or `string`) from a raw query
  without a backing table.
- **Depends on**: `Microsoft.EntityFrameworkCore` and its host
  [`ApplicationDbContext`](#applicationdbcontext), which registers it as a keyless entity type.
- **Concept introduced, keyless entity types for raw scalar queries.** `[Rubric §8, Data
  Architecture]`: EF Core's `FromSql`-style scalar materialization needs a CLR class to project into.
  Rather than one ad-hoc class per scalar shape, `ValReturn<T>` is a single generic holder with one
  `Value` property that any raw query can select into as `SELECT ... AS Value`.
- **Walkthrough**: one mutable property, `T Value { get; set; } = default!`
  (`ApplicationDbContext.cs:55`). [`ApplicationDbContext.OnModelCreating`](#applicationdbcontext)
  registers four closed forms as keyless views with `HasNoKey().ToView(null)`
  (`ApplicationDbContext.cs:224-227`), so they map to no table and exist only to shape raw-query output.
  [`CosmosDbContext`](#cosmosdbcontext) deliberately skips `base.OnModelCreating` partly because of this
  registration (`CosmosDbContext.cs:89-93`).
- **Why it's built this way**: `internal sealed` keeps it a persistence-layer detail; the generic
  parameter avoids a proliferation of single-property result classes. `ToView(null)` marks the type as
  query-only with no schema object behind it.
- **Where it's used**: registered by [`ApplicationDbContext`](#applicationdbcontext). The four closed
  forms are baked into every generated migration model snapshot (for example
  `MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/Migrations/SQLServerDbContextModelSnapshot.cs:25-55`),
  which is how you can see them without a table.
- **Caveats / not-in-source**: only the four closed forms registered in `OnModelCreating` are usable; a
  fifth scalar type would need its own `HasNoKey().ToView(null)` registration. A source search across
  the four repos finds no first-party call site that projects into `ValReturn<T>` today: it is a
  provided extension point for raw scalar SQL, not a currently exercised path.

### DefaultEntityConfigurationAssemblyProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DefaultEntityConfigurationAssemblyProvider.cs:12` · Level 1 · class (sealed)

- **What it is**: the default implementation of
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider). It returns the set of
  assemblies whose EF entity configurations should be applied: every loaded assembly whose name contains
  `.Infrastructure` (excluding `Common.Infrastructure` itself), plus any assemblies explicitly
  registered through [`EntityConfigurationOptions`](#entityconfigurationoptions).
- **Depends on**: [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) (the
  contract it implements), [`EntityConfigurationOptions`](#entityconfigurationoptions) via `IOptions<>`
  (`DefaultEntityConfigurationAssemblyProvider.cs:13`), and `System.AppDomain`/`System.Reflection`
  (BCL).
- **Concept introduced, name-convention assembly discovery with an explicit escape hatch.** `[Rubric
  §3, Clean Architecture]` (infrastructure finds module configurations without referencing modules) and
  `[Rubric §7, Microservices Readiness]` (each extracted service loads only its own modules'
  configuration assemblies): scanning `AppDomain.CurrentDomain.GetAssemblies()` means a host applies
  exactly the module infrastructure it has loaded, so a monolith gets all modules and an extracted
  service gets its subset, with no per-host registration list.
- **Walkthrough**: `GetConfigurationAssemblies()` (`DefaultEntityConfigurationAssemblyProvider.cs:16`)
  builds a collection expression from two spreads: the loaded assemblies whose `FullName` is non-null,
  contains `.Infrastructure`, and does **not** contain `Common.Infrastructure` (both matched
  `OrdinalIgnoreCase`, `DefaultEntityConfigurationAssemblyProvider.cs:17-20`), and the distinct
  `options.Value.AdditionalAssemblies` (`DefaultEntityConfigurationAssemblyProvider.cs:21`). The
  `Common.Infrastructure` exclusion is why Common-internal feature modules must opt in through
  [`EntityConfigurationOptions`](#entityconfigurationoptions).
- **Why it's built this way**: `sealed`; convention scanning keeps hosts declarative, and the
  additional-assemblies list covers the one case the convention deliberately excludes. Depending only
  on the abstraction plus options keeps the persistence layer free of module references.
- **Where it's used**: registered as the singleton
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) via `TryAddSingleton`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:49`) and injected into
  [`ApplicationDbContext`](#applicationdbcontext), which iterates its assemblies inside
  `ApplyConfigurationsForEntitiesInContext` (`ApplicationDbContext.cs:368`).

### EFQueryableExecutor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/EFQueryableExecutor.cs:11` · Level 1 · class (internal sealed)

- **What it is**: the EF Core bridge for the Application layer's
  [`IQueryableExecutor`](#iqueryableexecutor). It exposes `Include`, `AsSplitQuery`, `ToListAsync`, and
  `CountAsync` over an `IQueryable<T>`, guarding each so the same code path works against a real EF
  queryable and against a plain in-memory `IQueryable`.
- **Depends on**: [`IQueryableExecutor`](#iqueryableexecutor) (the Application-layer contract it
  implements) and `Microsoft.EntityFrameworkCore` (`EntityFrameworkQueryableExtensions`).
- **Concept introduced, provider-agnostic query execution.** `[Rubric §14, Testability]` (assesses
  whether query logic can run without a database) and `[Rubric §3, Clean Architecture]` (keeps EF's
  async extension methods behind an Application abstraction): the Application layer builds
  specifications and calls `IQueryableExecutor` rather than EF directly, so the same handlers execute
  against a LINQ-to-Objects list in a unit test and against a SQL provider in production.
- **Walkthrough**:
  - `Include<T>` (`EFQueryableExecutor.cs:14-18`): calls EF's string-based `Include` on an EF queryable,
    otherwise returns the query unchanged (in-memory queries are already fully loaded).
  - `AsSplitQuery<T>` (`EFQueryableExecutor.cs:21-25`): applies EF's split-query behavior only on EF
    queryables, otherwise a pass-through.
  - `ToListAsync<T>` (`EFQueryableExecutor.cs:28-31`): uses EF's async materialization when available,
    otherwise the synchronous collection expression `[.. query]`.
  - `CountAsync<T>` (`EFQueryableExecutor.cs:34-37`): EF async count when available, otherwise
    `Task.FromResult(query.Count())`.
  - `IsEfQuery<T>` (`EFQueryableExecutor.cs:43`): the discriminator. An EF provider's queryable
    implements `IAsyncEnumerable<T>`, a plain LINQ-to-Objects queryable does not, so a single
    `is IAsyncEnumerable<T>` test routes every call above.
- **Why it's built this way**: `internal sealed`; centralizing the EF/in-memory branch in one class
  means every consumer gets the fallback for free and no handler references EF's static extension
  methods.
- **Where it's used**: registered as the singleton [`IQueryableExecutor`](#iqueryableexecutor)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:97`) and injected into
  Application-layer query code: `EntityQueryPipeline`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`) and the
  notification query handlers (for example `GetMyNotificationsHandler.cs:18`,
  `GetUnreadNotificationCountHandler.cs:14`).

### ApplicationDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:35` · Level 6 · class (abstract)

- **What it is**: the single abstract `DbContext` base that every engine-specific context
  ([`SQLServerDbContext`](#sqlserverdbcontext), [`CosmosDbContext`](#cosmosdbcontext),
  [`SqliteDbContext`](#sqlitedbcontext)) inherits. One instance exists per **physical database**: the
  same class is instantiated multiple times, each carrying a different
  [`PhysicalDataSource`](#physicaldatasource) and building a model that contains only that database's
  entities (`ApplicationDbContext.cs:24-29`).
- **Depends on**: [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor),
  [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor),
  [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory),
  [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention),
  [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention),
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider),
  [`PhysicalDataSource`](#physicaldatasource),
  [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity),
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage),
  [`InboxMessage`](group-04-events-outbox.md#inboxmessage), MiniProfiler, and EF Core.
- **Concept introduced, DbContext as Unit of Work + Change Tracker.** `[Rubric §8, Data Architecture]`
  (assesses transactions, migrations, soft-delete, audit, concurrency): EF's `DbContext` is the unit of
  work, tracking every `Added`/`Modified`/`Deleted` entity since the last save and writing them in a
  single transaction. This is also `[Rubric §3, Clean Architecture]` (the EF detail stays in
  Infrastructure; domain entities carry no EF attributes) and `[Rubric §6, CQRS & Event-Driven]`
  (domain events are captured transactionally with the aggregate write). The two interceptors registered
  in `OnConfiguring` run around `base.SaveChangesAsync` to stamp audit fields and serialize domain
  events into the outbox, so those cross-cutting concerns live in the interceptor pipeline rather than
  inline in every handler.
- **Walkthrough**:
  - **Primary constructor** (`ApplicationDbContext.cs:35-40`): takes `DbContextOptions`, an
    `IServiceProvider`, an [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider),
    and the [`PhysicalDataSource`](#physicaldatasource) this instance targets, delegating to
    `DbContext(options)`.
  - **`DataSourceKey`** (`ApplicationDbContext.cs:43`): exposes the `(engine, database name)` pair this
    context serves; **`PhysicalSource`** (`ApplicationDbContext.cs:46`) exposes the resolved connection
    info to subclasses as `internal`.
  - **`ValReturn<T>`** (`ApplicationDbContext.cs:52`): the nested keyless scalar holder (documented in
    its own section above).
  - **`SupportsOutbox`** (`ApplicationDbContext.cs:63`): `internal virtual`, `true` by default; the
    Cosmos subclass overrides it to `false`. Read by
    [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor).
  - **`CurrentSaveUserId`** (`ApplicationDbContext.cs:70`): `internal` audit user id with a private
    setter, written by the save overloads and read by
    [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor); `null` marks a system operation.
  - **`SaveChangesAsync(userId, ct)`** (`ApplicationDbContext.cs:80-94`): the mutation entry point.
    Opens a MiniProfiler step (`ApplicationDbContext.cs:82`), sets `CurrentSaveUserId`, calls
    `base.SaveChangesAsync`, and clears the id again in a `finally`
    (`ApplicationDbContext.cs:88-93`) so a later plain `base.SaveChangesAsync` on the same instance (an
    internal outbox write, for example) cannot silently reuse the previous caller's identity for its
    stamps.
  - **`SaveChanges(userId)`** (`ApplicationDbContext.cs:116-127`): the synchronous counterpart with the
    same set/reset discipline. Its doc comment records the behavioral difference
    (`ApplicationDbContext.cs:108-113`): the sync path cannot dispatch events in-process, so captured
    events are delivered by the outbox processor instead.
  - **Change-detection overrides** (`ApplicationDbContext.cs:100-106,133-137`): both EF save overloads
    wrap the base call in `using var detection = DetectChangesOnce()`, the optimization taught under
    [`DetectChangesScope`](#detectchangesscope).
  - **`OnConfiguring`** (`ApplicationDbContext.cs:176-193`): resolves both interceptors from DI and adds
    them (`ApplicationDbContext.cs:183-185`), then replaces EF's `IModelCacheKeyFactory` with
    [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory)
    (`ApplicationDbContext.cs:190`) so each database gets its own model.
  - **`ConfigureConventions`** (`ApplicationDbContext.cs:196-211`): adds two model-finalization
    conventions. [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention)
    (`ApplicationDbContext.cs:205`) strips FK constraints and navigations between entities in different
    physical databases (a structural no-op in the collapsed-monolith case), and
    [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention)
    (`ApplicationDbContext.cs:210`) makes unique indexes on soft-deletable entities exclude deleted
    rows, so a soft-deleted row does not block re-creating the "same" record.
  - **`Set<TEntity>()`** (`ApplicationDbContext.cs:213-215`): a public override that forwards straight
    to `base.Set<TEntity>()` and adds no behavior of its own.
  - **`OnModelCreating`** (`ApplicationDbContext.cs:218-234`): applies soft-delete filters and
    concurrency tokens, registers the four keyless `ValReturn<T>` views
    (`ApplicationDbContext.cs:224-227`), then configures the outbox and inbox tables.
  - **`ApplySoftDeleteFilters`** (`ApplicationDbContext.cs:243-257`): `protected static`; iterates every
    non-owned `IAuditableEntity` type and builds an expression-tree
    `HasQueryFilter("SoftDelete", e => e.IsDeleted == false)` (`ApplicationDbContext.cs:249-255`).
    Expression trees are required because the CLR type is only known at runtime; owned types are
    excluded because they inherit the parent filter. `[Rubric §5, Vertical Slice]` (a global filter
    removes per-query `Where(!IsDeleted)` boilerplate from every slice).
  - **`ConfigureConcurrencyTokens`** (`ApplicationDbContext.cs:270-290`): `protected` (instance, because
    it reads `Database.ProviderName` at `ApplicationDbContext.cs:273`). It applies `IsRowVersion()` on
    SQL Server (database-generated `rowversion`) or `IsConcurrencyToken()` elsewhere
    (application-managed) to the `RowVersion` property of every non-owned auditable entity. EF then
    includes the token in `UPDATE`/`DELETE` `WHERE` clauses and throws `DbUpdateConcurrencyException` on
    conflicts. `[Rubric §8, Data Architecture]`.
  - **`ConfigureOutbox`** (`ApplicationDbContext.cs:297-321`): maps `OutboxMessages` in `dbo` with
    length/unicode constraints, plus two purpose-built filtered indexes. `IX_OutboxMessages_Pending`
    covers the poll path over `(ProcessedOn, OccurredOn)` filtered to `[ProcessedOn] IS NULL` and
    includes `RetryCount` and `LockedUntil` so the processor's extra predicates do not force a key
    lookup per candidate row (`ApplicationDbContext.cs:310-313`);
    `IX_OutboxMessages_Processed` covers the retention sweep over rows the pending index deliberately
    excludes (`ApplicationDbContext.cs:318-320`). `[Rubric §12, Performance & Scalability]`.
  - **`ConfigureInbox`** (`ApplicationDbContext.cs:328-342`): maps `InboxMessages` in `dbo` with a
    unique `IX_InboxMessages_MessageId` (the consumer-side idempotency key,
    `ApplicationDbContext.cs:334-336`) and an `IX_InboxMessages_ProcessedOn` index so the age-based
    purge has something to seek (`ApplicationDbContext.cs:340-341`).
  - **`ApplyConfigurationsForEntitiesInContext`** (`ApplicationDbContext.cs:351-378`): the discovery
    method subclasses call from their `OnModelCreating`. It maps the engine to its configuration
    interface (`ApplicationDbContext.cs:353-359`), resolves
    [`IEntityDataSourceRegistry`](#ientitydatasourceregistry)
    (`ApplicationDbContext.cs:366`), then for each assembly from the provider calls
    [`ModelBuilderExtensions.ApplyAllConfigurations`](#modelbuilderextensions) with a filter that keeps
    only entities whose registry-resolved key equals this `DataSourceKey`, or, for unregistered
    entities, only when this context is the engine's `Default` source
    (`ApplicationDbContext.cs:370-376`).
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (database-per-service) requires the same context class per
  database; without a specialized model-cache key EF would build one model and silently reuse it, so
  queries would hit tables that do not exist in the other databases. The single `ApplicationDbContext`
  is deliberately never split into per-module context classes ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The interceptor pipeline keeps
  audit and outbox concerns out of every handler, and the comment at
  `ApplicationDbContext.cs:361-365` records the deliberate fallback: an entity configured without the
  attributed base classes lands in the `Default` model but is not routable through the unit of work.
- **Where it's used**: inherited by the three concrete contexts below; created per source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory), cached per scope by
  [`DbContextFactory`](#dbcontextfactory), and consumed by the interceptors and the outbox processor.

### DataSourceModelCacheKeyFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16` · Level 6 · class (sealed)

- **What it is**: a replacement for EF Core's default `IModelCacheKeyFactory`. Where the default keys
  the model cache by context **type** alone, this keys by `(context type, data source name, design-time
  flag)`, so each physical database gets its own EF model.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext) (to read `DataSourceKey.Name`) and
  EF Core's `IModelCacheKeyFactory`.
- **Concept introduced, model caching under one-context-class-per-engine.** `[Rubric §8, Data
  Architecture]`: EF builds an in-memory model per `DbContext` type and caches it. When the same class
  serves two databases, EF would reuse the first model and the second database's entities would be
  missing. Inserting `DataSourceKey.Name` into the cache key makes EF treat "SQL Server / Conference"
  and "SQL Server / Identity" as distinct models. The class comment states the failure mode plainly
  (`DataSourceModelCacheKeyFactory.cs:11-14`): without it, queries would target tables that do not exist
  in the other databases. This is the critical enabler for [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html).
- **Walkthrough**: `Create(DbContext context, bool designTime)`
  (`DataSourceModelCacheKeyFactory.cs:19-22`) returns
  `(context.GetType(), applicationDbContext.DataSourceKey.Name, designTime)` when the context is an
  [`ApplicationDbContext`](#applicationdbcontext), otherwise falls back to
  `(context.GetType(), designTime)`. The value tuple's structural equality is all EF needs to key its
  cache dictionary.
- **Why it's built this way**: the fix is minimal and lives entirely in Infrastructure through EF's
  supported extension point; no EF internals are subverted.
- **Where it's used**: registered in [`ApplicationDbContext.OnConfiguring`](#applicationdbcontext) via
  `optionsBuilder.ReplaceService<IModelCacheKeyFactory, DataSourceModelCacheKeyFactory>()`
  (`ApplicationDbContext.cs:190`), so every engine context inherits it.

### CosmosDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:14` · Level 7 · class (sealed)

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting Azure
  Cosmos DB. One instance exists per physical Cosmos data source (account plus database). It is the most
  divergent of the three concrete contexts because Cosmos is non-relational: no outbox table, no
  relational indexes, and a truncated `OnModelCreating` path.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](#physicaldatasource), [`DataSource`](#datasource),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), and the Cosmos EF
  provider (`Microsoft.Azure.Cosmos`). `[Rubric §8, Data Architecture]` (one concrete context per
  engine) and `[Rubric §11, Security]` (the emulator-only certificate bypass).
- **Walkthrough**:
  - **4-arg constructor** (`CosmosDbContext.cs:14-19`): forwards options, service provider, assembly
    provider, and physical source to the base.
  - **Emulator detection** (`CosmosDbContext.cs:22-64`): checks the connection string for the well-known
    emulator account-key prefix `"C2y6yDjf5"` (`CosmosDbContext.cs:29`). The emulator path uses
    `ConnectionMode.Gateway` and an `HttpClientFactory` whose handler installs
    `DangerousAcceptAnyServerCertificateValidator` for the self-signed cert, guarded by a
    `#pragma warning disable S4830` and a comment that this is safe only in local dev
    (`CosmosDbContext.cs:41-52`). The production path uses `ConnectionMode.Direct` with
    `MaxRequestsPerTcpConnection(20)` and `MaxTcpConnectionsPerEndpoint(32)`
    (`CosmosDbContext.cs:57-59`).
  - **`SupportsOutbox => false`** (`CosmosDbContext.cs:69`): overrides the base; Cosmos has no
    relational outbox table, so domain events are dispatched in-process only.
  - **`OnModelCreating`** (`CosmosDbContext.cs:72-94`): applies the Cosmos configurations
    (`CosmosDbContext.cs:74`), then `Ignore<OutboxMessage>()` (`CosmosDbContext.cs:77`), then removes
    every index from every entity type (`CosmosDbContext.cs:83-87`) because the provider does not
    support relational `HasIndex`/`HasFilter`, then calls `ApplySoftDeleteFilters` directly
    (`CosmosDbContext.cs:93`). It deliberately does **not** call `base.OnModelCreating`
    (`CosmosDbContext.cs:89-92`) because the base registers the keyless
    [`ValReturn<T>`](#valreturnt) views, a relational-only construct the Cosmos provider rejects.
- **Why it's built this way**: pushing all provider differences into this subclass keeps the base and
  the entity configuration bodies engine-agnostic; stripping indexes lets one configuration body serve
  both SQL Server and Cosmos.
- **Where it's used**: instantiated per Cosmos source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) when a data source resolves to the `CosmosDB`
  engine.
- **Caveats / not-in-source**: the certificate bypass is scoped by a substring match on the emulator key
  prefix; whether any production connection string could contain that substring is Not determinable from
  source.

### SqliteDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SqliteDbContext.cs:12` · Level 7 · class (sealed)

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting
  SQLite, the minimal concrete context. One instance exists per physical SQLite data source (database
  file), useful for lightweight local development or testing without a SQL Server instance
  (`SqliteDbContext.cs:7-10`).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](#physicaldatasource), [`DataSource`](#datasource),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), and the SQLite EF
  provider.
- **Walkthrough**: the 4-arg constructor forwards to the base (`SqliteDbContext.cs:12-17`).
  `OnConfiguring` guards its argument and then is just
  `optionsBuilder.UseSqlite(PhysicalSource.ConnectionString)` before calling the base
  (`SqliteDbContext.cs:19-27`), with no retry policy (the store is file-local) and no
  migrations-assembly override. `OnModelCreating` calls
  `ApplyConfigurationsForEntitiesInContext(DataSource.Sqlite, modelBuilder)` then `base.OnModelCreating`
  (`SqliteDbContext.cs:29-33`), so unlike Cosmos it keeps the full base pipeline: soft-delete filters,
  concurrency tokens as application-managed tokens rather than `rowversion`, the outbox and inbox
  tables, and the [`ValReturn<T>`](#valreturnt) views. See
  [`SQLServerDbContext`](#sqlserverdbcontext) for the shared subclass shape.
- **Why it's built this way**: SQLite needs none of the SQL Server hardening (transient-failure retry,
  per-service migrations assembly), so the override is intentionally sparse.
- **Where it's used**: instantiated per SQLite source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) when a data source resolves to the `Sqlite`
  engine.

### SQLServerDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:13` · Level 7 · class (sealed)

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting SQL
  Server, the production-primary context. One instance exists per physical SQL Server data source
  (database); its connection string and migrations assembly come from the resolved
  [`PhysicalDataSource`](#physicaldatasource).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](#physicaldatasource), [`DataSource`](#datasource),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), and the SQL Server EF
  provider (`RelationalEventId`). `[Rubric §8, Data Architecture]` (one concrete context per engine, one
  instance per database) and `[Rubric §29, Resilience & Business Continuity]` (the retry policy is baked
  into the SQL Server path).
- **Walkthrough**:
  - **4-arg constructor** (`SQLServerDbContext.cs:13-18`): forwards to the base.
  - **`OnConfiguring`** (`SQLServerDbContext.cs:21-60`): calls
    `UseSqlServer(PhysicalSource.ConnectionString, sql => ...)`. The options action conditionally sets
    `sql.MigrationsAssembly(PhysicalSource.SqlServerMigrationsAssembly)` (`SQLServerDbContext.cs:30-33`)
    so each extracted service can point at its own per-module migrations project, then
    `sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10),
    errorNumbersToAdd: null)` (`SQLServerDbContext.cs:41-44`). An inline comment
    (`SQLServerDbContext.cs:38-40`) records the retry caveat: with retry enabled, any manual
    `BeginTransactionAsync` must be wrapped in `Database.CreateExecutionStrategy().ExecuteAsync`, which
    [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult)
    already does. Finally
    `ConfigureWarnings(w => w.Ignore(RelationalEventId.PendingModelChangesWarning))`
    (`SQLServerDbContext.cs:57`) suppresses EF Core's pending-model error.
  - **`OnModelCreating`** (`SQLServerDbContext.cs:63-67`): calls
    `ApplyConfigurationsForEntitiesInContext(DataSource.SQLServer, modelBuilder)` then
    `base.OnModelCreating`, so the full base pipeline (soft-delete, `rowversion` concurrency tokens,
    outbox/inbox tables, [`ValReturn<T>`](#valreturnt) views) runs.
- **Why it's built this way**: the `PendingModelChangesWarning` suppression is required by the
  microservices-extraction design: each extracted host registers only its enabled modules'
  configurations, so its runtime model is a strict subset of the migration snapshot (the union of all
  modules), and EF Core 9+ would otherwise promote that mismatch to an error inside
  `Migrator.ValidateMigrations` during `MigrateAsync` (`SQLServerDbContext.cs:46-52`). The documented
  trade-off (`SQLServerDbContext.cs:54-56`): monolith hosts lose the "you forgot a migration" safety
  net, so CI should run `dotnet ef migrations has-pending-model-changes` against the full model as a
  separate gate. Retry-on-failure exists so cold-replica startup connections and platform replica
  replacements do not surface as user-facing 5xx ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)).
- **Where it's used**: instantiated per SQL Server source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory); the primary production context in both
  MMCA.ADC and MMCA.Store, and the context type every committed migration snapshot is generated against.

### UnitOfWork
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13` · Level 8 · class (internal sealed)

- **What it is**: the concrete implementation of [`IUnitOfWork`](#iunitofwork), the scoped coordinator
  every handler injects to obtain repositories and to save. It caches repositories per entity type so
  all operations in a scope share one change tracker and context.
- **Depends on**: [`IDbContextFactory`](#idbcontextfactory) (implemented by
  [`DbContextFactory`](#dbcontextfactory)), [`IDataSourceService`](#idatasourceservice),
  [`IRepositoryFactory`](#irepositoryfactory),
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype),
  and
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype).
- **Concept introduced, the Unit of Work over a database-per-service topology.** `[Rubric §2, Design
  Patterns]` (Unit of Work + Repository) and `[Rubric §8, Data Architecture]` (transactions and
  change-tracker scoping): a handler never knows which database an entity lives in. `GetRepository`
  resolves the entity's physical source, obtains the matching context, and builds a repository bound to
  it; caching that repository per scope guarantees one change tracker per database, which is what makes
  "load aggregate, mutate, one save" correct.
- **Walkthrough**:
  - **Primary constructor** (`UnitOfWork.cs:13-16`): takes the context factory, the data-source service,
    and the repository factory, null-guarding the context factory and the repository factory into
    readonly fields (the data-source service is used directly from the primary-constructor parameter).
  - **`_repositories`** (`UnitOfWork.cs:23`): a `Dictionary<Type, object>` keyed by the closed generic
    repository interface (for example `IRepository<Order, int>`), so a repository is created at most
    once per entity type per scope.
  - **`GetRepository<TEntity, TIdentifierType>()`** (`UnitOfWork.cs:33-46`): on a cache miss, resolves
    the entity's [`DataSourceKey`](#datasourcekey) via
    `dataSourceService.GetDataSourceKey(typeof(TEntity))` (`UnitOfWork.cs:40`), asks the context factory
    for the matching context, and builds a read-write repository through
    [`IRepositoryFactory`](#irepositoryfactory); constrained to
    `AuditableAggregateRootEntity<TIdentifierType>` so only aggregate roots get a mutable repository.
  - **`GetReadRepository<TEntity, TIdentifierType>()`** (`UnitOfWork.cs:53-66`): the same resolution but
    calls `CreateReadOnly` and accepts any `AuditableBaseEntity<TIdentifierType>`, for query handlers.
  - **Save and transaction methods** (`UnitOfWork.cs:69-91`): `SaveChangesAsync`, `Save`,
    `RequestIdentityInsert`, `BeginTransaction`, `CommitTransaction`, `RollbackTransaction`, and
    `ExecuteInTransactionAsync` all delegate straight to the context factory, because in a
    multi-database scope the factory is what coordinates saving and transacting across every context the
    scope touched.
  - **Disposal** (`UnitOfWork.cs:93-119`): implements both `Dispose` and `DisposeAsync` over a
    `volatile bool _disposed` flag (`UnitOfWork.cs:25`), disposing the context factory exactly once and
    suppressing finalization on both paths.
- **Why it's built this way**: the unit of work plus the factory hide the physical topology from
  handlers, and per-scope repository caching guarantees a single change tracker per database. It is
  `internal sealed` because consumers only ever see the [`IUnitOfWork`](#iunitofwork) abstraction
  (dependency inversion).
- **Where it's used**: injected into virtually every command and query handler in Common and in both
  apps, and into the module seeders.

### NativePushPayloads

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NativePushPayloads.cs:10` · Level 0 · class (internal static)

- **What it is**: a pure helper that builds the platform-native JSON bodies (FCM v1 for Android, APNs for Apple) and the `user:{id}` OR-tag expressions that an Azure Notification Hubs send needs. It holds no state and touches no hub, so the payload shapes and the tag-chunking rule are unit-testable in isolation (`NativePushPayloads.cs:5-10`).
- **Depends on**: the BCL only: `System.Text.Json.JsonSerializer` for the payload strings, `Enumerable.Chunk` for the OR-expression batching, and the `UserIdentifierType` alias (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) for the user-tag input.
- **Concept introduced, native push payload construction and the 20-tag chunk rule.** `[Rubric §7, Microservices Readiness]` assesses whether cross-cutting delivery mechanics live behind a reusable, transport-specific boundary rather than smeared through handlers; here the exact wire shapes of two third-party push protocols are pinned in one place. Azure Notification Hubs caps a single tag expression at 20 tags (`MaxTagsPerExpression`, `NativePushPayloads.cs:13`), so a user-targeted broadcast to a large audience is split into `Chunk(20)` groups, each rendered as a `user:a || user:b || ...` OR-expression (`NativePushPayloads.cs:59-63`). That cap is a real hub limit, not an arbitrary batch size, which is why it is a named constant the sender reuses rather than a literal.
- **Walkthrough**: `BuildFcmV1Payload` (`NativePushPayloads.cs:16-28`) nests a `notification` block of `title`/`body` under a `message` envelope, adding a `data` map only when metadata is non-empty (`{ Count: > 0 }` pattern, line 22). `BuildApnsPayload` (`NativePushPayloads.cs:31-53`) builds the APNs `aps.alert` block, then copies each metadata pair up to the top level as a custom key while explicitly refusing to overwrite the reserved `aps` key (`NativePushPayloads.cs:44-49`). `BuildUserTagExpressions` (`NativePushPayloads.cs:59-63`) maps each id through `UserTag`, chunks, and joins. `UserTag` (`NativePushPayloads.cs:66-67`) formats `user:{userId}` under `InvariantCulture` via `string.Create`, so a numeric id never picks up a locale-specific separator.
- **Why it's built this way**: keeping the payload shapes and the hub's tag cap in a stateless helper ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) means the [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) stays a thin adapter and the fiddly JSON/tag rules can be proven correct without a live hub or credentials.
- **Where it's used**: consumed by [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) (payloads and tag expressions) and [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) (the `UserTag` stamped on each installation).
- **Caveats / not-in-source**: `internal`, so it is reachable only inside `MMCA.Common.Infrastructure` and its `InternalsVisibleTo` test project.

### AzureNotificationHubNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubNativePushSender.cs:14` · Level 1 · class (sealed partial)

- **What it is**: the Azure Notification Hubs implementation of `INativePushSender`: the real, mobile-facing native notification channel that pushes FCM v1 and APNs payloads through a hub client (`AzureNotificationHubNativePushSender.cs:7-16`).
- **Depends on**: [`INativePushSender`](#inativepushsender) (the contract it fulfills), [`NativePushPayloads`](#nativepushpayloads) (payload + tag construction), and two externals: `Microsoft.Azure.NotificationHubs.INotificationHubClient` (the hub SDK) and `ILogger<T>`.
- **Concept introduced, the native (mobile) push channel and its best-effort contract.** `[Rubric §13, Observability & Operability]` covers whether side-effecting integrations log their outcomes and fail without taking the request down; this sender emits a structured log per send (`LogNativePushSent`, `AzureNotificationHubNativePushSender.cs:42-43`) and its class comment records that callers treat the channel as best-effort, wrapping it in a non-fatal catch (`AzureNotificationHubNativePushSender.cs:11-12`). This is the device-facing counterpart to the in-app SignalR channel: [`NullPushNotificationSender`](group-10-notifications.md#nullpushnotificationsender) and its SignalR sibling deliver to connected web clients, whereas this reaches devices via APNs/FCM.
- **Walkthrough**: the primary constructor takes the hub client and logger (`AzureNotificationHubNativePushSender.cs:14-16`). `SendToUsersAsync` (`AzureNotificationHubNativePushSender.cs:19-31`) builds both payloads once, then for each 20-tag OR-expression sends an `FcmV1Notification` and an `AppleNotification` targeted at that expression (`AzureNotificationHubNativePushSender.cs:24-28`), so one call fans out to both platforms per audience chunk. `BroadcastAsync` (`AzureNotificationHubNativePushSender.cs:34-40`) sends the same two payloads with no tag filter, reaching every registered installation. Both `ConfigureAwait(false)` on every await (infrastructure code, no sync context needed) and log the title on completion.
- **Why it's built this way**: the `partial` class exists so the `[LoggerMessage]` source generator can emit `LogNativePushSent` (`AzureNotificationHubNativePushSender.cs:42-43`), the high-performance logging pattern used across the framework. Splitting payload construction into [`NativePushPayloads`](#nativepushpayloads) ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) keeps this type a pure transport adapter.
- **Where it's used**: registered in place of [`NullNativePushSender`](#nullnativepushsender) when a host calls `AddNativePushNotifications()` with an enabled hub configuration; resolved wherever `INativePushSender` is injected (the native-push send handler).

### ExplicitAssemblyProvider

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:106` · Level 1 · class (sealed, private nested)

- **What it is**: a tiny private nested provider inside [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) that returns a fixed, caller-supplied list of entity-configuration assemblies (`DesignTimeDbContextHelper.cs:106-109`).
- **Depends on**: [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) (the contract) and `System.Reflection.Assembly`.
- **Concept reinforced, explicit assembly enumeration in place of runtime scanning.** `[Rubric §8, Data Architecture]` looks at whether the model's entity set is deterministic per database; at runtime the framework discovers configuration assemblies by scanning the AppDomain, but `dotnet ef` design-time commands see none of that. `GetConfigurationAssemblies` (`DesignTimeDbContextHelper.cs:108`) simply hands back the assemblies the migrations project listed via [`DesignTimeDbContextOptions.AddConfigurationAssembly`](#designtimedbcontextoptions), so the design-time model contains exactly the intended entities and nothing else.
- **Why it's built this way**: it is the design-time substitute for the AppDomain-scanning provider; keeping it private and trivial means the migrations authoring surface stays [`DesignTimeDbContextOptions`](#designtimedbcontextoptions), not this class.
- **Where it's used**: instantiated once inside `DesignTimeDbContextHelper.CreateSqlServer` (`DesignTimeDbContextHelper.cs:55`) and registered as the `IEntityConfigurationAssemblyProvider` for the design-time context (`DesignTimeDbContextHelper.cs:70`).
- **Caveats / not-in-source**: private nested type; it surfaces in the inventory only because the tool includes private nested classes. Not reachable from outside the helper.

### NullNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullNativePushSender.cs:10` · Level 1 · class (sealed)

- **What it is**: the no-op default implementation of `INativePushSender`: both methods return `Task.CompletedTask` so the native-push channel always resolves and silently does nothing until a host opts in (`NullNativePushSender.cs:5-19`).
- **Depends on**: [`INativePushSender`](#inativepushsender) only.
- **Concept reinforced, the Null Object pattern as the safe default channel.** `[Rubric §2, Design Patterns]` values a harmless default that satisfies a contract without a live dependency; registering this type by default means DI resolution and the Devices/send endpoints work everywhere, even in a host with no notification hub. The real [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) is swapped in only when `AddNativePushNotifications()` runs with enabled hub configuration (`NullNativePushSender.cs:6-9`).
- **Walkthrough**: `SendToUsersAsync` and `BroadcastAsync` (`NullNativePushSender.cs:13-18`) each match the interface signature and return a completed task; there is no logging and no failure, by design.
- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) gives the framework three notification channels; a no-op default keeps the native channel optional so a host that never configures a hub still composes and runs.
- **Where it's used**: registered as the default `INativePushSender`; paired with [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar), the no-op registrar for the same disabled-hub scenario.

### SoftDeleteUniqueIndexConvention

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:24` · Level 1 · class (sealed)

- **What it is**: an EF Core **model-finalizing convention** that appends an `IsDeleted = 0` filter to every unique index on a soft-deletable entity type, so a soft-deleted row stops occupying its unique slot (`SoftDeleteUniqueIndexConvention.cs:10-24`).
- **Depends on**: [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) (the soft-delete marker it tests for) and the [`DataSource`](#datasource) engine enum; externally, EF Core's convention metadata API (`IModelFinalizingConvention`, `IConventionModelBuilder`, `IConventionEntityType`, `IConventionIndex`).
- **Concept introduced, filtered (partial) unique indexes as the database half of soft delete.** `[Rubric §8, Data Architecture]` assesses whether the storage model actually enforces the semantics the application presents, and `[Rubric §16, Maintainability]` assesses whether a cross-cutting rule is applied once centrally instead of remembered per entity. Soft delete (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) hides a row behind a global query filter, but the row is still physically present, so a plain unique index keeps rejecting a new record that reuses the deleted one's value: delete a speaker and that email address stays permanently unusable (`SoftDeleteUniqueIndexConvention.cs:11-16`). A filtered index solves this by indexing only live rows. Making it a convention means no entity configuration author has to remember the rule.
- **Walkthrough**
  - The primary constructor takes the engine of the context being built (`SoftDeleteUniqueIndexConvention.cs:24`), because filter syntax is provider-specific.
  - `ProcessModelFinalizing` (`SoftDeleteUniqueIndexConvention.cs:27-41`) null-guards the builder, returns immediately for Cosmos (`SoftDeleteUniqueIndexConvention.cs:33-34`), then selects every entity type assignable to `IAuditableEntity` that is not owned (`SoftDeleteUniqueIndexConvention.cs:36-37`) and processes each.
  - `ApplyFilterToUniqueIndexes` (`SoftDeleteUniqueIndexConvention.cs:43-57`) resolves the mapped column name for `IsDeleted`, falling back to the property name when the property is absent (`SoftDeleteUniqueIndexConvention.cs:45-46`), then builds the SQL literal: bracket-quoted `[IsDeleted] = 0` for SQL Server, double-quoted `"IsDeleted" = 0` otherwise (`SoftDeleteUniqueIndexConvention.cs:48-50`).
  - The loop applies the filter only to indexes that are unique **and** have no filter already (`SoftDeleteUniqueIndexConvention.cs:52-56`), so a hand-authored filter in an entity configuration always wins.
- **Why it's built this way**: running at model finalization guarantees the convention sees every index a module configuration declared, rather than racing declaration order. Cosmos is skipped because it has no partial-index concept; SQL Server and SQLite both support filtered/partial indexes (`SoftDeleteUniqueIndexConvention.cs:17-21`). Respecting an existing filter keeps the convention additive, never destructive.
- **Where it's used**: registered per context in `ApplicationDbContext.ConfigureConventions` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:151`), immediately after [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention), and it therefore applies to every entity in every module of every host.

### DesignTimeDbContextOptions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:11` · Level 2 · class (sealed)

- **What it is**: the configuration carrier a migrations project fills in to tell [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) how to build a context for `dotnet ef ... -- --datasource <Name>`. It holds the connection settings, the named data-source entries, and the explicit list of entity-configuration assemblies (`DesignTimeDbContextOptions.cs:11-33`).
- **Depends on**: [`ConnectionStringSettings`](group-14-module-system-composition.md#connectionstringsettings), [`DataSourceEntrySettings`](group-14-module-system-composition.md#datasourceentrysettings), and `System.Reflection.Assembly`.
- **Concept introduced, design-time context construction for database-per-service.** `[Rubric §8, Data Architecture]` assesses whether each database's migrations are built in isolation; in the database-per-service model ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) each module's migrations project must scaffold a context for only its own database. At design time there is no DI container and no AppDomain scan, so this options object captures everything `dotnet ef` cannot discover on its own: the top-level connection strings including `SQLServerMigrationsAssembly` (`DesignTimeDbContextOptions.cs:20-24`), the named `DataSources` entries (`DesignTimeDbContextOptions.cs:26-27`), and the explicit configuration assemblies (`DesignTimeDbContextOptions.cs:29-33`, whose comment notes the runtime scan sees nothing here).
- **Walkthrough**: `DataSourceName` (`DesignTimeDbContextOptions.cs:18`) is optional; when null the helper parses `--datasource` and falls back to `Default`. `AddConfigurationAssembly` (`DesignTimeDbContextOptions.cs:38-47`) is a chainable builder method that guards against duplicate registrations before adding.
- **Why it's built this way**: a single options object plus a builder method keeps each per-module migrations factory to a handful of lines while still pinning the model to one database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: passed to `DesignTimeDbContextHelper.CreateSqlServer(args, options => ...)` from each per-database migrations factory (for example the `MMCA.ADC.Migrations.SqlServer.*` projects).

### NullDomainEventDispatcher

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:111` · Level 2 · class (sealed, private nested)

- **What it is**: a no-op `IDomainEventDispatcher` used only inside the design-time context helper (never in production). `DispatchAsync` returns `Task.CompletedTask` (`DesignTimeDbContextHelper.cs:111-115`).
- **Depends on**: [`IDomainEvent`](group-04-events-outbox.md#idomainevent) and [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher).
- **Concept reinforced, the Null Object pattern for a design-time DI gap.** `[Rubric §2, Design Patterns]` values satisfying an interface with a harmless no-op when the real implementation would need the full application container. During `dotnet ef migrations add` the design-time factory builds a context but never saves through it, so a real dispatcher (which would try to hand events to handlers that are not registered here) would be both unnecessary and wrong. Registering this null dispatcher (`DesignTimeDbContextHelper.cs:66`) closes that dependency without pulling in application services.
- **Why it's built this way**: the design-time service graph is deliberately minimal (null loggers, null dispatcher, a hand-built `ServiceCollection`) so scaffolding a migration never spins up the app; this type is one leaf of that minimal graph.
- **Where it's used**: registered as the `IDomainEventDispatcher` inside `DesignTimeDbContextHelper.CreateSqlServer` (`DesignTimeDbContextHelper.cs:66`).
- **Caveats / not-in-source**: private nested type inside `DesignTimeDbContextHelper`; not accessible from outside.

### CrossDataSourceDegradeConvention

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33` · Level 3 · class (sealed)

- **What it is**: the EF Core **model-finalizing convention** that detects relationships whose two ends resolve to different physical databases and degrades them: the foreign key and its navigations are removed from the model, the declared scalar FK columns survive with a compensating index, and entity types belonging to another source are dropped from this model entirely (`CrossDataSourceDegradeConvention.cs:9-33`).
- **Depends on**: [`DataSourceKey`](#datasourcekey), [`DataSource`](#datasource), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry); externally EF Core's metadata API (`IModelFinalizingConvention`, `IMutableModel`, `IMutableEntityType`, `IMutableForeignKey`, `IMutableProperty`, `IConventionIndex`).
- **Concept introduced, automatic cross-database relationship degradation.** `[Rubric §8, Data Architecture]` assesses the database-per-service consistency strategy, and `[Rubric §7, Microservices Readiness]` assesses whether the model adapts to the deployment topology without per-entity code. Under database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) a database cannot enforce a foreign key that points into another database, so this convention strips those relationships automatically at model finalization. The scalar column survives (a query can still filter on, say, a `UserId`), cross-source loading is left to `INavigationPopulator` batch loading ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html), see [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)), and cross-source consistency is the outbox's job (`CrossDataSourceDegradeConvention.cs:12-21`). The closing remark is the load-bearing invariant: when every entity resolves to the same physical source (the monolith-collapse case) nothing is foreign and the convention is a structural no-op, so the collapsed model is identical to the single-database model (`CrossDataSourceDegradeConvention.cs:25-29`).
- **Walkthrough**
  - The primary constructor takes the `contextKey` (the physical source whose model is being built) and the [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`CrossDataSourceDegradeConvention.cs:33-35`); `IsForeign` (`CrossDataSourceDegradeConvention.cs:91-94`) asks the registry for a CLR type's key and returns true when it differs from `contextKey`.
  - `ProcessModelFinalizing` (`CrossDataSourceDegradeConvention.cs:38-89`) casts the model to the **mutable** surface (`CrossDataSourceDegradeConvention.cs:46`) deliberately: cross-cutting helpers (soft-delete filters, concurrency tokens) promote every entity type to the Explicit configuration source, which convention-sourced builder calls cannot override (`CrossDataSourceDegradeConvention.cs:22-24,44-45`). It collects the non-owned foreign entity types (`CrossDataSourceDegradeConvention.cs:48-50`) and returns early when there are none (`CrossDataSourceDegradeConvention.cs:52-55`).
  - Step 1 (`CrossDataSourceDegradeConvention.cs:62-74`): for every *local* dependent it degrades each declared FK pointing at a foreign principal. `addCompensatingIndex` is false for Cosmos (`CrossDataSourceDegradeConvention.cs:65`), because Cosmos auto-indexes every property and rejects explicit index definitions; that skip is what makes one configuration body portable to Cosmos without edits (`CrossDataSourceDegradeConvention.cs:100-105`).
  - `DegradeForeignKey` (`CrossDataSourceDegradeConvention.cs:107-138`) keeps the non-shadow scalar FK properties, removes the FK (`CrossDataSourceDegradeConvention.cs:116`), then eagerly drops the convention-created FK index before the coverage check (`CrossDataSourceDegradeConvention.cs:123-130`), because EF's deferred event processing would otherwise remove it *after* the check and leave the column unindexed. It adds a plain index only when `HasCoveringIndex` (`CrossDataSourceDegradeConvention.cs:140-144`) finds no existing index covering those columns as a prefix.
  - Step 2 (`CrossDataSourceDegradeConvention.cs:79-82`): `IgnoreForeignMembers` (`CrossDataSourceDegradeConvention.cs:151-165`) removes skip navigations to foreign types and ignores any CLR property whose (collection-unwrapped) type is a foreign entity, so model validation does not later reject an unmapped entity-typed property; `UnwrapCollectionElementType` (`CrossDataSourceDegradeConvention.cs:171-174`) handles the `List<T>` / `ICollection<T>` case.
  - Step 3 (`CrossDataSourceDegradeConvention.cs:84-88`): removes the foreign entity types from the model.
- **Why it's built this way**: degrading in a convention rather than per-configuration means no module author has to remember to break a cross-service relationship by hand; the same configuration class works whether its module ships inside the monolith or as its own service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).
- **Where it's used**: registered per context in `ApplicationDbContext.ConfigureConventions` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:146`), just before [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention); [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory) (`ApplicationDbContext.cs:131`) ensures each database caches its own degraded model rather than reusing one built for a different source.

### DataSourceService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12` · Level 3 · class (sealed)

- **What it is**: the application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry): given an entity type (or its full name) it answers which physical data source that entity lives in, and whether two entities can be EF-`Include`d together (`DataSourceService.cs:6-12`).
- **Depends on**: [`IDataSourceService`](#idatasourceservice) (the contract), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (the eager routing table it delegates to), and the [`DataSourceKey`](#datasourcekey) / [`DataSource`](#datasource) value types.
- **Concept reinforced, entity-to-database routing as a query surface.** `[Rubric §8, Data Architecture]` assesses whether database-per-service routing is a first-class, queryable concept; the registry aggregates every `[UseDataSource]` / `[UseDatabase]` declaration at startup, and this facade is the thin runtime interface over it. Because the registry is built eagerly from configuration assemblies (`DataSourceService.cs:8-11`), resolution no longer waits for an EF model to be built, which matters for the navigation classification that runs before any query.
- **Walkthrough**: the four `GetDataSource*` overloads (`DataSourceService.cs:15-24`) forward straight to the registry, returning either the full [`DataSourceKey`](#datasourcekey) or just its `Engine` ([`DataSource`](#datasource)). `HaveIncludeSupport(DataSourceKey, DataSourceKey)` (`DataSourceService.cs:31-32`) encodes the eager-loading rule: an EF `Include` is valid only when both entities resolve to the *same* key **and** that engine is not Cosmos (`first == second && first.Engine != DataSource.CosmosDB`), because Cosmos has no cross-document joins. The string overload (`DataSourceService.cs:35-38`) resolves both names through `TryGetDataSourceKey` and defers to the key overload, returning false if either name is unknown.
- **Why it's built this way**: keeping the include-support rule in one predicate lets the navigation populators and cross-source degrade logic ask a single authority whether a relationship can be loaded in-database versus batch-loaded across sources ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Facading the registry keeps callers off its lower-level API.
- **Where it's used**: injected wherever code must classify a navigation or pick a context for an entity: the cross-data-source degrade convention and the navigation-populator batching path both consult it.

### AzureBlobFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureBlobFileStorageService.cs:15` · Level 4 · class (sealed)

- **What it is**: the Azure Blob Storage implementation of `IFileStorageService`: uploads and deletes blobs in the single configured container, returning [`Result`](group-01-result-error-handling.md#result) instead of throwing (`AzureBlobFileStorageService.cs:10-17`).
- **Depends on**: [`IFileStorageService`](#ifilestorageservice), the [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error) types, and Azure externals `BlobContainerClient` / `BlobUploadOptions` / `RequestFailedException` plus `ILogger<T>`.
- **Concept introduced, the file-storage boundary and Result-wrapped I/O.** `[Rubric §10, Cross-Cutting Concerns]` covers pushing infrastructure integrations behind an application-owned contract; here blob I/O is hidden behind `IFileStorageService` and every SDK failure is caught and mapped to a domain [`Error`](group-01-result-error-handling.md#error) rather than bubbling as an exception. `IsConfigured => true` (`AzureBlobFileStorageService.cs:20`) is the flag that distinguishes this live implementation from the [`NullFileStorageService`](#nullfilestorageservice) fallback.
- **Walkthrough**: the constructor takes an already-scoped `BlobContainerClient` and a logger (`AzureBlobFileStorageService.cs:15-17`); the class comment notes the container and its access level are provisioned by infrastructure, not created here (`AzureBlobFileStorageService.cs:12-13`). `UploadAsync` (`AzureBlobFileStorageService.cs:23-43`) gets a blob client, uploads with an explicit `ContentType` header, and returns `Result.Success(blobClient.Uri)`; a `RequestFailedException` is logged and mapped to `Error.Failure("FileStorage.UploadFailed", ...)` (`AzureBlobFileStorageService.cs:35-42`). `DeleteAsync` (`AzureBlobFileStorageService.cs:46-62`) calls `DeleteBlobIfExistsAsync` (idempotent) and maps failures to `FileStorage.DeleteFailed`.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) introduces the file-storage/image pipeline; returning `Result` keeps storage failures on the same error-handling rail as the rest of the stack, and catching only `RequestFailedException` means genuinely unexpected errors still surface.
- **Where it's used**: registered by `AddAzureBlobFileStorage(configuration)` in place of [`NullFileStorageService`](#nullfilestorageservice); consumed by feature handlers that persist uploaded files (typically after [`ImageSharpImageProcessor`](#imagesharpimageprocessor) has normalized the bytes).

### AzureNotificationHubDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubDeviceRegistrar.cs:15` · Level 4 · class (sealed)

- **What it is**: the Azure Notification Hubs implementation of `IPushDeviceRegistrar`: registers (upserts) and unregisters a device's push installation using the hub's installation model, stamping each installation with its owner's `user:{id}` tag (`AzureNotificationHubDeviceRegistrar.cs:10-17`).
- **Depends on**: [`IPushDeviceRegistrar`](#ipushdeviceregistrar), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest) (the inbound DTO), [`NativePushPayloads.UserTag`](#nativepushpayloads) (the owner tag), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and Azure externals `INotificationHubClient` / `Installation` / `MessagingException`.
- **Concept introduced, device registration via the installation model.** `[Rubric §11, Security]` includes owner-scoping of side channels; by stamping every installation with `NativePushPayloads.UserTag(userId)` (`AzureNotificationHubDeviceRegistrar.cs:41`) the registrar guarantees a later user-targeted send reaches only that user's devices. The installation model uses client-owned stable ids with full upsert semantics (`AzureNotificationHubDeviceRegistrar.cs:11-13`), so re-registering the same device is idempotent rather than duplicating.
- **Walkthrough**: `UpsertAsync` (`AzureNotificationHubDeviceRegistrar.cs:20-57`) first maps the request's platform string to a `NotificationPlatform` via a `switch` over `FCMV1`/`APNS` (`AzureNotificationHubDeviceRegistrar.cs:22-27`); an unrecognized value returns `Error.Validation("PushDevice.UnsupportedPlatform", ...)` before any hub call (`AzureNotificationHubDeviceRegistrar.cs:28-34`). It then builds an `Installation` with the client id, platform, push channel, and the single user tag (`AzureNotificationHubDeviceRegistrar.cs:36-42`) and calls `CreateOrUpdateInstallationAsync`, mapping a `MessagingException` to `PushDevice.UpsertFailed`. `DeleteAsync` (`AzureNotificationHubDeviceRegistrar.cs:60-80`) deletes the installation but treats `MessagingEntityNotFoundException` as success (`AzureNotificationHubDeviceRegistrar.cs:67-71`): an unknown installation is already in the desired state, so delete is idempotent.
- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)'s native channel needs a way to associate devices with users; the tag-per-installation approach lets sends target `user:{id}` OR-expressions without the app keeping its own device table. Idempotent delete keeps client retries safe.
- **Where it's used**: registered by `AddNativePushNotifications()` in place of [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar); called by the Devices endpoints and paired with [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) for the send side.

### ImageSharpImageProcessor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ImageSharpImageProcessor.cs:14` · Level 4 · class (sealed)

- **What it is**: the ImageSharp implementation of `IImageProcessor`: it decodes an uploaded image, re-orients and crops it to a square, strips all metadata, and re-encodes it as JPEG, returning the bytes as a [`Result`](group-01-result-error-handling.md#result) (`ImageSharpImageProcessor.cs:9-17`).
- **Depends on**: [`IImageProcessor`](#iimageprocessor), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and the SixLabors.ImageSharp externals (`Image`, `Mutate`, `ResizeOptions`, `JpegEncoder`).
- **Concept introduced, full re-encode as a security control.** `[Rubric §11, Security]` and `[Rubric §30, Compliance/Privacy/Data Governance]` both apply: decoding to pixels and re-encoding is deliberate so that EXIF metadata (including GPS coordinates, which are PII) and any polyglot payload smuggled into the original file are discarded, since only pixels survive the round trip (`ImageSharpImageProcessor.cs:9-13`). This is a defense against both privacy leaks and image-parser exploits, not merely a resize.
- **Walkthrough**: `NormalizeToSquareJpegAsync` (`ImageSharpImageProcessor.cs:17-51`) loads the stream, then `Mutate`s with `AutoOrient()` *before* stripping metadata so a portrait phone photo is not left rotated (`ImageSharpImageProcessor.cs:23-31`), and resizes to `size x size` with `ResizeMode.Crop`. It then nulls out the EXIF, XMP, and IPTC profiles (`ImageSharpImageProcessor.cs:33-35`) and saves to a `MemoryStream` with `JpegEncoder { Quality = 85 }` (`ImageSharpImageProcessor.cs:40`), returning `Result.Success(output.ToArray())`. An `UnknownImageFormatException` or `InvalidImageContentException` is caught and mapped to `Error.Validation("Image.Undecodable", ...)` (`ImageSharpImageProcessor.cs:44-50`), so a garbage upload becomes a clean validation failure rather than a 500.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) pairs storage with sanitization; ordering `AutoOrient` before metadata removal is the subtle correctness detail, and quality 85 is the standard size/quality trade-off. Catching only the two ImageSharp decode exceptions keeps unexpected faults visible.
- **Where it's used**: invoked by feature handlers before an avatar or image upload is handed to [`AzureBlobFileStorageService`](#azureblobfilestorageservice); it has no configured/unconfigured split (there is no Null variant) because processing needs no external resource.

### NullFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullFileStorageService.cs:11` · Level 4 · class (sealed)

- **What it is**: the unconfigured-host fallback for `IFileStorageService`: uploads fail with a clear error while deletes succeed, so file features degrade cleanly instead of crashing (`NullFileStorageService.cs:6-11`).
- **Depends on**: [`IFileStorageService`](#ifilestorageservice) and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept reinforced, asymmetric Null Object (fail-closed write, no-op delete).** `[Rubric §2, Design Patterns]` and `[Rubric §10, Cross-Cutting Concerns]`: unlike a pure no-op, this fallback distinguishes its two operations by intent. `IsConfigured => false` (`NullFileStorageService.cs:14`) lets callers detect the disabled channel; `UploadAsync` returns `Error.Failure("FileStorage.NotConfigured", ...)` (`NullFileStorageService.cs:17-21`) so a write fails loudly and predictably, while `DeleteAsync` returns `Result.Success()` (`NullFileStorageService.cs:24-25`) because there is nothing to delete and a delete of a non-existent file is already the desired state.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) makes storage optional; failing uploads with a typed error (rather than a null-reference crash) keeps a host with no storage configured running and honest about what it cannot do.
- **Where it's used**: the default `IFileStorageService`, swapped for [`AzureBlobFileStorageService`](#azureblobfilestorageservice) by `AddAzureBlobFileStorage(configuration)`.

### NullPushDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullPushDeviceRegistrar.cs:12` · Level 4 · class (sealed)

- **What it is**: the no-op default for `IPushDeviceRegistrar`: it accepts and discards device registrations so clients can call the Devices endpoints unconditionally, storing nothing until a hub is configured (`NullPushDeviceRegistrar.cs:7-12`).
- **Depends on**: [`IPushDeviceRegistrar`](#ipushdeviceregistrar), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest), and [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, the Null Object pattern for the disabled native channel.** `[Rubric §2, Design Patterns]`: both `UpsertAsync` and `DeleteAsync` return `Result.Success()` (`NullPushDeviceRegistrar.cs:15-20`), so the Devices API is always callable and simply does nothing when no notification hub is wired up. It is the device-registration twin of [`NullNativePushSender`](#nullnativepushsender), which no-ops the send side of the same disabled channel ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
- **Why it's built this way**: keeping registration a success (rather than an error) means a client that always registers on launch is not blocked by a host that has not enabled native push; the channel becomes real only when [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) is registered.
- **Where it's used**: the default `IPushDeviceRegistrar`, replaced by [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) when `AddNativePushNotifications()` runs with an enabled hub.

### DesignTimeDbContextHelper

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:34` · Level 8 · class (static)

- **What it is**: a static helper that builds a [`SQLServerDbContext`](#sqlserverdbcontext) for `dotnet ef` design-time commands **without** the application's DI container, so each per-database migrations project reduces to a few lines (`DesignTimeDbContextHelper.cs:16-34`).
- **Depends on**: EF Core (`DbContextOptionsBuilder`, `IDesignTimeDbContextFactory`), the data-source resolution stack ([`DataSourceResolver`](#datasourceresolver), [`EntityDataSourceRegistry`](#entitydatasourceregistry), [`DataSourcesSettings`](group-14-module-system-composition.md#datasourcessettings)), the save interceptors ([`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor), [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)), [`IOutboxSignal`](group-04-events-outbox.md#ioutboxsignal)/[`OutboxSignal`](group-04-events-outbox.md#outboxsignal), and its own two private nested leaves [`ExplicitAssemblyProvider`](#explicitassemblyprovider) and [`NullDomainEventDispatcher`](#nulldomaineventdispatcher).
- **Concept introduced, design-time context construction for migrations-per-database.** `[Rubric §17, DevOps]` and `[Rubric §33, Developer Experience]`: database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) needs one migrations project per database, and scaffolding a migration must not require standing up the whole app. `CreateSqlServer(args, configure)` (`DesignTimeDbContextHelper.cs:43-81`) lets a migrations project implement EF's `IDesignTimeDbContextFactory<SQLServerDbContext>` in a callback that supplies connection settings and configuration assemblies (the pattern is shown in the class doc, `DesignTimeDbContextHelper.cs:20-30`).
- **Walkthrough**: `CreateSqlServer` (`DesignTimeDbContextHelper.cs:43-81`) validates its arguments, runs the caller's `configure` over a fresh [`DesignTimeDbContextOptions`](#designtimedbcontextoptions), then resolves the logical source name in priority order: the explicit `DataSourceName`, else `--datasource` from args, else `DataSourceKey.DefaultName` (`DesignTimeDbContextHelper.cs:51-53`). It builds an [`ExplicitAssemblyProvider`](#explicitassemblyprovider) from the listed assemblies, a [`DataSourceResolver`](#datasourceresolver) with null logging, and an [`EntityDataSourceRegistry`](#entitydatasourceregistry) (`DesignTimeDbContextHelper.cs:55-60`), then hand-builds a minimal `ServiceCollection` wiring `TimeProvider.System`, null loggers, the [`NullDomainEventDispatcher`](#nulldomaineventdispatcher), an [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), both interceptors, and the resolver/registry (`DesignTimeDbContextHelper.cs:62-72`). Finally it resolves the physical source and constructs the [`SQLServerDbContext`](#sqlserverdbcontext) with an empty options builder plus that provider (`DesignTimeDbContextHelper.cs:74-81`), so the built model contains only the selected source's entities. `ParseDataSourceName` (`DesignTimeDbContextHelper.cs:86-104`) reads `--datasource <Name>` or `--datasource=Name`, throwing if the flag is present with no value.
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) requires per-database migrations; a shared design-time helper keeps each migrations project trivial and avoids booting the full application DI graph just to scaffold a migration. Null loggers and a null dispatcher are the minimal stand-ins for services that are irrelevant when no save ever runs.
- **Where it's used**: called from each per-database migrations factory, for example the `MMCA.ADC.Migrations.SqlServer.{Identity,Conference,Engagement}` projects, and invoked as `dotnet ef migrations add X --project ... -- --datasource <Name>` (`DesignTimeDbContextHelper.cs:31`).

### NativePushPayloads

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NativePushPayloads.cs:10` · Level 0 · class (internal static)

- **What it is**: a pure helper that builds the platform-native JSON bodies (FCM v1 for Android, APNs for Apple) and the `user:{id}` OR-tag expressions that an Azure Notification Hubs send needs. It holds no state and touches no hub, so the payload shapes and the tag-chunking rule are unit-testable in isolation (`NativePushPayloads.cs:5-10`).
- **Depends on**: the BCL only: `System.Text.Json.JsonSerializer` for the payload strings, `Enumerable.Chunk` for the OR-expression batching, and the `UserIdentifierType` alias (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) for the user-tag input.
- **Concept introduced, native push payload construction and the 20-tag chunk rule.** `[Rubric §7, Microservices Readiness]` assesses whether cross-cutting delivery mechanics live behind a reusable, transport-specific boundary rather than smeared through handlers; here the exact wire shapes of two third-party push protocols are pinned in one place. Azure Notification Hubs caps a single tag expression at 20 tags (`MaxTagsPerExpression`, `NativePushPayloads.cs:13`), so a user-targeted broadcast to a large audience is split into `Chunk(20)` groups, each rendered as a `user:a || user:b || ...` OR-expression (`NativePushPayloads.cs:59-63`). That cap is a real hub limit, not an arbitrary batch size, which is why it is a named constant the sender reuses rather than a literal.
- **Walkthrough**: `BuildFcmV1Payload` (`NativePushPayloads.cs:16-28`) nests a `notification` block of `title`/`body` under a `message` envelope, adding a `data` map only when metadata is non-empty (the `{ Count: > 0 }` pattern, `NativePushPayloads.cs:22`). `BuildApnsPayload` (`NativePushPayloads.cs:31-53`) builds the APNs `aps.alert` block, then copies each metadata pair up to the top level as a custom key while explicitly refusing to overwrite the reserved `aps` key (`NativePushPayloads.cs:44-49`). `BuildUserTagExpressions` (`NativePushPayloads.cs:59-63`) maps each id through `UserTag`, chunks, and joins. `UserTag` (`NativePushPayloads.cs:66-67`) formats `user:{userId}` under `InvariantCulture` via `string.Create`, so a numeric id never picks up a locale-specific separator.
- **Why it's built this way**: keeping the payload shapes and the hub's tag cap in a stateless helper ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) means the [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) stays a thin adapter and the fiddly JSON/tag rules can be proven correct without a live hub or credentials.
- **Where it's used**: consumed by [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) (payloads and tag expressions, `AzureNotificationHubNativePushSender.cs:21-24`) and [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) (the `UserTag` stamped on each installation, `AzureNotificationHubDeviceRegistrar.cs:41`).
- **Caveats / not-in-source**: `internal`, so it is reachable only inside `MMCA.Common.Infrastructure` and its `InternalsVisibleTo` test project.

### PeriodicBackgroundService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PeriodicBackgroundService.cs:20` · Level 0 · class (public abstract partial)

- **What it is**: the framework's base class for fixed-interval background sweeps. A subclass supplies an interval and one cycle body; the base supplies the enablement gate, the startup delay, the loop, the never-die error handling, and a clock that tests can drive (`PeriodicBackgroundService.cs:6-22`).
- **Depends on**: no first-party types at all. It extends `Microsoft.Extensions.Hosting.BackgroundService` and takes `TimeProvider` plus a non-generic `ILogger` through its primary constructor (`PeriodicBackgroundService.cs:20-22`).
- **Concept introduced, the clock-injected periodic hosted service.** `[Rubric §14, Testability]` assesses whether time-dependent behavior can be exercised without waiting for real time: every wait here goes through the injected `TimeProvider` (`PeriodicBackgroundService.cs:55` and `PeriodicBackgroundService.cs:80`), so a `FakeTimeProvider` can advance an hour-scale loop instantly, which is exactly what the unit tests do (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Services/PeriodicBackgroundServiceTests.cs:90-100`). `[Rubric §29, Resilience & Business Continuity]` applies to the failure contract: a throwing cycle is logged and the loop continues to the next interval (`PeriodicBackgroundService.cs:73-76`), so one bad sweep cannot silently take a reconciliation job offline for the life of the process. `[Rubric §13, Observability & Operability]` shows in the two source-generated `[LoggerMessage]` methods (`PeriodicBackgroundService.cs:89-93`), which is why the class is `partial`: a disabled service says so at Information level, a failed cycle logs at Error with the exception.
- **Walkthrough**
  - **The subclass contract** is four members: abstract `Interval` (`PeriodicBackgroundService.cs:25`), virtual `StartupDelay` defaulting to 15 seconds so the host finishes initializing before background work starts (`PeriodicBackgroundService.cs:31`), virtual `IsEnabled` defaulting to true (`PeriodicBackgroundService.cs:38`), and abstract `ExecuteCycleAsync` (`PeriodicBackgroundService.cs:42`).
  - **`ExecuteAsync`** (`PeriodicBackgroundService.cs:45-87`) is the whole loop. It evaluates `IsEnabled` **once** at startup and returns after logging when the answer is false (`PeriodicBackgroundService.cs:47-51`), so a feature toggle flipped at runtime does not restart the sweep.
  - **The startup delay** is awaited in its own `try` whose `catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)` returns cleanly (`PeriodicBackgroundService.cs:53-60`): a host stopped during the first 15 seconds exits without a first-chance exception escaping to the host.
  - **The loop body** (`PeriodicBackgroundService.cs:62-86`) runs the cycle, then waits the interval, each guarded separately. Cancellation mid-cycle breaks out as normal shutdown (`PeriodicBackgroundService.cs:68-72`); any other exception is logged with the concrete `GetType().Name` and the loop falls through to the interval wait (`PeriodicBackgroundService.cs:73-76`). Because the wait comes after the cycle, a slow cycle pushes the next one out rather than overlapping it: the interval is a gap between runs, not a fixed schedule.
- **Why it's built this way**: the class doc states the boundary explicitly (`PeriodicBackgroundService.cs:12-16`): this shape fits periodic reconciliation and cleanup work, and is deliberately **not** used by the outbox processor, whose signal-driven smart wait does not fit a fixed interval. [ADR-054](https://ivanball.github.io/docs/adr/054-saga-compensation-and-reconciliation.html) records the same loop shape (gate, startup delay, per-cycle try/catch, `TimeProvider` waits) as the framework's answer for reconciliation sweeps.
- **Where it's used**: nothing derives from it in production today. Its only subclass across MMCA.Common, MMCA.ADC, MMCA.Store, and MMCA.Helpdesk is the `CountingSweep` test double in its own unit tests (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Services/PeriodicBackgroundServiceTests.cs:103-104`). The framework's own hosted services predate it and hand-roll their loops directly on `BackgroundService`: [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) is one (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCleanupService.cs:42`).
- **Caveats / not-in-source**: it ships with zero adopters, so read it as an available base class rather than as a description of how the running sweeps are built. [ADR-054](https://ivanball.github.io/docs/adr/054-saga-compensation-and-reconciliation.html) records that MMCA.Store's payment reconciliation sweep reimplements the same loop instead of deriving from it.

### AzureNotificationHubNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubNativePushSender.cs:14` · Level 1 · class (sealed partial)

- **What it is**: the Azure Notification Hubs implementation of [`INativePushSender`](#inativepushsender): the real, mobile-facing native notification channel that pushes FCM v1 and APNs payloads through a hub client (`AzureNotificationHubNativePushSender.cs:7-16`).
- **Depends on**: [`INativePushSender`](#inativepushsender) (the contract it fulfills), [`NativePushPayloads`](#nativepushpayloads) (payload and tag construction), and two externals: `Microsoft.Azure.NotificationHubs.INotificationHubClient` (the hub SDK) and `ILogger<T>`.
- **Concept introduced, the native (mobile) push channel and its best-effort contract.** `[Rubric §13, Observability & Operability]` covers whether side-effecting integrations log their outcomes and fail without taking the request down; this sender emits a structured log per send (`LogNativePushSent`, `AzureNotificationHubNativePushSender.cs:42-43`) and its class comment records that callers treat the channel as best-effort, wrapping it in a non-fatal catch (`AzureNotificationHubNativePushSender.cs:11-12`). This is the device-facing counterpart to the in-app SignalR channel: [`NullPushNotificationSender`](group-10-notifications.md#nullpushnotificationsender) and its SignalR sibling deliver to connected web clients, whereas this one reaches devices via APNs and FCM.
- **Walkthrough**: the primary constructor takes the hub client and logger (`AzureNotificationHubNativePushSender.cs:14-16`). `SendToUsersAsync` (`AzureNotificationHubNativePushSender.cs:19-31`) builds both payloads once (`AzureNotificationHubNativePushSender.cs:21-22`), then for each 20-tag OR-expression sends an `FcmV1Notification` and an `AppleNotification` targeted at that expression (`AzureNotificationHubNativePushSender.cs:24-28`), so one call fans out to both platforms per audience chunk. `BroadcastAsync` (`AzureNotificationHubNativePushSender.cs:34-40`) sends the same two payloads with no tag filter, reaching every registered installation. Both `ConfigureAwait(false)` on every await (library code, no sync context needed, [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html)) and log the title on completion.
- **Why it's built this way**: the `partial` class exists so the `[LoggerMessage]` source generator can emit `LogNativePushSent` (`AzureNotificationHubNativePushSender.cs:42-43`), the high-performance logging pattern used across the framework. Splitting payload construction into [`NativePushPayloads`](#nativepushpayloads) ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) keeps this type a pure transport adapter.
- **Where it's used**: registered as a transient `INativePushSender` by `AddNativePushNotifications(configuration)` in place of [`NullNativePushSender`](#nullnativepushsender) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:313`); resolved by [`SendPushNotificationHandler`](group-10-notifications.md#sendpushnotificationhandler) (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:21`).

### ExplicitAssemblyProvider

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:106` · Level 1 · class (sealed, private nested)

- **What it is**: a tiny private nested provider inside [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) that returns a fixed, caller-supplied list of entity-configuration assemblies (`DesignTimeDbContextHelper.cs:106-109`).
- **Depends on**: [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) (the contract) and `System.Reflection.Assembly`.
- **Concept reinforced, explicit assembly enumeration in place of runtime scanning.** `[Rubric §8, Data Architecture]` looks at whether the model's entity set is deterministic per database; at runtime the framework discovers configuration assemblies by scanning the AppDomain, but `dotnet ef` design-time commands see none of that. `GetConfigurationAssemblies` (`DesignTimeDbContextHelper.cs:108`) simply hands back the assemblies the migrations project listed via [`DesignTimeDbContextOptions.AddConfigurationAssembly`](#designtimedbcontextoptions), so the design-time model contains exactly the intended entities and nothing else.
- **Why it's built this way**: it is the design-time substitute for the AppDomain-scanning provider; keeping it private and trivial means the migrations authoring surface stays [`DesignTimeDbContextOptions`](#designtimedbcontextoptions), not this class.
- **Where it's used**: instantiated once inside `DesignTimeDbContextHelper.CreateSqlServer` (`DesignTimeDbContextHelper.cs:55`), passed straight to the [`EntityDataSourceRegistry`](#entitydatasourceregistry) it builds (`DesignTimeDbContextHelper.cs:60`), registered as the `IEntityConfigurationAssemblyProvider` for the design-time container (`DesignTimeDbContextHelper.cs:70`), and handed to the context constructor (`DesignTimeDbContextHelper.cs:79`).
- **Caveats / not-in-source**: private nested type; it surfaces in the inventory only because the tool includes private nested classes. Not reachable from outside the helper.

### NullNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullNativePushSender.cs:10` · Level 1 · class (sealed)

- **What it is**: the no-op default implementation of [`INativePushSender`](#inativepushsender): both methods return `Task.CompletedTask`, so the native-push channel always resolves and silently does nothing until a host opts in (`NullNativePushSender.cs:5-19`).
- **Depends on**: [`INativePushSender`](#inativepushsender) only.
- **Concept reinforced, the Null Object pattern as the safe default channel.** `[Rubric §2, Design Patterns]` values a harmless default that satisfies a contract without a live dependency; registering this type by default means DI resolution and the Devices/send endpoints work everywhere, even in a host with no notification hub. The real [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) is swapped in only when `AddNativePushNotifications(configuration)` runs against an enabled, fully-configured hub (`NullNativePushSender.cs:6-9`).
- **Walkthrough**: `SendToUsersAsync` and `BroadcastAsync` (`NullNativePushSender.cs:13-18`) each match the interface signature and return a completed task; there is no logging and no failure, by design.
- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) gives the framework three notification channels; a no-op default keeps the native channel optional, so a host that never configures a hub still composes and runs.
- **Where it's used**: registered with `TryAddTransient` as the default `INativePushSender` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:212`), paired with [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar) on the next line for the same disabled-hub scenario.

### SoftDeleteUniqueIndexConvention

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:24` · Level 1 · class (sealed)

- **What it is**: an EF Core **model-finalizing convention** that appends an `IsDeleted = 0` filter to every unique index on a soft-deletable entity type, so a soft-deleted row stops occupying its unique slot (`SoftDeleteUniqueIndexConvention.cs:10-24`).
- **Depends on**: [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) (the soft-delete marker it tests for) and the [`DataSource`](#datasource) engine enum; externally, EF Core's convention metadata API (`IModelFinalizingConvention`, `IConventionModelBuilder`, `IConventionEntityType`, `IConventionIndex`).
- **Concept introduced, filtered (partial) unique indexes as the database half of soft delete.** `[Rubric §8, Data Architecture]` assesses whether the storage model actually enforces the semantics the application presents, and `[Rubric §16, Maintainability]` assesses whether a cross-cutting rule is applied once centrally instead of remembered per entity. Soft delete (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) hides a row behind a global query filter, but the row is still physically present, so a plain unique index keeps rejecting a new record that reuses the deleted one's value: delete a speaker and that email address stays permanently unusable (`SoftDeleteUniqueIndexConvention.cs:11-16`). A filtered index solves this by indexing only live rows. Making it a convention means no entity-configuration author has to remember the rule.
- **Walkthrough**
  - The primary constructor takes the engine of the context being built (`SoftDeleteUniqueIndexConvention.cs:24`), because filter syntax is provider-specific.
  - `ProcessModelFinalizing` (`SoftDeleteUniqueIndexConvention.cs:27-41`) null-guards the builder, returns immediately for Cosmos (`SoftDeleteUniqueIndexConvention.cs:33-34`), then selects every entity type assignable to `IAuditableEntity` that is not owned (`SoftDeleteUniqueIndexConvention.cs:36-37`) and processes each.
  - `ApplyFilterToUniqueIndexes` (`SoftDeleteUniqueIndexConvention.cs:43-57`) resolves the mapped column name for `IsDeleted`, falling back to the property name when the property is absent (`SoftDeleteUniqueIndexConvention.cs:45-46`), then builds the SQL literal: bracket-quoted `[IsDeleted] = 0` for SQL Server, double-quoted `"IsDeleted" = 0` otherwise (`SoftDeleteUniqueIndexConvention.cs:48-50`).
  - The loop applies the filter only to indexes that are unique **and** have no filter already (`SoftDeleteUniqueIndexConvention.cs:52-56`), so a hand-authored filter in an entity configuration always wins.
- **Why it's built this way**: running at model finalization guarantees the convention sees every index a module configuration declared, rather than racing declaration order. Cosmos is skipped because it has no partial-index concept; SQL Server and SQLite both support filtered or partial indexes (`SoftDeleteUniqueIndexConvention.cs:17-21`). Respecting an existing filter keeps the convention additive, never destructive.
- **Where it's used**: registered per context in [`ApplicationDbContext`](#applicationdbcontext)`.ConfigureConventions` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:210`), immediately after [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) (`ApplicationDbContext.cs:205`), so it applies to every entity in every module of every host.

### DesignTimeDbContextOptions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:11` · Level 2 · class (sealed)

- **What it is**: the configuration carrier a migrations project fills in to tell [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) how to build a context for `dotnet ef ... -- --datasource <Name>`. It holds the connection settings, the named data-source entries, and the explicit list of entity-configuration assemblies (`DesignTimeDbContextOptions.cs:11-33`).
- **Depends on**: [`ConnectionStringSettings`](group-14-module-system-composition.md#connectionstringsettings), [`DataSourceEntrySettings`](group-14-module-system-composition.md#datasourceentrysettings), and `System.Reflection.Assembly`.
- **Concept introduced, design-time context construction for database-per-service.** `[Rubric §8, Data Architecture]` assesses whether each database's migrations are built in isolation; in the database-per-service model ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) each module's migrations project must scaffold a context for only its own database. At design time there is no DI container and no AppDomain scan, so this options object captures everything `dotnet ef` cannot discover on its own: the top-level connection strings including `SQLServerMigrationsAssembly` (`DesignTimeDbContextOptions.cs:20-24`), the named `DataSources` entries (`DesignTimeDbContextOptions.cs:26-27`), and the explicit configuration assemblies (`DesignTimeDbContextOptions.cs:29-33`, whose comment notes the runtime scan sees nothing here).
- **Walkthrough**: `DataSourceName` (`DesignTimeDbContextOptions.cs:18`) is optional; when null the helper parses `--datasource` and falls back to `Default`. `AddConfigurationAssembly` (`DesignTimeDbContextOptions.cs:38-47`) is a chainable builder method that guards against duplicate registrations before adding.
- **Why it's built this way**: a single options object plus a builder method keeps each per-module migrations factory to a handful of lines while still pinning the model to one database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: passed to `DesignTimeDbContextHelper.CreateSqlServer(args, options => ...)` from each per-database migrations factory; the class doc of the helper shows the exact shape (`DesignTimeDbContextHelper.cs:20-30`).

### NullDomainEventDispatcher

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:111` · Level 2 · class (sealed, private nested)

- **What it is**: a no-op [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) used only inside the design-time context helper, never in production. `DispatchAsync` returns `Task.CompletedTask` (`DesignTimeDbContextHelper.cs:111-115`).
- **Depends on**: [`IDomainEvent`](group-04-events-outbox.md#idomainevent) and [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher).
- **Concept reinforced, the Null Object pattern for a design-time DI gap.** `[Rubric §2, Design Patterns]` values satisfying an interface with a harmless no-op when the real implementation would need the full application container. During `dotnet ef migrations add` the design-time factory builds a context but never saves through it, so a real dispatcher (which would try to hand events to handlers that are not registered here) would be both unnecessary and wrong. Registering this null dispatcher (`DesignTimeDbContextHelper.cs:66`) closes that dependency without pulling in application services, because [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) is itself registered in that minimal container (`DesignTimeDbContextHelper.cs:69`) and demands one.
- **Why it's built this way**: the design-time service graph is deliberately minimal (null loggers, null dispatcher, a hand-built `ServiceCollection`) so scaffolding a migration never spins up the app; this type is one leaf of that minimal graph.
- **Where it's used**: registered as the `IDomainEventDispatcher` inside `DesignTimeDbContextHelper.CreateSqlServer` (`DesignTimeDbContextHelper.cs:66`).
- **Caveats / not-in-source**: private nested type inside [`DesignTimeDbContextHelper`](#designtimedbcontexthelper); not accessible from outside.

### CrossDataSourceDegradeConvention

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33` · Level 3 · class (sealed)

- **What it is**: the EF Core **model-finalizing convention** that detects relationships whose two ends resolve to different physical databases and degrades them: the foreign key and its navigations are removed from the model, the declared scalar FK columns survive with a compensating index, and entity types belonging to another source are dropped from this model entirely (`CrossDataSourceDegradeConvention.cs:9-33`).
- **Depends on**: [`DataSourceKey`](#datasourcekey), [`DataSource`](#datasource), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry); externally EF Core's metadata API (`IModelFinalizingConvention`, `IMutableModel`, `IMutableEntityType`, `IMutableForeignKey`, `IMutableProperty`, `IConventionIndex`).
- **Concept introduced, automatic cross-database relationship degradation.** `[Rubric §8, Data Architecture]` assesses the database-per-service consistency strategy, and `[Rubric §7, Microservices Readiness]` assesses whether the model adapts to the deployment topology without per-entity code. Under database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) a database cannot enforce a foreign key that points into another database, so this convention strips those relationships automatically at model finalization. The scalar column survives (a query can still filter on, say, a `UserId`), cross-source loading is left to `INavigationPopulator` batch loading ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html), see [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)), and cross-source consistency is the outbox's job (`CrossDataSourceDegradeConvention.cs:12-21`). The closing remark is the load-bearing invariant: when every entity resolves to the same physical source (the monolith-collapse case) nothing is foreign and the convention is a structural no-op, so the collapsed model is identical to the single-database model (`CrossDataSourceDegradeConvention.cs:25-29`).
- **Walkthrough**
  - The primary constructor takes the `contextKey` (the physical source whose model is being built) and the [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`CrossDataSourceDegradeConvention.cs:33-35`); `IsForeign` (`CrossDataSourceDegradeConvention.cs:91-94`) asks the registry for a CLR type's key and returns true when it differs from `contextKey`.
  - `ProcessModelFinalizing` (`CrossDataSourceDegradeConvention.cs:38-89`) casts the model to the **mutable** surface (`CrossDataSourceDegradeConvention.cs:46`) deliberately: cross-cutting helpers (soft-delete filters, concurrency tokens) promote every entity type to the Explicit configuration source, which convention-sourced builder calls cannot override (`CrossDataSourceDegradeConvention.cs:22-24` and `CrossDataSourceDegradeConvention.cs:44-45`). It collects the non-owned foreign entity types (`CrossDataSourceDegradeConvention.cs:48-50`) and returns early when there are none (`CrossDataSourceDegradeConvention.cs:52-55`).
  - Step 1 (`CrossDataSourceDegradeConvention.cs:62-74`): for every *local* dependent it degrades each declared FK pointing at a foreign principal. `addCompensatingIndex` is false for Cosmos (`CrossDataSourceDegradeConvention.cs:65`), because Cosmos auto-indexes every property and rejects explicit index definitions; that skip is what makes one configuration body portable to Cosmos without edits (`CrossDataSourceDegradeConvention.cs:100-105`).
  - `DegradeForeignKey` (`CrossDataSourceDegradeConvention.cs:107-138`) keeps the non-shadow scalar FK properties (`CrossDataSourceDegradeConvention.cs:112-114`), removes the FK (`CrossDataSourceDegradeConvention.cs:116`), then eagerly drops the convention-created FK index before the coverage check (`CrossDataSourceDegradeConvention.cs:123-130`), because EF's deferred event processing would otherwise remove it *after* the check and leave the column unindexed. It adds a plain index only when `HasCoveringIndex` (`CrossDataSourceDegradeConvention.cs:140-144`) finds no existing index covering those columns as a prefix.
  - Step 2 (`CrossDataSourceDegradeConvention.cs:79-82`): `IgnoreForeignMembers` (`CrossDataSourceDegradeConvention.cs:151-165`) removes skip navigations to foreign types and ignores any CLR property whose (collection-unwrapped) type is a foreign entity, so model validation does not later reject an unmapped entity-typed property; `UnwrapCollectionElementType` (`CrossDataSourceDegradeConvention.cs:171-174`) handles the `List<T>` and `ICollection<T>` case.
  - Step 3 (`CrossDataSourceDegradeConvention.cs:84-88`): removes the foreign entity types from the model.
- **Why it's built this way**: degrading in a convention rather than per-configuration means no module author has to remember to break a cross-service relationship by hand; the same configuration class works whether its module ships inside the monolith or as its own service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).
- **Where it's used**: registered per context in [`ApplicationDbContext`](#applicationdbcontext)`.ConfigureConventions` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:205`), just before [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention); [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory), installed in the same context's `OnConfiguring` (`ApplicationDbContext.cs:190`), ensures each database caches its own degraded model rather than reusing one built for a different source.

### DataSourceService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12` · Level 3 · class (sealed)

- **What it is**: the application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry): given an entity type (or its full name) it answers which physical data source that entity lives in, and whether two entities can be EF-`Include`d together (`DataSourceService.cs:6-12`).
- **Depends on**: [`IDataSourceService`](#idatasourceservice) (the contract), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (the eager routing table it delegates to), and the [`DataSourceKey`](#datasourcekey) and [`DataSource`](#datasource) value types.
- **Concept reinforced, entity-to-database routing as a query surface.** `[Rubric §8, Data Architecture]` assesses whether database-per-service routing is a first-class, queryable concept; the registry aggregates every `[UseDataSource]` and `[UseDatabase]` declaration at startup, and this facade is the thin runtime interface over it. Because the registry is built eagerly from configuration assemblies (`DataSourceService.cs:8-11`), resolution no longer waits for an EF model to be built, which matters for the navigation classification that runs before any query.
- **Walkthrough**: the four `GetDataSource*` overloads (`DataSourceService.cs:15-24`) forward straight to the registry, returning either the full [`DataSourceKey`](#datasourcekey) or just its `Engine` ([`DataSource`](#datasource)). `HaveIncludeSupport(DataSourceKey, DataSourceKey)` (`DataSourceService.cs:31-32`) encodes the eager-loading rule: an EF `Include` is valid only when both entities resolve to the *same* key **and** that engine is not Cosmos (`first == second && first.Engine != DataSource.CosmosDB`), because Cosmos has no cross-document joins (`DataSourceService.cs:27-30`). The string overload (`DataSourceService.cs:35-38`) resolves both names through `TryGetDataSourceKey` and defers to the key overload, returning false if either name is unknown.
- **Why it's built this way**: keeping the include-support rule in one predicate lets the navigation metadata and cross-source degrade logic ask a single authority whether a relationship can be loaded in-database versus batch-loaded across sources ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Facading the registry keeps callers off its lower-level API.
- **Where it's used**: registered with `TryAddSingleton` as the `IDataSourceService` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:50`); injected into [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20`), which classifies navigations per process, and into [`UnitOfWork`](#unitofwork) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13`), which uses it to pick the context for an entity.

### AzureBlobFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureBlobFileStorageService.cs:15` · Level 4 · class (sealed)

- **What it is**: the Azure Blob Storage implementation of [`IFileStorageService`](#ifilestorageservice): uploads and deletes blobs in the single configured container, returning [`Result`](group-01-result-error-handling.md#result) instead of throwing (`AzureBlobFileStorageService.cs:10-17`).
- **Depends on**: [`IFileStorageService`](#ifilestorageservice), the [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error) types, and Azure externals `BlobContainerClient` / `BlobUploadOptions` / `RequestFailedException` plus `ILogger<T>`.
- **Concept introduced, the file-storage boundary and Result-wrapped I/O.** `[Rubric §10, Cross-Cutting Concerns]` covers pushing infrastructure integrations behind an application-owned contract; here blob I/O is hidden behind [`IFileStorageService`](#ifilestorageservice) and every SDK failure is caught and mapped to a domain [`Error`](group-01-result-error-handling.md#error) rather than bubbling as an exception. `IsConfigured => true` (`AzureBlobFileStorageService.cs:20`) is the flag that distinguishes this live implementation from the [`NullFileStorageService`](#nullfilestorageservice) fallback.
- **Walkthrough**: the constructor takes an already-resolved `BlobContainerClient` and a logger (`AzureBlobFileStorageService.cs:15-17`); the class comment notes the container and its public-access level are provisioned by infrastructure, not created here (`AzureBlobFileStorageService.cs:12-13`). `UploadAsync` (`AzureBlobFileStorageService.cs:23-43`) gets a blob client, uploads with an explicit `ContentType` header (`AzureBlobFileStorageService.cs:30`), and returns `Result.Success(blobClient.Uri)`; a `RequestFailedException` is logged and mapped to `Error.Failure("FileStorage.UploadFailed", ...)` (`AzureBlobFileStorageService.cs:35-42`). `DeleteAsync` (`AzureBlobFileStorageService.cs:46-62`) calls `DeleteBlobIfExistsAsync` (idempotent) and maps failures to `FileStorage.DeleteFailed`.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) introduces the file-storage and image pipeline; returning `Result` keeps storage failures on the same error-handling rail as the rest of the stack, and catching only `RequestFailedException` means genuinely unexpected errors still surface.
- **Where it's used**: registered as a transient `IFileStorageService` by `AddAzureBlobFileStorage(configuration)` in place of [`NullFileStorageService`](#nullfilestorageservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:354`, container client built at `DependencyInjection.cs:347-353`); consumed by the ADC Identity avatar handlers, for example [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:19`), [`RemoveUserAvatarHandler`](group-24-identity-module.md#removeuseravatarhandler) (`RemoveUserAvatarHandler.cs:16`), and [`DeleteUserHandler`](group-24-identity-module.md#deleteuserhandler) (`DeleteUserHandler.cs:17`), typically after [`ImageSharpImageProcessor`](#imagesharpimageprocessor) has normalized the bytes.

### AzureNotificationHubDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubDeviceRegistrar.cs:15` · Level 4 · class (sealed)

- **What it is**: the Azure Notification Hubs implementation of [`IPushDeviceRegistrar`](#ipushdeviceregistrar): it registers (upserts) and unregisters a device's push installation using the hub's installation model, stamping each installation with its owner's `user:{id}` tag (`AzureNotificationHubDeviceRegistrar.cs:10-17`).
- **Depends on**: [`IPushDeviceRegistrar`](#ipushdeviceregistrar), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest) (the inbound DTO), [`NativePushPayloads`](#nativepushpayloads) (the owner tag), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error), and Azure externals `INotificationHubClient` / `Installation` / `MessagingException`.
- **Concept introduced, device registration via the installation model.** `[Rubric §11, Security]` includes owner-scoping of side channels; by stamping every installation with `NativePushPayloads.UserTag(userId)` (`AzureNotificationHubDeviceRegistrar.cs:41`) the registrar guarantees a later user-targeted send reaches only that user's devices. The installation model uses client-owned stable ids with full upsert semantics (`AzureNotificationHubDeviceRegistrar.cs:11-13`), so re-registering the same device is idempotent rather than duplicating.
- **Walkthrough**: `UpsertAsync` (`AzureNotificationHubDeviceRegistrar.cs:20-57`) first maps the request's platform string to a `NotificationPlatform` via a `switch` over `FCMV1` and `APNS` (`AzureNotificationHubDeviceRegistrar.cs:22-27`); an unrecognized value returns `Error.Validation("PushDevice.UnsupportedPlatform", ...)` before any hub call (`AzureNotificationHubDeviceRegistrar.cs:28-34`). It then builds an `Installation` with the client id, platform, push channel, and the single user tag (`AzureNotificationHubDeviceRegistrar.cs:36-42`) and calls `CreateOrUpdateInstallationAsync`, mapping a `MessagingException` to `PushDevice.UpsertFailed` (`AzureNotificationHubDeviceRegistrar.cs:49-56`). `DeleteAsync` (`AzureNotificationHubDeviceRegistrar.cs:60-80`) deletes the installation but treats `MessagingEntityNotFoundException` as success (`AzureNotificationHubDeviceRegistrar.cs:67-71`): an unknown installation is already in the desired state, so delete is idempotent.
- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)'s native channel needs a way to associate devices with users; the tag-per-installation approach lets sends target `user:{id}` OR-expressions without the app keeping its own device table. Idempotent delete keeps client retries safe.
- **Where it's used**: registered as a transient `IPushDeviceRegistrar` by `AddNativePushNotifications(configuration)` in place of [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:314`); called by [`DevicesController`](group-10-notifications.md#devicescontroller) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:26`) and paired with [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) for the send side.

### ImageSharpImageProcessor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ImageSharpImageProcessor.cs:14` · Level 4 · class (sealed)

- **What it is**: the ImageSharp implementation of [`IImageProcessor`](#iimageprocessor): it decodes an uploaded image, re-orients and crops it to a square, strips all metadata, and re-encodes it as JPEG, returning the bytes as a [`Result`](group-01-result-error-handling.md#result) (`ImageSharpImageProcessor.cs:9-17`).
- **Depends on**: [`IImageProcessor`](#iimageprocessor), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error), and the SixLabors.ImageSharp externals (`Image`, `Mutate`, `ResizeOptions`, `JpegEncoder`).
- **Concept introduced, full re-encode as a security control.** `[Rubric §11, Security]` and `[Rubric §30, Compliance/Privacy/Data Governance]` both apply: decoding to pixels and re-encoding is deliberate so that EXIF metadata (including GPS coordinates, which are PII) and any polyglot payload smuggled into the original file are discarded, since only pixels survive the round trip (`ImageSharpImageProcessor.cs:9-13`). This is a defense against both privacy leaks and image-parser exploits, not merely a resize. Its upload-side companion is [`ImageContentSniffer`](#imagecontentsniffer), which decides the accepted formats from the magic bytes rather than the client-declared content type before the stream reaches this processor (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ImageContentSniffer.cs:3-16`).
- **Walkthrough**: `NormalizeToSquareJpegAsync` (`ImageSharpImageProcessor.cs:17-51`) loads the stream, then `Mutate`s with `AutoOrient()` *before* stripping metadata so a portrait phone photo is not left rotated (`ImageSharpImageProcessor.cs:23-31`), and resizes to `size x size` with `ResizeMode.Crop`. It then nulls out the EXIF, XMP, and IPTC profiles (`ImageSharpImageProcessor.cs:33-35`) and saves to a `MemoryStream` with `JpegEncoder { Quality = 85 }` (`ImageSharpImageProcessor.cs:40`), returning `Result.Success(output.ToArray())`. An `UnknownImageFormatException` or `InvalidImageContentException` is caught by an exception filter and mapped to `Error.Validation("Image.Undecodable", ...)` (`ImageSharpImageProcessor.cs:44-50`), so a garbage upload becomes a clean validation failure rather than a 500.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) pairs storage with sanitization; ordering `AutoOrient` before metadata removal is the subtle correctness detail, and quality 85 is the standard size/quality trade-off. Catching only the two ImageSharp decode exceptions keeps unexpected faults visible.
- **Where it's used**: registered with `TryAddSingleton` as the `IImageProcessor` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:218`, whose comment notes it is dependency-free and therefore always the real implementation, `DependencyInjection.cs:215-216`); invoked by [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:18`) before the bytes are handed to [`AzureBlobFileStorageService`](#azureblobfilestorageservice). There is no Null variant because processing needs no external resource.

### NullFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullFileStorageService.cs:11` · Level 4 · class (sealed)

- **What it is**: the unconfigured-host fallback for [`IFileStorageService`](#ifilestorageservice): uploads fail with a clear error while deletes succeed, so file features degrade cleanly instead of crashing (`NullFileStorageService.cs:6-11`).
- **Depends on**: [`IFileStorageService`](#ifilestorageservice) and [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error).
- **Concept reinforced, an asymmetric Null Object (fail-closed write, no-op delete).** `[Rubric §2, Design Patterns]` and `[Rubric §10, Cross-Cutting Concerns]`: unlike a pure no-op, this fallback distinguishes its two operations by intent. `IsConfigured => false` (`NullFileStorageService.cs:14`) lets callers detect the disabled channel; `UploadAsync` returns `Error.Failure("FileStorage.NotConfigured", ...)` (`NullFileStorageService.cs:17-21`) so a write fails loudly and predictably, while `DeleteAsync` returns `Result.Success()` (`NullFileStorageService.cs:24-25`) because there is nothing to delete and a delete of a non-existent file is already the desired state.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) makes storage optional; failing uploads with a typed error (rather than a null-reference crash) keeps a host with no storage configured running and honest about what it cannot do.
- **Where it's used**: registered with `TryAddTransient` as the default `IFileStorageService` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:217`), swapped for [`AzureBlobFileStorageService`](#azureblobfilestorageservice) by `AddAzureBlobFileStorage(configuration)` (`DependencyInjection.cs:329-357`).

### NullPushDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullPushDeviceRegistrar.cs:12` · Level 4 · class (sealed)

- **What it is**: the no-op default for [`IPushDeviceRegistrar`](#ipushdeviceregistrar): it accepts and discards device registrations so clients can call the Devices endpoints unconditionally, storing nothing until a hub is configured (`NullPushDeviceRegistrar.cs:7-12`).
- **Depends on**: [`IPushDeviceRegistrar`](#ipushdeviceregistrar), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest), and [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, the Null Object pattern for the disabled native channel.** `[Rubric §2, Design Patterns]`: both `UpsertAsync` and `DeleteAsync` return `Result.Success()` (`NullPushDeviceRegistrar.cs:15-20`), so the Devices API is always callable and simply does nothing when no notification hub is wired up. It is the device-registration twin of [`NullNativePushSender`](#nullnativepushsender), which no-ops the send side of the same disabled channel ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
- **Why it's built this way**: keeping registration a success (rather than an error) means a client that always registers on launch is not blocked by a host that has not enabled native push; the channel becomes real only when [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) is registered.
- **Where it's used**: registered with `TryAddTransient` as the default `IPushDeviceRegistrar` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:213`), replaced by [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) when `AddNativePushNotifications(configuration)` finds an enabled hub (`DependencyInjection.cs:303-314`).

### DesignTimeDbContextHelper

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:34` · Level 8 · class (static)

- **What it is**: a static helper that builds a [`SQLServerDbContext`](#sqlserverdbcontext) for `dotnet ef` design-time commands **without** the application's DI container, so each per-database migrations project reduces to a few lines (`DesignTimeDbContextHelper.cs:16-34`).
- **Depends on**: EF Core (`DbContextOptionsBuilder`, the caller-implemented `IDesignTimeDbContextFactory`), the data-source resolution stack ([`DataSourceResolver`](#datasourceresolver), [`EntityDataSourceRegistry`](#entitydatasourceregistry), [`DataSourcesSettings`](group-14-module-system-composition.md#datasourcessettings)), the save interceptors ([`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor), [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)), [`IOutboxSignal`](group-04-events-outbox.md#ioutboxsignal) / [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), and its own two private nested leaves [`ExplicitAssemblyProvider`](#explicitassemblyprovider) and [`NullDomainEventDispatcher`](#nulldomaineventdispatcher).
- **Concept introduced, design-time context construction for migrations-per-database.** `[Rubric §17, DevOps]` and `[Rubric §33, Developer Experience]`: database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) needs one migrations project per database, and scaffolding a migration must not require standing up the whole app. `CreateSqlServer(args, configure)` (`DesignTimeDbContextHelper.cs:43-81`) lets a migrations project implement EF's `IDesignTimeDbContextFactory<SQLServerDbContext>` in a callback that supplies connection settings and configuration assemblies (the pattern is shown verbatim in the class doc, `DesignTimeDbContextHelper.cs:20-30`).
- **Walkthrough**: `CreateSqlServer` (`DesignTimeDbContextHelper.cs:43-81`) validates its arguments (`DesignTimeDbContextHelper.cs:45-46`), runs the caller's `configure` over a fresh [`DesignTimeDbContextOptions`](#designtimedbcontextoptions) (`DesignTimeDbContextHelper.cs:48-49`), then resolves the logical source name in priority order: the explicit `DataSourceName`, else `--datasource` from args, else `DataSourceKey.DefaultName` (`DesignTimeDbContextHelper.cs:51-53`). It builds an [`ExplicitAssemblyProvider`](#explicitassemblyprovider) from the listed assemblies, a [`DataSourceResolver`](#datasourceresolver) with `NullLogger`, and an [`EntityDataSourceRegistry`](#entitydatasourceregistry) (`DesignTimeDbContextHelper.cs:55-60`), then hand-builds a minimal `ServiceCollection` wiring `TimeProvider.System`, null loggers, the [`NullDomainEventDispatcher`](#nulldomaineventdispatcher), an [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), both interceptors, and the resolver plus registry (`DesignTimeDbContextHelper.cs:62-72`). Finally it resolves the physical source through `resolver.GetPhysical(resolver.ResolveLogical(DataSource.SQLServer, logicalName))` (`DesignTimeDbContextHelper.cs:74`) and constructs the [`SQLServerDbContext`](#sqlserverdbcontext) with an empty options builder plus that provider (`DesignTimeDbContextHelper.cs:76-81`), so the built model contains only the selected source's entities. `ParseDataSourceName` (`DesignTimeDbContextHelper.cs:86-104`) reads `--datasource <Name>` or `--datasource=Name`, throwing an actionable `InvalidOperationException` if the flag is present with no value (`DesignTimeDbContextHelper.cs:92-95`).
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) requires per-database migrations; a shared design-time helper keeps each migrations project trivial and avoids booting the full application DI graph just to scaffold a migration. Null loggers and a null dispatcher are the minimal stand-ins for services that are irrelevant when no save ever runs.
- **Where it's used**: called from each per-database migrations factory, for example `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/DesignTimeSQLServerDbContextFactory.cs:15` and its Identity, Engagement, and Notification siblings, and invoked as `dotnet ef migrations add X --project ... -- --datasource <Name>` (`DesignTimeDbContextHelper.cs:31-32`).

### UpdatePropertySetterBuilder<TEntity>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/UpdatePropertySetterBuilder.cs:14` · Level 1 · class (internal sealed)

- **What it is**: the Infrastructure-side recorder for a set-based `UPDATE`. Application code describes property assignments through the persistence-agnostic [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) surface, this class collects them as delegates, and replays them onto EF Core's own setters builder when `ExecuteUpdateAsync` runs (`UpdatePropertySetterBuilder.cs:7-14`).
- **Depends on**: [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) (implements it); EF Core's `UpdateSettersBuilder<TSource>` and `System.Linq.Expressions` (`LambdaExpression`, `MemberExpression`) from the BCL.
- **Concept introduced, the recorder that keeps EF Core out of the Application layer.** `[Rubric §3, Clean Architecture]` assesses whether the inner layers stay free of framework types, and `[Rubric §1, SOLID]` (dependency inversion) assesses whether the abstraction belongs to the caller. EF Core 10's `ExecuteUpdate` API wants a lambda over its own `UpdateSettersBuilder<T>`; exposing that type on a repository contract would put an EF Core reference into every command handler that needs an atomic counter update. Instead the Application layer sees only `Set(property, value)` / `Set(property, valueFactory)` (`IUpdatePropertySetter.cs:20-35`), and this class buffers each call as an `Action<UpdateSettersBuilder<TEntity>>` in `_assignments` (`UpdatePropertySetterBuilder.cs:16`) that is only executed inside Infrastructure. This is the same "record now, replay against the provider later" idea the specification evaluator uses for queries, applied to writes.
- **Walkthrough**
  - Two fields: `_assignments`, the ordered list of replayable setter calls (`UpdatePropertySetterBuilder.cs:16`), and `_assignedProperties`, a `HashSet<string>` of the top-level property names the caller touched (`UpdatePropertySetterBuilder.cs:17`).
  - `Set<TProperty>(property, value)` (`UpdatePropertySetterBuilder.cs:20-28`) and the expression-valued overload `Set<TProperty>(property, valueFactory)` (`UpdatePropertySetterBuilder.cs:31-40`): both null-guard, call `TrackPropertyName`, append a closure that forwards to `builder.SetProperty(...)`, and return `this` so calls chain. The second overload is the one that makes a database-arbitrated read-modify-write possible, because the new value is an expression over the current row rather than a client-side constant (`IUpdatePropertySetter.cs:24-27`).
  - `IsEmpty` (`UpdatePropertySetterBuilder.cs:43`): true when nothing was described, which is how [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) rejects a no-op update with an `ArgumentException` (`EFRepository.cs:122-123`).
  - `SetsProperty(name)` (`UpdatePropertySetterBuilder.cs:49`): the audit hook. A bulk update bypasses the save pipeline, so the repository stamps `LastModifiedOn`/`LastModifiedBy` itself *unless* this returns true for that name (`EFRepository.cs:127-136`), which keeps an explicit caller assignment authoritative.
  - `TrackPropertyName` (`UpdatePropertySetterBuilder.cs:60-66`): unwraps the lambda body and records `member.Member.Name` only when the body is a plain `MemberExpression`. A more complex body (a cast or a nested path) simply is not tracked, so the automatic stamp still applies.
  - `Apply(builder)` (`UpdatePropertySetterBuilder.cs:52-58`): replays every collected assignment in order onto EF's builder. The repository passes this method itself as the `ExecuteUpdateAsync` argument (`EFRepository.cs:138`).
- **Why it's built this way**: the alternative (leaking `UpdateSettersBuilder<T>` upward) would force an EF Core package reference into Application and break the layer rules enforced by both the compile-time targets and the architecture tests. Buffering delegates also lets the repository inspect what the caller assigned *before* executing, which is what makes automatic audit stamping possible on a change-tracker-bypassing statement.
- **Where it's used**: constructed once per call in `EFRepository<TEntity, TIdentifierType>.ExecuteUpdateAsync` (`EFRepository.cs:120`); it is the only implementation of [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) in the framework.
- **Caveats / not-in-source**: no application handler in MMCA.ADC or MMCA.Store calls `IRepository.ExecuteUpdateAsync` today. Store's atomic stock decrement issues its own `ExecuteUpdateAsync` straight against the EF `DbSet` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Services/InventoryAllocationService.cs:70-77`), so the repository path is currently exercised by the framework's own tests and by module test doubles.

### AggregateCapture

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:303` · Level 2 · record (sealed, private nested)

- **What it is**: a two-member private record pairing one tracked aggregate root with the exact array of domain events snapshotted from it for this save (`DomainEventSaveChangesInterceptor.cs:300-305`).
- **Depends on**: [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) (via `EntityEntry<IAggregateRoot>`), [`IDomainEvent`](group-04-events-outbox.md#idomainevent); EF Core's `Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry<T>`.
- **Concept introduced, snapshot-and-remove instead of clear-all.** `[Rubric §6, CQRS & Event-Driven]` assesses whether event delivery is exact and reliable rather than best-effort. The naive implementation clears an aggregate's whole event list after dispatch, which silently destroys anything a handler raised on that same aggregate *during* in-process dispatch: those events arrive after the capture and would be wiped before any later capture could see them, so they would never dispatch and never reach the outbox. `AggregateCapture` closes that hole by remembering precisely which events were taken (`DomainEventSaveChangesInterceptor.cs:151-156`), so the cleanup step removes exactly those and leaves any newcomers in place (`DomainEventSaveChangesInterceptor.cs:285-295`).
- **Walkthrough**: `Entry` is the tracked `EntityEntry<IAggregateRoot>`, `Events` the snapshotted `IDomainEvent[]` (`DomainEventSaveChangesInterceptor.cs:303-305`). Captures are built one per aggregate with pending events in `CaptureEventsAndPersistToOutbox` (`DomainEventSaveChangesInterceptor.cs:153-156`), stored on the per-save [`CapturedState`](#capturedstate) (`DomainEventSaveChangesInterceptor.cs:200`), and consumed by `ClearDomainEvents`, which calls `capture.Entry.Entity.RemoveDomainEvents(capture.Events)` (`DomainEventSaveChangesInterceptor.cs:293-294`) against the domain method declared on [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAggregateRoot.cs:32`).
- **Where it's used**: only inside [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor), reached through [`CapturedState.Captures`](#capturedstate).
- **Caveats / not-in-source**: private nested type; it appears in the inventory only because private nested types are included, and it is not part of the public API.

### IEntityDataSourceRegistry

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/IEntityDataSourceRegistry.cs:11` · Level 2 · interface

- **What it is**: the contract for the eagerly-built registry that maps every configured entity type to the physical database it lives in. Four members: `GetDataSourceKey(Type)` (`IEntityDataSourceRegistry.cs:17`), `GetDataSourceKey(string entityFullName)` (`IEntityDataSourceRegistry.cs:23`), `TryGetDataSourceKey(string, out DataSourceKey)` (`IEntityDataSourceRegistry.cs:29`), and `GetPhysicalSourcesInUse()` (`IEntityDataSourceRegistry.cs:35`).
- **Depends on**: [`DataSourceKey`](#datasourcekey).
- **Concept introduced, eager entity-to-database mapping.** `[Rubric §8, Data Architecture]` assesses whether database routing is a deliberate, discoverable design rather than an accident of query order; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without rewriting application code. The doc comment (`IEntityDataSourceRegistry.cs:5-10`) states why this interface exists: it replaces a legacy lazy cache that was populated as a *side effect* of EF model building, so routing decisions (unit of work, navigation classification, outbox enumeration) no longer depend on a model having been built first. `GetPhysicalSourcesInUse()` returns the distinct databases this host actually uses, which is how migrations, `EnsureCreated`, and the outbox processor know which databases to touch (`IEntityDataSourceRegistry.cs:31-35`). The two strict `GetDataSourceKey` overloads throw `InvalidOperationException` for an unregistered entity (documented at `IEntityDataSourceRegistry.cs:16` and `IEntityDataSourceRegistry.cs:22`), while `TryGetDataSourceKey` is the non-throwing probe used where a miss is legitimate.
- **Why it's built this way**: database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) needs every entity to resolve to exactly one physical source; building the map eagerly turns a misconfiguration into a loud startup failure instead of a silent wrong-database query.
- **Where it's used**: implemented by [`EntityDataSourceRegistry`](#entitydatasourceregistry) and registered as a singleton in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:71`). Consumers include [`DbContextFactory`](#dbcontextfactory) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:20`), [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:35`), [`DataSourceService`](#datasourceservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12`), the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) and [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) (`Persistence/Outbox/OutboxProcessor.cs:43`, `Persistence/Outbox/OutboxCleanupService.cs:40`), and the database-initialization startup path (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:42`).

### PhysicalDataSource

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:17` · Level 2 · record (sealed)

- **What it is**: the fully-resolved connection information for one physical database: `Key` (its engine plus name identity), `ConnectionString`, `SqlServerMigrationsAssembly?`, and `CosmosDatabaseName` (`PhysicalDataSource.cs:17-21`).
- **Depends on**: [`DataSourceKey`](#datasourcekey).
- **Concept, a logical name resolved to a real connection.** `[Rubric §8, Data Architecture]` covers the step from a configured name like `DataSources:Conference` to an actual database. The record's doc comment (`PhysicalDataSource.cs:5-9`) explains that it is produced by [`IDataSourceResolver`](#idatasourceresolver) from the top-level `ConnectionStrings` section (the `Default` source) plus the named `DataSources` entries. Two members are engine-scoped: `SqlServerMigrationsAssembly` is null for non-SQL-Server engines and lets each SQL database own its own EF migration history (`PhysicalDataSource.cs:12-15`); `CosmosDatabaseName` is ignored for relational engines (`PhysicalDataSource.cs:16`). Making this a `record` gives value equality, so two resolutions of the same source compare equal.
- **Where it's used**: produced by [`DataSourceResolver`](#datasourceresolver) (`DataSourceResolver.cs:156-160` for the Default source and `DataSourceResolver.cs:200-204` for named ones) and handed back by `GetPhysical` (`DataSourceResolver.cs:63`); consumed downstream by [`PhysicalDbContextFactory`](#physicaldbcontextfactory) to open a context against the right database with the right migrations assembly, and by [`DbContextFactory.EnsureCreatedAsync`](#dbcontextfactory) to skip sources with no configured connection string (`DbContextFactory.cs:86-87`).

### Snapshot

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:25` · Level 2 · record (sealed, private nested)

- **What it is**: the immutable point-in-time view of [`EntityDataSourceRegistry`](#entitydatasourceregistry)'s state, with three members: `FrozenDictionary<string, (DataSourceKey Key, Type ConfigurationType)> Entities`, `FrozenSet<Assembly> ScannedAssemblies`, and the precomputed `IReadOnlyCollection<DataSourceKey> PhysicalSources` (`EntityDataSourceRegistry.cs:25-28`).
- **Depends on**: [`DataSourceKey`](#datasourcekey); `System.Collections.Frozen`, `System.Reflection.Assembly` (BCL).
- **Concept introduced, the lock-free volatile-snapshot pattern.** `[Rubric §12, Performance & Scalability]` assesses whether hot-path reads avoid contention; the registry holds `private volatile Snapshot? _snapshot` (`EntityDataSourceRegistry.cs:31`) and reads it without a lock, relying on `volatile` for the store/load barrier so every thread sees a consistent reference. Writes (the initial build and any rescan) take `Lock _rebuildLock` (`EntityDataSourceRegistry.cs:30`) for mutual exclusion, then atomically swap in a brand-new `Snapshot`. Because `FrozenDictionary`/`FrozenSet` are immutable once built, any number of readers share one snapshot with zero synchronization.
- **Walkthrough**
  - `Entities` maps an entity's full CLR type name to a tuple of the resolved [`DataSourceKey`](#datasourcekey) *and* the configuration type that produced it (`EntityDataSourceRegistry.cs:26`). The configuration type is not used for routing; it exists so the duplicate-registration failure can name both conflicting configuration classes in its message (`EntityDataSourceRegistry.cs:145-148`).
  - `ScannedAssemblies` records which assemblies the snapshot covered, so the registry can tell whether a lookup miss is genuine or merely a stale scan (`EntityDataSourceRegistry.cs:104`).
  - `PhysicalSources` is the distinct-key list computed once at build time (`EntityDataSourceRegistry.cs:160`). The remark on `GetPhysicalSourcesInUse` explains why it is materialized rather than projected per call (`EntityDataSourceRegistry.cs:75-80`): the outbox processor and the outbox cleanup service both ask for it on every poll cycle, and re-running `Select().Distinct()` over every registered entity allocated a fresh list each time, forever, on a loop that usually finds nothing to do.
- **Where it's used**: exclusively inside [`EntityDataSourceRegistry`](#entitydatasourceregistry): built by `BuildSnapshot` (`EntityDataSourceRegistry.cs:157-160`), swapped in `GetOrBuildSnapshot` (`EntityDataSourceRegistry.cs:94`) and `RescanIfAssembliesChanged` (`EntityDataSourceRegistry.cs:109-111`).
- **Caveats / not-in-source**: private nested type; it appears in the inventory because private nested types are included.

### CapturedState

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:312` · Level 3 · record (sealed, private nested)

- **What it is**: a private nested record inside [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) that carries everything captured *before* a save so it can be consumed *after* the save completes: the per-aggregate [`AggregateCapture`](#aggregatecapture) snapshots, the events eligible for in-process dispatch, the outbox rows backing those events, and a flag saying whether any integration events were also written (`DomainEventSaveChangesInterceptor.cs:307-316`).
- **Depends on**: [`AggregateCapture`](#aggregatecapture), [`IDomainEvent`](group-04-events-outbox.md#idomainevent), [`OutboxMessage`](group-04-events-outbox.md#outboxmessage).
- **Concept introduced, pre-save / post-save state handoff.** `[Rubric §6, CQRS & Event-Driven]` assesses whether state changes are announced as events with reliable delivery rather than leaked as ad-hoc side effects; here the interceptor runs in two phases (capture before the write, route after it), and `CapturedState` is the immutable value that bridges them instead of a mutable field a concurrent save could clobber. Its four positional members (`DomainEventSaveChangesInterceptor.cs:312-316`) are exactly what the post-save phase needs: `Captures` (the aggregates whose events must be removed, each with its snapshot), `LocalEvents` (what to dispatch in process), `LocalOutboxEntries` (the rows to mark processed once that dispatch succeeds), and `HasIntegrationEvents` (whether to wake the outbox processor for rows that deliberately stay unprocessed).
- **Walkthrough**: instances live per-`DbContext` in the interceptor's static `ConditionalWeakTable<DbContext, CapturedState>` (`DomainEventSaveChangesInterceptor.cs:48`) and are removed again in the post-save phase (`DomainEventSaveChangesInterceptor.cs:105`, `DomainEventSaveChangesInterceptor.cs:237`), so nothing keeps a context alive past its own lifetime. A stale entry left by a save that never completed is detected and discarded before the next capture (`DomainEventSaveChangesInterceptor.cs:209-226`). When a transaction is active the same instance is re-wrapped in a [`DeferredDispatch`](#deferreddispatch) and parked until commit (`DomainEventSaveChangesInterceptor.cs:244`).
- **Where it's used**: created in `CaptureEventsAndPersistToOutbox` (`DomainEventSaveChangesInterceptor.cs:200-201`), read back in `DispatchAndFinalizeAsync` (`DomainEventSaveChangesInterceptor.cs:234-237`), consumed in `FlushStateAsync` (`DomainEventSaveChangesInterceptor.cs:255`), and drained on the synchronous save path in `SavedChanges` (`DomainEventSaveChangesInterceptor.cs:102-110`).
- **Caveats / not-in-source**: private nested type; it surfaces in the inventory only because the tool includes private nested types. It is not part of the public API.

### IDataSourceResolver

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/IDataSourceResolver.cs:15` · Level 3 · interface

- **What it is**: the contract that maps a *logical* data source name (from a `[UseDatabase]` attribute, a module namespace, or a setting like `Outbox:DatabaseName`) to a *physical* [`DataSourceKey`](#datasourcekey), and hands back the resolved [`PhysicalDataSource`](#physicaldatasource) for such a key. Two members: `ResolveLogical(DataSource engine, string logicalName)` (`IDataSourceResolver.cs:27`) and `GetPhysical(DataSourceKey key)` (`IDataSourceResolver.cs:35`).
- **Depends on**: [`DataSource`](#datasource), [`DataSourceKey`](#datasourcekey), [`PhysicalDataSource`](#physicaldatasource).
- **Concept introduced, logical-to-physical collapse as the backward-compatibility guarantee.** `[Rubric §8, Data Architecture]` and `[Rubric §7, Microservices Readiness]` both apply, because routing is reconfigurable purely through settings. The interface comment (`IDataSourceResolver.cs:5-14`) states the collapse rule precisely: in a host with no `DataSources` configuration every logical name resolves to `Default`, yielding one DbContext per engine with an identical change tracker, FK constraints, transactions, and EF model as a plain single-database monolith. `ResolveLogical`'s contract (`IDataSourceResolver.cs:17-27`) spells out the collapse cases: a name with no `DataSources` entry, with no connection string for the engine, or whose connection equals the top-level one falls to `DataSourceKey.Default(engine)`; entries sharing a connection with each other collapse to one physical source named after the alphabetically-first logical name. `GetPhysical` (`IDataSourceResolver.cs:29-35`) is the reverse lookup and throws if handed a key that did not come from `ResolveLogical`.
- **Why it's built this way**: the collapse is what makes "build the monolith now, extract a service later" a configuration change rather than a rewrite ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). A single interface owns the rule, so no caller has to reimplement the defaulting logic.
- **Where it's used**: implemented by [`DataSourceResolver`](#datasourceresolver) and registered as a singleton (`DependencyInjection.cs:70`); injected into [`EntityDataSourceRegistry`](#entitydatasourceregistry) (`EntityDataSourceRegistry.cs:23`) to resolve each entity's derived logical name, into [`PhysicalDbContextFactory`](#physicaldbcontextfactory) and [`DbContextFactory`](#dbcontextfactory) to open connections (`Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:18`, `DbContextFactory.cs:21`), and into the inbox store and both event buses to locate their own database (`Persistence/Inbox/EfInboxStore.cs:20`, `Services/InProcessEventBus.cs:26`, `Services/BrokerEventBus.cs:33`).

### DataSourceResolver

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:13` · Level 4 · class (sealed, partial)

- **What it is**: the singleton implementation of [`IDataSourceResolver`](#idatasourceresolver). It builds the logical-to-physical map once at construction from the connection-string settings and the named `DataSources` entries, validates migrations-assembly conflicts, and then serves both lookups from in-memory dictionaries.
- **Depends on**: [`DataSource`](#datasource), [`DataSourceKey`](#datasourcekey), [`PhysicalDataSource`](#physicaldatasource), [`IDataSourceResolver`](#idatasourceresolver), [`IConnectionStringSettings`](group-14-module-system-composition.md#iconnectionstringsettings), [`DataSourcesSettings`](group-14-module-system-composition.md#datasourcessettings), [`DataSourceEntrySettings`](group-14-module-system-composition.md#datasourceentrysettings); `ILogger<T>`.
- **Concept introduced, eager and validated data-source resolution.** `[Rubric §8, Data Architecture]` (deliberate multi-database routing) and `[Rubric §7, Microservices Readiness]` ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), database-per-service). The resolver realizes the collapse rule described on [`IDataSourceResolver`](#idatasourceresolver). Two guardrails are worth calling out. First, conflicting `SQLServerMigrationsAssembly` declarations on logical names that collapse to the same physical database throw at startup (`DataSourceResolver.cs:243-245`), a loud fail-fast rather than a silent pick. Second, `[Rubric §13, Observability & Operability]` shows in the source-generated `[LoggerMessage]` `LogMigrationsAssemblyFallback` (`DataSourceResolver.cs:278-279`), which warns when a *named* SQL Server source has no dedicated migrations assembly and falls back to another database's, because that snapshot describes a different schema.
- **Walkthrough**
  - Constructor (`DataSourceResolver.cs:33-45`): validates its two settings arguments, then loops all three engines (`AllEngines` = CosmosDB, Sqlite, SQLServer, `DataSourceResolver.cs:15`) calling `BuildEngineMap`. State lives in two dictionaries: `_logicalToPhysical` keyed by `(engine, logical name)` (`DataSourceResolver.cs:18`) and `_physicalSources` keyed by [`DataSourceKey`](#datasourcekey) (`DataSourceResolver.cs:21`).
  - `BuildEngineMap` (`DataSourceResolver.cs:75`): `ClassifyEntries` splits the engine's named entries into "collapsed onto Default" and "grouped by connection identity" (`DataSourceResolver.cs:81`); `RegisterDefaultSource` then `RegisterNamedSource` populate the two dictionaries.
  - `ClassifyEntries` (`DataSourceResolver.cs:94`): computes a per-connection identity string via `GetIdentity` (`DataSourceResolver.cs:257-260`), where Cosmos identities append the database name because one account hosts many databases, relational engines use the connection string alone, and comparison is *ordinal*, so semantically-equal-but-textually-different connection strings deliberately do not collapse. Entries with no connection string for the engine are skipped entirely (`DataSourceResolver.cs:107-112`) because `ResolveLogical` already defaults on a map miss.
  - `RegisterDefaultSource` (`DataSourceResolver.cs:141`): registers the `Default` key for the engine, letting entries that collapsed onto it contribute an explicit migrations assembly (`DataSourceResolver.cs:148-154`), and maps each collapsed logical name onto that key (`DataSourceResolver.cs:162-165`).
  - `RegisterNamedSource` (`DataSourceResolver.cs:172`): names the physical key after the alphabetically-first member (`Order(...).First()`, `DataSourceResolver.cs:178`) so routing is deterministic regardless of config key order, then warns and falls back when a SQL Server source declares no migrations assembly of its own (`DataSourceResolver.cs:185-193`).
  - `ResolveLogical` (`DataSourceResolver.cs:48`): a `Default`-name short-circuit (`DataSourceResolver.cs:52-55`) then a dictionary lookup; a miss returns `DataSourceKey.Default(engine)` (`DataSourceResolver.cs:59`), the monolith default.
  - `GetPhysical` (`DataSourceResolver.cs:63`): a `_physicalSources` lookup that throws with an actionable message if the key was not produced by `ResolveLogical` (`DataSourceResolver.cs:65-68`).
  - `ResolveMigrationsAssembly` (`DataSourceResolver.cs:229`): returns null for non-SQL-Server engines or when no explicit value exists (`DataSourceResolver.cs:234-237`), and throws when logical names sharing a database declare conflicting assemblies (`DataSourceResolver.cs:239-246`).
- **Why it's built this way**: resolving eagerly at construction turns a misconfiguration into a startup failure rather than a mid-request surprise, and the deterministic canonical-name rule keeps routing stable across config orderings ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: registered as the singleton [`IDataSourceResolver`](#idatasourceresolver) (`DependencyInjection.cs:70`); consumed by [`EntityDataSourceRegistry`](#entitydatasourceregistry), the context factories, and [`DesignTimeDbContextHelper`](#designtimedbcontexthelper), which constructs its own instance with null logging for `dotnet ef` commands (`Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:71`).

### EntityDataSourceRegistry

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21` · Level 5 · class (sealed)

- **What it is**: the singleton implementation of [`IEntityDataSourceRegistry`](#ientitydatasourceregistry). It reflects over the configuration assemblies, finds every entity type configuration, derives each entity's physical database from the configuration class's attributes and the entity's namespace, and freezes the result into a lock-free lookup that it rescans lazily when new assemblies appear.
- **Depends on**: [`DataSourceKey`](#datasourcekey), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry), [`IDataSourceResolver`](#idatasourceresolver), [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype), [`NamespaceConventions`](#namespaceconventions), [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute), [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute), [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), [`Snapshot`](#snapshot) (nested); `System.Reflection`, `System.Collections.Frozen`, `Lock` (BCL).
- **Concept introduced, eager entity-to-data-source mapping.** `[Rubric §8, Data Architecture]` ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html): an entity lives in exactly one database). The doc comment (`EntityDataSourceRegistry.cs:8-20`) explains the design: the map is derived from *configuration classes*, not from EF model metadata, so it exists before any model is built; it is built lazily on first access and rescanned once on a lookup miss to pick up module assemblies loaded later; and duplicate registrations of one entity are tolerated when they agree on the physical source and rejected when they conflict.
- **Walkthrough**
  - `_rebuildLock` (`EntityDataSourceRegistry.cs:30`) and the `volatile _snapshot` (`EntityDataSourceRegistry.cs:31`) implement the pattern taught under [`Snapshot`](#snapshot): reads are lock-free, rebuilds are serialized and swap in a new immutable snapshot.
  - `GetDataSourceKey(Type)` (`EntityDataSourceRegistry.cs:34`) null-guards and forwards to the string overload via `FullName`; `GetDataSourceKey(string)` (`EntityDataSourceRegistry.cs:41`) is `TryGetDataSourceKey` plus a throw whose message names the exact remedy: add an `EntityTypeConfigurationSQLServer/Cosmos/Sqlite` for the entity in a discovered configuration assembly (`EntityDataSourceRegistry.cs:44-47`).
  - `TryGetDataSourceKey` (`EntityDataSourceRegistry.cs:50`): probes the current snapshot; on a miss it calls `RescanIfAssembliesChanged` once (`EntityDataSourceRegistry.cs:63`) and retries. This two-step check keeps the common hit path off the lock.
  - `GetPhysicalSourcesInUse` (`EntityDataSourceRegistry.cs:81`): returns the snapshot's precomputed `PhysicalSources` list, which is how migrations, `EnsureCreated`, and outbox draining enumerate this host's databases without allocating per call.
  - `GetOrBuildSnapshot` (`EntityDataSourceRegistry.cs:84`) double-checks `_snapshot` and builds under the lock; `RescanIfAssembliesChanged` (`EntityDataSourceRegistry.cs:98`) rebuilds only when the provider reports assemblies not already in `ScannedAssemblies` (`EntityDataSourceRegistry.cs:103-107`).
  - `BuildSnapshot` (`EntityDataSourceRegistry.cs:115`): for every loadable type in every configuration assembly, it skips abstract and open-generic types (`EntityDataSourceRegistry.cs:122-125`), finds the closed `IEntityTypeConfigurationBase<,>` interface (`EntityDataSourceRegistry.cs:127-132`), takes the entity type from the first generic argument (`EntityDataSourceRegistry.cs:134`), and calls `DeriveDataSourceKey`. A second configuration registering the same entity against a *different* key throws with a message naming both configuration classes and both keys (`EntityDataSourceRegistry.cs:141-152`); an agreeing duplicate is simply ignored. The frozen dictionary, the scanned-assembly set, and the distinct physical-source list are built together at the end (`EntityDataSourceRegistry.cs:157-160`).
  - `DeriveDataSourceKey` (`EntityDataSourceRegistry.cs:172`): reads the engine from [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and returns null when it is absent (`EntityDataSourceRegistry.cs:174-178`), deliberately skipping configurations that implement a provider interface directly instead of deriving from the attributed base classes. It then resolves the logical name in priority order `[UseDatabase]` then [`NamespaceConventions.GetModuleName`](#namespaceconventions) then `DataSourceKey.DefaultName` (`EntityDataSourceRegistry.cs:180-182`), and delegates the collapse to [`IDataSourceResolver.ResolveLogical`](#idatasourceresolver) (`EntityDataSourceRegistry.cs:184`).
  - `GetLoadableTypes` (`EntityDataSourceRegistry.cs:190`): wraps `assembly.GetTypes()` and tolerates `ReflectionTypeLoadException` by keeping the types that did load (`EntityDataSourceRegistry.cs:192-199`), mirroring module discovery, so a partially-loaded assembly does not abort the scan.
- **Why it's built this way**: building from configuration classes at startup rather than per-query means a missing or conflicting configuration surfaces early, which matters in a multi-database system where the alternative is a silent wrong-database read.
- **Where it's used**: registered as the singleton [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`DependencyInjection.cs:71`); consumed by [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention), [`DataSourceService`](#datasourceservice), [`DbContextFactory`](#dbcontextfactory), [`ApplicationDbContext`](#applicationdbcontext)'s model-building passes (`Persistence/DbContexts/ApplicationDbContext.cs:204`, `ApplicationDbContext.cs:366`), and the outbox/migrations enumeration.

### AuditSaveChangesInterceptor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:13` · Level 6 · class (sealed)

- **What it is**: an EF Core `SaveChangesInterceptor` that automatically stamps `CreatedOn/By` and `LastModifiedOn/By` on every [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) entry before the database write (`AuditSaveChangesInterceptor.cs:8-13`).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext), [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity); `SaveChangesInterceptor` (EF Core), `TimeProvider` (BCL).
- **Concept introduced, the EF Core `SaveChangesInterceptor` as a cross-cutting hook.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether audit and similar concerns are wired centrally rather than repeated per handler. An interceptor is a class EF calls at defined points in the save pipeline (`SavingChanges` before the write, `SavedChanges` after). Using an interceptor rather than overriding `SaveChangesAsync` means the logic runs for both the sync and async save paths, multiple interceptors compose through EF's own pipeline, and the concern lives in one class. `[Rubric §8, Data Architecture]` (audit stamped centrally, not per operation) and `[Rubric §30, Compliance/Privacy/Data Governance]` (a consistent audit trail supports accountability) also apply.
- **Walkthrough**
  - `SavingChangesAsync` (`AuditSaveChangesInterceptor.cs:16`) and `SavingChanges` (`AuditSaveChangesInterceptor.cs:28`): both call `StampAuditFields` when the context is an [`ApplicationDbContext`](#applicationdbcontext), then delegate to base. Stamping in the *saving* phase is what puts the values into the same SQL statement as the entity change.
  - `StampAuditFields` (`AuditSaveChangesInterceptor.cs:38`): reads `timeProvider.GetUtcNow().UtcDateTime` once (`AuditSaveChangesInterceptor.cs:40`) so every entity in one save shares a timestamp, and reads the context's `CurrentSaveUserId ?? default` (`AuditSaveChangesInterceptor.cs:41`), the per-save user handed in by [`ApplicationDbContext`](#applicationdbcontext) (`ApplicationDbContext.cs:70`) and reset to null in that method's `finally` so a later internal save cannot reuse the previous caller's identity (`ApplicationDbContext.cs:88-93`). It then walks `ChangeTracker.Entries<IAuditableEntity>()` (`AuditSaveChangesInterceptor.cs:43`).
    - **Added** (`AuditSaveChangesInterceptor.cs:47-52`): stamps all four fields from the resolved user id and timestamp; a null current user resolves to `default`, the sentinel for system-generated rows.
    - **Modified** (`AuditSaveChangesInterceptor.cs:53-58`): stamps only `LastModifiedBy`/`LastModifiedOn`, and marks `CreatedBy`/`CreatedOn` as `IsModified = false` (`AuditSaveChangesInterceptor.cs:54-55`) so an update can never overwrite the creation fields. That is the load-bearing invariant of this class.
    - **Detached / Unchanged / Deleted** (`AuditSaveChangesInterceptor.cs:59-63`): no-op. Soft delete is a domain concern (the entity sets `IsDeleted = true`, which lands it in the `Modified` branch), not something this interceptor special-cases.
- **Why it's built this way**: centralizing audit in an interceptor guarantees no handler can forget the stamps; injecting `TimeProvider` rather than reading `DateTime.UtcNow` makes the stamps deterministic under test (`[Rubric §14, Testability]`). The one path that legitimately escapes the interceptor is the change-tracker-bypassing bulk update, which is why [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) re-stamps the modification fields itself (`EFRepository.cs:125-136`).
- **Where it's used**: registered as a singleton in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:54`) and added to every context's options alongside [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) in `ApplicationDbContext.OnConfiguring` (`ApplicationDbContext.cs:183-185`); the design-time helper registers its own copy (`Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:68`).

### DeferredDispatch

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:319` · Level 6 · record (sealed, private nested)

- **What it is**: a two-member private record pairing a [`CapturedState`](#capturedstate) with the [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) instance that captured it, representing one unit of post-save work parked until the surrounding transaction commits (`DomainEventSaveChangesInterceptor.cs:318-319`).
- **Depends on**: [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor), [`CapturedState`](#capturedstate).
- **Concept introduced, carrying the owner so a static entry point can flush instance work.** `[Rubric §1, SOLID]` (dependency direction) and `[Rubric §6, CQRS & Event-Driven]` (delivery ordered after commit) both apply. The deferred list is stored in a *static* `ConditionalWeakTable<DbContext, List<DeferredDispatch>>` (`DomainEventSaveChangesInterceptor.cs:55`) and drained by the *static* `FlushDeferredAsync`, which [`DbContextFactory`](#dbcontextfactory) calls after a successful commit. Flushing needs the interceptor's injected dispatcher and outbox signal, which a static method does not have. Rather than give the factory a DI edge back to the interceptor, each entry carries its own `Owner` and the flush loop calls `dispatch.Owner.FlushStateAsync(...)` (`DomainEventSaveChangesInterceptor.cs:127-128`). The comment at `DomainEventSaveChangesInterceptor.cs:50-54` states exactly that intent.
- **Walkthrough**: created in `DispatchAndFinalizeAsync` when `context.Database.CurrentTransaction is not null` (`DomainEventSaveChangesInterceptor.cs:239-245`), appended to the per-context list via `DeferredTable.GetOrCreateValue(context).Add(...)` (`DomainEventSaveChangesInterceptor.cs:244`); consumed in `FlushDeferredAsync` (`DomainEventSaveChangesInterceptor.cs:120-129`) or discarded wholesale by `DropDeferred` (`DomainEventSaveChangesInterceptor.cs:137`). It is a `List` rather than a single entry because several saves can occur inside one transaction.
- **Where it's used**: only inside [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor); the flush and drop entry points are called by [`DbContextFactory`](#dbcontextfactory) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:381` after a successful commit, `DbContextFactory.cs:300` on rollback, `DbContextFactory.cs:399` when a cancellation aborts the rollback itself, and `DbContextFactory.cs:440` on the reset-for-retry path).
- **Caveats / not-in-source**: private nested type; it surfaces in the inventory only because private nested types are included.

### DomainEventSaveChangesInterceptor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:38` · Level 6 · class (sealed, partial)

- **What it is**: the EF Core interceptor that implements the producer end of the transactional outbox. Before the write it captures domain events from aggregate roots and serializes each to an [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row in the same transaction; after the write it *routes* them, dispatching local events in process and leaving integration-event rows for the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) to publish; and when a transaction is open it defers all of that until after commit.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext), [`AggregateCapture`](#aggregatecapture), [`CapturedState`](#capturedstate) and [`DeferredDispatch`](#deferreddispatch) (nested), [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot), [`IDomainEvent`](group-04-events-outbox.md#idomainevent), [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent), [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher), [`IOutboxSignal`](group-04-events-outbox.md#ioutboxsignal), [`OutboxMessage`](group-04-events-outbox.md#outboxmessage), [`OutboxFinalizer`](group-04-events-outbox.md#outboxfinalizer); `SaveChangesInterceptor`, `ConditionalWeakTable`, `ILogger<T>` (EF Core / BCL).
- **Concept introduced, the routed transactional outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).** `[Rubric §6, CQRS & Event-Driven]` (state changes announced as events) and `[Rubric §29, Resilience & Business Continuity]` (at-least-once delivery). There are three rules layered on top of each other, all stated in the class doc comment (`DomainEventSaveChangesInterceptor.cs:12-34`):
  1. **Transactional persistence.** Every captured event becomes an [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) added to the context *before* `base.SaveChangesAsync`, so the rows commit in the same database transaction as the aggregate change. A crash between the write and the dispatch cannot lose an event.
  2. **Routing by event kind.** Local domain events get an outbox row *and* an in-process dispatch, after which their rows are marked processed. Events implementing [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) get a row and **no** in-process dispatch: their rows stay unprocessed so the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) publishes them through `IMessageBus`, letting the registered transport (in process for the monolith, broker for an extracted service) decide delivery. The comment records why this matters (`DomainEventSaveChangesInterceptor.cs:22-24`): before this routing existed, `AddDomainEvent(integrationEvent)` dispatched locally and marked the row processed, so the event silently never reached the wire.
  3. **Deferral under a transaction.** When the save runs inside the Transactional decorator's transaction, all post-save work is parked as a [`DeferredDispatch`](#deferreddispatch) and flushed by [`DbContextFactory`](#dbcontextfactory) only after a successful commit (`DomainEventSaveChangesInterceptor.cs:26-33`). That keeps handler side effects (email, cache writes, pushes) from acting on state that may still roll back, and keeps EF execution-strategy retries from dispatching the same events once per attempt.
- **Walkthrough**
  - **Two `ConditionalWeakTable`s.** `StateTable` (`DomainEventSaveChangesInterceptor.cs:48`) associates the per-save [`CapturedState`](#capturedstate) with the context instance; `DeferredTable` (`DomainEventSaveChangesInterceptor.cs:55`) holds the parked [`DeferredDispatch`](#deferreddispatch) list. Weak tables mean neither structure keeps a context alive, so state cleans up automatically on disposal (`DomainEventSaveChangesInterceptor.cs:43-47`).
  - **`SavingChangesAsync` / `SavingChanges`** (`DomainEventSaveChangesInterceptor.cs:58`, `DomainEventSaveChangesInterceptor.cs:70`): both call `CaptureEventsAndPersistToOutbox` when the context is an [`ApplicationDbContext`](#applicationdbcontext); capture must happen before the SQL write, in the same unit of work.
  - **`CaptureEventsAndPersistToOutbox`** (`DomainEventSaveChangesInterceptor.cs:143`): first calls `DiscardAbandonedCapture`, then collects tracked [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) entries carrying pending events into one [`AggregateCapture`](#aggregatecapture) each (`DomainEventSaveChangesInterceptor.cs:153-156`) and flattens their events (`DomainEventSaveChangesInterceptor.cs:161`). When `context.SupportsOutbox` (`DomainEventSaveChangesInterceptor.cs:167`) it builds one row per event via `OutboxMessage.FromDomainEvent`, adds it to the set, and sorts the event into the integration bucket (flag only) or the local bucket (event plus its row) (`DomainEventSaveChangesInterceptor.cs:172-191`). The `Add` is intentionally the synchronous `DbSet` call; the `VSTHRD103` pragma (`DomainEventSaveChangesInterceptor.cs:176-178`) records that `AddAsync` exists only for special value generators. When the context has no outbox table (`ApplicationDbContext.SupportsOutbox` defaults to true at `Persistence/DbContexts/ApplicationDbContext.cs:63` and is overridden to false at `Persistence/DbContexts/CosmosDbContext.cs:69`) nothing can carry an integration event to the bus, so the legacy behavior of dispatching everything in process is kept (`DomainEventSaveChangesInterceptor.cs:193-198`). The result is stored as a [`CapturedState`](#capturedstate) (`DomainEventSaveChangesInterceptor.cs:200-201`).
  - **`DiscardAbandonedCapture`** (`DomainEventSaveChangesInterceptor.cs:209-226`): the retry guard. A `SavingChanges` that never reached `SavedChanges` (a failed save followed by an execution-strategy retry of the same operation) left its outbox rows tracked as `Added` and its events still on the aggregates; re-capturing on top of that would write a second row per event and publish every integration event twice (`DomainEventSaveChangesInterceptor.cs:145-148`). The method drops the stale state and detaches every `Added` [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) on the context, which is safe because this interceptor is the only writer of outbox rows and a completed save leaves none `Added` (`DomainEventSaveChangesInterceptor.cs:216-225`).
  - **`SavedChangesAsync`** (`DomainEventSaveChangesInterceptor.cs:81`): the post-write entry point, calls `DispatchAndFinalizeAsync`.
  - **`SavedChanges`** (the synchronous path, `DomainEventSaveChangesInterceptor.cs:100`): cannot await the dispatcher, so it relies entirely on the outbox. For outbox-capable contexts it removes the state, removes the captured events from their aggregates (preventing the duplicate re-capture a later async save used to produce) and signals the processor if there is anything pending (`DomainEventSaveChangesInterceptor.cs:102-110`). Contexts without outbox support keep the legacy no-op so a later async save can still deliver their events (`DomainEventSaveChangesInterceptor.cs:93-99`).
  - **`DispatchAndFinalizeAsync`** (`DomainEventSaveChangesInterceptor.cs:232`): pulls and removes the state, then branches on `context.Database.CurrentTransaction`. With a transaction open it removes the captured events *now* (so a second save inside the same transaction cannot re-capture them, `DomainEventSaveChangesInterceptor.cs:241-243`), parks a [`DeferredDispatch`](#deferreddispatch), and returns. Otherwise it flushes immediately.
  - **`FlushStateAsync`** (`DomainEventSaveChangesInterceptor.cs:255`): dispatches local events through [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) (`DomainEventSaveChangesInterceptor.cs:259-260`), removes the captured events, marks the local rows processed via [`OutboxFinalizer`](group-04-events-outbox.md#outboxfinalizer) (`DomainEventSaveChangesInterceptor.cs:264`), and signals the processor when integration events are waiting (`DomainEventSaveChangesInterceptor.cs:266-267`). A `catch` logs and signals so the unprocessed rows get picked up (`DomainEventSaveChangesInterceptor.cs:269-277`), and a `finally` removes them idempotently (`DomainEventSaveChangesInterceptor.cs:278-282`) so a dispatch failure never leaves stale events on an aggregate.
  - **`ClearDomainEvents`** (`DomainEventSaveChangesInterceptor.cs:291-295`): removes exactly the snapshotted events per [`AggregateCapture`](#aggregatecapture), the mechanism explained in that type's section.
  - **`FlushDeferredAsync` / `DropDeferred`** (`DomainEventSaveChangesInterceptor.cs:120`, `DomainEventSaveChangesInterceptor.cs:137`): the `internal static` pair [`DbContextFactory`](#dbcontextfactory) calls after commit and on rollback. The flush comment notes a missed flush is safe (`DomainEventSaveChangesInterceptor.cs:117-118`): the rows are still there unprocessed and the outbox delivers them.
  - **`LogDispatchError`** (`DomainEventSaveChangesInterceptor.cs:297-298`): a source-generated `[LoggerMessage]` warning, which is why the class is `partial` (`[Rubric §13, Observability & Operability]`).
- **Why it's built this way**: [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) requires at-least-once delivery, so the durable row is written in the same transaction and the in-process dispatch is only a fast path that avoids a round trip. Splitting integration events out of that fast path is what makes the same `AddDomainEvent` call correct in both the monolith and an extracted service ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). Deferring until after commit resolves the one remaining ordering hazard, a handler observing state that later rolls back.
- **Where it's used**: registered as a singleton in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:55`, stateless because per-save state lives in the weak tables, per the comment at `DependencyInjection.cs:52-53`) and added to every context's options alongside [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor) in `ApplicationDbContext.OnConfiguring` (`ApplicationDbContext.cs:183-185`); its deferred work is driven by [`DbContextFactory.ExecuteInTransactionAsync`](#dbcontextfactory) (`DbContextFactory.cs:379-383`) and its rows are drained by the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor).

### EFReadRepository<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:15` · Level 6 · class (internal)

- **What it is**: the EF Core implementation of [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype): the full read surface (get all, arbitrary projection, get by id, get by ids, count, exists, lookup projection) with no mutation. It is the query half of the repository family.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (implements it), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype); EF Core's `DbContext`/`DbSet<TEntity>` plus `ConcurrentDictionary` and `System.Linq.Expressions` from the BCL.
- **Concept introduced, read-side query hygiene and N+1 avoidance.** `[Rubric §12, Performance & Scalability]` assesses deliberate query shaping, and this class makes several such choices visible:
  1. **Tracking control**: `Table` is tracked (`EFReadRepository.cs:245`), `TableNoTracking` calls `AsNoTracking()` (`EFReadRepository.cs:248`), and every get method defaults `asTracking: false`, so read paths do not pay change-tracker cost.
  2. **Split-query heuristic**: `ApplyIncludes` (`EFReadRepository.cs:262-278`) opts a query into `AsSplitQuery()` the moment any include targets a collection navigation, avoiding the cartesian row explosion EF's default single-query JOIN would cause. Whether a path is a collection navigation is decided by a reflection walk cached per path in `CollectionIncludeCache` (`EFReadRepository.cs:284-305`), so the reflection runs once per distinct include string and an unknown segment falls back to EF's own include validation (`EFReadRepository.cs:293-295`).
  3. **Cached projection trees**: `GetAllForLookupAsync` (`EFReadRepository.cs:74`) projects `Id` plus a named property into [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype); the expression is built once per `(EntityType, PropertyName)` pair by `GetOrBuildLookupSelector` (`EFReadRepository.cs:104-126`) and stored in `LookupSelectorCache` (`EFReadRepository.cs:99`), so repeated lookups pay only a dictionary hit. Non-string name properties are wrapped in a `ToString()` call and strings are coalesced to empty (`EFReadRepository.cs:113-117`).
  4. **Provider-aware existence check**: `AnyAsync` (`EFReadRepository.cs:233-239`) uses EF's `AnyAsync`, which short-circuits at the first match, and falls back to `CountAsync(predicate) > 0` **only** on Cosmos, detected by sniffing `Database.ProviderName` (`EFReadRepository.cs:241-242`). The remark (`EFReadRepository.cs:226-232`) records why: the Cosmos provider generates invalid SQL for a predicated `AnyAsync`, and applying that workaround everywhere cost O(matches) on providers that never needed it.
- **Walkthrough**: `_context` (`EFReadRepository.cs:21`) and the `Entities` accessor (`EFReadRepository.cs:23`, `_context.Set<TEntity>()`) are the starting point for every query. `GetAllAsync` (`EFReadRepository.cs:26-54`) composes tracking, `IgnoreQueryFilters`, includes, `where`, `orderBy`, and an optional same-type `select` projection. `GetProjectedAsync<TResult>` (`EFReadRepository.cs:57-71`) is the arbitrary-shape projection: it takes a required selector to any `TResult`, so a caller can pull two columns instead of whole entities. `GetByIdsAsync` (`EFReadRepository.cs:129-151`) materializes the id set once, short-circuits on empty, and issues a single `Contains` query rather than one round trip per id. `GetByIdAsync` (`EFReadRepository.cs:154`) uses `FindAsync` for the identity-map fast path; the includes overload (`EFReadRepository.cs:164`) falls back to `FirstOrDefaultAsync`. The four `Table*` properties (`EFReadRepository.cs:245-254`) hand callers explicit control over tracking and single-versus-split query strategy.
- **Why it's built this way**: the class is `internal` and `virtual` throughout, so the public contract is the interface and the profiling decorator can wrap or a derived class override members. Consumers never new it up directly; the factory does.
- **Where it's used**: created by [`RepositoryFactory.CreateReadOnly`](#repositoryfactory) for every read repository resolution (`Persistence/Repositories/Factory/RepositoryFactory.cs:54-55`), optionally wrapped by [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype); it is also the base class of the read-write [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype), and it is reached from application code through [`UnitOfWork.GetReadRepository`](#unitofwork) (`Persistence/UnitOfWork.cs:62`).

### EFReadRepositoryDecorator<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepositoryDecorator.cs:15` · Level 6 · class (internal)

- **What it is**: a decorator that wraps every [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) operation in a MiniProfiler timing step, adding per-call timing visibility without touching the query logic (`EFReadRepositoryDecorator.cs:8-15`).
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype), [`ProfilingHelper`](#profilinghelper).
- **Concept, the Decorator pattern applied to the repository layer for observability**, the same composition idea that drives the CQRS decorator pipeline (see [Group 05](group-05-cqrs-pipeline.md)). `[Rubric §2, Design Patterns]` assesses whether cross-cutting behavior is layered by composition rather than baked into the core; `[Rubric §13, Observability & Operability]` assesses timing visibility. Note that the decorator implements the interface rather than deriving from [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype), so it composes with any future implementation.
- **Walkthrough**: the `_inner` field (`EFReadRepositoryDecorator.cs:21`) holds the wrapped repository and null-guards at construction; every read method delegates through `ProfilingHelper.ProfileAsync(ClassName, nameof(Method), () => _inner.Method(...))` (for example `EFReadRepositoryDecorator.cs:31-32` and the projection overload at `EFReadRepositoryDecorator.cs:34-40`), with `ClassName` fixed to the literal `"EFReadRepository"` (`EFReadRepositoryDecorator.cs:20`) so profiler steps are labelled after the class doing the work, not the wrapper. `ProfilingHelper.BeginStep` composes the label as `MMCA.Common.Infrastructure.{class}: {method}` and returns null when no profiler is active (`Persistence/ProfilingHelper.cs:11-12`), which is what makes the decorator free when profiling is off. The four `Table*` queryable properties (`EFReadRepositoryDecorator.cs:83-86`) pass straight through to `_inner` with no wrapping, since they return a deferred `IQueryable` and there is nothing to time at that point.
- **Where it's used**: applied by [`RepositoryFactory.CreateReadOnly`](#repositoryfactory) as the outer layer over [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) only when `IApplicationSettings.UseMiniProfiler` is true (`Persistence/Repositories/Factory/RepositoryFactory.cs:57-62`); it is also the base class of [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype).

### EFRepositoryDecorator<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:14` · Level 7 · class (internal sealed)

- **What it is**: the MiniProfiler timing decorator for the read-write [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype). It extends [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) (inheriting the profiled read methods) and adds profiled write methods (`EFRepositoryDecorator.cs:7-18`).
- **Depends on**: [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) (base), [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype), [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity), [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`ProfilingHelper`](#profilinghelper).
- **Concept, the Decorator pattern from [`EFReadRepositoryDecorator`](#efreadrepositorydecoratortentity-tidentifiertype) extended to writes.** `[Rubric §13, Observability & Operability]` assesses granular timing of persistence. The class passes the same `inner` twice: once to the base constructor as an `IReadRepository` and once into its own `_inner` field as the wider `IRepository` (`EFRepositoryDecorator.cs:14-21`), so read calls reuse the inherited wrappers and write calls get their own.
- **Walkthrough**: `ClassName` is the literal `"EFRepository"` (`EFRepositoryDecorator.cs:20`) so write steps are labelled distinctly from the inherited read steps. `AddAsync`, `AddRangeAsync`, `UpdateAsync`, `ExecuteDeleteAsync`, `ExecuteUpdateAsync`, and `SaveChangesAsync` each wrap `_inner` in `ProfilingHelper.ProfileAsync` (`EFRepositoryDecorator.cs:23-33`, `EFRepositoryDecorator.cs:48-59`, `EFRepositoryDecorator.cs:64-66`); the synchronous `Save` uses `ProfilingHelper.Profile` (`EFRepositoryDecorator.cs:61-62`) and the synchronous `UpdateRange` opens a `BeginStep` scope with `using` (`EFRepositoryDecorator.cs:35-39`). The one deliberate exception is the pair of `SetOriginalRowVersion` overloads (`EFRepositoryDecorator.cs:41-46`), which pass straight through unprofiled because they are in-memory metadata operations with no I/O worth timing.
- **Where it's used**: applied by [`RepositoryFactory.Create`](#repositoryfactory) over [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) when `UseMiniProfiler` is enabled (`Persistence/Repositories/Factory/RepositoryFactory.cs:33-38`).

### EFRepository<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:20` · Level 8 · class (internal sealed)

- **What it is**: the concrete read-write repository. It extends [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) (inheriting the entire query surface) and adds mutation: `AddAsync`, `AddRangeAsync`, `UpdateAsync`, `UpdateRange`, two `SetOriginalRowVersion` overloads, `ExecuteDeleteAsync`, `ExecuteUpdateAsync`, `Save`, and `SaveChangesAsync`.
- **Depends on**: [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) (base), [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) (implements it), [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity), [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice); EF Core's `DbContext` and `TimeProvider` (BCL).
- **Concept introduced, safe update of possibly-tracked entities and defensive context hygiene.** `[Rubric §8, Data Architecture]` assesses correct EF usage that avoids duplicate-tracking and broken-context traps. `UpdateAsync` (`EFRepository.cs:51-69`) handles the common disconnected-entity trap: calling `DbSet.Update` on an entity whose key is already tracked throws. The fix (`EFRepository.cs:56-62`) does an O(1) identity-map lookup via `Entities.Local.FindEntry(entity.Id)`, which never falls back to the database, and when the entity is already tracked patches it in place with `trackedEntry.CurrentValues.SetValues(entity)`; only otherwise does it call `Entities.Update(entity)`. On `DbUpdateException`, `GetFullErrorTextAndRollbackEntityChanges` (`EFRepository.cs:153-179`) resets all Added/Modified entries to `Unchanged`, tolerating entries that cannot make that transition (`EFRepository.cs:160-167`), persists the reset so the context is left usable, and returns the full error text for the rethrown exception.
- **Concept introduced, the set-based update that still stamps audit.** `[Rubric §12, Performance & Scalability]` and `[Rubric §10, Cross-Cutting Concerns]`. `ExecuteUpdateAsync` (`EFRepository.cs:112-139`) issues one `UPDATE ... SET ... WHERE ...` statement, which is the contention-proof way to express a guarded counter change: the contract documents that zero rows affected means the guard did not hold and that two racing callers can never both win, with no rowversion retry loop, because the database arbitrates (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:199-217`). Because the statement bypasses the change tracker it also bypasses [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor), so the method re-adds the modification stamps itself: `LastModifiedOn` from the injected `TimeProvider` (falling back to `TimeProvider.System`) and `LastModifiedBy` from [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), each only when the caller did not already assign that property (`EFRepository.cs:125-136`). Domain events are still bypassed, which is why the contract carries an explicit warning (`IRepository.cs:206-212`).
- **Walkthrough**
  - Primary constructor (`EFRepository.cs:20-24`): takes the `DbContext` plus an optional `TimeProvider` and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice). The remark (`EFRepository.cs:15-19`) states that the two optional services exist only for `ExecuteUpdateAsync`'s audit stamping and that direct construction in tests degrades to the system clock with no user stamp.
  - `AddAsync` / `AddRangeAsync` (`EFRepository.cs:29-40`): null-guarded wrappers over `Entities.AddAsync` / `AddRangeAsync`.
  - `UpdateRange` (`EFRepository.cs:72-76`): bulk `Entities.UpdateRange`, with no local-tracking check (the caller owns consistency).
  - `SetOriginalRowVersion`, two overloads (`EFRepository.cs:79-100`): plants the client's last-known token as `_context.Entry(entity).Property(nameof(AuditableBaseEntity<>.RowVersion)).OriginalValue`, so EF's optimistic-concurrency check compares it against the stored value on the next save; both no-op when the row version is null or empty. The second overload accepts any [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) child entity (`EFRepository.cs:91-100`), which is how a caller can concurrency-check a child without a second generic parameter for the child's identifier type ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
  - `ExecuteDeleteAsync` (`EFRepository.cs:103-109`): EF bulk delete (`Where(where).ExecuteDeleteAsync`) that bypasses the change tracker, used for hard purges such as outbox pruning; the contract warns that it triggers no domain events, audit stamps, or soft-delete behavior (`IRepository.cs:187-194`).
  - `ExecuteUpdateAsync` (`EFRepository.cs:112-139`): builds an [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity), runs the caller's `setProperties` delegate against it, rejects an empty assignment list with `ArgumentException` (`EFRepository.cs:120-123`), applies the audit stamps, and hands `builder.Apply` to EF (`EFRepository.cs:138`).
  - `Save` / `SaveChangesAsync` (`EFRepository.cs:142-146`): delegate to the context; used by callers that operate outside the unit of work.
- **Why it's built this way**: `internal sealed` keeps the implementation off the public API; callers only ever see [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype). The tracked-entity detection avoids an EF anti-pattern that commonly bites teams attaching request-scoped disconnected entities to a live context, and the optional-service constructor keeps the type newable in a unit test without a DI container.
- **Where it's used**: instantiated by [`RepositoryFactory.Create`](#repositoryfactory) through a cached compiled `ObjectFactory` (`Persistence/Repositories/Factory/RepositoryFactory.cs:30-31`, `RepositoryFactory.cs:80-84`) and reached through [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) by command handlers via [`UnitOfWork.GetRepository`](#unitofwork) (`Persistence/UnitOfWork.cs:42`).

### PushNotificationConfiguration

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:15` · Level 8 · internal sealed class

- **What it is**: the EF Core mapping for the [`PushNotification`](group-10-notifications.md#pushnotification) aggregate root, the broadcast record of a notification sent to a set of recipients. It maps that entity into the `Notification` schema and shapes its scalar columns (`PushNotificationConfiguration.cs:15`).
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) (the engine-fixing base it extends, `PushNotificationConfiguration.cs:16`); the domain type [`PushNotification`](group-10-notifications.md#pushnotification) and its [`PushNotificationStatus`](group-10-notifications.md#pushnotificationstatus) enum (`PushNotificationConfiguration.cs:3`); the [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) it is annotated with (`PushNotificationConfiguration.cs:14`); EF Core's `EntityTypeBuilder<TEntity>` and `IEntityTypeConfiguration<TEntity>` machinery (BCL/NuGet, `PushNotificationConfiguration.cs:1-2`).
- **Concept introduced, overriding the auto-derived database and schema with `[UseDatabase]`.** By default this framework derives an entity's physical routing from its namespace: the SQL schema and the logical database name both come from the namespace segment before `Domain` (see [`NamespaceConventions`](#namespaceconventions), `NamespaceConventions.cs:16`). That rule works cleanly for a module such as `MMCA.Store.Sales.Domain.Orders` (schema and database `Sales`), but it misfires for framework-owned entities: `PushNotification` lives in `MMCA.Common.Domain.Notifications.PushNotifications`, so the segment before `Domain` is `Common` and the entity would land in a `Common` schema and a `Common` database. Two overrides fix that. The class-level `[UseDatabase("Notification")]` (`PushNotificationConfiguration.cs:14`) replaces the derived *logical database* name, so hosts that declare a `DataSources:Notification` connection string get a dedicated notification database, and hosts that do not simply collapse these tables onto the `Default` source (single-database behavior stays intact; see [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) and [`DataSourceResolver`](#datasourceresolver)). The `builder.ToTable(...)` call inside `Configure` (`PushNotificationConfiguration.cs:24`) replaces the derived *SQL schema* from `Common` to `Notification`. Together they place the notification tables under their own schema and let them route to their own database when one is configured. `[Rubric §8, Data Architecture]` assesses how deliberately data is partitioned, keyed, and typed at the storage boundary; here schema isolation and a string-persisted status enum are chosen explicitly rather than left to convention. `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without a rewrite; routing notifications to a named logical database is exactly the boundary that lets the notification store move to its own physical database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) with no code change.
- **Walkthrough**
  - **`[UseDatabase("Notification")]`** (`PushNotificationConfiguration.cs:14`): the class-level attribute read eagerly by [`EntityDataSourceRegistry`](#entitydatasourceregistry) to route every `PushNotification` to the `Notification` logical database.
  - **Base class** (`PushNotificationConfiguration.cs:16`): extends [`EntityTypeConfigurationSQLServer<PushNotification, PushNotificationIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype), a thin shim carrying `[UseDataSource(DataSource.SQLServer)]` that delegates all mapping logic to [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype).
  - **`base.Configure(builder)`** (`PushNotificationConfiguration.cs:21`): runs the shared engine-aware pipeline. That base (`EntityTypeConfiguration.cs:38`) null-checks the builder, calls its own base to exclude the in-memory `DomainEvents` collection from mapping for aggregate roots (`EntityTypeConfigurationBase.cs:25-33`), reads the `[UseDataSource]` engine, and for SQL Server sets the table name to the entity name, the schema to the derived module name (here `Common`), the primary key, and, because `PushNotification` carries [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), `Property(Id).ValueGeneratedOnAdd()` (`EntityTypeConfiguration.cs:66-73`). Note what this base does *not* do: it configures no soft-delete filter, audit columns, or `RowVersion` token here; those cross-cutting concerns are stamped and filtered centrally by [`ApplicationDbContext`](#applicationdbcontext), not in this configuration.
  - **`builder.ToTable(nameof(PushNotification), "Notification")`** (`PushNotificationConfiguration.cs:24`): re-maps the table (still named `PushNotification`) into the `Notification` schema, overriding the `Common` schema the base just derived.
  - **`Title`** (`PushNotificationConfiguration.cs:26-28`): required, `HasMaxLength(200)`.
  - **`Body`** (`PushNotificationConfiguration.cs:30-32`): required, `HasMaxLength(2000)`.
  - **`SentByUserId`** (`PushNotificationConfiguration.cs:34-35`) and **`RecipientCount`** (`PushNotificationConfiguration.cs:37-38`): both required.
  - **`Status`** (`PushNotificationConfiguration.cs:40-43`): required, `HasConversion<string>()` with `HasMaxLength(20)`. The [`PushNotificationStatus`](group-10-notifications.md#pushnotificationstatus) enum is persisted as its member name rather than an ordinal integer, so the stored value is self-describing and reordering or inserting enum members never silently corrupts existing rows.
- **Why it's built this way**: the auto-derivation convention keeps per-module entities zero-configuration, but framework-owned entities under `MMCA.Common.Domain` need an explicit escape hatch so they do not all pile into a `Common` schema and database. Keeping the two overrides (database via attribute, schema via `ToTable`) side by side in one small configuration makes the notification store's placement obvious and lets it become a real database-per-service source when a host opts in ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Persisting the status as a string is a maintainability choice that trades a couple of bytes per row for migration-safe enum evolution.
- **Where it's used**: discovered by assembly scan and applied by [`ApplicationDbContext`](#applicationdbcontext) during model building, and read up front by [`EntityDataSourceRegistry`](#entitydatasourceregistry) to route `PushNotification` to its physical source. The mapped table backs the SignalR push pipeline (`SignalRPushNotificationSender`, `NotificationHub`) and the per-user inbox rows configured by its sibling below.

### UserNotificationConfiguration

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/UserNotificationConfiguration.cs:15` · Level 8 · internal sealed class

- **What it is**: the EF Core mapping for the [`UserNotification`](group-10-notifications.md#usernotification) aggregate root, one per-user inbox row per notification, carrying read/unread state. It shares the exact placement shape of its sibling [`PushNotificationConfiguration`](#pushnotificationconfiguration) and adds two filtered indexes that make the inbox queries cheap (`UserNotificationConfiguration.cs:15`).
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) (base, `UserNotificationConfiguration.cs:16`); the domain type [`UserNotification`](group-10-notifications.md#usernotification) (`UserNotificationConfiguration.cs:3`); [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) (`UserNotificationConfiguration.cs:14`); EF Core's `EntityTypeBuilder<TEntity>` (BCL/NuGet, `UserNotificationConfiguration.cs:1-2`).
- **Concept introduced, filtered (partial) unique indexes that respect soft-delete.** The `[UseDatabase("Notification")]` routing and the `ToTable(..., "Notification")` schema override are identical to the sibling above (see [`PushNotificationConfiguration`](#pushnotificationconfiguration) for the full teaching of that shape); this section focuses on what differs, the indexing. Every entity in this framework is soft-deleted (rows set `IsDeleted = true`, never physically removed), so a plain unique index on `(UserId, PushNotificationId)` would forbid a user from ever re-receiving a notification whose prior inbox row was soft-deleted. A **filtered index** (`HasFilter("[IsDeleted] = 0")`) sidesteps that: the uniqueness constraint applies only to live rows, and the second, non-unique filtered index narrows the physical index to just the non-deleted rows the unread-count query actually scans. `[Rubric §8, Data Architecture]` covers indexing strategy as a first-class storage concern; the deliberate composite keys here map directly to the two access patterns (one-inbox-row-per-user-per-notification, and unread lookups). `[Rubric §12, Performance & Scalability]` assesses whether hot read paths are supported by targeted indexes; the `(UserId, IsRead)` filtered index is sized for the notification-badge count that every authenticated page issues. `[Rubric §30, Compliance, Privacy & Data Governance]` covers how governance rules like soft-delete are honored at the storage layer; the `IsDeleted = 0` filter keeps soft-deleted inbox history out of both the uniqueness rule and the query index without hard-deleting it.
- **Walkthrough**
  - **`[UseDatabase("Notification")]`** and **base class** (`UserNotificationConfiguration.cs:14-16`): same routing and same [`EntityTypeConfigurationSQLServer<...>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) base as the sibling, so `UserNotification` lands in the same `Notification` logical database, and (because it carries [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute)) gets a store-generated identity key from the base pipeline.
  - **`base.Configure(builder)` + `ToTable`** (`UserNotificationConfiguration.cs:21-24`): identical mechanism to the sibling, mapping the `UserNotification` table into the `Notification` schema over the auto-derived `Common` schema.
  - **`UserId`** (`UserNotificationConfiguration.cs:26-27`) and **`PushNotificationId`** (`UserNotificationConfiguration.cs:29-30`): both required. These are a scalar foreign-key column pair, not an EF navigation, so the two notification entities stay decoupled and survive being routed to a separate physical source (cross-source relationships degrade to scalar FKs; the link is resolved by navigation populators, not a database constraint).
  - **`IsRead`** (`UserNotificationConfiguration.cs:32-34`): required with `HasDefaultValue(false)`, so a freshly inserted inbox row is unread at the database default even if the column is not written.
  - **`ReadOn`** (`UserNotificationConfiguration.cs:36`): mapped as-is (nullable `DateTime?`), no extra constraints; it stays null until the domain's `MarkAsRead` stamps it.
  - **Unique filtered index `(UserId, PushNotificationId)`** (`UserNotificationConfiguration.cs:39-41`): `IsUnique().HasFilter("[IsDeleted] = 0")` guarantees at most one live inbox entry per user per notification while still allowing soft-deleted history.
  - **Filtered index `(UserId, IsRead)`** (`UserNotificationConfiguration.cs:44-45`): non-unique, `HasFilter("[IsDeleted] = 0")`, sized for the fast "this user's unread notifications" lookup that drives the unread badge.
- **Why it's built this way**: the pairing is deliberate: `PushNotification` is the broadcast fact (one row per send), `UserNotification` is the fan-out inbox (one row per recipient), and keeping them as two aggregates joined by a scalar `PushNotificationId` (rather than an EF navigation) is what lets the whole notification store move to its own database without a foreign-key constraint spanning physical sources ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The filtered indexes are the concession that makes soft-delete and a hot unread-count query coexist: uniqueness that ignores tombstones, and a lookup index that never scans them.
- **Where it's used**: discovered and applied by [`ApplicationDbContext`](#applicationdbcontext) during model building and registered with [`EntityDataSourceRegistry`](#entitydatasourceregistry) for routing. The mapped table backs the per-user notification inbox surfaced through the SignalR pipeline and the inbox/read-state APIs.


---
[⬅ Validation](group-06-validation.md)  •  [Index](00-index.md)  •  [Authentication & Authorization ➡](group-08-auth.md)
