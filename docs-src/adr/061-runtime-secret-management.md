# ADR-061: Runtime Secret Management via Key Vault References and Managed Identity

## Status
Accepted (2026-08-01; vault-backed configuration source recorded and citations re-anchored 2026-08-23;
gateway synthetic-traffic secret recorded and citations re-anchored 2026-09-03).
Revised 2026-09-07 (each service gets its own Service Bus SAS rule instead of sharing one
namespace-wide rule, and ADC gained parameterized Data Protection key-ring posture knobs).
Revised 2026-09-11: secret counts re-measured (nineteen in ADC, fourteen in Store), the trusted-caller
key recorded on both Gateways and both UI apps so no deployable is credential-free any more, the
MMCA.Common reference sample recorded as complete, and every `main.bicep`, `deploy.yml` and
`Program.cs` citation re-anchored.
Revised 2026-09-10: ADC's Gateway reads the vault as a configuration source like every other deployable.
Revised 2026-10-01: citations re-anchored and Store's Data Protection key-ring knobs recorded.
Revised 2026-10-06: ADC's storage Shared Key parameter is no longer documented as required by any consumer, and every citation is re-anchored.
Revised 2026-10-07: Key Vault purge protection is recorded as prescribed by both out-of-band vault bootstrap runbooks rather than open, the reference sample's vault write is pinned to its own resource, and every moved ADC citation (plus four Store and Common ones) is re-anchored.
Revised 2026-10-19: Store's vault holds fifteen secrets, one of them the HS256 gRPC service-token key named with `--`, so the HS256 and `--` statements are corrected and the identity, vault and secret-block anchors re-pointed.
Revised 2026-10-21: anchors refreshed after the ADC and Store `main.bicep` and `deploy.yml` growth, with every remaining Decision, Rationale and Trade-offs line anchor re-verified; no decision changed.
Revised 2026-10-24: the host-side vault read is `AddAzureKeyVaultConfiguration()` in MMCA.Common.Azure, configuration keys unchanged ([ADR-134](134-cloud-neutral-core-vendor-adapters.md)); framework anchors in Decision and Trade-offs corrected in place. See Revision (2026-10-24) at the end.
Revised 2026-10-25: two more vault-as-configuration sources, `AddAwsSecretsManagerConfiguration()` (MMCA.Common.Aws) and `AddGoogleSecretManagerConfiguration()` (MMCA.Common.Gcp), with the Key Vault `--` naming rule and tripwire coverage; the Revision (2026-10-24) item 3 is superseded. See Revision (2026-10-25) at the end.
## Context
A Container App can hold a credential two ways: as a literal value in the app's own `secrets`
collection, or as a reference to a Key Vault secret that the platform resolves at runtime through an
identity attached to the app. Both deployed consumers need many credentials: a per-service SQL
connection string (one per database, ADR-006), a per-service Service Bus connection string, the Redis
connection string, the RSA signing pair, SMTP, plus per-app extras (OAuth client secrets and an
Anthropic key in ADC; Stripe secret and webhook keys in Store; a gateway synthetic-traffic bypass key
and a trusted-caller key in both).

The literal form turns the deployment template into the distribution mechanism for every one of those
values and leaves a readable copy in each app's own configuration, where rotation means editing every
app that uses the value. Nothing in the record decided which form to use. ADR-037 tells a consumer to
keep its field-encryption key in Key Vault (`037-field-level-encryption-at-rest.md:108-110`) without
deciding how a running app reaches it; ADR-045 notes that blob storage authenticates with
`DefaultAzureCredential` and needs a data-plane role rather than a secret
(`045-managed-file-storage-and-avatars.md:29`, `:58-59`); ADR-053 decides publish-time identity. None of
them decides where a running app's credentials live. This record does, and it also records the staged
migration that is removing the last password from that set.

## Decision
Every production secret lives in Azure Key Vault and reaches the app as a `keyVaultUrl` secret
reference resolved by a user-assigned managed identity; the same identity also lets a host read the
vault directly as a configuration source at startup. SQL authentication is staged behind a flag on
its way to the same model.

- **The apps run as one shared user-assigned managed identity, referenced as `existing`.**
  `adc-prod-apps-identity` (`MMCA.ADC/infra/main.bicep:1647-1649`) and `mmca-prod-apps-identity`
  (`MMCA.Store/infra/main.bicep:1219-1221`). Every container app attaches it
  (`MMCA.ADC/infra/main.bicep:1832`, `:2085`, `:2238`, `:2373`, `:2563`, `:2726`;
  `MMCA.Store/infra/main.bicep:1515`, `:1697`, `:1821`, `:1973`, `:2102`), and the same identity is
  the ACR pull credential, so no registry admin password exists either
  (`MMCA.ADC/infra/main.bicep:1652-1655`, `MMCA.Store/infra/main.bicep:1224-1227`).
- **The vault is referenced, not created; the deployment writes the values into it.** The template
  declares the vault as `existing` (`MMCA.ADC/infra/main.bicep:1668-1670`,
  `MMCA.Store/infra/main.bicep:1340-1342`) and then writes secret child resources: nineteen in ADC
  (`MMCA.ADC/infra/main.bicep:1716-1820`) and fifteen in Store
  (`MMCA.Store/infra/main.bicep:1367-1454`).
