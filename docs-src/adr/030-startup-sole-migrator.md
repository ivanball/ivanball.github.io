# ADR-030: Each Service Self-Applies Its Migrations at Startup (Sole Migrator)

## Status
Accepted (2026-06-27). Revised 2026-08-07: the sole migrator also runs the module seeders on every
boot. Revised 2026-10-01: PostgreSQL and tenant copies join the migrationless `EnsureCreated` path.
Revised 2026-10-06: seeding runs on the default scope only, after a tenant-database pass, and the
startup path consults the environment for the build-time OpenAPI skip. Revised 2026-10-07: concurrent
replicas of one service are a supported case (EF's migrations lock plus a five-minute initialization
command timeout), so `minReplicas: 1` is not a single-applier guarantee.

## Context
Under database-per-service (ADR-006), each service owns its own database and its own migrations project,
so *something* must apply pending migrations on every deploy. The framework's
`DatabaseInitializationExtensions` offers two strategies via `ApplicationSettings.DatabaseInitStrategy`,
acting per physical data source:

- `"Migrate"`, the default: auto-apply pending EF Core migrations (the code documents this as
  **development/testing**).
- `"None"`, the **production** guard: validate that no migrated source has unapplied migrations and
  throw a per-source breakdown if any is behind.

Any other value is a configuration mistake and stops startup before a single source is created
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:63`, the
check itself at `:290-297`, its message at `:302-303`). The setting governs migrations only: a source no
migrations pipeline owns (Cosmos, or PostgreSQL or SQLite with no migrations assembly declared) is
created with EF's `EnsureCreated` ahead of the strategy switch, because it has no migration to apply and
nothing else would ever create it (`:76-106`); a tenant's own copy of such a source is created the same
way under either strategy (`"Migrate"` at `:231-239`, `"None"` at `:242-245` through
`ApplyNoneStrategyToTenantAsync`, `:310-324`).

The framework's own comments mark `"None"` as the production strategy and `"Migrate"` as dev/test. Both
production apps deliberately diverge from that recommendation, and the divergence was bought with an
incident, so it deserves to be recorded.

## Decision
In Azure Container Apps, **every service host runs `ApplicationSettings__DatabaseInitStrategy = Migrate`
in production and is the sole migrator of its own database**: it applies its pending EF Core migrations
at startup, before the new revision serves traffic. There is deliberately **no** separate deploy-step
migration (no `sqlcmd` / `dotnet ef database update` apply in `deploy.yml`).

- **Set in prod for every service.** `MMCA.Store/infra/main.bicep:1521,1690,1825` (Identity/Catalog/Sales)
  and `MMCA.ADC/infra/main.bicep:1773,2008,2144,2298` (Identity/Conference/Engagement/Notification) all set
  `DatabaseInitStrategy = 'Migrate'`.
- **Concurrent replicas serialize on EF's migrations lock.** "Sole migrator" means the service is the
  only thing that migrates its database, not that one replica does. Every service runs
  `minReplicas: 1` but scales above it (Store `MMCA.Store/infra/main.bicep:1591,1715,1860`, max 2; ADC
  `MMCA.ADC/infra/main.bicep:1914,2067,2202`, max `conferenceScaledMaxReplicas`, 2 or 4 in conference
  mode, `:192`, and `:2388`, max 2), so several replicas can run startup initialization at once. Each
  calls `MigrateAsync`; every replica but one waits on EF's migrations lock (`__EFMigrationsLock`), and
  migration plus seeding run under a five-minute command timeout so that wait does not trip the
  30-second default
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:33-37`,
  raised at `:108-112`, restored in the `finally` at `:139-145`). In production the container's
  startup probe is the tighter bound: it polls `/alive` with `initialDelaySeconds: 5`,
  `periodSeconds: 5` and `failureThreshold: 30` (about 155 seconds), and the host does not listen
  until initialization finishes, so a replica still waiting on the lock after that window is
  restarted before the five-minute timeout is reached (ADC `MMCA.ADC/infra/main.bicep:1886-1894`;
  Store `MMCA.Store/infra/main.bicep:1585,1709,1854`). Seeding tolerates the overlap only where a
  seeder handles it: ADC's `ConferenceModuleDbSeeder` treats a unique or primary-key violation on
  save as another replica having seeded those rows and detaches every pending entry of the failing
  context, the seed rows and the outbox rows the save captured
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:68`,
  `:574-594`). Store's seeders check then insert and save with a plain `SaveChangesAsync`, with no
  violation handling
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/DbContexts/Seeding/CatalogModuleDbSeeder.cs:55,79,122`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Persistence/DbContexts/Seeding/SalesModuleDbSeeder.cs:118`).
  The `minReplicas: 1` floor is a warm-replica cost choice, not a race guard (ADR-003 makes the
  outbox scale-out safe independently).
- **No deploy-step backstop, on purpose.** Both `deploy.yml` files carry an explicit comment that there
  is *no external `sqlcmd` migration backstop* and that each service is the **sole migrator**
  (`MMCA.Store/.github/workflows/deploy.yml:1308-1316`, `MMCA.ADC/.github/workflows/deploy.yml:1442-1451`).
  Both comments go on to say that with `minReplicas=1` exactly one replica migrates, so there is a
  single applier (Store `:1314-1316`, ADC `:1448-1451`); that sentence is stale against the scale-out
  above and is not evidence for this decision. The
  `sqlcmd` that *is* installed in the pipeline is a `SELECT 1` readiness probe for the CI SQL Server
  container, not a migration apply (Store `deploy.yml:621-637`, probe `:643`; ADC `deploy.yml:663-677`,
  probe `:683`).
- **Build-time drift gate, not a runtime apply.** CI runs
  `dotnet ef migrations has-pending-model-changes` (Store `deploy.yml:425`, ADC `deploy.yml:448`) so a
  model that has drifted from its migrations fails the build, but that gate only *detects*; it never
  applies anything. The container does the applying. The gate sits in `build-and-test`, which runs on
  pull requests only (Store `deploy.yml:261`, ADC `deploy.yml:225`), so a deploy dispatched by hand does
  not re-run it.
- **This overrides the framework's documented "None for production" recommendation**, accepting
  auto-migrate-on-boot in prod as the price of one fewer moving part.
- **It came from a real incident.** A previous `sqlcmd` migration backstop in `deploy.yml` *raced* the
  container's own startup `Migrate()` on a fresh per-service database, creating a table without its
  `__EFMigrationsHistory` row and wedging Store's first per-service deploy. The fix (recorded inline in
  both `deploy.yml`) was to delete the backstop and let the service be the sole migrator.

## Rationale
- **One migrator, one mechanism.** The code that owns the schema applies the schema; there is no second
  tool to keep in lockstep and no ordering race between a deploy step and container boot: exactly the
  failure the incident exposed.
- **Database-per-service keeps each migration small and scoped.** A boot-time apply touches only one
  service's database, so it is fast and its blast radius is one service.
- **Idempotent re-runs.** EF Core's `__EFMigrationsHistory` table means an already-applied migration is
  skipped, so a restart or redeploy that re-enters startup migration is a no-op.

## Trade-offs
- **Auto-migrate-in-production is what `"None"` exists to prevent.** An unintended or destructive
  migration would ship itself on the next deploy. The apps accept this; the build-time model-drift gate
  is the compensating control, together with the expand/contract migration guard, which fails a pull
  request adding a migration that contains `DropColumn`/`DropTable`/`DropIndex` unless it carries an
  `EXPAND-CONTRACT-OVERRIDE` marker (Store `deploy.yml:431-482`, ADC `deploy.yml:234-282`), and the
  per-service blast radius bounds the damage.
- **A failed startup migration fails the new revision.** ACA keeps traffic on the previous revision
  (readiness gating, ADR-025), but a *half-applied* migration still needs manual recovery: there is no
  automated down-migration.
- **Rolling updates briefly overlap two revisions, and replicas wait on each other.** Replicas starting
  together serialize on the migrations lock, so a long migration delays every waiting replica's startup
  (in production the startup probe restarts a replica still waiting after about 155 seconds, well
  inside the five-minute initialization timeout), and during a rollout the old
  and new revisions coexist for a window; a long migration can delay the new revision's readiness.
- **Recovery is per database.** Backups/restore are per service (ADR-006 / ADR-009), so rolling back a
  bad migration is a per-database operation, not an app-wide one.

## Related
ADR-006 (database-per-service: why each service owns and migrates its own database),
ADR-025 (readiness gating; a still-migrating replica is not yet listening at all, because
initialization completes before the host starts, e.g.
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:445` ahead of `app.RunAsync()` at
`:475`),
ADR-003 (the outbox lease that makes scale-out safe on the dispatch side),
ADR-009 (RTO/RPO + drilled restore is the recovery backstop for a bad migration).

