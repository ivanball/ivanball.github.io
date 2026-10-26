# ADR-069: Shared DataProtection Key Ring for Scaled-Out Hosts

## Status
Accepted (2026-08-07). Updated 2026-08-14: Store's adoption has landed and is live (its own dedicated
storage account, gated on `dataProtectionStorageReady`), and the ADC call-site ordering is recorded
precisely. Revised 2026-09-10: gate 2 ships in both templates, default off. Revised 2026-10-01:
citations refreshed. Revised 2026-10-06: in both ADC hosts Key Vault configuration now loads before
`AddServiceDefaults()` (still before the registration call), the ADC replica cap is
`conferenceScaledMaxReplicas`, and gate 2 is recorded as switched on for ADC and off for Store.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release, and Related now points at ADR-024
for the WebSockets-only SignalR client that needs no session affinity. Revised 2026-10-21: anchors
refreshed after the ADC and Store infrastructure templates and deploy workflows moved.
Revised 2026-10-24: the call is `AddAzureDataProtection()` in MMCA.Common.Azure, configuration keys unchanged ([ADR-134](134-cloud-neutral-core-vendor-adapters.md)); framework anchors in the Decision corrected in place. See Revision (2026-10-24) at the end.
Revised 2026-10-25: three key-ring adapters (Azure Blob + Key Vault, AWS Parameter Store, Google Cloud Storage with optional Cloud KMS), and the startup tripwire fails when more than one key-ring gate is set; the Decision is restated across the three, the package bullet corrected, and Google's prerelease packages recorded as a rejected alternative. See Revision (2026-10-25) at the end.
Revised 2026-10-26: the consumer call sites name `AddAzureKeyVaultConfiguration()` and `AddAzureDataProtection()`, `AddAzureMonitorExporter()` now sits between `AddServiceDefaults()` and the registration (so Store's "only an ADR-069 comment block between them" is retired), and anchors refreshed across both hosts, templates and deploy workflows.

## Context
ASP.NET Core's DataProtection default keeps the key ring **in memory, per process**. That is correct
for a single-process host and wrong for a scaled-out one: every replica generates its own keys, so an
auth cookie or an antiforgery token minted by replica A cannot be decrypted by replica B. The symptom
is random sign-outs and "The antiforgery token could not be decrypted" errors that follow no pattern,
because they follow the load balancer rather than the user.

Two existing decisions put real payloads under that key ring. ADR-022 carries the browser session in
HttpOnly cookies read during Blazor SSR prerender, and the Blazor Server forms those pages render mint
antiforgery tokens; both are DataProtection payloads. ADR-008 then split the monolith into
independently scaled hosts, and in ADC the two hosts that mint those payloads (the UI host and the
Identity service, which also does OAuth correlation and state cookie cryptography) both scale to
`maxReplicas: conferenceScaledMaxReplicas`, which is 2, or 4 in conference mode
(`MMCA.ADC/infra/main.bicep:192`; `:2106` Identity service, `:2884` UI host). Of those two
minting hosts, only the Identity service runs with **no session affinity**; the UI ingress is sticky
(`MMCA.ADC/infra/main.bicep:2774-2776`), which narrows the UI window rather than closing it, since
affinity is lost on a replica restart, a revision swap, or a dropped affinity cookie.

Nothing in the record decided **where the key ring lives**. ADR-061 decides how a running app reaches
a secret (Key Vault reference resolved by a managed identity) and ADR-045 decides that blob storage is
reached with `DefaultAzureCredential` plus a data-plane role, but the key ring is neither an app secret
nor user content: it is process-local state that has to become deployment-wide state. This record
decides that, and it records which repos have adopted it.

## Decision
Persist the key ring through one opt-in registration call per cloud, so every replica of a host shares
one ring, and let a host keep exactly one ring. Three adapters exist: `AddAzureDataProtection`
(MMCA.Common.Azure) persists it to a single Azure blob with optional Key Vault protection
(`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureDataProtectionExtensions.cs:53`),
`AddAwsDataProtection` (MMCA.Common.Aws) to Systems Manager Parameter Store
(`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsDataProtectionExtensions.cs:57`), and
`AddGoogleCloudDataProtection` (MMCA.Common.Gcp) to one Cloud Storage object with optional Cloud KMS
protection (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GoogleCloudDataProtectionExtensions.cs:76`).
The bullets up to the AWS one describe the Azure adapter, the one both deployed consumers call.

- **One configuration key is the gate, and absent means do nothing.**
  `DataProtection:BlobStorageUri` is read first (`AzureDataProtectionExtensions.cs:59`); when it is absent
  or whitespace the method returns the builder untouched (`:64-67`), so no DataProtection services are
  registered at all. A developer machine, a test host, and the Helpdesk seed all run single-process,
  where the in-memory default is correct and an unconditional Azure dependency at startup would be a
  liability. Two tests pin that boundary: an unconfigured builder registers no `IDataProtectionProvider`
  and leaves `KeyManagementOptions.XmlRepository` null, while a configured URI replaces the default
  repository with the blob one
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Azure.Tests/AzureDataProtectionExtensionsTests.cs:22`,
  `:40`, which asserts the replacement is the `Azure.Extensions.AspNetCore.DataProtection.Blobs`
  repository specifically). Neither test needs Azure credentials: the blob client is constructed
  lazily by the repository, never at registration time.
- **Blob persistence plus an application discriminator.** A configured URI wires
  `PersistKeysToAzureBlobStorage` and `SetApplicationName`
  (`AzureDataProtectionExtensions.cs:75-77`); the discriminator comes from `DataProtection:ApplicationName`
  and falls back to the host application name (`:69-70`). The discriminator is what keeps two
  applications sharing one blob or one key-ring directory from reading each other's keys.
- **Encryption of the key ring at rest is a SECOND, deliberately independent gate.**
  `DataProtection:KeyVaultKeyUri` is read separately and only adds `ProtectKeysWithAzureKeyVault` when
  present (`:86-90`). The two are uncoupled on purpose (`:79-85`): blob persistence is the part that
  fixes cross-replica cookie and antiforgery decryption, and it has to work **without** the Key Vault
  Crypto User role, because that role assignment is granted out of band and can lag a deployment.
  Folding the second step into the first would turn an optional hardening gap into a total
  authentication outage. The deployment template records the same reasoning as a follow-up
  (`MMCA.ADC/infra/main.bicep:1542-1547`). Both templates now ship the gate-2 path, default off (see the
  2026-09-10 revision); a deployment turns it on through the `DATA_PROTECTION_KEY_VAULT_KEY_URI`
  repository variable (`MMCA.ADC/.github/workflows/deploy.yml:1427-1428`,
  `MMCA.Store/.github/workflows/deploy.yml:1325-1326`). That is repository configuration, not source:
  as read on 2026-10-06 the variable is set on the ADC repository and absent on the Store repository.
- **One `DefaultAzureCredential` instance serves both sinks** (`AzureDataProtectionExtensions.cs:73`), so
  they share a single token cache. A deployed host authenticates with its managed identity and a
  developer machine falls back to the local Azure CLI or Visual Studio sign-in; ADC pins **which**
  identity with `AZURE_CLIENT_ID` on both adopting apps (`MMCA.ADC/infra/main.bicep:1996`, `:2816`).
- **ADC adopts it on exactly the two hosts that mint the payloads.** The Identity service calls it
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:126`) and so does the Web UI host
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:71`), each after `AddServiceDefaults()` and
  after `AddAzureMonitorExporter()`, which sits between the two (UI `:69`, Identity `:119`).
  `AddAzureKeyVaultConfiguration()` runs first in both hosts, ahead of `AddServiceDefaults()` itself
  (UI host `:62` -> `:64` -> `:71`; Identity service `:112` -> `:114` -> `:126`; the reason is in the
  comments at UI `:59-61` and Identity `:109-111`), because `ConfigurationManager` loads each source
  as it is added, so the vault has to be layered in before anything reads configuration, the blob URI
  included. The Conference, Engagement, Notification and
  Gateway hosts do not call it at all, because they mint neither a session cookie nor an antiforgery
  token.
