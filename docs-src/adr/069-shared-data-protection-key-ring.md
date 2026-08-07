# ADR-069: Shared DataProtection Key Ring for Scaled-Out Hosts

## Status
Accepted (2026-08-07).

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
`maxReplicas: 2` with no session affinity (`MMCA.ADC/infra/main.bicep:1178`, `:1759-1761`).

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
  `:40-61`). Neither test needs Azure credentials: the blob client is constructed lazily by the
  repository, never at registration time.
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
  (`MMCA.ADC/infra/main.bicep:821-824`), and no deployed app sets `DataProtection__KeyVaultKeyUri`
  today, so gate 2 is configured nowhere: the key ring is persisted but not encrypted at rest.
- **One `DefaultAzureCredential` instance serves both sinks** (`DataProtectionExtensions.cs:68`), so
  they share a single token cache. A deployed host authenticates with its managed identity and a
  developer machine falls back to the local Azure CLI or Visual Studio sign-in; ADC pins **which**
  identity with `AZURE_CLIENT_ID` on both adopting apps (`MMCA.ADC/infra/main.bicep:1111`, `:1720`).
- **ADC adopts it on exactly the two hosts that mint the payloads.** The Identity service calls it
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:118`) and so does the Web UI host
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:31`), both immediately after
  `AddServiceDefaults()`. The Conference, Engagement, Notification and Gateway hosts do not, because
  they mint neither a session cookie nor an antiforgery token.
- **Infrastructure provisions one private container, not a new storage account.**
  `dataprotection-keys` is created on the existing avatar storage account with `publicAccess: 'None'`
  (`MMCA.ADC/infra/main.bicep:806-812`), deliberately unlike the public `avatars` container beside it,
  and both apps are pointed at `.../dataprotection-keys/keys.xml` with the shared discriminator
  `MMCA.ADC` (`:1109-1110`, `:1718-1719`). No extra role assignment is needed: the ADR-045 Storage Blob
  Data Contributor grant is scoped to the storage **account**, so it already covers this container
  (`:819-820`). That grant is itself guarded by `grantAvatarStorageRole`, default `false`, because the
  deploy identity deliberately lacks role-assignment rights (`:113`, `:825`).
- **The Azure dependencies live in the Aspire package only.**
  `Azure.Extensions.AspNetCore.DataProtection.Blobs` and `.Keys` are referenced by
  `MMCA.Common.Aspire` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/MMCA.Common.Aspire.csproj:23-24`)
  and pinned centrally (`MMCA.Common/Directory.Packages.props:70-71`), alongside a direct
  `System.Security.Cryptography.Xml` pin that lifts that chain's transitive off a vulnerable version
  for consumers without the ASP.NET Core framework reference (`Directory.Packages.props:76`).

**Adoption is partial, and that is the current state, not an oversight in the record.** MMCA.Store has
**no** call site and no `DataProtection` configuration anywhere in the repo, even though its UI and
Identity container apps also run at `maxReplicas: 2` (`MMCA.Store/infra/main.bicep:1169`, `:829`). The
capability ships in the framework package Store already consumes; adopting it there is a call site plus
a container and two environment variables. Recording a framework capability that one consumer has taken
up and another has not is the same posture as ADR-018 and ADR-020.

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
- **Reusing the avatar storage account avoids new infrastructure.** The account, its managed-identity
  grant and its deployment path already exist (ADR-045); a private container beside the public one is
  the whole delta.

## Trade-offs
- **The key ring is not encrypted at rest today.** Gate 2 is implemented but configured nowhere, so the
  ring is protected by the container being private and the account grant being narrow, not by a Key
  Vault key. Closing that needs a Key Vault Crypto User grant plus one environment variable per app.
- **Opt-in per host, so adoption must be audited.** A scaled-out host that never calls
  `AddCommonDataProtection` keeps the broken per-replica default and fails intermittently rather than
  loudly, the same audit-the-inventory caveat as ADR-005 / ADR-017 / ADR-021. Store is exactly that
  case today.
- **Startup now depends on a credential resolving in the adopting hosts.** In Azure that is the
  user-assigned identity named by `AZURE_CLIENT_ID`; a missing or wrong identity turns a key-ring read
  into a startup-time failure on the two hosts that opt in.
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