- **Every Container App secret entry is a `keyVaultUrl` reference bound to that identity.** ADC
  Identity (`MMCA.ADC/infra/main.bicep:1850-1859`), Conference (`:2103-2107`), Engagement
  (`:2255-2257`), Notification (`:2401-2406`); Store Identity
  (`MMCA.Store/infra/main.bicep:1533-1540`), Catalog (`:1714-1716`), Sales (`:1851-1860`). Not one
  entry carries an inline `value`. Each Gateway carries at most two, both conditional: the
  synthetic-traffic bypass key its edge rate limiter checks (ADR-088) and the trusted-caller key,
  written as the same `keyVaultUrl` reference and gated on `hasSyntheticTrafficSecret` and
  `hasTrustedCallerSecret`, so the list is empty when both parameters are unset
  (`MMCA.ADC/infra/main.bicep:2582`, `:2587`; `MMCA.Store/infra/main.bicep:1993`, `:1996`). The UI
  apps carry one conditional entry each, the same trusted-caller key the Gateway checks
  (`MMCA.ADC/infra/main.bicep:2747`, `MMCA.Store/infra/main.bicep:2120`), so no deployable is
  credential-free today.
- **Containers consume secrets only through `secretRef`.** The SQL connection string
  (`MMCA.ADC/infra/main.bicep:1887`, `MMCA.Store/infra/main.bicep:1569`), the broker connection string
  (`MMCA.ADC/infra/main.bicep:1948`, `MMCA.Store/infra/main.bicep:1602`), the RSA signing pair (the
  private key the issuer signs with, the public key its in-process validation and its JWKS endpoint
  publish: `MMCA.ADC/infra/main.bicep:1985-1986`, `:1989`; `MMCA.Store/infra/main.bicep:1650-1651`,
  `:1654`), SMTP (`MMCA.ADC/infra/main.bicep:1991`, `:2490`; `MMCA.Store/infra/main.bicep:1658`,
  `:1943`), the OAuth client secrets (`MMCA.ADC/infra/main.bicep:1994`, `:1998`, `:2004`), the
  Anthropic key (`:2189`), the native-push hub connection string (`:2488`), the gateway
  synthetic-traffic bypass key (`:2640`, `MMCA.Store/infra/main.bicep:2047`), the trusted-caller key
  (`MMCA.ADC/infra/main.bicep:2647`, `:2806`; `MMCA.Store/infra/main.bicep:2053`, `:2178`), and the
  two Stripe keys (`MMCA.Store/infra/main.bicep:1939-1940`). RSA is the only user-token signing key material
  either template provisions: production signs user tokens with RS256 (ADR-004). The one HS256 key is
  Store's east-west gRPC service-token key (`MMCA.Store/infra/main.bicep:1418-1421`, rationale
  `:1414-1417`; HS256 by design in
  `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenSettings.cs:13`),
  delivered to Identity and Sales through the same `keyVaultUrl` reference (`:1538`, `:1854`) and
  bound as `Grpc__ServiceToken__SigningKey` (`:1656`, `:1923`). ADC holds no HS256 secret.
- **A second, host-side path reads the same vault as a configuration source.** Alongside the
  platform-resolved references, both templates set `KeyVault__Uri` and `AZURE_CLIENT_ID` on every app
  whose host calls `AddAzureKeyVaultConfiguration`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureKeyVaultConfigurationExtensions.cs:80-118`),
  which layers the vault over `IConfiguration` at startup. Store wires all five deployables through
  two shared env entries (`MMCA.Store/infra/main.bicep:1490`, `:1500`, used at `:1563-1564`,
  `:1745-1746`, `:1882-1883`, `:2029-2030`, `:2161-2162`); ADC writes the pair inline on each of its
  six apps (`MMCA.ADC/infra/main.bicep:1960`, `:1968`; `:2177-2178`; `:2321-2322`; `:2479-2480`;
  `:2633-2634`; `:2780`, `:2783`, documented at `:1664-1667`). The calls themselves sit
  in each host's `Program.cs`: Store `Identity.Service:51`, `Catalog.Service:46`, `Sales.Service:63`,
  `Gateway:63`, `UI.Web:44`; ADC `Identity.Service:111`, `Conference.Service:114`,
  `Engagement.Service:95`, `Notification.Service:98`, `Gateway:67`, `UI.Web:61`. The call is
  gated on `KeyVault:Uri` and does nothing at all without it, so local runs and tests take no Azure
  dependency (`AzureKeyVaultConfigurationExtensions.cs:86-94`). It authenticates with
  `DefaultAzureCredential` against the same Key Vault Secrets User grant the references already use,
  which is what makes `AZURE_CLIENT_ID` load-bearing: these apps carry only a user-assigned identity,
  so an unpinned client id fails the startup read (`MMCA.Store/infra/main.bicep:1495-1499`,
  `MMCA.ADC/infra/main.bicep:2628-2632`). Secret names map `--` onto the configuration separator
  (`AzureKeyVaultConfigurationExtensions.cs:46-47`, `:115`). Exactly one secret carries `--`, and on
  purpose: Store's `Grpc--ServiceToken--SigningKey` (`MMCA.Store/infra/main.bicep:1420`) is named so
  that it maps onto `Grpc:ServiceToken:SigningKey`, the same key its `keyVaultUrl` reference binds,
  so both paths agree on one value. No ADC secret carries `--` (`MMCA.ADC/infra/main.bicep:1716-1820`),
  so in ADC this adds a source without re-pointing any setting the apps already bind.
- **The same host-side source exists for AWS and Google Cloud, with the Key Vault naming rule.** Each
  is an opt-in adapter call that does nothing without its gate and leaves a startup-tripwire marker
  when it runs. AWS is `AddAwsSecretsManagerConfiguration()`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsSecretsManagerConfigurationExtensions.cs:82`), gated
  on `SecretsManager:NamePrefix` (read at `:85`, a no-op when blank at `:91`-`:94`, marker at `:125`),
  with optional `Region`, `ServiceUrl`, `AccessKeyId` + `SecretAccessKey` and `ReloadIntervalMinutes`
  (`:41`-`:49`). Its provider lists the secrets under the prefix and reads them with
  `BatchGetSecretValue` in chunks of 20
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Secrets/AwsSecretsManagerConfigurationProvider.cs:30`,
  `:137`-`:140`), and a secret it cannot read fails startup, naming it (`:183`-`:189`). It carries one
  VSTHRD002 pragma: `ConfigurationProvider.Load` is synchronous and the AWS SDK v4 client is async
  only, so the first read blocks once during host construction (`:74`-`:80`). Google is
  `AddGoogleSecretManagerConfiguration()`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GoogleSecretManagerConfigurationExtensions.cs:82`), gated
  on both `GoogleSecretManager:ProjectId` and `GoogleSecretManager:NamePrefix` (`:85`-`:86`, a no-op
  when either is blank at `:92`-`:95`, marker at `:116`), with an optional `ReloadIntervalMinutes`
  (`:42`-`:44`). It reads the latest enabled version of each secret
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Secrets/GoogleSecretManagerConfigurationProvider.cs:195`,
  `:203`-`:206`, `:210`) through the client's synchronous methods, so it needs no blocking wait on a
  task (`:24`-`:25`, the list call at `:162`). Both map names the Key Vault way, stripping the prefix
  and mapping `--` to `:` (`AwsSecretsManagerConfigurationProvider.cs:61`-`:69`,
  `GoogleSecretManagerConfigurationProvider.cs:74`-`:82`), so one secret set moves between clouds by
  renaming its prefix. The tripwire checks both prefixes: `SecretsManager:NamePrefix` or
  `GoogleSecretManager:NamePrefix` set without its call fails `ValidateOnStart`, naming it
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:29`, `:40`,
  `:78`-`:82`, `:88`-`:92`). SQL Server on RDS and on Cloud SQL has no IAM database authentication,
  and the framework's IAM adapters cover PostgreSQL only
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Rds/RdsIamAuthenticationConfigurator.cs:12`,
  `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/CloudSql/CloudSqlIamAuthenticationConfigurator.cs:9`),
  so a SQL Server host on RDS carries a password connection string held in Secrets Manager
  (`MMCA.Common/CHANGELOG.md:15`), and on Cloud SQL either a password connection string from Secret
  Manager or, on SQL Server 2022 and later, Microsoft Entra ID through the SqlClient extension in
  MMCA.Common.Azure (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:80-83`).
