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
fitness function and lives in [group 27](group-27-testing-infrastructure.md#observabilityconventiontestsbase).

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
on 2026-09-02 and an operator still had to drop it by hand afterwards (`main.bicep:701-713`), and it
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

### Parameters (`foundation.bicep:3-10`)

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `environmentName` | `string` | required | Suffix for resource names (`adc-${environmentName}-…`) |
| `location` | `string` | RG location | Primary Azure region |

The `resourceToken` variable (`foundation.bicep:12`) is a stable hash derived from
`uniqueString(resourceGroup().id, environmentName)`. All generated resource names incorporate it,
ensuring uniqueness within the subscription while remaining deterministic across re-runs. That
determinism is also why the `foundation` job has to promote its outputs to job outputs
(`deploy.yml:1086-1088`): `acrName` cannot be recomputed outside Bicep. The same `commonTags` set
used in `main.bicep` is applied here too (`foundation.bicep:17-23`), so cost attribution covers the
foundation resources as well as the application ones.

### Log Analytics Workspace (`foundation.bicep:28-45`)

```
name: '${prefix}-logs-${resourceToken}'
sku:  PerGB2018
retentionInDays: 30
workspaceCapping: { dailyQuotaGb: 1 }
```

PerGB2018 is the pay-as-you-go tier. The 30-day minimum is Azure's floor for this SKU, shorter
retention is rejected (and the memory note `reference_log_analytics_sku_limits.md` records this
hard constraint). All six container apps ship their logs here via the Container Apps environment's
`appLogsConfiguration` (`main.bicep:962-968`), and `main.bicep`'s Application Insights component
uses it as its workspace backing store, meaning traces and metrics land in the same workspace. The
same destination is also what makes the platform's own `ContainerAppSystemLogs_CL` table queryable,
which the revision-activation alert below depends on (`main.bicep:404`).

`workspaceCapping.dailyQuotaGb: 1` (`foundation.bicep:41-43`) is a FinOps circuit breaker, not a
sizing decision. Normal ingestion is around 0.4 GB/day, so the ceiling never bites in steady state;
it exists to bound a runaway telemetry storm (a metrics or log loop) instead of leaving a
pay-per-GB workspace uncapped. The comment records the escape hatch (`foundation.bicep:37-40`):
raise it, or set `dailyQuotaGb: -1`, if a legitimate busy period approaches the cap.

[Rubric §13, Observability & Operability] assesses whether the system exposes structured logs,
distributed traces, and metrics in a queryable store. The single workspace is the convergence
point: container-app stdout/stderr, platform system logs, ASP.NET Core structured logs, and
OpenTelemetry traces all land in the same Log Analytics table set, queryable with Kusto.

### Azure Container Registry (`foundation.bicep:50-62`)

```
sku: Basic
adminUserEnabled: false   // #11/#17, managed-identity pull only
```

The `adminUserEnabled: false` setting (`foundation.bicep:60`) is the central credential-hardening
decision for image pull. Without it, every container app would need a stored registry admin
password. With it disabled, images are pulled exclusively via the shared UAMI's `AcrPull` role
assignment (bootstrapped out-of-band, see the UAMI section below). The deploy push likewise uses
the GitHub deploy identity's `AcrPush` role, not the admin credential (`foundation.bicep:58-59`).

[Rubric §11, Security] assesses elimination of long-lived credentials. Disabling the admin user
removes the one static credential that would otherwise be needed for every pull, a concrete,
verifiable hardening choice recorded directly in the Bicep.

### ACR scheduled purge task (`foundation.bicep:64-124`)

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
"Build deployment parameters file" step (`deploy.yml:1299-1487`), which writes
`/tmp/deploy-params.json` with `jq`.

How it works:

- **Two fail-fast pre-checks run before any `jq` call**, both for the same reason: catch a missing
  repository setting with an actionable error rather than letting Bicep validation report it as a
  parameter-binding failure minutes later. The first fails when the `ALERT_EMAIL` repository
  variable is empty (`deploy.yml:1329-1332`), because `alertEmailAddress` is a **required**
  `main.bicep` parameter with no default (`main.bicep:118-120`), and an alert rule wired to no
  notification channel is a silent failure. The second fails when either RSA key secret is empty
  (`deploy.yml:1334-1340`): `rsaPrivateKeyPem` and `rsaPublicKeyPem` are also required parameters
  with no default (`main.bicep:38-44`) because Identity signs RS256 and publishes JWKS, and there
  is no other signing path.
- A base `jq -n` invocation (`deploy.yml:1352-1380`) emits the always-present parameters,
  `environmentName`, `sqlLocation`, `acrName`, `logAnalyticsName`, `sqlAdminPassword`, and the six
  `*Image` URLs, into the ARM `deploymentParameters` JSON shape. `acrName` and `logAnalyticsName`
  are the Phase 1 foundation outputs; the image URLs are the `sha`-tagged ACR references;
  `sqlAdminPassword` comes from the `SQL_ADMIN_PASSWORD` GitHub secret. `sqlLocation` defaults to
  `westus2` (`deploy.yml:1349`) because the sponsor subscription blocks `Microsoft.Sql` in the RG's
  region. The two RSA keys are appended immediately after, unconditionally
  (`deploy.yml:1384-1387`), because they are required.
- Optional parameters (GitHub OAuth, Google OAuth, the four Sign in with Apple pieces, the
  Anthropic key, the five SMTP settings, the synthetic-traffic bypass key, the alert email, and the
  three staged managed-identity SQL inputs) are conditionally appended with further `jq --arg`
  calls (`deploy.yml:1390-1487`) **only when their env var is non-empty**. `jq --arg` JSON-escapes
  multi-line values correctly, critical for the Apple `.p8` PEM, which contains newlines. Anything
  not appended falls back to the `@secure()` parameter's empty-string default in `main.bicep`,
  which the template's feature flags (`hasAnthropic`, `hasAppleOAuth`, …) read to disable the
  corresponding feature.
- `useManagedIdentitySql` is the one boolean: it is appended as a literal JSON `true` only when the
  `USE_MANAGED_IDENTITY_SQL` repository variable is exactly `"true"` (`deploy.yml:1484-1487`), keeping
  the Bicep parameter typed.

[Rubric §11, Security] is directly served: there is no checked-in parameters file to leak secrets from at
all; the actual secret values flow from GitHub Actions secrets (encrypted at rest, masked in logs, visible
only to the `production` deploy environment) into the ephemeral `jq`-assembled `/tmp/deploy-params.json`
that exists only for the duration of the workflow run.

---

## `infra/main.bicep`, the full application infrastructure

**File:** `MMCA.ADC/infra/main.bicep`

`main.bicep` declares every application-layer Azure resource: Application Insights, three SLO
scheduled query rules and their action group, three operational scheduled query rules, one
conditional AI-scoring token-ceiling rule (`main.bicep:460-522`), a Gateway
availability web test and its severity-1 alert, a saved SLO workbook (`main.bicep:600-620`), the
monthly cost budget, SQL Server with the four per-service databases, Service Bus, references to the
manually provisioned Notification Hub, the blob storage account with its two declared containers
(public avatars and the private DataProtection key ring), an Azure Managed Redis instance, the
Container Apps environment, fifteen Key Vault secrets, and all six container apps. All billable
resources receive the same tag set (`main.bicep:155-161`) so Azure Cost Analysis can attribute
spend by application and environment.

### Parameters (`main.bicep:1-138`)

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
  `appleOAuthPrivateKeyPem` (`main.bicep:71`), `anthropicApiKey` (`main.bicep:75`),
  `smtpPassword` (`main.bicep:91`), optional integration secrets.
- `syntheticTrafficSecret` (`main.bicep:98`), the shared key that lets the monthly k6 capacity
  proof bypass the gateway edge rate limiter
  ([ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html)
  amendment). Left empty the bypass is entirely off, which is the safe default: it exists so a
  synthetic run measures backend capacity rather than the per-IP window.

**Image tags** (one per deployable, passed as `sha`-tagged ACR URLs, e.g.
`acrLoginServer/mmca-adc-gateway:<commit-sha>`):
- `gatewayImage`, `uiImage`, `conferenceImage`, `identityImage`, `engagementImage`,
  `notificationImage` (`main.bicep:100-116`).

**Staged-hardening and feature switches**:
- `sqlAadAdminLogin`, `sqlAadAdminObjectId` (`main.bicep:30,33`), default empty, provision the
  additive Entra admin on the SQL server.
- `useManagedIdentitySql` (`main.bicep:36`), default `false`, swaps the app-to-database auth segment
  (see [ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html) below).
- `deployNotificationHub` and `nativePushEnabled` (`main.bicep:120,123`) both default **true**.
  Read the description carefully before assuming that means the template creates the hub: it does
  not. `deployNotificationHub` gates only the **wiring** (the Key Vault connection-string secret
  and the Notification app's secret/env refs), because the namespace, hub and auth rule are
  declared `existing` and provisioned by runbook (see the Notification Hub section).
- `grantAvatarStorageRole` (`main.bicep:129`), default `false`, because the deploy identity
  deliberately lacks `Microsoft.Authorization/roleAssignments/write`.

**FinOps and alerting controls**:
- `enableBudget` (`main.bicep:132`), `monthlyBudgetAmount` (`main.bicep:135`),
  `budgetStartDate` (`main.bicep:138`), govern the cost budget resource (see below).
- `aiScoringTokenCeiling` (`main.bicep:78`), an `int` defaulting to `2000000`, is the only
  parameter that bounds a **third-party** meter rather than an Azure one: it is the Anthropic
  input-plus-output token envelope of one full AI scoring pass over a conference's submissions,
  times a safety factor, and it is the threshold of the conditional alert described below. Its
  description states the non-obvious part (`main.bicep:77`): the number is a **per-window** ceiling
  over any rolling two days, not a monthly one, because two days is the longest range a scheduled
  query rule will evaluate.
- `alertEmailAddress` (`main.bicep:120`) is **required**: it carries `@minLength(3)` and no default
  (`main.bicep:118-120`), so a template that would provision alerts notifying nobody fails to deploy.
  It is the receiver on both the action group and the budget notifications.

### Computed variables (`main.bicep:140-182`)

Six boolean flags gate optional blocks throughout the template:
- `hasAnthropic` (`main.bicep:143`), gates the Anthropic API key secret and env var on Conference.
- `hasSmtpPassword` (`main.bicep:144`), gates the SMTP password `secretRef` on Identity and
  Notification.
- `hasSyntheticTrafficSecret` (`main.bicep:145`), gates the Gateway's only secret and the
  rate-limiter bypass env var.
- `hasGitHubOAuth`, `hasGoogleOAuth`, `hasAppleOAuth` (`main.bicep:146-148`), each requires
  **every** piece of its provider's configuration to be present, so a half-configured provider is
  never wired: Apple needs all four (services id, team id, key id, private key PEM).
- `hasAnyOAuth` (`main.bicep:151`) is the provider-independent one: `OAuth__UIBaseUrl` is the
  post-login redirect target, so it must be injected whenever _any_ external provider is on rather
  than behind one of them.

There is no `useRs256` flag any more. RS256 is unconditional because the RSA parameters are
required, which is why Identity's `Jwt__SigningAlgorithm` is a literal `'RS256'`
(`main.bicep:1160`) rather than a ternary.

Per-service SQL connection strings (`main.bicep:174-177`) are composed from a shared base: the SQL
server FQDN plus one of two auth segments selected by `useManagedIdentitySql` (`main.bicep:170-172`).
Each is a distinct string pointing at its own database (`ADC_Identity`, `ADC_Conference`,
`ADC_Engagement`, `ADC_Notification`), making the database-per-service boundary explicit in the value
that goes into Key Vault.

The Service Bus connection string (`main.bicep:182`) is resolved via `listKeys()` against the
`app-clients` SAS authorization rule (not `RootManageSharedAccessKey`) so a future migration to
managed identity can revoke only the app rule without touching the namespace root. The Redis
connection string (`main.bicep:952`) is assembled the same way, from the instance hostname plus a
`listKeys()` primary key.

### Application Insights (`main.bicep:195-267`)

A workspace-based App Insights component backed by the foundation Log Analytics workspace
(`main.bicep:203-213`):

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
Every container app receives `APPLICATIONINSIGHTS_CONNECTION_STRING` (`main.bicep:218-221`) and a
per-service `OTEL_SERVICE_NAME` (e.g. `'identity'`, `'conference'`). The `OTEL_SERVICE_NAME` env
var is what Azure Monitor maps to the Cloud Role Name, without it, all services appear as
`"unknown_service"` in the Application Map.

`MMCA.Common.Aspire`'s `AddOpenTelemetryExporters` calls `UseAzureMonitor()` whenever
`APPLICATIONINSIGHTS_CONNECTION_STRING` is present (`main.bicep:198-202` comment), so the Common
framework automatically routes OpenTelemetry spans, logs, and metrics to Azure Monitor in
production with no service-level code change.

Five more shared env entries ride along with the connection string on every app, and all of them
are cost controls on a pay-per-GB workspace:

- `Telemetry__TracesSampleRatio: '0.25'` (`main.bicep:227-230`), head-based trace sampling that keeps
  25% of traces. `ParentBased` sampling in `MMCA.Common.Aspire` keeps a sampled-in trace intact
  across service boundaries, so a kept trace is still end-to-end rather than a fragment.
- `Logging__OpenTelemetry__LogLevel__Default: 'Warning'` (`main.bicep:238-241`), the floor for what the
  OpenTelemetry logging provider ships to Azure Monitor. Serilog still writes Information to stdout
  (container logs), but only Warning and above bills against the workspace. The value is set
  explicitly because `OpenTelemetry` is the `ProviderAlias` of `OpenTelemetryLoggerProvider`, so the
  key gates that provider only, and because the service hosts register Serilog as one provider
  alongside OpenTelemetry instead of calling `UseSerilog()`, which would replace the
  `ILoggerFactory` and drop every application log line before it could reach App Insights.
- `Telemetry__DisableHttpClientMetrics: 'true'` (`main.bicep:249-252`) and
  `Telemetry__DisableRuntimeMetrics: 'true'` (`main.bicep:253-256`), which drop the two
  highest-volume instrument groups from the `AppMetrics` stream. The comment records the
  measurement that motivated them (`main.bicep:243-248`): the `http.client.*` connection gauges
  plus the `dotnet.*` runtime instruments were about 65% of AppMetrics ingestion between
  2026-08-03 and 2026-08-09, roughly 290 MB/day of a roughly 500 MB/day stream, while
  `http.server.request.duration` and the MMCA.Common meters carry the operational signal. Both
  keys are read by `MMCA.Common.Aspire`'s `ConfigureOpenTelemetry`, and the outbound-dependency
  latency the client metrics would have shown is still captured as (sampled) `AppDependencies`
  traces, so this trims volume rather than visibility.
- `OTEL_METRIC_EXPORT_INTERVAL: '300000'` (`main.bicep:264-267`) is the second stage of the same
  cost control, and it works on cadence rather than on instrument selection. AppMetrics remained
  about 63% of workspace ingestion after the two instrument groups above were dropped (measured
  2026-08-01 to 2026-08-22, `main.bicep:258-263`). The exporter ships **cumulative** aggregates, so
  stretching the export interval from the SDK default of 60s to 300s drops roughly 80% of the
  remaining datapoints without losing the signal: every alert rule in this template evaluates over a
  15-minute window, so a 5-minute export cadence still lands datapoints in every window.
  This is the standard OpenTelemetry SDK env var, read by the periodic exporting metric reader
  rather than by any MMCA.Common code.

Every one of the six apps gets all five: Identity (`main.bicep:1128-1133`), Conference
(`:1337-1342`), Engagement (`:1460-1465`), Notification (`:1602-1607`), Gateway (`:1762-1767`),
UI (`:1875-1880`). They are declared once as Bicep variables and spliced into each `env` array by
name, which is what keeps a cost decision from being applied to five apps and forgotten on the
sixth.

[Rubric §13, Observability & Operability] assesses whether the system ships distributed traces,
structured logs, and metrics to a queryable backend. The workspace-based App Insights with
per-service Cloud Role Names gives full Application Map visibility, end-to-end distributed traces
across all six services, and Kusto-queryable logs, covering this category end-to-end.

### SLO alerts as code (`main.bicep:269-384`), [ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html)

The three SLOs are declared as **data**: an array of records named `sloAlertSpecs`
(`main.bicep:305-333`) carrying `key`, `description`, `query`, `timeAggregation`,
`metricMeasureColumn`, `threshold` and `severity`. A Bicep `for` loop materializes one Log Analytics
`Microsoft.Insights/scheduledQueryRules` per spec (`main.bicep:335-381`):

| Alert key | KQL source | Threshold | Window | Severity |
|---|---|---|---|---|
| `failed-requests` | `AppRequests` where `Success == false`, excluding 401/499 | > 10 rows | 15 min | 2 (Error) |
| `server-response-time` | `AppRequests` excluding `/hubs/`, `avg(DurationMs)` | > 3000ms | 15 min | 3 (Warning) |
| `dependency-failures` | `AppDependencies` where `Success == false`, excluding 401/499 | > 10 rows | 15 min | 2 (Error) |

**The KQL predicate is the whole point of the migration.** These rules replaced metric alerts on
`requests/failed`, `requests/duration` and `dependencies/failed`, which paged on routine traffic
because a metric alert cannot express a status-code or URL predicate. The template records the two
real incidents (`main.bicep:291-304`): one window held 8x401 plus 2x499 plus a single readiness 503
and zero other failures, all from one browser session retrying with an expired token, and five
long-lived SignalR hub connections averaging 11.3s dragged the fleet-wide average to 5539ms against
a 3000ms threshold while every real request was fast. A hub connection reports its **connection
lifetime** as request duration. The thresholds and severities are unchanged, so this is a precision
fix, not a sensitivity cut: a genuine 400 or 500 burst still pages at the same numbers.

The `union(...)` in the criteria (`main.bicep:361-373`) supplies `metricMeasureColumn` only for the
aggregate rule. Omitting it (the empty-string case) makes a rule count returned **rows**, which is
what the two failure-count SLOs want.

**Evaluation frequency now matches the window: `PT15M` over `PT15M` with `autoMitigate: true`**
(`main.bicep:353-355`). It used to re-evaluate every five minutes over the same 15-minute window,
and the template records why that changed (`main.bicep:348-352`): a scheduled-query rule is billed
per evaluation, and the 5-minute tier costs $1.47/month per rule against about $0.50 at 15 minutes,
across three rules. Because `windowSize` was already `PT15M`, each evaluation still looks at exactly
the same 15 minutes of data, no threshold moves, and no rule is renamed; what disappears is the
overlapping evaluations the 5-minute frequency produced. The cost is detection latency: a breach is
now noticed within 15 minutes rather than 5, which is why the fast path is covered by the deploy
smoke gate rather than by these rules.

**The superseded metric alerts are gone from the template, and their `-v2` names are the residue.**
An earlier revision kept the three replaced `metricAlerts` declared under their original names with
`enabled: false`, because Incremental ARM never deletes a resource that simply leaves the template.
They have since been retired in Azure and dropped from the source; what remains is a comment
recording that the scheduled-query rules are now the SLO alerts and that the severity-1
availability metric alert stays because availability has no status-code confound
(`main.bicep:383-384`). The `-v2` suffix on the replacement names is still load-bearing, and the
template says why (`main.bicep:337-338`): the suffix is part of a rule's identity in Azure, so
renaming it would create a second rule alongside the live one rather than update it.

The action group (`main.bicep:275-289`) has an **unconditional** email receiver, which is the direct
consequence of `alertEmailAddress` being a required parameter. Every scheduled query rule routes to
it (`main.bicep:377`, `:454`) and so does the cost budget (`main.bicep:645`, `:653`). One group, one
receiver, no severity routing: severity is triage metadata, not a delivery decision.

Each SLO alert is paired with a same-severity triage section in `MMCA.ADC/infra/OPERATIONS.md`
(`OPERATIONS.md:15`, `:29`, `:42`), and that pairing is enforced by a framework fitness test rather
than by discipline: `ObservabilityConventionTestsBase` parses this template between the literal
anchors `var sloAlertSpecs` and `resource sloAlerts`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:109-110`)
and fails the build in both directions. That gate is covered in
[group 27](group-27-testing-infrastructure.md#observabilityconventiontestsbase); it is not
duplicated here. Note the coverage boundary, which the runbook itself spells out
(`OPERATIONS.md:57-63`): only alerts inside that parse window are gated, so the operational rules
and the availability alert below are provisioned but ungated, and their triage deliberately sits
under `####` headings so the parser does not read them as SLO runbook sections.

### Operational and availability alerts (`main.bicep:386-598`)

Beyond the three SLOs, `main.bicep` provisions **three** more scheduled query rules from
`scheduledQueryAlertSpecs` (`main.bicep:405-424`, materialized at `:426-458`), all severity 2 on a
15-minute evaluation over a 15-minute window:

- `outbox-dead-letter` (`main.bicep:406-411`) fires on **any** hit (`threshold: 0`) of an `AppTraces`
  row at Error or above whose message contains `dead-lettered`. An outbox message that exhausted its
  retries means an integration event was permanently lost. The row-age signal is DB-side and not
  queryable from Log Analytics, so this Error line _is_ the backlog alarm.
- `sql-dependency-failures` (`main.bicep:412-417`) fires above 10 failed SQL dependency calls. Every
  service owns exactly one database, so a burst here means a service cannot reach its own DB, which
  also stalls its outbox drain.
- `revision-activation-failed` (`main.bicep:418-423`) is the newest of the three and the most
  instructive, because it exists to catch a failure the rest of the alerting stack is blind to. It
  queries `ContainerAppSystemLogs_CL` for `Reason_s startswith "Deployment Progress Deadline
  Exceeded"` and fires on any hit. When a revision's readiness probe never goes green, Container
  Apps keeps the **previous** revision serving: nothing outside-in degrades, every SLO stays quiet,
  and the deploy looks fine while the newly built code never takes traffic. The comment names the
  incident that motivated it (`main.bicep:399-404`): the 2026-08-29 Redis readiness regression,
  where an untagged infrastructure health check failed `/health/ready` on every backend and the
  older revision kept 100% of the traffic for days. The rule works at all only because the
  environment's `appLogsConfiguration` sends platform system logs to the same workspace.

The two older rules each have a `####` triage section in the runbook (`OPERATIONS.md:65`, `:100`);
`revision-activation-failed` does not have one, which the ungated coverage boundary above allows,
and the runbook still describes this block as carrying two scheduled query rules
(`OPERATIONS.md:57-58`). Its `description` field (`main.bicep:420`) carries the first-response
instructions instead.

An outside-in availability signal sits alongside them: a standard URL-ping web test
(`main.bicep:536-567`) probes the public Gateway `/health` every **900 seconds** from three Azure
locations (East US, North Central US, South Central US), bound to the App Insights component via a
`hidden-link` tag. The cadence was 300 seconds until 2026-09-02, and the template records the
trade (`main.bicep:530-535`): standard web tests bill per location-execution, three locations every
five minutes came to $13.39/month on this subscription, and the **locations are unchanged**, so the
2-of-3 confirmation that keeps a single-location blip from paging is intact and only detection
latency moves, from about 5 minutes to about 15.

Its severity **1** alert (`main.bicep:569-598`) fires on a `failedLocationCount` of 2, and its
window had to move with the probe: `evaluationFrequency: 'PT15M'` over `windowSize: 'PT15M'`
(`main.bicep:583-584`). The reason is worth reading, because it is the failure mode a naive cadence
change would have introduced (`main.bicep:578-582`): at `Frequency: 900` each location reports once
per 15 minutes, so a `PT5M` window would usually be **empty** and the rule would evaluate nothing.
`PT15M` restores exactly one result per location per window, which is what `failedLocationCount`
counts, so the 2-of-3 threshold keeps its meaning without being renumbered. The runbook explains the
other non-obvious part (`OPERATIONS.md:140-146`): `/health` is the Gateway's readiness endpoint and
aggregates one `downstream-{name}` check per service, so a perfectly healthy Gateway can still fail
this probe because a backend is unhealthy. (The runbook's parenthetical still describes the probe as
5-minute, `OPERATIONS.md:130`; the template is the ground truth.)

[Rubric §29, Resilience, Reliability & Business Continuity] assesses whether the system can detect
degradation automatically and notify operators. The three SLO rules, the three operational rules,
and the sev-1 availability alert all route to the same action group as the cost budget, giving the
on-call operator an automated signal for error rate, latency, dependency failures, permanent event
loss, database reachability, a silently failed rollout, and total entry-point outage. The 2026-09-02
cadence changes are the honest counterweight: this stack now trades roughly ten minutes of detection
latency for a materially smaller monitoring bill, and the deploy-time gates carry the fast path.

### AI-scoring token-ceiling alert (`main.bicep:460-522`)

The newest rule in the template is the only one that watches a **third-party** meter, and it is the
only alert here that is conditional. `aiScoringSpendAlert` (`main.bicep:475`) is declared
`if (hasAnthropic)`, fires at severity **3**, and compares a two-day token total against the
`aiScoringTokenCeiling` parameter (`main.bicep:510`):

```bicep
query: 'AppMetrics | where Name in ("scoring.tokens.input", "scoring.tokens.output") | summarize AggregatedValue = sum(Sum)'
timeAggregation: 'Total'
metricMeasureColumn: 'AggregatedValue'
operator: 'GreaterThan'
threshold: aiScoringTokenCeiling
```

Four decisions in it are worth reading, because each one is a constraint rather than a preference:

- **Why the rule exists at all** (`main.bicep:466-469`). Every scored submission is a paid Anthropic
  call, and an organizer can trigger a full pass over an entire event's submissions. Nothing in the
  Azure budget resource sees that spend: it lands on an Anthropic invoice, not on the subscription.
  The cost risk is therefore a repeated or runaway pass, and this rule is the only signal that
  notices one.
- **Why it queries `AppMetrics`** (`main.bicep:461-465`). The Conference scoring pipeline emits two
  counters, `scoring.tokens.input` and `scoring.tokens.output`, from the
  `MMCA.ADC.Conference.Scoring` meter. In a workspace-based component the classic `customMetrics`
  table surfaces under its workspace-schema name `AppMetrics`, the same schema family the SLO rules
  above query, with `Name` / `Sum` / `ItemCount` as its measure columns. The comment also closes the
  obvious worry (`main.bicep:472-474`): the two metric-group disables described in the App Insights
  section drop only the http-client and runtime instrument **groups**, so an application meter like
  this one keeps exporting.
- **Why `windowSize: 'P2D'` and not thirty days** (`main.bicep:487-494`). Two days is the longest
  data range a scheduled query rule will evaluate. The first cut of this rule asked for a 30-day
  lookback through `overrideQueryTimeRange` and ARM rejected the **whole deployment**
  (`InvalidRequestContent`, "OverrideQueryTimeRange of 43200 minutes is not supported ... 2880",
  deploy run 33972401924, 2026-09-05), which is the failure mode worth remembering: an unsupported
  alert property does not degrade the alert, it fails the infrastructure deploy that carried it. A
  two-day rolling total against a single-pass envelope is the honest runaway signal anyway, since one
  legitimate pass fits inside it and a repeated one does not. `evaluationFrequency: 'P1D'` keeps the
  per-evaluation billing near zero, and `autoMitigate: true` (`main.bicep:502`) exists because
  consecutive daily evaluations overlap the same window: the alert resolves itself once the window
  rolls past the spike.
- **Why severity 3 and why `hasAnthropic`** (`main.bicep:470-471`, `:482-484`). Nothing is down when
  a budget ceiling is crossed, so it must not page the way the sev-1 availability and sev-2 failure
  rules do. And with no API key deployed the feature is inert and emits nothing, so an unconditional
  rule could only ever evaluate zero while still billing per evaluation.

It routes to the same action group as everything else (`main.bicep:518-520`). Like the three
operational rules, it sits **outside** the `var sloAlertSpecs` / `resource sloAlerts` parse window,
so `ObservabilityConventionTestsBase` does not require a runbook section for it and
`OPERATIONS.md` has none; its `description` field (`main.bicep:481`) carries the first response
instead, which is to look for a repeated or runaway full-event scoring pass before raising the
ceiling.

[Rubric §31, Cost Efficiency / FinOps] assesses whether cost is actively monitored, bounded and
governed. This rule extends that discipline past the Azure bill: the budget resource below bounds
subscription spend, `cost-guard.yml` bounds a surge left un-reverted, and this bounds the one meter
that neither of them can see, with the envelope itself expressed as a reviewable Bicep parameter
rather than as an assumption inside the scoring code.

### SLO workbook (`main.bicep:600-620`)

A saved Azure Monitor workbook renders the same three SLO signals plus exceptions, grouped per
service by `AppRoleName` (which is the `OTEL_SERVICE_NAME` value). It is bound to the Log Analytics
workspace and embeds `workbooks/adc-slo-workbook.json` at **compile time** via `loadTextContent`
(`main.bicep:617`), so the visualization cannot diverge from the alerts by being maintained
somewhere else, and the JSON stays independently validatable as a file.

### Cost budget (`main.bicep:622-657`)

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
address and the SLO action group (`main.bicep:644-645`, `:652-653`). The primary guard this budget
provides is against an un-reverted conference-day surge: the surge is a manual scale-up of the SQL
tier and the Container App replica caps, and left running for weeks it would push the monthly bill
well past $200 and trigger both thresholds long before the billing cycle closes. The
`cost-guard.yml` workflow is the same guard from the other direction: it is one of `deploy`'s
required gates (`deploy.yml:1237`, job at `:749`) and fails the deploy outright when a database is
off the Basic tier or an app's `maxReplicas` exceeds the `BASELINE_MAX_REPLICAS` of 2
(`cost-guard.yml:25`, `:61`, `:76`).

`enableBudget: bool` (`main.bicep:132`) allows disabling the resource when the deploy identity
lacks `Microsoft.Consumption/budgets/write` (as is the case in some sponsor subscriptions).
`budgetStartDate` (`main.bicep:138`) is pinned at creation and must not change on an existing
budget, ARM rejects start-date changes on update. The comment in `main.bicep:137` records this
constraint directly so future operators don't hit the ARM error.

[Rubric §31, Cost Efficiency / FinOps] assesses whether infrastructure cost is actively
monitored, bounded, and governed. The budget resource, the `enableBudget` escape hatch, the
workspace daily ingestion cap, the 25% trace sampling, the Warning log floor, the two
metric-group disables, the 300-second metric export interval, the 30-second readiness probes, the
15-minute alert and web-test cadences, the AI-scoring token ceiling on the one meter Azure cannot
see, the uniform 0.25 vCPU container sizing, the two-step daily
ACR purge task, and the `commonTags` applied to every billable resource (`main.bicep:155-161`)
together satisfy this category: tags enable cost attribution; the caps bound runaway spend at the
telemetry, storage, monitoring and compute ends; and the budget threshold notifications make the cap
actionable. The August 2026 bill of $256 is what motivated the 2026-09-02 pass, and every reduction
in it carries its measurement in the comment beside it.

### SQL Server and databases (`main.bicep:659-763`)

**SQL Server** (`main.bicep:662-673`):
```
name: '${prefix}-sql-${resourceToken}'
version: '12.0'
minimalTlsVersion: '1.2'
publicNetworkAccess: 'Enabled'
```

`publicNetworkAccess: 'Enabled'` (`main.bicep:671`) combined with the firewall rule
`AllowAzureServices` (`main.bicep:675-682`, startIpAddress/endIpAddress both `0.0.0.0`) is the
Azure-standard pattern for allowing Container Apps to reach SQL without a VNet/private endpoint.
The `0.0.0.0-0.0.0.0` rule does not allow traffic from arbitrary internet IPs; it enables the
special "allow Azure services" flag. `minimalTlsVersion: '1.2'` (`main.bicep:670`) ensures all
connections are encrypted at TLS 1.2 minimum.

**Entra (Azure AD) admin** (`main.bicep:690-699`), provisioned only when `sqlAadAdminObjectId` is
supplied. It is deliberately **additive**: it enables Entra auth alongside the SQL admin login and
does **not** set `azureADOnlyAuthentication`, so password auth keeps working throughout the
transition (`main.bicep:684-689`). Its purpose is to let an operator run the per-database
`CREATE USER [adc-prod-apps-identity] FROM EXTERNAL PROVIDER` grants that managed-identity app auth
depends on. Full sequencing lives in `infra/SQL-MANAGED-IDENTITY.md`; the staged model is described
in the Key Vault section below.

**The legacy `AtlDevCon` database is gone, and its absence is documented in place**
(`main.bicep:701-713`). After the database-per-service cutover it served no application, its data
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
(`main.bicep:711-713`): a SQL server literally named `atldevcon` (westus2) also lives in `acc-rg`,
predates MMCA entirely, and must never be referenced, scaled or deleted as if it belonged to this
deployment.

**Per-service databases** (`main.bicep:722-745`), `[Rubric §8, Data Architecture]`:

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
(`main.bicep:716-721`). [Rubric §8, Data Architecture] assesses deliberate persistence strategy
including transactions, isolation, migrations, and bounded ownership. The four separate databases
implement [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html): each
service owns exactly its data; no cross-database foreign keys exist; each service's outbox
(`OutboxMessages` table) lives in its own database so the outbox processor never races for another
service's rows. See [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) and
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) for the full rationale.

[Rubric §7, Microservices Readiness] assesses whether the service boundary includes data
autonomy, not just code autonomy. These four Basic-tier databases on one SQL server are the
cheapest expression of full data autonomy: each service has an independent schema, independent
migrations, independent outbox, and can be moved to its own server later without application
changes.

**Long-term backup retention (LTR)** (`main.bicep:752-763`):

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
adds weekly (4-week), monthly (12-month), and yearly (1-year) archival on top (`main.bicep:747-751`).
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

### Azure Service Bus (`main.bicep:765-807`)

```
sku: Standard   // Basic rejected: MassTransit requires topics, Basic supports queues only
minimumTlsVersion: '1.2'
```

The Standard tier comment at `main.bicep:773-777` is the explanation of a constraint that has
bitten the project before: MassTransit's `UsingAzureServiceBus` auto-provisions
one topic per message type and one subscription per consumer, Basic tier has no topics, only
queues, so it silently fails at MassTransit startup. Standard tier costs a flat ~$10/month base for
the namespace plus per-million-operations, and the link/unlink flows are far below 1k messages a
month even at conference scale.

The `app-clients` authorization rule (`main.bicep:797-807`) grants `Send + Listen + Manage` rights.
The `Manage` right is required so MassTransit can `ConfigureEndpoints`, auto-provision topics
and subscriptions at startup, and without it the first publish fails with an Unauthorized topology
error (`main.bicep:791-796`). The alternative (declaring every topic in Bicep) would be brittle
as new integration events are added, because it would require a Bicep change for every new event
type. The runbook restates the same constraint as a triage step (`OPERATIONS.md:86-88`): a tier
downgrade or a rights reduction looks like a publish failure on every service at once.

Current integration event flows wired over Service Bus (documented at `main.bicep:768-771`):
- Identity publishes `UserRegistered` → Conference `UserRegisteredHandler` auto-links a speaker
  by email match (BR-207).
- Conference publishes `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser` → Identity updates
  `User.LinkedSpeakerId` (BR-209/BR-70).

These events cross service boundaries asynchronously via the outbox + MassTransit; the Service Bus
namespace is the transport that carries them in production (RabbitMQ fills the same role locally).
All four services receive `MessageBus__Provider` and `MessageBus__ConnectionString`, but only
Identity and Conference call `AddBrokerMessaging` today: the Engagement and Notification entries are
pre-provisioned forward-compatible wiring, and the template says so (`main.bicep:1497-1501`,
`:1637-1640`), so adding a consumer later is a `Program.cs` change with no infra redeploy.

### Azure Notification Hub (`main.bicep:809-835`), referenced, never deployed

The [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) native-push fan-out
(FCM v1 and APNs) has a topology that is real in Azure but is **not created by this template**. The
namespace, the `adc-push` hub, and its `app-backend` authorization rule are all declared with the
`existing` keyword (`main.bicep:820`, `:824`, `:832`), and the comment above them records why
(`main.bicep:812-819`): ARM PUTs on this namespace never reach a terminal state. It reports status
`Created` rather than `Active`, so a template deployment polls until the deploy job times out, hit
twice on 2026-08-24 across two API versions. The resources are therefore provisioned by hand
(`az rest`, runbook section 5) and merely referenced here.

That changes what the two parameters mean, and it is the single most misreadable part of this
template. `deployNotificationHub` (`main.bicep:126`) defaults to **true** and gates only the
*wiring*: the Key Vault connection-string secret (`main.bicep:1026-1030`), the Notification app's
`secretRef` entry (`:1589`), and its three `NativePush__*` env vars (`:1657-1661`). When it is true
the hub resources must already exist, or the `listKeys()` call against the auth rule fails.
`nativePushEnabled` (`main.bicep:123`, also default true) is the second switch and only decides
the value of `NativePush__Enabled` (`:1658`). With the vars absent entirely, the service's own
`appsettings` default of `NativePush:Enabled=false` keeps the channel inert. The hub's Free tier
covers 500 devices and 1M pushes per month, far above conference volumes.

### Blob storage: avatars and the DataProtection key ring (`main.bicep:837-905`), [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)

One `Standard_LRS` StorageV2 account (`main.bicep:845-858`) carries two declared containers on the
same `default` blob service. The first is the public-read `avatars` container
(`main.bicep:865-871`). Public read is deliberate: avatar URLs render in `<img>` tags on
anonymous-visible surfaces with no SAS plumbing, and blob names carry a random suffix so they are
not enumerable. The account sets `minimumTlsVersion: 'TLS1_2'` and `supportsHttpsTrafficOnly: true`.

The second is `dataProtectionKeysContainer` (`main.bicep:878-884`), named `dataprotection-keys` and
explicitly `publicAccess: 'None'`. It holds the shared ASP.NET Core DataProtection key ring for the
two apps that mint cookies (Identity and UI), and its privacy is the whole point of declaring it
separately rather than reusing `avatars`: a key ring readable anonymously would hand out the keys
that protect every auth cookie and antiforgery token in the system. The comment above it
(`main.bicep:873-877`) states the failure it prevents: both apps run at `maxReplicas: 2`, and the
default in-memory key ring is per replica, so a token minted by one replica is undecryptable by the
other. The per-app wiring is in the Identity and UI subsections below.

This same account also holds a third, **undeclared** container: `sql-archive`, where the
`AtlDevCon-20260902.bacpac` archive lives (`main.bicep:705`). It was created out of band by the
export command and the template does not manage it, which is worth knowing before assuming the two
declared containers are the whole account.

The Identity service authenticates to it with `DefaultAzureCredential` resolving the shared apps
identity, so there is no connection-string secret. Control-plane ownership of the account does not
grant blob writes, though: the `Storage Blob Data Contributor` data-plane assignment
(`main.bicep:897-905`) is what does, and it is guarded by `grantAvatarStorageRole`, default `false`,
for exactly the same reason as the Key Vault grants. Until an operator applies it once by hand,
avatar uploads fail cleanly with `FileStorage.UploadFailed` and everything else deploys. That one
assignment is scoped to the storage **account**, not to a container, so it also covers the key-ring
container: the shared key ring needs no second role assignment, and the template says so
(`main.bicep:891-892`).

[Rubric §11, Security] assesses credential and key handling. One follow-up is recorded in the
template as **not implemented** (`main.bicep:893-896`): encrypting the key ring at rest with a Key
Vault key (`DataProtection__KeyVaultKeyUri`) would need a separate Key Vault Crypto User grant on
the apps identity, and neither the env var nor the grant exists today. The comment states the
reason blob persistence deliberately works without it: a missing or delayed crypto grant would
otherwise be able to break authentication outright, so at-rest encryption is kept as independent
hardening rather than a prerequisite. The framework side is built the same way, with the key-vault
step behind its own gate on `DataProtection:KeyVaultKeyUri`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:74-85`),
so the infrastructure gap and the code path agree.

### Azure Managed Redis (`main.bicep:907-952`)

One shared `Microsoft.Cache/redisEnterprise` instance at the `Balanced_B0` SKU (1 GB, HA disabled,
around $13/month) with a single `default` database on port 10000, encrypted client protocol,
`OSSCluster` clustering, `VolatileLRU` eviction and both persistence modes off
(`main.bicep:921-949`). Volatile-only eviction is deliberate: cache entries and idempotency records
carry TTLs, and a key without a TTL must never be silently evicted (`main.bicep:941-942`).

Every service gets `ConnectionStrings__redis` from the vault, and three consumers activate on that
key alone with no application change (`main.bicep:910-918`):

1. `ICacheService` upgrades from a per-replica `MemoryCache` to `DistributedCacheService`, which
   makes the `IdempotencyFilter`'s 24h replay records cross-replica (with `maxReplicas: 2` a
   duplicate POST routed to the other replica used to execute twice) and propagates
   `CachingQueryDecorator` invalidation to every replica.
2. `AddRedisDistributedCache` in each service `Program.cs`, conditional on the same key.
3. The Notification SignalR backplane auto-wires when the key appears, via
   `MMCA.Common.Infrastructure`'s `AddPushNotifications`.

The `OSSCluster` clustering policy is worth noting alongside the `revision-activation-failed` alert
above: this is the resource whose readiness interaction silently pinned production to an old
revision for four days in 2026-08 (`deploy.yml:1517-1521`).

### Container Apps environment (`main.bicep:954-970`)

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

### UAMI and ACR credential model (`main.bicep:972-985`)

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
template only *references* it (`existing` keyword, `main.bicep:977-979`), not creates it, because
the deploy identity (also a UAMI, used by GitHub Actions via OIDC) has `Contributor` but not
`Microsoft.Authorization/roleAssignments/write` (`main.bicep:972-976`), creating role assignments
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

### Key Vault and runtime secrets (`main.bicep:987-1077`), [ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)

```bicep
resource keyVault '…/vaults@…' existing = {
  name: 'adckv${resourceToken}'
}
```

**Every production secret lives in Key Vault and reaches a Container App as a reference, never as a
value.** Key Vault is bootstrapped out-of-band like the identity: the template declares it `existing`
(`main.bicep:997-999`) and then writes fifteen secret child resources into it
(`main.bicep:1001-1077`). Each Container App references them by Key Vault URI through the shared UAMI:

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
consume them only through `secretRef` (for example `main.bicep:1142`, `:1158`, `:1215`, `:1347`,
`:1618`). At runtime ACA fetches the current secret version via the UAMI's Key Vault Secrets User
role, meaning a secret rotation only requires updating the Key Vault secret, no Bicep re-deployment,
no app restart.

Secrets stored in Key Vault (`main.bicep:1001-1077`), fourteen unconditional plus one gated:
- Per-service SQL connection strings (4): `identity-sql-connection-string`,
  `conference-sql-connection-string`, `engagement-sql-connection-string`,
  `notification-sql-connection-string` (`main.bicep:1001-1020`)
- `service-bus-connection-string` (`:1021`), `redis-connection-string` (`:1031`)
- `notification-hub-connection-string`, the one conditional secret, written only when
  `deployNotificationHub` is true (`main.bicep:1026-1030`)
- `rsa-private-key-pem`, `rsa-public-key-pem` (`:1036`, `:1041`), both always real values because the
  parameters are required
- `smtp-password` (`:1046`), `synthetic-traffic-secret` (`:1053`), `github-oauth-client-secret`
  (`:1058`), `google-oauth-client-secret` (`:1063`), `apple-oauth-private-key` (`:1068`),
  `anthropic-api-key` (`:1073`)

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

**The two front-door apps hold almost nothing, and say so explicitly.** The UI declares
`secrets: []` (`main.bicep:1864`) rather than omitting the property: a Blazor host that talks only
to the Gateway holds nothing worth stealing, and stating it makes that a reviewable fact rather
than an omission. The Gateway carries exactly one secret and only conditionally
(`main.bicep:1742-1744`): the synthetic-traffic bypass key, resolved through the same shared
identity, present only when `hasSyntheticTrafficSecret`. A pure YARP proxy needs no credential to
forward a request; it needs one only to recognise the monthly capacity proof's bypass header.

**Both role assignments are bootstrapped out of band, deliberately.** The deploy identity holds Key
Vault Secrets Officer to write the values; the apps hold Key Vault Secrets User to read them; the
vault and both grants are created outside the template because the deploy principal has Contributor
without `Microsoft.Authorization/roleAssignments/write` (`main.bicep:990-993`). A template that
created its own role assignments would need exactly the permission the deployment deliberately does
not have. The trade-off is stated in the ADR: one shared identity means any app carrying it can read
**every** secret in the vault, not only the ones its own `secrets` list names, and the template
cannot report that a grant is missing.

**The same grant also backs a second, different consumption path.** Alongside the platform-resolved
`keyVaultUrl` secret references above, five of the six apps receive `KeyVault__Uri`
(`main.bicep:1203` Identity, `:1379` Conference, `:1508` Engagement, `:1652` Notification, `:1896`
UI), which turns the vault into an ASP.NET Core **configuration source**: `MMCA.Common`'s
`AddCommonKeyVaultConfiguration` is a no-op without the key, and with it the host reads the vault
synchronously at startup through `DefaultAzureCredential`. The Gateway is deliberately not in that
list (`main.bicep:994-996`): it holds no vault-backed configuration to read. The two paths differ in
who resolves the value: the platform does it for `secretRef` entries, the host process does it for
the configuration source, and both authenticate as the same `appsIdentity` that already holds Key
Vault Secrets User. Secret names use a double dash for the configuration separator, so the existing
single-dash secrets arrive as flat keys and shadow nothing the container already sets
(`main.bicep:1196-1202`).

That startup read is why `AZURE_CLIENT_ID` is on Conference, Engagement, Notification and the
UI (`main.bicep:1378`, `:1507`, `:1651`, `:1893`) and not only on Identity, where it was
introduced for avatar blob access (`:1195`). Each app carries only the user-assigned identity, and
the ACA identity endpoint needs that identity **named**, so without the pin `DefaultAzureCredential`
fails the startup vault read rather than falling back.

**The staged SQL auth completed its migration, but only the staging is visible in source.**
`useManagedIdentitySql` (`main.bicep:36`) defaults to `false` and selects one of two auth segments
for the shared connection string base (`main.bicep:170-172`): either
`Authentication=Active Directory Managed Identity;User Id=<apps identity client id>` with no
password at all, or `User ID=...;Password=...`. Reading the template alone suggests every
app-to-database string still carries a login and password (`main.bicep:172`), and that is what a
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
deployment: it creates an RBAC-authorized vault (`MMCA.Common/samples/deployment/main.bicep:67`,
`:74`), attaches the identity for both ACR pull and secret reads, composes the SQL connection string
from the server, database and admin login it just declared (`:103`), writes it into that vault as the
`sql-conn` secret (`:105-109`), declares it on the Container App as a `keyVaultUrl` + UAMI reference
(`:150`) and consumes it through `secretRef` (`:162`), which is the same end-to-end shape ADC runs.
Its own header note records the two out-of-band grants that make it work: Key Vault Secrets Officer
for the deploy principal to write the secret, Key Vault Secrets User for the app UAMI to read it
(`:98-102`). Worth knowing before trusting the sample as a template, though: CI only runs
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

All six apps (`main.bicep:1079-1954`) share:

- `identity: { type: 'UserAssigned', userAssignedIdentities: { '${appsIdentity.id}': {} } }`, the
  same shared UAMI on every app (`main.bicep:1086-1091`, `:1293-1298`, `:1427-1432`, `:1554-1559`,
  `:1723-1728`, `:1844-1849`).
- `activeRevisionsMode: 'Single'` (`main.bicep:1095`, `:1302`, `:1436`, `:1563`, `:1732`, `:1853`),
  one active revision at a time; new deploys create a new revision and traffic flips atomically
  rather than gradually. This is exactly what the post-deploy revision-activation gate asserts:
  the newest revision must be Healthy, Running and holding `trafficWeight` 100
  (`deploy.yml:1568-1573`).
- `resources: { cpu: json('0.25'), memory: '0.5Gi' }` on **all six** (`main.bicep:1124`, `:1333`,
  `:1457`, `:1598`, `:1758`, `:1871`), the smallest Container Apps allocation. Conference and the
  Gateway were the last two at 0.5 vCPU / 1 Gi and were right-sized on 2026-09-02 from measured
  production utilization; the two comments carry the measurements and the revert instruction
  (`main.bicep:1326-1332`, `:1751-1757`).
- `scale: { minReplicas: 1, maxReplicas: 2, rules: [{ name: 'http-scale', http: { metadata: { concurrentRequests: '50' } } }] }`
  on **all six** apps (`main.bicep:1281`, `:1415`, `:1542`, `:1707`, `:1816-1829`, `:1938-1951`).
  `minReplicas: 1` prevents scale-to-zero (which would destroy Blazor Server circuits and outbox
  in-flight messages); HTTP scale-out at 50 concurrent requests gives the headroom needed for a
  conference-day load (historically ~67 peak concurrent). Notification used to be capped at 1 and
  no longer is: the comment above its scale block (`main.bicep:1697-1706`) records why the cap was
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
  (`main.bicep:1165`, `:1365`, `:1487`, `:1633`), each service auto-applies its own database's
  pending migrations at startup as the **sole migrator**. `deploy.yml` deliberately has *no*
  separate `sqlcmd` migration step (a backstop would race the container's startup `Migrate()`,
  which is exactly what wedged MMCA.Store's first per-service deploy); with `minReplicas: 1`
  exactly one replica migrates before the revision serves (`deploy.yml:1497-1507`). The build-time
  EF model-drift gate (`deploy.yml:375-389`) still guarantees a migration exists for every model
  change, across all four migrations projects.
- `Outbox__PollingIntervalSeconds: '300'` (`main.bicep:1149`, `:1352`, `:1475`, `:1623`), the outbox
  signal + smart wait in MMCA.Common ≥ 1.50.0 delivers real messages in ~5 seconds regardless of the
  poll interval; the 300-second poll only governs idle polling. This cuts App Insights SQL dependency
  telemetry that would otherwise flood the workspace around the clock (the
  `OutboxPollFilterProcessor` suppresses the poll spans from App Insights per the memory note
  `project_outbox_cost_optimization.md`). The runbook turns the same number into a triage
  instruction: allow five minutes before concluding a manual outbox reset did not take
  (`OPERATIONS.md:94-97`).
- `Outbox__DeadLetterRetentionDays: '30'` on the four database-owning services (`main.bicep:1145`,
  `:1350`, `:1473`, `:1621`; Gateway and UI own no database and therefore no outbox). A
  dead-lettered row (retries exhausted, never delivered) keeps `ProcessedOn` null forever, so the
  processed-row sweep never reaches it and it stays in the pending index that every poll re-scans.
  `OutboxCleanupService` purges those rows on their own window, falling back to `RetentionDays`
  (default 7) when the key is `0`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCleanupService.cs:158-162`,
  `Settings/OutboxSettings.cs:65`, `:108`). Setting 30 in production deliberately keeps a failed
  payload longer than a delivered one: four weeks to diagnose or replay it by hand before the row
  is abandoned.
