# Infrastructure as Code, ADC Azure Deployment

This chapter teaches the Azure Infrastructure-as-Code layer for the MMCA.ADC application: what
resources are provisioned, why they are shaped the way they are, how secrets reach running
containers without ever being stored in source control, and how the whole deployment model hangs
together as a repeatable, incremental, credential-free pipeline. By the end you will understand
every resource in the Azure resource group, the two-file Bicep split that separates long-lived
from short-lived infrastructure, the UAMI/OIDC credential model, the database-per-service wiring,
and the FinOps guardrails that protect against a runaway conference-day scale-up. The CI/CD
workflow that _invokes_ this Bicep, `deploy.yml`, is covered in the CI/CD chapter
(`devops-cicd.md`); cross-references below mark exactly where each phase of that workflow touches
these files.

---

## How the pieces fit together

Before diving into individual files, here is the end-to-end picture:

```
GitHub Actions (deploy.yml)
  │
  ├─ Phase 1 ─ azure/arm-deploy → infra/foundation.bicep
  │               (ACR + Log Analytics, long-lived, rarely changes)
  │               outputs: acrName, acrLoginServer, logAnalyticsName
  │
  ├─ Phase 2 ─ docker build & push (6 images, sha-tagged)
  │
  ├─ Phase 3 ─ azure/arm-deploy → infra/main.bicep   ← this chapter
  │               (everything else, App Insights, SQL, Service Bus,
  │                Container Apps, Key Vault secrets, alerts, budget)
  │               inputs: acrName + logAnalyticsName from Phase 1
  │               outputs: gatewayFqdn, uiFqdn, sqlServerFqdn, …
  │
  ├─ Phase 4 ─ (no migration step, each service self-applies its own
  │               migrations at startup as the SOLE migrator; minReplicas:1
  │               guarantees a single applier, see the CI/CD chapter)
  │
  └─ Phase 5 ─ smoke-test probe + rollback on failure
```

The **shared resource group** is `acc-rg` in the QiMata Sponsorship subscription (East US 2).
Both Bicep files target `resourceGroup` scope (`main.bicep:1`, `foundation.bicep:1`) and are
applied with **Incremental** deployment mode, Azure adds and updates declared resources but
never deletes absent ones, which is what keeps the legacy `AtlDevCon` archive database intact
after the per-service cutover.

[Rubric §17, DevOps & Deployment] assesses whether infrastructure is code-managed, idempotent,
and repeatable. The two-file split, Incremental mode, and the CI-driven invocation sequence in
`deploy.yml`'s `deploy` job (`deploy.yml:264–531`) embody all three: every production change flows through
the same Bicep pipeline, every re-run is safe, and nothing requires clicking in the Azure portal.

---

## `azure.yaml`, the azd project definition

**File:** `MMCA.ADC/azure.yaml`

`azure.yaml` is the Azure Developer CLI (`azd`) manifest for the project. It declares six
deployable services and points `azd` at the Bicep infrastructure directory.

### Services declared (`azure.yaml:4–46`)

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

The infrastructure stanza (`azure.yaml:47–49`) sets `provider: bicep` and `path: infra`, pointing
`azd` at the `infra/` directory where both `foundation.bicep` and `main.bicep` live. In practice
the CI pipeline invokes the Bicep files directly via `azure/arm-deploy`, not via `azd`, but the
`azure.yaml` manifest keeps the project `azd`-compatible for local developer use and future
tooling.

[Rubric §33, Developer Experience & Inner Loop] assesses how quickly a developer can go from
clone to running. `azure.yaml` lets a developer with the right Azure credentials run `azd up` to
provision and deploy the whole stack from a single command, matching the local Aspire experience
(`dotnet run --project Source/Hosting/MMCA.ADC.AppHost`).

---

## `infra/foundation.bicep`, long-lived shared infrastructure

**File:** `MMCA.ADC/infra/foundation.bicep`

Foundation is deployed first (CI/CD chapter: `deploy.yml:265–271`) on every run. It provisions
exactly two resources: the Azure Container Registry and the Log Analytics workspace. These are the
two resources that _everything else_ depends on but that almost never change: the registry stores
images that live across many deploys, and the workspace accumulates days of telemetry that must
persist across re-runs of `main.bicep`.

### Parameters (`foundation.bicep:1–13`)

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `environmentName` | `string` | required | Suffix for resource names (`adc-${environmentName}-…`) |
| `location` | `string` | RG location | Primary Azure region |

The `resourceToken` variable (`foundation.bicep:12`) is a stable hash derived from
`uniqueString(resourceGroup().id, environmentName)`. All generated resource names incorporate it,
ensuring uniqueness within the subscription while remaining deterministic across re-runs.