- **Composite connection strings are assembled at deploy time and land only in the vault.** The Redis
  string embeds a key read with `listKeys()` (`MMCA.ADC/infra/main.bicep:1615`,
  `MMCA.Store/infra/main.bicep:1194`), each broker string comes from that service's own SAS rule
  rather than the namespace root (`MMCA.ADC/infra/main.bicep:231-234`,
  `MMCA.Store/infra/main.bicep:163-165`), and the per-database SQL strings are composed from a shared
  base (`MMCA.ADC/infra/main.bicep:218-225`, `MMCA.Store/infra/main.bicep:150-156`). All of them are
  written straight into vault secrets, so the assembled value never appears in app configuration.
- **An unconfigured optional secret gets a placeholder, not a missing entry.** Seven ADC values and
  five Store values are written as the literal `unused` when their parameter is empty
  (`MMCA.ADC/infra/main.bicep:1782`, `:1789`, `:1799`, `:1804`, `:1809`, `:1814`, `:1819`;
  `MMCA.Store/infra/main.bicep:1426`, `:1431`, `:1436`, `:1444`, `:1453`), while the app-side
  reference is conditional (for example `hasSmtpPassword` at `MMCA.ADC/infra/main.bicep:1856` and
  `MMCA.Store/infra/main.bicep:1860`), so the vault entry always exists but an unconfigured
  feature is simply absent from the app.
- **The two role assignments are bootstrapped out of band, deliberately.** The deploy identity holds
  Key Vault Secrets Officer to write the values; the apps hold Key Vault Secrets User to read them;
  the vault and both grants are created outside the template because the deploy principal has
  Contributor without role-assignment-write (out-of-band notes at `MMCA.ADC/infra/main.bicep:1660-1663`
  and `MMCA.Store/infra/main.bicep:1336-1339`; the Contributor reason at
  `MMCA.ADC/infra/main.bicep:1644-1645` and `MMCA.Store/infra/main.bicep:1216-1217`). It is the same least-privilege posture that keeps ADR-045's
  avatar-storage grant behind a default-false flag (`MMCA.ADC/infra/main.bicep:133`, `:1512`).
  The bootstrap commands are written out in the framework's reference runbook
  (`MMCA.Common/samples/deployment/DEPLOYMENT.md:14-36`).
- **SQL authentication is staged behind `useManagedIdentitySql`, and the stage is additive.** The
  parameter defaults to `false` (`MMCA.ADC/infra/main.bicep:36`, `MMCA.Store/infra/main.bicep:26`)
  and selects one of two auth segments for the connection-string base:
  `Authentication=Active Directory Managed Identity` with the identity's client id, or the SQL login
  plus password (`MMCA.ADC/infra/main.bicep:218-220`, `MMCA.Store/infra/main.bicep:150-152`). The
  Entra admin the flip depends on is provisioned only when its object id is supplied and does not set
  `azureADOnlyAuthentication`, so password login keeps working during the transition
  (`MMCA.ADC/infra/main.bicep:996-1011`, `MMCA.Store/infra/main.bicep:887-902`). The pipeline exposes
  the same three stages: supply the Entra admin, run the per-database external-provider grants by
  hand, then set the flag (`MMCA.ADC/.github/workflows/deploy.yml:1401-1419`,
  `MMCA.Store/.github/workflows/deploy.yml:1299-1317`), driven by repository variables that are
  absent by default (`MMCA.ADC/.github/workflows/deploy.yml:1244-1246`,
  `MMCA.Store/.github/workflows/deploy.yml:1182-1184`).

