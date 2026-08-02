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
  │               (ACR + Log Analytics, long-lived, rarely changes)
  │               outputs: acrName, acrLoginServer, logAnalyticsName
  │
  ├─ Phase 2 ─ job `build-images` ─ 6-leg matrix, docker build & push
  │               (sha-tagged + :latest, registry-backed buildx cache)
  │
  ├─ Phase 3 ─ job `deploy` ─ azure/arm-deploy → infra/main.bicep   ← this chapter
  │               (everything else: App Insights, alerts + availability web
  │                test + workbook, SQL, Service Bus, Redis, avatar storage,
  │                Container Apps, Key Vault secrets, budget)
  │               inputs: acrName + logAnalyticsName from Phase 1
  │               outputs: gatewayFqdn, uiFqdn, sqlServerFqdn, …
  │
  ├─ Phase 4 ─ (no migration step, each service self-applies its own
  │               migrations at startup as the SOLE migrator; minReplicas:1
  │               guarantees a single applier, see the CI/CD chapter)
  │
  └─ Phase 5 ─ smoke-test probe + rollback on failure
```

Phases 1 and 2 are their own jobs (`deploy.yml:747`, `deploy.yml:795`) rather than steps inside
`deploy`, so they overlap the ~20-minute chromium `e2e-gate` instead of sitting on the critical
path (`deploy.yml:875-877`). Nothing is rolled out there: `build-images` only pushes tags, and the
`deploy` job (`deploy.yml:863-1179`) still waits on every gate before `main.bicep` points a
container app at any of them.

The **shared resource group** is `acc-rg` in the QiMata Sponsorship subscription (East US 2), read
from the `AZURE_RESOURCE_GROUP` repository variable (`deploy.yml:24`) and named in the SQL-region
comment (`deploy.yml:946`). Both Bicep files target `resourceGroup` scope (`main.bicep:1`,
`foundation.bicep:1`) and are applied with **Incremental** deployment mode, Azure adds and updates
declared resources but never deletes absent ones. That is what keeps the legacy `AtlDevCon` archive
database intact after the per-service cutover, and it is also why superseded resources are disabled
in place rather than removed from the template (see the SLO alerts section below).

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

Foundation is deployed first (CI/CD chapter: `deploy.yml:773-779`) on every run. It provisions
exactly two resources: the Azure Container Registry and the Log Analytics workspace. These are the
two resources that _everything else_ depends on but that almost never change: the registry stores
images that live across many deploys, and the workspace accumulates days of telemetry that must
persist across re-runs of `main.bicep`.

### Parameters (`foundation.bicep:3-10`)

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `environmentName` | `string` | required | Suffix for resource names (`adc-${environmentName}-…`) |
| `location` | `string` | RG location | Primary Azure region |

The `resourceToken` variable (`foundation.bicep:12`) is a stable hash derived from
`uniqueString(resourceGroup().id, environmentName)`. All generated resource names incorporate it,
ensuring uniqueness within the subscription while remaining deterministic across re-runs. The same
`commonTags` set used in `main.bicep` is applied here too (`foundation.bicep:17-23`), so cost
attribution covers the foundation resources as well as the application ones.

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
`appLogsConfiguration` (`main.bicep:871-877`), and `main.bicep`'s Application Insights component
uses it as its workspace backing store, meaning traces and metrics land in the same workspace.

`workspaceCapping.dailyQuotaGb: 1` (`foundation.bicep:41-43`) is a FinOps circuit breaker, not a
sizing decision. Normal ingestion is around 0.4 GB/day, so the ceiling never bites in steady state;
it exists to bound a runaway telemetry storm (a metrics or log loop) instead of leaving a
pay-per-GB workspace uncapped. The comment records the escape hatch: raise it, or set
`dailyQuotaGb: -1`, if a legitimate busy period approaches the cap.

[Rubric §13, Observability & Operability] assesses whether the system exposes structured logs,
distributed traces, and metrics in a queryable store. The single workspace is the convergence
point: container-app stdout/stderr, ASP.NET Core structured logs, and OpenTelemetry traces all
land in the same Log Analytics table set, queryable with Kusto.

### Azure Container Registry (`foundation.bicep:50-62`)

```
sku: Basic
adminUserEnabled: false   // #11/#17, managed-identity pull only
```

The `adminUserEnabled: false` setting (`foundation.bicep:60`) is the central credential-hardening
decision for image pull. Without it, every container app would need a stored registry admin
password. With it disabled, images are pulled exclusively via the shared UAMI's `AcrPull` role
assignment (bootstrapped out-of-band, see the UAMI section below). The deploy push likewise uses
the GitHub deploy identity's `AcrPush` role, not the admin credential.

[Rubric §11, Security] assesses elimination of long-lived credentials. Disabling the admin user
removes the one static credential that would otherwise be needed for every pull, a concrete,
verifiable hardening choice recorded directly in the Bicep.

### Outputs (`foundation.bicep:67-69`)

`acrName`, `acrLoginServer`, and `logAnalyticsName` are the three values threaded from Phase 1
into Phase 2 (docker push target) and then into Phase 3 (`main.bicep` parameters). Because Phases 1
to 3 are now separate jobs, they cross the job boundary as job outputs (`deploy.yml:759-762`) and
are read as `needs.foundation.outputs.*`: see `deploy.yml:829`
(`az acr login --name ${{ needs.foundation.outputs.acrName }}`), `deploy.yml:845-846` (the two
image tags), and `deploy.yml:955-956` (the `acrName`/`logAnalyticsName` parameter assembly).

---

## Deployment parameters, assembled at deploy time, not committed

There is **no `infra/main.parameters.json` file** in the repository, the `infra/` directory holds only
`foundation.bicep`, `main.bicep`, `DISASTER-RECOVERY.md`, `OPERATIONS.md`, `SQL-MANAGED-IDENTITY.md`,
`POST-CUTOVER-atldevcon-downgrade.md`, and a `workbooks/` folder. The parameters fed to `main.bicep`
are built **from scratch at deploy time** by `deploy.yml`'s "Build deployment parameters file" step
(`deploy.yml:911-1068`), which writes `/tmp/deploy-params.json` with `jq`.

How it works:

- The step fails fast when the `ALERT_EMAIL` repository variable is empty (`deploy.yml:937-940`),
  because `alertEmailAddress` is now a **required** `main.bicep` parameter with no default
  (`main.bicep:102-104`). An alert rule wired to no notification channel is a silent failure, so the
  deploy refuses to proceed with an actionable error rather than letting Bicep validation report it.
- A base `jq -n` invocation (`deploy.yml:952-980`) emits the always-present parameters, `environmentName`,
  `sqlLocation`, `acrName`, `logAnalyticsName`, `sqlAdminPassword`, and the six `*Image` URLs, into the
  ARM `deploymentParameters` JSON shape. `acrName` and `logAnalyticsName` are the Phase 1 foundation
  outputs; the image URLs are the `sha`-tagged ACR references; `sqlAdminPassword` comes from the
  `SQL_ADMIN_PASSWORD` GitHub secret. `sqlLocation` defaults to `westus2` (`deploy.yml:949`) because
  the sponsor subscription blocks `Microsoft.Sql` in the RG's region.
- Optional parameters (RSA key pair, HS256 fallback key, GitHub OAuth, Google OAuth, Anthropic key, SMTP
  settings, alert email, and the three staged managed-identity SQL inputs) are conditionally appended with
  further `jq --arg` calls (`deploy.yml:982-1068`) **only when their env var is non-empty**. `jq --arg`
  JSON-escapes multi-line values correctly, critical for the PEM keys, which contain newlines. Anything not
  appended falls back to the `@secure()` parameter's empty-string default in `main.bicep`, which the
  template's feature flags (`useRs256`, `hasAnthropic`, …) read to disable the corresponding feature.
- `useManagedIdentitySql` is the one boolean: it is appended as a literal JSON `true` only when the
  `USE_MANAGED_IDENTITY_SQL` repository variable is exactly `"true"` (`deploy.yml:1065-1068`), keeping
  the Bicep parameter typed.

[Rubric §11, Security] is directly served: there is no checked-in parameters file to leak secrets from at
all; the actual secret values flow from GitHub Actions secrets (encrypted at rest, masked in logs, visible
only to the `production` deploy environment) into the ephemeral `jq`-assembled `/tmp/deploy-params.json`
that exists only for the duration of the workflow run.

---

## `infra/main.bicep`, the full application infrastructure

**File:** `MMCA.ADC/infra/main.bicep`

`main.bicep` declares every application-layer Azure resource: Application Insights, the SLO
scheduled query rules and their action group, two operational log alerts, a Gateway availability
web test and its alert, a saved SLO workbook (`main.bicep:515-527`), the monthly cost budget, SQL
Server with five databases (the `AtlDevCon` archive plus the four per-service databases), Service
Bus, an inert-by-default Notification Hub, the avatar storage account, an Azure Managed Redis
instance, the Container Apps environment, fourteen Key Vault secrets, and all six container apps.
All billable resources receive the same tag set (`main.bicep:138-144`) so Azure Cost Analysis can
attribute spend by application and environment.

### Parameters (`main.bicep:1-122`)

Parameters divide into five categories:

**Infrastructure coordinates** (supplied from Phase 1 foundation outputs):
- `acrName`, `logAnalyticsName`, links back to foundation resources.
- `environmentName`, `location`, `sqlLocation`, `sqlLocation` is separate because the QiMata
  Sponsorship subscription blocks `Microsoft.Sql` in East US 2 (the RG location) but permits it in
  West US 2 (`main.bicep:12-14`). Container Apps stay in the RG region; only SQL lands in West US 2.

**Secure parameters** (marked `@secure()`, ARM masks them in deployment logs and does not store
them in deployment history):
- `sqlAdminPassword` (`main.bicep:27`), SQL Server admin password.
- `jwtSecretKey` (`main.bicep:40`), HS256 fallback key (used when RSA keys are absent).
- `rsaPrivateKeyPem`, `rsaPublicKeyPem` (`main.bicep:44,48`), PEM-encoded RSA key pair for RS256
  JWT signing and JWKS publishing.
- `githubOAuthClientSecret` (`main.bicep:55`), `googleOAuthClientSecret` (`main.bicep:62`),
  `anthropicApiKey` (`main.bicep:66`), `smtpPassword` (`main.bicep:79`), optional integration secrets.

**Image tags** (one per deployable, passed as `sha`-tagged ACR URLs, e.g.
`acrLoginServer/mmca-adc-gateway:<commit-sha>`):
- `gatewayImage`, `uiImage`, `conferenceImage`, `identityImage`, `engagementImage`,
  `notificationImage` (`main.bicep:84-100`).

**Staged-hardening and inert-feature switches** (all default to the safe value, so a deploy with the
default parameter set changes nothing):
- `sqlAadAdminLogin`, `sqlAadAdminObjectId` (`main.bicep:30,33`), default empty, provision the
  additive Entra admin on the SQL server.
- `useManagedIdentitySql` (`main.bicep:36`), default `false`, swaps the app-to-database auth segment
  (see [ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html) below).
- `deployNotificationHub`, `nativePushEnabled` (`main.bicep:110,107`), both default `false`, gate the
  ADR-044 Notification Hubs namespace and whether native push is active at all.
- `grantAvatarStorageRole` (`main.bicep:113`), default `false`, because the deploy identity
  deliberately lacks `Microsoft.Authorization/roleAssignments/write`.

**FinOps and alerting controls**:
- `enableBudget` (`main.bicep:116`), `monthlyBudgetAmount` (`main.bicep:119`),
  `budgetStartDate` (`main.bicep:122`), govern the cost budget resource (see below).
- `alertEmailAddress` (`main.bicep:104`) is **required**: it carries `@minLength(3)` and no default
  (`main.bicep:102-104`), so a template that would provision alerts notifying nobody fails to deploy.
  It is the receiver on both the action group and the budget notifications.

### Computed variables (`main.bicep:124-164`)

Five boolean flags gate optional blocks throughout the template:
- `useRs256 = !empty(rsaPrivateKeyPem) && !empty(rsaPublicKeyPem)` (`main.bicep:127`), flips JWT
  signing from HS256 to RS256 and enables the JWKS endpoint on Identity when both RSA keys are set.
- `hasAnthropic` (`main.bicep:128`), gates the Anthropic API key secret on Conference.
- `hasSmtpPassword`, `hasGitHubOAuth`, `hasGoogleOAuth` (`main.bicep:129-131`), gate SMTP and the two
  OAuth provider secrets.
- `hasAnyOAuth` (`main.bicep:134`) is the provider-independent one: `OAuth__UIBaseUrl` is the
  post-login redirect target, so it must be injected whenever _any_ external provider is on rather
  than behind one of them.

Per-service SQL connection strings (`main.bicep:152-159`) are composed from a shared base: the SQL
server FQDN plus one of two auth segments selected by `useManagedIdentitySql` (`main.bicep:152-154`).
Each is a distinct string pointing at its own database (`ADC_Identity`, `ADC_Conference`,
`ADC_Engagement`, `ADC_Notification`), making the database-per-service boundary explicit in the value
that goes into Key Vault.

The Service Bus connection string (`main.bicep:164`) is resolved via `listKeys()` against the
`app-clients` SAS authorization rule (not `RootManageSharedAccessKey`) so a future migration to
managed identity can revoke only the app rule without touching the namespace root. The Redis
connection string (`main.bicep:861`) is assembled the same way, from the instance hostname plus a
`listKeys()` primary key.

### Application Insights (`main.bicep:185-195`)

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
Every container app receives `APPLICATIONINSIGHTS_CONNECTION_STRING` (`main.bicep:200-203`) and a
per-service `OTEL_SERVICE_NAME` (e.g. `'identity'`, `'conference'`). The `OTEL_SERVICE_NAME` env
var is what Azure Monitor maps to the Cloud Role Name, without it, all services appear as
`"unknown_service"` in the Application Map.

`MMCA.Common.Aspire`'s `AddOpenTelemetryExporters` calls `UseAzureMonitor()` whenever
`APPLICATIONINSIGHTS_CONNECTION_STRING` is present (`main.bicep:180-184` comment), so the Common
framework automatically routes OpenTelemetry spans, logs, and metrics to Azure Monitor in
production with no service-level code change.

Two more shared env entries ride along with the connection string on every app, and both are cost
controls on a pay-per-GB workspace:

- `Telemetry__TracesSampleRatio: '0.25'` (`main.bicep:209-212`), head-based trace sampling that keeps
  25% of traces. `ParentBased` sampling in `MMCA.Common.Aspire` keeps a sampled-in trace intact
  across service boundaries, so a kept trace is still end-to-end rather than a fragment.
- `Logging__OpenTelemetry__LogLevel__Default: 'Warning'` (`main.bicep:220-223`), the floor for what the
  OpenTelemetry logging provider ships to Azure Monitor. Serilog still writes Information to stdout
  (container logs), but only Warning and above bills against the workspace. The value is set
  explicitly because `OpenTelemetry` is the `ProviderAlias` of `OpenTelemetryLoggerProvider`, so the
  key gates that provider only, and because the service hosts now register Serilog as one provider
  alongside OpenTelemetry instead of calling `UseSerilog()`, which used to replace the
  `ILoggerFactory` and drop every application log line before it could reach App Insights.

[Rubric §13, Observability & Operability] assesses whether the system ships distributed traces,
structured logs, and metrics to a queryable backend. The workspace-based App Insights with
per-service Cloud Role Names gives full Application Map visibility, end-to-end distributed traces
across all six services, and Kusto-queryable logs, covering this category end-to-end.

### SLO alerts as code (`main.bicep:225-333`), [ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html)

The three SLOs are declared as **data**: an array of records named `sloAlertSpecs`
(`main.bicep:261-289`) carrying `key`, `description`, `query`, `timeAggregation`,
`metricMeasureColumn`, `threshold` and `severity`. A Bicep `for` loop materializes one Log Analytics
`Microsoft.Insights/scheduledQueryRules` per spec (`main.bicep:291-333`):

| Alert key | KQL source | Threshold | Window | Severity |
|---|---|---|---|---|
| `failed-requests` | `AppRequests` where `Success == false`, excluding 401/499 | > 10 rows | 15 min | 2 (Error) |
| `server-response-time` | `AppRequests` excluding `/hubs/`, `avg(DurationMs)` | > 3000ms | 15 min | 3 (Warning) |
| `dependency-failures` | `AppDependencies` where `Success == false`, excluding 401/499 | > 10 rows | 15 min | 2 (Error) |

**The KQL predicate is the whole point of the migration.** These rules replaced metric alerts on
`requests/failed`, `requests/duration` and `dependencies/failed`, which paged on routine traffic
because a metric alert cannot express a status-code or URL predicate. The template records the two
real incidents (`main.bicep:247-260`): one window held 8x401 plus 2x499 plus a single readiness 503
and zero other failures, all from one browser session retrying with an expired token, and five
long-lived SignalR hub connections averaging 11.3s dragged the fleet-wide average to 5539ms against
a 3000ms threshold while every real request was fast. A hub connection reports its **connection
lifetime** as request duration. The thresholds and severities are unchanged, so this is a precision
fix, not a sensitivity cut: a genuine 400 or 500 burst still pages at the same numbers.

The `union(...)` in the criteria (`main.bicep:313-325`) supplies `metricMeasureColumn` only for the
aggregate rule. Omitting it (the empty-string case) makes a rule count returned **rows**, which is
what the two failure-count SLOs want. `evaluationFrequency: 'PT5M'` over `windowSize: 'PT15M'` with
`autoMitigate: true` (`main.bicep:305-307`) means each rule re-evaluates every five minutes against
a 15-minute rolling window and auto-resolves when the signal returns below threshold.

**The superseded metric alerts are still declared, and disabled in place** (`main.bicep:335-377`).
`legacySloMetricAlertSpecs` (`main.bicep:342-346`) still materializes the three `metricAlerts` under
their **original, unsuffixed** names (`main.bicep:350`) with `enabled: false` and an empty `actions`
array (`main.bicep:355`, `:374`). This is the incremental-ARM consequence made explicit: a resource
that simply leaves the template is never deleted from the resource group, so dropping them would
have left three live rules firing alongside the new ones. Disabling them declaratively needs no
portal step and rolls back in one line. It is also why the replacements carry a `-v2` suffix
(`main.bicep:293-296`): reusing the name would have renamed the live originals instead of disabling
them.

The action group (`main.bicep:231-245`) has an **unconditional** email receiver, which is the direct
consequence of `alertEmailAddress` being a required parameter. Every scheduled query rule routes to
it (`main.bicep:329`) and so does the cost budget (`main.bicep:552`, `:560`). One group, one
receiver, no severity routing: severity is triage metadata, not a delivery decision.

Each SLO alert is paired with a same-severity triage section in `MMCA.ADC/infra/OPERATIONS.md`
(`OPERATIONS.md:15`, `:29`, `:42`), and that pairing is enforced by a framework fitness test rather
than by discipline: `ObservabilityConventionTestsBase` parses this template between the literal
anchors `var sloAlertSpecs` and `resource sloAlerts` and fails the build in both directions. That
gate is covered in [group 27](group-27-testing-infrastructure.md#observabilityconventiontestsbase);
it is not duplicated here. Note the coverage boundary: only alerts inside that parse window are
gated, so the two operational rules and the availability alert below are provisioned but ungated.

### Operational and availability alerts (`main.bicep:379-505`)

Beyond the three SLOs, `main.bicep` provisions two more scheduled query rules from
`scheduledQueryAlertSpecs` (`main.bicep:392-405`, materialized at `:407-439`), both severity 2 on a
15-minute evaluation over a 15-minute window:

- `outbox-dead-letter` (`main.bicep:394-398`) fires on **any** hit (`threshold: 0`) of an `AppTraces`
  row at Error or above whose message contains `dead-lettered`. An outbox message that exhausted its
  retries means an integration event was permanently lost. The row-age signal is DB-side and not
  queryable from Log Analytics, so this Error line _is_ the backlog alarm.
- `sql-dependency-failures` (`main.bicep:400-404`) fires above 10 failed SQL dependency calls. Every
  service owns exactly one database, so a burst here means a service cannot reach its own DB, which
  also stalls its outbox drain.

An outside-in availability signal sits alongside them: a standard URL-ping web test
(`main.bicep:448-479`) probes the public Gateway `/health` every 300 seconds from three Azure
locations (East US, North Central US, South Central US), bound to the App Insights component via a
`hidden-link` tag. Its severity **1** alert (`main.bicep:481-505`) fires on a `failedLocationCount`
of 2, so a single-location blip does not page.

[Rubric §29, Resilience, Reliability & Business Continuity] assesses whether the system can detect
degradation automatically and notify operators. The three SLO rules, the two operational rules, and
the sev-1 availability alert all route to the same action group as the cost budget, giving the
on-call operator an automated signal for error rate, latency, dependency failures, permanent event
loss, database reachability, and total entry-point outage.

### SLO workbook (`main.bicep:507-527`)

A saved Azure Monitor workbook renders the same three SLO signals plus exceptions, grouped per
service by `AppRoleName` (which is the `OTEL_SERVICE_NAME` value). It is bound to the Log Analytics
workspace and embeds `workbooks/adc-slo-workbook.json` at **compile time** via `loadTextContent`
(`main.bicep:524`), so the visualization cannot diverge from the alerts by being maintained
somewhere else, and the JSON stays independently validatable as a file.

### Cost budget (`main.bicep:529-564`)

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
conference-day surge: the surge is a manual scale-up of the SQL tier and the Container App replica
caps, and left running for weeks it would push the monthly bill well past $200 and trigger both
thresholds long before the billing cycle closes. The `cost-guard.yml` workflow is the same guard
from the other direction: it is one of `deploy`'s required gates and fails the deploy outright when
a database is off the Basic tier or an app's `maxReplicas` exceeds 2 (`cost-guard.yml:25`, `:61`,
`:76`).

`enableBudget: bool` (`main.bicep:116`) allows disabling the resource when the deploy identity
lacks `Microsoft.Consumption/budgets/write` (as is the case in some sponsor subscriptions).
`budgetStartDate` (`main.bicep:122`) is pinned at creation and must not change on an existing
budget, ARM rejects start-date changes on update. The comment in `main.bicep:121-122` records this
constraint directly so future operators don't hit the ARM error.

[Rubric §31, Cost Efficiency / FinOps] assesses whether infrastructure cost is actively
monitored, bounded, and governed. The budget resource, the `enableBudget` escape hatch, the
workspace daily ingestion cap, the 25% trace sampling, the Warning log floor, and the `commonTags`
applied to every billable resource (`main.bicep:138-144`) together satisfy this category: tags
enable cost attribution; the caps bound runaway spend at both the telemetry and the compute end;
and the budget threshold notifications make the cap actionable.

### SQL Server and databases (`main.bicep:566-679`)

**SQL Server** (`main.bicep:569-580`):
```
name: '${prefix}-sql-${resourceToken}'
version: '12.0'
minimalTlsVersion: '1.2'
publicNetworkAccess: 'Enabled'
```

`publicNetworkAccess: 'Enabled'` (`main.bicep:578`) combined with the firewall rule
`AllowAzureServices` (`main.bicep:582-589`, startIpAddress/endIpAddress both `0.0.0.0`) is the
Azure-standard pattern for allowing Container Apps to reach SQL without a VNet/private endpoint.
The `0.0.0.0-0.0.0.0` rule does not allow traffic from arbitrary internet IPs; it enables the
special "allow Azure services" flag. `minimalTlsVersion: '1.2'` (`main.bicep:577`) ensures all
connections are encrypted at TLS 1.2 minimum.

**Entra (Azure AD) admin** (`main.bicep:597-606`), provisioned only when `sqlAadAdminObjectId` is
supplied. It is deliberately **additive**: it enables Entra auth alongside the SQL admin login and
does **not** set `azureADOnlyAuthentication`, so password auth keeps working throughout the
transition. Its purpose is to let an operator run the per-database
`CREATE USER [adc-prod-apps-identity] FROM EXTERNAL PROVIDER` grants that managed-identity app auth
depends on. Full sequencing lives in `infra/SQL-MANAGED-IDENTITY.md`; the staged model is described
in the Key Vault section below.

**Legacy `AtlDevCon` database** (`main.bicep:614-628`):
Retained at Basic tier (5 DTU, 2 GB cap) as a read-only archive and rollback source after the
database-per-service cutover, downgraded from S0 to minimise cost on an idle archive. Its Bicep
resource declaration prevents out-of-band drift, even though Incremental mode would not delete it
anyway, having it declared makes the "never touch this" intent explicit and prevents ARM complaining
about an undeclared resource. The comment at `main.bicep:608-613` is the canonical explanation: the
data (~34 MB) was fully copied into the per-service databases; this is the archive, not the live
store.

**Per-service databases** (`main.bicep:639-662`), `[Rubric §8, Data Architecture]`:

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
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) for the full rationale.

[Rubric §7, Microservices Readiness] assesses whether the service boundary includes data
autonomy, not just code autonomy. These four Basic-tier databases on one SQL server are the
cheapest expression of full data autonomy: each service has an independent schema, independent
migrations, independent outbox, and can be moved to its own server later without application
changes.

**Long-term backup retention (LTR)** (`main.bicep:668-679`):

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

### Azure Service Bus (`main.bicep:681-723`)

```
sku: Standard   // Basic rejected: MassTransit requires topics, Basic supports queues only
minimumTlsVersion: '1.2'
```

The Standard tier comment at `main.bicep:689-693` is the explanation of a constraint that has
bitten the project before (it was absent in early production and is now documented in the memory
note `project_adc_no_broker_in_azure.md`): MassTransit's `UsingAzureServiceBus` auto-provisions
one topic per message type and one subscription per consumer, Basic tier has no topics, only
queues, so it silently fails at MassTransit startup. Standard tier costs a flat ~$10/month base for
the namespace plus per-million-operations, and the link/unlink flows are far below 1k messages a
month even at conference scale.

The `app-clients` authorization rule (`main.bicep:713-723`) grants `Send + Listen + Manage` rights.
The `Manage` right is required so MassTransit can `ConfigureEndpoints`, auto-provision topics
and subscriptions at startup. The alternative (declaring every topic in Bicep) would be brittle
as new integration events are added, because it would require a Bicep change for every new event
type.

Current integration event flows wired over Service Bus (documented at `main.bicep:684-687`):
- Identity publishes `UserRegistered` → Conference `UserRegisteredHandler` auto-links a speaker
  by email match (BR-207).
- Conference publishes `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser` → Identity updates
  `User.LinkedSpeakerId` (BR-209/BR-70).

These events cross service boundaries asynchronously via the outbox + MassTransit; the Service Bus
namespace is the transport that carries them in production (RabbitMQ fills the same role locally).
All four services receive `MessageBus__Provider` and `MessageBus__ConnectionString`, but only
Identity and Conference call `AddBrokerMessaging` today: the Engagement and Notification entries are
pre-provisioned forward-compatible wiring, and the template says so (`main.bicep:1341-1345`,
`:1470-1473`), so adding a consumer later is a `Program.cs` change with no infra redeploy.

### Azure Notification Hub (`main.bicep:725-763`), inert by default

The [ADR-044](https://ivanball.github.io/docs/adr/044-native-push-delivery.html) native-push fan-out
(FCM v1 and APNs) is declared but **not deployed**: the namespace,
the `adc-push` hub, and its `app-backend` authorization rule are all behind
`if (deployNotificationHub)`, which defaults to `false` (`main.bicep:110`). The comment on that
parameter records why the default is off rather than the resource being absent: namespace creation
on this subscription repeatedly hung for hours and failed with an ARM `InternalServerError`,
blocking every application deploy for an inert-by-design resource.

Even with the namespace deployed, delivery stays off: `nativePushEnabled` (`main.bicep:107`) is a
separate default-`false` parameter, and the Notification app's `NativePush__Enabled` env var is only
injected at all when the hub exists (`main.bicep:1485-1489`). Turning it on is a two-step runbook
operation, upload the platform credentials in the portal, then redeploy with the flags flipped. The
hub's Free tier covers 500 devices and 1M pushes per month, far above conference volumes.

### Avatar storage (`main.bicep:765-814`), [ADR-045](https://ivanball.github.io/docs/adr/045-managed-file-storage-and-avatars.html)

One `Standard_LRS` StorageV2 account (`main.bicep:773-786`) holds a single public-read `avatars`
container (`main.bicep:793-799`). Public read is deliberate: avatar URLs render in `<img>` tags on
anonymous-visible surfaces with no SAS plumbing, and blob names carry a random suffix so they are
not enumerable. The account sets `minimumTlsVersion: 'TLS1_2'` and `supportsHttpsTrafficOnly: true`.

The Identity service authenticates to it with `DefaultAzureCredential` resolving the shared apps
identity, so there is no connection-string secret. Control-plane ownership of the account does not
grant blob writes, though: the `Storage Blob Data Contributor` data-plane assignment
(`main.bicep:806-814`) is what does, and it is guarded by `grantAvatarStorageRole`, default `false`,
for exactly the same reason as the Key Vault grants. Until an operator applies it once by hand,
avatar uploads fail cleanly with `FileStorage.UploadFailed` and everything else deploys.

### Azure Managed Redis (`main.bicep:816-861`)

One shared `Microsoft.Cache/redisEnterprise` instance at the `Balanced_B0` SKU (1 GB, HA disabled,
around $13/month) with a single `default` database on port 10000, encrypted client protocol,
`OSSCluster` clustering, `VolatileLRU` eviction and both persistence modes off
(`main.bicep:830-858`). Volatile-only eviction is deliberate: cache entries and idempotency records
carry TTLs, and a key without a TTL must never be silently evicted.

Every service gets `ConnectionStrings__redis` from the vault, and three consumers activate on that
key alone with no application change:

1. `ICacheService` upgrades from a per-replica `MemoryCache` to `DistributedCacheService`, which
   makes the `IdempotencyFilter`'s 24h replay records cross-replica (with `maxReplicas: 2` a
   duplicate POST routed to the other replica used to execute twice) and propagates
   `CachingQueryDecorator` invalidation to every replica.
2. `AddRedisDistributedCache` in each service `Program.cs`, conditional on the same key.
3. The Notification SignalR backplane auto-wires when the key appears, via
   `MMCA.Common.Infrastructure`'s `AddPushNotifications`.

### Container Apps environment (`main.bicep:863-879`)

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

### UAMI and ACR credential model (`main.bicep:881-894`)

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

The GitHub Actions deploy identity authenticates to Azure via **OIDC** (`deploy.yml:901-906`, and
the same block in the `foundation` and `build-images` jobs at `deploy.yml:766-771`, `:821-826`):
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
(`deploy.yml:752-757`). Every job that runs `azure/login` therefore declares it.

### Key Vault and runtime secrets (`main.bicep:896-976`), [ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)

```bicep
resource keyVault '…/vaults@…' existing = {
  name: 'adckv${resourceToken}'
}
```

**Every production secret lives in Key Vault and reaches a Container App as a reference, never as a
value.** Key Vault is bootstrapped out-of-band like the identity: the template declares it `existing`
(`main.bicep:903-905`) and then writes fourteen secret child resources into it
(`main.bicep:907-976`). Each Container App references them by Key Vault URI through the shared UAMI:

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
consume them only through `secretRef` (for example `main.bicep:1038`, `:1080`, `:1095`, `:1233`,
`:1488`). At runtime ACA fetches the current secret version via the UAMI's Key Vault Secrets User
role, meaning a secret rotation only requires updating the Key Vault secret, no Bicep re-deployment,
no app restart.

Secrets stored in Key Vault (`main.bicep:907-976`):
- Per-service SQL connection strings (4): `identity-sql-connection-string`,
  `conference-sql-connection-string`, `engagement-sql-connection-string`,
  `notification-sql-connection-string`
- `service-bus-connection-string`, `redis-connection-string`
- `notification-hub-connection-string` (only when `deployNotificationHub` is true, `main.bicep:932`)
- `rsa-private-key-pem`, `rsa-public-key-pem` (or `'unused'` placeholder when not supplied)
- `jwt-secret-key` (HS256 fallback, or `'unused'`)
- `smtp-password`, `github-oauth-client-secret`, `google-oauth-client-secret`, `anthropic-api-key`

The composite strings (Redis, Service Bus, and the four SQL connection strings) are assembled at
deploy time from `listKeys()` results and the SQL server FQDN, and written straight into the vault,
so the assembled value never lands in app configuration at all.

All `@secure()` parameters that arrive as `''` (empty) are stored as `'unused'` rather than empty
string, because Key Vault rejects empty-string secret values. The application code never reads a
`'unused'` value, the `useRs256`, `hasGitHubOAuth`, etc. flags in the template control which env
vars are injected into each container, so the `'unused'` placeholder is never reachable by running
code. The cost is that the vault is a poor inventory: an `unused` secret is indistinguishable from a
configured one, and only an app's `secrets` list says which credentials are actually live.

**The two apps that need no credential say so explicitly.** Gateway and UI declare `secrets: []`
(`main.bicep:1563`, `:1666`) rather than omitting the property: a pure YARP proxy and a Blazor host
that talks only to the Gateway hold nothing worth stealing, and stating it makes that a reviewable
fact rather than an omission.

**Both role assignments are bootstrapped out of band, deliberately.** The deploy identity holds Key
Vault Secrets Officer to write the values; the apps hold Key Vault Secrets User to read them; the
vault and both grants are created outside the template because the deploy principal has Contributor
without `Microsoft.Authorization/roleAssignments/write` (`main.bicep:899-902`). A template that
created its own role assignments would need exactly the permission the deployment deliberately does
not have. The trade-off is stated in the ADR: one shared identity means any app carrying it can read
**every** secret in the vault, not only the ones its own `secrets` list names, and the template
cannot report that a grant is missing.

**The staged SQL auth is the one credential still on the old model.** `useManagedIdentitySql`
(`main.bicep:36`) defaults to `false` and selects one of two auth segments for the shared connection
string base (`main.bicep:152-154`): either
`Authentication=Active Directory Managed Identity;User Id=<apps identity client id>` with no
password at all, or `User ID=...;Password=...`. With the default parameters every app-to-database
string still carries a login and password (`main.bicep:154`). That password is itself a vault secret
and never app configuration, so what remains is a shared SQL login, not an exposed one. The
migration runs in three stages, all driven by repository variables that are absent by default:
supply the Entra admin (`deploy.yml:1054-1061`), run the per-database external-provider grants by
hand, then set `USE_MANAGED_IDENTITY_SQL=true` (`deploy.yml:1065-1068`). Because the Entra admin is
additive and the flag defaults off, stage 1 changes nothing observable and a bad flip rolls back by
the same one parameter. Whether a given deployment has already set that variable is not determinable
from source.

**Where the other repos stand.** MMCA.Store implements the identical Key Vault model with its own
identity (`mmca-prod-apps-identity`) and eleven vault secrets. MMCA.Common ships the shape as a
compile-only reference sample under `samples/deployment/`, not a deployment: it creates an
RBAC-authorized vault and attaches the identity for both ACR pull and secret reads, but declares no
`secrets` entry for the `secretRef` it uses and writes no secret into the vault it creates, and CI
only type-checks it. MMCA.Helpdesk has no `infra/` directory and no deploy workflow at all (its
`.github/workflows/` holds `ci.yml` plus the two Claude workflows), so there is nothing there to
adopt.

### Container Apps, the six deployables

Six `Microsoft.App/containerApps` resources are declared in `main.bicep`. They share structural
patterns but differ in ingress transport, probe style, and environment variables.

#### Common structural patterns

All six apps (`main.bicep:978-1739`) share:

- `identity: { type: 'UserAssigned', userAssignedIdentities: { '${appsIdentity.id}': {} } }`, the
  same shared UAMI on every app (`main.bicep:985-990`, `:1165`, `:1279`, `:1393`, `:1546`, `:1646`).
- `activeRevisionsMode: 'Single'`, one active revision at a time; new deploys create a new
  revision and traffic flips atomically rather than gradually. This matches `deploy.yml`'s post-
  deploy smoke-test gate, which checks the new revision before marking the deploy green.
- `scale: { minReplicas: 1, maxReplicas: 2, rules: [{ name: 'http-scale', http: { metadata: { concurrentRequests: '50' } } }] }`,
  `minReplicas: 1` prevents scale-to-zero (which would destroy Blazor Server circuits and outbox
  in-flight messages); HTTP scale-out at 50 concurrent requests gives the headroom needed for a
  conference-day load (historically ~67 peak concurrent). **Notification is the exception**: its
  `maxReplicas` is **1** (`main.bicep:1530`), a deliberate right-sizing at that measured peak. The
  Redis backplane that would make a second replica safe for hub fan-out _is_ now wired, so the cap
  is a cost choice rather than a correctness one (`main.bicep:1525-1529`); raising it wants a
  verified two-replica fan-out test first.
- `ASPNETCORE_ENVIRONMENT: 'Production'`, switches ASP.NET Core to the production configuration,
  which among other things disables the OpenAPI endpoint (it is only mapped outside Production per
  the ADC CLAUDE.md).
- `ApplicationSettings__DatabaseInitStrategy: 'Migrate'`, each service auto-applies its own
  database's pending migrations at startup as the **sole migrator**. `deploy.yml` deliberately has *no*
  separate `sqlcmd` migration step (a backstop would race the container's startup `Migrate()`); with
  `minReplicas: 1` exactly one replica migrates before the revision serves (`deploy.yml:1078-1088`).
  The build-time EF model-drift gate (`deploy.yml:262-276`) still guarantees a migration exists for
  every model change, across all four migrations projects.
- `Outbox__PollingIntervalSeconds: '300'`, the outbox signal + smart wait in MMCA.Common ≥ 1.50.0
  delivers real messages in ~5 seconds regardless of the poll interval; the 300-second poll only
  governs idle polling. This cuts App Insights SQL dependency telemetry that would otherwise flood
  the workspace around the clock (the `OutboxPollFilterProcessor` suppresses the poll spans from
  App Insights per the memory note `project_outbox_cost_optimization.md`).
- `ConnectionStrings__redis` from Key Vault on all four services, which is the single key that turns
  on the distributed cache, cross-replica idempotency, and the SignalR backplane.
- `MessageBus__Provider: 'AzureServiceBus'` + `MessageBus__ConnectionString` from Key Vault,
  selects MassTransit's Azure Service Bus transport at startup (locally the AppHost injects
  `WithBroker(rabbit)` for RabbitMQ instead).
- `HealthProbe__Port`, a dedicated HTTP/1.1 listener that `Program.cs` adds when the key is set, and
  the target of all three probes (see below).

[Rubric §17, DevOps & Deployment] specifically calls out environment parity. The same six
services that run under Aspire locally also run as Container Apps in production, with the
transport switch (`RabbitMQ → AzureServiceBus`), the SQL location switch (`localhost SQL container
→ Azure SQL`), and the secret management switch (`environment variable → Key Vault URI`) all being
configuration differences, not code differences. Application code is identical in both environments.

#### Ingress transport choices

Two distinct transport configurations appear across the six apps:

**HTTP/2 cleartext (`transport: 'http2'`, `allowInsecure: true`)**: used by Identity, Conference,
and Engagement (`main.bicep:995-1002`, `:1175-1182`, `:1289-1296`). These three
services run Kestrel in `Http2`-only on cleartext (h2c prior knowledge), which is required for
cross-service gRPC: Kestrel cannot negotiate HTTP/2 via ALPN without TLS, and internal ACA
service-to-service traffic does not pass through the TLS terminator. `allowInsecure: true` is
required here because h2c is technically cleartext HTTP/2, it is not "insecure" in the
architectural sense (traffic stays within the ACA virtual network) but the field name is misleading.

**HTTP/1.1 (`transport: 'http'`)**: used by Notification, Gateway, and UI. Notification runs
Kestrel in `Http1AndHttp2` because SignalR's WebSocket transport begins with an HTTP/1.1 Upgrade
handshake (`main.bicep:1406` comment). Gateway and UI use HTTP/1.1 because they are the external
entry points (Blazor Server also uses WebSocket upgrade from HTTP/1.1, `main.bicep:1693-1694`
comment).

Notification carries a third shape on top: `additionalPortMappings` exposes an internal-only TCP
port 8081 (`main.bicep:1413-1419`) for the cleartext h2c gRPC ingress (`LiveChannelPush`). TCP
passthrough is what sidesteps the envoy HTTP/1.1-versus-HTTP/2 conflict, because the main ingress
must stay `http` for WebSockets while gRPC needs end-to-end HTTP/2 (the
[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed-transport
profile).

#### Probes on a dedicated HTTP/1.1 listener

Kestrel in HTTP/2 prior-knowledge mode rejects the platform's HTTP/1.1 `httpGet` probe with
`GOAWAY HTTP_1_1_REQUIRED`, which would fail the liveness check and cause a reboot loop. Rather than
degrading the three h2c services to port-only `tcpSocket` probes, each service now opens a
**dedicated HTTP/1.1 probe listener** that is not exposed via ingress: `HealthProbe__Port: '8081'`
on Identity, Conference and Engagement (`main.bicep:1037`, `:1207`, `:1317`) and `'8082'` on
Notification (`main.bicep:1450`, because 8080 and 8081 are already the ADR-012 pair). ACA probes may
target a port that ingress does not publish, so all six apps use `httpGet` probes and all six carry
the same three:

| Probe | Path | Semantics |
|---|---|---|
| `startup` | `/alive` | `initialDelaySeconds: 5`, `periodSeconds: 5`, `failureThreshold: 30` |
| `liveness` | `/alive` | self-only, so a SQL outage never restarts the container |
| `readiness` | `/health/ready` | warmup gate plus the DB-aware `AddSqlServer` check |

The liveness/readiness split is the load-bearing part (`main.bicep:1118-1124`): `/alive` checks the
process only, so a database outage does not trigger a restart loop, while `/health/ready` fails when
a replica cannot reach its database, pulling it out of rotation instead of letting it serve 500s.
Readiness is also gated on `WarmupHostedService` completing (OIDC discovery fetched), so ACA holds
back user traffic until the replica is warm. Gateway and UI probe their own 8080 (`main.bicep:1590-1615`,
`:1695-1720`) because their Kestrel accepts HTTP/1.1 directly.

#### Service Discovery (`services__<name>__http__0`)

Aspire's service discovery convention uses env vars of the form `services__<service-name>__http__0`
to resolve service endpoints. In production these point at internal ACA hostnames:

- Gateway → all four services: `conference` (`main.bicep:1583`), `identity` (`:1584`),
  `engagement` (`:1585`), `notification` (`:1586`), each as `http://${<app>.name}`