### Log Analytics Workspace (`foundation.bicep:28–38`)

```
name: '${prefix}-logs-${resourceToken}'
sku:  PerGB2018
retentionInDays: 30
```

PerGB2018 is the pay-as-you-go tier. The 30-day minimum is Azure's floor for this SKU, shorter
retention is rejected (and the memory note `reference_log_analytics_sku_limits.md` records this
hard constraint). All six container apps ship their logs here via the Container Apps environment's
`appLogsConfiguration` (`main.bicep:464–471`), and `main.bicep`'s Application Insights component
uses it as its workspace backing store, meaning traces and metrics land in the same workspace.

[Rubric §13, Observability & Operability] assesses whether the system exposes structured logs,
distributed traces, and metrics in a queryable store. The single workspace is the convergence
point: container-app stdout/stderr, ASP.NET Core structured logs, and OpenTelemetry traces all
land in the same Log Analytics table set, queryable with Kusto.

### Azure Container Registry (`foundation.bicep:43–55`)

```
sku: Basic
adminUserEnabled: false   // #11/#17, managed-identity pull only
```

The `adminUserEnabled: false` setting (`foundation.bicep:53`) is the central credential-hardening
decision for image pull. Without it, every container app would need a stored registry admin
password. With it disabled, images are pulled exclusively via the shared UAMI's `AcrPull` role
assignment (bootstrapped out-of-band, see the UAMI section below). The deploy push likewise uses
the GitHub deploy identity's `AcrPush` role, not the admin credential.

[Rubric §11, Security] assesses elimination of long-lived credentials. Disabling the admin user
removes the one static credential that would otherwise be needed for every pull, a concrete,
verifiable hardening choice recorded directly in the Bicep.

### Outputs (`foundation.bicep:60–62`)

`acrName`, `acrLoginServer`, and `logAnalyticsName` are the three values threaded from Phase 1
into Phase 2 (docker push target) and then into Phase 3 (`main.bicep` parameters). See
`deploy.yml:275` (`az acr login --name ${{ steps.foundation.outputs.acrName }}`) and
`deploy.yml:364–365` (the `acrName`/`logAnalyticsName` parameter assembly).

---

## Deployment parameters, assembled at deploy time, not committed

There is **no `infra/main.parameters.json` file** in the repository, the `infra/` directory holds only
`foundation.bicep`, `main.bicep`, `DISASTER-RECOVERY.md`, `POST-CUTOVER-atldevcon-downgrade.md`, and a
`workbooks/` folder. The parameters fed to `main.bicep` are built **from scratch at deploy time** by
`deploy.yml`'s "Build deployment parameters file" step (`deploy.yml:334–447`), which writes
`/tmp/deploy-params.json` with `jq`.

How it works:

- A base `jq -n` invocation (`deploy.yml:361–389`) emits the always-present parameters, `environmentName`,
  `sqlLocation`, `acrName`, `logAnalyticsName`, `sqlAdminPassword`, and the six `*Image` URLs, into the
  ARM `deploymentParameters` JSON shape. `acrName` and `logAnalyticsName` are the Phase 1 foundation
  outputs; the image URLs are the `sha`-tagged ACR references; `sqlAdminPassword` comes from the
  `SQL_ADMIN_PASSWORD` GitHub secret.
- Optional parameters (RSA key pair, HS256 fallback key, GitHub OAuth, Anthropic key, SMTP settings, alert
  email) are conditionally appended with further `jq --arg` calls (`deploy.yml:391–447`) **only when their
  env var is non-empty**. `jq --arg` JSON-escapes multi-line values correctly, critical for the PEM keys,
  which contain newlines. Anything not appended falls back to the `@secure()` parameter's empty-string
  default in `main.bicep`, which the template's feature flags (`useRs256`, `hasAnthropic`, …) read to
  disable the corresponding feature.

[Rubric §11, Security] is directly served: there is no checked-in parameters file to leak secrets from at
all; the actual secret values flow from GitHub Actions secrets (encrypted at rest, masked in logs, visible
only to the `production` deploy environment) into the ephemeral `jq`-assembled `/tmp/deploy-params.json`
that exists only for the duration of the workflow run.

---

## `infra/main.bicep`, the full application infrastructure

**File:** `MMCA.ADC/infra/main.bicep`

`main.bicep` declares every application-layer Azure resource: Application Insights, SLO metric
alerts, a saved SLO workbook (`main.bicep:263–275`), the monthly cost budget, SQL Server with five
databases (the `AtlDevCon` archive plus the four per-service databases), Service Bus, the Container Apps
environment, Key Vault secrets, and all six container apps. All resources receive the same tag set
(`main.bicep:108–114`) so Azure Cost Analysis can attribute spend by application and environment.

