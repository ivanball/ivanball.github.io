# Operational Scripts & Runbooks

This chapter covers every operational script and runbook in `MMCA.ADC`: the one-time Azure
bootstrap, the database-per-service cutover story (how the legacy `AtlDevCon` monolith DB was
split into four per-service databases), the disaster-recovery posture, the automated restore
drill, the day-2 alert-triage runbook, the staged SQL managed-identity migration, the post-cutover
archive downgrade, the Play Store asset pipeline, and the mobile store-submission runbook. For
each artifact you will learn what it
does, when an operator runs it, a step-by-step walkthrough with line cites, and why each gate or
design choice exists. Architecture rubric categories are tagged inline; cross-links reach the IaC
and CI/CD chapters and the ADRs that recorded the underlying decisions.

> **Architectural context.** The database-per-service split ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) and the resilience/recovery
> posture ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)) are the two decisions that make this chapter necessary. Read both ADRs before
> running any of these scripts against production.

> **Which repo.** Every file cited here lives in `MMCA.ADC`. `MMCA.Store` ships same-named twins
> (`infra/DISASTER-RECOVERY.md`, `infra/OPERATIONS.md`, `.github/workflows/dr-drill.yml`,
> `scripts/dr-restore-drill.ps1`) with different contents. The quick tell: ADC's copies name the
> `acc-rg` resource group, the `AtlDevCon` archive and the four `ADC_*` databases; Store's name
> `ib_rg`, `MMCAStore` and three `Store_*` databases. Reading the wrong one hands an operator the
> other application's recovery procedure.

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
prints its own post-run checklist (`azure-setup.sh:141-176`) is the embodiment of that principle.

### Walkthrough

**Configuration block (`azure-setup.sh:26-35`).** Hard-codes the target subscription
(`4513b073-3a04-4f5c-b272-bbcc329b2d49`), tenant (`QiMata Technologies`), resource group
(`acc-rg`), location (`eastus2`), UAMI name (`mmca-adc-github-deploy`), and GitHub coordinates
(`ivanball/ADC`, `main`, environment `production`). Edit these before running in a different
environment.

**Why UAMI instead of an App Registration (`azure-setup.sh:6-10`).** AAD App Registration
creation is blocked in the QiMata tenant for non-admin users (`Graph
Authorization_RequestDenied`). UAMIs are ARM resources, RG-level Contributor plus role-assignment
rights is sufficient to create them. The choice is forced by tenant policy, not preference.

**Resource group (`azure-setup.sh:43-47`).** `az group create` is a no-op when the group already
exists. The comment (`azure-setup.sh:40-42`) explicitly notes that `acc-rg` is shared with other
production resources and that `mode=Complete` is therefore forbidden, destroying unrelated
resources with a Complete-mode Bicep deploy would be catastrophic.

**UAMI creation and ID retrieval (`azure-setup.sh:49-65`).** Creates the identity and then
immediately queries both `clientId` and `principalId`. The `clientId` goes into the GitHub secret
`AZURE_CLIENT_ID`; the `principalId` is used for role-assignment lookups.

**`assign_role` function and the az-cli 2.84.x workaround (`azure-setup.sh:73-100`).** Azure CLI
2.84.x returns a spurious `MissingSubscription` error on `az role assignment create` even when the
write succeeds (see the MEMORY note `feedback_azure_cli_role_bug.md`). The function therefore hits
the ARM REST API directly with `az rest PUT`. It also checks for an existing assignment first
(`az rest GET` + JMESPath filter) to be idempotent.

**Role assignments (`azure-setup.sh:103-105`).** Two roles are granted to the UAMI on the RG
scope:
- `Contributor` (GUID `b24988ac-...`), deploys ARM/Bicep, manages Container Apps, SQL, etc.
- `AcrPush` (GUID `8311e382-...`), pushes container images; the ACR admin password is disabled, so
  the UAMI's `AcrPush` is the only image-push path.

**Federated credentials (`azure-setup.sh:112-138`).** Two OIDC federated credentials are
created on the UAMI, using `create_or_replace_fic` which skips creation if the credential already
exists:
- `github-env-production`, subject `repo:ivanball/ADC:environment:production`. The deploy job
  uses `environment: production`, which produces this subject.
- `github-ref-main`, subject `repo:ivanball/ADC:ref:refs/heads/main`. A fallback for workflow
  runs not bound to an environment.

