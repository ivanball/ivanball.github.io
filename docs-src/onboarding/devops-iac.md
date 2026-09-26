# Infrastructure as Code, ADC Azure Deployment

This chapter teaches the Azure Infrastructure-as-Code layer for the MMCA.ADC application: what
resources are provisioned, why they are shaped the way they are, how secrets reach running
containers without ever being stored in source control, and how the whole deployment model hangs
together as a repeatable, incremental, credential-free pipeline. By the end you will understand
every resource in the Azure resource group, the two-file Bicep split that separates long-lived
from short-lived infrastructure, the UAMI/OIDC credential model, the Key Vault reference model for
runtime secrets ([ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)),
the alerts-as-data model
([ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html)), the
database-per-service wiring, and the FinOps guardrails that protect against a runaway
conference-day scale-up. The CI/CD workflow that _invokes_ this Bicep, `deploy.yml`, is covered in
the CI/CD chapter (`devops-cicd.md`); cross-references below mark exactly where each phase of that
workflow touches these files. The alert-to-runbook build gate that ADR-062 also decides is a
fitness function and lives in [group 27](group-28-testing-infrastructure.md#observabilityconventiontestsbase).

Everything cited here is **MMCA.ADC**. MMCA.Store has files of the same names (`infra/main.bicep`,
`infra/foundation.bicep`, `azure.yaml`, `deploy.yml`) describing a different topology; where a
decision is shared, this chapter says so explicitly rather than letting the citation imply it.

---

## How the pieces fit together

Before diving into individual files, here is the end-to-end picture:

```
GitHub Actions (deploy.yml)
  │
  ├─ Phase 1 ─ job `foundation` ─ azure/arm-deploy → infra/foundation.bicep
  │               (ACR + its daily two-step image-purge task + Log Analytics,
  │                long-lived, rarely changes)
  │               outputs: acrName, acrLoginServer, logAnalyticsName
  │
  ├─ Phase 2 ─ job `build-images` ─ 6-leg matrix, docker build & push
  │               (sha-tagged + :latest, registry-backed buildx cache)
  │
  ├─ Phase 3 ─ job `deploy` ─ azure/arm-deploy → infra/main.bicep   ← this chapter
  │               (everything else: App Insights, alerts + availability web
  │                test + workbook, SQL, Service Bus, Redis, blob storage,
  │                Container Apps, Key Vault secrets, budget)
  │               inputs: acrName + logAnalyticsName from Phase 1
  │               outputs: gatewayFqdn, uiFqdn, sqlServerFqdn, …
  │
  ├─ Phase 4 ─ (no migration step, each service self-applies its own
  │               migrations at startup as the SOLE migrator; minReplicas:1
  │               guarantees a single applier, see the CI/CD chapter)
  │
  ├─ Phase 5 ─ revision-activation gate + smoke-test probe + rollback on failure
  │
  └─ Post-deploy ─ `az acr run` purge of the BuildKit cache manifests this run
                  orphaned, continue-on-error (deploy.yml:1492-1499)
```

Phases 1 and 2 are their own jobs (`deploy.yml:1089`, `deploy.yml:1143`) rather than steps inside
`deploy`, so they overlap the ~20-minute chromium `e2e-gate` instead of sitting on the critical
path (`deploy.yml:1081-1088`, `:1123-1131`). Nothing is rolled out there: `build-images` only pushes
tags, and the `deploy` job (`deploy.yml:1234-1690`) still waits on every gate before `main.bicep`
points a container app at any of them. That gate list (`deploy.yml:1237`) is `supply-chain`,
`cost-guard`, the **four** freshness gates (`dr-freshness`, `load-freshness`,
`cross-service-freshness` and `cross-browser-freshness`), `foundation`, `build-images`,
`ai-eval-gate`, and then **exactly one** of the two complementary test gates: the chromium
`e2e-gate` on a UI diff or `backend-test-gate` on every other code diff (`deploy.yml:1261-1268`,
`:1282-1284`). Those last two conditions are exact complements, which is what keeps the invariant
"no production deploy without test execution" true without either gate having to be unconditional.
The two newest entries are `cross-browser-freshness`, which asserts a recent successful firefox
**and** webkit leg on `e2e.yml`, so cross-engine coverage is enforced without putting
either engine back on the per-deploy critical path, and `ai-eval-gate`, which runs the AI session
scorer's golden-replay and prompt-contract tiers on every code deploy and adds the paid live judge
only when the diff touches the scoring code (`deploy.yml:1242-1246`). Both are `deploy.yml` jobs and
belong to the CI/CD chapter; they matter here because the feature `ai-eval-gate` guards is the same
one the token-ceiling alert in `main.bicep` bounds at runtime (see below).

The **shared resource group** is `acc-rg` in the QiMata Sponsorship subscription (East US 2), read
from the `AZURE_RESOURCE_GROUP` repository variable (`deploy.yml:24`) and named in the SQL-region
comment (`deploy.yml:1344-1349`). Both Bicep files target `resourceGroup` scope (`main.bicep:1`,
`foundation.bicep:1`) and are applied with **Incremental** deployment mode, Azure adds and updates
declared resources but never deletes absent ones. Incremental mode is also why removing a resource
from a template is only half of a decommission: the legacy `AtlDevCon` database left `main.bicep`
on 2026-09-02 and an operator still had to drop it by hand afterwards (`main.bicep:864-879`), and it
is why the Notification Hubs namespace can be referenced as an existing resource rather than
declared (see the Notification Hub section below).

[Rubric §17, DevOps & Deployment] assesses whether infrastructure is code-managed, idempotent,
and repeatable. The two-file split, Incremental mode, and the CI-driven invocation sequence across
the `foundation`, `build-images` and `deploy` jobs embody all three: every production change flows
through the same Bicep pipeline, every re-run is safe, and nothing requires clicking in the Azure
portal.

---

## `azure.yaml`, the azd project definition

**File:** `MMCA.ADC/azure.yaml`

`azure.yaml` is the Azure Developer CLI (`azd`) manifest for the project. It declares six
deployable services and points `azd` at the Bicep infrastructure directory.

### Services declared (`azure.yaml:4-46`)

| azd service name | Source project | Host | Dockerfile path |
|---|---|---|---|
| `gateway` | `Source/Hosts/MMCA.ADC.Gateway` | `containerapp` | `Source/Hosts/MMCA.ADC.Gateway/Dockerfile` |
| `ui` | `Source/Hosts/UI/MMCA.ADC.UI.Web` | `containerapp` | `Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile` |
| `identity` | `Source/Services/MMCA.ADC.Identity.Service` | `containerapp` | `Source/Services/MMCA.ADC.Identity.Service/Dockerfile` |
| `conference` | `Source/Services/MMCA.ADC.Conference.Service` | `containerapp` | `Source/Services/MMCA.ADC.Conference.Service/Dockerfile` |
| `engagement` | `Source/Services/MMCA.ADC.Engagement.Service` | `containerapp` | `Source/Services/MMCA.ADC.Engagement.Service/Dockerfile` |
| `notification` | `Source/Services/MMCA.ADC.Notification.Service` | `containerapp` | `Source/Services/MMCA.ADC.Notification.Service/Dockerfile` |

Every service sets `language: dotnet` and `host: containerapp`, `azd` knows to build a Docker
image and deploy it to an Azure Container App. The `context: .` on every Dockerfile entry means
the Docker build context is the repository root, which is required because the Dockerfiles
reference source paths across multiple `Source/` subdirectories and the shared `Directory.Packages.props`.

The infrastructure stanza (`azure.yaml:47-49`) sets `provider: bicep` and `path: infra`, pointing
`azd` at the `infra/` directory where both `foundation.bicep` and `main.bicep` live. In practice
the CI pipeline invokes the Bicep files directly via `azure/arm-deploy` (`deploy.yml:1115-1121`,
`:1489-1495`), not via `azd`, but the `azure.yaml` manifest keeps the project `azd`-compatible for
local developer use and future tooling.

[Rubric §33, Developer Experience & Inner Loop] assesses how quickly a developer can go from
clone to running. `azure.yaml` lets a developer with the right Azure credentials run `azd up` to
provision and deploy the whole stack from a single command, matching the local Aspire experience
(`dotnet run --project Source/Hosting/MMCA.ADC.AppHost`).

---

## `infra/foundation.bicep`, long-lived shared infrastructure

**File:** `MMCA.ADC/infra/foundation.bicep`

Foundation is deployed first (CI/CD chapter: `deploy.yml:1115-1121`) on every run. It provisions
three resources: the Azure Container Registry, a scheduled purge task on that registry, and the Log
Analytics workspace. The registry and the workspace are what _everything else_ depends on but that
almost never change: the registry stores images that live across many deploys, and the workspace
accumulates days of telemetry that must persist across re-runs of `main.bicep`. The third is a
maintenance job rather than a dependency, and it lives here because it is a child of the registry
it prunes.

### Parameters (`foundation.bicep:3-15`)

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `environmentName` | `string` | required | Suffix for resource names (`adc-${environmentName}-…`) |
| `location` | `string` | RG location | Primary Azure region |
| `dailyQuotaGb` | `int` | `5` (`@minValue(1)`, `@maxValue(50)`) | Daily Log Analytics ingestion ceiling, the runaway-cost guard on the workspace below |

The `resourceToken` variable (`foundation.bicep:17`) is a stable hash derived from
`uniqueString(resourceGroup().id, environmentName)`. All generated resource names incorporate it,
ensuring uniqueness within the subscription while remaining deterministic across re-runs. That
determinism is also why the `foundation` job has to promote its outputs to job outputs
(`deploy.yml:1086-1088`): `acrName` cannot be recomputed outside Bicep. The same `commonTags` set
used in `main.bicep` is applied here too (`foundation.bicep:22-28`), so cost attribution covers the
foundation resources as well as the application ones.

### Log Analytics Workspace (`foundation.bicep:33-57`)

```
name: '${prefix}-logs-${resourceToken}'
sku:  PerGB2018
retentionInDays: 30
workspaceCapping: { dailyQuotaGb: dailyQuotaGb }   // parameter, default 5
```

PerGB2018 is the pay-as-you-go tier. The 30-day minimum is Azure's floor for this SKU, shorter
retention is rejected (and the memory note `reference_log_analytics_sku_limits.md` records this
hard constraint). All six container apps ship their logs here via the Container Apps environment's
`appLogsConfiguration` (`main.bicep:1399`), and `main.bicep`'s Application Insights component
uses it as its workspace backing store, meaning traces and metrics land in the same workspace. The
same destination is also what makes the platform's own `ContainerAppSystemLogs_CL` table queryable,
which the revision-activation alert below depends on (`main.bicep:461`).

`workspaceCapping.dailyQuotaGb` (`foundation.bicep:53-55`) is the workspace's ingestion ceiling, and
it is the one number in this file that is dangerous in **both** directions. It used to be a
hard-coded `1`, a pure FinOps circuit breaker against a runaway telemetry storm. On 2026-09-07 it
became a parameter defaulting to **5** (`foundation.bicep:12-15`), and the comment explains the
reversal (`foundation.bicep:42-52`): reaching the cap does not throttle, it **stops** ingestion for
the remainder of the UTC day, and every scheduled query rule in `main.bicep` (failed requests,
dependency failures, outbox dead-letter, revision activation, SQL security audit) then evaluates
empty data while the incident that filled the workspace runs unlogged. A ceiling sitting only about
2.5x above the roughly 0.4 GB/day baseline was therefore an attack surface rather than a guard: an
error loop or an outbox failure storm is enough to cross it. Azure exempts only its own fixed
security-table list from a workspace cap, so there is no per-table carve-out to reach for; the
ceiling itself is the only lever. The new default is about 10x the expected total, which now also
carries the platform audit streams added in the same pass (Key Vault `AuditEvent`, storage blob
read/write/delete, Service Bus operational, ACR, SQL security audit: roughly 0.1 to 0.3 GB/day more
at conference scale), so a conference-day spike cannot trip it while a genuine loop still hits a
ceiling. `dailyQuotaGb: -1` removes the cap entirely, and **the cap being reached now pages on its
own**, from the cap-exempt `_LogOperation` table (`main.bicep:575-624`, described below).

[Rubric §13, Observability & Operability] assesses whether the system exposes structured logs,
distributed traces, and metrics in a queryable store. The single workspace is the convergence
point: container-app stdout/stderr, platform system logs, ASP.NET Core structured logs, and
OpenTelemetry traces all land in the same Log Analytics table set, queryable with Kusto.

### Azure Container Registry (`foundation.bicep:62-74`)

```
sku: Basic
adminUserEnabled: false   // #11/#17, managed-identity pull only
```

The `adminUserEnabled: false` setting (`foundation.bicep:72`) is the central credential-hardening
decision for image pull. Without it, every container app would need a stored registry admin
password. With it disabled, images are pulled exclusively via the shared UAMI's `AcrPull` role
assignment (bootstrapped out-of-band, see the UAMI section below). The deploy push likewise uses
the GitHub deploy identity's `AcrPush` role, not the admin credential (`foundation.bicep:70-71`).

[Rubric §11, Security] assesses elimination of long-lived credentials. Disabling the admin user
removes the one static credential that would otherwise be needed for every pull, a concrete,
verifiable hardening choice recorded directly in the Bicep.

### ACR audit logging (`foundation.bicep:87-103`)

A diagnostic setting named `audit-to-log-analytics` is attached to the registry and forwards two
event categories to the foundation workspace: `ContainerRegistryLoginEvents` (authentication
outcomes) and `ContainerRegistryRepositoryEvents` (push, pull, delete, purge). It was added on
2026-09-07 with the rest of the audit pass, and the comment states the gap it closes
(`foundation.bicep:79-86`): the registry is what the six production images are pulled from, so a
principal holding `AcrPush` can replace a deployed image, and before this setting existed that
replacement left no record anywhere. `AllMetrics` is deliberately **not** enabled: platform metrics
carry no security signal and would be pure ingestion cost against the daily cap above. The expected
volume is single-digit MB/day (a handful of deploys plus the one daily purge task), which is the
sizing argument that lets the setting exist without moving the cap.

[Rubric §11, Security] assesses whether privileged actions leave an attributable trail. This is the
supply-chain end of that: the artifact store that feeds production now records who authenticated to
it and which repository mutations ran, in the same workspace the application telemetry lands in, so
an image-substitution incident is scopeable after the fact rather than invisible.

### ACR scheduled purge task (`foundation.bicep:105-165`)

The registry has no garbage collection of its own at Basic tier: the retention policy feature is
Premium-only (`foundation.bicep:67`). Every deploy pushes a `sha` tag plus `:latest` for six images
along with buildx cache layers, and nothing deletes any of them, so the ACR Data Stored meter only
ratchets upward. The comment records the measured shape of that ratchet: $0.49/day climbing to
$0.69/day within nine days in 2026-08 (`foundation.bicep:68-70`).

The answer is an ACR task rather than a workflow step, and it now runs **two** purge commands
(`foundation.bicep:88-97`):

```
var acrPurgeTaskYaml = '''
version: v1.1.0
steps:
  - cmd: acr purge --filter '.*:.*' --ago 3d --keep 3 --untagged
    disableWorkingDirectoryOverride: true
    timeout: 3600
  - cmd: acr purge --filter 'buildcache:.*' --ago 1h --keep 10 --untagged
    disableWorkingDirectoryOverride: true
    timeout: 3600
'''
```

`acrPurgeTask` (`foundation.bicep:99-124`) is a `Microsoft.ContainerRegistry/registries/tasks`
child of the registry, `status: 'Enabled'`, running the YAML above as a base64 `EncodedTask`
(`foundation.bicep:111-114`) on a Linux/amd64 agent with a 3600-second timeout. Its single
`timerTriggers` entry, `daily-0500-utc`, carries the cron expression `0 5 * * *`
(`foundation.bicep:115-122`), so the whole task fires once a day at 05:00 UTC.

Three flags on the first command line carry the image-tag retention policy
(`foundation.bicep:91`):

| Flag | Effect | Why |
|---|---|---|
| `--untagged` | deletes manifests with no tag at all | superseded `:latest` targets, pure waste the moment they are orphaned |
| `--ago 3d` | deletes tags not updated in 3 days | three days of deployed history is the retention window |
| `--keep 3` | keeps the 3 most recent tags per repository regardless of age | rollback only ever reaches the previous revision, so three kept tags cover it even for a repository nobody has deployed to in a week |

The window is that tight for a reason the template states as a measurement
(`foundation.bicep:71-74`): a wider 30-day / keep-10 window let the registry grow to about 300 GiB
against the 10 GiB the Basic tier includes (measured 2026-08-22), and every GiB above the included
allowance is billed as storage overage.

**The second step exists because the first one structurally cannot reach the build cache**
(`foundation.bicep:77-87`). The `build-images` matrix exports `cache-to=type=registry,…,mode=max`
into a `buildcache` repository (`deploy.yml:1216`), and `mode=max` writes one tag per image (six
tags, every one refreshed on every deploy) plus a large tree of **untagged** layer manifests behind
those tags. A tag refreshed on every deploy is never three days old, so the daily step above aged
nothing out and the untagged manifests it orphaned were never swept: they reached about 111 GB,
carrying registry storage to 74 GB against the 10 GiB included allowance, $16.23/month of overage
measured 2026-09-02. Hence the flags on the second line (`foundation.bicep:94`): `--keep 10` is
deliberately larger than the six live cache tags, so the step can never delete a cache tag the next
build is about to read, and `--ago 1h --untagged` is the part that reclaims space, because a
manifest the current deploy's cache push has already orphaned is garbage the moment it is written.

The same purge runs a second time, from `deploy.yml` itself, as the last step of the `deploy` job
(`deploy.yml:1683-1690`): `az acr run` with the identical `buildcache` filter, `continue-on-error:
true`. The daily task is the floor; running it again minutes after the deploy that created the
garbage is what keeps a Basic-tier registry under its included storage instead of paying a day's
worth of overage. It is deliberately positioned **after** the rollout and the smoke gate and cannot
fail the run, because housekeeping must never block a deploy that has already shipped
(`deploy.yml:1679-1682`).

Two things make the scheduled version credential-free, which is why it is a task and not another
OIDC job. `acr` in the step command is the registry's built-in task alias for
`mcr.microsoft.com/acr/acr-cli`, and a scheduled task authenticates to its own home registry
automatically, so no credential is configured anywhere in the resource
(`foundation.bicep:74-76`).

[Rubric §31, Cost Efficiency / FinOps] assesses whether infrastructure cost is actively monitored,
bounded, and governed. This is the storage end of that: the purge task bounds a monotonically
growing meter that no alert would have caught (registry storage never fails, it just costs more
every day), and it does so declaratively, in the same template that created the registry, with the
retention window expressed as reviewable flags rather than as a habit somebody has to remember. The
second step is the same lesson learned twice: a retention rule written for tags left the largest
consumer of the meter, untagged cache layers, entirely unswept.

### Outputs (`foundation.bicep:129-131`)

`acrName`, `acrLoginServer`, and `logAnalyticsName` are the three values threaded from Phase 1
into Phase 2 (docker push target) and then into Phase 3 (`main.bicep` parameters). Because Phases 1
to 3 are separate jobs, they cross the job boundary as job outputs (`deploy.yml:1101-1104`) and
are read as `needs.foundation.outputs.*`: see `deploy.yml:1183`
(`az acr login --name ${{ needs.foundation.outputs.acrName }}`), `deploy.yml:1200-1201` (the two
image tags), `deploy.yml:1355-1356` (the `acrName`/`logAnalyticsName` parameter assembly), and
`deploy.yml:1688` (the post-deploy cache purge).

---

## Deployment parameters, assembled at deploy time, not committed

There is **no `infra/main.parameters.json` file** in the repository, the tracked `infra/` directory
holds only `foundation.bicep`, `main.bicep`, `DISASTER-RECOVERY.md`, `OPERATIONS.md`,
`SQL-MANAGED-IDENTITY.md`, `POST-CUTOVER-atldevcon-downgrade.md`, and `workbooks/adc-slo-workbook.json`.
A local `bicep build` also drops `infra/main.json` beside them, which is why `/infra/*.json` is
gitignored (`.gitignore:9`): the compiled ARM template is a build artifact, never a source of
truth. The parameters fed to `main.bicep` are built **from scratch at deploy time** by `deploy.yml`'s
"Build deployment parameters file" step (`deploy.yml:1372-1585`), which writes
`/tmp/deploy-params.json` with `jq`.

How it works:

- **Two fail-fast pre-checks run before any `jq` call**, both for the same reason: catch a missing
  repository setting with an actionable error rather than letting Bicep validation report it as a
  parameter-binding failure minutes later. The first fails when the `ALERT_EMAIL` repository
  variable is empty (`deploy.yml:1408-1411`), because `alertEmailAddress` is a **required**
  `main.bicep` parameter with no default (`main.bicep:122-124`), and an alert rule wired to no
  notification channel is a silent failure. The second fails when either RSA key secret is empty
  (`deploy.yml:1413-1419`): `rsaPrivateKeyPem` and `rsaPublicKeyPem` are also required parameters
  with no default (`main.bicep:38-44`) because Identity signs RS256 and publishes JWKS, and there
  is no other signing path.
- A base `jq -n` invocation (`deploy.yml:1431-1459`) emits the always-present parameters,
  `environmentName`, `sqlLocation`, `acrName`, `logAnalyticsName`, `sqlAdminPassword`, and the six
  `*Image` URLs, into the ARM `deploymentParameters` JSON shape. `acrName` and `logAnalyticsName`
  are the Phase 1 foundation outputs; the image URLs are the `sha`-tagged ACR references;
  `sqlAdminPassword` comes from the `SQL_ADMIN_PASSWORD` GitHub secret. `sqlLocation` defaults to
  `westus2` (`deploy.yml:1428`) because the sponsor subscription blocks `Microsoft.Sql` in the RG's
  region. The two RSA keys are appended immediately after, unconditionally
  (`deploy.yml:1463-1466`), because they are required.
- Optional parameters (GitHub OAuth, Google OAuth, the four Sign in with Apple pieces, the
  AI provider key, the five SMTP settings, the synthetic-traffic bypass key, the alert email, and the
  three staged managed-identity SQL inputs) are conditionally appended with further `jq --arg`
  calls (`deploy.yml:1468-1585`) **only when their env var is non-empty**. The AI key is the one
  whose names differ at each hop: the GitHub secret is still `ANTHROPIC_API_KEY` because the
  credential is an Anthropic one, the step maps it to the provider-neutral `AI_API_KEY` variable
  (`deploy.yml:1386-1388`), and that variable feeds the `aiApiKey` Bicep parameter
  (`deploy.yml:1506-1509`). `jq --arg` JSON-escapes
  multi-line values correctly, critical for the Apple `.p8` PEM, which contains newlines. Anything
  not appended falls back to the `@secure()` parameter's empty-string default in `main.bicep`,
  which the template's feature flags (`hasAiApiKey`, `hasAppleOAuth` and the rest) read to disable the
  corresponding feature.
- `useManagedIdentitySql` is the one boolean: it is appended as a literal JSON `true` only when the
  `USE_MANAGED_IDENTITY_SQL` repository variable is exactly `"true"` (`deploy.yml:1572-1575`), keeping
  the Bicep parameter typed.

[Rubric §11, Security] is directly served: there is no checked-in parameters file to leak secrets from at
all; the actual secret values flow from GitHub Actions secrets (encrypted at rest, masked in logs, visible
only to the `production` deploy environment) into the ephemeral `jq`-assembled `/tmp/deploy-params.json`
that exists only for the duration of the workflow run.

---

## `infra/main.bicep`, the full application infrastructure

**File:** `MMCA.ADC/infra/main.bicep`

`main.bicep` declares every application-layer Azure resource: Application Insights, five SLO
scheduled query rules (one of them the AI-scoring token ceiling, `main.bicep:420-432`) and their
action group, three operational scheduled query rules, a log-ingestion-cap rule, a Gateway
availability web test and its severity-1 alert, a saved SLO workbook (`main.bicep:704-724`), the
monthly cost budget, SQL Server with the four per-service databases, Service Bus, references to the
manually provisioned Notification Hub, the blob storage account with its two declared containers
(public avatars and the private DataProtection key ring), an Azure Managed Redis instance, the
Container Apps environment, nineteen Key Vault secrets, and all six container apps. All billable
resources receive the same tag set (`main.bicep:176-182`) so Azure Cost Analysis can attribute
spend by application and environment, and the six container apps and four databases add a
`service` tag on top of it (`main.bicep:173-175`) so the same report splits by service.

### Parameters (`main.bicep:1-154`)

Parameters divide into five categories:

**Infrastructure coordinates** (supplied from Phase 1 foundation outputs):
- `acrName`, `logAnalyticsName` (`main.bicep:17,20`), links back to foundation resources.
- `environmentName`, `location`, `sqlLocation`, `sqlLocation` is separate because the QiMata
  Sponsorship subscription blocks `Microsoft.Sql` in East US 2 (the RG location) but permits it in
  West US 2 (`main.bicep:12-14`). Container Apps stay in the RG region; only SQL lands in West US 2.

**Secure parameters** (marked `@secure()`, ARM masks them in deployment logs and does not store
them in deployment history):
- `sqlAdminPassword` (`main.bicep:27`), SQL Server admin password.
- `rsaPrivateKeyPem`, `rsaPublicKeyPem` (`main.bicep:40,44`), PEM-encoded RSA key pair for RS256
  JWT signing and JWKS publishing. Both are declared **REQUIRED**, with no default: RS256 is the
  only signing algorithm the deployment supports, so there is no HS256 fallback key parameter at
  all any more.
- `githubOAuthClientSecret` (`main.bicep:51`), `googleOAuthClientSecret` (`main.bicep:58`),
  `appleOAuthPrivateKeyPem` (`main.bicep:71`), `aiApiKey` (`main.bicep:75`),
  `smtpPassword` (`main.bicep:91`), optional integration secrets. `aiApiKey` is provider-neutral:
  it holds the key for whichever provider `Ai:Provider` names (Anthropic today), and its
  description records why the Key Vault secret it lands in keeps the `anthropic-api-key` name
  (`main.bicep:74`): the credential itself is an Anthropic one, and renaming a live secret buys
  nothing.
- `syntheticTrafficSecret` (`main.bicep:98`), the shared key that lets the monthly k6 capacity
  proof bypass the gateway edge rate limiter
  ([ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html)
  amendment). Left empty the bypass is entirely off, which is the safe default: it exists so a
  synthetic run measures backend capacity rather than the per-IP window.

**Image tags** (one per deployable, passed as `sha`-tagged ACR URLs, e.g.
`acrLoginServer/mmca-adc-gateway:<commit-sha>`):
- `gatewayImage`, `uiImage`, `conferenceImage`, `identityImage`, `engagementImage`,
  `notificationImage` (`main.bicep:105-120`).

**Staged-hardening and feature switches**:
- `sqlAadAdminLogin`, `sqlAadAdminObjectId` (`main.bicep:30,33`), default empty, provision the
  additive Entra admin on the SQL server.
- `useManagedIdentitySql` (`main.bicep:36`), default `false`, swaps the app-to-database auth segment
  (see [ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html) below).
- `deployNotificationHub` and `nativePushEnabled` (`main.bicep:130,127`) both default **true**.
  Read the description carefully before assuming that means the template creates the hub: it does
  not. `deployNotificationHub` gates only the **wiring** (the Key Vault connection-string secret
  and the Notification app's secret/env refs), because the namespace, hub and auth rule are
  declared `existing` and provisioned by runbook (see the Notification Hub section).
- `grantAvatarStorageRole` (`main.bicep:133`), default `false`, because the deploy identity
  deliberately lacks `Microsoft.Authorization/roleAssignments/write`.

**FinOps and alerting controls**:
- `enableBudget` (`main.bicep:148`), `monthlyBudgetAmount` (`main.bicep:151`),
  `budgetStartDate` (`main.bicep:154`), govern the cost budget resource (see below).
- `aiScoringTokenCeiling` (`main.bicep:78`), an `int` defaulting to `2000000`, is the only
  parameter that bounds a **third-party** meter rather than an Azure one: it is the AI provider's
  input-plus-output token envelope of one full AI scoring pass over a conference's submissions,
  times a safety factor, and it is the threshold of the conditional alert described below. Its
  description states the non-obvious part (`main.bicep:77`): the number is a **per-window** ceiling
  over any rolling two days, not a monthly one, because two days is the longest range a scheduled
  query rule will evaluate.
- `alertEmailAddress` (`main.bicep:124`) is **required**: it carries `@minLength(3)` and no default
  (`main.bicep:122-124`), so a template that would provision alerts notifying nobody fails to deploy.
  It is the receiver on both the action group and the budget notifications.

### Computed variables (`main.bicep:156-207`)

Six boolean flags gate optional blocks throughout the template:
- `hasAiApiKey` (`main.bicep:159`), gates the AI provider key's secret reference and its
  `Ai__ApiKey` env var on Conference, and is the `enabled` value of the AI token-ceiling alert.
- `hasSmtpPassword` (`main.bicep:160`), gates the SMTP password `secretRef` on Identity and
  Notification.
- `hasSyntheticTrafficSecret` (`main.bicep:161`), gates the Gateway's only secret and the
  rate-limiter bypass env var.
- `hasGitHubOAuth`, `hasGoogleOAuth`, `hasAppleOAuth` (`main.bicep:164-166`), each requires
  **every** piece of its provider's configuration to be present, so a half-configured provider is
  never wired: Apple needs all four (services id, team id, key id, private key PEM).
- `hasAnyOAuth` (`main.bicep:169`) is the provider-independent one: `OAuth__UIBaseUrl` is the
  post-login redirect target, so it must be injected whenever _any_ external provider is on rather
  than behind one of them.

There is no `useRs256` flag any more. RS256 is unconditional because the RSA parameters are
required, which is why Identity's `Jwt__SigningAlgorithm` is a literal `'RS256'`
(`main.bicep:1689`) rather than a ternary.

Per-service SQL connection strings (`main.bicep:195-198`) are composed from a shared base: the SQL
server FQDN plus one of two auth segments selected by `useManagedIdentitySql` (`main.bicep:191-193`).
Each is a distinct string pointing at its own database (`ADC_Identity`, `ADC_Conference`,
`ADC_Engagement`, `ADC_Notification`), making the database-per-service boundary explicit in the value
that goes into Key Vault.

The four Service Bus connection strings (`main.bicep:204-207`) are resolved via `listKeys()`, each
against its own service's SAS authorization rule (not `RootManageSharedAccessKey`), so a future
migration to managed identity can revoke them without touching the namespace root and there is no
namespace-wide shared credential (`main.bicep:200-203`, SEC-ADC-26). The Redis
connection string (`main.bicep:1395`) is assembled the same way, from the instance hostname plus a
`listKeys()` primary key.

### Application Insights (`main.bicep:228-299`)

A workspace-based App Insights component backed by the foundation Log Analytics workspace
(`main.bicep:206-216`):

```bicep
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}
```

`IngestionMode: 'LogAnalytics'` routes all telemetry into the workspace tables
(`AppRequests`, `AppDependencies`, `AppTraces`, …) rather than the legacy Classic mode.
Every container app receives `APPLICATIONINSIGHTS_CONNECTION_STRING` (`main.bicep:221-224`) and a
per-service `OTEL_SERVICE_NAME` (e.g. `'identity'`, `'conference'`). The `OTEL_SERVICE_NAME` env
var is what Azure Monitor maps to the Cloud Role Name, without it, all services appear as
`"unknown_service"` in the Application Map.

`MMCA.Common.Aspire`'s `AddOpenTelemetryExporters` calls `UseAzureMonitor()` whenever
`APPLICATIONINSIGHTS_CONNECTION_STRING` is present (`main.bicep:201-205` comment), so the Common
framework automatically routes OpenTelemetry spans, logs, and metrics to Azure Monitor in
production with no service-level code change.

Five more shared env entries ride along with the connection string on every app, and all of them
are cost controls on a pay-per-GB workspace:

- `Telemetry__TracesSampleRatio: '0.25'` (`main.bicep:230-233`), head-based trace sampling that keeps
  25% of traces. `ParentBased` sampling in `MMCA.Common.Aspire` keeps a sampled-in trace intact
  across service boundaries, so a kept trace is still end-to-end rather than a fragment.
- `Logging__OpenTelemetry__LogLevel__Default: 'Warning'` (`main.bicep:241-244`), the floor for what the
  OpenTelemetry logging provider ships to Azure Monitor. Serilog still writes Information to stdout
  (container logs), but only Warning and above bills against the workspace. The value is set
  explicitly because `OpenTelemetry` is the `ProviderAlias` of `OpenTelemetryLoggerProvider`, so the
  key gates that provider only, and because the service hosts register Serilog as one provider
  alongside OpenTelemetry instead of calling `UseSerilog()`, which would replace the
  `ILoggerFactory` and drop every application log line before it could reach App Insights.
- `Telemetry__DisableHttpClientMetrics: 'true'` (`main.bicep:252-255`) and
  `Telemetry__DisableRuntimeMetrics: 'true'` (`main.bicep:256-259`), which drop the two
  highest-volume instrument groups from the `AppMetrics` stream. The comment records the
  measurement that motivated them (`main.bicep:246-251`): the `http.client.*` connection gauges
  plus the `dotnet.*` runtime instruments were about 65% of AppMetrics ingestion between
  2026-08-03 and 2026-08-09, roughly 290 MB/day of a roughly 500 MB/day stream, while
  `http.server.request.duration` and the MMCA.Common meters carry the operational signal. Both
  keys are read by `MMCA.Common.Aspire`'s `ConfigureOpenTelemetry`, and the outbound-dependency
  latency the client metrics would have shown is still captured as (sampled) `AppDependencies`
  traces, so this trims volume rather than visibility.
- `OTEL_METRIC_EXPORT_INTERVAL: '300000'` (`main.bicep:267-270`) is the second stage of the same
  cost control, and it works on cadence rather than on instrument selection. AppMetrics remained
  about 63% of workspace ingestion after the two instrument groups above were dropped (measured
  2026-08-01 to 2026-08-22, `main.bicep:261-266`). The exporter ships **cumulative** aggregates, so
  stretching the export interval from the SDK default of 60s to 300s drops roughly 80% of the
  remaining datapoints without losing the signal: every alert rule in this template evaluates over a
  15-minute window, so a 5-minute export cadence still lands datapoints in every window.
  This is the standard OpenTelemetry SDK env var, read by the periodic exporting metric reader
  rather than by any MMCA.Common code.

Every one of the six apps gets all five: Identity (`main.bicep:1651-1656`), Conference
(`:1878-1883`), Engagement (`:2016-2021`), Notification (`:2162-2167`), Gateway (`:2338-2344`),
UI (`:2471-2476`). They are declared once as Bicep variables and spliced into each `env` array by
name, which is what keeps a cost decision from being applied to five apps and forgotten on the
sixth.

The Gateway carries one more, and it is the only per-host entry in the set:
`Logging__LogLevel__Yarp: 'Warning'` (`yarpLogLevelEnv`, `main.bicep:267-276`, spliced at `:2341`).
YARP writes two Information lines per proxied request (`HttpForwarder` events 9 and 56) to stdout,
which Container Apps ships to Log Analytics as `ContainerAppConsoleLogs_CL`. The comment records the
measurement behind it: about 177k lines and 77 MB per week between 2026-09-13 and 2026-09-19, the
largest console-log stream in the workspace, and a duplicate of what `AppRequests` and
`AppDependencies` already record. It is Gateway-only because no other host references YARP, and the
floor is `Warning` rather than anything higher so the forwarder's error lines still ship.

[Rubric §13, Observability & Operability] assesses whether the system ships distributed traces,
structured logs, and metrics to a queryable backend. The workspace-based App Insights with
per-service Cloud Role Names gives full Application Map visibility, end-to-end distributed traces
across all six services, and Kusto-queryable logs, covering this category end-to-end.

### SLO alerts as code (`main.bicep:304-499`), [ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html)

The SLOs are declared as **data**: an array of records named `sloAlertSpecs`
(`main.bicep:343-433`) carrying `key`, `description`, `query`, `timeAggregation`,
`metricMeasureColumn`, `threshold` and `severity`, plus four optional fields that only one entry sets
(`enabled`, `windowSize`, `evaluationFrequency`, `autoMitigate`). A Bicep `for` loop materializes one
Log Analytics `Microsoft.Insights/scheduledQueryRules` per spec (`main.bicep:435-495`). There are
**five** specs today:

| Alert key | KQL source | Threshold | Window | Severity |
|---|---|---|---|---|
| `failed-requests` (`:344-352`) | `AppRequests` where `Success == false`, excluding 401/499 and crawler 404s on `/robots.txt` and `/sitemap.xml` | > 10 rows | 15 min | 2 (Error) |
| `server-response-time` (`:353-361`) | HTTP rows of `AppRequests` only: excludes `/hubs/`, `ResultCode` 101 and rows with no `Url`; `avg(DurationMs)` over windows holding at least 5 requests | > 3000ms | 15 min | 3 (Warning) |
| `dependency-failures` (`:362-370`) | `AppDependencies` where `Success == false`, excluding 401/499 | > 10 rows | 15 min | 2 (Error) |
| `resilience-circuit-open` (`:374-382`) | `AppMetrics` where `Name == "resilience.polly.strategy.events"` and `Properties["event.name"] == "OnCircuitOpened"` | > 0 rows | 15 min | 2 (Error) |
| `ai-scoring-token-ceiling` (`:420-432`) | `AppMetrics` sum of `mmca.ai.input_tokens` and `mmca.ai.output_tokens` | > `aiScoringTokenCeiling` (2,000,000) | 2 days, evaluated every 12h | 3 (Warning) |

**The KQL predicate is the whole point of the migration.** The first three rules replaced metric
alerts on `requests/failed`, `requests/duration` and `dependencies/failed`, which paged on routine
traffic because a metric alert cannot express a status-code or URL predicate. The template records
the three real incidents (`main.bicep:316-332`): one window held 8x401 plus 2x499 plus a single
readiness 503 and zero other failures, all from one browser session retrying with an expired token;
five long-lived SignalR hub connections averaging 11.3s dragged the fleet-wide average to 5539ms
against a 3000ms threshold while every real request was fast (a hub connection reports its
**connection lifetime** as request duration); and a single Azure-hosted crawler produced 12
`robots.txt` / `sitemap.xml` 404s inside one 15-minute window. Both hosts serve `robots.txt` now,
but a sitemap probe is still a 404, which is why that one pair of paths is excluded by name
(`main.bicep:337`) rather than by excluding 404 as a class. The thresholds and severities are
unchanged, so this is a precision fix, not a sensitivity cut: a genuine 400, 404 or 500 burst still
pages at the same numbers.

`server-response-time` has since been narrowed a second time, to HTTP requests only
(`main.bicep:355-356`), because the `/hubs/` name filter was not the whole connection problem. Two
more kinds of `AppRequests` row carry a duration that is not request latency: SignalR hub and
Blazor circuit connections, which surface as `ResultCode` 101 (the WebSocket upgrade) and report
connection lifetime, and the background `InternalCommandExecute` / `OutboxProcess` spans, which are
Consumer-kind and carry no `Url`, so `isnotempty(Url)` drops them. The query also counts rows
alongside the average and keeps a window only when it holds at least 5 requests, so one cold request
on a quiet window cannot page. The threshold is still 3000ms: as with the first fix, what changed is
the population the average is taken over, not the bar it is held to.

**`resilience-circuit-open` is the newest spec and the only one that reads a metric rather than a
request or dependency row.** `MMCA.Common`'s resilience pipelines emit the standard Polly
`resilience.polly.strategy.events` instrument, and the rule filters it to the `OnCircuitOpened`
event name on the `Properties` bag. Its threshold is **0**, so it fires on the **first** breaker
opening rather than on a rate, and the comment gives the reason (`main.bicep:361-363`): an open
circuit is already the failure mode the retry budget existed to absorb, and every caller behind it
is failing fast until the break window elapses, so there is nothing to average. That puts it in the
same "any hit is the incident" class as the outbox dead-letter rule below.

The `union(...)` in the criteria (`main.bicep:476-488`) supplies `metricMeasureColumn` only for the
aggregate rule. Omitting it (the empty-string case) makes a rule count returned **rows**, which is
what the three row-count SLOs want.

**Evaluation frequency matches the window: `PT15M` over `PT15M` with `autoMitigate: true`**
(`main.bicep:465-470`), as the loop's defaults. These rules used to re-evaluate every five minutes
over the same 15-minute window, and the template records why that changed (`main.bicep:455-459`): a scheduled-query rule is
billed per evaluation, and the 5-minute tier costs $1.47/month per rule against about $0.50 at 15
minutes, across four rules. Because `windowSize` was already `PT15M`, each evaluation still looks at
exactly the same 15 minutes of data, no threshold moves, and no rule is renamed; what disappears is
the overlapping evaluations the 5-minute frequency produced. The cost is detection latency: a breach
is now noticed within 15 minutes rather than 5, which is why the fast path is covered by the deploy
smoke gate rather than by these rules.

**Those three cadence fields, and `enabled`, are read with a safe dereference and a default**
(`spec.?evaluationFrequency ?? 'PT15M'` and its siblings, `main.bicep:453`, `:466-470`), because
exactly one entry needs something else: the AI token ceiling evaluates a two-day window twice a day
and switches itself off when no provider key is deployed (`main.bicep:461-464`). Each of the four
reads carries a `#disable-next-line BCP187`, and the reason is a failed pipeline rather than
tidiness (`main.bicep:446-451`): Bicep infers the array's element type from the entries that omit
the optional fields and reports an **Info** diagnostic on each read, and the deploy action runs with
`failOnStdErr`, so an Info line on stderr failed the step after the deployment itself had already
succeeded (2026-09-21, run 35567591059). It is the ARM-limit lesson of the AI alert below seen from
the other side: a template can be valid and applied while the pipeline that carried it still goes
red.

**The superseded metric alerts are gone from the template, and their `-v2` names are the residue.**
An earlier revision kept the three replaced `metricAlerts` declared under their original names with
`enabled: false`, because Incremental ARM never deletes a resource that simply leaves the template.
They have since been retired in Azure and dropped from the source; what remains is a comment
recording that the scheduled-query rules are now the SLO alerts and that the severity-1
availability metric alert stays because availability has no status-code confound
(`main.bicep:498-499`). The `-v2` suffix on the replacement names is still load-bearing, and the
template says why (`main.bicep:437-438`): the suffix is part of a rule's identity in Azure, so
renaming it would create a second rule alongside the live one rather than update it.

The action group (`main.bicep:310`) has an **unconditional** email receiver, which is the direct
consequence of `alertEmailAddress` being a required parameter. Every scheduled query rule routes to
it (`main.bicep:492`, `:569`, `:621`, and `:697` for the availability metric alert) and so does the
cost budget (`main.bicep:748`, `:756`). One group, one
receiver, no severity routing: severity is triage metadata, not a delivery decision.

Each SLO alert is paired with a same-severity triage section in `MMCA.ADC/infra/OPERATIONS.md`
(`OPERATIONS.md:17`, `:31`, `:50`, `:63`, `:111`), and that pairing is enforced by a framework fitness test rather
than by discipline: `ObservabilityConventionTestsBase` parses this template between the literal
anchors `var sloAlertSpecs` and `resource sloAlerts`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:109-110`)
and fails the build in both directions. ADC raises the base class's floor of three discovered specs
(`ObservabilityConventionTestsBase.cs:39`) to five
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:14`),
so a parse-anchor drift that found fewer specs fails rather than passing vacuously. That gate is covered in
[group 27](group-28-testing-infrastructure.md#observabilityconventiontestsbase); it is not
duplicated here. Note the coverage boundary, which the runbook itself spells out
(`OPERATIONS.md:151-160`): only alerts inside that parse window are gated, so the operational rules
and the availability alert below are provisioned but ungated, and their triage deliberately sits
under `####` headings so the parser does not read them as SLO runbook sections.

### Operational and availability alerts (`main.bicep:445-703`)

Beyond the five SLOs, `main.bicep` provisions **three** more scheduled query rules from
`scheduledQueryAlertSpecs` (`main.bicep:520`, materialized at `:541`), all severity 2 on a
15-minute evaluation over a 15-minute window:

- `outbox-dead-letter` (`main.bicep:521-526`) fires on **any** hit (`threshold: 0`) of an `AppTraces`
  row at Error or above whose message contains `dead-lettered`. An outbox message that exhausted its
  retries means an integration event was permanently lost. The row-age signal is DB-side and not
  queryable from Log Analytics, so this Error line _is_ the backlog alarm.
- `sql-dependency-failures` (`main.bicep:527-532`) fires above 10 failed SQL dependency calls. Every
  service owns exactly one database, so a burst here means a service cannot reach its own DB, which
  also stalls its outbox drain.
- `revision-activation-failed` (`main.bicep:533-538`) is the newest of the three and the most
  instructive, because it exists to catch a failure the rest of the alerting stack is blind to. It
  queries `ContainerAppSystemLogs_CL` for `Reason_s startswith "Deployment Progress Deadline
  Exceeded"` and fires on any hit. When a revision's readiness probe never goes green, Container
  Apps keeps the **previous** revision serving: nothing outside-in degrades, every SLO stays quiet,
  and the deploy looks fine while the newly built code never takes traffic. The comment names the
  incident that motivated it (`main.bicep:514-519`): the 2026-08-29 Redis readiness regression,
  where an untagged infrastructure health check failed `/health/ready` on every backend and the
  older revision kept 100% of the traffic for days. The rule works at all only because the
  environment's `appLogsConfiguration` sends platform system logs to the same workspace.

The two older rules each have a `####` triage section in the runbook (`OPERATIONS.md:163`, `:206`);
`revision-activation-failed` does not have one, which the ungated coverage boundary above allows,
and the runbook names it, with the ingestion-cap rule below, as the gap the honour system leaves
open (`OPERATIONS.md:157-159`). Its `description` field (`main.bicep:535`) carries the
first-response instructions instead.

**A fourth standalone rule watches the detector itself** (`main.bicep:593`, added 2026-09-07 as
SEC-ADC-47). `logIngestionCapAlert` is named `${prefix}-alert-log-ingestion-cap-reached`, fires at
severity 2 on any hit, and queries `_LogOperation` for an `Ingestion` / `Data collection Status`
record whose `Detail` contains `OverQuota` (`main.bicep:609`). Three decisions in it are worth
reading:

- **Why it exists at all** (`main.bicep:578-583`). Every other rule on this page queries the Log
  Analytics workspace, and the workspace has a daily ingestion cap (`foundation.bicep:53-55`). Once
  that cap is reached, ingestion stops for the rest of the UTC day and all of those rules evaluate
  empty data: the failure mode is not a missed alert, it is a blind detector that keeps reporting
  healthy. That also makes tripping the cap a viable first move for an attacker, which is why the
  cap itself pages.
- **Why `_LogOperation`** (`main.bicep:585-588`). That table is **cap-exempt**: it keeps recording
  after ingestion stops, which is the only reason a rule can fire at the moment it matters.
  Application tables (`AppRequests`, `AppTraces`, and the rest) cannot be exempted individually, so
  alerting on the cap event is the available control rather than table-level carve-outs.
- **Why `windowSize: 'PT1H'` against `evaluationFrequency: 'PT15M'`** (`main.bicep:590-592`,
  `:603-604`). The cap-reached record is written **once**. Overlapping windows are what stop an
  ingestion-latency skew from dropping that single row between two non-overlapping 15-minute
  buckets.

An outside-in availability signal sits alongside them: a standard URL-ping web test
(`main.bicep:632-664`) probes the public Gateway `/health` every **900 seconds** from three Azure
locations (East US, North Central US, South Central US), bound to the App Insights component via a
`hidden-link` tag. The cadence was 300 seconds until 2026-09-02, and the template records the
trade (`main.bicep:626-631`): standard web tests bill per location-execution, three locations every
five minutes came to $13.39/month on this subscription, and the **locations are unchanged**, so the
2-of-3 confirmation that keeps a single-location blip from paging is intact and only detection
latency moves, from about 5 minutes to about 15.

Its severity **1** alert (`main.bicep:665-703`) fires on a `failedLocationCount` of 2, and its
window had to move with the probe: `evaluationFrequency: 'PT15M'` over `windowSize: 'PT15M'`. The
reason is worth reading, because it is the failure mode a naive cadence change would have
introduced: at `Frequency: 900` each location reports once
per 15 minutes, so a `PT5M` window would usually be **empty** and the rule would evaluate nothing.
`PT15M` restores exactly one result per location per window, which is what `failedLocationCount`
counts, so the 2-of-3 threshold keeps its meaning without being renumbered. The runbook explains the
other non-obvious part (`OPERATIONS.md:246-249`): `/health` is the Gateway's readiness endpoint and
aggregates one `downstream-{name}` check per service, so a perfectly healthy Gateway can still fail
this probe because a backend is unhealthy. (The runbook's parenthetical still describes the probe as
5-minute, `OPERATIONS.md:236`; the template is the ground truth.)

[Rubric §29, Resilience, Reliability & Business Continuity] assesses whether the system can detect
degradation automatically and notify operators. The request, latency, dependency and circuit SLO rules, the three operational rules,
and the sev-1 availability alert all route to the same action group as the cost budget, giving the
on-call operator an automated signal for error rate, latency, dependency failures, permanent event
loss, database reachability, a silently failed rollout, and total entry-point outage. The 2026-09-02
cadence changes are the honest counterweight: this stack now trades roughly ten minutes of detection
latency for a materially smaller monitoring bill, and the deploy-time gates carry the fast path.

### AI-scoring token-ceiling alert (`main.bicep:383-432`)

One rule in the template watches a **third-party** meter, and it is the only alert here that
configuration can switch off. It is the fifth entry in `sloAlertSpecs` (`main.bicep:420-432`), so the
loop provisions it as `${prefix}-alert-ai-scoring-token-ceiling-v2` like every other SLO rule. It
fires at severity **3** and compares a two-day token total against the `aiScoringTokenCeiling`
parameter:

```bicep
key: 'ai-scoring-token-ceiling'
query: 'AppMetrics | where Name in ("mmca.ai.input_tokens", "mmca.ai.output_tokens") | summarize AggregatedValue = sum(Sum)'
timeAggregation: 'Total'
metricMeasureColumn: 'AggregatedValue'
threshold: aiScoringTokenCeiling
severity: 3
windowSize: 'P2D'
evaluationFrequency: 'PT12H'
autoMitigate: true
enabled: hasAiApiKey
```

Five decisions in it are worth reading, because each one is a constraint rather than a preference:

- **Why it lives inside the SLO array** (`main.bicep:383-387`). The alert-to-runbook pairing gate
  regex-parses only the text between its two literal anchors, so an entry assembled with a `concat`
  or declared as a standalone resource would be invisible to it. Inside the array it is gated like
  the other four, and its triage is the gated `###` section for
  `adc-prod-alert-ai-scoring-token-ceiling-v2` in the runbook (`OPERATIONS.md:111`). The same
  comment warns that because the anchors are literal strings, neither may appear in a comment inside
  the block either.
- **Why the rule exists at all** (`main.bicep:394-397`). Every scored submission is a paid call to
  the configured provider, and an organizer can trigger a full pass over an entire event's
  submissions. Nothing in the Azure budget resource sees that spend: it lands on the provider's
  invoice, not on the subscription. The cost risk is therefore a repeated or runaway pass, and this
  rule is the only signal that notices one.
- **Why it queries `AppMetrics`** (`main.bicep:389-393`). The counters `mmca.ai.input_tokens` and
  `mmca.ai.output_tokens` come from the **framework** meter `MMCA.Common.AI`: the governed
  `IChatClient` meters every model call, so they are not per-service. In a workspace-based component
  the classic `customMetrics` table surfaces under its workspace-schema name `AppMetrics`, the same
  schema family the other SLO rules query, with `Name` / `Sum` / `ItemCount` as its measure columns.
  The comment also closes the obvious worry (`main.bicep:400-402`): the two metric-group disables
  described in the App Insights section drop only the http-client and runtime instrument **groups**,
  so an application meter like this one keeps exporting.
- **Why `windowSize: 'P2D'` and `evaluationFrequency: 'PT12H'`** (`main.bicep:407-419`). These are the
  entry's overrides of the loop's 15-minute defaults, and both values are pinned by ARM-side limits
  that `az bicep build` cannot see, each learned from a rejected production deployment on 2026-09-05
  (`InvalidRequestContent` both times). Two days is the longest data range a scheduled query rule
  will evaluate: the first cut asked for a 30-day lookback through `overrideQueryTimeRange` and ARM
  rejected the **whole deployment** ("OverrideQueryTimeRange of 43200 minutes is not supported ...
  2880", run 33972401924). Twelve hours is then the least frequent cadence a **stateful** rule
  accepts: the second cut used `P1D` and was rejected with "Stateful rules can not run in a frequency
  greater than 12 hours. Either reduce frequency, or set 'AutoMitigate' property to false" (run
  33975403549). That is the failure mode worth remembering: an unsupported alert property does not
  degrade the alert, it fails the infrastructure deploy that carried it. `autoMitigate: true`
  (`main.bicep:430`) stays on deliberately, so the alert resolves itself once the two-day window
  rolls past the spike, and the second daily evaluation is the price of keeping it. A two-day rolling
  total against a single-pass envelope is the honest runaway signal anyway, since one legitimate pass
  fits inside it and a repeated one does not.
- **Why severity 3 and why `enabled: hasAiApiKey`** (`main.bicep:404-405`, `:398-399`). Nothing is
  down when a budget ceiling is crossed, so it must not page the way the sev-1 availability and sev-2
  failure rules do. And with no API key deployed the feature is inert and emits nothing, so an
  enabled rule could only ever evaluate zero while still billing per evaluation. The rule is
  therefore always provisioned and disabled rather than omitted, which keeps its name and its
  runbook pairing the same whichever way the key is set.

It routes to the same action group as every other SLO rule (`main.bicep:492`). Its runbook
(`OPERATIONS.md:111-147`) walks the triage in four steps: confirm the shape of the spend in
`AppMetrics`, attribute it to passes through the `Conference.ScoreEventSessions.v1` internal-command
rows, decide whether it is one legitimate large pass, a repeat or a runaway, and raise the ceiling
only after the last two are ruled out, since a ceiling raised to silence a loop buys the loop a
bigger budget.
[Rubric §31, Cost Efficiency / FinOps] assesses whether cost is actively monitored, bounded and
governed. This rule extends that discipline past the Azure bill: the budget resource below bounds
subscription spend, `cost-guard.yml` bounds a surge left un-reverted, and this bounds the one meter
that neither of them can see, with the envelope itself expressed as a reviewable Bicep parameter
rather than as an assumption inside the scoring code.

### SLO workbook (`main.bicep:704-724`)

A saved Azure Monitor workbook renders the same three SLO signals plus exceptions, grouped per
service by `AppRoleName` (which is the `OTEL_SERVICE_NAME` value). It is bound to the Log Analytics
workspace and embeds `workbooks/adc-slo-workbook.json` at **compile time** via `loadTextContent`
(`main.bicep:620`), so the visualization cannot diverge from the alerts by being maintained
somewhere else, and the JSON stays independently validatable as a file.

### Cost budget (`main.bicep:725-757`)

```bicep
resource costBudget 'Microsoft.Consumption/budgets@2023-11-01' = if (enableBudget) {
  properties: {
    amount: monthlyBudgetAmount      // default: $200 USD
    timeGrain: 'Monthly'
    notifications: {
      Actual_GreaterThan_80_Percent: { threshold: 80, thresholdType: 'Actual' }
      Forecasted_GreaterThan_100_Percent: { threshold: 100, thresholdType: 'Forecasted' }
    }
  }
}
```

The budget is scoped to the entire resource group (no tag filter) and covers the whole ADC
footprint. It fires at 80% of actual spend and 100% of forecasted spend, notifying both the email
address and the SLO action group (`main.bicep:647-648`, `:655-656`). The primary guard this budget
provides is against an un-reverted conference-day surge: the surge is a manual scale-up of the SQL
tier and the Container App replica caps, and left running for weeks it would push the monthly bill
well past $200 and trigger both thresholds long before the billing cycle closes. The
`cost-guard.yml` workflow is the same guard from the other direction: it is one of `deploy`'s
required gates (`deploy.yml:1237`, job at `:749`) and fails the deploy outright when a database is
off the Basic tier or an app's `maxReplicas` exceeds the `BASELINE_MAX_REPLICAS` of 2
(`cost-guard.yml:25`, `:61`, `:76`).

`enableBudget: bool` (`main.bicep:132`) allows disabling the resource when the deploy identity
lacks `Microsoft.Consumption/budgets/write` (as is the case in some sponsor subscriptions).
`budgetStartDate` (`main.bicep:154`) is pinned at creation and must not change on an existing
budget, ARM rejects start-date changes on update. The comment in `main.bicep:137` records this
constraint directly so future operators don't hit the ARM error.

[Rubric §31, Cost Efficiency / FinOps] assesses whether infrastructure cost is actively
monitored, bounded, and governed. The budget resource, the `enableBudget` escape hatch, the
workspace daily ingestion cap, the 25% trace sampling, the Warning log floor, the two
metric-group disables, the 300-second metric export interval, the 30-second readiness probes, the
15-minute alert and web-test cadences, the AI-scoring token ceiling on the one meter Azure cannot
see, the uniform 0.25 vCPU container sizing, the two-step daily
ACR purge task, the `commonTags` applied to every billable resource (`main.bicep:176-182`), and the per-service
`service` tag on the six container apps and four databases (`main.bicep:173-175`)
together satisfy this category: tags enable cost attribution; the caps bound runaway spend at the
telemetry, storage, monitoring and compute ends; and the budget threshold notifications make the cap
actionable. The August 2026 bill of $256 is what motivated the 2026-09-02 pass, and every reduction
in it carries its measurement in the comment beside it.

### SQL Server and databases (`main.bicep:762-1001`)

**SQL Server** (`main.bicep:765-776`):
```
name: '${prefix}-sql-${resourceToken}'
version: '12.0'
minimalTlsVersion: '1.2'
publicNetworkAccess: 'Enabled'
```

`publicNetworkAccess: 'Enabled'` (`main.bicep:774`) combined with the firewall rule
`AllowAzureServices` (`main.bicep:778-785`, startIpAddress/endIpAddress both `0.0.0.0`) is the
Azure-standard pattern for allowing Container Apps to reach SQL without a VNet/private endpoint.
The `0.0.0.0-0.0.0.0` rule does not allow traffic from arbitrary internet IPs; it enables the
special "allow Azure services" flag. `minimalTlsVersion: '1.2'` (`main.bicep:773`) ensures all
connections are encrypted at TLS 1.2 minimum.

**Entra (Azure AD) admin** (`main.bicep:793-802`), provisioned only when `sqlAadAdminObjectId` is
supplied. It is deliberately **additive**: it enables Entra auth alongside the SQL admin login and
does **not** set `azureADOnlyAuthentication`, so password auth keeps working throughout the
transition (`main.bicep:787-792`). Its purpose is to let an operator run the per-database
`CREATE USER [adc-prod-apps-identity] FROM EXTERNAL PROVIDER` grants that managed-identity app auth
depends on. Full sequencing lives in `infra/SQL-MANAGED-IDENTITY.md`; the staged model is described
in the Key Vault section below.

**SQL security auditing** (`main.bicep:804-883`, added 2026-09-07 as SEC-ADC-46) is the server-level
half of this section's auditing and closes the gap that made the two facts above uncomfortable together: with the
shipped default the four services connect as the **server admin** over a public endpoint reachable
from any Azure tenant, so a leaked connection string was both fully privileged and completely
unlogged, and post-incident scoping was impossible (`main.bicep:807-810`). `sqlServerAuditing`
(`main.bicep:827-844`) enables server-level auditing with `isAzureMonitorTargetEnabled: true`, which
targets Azure Monitor rather than a storage account, and the stream reaches the workspace through a
`SQLSecurityAuditEvents` diagnostic setting on the server's **master** database
(`main.bicep:847-850` declares `master` as `existing`, `:854` attaches the setting). That
master-scoped setting is the documented ARM shape for server-level auditing and covers all four
`ADC_*` databases for server-level events. It carries no database-level audit events, which is
why the audit-trail policies below add a setting of their own on each database they audit.

The `auditActionsAndGroups` list (`main.bicep:833-841`) is the load-bearing part, and the comment
says why (`main.bicep:818-824`): leaving it unset applies the Azure default set, which includes
`BATCH_COMPLETED_GROUP`, one audit row per T-SQL batch, meaning every EF query from six apps. That
alone would dwarf the roughly 0.4 GB/day application baseline and could trip the workspace daily cap
by itself, which would blind every log-based rule above. The explicit list is authentication plus
privilege and schema-change groups only (`SUCCESSFUL_DATABASE_AUTHENTICATION_GROUP`,
`FAILED_DATABASE_AUTHENTICATION_GROUP`, `DATABASE_PRINCIPAL_CHANGE_GROUP`,
`DATABASE_ROLE_MEMBER_CHANGE_GROUP`, `DATABASE_PERMISSION_CHANGE_GROUP`,
`DATABASE_OBJECT_PERMISSION_CHANGE_GROUP`, `SCHEMA_OBJECT_CHANGE_GROUP`), which fire on
connection-pool opens and on DDL (the startup migrations), not per query: tens of MB/day at this
scale. The template states the rule for anyone extending it: do not add `BATCH_COMPLETED_GROUP`
without re-sizing `dailyQuotaGb` in `foundation.bicep` first.

**Audit-trail DML auditing** (`main.bicep:937-1001`,
[ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)) closes the one gap the
server-level list leaves by design. The application's own audit trail, `dbo.AuditTrailEntries`,
lives in the same database as the rows it audits, and the services connect with the server
administrator login, so whoever holds that login can rewrite trail rows, and the server-level
policy, which records no statements, would leave no record of it (`main.bicep:940-948`). Two
resources close it, both looped over `serviceDatabaseNames` and filtered to
`auditTrailDatabaseNames` (`main.bicep:962-966`): `ADC_Identity`, `ADC_Conference` and
`ADC_Engagement`. Notification has no audited entities, so it has no trail table and no policy.

- `auditTrailDmlAuditing` (`main.bicep:984-1001`) is a **database-level** `auditingSettings`
  with exactly two object-scoped actions, `UPDATE ON dbo.AuditTrailEntries BY public` and
  `DELETE ON dbo.AuditTrailEntries BY public` (`main.bicep:991-994`). The
  `{action} ON {object} BY {principal}` form is valid only on a database policy, never on the
  server one, and `BY public` covers every principal, the admin login included
  (`main.bicep:952-954`).
- `auditTrailDiagnostics` (`main.bicep:968-982`) is the matching `SQLSecurityAuditEvents`
  diagnostic setting scoped to **that** database. Both halves are required: a database-level audit
  routed to Azure Monitor reaches the workspace only through a setting on its own database, since
  the master-scoped setting above carries server-level events only, and the `dependsOn`
  (`main.bicep:997-999`) makes the sink exist before auditing is switched on
  (`main.bicep:958-961`).

Object-scoped actions rather than `BATCH_COMPLETED_GROUP` is the same volume rule applied again:
the trail is append-only in normal operation (the application inserts, never updates or deletes),
so these actions fire only on tampering and on the retention purge, near-zero volume that needs no
change to `dailyQuotaGb`, where the batch group would record every EF query from six apps
(`main.bicep:950-956`). What it buys is a tamper-evident trail: the copy the audited party can
rewrite is no longer the only copy. The server-level comment points at these policies
(`main.bicep:824-826`), and `SqlAuditConventionTests`
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/SqlAuditConventionTests.cs:12`)
pins both actions and the three databases in the embedded `main.bicep`, so dropping either half
fails a test rather than a later incident review.

[Rubric §11, Security] assesses whether privileged data access is attributable. This is the data end
of the same audit pass as the ACR, Key Vault, Service Bus and blob diagnostic settings: every one of
them trades a small, sized amount of ingestion for a trail, and every one of them is deliberately
scoped to the categories that carry a security signal rather than to everything the platform can
emit.

**The legacy `AtlDevCon` database is gone, and its absence is documented in place**
(`main.bicep:871-883`). After the database-per-service cutover it served no application, its data
had already been copied into the four `ADC_*` databases, and it then sat at 32 MB and 0 DTU for a
whole summer while still billing as a Basic database. On 2026-09-02 it was exported to the bacpac
blob `sql-archive/AtlDevCon-20260902.bacpac` in storage account `adcprodstpys4way4uzb3g` and
dropped by hand. Two things about that sequence are the lesson:

- **Removing the resource from the template did not delete it.** Incremental mode never deletes an
  absent resource, so the drop was a deliberate operator action taken *after* the template stopped
  declaring it. Deleting a line of Bicep is a decommission only when someone finishes the job.
- **The bacpac, not LTR, is now the rollback source of record.** The comment carries the restore
  path (`az sql db import` of that blob, about ten minutes), and the full history and exact commands
  live in `infra/POST-CUTOVER-atldevcon-downgrade.md`. `DISASTER-RECOVERY.md:45` states the same
  boundary from the recovery side: the archive is deliberately outside PITR and LTR.

The comment also flags a trap for anyone scripting against this resource group
(`main.bicep:881-883`): a SQL server literally named `atldevcon` (westus2) also lives in `acc-rg`,
predates MMCA entirely, and must never be referenced, scaled or deleted as if it belonged to this
deployment.

**Per-service databases** (`main.bicep:892-917`), `[Rubric §8, Data Architecture]`:

```bicep
var serviceDatabaseNames = [
  'ADC_Identity'
  'ADC_Conference'
  'ADC_Engagement'
  'ADC_Notification'
]

resource serviceDatabases '…/databases@…' = [
  for dbName in serviceDatabaseNames: {
    sku: { name: 'Basic', tier: 'Basic', capacity: 5 }
    properties: { maxSizeBytes: 2147483648 }  // 2 GB Basic cap, must be exact
  }
]
```

Since the archive was dropped, these four **are** the entire application data estate
(`main.bicep:887-890`). [Rubric §8, Data Architecture] assesses deliberate persistence strategy
including transactions, isolation, migrations, and bounded ownership. The four separate databases
implement [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html): each
service owns exactly its data; no cross-database foreign keys exist; each service's outbox
(`OutboxMessages` table) lives in its own database so the outbox processor never races for another
service's rows. See [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) and
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) for the full rationale.

Each database also carries a `service` tag derived from its name (`ADC_Conference` becomes
`conference`, `main.bicep:903-905`), the same dimension its owning container app carries, so one
tag-grouped cost report covers compute and storage per service.

[Rubric §7, Microservices Readiness] assesses whether the service boundary includes data
autonomy, not just code autonomy. These four Basic-tier databases on one SQL server are the
cheapest expression of full data autonomy: each service has an independent schema, independent
migrations, independent outbox, and can be moved to its own server later without application
changes.

**Long-term backup retention (LTR)** (`main.bicep:924-935`):

```bicep
resource serviceDatabaseLtr '…/backupLongTermRetentionPolicies@…' = [
  for (dbName, i) in serviceDatabaseNames: {
    properties: {
      weeklyRetention:  'P4W'
      monthlyRetention: 'P12M'
      yearlyRetention:  'P1Y'
      weekOfYear: 1
    }
  }
]
```

Basic tier already provides 7-day PITR (point-in-time recovery) with geo-redundant backups; LTR
adds weekly (4-week), monthly (12-month), and yearly (1-year) archival on top (`main.bicep:919-923`).
The practical value: a corrupted migration or a data-loss bug discovered three weeks after the fact
is still recoverable. The loop covers every database on the server, because after the archive drop
every database on the server is live.

[Rubric §29, Resilience, Reliability & Business Continuity] extends to data recovery. LTR on
the live per-service databases means every production restore scenario, bad migration, silent
corruption, regulatory request for historical data, has a recovery path beyond the 7-day PITR
window. The disaster-recovery runbook at `MMCA.ADC/infra/DISASTER-RECOVERY.md` documents the
drilled restore procedure ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)),
and `OPERATIONS.md:155-157` records the measured drill result (about 2.6 minutes against a 2 hour
RTO target) plus the `dr-freshness` gate that keeps the proof current.

### Azure Service Bus (`main.bicep:1003-1129`)

```
sku: Standard   // Basic rejected: MassTransit requires topics, Basic supports queues only
minimumTlsVersion: '1.2'
```

The Standard tier comment at `main.bicep:1011-1015` is the explanation of a constraint that has
bitten the project before: MassTransit's `UsingAzureServiceBus` auto-provisions
one topic per message type and one subscription per consumer, Basic tier has no topics, only
queues, so it silently fails at MassTransit startup. Standard tier costs a flat ~$10/month base for
the namespace plus per-million-operations, and the link/unlink flows are far below 1k messages a
month even at conference scale.

**There is no namespace-wide shared credential any more.** The single `app-clients` SAS rule was
replaced (SEC-ADC-26) by **four** per-service authorization rules, one per app that talks to the
bus: `identity-service` (`main.bicep:1060-1070`), `conference-service` (`:1072-1082`),
`engagement-service` (`:1084-1094`) and `notification-service` (`:1096-1106`). Each service's
connection string is composed from its own rule's `listKeys()` result (`main.bicep:204-207`) and
written into its own Key Vault secret, so a key is independently revocable and rotatable, a leak is
attributable to one service, and re-keying a compromised container no longer means re-keying all
six apps (`main.bicep:1029-1031`).

**All four rules still carry `Send + Listen + Manage`, and the template is explicit that this is the
uncomfortable half of the change** (`main.bicep:1033-1045`). MassTransit provisions its own topology
through the management plane at **bus start, every start**, not once: Identity, Conference and
Engagement register integration-event consumers (Engagement consumes `AttendeeCheckedIn`,
`SessionFeedbackSubmitted`, `EventFeedbackSubmitted` and `UserDeleted`, including a self-consumption
round trip) so they create queues plus topic subscriptions, and Notification is publisher-only but
still creates the message-type topic on first publish. Every one of those is a `Manage` operation,
so dropping the right from any rule breaks that service's startup. Pre-declaring the entities in
Bicep is not the escape: it would hard-code MassTransit's entity-name convention, force an
infrastructure redeploy for every new event type, and still fail at startup on any name mismatch
because the bus goes on attempting the create. Entity-scoped SAS rules are not a third option
either, since they cannot be declared before entities that MassTransit creates at runtime
(`main.bicep:1058-1059`).

The residual risk is recorded rather than closed (`main.bicep:1047-1057`): a compromised container
still holds namespace-wide `Send + Listen + Manage`, so it can forge an integration event on any
topic, drain any subscription, or rewrite the topology. What the split buys is credential separation
and revocability, not privilege reduction. Closing the privilege gap needs either MMCA.Common
configuring MassTransit to stop deploying topology (so the runtime credential can drop to
`Send`/`Listen`) plus Bicep-declared topics and subscriptions, or Entra RBAC with Data Sender /
Data Receiver on a **per-service** identity, which needs role-assignment writes the deploy identity
does not have ([ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)),
one identity per service (the six apps share `adc-prod-apps-identity` today), and an MMCA.Common
change because `ResolveBrokerConnectionString` takes a connection string rather than a
fully-qualified namespace plus `TokenCredential`. The runbook restates the tier and rights
constraint as a triage step (`OPERATIONS.md:86-88`): a tier downgrade or a rights reduction looks
like a publish failure on every service at once.

A namespace diagnostic setting (`main.bicep:1117-1129`) forwards `OperationalLogs` to the workspace,
which records entity create/update/delete and authorization-rule changes: exactly the trail that was
missing while one shared `Manage` credential could rewrite the topology. It is deliberately narrow
(`main.bicep:1111-1116`): `AllMetrics` is off (no security signal, pure ingestion) and
`RuntimeAuditLogs` is left as a follow-up because its tier support varies and an unsupported
category is rejected at deploy time, not at build time. Volume is low, because topology changes
happen at service startup, not per message.

Current integration event flows wired over Service Bus (documented at `main.bicep:1006-1009`):
- Identity publishes `UserRegistered` → Conference `UserRegisteredHandler` auto-links a speaker
  by email match (BR-207).
- Conference publishes `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser` → Identity updates
  `User.LinkedSpeakerId` (BR-209/BR-70).

These events cross service boundaries asynchronously via the outbox + MassTransit; the Service Bus
namespace is the transport that carries them in production (RabbitMQ fills the same role locally).
All four services receive `MessageBus__Provider` and `MessageBus__ConnectionString`, but only
Identity and Conference call `AddBrokerMessaging` today: the Engagement and Notification entries are
pre-provisioned forward-compatible wiring, and the template shows it in each app's env block
(`main.bicep:2060-2061`, `:2209-2210`), so adding a consumer later is a `Program.cs` change with no
infra redeploy.

### Azure Notification Hub (`main.bicep:1135-1159`), referenced, never deployed

The [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) native-push fan-out
(FCM v1 and APNs) has a topology that is real in Azure but is **not created by this template**. The
namespace, the `adc-push` hub, and its `app-backend` authorization rule are all declared with the
`existing` keyword (`main.bicep:1135`, `:1139`, `:1147`), and the comment above them records why
(`main.bicep:1127-1134`): ARM PUTs on this namespace never reach a terminal state. It reports status
`Created` rather than `Active`, so a template deployment polls until the deploy job times out, hit
twice on 2026-08-24 across two API versions. The resources are therefore provisioned by hand
(`az rest`, runbook section 5) and merely referenced here.

That changes what the two parameters mean, and it is the single most misreadable part of this
template. `deployNotificationHub` (`main.bicep:130`) defaults to **true** and gates only the
*wiring*: the Key Vault connection-string secret (`main.bicep:1531-1535`), the Notification app's
`secretRef` entry (`:2141`), and its three `NativePush__*` env vars (`:2218-2220`). When it is true
the hub resources must already exist, or the `listKeys()` call against the auth rule fails.
`nativePushEnabled` (`main.bicep:127`, also default true) is the second switch and only decides
the value of `NativePush__Enabled` (`:2218`). With the vars absent entirely, the service's own
`appsettings` default of `NativePush:Enabled=false` keeps the channel inert. The hub's Free tier
covers 500 devices and 1M pushes per month, far above conference volumes.

### Blob storage: avatars, session assets and the DataProtection key ring (`main.bicep:1160-1355`), [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)

One `Standard_LRS` StorageV2 account (`main.bicep:1160-1202`) carries **three** declared containers on
the same `default` blob service. The first is the public-read `avatars` container
(`main.bicep:1239-1245`). Public read is deliberate: avatar URLs render in `<img>` tags on
anonymous-visible surfaces with no SAS plumbing, and blob names carry a random suffix so they are
not enumerable. The account sets `minimumTlsVersion: 'TLS1_2'` and `supportsHttpsTrafficOnly: true`.

Two account-level switches sit beside them and both are hardening knobs with a stated reason for
**not** being flipped yet. `allowSharedKeyAccess` is bound to the `storageAllowSharedKeyAccess`
parameter, default `true` (`main.bicep:1189`, parameter at `:138-139`), and the comment explains why
the current behavior is kept (`main.bicep:1172-1188`): the application path is already key-free
(apps get `FileStorage__ServiceUri` and `DataProtection__BlobStorageUri` as URIs and authenticate
with the shared managed identity, and nothing in `infra/` or `.github/workflows/` calls `listKeys`
on this account), but the **disaster-recovery** path is not. `infra/POST-CUTOVER-atldevcon-downgrade.md`
documents `az sql db import --storage-key-type StorageAccessKey` against this account for the
`AtlDevCon` bacpac, which is the last-resort source of record for pre-cutover data, so turning Shared
Key off before that runbook is re-cut to a user-delegation SAS would break recovery rather than the
apps. `defaultToOAuthAuthentication: true` (`main.bicep:1195`) is set unconditionally because it is
portal-scoped only: it makes Entra the default when a data-plane request states no authorization
method, without blocking explicit Shared Key callers and without touching anonymous reads of the
public containers. A third option is documented as deliberately **not** taken
(`main.bicep:1196-1200`): `networkAcls.defaultAction: 'Deny'` would break avatar rendering for every
visitor, because the container is served straight to anonymous browsers and this topology has no
VNet, private endpoint or CDN.

A blob-service diagnostic setting (`main.bicep:1217-1237`) forwards `StorageRead`, `StorageWrite`
and `StorageDelete` to the workspace, and the comment names the single event that justifies the
volume (`main.bicep:1209-1216`): this is the only place a read of `dataprotection-keys/keys.xml` can
ever be observed, so without it a key-ring theft leaves no trace at all. `StorageRead` is the
highest-volume of the three because anonymous avatar GETs dominate it, and the template names it as
the first category to drop if the log-ingestion-cap alert ever fires.

The second container is `session-assets` (`main.bicep:1255-1261`), added with the speaker
session-assets feature: the decks, handouts and archives a speaker uploads for a session. It is
public-read for the same reason as `avatars` and the comment says so plainly
(`main.bicep:1247-1254`): these files exist to be downloaded by anyone browsing the public session
page, so a SAS-per-download path would mint a token on every page render for content that is already
published. What keeps a file from being enumerable is the blob **name**,
`{eventId}/{sessionId}/{assetId}/{file}`, where `assetId` is a server-minted GUID, so knowing one
asset's URL reveals nothing about any other. Nothing personal is stored there; a speaker uploading
material is publishing it.

That container is also the reason for `sessionAssetMalwareScanning` (`main.bicep:1315-1331`), a
Microsoft Defender for Storage setting declared `if (enableSessionAssetMalwareScanning)` with the
parameter defaulting to **true** (`main.bicep:135-136`). It scans every upload on arrival, with
`capGBPerMonth: 50` and `sensitiveDataDiscovery` off. The guard started life as an opt-in knob, off
by default, for the reason `grantAvatarStorageRole` still is one: a write the deploy identity may not
be allowed to make fails the **whole** deployment rather than just this resource. The template
records why that reason no longer applies (`main.bicep:135`, `:1306-1309`): the deploy identity
holds Contributor on the resource group, which covers
`Microsoft.Security/defenderForStorageSettings/write` (verified 2026-09-21). The cap is the part that
did not change. This is still the one resource in the template billed per GB scanned, so the monthly
cap bounds a runaway or malicious upload burst and scanning simply stops for the rest of the month
once it is reached, which the comment calls the correct failure mode for defence in depth. The
parameter description sizes the risk (`main.bicep:135`): session assets are slide decks and speaker
headshots for one annual conference, so the cap is a bound on a burst rather than a budget anyone
expects to reach. Sensitive-data discovery is off because the account holds published conference
material and avatars, not records to classify, and it is priced separately. Scanning is defence in
depth here rather than the only control: the ADR-045 upload path already gates format by magic bytes
and stores under an unguessable asset id. Setting the parameter to `false` turns scanning off.

The third container is `dataProtectionKeysContainer` (`main.bicep:1268-1274`), named `dataprotection-keys` and
explicitly `publicAccess: 'None'`. It holds the shared ASP.NET Core DataProtection key ring for the
two apps that mint cookies (Identity and UI), and its privacy is the whole point of declaring it
separately rather than reusing `avatars`: a key ring readable anonymously would hand out the keys
that protect every auth cookie and antiforgery token in the system. The comment above it
(`main.bicep:1263-1267`) states the failure it prevents: both apps run at `maxReplicas: 2`, and the
default in-memory key ring is per replica, so a token minted by one replica is undecryptable by the
other. The per-app wiring is in the Identity and UI subsections below.

This same account also holds a third, **undeclared** container: `sql-archive`, where the
`AtlDevCon-20260902.bacpac` archive lives (`main.bicep:868`). It was created out of band by the
export command and the template does not manage it, which is worth knowing before assuming the two
declared containers are the whole account.

The Identity service authenticates to it with `DefaultAzureCredential` resolving the shared apps
identity, so there is no connection-string secret. Control-plane ownership of the account does not
grant blob writes, though: the `Storage Blob Data Contributor` data-plane assignment
(`main.bicep:1288-1297`) is what does, and it is guarded by `grantAvatarStorageRole`, default `false`,
for exactly the same reason as the Key Vault grants. Until an operator applies it once by hand,
avatar uploads fail cleanly with `FileStorage.UploadFailed` and everything else deploys. That one
assignment is scoped to the storage **account**, not to a container, so it also covers the key-ring
container: the shared key ring needs no second role assignment, and the template says so
(`main.bicep:1281-1283`).

[Rubric §11, Security] assesses credential and key handling. One follow-up is recorded in the
template as **not implemented** (`main.bicep:1284-1287`): encrypting the key ring at rest with a Key
Vault key (`DataProtection__KeyVaultKeyUri`) would need a separate Key Vault Crypto User grant on
the apps identity, and neither the env var nor the grant exists today. The comment states the
reason blob persistence deliberately works without it: a missing or delayed crypto grant would
otherwise be able to break authentication outright, so at-rest encryption is kept as independent
hardening rather than a prerequisite. The framework side is built the same way, with the key-vault
step behind its own gate on `DataProtection:KeyVaultKeyUri`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:74-85`),
so the infrastructure gap and the code path agree.

### Azure Managed Redis (`main.bicep:1364-1395`)

One shared `Microsoft.Cache/redisEnterprise` instance at the `Balanced_B0` SKU (1 GB, HA disabled,
around $13/month) with a single `default` database on port 10000, encrypted client protocol,
`OSSCluster` clustering, `VolatileLRU` eviction and both persistence modes off
(`main.bicep:1364-1392`). Volatile-only eviction is deliberate: cache entries and idempotency records
carry TTLs, and a key without a TTL must never be silently evicted (`main.bicep:1386`).

Every service gets `ConnectionStrings__redis` from the vault, and three consumers activate on that
key alone with no application change (`main.bicep:1336-1344`):

1. `ICacheService` upgrades from a per-replica `MemoryCache` to `DistributedCacheService`, which
   makes the `IdempotencyFilter`'s 24h replay records cross-replica (with `maxReplicas: 2` a
   duplicate POST routed to the other replica used to execute twice) and propagates
   `CachingQueryDecorator` invalidation to every replica.
