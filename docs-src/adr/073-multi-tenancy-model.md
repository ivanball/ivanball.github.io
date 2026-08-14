# ADR-073: Multi-Tenancy (Shared-Schema Query Filter plus DB-per-Tenant Routing)

## Status
Accepted (2026-08-13). The implementation lands in the MMCA.Common enterprise capability wave release,
alongside the scheduler, audit trail, DSAR export, and CSV export work. It is opt-in:
`AddMultiTenancy(configuration)` binds the settings section, and with no host calling it the mechanism is
inert (`Tenancy:Enabled` false, no tenant resolved), so the framework release is non-breaking.

## Context
MMCA.Common already partitions data along two axes and neither of them is a tenant. ADR-006 partitions by
**source name** (every entity resolves to a `DataSourceKey(Engine, Name)`, each module or service owning
its own database) and ADR-018 partitions by **engine**. A third axis, "which customer does this row belong
to", had no recorded answer, which meant every consumer that ever needed one would invent it: a `TenantId`
column here, a `Where` clause in each handler there, and one forgotten handler is a customer data leak.

The framework does have the machinery this needs, built for a different reason. `ApplySoftDeleteFilters`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:243`,
called from `OnModelCreating` at `:220`) proves that a global predicate applied by expression tree to every
matching entity type makes an invariant unforgettable, and EF10's **named** query filters
(`modelBuilder.Entity(clrType).HasQueryFilter("SoftDelete", filter)`, `:255`) mean a second filter can be
added beside the first rather than replacing it. The interceptor pipeline resolved in `OnConfiguring`
(`:183-185`) proves that a write-side rule can be enforced once for every context.

That left a specific set of open questions: whether a tenant is a row discriminator or a database, what
happens when no tenant is resolved, where the tenant comes from on an inbound request, whether the outbox
and the migration runner (which have no request and therefore no claims) can reach tenant data at all, and
whether one cached EF model serves many tenants or each tenant compiles its own.

## Decision
**Ship shared-schema tenancy as a second named query filter, with per-tenant database routing as a
configuration override on the same source key, both opt-in and both inert until a host asks for them.**

### The tenant filter is a second named filter, composed with soft-delete
`ApplicationDbContext` gains `ApplyTenantFilters`, applied beside `ApplySoftDeleteFilters` in
`OnModelCreating`. Named filters compose with AND automatically, so an entity that is both
`IAuditableEntity` and `ITenantEntity` carries both predicates and neither knows about the other. The
tenant predicate is `e => CurrentTenantId == null || e.TenantId == CurrentTenantId`, built as an
expression tree that embeds `Expression.Constant(this)`: EF rewrites a context-typed constant inside a
filter to the executing context instance at query-compile time, so **one cached model per source serves
every tenant** and the tenant value arrives as a SQL parameter rather than as a literal baked into a
per-tenant model. A dedicated two-tenants-one-cached-model Sqlite test locks that in, because it is a
property of EF's filter rewriting rather than of code this repo owns.

A null tenant is the system context and sees everything: background services, the migration runner, and
admin flows run without a resolved tenant by construction. `CosmosDbContext.OnModelCreating` calls
`ApplyTenantFilters` too, because it builds its filters independently rather than inheriting them.

### `ITenantEntity` carries a plain `string`
`ITenantEntity` (Domain, `Source/Core/MMCA.Common.Domain/Interfaces/ITenantEntity.cs`) declares
`string TenantId { get; }`: max 64 characters, no public setter. The interceptor stamps it through
`entry.Property(...).CurrentValue`, so an entity cannot set its own tenant and a handler cannot move a row
between tenants by assignment. The type is `string` deliberately, and this is where the record departs
from ADR-048: a tenant identifier arrives from a JWT claim, an HTTP header, or a configuration key, all
three of which are text, so a `TenantIdentifierType` alias would add a conversion at every one of those
boundaries and buy nothing. A tenant is never a key this system generates the way an entity identifier is.

### `ITenantContext` mirrors `ICorrelationContext`, one scope means one tenant
`ITenantContext` (Application) exposes `TenantId`, `IsResolved`, and `SetTenant`, mirroring
`ICorrelationContext` in shape and lifetime. The scoped `TenantContext` implementation makes `SetTenant`
idempotent for the same value and **throws on a different value**: a scope that has already answered
queries for tenant A must not start answering them for tenant B, so the invariant is enforced, not advised.

### Resolution is claim, then header, and fails closed
`TenancySettings` binds section `Tenancy` through the ADR-070 chain: `Enabled` (false), `ResolutionOrder`
(`[Claim, Header]`), `ClaimType` (`tenant_id`), `HeaderName` (`X-Tenant-Id`), `RequireTenant` (**true**),
`ExcludedPathPrefixes` (health, alive, `.well-known`), and a `Tenants:{id}:DataSources:{sourceName}` map of
per-tenant connection strings. Host-based resolution (tenant from subdomain) is deferred: it needs a
hostname-to-tenant map and certificate handling that no consumer needs today.

`TenantResolutionMiddleware` (`Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs`)
mirrors `CorrelationIdMiddleware`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:48`) and is wired
into `UseCommonMiddlewarePipeline` (`:45`) immediately **after** `app.UseAuthentication()` (`:96`),
because a claim-first resolution order requires that `HttpContext.User` already be populated. Like
`SoftDeletedUserMiddleware` (`:102`) it is registered unconditionally and inert by default, keeping the
pipeline one shape across every host. When `RequireTenant` is true and nothing resolves on a non-excluded
path, it returns 400 with a ProblemDetails body.

