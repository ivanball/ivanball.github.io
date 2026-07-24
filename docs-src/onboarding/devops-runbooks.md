# Operational Scripts & Runbooks

This chapter covers every operational script and runbook in `MMCA.ADC`: the one-time Azure
bootstrap, the database-per-service cutover story (how the legacy `AtlDevCon` monolith DB was
split into four per-service databases), the disaster-recovery posture, the post-cutover archive
downgrade, and the Play Store asset pipeline. For each artifact you will learn what it does, when
an operator runs it, a step-by-step walkthrough with line cites, and why each gate or design choice
exists. Architecture rubric categories are tagged inline; cross-links reach the IaC and CI/CD
chapters and the ADRs that recorded the underlying decisions.

> **Architectural context.** The database-per-service split ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) and the resilience/recovery
> posture ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)) are the two decisions that make this chapter necessary. Read both ADRs before
> running any of these scripts against production.

---

## azure-setup.sh, One-time Azure bootstrap

**File:** `MMCA.ADC/scripts/azure-setup.sh`

**What it is.** A bash script that creates every Azure identity and OIDC credential the GitHub
Actions deploy pipeline needs. It is idempotent: every step checks for existing state before
creating anything (`azure-setup.sh:12`, "Idempotent: safe to re-run").

**When to run.** Once per environment: when standing up a fresh Azure deployment for the first
time, or when rebuilding after a disaster recovery scenario where the identity objects were lost.
Never run it as part of a regular deploy; `deploy.yml` consumes the outputs but never re-runs
this script.

[Rubric §11, Security] assesses whether secrets are managed safely and whether OIDC / managed
identities replace long-lived credentials. This script is the bootstrap for that posture: it
creates a User-Assigned Managed Identity (UAMI) and federated GitHub OIDC credentials so the
pipeline never holds a client secret.

[Rubric §17, DevOps & Deployment] assesses whether the provisioning and deployment pipeline is
automated, repeatable, and documented. The bootstrap being a single idempotent script that also
prints its own post-run checklist (`azure-setup.sh:143–177`) is the embodiment of that principle.

### Walkthrough

**Configuration block (`azure-setup.sh:26–35`).** Hard-codes the target subscription
(`4513b073-3a04-4f5c-b272-bbcc329b2d49`), tenant (`QiMata Technologies`), resource group
(`acc-rg`), location (`eastus2`), UAMI name (`mmca-adc-github-deploy`), and GitHub coordinates
(`ivanball/ADC`, `main`, environment `production`). Edit these before running in a different
environment.

**Why UAMI instead of an App Registration (`azure-setup.sh:6–10`).** AAD App Registration
creation is blocked in the QiMata tenant for non-admin users (`Graph
Authorization_RequestDenied`). UAMIs are ARM resources, RG-level Contributor plus role-assignment
rights is sufficient to create them. The choice is forced by tenant policy, not preference.

**Resource group (`azure-setup.sh:43–47`).** `az group create` is a no-op when the group already
exists. The comment (`azure-setup.sh:40–42`) explicitly notes that `acc-rg` is shared with other
production resources and that `mode=Complete` is therefore forbidden, destroying unrelated
resources with a Complete-mode Bicep deploy would be catastrophic.

**UAMI creation and ID retrieval (`azure-setup.sh:49–65`).** Creates the identity and then
immediately queries both `clientId` and `principalId`. The `clientId` goes into the GitHub secret
`AZURE_CLIENT_ID`; the `principalId` is used for role-assignment lookups.

**`assign_role` function and the az-cli 2.84.x workaround (`azure-setup.sh:73–100`).** Azure CLI
2.84.x returns a spurious `MissingSubscription` error on `az role assignment create` even when the
write succeeds (see the MEMORY note `feedback_azure_cli_role_bug.md`). The function therefore hits
the ARM REST API directly with `az rest PUT`. It also checks for an existing assignment first
(`az rest GET` + JMESPath filter) to be idempotent.

**Role assignments (`azure-setup.sh:103–105`).** Two roles are granted to the UAMI on the RG
scope:
- `Contributor` (GUID `b24988ac-…`), deploys ARM/Bicep, manages Container Apps, SQL, etc.
- `AcrPush` (GUID `8311e382-…`), pushes container images; the ACR admin password is disabled, so
  the UAMI's `AcrPush` is the only image-push path.

**Federated credentials (`azure-setup.sh:112–138`).** Two OIDC federated credentials are
created on the UAMI, using `create_or_replace_fic` which skips creation if the credential already
exists:
- `github-env-production`, subject `repo:ivanball/ADC:environment:production`. The deploy job
  uses `environment: production`, which produces this subject.
