# ADR-061: Runtime Secret Management via Key Vault References and Managed Identity

## Status
Accepted (2026-08-01; citations re-anchored 2026-08-14).

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
keep its field-encryption key in Key Vault (`037-field-level-encryption-at-rest.md:79`) without
deciding how a running app reaches it; ADR-045 notes that blob storage authenticates with
`DefaultAzureCredential` and needs a data-plane role rather than a secret
(`045-managed-file-storage-and-avatars.md:23`, `:50`); ADR-053 decides publish-time identity. None of
them decides where a running app's credentials live. This record does, and it also records the staged
migration that is removing the last password from that set.

## Decision
Every production secret lives in Azure Key Vault and reaches the app as a `keyVaultUrl` secret
reference resolved by a user-assigned managed identity. SQL authentication is staged behind a flag on
its way to the same model.

- **The apps run as one shared user-assigned managed identity, referenced as `existing`.**
  `adc-prod-apps-identity` (`MMCA.ADC/infra/main.bicep:920-922`) and `mmca-prod-apps-identity`
  (`MMCA.Store/infra/main.bicep:761-763`). Every container app attaches it
  (`MMCA.ADC/infra/main.bicep:1022-1027`, `:1225`, `:1349`, `:1473`, `:1634`, `:1736`;
  `MMCA.Store/infra/main.bicep:943-948`, `:1097`, `:1196`, `:1327`, `:1412`), and the same identity is
  the ACR pull credential, so no registry admin password exists either
  (`MMCA.ADC/infra/main.bicep:925-928`, `MMCA.Store/infra/main.bicep:766-769`).
- **The vault is referenced, not created; the deployment writes the values into it.** The template
  declares the vault as `existing` (`MMCA.ADC/infra/main.bicep:940-942`,
  `MMCA.Store/infra/main.bicep:849-851`) and then writes secret child resources: fourteen in ADC
  (`MMCA.ADC/infra/main.bicep:944-1013`) and eleven in Store
  (`MMCA.Store/infra/main.bicep:853-907`).
- **Every Container App secret entry is a `keyVaultUrl` reference bound to that identity.** ADC
  Identity (`MMCA.ADC/infra/main.bicep:1041-1056`), Conference (`:1242-1249`), Engagement
  (`:1367-1369`), Notification (`:1500-1508`); Store Identity
  (`MMCA.Store/infra/main.bicep:962-975`), Catalog (`:1114-1118`), Sales (`:1225-1236`). Not one entry
  carries an inline `value`. The two apps that need no credential say so explicitly: the Gateway and
  UI apps declare `secrets: []`
  (`MMCA.ADC/infra/main.bicep:1649`, `:1754`; `MMCA.Store/infra/main.bicep:1342`, `:1430`).
- **Containers consume secrets only through `secretRef`.** The SQL connection string
  (`MMCA.ADC/infra/main.bicep:1077`, `MMCA.Store/infra/main.bicep:1256`), the broker connection string
  (`MMCA.ADC/infra/main.bicep:1556`, `MMCA.Store/infra/main.bicep:1276`), the RSA private key and its
  HS256 fallback (`MMCA.ADC/infra/main.bicep:1153`, `:1160`; `MMCA.Store/infra/main.bicep:1049`,
  `:1056`), SMTP (`MMCA.ADC/infra/main.bicep:1163`, `:1576`; `MMCA.Store/infra/main.bicep:1059`,
  `:1298`), the OAuth client secrets (`MMCA.ADC/infra/main.bicep:1166`, `:1170`), the Anthropic key
  (`:1301`), the native-push hub connection string (`:1574`), and the two Stripe keys
  (`MMCA.Store/infra/main.bicep:1294-1295`).
- **Composite connection strings are assembled at deploy time and land only in the vault.** The Redis
  string embeds a key read with `listKeys()` (`MMCA.ADC/infra/main.bicep:895`,
  `MMCA.Store/infra/main.bicep:736`), the broker string comes from a dedicated `app-clients` SAS rule
  rather than the namespace root (`MMCA.ADC/infra/main.bicep:161-164`,
  `MMCA.Store/infra/main.bicep:135-138`), and the per-database SQL strings are composed from a shared
  base (`MMCA.ADC/infra/main.bicep:152-159`, `MMCA.Store/infra/main.bicep:127-133`). All of them are
  written straight into vault secrets, so the assembled value never appears in app configuration.