- `Scheduler__PollingIntervalSeconds: '300'` on Identity, Conference and Engagement only
  (`main.bicep:1154`, `:1354`, `:1477`), the same reasoning as the outbox interval applied to the
  scheduled-job runner: it smart-waits until the earliest due job, so the interval only bounds an
  idle sleep, and the 30-second default woke every runner twice a minute per database for nothing.
  Notification does not get the key because it runs no scheduler: `Scheduler:Enabled` is `true` in
  exactly the three services that do
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/appsettings.json:36-37`,
  `MMCA.ADC.Conference.Service/appsettings.json:33-34`,
  `MMCA.ADC.Engagement.Service/appsettings.json:54-55`), and the Notification service declares no
  `Scheduler` section at all. The template's own note says the same
  (`main.bicep:1150-1153`): the audit-trail cleanup job runs daily, which is what the interval
  paces.
- `ConnectionStrings__redis` from Key Vault on all four services (`main.bicep:1158`, `:1358`,
  `:1481`, `:1627`), which is the single key that turns on the distributed cache, cross-replica
  idempotency, and the SignalR backplane.
- `MessageBus__Provider: 'AzureServiceBus'` + `MessageBus__ConnectionString` from Key Vault,
  selects MassTransit's Azure Service Bus transport at startup (locally the AppHost injects
  `WithBroker(rabbit)` for RabbitMQ instead).
- `HealthProbe__Port`, a dedicated HTTP/1.1 listener that `Program.cs` adds when the key is set, and
  the target of all three probes on the four services (see below).

Three of the four services also carry
`Authentication__JwtBearer__RequireHttpsMetadata: 'false'` (`main.bicep:1364` Conference, `:1486`
Engagement, `:1632` Notification), and the template explains why in the comment directly above each
one (`main.bicep:1361-1363`, `:1483-1485`, `:1629-1631`). Their JWKS `Authority` is the ACA
**internal-ingress h2c URL** for Identity, `http://adc-prod-identity` (`:1360`, `:1482`, `:1628`):
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
and Engagement (`main.bicep:1096-1103`, `:1303-1310`, `:1437-1444`). These three
services run Kestrel in `Http2`-only on cleartext (h2c prior knowledge), which is required for
cross-service gRPC: Kestrel cannot negotiate HTTP/2 via ALPN without TLS, and internal ACA
service-to-service traffic does not pass through the TLS terminator. `allowInsecure: true` is
required here because h2c is technically cleartext HTTP/2, it is not "insecure" in the
architectural sense (traffic stays within the ACA virtual network) but the field name is misleading.
The operational consequence is in the runbook (`OPERATIONS.md:144-146`): probe these three with
`--http2-prior-knowledge`, because a default HTTP/1.1 `curl` reports a failure that is not there.