- **In ADC, infrastructure provisions one private container, not a new storage account.**
  `dataprotection-keys` is created on the existing avatar storage account with `publicAccess: 'None'`
  (`MMCA.ADC/infra/main.bicep:1526-1532`), deliberately unlike the public `avatars` and
  `session-assets` containers beside it (`:1496-1502`, `:1512-1518`), and both apps are pointed at
  `.../dataprotection-keys/keys.xml` with the shared discriminator `MMCA.ADC` (`:1994-1995`,
  `:2814-2815`), unconditionally. No extra role assignment is needed: the ADR-045 Storage Blob Data
  Contributor grant is scoped to the storage **account**, so it already covers this container
  (`:1534-1541`, `:1550`). That grant is itself guarded by `grantAvatarStorageRole`, default `false`,
  because the deploy identity deliberately lacks role-assignment rights (`:133`, `:1535-1537`,
  `:1548`). The account's blob data-plane audit explicitly covers reads of
  `dataprotection-keys/keys.xml` (`:1466-1468`, diagnostic setting at `:1474`).
- **AWS: Parameter Store SecureString parameters.** `AddAwsDataProtection()` is gated on
  `DataProtection:SsmParameterPrefix` (`AwsDataProtectionExtensions.cs:59`, a no-op when blank at
  `:65`-`:68`, marker at `:72`) and persists through `PersistKeysToAWSSystemsManager` from
  `Amazon.AspNetCore.DataProtection.SSM` (`:80`; referenced at
  `MMCA.Common/Source/Hosting/MMCA.Common.Aws/MMCA.Common.Aws.csproj:22`, pinned at
  `MMCA.Common/Directory.Packages.props:164`). Each key is one SecureString parameter under the prefix,
  so KMS encrypts it at rest with no separate protection step (`:27`-`:29`). The optional
  `DataProtection:KmsKeyId` names the KMS key, else the account's `aws/ssm` key is used (`:37`-`:38`,
  applied at `:82`-`:85`), and the discriminator is the same `DataProtection:ApplicationName` with the
  host application name as fallback (`:74`-`:75`).
