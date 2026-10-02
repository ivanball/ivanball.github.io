# Database-per-service inside a monolith (and why)

> Series: MMCA.Common · Article #10 (cornerstone deep-dive) · Pillar P3 · Group G07 · Rubric §7,§8 ·
> ADR-006, ADR-073, ADR-113 · Status: grounded in `Website/docs-src/adr/006-database-per-service.md`,
> `Website/docs-src/adr/073-multi-tenancy-model.md`,
> `Website/docs-src/adr/113-postgresql-as-a-first-class-engine.md`, `MMCA.Common/AGENTS.md` (the
> "Multi-Database Strategy (database per service)" and "Outbox and Internal Commands" sections), and
> `Website/docs-src/onboarding/group-07-persistence-ef-core.md`. No em dashes.

**Subtitle:** One `DbContext` class. Many databases. A host with no extra configuration behaves
exactly like a single-database monolith, and the same code runs against per-service databases the day
you split. Here is how, and the one consistency guarantee you give up.

---

Most "database per microservice" advice assumes you already have microservices. You do not, on day
one. You have a monolith, one connection string, and a reasonable wish to not paint yourself into a
corner. The usual answer is to either share one database forever (and inherit a coupling you can
never unwind) or to split the databases prematurely (and inherit distributed-systems pain before you
have a single user). Neither is good.

MMCA.Common does something quieter. It runs **database-per-service semantics inside the monolith**,
in a way that collapses to a plain single-database monolith when you have not configured anything,
and expands to physically separate databases when you have, with no change to your entity or handler
code. The swap point is present from the first commit and free until you use it.

## Why it matters

Two failures hide in the shared-database monolith, and both surface at the worst possible time.

The first is the coupling itself. Once a foreign key spans two modules, those modules can never be
deployed or scaled independently. You can call them "modules," but at the schema level they are one
thing. The eventual extraction is a data migration, which is to say a rewrite with a maintenance
window.

The second was a concrete bug in this codebase. When the modules were first extracted into separate
service processes, they still pointed at one shared SQL database with one `OutboxMessages` table.
Every service's `OutboxProcessor` polled that same table with no origin filter, so the services
**raced** to claim each other's outbox rows. That race is the proximate reason ADR-006 was written.
Physical isolation is simpler and stronger than bolting an `OriginService` filter onto a shared
table, so the decision was: each service owns its own database, with its own `OutboxMessages`.

## The MMCA answer: one context class, one instance per database

The single most counter-intuitive fact, and the one every other choice flows from: there is exactly
**one concrete context class per engine** (`SQLServerDbContext`, `PostgreSQLDbContext`,
`SqliteDbContext`, `CosmosDbContext`), each a sealed subclass of the abstract base
`ApplicationDbContext`. The framework deliberately does **not** split per module into
`ConferenceDbContext`, `EngagementDbContext`, and so on. Yet a real deployment runs four separate
SQL databases, one per module, all served by the single `SQLServerDbContext` class.

How does one class serve four databases? It is **instantiated once per physical database.** Each
instance carries a different connection string and builds a different EF model that contains only its
own database's entities. The piece that stops EF from reusing the first model for all four is
`DataSourceModelCacheKeyFactory`, which keys EF's internal model cache by (context type, physical
source name) rather than by context type alone. Without it, the first model built would silently be
reused for every database, which is a quiet and catastrophic bug.

### Routing: where does an entity live?

An entity's home database is never declared on the entity. It is derived at startup from its EF
configuration class. Three cooperating pieces do this:

- Every entity resolves to a `DataSourceKey(Engine, Name)`: the engine from the configuration base
  class (`EntityTypeConfigurationSQLServer`/`PostgreSQL`/`Cosmos`/`Sqlite`), and the name from a
  `[UseDatabase("X")]` attribute, falling back to the module name derived from the entity's
  namespace, falling back to `"Default"`.
- `DataSourceResolver` (singleton) is the logical-to-physical mapper. It reads the `DataSources`
  appsettings section and builds a logical-name-to-physical-key map.
- `EntityDataSourceRegistry` (singleton) reflects over the configuration assemblies and maps every
  entity to its physical source, so routing never depends on a model having already been built. The
  scan is built lazily on first access (and rescans once on a lookup miss to pick up module
  assemblies loaded later), yet it is always one complete pass over every configuration, independent
  of any model build. It fails fast if two configurations claim one entity for different databases.
  An entity lives in exactly one database.

### The collapse property: monolith and distributed are the same code

Here is the feature that makes the whole thing work. `DataSourceResolver` **collapses** logical
sources. A logical name with no connection string, or whose connection string equals the top-level
default, collapses onto the shared `Default` source. Two logical names sharing a connection string
collapse to one canonical physical source.