2. `AddRedisDistributedCache` in each service `Program.cs`, conditional on the same key.
3. The Notification SignalR backplane auto-wires when the key appears, via
   `MMCA.Common.Infrastructure`'s `AddPushNotifications`.

The `OSSCluster` clustering policy is worth noting alongside the `revision-activation-failed` alert
above: this is the resource whose readiness interaction silently pinned production to an old
revision for four days in 2026-08 (`deploy.yml:1614-1619`).

### Container Apps environment (`main.bicep:1397-1420`)

```bicep
resource containerAppEnv '…/managedEnvironments@2024-03-01' = {
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}
```

All six container apps share one managed environment, which means they share the same virtual
network, the same Log Analytics sink for container-level logs (stdout/stderr) and platform system
logs, and the same internal DNS resolution. An app can reach another by its Container App name (e.g.
`http://adc-prod-identity`) because the ACA environment's internal DNS resolves Container App
names as hostnames within the environment.

### UAMI and ACR credential model (`main.bicep:1422-1435`)

[Rubric §11, Security] assesses credential handling as one of its primary axes.

```bicep
resource appsIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@…' existing = {
  name: 'adc-prod-apps-identity'
}

var acrRegistry = {
  server: acr.properties.loginServer
  identity: appsIdentity.id    // pull via UAMI, no admin password
}
```

