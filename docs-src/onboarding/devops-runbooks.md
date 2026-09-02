# Operational Scripts & Runbooks

This chapter covers every operational script and runbook in `MMCA.ADC`: the one-time Azure
bootstrap, the database-per-service cutover story (how the legacy `AtlDevCon` monolith DB was split
into four per-service databases, and why its scripts no longer exist), the disaster-recovery
posture, the automated restore drill, the day-2 alert-triage runbook, the staged SQL
managed-identity migration, the archive-and-drop of the legacy database, the Play Store asset
pipeline, and the mobile store-submission runbook. For each artifact you will learn what it does,
when an operator runs it, a step-by-step walkthrough with line cites, and why each gate or design
choice exists. Architecture rubric categories are tagged inline; cross-links reach the IaC and CI/CD
chapters and the ADRs that recorded the underlying decisions.

> **Architectural context.** The database-per-service split ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) and the resilience/recovery
> posture ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)) are the two decisions that make this chapter necessary. Read both ADRs before
> running any of these scripts against production.

> **Which repo.** Every file cited here lives in `MMCA.ADC`. `MMCA.Store` ships same-named twins
> (`infra/DISASTER-RECOVERY.md`, `infra/OPERATIONS.md`, `infra/SQL-MANAGED-IDENTITY.md`,
> `.github/workflows/dr-drill.yml`, `scripts/dr-restore-drill.ps1`) with different contents. The
> quick tell: ADC's copies name the `acc-rg` resource group and the four `ADC_*` databases; Store's
> name `ib_rg`, `MMCAStore` and three `Store_*` databases
> (`MMCA.Store/infra/DISASTER-RECOVERY.md:19`, `:26`, `:39-40`). Reading the wrong one hands an
> operator the other application's recovery procedure.

> **What `scripts/` actually contains today.** Four files: `azure-setup.sh`,
> `dr-restore-drill.ps1`, `play-store-capture.ps1` and `play-store-compose.ps1`. The one-time
> cutover scripts and their workflow were deleted once the cutover completed (see the cutover
> section below), so do not go looking for them.

---

## azure-setup.sh, One-time Azure bootstrap

**File:** `MMCA.ADC/scripts/azure-setup.sh` (175 lines)

**What it is.** A bash script that creates every Azure identity and OIDC credential the GitHub
Actions deploy pipeline needs. It is idempotent: every step checks for existing state before
creating anything (`azure-setup.sh:12`, "Idempotent: safe to re-run").

**When to run.** Once per environment: when standing up a fresh Azure deployment for the first
time, or when rebuilding after a disaster recovery scenario where the identity objects were lost.
Never run it as part of a regular deploy; `deploy.yml` consumes the outputs but never re-runs this
script.

[Rubric §11, Security] assesses whether secrets are managed safely and whether OIDC / managed
identities replace long-lived credentials. This script is the bootstrap for that posture: it creates
a User-Assigned Managed Identity (UAMI) and federated GitHub OIDC credentials so the pipeline never
holds a client secret.

[Rubric §17, DevOps & Deployment] assesses whether the provisioning and deployment pipeline is
automated, repeatable, and documented. The bootstrap being a single idempotent script that also
prints its own post-run checklist (`azure-setup.sh:140-175`) is the embodiment of that principle.

### Walkthrough

**Configuration block (`azure-setup.sh:26-35`).** Hard-codes the target subscription
(`4513b073-3a04-4f5c-b272-bbcc329b2d49`), tenant (`c6369020-...`, QiMata Technologies), resource
group (`acc-rg`), location (`eastus2`), UAMI name (`mmca-adc-github-deploy`) and the GitHub
coordinates (org `ivanball`, repo `ADC`, branch `main`, environment `production`). Edit these before
running in a different environment. The inline comment at `azure-setup.sh:32` is the one that saves
an hour: the GitHub repo is named `ADC`, not `MMCA.ADC`, and an OIDC subject built from the wrong
repo name authenticates nothing.

**Why UAMI instead of an App Registration (`azure-setup.sh:6-10`).** AAD App Registration creation
is blocked in the QiMata tenant for non-admin users (`Graph Authorization_RequestDenied`). UAMIs are
ARM resources, so RG-level Contributor plus role-assignment rights is sufficient to create them. The
choice is forced by tenant policy, not preference.

**Resource group (`azure-setup.sh:43-47`).** `az group create` is a no-op when the group already
exists. The comment (`azure-setup.sh:40-42`) notes that `acc-rg` is shared with unrelated production
resources and that the create call is kept only for disaster recovery. That shared-RG fact is what
makes `mode=Complete` forbidden for every Bicep deploy in this repo: Complete mode deletes resources
absent from the template, which here would mean someone else's production.

**UAMI creation and ID retrieval (`azure-setup.sh:49-65`).** Creates the identity, then queries both
`clientId` (`azure-setup.sh:56-59`) and `principalId` (`azure-setup.sh:60-63`) and echoes them. The
`clientId` becomes the GitHub secret `AZURE_CLIENT_ID`; the `principalId` is what the role
assignments below key on.

**`assign_role` and the az-cli 2.84.x workaround (`azure-setup.sh:69-100`).** Azure CLI 2.84.x
returns a spurious `MissingSubscription` error on `az role assignment create` even when the write
succeeds (`azure-setup.sh:70-72`). The function therefore hits the ARM REST API directly with
`az rest PUT` (`azure-setup.sh:89-98`). It also checks for an existing assignment first (an
`az rest GET` plus a JMESPath filter, `azure-setup.sh:81-87`), so a re-run is a no-op rather than a
duplicate grant.

**Role assignments (`azure-setup.sh:102-105`).** Two roles are granted to the UAMI at RG scope:
- `Contributor` (GUID `b24988ac-...`), which deploys ARM/Bicep and manages Container Apps, SQL and
  the rest.
- `AcrPush` (GUID `8311e382-...`), which pushes container images. The ACR admin user is disabled
  (`DISASTER-RECOVERY.md:67-68`), so the UAMI's `AcrPush` is the only image-push path that exists.

Note what is deliberately absent: `Microsoft.Authorization/roleAssignments/write`. That omission is
a least-privilege decision with a visible downstream consequence, the avatar-storage grant has to be
applied by hand (`main.bicep:125-126`, and section 6 of the mobile runbook below).

**Federated credentials (`azure-setup.sh:107-138`).** Two OIDC federated credentials are created on
the UAMI through `create_or_replace_fic`, which skips creation when the credential already exists
(`azure-setup.sh:116-122`):
- `github-env-production`, subject `repo:ivanball/ADC:environment:production`. The deploy job runs
  with `environment: production`, which is the subject GitHub mints.
- `github-ref-main`, subject `repo:ivanball/ADC:ref:refs/heads/main`. The fallback for workflow runs
  that do not bind to an environment.

Both are pinned to issuer `https://token.actions.githubusercontent.com` and audience
`api://AzureADTokenExchange` (`azure-setup.sh:129-131`). The subject string is the entire security
boundary here: it is why a fork, or any other repo, cannot mint a token Azure will accept.

