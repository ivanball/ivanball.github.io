# ADR-006: Database per Service

## Status
Accepted (2026-06-07). Supersedes the earlier "deliberately one shared database" stance.
Clarified 2026-06-27: the single context class became **one sealed context class per engine** when
ADR-018 added the orthogonal engine axis (the `Name`/database axis here is unchanged).
Updated 2026-09-03: the legacy `AtlDevCon` archive database no longer exists (dropped 2026-09-02);
rollback now restores from a bacpac blob.
Revised 2026-09-09: PostgreSQL is a fourth engine
([ADR-113](113-postgresql-as-a-first-class-engine.md)), so the per-engine context set is
SQL Server / Cosmos / SQLite / PostgreSQL; the one-instance-per-database rule below is unchanged.
Revised 2026-10-06: the `AtlDevCon` bacpac was deleted on 2026-10-03, so no pre-cutover rollback
copy exists; the four live `ADC_*` databases rely on their own PITR plus LTR.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.
Revised 2026-10-21: the Decision bullet now names `PostgreSQLDbContext` among the per-engine
contexts, attributes once-per-key caching to the scoped `DbContextFactory` (not
`PhysicalDbContextFactory`), and scopes the no-per-module-context rule to concrete runtime contexts
(abstract per-module `ModuleApplicationDbContext` DbSet holders exist);
`infra/main.bicep` anchors refreshed.
Revised 2026-10-26: per-module `ModuleApplicationDbContext` declarations are scoped to modules that
own their own aggregates (ADC Notification declares none); `infra/main.bicep` anchors refreshed.

## Context
When the modules were first extracted into independently-deployable services, all services in an
app still pointed at a **single shared SQL database** with a single `OutboxMessages` table. That
left one significant defect: every service's `OutboxProcessor` polled the same outbox table with no
origin filter, so the services **raced** to claim each other's rows (ADR-003 / ArchitecturalAnalysis
§4.4 #5). It also undermined the data-autonomy half of "microservices": services that share a
database are not independently evolvable at the schema level.

MMCA.Common already provided the machinery for multiple physical data sources (`DataSourceResolver`,
`EntityDataSourceRegistry`, `DbContextFactory`, `CrossDataSourceDegradeConvention`), so the move was
a configuration/deployment change, not a framework rewrite.

## Decision
Adopt **database-per-service**: each service owns its own physical database with its own
`OutboxMessages` table.