**HTTP/1.1 (`transport: 'http'`)**: used by Notification, Gateway, and UI. Notification runs
Kestrel in `Http1AndHttp2` because SignalR's WebSocket transport begins with an HTTP/1.1 Upgrade
handshake (`main.bicep:1567` comment). Gateway and UI use HTTP/1.1 because they are the external
entry points (`main.bicep:1733-1738`, `:1854-1862`; Blazor Server also uses WebSocket upgrade from
HTTP/1.1, `main.bicep:1908-1909` comment).

Notification carries a third shape on top: `additionalPortMappings` exposes an internal-only TCP
port 8081 (`main.bicep:1574-1580`) for the cleartext h2c gRPC ingress (`LiveChannelPush`). TCP
passthrough is what sidesteps the envoy HTTP/1.1-versus-HTTP/2 conflict, because the main ingress
must stay `http` for WebSockets while gRPC needs end-to-end HTTP/2 (the
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed-transport
profile).

#### Probes on a dedicated HTTP/1.1 listener

Kestrel in HTTP/2 prior-knowledge mode rejects the platform's HTTP/1.1 `httpGet` probe with
`GOAWAY HTTP_1_1_REQUIRED`, which would fail the liveness check and cause a reboot loop. Rather than
degrading the three h2c services to port-only `tcpSocket` probes, each service opens a
**dedicated HTTP/1.1 probe listener** that is not exposed via ingress: `HealthProbe__Port: '8081'`
on Identity, Conference and Engagement (`main.bicep:1138`, `:1345`, `:1468`) and `'8082'` on
Notification (`main.bicep:1614`, because 8080 and 8081 are already the ADR-012 pair). ACA probes may
target a port that ingress does not publish, so all six apps use `httpGet` probes and all six carry
the same three (`main.bicep:1253-1278` Identity, `:1387-1412` Conference, `:1514-1539` Engagement,
`:1669-1694` Notification, `:1788-1813` Gateway, `:1910-1935` UI):