`appsIdentity` is a User-Assigned Managed Identity (UAMI) bootstrapped out-of-band (one-time admin
operation) with `AcrPull` on the registry and `Key Vault Secrets User` on the vault. The Bicep
template only *references* it (`existing` keyword, `main.bicep:1427-1429`), not creates it, because
the deploy identity (also a UAMI, used by GitHub Actions via OIDC) has `Contributor` but not
`Microsoft.Authorization/roleAssignments/write` (`main.bicep:1422-1426`), creating role assignments
requires elevated permissions deliberately withheld from the CI identity.

Every container app resource declares the same identity:

```bicep
identity: {
  type: 'UserAssigned'
  userAssignedIdentities: { '${appsIdentity.id}': {} }
}
```

This makes the UAMI the app's runtime identity. At startup, when the host reads the vault as a
configuration source, it authenticates via the UAMI, no connection strings, no certificates,
no long-lived secrets in the container environment. Image pull from ACR works the same way: the
ACA environment presents the UAMI's credentials to ACR when pulling, replacing what would
otherwise be an admin-user password stored in a Container App secret.

The GitHub Actions deploy identity authenticates to Azure via **OIDC** (`deploy.yml:1289-1294`, and
the same block in the `foundation` and `build-images` jobs at `deploy.yml:1108-1113`, `:1175-1180`):
```yaml
- name: Log in to Azure
  uses: azure/login@v3
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

No `client-secret` is present, this is the OIDC federated credential flow: GitHub's OIDC
provider issues a short-lived JWT for the workflow run, Azure AD validates it against the
registered federation, and issues a scoped access token that expires when the workflow ends. There
are zero long-lived Azure credentials in the repository.

One non-obvious constraint: `environment: production` on a job is **required for the OIDC login
itself**, not just for approval gates. The federated identity credential's subject is
`repo:ivanball/ADC:environment:production`, so a job without it presents
`repo:ivanball/ADC:ref:refs/heads/main` instead and `azure/login` fails with AADSTS700213
(`deploy.yml:1094-1099`, which also names the MMCA.Store run that proved it). Every job that runs
`azure/login` therefore declares it, including `cost-guard.yml`'s read-only surge check
(`cost-guard.yml:31-32`).

### Key Vault and runtime secrets (`main.bicep:1440-1596`), [ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)

```bicep
resource keyVault '…/vaults@…' existing = {
  name: 'adckv${resourceToken}'
}
```

**Every production secret lives in Key Vault and reaches a Container App as a reference, never as a
value.** Key Vault is bootstrapped out-of-band like the identity: the template declares it `existing`
(`main.bicep:1440-1442`) and then writes nineteen secret child resources into it
(`main.bicep:1488-1596`). Each Container App references them by Key Vault URI through the shared UAMI:

```bicep
secrets: [
  {
    name: 'sql-connection-string'
    keyVaultUrl: kvIdentitySqlConn.properties.secretUri
    identity: appsIdentity.id
  }
  ...
]
```

This is the `keyVaultUrl` + `identity` pattern in ACA (Container Apps Secrets backed by Key Vault):
the secret value never appears in the Container App definition, the ARM deployment history, or
deployment logs. Not one `secrets` entry in this template carries an inline `value`. Containers then
consume them only through `secretRef` (for example `main.bicep:1679`, `:1897`, `:2030`, `:2180`,
`:2220`). At runtime ACA fetches the current secret version via the UAMI's Key Vault Secrets User
role, meaning a secret rotation only requires updating the Key Vault secret, no Bicep re-deployment,
no app restart.

Secrets stored in Key Vault (`main.bicep:1488-1596`), eighteen unconditional plus one gated:
- Per-service SQL connection strings (4): `kvIdentitySqlConn`, `kvConferenceSqlConn`,
  `kvEngagementSqlConn`, `kvNotificationSqlConn` (`main.bicep:1488-1507`)
- Per-service Service Bus connection strings (4), one per SAS rule rather than one shared
  namespace credential: `kvIdentityServiceBusConn`, `kvConferenceServiceBusConn`,
  `kvEngagementServiceBusConn`, `kvNotificationServiceBusConn` (`main.bicep:1511-1530`)
- `kvRedisConn` (`:1544`)
- the notification-hub connection string, the one conditional secret, written only when
  `deployNotificationHub` is true (`main.bicep:1531-1535`)
- `kvRsaPrivate`, `kvRsaPublic` (`:1554`, `:1554`), both always real values because the
  parameters are required
- `kvSmtpPassword` (`:1559`), `kvSyntheticTrafficSecret` (`:1566`), `kvTrustedCallerSecret`
  (`:1576`), `kvGitHubOAuthSecret` (`:1581`), `kvGoogleOAuthSecret` (`:1586`),
  `kvAppleOAuthPrivateKey` (`:1591`), `kvAnthropicKey` (`:1596`; still named `anthropic-api-key`,
  `:1598`, and now fed from `aiApiKey`)

Two more vault-scoped resources sit with them. `keyVaultDiagnostics` (`main.bicep:1459`) forwards the
vault's `AuditEvent` category to the workspace, so a secret read is attributable in the same place
the ACR, Service Bus, blob and SQL audit streams land. `dataProtectionKek` (`main.bicep:1483`) is an
RSA key created only when `createDataProtectionKeyVaultKey` is true (parameter at `:141-142`, default
`false`), and it is the first of the three independently reversible steps that would encrypt the
DataProtection key ring at rest: mint the key, grant the apps identity Key Vault Crypto User by hand
(a role-assignment write the deploy identity deliberately lacks), and only then set
`dataProtectionKeyVaultKeyUri` (`:144-145`), which is what injects
`DataProtection__KeyVaultKeyUri` on Identity (`main.bicep:1770`) and the UI (`:2498`). With the URI
set and the role missing, both hosts fail to wrap the key ring and authentication breaks, which is
why the switch-on is a separate knob from the key.

The composite strings (Redis, Service Bus, and the four SQL connection strings) are assembled at
deploy time from `listKeys()` results and the SQL server FQDN, and written straight into the vault,
so the assembled value never lands in app configuration at all.

All `@secure()` parameters that arrive as `''` (empty) are stored as `'unused'` rather than empty
string, because Key Vault rejects empty-string secret values. The application code never reads a
`'unused'` value: the `hasGitHubOAuth`, `hasAppleOAuth`, `hasSyntheticTrafficSecret` and similar
flags control which `secrets` entries and env vars are injected into each container, so the
`'unused'` placeholder is never reachable by running code. The cost is that the vault is a poor
inventory: an `unused` secret is indistinguishable from a configured one, and only an app's
`secrets` list says which credentials are actually live.

**The two front-door apps hold almost nothing, and both hold it conditionally.** The UI's whole
`secrets` array is one entry behind `hasTrustedCallerSecret` (`main.bicep:2449-2451`): the
trusted-internal-caller key it presents to the Gateway on its server-side calls. Those calls all
leave from one container address, so without the exemption the Gateway's per-IP rate-limit window
would collapse the whole site into a single partition (`main.bicep:2445-2448`). The Gateway holds
the two rate-limiter keys and nothing else, unioned rather than kept as one conditional array so
either can be present on its own (`main.bicep:2303-2312`): the synthetic-traffic bypass key
(`:2304-2305`) and the same trusted-caller key from the other end (`:2309-2310`), both resolved
through the shared identity. A pure YARP proxy needs no credential to forward a request; it needs
one only to recognise the monthly capacity proof's bypass header and its own front end.

**Both role assignments are bootstrapped out of band, deliberately.** The deploy identity holds Key
Vault Secrets Officer to write the values; the apps hold Key Vault Secrets User to read them; the
vault and both grants are created outside the template because the deploy principal has Contributor
without `Microsoft.Authorization/roleAssignments/write` (`main.bicep:1432-1435`). A template that
created its own role assignments would need exactly the permission the deployment deliberately does
not have. The trade-off is stated in the ADR: one shared identity means any app carrying it can read
**every** secret in the vault, not only the ones its own `secrets` list names, and the template
cannot report that a grant is missing.

**The same grant also backs a second, different consumption path.** Alongside the platform-resolved
`keyVaultUrl` secret references above, all six apps receive `KeyVault__Uri`
(`main.bicep:1724` Identity, `:1918` Conference, `:2058` Engagement, `:2212` Notification, `:2353`
Gateway, `:2483` UI), which turns the vault into an ASP.NET Core **configuration source**:
`MMCA.Common`'s `AddCommonKeyVaultConfiguration` is a no-op without the key, and with it the host reads the vault
synchronously at startup through `DefaultAzureCredential`. The Gateway is in that list as well, and
the template comment names all six deployables (`main.bicep:1436-1438`). The two paths differ in
who resolves the value: the platform does it for `secretRef` entries, the host process does it for
the configuration source, and both authenticate as the same `appsIdentity` that already holds Key
Vault Secrets User. Secret names use a double dash for the configuration separator, so the existing
single-dash secrets arrive as flat keys and shadow nothing the container already sets
(`main.bicep:1436-1439`).

That startup read is why `AZURE_CLIENT_ID` is on all six apps (`main.bicep:1716` Identity, `:1917`
Conference, `:2057` Engagement, `:2211` Notification, `:2352` Gateway, `:2480` UI), not only on
Identity, where it was introduced for avatar blob access. Each app carries only that identity, and
the ACA identity endpoint needs that identity **named**, so without the pin `DefaultAzureCredential`
fails the startup vault read rather than falling back.

**The staged SQL auth completed its migration, but only the staging is visible in source.**
`useManagedIdentitySql` (`main.bicep:36`) defaults to `false` and selects one of two auth segments
for the shared connection string base (`main.bicep:191-193`): either
`Authentication=Active Directory Managed Identity;User Id=<apps identity client id>` with no
password at all, or `User ID=...;Password=...`. Reading the template alone suggests every
app-to-database string still carries a login and password (`main.bicep:194`), and that is what a
fresh environment gets. It is not what ADC production runs. The deployed value comes from a
repository variable: `deploy.yml:1324` reads `vars.USE_MANAGED_IDENTITY_SQL`, and
`deploy.yml:1484-1487` rewrites the parameter to `true` when it is set. The runbook states the
result as an operational fact in two separate triage paths (`OPERATIONS.md:76-77`, `:113-116`):
production SQL is passwordless managed identity, so an operator connects as an identity the server
knows, and a single service failing SQL is a missing database user before it is anything else. The
migration runs in three stages, all driven by repository variables that are absent by default:
supply the Entra admin (`deploy.yml:1473-1480`), run the per-database external-provider grants by
hand, then set `USE_MANAGED_IDENTITY_SQL=true` (`deploy.yml:1484-1487`). Because the Entra admin is
additive and the flag defaults off, stage 1 changes nothing observable and a bad flip rolls back by
the same one parameter. Whether a given deployment has already set that variable is not determinable
from source.

**Where the other repos stand.** MMCA.Store implements the identical Key Vault model with its own
identity (`mmca-prod-apps-identity`, `MMCA.Store/infra/main.bicep:787`) and eleven vault secrets.
MMCA.Common ships the shape as a compile-only reference sample under `samples/deployment/`, not a
deployment: it creates an RBAC-authorized vault (`MMCA.Common/samples/deployment/main.bicep:69`,
`:76`), attaches the identity for both ACR pull and secret reads, composes the SQL connection string
from the server, database and admin login it just declared (`:105`), writes it into that vault as the
`sql-conn` secret (`:107-111`), declares it on the Container App as a `keyVaultUrl` + UAMI reference
(`:152`) and consumes it through `secretRef` (`:164`), which is the same end-to-end shape ADC runs.
Its own header note records the two out-of-band grants that make it work: Key Vault Secrets Officer
for the deploy principal to write the secret, Key Vault Secrets User for the app UAMI to read it
(`:102-104`). Worth knowing before trusting the sample as a template, though: CI only runs
`az bicep build` over it, and a `secretRef` naming a secret that no `secrets` array declares
type-checks clean and fails only at ARM submit time, which is exactly the defect this file carried
until 2026-09-05. MMCA.Helpdesk has no `infra/` directory and no deploy workflow at all (its
`.github/workflows/` holds `ci.yml`, `release-templates.yml`, and the two Claude workflows), so
there is nothing there to adopt.

### Container Apps, the six deployables

Six `Microsoft.App/containerApps` resources are declared in `main.bicep`. They share structural
patterns but differ in ingress transport, probe port, and environment variables. As of 2026-09-02
they no longer differ in size: **all six run at 0.25 vCPU / 0.5 Gi**.

#### Common structural patterns

All six apps (`main.bicep:1152-2027`) share:

- `identity: { type: 'UserAssigned', userAssignedIdentities: { '${appsIdentity.id}': {} } }`, the
  same shared UAMI on every app (`main.bicep:1159-1164`, `:1366-1371`, `:1500-1505`, `:1627-1632`,
  `:1796-1801`, `:1917-1922`).
- `activeRevisionsMode: 'Single'` (`main.bicep:1169`, `:1375`, `:1509`, `:1636`, `:1805`, `:1926`),
  one active revision at a time; new deploys create a new revision and traffic flips atomically
  rather than gradually. This is exactly what the post-deploy revision-activation gate asserts:
  the newest revision must be Healthy, Running and holding `trafficWeight` 100
  (`deploy.yml:1568-1573`).
- `tags: union(commonTags, { service: '<name>' })` on **all six** (`main.bicep:1607`, `:1832`,
  `:1981`, `:2112`, `:2289`, `:2433`): the shared cost tags plus the one dimension that splits the
  bill by deployable (`main.bicep:173-175`). `CostTagConventionTests`
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/CostTagConventionTests.cs:13`)
  pins the tag on every container app and on the database loop.
