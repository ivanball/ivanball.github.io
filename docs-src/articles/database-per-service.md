# Database-per-service inside a monolith (and why)

> Series: MMCA.Common · Article #10 (cornerstone deep-dive) · Pillar P3 · Group G07 · Rubric §7,§8 ·
> ADR-006, ADR-073, ADR-113 · Status: grounded in `Website/docs-src/adr/006-database-per-service.md`,
> `Website/docs-src/adr/073-multi-tenancy-model.md`,
> `Website/docs-src/adr/113-postgresql-as-a-first-class-engine.md`, `MMCA.Common/CLAUDE.md` (the
> "Multi-Database Strategy" and "Outbox Pattern" sections), and
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
  "ConnectionStrings": { "Default": "Server=...;Database=App;..." }
}

// DATABASE-PER-SERVICE: each module points at its own physical database.
// CrossDataSourceDegradeConvention now degrades any cross-module relationship to a scalar FK,
// and the per-source OutboxProcessor only ever drains its own OutboxMessages table.
{
  "ConnectionStrings": { "Default": "Server=...;Database=App;..." },
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
the system context and sees everything, which is what keeps the outbox loop, the migration runner,
and the seeders working: they have no request, so they have no claim.

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
that keeps its own copy of a source, with **no `OutboxMessage` schema change** at all (no `TenantId`
column, so no forced migration for every consumer on upgrade). The per-scope context cache gains a
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

*Notes: 2026-06-30 evidence-audit fix: corrected "exactly one concrete relational context class" to
"one concrete context class per engine" (`SQLServerDbContext`/`SqliteDbContext`/`CosmosDbContext`,
each a sealed subclass of `ApplicationDbContext`). Verified at
`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:41-47`
(the `Create` switch instantiates one of three concrete contexts by `DataSource` engine) and
`Website/docs-src/adr/006-database-per-service.md:5-6,24-31` (clarified 2026-06-27: one sealed context class per
engine; the forbidden split is per-module, not per-engine). The article's real point is preserved:
no per-module `ConferenceDbContext`/`EngagementDbContext` split, and the four-SQL-database deployment
is still served by the single `SQLServerDbContext` class.
2026-07-21 evidence-audit fix (line anchors re-verified 2026-07-26): corrected
`EntityDataSourceRegistry` from "reflects over the configuration assemblies once, eagerly" to
lazy-on-first-access with a single rescan on a lookup miss. Re-read today at
`Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:16`
("Built lazily on first access and rescanned once on a lookup miss"), the volatile `Snapshot` field
built inside a lock in `GetOrBuildSnapshot()` (lines 31, 84-96), the miss rescan in
`TryGetDataSourceKey`/`RescanIfAssembliesChanged` (lines 63, 98-113), and the fail-fast conflict throw
in `BuildSnapshot` (lines 143-148). The behavior is unchanged; the anchors shifted about seven to nine
lines because `GetPhysicalSourcesInUse()` and its remarks (lines 74-82) were added above them, so the
outbox poll cycle reads a precomputed physical-source list off the snapshot instead of re-projecting
it per call. The load-bearing point holds: one complete pass over every configuration, independent of
any model build, fail-fast when two configs claim one entity for different databases.
Also re-confirmed 2026-07-26: the `Create` switch on `key.Engine` still instantiates exactly one of
three concrete contexts at
`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:41-47`
(never-pooled rationale in its doc-comment, lines 10-14), and
`Website/docs-src/adr/006-database-per-service.md:5-6,24-31` still carries the 2026-06-27
one-sealed-context-class-per-engine clarification.
Verified type/behavior names: `SQLServerDbContext`, `PostgreSQLDbContext`, `SqliteDbContext`,
`CosmosDbContext`, `ApplicationDbContext`, `DataSourceKey`, `DataSource` (engine enum), `DataSourceResolver`,
`EntityDataSourceRegistry`, `DataSourceService`, `DataSourceModelCacheKeyFactory`,
`PhysicalDbContextFactory` (never pooled), `DbContextFactory` (scoped, one per `DataSourceKey`),
`CrossDataSourceDegradeConvention`, `INavigationPopulator`, `OutboxMessages`/`OutboxProcessor`,
`[UseDatabase]`/`[UseDataSource]`, the `Default`-source collapse. Honest gaps: cross-source
transactions are per-source best-effort sequential (no 2PC); consistency across sources is eventual
via the outbox; the JSON config block is representative of the `DataSources` appsettings shape rather
than a verbatim file. The repo URL is marked for final verification before publishing.
2026-08-14 addition, "The third axis: which customer owns the row" (ADR-073, verified against source
today): the tenant filter is a **second named** filter, `TenantFilterName = "Tenant"`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:360`)
beside `SoftDeleteFilterName = "SoftDelete"` (`:357`), applied by `ApplyTenantFilters` (`:394`, called
from `OnModelCreating` at `:307`), which requires the column and caps it at 64 characters (`:411-414`,
`TenantIdMaxLength` at `:366`), indexes it on every non-Cosmos engine (`:419-422`), builds
`e => CurrentTenantId == null || EF.Property<string>(e, "TenantId") == CurrentTenantId` (`:435-439`)
and calls `HasQueryFilter(TenantFilterName, filter)` (`:441`); the doc-comment at `:375-386` states both
the AND composition and the one-cached-model-per-source consequence of embedding the context constant
(`:401`). Resolution: `TenantResolutionMiddleware`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:36`), inert
unless `settings.Enabled` (`:62-66`), claim-then-header resolve (`:68-73`), and fail-closed reject when
`RequireTenant` (`:75-83`); defaults `ClaimType = "tenant_id"` (`Persistence/Tenancy/TenancySettings.cs:83`),
`HeaderName = "X-Tenant-Id"` (`:89`), `RequireTenant = true` (`:96`), and the claim-then-header default order (`:56-57`, applied through
`EffectiveResolutionOrder` at `:76-77` when the bound list is empty).
Writes: `TenantSaveChangesInterceptor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:36`),
throwing `CrossTenantWriteException` for an untenanted insert (`:110`) and for a mismatch on insert or
update/delete (`:123`, `:150`); registered `TryAddSingleton` beside the audit and domain-event
interceptors at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:63`, and wired
BETWEEN the two in `OnConfiguring` (`ApplicationDbContext.cs:239-247`). Read narrowing: one shared
`SoftDeleteFilterOnly` field
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:33`)
passed to `IgnoreQueryFilters` at six call sites (`:52`, `:81`, `:161`, `:238`, `:252`, `:319`, the last
inside `BaseQueryFor` for specification-driven reads).
DB-per-tenant: `DbContextFactory` clones the resolver's `PhysicalDataSource` per override and creates
through the second `IPhysicalDbContextFactory.Create(key, physical)` overload keeping the same
`DataSourceKey`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:22-24`,
`:94-97`, `ResolveTenantOverride` at `:148-161`), assigns a live accessor rather than a copied value
(`:139`), and throws when a routed context's scope changes tenant (`:176-194`). Outbox:
`GetOutboxTargets()` expands `(source, tenant)` pairs
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:199-200`,
rationale `:193-198`) and calls `ITenantContext.SetTenant` inside the per-source scope before the context
is obtained (`:264`, inside `if (target.TenantId is { } tenantId)` at `:262-265`); `OutboxMessage.cs`
carries **no** `TenantId` member (grep: zero matches), so
there is no schema change. Registration surface: `AddMultiTenancy(configuration)` on top of
`AddInfrastructure` at `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:73`, with the two demo
tenants (`acme` shared-schema, `globex` overriding `Default` to `Helpdesk_Globex`) at
`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:29-45`. Adoption and the two honest costs
(a forgotten `ITenantEntity` marker leaks rows silently; fail-closed 400s every non-excluded route when
the claim disappears) come from `Website/docs-src/adr/073-multi-tenancy-model.md:148-154` and `:192-194`,
`:189-191`. The tenant-prefixed cache keys are deliberately out of scope here (covered with the caching
pattern); the JSON block is representative of the `Tenancy` appsettings shape, closest to Helpdesk's.
2026-08-15 addition, per-source commit outcomes (MMCA.Common PR #248, verified against source today):
the "No distributed transactions" bullet is unchanged in substance (still one transaction per source,
still sequential best-effort commits, still no two-phase commit, still the outbox as reconciler) and
gains only the observability sentence. `DbContextFactory.TryCommit`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:623`)
snapshots the enlisted transactional contexts in commit order (`:629-632`), commits them one at a time
in a loop (`:636-652`), and on a throw partitions them at the failure index into already-committed, the
throwing source, and the not-yet-committed remainder (`:646-648`) before `AbandonAfterCommitFailure`
(`:664`) best-effort rolls back that remainder. The failure is still RETURNED rather than thrown so the
execution strategy cannot re-run the operation against a possibly-durable commit (`:552-555`,
`:574-576`), and is rethrown past the strategy at `:542-543`. The four-argument
`TransactionCommitAmbiguousException` constructor
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/TransactionCommitAmbiguousException.cs:57-69`)
exposes `CommittedSources` (`:76`), `AmbiguousSource` (`:85`), and `RolledBackSources` (`:93`), and
`ComposeMessage` (`:99-118`) appends `" Per-source outcome: ..."` to the default ambiguity text (`:117`),
omitting any empty group (`:106-113`). A single-source host, which is every host today, reports that one
source as `AmbiguousSource` with the other two lists empty (`:81-83`, restated in the
`ExecuteInTransactionAsync` remarks at `DbContextFactory.cs:493-501`). No contradiction found: the
summary-level restatements (the "What we covered" paragraph and the honest-gaps line above) remain
accurate as written and were left untouched.
2026-08-19 line-anchor refresh (verified against source today, MMCA.Common HEAD 0b19b56, v1.154.0):
the read-narrowing count in the body and in this ledger corrects from five to **six** call sites.
`SoftDeleteFilterOnly` is now declared at
`EFReadRepository.cs:33` (was `:29`) and passed to `IgnoreQueryFilters` at `:52`, `:81`, `:161`,
`:238`, `:252`, and a sixth site at `:319` inside `BaseQueryFor`, which serves specification-driven
reads and was not covered by the prior five-site count at all. Outbox line anchors also moved:
`GetOutboxTargets()` is now at `OutboxProcessor.cs:199-200` (rationale doc-comment `:193-198`, was
`:181-182`/`:175-180`), and the `ITenantContext.SetTenant` call is now at `:264`, inside
`if (target.TenantId is { } tenantId)` at `:262-265` (was `:244-246`), still before the context is
obtained at `:267-268`. The `PhysicalDbContextFactory` `Create` switch cited earlier in this ledger is
now at `PhysicalDbContextFactory.cs:41-47` (method body `:37-48`, was `:38-44`/`:40-42`); the
never-pooled rationale doc-comment (`:10-14`) is unchanged. All six moves are line-anchor drift only:
behavior, type names, and the framework's shape are unchanged.
2026-09-19 evidence-audit refresh (verified against source today, MMCA.Common 90ffa7a, v1.205.0): a
fourth engine, and eight read-narrowing call sites. `DataSource` declares four members, `CosmosDB`,
`Sqlite`, `SQLServer` and `PostgreSQL`, the last appended rather than inserted alphabetically so the
three shipped ordinals keep their values
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:6-23`),
and the `Create` switch instantiates one of four sealed contexts, `DataSource.PostgreSQL => new
PostgreSQLDbContext(...)` among them
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:44-50`,
was `:41-47` when the switch had three arms), with the class itself at
`.../Persistence/DbContexts/PostgreSQLDbContext.cs:23` (`public sealed class PostgreSQLDbContext`) and
its configuration base class at
`.../Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationPostgreSQL.cs:22`.
`Website/docs-src/adr/113-postgresql-as-a-first-class-engine.md:1-7` accepts the engine (2026-09-09)
and extends ADR-006 and ADR-018, so the header blockquote cites ADR-113 alongside ADR-006 and ADR-073.
The body's context-class list, the configuration-base-class list and the next-article teaser all carry
the fourth engine.
Read narrowing corrects from six to **eight** call sites: `SoftDeleteFilterOnly` is declared at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:40`
(was `:33`) and passed to `IgnoreQueryFilters` at `:57`, `:86`, `:107`, `:203`, `:327`, `:404`, `:418`
and `:501` (grep-confirmed, eight matches). The behavior is unchanged: the array still names the
`SoftDelete` filter only, so the tenant filter survives a soft-delete-inclusive read.
Tenant-filter anchors moved roughly 100 to 150 lines and one behavior sharpened, all in
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs`:
`SoftDeleteFilterName` `:469` (was `:357`), `TenantFilterName` `:472` (was `:360`),
`TenantIdMaxLength = 64` `:478` (was `:366`), `OnModelCreating` `:411` calling `ApplyTenantFilters` at
`:414` (was `:307`), the `ApplyTenantFilters` body `:509-569` (was `:394`), the `EF.Property` predicate
built at `:554-565` (was `:435-439`) and `HasQueryFilter(TenantFilterName, filter)` at `:567` (was
`:441`). Not drift but a refinement the body now states: on every non-Cosmos engine the per-entity
index widens to (`TenantId`, `IsDeleted`) when the entity also implements `IAuditableEntity`, and
stays single-column otherwise (`:538-548`, rationale doc-comment `:531-537`), because the two named
filters compose by AND into `TenantId = @tenant AND IsDeleted = 0`.
Interceptor wiring is unchanged and re-anchored: `TryAddSingleton<TenantSaveChangesInterceptor>()` at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:85` (was `:63`), still added
between the audit and domain-event interceptors in `OnConfiguring`
(`ApplicationDbContext.cs:295-307`, the `AddInterceptors(auditInterceptor, tenantInterceptor,
domainEventInterceptor)` call at `:302`; was `:239-247`).
The outbox processor moved into a `Processing/` subfolder and is now
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs`
(the bare `Outbox/OutboxProcessor.cs` path no longer exists): `GetOutboxTargets()` at `:207` (was
`:199-200`), the `if (target.TenantId is { } tenantId)` guard at `:270` and the
`ITenantContext.SetTenant` call at `:272` (was `:262-265` and `:264`).
`DbContextFactory` anchors
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs`):
`TryCommit` at `:640` (was `:623`), called at `:591`, and `ResolveTenantOverride` at `:162` (was
`:148-161`), called at `:102`; `AbandonAfterCommitFailure` is still invoked at `:664` as the ledger
already recorded.
Path correction rather than a move: `TenancySettings.cs` lives at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettings.cs`, not under
a top-level `Settings/` folder; the defaults it carries are re-verified and unchanged (`ClaimType =
"tenant_id"` `:83`, `HeaderName = "X-Tenant-Id"` `:89`, `RequireTenant = true` `:96`,
`EffectiveResolutionOrder` `:76-77`). Finally,
`services.AddMultiTenancy(builder.Configuration);` is at
`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:92` (was `:73`), still unconditional on top of
`AddInfrastructure`.*


- Full series index: https://ivanball.github.io/writing.html