- **One sealed concrete context class *per engine*, one instance per database.** We do **not**
  introduce a per-module concrete (runtime) DbContext class. Each module may declare an abstract
  `ModuleApplicationDbContext` that only lists its `DbSet`s (for example
  `MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:14`),
  but nothing subclasses it at runtime (rule stated at `MMCA.Helpdesk/AGENTS.md:74`). Only modules
  that own their own aggregates declare one. ADC Notification still owns the `ADC_Notification`
  database, but its `PushNotification` and `UserNotification` entities live in MMCA.Common
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:269-270`), so its module
  projects are API, Application and Shared only, with no Infrastructure project and no
  `ModuleApplicationDbContext`. The default engine is SQL Server (`SQLServerDbContext`); ADR-018
  later added `SqliteDbContext` and `CosmosDbContext`, and ADR-113 added `PostgreSQLDbContext`, each
  a sealed subclass of the abstract `ApplicationDbContext`. The singleton `PhysicalDbContextFactory`
  creates a new raw context on every `Create(DataSourceKey)` call; the scoped `DbContextFactory`
  caches one instance per `DataSourceKey(Engine, Name)` for the scope; entities
  route to a physical source by logical name (`[UseDatabase]` / module namespace) via
  `DataSourceResolver`, and to an engine by configuration base class (`[UseDataSource]`, ADR-018).
  The forbidden split is *per-module*, not per-engine.
- **ADC** runs `ADC_Identity`, `ADC_Conference`, `ADC_Engagement`, `ADC_Notification`: locally on
  the shared Aspire SQL container and in Azure as four Basic-tier databases. Those four are the
  entire application data estate: the legacy `AtlDevCon` database was exported to the bacpac blob
  `sql-archive/AtlDevCon-20260902.bacpac` and dropped on 2026-09-02, and `infra/main.bicep` no
  longer declares it. That bacpac was itself deleted permanently on 2026-10-03 (blob soft delete and
  versioning were off), so there is no restore path to the pre-cutover `AtlDevCon` data; its contents
  had already been copied into the per-service databases at cutover, and those four databases keep
  their own PITR plus LTR (`MMCA.ADC/infra/main.bicep:1114`, `MMCA.ADC/infra/main.bicep:1166`,
  `MMCA.ADC/infra/POST-CUTOVER-atldevcon-downgrade.md:103`, `MMCA.ADC/infra/DISASTER-RECOVERY.md:27`).
- **Per-source outbox.** Each database has its own `OutboxMessages`; the `OutboxProcessor` drains
  only the sources its host owns, so no service ever sees another's rows.
- **Cross-service references are scalar IDs, not FKs.** `CrossDataSourceDegradeConvention` removes
  FK constraints/navigations that would span databases; runtime joins flow through
  `INavigationPopulator` (ADR-002), and cross-service consistency flows through the outbox + broker.
- A host with no `DataSources` configuration still collapses onto one `Default` source, so the
  single-database monolith deployment continues to work unchanged.

## Rationale
- **Removes the shared-outbox race** (the sharpest cost of the shared DB) without an `OriginService`
  filter: physical isolation is simpler and stronger than a logical filter.
- **Real data autonomy**: each service can evolve and scale its schema independently; lifts the
  former single-database scaling ceiling.
- **Reuses existing framework extension points**: no new DbContext classes, no business-logic rewrite.

## Trade-offs
- **No cross-database FKs or transactions.** Relationships that span services degrade to scalar IDs;
  consistency across services is eventual (outbox + broker), not transactional.
- **More databases to provision, migrate, and back up.** Each service has its own migrations project
  and its own backup/restore concern.
- **Referential integrity across services is the application's responsibility** (compensating
  indexes survive, FK enforcement does not).

## Revision (2026-10-06)
- The ADC Decision bullet no longer names the `AtlDevCon` bacpac as the rollback source of record:
  the blob was deleted permanently on 2026-10-03, so no pre-cutover restore path exists, and the live
  `ADC_*` databases rely on PITR plus LTR (bacpac deletion at `MMCA.ADC/infra/main.bicep:921`,
  LTR policy at `MMCA.ADC/infra/main.bicep:966`, `MMCA.ADC/infra/POST-CUTOVER-atldevcon-downgrade.md:103`). The 2026-09-03 Status note is kept as
  recorded on that date.
- Anchors re-verified against current source.

## Revision (2026-10-07)
Re-verified against current source. The decision is unchanged: four per-service `ADC_*` databases,
no `AtlDevCon` database or bacpac, and PITR plus LTR as the only restore path. Only the
`infra/main.bicep` anchors moved; the 2026-10-06 revision above keeps the anchors it recorded.

1. Anchors re-verified against current source: the `AtlDevCon` archived-and-dropped note with the
   2026-10-03 bacpac deletion at `MMCA.ADC/infra/main.bicep:937` (was `:921`), the
   `serviceDatabaseLtr` policy (weekly `P4W`, monthly `P12M`, yearly `P1Y`) at
   `MMCA.ADC/infra/main.bicep:982` (was `:966`); `MMCA.ADC/infra/POST-CUTOVER-atldevcon-downgrade.md:103`
   and `MMCA.ADC/infra/DISASTER-RECOVERY.md:27` are unchanged.

## Revision (2026-10-21)
Re-verified against current source. The decision is unchanged: one sealed context class per engine,
one instance per database, four per-service `ADC_*` databases with PITR plus LTR as the only restore
path. The Decision bullet now names all four engine contexts and assigns the per-key cache to the
right factory; the `infra/main.bicep` anchors moved again. The 2026-10-06 and 2026-10-07 revisions
above keep the anchors they recorded.

1. The per-engine context set in the Decision bullet now includes `PostgreSQLDbContext`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:23`,
   ADR-113) alongside `SQLServerDbContext.cs:15`, `SqliteDbContext.cs:12` and `CosmosDbContext.cs:15`,
   all sealed over the abstract `ApplicationDbContext.cs:46`.