### Writes are guarded by their own interceptor
`TenantSaveChangesInterceptor` is a **separate** interceptor from the audit one (one concern per
interceptor, matching how audit stamping and domain-event capture are already split at `:183-185`). It
stamps `TenantId` on Added entries and throws `CrossTenantWriteException` on any Added, Modified, or
Deleted entry whose tenant differs from the resolved one. It is always registered and is a no-op when no
tenant is resolved. `DesignTimeDbContextHelper` must register it too, or `dotnet ef` breaks for every
consumer the moment it is resolved as a required service.

### The tenant is read live, not copied at context creation
`ApplicationDbContext` gains `internal Func<string?>? TenantIdAccessor` and
`CurrentTenantId => TenantIdAccessor?.Invoke()`. The scoped context factory assigns
`() => tenantContext?.TenantId` when it creates a context, and the value is read at query-compile time
rather than captured at construction. Copying at creation would make correctness depend on the middleware
having run before the first context in the scope existed, a hazard no test catches and a reordered
pipeline reintroduces silently.

### DB-per-tenant is a connection-string override behind the same key
When `TenancySettings.Tenants[tenant].DataSources[key.Name]` has an entry, the scoped `DbContextFactory`
clones the resolver's `PhysicalDataSource`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:17`)
with the override connection string and the **same `DataSourceKey`**, so EF's model cache key is unchanged
and one model still serves every tenant. Creation goes through a new
`IPhysicalDbContextFactory.Create(key, physical)` overload beside today's single member
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IPhysicalDbContextFactory.cs:21`).
That overload is deliberately **not** a default interface member: it is additive-breaking for any consumer
with a custom implementation, and hiding that behind a default body would turn a compile error into a
runtime routing surprise, so it goes in the CHANGELOG as breaking-for-implementors. The tenant is not part
of the per-scope context cache key; instead a guard throws if the scope's tenant changes after an
overridden context exists, restating the one-scope-one-tenant invariant where it would otherwise break.

### `ignoreQueryFilters` stops meaning "ignore everything"
The four parameterless `IgnoreQueryFilters()` call sites in `EFReadRepository`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:40`,
`:145`, `:209`, `:223`) become `IgnoreQueryFilters(["SoftDelete"])`. The repository's
`ignoreQueryFilters: true` parameter has always meant "include soft-deleted rows", and naming the filter
keeps that meaning exactly while making it impossible for a soft-delete-inclusive read to cross tenants.