- `resources: { cpu: json('0.25'), memory: '0.5Gi' }` on **all six** (`main.bicep:1647`, `:1874`,
  `:2013`, `:2158`, `:2334`, `:2467`), the smallest Container Apps allocation. Conference and the
  Gateway were the last two at 0.5 vCPU / 1 Gi and were right-sized on 2026-09-02 from measured
  production utilization; the two comments carry the measurements and the revert instruction
  (`main.bicep:1399-1405`, `:1824-1830`).
- `scale: { minReplicas: 1, maxReplicas: 2, rules: [{ name: 'http-scale', http: { metadata: { concurrentRequests: '50' } } }] }`
  on **all six** apps (`main.bicep:1354`, `:1488`, `:1615`, `:1781`, `:1889-1902`, `:2011-2024`).
  `minReplicas: 1` prevents scale-to-zero (which would destroy Blazor Server circuits and outbox
  in-flight messages); HTTP scale-out at 50 concurrent requests gives the headroom needed for a
  conference-day load (historically ~67 peak concurrent). Notification used to be capped at 1 and
  no longer is: the comment above its scale block (`main.bicep:1770-1779`) records why the cap was
  lifted on 2026-08-31, and the condition attached to it. `TwoReplicaHubFanOutTests` in
  `Tests/Integration/MMCA.ADC.CrossService.IntegrationTests` boots two Notification replicas
  against one Redis container nightly and asserts a push issued on one replica reaches a SignalR
  client held by the other. The cap was 1 precisely because that proof did not exist; the template
  states that deleting or skipping the test puts the cap back to 1. Uniform caps also make
  `cost-guard.yml`'s single `BASELINE_MAX_REPLICAS` of 2 a meaningful whole-fleet assertion.