- Conference → `services__engagement__http__0 = http://${prefix}-engagement` (`main.bicep:1226`)
  (using the literal `${prefix}-engagement` rather than `${engagementApp.name}` to avoid a
  Bicep symbolic cycle, Conference and Engagement both reference each other)
- Engagement → `services__conference__http__0 = http://${prefix}-conference` (`main.bicep:1335`)
- Notification → `services__identity__http__0 = http://${identityApp.name}` (`main.bicep:1469`)
- Identity → `services__engagement__http__0` (`main.bicep:1068`), for the PRIVACY.md data-subject
  export's Engagement section

Two edges use a **named** endpoint rather than the default `http` one, because they target
Notification's dedicated h2c gRPC port: `services__notification__grpc__0 = http://${prefix}-notification:8081`
from Identity (`main.bicep:1075`) and from Engagement (`main.bicep:1340`). Both use the literal
`${prefix}-notification` name so deployment ordering stays unconstrained, since Notification itself
references `identityApp` for its JWKS authority.

The same service names work locally because the AppHost's `WithReference` injects them as
`services__engagement__http__0 = http://localhost:<assigned-port>`. The application code calls
`AddHttpForwarderWithServiceDiscovery()` or `AddTypedGrpcClient<T>(serviceName)` in both
environments and resolves the endpoint from that env var key.