**Post-run checklist (`azure-setup.sh:140-175`).** The script prints everything the operator must
still do by hand: create the GitHub environment, add six required secrets (`AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `SQL_ADMIN_PASSWORD`, `JWT_RSA_PRIVATE_KEY_PEM`,
`JWT_RSA_PUBLIC_KEY_PEM`), one required variable (`AZURE_RESOURCE_GROUP`), then the optional secrets
(`OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `SMTP_PASSWORD`) and
optional variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME`). There is no HS256
fallback signing key in that list: RS256 is the only signing path, which is why both RSA PEMs are
listed as required and `deploy.yml:1143-1149` fails the run when either is missing.

**One gap to know about before your first deploy.** The checklist never mentions `ALERT_EMAIL`, but
`main.bicep:115-117` declares `alertEmailAddress` as a required parameter with `@minLength(3)` and
no default (alerts that notify nobody are silent failures), and `deploy.yml:1138-1141` refuses the
run with an actionable error when `vars.ALERT_EMAIL` is unset. Follow the printed checklist exactly
and the first deploy stops there. Set `ALERT_EMAIL` as well.

---

## The database-per-service cutover, and why its scripts are gone

Before the surviving artifacts make sense, the story behind them does.

**Before [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html).** All four modules (`Identity`, `Conference`, `Engagement`, `Notification`)
pointed at a single shared SQL database called `AtlDevCon`. That caused an outbox race: every
service's `OutboxProcessor` polled the same `dbo.OutboxMessages` table and could claim another
service's rows, producing duplicate dispatch (the defect documented in [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), fixed 2026-06-07).

**The [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) decision.** Adopt database-per-service. Each service owns `ADC_Identity`,
`ADC_Conference`, `ADC_Engagement` or `ADC_Notification`, locally on the Aspire SQL container and in
Azure as four Basic-tier databases on the same SQL server, generated from a single
`serviceDatabaseNames` array (`main.bicep:656-679`, Basic 5 DTU with a 2 GB cap each). Cross-service
references become scalar IDs (no cross-database foreign keys); `CrossDataSourceDegradeConvention`
removes FK constraints at the EF level; consistency flows through the outbox and broker
([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).

[Rubric §8, Data Architecture] assesses data modeling quality, isolation, and whether services own
their own schema. The per-service database design addresses this directly: each service has its own
schema, its own migrations project
(`Source/Hosting/MMCA.ADC.Migrations.SqlServer.{Identity,Conference,Engagement,Notification}`), and
its own `dbo.OutboxMessages`, so no service ever sees another's rows. The template states the
ownership rule as an invariant rather than a convention: each service is the sole migrator of
exactly one of these databases, and adding a service means adding its name to that array
(`main.bicep:651-654`).

**The three-commit rollout, and what remains of it.** The Azure cutover was structured as three
commits to prevent data loss: commit 1 provisioned the four `ADC_*` databases empty while the apps
kept reading `AtlDevCon`; a one-time manual workflow then migrated and copied the data with
row-count verification; commit 2 flipped the container-app connection strings; commit 3 downgraded
`AtlDevCon` to the Basic archive SKU.

All of it landed, and the finished state is what the template now declares:

- Per-service connection strings are built once from a shared base and injected per app
  (`main.bicep:160-174`), reaching each container app as a Key Vault secret reference
  (`main.bicep:1076` is Identity's `DataSources__Identity__SQLServerConnectionString`).
- The comment at `main.bicep:160-163` records the invariant plainly: each service connects only to
  its own database, and `AtlDevCon` is no longer referenced by any app.
- Those four databases are now the whole application data estate, and the template says so in as
  many words (`main.bicep:651-654`).

**`AtlDevCon` itself is gone (2026-09-02).** The archive database that the cutover left behind was
exported to the bacpac blob `sql-archive/AtlDevCon-20260902.bacpac` in storage account
`adcprodstpys4way4uzb3g`, then dropped by hand, and its `sqlDatabase` resource was removed from the
template. What sits at `main.bicep:635-647` today is a comment block, not a resource: it records the
drop, names the blob, and gives the restore path (`az sql db import`, about ten minutes). Reading
that block is the fastest way to learn that the "NEVER delete" instruction older documents carry was
deliberately superseded rather than forgotten. The archive-downgrade section below walks the full
sequence.

The same comment block carries a warning worth internalizing before you touch anything in `acc-rg`:
an unrelated **SQL server** named `atldevcon` in westus2 lives in this shared resource group, it
predates MMCA, and it has never hosted an ADC database (`main.bicep:645-647`, repeated at
`POST-CUTOVER-atldevcon-downgrade.md:123-128`). It is not the archive and must never be referenced,
scaled or deleted as if it were. ADC's SQL server is `adc-prod-sql-<token>`.

**The cutover scripts were deleted on purpose (2026-08-30, commit `6323a7b9`).** Four artifacts this
chapter used to walk step by step no longer exist in the tree:
`.github/workflows/cutover-per-service-dbs.yml`,
`scripts/copy-atldevcon-to-per-service-dbs.azure.ps1`,
`scripts/migrate-atldevcon-to-per-service-dbs.ps1` and
`scripts/migrate-atldevcon-to-per-service-dbs.sql`. They were single-use tooling whose own guard
rails made a second run wrong rather than merely redundant: the copy skipped any target table that
already had rows, so a run after the flip would silently do nothing while reporting success. Keeping
a dangerous single-use script in `scripts/` invites exactly that run. If a DR rebuild ever needs
them, recover them from git history at that commit rather than reconstructing them from memory.

[Rubric §34, Architecture Governance] assesses whether the repository's contents reflect current
policy rather than accumulated history. Deleting spent one-time tooling, and then retiring the
archive database it produced once a bacpac served the same purpose, is that principle applied twice:
first to `scripts/`, then to `main.bicep`. Note the ordering the template records
(`main.bicep:640-641`): Incremental mode never deleted the database when the declaration left the
template, so removing the resource and dropping the database were two separate, deliberate acts.

---

## infra/DISASTER-RECOVERY.md, DR runbook

**File:** `MMCA.ADC/infra/DISASTER-RECOVERY.md` (182 lines; not the Store file of the same name)

**What it is.** The authoritative disaster-recovery runbook for the ADC production environment.
Mandated by [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html): every consuming app must declare RTO/RPO per failure scenario, document the
backup/restore mechanism, accept single-region risk in writing, and record restore drills in a
drill-result table that cannot stay empty.

**When to consult.** On any data-loss event, corruption, failed deployment, or region outage. Also
consult it when changing backup or retention settings, to see what the targets are. Day-2 alert
triage (what to do when an SLO alert fires) is the companion `infra/OPERATIONS.md`, not this file
(`OPERATIONS.md:3-6`).

Cross-link: see the [IaC chapter](devops-iac.md) for how `infra/main.bicep` provisions the LTR
policies and alerts, and the [CI/CD chapter](devops-cicd.md) for the deploy rollback mechanism and
the freshness gates.

[Rubric §29, Resilience & Business Continuity] assesses whether the system has documented RTO/RPO
targets and a drilled restore procedure. The DR file addresses both: the objectives table
(`DISASTER-RECOVERY.md:10-14`) and a maintained drill ledger of six rows
(`DISASTER-RECOVERY.md:158-165`), whose newest entry is a PITR restore of `ADC_Conference` on
2026-08-10 that completed in 2.1 min against the 2 h RTO and came back Online. The status block
(`DISASTER-RECOVERY.md:167-172`) reads that ledger as a rotation rather than as a single success:
every `ADC_*` database now carries a recovery proof, and the number it quotes is the **slowest**
measured restore in the rotation (4.4 min), not the fastest. A second status paragraph is retained
for the record (`DISASTER-RECOVERY.md:174-182`); it closes TD-10 on the strength of the original
2026-06-20 drill plus the Polly fault-injection tests in MMCA.Common and the Azure Monitor SLO
workbook (`main.bicep:542-547`, the `sloWorkbook` resource embedding
`infra/workbooks/adc-slo-workbook.json`).

[Rubric §11, Security] assesses credential hardening. The managed-identity section
(`DISASTER-RECOVERY.md:63-90`) documents the out-of-band bootstrap for the `adc-prod-apps-identity`
UAMI, the Key Vault (`adckv<resourceToken>`, RBAC-authorized) and both role grants (Secrets User for
the apps, Secrets Officer for the deploy identity). The ACR admin user is disabled; runtime secrets
reach the container apps as `keyVaultUrl` references, so no plaintext secrets exist in Container App
environment variables. What lives in that vault is worth reading in full
(`DISASTER-RECOVERY.md:79-83`): the SQL and Service Bus connection strings, the RSA/JWT keys, the
SMTP, OAuth and Anthropic secrets, and the gateway synthetic-traffic key that lets the k6 load test
bypass rate limiting. The bootstrap is out-of-band for the same least-privilege reason the avatar
grant is: the deploy identity has Contributor but not role-assignment write, so `main.bicep`
references the identity as `existing` rather than creating it (`DISASTER-RECOVERY.md:68-70`).

### Three passages that have drifted from the template

Read these with the bicep open, because the runbook prose is behind the code in three specific
spots. Nothing here makes the runbook unusable, but each one would mislead a first responder.

**Alert resource type and cadence (`DISASTER-RECOVERY.md:49-51`).** The prose says "three SLO
**metric** alerts scoped to the App Insights component ... evaluated every 5 min over a 15-min
window". Two things moved. The live rules are KQL log-search alerts: `sloAlertSpecs`
(`main.bicep:302-330`) materialized as `scheduledQueryRules` named `adc-prod-alert-<key>-v2`
(`main.bicep:332-378`) and scoped to the Log Analytics workspace, not to the App Insights component.
And the cadence is now 15 minutes, not 5: `evaluationFrequency: 'PT15M'` beside the unchanged
`windowSize: 'PT15M'` (`main.bicep:350-351`). The thresholds in the table
(`DISASTER-RECOVERY.md:53-57`) are still correct.

The cadence change is a deliberate FinOps trade and the template shows its arithmetic
(`main.bicep:345-349`): a scheduled-query rule is billed per evaluation, and the 5-minute tier costs
about $1.47/month per rule against about $0.50 at 15 minutes, across three rules. Because
`windowSize` was already `PT15M`, each evaluation still looks at the same 15 minutes of data, so no
threshold changed; what disappeared is the overlap between consecutive evaluations. The one metric
alert that remains is the Sev 1 gateway-availability rule (`main.bicep:503-532`), kept deliberately
because availability has no status-code confound and never produced a false page
(`main.bicep:380-381`).

[Rubric §13, Observability] assesses alerting and monitoring. The three SLO signals, their
thresholds and their severities are: failed requests count above 10 (sev 2, `main.bicep:303-311`),
average server response time above 3000 ms (sev 3, `main.bicep:312-320`), and dependency failures
count above 10 (sev 2, `main.bicep:321-329`). The queries carry tuning a metric alert could not
express: 401 and 499 responses are excluded from the failure counts, and SignalR hub connections are
excluded from the average-duration rule because a hub reports its connection lifetime as request
duration (`main.bicep:288-301`). The template names the exact incidents that forced each exclusion,
which is the right level of evidence for a change that loosens an alert. Per-alert triage lives in
`infra/OPERATIONS.md` below.

**`ALERT_EMAIL` is no longer optional (`DISASTER-RECOVERY.md:59-61`).** The runbook says the rules
are created and visible in Azure Monitor even without the variable, "they just don't email". That
state is no longer reachable: `alertEmailAddress` is a required parameter with `@minLength(3)` and
no default (`main.bicep:115-117`), the action group's email receiver is unconditional
(`main.bicep:269-286`), and `deploy.yml:1138-1141` fails the deploy before bicep validation when
`vars.ALERT_EMAIL` is unset. An alert that notifies nobody is now impossible in a deployed
environment by construction, which is the stronger version of what the runbook was aiming at.

**Deploy rollback description (`DISASTER-RECOVERY.md:113-115`).** The runbook describes the
post-deploy smoke gate as Gateway `/health` plus `/.well-known/jwks.json` plus the UI root. The live
gate is broader in both dimensions: a revision-activation gate that requires the newest revision of
every app to report Healthy, Running and 100% traffic weight, followed by six probes that reach
every service through the Gateway (`deploy.yml:1318-1339` for the reasoning,
`deploy.yml:1407-1418` for the probes). The activation gate exists because the HTTP probes alone
cannot prove the new code is serving: a healthy Gateway keeps answering from the previous backend
revision when the new one never goes ready, which is exactly how a readiness regression stayed
hidden for four days (`deploy.yml:1326-1330`). The rollback mechanism the runbook names,
`az containerapp revision copy`, is still what runs (`deploy.yml:1462`).

### Recovery objectives

The DR file targets three failure scenarios (`DISASTER-RECOVERY.md:10-14`):

| Scenario | RPO | RTO |
|---|---|---|
| Accidental data loss / bad migration (within the retention window) | about 10 min | 2 h |
| Single service DB corruption | about 10 min | 1 h (PITR restore-as-new, swap name) |
| Full region loss | 1 h (geo-redundant backup replication lag) | 4 h (geo-restore plus redeploy) |

These are deliberately modest: ADC is a regional, non-24x7 conference app. Sub-hour multi-region
failover is explicitly not a goal (`DISASTER-RECOVERY.md:16-17`).

### Accepted single-region risks

`DISASTER-RECOVERY.md:19-34` lists three knowingly-accepted single points of failure. Note the
topology it records (`DISASTER-RECOVERY.md:21-23`): one resource group (`acc-rg`), apps in the RG's
region, and the SQL server in `sqlLocation` (westus2) because the QiMata Sponsorship subscription
blocks new SQL servers in eastus2. That split is a bicep parameter, not an accident
(`main.bicep:12-14`).

- One Azure SQL server, `publicNetworkAccess: Enabled` with the Azure-services firewall rule
  (`main.bicep:596-616`), mitigated by geo-redundant PITR and LTR. This is also where the runbook
  records the archive change: the `AtlDevCon` database that used to be the standing rollback copy is
  now a bacpac blob instead, restorable with `az sql db import` in about ten minutes
  (`DISASTER-RECOVERY.md:25-30`).
- One Container Apps environment, all apps `minReplicas: 1`. A zonal outage drops the app until
  Azure reschedules. Conference-day scale-up is the documented mitigation and is applied only when
  warranted (the 2026 ADC load of about 67 peak concurrent did not warrant it).
- One Service Bus namespace (Standard) and one ACR.

### Backup posture

Two tiers (`DISASTER-RECOVERY.md:36-45`), plus the archive blob that now sits outside both:
- **PITR**: the Basic tier's 7 days of point-in-time restore on geo-redundant storage (the Azure
  default). Covers the "undo the last bad change" case with an RPO of minutes.
- **LTR**: long-term retention on all four live per-service databases, weekly P4W, monthly P12M and
  yearly P1Y at week 1, declared as the `serviceDatabaseLtr` resource (`main.bicep:686-697`).
- **The archive bacpac**: `sql-archive/AtlDevCon-20260902.bacpac`. Because the archive is a blob and
  not a database, it is outside PITR and LTR by design, and both the runbook and the template say so
  (`DISASTER-RECOVERY.md:43-45`, `main.bicep:681-685`). Its durability is now blob-storage
  durability, and recovering it is an import into a new database name, not a point-in-time restore.

### Recovery procedures

**Single database PITR restore (`DISASTER-RECOVERY.md:94-99`).** Restore to a new name, validate,
then rename or repoint via a redeploy. The worked example uses `ADC_Conference`.

**LTR restore (`DISASTER-RECOVERY.md:101-106`).** List available backups with
`az sql db ltr-backup list`, then restore with `az sql db ltr-backup restore`.

**Full region loss (`DISASTER-RECOVERY.md:108-111`).** The deploy pipeline is region-parameterized
(`sqlLocation` plus the RG location), so recovery is: create a new RG in a healthy region,
geo-restore each `ADC_*` database there, then re-run `deploy.yml` pointed at the new RG. The
`AtlDevCon` bacpac is the last-resort source of record for pre-cutover data, and the runbook is
explicit that it must be imported into a **new** database name so a restore can never collide with a
live `ADC_*` database.

### Restore drill

`DISASTER-RECOVERY.md:122-144` defines the drill: PITR-restore a throwaway copy, confirm it comes
back Online, record the measured restore time, then delete the copy. Only a copy is ever created, so
the live databases are never touched. The file documents three ways to run it
(`DISASTER-RECOVERY.md:128-136`) and names the scheduled one as the enforcing path:

- **Scheduled** (`DISASTER-RECOVERY.md:128-131`), the weekly cron, which rotates across the four
  live per-service databases by ISO week number so each earns a recovery proof roughly monthly. The
  retired `AtlDevCon` archive was never in the rotation and no longer exists as a database at all.
- **One-click** (`DISASTER-RECOVERY.md:132-135`), the `dr-drill.yml` workflow's manual
  `workflow_dispatch`, for a chosen database (the four live `ADC_*` databases, defaulting to
  `ADC_Identity`) and a chosen point in time. It prints the drill-result row in the job summary,
  ready to paste into the ledger.
- **Local / CLI** (`DISASTER-RECOVERY.md:136`), `pwsh ./scripts/dr-restore-drill.ps1
  -SourceDatabase ADC_Conference` after `az login`.

All three wrap the same `az sql db restore`, verify, `az sql db delete` sequence
(`DISASTER-RECOVERY.md:138-144`); there is no `sqlcmd` anywhere in the drill path.

The stated SLO is at least one successful drill per release train and after any backup or retention
change, with the restore completing inside the 2 h RTO; a missed or failed drill is called a
release-blocking regression for §29 (`DISASTER-RECOVERY.md:146-148`). The drill-result table
(`DISASTER-RECOVERY.md:158-165`) is where that claim is cashed, and it carries six rows:

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
ever had (`DISASTER-RECOVERY.md:150-156`). Each row also carries its `dr-drill.yml` run id, so every
claim in the ledger is traceable to an Actions run instead of resting on the author's word. The
spread is the other lesson: the same `ADC_Identity` database restored in 1.8 min in July and 4.4 min
in August, which is why the status block quotes the slowest number against the 2 h RTO
(`DISASTER-RECOVERY.md:167-172`). A ledger that keeps growing is what makes a claim like "restores
take about two minutes" falsifiable; a single row cannot show variance at all. The same note
(`DISASTER-RECOVERY.md:154-156`) records that rows naming `AtlDevCon` are kept as history now that
the archive is gone, rather than being edited out.

The ledger stays honest because it is gated, not remembered: `dr-freshness` fails a deploy when the
newest successful `dr-drill.yml` run is older than 8 days (`deploy.yml:707`,
`DISASTER-RECOVERY.md:170-172`). The rotation itself is prose here but arithmetic in the workflow,
which is the source of truth. The next section walks it.

---

## dr-drill.yml and dr-restore-drill.ps1, the ADR-009 restore drill

**Files:** `MMCA.ADC/.github/workflows/dr-drill.yml` (81 lines),
`MMCA.ADC/scripts/dr-restore-drill.ps1` (101 lines)

**What it is.** The automation behind the drill requirement above: the workflow picks a target
database and logs in to Azure via OIDC, the PowerShell script does the restore, the timing, the
verification and the cleanup, and prints a drill-result row ready to paste into
`infra/DISASTER-RECOVERY.md` (`dr-restore-drill.ps1:3-6`).

**When it runs.** Both on a schedule and on demand, and the scheduled half is the one that carries
the §29 weight:

- **Weekly cron**, Mondays 06:00 UTC (`dr-drill.yml:31-33`). This is the enforcing path: a
  throwaway-copy restore is cheap and is deleted immediately after, so recovery is proven
  continuously rather than whenever somebody remembers (`dr-drill.yml:7-8`).
- **`workflow_dispatch`** (`dr-drill.yml:15-30`) for an ad-hoc drill against a specific database and
  restore point. The dispatch default is `ADC_Identity` with a 10-minutes-ago restore point.

The job holds `id-token: write` plus `contents: read` and nothing else (`dr-drill.yml:35-37`), which
is the least privilege an OIDC login needs, and it logs in with the same three `AZURE_*` secrets
`azure-setup.sh` printed (`dr-drill.yml:46-51`).

Scheduled runs **rotate** across the four live per-service databases by ISO week number modulo 4
(`dr-drill.yml:53-72`, the arithmetic at `dr-drill.yml:65-68`), so each live database gets a recovery
proof roughly monthly. Which branch runs is decided purely by whether the dispatch input is present
(`dr-drill.yml:59`), which is what lets one job serve both triggers. The chosen database is echoed
into the step summary before the drill starts (`dr-drill.yml:72`), so a reader of a failed run knows
immediately which database was under test.

**`AtlDevCon` is gone from both ends of this pair.** The dispatch `choice` input now offers only the
four live databases (`dr-drill.yml:22-26`), and the script's own `-SourceDatabase` default moved from
`AtlDevCon` to `ADC_Identity` (`dr-restore-drill.ps1:26`). Both files record why: the archive was
exported to a bacpac and dropped on 2026-09-02, so its recovery path is `az sql db import` from that
blob, not PITR (`dr-drill.yml:10-13`, `dr-restore-drill.ps1:10-12`). Leaving it selectable would have
offered an operator a drill that fails for a reason unrelated to recoverability, and that failure
would then have blocked the next production deploy through `dr-freshness`. The older argument still
holds too: proving a retired archive restores proves nothing about the databases that take writes.

[Rubric §29, Resilience & Business Continuity] is what this workflow serves: it converts the DR
runbook from a document into a measurement.

### Walkthrough of the script

**Parameters (`dr-restore-drill.ps1:23-30`).** `-ResourceGroup` (default `acc-rg`),
`-SourceDatabase` (default `ADC_Identity`), `-RestorePointMinutesAgo` (default 10), `-KeepCopy`, and
`-SummaryPath` (the workflow passes `$env:GITHUB_STEP_SUMMARY`, `dr-drill.yml:74-81`). The workflow
never leans on the default: it always passes an explicit `-SourceDatabase` from the rotation step, so
the default only matters to a local CLI run.

**Server discovery (`dr-restore-drill.ps1:40-44`).** Queries by name prefix (`adc-prod-sql-*`) rather
than hard-coding the resource-token suffix, and throws a clear "Did you run 'az login'?" error when
nothing matches. Resolving from live Azure state is what lets the same script work against a rebuilt
environment whose token differs.

**Stale-copy cleanup (`dr-restore-drill.ps1:52-57`).** Deletes any `<SourceDatabase>-drill` left by a
previous run, so the restore name is free. Without it, one crashed run would fail every subsequent
drill on a name collision, and the freshness gate would then start blocking deploys for a reason
that has nothing to do with recoverability.

**Restore and timing (`dr-restore-drill.ps1:59-66`).** A stopwatch brackets `az sql db restore`, and
`$LASTEXITCODE` is checked explicitly (`dr-restore-drill.ps1:65`) because a failing `az` call does
not by itself throw in PowerShell. That elapsed time IS the measured RTO reported in the drill row;
it is not an estimate.

**Verification (`dr-restore-drill.ps1:68-76`).** ARM-level: `az sql db show --query status` must read
`Online`, otherwise the drill is a FAIL. A deeper row-count check is deliberately out of scope and
needs `-KeepCopy` plus a manual pass (`dr-restore-drill.ps1:18-21`).

**Cleanup (`dr-restore-drill.ps1:83-88`).** The delete sits in a `finally` block, so the throwaway
copy is removed even when the restore or the verification threw. This is the line that keeps a
weekly drill from accreting paid databases.

**Result row and exit code (`dr-restore-drill.ps1:90-101`).** Prints the markdown table row (date,
source, PASS/FAIL, minutes, note) to both the console and the job summary through the `Write-Line`
helper (`dr-restore-drill.ps1:35-38`), then exits 1 on anything other than PASS
(`dr-restore-drill.ps1:101`), so a failed drill is a failed workflow run and therefore a stale
recovery proof.

### What it does not do, and the gate that makes it matter

The drill never touches a live database and it does not gate production directly. The link to
production is the age of its newest successful run: `deploy.yml`'s `dr-freshness` job
(`deploy.yml:699-749`) reads the Actions API for the latest successful `dr-drill.yml` run
(`deploy.yml:734-736`) and fails the deploy when that run is older than the 8-day window
(`deploy.yml:707`, compared at `deploy.yml:745-748`), or when there is no successful run at all
(`deploy.yml:737-740`). The comment at `deploy.yml:732-733` records why the gate can trust the run
list at face value: `dr-drill.yml` has no skip-if-unchanged guard, so every successful run really
performed a PITR restore.

`dr-freshness` sits in `deploy.needs` alongside `load-freshness` and `cross-service-freshness`
(`deploy.yml:1054`), and the deploy's condition requires all three to have concluded `success`
(`deploy.yml:1087-1089`). Break-glass exists but is deliberately expensive to use: the
`skip_freshness_gates` input is honored only with a non-empty `skip_justification`, and the run
refuses without one (`deploy.yml:717-721`), then writes the justification into the step summary and
raises a workflow warning (`deploy.yml:722-729`).

The operational consequence for an on-call reader: **a red or skipped weekly drill blocks the next
production deploy.** If a deploy fails on `dr-freshness`, the fix is to re-run `dr-drill.yml` (and
fix it first if it genuinely failed), not to bypass it. The gate's full mechanics, the break-glass
input and the two sibling gates are documented in the [CI/CD chapter](devops-cicd.md); the decision
is [ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html).

---

## infra/OPERATIONS.md, day-2 alert triage runbook

**File:** `MMCA.ADC/infra/OPERATIONS.md` (207 lines)

**What it is.** The alert-to-action companion to the provisioned observability: what to do when each
alert fires, how to read the SLO workbook, the standard recovery moves, and why production has no
Aspire dashboard. It explicitly defers restore procedure, RTO/RPO and accepted SPOFs to
`DISASTER-RECOVERY.md` and covers day-2 triage only (`OPERATIONS.md:3-6`).

**When to consult.** When an alert email arrives from the `adc-prod-alerts-*` action group
(`main.bicep:272-286`), whose only receiver is the address in the `ALERT_EMAIL` repository variable
(`OPERATIONS.md:8-11`).

[Rubric §13, Observability & Operability] assesses whether alerts lead anywhere. A threshold with no
runbook is a page nobody knows how to answer, which is exactly what this file, and the build gate
below, exist to prevent.

### The pairing rule, enforced at build time

`ObservabilityConventionTestsBase` (in the `MMCA.Common.Testing.Architecture` package) pairs the
alerts declared in the consumer's bicep against the runbook sections in its `OPERATIONS.md`. ADC
subclasses it with nothing but an identity
(`Tests/Architecture/MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7`), and wires it by
embedding both files as manifest resources named `infra.main.bicep` and `infra.OPERATIONS.md`
(`MMCA.ADC.Architecture.Tests.csproj:17-22`). The base resolves those resources from the *derived*
type's assembly (`ObservabilityConventionTestsBase.cs:51`), which is the detail that lets one shared
rule body serve every consumer repo. Three facts run:

1. **Non-vacuous floor** (`ObservabilityConventionTestsBase.cs:53-61`): at least
   `MinimumAlertSpecs` alerts must parse out of the bicep, defaulting to 3
   (`ObservabilityConventionTestsBase.cs:39`). If the parse anchors drift, the gate fails loudly
   instead of passing with zero discovered alerts.
2. **Forward direction** (`ObservabilityConventionTestsBase.cs:63-89`): every discovered alert key
   must have a `### ...-alert-<key>` heading in `OPERATIONS.md`, and that heading must carry the
   alert's current severity as the literal text `(sev N)`
   (`ObservabilityConventionTestsBase.cs:80-84`). Re-tiering an alert in bicep without touching its
   runbook heading fails the build.
