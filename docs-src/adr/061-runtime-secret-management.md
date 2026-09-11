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
(`045-managed-file-storage-and-avatars.md:23`, `:50`); ADR-053 decides publish-time identity. None of
them decides where a running app's credentials live. This record does, and it also records the staged
migration that is removing the last password from that set.

## Decision
Every production secret lives in Azure Key Vault and reaches the app as a `keyVaultUrl` secret
reference resolved by a user-assigned managed identity; the same identity also lets a host read the
vault directly as a configuration source at startup. SQL authentication is staged behind a flag on
its way to the same model.

- **The apps run as one shared user-assigned managed identity, referenced as `existing`.**
  `adc-prod-apps-identity` (`MMCA.ADC/infra/main.bicep:1287-1289`) and `mmca-prod-apps-identity`
  (`MMCA.Store/infra/main.bicep:1093-1095`). Every container app attaches it
  (`MMCA.ADC/infra/main.bicep:1472`, `:1697`, `:1839`, `:1970`, `:2147`, `:2290`;
  `MMCA.Store/infra/main.bicep:1380`, `:1557`, `:1673`, `:1812`, `:1932`), and the same identity is
  the ACR pull credential, so no registry admin password exists either
  (`MMCA.ADC/infra/main.bicep:1291-1294`, `MMCA.Store/infra/main.bicep:1098-1101`).
- **The vault is referenced, not created; the deployment writes the values into it.** The template
  declares the vault as `existing` (`MMCA.ADC/infra/main.bicep:1308-1310`,
  `MMCA.Store/infra/main.bicep:1214-1216`) and then writes secret child resources: nineteen in ADC
  (`MMCA.ADC/infra/main.bicep:1356-1459`) and fourteen in Store
  (`MMCA.Store/infra/main.bicep:1241-1318`).
- **Every Container App secret entry is a `keyVaultUrl` reference bound to that identity.** ADC
  Identity (`MMCA.ADC/infra/main.bicep:1490-1499`), Conference (`:1715-1719`), Engagement
  (`:1856-1858`), Notification (`:1998-2003`); Store Identity
  (`MMCA.Store/infra/main.bicep:1398-1404`), Catalog (`:1574-1576`), Sales (`:1703-1711`). Not one
  entry carries an inline `value`. Each Gateway carries at most two, both conditional: the
  synthetic-traffic bypass key its edge rate limiter checks (ADR-088) and the trusted-caller key,
  written as the same `keyVaultUrl` reference and gated on `hasSyntheticTrafficSecret` and
  `hasTrustedCallerSecret`, so the list is empty when both parameters are unset
  (`MMCA.ADC/infra/main.bicep:2166`, `:2171`; `MMCA.Store/infra/main.bicep:1832`, `:1835`). The UI
  apps carry one conditional entry each, the same trusted-caller key the Gateway checks
  (`MMCA.ADC/infra/main.bicep:2311`, `MMCA.Store/infra/main.bicep:1950`), so no deployable is
  credential-free today.
- **Containers consume secrets only through `secretRef`.** The SQL connection string
  (`MMCA.ADC/infra/main.bicep:1525`, `MMCA.Store/infra/main.bicep:1431`), the broker connection string
  (`MMCA.ADC/infra/main.bicep:1573`, `MMCA.Store/infra/main.bicep:1464`), the RSA signing pair (the
  private key the issuer signs with, the public key its in-process validation and its JWKS endpoint
  publish: `MMCA.ADC/infra/main.bicep:1609-1610`, `:1613`; `MMCA.Store/infra/main.bicep:1512-1513`,
  `:1516`), SMTP (`MMCA.ADC/infra/main.bicep:1615`, `:2083`; `MMCA.Store/infra/main.bicep:1518`,
  `:1782`), the OAuth client secrets (`MMCA.ADC/infra/main.bicep:1618`, `:1622`, `:1628`), the
  Anthropic key (`:1790`), the native-push hub connection string (`:2081`), the gateway
  synthetic-traffic bypass key (`:2220`, `MMCA.Store/infra/main.bicep:1883`), the trusted-caller key
  (`MMCA.ADC/infra/main.bicep:2227`, `:2367`; `MMCA.Store/infra/main.bicep:1889`, `:2006`), and the
  two Stripe keys (`MMCA.Store/infra/main.bicep:1778-1779`). RSA is the only signing key material
  either template provisions: production signs with RS256 (ADR-004), and no HS256 secret exists in
  either vault or either app.