| Probe | Path | Cadence | Semantics |
|---|---|---|---|
| `startup` | `/alive` | `initialDelaySeconds: 5`, `periodSeconds: 5`, `failureThreshold: 30` | up to 150s for a cold container to answer at all |
| `liveness` | `/alive` | `periodSeconds: 30`, `failureThreshold: 3` | self-only, so a SQL outage never restarts the container |
| `readiness` | `/health/ready` | `initialDelaySeconds: 3`, `periodSeconds: 30`, `failureThreshold: 3` | warmup gate plus the DB-aware `AddSqlServer` check |

The liveness/readiness split is the load-bearing part (`main.bicep:1240-1246`): `/alive` checks the
process only, so a database outage does not trigger a restart loop, while `/health/ready` fails when
a replica cannot reach its database, pulling it out of rotation instead of letting it serve 500s.
Readiness is also gated on `WarmupHostedService` completing (OIDC discovery fetched), so ACA holds
back user traffic until the replica is warm. Gateway and UI probe their own 8080 (`main.bicep:1788-1813`,
`:1910-1935`) because their Kestrel accepts HTTP/1.1 directly.

**Readiness runs every 30 seconds, not every 10, and that is a telemetry-cost decision**
(`main.bicep:1247-1252`). The DB-aware readiness check issues a SQL `SELECT 1` per probe, and
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
cause (`main.bicep:420`).