3. **Reverse direction** (`ObservabilityConventionTestsBase.cs:91-103`): a runbook section for an
   alert bicep no longer provisions is an orphan and also fails the build.

The parse window is the text between `var sloAlertSpecs` and `resource sloAlerts`
(`ObservabilityConventionTestsBase.cs:109-114`), which in ADC's bicep is `main.bicep:302` through
`main.bicep:332`. That window is clean: it holds exactly the three live keys and their three
severities and nothing else, so the gate discovers three specs. The base also asserts that the key
count and the severity count match (`ObservabilityConventionTestsBase.cs:117`), which is what catches
a change to the spec *shape* rather than to the specs.

ADC's three `###` sections are `adc-prod-alert-failed-requests-v2` (sev 2, `OPERATIONS.md:15`),
`adc-prod-alert-server-response-time-v2` (sev 3, `OPERATIONS.md:29`) and
`adc-prod-alert-dependency-failures-v2` (sev 2, `OPERATIONS.md:42`). The headings carry the same
`-v2` suffix the provisioned rules use (`main.bicep:336`), and that suffix is itself load-bearing:
`main.bicep:334-335` warns that `-v2` is part of the rule's identity in Azure, so renaming it would
create a second rule beside the live one instead of updating it. The gate matches on the
`-alert-<key>` infix (`ObservabilityConventionTestsBase.cs:32`, `:73`), so the suffix does not affect
the pairing either way.

