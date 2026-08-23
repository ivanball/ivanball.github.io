# ADR-061: Runtime Secret Management via Key Vault References and Managed Identity

## Status
Accepted (2026-08-01; vault-backed configuration source recorded and citations re-anchored 2026-08-23).

## Context
A Container App can hold a credential two ways: as a literal value in the app's own `secrets`
collection, or as a reference to a Key Vault secret that the platform resolves at runtime through an
identity attached to the app. Both deployed consumers need many credentials: a per-service SQL
connection string (one per database, ADR-006), the Service Bus connection string, the Redis
connection string, RSA signing keys or the HS256 fallback, SMTP, plus per-app extras (OAuth client
secrets and an Anthropic key in ADC; Stripe secret and webhook keys in Store).

The literal form turns the deployment template into the distribution mechanism for every one of those
values and leaves a readable copy in each app's own configuration, where rotation means editing every
app that uses the value. Nothing in the record decided which form to use. ADR-037 tells a consumer to
keep its field-encryption key in Key Vault (`037-field-level-encryption-at-rest.md:108-110`) without
deciding how a running app reaches it; ADR-045 notes that blob storage authenticates with
`DefaultAzureCredential` and needs a data-plane role rather than a secret
(`045-managed-file-storage-and-avatars.md:23`, `:50`); ADR-053 decides publish-time identity. None of
them decides where a running app's credentials live. This record does, and it also records the staged
migration that is removing the last password from that set.

## Decision
Every production secret lives in Azure Key Vault and reaches the app as a `keyVaultUrl` secret
reference resolved by a user-assigned managed identity; the same identity also lets a host read the
vault directly as a configuration source at startup. SQL authentication is staged behind a flag on
its way to the same model.

- **The apps run as one shared user-assigned managed identity, referenced as `existing`.**
  `adc-prod-apps-identity` (`MMCA.ADC/infra/main.bicep:931-933`) and `mmca-prod-apps-identity`
  (`MMCA.Store/infra/main.bicep:772-774`). Every container app attaches it
  (`MMCA.ADC/infra/main.bicep:1036`, `:1243`, `:1372`, `:1501`, `:1667`, `:1770`;
  `MMCA.Store/infra/main.bicep:957`, `:1116`, `:1221`, `:1358`, `:1444`), and the same identity is
  the ACR pull credential, so no registry admin password exists either
  (`MMCA.ADC/infra/main.bicep:936-939`, `MMCA.Store/infra/main.bicep:777-780`).
- **The vault is referenced, not created; the deployment writes the values into it.** The template
  declares the vault as `existing` (`MMCA.ADC/infra/main.bicep:951-953`,
  `MMCA.Store/infra/main.bicep:860-862`) and then writes secret child resources: fourteen in ADC
  (`MMCA.ADC/infra/main.bicep:955-1024`) and eleven in Store
  (`MMCA.Store/infra/main.bicep:864-918`).
- **Every Container App secret entry is a `keyVaultUrl` reference bound to that identity.** ADC
  Identity (`MMCA.ADC/infra/main.bicep:1052-1067`), Conference (`:1259-1266`), Engagement
  (`:1388-1392`), Notification (`:1527-1535`); Store Identity
  (`MMCA.Store/infra/main.bicep:973-986`), Catalog (`:1132-1136`), Sales (`:1249-1260`). Not one entry
  carries an inline `value`. The two apps that need no credential say so explicitly: the Gateway and
  UI apps declare `secrets: []`
  (`MMCA.ADC/infra/main.bicep:1681`, `:1787`; `MMCA.Store/infra/main.bicep:1372`, `:1461`).
- **Containers consume secrets only through `secretRef`.** The SQL connection string
  (`MMCA.ADC/infra/main.bicep:1089`, `MMCA.Store/infra/main.bicep:1281`), the broker connection string
  (`MMCA.ADC/infra/main.bicep:1588`, `MMCA.Store/infra/main.bicep:1301`), the RSA private key and its
  HS256 fallback (`MMCA.ADC/infra/main.bicep:1170`, `:1177`; `MMCA.Store/infra/main.bicep:1067`,
  `:1074`), SMTP (`MMCA.ADC/infra/main.bicep:1180`, `:1608`; `MMCA.Store/infra/main.bicep:1077`,
  `:1328`), the OAuth client secrets (`MMCA.ADC/infra/main.bicep:1183`, `:1187`), the Anthropic key
  (`:1323`), the native-push hub connection string (`:1606`), and the two Stripe keys
  (`MMCA.Store/infra/main.bicep:1324-1325`).
