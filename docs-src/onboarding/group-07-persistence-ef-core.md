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
non-EF storage-adjacent services: blob storage, image normalization, and native push registration and
delivery. The whole thing is the `[Rubric §8, Data Architecture]` chapter of the codebase, and it
leans hard on `[Rubric §7, Microservices Readiness]` and `[Rubric §3, Clean Architecture]`.

## One base context, one class per engine, one instance per database

[`ApplicationDbContext`](#applicationdbcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:34`)
is an abstract primary-constructor class over EF's `DbContext`. It holds the cross-cutting model
configuration that every engine shares: it applies a global soft-delete query filter to every non-owned
[`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) using a runtime-built
expression tree, registered as a named `"SoftDelete"` filter (`ApplicationDbContext.cs:184-198`);
it configures the `RowVersion` optimistic-concurrency token, mapped as a SQL Server `rowversion` or as
a plain application-managed token on other providers (`ApplicationDbContext.cs:211-231`); and it maps
the outbox and inbox tables so every relational database carries its own
([`OutboxMessage`](group-04-events-outbox.md#outboxmessage) at `ApplicationDbContext.cs:238-251`,
[`InboxMessage`](group-04-events-outbox.md#inboxmessage) at `ApplicationDbContext.cs:258-267`). It also
registers four keyless [`ValReturn<T>`](#valreturnt) shapes (`ApplicationDbContext.cs:51`,
`165-168`) so raw SQL scalar queries have somewhere to land. Its `SaveChangesAsync(userId, ...)`
overload (`ApplicationDbContext.cs:79-93`) is the one entry point handlers care about: it stashes the
current user id in `CurrentSaveUserId` so the audit interceptor can read it, delegates to `base`, then
clears it in a `finally` so a later internal save cannot silently reuse the previous caller's identity.

The design decision that shapes this whole group is stated in the base's own doc comment: **one context
class per engine, one instance per physical data source** (`ApplicationDbContext.cs:23-28`). The same
[`SQLServerDbContext`](#sqlserverdbcontext) class
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:13`)
is instantiated once per SQL Server database, each instance carrying a different
[`PhysicalDataSource`](#physicaldatasource) (connection string, migrations assembly, Cosmos database
name). To keep EF from silently reusing the first-built model for every database,
[`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16`)
keys EF's model cache by `(context type, physical source name, designTime)` and is installed by the base
in `OnConfiguring` (`ApplicationDbContext.cs:131`). This is deliberately not a per-module context split:
one sealed context per engine over the abstract base is ADR-006's ruling. `SQLServerDbContext` adds the
provider-specific touches: transient-fault retry (`EnableRetryOnFailure` with 5 attempts and a 10-second
cap, `SQLServerDbContext.cs:41-45`) and a suppressed `PendingModelChangesWarning`
(`SQLServerDbContext.cs:57`) so an extracted service that registers only its own module's entity
configurations starts cleanly against a migration snapshot that captures every module's tables. That
warning suppression is a direct `[Rubric §7, Microservices Readiness]` decision, and the source comment
states the trade-off plainly: monolith hosts lose the "you forgot a migration" safety net, so CI is
expected to run `dotnet ef migrations has-pending-model-changes` as a separate gate.

## SaveChanges as an interceptor pipeline

The base context resolves two EF Core `SaveChangesInterceptor`s from DI in `OnConfiguring`
(`ApplicationDbContext.cs:124-126`), and together they turn a bare save into the framework's audit-plus-
outbox flow. [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:13`)
runs on `SavingChanges`: it walks every tracked
[`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), stamps `CreatedOn/By` plus
`LastModifiedOn/By` on `Added`, and on `Modified` marks the two `Created*` properties unmodified before
re-stamping `LastModified*`, reading the timestamp from an injected `TimeProvider` and the user id from
`CurrentSaveUserId` (falling back to `default` as the system-operation sentinel,
`AuditSaveChangesInterceptor.cs:38-65`). This is why the domain declares audit fields with private
setters and never writes them: the interceptor sets them centrally through `entry.Property(...).CurrentValue`,
bypassing setter visibility. That is the `[Rubric §10, Cross-Cutting Concerns]` payoff, one enforcement
point instead of copy-paste in every handler.

[`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:38`)
is the producer end of the outbox, and it is the most subtle type in the group. On `SavingChanges` it
collects pending [`IDomainEvent`](group-04-events-outbox.md#idomainevent)s from every tracked
[`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) and writes an
[`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row for each into the same context, so the
events land in the database **in the same transaction** as the aggregate changes
(`DomainEventSaveChangesInterceptor.cs:143-195`). The routing split happens right there: an
[`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) gets a row but no in-process
dispatch (its row stays unprocessed so the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor)
publishes it over `IMessageBus`), while a local event gets both a row and the fast in-process path
(`DomainEventSaveChangesInterceptor.cs:160-191`). The captured state is parked in a
[`CapturedState`](#capturedstate) record (`DomainEventSaveChangesInterceptor.cs:268`) held in a
`ConditionalWeakTable` keyed by context (`:48`), so it is cleaned up automatically when the context is
disposed.

After the save, `SavedChangesAsync` does one of two things (`DomainEventSaveChangesInterceptor.cs:201-218`).
With no ambient transaction it flushes immediately: dispatch local events through
[`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher), clear the aggregates' event
lists, mark the local outbox rows processed, and signal the outbox for integration events
(`:224-252`). With an active transaction it clears the events (so a second save inside the same
transaction cannot re-capture them) and parks a [`DeferredDispatch`](#deferreddispatch)
(`:275`) in a second weak table; [`DbContextFactory`](#dbcontextfactory) then calls the static
`FlushDeferredAsync` only after a successful commit (`:120-129`) and `DropDeferred` on rollback (`:137`).
That is what keeps handler side effects from acting on state that could still roll back, and what keeps a
retrying execution strategy from dispatching the same events once per attempt. If in-process dispatch
throws, the interceptor logs a warning and signals the outbox to retry from the persisted rows rather
than losing the event (`:238-246`). The synchronous `SavedChanges` path cannot await a dispatcher at
all, so it clears events and leaves delivery entirely to the outbox (`:100-113`). Cosmos DB has no
relational outbox table, so the base exposes a `SupportsOutbox` flag (`ApplicationDbContext.cs:62`) that
[`CosmosDbContext`](#cosmosdbcontext) overrides to `false` (`CosmosDbContext.cs:69`) and the interceptor
honors by dispatching everything in-process instead. This split, atomic persistence plus best-effort
immediate dispatch with a durable fallback, is the at-least-once contract of ADR-003; the consumer end
lives in [Group 04](group-04-events-outbox.md).

## Repositories and the unit of work

Handlers do not touch a `DbContext` directly. They ask a [`UnitOfWork`](#unitofwork)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13`) for a repository.
The repository contract is deliberately interface-segregated
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs`): a handler
that only needs a lookup can depend on the narrow [`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype)
(`IRepository.cs:14`) or [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype)
(`IRepository.cs:64`); [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype)
(`IRepository.cs:110`) combines both plus four `IQueryable` surfaces (tracking, no-tracking, single-query,
split-query), [`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype)
(`IRepository.cs:133`) adds mutation, and [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype)
(`IRepository.cs:214`) is the union. That layering is the group's clearest `[Rubric §1, SOLID]`
(interface-segregation) statement, and [`ReadRepositoryExtensions`](#readrepositoryextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10`) adds the
`GetByIdOrFailAsync` convenience that turns a miss into a
[`Result`](group-01-result-error-handling.md#result) failure. The concrete
[`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) and
[`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:15`)
wrap an EF `DbSet`. The write side patches already-tracked entities in place through an O(1)
`Local.FindEntry` lookup instead of re-attaching (`EFRepository.cs:44-62`), seeds `RowVersion` original
values for optimistic concurrency on both the aggregate and any child implementing `IRowVersioned`
(`EFRepository.cs:72-93`, ADR-035), and offers a set-based `ExecuteDeleteAsync` escape hatch that the
interface itself documents as bypassing domain events, audit stamps, and soft-delete
(`IRepository.cs:187-197`).

Two factories keep the wiring honest. [`RepositoryFactory`](#repositoryfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:13`)
builds a repository over a given context and conditionally wraps it in a MiniProfiler decorator
([`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype) or
[`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype))
when `UseMiniProfiler` is on (`RepositoryFactory.cs:30-37`, `54-61`), adding timing without the base
repository knowing. [`DbContextFactory`](#dbcontextfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:18`)
is the scoped coordinator: it caches one [`ApplicationDbContext`](#applicationdbcontext) per
[`DataSourceKey`](#datasourcekey) so every repository in a scope shares one change tracker, and it enlists
a late-created context into an already-open transaction (`DbContextFactory.cs:51-66`). Because there can
be more than one physical source in play, `ExecuteInTransactionAsync` runs the operation under the first
transactional context's execution strategy, opens a transaction per source, and commits them
sequentially with no two-phase commit (`DbContextFactory.cs:296-357`); cross-source consistency is the
outbox's job. A returned failed [`Result`](group-01-result-error-handling.md#result) rolls back exactly
like an exception (`DbContextFactory.cs:314-321`), which is what makes ADR-013's Result-over-exceptions
rule safe for partial persistence, and rollback also drops the deferred event dispatch
(`DbContextFactory.cs:265-276`). `DbContextFactory` further carries the `SET IDENTITY_INSERT` machinery
([`IdentityInsertGroup`](#identityinsertgroup) at `DbContextFactory.cs:240`, the save split at
`131-191`) for importing entities with explicit database-generated ids one table at a time, and the
`MigrateAsync` / `HasPendingMigrationsAsync` sweeps over every SQL Server source in use
(`DbContextFactory.cs:361-377`).

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
`DataSource` configuration key. The interfaces ([`IUnitOfWork`](#iunitofwork),
[`IDbContextFactory`](#idbcontextfactory), [`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory),
[`IRepositoryFactory`](#irepositoryfactory)) keep the application layer talking to abstractions.

## Routing an entity to its database

The heart of ADR-006 is that every entity resolves to a [`DataSourceKey`](#datasourcekey)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/DataSourceKey.cs:15`), a
`(Engine, Name)` record struct where the [`DataSource`](#datasource) engine
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:6`) is
one of Cosmos DB, SQLite, or SQL Server, and `Name` is a **physical** database name defaulting to
`"Default"` (`DataSourceKey.cs:18-23`). Two layers compute this. [`DataSourceResolver`](#datasourceresolver)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:13`),
a singleton, builds the logical-to-physical map once per engine from configuration: named sources with no
connection string, or whose connection identity equals the top-level one, **collapse onto the `Default`
source**, so a host with no `DataSources` section behaves exactly like a single-database monolith
(`DataSourceResolver.cs:94-135`), and sources sharing a connection identity collapse onto one canonical
key named after their alphabetically-first member (`DataSourceResolver.cs:172-210`). It fails fast when
two logical names collapsing to one database declare conflicting migrations assemblies
(`DataSourceResolver.cs:229-249`) and logs a warning when a separate SQL Server source falls back to the
Default migrations assembly (`DataSourceResolver.cs:185-192`).
[`EntityDataSourceRegistry`](#entitydatasourceregistry)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21`),
also a singleton, scans the configuration assemblies and maps each entity to its physical key, deriving
the engine from the `[UseDataSource]` attribute on the **configuration class** and the logical name from
`[UseDatabase]`, the entity's module namespace via [`NamespaceConventions`](#namespaceconventions)`.GetModuleName`,
or `Default` (`EntityDataSourceRegistry.cs:164-177`). It caches an immutable [`Snapshot`](#snapshot)
of frozen collections (`EntityDataSourceRegistry.cs:25`), rescans once on a lookup miss when the assembly
set changed so late-loaded module assemblies are picked up (`:91-106`), and rejects an entity claimed by
two different sources (`:134-145`). Because the registry reads the same attributes the model
configuration reads, routing and model contents agree by construction, and configurations that implement
a provider interface directly without the attributed base classes are deliberately skipped as legacy
(`:155-170`). [`DataSourceService`](#datasourceservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12`) is the thin
application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry), and it answers
the one question navigation loading needs: two entities support EF `.Include()` only when their physical
keys are equal and the engine is not Cosmos (`DataSourceService.cs:31-38`).

## Two model-finalizing conventions

The base context adds both of its conventions in `ConfigureConventions` (`ApplicationDbContext.cs:137-152`),
and each exists because a cross-cutting policy above would otherwise produce an invalid or surprising
model. [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33`,
added at `ApplicationDbContext.cs:146`) is what lets routing be lazy and attribute-driven and still
produce a valid EF model. When a relationship's two ends live in different physical sources it removes
the foreign key (a database cannot enforce an FK into another database), keeps the declared scalar FK
columns plus a compensating index unless an existing index already covers them as a prefix, ignores the
CLR navigation members, and drops the foreign entity types out of this database's model entirely
(`CrossDataSourceDegradeConvention.cs:38-89`, `107-138`). It works through EF's **mutable** model API
rather than convention builders, because the soft-delete and concurrency helpers have already promoted
every entity type to the Explicit configuration source (`:22-24`, `:44-46`), and it skips the
compensating index on Cosmos, which auto-indexes everything and rejects explicit index definitions
(`:65`, `:96-105`). Runtime navigation across sources then flows through the
[`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)
batch-loading machinery in [Group 11](group-11-navigation-populators.md). Crucially, when every entity
collapses onto one physical source (the monolith case) nothing is foreign and the convention returns
early (`:52-55`), so the model is identical to the single-database model. That is the property that lets
the same codebase run as a monolith today and as split services later without a rewrite, the core
`[Rubric §7, Microservices Readiness]` claim.

[`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention)
(`.../Conventions/SoftDeleteUniqueIndexConvention.cs:24`, added at `ApplicationDbContext.cs:151`) closes
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
`[UseDataSource(DataSource.SQLServer)]`. The base reads the attribute off its own runtime type and throws
a clear error when it is missing (`EntityTypeConfiguration.cs:43-47`), then applies the engine's
conventions in `ApplyEngineConventions` (`:57-99`): SQL Server gets a table in a module schema, SQLite a
plain table, Cosmos a per-module container with the entity id as partition key, and each maps key
generation according to the entity's
[`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions)`.IsIdValueGenerated`
marker (`ValueGeneratedOnAdd` for database identity, `ValueGeneratedNever` otherwise, or the
[`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator) for Cosmos, which has no server-side identity
and increments a process-level counter seeded from the Unix timestamp,
`.../ValueGenerators/CosmosIntIdValueGenerator.cs:16-25`). Because the engine is a single attribute and
the base implements all three provider marker interfaces
([`IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlservertentity-tidentifiertype),
[`IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlitetentity-tidentifiertype),
[`IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#ientitytypeconfigurationcosmostentity-tidentifiertype),
all over the common [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype)),
**moving an entity between engines is a one-line attribute change with no configuration-body edits**. The
shared [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype)
(`.../EntityTypeConfigurationBase.cs:19`) handles the one universal concern: excluding the in-memory
`DomainEvents` collection from mapping (`:29-32`). Discovery runs through
[`ModelBuilderExtensions`](#modelbuilderextensions)`.ApplyAllConfigurations`
(`.../DbContexts/ModelBuilderExtensions.cs:10`), which the base calls with an entity filter so each
database's model receives only its own entities (`ApplicationDbContext.cs:276-303`), over the assemblies
supplied by [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) and its
[`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider) implementation
(configured through [`EntityConfigurationOptions`](#entityconfigurationoptions)). Two configurations ship
inside the framework itself, [`PushNotificationConfiguration`](#pushnotificationconfiguration) and
[`UserNotificationConfiguration`](#usernotificationconfiguration)
(`.../Configuration/EntityTypeConfiguration/Notifications/*.cs:15`), both tagged `[UseDatabase("Notification")]`
and re-declaring the `Notification` schema because namespace derivation would otherwise resolve them to
`Common`. This engine-portability design is ADR-018 (polyglot persistence); note the current-reality
caveat: the SQLite and Cosmos plumbing is shipped and tested, but SQL Server is the only engine backing
production entities today.

## Encryption, seeding, design time, and the shared helpers

A handful of supporting pieces round out the EF side. [`EncryptedStringConverter`](#encryptedstringconverter)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:28`)
is a value converter that transparently encrypts a string column with authenticated AES-256-GCM (a random
12-byte nonce, a 16-byte tag, stored Base64 as nonce plus ciphertext plus tag), rejecting any key that is
not exactly 32 bytes (`:30-52`, `:60-80`). It is the `[Rubric §11, Security]` control that
[`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) points at for fields that must remain
retrievable after erasure. Its current reality matches ADR-037: it is shipped and unit-tested but
**unadopted**, no entity configuration wires it (the only non-test references are its own file and the
`IAnonymizable` doc comment). On the read side, [`IQueryableExecutor`](#iqueryableexecutor) and its
implementation [`EFQueryableExecutor`](#efqueryableexecutor)
(`.../Persistence/EFQueryableExecutor.cs:11`) abstract async query materialization so higher layers can
execute an `IQueryable` without referencing EF, detecting a real EF query by its `IAsyncEnumerable<T>`
implementation and degrading to LINQ-to-Objects otherwise (`EFQueryableExecutor.cs:45`). That is what
makes the specification evaluation in [Group 03](group-03-querying-specifications.md) unit-testable
without a database, a small but real `[Rubric §14, Testability]` win.
[`ProfilingHelper`](#profilinghelper) (`.../Persistence/ProfilingHelper.cs:9`) is the MiniProfiler
step wrapper the repository decorators share.

Seeding and design time close the loop. [`IDbSeeder`](#idbseeder) and the [`DbSeeder`](#dbseeder) base
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:7`) give
module seeders a `GetId<TIdentifier>` helper that maps integer seed ids to either `int` or a deterministic
`Guid` so seed data reproduces across key strategies (`DbSeeder.cs:22-40`). For migrations,
[`DesignTimeDbContextHelper`](#designtimedbcontexthelper)
(`.../DbContexts/Design/DesignTimeDbContextHelper.cs:34`) builds a
[`SQLServerDbContext`](#sqlserverdbcontext) for `dotnet ef` without the app's DI container: a downstream
migrations project writes a few-line `IDesignTimeDbContextFactory`, and
`dotnet ef migrations add X -- --datasource Conference` selects which physical source to build against
(`:86-104`), so each database gets its own migrations project. It composes minimal stand-ins
([`ExplicitAssemblyProvider`](#explicitassemblyprovider) at `:106`,
[`NullDomainEventDispatcher`](#nulldomaineventdispatcher) at `:111`) and a
[`DesignTimeDbContextOptions`](#designtimedbcontextoptions) carrying the connection settings, then wires
the same [`DataSourceResolver`](#datasourceresolver) and [`EntityDataSourceRegistry`](#entitydatasourceregistry)
the runtime uses so the design-time model matches the runtime one (`:43-81`).

## Blobs, images, and native push

The group also carries the storage-adjacent infrastructure services that are not EF at all, each behind
an Application-layer interface with a null default so a host that has not configured the backend still
starts and degrades cleanly. [`IFileStorageService`](#ifilestorageservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11`)
stores and deletes blobs behind a [`Result`](group-01-result-error-handling.md#result)-returning API and
exposes an `IsConfigured` flag handlers can gate features on;
[`AzureBlobFileStorageService`](#azureblobfilestorageservice)
(`.../Services/AzureBlobFileStorageService.cs:15`) is the Azure implementation over a single
pre-provisioned container, and [`NullFileStorageService`](#nullfilestorageservice)
(`.../Services/NullFileStorageService.cs:11`) fails uploads with a named error while letting deletes
succeed. [`IImageProcessor`](#iimageprocessor) and [`ImageSharpImageProcessor`](#imagesharpimageprocessor)
(`.../Services/ImageSharpImageProcessor.cs:14`) normalize untrusted uploads by decoding, baking in the
EXIF orientation, center-cropping to a square, stripping all metadata, and re-encoding as JPEG, so only
pixels survive; the dependency-free [`ImageContentSniffer`](#imagecontentsniffer)
(`.../Interfaces/Infrastructure/ImageContentSniffer.cs:10`) is its upload-side companion, deciding the
accepted formats from magic bytes rather than the client-declared content type. Both are ADR-045, and
both are squarely `[Rubric §11, Security]` (EXIF GPS is PII, and a full re-encode is the defense against
polyglot payloads). On the push side, [`INativePushSender`](#inativepushsender) and
[`IPushDeviceRegistrar`](#ipushdeviceregistrar) describe OS-level delivery and the device-installation
registry that backs it (ADR-044), implemented by
[`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender)
(`.../Services/AzureNotificationHubNativePushSender.cs:14`) and
[`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar)
(`.../Services/AzureNotificationHubDeviceRegistrar.cs:15`) over Azure Notification Hubs, with
[`NullNativePushSender`](#nullnativepushsender) and [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar)
as the unconfigured defaults. [`NativePushPayloads`](#nativepushpayloads)
(`.../Services/NativePushPayloads.cs:10`) is the pure helper that builds the FCM v1 and APNs payload
shapes and chunks user tags at the hub's 20-tag expression cap (`NativePushPayloads.cs:13`), which is
what makes those rules unit-testable without a hub. This channel sits beside the persisted notification
record and the SignalR path in [Group 10](group-10-notifications.md).

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
here are two orthogonal ones, ADR-006's `Name` axis (which database) and ADR-018's `Engine` axis (which
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
  owns its own store so it can be lifted out). ADR-006 establishes that every module owns its own
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
- **Depends on**: `System.Reflection` (BCL) only.
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
  knowing any module by name, satisfying the extraction invariant of ADR-006/ADR-007.
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
  upload originates. The doc comment (`ImageContentSniffer.cs:3-8`) frames the division of labor
  (ADR-045): the sniffer narrows accepted inputs to jpeg/png/webp, then the caller hands content to
  the processor whose re-encoding keeps only pixels; app-specific size limits and error codes stay in
  the calling handler.
- **Walkthrough**: four span-based predicates.
  - `IsAllowedImage(ReadOnlySpan<byte>)` (`ImageContentSniffer.cs:15`): the public entry point,
    `IsJpeg || IsPng || IsWebP`.
  - `IsJpeg` (`ImageContentSniffer.cs:21`): length >= 3 and the SOI prefix `FF D8 FF`.
  - `IsPng` (`ImageContentSniffer.cs:27`): length >= 8 and the exact 8-byte PNG signature.
  - `IsWebP` (`ImageContentSniffer.cs:33`): length >= 12, a `RIFF` container (bytes 0-3, `"RIFF"u8`)
    declaring the `WEBP` form type (bytes 8-11, `"WEBP"u8`).
- **Why it's built this way**: `ReadOnlySpan<byte>` and UTF-8 literals (`"RIFF"u8`) mean the checks
  allocate nothing and run on the raw payload prefix; being a pure static class it can be called from
  any layer without DI. Checking bytes (not the declared type) is the security point, a client can
  rename `evil.exe` to `avatar.png` but cannot forge the leading signature and survive re-encoding.
- **Where it's used**: called by the avatar-upload handler before handing content to
  [`IImageProcessor`](#iimageprocessor) (ADR-045).

### INativePushSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/INativePushSender.cs:10` · Level 0 · interface

- **What it is**: the contract for sending OS-level push notifications to registered device
  installations, the delivery channel that reaches a phone when the app is backgrounded or killed.
- **Depends on**: the `UserIdentifierType` alias (an `int`); BCL otherwise.
- **Concept introduced, native push as the third delivery channel.** `[Rubric §10, Cross-Cutting
  Concerns]` (a swappable delivery abstraction, defined in Application, implemented at the edge). The
  doc comment (`INativePushSender.cs:3-9`) places this beside the two other channels (ADR-044): the
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
- **Walkthrough**: four methods.
  - `Include<T>(IQueryable<T>, string navigationPropertyPath)` (`IQueryableExecutor.cs:14`): a
    **string-based** include path (e.g. `"Order.OrderLines"`), deliberately not a lambda, because the
    generic query pipeline builds include paths dynamically from navigation-property name strings.
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
  - `Default(DataSource engine)` (`DataSourceKey.cs:23`): a factory building the default key for an
    engine.
  - `ToString()` (`DataSourceKey.cs:26`): renders `"{Engine}/{Name}"` for diagnostics.
- **Why it's built this way**: making the key a value type with structural equality means the routing
  decision (same physical database and relational engine) is a simple `==` comparison, and a host with
  no `DataSources` configuration collapses everything onto `Default` and behaves like a single-database
  monolith (ADR-006).
- **Where it's used**: the entity data-source registry maps each entity type to a `DataSourceKey`;
  [`IDataSourceService`](#idatasourceservice) resolves and compares them; the EF context factory
  (this group) caches one context per key.

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
  keeping Application pure (ADR-006). The doc comment (`IDataSourceService.cs:18-23`) names the
  consumer:
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) uses
  it to classify navigation properties as supported or unsupported includes.
- **Walkthrough**: eight members across four concerns.
  - `GetDataSourceKey(Type)` (`IDataSourceService.cs:29`) and `GetDataSourceKey(string
    entityFullName)` (`IDataSourceService.cs:34`): resolve the physical key by CLR type or full type
    name.
  - `GetDataSource(string)` (`IDataSourceService.cs:39`) and `GetDataSource(Type)`
    (`IDataSourceService.cs:44`): resolve just the engine.
  - `HaveIncludeSupport(DataSourceKey first, DataSourceKey second)` (`IDataSourceService.cs:54`): the
    crux, returns `true` only when both keys identify the same physical database and the engine is
    relational (the doc comment at lines 46-53 notes Cosmos DB has no cross-document JOINs).
  - `HaveIncludeSupport(string firstEntityFullName, string secondEntityFullName)`
    (`IDataSourceService.cs:63`): the same test by entity name, resolving each side's key first.
- **Why it's built this way**: ADR-006 replaces cross-service foreign keys with scalar columns and
  routes consistency through the outbox; to build a query the Application layer must know the routing
  topology so it can classify each navigation as "include-able" versus "manual load required."
- **Where it's used**: consumed by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) to
  drive the supported/unsupported include split, and indirectly by the query pipeline's eager-loading
  decisions. The Infrastructure implementation is a facade over the eager entity registry.

### IFileStorageService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11` · Level 3 · interface

- **What it is**: the contract for storing and deleting binary blobs (e.g. user avatar images).
  Implementations own the container/bucket; callers pass only a blob name scoped within it.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form (via
  `MMCA.Common.Shared.Abstractions`, `IFileStorageService.cs:1`); BCL `Stream`/`Uri`.
- **Concept introduced, the managed blob-storage boundary.** `[Rubric §8, Data Architecture]` (binary
  content lives in object storage, not the relational row) and `[Rubric §10, Cross-Cutting Concerns]`
  (a swappable storage transport behind a Result-returning interface). Per the doc comment
  (`IFileStorageService.cs:5-10`, ADR-045) the default implementation is unconfigured, uploads fail
  with a clear error, until a host calls `AddAzureBlobFileStorage(configuration)` with a complete
  `FileStorage` section. Returning [`Result`](group-01-result-error-handling.md#result) rather than
  throwing keeps a failed upload on the same error-flow rails as the rest of the stack (see the
  [Result pattern](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: one property and two methods.
  - `IsConfigured` (`IFileStorageService.cs:14`): whether a real store is wired, so a handler can gate
    a feature on it rather than attempt a doomed upload.
  - `UploadAsync(string blobName, Stream content, string contentType, CancellationToken)`
    (`IFileStorageService.cs:22`): uploads or overwrites a blob and returns its public absolute URL as
    `Result<Uri>`.
  - `DeleteAsync(string blobName, CancellationToken)` (`IFileStorageService.cs:28`): deletes a blob;
    unknown names succeed (idempotent), matching at-least-once cleanup semantics.
- **Why it's built this way**: an unconfigured default plus an `IsConfigured` gate means the framework
  ships avatar support without forcing every consumer to provision blob storage; idempotent delete
  makes cleanup safe to retry.
- **Where it's used**: the avatar-upload handler, after [`ImageContentSniffer`](#imagecontentsniffer)
  and [`IImageProcessor`](#iimageprocessor) have validated and normalized the bytes (ADR-045).

### IImageProcessor
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IImageProcessor.cs:11` · Level 3 · interface

- **What it is**: the contract for normalizing an untrusted uploaded image, decoding it, correcting
  EXIF orientation, center-cropping to a square, stripping *all* metadata, and re-encoding as JPEG.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via
  `MMCA.Common.Shared.Abstractions`, `IImageProcessor.cs:1`); BCL `Stream`.
- **Concept introduced, re-encoding as an image trust boundary.** `[Rubric §11, Security]` (assesses
  neutralizing untrusted binary input) and `[Rubric §30, Compliance, Privacy & Data Governance]`
  (stripping EXIF GPS coordinates, which are PII). The doc comment (`IImageProcessor.cs:5-10`,
  ADR-045) makes both points: metadata removal deletes location PII, and re-encoding is the defense
  against polyglot or malformed payloads because only pixels survive the decode/re-encode round trip.
  This is the processor half of the pair that [`ImageContentSniffer`](#imagecontentsniffer) opens.
- **Walkthrough**: one method, `NormalizeToSquareJpegAsync(Stream content, int size,
  CancellationToken)` (`IImageProcessor.cs:18`), returning `Result<byte[]>` of the normalized JPEG, or
  a validation failure for undecodable content. `size` is the output square edge length in pixels.
- **Why it's built this way**: returning bytes (not a stream to storage) keeps the processor a pure
  transform, so the handler can sniff, then normalize, then hand the result to
  [`IFileStorageService`](#ifilestorageservice); a Result failure on undecodable input keeps a bad
  upload from ever reaching storage.
- **Where it's used**: the avatar-upload handler, between [`ImageContentSniffer`](#imagecontentsniffer)
  and [`IFileStorageService`](#ifilestorageservice) (ADR-045).

### IPushDeviceRegistrar
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPushDeviceRegistrar.cs:11` · Level 3 · interface

- **What it is**: maintains the device-installation registry behind
  [`INativePushSender`](#inativepushsender), tagging each installation with its owning user so sends
  can target users rather than raw device tokens.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via
  `MMCA.Common.Shared.Abstractions`, `IPushDeviceRegistrar.cs:1`),
  [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest) (from
  `MMCA.Common.Shared.Notifications.PushNotifications`, `IPushDeviceRegistrar.cs:2`), and the
  `UserIdentifierType` alias.
- **Concept, the token-registry side of native push.** `[Rubric §10, Cross-Cutting Concerns]` and
  `[Rubric §11, Security]` (installations are bound to an authenticated owner, so a send targets a
  person, not an anonymous token). The doc comment (`IPushDeviceRegistrar.cs:6-10`, ADR-044) explains
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
  implementation targets Azure Notification Hubs (ADR-044).

### IEntityQuerier<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:64` · Level 4 · interface

- **What it is**: the collection/projection half of the repository split, `GetAllAsync`,
  `GetProjectedAsync<TResult>`, `GetAllForLookupAsync`, and two `CountAsync` overloads.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IRepository.cs:65`) and
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype)
  (the lookup projection, `IRepository.cs:87`).
- **Concept introduced, the ISP-split repository family.** `[Rubric §1, SOLID]` (Interface
  Segregation). `IRepository.cs` defines a deliberate ladder of ever-wider interfaces so a handler
  depends on exactly the surface it uses: `IEntityQuerier` (collections/projection, this type),
  [`IEntityReader`](#ientityreadertentity-tidentifiertype) (by-id lookups),
  [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype) (mutations),
  [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) (reader + querier + raw
  `IQueryable`), and [`IRepository`](#irepositorytentity-tidentifiertype) (read + write). A query
  handler that only lists entities can declare `IEntityQuerier<T,Id>` instead of the whole repository,
  a narrower, more testable dependency. `[Rubric §12, Performance & Scalability]`:
  `GetProjectedAsync<TResult>` (`IRepository.cs:80`) accepts an `Expression<Func<TEntity,TResult>>`
  translated to SQL, so read-heavy handlers fetch only the columns they need.
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
  handlers that want the full read surface.

### IEntityReader<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:14` · Level 4 · interface

- **What it is**: the by-id half of the repository split, `GetByIdAsync` (two overloads),
  `GetByIdsAsync`, and `ExistsAsync` (two overloads), for handlers whose data access is minimal.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IRepository.cs:15`).
- **Concept, minimal data access as a declared dependency.** `[Rubric §1, SOLID]` (Interface
  Segregation, introduced on [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype)) and
  `[Rubric §8, Data Architecture]` (deliberate, minimal access patterns). The doc comment
  (`IRepository.cs:7-11`) is explicit: "Prefer this over `IReadRepository<>` when a handler only needs
  `GetByIdAsync` or `ExistsAsync`, this signals minimal data access." The `ignoreQueryFilters`
  parameter on `ExistsAsync` (`IRepository.cs:47`) lets a handler check whether a *soft-deleted* entity
  exists, e.g. for conflict detection on re-creation.
- **Walkthrough**
  - `GetByIdAsync(id, CancellationToken)` (`IRepository.cs:19`): plain fetch, returns `null` if
    missing.
  - `GetByIdAsync(id, IEnumerable<string> includes, bool asTracking, CancellationToken)`
    (`IRepository.cs:24`): the eager-load overload; include paths are navigation-property names.
  - `GetByIdsAsync(ids, includes?, asTracking, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:37`): a single-query bulk fetch; may return fewer than requested when some ids are
    missing or filtered.
  - `ExistsAsync(id, ignoreQueryFilters, CancellationToken)` (`IRepository.cs:45`) and
    `ExistsAsync(Expression<Func<TEntity,bool>> where, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:51`): existence checks by key or predicate.
- **Why it's built this way**: a handler that only needs a point lookup takes the narrowest interface,
  which reads clearly and mocks trivially in tests.
- **Where it's used**: command handlers that load an aggregate before mutating it; folded into
  [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype). A
  `GetByIdOrFailAsync` extension (this group) wraps the null-returning `GetByIdAsync` in a
  [`Result<TEntity>`](group-01-result-error-handling.md#result).

### IWriteRepository<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:133` · Level 4 · interface

- **What it is**: the write half of the repository abstraction, `AddAsync`, `AddRangeAsync`,
  `UpdateAsync`, `UpdateRange`, `SetOriginalRowVersion`, `ExecuteDeleteAsync`, `Save`, and
  `SaveChangesAsync`.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IRepository.cs:134`).
- **Concept introduced, optimistic-concurrency wiring and change-tracking-bypass delete.** `[Rubric
  §8, Data Architecture]` (deliberate concurrency control, not accidental last-write-wins). Two
  members carry the weight:
  - `SetOriginalRowVersion(TEntity entity, byte[]? rowVersion)` (`IRepository.cs:173`): plants the
    client's last-observed `RowVersion` as the tracked entity's *original* concurrency token, so the
    next save emits `WHERE RowVersion = @original` and raises `DbUpdateConcurrencyException` (mapped
    to `409 Conflict`) if the row changed since the client read it. The doc comment (`IRepository.cs:165-172`)
    notes it is a no-op when `rowVersion` is null or empty (legacy clients / first write).
  - `ExecuteDeleteAsync(where, CancellationToken)` (`IRepository.cs:183`): a set-based delete run
    directly in the database. The doc comment (`IRepository.cs:175-182`) warns in capitals that it
    does **not** trigger domain events, audit stamps, or soft-delete; it is for maintenance scenarios
    only.
- **Walkthrough**
  - `AddAsync` / `AddRangeAsync` (`IRepository.cs:141`, `:149`): single and batch inserts.
  - `UpdateAsync` / `UpdateRange` (`IRepository.cs:157`, `:163`): mark tracked entities modified.
  - `Save()` (`IRepository.cs:189`) and `SaveChangesAsync(CancellationToken)` (`IRepository.cs:194`):
    the synchronous and async persist, each returning the number of state entries written; the doc
    comment prefers the async form.
- **Why it's built this way**: keeping writes in a focused interface means a query handler cannot
  accidentally acquire mutation methods, and the concurrency/bulk-delete escape hatches are declared
  where they are visible rather than buried in a concrete class.
- **Where it's used**: command handlers that mutate entities; folded into
  [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype). Handed out by
  [`IUnitOfWork.GetRepository`](#iunitofwork).

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
  (constraint).
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
- **Where it's used**: query handlers wanting the whole read surface; the concrete EF read repository
  (this group) implements it; combined with
  [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype) into
  [`IRepository`](#irepositorytentity-tidentifiertype).

### IRepository<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:202` · Level 6 · interface

- **What it is**: the combined read-write repository, extending both
  [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) and
  [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype), so a command handler that reads and
  mutates takes a single dependency.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype),
  [`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype), and
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (constraint).
- **Concept, the top of the ISP ladder.** `[Rubric §1, SOLID]`. The interface is purely
  compositional, it adds no members of its own, only the two constraints
  `where TEntity : AuditableBaseEntity<TIdentifierType>` and `where TIdentifierType : notnull`
  (`IRepository.cs:203-204`). Command handlers that both query and mutate take `IRepository`; query
  handlers take [`IReadRepository`](#ireadrepositorytentity-tidentifiertype); handlers needing only
  point lookups take [`IEntityReader`](#ientityreadertentity-tidentifiertype). Each dependency is
  explicit and minimal.
- **Walkthrough**: no members; the body is just the two interface bases and the two generic
  constraints (`IRepository.cs:202-204`).
- **Why it's built this way**: keeping the combined interface empty means the read and write surfaces
  each stay independently usable, while a handler that genuinely needs both still gets one
  constructor parameter.
- **Where it's used**: resolved by
  [`IUnitOfWork.GetRepository<TEntity, TId>()`](#iunitofwork); the concrete EF repository (this
  group) implements it.

### IUnitOfWork
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IUnitOfWork.cs:10` · Level 7 · interface

- **What it is**: the single coordination point for a command that reads entities, mutates them, and
  saves atomically. It hands out typed repositories, persists changes with domain-event dispatch, and
  gives controlled access to transactions and identity-insert mode.
- **Depends on**: [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) and
  [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (returned by
  the factory methods);
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (constraint bounds); BCL `IDisposable`/`IAsyncDisposable` (`IUnitOfWork.cs:10`).
- **Concept introduced, the Unit of Work with post-commit domain-event dispatch.** `[Rubric §8, Data
  Architecture]` (deliberate persistence: transactions, audit, consistency) and `[Rubric §6, CQRS &
  Event-Driven]` (domain events dispatched from one place after a successful save). The **Unit of
  Work** is the boundary within which a command sees a consistent view of the database and within
  which all its changes commit together or not at all. Handlers never touch `DbContext`, they ask the
  UoW for a repository, mutate through it, then call `SaveChangesAsync`, which also serializes and
  dispatches the domain events raised by tracked aggregates (the save flow lives in
  [`ApplicationDbContext`](#applicationdbcontext) in this group). `[Rubric §14, Testability]`: because
  everything routes through this interface, a test swaps the implementation for a mock and asserts
  handler behavior without a database.
- **Walkthrough**
  - `GetRepository<TEntity, TIdentifierType>()` (`IUnitOfWork.cs:19`): constrained to
    [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype),
    enforcing the DDD rule that only aggregate roots are directly persisted; returns a read-write
    [`IRepository`](#irepositorytentity-tidentifiertype). Passing a child entity fails at compile time.
  - `GetReadRepository<TEntity, TIdentifierType>()` (`IUnitOfWork.cs:29`): constrained to
    [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
    so it can read *any* entity (including children); returns a read-only
    [`IReadRepository`](#ireadrepositorytentity-tidentifiertype).
  - `SaveChangesAsync(CancellationToken)` (`IUnitOfWork.cs:36`) and `Save()` (`IUnitOfWork.cs:40`):
    the async persist (plus event dispatch) and its synchronous fallback; the doc comment prefers the
    async form.
  - `RequestIdentityInsert()` (`IUnitOfWork.cs:49`): a one-shot flag that lets the next save include
    explicit values for database-generated identity columns (e.g. imported data), wrapping such
    inserts in `SET IDENTITY_INSERT ON/OFF`; the flag auto-clears after the save.
  - `BeginTransaction()` / `CommitTransaction()` / `RollbackTransaction()` (`IUnitOfWork.cs:52-58`):
    manual transaction control for operations spanning multiple save points.
  - `ExecuteInTransactionAsync<TResult>(operation, CancellationToken)` (`IUnitOfWork.cs:70`): wraps
    the operation in the active execution strategy so a retrying strategy (e.g.
    `SqlServerRetryingExecutionStrategy`) can retry the whole transaction as one unit; commits on
    success, rolls back on exception. The doc comment (`IUnitOfWork.cs:60-66`) states this is the safe
    way to transact, bare `BeginTransaction` calls outside the strategy would break retry semantics.
- **Why it's built this way**: ADR-006 (database-per-service) means one host may touch several
  physical databases; the lower-level context factory coordinates the multiple sources, and
  `IUnitOfWork` sits above it as the per-command abstraction. Keeping it in `MMCA.Common.Application`
  (not Infrastructure) lets the Application layer depend on it without a reference to EF, satisfying
  `[Rubric §3, Clean Architecture]`.
- **Where it's used**: injected into every write command handler; used by the transactional command
  decorator (the CQRS pipeline, taught in the
  [primer](../00-primer.md#2-architectural-styles-this-codebase-commits-to)).

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
- **Why it's built this way**: ADR-006 (database-per-service) requires the same context class per
  database; without a specialized model-cache key EF would build one model and silently reuse it, so
  queries would hit tables that do not exist in the other databases. The single `ApplicationDbContext`
  is deliberately never split into per-module context classes (ADR-006). The interceptor pipeline keeps
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
  and "SQL Server / Identity" as distinct models. This is the critical enabler for ADR-006.
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
  replacements do not surface as user-facing 5xx (ADR-006, ADR-009).
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

### CosmosIntIdValueGenerator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.ValueGenerators` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ValueGenerators/CosmosIntIdValueGenerator.cs:16` · Level 0 · class (sealed)

- **What it is**: a process-level incrementing `int` ID generator for entities stored in Cosmos DB, which has no server-side identity columns the way SQL Server does.
- **Depends on**: `Microsoft.EntityFrameworkCore.ValueGeneration.ValueGenerator<int>` (the EF Core base) and `Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry`; both are external (EF Core), so not cross-linked.
- **Concept introduced**: `[Rubric §8, Data Architecture]` assesses how well the persistence model fits each engine's capabilities. SQL Server hands out identity values server-side; Cosmos does not, so an `int`-keyed entity routed to Cosmos needs a client-side generator. This class supplies one that stays lock-free and thread-safe.
- **Walkthrough**: `_seed` (`CosmosIntIdValueGenerator.cs:18`) is a static field initialised to `(int)(DateTimeOffset.UtcNow.ToUnixTimeSeconds() % int.MaxValue)`, seeding from the current Unix time so restarts begin at a different point and reduce collision probability. `GeneratesTemporaryValues` (`CosmosIntIdValueGenerator.cs:21`) returns `false`: the value produced is the real stored value, not a client-side placeholder EF will replace. `Next(EntityEntry entry)` (`CosmosIntIdValueGenerator.cs:24-25`) returns `Interlocked.Increment(ref _seed)`, an atomic increment with no `lock`.
- **Why it's built this way**: `Interlocked.Increment` avoids `lock` overhead on a hot path (every entity insert). The modulo on the seed prevents overflow at initialisation. The XML remarks (`CosmosIntIdValueGenerator.cs:11-14`) are explicit that collisions across separate process instances are possible; the accepted tradeoff for current usage, with GUID keys named as the alternative when strict uniqueness is required.
- **Where it's used**: wired into Cosmos entity type configurations via EF's value-generator hook; it is engine-specific and only relevant when the Cosmos engine ([CosmosDbContext](#cosmosdbcontext)) is in play.

---

### EncryptedStringConverter

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Encryption` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:28` · Level 0 · class (sealed)

- **What it is**: an EF Core `ValueConverter<string, string>` that encrypts a string property with AES-256-GCM before it is written to the database and decrypts it on read. It is applied per-property inside an entity type configuration.
- **Depends on**: `System.Security.Cryptography.AesGcm` and `RandomNumberGenerator`, `System.Text.Encoding`, and `Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter` (all external, not cross-linked).
- **Concept introduced**: `[Rubric §11, Security]` (protection of data at rest) and `[Rubric §30, Compliance/Privacy]` (handling of personal data). AES-256-GCM is authenticated encryption: it provides confidentiality (nobody without the key reads the plaintext) and integrity (tampering makes decryption throw rather than silently return garbage). A fresh 12-byte random nonce per write means two identical plaintexts encrypt to different ciphertexts, defeating frequency analysis. This is the mechanism the [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable) doc comment names for personal fields that must stay retrievable after other erasure steps.
- **Walkthrough**
  - `NonceSize = 12` and `TagSize = 16` (`EncryptedStringConverter.cs:31,34`): the GCM nonce (96 bits, NIST-recommended) and authentication tag (128 bits) sizes.
  - Constructor (`EncryptedStringConverter.cs:40-52`) takes a `byte[] encryptionKey`, passes `Encrypt`/`Decrypt` to the `ValueConverter` base, then validates the key is non-null and exactly 32 bytes (256 bits), throwing `ArgumentException` otherwise.
  - `GenerateKey()` (`EncryptedStringConverter.cs:58`) returns a cryptographically random 32-byte key via `RandomNumberGenerator.GetBytes(32)`, a convenience for initial setup.
  - `Encrypt` (`EncryptedStringConverter.cs:60-80`) short-circuits empty input, generates a random nonce, encrypts with `AesGcm`, then lays out `[nonce(12)][ciphertext(N)][tag(16)]` and returns `Convert.ToBase64String`.
  - `Decrypt` (`EncryptedStringConverter.cs:82-103`) base64-decodes, rejects anything too short to hold a nonce and tag with a `CryptographicException`, slices the three regions by fixed offsets using `Span<byte>`, and decrypts.
- **Why it's built this way**: GCM was chosen over CBC because the built-in authentication tag catches both accidental corruption and deliberate tampering without a separate HMAC pass. The 32-byte guard fails fast at construction rather than at first use. The key is passed in (never derived here) so key management lives with the host (Azure Key Vault, user-secrets, environment variables), not the converter.
- **Where it's used**: `[Rubric §11, Security]`: currently a provided-but-unadopted extension point. Verified by source search across all four repos: no entity configuration calls `HasConversion(new EncryptedStringConverter(...))`, and no DI registration supplies an encryption key. The only references are its own unit tests (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EncryptedStringConverterTests.cs`) and the prose pointer in [IAnonymizable](group-02-domain-building-blocks.md#ianonymizable). It is ready to apply in any `IEntityTypeConfiguration<T>.Configure` when a column genuinely needs at-rest encryption, but nothing does so today.

---

### IDbSeeder

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IDbSeeder.cs:7` · Level 0 · interface

- **What it is**: the one-method contract a module implements to populate its tables with initial reference data at startup.
- **Depends on**: only `System.Threading.CancellationToken`. Contrast it with `IModuleSeeder` (in the Application layer), which receives an `IServiceProvider` and is the orchestration layer that instantiates and runs an `IDbSeeder`.
- **Concept introduced**: `[Rubric §3, Clean Architecture]` assesses whether responsibilities sit in the correct layer. Seeding is split across two contracts. `IDbSeeder` is the Infrastructure-side contract: its implementations resolve persistence services and write data. `IModuleSeeder` is the Application-side contract that receives `IServiceProvider`, builds the concrete `IDbSeeder`, and drives it. Keeping the low-level write concern in Infrastructure keeps the Application layer from depending on EF directly.
- **Walkthrough**: a single member, `Task SeedAsync(CancellationToken cancellationToken)` (`IDbSeeder.cs:13`). No return payload; the implementation persists its own data.
- **Why it's built this way**: the interface is deliberately minimal so any module can supply a seeder without inheriting behavior; the shared behavior (identifier conversion) lives in the [DbSeeder](#dbseeder) base rather than here.
- **Where it's used**: implemented by [DbSeeder](#dbseeder) and, through it, by every module seeder (for example `CatalogModuleDbSeeder`, `IdentityModuleDbSeeder`, `ConferenceModuleDbSeeder`), each of which an `IModuleSeeder` in the module's API project instantiates and calls.

---

### IdentityInsertGroup

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:226` · Level 0 · record (private sealed, nested)

- **What it is**: a small private grouping record used inside [DbContextFactory](#dbcontextfactory) to collect the change-tracker entries destined for one table during a `SET IDENTITY_INSERT` save round.
- **Depends on**: `Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry` (external).
- **Concept introduced**: this is a supporting value type for the identity-insert mechanism taught under [DbContextFactory](#dbcontextfactory); it introduces no new pattern of its own. `[Rubric §8, Data Architecture]` applies only insofar as it models "which added rows target which table" so the save can toggle `IDENTITY_INSERT` one table at a time.
- **Walkthrough**: `private sealed record IdentityInsertGroup(string Schema, string Table, List<EntityEntry> Entries)` (`DbContextFactory.cs:226`). `Schema` and `Table` name the SQL Server table; `Entries` holds the Added entries with explicit (non-temporary) identity values bound for it. Instances are produced by `GetIdentityInsertGroups` (`DbContextFactory.cs:183-224`) and consumed by `SaveWithIdentityInsertAsync` (`DbContextFactory.cs:132-177`).
- **Why it's built this way**: a positional record is the least-ceremony way to bundle the three fields the identity-insert loop needs to iterate; being `private` keeps it an implementation detail of the factory, invisible to callers.
- **Where it's used**: solely within [DbContextFactory](#dbcontextfactory)'s SQL Server identity-insert path.

---

### DbSeeder

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:7` · Level 1 · class (abstract)

- **What it is**: the abstract base for module database seeders. It implements [IDbSeeder](#idbseeder) (leaving `SeedAsync` abstract) and adds one shared helper that converts an integer seed ID into whichever identifier type the module keys on.
- **Depends on**: [IDbSeeder](#idbseeder); BCL only otherwise (`Guid`, `BitConverter`, `Span<byte>`).
- **Concept introduced**: `[Rubric §8, Data Architecture]`: seed data is authored with plain `int` IDs, but modules key entities on either `int` or `Guid`. `GetId<TIdentifier>` bridges the two so the same seed literals work under either key strategy, and the `Guid` mapping is deterministic so reruns and test fixtures produce identical IDs.
- **Walkthrough**: `SeedAsync` (`DbSeeder.cs:10`) stays abstract; each module fills it in. `GetId<TIdentifier>(int id)` (`DbSeeder.cs:20-39`), constrained `where TIdentifier : notnull`, has three branches: for `Guid` it writes the int into a zeroed 16-byte `stackalloc` span via `BitConverter.TryWriteBytes` and returns a reproducible `Guid` (`DbSeeder.cs:23-31`); for `int` it passes the value straight through (`DbSeeder.cs:33-36`); any other type throws `NotSupportedException` (`DbSeeder.cs:38`).
- **Why it's built this way**: the deterministic `Guid` conversion (as opposed to `Guid.NewGuid()`) is what makes seed data stable across runs, so relationships wired by seed IDs and assertions in tests remain valid. Keeping this helper on the base means every seeder gets it without duplicating the conversion.
- **Where it's used**: subclassed by each module's Infrastructure seeder: `CatalogModuleDbSeeder`, `IdentityModuleDbSeeder`, and `SalesModuleDbSeeder` in Store, `ConferenceModuleDbSeeder` and `IdentityModuleDbSeeder` in ADC. Each is constructed (typically with an `IUnitOfWork`) and invoked by the matching `IModuleSeeder` in the module's API project.

---

### IDbContextFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IDbContextFactory.cs:11` · Level 7 · interface

- **What it is**: the scoped coordinator contract for [ApplicationDbContext](#applicationdbcontext) instances across multiple physical databases within one request. It caches one context per [DataSourceKey](#datasourcekey) in a scope, orchestrates multi-source saves and transactions, and abstracts the schema-lifecycle operations.
- **Depends on**: [ApplicationDbContext](#applicationdbcontext), [DataSourceKey](#datasourcekey), [DataSource](#datasource) (the engine enum); BCL `IDisposable` and `IAsyncDisposable`, which it extends (`IDbContextFactory.cs:11`).
- **Concept introduced**: `[Rubric §8, Data Architecture]` (a multi-database strategy with an explicit consistency contract) and `[Rubric §29, Resilience & Business Continuity]` (no two-phase commit; the outbox is the compensating mechanism). The doc comment on `ExecuteInTransactionAsync` (`IDbContextFactory.cs:65-77`) states the load-bearing invariant: when one operation touches multiple physical data sources, each source gets its own transaction and the commits are sequential and best-effort. A failure after the first commit but before the second leaves earlier sources committed. The [OutboxMessage](group-04-events-outbox.md#outboxmessage) pattern (ADR-003) is the cross-source consistency mechanism, and callers design multi-source writes accordingly.
- **Walkthrough**
  - `GetDbContext(DataSourceKey)` and `GetDbContext(DataSource)` (`IDbContextFactory.cs:17,24`): return the scope-cached context for a source; the `DataSource` overload targets that engine's `Default` source, preserving single-database call sites.
  - `SaveChangesAsync` and `SaveChanges` (`IDbContextFactory.cs:35,40`): save across every active context in the scope with audit stamping.
  - `RequestIdentityInsert()` (`IDbContextFactory.cs:48`): signals that the next save may include entities carrying explicit values for identity columns; the flag auto-clears after the save.
  - `BeginTransaction` / `CommitTransaction` / `RollbackTransaction` (`IDbContextFactory.cs:53,58,63`): fan out to all transaction-capable contexts.
  - `ExecuteInTransactionAsync<TResult>` (`IDbContextFactory.cs:78-80`): runs `operation` inside the active execution strategy so a retrying strategy can retry the whole unit.
  - `EnsureCreatedAsync`, `MigrateAsync`, `HasPendingMigrationsAsync` (`IDbContextFactory.cs:30,86,92`): schema lifecycle; `MigrateAsync` targets only SQL Server sources (Cosmos and SQLite are skipped).
- **Why it's built this way**: ADR-006 (database-per-service) means a single scope may hold several active contexts; this interface is the one place to obtain them without spawning competing instances, and the unit-of-work sits above it and delegates here.
- **Where it's used**: implemented by [DbContextFactory](#dbcontextfactory); injected into the unit-of-work, into seeders, and into migration/startup code.

---

### IPhysicalDbContextFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IPhysicalDbContextFactory.cs:14` · Level 7 · interface

- **What it is**: the primitive one-method factory that creates a raw, uncached [ApplicationDbContext](#applicationdbcontext) for a given physical source.
- **Depends on**: [ApplicationDbContext](#applicationdbcontext) and [DataSourceKey](#datasourcekey).
- **Concept introduced**: `[Rubric §2, Design Patterns]`: the Factory Method at its simplest, one input ([DataSourceKey](#datasourcekey)), one output (a fresh context). The doc comment (`IPhysicalDbContextFactory.cs:6-13`) makes the layering explicit: contexts created here are not scoped or cached; [IDbContextFactory](#idbcontextfactory) layers per-scope caching, save coordination, and transactions on top. The engine in the key selects the context class; the source name selects the database (connection string, migrations assembly, model).
- **Walkthrough**: a single member, `ApplicationDbContext Create(DataSourceKey key)` (`IPhysicalDbContextFactory.cs:21`).
- **Why it's built this way**: splitting "make one raw context for a key" from "cache contexts per scope and coordinate saves" lets [IDbContextFactory](#idbcontextfactory) be implemented without knowing which engine produces which concrete context.
- **Where it's used**: implemented by [PhysicalDbContextFactory](#physicaldbcontextfactory); consumed by [DbContextFactory](#dbcontextfactory) and by the `Default*` engine adapters.

---

### ApplicationDbContextEFFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/ApplicationDbContextEFFactory.cs:15` · Level 8 · class (sealed)

- **What it is**: an adapter that implements EF Core's own `IDbContextFactory<ApplicationDbContext>`, resolving the default engine from configuration and delegating to the matching engine-specific factory.
- **Depends on**: `Microsoft.EntityFrameworkCore.IDbContextFactory<TContext>` (external), [ApplicationDbContext](#applicationdbcontext), [DataSource](#datasource), and the three `IDbContextFactory<T>` engine adapters ([DefaultSqlServerDbContextFactory](#defaultsqlserverdbcontextfactory), [DefaultSqliteDbContextFactory](#defaultsqlitedbcontextfactory), [DefaultCosmosDbContextFactory](#defaultcosmosdbcontextfactory)) resolved from `IServiceProvider`.
- **Concept introduced**: `[Rubric §8, Data Architecture]`: this is the compatibility bridge for consumers (health checks, design-time tooling) that expect EF's `IDbContextFactory<ApplicationDbContext>` rather than the framework's [IDbContextFactory](#idbcontextfactory). It reads which engine is the host default and hands back a context for that engine's `Default` source.
- **Walkthrough**: the constructor (`ApplicationDbContextEFFactory.cs:25-32`) reads `DefaultDataSource`, falls back to `DataSource`, then defaults to `DataSource.SQLServer`, parsing case-insensitively and defaulting to SQL Server on a parse miss. `CreateDbContext()` (`ApplicationDbContextEFFactory.cs:35-41`) switches on the resolved `DataSource`: `CosmosDB`, `Sqlite`, or `SQLServer` each resolve the corresponding `IDbContextFactory<T>` and call its `CreateDbContext()`; any other value throws `InvalidOperationException`.
- **Why it's built this way**: it keeps EF's expected DI surface working after the move to per-physical-source instantiation, so tooling that constructs a context through `IDbContextFactory<ApplicationDbContext>` still resolves the correct engine for the `Default` source.
- **Where it's used**: resolved by anything expecting EF's `IDbContextFactory<ApplicationDbContext>`; it in turn resolves the `Default*` engine adapters below.

---

### DbContextFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:19` · Level 8 · class (sealed)

- **What it is**: the scoped implementation of [IDbContextFactory](#idbcontextfactory): it caches one [ApplicationDbContext](#applicationdbcontext) per physical [DataSourceKey](#datasourcekey) and orchestrates save, transaction, and disposal across all of them.
- **Depends on**: [IPhysicalDbContextFactory](#iphysicaldbcontextfactory) (which [PhysicalDbContextFactory](#physicaldbcontextfactory) implements), [IEntityDataSourceRegistry](#ientitydatasourceregistry), [IDataSourceResolver](#idatasourceresolver), and [ICurrentUserService](group-08-auth.md#icurrentuserservice) (all injected via primary constructor, `DbContextFactory.cs:19-29`).
- **Concept introduced**: `[Rubric §8, Data Architecture]` (per-source context caching, best-effort sequential transactions) and `[Rubric §29, Resilience]` (no distributed commit). Three mechanisms carry the section:
  - **Per-source caching and late enlistment.** `_dbContexts` (`DbContextFactory.cs:34`) holds one context per source so every repository in the scope shares one change tracker. `GetDbContext(DataSourceKey)` (`DbContextFactory.cs:52-67`) lazily creates and caches, and if a transaction is already active it immediately calls `BeginTransaction()` on the late-created context (`DbContextFactory.cs:63-64`) so all writes in a transactional command share one boundary.
  - **Best-effort sequential transactions.** `BeginTransaction` / `CommitTransaction` / `RollbackTransaction` (`DbContextFactory.cs:237-256`) each iterate the transaction-capable contexts; Cosmos is excluded through `SupportsTransactions` (`DbContextFactory.cs:329-330`). `ExecuteInTransactionAsync` (`DbContextFactory.cs:263-304`) obtains an EF execution strategy from the first transactional context (creating the SQL Server default if none exists yet), then begins, runs, and commits inside `strategy.ExecuteAsync`, rolling back on cancellation or exception. The doc comment (`DbContextFactory.cs:258-262`) states plainly there is no two-phase commit; the outbox is the cross-source consistency mechanism.
  - **`SET IDENTITY_INSERT` handling.** When `RequestIdentityInsert()` (`DbContextFactory.cs:124`) has set the one-shot flag, `SaveChangesAsync` (`DbContextFactory.cs:103-121`) routes SQL Server contexts through `SaveWithIdentityInsertAsync` (`DbContextFactory.cs:132-177`). `GetIdentityInsertGroups` (`DbContextFactory.cs:183-224`) scans the change tracker for Added entities whose single-column PK is a SQL Server identity column carrying an explicit (non-temporary) value and buckets them by `(schema, table)` into [IdentityInsertGroup](#identityinsertgroup) records. The save loop then handles one table at a time: it flips other tables' Added entries to `Unchanged` to respect SQL Server's one-table constraint, runs `SET IDENTITY_INSERT ... ON`, saves, runs `... OFF`, and restores the hidden entries (`DbContextFactory.cs:144-168`). A `CA2100` suppression is justified because the table and schema names come from EF metadata, not user input (`DbContextFactory.cs:101-102`).
- **Why it's built this way**: ADR-006: each service owns its database, so a scope may touch several contexts and this factory is what makes "one logical save" span them. Skipping two-phase commit is deliberate; the outbox provides at-least-once cross-source consistency instead. The identity-insert path exists for import flows that carry externally assigned IDs (for example Sessionize IDs).
- **Where it's used**: the unit-of-work delegates its save and transaction calls here; the outbox processor and cleanup services resolve contexts through it. Disposal fans out to every cached context (`DbContextFactory.cs:335-365`).

---

### DefaultCosmosDbContextFactory
### DefaultSqliteDbContextFactory
### DefaultSqlServerDbContextFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs` · Level 8 · classes (internal sealed)

These three near-identical adapters share one section (structurally identical: same wrapping factory, differing only in engine constant and cast).

Three near-identical adapters that preserve EF Core's `IDbContextFactory<TContext>` DI surface for each concrete engine context after the move to per-physical-source instantiation. Each wraps [IPhysicalDbContextFactory](#iphysicaldbcontextfactory) and returns a context for its engine's `Default` physical source, matching the pre-multi-database behavior consumers such as [ApplicationDbContextEFFactory](#applicationdbcontexteffactory) and health checks expect.

| Type | File:Line | Returns |
|------|-----------|---------|
| `DefaultSqlServerDbContextFactory` | `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:13` | `(SQLServerDbContext)physicalFactory.Create(DataSourceKey.Default(DataSource.SQLServer))` (`:17-18`) |
| `DefaultSqliteDbContextFactory` | `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:22` | `(SqliteDbContext)physicalFactory.Create(DataSourceKey.Default(DataSource.Sqlite))` (`:26-27`) |
| `DefaultCosmosDbContextFactory` | `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:31` | `(CosmosDbContext)physicalFactory.Create(DataSourceKey.Default(DataSource.CosmosDB))` (`:35-36`) |

- **What they are**: thin `IDbContextFactory<T>` adapters, one per engine ([SQLServerDbContext](#sqlserverdbcontext), [SqliteDbContext](#sqlitedbcontext), [CosmosDbContext](#cosmosdbcontext)). They differ only in the engine constant and the cast.
- **Depends on**: [IPhysicalDbContextFactory](#iphysicaldbcontextfactory) (primary-constructor parameter on all three), [DataSourceKey](#datasourcekey), and [DataSource](#datasource); the EF `IDbContextFactory<TContext>` interface (external).
- **Concept reinforced**: `[Rubric §2, Design Patterns]` (Adapter): they exist purely to keep EF's `IDbContextFactory<TContext>` contract satisfiable for callers that predate the physical-factory split, delegating the real construction to [PhysicalDbContextFactory](#physicaldbcontextfactory) via `DataSourceKey.Default(engine)`.
- **Why it's built this way**: grouping them into one small file avoids three near-empty files, and each stays `internal sealed` because only DI and [ApplicationDbContextEFFactory](#applicationdbcontexteffactory) resolve them.
- **Where they're used**: resolved by [ApplicationDbContextEFFactory](#applicationdbcontexteffactory) (the engine switch) and by health checks that want a `Default`-source context for one engine.

---

### PhysicalDbContextFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:16` · Level 8 · class (sealed)

- **What it is**: the singleton [IPhysicalDbContextFactory](#iphysicaldbcontextfactory) implementation that constructs concrete engine context instances directly, resolving connection information through [IDataSourceResolver](#idatasourceresolver).
- **Depends on**: `IServiceProvider`, [IDataSourceResolver](#idatasourceresolver), and [IEntityConfigurationAssemblyProvider](#ientityconfigurationassemblyprovider) (primary constructor, `PhysicalDbContextFactory.cs:16-19`); constructs [SQLServerDbContext](#sqlserverdbcontext), [SqliteDbContext](#sqlitedbcontext), or [CosmosDbContext](#cosmosdbcontext), each taking a per-source [PhysicalDataSource](#physicaldatasource).
- **Concept introduced**: `[Rubric §2, Design Patterns]` (an Abstract-Factory-style engine switch) and `[Rubric §8, Data Architecture]` (the never-pool correctness rule). The class comment (`PhysicalDbContextFactory.cs:7-15`) is a load-bearing warning: these contexts must never be pooled (`AddPooledDbContextFactory`), because each instance carries per-source constructor state ([PhysicalDataSource](#physicaldatasource)) that pooling would reuse across sources, silently pointing repositories at the wrong database.
- **Walkthrough**: three static empty `DbContextOptions<T>` fields (`PhysicalDbContextFactory.cs:24-31`) are shared across calls; the comment (`PhysicalDbContextFactory.cs:21-23`) explains all real configuration (provider, connection, interceptors, model cache key) happens in each context's `OnConfiguring`, so the options are intentionally empty and match the old `AddDbContextFactory<T>()` registrations. `Create(DataSourceKey key)` (`PhysicalDbContextFactory.cs:34-45`) resolves the [PhysicalDataSource](#physicaldatasource) via `resolver.GetPhysical(key)`, then switches on `key.Engine` to `new` the matching context (passing the shared options, `serviceProvider`, `assemblyProvider`, and the resolved physical source); an unknown engine throws `InvalidOperationException`.
- **Why it's built this way**: separating "make one raw context for a key" (this singleton) from "cache contexts per scope and coordinate saves" ([DbContextFactory](#dbcontextfactory)) is the split that makes multi-database routing work; the no-pool rule is the subtle correctness invariant that split protects.
- **Where it's used**: [DbContextFactory](#dbcontextfactory) calls `Create` for every source it caches; the `Default*` engine adapters and health checks call it for `Default`-source contexts.

### NativePushPayloads

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NativePushPayloads.cs:10` · Level 0 · class (internal static)

- **What it is**: a pure helper that builds the platform-native JSON bodies (FCM v1 for Android, APNs for Apple) and the `user:{id}` OR-tag expressions that an Azure Notification Hubs send needs. It holds no state and touches no hub, so the payload shapes and the tag-chunking rule are unit-testable in isolation (`NativePushPayloads.cs:5-10`).
- **Depends on**: the BCL only: `System.Text.Json.JsonSerializer` for the payload strings, `Enumerable.Chunk` for the OR-expression batching, and the `UserIdentifierType` alias (see [primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to)) for the user-tag input.
- **Concept introduced, native push payload construction and the 20-tag chunk rule.** `[Rubric §7, Microservices Readiness]` assesses whether cross-cutting delivery mechanics live behind a reusable, transport-specific boundary rather than smeared through handlers; here the exact wire shapes of two third-party push protocols are pinned in one place. Azure Notification Hubs caps a single tag expression at 20 tags (`MaxTagsPerExpression`, `NativePushPayloads.cs:13`), so a user-targeted broadcast to a large audience is split into `Chunk(20)` groups, each rendered as a `user:a || user:b || ...` OR-expression (`NativePushPayloads.cs:59-63`). That cap is a real hub limit, not an arbitrary batch size, which is why it is a named constant the sender reuses rather than a literal.
- **Walkthrough**: `BuildFcmV1Payload` (`NativePushPayloads.cs:16-28`) nests a `notification` block of `title`/`body` under a `message` envelope, adding a `data` map only when metadata is non-empty (`{ Count: > 0 }` pattern, line 22). `BuildApnsPayload` (`NativePushPayloads.cs:31-53`) builds the APNs `aps.alert` block, then copies each metadata pair up to the top level as a custom key while explicitly refusing to overwrite the reserved `aps` key (`NativePushPayloads.cs:44-49`). `BuildUserTagExpressions` (`NativePushPayloads.cs:59-63`) maps each id through `UserTag`, chunks, and joins. `UserTag` (`NativePushPayloads.cs:66-67`) formats `user:{userId}` under `InvariantCulture` via `string.Create`, so a numeric id never picks up a locale-specific separator.
- **Why it's built this way**: keeping the payload shapes and the hub's tag cap in a stateless helper (ADR-044) means the [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) stays a thin adapter and the fiddly JSON/tag rules can be proven correct without a live hub or credentials.
- **Where it's used**: consumed by [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) (payloads and tag expressions) and [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) (the `UserTag` stamped on each installation).
- **Caveats / not-in-source**: `internal`, so it is reachable only inside `MMCA.Common.Infrastructure` and its `InternalsVisibleTo` test project.

### AzureNotificationHubNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubNativePushSender.cs:14` · Level 1 · class (sealed partial)

- **What it is**: the Azure Notification Hubs implementation of `INativePushSender`: the real, mobile-facing native notification channel that pushes FCM v1 and APNs payloads through a hub client (`AzureNotificationHubNativePushSender.cs:7-16`).
- **Depends on**: [`INativePushSender`](#inativepushsender) (the contract it fulfills), [`NativePushPayloads`](#nativepushpayloads) (payload + tag construction), and two externals: `Microsoft.Azure.NotificationHubs.INotificationHubClient` (the hub SDK) and `ILogger<T>`.
- **Concept introduced, the native (mobile) push channel and its best-effort contract.** `[Rubric §13, Observability & Operability]` covers whether side-effecting integrations log their outcomes and fail without taking the request down; this sender emits a structured log per send (`LogNativePushSent`, `AzureNotificationHubNativePushSender.cs:42-43`) and its class comment records that callers treat the channel as best-effort, wrapping it in a non-fatal catch (`AzureNotificationHubNativePushSender.cs:11-12`). This is the device-facing counterpart to the in-app SignalR channel: [`NullPushNotificationSender`](group-10-notifications.md#nullpushnotificationsender) and its SignalR sibling deliver to connected web clients, whereas this reaches devices via APNs/FCM.
- **Walkthrough**: the primary constructor takes the hub client and logger (`AzureNotificationHubNativePushSender.cs:14-16`). `SendToUsersAsync` (`AzureNotificationHubNativePushSender.cs:19-31`) builds both payloads once, then for each 20-tag OR-expression sends an `FcmV1Notification` and an `AppleNotification` targeted at that expression (`AzureNotificationHubNativePushSender.cs:24-28`), so one call fans out to both platforms per audience chunk. `BroadcastAsync` (`AzureNotificationHubNativePushSender.cs:34-40`) sends the same two payloads with no tag filter, reaching every registered installation. Both `ConfigureAwait(false)` on every await (infrastructure code, no sync context needed) and log the title on completion.
- **Why it's built this way**: the `partial` class exists so the `[LoggerMessage]` source generator can emit `LogNativePushSent` (`AzureNotificationHubNativePushSender.cs:42-43`), the high-performance logging pattern used across the framework. Splitting payload construction into [`NativePushPayloads`](#nativepushpayloads) (ADR-044) keeps this type a pure transport adapter.
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
- **Why it's built this way**: ADR-044 gives the framework three notification channels; a no-op default keeps the native channel optional so a host that never configures a hub still composes and runs.
- **Where it's used**: registered as the default `INativePushSender`; paired with [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar), the no-op registrar for the same disabled-hub scenario.

### SoftDeleteUniqueIndexConvention

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:24` · Level 1 · class (sealed)

- **What it is**: an EF Core **model-finalizing convention** that appends an `IsDeleted = 0` filter to every unique index on a soft-deletable entity type, so a soft-deleted row stops occupying its unique slot (`SoftDeleteUniqueIndexConvention.cs:10-24`).
- **Depends on**: [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) (the soft-delete marker it tests for) and the [`DataSource`](#datasource) engine enum; externally, EF Core's convention metadata API (`IModelFinalizingConvention`, `IConventionModelBuilder`, `IConventionEntityType`, `IConventionIndex`).
- **Concept introduced, filtered (partial) unique indexes as the database half of soft delete.** `[Rubric §8, Data Architecture]` assesses whether the storage model actually enforces the semantics the application presents, and `[Rubric §16, Maintainability]` assesses whether a cross-cutting rule is applied once centrally instead of remembered per entity. Soft delete (see [primer §2](../00-primer.md#2-architectural-styles-this-codebase-commits-to)) hides a row behind a global query filter, but the row is still physically present, so a plain unique index keeps rejecting a new record that reuses the deleted one's value: delete a speaker and that email address stays permanently unusable (`SoftDeleteUniqueIndexConvention.cs:11-16`). A filtered index solves this by indexing only live rows. Making it a convention means no entity configuration author has to remember the rule.
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
- **Concept introduced, design-time context construction for database-per-service.** `[Rubric §8, Data Architecture]` assesses whether each database's migrations are built in isolation; in the database-per-service model (ADR-006) each module's migrations project must scaffold a context for only its own database. At design time there is no DI container and no AppDomain scan, so this options object captures everything `dotnet ef` cannot discover on its own: the top-level connection strings including `SQLServerMigrationsAssembly` (`DesignTimeDbContextOptions.cs:20-24`), the named `DataSources` entries (`DesignTimeDbContextOptions.cs:26-27`), and the explicit configuration assemblies (`DesignTimeDbContextOptions.cs:29-33`, whose comment notes the runtime scan sees nothing here).
- **Walkthrough**: `DataSourceName` (`DesignTimeDbContextOptions.cs:18`) is optional; when null the helper parses `--datasource` and falls back to `Default`. `AddConfigurationAssembly` (`DesignTimeDbContextOptions.cs:38-47`) is a chainable builder method that guards against duplicate registrations before adding.
- **Why it's built this way**: a single options object plus a builder method keeps each per-module migrations factory to a handful of lines while still pinning the model to one database (ADR-006).
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
- **Concept introduced, automatic cross-database relationship degradation.** `[Rubric §8, Data Architecture]` assesses the database-per-service consistency strategy, and `[Rubric §7, Microservices Readiness]` assesses whether the model adapts to the deployment topology without per-entity code. Under database-per-service (ADR-006) a database cannot enforce a foreign key that points into another database, so this convention strips those relationships automatically at model finalization. The scalar column survives (a query can still filter on, say, a `UserId`), cross-source loading is left to `INavigationPopulator` batch loading (ADR-002, see [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)), and cross-source consistency is the outbox's job (`CrossDataSourceDegradeConvention.cs:12-21`). The closing remark is the load-bearing invariant: when every entity resolves to the same physical source (the monolith-collapse case) nothing is foreign and the convention is a structural no-op, so the collapsed model is identical to the single-database model (`CrossDataSourceDegradeConvention.cs:25-29`).
- **Walkthrough**
  - The primary constructor takes the `contextKey` (the physical source whose model is being built) and the [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`CrossDataSourceDegradeConvention.cs:33-35`); `IsForeign` (`CrossDataSourceDegradeConvention.cs:91-94`) asks the registry for a CLR type's key and returns true when it differs from `contextKey`.
  - `ProcessModelFinalizing` (`CrossDataSourceDegradeConvention.cs:38-89`) casts the model to the **mutable** surface (`CrossDataSourceDegradeConvention.cs:46`) deliberately: cross-cutting helpers (soft-delete filters, concurrency tokens) promote every entity type to the Explicit configuration source, which convention-sourced builder calls cannot override (`CrossDataSourceDegradeConvention.cs:22-24,44-45`). It collects the non-owned foreign entity types (`CrossDataSourceDegradeConvention.cs:48-50`) and returns early when there are none (`CrossDataSourceDegradeConvention.cs:52-55`).
  - Step 1 (`CrossDataSourceDegradeConvention.cs:62-74`): for every *local* dependent it degrades each declared FK pointing at a foreign principal. `addCompensatingIndex` is false for Cosmos (`CrossDataSourceDegradeConvention.cs:65`), because Cosmos auto-indexes every property and rejects explicit index definitions; that skip is what makes one configuration body portable to Cosmos without edits (`CrossDataSourceDegradeConvention.cs:100-105`).
  - `DegradeForeignKey` (`CrossDataSourceDegradeConvention.cs:107-138`) keeps the non-shadow scalar FK properties, removes the FK (`CrossDataSourceDegradeConvention.cs:116`), then eagerly drops the convention-created FK index before the coverage check (`CrossDataSourceDegradeConvention.cs:123-130`), because EF's deferred event processing would otherwise remove it *after* the check and leave the column unindexed. It adds a plain index only when `HasCoveringIndex` (`CrossDataSourceDegradeConvention.cs:140-144`) finds no existing index covering those columns as a prefix.
  - Step 2 (`CrossDataSourceDegradeConvention.cs:79-82`): `IgnoreForeignMembers` (`CrossDataSourceDegradeConvention.cs:151-165`) removes skip navigations to foreign types and ignores any CLR property whose (collection-unwrapped) type is a foreign entity, so model validation does not later reject an unmapped entity-typed property; `UnwrapCollectionElementType` (`CrossDataSourceDegradeConvention.cs:171-174`) handles the `List<T>` / `ICollection<T>` case.
  - Step 3 (`CrossDataSourceDegradeConvention.cs:84-88`): removes the foreign entity types from the model.
- **Why it's built this way**: degrading in a convention rather than per-configuration means no module author has to remember to break a cross-service relationship by hand; the same configuration class works whether its module ships inside the monolith or as its own service (ADR-006, ADR-007).
- **Where it's used**: registered per context in `ApplicationDbContext.ConfigureConventions` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:146`), just before [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention); [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory) (`ApplicationDbContext.cs:131`) ensures each database caches its own degraded model rather than reusing one built for a different source.

### DataSourceService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12` · Level 3 · class (sealed)

- **What it is**: the application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry): given an entity type (or its full name) it answers which physical data source that entity lives in, and whether two entities can be EF-`Include`d together (`DataSourceService.cs:6-12`).
- **Depends on**: [`IDataSourceService`](#idatasourceservice) (the contract), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (the eager routing table it delegates to), and the [`DataSourceKey`](#datasourcekey) / [`DataSource`](#datasource) value types.
- **Concept reinforced, entity-to-database routing as a query surface.** `[Rubric §8, Data Architecture]` assesses whether database-per-service routing is a first-class, queryable concept; the registry aggregates every `[UseDataSource]` / `[UseDatabase]` declaration at startup, and this facade is the thin runtime interface over it. Because the registry is built eagerly from configuration assemblies (`DataSourceService.cs:8-11`), resolution no longer waits for an EF model to be built, which matters for the navigation classification that runs before any query.
- **Walkthrough**: the four `GetDataSource*` overloads (`DataSourceService.cs:15-24`) forward straight to the registry, returning either the full [`DataSourceKey`](#datasourcekey) or just its `Engine` ([`DataSource`](#datasource)). `HaveIncludeSupport(DataSourceKey, DataSourceKey)` (`DataSourceService.cs:31-32`) encodes the eager-loading rule: an EF `Include` is valid only when both entities resolve to the *same* key **and** that engine is not Cosmos (`first == second && first.Engine != DataSource.CosmosDB`), because Cosmos has no cross-document joins. The string overload (`DataSourceService.cs:35-38`) resolves both names through `TryGetDataSourceKey` and defers to the key overload, returning false if either name is unknown.
- **Why it's built this way**: keeping the include-support rule in one predicate lets the navigation populators and cross-source degrade logic ask a single authority whether a relationship can be loaded in-database versus batch-loaded across sources (ADR-006). Facading the registry keeps callers off its lower-level API.
- **Where it's used**: injected wherever code must classify a navigation or pick a context for an entity: the cross-data-source degrade convention and the navigation-populator batching path both consult it.

### AzureBlobFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureBlobFileStorageService.cs:15` · Level 4 · class (sealed)

- **What it is**: the Azure Blob Storage implementation of `IFileStorageService`: uploads and deletes blobs in the single configured container, returning [`Result`](group-01-result-error-handling.md#result) instead of throwing (`AzureBlobFileStorageService.cs:10-17`).
- **Depends on**: [`IFileStorageService`](#ifilestorageservice), the [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error) types, and Azure externals `BlobContainerClient` / `BlobUploadOptions` / `RequestFailedException` plus `ILogger<T>`.
- **Concept introduced, the file-storage boundary and Result-wrapped I/O.** `[Rubric §10, Cross-Cutting Concerns]` covers pushing infrastructure integrations behind an application-owned contract; here blob I/O is hidden behind `IFileStorageService` and every SDK failure is caught and mapped to a domain [`Error`](group-01-result-error-handling.md#error) rather than bubbling as an exception. `IsConfigured => true` (`AzureBlobFileStorageService.cs:20`) is the flag that distinguishes this live implementation from the [`NullFileStorageService`](#nullfilestorageservice) fallback.
- **Walkthrough**: the constructor takes an already-scoped `BlobContainerClient` and a logger (`AzureBlobFileStorageService.cs:15-17`); the class comment notes the container and its access level are provisioned by infrastructure, not created here (`AzureBlobFileStorageService.cs:12-13`). `UploadAsync` (`AzureBlobFileStorageService.cs:23-43`) gets a blob client, uploads with an explicit `ContentType` header, and returns `Result.Success(blobClient.Uri)`; a `RequestFailedException` is logged and mapped to `Error.Failure("FileStorage.UploadFailed", ...)` (`AzureBlobFileStorageService.cs:35-42`). `DeleteAsync` (`AzureBlobFileStorageService.cs:46-62`) calls `DeleteBlobIfExistsAsync` (idempotent) and maps failures to `FileStorage.DeleteFailed`.
- **Why it's built this way**: ADR-045 introduces the file-storage/image pipeline; returning `Result` keeps storage failures on the same error-handling rail as the rest of the stack, and catching only `RequestFailedException` means genuinely unexpected errors still surface.
- **Where it's used**: registered by `AddAzureBlobFileStorage(configuration)` in place of [`NullFileStorageService`](#nullfilestorageservice); consumed by feature handlers that persist uploaded files (typically after [`ImageSharpImageProcessor`](#imagesharpimageprocessor) has normalized the bytes).

### AzureNotificationHubDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubDeviceRegistrar.cs:15` · Level 4 · class (sealed)

- **What it is**: the Azure Notification Hubs implementation of `IPushDeviceRegistrar`: registers (upserts) and unregisters a device's push installation using the hub's installation model, stamping each installation with its owner's `user:{id}` tag (`AzureNotificationHubDeviceRegistrar.cs:10-17`).
- **Depends on**: [`IPushDeviceRegistrar`](#ipushdeviceregistrar), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest) (the inbound DTO), [`NativePushPayloads.UserTag`](#nativepushpayloads) (the owner tag), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and Azure externals `INotificationHubClient` / `Installation` / `MessagingException`.
- **Concept introduced, device registration via the installation model.** `[Rubric §11, Security]` includes owner-scoping of side channels; by stamping every installation with `NativePushPayloads.UserTag(userId)` (`AzureNotificationHubDeviceRegistrar.cs:41`) the registrar guarantees a later user-targeted send reaches only that user's devices. The installation model uses client-owned stable ids with full upsert semantics (`AzureNotificationHubDeviceRegistrar.cs:11-13`), so re-registering the same device is idempotent rather than duplicating.
- **Walkthrough**: `UpsertAsync` (`AzureNotificationHubDeviceRegistrar.cs:20-57`) first maps the request's platform string to a `NotificationPlatform` via a `switch` over `FCMV1`/`APNS` (`AzureNotificationHubDeviceRegistrar.cs:22-27`); an unrecognized value returns `Error.Validation("PushDevice.UnsupportedPlatform", ...)` before any hub call (`AzureNotificationHubDeviceRegistrar.cs:28-34`). It then builds an `Installation` with the client id, platform, push channel, and the single user tag (`AzureNotificationHubDeviceRegistrar.cs:36-42`) and calls `CreateOrUpdateInstallationAsync`, mapping a `MessagingException` to `PushDevice.UpsertFailed`. `DeleteAsync` (`AzureNotificationHubDeviceRegistrar.cs:60-80`) deletes the installation but treats `MessagingEntityNotFoundException` as success (`AzureNotificationHubDeviceRegistrar.cs:67-71`): an unknown installation is already in the desired state, so delete is idempotent.
- **Why it's built this way**: ADR-044's native channel needs a way to associate devices with users; the tag-per-installation approach lets sends target `user:{id}` OR-expressions without the app keeping its own device table. Idempotent delete keeps client retries safe.
- **Where it's used**: registered by `AddNativePushNotifications()` in place of [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar); called by the Devices endpoints and paired with [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) for the send side.

### ImageSharpImageProcessor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ImageSharpImageProcessor.cs:14` · Level 4 · class (sealed)

- **What it is**: the ImageSharp implementation of `IImageProcessor`: it decodes an uploaded image, re-orients and crops it to a square, strips all metadata, and re-encodes it as JPEG, returning the bytes as a [`Result`](group-01-result-error-handling.md#result) (`ImageSharpImageProcessor.cs:9-17`).
- **Depends on**: [`IImageProcessor`](#iimageprocessor), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and the SixLabors.ImageSharp externals (`Image`, `Mutate`, `ResizeOptions`, `JpegEncoder`).
- **Concept introduced, full re-encode as a security control.** `[Rubric §11, Security]` and `[Rubric §30, Compliance/Privacy/Data Governance]` both apply: decoding to pixels and re-encoding is deliberate so that EXIF metadata (including GPS coordinates, which are PII) and any polyglot payload smuggled into the original file are discarded, since only pixels survive the round trip (`ImageSharpImageProcessor.cs:9-13`). This is a defense against both privacy leaks and image-parser exploits, not merely a resize.
- **Walkthrough**: `NormalizeToSquareJpegAsync` (`ImageSharpImageProcessor.cs:17-51`) loads the stream, then `Mutate`s with `AutoOrient()` *before* stripping metadata so a portrait phone photo is not left rotated (`ImageSharpImageProcessor.cs:23-31`), and resizes to `size x size` with `ResizeMode.Crop`. It then nulls out the EXIF, XMP, and IPTC profiles (`ImageSharpImageProcessor.cs:33-35`) and saves to a `MemoryStream` with `JpegEncoder { Quality = 85 }` (`ImageSharpImageProcessor.cs:40`), returning `Result.Success(output.ToArray())`. An `UnknownImageFormatException` or `InvalidImageContentException` is caught and mapped to `Error.Validation("Image.Undecodable", ...)` (`ImageSharpImageProcessor.cs:44-50`), so a garbage upload becomes a clean validation failure rather than a 500.
- **Why it's built this way**: ADR-045 pairs storage with sanitization; ordering `AutoOrient` before metadata removal is the subtle correctness detail, and quality 85 is the standard size/quality trade-off. Catching only the two ImageSharp decode exceptions keeps unexpected faults visible.
- **Where it's used**: invoked by feature handlers before an avatar or image upload is handed to [`AzureBlobFileStorageService`](#azureblobfilestorageservice); it has no configured/unconfigured split (there is no Null variant) because processing needs no external resource.

### NullFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullFileStorageService.cs:11` · Level 4 · class (sealed)

- **What it is**: the unconfigured-host fallback for `IFileStorageService`: uploads fail with a clear error while deletes succeed, so file features degrade cleanly instead of crashing (`NullFileStorageService.cs:6-11`).
- **Depends on**: [`IFileStorageService`](#ifilestorageservice) and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept reinforced, asymmetric Null Object (fail-closed write, no-op delete).** `[Rubric §2, Design Patterns]` and `[Rubric §10, Cross-Cutting Concerns]`: unlike a pure no-op, this fallback distinguishes its two operations by intent. `IsConfigured => false` (`NullFileStorageService.cs:14`) lets callers detect the disabled channel; `UploadAsync` returns `Error.Failure("FileStorage.NotConfigured", ...)` (`NullFileStorageService.cs:17-21`) so a write fails loudly and predictably, while `DeleteAsync` returns `Result.Success()` (`NullFileStorageService.cs:24-25`) because there is nothing to delete and a delete of a non-existent file is already the desired state.
- **Why it's built this way**: ADR-045 makes storage optional; failing uploads with a typed error (rather than a null-reference crash) keeps a host with no storage configured running and honest about what it cannot do.
- **Where it's used**: the default `IFileStorageService`, swapped for [`AzureBlobFileStorageService`](#azureblobfilestorageservice) by `AddAzureBlobFileStorage(configuration)`.

### NullPushDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullPushDeviceRegistrar.cs:12` · Level 4 · class (sealed)

- **What it is**: the no-op default for `IPushDeviceRegistrar`: it accepts and discards device registrations so clients can call the Devices endpoints unconditionally, storing nothing until a hub is configured (`NullPushDeviceRegistrar.cs:7-12`).
- **Depends on**: [`IPushDeviceRegistrar`](#ipushdeviceregistrar), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest), and [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, the Null Object pattern for the disabled native channel.** `[Rubric §2, Design Patterns]`: both `UpsertAsync` and `DeleteAsync` return `Result.Success()` (`NullPushDeviceRegistrar.cs:15-20`), so the Devices API is always callable and simply does nothing when no notification hub is wired up. It is the device-registration twin of [`NullNativePushSender`](#nullnativepushsender), which no-ops the send side of the same disabled channel (ADR-044).
- **Why it's built this way**: keeping registration a success (rather than an error) means a client that always registers on launch is not blocked by a host that has not enabled native push; the channel becomes real only when [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) is registered.
- **Where it's used**: the default `IPushDeviceRegistrar`, replaced by [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) when `AddNativePushNotifications()` runs with an enabled hub.

### DesignTimeDbContextHelper

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:34` · Level 8 · class (static)

- **What it is**: a static helper that builds a [`SQLServerDbContext`](#sqlserverdbcontext) for `dotnet ef` design-time commands **without** the application's DI container, so each per-database migrations project reduces to a few lines (`DesignTimeDbContextHelper.cs:16-34`).
- **Depends on**: EF Core (`DbContextOptionsBuilder`, `IDesignTimeDbContextFactory`), the data-source resolution stack ([`DataSourceResolver`](#datasourceresolver), [`EntityDataSourceRegistry`](#entitydatasourceregistry), [`DataSourcesSettings`](group-14-module-system-composition.md#datasourcessettings)), the save interceptors ([`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor), [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)), [`IOutboxSignal`](group-04-events-outbox.md#ioutboxsignal)/[`OutboxSignal`](group-04-events-outbox.md#outboxsignal), and its own two private nested leaves [`ExplicitAssemblyProvider`](#explicitassemblyprovider) and [`NullDomainEventDispatcher`](#nulldomaineventdispatcher).
- **Concept introduced, design-time context construction for migrations-per-database.** `[Rubric §17, DevOps]` and `[Rubric §33, Developer Experience]`: database-per-service (ADR-006) needs one migrations project per database, and scaffolding a migration must not require standing up the whole app. `CreateSqlServer(args, configure)` (`DesignTimeDbContextHelper.cs:43-81`) lets a migrations project implement EF's `IDesignTimeDbContextFactory<SQLServerDbContext>` in a callback that supplies connection settings and configuration assemblies (the pattern is shown in the class doc, `DesignTimeDbContextHelper.cs:20-30`).
- **Walkthrough**: `CreateSqlServer` (`DesignTimeDbContextHelper.cs:43-81`) validates its arguments, runs the caller's `configure` over a fresh [`DesignTimeDbContextOptions`](#designtimedbcontextoptions), then resolves the logical source name in priority order: the explicit `DataSourceName`, else `--datasource` from args, else `DataSourceKey.DefaultName` (`DesignTimeDbContextHelper.cs:51-53`). It builds an [`ExplicitAssemblyProvider`](#explicitassemblyprovider) from the listed assemblies, a [`DataSourceResolver`](#datasourceresolver) with null logging, and an [`EntityDataSourceRegistry`](#entitydatasourceregistry) (`DesignTimeDbContextHelper.cs:55-60`), then hand-builds a minimal `ServiceCollection` wiring `TimeProvider.System`, null loggers, the [`NullDomainEventDispatcher`](#nulldomaineventdispatcher), an [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), both interceptors, and the resolver/registry (`DesignTimeDbContextHelper.cs:62-72`). Finally it resolves the physical source and constructs the [`SQLServerDbContext`](#sqlserverdbcontext) with an empty options builder plus that provider (`DesignTimeDbContextHelper.cs:74-81`), so the built model contains only the selected source's entities. `ParseDataSourceName` (`DesignTimeDbContextHelper.cs:86-104`) reads `--datasource <Name>` or `--datasource=Name`, throwing if the flag is present with no value.
- **Why it's built this way**: ADR-006 requires per-database migrations; a shared design-time helper keeps each migrations project trivial and avoids booting the full application DI graph just to scaffold a migration. Null loggers and a null dispatcher are the minimal stand-ins for services that are irrelevant when no save ever runs.
- **Where it's used**: called from each per-database migrations factory, for example the `MMCA.ADC.Migrations.SqlServer.{Identity,Conference,Engagement}` projects, and invoked as `dotnet ef migrations add X --project ... -- --datasource <Name>` (`DesignTimeDbContextHelper.cs:31`).

### CapturedState

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:268` · Level 2 · record (sealed, private nested)

- **What it is**: a private nested record inside [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) that carries everything captured *before* a save so it can be consumed *after* the save completes: the tracked aggregate roots, the events that are eligible for in-process dispatch, the outbox rows backing those events, and a flag saying whether any integration events were also written.
- **Depends on**: [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) (via `EntityEntry<IAggregateRoot>[]`), [`IDomainEvent`](group-04-events-outbox.md#idomainevent), [`OutboxMessage`](group-04-events-outbox.md#outboxmessage); `Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry<T>` (EF Core).
- **Concept introduced, pre-save / post-save state handoff.** `[Rubric §6, CQRS & Event-Driven]` assesses whether state changes are announced as events with reliable delivery rather than leaked as ad-hoc side effects; here the interceptor runs in two phases (capture before the write, route after it), and `CapturedState` is the immutable value that bridges them instead of a mutable field a concurrent save could clobber. Its four positional members (`DomainEventSaveChangesInterceptor.cs:268-272`) are exactly what the post-save phase needs: `AggregateRootEntities` (the entries whose events must be cleared), `LocalEvents` (what to dispatch in process), `LocalOutboxEntries` (the rows to mark processed once that dispatch succeeds), and `HasIntegrationEvents` (whether to wake the outbox processor for rows that deliberately stay unprocessed).
- **Walkthrough**: a `sealed record` with four constructor-set members (`DomainEventSaveChangesInterceptor.cs:268-272`). Instances live per-`DbContext` in the interceptor's static `ConditionalWeakTable<DbContext, CapturedState>` (`DomainEventSaveChangesInterceptor.cs:48`) and are removed again in the post-save phase (`DomainEventSaveChangesInterceptor.cs:105`, `DomainEventSaveChangesInterceptor.cs:206`), so nothing keeps a context alive past its own lifetime. When a transaction is active the same instance is re-wrapped in a [`DeferredDispatch`](#deferreddispatch) and parked until commit (`DomainEventSaveChangesInterceptor.cs:213`).
- **Where it's used**: created in `CaptureEventsAndPersistToOutbox` (`DomainEventSaveChangesInterceptor.cs:193-194`), read back in `DispatchAndFinalizeAsync` (`DomainEventSaveChangesInterceptor.cs:203-206`), consumed in `FlushStateAsync` (`DomainEventSaveChangesInterceptor.cs:224`), and drained on the synchronous save path in `SavedChanges` (`DomainEventSaveChangesInterceptor.cs:103-109`).
- **Caveats / not-in-source**: private nested type; it surfaces in the inventory only because the tool includes private nested types. It is not part of the public API.

### IEntityDataSourceRegistry

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/IEntityDataSourceRegistry.cs:11` · Level 2 · interface

- **What it is**: the contract for the eagerly-built registry that maps every configured entity type to the physical database it lives in. Four members: `GetDataSourceKey(Type)` (`IEntityDataSourceRegistry.cs:17`), `GetDataSourceKey(string entityFullName)` (`IEntityDataSourceRegistry.cs:23`), `TryGetDataSourceKey(string, out DataSourceKey)` (`IEntityDataSourceRegistry.cs:29`), and `GetPhysicalSourcesInUse()` (`IEntityDataSourceRegistry.cs:35`).
- **Depends on**: [`DataSourceKey`](#datasourcekey).
- **Concept introduced, eager entity-to-database mapping.** `[Rubric §8, Data Architecture]` assesses whether database routing is a deliberate, discoverable design rather than an accident of query order; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without rewriting application code. The doc comment (`IEntityDataSourceRegistry.cs:5-10`) states why this interface exists: it replaces a legacy lazy cache that was populated as a *side effect* of EF model building, so routing decisions (unit of work, navigation classification, outbox enumeration) no longer depend on a model having been built first. `GetPhysicalSourcesInUse()` returns the distinct databases this host actually uses, which is how migrations, `EnsureCreated`, and the outbox processor know which databases to touch (`IEntityDataSourceRegistry.cs:31-35`). The two strict `GetDataSourceKey` overloads throw `InvalidOperationException` for an unregistered entity (documented at `IEntityDataSourceRegistry.cs:16` and `IEntityDataSourceRegistry.cs:22`), while `TryGetDataSourceKey` is the non-throwing probe used where a miss is legitimate.
- **Why it's built this way**: database-per-service (ADR-006) needs every entity to resolve to exactly one physical source; building the map eagerly turns a misconfiguration into a loud startup failure instead of a silent wrong-database query.
- **Where it's used**: implemented by [`EntityDataSourceRegistry`](#entitydatasourceregistry); consumed by [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) (to classify foreign entity types), [`DataSourceService`](#datasourceservice) (the runtime facade), and the outbox/migrations enumeration paths.

### PhysicalDataSource

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:17` · Level 2 · record (sealed)

- **What it is**: the fully-resolved connection information for one physical database: `Key` (its engine plus name identity), `ConnectionString`, `SqlServerMigrationsAssembly?`, and `CosmosDatabaseName` (`PhysicalDataSource.cs:17-21`).
- **Depends on**: [`DataSourceKey`](#datasourcekey).
- **Concept, a logical name resolved to a real connection.** `[Rubric §8, Data Architecture]` covers the step from a configured name like `DataSources:Conference` to an actual database. The record's doc comment (`PhysicalDataSource.cs:5-9`) explains that it is produced by [`IDataSourceResolver`](#idatasourceresolver) from the top-level `ConnectionStrings` section (the `Default` source) plus the named `DataSources` entries. Two members are engine-scoped: `SqlServerMigrationsAssembly` is null for non-SQL-Server engines and lets each SQL database own its own EF migration history (`PhysicalDataSource.cs:12-15`); `CosmosDatabaseName` is ignored for relational engines (`PhysicalDataSource.cs:16`). Making this a `record` gives value equality, so two resolutions of the same source compare equal.
- **Where it's used**: produced by [`DataSourceResolver`](#datasourceresolver) (`DataSourceResolver.cs:156-160` for the Default source and `DataSourceResolver.cs:200-204` for named ones) and handed back by `GetPhysical` (`DataSourceResolver.cs:63`); consumed downstream by [`PhysicalDbContextFactory`](#physicaldbcontextfactory) to open a context against the right database with the right migrations assembly.

### Snapshot

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:25` · Level 2 · record (sealed, private nested)

- **What it is**: the immutable point-in-time view of [`EntityDataSourceRegistry`](#entitydatasourceregistry)'s state: `FrozenDictionary<string, (DataSourceKey Key, Type ConfigurationType)> Entities` and `FrozenSet<Assembly> ScannedAssemblies` (`EntityDataSourceRegistry.cs:25-27`).
- **Depends on**: [`DataSourceKey`](#datasourcekey); `System.Collections.Frozen`, `System.Reflection.Assembly` (BCL).
- **Concept introduced, the lock-free volatile-snapshot pattern.** `[Rubric §12, Performance & Scalability]` assesses whether hot-path reads avoid contention; the registry holds `private volatile Snapshot? _snapshot` (`EntityDataSourceRegistry.cs:30`) and reads it without a lock, relying on `volatile` for the store/load barrier so every thread sees a consistent reference. Writes (the initial build and any rescan) take `Lock _rebuildLock` (`EntityDataSourceRegistry.cs:29`) for mutual exclusion, then atomically swap in a brand-new `Snapshot`. Because `FrozenDictionary`/`FrozenSet` are immutable once built, any number of readers share one snapshot with zero synchronization. The second member is the reason the record carries more than a lookup table: `ScannedAssemblies` records which assemblies that snapshot covered, so the registry can tell whether a miss is genuine or just a stale scan.
- **Walkthrough**: the value type carried in `Entities` is a tuple of the resolved [`DataSourceKey`](#datasourcekey) *and* the configuration type that produced it (`EntityDataSourceRegistry.cs:26`). The configuration type is not used for routing; it exists so the duplicate-registration failure can name both conflicting configuration classes in its message (`EntityDataSourceRegistry.cs:138-141`).
- **Where it's used**: exclusively inside [`EntityDataSourceRegistry`](#entitydatasourceregistry): built by `BuildSnapshot` (`EntityDataSourceRegistry.cs:150-152`), swapped in `GetOrBuildSnapshot` (`EntityDataSourceRegistry.cs:87`) and `RescanIfAssembliesChanged` (`EntityDataSourceRegistry.cs:102-104`).
- **Caveats / not-in-source**: private nested type; it appears in the inventory because private nested types are included.

### IDataSourceResolver

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/IDataSourceResolver.cs:15` · Level 3 · interface

- **What it is**: the contract that maps a *logical* data source name (from a `[UseDatabase]` attribute, a module namespace, or a setting like `Outbox:DatabaseName`) to a *physical* [`DataSourceKey`](#datasourcekey), and hands back the resolved [`PhysicalDataSource`](#physicaldatasource) for such a key. Two members: `ResolveLogical(DataSource engine, string logicalName)` (`IDataSourceResolver.cs:27`) and `GetPhysical(DataSourceKey key)` (`IDataSourceResolver.cs:35`).
- **Depends on**: [`DataSource`](#datasource), [`DataSourceKey`](#datasourcekey), [`PhysicalDataSource`](#physicaldatasource).
- **Concept introduced, logical-to-physical collapse as the backward-compatibility guarantee.** `[Rubric §8, Data Architecture]` and `[Rubric §7, Microservices Readiness]` both apply, because routing is reconfigurable purely through settings. The interface comment (`IDataSourceResolver.cs:5-14`) states the collapse rule precisely: in a host with no `DataSources` configuration every logical name resolves to `Default`, yielding one DbContext per engine with an identical change tracker, FK constraints, transactions, and EF model as a plain single-database monolith. `ResolveLogical`'s contract (`IDataSourceResolver.cs:17-27`) spells out the collapse cases: a name with no `DataSources` entry, with no connection string for the engine, or whose connection equals the top-level one falls to `DataSourceKey.Default(engine)`; entries sharing a connection with each other collapse to one physical source named after the alphabetically-first logical name. `GetPhysical` (`IDataSourceResolver.cs:29-35`) is the reverse lookup and throws if handed a key that did not come from `ResolveLogical`.
- **Why it's built this way**: the collapse is what makes "build the monolith now, extract a service later" a configuration change rather than a rewrite (ADR-006). A single interface owns the rule, so no caller has to reimplement the defaulting logic.
- **Where it's used**: implemented by [`DataSourceResolver`](#datasourceresolver); injected into [`EntityDataSourceRegistry`](#entitydatasourceregistry) (`EntityDataSourceRegistry.cs:23`) to resolve each entity's derived logical name, and into the context factories to open connections.

### DataSourceResolver

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:13` · Level 4 · class (sealed, partial)

- **What it is**: the singleton implementation of [`IDataSourceResolver`](#idatasourceresolver). It builds the logical-to-physical map once at construction from the connection-string settings and the named `DataSources` entries, validates migrations-assembly conflicts, and then serves both lookups from in-memory dictionaries.
- **Depends on**: [`DataSource`](#datasource), [`DataSourceKey`](#datasourcekey), [`PhysicalDataSource`](#physicaldatasource), [`IDataSourceResolver`](#idatasourceresolver), [`IConnectionStringSettings`](group-14-module-system-composition.md#iconnectionstringsettings), [`DataSourcesSettings`](group-14-module-system-composition.md#datasourcessettings), [`DataSourceEntrySettings`](group-14-module-system-composition.md#datasourceentrysettings); `ILogger<T>`.
- **Concept introduced, eager and validated data-source resolution.** `[Rubric §8, Data Architecture]` (deliberate multi-database routing) and `[Rubric §7, Microservices Readiness]` (ADR-006, database-per-service). The resolver realizes the collapse rule described on [`IDataSourceResolver`](#idatasourceresolver). Two guardrails are worth calling out. First, conflicting `SQLServerMigrationsAssembly` declarations on logical names that collapse to the same physical database throw at startup (`DataSourceResolver.cs:243-245`), a loud fail-fast rather than a silent pick. Second, `[Rubric §13, Observability & Operability]` shows in the source-generated `[LoggerMessage]` `LogMigrationsAssemblyFallback` (`DataSourceResolver.cs:278-279`), which warns when a *named* SQL Server source has no dedicated migrations assembly and falls back to another database's, because that snapshot describes a different schema.
- **Walkthrough**
  - Constructor (`DataSourceResolver.cs:33-45`): validates its two settings arguments, then loops all three engines (`AllEngines` = CosmosDB, Sqlite, SQLServer, `DataSourceResolver.cs:15`) calling `BuildEngineMap`. State lives in two dictionaries: `_logicalToPhysical` keyed by `(engine, logical name)` (`DataSourceResolver.cs:18`) and `_physicalSources` keyed by [`DataSourceKey`](#datasourcekey) (`DataSourceResolver.cs:21`).
  - `BuildEngineMap` (`DataSourceResolver.cs:75`): `ClassifyEntries` splits the engine's named entries into "collapsed onto Default" and "grouped by connection identity" (`DataSourceResolver.cs:81`); `RegisterDefaultSource` then `RegisterNamedSource` populate the two dictionaries.
  - `ClassifyEntries` (`DataSourceResolver.cs:94`): computes a per-connection identity string via `GetIdentity` (`DataSourceResolver.cs:257-260`), where Cosmos identities append the database name because one account hosts many databases, relational engines use the connection string alone, and comparison is *ordinal*, so semantically-equal-but-textually-different connection strings deliberately do not collapse. Entries with no connection string for the engine are skipped entirely (`DataSourceResolver.cs:107-112`) because `ResolveLogical` already defaults on a map miss.
  - `RegisterDefaultSource` (`DataSourceResolver.cs:141`): registers the `Default` key for the engine, letting entries that collapsed onto it contribute an explicit migrations assembly (`DataSourceResolver.cs:148-154`), and maps each collapsed logical name onto that key (`DataSourceResolver.cs:162-165`).
  - `RegisterNamedSource` (`DataSourceResolver.cs:172`): names the physical key after the alphabetically-first member (`Order(...).First()`, `DataSourceResolver.cs:178`) so routing is deterministic regardless of config key order, then warns and falls back when a SQL Server source declares no migrations assembly of its own (`DataSourceResolver.cs:185-192`).
  - `ResolveLogical` (`DataSourceResolver.cs:48`): a `Default`-name short-circuit (`DataSourceResolver.cs:52-55`) then a dictionary lookup; a miss returns `DataSourceKey.Default(engine)` (`DataSourceResolver.cs:59`), the monolith default.
  - `GetPhysical` (`DataSourceResolver.cs:63`): a `_physicalSources` lookup that throws with an actionable message if the key was not produced by `ResolveLogical` (`DataSourceResolver.cs:65-68`).
  - `ResolveMigrationsAssembly` (`DataSourceResolver.cs:229`): returns null for non-SQL-Server engines or when no explicit value exists (`DataSourceResolver.cs:234-237`), and throws when logical names sharing a database declare conflicting assemblies (`DataSourceResolver.cs:239-246`).
- **Why it's built this way**: resolving eagerly at construction turns a misconfiguration into a startup failure rather than a mid-request surprise, and the deterministic canonical-name rule keeps routing stable across config orderings (ADR-006).
- **Where it's used**: registered as the singleton [`IDataSourceResolver`](#idatasourceresolver); consumed by [`EntityDataSourceRegistry`](#entitydatasourceregistry), the context factories, and the design-time helper.

### EntityDataSourceRegistry

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21` · Level 5 · class (sealed)

- **What it is**: the singleton implementation of [`IEntityDataSourceRegistry`](#ientitydatasourceregistry). It reflects over the configuration assemblies, finds every entity type configuration, derives each entity's physical database from the configuration class's attributes and the entity's namespace, and freezes the result into a lock-free lookup that it rescans lazily when new assemblies appear.
- **Depends on**: [`DataSourceKey`](#datasourcekey), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry), [`IDataSourceResolver`](#idatasourceresolver), [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype), [`NamespaceConventions`](#namespaceconventions), [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute), [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute), [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), [`Snapshot`](#snapshot) (nested); `System.Reflection`, `System.Collections.Frozen`, `Lock` (BCL).
- **Concept introduced, eager entity-to-data-source mapping.** `[Rubric §8, Data Architecture]` (ADR-006: an entity lives in exactly one database). The doc comment (`EntityDataSourceRegistry.cs:8-20`) explains the design: the map is derived from *configuration classes*, not from EF model metadata, so it exists before any model is built; it is built lazily on first access and rescanned once on a lookup miss to pick up module assemblies loaded later; and duplicate registrations of one entity are tolerated when they agree on the physical source and rejected when they conflict.
- **Walkthrough**
  - `_rebuildLock` (`EntityDataSourceRegistry.cs:29`) and the `volatile _snapshot` (`EntityDataSourceRegistry.cs:30`) implement the pattern taught under [`Snapshot`](#snapshot): reads are lock-free, rebuilds are serialized and swap in a new immutable snapshot.
  - `GetDataSourceKey(Type)` (`EntityDataSourceRegistry.cs:33`) null-guards and forwards to the string overload via `FullName`; `GetDataSourceKey(string)` (`EntityDataSourceRegistry.cs:40`) is `TryGetDataSourceKey` plus a throw whose message names the exact remedy: add an `EntityTypeConfigurationSQLServer/Cosmos/Sqlite` for the entity in a discovered configuration assembly (`EntityDataSourceRegistry.cs:43-46`).
  - `TryGetDataSourceKey` (`EntityDataSourceRegistry.cs:49`): probes the current snapshot; on a miss it calls `RescanIfAssembliesChanged` once (`EntityDataSourceRegistry.cs:62`) and retries. This two-step check keeps the common hit path off the lock.
  - `GetPhysicalSourcesInUse` (`EntityDataSourceRegistry.cs:74`): projects the snapshot's values to distinct keys, which is how migrations, `EnsureCreated`, and outbox draining enumerate this host's databases.
  - `GetOrBuildSnapshot` (`EntityDataSourceRegistry.cs:77`) double-checks `_snapshot` and builds under the lock; `RescanIfAssembliesChanged` (`EntityDataSourceRegistry.cs:91`) rebuilds only when the provider reports assemblies not already in `ScannedAssemblies` (`EntityDataSourceRegistry.cs:96-100`).
  - `BuildSnapshot` (`EntityDataSourceRegistry.cs:108`): for every loadable type in every configuration assembly, it skips abstract and open-generic types (`EntityDataSourceRegistry.cs:115-118`), finds the closed `IEntityTypeConfigurationBase<,>` interface (`EntityDataSourceRegistry.cs:120-125`), takes the entity type from the first generic argument (`EntityDataSourceRegistry.cs:127`), and calls `DeriveDataSourceKey`. A second configuration registering the same entity against a *different* key throws with a message naming both configuration classes and both keys (`EntityDataSourceRegistry.cs:134-145`); an agreeing duplicate is simply ignored.
  - `DeriveDataSourceKey` (`EntityDataSourceRegistry.cs:164`): reads the engine from [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and returns null when it is absent (`EntityDataSourceRegistry.cs:166-170`), deliberately skipping configurations that implement a provider interface directly instead of deriving from the attributed base classes. It then resolves the logical name in priority order `[UseDatabase]` then [`NamespaceConventions.GetModuleName`](#namespaceconventions) then `DataSourceKey.DefaultName` (`EntityDataSourceRegistry.cs:172-174`), and delegates the collapse to [`IDataSourceResolver.ResolveLogical`](#idatasourceresolver) (`EntityDataSourceRegistry.cs:176`).
  - `GetLoadableTypes` (`EntityDataSourceRegistry.cs:182`): wraps `assembly.GetTypes()` and tolerates `ReflectionTypeLoadException` by keeping the types that did load (`EntityDataSourceRegistry.cs:187-191`), mirroring module discovery, so a partially-loaded assembly does not abort the scan.
- **Why it's built this way**: building from configuration classes at startup rather than per-query means a missing or conflicting configuration surfaces early, which matters in a multi-database system where the alternative is a silent wrong-database read.
- **Where it's used**: registered as the singleton [`IEntityDataSourceRegistry`](#ientitydatasourceregistry); consumed by [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention), [`DataSourceService`](#datasourceservice), and the outbox/migrations enumeration.

### AuditSaveChangesInterceptor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:13` · Level 6 · class (sealed)

- **What it is**: an EF Core `SaveChangesInterceptor` that automatically stamps `CreatedOn/By` and `LastModifiedOn/By` on every [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) entry before the database write (`AuditSaveChangesInterceptor.cs:8-13`).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext), [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity); `SaveChangesInterceptor` (EF Core), `TimeProvider` (BCL).
- **Concept introduced, the EF Core `SaveChangesInterceptor` as a cross-cutting hook.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether audit and similar concerns are wired centrally rather than repeated per handler. An interceptor is a class EF calls at defined points in the save pipeline (`SavingChanges` before the write, `SavedChanges` after). Using an interceptor rather than overriding `SaveChangesAsync` means the logic runs for both the sync and async save paths, multiple interceptors compose through EF's own pipeline, and the concern lives in one class. `[Rubric §8, Data Architecture]` (audit stamped centrally, not per operation) and `[Rubric §30, Compliance/Privacy/Data Governance]` (a consistent audit trail supports accountability) also apply.
- **Walkthrough**
  - `SavingChangesAsync` (`AuditSaveChangesInterceptor.cs:16`) and `SavingChanges` (`AuditSaveChangesInterceptor.cs:28`): both call `StampAuditFields` when the context is an [`ApplicationDbContext`](#applicationdbcontext), then delegate to base. Stamping in the *saving* phase is what puts the values into the same SQL statement as the entity change.
  - `StampAuditFields` (`AuditSaveChangesInterceptor.cs:38`): reads `timeProvider.GetUtcNow().UtcDateTime` once (`AuditSaveChangesInterceptor.cs:40`) so every entity in one save shares a timestamp, and reads the context's `CurrentSaveUserId ?? default` (`AuditSaveChangesInterceptor.cs:41`), the per-save user handed in by [`ApplicationDbContext`](#applicationdbcontext) (`ApplicationDbContext.cs:69`). It then walks `ChangeTracker.Entries<IAuditableEntity>()`.
    - **Added** (`AuditSaveChangesInterceptor.cs:47-52`): stamps all four fields from the resolved user id and timestamp; a null current user resolves to `default`, the sentinel for system-generated rows.
    - **Modified** (`AuditSaveChangesInterceptor.cs:53-58`): stamps only `LastModifiedBy`/`LastModifiedOn`, and marks `CreatedBy`/`CreatedOn` as `IsModified = false` (`AuditSaveChangesInterceptor.cs:54-55`) so an update can never overwrite the creation fields. That is the load-bearing invariant of this class.
    - **Detached / Unchanged / Deleted** (`AuditSaveChangesInterceptor.cs:59-63`): no-op. Soft delete is a domain concern (the entity sets `IsDeleted = true`, which lands it in the `Modified` branch), not something this interceptor special-cases.
- **Why it's built this way**: centralizing audit in an interceptor guarantees no handler can forget the stamps; injecting `TimeProvider` rather than reading `DateTime.UtcNow` makes the stamps deterministic under test (`[Rubric §14, Testability]`).
- **Where it's used**: registered as a singleton in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:52`) and added to every context's options alongside [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) in `ApplicationDbContext.OnConfiguring` (`ApplicationDbContext.cs:124-126`); the design-time helper registers its own copy (`Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:68`).

### DeferredDispatch

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:275` · Level 6 · record (sealed, private nested)

- **What it is**: a two-member private record pairing a [`CapturedState`](#capturedstate) with the [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) instance that captured it, representing one unit of post-save work parked until the surrounding transaction commits (`DomainEventSaveChangesInterceptor.cs:274-275`).
- **Depends on**: [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor), [`CapturedState`](#capturedstate).
- **Concept introduced, carrying the owner so a static entry point can flush instance work.** `[Rubric §1, SOLID]` (dependency direction) and `[Rubric §6, CQRS & Event-Driven]` (delivery ordered after commit) both apply. The deferred list is stored in a *static* `ConditionalWeakTable<DbContext, List<DeferredDispatch>>` (`DomainEventSaveChangesInterceptor.cs:55`) and drained by the *static* `FlushDeferredAsync`, which [`DbContextFactory`](#dbcontextfactory) calls after a successful commit. Flushing needs the interceptor's injected dispatcher and outbox signal, which a static method does not have. Rather than give the factory a DI edge back to the interceptor, each entry carries its own `Owner` and the flush loop calls `dispatch.Owner.FlushStateAsync(...)` (`DomainEventSaveChangesInterceptor.cs:127-128`). The comment at `DomainEventSaveChangesInterceptor.cs:50-54` states exactly that intent.
- **Walkthrough**: created in `DispatchAndFinalizeAsync` when `context.Database.CurrentTransaction is not null` (`DomainEventSaveChangesInterceptor.cs:208-214`), appended to the per-context list via `DeferredTable.GetOrCreateValue(context).Add(...)` (`DomainEventSaveChangesInterceptor.cs:213`); consumed in `FlushDeferredAsync` (`DomainEventSaveChangesInterceptor.cs:120-129`) or discarded wholesale by `DropDeferred` (`DomainEventSaveChangesInterceptor.cs:137`). It is a `List` rather than a single entry because several saves can occur inside one transaction.
- **Where it's used**: only inside [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor); the flush and drop entry points are called by [`DbContextFactory`](#dbcontextfactory) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:329` on commit, `DbContextFactory.cs:275` and `DbContextFactory.cs:347` on rollback and abort).
- **Caveats / not-in-source**: private nested type; it surfaces in the inventory only because private nested types are included.

### DomainEventSaveChangesInterceptor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:38` · Level 6 · class (sealed, partial)

- **What it is**: the EF Core interceptor that implements the producer end of the transactional outbox. Before the write it captures domain events from aggregate roots and serializes each to an [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row in the same transaction; after the write it *routes* them, dispatching local events in process and leaving integration-event rows for the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) to publish; and when a transaction is open it defers all of that until after commit.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext), [`CapturedState`](#capturedstate) and [`DeferredDispatch`](#deferreddispatch) (nested), [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot), [`IDomainEvent`](group-04-events-outbox.md#idomainevent), [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent), [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher), [`IOutboxSignal`](group-04-events-outbox.md#ioutboxsignal), [`OutboxMessage`](group-04-events-outbox.md#outboxmessage), [`OutboxFinalizer`](group-04-events-outbox.md#outboxfinalizer); `SaveChangesInterceptor`, `ConditionalWeakTable`, `ILogger<T>` (EF Core / BCL).
- **Concept introduced, the routed transactional outbox (ADR-003).** `[Rubric §6, CQRS & Event-Driven]` (state changes announced as events) and `[Rubric §29, Resilience & Business Continuity]` (at-least-once delivery). There are three rules layered on top of each other, all stated in the class doc comment (`DomainEventSaveChangesInterceptor.cs:12-34`):
  1. **Transactional persistence.** Every captured event becomes an [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) added to the context *before* `base.SaveChangesAsync`, so the rows commit in the same database transaction as the aggregate change. A crash between the write and the dispatch cannot lose an event.
  2. **Routing by event kind.** Local domain events get an outbox row *and* an in-process dispatch, after which their rows are marked processed. Events implementing [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) get a row and **no** in-process dispatch: their rows stay unprocessed so the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) publishes them through `IMessageBus`, letting the registered transport (in process for the monolith, broker for an extracted service) decide delivery. The comment records why this matters (`DomainEventSaveChangesInterceptor.cs:22-24`): before this routing existed, `AddDomainEvent(integrationEvent)` dispatched locally and marked the row processed, so the event silently never reached the wire.
  3. **Deferral under a transaction.** When the save runs inside the Transactional decorator's transaction, all post-save work is parked as a [`DeferredDispatch`](#deferreddispatch) and flushed by [`DbContextFactory`](#dbcontextfactory) only after a successful commit (`DomainEventSaveChangesInterceptor.cs:26-33`). That keeps handler side effects (email, cache writes, pushes) from acting on state that may still roll back, and keeps EF execution-strategy retries from dispatching the same events once per attempt.
- **Walkthrough**
  - **Two `ConditionalWeakTable`s.** `StateTable` (`DomainEventSaveChangesInterceptor.cs:48`) associates the per-save [`CapturedState`](#capturedstate) with the context instance; `DeferredTable` (`DomainEventSaveChangesInterceptor.cs:55`) holds the parked [`DeferredDispatch`](#deferreddispatch) list. Weak tables mean neither structure keeps a context alive, so state cleans up automatically on disposal (`DomainEventSaveChangesInterceptor.cs:43-47`).
  - **`SavingChangesAsync` / `SavingChanges`** (`DomainEventSaveChangesInterceptor.cs:58`, `DomainEventSaveChangesInterceptor.cs:70`): both call `CaptureEventsAndPersistToOutbox` when the context is an [`ApplicationDbContext`](#applicationdbcontext); capture must happen before the SQL write, in the same unit of work.
  - **`CaptureEventsAndPersistToOutbox`** (`DomainEventSaveChangesInterceptor.cs:143`): collects tracked [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) entries carrying pending events (`DomainEventSaveChangesInterceptor.cs:145-150`) and flattens their events. When `context.SupportsOutbox` (`DomainEventSaveChangesInterceptor.cs:160`) it builds one row per event via `OutboxMessage.FromDomainEvent`, adds it to the set, and sorts the event into the integration bucket (flag only) or the local bucket (event plus its row) (`DomainEventSaveChangesInterceptor.cs:165-184`). The `Add` is intentionally the synchronous `DbSet` call; the `VSTHRD103` pragma (`DomainEventSaveChangesInterceptor.cs:169-171`) records that `AddAsync` exists only for special value generators. When the context has no outbox table (Cosmos overrides `SupportsOutbox` to false, `Persistence/DbContexts/CosmosDbContext.cs:69`) nothing can carry an integration event to the bus, so the legacy behavior of dispatching everything in process is kept (`DomainEventSaveChangesInterceptor.cs:186-191`). The result is stored as a [`CapturedState`](#capturedstate) (`DomainEventSaveChangesInterceptor.cs:193-194`).
  - **`SavedChangesAsync`** (`DomainEventSaveChangesInterceptor.cs:81`): the post-commit entry point, calls `DispatchAndFinalizeAsync`.
  - **`SavedChanges`** (the synchronous path, `DomainEventSaveChangesInterceptor.cs:100`): cannot await the dispatcher, so it relies entirely on the outbox. For outbox-capable contexts it removes the state, clears the aggregates' events (preventing the duplicate re-capture a later async save used to produce) and signals the processor if there is anything pending (`DomainEventSaveChangesInterceptor.cs:102-110`). Contexts without outbox support keep the legacy no-op so a later async save can still deliver their events (`DomainEventSaveChangesInterceptor.cs:93-99`).
  - **`DispatchAndFinalizeAsync`** (`DomainEventSaveChangesInterceptor.cs:201`): pulls and removes the state, then branches on `context.Database.CurrentTransaction`. With a transaction open it clears the aggregates' events *now* (so a second save inside the same transaction cannot re-capture them, `DomainEventSaveChangesInterceptor.cs:210-212`), parks a [`DeferredDispatch`](#deferreddispatch), and returns. Otherwise it flushes immediately.
  - **`FlushStateAsync`** (`DomainEventSaveChangesInterceptor.cs:224`): dispatches local events through [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) (`DomainEventSaveChangesInterceptor.cs:228-229`), clears the aggregates' events, marks the local rows processed via [`OutboxFinalizer`](group-04-events-outbox.md#outboxfinalizer) (`DomainEventSaveChangesInterceptor.cs:233`), and signals the processor when integration events are waiting (`DomainEventSaveChangesInterceptor.cs:235-236`). A `catch` logs and signals so the unprocessed rows get picked up (`DomainEventSaveChangesInterceptor.cs:238-246`), and a `finally` clears events idempotently (`DomainEventSaveChangesInterceptor.cs:247-251`) so a dispatch failure never leaves stale events on an aggregate.
  - **`FlushDeferredAsync` / `DropDeferred`** (`DomainEventSaveChangesInterceptor.cs:120`, `DomainEventSaveChangesInterceptor.cs:137`): the `internal static` pair [`DbContextFactory`](#dbcontextfactory) calls after commit and on rollback. The flush comment notes a missed flush is safe (`DomainEventSaveChangesInterceptor.cs:117-118`): the rows are still there unprocessed and the outbox delivers them.
  - **`LogDispatchError`** (`DomainEventSaveChangesInterceptor.cs:260-261`): a source-generated `[LoggerMessage]` warning, which is why the class is `partial` (`[Rubric §13, Observability & Operability]`).
- **Why it's built this way**: ADR-003 requires at-least-once delivery, so the durable row is written in the same transaction and the in-process dispatch is only a fast path that avoids a round trip. Splitting integration events out of that fast path is what makes the same `AddDomainEvent` call correct in both the monolith and an extracted service (ADR-007). Deferring until after commit resolves the one remaining ordering hazard, a handler observing state that later rolls back.
- **Where it's used**: registered as a singleton in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:53`, stateless because per-save state lives in the weak tables, per the comment at `DependencyInjection.cs:50-51`) and added to every context's options alongside [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor) in `ApplicationDbContext.OnConfiguring` (`ApplicationDbContext.cs:124-126`); its deferred work is driven by [`DbContextFactory`](#dbcontextfactory) and its rows are drained by the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor).

### IEntityTypeConfigurationBase<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationBase.cs:14` · Level 4 · interface

- **What it is**: the base marker interface for every EF Core entity type configuration in the framework. It extends EF Core's own `IEntityTypeConfiguration<TEntity>` and redeclares `Configure` with `new` so the provider-specific sub-interfaces can restate the same signature.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (the entity constraint), and EF Core's `IEntityTypeConfiguration<TEntity>` / `EntityTypeBuilder<TEntity>` (NuGet).
- **Concept introduced: the provider-split configuration hierarchy.** `[Rubric §8: Data Architecture]` assesses whether each entity is deliberately bound to a physical store rather than mapped ad hoc; this interface is the root of a family that lets one configuration class be discovered per engine and routed to the right database. `[Rubric §1: SOLID]` (ISP): the interface adds nothing but a redeclared method, so provider sub-interfaces ([`IEntityTypeConfigurationSQLServer`](#ientitytypeconfigurationsqlservertentity-tidentifiertype), [`IEntityTypeConfigurationSqlite`](#ientitytypeconfigurationsqlitetentity-tidentifiertype), [`IEntityTypeConfigurationCosmos`](#ientitytypeconfigurationcosmostentity-tidentifiertype)) can specialize discovery without carrying members they do not need.
- **Walkthrough**: the two type constraints (lines 15-16) pin `TEntity` to `AuditableBaseEntity<TIdentifierType>` and `TIdentifierType` to `notnull`; the single `new void Configure(EntityTypeBuilder<TEntity> builder)` (line 18) is the redeclaration that gives EF an unambiguous method to invoke through the provider interfaces.
- **Why it's built this way**: `ApplicationDbContext.ApplyConfigurationsForEntitiesInContext` discovers configurations by the *specific* provider interface, so a SQL Server configuration is never applied to a Cosmos model pass. The `new` redeclaration is the mechanism that keeps that discovery type-safe.
- **Where it's used**: implemented transitively by every concrete `EntityTypeConfiguration*` class in both apps, and scanned by [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) to enumerate configurable entities.

---

### EntityTypeConfigurationBase<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationBase.cs:19` · Level 5 · class (abstract)

- **What it is**: the abstract base class every entity configuration inherits. Its `Configure` does exactly one cross-cutting thing: for aggregate roots it tells EF to ignore the in-memory `DomainEvents` collection so the change tracker never tries to persist it.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (implements it), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot), and EF Core's `EntityTypeBuilder<TEntity>`.
- **Concept**: the single, deliberate crossing of the domain boundary by infrastructure. `[Rubric §3: Clean Architecture]` assesses whether infrastructure references to the domain are minimal and centralized; here the only domain fact Infrastructure needs is that aggregate roots carry a non-persisted event list, and it acts on that in one place.
- **Walkthrough**: `Configure` (lines 25-33): the `if (typeof(IAggregateRoot).IsAssignableFrom(typeof(TEntity)))` guard (line 29) runs `builder.Ignore(nameof(AuditableAggregateRootEntity<>.DomainEvents))` (line 31) only for roots; child entities have no such collection and skip it. The class doc comment (lines 11-15) records that entity-to-data-source routing was previously a model-building side effect here and has since moved to [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry), which derives it eagerly from attributes.
- **Why it's built this way**: `DomainEvents` is dispatch-only state; excluding it once at the base means every concrete configuration inherits the exclusion for free rather than repeating it.
- **Where it's used**: the direct base of the engine-aware [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype), and thus an ancestor of every per-entity configuration in ADC and Store.

---

### IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationCosmos.cs:13` · Level 5 · interface (internal)

- **What it is**: the internal marker interface that identifies a configuration as targeting Azure Cosmos DB. Structurally identical to its SQL Server and SQLite siblings; only the marker type differs.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (extends it), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype).
- **Concept**: the provider-split pattern introduced under [`IEntityTypeConfigurationBase`](#ientitytypeconfigurationbasetentity-tidentifiertype). The `internal` modifier (line 13) is deliberate: consumers never implement this marker directly. They derive from the public [`EntityTypeConfigurationCosmos`](#entitytypeconfigurationcosmostentity-tidentifiertype) base, and the framework attaches the marker for them.
- **Walkthrough**: the redeclared `new void Configure(...)` (line 17) mirrors the base; the interface adds no members of its own. `ApplicationDbContext.ApplyConfigurationsForEntitiesInContext` filters on this type when building the Cosmos model pass, so only Cosmos configurations reach a Cosmos context.
- **Where it's used**: discovered by [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) and the Cosmos model pass; implemented (via the shim base) by any entity routed to `DataSource.CosmosDB`.

---

### IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSqlite.cs:13` · Level 5 · interface (internal)

- **What it is**: the SQLite counterpart of the provider marker interface. Same shape as the Cosmos and SQL Server markers; different marker type.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype).
- **Concept**: see the provider-split pattern under [`IEntityTypeConfigurationBase`](#ientitytypeconfigurationbasetentity-tidentifiertype). `internal` (line 13) for the same reason as its siblings: consumers implement it only through the public [`EntityTypeConfigurationSqlite`](#entitytypeconfigurationsqlitetentity-tidentifiertype) base.
- **Walkthrough**: the `new void Configure(...)` redeclaration (line 17) is the entire body. SQLite is used mainly in integration tests and in-memory scenarios where a schema-less relational store is convenient.
- **Where it's used**: discovered by [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry) and applied only to a SQLite context.

---

### IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSQLServer.cs:13` · Level 5 · interface (internal)

- **What it is**: the SQL Server marker interface, the production default engine for both apps. Same structure as the Cosmos and SQLite markers.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype).
- **Concept**: the provider-split pattern from [`IEntityTypeConfigurationBase`](#ientitytypeconfigurationbasetentity-tidentifiertype). `internal` (line 13) keeps it out of the public API; consumers derive from the public [`EntityTypeConfigurationSQLServer`](#entitytypeconfigurationsqlservertentity-tidentifiertype) base and the framework supplies the marker.
- **Walkthrough**: `new void Configure(...)` (line 17) is the only member. The SQL Server model pass filters on this type so SQL Server configurations apply only to SQL Server contexts.
- **Where it's used**: discovered by [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry); the default routing for every entity that does not opt into another engine.

---

### EFReadRepository<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:15` · Level 6 · class (internal)

- **What it is**: the EF Core implementation of [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype): the full read surface (get all, get by id, get by ids, count, exists, lookup projection) with no mutation. It is the query half of the repository family.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (implements it), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype), and EF Core's `DbContext` / `DbSet<TEntity>` plus `ConcurrentDictionary` from the BCL.
- **Concept introduced: read-side query hygiene and N+1 avoidance.** `[Rubric §12: Performance & Scalability]` assesses deliberate query shaping, and this class makes several such choices visible:
  1. **Tracking control**: `Table` (line 239) is tracked, `TableNoTracking` (line 242) calls `AsNoTracking()`, and the get methods default `asTracking: false` so read paths do not pay change-tracker cost.
  2. **Split-query heuristic**: `ApplyIncludes` (lines 256-272) opts a query into `AsSplitQuery()` the moment any include targets a collection navigation, avoiding the cartesian row explosion EF's default single-query JOIN would cause. Whether a path is a collection navigation is decided by a reflection walk cached per path in `CollectionIncludeCache` (lines 278-299), so the reflection runs once per distinct include string.
  3. **Cached projection trees**: `GetAllForLookupAsync` (line 74) builds a `Select` expression mapping `Id` and a named property to `BaseLookup<TIdentifierType>`; the expression is built once per `(EntityType, PropertyName)` pair via `GetOrBuildLookupSelector` (lines 104-126) and stored in `LookupSelectorCache` (line 99), so repeated lookups pay only a dictionary hit.
  4. **`CountAsync` over `AnyAsync`**: `ExistsAsync` (lines 201-236) uses `CountAsync(predicate) > 0`; the comment at lines 196-200 documents that this is a workaround for a Cosmos provider bug that emits invalid SQL for `AnyAsync` with a predicate.
- **Walkthrough**: `_context` (line 21) and the `Entities` accessor (line 23, `_context.Set<TEntity>()`) are the starting point for every query. `GetAllAsync` (lines 26-54) composes tracking, `IgnoreQueryFilters`, includes, `where`, `orderBy`, and an optional `select` projection. `GetByIdAsync` (line 154) uses `FindAsync` for the identity-map fast path; the includes overload (line 164) falls back to `FirstOrDefaultAsync`. The four `Table*` properties (lines 239-248) hand callers explicit control over tracking and single-vs-split query strategy.
- **Why it's built this way**: the class is `internal` and `virtual` throughout, so the public contract is the interface and the profiling decorator can override members. Consumers never new it up directly; the factory does.
- **Where it's used**: created by [`RepositoryFactory`](#repositoryfactory) for every read repository resolution, optionally wrapped by [`EFReadRepositoryDecorator`](#efreadrepositorydecoratortentity-tidentifiertype); it is also the base class of the read-write [`EFRepository`](#efrepositorytentity-tidentifiertype).

---

### EFReadRepositoryDecorator<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepositoryDecorator.cs:15` · Level 6 · class (internal)

- **What it is**: a decorator that wraps every [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) operation in a MiniProfiler timing step, adding per-call timing visibility without touching the query logic.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype), and [`ProfilingHelper`](group-07-persistence-ef-core.md#profilinghelper).
- **Concept**: the Decorator pattern applied to the repository layer for observability, the same pattern that drives the CQRS decorator pipeline. `[Rubric §2: Design Patterns]` assesses whether cross-cutting behavior is layered by composition rather than baked into the core; `[Rubric §13: Observability]` assesses timing visibility.
- **Walkthrough**: the `_inner` field (line 21) holds the wrapped repository; every read method delegates through `ProfilingHelper.ProfileAsync(ClassName, nameof(Method), () => _inner.Method(...))` (for example line 31), with `ClassName` fixed to `"EFReadRepository"` (line 20). The four `Table*` queryable properties (lines 83-86) pass straight through to `_inner` with no wrapping, since they return deferred `IQueryable` and there is nothing to time.
- **Where it's used**: applied by [`RepositoryFactory`](#repositoryfactory) as the outer layer over [`EFReadRepository`](#efreadrepositorytentity-tidentifiertype) only when `UseMiniProfiler` is enabled.

---

### EntityTypeConfiguration<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:29` · Level 6 · class (abstract)

- **What it is**: the engine-aware configuration base that holds all the portable mapping logic. It reads a single `[UseDataSource(...)]` attribute to learn its target engine and then applies the matching table/container mapping and key-generation conventions. Moving an entity between engines becomes a one-attribute change with no edits to the configuration body.
- **Depends on**: [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype) (extends it, so it inherits the `DomainEvents` exclusion), all three provider markers ([SQLServer](#ientitytypeconfigurationsqlservertentity-tidentifiertype), [Sqlite](#ientitytypeconfigurationsqlitetentity-tidentifiertype), [Cosmos](#ientitytypeconfigurationcosmostentity-tidentifiertype)), [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute), [`DataSource`](group-07-persistence-ef-core.md#datasource), [`NamespaceConventions`](group-07-persistence-ef-core.md#namespaceconventions), [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions) (`IsIdValueGenerated`), [`CosmosIntIdValueGenerator`](group-07-persistence-ef-core.md#cosmosintidvaluegenerator), and EF Core.
- **Concept introduced: attribute-driven, engine-portable EF configuration.** `[Rubric §8: Data Architecture]` assesses systematic, convention-driven schema mapping instead of per-entity boilerplate, and this class is where that convention lives. Because it implements all three provider marker interfaces (lines 30-33), it is discovered for every engine's model pass; `ApplicationDbContext.ApplyConfigurationsForEntitiesInContext` then applies it only to the model whose physical source the entity actually routes to (driven by the same `[UseDataSource]`), so discovery and routing agree by construction. `[Rubric §15: Best Practices]`: naming, schema derivation, and key strategy are computed once here, not copy-pasted into every entity.
- **Walkthrough**
  - `Configure` (lines 38-50): calls `base.Configure` (the `DomainEvents` exclusion), then reads `GetType().GetCustomAttribute<UseDataSourceAttribute>()?.DataSource` (line 44) and throws an actionable `InvalidOperationException` if the attribute is absent, so a misconfigured class fails loudly at model build.
  - `ApplyEngineConventions` (lines 58-100): a `protected static` helper (shared by the shim bases) that switches on the engine. It first reads `typeof(TEntity).IsIdValueGenerated` (line 62), the [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions) member backed by `[IdValueGenerated]`.
  - **SQL Server** (lines 66-73): `ToTable(typeof(TEntity).Name, NamespaceConventions.GetModuleName(...) ?? "dbo")` maps the entity to a table in its module schema; `HasKey(p => p.Id)`; then `ValueGeneratedOnAdd()` or `ValueGeneratedNever()` depending on `isIdValueGenerated`.
  - **SQLite** (lines 75-82): same but with no schema (`ToTable(typeof(TEntity).Name)`) and `UseIdentityColumn(1, 1)` for generated ids.
  - **Cosmos** (lines 84-95): maps every entity in a module to one container (module name, or the entity name as fallback) with `HasPartitionKey(p => p.Id)`, since Cosmos requires related documents to share a container for navigations to work; generated ids use a client-side `HasValueGenerator<CosmosIntIdValueGenerator>()` because Cosmos has no server-side identity.
  - The `default` case (lines 97-98) throws for any unimplemented engine.
- **Why it's built this way**: folding the per-engine mechanics into one base (rather than duplicating them across three provider classes) is the reason the framework can strip relational-only constructs and degrade cross-source relationships automatically while keeping the same configuration body portable (see ADR-006, database-per-service, and [`CrossDataSourceDegradeConvention`](group-07-persistence-ef-core.md#crossdatasourcedegradeconvention)).
- **Where it's used**: the direct base of the three engine shims ([SQLServer](#entitytypeconfigurationsqlservertentity-tidentifiertype), [Sqlite](#entitytypeconfigurationsqlitetentity-tidentifiertype), [Cosmos](#entitytypeconfigurationcosmostentity-tidentifiertype)); concrete per-entity configurations in both apps derive from one of those shims.

---

### ReadRepositoryExtensions

> MMCA.Common.Application · `MMCA.Common.Application.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10` · Level 6 · class (static)

- **What it is**: adds a `GetByIdOrFailAsync` extension member to [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype), turning the null-returning lookup into a [`Result<TEntity>`](group-01-result-error-handling.md#result) that fails with [`Error.NotFound`](group-01-result-error-handling.md#error) when the entity is absent.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error).
- **Concept**: C# `extension(T)` members (see [primer](../00-primer.md)) applied to an infrastructure abstraction from the Application layer. `[Rubric §15: Best Practices]`: it removes the load-then-null-check-then-404 boilerplate otherwise repeated in every command handler.
- **Walkthrough**: the `extension<TEntity, TIdentifierType>(IReadRepository<...> repository)` block (line 12) hosts `GetByIdOrFailAsync` (lines 27-48). It calls `GetAllAsync` with a `where: e => e.Id.Equals(id)` predicate (rather than `GetByIdAsync`) so the call still flows through the full `includes` pipeline (lines 34-38), takes `FirstOrDefault`, and on `null` returns `Result.Failure(Error.NotFound.WithSource(source).WithTarget(typeof(TEntity).Name))` (lines 43-44), stamping both the caller source and the entity type onto the error.
- **Where it's used**: called by command handlers across the modules whenever they need to load an entity or fail with a typed not-found error.

---

### EFRepository<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:14` · Level 7 · class (internal sealed)

- **What it is**: the concrete read-write repository. It extends [`EFReadRepository`](#efreadrepositorytentity-tidentifiertype) (inheriting the entire query surface) and adds mutation: `AddAsync`, `AddRangeAsync`, `UpdateAsync`, `UpdateRange`, `SetOriginalRowVersion`, `ExecuteDeleteAsync`, `Save`, `SaveChangesAsync`.
- **Depends on**: [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) (base), [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) (implements it), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), EF Core's `DbContext`.
- **Concept introduced: safe update of possibly-tracked entities and defensive context hygiene.** `[Rubric §8: Data Architecture]` assesses correct EF usage that avoids duplicate-tracking and broken-context traps. `UpdateAsync` (lines 43-61) handles the common disconnected-entity trap: calling `DbSet.Update` on an entity whose key is already tracked throws. The fix (lines 50-54) does an O(1) identity-map lookup via `Entities.Local.FindEntry(entity.Id)` (never a database round-trip) and, when the entity is already tracked, patches it in place with `trackedEntry.CurrentValues.SetValues(entity)`; only otherwise does it call `Entities.Update(entity)`. On `DbUpdateException`, `GetFullErrorTextAndRollbackEntityChanges` (lines 103-129) resets all Added/Modified entries to `Unchanged` and persists that reset so the context is left usable, then rethrows with the full error text.
- **Walkthrough**
  - `AddAsync` / `AddRangeAsync` (lines 21-32): thin wrappers over `Entities.AddAsync` / `AddRangeAsync`.
  - `UpdateRange` (lines 64-68): bulk `Entities.UpdateRange`, with no local-tracking check (the caller owns consistency).
  - `SetOriginalRowVersion` (lines 71-80): plants the client's last-known token as `_context.Entry(entity).Property(nameof(AuditableBaseEntity<>.RowVersion)).OriginalValue`, so EF's optimistic-concurrency check compares it against the stored value on the next save; no-ops when the row version is null or empty.
  - `ExecuteDeleteAsync` (lines 83-89): EF bulk delete (`Where(where).ExecuteDeleteAsync`) that bypasses the change tracker, used for hard purges (outbox pruning, anonymized data).
  - `Save` / `SaveChangesAsync` (lines 92-96): delegate to the context; used by callers that operate outside the unit of work.
- **Why it's built this way**: `internal sealed` keeps the implementation off the public API; callers only ever see [`IRepository`](#irepositorytentity-tidentifiertype). The tracked-entity detection avoids an EF anti-pattern that commonly bites teams attaching request-scoped disconnected entities to a live context.
- **Where it's used**: instantiated by [`RepositoryFactory.Create`](#repositoryfactory) and reached through [`IRepository`](#irepositorytentity-tidentifiertype) by command handlers.

---

### EFRepositoryDecorator<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:13` · Level 7 · class (internal sealed)

- **What it is**: the MiniProfiler timing decorator for the read-write [`IRepository`](#irepositorytentity-tidentifiertype). It extends [`EFReadRepositoryDecorator`](#efreadrepositorydecoratortentity-tidentifiertype) (inheriting the profiled read methods) and adds profiled write methods.
- **Depends on**: [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) (base), [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`ProfilingHelper`](group-07-persistence-ef-core.md#profilinghelper).
- **Concept**: the Decorator pattern from [`EFReadRepositoryDecorator`](#efreadrepositorydecoratortentity-tidentifiertype), extended to write operations. `[Rubric §13: Observability]` assesses granular timing of persistence.
- **Walkthrough**: the `_inner` field (line 20) holds the wrapped `IRepository`; each mutation wraps `_inner` in `ProfilingHelper.ProfileAsync` / `Profile` / a `BeginStep` scope (for the synchronous `UpdateRange`, lines 34-38). The one deliberate exception is `SetOriginalRowVersion` (lines 40-41), which passes straight through unprofiled because it is an in-memory metadata operation with no I/O worth timing.
- **Where it's used**: applied by [`RepositoryFactory.Create`](#repositoryfactory) over [`EFRepository`](#efrepositorytentity-tidentifiertype) when `UseMiniProfiler` is enabled.

---

### EntityTypeConfigurationCosmos<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationCosmos.cs:19` · Level 7 · class (abstract)

- **What it is**: a thin shim base that fixes the engine to `DataSource.CosmosDB`. It carries no mapping logic of its own; all of it lives in the engine-aware [`EntityTypeConfiguration`](#entitytypeconfigurationtentity-tidentifiertype).
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (extends it), [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute), [`DataSource`](group-07-persistence-ef-core.md#datasource).
- **Concept**: the shim exists purely as ergonomics: deriving from it is equivalent to deriving from [`EntityTypeConfiguration`](#entitytypeconfigurationtentity-tidentifiertype) and annotating the concrete class with `[UseDataSource(DataSource.CosmosDB)]`. `[Rubric §15: Best Practices]` (one clear, discoverable base per engine).
- **Walkthrough**: the entire class is the `[UseDataSource(DataSource.CosmosDB)]` attribute (line 18) plus the class declaration (line 19); there is no body. At model build, the engine-aware base reads that attribute and runs the Cosmos branch of `ApplyEngineConventions`.
- **Where it's used**: base class for any concrete entity configuration routed to Cosmos (a secondary persistence path, not the primary for ADC or Store production).

---

### EntityTypeConfigurationSqlite<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSqlite.cs:18` · Level 7 · class (abstract)

- **What it is**: the SQLite shim base that fixes the engine to `DataSource.Sqlite`. Same shape as the Cosmos and SQL Server shims; the attribute value is the only difference.
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype), [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute), [`DataSource`](group-07-persistence-ef-core.md#datasource).
- **Concept**: see [`EntityTypeConfigurationCosmos`](#entitytypeconfigurationcosmostentity-tidentifiertype): deriving from this base equals deriving from [`EntityTypeConfiguration`](#entitytypeconfigurationtentity-tidentifiertype) and annotating with `[UseDataSource(DataSource.Sqlite)]`.
- **Walkthrough**: `[UseDataSource(DataSource.Sqlite)]` (line 17) plus the bodyless class declaration (line 18). The engine-aware base maps a schema-less table and uses `UseIdentityColumn(1, 1)` for generated keys.
- **Where it's used**: base for SQLite entity configurations, primarily in integration tests and in-memory scenarios.

---

### EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:18` · Level 7 · class (abstract)

- **What it is**: the SQL Server shim base that fixes the engine to `DataSource.SQLServer`, the production default. Same structure as the Cosmos and SQLite shims.
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype), [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute), [`DataSource`](group-07-persistence-ef-core.md#datasource).
- **Concept**: see [`EntityTypeConfigurationCosmos`](#entitytypeconfigurationcosmostentity-tidentifiertype): deriving from this base equals deriving from [`EntityTypeConfiguration`](#entitytypeconfigurationtentity-tidentifiertype) and annotating with `[UseDataSource(DataSource.SQLServer)]`.
- **Walkthrough**: `[UseDataSource(DataSource.SQLServer)]` (line 17) plus the bodyless class declaration (line 18). The engine-aware base derives the table name from the entity class name and the SQL schema from the module namespace (the segment before `Domain`, via [`NamespaceConventions`](group-07-persistence-ef-core.md#namespaceconventions)), and configures key generation from `[IdValueGenerated]`.
- **Where it's used**: the base class for the great majority of per-entity configurations in the Conference, Engagement, Identity, and Notification modules across both apps.

---

### IRepositoryFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/IRepositoryFactory.cs:11` · Level 7 · interface

- **What it is**: the factory contract for creating repository instances bound to a specific `DbContext`, with optional MiniProfiler wrapping folded in.
- **Depends on**: [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype), [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype), [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), EF Core's `DbContext`.
- **Concept**: a factory over `DbContext` because repositories must bind to a *specific* context instance (the one chosen by the entity's physical data source), which plain DI cannot express. `[Rubric §2: Design Patterns]` (factory abstraction at the persistence boundary).
- **Walkthrough**: two methods: `Create<TEntity, TIdentifierType>(DbContext)` (line 19) constrained to `AuditableAggregateRootEntity` and returning [`IRepository`](#irepositorytentity-tidentifiertype), so only aggregate roots get a write repository; and `CreateReadOnly<TEntity, TIdentifierType>(DbContext)` (line 30) constrained to any `AuditableBaseEntity` and returning [`IReadRepository`](#ireadrepositorytentity-tidentifiertype). The constraint split mirrors the aggregate-root-only write rule from the domain.
- **Where it's used**: implemented by [`RepositoryFactory`](#repositoryfactory) and consumed by the unit-of-work implementation and the testing infrastructure.

---

### RepositoryFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:13` · Level 8 · class (sealed)

- **What it is**: the concrete [`IRepositoryFactory`](#irepositoryfactory): it builds an [`EFRepository`](#efrepositorytentity-tidentifiertype) / [`EFReadRepository`](#efreadrepositorytentity-tidentifiertype) over a supplied `DbContext` and, when profiling is enabled, wraps it in the matching MiniProfiler decorator.
- **Depends on**: `IServiceProvider` (for `ActivatorUtilities`), [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype).
- **Concept reinforced: factory plus conditional decorator.** `[Rubric §2: Design Patterns]` and `[Rubric §13: Observability]`. `Create` (lines 24-40) and `CreateReadOnly` (lines 48-64) use `ActivatorUtilities.CreateInstance` to build the base repository with the chosen context injected, then wrap it in an [`EFRepositoryDecorator`](#efrepositorydecoratortentity-tidentifiertype) / [`EFReadRepositoryDecorator`](#efreadrepositorydecoratortentity-tidentifiertype) only when `_applicationSettings.UseMiniProfiler` is true (lines 33, 57). Profiling is therefore a zero-overhead, config-toggled opt-in rather than a compile-time choice.
- **Why it's built this way**: the unit of work needs a repository over a *specific* context instance (selected by data source), which off-the-shelf DI cannot produce; the factory does, and folds the optional profiling decision into the same point of construction so callers never branch on "is profiling on."
- **Where it's used**: called by the unit-of-work implementation's `GetRepository` / `GetReadRepository` when a handler asks for a repository over a given physical source.

### PushNotificationConfiguration

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:15` · Level 8 · internal sealed class

- **What it is**: the EF Core mapping for the [`PushNotification`](group-10-notifications.md#pushnotification) aggregate root, the broadcast record of a notification sent to a set of recipients. It maps that entity into the `Notification` schema and shapes its scalar columns (`PushNotificationConfiguration.cs:15`).
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) (the engine-fixing base it extends, `PushNotificationConfiguration.cs:16`); the domain type [`PushNotification`](group-10-notifications.md#pushnotification) and its [`PushNotificationStatus`](group-10-notifications.md#pushnotificationstatus) enum (`PushNotificationConfiguration.cs:3`); the [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) it is annotated with (`PushNotificationConfiguration.cs:14`); EF Core's `EntityTypeBuilder<TEntity>` and `IEntityTypeConfiguration<TEntity>` machinery (BCL/NuGet, `PushNotificationConfiguration.cs:1-2`).
- **Concept introduced, overriding the auto-derived database and schema with `[UseDatabase]`.** By default this framework derives an entity's physical routing from its namespace: the SQL schema and the logical database name both come from the namespace segment before `Domain` (see [`NamespaceConventions`](#namespaceconventions), `NamespaceConventions.cs:16`). That rule works cleanly for a module such as `MMCA.Store.Sales.Domain.Orders` (schema and database `Sales`), but it misfires for framework-owned entities: `PushNotification` lives in `MMCA.Common.Domain.Notifications.PushNotifications`, so the segment before `Domain` is `Common` and the entity would land in a `Common` schema and a `Common` database. Two overrides fix that. The class-level `[UseDatabase("Notification")]` (`PushNotificationConfiguration.cs:14`) replaces the derived *logical database* name, so hosts that declare a `DataSources:Notification` connection string get a dedicated notification database, and hosts that do not simply collapse these tables onto the `Default` source (single-database behavior stays intact; see [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) and [`DataSourceResolver`](#datasourceresolver)). The `builder.ToTable(...)` call inside `Configure` (`PushNotificationConfiguration.cs:24`) replaces the derived *SQL schema* from `Common` to `Notification`. Together they place the notification tables under their own schema and let them route to their own database when one is configured. `[Rubric §8, Data Architecture]` assesses how deliberately data is partitioned, keyed, and typed at the storage boundary; here schema isolation and a string-persisted status enum are chosen explicitly rather than left to convention. `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without a rewrite; routing notifications to a named logical database is exactly the seam that lets the notification store move to its own physical database (ADR-006) with no code change.
- **Walkthrough**
  - **`[UseDatabase("Notification")]`** (`PushNotificationConfiguration.cs:14`): the class-level attribute read eagerly by [`EntityDataSourceRegistry`](#entitydatasourceregistry) to route every `PushNotification` to the `Notification` logical database.
  - **Base class** (`PushNotificationConfiguration.cs:16`): extends [`EntityTypeConfigurationSQLServer<PushNotification, PushNotificationIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype), a thin shim carrying `[UseDataSource(DataSource.SQLServer)]` that delegates all mapping logic to [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype).
  - **`base.Configure(builder)`** (`PushNotificationConfiguration.cs:21`): runs the shared engine-aware pipeline. That base (`EntityTypeConfiguration.cs:38`) null-checks the builder, calls its own base to exclude the in-memory `DomainEvents` collection from mapping for aggregate roots (`EntityTypeConfigurationBase.cs:25-33`), reads the `[UseDataSource]` engine, and for SQL Server sets the table name to the entity name, the schema to the derived module name (here `Common`), the primary key, and, because `PushNotification` carries [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute), `Property(Id).ValueGeneratedOnAdd()` (`EntityTypeConfiguration.cs:66-73`). Note what this base does *not* do: it configures no soft-delete filter, audit columns, or `RowVersion` token here; those cross-cutting concerns are stamped and filtered centrally by [`ApplicationDbContext`](#applicationdbcontext), not in this configuration.
  - **`builder.ToTable(nameof(PushNotification), "Notification")`** (`PushNotificationConfiguration.cs:24`): re-maps the table (still named `PushNotification`) into the `Notification` schema, overriding the `Common` schema the base just derived.
  - **`Title`** (`PushNotificationConfiguration.cs:26-28`): required, `HasMaxLength(200)`.
  - **`Body`** (`PushNotificationConfiguration.cs:30-32`): required, `HasMaxLength(2000)`.
  - **`SentByUserId`** (`PushNotificationConfiguration.cs:34-35`) and **`RecipientCount`** (`PushNotificationConfiguration.cs:37-38`): both required.
  - **`Status`** (`PushNotificationConfiguration.cs:40-43`): required, `HasConversion<string>()` with `HasMaxLength(20)`. The [`PushNotificationStatus`](group-10-notifications.md#pushnotificationstatus) enum is persisted as its member name rather than an ordinal integer, so the stored value is self-describing and reordering or inserting enum members never silently corrupts existing rows.
- **Why it's built this way**: the auto-derivation convention keeps per-module entities zero-configuration, but framework-owned entities under `MMCA.Common.Domain` need an explicit escape hatch so they do not all pile into a `Common` schema and database. Keeping the two overrides (database via attribute, schema via `ToTable`) side by side in one small configuration makes the notification store's placement obvious and lets it become a real database-per-service source when a host opts in (ADR-006). Persisting the status as a string is a maintainability choice that trades a couple of bytes per row for migration-safe enum evolution.
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
- **Why it's built this way**: the pairing is deliberate: `PushNotification` is the broadcast fact (one row per send), `UserNotification` is the fan-out inbox (one row per recipient), and keeping them as two aggregates joined by a scalar `PushNotificationId` (rather than an EF navigation) is what lets the whole notification store move to its own database without a foreign-key constraint spanning physical sources (ADR-006). The filtered indexes are the concession that makes soft-delete and a hot unread-count query coexist: uniqueness that ignores tombstones, and a lookup index that never scans them.
- **Where it's used**: discovered and applied by [`ApplicationDbContext`](#applicationdbcontext) during model building and registered with [`EntityDataSourceRegistry`](#entitydatasourceregistry) for routing. The mapped table backs the per-user notification inbox surfaced through the SignalR pipeline and the inbox/read-state APIs.


---
[⬅ Validation](group-06-validation.md)  •  [Index](00-index.md)  •  [Authentication & Authorization ➡](group-08-auth.md)