#### Identity Service specifics (`main.bicep:978-1156`)

Identity is the JWT issuer and JWKS endpoint. Its JWT configuration (`main.bicep:1056-1060`):

```bicep
{ name: 'Jwt__SigningAlgorithm',   value: useRs256 ? 'RS256' : 'HS256' }
{ name: 'Jwt__Issuer',            value: 'https://${prefix}-gateway.${...defaultDomain}' }
{ name: 'Jwt__Audience',          value: 'AtlDevConapi' }
{ name: 'Jwt__AccessTokenExpirationMinutes', value: '15' }
{ name: 'Jwt__RefreshTokenExpirationDays',   value: '7' }
```

When `useRs256 = true`, the RSA private key (from Key Vault) signs tokens and the public key is
published at `/.well-known/jwks.json` (`main.bicep:1094-1099`). Otherwise the HS256 branch injects
`Jwt__SecretForKey` and sets `Jwks__Enabled: 'false'` (`main.bicep:1100-1103`). Other services fetch
the JWKS document through the Gateway
(`Authentication__JwtBearer__Authority = 'http://${identityApp.name}'`) to validate tokens without
a shared secret ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) "authentication dual-fetch"). The 15-minute access token lifetime limits
the blast radius of a leaked token.

Identity is also the app that carries the avatar-storage wiring (`main.bicep:1084-1086`):
`FileStorage__ServiceUri`, `FileStorage__ContainerName`, and `AZURE_CLIENT_ID` pinned to the apps
identity's client id so `DefaultAzureCredential` resolves the intended identity explicitly rather
than relying on discovery order.