The consequence: **a host with no `DataSources` configuration behaves exactly like a single-database
monolith.** One context, one change tracker, foreign keys intact, transactions intact. Add one config
entry pointing a module at a separate database, and that module's data is now physically isolated,
with no change to entity or handler code. This collapse is the single property that makes the
monolith and the distributed deployment run the same code path.

### Building the contexts: the factory pair

Two factories turn a `DataSourceKey` into a live context. `PhysicalDbContextFactory` (singleton,
**never pooled** because each instance carries per-source state) creates the raw context for a given
key. Above it, `DbContextFactory` (scoped) is the per-request coordinator: it caches one context per
`DataSourceKey` within a scope, so every repository targeting the same database shares one change
tracker, and it owns the cross-source save, transaction, and disposal coordination.

### Cross-source relationships degrade automatically

EF cannot enforce a foreign key into another database. So `CrossDataSourceDegradeConvention`, a
model-finalizing convention, reshapes any relationship whose two ends resolve to different physical
sources. It removes the cross-source FK constraint but **keeps the scalar FK column plus a
compensating index**, so the value is still stored and queryable. It ignores the CLR navigation
members that point at the foreign entity, and removes the foreign entity types from this model
entirely. Runtime navigation across the boundary then flows through the `INavigationPopulator`
batch-loader (its own pattern, in another article), and cross-source consistency becomes the outbox's
job, not a transaction's.

The elegant part: when every entity collapses onto one database (the monolith case), nothing is
foreign, and the convention is a **structural no-op.** The model it produces is byte-for-byte the
single-database model. The swap point exists, is tested, and costs nothing when unused.

## What it looks like in configuration

You do not write routing code. You write configuration, and the same compiled binary becomes a
monolith or a set of isolated services depending on what is in `appsettings.json`.

```jsonc
// MONOLITH: no DataSources section. Every logical source collapses onto Default.
// One database, one change tracker, FKs intact. Identical to a plain single-DB app.
{
  "ConnectionStrings": { "SQLServerConnectionString": "Server=...;Database=App;..." }
}

// DATABASE-PER-SERVICE: each module points at its own physical database.
// CrossDataSourceDegradeConvention degrades any cross-module relationship to a scalar FK,
// and the per-source OutboxProcessor only ever drains its own OutboxMessages table.
{
  "ConnectionStrings": { "SQLServerConnectionString": "Server=...;Database=App;..." },
  "DataSources": {
    "Conference": { "SQLServerConnectionString": "Server=...;Database=App_Conference;..." },
    "Engagement": { "SQLServerConnectionString": "Server=...;Database=App_Engagement;..." }
  }
}
```

The entity classes, the `[UseDatabase]` attributes, the repositories, and the handlers are identical
across both. The only thing that changed is the config.

## The third axis: which customer owns the row

Source name is one axis of partitioning, and the engine is another (that is the next article).
Neither of them is a tenant. ADR-073 adds the third axis, "which customer does this row belong to,"
and the reason it belongs in this article is that it lands as one more filter plus one more override
on the routing you have already seen, rather than as a parallel mechanism.

Shared-schema tenancy is a **second named query filter.** An entity that implements `ITenantEntity`
gets a required 64-character `TenantId` column, an index on it that widens to
(`TenantId`, `IsDeleted`) when the entity is soft-deletable too, so it matches the composed
predicate instead of handing deleted rows back for the server to discard, and the predicate
`e => CurrentTenantId == null || e.TenantId == CurrentTenantId`, applied to every matching entity
type by `ApplyTenantFilters` beside the soft-delete pass in `OnModelCreating`. EF10 lets a global
filter carry a name, so `Tenant` composes with `SoftDelete` by AND and neither one knows the other
exists. The predicate embeds the context itself as a typed constant rather than closing over the
tenant string, and that detail is load-bearing: EF rewrites a context-typed constant to the executing
context at query-compile time, so **one cached model per source serves every tenant** and the tenant
value travels as a SQL parameter instead of baking a compiled model per customer. A null tenant is
the system context and sees everything, which is what keeps the outbox processor, the seeders, and
the retention jobs working: they have no request, so they have no claim. Outbox delivery narrows
again per row: each `OutboxMessage` records the tenant its raising request resolved to, and the
processor restores that tenant (with the user, roles, and correlation id) onto a fresh scope for each
row before dispatch, so a handler reads and writes the same tenant's rows the original request did.