### Parameters (`main.bicep:1–97`)

Parameters divide into three categories:

**Infrastructure coordinates** (supplied from Phase 1 foundation outputs):
- `acrName`, `logAnalyticsName`, links back to foundation resources.
- `environmentName`, `location`, `sqlLocation`, `sqlLocation` is separate because the QiMata
  Sponsorship subscription blocks `Microsoft.Sql` in East US 2 (the RG location) but permits it in
  West US 2 (`main.bicep:12–14`). Container Apps stay in the RG region; only SQL lands in West US 2.

**Secure parameters** (marked `@secure()`, ARM masks them in deployment logs and does not store
them in deployment history):
- `sqlAdminPassword` (`main.bicep:27`), SQL Server admin password.
- `jwtSecretKey` (`main.bicep:31`), HS256 fallback key (used when RSA keys are absent).
- `rsaPrivateKeyPem`, `rsaPublicKeyPem` (`main.bicep:35,39`), PEM-encoded RSA key pair for RS256
  JWT signing and JWKS publishing.
- `githubOAuthClientSecret` (`main.bicep:46`), `anthropicApiKey` (`main.bicep:50`),
  `smtpPassword` (`main.bicep:63`), optional integration secrets.

**Image tags** (one per deployable, passed as `sha`-tagged ACR URLs, e.g.
`acrLoginServer/mmca-adc-gateway:<commit-sha>`):
- `gatewayImage`, `uiImage`, `conferenceImage`, `identityImage`, `engagementImage`,
  `notificationImage` (`main.bicep:68–84`).

**FinOps controls**:
- `enableBudget` (`main.bicep:90`), `monthlyBudgetAmount` (`main.bicep:93`),
  `budgetStartDate` (`main.bicep:96`), govern the cost budget resource (see below).
- `alertEmailAddress` (`main.bicep:87`), if non-empty, adds an email receiver to both the SLO
  action group and the budget notifications.

### Computed variables (`main.bicep:98–128`)

Three boolean flags gate optional blocks throughout the template:
- `useRs256 = !empty(rsaPrivateKeyPem) && !empty(rsaPublicKeyPem)` (`main.bicep:101`), flips JWT
  signing from HS256 to RS256 and enables the JWKS endpoint on Identity when both RSA keys are set.
- `hasAnthropic` (`main.bicep:102`), gates the Anthropic API key secret on Conference.
- `hasSmtpPassword`, `hasGitHubOAuth` (`main.bicep:103–104`), gate SMTP/OAuth secrets.

Per-service SQL connection strings (`main.bicep:119–123`) are computed from the SQL server FQDN
and admin credentials. Each is a distinct string pointing at its own database
(`ADC_Identity`, `ADC_Conference`, `ADC_Engagement`, `ADC_Notification`), making the
database-per-service boundary explicit in the Bicep output that goes into Key Vault.

The Service Bus connection string (`main.bicep:128`) is resolved via `listKeys()` against the
`app-clients` SAS authorization rule (not `RootManageSharedAccessKey`) so a future migration to
managed identity can revoke only the app rule without touching the namespace root.

### Application Insights (`main.bicep:149–159`)

A workspace-based App Insights component backed by the foundation Log Analytics workspace:

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
Every container app receives `APPLICATIONINSIGHTS_CONNECTION_STRING` (`main.bicep:164–167`) and a
per-service `OTEL_SERVICE_NAME` (e.g. `'identity'`, `'conference'`). The `OTEL_SERVICE_NAME` env
var is what Azure Monitor maps to the Cloud Role Name, without it, all services appear as
`"unknown_service"` in the Application Map.

`MMCA.Common.Aspire`'s `AddOpenTelemetryExporters` calls `UseAzureMonitor()` whenever
`APPLICATIONINSIGHTS_CONNECTION_STRING` is present (`main.bicep:147` comment), so the Common
framework automatically routes OpenTelemetry spans, logs, and metrics to Azure Monitor in
production with no service-level code change.

[Rubric §13, Observability & Operability] assesses whether the system ships distributed traces,
structured logs, and metrics to a queryable backend. The workspace-based App Insights with
per-service Cloud Role Names gives full Application Map visibility, end-to-end distributed traces
across all six services, and Kusto-queryable logs, covering this category end-to-end.

### SLO metric alerts (`main.bicep:171–253`)

Three metric alert rules are defined via a Bicep `for` loop over `sloAlertSpecs` (`main.bicep:193–218`):