### Background work drains and migrates per tenant
`OutboxProcessor` and `OutboxCleanupService` enumerate `(source, tenant?)` pairs from `TenancySettings`
and call `ITenantContext.SetTenant` inside the per-source scope before obtaining the context, so the
factory routes to the tenant's database and the claim-lease update
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:404-406`) runs
against the right rows. There is deliberately **no `OutboxMessage` schema change**: a `TenantId` column
would force a migration on every consumer on upgrade, for a discriminator the per-tenant database already
provides and shared-schema tenancy does not need (the row sits in its aggregate's database either way).

`InitializeDatabaseAsync` gains a per-tenant pass: a fresh scope per tenant, `SetTenant`, then the same
`DatabaseInitStrategy` semantics and migrations assembly per overridden source. Module seeding stays
default-scope-only in v1, documented as such rather than half-implemented.

### Cache isolation lives in the decorators
`ICacheService` is a singleton and cannot observe scoped state, so tenant awareness goes one layer up:
`CachingQueryDecorator` and `CachingCommandDecorator` take `ITenantContext` and prefix the cache key, the
invalidation prefix, and the stripe lock with `t:{tenantId}:` when a tenant is resolved. Doing it in both
decorators is what makes read isolation and invalidation isolation symmetric; doing it in one would let
tenant A's write evict tenant B's entry or fail to evict its own. Direct `ICacheService` consumers (login
counters, OAuth state, idempotency records) are keyed by subject already and are unchanged.
`AddMultiTenancy(configuration)` additionally validates on start that every override names a source that
exists, so a typo fails the host rather than silently routing a tenant to the default database.

### Adoption: Helpdesk demonstrates it, ADC and Store do not adopt it
MMCA.ADC and MMCA.Store are single-tenant production applications, so adding a tenant filter and a
`TenantId` column to their aggregates is scope creep with real deploy risk (two production deployments,
migrations on every source) for a capability neither product sells. MMCA.Helpdesk is the reference demo:
its Tickets entities implement `ITenantEntity`, it is configured with two tenants, and one of them gets a
per-tenant database override, so the runnable seed exercises both halves of this record.

## Rationale
- **A query filter is the only place the rule cannot be forgotten.** Per-handler `Where` clauses are
  correct until the tenth handler, and the tenth handler is a data leak rather than a bug report. The
  soft-delete filter has proven the mechanism across three applications.
- **Named filters are why this is additive at all.** Before EF10, a second global filter would have
  replaced the soft-delete one, forcing both predicates into one hand-composed expression. Naming them
  keeps `IgnoreQueryFilters(["SoftDelete"])` expressible, so the repository's contract survives unchanged.
- **Embedding the context constant is what keeps one model.** Closing over the tenant string at model-build
  time, the obvious implementation, produces a distinct compiled model per tenant and turns the model cache
  into a memory leak proportional to tenant count, buying nothing a SQL parameter does not.
- **Null-tenant-sees-all keeps background work simple.** The alternative, a system context that enumerates
  tenants to see everything, pushes tenancy into the outbox loop, the cleanup service, and the migration
  runner as a control-flow concern rather than as a routing detail.
- **Fail-closed is the only defensible default for isolation.** `RequireTenant` defaults to true because
  the failure mode of the other default is serving one customer's data to another, silently, with a 200.
  A 400 is loud, immediate, and visible in the first smoke test.
- **Same `DataSourceKey`, different connection string, is the smallest possible DB-per-tenant.** An
  override changes where a source points, not what a source is, so the entity registry, the model cache,
  the migrations assembly, and the per-source outbox all keep working unchanged.
- **A live accessor removes an ordering hazard rather than documenting it,** and no outbox column keeps
  the upgrade free: every consumer would otherwise pay a migration on every source for a discriminator a
  per-tenant database already carries.
- **The decorator is where the cache knows about scope.** Pushing tenancy into `ICacheService` would mean
  a singleton reaching for scoped state, which is exactly the shape that produces cross-request bleed.

## Trade-offs
- **Reads are on discipline where writes are on an invariant.** A consumer calling EF's own parameterless
  `IgnoreQueryFilters()` on a raw `Table` surface drops the tenant filter along with soft-delete. Writes
  remain guarded by `TenantSaveChangesInterceptor` and the adoption sweep includes a grep for the
  parameterless form, but nothing prevents a future call site. ADR-055's
  `ApplicationLayer_DoesNotUseRawQueryableSurfaces` is partial cover only: it does not reach Infrastructure.
- **The EF-style singleton adapter factories are tenant-unaware by design.**
  `DefaultSqlServerDbContextFactory` and its siblings exist for tooling and adapter scenarios that have no
  scope and therefore no tenant. A context obtained through them sees every tenant's rows.
- **Fail-closed means a misconfigured claim takes the whole surface down.** A deployment whose identity
  provider stops emitting `tenant_id` returns 400 on every non-excluded route rather than degrading to a
  reduced view. That is the intended trade, and it is still an outage.
- **Shared-schema turns one bad filter into a data leak rather than an error,** and a missing
  `ITenantEntity` marker on a new entity fails no build and no test: it silently includes that entity's
  rows in every tenant's queries.
- **The system context is a privileged mode with no second gate.** Any code path that runs without a
  resolved tenant reads across all tenants, and nothing distinguishes "deliberately system" from
  "middleware did not run here".
- **DB-per-tenant multiplies operational surface.** Each override adds a migration pass at startup and its
  own connection pool, so both scale with tenant count, and the per-tenant connection strings live in
  configuration, making the tenant roster a deployment artifact rather than data.
- **Cache isolation stops at the decorator.** Code resolving `ICacheService` directly gets no tenant
  prefix. Today's direct consumers are subject-scoped (login counters, OAuth state, idempotency records)
  so they are safe by accident of their key shape, not by a rule that would catch the next one.
- **Module seeding is default-scope-only in v1.** A per-tenant database gets migrations but not seed data.

## Related
[ADR-006](006-database-per-service.md) (the source-name axis this composes with: an override re-points a
`DataSourceKey` without changing it, and the per-source outbox this record drains once per tenant),
[ADR-005](005-soft-delete-vs-erasure.md) (the filter this one sits beside and composes with by name, and
whose `IgnoreQueryFilters` contract narrows to `["SoftDelete"]`),
[ADR-018](018-polyglot-persistence.md) (the engine axis; `CosmosDbContext` applies the tenant filters
independently because it builds its own), [ADR-026](026-caching-strategy.md) and
[ADR-014](014-cqrs-decorator-pipeline.md) (the caching decorators that gain the `t:{tenantId}:` prefix on
key, invalidation prefix, and stripe lock), [ADR-048](048-primitive-identifier-type-aliases.md) (why
`TenantId` is a plain `string` and not an identifier alias),
[ADR-055](055-repository-and-specification-contract.md) (the raw-queryable rule that partially covers the
read-side bypass), [ADR-030](030-startup-sole-migrator.md) (who applies migrations, now once per tenant per
overridden source), [ADR-070](070-fail-fast-configuration-contract.md) (the validating settings chain
`TenancySettings` binds through, extended with a check that every override names a known source).