**Adoption boundary.** The secret-reference half is shipped and identical in both deployed apps, and
the configuration-source half is now shipped on every deployable in both (see the 2026-09-10 revision;
the Gateway difference recorded here is closed). The SQL half
is staged in both and not flipped in either template default, so with the default parameters every
app-to-database connection string still carries `User ID` and `Password`
(`MMCA.ADC/infra/main.bicep:220`, `MMCA.Store/infra/main.bicep:152`). That password is itself a vault
secret and never app configuration, so what remains is a shared SQL login, not an exposed one.
Whether a given deployment has already set the `USE_MANAGED_IDENTITY_SQL` repository variable is not
determinable from source. MMCA.Common carries the posture as a reference sample rather than a
deployment: `MMCA.Common/samples/deployment/main.bicep:69-78` creates an RBAC-authorized vault, `:105`
composes the SQL connection string and `:107-111` writes it into the vault, `:138-141` and `:147` attach the identity for both secret
reads and ACR pull, `:152` declares the matching `keyVaultUrl` secret entry, and `:164` reads it
through a `secretRef`. The sample now closes the loop it used to leave open, and CI type-checks it on
every pull request that changes code; a docs-only PR skips both compile steps
(`MMCA.Common/.github/workflows/ci.yml:717-723`, gated at `:718`, `:722`).
MMCA.Helpdesk has no `infra/` directory and no deploy workflow at all: its four workflows are
`ci.yml`, the two Claude ones (`claude.yml`, `claude-code-review.yml`), and `release-templates.yml`,
which packages and publishes the `MMCA.Templates` dotnet-new pack rather than any infrastructure. So
there is nothing for it to adopt. This mirrors how ADR-018 and ADR-020 record partial adoption: the mechanism is decided, the
consumer-by-consumer state is named.

## Rationale
- **A reference has one home; a literal has as many homes as it has consumers.** Three vault secrets
  in each repo are referenced by more than one app: Redis by all four ADC services
  (`MMCA.ADC/infra/main.bicep:1851`, `:2104`, `:2256`, `:2402`) and all three Store services
  (`MMCA.Store/infra/main.bicep:1534`, `:1715`, `:1852`), the SMTP password by two apps in each
  (`MMCA.ADC/infra/main.bicep:1856`, `:2406`; `MMCA.Store/infra/main.bicep:1540`, `:1860`), and the
  trusted-caller key by the Gateway that checks it and the UI that presents it
  (`MMCA.ADC/infra/main.bicep:2587`, `:2747`; `MMCA.Store/infra/main.bicep:1996`, `:2120`). As
  references they are one vault entry pointed at from several apps; as literals they would be several
  copies to keep in step. The broker string is deliberately not on that list: since the 2026-09-07
  revision each service reads its own.
- **Reuse the identity that already existed.** The user-assigned identity was introduced to pull
  images from ACR without the registry admin password
  (`MMCA.ADC/infra/main.bicep:1642-1646`, `MMCA.Store/infra/main.bicep:1214-1218`). Granting it Key Vault
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
  (`MMCA.ADC/infra/main.bicep:1647-1649`, `:1668-1670`) and cannot report that a grant is missing. The
  prerequisites live in each repo's private `infra/DISASTER-RECOVERY.md` and, in distilled form, in
  `MMCA.Common/samples/deployment/DEPLOYMENT.md:14-36`.
- **The pipeline is still a plaintext path.** Values arrive as `@secure()` bicep parameters written
  from GitHub secrets into a parameters file at deploy time
  (`MMCA.ADC/.github/workflows/deploy.yml:1218-1249` maps them into the step environment and
  `:1277-1305` writes the file, RSA keys appended at `:1309-1312`). The vault removes the app-configuration copy, not
  the CI copy; rotating a secret still means rotating a GitHub secret and redeploying.
- **The `unused` placeholder makes the vault a poor inventory.** A secret written as `unused` is
  indistinguishable in the vault from a configured one; only the app's `secrets` list says which
  credentials are actually live.
- **Two literal values remain in the template.** The Application Insights connection string is an
  ordinary env var (`MMCA.ADC/infra/main.bicep:270-273`, `MMCA.Store/infra/main.bicep:201-204`) and the
  Log Analytics shared key is passed inline to the managed environment
  (`MMCA.ADC/infra/main.bicep:1627-1640`, `MMCA.Store/infra/main.bicep:1199-1212`). Both are telemetry
  ingestion keys resolved at deploy time, not application credentials, and neither is covered by this
  decision: the connection string is read from the Application Insights resource's
  `properties.ConnectionString` (`MMCA.ADC/infra/main.bicep:272`, `MMCA.Store/infra/main.bicep:203`),
  and only the shared key comes from `listKeys()` (`MMCA.ADC/infra/main.bicep:1636`,
  `MMCA.Store/infra/main.bicep:1208`).