| Alert key | Metric | Threshold | Window | Severity |
|---|---|---|---|---|
| `failed-requests` | `requests/failed` | > 10 (count) | 15 min | 2 (Error) |
| `server-response-time` | `requests/duration` | > 3000ms (avg) | 15 min | 3 (Warning) |
| `dependency-failures` | `dependencies/failed` | > 10 (count) | 15 min | 2 (Error) |

Thresholds are calibrated to the actual 2026 conference-day load (~76 accounts, ~67 peak
concurrent) rather than conservative enterprise defaults, a 10-failure threshold flags a real
degradation without crying wolf on normal spikes. `evaluationFrequency: 'PT5M'` (`main.bicep:229`)
means each rule re-evaluates every five minutes against its 15-minute rolling window.

The action group (`main.bicep:175–189`) is created regardless of whether `alertEmailAddress` is
set. The SLO rules always exist and are always visible/queryable in Azure Monitor; the email
receiver is conditionally appended (`main.bicep:181–185`) so the alert infrastructure is
operational even without a configured notification channel. `autoMitigate: true` (`main.bicep:231`)
means ARM auto-resolves the alert when the metric returns below threshold, preventing stale
open-alert noise.

[Rubric §29, Resilience, Reliability & Business Continuity] assesses whether the system can
detect degradation automatically and notify operators. These SLO alerts, scoped to the App
Insights component and wired to the same action group as the cost budget, give the on-call
operator an automated signal for the three most meaningful failure modes: error rate, latency, and
dependency failures.

### Cost budget (`main.bicep:284–312`)

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
address and the SLO action group. The primary guard this budget provides is against an un-reverted
conference-day surge: a manual SQL tier scale-up (from Basic to S4) left running for weeks would
push the monthly bill well past $200 and trigger both alert thresholds long before the billing
cycle closes.

`enableBudget: bool` (`main.bicep:90`) allows disabling the resource when the deploy identity
lacks `Microsoft.Consumption/budgets/write` (as is the case in some sponsor subscriptions).
`budgetStartDate` (`main.bicep:96`) is pinned at creation and must not change on an existing
budget, ARM rejects start-date changes on update. The comment in `main.bicep:95–96` records this
constraint directly so future operators don't hit the ARM error.

[Rubric §31, Cost Efficiency / FinOps] assesses whether infrastructure cost is actively
monitored, bounded, and governed. The budget resource, the `enableBudget` escape hatch, and the
`commonTags` applied to every billable resource (`main.bicep:108–114`) together satisfy this
category: tags enable cost attribution; the budget caps runaway spend; and the budget threshold
notifications make the cap actionable.

### SQL Server and databases (`main.bicep:317–410`)

**SQL Server** (`main.bicep:317–328`):
```
name: '${prefix}-sql-${resourceToken}'
version: '12.0'
minimalTlsVersion: '1.2'
publicNetworkAccess: 'Enabled'
```

`publicNetworkAccess: 'Enabled'` (`main.bicep:326`) combined with the firewall rule
`AllowAzureServices` (`main.bicep:330–337`, startIpAddress/endIpAddress both `0.0.0.0`) is the
Azure-standard pattern for allowing Container Apps to reach SQL without a VNet/private endpoint.
The `0.0.0.0–0.0.0.0` rule does not allow traffic from arbitrary internet IPs; it enables the
special "allow Azure services" flag. `minimalTlsVersion: '1.2'` (`main.bicep:325`) ensures all
connections are encrypted at TLS 1.2 minimum.

**Legacy `AtlDevCon` database** (`main.bicep:345–359`):
Retained at Basic tier (5 DTU, 2 GB cap) as a read-only archive and rollback source after the
database-per-service cutover. Its Bicep resource declaration (`main.bicep:345`) prevents out-of-
band drift, even though Incremental mode would not delete it anyway, having it declared makes the
"never touch this" intent explicit and prevents ARM complaining about an undeclared resource.
The comment at `main.bicep:339–344` is the canonical explanation: the data was fully copied into
the per-service databases; this is the archive, not the live store.

**Per-service databases** (`main.bicep:377–393`), `[Rubric §8, Data Architecture]`:

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

[Rubric §8, Data Architecture] assesses deliberate persistence strategy including transactions,
isolation, migrations, and bounded ownership. The four separate databases implement [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html): each
service owns exactly its data; no cross-database foreign keys exist; each service's outbox
(`OutboxMessages` table) lives in its own database so the outbox processor never races for another
service's rows. See [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to) and
`ADRs/006-database-per-service.md` for the full rationale.

[Rubric §7, Microservices Readiness] assesses whether the service boundary includes data
autonomy, not just code autonomy. These four Basic-tier databases on one SQL server are the
cheapest expression of full data autonomy: each service has an independent schema, independent
migrations, independent outbox, and can be moved to its own server later without application
changes.

