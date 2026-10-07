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
  introduce per-module DbContext classes (see the "Don't split SQLServerDbContext" convention). The
  default engine is SQL Server (`SQLServerDbContext`); ADR-018 later added `SqliteDbContext` and
  `CosmosDbContext`, each a sealed subclass of the abstract `ApplicationDbContext`. The right context
  class is materialized once per `DataSourceKey(Engine, Name)` by `PhysicalDbContextFactory`; entities
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
  their own PITR plus LTR (`MMCA.ADC/infra/main.bicep:921`, `MMCA.ADC/infra/main.bicep:966`,
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