Identity is sized at 0.25 CPU / 0.5 Gi (`main.bicep:1026`), the smallest Container Apps allocation.
JWT operations are CPU-cheap once the key is loaded; the bottleneck is typically network I/O to SQL.

#### Conference Service specifics (`main.bicep:1158-1270`)

Conference is one of the two largest apps (0.5 CPU / 1 Gi, `main.bicep:1198`), reflecting its 14 REST
controllers, its AI scoring path (Anthropic API), and its role as the read-heavy entry point for
the event/session catalog. The Anthropic API key is injected only when `hasAnthropic = true`
(`main.bicep:1184-1191`, `:1233`):

```bicep
secrets: union(
  [ ... sql, redis and service bus ... ],
  hasAnthropic ? [{ name: 'anthropic-api-key', keyVaultUrl: ..., identity: appsIdentity.id }] : []
)
```

This is the `union()` + conditional array pattern used throughout `main.bicep` to keep optional
secrets and env vars out of the resource definition when not configured, rather than passing empty
strings to the container.

#### Notification Service specifics (`main.bicep:1386-1533`)

Notification differs from the other three back-end services in four ways:

1. `transport: 'http'` instead of `'http2'`, SignalR WebSocket requires an HTTP/1.1 Upgrade
   handshake (`main.bicep:1406`), plus the extra internal-only h2c port 8081 for gRPC
   (`main.bicep:1413-1419`).