**Long-term backup retention (LTR)** (`main.bicep:399–410`):

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
adds weekly (4-week), monthly (12-month), and yearly (1-year) archival on top. The practical
value: a corrupted migration or a data-loss bug discovered three weeks after the fact is still
recoverable. The `AtlDevCon` archive is intentionally excluded from LTR, it is a static archive,
not a live store.

[Rubric §29, Resilience, Reliability & Business Continuity] extends to data recovery. LTR on
the live per-service databases means every production restore scenario, bad migration, silent
corruption, regulatory request for historical data, has a recovery path beyond the 7-day PITR
window. The disaster-recovery runbook at `MMCA.ADC/infra/DISASTER-RECOVERY.md` documents the
drilled restore procedure ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)).

### Azure Service Bus (`main.bicep:425–454`)

```
sku: Standard   // Basic rejected: MassTransit requires topics, Basic supports queues only
minimumTlsVersion: '1.2'
```

The Standard tier comment at `main.bicep:420–424` is the explanation of a constraint that has
bitten the project before (it was absent in early production and is now documented in the memory
note `project_adc_no_broker_in_azure.md`): MassTransit's `UsingAzureServiceBus` auto-provisions
one topic per message type and one subscription per consumer, Basic tier has no topics, only
queues, so it silently fails at MassTransit startup. Standard tier adds an ~$10/month flat cost
for the namespace regardless of message volume.

The `app-clients` authorization rule (`main.bicep:444–454`) grants `Send + Listen + Manage` rights.
The `Manage` right is required so MassTransit can `ConfigureEndpoints`, auto-provision topics
and subscriptions at startup. The alternative (declaring every topic in Bicep) would be brittle
as new integration events are added, because it would require a Bicep change for every new event
type.

Current integration event flows wired over Service Bus (documented at `main.bicep:415–418`):
- Identity publishes `UserRegistered` → Conference `UserRegisteredHandler` auto-links a speaker
  by email match (BR-207).
- Conference publishes `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser` → Identity updates
  `User.LinkedSpeakerId` (BR-209/BR-70).

These events cross service boundaries asynchronously via the outbox + MassTransit; the Service Bus
namespace is the transport that carries them in production (RabbitMQ fills the same role locally).

### Container Apps environment (`main.bicep:459–472`)

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
network, the same Log Analytics sink for container-level logs (stdout/stderr), and the same
internal DNS resolution. An app can reach another by its Container App name (e.g.
`http://adc-prod-identity`) because the ACA environment's internal DNS resolves Container App
names as hostnames within the environment.

### UAMI and ACR credential model (`main.bicep:474–487`)

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
template only *references* it (`existing` keyword), not creates it, because the deploy identity
(also a UAMI, used by GitHub Actions via OIDC) has `Contributor` but not `Microsoft.Authorization/
roleAssignments/write`, creating role assignments requires elevated permissions deliberately
withheld from the CI identity.

Every container app resource declares the same identity:

```bicep
identity: {
  type: 'UserAssigned'
  userAssignedIdentities: { '${appsIdentity.id}': {} }
}
```

This makes the UAMI the app's runtime identity. At startup, when Kestrel calls
`AddAzureKeyVault(...)`, it authenticates via the UAMI, no connection strings, no certificates,
no long-lived secrets in the container environment. Image pull from ACR works the same way: the
ACA environment presents the UAMI's credentials to ACR when pulling, replacing what would
otherwise be an admin-user password stored in a Container App secret.

The GitHub Actions deploy identity authenticates to Azure via **OIDC** (`deploy.yml:257–262`):
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

### Key Vault and runtime secrets (`main.bicep:489–554`)

```bicep
resource keyVault '…/vaults@…' existing = {
  name: 'adckv${resourceToken}'
}
```

Key Vault is also bootstrapped out-of-band. The Bicep `deploy` creates or updates eleven secret
resources (`main.bicep:500–554`), writing the parameter values into the vault. Each Container App
then references secrets by Key Vault URI via the shared UAMI:

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
deployment logs. At runtime ACA fetches the current secret version via the UAMI's Key Vault
Secrets User role, meaning a secret rotation only requires updating the Key Vault secret, no
Bicep re-deployment, no app restart.

Secrets stored in Key Vault (`main.bicep:500–554`):
- Per-service SQL connection strings (4): `identity-sql-connection-string`,
  `conference-sql-connection-string`, `engagement-sql-connection-string`,
  `notification-sql-connection-string`
