# 7. Persistence & EF Core

**What this group covers.** This is the framework's data-access engine: everything between a domain
aggregate and a row in a database. It is the single largest group in the guide because it carries a
lot of load. One abstract [`ApplicationDbContext`](#applicationdbcontext) base with a sealed subclass
per engine ([`SQLServerDbContext`](#sqlserverdbcontext), [`CosmosDbContext`](#cosmosdbcontext),
[`SqliteDbContext`](#sqlitedbcontext)); four EF Core save interceptors that turn a plain
`SaveChangesAsync` into audit stamping, tenant enforcement, transactional domain-event capture, and a
field-level change trail; a small repository family behind an interface-segregated contract
([`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype),
[`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype),
[`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype)) coordinated by a
[`UnitOfWork`](#unitofwork); a data-source routing layer that lets every entity resolve to its own
physical database ("database per service") and every tenant optionally to its own copy of it; two
model-finalizing conventions that keep that routing honest; an engine-portable entity-configuration
hierarchy; and a supporting cast of value converters, value generators, an encryption converter,
seeders, and design-time factories. The group also hosts the framework's non-EF storage-adjacent
services: blob storage, image normalization, native push registration and delivery, and the shared
periodic-sweep base class. The whole thing is the [Rubric §8, Data Architecture] chapter of the
codebase, and it leans hard on [Rubric §7, Microservices Readiness] and
[Rubric §3, Clean Architecture].

## One base context, one class per engine, one instance per database

[`ApplicationDbContext`](#applicationdbcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:39`)
is an abstract primary-constructor class over EF's `DbContext`. It holds the cross-cutting model
configuration every engine shares. It applies a global soft-delete query filter to every non-owned
[`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) using a runtime-built
expression tree, registered as a **named** `"SoftDelete"` filter (`ApplicationDbContext.cs:336-350`,
name at `:357`); it applies a second named `"Tenant"` filter to every non-owned
[`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity) (`ApplicationDbContext.cs:394-443`);
it configures the `RowVersion` optimistic-concurrency token, mapped as a SQL Server `rowversion` or as
a plain application-managed token on other providers (`ApplicationDbContext.cs:456-476`); and it maps
the framework's own bookkeeping tables so every relational database carries its own
([`OutboxMessage`](group-04-events-outbox.md#outboxmessage) at `:483-507`,
[`InboxMessage`](group-04-events-outbox.md#inboxmessage) at `:514-528`,
[`ScheduledJobEntry`](group-14-module-system-composition.md#scheduledjobentry) at `:538-563`,
[`AuditTrailEntry`](#audittrailentry) at `:572-601`), each with the filtered indexes its poll path and
its retention sweep need (`IX_OutboxMessages_Pending` at `:496-499`, `IX_OutboxMessages_Processed` at
`:504-506`, `IX_InboxMessages_MessageId` at `:520-522`, `IX_ScheduledJobs_NextRunOn` at `:559-561`,
`IX_AuditTrailEntries_Entity` at `:592-593`). Two of those four tables are **gated**: the job table is
mapped only when `Scheduler:Enabled` is set AND this context targets the `Default` source (jobs are
host-scoped, `:266-268`), the trail table only when `AuditTrail:Enabled` is set, on every relational
source (a trail row must commit with the change it describes, and a transaction does not span
databases, `:271`). A host that opted into neither keeps the model it had before those features
shipped, so neither table ever appears in its migrations. The base also registers four keyless
[`ValReturn<T>`](#valreturnt) shapes (`:105`, `:311-314`) so raw SQL scalar queries have somewhere to
land.

Its `SaveChangesAsync(userId, ...)` overload (`ApplicationDbContext.cs:133-147`) is the one entry
point handlers care about: it stashes the current user id in `CurrentSaveUserId` so the audit
interceptor can read it, delegates to `base`, then clears it in a `finally` so a later internal save
cannot silently reuse the previous caller's identity (`:145`). The base also overrides both
`SaveChanges` overloads purely to run change detection once per save and suppress it for the rest,
through the `DetectChangesOnce` helper and its [`DetectChangesScope`](#detectchangesscope) disposable
(`:153-159`, `:186-190`, `:213-226`): each interceptor's `ChangeTracker.Entries<T>()` call would
otherwise trigger a full `DetectChanges`, so a save paid three snapshot comparisons where one
suffices, and the previous auto-detect setting is restored on the way out (`:225`).

The design decision that shapes this whole group is stated in the base's own doc comment: **one
context class per engine, one instance per physical data source** (`ApplicationDbContext.cs:28-33`).
The same [`SQLServerDbContext`](#sqlserverdbcontext) class
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:16`)
is instantiated once per SQL Server database, each instance carrying a different
[`PhysicalDataSource`](#physicaldatasource) (connection string, migrations assembly, Cosmos database
name). To keep EF from silently reusing the first-built model for every database,
[`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16`)
keys EF's model cache by context type plus physical source name plus the design-time flag, and is
installed by the base in `OnConfiguring` (`ApplicationDbContext.cs:276`). This is deliberately not a
per-module context split: one sealed context per engine over the abstract base is
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)'s ruling.
`SQLServerDbContext` adds the provider-specific touches: a per-environment command timeout read from
[`PersistenceSettings`](group-14-module-system-composition.md#persistencesettings) rather than
ADO.NET's silent 30-second default (`SQLServerDbContext.cs:56`, with the settings object resolved once
into a field at `:36-37` using `GetService` so the design-time provider, which registers no options at
all, cannot be made to throw), transient-fault retry (`EnableRetryOnFailure` with 5 attempts and a
10-second cap, `:64-67`), and a suppressed `PendingModelChangesWarning` (`:80`) so an extracted service
that registers only its own module's entity configurations starts cleanly against a migration snapshot
that captures every module's tables. That warning suppression is a direct
[Rubric §7, Microservices Readiness] decision, and the source comment states the trade-off plainly:
monolith hosts lose the "you forgot a migration" safety net, so CI is expected to run
`dotnet ef migrations has-pending-model-changes` as a separate gate (`:69-79`). The retry comment also
carries a rule the rest of the group depends on: with retry-on-failure enabled a manual
`BeginTransactionAsync` must run inside `Database.CreateExecutionStrategy().ExecuteAsync` (`:61-63`).

## SaveChanges as an interceptor pipeline

The base context resolves its interceptors from DI in `OnConfiguring`
(`ApplicationDbContext.cs:236-261`), and **registration order is execution order**. The audit
interceptor runs first, the tenant interceptor between it and the domain-event interceptor (so the
outbox rows describe an entity whose tenant is already final, `:239-251`), and the change-trail
interceptor last, because it diffs the final values (`:253-261`). Two of the four are resolved with
`GetService` rather than `GetRequiredService`: a directly-constructed test context or a host that
never called `AddAuditTrail` must still build, and their absence has to read as "the feature is off"
rather than fail every context construction.

[`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:13`)
runs on `SavingChanges`: it walks every tracked
[`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), stamps `CreatedOn/By` plus
`LastModifiedOn/By` on `Added` (`:47-52`), and on `Modified` marks the two `Created*` properties
unmodified before re-stamping `LastModified*` (`:53-58`), reading the timestamp from an injected
`TimeProvider` and the user id from `CurrentSaveUserId` (falling back to `default` as the
system-operation sentinel, `:40-41`). This is why the domain declares audit fields with private setters
and never writes them: the interceptor sets them centrally through `entry.Property(...).CurrentValue`,
bypassing setter visibility. That is the [Rubric §10, Cross-Cutting Concerns] payoff, one enforcement
point instead of copy-paste in every handler.

[`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:38`)
is the producer end of the outbox, and it is the most subtle type in the group. On `SavingChanges` it
snapshots each tracked [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) and its
pending [`IDomainEvent`](group-04-events-outbox.md#idomainevent)s into an
[`AggregateCapture`](#aggregatecapture) record (`:198-202`, record at `:349`), then writes an
[`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row for each event into the same context, so
the events land in the database **in the same transaction** as the aggregate changes (`:184-248`). The
routing split happens right there: an
[`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) gets a row but no in-process
dispatch (its row stays unprocessed so the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor)
publishes it over [`IMessageBus`](group-04-events-outbox.md#imessagebus)), while a local event gets both
a row and the fast in-process path (`:226-235`). Before capturing, `DiscardAbandonedCapture` detaches
the `Added` outbox rows left by a previous `SavingChanges` that never reached `SavedChanges`
(`:255-272`), which is what stops an execution-strategy retry from writing a second row per event and
publishing every integration event twice. The captured state is parked in a
[`CapturedState`](#capturedstate) record (`:358`) held in a `ConditionalWeakTable` keyed by context
(`:48`), so it is cleaned up automatically when the context is disposed. A third weak table (`:63`)
holds a per-context capture exclusion set: `BeginCaptureExclusion` / `EndCaptureExclusion` (`:162-178`)
let [`DbContextFactory`](#dbcontextfactory) name exactly the entries it hides from an
`IDENTITY_INSERT` round, so an event is never serialized and cleared a round before the insert that
justifies it. The exclusion is by instance rather than by entity state on purpose: a state-based filter
would also drop events raised on an already-saved aggregate, which is how the identity module publishes
its registration events (`:155-159`).

After the save, `SavedChangesAsync` does one of two things (`DomainEventSaveChangesInterceptor.cs:278-295`).
With no ambient transaction it flushes immediately: dispatch local events through
[`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher), remove exactly the
captured events from their aggregates, mark the local outbox rows processed, and signal the outbox for
integration events (`:301-329`). With an active transaction it removes the captured events (so a second
save inside the same transaction cannot re-capture them) and parks a
[`DeferredDispatch`](#deferreddispatch) (`:365`) in a second weak table (`:55`);
[`DbContextFactory`](#dbcontextfactory) then calls the static `FlushDeferredAsync` only after a
successful commit (`:128-137`) and `DropDeferred` on rollback (`:145`). That is what keeps handler side
effects from acting on state that could still roll back, and what keeps a retrying execution strategy
from dispatching the same events once per attempt. Note the precision of the clearing: the interceptor
calls `RemoveDomainEvents(capture.Events)` rather than clearing the aggregate wholesale (`:337-341`), so
an event a handler raises on the same aggregate during in-process dispatch survives to a later capture
instead of being wiped. If in-process dispatch throws, the interceptor logs a warning and signals the
outbox to retry from the persisted rows rather than losing the event (`:315-323`). The synchronous
`SavedChanges` path cannot await a dispatcher at all, so it removes the captured events, signals the
outbox, and leaves delivery entirely to it (`:108-121`). Cosmos DB has no relational outbox table, so
the base exposes a `SupportsOutbox` flag (`ApplicationDbContext.cs:116`) that
[`CosmosDbContext`](#cosmosdbcontext) overrides to `false` (`CosmosDbContext.cs:69`) and the interceptor
honors by dispatching everything in-process instead (`:239-244`). This split, atomic persistence plus
best-effort immediate dispatch with a durable fallback, is the at-least-once contract of
[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html); the consumer end lives in
[Group 04](group-04-events-outbox.md).

## The tenant boundary, read filter plus write guard

Multi-tenancy ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) is two
independent halves that meet in this group. The **read** half is the named `Tenant` query filter the
base context applies to every non-owned [`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity)
(`ApplicationDbContext.cs:394-443`). Three details make it work: the filter body embeds the context
instance as a constant typed as `ApplicationDbContext`, so EF rewrites it to the executing context and
lifts `CurrentTenantId` into a SQL parameter, letting **one compiled model serve every tenant**
(`:380-386`, `:401-402`); the predicate is `CurrentTenantId == null || e.TenantId == CurrentTenantId`,
so a scope with no tenant (the outbox processor, the seeders, the retention jobs) sees every tenant's
rows (`:435-441`); and the column itself is declared required, 64 characters, non-Unicode, and
**indexed** on relational engines, because every tenant-scoped read carries it as the leading predicate
(`:411-422`, width constant at `:366`). Because the two filters are named, EF composes them with AND,
and a caller asking for soft-deleted rows drops exactly the `SoftDelete` filter while the tenant filter
stays in force: the repository contract says so in as many words
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:14-18`,
`:39-43`).

The **write** half is [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:36`).
It stamps the scope's tenant onto an insert that declares none (`:116-120`), refuses an insert that
names a different one (`:122-123`), and on update or delete checks **both** the original and the current
value, so touching another tenant's row and reassigning a row to another tenant are both rejected
(`:131-153`). An untenanted insert from an untenanted scope is refused too, because silently writing a
row no tenant can ever read is worse than failing the save (`:107-110`). Owned types are skipped on both
sides: an owned value has no independent existence and its owner's tenant is already the row's tenant
(`:70-75`). Failures surface as [`CrossTenantWriteException`](#crosstenantwriteexception)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/CrossTenantWriteException.cs:24`),
which derives from `InvalidOperationException` so existing catch sites treat it like any other save-time
invariant failure (`:19-22`). The deliberate asymmetry is documented in the interceptor's own remarks: a
caller who bypasses the read filter with EF's parameterless `IgnoreQueryFilters()` can read across
tenants, but still cannot write across them (`:30-34`). That is [Rubric §11, Security] and
[Rubric §30, Compliance and Data Governance] in one type. The scope's tenant itself lives in
[`TenantContext`](#tenantcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TenantContext.cs:11`), which is
set-once-per-scope and idempotent for the same value, and throws rather than switching tenants
mid-scope (`:20-44`). Database-per-tenant is handled one layer up, in the factory, and background
sweeps expand their work list through [`TenantDataSourceTargets`](#tenantdatasourcetargets)`.Expand`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:49-79`),
which emits the shared target for every source plus one extra
[`TenantDataSourceTarget`](#tenantdatasourcetarget) (`:13`) per tenant that overrides a source, because
a tenant with its own database is invisible to the shared sweep (`:23-39`).

## Recording what changed, the audit trail

[`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:62`)
is the fourth interceptor and the newest ([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)).
It records a field-level history for entities marked
[`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity), writing
[`AuditTrailEntry`](#audittrailentry) rows in the same transaction as the change they describe, on the
outbox precedent that a trail committable without its data is worse than no trail (`:18-23`). A
`Modified` save produces one row per property whose value actually changed; `Added` and `Deleted`
produce a single summary row with a null `PropertyName`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailEntry.cs:15-21`).
Four things are worth knowing about it. It is opt-in twice over, once through `AddAuditTrail` (the
interceptor is resolved with `GetService`) and once through `AuditTrail:Enabled` (which maps the table),
and both are checked cheaply per save by asking the model whether the entity type exists at all
(`:182-185`). Personal data never reaches the table: a property carrying
[`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute) records
[`PiiRedactor`](group-02-domain-building-blocks.md#piiredactor)`.RedactedToken` on both sides, and the
redaction happens **at capture, not at read**, so the trail cannot become a second copy of a data
subject's personal data that erasure would have to chase (`:37-42`,
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). The framework's own
bookkeeping types are excluded by CLR type rather than by marker absence, which is what stops the trail
from recording its own rows in an unbounded feedback loop (`:107-119`). And the correlation value it
records is the ambient `Activity` trace id rather than a scoped correlation service, because a
singleton interceptor holding a context built by the singleton physical factory cannot reach a scoped
service without a lifetime bug; the doc comment says exactly that and names the accessor pattern
tenancy introduced as the way to change it later (`:44-54`). Two more types close the feature:
[`AuditTrailReader`](#audittrailreader) (`.../AuditTrail/AuditTrailReader.cs:35`) serves paged history
for one entity and states its own v1 limitation, that it reads only the `Default` source's trail table
(`:16-25`), and [`AuditTrailCleanupJob`](#audittrailcleanupjob) (`.../AuditTrail/AuditTrailCleanupJob.cs:48`)
is the framework's own recurring job, purging rows past `RetentionDays` from every relational source
nightly at 03:00 UTC in 1000-row `ExecuteDelete` batches (`:58`, `:67`, `:70-80`). It only runs if the
host also runs the scheduler, and a host that records the trail without one is fully supported: pruning
is then the operator's job (`:23-28`).

## Repositories and the unit of work

Handlers do not touch a `DbContext` directly. They ask a [`UnitOfWork`](#unitofwork)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13`) for a repository.
The repository contract is deliberately interface-segregated
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs`, the contract
[ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html) states): a
handler that only needs a lookup can depend on the narrow
[`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype) (`IRepository.cs:19`)
or [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype) (`:78`);
[`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (`:134`) combines
both plus four `IQueryable` surfaces (tracking, no-tracking, single-query, split-query, `:140-149`),
[`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype) (`:157`) adds
mutation, and [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) (`:262`) is
the union. That layering is the group's clearest [Rubric §1, SOLID] (interface-segregation) statement,
and [`ReadRepositoryExtensions`](#readrepositoryextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10`) adds the
`GetByIdOrFailAsync` convenience that turns a miss into a
[`Result`](group-01-result-error-handling.md#result) failure (`:27-48`). The concrete
[`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype)
(`.../Repositories/EFReadRepository.cs:15`) and
[`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:23`) wrap
an EF `DbSet`. The write side patches already-tracked entities in place through an O(1)
`Local.FindEntry` lookup instead of re-attaching (`EFRepository.cs:52-65`) and seeds `RowVersion`
original values for optimistic concurrency on both the aggregate and any child implementing
[`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) (`:75-96`,
[ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Two set-based escape
hatches sit beside the tracked path: `ExecuteDeleteAsync`, which the interface itself documents as
bypassing domain events, audit stamps, and soft-delete (`IRepository.cs:211-221`), and
`ExecuteUpdateAsync` (`:223-245`), the contention-proof conditional update whose guard predicate lets
the database arbitrate two racing callers with no rowversion retry loop. The latter is described
through the persistence-agnostic
[`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) surface and replayed onto EF's setters
builder by [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity)
(`.../Repositories/UpdatePropertySetterBuilder.cs:14`), which is what keeps EF Core out of the
Application layer, and because `ExecuteUpdate` bypasses the interceptor pipeline the repository stamps
`LastModifiedOn/By` itself unless the caller assigned them (`EFRepository.cs:121-132`).

Two factories keep the wiring honest. [`RepositoryFactory`](#repositoryfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:14`)
builds a repository over a given context and conditionally wraps it in a MiniProfiler decorator
([`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype) or
[`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype))
when `UseMiniProfiler` is on (`:33-38`, `:57-62`), adding timing without the base repository knowing,
and it activates both through a cached compiled `ObjectFactory` rather than reflecting on every call
(`:69-84`). [`DbContextFactory`](#dbcontextfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:39`)
is the scoped coordinator: it caches one [`ApplicationDbContext`](#applicationdbcontext) per
[`DataSourceKey`](#datasourcekey) so every repository in a scope shares one change tracker, gives each
new context a live tenant accessor rather than a copied value (`:134-140`), and enlists a late-created
context into an already-open transaction (`:108-109`). It is also the database-per-tenant routing point:
when the scope's tenant overrides a source, the context is created against that tenant's connection
string while keeping the **original** `DataSourceKey`, which is what lets one compiled model serve every
tenant's database (`:148-173`), and a cached routed context is refused to a second tenant rather than
silently serving the first tenant's rows (`:181-198`). Its save loop runs up to `MaxSavePasses` (3,
`:53`) passes over the cached contexts, because dispatching events in-process can materialize a context
for a source nobody had touched yet (`:242-256`), and it closes with a hard assertion: any context still
reporting `ChangeTracker.HasChanges()` when the unit of work returns throws rather than silently
discarding those changes (`:264-275`). Because there can be more than one physical source in play,
`ExecuteInTransactionAsync` runs the operation under the first transactional context's execution
strategy, opens a transaction per source, and commits them sequentially with no two-phase commit
(`:501-543`); cross-source consistency is the outbox's job, and the doc comment is explicit that a
commit failure on the second source leaves the first one committed (`:492-499`). The method is
re-entrant: a nested call joins the ambient transaction instead of opening a second one, so only the
outermost call may begin, commit, roll back, or flush (`:505-513`). A returned failed
[`Result`](group-01-result-error-handling.md#result) rolls back exactly like an exception (`:562-569`),
which is what makes [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)'s
Result-over-exceptions rule safe for partial persistence; rollback also drops the deferred event
dispatch (`:448-452`), and a retry resets the change tracker first so the aborted attempt's `Added`
entities are not inserted twice (`ResetForRetry` at `:682-689`). `DbContextFactory` further carries the
`SET IDENTITY_INSERT` machinery ([`IdentityInsertGroup`](#identityinsertgroup) at `:410`, the per-table
save split at `:289-361`) for importing entities with explicit database-generated ids one table at a
time, and the `MigrateAsync` / `HasPendingMigrationsAsync` sweeps over every SQL Server source in use
(`:659-675`).

[`UnitOfWork`](#unitofwork) sits on top, resolving an entity's physical source through
[`IDataSourceService`](#idatasourceservice), handing the matching context to the factory, and caching the
resulting repository per closed generic interface type (`UnitOfWork.cs:33-66`). The physical creation
itself runs through [`PhysicalDbContextFactory`](#physicaldbcontextfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:16`),
a singleton that switches on the key's engine to construct the right context class (`:41-47`) and whose
doc comment warns it must **never** be pooled, because each instance carries per-source constructor
state that pooling would smear across databases (`:10-14`). Three thin adapters
([`DefaultSqlServerDbContextFactory`](#defaultsqlserverdbcontextfactory),
[`DefaultSqliteDbContextFactory`](#defaultsqlitedbcontextfactory),
[`DefaultCosmosDbContextFactory`](#defaultcosmosdbcontextfactory), all in
`.../Factory/DefaultEngineDbContextFactories.cs:13-37`) preserve EF's `IDbContextFactory<TContext>` DI
surface for the Default source, and [`ApplicationDbContextEFFactory`](#applicationdbcontexteffactory)
(`.../Factory/ApplicationDbContextEFFactory.cs:14`) picks among them from the `DefaultDataSource` or
`DataSource` configuration key, defaulting to SQL Server (`:29-30`). The interfaces
([`IUnitOfWork`](#iunitofwork), [`IDbContextFactory`](#idbcontextfactory),
[`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory), [`IRepositoryFactory`](#irepositoryfactory))
keep the application layer talking to abstractions. Every member of that factory family has its own
section below, including the two types that exist only because of what the coordinator does:
[`IdentityInsertGroup`](#identityinsertgroup), the per-table batch the `SET IDENTITY_INSERT` loop saves
one at a time, and [`TransactionCommitAmbiguousException`](#transactioncommitambiguousexception)
(`.../Factory/TransactionCommitAmbiguousException.cs:22`), which `ExecuteInTransactionAsync` throws when
the commit itself fails with an outcome nobody can vouch for. That last one is raised **outside** the
execution strategy on purpose (`DbContextFactory.cs:535-540`), because the strategy walks an
exception's whole inner chain to decide retriability and would otherwise re-run the operation on top of
a possibly-durable commit.

## Routing an entity to its database

The heart of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) is that every
entity resolves to a [`DataSourceKey`](#datasourcekey)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/DataSourceKey.cs:15`), a
`(Engine, Name)` record struct where the [`DataSource`](#datasource) engine
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:6`) is
one of Cosmos DB, SQLite, or SQL Server, and `Name` is a **physical** database name defaulting to
`"Default"` (`DataSourceKey.cs:18-23`). Two layers compute this.
[`DataSourceResolver`](#datasourceresolver)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:13`),
the [`IDataSourceResolver`](#idatasourceresolver) singleton (`.../DataSources/IDataSourceResolver.cs:15`),
builds the logical-to-physical map once per engine from configuration: named sources with no connection
string, or whose connection identity equals the top-level one, **collapse onto the `Default` source**,
so a host with no `DataSources` section behaves exactly like a single-database monolith
(`DataSourceResolver.cs:94-135`), and sources sharing a connection identity collapse onto one canonical
key named after their alphabetically-first member (`:172-210`). Identity is the connection string
compared ordinally, with the database name appended for Cosmos because one account hosts many databases
(`:257-260`). It fails fast when two logical names collapsing to one database declare conflicting
migrations assemblies (`:229-249`) and logs a warning when a separate SQL Server source falls back to the
Default migrations assembly (`:185-193`). [`EntityDataSourceRegistry`](#entitydatasourceregistry)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21`),
also a singleton, scans the configuration assemblies and maps each entity to its physical key, deriving
the engine from the [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute)
on the **configuration class** and the logical name from
[`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute), the entity's module
namespace via [`NamespaceConventions`](#namespaceconventions)`.GetModuleName`, or `Default`
(`EntityDataSourceRegistry.cs:172-185`). It caches an immutable [`Snapshot`](#snapshot) of frozen
collections built on first access (`:25-28`, `:84-96`, built at `:115-161`), rescans once on a lookup
miss when the assembly set changed so late-loaded module assemblies are picked up (`:98-113`), rejects an
entity claimed by two different sources (`:141-152`), and precomputes the distinct physical sources in
use so the outbox processor's per-poll call allocates nothing (`:75-82`, `:157-160`). Because the
registry reads the same attributes the model configuration reads, routing and model contents agree by
construction, and configurations that implement a provider interface directly without the attributed
base classes are deliberately skipped as legacy (`:168-178`). [`DataSourceService`](#datasourceservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12`) is the thin
application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry), and it answers
the one question navigation loading needs: two entities support EF `.Include()` only when their physical
keys are equal and the engine is not Cosmos (`DataSourceService.cs:31-32`).

## Two model-finalizing conventions

The base context adds both of its conventions in `ConfigureConventions`
(`ApplicationDbContext.cs:282-297`), and each exists because a cross-cutting policy above would
otherwise produce an invalid or surprising model.
[`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33`,
added at `ApplicationDbContext.cs:291`) is what lets routing be lazy and attribute-driven and still
produce a valid EF model. When a relationship's two ends live in different physical sources it removes
the foreign key (a database cannot enforce an FK into another database), keeps the declared scalar FK
columns plus a compensating index unless an existing index already covers them as a prefix, ignores the
CLR navigation members, and drops the foreign entity types out of this database's model entirely
(`CrossDataSourceDegradeConvention.cs:38-89`, `:107-165`). It works through EF's **mutable** model API
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
[Rubric §7, Microservices Readiness] claim.

[`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention)
(`.../Conventions/SoftDeleteUniqueIndexConvention.cs:24`, added at `ApplicationDbContext.cs:296`) closes
a smaller but sharper hole. Soft-delete hides a row from queries, but a plain unique index still enforces
uniqueness against it, so "deleting" a speaker would permanently block re-creating one with the same
email. The convention appends an `IsDeleted = 0` filter to every unique index on a soft-deletable entity,
leaves hand-authored filters untouched, and no-ops for Cosmos (`SoftDeleteUniqueIndexConvention.cs:33-56`).
The predicate text itself is not built inline: both this convention and the opt-in `HasSoftDeleteFilter`
extension go through [`SoftDeleteFilterSql`](#softdeletefiltersql)`.Build`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:27-38`), which
reads the column name from the model and quotes it per engine (brackets for SQL Server, double quotes for
SQLite, `null` for Cosmos), so the automatic and the hand-authored path can never disagree.
[`IndexBuilderExtensions`](#indexbuilderextensions) (`.../Configuration/IndexBuilderExtensions.cs:10`) is
that opt-in half, an `extension(IndexBuilder)` block for the case the convention deliberately leaves
alone: a hand-authored **non-unique** index that serves a live-row query and wants the same predicate
(`:12-64`, with an optional additional predicate joined by `AND` at `:60-63`). Both conventions run at
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
(`.../EntityTypeConfigurationCosmos.cs:18`) as its two siblings. The base reads the attribute off its own
runtime type and throws a clear error when it is missing (`EntityTypeConfiguration.cs:43-46`), then
applies the engine's conventions in `ApplyEngineConventions` (`:57-99`): SQL Server gets a table in a
module schema (`:65-72`), SQLite a plain table (`:74-81`), and Cosmos a per-module container with the
entity id as partition key (`:83-94`), each mapping key generation according to the entity's
[`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions)`.IsIdValueGenerated`
marker (`:61`): `ValueGeneratedOnAdd` for database identity, `ValueGeneratedNever` otherwise, or the
[`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator) for Cosmos, which has no server-side identity
and increments a process-level counter seeded from the Unix timestamp
(`.../ValueGenerators/CosmosIntIdValueGenerator.cs:16-25`). Because the engine is a single attribute and
the base implements all three provider marker interfaces
([`IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlservertentity-tidentifiertype),
[`IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlitetentity-tidentifiertype),
[`IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#ientitytypeconfigurationcosmostentity-tidentifiertype),
all over the common
[`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype)),
**moving an entity between engines is a one-line attribute change with no configuration-body edits**
(`EntityTypeConfiguration.cs:11-24`). The shared
[`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype)
(`.../EntityTypeConfigurationBase.cs:19`) handles the one universal concern: excluding the in-memory
`DomainEvents` collection from mapping (`:25-33`). Value objects reach the database through this layer
too: [`EntityTypeBuilderExtensions`](#entitytypebuilderextensions)
(`.../Configuration/EntityTypeBuilderExtensions.cs:12`) flattens a
[`Money`](group-02-domain-building-blocks.md#money) into an amount plus an ISO 4217 code column with a
read-leg fallback to the zero-Money sentinel [`Currency`](group-02-domain-building-blocks.md#currency)
(`:19`, `:24-50`); the four converters in `Persistence/Conversions` map
[`Email`](group-02-domain-building-blocks.md#email) and
[`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) to plain strings in required
([`EmailValueConverter`](#emailvalueconverter) at `.../Conversions/EmailValueConverter.cs:33`,
[`PhoneNumberValueConverter`](#phonenumbervalueconverter) at `.../Conversions/PhoneNumberValueConverter.cs:33`)
and optional ([`NullableEmailValueConverter`](#nullableemailvalueconverter) at `EmailValueConverter.cs:60`,
[`NullablePhoneNumberValueConverter`](#nullablephonenumbervalueconverter) at
`PhoneNumberValueConverter.cs:61`) flavors; and
[`EnumerationValueConverter<TEnumeration>`](#enumerationvalueconvertertenumeration)
(`.../Conversions/EnumerationValueConverter.cs:33`) plus its nullable sibling
[`NullableEnumerationValueConverter<TEnumeration>`](#nullableenumerationvalueconvertertenumeration) (`:62`)
store a smart enumeration as its plain `int` value, so replacing a CLR enum property with an enumeration
is not a schema change (`:6-11`).

Discovery runs through [`ModelBuilderExtensions`](#modelbuilderextensions)`.ApplyAllConfigurations`
(`.../DbContexts/ModelBuilderExtensions.cs:10`, an `extension(ModelBuilder)` block at `:12`), which the
base calls with an entity filter so each database's model receives only its own entities
(`ApplicationDbContext.cs:610-637`, filter application at `ModelBuilderExtensions.cs:57-60`), over the
assemblies supplied by [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) and
its [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider)
implementation, which scans loaded `*.Infrastructure` assemblies, excludes `Common.Infrastructure` itself,
and appends whatever a host registered through
[`EntityConfigurationOptions`](#entityconfigurationoptions) (`DefaultEntityConfigurationAssemblyProvider.cs:16-21`).
Two configurations ship inside the framework itself,
[`PushNotificationConfiguration`](#pushnotificationconfiguration) and
[`UserNotificationConfiguration`](#usernotificationconfiguration)
(`.../Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:16`,
`.../UserNotificationConfiguration.cs:15`), both tagged `[UseDatabase("Notification")]` and re-declaring
the `Notification` schema because namespace derivation would otherwise resolve them to `Common`
(`PushNotificationConfiguration.cs:8-15`, `:25`). This engine-portability design is
[ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) (polyglot persistence); note
the current-reality caveat: the SQLite and Cosmos plumbing is shipped and tested, but SQL Server is the
only engine backing production entities today.

## Encryption, seeding, design time, and the shared helpers

A handful of supporting pieces round out the EF side. [`EncryptedStringConverter`](#encryptedstringconverter)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:42`)
is a value converter that transparently encrypts a string column with authenticated AES-256-GCM (a random
12-byte nonce, a 16-byte tag, stored Base64 as nonce plus ciphertext plus tag), rejecting any key that is
not exactly 32 bytes (`:44-48`, `:59-65`). Its own doc comment states the constraint that governs where it
may be used: the ciphertext is non-deterministic, so the column cannot back equality predicates, unique
indexes, or server-side sorting (`:18-31`). It is the [Rubric §11, Security] control that
[`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) points at for fields that must remain
retrievable after erasure. Its current reality matches
[ADR-037](https://ivanball.github.io/docs/adr/037-field-level-encryption-at-rest.html): it is shipped and
unit-tested but **unadopted**, no entity configuration wires it (the only non-test references are its own
file and the `IAnonymizable` doc comment). On the read side, [`IQueryableExecutor`](#iqueryableexecutor)
and its implementation [`EFQueryableExecutor`](#efqueryableexecutor) (`.../Persistence/EFQueryableExecutor.cs:11`)
abstract async query materialization so higher layers can execute an `IQueryable` without referencing EF,
detecting a real EF query by its `IAsyncEnumerable<T>` implementation and degrading to LINQ-to-Objects
otherwise (`EFQueryableExecutor.cs:43`). That is what makes the specification evaluation in
[Group 03](group-03-querying-specifications.md) unit-testable without a database, a small but real
[Rubric §14, Testability] win. [`ProfilingHelper`](#profilinghelper) (`.../Persistence/ProfilingHelper.cs:9`)
is the MiniProfiler step wrapper the repository decorators share (`:11-30`), and
[`PeriodicBackgroundService`](#periodicbackgroundservice) (`.../Services/PeriodicBackgroundService.cs:20`)
is the group's shared base for fixed-interval sweeps (an enablement gate at `:38`, a 15-second startup
delay at `:31`, a cycle whose failure is logged and never kills the loop at `:73-76`, all waits on an
injected `TimeProvider` so tests drive it with a fake clock, `:55`, `:80`). Its doc comment says plainly
that the outbox processor deliberately does not use it, because a signal-driven smart wait does not fit a
fixed interval (`:12-16`); the one production subclass in the workspace today is Store's
`PaymentReconciliationService`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Services/PaymentReconciliationService.cs:39`),
and [ADR-052](https://ivanball.github.io/docs/adr/052-background-job-execution.html) covers in-process
background work generally.

Seeding and design time close the loop. [`IDbSeeder`](#idbseeder) and the [`DbSeeder`](#dbseeder) base
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:7`) give
module seeders a `GetId<TIdentifier>` helper that maps integer seed ids to either `int` or a deterministic
`Guid` so seed data reproduces across key strategies (`:20-39`), and
[`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser)
(`.../Seeding/IdentityModuleDbSeederBase.cs:38`) hoists the five-times-repeated account-seeding idiom out
of the two app identity modules, leaving only two app-specific hooks and a `ShouldSeed` opt-in gate that
defaults to true (`:50`, `:57`, `:60-71`), each account described by a [`SeedAccount`](#seedaccount) record
(`.../Seeding/SeedAccount.cs:17`). For migrations, [`DesignTimeDbContextHelper`](#designtimedbcontexthelper)
(`.../DbContexts/Design/DesignTimeDbContextHelper.cs:36`) builds a
[`SQLServerDbContext`](#sqlserverdbcontext) for `dotnet ef` without the app's DI container: a downstream
migrations project writes a few-line `IDesignTimeDbContextFactory` (`:18-35`), and
`dotnet ef migrations add X -- --datasource Conference` selects which physical source to build against
(`:106-124`), so each database gets its own migrations project. It composes minimal stand-ins
([`ExplicitAssemblyProvider`](#explicitassemblyprovider) at `:126`,
[`NullDomainEventDispatcher`](#nulldomaineventdispatcher) at `:131`) and a
[`DesignTimeDbContextOptions`](#designtimedbcontextoptions) carrying the connection settings, then wires
the same [`DataSourceResolver`](#datasourceresolver) and
[`EntityDataSourceRegistry`](#entitydatasourceregistry) the runtime uses so the design-time model matches
the runtime one (`:57-101`). It registers the tenant interceptor, the scheduler options and the audit-trail
options unconditionally, defaulted to disabled, precisely so `dotnet ef` scaffolds the same migration for
consumers with and without those features (`:72-89`).

## Blobs, images, and native push

The group also carries the storage-adjacent infrastructure services that are not EF at all, each behind an
Application-layer interface with a null default so a host that has not configured the backend still starts
and degrades cleanly. [`IFileStorageService`](#ifilestorageservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11`)
stores and deletes blobs behind a [`Result`](group-01-result-error-handling.md#result)-returning API and
exposes an `IsConfigured` flag handlers can gate features on (`:14`);
[`AzureBlobFileStorageService`](#azureblobfilestorageservice) (`.../Services/AzureBlobFileStorageService.cs:15`)
is the Azure implementation over a single pre-provisioned container, and
[`NullFileStorageService`](#nullfilestorageservice) (`.../Services/NullFileStorageService.cs:11`) fails
uploads with a named error while letting deletes succeed (`:17-25`). [`IImageProcessor`](#iimageprocessor)
and [`ImageSharpImageProcessor`](#imagesharpimageprocessor) (`.../Services/ImageSharpImageProcessor.cs:14`)
normalize untrusted uploads by decoding, baking in the EXIF orientation, center-cropping to a square,
stripping the EXIF, XMP, and IPTC profiles, and re-encoding as JPEG at quality 85, so only pixels survive
(`:21-42`); the dependency-free [`ImageContentSniffer`](#imagecontentsniffer)
(`.../Interfaces/Infrastructure/ImageContentSniffer.cs:10`) is its upload-side companion, deciding the
accepted formats (JPEG, PNG, WebP) from magic bytes rather than the client-declared content type (`:15-36`).
Both are [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), and both
are squarely [Rubric §11, Security] (EXIF GPS is PII, and a full re-encode is the defense against polyglot
payloads). On the push side, [`INativePushSender`](#inativepushsender) and
[`IPushDeviceRegistrar`](#ipushdeviceregistrar) describe OS-level delivery and the device-installation
registry that backs it ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)),
implemented by [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender)
(`.../Services/AzureNotificationHubNativePushSender.cs:14`) and
[`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar)
(`.../Services/AzureNotificationHubDeviceRegistrar.cs:15`) over Azure Notification Hubs, with
[`NullNativePushSender`](#nullnativepushsender) and [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar)
as the unconfigured defaults. [`NativePushPayloads`](#nativepushpayloads)
(`.../Services/NativePushPayloads.cs:10`) is the pure helper that builds the FCM v1 and APNs payload shapes
(`:16-53`, including the guard that stops a metadata key from clobbering the reserved APNs `aps` block at
`:44-49`) and chunks user tags at the hub's 20-tag expression cap (`:13`, `:59-63`), which is what makes
those rules unit-testable without a hub. This channel sits beside the persisted notification record and the
SignalR path in [Group 10](group-10-notifications.md).

## Where this group sits

Persistence is the concrete floor the abstract domain stands on. The entity bases and audit contracts from
[Group 02](group-02-domain-building-blocks.md) are what the interceptors stamp and the query filters hide;
the domain events aggregates raise are what
[`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) drains into the outbox that
[Group 04](group-04-events-outbox.md) delivers; the transactional decorator in
[Group 05](group-05-cqrs-pipeline.md) is what opens the transaction whose commit releases the deferred
dispatch; the specifications and query service in [Group 03](group-03-querying-specifications.md) run
through this group's repositories and `IQueryable` surfaces; the navigation populators in
[Group 11](group-11-navigation-populators.md) fill the cross-source gaps the degrade convention opens; the
scheduler and settings types this group's gated tables answer to live in
[Group 14](group-14-module-system-composition.md); and the entity-source registry answers the `.Include()`
questions the populators ask. The design axes here are now three orthogonal ones collapsed behind a single
[`DataSourceKey`](#datasourcekey) plus a scoped tenant:
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)'s `Name` axis (which database),
[ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)'s `Engine` axis (which storage
technology), and [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)'s tenant axis
(whose rows, and optionally whose database), so application code never has to know which it is running on.
Read this group as the answer to one question the rest of the guide keeps asking: how does a framework that
describes persistence in pure domain terms actually put a row in a database, and do it in a way that
survives a module being pulled out into its own service.

### DataSource

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:6` · Level 0 · enum

- **What it is**: a three-value enum (`CosmosDB`, `Sqlite`, `SQLServer`) naming which database *engine* persists a given entity type. It shares a file with [`IDataSourceService`](#idatasourceservice): the enum at `IDataSourceService.cs:6`, the interface at `IDataSourceService.cs:24`.
- **Depends on**: nothing first-party. The file has no `using` directives at all (`IDataSourceService.cs:1` is the namespace declaration), which is the point: this is the Application layer's vocabulary for a persistence decision, with no persistence library behind it.
- **Concept introduced, database-per-service routing at the entity level.** `[Rubric §8, Data Architecture]` assesses whether storage is deliberately partitioned, whether the routing strategy is explicit, and whether cross-database JOINs happen by accident; this enum is where that decision becomes a first-class value the query pipeline can branch on. `[Rubric §7, Microservices Readiness]` assesses whether a module could be lifted out without a rewrite; because each module owns its own store ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), the engine is a per-entity fact rather than a global one. The values encode a *capability*, not just a name: the `CosmosDB` doc comment says "document store, no cross-container JOINs" (`IDataSourceService.cs:8`), while `Sqlite` supports "JOINs within a single database file" (`IDataSourceService.cs:11`) and `SQLServer` has "full relational JOIN support" (`IDataSourceService.cs:14`). That distinction is what lets the framework decide whether a navigation can be an EF `.Include()` or must become a manual batch load.
- **Walkthrough**: three members, each documented with its JOIN capability. `CosmosDB` (`IDataSourceService.cs:9`), `Sqlite` (`IDataSourceService.cs:12`), `SQLServer` (`IDataSourceService.cs:15`). There is no `None`/`Unknown` member and no explicit numeric assignment, so `CosmosDB` is the default `0` value.
- **Why it's built this way**: encoding the JOIN-capability difference in the enum lets [`IDataSourceService.HaveIncludeSupport`](#idatasourceservice) (`IDataSourceService.cs:54`) answer the include-versus-batch-load question from a value comparison rather than a scattered chain of provider checks, and it keeps that decision in the framework-pure Application layer with no EF Core reference.
- **Where it's used**: paired with a database name in [`DataSourceKey`](#datasourcekey) (`DataSourceKey.cs:15`); resolved and compared by [`IDataSourceService`](#idatasourceservice); mapped per entity by [`EntityDataSourceRegistry`](#entitydatasourceregistry); consumed by [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) to classify each navigation as an EF include or a manual populate.

### IEntityConfigurationAssemblyProvider

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IEntityConfigurationAssemblyProvider.cs:10` · Level 0 · interface

- **What it is**: a single-method contract returning the assemblies that hold EF Core entity type configurations, so a DbContext can discover and apply them without hardcoding module assembly-name patterns.
- **Depends on**: `System.Reflection` (BCL) only (`IEntityConfigurationAssemblyProvider.cs:1`).
- **Concept introduced, a module-agnostic model surface that keeps EF out of Application.** `[Rubric §3, Clean Architecture]` assesses whether the inner layers declare intent while the outer layers own the technology; here Application declares *which assemblies carry configurations* and Infrastructure performs the EF scan. `[Rubric §7, Microservices Readiness]` assesses extraction cost: each module ships its own `IEntityTypeConfiguration<T>` classes in its own Infrastructure assembly, so removing a module from the returned list removes it from the model, no context rewrite required. The doc comment states exactly this framing (`IEntityConfigurationAssemblyProvider.cs:5-9`).
- **Walkthrough**: one method, `IReadOnlyList<Assembly> GetConfigurationAssemblies()` (`IEntityConfigurationAssemblyProvider.cs:15`). It takes no arguments and no cancellation token: the assembly set is a composition-time fact, resolved once, not a per-request query.
- **Why it's built this way**: routing configuration discovery through an injected provider means the active module set determines the model without any context knowing a module by name, which is the extraction invariant behind [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) and [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html).
- **Where it's used**: injected into [`ApplicationDbContext`](#applicationdbcontext) (`ApplicationDbContext.cs:42`) and each engine subclass ([`SQLServerDbContext`](#sqlserverdbcontext) at `SQLServerDbContext.cs:19`, [`CosmosDbContext`](#cosmosdbcontext) at `CosmosDbContext.cs:17`, [`SqliteDbContext`](#sqlitedbcontext) at `SqliteDbContext.cs:15`); consumed by [`EntityDataSourceRegistry`](#entitydatasourceregistry) to build the entity-to-source map (`EntityDataSourceRegistry.cs:22`) and by [`PhysicalDbContextFactory`](#physicaldbcontextfactory) (`PhysicalDbContextFactory.cs:19`). The default implementation [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider) is registered with `TryAddSingleton` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:52`), and [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) substitutes its own `ExplicitAssemblyProvider` for `dotnet ef` runs (`DesignTimeDbContextHelper.cs:90` and `:126`).

### ImageContentSniffer

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ImageContentSniffer.cs:10` · Level 0 · class (public static)

- **What it is**: a dependency-free static helper that decides whether uploaded bytes *are* a JPEG, PNG, or WebP image by inspecting the leading magic bytes, never the client-declared content type or file extension.
- **Depends on**: nothing first-party (BCL `ReadOnlySpan<byte>`; the file has no `using` directives). It is the upload-side companion to [`IImageProcessor`](#iimageprocessor).
- **Concept introduced, magic-byte content sniffing as an upload trust boundary.** `[Rubric §11, Security]` assesses whether untrusted input is validated by its actual content rather than by a spoofable client-supplied MIME type or file extension; this type is the framework's answer for binary uploads. `[Rubric §26, Front-End Security]` also applies at the origin of an avatar upload, because the browser-supplied `Content-Type` is exactly what this code refuses to trust. The doc comment (`ImageContentSniffer.cs:3-9`) frames the division of labor under [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html): the sniffer narrows accepted inputs to jpeg/png/webp, then the caller hands content to the processor whose re-encoding keeps only pixels, while app-specific size limits and error codes stay in the calling handler.
- **Walkthrough**: four span-based predicates, all expression-bodied and all `public`.
  - `IsAllowedImage(ReadOnlySpan<byte> content)` (`ImageContentSniffer.cs:15-16`): the entry point, a short-circuiting `IsJpeg || IsPng || IsWebP`.
  - `IsJpeg` (`ImageContentSniffer.cs:21-22`): length at least 3 and the SOI prefix `FF D8 FF` checked byte by byte.
  - `IsPng` (`ImageContentSniffer.cs:27-28`): length at least 8 and a `SequenceEqual` against the exact 8-byte PNG signature `89 50 4E 47 0D 0A 1A 0A`.
  - `IsWebP` (`ImageContentSniffer.cs:33-36`): length at least 12, a `RIFF` container (bytes 0-3 against the UTF-8 literal `"RIFF"u8`) declaring the `WEBP` form type (bytes 8-11 against `"WEBP"u8`). Bytes 4-7 are the RIFF chunk size and are deliberately not inspected.
- **Why it's built this way**: `ReadOnlySpan<byte>` plus UTF-8 literals mean the checks allocate nothing and run directly on the payload prefix, and being a pure static class it is callable from any layer without DI or mocking. Checking bytes rather than the declared type is the security point: a client can rename `evil.exe` to `avatar.png`, but it cannot forge a valid leading signature and still survive the re-encode that follows.
- **Where it's used**: called by [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) as the first gate on an upload (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:32`) before the bytes reach [`IImageProcessor`](#iimageprocessor) (`SetUserAvatarHandler.cs:52`) and then [`IFileStorageService`](#ifilestorageservice) (`SetUserAvatarHandler.cs:66`). It has its own dedicated unit-test class (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ImageContentSnifferTests.cs`).
- **Caveats / not-in-source**: sniffing establishes only that the *prefix* matches a known signature. It is not a decode, so a truncated or malformed body still passes here and is rejected later by [`IImageProcessor`](#iimageprocessor).

### INativePushSender

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/INativePushSender.cs:10` · Level 0 · interface

- **What it is**: the contract for sending OS-level push notifications to registered device installations, the delivery channel that reaches a phone when the app is backgrounded or killed.
- **Depends on**: the `UserIdentifierType` global alias (`INativePushSender.cs:19`, see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)); BCL otherwise. Its registry counterpart is [`IPushDeviceRegistrar`](#ipushdeviceregistrar).
- **Concept introduced, native push as the third delivery channel.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether a delivery mechanism is a swappable abstraction declared in Application and implemented at the edge rather than a hardcoded SDK call inside a handler. The doc comment (`INativePushSender.cs:3-9`) places this beside the two other channels under [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html): the persisted inbox record and the SignalR real-time push handled by [`IPushNotificationSender`](group-10-notifications.md#ipushnotificationsender). Where SignalR reaches a *connected* browser, native push reaches a device that is not running the app. Infrastructure targets Azure Notification Hubs (FCM v1 plus APNs), and the default registration is a no-op, so a host that never configures a hub degrades cleanly instead of failing.
- **Walkthrough**: two methods, both returning a plain `Task` rather than a [`Result`](group-01-result-error-handling.md#result), because a push is fire-and-forget from the caller's point of view.
  - `SendToUsersAsync(IEnumerable<UserIdentifierType> userIds, string title, string body, Dictionary<string, string>? metadata = null, CancellationToken cancellationToken = default)` (`INativePushSender.cs:19`): targets specific users, resolved to installations via user tags (`INativePushSender.cs:13`); `metadata` carries optional key-value data such as a deep-link route in the platform payload (`INativePushSender.cs:16`).
  - `BroadcastAsync(string title, string body, Dictionary<string, string>? metadata = null, CancellationToken cancellationToken = default)` (`INativePushSender.cs:27`): sends to every registered installation.
- **Why it's built this way**: targeting *users* rather than raw device tokens keeps the caller out of the tag and token bookkeeping, which [`IPushDeviceRegistrar`](#ipushdeviceregistrar) owns; the no-op default makes native push an opt-in capability rather than a hard dependency of every host.
- **Where it's used**: injected into [`SendPushNotificationHandler`](group-10-notifications.md#sendpushnotificationhandler) (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:21`) alongside the SignalR sender. [`NullNativePushSender`](#nullnativepushsender) is registered by default with `TryAddTransient` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:478`) and [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) replaces it when a hub is configured (`DependencyInjection.cs:579`).

### IQueryableExecutor

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IQueryableExecutor.cs:7` · Level 0 · interface

- **What it is**: an abstraction over the EF Core `IQueryable` operations the Application layer needs (`Include`, `AsSplitQuery`, `ToListAsync`, `CountAsync`) that would otherwise require a direct `Microsoft.EntityFrameworkCore` reference there.
- **Depends on**: `System.Linq` (BCL) only; the file declares no `using` directives.
- **Concept introduced, inverting EF's terminal operators out of Application.** `[Rubric §3, Clean Architecture]` assesses whether the inner layers stay free of framework dependencies; EF's async materializers (`ToListAsync`, `CountAsync`) and `Include` are extension methods living in the EF assembly, so calling them directly would drag EF into Application. This interface inverts that: Infrastructure implements each by calling EF, and Application receives the interface by DI. The doc comment (`IQueryableExecutor.cs:3-6`) states exactly that intent.
- **Walkthrough**: four methods; the two queryable transforms are constrained `where T : class` (`IQueryableExecutor.cs:15` and `:27`) because EF requires a reference type there, while the two materializers accept any `T` so a projection to a scalar or DTO still works.
  - `Include<T>(IQueryable<T> query, string navigationPropertyPath)` (`IQueryableExecutor.cs:14`): a **string-based** include path, for example `"Category"` or `"Order.OrderLines"` (`IQueryableExecutor.cs:12`), deliberately not a lambda, because the generic query pipeline builds include paths at runtime from navigation-property name strings.
  - `AsSplitQuery<T>(IQueryable<T> query)` (`IQueryableExecutor.cs:26`): switches EF to split-query mode. The doc comment (`IQueryableExecutor.cs:17-22`) explains why it matters: paginating (Skip/Take) a query that has collection includes in single-query mode truncates or mis-correlates child rows, so list reads come back with empty collections. It is documented as a no-op for non-EF (in-memory) queryables.
  - `ToListAsync<T>(IQueryable<T> query, CancellationToken cancellationToken = default)` (`IQueryableExecutor.cs:34`) and `CountAsync<T>(IQueryable<T> query, CancellationToken cancellationToken = default)` (`IQueryableExecutor.cs:41`): the async materializers.
- **Why it's built this way**: the string include path (rather than `Expression<Func<T, TProperty>>`) is required because the query pipeline composes includes from runtime navigation metadata, not compile-time lambdas; and naming `AsSplitQuery` as an explicit operation keeps a well-known EF pagination defect from silently reaching list endpoints.
- **Where it's used**: implemented by [`EFQueryableExecutor`](#efqueryableexecutor) (`EFQueryableExecutor.cs:11`), registered with `TryAddSingleton` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:105`). Injected into [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline) (`EntityQueryPipeline.cs:13`) and into the framework's own notification handlers, for example [`GetMyNotificationsHandler`](group-10-notifications.md#getmynotificationshandler) (`GetMyNotificationsHandler.cs:18`).

### IUpdatePropertySetter<TEntity>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IUpdatePropertySetter.cs:13` · Level 0 · interface

- **What it is**: a persistence-agnostic builder for the SET clause of a bulk update. A handler describes *which* properties change and *to what*, and Infrastructure translates the description into the provider's set-based `UPDATE`.
- **Depends on**: `System.Linq.Expressions` (BCL, `IUpdatePropertySetter.cs:1`) only. It is the parameter type of [`IWriteRepository.ExecuteUpdateAsync`](#iwriterepositorytentity-tidentifiertype) (`IRepository.cs:244`), which the doc comment cross-references (`IUpdatePropertySetter.cs:7`).
- **Concept introduced, describing a SET clause without leaking EF Core.** `[Rubric §3, Clean Architecture]` assesses whether the technology choice stays outside the inner layers; `[Rubric §12, Performance & Scalability]` assesses whether hot write paths avoid needless round trips, and a single set-based statement replaces the load, mutate, save cycle. The doc comment (`IUpdatePropertySetter.cs:5-11`) is explicit that the shape *mirrors* EF Core's `SetPropertyCalls` without referencing it, which is what keeps `MMCA.Common.Application` EF-free while still offering EF's most useful bulk primitive.
- **Walkthrough**: two `Set` overloads, both generic in `TProperty` and both returning `IUpdatePropertySetter<TEntity>` so calls chain.
  - `Set<TProperty>(Expression<Func<TEntity, TProperty>> property, TProperty value)` (`IUpdatePropertySetter.cs:20-22`): assigns a fixed value, for example a status or a timestamp.
  - `Set<TProperty>(Expression<Func<TEntity, TProperty>> property, Expression<Func<TEntity, TProperty>> valueFactory)` (`IUpdatePropertySetter.cs:33-35`): assigns from an expression over the **current database row**. The doc comment (`IUpdatePropertySetter.cs:24-28`) gives the motivating case, `quantity => quantity.Amount - 5`, which becomes an atomic read-modify-write that the database itself arbitrates, so two racing callers cannot both win and no rowversion retry loop is needed.
- **Why it's built this way**: passing an `Action<IUpdatePropertySetter<TEntity>>` (rather than a dictionary of property names or a prebuilt EF expression) keeps the call site strongly typed and refactor-safe while the concrete translation stays swappable per provider.
- **Where it's used**: implemented by [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity) (`UpdatePropertySetterBuilder.cs:14`), which collects each assignment as a delegate (`UpdatePropertySetterBuilder.cs:16` and `:26`) and replays them onto EF Core 10's `UpdateSettersBuilder<TSource>` (`UpdatePropertySetterBuilder.cs:52-58`). It also records assigned property names (`UpdatePropertySetterBuilder.cs:17` and `:60-66`) and exposes `SetsProperty` (`UpdatePropertySetterBuilder.cs:49`) so [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) can stamp `LastModifiedOn` and `LastModifiedBy` only when the caller did not (`EFRepository.cs:121-132`), keeping audit fields correct on a path that bypasses the save pipeline.

### DataSourceKey

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/DataSourceKey.cs:15` · Level 1 · record struct (readonly)

- **What it is**: the identity of a *physical* data source, a `([DataSource](#datasource) Engine, string Name)` pair, where `Name` distinguishes multiple databases on the same engine ("database per microservice").
- **Depends on**: [`DataSource`](#datasource) (Level 0, same namespace). No `using` directives at all.
- **Concept, physical-key comparison as the include-support test.** `[Rubric §8, Data Architecture]` assesses explicit storage partitioning and routing. A `readonly record struct` gives correct structural equality with zero boilerplate, which is the whole point: Application code that needs to know whether two entities can be joined compares their `DataSourceKey` values. The doc comment (`DataSourceKey.cs:6-11`) stresses that `Name` is the *physical* source name produced by the Infrastructure resolver **after collapsing** logical names that share a connection string, so two logical names pointing at the same connection string end up with the same physical key (and are joinable), while genuinely distinct databases do not.
- **Walkthrough**
  - The positional record `DataSourceKey(DataSource Engine, string Name)` (`DataSourceKey.cs:15`), parameters documented at `DataSourceKey.cs:13-14`.
  - `DefaultName` (`DataSourceKey.cs:18`): the `const string` `"Default"` reserved for the top-level `ConnectionStrings` section.
  - `Default(DataSource engine)` (`DataSourceKey.cs:23`): a static factory building the default key for an engine.
  - `ToString()` (`DataSourceKey.cs:26`): an override rendering `"{Engine}/{Name}"` for diagnostics.
- **Why it's built this way**: making the key a value type with structural equality reduces the routing decision (same physical database, relational engine) to an equality comparison, and a host with no `DataSources` configuration collapses everything onto `Default` and behaves like a single-database monolith ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: [`EntityDataSourceRegistry`](#entitydatasourceregistry) maps each entity type to a key and [`DataSourceResolver`](#datasourceresolver) performs the logical-to-physical collapse; [`IDataSourceService`](#idatasourceservice) resolves and compares them; [`DbContextFactory`](#dbcontextfactory) caches one context instance per key.

### IDataSourceService

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:24` · Level 2 · interface

- **What it is**: resolves which physical data source ([`DataSourceKey`](#datasourcekey): engine plus database) backs a given entity type, and determines whether two entity types support EF Core `.Include()` between them, all without the Application layer touching EF or Infrastructure.
- **Depends on**: [`DataSource`](#datasource) (Level 0) and [`DataSourceKey`](#datasourcekey) (Level 1), both in the same namespace.
- **Concept introduced, multi-database routing exposed to the Application layer.** `[Rubric §8, Data Architecture]` assesses deliberate database-per-service design, explicit routing, and the absence of accidental cross-database JOINs. The layer must decide whether a navigation between two entities can use an EF `.Include()`, which is valid only when both entities live in the same physical database *and* that engine is relational. This interface answers that question without an EF reference, keeping Application pure ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The doc comment names the consumer directly (`IDataSourceService.cs:18-23`): [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) uses it to classify navigation properties as supported or unsupported includes.
- **Walkthrough**: six members across three concerns, every one of them synchronous, because the resolution is a lookup against an eagerly built registry, not I/O.
  - `GetDataSourceKey(Type entityType)` (`IDataSourceService.cs:29`) and `GetDataSourceKey(string entityFullName)` (`IDataSourceService.cs:34`): resolve the physical key by CLR type or by full type name (the name overload exists because navigation metadata carries names, not resolved types).
  - `GetDataSource(string entityFullName)` (`IDataSourceService.cs:39`) and `GetDataSource(Type entityType)` (`IDataSourceService.cs:44`): resolve just the engine.
  - `HaveIncludeSupport(DataSourceKey first, DataSourceKey second)` (`IDataSourceService.cs:54`): the crux. The contract documented at `IDataSourceService.cs:46-53` is that it returns `true` only when both keys identify the same physical database and the engine is relational, since Cosmos DB has no cross-document JOINs.
  - `HaveIncludeSupport(string firstEntityFullName, string secondEntityFullName)` (`IDataSourceService.cs:63`): the same test by entity name, resolving each side's key first.
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) replaces cross-service foreign keys with scalar columns and routes consistency through the outbox, so to build a query the Application layer must know the routing topology well enough to classify each navigation as include-able or manual-load-required. Exposing that as a narrow query interface (rather than handing Application the registry) keeps the collapse rules on the Infrastructure side.
- **Where it's used**: consumed by [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) to drive the supported/unsupported include split, and indirectly by the query pipeline's eager-loading decisions. The Infrastructure implementation is a facade over [`EntityDataSourceRegistry`](#entitydatasourceregistry).

### IFileStorageService

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11` · Level 3 · interface

- **What it is**: the contract for storing and deleting binary blobs, for example user avatar images. Implementations own the container or bucket; callers pass only a blob name scoped within it.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form (via `MMCA.Common.Shared.Abstractions`, `IFileStorageService.cs:1`); BCL `Stream` and `Uri`.
- **Concept introduced, the managed blob-storage boundary.** `[Rubric §8, Data Architecture]` assesses whether data lands in the right store, and binary content belongs in object storage rather than in a relational row. `[Rubric §10, Cross-Cutting Concerns]` assesses whether a transport like this is swappable behind an abstraction. Per the doc comment (`IFileStorageService.cs:5-10`, [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)) the default implementation is unconfigured (uploads fail with a clear error) until a host calls `AddAzureBlobFileStorage(configuration)` with a complete `FileStorage` section. Returning [`Result`](group-01-result-error-handling.md#result) rather than throwing keeps a failed upload on the same error-flow rails as the rest of the stack (see the [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: one property and two methods.
  - `IsConfigured` (`IFileStorageService.cs:14`): whether a real store is wired, so a handler can gate a feature on it rather than attempt a doomed upload.
  - `UploadAsync(string blobName, Stream content, string contentType, CancellationToken cancellationToken = default)` (`IFileStorageService.cs:22`): uploads or overwrites a blob and returns its public absolute URL as `Result<Uri>`. The blob name is container-scoped, for example `avatars/42-a1b2c3d4.jpg` (`IFileStorageService.cs:17`), and the content is read from the stream's current position (`IFileStorageService.cs:18`).
  - `DeleteAsync(string blobName, CancellationToken cancellationToken = default)` (`IFileStorageService.cs:28`): deletes a blob; unknown names succeed (idempotent, `IFileStorageService.cs:24`), which matches at-least-once cleanup semantics.
- **Why it's built this way**: an unconfigured default plus an `IsConfigured` gate means the framework ships avatar support without forcing every consumer to provision blob storage, and idempotent delete makes cleanup safe to retry after a partial failure.
- **Where it's used**: [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) uploads the normalized JPEG (`SetUserAvatarHandler.cs:66`), with [`RemoveUserAvatarHandler`](group-24-identity-module.md#removeuseravatarhandler) and [`DeleteUserHandler`](group-24-identity-module.md#deleteuserhandler) on the cleanup side. [`NullFileStorageService`](#nullfilestorageservice) is the default registration (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:483`); [`AzureBlobFileStorageService`](#azureblobfilestorageservice) replaces it when configured (`DependencyInjection.cs:620`).

### IImageProcessor

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IImageProcessor.cs:11` · Level 3 · interface

- **What it is**: the contract for normalizing an untrusted uploaded image: decode it (rejecting non-images), correct EXIF orientation, center-crop to a square, strip *all* metadata, and re-encode as JPEG.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via `MMCA.Common.Shared.Abstractions`, `IImageProcessor.cs:1`); BCL `Stream`.
- **Concept introduced, re-encoding as an image trust boundary.** `[Rubric §11, Security]` assesses whether untrusted binary input is neutralized rather than merely inspected; `[Rubric §30, Compliance, Privacy & Data Governance]` assesses PII handling, and EXIF GPS coordinates are PII that a naive avatar pipeline would happily publish to a public blob URL. The doc comment (`IImageProcessor.cs:5-10`, [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)) makes both points: metadata removal deletes location data, and re-encoding is the defense against polyglot or malformed payloads because only pixels survive the decode and re-encode round trip. This is the processor half of the pair that [`ImageContentSniffer`](#imagecontentsniffer) opens.
- **Walkthrough**: one method, `NormalizeToSquareJpegAsync(Stream content, int size, CancellationToken cancellationToken = default)` (`IImageProcessor.cs:18`), returning `Result<byte[]>` of the normalized JPEG or a validation failure for undecodable content (`IImageProcessor.cs:17`). `size` is the output square edge length in pixels (`IImageProcessor.cs:15`), so the caller (not the framework) owns the avatar dimension.
- **Why it's built this way**: returning bytes rather than writing straight to storage keeps the processor a pure transform, so a handler can sniff, then normalize, then hand the result to [`IFileStorageService`](#ifilestorageservice); and a `Result` failure on undecodable input stops a bad upload before it ever reaches storage.
- **Where it's used**: called by [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) between the sniffer and the upload (`SetUserAvatarHandler.cs:52`). Implemented by [`ImageSharpImageProcessor`](#imagesharpimageprocessor), registered with `TryAddSingleton` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:484`); note this is the one member of the avatar trio with a real default implementation rather than a null object.

### IPushDeviceRegistrar

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPushDeviceRegistrar.cs:11` · Level 3 · interface

- **What it is**: maintains the device-installation registry behind [`INativePushSender`](#inativepushsender), tagging each installation with its owning user so sends can target users rather than raw device tokens.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via `MMCA.Common.Shared.Abstractions`, `IPushDeviceRegistrar.cs:1`), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest) (from `MMCA.Common.Shared.Notifications.PushNotifications`, `IPushDeviceRegistrar.cs:2`), and the `UserIdentifierType` alias (`IPushDeviceRegistrar.cs:18`).
- **Concept introduced, ownership scoping on a client-supplied identifier, and the existence-oracle problem.** `[Rubric §11, Security]` assesses whether a resource identifier supplied by a caller is authorized against that caller before it is acted on, and whether error responses leak the existence of other users' resources. Installation ids are client-generated, so nothing stops a caller from sending someone else's; the ownership-scoped delete verifies the `user:{id}` tag stamped by `UpsertAsync` before deleting, and reports a mismatch as **success rather than not-found**, because answering differently for "no such installation" and "not yours" would turn the endpoint into an existence oracle for other users' installation ids (`IPushDeviceRegistrar.cs:40-48`). `[Rubric §10, Cross-Cutting Concerns]` also applies: the doc comment (`IPushDeviceRegistrar.cs:6-10`, [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) explains the split, where this type owns the installation registry, tagged by user, so [`INativePushSender`](#inativepushsender) can send to users, and the default implementation is a no-op until a notification hub is configured.
- **Walkthrough**: three methods, all returning [`Result`](group-01-result-error-handling.md#result).
  - `UpsertAsync(UserIdentifierType userId, DeviceInstallationRequest request, CancellationToken cancellationToken = default)` (`IPushDeviceRegistrar.cs:18`): creates or refreshes an installation, tagging it with the authenticated owner (`IPushDeviceRegistrar.cs:13-14`).
  - `DeleteAsync(string installationId, CancellationToken cancellationToken = default)` (`IPushDeviceRegistrar.cs:30`): the unscoped delete. Its remarks are a warning, not a description (`IPushDeviceRegistrar.cs:24-29`): it performs **no ownership check**, so it must not be reached from a caller-supplied installation id, and it stays only for server-initiated cleanup where the owner is already established.
  - `DeleteAsync(UserIdentifierType userId, string installationId, CancellationToken cancellationToken = default)` (`IPushDeviceRegistrar.cs:54-55`): the ownership-scoped delete, and the one any authenticated boundary must call. It is a **default interface method** whose body delegates to the unscoped overload, so implementations outside this framework keep compiling; implementations that can verify ownership override it (`IPushDeviceRegistrar.cs:49-52`). Unknown ids and installations owned by another user both succeed without deleting anything (`IPushDeviceRegistrar.cs:32-35`).
- **Why it's built this way**: separating the *registry* (this type) from the *send* ([`INativePushSender`](#inativepushsender)) means the send API can target users while token bookkeeping stays in one place. Shipping the scoped delete as a default interface method rather than a breaking new member is the compatibility trade-off: existing implementations still compile, at the cost that an implementation which forgets to override it silently falls back to the unscoped path.
- **Where it's used**: [`DevicesController`](group-10-notifications.md#devicescontroller) injects it (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:26`) and calls the **user-scoped** overload on delete (`DevicesController.cs:67`) and `UpsertAsync` with the authenticated user id (`DevicesController.cs:43`). [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar) is the default registration (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:479`); [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) replaces it when a hub is configured (`DependencyInjection.cs:580`).

### IEntityQuerier<TEntity, TIdentifierType>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:78` · Level 4 · interface

- **What it is**: the collection and projection half of the repository split: `GetAllAsync`, `GetProjectedAsync<TResult>`, `GetAllForLookupAsync`, and two `CountAsync` overloads.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (the `TEntity` constraint, `IRepository.cs:79`), [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (the lookup projection, from `MMCA.Common.Shared.DTOs`, `IRepository.cs:3` and `:111`), and `System.Linq.Expressions` (`IRepository.cs:1`).
- **Concept introduced, the ISP-split repository ladder.** `[Rubric §1, SOLID]` assesses whether clients depend only on the members they use. `IRepository.cs` defines a deliberate ladder of ever-wider interfaces so a handler declares exactly the surface it needs: `IEntityQuerier` (collections and projection, this type, `IRepository.cs:78`), [`IEntityReader`](#ientityreadertentity-tidentifiertype) (by-id lookups, `:19`), [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype) (mutations, `:157`), [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) (reader plus querier plus raw `IQueryable`, `:134`), and [`IRepository`](#irepositorytentity-tidentifiertype) (read plus write, `:262`). The doc comment says it outright (`IRepository.cs:66-69`): prefer this over `IReadRepository` when a handler needs `GetAllAsync`, `GetProjectedAsync`, or `CountAsync`. `[Rubric §12, Performance & Scalability]` also applies: `GetProjectedAsync<TResult>` takes an `Expression<Func<TEntity, TResult>>` that is translated to SQL, so a read-heavy handler fetches only the columns it needs.
- **Concept introduced, `ignoreQueryFilters` means soft-deleted rows and nothing else.** `[Rubric §11, Security]` assesses whether a convenience flag can widen a security boundary. An interface-level `<remarks>` block (`IRepository.cs:73-77`) pins the contract: every `ignoreQueryFilters` parameter here drops the named `SoftDelete` filter and **leaves the named `Tenant` filter applied**. That is enforced downstream, where [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) passes a one-element filter-name array to EF 10's named `IgnoreQueryFilters` overload (`EFReadRepository.cs:29`, used at `:221` and `:235`) rather than EF's parameterless form; its own comment (`EFReadRepository.cs:23-28`) spells out that dropping both would let a caller asking to see deleted rows silently read every tenant's data. The two named filters come from [`ApplicationDbContext`](#applicationdbcontext) (`ApplicationDbContext.cs:348` and `:441`, with `TenantFilterName` at `:360`).
- **Walkthrough**
  - `GetAllAsync(IEnumerable<string> includes, where?, orderBy?, select?, asTracking, ignoreQueryFilters, CancellationToken)` (`IRepository.cs:83-90`): the general collection read with optional includes, filter, ordering, and same-type projection. Note `includes` is the one non-optional parameter, so a caller must state its eager-loading intent explicitly (pass `[]` for none).
  - `GetProjectedAsync<TResult>(select, where?, asTracking, ignoreQueryFilters, CancellationToken)` (`IRepository.cs:103-108`): SQL-side projection to an arbitrary result type.
  - `GetAllForLookupAsync(string nameProperty, where?, asTracking, CancellationToken)` (`IRepository.cs:111-115`): returns lightweight [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) id/name pairs for dropdowns without materializing full entities. It has no `ignoreQueryFilters` parameter: a lookup list never offers deleted rows.
  - `CountAsync(CancellationToken)` (`IRepository.cs:118`) and `CountAsync(Expression<Func<TEntity, bool>> where, CancellationToken)` (`IRepository.cs:121-123`): total and predicated counts.
- **Why it's built this way**: splitting reads into a focused querier lets a handler signal its access pattern through its constructor dependency, keeps projection and counting off the by-id interface, and makes the unit-test double for a query handler a two-method mock instead of a fifteen-member one.
- **Where it's used**: query handlers needing collections or counts; folded into [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (`IRepository.cs:135`) and implemented concretely by [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype), with [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) wrapping every call in a MiniProfiler step (`EFReadRepositoryDecorator.cs:32` and `:41`).
- **Caveats / not-in-source**: `GetProjectedAsync` carries `ignoreQueryFilters` **before** the cancellation token (`IRepository.cs:107-108`), so any caller or test double that passes arguments positionally has to account for it; the compiler catches positional callers, but a mock configured with a fixed argument count does not fail until run time.

### IEntityReader<TEntity, TIdentifierType>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:19` · Level 4 · interface

- **What it is**: the by-id half of the repository split: `GetByIdAsync` (two overloads), `GetByIdsAsync`, and `ExistsAsync` (two overloads), for handlers whose data access is a point lookup.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (the `TEntity` constraint, `IRepository.cs:20`) and `System.Linq.Expressions` for the predicate overload (`IRepository.cs:1`).
- **Concept, minimal data access as a declared dependency.** `[Rubric §1, SOLID]` (Interface Segregation, introduced on [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype)) and `[Rubric §8, Data Architecture]` (deliberate, minimal access patterns). The doc comment is explicit (`IRepository.cs:7-11`): prefer this over `IReadRepository<>` when a handler only needs `GetByIdAsync` or `ExistsAsync`, because that signals minimal data access. This interface carries the same `<remarks>` contract as the querier (`IRepository.cs:14-18`): `ignoreQueryFilters` means "include soft-deleted rows" and nothing more, with the `Tenant` filter left in force.
- **Walkthrough**
  - `GetByIdAsync(TIdentifierType id, CancellationToken)` (`IRepository.cs:24-26`): plain fetch, returns `null` when missing.
  - `GetByIdAsync(TIdentifierType id, IEnumerable<string> includes, bool asTracking = false, CancellationToken)` (`IRepository.cs:29-33`): the eager-load overload; include paths are navigation-property names.
  - `GetByIdsAsync(ids, includes?, asTracking, ignoreQueryFilters, CancellationToken)` (`IRepository.cs:46-51`): a single-query bulk fetch that replaces an N+1 loop of point lookups. The doc comment warns it may return **fewer** entities than requested when some ids do not exist (`IRepository.cs:45`), so the caller must reconcile, and the `ignoreQueryFilters` parameter is documented in full (`IRepository.cs:39-43`) rather than by reference.
  - `ExistsAsync(TIdentifierType id, bool ignoreQueryFilters = false, CancellationToken)` (`IRepository.cs:54-57`) and `ExistsAsync(Expression<Func<TEntity, bool>> where, bool ignoreQueryFilters = false, CancellationToken)` (`IRepository.cs:60-63`): existence checks by key or by predicate. The flag is what lets a handler ask whether a *soft-deleted* row exists, for example to detect a conflict when re-creating a record that was deleted earlier.
- **Why it's built this way**: a handler that only needs a point lookup takes the narrowest interface, which reads clearly at the constructor and mocks in two lines in a test.
- **Where it's used**: command handlers that load an aggregate before mutating it; folded into [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (`IRepository.cs:135`). Note that the `GetByIdOrFailAsync` extension on [`ReadRepositoryExtensions`](#readrepositoryextensions), which turns a miss into a [`Result`](group-01-result-error-handling.md#result) failure carrying `Error.NotFound`, hangs off `IReadRepository` rather than this interface and is implemented over `GetAllAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:27` and `:34`), so a handler that wants it must take the wider read interface.

### IWriteRepository<TEntity, TIdentifierType>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:157` · Level 4 · interface

- **What it is**: the write half of the repository abstraction: `AddAsync`, `AddRangeAsync`, `UpdateAsync`, `UpdateRange`, two `SetOriginalRowVersion` overloads, `ExecuteDeleteAsync`, `ExecuteUpdateAsync`, `Save`, and `SaveChangesAsync`.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (the `TEntity` constraint, `IRepository.cs:158`), [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) (the child-concurrency overload, referenced by its fully qualified `Domain.Interfaces.IRowVersioned` name at `IRepository.cs:209`), and [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) (`IRepository.cs:244`).
- **Concept introduced, optimistic-concurrency wiring and change-tracking-bypass writes.** `[Rubric §8, Data Architecture]` assesses whether concurrency control is deliberate rather than accidental last-write-wins. Four members carry the weight:
  - `SetOriginalRowVersion(TEntity entity, byte[]? rowVersion)` (`IRepository.cs:197`): plants the client's last-observed `RowVersion` as the tracked entity's *original* concurrency token, so the next save emits `WHERE RowVersion = @original` and raises `DbUpdateConcurrencyException` (mapped to `409 Conflict`) if the row changed since the client read it. The doc comment (`IRepository.cs:189-196`) notes it is a no-op when `rowVersion` is null or empty, covering legacy clients and first writes.
  - `SetOriginalRowVersion(Domain.Interfaces.IRowVersioned childEntity, byte[]? rowVersion)` (`IRepository.cs:209`): the same protection for a tracked **child** of the aggregate, for example a `ProductVariant` under a `Product`. The doc comment (`IRepository.cs:199-208`) explains why a second overload exists at all: the repository's `TEntity` is the aggregate root, so the typed overload cannot reach children; this one accepts any [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) entity instead ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
  - `ExecuteDeleteAsync(Expression<Func<TEntity, bool>> where, CancellationToken)` (`IRepository.cs:219-221`): a set-based delete run directly in the database. The doc comment warns in capitals that it does **not** trigger domain events, audit stamps, or soft-delete, and is for maintenance scenarios only (`IRepository.cs:211-218`).
  - `ExecuteUpdateAsync(where, Action<IUpdatePropertySetter<TEntity>> setProperties, CancellationToken)` (`IRepository.cs:242-245`): a set-based `UPDATE ... SET ... WHERE ...` as one atomic statement. The long doc comment (`IRepository.cs:223-241`) is the teaching text for contention-proof conditional updates: guard the update in `where` (for example `AvailableQuantity >= @qty`), and zero rows affected means the guard did not hold, so two racing callers can never both win and no rowversion retry loop is needed because the database itself arbitrates. It also draws the exact boundaries: domain events are bypassed, global query filters (soft delete) DO apply to `where`, audit fields are NOT bypassed (`LastModifiedOn` and `LastModifiedBy` are stamped automatically unless the caller sets them explicitly), and it runs on the ambient transaction when one is active, so a decrement rolls back with its caller.
- **Walkthrough**
  - `AddAsync` (`IRepository.cs:165-167`) and `AddRangeAsync` (`IRepository.cs:173-175`): single and batch inserts.
  - `UpdateAsync` (`IRepository.cs:181-183`) and `UpdateRange` (`IRepository.cs:187`): mark tracked entities modified. `UpdateRange` is the one `void` member of the pair, since batch marking needs no await.
  - The two `SetOriginalRowVersion` overloads and the two set-based operations described above (`IRepository.cs:197`, `:209`, `:219`, `:242`).
  - `Save()` (`IRepository.cs:249`) and `SaveChangesAsync(CancellationToken)` (`IRepository.cs:254`): the synchronous and async persist, each returning the number of state entries written; the doc comment prefers the async form in async code paths (`IRepository.cs:247`).
- **Why it's built this way**: keeping writes in a focused interface means a query handler cannot accidentally acquire mutation methods, and the concurrency and set-based escape hatches are declared where they are visible with their warnings attached rather than buried in a concrete class.
- **Where it's used**: command handlers that mutate entities; folded into [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) (`IRepository.cs:262`). Handed out by [`IUnitOfWork.GetRepository<TEntity, TIdentifierType>()`](#iunitofwork) (`IUnitOfWork.cs:19`) and implemented by [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype), which is where the audit-stamping compensation for `ExecuteUpdateAsync` lives (`EFRepository.cs:121-132`, using the injected `TimeProvider` and `ICurrentUserService`, `EFRepository.cs:23-27`).

### IReadRepository<TEntity, TIdentifierType>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:134` · Level 5 · interface

- **What it is**: the full read surface, combining [`IEntityReader`](#ientityreadertentity-tidentifiertype) (by-id) and [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype) (collections), plus four `IQueryable<TEntity>` properties for handlers that need raw LINQ.
- **Depends on**: [`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype) and [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype) (both same file, `IRepository.cs:135`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint, `IRepository.cs:136`).
- **Concept, composing the focused reads and exposing controlled `IQueryable`.** `[Rubric §1, SOLID]` (this is the composition point of the ISP ladder) and `[Rubric §12, Performance & Scalability]` (the query properties make EF's tracking and split-query modes an explicit choice at the call site). The doc comment (`IRepository.cs:126-131`) records the migration stance: existing code should continue using this interface, while new handlers can depend on the focused sub-interfaces for better ISP compliance.
- **Walkthrough**: four `IQueryable<TEntity>` get-only properties, adding nothing else beyond the two inherited surfaces.
  - `Table` (`IRepository.cs:140`): change tracking enabled.
  - `TableNoTracking` (`IRepository.cs:143`): no-tracking, documented as best for queries.
  - `TableNoTrackingSingleQuery` (`IRepository.cs:146`): no-tracking, forced to a single SQL statement.
  - `TableNoTrackingSplitQuery` (`IRepository.cs:149`): no-tracking in split-query mode, avoiding the cartesian explosion that collection includes cause, the same concern [`IQueryableExecutor.AsSplitQuery`](#iqueryableexecutor) addresses.
- **Why it's built this way**: naming the tracking and query-shape choices as distinct properties turns an expensive default (tracking, single-query with collection includes) into an explicit opt-in rather than an accident, and it gives the profiling decorator a single surface to wrap.
- **Where it's used**: query handlers wanting the whole read surface; resolved via [`IUnitOfWork.GetReadRepository<TEntity, TIdentifierType>()`](#iunitofwork) (`IUnitOfWork.cs:29`); implemented by [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) (`EFReadRepository.cs:15-17`) and wrapped by [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) (`EFReadRepositoryDecorator.cs:15-16`); extended by [`ReadRepositoryExtensions`](#readrepositoryextensions) with `GetByIdOrFailAsync` (`ReadRepositoryExtensions.cs:12` and `:27`); combined with [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype) into [`IRepository`](#irepositorytentity-tidentifiertype).
- **Caveats / not-in-source**: mutation handlers must not compose a query off `TableNoTracking` and then expect saves to persist, because a single no-tracking source makes the whole composed query untracked. That constraint is not stated in this file; it follows from EF's tracking semantics.

### IRepository<TEntity, TIdentifierType>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:262` · Level 6 · interface

- **What it is**: the combined read-write repository, extending both [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) and [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype), so a command handler that reads and mutates takes a single dependency.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) and [`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype) (both on `IRepository.cs:262`), and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint, `IRepository.cs:263`).
- **Concept, the top of the ISP ladder.** `[Rubric §1, SOLID]`. The interface is purely compositional: it adds no members of its own, only the two constraints `where TEntity : AuditableBaseEntity<TIdentifierType>` and `where TIdentifierType : notnull` (`IRepository.cs:263-264`). Command handlers that both query and mutate take `IRepository`; query handlers take [`IReadRepository`](#ireadrepositorytentity-tidentifiertype); handlers needing only point lookups take [`IEntityReader`](#ientityreadertentity-tidentifiertype). Each dependency is explicit and minimal, and the widest one is a deliberate choice rather than a default.
- **Walkthrough**: no members. The declaration is a semicolon-terminated interface with two bases and two generic constraints (`IRepository.cs:262-264`), the C# shorthand for an empty body.
- **Why it's built this way**: keeping the combined interface empty means the read and write surfaces each stay independently usable and independently mockable, while a handler that genuinely needs both still gets one constructor parameter.
- **Where it's used**: resolved through [`IUnitOfWork.GetRepository<TEntity, TIdentifierType>()`](#iunitofwork) (`IUnitOfWork.cs:19`), which is the sanctioned way to obtain one; implemented by [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) (`EFRepository.cs:23-27`, deriving from [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) and adding the write surface) and wrapped for profiling by [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype).

### IUnitOfWork

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IUnitOfWork.cs:10` · Level 7 · interface

- **What it is**: the one coordination point a handler uses to touch the database. It hands out typed repositories (read-write for aggregate roots, read-only for any entity), persists everything pending in one call, and exposes controlled transaction and identity-insert operations. The doc comment states the contract in two sentences (`IUnitOfWork.cs:5-9`): it coordinates persistence across multiple repositories within a single database context, and `SaveChangesAsync` persists all pending changes and dispatches domain events raised by tracked aggregates.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) as the two constraint bounds (`IUnitOfWork.cs:1`, `:20`, `:30`); [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) and [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) as the two return types (`IUnitOfWork.cs:19` and `:29`). Externals: BCL `IDisposable` and `IAsyncDisposable`, both declared as base interfaces (`IUnitOfWork.cs:10`). Notably absent: anything from `Microsoft.EntityFrameworkCore`, which is the point of the type.
- **Concept introduced, the Unit of Work as the Application layer's only persistence verb.** `[Rubric §8, Data Architecture]` assesses whether persistence is deliberate: one save boundary, one transaction story, explicit concurrency and audit handling rather than scattered `SaveChanges` calls. A unit of work is the scope inside which a caller sees a consistent view of the data and inside which all of its changes either land together or not at all. Here that scope is the DI scope: [`UnitOfWork`](#unitofwork) is registered `TryAddScoped` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:109`), it caches one repository per closed generic interface type (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:23`, `:37-43`), and every repository it hands out is bound to a context obtained from the same [`IDbContextFactory`](#idbcontextfactory) (`UnitOfWork.cs:41`), so two handlers in one request share one change tracker instead of racing two.

  `[Rubric §3, Clean Architecture]` assesses whether the inner layers declare intent while the outer layers own the technology. This interface lives in `MMCA.Common.Application` and names no EF type, which is exactly what lets the architecture fitness rule "Application must not depend on EF Core, use IRepository/IUnitOfWork" hold (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Purity.cs:58-64`). The EF-shaped work (context per physical source, execution strategies, identity-insert SQL) sits behind it in `MMCA.Common.Infrastructure`.

  `[Rubric §6, CQRS & Event-Driven]` assesses whether events are raised and delivered from a single, reliable place. `SaveChangesAsync` is that place: the doc comment (`IUnitOfWork.cs:7-8`) ties persistence and domain-event dispatch into one operation, and the mechanism behind it is the interceptor plus outbox flow described on [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor).

  `[Rubric §14, Testability]` assesses whether the abstraction a handler depends on can be replaced without infrastructure. Because a handler asks this interface for its repositories rather than receiving them, one `Mock<IUnitOfWork>` substitutes the entire data layer; the framework ships that scaffold as [`HandlerTestBase<THandler>`](group-27-testing-infrastructure.md#handlertestbasethandler), which pre-stubs `SaveChangesAsync` to return 1 (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/HandlerTestBase.cs:41-45`) and wires each registered repository mock into both `GetRepository` and `GetReadRepository` (`HandlerTestBase.cs:52-53`).
- **Walkthrough**: nine members, in three groups.
  - `GetRepository<TEntity, TIdentifierType>()` (`IUnitOfWork.cs:19-21`): the read-write repository. Its constraint is `where TEntity : AuditableAggregateRootEntity<TIdentifierType>` (`IUnitOfWork.cs:20`), so the DDD rule that the doc comment states in prose ("Only aggregate roots can be directly persisted", `IUnitOfWork.cs:14`) is enforced by the compiler: asking for a write repository over a child entity does not compile. In the implementation the call resolves the entity's physical data source through [`IDataSourceService`](#idatasourceservice), fetches the matching context, and builds the repository through [`IRepositoryFactory`](#irepositoryfactory) (`UnitOfWork.cs:40-42`).
  - `GetReadRepository<TEntity, TIdentifierType>()` (`IUnitOfWork.cs:29-31`): the read-only repository, constrained only to [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`IUnitOfWork.cs:30`), so child entities are readable even though they are not independently writable. Same resolution path, different factory method (`UnitOfWork.cs:60-62`).
  - `SaveChangesAsync(CancellationToken cancellationToken = default)` (`IUnitOfWork.cs:36`): persists everything and returns the number of state entries written (`IUnitOfWork.cs:35`). The implementation is a straight delegation (`UnitOfWork.cs:69-70`) to [`DbContextFactory`](#dbcontextfactory), which saves **every** cached context, not just one: it snapshots the contexts and loops in bounded passes so a context materialized by a domain event handler mid-save is still saved (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:230-256`), then throws if any tracked change is left behind rather than losing it silently (`DbContextFactory.cs:264-275`).
  - `Save()` (`IUnitOfWork.cs:40`): the synchronous form, with the doc comment preferring the async one in async code paths (`IUnitOfWork.cs:38`). It delegates to `DbContextFactory.SaveChanges()` (`UnitOfWork.cs:73`, `DbContextFactory.cs:413-421`).
  - `RequestIdentityInsert()` (`IUnitOfWork.cs:49`): a one-shot flag saying the next save may insert rows carrying explicit values for database-generated identity columns, for example records imported from an external system with their source ids intact (`IUnitOfWork.cs:42-48`). The implementation sets a boolean (`UnitOfWork.cs:76`, `DbContextFactory.cs:281`); the next `SaveChangesAsync` reads and immediately clears it (`DbContextFactory.cs:232-233`, which is what "automatically cleared after the save completes" means) and, for a SQL Server context, routes the save through `SaveWithIdentityInsertAsync`, which groups the affected entries by table and wraps each group in `SET IDENTITY_INSERT ON/OFF` because SQL Server allows only one table per session to have it on (`DbContextFactory.cs:283-296`).
  - `BeginTransaction()` (`IUnitOfWork.cs:52`), `CommitTransaction()` (`IUnitOfWork.cs:55`), `RollbackTransaction()` (`IUnitOfWork.cs:58`): manual transaction control, each fanning out across every transaction-capable cached context (`DbContextFactory.cs:423-447`). Rollback additionally drops any deferred in-process event dispatch, because the aggregate changes and their outbox rows just rolled back with it (`DbContextFactory.cs:448-452`).
  - `ExecuteInTransactionAsync<TResult>(Func<CancellationToken, Task<TResult>> operation, CancellationToken cancellationToken = default)` (`IUnitOfWork.cs:70-72`): the member to reach for instead of the three above. Its doc comment (`IUnitOfWork.cs:60-66`) states the reason: the operation runs wrapped by the active execution strategy, so a retrying strategy such as `SqlServerRetryingExecutionStrategy` can retry the whole transaction as one retriable unit, committing on success and rolling back before an exception propagates. The implementation adds four behaviors worth knowing (`DbContextFactory.cs:501-543` and the attempt runner at `:553-584`): a nested call joins the ambient transaction instead of opening a second one (`DbContextFactory.cs:512-513`); a returned failed [`Result`](group-01-result-error-handling.md#result) rolls back exactly like an exception (`DbContextFactory.cs:562-568`); deferred in-process domain events are flushed only after a successful commit (`DbContextFactory.cs:575-582`); and a failure of the **commit itself** is never retried, surfacing as [`TransactionCommitAmbiguousException`](#transactioncommitambiguousexception) instead (`DbContextFactory.cs:539-540`).
  - The two base interfaces (`IUnitOfWork.cs:10`) matter at scope teardown: [`UnitOfWork`](#unitofwork) forwards both disposal paths to the context factory (`UnitOfWork.cs:93-107`), so the async path awaits `_dbContextFactory.DisposeAsync()` (`UnitOfWork.cs:103`) rather than blocking.
- **Why it's built this way**: under [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) a single host may own several physical databases, so "save" cannot mean "call SaveChanges on the one context". Splitting the responsibility keeps that manageable: [`IDbContextFactory`](#idbcontextfactory) owns multi-source routing, saving, transactions and disposal, while `IUnitOfWork` is the narrow per-scope facade the Application layer is allowed to see, adding only repository resolution and caching on top (`UnitOfWork.cs:13`, `:23`). Exposing `ExecuteInTransactionAsync` as a first-class member (rather than leaving callers with `BeginTransaction`) is what makes the [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) pipeline's transaction rules enforceable in one place: business failures roll back and post-commit event dispatch is deferred, which is precisely the revision ADR-014 records. Keeping the interface in Application rather than Infrastructure is the [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) and Clean Architecture pairing, since a handler returns a `Result` and never sees an EF type on the way there.
- **Where it's used**: injected into command handlers across the framework and both apps. In MMCA.Common: [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult) takes it in its primary constructor (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:18-20`) and calls `ExecuteInTransactionAsync` for any command marked [`ITransactional`](group-05-cqrs-pipeline.md#itransactional) (`TransactionalCommandDecorator.cs:29-31`); [`DeleteEntityHandler<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentityhandlertentity-tidentifiertype) resolves its write repository from it (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:15` and `:25`); [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) both holds it and derives its read repository from it (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:32`, `:43`, `:48`). In MMCA.ADC, [`RefreshFromSessionizeHandler`](group-18-conference-application.md#refreshfromsessionizehandler) is the live consumer of the identity-insert path, calling `RequestIdentityInsert()` immediately before the save because Sessionize imports preserve external ids into tables with IDENTITY columns (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:136-139`). The single implementation is [`UnitOfWork`](#unitofwork) (`UnitOfWork.cs:13`), which is `internal sealed`, so consumers only ever see this interface.
- **Caveats / not-in-source**: `Save()` is not the synchronous twin of `SaveChangesAsync()` in event behavior. The synchronous interceptor path cannot await the in-process dispatcher, so it clears the captured events from their aggregates and leaves their outbox rows for [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) to deliver (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:100-121`). A second caveat concerns how you obtain a repository: `AddInfrastructure` does register the open generic `IRepository<,>` to `EFRepository<,>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:107`), but that concrete type takes a bare `DbContext` constructor parameter (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:23-24`) and no `DbContext` service registration appears in that file, so constructor-injecting `IRepository<,>` sidesteps both the data-source resolution and the per-scope repository cache that `GetRepository` performs (`UnitOfWork.cs:37-43`). Ask the unit of work for repositories. Finally, `ExecuteInTransactionAsync` is not a distributed transaction: with several physical sources each gets its own transaction and commits are sequential and best effort, so a commit failure on the second source leaves the first already committed; the outbox is the cross-source consistency mechanism (`DbContextFactory.cs:455-459` and `:492-499`).

### AuditTrailEntry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailEntry.cs:23` · Level 0 · class (sealed)

- **What it is**: one recorded change to an entity that opted into change history, written in the same
  transaction as the change it describes. It is the row shape of the `AuditTrailEntries` table: what
  changed, on which entity, from what to what, by whom, when, under which trace and which tenant.
- **Depends on**: the `UserIdentifierType` alias for `ChangedBy` (`AuditTrailEntry.cs:80`, the
  solution-wide identifier alias described in the primer) and nothing else first-party. It is written
  by [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor), purged by
  [`AuditTrailCleanupJob`](#audittrailcleanupjob), and projected by
  [`AuditTrailReader`](#audittrailreader).
- **Concept introduced, framework bookkeeping rows versus domain state.** `[Rubric §8, Data
  Architecture]` (assesses whether persistence mechanics are deliberate: keys, soft-delete,
  concurrency, retention) and `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether
  history and personal data are governed rather than accumulated). The class comment states the
  category decision outright (`AuditTrailEntry.cs:9-13`): this is deliberately **not** an
  [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), exactly like
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) and
  [`ScheduledJobEntry`](group-14-module-system-composition.md#scheduledjobentry). It carries no
  soft-delete flag (so no global query filter reaches it), no audit stamps of its own (stamping a
  stamp record is circular), and no concurrency token. Rows are append-only: nothing in the framework
  updates one, and the only deletion is the retention sweep.
- **Walkthrough**: every member is `init`-only except one.
  - `Id` (`AuditTrailEntry.cs:26`): a `Guid` defaulted to `Guid.NewGuid()`, so a row is addressable
    the moment it is constructed, before the database sees it. That matters for the key fix-up below,
    which needs to find the row by id after the save.
  - `EntityType` (`AuditTrailEntry.cs:33`): `required`, the full CLR type name as a **string**, not a
    foreign key. The comment gives the two reasons: the trail outlives the row it describes (a deleted
    entity keeps its history) and one table spans every audited type.
  - `EntityKey` (`AuditTrailEntry.cs:46`): `required`, the invariant string form of the primary key,
    with a composite key joined by `|` in the model's key order. This is the one **settable** property
    on the class, and the comment at `AuditTrailEntry.cs:40-45` records why: an entity with a
    store-generated key has no key yet when the change is captured, so the interceptor rewrites this
    single column once the insert has assigned one.
  - `PropertyName`, `OldValue`, `NewValue` (`AuditTrailEntry.cs:52,59,67`): all nullable. A property
    carrying [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute) stores the redaction
    placeholder on both sides instead of its value (`AuditTrailEntry.cs:57,65`).
  - `Operation` (`AuditTrailEntry.cs:74`): `required`, one of `Added`, `Modified`, `Deleted`. The
    comment names the consequence that surprises people: a soft delete arrives as `Modified` on
    `IsDeleted`, which is exactly what it is at the database level.
  - `ChangedBy`, `ChangedOn`, `CorrelationId`, `TenantId` (`AuditTrailEntry.cs:80,83,91,99`): the
    provenance block. `ChangedBy` is null for a save that carried no identity (a background service, a
    seeder), `CorrelationId` is the ambient trace id, and `TenantId` comes from
    `ApplicationDbContext.CurrentTenantId` at capture.
  - **Row shape** (`AuditTrailEntry.cs:15-21`): a `Modified` save produces one row per property that
    actually changed, so a trail reads as a field-level history; an `Added` or `Deleted` save produces
    a single summary row with a null `PropertyName`, because the interesting fact there is the
    lifecycle event and one row per column at insert time would multiply the table for no extra
    information.
- **Why it's built this way**: [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)
  chose a same-transaction, field-level trail over a post-commit log or a database trigger, and this
  entity is the shape that follows from it. Redacting personal data at capture rather than at read
  keeps the trail from becoming a second copy of a data subject's data that erasure would have to
  chase ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).
- **Where it's used**: mapped by `ApplicationDbContext.ConfigureAuditTrail`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:572-601`)
  to `dbo.AuditTrailEntries` with `EntityType` at 256 non-unicode characters, `EntityKey` at 128,
  `PropertyName` at 128 non-unicode (`ApplicationDbContext.cs:581-585`), plus two indexes:
  `IX_AuditTrailEntries_Entity` over `(EntityType, EntityKey, ChangedOn)` for the read path and
  `IX_AuditTrailEntries_ChangedOn` for the retention sweep (`ApplicationDbContext.cs:592-599`). The
  mapping only happens when `AuditTrail:Enabled` is true (`ApplicationDbContext.cs:271,574-577`), so a
  host that never opted in has exactly the model it had before the trail shipped.

### CaptureContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:541` · Level 0 · record struct (private readonly, nested)

- **What it is**: a four-field value carrying the provenance every trail row of one save shares:
  the acting user, the capture instant, the trace id, and the tenant.
- **Depends on**: the `UserIdentifierType` alias and `System.DateTime`; nothing else. It is nested
  inside [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor) and private to it.
- **Concept introduced, resolve-once-per-save provenance.** `[Rubric §12, Performance &
  Scalability]` (assesses whether per-item work is hoisted out of loops on a hot path): a save can
  produce dozens of trail rows, and every one of them wants the same four values. Reading
  `Activity.Current`, calling `TimeProvider.GetUtcNow()` and truncating strings once per save rather
  than once per row is the whole point, and it also guarantees that every row of one save carries an
  identical `ChangedOn`, which is what lets a reader group a save back together.
- **Walkthrough**: the positional members are `ChangedBy` (nullable user id), `ChangedOn` (UTC
  instant), `CorrelationId` (nullable trace id) and `TenantId` (nullable), declared at
  `AuditTrailSaveChangesInterceptor.cs:541-545`. It is constructed exactly once per capture, in
  `CaptureChanges` (`AuditTrailSaveChangesInterceptor.cs:189-193`), where the trace id and tenant are
  already truncated to their column widths (`MaxCorrelationIdLength` 64 and `MaxTenantIdLength` 64,
  `AuditTrailSaveChangesInterceptor.cs:80,83`). It is then passed by value into `CaptureEntry` and
  `CaptureModifiedProperties`, which copy its fields straight onto each new
  [`AuditTrailEntry`](#audittrailentry) (`AuditTrailSaveChangesInterceptor.cs:257-260,312-315`).
- **Why it's built this way**: `readonly record struct` means no allocation and no defensive copying
  concerns for a value that exists only for the duration of one `SavingChanges` call; `private`
  keeps it invisible outside the interceptor. Positional syntax gives it structural equality and a
  useful `ToString` for free, neither of which the interceptor needs but neither of which costs
  anything.
- **Where it's used**: only inside
  [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor).

### EntityConfigurationOptions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/EntityConfigurationOptions.cs:10` · Level 0 · class (sealed)

- **What it is**: an options bag that carries extra assemblies whose EF Core entity type
  configurations should be applied on top of the ones auto-discovered by name. A host or module pushes
  an `Assembly` into it during DI so its configurations are picked up without the discovery scan
  having to match it by naming convention.
- **Depends on**: `System.Reflection.Assembly` (BCL); nothing first-party. It is read by
  [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider) through
  `IOptions<EntityConfigurationOptions>` (`DefaultEntityConfigurationAssemblyProvider.cs:12-13`).
- **Concept introduced, options-object supplementation of convention discovery.** `[Rubric §3, Clean
  Architecture]` (assesses whether infrastructure discovers its collaborators rather than hardcoding
  references to them): the persistence layer does not reference every module's Infrastructure project,
  so a module that does not follow the `.Infrastructure` naming rule (for example a Common feature
  like Notification that lives inside `Common.Infrastructure` itself, which the auto-scan deliberately
  excludes) still gets its configurations applied by adding its assembly here. The doc comment names
  exactly that case (`EntityConfigurationOptions.cs:5-9`).
- **Walkthrough**: one member, `List<Assembly> AdditionalAssemblies { get; } = []`
  (`EntityConfigurationOptions.cs:16`). It is get-only and initialized to an empty list, so
  registration code mutates the list rather than replacing it.
- **Why it's built this way**: an options object keeps the supplemental-assembly list open for
  extension without the provider (or the context) taking a compile-time dependency on any specific
  module. The provider merges these with the name-scanned set and de-duplicates.
- **Where it's used**: written through the `AddEntityConfigurationAssembly(Assembly)` extension
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:496-506`), which calls
  `services.Configure<EntityConfigurationOptions>` with a contains-check so an assembly is added at
  most once; `AddNotificationInfrastructure()` (`DependencyInjection.cs:513-515`) is the one
  in-framework caller. It is read by
  [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider).

### NamespaceConventions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:7` · Level 0 · class (internal static)

- **What it is**: one internal static method that derives a module name from an entity type's
  namespace by returning the segment immediately preceding `Domain`. It is the single shared rule so
  SQL schema names and logical database names can never drift apart.
- **Depends on**: nothing first-party (BCL string and array only).
- **Concept introduced, convention-over-configuration naming.** `[Rubric §8, Data Architecture]`
  (assesses schema and database organization) and `[Rubric §7, Microservices Readiness]` (assesses
  whether the model splits cleanly per module): `MMCA.Store.Sales.Domain.Orders` yields `"Sales"`,
  which becomes both the `[Sales]` SQL schema and the `Sales` logical database name (the two worked
  examples are in the doc comment, `NamespaceConventions.cs:9-13`). A new module that follows the
  namespace pattern gets a schema and a data-source name with zero configuration; an explicit
  `[UseDatabase("X")]` attribute on a configuration overrides it when the pattern does not fit.
- **Walkthrough**: `GetModuleName(Type entityType)` (`NamespaceConventions.cs:16`) splits the
  namespace on `.`, defaulting to an empty array when `Namespace` is null
  (`NamespaceConventions.cs:18`), finds the case-insensitive index of the `Domain` segment
  (`NamespaceConventions.cs:19-20`), and returns the preceding segment when that index is `>= 1`,
  otherwise `null` (`NamespaceConventions.cs:21`). The `>= 1` guard is what makes a `Domain`-first or
  `Domain`-less namespace fall through to `null`.
- **Why it's built this way**: a single authority for both derivations means the schema name and the
  database name are computed identically, so they cannot diverge. It is `internal` because callers
  should consume the resolved name, not re-derive it.
- **Where it's used**: [`EntityDataSourceRegistry`](#entitydatasourceregistry) falls back to it when no
  `[UseDatabase]` is present and then to `DataSourceKey.DefaultName`
  (`EntityDataSourceRegistry.cs:180-182`), and
  [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype)
  uses it for the SQL table schema (`EntityTypeConfiguration.cs:66`, falling back to `dbo`) and the
  Cosmos container name (`EntityTypeConfiguration.cs:87`, falling back to the entity type name).

### ProfilingHelper
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ProfilingHelper.cs:9` · Level 0 · class (internal static)

- **What it is**: an internal static helper that wraps repository operations in a MiniProfiler timing
  step when profiling is active and is a no-op when it is not.
- **Depends on**: `StackExchange.Profiling` (the MiniProfiler NuGet package); nothing first-party.
- **Concept introduced, opt-in per-operation timing via a null-conditional.** `[Rubric §13,
  Observability & Operability]` (assesses granular timing and instrumentation of persistence): every
  helper routes through `MiniProfiler.Current?.Step(...)` (`ProfilingHelper.cs:11-12`). When
  MiniProfiler is not registered, `MiniProfiler.Current` is `null`, the `?.` short-circuits, and the
  returned `Timing?` is `null`, so `using var step = ...` disposes nothing. The instrumentation can
  therefore live permanently in the decorators without a build-time toggle; the runtime cost when
  disabled is a single field read.
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:24-65`,
  covering `AddAsync` through `SaveChangesAsync`) and
  [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepositoryDecorator.cs:31-81`,
  covering `GetAllAsync` through `ExistsAsync`).
  [`ApplicationDbContext`](#applicationdbcontext) opens its own MiniProfiler step directly rather
  than through this helper.

### DefaultEntityConfigurationAssemblyProvider
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DefaultEntityConfigurationAssemblyProvider.cs:12` · Level 1 · class (sealed)

- **What it is**: the default implementation of
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider). It returns the set
  of assemblies whose EF entity configurations should be applied: every loaded assembly whose name
  contains `.Infrastructure` (excluding `Common.Infrastructure` itself), plus any assemblies
  explicitly registered through [`EntityConfigurationOptions`](#entityconfigurationoptions).
- **Depends on**: [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) (the
  contract it implements), [`EntityConfigurationOptions`](#entityconfigurationoptions) via `IOptions<>`
  (`DefaultEntityConfigurationAssemblyProvider.cs:12-13`), and `System.AppDomain` plus
  `System.Reflection` (BCL).
- **Concept introduced, name-convention assembly discovery with an explicit escape hatch.** `[Rubric
  §3, Clean Architecture]` (infrastructure finds module configurations without referencing modules)
  and `[Rubric §7, Microservices Readiness]` (each extracted service loads only its own modules'
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:52`) and injected into
  [`ApplicationDbContext`](#applicationdbcontext), which iterates its assemblies inside
  `ApplyConfigurationsForEntitiesInContext` (`ApplicationDbContext.cs:627-629`).

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
  - `Include<T>` (`EFQueryableExecutor.cs:14-18`): calls EF's string-based `Include` on an EF
    queryable, otherwise returns the query unchanged (in-memory queries are already fully loaded).
  - `AsSplitQuery<T>` (`EFQueryableExecutor.cs:21-25`): applies EF's split-query behavior only on EF
    queryables, otherwise a pass-through.
  - `ToListAsync<T>` (`EFQueryableExecutor.cs:28-31`): uses EF's async materialization when available,
    otherwise the synchronous collection expression `[.. query]`.
  - `CountAsync<T>` (`EFQueryableExecutor.cs:34-37`): EF async count when available, otherwise
    `Task.FromResult(query.Count())`.
  - `IsEfQuery<T>` (`EFQueryableExecutor.cs:43`): the discriminator. An EF provider's queryable
    implements `IAsyncEnumerable<T>`, a plain LINQ-to-Objects queryable does not, so a single
    `is IAsyncEnumerable<T>` test routes every call above.
- **Why it's built this way**: `internal sealed`; centralizing the EF versus in-memory branch in one
  class means every consumer gets the fallback for free and no handler references EF's static
  extension methods.
- **Where it's used**: registered as the singleton [`IQueryableExecutor`](#iqueryableexecutor)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:105`) and injected into
  Application-layer query code:
  [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`) and the
  notification handlers (`GetMyNotificationsHandler.cs:18`,
  `GetUnreadNotificationCountHandler.cs:15`, `GetNotificationHistoryHandler.cs:17`,
  `MarkNotificationReadHandler.cs:14`, `MarkAllNotificationsReadHandler.cs:14`).

### PendingEntityKey
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:550` · Level 1 · record (private sealed, nested)

- **What it is**: a two-field pairing of a staged trail row with the entity entry whose primary key
  the database has not assigned yet. It exists only between `SavingChanges` and `SavedChanges`.
- **Depends on**: [`AuditTrailEntry`](#audittrailentry) and EF Core's
  `Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry`. It is nested inside and private to
  [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor).
- **Concept introduced, the store-generated-key fix-up.** `[Rubric §8, Data Architecture]` (assesses
  whether key strategy and its consequences are handled deliberately): the trail is captured
  **before** the save, which is exactly what makes it transactional, but an entity whose key is an
  identity column has no key at that moment. EF holds a temporary sentinel value that would make the
  row unfindable by key (`AuditTrailSaveChangesInterceptor.cs:263-266`). Remembering the pair, then
  rewriting the one column after the insert, is the price of capturing early; the alternative
  (capturing after the save) would put the trail outside the transaction and lose the guarantee the
  whole design exists for.
- **Walkthrough**: the positional members are `Row` (the tracked trail row whose `EntityKey` must be
  rewritten) and `Entry` (the audited entry whose key the database assigns), declared at
  `AuditTrailSaveChangesInterceptor.cs:550`. Instances are produced by `CaptureEntry` only when the
  entry is `Added` **and** `HasTemporaryKey(entry)` returns true
  (`AuditTrailSaveChangesInterceptor.cs:267-269`, with the temporary-key test walking every primary
  key property at `:449-466`). They are accumulated into a list and parked in a
  `ConditionalWeakTable<DbContext, List<PendingEntityKey>>` keyed by the context
  (`AuditTrailSaveChangesInterceptor.cs:92,213-216`), then drained in `ResolveGeneratedKeysAsync` or
  `ResolveGeneratedKeys` (`:368-396,402-429`).
- **Why it's built this way**: a `record` gives value semantics and a readable two-name shape for
  something that is pure bookkeeping; `private sealed` keeps it invisible. Holding the list in a
  `ConditionalWeakTable` rather than in an instance field is what lets the interceptor stay a
  singleton shared by every context without leaking state across them, and the weak keying means a
  context that is dropped without a save takes its pending list with it.
- **Where it's used**: only inside
  [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor).

### SoftDeleteFilterSql
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:16` · Level 1 · class (internal static)

- **What it is**: a one-method internal static class that builds the `IsDeleted = 0` predicate string
  used as a filtered-index condition, in the identifier-quoting style of the target engine. It is the
  single authority both the automatic convention and the hand-authored opt-in call, so the two can
  never disagree.
- **Depends on**: [`DataSource`](#datasource) (the engine enum),
  [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) (for the
  `nameof(IAuditableEntity.IsDeleted)` property name), and EF Core's
  `Microsoft.EntityFrameworkCore.Metadata.IReadOnlyEntityType` plus the `GetColumnName()` relational
  metadata extension.
- **Concept introduced, one predicate builder shared by a convention and an explicit extension.**
  `[Rubric §8, Data Architecture]` (assesses whether soft-delete is honored by the schema, not just by
  query filters) and `[Rubric §16, Maintainability]` (assesses whether one rule has one
  implementation): a filtered unique index that hardcodes the literal `"[IsDeleted] = 0"` breaks in
  two ways, on a model that renames the column with `HasColumnName` and on a provider that quotes
  identifiers with double quotes rather than brackets. Reading the column name from the EF model and
  branching on the engine fixes both, and putting that logic in one place means the automatic path
  ([`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention)) and the opt-in path
  ([`IndexBuilderExtensions`](#indexbuilderextensions)) emit byte-identical SQL
  (`SoftDeleteFilterSql.cs:8-15`).
- **Walkthrough**: `Build(DataSource engine, IReadOnlyEntityType entityType)`
  (`SoftDeleteFilterSql.cs:27`) has three steps.
  - **Cosmos short-circuit** (`SoftDeleteFilterSql.cs:29-30`): returns `null` for `DataSource.CosmosDB`,
    which has no filtered-index support. `null` is the contract for "leave the index untouched", and
    both callers check it before doing anything (`SoftDeleteUniqueIndexConvention.cs:47-49`,
    `IndexBuilderExtensions.cs:56-58`).
  - **Column-name resolution** (`SoftDeleteFilterSql.cs:32-33`): looks the `IsDeleted` property up in
    the entity type and takes its mapped column name, falling back to the CLR property name when the
    property is not in the model. A `HasColumnName` rename therefore follows automatically.
  - **Quoting** (`SoftDeleteFilterSql.cs:35-37`): SQL Server gets `[Column] = 0`, every other
    relational engine (SQLite today) gets `"Column" = 0`.
- **Why it's built this way**: `internal static` with a nullable return keeps the engine-capability
  decision inside the builder rather than duplicated at each call site. The Cosmos `null` is a
  deliberate signal instead of an exception, because both callers run over whole models where Cosmos
  entities are simply skipped.
- **Where it's used**: [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) calls it
  at model finalization (`SoftDeleteUniqueIndexConvention.cs:45-49`), and
  [`IndexBuilderExtensions`](#indexbuilderextensions) calls it for a hand-authored index, optionally
  joining an extra predicate (`IndexBuilderExtensions.cs:54-58`).
- **Caveats / not-in-source**: the double-quote branch is reached by any non-SQL-Server, non-Cosmos
  engine. SQLite is the only such engine registered today, so whether the quoting suits a future
  provider is Not determinable from source.

### AuditTrailSaveChangesInterceptor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:62` · Level 6 · class (sealed)

- **What it is**: the EF Core save interceptor that records a field-level change history for every
  entity marked [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity), writing
  [`AuditTrailEntry`](#audittrailentry) rows into the **same transaction** as the change they
  describe.
- **Depends on**: [`AuditTrailEntry`](#audittrailentry),
  [`CaptureContext`](#capturecontext), [`PendingEntityKey`](#pendingentitykey),
  [`ApplicationDbContext`](#applicationdbcontext),
  [`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity),
  [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute),
  [`PiiRedactor`](group-02-domain-building-blocks.md#piiredactor),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage),
  [`InboxMessage`](group-04-events-outbox.md#inboxmessage),
  [`ScheduledJobEntry`](group-14-module-system-composition.md#scheduledjobentry), and the BCL
  `TimeProvider`, `Activity`, `ConditionalWeakTable` and `ConcurrentDictionary`.
- **Concept introduced, the transactional change trail.** `[Rubric §6, CQRS & Event-Driven]` (the
  same interceptor-pipeline mechanic the outbox uses, applied to a different payload), `[Rubric §8,
  Data Architecture]`, `[Rubric §13, Observability & Operability]` (each row carries the ambient trace
  id, so a change ties back to the request or job that made it) and `[Rubric §30, Compliance, Privacy
  & Data Governance]` (personal data is redacted at capture, never at read). The class comment states
  the guiding rule (`AuditTrailSaveChangesInterceptor.cs:20-22`): a trail that can be committed
  without its data, or the other way round, is worse than no trail. Four mechanics are worth learning
  here as a set.
  - **Opt in twice over** (`AuditTrailSaveChangesInterceptor.cs:33-36`): the host must call
    `AddAuditTrail` (the context resolves this interceptor with `GetService`, so its absence is a
    silent no-op, `ApplicationDbContext.cs:255-261`) **and** set `AuditTrail:Enabled` so the table is
    mapped. Then the entity must carry the marker. Nothing about the feature is on by default.
  - **Position in the pipeline** (`AuditTrailSaveChangesInterceptor.cs:26-31`): registered last, after
    [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor),
    [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor) and
    [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
    (`ApplicationDbContext.cs:236-261`), so the values it diffs are final: the audit stamps are
    already written when it runs.
  - **Correlation is the trace id, not the scoped correlation context**
    (`AuditTrailSaveChangesInterceptor.cs:44-54`): this interceptor is a singleton and the only
    service provider a context carries is the root one, so a scoped
    [`ICorrelationContext`](group-12-api-hosting-mapping.md#icorrelationcontext) is not reachable from
    here and capturing one would be a lifetime bug. The trace id is ambient and is the same value
    [`CorrelationIdMiddleware`](group-12-api-hosting-mapping.md#correlationidmiddleware) falls back to
    when a request carries no `X-Correlation-ID` header. A caller-supplied header value is therefore
    NOT recorded today.
  - **Tenant is read off the context** (`AuditTrailSaveChangesInterceptor.cs:56-59`), through the live
    accessor the scoped context factory assigns, so it does reach the interceptor where a scoped
    service would not.
- **Walkthrough**:
  - **Constants** (`AuditTrailSaveChangesInterceptor.cs:65-86`): the three operation names, the four
    column widths (`MaxEntityTypeLength` 256, `MaxKeyLength` 128, `MaxCorrelationIdLength` 64,
    `MaxTenantIdLength` 64) and the `|` composite-key separator. They match the model mapping in
    `ApplicationDbContext.ConfigureAuditTrail` exactly (`ApplicationDbContext.cs:583-585`).
  - **Static state** (`AuditTrailSaveChangesInterceptor.cs:92-119`): two `ConditionalWeakTable`s keyed
    by context (pending key fix-ups, and a marker for "a capture staged rows but the save has not
    finished"), a `ConcurrentDictionary` caching the PII verdict per (declaring type, property name),
    and a `HashSet<Type>` of the framework's own bookkeeping entities. That last set is guarded **by
    CLR type**, not by the absence of the marker, which is what keeps the trail from recording its own
    rows in an unbounded feedback loop and keeps the outbox, inbox and job tables out of a history
    nobody asked for (`AuditTrailSaveChangesInterceptor.cs:107-119`).
  - **The four overrides** (`AuditTrailSaveChangesInterceptor.cs:122-163`): `SavingChangesAsync` and
    `SavingChanges` both call `CaptureChanges`; `SavedChangesAsync` and `SavedChanges` both run the
    key fix-up. Each pattern-matches `eventData.Context is ApplicationDbContext` first, so a foreign
    context passes straight through.
  - **`CaptureChanges`** (`AuditTrailSaveChangesInterceptor.cs:177-219`): the first statement is the
    cheap double gate, `context.Model.FindEntityType(typeof(AuditTrailEntry)) is null`
    (`:182-185`), which covers both a host that never opted in and Cosmos (which skips relational
    tables), because `Set<AuditTrailEntry>()` would throw for both. Then it discards an abandoned
    capture, builds one [`CaptureContext`](#capturecontext), snapshots
    `ChangeTracker.Entries().Where(ShouldAudit).ToArray()` (`:197`, materialized before adding,
    because enumerating the tracker lazily while adding to it would throw), and captures each entry.
  - **`ShouldAudit`** (`AuditTrailSaveChangesInterceptor.cs:225-228`): the entity carries the marker,
    is not a framework bookkeeping type, and is in state `Added`, `Modified` or `Deleted`.
  - **`CaptureEntry`** (`AuditTrailSaveChangesInterceptor.cs:238-270`): a `Modified` entry delegates
    to the per-property diff; an `Added` or `Deleted` entry writes one summary row and then, only when
    the insert's key is still temporary, returns a [`PendingEntityKey`](#pendingentitykey).
  - **`CaptureModifiedProperties`** (`AuditTrailSaveChangesInterceptor.cs:277-318`): one row per
    property that is `IsModified` **and** whose value actually differs. A property EF flagged as
    modified but whose value is unchanged (the whole-entity `Update` idiom) writes nothing
    (`:272-276`). `PiiRedactor.HasPii(entry.Metadata.ClrType)` is checked once per entity so a type
    with no personal data skips the per-property attribute lookup entirely (`:286`), and a PII
    property records `PiiRedactor.RedactedToken` on both sides (`:309-310`).
  - **`DiscardAbandonedCapture`** (`AuditTrailSaveChangesInterceptor.cs:339-360`): the retry-safety
    mechanic. An execution strategy that retries a failed save re-runs `SavingChanges` against a
    tracker that still holds the previous attempt's `Added` rows, so without this one transient SQL
    fault writes the trail twice. It only fires when the marker is present (a completed save leaves
    none `Added`), because discarding unconditionally would also throw away trail rows a caller added
    deliberately.
  - **`ResolveGeneratedKeysAsync` and `ResolveGeneratedKeys`**
    (`AuditTrailSaveChangesInterceptor.cs:368-396,402-429`): rebuild the key now that the insert has
    assigned one, skip rows whose key did not change, and rewrite the one column with a set-based
    `ExecuteUpdate` per row, which bypasses the change tracker and the interceptor pipeline and joins
    the ambient transaction when one is open (the same technique as
    [`OutboxFinalizer`](group-04-events-outbox.md#outboxfinalizer)). `SyncTrackedKey` (`:437-443`)
    then brings the tracked instance and its snapshot in line so a later save does not re-issue the
    update, and the ordering there is load-bearing: writing `OriginalValue` must precede clearing
    `IsModified`, because clearing the flag reverts the current value to the original.
  - **Helpers**: `AddRow` (`:325-331`, mutation is `Add` only, because the save runs with automatic
    change detection off), `HasTemporaryKey` (`:449-466`), `BuildEntityKey` (`:473-485`, a keyless
    entity yields an empty string rather than throwing), `IsPiiProperty` (`:492-504`, a shadow
    property has no `PropertyInfo` so it can never be personal data), `FormatValue` (`:510-511`,
    `CultureInfo.InvariantCulture` on purpose, so a trail read years later or on a differently
    localized replica shows the value that was written), `ValuesEqual` (`:517-530`, byte arrays such
    as row versions are compared by content, since reference equality would report every save as a
    change) and `Truncate` (`:533-534`).
- **Why it's built this way**:
  [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) chose the interceptor over a
  repository decorator (which sees intent, not the tracker's diff), an application handler (which sees
  the command, not the properties EF marked modified) and a database trigger (which sees the diff and
  nothing else: no user, no correlation id, no PII knowledge). Committing in the caller's transaction
  is the outbox mechanic of
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) applied to a different
  payload, and redacting at capture is what keeps the trail compatible with
  [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html).
- **Where it's used**: registered as a singleton by `AddAuditTrail`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:384`), added to the EF
  pipeline in `ApplicationDbContext.OnConfiguring` (`ApplicationDbContext.cs:258-261`), and registered
  in the design-time pipeline too so `dotnet ef` matches runtime
  ([`DesignTimeDbContextHelper`](#designtimedbcontexthelper),
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:87-89`).
  Behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailSaveChangesInterceptorTests.cs`
  and `AuditTrailModelGateTests.cs`. Hosts opting in today include MMCA.Helpdesk
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:71`), all three MMCA.Store services and
  all three MMCA.ADC services (for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:296`).
- **Caveats / not-in-source**: a caller-supplied `X-Correlation-ID` is not recorded; honoring it would
  need a live accessor on the context assigned by the scoped factory, the shape multi-tenancy
  introduced for `TenantId` (`AuditTrailSaveChangesInterceptor.cs:50-53`). Whether that will be done
  is Not determinable from source.

### AuditTrailCleanupJob
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailCleanupJob.cs:48` · Level 8 · class (internal sealed partial)

- **What it is**: the framework's own recurring job. It purges
  [`AuditTrailEntry`](#audittrailentry) rows older than the configured retention window from every
  relational data source in use, in batches.
- **Depends on**: [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob) (the contract it
  implements), [`IDbContextFactory`](#idbcontextfactory),
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry),
  [`AuditTrailSettings`](group-14-module-system-composition.md#audittrailsettings) and
  [`TenancySettings`](group-14-module-system-composition.md#tenancysettings) via `IOptions<>`,
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext),
  [`TenantDataSourceTargets`](#tenantdatasourcetargets) plus
  [`TenantDataSourceTarget`](#tenantdatasourcetarget), [`DataSource`](#datasource), `TimeProvider`,
  `IServiceScopeFactory` and `ILogger<T>`.
- **Concept introduced, retention as a first-class part of a history feature.** `[Rubric §30,
  Compliance, Privacy & Data Governance]` (assesses whether retained data has a bounded lifetime),
  `[Rubric §31, Cost & FinOps]` (assesses whether unbounded growth is designed out) and `[Rubric §29,
  Resilience & Business Continuity]` (a first sweep over a neglected table must not become one
  enormous transaction). The class comment makes the argument (`AuditTrailCleanupJob.cs:18-22`): a
  change trail grows monotonically and stores values that may describe a data subject, so a retention
  window is not housekeeping, it is what keeps the table from being both a cost centre and a
  data-protection liability. It also records the honest limitation
  (`AuditTrailCleanupJob.cs:23-28`): `AddAuditTrail` registers the job, but a job with no runner never
  executes, so the host must **also** call `AddScheduledJobs` and set `Scheduler:Enabled`. A host that
  records the trail without the scheduler is fully supported and keeps recording; pruning is then the
  operator's job.
- **Walkthrough**:
  - **Constructor** (`AuditTrailCleanupJob.cs:48-56`): the last two parameters are optional. The scope
    factory and the tenancy options default to `null`, because a host without tenancy never leaves the
    job's own scope. `_settings` is snapshotted from `options.Value` (`:60`).
  - **`Name` and `CronExpression`** (`AuditTrailCleanupJob.cs:63,67`): `"audit-trail-cleanup"`, daily
    at `0 3 * * *`, chosen to sit off the daily peak for every time zone the framework runs in.
  - **`ExecuteAsync`** (`AuditTrailCleanupJob.cs:70-87`): returns immediately when
    `AuditTrail:Enabled` is false (`:72-75`), computes the cutoff as now minus `RetentionDays`
    (`:77`), enumerates the physical sources in use and filters out `DataSource.CosmosDB` (`:79-81`),
    then expands that set into per-tenant targets through
    [`TenantDataSourceTargets`](#tenantdatasourcetargets) and sweeps each one.
  - **`PurgeTargetAsync`** (`AuditTrailCleanupJob.cs:94-112`): the shared database is swept on the
    job's own scope; a tenant that keeps its own database gets a fresh scope with
    [`ITenantContext.SetTenant`](group-05-cqrs-pipeline.md#itenantcontext) applied
    (`:105-111`), because the scoped context factory binds one database per scope and the job's scope
    is already bound to the shared one.
  - **`PurgeWithFactoryAsync`** (`AuditTrailCleanupJob.cs:115-136`): resolves the target's context and
    re-checks the model for the trail entity (`:125-128`). Cosmos is already excluded, but a
    relational source can still lack the table when the host disabled the trail after writing it, so
    the model, not the configuration, is the authority.
  - **`PurgeSourceAsync`** (`AuditTrailCleanupJob.cs:142-179`): the batching loop. It reads up to
    `BatchSize` (1000, `:58`) ids with `AsNoTracking`, ordered by `ChangedOn`, then deletes those ids
    with `ExecuteDeleteAsync`. The comment at `:151-153` explains the two-step shape: every relational
    provider translates an `IN` list, while a limited `DELETE` is not universally supported. The loop
    ends when a page comes back empty or short, and it re-checks the cancellation token each turn
    (`:149`). No row is ever materialized as an entity.
  - **Logging** (`AuditTrailCleanupJob.cs:181-182`): a source-generated `LoggerMessage` emitted only
    when a sweep actually removed rows (`:132-135`), so a quiet night logs nothing.
- **Why it's built this way**: registering the job in `AddAuditTrail` rather than in
  `AddScheduledJobs` keeps the two features independent, which the DI comment states outright
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:388-391`): the trail can
  be enabled without the scheduler and the scheduler without the trail. Set-based batched deletion is
  the same discipline the outbox retention sweep uses, for the same reason.
- **Where it's used**: registered through `AddScheduledJob<AuditTrailCleanupJob>()` inside
  `AddAuditTrail` (`DependencyInjection.cs:391`, which itself does a `TryAddScoped` plus a
  `TryAddEnumerable` of `IScheduledJob` at `:342-343`), and executed by
  [`ScheduledJobRunner`](group-14-module-system-composition.md#scheduledjobrunner) when the host runs
  the scheduler. Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailCleanupJobTests.cs`.

### AuditTrailReader
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailReader.cs:35` · Level 8 · class (internal sealed)

- **What it is**: the read side of the trail, and the only implementation of
  [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader). It returns one entity's change
  history, newest first, as a paged list of
  [`AuditTrailEntryDTO`](group-14-module-system-composition.md#audittrailentrydto).
- **Depends on**: [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader),
  [`IDbContextFactory`](#idbcontextfactory), [`IDataSourceResolver`](#idatasourceresolver),
  [`DataSourceKey`](#datasourcekey), [`AuditTrailEntry`](#audittrailentry),
  [`AuditTrailEntryDTO`](group-14-module-system-composition.md#audittrailentrydto) and
  [`AuditTrailSettings`](group-14-module-system-composition.md#audittrailsettings) via `IOptions<>`.
- **Concept introduced, projecting to a DTO inside the query rather than after it.** `[Rubric §9, API
  & Contract Design]` (the Application-layer contract returns a DTO, never the persistence entity) and
  `[Rubric §12, Performance & Scalability]` (the `Select` is part of the SQL, so only the projected
  columns cross the wire, and `AsNoTracking` keeps the rows out of the change tracker). The ordering
  is `ChangedOn` descending with `Id` as the tie-break (`AuditTrailReader.cs:63-64`), which matters
  because every row of one save shares an identical `ChangedOn`: without the second key, paging over
  a save's worth of rows would not be stable.
- **Walkthrough**: `GetForEntityAsync(entityType, entityKey, page = 1, pageSize = 50, ct)`
  (`AuditTrailReader.cs:43-48`).
  - **Paging guards** (`AuditTrailReader.cs:50-51`): a page or page size below 1 is coerced to 1
    rather than rejected, so a bad caller gets the first page instead of an exception.
  - **Source resolution** (`AuditTrailReader.cs:53-54`): resolves the `Default` database of the engine
    named by `AuditTrail:DataSource` and asks the context factory for it.
  - **Model gate** (`AuditTrailReader.cs:56-59`): returns an empty list when the trail entity is not
    in the model. The comment gives the reason (`AuditTrailReader.cs:26-30`): the read surface is
    registered by `AddAuditTrail`, which a host may call before flipping `AuditTrail:Enabled` per
    environment, so "not enabled" must read as "no history", not as an exception.
  - **The query** (`AuditTrailReader.cs:61-81`): `AsNoTracking`, filtered on `EntityType` and
    `EntityKey` (exactly the leading columns of `IX_AuditTrailEntries_Entity`,
    `ApplicationDbContext.cs:592-593`), ordered, skipped and taken, then projected column by column
    into the DTO.
- **Why it's built this way**: the DTO stops the persistence entity from leaking into the Application
  contract, and matching the query's predicate and sort to the shipped index is why that index carries
  the whole predicate plus the sort rather than just the key
  (`ApplicationDbContext.cs:590-593`).
- **Where it's used**: registered as the scoped
  [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader) by `AddAuditTrail`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:386`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailReaderTests.cs`.
  A source search across the workspace finds no application or UI consumer of the interface today: it
  is a shipped read surface that hosts can inject, not a wired-up screen.
- **Caveats / not-in-source**: the class documents its own v1 limitation
  (`AuditTrailReader.cs:16-25`). Trail rows are written to whichever database holds the entity that
  changed (that is what makes the write atomic), so a host that splits its modules across several
  databases has several trail tables, and this reader queries exactly one of them: the `Default`
  database of the configured engine. For a monolith, where every source collapses onto `Default`, that
  is the whole trail. Reading another module's history would need a per-source overload, which the
  comment says was deliberately deferred rather than guessed at.

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
  Patterns]` (Unit of Work plus Repository) and `[Rubric §8, Data Architecture]` (transactions and
  change-tracker scoping): a handler never knows which database an entity lives in. `GetRepository`
  resolves the entity's physical source, obtains the matching context, and builds a repository bound
  to it; caching that repository per scope guarantees one change tracker per database, which is what
  makes "load aggregate, mutate, one save" correct.
- **Walkthrough**:
  - **Primary constructor** (`UnitOfWork.cs:13-16`): takes the context factory, the data-source
    service, and the repository factory, null-guarding the context factory and the repository factory
    into readonly fields (the data-source service is used directly from the primary-constructor
    parameter).
  - **`_repositories`** (`UnitOfWork.cs:23`): a `Dictionary<Type, object>` keyed by the closed generic
    repository interface (for example `IRepository<Order, int>`), so a repository is created at most
    once per entity type per scope.
  - **`GetRepository<TEntity, TIdentifierType>()`** (`UnitOfWork.cs:33-46`): on a cache miss, resolves
    the entity's [`DataSourceKey`](#datasourcekey) via
    `dataSourceService.GetDataSourceKey(typeof(TEntity))` (`UnitOfWork.cs:40`), asks the context
    factory for the matching context, and builds a read-write repository through
    [`IRepositoryFactory`](#irepositoryfactory); constrained to
    `AuditableAggregateRootEntity<TIdentifierType>` so only aggregate roots get a mutable repository.
  - **`GetReadRepository<TEntity, TIdentifierType>()`** (`UnitOfWork.cs:53-66`): the same resolution
    but calls `CreateReadOnly` and accepts any `AuditableBaseEntity<TIdentifierType>`, for query
    handlers.
  - **Save and transaction methods** (`UnitOfWork.cs:69-91`): `SaveChangesAsync`, `Save`,
    `RequestIdentityInsert`, `BeginTransaction`, `CommitTransaction`, `RollbackTransaction`, and
    `ExecuteInTransactionAsync` all delegate straight to the context factory, because in a
    multi-database scope the factory is what coordinates saving and transacting across every context
    the scope touched.
  - **Disposal** (`UnitOfWork.cs:93-119`): implements both `Dispose` and `DisposeAsync` over a
    `volatile bool _disposed` flag (`UnitOfWork.cs:25`), disposing the context factory exactly once
    and suppressing finalization on both paths.
- **Why it's built this way**: the unit of work plus the factory hide the physical topology from
  handlers ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), and
  per-scope repository caching guarantees a single change tracker per database. It is `internal
  sealed` because consumers only ever see the [`IUnitOfWork`](#iunitofwork) abstraction (dependency
  inversion).
- **Where it's used**: injected into virtually every command and query handler in Common and in both
  apps, and into the module seeders.

### DetectChangesScope
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:223` · Level 0 · struct (private readonly, nested)

- **What it is**: a two-field disposable struct nested inside
  [`ApplicationDbContext`](#applicationdbcontext) whose only job is to put EF's
  `ChangeTracker.AutoDetectChangesEnabled` flag back the way it found it when a save finishes.
- **Depends on**: `Microsoft.EntityFrameworkCore.ChangeTracking.ChangeTracker` and `System.IDisposable`
  (both external/BCL); nothing first-party beyond its enclosing context class.
- **Concept introduced, the scoped-setting guard (restore-on-dispose).** `[Rubric §12, Performance &
  Scalability]` (assesses whether hot paths avoid repeated O(n) work) and `[Rubric §15, Best Practices
  & Code Quality]` (assesses whether temporary global-state mutation is bounded rather than leaked).
  EF's `ChangeTracker.Entries<T>()` runs a full `DetectChanges` pass on every call and memoizes
  nothing. Interceptors scan the tracker during `SavingChanges` and EF then detects once more on its
  own before building the save, so a single save paid three `O(tracked entities x properties)`
  snapshot comparisons where one suffices (`ApplicationDbContext.cs:196-203`). Turning detection off
  for the duration of the save is the optimization; a `using`-scoped struct is what makes turning it
  back on unforgettable, including on the exception path.
- **Walkthrough**: the primary constructor `DetectChangesScope(ChangeTracker changeTracker, bool
  previousSetting)` (`ApplicationDbContext.cs:223`) captures the tracker and the flag value that was in
  force before suppression. `Dispose()` (`ApplicationDbContext.cs:225`) is a single expression-bodied
  assignment that writes `previousSetting` back onto `changeTracker.AutoDetectChangesEnabled`. It is
  created only by `DetectChangesOnce()` (`ApplicationDbContext.cs:213-221`), which reads the current
  setting (`:215`), calls `ChangeTracker.DetectChanges()` once when detection was on (`:216-217`),
  sets the flag to `false` (`:219`), and hands back the scope (`:220`).
- **Why it's built this way**: `readonly struct` means no heap allocation on a path that runs on every
  save, and `private` keeps the mechanism invisible to callers. Restoring the *previous* value rather
  than hardcoding `true` is the load-bearing detail: a caller that had deliberately disabled
  auto-detect keeps its choice and never gets an unexpected detection pass on the way out
  (`ApplicationDbContext.cs:208-211`). Suppressing the remaining passes is safe because everything the
  interceptors do afterwards bypasses detection anyway: the audit interceptor writes through
  `entry.Property(...).CurrentValue` (`AuditSaveChangesInterceptor.cs:48-57`) and the domain-event
  interceptor adds outbox rows through `Add`, both of which take effect on the entry immediately.
- **Where it's used**: both save overrides that EF funnels through, `SaveChangesAsync(bool,
  CancellationToken)` (`ApplicationDbContext.cs:153-159`) and `SaveChanges(bool)`
  (`ApplicationDbContext.cs:186-190`), open one with `using var detection = DetectChangesOnce()`. The
  behavior is pinned by `SaveChangeDetectionTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/SaveChangeDetectionTests.cs:31`,
  `:47`, `:64`, `:78`, `:90`), which asserts detection runs exactly once, that an untracked property
  edit still persists, that audit stamps still land, that a caller's explicit `false` survives the
  save, and that a default context is left with detection enabled for the next caller.
- **Caveats / not-in-source**: the remarks name **two** tracker-scanning interceptors
  ([`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor) at
  `AuditSaveChangesInterceptor.cs:43` and
  [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) at
  `DomainEventSaveChangesInterceptor.cs:198`), which are the two that are always registered. Two
  optional interceptors enumerate the tracker as well when a host opts into them
  ([`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor) at
  `TenantSaveChangesInterceptor.cs:74` and
  [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor) at
  `AuditTrailSaveChangesInterceptor.cs:197`), so the suppression saves strictly more than the comment
  claims; the comment is narrower than the code, not wrong about the mechanism.

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
  (`ApplicationDbContext.cs:629-635`), which passes the engine's configuration interface (for example
  [`IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlservertentity-tidentifiertype))
  and a filter that matches each entity's registry-resolved [`DataSourceKey`](#datasourcekey).

### ValReturn<T>
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:105` · Level 0 · class (internal sealed, nested)

- **What it is**: a keyless container class, nested in [`ApplicationDbContext`](#applicationdbcontext),
  used to materialize a scalar SQL result (a `bool`, `int`, `DateTime`, or `string`) from a raw query
  without a backing table.
- **Depends on**: `Microsoft.EntityFrameworkCore` and its host
  [`ApplicationDbContext`](#applicationdbcontext), which registers it as a keyless entity type.
- **Concept introduced, keyless entity types for raw scalar queries.** `[Rubric §8, Data
  Architecture]` (assesses whether persistence mechanics are deliberate): EF Core's `FromSql`-style
  scalar materialization needs a CLR class to project into. Rather than one ad-hoc class per scalar
  shape, `ValReturn<T>` is a single generic holder with one `Value` property that any raw query can
  select into as `SELECT ... AS Value`.
- **Walkthrough**: one mutable property, `T Value { get; set; } = default!`
  (`ApplicationDbContext.cs:108`). [`ApplicationDbContext.OnModelCreating`](#applicationdbcontext)
  registers four closed forms as keyless views with `HasNoKey().ToView(null)`
  (`ApplicationDbContext.cs:311-314`), so they map to no table and exist only to shape raw-query
  output. [`CosmosDbContext`](#cosmosdbcontext) deliberately skips `base.OnModelCreating` partly
  because of this registration (`CosmosDbContext.cs:89-93`).
- **Why it's built this way**: `internal sealed` keeps it a persistence-layer detail; the generic
  parameter avoids a proliferation of single-property result classes. `ToView(null)` marks the type as
  query-only with no schema object behind it.
- **Where it's used**: registered by [`ApplicationDbContext`](#applicationdbcontext). The four closed
  forms are baked into every generated migration model snapshot (for example
  `MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/Migrations/SQLServerDbContextModelSnapshot.cs:86`,
  `:96`, `:106`, `:116`, which emit `ApplicationDbContext+ValReturn<System.DateTime>`, `<bool>`,
  `<int>` and `<string>`), which is how you can see them without a table.
- **Caveats / not-in-source**: only the four closed forms registered in `OnModelCreating` are usable; a
  fifth scalar type would need its own `HasNoKey().ToView(null)` registration. A source search across
  the workspace finds `ValReturn` only in generated migration snapshots and designer files, with no
  first-party call site that projects into it today: it is a provided extension point for raw scalar
  SQL, not a currently exercised path.

### ApplicationDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:39` · Level 6 · class (abstract)

- **What it is**: the single abstract `DbContext` base that every engine-specific context
  ([`SQLServerDbContext`](#sqlserverdbcontext), [`CosmosDbContext`](#cosmosdbcontext),
  [`SqliteDbContext`](#sqlitedbcontext)) inherits. One instance exists per **physical database**: the
  same class is instantiated multiple times, each carrying a different
  [`PhysicalDataSource`](#physicaldatasource) and building a model that contains only that database's
  entities (`ApplicationDbContext.cs:28-33`).
- **Depends on**: [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor),
  [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor),
  [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor),
  [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor),
  [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory),
  [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention),
  [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention),
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider),
  [`PhysicalDataSource`](#physicaldatasource), [`DataSourceKey`](#datasourcekey),
  [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity),
  [`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity),
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage),
  [`InboxMessage`](group-04-events-outbox.md#inboxmessage),
  [`ScheduledJobEntry`](group-14-module-system-composition.md#scheduledjobentry),
  [`AuditTrailEntry`](#audittrailentry),
  [`SchedulerSettings`](group-14-module-system-composition.md#schedulersettings) and
  [`AuditTrailSettings`](group-14-module-system-composition.md#audittrailsettings) via `IOptions<>`,
  MiniProfiler, and EF Core.
- **Concept introduced, DbContext as Unit of Work + Change Tracker.** `[Rubric §8, Data Architecture]`
  (assesses transactions, migrations, soft-delete, audit, concurrency): EF's `DbContext` is the unit of
  work, tracking every `Added`/`Modified`/`Deleted` entity since the last save and writing them in a
  single transaction. This is also `[Rubric §3, Clean Architecture]` (the EF detail stays in
  Infrastructure; domain entities carry no EF attributes) and `[Rubric §6, CQRS & Event-Driven]`
  (domain events are captured transactionally with the aggregate write). The interceptors registered in
  `OnConfiguring` run around `base.SaveChangesAsync` to stamp audit fields, stamp and guard the tenant,
  serialize domain events into the outbox, and diff the change trail, so those cross-cutting concerns
  live in the interceptor pipeline rather than inline in every handler.
- **Concept introduced, named global query filters.** `[Rubric §11, Security]` and `[Rubric §30,
  Compliance, Privacy & Data Governance]` (both assess whether isolation of other parties' data is
  structural rather than per-query discipline): this class declares two filters by name, `SoftDelete`
  (`ApplicationDbContext.cs:357`) and `Tenant` (`:360`). EF composes named filters with AND, so a
  tenant-owned soft-deletable entity is filtered on both without either filter knowing about the other,
  and a caller asking to see deleted rows drops exactly `SoftDelete` and leaves `Tenant` in force
  (`:352-357`, `:374-379`). Isolation therefore cannot be forgotten at a call site.
- **Walkthrough**:
  - **Primary constructor** (`ApplicationDbContext.cs:39-44`): takes `DbContextOptions`, an
    `IServiceProvider`, an
    [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), and the
    [`PhysicalDataSource`](#physicaldatasource) this instance targets, delegating to
    `DbContext(options)`.
  - **`DataSourceKey`** (`:47`): exposes the `(engine, database name)` pair this context serves;
    **`PhysicalSource`** (`:77`) exposes the resolved connection info to subclasses as `internal`.
  - **`TenantIdAccessor`** (`:92`) and **`CurrentTenantId`** (`:99`): an `internal Func<string?>?`
    assigned by the scoped [`DbContextFactory`](#dbcontextfactory) at context creation
    (`DbContextFactory.cs:104`, `:139`), and the public property that invokes it. The remarks
    (`:85-91`) explain why it is an accessor and not a copied value: a context can be created before
    the request's tenant is resolved, and a copy taken at that moment would pin the context to the
    wrong answer for its whole life. `null` reads as "no tenant", which makes the `Tenant` filter inert
    for background services, seeders and admin flows.
  - **Model-gate fields** (`:61`, `:74`): `_schedulerTableEnabled` and `_auditTrailTableEnabled`, both
    resolved in `OnConfiguring` and read by the model-building methods. Their remarks state the rule
    that keeps them correct: `OnModelCreating` must not depend on anything the model cache key does not
    cover, so the settings lookups happen once, up front, in the same place the interceptors are
    resolved.
  - **`ValReturn<T>`** (`:105`): the nested keyless scalar holder, documented in its own section above.
  - **`SupportsOutbox`** (`:116`): `internal virtual`, `true` by default; the Cosmos subclass overrides
    it to `false`. Read by
    [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
    (`DomainEventSaveChangesInterceptor.cs:110`, `:213`).
  - **`CurrentSaveUserId`** (`:123`): `internal` audit user id with a private setter, written by the
    save overloads and read by [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor); `null`
    marks a system operation and the interceptor resolves it to `default`
    (`AuditSaveChangesInterceptor.cs:41`).
  - **`SaveChangesAsync(userId, ct)`** (`:133-147`): the mutation entry point. Opens a MiniProfiler step
    (`:135`), sets `CurrentSaveUserId`, calls `base.SaveChangesAsync`, and clears the id again in a
    `finally` (`:141-146`) so a later plain `base.SaveChangesAsync` on the same instance (an internal
    outbox write, for example) cannot silently reuse the previous caller's identity for its stamps.
  - **`SaveChanges(userId)`** (`:169-180`): the synchronous counterpart with the same set/reset
    discipline. Its doc comment records the behavioral difference (`:161-166`): the sync path cannot
    dispatch events in-process, so captured events are delivered by the outbox processor instead.
  - **Change-detection overrides** (`:153-159`, `:186-190`): both EF save overloads wrap the base call
    in `using var detection = DetectChangesOnce()`, the optimization taught under
    [`DetectChangesScope`](#detectchangesscope).
  - **`OnConfiguring`** (`:229-279`): resolves the two always-present interceptors from DI (`:236-237`)
    and adds them, inserting [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor)
    **between** them when it is registered (`:244-251`). Registration order is execution order, and the
    comment (`:239-243`) states why the tenant interceptor belongs in the middle: after the audit stamps
    (it must not run against half-stamped entries) and before the domain-event interceptor serializes
    outbox rows, so those rows describe an entity whose tenant is already final.
    [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor) is appended last when
    present (`:258-261`), because it diffs the final values. Both optional interceptors are fetched with
    `GetService`, not `GetRequiredService`: a host that never opted in, a design-time context, or a
    directly constructed test context must still build. The method then resolves the two model gates
    (`:266-271`) and replaces EF's `IModelCacheKeyFactory` with
    [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory) (`:276`) so each database gets
    its own model.
  - **`ConfigureConventions`** (`:282-297`): adds two model-finalization conventions.
    [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) (`:291`) strips FK
    constraints and navigations between entities in different physical databases (a structural no-op in
    the collapsed-monolith case), and
    [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) (`:296`) makes unique indexes
    on soft-deletable entities exclude deleted rows, so a soft-deleted row does not block re-creating
    the "same" record.
  - **`Set<TEntity>()`** (`:299-301`): a public override that forwards straight to `base.Set<TEntity>()`
    and adds no behavior of its own.
  - **`OnModelCreating`** (`:304-327`): applies soft-delete filters, tenant filters and concurrency
    tokens, registers the four keyless `ValReturn<T>` views (`:311-314`), then configures the outbox,
    the inbox, the scheduler table and the audit-trail table.
  - **`ApplySoftDeleteFilters`** (`:336-350`): `protected static`; iterates every non-owned
    `IAuditableEntity` type and builds an expression-tree
    `HasQueryFilter("SoftDelete", e => e.IsDeleted == false)` (`:342-348`). Expression trees are
    required because the CLR type is only known at runtime; owned types are excluded because they
    inherit the parent filter. `[Rubric §5, Vertical Slice]` (a global filter removes per-query
    `Where(!IsDeleted)` boilerplate from every slice).
  - **`ApplyTenantFilters`** (`:394-443`): `protected` (instance, because the filter body reads this
    context). For every non-owned [`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity)
    it configures the discriminator column as required, capped at `TenantIdMaxLength` of 64 (`:366`)
    and non-Unicode (`:411-414`), adds an index on it for every engine except Cosmos (`:419-422`,
    because every tenant-scoped read carries `TenantId = @tenant` as its leading predicate and Cosmos
    indexes every property itself), and builds
    `HasQueryFilter("Tenant", e => CurrentTenantId == null || EF.Property<string>(e, "TenantId") ==
    CurrentTenantId)` (`:424-441`). Two mechanisms are worth internalizing here. The filter embeds
    **this context** as a constant typed as `ApplicationDbContext` (`:401`), which EF rewrites to the
    executing context at query compile time and lifts `CurrentTenantId` into a SQL parameter, so two
    scopes on two tenants share one compiled model and still read disjoint rows. And it reads the
    column through `EF.Property` rather than a CLR member access (`:428-433`), which works for an
    explicitly implemented interface member and for a shadow property alike.
  - **`ConfigureConcurrencyTokens`** (`:456-476`): `protected` (instance, because it reads
    `Database.ProviderName` at `:459`). It applies `IsRowVersion()` on SQL Server (database-generated
    `rowversion`) or `IsConcurrencyToken()` elsewhere (application-managed) to the `RowVersion` property
    of every non-owned auditable entity. EF then includes the token in `UPDATE`/`DELETE` `WHERE` clauses
    and throws `DbUpdateConcurrencyException` on conflicts. `[Rubric §8, Data Architecture]`.
  - **`ConfigureOutbox`** (`:483-507`): maps `OutboxMessages` in `dbo` with length/unicode constraints,
    plus two purpose-built filtered indexes. `IX_OutboxMessages_Pending` covers the poll path over
    `(ProcessedOn, OccurredOn)` filtered to `[ProcessedOn] IS NULL` and includes `RetryCount` and
    `LockedUntil` so the processor's extra predicates do not force a key lookup per candidate row
    (`:496-499`); `IX_OutboxMessages_Processed` covers the retention sweep over rows the pending index
    deliberately excludes (`:504-506`). `[Rubric §12, Performance & Scalability]`.
  - **`ConfigureInbox`** (`:514-528`): maps `InboxMessages` in `dbo` with a unique
    `IX_InboxMessages_MessageId` (the consumer-side idempotency key, `:520-522`) and an
    `IX_InboxMessages_ProcessedOn` index so the age-based purge has something to seek (`:526-527`).
  - **`ConfigureScheduler`** (`:538-563`): the first **gated** table. It returns immediately unless
    `_schedulerTableEnabled` (`:540-543`), then maps
    [`ScheduledJobEntry`](group-14-module-system-composition.md#scheduledjobentry) to `ScheduledJobs` in
    `dbo` keyed by `JobName`, with `IX_ScheduledJobs_NextRunOn` including the lease columns
    (`:559-561`). The index comment (`:554-558`) records the load-bearing decision: it is deliberately
    **not** filtered to unlocked rows, because the poll must also find rows whose lease has expired,
    which is how a dead replica's work is reclaimed.
  - **`ConfigureAuditTrail`** (`:572-601`): the second gated table, mapping
    [`AuditTrailEntry`](#audittrailentry) to `AuditTrailEntries` in `dbo` with a read index over
    `(EntityType, EntityKey, ChangedOn)` (`:592-593`) and a retention index over `ChangedOn`
    (`:598-599`). Note the asymmetry with the scheduler, stated at `:63-72` and `:565-571`: the job
    table is host-scoped and lives in the `Default` source only, while the trail table belongs in
    **every** relational source, because a trail row must commit in the same transaction as the change
    it describes and a transaction does not span databases (the outbox precedent).
  - **`ApplyConfigurationsForEntitiesInContext`** (`:610-637`): the discovery method subclasses call
    from their `OnModelCreating`. It maps the engine to its configuration interface (`:612-618`),
    resolves [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`:625`), then for each assembly
    from the provider calls
    [`ModelBuilderExtensions.ApplyAllConfigurations`](#modelbuilderextensions) with a filter that keeps
    only entities whose registry-resolved key equals this `DataSourceKey`, or, for unregistered
    entities, only when this context is the engine's `Default` source (`:629-635`).
- **Why it's built this way**:
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (database-per-service)
  requires the same context class per database; without a specialized model-cache key EF would build
  one model and silently reuse it, so queries would hit tables that do not exist in the other
  databases. The single `ApplicationDbContext` is deliberately never split into per-module context
  classes (also ADR-006). The interceptor pipeline keeps audit, tenancy and outbox concerns out of
  every handler ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) for the
  tenancy model, [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) for the trail,
  [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) for the job store).
  The two optional tables are settings-gated rather than always mapped so a host that never opted in
  keeps the exact model it had before those features shipped, and its migrations never see the tables.
  The comment at `:620-624` records one more deliberate fallback: an entity configured without the
  attributed base classes lands in the `Default` model but is not routable through the unit of work.
- **Where it's used**: inherited by the three concrete contexts below; created per source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) (`PhysicalDbContextFactory.cs:43-45`), cached
  per scope and given its tenant accessor by [`DbContextFactory`](#dbcontextfactory)
  (`DbContextFactory.cs:104`), and consumed by the interceptors and the outbox processor. The model
  gates are pinned by `SchedulerModelGateTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:29`,
  `:38`, `:48`, `:59`) and `AuditTrailModelGateTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailModelGateTests.cs:30`,
  `:39`, `:49`, `:63`); the tenant filter by `ApplicationDbContextTenantFilterTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/ApplicationDbContextTenantFilterTests.cs:26`,
  `:40`, `:58`, `:73`, `:95`, `:115`, `:142`, `:155`, `:180`), which covers cross-tenant hiding,
  composition with soft delete, the null-tenant escape, two tenants sharing one cached model, the live
  accessor being read at query time, and the column's shape and index.

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
  (`DataSourceModelCacheKeyFactory.cs:11-14`): without it, queries would target tables that do not
  exist in the other databases. This is the critical enabler for
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html).
- **Walkthrough**: `Create(DbContext context, bool designTime)`
  (`DataSourceModelCacheKeyFactory.cs:19-22`) returns
  `(context.GetType(), applicationDbContext.DataSourceKey.Name, designTime)` when the context is an
  [`ApplicationDbContext`](#applicationdbcontext), otherwise falls back to
  `(context.GetType(), designTime)`. The value tuple's structural equality is all EF needs to key its
  cache dictionary.
- **Why it's built this way**: the fix is minimal and lives entirely in Infrastructure through EF's
  supported extension point; no EF internals are subverted. Note what is deliberately **absent** from
  the key: the tenant. One compiled model serves every tenant, and the tenant value enters as a SQL
  parameter through the `Tenant` query filter instead (see
  [`ApplicationDbContext.ApplyTenantFilters`](#applicationdbcontext) and its remarks at
  `ApplicationDbContext.cs:380-386`), which is what keeps a multi-tenant host from building one model
  per tenant.
- **Where it's used**: registered in [`ApplicationDbContext.OnConfiguring`](#applicationdbcontext) via
  `optionsBuilder.ReplaceService<IModelCacheKeyFactory, DataSourceModelCacheKeyFactory>()`
  (`ApplicationDbContext.cs:276`), so every engine context inherits it.

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
    emulator account-key prefix `"C2y6yDjf5"` (`:29`). The emulator path uses `ConnectionMode.Gateway`
    and an `HttpClientFactory` whose handler installs
    `DangerousAcceptAnyServerCertificateValidator` for the self-signed cert, guarded by a
    `#pragma warning disable S4830` and a comment that this is safe only in local dev (`:41-52`). The
    production path uses `ConnectionMode.Direct` with `MaxRequestsPerTcpConnection(20)` and
    `MaxTcpConnectionsPerEndpoint(32)` (`:57-59`). The database name comes from
    `PhysicalSource.CosmosDatabaseName` (`:34`).
  - **`SupportsOutbox => false`** (`CosmosDbContext.cs:69`): overrides the base; Cosmos has no
    relational outbox table, so domain events are dispatched in-process only.
  - **`OnModelCreating`** (`CosmosDbContext.cs:72-96`): applies the Cosmos configurations (`:74`), then
    `Ignore<OutboxMessage>()` (`:77`), then removes every index from every entity type (`:83-87`)
    because the provider does not support relational `HasIndex`/`HasFilter`, then calls
    `ApplySoftDeleteFilters` (`:94`) and `ApplyTenantFilters` (`:95`) directly. It deliberately does
    **not** call `base.OnModelCreating` (`:89-93`) because the base registers the keyless
    [`ValReturn<T>`](#valreturnt) views, a relational-only construct the Cosmos provider rejects.
    Skipping the base is also why the inbox, scheduler and audit-trail tables never reach this engine.
- **Why it's built this way**: pushing all provider differences into this subclass keeps the base and
  the entity configuration bodies engine-agnostic; stripping indexes lets one configuration body serve
  both SQL Server and Cosmos. Calling the two filter helpers directly rather than through the base is
  what keeps soft delete and tenancy in force on an engine that cannot run the rest of the base
  pipeline (the tenant helper skips only its index for Cosmos, `ApplicationDbContext.cs:419-422`).
- **Where it's used**: instantiated per Cosmos source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) when a data source resolves to the `CosmosDB`
  engine (`PhysicalDbContextFactory.cs:45`), and wrapped for EF's generic factory surface by
  [`DefaultCosmosDbContextFactory`](#defaultcosmosdbcontextfactory).
- **Caveats / not-in-source**: the certificate bypass is scoped by an ordinal substring match on the
  emulator key prefix; whether any production connection string could contain that substring is Not
  determinable from source. Per
  [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) the plumbing ships and is
  tested, but no host in this workspace configures a Cosmos source today.

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
  (`SqliteDbContext.cs:19-27`), with no retry policy (the store is file-local), no command-timeout
  override, and no migrations-assembly override. `OnModelCreating` calls
  `ApplyConfigurationsForEntitiesInContext(DataSource.Sqlite, modelBuilder)` then `base.OnModelCreating`
  (`SqliteDbContext.cs:29-33`), so unlike Cosmos it keeps the full base pipeline: soft-delete and tenant
  filters, concurrency tokens as application-managed tokens rather than `rowversion`, the outbox and
  inbox tables, the two settings-gated tables, and the [`ValReturn<T>`](#valreturnt) views. See
  [`SQLServerDbContext`](#sqlserverdbcontext) for the shared subclass shape.
- **Why it's built this way**: SQLite needs none of the SQL Server hardening (transient-failure retry,
  per-service migrations assembly), so the override is intentionally sparse. Keeping the full base
  pipeline is what makes this context a faithful stand-in for SQL Server in tests, which is how the
  framework's own tenancy and model-gate suites run without a database (for example
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/ApplicationDbContextTenantFilterTests.cs:14-23`,
  which holds one SQLite connection open for the fixture's lifetime). `[Rubric §14, Testability]`.
- **Where it's used**: instantiated per SQLite source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) when a data source resolves to the `Sqlite`
  engine (`PhysicalDbContextFactory.cs:44`), and wrapped for EF's generic factory surface by
  [`DefaultSqliteDbContextFactory`](#defaultsqlitedbcontextfactory).

### SQLServerDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:16` · Level 7 · class (sealed)

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting SQL
  Server, the production-primary context. One instance exists per physical SQL Server data source
  (database); its connection string and migrations assembly come from the resolved
  [`PhysicalDataSource`](#physicaldatasource).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](#physicaldatasource), [`DataSource`](#datasource),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider),
  [`PersistenceSettings`](group-14-module-system-composition.md#persistencesettings) via `IOptions<>`,
  and the SQL Server EF provider (`RelationalEventId`). `[Rubric §8, Data Architecture]` (one concrete
  context per engine, one instance per database) and `[Rubric §29, Resilience & Business Continuity]`
  (the retry policy and the command timeout are baked into the SQL Server path).
- **Walkthrough**:
  - **4-arg constructor** (`SQLServerDbContext.cs:16-21`): forwards to the base.
  - **`_persistenceSettings`** (`SQLServerDbContext.cs:36-37`): a readonly field resolved in the field
    initializer as `serviceProvider.GetService<IOptions<PersistenceSettings>>()?.Value ?? new
    PersistenceSettings()`. Two details are deliberate and documented at `:23-35`. It is resolved once
    per instance rather than read from the primary-constructor parameter inside `OnConfiguring`, because
    referencing that parameter from a member body would capture it into the type's state while the base
    constructor also receives it (CS9107); caching per instance is safe precisely because these contexts
    are never pooled. And it uses `GetService`, not `GetRequiredService`, because the design-time
    provider behind `dotnet ef` registers no options at all and must not be made to throw: both a
    missing registration and a null value fall back to the defaults.
  - **`OnConfiguring`** (`SQLServerDbContext.cs:40-83`): calls
    `UseSqlServer(PhysicalSource.ConnectionString, sql => ...)`. The options action does three things:
    conditionally sets `sql.MigrationsAssembly(PhysicalSource.SqlServerMigrationsAssembly)` (`:49-52`)
    so each extracted service can point at its own per-module migrations project; applies
    `sql.CommandTimeout(_persistenceSettings.CommandTimeoutSeconds)` (`:56`), because without it every
    command silently inherits ADO.NET's 30 second default with no way to tune it per environment (the
    setting's own default is `30`, range-validated to 1-600, at
    `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/PersistenceSettings.cs:21-22`); and
    enables `sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10),
    errorNumbersToAdd: null)` (`:64-67`). An inline comment (`:61-63`) records the retry caveat: with
    retry enabled, any manual `BeginTransactionAsync` must be wrapped in
    `Database.CreateExecutionStrategy().ExecuteAsync`, which
    [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult)
    already does. Finally
    `ConfigureWarnings(w => w.Ignore(RelationalEventId.PendingModelChangesWarning))` (`:80`) suppresses
    EF Core's pending-model error.
  - **`OnModelCreating`** (`SQLServerDbContext.cs:86-90`): calls
    `ApplyConfigurationsForEntitiesInContext(DataSource.SQLServer, modelBuilder)` then
    `base.OnModelCreating`, so the full base pipeline (soft-delete and tenant filters, `rowversion`
    concurrency tokens, outbox/inbox tables, the settings-gated scheduler and audit-trail tables, and
    the [`ValReturn<T>`](#valreturnt) views) runs.
- **Why it's built this way**: the `PendingModelChangesWarning` suppression is required by the
  microservices-extraction design: each extracted host registers only its enabled modules'
  configurations, so its runtime model is a strict subset of the migration snapshot (the union of all
  modules), and EF Core 9+ would otherwise promote that mismatch to an error inside
  `Migrator.ValidateMigrations` during `MigrateAsync` (`SQLServerDbContext.cs:69-75`). The documented
  trade-off (`:77-79`): monolith hosts lose the "you forgot a migration" safety net, so CI should run
  `dotnet ef migrations has-pending-model-changes` against the migrations assembly with the full model
  loaded as a separate gate. Retry-on-failure exists so cold-replica startup connections and platform
  replica replacements do not surface as user-facing 5xx
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html),
  [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)).
- **Where it's used**: instantiated per SQL Server source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) (`PhysicalDbContextFactory.cs:43`) and wrapped
  by [`DefaultSqlServerDbContextFactory`](#defaultsqlserverdbcontextfactory); built at design time by
  [`DesignTimeDbContextHelper`](#designtimedbcontexthelper)`.CreateSqlServer`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:45`),
  which is what makes one migrations project per database possible. It is the primary production
  context in both MMCA.ADC and MMCA.Store, and the context type every committed migration snapshot is
  generated against.
- **Caveats / not-in-source**: whether any repository's CI actually runs the
  `has-pending-model-changes` gate the comment recommends is Not determinable from this file.

### EncryptedStringConverter
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Encryption` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:42` · Level 0 · class (sealed)

- **What it is**: an EF Core `ValueConverter<string, string>` that encrypts a string property with
  AES-256-GCM on the way to the database and decrypts it on the way back, transparently to the entity
  (`EncryptedStringConverter.cs:7-10`). It is applied per property in an entity configuration, not
  globally.
- **Depends on**: `System.Security.Cryptography` (`AesGcm`, `RandomNumberGenerator`,
  `CryptographicException`), `System.Text.Encoding`, and EF Core's `ValueConverter<TModel, TProvider>`.
  No first-party type.
- **Concept introduced, authenticated encryption at rest, and what it costs you.** `[Rubric §11,
  Security]` (assesses whether sensitive data is protected in transit and at rest with sound primitives)
  and `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether personal data is
  classified and handled deliberately). AES-GCM is an *authenticated* mode: it gives confidentiality
  and integrity in one pass, so tampering with a stored value makes decryption throw instead of
  silently yielding garbage, and no separate HMAC step is needed. The price is stated at length in the
  class comment (`:18-31`) and is the part worth internalizing: every write draws a fresh random nonce,
  so the same plaintext produces a different column value each time. A non-deterministic column cannot
  carry an equality or range predicate (the comparison is against a ciphertext that never matches, and
  the query returns no rows rather than failing), cannot carry a unique index, and cannot be sorted or
  grouped server side. Anything that must stay searchable needs a second, deterministic surface such as
  a keyed hash beside the encrypted column. This is the counterpart to the erasure story taught by
  [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) and
  [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute)
  ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)): erasure overwrites
  a field you never need again, encryption protects one you still have to read back.
- **Walkthrough**:
  - **Sizes** (`EncryptedStringConverter.cs:45`, `:48`): `NonceSize = 12` bytes (96 bits, the NIST
    recommendation for GCM) and `TagSize = 16` bytes (128 bits).
  - **Constructor** (`:54-66`): passes the two lambdas up to `ValueConverter`, `Encrypt` as the
    to-provider direction and `Decrypt` as the from-provider direction (`:56-57`), then null-guards the
    key and rejects anything that is not exactly 32 bytes with a message naming the length it got
    (`:59-65`). The key is captured by the lambdas, so one converter instance is bound to one key.
  - **`GenerateKey()`** (`:72`): `RandomNumberGenerator.GetBytes(32)`, the convenience path for
    producing a valid key during setup.
  - **`Encrypt`** (`:74-94`): empty and null pass through unchanged (`:76-77`), otherwise UTF-8 encode,
    draw a 12-byte nonce, encrypt into a same-length ciphertext buffer with a 16-byte tag
    (`:79-85`), and concatenate `nonce + ciphertext + tag` into one Base64 string (`:87-93`). Storing
    the nonce alongside the ciphertext is what makes each row self-describing: no side table of nonces
    is needed.
  - **`Decrypt`** (`:96-117`): Base64 decode, reject anything shorter than nonce plus tag with a
    `CryptographicException` (`:103-104`), then slice the three regions by fixed offsets and decrypt
    (`:106-116`). A wrong key or a tampered byte fails inside `AesGcm.Decrypt`, which is the integrity
    guarantee doing its job.
- **Why it's built this way**: GCM over CBC removes the "encrypt then MAC" bookkeeping that is easy to
  get wrong, and putting the whole scheme behind a `ValueConverter` means an entity property stays a
  plain `string` in the domain model.
  [ADR-037](https://ivanball.github.io/docs/adr/037-field-level-encryption-at-rest.html) records the
  decision and is explicit that this is a second layer above transparent database encryption: TDE
  decrypts for anyone who can query, this converter keeps the value ciphertext the moment it leaves the
  application. The key never lives in the converter's own configuration: the comment (`:32-36`) points
  at Key Vault, user-secrets, or environment variables.
- **Where it's used**: nowhere in application code today. A workspace-wide search of `*.cs` for the
  type finds only its own file, its unit tests
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EncryptedStringConverterTests.cs:6`,
  covering round trip, nonce randomness, key length at `:75`, the null-key guard at `:124`, empty
  input, short ciphertext, and Unicode), and one prose mention in the
  [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) doc comment
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:18`) recommending it for
  personal fields that must survive erasure in readable form. No entity configuration calls
  `HasConversion(new EncryptedStringConverter(...))` in any of the repos, and no DI registration
  supplies a key.
- **Caveats / not-in-source**: this is therefore a shipped but unadopted extension point, a posture
  [ADR-037](https://ivanball.github.io/docs/adr/037-field-level-encryption-at-rest.html) states
  outright. Read the searchability constraint before adopting it: the Identity `User` stores `Email` as
  a queried column (see [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser), whose
  existence check is an EF predicate on that column), so encrypting it with this converter would
  silently break that lookup rather than fail loudly.

### IDbSeeder
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IDbSeeder.cs:7` · Level 0 · interface

- **What it is**: the one-method contract for an Infrastructure-layer seeder, `Task
  SeedAsync(CancellationToken)` (`IDbSeeder.cs:13`). Implementations populate a module's tables with
  initial reference data at startup (`IDbSeeder.cs:3-5`).
- **Depends on**: nothing but the BCL `Task` and `CancellationToken`.
- **Concept introduced, two seeding contracts at two layers.** `[Rubric §3, Clean Architecture]`
  (assesses whether each concern sits in the layer that owns it, with dependencies pointing inward):
  the framework has two seeding interfaces and they are not competitors.
  [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) lives in Application, takes an
  `IServiceProvider`, and is the unit [`ModuleLoader`](group-14-module-system-composition.md#moduleloader)
  knows about; `IDbSeeder` lives in Infrastructure, takes nothing, and is the unit that actually writes
  rows. The apps compose them: the module seeder reads configuration, resolves what it needs, and calls
  the database seeder (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:32-35`).
  That keeps the configuration gate in the layer that can see `IConfiguration` and the row writing in
  the layer that can see the unit of work.
- **Walkthrough**: a single member. There is no `IsEnabled`, no ordering property, and no result type:
  a seeder either runs to completion or throws, and ordering comes from the caller.
- **Why it's built this way**: keeping the Infrastructure contract this thin is what lets the same
  seeder be invoked from a module seeder, from a test, or by hand, without dragging a service provider
  along.
- **Where it's used**: implemented once in the framework, by the abstract [`DbSeeder`](#dbseeder)
  (`DbSeeder.cs:7`); every concrete seeder in the apps derives from that class rather than from this
  interface directly.
- **Caveats / not-in-source**: nothing registers `IDbSeeder` in DI and nothing resolves it. Concrete
  seeders are constructed with `new` inside their module's
  [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) (for example
  `IdentityModuleSeeder.cs:34-35`), which
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) runs through `SeedAllAsync` at
  startup, after schema initialization
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:98`).
  There is no reflection-based discovery of `IDbSeeder` and no hosted service that drains a list of
  them.

### IdentityInsertGroup
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:410` · Level 0 · record (private sealed, nested)

- **What it is**: a three-member private record nested in [`DbContextFactory`](#dbcontextfactory),
  `(string Schema, string Table, List<EntityEntry> Entries)` (`DbContextFactory.cs:410`). It names one
  batch of pending inserts that all target the same table and all carry explicit identity values, which
  is exactly the unit SQL Server's `SET IDENTITY_INSERT` operates on.
- **Depends on**: EF Core's `EntityEntry`, and nothing else.
- **Concept introduced, importing rows that already have ids.** `[Rubric §8, Data Architecture]`
  (assesses whether persistence mechanics are deliberate): normally a database-generated identity
  column means the application never supplies the id. An import from an external system (ADC's
  Sessionize refresh) must preserve the source's ids, and SQL Server only allows that with
  `SET IDENTITY_INSERT <table> ON`, one table at a time per session (`DbContextFactory.cs:283-288`).
  Grouping the affected entries by table is what turns that constraint into a loop.
- **Walkthrough**:
  - **`GetIdentityInsertGroups`** (`DbContextFactory.cs:367-408`) builds the list: it walks the change
    tracker for `Added` entries (`:371-374`), skips anything without a single-property primary key
    (`:377-379`), keeps only properties whose SQL Server value-generation strategy is
    `IdentityColumn` (`:381-386`), and then skips entries whose id is still an EF **temporary** value
    (`:391-392`), since a temporary value means the application did not set one. Survivors are bucketed
    by `(schema, table)` with `"dbo"` as the schema fallback (`:394-407`).
  - **`SaveWithIdentityInsertAsync`** (`DbContextFactory.cs:289-361`) consumes the groups: with none it
    falls back to a plain save (`:295-296`); otherwise, per group, it flips every `Added` entry
    belonging to the **other** groups to `Unchanged` so this round's batch touches one table only
    (`:305-311`), runs `SET IDENTITY_INSERT [schema].[table] ON`, saves, and turns it `OFF` in a
    `finally` (`:329-342`), then restores the hidden entries' states in an outer `finally` (`:345-351`).
    Any remaining changes get a final ordinary save (`:355-358`).
  - **Capture exclusion** (`DbContextFactory.cs:319-321`, `:347`): before each round it calls
    [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)`.BeginCaptureExclusion`
    with exactly the hidden entities and ends the exclusion afterwards. The comment (`:313-318`)
    explains the bug this prevents: capture serializes an aggregate's events to the outbox and clears
    them, so without the exclusion a row written a round later would have published its event a round
    early. It names the hidden entries explicitly rather than filtering by state, because "skip every
    `Unchanged` aggregate" would also drop events legitimately raised on an already-saved aggregate,
    which is how the identity module publishes registration events.
- **Why it's built this way**: the whole dance is confined to the SQL Server path of one private
  method, guarded by an opt-in flag, so the normal save path pays nothing. The raw SQL is covered by a
  justified `CA2100` suppression (`DbContextFactory.cs:228-229`) and an `S2077` pragma (`:328`,
  `:343`), both stating that schema and table names come from EF model metadata rather than user input,
  and `SET IDENTITY_INSERT` cannot take a parameterized identifier.
- **Where it's used**: only inside [`DbContextFactory`](#dbcontextfactory), reached when a caller has
  invoked `RequestIdentityInsert()` (`:281`) before the save, which the save path reads and immediately
  clears (`:232-233`). The one first-party caller is ADC's Sessionize refresh, which signals the unit of
  work before saving imported entities
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:138`),
  through [`IUnitOfWork`](#iunitofwork)`.RequestIdentityInsert`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:76`).

### SeedAccount
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/SeedAccount.cs:17` · Level 0 · record (sealed)

- **What it is**: the five-member positional record describing one development or test account for
  [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser) to create:
  `(string Email, string Password, string Role, string? FirstName = null, string? LastName = null)`
  (`SeedAccount.cs:17-22`).
- **Depends on**: nothing. It is a pure data carrier with no framework types in its signature, which is
  what lets each app spell its own role vocabulary as a plain string.
- **Concept introduced**: none new. It is the parameter object of the template-method seeder taught in
  [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser); `[Rubric §11, Security]`
  applies only through the notice below.
- **Walkthrough**: the doc comments carry the contract for each member. `Email` is also the idempotency
  key, the value the "already seeded?" check compares against (`:12`). `Password` is plaintext and is
  hashed by the seeder before persistence (`:13`). `Role` is the role as the app's own vocabulary
  spells it (`:14`), so ADC passes `UserRole.Organizer` and Store passes its own admin role without the
  framework knowing either. `FirstName` and `LastName` are nullable because not every app's `User`
  carries them (`:15-16`).
- **Why it's built this way**: a record rather than a tuple gives the five values names at every call
  site, and positional construction keeps an account list readable as a literal array (see the app
  lists cited below).
- **Where it's used**: the abstract `Accounts` property of
  [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser)
  (`IdentityModuleDbSeederBase.cs:50`); supplied by ADC's
  [`IdentityModuleDbSeeder`](group-24-identity-module.md#identitymoduledbseeder) as three accounts
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:33-38`)
  and by Store's through a `StoreAccounts` array
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:27`,
  `:34`).
- **Caveats / not-in-source**: the record's own remarks (`SeedAccount.cs:6-11`) call the security
  property out: seed credentials are plaintext by construction, so an account list is development-only
  data that must be gated or replaced with environment-sourced secrets before a seeder runs in a
  deployed environment. Both apps' lists contain deliberately weak passwords.

### TransactionCommitAmbiguousException
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/TransactionCommitAmbiguousException.cs:22` · Level 0 · class (sealed)

- **What it is**: the exception [`DbContextFactory.ExecuteInTransactionAsync`](#dbcontextfactory)
  throws when the **commit phase** fails, meaning the transaction may or may not have become durable
  because a commit can fail after the database applied it but before the acknowledgement reached the
  client (`TransactionCommitAmbiguousException.cs:3-7`).
- **Depends on**: the BCL `Exception` only.
- **Concept introduced, an unknown outcome is a distinct failure mode.** `[Rubric §10, Cross-Cutting
  Concerns]` (resilience policies applied through a shared mechanism rather than per call) and
  `[Rubric §29, Resilience & Business Continuity]` (assesses whether failure modes are identified and
  handled deliberately): a generic failure would be wrong twice over. First, mechanically: SQL Server's
  `EnableRetryOnFailure` strategy (configured at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:64-67`
  with five retries and a 10 second ceiling) classifies most commit-phase errors (timeouts, dropped
  connections) as transient, and EF decides retriability by walking an exception's **whole** inner
  chain, so any wrapper carrying the transient error would still be retried, re-running every write of
  an operation whose commit may already be durable, including its outbox rows
  (`TransactionCommitAmbiguousException.cs:8-13`, `DbContextFactory.cs:535-538`). That is why the
  commit failure is returned rather than thrown from `RunTransactionalAttemptAsync` and `TryCommit`
  (`DbContextFactory.cs:548-552`, `:571-573`, `:614-626`) and only converted into this exception
  **past** the strategy (`DbContextFactory.cs:539-540`). Second, semantically: "it failed" and "nobody
  can say whether it failed" call for different recovery, so the type itself is the signal.
- **Walkthrough**:
  - **`DefaultMessage`** (`TransactionCommitAmbiguousException.cs:24-26`): states both halves, the
    unknown durability and the deliberate non-retry.
  - **Four constructors** (`:29-46`): the parameterless and `(string)` and `(string, Exception)`
    standard set, plus `(Exception innerException)` (`:45-46`), which pairs the provider's failure with
    the default message. Only that last one is constructed anywhere in the workspace today
    (`DbContextFactory.cs:540`); the tests assert the inner exception is the provider failure itself,
    the diagnostic payload rather than the reported failure mode
    (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:83-84`).
- **Why it's built this way, and what a caller does about it**: the exception's own doc comment assigns
  recovery to the caller (`TransactionCommitAmbiguousException.cs:15-20`). An API request marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) replays safely; whatever the
  transaction wrote to the outbox is delivered by the
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) if the commit did land
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)); and the deferred
  in-process dispatch is dropped, so no handler acts on state that may not exist
  (`DbContextFactory.cs:628-656`). With more than one physical source the ambiguity becomes a partial
  commit rather than an unknown one, since commits are sequential; the source comment records that a
  witness row would close this and that it is deliberately not built, because the single transactional
  source every host runs today needs none (`DbContextFactory.cs:492-499`).
- **Where it's used**: thrown at `DbContextFactory.cs:540`; pinned by
  `DbContextFactoryCommitAmbiguityTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:67`,
  `:94`, `:118`, `:138`), which drives a context whose execution strategy retries on **any** exception
  and asserts the operation runs exactly once, that nothing is dispatched in-process, that the
  transaction is abandoned, and, as a control, that a failure *inside* the operation is still retried.
- **Caveats / not-in-source**: nothing in the framework catches this type. Whether a host's exception
  middleware maps it to a specific HTTP status is Not determinable from source: no first-party handler
  references it outside the throw site and its tests.

### DbSeeder
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:7` · Level 1 · class (abstract)

- **What it is**: the abstract base every concrete database seeder derives from. It implements
  [`IDbSeeder`](#idbseeder) by re-declaring `SeedAsync` as abstract (`DbSeeder.cs:10`) and adds exactly
  one piece of shared machinery: a converter from an `int` seed id to whatever identifier type the
  module uses (`DbSeeder.cs:3-5`).
- **Depends on**: [`IDbSeeder`](#idbseeder), plus the BCL `Guid`, `BitConverter`, and `Span<byte>`.
- **Concept introduced, seed data across two identifier strategies.** `[Rubric §16, Maintainability]`
  (assesses whether shared mechanics live in one place rather than being restated per module): the
  identifier-type alias taught in the primer means one module's key is `int` and another's is `Guid`
  (ADC's `SpeakerIdentifierType` is a `Guid`, its `UserIdentifierType` is an `int`). Seed data,
  however, is naturally written with small readable literals: category 1, room 2. `GetId<T>(int)` is
  the bridge, so a seeder can write `GetId<SpeakerIdentifierType>(3)` and stay correct whichever alias
  the module picked.
- **Walkthrough**:
  - **`SeedAsync`** (`DbSeeder.cs:10`): abstract, `public`, no default behavior. The base deliberately
    does not template the seeding flow itself; that is
    [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser)'s job for the one flow that
    repeated across apps.
  - **`GetId<TIdentifier>(int id)`** (`DbSeeder.cs:20-39`): `protected static`, constrained to
    `notnull`. For `Guid` it writes the int's four bytes into the start of a zeroed 16-byte
    `stackalloc` span and constructs a `Guid` from it (`:23-31`), which is deterministic: the same seed
    integer always produces the same `Guid`, so re-running a seeder against an existing database
    matches the rows it wrote last time. For `int` it is a boxed pass-through (`:33-36`). Anything else
    throws `NotSupportedException` naming the type (`:38`).
- **Why it's built this way**: `protected static` keeps the helper out of the public surface (a seeder
  is not a general-purpose id converter) while still allowing every derived seeder to use it without an
  instance. Determinism, not uniqueness, is the property that matters: seeders must be idempotent
  across restarts, which is what production hosts rely on when they run the seeder on every boot
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:98`).
- **Where it's used**: the base of every module seeder in both apps, for example ADC's
  [`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:24`),
  Store's `CatalogModuleDbSeeder`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/DbContexts/Seeding/CatalogModuleDbSeeder.cs:15`)
  and `SalesModuleDbSeeder`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Persistence/DbContexts/Seeding/SalesModuleDbSeeder.cs:27`),
  and the framework's own [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser)
  (`IdentityModuleDbSeederBase.cs:40`). Pinned by `DbSeederTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbSeederTests.cs:9`, `:17`,
  `:27`, `:36`, `:45`), which assert the int pass-through, `Guid` determinism, distinctness across
  different ints, the unsupported-type throw, and that `SeedAsync` can be implemented.
- **Caveats / not-in-source**: the `Guid` mapping consumes only the first four of sixteen bytes, so the
  produced values are structurally recognizable rather than random. That is intentional for seed data
  and is not a source of production ids: entity ids come from the database or from
  [`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator).

### IDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IDbContextFactory.cs:10` · Level 7 · interface

- **What it is**: the framework's own context-factory contract, the scoped object that hands out one
  [`ApplicationDbContext`](#applicationdbcontext) per physical [`DataSourceKey`](#datasourcekey) and
  then coordinates saving, transactions, schema lifecycle, and disposal across every context a scope
  touched (`IDbContextFactory.cs:5-10`). It is deliberately **not** EF Core's
  `IDbContextFactory<TContext>`: the two names collide, which is why the DI registrations
  fully-qualify EF's generic version
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:97-103`) and why consumers
  that need both add a `using IDbContextFactory = ...DbContexts.Factory.IDbContextFactory;` alias
  (`InProcessEventBus.cs:7`, `BrokerEventBus.cs:7`, `EfInboxStore.cs:7`).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext), [`DataSourceKey`](#datasourcekey),
  [`DataSource`](#datasource), and the BCL `IDisposable` plus `IAsyncDisposable` it extends
  (`IDbContextFactory.cs:10`).
- **Concept introduced, addressing a context by physical source rather than by type.** `[Rubric §8,
  Data Architecture]` (assesses whether transaction boundaries and unit-of-work scope are deliberate,
  and whether per-service data isolation is real): EF's own factory answers "give me a context of type
  T". This one answers "give me the context for **this database**", which is the only question that
  makes sense once [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) splits
  storage along a `Name` axis and [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)
  adds an orthogonal `Engine` axis. The interface also owns the honest statement of what a
  multi-source save can and cannot promise, in the `ExecuteInTransactionAsync` doc comment
  (`IDbContextFactory.cs:64-73`): each physical source gets its own transaction, commits are
  sequential and best-effort, there is **no** two-phase commit, a failure mid-commit leaves earlier
  sources committed, and the outbox is the cross-source consistency mechanism.
- **Walkthrough**:
  - **`GetDbContext(DataSourceKey)`** (`IDbContextFactory.cs:16`): the primary accessor, documented to
    create the context if this scope does not already have one for that source.
  - **`GetDbContext(DataSource)`** (`IDbContextFactory.cs:23`): the convenience overload for the
    engine's `Default` physical source (the top-level connection strings), which is what keeps
    single-database call sites unchanged.
  - **`EnsureCreatedAsync`** (`:29`), **`MigrateAsync`** (`:85`), **`HasPendingMigrationsAsync`**
    (`:91`): schema lifecycle across every source the host uses. The contract states the asymmetry:
    `EnsureCreatedAsync` skips sources with no configured connection string (`:26-28`), while the two
    migration members cover SQL Server sources only, each with its own migrations assembly, and skip
    Cosmos and SQLite (`:81-90`).
  - **`SaveChangesAsync`** (`:34`) and **`SaveChanges`** (`:39`): save across all active contexts, the
    async overload documented as carrying audit stamping and domain-event dispatch.
  - **`RequestIdentityInsert`** (`:47`): a one-shot flag for the next save, documented as
    automatically cleared once the save completes.
  - **`BeginTransaction`** / **`CommitTransaction`** / **`RollbackTransaction`** (`:52`, `:57`, `:62`):
    applied to every active context that supports transactions.
  - **`ExecuteInTransactionAsync<TResult>`** (`:77-79`): the member handlers actually reach, running
    the operation under the active execution strategy so a retrying strategy retries the whole unit.
- **Why it's built this way**: the application layer already talks to
  [`IUnitOfWork`](#iunitofwork); this second interface exists so the physical-topology coordination
  (which databases, which transactions, which migrations) has a home that Infrastructure can implement
  and tests can mock, without leaking EF Core upward.
- **Where it's used**: registered scoped as [`DbContextFactory`](#dbcontextfactory)
  (`DependencyInjection.cs:92`). [`UnitOfWork`](#unitofwork) delegates its whole save and transaction
  surface to it (`UnitOfWork.cs:70-91`), the startup path resolves it to create, migrate, or verify
  databases
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:50`,
  `:77`, `:80`, `:196`, and per tenant at `:130-147`), and the background and messaging paths resolve
  it per scope to reach a specific source ([`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor)
  at `OutboxProcessor.cs:249`, `OutboxCleanupService.cs:103`, `EfInboxStore.cs:19`,
  `InProcessEventBus.cs:24`, `BrokerEventBus.cs:31`, `ScheduledJobRunner.cs:214`,
  `AuditTrailReader.cs:36`, and `AuditTrailCleanupJob.cs:49`).

### IPhysicalDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IPhysicalDbContextFactory.cs:15` · Level 7 · interface

- **What it is**: the contract for constructing a **raw** context for a given physical data source. Its
  doc comment states the split precisely: the engine selects the context class (SQL Server, Cosmos,
  SQLite) and the source name selects the database (connection string, migrations assembly, EF model),
  and contexts created here are neither scoped nor cached (`IPhysicalDbContextFactory.cs:6-13`).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext) as the return type,
  [`DataSourceKey`](#datasourcekey) as the addressing type, and
  [`PhysicalDataSource`](#physicaldatasource) on the second overload
  (`IPhysicalDbContextFactory.cs:22`, `:37`).
- **Concept introduced, construction split from lifetime.** `[Rubric §2, Design Patterns]` (assesses
  whether patterns are applied where they earn their keep): this is the Abstract Factory half of the
  pair. Deciding *which class to new up for which database* is a pure function of the key and needs no
  per-request state, so it lives in a singleton; deciding *how long a context lives, when it saves, and
  what transaction it is in* is per-request state and lives in the scoped
  [`IDbContextFactory`](#idbcontextfactory) layered on top (`IPhysicalDbContextFactory.cs:10-13`).
- **Walkthrough**: two members. `Create(DataSourceKey key)`
  (`IPhysicalDbContextFactory.cs:22`) returns a new instance targeting the database the resolver maps
  that key to. `Create(DataSourceKey key, PhysicalDataSource physicalDataSource)`
  (`IPhysicalDbContextFactory.cs:37`) is the database-per-tenant overload: the caller clones the
  resolved [`PhysicalDataSource`](#physicaldatasource) with the tenant's connection string and passes
  the **same** key, so EF's model cache still serves one compiled model per (context type, source name)
  across every tenant (`IPhysicalDbContextFactory.cs:24-35`).
- **Why it's built this way**: keeping the construction decision behind a two-method interface is what
  makes the scoped coordinator testable without a database (`[Rubric §14, Testability]`): the
  commit-ambiguity tests hand [`DbContextFactory`](#dbcontextfactory) a
  `Mock<IPhysicalDbContextFactory>` that returns a SQLite in-memory context
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:45-51`).
  The two-overload shape is also what keeps tenancy
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) a routing decision in
  the scoped layer rather than a second factory.
- **Where it's used**: registered singleton as [`PhysicalDbContextFactory`](#physicaldbcontextfactory)
  (`DependencyInjection.cs:93`); injected into [`DbContextFactory`](#dbcontextfactory)
  (`DbContextFactory.cs:40`, both overloads called at `:96-97`) and into the three Default-source
  adapters (`DefaultEngineDbContextFactories.cs:13`, `:22`, `:31`).

### ApplicationDbContextEFFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/ApplicationDbContextEFFactory.cs:14` · Level 8 · class (sealed)

- **What it is**: an adapter that implements **EF Core's** `IDbContextFactory<ApplicationDbContext>`
  for consumers that expect that standard surface. It reads the host's default engine from
  configuration and delegates to that engine's Default-source adapter
  (`ApplicationDbContextEFFactory.cs:8-13`).
- **Depends on**: `IServiceProvider` and `IConfiguration` (`ApplicationDbContextEFFactory.cs:24`),
  [`DataSource`](#datasource), and the three engine adapters it resolves at call time.
- **Walkthrough**:
  - **Constructor** (`ApplicationDbContextEFFactory.cs:24-31`): null-guards the service provider
    (`:26`), then reads the `DefaultDataSource` configuration key, falling back to `DataSource`, then
    to the literal `DataSource.SQLServer` when neither is present (`:29`). The value is parsed
    case-insensitively and falls back to SQL Server again when it does not parse (`:30`), so a typo in
    configuration degrades to the production engine rather than throwing at startup.
  - **`CreateDbContext()`** (`ApplicationDbContextEFFactory.cs:34-40`): switches on the cached engine
    and resolves EF's `IDbContextFactory<CosmosDbContext>`, `<SqliteDbContext>`, or
    `<SQLServerDbContext>` from the provider, calling `CreateDbContext()` on it (`:36-38`); an engine
    outside the three throws (`:39`).
- **Why it's built this way**: the framework's own [`IDbContextFactory`](#idbcontextfactory) is the
  multi-database router, but some code (and EF tooling conventions) wants the standard generic factory
  for "the application's context". Registering both, with a comment saying exactly that
  (`DependencyInjection.cs:101-102`), keeps the two surfaces from competing.
- **Where it's used**: registered scoped for EF's generic interface (`DependencyInjection.cs:103`) and
  exercised by `ApplicationDbContextEFFactoryTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextEFFactoryTests.cs:14-96`),
  which pins the null guard, the SQL Server default when configuration is absent or unparseable, the
  three delegation paths, and `DefaultDataSource` winning over `DataSource`.
- **Caveats / not-in-source**: no first-party consumer resolves
  `IDbContextFactory<ApplicationDbContext>` today. A workspace-wide search of `*.cs` finds only this
  class and its registration (`DependencyInjection.cs:103`), so the adapter is a shipped extension
  point for downstream code rather than something the current hosts depend on.

### DefaultCosmosDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:31` · Level 8 · class (internal sealed)

- **What it is**: the first of three three-line adapters that satisfy EF Core's
  `IDbContextFactory<TContext>` for the concrete engine context types. This one covers
  [`CosmosDbContext`](#cosmosdbcontext) (`DefaultEngineDbContextFactories.cs:30-37`); its siblings
  [`DefaultSqliteDbContextFactory`](#defaultsqlitedbcontextfactory) and
  [`DefaultSqlServerDbContextFactory`](#defaultsqlserverdbcontextfactory) are the same shape with a
  different engine.
- **Depends on**: [`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory) (primary-constructor
  parameter, `:31`), [`DataSourceKey`](#datasourcekey), [`DataSource`](#datasource), and
  [`CosmosDbContext`](#cosmosdbcontext).
- **Concept introduced, keeping a DI surface alive across a redesign.** `[Rubric §10, Cross-Cutting
  Concerns]` (assesses whether infrastructure concerns are centralized rather than duplicated): the
  file's header comment (`DefaultEngineDbContextFactories.cs:6-12`) says the three adapters exist to
  preserve EF's `IDbContextFactory<TContext>` DI surface **after** the move to per-physical-source
  instantiation, each returning a context for the engine's Default source so the pre-multi-database
  behavior is unchanged for consumers such as
  [`ApplicationDbContextEFFactory`](#applicationdbcontexteffactory) and health checks. The
  multi-database capability is therefore additive: nothing that already asked for "the" context had to
  change.
- **Walkthrough**: `CreateDbContext()` (`DefaultEngineDbContextFactories.cs:35-36`) calls
  `physicalFactory.Create(DataSourceKey.Default(DataSource.CosmosDB))` and casts the returned
  [`ApplicationDbContext`](#applicationdbcontext) down to `CosmosDbContext`. `DataSourceKey.Default` is
  the `(engine, "Default")` helper
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/DataSourceKey.cs:23`), and
  the cast is safe because the physical factory maps that engine to exactly this class
  (`PhysicalDbContextFactory.cs:45`).
- **Why it's built this way**: `internal sealed` and three lines each. The adapters carry no policy;
  all engine selection stays in [`PhysicalDbContextFactory`](#physicaldbcontextfactory).
- **Where it's used**: registered singleton for EF's generic interface (`DependencyInjection.cs:97`,
  with the intent comment at `:95-96`), and resolved by
  [`ApplicationDbContextEFFactory`](#applicationdbcontexteffactory) when the configured default engine
  is Cosmos DB (`ApplicationDbContextEFFactory.cs:36`).

### DefaultSqliteDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:22` · Level 8 · class (internal sealed)

- **What it is**: the SQLite sibling of
  [`DefaultCosmosDbContextFactory`](#defaultcosmosdbcontextfactory), satisfying EF Core's
  `IDbContextFactory<SqliteDbContext>` (`DefaultEngineDbContextFactories.cs:21-28`). The shared shape
  and rationale are taught in that section.
- **Depends on**: [`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory) (`:22`),
  [`DataSourceKey`](#datasourcekey), [`DataSource`](#datasource), and
  [`SqliteDbContext`](#sqlitedbcontext).
- **Walkthrough**: `CreateDbContext()` (`DefaultEngineDbContextFactories.cs:26-27`) returns
  `physicalFactory.Create(DataSourceKey.Default(DataSource.Sqlite))` cast to `SqliteDbContext`.
- **Where it's used**: registered singleton at `DependencyInjection.cs:98`; resolved by
  [`ApplicationDbContextEFFactory`](#applicationdbcontexteffactory) when the configured default engine
  is SQLite (`ApplicationDbContextEFFactory.cs:37`).

### DefaultSqlServerDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:13` · Level 8 · class (internal sealed)

- **What it is**: the SQL Server sibling of
  [`DefaultCosmosDbContextFactory`](#defaultcosmosdbcontextfactory), satisfying EF Core's
  `IDbContextFactory<SQLServerDbContext>` (`DefaultEngineDbContextFactories.cs:13-19`). It is the one
  of the three that a production host actually exercises, since SQL Server is the engine every host
  configures.
- **Depends on**: [`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory) (`:13`),
  [`DataSourceKey`](#datasourcekey), [`DataSource`](#datasource), and
  [`SQLServerDbContext`](#sqlserverdbcontext).
- **Walkthrough**: `CreateDbContext()` (`DefaultEngineDbContextFactories.cs:17-18`) returns
  `physicalFactory.Create(DataSourceKey.Default(DataSource.SQLServer))` cast to `SQLServerDbContext`.
  Note the "Default" in the name: the adapter reaches only the engine's Default physical source, so a
  consumer that needs a named per-module database must go through
  [`IDbContextFactory`](#idbcontextfactory) instead. It also takes the resolver's connection
  information, never a tenant override, so it is not a database-per-tenant entry point either.
- **Where it's used**: registered singleton at `DependencyInjection.cs:99`; resolved by
  [`ApplicationDbContextEFFactory`](#applicationdbcontexteffactory) when the configured default engine
  is SQL Server (`ApplicationDbContextEFFactory.cs:38`).

### PhysicalDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:16` · Level 8 · class (sealed)

- **What it is**: the singleton implementation of
  [`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory). It resolves the key's connection
  information through [`IDataSourceResolver`](#idatasourceresolver) (or accepts it from the caller) and
  constructs the matching engine context directly with `new` (`PhysicalDbContextFactory.cs:34-48`).
- **Depends on**: `IServiceProvider`, [`IDataSourceResolver`](#idatasourceresolver), and
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), all taken through a
  primary constructor (`PhysicalDbContextFactory.cs:16-19`), plus the three context classes
  [`SQLServerDbContext`](#sqlserverdbcontext), [`SqliteDbContext`](#sqlitedbcontext), and
  [`CosmosDbContext`](#cosmosdbcontext).
- **Concept introduced, the never-pool rule.** `[Rubric §8, Data Architecture]` and
  `[Rubric §12, Performance & Scalability]` (which assesses whether performance work is deliberate
  rather than reflexive): EF Core's `AddPooledDbContextFactory` is the standard way to avoid
  re-allocating contexts, and it is explicitly forbidden here. The class comment says why
  (`PhysicalDbContextFactory.cs:10-14`): each instance carries per-source constructor state (its
  [`PhysicalDataSource`](#physicaldatasource)), so a pool would hand a context configured for one
  database to a caller asking for another and silently point repositories at the wrong database. The
  same warning is repeated at the registration site (`DependencyInjection.cs:87-91`), which is where
  someone optimizing DI would look first. Under database-per-tenant the rule is load-bearing twice
  over, since a pooled context could then cross a tenant boundary rather than only a module one.
- **Walkthrough**:
  - **Three static empty options objects** (`PhysicalDbContextFactory.cs:24-31`): one
    `DbContextOptions<T>` per engine, built once and reused. The comment above them explains the
    emptiness (`:21-23`): provider, connection, interceptors, and model cache key are all set inside
    each context's `OnConfiguring`, so these options exist only to satisfy the `DbContext` constructor
    and match what the previous `AddDbContextFactory<T>()` registrations produced.
  - **`Create(DataSourceKey key)`** (`PhysicalDbContextFactory.cs:34`): a one-liner that resolves the
    [`PhysicalDataSource`](#physicaldatasource) with `resolver.GetPhysical(key)` and forwards to the
    two-argument overload, so the resolver path and the tenant path share one construction switch.
  - **`Create(DataSourceKey key, PhysicalDataSource physicalDataSource)`**
    (`PhysicalDbContextFactory.cs:37-48`): null-guards the supplied source (`:39`), then switches on
    `key.Engine` to construct `SQLServerDbContext`, `SqliteDbContext`, or `CosmosDbContext`, passing
    options, the service provider, the assembly provider, and the physical source into each
    four-argument constructor (`:43-45`). An unmapped engine throws an `InvalidOperationException`
    naming the offending value (`:46`).
- **Why it's built this way**: this is the single point where the two storage axes meet, the `Engine`
  axis of [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) picking the
  class and the `Name` axis of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)
  picking the database, so adding an engine is a new `case` plus a context class rather than a change
  anywhere in application code. Taking the connection information as a parameter is what let
  [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) add a third, per-tenant
  axis without touching the switch.
- **Where it's used**: [`DbContextFactory.GetDbContext`](#dbcontextfactory) calls one overload or the
  other on every cache miss (`DbContextFactory.cs:96-97`), and the three Default-source adapters
  ([`DefaultSqlServerDbContextFactory`](#defaultsqlserverdbcontextfactory),
  [`DefaultSqliteDbContextFactory`](#defaultsqlitedbcontextfactory),
  [`DefaultCosmosDbContextFactory`](#defaultcosmosdbcontextfactory)) wrap the single-argument one.

### DbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:39` · Level 9 · class (sealed)

- **What it is**: the scoped implementation of [`IDbContextFactory`](#idbcontextfactory) and the
  busiest type in this group. It caches one [`ApplicationDbContext`](#applicationdbcontext) per
  physical [`DataSourceKey`](#datasourcekey) for the life of the scope, coordinates save, transaction,
  migration, and disposal across all of them, and is also the database-per-tenant routing point
  (`DbContextFactory.cs:16-25`).
- **Depends on**: [`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory),
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry),
  [`IDataSourceResolver`](#idatasourceresolver), and
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), all null-guarded from the primary
  constructor into readonly fields (`DbContextFactory.cs:39-58`), plus two **optional** tenancy
  parameters defaulted to `null` so the pre-tenancy constructor shape keeps resolving:
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) and
  `IOptions<`[`TenancySettings`](group-14-module-system-composition.md#tenancysettings)`>`
  (`DbContextFactory.cs:31-38`, `:44-45`). It also calls four `internal static` members of
  [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) (`BeginCaptureExclusion`,
  `EndCaptureExclusion`, `DropDeferred`, `FlushDeferredAsync`, called at `DbContextFactory.cs:319`,
  `:347`, `:452`, and `:580`).
- **Concept introduced, coordinating one logical save across several physical databases.**
  `[Rubric §8, Data Architecture]` (transaction boundaries, unit-of-work scope, per-service isolation)
  and `[Rubric §10, Cross-Cutting Concerns]` (transactions handled once in a shared mechanism, never
  copy-pasted into handlers): every hard question raised by
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) lands here. How many
  contexts does a request have (one per source it touches)? What does "commit" mean when there are two
  (sequential, best-effort, no two-phase commit)? When are in-process domain events allowed to run
  (only after a successful commit)? What happens when the commit itself fails with an unknown outcome
  (see [`TransactionCommitAmbiguousException`](#transactioncommitambiguousexception))?
- **Concept introduced, per-tenant routing without a second EF model.** `[Rubric §11, Security]` and
  `[Rubric §30, Compliance, Privacy & Data Governance]`: under
  [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) a tenant may declare its
  own connection string for a source, and this class is where that declaration turns into a different
  database. The trick is that only the connection string changes: the
  [`DataSourceKey`](#datasourcekey) stays the same, which is what EF's model cache is keyed on, so one
  compiled model serves every tenant (`DbContextFactory.cs:142-147`).
- **Walkthrough**:
  - **State** (`DbContextFactory.cs:53-85`): `MaxSavePasses` (3, `:53`); `_dbContexts`, the per-scope
    `Dictionary<DataSourceKey, ApplicationDbContext>` that guarantees every repository in a scope
    shares one change tracker per database (`:63`); `_routedContextTenants`, recording which tenant
    each per-tenant-routed context was created for and holding only overridden sources (`:65-70`);
    `_transactionActive` (`:76`); the one-shot `_identityInsertRequested` flag (`:83`); and a
    `volatile bool _disposed` (`:85`).
  - **`GetDbContext(DataSourceKey)`** (`DbContextFactory.cs:88-118`): throws if disposed (`:90`), then
    on a cache miss asks `ResolveTenantOverride` for the tenant's own connection information and
    creates the context through whichever `Create` overload applies (`:94-97`), records the creating
    tenant when the source was routed (`:101-102`), attaches the tenant accessor (`:104`), and enlists
    the new context in an already-active transaction (`:108-109`), so a source first touched **inside**
    a transactional command still shares the boundary. On a cache **hit** it calls
    `GuardRoutedTenantUnchanged` (`:114`).
  - **`AttachTenantAccessor`** (`DbContextFactory.cs:134-140`): hands the context a delegate rather
    than a copied value, because a context can be created before the request's tenant is resolved and
    the query filter must read the answer that holds at query time (`:124-128`).
  - **`ResolveTenantOverride`** (`DbContextFactory.cs:148-173`): returns `null` (source stays shared)
    unless there is a tenant, bound settings, an entry for that tenant, and an entry for this source
    name (`:150-156`); otherwise it takes the engine-appropriate connection string through
    [`TenancySettingsValidator`](group-14-module-system-composition.md#tenancysettingsvalidator)`.ConnectionStringFor`
    (`:158`), still returning `null` when the tenant overrides only a different engine (`:159-163`),
    and finally clones the shared [`PhysicalDataSource`](#physicaldatasource) with the tenant's
    connection string and Cosmos database name (`:165-172`).
  - **`GuardRoutedTenantUnchanged`** (`DbContextFactory.cs:181-198`): if the cached context was routed
    for a tenant and the scope's tenant has since changed, it throws with both tenant ids named
    (`:190-197`). The comment states the stakes (`:175-180`): serving that context to a second tenant
    would read and write the first tenant's data under the second tenant's filter value.
  - **`GetSourcesInUse`** (`DbContextFactory.cs:218-219`): the union of every source backing a
    registered entity (from [`IEntityDataSourceRegistry`](#ientitydatasourceregistry)) and every source
    already materialized in this scope, which is what `EnsureCreatedAsync` (`:201-212`), `MigrateAsync`
    (`:659-663`), and `HasPendingMigrationsAsync` (`:666-675`) iterate. `EnsureCreatedAsync` skips
    sources with an empty connection string (`:205-208`); the two migration sweeps filter to
    `DataSource.SQLServer` (`:661`, `:668`).
  - **`SaveChangesAsync`** (`DbContextFactory.cs:230-278`): reads and immediately clears the
    identity-insert flag (`:232-233`), then loops at most `MaxSavePasses` times over the contexts it
    has not yet saved (`:242-256`), passing `_currentUserService.UserId` into each context's
    audit-aware `SaveChangesAsync` overload (`:252-254`). The re-loop exists because saving dispatches
    domain events in-process, and a handler that resolves a repository for a source nobody had touched
    yet calls `GetDbContext` mid-enumeration (`:238-241`). After the loop it asserts that **no** cached
    context still has changes and throws an `InvalidOperationException` naming the offending sources if
    any does (`:264-275`), because anything still tracked when the unit of work returns would be
    silently lost. The comment at `:258-263` explains why the assertion reads the change tracker rather
    than the saved set: it must catch both a context materialized past the pass bound and a handler
    that dirtied an already-saved context.
  - **`SaveChanges`** (`DbContextFactory.cs:413-421`): the synchronous path, a single pass over a
    snapshot of the cached contexts with no re-loop.
  - **Identity-insert path** (`DbContextFactory.cs:281`, `:289-361`): covered in
    [`IdentityInsertGroup`](#identityinsertgroup) above.
  - **`BeginTransaction` / `CommitTransaction` / `RollbackTransaction`** (`DbContextFactory.cs:423-453`):
    each filters to contexts that support transactions and, symmetrically, to those that do or do not
    already carry one (`:431`, `:438`, `:445`), because EF throws on a second `BeginTransaction` for
    the same connection and `GetDbContext` may already have enlisted a late-created context
    (`:427-430`). Rollback additionally calls `DomainEventSaveChangesInterceptor.DropDeferred` on every
    context (`:451-452`): the aggregate changes and their outbox rows just rolled back, so the deferred
    in-process dispatch must never run, and must not survive into a retry.
  - **`ExecuteInTransactionAsync<TResult>`** (`DbContextFactory.cs:501-543`): re-entrancy first, a
    nested call simply runs the operation on the ambient transaction (`:512-513`), because an inner
    commit would make the outer scope's earlier work durable ahead of its own decision (`:505-511`).
    Otherwise it picks the execution strategy from the first transaction-capable context, materializing
    the Default SQL Server context if none exists yet (`:518-519`), and runs the attempt under
    `strategy.ExecuteAsync` (`:525-533`), calling `ResetForRetry` before every attempt after the first
    (`:527-528`).
  - **`RunTransactionalAttemptAsync`** (`DbContextFactory.cs:553-608`): one attempt, begin to commit.
    A failed [`Result`](group-01-result-error-handling.md#result) rolls back and returns (`:562-569`),
    which is what makes
    [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)'s Result-over-exceptions
    rule safe for partial persistence. On success it commits through `TryCommit` and only then flushes
    the deferred dispatch on every context, snapshotting the dictionary first because a handler can
    still materialize a new source (`:575-582`). A cancellation attempts a best-effort rollback and, if
    even that throws, clears the flag and drops every deferred dispatch by hand (`:586-602`); any other
    exception rolls back and rethrows (`:603-607`).
  - **`TryCommit`** (`DbContextFactory.cs:614-626`) and **`AbandonAfterCommitFailure`** (`:635-656`): a
    commit failure is **returned, not thrown** (`:624`), and the cleanup rolls back whatever has not
    committed yet, drops every deferred dispatch, and swallows secondary rollback failures so the
    commit ambiguity stays the reported failure (`:639-655`).
  - **`ResetForRetry`** (`DbContextFactory.cs:682-689`): before the strategy re-runs the operation it
    drops deferred dispatch and calls `ChangeTracker.Clear()` on every context, so entities the aborted
    attempt added are not inserted a second time (with a duplicate outbox row per event).
  - **`SupportsTransactions`** (`DbContextFactory.cs:695-696`): `context is not CosmosDbContext`,
    the single place the Cosmos "no multi-document transactions" fact is encoded.
  - **Disposal** (`DbContextFactory.cs:701-731`): `Dispose` and `DisposeAsync` both dispose every
    cached context, clear the dictionary, set `_disposed`, and suppress finalization.
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)
  makes "one scope, several databases" the normal case, so somebody has to own the cross-context
  bookkeeping; putting it here keeps handlers writing `SaveChangesAsync` exactly as they would against
  a single database, and [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)
  then reuses that one chokepoint for per-tenant routing. The four subtleties (bounded re-loop plus the
  unsaved assertion, deferred dispatch released only after commit, a commit failure exempted from
  retry, and the routed-tenant guard) are each a correctness fix with the reasoning written into the
  source next to the code.
- **Where it's used**: registered scoped as [`IDbContextFactory`](#idbcontextfactory)
  (`DependencyInjection.cs:92`) and consumed through that interface everywhere (see the interface's
  section). Directly instantiated in tests, for example
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:51`.
- **Caveats / not-in-source**: the `MaxSavePasses` bound of 3 is documented as "two passes cover the
  realistic case, the third is slack" (`DbContextFactory.cs:48-52`); whether any production workload
  has ever needed the third pass is Not determinable from source. The routed-tenant guard also implies
  a usage rule the code can only enforce after the fact: a scope serves one tenant, and switching
  tenants means a fresh scope (`:190-197`).

### IdentityModuleDbSeederBase<TUser>
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeederBase.cs:38` · Level 9 · class (abstract)

- **What it is**: a [`DbSeeder`](#dbseeder) subclass that owns the whole per-account seeding idiom
  (normalize the email, skip if it exists, hash the password, build the aggregate, add, save) for an
  app-supplied list of development accounts. Its own summary records why it exists: that idiom was
  written out five times across the two apps' Identity modules and now lives here once
  (`IdentityModuleDbSeederBase.cs:8-12`).
- **Depends on**: [`IUnitOfWork`](#iunitofwork) and
  [`IPasswordHasher`](group-08-auth.md#ipasswordhasher) through its primary constructor (`:38-40`),
  [`SeedAccount`](#seedaccount) as the input record, [`Email`](group-02-domain-building-blocks.md#email)
  as the normalized value object, [`Result<T>`](group-01-result-error-handling.md#result) as the
  factory-hook return type, and
  [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
  as the `TUser` constraint (`:41`).
- **Concept introduced, the template method with app-specific hooks.** `[Rubric §1, SOLID]` (assesses
  whether abstractions are open for extension and closed for modification, and whether subclasses vary
  only what genuinely differs) and `[Rubric §16, Maintainability]`: the base fixes the invariant
  sequence and leaves exactly three extension points, each for a reason the doc comment spells out
  (`:13-24`). `CreateUser` exists because the two apps' `User.Create` factories take the same values in
  **different parameter orders** and only the app can name its own roles (compare ADC's ordering at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:55-61`
  with Store's at
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:51`).
  `EmailExistsAsync` exists because the existence predicate must be written against the app's concrete
  `User` and never against an interface member, so EF translates it to the same SQL it did before the
  hoist. That second constraint is the one worth remembering: a predicate over an interface property is
  not translatable, so hoisting shared persistence logic into a generic base means leaving the query
  itself behind in the subclass.
- **Walkthrough**:
  - **Constructor and protected state** (`IdentityModuleDbSeederBase.cs:38-47`): the primary
    constructor's two parameters are null-guarded into protected `UnitOfWork` and `PasswordHasher`
    properties, so subclasses can reach the unit of work for their existence predicate without taking
    it again.
  - **`Accounts`** (`:50`): abstract `IReadOnlyList<SeedAccount>`, the ordered list the app supplies.
  - **`ShouldSeed`** (`:57`): `protected virtual`, defaulting to `true`. The gate is checked once at
    the top of `SeedAsync` (`:62-65`).
  - **`SeedAsync`** (`:60-71`): the public entry point. Return early when the gate is closed, otherwise
    walk `Accounts` in order calling the private per-account routine (`:67-70`).
  - **`EmailExistsAsync(Email?, CancellationToken)`** (`:81`) and
    **`CreateUser(SeedAccount, byte[], byte[])`** (`:90`): the two abstract hooks. Their doc comments
    define the contract precisely, including that `email` is `null` when the seed address failed
    validation, in which case no user can match it (`:77-78`), and that a failed `Result` skips the
    account silently (`:89`).
  - **`SeedAccountAsync`** (`:92-113`): the idiom itself. Normalize through
    [`Email`](group-02-domain-building-blocks.md#email)`.Create(...).Value` so the EF predicate compares
    same-typed converted values (`:94-95`), ask the hook whether the account exists and return if so
    (`:97-101`), hash the plaintext password into a `(hash, salt)` pair (`:103`), call the app factory
    and return silently on failure (`:104-108`), then resolve the repository through
    [`IUnitOfWork`](#iunitofwork)`.GetRepository<TUser, UserIdentifierType>()`, add, and save
    (`:110-112`).
- **Why it's built this way**: saving per account rather than once at the end is deliberate and is
  stated in the class comment (`:28-29`): one invalid account cannot roll back the others, which
  matches the pre-hoist behavior each app had. Hashing goes through
  [`IPasswordHasher`](group-08-auth.md#ipasswordhasher) rather than any local scheme, per
  [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) (`:46`). `[Rubric §11,
  Security]` applies through the notice at `:31-35`: seed credentials are deliberately weak plaintext
  for local development, and a deployed environment must disable seeding or supply environment-sourced
  secrets.
- **Where it's used**: subclassed once per app, by ADC's and Store's
  [`IdentityModuleDbSeeder`](group-24-identity-module.md#identitymoduledbseeder)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:27-30`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:22`),
  each of which is constructed and run by its
  module's [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) at startup (ADC's
  [`IdentityModuleSeeder`](group-24-identity-module.md#identitymoduleseeder) at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:34-35`). Pinned by
  `IdentityModuleDbSeederBaseTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/IdentityModuleDbSeederBaseTests.cs:26`,
  `:40`, `:57`, `:68`, `:82`, `:96`), which cover the closed gate, per-account add and save,
  normalization before the existence check, the skip-if-present path, the skip-on-factory-failure path,
  and the hashed credential reaching the app factory.
- **Caveats / not-in-source**: the class comment names ADC's `Seeding:IncludeSampleUsers` as an example
  of an app overriding `ShouldSeed` (`:26-29`), but no first-party seeder overrides it. ADC's subclass
  says so explicitly
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:17-19`)
  and keeps the
  configuration gate in the API-layer `IdentityModuleSeeder` instead
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:28-30`); the only
  override of `ShouldSeed` in the workspace is the test double
  (`IdentityModuleDbSeederBaseTests.cs:161`). So the gate exists in both places by design, and the
  comment describes an available option rather than the wiring in force.

### CosmosIntIdValueGenerator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.ValueGenerators` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ValueGenerators/CosmosIntIdValueGenerator.cs:16` · Level 0 · class (sealed)

- **What it is**: a nine-line EF Core value generator that hands out `int` ids on the client, for the
  one engine that cannot generate them on the server. Cosmos DB has no identity column, so something
  has to produce the key before the document is written, and this is that something
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ValueGenerators/CosmosIntIdValueGenerator.cs:6-9`).
- **Depends on**: EF Core's `ValueGenerator<int>` base and `EntityEntry`, plus the BCL `Interlocked`
  and `DateTimeOffset`. No first-party type at all.
- **Concept introduced, who assigns the key.** `[Rubric §8, Data Architecture]` assesses whether
  persistence mechanics, key strategy included, are deliberate rather than accidental. The framework
  keeps one identifier alias per module (an `int` or a `Guid`, see the primer's
  [identifier-type aliases](00-primer.md) and ADR-048) and then has to honor that alias on three
  engines. SQL Server and SQLite both offer a server-side identity column, so the entity
  configuration asks for one
  ([`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype)
  at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:68-69`
  for SQL Server and `:77-78` for SQLite). Cosmos offers nothing equivalent, so the same switch
  installs this generator instead (`:90-91`). The alias stays `int` everywhere; only the mechanism
  that fills it changes per engine, which is the polyglot-persistence bargain of ADR-018.
- **Walkthrough**:
  - **`_seed`** (`CosmosIntIdValueGenerator.cs:18`): a `private static int` initialized to
    `(int)(DateTimeOffset.UtcNow.ToUnixTimeSeconds() % int.MaxValue)`. Seeding from the clock rather
    than from zero means a restarted process does not begin re-issuing ids it already used; the
    modulo keeps the seconds value inside `int` range instead of overflowing.
  - **`GeneratesTemporaryValues => false`** (`:21`): the value this generator returns is the real
    stored key, not an EF placeholder to be replaced after the insert. That distinction matters
    elsewhere in this group: [`DbContextFactory`](#dbcontextfactory) reads the *temporary* flag on
    SQL Server keys to tell an application-supplied id from an EF-assigned one, and only the
    non-temporary ones need an `IDENTITY_INSERT` round
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:388-391`).
  - **`Next(EntityEntry entry)`** (`:24-25`): `Interlocked.Increment(ref _seed)`. Lock-free and
    thread-safe, which is what you want on a member called once per inserted entity. The `entry`
    argument is ignored, so every Cosmos entity type in the process draws from the same counter.
- **Why it's built this way**: the counter is deliberately process-local. A durable sequence would
  need a round trip to the database per insert, which is exactly the cost a Cosmos-shaped workload
  is trying to avoid, and the class remarks accept the trade-off explicitly (`:11-15`).
- **Where it's used**: installed by the Cosmos branch of `EntityTypeConfiguration.ApplyEngineConventions`
  (`EntityTypeConfiguration.cs:91`) for every entity whose id is value-generated; pinned by
  `CosmosIntIdValueGeneratorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/CosmosIntIdValueGeneratorTests.cs:6`,
  `:10`, `:15`, `:26`).
- **Caveats / not-in-source**: the class remarks state the limit plainly (`:14`): two processes
  seeded within the same second, or two processes whose counters drift into each other, can mint the
  same id, and the suggested remedy is a `Guid` alias for entities that need true uniqueness.
  Whether any deployed host currently stores entities in Cosmos is Not determinable from source: SQL
  Server is the engine every host in this workspace configures.

### CrossTenantWriteException

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/CrossTenantWriteException.cs:24` · Level 0 · class (sealed, exception)

- **What it is**: the single failure type of the write side of multi-tenancy. It is thrown when a
  save would insert, update or delete a row owned by a tenant other than the one the current scope
  resolved, or would insert an untenanted row from a scope that resolved no tenant at all
  (`CrossTenantWriteException.cs:5-9`).
- **Depends on**: the BCL only (`InvalidOperationException`, `string.Format` with
  `CultureInfo.InvariantCulture`). It is thrown exclusively by
  [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor); it does not reference it.
- **Concept introduced, why isolation fails loudly on the write side and silently on the read side.**
  `[Rubric §11, Security]` assesses whether authorization boundaries are enforced by construction
  rather than by caller discipline, and `[Rubric §30, Compliance and Data Governance]` assesses
  whether tenant data separation is demonstrable. Read isolation is a query filter, and a filter that
  disagrees with the caller simply returns nothing: a wrong tenant sees an empty list, which is the
  correct and harmless outcome. A save has no equivalent harmless outcome. By the time the
  interceptor sees the entry, the row is about to be written, and the only honest results are "the
  correct tenant" or "no write at all", so this type throws instead of filtering
  (`CrossTenantWriteException.cs:11-18`). The message names the entity type and both tenants because
  the realistic cause is a scope that was never given a tenant (a background job, a queued handler)
  rather than a genuine attempt to cross the boundary.
- **Walkthrough**:
  - **`DefaultMessage`** (`:26-27`): the parameterless-constructor text, "The save would write across
    the tenant boundary and was rejected."
  - **The three public constructors** (`:30-31`, `:35-36`, `:41-42`): parameterless, message, and
    message-plus-inner. They exist so the type satisfies the standard exception shape the analyzers
    require, even though the framework itself never calls them.
  - **The private constructor** (`:44-54`): the one the factories use. It takes the formatted message
    plus the three diagnostic values and assigns them to the properties.
  - **`EntityType`, `CurrentTenantId`, `EntityTenantId`** (`:57`, `:62`, `:68`): all `string?`, all
    get-only. A catch site can branch on the data instead of parsing the message. `CurrentTenantId`
    is null exactly when the scope resolved no tenant; `EntityTenantId` is null when the entity
    carried none.
  - **`ForMismatch(entityType, operation, currentTenantId, entityTenantId)`** (`:78-94`): builds the
    "the entity belongs to tenant X but this scope resolved tenant Y" message. `operation` is the
    literal `insert`, `update` or `delete` passed by the interceptor, so one factory covers all three
    write shapes.
  - **`ForUnresolvedTenant(entityType)`** (`:101-111`): builds the message for the other failure,
    an untenanted insert from an untenanted scope, and names the two ways out in the message itself:
    resolve a tenant for the scope via `ITenantContext.SetTenant`, or assign the tenant on the entity
    before saving. Both tenant ids are passed as null.
- **Why it's built this way**: it derives from `InvalidOperationException` (`:19-22`) so existing
  handler and middleware catch sites treat it exactly as they treat the framework's other save-time
  invariant failures, with no new catch clause anywhere. Both factories are `internal`, which keeps
  the interceptor the only thing that can produce a populated instance while leaving the type public
  for consumers to catch. See ADR-073 for the multi-tenancy model this enforces.
- **Where it's used**: thrown at three call sites in
  [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor)
  (`TenantSaveChangesInterceptor.cs:110` for the unresolved-tenant insert, `:123` for a mismatched
  insert, `:150-151` for a mismatched update or delete); asserted by
  `TenantSaveChangesInterceptorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantSaveChangesInterceptorTests.cs:12`).

### AggregateCapture

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:349` · Level 2 · record (private sealed, nested)

- **What it is**: a two-field pairing of one tracked aggregate root and the exact array of domain
  events snapshotted from it for the current save
  (`DomainEventSaveChangesInterceptor.cs:346-351`).
- **Depends on**: EF Core's `EntityEntry<IAggregateRoot>` and
  [`IDomainEvent`](group-04-events-outbox.md#idomainevent) via
  [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot).
- **Concept introduced, snapshot-then-remove instead of clear.** The naive move after dispatching
  events is `entity.ClearDomainEvents()`. That is wrong here, and this record is the fix. An
  in-process handler running during dispatch can raise a *new* event on the same aggregate; a
  wholesale clear would wipe that new event before any later capture could see it, so it would never
  dispatch and never reach the outbox. Holding the exact snapshot lets the interceptor remove
  precisely what it captured and leave everything else in place
  (`DomainEventSaveChangesInterceptor.cs:331-341`).
- **Walkthrough**:
  - **`Entry`** (`:350`): the `EntityEntry<IAggregateRoot>`, not the bare entity. Keeping the entry
    means the record still has EF's view of the aggregate available if the flush path ever needs it,
    and `capture.Entry.Entity` reaches the aggregate itself (`:340`).
  - **`Events`** (`:351`): an `IDomainEvent[]` materialized with a collection expression at capture
    time (`:201`, `[.. e.Entity.DomainEvents]`), which is what makes it a snapshot rather than a live
    view of the aggregate's mutable list.
- **Why it's built this way**: a positional `record` gives value semantics and an immutable pair for
  free, and `private sealed` keeps it invisible outside the interceptor. It is data, not behavior:
  the only method that touches it is `ClearDomainEvents`, which calls
  `capture.Entry.Entity.RemoveDomainEvents(capture.Events)` on each (`:339-340`, against the contract
  member at `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAggregateRoot.cs:32`).
- **Where it's used**: constructed once per event-carrying aggregate in
  `CaptureEventsAndPersistToOutbox` (`:198-202`), stored inside
  [`CapturedState`](#capturedstate) (`:359`), and consumed by `ClearDomainEvents` (`:337-341`).

### CapturedState

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:358` · Level 3 · record (private sealed, nested)

- **What it is**: the whole of what
  [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) learns before a save and
  needs again after it: which aggregates it captured, which events it will dispatch in process,
  which outbox rows back those events, and whether any integration events are in the batch
  (`DomainEventSaveChangesInterceptor.cs:353-362`).
- **Depends on**: [`AggregateCapture`](#aggregatecapture),
  [`IDomainEvent`](group-04-events-outbox.md#idomainevent),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage).
- **Concept introduced, why per-save state cannot live in a field.** The interceptor is registered
  as a **singleton** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:58`),
  and one singleton serves every context in every scope concurrently. Anything it remembers between
  `SavingChanges` and `SavedChanges` therefore has to be keyed by the context, not stored on the
  instance. That is exactly what this record is: the value side of a
  `ConditionalWeakTable<DbContext, CapturedState>` (`:48`). `[Rubric §12, Performance and
  Scalability]` assesses whether shared components stay safe and cheap under concurrency; the weak
  table adds no lock and no lifetime bookkeeping, because an entry disappears when its context is
  collected.
- **Walkthrough** (all four members are positional and immutable):
  - **`Captures`** (`:359`): the `AggregateCapture[]`, used only to remove exactly the captured
    events afterwards.
  - **`LocalEvents`** (`:360`): the events that get in-process dispatch. On an outbox-capable
    context this deliberately **excludes** every
    [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) (`:226-234`); on a context
    without outbox support it is simply every captured event (`:243`).
  - **`LocalOutboxEntries`** (`:361`): the `List<OutboxMessage>` rows backing `LocalEvents`, in the
    same order they were added. After a successful dispatch these are the rows stamped processed
    (`:310`).
  - **`HasIntegrationEvents`** (`:362`): a bool rather than a second list, because integration events
    are never dispatched here. The only thing the flush needs to know is whether to wake the outbox
    processor (`:312-313`).
- **Why it's built this way**: splitting local events from integration events at *capture* time,
  and recording the split in this one value, is what makes `AddDomainEvent(integrationEvent)`
  broker-correct (ADR-003). Before this routing existed, an integration event was dispatched locally
  and its row marked processed, so it silently never reached the wire (`:19-24`).
- **Where it's used**: created at the end of `CaptureEventsAndPersistToOutbox` (`:246-247`), read by
  `DispatchAndFinalizeAsync` (`:280`), carried across a commit boundary inside
  [`DeferredDispatch`](#deferreddispatch) (`:290`), and consumed by `FlushStateAsync` (`:301-329`).

### AuditSaveChangesInterceptor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:13` · Level 6 · class (sealed)

- **What it is**: the EF Core interceptor that stamps `CreatedOn`/`CreatedBy` and
  `LastModifiedOn`/`LastModifiedBy` on every
  [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) entry immediately before
  the write (`AuditSaveChangesInterceptor.cs:8-13`). It is the first of the three interceptors the
  framework installs and the reason no handler anywhere in ADC or Store sets an audit field by hand.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext) (for `CurrentSaveUserId` and the
  change tracker), [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), and the
  BCL `TimeProvider`, injected through the primary constructor (`:13`).
- **Concept introduced, the EF `SaveChangesInterceptor` as the cross-cutting hook of the persistence
  layer.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether audit, correlation and logging are
  wired once centrally rather than repeated per handler. An EF `SaveChangesInterceptor` is a hook EF
  calls at fixed points of the save pipeline: `SavingChanges`/`SavingChangesAsync` before the write
  and `SavedChanges`/`SavedChangesAsync` after it. Choosing an interceptor over an override of
  `SaveChangesAsync` buys three things: the logic runs on the synchronous and asynchronous paths
  alike, several interceptors compose in a defined order rather than fighting over one method body,
  and the concern lives in one class the module authors never see. `[Rubric §8, Data Architecture]`
  is engaged too, because "every row knows who wrote it and when" is a schema-level guarantee here,
  not a convention.
- **Walkthrough**:
  - **`SavingChangesAsync`** (`:16-25`) and **`SavingChanges`** (`:28-36`): identical two-line
    bodies. Each pattern-matches `eventData.Context` against `ApplicationDbContext`, calls
    `StampAuditFields`, then delegates to `base`. The type test is the guard: a context that is not
    the framework's own is left completely alone.
  - **`StampAuditFields`** (`:38-66`): reads the clock once per save via
    `timeProvider.GetUtcNow().UtcDateTime` (`:40`) so every row in one save carries the same instant,
    and resolves the user once as `context.CurrentSaveUserId ?? default` (`:41`). `CurrentSaveUserId`
    is the nullable user id the context was handed for this save
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:123`,
    set at `:136` and `:171`), so `default` is the sentinel for a system-originated write with no
    user behind it.
  - **The `Added` branch** (`:47-52`): sets all four properties through
    `entry.Property(nameof(...)).CurrentValue`, going through the change tracker rather than the CLR
    setters so the fields can stay `init`-only or privately settable on the entity.
  - **The `Modified` branch** (`:53-58`): the interesting one. It sets `LastModifiedBy`/
    `LastModifiedOn`, and explicitly marks `CreatedBy` and `CreatedOn` as `IsModified = false`
    (`:54-55`). That is the invariant: an update can never rewrite creation provenance, even if the
    caller mutated those properties on a tracked instance.
  - **`Detached`, `Unchanged`, `Deleted` and the default** (`:59-63`): deliberate no-ops. Soft delete
    is not a special case here, because an entity that sets `IsDeleted = true` is in `Modified`
    state and picks up a `LastModified` stamp like any other update (see ADR-005 for soft delete
    versus erasure).
- **Why it's built this way**: taking `TimeProvider` instead of calling `DateTime.UtcNow` makes the
  stamps deterministic under test (`[Rubric §14, Testability]`), which is what
  `AuditSaveChangesInterceptorTests` relies on
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:13`).
  The class is registered as a singleton because it holds no per-save state at all
  (`DependencyInjection.cs:55-57`), unlike its two neighbours.
- **Where it's used**: resolved from DI and attached in `ApplicationDbContext.OnConfiguring`
  (`ApplicationDbContext.cs:236`, added at `:246` or `:250`). It is always **first** in the
  interceptor chain, which is what lets
  [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor) and the domain-event interceptor
  assume the audit stamps are already final when they run (`ApplicationDbContext.cs:239-243`,
  `:253-257`).

### DeferredDispatch

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:365` · Level 6 · record (private sealed, nested)

- **What it is**: one unit of post-commit work: a [`CapturedState`](#capturedstate) plus the
  interceptor instance that captured it (`DomainEventSaveChangesInterceptor.cs:364-365`).
- **Depends on**: [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) and
  [`CapturedState`](#capturedstate).
- **Concept introduced, carrying the owner so a static entry point can flush.**
  [`DbContextFactory`](#dbcontextfactory) is the type that knows when a transaction committed, so it
  is the type that must trigger the deferred dispatch. It calls a **static** method,
  `DomainEventSaveChangesInterceptor.FlushDeferredAsync` (`:128`), rather than resolving the
  interceptor from DI: the factory therefore has no constructor dependency on the interceptor, which
  keeps the persistence graph acyclic. But a flush needs the *instance* (the dispatcher and logger it
  was constructed with), so each queued item carries its own owner and the static entry point simply
  calls back through it: `dispatch.Owner.FlushStateAsync(...)` (`:136`).
- **Walkthrough**:
  - **`Owner`** (`:365`): the interceptor instance that produced the state. In a normal host this is
    the one singleton, but the record does not assume that.
  - **`State`** (`:365`): the captured state to flush.
  - Instances live in a second weak table, `ConditionalWeakTable<DbContext, List<DeferredDispatch>>`
    (`:55`), so a context can accumulate several deferrals when a transactional command saves more
    than once (`:290`, via `DeferredTable.GetOrCreateValue(context).Add(...)`).
- **Why it's built this way**: the ordering rule it implements is that in-process handlers must never
  act on state that could still roll back. Email, cache writes and pushes issued from a handler are
  not transactional, so dispatching them before the commit would leave real side effects behind an
  aborted transaction, and an execution-strategy retry would repeat them once per attempt
  (`:26-33`). See ADR-003 and the Transactional decorator of ADR-014.
- **Where it's used**: enqueued by `DispatchAndFinalizeAsync` when
  `context.Database.CurrentTransaction is not null` (`:285-292`); drained by `FlushDeferredAsync`
  after a successful commit
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:578-582`);
  discarded wholesale by `DropDeferred` on every rollback path (`DbContextFactory.cs:452`, `:598`,
  `:641`, `:686`).

### DomainEventSaveChangesInterceptor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:38` · Level 6 · class (sealed, partial)

- **What it is**: the interceptor that turns domain events into durable messages. Before the write it
  captures every pending event off the tracked aggregate roots and adds an
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row for each, so events commit in the
  same transaction as the data. After the write it routes them: local events are dispatched
  in-process and their rows stamped processed, while integration events are left unprocessed for the
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) to publish
  (`DomainEventSaveChangesInterceptor.cs:12-34`).
- **Depends on**: [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher),
  [`IOutboxSignal`](group-04-events-outbox.md#ioutboxsignal) and `ILogger<T>` (primary constructor,
  `:38-41`); [`ApplicationDbContext`](#applicationdbcontext),
  [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot),
  [`IDomainEvent`](group-04-events-outbox.md#idomainevent),
  [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage), and `OutboxFinalizer`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxFinalizer.cs:12`).
  BCL: `ConditionalWeakTable`, `ReferenceEqualityComparer`.
- **Concept introduced, the dual-dispatch outbox (ADR-003) and its two failure modes.**
  `[Rubric §6, CQRS and Event-Driven]` assesses whether events are delivered reliably rather than
  optimistically, and `[Rubric §29, Resilience and Business Continuity]` assesses whether a crash at
  any point leaves the system recoverable. The mechanism has three moves. **One**, persistence:
  every captured event becomes an outbox row added to the same `DbContext` before
  `base.SaveChangesAsync` runs, so the row and the aggregate change commit or fail together and no
  crash can lose an event that the data implies happened. **Two**, the in-process fast path: after
  the write, local events go straight to the dispatcher and their rows are stamped processed, so the
  background processor finds nothing to do. **Three**, the fallback: if that dispatch throws, the
  rows stay unprocessed and `outboxSignal.Signal()` wakes the processor to retry. The routing split
  is what makes the pattern correct for extracted services: an integration event never takes the
  fast path, because in-process delivery would mark it processed and it would never reach the broker
  (`:19-24`).
- **Walkthrough** (this is the densest type in the group; read it as capture, then route, then
  defer):
  - **Three static weak tables** (`:48`, `:55`, `:63`). `StateTable` holds the
    [`CapturedState`](#capturedstate) between saving and saved; `DeferredTable` holds the
    [`DeferredDispatch`](#deferreddispatch) list for a context inside a transaction;
    `CaptureExclusionTable` holds the aggregate instances a save must skip.
    `ConditionalWeakTable` is chosen throughout so the interceptor can stay a singleton without ever
    keeping a context alive or needing cleanup code (`:43-47`).
  - **`SavingChangesAsync` / `SavingChanges`** (`:66-75`, `:78-86`): both call
    `CaptureEventsAndPersistToOutbox` for an `ApplicationDbContext`, then delegate to base. Capture
    is synchronous by necessity: the outbox rows must be in the change tracker before EF generates
    the SQL.
  - **`CaptureEventsAndPersistToOutbox`** (`:184-248`), the heart of the type:
    - It first calls `DiscardAbandonedCapture` (`:190`, defined at `:255-272`). A previous
      `SavingChanges` that never reached `SavedChanges` (a failed save, then an execution-strategy
      retry) left its outbox rows tracked as `Added`. Re-capturing on top would write a second row
      per event and publish everything twice, so every `Added` `OutboxMessage` on the context is
      detached first. The comment justifies the blanket detach: this interceptor is the only writer
      of outbox rows, and a completed save leaves none `Added` (`:262-265`).
    - It reads the exclusion set (`:196`) and projects the tracked aggregate roots that have events
      and are not excluded into `AggregateCapture` values (`:198-202`), taking a snapshot copy of
      each event list.
    - When `context.SupportsOutbox` is true
      (`ApplicationDbContext.cs:116`), it walks the flattened event list once (`:219-235`): every
      event gets `OutboxMessage.FromDomainEvent` and is added to the outbox set, then the event is
      sorted. An `IIntegrationEvent` only flips `hasIntegrationEvents`; anything else joins both
      `locals` and `localOutboxEntries`. The `Add` call carries a targeted `VSTHRD103` suppression
      (`:222-224`) because EF's `DbSet.Add` is intentionally synchronous.
    - When the context has no outbox table, Cosmos being the example named in the comment
      (`:241-243`), every event is treated as local: nothing could carry it to the bus anyway.
    - Finally it stores the `CapturedState` under the context (`:246-247`).
  - **`SavedChangesAsync`** (`:89-98`) calls `DispatchAndFinalizeAsync` (`:278-295`), which pulls the
    state, removes it from the table, and then forks. With an active transaction it clears the
    captured events **now** (so a second save in the same transaction cannot re-capture them) and
    queues a `DeferredDispatch` (`:287-291`). Without one it flushes immediately (`:294`).
  - **`FlushStateAsync`** (`:301-329`): dispatches `LocalEvents` if any (`:305-306`), clears the
    captured events (`:308`), stamps the local rows processed through
    `OutboxFinalizer.MarkProcessedAsync` (`:310`, a single set-based `ExecuteUpdate` rather than a
    nested save, `OutboxFinalizer.cs:21-47`), and signals the outbox when integration events are
    present (`:312-313`). The `catch` logs through the source-generated `LogDispatchError` (`:343-344`)
    and signals the processor so the unprocessed rows get retried (`:315-323`); the `finally` clears
    the events again, idempotently (`:324-328`).
  - **`SavedChanges`, the synchronous path** (`:108-121`): it cannot await the dispatcher, so it does
    not try. For an outbox-capable context it removes the state, clears the captured events (which is
    what stops a later async save from re-capturing and duplicating them) and signals the processor,
    leaving delivery entirely to the outbox. A context without outbox support keeps the legacy no-op
    (`:100-107`).
  - **`ClearDomainEvents`** (`:337-341`): removes exactly the captured events via
    `RemoveDomainEvents`, never a wholesale clear, for the reason
    [`AggregateCapture`](#aggregatecapture) exists.
  - **`FlushDeferredAsync` / `DropDeferred`** (`:128-137`, `:145`): the two internal static entry
    points [`DbContextFactory`](#dbcontextfactory) calls at commit and at rollback. A missed flush is
    explicitly safe: the rows stay unprocessed and the outbox delivers them (`:123-127`).
  - **`BeginCaptureExclusion` / `EndCaptureExclusion`** (`:162-171`, `:178`): the narrow hook for
    `IDENTITY_INSERT` batching. `DbContextFactory` splits a save into one round per identity table
    and temporarily marks the other tables' entries `Unchanged`
    (`DbContextFactory.cs:301-321`); those rows are not written this round, so capturing their events
    now would persist and clear an event ahead of the insert that justifies it. The exclusion set is
    built with `ReferenceEqualityComparer.Instance` (`:170`) and cleared in a `finally`
    (`DbContextFactory.cs:345-351`). The remarks explain why exclusion is by instance and not by
    entity state (`:155-159`): skipping every `Unchanged` aggregate would also drop events raised on
    an already-saved aggregate, which is how the identity module publishes its registration events.
- **Why it's built this way**: ADR-003 specifies at-least-once delivery, with the in-process path as
  an optimization and the outbox as the guarantee. Deferring past the commit is ADR-014's
  Transactional decorator honored at the persistence layer: business failures roll back, and a
  rolled-back save must deliver nothing. The type is `partial` for the source-generated
  `[LoggerMessage]` (`:343-344`), and singleton-safe because every piece of per-save state lives in a
  weak table keyed by context.
- **Where it's used**: registered as a singleton (`DependencyInjection.cs:58`), attached last of the
  original trio in `ApplicationDbContext.OnConfiguring` (`ApplicationDbContext.cs:237`, `:246`,
  `:250`) so it sees final audit stamps and final tenant values; driven at transaction boundaries by
  [`DbContextFactory`](#dbcontextfactory). Pinned by `DomainEventSaveChangesInterceptorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:17`),
  `DomainEventSaveChangesInterceptorOutboxRoutingTests` (`.../DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:26`)
  and `DomainEventCaptureExclusionTests` (`.../DomainEventCaptureExclusionTests.cs:26`).
- **Caveats / not-in-source**: `DiscardAbandonedCapture` detaches *every* `Added` `OutboxMessage` on
  the context, which is correct only while this interceptor remains the sole writer of outbox rows.
  That is true in the current source, and the comment states the assumption (`:262-265`), but it is
  an invariant a future outbox writer would have to respect.

### TenantSaveChangesInterceptor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:36` · Level 6 · class (sealed)

- **What it is**: the write side of multi-tenancy. It stamps
  [`ITenantEntity.TenantId`](group-02-domain-building-blocks.md#itenantentity) on inserts and refuses
  any save that would touch another tenant's row (`TenantSaveChangesInterceptor.cs:9-13`).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext) (for `CurrentTenantId` and the
  change tracker), [`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity),
  [`CrossTenantWriteException`](#crosstenantwriteexception), and EF Core's `EntityEntry<T>`. It has
  no constructor at all: every member is static and the class is pure policy over the entries.
- **Concept introduced, read isolation and write isolation are separate mechanisms.**
  `[Rubric §11, Security]` assesses whether a boundary holds without caller cooperation. Tenancy in
  this framework is enforced twice, independently. On reads it is a **named** EF query filter,
  `"Tenant"`, applied in `ApplicationDbContext.ApplyTenantFilters`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:394-415`),
  which composes by AND with the `"SoftDelete"` filter and embeds the executing context as a
  constant so one cached model serves every tenant (`ApplicationDbContext.cs:380-386`). On writes it
  is this interceptor. The independence is the point and is called out in the remarks (`:29-34`): a
  caller who bypasses the read filter with EF's own parameterless `IgnoreQueryFilters()` can read
  across tenants, but still cannot write across them. `[Rubric §30, Compliance and Data Governance]`
  applies for the same reason: separation is a property of the engine here, not of reviewer
  vigilance.
- **Walkthrough**:
  - **`SavingChangesAsync` / `SavingChanges`** (`:39-48`, `:51-59`): the same two-line shape as the
    audit interceptor, both routing to `ApplyTenant`.
  - **`ApplyTenant`** (`:64-94`): reads `context.CurrentTenantId` **once** per save (`:68`), because
    that property walks a live accessor into the scoped tenant context
    (`ApplicationDbContext.cs:99`) and a save must be judged against a single value. It then
    enumerates `ChangeTracker.Entries<ITenantEntity>()` filtered by `!entry.Metadata.IsOwned()`
    (`:74-75`) and switches on state: `Added` to `StampOrVerifyInsert`, `Modified` and `Deleted` to
    `VerifyExistingRow` with the operation name, everything else a no-op. Owned types are excluded on
    both sides of the boundary for the same reason (`:70-73`): an owned value is only reachable
    through its owner, so the owner's tenant already is the row's tenant and stamping the copy would
    only invite the two to disagree.
  - **`StampOrVerifyInsert`** (`:101-124`): four outcomes, in order. No current tenant and no
    declared tenant throws `CrossTenantWriteException.ForUnresolvedTenant` (`:107-110`), because
    silently writing a row no tenant can ever read is worse than failing the save. No current tenant
    but an explicitly declared one is allowed through (`:112-113`): that is a seeder or a per-tenant
    background job. A current tenant with no declared value gets the stamp (`:116-120`). A current
    tenant that disagrees with the declared value throws `ForMismatch` (`:122-123`).
  - **`VerifyExistingRow`** (`:131-153`): returns immediately when the scope resolved no tenant
    (`:137-138`), which keeps the system context unrestricted exactly as it is on the read side. It
    then checks **both** recorded values through `FirstForeignTenant` (`:143-146`): the property's
    `OriginalValue` catches touching another tenant's row, and its `CurrentValue` catches reassigning
    this row to another tenant within the same save.
  - **`FirstForeignTenant`** (`:161-167`) and **`IsForeign`** (`:170-171`): the original is reported
    in preference to the current one, because "you touched another tenant's row" is a more useful
    diagnosis than "you renamed its owner" (`:155-160`). `IsForeign` treats null and empty as absent,
    and compares with `StringComparison.Ordinal`.
  - **`EntityTypeName`** (`:174-175`): `ClrType.FullName ?? ClrType.Name`, used only for the failure
    message.
- **Why it's built this way**: **one concern per interceptor** and **registration order is execution
  order** (`:15-21`). This one sits deliberately between the other two: the audit stamps are already
  written when it runs, and the outbox rows the domain-event interceptor adds afterwards describe an
  entity whose tenant is final. It is also **always registered and inert by default** (`:22-28`,
  `DependencyInjection.cs:60-63`): it is a no-op for every entity that does not carry `ITenantEntity`,
  which is every entity in a host that never adopted tenancy, so that host pays nothing while a host
  that does adopt tenancy can never accidentally leave the write guard off. `OnConfiguring` resolves
  it with `GetService` rather than `GetRequiredService` (`ApplicationDbContext.cs:244`) so a
  directly-constructed test or design-time context still builds. See ADR-073.
- **Where it's used**: registered as a singleton in `AddInfrastructure`
  (`DependencyInjection.cs:63`) and attached second in the interceptor chain
  (`ApplicationDbContext.cs:246`); exercised by `TenantSaveChangesInterceptorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantSaveChangesInterceptorTests.cs:12`)
  and by the registration tests in
  `.../Persistence/Tenancy/AddMultiTenancyTests.cs:19`.
- **Caveats / not-in-source**: whether any deployed host in this workspace actually opts into
  multi-tenancy is Not determinable from source, since the guard is registered unconditionally and
  is inert until an entity implements `ITenantEntity`.

### NativePushPayloads

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NativePushPayloads.cs:10` · Level 0 · class (internal static)

- **What it is**: a pure helper that builds the platform-native JSON bodies (FCM v1 for Android, APNs for Apple) and the `user:{id}` OR-tag expressions that an Azure Notification Hubs send needs. It holds no state and touches no hub, so the payload shapes and the tag-chunking rule are unit-testable in isolation (`NativePushPayloads.cs:5-10`).
- **Depends on**: the BCL only: `System.Text.Json.JsonSerializer` for the payload strings, `Enumerable.Chunk` for the OR-expression batching, and the `UserIdentifierType` alias (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)) for the user-tag input.
- **Concept introduced, native push payload construction and the 20-tag chunk rule.** `[Rubric §7, Microservices Readiness]` assesses whether cross-cutting delivery mechanics live behind a reusable, transport-specific boundary rather than smeared through handlers; here the exact wire shapes of two third-party push protocols are pinned in one place. Azure Notification Hubs caps a single tag expression at 20 tags (`MaxTagsPerExpression`, `NativePushPayloads.cs:13`), so a user-targeted broadcast to a large audience is split into `Chunk(20)` groups, each rendered as a `user:a || user:b || ...` OR-expression (`NativePushPayloads.cs:59-63`). That cap is a real hub limit, not an arbitrary batch size, which is why it is a named constant the sender and the registrar both reuse rather than a literal.
- **Walkthrough**: `BuildFcmV1Payload` (`NativePushPayloads.cs:16-28`) nests a `notification` block of `title`/`body` under a `message` envelope, adding a `data` map only when metadata is non-empty (the `{ Count: > 0 }` pattern, `NativePushPayloads.cs:22`). `BuildApnsPayload` (`NativePushPayloads.cs:31-53`) builds the APNs `aps.alert` block, then copies each metadata pair up to the top level as a custom key while explicitly refusing to overwrite the reserved `aps` key (`NativePushPayloads.cs:44-49`). `BuildUserTagExpressions` (`NativePushPayloads.cs:59-63`) maps each id through `UserTag`, chunks, and joins. `UserTag` (`NativePushPayloads.cs:66-67`) formats `user:{userId}` under `InvariantCulture` via `string.Create`, so a numeric id never picks up a locale-specific separator.
- **Why it's built this way**: keeping the payload shapes and the hub's tag cap in a stateless helper ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) means the [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) stays a thin adapter and the fiddly JSON/tag rules can be proven correct without a live hub or credentials.
- **Where it's used**: consumed by [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) (payloads and tag expressions, `AzureNotificationHubNativePushSender.cs:21-24`) and [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) twice: the `UserTag` stamped on each installation (`AzureNotificationHubDeviceRegistrar.cs:41`) and the same tag re-read to verify ownership before a delete (`AzureNotificationHubDeviceRegistrar.cs:112`).
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
- **Where it's used**: its one production subclass is MMCA.Store's `PaymentReconciliationService`, the saga-timeout backstop for the Stripe payment flow (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Services/PaymentReconciliationService.cs:39`). That subclass is a good read for how little a derived sweep has to write: it overrides `Interval` from configuration (`PaymentReconciliationService.cs:46`), `IsEnabled` to log the specific reason it is off rather than the base's generic line (`PaymentReconciliationService.cs:54-72`), and `ExecuteCycleAsync` (`PaymentReconciliationService.cs:75`). The other subclass in the workspace is the `CountingSweep` test double (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Services/PeriodicBackgroundServiceTests.cs:103-104`). MMCA.Common's own hosted services predate the base class and hand-roll their loops directly on `BackgroundService`: [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) is one (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCleanupService.cs:42`).
- **Caveats / not-in-source**: [ADR-054](https://ivanball.github.io/docs/adr/054-saga-compensation-and-reconciliation.html) records that `PaymentReconciliationService` is the base class's only subclass in any of the applications, so adoption is real but narrow; treat the class as an available base rather than as a description of how every sweep in the workspace is built.

### AzureNotificationHubNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubNativePushSender.cs:14` · Level 1 · class (sealed partial)

- **What it is**: the Azure Notification Hubs implementation of [`INativePushSender`](#inativepushsender): the real, mobile-facing native notification channel that pushes FCM v1 and APNs payloads through a hub client (`AzureNotificationHubNativePushSender.cs:7-16`).
- **Depends on**: [`INativePushSender`](#inativepushsender) (the contract it fulfills), [`NativePushPayloads`](#nativepushpayloads) (payload and tag construction), and two externals: `Microsoft.Azure.NotificationHubs.INotificationHubClient` (the hub SDK) and `ILogger<T>`.
- **Concept introduced, the native (mobile) push channel and its best-effort contract.** `[Rubric §13, Observability & Operability]` covers whether side-effecting integrations log their outcomes and fail without taking the request down; this sender emits a structured log per send (`LogNativePushSent`, `AzureNotificationHubNativePushSender.cs:42-43`) and its class comment records that callers treat the channel as best-effort (`AzureNotificationHubNativePushSender.cs:11-12`). That is literally true at the call site: [`SendPushNotificationHandler`](group-10-notifications.md#sendpushnotificationhandler) wraps the native send in a `catch (Exception)` annotated "native delivery is best-effort" (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:147-148`). This is the device-facing counterpart to the in-app SignalR channel: [`NullPushNotificationSender`](group-10-notifications.md#nullpushnotificationsender) and its SignalR sibling deliver to connected web clients, whereas this one reaches devices via APNs and FCM.
- **Walkthrough**: the primary constructor takes the hub client and logger (`AzureNotificationHubNativePushSender.cs:14-16`). `SendToUsersAsync` (`AzureNotificationHubNativePushSender.cs:19-31`) builds both payloads once (`AzureNotificationHubNativePushSender.cs:21-22`), then for each 20-tag OR-expression sends an `FcmV1Notification` and an `AppleNotification` targeted at that expression (`AzureNotificationHubNativePushSender.cs:24-28`), so one call fans out to both platforms per audience chunk. `BroadcastAsync` (`AzureNotificationHubNativePushSender.cs:34-40`) sends the same two payloads with no tag filter, reaching every registered installation. Both `ConfigureAwait(false)` on every await (library code, no sync context needed, [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html)) and log the title on completion.
- **Why it's built this way**: the `partial` class exists so the `[LoggerMessage]` source generator can emit `LogNativePushSent` (`AzureNotificationHubNativePushSender.cs:42-43`), the high-performance logging pattern used across the framework. Splitting payload construction into [`NativePushPayloads`](#nativepushpayloads) ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) keeps this type a pure transport adapter.
- **Where it's used**: registered as a transient `INativePushSender` by `AddNativePushNotifications(configuration)` in place of [`NullNativePushSender`](#nullnativepushsender) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:579`); resolved by [`SendPushNotificationHandler`](group-10-notifications.md#sendpushnotificationhandler) (`SendPushNotificationHandler.cs:21`).

### ExplicitAssemblyProvider

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:126` · Level 1 · class (sealed, private nested)

- **What it is**: a tiny private nested provider inside [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) that returns a fixed, caller-supplied list of entity-configuration assemblies (`DesignTimeDbContextHelper.cs:126-129`).
- **Depends on**: [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) (the contract) and `System.Reflection.Assembly`.
- **Concept reinforced, explicit assembly enumeration in place of runtime scanning.** `[Rubric §8, Data Architecture]` looks at whether the model's entity set is deterministic per database; at runtime the framework discovers configuration assemblies by scanning the AppDomain through [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider), but `dotnet ef` design-time commands see none of that. `GetConfigurationAssemblies` (`DesignTimeDbContextHelper.cs:128`) simply hands back the assemblies the migrations project listed via [`DesignTimeDbContextOptions.AddConfigurationAssembly`](#designtimedbcontextoptions), so the design-time model contains exactly the intended entities and nothing else.
- **Why it's built this way**: it is the design-time substitute for the AppDomain-scanning provider; keeping it private and trivial means the migrations authoring surface stays [`DesignTimeDbContextOptions`](#designtimedbcontextoptions), not this class.
- **Where it's used**: instantiated once inside `DesignTimeDbContextHelper.CreateSqlServer` (`DesignTimeDbContextHelper.cs:57`), passed straight to the [`EntityDataSourceRegistry`](#entitydatasourceregistry) it builds (`DesignTimeDbContextHelper.cs:62`), registered as the `IEntityConfigurationAssemblyProvider` for the design-time container (`DesignTimeDbContextHelper.cs:90`), and handed to the context constructor (`DesignTimeDbContextHelper.cs:99`).
- **Caveats / not-in-source**: private nested type; it surfaces in the inventory only because the tool includes private nested classes. Not reachable from outside the helper.

### NullNativePushSender

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullNativePushSender.cs:10` · Level 1 · class (sealed)

- **What it is**: the no-op default implementation of [`INativePushSender`](#inativepushsender): both methods return `Task.CompletedTask`, so the native-push channel always resolves and silently does nothing until a host opts in (`NullNativePushSender.cs:5-19`).
- **Depends on**: [`INativePushSender`](#inativepushsender) only.
- **Concept reinforced, the Null Object pattern as the safe default channel.** `[Rubric §2, Design Patterns]` values a harmless default that satisfies a contract without a live dependency; registering this type by default means DI resolution and the Devices/send endpoints work everywhere, even in a host with no notification hub. The real [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) is swapped in only when `AddNativePushNotifications(configuration)` runs against an enabled, fully-configured hub (`NullNativePushSender.cs:6-9`).
- **Walkthrough**: `SendToUsersAsync` and `BroadcastAsync` (`NullNativePushSender.cs:13-18`) each match the interface signature and return a completed task; there is no logging and no failure, by design.
- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) gives the framework three notification channels; a no-op default keeps the native channel optional, so a host that never configures a hub still composes and runs.
- **Where it's used**: registered with `TryAddTransient` as the default `INativePushSender` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:478`), paired with [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar) on the next line for the same disabled-hub scenario (`DependencyInjection.cs:479`).

### TenantContext

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/TenantContext.cs:11` · Level 1 · class (sealed)

- **What it is**: the scoped holder of "which tenant is this scope running as". One instance per DI scope, unresolved until something calls `SetTenant`, which is the state every background service, seeder, and design-time tool stays in (`TenantContext.cs:6-11`).
- **Depends on**: [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) (the Application-layer contract it implements) and `System.Globalization.CultureInfo` for the exception message.
- **Concept introduced, the ambient tenant as a scoped value with a one-way latch.** `[Rubric §11, Security]` assesses whether isolation boundaries are enforced rather than trusted, and `[Rubric §8, Data Architecture]` covers how a shared database keeps tenants apart. Multi-tenancy here ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) is row-level by default: the model gives every non-owned `ITenantEntity` a global query filter whose predicate lifts `ApplicationDbContext.CurrentTenantId` into a SQL parameter (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:99` and `:402-421`), and [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor) stamps or verifies `TenantId` on every write (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:66-86`). This class is the single value both of those read. Two design decisions are worth internalizing before you write anything tenant-aware:
  - **An unresolved tenant means "see everything", not "see nothing".** There is deliberately no generated fallback the way [`ICorrelationContext`](group-12-api-hosting-mapping.md#icorrelationcontext) has one, because a background worker or a seeder legitimately runs outside any tenant, and inventing an id would silently scope a system operation to a tenant that does not exist (`ITenantContext.cs:9-15`). The filter's `CurrentTenantId == null` disjunct is what implements that (`ApplicationDbContext.cs:388`).
  - **One scope, one tenant.** Changing the tenant mid-scope is refused, because rows already read or tracked in the scope were read under the first tenant and there is no honest way to reconcile that afterwards (`ITenantContext.cs:16-20`).
- **Walkthrough**: `TenantId` is a `private set` auto-property (`TenantContext.cs:14`) and `IsResolved` is simply `TenantId is not null` (`TenantContext.cs:17`). `SetTenant` (`TenantContext.cs:20-44`) does three things in order: it rejects null/empty/whitespace up front with `ArgumentException.ThrowIfNullOrWhiteSpace` (`TenantContext.cs:22`); it latches the value when none is held yet (`TenantContext.cs:24-28`); and when a value is already held it compares ordinally, returning quietly for the same tenant (idempotent, so the resolution middleware and a worker re-asserting the tenant on the same scope do not fight, `TenantContext.cs:30-35`) and throwing an `InvalidOperationException` for a different one. That exception message names both tenants and tells the caller what to do instead: start a new scope (`TenantContext.cs:37-43`).
- **Why it's built this way**: the registration is unconditional. `AddServices` registers it with `TryAddScoped` whether or not the host called `AddMultiTenancy`, and the comment says why: everything that reads it treats an unresolved tenant as "no tenancy", so always-on registration costs one object per scope and removes a whole class of "works until someone forgets the opt-in" bug (`DependencyInjection.cs:448-452`). `AddMultiTenancy` binds and validates the `Tenancy` settings and switches on *resolution* at the edge; it does not install the isolation, which is always present and always inert (`DependencyInjection.cs:402-409`).
- **Where it's used**: written at the API edge by [`TenantResolutionMiddleware`](group-12-api-hosting-mapping.md#tenantresolutionmiddleware) from the configured claim or header (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:70`), and re-asserted on a fresh scope by every background path that must run as a tenant: [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) (`OutboxProcessor.cs:246`), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) (`OutboxCleanupService.cs:100`), [`AuditTrailCleanupJob`](#audittrailcleanupjob) (`AuditTrailCleanupJob.cs:106`), and the per-tenant database initializer (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:128`). It is read by [`DbContextFactory`](#dbcontextfactory) for per-tenant database routing (`DbContextFactory.cs:44`) and by the caching decorators, which scope cache keys through `TenantCacheKey.Scope` (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TenantCacheKey.cs:37`, used by `CachingQueryDecorator.cs:38` and `CachingCommandDecorator.cs:36`).

### DesignTimeDbContextOptions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:11` · Level 2 · class (sealed)

- **What it is**: the configuration carrier a migrations project fills in to tell [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) how to build a context for `dotnet ef ... -- --datasource <Name>`. It holds the connection settings, the named data-source entries, two model-shape flags, and the explicit list of entity-configuration assemblies (`DesignTimeDbContextOptions.cs:11-61`).
- **Depends on**: [`ConnectionStringSettings`](group-14-module-system-composition.md#connectionstringsettings), [`DataSourceEntrySettings`](group-14-module-system-composition.md#datasourceentrysettings), and `System.Reflection.Assembly`.
- **Concept introduced, design-time context construction for database-per-service.** `[Rubric §8, Data Architecture]` assesses whether each database's migrations are built in isolation; in the database-per-service model ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) each module's migrations project must scaffold a context for only its own database. At design time there is no DI container and no AppDomain scan, so this options object captures everything `dotnet ef` cannot discover on its own: the top-level connection strings including `SQLServerMigrationsAssembly` (`DesignTimeDbContextOptions.cs:20-24`), the named `DataSources` entries (`DesignTimeDbContextOptions.cs:26-27`), and the explicit configuration assemblies (`DesignTimeDbContextOptions.cs:57-61`, whose comment notes the runtime scan sees nothing here).
- **Walkthrough**
  - `DataSourceName` (`DesignTimeDbContextOptions.cs:18`) is optional; when null the helper parses `--datasource` and falls back to `Default`.
  - **`EnableScheduler`** (`DesignTimeDbContextOptions.cs:41`) mirrors `Scheduler:Enabled` and decides whether the `ScheduledJobs` table is part of the design-time model. It defaults to `false` so `dotnet ef` keeps producing exactly the migrations it produced before the scheduler shipped ([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)). The remarks are the operational rule: set it in the migrations project of the `Default` data source of a host that calls `AddScheduledJobs`, and **only** there, because the table is host-scoped and a second migrations project that also enabled it would create a second copy (`DesignTimeDbContextOptions.cs:35-40`).
  - **`EnableAuditTrail`** (`DesignTimeDbContextOptions.cs:55`) mirrors `AuditTrail:Enabled` for the `AuditTrailEntries` change-history table ([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)), and the rule is the inverse of the scheduler's: set it in **every** data source whose entities are audited, because a trail row is written to the database holding the entity that changed (`DesignTimeDbContextOptions.cs:49-54`). Both flags carry the same warning: the flag must match the host's configuration or the scaffolded migrations and the running model disagree.
  - `AddConfigurationAssembly` (`DesignTimeDbContextOptions.cs:66-75`) is a chainable builder method that null-guards and skips duplicates before adding.
- **Why it's built this way**: a single options object plus a builder method keeps each per-module migrations factory to a handful of lines while still pinning the model to one database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The two boolean flags exist because the model is configuration-shaped: opt-in tables would otherwise be invisible to `dotnet ef`, which has no configuration to read.
- **Where it's used**: passed to `DesignTimeDbContextHelper.CreateSqlServer(args, options => ...)` from each per-database migrations factory; the helper's class doc shows the exact shape (`DesignTimeDbContextHelper.cs:20-32`), and a real one is `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/DesignTimeSQLServerDbContextFactory.cs:15-51`, which sets `DataSourceName = "Conference"` (`:32`) and both flags to true (`:37-38`).

### NullDomainEventDispatcher

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:131` · Level 2 · class (sealed, private nested)

- **What it is**: a no-op [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) used only inside the design-time context helper, never in production. `DispatchAsync` returns `Task.CompletedTask` (`DesignTimeDbContextHelper.cs:131-135`).
- **Depends on**: [`IDomainEvent`](group-04-events-outbox.md#idomainevent) and [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher).
- **Concept reinforced, the Null Object pattern for a design-time DI gap.** `[Rubric §2, Design Patterns]` values satisfying an interface with a harmless no-op when the real implementation would need the full application container. During `dotnet ef migrations add` the design-time factory builds a context but never saves through it, so a real dispatcher (which would try to hand events to handlers that are not registered here) would be both unnecessary and wrong. Registering this null dispatcher (`DesignTimeDbContextHelper.cs:68`) closes that dependency without pulling in application services, because [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) is itself registered in that minimal container (`DesignTimeDbContextHelper.cs:71`) and demands one.
- **Why it's built this way**: the design-time service graph is deliberately minimal (null loggers, null dispatcher, a hand-built `ServiceCollection`) so scaffolding a migration never spins up the app; this type is one leaf of that minimal graph.
- **Where it's used**: registered as the `IDomainEventDispatcher` inside `DesignTimeDbContextHelper.CreateSqlServer` (`DesignTimeDbContextHelper.cs:68`).
- **Caveats / not-in-source**: private nested type inside [`DesignTimeDbContextHelper`](#designtimedbcontexthelper); not accessible from outside.

### DataSourceService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12` · Level 3 · class (sealed)

- **What it is**: the application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry): given an entity type (or its full name) it answers which physical data source that entity lives in, and whether two entities can be EF-`Include`d together (`DataSourceService.cs:6-12`).
- **Depends on**: [`IDataSourceService`](#idatasourceservice) (the contract), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (the eager routing table it delegates to), and the [`DataSourceKey`](#datasourcekey) and [`DataSource`](#datasource) value types.
- **Concept reinforced, entity-to-database routing as a query surface.** `[Rubric §8, Data Architecture]` assesses whether database-per-service routing is a first-class, queryable concept; the registry aggregates every `[UseDataSource]` and `[UseDatabase]` declaration at startup, and this facade is the thin runtime interface over it. Because the registry is built eagerly from configuration assemblies (`DataSourceService.cs:8-11`), resolution no longer waits for an EF model to be built, which matters for the navigation classification that runs before any query.
- **Walkthrough**: the four `GetDataSource*` overloads (`DataSourceService.cs:15-24`) forward straight to the registry, returning either the full [`DataSourceKey`](#datasourcekey) or just its `Engine` ([`DataSource`](#datasource)). `HaveIncludeSupport(DataSourceKey, DataSourceKey)` (`DataSourceService.cs:31-32`) encodes the eager-loading rule: an EF `Include` is valid only when both entities resolve to the *same* key **and** that engine is not Cosmos (`first == second && first.Engine != DataSource.CosmosDB`), because Cosmos has no cross-document joins (`DataSourceService.cs:27-30`). The string overload (`DataSourceService.cs:35-38`) resolves both names through `TryGetDataSourceKey` and defers to the key overload, returning false if either name is unknown.
- **Why it's built this way**: keeping the include-support rule in one predicate lets the navigation metadata and cross-source degrade logic ask a single authority whether a relationship can be loaded in-database versus batch-loaded across sources ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Facading the registry keeps callers off its lower-level API.
- **Where it's used**: registered with `TryAddSingleton` as the `IDataSourceService` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:53`); injected into [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20`), which classifies navigations per process, and into [`UnitOfWork`](#unitofwork) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13`), which uses it to pick the context for an entity (`UnitOfWork.cs:29`).

### AzureBlobFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureBlobFileStorageService.cs:15` · Level 4 · class (sealed)

- **What it is**: the Azure Blob Storage implementation of [`IFileStorageService`](#ifilestorageservice): uploads and deletes blobs in the single configured container, returning [`Result`](group-01-result-error-handling.md#result) instead of throwing (`AzureBlobFileStorageService.cs:10-17`).
- **Depends on**: [`IFileStorageService`](#ifilestorageservice), the [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error) types, and Azure externals `BlobContainerClient` / `BlobUploadOptions` / `RequestFailedException` plus `ILogger<T>`.
- **Concept introduced, the file-storage boundary and Result-wrapped I/O.** `[Rubric §10, Cross-Cutting Concerns]` covers pushing infrastructure integrations behind an application-owned contract; here blob I/O is hidden behind [`IFileStorageService`](#ifilestorageservice) and every SDK failure is caught and mapped to a domain [`Error`](group-01-result-error-handling.md#error) rather than bubbling as an exception. `IsConfigured => true` (`AzureBlobFileStorageService.cs:20`) is the flag that distinguishes this live implementation from the [`NullFileStorageService`](#nullfilestorageservice) fallback.
- **Walkthrough**: the constructor takes an already-resolved `BlobContainerClient` and a logger (`AzureBlobFileStorageService.cs:15-17`); the class comment notes the container and its public-access level are provisioned by infrastructure, not created here (`AzureBlobFileStorageService.cs:12-13`). `UploadAsync` (`AzureBlobFileStorageService.cs:23-43`) gets a blob client, uploads with an explicit `ContentType` header (`AzureBlobFileStorageService.cs:30`), and returns `Result.Success(blobClient.Uri)`; a `RequestFailedException` is logged and mapped to `Error.Failure("FileStorage.UploadFailed", ...)` (`AzureBlobFileStorageService.cs:35-42`). `DeleteAsync` (`AzureBlobFileStorageService.cs:46-62`) calls `DeleteBlobIfExistsAsync` (idempotent) and maps failures to `FileStorage.DeleteFailed`.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) introduces the file-storage and image pipeline; returning `Result` keeps storage failures on the same error-handling rail as the rest of the stack, and catching only `RequestFailedException` means genuinely unexpected errors still surface.
- **Where it's used**: registered as a transient `IFileStorageService` by `AddAzureBlobFileStorage(configuration)` in place of [`NullFileStorageService`](#nullfilestorageservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:620`). The `BlobContainerClient` it receives is built one registration earlier (`DependencyInjection.cs:613-619`) and picks its auth mode from configuration: an absolute `FileStorage:ServiceUri` means `DefaultAzureCredential` (managed identity, the production path), otherwise a connection string (local Azurite); an incomplete section makes the whole call a no-op so hosts can register it unconditionally (`DependencyInjection.cs:600-611`). Consumed by the ADC Identity avatar handlers, for example [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:19`), [`RemoveUserAvatarHandler`](group-24-identity-module.md#removeuseravatarhandler) (`RemoveUserAvatarHandler.cs:16`), and [`DeleteUserHandler`](group-24-identity-module.md#deleteuserhandler) (`DeleteUserHandler.cs:30`), typically after [`ImageSharpImageProcessor`](#imagesharpimageprocessor) has normalized the bytes.

### AzureNotificationHubDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/AzureNotificationHubDeviceRegistrar.cs:15` · Level 4 · class (sealed)

- **What it is**: the Azure Notification Hubs implementation of [`IPushDeviceRegistrar`](#ipushdeviceregistrar): it registers (upserts) and unregisters a device's push installation using the hub's installation model, stamping each installation with its owner's `user:{id}` tag and verifying that tag before an owner-scoped delete (`AzureNotificationHubDeviceRegistrar.cs:10-17`).
- **Depends on**: [`IPushDeviceRegistrar`](#ipushdeviceregistrar), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest) (the inbound DTO), [`NativePushPayloads`](#nativepushpayloads) (the owner tag), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error), and Azure externals `INotificationHubClient` / `Installation` / `MessagingException` / `MessagingEntityNotFoundException`.
- **Concept introduced, device registration via the installation model, and the tag as the ownership record.** `[Rubric §11, Security]` includes owner-scoping of side channels. By stamping every installation with `NativePushPayloads.UserTag(userId)` (`AzureNotificationHubDeviceRegistrar.cs:41`) the registrar guarantees a later user-targeted send reaches only that user's devices, and gives the delete path something to check: the hub is the only ownership store, so read-then-delete is the check (`AzureNotificationHubDeviceRegistrar.cs:84-87`). The installation model uses client-owned stable ids with full upsert semantics (`AzureNotificationHubDeviceRegistrar.cs:11-13`), so re-registering the same device is idempotent rather than duplicating.
- **Walkthrough**
  - **`UpsertAsync`** (`AzureNotificationHubDeviceRegistrar.cs:20-57`) first maps the request's platform string to a `NotificationPlatform` via a `switch` over `FCMV1` and `APNS` (`:22-27`); an unrecognized value returns `Error.Validation("PushDevice.UnsupportedPlatform", ...)` before any hub call (`:28-34`). It then builds an `Installation` with the client id, platform, push channel, and the single user tag (`:36-42`) and calls `CreateOrUpdateInstallationAsync`, mapping a `MessagingException` to `PushDevice.UpsertFailed` (`:49-56`).
  - **`DeleteAsync(string installationId, ...)`** (`:60-77`) is the unscoped overload: it deletes and treats `MessagingEntityNotFoundException` as success (`:67-71`), because an unknown installation is already in the desired state. The interface remarks are emphatic that this overload performs no ownership check and must not be reached from a caller-supplied id; it stays for server-initiated cleanup where the owner is already established (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPushDeviceRegistrar.cs:24-29`).
  - **`DeleteAsync(UserIdentifierType userId, string installationId, ...)`** (`:80-109`) is the one an authenticated endpoint calls. It reads the installation, checks the owner tag through the private `OwnedBy` helper (`:111-112`), and deletes only on a match. A mismatch returns `Result.Success()` **without** deleting (`:89-94`): answering differently for "no such installation" and "not yours" would turn the endpoint into an existence oracle for other users' installation ids, and the caller has nothing to do with either answer (`IPushDeviceRegistrar.cs:40-48`). Both delete overloads funnel their `MessagingException` mapping through the private `DeleteFailed()` factory (`:114-118`).
- **Why it's built this way**: [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)'s native channel needs a way to associate devices with users; the tag-per-installation approach lets sends target `user:{id}` OR-expressions without the app keeping its own device table, and it doubles as the ownership record the scoped delete verifies. Idempotent delete keeps client retries safe. The default interface implementation of the scoped overload delegates to the unscoped one (`IPushDeviceRegistrar.cs:54-55`) so out-of-framework implementations keep compiling; this class overrides it because it can actually verify ownership.
- **Where it's used**: registered as a transient `IPushDeviceRegistrar` by `AddNativePushNotifications(configuration)` in place of [`NullPushDeviceRegistrar`](#nullpushdeviceregistrar) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:580`); called by [`DevicesController`](group-10-notifications.md#devicescontroller), which passes the authenticated user id into both operations (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:43` and `:67`), and paired with [`AzureNotificationHubNativePushSender`](#azurenotificationhubnativepushsender) for the send side.
- **Caveats / not-in-source**: the ownership check is a read followed by a delete, not an atomic operation. The source says why that is acceptable: a concurrent re-registration of the same id between the two calls is the owner's own doing, so no lock is warranted (`AzureNotificationHubDeviceRegistrar.cs:86-87`). An installation registered before ownership tagging existed has no tag, so it is treated as someone else's and is not deleted (`:91-92`).

### ImageSharpImageProcessor

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/ImageSharpImageProcessor.cs:14` · Level 4 · class (sealed)

- **What it is**: the ImageSharp implementation of [`IImageProcessor`](#iimageprocessor): it decodes an uploaded image, re-orients and crops it to a square, strips all metadata, and re-encodes it as JPEG, returning the bytes as a [`Result`](group-01-result-error-handling.md#result) (`ImageSharpImageProcessor.cs:9-17`).
- **Depends on**: [`IImageProcessor`](#iimageprocessor), [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error), and the SixLabors.ImageSharp externals (`Image`, `Mutate`, `ResizeOptions`, `JpegEncoder`).
- **Concept introduced, full re-encode as a security control.** `[Rubric §11, Security]` and `[Rubric §30, Compliance/Privacy/Data Governance]` both apply: decoding to pixels and re-encoding is deliberate so that EXIF metadata (including GPS coordinates, which are PII) and any polyglot payload smuggled into the original file are discarded, since only pixels survive the round trip (`ImageSharpImageProcessor.cs:9-13`). This is a defense against both privacy leaks and image-parser exploits, not merely a resize. Its upload-side companion is [`ImageContentSniffer`](#imagecontentsniffer), which decides the accepted formats (jpeg, png, webp) from the magic bytes rather than the client-declared content type or extension before the stream reaches this processor (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/ImageContentSniffer.cs:3-16`).
- **Walkthrough**: `NormalizeToSquareJpegAsync` (`ImageSharpImageProcessor.cs:17-51`) loads the stream, then `Mutate`s with `AutoOrient()` *before* stripping metadata so a portrait phone photo is not left rotated (`ImageSharpImageProcessor.cs:23-31`), and resizes to `size x size` with `ResizeMode.Crop`. It then nulls out the EXIF, XMP, and IPTC profiles (`ImageSharpImageProcessor.cs:33-35`) and saves to a `MemoryStream` with `JpegEncoder { Quality = 85 }` (`ImageSharpImageProcessor.cs:40`), returning `Result.Success(output.ToArray())`. An `UnknownImageFormatException` or `InvalidImageContentException` is caught by an exception filter and mapped to `Error.Validation("Image.Undecodable", ...)` (`ImageSharpImageProcessor.cs:44-50`), so a garbage upload becomes a clean validation failure rather than a 500.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) pairs storage with sanitization; ordering `AutoOrient` before metadata removal is the subtle correctness detail, and quality 85 is the standard size/quality trade-off. Catching only the two ImageSharp decode exceptions keeps unexpected faults visible.
- **Where it's used**: registered with `TryAddSingleton` as the `IImageProcessor` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:484`, whose comment notes it is dependency-free and therefore always the real implementation, `DependencyInjection.cs:481-482`); invoked by [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:18`) before the bytes are handed to [`AzureBlobFileStorageService`](#azureblobfilestorageservice). There is no Null variant because processing needs no external resource.

### NullFileStorageService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullFileStorageService.cs:11` · Level 4 · class (sealed)

- **What it is**: the unconfigured-host fallback for [`IFileStorageService`](#ifilestorageservice): uploads fail with a clear error while deletes succeed, so file features degrade cleanly instead of crashing (`NullFileStorageService.cs:6-11`).
- **Depends on**: [`IFileStorageService`](#ifilestorageservice) and [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error).
- **Concept reinforced, an asymmetric Null Object (fail-closed write, no-op delete).** `[Rubric §2, Design Patterns]` and `[Rubric §10, Cross-Cutting Concerns]`: unlike a pure no-op, this fallback distinguishes its two operations by intent. `IsConfigured => false` (`NullFileStorageService.cs:14`) lets callers detect the disabled channel; `UploadAsync` returns `Error.Failure("FileStorage.NotConfigured", ...)` (`NullFileStorageService.cs:17-21`) so a write fails loudly and predictably, while `DeleteAsync` returns `Result.Success()` (`NullFileStorageService.cs:24-25`) because there is nothing to delete and a delete of a non-existent file is already the desired state.
- **Why it's built this way**: [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html) makes storage optional; failing uploads with a typed error (rather than a null-reference crash) keeps a host with no storage configured running and honest about what it cannot do.
- **Where it's used**: registered with `TryAddTransient` as the default `IFileStorageService` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:483`), swapped for [`AzureBlobFileStorageService`](#azureblobfilestorageservice) by `AddAzureBlobFileStorage(configuration)` (`DependencyInjection.cs:595-623`).

### NullPushDeviceRegistrar

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/NullPushDeviceRegistrar.cs:12` · Level 4 · class (sealed)

- **What it is**: the no-op default for [`IPushDeviceRegistrar`](#ipushdeviceregistrar): it accepts and discards device registrations so clients can call the Devices endpoints unconditionally, storing nothing until a hub is configured (`NullPushDeviceRegistrar.cs:7-12`).
- **Depends on**: [`IPushDeviceRegistrar`](#ipushdeviceregistrar), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest), and [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced, the Null Object pattern for the disabled native channel.** `[Rubric §2, Design Patterns]`: `UpsertAsync` and both `DeleteAsync` overloads return `Result.Success()` (`NullPushDeviceRegistrar.cs:15-24`), so the Devices API is always callable and simply does nothing when no notification hub is wired up. Note that it implements the owner-scoped delete explicitly rather than inheriting the interface's default (which would delegate to the unscoped overload): the outcome is identical, and being explicit keeps the no-op honest about supporting the full contract. It is the device-registration twin of [`NullNativePushSender`](#nullnativepushsender), which no-ops the send side of the same disabled channel ([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)).
- **Why it's built this way**: keeping registration a success (rather than an error) means a client that always registers on launch is not blocked by a host that has not enabled native push; the channel becomes real only when [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) is registered.
- **Where it's used**: registered with `TryAddTransient` as the default `IPushDeviceRegistrar` in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:479`), replaced by [`AzureNotificationHubDeviceRegistrar`](#azurenotificationhubdeviceregistrar) when `AddNativePushNotifications(configuration)` finds an enabled hub (`DependencyInjection.cs:580`).

### DesignTimeDbContextHelper

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:36` · Level 8 · class (static)

- **What it is**: a static helper that builds a [`SQLServerDbContext`](#sqlserverdbcontext) for `dotnet ef` design-time commands **without** the application's DI container, so each per-database migrations project reduces to a few lines (`DesignTimeDbContextHelper.cs:18-36`).
- **Depends on**: EF Core (`DbContextOptionsBuilder`, the caller-implemented `IDesignTimeDbContextFactory`), the data-source resolution stack ([`DataSourceResolver`](#datasourceresolver), [`EntityDataSourceRegistry`](#entitydatasourceregistry), [`DataSourcesSettings`](group-14-module-system-composition.md#datasourcessettings)), the four save interceptors ([`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor), [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor), [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor), [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor)), the options types [`TenancySettings`](group-14-module-system-composition.md#tenancysettings) / [`SchedulerSettings`](group-14-module-system-composition.md#schedulersettings) / [`AuditTrailSettings`](group-14-module-system-composition.md#audittrailsettings), [`IOutboxSignal`](group-04-events-outbox.md#ioutboxsignal) / [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), and its own two private nested leaves [`ExplicitAssemblyProvider`](#explicitassemblyprovider) and [`NullDomainEventDispatcher`](#nulldomaineventdispatcher).
- **Concept introduced, design-time context construction for migrations-per-database.** `[Rubric §17, DevOps]` and `[Rubric §33, Developer Experience]`: database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) needs one migrations project per database, and scaffolding a migration must not require standing up the whole app. `CreateSqlServer(args, configure)` (`DesignTimeDbContextHelper.cs:45-101`) lets a migrations project implement EF's `IDesignTimeDbContextFactory<SQLServerDbContext>` in a callback that supplies connection settings, model-shape flags, and configuration assemblies (the pattern is shown verbatim in the class doc, `DesignTimeDbContextHelper.cs:20-32`).
- **Walkthrough**
  - **Argument handling and source selection** (`DesignTimeDbContextHelper.cs:45-55`): both parameters are null-guarded, the caller's `configure` runs over a fresh [`DesignTimeDbContextOptions`](#designtimedbcontextoptions), and the logical source name is resolved in priority order: explicit `DataSourceName`, else `--datasource` from args, else `DataSourceKey.DefaultName`.
  - **The routing stack** (`:57-62`): an [`ExplicitAssemblyProvider`](#explicitassemblyprovider) over the listed assemblies, a [`DataSourceResolver`](#datasourceresolver) built from the supplied connection settings and `DataSources` entries with a `NullLogger`, and an [`EntityDataSourceRegistry`](#entitydatasourceregistry) over the two.
  - **The minimal container** (`:64-92`) is hand-built as a plain `ServiceCollection`: `TimeProvider.System`, null logger factory and null generic loggers, the [`NullDomainEventDispatcher`](#nulldomaineventdispatcher), an [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), and the interceptors. The tenant interceptor and a default [`TenancySettings`](group-14-module-system-composition.md#tenancysettings) are registered **unconditionally**, and the comment explains the reasoning: design time never resolves a tenant, so the interceptor is inert and the `Tenant` query filter short-circuits, which means the scaffolded migration is identical with or without tenancy apart from the `TenantId` column and index the model declares (`:72-78`). [`SchedulerSettings`](group-14-module-system-composition.md#schedulersettings) and [`AuditTrailSettings`](group-14-module-system-composition.md#audittrailsettings) are created from the two `DesignTimeDbContextOptions` flags (`:82-88`), which is how an opt-in table becomes part of the design-time model; the audit-trail interceptor is registered even though the context resolves it with `GetService`, purely to keep the design-time pipeline identical to the runtime one (`:84-89`).
  - **Construction** (`:94-100`): the logical name is collapsed to a physical one through `resolver.GetPhysical(resolver.ResolveLogical(DataSource.SQLServer, logicalName))`, then the [`SQLServerDbContext`](#sqlserverdbcontext) is built with an empty options builder, the built service provider, the assembly provider, and that physical key, so the model contains only the selected source's entities.
  - **`ParseDataSourceName`** (`:106-124`) reads `--datasource <Name>` or `--datasource=Name`, throwing an actionable `InvalidOperationException` if the flag is present with no value (`:112-114`).
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) requires per-database migrations; a shared design-time helper keeps each migrations project trivial and avoids booting the full application DI graph just to scaffold a migration. The pattern in the registrations above is "register everything the runtime registers, defaulted to inert", because the failure mode this guards against is a scaffolded migration that quietly differs from the running model.
- **Where it's used**: called from each per-database migrations factory, for example `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/DesignTimeSQLServerDbContextFactory.cs:15` and its Identity, Engagement, and Notification siblings, MMCA.Store's Catalog/Sales/Identity factories, and MMCA.Helpdesk's single Tickets factory (`MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/DesignTimeSQLServerDbContextFactory.cs:25`). It is invoked as `dotnet ef migrations add X --project ... -- --datasource <Name>` (`DesignTimeDbContextHelper.cs:33-34`), and covered directly by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DesignTimeDbContextHelperTests.cs:37`.
- **Caveats / not-in-source**: the ADC Conference factory is worth reading beside this helper for the one non-obvious trap. It deliberately gives the top-level connection string and the named `Conference` entry the **same** value so the design-time source collapses onto `Default` exactly as the running host's does; without the collapse the physical key would be the named `Conference` key and the host-scoped `ScheduledJobs` table would be missing from the scaffolded model while present in the running one (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/DesignTimeSQLServerDbContextFactory.cs:17-27`).

### IEntityDataSourceRegistry

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/IEntityDataSourceRegistry.cs:11` · Level 2 · interface

- **What it is**: the contract for the eagerly-built registry that maps every configured entity type to the physical database it lives in. Four members: `GetDataSourceKey(Type)` (`IEntityDataSourceRegistry.cs:17`), `GetDataSourceKey(string entityFullName)` (`IEntityDataSourceRegistry.cs:23`), `TryGetDataSourceKey(string, out DataSourceKey)` (`IEntityDataSourceRegistry.cs:29`), and `GetPhysicalSourcesInUse()` (`IEntityDataSourceRegistry.cs:35`).
- **Depends on**: [`DataSourceKey`](#datasourcekey) (the `(Engine, Name)` pair every member trades in).
- **Concept introduced, eager entity-to-database mapping.** `[Rubric §8, Data Architecture]` assesses whether database routing is a deliberate, discoverable design rather than an accident of query order; `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without rewriting application code. The doc comment (`IEntityDataSourceRegistry.cs:5-10`) states why the interface exists at all: it replaces a legacy lazy cache that was populated as a *side effect* of EF model building, so routing decisions (unit of work, navigation classification, outbox enumeration) no longer depend on a model having been built first. `GetPhysicalSourcesInUse()` returns the distinct databases this host actually uses, which is how migrations, `EnsureCreated`, and the outbox processor know which databases to touch (`IEntityDataSourceRegistry.cs:31-35`). The two strict `GetDataSourceKey` overloads are documented to throw `InvalidOperationException` for an unregistered entity (`IEntityDataSourceRegistry.cs:16`, `IEntityDataSourceRegistry.cs:22`), while `TryGetDataSourceKey` is the non-throwing probe used where a miss is legitimate, for example when [`ApplicationDbContext`](#applicationdbcontext) decides whether an entity belongs in the model it is currently building (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:633-635`).
- **Why it's built this way**: database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) needs every entity to resolve to exactly one physical source; deriving that map from configuration classes instead of from a built model turns a misconfiguration into a loud startup failure instead of a silent wrong-database query.
- **Where it's used**: implemented by [`EntityDataSourceRegistry`](#entitydatasourceregistry) and registered as a singleton in `AddInfrastructure` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:79`). Consumers include [`DbContextFactory`](#dbcontextfactory) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:41`), [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:35`), [`DataSourceService`](#datasourceservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/DataSourceService.cs:12`), the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:55`), the [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCleanupService.cs:45`), the [`AuditTrailCleanupJob`](#audittrailcleanupjob) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailCleanupJob.cs:50`), both model-building passes of [`ApplicationDbContext`](#applicationdbcontext) (`ApplicationDbContext.cs:290`, `ApplicationDbContext.cs:625`), and the startup database-initialization path (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:46`).

### PhysicalDataSource

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:17` · Level 2 · record (sealed)

- **What it is**: the fully-resolved connection information for one physical database: `Key` (its engine plus name identity), `ConnectionString`, `SqlServerMigrationsAssembly?`, and `CosmosDatabaseName` (`PhysicalDataSource.cs:17-21`).
- **Depends on**: [`DataSourceKey`](#datasourcekey).
- **Concept, a logical name resolved into a real connection.** `[Rubric §8, Data Architecture]` covers the step from a configured name like `DataSources:Conference` to an actual database. The record's doc comment (`PhysicalDataSource.cs:5-9`) explains that it is produced by [`IDataSourceResolver`](#idatasourceresolver) from the top-level `ConnectionStrings` section (the `Default` source) plus the named `DataSources` entries. Two members are engine-scoped: `SqlServerMigrationsAssembly` is null for non-SQL-Server engines and lets each SQL database own its own EF migration history (`PhysicalDataSource.cs:12-15`); `CosmosDatabaseName` is ignored for relational engines (`PhysicalDataSource.cs:16`). Being a positional `record` buys two things at once here: value equality, so two resolutions of the same source compare equal, and non-destructive mutation, which is exactly how per-tenant routing is implemented.
- **Walkthrough**
  - `Key` is the identity the rest of the stack routes on, and it is deliberately *not* recomputed when the connection changes. [`DbContextFactory.ResolveTenantOverride`](#dbcontextfactory) clones the shared source with `shared with { ConnectionString = ..., CosmosDatabaseName = ... }` and keeps the original key, because the key is what EF's model cache is keyed on, so swapping only the connection string is what lets one compiled model serve every tenant's database (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:142-172`, [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).
  - `ConnectionString` may legitimately be empty. Both the startup initializer and `EnsureCreatedAsync` treat an empty connection string as "this source is not configured in this host" and skip it rather than failing (`DatabaseInitializationExtensions.cs:61`, `DbContextFactory.cs:205-208`).
  - `SqlServerMigrationsAssembly` is what makes one migrations project per database possible; [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) resolves a named source and hands the same record to the design-time context (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:94-97`).
- **Where it's used**: produced by [`DataSourceResolver`](#datasourceresolver) (`DataSourceResolver.cs:156-160` for the Default source, `DataSourceResolver.cs:200-204` for named ones) and handed back by `GetPhysical` (`DataSourceResolver.cs:63`); consumed by [`PhysicalDbContextFactory`](#physicaldbcontextfactory), whose `Create(DataSourceKey)` resolves it and whose `Create(DataSourceKey, PhysicalDataSource)` overload accepts an already-resolved one, which is the entry point the tenant clone uses (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:34-37`).

### Snapshot

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:25` · Level 2 · record (sealed, private nested)

- **What it is**: the immutable point-in-time view of [`EntityDataSourceRegistry`](#entitydatasourceregistry)'s state, with three members: `FrozenDictionary<string, (DataSourceKey Key, Type ConfigurationType)> Entities`, `FrozenSet<Assembly> ScannedAssemblies`, and the precomputed `IReadOnlyCollection<DataSourceKey> PhysicalSources` (`EntityDataSourceRegistry.cs:25-28`).
- **Depends on**: [`DataSourceKey`](#datasourcekey); `System.Collections.Frozen` and `System.Reflection.Assembly` (BCL).
- **Concept introduced, the lock-free volatile-snapshot pattern.** `[Rubric §12, Performance & Scalability]` assesses whether hot-path reads avoid contention. The registry holds `private volatile Snapshot? _snapshot` (`EntityDataSourceRegistry.cs:31`) and reads it without a lock, relying on `volatile` for the store/load barrier so every thread sees a fully-published reference. Writes (the initial build and any rescan) take `Lock _rebuildLock` (`EntityDataSourceRegistry.cs:30`) for mutual exclusion and then swap in a brand-new `Snapshot`. Because `FrozenDictionary` and `FrozenSet` cannot change once built, any number of readers share one snapshot with zero synchronization, and a rescan never mutates the instance a reader is holding.
- **Walkthrough**
  - `Entities` maps an entity's full CLR type name to a tuple of the resolved [`DataSourceKey`](#datasourcekey) *and* the configuration type that produced it (`EntityDataSourceRegistry.cs:26`). The configuration type plays no part in routing; it exists so the duplicate-registration failure can name both conflicting configuration classes in its message (`EntityDataSourceRegistry.cs:145-148`).
  - `ScannedAssemblies` records which assemblies the snapshot covered, so the registry can tell a genuine lookup miss from a merely stale scan (`EntityDataSourceRegistry.cs:104`).
  - `PhysicalSources` is the distinct-key list computed once at build time (`EntityDataSourceRegistry.cs:160`). The remark on `GetPhysicalSourcesInUse` explains why it is materialized rather than projected per call (`EntityDataSourceRegistry.cs:74-80`): the outbox processor and the outbox cleanup service both ask for it on every poll cycle, and re-running `Select().Distinct()` over every registered entity allocated a fresh list each time, forever, on a loop that usually finds nothing to do.
- **Where it's used**: exclusively inside [`EntityDataSourceRegistry`](#entitydatasourceregistry): built by `BuildSnapshot` (`EntityDataSourceRegistry.cs:157-160`), published by `GetOrBuildSnapshot` (`EntityDataSourceRegistry.cs:94`) and replaced by `RescanIfAssembliesChanged` (`EntityDataSourceRegistry.cs:109-111`).
- **Caveats / not-in-source**: a private nested type. It appears in this inventory because private nested types are inventoried, but it is not part of the public API and nothing outside the registry can name it.

### TenantDataSourceTarget

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:13` · Level 2 · record struct (readonly)

- **What it is**: one unit of work for a background sweep, a `(DataSourceKey Source, string? TenantId)` pair. `TenantId` is null for the shared database and set when the target is a tenant that keeps its own copy of that source (`TenantDataSourceTargets.cs:6-13`).
- **Depends on**: [`DataSourceKey`](#datasourcekey).
- **Concept introduced, the sweep unit under database-per-tenant.** `[Rubric §8, Data Architecture]` assesses whether the storage topology is modelled explicitly rather than assumed, and `[Rubric §29, Resilience & Business Continuity]` assesses whether background work reaches every store it is responsible for. Once multi-tenancy ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) is in play, "the databases this host owns" is no longer the same set as "the units a background job must visit": a physical source can exist once as the shared database *and* again as one private database per tenant that overrides it. Making that pair a value type means the sweep loops over a flat list instead of nesting a tenant loop inside a source loop, and `readonly record struct` gives structural equality for free, which is what the tests assert against (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantDataSourceTargetTests.cs:28-30`).
- **Walkthrough**
  - The positional declaration `TenantDataSourceTarget(DataSourceKey Source, string? TenantId)` (`TenantDataSourceTargets.cs:13`); the null-versus-set convention on `TenantId` is the whole vocabulary of the type (`TenantDataSourceTargets.cs:11-12`).
  - `ToString()` (`TenantDataSourceTargets.cs:17-20`) renders the bare source name for a shared target and appends `" (tenant {TenantId})"` for a per-tenant one, so a log line says which of two visits to the same source it is describing. That rendering is pinned by a test (`TenantDataSourceTargetTests.cs:90-93`), which is a small `[Rubric §13, Observability & Operability]` point: without it, two consecutive log lines for the same source would be indistinguishable.
- **Why it's built this way**: consumers branch on `TenantId` to decide whether they need a fresh DI scope. A null target runs on the caller's own scope; a non-null one creates a scope, calls [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext)`.SetTenant(...)` *before* asking for the context, because the tenant is what routes the scoped factory to that tenant's connection string (`OutboxCleanupService.cs:94-104`, `AuditTrailCleanupJob.cs:99-110`).
- **Where it's used**: produced only by [`TenantDataSourceTargets.Expand`](#tenantdatasourcetargets) and consumed as the loop variable of every host-owned sweep: [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) (`OutboxProcessor.cs:181-182`, iterated at `OutboxProcessor.cs:196`), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) (`OutboxCleanupService.cs:201`), [`AuditTrailCleanupJob`](#audittrailcleanupjob) (`AuditTrailCleanupJob.cs:83-85`, and as a parameter at `AuditTrailCleanupJob.cs:95` and `AuditTrailCleanupJob.cs:117`), and the startup initializer (`DatabaseInitializationExtensions.cs:124-131`, `DatabaseInitializationExtensions.cs:167`).

### IDataSourceResolver

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/IDataSourceResolver.cs:15` · Level 3 · interface

- **What it is**: the contract that maps a *logical* data source name (from a `[UseDatabase]` attribute, a module namespace, or a setting such as `Outbox:DatabaseName`) to a *physical* [`DataSourceKey`](#datasourcekey), and hands back the resolved [`PhysicalDataSource`](#physicaldatasource) for such a key. Two members: `ResolveLogical(DataSource engine, string logicalName)` (`IDataSourceResolver.cs:27`) and `GetPhysical(DataSourceKey key)` (`IDataSourceResolver.cs:35`).
- **Depends on**: [`DataSource`](#datasource), [`DataSourceKey`](#datasourcekey), [`PhysicalDataSource`](#physicaldatasource).
- **Concept introduced, logical-to-physical collapse as the backward-compatibility guarantee.** `[Rubric §8, Data Architecture]` and `[Rubric §7, Microservices Readiness]` both apply, because routing is reconfigurable purely through settings. The interface comment (`IDataSourceResolver.cs:5-14`) states the collapse rule precisely: in a host with no `DataSources` configuration every logical name resolves to `Default`, yielding one DbContext per engine with an identical change tracker, FK constraints, transactions, and EF model to a plain single-database monolith. `ResolveLogical`'s contract (`IDataSourceResolver.cs:17-23`) spells out the collapse cases: a name with no `DataSources` entry, a name with no connection string for the engine, and a name whose connection equals the top-level one all fall to `DataSourceKey.Default(engine)`; entries sharing a connection with each other collapse to one physical source named after the alphabetically-first logical name. `GetPhysical` (`IDataSourceResolver.cs:29-34`) is the reverse lookup and is documented to throw when handed a key that did not come from `ResolveLogical`.
- **Why it's built this way**: the collapse is what makes "build the monolith now, extract a service later" a configuration change rather than a rewrite ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). One interface owns the rule, so no caller reimplements the defaulting logic and no caller can disagree about what `Default` means.
- **Where it's used**: implemented by [`DataSourceResolver`](#datasourceresolver) and registered as a singleton (`DependencyInjection.cs:78`); injected into [`EntityDataSourceRegistry`](#entitydatasourceregistry) (`EntityDataSourceRegistry.cs:23`) to resolve each entity's derived logical name, into [`PhysicalDbContextFactory`](#physicaldbcontextfactory) and [`DbContextFactory`](#dbcontextfactory) to open connections (`PhysicalDbContextFactory.cs:18`, `DbContextFactory.cs:42`), into the inbox store and both event buses so each can locate its own database ([`EfInboxStore`](group-04-events-outbox.md#efinboxstore) `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:20`, [`InProcessEventBus`](group-04-events-outbox.md#inprocesseventbus) `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/InProcessEventBus.cs:26`, [`BrokerEventBus`](group-04-events-outbox.md#brokereventbus) `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/BrokerEventBus.cs:33`), into [`AuditTrailReader`](#audittrailreader) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailReader.cs:37`) and [`ScheduledJobRunner`](group-14-module-system-composition.md#scheduledjobrunner) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:43`), and optionally into [`TenancySettingsValidator`](group-14-module-system-composition.md#tenancysettingsvalidator), which uses `ResolveLogical` to check that a tenant override is keyed by a name that actually round-trips as a physical source (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettingsValidator.cs:23`, `TenancySettingsValidator.cs:117-119`).

### DataSourceResolver

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:13` · Level 4 · class (sealed, partial)

- **What it is**: the singleton implementation of [`IDataSourceResolver`](#idatasourceresolver). It builds the logical-to-physical map once at construction from the connection-string settings and the named `DataSources` entries, validates migrations-assembly conflicts, and then serves both lookups from in-memory dictionaries.
- **Depends on**: [`DataSource`](#datasource), [`DataSourceKey`](#datasourcekey), [`PhysicalDataSource`](#physicaldatasource), [`IDataSourceResolver`](#idatasourceresolver), [`IConnectionStringSettings`](group-14-module-system-composition.md#iconnectionstringsettings), [`DataSourcesSettings`](group-14-module-system-composition.md#datasourcessettings), [`DataSourceEntrySettings`](group-14-module-system-composition.md#datasourceentrysettings); `ILogger<T>` and the `[LoggerMessage]` source generator (which is why the class is `partial`).
- **Concept introduced, eager and validated data-source resolution.** `[Rubric §8, Data Architecture]` (deliberate multi-database routing) and `[Rubric §7, Microservices Readiness]` ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), database-per-service). The resolver realizes the collapse rule described on [`IDataSourceResolver`](#idatasourceresolver). Two guardrails are worth calling out. First, conflicting `SQLServerMigrationsAssembly` declarations on logical names that collapse to the same physical database throw at construction (`DataSourceResolver.cs:243-245`), a loud fail-fast rather than a silent pick. Second, `[Rubric §13, Observability & Operability]` shows up in the source-generated `LogMigrationsAssemblyFallback` (`DataSourceResolver.cs:278-279`), which warns when a *named* SQL Server source has no dedicated migrations assembly and therefore falls back to another database's, whose snapshot describes a different schema.
- **Walkthrough**
  - Constructor (`DataSourceResolver.cs:33-45`): null-guards its two settings arguments, then loops all three engines (`AllEngines` is CosmosDB, Sqlite, SQLServer, `DataSourceResolver.cs:15`) calling `BuildEngineMap`. All state lives in two dictionaries: `_logicalToPhysical` keyed by `(engine, logical name)` (`DataSourceResolver.cs:18`) and `_physicalSources` keyed by [`DataSourceKey`](#datasourcekey) (`DataSourceResolver.cs:21`). Both are populated during construction and never written afterwards, which is what makes the singleton safe to share without locking.
  - `BuildEngineMap` (`DataSourceResolver.cs:75-88`): `ClassifyEntries` splits the engine's named entries into "collapsed onto Default" and "grouped by connection identity" (`DataSourceResolver.cs:81`), then `RegisterDefaultSource` and `RegisterNamedSource` populate the two dictionaries (`DataSourceResolver.cs:82-87`).
  - `ClassifyEntries` (`DataSourceResolver.cs:94-135`): computes a per-connection identity string via `GetIdentity` (`DataSourceResolver.cs:257-260`), where a Cosmos identity appends the database name because one account hosts many databases, relational engines use the connection string alone, and the comparison is *ordinal*, so semantically-equal-but-textually-different connection strings deliberately do not collapse. Entries with no connection string for the engine are skipped entirely (`DataSourceResolver.cs:107-112`), because `ResolveLogical` already defaults on a map miss.
  - `RegisterDefaultSource` (`DataSourceResolver.cs:141-166`): registers the `Default` key for the engine, letting entries that collapsed onto it contribute an explicit migrations assembly alongside the top-level one (`DataSourceResolver.cs:148-154`), and maps each collapsed logical name onto that key (`DataSourceResolver.cs:162-165`).
  - `RegisterNamedSource` (`DataSourceResolver.cs:172-210`): names the physical key after the alphabetically-first member (`Order(...).First()`, `DataSourceResolver.cs:178`) so routing is deterministic regardless of configuration key order, then warns and falls back when a SQL Server source declares no migrations assembly of its own (`DataSourceResolver.cs:185-193`). The group's Cosmos database name comes from the canonical entry, falling back to the top-level setting (`DataSourceResolver.cs:195-198`).
  - `ResolveLogical` (`DataSourceResolver.cs:48-60`): a case-insensitive `Default`-name short-circuit (`DataSourceResolver.cs:52-55`) then a dictionary lookup; a miss returns `DataSourceKey.Default(engine)` (`DataSourceResolver.cs:59`), which is the monolith default.
  - `GetPhysical` (`DataSourceResolver.cs:63-68`): a `_physicalSources` lookup that throws with an actionable message when the key was not produced by `ResolveLogical`.
  - `ResolveMigrationsAssembly` (`DataSourceResolver.cs:229-249`): returns null for non-SQL-Server engines and when no explicit value exists (`DataSourceResolver.cs:234-237`), and throws when logical names sharing a database declare conflicting assemblies, naming every declaration in the message (`DataSourceResolver.cs:239-246`).
- **Why it's built this way**: resolving eagerly at construction turns a misconfiguration into a startup failure rather than a mid-request surprise, and the deterministic canonical-name rule keeps routing stable across configuration orderings ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The ordinal identity comparison is the conservative choice: collapsing two connection strings that only *look* different would silently merge two databases.
- **Where it's used**: registered as the singleton [`IDataSourceResolver`](#idatasourceresolver) (`DependencyInjection.cs:78`); consumed by [`EntityDataSourceRegistry`](#entitydatasourceregistry), the context factories, and [`DesignTimeDbContextHelper`](#designtimedbcontexthelper), which constructs its own instance for `dotnet ef` commands and registers it in a hand-built container (`DesignTimeDbContextHelper.cs:91`, `DesignTimeDbContextHelper.cs:94`). Its collapse rules are pinned by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DataSourceResolverTests.cs:9`, including the alphabetically-first canonical name (`DataSourceResolverTests.cs:72`) and the two Cosmos cases where the same account with a different database stays distinct while the same database collapses (`DataSourceResolverTests.cs:87`, `DataSourceResolverTests.cs:106`).

### EntityDataSourceRegistry

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21` · Level 5 · class (sealed)

- **What it is**: the singleton implementation of [`IEntityDataSourceRegistry`](#ientitydatasourceregistry). It reflects over the configuration assemblies, finds every entity type configuration, derives each entity's physical database from the configuration class's attributes and the entity's namespace, and freezes the result into a lock-free lookup that it rescans lazily when new assemblies appear.
- **Depends on**: [`DataSourceKey`](#datasourcekey), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry), [`IDataSourceResolver`](#idatasourceresolver), [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype), [`NamespaceConventions`](#namespaceconventions), [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute), [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute), [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), and its own nested [`Snapshot`](#snapshot); `System.Reflection`, `System.Collections.Frozen`, and `System.Threading.Lock` (BCL).
- **Concept introduced, deriving routing from configuration classes rather than from the EF model.** `[Rubric §8, Data Architecture]` ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html): an entity lives in exactly one database) and `[Rubric §15, Best Practices & Code Quality]` (fail fast on an ambiguous configuration). The doc comment (`EntityDataSourceRegistry.cs:8-19`) states the design: the map is derived from configuration *classes*, so it exists before any model is built; it is built lazily on first access and rescanned once on a lookup miss to pick up module assemblies loaded later; and duplicate registrations of one entity are tolerated when they agree on the physical source and rejected when they conflict.
- **Walkthrough**
  - Primary constructor (`EntityDataSourceRegistry.cs:21-23`) takes the [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) that decides *which* assemblies are scanned and the [`IDataSourceResolver`](#idatasourceresolver) that performs the final collapse. `_rebuildLock` (`EntityDataSourceRegistry.cs:30`) and the `volatile _snapshot` (`EntityDataSourceRegistry.cs:31`) implement the pattern taught under [`Snapshot`](#snapshot).
  - `GetDataSourceKey(Type)` (`EntityDataSourceRegistry.cs:34-38`) null-guards and forwards to the string overload via `FullName`; `GetDataSourceKey(string)` (`EntityDataSourceRegistry.cs:41-47`) is `TryGetDataSourceKey` plus a throw whose message names the exact remedy, adding an `EntityTypeConfigurationSQLServer/Cosmos/Sqlite` for the entity in a discovered configuration assembly.
  - `TryGetDataSourceKey` (`EntityDataSourceRegistry.cs:50-72`): probes the current snapshot; on a miss it calls `RescanIfAssembliesChanged` once (`EntityDataSourceRegistry.cs:63`) and retries, then returns `default` and false. The two-step shape keeps the common hit path entirely off the lock.
  - `GetPhysicalSourcesInUse` (`EntityDataSourceRegistry.cs:81-82`): returns the snapshot's precomputed `PhysicalSources`, which is how migrations, `EnsureCreated`, and outbox draining enumerate this host's databases without allocating per call.
  - `GetOrBuildSnapshot` (`EntityDataSourceRegistry.cs:84-96`) reads the volatile field first and only takes the lock when it is null; `RescanIfAssembliesChanged` (`EntityDataSourceRegistry.cs:98-113`) rebuilds only when the provider reports assemblies not already in `ScannedAssemblies` (`EntityDataSourceRegistry.cs:103-107`), so a genuinely unknown entity costs one set comparison, not one rescan per lookup.
  - `BuildSnapshot` (`EntityDataSourceRegistry.cs:115-161`): for every loadable type in every configuration assembly it skips abstract and open-generic types (`EntityDataSourceRegistry.cs:122-125`), finds the closed `IEntityTypeConfigurationBase<,>` interface (`EntityDataSourceRegistry.cs:127-132`), takes the entity type from the first generic argument (`EntityDataSourceRegistry.cs:134`), and calls `DeriveDataSourceKey`. A second configuration registering the same entity against a *different* key throws with a message naming both configuration classes and both keys (`EntityDataSourceRegistry.cs:141-152`); an agreeing duplicate is simply ignored. The frozen dictionary, the scanned-assembly set, and the distinct physical-source list are built together at the end (`EntityDataSourceRegistry.cs:157-160`).
  - `DeriveDataSourceKey` (`EntityDataSourceRegistry.cs:172-185`): reads the engine from [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and returns null when it is absent (`EntityDataSourceRegistry.cs:174-178`), deliberately skipping configurations that implement a provider interface directly instead of deriving from the attributed base classes. It then resolves the logical name in priority order, [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) first, then [`NamespaceConventions.GetModuleName`](#namespaceconventions), then `DataSourceKey.DefaultName` (`EntityDataSourceRegistry.cs:180-182`), and delegates the collapse to [`IDataSourceResolver.ResolveLogical`](#idatasourceresolver) (`EntityDataSourceRegistry.cs:184`).
  - `GetLoadableTypes` (`EntityDataSourceRegistry.cs:190-200`): wraps `assembly.GetTypes()` and tolerates `ReflectionTypeLoadException` by keeping the types that did load, mirroring module discovery, so a partially-loaded assembly does not abort the whole scan.
- **Why it's built this way**: building from configuration classes at startup rather than per query means a missing or conflicting configuration surfaces early, which matters most in a multi-database system where the alternative failure mode is a silent read against the wrong database. The skip for configurations without `[UseDataSource]` is documented as matching legacy behavior (`EntityDataSourceRegistry.cs:168-170`): those entities land in the Default model but are not routable through the unit of work, which is the same fallback [`ApplicationDbContext`](#applicationdbcontext) applies when filtering configurations into a model (`ApplicationDbContext.cs:620-635`).
- **Where it's used**: registered as the singleton [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`DependencyInjection.cs:79`) and rebuilt by hand for design-time commands (`DesignTimeDbContextHelper.cs:92`); consumed by [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention), [`DataSourceService`](#datasourceservice), [`DbContextFactory`](#dbcontextfactory), both [`ApplicationDbContext`](#applicationdbcontext) model passes (`ApplicationDbContext.cs:290`, `ApplicationDbContext.cs:625`), and the outbox, audit-trail and migrations enumerations. Its behavior is pinned by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:15`, covering the agreeing and conflicting duplicate cases (`EntityDataSourceRegistryTests.cs:93`, `EntityDataSourceRegistryTests.cs:103`), the attribute-less skip (`EntityDataSourceRegistryTests.cs:120`), and the distinct-source enumeration (`EntityDataSourceRegistryTests.cs:148`).

### TenantDataSourceTargets

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:40` · Level 5 · class (static)

- **What it is**: a one-method static class that expands the physical data sources a background service owns into the [`TenantDataSourceTarget`](#tenantdatasourcetarget) units it must actually visit once database-per-tenant is configured (`TenantDataSourceTargets.cs:23-49`).
- **Depends on**: [`DataSourceKey`](#datasourcekey), [`TenantDataSourceTarget`](#tenantdatasourcetarget), [`TenancySettings`](group-14-module-system-composition.md#tenancysettings) with its nested [`TenantEntrySettings`](group-14-module-system-composition.md#tenantentrysettings) and [`TenantDataSourceOverrideSettings`](group-14-module-system-composition.md#tenantdatasourceoverridesettings), and [`TenancySettingsValidator.ConnectionStringFor`](group-14-module-system-composition.md#tenancysettingsvalidator) for the per-engine connection-string lookup.
- **Concept introduced, why a per-tenant database is invisible to a shared sweep.** `[Rubric §8, Data Architecture]` and `[Rubric §29, Resilience & Business Continuity]` both apply, and the class remarks (`TenantDataSourceTargets.cs:27-39`) carry the reasoning. A **shared-schema** tenant needs nothing here: its rows live in the shared database that the null-tenant target already drains, and the outbox deliberately has no tenant column precisely so that adopting tenancy never forces a migration on an existing consumer. A tenant with its **own** database is the opposite case: its outbox rows and its audit-trail rows sit in a database nothing else opens, so without an extra target its events would sit undelivered and its rows unpurged forever. Each such tenant therefore contributes one extra target per source it overrides, and the sweep sets the tenant on its scope before asking for the context, which is what routes that context at the tenant's connection string ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).
- **Walkthrough**
  - `Expand(IEnumerable<DataSourceKey> sources, TenancySettings? settings)` (`TenantDataSourceTargets.cs:49-51`) takes a nullable settings argument, because a host that never registered tenancy passes null and must still get a usable list.
  - It materializes the source sequence once only when it is not already a collection (`sources as IReadOnlyCollection<DataSourceKey> ?? [.. sources]`, `TenantDataSourceTargets.cs:53`) and sizes the result list from that count (`TenantDataSourceTargets.cs:54`), since the common no-tenancy case produces exactly one target per source.
  - Pass one adds the shared target for every source, `new TenantDataSourceTarget(source, null)` (`TenantDataSourceTargets.cs:56-59`). This is the entire result when settings are null or declare no tenants (`TenantDataSourceTargets.cs:61-64`), which is the ordering guarantee the callers rely on: shared targets always come first.
  - Pass two walks the declared tenants and, for each, every source the caller owns (`TenantDataSourceTargets.cs:66-76`). A pair is added only when the tenant declares an override keyed by that **physical** source name *and* that override carries a non-blank connection string for that source's engine (`TenantDataSourceTargets.cs:70-71`). Both halves of that test matter: an override for a source this host does not own adds nothing, and an override that only declares, say, a SQLite connection adds nothing for a SQL Server source. Both cases have their own test (`TenantDataSourceTargetTests.cs:62`, `TenantDataSourceTargetTests.cs:76`).
- **Why it's built this way**: it is a pure function over settings, with no DI and no I/O, so every sweep can share one expansion rule and each can unit-test its own target list without a database (`TenantDataSourceTargetTests.cs:18`). Keeping the tenant loop outside the sweeps also keeps the tenancy feature additive: a host with no `Tenancy` section gets byte-identical behavior to the pre-tenancy code path (`TenantDataSourceTargetTests.cs:24`, `TenantDataSourceTargetTests.cs:34`).
- **Where it's used**: by all four host-owned sweeps: [`OutboxProcessor.GetOutboxTargets`](group-04-events-outbox.md#outboxprocessor) (`OutboxProcessor.cs:181-182`), [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice) (`OutboxCleanupService.cs:201`), [`AuditTrailCleanupJob`](#audittrailcleanupjob) (`AuditTrailCleanupJob.cs:83`), and [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions), which filters the expansion down to `t.TenantId is not null` because the shared sources were already initialized in the pass above it (`DatabaseInitializationExtensions.cs:124-125`).
- **Caveats / not-in-source**: the expansion is driven purely by declared configuration. A tenant whose database exists but is not declared under `Tenancy:Tenants` produces no target, and nothing in this class detects that; the round-trip check that a source name is a real physical name lives in [`TenancySettingsValidator`](group-14-module-system-composition.md#tenancysettingsvalidator), not here.

### EnumerationValueConverter<TEnumeration>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EnumerationValueConverter.cs:33` · Level 4 · class (public sealed)

- **What it is**: the shipped EF Core `ValueConverter<TEnumeration, int>` that stores a smart-enumeration member as its integer `Value` and rebuilds the member when a row is read back (`EnumerationValueConverter.cs:33`). It is the packaged replacement for the two lambdas every entity configuration would otherwise hand-roll to map an [`Enumeration<TEnumeration>`](group-02-domain-building-blocks.md#enumerationtenumeration) property.
- **Depends on**: [`Enumeration<TEnumeration>`](group-02-domain-building-blocks.md#enumerationtenumeration) (the generic constraint, `EnumerationValueConverter.cs:34`), its `Value` property (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:99`) and its static `FromValue` factory (`Enumeration.cs:115`); [`Result<T>`](group-01-result-error-handling.md#result) indirectly, because `FromValue` returns one; EF Core's `ValueConverter<TModel, TProvider>` from `Microsoft.EntityFrameworkCore.Storage.ValueConversion` (NuGet, `EnumerationValueConverter.cs:1`).
- **Concept introduced, mapping a smart enumeration onto the column a CLR enum already used.** A smart enumeration is a class, not a language `enum`, so the naive EF answer is `OwnsOne`: the member becomes an owned entity type with its own columns, which turns "replace the `enum` property with a richer type" into a schema change and a migration. `HasConversion` takes the other route. It keeps a single flat column and supplies a pair of expression trees: a **write leg** that turns the model value into the provider value, and a **read leg** that turns the provider value back. Because this converter's provider type is `int` (`EnumerationValueConverter.cs:33`), the backing column stays exactly the plain integer column a CLR enum was already persisted into, so adopting the smart enumeration in the domain changes nothing in the database. The class doc states this as the reason for the choice (`EnumerationValueConverter.cs:6-11`). `[Rubric §4, Domain-Driven Design]` assesses whether the domain models concepts as behavior-carrying types rather than primitives or bare enums; a framework-shipped converter removes the storage-cost argument against doing so. `[Rubric §8, Data Architecture]` assesses how deliberately the storage shape is chosen; the flat `int` column keeps indexes, existing rows, and prior migrations untouched.
- **Walkthrough**
  - **Type parameters and constraint** (`EnumerationValueConverter.cs:33-34`): `ValueConverter<TEnumeration, int>` with `where TEnumeration : Enumeration<TEnumeration>`, the curiously-recurring constraint that makes `FromValue` resolve to the concrete member type rather than to the base.
  - **Constructor, write leg** (`EnumerationValueConverter.cs:41`): `member => member.Value`, the member's declared stable integer (`Enumeration.cs:99`). No validation happens here: a member reference is valid by construction, since the only members that exist are the ones the type declares.
  - **Constructor, read leg** (`EnumerationValueConverter.cs:42`): `value => Enumeration<TEnumeration>.FromValue(value).Value!`. `FromValue` looks the value up in the type's interned member dictionary and returns a success result (`Enumeration.cs:117-118`) or an invariant failure coded `Enumeration.UnknownValue` (`Enumeration.cs:120-124`). Because [`Result<T>.Value`](group-01-result-error-handling.md#result) is declared nullable and simply returns `null` on failure rather than throwing (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:140`), the null-forgiving `!` means a row carrying a value no member declares materializes a `null` reference for that property instead of failing materialization.
  - **The read-leg contract, spelled out** (`EnumerationValueConverter.cs:23-30`): the read leg trusts the column. Every value the write leg can produce round-trips, because the write leg can only persist an already-declared member; the contract can only be broken by a value written outside EF (a manual script, a data fix, or a member deleted from the enumeration after rows were written).
  - **What it deliberately does not do** (`EnumerationValueConverter.cs:19-21`): requiredness, default value, and precision stay at the call site, because they differ per entity. The documented usage chains `.IsRequired()` next to the `HasConversion` call (`EnumerationValueConverter.cs:13-18`).
- **Why it's built this way**: the domain wants a type that can carry names, ordering, and behavior; the database wants the same integer column it already has. `HasConversion` satisfies both, and shipping the converter from the framework means every consumer gets the same interning behavior on read rather than a per-configuration lambda that might allocate a fresh instance.
- **Where it's used**: no entity configuration in MMCA.Common, MMCA.ADC, or MMCA.Store maps a property through it today; the only callers are its unit tests, which pin the round trip (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EnumerationValueConverterTests.cs:17-26`), the column types (`EnumerationValueConverterTests.cs:29-35`), and the fact that the read leg resolves the interned singleton for every declared member rather than a copy (`EnumerationValueConverterTests.cs:38-45`, asserted with `BeSameAs`). It is shipped ahead of demand, like the phone-number pair below.

### IEntityTypeConfigurationBase<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationBase.cs:14` · Level 4 · interface (public)

- **What it is**: the root of this framework's entity-configuration interface family. It extends EF Core's own `IEntityTypeConfiguration<TEntity>` and redeclares `Configure` with the `new` modifier, so the three engine-specific marker interfaces below it can redeclare it in turn (`IEntityTypeConfigurationBase.cs:14-18`).
- **Depends on**: EF Core's `IEntityTypeConfiguration<TEntity>` and `EntityTypeBuilder<TEntity>` (NuGet, `IEntityTypeConfigurationBase.cs:1-2`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) as the entity constraint (`IEntityTypeConfigurationBase.cs:15`).
- **Concept introduced, a marker-interface family used as a discovery filter.** EF Core has exactly one configuration contract, `IEntityTypeConfiguration<TEntity>`, and `ModelBuilder.ApplyConfiguration` accepts it. That is enough when a solution has one model. This framework builds one model per physical data source and has to answer a different question first: *which* configurations belong in *this* engine's model. The answer is a family of interfaces that all remain assignable to EF's contract (so `ApplyConfiguration` still accepts them) while carrying an engine tag in their type identity. [`ModelBuilderExtensions.ApplyAllConfigurations`](#modelbuilderextensions) scans an assembly for concrete types implementing the open generic interface it was handed, reads the entity type out of the interface's first generic argument, instantiates the configuration through DI, and invokes `ModelBuilder.ApplyConfiguration<TEntity>` reflectively (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ModelBuilderExtensions.cs:42-64`). This interface is the shared parent that keeps that whole scheme compatible with EF. `[Rubric §2, Design Patterns]` assesses whether a pattern earns its place; the marker interface here is not decoration, it is the type-level index the scan runs on. `[Rubric §1, SOLID]` assesses interface segregation and substitutability: every member of the family is still an `IEntityTypeConfiguration<TEntity>`, so nothing downstream of EF has to know the family exists.
- **Walkthrough**
  - **Declaration** (`IEntityTypeConfigurationBase.cs:14`): `IEntityTypeConfigurationBase<TEntity, TIdentifierType> : IEntityTypeConfiguration<TEntity>`. Note the second type parameter, which EF's own contract does not have: it carries the identifier type so the constraint below can be expressed.
  - **Constraints** (`IEntityTypeConfigurationBase.cs:15-16`): `TEntity : AuditableBaseEntity<TIdentifierType>` and `TIdentifierType : notnull`. Only audited entities are configurable through this family, which is why the base class can safely assume audit members exist.
  - **`new void Configure(EntityTypeBuilder<TEntity> builder)`** (`IEntityTypeConfigurationBase.cs:18`): the redeclaration. The doc gives the reason directly (`IEntityTypeConfigurationBase.cs:8-10`): declaring `Configure` explicitly here is what lets the provider-specific interfaces redeclare it with `new` as well. A single public `Configure` method on an implementing class satisfies every declaration in the chain.
- **Why it's built this way**: the alternative is an attribute-only scheme, where every configuration is annotated and discovery is a reflection sweep over attributes. Putting the engine in the type system instead means the scan is a plain `GetInterfaces()` match (`ModelBuilderExtensions.cs:48-50`), the compiler tells a consumer immediately when a configuration implements two engines' contracts, and the entity type is available as a generic argument rather than as something else to look up.
- **Where it's used**: implemented by [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype) (`EntityTypeConfigurationBase.cs:19-20`) and extended by the three engine markers, [`IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlservertentity-tidentifiertype), [`IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlitetentity-tidentifiertype), and [`IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#ientitytypeconfigurationcosmostentity-tidentifiertype).

### NullableEnumerationValueConverter<TEnumeration>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EnumerationValueConverter.cs:62` · Level 4 · class (public sealed)

- **What it is**: the optional-property counterpart of [`EnumerationValueConverter<TEnumeration>`](#enumerationvalueconvertertenumeration), a `ValueConverter<TEnumeration?, int?>` for an entity property whose enumeration member may be absent (`EnumerationValueConverter.cs:62`).
- **Depends on**: the same [`Enumeration<TEnumeration>`](group-02-domain-building-blocks.md#enumerationtenumeration) constraint and `FromValue` factory (`EnumerationValueConverter.cs:63`, `:71`); EF Core's `ValueConverter<TModel, TProvider>`.
- **Concept reinforced, keeping "absent" absent, with a sharper edge than the string converters.** Both legs short-circuit on `null` (`EnumerationValueConverter.cs:70-71`), so "no member selected" stays a NULL column value. The failure mode this prevents is specific to integer-valued enumerations and worth naming: without the guards, an absent member would be written as the default `int` and read back as whichever member happens to declare the value zero. The doc says exactly that (`EnumerationValueConverter.cs:49-51`), and the test asserting it carries the same reasoning in its message (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EnumerationValueConverterTests.cs:76-77`). `[Rubric §8, Data Architecture]` covers nullability as a modeled fact rather than an accident.
- **Walkthrough**
  - **Write leg** (`EnumerationValueConverter.cs:70`): `member => member == null ? null : member.Value`.
  - **Read leg** (`EnumerationValueConverter.cs:71`): `value => value == null ? null : Enumeration<TEnumeration>.FromValue(value.Value).Value`. Note the plain `.Value` here rather than the null-forgiving `.Value!` of the non-nullable sibling: the model type is already nullable, so an unknown stored value simply yields `null`.
  - **Usage shape** (`EnumerationValueConverter.cs:52-59`): the documented pattern pairs it with `.IsRequired(false)`.
- **Why it's built this way**: EF resolves a converter against the declared CLR property type, so one class cannot serve both `TEnumeration` and `TEnumeration?`. Shipping the pair keeps the nullable choice explicit at the configuration instead of hidden in a per-entity lambda.
- **Where it's used**: like its sibling, only its unit tests today (`EnumerationValueConverterTests.cs:58-68` for the value round trip, `:70-78` for the null pass-through, `:80-87` for the `int?` provider type). The tests declare a private `Priority` enumeration with members valued 1, 2 and 3 (`EnumerationValueConverterTests.cs:89-93`).

### EmailValueConverter

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:33` · Level 5 · class (public sealed)

- **What it is**: the shipped EF Core `ValueConverter<Email, string>` that stores an [`Email`](group-02-domain-building-blocks.md#email) value object as its normalized string and rebuilds the value object when a row is read back (`EmailValueConverter.cs:33`). It exists so no entity configuration has to hand-roll the same two lambdas.
- **Depends on**: [`Email`](group-02-domain-building-blocks.md#email) and its `Create` factory (`EmailValueConverter.cs:2`, `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Email.cs:30`); [`Result<T>`](group-01-result-error-handling.md#result) indirectly, since `Create` returns one; EF Core's `ValueConverter<TModel, TProvider>` (NuGet, `EmailValueConverter.cs:1`).
- **Concept reinforced, `HasConversion` over `OwnsOne` for a value object.** The mechanism is the one taught at [`EnumerationValueConverter<TEnumeration>`](#enumerationvalueconvertertenumeration); what changes is the provider type. Here the column stays a plain string column (`EmailValueConverter.cs:33`), so a codebase can upgrade `string Email` to `Email Email` in the domain and change nothing in the database. That is the whole point of shipping the converter from the framework: the domain gets an invariant-protected type ([`Email.Create`](group-02-domain-building-blocks.md#email) validates through [`EmailInvariants`](group-02-domain-building-blocks.md#emailinvariants) and lowercases, `Email.cs:32`, `:39`), while storage keeps the simplest possible shape. `[Rubric §4, Domain-Driven Design]` assesses whether the domain expresses concepts as rich types rather than primitives; a shipped converter removes the usual excuse for keeping an email as a bare string. `[Rubric §16, Maintainability]` assesses whether a change of this kind ripples: the converter is written once in Infrastructure and reused across the repos rather than copy-pasted per configuration.
- **Walkthrough**
  - **Type parameters** (`EmailValueConverter.cs:33`): `ValueConverter<Email, string>`, so EF knows the CLR (model) type is `Email` and the provider (column) type is `string`.
  - **Constructor, write leg** (`EmailValueConverter.cs:40`): `email => email.Value` persists the already-normalized lowercase string that `Email.Create` produced (`Email.cs:39`). No validation happens here because a constructed `Email` is valid by construction.
  - **Constructor, read leg** (`EmailValueConverter.cs:41`): `value => Email.Create(value).Value!`. The read leg deliberately trusts the column. [`Result<T>.Value`](group-01-result-error-handling.md#result) is nullable and returns `null` on failure rather than throwing (`Result.cs:140`), so the null-forgiving `!` means a row whose stored text does not validate materializes a `null` reference for that property instead of blowing up model materialization. The class doc states the contract explicitly (`EmailValueConverter.cs:24-31`): every value the write leg can produce round-trips, because the write leg can only persist an already-validated `Email`; only a value written outside EF (a manual script, a data fix) can break it.
  - **What the converter deliberately does not do** (`EmailValueConverter.cs:20-22`): column facets (max length, `IsUnicode`, requiredness) stay at the call site, because they differ per entity. The documented usage pattern chains them next to the `HasConversion` call (`EmailValueConverter.cs:14-19`).
- **Why it's built this way**: two forces meet here. The domain wants a type that cannot hold an invalid address; the database wants a column that indexes and migrates like the `nvarchar` it already was. `HasConversion` satisfies both, and shipping the converter pair from Common (rather than documenting the lambdas) means every consumer gets the same normalization and the same read-leg contract. [`Email`](group-02-domain-building-blocks.md#email) itself points at this class in its own doc comment (`Email.cs:9-13`), so the intended mapping is discoverable from the domain type.
- **Where it's used**: ADC's Identity `UserConfiguration` maps `User.Email` through it (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:21`), and Store uses it for both `User.Email` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:24`) and `Customer.Email` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/CustomerConfiguration.cs:36`). Both Store call sites carry an inline comment recording that the mapping is `HasConversion` and not `OwnsOne` precisely so the column shape did not change. Round-trip behavior is pinned by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EmailValueConverterTests.cs:18`.

### EntityTypeConfigurationBase<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationBase.cs:19` · Level 5 · class (public abstract)

- **What it is**: the engine-agnostic root class of the configuration hierarchy. It implements exactly one cross-cutting rule: an aggregate root's in-memory `DomainEvents` collection must never be mapped to the database (`EntityTypeConfigurationBase.cs:19-33`).
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (implements it, `EntityTypeConfigurationBase.cs:20`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint, `:21`); [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) and [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) (the runtime test and the ignored member, `:29-31`); EF Core's `EntityTypeBuilder<TEntity>` (NuGet, `:1`).
- **Concept introduced, keeping a domain-only collection out of the model.** An aggregate root collects domain events in memory so the dispatcher can drain them after a save. That collection is not state: it has no column, no table, and no meaning after the transaction closes. EF Core's convention-based model builder does not know that and would happily try to map it, which fails outright or (worse) invents a shadow table. One `builder.Ignore` call at the root of the hierarchy makes the exclusion automatic for every entity in every consumer, rather than a rule each configuration author has to remember. `[Rubric §4, Domain-Driven Design]` assesses whether the aggregate's event mechanism stays a domain concern; ignoring the collection is what keeps events a domain construct rather than a persisted one. `[Rubric §10, Cross-Cutting Concerns]` assesses whether concerns that apply everywhere are handled once in a shared place; this is the smallest possible example of that, applied at the base class every configuration inherits.
- **Walkthrough**
  - **Declaration** (`EntityTypeConfigurationBase.cs:19-22`): abstract, generic over the entity and its identifier type, implementing the base interface. Being abstract means it is never discovered as a configuration itself: the scan skips abstract types (`ModelBuilderExtensions.cs:44`).
  - **`Configure` is `virtual`** (`EntityTypeConfigurationBase.cs:25`): the derived engine-aware class overrides it and calls `base.Configure(builder)` first, so this rule always runs before engine conventions (see [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype), `EntityTypeConfiguration.cs:41`).
  - **The aggregate-root test** (`EntityTypeConfigurationBase.cs:29`): `typeof(IAggregateRoot).IsAssignableFrom(typeof(TEntity))`. The rule is applied only to aggregate roots, because only they carry the collection; a plain child entity configured through the same hierarchy is untouched.
  - **The exclusion** (`EntityTypeConfigurationBase.cs:31`): `builder.Ignore(nameof(AuditableAggregateRootEntity<>.DomainEvents))`. The unbound-generic `nameof` form is worth noticing: it names the member without having to close the generic, so the string stays refactor-safe.
  - **What this class no longer does** (`EntityTypeConfigurationBase.cs:10-15`): the doc records that entity-to-data-source mapping used to be registered here as a model-building side effect and is not any more. [`EntityDataSourceRegistry`](#entitydatasourceregistry) now derives that mapping eagerly from the configuration class's attributes, which is what lets routing be known before any model is built.
- **Why it's built this way**: model building is the wrong place to accumulate a registry, because a model is built lazily and per data source, so "which entity lives where" would only be known after the first context of each kind had been constructed. Splitting the two (this class owns model rules, the registry owns routing) is what makes the routing table eagerly available at startup.
- **Where it's used**: extended by [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype), and through it by every consumer configuration. Its two behaviors are pinned directly: `Configure_AggregateRootEntity_ExcludesDomainEvents` and `Configure_NonAggregateEntity_MapsEntity` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:18`, `:38`).

### IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationCosmos.cs:13` · Level 5 · interface (internal)

- **What it is**: the engine marker for Azure Cosmos DB configurations (`IEntityTypeConfigurationCosmos.cs:13`). It adds no members of its own beyond the `new` redeclaration of `Configure` (`:17`); its whole job is to be the type [`CosmosDbContext`](#cosmosdbcontext) scans for.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (extends it, `IEntityTypeConfigurationCosmos.cs:13`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint, `:14`); EF Core's `EntityTypeBuilder<TEntity>` (NuGet, `:1`).
- **Concept reinforced**: the marker-interface-as-discovery-filter idea taught at [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype). The selection happens in one `switch` inside [`ApplicationDbContext`](#applicationdbcontext): `DataSource.CosmosDB` maps to `typeof(IEntityTypeConfigurationCosmos<,>)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:614`), and that open generic is handed to the assembly scan.
- **Walkthrough**
  - **`internal`** (`IEntityTypeConfigurationCosmos.cs:13`): unlike its parent, this interface is not part of the public API. Consumers are not meant to implement it directly; they derive from [`EntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#entitytypeconfigurationcosmostentity-tidentifiertype) (or annotate with [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute)), which implements it for them.
  - **`new void Configure(...)`** (`IEntityTypeConfigurationCosmos.cs:17`): the redeclaration the base interface exists to enable.
- **Caveats / not-in-source**: implementing this interface directly, without the attributed base class, is a supported but degraded path. [`EntityDataSourceRegistry`](#entitydatasourceregistry) skips configurations that carry no [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:172-178`), so such an entity lands in the engine's Default model but is not routable through [`IUnitOfWork`](#iunitofwork); the code comments call this legacy behavior (`ApplicationDbContext.cs:620-624`).
- **Where it's used**: matched by `ApplicationDbContext.ApplyConfigurationsForEntitiesInContext` for the Cosmos engine (`ApplicationDbContext.cs:610-618`) and implemented by [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (`EntityTypeConfiguration.cs:32`).

### IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSqlite.cs:13` · Level 5 · interface (internal)

- **What it is**: the engine marker for SQLite configurations (`IEntityTypeConfigurationSqlite.cs:13`), structurally identical to its Cosmos and SQL Server siblings.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (`IEntityTypeConfigurationSqlite.cs:13`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`:14`); EF Core's `EntityTypeBuilder<TEntity>` (`:1`).
- **Concept reinforced**: engine selection by interface identity, taught at [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype). `DataSource.Sqlite` maps to `typeof(IEntityTypeConfigurationSqlite<,>)` (`ApplicationDbContext.cs:615`).
- **Where it's used**: matched by [`SqliteDbContext`](#sqlitedbcontext) through the shared discovery method, implemented by [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (`EntityTypeConfiguration.cs:31`), and used directly by the framework's own tests as the scan target: the `ApplyAllConfigurations` tests pass `typeof(IEntityTypeConfigurationSqlite<,>)` as the interface to match (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:93`), and one test type implements it directly to exercise the unattributed path (`ModelBuilderExtensionsTests.cs:108`, `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:225`).

### IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSQLServer.cs:13` · Level 5 · interface (internal)

- **What it is**: the engine marker for SQL Server configurations (`IEntityTypeConfigurationSQLServer.cs:13`). It is the one of the three that matters in production today, because every deployed entity in ADC and Store routes to SQL Server.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (`IEntityTypeConfigurationSQLServer.cs:13`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`:14`); EF Core's `EntityTypeBuilder<TEntity>` (`:1`).
- **Concept reinforced**: engine selection by interface identity. `DataSource.SQLServer` maps to `typeof(IEntityTypeConfigurationSQLServer<,>)` (`ApplicationDbContext.cs:616`); anything the switch does not recognize throws `InvalidOperationException` rather than silently building an empty model (`ApplicationDbContext.cs:617`).
- **Where it's used**: matched by [`SQLServerDbContext`](#sqlserverdbcontext) through `ApplyConfigurationsForEntitiesInContext`, and implemented by [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (`EntityTypeConfiguration.cs:30`), which is how all 27 ADC configurations and all 12 Store configurations reach it through the [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) shim.

### NullableEmailValueConverter

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:60` · Level 5 · class (public sealed)

- **What it is**: the optional-property counterpart of [`EmailValueConverter`](#emailvalueconverter), a `ValueConverter<Email?, string?>` for an entity property typed `Email?` (`EmailValueConverter.cs:60`).
- **Depends on**: the same [`Email`](group-02-domain-building-blocks.md#email) value object and EF Core's `ValueConverter<TModel, TProvider>`; see the sibling above for the shared shape.
- **Concept reinforced, keeping "absent" absent.** The interesting part of a nullable converter is what it refuses to do. Both legs short-circuit on `null` (`EmailValueConverter.cs:67-68`): the write leg emits `null` rather than an empty string, and the read leg returns `null` rather than calling `Email.Create(null)` and producing a failed result. Without those guards, "no email" would silently become either an empty-string column value (which then fails validation on the way back) or a null reference produced by a failed factory call. Note the read leg here uses plain `.Value` (`EmailValueConverter.cs:68`), not the null-forgiving `.Value!` of the non-nullable sibling, because the model type is already nullable. `[Rubric §8, Data Architecture]` covers nullability as a modeled fact rather than an accident: NULL stays NULL end to end.
- **Walkthrough**
  - **Write leg** (`EmailValueConverter.cs:67`): `email => email == null ? null : email.Value`.
  - **Read leg** (`EmailValueConverter.cs:68`): `value => value == null ? null : Email.Create(value).Value`.
  - **Usage shape** (`EmailValueConverter.cs:52-57`): the doc comment pairs it with `.IsRequired(false)` and a call-site `HasMaxLength`, exactly as the non-nullable sibling keeps facets outside the converter.
- **Why it's built this way**: a single converter cannot serve both `Email` and `Email?`, because EF resolves the converter against the declared CLR property type. Shipping the pair keeps the choice explicit at the configuration and avoids per-entity nullable lambdas.
- **Where it's used**: ADC's `SpeakerConfiguration` maps the optional `Speaker.Email` through it (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerConfiguration.cs:43`), with the length facet coming from `SpeakerInvariants.EmailMaxLength` at the call site (`SpeakerConfiguration.cs:44`). Null round-tripping is covered at `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EmailValueConverterTests.cs:52`.

### NullablePhoneNumberValueConverter

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/PhoneNumberValueConverter.cs:61` · Level 5 · class (public sealed)

- **What it is**: a `ValueConverter<PhoneNumber?, string?>` for an optional [`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) property (`PhoneNumberValueConverter.cs:61`). It is the same shape as [`NullableEmailValueConverter`](#nullableemailvalueconverter) with a different value object.
- **Depends on**: [`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) and its `Create` factory, which validates through [`PhoneNumberInvariants`](group-02-domain-building-blocks.md#phonenumberinvariants) and trims (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumber.cs:30`, `:36`); EF Core's `ValueConverter<TModel, TProvider>` (`PhoneNumberValueConverter.cs:1`).
- **Concept reinforced**: null pass-through on both legs, taught at [`NullableEmailValueConverter`](#nullableemailvalueconverter). The doc comment states the same rule in the phone vocabulary: "no phone number" stays a NULL column value rather than becoming an empty string or a failed `PhoneNumber.Create` call (`PhoneNumberValueConverter.cs:46-50`).
- **Walkthrough**
  - **Write leg** (`PhoneNumberValueConverter.cs:68`): `phoneNumber => phoneNumber == null ? null : phoneNumber.Value`, persisting the trimmed string the factory produced (`PhoneNumber.cs:36`).
  - **Read leg** (`PhoneNumberValueConverter.cs:69`): `value => value == null ? null : PhoneNumber.Create(value).Value`.
- **Where it's used**: no entity configuration in MMCA.Common, MMCA.ADC, or MMCA.Store maps a property through it today; the only current callers are its unit tests (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/PhoneNumberValueConverterTests.cs:42`). It is shipped ahead of demand so that a consumer adopting the `PhoneNumber` value object does not have to write the lambdas.

### PhoneNumberValueConverter

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/PhoneNumberValueConverter.cs:33` · Level 5 · class (public sealed)

- **What it is**: the non-nullable `ValueConverter<PhoneNumber, string>`, storing a [`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) as its trimmed string value and rebuilding the value object on read (`PhoneNumberValueConverter.cs:33`).
- **Depends on**: [`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) (`PhoneNumberValueConverter.cs:2`); EF Core's `ValueConverter<TModel, TProvider>` (`PhoneNumberValueConverter.cs:1`).
- **Concept reinforced**: the `HasConversion`-over-`OwnsOne` mapping and the trust-the-column read leg, both taught at [`EmailValueConverter`](#emailvalueconverter). The read-leg contract paragraph is repeated in this file's doc comment (`PhoneNumberValueConverter.cs:24-31`), including the note that only a value written outside EF can break the round trip.
- **Walkthrough**
  - **Write leg** (`PhoneNumberValueConverter.cs:40`): `phoneNumber => phoneNumber.Value`.
  - **Read leg** (`PhoneNumberValueConverter.cs:41`): `value => PhoneNumber.Create(value).Value!`, null-forgiving for the same reason as the email converter: [`Result<T>.Value`](group-01-result-error-handling.md#result) is null on failure (`Result.cs:140`), so an unparseable stored value materializes as `null` instead of throwing.
  - **Facets stay at the call site** (`PhoneNumberValueConverter.cs:20-22`): the documented usage chains `HasMaxLength(PhoneNumberInvariants.MaxLength)`, `IsUnicode(false)`, and `IsRequired()` next to `HasConversion` (`PhoneNumberValueConverter.cs:13-19`).
- **Where it's used**: like its nullable sibling, it has no production call site in the three repos today; `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/PhoneNumberValueConverterTests.cs:19` exercises the round trip.

### EntityTypeConfiguration<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:28` · Level 6 · class (public abstract)

- **What it is**: the engine-aware configuration base and the busiest type in this family. It reads the target engine off a [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) on the concrete configuration class (or on an inherited shim base) and applies that engine's table/container mapping plus key generation, so a consumer's `Configure` body only ever describes columns, indexes, and relationships (`EntityTypeConfiguration.cs:28-99`).
- **Depends on**: [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype) (base, `EntityTypeConfiguration.cs:29`); all three engine markers, [`IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlservertentity-tidentifiertype), [`IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlitetentity-tidentifiertype), [`IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#ientitytypeconfigurationcosmostentity-tidentifiertype) (`:30-32`); [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and the [`DataSource`](#datasource) enum (`:4`, `:43`, `:57`); [`NamespaceConventions`](#namespaceconventions) (`:66`, `:87`); [`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator) (`:7`, `:91`); the `IsIdValueGenerated` extension property from [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions) (`:61`), which is a lookup for [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:19`); `System.Reflection` and EF Core's `EntityTypeBuilder<TEntity>` (`:1-3`).
- **Concept introduced, one configuration body that is portable across storage engines.** The naive way to support three engines is three configuration classes per entity, or one class littered with `if (engine == ...)`. This class removes both. The engine is declared **once**, as an attribute, and everything that actually differs between engines is centralized in a single `switch` here: SQL Server gets a table in a module schema, SQLite gets a bare table (SQLite has no schemas), Cosmos gets a per-module container with the entity id as partition key (`EntityTypeConfiguration.cs:63-98`). Moving an entity from SQL Server to Cosmos is therefore a one-line attribute change. Two other pieces of the framework complete the portability claim rather than this class alone: [`CosmosDbContext`](#cosmosdbcontext) strips every relational index from the built model, because the Cosmos provider rejects them and indexes every property itself (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:79-87`), and [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) removes FK constraints and navigations that would span physical sources. A dedicated test builds a Cosmos model offline from a configuration that keeps a filtered index and a cross-source relationship, and asserts the indexes are gone, the FK is gone, the scalar FK column survives, and the foreign principal is not in the model (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:70-76`). `[Rubric §8, Data Architecture]` assesses how deliberately the storage shape is chosen and how tightly the model is bound to one engine. `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out without a rewrite; being able to re-point an entity's engine and database with attributes is a precondition for that ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html), [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). `[Rubric §16, Maintainability]` assesses whether one decision lives in one place; the per-engine differences live in exactly one `switch`.
- **Concept introduced, discovery and routing that agree by construction.** This class implements **all three** engine marker interfaces (`EntityTypeConfiguration.cs:30-32`), so a configuration derived from it is discovered during every engine's model pass. That sounds wrong until you see the filter: `ApplyConfigurationsForEntitiesInContext` applies a discovered configuration only when [`EntityDataSourceRegistry`](#entitydatasourceregistry) says the entity's [`DataSourceKey`](#datasourcekey) equals this context instance's key (`ApplicationDbContext.cs:629-636`). Both sides read the same attributes: the registry derives the engine from [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and the logical database from [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute), falling back to the entity's module namespace and then to `Default` (`EntityDataSourceRegistry.cs:172-185`), while this class reads the same attribute for its conventions. Discovery is broad, routing is exact, and there is no second source of truth to drift. `[Rubric §1, SOLID]` assesses whether behavior is driven from one declaration; here the attribute is that declaration.
- **Walkthrough**
  - **Declaration** (`EntityTypeConfiguration.cs:28-34`): abstract, extends the base class, implements the three markers, constrained to an audited entity with a non-null identifier type.
  - **`Configure` override** (`EntityTypeConfiguration.cs:37-49`): null-guards the builder (`:39`), calls `base.Configure(builder)` so the `DomainEvents` exclusion runs first (`:41`), then reads the engine.
  - **The attribute read and its failure mode** (`EntityTypeConfiguration.cs:43-46`): `GetType().GetCustomAttribute<UseDataSourceAttribute>()?.DataSource` on the **runtime** type, which is the concrete configuration. `UseDataSourceAttribute` is declared with `Inherited = true` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:12`), which is exactly why a class deriving from one of the shim bases inherits its engine without repeating the annotation. When the attribute is missing entirely the code throws `InvalidOperationException` naming the offending configuration class, rather than defaulting to an engine and mapping the entity somewhere surprising.
  - **`ApplyEngineConventions(builder, engine)`, `protected static`** (`EntityTypeConfiguration.cs:57-99`): extracted as a static helper so the provider shims share the identical logic (`:51-54`). It reads `typeof(TEntity).IsIdValueGenerated` once (`:61`), which is the presence test for [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) on the entity (`EntityTypeExtensions.cs:19`).
  - **SQL Server branch** (`EntityTypeConfiguration.cs:65-72`): `ToTable(entityName, moduleName ?? "dbo")`, so the SQL schema is the module name derived from the entity namespace and unmoduled entities land in `dbo`; `HasKey(p => p.Id)`; then `ValueGeneratedOnAdd()` when the entity opts into generated ids, `ValueGeneratedNever()` otherwise. That last branch is what lets a domain factory assign an id itself without EF overwriting it.
  - **SQLite branch** (`EntityTypeConfiguration.cs:74-81`): `ToTable(entityName)` with no schema, and the generated-id case adds `.UseIdentityColumn(1, 1)` on top of `ValueGeneratedOnAdd()`.
  - **Cosmos branch** (`EntityTypeConfiguration.cs:83-94`): `ToContainer(moduleName ?? entityName).HasPartitionKey(p => p.Id)`, plus `HasValueGenerator<CosmosIntIdValueGenerator>()` for generated ids. The inline comment records the reasoning for one container per module (`:84-85`): all of a module's entities share a container so their relationships and the navigation populators still work, and the entity id doubles as the partition key.
  - **The default arm** (`EntityTypeConfiguration.cs:96-97`): an unimplemented engine throws instead of silently producing an unmapped entity.
  - **`NamespaceConventions.GetModuleName`** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:16-22`): the module name is the namespace segment immediately preceding `Domain` (`MMCA.Store.Sales.Domain.Orders` yields `Sales`), and `null` when there is no `Domain` segment. The same helper feeds the logical database name in the registry (`EntityDataSourceRegistry.cs:181`), which is the point of it being shared: schema and database name can never drift apart.
- **Why it's built this way**: the framework's stated multi-database model is one context class per engine and one instance per database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), with the engine as an orthogonal axis ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). That only works if the mapping conventions for an engine live in one place that every context can call, which is this class. Keeping `ApplyEngineConventions` `static` and `protected` rather than inlining it in `Configure` is what allows the shims to exist as empty declarations.
- **Where it's used**: extended by the three shim bases below, and directly by any configuration that prefers to carry its own `[UseDataSource(...)]` annotation, as one portability test does (`CosmosConfigurationPortabilityTests.cs:101-103`). Its conventions are pinned against a real SQLite model in `SqliteConfig_Configure_SetsTableNameAndKey` and `SqliteConfig_Configure_SetsValueGeneratedNever_WhenNoAttribute` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:22`, `:37`).

### ReadRepositoryExtensions

> MMCA.Common.Application · `MMCA.Common.Application.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10` · Level 6 · class (public static)

- **What it is**: a static class that adds one member, `GetByIdOrFailAsync`, to every [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (`ReadRepositoryExtensions.cs:10-12`). It turns the repository's null-returning lookup into a [`Result<T>`](group-01-result-error-handling.md#result) that already carries a typed `NotFound` error, so handlers stop writing the same "load, null-check, build a 404" block.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (the receiver, `ReadRepositoryExtensions.cs:12`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (the generic constraint, `:13`); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error) (`:3`, `:43-47`).
- **Concept reinforced, C# `extension(T)` members over an infrastructure abstraction.** The extension-member syntax itself is taught once in the primer ([primer, extension types](00-primer.md#c-extensiont-types-read-this-once)); what matters here is *where* it is applied. `IReadRepository` is an Application-layer abstraction, and this file is in Application, so the helper enriches the contract without widening the interface every implementation would then have to satisfy (including the mocks in the test suite). `[Rubric §1, SOLID]` assesses whether types are open for extension but closed for modification; adding the convenience member as an extension rather than an interface method is precisely that trade. `[Rubric §15, Best Practices & Code Quality]` assesses whether repeated boilerplate has been factored out; the null-check-then-fail block collapses to a single call.
- **Walkthrough**
  - **`extension<TEntity, TIdentifierType>(IReadRepository<TEntity, TIdentifierType> repository)`** (`ReadRepositoryExtensions.cs:12-14`): a generic extension block whose receiver is the repository; the constraints mirror the interface exactly (`TEntity : AuditableBaseEntity<TIdentifierType>`, `TIdentifierType : notnull`).
  - **`GetByIdOrFailAsync(id, source, includes, asTracking, cancellationToken)`** (`ReadRepositoryExtensions.cs:27-32`): note the parameters. `source` is a string the caller passes (typically its own type name) so the resulting error can name who produced it; `includes` and `asTracking` are passed straight through, and `asTracking` defaults to `true`, matching the command-handler case where the loaded entity is about to be modified.
  - **The lookup** (`ReadRepositoryExtensions.cs:34-38`): it calls `GetAllAsync` with `where: e => e.Id.Equals(id)` rather than a keyed fetch. That is deliberate: `GetAllAsync` is the overload that takes the `includes` collection plus tracking (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:83-90`, declared on `IEntityQuerier<TEntity, TIdentifierType>`, which `IReadRepository` composes at `IRepository.cs:134-135`), so the helper participates in the full eager-loading pipeline. `includes ?? []` keeps the parameter optional.
  - **The failure branch** (`ReadRepositoryExtensions.cs:40-45`): `entities.FirstOrDefault()`, and when it is null, `Error.NotFound.WithSource(source).WithTarget(typeof(TEntity).Name)`. [`Error.NotFound`](group-01-result-error-handling.md#error) is the shared static instance (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:23`) and the two `With*` calls return copies (`Error.cs:106`, `:112`), so the shared instance is never mutated and the caller gets an error that names both the caller and the entity type.
  - **The success branch** (`ReadRepositoryExtensions.cs:47`): `Result.Success(entity)`.
- **Why it's built this way**: handlers in this codebase compose with [`Result`](group-01-result-error-handling.md#result), never exceptions, so a lookup that returns `null` forces every call site to translate. Doing the translation once, in the layer that owns the abstraction, keeps the error code, source, and target consistent across every module and keeps the 404 mapping at the API edge working off one well-known `ErrorType`.
- **Where it's used**: the only current callers in the workspace are its own tests (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Extensions/ReadRepositoryExtensionsTests.cs:15`, `:40`); no ADC or Store handler calls it today, and handlers there still do the explicit null check. It is available to any handler that resolves a read repository through [`IUnitOfWork.GetReadRepository`](#iunitofwork).
- **Caveats / not-in-source**: the method loads through `GetAllAsync`, so it materializes a collection and takes the first element rather than issuing a keyed `FindAsync`; whether that costs anything at the database depends on the provider's translation of the `Id.Equals(id)` predicate and is not determinable from source.

### EntityTypeConfigurationCosmos<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationCosmos.cs:18` · Level 7 · class (public abstract)

- **What it is**: a body-less shim over [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) whose only content is the class-level `[UseDataSource(DataSource.CosmosDB)]` annotation (`EntityTypeConfigurationCosmos.cs:17-21`). Deriving from it is equivalent to deriving from the engine-aware base and annotating the concrete class by hand, as its own doc says (`EntityTypeConfigurationCosmos.cs:10-13`).
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (base, `EntityTypeConfigurationCosmos.cs:19`); [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and the [`DataSource`](#datasource) enum (`:1`, `:17`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint, `:20`).
- **Concept reinforced, an attribute expressed as a base class.** All mapping logic (per-module container, entity-id partition key, client-side id generation via [`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator)) lives in the engine-aware base; this type exists so the engine choice reads as part of the class declaration a consumer already writes, and so `Inherited = true` on the attribute (`UseDataSourceAttribute.cs:12`) carries it to the concrete class. The declaration ends in a semicolon (`EntityTypeConfigurationCosmos.cs:21`): there is genuinely no body.
- **Where it's used**: no configuration in MMCA.Common, MMCA.ADC, MMCA.Store, or the Common test suite derives from it today. The Cosmos path is exercised instead through a direct `[UseDataSource(DataSource.CosmosDB)]` annotation on a configuration deriving from the engine-aware base (`CosmosConfigurationPortabilityTests.cs:101-103`), and the Aspire hosting extensions reference the type by name when documenting which entities a Cosmos data source will serve (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:229`). This matches the state ADR-018 records: the plumbing ships and is tested, with no non-SQL entity in production yet.

### EntityTypeConfigurationSqlite<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSqlite.cs:17` · Level 7 · class (public abstract)

- **What it is**: the SQLite shim, identical in shape to its Cosmos sibling: a body-less class carrying `[UseDataSource(DataSource.Sqlite)]` (`EntityTypeConfigurationSqlite.cs:16-20`).
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (base, `EntityTypeConfigurationSqlite.cs:18`); [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and [`DataSource`](#datasource) (`:1`, `:16`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`:19`).
- **Concept reinforced**: the attribute-as-base-class shim taught at [`EntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#entitytypeconfigurationcosmostentity-tidentifiertype). Its doc records the SQLite-specific mapping it delegates: table name plus an auto-increment key (`EntityTypeConfigurationSqlite.cs:7-12`), implemented in the engine-aware base at `EntityTypeConfiguration.cs:74-81`.
- **Where it's used**: no production configuration in the three repos derives from it, but it is the framework's own in-memory-and-file test engine and is used throughout the Common test suite: the database-initialization tests (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:106`), the convention tests (`EntityTypeConfigurationTests.cs:59`), the multi-source integration tests (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:237`, `:240`), and the registry tests (`EntityDataSourceRegistryTests.cs:209`, `:211`, including a deliberate duplicate-configuration pair at `:219` and `:222`).

### EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:17` · Level 7 · class (public abstract)

- **What it is**: the SQL Server shim, `[UseDataSource(DataSource.SQLServer)]` over the engine-aware base (`EntityTypeConfigurationSQLServer.cs:16-20`). It is the type nearly every entity configuration in this workspace actually derives from, which makes it the practical entry point into everything the family does.
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (base, `EntityTypeConfigurationSQLServer.cs:18`); [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and [`DataSource`](#datasource) (`:1`, `:16`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`:19`).
- **Concept reinforced, and what a consumer inherits by writing one base name.** Deriving from this class buys four behaviors without a line of code: the `DomainEvents` exclusion from [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype), a table named after the entity in a schema named after the module (`EntityTypeConfiguration.cs:66`), a primary key with the right generation policy for the entity's [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (`:67-71`), and a [`DataSourceKey`](#datasourcekey) in [`EntityDataSourceRegistry`](#entitydatasourceregistry) that makes the entity routable through [`IUnitOfWork`](#iunitofwork) and [`DbContextFactory`](#dbcontextfactory). Adding a class-level [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) on top overrides only the logical database, leaving the engine alone (`EntityDataSourceRegistry.cs:180-182`). `[Rubric §16, Maintainability]` assesses how much a consumer must know to add an entity correctly; here it is one base class name.
- **Where it's used**: 27 configurations across ADC's Conference, Engagement, and Identity modules (for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:13` and `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollConfiguration.cs:16`), 12 across Store's Catalog and Sales modules, MMCA.Helpdesk's single `TicketConfiguration`, and the framework's own notification configurations, [`PushNotificationConfiguration`](#pushnotificationconfiguration) and [`UserNotificationConfiguration`](#usernotificationconfiguration). It is also the SQL Server half of the cross-engine portability test (`CosmosConfigurationPortabilityTests.cs:116`).

### IRepositoryFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/IRepositoryFactory.cs:11` · Level 7 · interface (public)

- **What it is**: a two-method contract that builds a repository over a **caller-supplied** `DbContext` (`IRepositoryFactory.cs:11-34`). `Create` returns a read-write [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype), `CreateReadOnly` returns an [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype), and the class doc records the one behavior an implementation is expected to fold in: conditional MiniProfiler wrapping (`IRepositoryFactory.cs:7-10`).
- **Depends on**: EF Core's `DbContext` as the single parameter of both methods (NuGet, `IRepositoryFactory.cs:1`, `:20`, `:31`); [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) and [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) as return types (`:2`, `:19`, `:30`); [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) as the two entity constraints (`:3`, `:21`, `:32`).
- **Concept introduced, a factory for the argument DI cannot supply.** Plain constructor injection can hand a repository a `DbContext`, and the container does exactly that for the open-generic registration `TryAddScoped(typeof(IRepository<,>), typeof(EFRepository<,>))` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:107`). That registration can only ever bind **one** context, because DI resolves by type. This framework does not have one context: it has one context **instance per** [`DataSourceKey`](#datasourcekey), created and cached per scope by [`DbContextFactory`](#dbcontextfactory), and which instance an entity belongs to is a runtime lookup through [`IDataSourceService`](#idatasourceservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:40-41`). So the context stops being a dependency and becomes an argument, and an argument-taking creation step is a factory. This is the type-level reason the codebase forbids constructor-injecting `IRepository<,>` directly: that path silently binds whatever the container's single registration resolves, while everything routed through [`IUnitOfWork`](#iunitofwork) reaches this factory and gets the context its entity actually lives in. `[Rubric §2, Design Patterns]` assesses whether a pattern earns its place rather than decorating the code; here the factory exists because DI provably cannot express the requirement. `[Rubric §8, Data Architecture]` assesses how deliberately storage boundaries are drawn; per-source repository construction is what keeps database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) true at the level a handler touches.
- **Walkthrough**
  - **`Create<TEntity, TIdentifierType>(DbContext dbContext)`** (`IRepositoryFactory.cs:19-22`): constrained to `TEntity : AuditableAggregateRootEntity<TIdentifierType>` and `TIdentifierType : notnull`. Writes go through aggregate roots only, which is the DDD rule expressed in the signature rather than in a comment.
  - **`CreateReadOnly<TEntity, TIdentifierType>(DbContext dbContext)`** (`IRepositoryFactory.cs:30-33`): the same shape with a looser entity constraint, [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype). Reads may target a child entity that is not itself an aggregate root, which is exactly the asymmetry [`IUnitOfWork`](#iunitofwork) exposes on its own `GetRepository` / `GetReadRepository` pair (`UnitOfWork.cs:33-35`, `:53-55`).
  - **What the interface deliberately does not say**: nothing about profiling, decoration, caching, or activation. Those are implementation choices, and [`RepositoryFactory`](#repositoryfactory) makes them all.
- **Why it's built this way**: extracting the two lines from `UnitOfWork` into a contract means the unit of work never asks "is profiling on"; it asks for a repository and gets whichever composition the host configured. It also gives the test suite a substitution point that does not require a real context factory.
- **Where it's used**: registered scoped as `IRepositoryFactory -> RepositoryFactory` (`DependencyInjection.cs:108`) and pinned by `AddInfrastructure_RegistersIRepositoryFactory` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/DependencyInjectionInfrastructureTests.cs:276-286`). Its only production consumer is [`UnitOfWork`](#unitofwork), which injects it (`UnitOfWork.cs:13`, `:16`) and calls `Create` (`:42`) and `CreateReadOnly` (`:62`) once per entity type, caching the result for the rest of the scope (`:38-44`, `:58-64`).

### PushNotificationConfiguration

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:16` · Level 8 · class (internal sealed)

- **What it is**: the EF Core mapping for [`PushNotification`](group-10-notifications.md#pushnotification), the framework's own broadcast-notification aggregate (`PushNotificationConfiguration.cs:16-71`). It is one of only two entity configurations that ship **inside the framework** rather than in a consumer application, and it is where the dedup guarantee behind a retried send is actually enforced.
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) as its base (`PushNotificationConfiguration.cs:17`); [`PushNotification`](group-10-notifications.md#pushnotification) and its `DedupKeyMaxLength` / `ScopeKeyMaxLength` constants (`:3`, `:47`, `:53`, declared at `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:19`, `:22`); [`PushNotificationInvariants`](group-10-notifications.md#pushnotificationinvariants) for the title and body lengths (`:4`, `:29`, `:33`); [`PushNotificationStatus`](group-10-notifications.md#pushnotificationstatus) indirectly through the string conversion (`:43`); [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) (`:15`); the `HasSoftDeleteFilter` member from [`IndexBuilderExtensions`](#indexbuilderextensions) (`:69`); EF Core's `EntityTypeBuilder<TEntity>` (NuGet, `:1-2`).
- **Concept introduced, a framework-owned entity that has to name its own home.** Every other configuration in this workspace lets convention pick the schema and the logical database: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) maps a SQL Server entity to a table in a schema named by [`NamespaceConventions`](#namespaceconventions), which is the namespace segment immediately preceding `Domain` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:66`). That rule is right for a consumer entity in `MMCA.ADC.Conference.Domain.Sessions` (schema `Conference`) and wrong here, because this entity lives in `MMCA.Common.Domain.Notifications.PushNotifications`, whose preceding segment is `Common`. The configuration therefore states both facts explicitly: `[UseDatabase("Notification")]` (`PushNotificationConfiguration.cs:15`) fixes the logical database that [`EntityDataSourceRegistry`](#entitydatasourceregistry) records, and `ToTable(nameof(PushNotification), "Notification")` (`:25`) overrides the auto-derived schema after the base call. The class doc states this reasoning in place (`:8-13`), including the consequence that matters for a small host: a host with no `DataSources:Notification` entry collapses the logical name onto `Default` and keeps these tables in its one database. `[Rubric §8, Data Architecture]` assesses whether the physical layout is a decision rather than an accident; this is a convention override made visible in two attributes on one class. `[Rubric §10, Cross-Cutting Concerns]` assesses whether shared capabilities carry their own infrastructure; the notification feature ships its schema with the framework instead of asking each consumer to re-declare it.
- **Concept introduced, letting the database arbitrate a duplicate send.** A "have I already sent this?" check in a handler is a check-then-act race: two retries of the same request can both read "no row" before either writes. The filtered unique index on `DedupKey` (`PushNotificationConfiguration.cs:67-69`) removes the race by moving arbitration into the engine, and the filter is what makes it usable: `IS NOT NULL` keeps the many sends that carry no key from colliding with each other (SQL Server treats NULLs as equal in a unique index), and `IsDeleted = 0` keeps a soft-deleted notification from squatting on its key forever. The comment block records both halves and the defect that produced the second one (`:55-66`). `[Rubric §12, Performance & Scalability]` assesses whether index choices are reasoned; the file argues **for** one index and **against** another in the same class. `[Rubric §29, Resilience & Business Continuity]` assesses behavior under retry; at-least-once delivery upstream is only safe because this index makes a repeated send idempotent at the storage layer.
- **Walkthrough**
  - **`base.Configure(builder)`** (`PushNotificationConfiguration.cs:22`): runs the inherited chain first. [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype) ignores the aggregate's in-memory `DomainEvents` collection (`EntityTypeConfigurationBase.cs:29-32`), then [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) reads the engine off the inherited `[UseDataSource(DataSource.SQLServer)]` and applies the SQL Server conventions: table plus schema, `HasKey(p => p.Id)`, and `ValueGeneratedOnAdd()` because the entity carries [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (`EntityTypeConfiguration.cs:43-48`, `:65-72`, `PushNotification.cs:15`).
  - **The schema override** (`PushNotificationConfiguration.cs:25`): `ToTable(nameof(PushNotification), "Notification")`, applied **after** the base call so it replaces the derived `Common` schema rather than being replaced by it. Ordering is load-bearing here.
  - **Required scalars** (`:27-39`): `Title` required with `HasMaxLength(PushNotificationInvariants.TitleMaxLength)` (200, `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:13`), `Body` required at `BodyMaxLength` (2000, `PushNotificationInvariants.cs:16`), `SentByUserId` and `RecipientCount` required. The column widths are the same constants the domain validates against, so the database cannot be narrower than the invariant.
  - **`Status` stored as text** (`:41-44`): `HasConversion<string>()` with `HasMaxLength(20)`. The CLR type is the `PushNotificationStatus` enum (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotificationStatus.cs:6-9`); persisting the name rather than the ordinal means reordering or inserting an enum member does not silently re-interpret existing rows.
  - **`DedupKey`** (`:46-47`): nullable, bounded by `PushNotification.DedupKeyMaxLength` (128, `PushNotification.cs:19`). The domain records that this is typically the `Idempotency-Key` header value (`PushNotification.cs:39-44`).
  - **`ScopeKey`** (`:52-53`): nullable, bounded by `ScopeKeyMaxLength` (128, `PushNotification.cs:22`), and deliberately **not** indexed. The comment gives the economics (`:49-51`): the scope filter runs after the primary-key join from [`UserNotification`](group-10-notifications.md#usernotification), over a table holding one row per send, so an index would cost writes without buying a read.
  - **The filtered unique index** (`:67-69`): `HasIndex(p => p.DedupKey).IsUnique().HasSoftDeleteFilter(additionalFilter: "[DedupKey] IS NOT NULL")`. The helper composes the final predicate as `{additionalFilter} AND {softDeletePredicate}` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/IndexBuilderExtensions.cs:60-63`), and the soft-delete half comes from [`SoftDeleteFilterSql`](#softdeletefiltersql), which reads the actual column name out of the model and quotes it per engine (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:32-37`). The result is `[DedupKey] IS NOT NULL AND [IsDeleted] = 0`, asserted verbatim by `DedupKeyIndex_FiltersOutSoftDeletedRows` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/PushNotificationConfigurationTests.cs:27-30`).
  - **Why the opt-in call is needed at all** (`:62-66`): [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) already stamps `IsDeleted = 0` onto every unique index of a soft-deletable entity, but only when the index declares no filter of its own (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:53`). A hand-authored filter wins, so this index, which needs the `IS NOT NULL` half, must add the soft-delete half itself.
- **Why it's built this way**: the two overrides exist because a framework-owned domain type cannot be named by the convention that names consumer domain types, and stating the target explicitly is cheaper than special-casing the convention. The soft-delete clause on the dedup index is a fix, not an original design: it closes a defect where a soft-deleted notification held its dedup key permanently, and ADC's migration for it is an explicit expand-contract drop and recreate, since a filtered index predicate cannot be altered in place (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260804185520_CommonV1141PushNotificationDedupIndexSoftDeleteFilter.cs:13-31`). The migration comment argues the safety case explicitly: the new predicate is strictly more permissive, so a previous revision running against the new index still succeeds.
- **Where it's used**: discovered by assembly scan rather than by a direct reference. `AddNotificationInfrastructure()` registers this class's assembly as an entity-configuration source (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:513-518`, naming the type only to get its `Assembly`), and the only production caller is ADC's Notification module (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:24`), whose service points the logical `Notification` source at the `ADC_Notification` database (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.Development.json:32-43`). Store hosts no notification entities today. Behavior is pinned against a real model built from this exact configuration (`PushNotificationConfigurationTests.cs:76-83`): index uniqueness (`:22-24`), the composed filter (`:26-30`), the scope-key length and nullability (`:35-41`), and the deliberate absence of a scope-key index (`:43-49`).

### UserNotificationConfiguration

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/UserNotificationConfiguration.cs:15` · Level 8 · class (internal sealed)

- **What it is**: the EF Core mapping for [`UserNotification`](group-10-notifications.md#usernotification), the per-user inbox row that pairs a recipient with a broadcast (`UserNotificationConfiguration.cs:15-47`). It is the sibling of [`PushNotificationConfiguration`](#pushnotificationconfiguration) and shares its shape exactly: `internal sealed`, `[UseDatabase("Notification")]`, [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) base, and a `ToTable` that overrides the derived `Common` schema.
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) (`UserNotificationConfiguration.cs:16`); [`UserNotification`](group-10-notifications.md#usernotification) (`:3`, `:24`); [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) (`:14`); EF Core's `EntityTypeBuilder<TEntity>` (NuGet, `:1-2`).
- **Concept reinforced**: the schema-and-database override taught at [`PushNotificationConfiguration`](#pushnotificationconfiguration), with the identical doc comment stating why (`UserNotificationConfiguration.cs:7-13`). What is worth studying here instead is the **index pair**, which shows the two filtered-index cases side by side. `[Rubric §12, Performance & Scalability]` assesses whether hot read paths are backed by an index that matches the query's predicate; the unread lookup below is a textbook covering-filter case.
- **Walkthrough**
  - **Base call and schema override** (`UserNotificationConfiguration.cs:21`, `:24`): same order and same reason as its sibling.
  - **Scalars** (`:26-36`): `UserId` and `PushNotificationId` required, `IsRead` required with `HasDefaultValue(false)` so an inserted row is unread at the database level too, and `ReadOn` mapped with no facets, staying nullable because the domain declares it `DateTime?` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:24`).
  - **Uniqueness per recipient** (`:39-41`): `HasIndex(p => new { p.UserId, p.PushNotificationId }).IsUnique().HasFilter("[IsDeleted] = 0")`, one inbox row per user per notification among live rows. Note the literal predicate: this index would have received the same filter automatically from [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) (`SoftDeleteUniqueIndexConvention.cs:51-55`), because it is unique and the entity is soft-deletable, so the hand-written string is belt and braces rather than a requirement.
  - **The unread lookup** (`:44-45`): `HasIndex(p => new { p.UserId, p.IsRead }).HasFilter("[IsDeleted] = 0")`, non-unique, serving the per-user unread query behind the notification badge. This is the case the convention deliberately skips (it only touches unique indexes), so the filter here **is** required to keep soft-deleted rows out of the index. It is written as a literal rather than through `HasSoftDeleteFilter()` from [`IndexBuilderExtensions`](#indexbuilderextensions), which is the newer helper that reads the column name from the model instead (`IndexBuilderExtensions.cs:50-64`); the produced SQL is identical for this model.
  - **No relationship to `PushNotification`** (`:29-30`): `PushNotificationId` is configured as a plain required scalar, with no `HasOne`/`WithMany` anywhere in the file. The inbox row references the broadcast by value.
- **Why it's built this way**: the two notification tables can live in a database that is not the one holding the referencing module's data, so a declared FK navigation would be a cross-source relationship that [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) would strip anyway. Modeling the reference as a scalar from the start keeps the entity honest about what the database enforces, which is the same rule ADC applies to every cross-module reference under database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: registered by the same assembly scan as its sibling (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:513-518`) and reached in production only through ADC's Notification module (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:24`), where the `UserNotification` table lands in the `Notification` schema of `ADC_Notification` (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.Development.json:38-43`).
- **Caveats / not-in-source**: unlike its sibling, this configuration has no dedicated unit test in the Common suite; its mapping is exercised indirectly through the ADC Notification migrations and integration tier.

### RepositoryFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:14` · Level 10 · class (public sealed)

- **What it is**: the single implementation of [`IRepositoryFactory`](#irepositoryfactory). It activates the concrete EF repository over the supplied `DbContext` through a **compiled, cached** constructor delegate, and wraps it in a profiling decorator when the host has MiniProfiler switched on (`RepositoryFactory.cs:14-85`).
- **Depends on**: `IServiceProvider` and [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), both primary constructor parameters (`RepositoryFactory.cs:14-17`); [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype), [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype), [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype), [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) as the four concrete types it can build (`:31`, `:36`, `:55`, `:60`); `Microsoft.Extensions.DependencyInjection.ActivatorUtilities` and its `ObjectFactory` delegate type (NuGet, `:3`, `:80-84`); `System.Collections.Concurrent.ConcurrentDictionary` (BCL, `:1`, `:69`); EF Core's `DbContext` (`:2`).
- **Concept introduced, reflective activation traded for a cached compiled factory.** `ActivatorUtilities.CreateInstance` is the usual way to build a type whose constructor mixes DI-resolved services with caller-supplied arguments, and it is what this class used to call. Its cost is per call: it matches the constructor by reflection every time and caches nothing, so a request touching four aggregates paid four reflective activations. `ActivatorUtilities.CreateFactory` does the matching **once** and returns an `ObjectFactory`, a compiled delegate that can be invoked repeatedly. The insight that makes caching safe is stated in the code (`RepositoryFactory.cs:71-79`): each **closed** repository type here always takes the same argument shape, so the delegate can be keyed by type alone with no risk of a shape mismatch. `[Rubric §12, Performance & Scalability]` assesses whether hot paths avoid repeated per-call work; repository creation is on every command and query, so a per-type one-time cost replaces a per-call one. `[Rubric §15, Best Practices & Code Quality]` assesses whether an optimization is justified in place rather than left as folklore; the doc comment names the exact scenario it fixes.
- **Concept reinforced, decoration decided by configuration.** The decorator pattern itself is taught in the CQRS pipeline (see [`ApplicationDbContext`](#applicationdbcontext)'s neighbors in the handler chapters). Here it appears in its simplest form and with a switch: `IApplicationSettings.UseMiniProfiler` (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/IApplicationSettings.cs:10`) decides whether the plain repository is returned or is passed as the inner instance of a timing decorator. When the flag is off there is no wrapper object and no indirection at all, so profiling costs nothing in a production host that leaves it off. `[Rubric §13, Observability & Operability]` assesses whether the system can be inspected without being rebuilt; per-repository timing is a configuration flip.
- **Walkthrough**
  - **Primary constructor** (`RepositoryFactory.cs:14-17`): captures the provider and the settings into readonly fields. Nothing is resolved at construction, so the class stays cheap to create per scope (`DependencyInjection.cs:108` registers it scoped).
  - **`Create<TEntity, TIdentifierType>(DbContext dbContext)`** (`:25-41`): builds `EFRepository<TEntity, TIdentifierType>` through `Factory(..., DbContextArg)(_serviceProvider, [dbContext])` (`:30-31`). Only the context is passed positionally; the repository's two remaining constructor parameters are optional, `TimeProvider?` and `ICurrentUserService?` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:23-27`), and come from the provider, with the class doc recording the fallback when they are absent: the system clock and no user stamp (`EFRepository.cs:16-22`). When `UseMiniProfiler` is true (`:33`) the instance is re-wrapped by activating `EFRepositoryDecorator<TEntity, TIdentifierType>` with an argument shape of `[typeof(IRepository<TEntity, TIdentifierType>)]` (`:35-37`), matching the decorator's single `inner` parameter (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:14`).
  - **`CreateReadOnly<TEntity, TIdentifierType>(DbContext dbContext)`** (`:49-65`): the identical sequence against `EFReadRepository` and `EFReadRepositoryDecorator`, with the looser [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) constraint.
  - **`DbContextArg`** (`:67`): a single static `Type[]` holding `typeof(DbContext)`, shared by both creation paths so the common case allocates no argument-type array per call.
  - **`FactoryCache`** (`:69`): a static `ConcurrentDictionary<Type, ObjectFactory>`, so the compiled delegates are shared process-wide across scopes and requests, not per factory instance.
  - **`Factory(Type implementationType, Type[] argumentTypes)`** (`:80-84`): `FactoryCache.GetOrAdd(implementationType, static (type, args) => ActivatorUtilities.CreateFactory(type, args), argumentTypes)`. Two details are deliberate: the value factory is `static`, so it captures nothing, and the argument types travel through `GetOrAdd`'s state parameter instead of a closure, which is what keeps the lookup allocation-free on the hit path.
- **Why it's built this way**: [`UnitOfWork`](#unitofwork) must create a repository over a **specific** context instance chosen by data source (`UnitOfWork.cs:40-42`), which no container registration can express, so something has to do the activation by hand. Once that step exists, it is also the natural place to fold in the optional profiling decorator, and the natural place to pay the reflection cost once rather than per call. The class is `public` while all four types it builds are `internal`, which is the point: consumers get the contract and the composition, never the concrete repository types.
- **Where it's used**: injected into [`UnitOfWork`](#unitofwork) (`UnitOfWork.cs:13`, `:16`) and called from `GetRepository` (`:42`) and `GetReadRepository` (`:62`). Because the unit of work caches one repository per entity type per scope (`:38-44`), the factory typically runs once per entity type per request, and the compiled delegate is reused for every later request in the process. All four composition outcomes are pinned directly against a real SQLite context: plain repository with the flag off, decorated with it on, and the same pair for the read side (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:43-97`), plus two tests asserting the built instances are functional repositories (`:99-119`).
- **Caveats / not-in-source**: the cache is keyed by implementation type only, which is correct exactly as long as every call site for a given closed type passes the same argument shape. Both current call sites do, and the doc comment states that assumption (`RepositoryFactory.cs:74-78`), but nothing in the code enforces it: a future overload passing a different `argumentTypes` array for an already-cached type would silently reuse the first delegate.


---
[⬅ Validation](group-06-validation.md)  •  [Index](00-index.md)  •  [Authentication & Authorization ➡](group-08-auth.md)
