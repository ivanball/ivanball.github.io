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
`DataSourceModelCacheKeyFactory`, which keys EF's internal model cache by the context type plus the
physical source name (along with the other inputs that shape a model: the settings-gated tables, the
declared strongly typed identifiers, and the design-time flag) rather than by context type alone.
Without the source name, the first model built would silently be reused for every database, which is
a quiet and catastrophic bug.

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
sources. It removes the cross-source FK constraint but **keeps the declared scalar FK column plus a
compensating index**, so the value is still stored and queryable (a shadow FK property has no column
to keep, and on Cosmos, which indexes every property and rejects explicit index definitions, the
index is skipped). It ignores the CLR navigation
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
gets a required 64-character `TenantId` column, on a relational engine an index on it that widens to
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
processor restores that tenant (with the user, roles, permissions, and correlation id) onto a fresh scope for each
row before dispatch, so a handler reads and writes the same tenant's rows the original request did.

Resolution reads the signed claim by default (a host opts into the header by listing it in
`Tenancy:ResolutionOrder`, with the claim first as the recommended order rather than a startup rule),
and it fails closed. `TenantResolutionMiddleware` runs immediately after `UseAuthentication`
(the claim needs `HttpContext.User` already populated), is registered unconditionally, and passes every request straight through until
`Tenancy:Enabled` is on. With `RequireTenant` (true by default) a request that resolves no tenant on
a non-excluded path is answered with a 400 ProblemDetails rather than allowed through unscoped,
because an unscoped request reads across every tenant, which is the exact outcome tenancy exists to
prevent.

Writes sit on an invariant rather than on discipline. A dedicated `TenantSaveChangesInterceptor`,
separate from the audit and domain-event interceptors and registered between them, stamps `TenantId`
on inserts and throws `CrossTenantWriteException` on any added, modified, or deleted entry belonging
to a different tenant. With no tenant resolved it lets an already-tenanted row through as-is (that is
how a background worker drains one tenant's work) and refuses only the insert that has no tenant to
supply. Reads through the repository are narrowed the same way: its `ignoreQueryFilters: true`
drops the named `SoftDelete` filter only, through one shared array used at all eight call sites, so a
soft-delete-inclusive repository read still carries the tenant filter. Outside the repository, reads
sit on discipline where writes sit on an invariant: EF's own parameterless `IgnoreQueryFilters()` on a
raw `Table` surface drops the tenant filter along with soft-delete. The framework source has one such
call site, the feature-flag override store's lookup before an upsert, over an entity that is not an
`ITenantEntity`, and no build gate holds that count where it is.

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
restore the raising tenant (a row with no tenant stays valid). The per-scope context cache carries
two guards that restate one-scope-one-tenant where it would otherwise break silently: one throws if
the scope's tenant changes after a routed context exists, the other throws if a context created
against the shared database before the tenant resolved would be handed to a tenant that overrides
that source. Cache entries get their isolation one
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
  change, and the caller's replay is what reconciles it (the outbox delivers whatever events did
  become durable, and nothing more). What the framework does
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
  index survives on a relational engine; the FK enforcement does not. A dangling cross-service reference will not be caught
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
consistency across sources carried by the outbox, and a partial commit made observable for the
caller's replay to reconcile.

**Next in the series:** polyglot persistence, the Engine axis that re-points an entity between SQL
Server, PostgreSQL, Cosmos, and SQLite without touching the domain.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-006 behind this
design, or install it and watch the single-database case behave like a plain monolith.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-006 (database per service): `Website/docs-src/adr/006-database-per-service.md` in the docs site.
- `dotnet add package MMCA.Common.API`

*Tags: .NET, C Sharp, Software Architecture, Data Engineering, EF Core*