### The operational alerts, and why their headings use four hashes

Three further alerts are provisioned outside the gated window, and all three have triage sections
(`OPERATIONS.md:55-148`). The section preamble (`OPERATIONS.md:57-63`) explains the heading depth,
and it is worth understanding rather than copying: the gate's heading regex is `^###\s+.*$`
(`ObservabilityConventionTestsBase.cs:145`), so a `####` heading does not match it at all. That makes
these sections invisible to both directions of the gate. Promoting one to `###` would break the build
immediately, because the reverse-direction fact would see a runbook section for an alert
`sloAlertSpecs` does not provision and call it an orphan.

- **`adc-prod-alert-outbox-dead-letter`** (sev 2, `OPERATIONS.md:65-98`) fires on any `AppTraces` row
  matching `dead-lettered` (`main.bicep:403-408`, materialized at `main.bicep:423-455`). The
  threshold is 0, meaning first hit rather than a rate, because every hit is an integration event
  permanently lost from a service's outbox. The runbook makes the reason explicit
  (`OPERATIONS.md:67-70`): the true "stuck outbox" signal is row age, which is DB-side and not
  queryable from Log Analytics, so this Error line has to serve as the backlog alarm as well as the
  loss alarm. The triage walks type-resolution failures (with the seven live `[EventName]` contracts
  listed at `OPERATIONS.md:79-82`), broker rejection, and consumer-side handler failure, then warns
  that replay is manual and that production's 300-second outbox poll (`main.bicep:1083`,
  `OPERATIONS.md:94-97`) means waiting five minutes before concluding a reset did not take.