Resolution is claim first, then header, and it fails closed. `TenantResolutionMiddleware` runs
immediately after `UseAuthentication` (a claim-first order needs `HttpContext.User` already
populated), is registered unconditionally, and passes every request straight through until
`Tenancy:Enabled` is on. With `RequireTenant` (true by default) a request that resolves no tenant on
a non-excluded path is answered with a 400 ProblemDetails rather than allowed through unscoped,
because an unscoped request reads across every tenant, which is the exact outcome tenancy exists to
prevent.

Writes sit on an invariant rather than on discipline. A dedicated `TenantSaveChangesInterceptor`,
separate from the audit and domain-event interceptors and registered between them, stamps `TenantId`
on inserts and throws `CrossTenantWriteException` on any added, modified, or deleted entry belonging
to a different tenant. With no tenant resolved it lets an already-tenanted row through as-is (that is
how a background worker drains one tenant's work) and refuses only the insert that has no tenant to
supply. Reads are just as narrow: the repository's `ignoreQueryFilters: true` drops the named
`SoftDelete` filter only, through one shared array used at all eight call sites, so a
soft-delete-inclusive read still carries the tenant filter and cannot cross tenants by accident.

Database-per-tenant is then the smallest possible extension of everything above. A per-tenant entry
overrides the connection string for one source and keeps the **same `DataSourceKey`**, so the scoped
`DbContextFactory` clones the resolver's `PhysicalDataSource` with the override, EF's model cache key
is unchanged, and one compiled model still serves every tenant's database:

```jsonc
// DATABASE-PER-TENANT: "acme" shares the pooled database and is separated by the query filter alone.
// "globex" re-points one source at its own database. Same key, different connection string.
{
  "Tenancy": {
    "Enabled": true,
    "Tenants": {
      "acme": {},
      "globex": {
        "DataSources": {
          "Default": { "SQLServerConnectionString": "Server=...;Database=Helpdesk_Globex;..." }
        }
      }
    }
  }
}
```

Because an override changes where a source points rather than what a source is, the pieces around it
keep working unchanged. The entity registry, the migrations assembly, and the per-source outbox all
survive: the outbox simply enumerates `(source, tenant)` pairs and drains one extra unit per tenant
that keeps its own copy of a source. Routing never reads the row: the targets come from those
configured pairs, and the nullable `TenantId` an `OutboxMessage` carries exists only so delivery can
restore the raising tenant (a row with no tenant stays valid). The per-scope context cache gains a
guard that throws if the scope's tenant changes after a routed context exists, which restates
one-scope-one-tenant where it would otherwise break silently. Cache entries get their isolation one
layer up, in the caching decorators, since a singleton cache cannot observe scoped state; that
belongs with the caching pattern rather than here.

The whole thing is opt-in and inert until a host asks for it: `AddMultiTenancy(configuration)` on top
of `AddInfrastructure`, and nothing else. MMCA.Helpdesk is the reference adopter and configures two
tenants on purpose, one per isolation mode: `acme` shares the pooled database behind the filter,
`globex` gets its own. ADC and Store, both single-tenant products, do not adopt it and pay nothing.
The honest costs are the mirror image of the design: shared-schema means a forgotten `ITenantEntity`
marker fails no build and silently includes that entity's rows in every tenant's queries, and
fail-closed means an identity provider that stops emitting the claim returns 400 on every non-excluded
route rather than degrading to a reduced view.

## Trade-offs, honestly

ADR-006 lists the bill in plain terms, and it is a real bill.

- **No distributed transactions.** When a save spans sources, `DbContextFactory.ExecuteInTransactionAsync`
  opens a transaction **per source** and commits them sequentially, best-effort. There is no
  two-phase commit. If the second commit fails after the first succeeded, you have a partially applied
  change, and the outbox is what eventually reconciles the downstream effects. What the framework does
  buy you is that the partial state is **observable rather than inferred**: the commit loop records the
  partition at the failure point, so the thrown `TransactionCommitAmbiguousException` names each
  source's outcome (`CommittedSources`, `AmbiguousSource`, `RolledBackSources`) and appends that
  per-source verdict to its message, and the operator or the replaying caller can see exactly which
  half of the commit landed. On the single-source host every deployment runs today, that one source is
  the ambiguous outcome and the other two lists are empty. This is the central trade: you give up
  atomicity across sources to get autonomy.
- **Eventual consistency across sources.** Once data is split, consistency between services flows
  through the outbox and broker, not a shared transaction. Reads can observe a window where one
  service is ahead of another. That is correct for the architecture, but it is a behavior your
  product logic has to expect.
- **Referential integrity across services is the application's responsibility.** The compensating
  index survives; the FK enforcement does not. A dangling cross-service reference will not be caught
  by the database. You catch it, or you tolerate it.
- **More to operate.** Each service gets its own migrations project and its own backup and restore
  concern. Four databases is four times the provisioning, migration, and disaster-recovery surface of
  one.

None of these argue against the design. They argue for choosing **when** to split deliberately,
source by source, rather than all at once or never. The collapse property is exactly what lets you
delay the split until a specific source actually needs it.

## Apply this even without MMCA

The mechanism is EF-specific, but the discipline ports to any stack.

1. **Decide an entity's home logically, not physically.** Route by module or bounded context, with a
   default that lands everything in one database until you say otherwise. Then "split a service" is a
   config change, not a code change.
2. **Make the single-database case a true no-op.** If your multi-database machinery changes behavior
   when there is only one database, you will be too afraid to ship it. It must be byte-for-byte
   identical to the simple case until configured.
3. **Never let a foreign key cross a service boundary.** Keep the scalar id and an index for queries,
   drop the constraint, and load the other side explicitly. The constraint you keep across a boundary
   is the constraint that blocks your eventual split.
4. **Make the outbox your cross-source consistency story before you split,** because the day you have
   two databases you no longer have a transaction that spans them.

The rule of thumb: design so that "one database" and "many databases" are the same code on two
configs. If they are two different code paths, you have not built a swap point, you have built two
systems and a migration between them.

---

**What we covered:** why a shared database quietly forecloses extraction (and the literal shared-outbox
race that prompted ADR-006), how one `SQLServerDbContext` class becomes one model per database via
`DataSourceModelCacheKeyFactory`, how `DataSourceResolver` and `EntityDataSourceRegistry` route
entities, the collapse property that makes monolith and distributed the same code,
`CrossDataSourceDegradeConvention` reshaping cross-source relationships, how the same routing extends to
a third axis (a second named query filter for the tenant, and database-per-tenant as a connection-string
override behind the same key), and the one guarantee you give up: no two-phase commit, eventual
consistency across sources, with the outbox as the reconciler.

**Next in the series:** polyglot persistence, the Engine axis that re-points an entity between SQL
Server, PostgreSQL, Cosmos, and SQLite without touching the domain.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-006 behind this
design, or install it and watch the single-database case behave like a plain monolith.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-006 (database per service): `Website/docs-src/adr/006-database-per-service.md` in the docs site.
- `dotnet add package MMCA.Common.API`

*Tags: .NET, C Sharp, Software Architecture, Data Engineering, EF Core*

*Notes: 2026-10-02 evidence refresh (verified against source today, MMCA.Common v1.221.0). This
entry replaces the earlier per-run ledger (2026-06-30, 2026-07-21/26, 2026-08-14, 2026-08-15,
2026-08-19, 2026-09-19 refreshes), whose line anchors had drifted; the current anchors follow. Paths
under `Infrastructure/` mean `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/`.
Fixed this run (three body claims plus the header):
(1) The per-tenant outbox paragraph said there was no `OutboxMessage` schema change and no `TenantId`
column. Wrong: `public string? TenantId { get; init; }` is at
`Infrastructure/Persistence/Outbox/OutboxMessage.cs:93` (doc-comment `:88-92`: restored around
delivery, null for a tenant-less host and for rows written before the column existed), filled from the
raising scope's origin at `:144`, and mapped at `Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:681`.
`Website/docs-src/adr/073-multi-tenancy-model.md:322-329` (Revision 2026-10-01) retracts the same
wording in the ADR. Routing still does not depend on the column: `GetOutboxTargets()` at
`Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:141-142` (rationale `:134-140`) returns
the `(source, tenant)` targets, and `ProcessSourceAsync` opens its scope through
`scopeFactory.CreateTenantScope(target)` at `:181`, which sets the tenant before the context is
obtained (`Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:92-100`). The body now
says the column exists only so delivery can restore the tenant.
(2) The system-context sentence named "the outbox loop, the migration runner, and the seeders". The
`ApplicationDbContext.ApplyTenantFilters` remarks (`ApplicationDbContext.cs:508-510`) name the outbox
processor, the seeders and the retention jobs, so the sentence follows that list (the migration runner
is not named in source; removed). Added the per-row delivery behavior: `DispatchMessagesAsync` remarks
`OutboxProcessor.cs:476-485` (captured user, roles, tenant and correlation id restored onto a FRESH
scope per row), the row scope at `:509` and `AmbientOrigin.Restore(..., message.TenantId, ...)` at
`:514-520` (tenant argument `:518`).
(3) The configuration block used an invented `ConnectionStrings:Default` key. The bound top-level key
is `SQLServerConnectionString`
(`Infrastructure/Persistence/DataSources/ConnectionStringSettings.cs:43`, plus
`SQLServerMigrationsAssembly` `:49`), as Helpdesk configures it
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:46-48`); the per-source entry key
`SQLServerConnectionString` is `Infrastructure/Persistence/DataSources/DataSourceEntrySettings.cs:56`.
(4) Header: `MMCA.Common/CLAUDE.md` is a stub importing `AGENTS.md`; the sections are
`MMCA.Common/AGENTS.md:107` ("Multi-Database Strategy (database per service)") and `:119` ("Outbox and
Internal Commands"). There is no "Outbox Pattern" section.
Re-confirmed, unchanged in substance: one sealed context per engine (`DataSource` enum at
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:6`,
four members; `Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:23`), created without a
switch through `DataSourceEngines.For(key.Engine).CreateDbContext(...)` at
`Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:32` (never-pooled rationale
`:14-16`); `DataSourceModelCacheKeyFactory` (`Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16`,
`Create` `:19`, wired by `ReplaceService` at `ApplicationDbContext.cs:350`); `EntityDataSourceRegistry`
lazy build plus one rescan (`Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:16`),
key derivation `:172-176`, fail-fast conflict `:145`; `DataSourceResolver` default collapse
(`Infrastructure/Persistence/DataSources/DataSourceResolver.cs:320-324`); registrations
`TryAddScoped<IDbContextFactory, DbContextFactory>` and
`TryAddSingleton<IPhysicalDbContextFactory, PhysicalDbContextFactory>` at
`Infrastructure/DependencyInjection.cs:108-109`; `CrossDataSourceDegradeConvention` collapse no-op
remark at `Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:27-28`.
Tenancy anchors (all `ApplicationDbContext.cs` unless named): `SoftDeleteFilterName` `:474`,
`TenantFilterName` `:477`, `TenantIdMaxLength = 64` `:483`, `OnModelCreating` `:416` calling
`ApplyTenantFilters` `:419`, its body from `:514` with `HasQueryFilter(TenantFilterName, filter)` at
`:572`; interceptors added as `AddInterceptors(auditInterceptor, tenantInterceptor,
domainEventInterceptor)` at `:307`; `TryAddSingleton<TenantSaveChangesInterceptor>()` at
`Infrastructure/DependencyInjection.cs:70`. `TenantSaveChangesInterceptor`
(`Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:36`) throws
`CrossTenantWriteException` for an unresolved-tenant insert (`:110`) and on a mismatch (`:123`, `:150`).
`TenantResolutionMiddleware` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:36`)
is inert unless enabled (`:62`), passes through when `RequireTenant` is off (`:75`) and otherwise
answers 400 (`:133`); it is registered right after `UseAuthentication`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:105`,
`:113`); `RequireTenant = true` default at
`Infrastructure/Persistence/Tenancy/TenancySettings.cs:96`. Read narrowing: `SoftDeleteFilterOnly` at
`Infrastructure/Persistence/Repositories/EFReadRepository.cs:41`, passed to `IgnoreQueryFilters` at
eight sites (`:58`, `:87`, `:108`, `:204`, `:394`, `:471`, `:485`, `:582`; grep-confirmed).
DB-per-tenant: `ResolveTenantOverride` at
`Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:168`, called at `:104`;
`GuardRoutedTenantUnchanged` throws at `:201-210`. Transactions: `ExecuteInTransactionAsync` at
`DbContextFactory.cs:544`, `TryCommit` `:712` (called `:620`), `AbandonAfterCommitFailure` invoked
`:736` (declared `:753`); `TransactionCommitAmbiguousException`
(`Infrastructure/Persistence/DbContexts/Factory/TransactionCommitAmbiguousException.cs`) exposes
`CommittedSources` `:76`, `AmbiguousSource` `:85`, `RolledBackSources` `:93`, and appends
`" Per-source outcome: ..."` at `:117`. Registration: `services.AddInfrastructure` at
`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:79`, `services.AddMultiTenancy` at `:92`;
the two demo tenants (`acme` shared, `globex` overriding `Default` to `Helpdesk_Globex`) at
`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:29-45`. ADR-073 adoption and the two
honest costs: `Website/docs-src/adr/073-multi-tenancy-model.md:201-206` and `:246-250`.
Honest gaps: both JSON blocks are representative shapes, not verbatim files (Helpdesk's real
`Tenancy` block also sets `RequireTenant: false`, `ResolutionOrder`, `ClaimType` and `HeaderName`);
cache-key tenant isolation is deliberately left to the caching-pattern article.*


- Full series index: https://ivanball.github.io/writing.html