- **Google Cloud: one Cloud Storage object, written by the framework's own repository.**
  `AddGoogleCloudDataProtection()` is gated on `DataProtection:GcsObjectUri` in `gs://bucket/path/keys.xml`
  form (`GoogleCloudDataProtectionExtensions.cs:24`, `:37`-`:41`; read at `:78`, a no-op when blank at
  `:84`-`:87`, parsed at `:90`, marker at `:102`). `GcsXmlRepository` keeps the whole ring as one object,
  the shape the Azure Blob repository uses
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/DataProtection/GcsXmlRepository.cs:12`-`:15`), and writes
  it read-modify-write under `IfGenerationMatch` set to the generation it read, 0 meaning create only
  (`:17`-`:20`, `:84`-`:87`, `:118`-`:119`). A writer that loses the race gets 412, re-reads the ring
  that now holds the winner's key and retries, up to `MaxAttempts` (10) with a linear backoff of 50 ms
  per attempt (`:34`, `:90`-`:98`;
  `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/DataProtection/GcpDataProtectionBuilderExtensions.cs:21`),
  and then fails, naming the object (`GcsXmlRepository.cs:101`-`:102`). The optional
  `DataProtection:GcpKmsKeyName` encrypts each key with a Cloud KMS symmetric key
  (`GoogleCloudDataProtectionExtensions.cs:25`, validated at `:93`-`:98`, applied at `:111`-`:114`; the
  encryptor is wired at `GcpDataProtectionBuilderExtensions.cs:54`-`:59`), a separate optional step for
  the reason Azure gate 2 is (`GoogleCloudDataProtectionExtensions.cs:63`-`:66`). The repository and
  the KMS encryptor and decryptor are hand-written because Google's DataProtection packages are
  prerelease only and a stable package cannot depend on a prerelease (NU5104)
  (`MMCA.Common/Directory.Packages.props:187`-`:191`, `MMCA.Common/CHANGELOG.md:19`); see Alternatives
  rejected.
- **A host keeps exactly one key ring.** Each adapter's gate set without its call fails
  `ValidateOnStart`, naming the call
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:26`, `:32`,
  `:43`; checks at `:73`-`:77`, `:83`-`:87`, `:93`-`:97`), and setting more than one of
  `DataProtection:BlobStorageUri`, `DataProtection:SsmParameterPrefix` and `DataProtection:GcsObjectUri`
  fails startup as well (`:49`-`:54`, `:107`-`:112`): whichever registration runs last would own the
  repository, so services that disagree on the order would mint payloads the others cannot decrypt
  (`:104`-`:106`).
- **Each cloud's dependencies live in its own adapter package.**
  `Azure.Extensions.AspNetCore.DataProtection.Blobs` and `.Keys` are referenced by `MMCA.Common.Azure`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/MMCA.Common.Azure.csproj:16`-`:17`, pinned at
  `MMCA.Common/Directory.Packages.props:209`-`:210`), `Amazon.AspNetCore.DataProtection.SSM` by
  `MMCA.Common.Aws` (above), and `Google.Cloud.Kms.V1` by `MMCA.Common.Gcp`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/MMCA.Common.Gcp.csproj:23`, pinned at
  `Directory.Packages.props:192`), so a host references only the cloud it runs on.

**Both consumers have now adopted it (2026-08-13).** MMCA.Store originally had no call site and no
`DataProtection` configuration anywhere in the repo, even though its UI and Identity container apps
also run at `maxReplicas: 2` (`MMCA.Store/infra/main.bicep:2197` UI host, `:1688` Identity
service). Its UI host now calls `AddAzureDataProtection()` after `AddServiceDefaults()`, with
`AddAzureMonitorExporter()` and an ADR-069 comment block between them
(`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:64`, `:69`, `:71-74`, `:75`;
`AddAzureKeyVaultConfiguration()` precedes all of them at `:45`), and the infrastructure side has
landed and is live. Store diverges from ADC in three ways worth recording:

- **A new dedicated storage account, not a reused one.** Store has no public-blob workload to share an
  account with, so the template provisions its own `Standard_LRS` account `dataProtectionStorage` with
  `allowBlobPublicAccess: false` (`MMCA.Store/infra/main.bicep:1245-1263`) and its own private
  `dataprotection-keys` container (`:1270-1276`), with a diagnostic setting that sends the account's
  blob reads, writes and deletes to Log Analytics (`:1286`).
- **The blob URI is gated behind a readiness flag.** `DataProtection__ApplicationName='MMCA.Store'`
  (`:2166`) and `AZURE_CLIENT_ID` (the shared `azureClientIdEnv` entry at `:2168`, defined at
  `:1506-1509`) are unconditional, but
  `DataProtection__BlobStorageUri` is appended only when the `dataProtectionStorageReady` parameter is
  true (default `false` at `:101`, concatenated at `:2169-2170`). The flag exists because
  `AddAzureDataProtection` gates on the presence of the URI, never on reachability: wiring the URI
  before the data-plane grant exists would 403 on the first protect call rather than degrade. That
  flag has since been flipped true in production: the deploy workflow passes
  `"dataProtectionStorageReady": {"value": true}` in its base parameters
  (`MMCA.Store/.github/workflows/deploy.yml:1221`).
- **Its own role-assignment guard.** The Storage Blob Data Contributor grant is guarded by Store's
  own `grantDataProtectionStorageRole` parameter (default `false` at `:98`), with the account-scoped
  role assignment at `:1327-1335`, deliberately separate from the readiness flag above: one says whether
  THIS deployment creates the grant, the other says whether the grant already exists.

The framework side needed no change at all: the whole delta was one call site plus infrastructure,
against a capability that already shipped in the package Store consumes. Store's Identity service is
deliberately left out: it registers no cookie or OAuth scheme, so it mints no key-ring payload at all.

## Rationale
- **The key ring is the smallest thing that has to be shared.** Sticky sessions would paper over the
  symptom while making a replica restart a mass sign-out, and a shared cache would put auth keys in a
  cache with an eviction policy. One blob, read by every replica, matches the actual lifetime of the
  data.
- **Uncoupling the two gates is the load-bearing choice.** The correctness fix (persistence) and the
  hardening step (encryption at rest) have different failure modes and different prerequisites. If they
  were one switch, a role assignment that has not been applied yet would take authentication down for
  everyone, which is strictly worse than a key ring that is stored under an account-scoped data-plane
  grant and not additionally encrypted.
- **A silent no-op keeps the framework's default posture.** Local development, the test tiers and the
  Helpdesk seed are all single-process. Making the Azure path opt-in through the presence of one
  configuration value means no host pays an Azure dependency at startup for a problem it does not have.
- **Reusing the avatar storage account avoids new infrastructure, where there is one to reuse.** In
  ADC the account, its managed-identity grant and its deployment path already exist (ADR-045); a
  private container beside the public one is the whole delta. Store has no public-blob workload and
  therefore no account to ride on, so it provisions a dedicated one instead: the shared rule is the
  private container and the account-scoped grant, not the specific account.

## Trade-offs
- **The key ring is encrypted at rest only where gate 2 was switched on.** Both templates ship the
  path and both default it off (2026-09-10 revision), so on default parameters the ring is protected
  by the container being private and the account grant being narrow, not by a Key Vault key. Turning
  it on is a deployment decision (one repository variable plus the Key Vault Crypto User grant). That
  variable lives in repository configuration rather than source; as read on 2026-10-06 it is set for
  ADC, so the ADC Identity and UI deploys inject `DataProtection__KeyVaultKeyUri`, and unset for
  Store, whose UI ring stays unencrypted by a Key Vault key.
- **Opt-in per host, so adoption must be audited.** A scaled-out host that never calls
  `AddAzureDataProtection` keeps the broken per-replica default and fails intermittently rather than
  loudly, the same audit-the-inventory caveat as ADR-005 / ADR-017 / ADR-021. Store was exactly that
  case until its UI host adopted the call site (2026-08-13); the caveat still binds every future
  scaled-out host that mints a DataProtection payload.
- **Startup now depends on a credential resolving in the adopting hosts.** In Azure that is the
  user-assigned identity named by `AZURE_CLIENT_ID`; a missing or wrong identity turns a key-ring read
  into a startup-time failure on each of the three hosts that opt in (ADC Identity, ADC UI, Store UI).
