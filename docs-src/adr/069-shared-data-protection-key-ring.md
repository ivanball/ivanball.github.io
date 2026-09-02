# ADR-069: Shared DataProtection Key Ring for Scaled-Out Hosts

## Status
Accepted (2026-08-07). Updated 2026-08-14: Store's adoption has landed and is live (its own dedicated
storage account, gated on `dataProtectionStorageReady`), and the ADC call-site ordering is recorded
precisely (Key Vault configuration loads between `AddServiceDefaults()` and the registration call).

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
Identity service, which also does OAuth correlation and state cookie cryptography) both run at
`maxReplicas: 2` (`MMCA.ADC/infra/main.bicep:1177` Identity service, `:1811` UI host). Only the
Identity service runs with **no session affinity**; the UI ingress is sticky
(`MMCA.ADC/infra/main.bicep:1730-1732`), which narrows the UI window rather than closing it, since
affinity is lost on a replica restart, a revision swap, or a dropped affinity cookie.

Nothing in the record decided **where the key ring lives**. ADR-061 decides how a running app reaches
a secret (Key Vault reference resolved by a managed identity) and ADR-045 decides that blob storage is
reached with `DefaultAzureCredential` plus a data-plane role, but the key ring is neither an app secret
nor user content: it is process-local state that has to become deployment-wide state. This record
decides that, and it records which repos have adopted it.

## Decision
Add one opt-in registration call, `AddCommonDataProtection`, that persists the key ring to a single
Azure blob so every replica of a host shares one ring
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:52`).

- **One configuration key is the gate, and absent means do nothing.**
  `DataProtection:BlobStorageUri` is read first (`DataProtectionExtensions.cs:54`); when it is absent
  or whitespace the method returns the builder untouched (`:59-62`), so no DataProtection services are
  registered at all. A developer machine, a test host, and the Helpdesk seed all run single-process,
  where the in-memory default is correct and an unconditional Azure dependency at startup would be a
  liability. Two tests pin that boundary: an unconfigured builder registers no `IDataProtectionProvider`
  and leaves `KeyManagementOptions.XmlRepository` null, while a configured URI replaces the default
  repository with the blob one
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/DataProtection/DataProtectionExtensionsTests.cs:22-37`,
  `:39-67`, which asserts the replacement is the `Azure.Extensions.AspNetCore.DataProtection.Blobs`
  repository specifically). Neither test needs Azure credentials: the blob client is constructed
  lazily by the repository, never at registration time.
- **Blob persistence plus an application discriminator.** A configured URI wires
  `PersistKeysToAzureBlobStorage` and `SetApplicationName`
  (`DataProtectionExtensions.cs:70-72`); the discriminator comes from `DataProtection:ApplicationName`
  and falls back to the host application name (`:64-65`). The discriminator is what keeps two
  applications sharing one blob or one key-ring directory from reading each other's keys.
- **Encryption of the key ring at rest is a SECOND, deliberately independent gate.**
  `DataProtection:KeyVaultKeyUri` is read separately and only adds `ProtectKeysWithAzureKeyVault` when
  present (`:81-85`). The two are uncoupled on purpose (`:74-80`): blob persistence is the part that
  fixes cross-replica cookie and antiforgery decryption, and it has to work **without** the Key Vault
  Crypto User role, because that role assignment is granted out of band and can lag a deployment.
  Folding the second step into the first would turn an optional hardening gap into a total
  authentication outage. The deployment template records the same reasoning as a follow-up
  (`MMCA.ADC/infra/main.bicep:802-805`), and no deployed app sets `DataProtection__KeyVaultKeyUri`
  today, so gate 2 is configured nowhere: the key ring is persisted but not encrypted at rest.
- **One `DefaultAzureCredential` instance serves both sinks** (`DataProtectionExtensions.cs:68`), so
  they share a single token cache. A deployed host authenticates with its managed identity and a
  developer machine falls back to the local Azure CLI or Visual Studio sign-in; ADC pins **which**
  identity with `AZURE_CLIENT_ID` on both adopting apps (`MMCA.ADC/infra/main.bicep:1097`, `:1764`).
- **ADC adopts it on exactly the two hosts that mint the payloads.** The Identity service calls it
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:111`) and so does the Web UI host
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:40`). Neither call sits immediately after
  `AddServiceDefaults()`: `AddCommonKeyVaultConfiguration()` deliberately sits between them in both
  hosts (UI host `:30` -> `:38` -> `:40`; Identity service `:96` -> `:104` -> `:111`), because
  `ConfigurationManager` loads each source as it is added, so the vault has to be layered in before
  anything reads the blob URI out of configuration. The Conference, Engagement, Notification and
  Gateway hosts do not call it at all, because they mint neither a session cookie nor an antiforgery
  token.