2. Its probe listener is on **8082** (`main.bicep:1450`), because the ADR-012 mixed profile already
   owns 8080 and 8081 and those two endpoints are load-bearing.
3. `maxReplicas: 1` (`main.bicep:1530`) rather than 2.
4. It is the only app that can receive the native-push env block, and only when the hub exists
   (`main.bicep:1485-1489`).

Its readiness probe (`main.bicep:1513-1521`) is what holds ACA ingress until the
`WarmupHostedService` has fetched the JWKS document from Identity. Without it, SignalR connections
made during warmup would fail because the JWT validator is not yet initialized.

#### Gateway specifics (`main.bicep:1535-1634`)

Gateway is the sole externally-reachable back-end entry point (`external: true`,
`allowInsecure: false`, `main.bicep:1556-1561`). It is a pure YARP reverse proxy: no DbContext, no
JWT issuing, no module, and `secrets: []` (`main.bicep:1563`). Its env configuration is entirely
service-discovery entries and CORS:

```bicep
{ name: 'Cors__AllowedOrigins__0', value: 'https://${prefix}-ui.${...defaultDomain}' }
```

CORS is scoped to exactly the UI's FQDN (`main.bicep:1577`), not a wildcard. Gateway is sized at
0.5 CPU / 1 Gi (`main.bicep:1570`) and uses the readiness gate at `main.bicep:1606-1614` because its
warmup involves establishing connections to all back-end services. It is also the target of the
availability web test described above.