*Notes: 2026-11-25 evidence refresh (re-verified 2026-11-25 against MMCA.Common v1.319.0; findings
`10-database-per-service.json`, verdict Needs-edit). Paths under `Infrastructure/` mean
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/`. Fixed this run (two body claims plus the ledger
anchors): (i) The model-cache sentence named a two-part key. `DataSourceModelCacheKeyFactory.Create`
(`Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:25-31`, class `:22`) keys by
context type, `DataSourceKey.Name`, `ModelGateMask`, `StronglyTypedIdModelKey` and `designTime`. The
source name is still in the key, and a tenant override keeps the original `DataSourceKey`, so the key is
unchanged (`Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:166-172`). The body now
names the source name plus the other model inputs; the argument stands. The `ApplyTenantFilters`
remark at `Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:653-654` still says "(context
type, physical source)" (a source comment, not edited by this run). (ii) The raw-surface sentence said
the framework source has no parameterless `IgnoreQueryFilters()` call site. It has one:
`EFFeatureFlagOverrideStore.SetAsync` (`Infrastructure/Persistence/FeatureFlags/EFFeatureFlagOverrideStore.cs:67-69`,
call `:68`), over `FeatureFlagOverride`, which is `AuditableBaseEntity<string>` and not an
`ITenantEntity` (`MMCA.Common/Source/Core/MMCA.Common.Domain/FeatureFlags/FeatureFlagOverride.cs:24`),
so it crosses no tenant today. Grep of `MMCA.Common/Source` this run: that call plus the two doc
comments (`Infrastructure/Persistence/Repositories/EFReadRepository.cs:38`,
`Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:32`). No architecture test
pins the count (Grep of `MMCA.Common/Tests/Architecture` for `IgnoreQueryFilters`: no match), so "no
build gate" holds. (iii) Every anchor in the list below was re-read this run unless marked otherwise.
Current anchors (re-read 2026-11-25): `MMCA.Common/AGENTS.md` sections "Multi-Database Strategy
(database per service)" `:129` and "Outbox and Internal Commands" `:141`. One sealed context per
engine: `Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:24`, created through
`DataSourceEngines.For(key.Engine).CreateDbContext(...)` at
`Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:32`. Routing:
`EntityDataSourceRegistry` (`Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21`),
`DataSourceResolver` (`Infrastructure/Persistence/DataSources/DataSourceResolver.cs:16`). Degrade
convention: compensating index only on a relational engine
(`Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:66`). `ApplicationDbContext.cs`:
`AddInterceptors(auditInterceptor, tenantInterceptor, domainEventInterceptor)` `:395`;
`ReplaceService<IModelCacheKeyFactory, DataSourceModelCacheKeyFactory>` `:463`; `OnModelCreating` `:530`
calling `ApplySoftDeleteFilters` `:554` and `ApplyTenantFilters` `:555`; `SoftDeleteFilterName` `:623`;
`TenantFilterName` `:626`; `TenantIdMaxLength = 64` `:632`; `ApplyTenantFilters` `:663` (remarks
`:641-659`, null-tenant list naming the outbox processor, the seeders and the retention jobs
`:657-659`, context-typed constant `:670`, owned types excluded `:675`, required column `:680-683`,
relational-only index `:692` widened to (`TenantId`, `IsDeleted`) for an `IAuditableEntity` `:694-701`,
`HasQueryFilter(TenantFilterName, filter)` `:721`). Registrations in `Infrastructure/DependencyInjection.cs`:
`TryAddSingleton<TenantSaveChangesInterceptor>()` `:71`, `TryAddScoped<IDbContextFactory, DbContextFactory>`
`:109`, `TryAddSingleton<IPhysicalDbContextFactory, PhysicalDbContextFactory>` `:110`.
`TenantSaveChangesInterceptor` (`Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:36`)
throws `CrossTenantWriteException` for an unresolved-tenant insert (`:110`) and on a mismatch (`:123`,
`:150`). Read narrowing: `SoftDeleteFilterOnly` at `Infrastructure/Persistence/Repositories/EFReadRepository.cs:41`,
passed to `IgnoreQueryFilters` at eight sites (`:58`, `:87`, `:108`, `:203`, `:393`, `:469`, `:483`,
`:580`). Outbox: `OutboxMessage.TenantId` at `Infrastructure/Persistence/Outbox/OutboxMessage.cs:104`,
filled from the raising origin `:163`; `GetOutboxTargets()` at
`Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:160`, `CreateTenantScope(target)` `:200`,
per-row scope `:561`, `AmbientOrigin.Restore(...)` `:568` (permissions `:572`, tenant `:573`).
`Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs`: `ResolveTenantOverride` `:172`
(called `:105`, same-key rationale `:166-171`); `GuardRoutedTenantUnchanged` `:205` (called `:125`);
`GuardSharedContextNotRoutable` `:230` (called `:129`); `ExecuteInTransactionAsync` `:578`, "the
caller's replay is what reconciles it" `:569`; `TryCommit` `:754` (called `:654`);
`AbandonAfterCommitFailure` invoked `:780`, declared `:797`. Helpdesk: `services.AddInfrastructure` at
`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:78`, `services.AddMultiTenancy` at `:106`;
`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json` `Tenancy` `:32-48` (`RequireTenant:
false` `:34`, `[ "Claim", "Header" ]` `:35`, `acme` `:39`, `globex` overriding `Default` to
`Helpdesk_Globex` `:40-46`), `ConnectionStrings` with the top-level `SQLServerConnectionString` `:49-52`.
Carried from this run's audit, not re-read by the author: `TenantResolutionMiddleware.cs` `:63` (inert
unless enabled), `:76`, `:108`, `:137` (400); `MiddlewarePipelineBuilder.cs` `:104`, `:112`;
`TenancySettings.cs` `:61-62`, `:82-83`, `RequireTenant = true` `:102`;
`TransactionCommitAmbiguousException.cs` `CommittedSources` `:76`, `AmbiguousSource` `:85`,
`RolledBackSources` `:93`, per-source message `:117`; degrade convention scalar-FK and Cosmos rationale
anchors. Named by file only (line anchors moved and were not re-read this run): the
`DataSourceResolver` collapse decision, the `EntityDataSourceRegistry` key derivation and fail-fast
conflict, the `TenancySettingsValidator` rejection of `Host`, the `OutboxProcessor` per-row delivery
remarks, and the ADR-073 section anchors (Resolution, Trade-offs, adoption and honest costs).
Prior fixes, gist only (their line anchors are superseded by the list above). 2026-10-29: the degrade
convention keeps only declared (non-shadow) scalar FK columns and adds the index only on a relational
engine; the per-row restore list gained permissions; claim-first is only the recommended resolution
order, since options validation rejects only `Host`. 2026-10-22 (v1.250.0): the default resolution
order is the claim only, and a host opts into the header. 2026-10-08 (v1.233.0): read narrowing is
scoped to the repository and the raw-surface gap is named, as ADR-073 Trade-offs states it; the
per-scope cache carries two guards, not one; a partial commit is reconciled by the caller's replay, not
by the outbox; the tenant index is relational-only. 2026-10-02 (v1.221.0): `OutboxMessage` carries a
nullable `TenantId` used only to restore the raising tenant, with routing from the `(source, tenant)`
targets; the system-context list follows the source remarks; the configuration key is
`SQLServerConnectionString`; the header cites the two `AGENTS.md` sections. That entry replaced the
earlier per-run ledgers (2026-06-30 through 2026-09-19).
Honest gaps: both JSON blocks are representative shapes, not verbatim files (Helpdesk's real
`Tenancy` block also sets `RequireTenant: false`, `ResolutionOrder`, `ClaimType` and `HeaderName`);
cache-key tenant isolation is deliberately left to the caching-pattern article.*


- Full series index: https://ivanball.github.io/writing.html