## Revision (2026-08-07)
The sole-migrator decision **extends to seed data**: the same startup owner that applies the schema
also runs the module seeders, in the same call, on the same boot. The Decision above covered
migrations only, so the seeding half of that startup pipeline is recorded here, together with the
trade-off it carries.

1. **Seeding runs after the strategy switch, unconditionally.** `InitializeDatabaseAsync` ends with
   `moduleLoader.SeedAllAsync(...)` placed *outside* the `DatabaseInitStrategy` switch
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:111`,
   switch at `:92-102`). Every enabled module's `IModuleSeeder` therefore runs on every boot, in every
   environment, under both strategies including the production `"None"` guard: choosing `"None"`
   opts out of applying migrations, not out of seeding. `ModuleLoader.SeedAllAsync` just walks its
   seeder list in module registration order and awaits each one
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:255-261`; the list is
   built only for enabled modules at `:118-121`). Nothing on that path consults the hosting
   environment, and the service hosts call the extension method straight after `builder.Build()`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:312`,
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:374`,
   `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:310`,
   `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:242`;
   `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:255`,
   `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:264`,
   `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:276`), so production re-seeds on
   every revision.
2. **Idempotency is delegated entirely to each seeder.** There is no framework-side ledger for seed
   data: no `__EFMigrationsHistory` equivalent, no marker row, no "already seeded" flag. The loop
   above simply invokes; a seeder that inserts blindly inserts again on the next boot. Each seeder
   owns the guard: `ConferenceModuleDbSeeder` opens each step with an `ExistsAsync` probe and returns
   early when the row is present, matching the pre-rename event name too so a database seeded before
   the rename stays idempotent
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:66-79`).
3. **Deterministic seed identifiers are what make that guard cheap.** The `DbSeeder` base converts an
   integer seed id to the module's identifier type: `int` passes through, and a `Guid` alias is
   manufactured by writing the int into a zeroed 16-byte span, so the same seed integer yields the
   same Guid on every boot, host and machine
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:20-38`).
   Re-running a seeder against a populated database collides with the existing keys by construction
   instead of minting new ones.