- **A shared blob plus a shared discriminator means shared keys by design.** ADC's Identity service and
  UI host both use the discriminator `MMCA.ADC`, which is what makes their cookies mutually
  decryptable; a future app that should NOT share keys must get its own blob or its own
  `DataProtection:ApplicationName`, or it will silently join the same ring.
- **Local and deployed behavior differ.** Development runs the in-memory default, so a cross-replica
  decryption bug is by construction not reproducible locally: the deployed configuration is the only
  place the persisted path is exercised.

## Revision (2026-09-10)

**Gate 2 ships in both templates, default off, so "configured nowhere" is retired.** The framework
side is unchanged: `AddCommonDataProtection`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:52`) still
carries gate 1 at `:59-62` and gate 2 at `:81-85`, and this revision propagated no framework change.

Both consumers now carry the same three pieces, each guarded by a parameter that defaults to `false`
or empty:

| Piece | ADC | Store |
| --- | --- | --- |
| `createDataProtectionKeyVaultKey` param, default `false` | `infra/main.bicep:139` | `infra/main.bicep:100` |
| `dataprotection-kek` Key Vault key, created only under that flag | `:1339-1341` | `:1228-1230` |
| `dataProtectionKeyVaultKeyUri` param, default empty | `:142` | `:103` |
| `DataProtection__KeyVaultKeyUri` env entry | `:1634` (Identity), `:2355` (UI) | `:1999` (UI) |
| Repository-variable plumbing in `deploy.yml` | `:1395`, `:1575-1576` | `:1290`, `:1417-1418` |

The env inventory differs because the adopting-host inventory differs, not because the posture does:
ADC mints auth payloads on two hosts (Identity and the UI) and Store on one (the UI, whose Identity
service registers no cookie or OAuth scheme and so mints no key-ring payload). The workflow half is
the same shape in both, a `jq` set that runs only when the repository variable is non-empty, which is
what keeps the default deploy unchanged.

What this does not establish is whether the variable is set in either production, and that stays
unverifiable from the repositories. The honest reading of the trade-off above is therefore "shipped
and off by default", not "enabled".

Re-pinned call sites while here: ADC Identity
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:113`), ADC UI
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:46`), Store UI
(`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:70`, `AddServiceDefaults` at `:64`);
and on the gate-1 side, Store's `dataProtectionStorageReady` default at
`MMCA.Store/infra/main.bicep:97`, its production flip at
`MMCA.Store/.github/workflows/deploy.yml:1324`, and the role-assignment guard
`grantDataProtectionStorageRole` at `MMCA.Store/infra/main.bicep:94` with the assignment at `:1197`.

## Revision (2026-10-01)

No decision or rationale changed; this revision refreshes citations only. Re-anchored in Context,
Decision and the Store adoption notes: the ADC replica caps, sticky UI ingress, gate-2 follow-up
comment, `AZURE_CLIENT_ID` entries, `dataprotection-keys` container, blob URI and discriminator env
entries, and the `grantAvatarStorageRole` guard and account-scoped assignment
(`MMCA.ADC/infra/main.bicep:133`, `:1294-1322`, `:1743-1745`, `:1843`, `:2485-2487`, `:2524-2526`,
`:2586`); the ADC call sites and their ordering
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:99`, `:107`, `:114`;
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:51`, `:59`, `:61`); the Aspire package
references and central pins (`MMCA.Common.Aspire.csproj:42-43`, `Directory.Packages.props:152-153`,
`:158`); and the Store call site, dedicated account, container, env entries, readiness flag, role
guard and production flip (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:62`, `:68`;
`MMCA.Store/infra/main.bicep:94`, `:97`, `:1162-1193`, `:1244-1252`, `:1591`, `:2056-2061`, `:2087`;
`MMCA.Store/.github/workflows/deploy.yml:1260`). The 2026-09-10 revision above keeps its anchors as a
historical record; the current gate-2 locations are ADC `infra/main.bicep:142`, `:145`, `:1502-1504`,
`:1799` (Identity), `:2544` (UI) and `deploy.yml:1281`, `:1461-1462`, and Store `infra/main.bicep:100`,
`:103`, `:1275-1277`, `:2067` (UI) and `deploy.yml:1226`, `:1353-1354`.

## Revision (2026-10-06)

- **ADC call ordering corrected.** Both ADC hosts now run `AddCommonKeyVaultConfiguration()` before
  `AddServiceDefaults()` (Identity `Program.cs:110` -> `:112` -> `:119`; UI `Program.cs:61` -> `:63` ->
  `:65`), so the earlier "Key Vault sits between `AddServiceDefaults()` and the registration call"
  wording is retired; the vault still loads before the blob URI is read.