- **`adc-prod-alert-sql-dependency-failures`** (sev 2, `OPERATIONS.md:100-124`), threshold 10 failed
  SQL dependency calls over 15 minutes (`main.bicep:409-414`). Its value over the general
  dependency-failures SLO is attribution: every service owns exactly one database, so a burst names a
  service and a database instead of "some dependency" (`OPERATIONS.md:102-104`). The last step
  (`OPERATIONS.md:122-124`) is the one that saves an incident: do not restart the service, because
  production sets `DatabaseInitStrategy=Migrate` and each service is the sole migrator of its own
  database, so a restart re-runs startup migrations against the same unreachable server and turns a
  read outage into a failed revision.
- **`adc-prod-alert-gateway-availability`** (sev 1, `main.bicep:503-532`, `OPERATIONS.md:126-148`) is
  driven by the standard web test that pings the public Gateway `/health` from three Azure locations
  with a 2-of-3 failed-location threshold (`main.bicep:470-501`). It is the only outside-in signal in
  the deployment, which is exactly why it is Sev 1: every other alert is reported by the app and
  therefore goes quiet when the app is down (`OPERATIONS.md:128-131`). The triage carries two facts a
  first responder will otherwise get wrong: `/health` is the Gateway's readiness endpoint and
  aggregates one `downstream-{name}` check per service, so a healthy Gateway can still fail the probe
  because a backend is unhealthy; and Identity, Conference and Engagement serve HTTP/2 cleartext
  only, so probing them without `--http2-prior-knowledge` reports a failure that is not there
  (`OPERATIONS.md:140-146`).

**One number in that last section has drifted.** `OPERATIONS.md:130` still describes the synthetic
probe as running at a "5-minute frequency". The web test is declared with `Frequency: 900`
(`main.bicep:482`), so each location probes every 15 minutes, and the alert's window was widened to
`PT15M` to match (`main.bicep:517-518`). The template explains both halves separately. The cadence
change is FinOps: standard web tests are billed per location-execution, and three locations every 5
minutes came to $13.39/month on this subscription (`main.bicep:464-469`). The window change is
correctness, not cost: at `Frequency: 900` a `PT5M` window would usually be empty, so the rule would
evaluate nothing at all, while `PT15M` restores exactly one result per location per window, which is
what `failedLocationCount: 2` counts (`main.bicep:512-516`). The locations and the 2-of-3 threshold
are unchanged; what moved is detection latency, from about 5 minutes to about 15. Read the runbook's
"5-minute" as the old cadence and the bicep as current.

[Rubric §31, Cost / FinOps] assesses whether cost is actively managed. Both 2026-09-02 cadence
changes (SLO rules from 5 to 15 minutes, web test from 300s to 900s) are §31 decisions taken with the
billing model written down beside them, and neither moved a threshold or a location. That is the
distinction that keeps a cost change from quietly becoming an alerting change, and it is why the
comments spend as many lines on what stayed the same as on what changed.

### The one gap the gate cannot see

`scheduledQueryAlertSpecs` declares **three** rules, not two: `outbox-dead-letter`,
`sql-dependency-failures` and `revision-activation-failed` (`main.bicep:402-421`). The third fires on
`ContainerAppSystemLogs_CL` rows whose `Reason_s` starts with "Deployment Progress Deadline Exceeded"
(`main.bicep:415-420`), the platform's report that a revision's readiness probe never went green. It
exists because that failure mode is silent from outside: the platform keeps the previous revision
serving, so nothing degrades and the deploy looks fine while the new code never takes traffic
(`main.bicep:396-401`, the 2026-08-29 Redis readiness regression).

It has no runbook section anywhere in `OPERATIONS.md`, and the file's own preamble still says "the
**two** scheduled query rules declared in `main.bicep`'s `scheduledQueryAlertSpecs` block"
(`OPERATIONS.md:57-59`). Because the rule lives outside the gated window, nothing failed when it was
added. That is the honest boundary of the pairing gate: it covers the three SLO specs, not the alert
surface as a whole, and the governance note at `OPERATIONS.md:165-171` says so, calling the non-SLO
alerts "the honour system". A reader paged by `adc-prod-alert-revision-activation-failed` today has
two things to lean on: the alert's own description, which names the first triage step (check
`/health/ready` on the named app, an untagged infrastructure health check gating readiness being the
usual cause, `main.bicep:417`), and the deploy-side story, the activation gate and rollback at
`deploy.yml:1318-1339`, described in the [CI/CD chapter](devops-cicd.md).

### Recovery moves

`OPERATIONS.md:150-163` is the fast reference: roll a bad revision back with `az containerapp
revision list` and `revision copy`, follow `DISASTER-RECOVERY.md` for a database restore, re-run the
referenced workflow when a freshness gate blocks a deploy, and revert a conference-day surge when
`cost-guard.yml` fails. Its freshness quick-reference (`OPERATIONS.md:158-161`) names all three
windows, and each one matches the workflow that enforces it: `dr-freshness` 8 days
(`deploy.yml:707`), `load-freshness` 35 days (`deploy.yml:764`), `cross-service-freshness` 5 days
(`deploy.yml:825`). Those numbers live in two places, so treat the workflow as the source of truth
and re-check the runbook line whenever a window moves: the cross-service window was widened from 3 to
5 days when that suite went weekday-nightly (`deploy.yml:823-824`), and the runbook text followed
separately.

### Why there is no Aspire dashboard in production