4. **The accepted trade-off is the same bargain as auto-migrate-on-boot.** One owner, one mechanism,
   one fewer moving part, paid for with a correctness obligation on the seeder author rather than on
   the pipeline: a seeder that omits its existence check ships duplicate rows to production on the
   next deploy and no gate here will catch it. Volume-sensitive seed data is held back by
   configuration, not by the framework: ADC's sample browse data sits behind
   `Seeding:IncludeSampleConferenceData`, which production leaves unset, so prod databases receive
   only the real events and questions
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:24-29`).
   ADR-059 records how the loader discovers and orders those seeders; this record owns the policy of
   running them in production on every boot.

## Revision (2026-10-01)
No decision or rationale changed: every service host still sets `DatabaseInitStrategy = 'Migrate'` in
production and remains the sole migrator of its database. The Context now records two framework
facts that had moved under it: PostgreSQL joins Cosmos and SQLite as an engine whose migrationless
source is created with `EnsureCreated` ahead of the strategy switch
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:70-98`), and
a tenant's own copy of such a source is created under either strategy, not only under `"Migrate"`
(`:199-211`, `:249-263`). The Decision notes that the model-drift gate runs on pull requests only, and
the Trade-offs name the expand/contract migration guard as a second build-time control beside it.
Refreshed citations: the strategy check (`:57`, `:229-236`, `:241-242`), both `main.bicep` setting lines,
both `deploy.yml` sole-migrator comments and drift-gate steps. Separately, the startup path the
2026-08-07 revision describes is now reached through `InitializeDatabaseUnlessDesignTimeAsync`, which
skips initialization and seeding only for build-time OpenAPI generation in Development (`:144-160`);
production still migrates and re-seeds on every boot.

## Revision (2026-10-06)
No decision changed; every service still migrates and seeds itself at startup. Corrections to the
2026-08-07 revision, whose text stays as recorded:

- **Seeding is default-scope only, after a tenant pass.** `InitializeDatabaseAsync` now runs a
  tenant-database pass after the strategy switch and before seeding, and `SeedAllAsync` runs on the
  default scope only, never per tenant
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:117-124`,
  switch at `:105-115`). It still sits outside the switch, so `"None"` still seeds.
- **The environment is consulted once, at the host entry point.** The hosts now call
  `app.InitializeDatabaseUnlessDesignTimeAsync(moduleHost)` (`:146-162`), which checks
  `IsDevelopment()` together with the OpenAPI design-time switch (`:153`); outside that build-time
  run the path is environment-independent, so production still re-seeds every revision. The call
  follows `builder.Build()` after a few lines rather than immediately (ADC Identity
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:353`, Conference `:443`,
  Engagement `:321`, Notification `:266`; Store Identity
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:296`, Catalog `:317`, Sales `:296`).
- **Seeder probes now key on a stable identity first.** `ConferenceModuleDbSeeder` checks the
  Sessionize code or a fixed key before the (pre-rename) name, with `ignoreQueryFilters: true` so a
  soft-deleted seed row counts as present
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:80-97`).
  Not every step opens with `ExistsAsync`: the sample-data `SeedSampleEventLinksAsync` (`:319`) does not.