#### UI specifics (`main.bicep:1636-1739`)

UI is the other externally-reachable app (`external: true`), also with `secrets: []`
(`main.bicep:1666`) and sized at 0.25 CPU / 0.5 Gi (`main.bicep:1673`). Two non-obvious
configuration points:

**Sticky sessions** (`main.bicep:1661-1663`):
```bicep
stickySessions: { affinity: 'sticky' }
```
Blazor Server runs the component model as a stateful SignalR circuit on the server. If a request
from a browser is load-balanced to a different replica than the one holding the circuit, the
circuit drops. Sticky session affinity pins each browser session to one replica.

**Dual API endpoints** (`main.bicep:1682-1684`):
```bicep
{ name: 'Api__ApiEndpoint',     value: 'http://${gatewayApp.name}' }
{ name: 'Api__WasmApiEndpoint', value: 'https://${gatewayApp.properties.configuration.ingress.fqdn}' }
```
Server-side Blazor rendering uses the internal Gateway URL (skipping public DNS, TLS termination,
and the Envoy round-trip). WebAssembly code running in the browser must use the external FQDN,
it has no access to the internal ACA DNS. The UI serves the WASM endpoint URL via a `/client-config`
endpoint so the WASM app can discover the gateway without the URL being baked into the WASM build.