**Post-run checklist (`azure-setup.sh:141-176`).** The script prints everything the operator must
do manually: create the GitHub environment, add six required secrets (`AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `SQL_ADMIN_PASSWORD`, `JWT_RSA_PRIVATE_KEY_PEM`,
`JWT_RSA_PUBLIC_KEY_PEM`), one required variable (`AZURE_RESOURCE_GROUP`), and a list of optional
secrets for the HS256 fallback key, SMTP, OAuth, and the Anthropic API.

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
in Azure as four Basic-tier databases on the same SQL server (`main.bicep:661-677`, Basic 5 DTU
with a 2 GB cap each). The legacy `AtlDevCon` database is retained **read-only** as an archive and
rollback path and is never deleted. Cross-service references become scalar IDs (no cross-database
foreign keys); `CrossDataSourceDegradeConvention` removes FK constraints at the EF level;
consistency flows through the outbox and broker ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).

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

All of it has landed. `main.bicep` now injects the per-service connection strings into the
container apps as Key Vault secret references (`main.bicep:1082` is Identity's
`DataSources__Identity__SQLServerConnectionString`), and the `AtlDevCon` resource is declared at
the Basic archive SKU (`main.bicep:629-643`). The cutover workflow and the downgrade runbook below
are therefore history rather than pending steps, and they are documented here because they are the
recovery-time reference for rebuilding this topology from the archive.

### cutover-per-service-dbs.yml, the orchestrating workflow

**File:** `MMCA.ADC/.github/workflows/cutover-per-service-dbs.yml`

**What it is.** A manually-triggered (`workflow_dispatch`) GitHub Actions workflow that runs the
entire cutover sequence safely against production Azure SQL.

**When to run.** Exactly once per environment, between Commit 1 (databases provisioned) and
Commit 2 (app flip). Never again, the `copy-atldevcon-to-per-service-dbs.azure.ps1` script skips
tables that already have rows, so accidental re-runs after Commit 2 would silently skip seeded
data.

**Confirmation gate (`cutover-per-service-dbs.yml:48-53`).** The `confirm` input must be typed as
exactly the string `"cutover"`. Any other value aborts immediately. This is a typo-prevention
guard for a destructive (irreversible-at-scale) one-time operation.

**Concurrency lock (`cutover-per-service-dbs.yml:37-39`).** Uses `group: prod-azure` with
`cancel-in-progress: false`, the same concurrency group as `deploy.yml`. A simultaneous `push` to
`main` cannot interleave a new container revision mid-copy, because the cutover workflow holds the
lock and `cancel-in-progress: false` prevents it from being preempted.

**GATE 1, apps still point at `AtlDevCon` (`cutover-per-service-dbs.yml:74-81`).** Checks
whether `adc-prod-identity` already carries `DataSources__Identity__SQLServerConnectionString`. If
it does, Commit 2 has already been deployed and the seeded `ADC_*` tables are non-empty; a copy
would silently skip everything. The step aborts with a clear error message.

**SQL server discovery (`cutover-per-service-dbs.yml:83-92`).** Queries by name prefix
(`adc-prod-sql-*`) rather than hard-coding the suffix token, so the FQDN is always resolved from
the live Azure state.

**Optional traffic freeze (`cutover-per-service-dbs.yml:99-101`).** When `freeze_traffic: true`,
the step disables the Gateway's Container App ingress (`az containerapp ingress disable`). This
eliminates the write-drift window (new rows written to `AtlDevCon` after the copy starts but
before the flip). Recommended for production cutovers. The re-enable step (`cutover-per-service-dbs.yml:168-172`) runs
under `if: ${{ always() && inputs.freeze_traffic }}` so the Gateway is never left offline even if a
later step fails.

**GATE 2, outbox drained (`cutover-per-service-dbs.yml:105-117`).** Counts unprocessed rows in
`AtlDevCon.dbo.OutboxMessages WHERE ProcessedOn IS NULL`. A non-zero count aborts. This is
critical: unprocessed outbox rows represent integration events that have not yet been published to
the broker. Copying them after the flip is complex (the commented-out section in the SQL script
shows how). Draining first means the copy script can safely omit `OutboxMessages` entirely.

**Migration generation (`cutover-per-service-dbs.yml:119-135`).** Runs `dotnet ef migrations
script --idempotent` for each of the four per-module migration projects
(`Source/Hosting/MMCA.ADC.Migrations.SqlServer.{Identity,Conference,Engagement,Notification}`).
No database connection is opened during script generation, the design-time factory in each
migration project is self-contained.

**Migration application (`cutover-per-service-dbs.yml:137-146`).** Applies each generated script
to its target database via `sqlcmd`. The `--idempotent` flag means re-running is safe: applied
migrations are skipped.

**Data copy (`cutover-per-service-dbs.yml:152-162`).** Calls
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
machine (the `dev-machine use` block in the doc comment, lines 60-67, explains the temporary
firewall rule needed for that).

[Rubric §17, DevOps & Deployment] assesses automation. Running this script from the CI workflow
rather than a manual SSMS session means the copy is reproducible, version-controlled, and audited
in the Actions run log.

### Walkthrough

**Table list (`copy-atldevcon-to-per-service-dbs.azure.ps1:86-109`).** An ordered array of
`{Db, Schema, Table}` hashes in FK-safe order, roots before children, parent tables before join
tables. The order mirrors `migrate-atldevcon-to-per-service-dbs.sql` exactly (comment on line 84).
`OutboxMessages` is deliberately absent (line 85, "intentionally absent").

**Skip-if-non-empty guard (`copy-atldevcon-to-per-service-dbs.azure.ps1:171-176`).** Before
touching any table, a `COUNT(*)` query checks whether the target already has rows. If it does, the
table is skipped with a `SKIP` log line. This is the idempotency mechanism: re-running after a
partial failure copies only the missing tables. The flip side, straggler rows written to
`AtlDevCon` after the copy, is explicitly called out as NOT handled automatically (doc comment
lines 28-33, "There is intentionally no merge mode").

**Copyable-column resolution (`copy-atldevcon-to-per-service-dbs.azure.ps1:127-147`).** Queries
`sys.columns` on the *source* connection, excluding computed columns (`is_computed = 0`) and
`timestamp`/`rowversion` columns (`TYPE_NAME <> 'timestamp'`). Targets mint fresh `RowVersion`
values. Critically, the script uses **name-based column mappings** (`foreach ($c in $columns) {
[void]$bulk.ColumnMappings.Add($c, $c) }`, line 197), not ordinal mappings, because the excluded
`rowversion` column would shift ordinals and produce wrong-column inserts.

**`KeepIdentity` + RESEED (`copy-atldevcon-to-per-service-dbs.azure.ps1:192, 206-209`).** The
`SqlBulkCopy` options include `KeepIdentity` so numeric primary keys are preserved verbatim. After
the copy, `DBCC CHECKIDENT ... RESEED` re-synchronizes the identity seed so the next `INSERT` does
not collide with copied IDs.

**`QUOTED_IDENTIFIER ON` (`copy-atldevcon-to-per-service-dbs.azure.ps1:22-23`, doc comment).**
`Microsoft.Data.SqlClient` sessions default `QUOTED_IDENTIFIER ON`. This is required for
inserts into tables that have filtered indexes (which use `WHERE` clauses that reference quoted
identifiers). The equivalent `sqlcmd -I` flag is passed by the local PowerShell wrapper below.

**`-VerifyCounts` flag (`copy-atldevcon-to-per-service-dbs.azure.ps1:226-260`).** When set,
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

**Parameters (`migrate-atldevcon-to-per-service-dbs.ps1:18-21`).** `-Server` (default
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

**Session settings (`migrate-atldevcon-to-per-service-dbs.sql:19-23`).** `SET XACT_ABORT ON`
ensures that any error rolls back the current statement's implicit transaction. `SET
QUOTED_IDENTIFIER ON` and `SET ANSI_NULLS ON` are required by the filtered indexes on the target
tables.

**Source-exists guard (`migrate-atldevcon-to-per-service-dbs.sql:25-29`).** `IF DB_ID(N'AtlDevCon')
IS NULL`, exits cleanly with a message if the source database does not exist on this instance (e.g.
a fresh local machine that never had the legacy DB).

**Table sequence (`migrate-atldevcon-to-per-service-dbs.sql:32-56`).** An in-memory table variable
holds the ordered list (`Seq`, `TargetDb`, `SchemaName`, `TableName`) in FK-safe sequence,
roots first (Event, User), leaf joins last (SessionCategoryItem, EventQuestionAnswer). The
sequence numbers leave gaps between modules (10-series, 20-34 series, 40-series, 50-51) for easy
insertion.

**Column introspection (`migrate-atldevcon-to-per-service-dbs.sql:83-110`).** Dynamic SQL builds
the column list at runtime from `AtlDevCon.sys.columns`, excluding computed columns and
`timestamp` types. The same column set (aliased `s.`) forms the `SELECT` list; the primary-key
columns drive the `WHERE NOT EXISTS` idempotency predicate.

**Per-row idempotency (`migrate-atldevcon-to-per-service-dbs.sql:122-124`).** The insert is
`INSERT INTO <target> (...) SELECT ... FROM <source> AS s WHERE NOT EXISTS (SELECT 1 FROM <target>
AS t WHERE <pk match>)`. Re-running the script copies only rows whose primary key is absent from
the target, so seeded rows (e.g. the admin account) are not duplicated, and a partial run can
be safely resumed.

**`IDENTITY_INSERT ON/OFF` (`migrate-atldevcon-to-per-service-dbs.sql:118-127`).** Enabled for
tables that have identity columns (`sys.identity_columns`), preserving source PKs verbatim. Note:
the Azure bulk-copy script handles identity reseeding explicitly; the SQL script does not (the
next insert on the local container will land at the highest existing ID + 1 automatically via
`DBCC CHECKIDENT`).

**`OutboxMessages`, deliberately omitted (`migrate-atldevcon-to-per-service-dbs.sql:14-17`).** The
commented-out block at lines 151-156 shows how to route unprocessed rows by event namespace if
you must preserve them, but the normal path is to drain the outbox on the old branch first and
not copy it at all.

---

## infra/DISASTER-RECOVERY.md, DR runbook

**File:** `MMCA.ADC/infra/DISASTER-RECOVERY.md` (175 lines; not the Store file of the same name)

**What it is.** The authoritative disaster-recovery runbook for the ADC production environment.
Mandated by [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html): every consuming app must declare RTO/RPO per failure scenario, document the
backup/restore mechanism, accept single-region risk in writing, and record restore drills in a
drill-result table that cannot stay empty.

**When to consult.** On any data-loss event, corruption, failed deployment, or region outage.
Also consult it when changing backup/retention settings to understand what the targets are. Day-2
alert triage (what to do when an SLO alert fires) is the companion `infra/OPERATIONS.md`, not this
file (`OPERATIONS.md:3-6`).

Cross-link: see the [IaC chapter](devops-iac.md) for how `infra/main.bicep` provisions the LTR
policies and alerts, and the [CI/CD chapter](devops-cicd.md) for the deploy rollback mechanism
and the freshness gates.

[Rubric §29, Resilience & Business Continuity] assesses whether the system has documented RTO/RPO
targets and a drilled restore procedure. The DR file addresses both: the objectives table
(`DISASTER-RECOVERY.md:10-14`) and a maintained drill ledger of six rows
(`DISASTER-RECOVERY.md:151-158`), whose newest entry is a PITR restore of `ADC_Conference` on
2026-08-10 that completed in 2.1 min against the 2 h RTO and came back Online. The status block
(`DISASTER-RECOVERY.md:160-165`) reads that ledger as a rotation rather than as a single success:
every `ADC_*` database now carries a recovery proof, and the number it quotes is the **slowest**
measured restore in the rotation (4.4 min), not the fastest. A second status paragraph is retained
for the record (`DISASTER-RECOVERY.md:167-175`); it closes TD-10 on the strength of the original
2026-06-20 drill plus the Polly fault-injection tests in MMCA.Common and the Azure Monitor SLO
workbook (`main.bicep:530`, the `sloWorkbook` resource embedding
`infra/workbooks/adc-slo-workbook.json`).

[Rubric §13, Observability] assesses alerting and monitoring. The DR file's alert table
(`DISASTER-RECOVERY.md:49-53`) records the three SLO signals, their thresholds and their
severities: failed requests count > 10 (sev 2), average server response time > 3000 ms (sev 3),
dependency failures count > 10 (sev 2), each evaluated every 5 minutes over a 15-minute window.
Those numbers are current, but the resource type in the prose above the table
(`DISASTER-RECOVERY.md:45-47`, "metric alerts") is not: the live rules are KQL log-search alerts
built from `sloAlertSpecs` (`main.bicep:276-304`, materialized as `scheduledQueryRules` at
`main.bicep:306-348`), and the original metric alerts of the same names are kept declared with
`enabled: false` (`main.bicep:357-392`) because an incremental ARM deployment never deletes a
resource that simply left the template. Per-alert triage lives in `infra/OPERATIONS.md` below.

[Rubric §11, Security] assesses credential hardening. The managed-identity section
(`DISASTER-RECOVERY.md:59-85`) documents the out-of-band bootstrap for the `adc-prod-apps-identity`
UAMI, the Key Vault (`adckv<resourceToken>`, RBAC-authorized) and both role grants (Secrets User
for the apps, Secrets Officer for the deploy identity). The ACR admin user is disabled; runtime
secrets reach the container apps as `keyVaultUrl` references, so no plaintext secrets exist in
Container App environment variables.

### Recovery objectives

The DR file targets three failure scenarios (`DISASTER-RECOVERY.md:10-14`):

| Scenario | RPO | RTO |
|---|---|---|
| Accidental data loss / bad migration (within the retention window) | ≤ ~10 min | ≤ 2 h |
| Single service DB corruption | ≤ ~10 min | ≤ 1 h (PITR restore-as-new, swap name) |
| Full region loss | ≤ 1 h (geo-redundant backup replication lag) | ≤ 4 h (geo-restore + redeploy) |

These are deliberately modest: ADC is a regional, non-24×7 conference app. Sub-hour multi-region
failover is explicitly not a goal (`DISASTER-RECOVERY.md:16-17`).

### Accepted single-region risks

`DISASTER-RECOVERY.md:19-31` lists three knowingly-accepted SPOFs. Note the topology it records
(`DISASTER-RECOVERY.md:21-23`): one resource group (`acc-rg`), apps in the RG's region, and the
SQL server in `sqlLocation` (westus2) because the QiMata Sponsorship subscription blocks new SQL
servers in eastus2. That split is a bicep parameter, not an accident (`main.bicep:13-14`).

- One Azure SQL server, `publicNetworkAccess: Enabled` with the Azure-services firewall rule
  (mitigated by geo-redundant PITR + LTR + the `AtlDevCon` archive).
- One Container Apps environment, all apps `minReplicas: 1`. A zonal outage drops the app until
  Azure reschedules. Conference-day scale-up (applied only when warranted, the 2026 ADC load of
  ~67 peak concurrent did not warrant it) is the documented mitigation.
- One Service Bus namespace (Standard) and one ACR.

### Backup posture

Two tiers (`DISASTER-RECOVERY.md:33-41`):
- **PITR**: the Basic tier's 7 days of point-in-time restore on geo-redundant storage (the Azure
  default). Covers the "undo the last bad change" case with an RPO of minutes.
- **LTR**: long-term retention on all four live per-service databases: weekly P4W, monthly P12M,
  yearly P1Y (week 1). Declared via the `serviceDatabaseLtr` resource in `infra/main.bicep`
  (`main.bicep:683-694`). `AtlDevCon` is excluded (static archive, never written after cutover).

### Recovery procedures

**Single database PITR restore (`DISASTER-RECOVERY.md:89-94`).** Restore to a new name, validate,
then rename or repoint via a redeploy. Example given for `ADC_Conference`.

**LTR restore (`DISASTER-RECOVERY.md:96-101`).** List available backups with `az sql db ltr-backup
list`, then restore with `az sql db ltr-backup restore`.

**Full region loss (`DISASTER-RECOVERY.md:103-105`).** The deploy pipeline is region-parameterized
(`sqlLocation` + RG location), so recovery is: create a new RG in a healthy region → geo-restore
each `ADC_*` database there → re-run `deploy.yml` pointed at the new RG. The `AtlDevCon` archive
is the last-resort source of record.

**Deploy rollback (`DISASTER-RECOVERY.md:107-114`).** `deploy.yml`'s post-deploy smoke gate
(Gateway `/health` + `/.well-known/jwks.json` + UI root, with retries) auto-reverts every
container app to its previous revision via `az containerapp revision copy` if the new revision
does not serve. Manual rollback example is also given.

### Restore drill

`DISASTER-RECOVERY.md:116-138` defines the drill: PITR-restore a throwaway copy, confirm it comes
back Online, record the measured restore time, then delete the copy. Only a copy is ever created,
so the live databases are never touched. The file documents three ways to run it
(`DISASTER-RECOVERY.md:120-130`) and names the scheduled one as the enforcing path:

- **Scheduled** (`DISASTER-RECOVERY.md:122-125`), the weekly cron, which rotates across the four
  live per-service databases by ISO week number so each earns a recovery proof roughly monthly.
  The retired `AtlDevCon` archive is deliberately absent from the rotation and can never be the
  scheduled target.
- **One-click** (`DISASTER-RECOVERY.md:126-129`), the `dr-drill.yml` workflow's manual
  `workflow_dispatch`, for a chosen database (default `ADC_Identity`, with `AtlDevCon` still
  selectable as a manual-only archive check) and a chosen point in time. It prints the
  drill-result row in the job summary, ready to paste into the ledger.
- **Local / CLI** (`DISASTER-RECOVERY.md:130`), `pwsh ./scripts/dr-restore-drill.ps1
  -SourceDatabase ADC_Conference` after `az login`.

All three wrap the same `az sql db restore`, verify, `az sql db delete` sequence
(`DISASTER-RECOVERY.md:132-138`); there is no `sqlcmd` anywhere in the drill path.

The stated SLO is at least one successful drill per release train and after any backup or
retention change, with the restore completing inside the 2 h RTO; a missed or failed drill is
called a release-blocking regression for §29 (`DISASTER-RECOVERY.md:140-142`). The drill-result
table (`DISASTER-RECOVERY.md:151-158`) is where that claim is cashed, and it carries six rows:

| Drill date | Source | Result |
|---|---|---|
| 2026-06-20 | ADC_Conference (PITR) | PASS in 2.6 min, Online |
| 2026-07-20 | ADC_Identity (PITR) | PASS in 1.8 min, Online |
| 2026-07-20 | ADC_Engagement (PITR) | PASS in 2.3 min, Online |
| 2026-07-27 | ADC_Notification (PITR) | PASS in 2.1 min, Online |
| 2026-08-03 | ADC_Identity (PITR) | PASS in 4.4 min, Online |
| 2026-08-10 | ADC_Conference (PITR) | PASS in 2.1 min, Online |

Read the shape of that table, not just the last row. The first entry is the pre-rotation drill in
which one database stood in for all four; everything from 2026-07-20 onward is the weekly rotation,
and those rows are the first recovery proofs `ADC_Identity`, `ADC_Engagement` and `ADC_Notification`
ever had (`DISASTER-RECOVERY.md:144-149`). The spread is the other lesson: the same `ADC_Identity`
database restored in 1.8 min in July and 4.4 min in August, which is why the status block quotes the
slowest number against the 2 h RTO (`DISASTER-RECOVERY.md:160-165`). A ledger that keeps growing is
what makes a claim like "restores take about two minutes" falsifiable; a single row cannot show
variance at all.

The ledger stays honest because it is gated, not remembered: `dr-freshness` fails a deploy when the
newest successful `dr-drill.yml` run is older than 8 days (`deploy.yml:557`,
`DISASTER-RECOVERY.md:163-165`). The rotation itself is prose here but arithmetic in the workflow,
which is the source of truth. The next section walks it.

---

## dr-drill.yml and dr-restore-drill.ps1, the ADR-009 restore drill

**Files:** `MMCA.ADC/.github/workflows/dr-drill.yml`, `MMCA.ADC/scripts/dr-restore-drill.ps1`

**What it is.** The automation behind the drill requirement above: the workflow picks a target
database and logs in to Azure via OIDC, the PowerShell script does the restore, the timing, the
verification and the cleanup, and prints a drill-result row ready to paste into
`infra/DISASTER-RECOVERY.md` (`dr-restore-drill.ps1:2-6`).

**When it runs.** Both on a schedule and on demand, and the scheduled half is the one that carries
the §29 weight:

- **Weekly cron**, Mondays 06:00 UTC (`dr-drill.yml:30-32`). This is the enforcing path: a
  throwaway-copy restore is cheap and is deleted immediately after, so recovery is proven
  continuously rather than whenever somebody remembers (`dr-drill.yml:7-8`).
- **`workflow_dispatch`** (`dr-drill.yml:14-29`) for an ad-hoc drill against a specific database
  and restore point. The dispatch default is `ADC_Identity` with a 10-minutes-ago restore point.

Scheduled runs **rotate** across the four live per-service databases by ISO week number modulo 4
(`dr-drill.yml:52-71`), so each live database gets a recovery proof roughly monthly. `AtlDevCon` is
selectable on dispatch but is never the scheduled target, because it is the retired archive and
proving *it* restores proves nothing about the databases that take writes (`dr-drill.yml:9-12`).

[Rubric §29, Resilience & Business Continuity] is what this workflow serves: it converts the DR
runbook from a document into a measurement.

### Walkthrough of the script

**Parameters (`dr-restore-drill.ps1:22-29`).** `-ResourceGroup` (default `acc-rg`),
`-SourceDatabase` (default `AtlDevCon`), `-RestorePointMinutesAgo` (default 10), `-KeepCopy`, and
`-SummaryPath` (the workflow passes `$env:GITHUB_STEP_SUMMARY`, `dr-drill.yml:73-80`).

**Server discovery (`dr-restore-drill.ps1:39-43`).** Same prefix query as the cutover workflow
(`adc-prod-sql-*`), throwing a clear "did you run az login" error when nothing matches.

**Stale-copy cleanup (`dr-restore-drill.ps1:51-56`).** Deletes any `<SourceDatabase>-drill` left by
a previous run, so the restore name is free. Without it a crashed prior run would fail every
subsequent drill on a name collision.

**Restore and timing (`dr-restore-drill.ps1:58-65`).** A stopwatch brackets `az sql db restore`.
That elapsed time IS the measured RTO reported in the drill row; it is not an estimate.

**Verification (`dr-restore-drill.ps1:67-75`).** ARM-level: `az sql db show --query status` must
read `Online`, else the drill is a FAIL. A deeper row-count check is deliberately out of scope and
needs `-KeepCopy` plus a manual pass (`dr-restore-drill.ps1:17-20`).

**Cleanup (`dr-restore-drill.ps1:82-87`).** The delete sits in a `finally` block, so the throwaway
copy is removed even when the restore or the verification threw. This is the line that keeps a
weekly drill from accreting paid databases.

**Result row and exit code (`dr-restore-drill.ps1:89-100`).** Prints the markdown table row (date,
source, PASS/FAIL, minutes, note) to both the console and the job summary, then `exit 1` on
anything other than PASS, so a failed drill is a failed workflow run.

### What it does not do, and the gate that makes it matter

The drill never touches a live database and it does not gate production directly. The link to
production is the age of its newest successful run: `deploy.yml`'s `dr-freshness` job
(`deploy.yml:549-599`) reads the Actions API for the latest successful `dr-drill.yml` run and fails
the deploy when that run is older than 8 days (`deploy.yml:557`), or when there is no successful
run at all. `dr-freshness` sits in `deploy.needs` alongside `load-freshness` and
`cross-service-freshness` (`deploy.yml:866`, condition at `deploy.yml:891-893`), with a
justification-required break-glass dispatch input for a genuine emergency.

The operational consequence for an on-call reader: **a red or skipped weekly drill blocks the next
production deploy.** If a deploy fails on `dr-freshness`, the fix is to re-run `dr-drill.yml` (and
fix it first if it genuinely failed), not to bypass it. The gate's full mechanics, the break-glass
input and the two sibling gates are documented in the [CI/CD chapter](devops-cicd.md); the decision
is [ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html).

---

## infra/OPERATIONS.md, day-2 alert triage runbook

**File:** `MMCA.ADC/infra/OPERATIONS.md`

**What it is.** The alert-to-action companion to the provisioned observability: what to do when
each SLO alert fires, how to read the SLO workbook, and the standard recovery moves. It explicitly
defers restore procedure, RTO/RPO and accepted SPOFs to `DISASTER-RECOVERY.md` and covers day-2
triage only (`OPERATIONS.md:3-6`).

**When to consult.** When an alert email arrives from the `adc-prod-alerts-*` action group
(`main.bicep:246-260`), whose only receiver is the address in the `ALERT_EMAIL` repository
variable (`OPERATIONS.md:8-11`).

[Rubric §13, Observability & Operability] assesses whether alerts lead anywhere. A threshold with
no runbook is a page nobody knows how to answer, which is exactly what this file, and the build
gate below, exist to prevent.

### The pairing rule, enforced at build time

`ObservabilityConventionTestsBase` (in the `MMCA.Common.Testing.Architecture` package) pairs the
alerts declared in the consumer's bicep against the runbook sections in its `OPERATIONS.md`. ADC
subclasses it with nothing but an identity
(`Tests/Architecture/MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7`), and wires it
by embedding both files as manifest resources named `infra.main.bicep` and `infra.OPERATIONS.md`
(`MMCA.ADC.Architecture.Tests.csproj:17-22`). Three facts run:

1. **Non-vacuous floor** (`ObservabilityConventionTestsBase.cs:53-61`): at least
   `MinimumAlertSpecs` alerts must parse out of the bicep, defaulting to 3
   (`ObservabilityConventionTestsBase.cs:39`). If the parse anchors drift, the gate fails loudly
   instead of passing with zero discovered alerts.
2. **Forward direction** (`ObservabilityConventionTestsBase.cs:63-89`): every discovered alert key
   must have a `### ...-alert-<key>` heading in `OPERATIONS.md`, and that heading must carry the
   alert's current severity as the literal text `(sev N)`. Re-tiering an alert in bicep without
   touching its runbook heading fails the build.
3. **Reverse direction** (`ObservabilityConventionTestsBase.cs:91-103`): a runbook section for an
   alert bicep no longer provisions is an orphan and also fails the build.

The parse window is the text between `var sloAlertSpecs` and `resource sloAlerts`
(`ObservabilityConventionTestsBase.cs:109-110`). In ADC's bicep that is `main.bicep:276` through
`main.bicep:363`, which happens to contain both the live `sloAlertSpecs` (276-304) and the
superseded `legacySloMetricAlertSpecs` (357-361). The parser therefore sees the same three keys
twice with identical severities, which is harmless: the counts of keys and severities still match,
and both copies resolve to the same runbook section.

ADC's three sections are `adc-alert-failed-requests` (sev 2, `OPERATIONS.md:15`),
`adc-alert-server-response-time` (sev 3, `OPERATIONS.md:29`) and `adc-alert-dependency-failures`
(sev 2, `OPERATIONS.md:42`). The headings use the pre-`v2` rule names while the live scheduled-query
rules are provisioned as `adc-prod-alert-<key>-v2` (`main.bicep:311`); the gate matches on the
`-alert-<key>` infix (`ObservabilityConventionTestsBase.cs:32`, 73), so the suffix does not break
the pairing.

### What the gate does not cover

The pairing is honest only about the alerts inside that parse window. Three more alerts are
provisioned outside it, so they are neither gated nor runbooked:

- `adc-prod-alert-outbox-dead-letter`, severity 2, fires on any `AppTraces` row matching
  `dead-lettered` (`main.bicep:408-413`, materialized at 422-454). Every hit means an integration
  event was permanently lost from a service's outbox.
- `adc-prod-alert-sql-dependency-failures`, severity 2, threshold 10 failed SQL dependency calls
  over 15 minutes (`main.bicep:414-419`).
- `adc-prod-alert-gateway-availability`, severity 1 (`main.bicep:496-520`), driven by the standard
  web test that pings the public Gateway `/health` from three Azure locations every 5 minutes with
  a 2-of-3 failed-location threshold (`main.bicep:463-494`).

Adding, renaming or re-tiering any of those cannot fail the build, and `OPERATIONS.md` carries no
`###` triage section for any of them, including the only Sev 1 alert in the system. Treat the
pairing gate as covering the three SLO alerts, not the alert surface as a whole.

### Recovery moves

`OPERATIONS.md:55-68` is the fast reference: roll a bad revision back with `az containerapp
revision list` / `revision copy`, follow `DISASTER-RECOVERY.md` for a database restore, re-run the
referenced workflow when a freshness gate blocks a deploy, and revert a conference-day surge when
`cost-guard.yml` fails. Its freshness quick-reference (`OPERATIONS.md:63-66`) names all three
windows and each one matches the workflow that enforces it: `dr-freshness` 8 days
(`deploy.yml:557`), `load-freshness` 35 days (`deploy.yml:614`), `cross-service-freshness` 5 days
(`deploy.yml:673`). Those numbers live in two places, so treat the workflow as the source of truth
and re-check the runbook line whenever a window moves: the cross-service window was widened from 3
to 5 days when that suite went weekday-nightly (`deploy.yml:671-672`), and the runbook text
followed separately.

---

## infra/SQL-MANAGED-IDENTITY.md, staged passwordless-SQL runbook

**File:** `MMCA.ADC/infra/SQL-MANAGED-IDENTITY.md`

**What it is.** The runbook for moving the four service apps from SQL-login (password) auth to
Entra managed-identity auth against their per-service databases, and the written acceptance of the
SQL data plane staying on public network access with no VNet.

**When to run.** Only when deliberately advancing that hardening. Nothing here is on the normal
deploy path: all three bicep knobs are default-safe, so a deploy with the defaults changes nothing
(`SQL-MANAGED-IDENTITY.md:8-9`).

[Rubric §11, Security] assesses credential hardening. **All three stages have been run in ADC
production.** The template default is still `false` (`main.bicep:36`), because that is what makes a
fresh environment start on password auth and each stage independently deployable, but the deployed
value comes from a repository variable, not the default: `deploy.yml:932` reads
`vars.USE_MANAGED_IDENTITY_SQL` and `deploy.yml:1065-1068` rewrites the parameter to `true` when it
is set. All three variables are set in `ivanball/ADC` (`USE_MANAGED_IDENTITY_SQL`,
`SQL_AAD_ADMIN_LOGIN` and `SQL_AAD_ADMIN_OID`, all dated 2026-06-28), so the deployed apps use
passwordless `Active Directory Managed Identity` connection strings. The ADC scorecard records the
same activation on that date, with all four services healthy and mapped `db_owner` in every
per-service database, which is what lifted §17 DevOps Implementation from 8 to 9. `OPERATIONS.md:46`
is therefore correct when it tells an on-call engineer that production runs passwordless SQL.

Note for a reader trying to verify this: the live value is repository configuration, not source, so
it cannot be confirmed from the tree. Reading `main.bicep:36` alone gives the opposite impression.
[ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html) records the
staging mechanism and describes the flag as not yet flipped, which was true when it was written.

### Why staged, and the three stages

The migration is staged because managed-identity auth needs a database user mapped to the identity
(`CREATE USER ... FROM EXTERNAL PROVIDER`), which is data-plane T-SQL that must run as an Entra
admin. The deploy principal holds Contributor, not SQL AAD-admin, so it cannot perform that grant.
Flipping the connection strings before the grants exist takes every app offline
(`SQL-MANAGED-IDENTITY.md:11-18`). Password auth keeps working at every step (dual-auth), so each
stage is independently deployable and reversible.

1. **Stage 1, add the Entra admin.** Set the `SQL_AAD_ADMIN_LOGIN` and `SQL_AAD_ADMIN_OID`
   repository variables; `deploy.yml:1054-1060` folds them into the bicep parameter file, and
   `main.bicep:612-621` provisions the AAD admin only when the object id is non-empty. Additive,
   zero app impact.
2. **Stage 2, grant the identity in each database** (`SQL-MANAGED-IDENTITY.md:56-68`). Connect to
   each of the four `ADC_*` databases as the Entra admin and run `CREATE USER
   [adc-prod-apps-identity] FROM EXTERNAL PROVIDER` plus `ALTER ROLE db_owner ADD MEMBER`.
   `db_owner` because each service is its own sole migrator and applies DDL at startup.
3. **Stage 3, flip the apps** (`SQL-MANAGED-IDENTITY.md:70-75`). Set `USE_MANAGED_IDENTITY_SQL=true`
   and deploy; `main.bicep:152` swaps the auth segment of every connection string to
   `Authentication=Active Directory Managed Identity` with the UAMI's client id and no password.

**Rollback** is unsetting the variable and redeploying (`SQL-MANAGED-IDENTITY.md:77-79`): the
password path is never removed in this wave, and the per-database users are inert when unused.

**Accepted risk (`SQL-MANAGED-IDENTITY.md:81-100`).** The SQL server keeps `publicNetworkAccess:
Enabled` and the `AllowAzureServices` rule, because there is no VNet and moving to a private
endpoint would require recreating the Container Apps environment (and therefore every container
app). The compensating controls are TLS 1.2 minimum, Key Vault secrets via the managed identity,
and, once stages 1 to 3 land, no shared SQL password at all.

---

## infra/POST-CUTOVER-atldevcon-downgrade.md, archive downgrade runbook

**File:** `MMCA.ADC/infra/POST-CUTOVER-atldevcon-downgrade.md`

**What it is.** A step-by-step runbook for the third and final commit of the database-per-service
rollout: downgrading `AtlDevCon` from S0 to Basic tier in `main.bicep`. This is a cost-reduction
step that must be taken only after the per-service databases have been proven in production. It
has already been applied (`main.bicep:629-643` declares the Basic SKU), so read it as the record
of how that was done and as the procedure to repeat after a DR rebuild.

**When to run.** After the per-service databases (`ADC_*`) have been running and verified for at
least 24 hours, `AtlDevCon` has had no new writes, and the outbox is fully drained.

[Rubric §31, Cost/FinOps] assesses whether cost is actively managed and right-sized. Downgrading
a now-idle database from S0 to Basic (5 DTU, 2 GB cap) once it becomes a static archive is the
operationalization of that principle.

[Rubric §8, Data Architecture] assesses data lifecycle and migration hygiene. Keeping `AtlDevCon`
in the Bicep declaration under a `// RETAINED, archived legacy database, data preserved. NEVER
delete.` comment (shown in the runbook, line 41) prevents out-of-band drift: the Bicep resource
is always the source of truth about the database's existence and configuration.

### Walkthrough

**Prerequisites (`POST-CUTOVER-atldevcon-downgrade.md:11-31`).** Three checks:
1. Confirm the flip is live and healthy, all four `adc-prod-*` apps serve from their `ADC_*`
   databases, `AtlDevCon` has had no writes for ≥24h, outbox is empty (`ProcessedOn IS NULL = 0`).
2. Confirm `AtlDevCon` fits in the 2 GB Basic cap using `az sql db list-usages`. At ~76 users /
   50 sessions / 53 speakers, it is far under the limit.
3. Export a permanent `.bacpac` archive before downgrading. Basic tier retains PITR for only 7 days
   (vs 35 days for S0), so a one-off export to blob storage is the last-resort point-in-time
   snapshot (`POST-CUTOVER-atldevcon-downgrade.md:24-31`).

**The Bicep change (`POST-CUTOVER-atldevcon-downgrade.md:33-53`).** Replace `sku` and `maxSizeBytes`
only on the `AtlDevCon` resource. The resource stays in `main.bicep`, Incremental mode would
not delete it if removed, but keeping it declared prevents out-of-band drift. The change is
`name: 'Basic', tier: 'Basic', capacity: 5` with `maxSizeBytes: 2147483648` (2 GB cap).

**Why Commit 3 is separate (`POST-CUTOVER-atldevcon-downgrade.md:8-9`).** If `main.bicep` carried
the Basic SKU when Commit 2 deployed (the app flip), `AtlDevCon` would be downgraded before the
new databases were proven. Separating the commits eliminates that risk.

**Deploy via the normal pipeline.** Merge the Bicep change and let `deploy.yml` apply it
(`POST-CUTOVER-atldevcon-downgrade.md:55`). No special workflow or manual `az sql db update`
command is needed, Incremental mode changes only the SKU, data is untouched.

**Verification (`POST-CUTOVER-atldevcon-downgrade.md:57-59`).** `az sql db show` confirms `sku.name
= Basic` and `maxSizeBytes = 2147483648`. A spot row-count query against `AtlDevCon` confirms data
is preserved.

**Rollback (`POST-CUTOVER-atldevcon-downgrade.md:61-64`).** Revert the Commit 3 change and
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
from the current UI. The `raw/` directory is gitignored because a capture can contain the signed-in
test user's data; only the composed `screenshots/` set is committed
(`store-assets/play-store/README.md:19-20`).

### Walkthrough

**Slug-based filenames (`play-store-capture.ps1:47-51`, written at line 106).** Raw captures are
saved as `<slug>.png` under `store-assets/play-store/raw/`, with the directory created on first
use. Deterministic names mean the compose script can look them up by slug key without a manifest
file.

**`-List` switch (`play-store-capture.ps1:53-65`).** Lists already-captured slots with file size
and timestamp, a quick sanity check before a composing session.

**`adb` resolution (`play-store-capture.ps1:67-75`).** Prefers `adb` on `PATH`; falls back to the
well-known SDK path (`C:\Program Files (x86)\Android\android-sdk\platform-tools\adb.exe`).

**`exec-out` not `shell screencap` (`play-store-capture.ps1:104-110`).** Uses `adb exec-out` to
stream the PNG binary directly into the output file. Plain `adb shell screencap` on Windows applies
CRLF translation to the binary stream, corrupting the PNG.

**Dimension read from IHDR (`play-store-capture.ps1:127-147`).** Reads the PNG IHDR chunk to print
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

**Lineup (`play-store-compose.ps1:52-61`).** Eight slots are defined inline with slug, caption
(large bold white text), and subtitle (smaller cyan text). The comment on line 51 notes that the
lineup must be kept in sync with `store-assets/play-store/README.md`, whose table
(`store-assets/play-store/README.md:42-51`) currently matches all eight slugs, captions and
subtitles exactly.

**Brand colors (`play-store-compose.ps1:69-71`).** Three colors: `brandTeal` (`#0D7377`),
`brandCyan` (`#14FFEC`), `brandTealDark` (`#094F52`). The canvas uses a vertical `LinearGradientBrush`
from teal to dark teal for depth.

**`System.Drawing.Common` assembly (`play-store-compose.ps1:39-42`).** The script loads
`System.Drawing.Common` (PowerShell 7 path) with a fallback to the desktop-FX alias on
Windows PowerShell 5.1.

**Fit-inside scaling (`play-store-compose.ps1:133-138`).** Each raw capture is scaled to fit inside
the available image area (`imageMaxW × imageMaxH`, computed from the canvas minus caption area and
footer) preserving aspect ratio, then centered horizontally and vertically. Captures taller than
9:16 (e.g. 9:20 Pixel emulator) are letterboxed on the teal background.

**Soft shadow and cyan border (`play-store-compose.ps1:140-152`).** A black rectangle offset 10 px
right and 14 px down at alpha 80 of 255 produces a drop shadow. A 2-px cyan (`brandCyan`) rectangle
borders the screenshot so it pops against the teal background.

**Output (`play-store-compose.ps1:175`).** Each composed PNG is saved as
`store-assets/play-store/screenshots/<slug>.png`. Upload these directly to Play Console → Main
store listing → Phone screenshots.

---

## Docs/MobileReleaseRunbook.md, store-submission runbook

**File:** `MMCA.ADC/Docs/MobileReleaseRunbook.md`

**What it is.** The manual, credential-holding steps around a store submission that code and CI
cannot perform, each tagged with when it must happen relative to the submission
(`MobileReleaseRunbook.md:3-5`). Its companion is `Docs/DeviceTestChecklist.md`, the physical-device
pass to re-run after any behavior-affecting bump.

**When to run.** Before a Play or TestFlight upload. The sections are independent; read the one
that matches the step you are on.

[Rubric §17, DevOps & Deployment] assesses whether the release path is documented end to end. The
mobile head is the part of ADC that CI cannot fully automate (signing keys, provisioning profiles,
store consoles), so the runbook is the substitute for a pipeline.

### The load-bearing items

**Android App Links fingerprint (`MobileReleaseRunbook.md:7-59`).** `/.well-known/assetlinks.json`
is served from `AppAssociation` config in `MMCA.ADC.UI.Web`, and Android verifies a link only when
both `package_name` and `sha256_cert_fingerprints` match the installed app. Two traps: the Release
android property group overrides the package id to `ivanball.AtlDevCon`
(`MMCA.ADC.UI.csproj:57-58`) while Debug installs as `com.ivanball.atldevcon`
(`MMCA.ADC.UI.csproj:29`), and the checked-in fingerprint is still a placeholder that must be
replaced with the **Play App Signing** certificate fingerprint, not the local upload keystore's
([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html) records the same open item).

**iOS associated domains (`MobileReleaseRunbook.md:61-75`).** `Entitlements.plist` now requests
`com.apple.developer.associated-domains`, which the existing App Store provisioning profile does
not carry, so the next Release build fails signing until the capability is enabled and the profile
regenerated. The AASA document must be live on the prod UI host before App Review.

**Release signing password (`MobileReleaseRunbook.md:77-81`).** Keystore passwords are not in the
csproj: `AndroidSigningKeyPass` and `AndroidSigningStorePass` read the
`ADC_ANDROID_SIGNING_PASSWORD` environment variable (`MMCA.ADC.UI.csproj:70-74`), which must be set
in the shell before any local Release android build.

**Two deliberately-off Bicep switches.** Native push is inert by design: the Notification Hub is
not provisioned (`main.bicep:110`, `deployNotificationHub` defaults false after ARM
`InternalServerError` failures blocked deploys on 2026-07-11) and delivery stays off
(`main.bicep:107`, `nativePushEnabled` false); section 5 of the runbook is the credentials
sequence. Avatar storage needs a one-time manual role grant because the deploy identity
deliberately lacks `roleAssignments/write` (`main.bicep:113`, `grantAvatarStorageRole` false);
until it is applied, avatar uploads fail cleanly with `FileStorage.UploadFailed`
(`MobileReleaseRunbook.md:116-138`).

**Play target API level (`MobileReleaseRunbook.md:148-198`).** A recurring annual deadline: from
2026-08-31 an update must target API 36 (Android 16) or higher. The level is pinned in the csproj
(`MMCA.ADC.UI.csproj:53-55`, `TargetPlatformVersion` 36.0) precisely so a build machine one Android
workload behind fails outright instead of quietly producing a rejectable AAB. Raising it is a
behavior change (API 35+ forces edge-to-edge layout), so the device checklist is re-run before
rollout.

---

## The database-per-service cutover in full context

The five database-related artifacts above form a single coherent story, and the resilience
artifacts extend it past the cutover:

| Step | Who runs it | Artifact |
|---|---|---|
| **Local dev setup**, copy legacy data into fresh per-service databases on the Aspire container | Developer | `migrate-atldevcon-to-per-service-dbs.ps1` → `.sql` |
| **Production one-time cutover**, gate, freeze, migrate, copy, verify | GitHub Actions (manual trigger) | `cutover-per-service-dbs.yml` → `copy-atldevcon-to-per-service-dbs.azure.ps1` |
| **Post-cutover archive downgrade**, lower `AtlDevCon` to Basic tier | Developer (Bicep PR + normal deploy) | `POST-CUTOVER-atldevcon-downgrade.md` |
| **Weekly recovery proof**, PITR-restore a throwaway copy and time it | GitHub Actions (weekly cron) + operator on demand | `dr-drill.yml` → `dr-restore-drill.ps1` |
| **Disaster recovery**, restore a database, roll back a deploy | On-call operator | `DISASTER-RECOVERY.md` |
| **Day-2 alert triage**, answer a page and pick the recovery move | On-call operator | `OPERATIONS.md` |

The `AtlDevCon` database is the thread that runs through all of them: it is the source of data
truth during the copy, the rollback path after the flip, and the last-resort archive in a
full-region DR scenario. That is why it is retained in `main.bicep` under a `// NEVER delete`
comment. It is no longer the drill target, though: the weekly rotation deliberately drills the four
live databases instead, and `AtlDevCon` is reachable only by manual dispatch.

Cross-links:
- [IaC chapter](devops-iac.md), `infra/main.bicep` provisions the four `ADC_*` databases, the LTR
  policies, the SLO alerts and workbook, and the Service Bus namespace.
- [CI/CD chapter](devops-cicd.md), `deploy.yml` applies per-module idempotent migration scripts,
  runs the post-deploy smoke gate, and carries the three recency gates (`dr-freshness`,
  `load-freshness`, `cross-service-freshness`); `cutover-per-service-dbs.yml` is a sibling workflow
  in the same `prod-azure` concurrency group.
- [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), the decision to adopt database-per-service,
  the trade-offs, and the `CrossDataSourceDegradeConvention` that removes cross-database FKs.
- [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html), the resilience and recovery
  objectives framework, including the requirement that `DISASTER-RECOVERY.md` exists and that the
  drill-result table is filled.
- [ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html), SLO alerting as code and
  the alert-to-runbook pairing gate that `infra/OPERATIONS.md` satisfies.
- [ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html), deploy preconditions as
  proof of recency, which is what turns the weekly drill into a production gate.
- [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html), the outbox pattern that the cutover workflow
  gates on (drain first) and that the per-service databases each own independently.

---

## Rubric tag summary

| Tag | Artifact(s) |
|---|---|
| §8 Data Architecture | [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), the SQL/PS copy scripts, POST-CUTOVER downgrade runbook |
| §11 Security | `azure-setup.sh` (UAMI / OIDC), `DISASTER-RECOVERY.md` (managed identity, Key Vault), `SQL-MANAGED-IDENTITY.md` (staged passwordless SQL, accepted public-network risk) |
| §13 Observability | `DISASTER-RECOVERY.md` (alert thresholds and severities), `OPERATIONS.md` (per-alert triage, build-gated pairing) |
| §17 DevOps & Deployment | `azure-setup.sh`, `cutover-per-service-dbs.yml`, copy scripts, `Docs/MobileReleaseRunbook.md` (the manual store-submission path) |
| §29 Resilience & Business Continuity | `DISASTER-RECOVERY.md` (RTO/RPO, PITR, LTR, restore runbook, drill record), `dr-drill.yml` + `dr-restore-drill.ps1` (the drill itself, gated for recency by `dr-freshness`) |
| §30 Compliance/Privacy | `play-store-capture.ps1`, `play-store-compose.ps1` |
| §31 Cost/FinOps | `POST-CUTOVER-atldevcon-downgrade.md` (S0 → Basic downgrade) |

---

## Not determinable from source

- **`ALERT_EMAIL` variable**: `DISASTER-RECOVERY.md:55-57` and `OPERATIONS.md:8-11` both route
  alert notifications through the `alertEmailAddress` action-group receiver fed by the
  `ALERT_EMAIL` repository Actions variable. Whether that variable is currently set in the
  `ivanball/ADC` repository is not determinable from the files; check Settings → Variables. If it
  is unset the rules still exist and fire in Azure Monitor, they simply email nobody.
- **Whether the newest weekly drill is green**: the drill ledger is maintained through 2026-08-10
  (`DISASTER-RECOVERY.md:151-158`), but `dr-drill.yml` runs every Monday and a run reaches the
  ledger only when an operator pastes the printed row back into `DISASTER-RECOVERY.md`. Any drill
  newer than the last ledger row exists only in the Actions history, which is exactly what
  `dr-freshness` queries (`deploy.yml:557`); it cannot be read from the repository.
- **S0 and Basic list prices**: the DTU counts are in source (`main.bicep:637` sets Basic capacity
  5), but the monthly costs are Azure list pricing, not a repository fact. Check the Azure pricing
  page before quoting a saving.