#### Service Discovery (`services__<name>__http__0`)

Aspire's service discovery convention uses env vars of the form `services__<service-name>__http__0`
to resolve service endpoints. In production these point at internal ACA hostnames:

- Gateway → all four services: `conference` (`main.bicep:1775`), `identity` (`:1776`),
  `engagement` (`:1777`), `notification` (`:1778`), each as `http://${<app>.name}`
- Conference → `services__engagement__http__0 = http://${prefix}-engagement` (`main.bicep:1369`)
  (using the literal `${prefix}-engagement` rather than `${engagementApp.name}` to avoid a
  Bicep symbolic cycle, Conference and Engagement both reference each other)
- Engagement → `services__conference__http__0 = http://${prefix}-conference` (`main.bicep:1491`)
- Notification → `services__identity__http__0 = http://${identityApp.name}` (`main.bicep:1636`),
  for the `IAttendeeQueryService` email-recipient lookup
- Identity → `services__engagement__http__0` (`main.bicep:1172`), for the PRIVACY.md data-subject
  export's Engagement section

Two edges use a **named** endpoint rather than the default `http` one, because they target
Notification's dedicated h2c gRPC port: `services__notification__grpc__0 = http://${prefix}-notification:8081`
from Identity (`main.bicep:1179`, the Notifications section of the same data-subject export) and
from Engagement (`main.bicep:1496`, the best-effort live-channel push). Both use the literal
`${prefix}-notification` name so deployment ordering stays unconstrained, since Notification itself
references `identityApp` for its JWKS authority.