- **The host-side vault read is a hard startup dependency.** The configuration source is added
  synchronously in the host builder, so a vault read that cannot authenticate (an unpinned
  `AZURE_CLIENT_ID` is the documented case) crash-loops the app rather than degrading one feature
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureKeyVaultConfigurationExtensions.cs:67-68`,
  `MMCA.Store/infra/main.bicep:1495-1499`). Neither template sets `KeyVault:ReloadIntervalMinutes`, so
  the vault is read once at startup and a rotated secret reaches those hosts on their next restart
  (`AzureKeyVaultConfigurationExtensions.cs:39-40`, `:102-113`).
- **The staged SQL half is inert until an operator acts.** Until the per-database
  `CREATE USER ... FROM EXTERNAL PROVIDER` grants are run and the flag is set, the shared SQL admin
  login is still what every service authenticates with, so password rotation is deferred rather than
  solved. Same audit-the-inventory caveat as ADR-018 and ADR-020.

## Revision (2026-09-07)
Two changes from the 2026-09-07 security review.

1. **Per-service Service Bus SAS rules** (SEC-ADC-26 / SEC-Store-38). One namespace-wide rule shared
   by every service means any one compromised service holds every other service's rights on the
   broker, and rotating it is an all-services outage. Both templates now declare a rule per service
   and no namespace-wide shared credential at all: ADC has Identity, Conference, Engagement and
   Notification rules (`MMCA.ADC/infra/main.bicep:965`, `:977`, `:989`, `:1001`, stated at
   `:196-197`), and Store has Catalog, Sales and Identity rules
   (`MMCA.Store/infra/main.bicep:988`, `:1000`, `:1012`, stated at `:150-154`).
   Each service's connection string is sourced from its own rule, so a rotation is scoped to one
   service and a leaked credential names its holder.
2. **Data Protection key-ring posture is parameterized in ADC** (SEC-ADC-12 / SEC-ADC-48). The key
   ring is persisted to blob storage (`MMCA.ADC/infra/main.bicep:1582`, application name at `:1583`),
   which by itself leaves it unencrypted at rest. Encrypting it needs three independently reversible
   steps, because the middle one is a role assignment the deploy identity deliberately lacks
   (the same restriction as `grantAvatarStorageRole`): `createDataProtectionKeyVaultKey` mints the
   key (`:139`, resource at `:1343`), an operator grants the apps identity **Key Vault Crypto User**
   on it by hand, and only then does `dataProtectionKeyVaultKeyUri` (`:142`) switch the hosts over
   (`hasDataProtectionKek` at `:160`, env var at `:1637-1638`). With the URI set and the role
   missing, the Identity and UI hosts fail to wrap the key ring and authentication breaks, which is
   why the knobs are separate and both default off. The storage account's Shared Key posture is a
   third parameter (`:136`), documented as still required by the disaster-recovery bacpac path.

**Not changed here:** Key Vault purge protection is not enabled by either template as of this
revision.

## Revision (2026-09-10)

**ADC's Gateway now reads the vault like every other deployable, closing the one adoption difference
above.** `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:66` calls
`builder.AddCommonKeyVaultConfiguration()`, matching `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:63`,
and ADC's template supplies the two variables the call needs on the `gatewayApp` container
(`MMCA.ADC/infra/main.bicep:2140`): `AZURE_CLIENT_ID` at `:2213` and `KeyVault__Uri` at `:2214`. All
six ADC apps and all five Store apps now carry both.

The two templates supply them differently and that is presentation, not posture: ADC writes the pair
inline in each app's env array, while Store spreads shared variables (`keyVaultUriEnv` at
`MMCA.Store/infra/main.bicep:1355` and `azureClientIdEnv` at `:1365`, used on the gateway at `:1865`
and `:1866`). The behaviour is identical either way, because the call is gated on `KeyVault:Uri` and
is inert without it.

Worth restating rather than assuming: this makes the vault a synchronous, hard startup dependency for
the Gateway too. `AddCommonKeyVaultConfiguration`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:78`)
reads at startup, so a vault outage or a revoked Secrets User grant is now a Gateway crash-loop rather
than a degraded backend. That is the same trade the other five apps already made, taken deliberately.

## Revision (2026-10-01)
No decision or rationale changed. Every `main.bicep`, `deploy.yml`, `Program.cs`, sample and CI
citation in the sections above is re-anchored, and the secret counts (nineteen in ADC, fourteen in
Store) and placeholder counts (seven and five) re-measured unchanged. Two statements are corrected in
place: the Application Insights connection string is read from the resource's
`properties.ConnectionString`, not `listKeys()`, which only the Log Analytics shared key uses
(`MMCA.ADC/infra/main.bicep:245`, `:1435`); and the reference-sample validation runs on every pull
request that changes code rather than on every run, since `ci.yml` is PR-only and gates both compile
steps on `needs.changes.outputs.code` (`MMCA.Common/.github/workflows/ci.yml:830`, `:834`). One
omission is recorded: Store now carries the same Data Protection key-ring knobs the 2026-09-07
revision lists for ADC (`grantDataProtectionStorageRole` at `MMCA.Store/infra/main.bicep:94`,
`dataProtectionStorageReady` at `:97`, `createDataProtectionKeyVaultKey` at `:100`,
`dataProtectionKeyVaultKeyUri` at `:103`, `hasDataProtectionKek` at `:124`, key resource at `:1275`).
The anchors inside the 2026-09-07 and 2026-09-10 revisions are left as recorded.

## Revision (2026-10-06)
No decision changed. One statement recorded in an earlier revision is corrected, and the anchors
those older revisions leave as recorded are given their current locations here.

- **Storage Shared Key is no longer documented as required by anything.** The 2026-09-07 revision
  records the ADC storage account's Shared Key posture as still required by the disaster-recovery
  bacpac path. The parameter now says the application path never needed it (the apps reach blob
  storage through the managed identity by URI) and that its one former consumer, the AtlDevCon bacpac
  restore, ended when that bacpac was deleted on 2026-10-03, so turning it off is unblocked. The
  default is still `true` (`MMCA.ADC/infra/main.bicep:138-139`).
- **Current locations for the 2026-09-07 revision.** ADC Service Bus rules
  `MMCA.ADC/infra/main.bicep:1109`, `:1121`, `:1133`, `:1145` (stated at `:226-229`); Store rules
  `MMCA.Store/infra/main.bicep:1035`, `:1047`, `:1059` (stated at `:154-158`). ADC Data Protection
  blob URI `MMCA.ADC/infra/main.bicep:1770`, application name `:1771`,
  `createDataProtectionKeyVaultKey` `:142` with its key resource at `:1529`,
  `dataProtectionKeyVaultKeyUri` `:145`, `hasDataProtectionKek` `:166`, env var `:1825-1826`
  (Identity) and `:2593-2594` (UI), `storageAllowSharedKeyAccess` `:139`.