`OPERATIONS.md:176-207` closes the file by answering the question every new operator asks. The
absence is a decision ([ADR-098](https://ivanball.github.io/docs/adr/098-aspire-orchestration-not-testing-or-dashboards.html)), not an omission, and it rests on three facts.

The production telemetry stream is deliberately thinned, so a full-fidelity dashboard would have
nothing extra to show: `main.bicep:220-264` sets `Telemetry__TracesSampleRatio=0.25`
(`main.bicep:224-227`), an OpenTelemetry log floor of `Warning` so Information still reaches
container stdout without billing against the workspace (`main.bicep:235-238`),
`Telemetry__DisableHttpClientMetrics` and `Telemetry__DisableRuntimeMetrics` (`main.bicep:246-253`,
together about 65% of AppMetrics ingestion as measured over 2026-08-03 to 08-09), and
`OTEL_METRIC_EXPORT_INTERVAL=300000` against a 60-second default (`main.bicep:261-264`). The
dashboard's value is live, unsampled, per-request detail, which is exactly the data production does
not carry.

The durable operational surface is the workspace, not a dashboard (`OPERATIONS.md:192-196`): the
alert rules and their action group, the SLO workbook, and KQL over `ContainerAppConsoleLogs_CL`,
`AppRequests` and `AppDependencies` all survive a revision restart and stay queryable weeks later.
And the ACA dashboard component is ephemeral and full-fidelity, which is the wrong pair for
production (`OPERATIONS.md:198-202`): it holds its data in the running container's memory, so a
restart discards it, while ingesting at exactly the fidelity the settings above were tuned to avoid.

[Rubric §31, Cost / FinOps] meets §13 here: the observability posture is shaped by ingestion cost,
and the runbook records that trade-off where an operator will actually hit it rather than leaving it
implicit in the bicep.

---

## infra/SQL-MANAGED-IDENTITY.md, staged passwordless-SQL runbook

**File:** `MMCA.ADC/infra/SQL-MANAGED-IDENTITY.md` (100 lines)

**What it is.** The runbook for moving the four service apps from SQL-login (password) auth to Entra
managed-identity auth against their per-service databases, and the written acceptance of the SQL data
plane staying on public network access with no VNet.

**When to run.** Only when deliberately advancing that hardening. Nothing here is on the normal
deploy path: all three bicep knobs are default-safe, so a deploy with the defaults changes nothing
(`SQL-MANAGED-IDENTITY.md:7-9`, the knob table at `SQL-MANAGED-IDENTITY.md:29-33`).

[Rubric §11, Security] assesses credential hardening. **All three stages have been run in ADC
production.** The template default is still `false` (`main.bicep:36`), because that is what makes a
fresh environment start on password auth and each stage independently deployable, but the deployed
value comes from a repository variable, not the default: `deploy.yml:1133` reads
`vars.USE_MANAGED_IDENTITY_SQL` and `deploy.yml:1293-1296` rewrites the parameter to a literal JSON
`true` when it is set. All three variables are set in `ivanball/ADC` (`USE_MANAGED_IDENTITY_SQL`,
`SQL_AAD_ADMIN_LOGIN` and `SQL_AAD_ADMIN_OID`, all dated 2026-06-28), so the deployed apps use
passwordless `Active Directory Managed Identity` connection strings. The ADC scorecard records the
same activation on that date, with all four services healthy and mapped `db_owner` in every
per-service database, which is what lifted §17 DevOps Implementation from 8 to 9.
`OPERATIONS.md:45-46` is therefore correct when it tells an on-call engineer that production runs
passwordless SQL.

Note for a reader trying to verify this: the live value is repository configuration, not source, so
it cannot be confirmed from the tree. Reading `main.bicep:36` alone gives the opposite impression.
[ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html) records the staging
mechanism and describes the flag as not yet flipped, which was true when it was written.

### Why staged, and the three stages

The migration is staged because managed-identity auth needs a database user mapped to the identity
(`CREATE USER ... FROM EXTERNAL PROVIDER`), which is data-plane T-SQL that must run as an Entra
admin. The deploy principal holds Contributor, not SQL AAD-admin, so it cannot perform that grant.
Flipping the connection strings before the grants exist takes every app offline
(`SQL-MANAGED-IDENTITY.md:11-18`). Password auth keeps working at every step, because
`azureADOnlyAuthentication` is deliberately not set (`SQL-MANAGED-IDENTITY.md:35-37`), so each stage
is independently deployable and reversible.

1. **Stage 1, add the Entra admin** (`SQL-MANAGED-IDENTITY.md:50-54`). Set the `SQL_AAD_ADMIN_LOGIN`
   and `SQL_AAD_ADMIN_OID` repository variables; `deploy.yml:1282-1289` folds them into the bicep
   parameter file, and `main.bicep:624-633` provisions the AAD admin only when the object id is
   non-empty. Additive, zero app impact.
2. **Stage 2, grant the identity in each database** (`SQL-MANAGED-IDENTITY.md:56-68`). Connect to
   each of the four `ADC_*` databases as the Entra admin and run `CREATE USER
   [adc-prod-apps-identity] FROM EXTERNAL PROVIDER` plus `ALTER ROLE db_owner ADD MEMBER`.
   `db_owner` because each service is its own sole migrator and applies DDL at startup
   (`SQL-MANAGED-IDENTITY.md:66-68`, which also names the tighter alternative).
3. **Stage 3, flip the apps** (`SQL-MANAGED-IDENTITY.md:70-75`). Set `USE_MANAGED_IDENTITY_SQL=true`
   and deploy; `main.bicep:167-169` swaps the auth segment of every connection string to
   `Authentication=Active Directory Managed Identity` with the UAMI's client id and no password. No
   app-code or package change is needed: `Microsoft.Data.SqlClient` honours the keyword and
   `Azure.Identity` is already present transitively.

**Rollback** is unsetting the variable and redeploying (`SQL-MANAGED-IDENTITY.md:77-79`): the
password path is never removed in this wave, and the per-database users are inert when unused.

**Accepted risk (`SQL-MANAGED-IDENTITY.md:81-100`).** The SQL server keeps `publicNetworkAccess:
Enabled` and the `AllowAzureServices` rule, because there is no VNet and moving to a private endpoint
would require recreating the Container Apps environment (and therefore every container app). The
compensating controls are a TLS 1.2 minimum (`main.bicep:604`), Key Vault secrets reached through the
managed identity, and, with stages 1 to 3 complete, no shared SQL password in the data path at all,
so network reachability no longer implies credential exposure.

---

## infra/POST-CUTOVER-atldevcon-downgrade.md, archive downgrade and drop runbook

**File:** `MMCA.ADC/infra/POST-CUTOVER-atldevcon-downgrade.md` (128 lines)

**What it is.** The record of what happened to the legacy `AtlDevCon` database after the
database-per-service cutover, in two acts. The first act is the S0 to Basic downgrade that was the
third and final commit of the rollout. The second act, added 2026-09-02, is the archive-and-drop that
retired the database entirely. The file opens with a status banner
(`POST-CUTOVER-atldevcon-downgrade.md:3-9`) that tells you which act is current: `AtlDevCon` no
longer exists, the bacpac blob is the rollback source of record, and everything above the "Final
state" section is history whose "never delete this resource" instruction has been superseded.

**When to consult.** When you need the pre-cutover data, when you are rebuilding the environment
after a disaster and want to know what the archive is and is not, or when you meet the "NEVER delete"
comment quoted in an older document and need to know it was retired deliberately. Nothing in this
runbook is a step on the normal deploy path any more.

[Rubric §31, Cost/FinOps] assesses whether cost is actively managed and right-sized. This file is
that principle applied twice, with a measurement between the two applications. The first pass
downgraded an idle database from S0 to Basic. The second pass retired it altogether once the numbers
were in: 32 MB of data and **0 DTU for the whole summer** while still billing as a Basic database
(`POST-CUTOVER-atldevcon-downgrade.md:81-83`). The reasoning fits in one sentence: a "data must never
be lost" constraint is satisfied just as well by a bacpac in blob storage, at a small fraction of the
cost.

[Rubric §8, Data Architecture] assesses data lifecycle and migration hygiene. The interesting part is
that retiring the data estate's last legacy member did not mean losing it: an export was verified
present and non-empty before the drop, and the import command that reverses it is recorded verbatim
in the same file.

### Walkthrough

**Act one, the downgrade (`POST-CUTOVER-atldevcon-downgrade.md:11-77`).** Kept as history, and still
worth reading for the shape of a safe SKU change:

1. **Prerequisites (`:21-41`).** Confirm the flip is live and healthy (all four `adc-prod-*` apps
   serving from their `ADC_*` databases, no writes to `AtlDevCon` for at least 24 h, its outbox
   drained to a `ProcessedOn IS NULL` count of 0), confirm the database fits the 2 GB Basic cap with
   `az sql db list-usages` and leave it at S0 if it does not (`:27-32`), and export a `.bacpac` first
   because Basic drops PITR retention from 35 days to 7 (`:34-41`).
2. **The Bicep change (`:43-65`).** Replace `sku` and `maxSizeBytes` only. Note the inline
   supersession marker at `:47-48`: the original instruction was "keep the resource, never remove
   it", and the file flags that line as overtaken by the drop rather than quietly rewriting it, which
   is what lets an operator holding an older copy recognize which version they have.
3. **Why commit 3 was separate (`:18-19`).** If `main.bicep` had carried the Basic SKU when commit 2
   deployed, `AtlDevCon` would have been downgraded before the new databases were proven. Separating
   the commits eliminated that risk.
4. **Deploy, verify, roll back (`:67-77`).** Merge and let the normal `deploy.yml` run apply it
   (Incremental mode changes only the SKU, data untouched), verify with `az sql db show` that the SKU
   reads `Basic` and the cap is 2147483648, and revert the commit to return to S0 if needed. Rolling
   back the SKU was always independent of rolling back the app flip.

**Act two, archive and drop (`POST-CUTOVER-atldevcon-downgrade.md:79-121`).** Three steps, in this
order, and the order is the whole design (`:85-101`):

1. `infra/main.bicep` stopped declaring the `sqlDatabase` resource, and that change deployed. The
   database was still there afterwards, because Incremental mode does not delete a resource just
   because it left the template. That property is what made the sequence safe rather than a race.
2. `az sql db export` wrote `sql-archive/AtlDevCon-20260902.bacpac` into storage account
   `adcprodstpys4way4uzb3g`.
3. The export was verified present and non-empty in the blob container, and only then was the
   database dropped **by hand** with `az sql db delete`.

**The rollback source of record (`:103-121`).** The blob is now the only copy of the pre-cutover
data. The runbook gives the `az sql db import` command that restores it in about ten minutes, into a
**new** database name so a restore can never collide with a live `ADC_*` database. The four live
per-service databases are unaffected by any of this and keep their own PITR plus LTR.

**"Not ours": the `atldevcon` SQL server (`:123-128`).** A SQL server named `atldevcon` in westus2
lives in the same shared resource group. It predates MMCA, belongs to something else, and has never
hosted an ADC database. The same warning is mirrored in the template (`main.bicep:645-647`). In a
shared resource group, a name collision like this is a real operational hazard, and writing it down
in both places is the mitigation.

---

## play-store-capture.ps1, Android screenshot capture

**File:** `MMCA.ADC/scripts/play-store-capture.ps1` (147 lines)

**What it is.** A PowerShell 7 script (`play-store-capture.ps1:1`) that captures a screenshot from an
attached Android device or emulator via `adb screencap` and saves it as a deterministic-filename PNG
under `store-assets/play-store/raw/`.

**When to run.** When preparing or refreshing Google Play Store screenshots. Run once per slot (for
example `01-home`, `02-sessions`) on a device or emulator that is showing the correct screen. Eight
slots are defined in the companion compose script's lineup.

[Rubric §30, Compliance/Privacy] assesses whether the app store presence is maintained. These scripts
are the mechanism for maintaining Play Store assets; without them the screenshots drift from the
current UI. The `raw/` directory is gitignored because a capture can contain the signed-in test
user's data; only the composed `screenshots/` set is committed
(`store-assets/play-store/README.md:19-20`).

### Walkthrough

**Slug-based filenames (`play-store-capture.ps1:47-51`, written at `:106`).** Raw captures are saved
as `<slug>.png` under `store-assets/play-store/raw/`, with the directory created on first use
(`play-store-capture.ps1:48-49`). Deterministic names mean the compose script can look them up by
slug key without a manifest file.

**`-List` switch (`play-store-capture.ps1:53-65`).** Lists the slots already captured, with file size
and timestamp: a quick sanity check before a composing session.

**`adb` resolution (`play-store-capture.ps1:67-75`).** Prefers `adb` on `PATH`, then falls back to the
well-known SDK path (`C:\Program Files (x86)\Android\android-sdk\platform-tools\adb.exe`), and throws
an actionable error when neither exists (`play-store-capture.ps1:73-74`).

**`exec-out` not `shell screencap` (`play-store-capture.ps1:104-110`).** Uses `adb exec-out` to stream
the PNG binary straight into the output file. Plain `adb shell screencap` on Windows applies CRLF
translation to the binary stream, corrupting the PNG. This is the kind of platform detail that is
invisible until every capture is subtly broken, which is why the comment sits directly above the
call. A capture smaller than 1024 bytes is deleted and reported as an error rather than kept
(`play-store-capture.ps1:121-125`), because at that size the device was asleep or locked.

**Dimension read from IHDR (`play-store-capture.ps1:127-147`).** Reads the PNG IHDR chunk (bytes
16-19 width, 20-23 height, big-endian, `play-store-capture.ps1:127-128`) to print the captured
resolution. A landscape capture (width greater than height) emits a warning, because Play Store phone
screenshots must be portrait.

---

## play-store-compose.ps1, Play Store screenshot compositor

**File:** `MMCA.ADC/scripts/play-store-compose.ps1` (187 lines)

**What it is.** A PowerShell 7 script that reads raw captures from `store-assets/play-store/raw/`,
wraps each into a 1080x1920 branded canvas (`play-store-compose.ps1:67-68`), overlays a caption and
subtitle from a hard-coded lineup, and writes the finished PNG to
`store-assets/play-store/screenshots/`. The composed images satisfy Play Console's aspect-ratio
requirement: Pixel emulators capture at 1080x2400 (9:20), which Play Console rejects as too tall, and
the script guarantees a compliant 1080x1920 (9:16) result (`play-store-compose.ps1:11-13`).

**When to run.** After `play-store-capture.ps1` has captured all needed slots. Run with no `-Slug` to
compose the full set, or `-Slug <slug>` to recompose one slot (the filter, and its clear error when
no raw capture matches, is at `play-store-compose.ps1:82-85`). Run with `-NoCaption` for a plain
brand-framed variant (a feature graphic or tablet screenshots, for example), which also shrinks the
reserved caption band from 280 px to 80 px (`play-store-compose.ps1:72`).

[Rubric §30, Compliance/Privacy] assesses app store compliance. Play Console has strict aspect-ratio
rules for phone screenshots; this script enforces compliance mechanically rather than relying on
manual cropping.

### Walkthrough

**Lineup (`play-store-compose.ps1:52-61`).** Eight slots are defined inline with slug, caption (large
bold white text) and subtitle (smaller cyan text). The comment at `play-store-compose.ps1:51` notes
that the lineup must be kept in sync with `store-assets/play-store/README.md`, whose table
(`store-assets/play-store/README.md:42-51`) currently matches all eight slugs, captions and subtitles
exactly. A missing lineup entry does not fail the run: the slot renders without a caption and a
warning is written (`play-store-compose.ps1:158-160`).

**Brand colors (`play-store-compose.ps1:69-71`).** Three colors: `brandTeal` (`#0D7377`), `brandCyan`
(`#14FFEC`) and `brandTealDark` (`#094F52`). The canvas uses a vertical gradient from teal to dark
teal for depth (`play-store-compose.ps1:95-98`).

**`System.Drawing.Common` assembly (`play-store-compose.ps1:39-42`).** The script loads
`System.Drawing.Common` (the PowerShell 7 path) inside a `try`, falling back to the desktop-FX
`System.Drawing` alias on Windows PowerShell 5.1.

**Fit-inside scaling (`play-store-compose.ps1:130-138`).** Each raw capture is scaled to fit inside
the available image area (`imageMaxW` by `imageMaxH`, computed from the canvas minus the caption band
and the footer at `play-store-compose.ps1:74-75`), preserving aspect ratio, then centered
horizontally and vertically. Captures taller than 9:16 (the 9:20 Pixel emulator case) are letterboxed
on the teal background rather than cropped, so nothing in the UI is lost.

**Soft shadow and cyan border (`play-store-compose.ps1:140-152`).** A black rectangle offset 10 px
right and 14 px down at alpha 80 of 255 produces a drop shadow; a 2-px cyan border makes the
screenshot pop against the teal background.

**Output (`play-store-compose.ps1:175`).** Each composed PNG is saved as
`store-assets/play-store/screenshots/<slug>.png`, and every GDI+ object is released in nested
`finally` blocks (`play-store-compose.ps1:176-182`) so a long composing run does not leak handles.
Upload the results directly to Play Console, Main store listing, Phone screenshots
(`play-store-compose.ps1:187`).

---

## Docs/MobileReleaseRunbook.md, store-submission runbook

**File:** `MMCA.ADC/Docs/MobileReleaseRunbook.md` (205 lines)

**What it is.** The manual, credential-holding steps around a store submission that code and CI
cannot perform, each tagged with when it must happen relative to the submission
(`MobileReleaseRunbook.md:3-5`). Its companion is `Docs/DeviceTestChecklist.md` (178 lines), the
physical-device pass to re-run after any behavior-affecting bump.

**When to run.** Before a Play or TestFlight upload. The eight sections are independent; read the one
that matches the step you are on.

[Rubric §17, DevOps & Deployment] assesses whether the release path is documented end to end. The
mobile head is the part of ADC that CI cannot fully automate (signing keys, provisioning profiles,
store consoles), so the runbook is the substitute for a pipeline.

### The load-bearing items

**Android App Links fingerprint (`MobileReleaseRunbook.md:7-59`).** `/.well-known/assetlinks.json` is
served by the shared `MapAppAssociationEndpoints` mapper in `MMCA.Common.API`, wired in
`MMCA.ADC.UI.Web/Program.cs` from the `AppAssociation` configuration section; bicep does not inject
that section and `appsettings.Production.json` does not override it, so the base `appsettings.json`
values are verbatim what production serves (`MobileReleaseRunbook.md:13-18`). Android verifies a link
only when both `package_name` and `sha256_cert_fingerprints` match the installed app. Two traps: the
Release android property group overrides the package id to `ivanball.AtlDevCon`
(`MMCA.ADC.UI.csproj:58`) while Debug installs as `com.ivanball.atldevcon`
(`MMCA.ADC.UI.csproj:29`), and the checked-in fingerprint is still a placeholder that must be replaced
with the **Play App Signing** certificate fingerprint, not the local upload keystore's, which Google
discards when it re-signs (`MobileReleaseRunbook.md:32-34`;
[ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html) records the same open item). The fingerprint belongs in the repo rather than Key Vault
because it is public by design: it is served to anyone who requests the document
(`MobileReleaseRunbook.md:39-40`).

**iOS associated domains (`MobileReleaseRunbook.md:61-75`).** `Entitlements.plist` requests
`com.apple.developer.associated-domains` and is wired in through `CodesignEntitlements`
(`MMCA.ADC.UI.csproj:81`). The existing "AtlDevCon App Store" provisioning profile does not carry
that capability, so the next Release build fails signing until the capability is enabled and the
profile regenerated under the identical name (the csproj pins `CodesignProvision`,
`MMCA.ADC.UI.csproj:90`). The AASA document must be live on the prod UI host before App Review,
because Apple's CDN fetches it at submission (`MobileReleaseRunbook.md:72-75`).

**Release signing password (`MobileReleaseRunbook.md:77-81`).** Keystore passwords are not in the
csproj: `AndroidSigningKeyPass` and `AndroidSigningStorePass` read the `ADC_ANDROID_SIGNING_PASSWORD`
environment variable (`MMCA.ADC.UI.csproj:73-74`), which must be set in the shell before any local
Release android build.

**Native push and the avatar grant, two Bicep switches pointing in opposite directions.** Both are
worth reading against the template rather than the prose:

- Native push is **wired and enabled by default**: `nativePushEnabled` defaults to `true`
  (`main.bicep:119-120`) and `deployNotificationHub` defaults to `true` (`main.bicep:122-123`). What
  the second flag gates is only the *wiring*, the Key Vault connection-string secret plus the
  notification app's secret and env refs (`main.bicep:960-964`, `:1523`, `:1591-1595`). The
  namespace, hub and auth rule are never deployed by this template: they are declared `existing`
  (`main.bicep:754-769`) because ARM PUTs on this namespace never reach a terminal state, hit on
  create in 2026-07-11 and again on update in 2026-08-24 (`main.bicep:746-753`). They have to be
  provisioned out of band through section 5 of the runbook before the flag can be true. Read that
  section from the bottom up: the opening paragraph (`MobileReleaseRunbook.md:94-99`) still says the
  hub is not provisioned and describes the guard as `deployNotificationHub=false`, but the progress
  note that follows (`MobileReleaseRunbook.md:101-105`) records the current defaults, and the
  remaining manual work is the out-of-band hub creation, the FCM v1 service-account credential and
  the APNs key (`MobileReleaseRunbook.md:107-121`). Registration works on the connection string
  alone; only sends need those credentials.
- Avatar storage still needs a one-time manual role grant, because the deploy identity deliberately
  lacks `Microsoft.Authorization/roleAssignments/write` (`main.bicep:125-126`,
  `grantAvatarStorageRole` default `false`, the guarded resource at `main.bicep:831-839`). Until the
  grant is applied, avatar uploads fail cleanly with `FileStorage.UploadFailed` and nothing else
  breaks (`MobileReleaseRunbook.md:123-146`, which includes the `az rest` form because
  `az role assignment create` misreports on this tenant). One detail the template adds and the
  runbook does not: the grant is scoped to the storage **account**, so the same assignment also
  covers the Data Protection key-ring container (`main.bicep:825-826`).

**Play target API level (`MobileReleaseRunbook.md:155-205`).** A recurring annual deadline: from
2026-08-31 an update must target API 36 (Android 16) or higher. The level is pinned in the csproj
(`MMCA.ADC.UI.csproj:54`, `TargetPlatformVersion` 36.0) precisely so a build machine one Android
workload behind fails outright instead of quietly producing a rejectable AAB
(`MobileReleaseRunbook.md:171-176`). Raising it is a behavior change (API 35+ forces edge-to-edge
layout), so the device checklist is re-run before rollout, and the runbook prescribes verifying the
merged manifest before every upload (`MobileReleaseRunbook.md:183-192`).

---

## The operational artifacts in full context

The surviving artifacts form one story that starts at bootstrap and ends at day-2 triage:

| Step | Who runs it | Artifact |
|---|---|---|
| **Bootstrap**, create the deploy identity and its OIDC credentials | Operator, once per environment | `scripts/azure-setup.sh` |
| **Archive retirement**, downgrade `AtlDevCon`, then export it and drop it | Developer (Bicep PR plus normal deploy), then operator (export and drop by hand) | `infra/POST-CUTOVER-atldevcon-downgrade.md` |
| **Weekly recovery proof**, PITR-restore a throwaway copy and time it | GitHub Actions (weekly cron) plus operator on demand | `dr-drill.yml` into `scripts/dr-restore-drill.ps1` |
| **Disaster recovery**, restore a database, roll back a deploy | On-call operator | `infra/DISASTER-RECOVERY.md` |
| **Day-2 alert triage**, answer a page and pick the recovery move | On-call operator | `infra/OPERATIONS.md` |
| **Passwordless SQL**, advance or roll back the auth hardening | Operator plus one deploy per stage | `infra/SQL-MANAGED-IDENTITY.md` |
| **Store assets and submission**, capture, compose, upload | Developer on a device or emulator | `scripts/play-store-*.ps1`, `Docs/MobileReleaseRunbook.md` |

The `AtlDevCon` database is the thread that runs through the database half of that table, and that
thread now ends: it was the source of data truth during the copy, then the rollback path after the
flip, then a Basic-tier archive, and since 2026-09-02 a bacpac blob rather than a database
(`main.bicep:635-647`, `POST-CUTOVER-atldevcon-downgrade.md:79-121`). Three practical consequences
follow for an operator. The four live `ADC_*` databases are the entire estate covered by PITR and LTR
(`main.bicep:681-685`). The weekly drill rotates over exactly those four and cannot target anything
else (`dr-drill.yml:22-26`, `:65-68`). And recovering pre-cutover data is an `az sql db import` into
a new database name, not a point-in-time restore.

Cross-links:
- [IaC chapter](devops-iac.md): `infra/main.bicep` provisions the four `ADC_*` databases, the LTR
  policies, the SLO alerts and workbook, and the Service Bus namespace.
- [CI/CD chapter](devops-cicd.md): `deploy.yml` carries the revision-activation and smoke gates, the
  rollback, and the three recency gates (`dr-freshness`, `load-freshness`,
  `cross-service-freshness`).
- [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), the decision to adopt database-per-service, its trade-offs, and the
  `CrossDataSourceDegradeConvention` that removes cross-database FKs.
- [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html), the resilience and recovery objectives framework, including the requirement
  that `DISASTER-RECOVERY.md` exists and that the drill-result table is filled.
- [ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html), SLO alerting as code and the alert-to-runbook pairing gate that
  `infra/OPERATIONS.md` satisfies.
- [ADR-064](https://ivanball.github.io/docs/adr/064-deploy-recency-gates.html), deploy preconditions as proof of recency, which is what turns the weekly
  drill into a production gate.
- [ADR-098](https://ivanball.github.io/docs/adr/098-aspire-orchestration-not-testing-or-dashboards.html), Aspire for orchestration and not for production dashboards, which
  `OPERATIONS.md:176-207` operationalizes.
- [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html), the outbox pattern that the per-service databases each own independently and
  that the outbox dead-letter alert watches.

---

## Rubric tag summary

| Tag | Artifact(s) |
|---|---|
| §8 Data Architecture | [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) and the per-service database declarations; the POST-CUTOVER archive-and-drop runbook |
| §11 Security | `azure-setup.sh` (UAMI / OIDC / least privilege), `DISASTER-RECOVERY.md` (managed identity, Key Vault), `SQL-MANAGED-IDENTITY.md` (staged passwordless SQL, accepted public-network risk) |
| §13 Observability | `DISASTER-RECOVERY.md` (alert thresholds and severities), `OPERATIONS.md` (per-alert triage, the build-gated pairing, the no-dashboard decision) |
| §17 DevOps & Deployment | `azure-setup.sh`, `POST-CUTOVER-atldevcon-downgrade.md`, `Docs/MobileReleaseRunbook.md` (the manual store-submission path) |
| §29 Resilience & Business Continuity | `DISASTER-RECOVERY.md` (RTO/RPO, PITR, LTR, restore runbook, drill ledger), `dr-drill.yml` plus `dr-restore-drill.ps1` (the drill itself, gated for recency by `dr-freshness`) |
| §30 Compliance/Privacy | `play-store-capture.ps1`, `play-store-compose.ps1` |
| §31 Cost/FinOps | `POST-CUTOVER-atldevcon-downgrade.md` (S0 to Basic, then archive-and-drop on a measured 0 DTU); the 2026-09-02 alert-cadence changes (`main.bicep:345-349`, `:464-469`); the thinned telemetry stream documented in `OPERATIONS.md:176-207` |
| §34 Architecture Governance | The deliberate deletion of the spent one-time cutover tooling, and then of the archive database itself once it was measurably idle; `OPERATIONS.md:165-171`, which states exactly which alerts the pairing gate does and does not cover |

---

## Not determinable from source

- **Whether the newest weekly drill is green**: the drill ledger is maintained through 2026-08-10
  (`DISASTER-RECOVERY.md:158-165`), but `dr-drill.yml` runs every Monday and a run reaches the ledger
  only when an operator pastes the printed row back into `DISASTER-RECOVERY.md`. Any drill newer than
  the last ledger row exists only in the Actions history, which is exactly what `dr-freshness` queries
  (`deploy.yml:734-736`); it cannot be read from the repository.
- **The live values of the three SQL managed-identity repository variables**: `main.bicep:36` shows
  the safe default (`false`) and `deploy.yml:1133` shows that the deployed value comes from
  `vars.USE_MANAGED_IDENTITY_SQL`. The variable's current value is repository configuration, not
  source. Check Settings, then Secrets and variables, then Actions.
- **Whether the archive bacpac is still present and readable**: the blob path and storage account are
  recorded (`POST-CUTOVER-atldevcon-downgrade.md:103-121`, `main.bicep:638-639`) and the export was
  verified at the time of the drop (`POST-CUTOVER-atldevcon-downgrade.md:97-101`), but nothing in the
  repository can attest to the blob's current state. It is now the only copy of the pre-cutover data,
  so an `az storage blob show` against that container is worth running before anyone relies on it.
- **Whether the Notification Hub namespace actually exists in Azure**: `main.bicep:754-769` declares
  the namespace, hub and auth rule as `existing`, so the template asserts nothing about their
  presence. With `deployNotificationHub` defaulting to `true` (`main.bicep:123`), a deploy fails to
  resolve `listKeys()` if they were never provisioned out of band. Only an `az` query against the
  subscription can settle it.
- **Azure list prices**: the DTU counts and the cadences are in source (`main.bicep:669-673` sets
  Basic capacity 5 for each per-service database), and the template quotes measured monthly figures
  for the alert rules and the web test (`main.bicep:345-349`, `:464-469`). Those figures are
  point-in-time measurements on this subscription, not a price list. Check Azure pricing before
  quoting a saving.