- **In ADC, infrastructure provisions one private container, not a new storage account.**
  `dataprotection-keys` is created on the existing avatar storage account with `publicAccess: 'None'`
  (`MMCA.ADC/infra/main.bicep:787-793`), deliberately unlike the public `avatars` container beside it,
  and both apps are pointed at `.../dataprotection-keys/keys.xml` with the shared discriminator
  `MMCA.ADC` (`:1095-1096`, `:1762-1763`), unconditionally. No extra role assignment is needed: the
  ADR-045 Storage Blob Data Contributor grant is scoped to the storage **account**, so it already
  covers this container (`:800-801`, `:808`). That grant is itself guarded by `grantAvatarStorageRole`,
  default `false`, because the deploy identity deliberately lacks role-assignment rights (`:122`,
  `:806-814`).
- **The Azure dependencies live in the Aspire package only.**
  `Azure.Extensions.AspNetCore.DataProtection.Blobs` and `.Keys` are referenced by
  `MMCA.Common.Aspire` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/MMCA.Common.Aspire.csproj:28-29`)
  and pinned centrally (`MMCA.Common/Directory.Packages.props:119-120`), alongside a direct
  `System.Security.Cryptography.Xml` pin that lifts that chain's transitive off a vulnerable version
  for consumers without the ASP.NET Core framework reference (`Directory.Packages.props:125`).

**Both consumers have now adopted it (2026-08-13).** MMCA.Store originally had no call site and no
`DataProtection` configuration anywhere in the repo, even though its UI and Identity container apps
also run at `maxReplicas: 2` (`MMCA.Store/infra/main.bicep:1455` UI host, `:1042` Identity
service). Its UI host now calls `AddCommonDataProtection()` immediately after `AddServiceDefaults()`
(`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:76`, `:82`), and the infrastructure side has
landed and is live. Store diverges from ADC in three ways worth recording:

- **A new dedicated storage account, not a reused one.** Store has no public-blob workload to share an
  account with, so the template provisions its own `Standard_LRS` account `dataProtectionStorage` with
  `allowBlobPublicAccess: false` (`MMCA.Store/infra/main.bicep:746-764`) and its own private
  `dataprotection-keys` container (`:771-777`).
- **The blob URI is gated behind a readiness flag.** `DataProtection__ApplicationName='MMCA.Store'`
  (`:1438`) and `AZURE_CLIENT_ID` (`:1440`) are unconditional, but
  `DataProtection__BlobStorageUri` is appended only when the `dataProtectionStorageReady` parameter is
  true (default `false` at `:89`, concatenated at `:1441-1443`). The flag exists because
  `AddCommonDataProtection` gates on the presence of the URI, never on reachability: wiring the URI
  before the data-plane grant exists would 403 on the first protect call rather than degrade. That
  flag has since been flipped true in production: the deploy workflow passes
  `"dataProtectionStorageReady": {"value": true}` in its base parameters
  (`MMCA.Store/.github/workflows/deploy.yml:1043`).
- **Its own role-assignment guard.** The Storage Blob Data Contributor grant is guarded by Store's
  own `grantDataProtectionStorageRole` parameter (default `false` at `:86`), with the account-scoped
  role assignment at `:795-803`, deliberately separate from the readiness flag above: one says whether
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
- **The key ring is not encrypted at rest today.** Gate 2 is implemented but configured nowhere, so the
  ring is protected by the container being private and the account grant being narrow, not by a Key
  Vault key. Closing that needs a Key Vault Crypto User grant plus one environment variable per app.
- **Opt-in per host, so adoption must be audited.** A scaled-out host that never calls
  `AddCommonDataProtection` keeps the broken per-replica default and fails intermittently rather than
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

## Related
ADR-022 (the browser session cookies whose decryption this makes replica-independent, together with
the antiforgery tokens the SSR pages mint), ADR-008 (the multi-host topology that created the problem;
the adopting hosts are the ones that mint auth payloads), ADR-061 (managed identity as the runtime
credential model, which this reuses for a payload that is state rather than a secret), ADR-045 (the
storage account, the account-scoped data-plane grant, and the `DefaultAzureCredential` pattern this
container rides on).