- `service-bus-connection-string`
- `rsa-private-key-pem`, `rsa-public-key-pem` (or `'unused'` placeholder when not supplied)
- `jwt-secret-key` (HS256 fallback, or `'unused'`)
- `smtp-password`, `github-oauth-client-secret`, `anthropic-api-key`

All `@secure()` parameters that arrive as `''` (empty) are stored as `'unused'` rather than empty
string, because Key Vault rejects empty-string secret values. The application code never reads a
`'unused'` value, the `useRs256`, `hasGitHubOAuth`, etc. flags in the template control which env
vars are injected into each container, so the `'unused'` placeholder is never reachable by running
code.

### Container Apps, the six deployables

Six `Microsoft.App/containerApps` resources are declared in `main.bicep`. They share structural
patterns but differ in ingress transport, probe style, and environment variables.

#### Common structural patterns

All six apps (`main.bicep:559–1177`) share:

- `activeRevisionsMode: 'Single'`, one active revision at a time; new deploys create a new
  revision and traffic flips atomically rather than gradually. This matches `deploy.yml`'s post-
  deploy smoke-test gate, which checks the new revision before marking the deploy green.
- `scale: { minReplicas: 1, maxReplicas: 2, rules: [{ http: { concurrentRequests: '50' } }] }`,
  `minReplicas: 1` prevents scale-to-zero (which would destroy Blazor Server circuits and outbox
  in-flight messages); HTTP scale-out at 50 concurrent requests gives the headroom needed for a
  conference-day load (historically ~67 peak concurrent).
- `ASPNETCORE_ENVIRONMENT: 'Production'`, switches ASP.NET Core to the production configuration,
  which among other things disables the OpenAPI endpoint (it is only mapped outside Production per
  the ADC CLAUDE.md).
- `ApplicationSettings__DatabaseInitStrategy: 'Migrate'`, each service auto-applies its own
  database's pending migrations at startup as the **sole migrator**. `deploy.yml` deliberately has *no*
  separate `sqlcmd` migration step (a backstop would race the container's startup `Migrate()`); with
  `minReplicas: 1` exactly one replica migrates before the revision serves. The build-time EF
  model-drift gate (`deploy.yml:70–83`) still guarantees a migration exists for every model change.
- `Outbox__PollingIntervalSeconds: '300'`, the outbox signal + smart wait in MMCA.Common ≥ 1.50.0
  delivers real messages in ~5 seconds regardless of the poll interval; the 300-second poll only
  governs idle polling. This cuts App Insights SQL dependency telemetry that would otherwise flood
  the workspace around the clock (the `OutboxPollFilterProcessor` suppresses the poll spans from
  App Insights per the memory note `project_outbox_cost_optimization.md`).
- `MessageBus__Provider: 'AzureServiceBus'` + `MessageBus__ConnectionString` from Key Vault,
  selects MassTransit's Azure Service Bus transport at startup (locally the AppHost injects
  `WithBroker(rabbit)` for RabbitMQ instead).

[Rubric §17, DevOps & Deployment] specifically calls out environment parity. The same six
services that run under Aspire locally also run as Container Apps in production, with the
transport switch (`RabbitMQ → AzureServiceBus`), the SQL location switch (`localhost SQL container
→ Azure SQL`), and the secret management switch (`environment variable → Key Vault URI`) all being
configuration differences, not code differences. Application code is identical in both environments.

#### Ingress transport choices

Two distinct transport configurations appear across the six apps:

**HTTP/2 cleartext (`transport: 'http2'`, `allowInsecure: true`)**: used by Identity, Conference,
and Engagement (`main.bicep:573–580`, `main.bicep:704–711`, `main.bicep:798–805`). These three
services run Kestrel in `Http2`-only on cleartext (h2c prior knowledge), which is required for
cross-service gRPC: Kestrel cannot negotiate HTTP/2 via ALPN without TLS, and internal ACA
service-to-service traffic does not pass through the TLS terminator. `allowInsecure: true` is
required here because h2c is technically cleartext HTTP/2, it is not "insecure" in the
architectural sense (traffic stays within the ACA virtual network) but the field name is misleading.

**HTTP/1.1 (`transport: 'http'`)**: used by Notification, Gateway, and UI. Notification runs
Kestrel in `Http1AndHttp2` because SignalR's WebSocket transport begins with an HTTP/1.1 Upgrade
handshake (`main.bicep:890` comment). Gateway and UI use HTTP/1.1 because they are the external
entry points (Blazor Server also uses WebSocket upgrade from HTTP/1.1, `main.bicep:1131` comment).