- **A second, host-side path reads the same vault as a configuration source.** Alongside the
  platform-resolved references, both templates set `KeyVault__Uri` and `AZURE_CLIENT_ID` on every app
  whose host calls `AddCommonKeyVaultConfiguration`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:78-112`),
  which layers the vault over `IConfiguration` at startup. Store wires all five deployables through
  two shared env entries (`MMCA.Store/infra/main.bicep:1355`, `:1365`, used at `:1425-1426`,
  `:1603-1604`, `:1731-1732`, `:1865-1866`, `:1989-1990`); ADC writes the pair inline on each of its
  six apps (`MMCA.ADC/infra/main.bicep:1584`, `:1592`; `:1785-1786`; `:1918-1919`; `:2072-2073`;
  `:2213-2214`; `:2341`, `:2344`, documented at `:1304-1307`). The calls themselves sit
  in each host's `Program.cs`: Store `Identity.Service:48`, `Catalog.Service:45`, `Sales.Service:61`,
  `Gateway:63`, `UI.Web:45`; ADC `Identity.Service:106`, `Conference.Service:112`,
  `Engagement.Service:92`, `Notification.Service:98`, `Gateway:66`, `UI.Web:44`. The call is
  gated on `KeyVault:Uri` and does nothing at all without it, so local runs and tests take no Azure
  dependency (`KeyVaultConfigurationExtensions.cs:80-88`). It authenticates with
  `DefaultAzureCredential` against the same Key Vault Secrets User grant the references already use,
  which is what makes `AZURE_CLIENT_ID` load-bearing: these apps carry only a user-assigned identity,
  so an unpinned client id fails the startup read (`MMCA.Store/infra/main.bicep:1365-1368`,
  `MMCA.ADC/infra/main.bicep:1575-1584`). Secret names map `--` onto the configuration separator
  (`KeyVaultConfigurationExtensions.cs:43-48`, `:109`), and no secret in either vault carries `--`
  today (`MMCA.ADC/infra/main.bicep:1356-1459`, `MMCA.Store/infra/main.bicep:1241-1318`), so this
  adds a source without re-pointing any setting the apps already bind.
- **Composite connection strings are assembled at deploy time and land only in the vault.** The Redis
  string embeds a key read with `listKeys()` (`MMCA.ADC/infra/main.bicep:1255`,
  `MMCA.Store/infra/main.bicep:1068`), each broker string comes from that service's own SAS rule
  rather than the namespace root (`MMCA.ADC/infra/main.bicep:198-201`,
  `MMCA.Store/infra/main.bicep:156-158`), and the per-database SQL strings are composed from a shared
  base (`MMCA.ADC/infra/main.bicep:185-192`, `MMCA.Store/infra/main.bicep:143-149`). All of them are
  written straight into vault secrets, so the assembled value never appears in app configuration.
- **An unconfigured optional secret gets a placeholder, not a missing entry.** Seven ADC values and
  five Store values are written as the literal `unused` when their parameter is empty
  (`MMCA.ADC/infra/main.bicep:1422`, `:1429`, `:1439`, `:1444`, `:1449`, `:1454`, `:1459`;
  `MMCA.Store/infra/main.bicep:1291`, `:1296`, `:1301`, `:1309`, `:1318`), while the app-side
  reference is conditional (for example `hasSmtpPassword` at `MMCA.ADC/infra/main.bicep:1496` and
  `MMCA.Store/infra/main.bicep:1711`), so the vault entry always exists but an unconfigured
  feature is simply absent from the app.
- **The two role assignments are bootstrapped out of band, deliberately.** The deploy identity holds
  Key Vault Secrets Officer to write the values; the apps hold Key Vault Secrets User to read them;
  the vault and both grants are created outside the template because the deploy principal has
  Contributor without role-assignment-write (`MMCA.ADC/infra/main.bicep:1300-1307`,
  `MMCA.Store/infra/main.bicep:1210-1213`). It is the same least-privilege posture that keeps ADR-045's
  avatar-storage grant behind a default-false flag (`MMCA.ADC/infra/main.bicep:133`, `:1174-1183`).
  The bootstrap commands are written out in the framework's reference runbook
  (`MMCA.Common/samples/deployment/DEPLOYMENT.md:14-36`).
- **SQL authentication is staged behind `useManagedIdentitySql`, and the stage is additive.** The
  parameter defaults to `false` (`MMCA.ADC/infra/main.bicep:36`, `MMCA.Store/infra/main.bicep:26`)
  and selects one of two auth segments for the connection-string base:
  `Authentication=Active Directory Managed Identity` with the identity's client id, or the SQL login
  plus password (`MMCA.ADC/infra/main.bicep:185-187`, `MMCA.Store/infra/main.bicep:143-145`). The
  Entra admin the flip depends on is provisioned only when its object id is supplied and does not set
  `azureADOnlyAuthentication`, so password login keeps working during the transition
  (`MMCA.ADC/infra/main.bicep:764-768`, `MMCA.Store/infra/main.bicep:769-773`). The pipeline exposes
  the same three stages: supply the Entra admin, run the per-database external-provider grants by
  hand, then set the flag (`MMCA.ADC/.github/workflows/deploy.yml:1550-1569`,
  `MMCA.Store/.github/workflows/deploy.yml:1392-1411`), driven by repository variables that are
  absent by default (`MMCA.ADC/.github/workflows/deploy.yml:1390-1393`,
  `MMCA.Store/.github/workflows/deploy.yml:1285-1288`).

**Adoption boundary.** The secret-reference half is shipped and identical in both deployed apps, and
the configuration-source half is now shipped on every deployable in both (see the 2026-09-10 revision;
the Gateway difference recorded here is closed). The SQL half
is staged in both and not flipped in either template default, so with the default parameters every
app-to-database connection string still carries `User ID` and `Password`
(`MMCA.ADC/infra/main.bicep:187`, `MMCA.Store/infra/main.bicep:145`). That password is itself a vault
secret and never app configuration, so what remains is a shared SQL login, not an exposed one.
Whether a given deployment has already set the `USE_MANAGED_IDENTITY_SQL` repository variable is not
determinable from source. MMCA.Common carries the posture as a reference sample rather than a
deployment: `MMCA.Common/samples/deployment/main.bicep:67-76` creates an RBAC-authorized vault, `:105`
writes the SQL connection string into it, `:136-138` and `:145` attach the identity for both secret
reads and ACR pull, `:150` declares the matching `keyVaultUrl` secret entry, and `:162` reads it
through a `secretRef`. The sample now closes the loop it used to leave open, and CI type-checks it on
every run (`MMCA.Common/.github/workflows/ci.yml:789-804`).
MMCA.Helpdesk has no `infra/` directory and no deploy workflow at all: its four workflows are
`ci.yml`, the two Claude ones (`claude.yml`, `claude-code-review.yml`), and `release-templates.yml`,
which packages and publishes the `MMCA.Templates` dotnet-new pack rather than any infrastructure. So
there is nothing for it to adopt. This mirrors how ADR-018 and ADR-020 record partial adoption: the mechanism is decided, the
consumer-by-consumer state is named.

## Rationale
- **A reference has one home; a literal has as many homes as it has consumers.** Three vault secrets
  in each repo are referenced by more than one app: Redis by all four ADC services
  (`MMCA.ADC/infra/main.bicep:1491`, `:1716`, `:1857`, `:1999`) and all three Store services
  (`MMCA.Store/infra/main.bicep:1399`, `:1575`, `:1704`), the SMTP password by two apps in each
  (`MMCA.ADC/infra/main.bicep:1496`, `:2003`; `MMCA.Store/infra/main.bicep:1404`, `:1711`), and the
  trusted-caller key by the Gateway that checks it and the UI that presents it
  (`MMCA.ADC/infra/main.bicep:2171`, `:2311`; `MMCA.Store/infra/main.bicep:1835`, `:1950`). As
  references they are one vault entry pointed at from several apps; as literals they would be several
  copies to keep in step. The broker string is deliberately not on that list: since the 2026-09-07
  revision each service reads its own.
- **Reuse the identity that already existed.** The user-assigned identity was introduced to pull
  images from ACR without the registry admin password
  (`MMCA.ADC/infra/main.bicep:1282-1286`, `MMCA.Store/infra/main.bicep:1088-1092`). Granting it Key Vault
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
  (`MMCA.ADC/infra/main.bicep:1287-1289`, `:1308-1310`) and cannot report that a grant is missing. The
  prerequisites live in each repo's private `infra/DISASTER-RECOVERY.md` and, in distilled form, in
  `MMCA.Common/samples/deployment/DEPLOYMENT.md:14-36`.
- **The pipeline is still a plaintext path.** Values arrive as `@secure()` bicep parameters written
  from GitHub secrets into a parameters file at deploy time
  (`MMCA.ADC/.github/workflows/deploy.yml:1365-1369`). The vault removes the app-configuration copy, not
  the CI copy; rotating a secret still means rotating a GitHub secret and redeploying.
- **The `unused` placeholder makes the vault a poor inventory.** A secret written as `unused` is
  indistinguishable in the vault from a configured one; only the app's `secrets` list says which
  credentials are actually live.
- **Two literal values remain in the template.** The Application Insights connection string is an
  ordinary env var (`MMCA.ADC/infra/main.bicep:237-240`, `MMCA.Store/infra/main.bicep:194-197`) and the
  Log Analytics shared key is passed inline to the managed environment
  (`MMCA.ADC/infra/main.bicep:1267-1280`, `MMCA.Store/infra/main.bicep:1073-1086`). Both are telemetry
  ingestion keys read with `listKeys()` at deploy time, not application credentials, and neither is
  covered by this decision.
- **The host-side vault read is a hard startup dependency.** The configuration source is added
  synchronously in the host builder, so a vault read that cannot authenticate (an unpinned
  `AZURE_CLIENT_ID` is the documented case) crash-loops the app rather than degrading one feature
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:63-69`,
  `MMCA.Store/infra/main.bicep:1365-1368`). Neither template sets `KeyVault:ReloadIntervalMinutes`, so
  the vault is read once at startup and a rotated secret reaches those hosts on their next restart
  (`KeyVaultConfigurationExtensions.cs:37-39`, `:96-107`).
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

## Related
ADR-037 (`037-field-level-encryption-at-rest.md:108-110` directs a consumer to keep the
field-encryption key in Key Vault but decides no delivery
mechanism, and nothing wires that converter today, so no such secret exists in either vault),
ADR-045 (the identity model one layer out: blob access is a data-plane role on the same identity
instead of a secret, which is why its grant carries the same out-of-band caveat), ADR-053 (the
publish-time half of the same no-stored-credential posture: keyless OIDC to nuget.org, build identity
rather than runtime identity), ADR-006 (database per service is why there is one SQL connection-string
secret per service rather than one shared string).
