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
[`UnitOfWork`](#unitofwork), with the query-shaping helpers
([`SpecificationEvaluator`](#specificationevaluator), [`KeysetQueryBuilder`](#keysetquerybuilder))
that turn a specification or a cursor into SQL; a data-source routing layer that lets every entity
resolve to its own physical database ("database per service") and every tenant optionally to its own
copy of it; two model-finalizing conventions that keep that routing honest; an engine-portable
entity-configuration hierarchy; and a supporting cast of value converters, value generators, an
encryption converter, seeders, and design-time factories. The group also owns the settings objects the
whole engine binds from configuration ([`PersistenceSettings`](#persistencesettings),
[`ConnectionStringSettings`](#connectionstringsettings), [`DataSourcesSettings`](#datasourcessettings),
[`TenancySettings`](#tenancysettings), [`AuditTrailSettings`](#audittrailsettings)) plus the two
startup validators that fail a boot on a misconfiguration, and the Application-layer storage and push
contracts whose implementations are composed in
[Group 14](group-14-module-system-composition.md). The whole thing is the
[Rubric §8, Data Architecture] chapter of the codebase, and it leans hard on
[Rubric §7, Microservices Readiness] and [Rubric §3, Clean Architecture].

## One base context, one class per engine, one instance per database

[`ApplicationDbContext`](#applicationdbcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:41`)
is an abstract primary-constructor class over EF's `DbContext`. It holds the cross-cutting model
configuration every engine shares. It applies a global soft-delete query filter to every non-owned
[`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) using a runtime-built
expression tree, registered as a **named** `"SoftDelete"` filter (`ApplicationDbContext.cs:367-380`,
name at `:388`); it applies a second named `"Tenant"` filter to every non-owned
[`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity) (`ApplicationDbContext.cs:428-487`);
it configures the `RowVersion` optimistic-concurrency token, mapped as a SQL Server `rowversion` or as
a plain application-managed token on other providers (`ApplicationDbContext.cs:501-521`); and it maps
the framework's own bookkeeping tables so every relational database carries its own
([`OutboxMessage`](group-04-events-outbox.md#outboxmessage) at `:528-563`,
[`InboxMessage`](group-04-events-outbox.md#inboxmessage) at `:570-584`,
[`ScheduledJobEntry`](group-14-module-system-composition.md#scheduledjobentry) at `:594-618`,
[`AuditTrailEntry`](#audittrailentry) at `:628-656`), each with the filtered indexes its poll path and
its retention sweep need (`IX_OutboxMessages_Pending` at `:542-545`, `IX_OutboxMessages_Processed` at
`:550-552`, the keyed-ordering index `IX_OutboxMessages_Ordering` at `:559-562`,
`IX_InboxMessages_MessageId` at `:576-578`, `IX_InboxMessages_ProcessedOn` at `:582-583`,
`IX_ScheduledJobs_NextRunOn` at `:615-617`, `IX_AuditTrailEntries_Entity` at `:648-649`,
`IX_AuditTrailEntries_ChangedOn` at `:654-655`). Three of the five framework tables are **gated**: the
job table is mapped only when `Scheduler:Enabled` is set AND this context targets the `Default` source
(jobs are host-scoped, `:286-288`), the trail table only when `AuditTrail:Enabled` is set, on every
relational source (a trail row must commit with the change it describes, and a transaction does not
span databases, `:291`), and the refresh-session table only when `RefreshSessions:Enabled` is set AND
this context targets the source that setting names (`:296-299`, applied at `:673-681`). A host that
opted into none of them keeps the model it had before those features shipped, so none of those tables
ever appears in its migrations. The base also registers four keyless
[`ValReturn<T>`](#valreturnt) shapes (`:125`, `:338-341`) so raw SQL scalar queries have somewhere to
land.

Its `SaveChangesAsync(userId, ...)` overload (`ApplicationDbContext.cs:153-167`) is the one entry
point handlers care about: it stashes the current user id in `CurrentSaveUserId` so the audit
interceptor can read it, delegates to `base`, then clears it in a `finally` so a later internal save
cannot silently reuse the previous caller's identity (`:165`). The base also overrides both
`SaveChanges` overloads purely to run change detection once per save and suppress it for the rest,
through the `DetectChangesOnce` helper and its [`DetectChangesScope`](#detectchangesscope) disposable
(`:173-177`, `:206-208`, `:233-246`): each interceptor's `ChangeTracker.Entries<T>()` call would
otherwise trigger a full `DetectChanges`, so a save paid three snapshot comparisons where one
suffices, and the previous auto-detect setting is restored on the way out (`:245`).

The design decision that shapes this whole group is stated in the base's own doc comment: **one
context class per engine, one instance per physical data source** (`ApplicationDbContext.cs:29-35`).
The same [`SQLServerDbContext`](#sqlserverdbcontext) class
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:15`)
is instantiated once per SQL Server database, each instance carrying a different
[`PhysicalDataSource`](#physicaldatasource) (connection string, per-engine migrations assembly, Cosmos
database name). To keep EF from silently reusing the first-built model for every database,
[`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16`)
keys EF's model cache by context type plus physical source name plus the design-time flag (`:19-22`),
and is installed by the base in `OnConfiguring` (`ApplicationDbContext.cs:303`). This is deliberately
not a per-module context split: one sealed context per engine over the abstract base is
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)'s ruling.
`SQLServerDbContext` adds the provider-specific touches: a per-environment command timeout read from
[`PersistenceSettings`](#persistencesettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/PersistenceSettings.cs:10`, bound from
the `Persistence` section at `:13`, range-checked between 1 and 600 seconds and defaulting to the same
30 the framework applied implicitly before the section existed, `:21-22`) rather than
ADO.NET's silent 30-second default (`SQLServerDbContext.cs:55`, with the settings object resolved once
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
[`SqliteDbContext`](#sqlitedbcontext) (`.../DbContexts/SqliteDbContext.cs:12`) is the same shape with
`UseSqlite` and its own migrations assembly (`:24-35`), and
[`CosmosDbContext`](#cosmosdbcontext) (`.../DbContexts/CosmosDbContext.cs:14`) deliberately does not
call `base.OnModelCreating`, because the relational bookkeeping tables have no place in a document
store; it re-applies only the filters it needs (`:89-95`).

## SaveChanges as an interceptor pipeline

The base context resolves its interceptors from DI in `OnConfiguring`
(`ApplicationDbContext.cs:249-281`), and **registration order is execution order**. The audit
interceptor runs first, the tenant interceptor between it and the domain-event interceptor (so the
outbox rows describe an entity whose tenant is already final, `:258-271`), and the change-trail
interceptor last, because it diffs the final values (`:273-281`). Two of the four are resolved with
`GetService` rather than `GetRequiredService`: a directly-constructed test context or a host that
never called `AddAuditTrail` must still build, and their absence has to read as "the feature is off"
rather than fail every context construction.

[`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:22`)
runs on `SavingChanges`: it walks every tracked
[`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), stamps `CreatedOn/By` plus
`LastModifiedOn/By` on `Added` (`:56-60`), and on `Modified` marks the two `Created*` properties
unmodified before re-stamping `LastModified*` (`:67-71`), reading the timestamp from an injected
`TimeProvider` and the user id from `CurrentSaveUserId` (falling back to `default` as the
system-operation sentinel, `:49-50`). It also writes the soft-delete stamps, and it drives them off
the **transition** of the `IsDeleted` flag rather than its value: `DeletedOn/By` are written when the
flag goes false to true and cleared when it goes back (`:92-105`, with the original value read at
`:83-84`), so a later update to an already-deleted row keeps the stamps of the delete that produced
it, exactly as `CreatedOn/By` survive every update. This is why the domain declares audit fields with
private setters and never writes them: the interceptor sets them centrally through
`entry.Property(...).CurrentValue`, bypassing setter visibility. That is the
[Rubric §10, Cross-Cutting Concerns] payoff, one enforcement point instead of copy-paste in every
handler.

[`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:46`)
is the producer end of the outbox, and it is the most subtle type in the group. On `SavingChanges` it
snapshots each tracked [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot) and its
pending [`IDomainEvent`](group-04-events-outbox.md#idomainevent)s into an
[`AggregateCapture`](#aggregatecapture) record (`:221-225`, record at `:373`), then writes an
[`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row for each event into the same context, so
the events land in the database **in the same transaction** as the aggregate changes (`:207-272`). The
routing split happens right there: an
[`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) gets a row but no in-process
dispatch (its row stays unprocessed so the [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor)
publishes it over [`IMessageBus`](group-04-events-outbox.md#imessagebus)), while a local event gets both
a row and the fast in-process path (`:249-258`). Before capturing, `DiscardAbandonedCapture` detaches
the `Added` outbox rows left by a previous `SavingChanges` that never reached `SavedChanges`
(`:279-300`), which is what stops an execution-strategy retry from writing a second row per event and
publishing every integration event twice. The captured state is parked in a
[`CapturedState`](#capturedstate) record (`:382`) held in a `ConditionalWeakTable` keyed by context
(`:62`), so it is cleaned up automatically when the context is disposed. A third weak table (`:77`)
holds a per-context capture exclusion set: `BeginCaptureExclusion` / `EndCaptureExclusion` (`:179-195`)
let [`DbContextFactory`](#dbcontextfactory) name exactly the entries it hides from an
`IDENTITY_INSERT` round, so an event is never serialized and cleared a round before the insert that
justifies it. The exclusion is by instance rather than by entity state on purpose: a state-based filter
would also drop events raised on an already-saved aggregate, which is how the identity module publishes
its registration events (`:172-176`).

After the save, the post-save path `DispatchAndFinalizeAsync`
(`DomainEventSaveChangesInterceptor.cs:302-319`, reached from `SavedChangesAsync` at `:103-112`) does
one of two things. With no ambient transaction it flushes immediately: dispatch local events through
[`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher), remove exactly the
captured events from their aggregates, mark the local outbox rows processed through
[`OutboxFinalizer`](group-04-events-outbox.md#outboxfinalizer), and signal the outbox for integration
events (`:325-352`). With an active transaction it removes the captured events (so a second save inside
the same transaction cannot re-capture them) and parks a [`DeferredDispatch`](#deferreddispatch)
(`:389`) in a second weak table (`:69`); [`DbContextFactory`](#dbcontextfactory) then calls the static
`FlushDeferredAsync` only after a successful commit (`:145-159`) and `DropDeferred` on rollback
(`:162`). That is what keeps handler side effects from acting on state that could still roll back, and
what keeps a retrying execution strategy from dispatching the same events once per attempt. Note the
precision of the clearing: the interceptor calls `RemoveDomainEvents(capture.Events)` rather than
clearing the aggregate wholesale (`:361-366`), so an event a handler raises on the same aggregate
during in-process dispatch survives to a later capture instead of being wiped. If in-process dispatch
throws, the interceptor logs a warning and signals the outbox to retry from the persisted rows rather
than losing the event (`:339-346`). The synchronous `SavedChanges` path cannot await a dispatcher at
all, so it removes the captured events, signals the outbox, and leaves delivery entirely to it
(`:124-137`). Two conditions take the everything-in-process branch instead: Cosmos DB has no relational
outbox table, so the base exposes a `SupportsOutbox` flag (`ApplicationDbContext.cs:136`) that
[`CosmosDbContext`](#cosmosdbcontext) overrides to `false` (`CosmosDbContext.cs:69`); and a host can
turn the outbox off outright, which the interceptor reads once from the message-bus options into
`_outboxEnabled` (`:55`) and honors at the same branch (`:236`, `:263-268`). This split, atomic
persistence plus best-effort immediate dispatch with a durable fallback, is the at-least-once contract
of [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html); the consumer end lives
in [Group 04](group-04-events-outbox.md).

## The tenant boundary, read filter plus write guard

Multi-tenancy ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) is two
independent halves that meet in this group. The **read** half is the named `Tenant` query filter the
base context applies to every non-owned [`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity)
(`ApplicationDbContext.cs:428-487`). Three details make it work: the filter body embeds the context
instance as a constant typed as `ApplicationDbContext`, so EF rewrites it to the executing context and
lifts `CurrentTenantId` into a SQL parameter, letting **one compiled model serve every tenant**
(`:413-419`, `:434-436`); the predicate is `CurrentTenantId == null || e.TenantId == CurrentTenantId`,
so a scope with no tenant (the outbox processor, the seeders, the retention jobs) sees every tenant's
rows (`:478-484`); and the column itself is declared required, 64 characters, non-Unicode, and
**indexed** on relational engines, because every tenant-scoped read carries it as the leading predicate
(`:445-449`, width constant at `:397`). That index follows the filter composition rather than the
column: an entity that is also an `IAuditableEntity` gets `(TenantId, IsDeleted)`, matching the
AND-composed predicate every read of a soft-deletable tenant row actually carries, and a tenant-only
entity keeps the single-column index (`:458-466`). The filter reads the value through `EF.Property`
rather than a CLR member access, so an explicitly implemented interface member or a shadow property
translates identically (`:471-476`). Because the two filters are named, EF composes them with AND, and
a caller asking for soft-deleted rows drops exactly the `SoftDelete` filter while the tenant filter
stays in force: the repository contract says so in as many words
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:16-19`,
`:75-79`), and the repository passes that one filter name explicitly
(`.../Repositories/EFReadRepository.cs:33`).

The **write** half is [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:36`).
It stamps the scope's tenant onto an insert that declares none (`:116-119`), refuses an insert that
names a different one (`:122-123`), and on update or delete checks **both** the original and the current
value, so touching another tenant's row and reassigning a row to another tenant are both rejected
(`:131-159`, with the original reported in preference to the current one at `:161-166`). An untenanted
insert from an untenanted scope is refused too, because silently writing a row no tenant can ever read
is worse than failing the save (`:107-110`). Owned types are skipped on both sides: an owned value has
no independent existence and its owner's tenant is already the row's tenant (`:69-75`). Failures
surface as [`CrossTenantWriteException`](#crosstenantwriteexception)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/CrossTenantWriteException.cs:24`),
which derives from `InvalidOperationException` so existing catch sites treat it like any other save-time
invariant failure (`:19-22`). The deliberate asymmetry is documented in the interceptor's own remarks: a
caller who bypasses the read filter with EF's parameterless `IgnoreQueryFilters()` can read across
tenants, but still cannot write across them (`:29-33`). That is [Rubric §11, Security] and
[Rubric §30, Compliance and Data Governance] in one type. The scope's tenant itself lives in
[`TenantContext`](group-14-module-system-composition.md#tenantcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Context/TenantContext.cs:11`), which is
set-once-per-scope and idempotent for the same value, and throws rather than switching tenants
mid-scope (`:20-44`).

What a host declares about tenancy is bound into [`TenancySettings`](#tenancysettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:50`) from the
`Tenancy` section (`:53`), and the settings themselves carry the shape of the feature. `Enabled` gates
**resolution**, not isolation, so the query filter and the save interceptor are always present and simply
inert while no tenant is resolved, which is why a host that never opts in keeps exactly the behavior it had
(`:37-40`, default false at `:67`). `RequireTenant` defaults to true, so once resolution is on a request
that yields no tenant is rejected with `400 Bad Request` rather than reading across every tenant (`:91-96`).
Both collection properties express their defaults as "empty means the default", read through
`EffectiveResolutionOrder` (claim, then header) and `EffectiveExcludedPathPrefixes` (`/health`, `/alive`,
`/.well-known`), because the configuration binder ADDS to a pre-populated collection instead of replacing
it, so a non-empty default would leave a host that configured its own order running the framework's entries
too (`:42-48`, `:56-61`, `:76-77`, `:106-107`). [`TenantResolutionStrategy`](#tenantresolutionstrategy)
(`:6`) names the three sources: `Claim` is the trustworthy one (the token issuer signed it, so a caller
cannot pick its own tenant), `Header` is for service-to-service calls behind a trusted gateway, and `Host`
is **defined but not implemented**, present only so the configuration contract stays stable (`:8-27`).
[`TenancySettingsValidator`](#tenancysettingsvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:23`)
is what makes that honest: registered with `ValidateOnStart`, it fails the boot when a resolution order
names `Host` (`:54-65`) and checks each tenant's overrides against the resolved physical sources when
[`IDataSourceResolver`](#idatasourceresolver) is registered (`:14-18`, `:39-42`), on the reasoning that
every failure here would otherwise surface as silent cross-tenant behavior, which is the exact bug class
tenancy exists to prevent (`:8-13`). Declaring a tenant is only required for the database-per-tenant case:
a [`TenantEntrySettings`](#tenantentrysettings) (`TenancySettings.cs:121`) entry holds per-source overrides
keyed by **physical** source name, and each
[`TenantDataSourceOverrideSettings`](#tenantdatasourceoverridesettings) (`:138`) carries connection
information only, because a tenant database has the same schema as the shared one and the migrations
assembly is deliberately not overridable (`:124-137`, `:140-153`). A source without an entry stays shared
and is isolated by the query filter (`:126-127`).

Database-per-tenant is handled one layer up, in the factory, and background
sweeps expand their work list through [`TenantDataSourceTargets`](#tenantdatasourcetargets)`.Expand`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:49-79`),
which emits the shared target for every source plus one extra
[`TenantDataSourceTarget`](#tenantdatasourcetarget) (`:13`) per tenant that overrides a source, because
a tenant with its own database is invisible to the shared sweep (`:33-37`).

## Recording what changed, the audit trail

[`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:62`)
is the fourth interceptor ([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)).
It records a field-level history for entities marked
[`IAuditedEntity`](group-02-domain-building-blocks.md#iauditedentity), writing
[`AuditTrailEntry`](#audittrailentry) rows in the same transaction as the change they describe, on the
outbox precedent that a trail committable without its data is worse than no trail (`:18-22`). A
`Modified` save produces one row per property whose value actually changed; `Added` and `Deleted`
produce a single summary row with a null `PropertyName`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailEntry.cs:15-21`,
class at `:23`). Four things are worth knowing about it. It is opt-in twice over, once through
`AddAuditTrail` (the interceptor is resolved with `GetService`) and once through `AuditTrail:Enabled`
(which maps the table), and both are checked cheaply per save by asking the model whether the entity
type exists at all (`:179-186`). Both switches read the same bound
[`AuditTrailSettings`](#audittrailsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:16`,
section name at `:19`), whose `Enabled` decides both whether changes are recorded and whether the
`AuditTrailEntries` table is mapped at all, defaulting to false so adopting the framework never adds a
table or a write per change to a host that did not ask for one (`:10-15`, `:21-26`), whose `RetentionDays`
defaults to 90 and is inert unless the host also runs the scheduler (`:28-38`), and whose `DataSource`
names the one engine the v1 read surface queries, defaulting to SQL Server because the table is relational
(`:40-46`). Personal data never reaches the table: a property carrying
[`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute) records
[`PiiRedactor`](group-02-domain-building-blocks.md#piiredactor)`.RedactedToken` on both sides, and the
redaction happens **at capture, not at read**, so the trail cannot become a second copy of a data
subject's personal data that erasure would have to chase (`:37-41`, applied at `:309-310`,
[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)). The framework's own
bookkeeping types are excluded by CLR type rather than by marker absence, which is what stops the trail
from recording its own rows in an unbounded feedback loop (`:106-118`, checked at `:225-228`). And the
correlation value it records is the ambient `Activity` trace id rather than a scoped correlation
service, because a singleton interceptor holding a context built by the singleton physical factory
cannot reach a scoped service without a lifetime bug; the doc comment says exactly that and names the
accessor pattern tenancy introduced as the way to change it later (`:43-53`). The values every row of
one save shares (user, instant, trace id, tenant) are gathered once into a
[`CaptureContext`](#capturecontext) record struct (`:189-193`, declared at `:541`), and a row describing
an insert whose key the database has not assigned yet is parked as a
[`PendingEntityKey`](#pendingentitykey) (`:550`) until the store-generated key exists (`:368-401`).
Two more types close the feature: [`AuditTrailReader`](#audittrailreader)
(`.../AuditTrail/AuditTrailReader.cs:35`) serves paged history for one entity behind
[`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader) and states its own v1 limitation,
that it reads only the `Default` source's trail table (`:17-24`), and
[`AuditTrailCleanupJob`](#audittrailcleanupjob) (`.../AuditTrail/AuditTrailCleanupJob.cs:48`) is the
framework's own recurring [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob), purging rows past
`RetentionDays` from every relational source nightly at 03:00 UTC in 1000-row batches that read ids
first and delete them with `ExecuteDelete` (`:58`, `:63`, `:67`, `:70-85`, `:150-176`), expanding that
source list through [`TenantDataSourceTargets`](#tenantdatasourcetargets) so a tenant with its own
database gets swept too (`:83`, per-tenant scope at `:105-111`). It only runs if the host also runs the
scheduler, and a host that records the trail without one is fully supported: pruning is then the
operator's job (`:23-27`).

## Repositories, specifications, and the unit of work

Handlers do not touch a `DbContext` directly. They ask a [`UnitOfWork`](#unitofwork)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13`) for a repository.
The repository contract is deliberately interface-segregated
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs`, the contract
[ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html) states): a
handler that only needs a lookup can depend on the narrow
[`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype) (`IRepository.cs:21`)
or [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype) (`:80`);
[`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (`:330`) combines
both plus four `IQueryable` surfaces (tracking, no-tracking, single-query, split-query, `:336-345`),
[`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype) (`:367`) adds
mutation, and [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) (`:467`) is
the union. That layering is the group's clearest [Rubric §1, SOLID] (interface-segregation) statement,
and [`ReadRepositoryExtensions`](#readrepositoryextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10`) adds the
`GetByIdOrFailAsync` convenience that turns a miss into a
[`Result`](group-01-result-error-handling.md#result) failure (`:27-48`). The concrete
[`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype)
(`.../Repositories/EFReadRepository.cs:19`) and
[`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:23`) wrap
an EF `DbSet`; the read side keeps its `GROUP BY` projections in the private
[`GroupedCount<TKey>`](#groupedcounttkey) and [`GroupedSum<TKey>`](#groupedsumtkey) records
(`EFReadRepository.cs:180`, `:185`) so the aggregation happens in the database rather than in memory.
The write side patches already-tracked entities in place through an O(1)
`Local.FindEntry` lookup instead of re-attaching (`EFRepository.cs:52-64`) and seeds `RowVersion`
original values for optimistic concurrency on both the aggregate and any child implementing
[`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) (`:74-93`,
[ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Two set-based escape
hatches sit beside the tracked path: `ExecuteDeleteAsync`, which the interface itself documents as
bypassing domain events, audit stamps, and soft-delete (`IRepository.cs:419-429`), and
`ExecuteUpdateAsync` (`:431-453`), the contention-proof conditional update whose guard predicate lets
the database arbitrate two racing callers with no rowversion retry loop. The latter is described
through the persistence-agnostic
[`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) surface and replayed onto EF's setters
builder by [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity)
(`.../Repositories/UpdatePropertySetterBuilder.cs:14`), which is what keeps EF Core out of the
Application layer, and because `ExecuteUpdate` bypasses the interceptor pipeline the repository stamps
`LastModifiedOn/By` itself unless the caller assigned them (`EFRepository.cs:119-130`).

The read repository does not compose queries by hand. [`SpecificationEvaluator`](#specificationevaluator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/SpecificationEvaluator.cs:20`)
turns an [`ISpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ispecificationtentity-tidentifiertype)
into an `IQueryable`: criteria always, then the includes, the
[`OrderExpression`](group-03-querying-specifications.md#orderexpression) chain, and the paging a
[`QuerySpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#queryspecificationtentity-tidentifiertype)
carries (`:36-61`), with the shape deliberately skipped for aggregate reads because joining includes to
count rows costs a join per navigation (`:22-26`). Tracking and soft-delete scope are **not** its
business: those choose the base queryable, which only the repository can do (`:14-18`). It also owns the
one split-query heuristic in the framework, opting into `AsSplitQuery` as soon as any include targets a
collection navigation (`:86-93`), and `EFReadRepository.ApplyIncludes` delegates to it so the
string-include path and the specification path cannot drift (`:65-70`,
`EFReadRepository.cs:426-429`). Cursor paging is the sibling helper:
[`KeysetQueryBuilder`](#keysetquerybuilder) (`.../Repositories/KeysetQueryBuilder.cs:22`) resolves the
requested sort property or fails validation (`:35`), orders by `(sortKey, Id)` with the identifier
tie-break that makes the order total (`:59`), and builds the composite seek predicate against the
last row of the previous page (`:102`), so `GetPageByCursorAsync`
(`IRepository.cs:316`, implemented at `EFReadRepository.cs:496`) seeks straight to the boundary instead
of counting past every skipped row. Exactly one sort key is supported, by design
(`KeysetQueryBuilder.cs:17-20`). That is [Rubric §12, Performance and Scalability] expressed as a
contract rather than as advice.

Two factories keep the wiring honest. [`RepositoryFactory`](#repositoryfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:15`)
builds a repository over a given context and conditionally wraps it in a MiniProfiler decorator
([`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype) or
[`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype))
when `UseMiniProfiler` is on (`:34-38`, `:58-62`), adding timing without the base repository knowing,
and it activates both through a cached compiled `ObjectFactory` rather than reflecting on every call
(`:70-84`). [`DbContextFactory`](#dbcontextfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:39`)
is the scoped coordinator: it caches one [`ApplicationDbContext`](#applicationdbcontext) per
[`DataSourceKey`](#datasourcekey) so every repository in a scope shares one change tracker (`:87-118`),
gives each new context a live tenant accessor rather than a copied value (`:129-140`), and enlists a
late-created context into an already-open transaction (`:107-108`). It is also the database-per-tenant
routing point: when the scope's tenant overrides a source, the context is created against that tenant's
connection string while keeping the **original** `DataSourceKey`, which is what lets one compiled model
serve every tenant's database (`:143-173`), and a cached routed context is refused to a second tenant
rather than silently serving the first tenant's rows (`:176-198`). Its save loop runs up to
`MaxSavePasses` (3, `:53`) passes over the cached contexts, because dispatching events in-process can
materialize a context for a source nobody had touched yet (`:237-251`), and it closes with a hard
assertion: any context still reporting `ChangeTracker.HasChanges()` when the unit of work returns throws
rather than silently discarding those changes (`:259-269`).

Because there can be more than one physical source in play, `ExecuteInTransactionAsync` (`:499-544`)
runs the operation under the first transactional context's execution strategy, opens a transaction per
source, and commits them sequentially with no two-phase commit (`TryCommit` at `:621-660`);
cross-source consistency is the outbox's job, and the doc comment is explicit that a commit failure on
the second source leaves the first one committed (`:488-498`). The method is re-entrant: a nested call
joins the ambient transaction instead of opening a second one, so only the outermost call may begin,
commit, roll back, or flush (`:503-511`). A returned failed
[`Result`](group-01-result-error-handling.md#result) rolls back exactly like an exception (`:563-570`),
which is what makes [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)'s
Result-over-exceptions rule safe for partial persistence; rollback also drops the deferred event
dispatch (`:443-447`), the deferred flush runs only after every commit has succeeded (`:576-584`), and a
retry resets the change tracker first so the aborted attempt's `Added` entities are not inserted twice
(`ResetForRetry` at `:742-751`). `DbContextFactory` further carries the
`SET IDENTITY_INSERT` machinery ([`IdentityInsertGroup`](#identityinsertgroup) at `:405`, the per-table
save split at `:284-403`) for importing entities with explicit database-generated ids one table at a
time, and the `MigrateAsync` / `HasPendingMigrationsAsync` sweeps (`:686-739`) over every source whose
resolved [`PhysicalDataSource`](#physicaldatasource)`.UsesMigrations` says a migrations pipeline owns
its schema (`PhysicalDataSource.cs:48-54`, target selection at `DbContextFactory.cs:706-725`).

[`UnitOfWork`](#unitofwork) sits on top, resolving an entity's physical source through
[`IDataSourceService`](#idatasourceservice), handing the matching context to the factory, and caching the
resulting repository per closed generic interface type (`UnitOfWork.cs:33-66`). The physical creation
itself runs through [`PhysicalDbContextFactory`](#physicaldbcontextfactory)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:16`),
a singleton that switches on the key's engine to construct the right context class (`:41-48`) and whose
doc comment warns it must **never** be pooled, because each instance carries per-source constructor
state that pooling would smear across databases (`:10-14`). The interfaces
([`IUnitOfWork`](#iunitofwork), [`IDbContextFactory`](#idbcontextfactory),
[`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory), [`IRepositoryFactory`](#irepositoryfactory))
keep the application layer talking to abstractions. Every member of that factory family has its own
section below, including the two types that exist only because of what the coordinator does:
[`IdentityInsertGroup`](#identityinsertgroup), the per-table batch the `SET IDENTITY_INSERT` loop saves
one at a time, and [`TransactionCommitAmbiguousException`](#transactioncommitambiguousexception)
(`.../Factory/TransactionCommitAmbiguousException.cs:22`), which the commit path raises when the commit
itself fails with an outcome nobody can vouch for, naming each physical source's outcome (committed,
ambiguous, or rolled back) so the partial state is observable rather than inferred (`:57-70`,
`DbContextFactory.cs:649-654`). That exception is thrown **outside** the execution strategy on purpose
(`DbContextFactory.cs:536-542`), because the strategy walks an exception's whole inner chain to decide
retriability and would otherwise re-run the operation on top of a possibly-durable commit.

## Routing an entity to its database

The heart of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) is that every
entity resolves to a [`DataSourceKey`](#datasourcekey)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/DataSourceKey.cs:15`), a
`(Engine, Name)` record struct where the [`DataSource`](#datasource) engine
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:6`) is
one of Cosmos DB, SQLite, or SQL Server, and `Name` is a **physical** database name defaulting to
`"Default"` (`DataSourceKey.cs:18-23`). Two layers compute this.
[`DataSourceResolver`](#datasourceresolver)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:15`),
the [`IDataSourceResolver`](#idatasourceresolver) singleton (`.../DataSources/IDataSourceResolver.cs:15`),
builds the logical-to-physical map once per engine from configuration and hands out the resolved
[`PhysicalDataSource`](#physicaldatasource) (`:89-102`, `:139-144`). Named sources with no connection
string, or whose connection identity equals the top-level one, **collapse onto the `Default` source**,
so a host with no `DataSources` section behaves exactly like a single-database monolith
(`DataSourceResolver.cs:243-282`), and sources sharing a connection identity collapse onto one canonical
key named after their alphabetically-first member (`:325-346`, canonical name at `:332`). What the
`Default` source is built from is itself resolved rather than assumed: the top-level
`ConnectionStrings` section first, and when it names nothing for this engine while `DataSources` names
exactly one database on it, that database becomes `Default`, which is what keeps the framework's own
tables working in a host that declares its database only under `DataSources` (`:198-233`, captured in
the private [`DefaultSeed`](#defaultseed) record at `:173`). Identity is the connection string compared
ordinally, with the Cosmos database name appended because one account hosts many databases (`:447-450`).
The resolver fails fast when two logical names collapsing to one database declare conflicting
migrations assemblies (`:418-439`) and logs a warning when a separate SQL Server source falls back to
the Default migrations assembly (`:340-346`, message at `:471`). It also substitutes the host's own
engine for a request naming an engine the host does not configure, in a fixed relational-first
preference order (`:26`, `:106-107`), because every table the framework owns is relational and honoring
an unconfigured engine literally handed those components an empty connection string.

What the resolver reads is two bound settings objects.
[`ConnectionStringSettings`](#connectionstringsettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/ConnectionStringSettings.cs:12`)
is the top-level `ConnectionStrings` section (`:15`): one connection string per engine plus the SQL Server
migrations assembly, and deliberately **no** required property, because a host may run entirely on SQLite
or Cosmos, or declare its databases only under `DataSources` (`:5-10`, `:17-33`).
[`DataSourcesSettings`](#datasourcessettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourcesSettings.cs:13`)
is the named half, a dictionary keyed by **logical** source name (`:16`, `:23-25`) that `AddInfrastructure`
builds directly from configuration rather than through the options pipeline, because a root-level
dictionary section does not bind there (`:8-11`); it rejects an empty entry name and reserves `Default`,
which is configured through the top-level section instead (`:27-39`). Each entry is a
[`DataSourceEntrySettings`](#datasourceentrysettings)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceEntrySettings.cs:19`)
whose properties are all optional and fall back to the corresponding top-level value, which is exactly the
collapse-onto-`Default` behavior the resolver implements (`:3-8`). The one property with no top-level
fallback is `SqliteMigrationsAssembly`: `ConnectionStrings` carries only the SQL Server migrations
assembly, so a SQLite `Default` source declares its own through a collapsing entry, and a mixed-engine host
cannot silently apply its SQL Server migrations assembly to a SQLite database (`:30-43`). Across both
sections one rule is enforced at startup by
[`ConnectionStringSettingsValidator`](#connectionstringsettingsvalidator)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/ConnectionStringSettingsValidator.cs:30`),
registered with `ValidateOnStart`: the host must be able to reach at least one database, top level or
named, or it fails to boot with a message naming both configuration shapes (`:38-43`, `:46-59`). That rule
replaced a `[Required]` annotation on the SQL Server connection string, which encoded "SQL Server is the
only engine a host can boot on" and failed a SQLite-only host whose every entity resolved to a configured
database (`:10-24`).

[`EntityDataSourceRegistry`](#entitydatasourceregistry)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21`),
also a singleton, scans the configuration assemblies and maps each entity to its physical key, deriving
the engine from the [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute)
on the **configuration class** and the logical name from
[`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute), the entity's module
namespace via [`NamespaceConventions`](#namespaceconventions)`.GetModuleName`, or `Default`
(`EntityDataSourceRegistry.cs:172-185`). It caches an immutable [`Snapshot`](#snapshot) of frozen
collections built on first access (`:25-28`, `:82-92`, built at `:115-160`), rescans once on a lookup
miss when the assembly set changed so late-loaded module assemblies are picked up (`:95-113`), rejects an
entity claimed by two different sources (`:141-149`), and precomputes the distinct physical sources in
use so the outbox processor's per-poll call allocates nothing (`:75-80`, `:157-159`). Because the
registry reads the same attributes the model configuration reads, routing and model contents agree by
construction, and configurations that implement a provider interface directly without the attributed
base classes are deliberately skipped as legacy (`:163-176`). [`DataSourceService`](#datasourceservice)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceService.cs:11`) is the thin
application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry), and it answers
the one question navigation loading needs: two entities support EF `.Include()` only when their physical
keys are equal and the engine is not Cosmos (`DataSourceService.cs:30-31`).

## Two model-finalizing conventions

The base context adds both of its conventions in `ConfigureConventions`
(`ApplicationDbContext.cs:309-324`), and each exists because a cross-cutting policy above would
otherwise produce an invalid or surprising model.
[`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33`,
added at `ApplicationDbContext.cs:318`) is what lets routing be lazy and attribute-driven and still
produce a valid EF model. When a relationship's two ends live in different physical sources it removes
the foreign key (a database cannot enforce an FK into another database), keeps the declared scalar FK
columns plus a compensating index unless an existing index already covers them as a prefix, ignores the
CLR navigation members, and drops the foreign entity types out of this database's model entirely
(`CrossDataSourceDegradeConvention.cs:38-89`, `:110-140`). It works through EF's **mutable** model API
rather than convention builders, because the soft-delete and concurrency helpers have already promoted
every entity type to the Explicit configuration source (`:22-24`, `:44-46`), it eagerly drops the
convention-created FK index before the coverage check so the column does not end up unindexed
(`:126-131`), and it skips the compensating index on Cosmos, which auto-indexes everything and rejects
explicit index definitions (`:65`, `:118-121`). Runtime navigation across sources then flows through the
[`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)
batch-loading machinery in [Group 11](group-11-navigation-populators.md). Crucially, when every entity
collapses onto one physical source (the monolith case) nothing is foreign and the convention returns
early (`:52-55`), so the model is identical to the single-database model. That is the property that lets
the same codebase run as a monolith today and as split services later without a rewrite, the core
[Rubric §7, Microservices Readiness] claim.

[`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention)
(`.../Conventions/SoftDeleteUniqueIndexConvention.cs:33`, added at `ApplicationDbContext.cs:323`) closes
a smaller but sharper hole. Soft-delete hides a row from queries, but a plain unique index still enforces
uniqueness against it, so "deleting" a speaker would permanently block re-creating one with the same
email. The convention adds an `IsDeleted = 0` filter to every unique index on a soft-deletable entity
and **extends** rather than skips a hand-authored filter, appending its clause with `AND` so an index
already narrowed on something else keeps its own predicate and still stops enforcing uniqueness against
soft-deleted rows; a filter that already constrains the soft-delete column is left exactly as it is, so
the append is idempotent (`SoftDeleteUniqueIndexConvention.cs:36-81`). It is a no-op for Cosmos
(`:41-42`). The predicate text itself is not built inline: both this convention and the opt-in
`HasSoftDeleteFilter` extension go through [`SoftDeleteFilterSql`](#softdeletefiltersql)`.Build`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:27-36`), which
reads the column name from the model and quotes it per engine (brackets for SQL Server, double quotes for
SQLite, `null` for Cosmos), with a normalized comparison for the already-present check (`:53-56`), so the
automatic and the hand-authored path can never disagree.
[`IndexBuilderExtensions`](#indexbuilderextensions) (`.../Configuration/IndexBuilderExtensions.cs:10`) is
that opt-in half, an `extension(IndexBuilder)` block for the case the convention deliberately leaves
alone: a hand-authored **non-unique** index that serves a live-row query and wants the same predicate
(`:12-65`, with an optional additional predicate joined by `AND` at `:60-64`). Both conventions run at
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
`DomainEvents` collection from mapping (`:25-32`). Value objects reach the database through this layer
too: [`EntityTypeBuilderExtensions`](#entitytypebuilderextensions)
(`.../Configuration/EntityTypeBuilderExtensions.cs:12`) flattens a
[`Money`](group-02-domain-building-blocks.md#money) into an amount plus a three-character non-Unicode
ISO 4217 code column with a read-leg fallback to the zero-Money sentinel
[`Currency`](group-02-domain-building-blocks.md#currency) (`:19`, mapping at `:62-77`, fallback at
`:71`); the four converters in `Persistence/Conversions` map
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
is not a schema change.

Discovery runs through [`ModelBuilderExtensions`](#modelbuilderextensions)`.ApplyAllConfigurations`
(`.../DbContexts/ModelBuilderExtensions.cs:10`, an `extension(ModelBuilder)` block at `:12`), which the
base calls with an entity filter so each database's model receives only its own entities
(`ApplicationDbContext.cs:690-717`, filter application at `ModelBuilderExtensions.cs:57-60`), over the
assemblies supplied by [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) and
its [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider)
implementation (`.../Persistence/DefaultEntityConfigurationAssemblyProvider.cs:12`), which scans loaded
`*.Infrastructure` assemblies, excludes `Common.Infrastructure` itself, and appends whatever a host
registered through [`EntityConfigurationOptions`](#entityconfigurationoptions)
(`DefaultEntityConfigurationAssemblyProvider.cs:16-21`, options at
`.../Persistence/EntityConfigurationOptions.cs:10`). Two configurations ship inside the framework itself,
[`PushNotificationConfiguration`](#pushnotificationconfiguration) and
[`UserNotificationConfiguration`](#usernotificationconfiguration)
(`.../Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:16`,
`.../UserNotificationConfiguration.cs:15`), both tagged `[UseDatabase("Notification")]` and re-declaring
the `Notification` schema because namespace derivation would otherwise resolve them to `Common`
(`PushNotificationConfiguration.cs:8-15`, `:25`). This engine-portability design is
[ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) (polyglot persistence); note
the current-reality caveat: the SQLite and Cosmos plumbing is shipped and tested, but every concrete
subclass of the SQLite and Cosmos configuration bases lives in Common's own test projects, so SQL Server
is the only engine backing production entities today.

## Refresh sessions, a table one database owns

Multi-device refresh sessions ([ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html))
are the one framework table that is deliberately not cross-cutting.
[`RefreshSessionModelBuilderExtensions`](#refreshsessionmodelbuilderextensions)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionModelBuilderExtensions.cs:16`)
maps the [`RefreshSession`](group-08-auth.md#refreshsession) table on request rather than everywhere,
and the doc comment gives the reason: the outbox is infrastructure every relational source needs, while
refresh sessions are Identity-module data that exactly one database owns, so mapping them everywhere
would leave an empty `RefreshSessions` table in every other module's migrations (`:6-14`). It maps the
token hash as a fixed-width non-Unicode column, uniquely indexed because that is the lookup a refresh
answers and because a collision across users would let one account's token validate against another's
session (`:44-49`, `:60-66`), plus a `(UserId, RevokedAt)` index for the per-user family questions the
session cap, reuse detection and sign-out-everywhere all ask (`:68-71`). The base context calls it from
the gated `ConfigureRefreshSessions` (`ApplicationDbContext.cs:673-681`) precisely because a downstream
app runs on the sealed engine contexts and has no `OnModelCreating` of its own to override.
[`EFRefreshSessionStore`](#efrefreshsessionstore) (`.../Auth/EFRefreshSessionStore.cs:30`) is the
[`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore) implementation over that table; it
resolves which database holds it the same way the rest of the framework routes an entity (the registry
first, then `RefreshSessions:DataSourceName`, `:6-15`) and reads **tracked** on purpose, because the
caller revokes by mutating the instances it hands back (`:16-19`).
[`RefreshSessionCleanupService`](#refreshsessioncleanupservice) (`.../Auth/RefreshSessionCleanupService.cs:48`)
hard-deletes spent rows past `RetentionDays`: the row is bookkeeping, not an aggregate, and its content
is a credential digest plus the IP and user agent of a device, so keeping it past its usefulness is both
a growing table and a growing set of records describing a data subject
([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), `:8-16`). Its own doc
comment names the trade the retention window makes: a rotation chain older than the window is gone, so a
replay of a token that old reads as an unknown token instead of signalling reuse (`:17-23`). That is
[Rubric §11, Security] meeting [Rubric §30, Compliance and Data Governance] again, in a table rather
than in an interceptor.

## Encryption, seeding, design time, and the shared helpers

A handful of supporting pieces round out the EF side. [`EncryptedStringConverter`](#encryptedstringconverter)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:72`)
is a value converter that transparently encrypts a string column with authenticated AES-256-GCM. The stored
value is a versioned Base64 envelope, a one-byte key version, a random 12-byte nonce, the ciphertext, then a
16-byte tag, with the version byte passed to AES-GCM as associated data so it is covered by the
authentication tag and a rewritten version byte fails decryption instead of silently selecting a different
key (`:38-44`, envelope assembled at `:204-210`). A converter is built over either a single key, registered
as version 1 (`:94-97`), or a whole key ring plus a current version so reads resolve their key from the
version byte stored with each value and rotation needs no downtime (`:109-112`), and it rejects any key that
is not exactly 32 bytes on both paths (`:127-141`, `:146-181`). Its own doc comment states the constraint
that governs where it may be used: the ciphertext is non-deterministic, so the column cannot back equality
predicates, unique indexes, or server-side sorting (`:19-32`). It is the [Rubric §11, Security] control that
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
[Rubric §14, Testability] win. Two more helpers sit at this level:
[`SqlServerUniqueConstraintViolationDetector`](#sqlserveruniqueconstraintviolationdetector)
(`.../Persistence/SqlServerUniqueConstraintViolationDetector.cs:31`) is the
[`IUniqueConstraintViolationDetector`](#iuniqueconstraintviolationdetector) implementation that classifies
a duplicate-key failure by SQL Server error number 2601 or 2627, walking the whole inner-exception chain
and falling back to the message text so a wrapped or non-SQL-Server provider failure still classifies
(`:34-40`, `:47-73`); and [`ProfilingHelper`](#profilinghelper) (`.../Persistence/ProfilingHelper.cs:9`)
is the MiniProfiler step wrapper the repository decorators share (`:11-31`).
The framework's shared base for fixed-interval sweeps,
[`PeriodicBackgroundService`](group-14-module-system-composition.md#periodicbackgroundservice), is a
scheduling type documented in [Group 14](group-14-module-system-composition.md), and
[ADR-052](https://ivanball.github.io/docs/adr/052-background-job-execution.html) covers in-process
background work generally.

Seeding and design time close the loop. [`IDbSeeder`](#idbseeder)
(`.../Seeding/IDbSeeder.cs:7`) and the [`DbSeeder`](#dbseeder) base
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:7`) give
module seeders a `GetId<TIdentifier>` helper that maps integer seed ids to either `int` or a deterministic
`Guid` so seed data reproduces across key strategies (`:20-39`), and
[`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser)
(`.../Seeding/IdentityModuleDbSeederBase.cs:38`) hoists the repeated account-seeding idiom out of the two
app identity modules, leaving only app-specific hooks and a `ShouldSeed` opt-in gate that defaults to true
(`:44`, `:48`, `:57`, `:60-71`), each account described by a [`SeedAccount`](#seedaccount) record
(`.../Seeding/SeedAccount.cs:17`) whose own remarks warn that seed credentials are plaintext by
construction and therefore development-only data (`:6-11`). For migrations,
[`DesignTimeDbContextHelper`](#designtimedbcontexthelper)
(`.../DbContexts/Design/DesignTimeDbContextHelper.cs:41`) builds a
[`SQLServerDbContext`](#sqlserverdbcontext) for `dotnet ef` without the app's DI container: a downstream
migrations project writes a few-line `IDesignTimeDbContextFactory` (`:18-32`, entry points at `:50` and
the SQLite twin at `:71`), and `dotnet ef migrations add X -- --datasource Conference` selects which
physical source to build against (`:165-181`), so each database gets its own migrations project. It
composes minimal stand-ins ([`ExplicitAssemblyProvider`](#explicitassemblyprovider) at `:185`,
[`NullDomainEventDispatcher`](#nulldomaineventdispatcher) at `:190`) and a
[`DesignTimeDbContextOptions`](#designtimedbcontextoptions)
(`.../Design/DesignTimeDbContextOptions.cs:11`) carrying the connection settings, then wires the same
[`DataSourceResolver`](#datasourceresolver) and
[`EntityDataSourceRegistry`](#entitydatasourceregistry) the runtime uses so the design-time model matches
the runtime one (`:105-157`). It registers the tenant interceptor, the scheduler options, the audit-trail
options and the refresh-session options unconditionally, defaulted to disabled, precisely so `dotnet ef`
scaffolds the same migration for consumers with and without those features (`:126-154`), and the
refresh-session registration carries the extra twist that its gate is source-sensitive, so the source name
it registers is the one **this** context resolved to (`:144-154`).

## The storage, image, and push contracts

The group also carries the Application-layer contracts for the storage-adjacent services that are not EF at
all. Each has a null default in the container so a host that has not configured the backend still starts and
degrades cleanly, and the Azure, ImageSharp, and null implementations behind them are composition-side
types documented in [Group 14](group-14-module-system-composition.md).
[`IFileStorageService`](#ifilestorageservice)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IFileStorageService.cs:11`)
stores and deletes blobs behind a [`Result`](group-01-result-error-handling.md#result)-returning API and
exposes an `IsConfigured` flag handlers can gate features on (`:14`).
[`IImageProcessor`](#iimageprocessor)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IImageProcessor.cs:11`)
is the normalization contract for untrusted uploads, and the dependency-free
[`ImageContentSniffer`](#imagecontentsniffer)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/ImageContentSniffer.cs:10`)
is its upload-side companion, deciding the accepted formats (JPEG, PNG, WebP) from magic bytes rather than
the client-declared content type (`:14-36`). Both are
[ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html), and both are
squarely [Rubric §11, Security] (EXIF GPS is PII, and a full re-encode is the defense against polyglot
payloads). On the push side, [`INativePushSender`](#inativepushsender)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/INativePushSender.cs:10`)
and [`IPushDeviceRegistrar`](#ipushdeviceregistrar)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/IPushDeviceRegistrar.cs:11`)
describe OS-level delivery and the device-installation registry that backs it
([ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)). This channel sits beside the
persisted notification record and the SignalR path in [Group 10](group-10-notifications.md).

One more Application interface sits in this group's persistence namespace without being repository-shaped
at all. [`IOutboxAdministration`](#ioutboxadministration)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IOutboxAdministration.cs:16`)
is the operator surface that gives an undelivered event a way back into delivery, projecting each abandoned
row into an [`OutboxDeadLetter`](#outboxdeadletter) record (`:80`) that deliberately omits the payload,
because it can carry personal data and no replay decision depends on reading it (`:69-79`). It is
[Rubric §13, Observability and Operability] material; the rows it administers are written by this group's
domain-event interceptor and delivered by the processor and consumers in
[Group 04](group-04-events-outbox.md).

## Where this group sits

Persistence is the concrete floor the abstract domain stands on. The entity bases and audit contracts from
[Group 02](group-02-domain-building-blocks.md) are what the interceptors stamp and the query filters hide;
the domain events aggregates raise are what
[`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) drains into the outbox that
[Group 04](group-04-events-outbox.md) delivers; the transactional decorator in
[Group 05](group-05-cqrs-pipeline.md) is what opens the transaction whose commit releases the deferred
dispatch; the specifications and query service in [Group 03](group-03-querying-specifications.md) are
evaluated by this group's [`SpecificationEvaluator`](#specificationevaluator) against its repositories and
`IQueryable` surfaces; the refresh-session table this group maps is read and written by the auth stack in
[Group 08](group-08-auth.md); the navigation populators in [Group 11](group-11-navigation-populators.md)
fill the cross-source gaps the degrade convention opens; the scheduler this group's gated tables answer to
lives in [Group 14](group-14-module-system-composition.md), which also composes the storage, push, and
event-consumer implementations behind the contracts this group declares; and the entity-source registry
answers the `.Include()` questions the populators ask. The design axes here are three orthogonal
ones collapsed behind a single [`DataSourceKey`](#datasourcekey) plus a scoped tenant:
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)'s `Name` axis (which database),
[ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)'s `Engine` axis (which storage
technology), and [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)'s tenant axis
(whose rows, and optionally whose database), so application code never has to know which it is running on.
Read this group as the answer to one question the rest of the guide keeps asking: how does a framework that
describes persistence in pure domain terms actually put a row in a database, and do it in a way that
survives a module being pulled out into its own service.

### INativePushSender
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/INativePushSender.cs:10` · Level 0 · interface

- **What it is**: the contract for sending OS-level push notifications to registered device installations,
  the delivery channel that reaches a phone when the app is backgrounded or killed.
- **Depends on**: the `UserIdentifierType` global alias (`INativePushSender.cs:19`, see
  [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)); BCL otherwise. Its registry
  counterpart is [`IPushDeviceRegistrar`](#ipushdeviceregistrar).
- **Concept introduced, native push as the third delivery channel.** `[Rubric §10, Cross-Cutting Concerns]`
  assesses whether a delivery mechanism is a swappable abstraction declared in Application and implemented at
  the edge rather than a hardcoded SDK call inside a handler. The doc comment (`INativePushSender.cs:3-9`)
  places this beside the two other channels under
  [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html): the persisted inbox record and
  the SignalR real-time push handled by
  [`IPushNotificationSender`](group-10-notifications.md#ipushnotificationsender). Where SignalR reaches a
  *connected* browser, native push reaches a device that is not running the app. Infrastructure targets Azure
  Notification Hubs (FCM v1 plus APNs), and the default registration is a no-op, so a host that never
  configures a hub degrades cleanly instead of failing.
- **Walkthrough**: two methods, both returning a plain `Task` rather than a
  [`Result`](group-01-result-error-handling.md#result), because a push is fire-and-forget from the caller's
  point of view.
  - `SendToUsersAsync(IEnumerable<UserIdentifierType> userIds, string title, string body, Dictionary<string, string>? metadata = null, CancellationToken cancellationToken = default)`
    (`INativePushSender.cs:19`): targets specific users, resolved to installations via user tags
    (`INativePushSender.cs:13`); `metadata` carries optional key-value data such as a deep-link route in the
    platform payload (`INativePushSender.cs:16`).
  - `BroadcastAsync(string title, string body, Dictionary<string, string>? metadata = null, CancellationToken cancellationToken = default)`
    (`INativePushSender.cs:27`): sends to every registered installation.
- **Why it's built this way**: targeting *users* rather than raw device tokens keeps the caller out of the tag
  and token bookkeeping, which [`IPushDeviceRegistrar`](#ipushdeviceregistrar) owns; the no-op default makes
  native push an opt-in capability rather than a hard dependency of every host.
- **Where it's used**: injected into
  [`SendPushNotificationHandler`](group-10-notifications.md#sendpushnotificationhandler)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:31`)
  alongside the SignalR sender. [`NullNativePushSender`](group-14-module-system-composition.md#nullnativepushsender) is registered by default with
  `TryAddTransient` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:579`) and
  [`AzureNotificationHubNativePushSender`](group-14-module-system-composition.md#azurenotificationhubnativepushsender) replaces it when a hub is
  configured (`DependencyInjection.cs:678`).

### IPushDeviceRegistrar
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/IPushDeviceRegistrar.cs:11` · Level 3 · interface

- **What it is**: maintains the device-installation registry behind [`INativePushSender`](#inativepushsender),
  tagging each installation with its owning user so sends can target users rather than raw device tokens.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via `MMCA.Common.Shared.Abstractions`,
  `IPushDeviceRegistrar.cs:1`), [`DeviceInstallationRequest`](group-10-notifications.md#deviceinstallationrequest)
  (from `MMCA.Common.Shared.Notifications.PushNotifications`, `IPushDeviceRegistrar.cs:2`), and the
  `UserIdentifierType` alias (`IPushDeviceRegistrar.cs:18`).
- **Concept introduced, ownership scoping on a client-supplied identifier, and the existence-oracle problem.**
  `[Rubric §11, Security]` assesses whether a resource identifier supplied by a caller is authorized against
  that caller before it is acted on, and whether error responses leak the existence of other users' resources.
  Installation ids are client-generated, so nothing stops a caller from sending someone else's; the delete
  verifies the `user:{id}` tag stamped by `UpsertAsync` before deleting, and reports a mismatch as **success
  rather than not-found**, because answering differently for "no such installation" and "not yours" would turn
  the endpoint into an existence oracle for other users' installation ids, and the caller has nothing to do with
  either answer (`IPushDeviceRegistrar.cs:28-36`). The stronger property is structural: **every delete is scoped
  to an owner, there is no unscoped form**, so an implementation cannot skip the check by accident
  (`IPushDeviceRegistrar.cs:31-32`). `[Rubric §10, Cross-Cutting Concerns]` also applies: the type doc
  (`IPushDeviceRegistrar.cs:6-10`,
  [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html)) explains the split, where this
  type owns the installation registry, tagged by user, so [`INativePushSender`](#inativepushsender) can send to
  users, and the default implementation is a no-op until a notification hub is configured.
- **Walkthrough**: two methods, both returning [`Result`](group-01-result-error-handling.md#result).
  - `UpsertAsync(UserIdentifierType userId, DeviceInstallationRequest request, CancellationToken cancellationToken = default)`
    (`IPushDeviceRegistrar.cs:18`): creates or refreshes an installation, tagging it with the authenticated
    owner (`IPushDeviceRegistrar.cs:13-14`).
  - `DeleteAsync(UserIdentifierType userId, string installationId, CancellationToken cancellationToken = default)`
    (`IPushDeviceRegistrar.cs:37`): the ownership-scoped delete, and the only delete. Unknown installation ids
    and installations owned by another user both succeed without deleting anything
    (`IPushDeviceRegistrar.cs:20-23`).
- **Why it's built this way**: separating the *registry* (this type) from the *send*
  ([`INativePushSender`](#inativepushsender)) means the send API can target users while token bookkeeping stays
  in one place. Making the owner a required parameter of the only delete member is what removes the class of
  bug where a caller passes a raw client-supplied id straight through: there is no overload to pass it to.
- **Where it's used**: [`DevicesController`](group-10-notifications.md#devicescontroller) injects it
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/DevicesController.cs:27`) and
  passes the authenticated user id on both calls, `UpsertAsync` at `DevicesController.cs:44` and `DeleteAsync`
  at `DevicesController.cs:68`. [`NullPushDeviceRegistrar`](group-14-module-system-composition.md#nullpushdeviceregistrar) is the default
  registration (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:580`);
  [`AzureNotificationHubDeviceRegistrar`](group-14-module-system-composition.md#azurenotificationhubdeviceregistrar) replaces it when a hub is
  configured (`DependencyInjection.cs:679`).

### DataSource
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:6` · Level 0 · enum

- **What it is**: a three-value enum (`CosmosDB`, `Sqlite`, `SQLServer`) naming which database *engine*
  persists a given entity type. It shares a file with [`IDataSourceService`](#idatasourceservice): the
  enum at `IDataSourceService.cs:6`, the interface at `IDataSourceService.cs:24`.
- **Depends on**: nothing first-party. The file has no `using` directives at all (`IDataSourceService.cs:1`
  is the namespace declaration), which is the point: this is the Application layer's vocabulary for a
  persistence decision, with no persistence library behind it.
- **Concept introduced, database-per-service routing at the entity level.** `[Rubric §8, Data Architecture]`
  assesses whether storage is deliberately partitioned, whether the routing strategy is explicit, and
  whether cross-database JOINs happen by accident; this enum is where that decision becomes a first-class
  value the query pipeline can branch on. `[Rubric §7, Microservices Readiness]` assesses whether a module
  could be lifted out without a rewrite; because each module owns its own store
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), the engine is a per-entity
  fact rather than a global one. The values encode a *capability*, not just a name: the `CosmosDB` doc
  comment says "document store, no cross-container JOINs" (`IDataSourceService.cs:8`), while `Sqlite`
  supports "JOINs within a single database file" (`IDataSourceService.cs:11`) and `SQLServer` has "full
  relational JOIN support" (`IDataSourceService.cs:14`). That distinction is what lets the framework decide
  whether a navigation can be an EF `.Include()` or must become a manual batch load.
- **Walkthrough**: three members, each documented with its JOIN capability. `CosmosDB`
  (`IDataSourceService.cs:9`), `Sqlite` (`IDataSourceService.cs:12`), `SQLServer` (`IDataSourceService.cs:15`).
  There is no `None`/`Unknown` member and no explicit numeric assignment, so `CosmosDB` is the default
  `0` value.
- **Why it's built this way**: encoding the JOIN-capability difference in the enum lets
  [`IDataSourceService.HaveIncludeSupport`](#idatasourceservice) (`IDataSourceService.cs:54`) answer the
  include-versus-batch-load question from a value comparison rather than a scattered chain of provider
  checks, and it keeps that decision in the framework-pure Application layer with no EF Core reference.
- **Where it's used**: paired with a database name in [`DataSourceKey`](#datasourcekey) (`DataSourceKey.cs:15`);
  resolved and compared by [`IDataSourceService`](#idatasourceservice); mapped per entity by
  [`EntityDataSourceRegistry`](#entitydatasourceregistry); consumed by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) to classify
  each navigation as an EF include or a manual populate.

### IEntityConfigurationAssemblyProvider
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IEntityConfigurationAssemblyProvider.cs:10` · Level 0 · interface

- **What it is**: a single-method contract returning the assemblies that hold EF Core entity type
  configurations, so a DbContext can discover and apply them without hardcoding module assembly-name
  patterns.
- **Depends on**: `System.Reflection` (BCL) only (`IEntityConfigurationAssemblyProvider.cs:1`).
- **Concept introduced, a module-agnostic model surface that keeps EF out of Application.**
  `[Rubric §3, Clean Architecture]` assesses whether the inner layers declare intent while the outer layers
  own the technology; here Application declares *which assemblies carry configurations* and Infrastructure
  performs the EF scan. `[Rubric §7, Microservices Readiness]` assesses extraction cost: each module ships
  its own `IEntityTypeConfiguration<T>` classes in its own Infrastructure assembly, so removing a module
  from the returned list removes it from the model, no context rewrite required. The doc comment states
  exactly this framing (`IEntityConfigurationAssemblyProvider.cs:5-9`).
- **Walkthrough**: one method, `IReadOnlyList<Assembly> GetConfigurationAssemblies()`
  (`IEntityConfigurationAssemblyProvider.cs:15`). It takes no arguments and no cancellation token: the
  assembly set is a composition-time fact, resolved once, not a per-request query.
- **Why it's built this way**: routing configuration discovery through an injected provider means the active
  module set determines the model without any context knowing a module by name, which is the extraction
  invariant behind [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) and
  [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html).
- **Where it's used**: injected into [`ApplicationDbContext`](#applicationdbcontext)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:44`)
  and each engine subclass ([`SQLServerDbContext`](#sqlserverdbcontext) at `SQLServerDbContext.cs:18`,
  [`CosmosDbContext`](#cosmosdbcontext) at `CosmosDbContext.cs:17`, [`SqliteDbContext`](#sqlitedbcontext) at
  `SqliteDbContext.cs:15`); consumed by [`EntityDataSourceRegistry`](#entitydatasourceregistry) to build the
  entity-to-source map (`EntityDataSourceRegistry.cs:22`) and by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) (`PhysicalDbContextFactory.cs:19`). The default
  implementation [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider)
  is registered with `TryAddSingleton`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:65`), and
  [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) substitutes its own nested
  `ExplicitAssemblyProvider` for `dotnet ef` runs (`DesignTimeDbContextHelper.cs:156` and `:185`).

### IQueryableExecutor
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IQueryableExecutor.cs:7` · Level 0 · interface

- **What it is**: an abstraction over the EF Core `IQueryable` operations the Application layer needs
  (`Include`, `AsSplitQuery`, `ToListAsync`, `CountAsync`) that would otherwise require a direct
  `Microsoft.EntityFrameworkCore` reference there.
- **Depends on**: `System.Linq` (BCL) only; the file declares no `using` directives.
- **Concept introduced, inverting EF's terminal operators out of Application.**
  `[Rubric §3, Clean Architecture]` assesses whether the inner layers stay free of framework dependencies;
  EF's async materializers (`ToListAsync`, `CountAsync`) and `Include` are extension methods living in the EF
  assembly, so calling them directly would drag EF into Application. This interface inverts that:
  Infrastructure implements each by calling EF, and Application receives the interface by DI. The doc comment
  (`IQueryableExecutor.cs:3-6`) states exactly that intent.
- **Walkthrough**: four methods; the two queryable transforms are constrained `where T : class`
  (`IQueryableExecutor.cs:15` and `:27`) because EF requires a reference type there, while the two
  materializers accept any `T` so a projection to a scalar or DTO still works.
  - `Include<T>(IQueryable<T> query, string navigationPropertyPath)` (`IQueryableExecutor.cs:14`): a
    **string-based** include path, for example `"Category"` or `"Order.OrderLines"`
    (`IQueryableExecutor.cs:12`), deliberately not a lambda, because the generic query pipeline builds include
    paths at runtime from navigation-property name strings.
  - `AsSplitQuery<T>(IQueryable<T> query)` (`IQueryableExecutor.cs:26`): switches EF to split-query mode. The
    doc comment (`IQueryableExecutor.cs:17-22`) explains why it matters: paginating (Skip/Take) a query that
    has collection includes in single-query mode truncates or mis-correlates child rows, so list reads come
    back with empty collections. It is documented as a no-op for non-EF (in-memory) queryables.
  - `ToListAsync<T>(IQueryable<T> query, CancellationToken cancellationToken = default)`
    (`IQueryableExecutor.cs:34`) and
    `CountAsync<T>(IQueryable<T> query, CancellationToken cancellationToken = default)`
    (`IQueryableExecutor.cs:41`): the async materializers.
- **Why it's built this way**: the string include path (rather than `Expression<Func<T, TProperty>>`) is
  required because the query pipeline composes includes from runtime navigation metadata, not compile-time
  lambdas; and naming `AsSplitQuery` as an explicit operation keeps a well-known EF pagination defect from
  silently reaching list endpoints.
- **Where it's used**: implemented by [`EFQueryableExecutor`](#efqueryableexecutor)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/EFQueryableExecutor.cs:11`), registered with
  `TryAddSingleton` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:112`). Injected
  into [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`) and into the
  framework's own notification handlers, for example
  [`GetMyNotificationsHandler`](group-10-notifications.md#getmynotificationshandler)
  (`GetMyNotificationsHandler.cs:18`).

### IUniqueConstraintViolationDetector
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUniqueConstraintViolationDetector.cs:31` · Level 0 · interface

- **What it is**: a one-method classifier that answers whether a failed save was rejected for violating a
  unique constraint, so a handler whose pre-check lost a race against a concurrent insert can recognise the
  collision and return the same conflict the pre-check would have produced.
- **Depends on**: nothing first-party. The file has no `using` directives at all, and the single method takes a
  BCL `Exception` (`IUniqueConstraintViolationDetector.cs:42`).
- **Concept introduced, classifying a provider error without naming the provider.**
  `[Rubric §3, Clean Architecture]` assesses whether technology details stay outside the inner layers, and the
  interface remarks make the constraint concrete (`IUniqueConstraintViolationDetector.cs:10-20`): the error
  identity lives in a provider type, SQL Server reports the collision as `SqlException.Number` 2601 (unique
  index) or 2627 (primary key or unique constraint), and neither that type nor the EF Core
  `DbUpdateException` wrapping it is reachable from `MMCA.Common.Application`, which references
  `MMCA.Common.Domain` and no data provider. `[Rubric §15, Best Practices & Code Quality]` assesses whether a
  behavior rests on something stable: reading the exception *message* from a handler is what the layering
  constraint used to force, and the remarks reject it twice over, because the wording is a provider and locale
  detail that can change under a working handler, and matching on it drags provider vocabulary into a
  persistence-neutral layer. `[Rubric §29, Resilience & Business Continuity]` applies to the failure mode
  chosen here: an unclassified exception simply propagates, so a miss is safe rather than silent and the
  caller sees exactly the failure it would have seen with no detection at all
  (`IUniqueConstraintViolationDetector.cs:26-29`).
- **Walkthrough**: one method, `bool IsUniqueConstraintViolation(Exception exception)`
  (`IUniqueConstraintViolationDetector.cs:42`). The contract is stated on the parameter rather than left to the
  implementation: the answer covers `exception` *or anything in its inner-exception chain*
  (`IUniqueConstraintViolationDetector.cs:33-41`), which is what makes it usable against EF's wrapping
  exception. It is synchronous and takes no cancellation token, because it inspects an object already in hand.
- **Why it's built this way**: the question is declared in Application and answered in Infrastructure, where the
  provider types are already referenced, so swapping engines swaps the implementation and every handler that
  recovers from a lost insert race keeps working unchanged
  (`IUniqueConstraintViolationDetector.cs:21-25`).
- **Where it's used**: implemented by
  [`SqlServerUniqueConstraintViolationDetector`](#sqlserveruniqueconstraintviolationdetector)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SqlServerUniqueConstraintViolationDetector.cs:31`),
  which walks the inner-exception chain (`SqlServerUniqueConstraintViolationDetector.cs:48-68`) matching the two
  error numbers (`:34` and `:37`) with a message fallback for engines that report the same rejection in words
  (`:40`, `:43`, matched at `:63-64`). It is registered with `TryAddSingleton`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:117`), deliberately `TryAdd` so a
  host on another engine can register its own implementation first and keep it
  (`DependencyInjection.cs:114-116`). Consumers inject it into the `when` clause of a catch:
  [`GetOrCreateMyBadgeHandler`](group-22-engagement-module.md#getorcreatemybadgehandler)
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/CheckIns/UseCases/GetOrCreateMyBadge/GetOrCreateMyBadgeHandler.cs:21`
  and `:53`),
  [`CreateSessionHandler`](group-18-conference-application.md#createsessionhandler)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:27`
  and `:60`, where the catch drives a bounded manual-id retry),
  [`CreateBookmarkHandler`](group-22-engagement-module.md#createbookmarkhandler) (`CreateBookmarkHandler.cs:21`),
  [`SetLeaderboardParticipationHandler`](group-22-engagement-module.md#setleaderboardparticipationhandler)
  (`SetLeaderboardParticipationHandler.cs:34`), and
  [`PointsAwarder`](group-22-engagement-module.md#pointsawarder) (`PointsAwarder.cs:32`). The framework-level
  registration replaced per-module copies: the ADC Conference module records that it no longer carries its own
  pair (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:25`).

### IUpdatePropertySetter<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUpdatePropertySetter.cs:13` · Level 0 · interface

- **What it is**: a persistence-agnostic builder for the SET clause of a bulk update. A handler describes
  *which* properties change and *to what*, and Infrastructure translates the description into the provider's
  set-based `UPDATE`.
- **Depends on**: `System.Linq.Expressions` (BCL, `IUpdatePropertySetter.cs:1`) only. It is the parameter type of
  [`IWriteRepository.ExecuteUpdateAsync`](#iwriterepositorytentity-tidentifiertype) (`IRepository.cs:450`),
  which the doc comment cross-references (`IUpdatePropertySetter.cs:7`).
- **Concept introduced, describing a SET clause without leaking EF Core.** `[Rubric §3, Clean Architecture]`
  assesses whether the technology choice stays outside the inner layers;
  `[Rubric §12, Performance & Scalability]` assesses whether hot write paths avoid needless round trips, and a
  single set-based statement replaces the load, mutate, save cycle. The doc comment
  (`IUpdatePropertySetter.cs:5-11`) is explicit that the shape *mirrors* EF Core's `SetPropertyCalls` without
  referencing it, which is what keeps `MMCA.Common.Application` EF-free while still offering EF's most useful
  bulk primitive.
- **Walkthrough**: two `Set` overloads, both generic in `TProperty` and both returning
  `IUpdatePropertySetter<TEntity>` so calls chain.
  - `Set<TProperty>(Expression<Func<TEntity, TProperty>> property, TProperty value)`
    (`IUpdatePropertySetter.cs:20-22`): assigns a fixed value, for example a status or a timestamp.
  - `Set<TProperty>(Expression<Func<TEntity, TProperty>> property, Expression<Func<TEntity, TProperty>> valueFactory)`
    (`IUpdatePropertySetter.cs:33-35`): assigns from an expression over the **current database row**. The doc
    comment (`IUpdatePropertySetter.cs:24-28`) gives the motivating case, `quantity => quantity.Amount - 5`,
    which becomes an atomic read-modify-write that the database itself arbitrates, so two racing callers cannot
    both win and no rowversion retry loop is needed.
- **Why it's built this way**: passing an `Action<IUpdatePropertySetter<TEntity>>` (rather than a dictionary of
  property names or a prebuilt EF expression) keeps the call site strongly typed and refactor-safe while the
  concrete translation stays swappable per provider.
- **Where it's used**: implemented by
  [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/UpdatePropertySetterBuilder.cs:14`),
  which collects each assignment as a delegate (`UpdatePropertySetterBuilder.cs:16`) and replays them onto EF
  Core's `UpdateSettersBuilder<TSource>` (`UpdatePropertySetterBuilder.cs:52`). It also records assigned
  property names (`UpdatePropertySetterBuilder.cs:17` and `:64`) and exposes `SetsProperty`
  (`UpdatePropertySetterBuilder.cs:49`) so [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype)
  can stamp `LastModifiedOn` and `LastModifiedBy` only when the caller did not
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:121-132`),
  keeping audit fields correct on a path that bypasses the save pipeline (`EFRepository.cs:19`).

### OutboxDeadLetter
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IOutboxAdministration.cs:80` · Level 0 · record (sealed, positional)

- **What it is**: one dead-lettered outbox row flattened for an operator view: the handle to replay it, which
  source it came from, what it was, when it happened, how hard delivery was tried, and why the last attempt
  failed.
- **Depends on**: nothing first-party (BCL `Guid` and `DateTime`). It is the element type returned by
  [`IOutboxAdministration.ListDeadLettersAsync`](#ioutboxadministration) (`IOutboxAdministration.cs:30`) and it
  shares that interface's file.
- **Concept introduced, projecting an operational row without projecting its payload.**
  `[Rubric §30, Compliance, Privacy & Data Governance]` assesses whether personal data is exposed only where
  it is needed; the type doc says outright that the event PAYLOAD is deliberately not projected, because it can
  carry personal data ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)) and
  nothing an operator decides about a replay depends on reading it (`IOutboxAdministration.cs:68-72`).
  `[Rubric §13, Observability & Operability]` assesses whether an operator can see enough to act: `RetryCount`
  and `LastError` are what turn "this failed" into a decision, and `OrderingKey` says whether the row belongs
  to an ordered stream. See [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) for the persisted row
  this flattens.
- **Walkthrough**: seven positional members, each documented on the record
  (`IOutboxAdministration.cs:73-79`): `Id` (`:81`), the outbox row id and the handle
  `ReplayDeadLettersAsync` takes; `DataSource` (`:82`), the source whose outbox table holds the row, and the
  same string the `dataSource` filters accept; `EventType` (`:83`), the stored event type name; `OccurredOn`
  (`:84`); `RetryCount` (`:85`), attempts made before the row was abandoned; the nullable `LastError` (`:86`)
  and nullable `OrderingKey` (`:87`).
- **Why it's built this way**: a positional record gives an immutable, structurally comparable read model for
  free, and keeping it in the Application layer beside its interface means an admin surface can render dead
  letters without referencing the EF entity or the Infrastructure assembly.
- **Where it's used**: built by the Infrastructure implementation's projection
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxAdministration.cs:92`), from
  rows matching the dead-letter predicate `ProcessedOn == null && RetryCount >= maxRetries`
  (`OutboxAdministration.cs:88`), collected across sources and returned oldest first
  (`OutboxAdministration.cs:107`).

### DataSourceKey
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/DataSourceKey.cs:15` · Level 1 · record struct (readonly)

- **What it is**: the identity of a *physical* data source, a ([`DataSource`](#datasource) `Engine`, `string Name`)
  pair, where `Name` distinguishes multiple databases on the same engine ("database per microservice").
- **Depends on**: [`DataSource`](#datasource) (Level 0, same namespace). No `using` directives at all.
- **Concept, physical-key comparison as the include-support test.** `[Rubric §8, Data Architecture]` assesses
  explicit storage partitioning and routing. A `readonly record struct` gives correct structural equality with
  zero boilerplate, which is the whole point: Application code that needs to know whether two entities can be
  joined compares their `DataSourceKey` values. The doc comment (`DataSourceKey.cs:6-11`) stresses that `Name`
  is the *physical* source name produced by the Infrastructure resolver **after collapsing** logical names that
  share a connection string, so two logical names pointing at the same connection string end up with the same
  physical key (and are joinable), while genuinely distinct databases do not.
- **Walkthrough**
  - The positional record `DataSourceKey(DataSource Engine, string Name)` (`DataSourceKey.cs:15`), parameters
    documented at `DataSourceKey.cs:13-14`.
  - `DefaultName` (`DataSourceKey.cs:18`): the `const string` `"Default"` reserved for the top-level
    `ConnectionStrings` section.
  - `Default(DataSource engine)` (`DataSourceKey.cs:23`): a static factory building the default key for an
    engine.
  - `ToString()` (`DataSourceKey.cs:26`): an override rendering `"{Engine}/{Name}"` for diagnostics.
- **Why it's built this way**: making the key a value type with structural equality reduces the routing decision
  (same physical database, relational engine) to an equality comparison, and a host with no `DataSources`
  configuration collapses everything onto `Default` and behaves like a single-database monolith
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: [`EntityDataSourceRegistry`](#entitydatasourceregistry) maps each entity type to a key and
  [`DataSourceResolver`](#datasourceresolver) performs the logical-to-physical collapse;
  [`IDataSourceService`](#idatasourceservice) resolves and compares them; [`DbContextFactory`](#dbcontextfactory)
  caches one context instance per key.

### IDataSourceService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:24` · Level 2 · interface

- **What it is**: resolves which physical data source ([`DataSourceKey`](#datasourcekey): engine plus database)
  backs a given entity type, and determines whether two entity types support EF Core `.Include()` between them,
  all without the Application layer touching EF or Infrastructure.
- **Depends on**: [`DataSource`](#datasource) (Level 0) and [`DataSourceKey`](#datasourcekey) (Level 1), both in
  the same namespace.
- **Concept introduced, multi-database routing exposed to the Application layer.**
  `[Rubric §8, Data Architecture]` assesses deliberate database-per-service design, explicit routing, and the
  absence of accidental cross-database JOINs. The layer must decide whether a navigation between two entities
  can use an EF `.Include()`, which is valid only when both entities live in the same physical database *and*
  that engine is relational. This interface answers that question without an EF reference, keeping Application
  pure ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The doc comment names the
  consumer directly (`IDataSourceService.cs:18-23`):
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) uses it to
  classify navigation properties as supported or unsupported includes.
- **Walkthrough**: six members across three concerns, every one of them synchronous, because the resolution is a
  lookup against an eagerly built registry, not I/O.
  - `GetDataSourceKey(Type entityType)` (`IDataSourceService.cs:29`) and
    `GetDataSourceKey(string entityFullName)` (`IDataSourceService.cs:34`): resolve the physical key by CLR type
    or by full type name (the name overload exists because navigation metadata carries names, not resolved
    types).
  - `GetDataSource(string entityFullName)` (`IDataSourceService.cs:39`) and `GetDataSource(Type entityType)`
    (`IDataSourceService.cs:44`): resolve just the engine.
  - `HaveIncludeSupport(DataSourceKey first, DataSourceKey second)` (`IDataSourceService.cs:54`): the crux. The
    contract documented at `IDataSourceService.cs:46-53` is that it returns `true` only when both keys identify
    the same physical database and the engine is relational, since Cosmos DB has no cross-document JOINs.
  - `HaveIncludeSupport(string firstEntityFullName, string secondEntityFullName)` (`IDataSourceService.cs:63`):
    the same test by entity name, resolving each side's key first.
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)
  replaces cross-service foreign keys with scalar columns and routes consistency through the outbox, so to build
  a query the Application layer must know the routing topology well enough to classify each navigation as
  include-able or manual-load-required. Exposing that as a narrow query interface (rather than handing
  Application the registry) keeps the collapse rules on the Infrastructure side.
- **Where it's used**: consumed by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) to drive the
  supported/unsupported include split, and indirectly by the query pipeline's eager-loading decisions. The
  Infrastructure implementation is a facade over [`EntityDataSourceRegistry`](#entitydatasourceregistry).

### IOutboxAdministration
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IOutboxAdministration.cs:16` · Level 3 · interface

- **What it is**: the operator surface over the outbox tables a host owns: list the dead letters, replay them,
  and count the pending backlog.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form (via
  `MMCA.Common.Shared.Abstractions`, `IOutboxAdministration.cs:1`) and
  [`OutboxDeadLetter`](#outboxdeadletter), the record declared in the same file (`IOutboxAdministration.cs:80`).
- **Concept introduced, a way BACK into delivery for an undelivered event.**
  `[Rubric §13, Observability & Operability]` assesses whether the system can be operated after something goes
  wrong, not just observed while it works. The interface doc puts the alternative plainly
  (`IOutboxAdministration.cs:5-9`): without this surface the only terminal states for a failed message are
  "eventually deleted by the retention sweep" and "edited by hand in production SQL".
  `[Rubric §29, Resilience & Business Continuity]` assesses recovery from partial failure, which is exactly what
  a replay is: the outbox ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html))
  guarantees an event is *recorded* in the same transaction as its state change, and this interface is how a
  recorded-but-undelivered event gets another chance. `[Rubric §9, API & Contract Design]` shows up in the
  return type: every method returns [`Result`](group-01-result-error-handling.md#result), because an unreachable
  source or an unknown source name is an expected failure an operator screen renders, not an exception
  (`IOutboxAdministration.cs:10-14`).
- **Walkthrough**: three methods, each taking a nullable `dataSource` filter where `null` means "every source
  this host owns", and each with an explicit (non-defaulted) cancellation token.
  - `ListDeadLettersAsync(string? dataSource, int skip, int take, CancellationToken cancellationToken)`
    (`IOutboxAdministration.cs:30-34`): the read. Dead-lettered means unprocessed with retries exhausted, and
    rows come back oldest first (`IOutboxAdministration.cs:18-21`) as
    [`OutboxDeadLetter`](#outboxdeadletter) records, paged by `skip`/`take`.
  - `ReplayDeadLettersAsync(string? dataSource, IReadOnlyCollection<Guid>? ids, CancellationToken cancellationToken)`
    (`IOutboxAdministration.cs:51-54`): returns rows to the pending pool and answers with the number of rows
    moved. The doc comment (`IOutboxAdministration.cs:36-41`) pins the semantics: `RetryCount` back to zero and
    the claim lease cleared, so the next poll cycle picks the rows up, while `LastError` is deliberately KEPT
    (the reason a message failed is the first thing anyone asks after a replay) and `OccurredOn` is untouched,
    so a replayed row keeps its place in its ordering key. A `null` or empty `ids` replays EVERY dead letter in
    the selected scope (`IOutboxAdministration.cs:45-48`), which is a wide operation stated as such.
  - `CountPendingAsync(string? dataSource, CancellationToken cancellationToken)`
    (`IOutboxAdministration.cs:65`): counts rows still awaiting dispatch. The doc comment draws the distinction
    that matters for operators (`IOutboxAdministration.cs:56-61`): unlike the `outbox.pending.depth` gauge,
    which reports what the processor last observed
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxMetrics.cs:76`), this counts
    the tables at the moment of the call and includes rows currently under a claim lease.
- **Why it's built this way**: declaring the operator surface in Application means an admin endpoint, a support
  command, or a scheduled job can drive it without referencing EF or the outbox entity, and the `Result` return
  keeps a bad source name on the same rails as any other user error. The retention sweep that would otherwise
  be a dead letter's only exit is [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice),
  whose own comment points at `IOutboxAdministration.ReplayDeadLettersAsync` as the alternative
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxCleanupService.cs:152`).
- **Where it's used**: implemented by [`OutboxAdministration`](group-04-events-outbox.md#outboxadministration)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxAdministration.cs:36-43`),
  registered with `TryAddScoped` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:202-203`),
  scoped because it creates one child scope per data source it visits and holds no state of its own
  (`DependencyInjection.cs:214-215`). The implementation caps one page at 500 rows so an admin call cannot ask
  for the whole table at once (`OutboxAdministration.cs:46`), rejects a negative `skip` or an out-of-range
  `take` as validation errors (`OutboxAdministration.cs:48-52`), and expresses replay as one set-based
  `UPDATE` per target (`OutboxAdministration.cs:149-150`) rather than as loaded entities.
- **Caveats / not-in-source**: the framework registers the service but ships no controller over it. No
  `MMCA.Common.API` endpoint and no ADC or Store call site references `ListDeadLettersAsync`,
  `ReplayDeadLettersAsync`, or `CountPendingAsync` today; outside the registration the only callers in the
  workspace are the Infrastructure tests
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/OutboxAdministrationTests.cs`). A host
  that wants an operator screen wires its own endpoint or command over the injected interface.

### IEntityQuerier<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:80` · Level 4 · interface

- **What it is**: the set-returning half of the repository split: collection reads, projections, single-row and
  grouped aggregate reads, lookup pairs, counts, the specification-first block, and keyset paging. Fifteen
  members in all.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IRepository.cs:81`),
  [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) (the lookup
  projection, from `MMCA.Common.Shared.DTOs`, `IRepository.cs:5` and `:222`),
  [`ISpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ispecificationtentity-tidentifiertype)
  (from `MMCA.Common.Domain.Interfaces`, `IRepository.cs:3`, first used at `:149`),
  [`Result`](group-01-result-error-handling.md#result) with
  [`KeysetPageRequest`](group-01-result-error-handling.md#keysetpagerequest) and
  [`KeysetCollectionResult<T>`](group-01-result-error-handling.md#keysetcollectionresultt) (from
  `MMCA.Common.Shared.Abstractions`, `IRepository.cs:4`, used at `:316-317`), and `System.Linq.Expressions`
  (`IRepository.cs:1`).
- **Concept introduced, the ISP-split repository ladder.** `[Rubric §1, SOLID]` assesses whether clients depend
  only on the members they use. `IRepository.cs` defines a deliberate ladder of ever-wider interfaces so a
  handler declares exactly the surface it needs: [`IEntityReader`](#ientityreadertentity-tidentifiertype) (by-id
  lookups, `IRepository.cs:21`), `IEntityQuerier` (set-returning reads, this type, `:80`),
  [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) (reader plus querier plus raw `IQueryable`,
  `:330`), [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype) (mutations, `:367`), and
  [`IRepository`](#irepositorytentity-tidentifiertype) (read plus write, `:467`). The doc comment says it
  outright (`IRepository.cs:68-71`): prefer this over `IReadRepository` when a handler needs `GetAllAsync`,
  `GetProjectedAsync`, or `CountAsync`. `[Rubric §12, Performance & Scalability]` also applies: every member
  here exists so the *database* answers the question. `GetProjectedAsync<TResult>` takes an
  `Expression<Func<TEntity, TResult>>` translated to SQL, `FirstOrDefaultAsync` returns one row instead of a
  materialized set filtered in memory, and `CountByAsync`/`SumByAsync` push a `GROUP BY` down instead of folding
  rows client-side. The querier is the rung that keeps growing: fifteen members against the reader's five, so
  "focused" here means *reads that return sets or aggregates*, not *a small interface*
  ([ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html) and its
  Revision (2026-08-31), which records the five most recent additions).
- **Concept introduced, `ignoreQueryFilters` means soft-deleted rows and nothing else.**
  `[Rubric §11, Security]` assesses whether a convenience flag can widen a security boundary. An interface-level
  `<remarks>` block (`IRepository.cs:75-79`) pins the contract: every `ignoreQueryFilters` parameter here drops
  the named `SoftDelete` filter and **leaves the named `Tenant` filter applied**, and the wording is repeated on
  each parameter that carries it (for example `IRepository.cs:99-103` and `:126-130`). That is enforced
  downstream, where [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype)
  passes a one-element filter-name array to EF's named `IgnoreQueryFilters` overload
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:33`, used at
  `:52`, `:81`, `:102`, `:198`, `:288`, `:365`, `:379`, and `:445-446`) rather than EF's parameterless form; its
  own comment (`EFReadRepository.cs:30`) spells out that dropping both would let a caller asking to see deleted
  rows silently read every tenant's data. The two named filters come from
  [`ApplicationDbContext`](#applicationdbcontext) (`ApplicationDbContext.cs:388` and `:391`).
- **Walkthrough**
  - `GetAllAsync(IEnumerable<string> includes, where?, orderBy?, select?, asTracking, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:85-92`): the general collection read with optional includes, filter, ordering, and same-type
    projection. Note `includes` is the one non-optional parameter, so a caller must state its eager-loading
    intent explicitly (pass `[]` for none).
  - `GetProjectedAsync<TResult>(select, where?, asTracking, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:105-110`): SQL-side projection to an arbitrary result type.
  - `FirstOrDefaultAsync(where, includes?, asTracking, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:133-138`): the single-row predicate read. The remarks (`IRepository.cs:115-122`) name the
    alternative it exists to remove, `GetAllAsync` followed by an in-memory `FirstOrDefault`, which materializes
    the whole matching set to keep one entity, and warn that no ordering is applied, so "first" is whatever the
    provider returns first.
  - `FirstOrDefaultAsync(ISpecification<TEntity, TIdentifierType> specification, CancellationToken)`
    (`IRepository.cs:148-150`): the deterministic counterpart. Unlike the predicate overload it honors the
    specification's ORDERING, so "first" means what the specification says it means
    (`IRepository.cs:140-144`).
  - `CountByAsync<TKey>(keySelector, where?, CancellationToken)` (`IRepository.cs:167-171`): a `GROUP BY` count,
    returning one dictionary entry per key that has at least one row. The remarks (`IRepository.cs:156-161`)
    explain why the member has to exist at all: the Application layer references no EF Core, so a handler
    needing a grouped count has no `IQueryable` to group and would otherwise project every matching row out of
    the database and group client-side. `TKey` is constrained `notnull` (`IRepository.cs:171`).
  - `SumByAsync<TKey>(keySelector, sumSelector, where?, CancellationToken)` (`IRepository.cs:184-189`): the
    grouped `SUM`, the counterpart of `CountByAsync` (`IRepository.cs:173-177`).
  - `FindIncludingDeletedAsync(where, includes?, asTracking, CancellationToken)` (`IRepository.cs:215-219`):
    the resurrection read (BR-135, `IRepository.cs:198`), returning a named tuple of `Active` and `SoftDeleted`
    matches. The remarks (`IRepository.cs:195-205`) give the whole rationale: a create handler whose natural key
    already exists as a soft-deleted row must reactivate that row rather than insert a duplicate the unique
    index will reject, and it needs both halves of the answer in one round trip, since an active match is a
    conflict, a soft-deleted match is the row to bring back, and neither is a plain insert. The `asTracking`
    parameter carries its own warning (`IRepository.cs:209-212`): a caller intending to reactivate wants `true`,
    otherwise the reactivation saves nothing. See
    [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) for the soft-delete policy
    this read serves.
  - `GetAllForLookupAsync(string nameProperty, where?, asTracking, CancellationToken)`
    (`IRepository.cs:222-226`): returns lightweight
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) id/name pairs for
    dropdowns without materializing full entities. It has no `ignoreQueryFilters` parameter: a lookup list never
    offers deleted rows.
  - `CountAsync(CancellationToken)` (`IRepository.cs:229`) and
    `CountAsync(Expression<Func<TEntity, bool>> where, CancellationToken)` (`IRepository.cs:232-234`): total and
    predicated counts.
  - `CountAsync(ISpecification<TEntity, TIdentifierType> specification, CancellationToken)`
    (`IRepository.cs:243-245`): the specification-shaped count. The doc comment (`IRepository.cs:236-239`) states
    that ordering and paging on the specification are ignored deliberately, since a count of "page 3 of the
    matches" is never what a caller means.
  - `ListAsync(ISpecification<TEntity, TIdentifierType> specification, CancellationToken)`
    (`IRepository.cs:260-262`): runs a specification and returns the matching entities. The remarks
    (`IRepository.cs:250-256`) draw the line between the two specification shapes: a plain `ISpecification`
    contributes its `Criteria` only, while a
    [`QuerySpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#queryspecificationtentity-tidentifiertype)
    also contributes includes, ordering, paging, tracking, and soft-delete scope, so one object describes the
    whole read instead of five loose arguments.
  - `ListAsync<TResult>(specification, Expression<Func<TEntity, TResult>> select, CancellationToken)`
    (`IRepository.cs:279-282`): the projecting overload, so only the selected columns leave the database. The
    remarks (`IRepository.cs:268-273`) pin the ordering rule: the projection is applied **after** the
    specification's ordering and paging, so a paged specification still pages over entity rows and projects only
    that page, and includes on the specification are redundant here but not harmful.
  - `AnyAsync(ISpecification<TEntity, TIdentifierType> specification, CancellationToken)`
    (`IRepository.cs:291-293`): existence by specification, with ordering and paging ignored for the same reason
    as the specification `CountAsync` (`IRepository.cs:285-286`).
  - `GetPageByCursorAsync(KeysetPageRequest request, ISpecification<TEntity, TIdentifierType>? specification = null, CancellationToken)`
    (`IRepository.cs:316-319`): one keyset ("seek") page plus the cursor for the next one, and the only member
    here that returns a [`Result`](group-01-result-error-handling.md#result), because an unknown sort column and
    a malformed cursor are caller errors rather than exceptions and must never come back as a silent first page
    (`IRepository.cs:306-310`). The remarks (`IRepository.cs:299-311`) state the trade in full: one index seek
    regardless of scroll depth and no skipped or repeated rows, against no random page access and no total
    count, with exactly one sort key supported and `Id` as the tie-break.
- **Why it's built this way**: splitting reads into a focused querier lets a handler signal its access pattern
  through its constructor dependency and keeps projection, aggregation, and counting off the by-id interface.
  Declaring the specification-first members here rather than on a separate interface is what keeps a handler that
  already depends on the querier from needing a second dependency to run a specification.
- **Where it's used**: query handlers needing collections, aggregates, specifications, or a keyset page; folded
  into [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype)
  (`IRepository.cs:331`) and implemented concretely by
  [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) (for example
  `GetProjectedAsync` at `EFReadRepository.cs:69`, `CountByAsync` at `:127`, `SumByAsync` at `:150`, the
  projecting `ListAsync` at `:464`), with
  [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype)
  wrapping every call in a MiniProfiler step (`EFReadRepositoryDecorator.cs:17`, and `:45-83` for the newer
  members). The mechanics behind the specification-first block are walked through later in this chapter rather
  than repeated here: [`SpecificationEvaluator`](#specificationevaluator) turns a specification into an
  `IQueryable`, [`KeysetQueryBuilder`](#keysetquerybuilder) builds the ordering, the seek predicate, and the
  cursor encoding, and [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype)
  owns the tracking and filter-scope policy those two are handed.
- **Caveats / not-in-source**: `GetProjectedAsync` carries `ignoreQueryFilters` **before** the cancellation token
  (`IRepository.cs:109-110`), so any caller or test double that passes arguments positionally has to account for
  it; the compiler catches positional callers, but a mock configured with a fixed argument count does not fail
  until run time.

### IEntityReader<TEntity, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:21` · Level 4 · interface

- **What it is**: the by-id half of the repository split: `GetByIdAsync` (two overloads), `GetByIdsAsync`, and
  `ExistsAsync` (two overloads), for handlers whose data access is a point lookup.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `IRepository.cs:22`) and `System.Linq.Expressions` for the predicate overload
  (`IRepository.cs:1`).
- **Concept, minimal data access as a declared dependency.** `[Rubric §1, SOLID]` (Interface Segregation,
  introduced on [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype)) and
  `[Rubric §8, Data Architecture]` (deliberate, minimal access patterns). The doc comment is explicit
  (`IRepository.cs:9-13`): prefer this over `IReadRepository<>` when a handler only needs `GetByIdAsync` or
  `ExistsAsync`, because that signals minimal data access. This interface carries the same `<remarks>` contract
  as the querier (`IRepository.cs:16-20`): `ignoreQueryFilters` means "include soft-deleted rows" and nothing
  more, with the `Tenant` filter left in force. It is also the rung that does not move: every round of
  specification and aggregate growth has landed on the querier, so the reader is still five members.
- **Walkthrough**
  - `GetByIdAsync(TIdentifierType id, CancellationToken)` (`IRepository.cs:26-28`): plain fetch, returns `null`
    when missing.
  - `GetByIdAsync(TIdentifierType id, IEnumerable<string> includes, bool asTracking = false, CancellationToken)`
    (`IRepository.cs:31-35`): the eager-load overload; include paths are navigation-property names.
  - `GetByIdsAsync(ids, includes?, asTracking, ignoreQueryFilters, CancellationToken)`
    (`IRepository.cs:48-53`): a single-query bulk fetch that replaces an N+1 loop of point lookups. The doc
    comment warns it may return **fewer** entities than requested when some ids do not exist
    (`IRepository.cs:47`), so the caller must reconcile, and the `ignoreQueryFilters` parameter is documented in
    full (`IRepository.cs:41-45`) rather than by reference.
  - `ExistsAsync(TIdentifierType id, bool ignoreQueryFilters = false, CancellationToken)`
    (`IRepository.cs:56-59`) and
    `ExistsAsync(Expression<Func<TEntity, bool>> where, bool ignoreQueryFilters = false, CancellationToken)`
    (`IRepository.cs:62-65`): existence checks by key or by predicate. The flag is what lets a handler ask
    whether a *soft-deleted* row exists, for example to detect a conflict when re-creating a record that was
    deleted earlier.
- **Why it's built this way**: a handler that only needs a point lookup takes the narrowest interface, which
  reads clearly at the constructor and mocks in two lines in a test.
- **Where it's used**: command handlers that load an aggregate before mutating it; folded into
  [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype)
  (`IRepository.cs:331`). Note that the `GetByIdOrFailAsync` extension on
  [`ReadRepositoryExtensions`](#readrepositoryextensions), which turns a miss into a
  [`Result`](group-01-result-error-handling.md#result) failure carrying `Error.NotFound`, hangs off
  `IReadRepository` rather than this interface and is implemented over `GetAllAsync`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:12`, `:27`, and
  `:34-38`), so a handler that wants it must take the wider read interface.

### IReadRepository<TEntity, TIdentifierType>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:330` · Level 5 · interface

- **What it is**: the full read surface over an entity, combining [`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype) (by-id lookups) and [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype) (collections, projections, specifications, grouped aggregates, and keyset pages), and adding four `IQueryable<TEntity>` properties for handlers that need raw LINQ (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:330-346`).
- **Depends on**: [`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype) and [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype), both declared in the same file and both listed as base interfaces (`IRepository.cs:331`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) as the `TEntity` constraint (`IRepository.cs:332`). Externals: BCL `IQueryable<T>` only. No EF Core type appears anywhere in the declaration, which is what keeps this interface legal in the Application layer.
- **Concept, the composition point of the ISP ladder, and controlled `IQueryable` exposure.** `[Rubric §1, SOLID]` assesses whether clients depend only on the members they use. `IRepository.cs` defines a ladder of ever-wider interfaces so a handler declares exactly the surface it needs: [`IEntityReader`](#ientityreadertentity-tidentifiertype) (five members, `IRepository.cs:21`), [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype) (fifteen members, `IRepository.cs:80`), this type (both of those plus four properties, twenty-four members in total, `IRepository.cs:330`), [`IWriteRepository`](#iwriterepositorytentity-tidentifiertype) (`IRepository.cs:367`), and [`IRepository`](#irepositorytentity-tidentifiertype) (read plus write, `IRepository.cs:467`). The doc comment records a migration stance rather than a ban (`IRepository.cs:322-327`): existing code should continue using this interface, and new handlers can depend on the focused sub-interfaces for better ISP compliance.

  `[Rubric §12, Performance & Scalability]` assesses whether expensive query behavior is a deliberate choice. The four properties turn EF's tracking mode and query-splitting mode into a named decision at the call site: asking for `TableNoTrackingSplitQuery` is visible in review, where a plain `DbSet` would silently track every row and emit one cartesian join.
- **Walkthrough**: this interface declares no methods of its own. Its whole body is four get-only `IQueryable<TEntity>` properties.
  - `Table` (`IRepository.cs:336`): the base queryable with change tracking enabled, the shape a mutation path composes over. Implemented as the raw `DbSet` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:406`).
  - `TableNoTracking` (`IRepository.cs:339`): the no-tracking queryable, documented as best for read-only queries and implemented as `Entities.AsNoTracking()` (`EFReadRepository.cs:409`).
  - `TableNoTrackingSingleQuery` (`IRepository.cs:342`): no-tracking, pinned to a single SQL statement through `AsSingleQuery()` (`EFReadRepository.cs:412`).
  - `TableNoTrackingSplitQuery` (`IRepository.cs:345`): no-tracking in split-query mode, which avoids the cartesian explosion that collection includes cause, through `AsSplitQuery()` (`EFReadRepository.cs:415`). It is the same concern [`IQueryableExecutor`](#iqueryableexecutor) addresses for callers that hold an `IQueryable` rather than a repository.
  - The twenty inherited members come from the two base interfaces and are walked through on their own sections: five point-lookup members on [`IEntityReader`](#ientityreadertentity-tidentifiertype), fifteen set-returning members on [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype).
- **Why it's built this way**: the framework needed one interface a query handler can take when it genuinely uses the whole read surface, without forcing every handler to take it. Keeping the composition free of new methods means the two halves stay independently declarable and independently mockable, and it gives the profiling decorator one surface to wrap. Naming the four queryables separately, rather than exposing a `DbSet`, is what makes tracking and split-query opt-in rather than accidental. The ladder itself is [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html).
- **Where it's used**: obtained through [`IUnitOfWork.GetReadRepository<TEntity, TIdentifierType>()`](#iunitofwork) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:29`), which is the sanctioned way to get one; implemented by [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) (`EFReadRepository.cs:19-23`) and wrapped in [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) (`EFReadRepositoryDecorator.cs:17`) by [`RepositoryFactory`](#repositoryfactory) only when MiniProfiler is enabled (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:55-63`). [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) derives its `Repository` property from the unit of work at construction (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:88`). It is also the receiver of the `GetByIdOrFailAsync` extension on [`ReadRepositoryExtensions`](#readrepositoryextensions), which turns a miss into a [`Result`](group-01-result-error-handling.md#result) failure carrying `Error.NotFound` and is implemented over `GetAllAsync` rather than `GetByIdAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:12`, `:27`, `:34-44`), so a handler that wants that convenience must take this wider interface rather than [`IEntityReader`](#ientityreadertentity-tidentifiertype).
- **Caveats / not-in-source**: a mutation path must not compose its query off `TableNoTracking` and then expect the save to persist, because one no-tracking source makes the whole composed query untracked. That constraint is not stated in this file; it follows from EF's tracking semantics.

### IWriteRepository<TEntity, TIdentifierType>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:367` · Level 5 · interface

- **What it is**: the write half of the repository abstraction, over an aggregate root: `AddAsync`, `AddRangeAsync`, `UpdateAsync`, `UpdateRange`, two `SetOriginalRowVersion` overloads, `ExecuteDeleteAsync`, and `ExecuteUpdateAsync` (`IRepository.cs:367-454`). Eight members, and not one of them saves.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the `TEntity` constraint (`IRepository.cs:368`), [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) for the child-concurrency overload (written by its qualified `Domain.Interfaces.IRowVersioned` name, `IRepository.cs:417`), and [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) for the set-based update builder (`IRepository.cs:452`). Externals: `System.Linq.Expressions` (`IRepository.cs:1`).
- **Concept introduced, writes enter through the aggregate root, and the repository never flushes.** `[Rubric §4, DDD]` assesses whether the aggregate boundary is an enforced rule rather than a naming convention. The constraint here is the narrower `AuditableAggregateRootEntity<TIdentifierType>`, not the `AuditableBaseEntity<TIdentifierType>` the read side accepts, and the doc comment says exactly why (`IRepository.cs:351-358`): a write enters the aggregate through its root so that the root's invariants are enforced and its domain events are collected, and a repository over a child entity would let a caller persist a change the root never saw. Reading a child directly stays harmless and stays supported through [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype). The rule is enforced by the compiler, not by review: asking for a write repository over a child entity does not compile.

  `[Rubric §8, Data Architecture]` assesses whether persistence is deliberate: one save boundary, one concurrency story. This interface has no `Save` and no `SaveChangesAsync`. The doc comment states the division (`IRepository.cs:359-363`): the repository stages changes and never flushes them, because persisting is the unit of work's job, so every repository touched in a scope is written as one unit under one audit stamp. A handler that mutates through a repository and then forgets [`IUnitOfWork.SaveChangesAsync`](#iunitofwork) has written nothing.
- **Concept introduced, optimistic-concurrency wiring and change-tracking-bypass writes.** Four members carry the weight.
  - `SetOriginalRowVersion(TEntity entity, byte[] rowVersion)` (`IRepository.cs:406`): plants the client's last-observed `RowVersion` as the tracked entity's *original* concurrency token, so the next save emits its `WHERE RowVersion = @original` and raises `DbUpdateConcurrencyException`, mapped to `409 Conflict`, when the row moved since the client read it (`IRepository.cs:399-403`). The implementation sets `OriginalValue` on the tracked entry's `RowVersion` property and rejects a null token outright (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:75-84`).
  - `SetOriginalRowVersion(Domain.Interfaces.IRowVersioned childEntity, byte[] rowVersion)` (`IRepository.cs:417`): the same protection for a tracked **child** of the aggregate, for example a `ProductVariant` under a `Product`. The doc comment explains why a second overload exists at all (`IRepository.cs:408-414`): the repository's `TEntity` is the root, so the typed overload cannot reach children, and this one accepts any [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) entity instead ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). It reaches the entry through an `(object)` cast (`EFRepository.cs:86-95`).
  - `ExecuteDeleteAsync(Expression<Func<TEntity, bool>> where, CancellationToken)` (`IRepository.cs:427-429`): a set-based delete run directly in the database, one statement, no change tracker. The doc comment warns in capitals that it does **not** trigger domain events, audit stamps, or soft delete, and is for maintenance scenarios only (`IRepository.cs:419-426`). The implementation is a one-liner over the `DbSet` (`EFRepository.cs:97-103`).
  - `ExecuteUpdateAsync(where, Action<IUpdatePropertySetter<TEntity>> setProperties, CancellationToken)` (`IRepository.cs:450-453`): a set-based `UPDATE ... SET ... WHERE ...` as one atomic statement. `[Rubric §12, Performance & Scalability]` applies alongside §8 here, and the long doc comment (`IRepository.cs:431-449`) is the teaching text for contention-proof conditional updates: guard the update inside `where` (the worked example is a stock decrement guarded by `AvailableQuantity >= @qty`), and then zero rows affected means the guard did not hold, so two racing callers can never both win and no rowversion retry loop is needed, because the database itself arbitrates. It also draws the exact boundaries: domain events are bypassed, global query filters (soft delete) DO apply to `where`, audit fields are NOT bypassed, and the statement runs on the ambient transaction when one is active, so a decrement rolls back with its caller. The audit guarantee is not something the database does; it is compensation code in the implementation, which stamps `LastModifiedOn` from the injected `TimeProvider` and `LastModifiedBy` from `ICurrentUserService` unless the caller assigned them explicitly, and rejects an empty setter list (`EFRepository.cs:114-132`, with the two optional constructor dependencies at `EFRepository.cs:23-27`).
- **Walkthrough**: the eight members in teaching order.
  - `AddAsync(TEntity entity, CancellationToken)` (`IRepository.cs:375-377`) and `AddRangeAsync(IEnumerable<TEntity> entities, CancellationToken)` (`IRepository.cs:383-385`): single and batch inserts, staged on the change tracker.
  - `UpdateAsync(TEntity entity, CancellationToken)` (`IRepository.cs:391-393`) and `UpdateRange(IEnumerable<TEntity> entities)` (`IRepository.cs:397`): mark tracked entities modified. `UpdateRange` is the one `void` member of the pair, since batch marking needs nothing awaited.
  - The two `SetOriginalRowVersion` overloads (`IRepository.cs:406`, `:417`) and the two database-side operations (`IRepository.cs:427`, `:450`) described above.
- **Why it's built this way**: keeping writes in a focused interface means a query handler cannot accidentally acquire mutation methods, and the concurrency and set-based escape hatches are declared where a reader meets their warnings rather than buried in a concrete class. Constraining `TEntity` to the aggregate root mirrors the constraint on `IUnitOfWork.GetRepository` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:20`), which is how a handler is meant to obtain one, so the two agree by construction. Leaving `Save` off the interface entirely is what makes the single save boundary of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) enforceable: with several physical databases in one host, "save" cannot mean "save this repository".
- **Where it's used**: command handlers that mutate aggregates, always through [`IUnitOfWork.GetRepository<TEntity, TIdentifierType>()`](#iunitofwork) (`IUnitOfWork.cs:19`); folded into [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) (`IRepository.cs:467`); implemented by [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) (`EFRepository.cs:23-29`), which derives from [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) and adds only the write surface, and is wrapped in [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype) when MiniProfiler is on (`RepositoryFactory.cs:31-41`). Both apps exercise the specialized members: in MMCA.Store, `ChangeVariantPriceHandler` calls the **child-typed** `SetOriginalRowVersion` so a race on one product variant conflicts even when the product row itself is untouched (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/UseCases/ChangeVariantPrice/ChangeVariantPriceHandler.cs:45-47`, with the same pattern in `ChangeVariantSkuHandler.cs:69`); in MMCA.ADC, `ScoreEventSessionsHandler` uses `ExecuteDeleteAsync` to clear a session's previous AI scores before re-adding them (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsHandler.cs:28`, `:105-107`).
- **Caveats / not-in-source**: `ExecuteDeleteAsync` and `ExecuteUpdateAsync` bypass the domain-event capture that [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) performs on save, so anything downstream that reacts to an event will not observe those writes. The interface says so in its doc comments; nothing in the type system stops it, so it stays a review rule rather than a compiler rule.

### IRepository<TEntity, TIdentifierType>

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:467` · Level 6 · interface

- **What it is**: the combined read-write repository over an aggregate root, extending both [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) and [`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype), so a command handler that reads an aggregate and then mutates it takes a single dependency (`IRepository.cs:467`).
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) and [`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype), both named as bases on `IRepository.cs:467`, and [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the `TEntity` constraint (`IRepository.cs:468`).
- **Concept, the top of the ISP ladder, and where the aggregate-root constraint wins.** `[Rubric §1, SOLID]` and `[Rubric §4, DDD]`. The interface is purely compositional: it declares no members of its own, only two base interfaces and two constraints (`IRepository.cs:467-469`). What matters is which constraint survives the composition. The read side accepts any [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`IRepository.cs:332`) and the write side only aggregate roots (`IRepository.cs:368`), so the combination inherits the narrower bound, and the doc comment states the consequence for the reader (`IRepository.cs:459-463`): a handler that only reads, and reads a child entity, depends on [`IReadRepository`](#ireadrepositorytentity-tidentifiertype) instead, which still accepts any auditable entity.
- **Walkthrough**: no members. The declaration is a semicolon-terminated interface with two bases and two generic constraints (`IRepository.cs:467-469`), the C# shorthand for an empty body. Everything a caller can do through it is walked through on the two base sections, and beneath them on [`IEntityReader`](#ientityreadertentity-tidentifiertype) and [`IEntityQuerier`](#ientityqueriertentity-tidentifiertype).
- **Why it's built this way**: keeping the combined interface empty means the read and write surfaces each stay independently usable and independently mockable, while a handler that genuinely needs both still takes one constructor parameter. Composition rather than a fresh member list is also what keeps the ladder honest: there is exactly one definition of "read" and one of "write" in the codebase, and the widest rung is a deliberate choice a reviewer can see at the constructor rather than a default.
- **Where it's used**: obtained through [`IUnitOfWork.GetRepository<TEntity, TIdentifierType>()`](#iunitofwork) (`IUnitOfWork.cs:19-21`), which is the sanctioned way to get one; implemented by [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) (`EFRepository.cs:23-29`) and produced, optionally wrapped for profiling, by [`RepositoryFactory`](#repositoryfactory) (`RepositoryFactory.cs:26-42`). [`UnitOfWork`](#unitofwork) caches the instance per closed generic interface type, so `typeof(IRepository<Order, int>)` is the cache key for a whole scope (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:37`, `:43`).
- **Caveats / not-in-source**: `AddInfrastructure` does register the open generic `IRepository<,>` against `EFRepository<,>` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:119`), which makes constructor-injecting `IRepository<,>` look supported. It is not the intended path: `EFRepository<TEntity, TIdentifierType>` takes a bare `DbContext` constructor parameter (`EFRepository.cs:23-24`) and that registration file adds no `DbContext` service, so a direct injection sidesteps both the data-source resolution and the per-scope repository cache that `GetRepository` performs (`UnitOfWork.cs:37-45`). Ask the unit of work.

### IUnitOfWork

> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:10` · Level 7 · interface

- **What it is**: the one coordination point a handler uses to touch the database. It hands out typed repositories (read-write for aggregate roots, read-only for any entity), persists everything pending in one call, and exposes controlled transaction and identity-insert operations. The doc comment states the contract in two sentences (`IUnitOfWork.cs:5-9`): it coordinates persistence across multiple repositories within a single database context, and `SaveChangesAsync` persists all pending changes and dispatches domain events raised by tracked aggregates.
- **Depends on**: [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) as the two constraint bounds (`IUnitOfWork.cs:1`, `:20`, `:30`); [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) and [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) as the two return types (`IUnitOfWork.cs:19` and `:29`). Externals: BCL `IDisposable` and `IAsyncDisposable`, both declared as base interfaces (`IUnitOfWork.cs:10`). Notably absent: anything from `Microsoft.EntityFrameworkCore`, which is the point of the type.
- **Concept introduced, the Unit of Work as the Application layer's only persistence verb.** `[Rubric §8, Data Architecture]` assesses whether persistence is deliberate: one save boundary, one transaction story, explicit concurrency and audit handling rather than scattered `SaveChanges` calls. A unit of work is the scope inside which a caller sees a consistent view of the data and inside which all of its changes either land together or not at all. Here that scope is the DI scope: [`UnitOfWork`](#unitofwork) is registered `TryAddScoped` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:121`), it caches one repository per closed generic interface type (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:23`, `:37-45`), and every repository it hands out is bound to a context obtained from the same [`IDbContextFactory`](#idbcontextfactory) (`UnitOfWork.cs:41`), so two handlers in one request share one change tracker instead of racing two.

  `[Rubric §3, Clean Architecture]` assesses whether the inner layers declare intent while the outer layers own the technology. This interface lives in `MMCA.Common.Application` and names no EF type, which is exactly what lets the architecture fitness rule "Application must not depend on EF Core, use IRepository/IUnitOfWork" hold (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Purity.cs:54-64`). The EF-shaped work (a context per physical source, execution strategies, identity-insert SQL) sits behind it in `MMCA.Common.Infrastructure`.

  `[Rubric §6, CQRS & Event-Driven]` assesses whether events are raised and delivered from a single, reliable place. `SaveChangesAsync` is that place: the doc comment (`IUnitOfWork.cs:7-8`) ties persistence and domain-event dispatch into one operation, and the mechanism behind it is the interceptor plus outbox flow described on [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor).

  `[Rubric §14, Testability]` assesses whether the abstraction a handler depends on can be replaced without infrastructure. Because a handler asks this interface for its repositories rather than receiving them, one `Mock<IUnitOfWork>` substitutes the entire data layer; the framework ships that scaffold as [`HandlerTestBase<THandler>`](group-27-testing-infrastructure.md#handlertestbasethandler), which pre-stubs `SaveChangesAsync` to return 1 (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Support/HandlerTestBase.cs:42`) and wires each registered repository mock into both `GetRepository` and `GetReadRepository` (`HandlerTestBase.cs:61-62`).
- **Walkthrough**: nine members, in three groups.
  - `GetRepository<TEntity, TIdentifierType>()` (`IUnitOfWork.cs:19-21`): the read-write repository. Its constraint is `where TEntity : AuditableAggregateRootEntity<TIdentifierType>` (`IUnitOfWork.cs:20`), so the DDD rule that the doc comment states in prose ("Only aggregate roots can be directly persisted", `IUnitOfWork.cs:14`) is enforced by the compiler. In the implementation the call resolves the entity's physical data source through [`IDataSourceService`](#idatasourceservice), fetches the matching context, builds the repository through [`IRepositoryFactory`](#irepositoryfactory), and caches it under the closed interface type (`UnitOfWork.cs:37-45`).
  - `GetReadRepository<TEntity, TIdentifierType>()` (`IUnitOfWork.cs:29-31`): the read-only repository, constrained only to [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`IUnitOfWork.cs:30`), so child entities are readable even though they are not independently writable. Same resolution path, different factory method (`UnitOfWork.cs:57-65`).
  - `SaveChangesAsync(CancellationToken cancellationToken = default)` (`IUnitOfWork.cs:36`): persists everything and returns the number of state entries written (`IUnitOfWork.cs:35`). The implementation is a straight delegation (`UnitOfWork.cs:69-70`) to [`DbContextFactory`](#dbcontextfactory), which saves **every** cached context, not just one: it snapshots the contexts and loops in bounded passes (three, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:53`) so a context materialized by a domain event handler mid-save is still saved (`DbContextFactory.cs:238-252`), then throws if any tracked change is left behind rather than losing it silently (`DbContextFactory.cs:260-271`).
  - `Save()` (`IUnitOfWork.cs:40`): the synchronous form, with the doc comment preferring the async one in async code paths (`IUnitOfWork.cs:38`). It delegates to `DbContextFactory.SaveChanges()` (`UnitOfWork.cs:73`, `DbContextFactory.cs:409-417`).
  - `RequestIdentityInsert()` (`IUnitOfWork.cs:49`): a one-shot flag saying the next save may insert rows carrying explicit values for database-generated identity columns, for example records imported from an external system with their source ids intact (`IUnitOfWork.cs:42-48`). The implementation sets a boolean (`UnitOfWork.cs:76`, `DbContextFactory.cs:277`); the next `SaveChangesAsync` reads and immediately clears it (`DbContextFactory.cs:228-229`, which is what "automatically cleared after the save completes" means) and, for a SQL Server context, routes the save through `SaveWithIdentityInsertAsync` (`DbContextFactory.cs:248-250`), which groups the affected entries by table and wraps each group in `SET IDENTITY_INSERT ON/OFF` because SQL Server allows only one table per session to have it on (`DbContextFactory.cs:279-301`).
  - `BeginTransaction()` (`IUnitOfWork.cs:52`), `CommitTransaction()` (`IUnitOfWork.cs:55`), `RollbackTransaction()` (`IUnitOfWork.cs:58`): manual transaction control, each fanning out across every transaction-capable cached context (`DbContextFactory.cs:419-442`). Begin skips a context that already carries a transaction, since EF throws on a second `BeginTransaction` for the same connection (`DbContextFactory.cs:423-428`). Rollback additionally drops any deferred in-process event dispatch, because the aggregate changes and their outbox rows just rolled back with it (`DbContextFactory.cs:444-448`).
  - `ExecuteInTransactionAsync<TResult>(Func<CancellationToken, Task<TResult>> operation, CancellationToken cancellationToken = default)` (`IUnitOfWork.cs:70-72`): the member to reach for instead of the three above. Its doc comment (`IUnitOfWork.cs:60-66`) states the reason: the operation runs wrapped by the active execution strategy, so a retrying strategy such as `SqlServerRetryingExecutionStrategy` can retry the whole transaction as one retriable unit, committing on success and rolling back before an exception propagates. The implementation adds five behaviors worth knowing (`DbContextFactory.cs:500-545`, with the attempt runner at `:554-609`): a nested call joins the ambient transaction instead of opening a second one (`DbContextFactory.cs:511-512`); a returned failed [`Result`](group-01-result-error-handling.md#result) rolls back exactly like an exception (`DbContextFactory.cs:564-571`); each retry starts from a reset change tracker, so entities a failed attempt added are not inserted twice (`DbContextFactory.cs:473-479`, `:528-529`); deferred in-process domain events are flushed only after a successful commit (`DbContextFactory.cs:577-584`); and a failure of the **commit itself** is never retried, surfacing as [`TransactionCommitAmbiguousException`](#transactioncommitambiguousexception) thrown outside the strategy instead (`DbContextFactory.cs:537-542`).
  - The two base interfaces (`IUnitOfWork.cs:10`) matter at scope teardown: [`UnitOfWork`](#unitofwork) forwards both disposal paths to the context factory (`UnitOfWork.cs:93-119`), so the async path awaits `_dbContextFactory.DisposeAsync()` (`UnitOfWork.cs:103`) rather than blocking.
- **Why it's built this way**: under [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) a single host may own several physical databases, so "save" cannot mean "call SaveChanges on the one context". Splitting the responsibility keeps that manageable: [`IDbContextFactory`](#idbcontextfactory) owns multi-source routing, saving, transactions and disposal, while `IUnitOfWork` is the narrow per-scope facade the Application layer is allowed to see, adding only repository resolution and caching on top (`UnitOfWork.cs:13`, `:23`). Exposing `ExecuteInTransactionAsync` as a first-class member, rather than leaving callers with `BeginTransaction`, is what makes the [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html) pipeline's transaction rules enforceable in one place: business failures roll back and post-commit event dispatch is deferred. Keeping the interface in Application rather than Infrastructure is the [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) and Clean Architecture pairing, since a handler returns a `Result` and never sees an EF type on the way there.
- **Where it's used**: injected into command handlers across the framework and both apps. In MMCA.Common: [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult) takes it in its primary constructor (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:22`) and calls `ExecuteInTransactionAsync` for any command marked [`ITransactional`](group-05-cqrs-pipeline.md#itransactional) (`TransactionalCommandDecorator.cs:31`); [`DeleteEntityHandler<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentityhandlertentity-tidentifiertype) takes it and resolves its write repository from it (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Crud/DeleteEntityHandler.cs:37`, `:70`); [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) both holds it and derives its read repository from it (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:33`, `:43`, `:87`). In MMCA.ADC, [`RefreshFromSessionizeHandler`](group-18-conference-application.md#refreshfromsessionizehandler) is the live consumer of the identity-insert path, calling `RequestIdentityInsert()` immediately before the save because Sessionize imports preserve external ids into tables with IDENTITY columns (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:139-140`). The single implementation is [`UnitOfWork`](#unitofwork) (`UnitOfWork.cs:13`), which is `internal sealed`, so consumers only ever see this interface.
- **Caveats / not-in-source**: `Save()` is not the synchronous twin of `SaveChangesAsync()` in event behavior. The synchronous interceptor path cannot await the in-process dispatcher, so with the outbox enabled it clears the captured events from their aggregates and leaves their outbox rows for [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) to deliver; a context without outbox support keeps the older no-op instead, so a later async save can still deliver those events (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:114-138`). Second, `ExecuteInTransactionAsync` is not a distributed transaction: with several physical sources each gets its own transaction and commits are sequential and best effort, so a commit failure on the second source leaves the first already committed. The doc comment names that limitation and records that the thrown [`TransactionCommitAmbiguousException`](#transactioncommitambiguousexception) reports each source's outcome so the partial state is observable rather than inferred, with the outbox as the cross-source consistency mechanism (`DbContextFactory.cs:453-456`, `:487-497`).

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:597-607`), which calls
  `services.Configure<EntityConfigurationOptions>` with a contains-check so an assembly is added at
  most once (`DependencyInjection.cs:599-605`); `AddNotificationInfrastructure()`
  (`DependencyInjection.cs:614-619`) is the one in-framework caller. It is read by
  [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider).

### PersistenceSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/PersistenceSettings.cs:10` · Level 0 · class (sealed)

- **What it is**: the bound `Persistence` configuration section, currently a single knob: the SQL
  command timeout applied to every command the SQL Server context issues.
- **Depends on**: `System.ComponentModel.DataAnnotations` (for `[Range]`,
  `PersistenceSettings.cs:1`); nothing first-party.
- **Concept introduced, the defaults-preserve-history rule for a new settings section.** `[Rubric
  §16, Maintainability]` assesses whether change is additive; the class doc states the policy
  directly, every property defaults to the value the framework applied implicitly before the section
  existed, so the section is optional in `appsettings.json` (`PersistenceSettings.cs:5-9`). `[Rubric
  §12, Performance & Scalability]`: the 30-second default is the previous implicit ADO.NET behavior,
  and the doc names the case for raising it (reporting-style workloads whose queries legitimately run
  longer than half a minute, `PersistenceSettings.cs:15-20`). Making that value configurable rather
  than constant is the difference between tuning an environment and cutting a release.
- **Walkthrough**: `SectionName = "Persistence"` (`PersistenceSettings.cs:13`);
  `CommandTimeoutSeconds`, `[Range(1, 600)]`-validated (`PersistenceSettings.cs:21`) and defaulting
  to `30` (`PersistenceSettings.cs:22`), is the only property. The consuming side is defensive in a
  way worth copying: [`SQLServerDbContext`](#sqlserverdbcontext) resolves the options with
  `GetService<IOptions<PersistenceSettings>>()?.Value ?? new PersistenceSettings()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:35-36`),
  so a context built outside the full DI graph (the design-time provider behind `dotnet ef`, a test)
  still gets the documented default rather than a null reference. It then applies it with
  `sql.CommandTimeout(_persistenceSettings.CommandTimeoutSeconds)` (`SQLServerDbContext.cs:55`).
- **Why it's built this way**: a `[Range]`-validated option bound with `ValidateDataAnnotations()`
  and `ValidateOnStart()` turns a typo into a startup failure rather than a per-query surprise
  ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
- **Where it's used**: bound in the infrastructure registration
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:135-138`) and read by
  [`SQLServerDbContext`](#sqlserverdbcontext); no other engine context reads it today.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:24-58`,
  covering `AddAsync` through `ExecuteUpdateAsync`) and
  [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepositoryDecorator.cs:33-111`,
  covering `GetAllAsync` through `CountAsync`).
  [`ApplicationDbContext`](#applicationdbcontext) opens its own MiniProfiler step directly rather
  than through this helper (`ApplicationDbContext.cs:155`). Behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/ProfilingHelperTests.cs`.

### ImageContentSniffer
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Storage` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/ImageContentSniffer.cs:10` · Level 0 · class (public static)

- **What it is**: a dependency-free static helper that decides whether uploaded bytes *are* a JPEG, PNG, or
  WebP image by inspecting the leading magic bytes, never the client-declared content type or file extension.
- **Depends on**: nothing first-party (BCL `ReadOnlySpan<byte>`; the file has no `using` directives). It is
  the upload-side companion to [`IImageProcessor`](#iimageprocessor).
- **Concept introduced, magic-byte content sniffing as an upload trust boundary.** `[Rubric §11, Security]`
  assesses whether untrusted input is validated by its actual content rather than by a spoofable
  client-supplied MIME type or file extension; this type is the framework's answer for binary uploads.
  `[Rubric §26, Front-End Security]` also applies at the origin of an avatar upload, because the
  browser-supplied `Content-Type` is exactly what this code refuses to trust. The doc comment
  (`ImageContentSniffer.cs:3-9`) frames the division of labor under
  [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html): the sniffer
  narrows accepted inputs to jpeg/png/webp, then the caller hands content to the processor whose re-encoding
  keeps only pixels, while app-specific size limits and error codes stay in the calling handler.
- **Walkthrough**: four span-based predicates, all expression-bodied and all `public`.
  - `IsAllowedImage(ReadOnlySpan<byte> content)` (`ImageContentSniffer.cs:15-16`): the entry point, a
    short-circuiting `IsJpeg || IsPng || IsWebP`.
  - `IsJpeg` (`ImageContentSniffer.cs:21-22`): length at least 3 and the SOI prefix `FF D8 FF` checked byte
    by byte.
  - `IsPng` (`ImageContentSniffer.cs:27-28`): length at least 8 and a `SequenceEqual` against the exact
    8-byte PNG signature `89 50 4E 47 0D 0A 1A 0A`.
  - `IsWebP` (`ImageContentSniffer.cs:33-36`): length at least 12, a `RIFF` container (bytes 0-3 against the
    UTF-8 literal `"RIFF"u8`) declaring the `WEBP` form type (bytes 8-11 against `"WEBP"u8`). Bytes 4-7 are
    the RIFF chunk size and are deliberately not inspected.
- **Why it's built this way**: `ReadOnlySpan<byte>` plus UTF-8 literals mean the checks allocate nothing and
  run directly on the payload prefix, and being a pure static class it is callable from any layer without DI
  or mocking. Checking bytes rather than the declared type is the security point: a client can rename
  `evil.exe` to `avatar.png`, but it cannot forge a valid leading signature and still survive the re-encode
  that follows.
- **Where it's used**: called by [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler)
  as the first gate on an upload
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:50`)
  before the bytes reach [`IImageProcessor`](#iimageprocessor) (`SetUserAvatarHandler.cs:72`) and then
  [`IFileStorageService`](#ifilestorageservice) (`SetUserAvatarHandler.cs:86`). It has its own dedicated unit-test
  class (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/ImageContentSnifferTests.cs`).
- **Caveats / not-in-source**: sniffing establishes only that the *prefix* matches a known signature. It is
  not a decode, so a truncated or malformed body still passes here and is rejected later by
  [`IImageProcessor`](#iimageprocessor).

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:65`) and resolved by
  [`ApplicationDbContext`](#applicationdbcontext), which iterates its assemblies inside
  `ApplyConfigurationsForEntitiesInContext` (`ApplicationDbContext.cs:690,707`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DefaultEntityConfigurationAssemblyProviderTests.cs`.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:112`) and injected into
  Application-layer query code:
  [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`), the
  Common notification handlers (`GetMyNotificationsHandler.cs:18`,
  `GetUnreadNotificationCountHandler.cs:15`, `GetNotificationHistoryHandler.cs:17`,
  `MarkNotificationReadHandler.cs:14`, `MarkAllNotificationsReadHandler.cs:14`) and app handlers such
  as `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:19`
  and `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/SessionQuestions/Services/SessionQuestionViewBuilder.cs:12`.
  Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EFQueryableExecutorTests.cs`.

### NamespaceConventions
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:11` · Level 1 · class (internal static)

- **What it is**: the persistence layer's one-method entry point for deriving a module name from an
  entity type's namespace. It is a thin forwarder: the parsing itself lives in
  [`ModuleNameConventions`](group-08-auth.md#modulenameconventions) in `MMCA.Common.Shared`, so SQL
  schema names, logical database names and the module label the CQRS logging decorators enrich their
  scopes with all come from one rule.
- **Depends on**: [`ModuleNameConventions`](group-08-auth.md#modulenameconventions)
  (`NamespaceConventions.cs:1,20-21`); nothing else.
- **Concept introduced, convention-over-configuration naming with a single shared parser.** `[Rubric
  §8, Data Architecture]` (assesses schema and database organization), `[Rubric §7, Microservices
  Readiness]` (assesses whether the model splits cleanly per module) and `[Rubric §16,
  Maintainability]` (one rule, one implementation): `MMCA.Store.Sales.Domain.Orders` yields `"Sales"`,
  which becomes both the `[Sales]` SQL schema and the `Sales` logical database name (the worked
  examples are in the doc comment, `NamespaceConventions.cs:14-16`). A new module that follows the
  namespace pattern gets a schema and a data-source name with zero configuration; an explicit
  `[UseDatabase("X")]` attribute on a configuration overrides it when the pattern does not fit. The
  parse was lifted into Shared because Application may not reference Infrastructure and the logging
  decorators need the same answer (`NamespaceConventions.cs:6-9`).
- **Walkthrough**: `GetModuleName(Type entityType)` (`NamespaceConventions.cs:20-21`) delegates
  straight to `ModuleNameConventions.GetModuleName`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Conventions/ModuleNameConventions.cs:38-51`). That
  method splits the namespace on `.`, defaulting to an empty array when `Namespace` is null
  (`ModuleNameConventions.cs:40`), and applies two rules in order:
  - **The `Domain` rule** (`ModuleNameConventions.cs:41-46`): the case-insensitive index of a `Domain`
    segment, and when that index is `>= 1` the preceding segment wins. This is the original
    persistence rule, kept byte for byte so schema and data-source naming never move.
  - **The other layer segments** (`ModuleNameConventions.cs:17,48-50`): `Application`,
    `Infrastructure`, `API` and `UI` match only at the fourth segment or later (`layerIndex >= 3`), so
    a framework namespace such as `MMCA.Common.Application.*` resolves to `null` rather than to a
    phantom `"Common"` module. `Shared` is deliberately absent from that list.
- **Why it's built this way**: a single authority for both derivations means the schema name and the
  database name are computed identically, so they cannot diverge; keeping the parser in Shared lets
  Application reuse it without a layer violation. `NamespaceConventions` stays `internal` because
  callers inside Infrastructure should consume the resolved name, not re-derive it.
- **Where it's used**: [`EntityDataSourceRegistry`](#entitydatasourceregistry) falls back to it when no
  `[UseDatabase]` is present and then to `DataSourceKey.DefaultName`
  (`EntityDataSourceRegistry.cs:181`), and
  [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype)
  uses it for the SQL table schema (`EntityTypeConfiguration.cs:66`, falling back to `dbo`) and the
  Cosmos container name (`EntityTypeConfiguration.cs:87`, falling back to the entity type name). The
  Shared parser is separately exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Conventions/ModuleNameConventionsTests.cs`, and the
  persistence forwarder by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:54,58`.

### SoftDeleteFilterSql
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:16` · Level 1 · class (internal static)

- **What it is**: the two-method internal static class that owns the `IsDeleted = 0` index predicate:
  it builds the predicate in the identifier-quoting style of the target engine, and it recognises when
  an index filter already carries that predicate. It is the single authority both the automatic
  convention and the hand-authored opt-in call, so the two can never disagree.
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
- **Walkthrough**:
  - `Build(DataSource engine, IReadOnlyEntityType entityType)` (`SoftDeleteFilterSql.cs:27-37`) has
    three steps. The **Cosmos short-circuit** (`:29-30`) returns `null` for `DataSource.CosmosDB`,
    which has no filtered-index support; `null` is the contract for "leave the index untouched", and
    both callers check it before doing anything (`SoftDeleteUniqueIndexConvention.cs:57-58`,
    `IndexBuilderExtensions.cs:57-58`). **Column-name resolution** (`:32`) delegates to the private
    `ColumnName` helper (`:57-59`), which looks the `IsDeleted` property up in the entity type and
    takes its mapped column name, falling back to the CLR property name when the property is not in
    the model, so a `HasColumnName` rename follows automatically. **Quoting** (`:34-36`): SQL Server
    gets `[Column] = 0`, every other relational engine (SQLite today) gets `"Column" = 0`.
  - `ContainsPredicate(string existingFilter, IReadOnlyEntityType entityType)`
    (`SoftDeleteFilterSql.cs:52-55`) answers the idempotence question: does a filter already declared
    on an index constrain the soft-delete column? Both sides are pushed through `Normalize`
    (`:62-63`), which strips whitespace and the three identifier quoting styles (`[`, `]`, `"` and a
    backtick), so a hand-authored `[IsDeleted] = 0`, a `"IsDeleted"=0` and the string `Build` produces
    all count as the same clause (`:46-51`). Without that normalization the convention would append
    its own predicate to a filter that already had one and a second model build would emit
    `... AND [IsDeleted] = 0 AND [IsDeleted] = 0`.
- **Why it's built this way**: `internal static` with a nullable return keeps the engine-capability
  decision inside the builder rather than duplicated at each call site. The Cosmos `null` is a
  deliberate signal instead of an exception, because both callers run over whole models where Cosmos
  entities are simply skipped. Comparing on a normalized form rather than on the exact string is what
  lets the two entry points, which do not agree on quoting, still recognise each other's output.
- **Where it's used**: [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) calls
  `Build` at model finalization and `ContainsPredicate` before combining, then joins with `AND` in the
  same order the opt-in extension uses (`SoftDeleteUniqueIndexConvention.cs:56,74,79`), and
  [`IndexBuilderExtensions`](#indexbuilderextensions) calls `Build` for a hand-authored index,
  optionally joining an extra predicate (`IndexBuilderExtensions.cs:56-63`).
- **Caveats / not-in-source**: the double-quote branch is reached by any non-SQL-Server, non-Cosmos
  engine. SQLite is the only such engine registered today, so whether the quoting suits a future
  provider is Not determinable from source.

### SqlServerUniqueConstraintViolationDetector
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SqlServerUniqueConstraintViolationDetector.cs:31` · Level 1 · class (sealed)

- **What it is**: the shipped implementation of
  [`IUniqueConstraintViolationDetector`](#iuniqueconstraintviolationdetector). Given the exception a
  failed save threw, it answers whether the database rejected the write for violating a unique
  constraint, so a handler whose pre-check lost a race against a concurrent insert can return the same
  conflict result the pre-check would have produced.
- **Depends on**: [`IUniqueConstraintViolationDetector`](#iuniqueconstraintviolationdetector) (the
  Application-layer contract it implements) and `Microsoft.Data.SqlClient` (`SqlException`). Nothing
  else: it holds no state and takes no constructor dependencies.
- **Concept introduced, classifying a provider error without leaking the provider.** `[Rubric §3,
  Clean Architecture]` (assesses whether provider vocabulary stays in Infrastructure): the Application
  layer references `MMCA.Common.Domain` and no data provider at all, so neither `SqlException` nor the
  EF Core `DbUpdateException` wrapping it is reachable from a handler
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUniqueConstraintViolationDetector.cs:9-25`).
  Asking a handler to match on the exception **message** is what that constraint used to force, and
  that is wrong twice over: the wording is a provider and locale detail, and matching on it drags
  provider vocabulary into the layer whose purpose is to stay persistence neutral. `[Rubric §29,
  Resilience & Business Continuity]` also applies: the pattern turns a lost insert race into a
  deterministic conflict answer rather than an unhandled 500, and a miss is safe rather than silent,
  because an unclassified exception simply keeps propagating.
- **Walkthrough**: one method, `IsUniqueConstraintViolation(Exception exception)`
  (`SqlServerUniqueConstraintViolationDetector.cs:46-71`).
  - **Chain walk** (`:48`): a `for` loop over `current = exception` then `current.InnerException`. EF
    surfaces a rejected insert as a `DbUpdateException` wrapping the provider exception, so testing
    only the outermost exception would never match.
  - **Number check** (`:50-54`): the link classifies when it is a `SqlException` whose `Number` is
    2601 (duplicate key rejected by a unique INDEX, `:34`) or 2627 (duplicate key violating a PRIMARY
    KEY or UNIQUE constraint, `:37`). Every other SQL Server error (a foreign-key failure, a deadlock
    victim, a timeout) is deliberately not a unique violation and must keep propagating
    (`:13-17`).
  - **Message fallback** (`:56-67`): a link that is not a `SqlException` still classifies when its
    message contains `duplicate key` (`:40`, the wording SQL Server and PostgreSQL share) or
    `UNIQUE constraint failed` (`:43`, SQLite), both matched `OrdinalIgnoreCase`. The comment is
    explicit that this is a fallback only, for a wrapper that captured the provider failure as text (a
    retry decorator re-throwing its own type, another engine's provider, a test double), and that the
    error numbers themselves are never matched as text: they do not appear in the message, so
    searching for them would match nothing real while happily matching an unrelated exception that
    quoted those digits.
  - **Default** (`:70`): `false` once the chain is exhausted.
- **Why it's built this way**: `sealed` and stateless by construction (`:26-29`), which is what lets
  the container register it as a singleton. It is also the **default registration for hosts running
  another engine**, not just for SQL Server: the number check never matches there and the message
  fallback carries them, and a dedicated implementation can replace it whenever an engine deserves its
  own number check (`:19-25`).
- **Where it's used**: registered as the singleton
  [`IUniqueConstraintViolationDetector`](#iuniqueconstraintviolationdetector) via `TryAddSingleton`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:117`), which the module
  registrations rely on rather than shipping their own pair
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:25`).
  The consumers are the handlers whose uniqueness pre-check can lose a race:
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:27`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/Create/CreateBookmarkHandler.cs:21`,
  `.../CheckIns/UseCases/GetOrCreateMyBadge/GetOrCreateMyBadgeHandler.cs:20`,
  `.../Points/Services/PointsAwarder.cs:32` and
  `.../Points/UseCases/SetLeaderboardParticipation/SetLeaderboardParticipationHandler.cs:33`. Behavior
  is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/SqlServerUniqueConstraintViolationDetectorTests.cs`
  and the registration by `DependencyInjectionInfrastructureTests.cs:263-266`.
- **Caveats / not-in-source**: the message fallback is evaluated for every link in the chain,
  including a `SqlException` whose number did not match, so any exception whose message happens to
  contain `duplicate key` classifies as a collision. That is the deliberate trade the comment
  describes; whether a real provider emits that wording for a non-unique failure is Not determinable
  from source.

### IFileStorageService
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Storage` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IFileStorageService.cs:11` · Level 3 · interface

- **What it is**: the contract for storing and deleting binary blobs, for example user avatar images.
  Implementations own the container or bucket; callers pass only a blob name scoped within it.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) and its generic form (via
  `MMCA.Common.Shared.Abstractions`, `IFileStorageService.cs:1`); BCL `Stream` and `Uri`.
- **Concept introduced, the managed blob-storage boundary.** `[Rubric §8, Data Architecture]` assesses whether
  data lands in the right store, and binary content belongs in object storage rather than in a relational row.
  `[Rubric §10, Cross-Cutting Concerns]` assesses whether a transport like this is swappable behind an
  abstraction. Per the doc comment (`IFileStorageService.cs:5-10`,
  [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)) the default
  implementation is unconfigured (uploads fail with a clear error) until a host calls
  `AddAzureBlobFileStorage(configuration)` with a complete `FileStorage` section. Returning
  [`Result`](group-01-result-error-handling.md#result) rather than throwing keeps a failed upload on the same
  error-flow rails as the rest of the stack (see the
  [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Walkthrough**: one property and two methods.
  - `IsConfigured` (`IFileStorageService.cs:14`): whether a real store is wired, so a handler can gate a feature
    on it rather than attempt a doomed upload.
  - `UploadAsync(string blobName, Stream content, string contentType, CancellationToken cancellationToken = default)`
    (`IFileStorageService.cs:22`): uploads or overwrites a blob and returns its public absolute URL as
    `Result<Uri>`. The blob name is container-scoped, for example `avatars/42-a1b2c3d4.jpg`
    (`IFileStorageService.cs:17`), and the content is read from the stream's current position
    (`IFileStorageService.cs:18`).
  - `DeleteAsync(string blobName, CancellationToken cancellationToken = default)`
    (`IFileStorageService.cs:28`): deletes a blob; unknown names succeed (idempotent,
    `IFileStorageService.cs:24`), which matches at-least-once cleanup semantics.
- **Why it's built this way**: an unconfigured default plus an `IsConfigured` gate means the framework ships
  avatar support without forcing every consumer to provision blob storage, and idempotent delete makes cleanup
  safe to retry after a partial failure.
- **Where it's used**: [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler) uploads the
  normalized JPEG (`SetUserAvatarHandler.cs:26` for the injection, `:85` for the call), with
  [`RemoveUserAvatarHandler`](group-24-identity-module.md#removeuseravatarhandler) and
  [`DeleteUserHandler`](group-24-identity-module.md#deleteuserhandler) on the cleanup side.
  [`NullFileStorageService`](group-14-module-system-composition.md#nullfilestorageservice) is the default registration
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:584`);
  [`AzureBlobFileStorageService`](group-14-module-system-composition.md#azureblobfilestorageservice) replaces it when configured
  (`DependencyInjection.cs:719`).

### IImageProcessor
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Infrastructure.Storage` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IImageProcessor.cs:11` · Level 3 · interface

- **What it is**: the contract for normalizing an untrusted uploaded image: decode it (rejecting non-images),
  correct EXIF orientation, center-crop to a square, strip *all* metadata, and re-encode as JPEG.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via `MMCA.Common.Shared.Abstractions`,
  `IImageProcessor.cs:1`); BCL `Stream`.
- **Concept introduced, re-encoding as an image trust boundary.** `[Rubric §11, Security]` assesses whether
  untrusted binary input is neutralized rather than merely inspected;
  `[Rubric §30, Compliance, Privacy & Data Governance]` assesses PII handling, and EXIF GPS coordinates are PII
  that a naive avatar pipeline would happily publish to a public blob URL. The doc comment
  (`IImageProcessor.cs:5-10`,
  [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)) makes both points:
  metadata removal deletes location data, and re-encoding is the defense against polyglot or malformed payloads
  because only pixels survive the decode and re-encode round trip. This is the processor half of the pair that
  [`ImageContentSniffer`](#imagecontentsniffer) opens.
- **Walkthrough**: one method,
  `NormalizeToSquareJpegAsync(Stream content, int size, CancellationToken cancellationToken = default)`
  (`IImageProcessor.cs:18`), returning `Result<byte[]>` of the normalized JPEG or a validation failure for
  undecodable content (`IImageProcessor.cs:17`). `size` is the output square edge length in pixels
  (`IImageProcessor.cs:15`), so the caller (not the framework) owns the avatar dimension.
- **Why it's built this way**: returning bytes rather than writing straight to storage keeps the processor a
  pure transform, so a handler can sniff, then normalize, then hand the result to
  [`IFileStorageService`](#ifilestorageservice); and a `Result` failure on undecodable input stops a bad upload
  before it ever reaches storage.
- **Where it's used**: called by [`SetUserAvatarHandler`](group-24-identity-module.md#setuseravatarhandler)
  between the sniffer and the upload (`SetUserAvatarHandler.cs:25` for the injection, `:71` for the call).
  Implemented by [`ImageSharpImageProcessor`](group-14-module-system-composition.md#imagesharpimageprocessor), registered with `TryAddSingleton`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:585`); note this is the one member
  of the avatar trio with a real default implementation rather than a null object.

### UnitOfWork
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13` · Level 13 · class (internal sealed)

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
    factory for the matching context (`:41`), and builds a read-write
    [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) through
    [`IRepositoryFactory`](#irepositoryfactory) (`:42`); constrained to
    `AuditableAggregateRootEntity<TIdentifierType>` so only aggregate roots get a mutable repository.
  - **`GetReadRepository<TEntity, TIdentifierType>()`** (`UnitOfWork.cs:53-66`): the same resolution
    but calls `CreateReadOnly` (`:62`) and accepts any `AuditableBaseEntity<TIdentifierType>`,
    returning [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype)
    for query handlers.
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
- **Where it's used**: registered as the scoped [`IUnitOfWork`](#iunitofwork) via `TryAddScoped`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:121`) and injected into
  virtually every command and query handler in Common and in both apps, and into the module seeders.

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
    `ApplicationDbContext.CurrentTenantId` at capture (`ApplicationDbContext.cs:119`).
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:628-657`)
  to `dbo.AuditTrailEntries` (`ApplicationDbContext.cs:637`) with `EntityType` at 256 non-unicode
  characters, `EntityKey` at 128, `PropertyName` at 128 non-unicode, `Operation` at 16 non-unicode and
  both `CorrelationId` and `TenantId` at 64 (`ApplicationDbContext.cs:639-645`), plus two indexes:
  `IX_AuditTrailEntries_Entity` over `(EntityType, EntityKey, ChangedOn)` for the read path and
  `IX_AuditTrailEntries_ChangedOn` for the retention sweep (`ApplicationDbContext.cs:646-655`). The
  mapping only happens when `AuditTrail:Enabled` is true: the context resolves that flag once in
  `OnConfiguring` (`ApplicationDbContext.cs:291`) and `ConfigureAuditTrail` returns immediately when
  it is false (`ApplicationDbContext.cs:630-633`), so a host that never opted in has exactly the model
  it had before the trail shipped (`ApplicationDbContext.cs:66-70`).

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

### AuditTrailSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:16` · Level 1 · class (sealed)

- **What it is**: the `AuditTrail` configuration section: whether entity change history is recorded
  at all, how long a row is kept, and which engine's `Default` database the read surface queries.
  Every property has a default, so a host that opts in only needs `AuditTrail:Enabled`
  (`AuditTrailSettings.cs:6-9`).
- **Depends on**: [`DataSource`](#datasource) from
  `MMCA.Common.Application.Interfaces.Infrastructure.Persistence` (`AuditTrailSettings.cs:2`), which
  is what puts it at Level 1, plus `System.ComponentModel.DataAnnotations` for `[Range]`
  (`AuditTrailSettings.cs:1`).
- **Concept introduced, a settings flag that gates the MODEL, not just behavior.** `[Rubric §8, Data
  Architecture]` (assesses whether the mapped model and its tables are a deliberate decision) and
  `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether the system can answer "who
  changed this, and when"). Most feature flags in this codebase decide whether code runs; this one
  also decides whether a table exists. `Enabled` is read in
  [`ApplicationDbContext`](#applicationdbcontext) with `GetService`, not `GetRequiredService`, and
  cached in a field (`ApplicationDbContext.cs:76`, `:291`) that the model builder consults before
  mapping the entity (`ApplicationDbContext.cs:628-633`), so a host that leaves it false has exactly
  the model it had before the trail existed and its migrations never see an `AuditTrailEntries`
  table (`AuditTrailSettings.cs:10-15`). That is what makes an opt-in feature genuinely free for a
  host that does not want it: a mapped-but-empty table would still have to be migrated. The trail is
  off by default because recording history is a data-governance decision an application makes
  deliberately ([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)).

  `[Rubric §31, Cost & FinOps]`: the doc on `Enabled` names the cost being avoided outright, a table
  plus a write per change (`AuditTrailSettings.cs:21-25`). Marking entities with `IAuditedEntity` is
  the second gate and, as `AddAuditTrail`'s remarks put it, that is where the write volume is
  actually decided (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:471-474`).
- **Walkthrough**: one static field and three `init` properties.
  - `SectionName = "AuditTrail"` (`AuditTrailSettings.cs:19`), the binding key.
  - `Enabled` (`AuditTrailSettings.cs:26`), defaulting to `false`. Read by
    [`ApplicationDbContext`](#applicationdbcontext) for the model gate (`ApplicationDbContext.cs:291`)
    and re-checked by the cleanup job before it does any work (`AuditTrailCleanupJob.cs:72-75`).
  - `RetentionDays` (`AuditTrailSettings.cs:38`), `[Range(1, 3650)]` (`:37`), default `90`.
    [`AuditTrailCleanupJob`](#audittrailcleanupjob) turns it into a cutoff instant
    (`AuditTrailCleanupJob.cs:77`) and purges from every relational source in use, skipping Cosmos
    (`:79-81`) and expanding each source across the declared tenants (`:83-86`).
  - `DataSource` (`AuditTrailSettings.cs:46`), default `DataSource.SQLServer`. Note the asymmetry the
    doc calls out (`AuditTrailSettings.cs:40-45`): rows are WRITTEN to every relational source
    alongside the data they describe, and this value only says which source the v1 reader looks in.
    [`AuditTrailReader`](#audittrailreader) resolves it against the `Default` database of that engine
    (`AuditTrailReader.cs:52-53`) and returns an empty result when the entity type is not in that
    model (`AuditTrailReader.cs:55-58`).
- **Why it's built this way**: retention is deliberately NOT self-driving. `AddAuditTrail` registers
  [`AuditTrailCleanupJob`](#audittrailcleanupjob) (`DependencyInjection.cs:492`) but a job only runs
  when the host also calls `AddScheduledJobs(configuration)` and sets `Scheduler:Enabled`
  (`DependencyInjection.cs:465-470`). Without the scheduler the trail still records everything and
  `RetentionDays` is inert, which the settings doc states as a supported state rather than leaving it
  as a surprise (`AuditTrailSettings.cs:32-36`). Registering the job in `AddAuditTrail` rather than in
  `AddScheduledJobs` keeps the two features independent (`DependencyInjection.cs:489-491`).
- **Where it's used**: bound with `.ValidateDataAnnotations().ValidateOnStart()` at
  `DependencyInjection.cs:478-481`, so a bad `RetentionDays` fails the host at startup rather than at
  the first sweep. Read by [`ApplicationDbContext`](#applicationdbcontext),
  [`AuditTrailReader`](#audittrailreader) (`AuditTrailReader.cs:34-39`) and
  [`AuditTrailCleanupJob`](#audittrailcleanupjob) (`AuditTrailCleanupJob.cs:48-55`, snapshotted at
  `:60`). Design-time tooling supplies the options object by hand so a migration can be generated
  with the table on or off (`DesignTimeDbContextHelper.cs:142-143`). The recording itself is
  [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor), registered as a singleton
  at `DependencyInjection.cs:485` and resolved by the context with `GetService` so its absence reads
  as "not registered" (`ApplicationDbContext.cs:278`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailModelGateTests.cs`
  and `AddAuditTrailTests.cs`.

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

### AuditTrailSaveChangesInterceptor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:62` · Level 11 · class (sealed)

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
  the guiding rule (`AuditTrailSaveChangesInterceptor.cs:18-23`): a trail that can be committed
  without its data, or the other way round, is worse than no trail. Four mechanics are worth learning
  here as a set.
  - **Opt in twice over** (`AuditTrailSaveChangesInterceptor.cs:32-36`): the host must call
    `AddAuditTrail` (the context resolves this interceptor with `GetService`, so its absence is a
    silent no-op, `ApplicationDbContext.cs:275-280`) **and** set `AuditTrail:Enabled` so the table is
    mapped. Then the entity must carry the marker. Nothing about the feature is on by default.
  - **Position in the pipeline** (`AuditTrailSaveChangesInterceptor.cs:25-31`): registered last, after
    [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor), the optional
    [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor) and
    [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
    (`ApplicationDbContext.cs:256-280`), so the values it diffs are final: the audit stamps are
    already written when it runs.
  - **Correlation is the trace id, not the scoped correlation context**
    (`AuditTrailSaveChangesInterceptor.cs:43-54`): this interceptor is a singleton and the only
    service provider a context carries is the root one, so a scoped
    [`ICorrelationContext`](group-12-api-hosting-mapping.md#icorrelationcontext) is not reachable from
    here and capturing one would be a lifetime bug. The trace id is ambient and is the same value
    [`CorrelationIdMiddleware`](group-12-api-hosting-mapping.md#correlationidmiddleware) falls back to
    when a request carries no `X-Correlation-ID` header. A caller-supplied header value is therefore
    NOT recorded today.
  - **Tenant is read off the context** (`AuditTrailSaveChangesInterceptor.cs:55-59`), through the live
    accessor the scoped context factory assigns (`ApplicationDbContext.cs:119`), so it does reach the
    interceptor where a scoped service would not.
- **Walkthrough**:
  - **Constants** (`AuditTrailSaveChangesInterceptor.cs:64-86`): the three operation names, the four
    column widths (`MaxEntityTypeLength` 256, `MaxKeyLength` 128, `MaxCorrelationIdLength` 64,
    `MaxTenantIdLength` 64) and the `|` composite-key separator. They match the model mapping in
    `ApplicationDbContext.ConfigureAuditTrail` exactly (`ApplicationDbContext.cs:639-645`).
  - **Static state** (`AuditTrailSaveChangesInterceptor.cs:88-119`): two `ConditionalWeakTable`s keyed
    by context (pending key fix-ups, and a marker for "a capture staged rows but the save has not
    finished"), a `ConcurrentDictionary` caching the PII verdict per (declaring type, property name),
    and a `HashSet<Type>` of the framework's own bookkeeping entities. That last set is guarded **by
    CLR type**, not by the absence of the marker, which is what keeps the trail from recording its own
    rows in an unbounded feedback loop and keeps the outbox, inbox and job tables out of a history
    nobody asked for (`AuditTrailSaveChangesInterceptor.cs:107-119`). `IsFrameworkEntity(Type)`
    (`:171`) is the `internal` window onto that set, which is both how `ShouldAudit` consults it and
    how a test can assert the exclusion list directly.
  - **The four overrides** (`AuditTrailSaveChangesInterceptor.cs:122-163`): `SavingChangesAsync` and
    `SavingChanges` both call `CaptureChanges`; `SavedChangesAsync` and `SavedChanges` both run the
    key fix-up. Each pattern-matches `eventData.Context is ApplicationDbContext` first, so a foreign
    context passes straight through.
  - **`CaptureChanges`** (`AuditTrailSaveChangesInterceptor.cs:177-219`): the first statement is the
    cheap double gate, `context.Model.FindEntityType(typeof(AuditTrailEntry)) is null`
    (`:179-185`), which covers both a host that never opted in and Cosmos (which skips relational
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:476,483-485`, singleton
  for the same reason as the other two save interceptors: stateless, with per-save state in a
  `ConditionalWeakTable` keyed by context), added to the EF pipeline in
  `ApplicationDbContext.OnConfiguring` (`ApplicationDbContext.cs:275-280`), and registered in the
  design-time pipeline too so `dotnet ef` matches runtime
  ([`DesignTimeDbContextHelper`](#designtimedbcontexthelper),
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:142-144`).
  Behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailSaveChangesInterceptorTests.cs`
  and `AuditTrailModelGateTests.cs`. Hosts opting in today include MMCA.Helpdesk
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:78`), all three MMCA.Store services
  (`Identity.Service/Program.cs:188`, `Sales.Service/Program.cs:206`,
  `Catalog.Service/Program.cs:210`) and all three MMCA.ADC services
  (`Engagement.Service/Program.cs:197`, `Identity.Service/Program.cs:232`,
  `Conference.Service/Program.cs:296`).
- **Caveats / not-in-source**: a caller-supplied `X-Correlation-ID` is not recorded; honoring it would
  need a live accessor on the context assigned by the scoped factory, the shape multi-tenancy
  introduced for `TenantId` (`AuditTrailSaveChangesInterceptor.cs:51-53`). Whether that will be done
  is Not determinable from source.

### AuditTrailCleanupJob
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailCleanupJob.cs:48` · Level 13 · class (internal sealed partial)

- **What it is**: the framework's own recurring job. It purges
  [`AuditTrailEntry`](#audittrailentry) rows older than the configured retention window from every
  relational data source in use, in batches.
- **Depends on**: [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob) (the contract it
  implements), [`IDbContextFactory`](#idbcontextfactory),
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry),
  [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings) and
  [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) via `IOptions<>`,
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
  - **Constructor** (`AuditTrailCleanupJob.cs:48-55`): the last two parameters are optional. The scope
    factory and the tenancy options default to `null`, because a host without tenancy never leaves the
    job's own scope. `_settings` is snapshotted from `options.Value` (`:60`), and `RetentionDays`
    defaults to 90 with a `[Range(1, 3650)]` guard
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:36-37`).
  - **`Name` and `CronExpression`** (`AuditTrailCleanupJob.cs:63,67`): `"audit-trail-cleanup"`, daily
    at `0 3 * * *`, chosen to sit off the daily peak for every time zone the framework runs in.
  - **`ExecuteAsync`** (`AuditTrailCleanupJob.cs:70-87`): returns immediately when
    `AuditTrail:Enabled` is false (`:72-75`), computes the cutoff as now minus `RetentionDays`
    (`:77`), enumerates the physical sources in use and filters out `DataSource.CosmosDB` (`:79-81`),
    then expands that set into per-tenant targets through
    [`TenantDataSourceTargets`](#tenantdatasourcetargets) and sweeps each one (`:83-86`).
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
    ends when a page comes back empty (`:162-165`) or short (`:172-175`), and it re-checks the
    cancellation token each turn (`:149`). No row is ever materialized as an entity.
  - **Logging** (`AuditTrailCleanupJob.cs:181-182`): a source-generated `LoggerMessage` emitted only
    when a sweep actually removed rows (`:131-135`), so a quiet night logs nothing.
- **Why it's built this way**: registering the job in `AddAuditTrail` rather than in
  `AddScheduledJobs` keeps the two features independent, which the DI comment states outright
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:489-491`): the trail can
  be enabled without the scheduler and the scheduler without the trail. Set-based batched deletion is
  the same discipline the outbox retention sweep uses, for the same reason.
- **Where it's used**: registered through `AddScheduledJob<AuditTrailCleanupJob>()` inside
  `AddAuditTrail` (`DependencyInjection.cs:492`, and that helper does a `TryAddScoped` of the concrete
  type plus a `TryAddEnumerable` of `IScheduledJob` at `:426-431`), and executed by
  [`ScheduledJobRunner`](group-14-module-system-composition.md#scheduledjobrunner) when the host runs
  the scheduler. Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailCleanupJobTests.cs`.

### AuditTrailReader
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.AuditTrail` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailReader.cs:34` · Level 13 · class (internal sealed)

- **What it is**: the read side of the trail, and the only implementation of
  [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader). It returns one entity's change
  history, newest first, as a paged list of
  [`AuditTrailEntryDTO`](group-14-module-system-composition.md#audittrailentrydto).
- **Depends on**: [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader),
  [`IDbContextFactory`](#idbcontextfactory), [`IDataSourceResolver`](#idatasourceresolver),
  [`DataSourceKey`](#datasourcekey), [`AuditTrailEntry`](#audittrailentry),
  [`AuditTrailEntryDTO`](group-14-module-system-composition.md#audittrailentrydto) and
  [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings) via `IOptions<>`
  (`AuditTrailReader.cs:34-39`).
- **Concept introduced, projecting to a DTO inside the query rather than after it.** `[Rubric §9, API
  & Contract Design]` (the Application-layer contract returns a DTO, never the persistence entity) and
  `[Rubric §12, Performance & Scalability]` (the `Select` is part of the SQL, so only the projected
  columns cross the wire, and `AsNoTracking` keeps the rows out of the change tracker). The ordering
  is `ChangedOn` descending with `Id` as the tie-break (`AuditTrailReader.cs:62-63`), which matters
  because every row of one save shares an identical `ChangedOn`: without the second key, paging over
  a save's worth of rows would not be stable.
- **Walkthrough**: `GetForEntityAsync(entityType, entityKey, page = 1, pageSize = 50, ct)`
  (`AuditTrailReader.cs:42-47`).
  - **Paging guards** (`AuditTrailReader.cs:49-50`): a page or page size below 1 is coerced to 1
    rather than rejected, so a bad caller gets the first page instead of an exception.
  - **Source resolution** (`AuditTrailReader.cs:52-53`): resolves the `Default` database of the engine
    named by `AuditTrail:DataSource` (defaulting to SQL Server, `AuditTrailSettings.cs:46`) and asks
    the context factory for it.
  - **Model gate** (`AuditTrailReader.cs:55-58`): returns an empty list when the trail entity is not
    in the model. The comment gives the reason (`AuditTrailReader.cs:25-29`): the read surface is
    registered by `AddAuditTrail`, which a host may call before flipping `AuditTrail:Enabled` per
    environment, so "not enabled" must read as "no history", not as an exception.
  - **The query** (`AuditTrailReader.cs:60-80`): `AsNoTracking`, filtered on `EntityType` and
    `EntityKey` (exactly the leading columns of `IX_AuditTrailEntries_Entity`,
    `ApplicationDbContext.cs:648-649`), ordered, skipped and taken, then projected column by column
    into the DTO (`AuditTrailReader.cs:66-78`). `TenantId` is not projected, because the DTO has no
    such member: it declares `Id` through `CorrelationId` and stops there
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Auditing/AuditTrailEntryDTO.cs:12-48`).
- **Why it's built this way**: the DTO stops the persistence entity from leaking into the Application
  contract, and matching the query's predicate and sort to the shipped index is why that index carries
  the whole predicate plus the sort rather than just the key
  (`ApplicationDbContext.cs:646-649`).
- **Where it's used**: registered as the scoped
  [`IAuditTrailReader`](group-05-cqrs-pipeline.md#iaudittrailreader) by `AddAuditTrail`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:487`). Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailReaderTests.cs`
  and the registration by `AddAuditTrailTests.cs:64,89`. A source search across the workspace finds no
  application or UI consumer of the interface today: it is a shipped read surface that hosts can
  inject, not a wired-up screen.
- **Caveats / not-in-source**: the class documents its own v1 limitation
  (`AuditTrailReader.cs:15-24`). Trail rows are written to whichever database holds the entity that
  changed (that is what makes the write atomic), so a host that splits its modules across several
  databases has several trail tables, and this reader queries exactly one of them: the `Default`
  database of the configured engine. For a monolith, where every source collapses onto `Default`, that
  is the whole trail. Reading another module's history would need a per-source overload, which the
  comment says was deliberately deferred rather than guessed at.

### ConnectionStringSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/ConnectionStringSettings.cs:12` · Level 0 · class (sealed)

- **What it is**: the class bound from the top-level `ConnectionStrings` section, one connection string
  per supported engine plus the Cosmos database name and the SQL Server migrations assembly. It
  describes the `Default` physical data source, the one every unmapped logical name collapses onto.
- **Depends on**: nothing first-party and nothing beyond `string` from the BCL, which is what puts it at
  Level 0. It is read by [`DataSourceResolver`](#datasourceresolver) and cross-checked by
  [`ConnectionStringSettingsValidator`](#connectionstringsettingsvalidator).
- **Concept introduced, fail-fast configuration where the rule spans two sections.** `[Rubric §15, Best
  Practices & Code Quality]` assesses whether misconfiguration is caught early.
  `AddOptions<T>().Bind(...).ValidateDataAnnotations().ValidateOnStart()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:78-81`) is the pattern
  every validated settings class uses, and
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) makes it the
  required form: annotations run during host startup rather than lazily on first resolution.
  `ValidateOnStart()` is the load-bearing call.

  What this type teaches on top of that is the limit of the annotation approach. No property here is
  `[Required]`, and the class doc says why (`ConnectionStringSettings.cs:5-10`): SQL Server is the
  default engine, but a host may run entirely on SQLite or Cosmos and may declare its databases under
  `DataSources` instead of this section. A `[Required]` attribute can only see one property on one
  class, so the real invariant ("the host can reach SOME database") is expressed as an
  `IValidateOptions<T>` implementation registered alongside the binding,
  [`ConnectionStringSettingsValidator`](#connectionstringsettingsvalidator)
  (`DependencyInjection.cs:88-89`). `[Rubric §8, Data Architecture]`: the rule spans both configuration
  shapes precisely because the physical topology is a deployment decision, not a compile-time one.
- **Walkthrough**: one static field and five `{ get; init; }` strings.
  - `SectionName = "ConnectionStrings"` (`ConnectionStringSettings.cs:15`), reusing ASP.NET Core's own
    conventional section so `GetConnectionString(...)` and this class read the same data.
  - `CosmosConnectionString` (`ConnectionStringSettings.cs:18`), empty by default.
  - `CosmosDatabaseName` (`ConnectionStringSettings.cs:21`), the one property with a non-empty default,
    `"AtlDevCon"`.
  - `SqliteConnectionString` (`ConnectionStringSettings.cs:24`), documented as typically a file path.
  - `SQLServerConnectionString` (`ConnectionStringSettings.cs:27`), the production engine's connection
    string.
  - `SQLServerMigrationsAssembly` (`ConnectionStringSettings.cs:33`), empty by default, which makes EF
    fall back to the DbContext assembly (`ConnectionStringSettings.cs:29-32`).
  - The registered validator is the interesting half. `ConnectionStringSettingsValidator.Validate`
    succeeds when either the top-level section names a database on any engine
    (`ConnectionStringSettingsValidator.cs:56-59`) or any named `DataSources` entry does
    (`ConnectionStringSettingsValidator.cs:66-71`), and otherwise fails with a message that lists both
    shapes because which one is missing depends on the host
    (`ConnectionStringSettingsValidator.cs:38-43`, `ConnectionStringSettingsValidator.cs:46-53`). Its
    remarks record the change of rule directly: this replaced a `[Required]` on
    `SQLServerConnectionString` that failed a legitimate SQLite-only host at startup
    (`ConnectionStringSettingsValidator.cs:11-24`).
- **Why it's built this way**: `init`-only properties make the bound settings immutable after startup,
  which [`DataSourceResolver`](#datasourceresolver) relies on, since it classifies every physical source
  once in its constructor (`DataSourceResolver.cs:53-71`). Keeping the "some database" check at boot
  rather than at first query is what stops a host from reporting healthy while unable to serve a request
  (`ConnectionStringSettingsValidator.cs:20-24`).
- **Where it's used**: bound and validated in `AddInfrastructure`
  ([`DependencyInjection`](group-14-module-system-composition.md#dependencyinjection),
  `DependencyInjection.cs:78-89`); consumed by [`DataSourceResolver`](#datasourceresolver) through
  `IOptions<ConnectionStringSettings>` (`DataSourceResolver.cs:54`, `DataSourceResolver.cs:61`), which
  reads it while seeding each engine's `Default` source (`DataSourceResolver.cs:197-232`) and while
  applying the Cosmos database-name fallback (`DataSourceResolver.cs:235-236`).
- **Caveats**: the `"AtlDevCon"` Cosmos default (`ConnectionStringSettings.cs:21`) is an
  application-specific name (the ADC conference database) baked into a framework package; every other
  default here is neutral.

### DataSourceEntrySettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceEntrySettings.cs:19` · Level 0 · class (sealed)

- **What it is**: the shape of ONE named entry under the `DataSources` configuration section, the
  per-logical-source counterpart to the top-level `ConnectionStrings` block. It carries a connection
  string per engine plus three per-source overrides (Cosmos database name and a migrations assembly for
  each relational engine).
- **Depends on**: nothing first-party and nothing beyond `string` from the BCL, which is why it sits at
  Level 0. It is aggregated by [`DataSourcesSettings`](#datasourcessettings) and read by
  [`DataSourceResolver`](#datasourceresolver).
- **Concept introduced, configuration as the physical-topology dial.** `[Rubric §8, Data Architecture]`
  assesses how the logical model maps onto physical stores; `[Rubric §7, Microservices Readiness]`
  assesses whether a module can be lifted out with its own database. The declarative half of that story
  is [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute), which names a
  *logical* source on an entity configuration. This class is the other half: it says what that logical
  name physically means in a given deployment. Nothing in the code decides the topology; the same
  compiled assemblies run as a one-database monolith or as N separate databases depending on how many
  entries exist here. `[Rubric §16, Maintainability]`: because every property defaults to `string.Empty`
  (`DataSourceEntrySettings.cs:22-52`), a partially filled entry is legal and each empty value falls
  back to the corresponding top-level value, so a host adds a database by adding one JSON object and
  nothing else.
- **Walkthrough**: six `{ get; init; }` properties, all defaulting to `string.Empty`.
  - `CosmosConnectionString` (`DataSourceEntrySettings.cs:22`) and `CosmosDatabaseName`
    (`DataSourceEntrySettings.cs:25`), the Cosmos pair; the database name falls back to the top-level
    `CosmosDatabaseName` when empty ([`DataSourceResolver`](#datasourceresolver) applies that fallback
    at `DataSourceResolver.cs:235-236` and again at `DataSourceResolver.cs:262-264`).
  - `SqliteConnectionString` (`DataSourceEntrySettings.cs:28`), the SQLite path
    ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) polyglot persistence).
  - `SqliteMigrationsAssembly` (`DataSourceEntrySettings.cs:43`), and its doc is worth reading in full
    (`DataSourceEntrySettings.cs:30-42`): there is deliberately NO top-level fallback for it. The
    top-level `ConnectionStrings` section carries only a SQL Server migrations assembly, so a SQLite
    host declares its own here through an entry that collapses onto `Default`. Without that asymmetry a
    mixed-engine host would silently hand its SQL Server migrations assembly to a SQLite database.
  - `SQLServerConnectionString` (`DataSourceEntrySettings.cs:46`), the production engine's connection
    string.
  - `SQLServerMigrationsAssembly` (`DataSourceEntrySettings.cs:52`), the EF Core migrations assembly for
    THIS source, documented as falling back to the top-level value when empty
    (`DataSourceEntrySettings.cs:48-51`).
  - The resolver reads the pair through one engine-keyed switch, `GetMigrationsAssembly`
    (`DataSourceResolver.cs:405-410`), stamps the SQLite value onto the
    [`PhysicalDataSource`](#physicaldatasource) only for SQLite sources (`DataSourceResolver.cs:398`),
    and names the offending setting per engine when two logical names collapse onto one database with
    conflicting values (`DataSourceResolver.cs:430`).
  - The XML doc carries a worked `appsettings.json` example for a `Conference` source
    (`DataSourceEntrySettings.cs:9-18`), which is the fastest way to see the intended shape.
- **Why it's built this way**: `init`-only properties make a bound entry immutable after startup, and
  the "empty means inherit" rule is what keeps the single-database default intact: an app that
  configures no `DataSources` section behaves exactly as it did before the section existed
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: bound as the value type of the dictionary that `AddInfrastructure` reads with
  `configuration.GetSection(DataSourcesSettings.SectionName).Get<Dictionary<string, DataSourceEntrySettings>>()`
  (`DependencyInjection.cs:92-94`); consumed by [`DataSourceResolver`](#datasourceresolver) when it
  classifies logical names into physical sources (`DataSourceResolver.cs:251-265`) and when it tests
  whether any entry names a database for an engine (`DataSourceResolver.cs:130-135`), and by
  [`ConnectionStringSettingsValidator`](#connectionstringsettingsvalidator) when it looks for any
  configured database (`ConnectionStringSettingsValidator.cs:66-71`).

### DefaultSeed
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:172` · Level 0 · record (sealed, private nested)

- **What it is**: a three-field carrier describing what the `Default` physical source of one engine is
  built from: `ConnectionString`, `MigrationsAssembly`, and `CosmosDatabaseName`
  (`DataSourceResolver.cs:172`). It exists only inside [`DataSourceResolver`](#datasourceresolver),
  where it is computed once per engine and then threaded through the four private methods that build
  that engine's map.
- **Depends on**: nothing first-party. It holds three `string` values, all of which may legitimately be
  empty. It is produced from [`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings)
  and [`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings) by
  `ResolveDefaultSeed` (`DataSourceResolver.cs:197-232`).
- **Concept introduced, the two-branch answer to "which database is Default".** `[Rubric §8, Data
  Architecture]` assesses whether the mapping from configuration to physical storage is explicit and
  has one owner; `[Rubric §16, Maintainability]` assesses whether a rule that several methods depend on
  is stated once instead of recomputed at each use. `Default` is the logical name every framework-owned
  table resolves to (outbox, inbox, scheduled jobs, audit trail), so "what is Default" has to have an
  answer even in a host that never wrote a top-level `ConnectionStrings` entry. The seed is that answer,
  and computing it into a record rather than passing three loose strings is what lets
  `ClassifyEntries`, `RegisterDefaultSource`, and `RegisterNamedSource` all agree on it
  (`DataSourceResolver.cs:156-163`).
- **Walkthrough**
  - `ConnectionString` (`DataSourceResolver.cs:169`, `DataSourceResolver.cs:172`) is the connection the
    `Default` source uses, and is empty when the engine is unconfigured. Branch one of
    `ResolveDefaultSeed` takes it straight from the top-level section when that section names a
    connection for the engine (`DataSourceResolver.cs:202-212`). Branch two applies only when the
    top-level value is absent: the named `DataSources` entries are filtered down to the ones carrying a
    connection for this engine (`DataSourceResolver.cs:214-216`), their connection identities are
    counted distinctly (`DataSourceResolver.cs:218-221`), and when exactly ONE distinct database is
    named that database becomes `Default` (`DataSourceResolver.cs:226-230`). With several distinct
    databases and no top-level value there is no single answer, so the seed stays empty
    (`DataSourceResolver.cs:231`) and a genuinely multi-database host names the shared one by adding a
    `DataSources:Default` entry.
  - `MigrationsAssembly` (`DataSourceResolver.cs:170`) is populated only on the top-level branch, and
    only for SQL Server: `ConnectionStrings` carries no SQLite equivalent, and handing a SQLite
    `Default` source the SQL Server value in a mixed-engine host would scaffold the wrong schema
    (`DataSourceResolver.cs:207-210`). Branch two deliberately leaves it empty
    (`DataSourceResolver.cs:223-225`): every entry it considered has the seed's own connection
    identity, so those entries all collapse onto `Default` and contribute their declared assemblies
    through `AddExplicitMigrationsAssemblies`, conflicts included. A test pins that the single named
    entry's assembly still reaches the `Default` source that way
    (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DataSourceResolverTests.cs:375`).
  - `CosmosDatabaseName` (`DataSourceResolver.cs:171`) is the database name entries fall back to when
    they declare none of their own, applied by `CosmosDatabaseNameOf` (`DataSourceResolver.cs:235-236`)
    and again inline while classifying entries (`DataSourceResolver.cs:262-264`).
- **Why it's built this way**: branch two cannot change an existing host's routing, because it fires
  only where the top-level value is absent (`DataSourceResolver.cs:179-185`). That is the
  additive-by-construction property the whole data-source layer is built on
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)): a host that declares
  its database only under `DataSources` gets a working `Default`, and a host that declares it the old
  way resolves exactly as it always did.
- **Where it's used**: only within [`DataSourceResolver`](#datasourceresolver). `BuildEngineMap`
  computes it (`DataSourceResolver.cs:156`) and passes it to `ClassifyEntries`
  (`DataSourceResolver.cs:157`), `RegisterDefaultSource` (`DataSourceResolver.cs:158`), and
  `RegisterNamedSource` (`DataSourceResolver.cs:162`). The two behaviors it decides are pinned by
  `DataSourceResolverTests.cs:375` and `DataSourceResolverTests.cs:396`.
- **Caveats / not-in-source**: a private nested type. It is inventoried because private nested types
  are, but nothing outside the resolver can name it, and it never leaves the constructor's call graph.

### DataSourcesSettings
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourcesSettings.cs:13` · Level 1 · class (sealed)

- **What it is**: the bound `DataSources` section as a whole, a read-only dictionary of logical source
  name to [`DataSourceEntrySettings`](#datasourceentrysettings). It is the configuration input to
  database-per-microservice routing.
- **Depends on**: [`DataSourceEntrySettings`](#datasourceentrysettings) and `DataSourceKey.DefaultName`
  from the Application layer ([`DataSourceKey`](#datasourcekey)), referenced by its fully qualified name
  `Application.Interfaces.Infrastructure.Persistence.DataSourceKey` (`DataSourcesSettings.cs:34`).
- **Concept introduced, a settings class that validates in its own constructor.** Most settings types
  here are inert bags validated by data annotations. This one is different, and the reason is stated in
  its own doc: a root-level *dictionary* section does not bind through the options pipeline, so
  `AddInfrastructure` builds the instance by hand from
  `configuration.GetSection(...).Get<Dictionary<string, DataSourceEntrySettings>>()` and registers it as
  a singleton (`DataSourcesSettings.cs:8-11`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:90-94`). With no options
  pipeline there is no `ValidateOnStart`, so the constructor becomes the fail-fast gate. `[Rubric §15,
  Best Practices & Code Quality]`: rejecting a reserved name at construction is the same guarantee
  `ValidateOnStart` would have given, implemented where the type can enforce it itself. `[Rubric §8,
  Data Architecture]`: the reserved-name rule protects a real invariant, `Default` is configured through
  the top-level `ConnectionStrings` section, and letting someone also declare a `DataSources:Default`
  entry would create two competing definitions of the same physical source.
- **Walkthrough**
  - `SectionName = "DataSources"` (`DataSourcesSettings.cs:16`).
  - The constructor takes an optional `IReadOnlyDictionary<string, DataSourceEntrySettings>?`
    (`DataSourcesSettings.cs:23`) and substitutes an empty ordinal-comparer dictionary when it is null
    (`DataSourcesSettings.cs:25`), so "no `DataSources` section" is a first-class state rather than a
    null check at every call site.
  - It then walks every key (`DataSourcesSettings.cs:27-40`) and throws `InvalidOperationException`
    twice: on a blank or whitespace name (`DataSourcesSettings.cs:29-32`), and on any name equal to
    `DataSourceKey.DefaultName` under `OrdinalIgnoreCase` (`DataSourcesSettings.cs:34-39`). The second
    message is unusually good operator guidance: it names the offending entry and tells the reader that
    the `Default` source is configured via the top-level `ConnectionStrings` section, so remove or
    rename the entry.
  - `Sources` (`DataSourcesSettings.cs:44`), the get-only dictionary the resolver reads.
- **Why it's built this way**: throwing during host construction is the earliest possible point at which
  a duplicate `Default` definition can be caught; the alternative is a routing bug that surfaces as data
  landing in the wrong database
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: constructed and registered as a singleton in `AddInfrastructure`
  (`DependencyInjection.cs:92-94`), immediately before [`DataSourceResolver`](#datasourceresolver) and
  [`EntityDataSourceRegistry`](#entitydatasourceregistry) (`DependencyInjection.cs:95-96`). It is
  consumed by the resolver's constructor (`DataSourceResolver.cs:55`, `DataSourceResolver.cs:63-71`), by
  its "is any database configured for this engine" test (`DataSourceResolver.cs:130-135`) and its
  classification pass (`DataSourceResolver.cs:251-265`), and by
  [`ConnectionStringSettingsValidator`](#connectionstringsettingsvalidator), which takes it as an
  optional constructor dependency so that a container binding the settings without `AddInfrastructure`
  still validates (`ConnectionStringSettingsValidator.cs:26-30`,
  `ConnectionStringSettingsValidator.cs:66-71`).
- **Caveats**: the key comparison for *reservation* is `OrdinalIgnoreCase`
  (`DataSourcesSettings.cs:34`) while the default backing dictionary uses `StringComparer.Ordinal`
  (`DataSourcesSettings.cs:25`). The dictionary that configuration binding actually supplies is created
  by the binder, so its comparer is not determined by this file.

### ConnectionStringSettingsValidator
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/ConnectionStringSettingsValidator.cs:30` · Level 2 · class (sealed, internal)

- **What it is**: the startup validator for [`ConnectionStringSettings`](#connectionstringsettings). It
  enforces exactly one rule: the host must be able to reach at least one database, declared either in
  the top-level `ConnectionStrings` section or on a named `DataSources` entry
  (`ConnectionStringSettingsValidator.cs:5-9`).
- **Depends on**: [`DataSourcesSettings`](#datasourcessettings) as an OPTIONAL primary-constructor
  parameter (`ConnectionStringSettingsValidator.cs:30`) and
  [`ConnectionStringSettings`](#connectionstringsettings) as the validated type
  (`ConnectionStringSettingsValidator.cs:31`). Externals: `Microsoft.Extensions.Options` for
  `IValidateOptions<T>` and `ValidateOptionsResult`.
- **Concept introduced, the rule that cannot be an attribute.** A data annotation can only see the
  object it decorates. This rule spans two independently bound configuration sections, and that is the
  whole reason the class exists. The class remarks say what it replaced: a `[Required]` on
  `ConnectionStringSettings.SQLServerConnectionString`, which encoded "SQL Server is the only engine a
  host can boot on" (`ConnectionStringSettingsValidator.cs:11-18`). That stopped being true once a small
  application could run entirely on SQLite or Cosmos, declaring its databases through the `DataSources`
  section and leaving the top-level section empty; the annotation failed such a host at startup even
  though every one of its entities resolved to a configured database. The registration comment in the
  composition root makes the same point at the call site
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:83-87`).

  `[Rubric §10, Cross-Cutting Concerns]` assesses whether configuration is validated centrally rather
  than defensively at each read. The check runs once, at boot, under `ValidateOnStart`, so no downstream
  component has to ask "did anyone configure a database".

  `[Rubric §13, Observability and Operability]` assesses whether a failure tells the operator what to
  do. `NoDatabaseConfiguredMessage` is an `internal const`
  (`ConnectionStringSettingsValidator.cs:38-43`) rather than an inline string, and it lists BOTH shapes
  (`ConnectionStrings:SQLServerConnectionString`, `ConnectionStrings:SqliteConnectionString`,
  `ConnectionStrings:CosmosConnectionString`, or `DataSources:Tickets:SqliteConnectionString`) because
  which one is missing depends on whether the host is a single-database monolith or a
  database-per-module one. The final sentence states the design decision itself: a host with no database
  at all cannot serve a request, so it fails here rather than on its first query.

  `[Rubric §8, Data Architecture]` shows up in what the rule deliberately does NOT weaken. A host with
  no connection string anywhere still fails to start (`ConnectionStringSettingsValidator.cs:20-24`).
  Silently booting one would trade a clear startup failure for an `InvalidOperationException` on the
  first query, or worse, a service reporting healthy while unable to serve a single request.
- **Walkthrough**: one constant, the interface method, and two predicates.
  - The primary constructor takes `DataSourcesSettings? dataSources = null`
    (`ConnectionStringSettingsValidator.cs:30`). The default is what makes the validator constructible
    in a container that binds the settings without calling `AddInfrastructure`
    (`ConnectionStringSettingsValidator.cs:26-29`); such a container still gets the top-level check.
  - `NoDatabaseConfiguredMessage` (`ConnectionStringSettingsValidator.cs:38-43`): `internal const`, so
    tests assert against the same string the host emits.
  - `Validate(string? name, ConnectionStringSettings options)`
    (`ConnectionStringSettingsValidator.cs:46-53`): null-guards the options, then returns `Success` if
    either predicate holds and `Fail(NoDatabaseConfiguredMessage)` otherwise. Note the short-circuit
    `||`: one database anywhere is enough.
  - `HasTopLevelConnection` (`ConnectionStringSettingsValidator.cs:56-59`): static, and uses
    `IsNullOrWhiteSpace` rather than `IsNullOrEmpty` across all three engine properties, which matters
    because [`ConnectionStringSettings`](#connectionstringsettings) initialises each of them to
    `string.Empty` rather than leaving them null (`ConnectionStringSettings.cs:18`,
    `ConnectionStringSettings.cs:24`, `ConnectionStringSettings.cs:27`).
  - `HasNamedConnection` (`ConnectionStringSettingsValidator.cs:66-71`): instance, because it reads the
    injected sources. It passes when ANY entry under `DataSources` names a database on any engine. The
    doc explains why one is enough: an entry carrying a connection string is a physical source the
    resolver registers, so the host has somewhere to read and write even with the top-level section
    empty (`ConnectionStringSettingsValidator.cs:61-65`).
- **Why it's built this way**: this is one of the two custom `IValidateOptions<T>` implementations the
  fail-fast configuration contract
  ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)) records,
  the other being [`TenancySettingsValidator`](#tenancysettingsvalidator). Relaxing the SQL Server
  requirement into a cross-section reachability rule is what made the polyglot persistence story
  ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) usable by a host that
  never touches SQL Server, without giving up the boot-time guarantee for the hosts that do.
- **Where it's used**: registered by `AddInfrastructure` with
  `TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<ConnectionStringSettings>, ConnectionStringSettingsValidator>())`
  (`DependencyInjection.cs:88-89`), immediately after the `ValidateOnStart` chain that binds the section
  (`DependencyInjection.cs:78-81`); `TryAddEnumerable`, like the tenancy validator, because two modules
  calling `AddInfrastructure` must not run the same validation twice. Covered by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Settings/ConnectionStringSettingsValidatorTests.cs`,
  which drives the validator directly for each engine and for the named-source shapes, and end to end
  through the real `ValidateOnStart` chain including the SQLite-only host.
- **Caveats**: the type is `internal`, so a consumer cannot subclass or replace it; a host needing extra
  connection-string rules registers its own additional `IValidateOptions<ConnectionStringSettings>`.

### IEntityDataSourceRegistry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/IEntityDataSourceRegistry.cs:11` · Level 2 · interface

- **What it is**: the contract for the eagerly-built registry that maps every configured entity type to
  the physical database it lives in. Four members: `GetDataSourceKey(Type)`
  (`IEntityDataSourceRegistry.cs:17`), `GetDataSourceKey(string entityFullName)`
  (`IEntityDataSourceRegistry.cs:23`), `TryGetDataSourceKey(string, out DataSourceKey)`
  (`IEntityDataSourceRegistry.cs:29`), and `GetPhysicalSourcesInUse()`
  (`IEntityDataSourceRegistry.cs:35`).
- **Depends on**: [`DataSourceKey`](#datasourcekey), the `(Engine, Name)` pair every member trades in.
- **Concept introduced, eager entity-to-database mapping.** `[Rubric §8, Data Architecture]` assesses
  whether database routing is a deliberate, discoverable design rather than an accident of query order;
  `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service
  without rewriting application code. The doc comment (`IEntityDataSourceRegistry.cs:5-10`) states why
  the interface exists at all: it replaces a legacy lazy cache that was populated as a side effect of
  EF model building, so routing decisions (unit of work, navigation classification, outbox enumeration)
  no longer depend on a model having been built first. `GetPhysicalSourcesInUse()` returns the distinct
  databases this host actually uses, which is how migrations, `EnsureCreated`, and the outbox processor
  know which databases to touch (`IEntityDataSourceRegistry.cs:31-35`). The two strict
  `GetDataSourceKey` overloads are documented to throw `InvalidOperationException` for an unregistered
  entity (`IEntityDataSourceRegistry.cs:16`, `IEntityDataSourceRegistry.cs:22`), while
  `TryGetDataSourceKey` is the non-throwing probe used where a miss is legitimate, for example when
  [`ApplicationDbContext`](#applicationdbcontext) decides whether an entity belongs in the model it is
  currently building
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:713-715`).
- **Why it's built this way**: database-per-service
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) needs every entity to
  resolve to exactly one physical source; deriving that map from configuration classes instead of from
  a built model turns a misconfiguration into a loud startup failure instead of a silent wrong-database
  query.
- **Where it's used**: implemented by [`EntityDataSourceRegistry`](#entitydatasourceregistry) and
  registered as a singleton in `AddInfrastructure`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:97`). Consumers include
  [`DbContextFactory`](#dbcontextfactory)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:41`),
  [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:35`),
  [`DataSourceService`](#datasourceservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceService.cs:11`), the
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:61`), the
  [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxCleanupService.cs:52`),
  the [`AuditTrailCleanupJob`](#audittrailcleanupjob)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailCleanupJob.cs:50`),
  both model-building passes of [`ApplicationDbContext`](#applicationdbcontext)
  (`ApplicationDbContext.cs:317`, `ApplicationDbContext.cs:705`), and the startup
  database-initialization path
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:54`).

### PhysicalDataSource
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:17` · Level 2 · record (sealed)

- **What it is**: the fully-resolved connection information for one physical database. Four positional
  members, `Key` (its engine plus name identity), `ConnectionString`, `SqlServerMigrationsAssembly?`
  and `CosmosDatabaseName` (`PhysicalDataSource.cs:17-21`), plus two members declared in the record
  body: the init-only `SqliteMigrationsAssembly?` (`PhysicalDataSource.cs:34`) and the computed
  `UsesMigrations` (`PhysicalDataSource.cs:48-54`).
- **Depends on**: [`DataSourceKey`](#datasourcekey) and, through it, [`DataSource`](#datasource).
- **Concept, a logical name resolved into a real connection.** `[Rubric §8, Data Architecture]` covers
  the step from a configured name like `DataSources:Conference` to an actual database. The record's doc
  comment (`PhysicalDataSource.cs:5-9`) explains that it is produced by
  [`IDataSourceResolver`](#idatasourceresolver) from the top-level `ConnectionStrings` section (the
  `Default` source) plus the named `DataSources` entries. Two members are engine-scoped:
  `SqlServerMigrationsAssembly` is null for non-SQL-Server engines and lets each SQL database own its
  own EF migration history (`PhysicalDataSource.cs:12-15`); `CosmosDatabaseName` is ignored for
  relational engines (`PhysicalDataSource.cs:16`). Being a positional `record` buys two things at once
  here: value equality, so two resolutions of the same source compare equal, and non-destructive
  mutation, which is exactly how per-tenant routing is implemented.
- **Walkthrough**
  - `Key` is the identity the rest of the stack routes on, and it is deliberately not recomputed when
    the connection changes. [`DbContextFactory.ResolveTenantOverride`](#dbcontextfactory) clones the
    shared source with `shared with { ConnectionString = ..., CosmosDatabaseName = ... }` and keeps the
    original key, because the key is what EF's model cache is keyed on, so swapping only the connection
    string is what lets one compiled model serve every tenant's database
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:144-169`,
    [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).
  - `ConnectionString` may legitimately be empty. Both the startup initializer and `EnsureCreatedAsync`
    treat an empty connection string as "this source is not configured in this host" and skip it rather
    than failing (`DatabaseInitializationExtensions.cs:75`, `DbContextFactory.cs:203-204`).
  - `SqliteMigrationsAssembly` (`PhysicalDataSource.cs:34`) sits in the record body rather than in the
    positional parameter list on purpose, and the comment says why
    (`PhysicalDataSource.cs:26-32`): the constructor and deconstruction shape of this shipped record
    stay exactly as they were, so a consumer that builds or deconstructs it positionally is unaffected,
    and the resolver sets the property through an object initializer instead
    (`DataSourceResolver.cs:397-399`). Only one of the two migrations-assembly properties is ever
    populated, since a physical source belongs to exactly one engine.
  - `UsesMigrations` (`PhysicalDataSource.cs:48-54`) is the switch that decides `Migrate` versus
    `EnsureCreated` for this one database. SQL Server always migrates, including the single-database
    monolith whose `Default` source names no migrations assembly at all and lets EF look next to the
    context (`PhysicalDataSource.cs:50`). SQLite migrates only once a `SqliteMigrationsAssembly` is
    configured for it (`PhysicalDataSource.cs:51`), because a SQLite source wired by hand before that
    setting existed has no migrations to apply and must keep being created outright. Cosmos never does:
    the provider has no migrations pipeline (`PhysicalDataSource.cs:52`). All four branches are pinned
    by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/PhysicalDataSourceTests.cs:21`,
    `PhysicalDataSourceTests.cs:33`, `PhysicalDataSourceTests.cs:52`, and
    `PhysicalDataSourceTests.cs:81`, including the case where a SQLite source carries only the SQL
    Server assembly and therefore still does not migrate (`PhysicalDataSourceTests.cs:69`).
- **Where it's used**: produced by [`DataSourceResolver`](#datasourceresolver) through
  `BuildPhysicalSource` (`DataSourceResolver.cs:386-399`) for both the Default source
  (`DataSourceResolver.cs:308-313`) and named ones (`DataSourceResolver.cs:353-358`), and handed back
  by `GetPhysical` (`DataSourceResolver.cs:138-143`); consumed by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory), whose `Create(DataSourceKey)` resolves it
  and whose `Create(DataSourceKey, PhysicalDataSource)` overload accepts an already-resolved one, which
  is the entry point the tenant clone uses
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:34-37`).
  [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) resolves one for `dotnet ef` commands and
  hands the same record to the design-time context
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:117`),
  and the startup initializer branches on both `ConnectionString` and `UsesMigrations`
  (`DatabaseInitializationExtensions.cs:75`, `DatabaseInitializationExtensions.cs:80`,
  `DatabaseInitializationExtensions.cs:150`).

### Snapshot
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:25` · Level 2 · record (sealed, private nested)

- **What it is**: the immutable point-in-time view of
  [`EntityDataSourceRegistry`](#entitydatasourceregistry)'s state, with three members:
  `FrozenDictionary<string, (DataSourceKey Key, Type ConfigurationType)> Entities`,
  `FrozenSet<Assembly> ScannedAssemblies`, and the precomputed
  `IReadOnlyCollection<DataSourceKey> PhysicalSources` (`EntityDataSourceRegistry.cs:25-28`).
- **Depends on**: [`DataSourceKey`](#datasourcekey); `System.Collections.Frozen` and
  `System.Reflection.Assembly` (BCL).
- **Concept introduced, the lock-free volatile-snapshot pattern.** `[Rubric §12, Performance &
  Scalability]` assesses whether hot-path reads avoid contention. The registry holds
  `private volatile Snapshot? _snapshot` (`EntityDataSourceRegistry.cs:31`) and reads it without a
  lock, relying on `volatile` for the store/load barrier so every thread sees a fully-published
  reference. Writes (the initial build and any rescan) take `Lock _rebuildLock`
  (`EntityDataSourceRegistry.cs:30`) for mutual exclusion and then swap in a brand-new `Snapshot`.
  Because `FrozenDictionary` and `FrozenSet` cannot change once built, any number of readers share one
  snapshot with zero synchronization, and a rescan never mutates the instance a reader is holding.
- **Walkthrough**
  - `Entities` maps an entity's full CLR type name to a tuple of the resolved
    [`DataSourceKey`](#datasourcekey) and the configuration type that produced it
    (`EntityDataSourceRegistry.cs:26`). The configuration type plays no part in routing; it exists so
    the duplicate-registration failure can name both conflicting configuration classes in its message
    (`EntityDataSourceRegistry.cs:145-148`).
  - `ScannedAssemblies` records which assemblies the snapshot covered, so the registry can tell a
    genuine lookup miss from a merely stale scan (`EntityDataSourceRegistry.cs:104`).
  - `PhysicalSources` is the distinct-key list computed once at build time
    (`EntityDataSourceRegistry.cs:160`). The remark on `GetPhysicalSourcesInUse` explains why it is
    materialized rather than projected per call (`EntityDataSourceRegistry.cs:74-80`): the outbox
    processor and the outbox cleanup service both ask for it on every poll cycle, and re-running
    `Select().Distinct()` over every registered entity allocated a fresh list each time, forever, on a
    loop that usually finds nothing to do.
- **Where it's used**: exclusively inside [`EntityDataSourceRegistry`](#entitydatasourceregistry):
  built by `BuildSnapshot` (`EntityDataSourceRegistry.cs:157-160`), published by `GetOrBuildSnapshot`
  (`EntityDataSourceRegistry.cs:94`) and replaced by `RescanIfAssembliesChanged`
  (`EntityDataSourceRegistry.cs:109-111`).
- **Caveats / not-in-source**: a private nested type. It appears in this inventory because private
  nested types are inventoried, but it is not part of the public API and nothing outside the registry
  can name it.

### TenantDataSourceTarget
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:13` · Level 2 · record struct (readonly)

- **What it is**: one unit of work for a background sweep, a `(DataSourceKey Source, string? TenantId)`
  pair. `TenantId` is null for the shared database and set when the target is a tenant that keeps its
  own copy of that source (`TenantDataSourceTargets.cs:6-13`).
- **Depends on**: [`DataSourceKey`](#datasourcekey).
- **Concept introduced, the sweep unit under database-per-tenant.** `[Rubric §8, Data Architecture]`
  assesses whether the storage topology is modelled explicitly rather than assumed, and `[Rubric §29,
  Resilience & Business Continuity]` assesses whether background work reaches every store it is
  responsible for. Once multi-tenancy
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) is in play, "the
  databases this host owns" is no longer the same set as "the units a background job must visit": a
  physical source can exist once as the shared database and again as one private database per tenant
  that overrides it. Making that pair a value type means the sweep loops over a flat list instead of
  nesting a tenant loop inside a source loop, and `readonly record struct` gives structural equality
  for free, which is what the tests assert against
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantDataSourceTargetTests.cs:30-32`).
- **Walkthrough**
  - The positional declaration `TenantDataSourceTarget(DataSourceKey Source, string? TenantId)`
    (`TenantDataSourceTargets.cs:13`); the null-versus-set convention on `TenantId` is the whole
    vocabulary of the type (`TenantDataSourceTargets.cs:11-12`).
  - `ToString()` (`TenantDataSourceTargets.cs:17-20`) renders the bare source name for a shared target
    and appends `" (tenant {TenantId})"` for a per-tenant one, so a log line says which of two visits to
    the same source it is describing. That rendering is pinned by a test
    (`TenantDataSourceTargetTests.cs:93-94`), which is a small `[Rubric §13, Observability &
    Operability]` point: without it, two consecutive log lines for the same source would be
    indistinguishable.
- **Why it's built this way**: consumers branch on `TenantId` to decide whether they need a fresh DI
  scope. A null target runs on the caller's own scope; a non-null one creates a scope, calls
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext)`.SetTenant(...)` before asking for the
  context, because the tenant is what routes the scoped factory to that tenant's connection string
  (`OutboxCleanupService.cs:107`, `AuditTrailCleanupJob.cs:106`).
- **Where it's used**: produced only by
  [`TenantDataSourceTargets.Expand`](#tenantdatasourcetargets) and consumed as the loop variable of
  every host-owned sweep: [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor)
  (`OutboxProcessor.cs:202`, iterated at `OutboxProcessor.cs:216`),
  [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice)
  (`OutboxCleanupService.cs:220`), [`AuditTrailCleanupJob`](#audittrailcleanupjob)
  (`AuditTrailCleanupJob.cs:83`, and as a parameter at `AuditTrailCleanupJob.cs:95` and
  `AuditTrailCleanupJob.cs:117`), and the startup initializer
  (`DatabaseInitializationExtensions.cs:138-139`).

### IDataSourceResolver
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/IDataSourceResolver.cs:15` · Level 3 · interface

- **What it is**: the contract that maps a logical data source name (from a `[UseDatabase]` attribute, a
  module namespace, or a setting such as `Outbox:DatabaseName`) to a physical
  [`DataSourceKey`](#datasourcekey), and hands back the resolved
  [`PhysicalDataSource`](#physicaldatasource) for such a key. Two members:
  `ResolveLogical(DataSource engine, string logicalName)` (`IDataSourceResolver.cs:34`) and
  `GetPhysical(DataSourceKey key)` (`IDataSourceResolver.cs:42`).
- **Depends on**: [`DataSource`](#datasource), [`DataSourceKey`](#datasourcekey),
  [`PhysicalDataSource`](#physicaldatasource).
- **Concept introduced, logical-to-physical collapse as the backward-compatibility guarantee.**
  `[Rubric §8, Data Architecture]` and `[Rubric §7, Microservices Readiness]` both apply, because
  routing is reconfigurable purely through settings. The interface comment
  (`IDataSourceResolver.cs:5-14`) states the collapse rule precisely: in a host with no `DataSources`
  configuration every logical name resolves to `Default`, yielding one DbContext per engine with an
  identical change tracker, FK constraints, transactions, and EF model to a plain single-database
  monolith. `ResolveLogical`'s contract (`IDataSourceResolver.cs:17-30`) spells out the collapse cases:
  a name with no `DataSources` entry, a name with no connection string for the engine, and a name whose
  connection equals the top-level one all fall to `DataSourceKey.Default(engine)`; entries sharing a
  connection with each other collapse to one physical source named after the alphabetically-first
  logical name.
- **Concept introduced, engine substitution.** The second paragraph of the same contract
  (`IDataSourceResolver.cs:24-29`) adds a rule that is easy to miss and load-bearing for single-engine
  hosts: a request naming an engine the host configures no connection string for anywhere, neither
  top-level nor on a named entry, is served from an engine it does configure, preferring SQL Server,
  then SQLite, then Cosmos DB. That is what lets a SQLite-only host serve the framework's own tables,
  whose engine settings all default to SQL Server. A host that configures the requested engine,
  including a polyglot host configuring several
  ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)), is never redirected.
  `GetPhysical` (`IDataSourceResolver.cs:36-42`) is the reverse lookup and is documented to throw when
  handed a key that did not come from `ResolveLogical`.
- **Why it's built this way**: the collapse is what makes "build the monolith now, extract a service
  later" a configuration change rather than a rewrite
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). One interface owns the
  rule, so no caller reimplements the defaulting logic and no caller can disagree about what `Default`
  means.
- **Where it's used**: implemented by [`DataSourceResolver`](#datasourceresolver) and registered as a
  singleton (`DependencyInjection.cs:96`); injected into
  [`EntityDataSourceRegistry`](#entitydatasourceregistry) (`EntityDataSourceRegistry.cs:23`) to resolve
  each entity's derived logical name, into [`PhysicalDbContextFactory`](#physicaldbcontextfactory) and
  [`DbContextFactory`](#dbcontextfactory) to open connections (`PhysicalDbContextFactory.cs:18`,
  `DbContextFactory.cs:42`), into the inbox store and both event buses so each can locate its own
  database ([`EfInboxStore`](group-04-events-outbox.md#efinboxstore)
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:40`,
  [`InProcessEventBus`](group-04-events-outbox.md#inprocesseventbus)
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/InProcessEventBus.cs:36`,
  [`BrokerEventBus`](group-04-events-outbox.md#brokereventbus)
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/BrokerEventBus.cs:34`), into
  [`AuditTrailReader`](#audittrailreader)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailReader.cs:36`)
  and [`ScheduledJobRunner`](group-14-module-system-composition.md#scheduledjobrunner)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:42`), and
  optionally into [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator),
  which uses `ResolveLogical` to check that a tenant override is keyed by a name that actually
  round-trips as a physical source
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:23`,
  `TenancySettingsValidator.cs:119`).

### DataSourceService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceService.cs:11` · Level 3 · class (public sealed)

- **What it is**: the Application-facing facade over [`IEntityDataSourceRegistry`](#ientitydatasourceregistry). It answers two questions: which physical data source (engine plus database) does this entity live in, and can these two entities be joined with an EF `Include` (`DataSourceService.cs:5-11`).
- **Depends on**: [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) as its single primary-constructor parameter (`DataSourceService.cs:11`), [`IDataSourceService`](#idatasourceservice) as the contract it implements, and the [`DataSourceKey`](#datasourcekey) and [`DataSource`](#datasource) types it returns.
- **Concept introduced, routing as a first-class query.** `[Rubric §7, Microservices Readiness]` assesses whether "where does this entity actually live" is answerable at runtime rather than being baked into code, and `[Rubric §3, Clean Architecture]` assesses whether the Application layer can ask that question without referencing EF. Database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) means two entities written in the same module's code may or may not share a physical database depending on how the deployment is configured. Every consumer that needs to make a decision about that (which `DbContext` to open, whether a navigation can be eager-loaded or must go through a populator) asks this service. The class doc records an important property of the current design (`DataSourceService.cs:8-10`): the registry is built eagerly from configuration assemblies, so resolution no longer depends on an EF model having been built first, which is what makes it safe to consult from the Application layer at any point in startup.
- **Walkthrough**
  - The four resolution members (`DataSourceService.cs:14-23`) are pure forwarders to the registry, in two pairs: `GetDataSourceKey` by `Type` and by full type name, and `GetDataSource` by the same two, each projecting `.Engine` off the resolved key. The name-based overloads exist because a caller holding only a metadata string (an EF entity type name, a message payload's type name) should not have to resolve a `Type` first.
  - `HaveIncludeSupport(first, second)` (`DataSourceService.cs:30-31`) is the whole classification rule in one expression: the two keys must be equal **and** the engine must not be `DataSource.CosmosDB`. The remarks at `:27-30` state both halves: EF `Include` requires both entities in the same physical database on a relational engine, and Cosmos has no cross-document include.
  - `HaveIncludeSupport(firstEntityFullName, secondEntityFullName)` (`DataSourceService.cs:34-37`) is the name-based overload, and it uses `TryGetDataSourceKey` rather than the throwing form: an entity the registry does not know about yields `false`, which degrades to "use the populator path" rather than to an exception during navigation classification.
- **Why it's built this way**: putting the include decision here rather than inside a repository is what lets [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) classify each navigation once and route it to either an EF `Include` or an `INavigationPopulator` ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)) without knowing anything about deployment topology. The engine carve-out keeps the same code correct on a non-relational store ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). It is registered as a singleton (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:66`), which is safe because both the service and the registry behind it are immutable after construction.
- **Where it's used**: [`UnitOfWork`](#unitofwork) resolves an entity's key before choosing a context (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13`, doc at `:29`); [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) uses it for navigation classification (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20`); in MMCA.Store, `InventoryAllocationService` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Services/InventoryAllocationService.cs:35`) and `ProductImageStorageService` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Services/ProductImageStorageService.cs:28`) both resolve a key before opening the right context. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceTests.cs` and `.../DataSourceServiceAdditionalTests.cs`.

### DataSourceResolver
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:15` · Level 4 · class (sealed, partial)

- **What it is**: the singleton implementation of [`IDataSourceResolver`](#idatasourceresolver). It
  builds the logical-to-physical map once at construction from the connection-string settings and the
  named `DataSources` entries, validates migrations-assembly conflicts, works out which engine to
  substitute for engines the host does not configure, and then serves both lookups from in-memory
  dictionaries.
- **Depends on**: [`DataSource`](#datasource), [`DataSourceKey`](#datasourcekey),
  [`PhysicalDataSource`](#physicaldatasource), [`IDataSourceResolver`](#idatasourceresolver), its own
  nested [`DefaultSeed`](#defaultseed),
  [`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings) (taken as
  `IOptions<T>`), [`DataSourcesSettings`](group-07-persistence-ef-core.md#datasourcessettings) and
  [`DataSourceEntrySettings`](group-07-persistence-ef-core.md#datasourceentrysettings);
  `ILogger<T>` and the `[LoggerMessage]` source generator, which is why the class is `partial`.
- **Concept introduced, eager and validated data-source resolution.** `[Rubric §8, Data Architecture]`
  (deliberate multi-database routing) and `[Rubric §7, Microservices Readiness]`
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), database-per-service).
  The resolver realizes the collapse rule described on
  [`IDataSourceResolver`](#idatasourceresolver). Two guardrails are worth calling out. First,
  conflicting migrations-assembly declarations on logical names that collapse to the same physical
  database throw at construction (`DataSourceResolver.cs:429-435`), a loud fail-fast rather than a
  silent pick. Second, `[Rubric §13, Observability & Operability]` shows up in the two source-generated
  log methods: `LogMigrationsAssemblyFallback` (`DataSourceResolver.cs:470-471`) warns when a named SQL
  Server source has no dedicated migrations assembly and therefore falls back to another database's,
  whose snapshot describes a different schema, and `LogSubstituteEngine`
  (`DataSourceResolver.cs:467-468`) states at startup that requests for an unconfigured engine are being
  served from another one.
- **Walkthrough**
  - State (`DataSourceResolver.cs:17-41`): `AllEngines` is the build order, CosmosDB, Sqlite, SQLServer
    (`DataSourceResolver.cs:17`); `EnginePreference` is the substitution order, SQL Server, SQLite,
    Cosmos DB, relational first because every table the framework owns is relational
    (`DataSourceResolver.cs:19-25`). The lookups are `_logicalToPhysical`, keyed by
    `(engine, logical name)` (`DataSourceResolver.cs:28`), and `_physicalSources`, keyed by
    [`DataSourceKey`](#datasourcekey) (`DataSourceResolver.cs:31`). `_configuredEngines`
    (`DataSourceResolver.cs:34`) and `_substituteEngine` (`DataSourceResolver.cs:41`) carry the
    substitution decision.
  - Constructor (`DataSourceResolver.cs:53-85`): null-guards its two settings arguments
    (`DataSourceResolver.cs:58-59`), then loops all three engines calling `BuildEngineMap` and recording
    which engines carry a connection string anywhere (`DataSourceResolver.cs:63-71`). It picks the
    substitute as the first configured engine in preference order, or null when the host configures no
    database at all (`DataSourceResolver.cs:73-76`), and logs once when the substitute is not SQL Server
    (`DataSourceResolver.cs:78-84`). Every field is written only here, which is what makes the singleton
    safe to share without locking.
  - `ResolveLogical` (`DataSourceResolver.cs:88-102`): substitutes the engine first
    (`DataSourceResolver.cs:92`), then short-circuits the `Default` name case-insensitively
    (`DataSourceResolver.cs:94-97`), then does a dictionary lookup whose miss returns
    `DataSourceKey.Default(effectiveEngine)` (`DataSourceResolver.cs:99-101`), which is the monolith
    default.
  - `SubstituteUnconfiguredEngine` (`DataSourceResolver.cs:123-124`) is one line, and its doc comment
    (`DataSourceResolver.cs:104-120`) carries the failure it removes: every engine choice the framework
    makes for its own tables comes from a setting defaulting to SQL Server (`Outbox:DataSource`,
    `Scheduler:DataSource`, `AuditTrail:DataSource`), and honoring that literally in a SQLite-only host
    handed those components a source with an empty connection string, so their first query failed with
    "The ConnectionString property has not been initialized". `HasAnyConnectionString`
    (`DataSourceResolver.cs:130-135`) is what decides "configured", and it deliberately looks at named
    entries as well as the top-level section.
  - `GetPhysical` (`DataSourceResolver.cs:138-143`): a `_physicalSources` lookup that throws with an
    actionable message when the key was not produced by `ResolveLogical`.
  - `BuildEngineMap` (`DataSourceResolver.cs:150-164`): computes the [`DefaultSeed`](#defaultseed)
    (`DataSourceResolver.cs:156`), splits the engine's named entries with `ClassifyEntries`
    (`DataSourceResolver.cs:157`), then registers the Default source and one named source per group
    (`DataSourceResolver.cs:158-163`).
  - `ClassifyEntries` (`DataSourceResolver.cs:242-283`): computes a per-connection identity string via
    `GetIdentity` (`DataSourceResolver.cs:446-449`), where a Cosmos identity appends the database name
    because one account hosts many databases, relational engines use the connection string alone, and
    the comparison is ordinal, so semantically-equal-but-textually-different connection strings
    deliberately do not collapse. Entries with no connection string for the engine are skipped entirely
    (`DataSourceResolver.cs:255-260`), because `ResolveLogical` already defaults on a map miss; entries
    matching the seed's identity go to the collapsed list (`DataSourceResolver.cs:267-271`) and the rest
    are grouped by identity (`DataSourceResolver.cs:273-280`).
  - `RegisterDefaultSource` (`DataSourceResolver.cs:289-319`): registers the `Default` key for the
    engine, letting entries that collapsed onto it contribute an explicit migrations assembly alongside
    the seed's own (`DataSourceResolver.cs:296-306`), and maps each collapsed logical name onto that key
    (`DataSourceResolver.cs:315-318`).
  - `RegisterNamedSource` (`DataSourceResolver.cs:325-364`): names the physical key after the
    alphabetically-first member (`Order(...).First()`, `DataSourceResolver.cs:331`) so routing is
    deterministic regardless of configuration key order, then warns and falls back when a SQL Server
    source declares no migrations assembly of its own (`DataSourceResolver.cs:338-346`). The group's
    Cosmos database name comes from the canonical entry, falling back to the seed
    (`DataSourceResolver.cs:348-351`).
  - `BuildPhysicalSource` (`DataSourceResolver.cs:386-399`): places the resolved migrations assembly in
    the slot of the engine it belongs to, `SqlServerMigrationsAssembly` positionally for SQL Server and
    `SqliteMigrationsAssembly` through the object initializer for SQLite, which is what stops a SQL
    Server assembly from being handed to `UseSqlite` (`DataSourceResolver.cs:381-385`).
  - `ResolveMigrationsAssembly` (`DataSourceResolver.cs:417-438`): returns null for Cosmos and when no
    explicit value exists (`DataSourceResolver.cs:422-425`), and throws when logical names sharing a
    database declare conflicting assemblies, naming the offending setting per engine and every
    declaration in the message (`DataSourceResolver.cs:427-435`). `GetMigrationsAssembly`
    (`DataSourceResolver.cs:405-411`) is the per-engine reader that feeds it: SQLite and SQL Server have
    their own entry settings, Cosmos migrates nothing.
- **Why it's built this way**: resolving eagerly at construction turns a misconfiguration into a startup
  failure rather than a mid-request surprise, and the deterministic canonical-name rule keeps routing
  stable across configuration orderings
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The ordinal identity
  comparison is the conservative choice: collapsing two connection strings that only look different
  would silently merge two databases. Engine substitution is scoped the same conservative way, since it
  can only fire for a request that could not have been served at all
  (`DataSourceResolver.cs:116-119`).
- **Where it's used**: registered as the singleton [`IDataSourceResolver`](#idatasourceresolver)
  (`DependencyInjection.cs:96`); consumed by [`EntityDataSourceRegistry`](#entitydatasourceregistry),
  the context factories, and [`DesignTimeDbContextHelper`](#designtimedbcontexthelper), which constructs
  its own instance for `dotnet ef` commands and registers it in a hand-built container
  (`DesignTimeDbContextHelper.cs:108-111`, `DesignTimeDbContextHelper.cs:157`). Its rules are pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DataSourceResolverTests.cs:12`,
  including the alphabetically-first canonical name (`DataSourceResolverTests.cs:84`), the two Cosmos
  cases where the same account with a different database stays distinct while the same database
  collapses (`DataSourceResolverTests.cs:99`, `DataSourceResolverTests.cs:118`), the SQLite-only host
  being served the framework's SQL Server default from SQLite (`DataSourceResolverTests.cs:336`), the
  polyglot host routing each engine to itself (`DataSourceResolverTests.cs:425`), the SQL-Server-only
  host being unchanged (`DataSourceResolverTests.cs:414`), and the host with no database at all passing
  the engine straight through (`DataSourceResolverTests.cs:480`).

### EntityDataSourceRegistry
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21` · Level 5 · class (sealed)

- **What it is**: the singleton implementation of
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry). It reflects over the configuration
  assemblies, finds every entity type configuration, derives each entity's physical database from the
  configuration class's attributes and the entity's namespace, and freezes the result into a lock-free
  lookup that it rescans lazily when new assemblies appear.
- **Depends on**: [`DataSourceKey`](#datasourcekey),
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry),
  [`IDataSourceResolver`](#idatasourceresolver),
  [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype),
  [`NamespaceConventions`](#namespaceconventions),
  [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute),
  [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), and its own nested
  [`Snapshot`](#snapshot); `System.Reflection`, `System.Collections.Frozen`, and `System.Threading.Lock`
  (BCL).
- **Concept introduced, deriving routing from configuration classes rather than from the EF model.**
  `[Rubric §8, Data Architecture]`
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html): an entity lives in
  exactly one database) and `[Rubric §15, Best Practices & Code Quality]` (fail fast on an ambiguous
  configuration). The doc comment (`EntityDataSourceRegistry.cs:8-19`) states the design: the map is
  derived from configuration classes, so it exists before any model is built; it is built lazily on
  first access and rescanned once on a lookup miss to pick up module assemblies loaded later; and
  duplicate registrations of one entity are tolerated when they agree on the physical source and
  rejected when they conflict.
- **Walkthrough**
  - Primary constructor (`EntityDataSourceRegistry.cs:21-23`) takes the
    [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) that decides which
    assemblies are scanned and the [`IDataSourceResolver`](#idatasourceresolver) that performs the final
    collapse. `_rebuildLock` (`EntityDataSourceRegistry.cs:30`) and the `volatile _snapshot`
    (`EntityDataSourceRegistry.cs:31`) implement the pattern taught under [`Snapshot`](#snapshot).
  - `GetDataSourceKey(Type)` (`EntityDataSourceRegistry.cs:34-38`) null-guards and forwards to the
    string overload via `FullName`; `GetDataSourceKey(string)` (`EntityDataSourceRegistry.cs:41-47`) is
    `TryGetDataSourceKey` plus a throw whose message names the exact remedy, adding an
    `EntityTypeConfigurationSQLServer/Cosmos/Sqlite` for the entity in a discovered configuration
    assembly.
  - `TryGetDataSourceKey` (`EntityDataSourceRegistry.cs:50-72`): probes the current snapshot; on a miss
    it calls `RescanIfAssembliesChanged` once (`EntityDataSourceRegistry.cs:63`) and retries, then
    returns `default` and false. The two-step shape keeps the common hit path entirely off the lock.
  - `GetPhysicalSourcesInUse` (`EntityDataSourceRegistry.cs:81-82`): returns the snapshot's precomputed
    `PhysicalSources`, which is how migrations, `EnsureCreated`, and outbox draining enumerate this
    host's databases without allocating per call.
  - `GetOrBuildSnapshot` (`EntityDataSourceRegistry.cs:84-96`) reads the volatile field first and only
    takes the lock when it is null; `RescanIfAssembliesChanged` (`EntityDataSourceRegistry.cs:98-113`)
    rebuilds only when the provider reports assemblies not already in `ScannedAssemblies`
    (`EntityDataSourceRegistry.cs:103-107`), so a genuinely unknown entity costs one set comparison, not
    one rescan per lookup.
  - `BuildSnapshot` (`EntityDataSourceRegistry.cs:115-161`): for every loadable type in every
    configuration assembly it skips abstract and open-generic types
    (`EntityDataSourceRegistry.cs:122-125`), finds the closed `IEntityTypeConfigurationBase<,>`
    interface (`EntityDataSourceRegistry.cs:127-132`), takes the entity type from the first generic
    argument (`EntityDataSourceRegistry.cs:134`), and calls `DeriveDataSourceKey`. A second
    configuration registering the same entity against a different key throws with a message naming both
    configuration classes and both keys (`EntityDataSourceRegistry.cs:141-152`); an agreeing duplicate
    is simply ignored. The frozen dictionary, the scanned-assembly set, and the distinct
    physical-source list are built together at the end (`EntityDataSourceRegistry.cs:157-160`).
  - `DeriveDataSourceKey` (`EntityDataSourceRegistry.cs:172-185`): reads the engine from
    [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and returns
    null when it is absent (`EntityDataSourceRegistry.cs:174-178`), deliberately skipping configurations
    that implement a provider interface directly instead of deriving from the attributed base classes.
    It then resolves the logical name in priority order,
    [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) first, then
    [`NamespaceConventions.GetModuleName`](#namespaceconventions), then `DataSourceKey.DefaultName`
    (`EntityDataSourceRegistry.cs:180-182`), and delegates the collapse to
    [`IDataSourceResolver.ResolveLogical`](#idatasourceresolver) (`EntityDataSourceRegistry.cs:184`).
  - `GetLoadableTypes` (`EntityDataSourceRegistry.cs:190-200`): wraps `assembly.GetTypes()` and
    tolerates `ReflectionTypeLoadException` by keeping the types that did load, mirroring module
    discovery, so a partially-loaded assembly does not abort the whole scan.
- **Why it's built this way**: building from configuration classes at startup rather than per query
  means a missing or conflicting configuration surfaces early, which matters most in a multi-database
  system where the alternative failure mode is a silent read against the wrong database. The skip for
  configurations without `[UseDataSource]` is documented as matching legacy behavior
  (`EntityDataSourceRegistry.cs:168-170`): those entities land in the Default model but are not routable
  through the unit of work, which is the same fallback
  [`ApplicationDbContext`](#applicationdbcontext) applies when filtering configurations into a model
  (`ApplicationDbContext.cs:700-715`).
- **Where it's used**: registered as the singleton
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`DependencyInjection.cs:97`) and rebuilt by
  hand for design-time commands (`DesignTimeDbContextHelper.cs:112`,
  `DesignTimeDbContextHelper.cs:158`); consumed by
  [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention),
  [`DataSourceService`](#datasourceservice), [`DbContextFactory`](#dbcontextfactory), both
  [`ApplicationDbContext`](#applicationdbcontext) model passes (`ApplicationDbContext.cs:317`,
  `ApplicationDbContext.cs:705`), and the outbox, audit-trail and migrations enumerations. Its behavior
  is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:15`,
  covering the agreeing and conflicting duplicate cases (`EntityDataSourceRegistryTests.cs:94`,
  `EntityDataSourceRegistryTests.cs:104`), the attribute-less skip
  (`EntityDataSourceRegistryTests.cs:121`), the unknown-entity throw and probe
  (`EntityDataSourceRegistryTests.cs:130`, `EntityDataSourceRegistryTests.cs:140`), and the distinct
  source enumeration (`EntityDataSourceRegistryTests.cs:149`).

### TenantDataSourceTargets
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DataSources` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:40` · Level 5 · class (static)

- **What it is**: a one-method static class that expands the physical data sources a background service
  owns into the [`TenantDataSourceTarget`](#tenantdatasourcetarget) units it must actually visit once
  database-per-tenant is configured (`TenantDataSourceTargets.cs:23-49`).
- **Depends on**: [`DataSourceKey`](#datasourcekey),
  [`TenantDataSourceTarget`](#tenantdatasourcetarget),
  [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) with its nested
  [`TenantEntrySettings`](group-07-persistence-ef-core.md#tenantentrysettings) and
  [`TenantDataSourceOverrideSettings`](group-07-persistence-ef-core.md#tenantdatasourceoverridesettings),
  and [`TenancySettingsValidator.ConnectionStringFor`](group-07-persistence-ef-core.md#tenancysettingsvalidator)
  for the per-engine connection-string lookup
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:122`).
- **Concept introduced, why a per-tenant database is invisible to a shared sweep.** `[Rubric §8, Data
  Architecture]` and `[Rubric §29, Resilience & Business Continuity]` both apply, and the class remarks
  (`TenantDataSourceTargets.cs:27-39`) carry the reasoning. A shared-schema tenant needs nothing here:
  its rows live in the shared database that the null-tenant target already drains, and the outbox
  deliberately has no tenant column precisely so that adopting tenancy never forces a migration on an
  existing consumer. A tenant with its own database is the opposite case: its outbox rows and its
  audit-trail rows sit in a database nothing else opens, so without an extra target its events would sit
  undelivered and its rows unpurged forever. Each such tenant therefore contributes one extra target per
  source it overrides, and the sweep sets the tenant on its scope before asking for the context, which
  is what routes that context at the tenant's connection string
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).
- **Walkthrough**
  - `Expand(IEnumerable<DataSourceKey> sources, TenancySettings? settings)`
    (`TenantDataSourceTargets.cs:49-51`) takes a nullable settings argument, because a host that never
    registered tenancy passes null and must still get a usable list.
  - It materializes the source sequence only when it is not already a collection
    (`sources as IReadOnlyCollection<DataSourceKey> ?? [.. sources]`,
    `TenantDataSourceTargets.cs:53`) and sizes the result list from that count
    (`TenantDataSourceTargets.cs:54`), since the common no-tenancy case produces exactly one target per
    source.
  - Pass one adds the shared target for every source, `new TenantDataSourceTarget(source, null)`
    (`TenantDataSourceTargets.cs:56-59`). This is the entire result when settings are null or declare no
    tenants (`TenantDataSourceTargets.cs:61-64`), which is the ordering guarantee the callers rely on:
    shared targets always come first.
  - Pass two walks the declared tenants and, for each, every source the caller owns
    (`TenantDataSourceTargets.cs:66-76`). A pair is added only when the tenant declares an override
    keyed by that physical source name and that override carries a non-blank connection string for that
    source's engine (`TenantDataSourceTargets.cs:70-71`). Both halves of that test matter: an override
    for a source this host does not own adds nothing, and an override that only declares, say, a SQLite
    connection adds nothing for a SQL Server source. Both cases have their own test
    (`TenantDataSourceTargetTests.cs:64`, `TenantDataSourceTargetTests.cs:78`).
- **Why it's built this way**: it is a pure function over settings, with no DI and no I/O, so every
  sweep can share one expansion rule and each can unit-test its own target list without a database
  (`TenantDataSourceTargetTests.cs:20`). Keeping the tenant loop outside the sweeps also keeps the
  tenancy feature additive: a host with no `Tenancy` section gets byte-identical behavior to the
  pre-tenancy code path (`TenantDataSourceTargetTests.cs:26`, `TenantDataSourceTargetTests.cs:36`).
- **Where it's used**: by all four host-owned sweeps:
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) (`OutboxProcessor.cs:202`),
  [`OutboxCleanupService`](group-04-events-outbox.md#outboxcleanupservice)
  (`OutboxCleanupService.cs:220`), [`AuditTrailCleanupJob`](#audittrailcleanupjob)
  (`AuditTrailCleanupJob.cs:83`), and
  [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions),
  which filters the expansion down to `t.TenantId is not null` because the shared sources were already
  initialized in the pass above it (`DatabaseInitializationExtensions.cs:138-139`). Two of the sweeps
  are pinned against the same expansion in tests (`TenantDataSourceTargetTests.cs:100`,
  `TenantDataSourceTargetTests.cs:118`).
- **Caveats / not-in-source**: the expansion is driven purely by declared configuration. A tenant whose
  database exists but is not declared under `Tenancy:Tenants` produces no target, and nothing in this
  class detects that; the round-trip check that a source name is a real physical name lives in
  [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator), not
  here.

### DetectChangesScope
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:243` · Level 0 · struct (private readonly, nested)

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
  snapshot comparisons where one suffices (`ApplicationDbContext.cs:216-223`). Turning detection off
  for the duration of the save is the optimization; a `using`-scoped struct is what makes turning it
  back on unforgettable, including on the exception path.
- **Walkthrough**: the primary constructor `DetectChangesScope(ChangeTracker changeTracker, bool
  previousSetting)` (`ApplicationDbContext.cs:243`) captures the tracker and the flag value that was in
  force before suppression. `Dispose()` (`ApplicationDbContext.cs:245`) is a single expression-bodied
  assignment that writes `previousSetting` back onto `changeTracker.AutoDetectChangesEnabled`. It is
  created only by `DetectChangesOnce()` (`ApplicationDbContext.cs:233-241`), which reads the current
  setting (`:235`), calls `ChangeTracker.DetectChanges()` once when detection was on (`:236-237`),
  sets the flag to `false` (`:239`), and hands back the scope (`:240`).
- **Why it's built this way**: `readonly struct` means no heap allocation on a path that runs on every
  save, and `private` keeps the mechanism invisible to callers. Restoring the *previous* value rather
  than hardcoding `true` is the load-bearing detail: a caller that had deliberately disabled
  auto-detect keeps its choice and never gets an unexpected detection pass on the way out
  (`ApplicationDbContext.cs:228-230`). Suppressing the remaining passes is safe because everything the
  interceptors do afterwards bypasses detection anyway: the audit interceptor writes through
  `entry.Property(...).CurrentValue` (`AuditSaveChangesInterceptor.cs:57-60`) and the domain-event
  interceptor adds outbox rows through `Add`, both of which take effect on the entry immediately.
- **Where it's used**: both save overrides that EF funnels through, `SaveChangesAsync(bool,
  CancellationToken)` (`ApplicationDbContext.cs:173-179`) and `SaveChanges(bool)`
  (`ApplicationDbContext.cs:206-210`), open one with `using var detection = DetectChangesOnce()`. The
  behavior is pinned by `SaveChangeDetectionTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Interceptors/SaveChangeDetectionTests.cs:31`,
  `:47`, `:64`, `:78`, `:90`), which asserts detection runs exactly once, that an untracked property
  edit still persists, that audit stamps still land, that a caller's explicit `false` survives the
  save, and that a default context is left with detection enabled for the next caller.
- **Caveats / not-in-source**: the remarks name **two** tracker-scanning interceptors
  ([`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor) at
  `AuditSaveChangesInterceptor.cs:52` and
  [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) at
  `DomainEventSaveChangesInterceptor.cs:221`), which are the two that are always registered. Two
  optional interceptors enumerate the tracker as well when a host opts into them
  ([`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor) at
  `TenantSaveChangesInterceptor.cs:74` and
  [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor) at
  `AuditTrailSaveChangesInterceptor.cs:197`), so the suppression saves strictly more than the comment
  claims; the comment is narrower than the code, not wrong about the mechanism.

### IdentityInsertGroup
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:406` · Level 0 · record (private sealed, nested)

- **What it is**: a three-member private record nested in [`DbContextFactory`](#dbcontextfactory),
  `(string Schema, string Table, List<EntityEntry> Entries)` (`DbContextFactory.cs:406`). It names one
  batch of pending inserts that all target the same table and all carry explicit identity values, which
  is exactly the unit SQL Server's `SET IDENTITY_INSERT` operates on.
- **Depends on**: EF Core's `EntityEntry`, and nothing else.
- **Concept introduced, importing rows that already have ids.** `[Rubric §8, Data Architecture]`
  (assesses whether persistence mechanics are deliberate): normally a database-generated identity
  column means the application never supplies the id. An import from an external system (ADC's
  Sessionize refresh) must preserve the source's ids, and SQL Server only allows that with
  `SET IDENTITY_INSERT <table> ON`, one table at a time per session (`DbContextFactory.cs:279-284`).
  Grouping the affected entries by table is what turns that constraint into a loop.
- **Walkthrough**:
  - **`GetIdentityInsertGroups`** (`DbContextFactory.cs:363-404`) builds the list: it walks the change
    tracker for `Added` entries (`:366-369`), skips anything without a single-property primary key
    (`:372-374`), keeps only properties whose SQL Server value-generation strategy is
    `IdentityColumn` (`:376-381`), and then skips entries whose id is still an EF **temporary** value
    (`:386-387`), since a temporary value means the application did not set one. Survivors are bucketed
    by `(schema, table)` with `"dbo"` as the schema fallback (`:389-402`).
  - **`SaveWithIdentityInsertAsync`** (`DbContextFactory.cs:285-357`) consumes the groups: with none it
    falls back to a plain save (`:290-291`); otherwise, per group, it flips every `Added` entry
    belonging to the **other** groups to `Unchanged` so this round's batch touches one table only
    (`:300-306`), runs `SET IDENTITY_INSERT [schema].[table] ON`, saves, and turns it `OFF` in a
    `finally` (`:324-337`), then restores the hidden entries' states in an outer `finally` (`:340-346`).
    Any remaining changes get a final ordinary save (`:350-353`).
  - **Capture exclusion** (`DbContextFactory.cs:315-317`, `:342`): before each round it calls
    [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)`.BeginCaptureExclusion`
    with exactly the hidden entities and ends the exclusion afterwards. The comment (`:308-313`)
    explains the bug this prevents: capture serializes an aggregate's events to the outbox and clears
    them, so without the exclusion a row written a round later would have published its event a round
    early. It names the hidden entries explicitly rather than filtering by state, because "skip every
    `Unchanged` aggregate" would also drop events legitimately raised on an already-saved aggregate,
    which is how the identity module publishes registration events.
- **Why it's built this way**: the whole dance is confined to the SQL Server path of one private
  method, guarded by an opt-in flag, so the normal save path pays nothing. The raw SQL is covered by a
  justified `CA2100` suppression (`DbContextFactory.cs:224-225`) and an `S2077` pragma (`:323`,
  `:338`), both stating that schema and table names come from EF model metadata rather than user input,
  and `SET IDENTITY_INSERT` cannot take a parameterized identifier.
- **Where it's used**: only inside [`DbContextFactory`](#dbcontextfactory), reached when a caller has
  invoked `RequestIdentityInsert()` (`:276`) before the save, which the save path reads and immediately
  clears (`:227-228`). The one first-party caller is ADC's Sessionize refresh, which signals the unit of
  work before saving imported entities
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:139`),
  through [`IUnitOfWork`](#iunitofwork)`.RequestIdentityInsert`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:76`).

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
  (`ApplicationDbContext.cs:709-715`), which passes the engine's configuration interface (for example
  [`IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlservertentity-tidentifiertype))
  and a filter that matches each entity's registry-resolved [`DataSourceKey`](#datasourcekey).

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
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:63-66`
  with five retries and a 10 second ceiling) classifies most commit-phase errors (timeouts, dropped
  connections) as transient, and EF decides retriability by walking an exception's **whole** inner
  chain, so any wrapper carrying the transient error would still be retried, re-running every write of
  an operation whose commit may already be durable, including its outbox rows
  (`TransactionCommitAmbiguousException.cs:8-14`, `DbContextFactory.cs:537-540`). That is why the
  commit failure is returned rather than thrown from `RunTransactionalAttemptAsync` and `TryCommit`
  (`DbContextFactory.cs:550-554`, `:572-574`, `:617-620`) and only converted into this exception
  **past** the strategy (`DbContextFactory.cs:541-542`). Second, semantically: "it failed" and "nobody
  can say whether it failed" call for different recovery, so the type itself is the signal.
- **Concept introduced, naming the partial outcome.** `[Rubric §13, Observability & Operability]`
  (assesses whether an operator can tell what actually happened from what the system reports): commits
  across several physical sources are sequential and independent, so a failure part-way through leaves
  earlier sources durable. Rather than leave that inferable only from timing, the exception carries
  three lists that partition every source the failed commit touched.
- **Walkthrough**:
  - **`DefaultMessage`** (`TransactionCommitAmbiguousException.cs:24-26`): states both halves, the
    unknown durability and the deliberate non-retry.
  - **Five constructors** (`:29-69`): the parameterless, `(string)` and `(string, Exception)` standard
    set; `(Exception innerException)` (`:45-46`), which pairs the provider's failure with the default
    message; and the four-argument diagnostic one (`:57-69`), which additionally takes the committed,
    ambiguous and rolled-back sources and composes them into the message. That last one is the one
    [`DbContextFactory`](#dbcontextfactory) actually constructs (`DbContextFactory.cs:647`); it
    null-coalesces both lists to empty (`:63`, `:66-68`) so a caller passing `null` gets an empty group
    rather than a second exception.
  - **`CommittedSources`** (`:76`), **`AmbiguousSource`** (`:85`), **`RolledBackSources`** (`:93`): the
    three outcome groups, each with doc comments stating what a reader may conclude. Committed sources
    are durable, so the ambiguity is a *partial* commit and reconciliation means replaying only what
    the remaining sources owed (`:71-75`). The ambiguous source alone is unknowable, and with a single
    transactional source (the case every host runs today) it **is** the whole outcome while the other
    two groups are empty (`:78-84`). Rolled-back sources wrote nothing that survives, with
    "best-effort" spelled out literally: a rollback that itself throws is swallowed and the transaction
    abandoned to the server (`:87-92`).
  - **`ComposeMessage`** (`:99-118`): builds at most three clauses, skipping any empty group, and
    appends `" Per-source outcome: ..."` to the default text; with nothing to report it returns the
    default message unchanged (`:115-117`), so a single-source failure reads as one clause rather than
    three.
- **Why it's built this way, and what a caller does about it**: the exception's own doc comment assigns
  recovery to the caller (`TransactionCommitAmbiguousException.cs:15-20`). An API request marked
  [`[Idempotent]`](group-12-api-hosting-mapping.md#idempotentattribute) replays safely; whatever the
  transaction wrote to the outbox is delivered by the
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) if the commit did land
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)); and the deferred
  in-process dispatch is dropped, so no handler acts on state that may not exist
  (`DbContextFactory.cs:663-684`). The source comment records that a witness row (a marker written
  inside each source's transaction that a replay could read) would close the multi-source gap entirely,
  and that it is deliberately not built, because the single transactional source every host runs today
  needs none (`DbContextFactory.cs:488-498`).
- **Where it's used**: thrown at `DbContextFactory.cs:542`, constructed at `:646`; pinned by
  `DbContextFactoryCommitAmbiguityTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/DbContextFactoryCommitAmbiguityTests.cs:73`,
  `:105`, `:129`, `:149`, `:168`), which drives a context whose execution strategy retries on **any**
  exception and asserts the operation runs exactly once, that nothing is dispatched in-process, that
  the transaction is abandoned, that an ordinary success path still commits and flushes, that a failure
  *inside* the operation is still retried, and that a second-source commit failure reports each source's
  outcome.
- **Caveats / not-in-source**: nothing in the framework catches this type. Whether a host's exception
  middleware maps it to a specific HTTP status is Not determinable from source: no first-party handler
  references it outside the throw site and its tests.

### ValReturn<T>
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:125` · Level 0 · class (internal sealed, nested)

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
  (`ApplicationDbContext.cs:128`). [`ApplicationDbContext.OnModelCreating`](#applicationdbcontext)
  registers four closed forms as keyless views with `HasNoKey().ToView(null)`
  (`ApplicationDbContext.cs:338-341`), so they map to no table and exist only to shape raw-query
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
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:41` · Level 11 · class (abstract)

- **What it is**: the single abstract `DbContext` base that every engine-specific context
  ([`SQLServerDbContext`](#sqlserverdbcontext), [`CosmosDbContext`](#cosmosdbcontext),
  [`SqliteDbContext`](#sqlitedbcontext)) inherits. One instance exists per **physical database**: the
  same class is instantiated multiple times, each carrying a different
  [`PhysicalDataSource`](#physicaldatasource) and building a model that contains only that database's
  entities (`ApplicationDbContext.cs:30-35`).
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
  [`RefreshSessionModelBuilderExtensions`](#refreshsessionmodelbuilderextensions), and
  [`SchedulerSettings`](group-14-module-system-composition.md#schedulersettings),
  [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings) and
  [`RefreshSessionSettings`](group-08-auth.md#refreshsessionsettings) via `IOptions<>`, plus
  MiniProfiler and EF Core.
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
  (`ApplicationDbContext.cs:388`) and `Tenant` (`:391`). EF composes named filters with AND, so a
  tenant-owned soft-deletable entity is filtered on both without either filter knowing about the other,
  and a caller asking to see deleted rows drops exactly `SoftDelete` and leaves `Tenant` in force
  (`:383-387`, `:405-412`). Isolation therefore cannot be forgotten at a call site.
- **Walkthrough**:
  - **Primary constructor** (`ApplicationDbContext.cs:41-46`): takes `DbContextOptions`, an
    `IServiceProvider`, an
    [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), and the
    [`PhysicalDataSource`](#physicaldatasource) this instance targets, delegating to
    `DbContext(options)`.
  - **`DataSourceKey`** (`:49`): exposes the `(engine, database name)` pair this context serves;
    **`PhysicalSource`** (`:97`) exposes the resolved connection info to subclasses as `internal`.
  - **Model-gate fields** (`:63`, `:76`, `:94`): `_schedulerTableEnabled`, `_auditTrailTableEnabled`
    and `_refreshSessionTableEnabled`, all three resolved in `OnConfiguring` and read by the
    model-building methods. Their remarks state the rule that keeps them correct: `OnModelCreating`
    must not depend on anything the model cache key does not cover, so the settings lookups happen
    once, up front, in the same place the interceptors are resolved.
  - **`TenantIdAccessor`** (`:112`) and **`CurrentTenantId`** (`:119`): an `internal Func<string?>?`
    assigned by the scoped [`DbContextFactory`](#dbcontextfactory) at context creation
    (`DbContextFactory.cs:104`, `:134`), and the public property that invokes it. The remarks
    (`:105-111`) explain why it is an accessor and not a copied value: a context can be created before
    the request's tenant is resolved, and a copy taken at that moment would pin the context to the
    wrong answer for its whole life. `null` reads as "no tenant", which makes the `Tenant` filter inert
    for background services, seeders and admin flows.
  - **`ValReturn<T>`** (`:125-129`): the nested keyless scalar holder, documented in its own section
    above.
  - **`SupportsOutbox`** (`:136`): `internal virtual`, `true` by default; the Cosmos subclass overrides
    it to `false`. Read by
    [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
    (`DomainEventSaveChangesInterceptor.cs:127`, `:235`).
  - **`CurrentSaveUserId`** (`:143`): `internal` audit user id with a private setter, written by the
    save overloads and read by [`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor); `null`
    marks a system operation and the interceptor resolves it to `default`
    (`AuditSaveChangesInterceptor.cs:50`).
  - **`SaveChangesAsync(userId, ct)`** (`:153-167`): the mutation entry point. Opens a MiniProfiler step
    (`:155`), sets `CurrentSaveUserId`, calls `base.SaveChangesAsync`, and clears the id again in a
    `finally` (`:161-166`) so a later plain `base.SaveChangesAsync` on the same instance (an internal
    outbox write, for example) cannot silently reuse the previous caller's identity for its stamps.
  - **`SaveChanges(userId)`** (`:189-200`): the synchronous counterpart with the same set/reset
    discipline. Its doc comment records the behavioral difference (`:181-186`): the sync path cannot
    dispatch events in-process, so captured events are delivered by the outbox processor instead.
  - **Change-detection overrides** (`:173-179`, `:206-210`): both EF save overloads wrap the base call
    in `using var detection = DetectChangesOnce()`, the optimization taught under
    [`DetectChangesScope`](#detectchangesscope).
  - **`OnConfiguring`** (`:249-306`): resolves the two always-present interceptors from DI (`:256-257`)
    and adds them, inserting [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor)
    **between** them when it is registered (`:264-271`). Registration order is execution order, and the
    comment (`:259-263`) states why the tenant interceptor belongs in the middle: after the audit stamps
    (it must not run against half-stamped entries) and before the domain-event interceptor serializes
    outbox rows, so those rows describe an entity whose tenant is already final.
    [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor) is appended last when
    present (`:278-281`), because it diffs the final values. Both optional interceptors are fetched with
    `GetService`, not `GetRequiredService`: a host that never opted in, a design-time context, or a
    directly constructed test context must still build. The method then resolves the three model gates
    (`:286-298`) and replaces EF's `IModelCacheKeyFactory` with
    [`DataSourceModelCacheKeyFactory`](#datasourcemodelcachekeyfactory) (`:303`) so each database gets
    its own model.
  - **`ConfigureConventions`** (`:309-324`): adds two model-finalization conventions.
    [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) (`:318`) strips FK
    constraints and navigations between entities in different physical databases (a structural no-op in
    the collapsed-monolith case), and
    [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) (`:323`) makes unique indexes
    on soft-deletable entities exclude deleted rows, so a soft-deleted row does not block re-creating
    the "same" record.
  - **`Set<TEntity>()`** (`:326-328`): a public override that forwards straight to `base.Set<TEntity>()`
    and adds no behavior of its own.
  - **`OnModelCreating`** (`:331-358`): applies soft-delete filters, tenant filters and concurrency
    tokens, registers the four keyless `ValReturn<T>` views (`:338-341`), then configures the outbox,
    the inbox, the scheduler table, the audit-trail table and the refresh-session table.
  - **`ApplySoftDeleteFilters`** (`:367-381`): `protected static`; iterates every non-owned
    `IAuditableEntity` type and builds an expression-tree
    `HasQueryFilter("SoftDelete", e => e.IsDeleted == false)` (`:373-379`). Expression trees are
    required because the CLR type is only known at runtime; owned types are excluded because they
    inherit the parent filter. `[Rubric §5, Vertical Slice]` (a global filter removes per-query
    `Where(!IsDeleted)` boilerplate from every slice).
  - **`ApplyTenantFilters`** (`:428-488`): `protected` (instance, because the filter body reads this
    context). For every non-owned [`ITenantEntity`](group-02-domain-building-blocks.md#itenantentity)
    it configures the discriminator column as required, capped at `TenantIdMaxLength` of 64 (`:397`)
    and non-Unicode (`:445-448`), indexes it for every engine except Cosmos (`:457-467`), and builds
    `HasQueryFilter("Tenant", e => CurrentTenantId == null || EF.Property<string>(e, "TenantId") ==
    CurrentTenantId)` (`:469-486`). Three mechanisms are worth internalizing here. The filter embeds
    **this context** as a constant typed as `ApplicationDbContext` (`:435`), which EF rewrites to the
    executing context at query compile time and lifts `CurrentTenantId` into a SQL parameter, so two
    scopes on two tenants share one compiled model and still read disjoint rows. It reads the column
    through `EF.Property` rather than a CLR member access (`:473-478`), which works for an explicitly
    implemented interface member and for a shadow property alike. And the supporting index follows the
    filter **composition**: an entity that is also an `IAuditableEntity` gets `(TenantId, IsDeleted)`
    because every read of it carries `TenantId = @tenant AND IsDeleted = 0`, while a tenant-only entity
    keeps the single-column index (`:450-466`).
  - **`ConfigureConcurrencyTokens`** (`:501-521`): `protected` (instance, because it reads
    `Database.ProviderName` at `:504`). It applies `IsRowVersion()` on SQL Server (database-generated
    `rowversion`, `:514`) or `IsConcurrencyToken()` elsewhere (application-managed, `:518`) to the
    `RowVersion` property of every non-owned auditable entity. EF then includes the token in
    `UPDATE`/`DELETE` `WHERE` clauses and throws `DbUpdateConcurrencyException` on conflicts.
    `[Rubric §8, Data Architecture]`.
  - **`ConfigureOutbox`** (`:528-563`): maps `OutboxMessages` in `dbo` with length/unicode constraints,
    plus three purpose-built filtered indexes. `IX_OutboxMessages_Pending` covers the poll path over
    `(ProcessedOn, OccurredOn)` filtered to `[ProcessedOn] IS NULL` and includes `RetryCount` and
    `LockedUntil` so the processor's extra predicates do not force a key lookup per candidate row
    (`:542-545`); `IX_OutboxMessages_Processed` covers the retention sweep over rows the pending index
    deliberately excludes (`:550-552`); and `IX_OutboxMessages_Ordering` over `(OrderingKey,
    OccurredOn)`, filtered to keyed pending rows, answers the claim predicate's "is there an earlier
    unprocessed row with this key?" question with a seek instead of a scan per candidate row
    (`:559-562`). `[Rubric §12, Performance & Scalability]`.
  - **`ConfigureInbox`** (`:570-584`): maps `InboxMessages` in `dbo` with a unique
    `IX_InboxMessages_MessageId` (the consumer-side idempotency key, `:576-578`) and an
    `IX_InboxMessages_ProcessedOn` index so the age-based purge has something to seek (`:582-583`).
  - **`ConfigureScheduler`** (`:594-619`): the first **gated** table. It returns immediately unless
    `_schedulerTableEnabled` (`:596-599`), then maps
    [`ScheduledJobEntry`](group-14-module-system-composition.md#scheduledjobentry) to `ScheduledJobs` in
    `dbo` keyed by `JobName`, with `IX_ScheduledJobs_NextRunOn` including the lease columns
    (`:615-617`). The index comment (`:610-614`) records the load-bearing decision: it is deliberately
    **not** filtered to unlocked rows, because the poll must also find rows whose lease has expired,
    which is how a dead replica's work is reclaimed.
  - **`ConfigureAuditTrail`** (`:628-657`): the second gated table, mapping
    [`AuditTrailEntry`](#audittrailentry) to `AuditTrailEntries` in `dbo` with a read index over
    `(EntityType, EntityKey, ChangedOn)` (`:648-649`) and a retention index over `ChangedOn`
    (`:654-655`). Note the asymmetry with the scheduler, stated at `:69-73` and `:621-627`: the job
    table is host-scoped and lives in the `Default` source only, while the trail table belongs in
    **every** relational source, because a trail row must commit in the same transaction as the change
    it describes and a transaction does not span databases (the outbox precedent).
  - **`ConfigureRefreshSessions`** (`:673-681`): the third gated table, and the one gated on a
    **configurable** source rather than a fixed one. It returns unless `_refreshSessionTableEnabled`
    (`:675-678`), which requires both `RefreshSessions:Enabled` and this context targeting the source
    named by `RefreshSessions:DataSourceName` (`:295-298`); when it passes it simply calls
    [`RefreshSessionModelBuilderExtensions`](#refreshsessionmodelbuilderextensions)`.ApplyRefreshSessionConfiguration`
    (`:680`). The doc comment states why the mapping lives in the framework base rather than in a
    consumer's context class (`:664-671`): under
    [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) downstream apps run on
    the sealed engine contexts and have no context class of their own to override, and
    [`RefreshSession`](group-08-auth.md#refreshsession) is not an `AuditableBaseEntity`, so the module
    entity-configuration mechanism does not reach it either.
  - **`ApplyConfigurationsForEntitiesInContext`** (`:690-717`): the discovery method subclasses call
    from their `OnModelCreating`. It maps the engine to its configuration interface (`:692-698`),
    resolves [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`:705`), then for each assembly
    from the provider calls
    [`ModelBuilderExtensions.ApplyAllConfigurations`](#modelbuilderextensions) with a filter that keeps
    only entities whose registry-resolved key equals this `DataSourceKey`, or, for unregistered
    entities, only when this context is the engine's `Default` source (`:709-715`).
- **Why it's built this way**:
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (database-per-service)
  requires the same context class per database; without a specialized model-cache key EF would build
  one model and silently reuse it, so queries would hit tables that do not exist in the other
  databases. The single `ApplicationDbContext` is deliberately never split into per-module context
  classes (also ADR-006). The interceptor pipeline keeps audit, tenancy and outbox concerns out of
  every handler ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) for the
  tenancy model, [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) for the trail,
  [ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html) for the job store).
  The three optional tables are settings-gated rather than always mapped so a host that never opted in
  keeps the exact model it had before those features shipped, and its migrations never see the tables.
  The comment at `:700-704` records one more deliberate fallback: an entity configured without the
  attributed base classes lands in the `Default` model but is not routable through the unit of work.
- **Where it's used**: inherited by the three concrete contexts below; created per source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) (`PhysicalDbContextFactory.cs:43-45`), cached
  per scope and given its tenant accessor by [`DbContextFactory`](#dbcontextfactory)
  (`DbContextFactory.cs:104`), and consumed by the interceptors and the outbox processor. The model
  gates are pinned by `SchedulerModelGateTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:28`,
  `:38`, `:48`, `:59`), `AuditTrailModelGateTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailModelGateTests.cs:29`,
  `:39`, `:49`, `:63`) and `RefreshSessionModelGateTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/RefreshSessionModelGateTests.cs:42`,
  `:51`, `:60`, `:73`, `:89`); the tenant filter by `ApplicationDbContextTenantFilterTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/ApplicationDbContextTenantFilterTests.cs:27`,
  `:41`, `:59`, `:74`, `:96`, `:116`, `:131`, `:143`, `:156`, `:171`, `:184`, `:196`), which covers
  cross-tenant hiding, composition with soft delete, the null-tenant escape, two tenants sharing one
  cached model, the live accessor being read at query time, the composite `(TenantId, IsDeleted)` index
  and the single-column one, and owned types getting no filter of their own.

### DataSourceModelCacheKeyFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16` · Level 11 · class (sealed)

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
  `ApplicationDbContext.cs:414-420`), which is what keeps a multi-tenant host from building one model
  per tenant.
- **Where it's used**: registered in [`ApplicationDbContext.OnConfiguring`](#applicationdbcontext) via
  `optionsBuilder.ReplaceService<IModelCacheKeyFactory, DataSourceModelCacheKeyFactory>()`
  (`ApplicationDbContext.cs:303`), so every engine context inherits it.

### CosmosDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:14` · Level 12 · class (sealed)

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
    Skipping the base is also why the inbox, scheduler, audit-trail and refresh-session tables never
    reach this engine.
- **Why it's built this way**: pushing all provider differences into this subclass keeps the base and
  the entity configuration bodies engine-agnostic; stripping indexes lets one configuration body serve
  both SQL Server and Cosmos. Calling the two filter helpers directly rather than through the base is
  what keeps soft delete and tenancy in force on an engine that cannot run the rest of the base
  pipeline (the tenant helper skips only its index for Cosmos, `ApplicationDbContext.cs:457-467`).
- **Where it's used**: instantiated per Cosmos source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) when a data source resolves to the `CosmosDB`
  engine (`PhysicalDbContextFactory.cs:45`). It is also the single fact behind
  [`DbContextFactory`](#dbcontextfactory)`.SupportsTransactions`, which is literally
  `context is not CosmosDbContext` (`DbContextFactory.cs:756-757`).
- **Caveats / not-in-source**: the certificate bypass is scoped by an ordinal substring match on the
  emulator key prefix; whether any production connection string could contain that substring is Not
  determinable from source. Per
  [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) the plumbing ships and is
  tested, but no host in this workspace configures a Cosmos source today.

### IDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IDbContextFactory.cs:10` · Level 12 · interface

- **What it is**: the framework's own context-factory contract, the scoped object that hands out one
  [`ApplicationDbContext`](#applicationdbcontext) per physical [`DataSourceKey`](#datasourcekey) and
  then coordinates saving, transactions, schema lifecycle, and disposal across every context a scope
  touched (`IDbContextFactory.cs:5-10`). It is deliberately **not** EF Core's
  `IDbContextFactory<TContext>`: the two names collide, which is why consumers that need both add a
  `using IDbContextFactory = ...DbContexts.Factory.IDbContextFactory;` alias
  (`InProcessEventBus.cs:8`, `BrokerEventBus.cs:8`, `EfInboxStore.cs:8`) or fully qualify it
  (`OutboxProcessor.cs:269`).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext), [`DataSourceKey`](#datasourcekey),
  and the BCL `IDisposable` plus `IAsyncDisposable` it extends (`IDbContextFactory.cs:10`).
- **Concept introduced, addressing a context by physical source rather than by type.** `[Rubric §8,
  Data Architecture]` (assesses whether transaction boundaries and unit-of-work scope are deliberate,
  and whether per-service data isolation is real): EF's own factory answers "give me a context of type
  T". This one answers "give me the context for **this database**", which is the only question that
  makes sense once [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) splits
  storage along a `Name` axis and [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)
  adds an orthogonal `Engine` axis. The interface also owns the honest statement of what a
  multi-source save can and cannot promise, in the `ExecuteInTransactionAsync` doc comment
  (`IDbContextFactory.cs:60-65`): each physical source gets its own transaction, commits are
  sequential and best-effort, there is **no** two-phase commit, a failure mid-commit leaves earlier
  sources committed, and the outbox is the cross-source consistency mechanism.
- **Walkthrough**:
  - **`GetDbContext(DataSourceKey)`** (`IDbContextFactory.cs:16`): the only accessor, documented to
    create the context if this scope does not already have one for that source.
  - **`EnsureCreatedAsync`** (`:22`), **`MigrateAsync`** (`:81`), **`HasPendingMigrationsAsync`**
    (`:87`): schema lifecycle across every source the host uses. The contract states the asymmetry:
    `EnsureCreatedAsync` skips sources with no configured connection string (`:18-21`), while the two
    migration members cover only the sources a migrations pipeline owns, which is every SQL Server
    source plus any SQLite source with a configured `SqliteMigrationsAssembly`; Cosmos and
    assembly-less SQLite are created by `EnsureCreatedAsync` instead (`:74-80`).
  - **`SaveChangesAsync`** (`:27`) and **`SaveChanges`** (`:32`): save across all active contexts, the
    async overload documented as carrying audit stamping and domain-event dispatch.
  - **`RequestIdentityInsert`** (`:40`): a one-shot flag for the next save, documented as
    automatically cleared once the save completes (see [`IdentityInsertGroup`](#identityinsertgroup)).
  - **`BeginTransaction`** / **`CommitTransaction`** / **`RollbackTransaction`** (`:45`, `:50`, `:55`):
    applied to every active context that supports transactions.
  - **`ExecuteInTransactionAsync<TResult>`** (`:70-72`): the member handlers actually reach, running
    the operation under the active execution strategy so a retrying strategy retries the whole unit.
- **Why it's built this way**: the application layer already talks to
  [`IUnitOfWork`](#iunitofwork); this second interface exists so the physical-topology coordination
  (which databases, which transactions, which migrations) has a home that Infrastructure can implement
  and tests can mock, without leaking EF Core upward.
- **Where it's used**: registered scoped as [`DbContextFactory`](#dbcontextfactory)
  (`DependencyInjection.cs:95`). [`UnitOfWork`](#unitofwork) delegates its whole save and transaction
  surface to it (`UnitOfWork.cs:70-91`), the startup path resolves it to create, migrate, or verify
  databases
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:58`,
  `:242`, and per tenant at `:144`), and the background and messaging paths resolve it per scope to
  reach a specific source ([`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) at
  `OutboxProcessor.cs:269`, `OutboxCleanupService.cs:110`, `OutboxAdministration.cs:244`,
  `EfInboxStore.cs:39`, `InProcessEventBus.cs:34`, `BrokerEventBus.cs:32`, `ScheduledJobRunner.cs:213`,
  `AuditTrailReader.cs:35`, `AuditTrailCleanupJob.cs:49`, `EFRefreshSessionStore.cs:31`, and
  `RefreshSessionCleanupService.cs:109`).

### IPhysicalDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IPhysicalDbContextFactory.cs:15` · Level 12 · interface

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
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/DbContextFactoryCommitAmbiguityTests.cs:49-55`).
  The two-overload shape is also what keeps tenancy
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)) a routing decision in
  the scoped layer rather than a second factory.
- **Where it's used**: registered singleton as [`PhysicalDbContextFactory`](#physicaldbcontextfactory)
  (`DependencyInjection.cs:96`); injected into [`DbContextFactory`](#dbcontextfactory)
  (`DbContextFactory.cs:40`), which calls both overloads at `:94-96`.

### SqliteDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SqliteDbContext.cs:12` · Level 12 · class (sealed)

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting
  SQLite, the minimal concrete context. One instance exists per physical SQLite data source (database
  file), useful for lightweight local development or testing without a SQL Server instance
  (`SqliteDbContext.cs:7-10`).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](#physicaldatasource), [`DataSource`](#datasource),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider), and the SQLite EF
  provider.
- **Walkthrough**: the 4-arg constructor forwards to the base (`SqliteDbContext.cs:12-17`).
  `OnConfiguring` guards its argument, then calls `UseSqlite(PhysicalSource.ConnectionString, ...)` with
  one option: it sets `sqlite.MigrationsAssembly(PhysicalSource.SqliteMigrationsAssembly)` when that
  value is configured (`SqliteDbContext.cs:31-34`). The comment above it states the contract this
  shares with SQL Server (`:28-30`): without an explicit assembly EF looks for migrations next to the
  context, which lives in `MMCA.Common.Infrastructure` and has none, so a per-source migrations project
  would never be found. There is no retry policy (the store is file-local) and no command-timeout
  override. `OnModelCreating` calls
  `ApplyConfigurationsForEntitiesInContext(DataSource.Sqlite, modelBuilder)` then `base.OnModelCreating`
  (`SqliteDbContext.cs:40-44`), so unlike Cosmos it keeps the full base pipeline: soft-delete and tenant
  filters, concurrency tokens as application-managed tokens rather than `rowversion`, the outbox and
  inbox tables, the three settings-gated tables, and the [`ValReturn<T>`](#valreturnt) views. See
  [`SQLServerDbContext`](#sqlserverdbcontext) for the shared subclass shape.
- **Why it's built this way**: SQLite needs none of the SQL Server hardening (transient-failure retry,
  a per-environment command timeout), so the override is intentionally sparse, but the migrations
  assembly is not optional hardening: it is what lets a SQLite source participate in
  [`IDbContextFactory.MigrateAsync`](#idbcontextfactory) at all, since
  [`PhysicalDataSource`](#physicaldatasource)`.UsesMigrations` returns `true` for SQLite only when that
  assembly is configured
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:48-51`).
  Keeping the full base pipeline is what makes this context a faithful stand-in for SQL Server in tests,
  which is how the framework's own tenancy and model-gate suites run without a database (for example
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/ApplicationDbContextTenantFilterTests.cs:24`,
  which holds one SQLite connection open for the fixture's lifetime). `[Rubric §14, Testability]`.
- **Where it's used**: instantiated per SQLite source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) when a data source resolves to the `Sqlite`
  engine (`PhysicalDbContextFactory.cs:44`). Its migration behavior is pinned by
  `DbContextFactoryMigrationTargetTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/DbContextFactoryMigrationTargetTests.cs:94`,
  `:106`, `:115`, `:126`), which asserts that a SQLite source with a migrations assembly is migrated,
  one without is skipped, `HasPendingMigrationsAsync` considers only the migrated source, and
  `EnsureCreatedAsync` still covers both.

### SQLServerDbContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:15` · Level 12 · class (sealed)

- **What it is**: the `sealed` [`ApplicationDbContext`](#applicationdbcontext) subclass targeting SQL
  Server, the production-primary context. One instance exists per physical SQL Server data source
  (database); its connection string and migrations assembly come from the resolved
  [`PhysicalDataSource`](#physicaldatasource).
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext),
  [`PhysicalDataSource`](#physicaldatasource), [`DataSource`](#datasource),
  [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider),
  [`PersistenceSettings`](group-07-persistence-ef-core.md#persistencesettings) via `IOptions<>`,
  and the SQL Server EF provider (`RelationalEventId`). `[Rubric §8, Data Architecture]` (one concrete
  context per engine, one instance per database) and `[Rubric §29, Resilience & Business Continuity]`
  (the retry policy and the command timeout are baked into the SQL Server path).
- **Walkthrough**:
  - **4-arg constructor** (`SQLServerDbContext.cs:15-20`): forwards to the base.
  - **`_persistenceSettings`** (`SQLServerDbContext.cs:35-36`): a readonly field resolved in the field
    initializer as `serviceProvider.GetService<IOptions<PersistenceSettings>>()?.Value ?? new
    PersistenceSettings()`. Two details are deliberate and documented at `:23-35`. It is resolved once
    per instance rather than read from the primary-constructor parameter inside `OnConfiguring`, because
    referencing that parameter from a member body would capture it into the type's state while the base
    constructor also receives it (CS9107); caching per instance is safe precisely because these contexts
    are never pooled. And it uses `GetService`, not `GetRequiredService`, because the design-time
    provider behind `dotnet ef` registers no options at all and must not be made to throw: both a
    missing registration and a null value fall back to the defaults.
  - **`OnConfiguring`** (`SQLServerDbContext.cs:39-82`): calls
    `UseSqlServer(PhysicalSource.ConnectionString, sql => ...)`. The options action does three things:
    conditionally sets `sql.MigrationsAssembly(PhysicalSource.SqlServerMigrationsAssembly)` (`:49-52`)
    so each extracted service can point at its own per-module migrations project; applies
    `sql.CommandTimeout(_persistenceSettings.CommandTimeoutSeconds)` (`:56`), because without it every
    command silently inherits ADO.NET's 30 second default with no way to tune it per environment (the
    setting's own default is `30`, range-validated to 1-600, at
    `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/PersistenceSettings.cs:21-22`); and
    enables `sql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10),
    errorNumbersToAdd: null)` (`:64-67`). An inline comment (`:61-63`) records the retry caveat: with
    retry enabled, any manual `BeginTransactionAsync` must be wrapped in
    `Database.CreateExecutionStrategy().ExecuteAsync`, which
    [`TransactionalCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#transactionalcommanddecoratortcommand-tresult)
    already does through [`DbContextFactory`](#dbcontextfactory). Finally
    `ConfigureWarnings(w => w.Ignore(RelationalEventId.PendingModelChangesWarning))` (`:80`) suppresses
    EF Core's pending-model error.
  - **`OnModelCreating`** (`SQLServerDbContext.cs:85-89`): calls
    `ApplyConfigurationsForEntitiesInContext(DataSource.SQLServer, modelBuilder)` then
    `base.OnModelCreating`, so the full base pipeline (soft-delete and tenant filters, `rowversion`
    concurrency tokens, outbox/inbox tables, the three settings-gated tables, and the
    [`ValReturn<T>`](#valreturnt) views) runs.
- **Why it's built this way**: the `PendingModelChangesWarning` suppression is required by the
  microservices-extraction design: each extracted host registers only its enabled modules'
  configurations, so its runtime model is a strict subset of the migration snapshot (the union of all
  modules), and EF Core 9+ would otherwise promote that mismatch to an error inside
  `Migrator.ValidateMigrations` during `MigrateAsync` (`SQLServerDbContext.cs:68-74`). The documented
  trade-off (`:77-79`): monolith hosts lose the "you forgot a migration" safety net, so CI should run
  `dotnet ef migrations has-pending-model-changes` against the migrations assembly with the full model
  loaded as a separate gate. Retry-on-failure exists so cold-replica startup connections and platform
  replica replacements do not surface as user-facing 5xx
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html),
  [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)).
- **Where it's used**: instantiated per SQL Server source by
  [`PhysicalDbContextFactory`](#physicaldbcontextfactory) (`PhysicalDbContextFactory.cs:43`); built at
  design time by [`DesignTimeDbContextHelper`](#designtimedbcontexthelper)`.CreateSqlServer`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:51`),
  which is what makes one migrations project per database possible. It is also the type
  [`DbContextFactory`](#dbcontextfactory) tests for on the identity-insert path
  (`DbContextFactory.cs:248`). It is the primary production context in both MMCA.ADC and MMCA.Store,
  and the context type every committed migration snapshot is generated against.
- **Caveats / not-in-source**: whether any repository's CI actually runs the
  `has-pending-model-changes` gate the comment recommends is Not determinable from this file.

### DbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:39` · Level 13 · class (sealed)

- **What it is**: the scoped implementation of [`IDbContextFactory`](#idbcontextfactory) and the
  busiest type in this group. It caches one [`ApplicationDbContext`](#applicationdbcontext) per
  physical [`DataSourceKey`](#datasourcekey) for the life of the scope, coordinates save, transaction,
  migration, and disposal across all of them, and is also the database-per-tenant routing point
  (`DbContextFactory.cs:17-26`).
- **Depends on**: [`IPhysicalDbContextFactory`](#iphysicaldbcontextfactory),
  [`IEntityDataSourceRegistry`](#ientitydatasourceregistry),
  [`IDataSourceResolver`](#idatasourceresolver), and
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), all null-guarded from the primary
  constructor into readonly fields (`DbContextFactory.cs:39-58`), plus two tenancy parameters read
  directly off the primary constructor:
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) and
  `IOptions<`[`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings)`>`
  (`:43-44`, with their contracts documented at `:31-37`). It also calls four `internal static` members
  of [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)
  (`BeginCaptureExclusion`, `EndCaptureExclusion`, `DropDeferred`, `FlushDeferredAsync`, at
  `DbContextFactory.cs:315`, `:342`, `:447`, and `:581`).
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
  compiled model serves every tenant (`DbContextFactory.cs:138-143`).
- **Walkthrough**:
  - **State** (`DbContextFactory.cs:48-85`): `MaxSavePasses` (3, `:52`); `_dbContexts`, the per-scope
    `Dictionary<DataSourceKey, ApplicationDbContext>` that guarantees every repository in a scope
    shares one change tracker per database (`:62`); `_routedContextTenants`, recording which tenant
    each per-tenant-routed context was created for and holding only overridden sources (`:64-69`);
    `_transactionActive` (`:75`); the one-shot `_identityInsertRequested` flag (`:82`); and a
    `volatile bool _disposed` (`:84`).
  - **`GetDbContext(DataSourceKey)`** (`DbContextFactory.cs:88-118`): throws if disposed (`:89`), then
    on a cache miss asks `ResolveTenantOverride` for the tenant's own connection information and
    creates the context through whichever `Create` overload applies (`:93-96`), records the creating
    tenant when the source was routed (`:100-101`), attaches the tenant accessor (`:103`), and enlists
    the new context in an already-active transaction (`:107-108`), so a source first touched **inside**
    a transactional command still shares the boundary. On a cache **hit** it calls
    `GuardRoutedTenantUnchanged` (`:113`).
  - **`AttachTenantAccessor`** (`DbContextFactory.cs:130-136`): hands the context a delegate rather
    than a copied value, because a context can be created before the request's tenant is resolved and
    the query filter must read the answer that holds at query time (`:119-128`). It null-guards inside
    rather than at the call site so the null tolerance a mocked physical factory needs does not leak a
    maybe-null flow state back into the caller (`:124-128`).
  - **`ResolveTenantOverride`** (`DbContextFactory.cs:144-169`): returns `null` (source stays shared)
    unless there is a tenant, bound settings, an entry for that tenant, and an entry for this source
    name (`:145-151`); otherwise it takes the engine-appropriate connection string through
    [`TenancySettingsValidator`](group-07-persistence-ef-core.md#tenancysettingsvalidator)`.ConnectionStringFor`
    (`:153`), still returning `null` when the tenant overrides only a different engine (`:154-158`),
    and finally clones the shared [`PhysicalDataSource`](#physicaldatasource) with the tenant's
    connection string and Cosmos database name (`:160-167`).
  - **`GuardRoutedTenantUnchanged`** (`DbContextFactory.cs:177-194`): if the cached context was routed
    for a tenant and the scope's tenant has since changed, it throws with both tenant ids named
    (`:185-192`). The comment states the stakes (`:170-175`): serving that context to a second tenant
    would read and write the first tenant's data under the second tenant's filter value.
  - **`GetSourcesInUse`** (`DbContextFactory.cs:214-215`): the union of every source backing a
    registered entity (from [`IEntityDataSourceRegistry`](#ientitydatasourceregistry)) and every source
    already materialized in this scope, which is what `EnsureCreatedAsync` (`:196-207`) and
    `GetMigrationTargets` (`:705-723`) iterate. `EnsureCreatedAsync` skips sources with an empty
    connection string (`:200-203`).
  - **`GetMigrationTargets`** (`DbContextFactory.cs:706-724`): the shared filter behind `MigrateAsync`
    (`:686-690`) and `HasPendingMigrationsAsync` (`:726-735`). It keeps a source only when its resolved
    [`PhysicalDataSource`](#physicaldatasource)`.UsesMigrations` is true (`:713-714`), then skips a
    non-SQL-Server target whose connection string is empty (`:716-717`). The asymmetry is deliberate and
    documented (`:697-702`): an optional SQLite source a test host leaves unconfigured stays silently
    absent, while a SQL Server source with no connection string still fails loudly at startup, because
    for SQL Server that is a misconfiguration rather than an option.
  - **`SaveChangesAsync`** (`DbContextFactory.cs:226-274`): reads and immediately clears the
    identity-insert flag (`:227-228`), then loops at most `MaxSavePasses` times over the contexts it
    has not yet saved (`:237-251`), passing `_currentUserService.UserId` into each context's
    audit-aware `SaveChangesAsync` overload (`:247-249`). The re-loop exists because saving dispatches
    domain events in-process, and a handler that resolves a repository for a source nobody had touched
    yet calls `GetDbContext` mid-enumeration (`:233-236`). After the loop it asserts that **no** cached
    context still has changes and throws an `InvalidOperationException` naming the offending sources if
    any does (`:259-270`), because anything still tracked when the unit of work returns would be
    silently lost. The comment at `:253-258` explains why the assertion reads the change tracker rather
    than the saved set: it must catch both a context materialized past the pass bound and a handler
    that dirtied an already-saved context.
  - **`SaveChanges`** (`DbContextFactory.cs:409-417`): the synchronous path, a single pass over a
    snapshot of the cached contexts with no re-loop.
  - **Identity-insert path** (`DbContextFactory.cs:277`, `:284-403`): covered in
    [`IdentityInsertGroup`](#identityinsertgroup) above.
  - **`BeginTransaction` / `CommitTransaction` / `RollbackTransaction`** (`DbContextFactory.cs:419-449`):
    each filters to contexts that support transactions and, symmetrically, to those that do or do not
    already carry one (`:426`, `:433`, `:440`), because EF throws on a second `BeginTransaction` for
    the same connection and `GetDbContext` may already have enlisted a late-created context
    (`:422-425`). Rollback additionally calls `DomainEventSaveChangesInterceptor.DropDeferred` on every
    context (`:446-447`): the aggregate changes and their outbox rows just rolled back, so the deferred
    in-process dispatch must never run, and must not survive into a retry.
  - **`ExecuteInTransactionAsync<TResult>`** (`DbContextFactory.cs:500-545`): re-entrancy first, a
    nested call simply runs the operation on the ambient transaction (`:510-511`), because an inner
    commit would make the outer scope's earlier work durable ahead of its own decision (`:503-509`).
    Otherwise it picks the execution strategy from the first transaction-capable context, materializing
    the `Default` source through the resolver if none exists yet (`:519-520`, deliberately resolved
    rather than taken literally so a host with no SQL Server connection does not open a connection
    string that does not exist, `:513-518`), and runs the attempt under `strategy.ExecuteAsync`
    (`:526-534`), calling `ResetForRetry` before every attempt after the first (`:528-529`).
  - **`RunTransactionalAttemptAsync`** (`DbContextFactory.cs:555-610`): one attempt, begin to commit.
    A failed [`Result`](group-01-result-error-handling.md#result) rolls back and returns (`:563-570`),
    which is what makes
    [ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)'s Result-over-exceptions
    rule safe for partial persistence. On success it commits through `TryCommit` and only then flushes
    the deferred dispatch on every context, snapshotting the dictionary first because a handler can
    still materialize a new source (`:576-583`). A cancellation attempts a best-effort rollback and, if
    even that throws, clears the flag and drops every deferred dispatch by hand (`:587-603`); any other
    exception rolls back and rethrows (`:604-608`).
  - **`TryCommit`** (`DbContextFactory.cs:622-654`) and **`AbandonAfterCommitFailure`** (`:662-683`): a
    commit failure is **returned, not thrown** (`:646`). `TryCommit` snapshots the enlisted contexts
    first, because that order *is* the commit order (`:625-630`), then commits them one by one,
    accumulating the successes; on a throw it names the failing source, treats everything past it in the
    snapshot as rolled back (`:644`), and hands all three groups to
    [`TransactionCommitAmbiguousException`](#transactioncommitambiguousexception).
    `AbandonAfterCommitFailure` rolls back whatever has not committed yet, drops every deferred
    dispatch, and swallows secondary rollback failures so the commit ambiguity stays the reported
    failure (`:666-682`).
  - **`ResetForRetry`** (`DbContextFactory.cs:743-750`): before the strategy re-runs the operation it
    drops deferred dispatch and calls `ChangeTracker.Clear()` on every context, so entities the aborted
    attempt added are not inserted a second time (with a duplicate outbox row per event).
  - **`SupportsTransactions`** (`DbContextFactory.cs:756-757`): `context is not CosmosDbContext`,
    the single place the Cosmos "no multi-document transactions" fact is encoded;
    **`HasActiveTransaction`** (`:758-759`) is `Database.CurrentTransaction is not null`.
  - **Disposal** (`DbContextFactory.cs:762-792`): `Dispose` and `DisposeAsync` both dispose every
    cached context, clear the dictionary, set `_disposed`, and suppress finalization.
- **Why it's built this way**: [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)
  makes "one scope, several databases" the normal case, so somebody has to own the cross-context
  bookkeeping; putting it here keeps handlers writing `SaveChangesAsync` exactly as they would against
  a single database, and [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)
  then reuses that one chokepoint for per-tenant routing. The five subtleties (bounded re-loop plus the
  unsaved assertion, deferred dispatch released only after commit, a commit failure exempted from retry
  and reported per source, the routed-tenant guard, and the re-entrancy short circuit) are each a
  correctness fix with the reasoning written into the source next to the code.
- **Where it's used**: registered scoped as [`IDbContextFactory`](#idbcontextfactory)
  (`DependencyInjection.cs:95`) and consumed through that interface everywhere (see the interface's
  section). Directly instantiated in tests, for example
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/DbContextFactoryCommitAmbiguityTests.cs:55`
  and `:195`; the save-loop invariants are pinned by `DbContextFactorySaveIntegrityTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/DbContextFactorySaveIntegrityTests.cs:81`,
  `:101`, `:120`), which assert that a handler mutating an already-saved context throws naming that
  context, that an extra read-only context does not, and that a clean scope returns the written count.
- **Caveats / not-in-source**: the `MaxSavePasses` bound of 3 is documented as "two passes cover the
  realistic case, the third is slack" (`DbContextFactory.cs:48-52`); whether any production workload
  has ever needed the third pass is Not determinable from source. The routed-tenant guard also implies
  a usage rule the code can only enforce after the fact: a scope serves one tenant, and switching
  tenants means a fresh scope (`:185-192`).

### PhysicalDbContextFactory
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:16` · Level 13 · class (sealed)

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
  same warning is repeated at the registration site (`DependencyInjection.cs:90-96`), which is where
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
- **Where it's used**: registered singleton (`DependencyInjection.cs:96`);
  [`DbContextFactory.GetDbContext`](#dbcontextfactory) calls one overload or the other on every cache
  miss (`DbContextFactory.cs:95-97`), which is the only first-party call site.

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
  for consumers to catch. See
  [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) for the multi-tenancy
  model this enforces.
- **Where it's used**: thrown at three call sites in
  [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor)
  (`TenantSaveChangesInterceptor.cs:110` for the unresolved-tenant insert, `:123` for a mismatched
  insert, `:150-151` for a mismatched update or delete); asserted by
  `TenantSaveChangesInterceptorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantSaveChangesInterceptorTests.cs:12`,
  with the unresolved-tenant case at `:34`, the mismatched insert at `:59`, and the mismatched update
  and delete at `:73` and `:90`).

### EncryptedStringConverter
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Encryption` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:72` · Level 0 · class (sealed)

- **What it is**: an EF Core `ValueConverter<string, string>` that encrypts a string property with
  AES-256-GCM on the way to the database and decrypts it on the way back, transparently to the entity
  (`EncryptedStringConverter.cs:8-11`). It is applied per property in an entity configuration, not
  globally (`:12-18`), and the value it stores is a **versioned envelope**: the key it decrypts with is
  named by a byte inside the stored value itself, not by whatever key the converter was built with.
- **Depends on**: `System.Security.Cryptography` (`AesGcm`, `RandomNumberGenerator`,
  `CryptographicException`), `System.Collections.Frozen` (`FrozenDictionary`, `:1`),
  `System.Text.Encoding`, and EF Core's `ValueConverter<TModel, TProvider>`. No first-party type.
- **Concept introduced, authenticated encryption at rest, and what it costs you.** `[Rubric §11,
  Security]` (assesses whether sensitive data is protected in transit and at rest with sound primitives)
  and `[Rubric §30, Compliance, Privacy & Data Governance]` (assesses whether personal data is
  classified and handled deliberately). AES-GCM is an *authenticated* mode: it gives confidentiality
  and integrity in one pass, so tampering with a stored value makes decryption throw instead of
  silently yielding garbage, and no separate HMAC step is needed. The price is stated at length in the
  class comment (`:19-32`) and is the part worth internalizing: every write draws a fresh random nonce
  (`:193`), so the same plaintext produces a different column value each time. A non-deterministic
  column cannot carry an equality or range predicate (the comparison is against a ciphertext that never
  matches, and the query returns no rows rather than failing), cannot carry a unique index, and cannot
  be sorted or grouped server side. Anything that must stay searchable needs a second, deterministic
  surface such as a keyed hash beside the encrypted column. This is the counterpart to the erasure
  story taught by [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) and
  [`PiiAttribute`](group-02-domain-building-blocks.md#piiattribute)
  ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)): erasure overwrites
  a field you never need again, encryption protects one you still have to read back.
- **Concept introduced, a self-describing envelope is what makes key rotation possible.** `[Rubric §8,
  Data Architecture]` (assesses whether persistence mechanics are deliberate) and again `[Rubric §11,
  Security]`. A stored value is Base64 of `[key version (1)] [nonce (12)] [ciphertext (N)] [tag (16)]`
  (`:38-44`, laid out at `:203-208`), so the row carries everything needed to read it back except the
  key material: 29 bytes of overhead before Base64 inflation (`:75`, `:78`, `:81`). Two properties fall
  out of that one byte. First, a converter can hold a whole **key ring** keyed by version with one
  version nominated as current (`:109`): writes stamp the current version (`:116`, `:205`), reads take
  their key from the version byte in the data (`:223-224`), so a rotation is add the new key as current,
  deploy, re-encrypt rows in the background, then retire the old version, with no maintenance window and
  no rows left unreadable in between (`:45-61`). Second, the version byte is **authenticated, not merely
  stored**: it is passed to AES-GCM as associated data on both sides (`:198`, `:231`), so rewriting it
  fails the tag check rather than silently selecting another key, and it fails even when the substituted
  version happens to map to the same key. That last property is the one a "just prefix the version"
  design usually misses.
- **Walkthrough**:
  - **Sizes and the default version** (`EncryptedStringConverter.cs:75`, `:78`, `:81`, `:84`, `:87`):
    `VersionSize = 1`, `NonceSize = 12` bytes (96 bits, the NIST recommendation for GCM),
    `TagSize = 16` bytes (128 bits), `KeySize = 32` bytes, and `DefaultKeyVersion = 1`, the version the
    single-key constructor stamps.
  - **Two public constructors over one private one** (`:94-97`, `:109-112`, `:114-119`): the `byte[]`
    constructor is sugar for a one-entry ring at version 1, built by `CreateSingleKeyRing` (`:95`,
    `:127-138`), which null-guards the key (`:129`) and rejects anything that is not exactly 32 bytes
    with a message naming the length it got (`:130-135`). The ring constructor takes an
    `IReadOnlyDictionary<byte, byte[]>` plus the version to write with. Both funnel into the private
    constructor, which passes the two lambdas up to `ValueConverter`, `Encrypt` as the to-provider
    direction bound to the current version and `Decrypt` as the from-provider direction (`:116-117`).
    The frozen ring is captured by those lambdas.
  - **`ValidateAndFreeze`** (`:146-182`): the ring is validated once, at construction. Not null
    (`:150`), not empty (`:152-155`), no null entry (`:159-164`), every key exactly 32 bytes
    (`:166-171`), and the nominated current version actually present (`:174-179`), which is what lets
    `Encrypt` index the ring without a lookup guard (`:189-190`). Then `ToFrozenDictionary()` (`:181`)
    takes a defensive copy, so mutating the dictionary the caller passed in afterwards cannot change
    which keys the converter uses (`:140-145`).
  - **`GenerateKey()`** (`:125`): `RandomNumberGenerator.GetBytes(32)`, the convenience path for
    producing a valid key during setup.
  - **`Encrypt`** (`:184-211`): empty and null pass through unchanged (`:186-187`), otherwise resolve
    the current key (`:190`), UTF-8 encode (`:192`), draw a 12-byte nonce (`:193`), and encrypt into a
    same-length ciphertext buffer with a 16-byte tag, handing the single version byte over as associated
    data (`:194-201`). The four regions are then laid into one buffer in envelope order (`:203-208`) and
    Base64-encoded (`:210`). Storing the version and nonce alongside the ciphertext is what makes each
    row self-describing: no side table of nonces and no out-of-band record of which key wrote which row.
  - **`Decrypt`** (`:213-239`): Base64 decode (`:218`), reject anything shorter than version plus nonce
    plus tag with a `CryptographicException` (`:220-221`), read the version from position 0 and fail
    with a message naming only the version number (never key material) when the ring has no key for it
    (`:223-225`), then slice nonce, ciphertext, tag, and the associated-data byte by fixed offsets and
    decrypt (`:227-236`). A wrong key, a tampered ciphertext byte, and a rewritten version byte all fail
    inside `AesGcm.Decrypt`, which is the integrity guarantee doing its job.
- **Why it's built this way**: GCM over CBC removes the "encrypt then MAC" bookkeeping that is easy to
  get wrong, and putting the whole scheme behind a `ValueConverter` means an entity property stays a
  plain `string` in the domain model.
  [ADR-037](https://ivanball.github.io/docs/adr/037-field-level-encryption-at-rest.html) records the
  decision and is explicit that this is a second layer above transparent database encryption: TDE
  decrypts for anyone who can query, this converter keeps the value ciphertext the moment it leaves the
  application. The key never lives in the converter's own configuration: the comment (`:33-37`) points
  at Key Vault, user-secrets, or environment variables. The converter is also deliberately stateless and
  context-free (`:62-70`): version resolution is data-driven from the envelope and nothing consults the
  `DbContext`, the current user, or any ambient scope, because a value converter is a pair of compiled
  expressions running in the provider's materialization path and cannot reach them. Per-tenant or
  per-request key selection is therefore out of scope here by design and needs a `SaveChanges`
  interceptor or application-layer encryption above EF Core.
- **Where it's used**: nowhere in application code today. A workspace-wide search of `*.cs` for the
  type finds only its own file, its 21 unit tests
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Encryption/EncryptedStringConverterTests.cs:6`,
  covering the plaintext round trip at `:10`, non-determinism at `:24` and `:38`, key generation at
  `:52` and `:61`, the invalid-length and null-key guards at `:71` and `:123`, the empty-string
  passthrough at `:82` and `:95`, the too-short value at `:108`, Unicode at `:129`, the version byte the
  single-key constructor stamps at `:145`, a key-ring round trip at `:157`, a full rotation in which
  pre-rotation ciphertext stays readable while new writes carry the new version at `:175`, an
  unregistered version at `:205`, the tampered-version-byte failure at `:226`, the four ring-validation
  guards at `:244`, `:250`, `:259`, and `:268`, and the defensive copy of the caller's dictionary at
  `:281`), and one prose mention in the
  [`IAnonymizable`](group-02-domain-building-blocks.md#ianonymizable) doc comment
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:17-19`) recommending it for
  personal fields that must survive erasure in readable form. No entity configuration calls
  `HasConversion(new EncryptedStringConverter(...))` in any of the repos, and no DI registration
  supplies a key or a ring.
- **Caveats / not-in-source**: this is therefore a shipped but unadopted extension point, a posture
  [ADR-037](https://ivanball.github.io/docs/adr/037-field-level-encryption-at-rest.html) states
  outright and still records as zero adoption after the versioned envelope shipped in MMCA.Common
  v1.153.0. Zero adoption is also what made the format change affordable: there is **no legacy decode
  path**, so a value written in the earlier un-versioned `[nonce] [ciphertext] [tag]` layout does not
  read back under the current converter (its first byte is a nonce byte, not a version), and the window
  in which the envelope is free to change closes at the first adopted column. Three further limits are
  worth knowing before adopting it. The version space is a single byte (`:75`), ample for annual or
  quarterly rotation but wrapping rather than growing, and a reused version number is exactly the
  ambiguity the byte exists to prevent. The suite covers the short-value, unregistered-version, and
  rewritten-version failures but never flips a bit inside the ciphertext body or decrypts under a wrong
  key at the same version, so integrity over the ciphertext rests on the primitive rather than on a
  test. And the searchability constraint stands: the Identity `User` stores `Email` as a queried column
  (see [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser), whose existence check is
  an EF predicate on that column), so encrypting it with this converter would silently break that lookup
  rather than fail loudly.

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
  the database seeder (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:33-36`).
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
  `IdentityModuleSeeder.cs:35-36`), which
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) runs through `SeedAllAsync` at
  startup, after schema initialization
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:111`).
  There is no reflection-based discovery of `IDbSeeder` and no hosted service that drains a list of
  them.

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
  spells it (`:14`), so ADC passes `UserRole.Organizer.Value` and Store passes its own admin role
  without the framework knowing either. `FirstName` and `LastName` are nullable because not every app's
  `User` carries them (`:15-16`).
- **Why it's built this way**: a record rather than a tuple gives the five values names at every call
  site, and positional construction keeps an account list readable as a literal array (see the app
  lists cited below).
- **Where it's used**: the abstract `Accounts` property of
  [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser)
  (`IdentityModuleDbSeederBase.cs:51`); supplied by ADC's
  [`IdentityModuleDbSeeder`](group-24-identity-module.md#identitymoduledbseeder) as three accounts
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:34-39`)
  and by Store's through a `StoreAccounts` array
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:27`,
  `:34`).
- **Caveats / not-in-source**: the record's own remarks (`SeedAccount.cs:6-11`) call the security
  property out: seed credentials are plaintext by construction, so an account list is development-only
  data that must be gated or replaced with environment-sourced secrets before a seeder runs in a
  deployed environment. Both apps' lists contain deliberately weak passwords.

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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:111`).
- **Where it's used**: the base of every module seeder in both apps, for example ADC's
  [`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:24`),
  Store's `CatalogModuleDbSeeder`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/DbContexts/Seeding/CatalogModuleDbSeeder.cs:15`)
  and `SalesModuleDbSeeder`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Persistence/DbContexts/Seeding/SalesModuleDbSeeder.cs:27`),
  and the framework's own [`IdentityModuleDbSeederBase<TUser>`](#identitymoduledbseederbasetuser)
  (`IdentityModuleDbSeederBase.cs:39-42`). Pinned by `DbSeederTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/Seeding/DbSeederTests.cs:6`, `:9`,
  `:17`, `:27`, `:36`, `:45`), which assert the int pass-through, `Guid` determinism, distinctness
  across different ints, the unsupported-type throw, and that `SeedAsync` can be implemented.
- **Caveats / not-in-source**: the `Guid` mapping consumes only the first four of sixteen bytes, so the
  produced values are structurally recognizable rather than random. That is intentional for seed data
  and is not a source of production ids: entity ids come from the database or from
  [`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator).

### AggregateCapture
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:373` · Level 2 · record (private sealed, nested)

- **What it is**: a two-field pairing of one tracked aggregate root and the exact array of domain
  events snapshotted from it for the current save
  (`DomainEventSaveChangesInterceptor.cs:370-375`).
- **Depends on**: EF Core's `EntityEntry<IAggregateRoot>` and
  [`IDomainEvent`](group-04-events-outbox.md#idomainevent) via
  [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot).
- **Concept introduced, snapshot-then-remove instead of clear.** The naive move after dispatching
  events is `entity.ClearDomainEvents()`. That is wrong here, and this record is the fix. An
  in-process handler running during dispatch can raise a *new* event on the same aggregate; a
  wholesale clear would wipe that new event before any later capture could see it, so it would never
  dispatch and never reach the outbox. Holding the exact snapshot lets the interceptor remove
  precisely what it captured and leave everything else in place
  (`DomainEventSaveChangesInterceptor.cs:355-365`).
- **Walkthrough**:
  - **`Entry`** (`:373`): the `EntityEntry<IAggregateRoot>`, not the bare entity. Keeping the entry
    means the record still has EF's view of the aggregate available if the flush path ever needs it,
    and `capture.Entry.Entity` reaches the aggregate itself (`:363`).
  - **`Events`** (`:374`): an `IDomainEvent[]` materialized with a collection expression at capture
    time (`:223`, `[.. e.Entity.DomainEvents]`), which is what makes it a snapshot rather than a live
    view of the aggregate's mutable list.
- **Why it's built this way**: a positional `record` gives value semantics and an immutable pair for
  free, and `private sealed` keeps it invisible outside the interceptor. It is data, not behavior:
  the only method that touches it is `ClearDomainEvents`, which calls
  `capture.Entry.Entity.RemoveDomainEvents(capture.Events)` on each (`:362-363`, against the contract
  member at `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAggregateRoot.cs:32`).
- **Where it's used**: constructed once per event-carrying aggregate in
  `CaptureEventsAndPersistToOutbox` (`:220-224`), stored inside
  [`CapturedState`](#capturedstate) (`:382`), and consumed by `ClearDomainEvents` (`:360-364`).

### CapturedState
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:382` · Level 10 · record (private sealed, nested)

- **What it is**: the whole of what
  [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) learns before a save and
  needs again after it: which aggregates it captured, which events it will dispatch in process,
  which outbox rows back those events, and whether any integration events are in the batch
  (`DomainEventSaveChangesInterceptor.cs:377-386`).
- **Depends on**: [`AggregateCapture`](#aggregatecapture),
  [`IDomainEvent`](group-04-events-outbox.md#idomainevent),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage).
- **Concept introduced, why per-save state cannot live in a field.** The interceptor is registered
  as a **singleton** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:71`),
  and one singleton serves every context in every scope concurrently. Anything it remembers between
  `SavingChanges` and `SavedChanges` therefore has to be keyed by the context, not stored on the
  instance. That is exactly what this record is: the value side of a
  `ConditionalWeakTable<DbContext, CapturedState>` (`:61`). `[Rubric §12, Performance and
  Scalability]` assesses whether shared components stay safe and cheap under concurrency; the weak
  table adds no lock and no lifetime bookkeeping, because an entry disappears when its context is
  collected.
- **Walkthrough** (all four members are positional and immutable):
  - **`Captures`** (`:382`): the `AggregateCapture[]`, used only to remove exactly the captured
    events afterwards.
  - **`LocalEvents`** (`:383`): the events that get in-process dispatch. On a context that writes
    outbox rows this deliberately **excludes** every
    [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent) (`:248-256`); on a context
    without outbox support, or in a host that turned the outbox off, it is simply every captured
    event (`:266`).
  - **`LocalOutboxEntries`** (`:384`): the `List<OutboxMessage>` rows backing `LocalEvents`, in the
    same order they were added. After a successful dispatch these are the rows stamped processed
    (`:333`).
  - **`HasIntegrationEvents`** (`:385`): a bool rather than a second list, because integration events
    are never dispatched here. The only thing the flush needs to know is whether to wake the outbox
    processor (`:335-336`).
- **Why it's built this way**: splitting local events from integration events at *capture* time,
  and recording the split in this one value, is what makes `AddDomainEvent(integrationEvent)`
  broker-correct ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
  Before this routing existed, an integration event was dispatched locally and its row marked
  processed, so it silently never reached the wire (`:19-24`).
- **Where it's used**: created at the end of `CaptureEventsAndPersistToOutbox` (`:269-270`), read by
  `DispatchAndFinalizeAsync` (`:303`), carried across a commit boundary inside
  [`DeferredDispatch`](#deferreddispatch) (`:313`), consumed by `FlushStateAsync` (`:324-352`), and
  read on the synchronous path by `SavedChanges` (`:127-133`).

### AuditSaveChangesInterceptor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:22` · Level 11 · class (sealed)

- **What it is**: the EF Core interceptor that stamps `CreatedOn`/`CreatedBy`,
  `LastModifiedOn`/`LastModifiedBy` and `DeletedOn`/`DeletedBy` on every
  [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) entry immediately before
  the write (`AuditSaveChangesInterceptor.cs:9-20`). It is the first of the interceptors the
  framework installs and the reason no handler anywhere in ADC or Store sets an audit field by hand.
- **Depends on**: [`ApplicationDbContext`](#applicationdbcontext) (for `CurrentSaveUserId` and the
  change tracker), [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), and the
  BCL `TimeProvider`, injected through the primary constructor (`:22`).
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
- **Concept introduced, stamping a transition rather than a value.** The soft-delete stamps are not
  driven by what `IsDeleted` *is* but by whether it *changed* during this save (`:14-18`). That
  distinction is what makes the delete stamp behave like the creation stamp: it is written once, by
  the save that flipped the flag, and every later update of the same already-deleted row leaves it
  untouched. Reading the flag's value instead would rewrite `DeletedOn` on every subsequent write to
  a deleted row, which destroys the one fact the column exists to record.
- **Walkthrough**:
  - **`SavingChangesAsync`** (`:25-34`) and **`SavingChanges`** (`:37-45`): identical two-line
    bodies. Each pattern-matches `eventData.Context` against `ApplicationDbContext`, calls
    `StampAuditFields`, then delegates to `base`. The type test is the guard: a context that is not
    the framework's own is left completely alone.
  - **`StampAuditFields`** (`:47-81`): reads the clock once per save via
    `timeProvider.GetUtcNow().UtcDateTime` (`:49`) so every row in one save carries the same instant,
    and resolves the user once as `context.CurrentSaveUserId ?? default` (`:50`). `CurrentSaveUserId`
    is the nullable user id the context was handed for this save
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:143`,
    set at `:156` and `:191`), so `default` is the sentinel for a system-originated write with no
    user behind it.
  - **The `Added` branch** (`:56-65`): sets all four creation and modification properties through
    `entry.Property(nameof(...)).CurrentValue`, going through the change tracker rather than the CLR
    setters so the fields can stay `init`-only or privately settable on the entity, then calls
    `StampSoftDeleteTransition` with `wasDeleted: false`. A brand new row has no prior state, so an
    entity inserted already soft-deleted still gets its delete stamp (`:62-64`).
  - **The `Modified` branch** (`:66-73`): the interesting one. It sets `LastModifiedBy`/
    `LastModifiedOn`, and explicitly marks `CreatedBy` and `CreatedOn` as `IsModified = false`
    (`:67-68`). That is the invariant: an update can never rewrite creation provenance, even if the
    caller mutated those properties on a tracked instance. It then runs the same soft-delete
    transition check, this time against the flag's stored value (`:72`).
  - **`Detached`, `Unchanged`, `Deleted` and the default** (`:74-78`): deliberate no-ops. Note what
    `Deleted` means here: a **hard** delete, which the framework does not use for auditable
    entities. A soft delete arrives as `Modified`, because the entity only set a flag (see
    [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) for soft delete
    versus erasure).
  - **`WasDeleted`** (`:84-85`): the flag as the database has it, read from the property's
    `OriginalValue`. The `is true` test rather than a cast is what keeps an unset or shadow value
    from throwing.
  - **`StampSoftDeleteTransition`** (`:92-106`): compares the current flag against the prior one and
    returns immediately when they agree (`:98-102`), so no transition means no write at all. On a
    transition it writes both stamps in one direction: the resolved user and the save's instant on a
    delete, and `null` on both columns on an undelete (`:104-105`).
- **Why it's built this way**: taking `TimeProvider` instead of calling `DateTime.UtcNow` makes the
  stamps deterministic under test (`[Rubric §14, Testability]`), which is what
  `AuditSaveChangesInterceptorTests` relies on
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Interceptors/AuditSaveChangesInterceptorTests.cs:13`,
  with the four soft-delete transitions pinned at `:128` (delete stamps written), `:144` (an update
  after a delete keeps the original stamp), `:165` (undelete clears both), `:186` (an active entity
  keeps them null) and `:195` (an insert that is already deleted is stamped)). The class is
  registered as a singleton because it holds no per-save state at all
  (`DependencyInjection.cs:68-70`), unlike its neighbours.
- **Where it's used**: resolved from DI and attached in `ApplicationDbContext.OnConfiguring`
  (`ApplicationDbContext.cs:256`, added at `:266` or `:270`). It is always **first** in the
  interceptor chain, which is what lets
  [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor), the domain-event interceptor and
  the optional [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor) assume the
  audit stamps are already final when they run (`ApplicationDbContext.cs:259-263`, `:273-277`).

### DeferredDispatch
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:389` · Level 11 · record (private sealed, nested)

- **What it is**: one unit of post-commit work: a [`CapturedState`](#capturedstate) plus the
  interceptor instance that captured it (`DomainEventSaveChangesInterceptor.cs:388-389`).
- **Depends on**: [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor) and
  [`CapturedState`](#capturedstate).
- **Concept introduced, carrying the owner so a static entry point can flush.**
  [`DbContextFactory`](#dbcontextfactory) is the type that knows when a transaction committed, so it
  is the type that must trigger the deferred dispatch. It calls a **static** method,
  `DomainEventSaveChangesInterceptor.FlushDeferredAsync` (`:144`), rather than resolving the
  interceptor from DI: the factory therefore has no constructor dependency on the interceptor, which
  keeps the persistence graph acyclic. But a flush needs the *instance* (the dispatcher and logger it
  was constructed with), so each queued item carries its own owner and the static entry point simply
  calls back through it: `dispatch.Owner.FlushStateAsync(...)` (`:152`).
- **Walkthrough**:
  - **`Owner`** (`:388`): the interceptor instance that produced the state. In a normal host this is
    the one singleton, but the record does not assume that.
  - **`State`** (`:388`): the captured state to flush.
  - Instances live in a second weak table, `ConditionalWeakTable<DbContext, List<DeferredDispatch>>`
    (`:68`), so a context can accumulate several deferrals when a transactional command saves more
    than once (`:313`, via `DeferredTable.GetOrCreateValue(context).Add(...)`).
- **Why it's built this way**: the ordering rule it implements is that in-process handlers must never
  act on state that could still roll back. Email, cache writes and pushes issued from a handler are
  not transactional, so dispatching them before the commit would leave real side effects behind an
  aborted transaction, and an execution-strategy retry would repeat them once per attempt
  (`:26-33`). See [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) and
  the Transactional decorator of
  [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html).
- **Where it's used**: enqueued by `DispatchAndFinalizeAsync` when
  `context.Database.CurrentTransaction is not null` (`:308-314`); drained by `FlushDeferredAsync`
  after a successful commit
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:582`);
  discarded wholesale by `DropDeferred` on every rollback path (`DbContextFactory.cs:448`, `:599`,
  `:668`, `:746`).

### DomainEventSaveChangesInterceptor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:46` · Level 11 · class (sealed, partial)

- **What it is**: the interceptor that turns domain events into durable messages. Before the write it
  captures every pending event off the tracked aggregate roots and adds an
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row for each, so events commit in the
  same transaction as the data. After the write it routes them: local events are dispatched
  in-process and their rows stamped processed, while integration events are left unprocessed for the
  [`OutboxProcessor`](group-04-events-outbox.md#outboxprocessor) to publish
  (`DomainEventSaveChangesInterceptor.cs:13-35`).
- **Depends on**: [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher),
  [`IOutboxSignal`](group-04-events-outbox.md#ioutboxsignal), `ILogger<T>`, a `TimeProvider` and an
  optional [`MessageBusSettings`](group-14-module-system-composition.md#messagebussettings) options
  object, all through the primary constructor (`:46-51`);
  [`ApplicationDbContext`](#applicationdbcontext),
  [`IAggregateRoot`](group-02-domain-building-blocks.md#iaggregateroot),
  [`IDomainEvent`](group-04-events-outbox.md#idomainevent),
  [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent),
  [`OutboxMessage`](group-04-events-outbox.md#outboxmessage), and
  [`OutboxFinalizer`](group-04-events-outbox.md#outboxfinalizer)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxFinalizer.cs:12`).
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
  (`:20-25`).
- **Concept introduced, the outbox is a posture, not a constant.** The interceptor reads
  `IsOutboxEnabled` off the injected message-bus options once, into the `_outboxEnabled` field
  (`:55`), and that field is passed into every capture (`:86`, `:97`). The resolved posture is the
  explicit `MessageBus:EnableOutbox` value when a host sets one, and otherwise "on for any transport
  other than in-process"
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:159`), so a
  monolith running the in-process bus writes no outbox rows at all and dispatches everything
  directly, while a host on a broker keeps the durable path. A host that resolves no options at all
  keeps the outbox (`:42-45`, `:55`). This is why the type has two behavioral axes rather than one:
  `context.SupportsOutbox` (does this engine have the table) and `_outboxEnabled` (does this host
  want it), and both must be true to take the durable branch (`:236`).
- **Walkthrough** (this is the densest type in the group; read it as capture, then route, then
  defer):
  - **Two instance fields and three static weak tables** (`:53`, `:55`, `:62`, `:69`, `:77`). The
    fields are the clock (defaulting to `TimeProvider.System`, so an existing host keeps the old
    constructor shape while a test can drive the `ProcessedOn` stamp) and the resolved outbox
    posture. `StateTable` holds the [`CapturedState`](#capturedstate) between saving and saved;
    `DeferredTable` holds the [`DeferredDispatch`](#deferreddispatch) list for a context inside a
    transaction; `CaptureExclusionTable` holds the aggregate instances a save must skip.
    `ConditionalWeakTable` is chosen throughout so the interceptor can stay a singleton without ever
    keeping a context alive or needing cleanup code (`:57-61`).
  - **`SavingChangesAsync` / `SavingChanges`** (`:80-89`, `:92-100`): both call
    `CaptureEventsAndPersistToOutbox` for an `ApplicationDbContext`, then delegate to base. Capture
    is synchronous by necessity: the outbox rows must be in the change tracker before EF generates
    the SQL.
  - **`CaptureEventsAndPersistToOutbox`** (`:207-272`), the heart of the type:
    - It first calls `DiscardAbandonedCapture` (`:213`, defined at `:279-296`). A previous
      `SavingChanges` that never reached `SavedChanges` (a failed save, then an execution-strategy
      retry) left its outbox rows tracked as `Added`. Re-capturing on top would write a second row
      per event and publish everything twice, so every `Added` `OutboxMessage` on the context is
      detached first. The comment justifies the blanket detach: this interceptor is the only writer
      of outbox rows, and a completed save leaves none `Added` (`:286-289`).
    - It reads the exclusion set (`:219`) and projects the tracked aggregate roots that have events
      and are not excluded into `AggregateCapture` values (`:221-225`), taking a snapshot copy of
      each event list, and returns early when nothing carried an event (`:227-228`).
    - When `context.SupportsOutbox` and `_outboxEnabled` are both true (`:236`), it walks the
      flattened event list once (`:242-258`): every event gets `OutboxMessage.FromDomainEvent` and is
      added to the outbox set, then the event is sorted. An `IIntegrationEvent` only flips
      `hasIntegrationEvents`; anything else joins both `locals` and `localOutboxEntries`. The `Add`
      call carries a targeted `VSTHRD103` suppression (`:245-247`) because EF's `DbSet.Add` is
      intentionally synchronous.
    - Otherwise, when the context has no outbox table (Cosmos being the example named in the
      comment) or the host turned the outbox off, every event is treated as local (`:262-268`):
      nothing could carry it to a processor anyway, and for the in-process transport that is the
      whole delivery path rather than a degradation.
    - Finally it stores the `CapturedState` under the context (`:270-271`).
  - **`SavedChangesAsync`** (`:103-112`) calls `DispatchAndFinalizeAsync` (`:302-319`), which pulls
    the state, removes it from the table, and then forks. With an active transaction it clears the
    captured events **now** (so a second save in the same transaction cannot re-capture them) and
    queues a `DeferredDispatch` (`:309-315`). Without one it flushes immediately (`:318`).
  - **`FlushStateAsync`** (`:325-353`): dispatches `LocalEvents` if any (`:329-330`), clears the
    captured events (`:332`), stamps the local rows processed through
    `OutboxFinalizer.MarkProcessedAsync` (`:334`, a single set-based `ExecuteUpdate` plus a tracker
    sync rather than a nested save, `OutboxFinalizer.cs:26-30`, `:38-41`, `:43-50`), and signals the
    outbox when integration events are present (`:336-337`). The `catch` logs through the
    source-generated `LogDispatchError` (`:367-368`) and signals the processor so the unprocessed
    rows get retried (`:339-347`); the `finally` clears the events again, idempotently (`:348-352`).
  - **`SavedChanges`, the synchronous path** (`:124-138`): it cannot await the dispatcher, so it does
    not try. For a host with the outbox on and an outbox-capable context it removes the state, clears
    the captured events (which is what stops a later async save from re-capturing and duplicating
    them) and signals the processor, leaving delivery entirely to the outbox. A context without
    outbox support, and a host running with the outbox off, keep the legacy no-op, because with no
    rows written there is nothing for a processor to pick up and clearing the events here would lose
    them outright (`:115-123`).
  - **`ClearDomainEvents`** (`:361-365`): removes exactly the captured events via
    `RemoveDomainEvents`, never a wholesale clear, for the reason
    [`AggregateCapture`](#aggregatecapture) exists.
  - **`FlushDeferredAsync` / `DropDeferred`** (`:145-154`, `:162`): the two internal static entry
    points [`DbContextFactory`](#dbcontextfactory) calls at commit and at rollback. A missed flush is
    explicitly safe: the rows stay unprocessed and the outbox delivers them (`:140-144`).
  - **`BeginCaptureExclusion` / `EndCaptureExclusion`** (`:179-188`, `:195`): the narrow hook for
    `IDENTITY_INSERT` batching. `DbContextFactory` splits a save into one round per identity table
    and temporarily marks the other tables' entries `Unchanged`
    (`DbContextFactory.cs:301-317`); those rows are not written this round, so capturing their events
    now would persist and clear an event ahead of the insert that justifies it. The exclusion set is
    built with `ReferenceEqualityComparer.Instance` (`:187`) and cleared in a `finally`
    (`DbContextFactory.cs:341-347`). The remarks explain why exclusion is by instance and not by
    entity state (`:172-176`): skipping every `Unchanged` aggregate would also drop events raised on
    an already-saved aggregate, which is how the identity module publishes its registration events.
- **Why it's built this way**:
  [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) specifies
  at-least-once delivery, with the in-process path as an optimization and the outbox as the
  guarantee. Deferring past the commit is
  [ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)'s Transactional
  decorator honored at the persistence layer: business failures roll back, and a rolled-back save
  must deliver nothing. The type is `partial` for the source-generated `[LoggerMessage]` (`:367-368`),
  and singleton-safe because every piece of per-save state lives in a weak table keyed by context.
- **Where it's used**: registered as a singleton (`DependencyInjection.cs:71`), attached last of the
  save-time trio in `ApplicationDbContext.OnConfiguring` (`ApplicationDbContext.cs:257`, `:266`,
  `:270`) so it sees final audit stamps and final tenant values; driven at transaction boundaries by
  [`DbContextFactory`](#dbcontextfactory). Pinned by `DomainEventSaveChangesInterceptorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Interceptors/DomainEventSaveChangesInterceptorTests.cs:17`),
  `DomainEventSaveChangesInterceptorOutboxRoutingTests` (`.../DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:27`),
  `DomainEventSaveChangesInterceptorOutboxDisabledTests` (`.../DomainEventSaveChangesInterceptorOutboxDisabledTests.cs:21`)
  and `DomainEventCaptureExclusionTests` (`.../DomainEventCaptureExclusionTests.cs:26`).
- **Caveats / not-in-source**: `DiscardAbandonedCapture` detaches *every* `Added` `OutboxMessage` on
  the context, which is correct only while this interceptor remains the sole writer of outbox rows.
  That is true in the current source, and the comment states the assumption (`:286-289`), but it is
  an invariant a future outbox writer would have to respect.

### TenantSaveChangesInterceptor
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Interceptors` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:36` · Level 11 · class (sealed)

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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:428-488`),
  which composes by AND with the `"SoftDelete"` filter (`ApplicationDbContext.cs:405-413`) and embeds
  the executing context as a constant so one cached model serves every tenant
  (`ApplicationDbContext.cs:414-420`, `:435-436`). On writes it is this interceptor. The
  independence is the point and is called out in the remarks (`:29-34`): a caller who bypasses the
  read filter with EF's own parameterless `IgnoreQueryFilters()` can read across tenants, but still
  cannot write across them. `[Rubric §30, Compliance and Data Governance]` applies for the same
  reason: separation is a property of the engine here, not of reviewer vigilance.
- **Walkthrough**:
  - **`SavingChangesAsync` / `SavingChanges`** (`:39-48`, `:51-59`): the same two-line shape as the
    audit interceptor, both routing to `ApplyTenant`.
  - **`ApplyTenant`** (`:64-94`): reads `context.CurrentTenantId` **once** per save (`:68`), because
    that property walks a live accessor into the scoped tenant context
    (`ApplicationDbContext.cs:119`) and a save must be judged against a single value. It then
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
    (`:136-137`), which keeps the system context unrestricted exactly as it is on the read side. It
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
  order** (`:15-21`). This one sits deliberately between the audit and domain-event interceptors: the
  audit stamps are already written when it runs, and the outbox rows the domain-event interceptor
  adds afterwards describe an entity whose tenant is final. It is also **always registered and inert
  by default** (`:22-28`, `DependencyInjection.cs:73-76`): it is a no-op for every entity that does
  not carry `ITenantEntity`, which is every entity in a host that never adopted tenancy, so that host
  pays nothing while a host that does adopt tenancy can never accidentally leave the write guard off.
  `OnConfiguring` resolves it with `GetService` rather than `GetRequiredService`
  (`ApplicationDbContext.cs:264`) so a directly-constructed test or design-time context still builds.
  See [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html).
- **Where it's used**: registered as a singleton in `AddInfrastructure`
  (`DependencyInjection.cs:76`) and attached second in the interceptor chain
  (`ApplicationDbContext.cs:266`); exercised by `TenantSaveChangesInterceptorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantSaveChangesInterceptorTests.cs:12`,
  including the owned-value carve-out at `:149` and the still-builds-without-it case at `:164`)
  and by the registration tests in
  `.../Persistence/Tenancy/AddMultiTenancyTests.cs:19`.
- **Caveats / not-in-source**: whether any deployed host in this workspace actually opts into
  multi-tenancy is Not determinable from source, since the guard is registered unconditionally and
  is inert until an entity implements `ITenantEntity`.

### IdentityModuleDbSeederBase<TUser>
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeederBase.cs:39` · Level 14 · class (abstract)

- **What it is**: a [`DbSeeder`](#dbseeder) subclass that owns the whole per-account seeding idiom
  (normalize the email, skip if it exists, hash the password, build the aggregate, add, save) for an
  app-supplied list of development accounts. Its own summary records why it exists: that idiom was
  written out five times across the two apps' Identity modules and now lives here once
  (`IdentityModuleDbSeederBase.cs:9-13`).
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
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:56-62`
  with Store's at
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:51`).
  `EmailExistsAsync` exists because the existence predicate must be written against the app's concrete
  `User` and never against an interface member, so EF translates it to the same SQL it did before the
  hoist. That second constraint is the one worth remembering: a predicate over an interface property is
  not translatable, so hoisting shared persistence logic into a generic base means leaving the query
  itself behind in the subclass.
- **Walkthrough**:
  - **Constructor and protected state** (`IdentityModuleDbSeederBase.cs:39-48`): the primary
    constructor's two parameters are null-guarded into protected `UnitOfWork` (`:44`) and
    `PasswordHasher` (`:47`) properties, so subclasses can reach the unit of work for their existence
    predicate without taking it again.
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
  stated in the class comment (`:26-29`): one invalid account cannot roll back the others, which
  matches the pre-hoist behavior each app had. Hashing goes through
  [`IPasswordHasher`](group-08-auth.md#ipasswordhasher) rather than any local scheme, per
  [ADR-032](https://ivanball.github.io/docs/adr/032-password-hashing.html) (`:46`). `[Rubric §11,
  Security]` applies through the notice at `:31-35`: seed credentials are deliberately weak plaintext
  for local development, and a deployed environment must disable seeding or supply environment-sourced
  secrets.
- **Where it's used**: subclassed once per app, by ADC's and Store's
  [`IdentityModuleDbSeeder`](group-24-identity-module.md#identitymoduledbseeder)
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:28-31`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:22`),
  each of which is constructed and run by its
  module's [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) at startup (ADC's
  [`IdentityModuleSeeder`](group-24-identity-module.md#identitymoduleseeder) at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:35-36`). Pinned by
  `IdentityModuleDbSeederBaseTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/Seeding/IdentityModuleDbSeederBaseTests.cs:18`,
  `:26`, `:40`, `:57`, `:68`, `:82`, `:96`), which cover the closed gate, per-account add and save,
  normalization before the existence check, the skip-if-present path, the skip-on-factory-failure path,
  and the hashed credential reaching the app factory.
- **Caveats / not-in-source**: the class comment names ADC's `Seeding:IncludeSampleUsers` as an example
  of an app overriding `ShouldSeed` (`:25-30`), but no first-party seeder overrides it. ADC's subclass
  says so explicitly
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:18-20`)
  and keeps the
  configuration gate in the API-layer `IdentityModuleSeeder` instead
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:29-31`); the only
  override of `ShouldSeed` in the workspace is the test double
  (`IdentityModuleDbSeederBaseTests.cs:162`). So the gate exists in both places by design, and the
  comment describes an available option rather than the wiring in force.

### CosmosIntIdValueGenerator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.ValueGenerators` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ValueGenerators/CosmosIntIdValueGenerator.cs:16` · Level 0 · class (sealed)

- **What it is**: a nine-line EF Core value generator that hands out `int` ids on the client, for the one engine that cannot generate them on the server. Cosmos DB has no identity column, so something has to produce the key before the document is written, and this is that something (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ValueGenerators/CosmosIntIdValueGenerator.cs:6-9`).
- **Depends on**: EF Core's `ValueGenerator<int>` base and `EntityEntry` (`CosmosIntIdValueGenerator.cs:1-2`, `:16`), plus the BCL `Interlocked` and `DateTimeOffset`. No first-party type at all.
- **Concept introduced, who assigns the key.** `[Rubric §8, Data Architecture]` assesses whether persistence mechanics, key strategy included, are deliberate rather than accidental. The framework keeps one identifier alias per module (an `int` or a `Guid`, see the primer's [identifier-type aliases](00-primer.md) and [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)) and then has to honor that alias on three engines. SQL Server and SQLite both offer a server-side identity column, so the entity configuration asks for one ([`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:65-69` for SQL Server and `:74-78` for SQLite). Cosmos offers nothing equivalent, so the same switch installs this generator instead (`:83-91`). The alias stays `int` everywhere; only the mechanism that fills it changes per engine, which is the polyglot-persistence bargain of [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html).
- **Walkthrough**
  - **`_seed`** (`CosmosIntIdValueGenerator.cs:18`): a `private static int` initialized to `(int)(DateTimeOffset.UtcNow.ToUnixTimeSeconds() % int.MaxValue)`. Seeding from the clock rather than from zero means a restarted process does not begin re-issuing ids it already used; the modulo keeps the seconds value inside `int` range instead of overflowing.
  - **`GeneratesTemporaryValues => false`** (`CosmosIntIdValueGenerator.cs:21`): the value this generator returns is the real stored key, not an EF placeholder to be replaced after the insert. That distinction matters elsewhere in this group: [`DbContextFactory`](#dbcontextfactory) reads the *temporary* flag on SQL Server keys to tell an application-supplied id from an EF-assigned one, and only the non-temporary ones need an `IDENTITY_INSERT` round (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:384-388`).
  - **`Next(EntityEntry entry)`** (`CosmosIntIdValueGenerator.cs:24-25`): `Interlocked.Increment(ref _seed)`. Lock-free and thread-safe, which is what you want on a member called once per inserted entity. The `entry` argument is ignored, so every Cosmos entity type in the process draws from the same counter.
- **Why it's built this way**: the counter is deliberately process-local. A durable sequence would need a round trip to the database per insert, which is exactly the cost a Cosmos-shaped workload is trying to avoid, and the class remarks accept the trade-off explicitly (`CosmosIntIdValueGenerator.cs:11-15`).
- **Where it's used**: installed by the Cosmos branch of `EntityTypeConfiguration.ApplyEngineConventions` (`EntityTypeConfiguration.cs:91`) for every entity whose id is value-generated; pinned by `CosmosIntIdValueGeneratorTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/ValueGenerators/CosmosIntIdValueGeneratorTests.cs:6`).
- **Caveats / not-in-source**: the class remarks state the limit plainly (`CosmosIntIdValueGenerator.cs:14`): two processes seeded within the same second, or two processes whose counters drift into each other, can mint the same id, and the suggested remedy is a `Guid` alias for entities that need true uniqueness. Whether any deployed host currently stores entities in Cosmos is Not determinable from source: SQL Server is the engine every host in this workspace configures.

### GroupedCount<TKey>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:180` · Level 0 · record (private sealed, nested)

- **What it is**: a two-property carrier for one `GROUP BY` row: the grouping key and the number of rows carrying it. It is declared `private sealed record class` **inside** [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype), so it exists only for the lifetime of one query translation and is invisible to every caller (`EFReadRepository.cs:177-180`).
- **Depends on**: nothing first-party. `TKey` is the caller's grouping key type, constrained to `notnull` at the `CountByAsync<TKey>` declaration (`EFReadRepository.cs:131`).
- **Concept introduced, a named projection target so the provider can translate the grouping.** `[Rubric §12, Performance and Scalability]` assesses whether aggregation happens in the database rather than after materialization. `CountByAsync` composes `query.GroupBy(keySelector).Select(group => new GroupedCount<TKey>(group.Key, group.Count()))` (`EFReadRepository.cs:140-144`), so the `COUNT` and the `GROUP BY` are both pushed to SQL and only one row per key comes back. The reason a named type appears here at all rather than an anonymous type or a tuple is translatability: EF Core needs a constructor-shaped projection it can bind by parameter name, and a positional record gives it exactly that with a single line of code. The result is flattened into an `IReadOnlyDictionary<TKey, int>` immediately afterwards (`:146`), so the record never escapes the method.
- **Walkthrough**
  - `Key` (`EFReadRepository.cs:180`): the grouping key, projected from `group.Key`.
  - `Value` (`EFReadRepository.cs:180`): the `int` row count, projected from `group.Count()`.
  - The record has no methods of its own. Being a positional `record class`, it gets value equality and a `Deconstruct` free, neither of which the one call site uses; the shape is the whole point.
- **Why it's built this way**: nesting it privately inside the repository keeps a purely mechanical translation helper out of the assembly's type surface, while still giving EF a real named type to bind to. It is the counterpart of [`GroupedSum<TKey>`](#groupedsumtkey), and the two are deliberately separate rather than one generic `Grouped<TKey, TValue>`, because the `int` and `decimal` aggregate shapes translate through different provider paths.
- **Where it's used**: only in `EFReadRepository.CountByAsync<TKey>` (`EFReadRepository.cs:142`, flattened at `:146`). The public capability it backs is consumed in MMCA.ADC by `BookmarkCountService` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/Services/BookmarkCountService.cs:38`) and `GetAttendanceStatsHandler` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/CheckIns/UseCases/GetAttendanceStats/GetAttendanceStatsHandler.cs:32`), and covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryReadSurfaceTests.cs`.

### GroupedSum<TKey>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:185` · Level 0 · record (private sealed, nested)

- **What it is**: the summing twin of [`GroupedCount<TKey>`](#groupedcounttkey): one `GROUP BY` row carrying the key and the `decimal` total for that key (`EFReadRepository.cs:182-185`). Same nesting, same privacy, same single-method lifetime.
- **Depends on**: nothing first-party; see [`GroupedCount<TKey>`](#groupedcounttkey) for the concept.
- **Concept**: introduced by [`GroupedCount<TKey>`](#groupedcounttkey). What is worth reading here is the *element selector* on the grouping. `SumByAsync` calls `query.GroupBy(keySelector, sumSelector)` with two expressions and then `group.Sum()` with none (`EFReadRepository.cs:168-172`). The comment at `:165-167` explains the choice: choosing the summed column inside the grouping keeps the caller's expression tree intact all the way to the provider, whereas summing over the grouping with a separately supplied expression would need that tree spliced in by hand. `[Rubric §12, Performance and Scalability]` again: the whole aggregation is one statement.
- **Walkthrough**
  - `Key` (`EFReadRepository.cs:185`): the grouping key.
  - `Value` (`EFReadRepository.cs:185`): the `decimal` total, projected from `group.Sum()` over the element-selected column.
  - Flattened to `IReadOnlyDictionary<TKey, decimal>` at `EFReadRepository.cs:174`.
- **Why it's built this way**: identical rationale to its twin. `decimal` rather than a generic numeric parameter matches the framework's money and points columns, which are the values callers actually total.
- **Where it's used**: only in `EFReadRepository.SumByAsync<TKey>` (`EFReadRepository.cs:170`). The capability is consumed in MMCA.ADC by `GetLeaderboardHandler` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs:55`) and covered by `EFReadRepositoryReadSurfaceTests.cs`.

### TenantDataSourceOverrideSettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Tenancy` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:138` · Level 0 · class (sealed)

- **What it is**: one tenant's connection override for one physical data source, bound from `Tenancy:Tenants:{tenantId}:DataSources:{sourceName}`. It is the entire configuration surface of database-per-tenant (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:138-154`).
- **Depends on**: nothing. It is the value type of [`TenantEntrySettings`](#tenantentrysettings)`.DataSources` (`TenancySettings.cs:129`), validated by [`TenancySettingsValidator`](#tenancysettingsvalidator) and consumed by [`DbContextFactory`](#dbcontextfactory).
- **Concept introduced, two isolation models behind one switch.** `[Rubric §8, Data Architecture]` assesses how tenant data is partitioned. Shared-schema isolation (a tenant column plus a global query filter and [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor)) needs no entry here at all: the sibling doc says declaring a tenant is only required for the database-per-tenant case, because shared-schema isolation comes from the filter and the interceptor rather than from configuration (`TenancySettings.cs:109-114`). Adding an entry upgrades exactly one source for exactly one tenant to its own database, and every other source stays shared. `[Rubric §11, Security]`: the strongest isolation available (a separate database) becomes a configuration decision per tenant per source rather than an architectural fork, which is what [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) set out to make possible. The deliberate omission teaches as much as the members: there is no migrations-assembly override, because a tenant database has the same schema as the shared one (`TenancySettings.cs:132-137`). One schema, N connection strings.
- **Walkthrough**
  - Four nullable `{ get; init; }` strings, one per engine plus the Cosmos database name: `SQLServerConnectionString` (`TenancySettings.cs:141`), `SqliteConnectionString` (`:144`), `CosmosConnectionString` (`:147`).
  - `CosmosDatabaseName` (`:153`) is optional: when omitted the shared source's database name is kept, which is how one Cosmos account can serve per-tenant databases (`:149-152`).
  - The read path is a record `with` clone, and it is the interesting part. `DbContextFactory.ResolveTenantOverride` bails out unless there is a resolved tenant, bound tenancy settings, an entry for that tenant, and an entry for that source name (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:146-152`), picks the connection string for the source's engine through `TenancySettingsValidator.ConnectionStringFor` (`:154`, resolver at `TenancySettingsValidator.cs:122-129`), and returns null when the tenant overrides this source on a different engine only (`DbContextFactory.cs:155-159`). Otherwise it clones the shared [`PhysicalDataSource`](#physicaldatasource) with the new connection string and, if supplied, the new Cosmos database name (`:161-168`).
  - The clone keeps the ORIGINAL [`DataSourceKey`](#datasourcekey), and the comment above it explains why (`DbContextFactory.cs:138-143`): EF's model cache is keyed on that key, so replacing only the connection string is what lets one compiled model serve every tenant's database.
- **Why it's built this way**: `[Rubric §12, Performance & Scalability]` is the reason for the key-preserving clone. A per-tenant `DataSourceKey` would build and cache a separate EF model per tenant, which multiplies startup cost and memory by the tenant count for no schema difference.
- **Where it's used**: [`DbContextFactory`](#dbcontextfactory) at context-creation time (`DbContextFactory.cs:94-102`), and [`TenancySettingsValidator`](#tenancysettingsvalidator) at startup, which rejects an entry that declares no connection string at all (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:76-86`) and an entry whose key is not a real physical source name for the engine it declares (`:93-104`, with the round-trip test at `:117-119`). The second check exists because the alternative is a silent fall back to the shared database, which is precisely the failure database-per-tenant is bought to prevent.
- **Caveats / not-in-source**: an override is keyed by **physical** source name (the name [`IDataSourceResolver`](#idatasourceresolver) produces), not the logical name a module uses (`TenancySettings.cs:123-128`). That distinction is invisible in a single-database host, where everything collapses onto `Default`.

### TenantResolutionStrategy

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Tenancy` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:6` · Level 0 · enum

- **What it is**: how the request pipeline looks for the tenant on an inbound request: from a signed claim, from a request header, or (declared but not implemented) from the host name (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:6-28`).
- **Depends on**: nothing. Ordered into a list by [`TenancySettings`](#tenancysettings)`.ResolutionOrder` (`TenancySettings.cs:73`), checked by [`TenancySettingsValidator`](#tenancysettingsvalidator), and switched on by [`TenantResolutionMiddleware`](group-12-api-hosting-mapping.md#tenantresolutionmiddleware).
- **Concept introduced, trusted versus asserted identity of a tenant.** `[Rubric §11, Security]` assesses whether an authorization-relevant value can be forged by the caller. The two implemented members are not equivalent and the XML doc says so. `Claim` reads the tenant from the authenticated principal (`TenancySettings.cs:8-12`): the claim was signed by the token issuer, so a caller cannot pick its own tenant. `Header` reads it from a request header (`:15-19`): fine for service-to-service calls behind a trusted gateway, and a public edge honoring it lets any caller name any tenant. The default order is claim first, then header (`TenancySettings.cs:56-57`), so the trustworthy source always wins when both are present.
- **Walkthrough**
  - `Claim = 0` (`TenancySettings.cs:13`), read via `context.User?.FindFirst(settings.ClaimType)?.Value` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:111`); the claim type defaults to `tenant_id` (`TenancySettings.cs:83`).
  - `Header = 1` (`:20`), read via `context.Request.Headers[settings.HeaderName].FirstOrDefault()` (`TenantResolutionMiddleware.cs:112`); the header defaults to `X-Tenant-Id` (`TenancySettings.cs:89`).
  - `Host = 2` (`:27`), which maps to `null` in the middleware switch (`TenantResolutionMiddleware.cs:113`) and is skipped rather than guessed at.
  - The order is read through `EffectiveResolutionOrder`, not the bound list: an empty `ResolutionOrder` falls back to the framework default pair (`TenancySettings.cs:76-77`). That indirection exists because the configuration binder ADDS to a pre-populated collection rather than replacing it, so a non-empty default would leave a host that configured its own order also running the framework's entries (`:42-48`).
- **Concept, a declared-but-unimplemented member that cannot silently no-op.** `[Rubric §9, API & Contract Design]`: the member exists so the configuration contract is stable when host-based resolution ships (`TenancySettings.cs:22-26`). `[Rubric §15, Best Practices & Code Quality]`: selecting it is not accepted quietly. [`TenancySettingsValidator`](#tenancysettingsvalidator) walks the effective resolution order and fails options validation with a message naming the value as defined but not implemented (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:54-65`), so the host refuses to boot instead of resolving nothing on every request. That is the fail-fast configuration contract ([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)) applied to a rule data annotations cannot express.
- **Why it's built this way**: shipping the enum member ahead of the implementation keeps the JSON contract additive, and pairing it with a boot-time rejection removes the only real risk of doing that.
- **Where it's used**: [`TenantResolutionMiddleware`](group-12-api-hosting-mapping.md#tenantresolutionmiddleware) (`TenantResolutionMiddleware.cs:111-113`), `TenancySettings.EffectiveResolutionOrder` (`TenancySettings.cs:76-77`), and [`TenancySettingsValidator`](#tenancysettingsvalidator) (`TenancySettingsValidator.cs:56-64`).

### TenantEntrySettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Tenancy` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:121` · Level 1 · class (sealed)

- **What it is**: one declared tenant, bound from `Tenancy:Tenants:{tenantId}`. It holds exactly one member: that tenant's per-data-source connection overrides (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:118-130`).
- **Depends on**: [`TenantDataSourceOverrideSettings`](#tenantdatasourceoverridesettings), the value type of its dictionary (`TenancySettings.cs:129`, declared at `:138`). Held by [`TenancySettings`](#tenancysettings)`.Tenants` (`:115`).
- **Concept introduced, declaring a tenant is only required for the database-per-tenant case.** This is the single most important thing to read off this class, and it is stated in its own doc (`TenancySettings.cs:109-114`). A shared-schema tenant needs NO entry here at all, because its isolation comes from the global query filter and the [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor), which `AddInfrastructure` registers unconditionally with a comment saying why (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:73-76`). Configuration is therefore only how a tenant is PROMOTED to its own database. `[Rubric §8, Data Architecture]` assesses how deliberately data is partitioned. The dictionary is keyed by PHYSICAL data source name (the name [`IDataSourceResolver`](#idatasourceresolver) produces, for example `Default` or `Conference`), and the key choice is load-bearing enough that [`TenancySettingsValidator`](#tenancysettingsvalidator) fails the boot on a key that does not round-trip. A tenant can override some sources and share others: a source with an entry is routed to the tenant's own database, a source without one stays shared (`TenancySettings.cs:123-128`).
- **Walkthrough**
  - `DataSources` (`TenancySettings.cs:129`): a get-only `Dictionary<string, TenantDataSourceOverrideSettings>` bound from `Tenancy:Tenants:{tenantId}:DataSources:{sourceName}`. Get-only is the correct shape for a bound dictionary, since the configuration binder populates an existing instance rather than assigning a new one.
- **Why it's built this way**: keeping the per-tenant overrides one level below the tenant, rather than flattening connection strings onto the tenant entry, is what lets a single tenant be physically separated on one source while remaining shared on the others, which is the mixed model [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) records.
- **Where it's used**: read by [`DbContextFactory`](#dbcontextfactory)`.ResolveTenantOverride`, which looks up the current tenant then the requested source and clones the shared `PhysicalDataSource` with the tenant's connection string while keeping the ORIGINAL `DataSourceKey`, so one compiled EF model serves every tenant's database (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:144-169`). Also expanded by [`TenantDataSourceTargets`](#tenantdatasourcetargets)`.Expand`, which turns the shared sources plus every (tenant, overridden source) pair into the list the outbox and cleanup background services sweep (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:66-76`), and validated per entry by [`TenancySettingsValidator`](#tenancysettingsvalidator) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:71-106`).

### UpdatePropertySetterBuilder<TEntity>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/UpdatePropertySetterBuilder.cs:14` · Level 1 · class (internal sealed)

- **What it is**: the recorder that sits behind the persistence-agnostic [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity). Application code describes a set-based update as a series of `Set(property, value)` calls; this class collects those calls as deferred actions and replays them onto EF Core 10's `UpdateSettersBuilder<TSource>` at the moment `ExecuteUpdateAsync` runs (`UpdatePropertySetterBuilder.cs:7-14`).
- **Depends on**: [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) (the Application-layer contract it implements, declared at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUpdatePropertySetter.cs:13`), `System.Linq.Expressions` for the property selectors, and EF Core's `Microsoft.EntityFrameworkCore.Query.UpdateSettersBuilder<TSource>` (`UpdatePropertySetterBuilder.cs:1-3`).
- **Concept introduced, the adapter that keeps EF Core out of the Application layer.** `[Rubric §3, Clean Architecture]` assesses whether the inner layers stay free of infrastructure types, and `[Rubric §2, Design Patterns]` assesses whether a named pattern is used where it earns its place. EF's `ExecuteUpdate` API takes a lambda over an EF-owned builder type. Exposing that lambda directly would put `Microsoft.EntityFrameworkCore` in the signature of every Application-layer command that wants a set-based update, which is precisely the dependency the layer rules forbid. The fix is a two-step: the Application layer sees only `IUpdatePropertySetter<TEntity>`, and this Infrastructure class buffers each described assignment as an `Action<UpdateSettersBuilder<TEntity>>` (`UpdatePropertySetterBuilder.cs:16`) that is not executed until EF hands over a real builder. The expression trees themselves cross the boundary unchanged, because `Expression<Func<TEntity, TProperty>>` is a BCL type, not an EF type. `[Rubric §12, Performance and Scalability]` also applies: `ExecuteUpdate` is the set-based path that updates matching rows in one statement without loading or tracking them, which is what makes the adapter worth having at all.
- **Walkthrough**
  - Two fields, both collection-initialized: `_assignments` holds the deferred replay actions in call order, and `_assignedProperties` is the set of top-level property names already assigned (`UpdatePropertySetterBuilder.cs:16-17`).
  - `Set<TProperty>(property, value)` (`UpdatePropertySetterBuilder.cs:20-28`) is the constant-value overload. It null-guards the selector, records the property name, appends a closure calling `builder.SetProperty(property, value)`, and returns `this` so calls chain fluently.
  - `Set<TProperty>(property, valueFactory)` (`UpdatePropertySetterBuilder.cs:31-40`) is the computed-value overload: the second argument is itself an expression over the entity, which is how `SetProperty(x => x.Count, x => x.Count + 1)` style updates are expressed. Same guards, same recording, same fluent return.
  - `IsEmpty` (`UpdatePropertySetterBuilder.cs:43`) reports whether anything was described at all. [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) turns a `true` here into an `ArgumentException` rather than issuing a no-op UPDATE (`EFRepository.cs:116-117`).
  - `SetsProperty(propertyName)` (`UpdatePropertySetterBuilder.cs:49`) is the audit-stamping guard: it answers "did the caller already assign this column?" so the automatic `LastModifiedOn` and `LastModifiedBy` stamp never overwrites an explicit value.
  - `Apply(builder)` (`UpdatePropertySetterBuilder.cs:52-58`) is the replay: iterate the recorded actions, invoke each against EF's real setters builder. It is passed as a method group straight into EF (`EFRepository.cs:132`).
  - `TrackPropertyName` (`UpdatePropertySetterBuilder.cs:60-66`) only records a name when the selector body is a `MemberExpression`, which is the shape of a simple `e => e.Property` lambda. A more complex selector contributes no name, so `SetsProperty` answers `false` for it and the audit stamp is applied. That is the safe direction of the two.
- **Why it's built this way**: recording rather than adapting live is what makes the type useful in two directions at once. The Application layer never sees EF, and the repository gets a chance to inspect and augment the described update before it is issued, which is exactly what the audit stamping in [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) needs. `internal sealed` keeps the class invisible outside the Infrastructure assembly: consumers only ever hold the interface. The repository plus specification contract this member belongs to is recorded in [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html).
- **Where it's used**: constructed once per call in `EFRepository.ExecuteUpdateAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:114`), fed by the caller's `Action<IUpdatePropertySetter<TEntity>>` (`:114`), interrogated for the audit stamp (`:120`, `:126`), and finally replayed into EF (`:131`). The profiled path forwards the same delegate through [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype) (`EFRepositoryDecorator.cs:54-59`).
- **Caveats / not-in-source**: the framework's own set-based updates in the outbox and the scheduler call EF's `ExecuteUpdateAsync` directly on a `DbSet` rather than through this abstraction (for example `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxFinalizer.cs:40`), which is legitimate because those types are already inside Infrastructure. The abstraction exists for the Application layer, so do not read those call sites as the intended usage pattern.

### TenancySettings

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Tenancy` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:50` · Level 2 · class (sealed)

- **What it is**: the `Tenancy` section, bound by `AddMultiTenancy(configuration)`: whether tenant resolution runs, how the tenant is found on a request, whether a request without one is rejected, which paths bypass resolution, and which tenants are declared for database-per-tenant routing (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs:30-34`).
- **Depends on**: [`TenantResolutionStrategy`](#tenantresolutionstrategy) (the strategy enum at the top of the same file, `:6-28`) and [`TenantEntrySettings`](#tenantentrysettings) (the value type of `Tenants`, `:115`). No externals, and deliberately no relational data annotations: the checks that matter here are relational, so they live in [`TenancySettingsValidator`](#tenancysettingsvalidator).
- **Concept introduced, "empty means the default" for bound collections.** This is a genuine configuration-binder trap and the class documents it explicitly (`TenancySettings.cs:41-48`). The .NET configuration binder ADDS to a pre-populated collection rather than replacing it. If `ResolutionOrder` shipped pre-filled with `[Claim, Header]`, a host that configured its own order would end up running the framework's entries as well. The resolution is a pair of properties: the bound list starts empty (`:73`, `:103`), and the framework reads a computed `Effective*` projection that substitutes a private static default when the bound list is empty (`:76-77`, `:106-107`).
  `[Rubric §11, Security]` assesses where trust boundaries are drawn. The two implemented strategies are not equivalent and the enum says so: `Claim` is the trustworthy source because the claim was signed by the token issuer, so a caller cannot pick its own tenant (`:8-13`), while `Header` is intended for service-to-service calls behind a trusted gateway, and a public edge that honors it lets any caller name any tenant (`:15-20`). The default order tries `Claim` first (`:56-57`). `RequireTenant` defaults to `true` and is documented as failing closed, because with tenancy switched on an unscoped request would read across every tenant (`:91-96`).
  `[Rubric §16, Maintainability]` assesses whether a new capability is additive for existing hosts. `Enabled` gates RESOLUTION, not isolation: the global query filter and the [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor) are always registered and are inert whenever no tenant is resolved (`:35-40`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:73-76`, and the same point restated on `AddMultiTenancy` itself at `:505-509`). A host that never enables tenancy keeps exactly the behavior it had before tenancy shipped, and a host that does enable it can never accidentally leave the write-side guard off.
- **Walkthrough**
  - `SectionName = "Tenancy"` (`TenancySettings.cs:53`), the one public static field.
  - `DefaultResolutionOrder` (`:56-57`): private static `[Claim, Header]`. `DefaultExcludedPathPrefixes` (`:60-61`): private static `["/health", "/alive", "/.well-known"]`, the probe and discovery endpoints that must answer before any tenant exists.
  - `Enabled` (`:67`): default `false`.
  - `ResolutionOrder` (`:73`) get-only list plus `EffectiveResolutionOrder` (`:76-77`), the empty-means-default projection.
  - `ClaimType` (`:83`), default `"tenant_id"`, and `HeaderName` (`:89`), default `"X-Tenant-Id"`, the two per-strategy lookup keys. `HeaderName` is only honored when `Header` is in the order.
  - `RequireTenant` (`:96`): default `true`.
  - `ExcludedPathPrefixes` (`:103`) plus `EffectiveExcludedPathPrefixes` (`:106-107`), the same projection shape.
  - `Tenants` (`:115`): a get-only `Dictionary<string, TenantEntrySettings>` bound from `Tenancy:Tenants:{tenantId}`, needed only for database-per-tenant.
- **Why it's built this way**: shared-schema isolation plus optional database-per-tenant promotion is the model [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) records, and this class is its whole operator-facing surface. Defaulting `Enabled` to false while keeping the filter and interceptor always-on is what makes the feature safe to ship into an existing host, and keeping every relational check in a separate `IValidateOptions<T>` (rather than in attributes) is what lets the validator reach the resolved data sources.
- **Where it's used**: bound with `ValidateOnStart` in `AddMultiTenancy`, alongside the `TryAddEnumerable` registration of [`TenancySettingsValidator`](#tenancysettingsvalidator) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:525-537`). Read at request time by [`TenantResolutionMiddleware`](group-12-api-hosting-mapping.md#tenantresolutionmiddleware), which short-circuits when disabled or on an excluded path (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:62`), walks `EffectiveResolutionOrder` reading the claim or the header (`:107-118`), lets the request through unscoped when `RequireTenant` is off (`:75-81`), and otherwise answers `400 Bad Request` (`:83`). Read at persistence time by [`DbContextFactory`](#dbcontextfactory) for per-tenant connection routing (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:45`, `:144-168`), and by the background services through [`TenantDataSourceTargets`](#tenantdatasourcetargets)`.Expand` so they sweep every tenant database too (`OutboxProcessor.cs:64`, `OutboxCleanupService.cs:55`, `OutboxAdministration.cs:43`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:49-79`). Startup database initialization uses the same expansion to create each tenant's database (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:132`, `:138`), and the design-time helper supplies a default instance so `dotnet ef` needs no tenancy configuration (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:133`). All of the runtime consumers take the options as NULLABLE, so a host that never called `AddMultiTenancy` resolves `null` and behaves exactly as before.

### SpecificationEvaluator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/SpecificationEvaluator.cs:20` · Level 4 · class (internal static)

- **What it is**: the one place a specification becomes an `IQueryable<T>`. It always applies the specification's criteria, and when the specification is a [`QuerySpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#queryspecificationtentity-tidentifiertype) it also applies that specification's includes, ordering, and paging (`SpecificationEvaluator.cs:10-20`).
- **Depends on**: [`ISpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ispecificationtentity-tidentifiertype) and [`QuerySpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#queryspecificationtentity-tidentifiertype) for the input shape, [`OrderExpression`](group-03-querying-specifications.md#orderexpression) for each ordering key, [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype) as the entity constraint (`SpecificationEvaluator.cs:40`), EF Core's `Include` and `AsSplitQuery` extensions, plus `System.Reflection` and `System.Collections.Concurrent` for the two caches (`:1-6`).
- **Concept introduced, the evaluator half of the specification pattern.** `[Rubric §2, Design Patterns]` assesses whether patterns are implemented completely rather than named; the specification pattern has two halves, a declarative object describing what to select and an evaluator that turns it into a provider query, and this class is the second half. `[Rubric §3, Clean Architecture]` also applies: the specification types live in the Domain layer and know nothing about EF, so all EF knowledge is concentrated here. The most important thing to internalize is stated in the class doc at `SpecificationEvaluator.cs:14-18`, and it is a boundary, not an omission. **Tracking and soft-delete scope are deliberately not applied here.** Those two choices select the *base* queryable (`Table` versus `TableNoTracking`, with or without the named soft-delete filter dropped), which only a repository holding the `DbContext` can do. The evaluator composes on top of whatever base it is handed, which is why `BaseQueryFor` lives in [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) (`EFReadRepository.cs:439-448`) and not here.
- **Walkthrough**
  - `Apply<TEntity, TIdentifierType>(source, specification, applyShape = true)` (`SpecificationEvaluator.cs:36-61`) is the entry point. It applies `specification.Criteria` unconditionally (`:46`), then returns early when either `applyShape` is false or the specification is not a `QuerySpecification` (`:48-49`). Otherwise it layers includes, then ordering, then `Skip` when it is a positive integer, then `Take` (`:51-58`). Skip before Take, ordering before both: that is the only order in which paging is meaningful.
  - The `applyShape` parameter earns its own doc paragraph (`SpecificationEvaluator.cs:29-34`) and it is a real correctness argument, not a micro-optimization. Aggregate reads such as count and exists pass `false`, because joining includes in to count rows costs a join per navigation, and counting "page 3 of the matches" is never what a caller means.
  - `ApplyIncludes<TEntity>(query, includes)` (`SpecificationEvaluator.cs:77-94`) applies each non-blank dot-separated path with EF's string-based `Include` (`:87-91`), tracking whether any path touches a collection navigation, and switches the whole query to `AsSplitQuery()` when one does (`:93`). That is the cartesian-explosion guard: two sibling collections loaded in one JOIN multiply rows, so EF issues separate queries instead.
  - `ApplyOrdering<TEntity>(query, orderBy)` (`SpecificationEvaluator.cs:105-119`) walks the ordering keys in order and delegates each to `ApplyOrderingStep`, passing `isFirst: i == 0` (`:113-116`). An empty list leaves the query untouched, which preserves any ordering the caller already applied (`:98-99`).
  - `ApplyOrderingStep<TEntity>(query, keySelector, descending, isFirst)` (`SpecificationEvaluator.cs:130-150`) is where the untyped `LambdaExpression` is bound back to a concrete key type. The four-way `(isFirst, descending)` switch picks one of `OrderBy`, `OrderByDescending`, `ThenBy`, or `ThenByDescending` (`:140-146`), then closes the cached `MethodInfo` over `(TEntity, keySelector.ReturnType)` and invokes it (`:148-149`). This is the member [`KeysetQueryBuilder`](#keysetquerybuilder) reuses, which is why the specification path and the keyset path can never produce differently-shaped ORDER BY clauses.
  - Two static caches keep the reflection cost off the hot path. `OrderingMethods` (`SpecificationEvaluator.cs:156-170`) resolves the four two-generic-argument, two-parameter `Queryable` overloads exactly once at type initialization; the per-call cost is a dictionary hit plus a `MakeGenericMethod`. `CollectionIncludeCache` (`:177`) is a `ConcurrentDictionary` keyed by `(entity type, include path)` memoizing the collection-navigation walk in `IsCollectionNavigationPath` (`:179-197`).
  - `IsCollectionNavigationPath` walks the path segment by segment. An unknown segment returns `false` and defers to EF's own include validation rather than guessing (`SpecificationEvaluator.cs:186-187`); a segment whose type is `IEnumerable` but not `string` returns `true` (`:190-191`). The `string` exclusion matters: `string` implements `IEnumerable<char>` and would otherwise force every string-valued path into split-query mode.
- **Why it's built this way**: `internal static` with no state beyond two caches makes it trivially safe to share across every repository instance in the process. The `<remarks>` at `SpecificationEvaluator.cs:69-72` records the deliberate consolidation: `EFReadRepository.ApplyIncludes` delegates here rather than duplicating the logic, so the string-include path and the specification path cannot drift apart. The overall contract is [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html); the expectation that a specification's criteria translate on more than one engine is [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html).
- **Where it's used**: exclusively inside this group. [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) calls `Apply` from `FirstOrDefaultAsync(specification)` (`EFReadRepository.cs:120-121`), from `CountAsync(specification)` with `applyShape: false` (`:348-349`), from both `ListAsync` overloads (`:457-458`, `:474-475`), and from `GetPageByCursorAsync` again with `applyShape: false` (`:516`); its `ApplyIncludes` is a thin forwarder to this class (`:426-429`). [`KeysetQueryBuilder`](#keysetquerybuilder) calls `ApplyOrderingStep` three times (`KeysetQueryBuilder.cs:70`, `:73`, `:74`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/SpecificationEvaluatorTests.cs` and `.../EFReadRepositorySpecificationTests.cs`.

### TenancySettingsValidator

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Tenancy` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:23` · Level 4 · class (sealed, internal)

- **What it is**: the startup validator for [`TenancySettings`](#tenancysettings). It rejects a resolution order naming an unimplemented strategy, and rejects a per-tenant data-source override that declares no connection string or names a source that does not exist (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:8-23`).
- **Depends on**: [`IDataSourceResolver`](#idatasourceresolver) as an OPTIONAL primary-constructor parameter (`TenancySettingsValidator.cs:23`), plus [`DataSource`](#datasource) and [`DataSourceKey`](#datasourcekey) (`:4`, `:27-28`), and the two settings shapes [`TenancySettings`](#tenancysettings) and [`TenantDataSourceOverrideSettings`](#tenantdatasourceoverridesettings). Externals: `Microsoft.Extensions.Options` for `IValidateOptions<T>` and `ValidateOptionsResult` (`:2`), and `System.Globalization` for the `CultureInfo.InvariantCulture` message formatting (`:1`, `:79`).
- **Concept introduced, `IValidateOptions<T>` when validation needs other services.** Data annotations and `IValidatableObject` are the right tools when a rule only involves the settings object itself. This class is the other half of the options-validation story: `IValidateOptions<T>` is a DI-resolved service, so it can inject collaborators. Here that collaborator is the data-source resolver, which is the only thing that knows whether `Conference` is a real physical source in this host. Registration is `TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<TenancySettings>, TenancySettingsValidator>())` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:533-534`), with `TryAddEnumerable` because two modules calling `AddMultiTenancy` must not run the same validation twice (`DependencyInjection.cs:532`). The same shape is used by [`ConnectionStringSettingsValidator`](#connectionstringsettingsvalidator); these two are the framework's only custom `IValidateOptions<T>` implementations.
  `[Rubric §11, Security]` assesses whether misconfiguration can degrade silently. The class doc states the rationale outright: every failure here would otherwise surface as silent cross-tenant behavior at run time, which is exactly the class of bug tenancy exists to prevent, so it is worth a failed boot (`TenancySettingsValidator.cs:8-13`). The concrete danger is the override key: an unknown logical name resolves to `Default`, so a mistyped source name would quietly leave that tenant on the shared database instead of its own (`:112-116`).
  `[Rubric §15, Best Practices & Code Quality]` assesses the quality of failure messages. Each message names the exact configuration path that is wrong and tells the operator what to do: the missing-connection-string message lists the three acceptable properties and notes that removing the entry keeps the source shared (`:78-85`); the unknown-source message explains that override keys are physical names (`:95-104`); the `Host` strategy message names the two supported values (`:60-63`).
- **Walkthrough**
  - `Engines` (`:27-28`): private static `[SQLServer, Sqlite, CosmosDB]`, the engines an override can carry a connection string for.
  - `Validate(string? name, TenancySettings options)` (`:31-47`): null-guards the options, collects failures into a list, runs the resolution-order check once and the tenant check per declared tenant, then returns `ValidateOptionsResult.Success` or `Fail(failures)`. Note that it accumulates ALL failures rather than returning on the first, so one boot attempt reports the whole set.
  - `ValidateResolutionOrder` (`:54-65`): walks `EffectiveResolutionOrder` (so the framework default is validated too, not just an explicitly configured order) and fails on `TenantResolutionStrategy.Host`. That enum member exists so the configuration contract is stable for when host-based resolution ships, but selecting it today must not read as "resolve nothing" (`:49-53`, and the enum's own doc at `TenancySettings.cs:22-26`).
  - `ValidateTenant` (`:71-106`): for each `(sourceName, override)` pair, computes which engines the override actually declares a connection string for. Zero engines is a failure and the loop moves on (`:76-86`). If `resolver` is null the source-existence check is skipped entirely (`:88-91`), which is what makes the validator usable in a container that never registered persistence (`:14-18`). Otherwise every declared engine whose source name is unknown produces a failure (`:93-104`).
  - `DeclaredEngines` (`:109-110`): a collection expression over `Engines` filtered by `ConnectionStringFor` being non-blank.
  - `IsKnownPhysicalSource` (`:117-119`): the round-trip test. `Default` always passes; otherwise the name must survive `resolver.ResolveLogical(engine, sourceName).Name` unchanged, because an unknown logical name collapses onto `Default` and therefore comes back different.
  - `ConnectionStringFor(DataSource, TenantDataSourceOverrideSettings)` (`:122-129`): `internal static`, a switch expression mapping engine to the matching connection-string property. It is `internal` rather than private because it is reused outside validation, which is the detail worth noting next.
- **Why it's built this way**: the engine-to-property mapping is needed in three places (validation, target expansion, and connection routing), so it lives once here and the runtime paths call back into the validator's `ConnectionStringFor` rather than re-implementing the switch ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). Making the resolver optional rather than required is what keeps the validator constructible in a host that binds tenancy without registering `AddInfrastructure`, at the cost of skipping the source-existence check there; the strategy and connection-string checks still run.
- **Where it's used**: registered by `AddMultiTenancy` alongside `ValidateOnStart` on the options (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:525-537`). Its `ConnectionStringFor` helper is called at run time by [`TenantDataSourceTargets`](#tenantdatasourcetargets)`.Expand` when deciding whether a (tenant, source) pair is really overridden (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:71`) and by [`DbContextFactory`](#dbcontextfactory)`.ResolveTenantOverride` when cloning the physical source for a tenant (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:154`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/AddMultiTenancyTests.cs`, which asserts the single-registration shape (`:97-98`) and drives the validator both without a resolver (`:168`) and with one (`:206`).
- **Caveats / not-in-source**: the type is `internal`, so it is not part of the framework's public API and a consumer cannot subclass or replace it; a host needing extra tenancy rules registers its own additional `IValidateOptions<TenancySettings>`.

### KeysetQueryBuilder

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/KeysetQueryBuilder.cs:22` · Level 5 · class (internal static)

- **What it is**: the expression-tree factory for keyset (also called seek) pagination. It resolves the requested sort column, builds the `(sortKey, Id)` ordering, builds the seek predicate that selects the rows strictly after a cursor's boundary row, and renders and parses cursor values with invariant culture (`KeysetQueryBuilder.cs:9-22`).
- **Depends on**: [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype) for the `Id` member it orders and seeks on (`KeysetQueryBuilder.cs:63`, `:67`), [`SpecificationEvaluator`](#specificationevaluator) for the actual `OrderBy` and `ThenBy` calls, and the BCL: `System.Linq.Expressions`, `System.Reflection`, `System.Globalization`, and `System.ComponentModel.TypeDescriptor` (`:1-5`).
- **Concept introduced, keyset pagination and why the tie-break is mandatory.** `[Rubric §12, Performance and Scalability]` assesses whether reads stay cheap as the table grows, and `[Rubric §9, API and Contract Design]` assesses whether the paging contract a client sees is honest. Offset paging (`OFFSET 40000 ROWS FETCH NEXT 20`) makes the database count past every skipped row, so page 2000 costs far more than page 20. Keyset paging instead orders by `(sortKey, Id)` and asks for the rows *after* the last row of the previous page, which the database can satisfy with a single index seek regardless of depth. The class doc states the second half of the idea, which is the part people skip (`KeysetQueryBuilder.cs:12-15`): the tie-break on `Id` is what makes the order **total**. Without it, two rows sharing a sort value can swap places between requests and be returned twice or never. The restriction to exactly one sort key is also deliberate and documented (`:18-20`): multi-key keyset paging needs a comparison whose size grows quadratically in the key count, and every provider translates it differently.
- **Walkthrough**
  - `TryResolveSortProperty<TEntity>(sortColumn, out property)` (`KeysetQueryBuilder.cs:35-47`) returns `true` with a `null` property when no column was requested (paging by `Id` alone, `:39-40`), and otherwise does a case-insensitive public-instance property lookup (`:42-44`). A `false` return means the client named something that does not exist, which the caller turns into a validation failure rather than an exception.
  - `ApplyOrdering<TEntity, TIdentifierType>(query, sortProperty, descending)` (`KeysetQueryBuilder.cs:59-75`) builds an `e => e.Id` selector from the shared parameter (`:66-67`), then either orders by `Id` alone in the requested direction (`:69-70`) or orders by the sort key in the requested direction and then by `Id` **always ascending** (`:72-74`). The comment at `:51` names the coupling: the identifier tie-break always ascends, which is exactly what the seek predicate assumes.
  - `BuildSeekPredicate<TEntity, TIdentifierType>(sortProperty, sortValue, lastId, descending)` (`KeysetQueryBuilder.cs:102-159`) is the heart of the type, and it has four branches:
    - **No sort key** (`:114-119`): the predicate is `Id > lastId`, flipped to `<` when the page descends, because there the identifier *is* the sort key.
    - **Null boundary on a non-nullable key** (`:128-132`): impossible by construction, so it degrades to the plain id seek rather than emitting a comparison against null.
    - **Null boundary on a nullable key** (`:134-142`): stated explicitly rather than left to SQL. Ascending, nulls sort first, so what remains is "any non-null value, or a null with a larger id"; descending, nulls sort last, so what remains is "a null with a larger id". The remarks at `:87-93` give exactly this reasoning, and the reason it is needed: SQL comparisons against NULL are unknown and would silently drop rows.
    - **Normal boundary** (`:145-158`): the classic composite `sort > v OR (sort == v AND Id > lastId)` (`:146-148`), with the sort half flipped to `<` for a descending page. When the key is nullable and the page descends, an extra `sort == null OR (...)` is prepended (`:150-156`), because `null < v` is unknown and the nulls that sort last would otherwise vanish.
  - `ToInvariantString(value)` (`KeysetQueryBuilder.cs:168-178`) renders a value for the cursor. The four date and time types use the round-trip `"O"` format specifically so a cursor never loses sub-second precision and re-seeks onto the wrong row (`:161-165`, `:171-174`); strings pass through (`:175`); anything `IFormattable` gets invariant formatting (`:176`); everything else falls back to `ToString()` (`:177`).
  - `TryFromInvariantString(targetType, text, out value)` (`KeysetQueryBuilder.cs:187-211`) is the inverse: unwrap `Nullable<T>` (`:191`), short-circuit for `string` (`:192-196`), otherwise use `TypeDescriptor.GetConverter` and `ConvertFromInvariantString` (`:198-205`), catching only `FormatException`, `NotSupportedException`, and `ArgumentException` and turning them into `false` (`:207-210`). A malformed cursor is a validation result, never an exception escaping the repository.
  - `Compare(left, right, greaterThan)` (`KeysetQueryBuilder.cs:224-258`) is the provider-translatability layer, and the remarks at `:216-223` explain why it cannot just call `Expression.GreaterThan`: that factory only exists for types that have the operator, which excludes `string`. So strings compare through `string.Compare(string, string)`, which EF translates into a native `>` or `<` (`:228-234`); types with a relational operator use it directly (`:236-241`); and anything else with an `IComparable<T>` implementation (a `Guid` key, for instance) compares through `CompareTo` (`:243-257`), whose translation is provider-specific. A type with none of the three gets a `NotSupportedException` naming the type (`:246-248`), which is a loud failure at query-build time rather than a wrong result.
  - `SupportsRelationalOperator` (`KeysetQueryBuilder.cs:260-269`) enumerates the primitive, enum, decimal, and date and time cases, and falls back to reflecting for a public static `op_GreaterThan`. `StringCompareMethod` and `ZeroConstant` (`:271-274`) are resolved once as statics.
- **Why it's built this way**: keyset paging is declared as a repository-level capability, deliberately not part of the HTTP query contract of [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html), and [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html) records that split along with the cursor format. Building the predicate as an expression tree rather than as SQL text is what keeps the same code working on more than one provider ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)); reusing [`SpecificationEvaluator`](#specificationevaluator)'s ordering step rather than reimplementing the ordering call means the keyset ORDER BY and the specification ORDER BY are produced by the same code.
- **Where it's used**: only by [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype)'s `GetPageByCursorAsync`, which calls `TryResolveSortProperty` (`EFReadRepository.cs:503`), `ApplyOrdering` (`:533`), `ToInvariantString` twice when encoding the next cursor (`:548-549`), and, through the private `TryBuildSeekPredicate`, `TryFromInvariantString` (`:570`, `:579`) and `BuildSeekPredicate` (`:584-585`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryKeysetPagingTests.cs`.
- **Caveats / not-in-source**: the `NotSupportedException` for an unorderable key type and the provider-specific translation of `CompareTo` are both real limits of the design, and neither is discoverable until a query is built for that key type. No first-party call site in MMCA.ADC or MMCA.Store calls `GetPageByCursorAsync` today (the only references outside MMCA.Common are the test-support fakes in `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Application.Tests/Support/TestSupport.cs` and its Identity sibling), so which key and sort types have actually been exercised against a real engine is established by the test suite rather than by production usage.

### EFReadRepository<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:19` · Level 6 · class (internal)

- **What it is**: the EF Core implementation of [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype), the read half of the repository contract: get by id, get many, projected reads, first-or-default, grouped counts and sums, soft-delete-aware finds, lookups, counts, existence checks, specification-driven reads, and keyset pages, with no mutation surface at all (`EFReadRepository.cs:14-19`).
- **Depends on**: EF Core's `DbContext` and `DbSet<TEntity>`, taken as its one primary-constructor parameter (`EFReadRepository.cs:19-25`); [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) as the contract (declared at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:330`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) as the entity constraint (`:22`); [`SpecificationEvaluator`](#specificationevaluator) and [`KeysetQueryBuilder`](#keysetquerybuilder) as its two composition helpers; [`ApplicationDbContext`](#applicationdbcontext) for the soft-delete filter name (`:33`); and [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error), [`KeysetPageRequest`](group-01-result-error-handling.md#keysetpagerequest), [`KeysetCollectionResult<T>`](group-01-result-error-handling.md#keysetcollectionresultt), [`KeysetCursor`](group-01-result-error-handling.md#keysetcursor), and [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) for the shapes it returns.
- **Concept introduced, naming the query filter you drop.** `[Rubric §11, Security]` assesses whether isolation boundaries hold under every code path, and `[Rubric §8, Data Architecture]` assesses whether the query-filter design is deliberate. EF 10 gives global query filters **names**, and the framework registers two on the model: `SoftDelete` and `Tenant` ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)). EF's parameterless `IgnoreQueryFilters()` drops *all* of them. That means a caller who only wanted to see soft-deleted rows would, with the parameterless call, also read across every tenant. So the repository declares a one-element array naming exactly the filter it is willing to drop (`EFReadRepository.cs:27-33`, resolving `ApplicationDbContext.SoftDeleteFilterName` from `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:388`) and every `ignoreQueryFilters: true` path passes it (`:52`, `:81`, `:102`, `:198`, `:288`, `:365`, `:379`, `:446`). This is the kind of detail worth copying wherever you add a filter-bypassing read.
- **Concept, tracked versus no-tracking as an explicit repository decision.** `[Rubric §12, Performance and Scalability]`. The four queryable properties at `EFReadRepository.cs:406-415` are the vocabulary: `Table` (tracked), `TableNoTracking`, `TableNoTrackingSingleQuery`, and `TableNoTrackingSplitQuery`. Read paths default to no-tracking to avoid change-tracker overhead, but two exceptions are load-bearing and both are commented in place, see the walkthrough below.
- **Walkthrough**
  - The protected `_context` field is guarded at construction (`EFReadRepository.cs:25`), and `Entities` is a `virtual` property resolving `_context.Set<TEntity>()` (`:35`). Every member goes through one of those two, which is what makes the class subclassable by [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype).
  - `GetAllAsync` (`EFReadRepository.cs:38-66`) is the widest read: pick tracked or untracked (`:47-49`), optionally drop the named soft-delete filter (`:51-52`), apply includes (`:54`), then optional `where` (`:56-57`), then optional `orderBy` (`:59-60`), then materialize with or without a `select` (`:62-65`). Every parameter is optional, which is what makes it the general-purpose read the older query paths call.
  - `GetProjectedAsync<TResult>` (`EFReadRepository.cs:69-87`) is the projection-first read: no includes at all, because a projection selects its own columns, and the `Select` is applied in the database rather than after materialization (`:86`).
  - `FirstOrDefaultAsync(where, includes, ...)` (`EFReadRepository.cs:90-109`) is the predicate overload, and the comment at `:107` records the point: the predicate goes into EF's `FirstOrDefaultAsync` so the database issues a `TOP 1`, rather than materializing a set and narrowing it in memory.
  - `FirstOrDefaultAsync(specification)` (`EFReadRepository.cs:112-124`) is the specification overload, and unlike the aggregate reads it applies the **full** shape, ordering included. The comment at `:118-119` is the reason: "first" is only meaningful against a defined order, and the specification is where that order is declared.
  - `CountByAsync<TKey>` (`EFReadRepository.cs:127-147`) and `SumByAsync<TKey>` (`:150-175`) are the two grouped aggregates. Both run untracked, apply the optional predicate, group in the database, and project into the private records [`GroupedCount<TKey>`](#groupedcounttkey) (`:142`) and [`GroupedSum<TKey>`](#groupedsumtkey) (`:170`) before flattening to a dictionary (`:146`, `:174`). The comment at `:165-167` explains why `SumByAsync` passes the sum selector as `GroupBy`'s *element* selector: it keeps the caller's expression tree intact all the way to the provider.
  - `FindIncludingDeletedAsync` (`EFReadRepository.cs:188-214`) returns a named tuple of active and soft-deleted matches. The comment at `:196-197` is the design point: it drops the soft-delete filter and reads **once**, then partitions in memory (`:205-211`), because two separate queries would let a concurrent delete land between them and report the same row in neither half.
  - `GetAllForLookupAsync` (`EFReadRepository.cs:217-235`) returns id and name pairs ordered by name, where "name" is a *runtime* property name. The projection expression that binds `BaseLookup<TIdentifierType>.Id` and `.Name` is built by reflection in `GetOrBuildLookupSelector` (`:247-269`) and memoized in a `ConcurrentDictionary` keyed by `(entity type, property name)` (`:242`), so the expression-tree construction happens once per pair. The built expression coalesces a `string` property to empty and calls `ToString()` on a non-string one (`:256-260`), so a lookup never yields a null display name.
  - `GetByIdsAsync` (`EFReadRepository.cs:272-294`) materializes the id sequence once, short-circuits on an empty set with an empty result (`:281-283`), and translates to a single `Contains` (in other words a SQL `IN`) rather than N round trips (`:293`).
  - `GetByIdAsync(id)` (`EFReadRepository.cs:297-309`) carries the single most important comment in the file (`:303-307`) and it encodes two separate bug fixes. First, it is a **filtered query, not `FindAsync`**: `FindAsync` serves a tracked instance straight out of the identity map without evaluating the global soft-delete filter, so an entity soft-deleted earlier in the same scope came back as if it were live. Second, it queries `Table` (**tracked**) on purpose: [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) inherits this member and the generic delete and update handlers load through it, mutate the instance, and save, so a no-tracking query would turn those writes into silent no-ops.
  - `GetByIdAsync(id, includes, asTracking)` (`EFReadRepository.cs:312-325`) is the include-carrying overload and defaults to no-tracking, because a caller asking for includes is normally reading for display.
  - The three `CountAsync` overloads (`EFReadRepository.cs:328-352`) cover no predicate, an expression predicate, and a specification. The specification overload composes through [`SpecificationEvaluator`](#specificationevaluator) with `applyShape: false` (`:348-349`), so includes, ordering, and paging never reach a COUNT.
  - The two `ExistsAsync` overloads (`EFReadRepository.cs:357-382`) both funnel into the private `AnyAsync` helper (`:394-400`), which is provider-aware. The remarks at `:387-393` are worth reading before you touch it: Cosmos gets `CountAsync` because its provider generates invalid SQL (an unresolved `root` identifier) when translating a predicated `AnyAsync` into a subquery; every other provider gets `AnyAsync`, which short-circuits at the first match. The cost of the workaround is stated honestly in the same remark: `CountAsync` reads every matching row, so on a wide predicate the Cosmos path is proportional to the number of matches. `IsCosmosProvider` (`:402-403`) is a provider-name test.
  - `ApplyIncludes` (`EFReadRepository.cs:426-429`) is a `protected static` forwarder to [`SpecificationEvaluator`](#specificationevaluator), including the collection-navigation split-query auto-switch. The doc at `:417-425` says why: the logic lives once so the string-include path and the specification path cannot drift apart.
  - `BaseQueryFor` (`EFReadRepository.cs:439-448`) is the boundary [`SpecificationEvaluator`](#specificationevaluator) refuses to cross. It reads `AsTracking` and `IgnoreQueryFilters` off a [`QuerySpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#queryspecificationtentity-tidentifiertype) when the specification is one, and gives a plain `ISpecification` the untracked, filtered default.
  - The two `ListAsync` overloads (`EFReadRepository.cs:451-479`) apply the specification to that base. In the projecting overload the comment at `:472-473` records the ordering rule: `Select` comes **last**, so ordering and paging run over entity rows and only the resulting page is projected.
  - `AnyAsync(specification)` (`EFReadRepository.cs:482-493`) uses criteria only, through the same Cosmos-aware existence check the predicate overloads use (`:489-492`).
  - `GetPageByCursorAsync` (`EFReadRepository.cs:496-553`) is the keyset page, and it is the one read that returns a [`Result`](group-01-result-error-handling.md#result) rather than a bare value, because two of its failures are caller errors rather than exceptions. An unknown sort column returns `Error.InvalidEntityField` with the column and type named (`:503-512`); a malformed cursor returns a validation error with code `Error.InvalidCursor` (`:520-528`). Between those it applies the optional specification with `applyShape: false` (`:514-516`), the seek predicate (`:530`), and the `(sortKey, Id)` ordering (`:533`). The `Take(request.PageSize + 1)` at `:537` is the next-page probe, and the comment at `:535-536` explains the choice: the extra row is never returned, it only says whether a next page exists, which is cheaper and more honest than a COUNT over the whole set. The probe row is trimmed (`:539-541`), and a next cursor is encoded from the last surviving row only when there is more (`:543-550`).
  - `TryBuildSeekPredicate` (`EFReadRepository.cs:560-588`) is the private decode-and-build: reject a cursor that fails `KeysetCursor.TryDecode` (`:567`), reject an id segment that does not parse to `TIdentifierType` (`:570-574`), reject a sort segment that does not parse to the sort property's type (`:576-582`), and otherwise hand the parsed values to [`KeysetQueryBuilder`](#keysetquerybuilder) (`:584-585`).
- **Why it's built this way**: `internal` rather than public, and every member `virtual`, is what lets [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype) extend it with writes while consumers hold only the interface. Concentrating the tracking and filter-scope decisions here and pushing pure composition into [`SpecificationEvaluator`](#specificationevaluator) and [`KeysetQueryBuilder`](#keysetquerybuilder) is what keeps this class about *policy* and those about *mechanism*. The contract and its evolution are recorded in [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html); the interface segregation into [`IEntityReader<TEntity, TIdentifierType>`](#ientityreadertentity-tidentifiertype) and [`IEntityQuerier<TEntity, TIdentifierType>`](#ientityqueriertentity-tidentifiertype) beneath `IReadRepository` is what makes a read-only consumer unable to write at all (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:21`, `:80`, `:330`).
- **Where it's used**: constructed by [`RepositoryFactory`](#repositoryfactory)'s `CreateReadOnly` through a cached `ActivatorUtilities` factory taking the `DbContext` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:55-56`), optionally wrapped in [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) (`:58-63`). Application code reaches it through [`IUnitOfWork`](#iunitofwork)'s `GetReadRepository`, implemented at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:53-66`. Covered by `EFReadRepositoryReadSurfaceTests.cs`, `EFReadRepositoryKeysetPagingTests.cs`, `EFReadRepositorySpecificationTests.cs`, `EFReadRepositoryGetByIdFilterTests.cs`, and `EFReadRepositoryProjectedFilterTests.cs` under `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/`.
- **Caveats / not-in-source**: `GetAllForLookupAsync` resolves `nameProperty` by reflection at runtime (`EFReadRepository.cs:254`), so an unknown name fails from the expression build rather than at compile time; the source contains no validation of that argument beyond what `Expression.Property` itself enforces. `FindIncludingDeletedAsync` partitions in memory, so it materializes every matching row including the deleted ones: the source imposes no upper bound on that set.

### EFReadRepositoryDecorator<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepositoryDecorator.cs:17` · Level 6 · class (internal)

- **What it is**: a pass-through decorator over [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) that wraps every asynchronous operation in a MiniProfiler timing step, for per-query performance visibility in development (`EFReadRepositoryDecorator.cs:10-17`).
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (both the interface it implements and the inner instance it holds, `EFReadRepositoryDecorator.cs:17-23`) and [`ProfilingHelper`](#profilinghelper) for the timing steps (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/ProfilingHelper.cs:9`, `:11-12`, `:26-30`).
- **Concept introduced, the decorator as an opt-in cross-cutting wrapper.** `[Rubric §2, Design Patterns]` assesses whether the decorator pattern is used where behavior must compose without modifying the decorated type, `[Rubric §13, Observability and Operability]` assesses whether the system can be asked where its time goes, and `[Rubric §1, SOLID]` covers the open-closed consequence: [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) contains no profiling code and does not know profiling exists. Because both types implement the same interface, the decision to profile is a composition decision made once at construction time, not a branch inside every method. This is the same decorator idea the CQRS pipeline uses for logging, caching, and transactions, applied one layer lower.
- **Walkthrough**
  - `ClassName` is a `const` set to the string `"EFReadRepository"`, not to the decorator's own name (`EFReadRepositoryDecorator.cs:22`). That is deliberate: the profiler timeline should name the operation being measured, and the decorator is an implementation detail of measuring it. `ProfilingHelper.BeginStep` prefixes it with the assembly name to produce the label `MMCA.Common.Infrastructure.EFReadRepository: {method}` (`ProfilingHelper.cs:11-12`).
  - `_inner` is guarded at construction (`EFReadRepositoryDecorator.cs:23`).
  - Every asynchronous member is one expression-bodied forwarder of the same shape: `ProfilingHelper.ProfileAsync(ClassName, nameof(Member), () => _inner.Member(...))`. The full set is `GetAllAsync` (`:25-34`), `GetProjectedAsync` (`:36-43`), both `FirstOrDefaultAsync` overloads (`:45-52`, `:54-58`), `CountByAsync` (`:60-66`), `SumByAsync` (`:68-75`), `FindIncludingDeletedAsync` (`:77-83`), `GetAllForLookupAsync` (`:85-91`), `GetByIdsAsync` (`:93-100`), both `GetByIdAsync` overloads (`:102-104`, `:106-108`), all three `CountAsync` overloads (`:110-112`, `:114-116`, `:118-122`), both `ExistsAsync` overloads (`:124-126`, `:128-130`), both `ListAsync` overloads (`:132-136`, `:138-143`), `AnyAsync` (`:145-149`), and `GetPageByCursorAsync` (`:151-156`). Overloads share one `nameof`, so they appear under one label in the profile.
  - The four queryable properties are **not** profiled: `Table`, `TableNoTracking`, `TableNoTrackingSingleQuery`, and `TableNoTrackingSplitQuery` are plain forwarders (`EFReadRepositoryDecorator.cs:158-161`). That is correct rather than an omission: those properties only build a queryable, and the time that matters is spent wherever the caller finally materializes it.
  - The class is `internal` and, unlike its sibling, **not sealed**, because [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype) derives from it.
- **Why it's built this way**: an explicit hand-written decorator over a generic interface with a stable member list keeps the profiling surface obvious and debuggable, at the cost of one forwarder per member. The wrapping is conditional at composition time, so a host with profiling off pays nothing at all, not even a delegate hop. `ProfilingHelper.BeginStep` itself null-conditionals off `MiniProfiler.Current`, so even a wrapped call is a no-op when no profiler is running (`ProfilingHelper.cs:11-12`).
- **Where it's used**: applied by [`RepositoryFactory`](#repositoryfactory)'s `CreateReadOnly` only when `UseMiniProfiler` is true on the application settings (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:58-63`, with the doc stating the condition at `:45-49`). Extended by [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorTests.cs` and `.../EFReadRepositoryDecoratorAdditionalTests.cs`.

### EFRepositoryDecorator<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:14` · Level 7 · class (internal sealed)

- **What it is**: the read-write half of the profiling decorator. It extends [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) and adds forwarders for the mutation members of [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype): add, update, row-version, execute-delete, and execute-update (`EFRepositoryDecorator.cs:7-14`).
- **Depends on**: [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype), its base class [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype), [`ProfilingHelper`](#profilinghelper), [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) for the child-entity concurrency overload (`EFRepositoryDecorator.cs:45`), and [`IUpdatePropertySetter<TEntity>`](#iupdatepropertysettertentity) in the `ExecuteUpdateAsync` signature (`:56`).
- **Concept, decorating a derived contract by passing the same instance twice.** `[Rubric §1, SOLID]`. The declaration is the interesting line: `EFRepositoryDecorator(IRepository<...> inner)` deriving from `EFReadRepositoryDecorator<...>(inner)` while implementing `IRepository<...>` (`EFRepositoryDecorator.cs:14-18`). The single `inner` argument is handed to the base constructor as an `IReadRepository` **and** stored again in this class's own `_inner` as an `IRepository` (`:21`). One object, two typed references: the inherited read members forward through the base's field, the write members through this one. That works precisely because [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) extends [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) and [`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:467`), so the read decorator can be reused verbatim rather than re-forwarded.
- **Walkthrough**
  - `ClassName` is `"EFRepository"` here (`EFRepositoryDecorator.cs:20`), so writes appear under the read-write repository's label while inherited reads keep the read repository's label.
  - Asynchronous writes follow the base's shape: `AddAsync` (`:23-25`), `AddRangeAsync` (`:27-29`), `UpdateAsync` (`:31-33`), `ExecuteDeleteAsync` (`:48-52`), and `ExecuteUpdateAsync` (`:54-59`).
  - The one synchronous profiled member uses the other helper shape: `UpdateRange` opens a `using var step = ProfilingHelper.BeginStep(...)` and then calls through (`EFRepositoryDecorator.cs:35-39`).
  - Both `SetOriginalRowVersion` overloads, the entity one and the [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) child one, are **unprofiled** straight pass-throughs (`EFRepositoryDecorator.cs:41-46`). They only stamp an original value on a change-tracker entry, so there is no I/O to time.
  - `sealed`, unlike its base: nothing derives from it.
- **Why it's built this way**: inheriting the read decorator rather than composing a second one avoids duplicating twenty-one forwarders, and keeps the two class-name labels distinct so a profile distinguishes a read issued through the write repository from one issued through a read-only repository.
- **Where it's used**: applied by [`RepositoryFactory`](#repositoryfactory)'s `Create` when `UseMiniProfiler` is true (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:34-39`, documented at `:21-25`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorTests.cs` and `.../EFRepositoryDecoratorAdditionalTests.cs`.
- **Caveats / not-in-source**: there is no `Save` or `SaveChangesAsync` forwarder here, and none is missing: flushing is [`IUnitOfWork`](#iunitofwork)'s job, not the repository's, so [`IWriteRepository<TEntity, TIdentifierType>`](#iwriterepositorytentity-tidentifiertype) declares no save member at all (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:367-454`).

### EFRepository<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:23` · Level 9 · class (internal sealed)

- **What it is**: the read-write EF Core repository. It extends [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype) with add, update, concurrency-token, and set-based delete and update operations, implementing [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) (`EFRepository.cs:10-29`). It stages changes and never saves: the class doc says so outright at `:12`.
- **Depends on**: the base read repository, constructed with the same `DbContext` (`EFRepository.cs:24`, `:26`); two **optional** constructor dependencies, `TimeProvider` and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (`:24-25`); [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity) for set-based updates (`:113`); [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) as the entity constraint (`:27`); and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype), [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned), and [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) for the concurrency and audit member names.
- **Concept introduced, the two write paths and why one of them must stamp its own audit fields.** `[Rubric §8, Data Architecture]` assesses whether audit metadata is reliably captured, and `[Rubric §10, Cross-Cutting Concerns]` assesses whether a cross-cutting policy holds on every path rather than the common one. The framework's normal write path is change-tracked: load, mutate, save, and the save interceptors stamp `LastModifiedOn` and `LastModifiedBy` and dispatch domain events. The second path is set-based: `ExecuteUpdate` and `ExecuteDelete` issue one SQL statement over matching rows without loading or tracking them, which is far cheaper on a wide update but **bypasses the save pipeline entirely**, interceptors included. Rather than pretend the two paths are the same, this class closes the gap explicitly for audit fields on `ExecuteUpdateAsync` (`EFRepository.cs:119-130`). The class-level `<remarks>` (`:16-21`) states what the two optional dependencies are for and what happens without them: the clock and the acting user serve `ExecuteUpdateAsync`, and when they are absent (direct construction in tests) the system clock is used and the user stamp is skipped.
- **Concept, the optional dependency as a testability affordance.** `[Rubric §14, Testability]`. `TimeProvider` and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) default to `null` (`EFRepository.cs:25-26`), which is what lets a test construct the repository with just a context, while production construction through `ActivatorUtilities` fills both from the container. Taking `TimeProvider` at all, rather than calling `DateTime.UtcNow`, is what makes the timestamp deterministic under test, which is exactly what `EFRepositoryAuditStampTests` exercises.
- **Walkthrough**
  - `AddAsync` and `AddRangeAsync` (`EFRepository.cs:32-43`) are thin guarded forwarders to `Entities.AddAsync` and `AddRangeAsync`. Nothing is saved here; persistence happens at the unit of work's save.
  - `UpdateAsync` (`EFRepository.cs:52-65`) has the one non-obvious body in the mutation set. It first asks the change tracker whether this key is already tracked, and if so copies values onto the tracked entry with `CurrentValues.SetValues` instead of attaching a second instance, which would throw an "already tracked" exception (`:44-50`, `:57-59`). The comment at `:55-56` explains the lookup choice: `Entities.Local.FindEntry(entity.Id)` is an O(1) key lookup against the identity map that never falls back to the database, replacing a linear scan of the `LocalView`. Untracked entities go through `Entities.Update`, which attaches and marks modified (`:61`). The method returns `Task.CompletedTask` (`:63`): it is asynchronous only for signature compatibility.
  - `UpdateRange` (`EFRepository.cs:68-72`) is the guarded batch forwarder.
  - The two `SetOriginalRowVersion` overloads (`EFRepository.cs:75-94`) implement optimistic concurrency by writing the client's known row version into the tracked entry's **original** value, so EF's generated UPDATE carries it in the WHERE clause and a concurrent modification raises a concurrency exception instead of silently winning. Both null-guard their arguments and then assign unconditionally (`:76-81`, `:87-92`). The second overload takes an [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) child entity and casts to `object` for `Entry` (`:90`), which is how a child of the aggregate gets the same protection without being an aggregate root itself.
  - `ExecuteDeleteAsync` (`EFRepository.cs:97-103`) is the set-based delete: `Entities.Where(where).ExecuteDeleteAsync(...)`, returning the affected row count (`:101`).
  - `ExecuteUpdateAsync` (`EFRepository.cs:106-133`) is the flagship. It guards both arguments (`:110-111`), constructs an [`UpdatePropertySetterBuilder<TEntity>`](#updatepropertysetterbuildertentity) (`:113`), lets the caller describe the assignments against the persistence-agnostic interface (`:114`), and throws `ArgumentException` when nothing was described (`:115-116`). Then it stamps: `LastModifiedOn` from `(timeProvider ?? TimeProvider.System).GetUtcNow().UtcDateTime` unless the caller already set it (`:120-124`), and `LastModifiedBy` from the current user unless the caller already set it and only when a user id is actually available (`:126-129`). Both guards go through `builder.SetsProperty`, so an explicit caller assignment always wins. Finally the recorded assignments are replayed into EF as a method group (`:131`).
  - `sealed`, and the mutation members are non-virtual: this is the end of the inheritance chain.
- **Why it's built this way**: keeping the write members on a subclass of the read repository rather than on a parallel type means the read behavior a write handler relies on (the tracked `GetByIdAsync`, most of all) is literally the same code a query handler runs. The contract is [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html), and the split between staging here and flushing in [`IUnitOfWork`](#iunitofwork) is what makes one transaction span several repositories.
- **Where it's used**: constructed by [`RepositoryFactory`](#repositoryfactory)'s `Create` through the same cached `ActivatorUtilities` factory (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:31-32`), optionally wrapped in [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype) (`:34-39`). Application code reaches it through [`IUnitOfWork`](#iunitofwork)'s `GetRepository` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:33`). Covered by `EFRepositoryAdditionalTests.cs`, `EFRepositoryAuditStampTests.cs`, and `EFRepositoryIntegrationTests.cs` under `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/`.
- **Caveats / not-in-source**: `ExecuteUpdateAsync` and `ExecuteDeleteAsync` bypass the save pipeline, so beyond the two audit columns stamped here they raise **no** domain events and run **no** other interceptor, the tenant guard included. The source stamps the audit fields and nothing else; whether a given set-based call site needed an event is a judgement the framework does not make for you.

### DesignTimeDbContextOptions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:11` · Level 1 · class (public sealed)

- **What it is**: the configuration carrier a migrations project fills in so [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) can build a context for `dotnet ef` without the application's DI container. It holds the connection settings, the named data sources, the explicit list of entity-configuration assemblies, and three flags that decide which framework-owned tables belong to the scaffolded model (`DesignTimeDbContextOptions.cs:11-94`).
- **Depends on**: [`ConnectionStringSettings`](group-07-persistence-ef-core.md#connectionstringsettings) and [`DataSourceEntrySettings`](group-07-persistence-ef-core.md#datasourceentrysettings) from `MMCA.Common.Infrastructure.Settings`, plus `System.Reflection.Assembly`.
- **Concept introduced, the design-time model has to be assembled by hand.** `[Rubric §17, DevOps and Deployment]` assesses whether the build and release machinery is deliberate rather than incidental, and `[Rubric §33, Developer Experience]` assesses how much ceremony a routine task costs. At run time the framework discovers entity configurations by scanning loaded assemblies, and it reads flags such as `Scheduler:Enabled` out of the host's configuration. `dotnet ef` has neither: it loads the migrations project, calls `IDesignTimeDbContextFactory<T>.CreateDbContext`, and there is no host, no `IConfiguration`, and no AppDomain full of module assemblies to scan. Every input the model needs must therefore be stated explicitly, and this class is the shape of that statement. The doc comment says exactly that for the assemblies (`DesignTimeDbContextOptions.cs:75-78`): they must be listed explicitly, because the runtime scan sees nothing at design time.
- **Walkthrough**
  - `DataSourceName` (`DesignTimeDbContextOptions.cs:18`) names the logical source to build for. When it is left `null` the helper parses `--datasource` from the design-time arguments and finally falls back to `Default` (`:13-17`).
  - `ConnectionStrings` (`DesignTimeDbContextOptions.cs:24`) is the top-level (`Default`) settings object, and `DataSources` (`:27`) is the dictionary mirroring the `DataSources` configuration section. Between them they reproduce, in code, exactly what a host's `appsettings.json` would supply.
  - `EnableScheduler` (`DesignTimeDbContextOptions.cs:41`) puts the `ScheduledJobs` table in the design-time model. It defaults to `false` so `dotnet ef` keeps producing the migrations it produced before the scheduler shipped (`:29-34`), and its remarks pin the scope: set it in the migrations project of the `Default` data source of a host that calls `AddScheduledJobs`, and only there, because a second project enabling it would create a second copy of a host-scoped table (`:35-40`).
  - `EnableAuditTrail` (`DesignTimeDbContextOptions.cs:55`) does the same for `AuditTrailEntries`, with the opposite scope rule: set it in **every** data source whose entities are audited, because a trail row is written to the database holding the entity that changed (`:49-54`).
  - `EnableRefreshSessions` (`DesignTimeDbContextOptions.cs:73`) does the same for `RefreshSessions`, back to single-database scope: sessions are one module's data (`:63-72`). Its remarks name the one twist that separates it from the other two, and it is a real trap: there is no data-source setting to pass alongside the flag, because the helper registers the source the context *actually resolved to*, which is not always the logical name asked for.
  - `ConfigurationAssemblies` (`DesignTimeDbContextOptions.cs:79`) is the explicit assembly list, and `AddConfigurationAssembly` (`:84-93`) is the chaining adder: null-guard, add only when not already present (`:86-90`), return `this` (`:92`).
  - Each of the three flags carries the same warning in its remarks: the flag must match the host's configuration, or the scaffolded migrations and the running model disagree, which is what `dotnet ef migrations has-pending-model-changes` reports (`:71-72`).
- **Why it's built this way**: database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) means one migrations project per database, so the design-time entry point has to be told which database it is scaffolding rather than inferring it. Making the framework-table flags default to `false` is the conservative choice: a consumer that never adopted the scheduler, the audit trail or multi-device sessions ([ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html)) scaffolds exactly what it scaffolded before, and adopting a feature is an explicit one-line opt-in in one migrations project.
- **Where it's used**: constructed and handed to the caller's callback inside [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:99-100`). Every consumer's migrations projects configure it: `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/DesignTimeSQLServerDbContextFactory.cs:30-51` (the one project in ADC that sets `EnableRefreshSessions`, at `:44`), the Conference, Engagement and Notification siblings, `MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Identity/DesignTimeSQLServerDbContextFactory.cs:50`, and `MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/DesignTimeSQLServerDbContextFactory.cs:32-45` (which enables the audit trail and the scheduler but not sessions).

### ExplicitAssemblyProvider

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:186` · Level 1 · class (private sealed nested)

- **What it is**: a four-line [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) that returns the exact list of assemblies it was constructed with, nested inside [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) (`DesignTimeDbContextHelper.cs:186-189`).
- **Depends on**: [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) and `System.Reflection.Assembly`.
- **Concept**: this is the design-time counterpart of [`DefaultEntityConfigurationAssemblyProvider`](#defaultentityconfigurationassemblyprovider), and the contrast is the whole point. `[Rubric §14, Testability]` assesses whether a component's inputs can be supplied directly rather than discovered ambiently, and `[Rubric §1, SOLID]` assesses whether the dependency inversion actually buys substitutability. Because the assembly list sits behind an interface rather than a hard-coded scan, "scan the AppDomain" and "here are exactly these three assemblies" are two implementations of one contract, and the rest of the model-building stack cannot tell them apart. That is what lets `dotnet ef` build a real model in a process where a scan would find nothing.
- **Walkthrough**: a primary constructor takes `IReadOnlyList<Assembly>` and `GetConfigurationAssemblies()` returns it unchanged (`DesignTimeDbContextHelper.cs:186-188`). No caching, no filtering, no ordering: the caller already decided.
- **Why it's built this way**: `private sealed` and nested means it exists only for the helper's own call path and cannot become a public extension point by accident. It is constructed from the caller's `ConfigurationAssemblies` list with a spread so later mutation of the options object cannot change the model (`DesignTimeDbContextHelper.cs:106`).
- **Where it's used**: built once per design-time context and used three ways, registered as the DI-visible [`IEntityConfigurationAssemblyProvider`](#ientityconfigurationassemblyprovider) (`DesignTimeDbContextHelper.cs:156`), passed directly to the context constructor (`:57`, `:78`), and handed to the [`EntityDataSourceRegistry`](#entitydatasourceregistry) that decides which entities belong to which physical source (`:110`).

### IndexBuilderExtensions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/IndexBuilderExtensions.cs:10` · Level 2 · class (public static, extension container)

- **What it is**: a single C# `extension(IndexBuilder)` block exposing one member, `HasSoftDeleteFilter(...)`, which attaches the `IsDeleted = 0` predicate to a hand-authored index in an entity type configuration (`IndexBuilderExtensions.cs:10-12`, member at `:50-64`).
- **Depends on**: [`SoftDeleteFilterSql`](#softdeletefiltersql) (the shared predicate builder, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:27`), the [`DataSource`](#datasource) engine enum, and EF Core's `Microsoft.EntityFrameworkCore.Metadata.Builders.IndexBuilder`.
- **Concept introduced, the filtered (partial) index under soft delete.** `[Rubric §8, Data Architecture]` assesses whether the storage design accounts for the consequences of its own conventions, and `[Rubric §12, Performance and Scalability]` assesses whether indexes match the queries they serve. Soft delete ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)) means a "deleted" row is still physically present with `IsDeleted = 1`, and the global query filter on [`ApplicationDbContext`](#applicationdbcontext) hides it from every read. An index that does not carry the same predicate therefore indexes rows no query will ever return: the deleted rows still occupy index pages, and the optimizer's row estimates include them. The doc comment states this in one sentence (`IndexBuilderExtensions.cs:14-18`). Adding `WHERE [IsDeleted] = 0` to the index makes it a *filtered* index (SQL Server's term; SQLite calls the same thing a partial index) that matches the shape of every query the application actually issues.
- **Walkthrough**
  - The extension receiver is the `IndexBuilder` returned by `builder.HasIndex(...)`, so the call chains directly off the index declaration (`IndexBuilderExtensions.cs:12`, usage sample at `:23-26`).
  - `engine` defaults to `DataSource.SQLServer` (`IndexBuilderExtensions.cs:51`), which matches the majority case of a configuration deriving from [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype); a SQLite configuration passes `DataSource.Sqlite` explicitly (`:37-42`).
  - `additionalFilter` is the optional second predicate for an index that is already conditional on something else. The two are joined as `{additionalFilter} AND {filterSql}` in that exact order (`IndexBuilderExtensions.cs:60-63`), which is deliberate: it reproduces the SQL of the hand-authored literal the helper replaced, so switching to the helper does not force a migration. It is also the order [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) uses when it appends its own clause, so the two paths yield byte-identical SQL for the same pair of predicates.
  - The body null-guards the receiver, asks [`SoftDeleteFilterSql`](#softdeletefiltersql) to build the predicate from the model's own metadata, and returns the builder unchanged when the builder returns `null` (`IndexBuilderExtensions.cs:54-58`). That `null` is the Cosmos no-op and the "this entity is not soft-deletable" case, so the call is always safe to write.
- **Why it's built this way**: the doc comment gives the rationale directly (`IndexBuilderExtensions.cs:27-29`). A literal `HasFilter("[IsDeleted] = 0")` hard-codes both the column name and SQL Server's bracket quoting; reading the column name from the model means a `HasColumnName` rename follows automatically, and delegating the quoting to the engine keeps the same configuration body valid on SQLite. This is the portability posture of [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html). The division of labour with [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) is explicit: the convention covers every UNIQUE index automatically, and this extension point exists for the case the convention deliberately leaves alone, a hand-authored NON-unique index (`IndexBuilderExtensions.cs:20-22`). The pair of them is [ADR-095](https://ivanball.github.io/docs/adr/095-soft-delete-unique-indexes.html).
- **Where it's used**: entity configurations across both applications. In MMCA.Store: `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Persistence/EntityConfiguration/OrderConfiguration.cs:44,51,58` (the last one with `additionalFilter: "[StripeSessionId] IS NOT NULL"`), `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:69,83`, `.../EntityConfiguration/CustomerConfiguration.cs:82`, `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/EntityConfiguration/ProductConfiguration.cs:43`, `.../ProductImageConfiguration.cs:54`, `.../ProductVariantConfiguration.cs:46`, `.../CategoryConfiguration.cs:33`. In MMCA.ADC's Engagement module: `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/CheckIns/CheckInConfiguration.cs:51,56,62,66,69`, `.../PointsEntryConfiguration.cs:48,52`, `.../LivePollVoteConfiguration.cs:37`, `.../LeaderboardOptInConfiguration.cs:35`, `.../SessionQuestionUpvoteConfiguration.cs:34`, `.../UserSessionBookmarkConfiguration.cs:34,39`. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/IndexBuilderExtensionsTests.cs`.
- **Caveats / not-in-source**: the ordering constraint is called out in the doc comment (`IndexBuilderExtensions.cs:31-35`). Unlike the convention, which runs at model finalizing, this member reads the column name at the moment it is called, so a `HasColumnName` on the soft-delete property must be declared before the index. That only bites a model that renames the column.

### NullDomainEventDispatcher

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:191` · Level 2 · class (private sealed nested)

- **What it is**: a no-op [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) whose `DispatchAsync` returns `Task.CompletedTask`, nested inside [`DesignTimeDbContextHelper`](#designtimedbcontexthelper) and used only there (`DesignTimeDbContextHelper.cs:191-195`).
- **Depends on**: [`IDomainEventDispatcher`](group-04-events-outbox.md#idomaineventdispatcher) and [`IDomainEvent`](group-04-events-outbox.md#idomainevent).
- **Concept**: the Null Object pattern. `[Rubric §2, Design Patterns]` assesses whether a named pattern is used where it genuinely fits rather than decoratively. A `DbContext` in this framework is constructed with a live service provider and resolves interceptors from it, one of which ([`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor)) needs a dispatcher. Design time has no message bus, no handlers and no host, and it never calls `SaveChanges` anyway, so the dependency has to *exist* but must never do anything. Supplying a harmless implementation is cheaper and safer than making the dependency optional in the production type, where "optional" would mean a nullable field that every runtime path has to defend against.
- **Walkthrough**: the single member is an expression-bodied `DispatchAsync(IEnumerable<IDomainEvent>, CancellationToken)` returning `Task.CompletedTask` (`DesignTimeDbContextHelper.cs:193-194`). It ignores both arguments, which is the whole contract.
- **Why it's built this way**: it is `private sealed` and nested so it can never be resolved by a production host by mistake. Registering it as the singleton `IDomainEventDispatcher` (`DesignTimeDbContextHelper.cs:123`) is what lets the design-time container build the same interceptor set the runtime builds, which is the property that keeps a scaffolded migration honest: the design-time pipeline differs from the runtime pipeline in nothing that touches the model.
- **Where it's used**: registered once in `BuildDesignTimeServices` (`DesignTimeDbContextHelper.cs:123`); nowhere else in the codebase.

### SoftDeleteUniqueIndexConvention

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:33` · Level 2 · class (public sealed)

- **What it is**: an EF Core model-finalizing convention that puts the `IsDeleted = 0` predicate on every **unique** index of every soft-deletable entity type in the model, so a soft-deleted row stops occupying its unique slot (`SoftDeleteUniqueIndexConvention.cs:10-33`).
- **Depends on**: EF Core's `IModelFinalizingConvention`, `IConventionModelBuilder` and `IConventionEntityType`; [`SoftDeleteFilterSql`](#softdeletefiltersql) for the predicate text; the [`DataSource`](#datasource) engine enum, taken as its one primary-constructor parameter (`SoftDeleteUniqueIndexConvention.cs:33`); and [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity) as the marker for "this entity is soft-deletable".
- **Concept introduced, the model-finalizing convention as a cross-cutting model rule.** `[Rubric §10, Cross-Cutting Concerns]` assesses whether policies that apply to every entity are expressed once rather than repeated per configuration, and `[Rubric §8, Data Architecture]` assesses whether the data model's invariants actually hold. EF exposes convention hooks that run while the model is being built; `IModelFinalizingConvention` is the last of them, which means it observes the model *after* every module's `IEntityTypeConfiguration` has declared its indexes. That timing is what makes a blanket rule possible: the convention does not need to know which modules exist or what they declared, it just walks the finished model. The bug it closes is a genuine soft-delete trap, stated in the doc comment (`SoftDeleteUniqueIndexConvention.cs:12-16`): soft-delete a speaker, and the unique index on email still blocks creating a new speaker with that email, because the row is invisible to the application but entirely visible to the database's uniqueness check. Adding the filter aligns what the database enforces with what the application shows.
- **Walkthrough**
  - `ProcessModelFinalizing` (`SoftDeleteUniqueIndexConvention.cs:36-50`) null-guards the model builder, then returns immediately when the engine is `DataSource.CosmosDB` (`:42-43`): Cosmos has no filtered-index concept, so the convention is a documented no-op there (`:27-30`).
  - The entity selection is two predicates (`SoftDeleteUniqueIndexConvention.cs:45-46`): the CLR type must be assignable to [`IAuditableEntity`](group-02-domain-building-blocks.md#iauditableentity), and the entity type must not be owned. Owned types share their owner's table and have no independent index story, so they are excluded.
  - `ApplyFilterToUniqueIndexes` (`SoftDeleteUniqueIndexConvention.cs:52-81`) asks [`SoftDeleteFilterSql`](#softdeletefiltersql) for the predicate and bails when it is `null` (`:56-58`), then walks the entity's indexes, skipping every non-unique one (`:60-63`).
  - For a unique index the convention branches three ways on the existing filter. No filter at all: set the soft-delete predicate (`SoftDeleteUniqueIndexConvention.cs:65-70`). A filter that already constrains the soft-delete column, whether a hand-authored literal or the output of `HasSoftDeleteFilter`: leave it exactly as it is, detected by `SoftDeleteFilterSql.ContainsPredicate` (`:74-75`, the helper at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:52`). Anything else: **append** the clause as `{existingFilter} AND {filterSql}` (`:79`).
  - That append is the load-bearing part, and the doc comment explains why it replaced the earlier "skip an index that already has a filter" behavior (`SoftDeleteUniqueIndexConvention.cs:17-26`). Skipping meant the exact partial-unique indexes a model bothered to hand-author (for example one narrowed on `[DedupKey] IS NOT NULL`) were the only ones a soft-deleted row could keep blocking. The `ContainsPredicate` check is what keeps appending idempotent: without it, a second model build would produce `... AND [IsDeleted] = 0 AND [IsDeleted] = 0`.
- **Why it's built this way**: the comment at `SoftDeleteUniqueIndexConvention.cs:54-55` names the reason the predicate comes from [`SoftDeleteFilterSql`](#softdeletefiltersql) rather than from a local string: it is the same builder the opt-in extension reaches, so the automatic path and the hand-authored path can never disagree about column name or identifier quoting, and the `AND` ordering at `:77-78` is chosen to match `HasSoftDeleteFilter(additionalFilter:)` byte for byte. Restricting the automatic behavior to unique indexes is a deliberate blast-radius choice: a unique index without the filter is a correctness bug under soft delete, while a non-unique index without it is only a performance question, and performance questions belong to whoever wrote the index. The whole decision, including the 2026-08-26 revision from skipping to appending, is [ADR-095](https://ivanball.github.io/docs/adr/095-soft-delete-unique-indexes.html); soft delete as a policy is [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html); covering SQL Server and SQLite while skipping Cosmos is the engine-portability posture of [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html).
- **Where it's used**: registered by [`ApplicationDbContext`](#applicationdbcontext) in `ConfigureConventions` with the context's own engine (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:323`), immediately after [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention). The comment there records the ordering intent and the precedence rule: it runs at finalization, after module configurations have declared their indexes, and hand-authored index filters are respected (`ApplicationDbContext.cs:320-322`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs`.

### CrossDataSourceDegradeConvention

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conventions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33` · Level 3 · class (public sealed)

- **What it is**: the model-finalizing convention that makes database-per-service work without forcing every module to write two versions of its entity configuration. It finds relationships whose two ends resolve to different physical databases and degrades them: the foreign key goes away, the navigation members are ignored, and entity types belonging to another database are removed from this model entirely (`CrossDataSourceDegradeConvention.cs:9-33`).
- **Depends on**: [`DataSourceKey`](#datasourcekey) (the context's own physical source) and [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (the entity-to-database map), both primary-constructor parameters (`CrossDataSourceDegradeConvention.cs:33-35`); EF Core's `IModelFinalizingConvention` plus the **mutable** metadata surface (`IMutableModel`, `IMutableEntityType`, `IMutableForeignKey`, `IMutableProperty`).
- **Concept introduced, degrading a relationship instead of forbidding it.** `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted into its own service without rewriting application code, and `[Rubric §8, Data Architecture]` assesses whether ownership boundaries in the data model are real. Under database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) an order row and a user row can live in different databases, and no database engine can enforce a foreign key across that line. The naive answers are both bad: forbid the navigation in the domain model (which distorts the domain to fit deployment), or keep the FK and hope the two entities always end up co-located (which breaks the moment they do not). This convention takes a third route. The configuration body is written once, as if everything were in one database, and the model builder subtracts what the current physical source cannot support. Three things are given up and each has a compensating mechanism: the FK constraint is replaced by an index over the surviving scalar columns, in-database navigation is replaced by the `INavigationPopulator` batch-loading path ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)), and referential consistency is maintained by integration events rather than by the engine (`CrossDataSourceDegradeConvention.cs:12-21`). The payoff is stated at `:25-29`: when every entity resolves to the same source, nothing is foreign and the convention is a structural no-op, so the monolith model is identical to the single-database model.
- **Walkthrough**
  - `ProcessModelFinalizing` opens by casting the convention model builder's metadata to `IMutableModel` (`CrossDataSourceDegradeConvention.cs:44-46`). The comment above the cast is load-bearing: cross-cutting helpers (soft-delete filters, concurrency tokens) have already promoted every entity type to the `Explicit` configuration source, and convention-sourced builder calls cannot override `Explicit`, so the mutable API is the only surface that can apply these changes (`:22-24`).
  - `IsForeign` (`CrossDataSourceDegradeConvention.cs:91-94`) is the whole routing decision: look the CLR type's full name up in the registry, and call it foreign when the registry knows it and its key differs from this context's key. An unregistered type is never foreign.
  - The foreign set is computed over non-owned entity types, and when it is empty the method returns at once (`CrossDataSourceDegradeConvention.cs:48-55`). That early return is the monolith fast path.
  - **Step 1, degrade the FKs** (`CrossDataSourceDegradeConvention.cs:62-74`): for each local entity, every declared foreign key whose principal is foreign is passed to `DegradeForeignKey`. FKs declared on foreign dependents are not touched here because step 3 removes those entity types wholesale. Note that `addCompensatingIndex` is computed once as "engine is not Cosmos" (`:65`).
  - `DegradeForeignKey` (`CrossDataSourceDegradeConvention.cs:107-138`) captures the non-shadow FK properties, removes the FK (which takes both navigations with it), and then rebuilds the index story. The subtle part is `:123-130`: EF's own `ForeignKeyIndexConvention` created an index for the FK, and its removal is processed by a **deferred** event that would fire after the coverage check below, silently leaving the column unindexed. So the convention drops that convention-sourced index eagerly itself, then checks coverage and adds a plain index only if nothing already covers the columns.
  - `HasCoveringIndex` (`CrossDataSourceDegradeConvention.cs:140-144`) treats an index as covering when the FK columns are a **prefix** of its column list, in order, which is exactly the condition under which a composite index can serve a lookup on those columns.
  - **Step 2, ignore the foreign members** (`CrossDataSourceDegradeConvention.cs:79-82`, implementation at `:151-165`): skip navigations pointing at foreign entities are removed, then every CLR property whose type (or collection element type) is foreign is added to the ignore list. The comment at `:76-78` explains why the second half is needed: removing a navigation leaves an unmapped CLR property of entity type behind, and EF's model validation rejects that.
  - `UnwrapCollectionElementType` (`CrossDataSourceDegradeConvention.cs:171-174`) is the one-argument-generic unwrap that makes `ICollection<ForeignEntity>` detectable as a collection of foreign entities.
  - **Step 3, remove the foreign entity types** (`CrossDataSourceDegradeConvention.cs:85-88`). EF's relationship discovery pulls foreign types into the model as a side effect; this is where they leave it.
- **Why it's built this way**: the Cosmos carve-out on the compensating index is spelled out at `CrossDataSourceDegradeConvention.cs:100-105`. Cosmos auto-indexes every property and rejects explicit index definitions, so adding a compensating index would fail model validation, and skipping it is what keeps a configuration body carrying a cross-source relationship portable to Cosmos without edits ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). Doing all of this at model finalizing rather than at configuration time is what lets the same entity configuration serve the monolith and the extracted-service topology ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)) with no per-topology branching in module code.
- **Where it's used**: registered by [`ApplicationDbContext`](#applicationdbcontext) in `ConfigureConventions` with the context's `DataSourceKey` and the resolved [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:317-318`), ahead of [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs`.

### RefreshSessionModelBuilderExtensions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionModelBuilderExtensions.cs:16` · Level 4 · class (public static)

- **What it is**: the single place the `RefreshSessions` table is mapped. One extension method, `ApplyRefreshSessionConfiguration(this ModelBuilder, string? schema = "dbo")`, configures the [`RefreshSession`](group-08-auth.md#refreshsession) entity: table, key, column widths and the two indexes the auth flows read through (`RefreshSessionModelBuilderExtensions.cs:16-75`).
- **Depends on**: [`RefreshSession`](group-08-auth.md#refreshsession) from `MMCA.Common.Domain.Auth` (including its length constants) and EF Core's `ModelBuilder`.
- **Concept introduced, the opt-in framework table.** `[Rubric §8, Data Architecture]` assesses whether each database holds exactly the data it owns, and `[Rubric §11, Security]` assesses whether credential storage is designed rather than incidental. The framework owns two kinds of table. The outbox is cross-cutting: every relational source needs one, so it is configured on [`ApplicationDbContext`](#applicationdbcontext) unconditionally and every module's database gets it. Refresh sessions are the other kind: they are Identity-module data, exactly one database owns them, and mapping them everywhere would put an empty `RefreshSessions` table in every other module's migrations. The class doc draws that contrast explicitly (`RefreshSessionModelBuilderExtensions.cs:8-14`). Keeping the mapping in a callable extension method rather than inlining it in a context is what makes "one database, chosen by configuration" expressible at all.
- **Walkthrough**
  - Three public constants name the objects so tests and callers do not restate strings: `TableName = "RefreshSessions"` (`RefreshSessionModelBuilderExtensions.cs:19`), `TokenHashIndexName` (`:22`) and `UserIndexName` (`:25`).
  - The method null-guards, maps the table with the caller's schema defaulting to `dbo` (`RefreshSessionModelBuilderExtensions.cs:36-40`), and keys on `Id` (`:41`).
  - `TokenHash` is `IsRequired`, `HasMaxLength(RefreshSession.TokenHashLength)`, `IsUnicode(false)`, `IsFixedLength()` (`RefreshSessionModelBuilderExtensions.cs:45-49`). The constant is 64 (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/RefreshSession.cs:34`), the length of a SHA-256 digest rendered as hex. The comment at `:43-44` gives the reason for the three facets: the value is always a 64-character hex digest, so a Unicode or variable-width column would double the index it has to fit in for nothing.
  - `ReplacedByTokenHash` gets the same three facets minus `IsRequired` (`RefreshSessionModelBuilderExtensions.cs:51-54`), because it is null until the session is rotated.
  - `ReasonRevoked`, `IpAddress` and `UserAgent` take their lengths from the domain constants (64, 45 and 512 at `RefreshSession.cs:43`, `:37`, `:40`), the first two non-Unicode (`RefreshSessionModelBuilderExtensions.cs:56-58`). 45 is the length of a full IPv6 text form; `UserAgent` stays Unicode because a user-agent string is arbitrary client text.
  - The unique index over `TokenHash` (`RefreshSessionModelBuilderExtensions.cs:64-66`) is the validation path: every refresh presents a token and must be answered by exactly one row. The comment at `:60-63` gives two reasons for the uniqueness, and both are security reasons rather than performance ones: a hash collision across users would let one account's token validate against another's session, and a double-insert of the same token becomes a database error instead of an ambiguity the reuse check has to resolve.
  - The composite index on `(UserId, RevokedAt)` (`RefreshSessionModelBuilderExtensions.cs:70-71`) serves the family question, "every live session for this user", which is asked on the per-user session cap, on reuse detection and on sign-out-everywhere. Without it each of those scans the table (`:68-69`).
  - The builder is returned for chaining (`RefreshSessionModelBuilderExtensions.cs:74`).
- **Why it's built this way**: hashing the token rather than storing it, and rotating per device, is [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html), which supersedes the single-plaintext-column storage model of [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html) while keeping its rotation and reuse-detection policy. The column shapes here are what make that model cheap: a fixed-width non-Unicode digest keeps the unique index narrow, and the two indexes are exactly the two questions the auth service asks. Nothing here is soft-deletable and nothing is audit-stamped, which is deliberate and is why the table needs its own mapping method rather than riding the module entity-configuration mechanism.
- **Where it's used**: called by [`ApplicationDbContext`](#applicationdbcontext) from `ConfigureRefreshSessions` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:673-681`) behind the two-part gate computed in the constructor: `RefreshSessions:Enabled` is true **and** this context's physical source name equals `RefreshSessions:DataSourceName` (`ApplicationDbContext.cs:295-298`). At design time the same gate is fed by [`DesignTimeDbContextOptions`](#designtimedbcontextoptions)`.EnableRefreshSessions`. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Auth/RefreshSessionModelBuilderExtensionsTests.cs` and, for the gate itself, `.../Persistence/DbContexts/RefreshSessionModelGateTests.cs:89`.
- **Caveats / not-in-source**: the class doc says the consumer's Identity context calls this from its own `OnModelCreating` (`RefreshSessionModelBuilderExtensions.cs:12-13`), which describes an earlier arrangement. The base context now calls it directly behind the gate, and the doc on `ConfigureRefreshSessions` explains why (`ApplicationDbContext.cs:664-671`): downstream apps run on the sealed engine contexts and have no context class to override ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Calling it by hand remains supported for a host that does have its own context class; trust the context, not the older sentence.

### EntityTypeBuilderExtensions

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeBuilderExtensions.cs:12` · Level 5 · class (public static, extension container)

- **What it is**: a generic `extension<TOwner>(EntityTypeBuilder<TOwner>)` block with one member, `OwnsMoney(...)`, which maps a [`Money`](group-02-domain-building-blocks.md#money) property as an owned type flattened into two columns on the owner's table: a decimal amount and an ISO 4217 currency code (`EntityTypeBuilderExtensions.cs:12`, `:21-23`, member at `:51-81`).
- **Depends on**: [`Money`](group-02-domain-building-blocks.md#money) and [`Currency`](group-02-domain-building-blocks.md#currency) from `MMCA.Common.Shared.ValueObjects`, EF Core's `EntityTypeBuilder<TEntity>` and `OwnsOne`, and `System.Linq.Expressions`.
- **Concept introduced, the round-trip contract of a value converter.** `[Rubric §4, Domain-Driven Design]` assesses whether value objects survive the trip to storage intact, and `[Rubric §15, Best Practices and Code Quality]` assesses whether edge cases are handled where they arise. A value converter has two legs, write and read, and correctness means every value the write leg can produce is a value the read leg can materialize. The doc comment at `EntityTypeBuilderExtensions.cs:30-39` documents a real failure of that contract and its fix. An aggregate can seed a zero total with `Money.Zero()`, whose currency `Code` is the empty string, and leave it there; the write leg persists that empty code faithfully. On the way back, `Currency.FromCode("")` fails, and a bare `.Value!` turned those rows into a `null` Currency inside a `Money`, which is a materialization-time `NullReferenceException` waiting for the first read. The same applies to any code that has since dropped out of `Currency.All`. So the read leg coalesces to a sentinel instead.
- **Walkthrough**
  - `NoCurrency` (`EntityTypeBuilderExtensions.cs:19`) is that sentinel, obtained as `Money.Zero().Currency`. The comment at `:14-18` explains the indirection: the "no currency" instance is internal to `MMCA.Common.Shared`, so a zero `Money` is the only public handle on it.
  - The extension is generic over the owner with a `class` constraint (`EntityTypeBuilderExtensions.cs:21-22`), so it applies to any entity that owns a `Money`.
  - The signature takes the navigation expression, the two column names, and a `required` flag defaulting to `true` (`EntityTypeBuilderExtensions.cs:51-55`). The parameter doc at `:44-49` is honest about the design rule behind that: `required` is the only facet that differs across the existing call sites, so it is the only one parameterized beyond the two column names.
  - All four arguments are guarded, the strings with `ArgumentException.ThrowIfNullOrWhiteSpace` (`EntityTypeBuilderExtensions.cs:57-60`).
  - `OwnsOne` maps the two members (`EntityTypeBuilderExtensions.cs:62-76`): `Amount` gets its column name and `IsRequired`; `Currency` gets the two-leg conversion (write `currency => currency.Code`, read `code => Currency.FromCode(code).Value ?? NoCurrency`), plus `HasMaxLength(3)`, `IsUnicode(false)`, its column name, and `IsRequired`. That is the ISO 4217 code shape exactly: three non-Unicode characters.
  - `builder.Navigation(navigationExpression).IsRequired(required)` (`EntityTypeBuilderExtensions.cs:78`) is a separate call from the `OwnsOne` body because it configures the *navigation* rather than the owned entity's properties. The builder is returned for chaining (`:80`).
- **Why it's built this way**: value objects are validated primitives ([ADR-068](https://ivanball.github.io/docs/adr/068-value-objects-as-validated-primitives.html)), which means construction is guarded but persistence must still round-trip every value that construction allowed, including the zero sentinel. Flattening `Money` into two columns on the owner's table rather than a separate table keeps a price or a total a single-row read. Putting the whole mapping behind one extension member means the read-leg fallback is written once and cannot be forgotten by the next configuration that maps a `Money`.
- **Where it's used**: three call sites, all in MMCA.Store's Sales and Catalog modules: `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Persistence/EntityConfiguration/OrderConfiguration.cs:26` (`Total`, with `required: false`), `.../OrderLineConfiguration.cs:28` (`UnitPrice`), and `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/EntityConfiguration/ProductVariantConfiguration.cs:31` (`Price`). Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/OwnsMoneyTests.cs`.

### DesignTimeDbContextHelper

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:42` · Level 13 · class (public static)

- **What it is**: the whole design-time story in one static class. It builds a real [`SQLServerDbContext`](#sqlserverdbcontext) or [`SqliteDbContext`](#sqlitedbcontext) for `dotnet ef` commands without the application's host or DI container, so a consumer's migrations project is a factory class of a few lines (`DesignTimeDbContextHelper.cs:19-41`, with the worked example in the doc comment at `:22-32`).
- **Depends on**: [`DesignTimeDbContextOptions`](#designtimedbcontextoptions) (the caller's input), [`DataSourceResolver`](#datasourceresolver) and [`EntityDataSourceRegistry`](#entitydatasourceregistry) (routing), [`ExplicitAssemblyProvider`](#explicitassemblyprovider) and [`NullDomainEventDispatcher`](#nulldomaineventdispatcher) (its two nested stand-ins), the four interceptors ([`AuditSaveChangesInterceptor`](#auditsavechangesinterceptor), [`DomainEventSaveChangesInterceptor`](#domaineventsavechangesinterceptor), [`TenantSaveChangesInterceptor`](#tenantsavechangesinterceptor), [`AuditTrailSaveChangesInterceptor`](#audittrailsavechangesinterceptor)), [`OutboxSignal`](group-04-events-outbox.md#outboxsignal), and the settings types [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings), [`SchedulerSettings`](group-14-module-system-composition.md#schedulersettings), [`AuditTrailSettings`](group-07-persistence-ef-core.md#audittrailsettings) and [`RefreshSessionSettings`](group-08-auth.md#refreshsessionsettings). Externally: `Microsoft.Extensions.DependencyInjection`, `Microsoft.Extensions.Options`, and the null-logger family from `Microsoft.Extensions.Logging.Abstractions`.
- **Concept introduced, the design-time container.** `[Rubric §17, DevOps and Deployment]` assesses whether migrations are a repeatable, per-database operation rather than a manual one, and `[Rubric §33, Developer Experience]` assesses how much a routine task costs the next engineer. `dotnet ef` runs outside the application: it loads an assembly, finds an `IDesignTimeDbContextFactory<T>`, and asks for a context. A `DbContext` in this framework is not newable in isolation, because it resolves interceptors, a data-source resolver and an entity registry from a service provider. This helper builds the smallest provider that satisfies all of that, and the design principle running through every line of `BuildDesignTimeServices` is **fidelity**: register the same services the runtime registers, defaulted to inert, so the model `dotnet ef` sees is the model the application will run. Every gated service here is registered unconditionally with a disabled default rather than being omitted, and the inline comments say so at `:126-130`, `:133-135` and `:138-140`.
- **Walkthrough**
  - `CreateSqlServer(args, configure)` (`DesignTimeDbContextHelper.cs:51-60`) and `CreateSqlite(args, configure)` (`:71-80`) are the two entry points. Each calls the shared builder for its engine and then constructs the context with an empty `DbContextOptions`, the built provider, the assembly provider and the resolved physical source.
  - `BuildDesignTimeServices` (`DesignTimeDbContextHelper.cs:93-161`) is the substance. Its doc comment states why it is shared: a difference between the two engines' pipelines would surface as a migration that differs by engine for reasons that have nothing to do with the engine (`:82-87`).
  - Name resolution is a three-step fallback (`DesignTimeDbContextHelper.cs:102-104`): the explicit `DataSourceName`, then `--datasource` parsed from the arguments, then `DataSourceKey.DefaultName`.
  - The routing stack is built by hand: an [`ExplicitAssemblyProvider`](#explicitassemblyprovider) over a copy of the caller's assembly list (`DesignTimeDbContextHelper.cs:106`), a [`DataSourceResolver`](#datasourceresolver) over the caller's connection settings with a null logger (`:106-109`), and an [`EntityDataSourceRegistry`](#entitydatasourceregistry) over the two (`:110`).
  - The physical source is resolved **before** the registrations (`DesignTimeDbContextHelper.cs:117`), and the comment at `:112-115` explains why the ordering matters: the refresh-session gate is keyed on the PHYSICAL source name, which is not always the logical one asked for. A logical name whose connection matches the top-level one collapses onto `Default`, and names sharing a connection collapse onto the alphabetically-first of them.
  - The container (`DesignTimeDbContextHelper.cs:119-158`) registers `TimeProvider.System`, a `NullLoggerFactory` and open-generic `NullLogger<>` (`:119-121`), the [`NullDomainEventDispatcher`](#nulldomaineventdispatcher) (`:122`), an [`OutboxSignal`](group-04-events-outbox.md#outboxsignal) (`:123`), the audit and domain-event interceptors (`:124-125`), the tenant interceptor with a default (disabled) [`TenancySettings`](group-07-persistence-ef-core.md#tenancysettings) (`:131-132`), and the three table gates.
  - The three gates are the part a migrations author actually tunes. `SchedulerSettings.Enabled` comes from `EnableScheduler` (`DesignTimeDbContextHelper.cs:137-138`), `AuditTrailSettings.Enabled` from `EnableAuditTrail` along with the interceptor that writes to that table (`:141-143`), and `RefreshSessionSettings` from `EnableRefreshSessions` **plus** `physical.Key.Name` (`:149-154`). That last pairing is the point of the early resolve: the comment at `:144-148` records that registering the logical name instead would silently miss on every collapse, and the scaffold would keep omitting a table the runtime model has.
  - Finally the assembly provider, resolver and registry are registered under their interfaces (`DesignTimeDbContextHelper.cs:156-158`) and the triple is returned (`:159`).
  - `ParseDataSourceName` (`DesignTimeDbContextHelper.cs:166-184`) is `internal` so it can be tested directly. It accepts both `--datasource Name` and `--datasource=Name`, case-insensitively, and throws `InvalidOperationException` with a usage hint when the flag is present with no value (`:169-173`). A missing flag returns `null`, which is the fallback path, not an error.
- **Why it's built this way**: database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) means one migrations project per database, and each of them needs a context whose model contains only that source's entities. Centralizing the plumbing here keeps each of those projects declarative, and centralizing it also means the fidelity rules (register everything, default to disabled, key the session gate on the resolved physical name) are stated once instead of once per consumer. Supporting both engines through one private builder is the polyglot posture of [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html).
- **Where it's used**: every consumer's design-time factories. MMCA.ADC has four (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/DesignTimeSQLServerDbContextFactory.cs:15`, plus the Conference, Engagement and Notification projects), MMCA.Store has three (`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Identity/DesignTimeSQLServerDbContextFactory.cs:17`, Catalog at `:16`, Sales at `:16`), MMCA.Helpdesk has one (`MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/DesignTimeSQLServerDbContextFactory.cs:25`), and MMCA.ECommerce has two. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DesignTimeDbContextHelperTests.cs`, which exercises both engines and the refresh-session gate (`:94`, `:124`, `:140`, `:151`).
- **Caveats / not-in-source**: whether the flags in a given migrations project actually match that host's `appsettings.json` is not checkable from this file; the guard is `dotnet ef migrations has-pending-model-changes`, named in the options remarks (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:71-72`).

### EFRefreshSessionStore

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:30` · Level 13 · class (internal sealed)

- **What it is**: the EF Core implementation of [`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore), the persistence side of multi-device refresh tokens. It reads and writes [`RefreshSession`](group-08-auth.md#refreshsession) rows in whichever physical database holds them, and it owns the one operation the auth flow cannot express as a plain tracked mutation: the rotation claim (`EFRefreshSessionStore.cs:30-161`).
- **Depends on**: [`IDbContextFactory`](#idbcontextfactory) (context access, saving and transactions), [`IEntityDataSourceRegistry`](#ientitydatasourceregistry) and [`IDataSourceResolver`](#idatasourceresolver) (source resolution), [`RefreshSessionSettings`](group-08-auth.md#refreshsessionsettings) via `IOptions<T>`, [`RefreshSession`](group-08-auth.md#refreshsession), and the `UserIdentifierType` alias. All four dependencies are primary-constructor parameters (`EFRefreshSessionStore.cs:30-34`).
- **Concept introduced, letting the database arbitrate a race instead of the process.** `[Rubric §11, Security]` assesses whether credential handling is correct under concurrency, and `[Rubric §12, Performance and Scalability]` assesses whether the concurrency strategy holds with more than one instance running. Refresh-token rotation is a check-then-act: read the presented session, confirm it is live, revoke it, insert the successor. Two concurrent refreshes of the *same* token each read their own copy with `RevokedAt` null, and both would happily save, which is two valid successors from one token. The row deliberately carries no concurrency token, so the fix is to make the revocation itself the arbitration: a conditional `UPDATE ... WHERE Id = @id AND RevokedAt IS NULL`. Exactly one caller affects one row and wins; the loser affects zero rows and writes nothing. The remarks state this in full (`EFRefreshSessionStore.cs:91-99`).
- **Walkthrough**
  - `Context` (`EFRefreshSessionStore.cs:36`) resolves the context per access through the factory keyed on `ResolveDataSourceKey()`, and `Sessions` (`:38`) is the `DbSet<RefreshSession>` over it.
  - `ResolveDataSourceKey` (`EFRefreshSessionStore.cs:156-161`) is the routing decision, and it has two legs. First the entity registry, so a consumer that ships a real entity configuration for [`RefreshSession`](group-08-auth.md#refreshsession) routes it like any other entity. Otherwise a key built from the resolver's engine for `Default` plus the configured `DataSourceName`. The comment at `:153-155` is precise about the split: the configured NAME is used verbatim, and only the ENGINE goes through the resolver, so a host that configures no SQL Server connection string gets the engine it does configure rather than a context over an empty connection string.
  - `AddAsync` (`EFRefreshSessionStore.cs:41-45`) stages the insert; it does not save. `SaveChangesAsync` (`:87-88`) delegates to the factory, which is what lets a login and its session insert commit in the same unit of work.
  - `FindByTokenHashAsync` (`EFRefreshSessionStore.cs:48-55`) is the validation lookup, backed by the unique `TokenHash` index.
  - `GetUnrevokedByUserAsync` (`EFRefreshSessionStore.cs:62-70`) is the family query, ordered by `CreatedAt` then `Id`. The tie-break is not cosmetic: the per-user cap evicts "the oldest", and two sessions opened in the same clock tick would otherwise evict in an arbitrary order (`:58-61`).
  - `FindByIdAsync` (`EFRefreshSessionStore.cs:78-84`) filters on both `Id` and `UserId`. The remarks make the security argument (`:73-77`): the id arrives from a client, so putting the user in the predicate is what makes another account's session **unreadable** rather than merely rejected after being read.
  - `TryRotateAsync` (`EFRefreshSessionStore.cs:108-151`) is the claim. The tracked entry for the presented session is captured *before* the transaction opens so this context is one of the contexts the factory enlists rather than a late arrival (`:117-119`). Inside `ExecuteInTransactionAsync` (`:121`) it issues the conditional `ExecuteUpdateAsync` setting `RevokedAt`, `ReasonRevoked = RefreshSession.ReasonRotated` and `ReplacedByTokenHash`, and treats "one row affected" as the claim (`:124-132`). Losing returns `false` and writes nothing (`:134-137`).
  - Having won, it mirrors the claim onto the tracked instance with `presented.Revoke(...)` and then copies current values over original values (`EFRefreshSessionStore.cs:142-143`). That second line is easy to miss and load-bearing: without it, the next `SaveChanges` would re-issue the same `UPDATE` as a tracked modification. Then the successor is added and saved inside the same transaction (`:145-146`).
  - Sharing one transaction between the claim and the successor insert is what stops a loser observing a half-finished rotation: its `UPDATE` blocks on the winner's row lock, re-evaluates the predicate after the winner commits, and the family revocation it then performs sees the committed successor. A nested call joins the ambient transaction, so an `ITransactional` caller is unaffected (`EFRefreshSessionStore.cs:100-106`).
- **Why it's built this way**: every read here is tracked on purpose, and the class doc says why (`EFRefreshSessionStore.cs:24-28`): the caller revokes by mutating the instances this returns, so a no-tracking query would take those revocations and silently drop them at save time. That is the opposite of the usual read-path default in this codebase and worth remembering. Resolving the database through the registry first and the setting second means a single-database host needs no configuration at all (`RefreshSessions:DataSourceName` defaults to `Default` at `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:52`) while a multi-database host names the Identity source once. Pointing it at a database that does not map the table fails loudly on the first query rather than reading the wrong rows (`EFRefreshSessionStore.cs:21-22`). The policy is [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html), building on [ADR-050](https://ivanball.github.io/docs/adr/050-jwt-refresh-token-rotation.html).
- **Where it's used**: registered as the scoped [`IRefreshSessionStore`](group-08-auth.md#irefreshsessionstore) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:163`), scoped deliberately, like the unit of work it shares a `DbContext` with, so a login and its session insert commit together (`:143-144`). The consumer is [`AuthenticationServiceBase<TUser>`](group-08-auth.md#authenticationservicebasetuser), which holds it as `RefreshSessions` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:60`, `:88`) and drives rotation, per-session revoke and sign-out-everywhere through it. [`DeleteUserHandlerBase<TUser, TCommand>`](group-14-module-system-composition.md#deleteuserhandlerbasetuser-tcommand) revokes a deleted user's sessions through the same store from its soft-delete tail (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:106`).

### RefreshSessionCleanupService

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Auth` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Auth/RefreshSessionCleanupService.cs:48` · Level 13 · class (public sealed partial, `BackgroundService`)

- **What it is**: the retention sweep for the `RefreshSessions` table. On an interval it hard-deletes every session that stopped being usable more than `RetentionDays` ago (`RefreshSessionCleanupService.cs:48-157`).
- **Depends on**: `IServiceScopeFactory`, `ILogger<RefreshSessionCleanupService>`, `IOptions<`[`RefreshSessionSettings`](group-08-auth.md#refreshsessionsettings)`>` and an optional `TimeProvider`, all primary-constructor parameters (`RefreshSessionCleanupService.cs:48-52`); inside a sweep it resolves [`IEntityDataSourceRegistry`](#ientitydatasourceregistry), [`IDataSourceResolver`](#idatasourceresolver) and [`IDbContextFactory`](#idbcontextfactory) from the scope (`:107-109`). Base class: `Microsoft.Extensions.Hosting.BackgroundService`.
- **Concept introduced, hard delete inside a soft-delete framework.** `[Rubric §30, Compliance, Privacy and Data Governance]` assesses whether personal data has a bounded lifetime, and `[Rubric §8, Data Architecture]` assesses whether operational tables have a retention story. Everything modelled as an aggregate here is soft-deleted ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)), so a hard `DELETE` is conspicuous and the class doc justifies it (`RefreshSessionCleanupService.cs:18-22`): a session is framework bookkeeping, not an aggregate. The row has no soft-delete flag and no audit stamps, and its content is a credential digest plus the IP and user-agent of the device that signed in. Keeping it past its usefulness is a growing table **and** a growing set of records describing a data subject's devices, so the sweep removes the row rather than flagging it. All three applications' soft-delete fitness tests list this type by name as a sanctioned exception (for example `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/SoftDeleteEnforcementTests.cs:46`).
- **Walkthrough**
  - `_settings` and `_timeProvider` are captured once, the clock defaulting to `TimeProvider.System` so tests can drive an hour-scale loop deterministically (`RefreshSessionCleanupService.cs:54-55`, parameter doc at `:44-47`).
  - `ExecuteAsync` has two exits before the loop. `Enabled` false logs and returns (`RefreshSessionCleanupService.cs:62-66`); the comment at `:60-61` notes that registration is already gated on the flag and this second check exists for a host that registers the service by hand. `RetentionDays <= 0` logs and returns (`:68-72`), which is the documented way to keep sessions forever.
  - The loop waits `CleanupIntervalHours` **before** the first sweep (`RefreshSessionCleanupService.cs:74`, `:82`), so cleanup never competes with startup or migration work (`:76-77`). Cancellation at shutdown breaks the loop (`:85-88`); any other exception is logged and the loop continues (`:89-92`), so one bad sweep does not end the service.
  - `PurgeAsync` (`RefreshSessionCleanupService.cs:102-130`) computes the cutoff from the injected clock (`:104`), opens a scope and resolves the registry, resolver and context factory from it (`:106-110`).
  - Before deleting anything it checks `context.Model.FindEntityType(typeof(RefreshSession))` and, on a miss, logs a warning naming the configured data source and returns (`RefreshSessionCleanupService.cs:115-119`). The comment at `:112-114` gives the operator-experience reason: a source can be reachable and still not map the table, and saying so once per sweep beats a translation error the operator has to decode.
  - The delete itself is one `ExecuteDeleteAsync` over a two-armed predicate (`RefreshSessionCleanupService.cs:121-125`): revoked before the cutoff, **or** not revoked and expired before the cutoff. The method doc calls this "died" (`:96-100`), and both arms matter. A live session is never a candidate however old it is, and a session revoked minutes ago survives even if it expired long before, because that recent revocation is exactly what reuse detection reads.
  - The per-sweep count is logged unconditionally, zero included (`RefreshSessionCleanupService.cs:129`), because a "only when it deleted something" log cannot tell an operator that retention is running at all (`:127-128`). `[Rubric §13, Observability and Operability]` assesses precisely that distinction.
  - `ResolveDataSourceKey` (`RefreshSessionCleanupService.cs:137-142`) duplicates [`EFRefreshSessionStore`](#efrefreshsessionstore)'s resolution exactly, and the doc says why (`:132-136`): the sweep must never visit a different database than the store reads.
  - The five log messages are source-generated `[LoggerMessage]` partials (`RefreshSessionCleanupService.cs:144-157`), which is why the class is `partial`.
- **Why it's built this way**: retention bounds reuse detection, and the class doc is explicit about the trade (`RefreshSessionCleanupService.cs:24-32`). BR-206 catches a replayed refresh token by finding its revoked row and revoking the whole family; a rotation chain older than the window is gone, so a replay of a token that old reads as an unknown token and fails alone instead of signalling reuse. The default window of 30 days (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:72`) is far past the default refresh-token lifetime, so every token still capable of being replayed still has its row, and a host that shortens `RefreshSessions:RetentionDays` below `Jwt:RefreshTokenExpirationDays` is choosing to lose that signal. Unlike the outbox, sessions live in exactly one physical source, which is why the sweep resolves one database rather than iterating them (`:33-39`). The sweep is the retention half of the 2026-08-27 revision of [ADR-097](https://ivanball.github.io/docs/adr/097-multi-device-refresh-sessions.html).
- **Where it's used**: registered as a hosted service only when `RefreshSessions:Enabled` is true, read straight off configuration at registration time (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:168-171`). The comment there gives the reason for the conditional (`:151-153`): registering it unconditionally would start a sweep in every service of a modular host, all but one of which has no `RefreshSessions` table to sweep. Covered by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Auth/RefreshSessionCleanupServiceTests.cs`, which exercises both disabled paths, the retention predicate, the unmapped-table warning and the registration gate (`:189`, `:201`, `:218`).
- **Caveats / not-in-source**: the default interval is 6 hours (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/RefreshSessionSettings.cs:80`, constrained to 1 through 168), and because the loop waits one full interval before its first sweep, a host that restarts more often than the configured interval never sweeps. Nothing in the service compensates for that.

### EnumerationValueConverter<TEnumeration>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EnumerationValueConverter.cs:33` · Level 4 · class (public sealed)

- **What it is**: the shipped EF Core `ValueConverter<TEnumeration, int>` that stores a smart-enumeration member as its integer `Value` and rebuilds the member when a row is read back (`EnumerationValueConverter.cs:33`). It is the packaged replacement for the two lambdas every entity configuration would otherwise hand-roll to map an [`Enumeration<TEnumeration>`](group-02-domain-building-blocks.md#enumerationtenumeration) property.
- **Depends on**: [`Enumeration<TEnumeration>`](group-02-domain-building-blocks.md#enumerationtenumeration) (the generic constraint, `EnumerationValueConverter.cs:34`), its `Value` property (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:99`) and its static `FromValue` factory (`Enumeration.cs:115`); [`Result<T>`](group-01-result-error-handling.md#result) indirectly, because `FromValue` returns one; EF Core's `ValueConverter<TModel, TProvider>` from `Microsoft.EntityFrameworkCore.Storage.ValueConversion` (NuGet, `EnumerationValueConverter.cs:1`).
- **Concept introduced, mapping a smart enumeration onto the column a CLR enum already used.** A smart enumeration is a class, not a language `enum`, so the naive EF answer is `OwnsOne`: the member becomes an owned entity type with its own columns, which turns "replace the `enum` property with a richer type" into a schema change and a migration. `HasConversion` takes the other route. It keeps a single flat column and supplies a pair of expression trees: a **write leg** that turns the model value into the provider value, and a **read leg** that turns the provider value back. Because this converter's provider type is `int` (`EnumerationValueConverter.cs:33`), the backing column stays exactly the plain integer column a CLR enum was already persisted into, so adopting the smart enumeration in the domain changes nothing in the database. The class doc states this as the reason for the choice (`EnumerationValueConverter.cs:6-11`). `[Rubric §4, Domain-Driven Design]` assesses whether the domain models concepts as behavior-carrying types rather than primitives or bare enums; a framework-shipped converter removes the storage-cost argument against doing so. `[Rubric §8, Data Architecture]` assesses how deliberately the storage shape is chosen; the flat `int` column keeps indexes, existing rows, and prior migrations untouched.
- **Walkthrough**
  - **Type parameters and constraint** (`EnumerationValueConverter.cs:33-34`): `ValueConverter<TEnumeration, int>` with `where TEnumeration : Enumeration<TEnumeration>`, the curiously-recurring constraint that makes `FromValue` resolve to the concrete member type rather than to the base.
  - **Constructor, write leg** (`EnumerationValueConverter.cs:41`): `member => member.Value`, the member's declared stable integer (`Enumeration.cs:99`). No validation happens here: a member reference is valid by construction, since the only members that exist are the ones the type declares.
  - **Constructor, read leg** (`EnumerationValueConverter.cs:42`): `value => Enumeration<TEnumeration>.FromValue(value).Value!`. `FromValue` looks the value up in the type's interned member dictionary and returns a success result (`Enumeration.cs:117-118`) or an invariant failure coded `Enumeration.UnknownValue` (`Enumeration.cs:120-124`). Because [`Result<T>.Value`](group-01-result-error-handling.md#result) is declared nullable and simply returns `null` on failure rather than throwing (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:206-207`), the null-forgiving `!` means a row carrying a value no member declares materializes a `null` reference for that property instead of failing materialization.
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
- **Depends on**: [`Email`](group-02-domain-building-blocks.md#email) and its `Create` factory (`EmailValueConverter.cs:2`, `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Contact/Email.cs:30`); [`Result<T>`](group-01-result-error-handling.md#result) indirectly, since `Create` returns one; EF Core's `ValueConverter<TModel, TProvider>` (NuGet, `EmailValueConverter.cs:1`).
- **Concept reinforced, `HasConversion` over `OwnsOne` for a value object.** The mechanism is the one taught at [`EnumerationValueConverter<TEnumeration>`](#enumerationvalueconvertertenumeration); what changes is the provider type. Here the column stays a plain string column (`EmailValueConverter.cs:33`), so a codebase can upgrade `string Email` to `Email Email` in the domain and change nothing in the database. That is the whole point of shipping the converter from the framework: the domain gets an invariant-protected type ([`Email.Create`](group-02-domain-building-blocks.md#email) validates through [`EmailInvariants`](group-02-domain-building-blocks.md#emailinvariants) at `Email.cs:34` and lowercases at `Email.cs:39`), while storage keeps the simplest possible shape. `[Rubric §4, Domain-Driven Design]` assesses whether the domain expresses concepts as rich types rather than primitives; a shipped converter removes the usual excuse for keeping an email as a bare string. `[Rubric §16, Maintainability]` assesses whether a change of this kind ripples: the converter is written once in Infrastructure and reused across the repos rather than copy-pasted per configuration.
- **Walkthrough**
  - **Type parameters** (`EmailValueConverter.cs:33`): `ValueConverter<Email, string>`, so EF knows the CLR (model) type is `Email` and the provider (column) type is `string`.
  - **Constructor, write leg** (`EmailValueConverter.cs:40`): `email => email.Value` persists the already-normalized lowercase string that `Email.Create` produced (`Email.cs:39`). No validation happens here because a constructed `Email` is valid by construction.
  - **Constructor, read leg** (`EmailValueConverter.cs:41`): `value => Email.Create(value).Value!`. The read leg deliberately trusts the column. [`Result<T>.Value`](group-01-result-error-handling.md#result) is nullable and returns `null` on failure rather than throwing (`Result.cs:206-207`), so the null-forgiving `!` means a row whose stored text does not validate materializes a `null` reference for that property instead of blowing up model materialization. The class doc states the contract explicitly (`EmailValueConverter.cs:24-31`): every value the write leg can produce round-trips, because the write leg can only persist an already-validated `Email`; only a value written outside EF (a manual script, a data fix) can break it.
  - **What the converter deliberately does not do** (`EmailValueConverter.cs:20-22`): column facets (max length, `IsUnicode`, requiredness) stay at the call site, because they differ per entity. The documented usage pattern chains them next to the `HasConversion` call (`EmailValueConverter.cs:14-19`).
- **Why it's built this way**: two forces meet here. The domain wants a type that cannot hold an invalid address; the database wants a column that indexes and migrates like the `nvarchar` it already was. `HasConversion` satisfies both, and shipping the converter pair from Common (rather than documenting the lambdas) means every consumer gets the same normalization and the same read-leg contract. [`Email`](group-02-domain-building-blocks.md#email) itself names this class and its nullable sibling in its own doc comment (`Email.cs:7-14`), so the intended mapping is discoverable from the domain type.
- **Where it's used**: ADC's Identity `UserConfiguration` maps `User.Email` through it (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:21`), and Store uses it for both `User.Email` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:24`) and `Customer.Email` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/CustomerConfiguration.cs:36`). The Store call sites carry an inline comment recording that the mapping is `HasConversion` and not `OwnsOne` precisely so the column shape stays a plain `nvarchar` (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:21-22`). Round-trip behavior is pinned by `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EmailValueConverterTests.cs:16`.

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
  - **What this class deliberately leaves to someone else** (`EntityTypeConfigurationBase.cs:10-15`): the doc records that entity-to-data-source mapping is not registered here as a model-building side effect. [`EntityDataSourceRegistry`](#entitydatasourceregistry) derives that mapping eagerly from the configuration class's attributes ([`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) for the engine, [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) or the module namespace for the database), which is what lets routing be known before any model is built.
- **Why it's built this way**: model building is the wrong place to accumulate a registry, because a model is built lazily and per data source, so "which entity lives where" would only be known after the first context of each kind had been constructed. Splitting the two (this class owns model rules, the registry owns routing) is what makes the routing table eagerly available at startup.
- **Where it's used**: extended by [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype), and through it by every consumer configuration. Its two behaviors are pinned directly: `Configure_AggregateRootEntity_ExcludesDomainEvents` and `Configure_NonAggregateEntity_MapsEntity` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/EntityTypeConfigurationBaseTests.cs:18`, `:38`).

### IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationCosmos.cs:13` · Level 5 · interface (internal)

- **What it is**: the engine marker for Azure Cosmos DB configurations (`IEntityTypeConfigurationCosmos.cs:13`). It adds no members of its own beyond the `new` redeclaration of `Configure` (`:17`); its whole job is to be the type [`CosmosDbContext`](#cosmosdbcontext) scans for.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (extends it, `IEntityTypeConfigurationCosmos.cs:13`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint, `:14`); EF Core's `EntityTypeBuilder<TEntity>` (NuGet, `:1`).
- **Concept reinforced**: the marker-interface-as-discovery-filter idea taught at [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype). The selection happens in one `switch` inside [`ApplicationDbContext`](#applicationdbcontext): `DataSource.CosmosDB` maps to `typeof(IEntityTypeConfigurationCosmos<,>)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:694`), and that open generic is handed to the assembly scan.
- **Walkthrough**
  - **`internal`** (`IEntityTypeConfigurationCosmos.cs:13`): unlike its parent, this interface is not part of the public API. Consumers are not meant to implement it directly; they derive from [`EntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#entitytypeconfigurationcosmostentity-tidentifiertype) (or annotate with [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute)), which implements it for them.
  - **`new void Configure(...)`** (`IEntityTypeConfigurationCosmos.cs:17`): the redeclaration the base interface exists to enable.
- **Caveats / not-in-source**: implementing this interface directly, without the attributed base class, is a supported but degraded path. [`EntityDataSourceRegistry`](#entitydatasourceregistry) skips configurations that carry no [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:174-178`), so such an entity lands in the engine's Default model but is not routable through [`IUnitOfWork`](#iunitofwork); the code comments call this legacy behavior (`ApplicationDbContext.cs:700-704`).
- **Where it's used**: matched by `ApplicationDbContext.ApplyConfigurationsForEntitiesInContext` for the Cosmos engine (`ApplicationDbContext.cs:692-698`) and implemented by [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (`EntityTypeConfiguration.cs:32`).

### IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSqlite.cs:13` · Level 5 · interface (internal)

- **What it is**: the engine marker for SQLite configurations (`IEntityTypeConfigurationSqlite.cs:13`), structurally identical to its Cosmos and SQL Server siblings.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (`IEntityTypeConfigurationSqlite.cs:13`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`:14`); EF Core's `EntityTypeBuilder<TEntity>` (`:1`).
- **Concept reinforced**: engine selection by interface identity, taught at [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype). `DataSource.Sqlite` maps to `typeof(IEntityTypeConfigurationSqlite<,>)` (`ApplicationDbContext.cs:695`).
- **Where it's used**: matched by [`SqliteDbContext`](#sqlitedbcontext) through the shared discovery method, implemented by [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (`EntityTypeConfiguration.cs:31`), and used directly by the framework's own tests as the scan target: the `ApplyAllConfigurations` tests pass `typeof(IEntityTypeConfigurationSqlite<,>)` as the interface to match (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/ModelBuilderExtensionsTests.cs:93`, `:148`), and two test types implement it directly to exercise the unattributed path (`ModelBuilderExtensionsTests.cs:108`, `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:233`).

### IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSQLServer.cs:13` · Level 5 · interface (internal)

- **What it is**: the engine marker for SQL Server configurations (`IEntityTypeConfigurationSQLServer.cs:13`). It is the one of the three that matters in production today, because every deployed entity in ADC and Store routes to SQL Server.
- **Depends on**: [`IEntityTypeConfigurationBase<TEntity, TIdentifierType>`](#ientitytypeconfigurationbasetentity-tidentifiertype) (`IEntityTypeConfigurationSQLServer.cs:13`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`:14`); EF Core's `EntityTypeBuilder<TEntity>` (`:1`).
- **Concept reinforced**: engine selection by interface identity. `DataSource.SQLServer` maps to `typeof(IEntityTypeConfigurationSQLServer<,>)` (`ApplicationDbContext.cs:696`); anything the switch does not recognize throws `InvalidOperationException` rather than silently building an empty model (`ApplicationDbContext.cs:697`).
- **Where it's used**: matched by [`SQLServerDbContext`](#sqlserverdbcontext) through `ApplyConfigurationsForEntitiesInContext`, and implemented by [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (`EntityTypeConfiguration.cs:30`), which is how all 28 ADC configurations and all 12 Store configurations reach it through the [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) shim.

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
- **Where it's used**: ADC's `SpeakerConfiguration` maps the optional `Speaker.Email` through it (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Speakers/SpeakerConfiguration.cs:43`), with the length facet coming from `SpeakerInvariants.EmailMaxLength` at the call site (`SpeakerConfiguration.cs:44`). Null pass-through is covered at `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EmailValueConverterTests.cs:63`.

### NullablePhoneNumberValueConverter

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/PhoneNumberValueConverter.cs:61` · Level 5 · class (public sealed)

- **What it is**: a `ValueConverter<PhoneNumber?, string?>` for an optional [`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) property (`PhoneNumberValueConverter.cs:61`). It is the same shape as [`NullableEmailValueConverter`](#nullableemailvalueconverter) with a different value object.
- **Depends on**: [`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) and its `Create` factory, which validates through [`PhoneNumberInvariants`](group-02-domain-building-blocks.md#phonenumberinvariants) and trims (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Contact/PhoneNumber.cs:30`, `:36`); EF Core's `ValueConverter<TModel, TProvider>` (`PhoneNumberValueConverter.cs:1`).
- **Concept reinforced**: null pass-through on both legs, taught at [`NullableEmailValueConverter`](#nullableemailvalueconverter). The doc comment states the same rule in the phone vocabulary: "no phone number" stays a NULL column value rather than becoming an empty string or a failed `PhoneNumber.Create` call (`PhoneNumberValueConverter.cs:46-50`).
- **Walkthrough**
  - **Write leg** (`PhoneNumberValueConverter.cs:68`): `phoneNumber => phoneNumber == null ? null : phoneNumber.Value`, persisting the trimmed string the factory produced (`PhoneNumber.cs:36`).
  - **Read leg** (`PhoneNumberValueConverter.cs:69`): `value => value == null ? null : PhoneNumber.Create(value).Value`.
- **Where it's used**: no entity configuration in MMCA.Common, MMCA.ADC, or MMCA.Store maps a property through it today; the only current callers are its unit tests (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/PhoneNumberValueConverterTests.cs:40` for the value round trip, `:53` for the null pass-through). It is shipped ahead of demand so that a consumer adopting the `PhoneNumber` value object does not have to write the lambdas.

### PhoneNumberValueConverter

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Conversions` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/PhoneNumberValueConverter.cs:33` · Level 5 · class (public sealed)

- **What it is**: the non-nullable `ValueConverter<PhoneNumber, string>`, storing a [`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) as its trimmed string value and rebuilding the value object on read (`PhoneNumberValueConverter.cs:33`).
- **Depends on**: [`PhoneNumber`](group-02-domain-building-blocks.md#phonenumber) (`PhoneNumberValueConverter.cs:2`); EF Core's `ValueConverter<TModel, TProvider>` (`PhoneNumberValueConverter.cs:1`).
- **Concept reinforced**: the `HasConversion`-over-`OwnsOne` mapping and the trust-the-column read leg, both taught at [`EmailValueConverter`](#emailvalueconverter). The read-leg contract paragraph is repeated in this file's doc comment (`PhoneNumberValueConverter.cs:24-31`), including the note that only a value written outside EF can break the round trip.
- **Walkthrough**
  - **Write leg** (`PhoneNumberValueConverter.cs:40`): `phoneNumber => phoneNumber.Value`.
  - **Read leg** (`PhoneNumberValueConverter.cs:41`): `value => PhoneNumber.Create(value).Value!`, null-forgiving for the same reason as the email converter: [`Result<T>.Value`](group-01-result-error-handling.md#result) is null on failure (`Result.cs:206-207`), so an unparseable stored value materializes as `null` instead of throwing.
  - **Facets stay at the call site** (`PhoneNumberValueConverter.cs:20-22`): the documented usage chains `HasMaxLength(PhoneNumberInvariants.MaxLength)`, `IsUnicode(false)`, and `IsRequired()` next to `HasConversion` (`PhoneNumberValueConverter.cs:13-19`).
- **Where it's used**: like its nullable sibling, it has no production call site in the three repos today; `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/PhoneNumberValueConverterTests.cs:17` exercises the round trip and `:30` pins the `string` provider type.

### EntityTypeConfiguration<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:28` · Level 6 · class (public abstract)

- **What it is**: the engine-aware configuration base and the busiest type in this family. It reads the target engine off a [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) on the concrete configuration class (or on an inherited shim base) and applies that engine's table/container mapping plus key generation, so a consumer's `Configure` body only ever describes columns, indexes, and relationships (`EntityTypeConfiguration.cs:28-99`).
- **Depends on**: [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype) (base, `EntityTypeConfiguration.cs:29`); all three engine markers, [`IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlservertentity-tidentifiertype), [`IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>`](#ientitytypeconfigurationsqlitetentity-tidentifiertype), [`IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#ientitytypeconfigurationcosmostentity-tidentifiertype) (`:30-32`); [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and the [`DataSource`](#datasource) enum (`:4`, `:43`, `:57`); [`NamespaceConventions`](#namespaceconventions) (`:66`, `:87`); [`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator) (`:7`, `:91`); the `IsIdValueGenerated` extension property from [`EntityTypeExtensions`](group-02-domain-building-blocks.md#entitytypeextensions) (`:61`), which is a lookup for [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:19`); `System.Reflection` and EF Core's `EntityTypeBuilder<TEntity>` (`:1-3`).
- **Concept introduced, one configuration body that is portable across storage engines.** The naive way to support three engines is three configuration classes per entity, or one class littered with `if (engine == ...)`. This class removes both. The engine is declared **once**, as an attribute, and everything that actually differs between engines is centralized in a single `switch` here: SQL Server gets a table in a module schema, SQLite gets a bare table (SQLite has no schemas), Cosmos gets a per-module container with the entity id as partition key (`EntityTypeConfiguration.cs:63-98`). Moving an entity from SQL Server to Cosmos is therefore a one-line attribute change. Two other pieces of the framework complete the portability claim rather than this class alone: [`CosmosDbContext`](#cosmosdbcontext) strips every relational index from the built model, because the Cosmos provider rejects them and indexes every property itself (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:79-87`), and [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) removes FK constraints and navigations that would span physical sources while keeping the declared scalar FK column and a compensating index (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:9-21`). A dedicated test builds a Cosmos model offline from a configuration that keeps a filtered index and a cross-source relationship, and asserts the indexes are gone, the FK is gone, the scalar FK column survives, and the foreign principal is not in the model (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:70-76`). `[Rubric §8, Data Architecture]` assesses how deliberately the storage shape is chosen and how tightly the model is bound to one engine. `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out without a rewrite; being able to re-point an entity's engine and database with attributes is a precondition for that ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html), [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). `[Rubric §16, Maintainability]` assesses whether one decision lives in one place; the per-engine differences live in exactly one `switch`.
- **Concept introduced, discovery and routing that agree by construction.** This class implements **all three** engine marker interfaces (`EntityTypeConfiguration.cs:30-32`), so a configuration derived from it is discovered during every engine's model pass. That sounds wrong until you see the filter: `ApplyConfigurationsForEntitiesInContext` applies a discovered configuration only when [`EntityDataSourceRegistry`](#entitydatasourceregistry) says the entity's [`DataSourceKey`](#datasourcekey) equals this context instance's key (`ApplicationDbContext.cs:709-715`). Both sides read the same attributes: the registry derives the engine from [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and the logical database from [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute), falling back to the entity's module namespace and then to `Default` (`EntityDataSourceRegistry.cs:174-182`), while this class reads the same attribute for its conventions. Discovery is broad, routing is exact, and there is no second source of truth to drift. `[Rubric §1, SOLID]` assesses whether behavior is driven from one declaration; here the attribute is that declaration.
- **Walkthrough**
  - **Declaration** (`EntityTypeConfiguration.cs:28-34`): abstract, extends the base class, implements the three markers, constrained to an audited entity with a non-null identifier type.
  - **`Configure` override** (`EntityTypeConfiguration.cs:37-49`): null-guards the builder (`:39`), calls `base.Configure(builder)` so the `DomainEvents` exclusion runs first (`:41`), then reads the engine.
  - **The attribute read and its failure mode** (`EntityTypeConfiguration.cs:43-46`): `GetType().GetCustomAttribute<UseDataSourceAttribute>()?.DataSource` on the **runtime** type, which is the concrete configuration. `UseDataSourceAttribute` is declared with `Inherited = true` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:12`), which is exactly why a class deriving from one of the shim bases inherits its engine without repeating the annotation. When the attribute is missing entirely the code throws `InvalidOperationException` naming the offending configuration class, rather than defaulting to an engine and mapping the entity somewhere surprising.
  - **`ApplyEngineConventions(builder, engine)`, `protected static`** (`EntityTypeConfiguration.cs:57-99`): extracted as a static helper so the provider shims share the identical logic (`:51-54`). It reads `typeof(TEntity).IsIdValueGenerated` once (`:61`), which is the presence test for [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) on the entity (`EntityTypeExtensions.cs:19`).
  - **SQL Server branch** (`EntityTypeConfiguration.cs:65-72`): `ToTable(entityName, moduleName ?? "dbo")`, so the SQL schema is the module name derived from the entity namespace and unmoduled entities land in `dbo`; `HasKey(p => p.Id)`; then `ValueGeneratedOnAdd()` when the entity opts into generated ids, `ValueGeneratedNever()` otherwise. That last branch is what lets a domain factory assign an id itself without EF overwriting it.
  - **SQLite branch** (`EntityTypeConfiguration.cs:74-81`): `ToTable(entityName)` with no schema, and the generated-id case adds `.UseIdentityColumn(1, 1)` on top of `ValueGeneratedOnAdd()`.
  - **Cosmos branch** (`EntityTypeConfiguration.cs:83-94`): `ToContainer(moduleName ?? entityName).HasPartitionKey(p => p.Id)`, plus `HasValueGenerator<CosmosIntIdValueGenerator>()` for generated ids. The inline comment records the reasoning for one container per module (`:84-85`): all of a module's entities share a container so their relationships and the navigation populators still work, and the entity id doubles as the partition key.
  - **The default arm** (`EntityTypeConfiguration.cs:96-97`): an unimplemented engine throws instead of silently producing an unmapped entity.
  - **`NamespaceConventions.GetModuleName`** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:20-21`): an internal one-line delegation to `ModuleNameConventions.GetModuleName`, documented as taking the namespace segment immediately preceding `Domain` (`MMCA.Store.Sales.Domain.Orders` yields `Sales`) and returning `null` when there is no `Domain` segment (`NamespaceConventions.cs:13-19`). The same helper feeds the logical database name in the registry (`EntityDataSourceRegistry.cs:181`), which is the point of it being shared: schema and database name can never drift apart.
- **Why it's built this way**: the framework's stated multi-database model is one context class per engine and one instance per database ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), with the engine as an orthogonal axis ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). That only works if the mapping conventions for an engine live in one place that every context can call, which is this class. Keeping `ApplyEngineConventions` `static` and `protected` rather than inlining it in `Configure` is what allows the shims to exist as empty declarations.
- **Where it's used**: extended by the three shim bases below, and directly by any configuration that prefers to carry its own `[UseDataSource(...)]` annotation, as one portability test does (`CosmosConfigurationPortabilityTests.cs:101-103`). Its conventions are pinned against a real SQLite model in `SqliteConfig_Configure_SetsTableNameAndKey` and `SqliteConfig_Configure_SetsValueGeneratedNever_WhenNoAttribute` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/EntityTypeConfigurationTests.cs:22`, `:37`).

### ReadRepositoryExtensions

> MMCA.Common.Application · `MMCA.Common.Application.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10` · Level 6 · class (public static)

- **What it is**: a static class that adds one member, `GetByIdOrFailAsync`, to every [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (`ReadRepositoryExtensions.cs:10-12`). It turns the repository's null-returning lookup into a [`Result<T>`](group-01-result-error-handling.md#result) that already carries a typed `NotFound` error, so handlers stop writing the same "load, null-check, build a 404" block.
- **Depends on**: [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) (the receiver, `ReadRepositoryExtensions.cs:12`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (the generic constraint, `:13`); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error) (`:3`, `:43-47`).
- **Concept reinforced, C# `extension(T)` members over an infrastructure abstraction.** The extension-member syntax itself is taught once in the primer ([primer, extension types](00-primer.md#c-extensiont-types-read-this-once)); what matters here is *where* it is applied. `IReadRepository` is an Application-layer abstraction, and this file is in Application, so the helper enriches the contract without widening the interface every implementation would then have to satisfy (including the mocks in the test suite). `[Rubric §1, SOLID]` assesses whether types are open for extension but closed for modification; adding the convenience member as an extension rather than an interface method is precisely that trade. `[Rubric §15, Best Practices & Code Quality]` assesses whether repeated boilerplate has been factored out; the null-check-then-fail block collapses to a single call.
- **Walkthrough**
  - **`extension<TEntity, TIdentifierType>(IReadRepository<TEntity, TIdentifierType> repository)`** (`ReadRepositoryExtensions.cs:12-14`): a generic extension block whose receiver is the repository; the constraints mirror the interface exactly (`TEntity : AuditableBaseEntity<TIdentifierType>`, `TIdentifierType : notnull`).
  - **`GetByIdOrFailAsync(id, source, includes, asTracking, cancellationToken)`** (`ReadRepositoryExtensions.cs:27-32`): note the parameters. `source` is a string the caller passes (typically its own type name) so the resulting error can name who produced it; `includes` and `asTracking` are passed straight through, and `asTracking` defaults to `true`, matching the command-handler case where the loaded entity is about to be modified.
  - **The lookup** (`ReadRepositoryExtensions.cs:34-38`): it calls `GetAllAsync` with `where: e => e.Id.Equals(id)` rather than a keyed fetch. That is deliberate: `GetAllAsync` is the overload that takes the `includes` collection plus tracking (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:85-92`, declared on `IEntityQuerier<TEntity, TIdentifierType>`, which `IReadRepository` composes at `IRepository.cs:330-331`), so the helper participates in the full eager-loading pipeline. `includes ?? []` keeps the parameter optional.
  - **The failure branch** (`ReadRepositoryExtensions.cs:40-45`): `entities.FirstOrDefault()`, and when it is null, `Error.NotFound.WithSource(source).WithTarget(typeof(TEntity).Name)`. [`Error.NotFound`](group-01-result-error-handling.md#error) is the shared static instance (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:23`) and the two `With*` calls return copies (`Error.cs:120`, `:126`), so the shared instance is never mutated and the caller gets an error that names both the caller and the entity type.
  - **The success branch** (`ReadRepositoryExtensions.cs:47`): `Result.Success(entity)`.
- **Why it's built this way**: handlers in this codebase compose with [`Result`](group-01-result-error-handling.md#result), never exceptions, so a lookup that returns `null` forces every call site to translate. Doing the translation once, in the layer that owns the abstraction, keeps the error code, source, and target consistent across every module and keeps the 404 mapping at the API edge working off one well-known `ErrorType`.
- **Where it's used**: the only current callers in the workspace are its own tests (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Extensions/ReadRepositoryExtensionsTests.cs:15`, `:40`); no ADC or Store handler calls it today, and handlers there still do the explicit null check. It is available to any handler that resolves a read repository through [`IUnitOfWork.GetReadRepository`](#iunitofwork).
- **Caveats / not-in-source**: the method loads through `GetAllAsync`, so it materializes a collection and takes the first element rather than issuing a keyed `FindAsync`; whether that costs anything at the database depends on the provider's translation of the `Id.Equals(id)` predicate and is not determinable from source.

### EntityTypeConfigurationCosmos<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationCosmos.cs:18` · Level 7 · class (public abstract)

- **What it is**: a body-less shim over [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) whose only content is the class-level `[UseDataSource(DataSource.CosmosDB)]` annotation (`EntityTypeConfigurationCosmos.cs:17-21`). Deriving from it is equivalent to deriving from the engine-aware base and annotating the concrete class by hand, as its own doc says (`EntityTypeConfigurationCosmos.cs:10-13`).
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (base, `EntityTypeConfigurationCosmos.cs:19`); [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and the [`DataSource`](#datasource) enum (`:1`, `:17`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint, `:20`).
- **Concept reinforced, an attribute expressed as a base class.** All mapping logic (per-module container, entity-id partition key, client-side id generation via [`CosmosIntIdValueGenerator`](#cosmosintidvaluegenerator)) lives in the engine-aware base; this type exists so the engine choice reads as part of the class declaration a consumer already writes, and so `Inherited = true` on the attribute (`UseDataSourceAttribute.cs:12`) carries it to the concrete class. The declaration ends in a semicolon (`EntityTypeConfigurationCosmos.cs:21`): there is genuinely no body.
- **Where it's used**: no configuration in MMCA.Common, MMCA.ADC, MMCA.Store, or the Common test suite derives from it today. The Cosmos path is exercised instead through a direct `[UseDataSource(DataSource.CosmosDB)]` annotation on a configuration deriving from the engine-aware base (`CosmosConfigurationPortabilityTests.cs:101-103`), and the Aspire hosting extensions name the type when documenting which entities a Cosmos data source will serve (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:498`). This matches the state ADR-018 records: the plumbing ships and is tested, with no non-SQL entity in production today.

### EntityTypeConfigurationSqlite<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSqlite.cs:17` · Level 7 · class (public abstract)

- **What it is**: the SQLite shim, identical in shape to its Cosmos sibling: a body-less class carrying `[UseDataSource(DataSource.Sqlite)]` (`EntityTypeConfigurationSqlite.cs:16-20`).
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (base, `EntityTypeConfigurationSqlite.cs:18`); [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and [`DataSource`](#datasource) (`:1`, `:16`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`:19`).
- **Concept reinforced**: the attribute-as-base-class shim taught at [`EntityTypeConfigurationCosmos<TEntity, TIdentifierType>`](#entitytypeconfigurationcosmostentity-tidentifiertype). Its doc records the SQLite-specific mapping it delegates: table name plus an auto-increment key (`EntityTypeConfigurationSqlite.cs:7-12`), implemented in the engine-aware base at `EntityTypeConfiguration.cs:74-81`.
- **Where it's used**: no production configuration in the three repos derives from it, but it is the framework's own in-memory-and-file test engine and is used throughout the Common test suite: the database-initialization tests (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:271`, `:279`), the convention tests (`EntityTypeConfigurationTests.cs:58`), the multi-source integration tests (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:240`, `:241`), and the registry tests (`EntityDataSourceRegistryTests.cs:217`, `:220`, including a deliberate duplicate-configuration pair at `:228` and `:231`).

### EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:17` · Level 7 · class (public abstract)

- **What it is**: the SQL Server shim, `[UseDataSource(DataSource.SQLServer)]` over the engine-aware base (`EntityTypeConfigurationSQLServer.cs:16-20`). It is the type nearly every entity configuration in this workspace actually derives from, which makes it the practical entry point into everything the family does.
- **Depends on**: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) (base, `EntityTypeConfigurationSQLServer.cs:18`); [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute) and [`DataSource`](#datasource) (`:1`, `:16`); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (`:19`).
- **Concept reinforced, and what a consumer inherits by writing one base name.** Deriving from this class buys four behaviors without a line of code: the `DomainEvents` exclusion from [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype), a table named after the entity in a schema named after the module (`EntityTypeConfiguration.cs:66`), a primary key with the right generation policy for the entity's [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (`:67-71`), and a [`DataSourceKey`](#datasourcekey) in [`EntityDataSourceRegistry`](#entitydatasourceregistry) that makes the entity routable through [`IUnitOfWork`](#iunitofwork) and [`DbContextFactory`](#dbcontextfactory). Adding a class-level [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) on top overrides only the logical database, leaving the engine alone (`EntityDataSourceRegistry.cs:180-182`). `[Rubric §16, Maintainability]` assesses how much a consumer must know to add an entity correctly; here it is one base class name.
- **Where it's used**: 28 configurations across ADC's Conference, Engagement, and Identity modules (for example `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:13` and `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePolls/LivePollConfiguration.cs:16`), 12 across Store's Catalog, Sales, and Identity modules, MMCA.Helpdesk's two Tickets configurations (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Infrastructure/Persistence/EntityConfiguration/TicketConfiguration.cs`, `MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Infrastructure/Persistence/EntityConfiguration/TicketCommentConfiguration.cs`), and the framework's own notification configurations, [`PushNotificationConfiguration`](#pushnotificationconfiguration) and [`UserNotificationConfiguration`](#usernotificationconfiguration). It is also the SQL Server half of the cross-engine portability test (`CosmosConfigurationPortabilityTests.cs:116`).

### IRepositoryFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/IRepositoryFactory.cs:11` · Level 7 · interface (public)

- **What it is**: a two-method contract that builds a repository over a **caller-supplied** `DbContext` (`IRepositoryFactory.cs:11-34`). `Create` returns a read-write [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype), `CreateReadOnly` returns an [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype), and the class doc records the one behavior an implementation is expected to fold in: conditional MiniProfiler wrapping (`IRepositoryFactory.cs:7-10`).
- **Depends on**: EF Core's `DbContext` as the single parameter of both methods (NuGet, `IRepositoryFactory.cs:1`, `:20`, `:31`); [`IRepository<TEntity, TIdentifierType>`](#irepositorytentity-tidentifiertype) and [`IReadRepository<TEntity, TIdentifierType>`](#ireadrepositorytentity-tidentifiertype) as return types (`:2`, `:19`, `:30`); [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) and [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) as the two entity constraints (`:3`, `:21`, `:32`).
- **Concept introduced, a factory for the argument DI cannot supply.** Plain constructor injection can hand a repository a `DbContext`, and the container does exactly that for the open-generic registration `TryAddScoped(typeof(IRepository<,>), typeof(EFRepository<,>))` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:119`). That registration can only ever bind **one** context, because DI resolves by type. This framework does not have one context: it has one context **instance per** [`DataSourceKey`](#datasourcekey), created and cached per scope by [`DbContextFactory`](#dbcontextfactory), and which instance an entity belongs to is a runtime lookup through [`IDataSourceService`](#idatasourceservice) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:40-41`). So the context stops being a dependency and becomes an argument, and an argument-taking creation step is a factory. This is the type-level reason the codebase forbids constructor-injecting `IRepository<,>` directly: that path silently binds whatever the container's single registration resolves, while everything routed through [`IUnitOfWork`](#iunitofwork) reaches this factory and gets the context its entity actually lives in. `[Rubric §2, Design Patterns]` assesses whether a pattern earns its place rather than decorating the code; here the factory exists because DI provably cannot express the requirement. `[Rubric §8, Data Architecture]` assesses how deliberately storage boundaries are drawn; per-source repository construction is what keeps database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) true at the level a handler touches.
- **Walkthrough**
  - **`Create<TEntity, TIdentifierType>(DbContext dbContext)`** (`IRepositoryFactory.cs:19-22`): constrained to `TEntity : AuditableAggregateRootEntity<TIdentifierType>` and `TIdentifierType : notnull`. Writes go through aggregate roots only, which is the DDD rule expressed in the signature rather than in a comment.
  - **`CreateReadOnly<TEntity, TIdentifierType>(DbContext dbContext)`** (`IRepositoryFactory.cs:30-33`): the same shape with a looser entity constraint, [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype). Reads may target a child entity that is not itself an aggregate root, which is exactly the asymmetry [`IUnitOfWork`](#iunitofwork) exposes on its own `GetRepository` / `GetReadRepository` pair (`UnitOfWork.cs:33-35`, `:53-55`).
  - **What the interface deliberately does not say**: nothing about profiling, decoration, caching, or activation. Those are implementation choices, and [`RepositoryFactory`](#repositoryfactory) makes them all.
- **Why it's built this way**: extracting the two lines from `UnitOfWork` into a contract means the unit of work never asks "is profiling on"; it asks for a repository and gets whichever composition the host configured. It also gives the test suite a substitution point that does not require a real context factory.
- **Where it's used**: registered scoped as `IRepositoryFactory -> RepositoryFactory` (`DependencyInjection.cs:120`) and pinned by `AddInfrastructure_RegistersIRepositoryFactory` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/DependencyInjectionInfrastructureTests.cs:239-252`). Its only production consumer is [`UnitOfWork`](#unitofwork), which injects it (`UnitOfWork.cs:13`, `:16`) and calls `Create` (`:42`) and `CreateReadOnly` (`:62`) once per entity type, caching the result for the rest of the scope (`:38-44`, `:58-64`).

### PushNotificationConfiguration

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:16` · Level 8 · class (internal sealed)

- **What it is**: the EF Core mapping for [`PushNotification`](group-10-notifications.md#pushnotification), the framework's own broadcast-notification aggregate (`PushNotificationConfiguration.cs:16-72`). It is one of only two entity configurations that ship **inside the framework** rather than in a consumer application, and it is where the dedup guarantee behind a retried send is actually enforced.
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) as its base (`PushNotificationConfiguration.cs:17`); [`PushNotification`](group-10-notifications.md#pushnotification) and its `DedupKeyMaxLength` / `ScopeKeyMaxLength` constants (`:3`, `:47`, `:53`, declared at `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:19`, `:22`); [`PushNotificationInvariants`](group-10-notifications.md#pushnotificationinvariants) for the title and body lengths (`:4`, `:29`, `:33`); [`PushNotificationStatus`](group-10-notifications.md#pushnotificationstatus) indirectly through the string conversion (`:43`); [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) (`:15`); the `HasSoftDeleteFilter` member from [`IndexBuilderExtensions`](#indexbuilderextensions) (`:70`); EF Core's `EntityTypeBuilder<TEntity>` (NuGet, `:1-2`).
- **Concept introduced, a framework-owned entity that has to name its own home.** Every other configuration in this workspace lets convention pick the schema and the logical database: [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) maps a SQL Server entity to a table in a schema named by [`NamespaceConventions`](#namespaceconventions), which is the namespace segment immediately preceding `Domain` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:66`). That rule is right for a consumer entity in `MMCA.ADC.Conference.Domain.Sessions` (schema `Conference`) and wrong here, because this entity lives in `MMCA.Common.Domain.Notifications.PushNotifications`, whose preceding segment is `Common`. The configuration therefore states both facts explicitly: `[UseDatabase("Notification")]` (`PushNotificationConfiguration.cs:15`) fixes the logical database that [`EntityDataSourceRegistry`](#entitydatasourceregistry) records, and `ToTable(nameof(PushNotification), "Notification")` (`:25`) overrides the auto-derived schema after the base call. The class doc states this reasoning in place (`:8-14`), including the consequence that matters for a small host: a host with no `DataSources:Notification` entry keeps these tables in its default database. `[Rubric §8, Data Architecture]` assesses whether the physical layout is a decision rather than an accident; this is a convention override made visible in two attributes on one class. `[Rubric §10, Cross-Cutting]` assesses whether shared capabilities carry their own infrastructure; the notification feature ships its schema with the framework instead of asking each consumer to re-declare it.
- **Concept introduced, letting the database arbitrate a duplicate send.** A "have I already sent this?" check in a handler is a check-then-act race: two retries of the same request can both read "no row" before either writes. The filtered unique index on `DedupKey` (`PushNotificationConfiguration.cs:68-70`) removes the race by moving arbitration into the engine, and the filter is what makes it usable: `IS NOT NULL` keeps the many sends that carry no key from colliding with each other (SQL Server treats NULLs as equal in a unique index), and `IsDeleted = 0` keeps a soft-deleted notification from squatting on its key forever. The comment block records both halves and the defect that produced the second one (`:55-67`). `[Rubric §12, Performance & Scalability]` assesses whether index choices are reasoned; the file argues **for** one index and **against** another in the same class. `[Rubric §29, Resilience & Business Continuity]` assesses behavior under retry; at-least-once delivery upstream is only safe because this index makes a repeated send idempotent at the storage layer.
- **Walkthrough**
  - **`base.Configure(builder)`** (`PushNotificationConfiguration.cs:22`): runs the inherited chain first. [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](#entitytypeconfigurationbasetentity-tidentifiertype) ignores the aggregate's in-memory `DomainEvents` collection (`EntityTypeConfigurationBase.cs:29-32`), then [`EntityTypeConfiguration<TEntity, TIdentifierType>`](#entitytypeconfigurationtentity-tidentifiertype) reads the engine off the `[UseDataSource(DataSource.SQLServer)]` carried by the shim base (`EntityTypeConfigurationSQLServer.cs:16`) and applies the SQL Server conventions: table plus schema, `HasKey(p => p.Id)`, and `ValueGeneratedOnAdd()` because the entity carries [`IdValueGeneratedAttribute`](group-02-domain-building-blocks.md#idvaluegeneratedattribute) (`EntityTypeConfiguration.cs:43-48`, `:65-72`, `PushNotification.cs:15`).
  - **The schema override** (`PushNotificationConfiguration.cs:25`): `ToTable(nameof(PushNotification), "Notification")`, applied **after** the base call so it replaces the derived `Common` schema rather than being replaced by it. Ordering is load-bearing here.
  - **Required scalars** (`:27-39`): `Title` required with `HasMaxLength(PushNotificationInvariants.TitleMaxLength)` (200, `MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:13`), `Body` required at `BodyMaxLength` (2000, `PushNotificationInvariants.cs:16`), `SentByUserId` and `RecipientCount` required. The column widths are the same constants the domain validates against (`PushNotificationInvariants.cs:18-26`), so the database cannot be narrower than the invariant.
  - **`Status` stored as text** (`:41-44`): `HasConversion<string>()` with `HasMaxLength(20)`. The CLR type is the `PushNotificationStatus` enum with three members, `Pending`, `Sent`, `Failed` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/PushNotifications/PushNotificationStatus.cs:6-16`); persisting the name rather than the ordinal means reordering or inserting an enum member does not silently re-interpret existing rows.
  - **`DedupKey`** (`:46-47`): nullable, bounded by `PushNotification.DedupKeyMaxLength` (128, `PushNotification.cs:19`). The domain records that this is typically the `Idempotency-Key` header value and that the filtered unique index is what arbitrates the race (`PushNotification.cs:39-45`).
  - **`ScopeKey`** (`:52-53`): nullable, bounded by `ScopeKeyMaxLength` (128, `PushNotification.cs:22`), and deliberately **not** indexed. The comment gives the economics (`:49-51`): the scope filter runs after the primary-key join from [`UserNotification`](group-10-notifications.md#usernotification), over a table holding one row per send, so an index would cost writes without buying a read.
  - **The filtered unique index** (`:68-70`): `HasIndex(p => p.DedupKey).IsUnique().HasSoftDeleteFilter(additionalFilter: "[DedupKey] IS NOT NULL")`. The helper composes the final predicate as `{additionalFilter} AND {softDeletePredicate}` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/IndexBuilderExtensions.cs:60-63`), and the soft-delete half comes from [`SoftDeleteFilterSql`](#softdeletefiltersql), which reads the actual column name out of the model and quotes it per engine (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:32-36`). The `engine` parameter is not passed, so the default `DataSource.SQLServer` applies (`IndexBuilderExtensions.cs:51`), which matches this configuration's engine base class. The result is `[DedupKey] IS NOT NULL AND [IsDeleted] = 0`, asserted verbatim by `DedupKeyIndex_FiltersOutSoftDeletedRows` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/PushNotificationConfigurationTests.cs:26-30`).
  - **Why the opt-in call is belt and braces, not a requirement** (`:62-67`): [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) stamps the soft-delete predicate onto every unique index of a soft-deletable entity, and it now **extends** a hand-authored filter instead of skipping it: an index that already declares a predicate gets `{existingFilter} AND {filterSql}` in that exact order (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:65-79`), and an index whose filter already constrains the soft-delete column is left untouched so a second model build cannot append the clause twice (`:72-75`). Because `HasSoftDeleteFilter` produces the same SQL in the same order from the same column name, the convention recognizes this index and stops, which is what the configuration's own comment says (`PushNotificationConfiguration.cs:64-67`).
- **Why it's built this way**: the two overrides exist because a framework-owned domain type cannot be named by the convention that names consumer domain types, and stating the target explicitly is cheaper than special-casing the convention. The soft-delete clause on the dedup index is a fix, not an original design: it closes a defect where a soft-deleted notification held its dedup key permanently, and ADC's migration for it is an explicit expand-contract drop and recreate, since a filtered index predicate cannot be altered in place (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260804185520_CommonV1141PushNotificationDedupIndexSoftDeleteFilter.cs:13-31`). The migration comment argues the safety case explicitly: the new predicate is strictly more permissive, so a previous revision running against the new index still succeeds.
- **Where it's used**: discovered by assembly scan rather than by a direct reference. `AddNotificationInfrastructure()` registers this class's assembly as an entity-configuration source (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:614-619`, naming the type only to get its `Assembly` at `:602-603`), and the only production caller is ADC's Notification module (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:31`), whose service points the logical `Notification` source at the `ADC_Notification` database (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.Development.json:37-41`). Store hosts no notification entities today: the only other callers of `AddNotificationInfrastructure` are Common's own DI tests. Behavior is pinned against a real model built from this exact configuration (`PushNotificationConfigurationTests.cs:76-83`): index uniqueness (`:22-24`), the composed filter (`:26-30`), the scope-key length and nullability (`:35-41`), and the deliberate absence of a scope-key index (`:43-49`).
- **Caveats / not-in-source**: the test double builds the model on SQLite (`PushNotificationConfigurationTests.cs:69-71`) while the configuration targets SQL Server, so the asserted filter string is the one this class hand-authors, not one a SQL Server model build rewrote.

### UserNotificationConfiguration

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/UserNotificationConfiguration.cs:15` · Level 8 · class (internal sealed)

- **What it is**: the EF Core mapping for [`UserNotification`](group-10-notifications.md#usernotification), the per-user inbox row that pairs a recipient with a broadcast (`UserNotificationConfiguration.cs:15-47`). It is the sibling of [`PushNotificationConfiguration`](#pushnotificationconfiguration) and shares its shape exactly: `internal sealed`, `[UseDatabase("Notification")]`, [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) base, and a `ToTable` that overrides the derived `Common` schema.
- **Depends on**: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](#entitytypeconfigurationsqlservertentity-tidentifiertype) (`UserNotificationConfiguration.cs:16`); [`UserNotification`](group-10-notifications.md#usernotification) (`:3`, `:24`); [`UseDatabaseAttribute`](group-14-module-system-composition.md#usedatabaseattribute) (`:14`); EF Core's `EntityTypeBuilder<TEntity>` (NuGet, `:1-2`).
- **Concept reinforced**: the schema-and-database override taught at [`PushNotificationConfiguration`](#pushnotificationconfiguration), with the identical doc comment stating why (`UserNotificationConfiguration.cs:7-13`). What is worth studying here instead is the **index pair**, which shows the unique and the non-unique filtered case side by side. `[Rubric §12, Performance & Scalability]` assesses whether hot read paths are backed by an index that matches the query's predicate; the unread lookup below is a textbook covering-filter case.
- **Walkthrough**
  - **Base call and schema override** (`UserNotificationConfiguration.cs:21`, `:24`): same order and same reason as its sibling.
  - **Scalars** (`:26-36`): `UserId` and `PushNotificationId` required, `IsRead` required with `HasDefaultValue(false)` so an inserted row is unread at the database level too, and `ReadOn` mapped with no facets, staying nullable because the domain declares it `DateTime?` (`MMCA.Common/Source/Core/MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:24`).
  - **Uniqueness per recipient** (`:38-41`): `HasIndex(p => new { p.UserId, p.PushNotificationId }).IsUnique().HasFilter("[IsDeleted] = 0")`, one inbox row per user per notification among live rows. Note the literal predicate: this index would have received the same filter automatically from [`SoftDeleteUniqueIndexConvention`](#softdeleteuniqueindexconvention) (`SoftDeleteUniqueIndexConvention.cs:60-68`), because it is unique and the entity is soft-deletable, so the hand-written string is belt and braces. The convention detects that the declared filter already constrains the soft-delete column and leaves it exactly as written (`:72-75`).
  - **The unread lookup** (`:43-45`): `HasIndex(p => new { p.UserId, p.IsRead }).HasFilter("[IsDeleted] = 0")`, non-unique, serving the per-user unread query behind the notification badge. This is the case the convention deliberately skips, since it continues past any index that is not unique (`SoftDeleteUniqueIndexConvention.cs:62-63`), so the filter here **is** required to keep soft-deleted rows out of the index. It is written as a literal rather than through `HasSoftDeleteFilter()` from [`IndexBuilderExtensions`](#indexbuilderextensions), which is the helper that reads the column name from the model instead (`IndexBuilderExtensions.cs:50-64`); the produced SQL is identical for this model.
  - **No relationship to `PushNotification`** (`:29-30`): `PushNotificationId` is configured as a plain required scalar, with no `HasOne` or `WithMany` anywhere in the file, and the domain entity exposes no navigation property either, only the identifier (`UserNotification.cs:18`). The inbox row references the broadcast by value.
- **Why it's built this way**: modeling the reference as a bare scalar keeps the entity honest about what the database enforces, and it is the shape the framework can move without rework. Both notification tables carry `[UseDatabase("Notification")]` today, so they land in one database and a declared relationship would be legal; the moment a host routed them apart, [`CrossDataSourceDegradeConvention`](#crossdatasourcedegradeconvention) would strip the EF relationship and the FK constraint anyway and leave exactly this scalar behind (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:9-21`). That is the same rule ADC applies to every cross-module reference under database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).
- **Where it's used**: registered by the same assembly scan as its sibling (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:614-619`) and reached in production only through ADC's Notification module (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:31`), where the `UserNotification` table lands in the `Notification` schema of `ADC_Notification` (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.Development.json:37-41`).
- **Caveats / not-in-source**: unlike its sibling, this configuration has no dedicated unit test in the Common suite; its mapping is exercised indirectly through the ADC Notification migrations and integration tier.

### RepositoryFactory

> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:15` · Level 10 · class (public sealed)

- **What it is**: the single implementation of [`IRepositoryFactory`](#irepositoryfactory). It activates the concrete EF repository over the supplied `DbContext` through a **compiled, cached** constructor delegate, and wraps it in a profiling decorator when the host has MiniProfiler switched on (`RepositoryFactory.cs:15-86`).
- **Depends on**: `IServiceProvider` and `IOptions<ApplicationSettings>`, both primary constructor parameters, unwrapped to fields at construction (`RepositoryFactory.cs:15-18`); [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings) for the one flag it reads (`:6`, `:34`, `:58`); [`EFRepository<TEntity, TIdentifierType>`](#efrepositorytentity-tidentifiertype), [`EFReadRepository<TEntity, TIdentifierType>`](#efreadrepositorytentity-tidentifiertype), [`EFRepositoryDecorator<TEntity, TIdentifierType>`](#efrepositorydecoratortentity-tidentifiertype), [`EFReadRepositoryDecorator<TEntity, TIdentifierType>`](#efreadrepositorydecoratortentity-tidentifiertype) as the four concrete types it can build (`:32`, `:37`, `:56`, `:61`); `Microsoft.Extensions.DependencyInjection.ActivatorUtilities` and its `ObjectFactory` delegate type (NuGet, `:3`, `:81-85`); `System.Collections.Concurrent.ConcurrentDictionary` (BCL, `:1`, `:70`); EF Core's `DbContext` (`:2`).
- **Concept introduced, reflective activation traded for a cached compiled factory.** `ActivatorUtilities.CreateInstance` is the usual way to build a type whose constructor mixes DI-resolved services with caller-supplied arguments, and it is what this class used to call. Its cost is per call: it matches the constructor by reflection every time and caches nothing, so a request touching four aggregates paid four reflective activations. `ActivatorUtilities.CreateFactory` does the matching **once** and returns an `ObjectFactory`, a compiled delegate that can be invoked repeatedly. The insight that makes caching safe is stated in the code (`RepositoryFactory.cs:74-79`): each **closed** repository type here always takes the same argument shape, so the delegate can be keyed by type alone with no risk of a shape mismatch. `[Rubric §12, Performance & Scalability]` assesses whether hot paths avoid repeated per-call work; repository creation is on every command and query, so a per-type one-time cost replaces a per-call one. `[Rubric §15, Best Practices & Code Quality]` assesses whether an optimization is justified in place rather than left as folklore; the doc comment names the exact scenario it fixes.
- **Concept reinforced, decoration decided by configuration.** The decorator pattern itself is taught in the CQRS pipeline chapter. Here it appears in its simplest form and with a switch: `ApplicationSettings.UseMiniProfiler` (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:14`) decides whether the plain repository is returned or is passed as the inner instance of a timing decorator. When the flag is off there is no wrapper object and no indirection at all, so profiling costs nothing in a production host that leaves it off. `[Rubric §13, Observability & Operability]` assesses whether the system can be inspected without being rebuilt; per-repository timing is a configuration flip.
- **Walkthrough**
  - **Primary constructor** (`RepositoryFactory.cs:15-18`): captures the provider into `_serviceProvider` and, importantly, resolves `IOptions<ApplicationSettings>.Value` once into `_applicationSettings` rather than on every call. Nothing else is resolved at construction, so the class stays cheap to create per scope (`DependencyInjection.cs:106` registers it scoped).
  - **`Create<TEntity, TIdentifierType>(DbContext dbContext)`** (`:26-42`): builds `EFRepository<TEntity, TIdentifierType>` through `Factory(..., DbContextArg)(_serviceProvider, [dbContext])` (`:31-32`). Only the context is passed positionally; the repository's two remaining constructor parameters are optional, `TimeProvider?` and `ICurrentUserService?` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:23-27`), and come from the provider, with the class doc recording the fallback when they are absent: the system clock and no user stamp (`EFRepository.cs:17-22`). When `UseMiniProfiler` is true (`:34`) the instance is re-wrapped by activating `EFRepositoryDecorator<TEntity, TIdentifierType>` with an argument shape of `[typeof(IRepository<TEntity, TIdentifierType>)]` (`:36-38`), matching the decorator's single `inner` parameter (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:14`).
  - **`CreateReadOnly<TEntity, TIdentifierType>(DbContext dbContext)`** (`:50-66`): the identical sequence against `EFReadRepository` and `EFReadRepositoryDecorator`, with the looser [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) constraint.
  - **`DbContextArg`** (`:68`): a single static `Type[]` holding `typeof(DbContext)`, shared by both creation paths so the common case allocates no argument-type array per call.
  - **`FactoryCache`** (`:70`): a static `ConcurrentDictionary<Type, ObjectFactory>`, so the compiled delegates are shared process-wide across scopes and requests, not per factory instance.
  - **`Factory(Type implementationType, Type[] argumentTypes)`** (`:81-85`): `FactoryCache.GetOrAdd(implementationType, static (type, args) => ActivatorUtilities.CreateFactory(type, args), argumentTypes)`. Two details are deliberate: the value factory is `static`, so it captures nothing, and the argument types travel through `GetOrAdd`'s state parameter instead of a closure, which is what keeps the lookup allocation-free on the hit path.
- **Why it's built this way**: [`UnitOfWork`](#unitofwork) must create a repository over a **specific** context instance chosen by data source (`UnitOfWork.cs:40-42`), which no container registration can express, so something has to do the activation by hand. Once that step exists, it is also the natural place to fold in the optional profiling decorator, and the natural place to pay the reflection cost once rather than per call. The class is `public` while all four types it builds are `internal`, which is the point: consumers get the contract and the composition, never the concrete repository types.
- **Where it's used**: injected into [`UnitOfWork`](#unitofwork) (`UnitOfWork.cs:13`, `:16`) and called from `GetRepository` (`:42`) and `GetReadRepository` (`:62`). Because the unit of work caches one repository per entity type per scope (`:38-44`), the factory typically runs once per entity type per request, and the compiled delegate is reused for every later request in the process. All four composition outcomes are pinned directly against a real SQLite context: plain repository with the flag off, decorated with it on, and the same pair for the read side (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Repositories/RepositoryFactoryTests.cs:43-93`), plus two tests asserting the built instances are functional repositories (`:95-115`). Those tests construct the factory directly with `Options.Create(new ApplicationSettings { UseMiniProfiler = false })` (`:98`, `:100`), which is the shape the primary constructor takes.
- **Caveats / not-in-source**: the cache is keyed by implementation type only, which is correct exactly as long as every call site for a given closed type passes the same argument shape. Both current call sites do, and the doc comment states that assumption (`RepositoryFactory.cs:74-79`), but nothing in the code enforces it: a future overload passing a different `argumentTypes` array for an already-cached type would silently reuse the first delegate.


---
[⬅ Validation](group-06-validation.md)  •  [Index](00-index.md)  •  [Authentication & Authorization ➡](group-08-auth.md)