- **An unconfigured optional secret gets a placeholder, not a missing entry.** Optional values are
  written as the literal `unused` when their parameter is empty (`MMCA.ADC/infra/main.bicep:982`,
  `:987`, `:992`, `:997`, `:1002`, `:1007`, `:1012`; `MMCA.Store/infra/main.bicep:881`, `:886`, `:891`,
  `:896`, `:901`, `:906`), while the app-side reference is conditional (for example `hasSmtpPassword`
  at `MMCA.ADC/infra/main.bicep:1053` and `hasStripe` at `MMCA.Store/infra/main.bicep:1231-1234`), so
  the vault entry always exists but an unconfigured feature is simply absent from the app.
- **The two role assignments are bootstrapped out of band, deliberately.** The deploy identity holds
  Key Vault Secrets Officer to write the values; the apps hold Key Vault Secrets User to read them;
  the vault and both grants are created outside the template because the deploy principal has
  Contributor without role-assignment-write (`MMCA.ADC/infra/main.bicep:933-936`,
  `MMCA.Store/infra/main.bicep:845-848`). It is the same least-privilege posture that keeps ADR-045's
  avatar-storage grant behind a default-false flag (`MMCA.ADC/infra/main.bicep:112-113`, `:840-848`).
  The bootstrap commands are written out in the framework's reference runbook
  (`MMCA.Common/samples/deployment/DEPLOYMENT.md:14-35`).
- **SQL authentication is staged behind `useManagedIdentitySql`, and the stage is additive.** The
  parameter defaults to `false` (`MMCA.ADC/infra/main.bicep:36`, `MMCA.Store/infra/main.bicep:26`)
  and selects one of two auth segments for the connection-string base:
  `Authentication=Active Directory Managed Identity` with the identity's client id, or the SQL login
  plus password (`MMCA.ADC/infra/main.bicep:152-154`, `MMCA.Store/infra/main.bicep:127-129`). The
  Entra admin the flip depends on is provisioned only when its object id is supplied and does not set
  `azureADOnlyAuthentication`, so password login keeps working during the transition
  (`MMCA.ADC/infra/main.bicep:606-621`, `MMCA.Store/infra/main.bicep:554-569`). The pipeline exposes
  the same three stages: supply the Entra admin, run the per-database external-provider grants by
  hand, then set the flag (`MMCA.ADC/.github/workflows/deploy.yml:1050-1068`,
  `MMCA.Store/.github/workflows/deploy.yml:1014-1032`), driven by repository variables that are
  absent by default (`MMCA.ADC/.github/workflows/deploy.yml:930-932`).

**Adoption boundary.** The Key Vault half is shipped and identical in both deployed apps; the SQL half
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
  (`MMCA.ADC/infra/main.bicep:1044-1045`, `:1245-1246`, `:1368-1369`, `:1503-1504`) and all three
  Store services (`MMCA.Store/infra/main.bicep:965-966`, `:1116-1117`, `:1228-1229`), and the SMTP
  password by two apps in each (`MMCA.ADC/infra/main.bicep:1053`, `:1507`;
  `MMCA.Store/infra/main.bicep:974`, `:1235`). As references they are one vault entry pointed at from
  several apps; as literals they would be several copies to keep in step.
- **Reuse the identity that already existed.** The user-assigned identity was introduced to pull
  images from ACR without the registry admin password
  (`MMCA.ADC/infra/main.bicep:915-919`, `MMCA.Store/infra/main.bicep:756-760`). Granting it Key Vault
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
  (`MMCA.ADC/infra/main.bicep:920-922`, `:940-942`) and cannot report that a grant is missing. The
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
  (`MMCA.ADC/infra/main.bicep:905-911`, `MMCA.Store/infra/main.bicep:746-752`). Both are telemetry
  ingestion keys read with `listKeys()` at deploy time, not application credentials, and neither is
  covered by this decision.
- **The staged SQL half is inert until an operator acts.** Until the per-database
  `CREATE USER ... FROM EXTERNAL PROVIDER` grants are run and the flag is set, the shared SQL admin
  login is still what every service authenticates with, so password rotation is deferred rather than
  solved. Same audit-the-inventory caveat as ADR-018 and ADR-020.

## Related
ADR-037 (directs a consumer to keep the field-encryption key in Key Vault but decides no delivery
mechanism, and nothing wires that converter today, so no such secret exists in either vault),
ADR-045 (the identity model one layer out: blob access is a data-plane role on the same identity
instead of a secret, which is why its grant carries the same out-of-band caveat), ADR-053 (the
publish-time half of the same no-stored-credential posture: keyless OIDC to nuget.org, build identity
rather than runtime identity), ADR-006 (database per service is why there is one SQL connection-string
secret per service rather than one shared string).