A critical consequence: TCP probes must be used for the HTTP/2-only services. Kestrel in HTTP/2
prior-knowledge mode rejects the kubelet's HTTP/1.1 `httpGet` probe with `GOAWAY
HTTP_1_1_REQUIRED`, which would crash the liveness check and cause a reboot loop. Identity,
Conference, and Engagement therefore use `tcpSocket` probes, these just verify the port is bound,
providing a sufficient liveness signal (`main.bicep:663–679`).

Notification, Gateway, and UI use `httpGet` probes because their Kestrel accepts HTTP/1.1. Gateway
and UI additionally have a `readiness` probe at `/health/ready` (`main.bicep:1050–1057`), which is
gated on the `WarmupHostedService` completing (OIDC discovery fetched), so ACA ingress holds back
user traffic until the replica is warm. (Notification also has a `/health/ready` readiness probe at
`main.bicep:963–972`.)

#### Service Discovery (`services__<name>__http__0`)

Aspire's service discovery convention uses env vars of the form `services__<service-name>__http__0`
to resolve service endpoints. In production these point at internal ACA hostnames:

- Gateway → `services__conference__http__0 = http://${conferenceApp.name}` (`main.bicep:1026`)
- Gateway → `services__identity__http__0 = http://${identityApp.name}` (`main.bicep:1027`)
- Conference → `services__engagement__http__0 = http://${prefix}-engagement` (`main.bicep:746`)
  (using the literal `${prefix}-engagement` rather than `${engagementApp.name}` to avoid a
  Bicep symbolic cycle, Conference and Engagement both reference each other)
- Engagement → `services__conference__http__0 = http://${prefix}-conference` (`main.bicep:835`)
- Notification → `services__identity__http__0 = http://${identityApp.name}` (`main.bicep:928`)

The same service names work locally because the AppHost's `WithReference` injects them as
`services__engagement__http__0 = http://localhost:<assigned-port>`. The application code calls
`AddHttpForwarderWithServiceDiscovery()` or `AddTypedGrpcClient<T>(serviceName)` in both
environments and resolves the endpoint from that env var key.

#### Identity Service specifics (`main.bicep:559–685`)

Identity is the JWT issuer and JWKS endpoint. Its JWT configuration:

```bicep
{ name: 'Jwt__SigningAlgorithm',   value: useRs256 ? 'RS256' : 'HS256' }
{ name: 'Jwt__Issuer',            value: 'https://${prefix}-gateway.${...defaultDomain}' }
{ name: 'Jwt__AccessTokenExpirationMinutes', value: '15' }
{ name: 'Jwt__RefreshTokenExpirationDays',   value: '7' }
```

When `useRs256 = true`, the RSA private key (from Key Vault) signs tokens and the public key is
published at `/.well-known/jwks.json`. Other services fetch this document through the Gateway
(`Authentication__JwtBearer__Authority = 'http://${identityApp.name}'`) to validate tokens without
a shared secret ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) "authentication dual-fetch"). The 15-minute access token lifetime limits
the blast radius of a leaked token.

Identity is sized at 0.25 CPU / 0.5 Gi, the smallest Container Apps allocation. JWT operations
are CPU-cheap once the key is loaded; the bottleneck is typically network I/O to SQL.

#### Conference Service specifics (`main.bicep:690–779`)

Conference is the largest service (0.5 CPU / 1 Gi, `main.bicep:726`), reflecting its 14 REST
controllers, its AI scoring path (Anthropic API), and its role as the read-heavy entry point for
the event/session catalog. The Anthropic API key is injected only when `hasAnthropic = true`:

```bicep
secrets: union(
  [ ... sql and service bus ... ],
  hasAnthropic ? [{ name: 'anthropic-api-key', keyVaultUrl: ..., identity: appsIdentity.id }] : []
)
```

This is the `union()` + conditional array pattern used throughout `main.bicep` to keep optional
secrets and env vars out of the resource definition when not configured, rather than passing empty
strings to the container.

#### Notification Service specifics (`main.bicep:873–978`)

Notification differs from the other three back-end services in two important ways:

1. `transport: 'http'` instead of `'http2'`, SignalR WebSocket requires an HTTP/1.1 Upgrade
   handshake (`main.bicep:890`).
2. It has a `readiness` probe (`main.bicep:963–972`) in addition to startup and liveness:
   ```bicep
   { type: 'readiness', httpGet: { path: '/health/ready', port: 8080, scheme: 'HTTP' } }
   ```
   ACA ingress holds traffic until `GET /health/ready` returns 200, which happens only after the
   WarmupHostedService has fetched the JWKS document from Identity. Without this, SignalR
   connections made during warmup would fail because the JWT validator is not yet initialized.

#### Gateway specifics (`main.bicep:987–1077`)