- `ASPNETCORE_ENVIRONMENT: 'Production'`, switches ASP.NET Core to the production configuration,
  which among other things disables the OpenAPI endpoint (it is only mapped outside Production per
  the ADC CLAUDE.md).
- `ApplicationSettings__DatabaseInitStrategy: 'Migrate'` on the four database-owning services
  (`main.bicep:1238`, `:1438`, `:1560`, `:1706`), each service auto-applies its own database's
  pending migrations at startup as the **sole migrator**. `deploy.yml` deliberately has *no*
  separate `sqlcmd` migration step (a backstop would race the container's startup `Migrate()`,
  which is exactly what wedged MMCA.Store's first per-service deploy); with `minReplicas: 1`
  exactly one replica migrates before the revision serves (`deploy.yml:1497-1507`). The build-time
  EF model-drift gate (`deploy.yml:375-389`) still guarantees a migration exists for every model
  change, across all four migrations projects.
- `Outbox__PollingIntervalSeconds: '300'` (`main.bicep:1664`, `:1885`, `:2023`, `:2175`), the outbox
  signal + smart wait in MMCA.Common ≥ 1.50.0 delivers real messages in ~5 seconds regardless of the
  poll interval; the 300-second poll only governs idle polling. This cuts App Insights SQL dependency
  telemetry that would otherwise flood the workspace around the clock (the
  `OutboxPollFilterProcessor` suppresses the poll spans from App Insights per the memory note
  `project_outbox_cost_optimization.md`). The runbook turns the same number into a triage
  instruction: allow five minutes before concluding a manual outbox reset did not take
  (`OPERATIONS.md:94-97`).
- `Outbox__DeadLetterRetentionDays: '30'` on the four database-owning services (`main.bicep:1660`,
  `:1883`, `:2021`, `:2173`; Gateway and UI own no database and therefore no outbox). A
  dead-lettered row (retries exhausted, never delivered) keeps `ProcessedOn` null forever, so the
  processed-row sweep never reaches it and it stays in the pending index that every poll re-scans.
  `OutboxCleanupService` purges those rows on their own window, falling back to `RetentionDays`
  (default 7) when the key is `0`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxCleanupService.cs:158-162`,
  `Settings/OutboxSettings.cs:65`, `:108`). Setting 30 in production deliberately keeps a failed
  payload longer than a delivered one: four weeks to diagnose or replay it by hand before the row
  is abandoned.
- `Scheduler__PollingIntervalSeconds: '300'` on Identity, Conference and Engagement only
  (`main.bicep:1675`, `:1893`, `:2026`), the same reasoning as the outbox interval applied to the
  scheduled-job runner: it smart-waits until the earliest due job, so the interval only bounds an
  idle sleep, and the 30-second default woke every runner twice a minute per database for nothing.
  Notification does not get the key because it runs no scheduler: `Scheduler:Enabled` is `true` in
  exactly the three services that do
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:63-64`,
  `MMCA.ADC.Conference.Service/appsettings.json:60-61`,
  `MMCA.ADC.Engagement.Service/appsettings.json:81-82`), and the Notification service declares no
  `Scheduler` section at all. The template's own note says the same
  (`main.bicep:1671-1674`): the audit-trail cleanup job runs daily, which is what the interval
  paces.