- **ADC replica cap corrected.** Identity and UI scale to `conferenceScaledMaxReplicas`
  (`MMCA.ADC/infra/main.bicep:191`, 2, or 4 in conference mode), not a literal 2.
- **Gate 2 state recorded per consumer.** The `DATA_PROTECTION_KEY_VAULT_KEY_URI` repository variable
  is set on ADC and absent on Store as read on 2026-10-06 (repository configuration, not source), so
  "shipped and off by default" now holds for Store only.
- **Omissions filled.** ADC's `session-assets` public container beside `dataprotection-keys`, the ADC
  blob audit covering `keys.xml`, Store's blob diagnostic setting, and Store's shared
  `azureClientIdEnv` entry.
- Anchors in Context, Decision, the Store adoption notes and Trade-offs were re-verified against
  current source. Current gate-2 locations: ADC `infra/main.bicep:142`, `:145`, `:1529-1531`, `:1826`
  (Identity), `:2594` (UI) and `deploy.yml:1339`, `:1519-1520`; Store `infra/main.bicep:100`, `:103`,
  `:1275-1277`, `:2077` (UI) and `deploy.yml:1281`, `:1408-1409`.

## Revision (2026-10-07)

Re-verified against current source. No decision, rationale or trade-off changed: both gates,
the two ADC adopting hosts and their call ordering (Identity `Program.cs:110` -> `:112` -> `:119`;
UI `Program.cs:61` -> `:63` -> `:65`), the Store UI adoption (`Program.cs:44`, `:63`, `:69`), the
private `dataprotection-keys` container, the unconditional blob URI and discriminator, and the
absence of session affinity on Identity (the one non-sticky host of the two minting hosts) all hold. What moved is line numbers in the ADC template
and both deploy workflows, plus one cross-reference.

1. **Related now points at ADR-024.** The SignalR hub client skips negotiation and connects over
   WebSockets only (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:537-538`,
   rationale in the doc comment at `:511-516`): with no separate negotiate request, connect cannot
   land on a replica that never issued the connection id, so the hub needs no session affinity
   either. That is the same no-affinity stance this record takes for Identity, reached by a different
   mechanism.
2. Anchors re-verified against current source: ADC `infra/main.bicep:192`
   (`conferenceScaledMaxReplicas`), `:1914` (Identity scale), `:2692` (UI scale), `:2582-2584`
   (sticky UI ingress, the only `stickySessions` block in the file), `:1342-1348`
   (`dataprotection-keys`, `publicAccess: 'None'`), `:1312-1318` (`avatars`), `:1328-1334`
   (`session-assets`), `:1350-1357` and `:1364` (account-scoped grant), `:1350-1354` and `:1362`
   (`grantAvatarStorageRole` guard; param still `:133`), `:1358-1361` (gate-2 follow-up comment),
   `:1282-1284` (blob audit), `:1802-1804` and `:2622-2624` (blob URI, discriminator,
   `AZURE_CLIENT_ID`); Store `deploy.yml:1202` (production flip of `dataProtectionStorageReady`).
   Current gate-2 locations: ADC `infra/main.bicep:142`, `:145`, `:1553` (comment `:1543-1552`),
   `:1857-1858` (Identity), `:2641-2642` (UI) and `deploy.yml:1233`, `:1411-1412`; Store
   `deploy.yml:1168`, `:1295-1296`. The earlier revisions keep their anchors as a historical record.

## Revision (2026-10-21)

Re-verified against current source. No decision, rationale or trade-off changed: both gates
(`DataProtectionExtensions.cs:59-62`, `:81-85`), the ADC call ordering (Identity `Program.cs:111` ->
`:113` -> `:120`; UI `Program.cs:61` -> `:63` -> `:65`), the Store UI adoption (`Program.cs:44`,
`:63`, `:69`), the private `dataprotection-keys` containers, the unconditional ADC blob URI and
discriminator, the Store readiness flag, and the absence of session affinity on the ADC Identity
service all hold. What moved is line numbers in both infrastructure templates, both deploy
workflows and the ADC Identity host.

1. Anchors re-verified against current source: ADC Identity
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:111`, `:113`, `:120` (comment
   `:108-110`); ADC `infra/main.bicep:192` (`conferenceScaledMaxReplicas`), `:2070` (Identity scale,
   inside `identityApp` at `:1825`), `:2848` (UI scale, inside `uiApp` at `:2719`), `:2738-2740`
   (sticky UI ingress, still the only `stickySessions` block), `:1492-1498` (`dataprotection-keys`,
   `publicAccess: 'None'`), `:1462-1467` (`avatars`), `:1478-1483` (`session-assets`), `:1500-1507`
   and `:1514` (account-scoped grant comment and scope), `:1502-1504` and `:1512`
   (`grantAvatarStorageRole` guard; param still `:133`), `:1508-1511` (gate-2 follow-up comment),
   `:1432-1434` (blob audit), `:1958-1960` and `:2778-2780` (blob URI, discriminator,
   `AZURE_CLIENT_ID`); Store `infra/main.bicep:98` (`grantDataProtectionStorageRole`), `:101`
   (`dataProtectionStorageReady`), `:1241-1259` (dedicated account), `:1266-1272` (container),
   `:1282` (diagnostic setting), `:1323-1331` (role assignment), `:1500-1503` (`azureClientIdEnv`),
   `:2160`, `:2162`, `:2163-2164` (UI env entries), `:2191` (UI scale), `:1682` (Identity scale) and
   `deploy.yml:1220` (production flip of `dataProtectionStorageReady`). Current gate-2 locations:
   ADC `infra/main.bicep:142`, `:145`, `:1703` (comment `:1693-1702`), `:2013-2014` (Identity),
   `:2797-2798` (UI), gated by `hasDataProtectionKek` at `:166`, and `deploy.yml:1248`,
   `:1426-1427`; Store `infra/main.bicep:104`, `:107`, `:1354`, `:2171` (UI) and `deploy.yml:1186`,
   `:1324-1325`.

## Revision (2026-10-24)
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) moves the key-ring registration out of
MMCA.Common.Aspire into the `MMCA.Common.Azure` adapter. The decision, both gates and the keys are
unchanged.