- **A second, host-side path reads the same vault as a configuration source.** Alongside the
  platform-resolved references, both templates set `KeyVault__Uri` and `AZURE_CLIENT_ID` on every app
  whose host calls `AddCommonKeyVaultConfiguration`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:78-112`),
  which layers the vault over `IConfiguration` at startup. Store wires all five deployables through
  two shared env entries (`MMCA.Store/infra/main.bicep:932-935`, `:942-945`, used at `:1006-1007`,
  `:1154-1155`, `:1279-1280`, `:1392-1393`, `:1497-1498`); ADC wires five of its six apps, the four
  services and the UI but not the Gateway (`MMCA.ADC/infra/main.bicep:1148`, `:1156`; `:1320-1321`;
  `:1451-1452`; `:1597-1598`; `:1816`, `:1819`, documented at `:948-950`). The calls themselves sit
  in each host's `Program.cs`: Store `Identity.Service:48`, `Catalog.Service:41`, `Sales.Service:60`,
  `Gateway:50`, `UI.Web:41`; ADC `Identity.Service:119`, `Conference.Service:124`,
  `Engagement.Service:106`, `Notification.Service:109`, `UI.Web:38`. The call is
  gated on `KeyVault:Uri` and does nothing at all without it, so local runs and tests take no Azure
  dependency (`KeyVaultConfigurationExtensions.cs:80-88`). It authenticates with
  `DefaultAzureCredential` against the same Key Vault Secrets User grant the references already use,
  which is what makes `AZURE_CLIENT_ID` load-bearing: these apps carry only a user-assigned identity,
  so an unpinned client id fails the startup read (`MMCA.Store/infra/main.bicep:937-941`,
  `MMCA.ADC/infra/main.bicep:1149-1155`). Secret names map `--` onto the configuration separator
  (`KeyVaultConfigurationExtensions.cs:43-48`, `:109`), and no secret in either vault carries `--`
  today, so this adds a source without re-pointing any setting the apps already bind
  (`MMCA.Store/infra/main.bicep:925-928`).
- **Composite connection strings are assembled at deploy time and land only in the vault.** The Redis
  string embeds a key read with `listKeys()` (`MMCA.ADC/infra/main.bicep:906`,
  `MMCA.Store/infra/main.bicep:747`), the broker string comes from a dedicated `app-clients` SAS rule
  rather than the namespace root (`MMCA.ADC/infra/main.bicep:161-164`,
  `MMCA.Store/infra/main.bicep:135-138`), and the per-database SQL strings are composed from a shared
  base (`MMCA.ADC/infra/main.bicep:152-159`, `MMCA.Store/infra/main.bicep:127-133`). All of them are
  written straight into vault secrets, so the assembled value never appears in app configuration.
- **An unconfigured optional secret gets a placeholder, not a missing entry.** Optional values are
  written as the literal `unused` when their parameter is empty (`MMCA.ADC/infra/main.bicep:993`,
  `:998`, `:1003`, `:1008`, `:1013`, `:1018`, `:1023`; `MMCA.Store/infra/main.bicep:892`, `:897`,
  `:902`, `:907`, `:912`, `:917`), while the app-side reference is conditional (for example
  `hasSmtpPassword` at `MMCA.ADC/infra/main.bicep:1064` and `hasStripe` at
  `MMCA.Store/infra/main.bicep:1255-1258`), so the vault entry always exists but an unconfigured
  feature is simply absent from the app.
- **The two role assignments are bootstrapped out of band, deliberately.** The deploy identity holds
  Key Vault Secrets Officer to write the values; the apps hold Key Vault Secrets User to read them;
  the vault and both grants are created outside the template because the deploy principal has
  Contributor without role-assignment-write (`MMCA.ADC/infra/main.bicep:944-950`,
  `MMCA.Store/infra/main.bicep:856-859`). It is the same least-privilege posture that keeps ADR-045's
  avatar-storage grant behind a default-false flag (`MMCA.ADC/infra/main.bicep:112-113`, `:851-859`).
  The bootstrap commands are written out in the framework's reference runbook
  (`MMCA.Common/samples/deployment/DEPLOYMENT.md:14-35`).
- **SQL authentication is staged behind `useManagedIdentitySql`, and the stage is additive.** The
  parameter defaults to `false` (`MMCA.ADC/infra/main.bicep:36`, `MMCA.Store/infra/main.bicep:26`)
  and selects one of two auth segments for the connection-string base:
  `Authentication=Active Directory Managed Identity` with the identity's client id, or the SQL login
  plus password (`MMCA.ADC/infra/main.bicep:152-154`, `MMCA.Store/infra/main.bicep:127-129`). The
  Entra admin the flip depends on is provisioned only when its object id is supplied and does not set
  `azureADOnlyAuthentication`, so password login keeps working during the transition
  (`MMCA.ADC/infra/main.bicep:617-632`, `MMCA.Store/infra/main.bicep:565-580`). The pipeline exposes
  the same three stages: supply the Entra admin, run the per-database external-provider grants by
  hand, then set the flag (`MMCA.ADC/.github/workflows/deploy.yml:1050-1068`,
  `MMCA.Store/.github/workflows/deploy.yml:1015-1033`), driven by repository variables that are
  absent by default (`MMCA.ADC/.github/workflows/deploy.yml:930-932`).

**Adoption boundary.** The secret-reference half is shipped and identical in both deployed apps, and
the configuration-source half is shipped in both with one difference: Store wires its Gateway
(`MMCA.Store/infra/main.bicep:1392-1393`) while ADC's Gateway carries neither variable. The SQL half
is staged in both and not flipped in either template default, so with the default parameters every
app-to-database connection string still carries `User ID` and `Password`
(`MMCA.ADC/infra/main.bicep:154`, `MMCA.Store/infra/main.bicep:129`). That password is itself a vault
secret and never app configuration, so what remains is a shared SQL login, not an exposed one.
Whether a given deployment has already set the `USE_MANAGED_IDENTITY_SQL` repository variable is not
determinable from source. MMCA.Common carries the posture as a reference sample rather than a
deployment: `MMCA.Common/samples/deployment/main.bicep:65-76` creates an RBAC-authorized vault,
`:123-132` attaches the identity for both ACR pull and secret reads, and `:143` reads the connection
string through a `secretRef`. The sample is illustrative, not deployable as written: it declares no
`secrets` entry for that `secretRef` and writes no secret into the vault it creates, and CI only
type-checks it (`MMCA.Common/.github/workflows/ci.yml:595-609`), so nothing catches the gap.
MMCA.Helpdesk has no `infra/` directory and no deploy workflow at all: its four workflows are
`ci.yml`, the two Claude ones (`claude.yml`, `claude-code-review.yml`), and `release-templates.yml`,
which packages and publishes the `MMCA.Templates` dotnet-new pack rather than any infrastructure. So
there is nothing for it to adopt. This mirrors how ADR-018 and ADR-020 record partial adoption: the mechanism is decided, the
consumer-by-consumer state is named.

## Rationale
- **A reference has one home; a literal has as many homes as it has consumers.** Three vault secrets
  in each repo are referenced by more than one app: Redis and the broker by all four ADC services
  (`MMCA.ADC/infra/main.bicep:1055-1056`, `:1262-1263`, `:1390-1391`, `:1530-1531`) and all three
  Store services (`MMCA.Store/infra/main.bicep:976-977`, `:1134-1135`, `:1252-1253`), and the SMTP
  password by two apps in each (`MMCA.ADC/infra/main.bicep:1064`, `:1534`;
  `MMCA.Store/infra/main.bicep:985`, `:1259`). As references they are one vault entry pointed at from
  several apps; as literals they would be several copies to keep in step.
- **Reuse the identity that already existed.** The user-assigned identity was introduced to pull
  images from ACR without the registry admin password
  (`MMCA.ADC/infra/main.bicep:926-930`, `MMCA.Store/infra/main.bicep:767-771`). Granting it Key Vault
  Secrets User extends one principal rather than introducing a second credential-holding model, and
  leaves one thing to audit.
- **Keeping the grants out of the template is what keeps the deploy identity least-privileged.** A
  template that created its own role assignments would need role-assignment-write on the deploy
  principal, which is exactly the permission the deployment deliberately does not have.
- **Additive staging makes the SQL migration reversible.** The Entra admin does not disable password
  login and the flag defaults off, so stage 1 changes nothing observable, and the rollback from a bad
  flip is the same one parameter. A big-bang switch to Entra-only auth would have no way back if the
  per-database grants were wrong.

## Trade-offs
- **One identity means vault-wide read for every app that carries it.** A Key Vault Secrets User grant
  is scoped to the vault, so any app running as the shared identity can read every secret in it, not
  only the ones its own `secrets` list names. Per-app identities would narrow that at the cost of
  several more out-of-band bootstraps.
- **The template alone does not stand up an environment.** The vault, the identity, its AcrPull grant
  and both Key Vault roles must already exist; `main.bicep` references them
  (`MMCA.ADC/infra/main.bicep:931-933`, `:951-953`) and cannot report that a grant is missing. The
  prerequisites live in each repo's private `infra/DISASTER-RECOVERY.md` and, in distilled form, in
  `MMCA.Common/samples/deployment/DEPLOYMENT.md:14-35`.
- **The pipeline is still a plaintext path.** Values arrive as `@secure()` bicep parameters written
  from GitHub secrets into a parameters file at deploy time
  (`MMCA.ADC/.github/workflows/deploy.yml:911-932`). The vault removes the app-configuration copy, not
  the CI copy; rotating a secret still means rotating a GitHub secret and redeploying.
- **The `unused` placeholder makes the vault a poor inventory.** A secret written as `unused` is
  indistinguishable in the vault from a configured one; only the app's `secrets` list says which
  credentials are actually live.
- **Two literal values remain in the template.** The Application Insights connection string is an
  ordinary env var (`MMCA.ADC/infra/main.bicep:200-203`, `MMCA.Store/infra/main.bicep:174-177`) and the
  Log Analytics shared key is passed inline to the managed environment
  (`MMCA.ADC/infra/main.bicep:911-922`, `MMCA.Store/infra/main.bicep:752-765`). Both are telemetry
  ingestion keys read with `listKeys()` at deploy time, not application credentials, and neither is
  covered by this decision.
- **The host-side vault read is a hard startup dependency.** The configuration source is added
  synchronously in the host builder, so a vault read that cannot authenticate (an unpinned
  `AZURE_CLIENT_ID` is the documented case) crash-loops the app rather than degrading one feature
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:63-69`,
  `MMCA.Store/infra/main.bicep:938-941`). Neither template sets `KeyVault:ReloadIntervalMinutes`, so
  the vault is read once at startup and a rotated secret reaches those hosts on their next restart
  (`KeyVaultConfigurationExtensions.cs:37-39`, `:96-107`).
- **The staged SQL half is inert until an operator acts.** Until the per-database
  `CREATE USER ... FROM EXTERNAL PROVIDER` grants are run and the flag is set, the shared SQL admin
  login is still what every service authenticates with, so password rotation is deferred rather than
  solved. Same audit-the-inventory caveat as ADR-018 and ADR-020.

## Related
ADR-037 (`037-field-level-encryption-at-rest.md:108-110` directs a consumer to keep the
field-encryption key in Key Vault but decides no delivery
mechanism, and nothing wires that converter today, so no such secret exists in either vault),
ADR-045 (the identity model one layer out: blob access is a data-plane role on the same identity
instead of a secret, which is why its grant carries the same out-of-band caveat), ADR-053 (the
publish-time half of the same no-stored-credential posture: keyless OIDC to nuget.org, build identity
rather than runtime identity), ADR-006 (database per service is why there is one SQL connection-string
secret per service rather than one shared string).