- `InternalCommands__PollingIntervalSeconds: '60'` on Identity (`main.bicep:1670`), the ADR-114
  internal-command runner, and the one interval deliberately set *below* the default. A row
  enrolled in a transaction cannot be signalled when it is written, so the interval bounds only
  that row and the retry of a failed one; 60 seconds keeps a deferred account or blob operation
  from sitting for five minutes, and the idle cost is one small indexed query per minute per
  database (`main.bicep:1665-1669`).
- `ConnectionStrings__redis` from Key Vault on all four services (`main.bicep:1679`, `:1897`,
  `:2030`, `:2180`), which is the single key that turns on the distributed cache, cross-replica
  idempotency, and the SignalR backplane.
- `MessageBus__Provider: 'AzureServiceBus'` + `MessageBus__ConnectionString` from Key Vault,
  selects MassTransit's Azure Service Bus transport at startup (locally the AppHost injects
  `WithBroker(rabbit)` for RabbitMQ instead).
- `HealthProbe__Port`, a dedicated HTTP/1.1 listener that `Program.cs` adds when the key is set, and
  the target of all three probes on the four services (see below).

Three of the four services also carry
`Authentication__JwtBearer__RequireHttpsMetadata: 'false'` (`main.bicep:1903` Conference, `:2035`
Engagement, `:2185` Notification), and the template explains why in the comment directly above each
one (`main.bicep:1900-1902`, `:2032-2034`, `:2182-2184`). Their JWKS `Authority` is the ACA
**internal-ingress h2c URL** for Identity, `http://adc-prod-identity` (`:1899`, `:2031`, `:2181`):
TLS terminates at the platform edge, so traffic inside the environment is cleartext, and the
framework's secure-by-default HTTPS metadata requirement would otherwise reject that discovery
fetch outright. Identity itself does not carry the key because it issues the tokens rather than
validating them against a remote authority, and the Gateway does no JWT validation at all.