1. **The call is renamed and moved.** `AddCommonDataProtection()` is now `AddAzureDataProtection()`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureDataProtectionExtensions.cs:20`, `:53`). It
   still reads `DataProtection:BlobStorageUri` (`:59`) and does nothing without it (`:64`-`:67`), takes
   the discriminator from `DataProtection:ApplicationName` (`:69`-`:70`), persists to the blob
   (`:75`-`:77`), and adds Key Vault protection only for `DataProtection:KeyVaultKeyUri`
   (`:86`-`:90`).
2. **A lost call now fails startup.** `DataProtection:BlobStorageUri` set without the call fails
   `ValidateOnStart`, naming it
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:26`, `:31`;
   the call's marker at `AzureDataProtectionExtensions.cs:57`). That narrows the "opt-in per host"
   trade-off to hosts that never received the URI at all.
3. **Corrected in place:** the Decision and Trade-offs references to `AddCommonDataProtection` and the
   `MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs` anchors now point at the adapter.
   The consumer call-site sentences name the call each consumer made when last verified; a consumer on
   v1.255.0 or later makes the renamed call. The anchors inside earlier revisions are left as recorded.

## Alternatives rejected
- **Google's own ASP.NET Core DataProtection packages (for example
  `Google.Cloud.AspNetCore.DataProtection.Kms`) instead of a hand-written repository and encryptor.**
  Weighed 2026-10-25 and declined. They are prerelease only, and a stable `MMCA.Common.Gcp` cannot
  depend on a prerelease package (NU5104) (`MMCA.Common/Directory.Packages.props:189`-`:190`,
  `MMCA.Common/CHANGELOG.md:19`). The cost is code the framework now maintains: one repository
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/DataProtection/GcsXmlRepository.cs:31`) and a KMS
  encryptor and decryptor pair beside it. Revisit when Google publishes stable releases of those
  packages; the adapter call and its keys can stay while the implementation moves to them.

## Revision (2026-10-25)
MMCA.Common v1.257.0 ships the key ring for two more clouds (`MMCA.Common/CHANGELOG.md:7`, `:13`,
`:19`). The decision for ADC and Store, both gates of the Azure adapter and its keys are unchanged.

1. **Three adapters.** Azure Blob + Key Vault
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureDataProtectionExtensions.cs:53`), AWS Parameter
   Store SecureString parameters, gate `DataProtection:SsmParameterPrefix`, optional `KmsKeyId`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsDataProtectionExtensions.cs:57`, `:59`, `:76`), and
   one Cloud Storage object, gate `DataProtection:GcsObjectUri`, optional
   `DataProtection:GcpKmsKeyName`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GoogleCloudDataProtectionExtensions.cs:24`-`:25`, `:76`),
   written under `IfGenerationMatch` with a bounded retry
   (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/DataProtection/GcsXmlRepository.cs:34`, `:87`). The
   Decision's opening paragraph is restated across the three and gains one bullet per new adapter.
2. **The startup tripwire now fails when more than one key-ring gate is set**
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:49`-`:54`,
   `:107`-`:112`; `MMCA.Common/CHANGELOG.md:33`), on top of failing each gate set without its call.