- **Current locations for the 2026-09-10 revision.** `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:67`;
  ADC `gatewayApp` `MMCA.ADC/infra/main.bicep:2353`, `AZURE_CLIENT_ID` `:2430`, `KeyVault__Uri`
  `:2431`; Store `keyVaultUriEnv` `MMCA.Store/infra/main.bicep:1402`, `azureClientIdEnv` `:1412`,
  used on the gateway at `:1935-1936`. All six ADC apps and all five Store apps still carry both.
- Every `main.bicep`, `deploy.yml` and `Program.cs` citation in Decision, Rationale and Trade-offs
  is re-verified and re-anchored against current source; the secret counts (nineteen and fourteen)
  and placeholder counts (seven and five) are unchanged, and Key Vault purge protection is still not
  enabled by either template.

## Revision (2026-10-07)
Re-verified against current source. No decision changed: the shared identity, the `existing` vault,
the `keyVaultUrl`-only secret lists, the host-side vault read, the placeholder pattern and the
additive SQL staging all hold as written, and the counts re-measure unchanged (nineteen and fourteen
vault secrets, seven and five `unused` placeholders). One statement is added and one corrected. Every
ADC `main.bicep` and `deploy.yml` citation above that moved is re-anchored in place
(`useManagedIdentitySql` at `MMCA.ADC/infra/main.bicep:36` and `grantAvatarStorageRole` at `:133` did
not move), and four non-ADC citations are re-anchored with them: Store vault secrets
`MMCA.Store/infra/main.bicep:1288-1366`, Store SQL stages and repository variables
`MMCA.Store/.github/workflows/deploy.yml:1270-1288` and `:1164-1166`, and the sample CI steps
`MMCA.Common/.github/workflows/ci.yml:776-782`.

1. **Key Vault purge protection is a bootstrap step, not an open gap.** The 2026-09-07 and
   2026-10-06 revisions record that neither template enables purge protection. That stays literally
   true and cannot be otherwise: both templates declare the vault `existing`, so no template property
   could set it. The out-of-band bootstrap runbooks the templates point at now prescribe it: ADC
   creates the vault with `--enable-purge-protection true` (`MMCA.ADC/infra/DISASTER-RECOVERY.md:86`)
   and gives the update-and-verify pair for an existing vault (`:110-111`); Store gives the create
   flag and the update command for an existing vault, with no verify step
   (`MMCA.Store/infra/DISASTER-RECOVERY.md:114`, `:135`), and states it as mandatory, not optional
   (`:120-126`, SEC-Store-58). Whether a live vault actually has it set is not determinable from
   source. The MMCA.Common reference sample creates its own vault with no purge-protection property
   (`MMCA.Common/samples/deployment/main.bicep:69-78`).
2. **The reference sample's vault write is its own resource.** `MMCA.Common/samples/deployment/main.bicep:105`
   only composes the SQL connection string; the `kvSqlConn` secret at `:107-111` writes it into the
   vault. The Adoption-boundary sentence is corrected in place. The sample's CI gate is the
   `sample-deployment-validate` job (`MMCA.Common/.github/workflows/ci.yml:766`), whose two compile
   steps (`:776-782`) are gated on `needs.changes.outputs.code` at `:777` and `:781`; the workflow
   still triggers on `pull_request` only (`:14-15`).
3. **Anchors re-verified against current source:** shared identity `MMCA.ADC/infra/main.bicep:1497-1499`
   (comment `:1492-1496`, ACR config `:1502-1505`), identity attach `:1680`, `:1927`, `:2080`,
   `:2215`, `:2405`, `:2568`; vault `:1518-1520` (out-of-band note `:1510-1517`); vault secrets
   `:1566-1670` and Store `MMCA.Store/infra/main.bicep:1288-1366`; secret lists `:1700-1709`,
   `:1947-1951`, `:2099-2101`, `:2245-2250`; gateway secrets `:2424-2433` (`:2426`, `:2431`), UI
   `:2591`; `secretRef` uses `:1737`, `:1792`, `:1829-1830`, `:1833`, `:1835`, `:2334`, `:1838`,
   `:1842`, `:1848`, `:2033`, `:2332`, `:2484`, `:2491`, `:2650`; `AZURE_CLIENT_ID` and
   `KeyVault__Uri` `:1804`/`:1812`, `:2021-2022`, `:2165-2166`, `:2323-2324`, `:2477-2478`,
   `:2624`/`:2627`, unpinned-client-id comment `:2472-2476`; Redis `:1465`, broker strings
   `:231-234`, SQL base `:218-225` (auth segment `:218-220`, password form at `:220`); placeholders
   `:1632`, `:1639`, `:1649`, `:1654`, `:1659`, `:1664`, `:1669`, `hasSmtpPassword` `:1706`;
   Rationale Redis `:1701`, `:1948`, `:2100`, `:2246`, SMTP `:1706`, `:2250`, trusted caller
   `:2431`, `:2591`; Entra admin `:848-863` (resource at `:854`), `useManagedIdentitySql` `:36`;
   avatar grant `:1362`; App Insights `:270-273` (`:272`), Log Analytics `:1477-1490` (`listKeys()`
   at `:1486`). Pipeline `MMCA.ADC/.github/workflows/deploy.yml:1203-1234` (step at `:1202`),
   parameters file `:1262-1290`, RSA keys `:1294-1297`, repo variables `:1229-1231`, SQL stages
   `:1386-1404`; Store `MMCA.Store/.github/workflows/deploy.yml:1164-1166` and `:1270-1288`. Current
   locations for the 2026-09-07 revision: ADC Service Bus rules `MMCA.ADC/infra/main.bicep:1129`,
   `:1141`, `:1153`, `:1165` (stated at `:227-230`); Data Protection blob URI `:1802`, application
   name `:1803`, `dataProtectionKek` resource `:1553`, env var `:1857-1859` (Identity) and
   `:2641-2643` (UI); the parameters are unmoved since the 2026-10-06 revision:
   `storageAllowSharedKeyAccess` `:139`, `createDataProtectionKeyVaultKey` `:142`,
   `dataProtectionKeyVaultKeyUri` `:145`, `hasDataProtectionKek` `:166`. Current locations for the
   2026-09-10 revision: `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:67`; ADC `gatewayApp`
   `MMCA.ADC/infra/main.bicep:2400`, `AZURE_CLIENT_ID` `:2477`, `KeyVault__Uri` `:2478`. The anchors inside the dated revisions above
   are left as recorded.