[Rubric §17, DevOps & Deployment] specifically calls out environment parity. The same six
services that run under Aspire locally also run as Container Apps in production, with the
transport switch (`RabbitMQ → AzureServiceBus`), the SQL location switch (`localhost SQL container
→ Azure SQL`), and the secret management switch (`environment variable → Key Vault URI`) all being
configuration differences, not code differences. Application code is identical in both environments.

#### Ingress transport choices

Two distinct transport configurations appear across the six apps:

**HTTP/2 cleartext (`transport: 'http2'`, `allowInsecure: true`)**: used by Identity, Conference,
and Engagement (`main.bicep:1169-1176`, `:1376-1383`, `:1510-1517`). These three
services run Kestrel in `Http2`-only on cleartext (h2c prior knowledge), which is required for
cross-service gRPC: Kestrel cannot negotiate HTTP/2 via ALPN without TLS, and internal ACA
service-to-service traffic does not pass through the TLS terminator. `allowInsecure: true` is
required here because h2c is technically cleartext HTTP/2, it is not "insecure" in the
architectural sense (traffic stays within the ACA virtual network) but the field name is misleading.
The operational consequence is in the runbook (`OPERATIONS.md:144-146`): probe these three with
`--http2-prior-knowledge`, because a default HTTP/1.1 `curl` reports a failure that is not there.

**HTTP/1.1 (`transport: 'http'`)**: used by Notification, Gateway, and UI. Notification runs
Kestrel in `Http1AndHttp2` because SignalR's WebSocket transport begins with an HTTP/1.1 Upgrade
handshake (`main.bicep:1640` comment). Gateway and UI use HTTP/1.1 because they are the external
entry points (`main.bicep:1806-1811`, `:1927-1935`; Blazor Server also uses WebSocket upgrade from
HTTP/1.1, `main.bicep:1981-1982` comment).

Notification carries a third shape on top: `additionalPortMappings` exposes an internal-only TCP
port 8081 (`main.bicep:1647-1653`) for the cleartext h2c gRPC ingress (`LiveChannelPush`). TCP
passthrough is what sidesteps the envoy HTTP/1.1-versus-HTTP/2 conflict, because the main ingress
must stay `http` for WebSockets while gRPC needs end-to-end HTTP/2 (the
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed-transport
profile).

#### Probes on a dedicated HTTP/1.1 listener

Kestrel in HTTP/2 prior-knowledge mode rejects the platform's HTTP/1.1 `httpGet` probe with
`GOAWAY HTTP_1_1_REQUIRED`, which would fail the liveness check and cause a reboot loop. Rather than
degrading the three h2c services to port-only `tcpSocket` probes, each service opens a
**dedicated HTTP/1.1 probe listener** that is not exposed via ingress: `HealthProbe__Port: '8081'`
on Identity, Conference and Engagement (`main.bicep:1212`, `:1419`, `:1542`) and `'8082'` on
Notification (`main.bicep:1688`, because 8080 and 8081 are already the ADR-012 pair). ACA probes may
target a port that ingress does not publish, so all six apps use `httpGet` probes and all six carry
the same three (`main.bicep:1326-1351` Identity, `:1460-1485` Conference, `:1587-1612` Engagement,
`:1742-1767` Notification, `:1861-1886` Gateway, `:1983-2008` UI):

| Probe | Path | Cadence | Semantics |
|---|---|---|---|
| `startup` | `/alive` | `initialDelaySeconds: 5`, `periodSeconds: 5`, `failureThreshold: 30` | up to 150s for a cold container to answer at all |
| `liveness` | `/alive` | `periodSeconds: 30`, `failureThreshold: 3` | self-only, so a SQL outage never restarts the container |
| `readiness` | `/health/ready` | `initialDelaySeconds: 3`, `periodSeconds: 30`, `failureThreshold: 3` | warmup gate plus the DB-aware `AddSqlServer` check |

The liveness/readiness split is the load-bearing part (`main.bicep:1313-1319`): `/alive` checks the
process only, so a database outage does not trigger a restart loop, while `/health/ready` fails when
a replica cannot reach its database, pulling it out of rotation instead of letting it serve 500s.
Readiness is also gated on `WarmupHostedService` completing (OIDC discovery fetched), so ACA holds
back user traffic until the replica is warm. Gateway and UI probe their own 8080 (`main.bicep:1861-1886`,
`:1983-2008`) because their Kestrel accepts HTTP/1.1 directly.

**Readiness runs every 30 seconds, not every 10, and that is a telemetry-cost decision**
(`main.bicep:1320-1325`). The DB-aware readiness check issues a SQL `SELECT 1` per probe, and
neither the probe request nor its dependency row is sampled, so a 10-second period cost 360 request
rows plus 360 dependency rows per app per hour of App Insights ingestion, on six apps, forever.
`failureThreshold` stays at 3, so the honest trade is stated in the comment: an unhealthy replica
now leaves rotation within about 90 seconds instead of 30. That is acceptable precisely because
readiness is not the paging signal, `/alive` (liveness, also 30s) and the outside-in availability
test are. Startup probing is untouched at 5 seconds, because startup latency is what a deploy
actually waits on.

Readiness is powerful enough to be dangerous, which is the lesson the `revision-activation-failed`
alert encodes: an over-broad readiness check does not take the fleet down, it silently prevents new
code from ever taking traffic. The runbook's guidance on that alert is to look at `/health/ready`
on the named app first, since an untagged infrastructure health check gating readiness is the usual
cause (`main.bicep:423`).

#### Service Discovery (`services__<name>__http__0`)

Aspire's service discovery convention uses env vars of the form `services__<service-name>__http__0`
to resolve service endpoints. In production these point at internal ACA hostnames:

- Gateway → all four services: `conference` (`main.bicep:1849`), `identity` (`:1849`),
  `engagement` (`:1850`), `notification` (`:1851`), each as `http://${<app>.name}`
- Conference → `services__engagement__http__0 = http://${prefix}-engagement` (`main.bicep:1443`)
  (using the literal `${prefix}-engagement` rather than `${engagementApp.name}` to avoid a
  Bicep symbolic cycle, Conference and Engagement both reference each other)
- Engagement → `services__conference__http__0 = http://${prefix}-conference` (`main.bicep:1565`)
- Notification → `services__identity__http__0 = http://${identityApp.name}` (`main.bicep:1710`),
  for the `IAttendeeQueryService` email-recipient lookup
- Identity → `services__engagement__http__0` (`main.bicep:1246`), for the PRIVACY.md data-subject
  export's Engagement section

Two edges use a **named** endpoint rather than the default `http` one, because they target
Notification's dedicated h2c gRPC port: `services__notification__grpc__0 = http://${prefix}-notification:8081`
from Identity (`main.bicep:1253`, the Notifications section of the same data-subject export) and
from Engagement (`main.bicep:1570`, the best-effort live-channel push). Both use the literal
`${prefix}-notification` name so deployment ordering stays unconstrained, since Notification itself
references `identityApp` for its JWKS authority.

The same service names work locally because the AppHost's `WithReference` injects them as
`services__engagement__http__0 = http://localhost:<assigned-port>`. The application code calls
`AddHttpForwarderWithServiceDiscovery()` or `AddTypedGrpcClient<T>(serviceName)` in both
environments and resolves the endpoint from that env var key.

#### Identity Service specifics (`main.bicep:1603-1827`)

Identity is the JWT issuer and JWKS endpoint. Its JWT configuration (`main.bicep:1233-1237`):

```bicep
{ name: 'Jwt__SigningAlgorithm',   value: 'RS256' }
{ name: 'Jwt__Issuer',            value: 'https://${prefix}-gateway.${...defaultDomain}' }
{ name: 'Jwt__Audience',          value: 'AtlDevConapi' }
{ name: 'Jwt__AccessTokenExpirationMinutes', value: '15' }
{ name: 'Jwt__RefreshTokenExpirationDays',   value: '7' }
```

`Jwt__SigningAlgorithm` is the literal `'RS256'`, not a ternary, because the RSA key parameters are
required and the HS256 fallback path no longer exists in this template (the comment at
`main.bicep:1232` says exactly that). The RSA private key from Key Vault signs tokens and the
public key is published at `/.well-known/jwks.json`, wired by five unconditional env entries:
`Jwt__RsaPrivateKeyPem`, `Jwt__RsaPublicKeyPem`, `Jwks__Enabled: 'true'`,
`Jwks__KeyId: 'mmca-adc-2026'` and `Jwks__RsaPublicKeyPem` (`main.bicep:1288-1292`). Other services
fetch the JWKS document
through the internal authority (`Authentication__JwtBearer__Authority = 'http://${identityApp.name}'`)
to validate tokens without a shared secret
([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)
"authentication dual-fetch"). The 15-minute access token lifetime limits the blast radius of a
leaked token.

Identity is also the app that carries the avatar-storage wiring (`main.bicep:1261-1262`):
`FileStorage__ServiceUri` and `FileStorage__ContainerName`, pointed at the storage account's blob
endpoint and the `avatars` container. `AZURE_CLIENT_ID` (`main.bicep:1268`) sits beside them and
pins the apps identity's client id so `DefaultAzureCredential` resolves the intended identity
explicitly rather than relying on discovery order. That pin started here for blob access, but it is
no longer avatar-specific: four other apps carry it for the Key Vault configuration source (see
the Key Vault section).

Identity is one of the two apps that persist the **DataProtection key ring**
(`main.bicep:1266-1267`): `DataProtection__BlobStorageUri` points at
`<blob endpoint>dataprotection-keys/keys.xml` in the private container described above, and
`DataProtection__ApplicationName: 'MMCA.ADC'` is the isolation name the ring is scoped by (the same
value on the UI, which is what makes the two apps share one ring rather than two). The comment
above them (`main.bicep:1263-1265`) states the failure mode: Identity does OAuth cookie
cryptography at `maxReplicas: 2` with no session affinity, so with the default per-replica
in-memory ring a login started on one replica fails on the other. `MMCA.Common`'s
`AddCommonDataProtection` reads both keys, and `DataProtection:BlobStorageUri` is the gate: absent,
the method does nothing and the host keeps the in-memory default, which is what local development
and the tests want
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:54-62`).

Identity is also the app that sends the account emails, so it receives the SMTP block
(`main.bicep:1277-1281`: `Smtp__Host`, `Smtp__Port`, `Smtp__Username`, `Smtp__EnableSsl: 'true'`,
`Smtp__From`) with the password arriving separately as a `secretRef` only when one is configured
(`main.bicep:1294`, gated on `hasSmtpPassword`). Sitting with them is
`PasswordReset__ResetUrl` (`main.bicep:1287`), the absolute URL of the UI reset page the
forgot-password email links to
([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)). It points at
the same UI origin `OAuth__UIBaseUrl` uses but is injected **unconditionally**, and the comment
above it says why (`main.bicep:1282-1285`): password recovery is a local-credential feature and has
to work whether or not an external OAuth provider is configured, so gating it behind `hasAnyOAuth`
would silently degrade the reset mail to a token-only message on any deployment without social
login.

Identity is the one app that can carry all three external OAuth providers, and each block is
all-or-nothing (`main.bicep:1295-1308`): GitHub and Google contribute a client id plus a
`secretRef`, while Apple contributes four entries (services id, team id, key id, and the `.p8`
private key as a `secretRef`). `OAuth__UIBaseUrl` follows at `:1310` under `hasAnyOAuth`, because
the post-login redirect target is provider-independent.

Identity is sized at 0.25 CPU / 0.5 Gi (`main.bicep:1198`). JWT operations are CPU-cheap once the
key is loaded; the bottleneck is typically network I/O to SQL.

#### Conference Service specifics (`main.bicep:1828-1976`)

Conference carries the heaviest surface of the four services: seventeen API controllers
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/`), an AI scoring path
(Anthropic API), and the role of read-heavy entry point for the event/session catalog. It ran at
0.5 CPU / 1 Gi until 2026-09-02 and now runs at 0.25 CPU / 0.5 Gi like every peer
(`main.bicep:1407`). The comment above that line is the model for how a right-sizing decision should
be recorded (`main.bicep:1399-1405`): CPU averaged 0.012 to 0.017 cores with p95 under 0.03 against
the half-core it held, and the working set ran 320 to 380 MB. It also names itself as **the app to
watch**, because a p95 working set of 376 MB is 73% of the new 512 MiB limit, and states the revert
as one line and one deploy. The second-order effect is called out too: a smaller CPU quota throttles
the startup spike, so cold start roughly doubles, which traffic never sees because ACA keeps the
previous revision serving until readiness goes green.

The AI provider key is injected only when `hasAiApiKey = true` (`main.bicep:1859`, `:1937`). The
secret reference keeps the Key Vault secret's `anthropic-api-key` name, while the env var it feeds is
the provider-neutral `Ai__ApiKey`:

```bicep
secrets: union(
  [ ... sql, redis and service bus ... ],
  hasAiApiKey ? [{ name: 'anthropic-api-key', keyVaultUrl: ..., identity: appsIdentity.id }] : []
)
// and in the env union:
hasAiApiKey ? [{ name: 'Ai__ApiKey', secretRef: 'anthropic-api-key' }] : []
```

This is the `union()` + conditional array pattern used throughout `main.bicep` to keep optional
secrets and env vars out of the resource definition when not configured, rather than passing empty
strings to the container.