The same service names work locally because the AppHost's `WithReference` injects them as
`services__engagement__http__0 = http://localhost:<assigned-port>`. The application code calls
`AddHttpForwarderWithServiceDiscovery()` or `AddTypedGrpcClient<T>(serviceName)` in both
environments and resolves the endpoint from that env var key.

#### Identity Service specifics (`main.bicep:1079-1284`)

Identity is the JWT issuer and JWKS endpoint. Its JWT configuration (`main.bicep:1160-1164`):

```bicep
{ name: 'Jwt__SigningAlgorithm',   value: 'RS256' }
{ name: 'Jwt__Issuer',            value: 'https://${prefix}-gateway.${...defaultDomain}' }
{ name: 'Jwt__Audience',          value: 'AtlDevConapi' }
{ name: 'Jwt__AccessTokenExpirationMinutes', value: '15' }
{ name: 'Jwt__RefreshTokenExpirationDays',   value: '7' }
```

`Jwt__SigningAlgorithm` is the literal `'RS256'`, not a ternary, because the RSA key parameters are
required and the HS256 fallback path no longer exists in this template (the comment at
`main.bicep:1159` says exactly that). The RSA private key from Key Vault signs tokens and the
public key is published at `/.well-known/jwks.json`, wired by five unconditional env entries:
`Jwt__RsaPrivateKeyPem`, `Jwt__RsaPublicKeyPem`, `Jwks__Enabled: 'true'`,
`Jwks__KeyId: 'mmca-adc-2026'` and `Jwks__RsaPublicKeyPem` (`main.bicep:1215-1219`). Other services
fetch the JWKS document
through the internal authority (`Authentication__JwtBearer__Authority = 'http://${identityApp.name}'`)
to validate tokens without a shared secret
([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)
"authentication dual-fetch"). The 15-minute access token lifetime limits the blast radius of a
leaked token.