- `ModuleLoader.SeedAllAsync` is now at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:266-272`; a disabled module
  skips at `:123`, before its seeder is added (`:129-132`).
- Anchors in Context, Decision and Trade-offs were re-verified against current source and refreshed
  (strategy check, migrationless and tenant paths, both `main.bicep` setting lines, both `deploy.yml`
  sole-migrator comments, drift-gate and expand/contract steps).

## Revision (2026-10-07)
Re-verified against current source. Unchanged: every service host still sets
`DatabaseInitStrategy = 'Migrate'` in production, is the only thing that migrates and seeds its own
database, and has no deploy-step migration backstop. What moved is the single-applier premise: the
v1.233.0 framework release designs startup initialization for several replicas of one service
starting together. That premise never held for Store, whose three services have scaled to 2
replicas since before this ADR was accepted; ADC's services also scale above one replica.

1. **Concurrent replicas are a supported case.** Migration and seeding now run inside a try/finally
   that raises each relational source's command timeout to `InitializationCommandTimeout` (five
   minutes) and restores it afterwards, so a replica waiting on EF's migrations lock
   (`__EFMigrationsLock`) behind another replica's migration does not fail at the 30-second default
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:33-37`,
   `:108-145`, `RaiseCommandTimeouts` at `:257-281`). In production the container startup probe
   (`/alive`, about 155 seconds: ADC `MMCA.ADC/infra/main.bicep:1886-1894`, Store
   `MMCA.Store/infra/main.bicep:1585,1709,1854`) restarts a replica that is still waiting before
   that timeout is reached, so only waits under that window are survived. The Decision's "One
   applier per revision" bullet is replaced accordingly, and the Trade-offs bullet on rolling updates now names the wait.
2. **`minReplicas: 1` is a floor, not a ceiling.** Store's three services scale to 2
   (`MMCA.Store/infra/main.bicep:1591,1715,1860`); ADC's Identity, Conference and Engagement scale to
   `conferenceScaledMaxReplicas` (2, or 4 in conference mode) and Notification to 2
   (`MMCA.ADC/infra/main.bicep:192`, `:1914,2067,2202`, `:2388`). Store's scale-out predates this
   ADR (Store commit `a472db8e`, 2026-04-12), so the earlier claim that migration serialization is
   the only correctness reason left for `minReplicas: 1` did not hold when written; the floor is a
   cost choice (`MMCA.ADC/AGENTS.md:64` states the same).
3. **ADC's Conference seeder tolerates a concurrent seed.** `ConferenceModuleDbSeeder` saves each
   step through `SaveToleratingConcurrentSeedAsync`, which treats a SQL Server unique or primary-key
   violation as another replica having seeded the same rows and detaches every Added, Modified or
   Deleted entry of the failing context, including the outbox rows the save captured
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:68`,
   `:574-594`). Its first probe is now in `SeedCloudAiConferenceEventAsync` (`:91`, `ExistsAsync` with
   `ignoreQueryFilters: true` at `:105-109`); `SeedSampleEventLinksAsync` (`:334-358`) still has no
   `ExistsAsync` and relies on the link-add calls rejecting an existing link. Store's seeders have
   no such handling (`CatalogModuleDbSeeder.cs:55,79,122`, `SalesModuleDbSeeder.cs:118`).
4. **Related now names how traffic is kept off a migrating replica.** Initialization completes
   before the host starts listening (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:445`
   ahead of `app.RunAsync()` at `:475`), so the replica is not reachable at all until it finishes;
   ADR-025's readiness gate is not what holds it back. ADR-003 joins Related for the outbox side of
   scale-out safety.
5. Anchors re-verified against current source: the strategy check (`DatabaseInitializationExtensions.cs:63`,
   `:290-297`, message `:302-303`); migrationless and tenant paths (`:76-106`, `:231-239`, `:242-245`,
   `:310-324`); the strategy switch `:118-128`, tenant pass `:130-131` and default-scope `SeedAllAsync`
   `:137`; `InitializeDatabaseUnlessDesignTimeAsync` at `:167-183` with its design-time check at `:174`;
   both `main.bicep` setting lines (`MMCA.ADC/infra/main.bicep:1773,2008,2144,2298`; Store unchanged at
   `:1521,1690,1825`); both `deploy.yml` sole-migrator comments (Store `:1308-1316`, ADC `:1442-1451`,
   whose closing `minReplicas=1` single-applier sentence is stale),
   the `sqlcmd` readiness probe (Store `:621-643`, ADC `:663-683`), the drift-gate commands (Store
   `:425`, ADC `:448`), the `build-and-test` pull-request condition (Store `:261`, ADC `:225`) and the
   expand/contract steps (Store `:431-482`, ADC `:234-282`); the host call sites, now ADC Conference
   `:445` and Engagement `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:322`, the
   others unchanged.