#### Notification Service specifics (`main.bicep:2108-2280`)

Notification differs from the other three back-end services in four ways:

1. `transport: 'http'` instead of `'http2'`, SignalR WebSocket requires an HTTP/1.1 Upgrade
   handshake (`main.bicep:1640`), plus the extra internal-only h2c port 8081 for gRPC
   (`main.bicep:1647-1653`).
2. Its probe listener is on **8082** (`main.bicep:1688`), because the ADR-012 mixed profile already
   owns 8080 and 8081 and those two endpoints are load-bearing (`main.bicep:1682-1686`).
3. It is the only app that can receive the native-push env block, and only when the hub wiring is
   on (`main.bicep:1730-1734`).
4. It is the second app with an SMTP block (`main.bicep:1716-1720` plus the conditional
   `Smtp__Password` `secretRef` at `:1735` and its vault-backed secret entry at `:1663`), because
   the notification service is the one that fans a notification out to email as well as to the hub.

It runs no scheduler, so unlike the other three it gets no `Scheduler__PollingIntervalSeconds`.
Its readiness probe (`main.bicep:1758-1766`) is what holds ACA ingress until the
`WarmupHostedService` has fetched the JWKS document from Identity (`main.bicep:1737-1741`). Without
it, SignalR connections made during warmup would fail because the JWT validator is not yet
initialized. Its replica cap is no longer the outlier it once was: see the shared scale discussion
above.

#### Gateway specifics (`main.bicep:2281-2427`)

Gateway is the sole externally-reachable back-end entry point (`external: true`,
`allowInsecure: false`, `main.bicep:1806-1811`). It is a pure YARP reverse proxy: no DbContext, no
JWT issuing, no module. Its env configuration is service-discovery entries, CORS, and one optional
rate-limiter key:

```bicep
{ name: 'Cors__AllowedOrigins__0', value: 'https://${prefix}-ui.${...defaultDomain}' }
```

CORS is scoped to exactly the UI's FQDN (`main.bicep:1843`), not a wildcard. Gateway was right-sized
alongside Conference on 2026-09-02 and now runs at 0.25 CPU / 0.5 Gi (`main.bicep:2334`); its
comment records the easier half of that decision (`main.bicep:1824-1830`), a 190 to 235 MB working
set comfortably inside the new limit because pure YARP forwarding holds no DbContext. It uses the
readiness gate at `main.bicep:1878-1885` because its warmup involves establishing connections to all
back-end services. It is also the target of the availability web test described above, and the only
app with no `KeyVault__Uri`.

Its one conditional secret is the ADR-088 synthetic-traffic bypass. When
`hasSyntheticTrafficSecret` is true the app declares a `synthetic-traffic-secret` Key Vault
reference (`main.bicep:1815-1817`) and receives
`GatewayRateLimiting__SyntheticTrafficSecret` as a `secretRef` (`main.bicep:1858`). A request
presenting that value in the `X-Synthetic-Traffic-Key` header skips both chained edge limiters, so
the monthly k6 run measures backend capacity instead of the per-IP window. Absent, the bypass is
off and every request stays rate limited, which is the correct default for a public entry point.

The template also records the transport contract the Gateway holds up (`main.bicep:1843-1846`):
`ForwardHttp2` defaults to true in the gateway code and YARP uses `VersionPolicy=RequestVersionExact`,
so it sends the HTTP/2 preface to the three h2c-prior-knowledge backends whose ACA ingress is
`transport: http2`. That pairing is why the ingress choice on those three services and the forwarder
policy here cannot be changed independently.

#### UI specifics (`main.bicep:2428-2567`)

UI is the other externally-reachable app (`external: true`, `main.bicep:1928`), the one app with
`secrets: []` (`main.bicep:1938`) and sized at 0.25 CPU / 0.5 Gi (`main.bicep:1945`). Three
non-obvious configuration points:

**Sticky sessions** (`main.bicep:1932-1934`):
```bicep
stickySessions: { affinity: 'sticky' }
```
Blazor Server runs the component model as a stateful SignalR circuit on the server. If a request
from a browser is load-balanced to a different replica than the one holding the circuit, the
circuit drops. Sticky session affinity pins each browser session to one replica. The header comment
on the resource (`main.bicep:1910-1912`) states both Blazor Server requirements together: sticky
sessions and `minReplicas >= 1`.

**Dual API endpoints** (`main.bicep:1957`, `:1959`):
```bicep
{ name: 'Api__ApiEndpoint',     value: 'http://${gatewayApp.name}' }
{ name: 'Api__WasmApiEndpoint', value: 'https://${gatewayApp.properties.configuration.ingress.fqdn}' }
```
Server-side Blazor rendering uses the internal Gateway URL (skipping public DNS, TLS termination,
and the Envoy round-trip). WebAssembly code running in the browser must use the external FQDN,
it has no access to the internal ACA DNS. The UI serves the WASM endpoint URL via a `/client-config`
endpoint so the WASM app can discover the gateway without the URL being baked into the WASM build.

**Shared DataProtection key ring** (`main.bicep:1964-1965`): the UI carries the same
`DataProtection__BlobStorageUri` and `DataProtection__ApplicationName: 'MMCA.ADC'` pair as Identity,
pointed at the same `dataprotection-keys/keys.xml` blob. The reason is the one above with the
consequence reversed: sticky sessions pin a **circuit** to a replica, but the UI also mints the SSR
session cookie and antiforgery tokens, and those travel with the browser rather than with the
circuit, so at `maxReplicas: 2` a per-replica in-memory ring makes them undecryptable on the other
replica (`main.bicep:1959-1963`). `AZURE_CLIENT_ID` (`main.bicep:1966`) pins the identity that
`DefaultAzureCredential` uses for both the blob write and the vault read.

The UI receives only the OAuth **client ids** when a provider is configured, one per provider
including Apple (`main.bicep:1971-1979`); every client secret stays on Identity, which is the app
that completes the exchange.

### Outputs (`main.bicep:2568-2573`)

```bicep
output acrLoginServer     string = acr.properties.loginServer
output gatewayFqdn        string = gatewayApp.properties.configuration.ingress.fqdn
output uiFqdn             string = uiApp.properties.configuration.ingress.fqdn
output sqlServerFqdn      string = sqlServer.properties.fullyQualifiedDomainName
output serviceBusEndpoint string = serviceBus.properties.serviceBusEndpoint
output appInsightsName    string = appInsights.name
```

`gatewayFqdn` and `uiFqdn` are consumed by the Phase 5 gate (`deploy.yml:1629-1778`), which is
**two** gates in a deliberate order, and the comment above them explains why the order matters
(`deploy.yml:1607-1628`).

**5a, activation.** For every app, the newest revision (by `createdTime`) must report `healthState`
Healthy, `runningState` Running or RunningAtMaxScale, and `trafficWeight` 100
(`deploy.yml:1667-1671`), polled up to ten minutes per app (`deploy.yml:1684-1694`). This gate
proves the code just built is the code now serving. The HTTP probes alone cannot prove that: they
all enter through the Gateway, and a healthy Gateway keeps serving from the **previous** backend
revision when the new one never goes ready, so every probe answers from old code and the run goes
green. That is exactly how the Redis readiness regression hid for four days between 2026-08-29 and
2026-09-02 (`deploy.yml:1517-1521`).

**5b, reachability.** The smoke step then probes every service through the Gateway
(`deploy.yml:1598-1609`): Gateway `/health`, Identity via `/.well-known/jwks.json`, Conference via
anonymous `GET /Events`, plus the UI root. For the two auth-gated endpoints, `/Bookmarks` and
`/Notifications/inbox`, the asserted status is exactly **401**, not 2xx: an anonymous request must
be rejected _by the service_, which only happens when the service is up and serving
(`deploy.yml:1541-1543`, `:1604-1607`). A security-headers check rides along but is explicitly
informational (`deploy.yml:1611-1618`): a missing hardening header is not a "revision not serving"
failure and must not trip the fleet-wide rollback.

On failure the step rolls every app back and still fails the job, with two guards that are worth
reading (`deploy.yml:1625-1670`). Guard 1 re-checks each app's newest revision and skips the
rollback when it is already serving, so a smoke failure originating elsewhere never takes a healthy
app down. Guard 2 selects the rollback target by `provisioningState == 'Provisioned'` **and**
`healthState == 'Healthy'` **and** `active == true`, excluding the newest by name: a revision that
failed activation is still "Provisioned", so filtering on health is what keeps the choice honest.
It also reports separately when a rollback itself failed, so a partially rolled-back fleet never
looks like a clean auto-revert.

Only after both gates does the job run its one piece of housekeeping, the `buildcache` purge
described in the foundation section (`deploy.yml:1683-1690`). The ordering is the point: a
continue-on-error step placed before the gates would be noise inside the decision; placed after
them, it can only reclaim storage from a deploy that already shipped.

`sqlServerFqdn` is an output of `main.bicep` (each service connects to its own
database via the per-service connection strings written into Key Vault; `deploy.yml` itself does not
run `sqlcmd` against the server, migrations are applied by the services at startup).

---

## Deployment model summary

The complete credential chain:

```
GitHub OIDC token (ephemeral, per-workflow-run)
  → Azure AD federated credential → deploy UAMI access token
    → Bicep deployment (Contributor on acc-rg)
      → writes Key Vault secrets (Key Vault Secrets Officer on adckv…)
      → pulls images from ACR (AcrPush on deploy side)
        → Container Apps pull images via apps UAMI (AcrPull, bootstrapped out-of-band)
          → Container Apps read secrets from Key Vault via apps UAMI
            (Key Vault Secrets User, bootstrapped out-of-band)
```

No static credential exists at any link in this chain. The GitHub secrets
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` are the OIDC registration
parameters, public identifiers, not secrets. The only genuine secrets (`SQL_ADMIN_PASSWORD`,
`JWT_RSA_*`, `OAUTH_APPLE_PRIVATE_KEY_PEM`, `SYNTHETIC_TRAFFIC_SECRET`, etc.) flow from GitHub
Actions encrypted secrets into Key Vault during deployment and from Key Vault into containers at
runtime, never touching disk or appearing in logs.

One honest caveat, recorded in
[ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html): the pipeline is
still a plaintext path. Values arrive as `@secure()` Bicep parameters written from GitHub secrets
into `/tmp/deploy-params.json` at deploy time (`deploy.yml:1299-1324`). The vault removes the
app-configuration copy of a secret, not the CI copy; rotating one still means rotating a GitHub
secret and redeploying.

---

## Rubric category cross-reference

| Rubric category | Where it appears in these files |
|---|---|
| §7 Microservices Readiness | Per-service databases ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)); service-discovery env vars (including the two named `grpc` endpoints); gRPC transport selection |
| §8 Data Architecture | Four per-service databases as the whole estate; LTR policies; the AtlDevCon bacpac archive as the rollback source of record; EF model-drift gate in deploy.yml (migrations applied by services at startup) |
| §11 Security | UAMI/OIDC model; Key Vault-backed secrets ([ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)) plus the `KeyVault__Uri` configuration source on five of six apps; `secrets: []` on the UI and a single conditional secret on the Gateway; `adminUserEnabled: false`; `@secure()` parameters; required RSA keys with no HS256 fallback; staged `useManagedIdentitySql`; private `dataprotection-keys` container for the shared key ring (at-rest key-vault encryption of that ring is an explicit not-yet-implemented follow-up); the scoped `RequireHttpsMetadata: false` on the three internal JWKS consumers; the secret-gated rate-limiter bypass ([ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html)); database-level `UPDATE`/`DELETE` auditing on `dbo.AuditTrailEntries` in the three databases that carry the trail, so the admin login cannot rewrite it unrecorded ([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)); no static credentials |
| §13 Observability | Workspace-based App Insights; per-service `OTEL_SERVICE_NAME`; Application Map coverage; five SLO scheduled query rules (the AI-scoring token ceiling among them, enabled by `hasAiApiKey`) + workbook ([ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html)); outbox dead-letter, SQL dependency and revision-activation alerts over the same workspace; the 15-minute evaluation cadence and its stated detection-latency trade |
| §17 DevOps & Deployment | Two-phase Bicep split; Incremental mode (and the operator step a template deletion still needs); image sha-tagging + registry build cache; service-startup migration (sole migrator, minReplicas:1); the revision-activation gate followed by the smoke gate, then the post-deploy cache purge |
| §29 Resilience & Business Continuity | LTR on per-service databases; SLO alerts; sev-1 Gateway availability web test with a window that tracks its probe cadence; the `revision-activation-failed` alert for a rollout that silently never took traffic; guarded rollback in the smoke gate; `minReplicas: 1`; readiness probes with a self-only liveness split |
| §31 Cost Efficiency / FinOps | `commonTags` on every resource plus a per-service `service` tag on the six apps and four databases; monthly budget with 80%/100% thresholds; `cost-guard.yml` surge-drift gate against a uniform `maxReplicas` 2 baseline; workspace `dailyQuotaGb: 1`; 25% trace sampling; Warning OTel log floor; the Gateway-only Warning floor on YARP's per-request logs; Basic-tier DB sizing plus the archived-and-dropped AtlDevCon database; 300s outbox and scheduler polls; the two disabled metric groups plus the 300s metric export interval; 30-second readiness probes; 15-minute SLO-rule and web-test cadences; the `aiScoringTokenCeiling` two-day AI provider token alert; the 50 GB monthly cap on on-upload malware scanning; uniform 0.25 vCPU / 0.5 Gi container sizing; the daily two-step ACR purge task plus its post-deploy re-run |

---

## Not determinable from source

- The exact `AcrPull` and `Key Vault Secrets User` role-assignment commands used in the out-of-
  band bootstrap are referenced in comments (`main.bicep:1045-1049`, `main.bicep:1063-1066`) but the
  commands themselves live in `infra/DISASTER-RECOVERY.md`, which is private to the ADC repo and out
  of scope for this chapter. A distilled version is published in the framework's reference runbook,
  `MMCA.Common/samples/deployment/DEPLOYMENT.md`.
- Whether the Notification Hubs namespace, the `adc-push` hub and its `app-backend` rule actually
  exist in a given subscription is not visible here: the template only references them as
  `existing` (`main.bicep:823-840`), and the manual `az rest` provisioning lives in
  `Docs/MobileReleaseRunbook.md` section 5, which is private to the ADC repo. With
  `deployNotificationHub` defaulting to true, a deploy into an environment where they do not exist
  fails at the `listKeys()` call rather than skipping the wiring.
- Whether the `AtlDevCon` drop and the bacpac export actually completed in a given subscription is
  likewise outside the template: `main.bicep:704-716` records the intent and the restore path, and
  `infra/POST-CUTOVER-atldevcon-downgrade.md` records the commands, but the resource group is the
  only place that says what exists now.
- The `USE_MANAGED_IDENTITY_SQL`, `SQL_AAD_ADMIN_LOGIN` and `SQL_AAD_ADMIN_OID` repository variables
  are **not visible in the repository**, because they are GitHub repo configuration rather than
  source: the template defaults are `false` and empty. `infra/OPERATIONS.md:76-77` and `:113-116`
  document production as running passwordless managed-identity SQL, which is only possible with
  that flag set, so treat the template as the shape and the repository variables as the state;
  neither alone tells you what production is doing. The same split applies to
  `AZURE_RESOURCE_GROUP` and `AZURE_SQL_LOCATION`, whose fallbacks (`acc-rg`, `westus2`) appear only
  in workflow comments and defaults, and to the whole `SMTP_*` set (`deploy.yml:1314-1318`), which
  decides whether the SMTP env block on Identity and Notification carries a real relay or empty
  strings. `SYNTHETIC_TRAFFIC_SECRET` (`deploy.yml:1319`) is the same case for the Gateway's one
  secret.
- Whether the AI-scoring token-ceiling alert is **enabled** in a given environment is not
  determinable from the template: the rule is always provisioned, with `enabled: hasAiApiKey`
  (`main.bicep:431`), and `hasAiApiKey` (`main.bicep:159`) is derived from the `ANTHROPIC_API_KEY`
  GitHub secret, which reaches the parameters file as `aiApiKey` only when it is non-empty
  (`deploy.yml:1388`, `:1506-1509`). An environment without that secret deploys the scoring feature
  inert and the rule disabled.
- Whether on-upload malware scanning is actually in effect on the storage account is not
  determinable from source either: the template declares it on by default (`main.bicep:136`,
  `:1315-1331`), but only the account's live `defenderForStorageSettings` resource shows whether the
  setting took effect.
- The `azure/arm-deploy@v2` action's `deploymentMode` is not set explicitly in `deploy.yml`
  (`deploy.yml:1115-1121` for foundation, `deploy.yml:1489-1495` for main), the action defaults to
  Incremental, but this is not stated in the workflow file; it is inferred from the Incremental intent
  documented in the `main.bicep` comments and the ADC CLAUDE.md.