## Revision (2026-10-19)
Re-verified for the facts below. No decision changed: both apps still run on the shared existing identity,
the existing vault and `keyVaultUrl`-only secret lists, and the posture is the same in both repos.
Three statements were no longer true and are corrected in place:

1. **Stores vault holds fifteen secrets, not fourteen.** The fifteenth is the gRPC service-token
   signing key (`MMCA.Store/infra/main.bicep:1418-1421`); the secret block is now
   `MMCA.Store/infra/main.bicep:1367-1454`. ADC still writes nineteen (`MMCA.ADC/infra/main.bicep:1716-1820`).
2. **An HS256 secret exists, in Store only.** The service token is HS256 over a shared symmetric key by
   design (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenSettings.cs:13`),
   and Store delivers it to Identity and Sales like the RSA pair, through a `keyVaultUrl` reference
   (`MMCA.Store/infra/main.bicep:1538`, `:1854`; bound at `:1656`, `:1923`). User tokens are still RS256
   only. Whether ADC adopts service tokens is an ADR-004/ADR-012 question, not a secret-delivery one.
3. **One secret name carries `--`, deliberately.** `Grpc--ServiceToken--SigningKey`
   (`MMCA.Store/infra/main.bicep:1420`, comment `:1414-1417`) is named so the host-side vault provider maps
   it onto the same `Grpc:ServiceToken:SigningKey` key the platform reference binds.

Anchors re-pointed in place: shared identity `MMCA.ADC/infra/main.bicep:1647-1649` and
`MMCA.Store/infra/main.bicep:1219-1221`; vault `MMCA.ADC/infra/main.bicep:1668-1670` and
`MMCA.Store/infra/main.bicep:1340-1342`; secret blocks as above; Store host vault reads
`Identity.Service/Program.cs:51` and `Sales.Service/Program.cs:63`. The other `main.bicep` line anchors in
the Decision, Rationale and Trade-offs predate ADC #280/#281 and Store #212/#213 and were not re-verified in
this revision; the next `/update-adrs` pass owns them. The anchors inside the dated revisions above
are left as recorded.

## Revision (2026-10-21)
Re-verified against current source. No decision changed: the shared existing identity, the existing
vault, the `keyVaultUrl`-only secret lists (no inline `value` anywhere), the host-side vault read on all
six ADC and all five Store deployables, the placeholder pattern (seven ADC and five Store `unused`
values) and the additive SQL staging all hold as written. Only line anchors moved, so the main.bicep
anchors the 2026-10-19 revision left unverified are now re-pointed in place.

1. **Anchors re-verified against current source:** ADC `Identity.Service/Program.cs:111` (the other
   ten host call sites are unmoved); identity attach `MMCA.ADC/infra/main.bicep:1832`, `:2085`,
   `:2238`, `:2373`, `:2563`, `:2726` and Store `MMCA.Store/infra/main.bicep:1515`, `:1697`, `:1821`,
   `:1973`, `:2102`; ACR config ADC `:1652-1655`, Store `:1224-1227`; secret lists ADC `:1850-1859`,
   `:2103-2107`, `:2255-2257`, `:2401-2406` and Store `:1533-1540`, `:1714-1716`, `:1851-1860`;
   gateway entries ADC `:2582`, `:2587`, Store `:1993`, `:1996`; UI entries ADC `:2747`, Store
   `:2120`; ADC `secretRef` uses `:1887`, `:1948`, `:1985-1986`, `:1989`, `:1991`, `:2490`, `:1994`,
   `:1998`, `:2004`, `:2189`, `:2488`, `:2640`, `:2647`, `:2806`; Store `secretRef` uses `:1569`,
   `:1602`, `:1650-1651`, `:1654`, `:1658`, `:1943`, `:2047`, `:2053`, `:2178`, Stripe `:1939-1940`;
   Store `keyVaultUriEnv` `:1490` and `azureClientIdEnv` `:1500`, used at `:1563-1564`, `:1745-1746`,
   `:1882-1883`, `:2029-2030`, `:2161-2162`; ADC `AZURE_CLIENT_ID` and `KeyVault__Uri` `:1960`/`:1968`,
   `:2177-2178`, `:2321-2322`, `:2479-2480`, `:2633-2634`, `:2780`/`:2783`, documented at
   `:1664-1667`; unpinned-client-id comments Store `:1495-1499` and ADC gateway `:2628-2632`; Redis
   `listKeys()` ADC `:1615`, Store `:1194`; Store broker strings `:163-165`, SQL base `:150-156`
   (auth segment `:150-152`, password form `:152`); ADC broker, SQL base and password form unmoved;
   placeholders ADC `:1782`, `:1789`, `:1799`, `:1804`, `:1809`, `:1814`, `:1819` and Store `:1426`,
   `:1431`, `:1436`, `:1444`, `:1453`; `hasSmtpPassword` entries ADC `:1856`, Store `:1860`;
   out-of-band notes ADC `:1660-1663`, Store `:1336-1339`; Contributor reason ADC `:1644-1645`, Store
   `:1216-1217`; identity comment ADC `:1642-1646`, Store `:1214-1218`; avatar grant resource
   `:1512`; Entra admin ADC `:996-1011`, Store `:887-902`; Store App Insights `:201-204` (`:203`);
   managed environments ADC `:1627-1640` (`listKeys()` at `:1636`), Store `:1199-1212` (`:1208`);
   Rationale Redis ADC `:1851`, `:2104`, `:2256`, `:2402` and Store `:1534`, `:1715`, `:1852`, SMTP ADC
   `:1856`, `:2406` and Store `:1540`, `:1860`, trusted caller ADC `:2587`, `:2747` and Store `:1996`,
   `:2120`. Pipeline `MMCA.ADC/.github/workflows/deploy.yml:1218-1249` (step at `:1217`), parameters
   file `:1277-1305`, RSA keys `:1309-1312`, repository variables `:1244-1246`, SQL stages
   `:1401-1419`; Store `MMCA.Store/.github/workflows/deploy.yml:1182-1184` and `:1299-1317`. Sample CI
   job `MMCA.Common/.github/workflows/ci.yml:707`, compile steps `:717-723` gated at `:718` and
   `:722`, still `pull_request` only (`:14-15`). The anchors inside the dated revisions above are left
   as recorded.

## Revision (2026-10-24)
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) moves the host-side Key Vault configuration source
out of MMCA.Common.Aspire into the `MMCA.Common.Azure` adapter. The secret model (platform-resolved
references, managed identity, one vault per deployment) is unchanged, and so are the keys.

1. **The call is renamed and moved.** `AddCommonKeyVaultConfiguration()` is now
   `AddAzureKeyVaultConfiguration()`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureKeyVaultConfigurationExtensions.cs:23`, `:80`),
   with the same `KeyVault:Uri` gate (`:86`-`:94`), the same `KeyVault:ReloadIntervalMinutes` knob
   (`:102`-`:113`) and the same `DefaultAzureCredential` source (`:115`).