2. Once-per-key materialization belongs to the scoped `DbContextFactory`: its
   `Dictionary<DataSourceKey, ApplicationDbContext>` at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:74`
   is checked at `DbContextFactory.cs:103` before calling the singleton `PhysicalDbContextFactory`
   (`PhysicalDbContextFactory.cs:19`), whose `Create` at `PhysicalDbContextFactory.cs:25-33` builds a
   new context on every call.
3. The no-per-module-context rule now says no per-module *concrete* context class: every consumer
   module declares an abstract `ModuleApplicationDbContext` that only lists its `DbSet`s (for example
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:22`,
   `MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:14`),
   and none is subclassed at runtime. The rule points at `MMCA.Helpdesk/AGENTS.md:74`, which states it
   in that form, instead of a convention name that has no source of its own.
4. Anchors re-verified against current source: the `AtlDevCon` archived-and-dropped note with the
   2026-10-03 bacpac deletion at `MMCA.ADC/infra/main.bicep:1080` (deletion sentence at `:1085`;
   was `:937`), the `serviceDatabaseLtr` policy at `MMCA.ADC/infra/main.bicep:1132` (weekly `P4W`,
   monthly `P12M`, yearly `P1Y` at `:1137-1139`; was `:982`);
   `MMCA.ADC/infra/POST-CUTOVER-atldevcon-downgrade.md:103` and `MMCA.ADC/infra/DISASTER-RECOVERY.md:27`
   are unchanged.

## Revision (2026-10-26)
Re-verified against current source. The decision is unchanged: one sealed context class per engine,
one instance per database, four per-service `ADC_*` databases with PITR plus LTR as the only restore
path. The Decision bullet now scopes per-module `ModuleApplicationDbContext` declarations to modules
that own their own aggregates, and its `infra/main.bicep` anchors moved. The 2026-10-21 revision above keeps
the wording and anchors it recorded (its "every consumer module" statement and its
`PostgreSQLDbContext.cs:23` anchor are superseded by this revision).

1. Not every consumer module declares a `ModuleApplicationDbContext`. ADC Identity
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15`),
   Conference (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:22`),
   Engagement (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:20`)
   and Helpdesk Tickets
   (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:14`)
   do; ADC Notification declares none. Its module projects are only `MMCA.ADC.Notification.API`,
   `MMCA.ADC.Notification.Application` and `MMCA.ADC.Notification.Shared` (the host-side
   `MMCA.ADC.Notification.Contracts` and `MMCA.ADC.Notification.Service` projects live under
   `MMCA.ADC/Source/Services`), and none of them is an Infrastructure project. Notification still
   owns persistence: the `ADC_Notification` database maps `PushNotification` and `UserNotification`
   to a `Notification` schema
   (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Notification/Migrations/SQLServerDbContextModelSnapshot.cs:95`,
   `:156`), but those entities live in MMCA.Common and the module owns no aggregates of its own
   (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:269-270`). The Decision
   bullet keeps "Each module may declare" and names Notification as the module that does not.
2. Anchors re-verified against current source: `PostgreSQLDbContext` is declared at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/PostgreSQLDbContext.cs:24`
   (was `:23`); the `AtlDevCon` archived-and-dropped note at `MMCA.ADC/infra/main.bicep:1114` (was
   `:1080`), with the 2026-10-03 bacpac deletion sentence at `:1119` (was `:1085`) and a second
   mention in the LTR comment at `:1164-1165`; the `serviceDatabaseLtr` policy at
   `MMCA.ADC/infra/main.bicep:1166` (was `:1132`), weekly `P4W`, monthly `P12M`, yearly `P1Y` at
   `:1171-1173` (values unchanged); `MMCA.Helpdesk/AGENTS.md:74`,
   `MMCA.ADC/infra/POST-CUTOVER-atldevcon-downgrade.md:103` and
   `MMCA.ADC/infra/DISASTER-RECOVERY.md:27` are unchanged.