Identity is also the app that carries the avatar-storage wiring (`main.bicep:1188-1189`):
`FileStorage__ServiceUri` and `FileStorage__ContainerName`, pointed at the storage account's blob
endpoint and the `avatars` container. `AZURE_CLIENT_ID` (`main.bicep:1195`) sits beside them and
pins the apps identity's client id so `DefaultAzureCredential` resolves the intended identity
explicitly rather than relying on discovery order. That pin started here for blob access, but it is
no longer avatar-specific: four other apps carry it for the Key Vault configuration source (see
the Key Vault section).

Identity is one of the two apps that persist the **DataProtection key ring**
(`main.bicep:1193-1194`): `DataProtection__BlobStorageUri` points at
`<blob endpoint>dataprotection-keys/keys.xml` in the private container described above, and
`DataProtection__ApplicationName: 'MMCA.ADC'` is the isolation name the ring is scoped by (the same
value on the UI, which is what makes the two apps share one ring rather than two). The comment
above them (`main.bicep:1190-1192`) states the failure mode: Identity does OAuth cookie
cryptography at `maxReplicas: 2` with no session affinity, so with the default per-replica
in-memory ring a login started on one replica fails on the other. `MMCA.Common`'s
`AddCommonDataProtection` reads both keys, and `DataProtection:BlobStorageUri` is the gate: absent,
the method does nothing and the host keeps the in-memory default, which is what local development
and the tests want
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:54-62`).

Identity is also the app that sends the account emails, so it receives the SMTP block
(`main.bicep:1204-1208`: `Smtp__Host`, `Smtp__Port`, `Smtp__Username`, `Smtp__EnableSsl: 'true'`,
`Smtp__From`) with the password arriving separately as a `secretRef` only when one is configured
(`main.bicep:1221`, gated on `hasSmtpPassword`). Sitting with them is
`PasswordReset__ResetUrl` (`main.bicep:1213`), the absolute URL of the UI reset page the
forgot-password email links to
([ADR-091](https://ivanball.github.io/docs/adr/091-cache-backed-password-reset.html)). It points at
the same UI origin `OAuth__UIBaseUrl` uses but is injected **unconditionally**, and the comment
above it says why (`main.bicep:1209-1212`): password recovery is a local-credential feature and has
to work whether or not an external OAuth provider is configured, so gating it behind `hasAnyOAuth`
would silently degrade the reset mail to a token-only message on any deployment without social
login.

Identity is the one app that can carry all three external OAuth providers, and each block is
all-or-nothing (`main.bicep:1222-1235`): GitHub and Google contribute a client id plus a
`secretRef`, while Apple contributes four entries (services id, team id, key id, and the `.p8`
private key as a `secretRef`). `OAuth__UIBaseUrl` follows at `:1237` under `hasAnyOAuth`, because
the post-login redirect target is provider-independent.

Identity is sized at 0.25 CPU / 0.5 Gi (`main.bicep:1124`). JWT operations are CPU-cheap once the
key is loaded; the bottleneck is typically network I/O to SQL.

#### Conference Service specifics (`main.bicep:1286-1418`)

Conference carries the heaviest surface of the four services: seventeen API controllers
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/`), an AI scoring path
(Anthropic API), and the role of read-heavy entry point for the event/session catalog. It ran at
0.5 CPU / 1 Gi until 2026-09-02 and now runs at 0.25 CPU / 0.5 Gi like every peer
(`main.bicep:1333`). The comment above that line is the model for how a right-sizing decision should
be recorded (`main.bicep:1326-1332`): CPU averaged 0.012 to 0.017 cores with p95 under 0.03 against
the half-core it held, and the working set ran 320 to 380 MB. It also names itself as **the app to
watch**, because a p95 working set of 376 MB is 73% of the new 512 MiB limit, and states the revert
as one line and one deploy. The second-order effect is called out too: a smaller CPU quota throttles
the startup spike, so cold start roughly doubles, which traffic never sees because ACA keeps the
previous revision serving until readiness goes green.

The Anthropic API key is injected only when `hasAnthropic = true` (`main.bicep:1312-1319`, `:1381`):

```bicep
secrets: union(
  [ ... sql, redis and service bus ... ],
  hasAnthropic ? [{ name: 'anthropic-api-key', keyVaultUrl: ..., identity: appsIdentity.id }] : []
)
```

This is the `union()` + conditional array pattern used throughout `main.bicep` to keep optional
secrets and env vars out of the resource definition when not configured, rather than passing empty
strings to the container.

#### Notification Service specifics (`main.bicep:1547-1710`)

Notification differs from the other three back-end services in four ways:

1. `transport: 'http'` instead of `'http2'`, SignalR WebSocket requires an HTTP/1.1 Upgrade
   handshake (`main.bicep:1567`), plus the extra internal-only h2c port 8081 for gRPC
   (`main.bicep:1574-1580`).
2. Its probe listener is on **8082** (`main.bicep:1614`), because the ADR-012 mixed profile already
   owns 8080 and 8081 and those two endpoints are load-bearing (`main.bicep:1609-1613`).
3. It is the only app that can receive the native-push env block, and only when the hub wiring is
   on (`main.bicep:1657-1661`).
4. It is the second app with an SMTP block (`main.bicep:1643-1647` plus the conditional
   `Smtp__Password` `secretRef` at `:1662` and its vault-backed secret entry at `:1590`), because
   the notification service is the one that fans a notification out to email as well as to the hub.

It runs no scheduler, so unlike the other three it gets no `Scheduler__PollingIntervalSeconds`.
Its readiness probe (`main.bicep:1685-1693`) is what holds ACA ingress until the
`WarmupHostedService` has fetched the JWKS document from Identity (`main.bicep:1664-1668`). Without
it, SignalR connections made during warmup would fail because the JWT validator is not yet
initialized. Its replica cap is no longer the outlier it once was: see the shared scale discussion
above.

#### Gateway specifics (`main.bicep:1712-1832`)

Gateway is the sole externally-reachable back-end entry point (`external: true`,
`allowInsecure: false`, `main.bicep:1733-1738`). It is a pure YARP reverse proxy: no DbContext, no
JWT issuing, no module. Its env configuration is service-discovery entries, CORS, and one optional
rate-limiter key:

```bicep
{ name: 'Cors__AllowedOrigins__0', value: 'https://${prefix}-ui.${...defaultDomain}' }
```

CORS is scoped to exactly the UI's FQDN (`main.bicep:1769`), not a wildcard. Gateway was right-sized
alongside Conference on 2026-09-02 and now runs at 0.25 CPU / 0.5 Gi (`main.bicep:1758`); its
comment records the easier half of that decision (`main.bicep:1751-1757`), a 190 to 235 MB working
set comfortably inside the new limit because pure YARP forwarding holds no DbContext. It uses the
readiness gate at `main.bicep:1805-1812` because its warmup involves establishing connections to all
back-end services. It is also the target of the availability web test described above, and the only
app with no `KeyVault__Uri`.

Its one conditional secret is the ADR-088 synthetic-traffic bypass. When
`hasSyntheticTrafficSecret` is true the app declares a `synthetic-traffic-secret` Key Vault
reference (`main.bicep:1742-1744`) and receives
`GatewayRateLimiting__SyntheticTrafficSecret` as a `secretRef` (`main.bicep:1784`). A request
presenting that value in the `X-Synthetic-Traffic-Key` header skips both chained edge limiters, so
the monthly k6 run measures backend capacity instead of the per-IP window. Absent, the bypass is
off and every request stays rate limited, which is the correct default for a public entry point.

The template also records the transport contract the Gateway holds up (`main.bicep:1770-1773`):
`ForwardHttp2` defaults to true in the gateway code and YARP uses `VersionPolicy=RequestVersionExact`,
so it sends the HTTP/2 preface to the three h2c-prior-knowledge backends whose ACA ingress is
`transport: http2`. That pairing is why the ingress choice on those three services and the forwarder
policy here cannot be changed independently.

#### UI specifics (`main.bicep:1834-1954`)

UI is the other externally-reachable app (`external: true`, `main.bicep:1855`), the one app with
`secrets: []` (`main.bicep:1864`) and sized at 0.25 CPU / 0.5 Gi (`main.bicep:1871`). Three
non-obvious configuration points:

**Sticky sessions** (`main.bicep:1859-1861`):
```bicep
stickySessions: { affinity: 'sticky' }
```
Blazor Server runs the component model as a stateful SignalR circuit on the server. If a request
from a browser is load-balanced to a different replica than the one holding the circuit, the
circuit drops. Sticky session affinity pins each browser session to one replica. The header comment
on the resource (`main.bicep:1837-1839`) states both Blazor Server requirements together: sticky
sessions and `minReplicas >= 1`.

**Dual API endpoints** (`main.bicep:1883`, `:1885`):
```bicep
{ name: 'Api__ApiEndpoint',     value: 'http://${gatewayApp.name}' }
{ name: 'Api__WasmApiEndpoint', value: 'https://${gatewayApp.properties.configuration.ingress.fqdn}' }
```
Server-side Blazor rendering uses the internal Gateway URL (skipping public DNS, TLS termination,
and the Envoy round-trip). WebAssembly code running in the browser must use the external FQDN,
it has no access to the internal ACA DNS. The UI serves the WASM endpoint URL via a `/client-config`
endpoint so the WASM app can discover the gateway without the URL being baked into the WASM build.

**Shared DataProtection key ring** (`main.bicep:1891-1892`): the UI carries the same
`DataProtection__BlobStorageUri` and `DataProtection__ApplicationName: 'MMCA.ADC'` pair as Identity,
pointed at the same `dataprotection-keys/keys.xml` blob. The reason is the one above with the
consequence reversed: sticky sessions pin a **circuit** to a replica, but the UI also mints the SSR
session cookie and antiforgery tokens, and those travel with the browser rather than with the
circuit, so at `maxReplicas: 2` a per-replica in-memory ring makes them undecryptable on the other
replica (`main.bicep:1886-1890`). `AZURE_CLIENT_ID` (`main.bicep:1893`) pins the identity that
`DefaultAzureCredential` uses for both the blob write and the vault read.

The UI receives only the OAuth **client ids** when a provider is configured, one per provider
including Apple (`main.bicep:1898-1906`); every client secret stays on Identity, which is the app
that completes the exchange.

### Outputs (`main.bicep:1956-1964`)

```bicep
output acrLoginServer     string = acr.properties.loginServer
output gatewayFqdn        string = gatewayApp.properties.configuration.ingress.fqdn
output uiFqdn             string = uiApp.properties.configuration.ingress.fqdn
output sqlServerFqdn      string = sqlServer.properties.fullyQualifiedDomainName
output serviceBusEndpoint string = serviceBus.properties.serviceBusEndpoint
output appInsightsName    string = appInsights.name
```

`gatewayFqdn` and `uiFqdn` are consumed by the Phase 5 gate (`deploy.yml:1509-1670`), which is
**two** gates in a deliberate order, and the comment above them explains why the order matters
(`deploy.yml:1510-1530`).

**5a, activation.** For every app, the newest revision (by `createdTime`) must report `healthState`
Healthy, `runningState` Running or RunningAtMaxScale, and `trafficWeight` 100
(`deploy.yml:1568-1573`), polled up to ten minutes per app (`deploy.yml:1575-1587`). This gate
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
| §11 Security | UAMI/OIDC model; Key Vault-backed secrets ([ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)) plus the `KeyVault__Uri` configuration source on five of six apps; `secrets: []` on the UI and a single conditional secret on the Gateway; `adminUserEnabled: false`; `@secure()` parameters; required RSA keys with no HS256 fallback; staged `useManagedIdentitySql`; private `dataprotection-keys` container for the shared key ring (at-rest key-vault encryption of that ring is an explicit not-yet-implemented follow-up); the scoped `RequireHttpsMetadata: false` on the three internal JWKS consumers; the secret-gated rate-limiter bypass ([ADR-088](https://ivanball.github.io/docs/adr/088-gateway-edge-responsibilities.html)); no static credentials |
| §13 Observability | Workspace-based App Insights; per-service `OTEL_SERVICE_NAME`; Application Map coverage; three SLO scheduled query rules + workbook ([ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html)); outbox dead-letter, SQL dependency and revision-activation alerts over the same workspace; the `hasAnthropic`-gated AI-scoring token-ceiling rule over `AppMetrics`; the 15-minute evaluation cadence and its stated detection-latency trade |
| §17 DevOps & Deployment | Two-phase Bicep split; Incremental mode (and the operator step a template deletion still needs); image sha-tagging + registry build cache; service-startup migration (sole migrator, minReplicas:1); the revision-activation gate followed by the smoke gate, then the post-deploy cache purge |
| §29 Resilience & Business Continuity | LTR on per-service databases; SLO alerts; sev-1 Gateway availability web test with a window that tracks its probe cadence; the `revision-activation-failed` alert for a rollout that silently never took traffic; guarded rollback in the smoke gate; `minReplicas: 1`; readiness probes with a self-only liveness split |
| §31 Cost Efficiency / FinOps | `commonTags` on every resource; monthly budget with 80%/100% thresholds; `cost-guard.yml` surge-drift gate against a uniform `maxReplicas` 2 baseline; workspace `dailyQuotaGb: 1`; 25% trace sampling; Warning OTel log floor; Basic-tier DB sizing plus the archived-and-dropped AtlDevCon database; 300s outbox and scheduler polls; the two disabled metric groups plus the 300s metric export interval; 30-second readiness probes; 15-minute SLO-rule and web-test cadences; the `aiScoringTokenCeiling` two-day Anthropic token alert; uniform 0.25 vCPU / 0.5 Gi container sizing; the daily two-step ACR purge task plus its post-deploy re-run |

---

## Not determinable from source

- The exact `AcrPull` and `Key Vault Secrets User` role-assignment commands used in the out-of-
  band bootstrap are referenced in comments (`main.bicep:972-976`, `main.bicep:990-993`) but the
  commands themselves live in `infra/DISASTER-RECOVERY.md`, which is private to the ADC repo and out
  of scope for this chapter. A distilled version is published in the framework's reference runbook,
  `MMCA.Common/samples/deployment/DEPLOYMENT.md`.
- Whether the Notification Hubs namespace, the `adc-push` hub and its `app-backend` rule actually
  exist in a given subscription is not visible here: the template only references them as
  `existing` (`main.bicep:820-835`), and the manual `az rest` provisioning lives in
  `Docs/MobileReleaseRunbook.md` section 5, which is private to the ADC repo. With
  `deployNotificationHub` defaulting to true, a deploy into an environment where they do not exist
  fails at the `listKeys()` call rather than skipping the wiring.
- Whether the `AtlDevCon` drop and the bacpac export actually completed in a given subscription is
  likewise outside the template: `main.bicep:701-713` records the intent and the restore path, and
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
- Whether the AI-scoring token-ceiling alert exists in a given environment is not determinable from
  the template either: it is declared `if (hasAnthropic)` (`main.bicep:475`), and `hasAnthropic`
  (`main.bicep:143`) is derived from the `ANTHROPIC_API_KEY` GitHub secret appended to the parameters
  file only when it is non-empty (`deploy.yml:1428-1430`). An environment without that secret
  deploys the scoring feature inert and the rule not at all.
- The `azure/arm-deploy@v2` action's `deploymentMode` is not set explicitly in `deploy.yml`
  (`deploy.yml:1115-1121` for foundation, `deploy.yml:1489-1495` for main), the action defaults to
  Incremental, but this is not stated in the workflow file; it is inferred from the Incremental intent
  documented in the `main.bicep` comments and the ADC CLAUDE.md.
