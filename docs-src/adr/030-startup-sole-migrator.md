# ADR-030: Each Service Self-Applies Its Migrations at Startup (Sole Migrator)

## Status
Accepted (2026-06-27).

## Context
Under database-per-service (ADR-006), each service owns its own database and its own migrations project,
so *something* must apply pending migrations on every deploy. The framework's
`DatabaseInitializationExtensions` offers three strategies via `ApplicationSettings.DatabaseInitStrategy`,
acting per physical SQL Server source:

- `"Migrate"`: auto-apply pending EF Core migrations (the code documents this as **development/testing**).
- `"EnsureCreated"`: legacy `EnsureCreated` for every source in use.
- `"None"`, the **production** guard: validate that no SQL Server source has unapplied migrations and
  throw a per-source breakdown if any is behind.

The framework's own comments mark `"None"` as the production strategy and `"Migrate"` as dev/test. Both
production apps deliberately diverge from that default, and the divergence was bought with an incident, so
it deserves to be recorded.

## Decision
In Azure Container Apps, **every service host runs `ApplicationSettings__DatabaseInitStrategy = Migrate`
in production and is the sole migrator of its own database**: it applies its pending EF Core migrations
at startup, before the new revision serves traffic. There is deliberately **no** separate deploy-step
migration (no `sqlcmd` / `dotnet ef database update` apply in `deploy.yml`).

- **Set in prod for every service.** `MMCA.Store/infra/main.bicep:786,899,998` (Identity/Catalog/Sales)
  and `MMCA.ADC/infra/main.bicep:1081,1248,1358,1494` (Identity/Conference/Engagement/Notification) all set
  `DatabaseInitStrategy = 'Migrate'`.
- **One applier per revision.** Each service runs `minReplicas: 1`, so the startup `MigrateAsync` is not
  racing sibling replicas of the same revision. (Since the 2026-07-19 outbox lease revision, ADR-003,
  this migration serialization is the only correctness reason left for `minReplicas: 1`; the outbox
  is scale-out safe by construction, so above one replica the setting is a cost/migration choice.)
- **No deploy-step backstop, on purpose.** Both `deploy.yml` files carry an explicit comment that there
  is *no external `sqlcmd` migration backstop* and that each service is the **sole migrator**
  (`MMCA.Store/.github/workflows/deploy.yml:1037-1045`, `MMCA.ADC/.github/workflows/deploy.yml:1079-1087`). The
  `sqlcmd` that *is* installed in the pipeline is a connectivity/readiness probe, not a migration apply.
- **Build-time drift gate, not a runtime apply.** CI runs
  `dotnet ef migrations has-pending-model-changes` (Store `deploy.yml:226`, ADC `deploy.yml:272`) so a
  model that has drifted from its migrations fails the build, but that gate only *detects*; it never
  applies anything. The container does the applying.
- **This overrides the framework's documented "None for production" default**, accepting auto-migrate-on-
  boot in prod as the price of one fewer moving part.
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
  is the compensating control, and the per-service blast radius bounds the damage.
- **A failed startup migration fails the new revision.** ACA keeps traffic on the previous revision
  (readiness gating, ADR-025), but a *half-applied* migration still needs manual recovery: there is no
  automated down-migration.
- **Rolling updates briefly overlap two revisions.** `minReplicas: 1` keeps it to one applier per
  revision, but during a rollout the old and new revisions coexist for a window; a long migration can
  delay the new revision's readiness.
- **Recovery is per database.** Backups/restore are per service (ADR-006 / ADR-009), so rolling back a
  bad migration is a per-database operation, not an app-wide one.

## Related
ADR-006 (database-per-service: why each service owns and migrates its own database),
ADR-025 (readiness gating keeps traffic off a still-migrating replica),
ADR-009 (RTO/RPO + drilled restore is the recovery backstop for a bad migration).

## Revision (2026-08-07)
The sole-migrator decision **extends to seed data**: the same startup owner that applies the schema
also runs the module seeders, in the same call, on the same boot. The Decision above covered
migrations only, so the seeding half of that startup pipeline is recorded here, together with the
trade-off it carries.

1. **Seeding runs after the strategy switch, unconditionally.** `InitializeDatabaseAsync` ends with
   `moduleLoader.SeedAllAsync(...)` placed *outside* the `DatabaseInitStrategy` switch
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:87`,
   switch at `:70-85`). Every enabled module's `IModuleSeeder` therefore runs on every boot, in every
   environment, under all three strategies including the production `"None"` guard: choosing `"None"`
   opts out of applying migrations, not out of seeding. `ModuleLoader.SeedAllAsync` just walks its
   seeder list in module registration order and awaits each one
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:270-276`; the list is
   built only for enabled modules at `:133-136`). Nothing on that path consults the hosting
   environment, and the service hosts call the extension method straight after `builder.Build()`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:295`,
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:344`,
   `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:248`,
   `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:239`;
   `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:207`,
   `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:232`,
   `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:215`), so production re-seeds on
   every revision.
2. **Idempotency is delegated entirely to each seeder.** There is no framework-side ledger for seed
   data: no `__EFMigrationsHistory` equivalent, no marker row, no "already seeded" flag. The loop
   above simply invokes; a seeder that inserts blindly inserts again on the next boot. Each seeder
   owns the guard: `ConferenceModuleDbSeeder` opens each step with an `ExistsAsync` probe and returns
   early when the row is present, matching the pre-rename event name too so a database seeded before
   the rename stays idempotent
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:52-57`).
3. **Deterministic seed identifiers are what make that guard cheap.** The `DbSeeder` base converts an
   integer seed id to the module's identifier type: `int` passes through, and a `Guid` alias is
   manufactured by writing the int into a zeroed 16-byte span, so the same seed integer yields the
   same Guid on every boot, host and machine
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:20-31`).
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