- `github-ref-main`, subject `repo:ivanball/ADC:ref:refs/heads/main`. A fallback for workflow
  runs not bound to an environment.

**Post-run checklist (`azure-setup.sh:143–177`).** The script prints everything the operator must
do manually: create the GitHub environment, add six required secrets (`AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `SQL_ADMIN_PASSWORD`, `JWT_RSA_PRIVATE_KEY_PEM`,
`JWT_RSA_PUBLIC_KEY_PEM`), one required variable (`AZURE_RESOURCE_GROUP`), and a list of optional
secrets for SMTP, OAuth, and the Anthropic API.

---

## The database-per-service cutover story

Before the cutover scripts make sense, the story behind them does.

**Before [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html).** All four modules (`Identity`, `Conference`, `Engagement`, `Notification`)
pointed at a single shared SQL database called `AtlDevCon`. This caused an outbox race: every
service's `OutboxProcessor` polled the same `dbo.OutboxMessages` table and could claim another
service's rows, producing duplicate dispatch (the precise defect documented in [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) and the
`project_outbox_race_shared_db.md` memory note, fixed 2026-06-07).

**The [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) decision.** Adopt database-per-service. Each service owns `ADC_Identity`,
`ADC_Conference`, `ADC_Engagement`, or `ADC_Notification`, locally on the Aspire SQL container,
in Azure as four Basic-tier databases on the same SQL server. The legacy `AtlDevCon` database is
retained **read-only** as an archive and rollback path and is never deleted. Cross-service
references become scalar IDs (no cross-database foreign keys); `CrossDataSourceDegradeConvention`
removes FK constraints at the EF level; consistency flows through the outbox and broker ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).

[Rubric §8, Data Architecture] assesses data modeling quality, isolation, and whether services
own their own schema. The per-service database design directly addresses this: each service has its
own schema, its own migrations project, and its own `dbo.OutboxMessages`, no service ever sees
another's rows.

**The three-commit rollout plan.** The Azure cutover was structured as three commits to prevent
data loss:
1. **Commit 1**, `main.bicep` provisions the four `ADC_*` databases (empty). Services still read
   `AtlDevCon`.
2. **Run `cutover-per-service-dbs.yml`** (one-time, manual), migrates the four empty databases,
   copies `AtlDevCon` data into them, verifies row counts. `AtlDevCon` is never written.
3. **Commit 2**, Container App env vars flip to the per-service connection strings. Services now
   read and write their own databases.
4. **Commit 3**, downgrade `AtlDevCon` from S0 to Basic tier (archive), as described in the
   post-cutover runbook below.

### cutover-per-service-dbs.yml, the orchestrating workflow

**File:** `MMCA.ADC/.github/workflows/cutover-per-service-dbs.yml`

**What it is.** A manually-triggered (`workflow_dispatch`) GitHub Actions workflow that runs the
entire cutover sequence safely against production Azure SQL.

**When to run.** Exactly once per environment, between Commit 1 (databases provisioned) and
Commit 2 (app flip). Never again, the `copy-atldevcon-to-per-service-dbs.azure.ps1` script skips
tables that already have rows, so accidental re-runs after Commit 2 would silently skip seeded
data.

**Confirmation gate (`cutover-per-service-dbs.yml:49–53`).** The `confirm` input must be typed as
exactly the string `"cutover"`. Any other value aborts immediately. This is a typo-prevention
guard for a destructive (irreversible-at-scale) one-time operation.

**Concurrency lock (`cutover-per-service-dbs.yml:37–39`).** Uses `group: prod-azure` with
`cancel-in-progress: false`, the same concurrency group as `deploy.yml`. A simultaneous `push` to
`main` cannot interleave a new container revision mid-copy, because the cutover workflow holds the
lock and `cancel-in-progress: false` prevents it from being preempted.

**GATE 1, apps still point at `AtlDevCon` (`cutover-per-service-dbs.yml:71–81`).** Checks
whether `adc-prod-identity` already carries `DataSources__Identity__SQLServerConnectionString`. If
it does, Commit 2 has already been deployed and the seeded `ADC_*` tables are non-empty; a copy
would silently skip everything. The step aborts with a clear error message.

**SQL server discovery (`cutover-per-service-dbs.yml:83–92`).** Queries by name prefix
(`adc-prod-sql-*`) rather than hard-coding the suffix token, so the FQDN is always resolved from
the live Azure state.

**Optional traffic freeze (`cutover-per-service-dbs.yml:99–101`).** When `freeze_traffic: true`,
the step disables the Gateway's Container App ingress (`az containerapp ingress disable`). This
eliminates the write-drift window (new rows written to `AtlDevCon` after the copy starts but
before the flip). Recommended for production cutovers. The re-enable step (`cutover-per-service-dbs.yml:164–171`) runs
under `if: ${{ always() && inputs.freeze_traffic }}` so the Gateway is never left offline even if a
later step fails.

**GATE 2, outbox drained (`cutover-per-service-dbs.yml:105–117`).** Counts unprocessed rows in
`AtlDevCon.dbo.OutboxMessages WHERE ProcessedOn IS NULL`. A non-zero count aborts. This is
critical: unprocessed outbox rows represent integration events that have not yet been published to
the broker. Copying them after the flip is complex (the commented-out section in the SQL script
shows how). Draining first means the copy script can safely omit `OutboxMessages` entirely.

**Migration generation (`cutover-per-service-dbs.yml:119–135`).** Runs `dotnet ef migrations
script --idempotent` for each of the four per-module migration projects
(`Source/Hosting/MMCA.ADC.Migrations.SqlServer.{Identity,Conference,Engagement,Notification}`).
No database connection is opened during script generation, the design-time factory in each
migration project is self-contained.

**Migration application (`cutover-per-service-dbs.yml:137–145`).** Applies each generated script
to its target database via `sqlcmd`. The `--idempotent` flag means re-running is safe: applied
migrations are skipped.

**Data copy (`cutover-per-service-dbs.yml:152–161`).** Calls
`copy-atldevcon-to-per-service-dbs.azure.ps1` with `-VerifyCounts`, which fails the step if any
target has fewer rows than its source. `AtlDevCon` is read-only throughout.

---

## copy-atldevcon-to-per-service-dbs.azure.ps1, Azure data copy

**File:** `MMCA.ADC/scripts/copy-atldevcon-to-per-service-dbs.azure.ps1`

**What it is.** A PowerShell script that streams rows from `AtlDevCon` into the four per-service
Azure SQL databases using `SqlBulkCopy`. It is the Azure-compatible counterpart to the local SQL
script (below), Azure SQL Database does not support the three-part cross-database names
(`AtlDevCon.schema.Table`) that `sqlcmd` needs, so the PowerShell approach opens a separate
connection per database and streams data row-by-row.

**When to run.** Invoked by `cutover-per-service-dbs.yml`. Can also be run from a developer
machine (the `dev-machine use` block in the doc comment, lines 60–67, explains the temporary
firewall rule needed for that).

[Rubric §17, DevOps & Deployment] assesses automation. Running this script from the CI workflow
rather than a manual SSMS session means the copy is reproducible, version-controlled, and audited
in the Actions run log.

### Walkthrough

**Table list (`copy-atldevcon-to-per-service-dbs.azure.ps1:86–109`).** An ordered array of
`{Db, Schema, Table}` hashes in FK-safe order, roots before children, parent tables before join
tables. The order mirrors `migrate-atldevcon-to-per-service-dbs.sql` exactly (comment on line 84).
`OutboxMessages` is deliberately absent (line 85, "intentionally absent").

**Skip-if-non-empty guard (`copy-atldevcon-to-per-service-dbs.azure.ps1:171–176`).** Before
touching any table, a `COUNT(*)` query checks whether the target already has rows. If it does, the
table is skipped with a `SKIP` log line. This is the idempotency mechanism: re-running after a
partial failure copies only the missing tables. The flip side, straggler rows written to
`AtlDevCon` after the copy, is explicitly called out as NOT handled automatically (doc comment
lines 30–36).

**Copyable-column resolution (`copy-atldevcon-to-per-service-dbs.azure.ps1:127–147`).** Queries
`sys.columns` on the *source* connection, excluding computed columns (`is_computed = 0`) and
`timestamp`/`rowversion` columns (`TYPE_NAME <> 'timestamp'`). Targets mint fresh `RowVersion`
values. Critically, the script uses **name-based column mappings** (`foreach ($c in $columns) {
[void]$bulk.ColumnMappings.Add($c, $c) }`, line 197), not ordinal mappings, because the excluded
`rowversion` column would shift ordinals and produce wrong-column inserts.

**`KeepIdentity` + RESEED (`copy-atldevcon-to-per-service-dbs.azure.ps1:192, 206–209`).** The
`SqlBulkCopy` options include `KeepIdentity` so numeric primary keys are preserved verbatim. After
the copy, `DBCC CHECKIDENT ... RESEED` re-synchronizes the identity seed so the next `INSERT` does
not collide with copied IDs.

**`QUOTED_IDENTIFIER ON` (`copy-atldevcon-to-per-service-dbs.azure.ps1:18`, doc comment, line
18).** `Microsoft.Data.SqlClient` sessions default `QUOTED_IDENTIFIER ON`. This is required for
inserts into tables that have filtered indexes (which use `WHERE` clauses that reference quoted
identifiers). The equivalent `sqlcmd -I` flag is passed by the local PowerShell wrapper below.

**`-VerifyCounts` flag (`copy-atldevcon-to-per-service-dbs.azure.ps1:226–259`).** When set,
re-opens both source and target connections after the copy and compares row counts per table. Any
target with *fewer* rows than its source causes the script to exit non-zero, failing the CI step.
Targets with *more* rows (e.g. seeded admin rows) are flagged for investigation but do not fail.

---

## migrate-atldevcon-to-per-service-dbs.ps1, local data copy wrapper

**File:** `MMCA.ADC/scripts/migrate-atldevcon-to-per-service-dbs.ps1`

**What it is.** A thin PowerShell wrapper that invokes the companion SQL script via `sqlcmd`
against the local Aspire SQL container. Unlike the Azure script, this one uses three-part
cross-database names, supported by SQL Server on the Aspire container, not by Azure SQL Database.

**When to run.** Once per local environment, after the first `dotnet run --project
Source/Hosting/MMCA.ADC.AppHost` has let every service create, migrate, and seed its own database.
Run it when you are first standing up a local development environment from the legacy `AtlDevCon`
data (e.g. restoring a production snapshot locally for debugging).

### Walkthrough

**Parameters (`migrate-atldevcon-to-per-service-dbs.ps1:18–22`).** `-Server` (default
`localhost,1433`) and `-Password` (mandatory SA password). Get the dynamic port from the Aspire
dashboard's `sql` resource connection string.

**`sqlcmd` invocation (`migrate-atldevcon-to-per-service-dbs.ps1:27`).** Key flags: `-C` (trust
server cert on the self-signed Aspire container cert), `-b` (exit non-zero on error), `-I`
(enable `QUOTED_IDENTIFIER ON`, required for the filtered indexes on the target tables), `-i
$scriptPath` (the SQL file). A non-zero exit code is re-thrown as a PowerShell exception.

---

## migrate-atldevcon-to-per-service-dbs.sql, local SQL copy script

**File:** `MMCA.ADC/scripts/migrate-atldevcon-to-per-service-dbs.sql`

**What it is.** The T-SQL script that performs the actual per-row copy from `AtlDevCon` into the
four per-service databases using three-part names. Safe to run against the local Aspire SQL
container; not safe against Azure SQL Database (three-part names are not supported there, use
`copy-atldevcon-to-per-service-dbs.azure.ps1` instead).

**When to run.** Invoked by `migrate-atldevcon-to-per-service-dbs.ps1`. Never run directly in
production.

[Rubric §8, Data Architecture] assesses migration hygiene and whether the database split is
tractable. This script is the local proof that the split is mechanical and auditable, not a manual
SSMS drag-and-drop.

### Walkthrough

**Session settings (`migrate-atldevcon-to-per-service-dbs.sql:19–23`).** `SET XACT_ABORT ON`
ensures that any error rolls back the current statement's implicit transaction. `SET
QUOTED_IDENTIFIER ON` and `SET ANSI_NULLS ON` are required by the filtered indexes on the target
tables.

**Source-exists guard (`migrate-atldevcon-to-per-service-dbs.sql:25–29`).** `IF DB_ID(N'AtlDevCon')
IS NULL`, exits cleanly with a message if the source database does not exist on this instance (e.g.
a fresh local machine that never had the legacy DB).

**Table sequence (`migrate-atldevcon-to-per-service-dbs.sql:32–56`).** An in-memory table variable
holds the ordered list (`Seq`, `TargetDb`, `SchemaName`, `TableName`) in FK-safe sequence,
roots first (Event, User), leaf joins last (SessionCategoryItem, EventQuestionAnswer). The
sequence numbers leave gaps between modules (10-series, 20-34 series, 40-series, 50-51) for easy
insertion.

**Column introspection (`migrate-atldevcon-to-per-service-dbs.sql:81–110`).** Dynamic SQL builds
the column list at runtime from `AtlDevCon.sys.columns`, excluding computed columns and
`timestamp` types. The same column set (aliased `s.`) forms the `SELECT` list; the primary-key
columns drive the `WHERE NOT EXISTS` idempotency predicate.

**Per-row idempotency (`migrate-atldevcon-to-per-service-dbs.sql:123–124`).** The insert is
`INSERT INTO <target> (...) SELECT ... FROM <source> AS s WHERE NOT EXISTS (SELECT 1 FROM <target>
AS t WHERE <pk match>)`. Re-running the script copies only rows whose primary key is absent from
the target, so seeded rows (e.g. the admin account) are not duplicated, and a partial run can
be safely resumed.

**`IDENTITY_INSERT ON/OFF` (`migrate-atldevcon-to-per-service-dbs.sql:118–127`).** Enabled for
tables that have identity columns (`sys.identity_columns`), preserving source PKs verbatim. Note:
the Azure bulk-copy script handles identity reseeding explicitly; the SQL script does not (the
next insert on the local container will land at the highest existing ID + 1 automatically via
`DBCC CHECKIDENT`).

**`OutboxMessages`, deliberately omitted (`migrate-atldevcon-to-per-service-dbs.sql:14–17`).** The
commented-out block at lines 149–156 shows how to route unprocessed rows by event namespace if
you must preserve them, but the normal path is to drain the outbox on the old branch first and
not copy it at all.

---

## infra/DISASTER-RECOVERY.md, DR runbook

**File:** `MMCA.ADC/infra/DISASTER-RECOVERY.md`

**What it is.** The authoritative disaster-recovery runbook for the ADC production environment.
Mandated by [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html): every consuming app must declare RTO/RPO per failure scenario, document the
backup/restore mechanism, accept single-region risk in writing, and record restore drills in a
drill-result table.

**When to consult.** On any data-loss event, corruption, failed deployment, or region outage.
Also consult it when changing backup/retention settings to understand what the targets are, and
periodically to schedule the next restore drill.

Cross-link: see [tier-0N IaC chapter](#) for how `infra/main.bicep` provisions the LTR policies
and alerts, and [tier-0N CI/CD chapter](#) for the deploy rollback mechanism.

[Rubric §29, Resilience & Business Continuity] assesses whether the system has documented RTO/RPO
targets and a drilled restore procedure. The DR file directly addresses this rubric item,
including the explicit acknowledgment that the next restore drill (`DISASTER-RECOVERY.md:131`) has
not yet been executed (TD-10).

[Rubric §13, Observability] assesses alerting and monitoring. The three App Insights metric alerts
defined in `main.bicep` and documented in `DISASTER-RECOVERY.md:46–57` are the alerting posture:
failed requests > 10, avg response time > 3000 ms, dependency failures > 10, each evaluated over
a 15-minute window.

[Rubric §11, Security] assesses credential hardening. The managed-identity section
(`DISASTER-RECOVERY.md:60–85`) documents the out-of-band bootstrap for the `adc-prod-apps-identity`
UAMI and the Key Vault RBAC grants. The ACR admin user is disabled; no plaintext secrets exist in
Container App environment variables.

### Recovery objectives

The DR file targets three failure scenarios (`DISASTER-RECOVERY.md:11–14`):

| Scenario | RPO | RTO |
|---|---|---|
| Accidental data loss / bad migration (within 7-day PITR window) | ≤ ~10 min | ≤ 2 h |
| Single service DB corruption | ≤ ~10 min | ≤ 1 h (PITR restore-as-new, swap name) |
| Full region loss | ≤ 1 h (geo-redundant backup replication lag) | ≤ 4 h (geo-restore + redeploy) |

These are deliberately modest: ADC is a regional, non-24×7 conference app. Sub-hour multi-region
failover is explicitly not a goal (`DISASTER-RECOVERY.md:17–18`).

### Accepted single-region risks

`DISASTER-RECOVERY.md:20–32` lists three knowingly-accepted SPOFs:
- One Azure SQL server (mitigated by geo-redundant PITR + LTR + `AtlDevCon` archive).
- One Container Apps environment, all apps `minReplicas: 1`. A zonal outage drops the app until
  Azure reschedules. Conference-day scale-up (applied only when warranted, the 2026 ADC load of
  ~67 peak concurrent did not warrant it) is the documented mitigation.
- One Service Bus namespace (Standard) and one ACR.

### Backup posture

Two tiers (`DISASTER-RECOVERY.md:35–42`):
- **PITR**: 7-day point-in-time restore on geo-redundant storage. Covers the "undo the last bad
  change" case with an RPO of minutes.
- **LTR**: long-term retention on all four live per-service databases: weekly P4W, monthly P12M,
  yearly P1Y (week 1). Declared via the `serviceDatabaseLtr` resource in `infra/main.bicep`.
  `AtlDevCon` is excluded (static archive, never written after cutover).

### Recovery procedures

**Single database PITR restore (`DISASTER-RECOVERY.md:90–93`).** Restore to a new name, validate,
then rename or repoint via a redeploy. Example given for `ADC_Conference`.

**LTR restore (`DISASTER-RECOVERY.md:95–100`).** List available backups with `az sql db ltr-backup
list`, then restore with `az sql db ltr-backup restore`.

**Full region loss (`DISASTER-RECOVERY.md:102–105`).** The deploy pipeline is region-parameterized
(`sqlLocation` + RG location), so recovery is: create a new RG in a healthy region → geo-restore
each `ADC_*` database there → re-run `deploy.yml` pointed at the new RG. The `AtlDevCon` archive
is the last-resort source of record.

**Deploy rollback (`DISASTER-RECOVERY.md:107–113`).** `deploy.yml`'s post-deploy smoke gate
(Gateway `/health` + `/.well-known/jwks.json` + UI root, with retries) auto-reverts every
container app to its previous revision via `az containerapp revision copy` if the new revision
does not serve. Manual rollback example is also given.

### Restore drill requirement

`DISASTER-RECOVERY.md:118–131` provides a `sqlcmd`-based drill script that restores a throwaway
copy of `AtlDevCon`, verifies table and row counts, then deletes it. The drill-result table (line
129) currently reads "not yet drilled (TD-10)", per [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html), a recorded drill is required before
the next release.

---

## infra/POST-CUTOVER-atldevcon-downgrade.md, archive downgrade runbook

**File:** `MMCA.ADC/infra/POST-CUTOVER-atldevcon-downgrade.md`

**What it is.** A step-by-step runbook for the third and final commit of the database-per-service
rollout: downgrading `AtlDevCon` from S0 to Basic tier in `main.bicep`. This is a cost-reduction
step that must be taken only after the per-service databases have been proven in production.

**When to run.** After the per-service databases (`ADC_*`) have been running and verified for at
least 24 hours, `AtlDevCon` has had no new writes, and the outbox is fully drained.

[Rubric §31, Cost/FinOps] assesses whether cost is actively managed and right-sized. Downgrading
a now-idle database from S0 (10 DTU, ~$15/month) to Basic (5 DTU, ~$5/month) once it becomes a
static archive is the operationalization of that principle.

[Rubric §8, Data Architecture] assesses data lifecycle and migration hygiene. Keeping `AtlDevCon`
in the Bicep declaration under a `// RETAINED, archived legacy database, data preserved. NEVER
delete.` comment (shown in the runbook, line 42) prevents out-of-band drift: the Bicep resource
is always the source of truth about the database's existence and configuration.

### Walkthrough

**Prerequisites (`POST-CUTOVER-atldevcon-downgrade.md:15–32`).** Three checks:
1. Confirm the flip is live and healthy, all four `adc-prod-*` apps serve from their `ADC_*`
   databases, `AtlDevCon` has had no writes for ≥24h, outbox is empty (`ProcessedOn IS NULL = 0`).
2. Confirm `AtlDevCon` fits in the 2 GB Basic cap using `az sql db list-usages`. At ~76 users /
   50 sessions / 53 speakers, it is far under the limit.
3. Export a permanent `.bacpac` archive before downgrading. Basic tier retains PITR for only 7 days
   (vs 35 days for S0), so a one-off export to blob storage is the last-resort point-in-time
   snapshot (`POST-CUTOVER-atldevcon-downgrade.md:24–31`).

**The Bicep change (`POST-CUTOVER-atldevcon-downgrade.md:33–53`).** Replace `sku` and `maxSizeBytes`
only on the `AtlDevCon` resource. The resource stays in `main.bicep`, Incremental mode would
not delete it if removed, but keeping it declared prevents out-of-band drift. The change is
`name: 'Basic', tier: 'Basic', capacity: 5` with `maxSizeBytes: 2147483648` (2 GB cap).

**Why Commit 3 is separate (`POST-CUTOVER-atldevcon-downgrade.md:8–9`).** If `main.bicep` carried
the Basic SKU when Commit 2 deployed (the app flip), `AtlDevCon` would be downgraded before the
new databases were proven. Separating the commits eliminates that risk.

**Deploy via the normal pipeline.** Merge the Bicep change and let `deploy.yml` apply it
(`POST-CUTOVER-atldevcon-downgrade.md:55`). No special workflow or manual `az sql db update`
command is needed, Incremental mode changes only the SKU, data is untouched.

**Verification (`POST-CUTOVER-atldevcon-downgrade.md:57–59`).** `az sql db show` confirms `sku.name
= Basic` and `maxSizeBytes = 2147483648`. A spot row-count query against `AtlDevCon` confirms data
is preserved.

**Rollback (`POST-CUTOVER-atldevcon-downgrade.md:61–62`).** Revert the Commit 3 change and
redeploy to return `AtlDevCon` to S0. Rolling back the downgrade is entirely independent of
rolling back the app flip (Commit 2); they can be reverted separately.

---

## play-store-capture.ps1, Android screenshot capture

**File:** `MMCA.ADC/scripts/play-store-capture.ps1`

**What it is.** A PowerShell 7 script that captures a screenshot from an attached Android device
or emulator via `adb screencap` and saves it as a deterministic-filename PNG under
`store-assets/play-store/raw/`.

**When to run.** When preparing or refreshing Google Play Store screenshots. Run once per slot
(e.g. `01-home`, `02-sessions`) on a device or emulator that is showing the correct screen. Eight
slots are defined in the companion compose script's lineup.

[Rubric §30, Compliance/Privacy] assesses whether the app store presence is maintained. These
scripts are the mechanism for maintaining Play Store assets, without them, the screenshots drift
from the current UI.

### Walkthrough

**Slug-based filenames (`play-store-capture.ps1:47–48`).** Raw captures are saved as `<slug>.png`
in a directory structure under `store-assets/play-store/raw/`. Deterministic names mean the
compose script can look them up by slug key without a manifest file.

**`-List` switch (`play-store-capture.ps1:53–65`).** Lists already-captured slots with file size
and timestamp, a quick sanity check before a composing session.

**`adb` resolution (`play-store-capture.ps1:67–76`).** Prefers `adb` on `PATH`; falls back to the
well-known SDK path (`C:\Program Files (x86)\Android\android-sdk\platform-tools\adb.exe`).

**`exec-out` not `shell screencap` (`play-store-capture.ps1:110`).** Uses `adb exec-out` to stream
the PNG binary directly into the output file. Plain `adb shell screencap` on Windows applies CRLF
translation to the binary stream, corrupting the PNG.

**Dimension read from IHDR (`play-store-capture.ps1:128–146`).** Reads the PNG IHDR chunk to print
the captured resolution. If width > height (landscape), a warning is emitted, Play Store phone
screenshots must be portrait.

---

## play-store-compose.ps1, Play Store screenshot compositor

**File:** `MMCA.ADC/scripts/play-store-compose.ps1`

**What it is.** A PowerShell 7 script that reads raw captures from `store-assets/play-store/raw/`,
wraps each into a 1080×1920 branded canvas, overlays a caption and subtitle from a hard-coded
lineup, and writes the finished PNG to `store-assets/play-store/screenshots/`. The composed images
satisfy Play Console's aspect-ratio requirement (Pixel emulators capture at 1080×2400, 9:20, which
Play Console rejects as too tall; the script guarantees a compliant 1080×1920 / 9:16 result).

**When to run.** After `play-store-capture.ps1` has captured all needed slots. Run with no `-Slug`
to compose the full set, or `-Slug <slug>` to recompose one slot. Run with `-NoCaption` for a
plain brand-framed variant (e.g. for the feature graphic or tablet screenshots).

[Rubric §30, Compliance/Privacy] assesses app store compliance. Play Console has strict
aspect-ratio rules for phone screenshots; this script enforces compliance mechanically rather than
relying on manual cropping.

### Walkthrough

**Lineup (`play-store-compose.ps1:52–61`).** Eight slots are defined inline with slug, caption
(large bold white text), and subtitle (smaller cyan text). The comment on line 51 notes that the
lineup must be kept in sync with `store-assets/play-store/README.md`.

**Brand colors (`play-store-compose.ps1:69–71`).** Three colors: `brandTeal` (`#0D7377`),
`brandCyan` (`#14FFEC`), `brandTealDark` (`#094F52`). The canvas uses a vertical `LinearGradientBrush`
from teal to dark teal for depth.

**`System.Drawing.Common` assembly (`play-store-compose.ps1:40–43`).** The script loads
`System.Drawing.Common` (PowerShell 7 path) with a fallback to the desktop-FX alias on
Windows PowerShell 5.1.

**Fit-inside scaling (`play-store-compose.ps1:134–136`).** Each raw capture is scaled to fit inside
the available image area (`imageMaxW × imageMaxH`, computed from the canvas minus caption area and
footer) preserving aspect ratio, then centered horizontally and vertically. Captures taller than
9:16 (e.g. 9:20 Pixel emulator) are letterboxed on the teal background.

**Soft shadow and cyan border (`play-store-compose.ps1:141–152`).** A 10-px-offset 30%-opacity
black rectangle produces a drop shadow. A 2-px cyan (`brandCyan`) rectangle borders the screenshot
so it pops against the teal background.

**Output (`play-store-compose.ps1:175`).** Each composed PNG is saved as
`store-assets/play-store/screenshots/<slug>.png`. Upload these directly to Play Console → Main
store listing → Phone screenshots.

---

## The database-per-service cutover in full context

The five database-related artifacts above form a single coherent story:

| Step | Who runs it | Artifact |
|---|---|---|
| **Local dev setup**, copy legacy data into fresh per-service databases on the Aspire container | Developer | `migrate-atldevcon-to-per-service-dbs.ps1` → `.sql` |
| **Production one-time cutover**, gate, freeze, migrate, copy, verify | GitHub Actions (manual trigger) | `cutover-per-service-dbs.yml` → `copy-atldevcon-to-per-service-dbs.azure.ps1` |
| **Post-cutover archive downgrade**, lower `AtlDevCon` to Basic tier | Developer (Bicep PR + normal deploy) | `POST-CUTOVER-atldevcon-downgrade.md` |
| **Disaster recovery**, restore a database, roll back a deploy | On-call operator | `DISASTER-RECOVERY.md` |

The `AtlDevCon` database is the thread that runs through all of them: it is the source of data
truth during the copy, the rollback path after the flip, and the last-resort archive in a
full-region DR scenario. That is why it is retained in `main.bicep` under a `// NEVER delete`
comment and why the DR runbook uses it as the drill target.

Cross-links:
- IaC chapter, `infra/main.bicep` provisions the four `ADC_*` databases, the LTR policies, the
  App Insights alerts, and the Service Bus namespace.
- CI/CD chapter, `deploy.yml` applies per-module idempotent migration scripts and runs the
  post-deploy smoke gate; `cutover-per-service-dbs.yml` is a sibling workflow in the same
  `prod-azure` concurrency group.
- [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), the decision to adopt database-per-service,
  the trade-offs, and the `CrossDataSourceDegradeConvention` that removes cross-database FKs.
- [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html), the resilience and recovery
  objectives framework, including the requirement that `DISASTER-RECOVERY.md` exists and that the
  drill-result table is filled.
- [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html), the outbox pattern that the cutover workflow
  gates on (drain first) and that the per-service databases each own independently.

---

## Rubric tag summary

| Tag | Artifact(s) |
|---|---|
| §8 Data Architecture | [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), the SQL/PS copy scripts, POST-CUTOVER downgrade runbook |
| §11 Security | `azure-setup.sh` (UAMI / OIDC), `DISASTER-RECOVERY.md` (managed identity, Key Vault) |
| §13 Observability | `DISASTER-RECOVERY.md` (App Insights metric alerts) |
| §17 DevOps & Deployment | `azure-setup.sh`, `cutover-per-service-dbs.yml`, copy scripts |
| §29 Resilience & Business Continuity | `DISASTER-RECOVERY.md` (RTO/RPO, PITR, LTR, restore runbook, drill requirement) |
| §30 Compliance/Privacy | `play-store-capture.ps1`, `play-store-compose.ps1` |
| §31 Cost/FinOps | `POST-CUTOVER-atldevcon-downgrade.md` (S0 → Basic downgrade) |

---

## Not determinable from source

- **Drill-result table** (`DISASTER-RECOVERY.md:129`), the table currently records "not yet
  drilled (TD-10)". The restore procedure is fully specified but has not been executed. The next
  operator to run it should fill in the date, source, and result.
- **`ALERT_EMAIL` variable**: `DISASTER-RECOVERY.md:55` references a repository Actions variable
  `ALERT_EMAIL` that routes alert notifications to an inbox. Whether this variable is currently set
  in the `ivanball/ADC` repository is not determinable from the file alone; check the repo
  Settings → Variables screen.
- **`store-assets/play-store/README.md`**: referenced by both play-store scripts as the canonical
  lineup source. The content of that file was not read as part of this chapter; the lineup in
  `play-store-compose.ps1:52–61` is ground truth for what is documented here.
- **Commit 2 status**: whether the production container app flip (Commit 2 of the three-commit
  rollout) has already been deployed cannot be determined from the scripts alone; the
  `cutover-per-service-dbs.yml` GATE 1 check resolves this at runtime by inspecting live Azure
  state.