2. **A lost call fails startup.** `KeyVault:Uri` set without the call fails `ValidateOnStart`, naming
   it (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:23`, `:31`;
   the call's marker at `AzureKeyVaultConfigurationExtensions.cs:84`).
3. **No other cloud ships a configuration source.** `MMCA.Common.Aws` registers storage and a broker
   transport only (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:44`,
   `:79`).
4. **Corrected in place:** the Decision bullet that named `AddCommonKeyVaultConfiguration` and its
   `MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs` anchors, and the two
   Trade-offs anchors into the same file, now point at the adapter. The consumer `Program.cs` call
   sites listed in the Decision name the call each consumer made when last verified; a consumer on
   v1.255.0 or later makes the renamed call. The anchors inside the 2026-09-10 revision are left as
   recorded.

## Revision (2026-10-25)
MMCA.Common v1.257.0 adds two more vault-as-configuration sources, one in the AWS adapter and one in
the new Google Cloud adapter (`MMCA.Common/CHANGELOG.md:7`, `:12`, `:18`). The Azure secret model this
record decides for ADC and Store is unchanged, and the Decision gains one bullet for the two sources.

1. **AWS Secrets Manager.** `AddAwsSecretsManagerConfiguration()`, gated on `SecretsManager:NamePrefix`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsSecretsManagerConfigurationExtensions.cs:82`, `:85`,
   `:91`-`:94`). The AWS SDK v4 client is async only, so the provider's synchronous first load carries
   the one VSTHRD002 pragma
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Secrets/AwsSecretsManagerConfigurationProvider.cs:78`-`:80`);
   timed reloads never block (`:96`-`:110`) and a failed one keeps the values already loaded
   (`:124`-`:129`).
2. **Google Secret Manager.** `AddGoogleSecretManagerConfiguration()`, gated on
   `GoogleSecretManager:ProjectId` + `NamePrefix`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GoogleSecretManagerConfigurationExtensions.cs:82`,
   `:92`-`:95`), over the synchronous `SecretManagerServiceClient` (`:119`;
   `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Secrets/GoogleSecretManagerConfigurationProvider.cs:24`-`:25`).
   The service's name filter is a substring match, so each listed id is re-checked ordinally as a
   prefix (`:17`-`:19`, `:164`).
3. **Same naming rule, both prefixes on the tripwire.** `--` maps to `:` in both providers
   (`AwsSecretsManagerConfigurationProvider.cs:32`, `:68`; `GoogleSecretManagerConfigurationProvider.cs:35`,
   `:81`). The tripwire checks `SecretsManager:NamePrefix` and `GoogleSecretManager:NamePrefix`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:29`, `:40`);
   for Google it checks the prefix rather than the project id, because the prefix is what declares that
   the host reads its settings from Secret Manager (`:34`-`:39`).
4. **SQL Server on RDS and Cloud SQL has no IAM sign-in.** Neither offers IAM database authentication for
   SQL Server (`MMCA.Common/CHANGELOG.md:15`, `:21`). On RDS the password connection string is held in
   Secrets Manager and loaded through `AddAwsSecretsManagerConfiguration()` (`:15`); on Cloud SQL it is
   either a password connection string from Secret Manager or, on SQL Server 2022 and later, Microsoft
   Entra ID through MMCA.Common.Azure's SqlClient extension
   (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:80-83`).
5. **Superseded:** the Revision (2026-10-24) item 3, "No other cloud ships a configuration source",
   which was true of v1.256.0 and no longer is. The anchors inside earlier revisions are left as
   recorded.

## Related
ADR-037 (`037-field-level-encryption-at-rest.md:108-110` directs a consumer to keep the
field-encryption key in Key Vault but decides no delivery
mechanism, and nothing wires that converter today, so no such secret exists in either vault),
ADR-045 (the identity model one layer out: blob access is a data-plane role on the same identity
instead of a secret, which is why its grant carries the same out-of-band caveat), ADR-053 (the
publish-time half of the same no-stored-credential posture: keyless OIDC to nuget.org, build identity
rather than runtime identity), ADR-006 (database per service is why there is one SQL connection-string
secret per service rather than one shared string).