3. **Google's prerelease packages are a rejected alternative**, recorded above with the NU5104 reason
   and the revisit condition.
4. **Corrected in place:** the Decision bullet "The Azure dependencies live in the Aspire package only".
   Since [ADR-134](134-cloud-neutral-core-vendor-adapters.md) the two Azure DataProtection packages are
   referenced by `MMCA.Common.Azure`, and the direct `System.Security.Cryptography.Xml` pin that bullet
   cited is no longer in `MMCA.Common/Directory.Packages.props`. The anchors inside earlier revisions
   are left as recorded.

## Revision (2026-10-26)
Re-verified against current source. No decision, rationale or trade-off changed: both Azure gates,
the two ADC adopting hosts, the Store UI adoption, the private `dataprotection-keys` containers, the
unconditional ADC blob URI and discriminator, the Store readiness flag and its production flip, and
the absence of session affinity on the ADC Identity service all hold. What moved is the consumer
call-site wording and line numbers across both hosts, both templates and both deploy workflows.

1. **Consumer call sites name the current calls.** ADC and Store now call
   `AddAzureKeyVaultConfiguration()` and `AddAzureDataProtection()`; neither old name remains in
   their source. The ordering still holds (vault, then `AddServiceDefaults()`, then the
   registration), and `AddAzureMonitorExporter()` now sits between the defaults call and the
   registration in all three adopting hosts
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:62`, `:64`, `:69`, `:71`;
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:112`, `:114`, `:119`, `:126`;
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:45`, `:64`, `:69`, `:75`).
2. **Store's "immediately after, with only an ADR-069 comment block between them" is retired.** The
   Store UI host places `AddAzureMonitorExporter()` (`Program.cs:69`, comment `:66-68`) before the
   ADR-069 comment (`:71-74`) and the registration (`:75`); the Decision's Store paragraph is
   corrected in place.
3. Anchors re-verified against current source: ADC Key Vault ordering comments UI `Program.cs:59-61`
   and Identity `Program.cs:109-111`; ADC `infra/main.bicep:192` (`conferenceScaledMaxReplicas`),
   `:2106` (Identity scale, inside `identityApp` at `:1861`), `:2884` (UI scale, inside `uiApp` at
   `:2755`), `:2774-2776` (sticky UI ingress, still the only `stickySessions` block), `:1526-1532`
   (`dataprotection-keys`, `publicAccess: 'None'` at `:1530`), `:1496-1502` (`avatars`),
   `:1512-1518` (`session-assets`), `:1534-1541` and `:1550` (account-scoped grant comment and
   scope), `:1535-1537` and `:1548` (`grantAvatarStorageRole` guard; param still `:133`),
   `:1542-1547` (gate-2 follow-up comment), `:1466-1468` and `:1474` (blob audit comment and
   diagnostic setting), `:1994-1996` and `:2814-2816` (blob URI, discriminator, `AZURE_CLIENT_ID`);
   `MMCA.Common/Directory.Packages.props:209-210` (Azure DataProtection pins);
   `deploy.yml` gate-2 plumbing ADC `:1249`, `:1427-1428` and Store `:1187`, `:1325-1326`; Store
   `infra/main.bicep:98`, `:101`, `:1245-1263` (dedicated account), `:1270-1276` (container),
   `:1286` (diagnostic setting), `:1327-1335` (role assignment), `:1506-1509`
   (`azureClientIdEnv`), `:2166`, `:2168`, `:2169-2170` (UI env entries), `:2197` (UI scale, inside
   `uiApp` at `:2101`), `:1688` (Identity scale) and `deploy.yml:1221` (production flip of
   `dataProtectionStorageReady`). The earlier revisions keep their anchors as a historical record.

## Related
ADR-022 (the browser session cookies whose decryption this makes replica-independent, together with
the antiforgery tokens the SSR pages mint), ADR-008 (the multi-host topology that created the problem;
the adopting hosts are the ones that mint auth payloads), ADR-061 (managed identity as the runtime
credential model, which this reuses for a payload that is state rather than a secret), ADR-045 (the
storage account, the account-scoped data-plane grant, and the `DefaultAzureCredential` pattern this
container rides on), ADR-024 (the WebSockets-only SignalR client transport, recorded in its
2026-10-07 revision: with no negotiate request, connect cannot land on a different replica than
negotiate, so the hub needs no session affinity either).