The UI receives only the OAuth **client ids** when a provider is configured (`main.bicep:1686-1691`);
the client secrets stay on Identity, which is the app that completes the exchange.

### Outputs (`main.bicep:1741-1749`)

```bicep
output acrLoginServer     string = acr.properties.loginServer
output gatewayFqdn        string = gatewayApp.properties.configuration.ingress.fqdn
output uiFqdn             string = uiApp.properties.configuration.ingress.fqdn
output sqlServerFqdn      string = sqlServer.properties.fullyQualifiedDomainName
output serviceBusEndpoint string = serviceBus.properties.serviceBusEndpoint
output appInsightsName    string = appInsights.name
```

`gatewayFqdn` and `uiFqdn` are consumed by the smoke-test step (`deploy.yml:1099-1179`) to probe
the deployed revision. That step probes every service through the Gateway, and for the two
auth-gated endpoints the asserted status is exactly **401**, not 2xx: an anonymous request must be
rejected _by the service_, which only happens when the service is up and serving
(`deploy.yml:1130-1133`). On failure it rolls every app back to its previous revision and still
fails the job, and it reports separately when a rollback itself failed, so a partially rolled-back
fleet never looks like a clean auto-revert (`deploy.yml:1151-1178`).

`sqlServerFqdn` is an output of `main.bicep` (each service connects to its own
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

One honest caveat, recorded in
[ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html): the pipeline is
still a plaintext path. Values arrive as `@secure()` Bicep parameters written from GitHub secrets
into `/tmp/deploy-params.json` at deploy time (`deploy.yml:911-932`). The vault removes the
app-configuration copy of a secret, not the CI copy; rotating one still means rotating a GitHub
secret and redeploying.

---

## Rubric category cross-reference

| Rubric category | Where it appears in these files |
|---|---|
| §7 Microservices Readiness | Per-service databases ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)); service-discovery env vars (including the two named `grpc` endpoints); gRPC transport selection |
| §8 Data Architecture | Four per-service databases; LTR policies; AtlDevCon archive retention; EF model-drift gate in deploy.yml (migrations applied by services at startup) |
| §11 Security | UAMI/OIDC model; Key Vault-backed secrets ([ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)); `secrets: []` on Gateway and UI; `adminUserEnabled: false`; `@secure()` parameters; staged `useManagedIdentitySql`; no static credentials |
| §13 Observability | Workspace-based App Insights; per-service `OTEL_SERVICE_NAME`; Application Map coverage; SLO scheduled query rules + workbook ([ADR-062](https://ivanball.github.io/docs/adr/062-slo-alerting-as-code.html)); outbox dead-letter and SQL dependency alerts |
| §17 DevOps & Deployment | Two-phase Bicep split; Incremental mode; image sha-tagging + registry build cache; service-startup migration (sole migrator, minReplicas:1); smoke-test gate |
| §29 Resilience & Business Continuity | LTR on per-service databases; SLO alerts; sev-1 Gateway availability web test; smoke-test rollback; `minReplicas: 1`; readiness probes with a self-only liveness split |
| §31 Cost Efficiency / FinOps | `commonTags` on every resource; monthly budget with 80%/100% thresholds; `cost-guard.yml` surge-drift gate; workspace `dailyQuotaGb: 1`; 25% trace sampling; Warning OTel log floor; Basic-tier DB sizing; 300s outbox poll |

---

## Not determinable from source

- The exact `AcrPull` and `Key Vault Secrets User` role-assignment commands used in the out-of-
  band bootstrap are referenced in comments (`main.bicep:881-885`, `main.bicep:899-902`) but the
  commands themselves live in `infra/DISASTER-RECOVERY.md`, which is private to the ADC repo and out
  of scope for this chapter. A distilled version is published in the framework's reference runbook,
  `MMCA.Common/samples/deployment/DEPLOYMENT.md`.
- Whether the live deployment has set the `USE_MANAGED_IDENTITY_SQL`, `SQL_AAD_ADMIN_LOGIN` or
  `SQL_AAD_ADMIN_OID` repository variables is not visible in the repository: the template defaults
  are `false` and empty, and the values are GitHub repo variables. The same applies to
  `AZURE_RESOURCE_GROUP` and `AZURE_SQL_LOCATION`, whose fallbacks (`acc-rg`, `westus2`) appear only
  in workflow comments and defaults.
- The `azure/arm-deploy@v2` action's `deploymentMode` is not set explicitly in `deploy.yml`
  (`deploy.yml:773-779` for foundation, `deploy.yml:1070-1076` for main), the action defaults to
  Incremental, but this is not stated in the workflow file; it is inferred from the Incremental intent
  documented in the `main.bicep` comments and the ADC CLAUDE.md.