Gateway is the sole externally-reachable back-end entry point (`external: true`,
`allowInsecure: false`, `main.bicep:1001–1006`). It is a pure YARP reverse proxy: no DbContext, no
JWT issuing, no module. Its env configuration is entirely service-discovery entries and CORS:

```bicep
{ name: 'Cors__AllowedOrigins__0', value: 'https://${prefix}-ui.${...defaultDomain}' }
```

CORS is scoped to exactly the UI's FQDN, not a wildcard. Gateway uses HTTP probes with a
readiness gate (`main.bicep:1050–1057`) because its warmup involves establishing connections to
all back-end services.

#### UI specifics (`main.bicep:1085–1177`)

UI is the other externally-reachable app (`external: true`). Two non-obvious configuration points:

**Sticky sessions** (`main.bicep:1104–1106`):
```bicep
stickySessions: { affinity: 'sticky' }
```
Blazor Server runs the component model as a stateful SignalR circuit on the server. If a request
from a browser is load-balanced to a different replica than the one holding the circuit, the
circuit drops. Sticky session affinity pins each browser session to one replica.

**Dual API endpoints** (`main.bicep:1123–1125`):
```bicep
{ name: 'Api__ApiEndpoint',     value: 'http://${gatewayApp.name}' }
{ name: 'Api__WasmApiEndpoint', value: 'https://${gatewayApp.properties.configuration.ingress.fqdn}' }
```
Server-side Blazor rendering uses the internal Gateway URL (skipping public DNS, TLS termination,
and the Envoy round-trip). WebAssembly code running in the browser must use the external FQDN,
it has no access to the internal ACA DNS. The UI serves the WASM endpoint URL via a `/client-config`
endpoint so the WASM app can discover the gateway without the URL being baked into the WASM build.

### Outputs (`main.bicep:1182–1188`)

```bicep
output acrLoginServer     string = acr.properties.loginServer
output gatewayFqdn        string = gatewayApp.properties.configuration.ingress.fqdn
output uiFqdn             string = uiApp.properties.configuration.ingress.fqdn
output sqlServerFqdn      string = sqlServer.properties.fullyQualifiedDomainName
output serviceBusEndpoint string = serviceBus.properties.serviceBusEndpoint
output appInsightsName    string = appInsights.name
```

`gatewayFqdn` and `uiFqdn` are consumed by the smoke-test step (`deploy.yml:475–531`) to probe
the deployed revision. `sqlServerFqdn` is an output of `main.bicep` (each service connects to its own
database via the per-service connection strings written into Key Vault; `deploy.yml` itself no longer runs
`sqlcmd` against the server, migrations are applied by the services at startup). The `cutover-per-service-dbs.yml`
workflow discovers the SQL FQDN independently for the one-time data migration.

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
`JWT_RSA_*`, etc.) flow from GitHub Actions encrypted secrets into Key Vault during deployment and
from Key Vault into containers at runtime, never touching disk or appearing in logs.

---

## Rubric category cross-reference

| Rubric category | Where it appears in these files |
|---|---|
| §7 Microservices Readiness | Per-service databases ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)); service-discovery env vars; gRPC transport selection |
| §8 Data Architecture | Four per-service databases; LTR policies; AtlDevCon archive retention; EF model-drift gate in deploy.yml (migrations applied by services at startup) |
| §11 Security | UAMI/OIDC model; Key Vault-backed secrets; `adminUserEnabled: false`; `@secure()` parameters; no static credentials |
| §13 Observability | Workspace-based App Insights; per-service `OTEL_SERVICE_NAME`; Application Map coverage; SLO alert rules |
| §17 DevOps & Deployment | Two-phase Bicep split; Incremental mode; image sha-tagging; service-startup migration (sole migrator, minReplicas:1); smoke-test gate |
| §29 Resilience & Business Continuity | LTR on per-service databases; SLO alerts; smoke-test rollback; `minReplicas: 1`; readiness probes |
| §31 Cost Efficiency / FinOps | `commonTags` on every resource; monthly budget with 80%/100% thresholds; Basic-tier DB sizing; 300s outbox poll |

---

## Not determinable from source

- The exact `AcrPull` and `Key Vault Secrets User` role-assignment commands used in the out-of-
  band bootstrap are referenced in comments (`main.bicep:474–478`, `main.bicep:489–495`) but the
  commands themselves live in `infra/DISASTER-RECOVERY.md`, which was not in scope for this chapter.
- The `azure/arm-deploy@v2` action's `deploymentMode` is not set explicitly in `deploy.yml`
  (`deploy.yml:265–271` for foundation, `deploy.yml:449–455` for main), the action defaults to
  Incremental, but this is not stated in the workflow file; it is inferred from the Incremental intent
  documented in the `main.bicep` comments and the ADC CLAUDE.md.
