# ADR-069: Shared DataProtection Key Ring for Scaled-Out Hosts

## Status
Accepted (2026-08-07). Updated 2026-08-14: Store's adoption has landed and is live (its own dedicated
storage account, gated on `dataProtectionStorageReady`), and the ADC call-site ordering is recorded
precisely. Revised 2026-09-10: gate 2 ships in both templates, default off. Revised 2026-10-01:
citations refreshed. Revised 2026-10-06: in both ADC hosts Key Vault configuration now loads before
`AddServiceDefaults()` (still before the registration call), the ADC replica cap is
`conferenceScaledMaxReplicas`, and gate 2 is recorded as switched on for ADC and off for Store.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release, and Related now points at ADR-024
for the WebSockets-only SignalR client that needs no session affinity.

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
(`MMCA.ADC/infra/main.bicep:192`; `:1914` Identity service, `:2692` UI host). Of those two
minting hosts, only the Identity service runs with **no session affinity**; the UI ingress is sticky
(`MMCA.ADC/infra/main.bicep:2582-2584`), which narrows the UI window rather than closing it, since
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
  (`MMCA.ADC/infra/main.bicep:1358-1361`). Both templates now ship the gate-2 path, default off (see the
  2026-09-10 revision); a deployment turns it on through the `DATA_PROTECTION_KEY_VAULT_KEY_URI`
  repository variable (`MMCA.ADC/.github/workflows/deploy.yml:1411-1412`,
  `MMCA.Store/.github/workflows/deploy.yml:1295-1296`). That is repository configuration, not source:
  as read on 2026-10-06 the variable is set on the ADC repository and absent on the Store repository.
- **One `DefaultAzureCredential` instance serves both sinks** (`DataProtectionExtensions.cs:68`), so
  they share a single token cache. A deployed host authenticates with its managed identity and a
  developer machine falls back to the local Azure CLI or Visual Studio sign-in; ADC pins **which**
  identity with `AZURE_CLIENT_ID` on both adopting apps (`MMCA.ADC/infra/main.bicep:1804`, `:2624`).
- **ADC adopts it on exactly the two hosts that mint the payloads.** The Identity service calls it
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:119`) and so does the Web UI host
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:65`), each after `AddServiceDefaults()`.
  `AddCommonKeyVaultConfiguration()` runs first in both hosts, ahead of `AddServiceDefaults()` itself
  (UI host `:61` -> `:63` -> `:65`; Identity service `:110` -> `:112` -> `:119`; the reason is in the
  comments at UI `:58-60` and Identity `:107-109`), because `ConfigurationManager` loads each source
  as it is added, so the vault has to be layered in before anything reads configuration, the blob URI
  included. The Conference, Engagement, Notification and
  Gateway hosts do not call it at all, because they mint neither a session cookie nor an antiforgery
  token.
- **In ADC, infrastructure provisions one private container, not a new storage account.**
  `dataprotection-keys` is created on the existing avatar storage account with `publicAccess: 'None'`
  (`MMCA.ADC/infra/main.bicep:1342-1348`), deliberately unlike the public `avatars` and
  `session-assets` containers beside it (`:1312-1318`, `:1328-1334`), and both apps are pointed at
  `.../dataprotection-keys/keys.xml` with the shared discriminator `MMCA.ADC` (`:1802-1803`,
  `:2622-2623`), unconditionally. No extra role assignment is needed: the ADR-045 Storage Blob Data
  Contributor grant is scoped to the storage **account**, so it already covers this container
  (`:1350-1357`, `:1364`). That grant is itself guarded by `grantAvatarStorageRole`, default `false`,
  because the deploy identity deliberately lacks role-assignment rights (`:133`, `:1350-1354`,
  `:1362`). The account's blob data-plane audit explicitly covers reads of
  `dataprotection-keys/keys.xml` (`:1282-1284`).
- **The Azure dependencies live in the Aspire package only.**
  `Azure.Extensions.AspNetCore.DataProtection.Blobs` and `.Keys` are referenced by
  `MMCA.Common.Aspire` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/MMCA.Common.Aspire.csproj:42-43`)
  and pinned centrally (`MMCA.Common/Directory.Packages.props:148-149`), alongside a direct
  `System.Security.Cryptography.Xml` pin that lifts that chain's transitive off a vulnerable version
  for consumers without the ASP.NET Core framework reference (`Directory.Packages.props:154`).

**Both consumers have now adopted it (2026-08-13).** MMCA.Store originally had no call site and no
`DataProtection` configuration anywhere in the repo, even though its UI and Identity container apps
also run at `maxReplicas: 2` (`MMCA.Store/infra/main.bicep:2097` UI host, `:1591` Identity
service). Its UI host now calls `AddCommonDataProtection()` immediately after `AddServiceDefaults()`,
with only an ADR-069 comment block between them
(`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:63`, `:69`; `AddCommonKeyVaultConfiguration()`
precedes both at `:44`), and the infrastructure side has
landed and is live. Store diverges from ADC in three ways worth recording:

- **A new dedicated storage account, not a reused one.** Store has no public-blob workload to share an
  account with, so the template provisions its own `Standard_LRS` account `dataProtectionStorage` with
  `allowBlobPublicAccess: false` (`MMCA.Store/infra/main.bicep:1162-1180`) and its own private
  `dataprotection-keys` container (`:1187-1193`), with a diagnostic setting that sends the account's
  blob reads, writes and deletes to Log Analytics (`:1203`).
- **The blob URI is gated behind a readiness flag.** `DataProtection__ApplicationName='MMCA.Store'`
  (`:2066`) and `AZURE_CLIENT_ID` (the shared `azureClientIdEnv` entry at `:2068`, defined at
  `:1412-1415`) are unconditional, but
  `DataProtection__BlobStorageUri` is appended only when the `dataProtectionStorageReady` parameter is
  true (default `false` at `:97`, concatenated at `:2069-2071`). The flag exists because
  `AddCommonDataProtection` gates on the presence of the URI, never on reachability: wiring the URI
  before the data-plane grant exists would 403 on the first protect call rather than degrade. That
  flag has since been flipped true in production: the deploy workflow passes
  `"dataProtectionStorageReady": {"value": true}` in its base parameters
  (`MMCA.Store/.github/workflows/deploy.yml:1202`).
- **Its own role-assignment guard.** The Storage Blob Data Contributor grant is guarded by Store's
  own `grantDataProtectionStorageRole` parameter (default `false` at `:94`), with the account-scoped
  role assignment at `:1244-1252`, deliberately separate from the readiness flag above: one says whether
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

## Related
ADR-022 (the browser session cookies whose decryption this makes replica-independent, together with
the antiforgery tokens the SSR pages mint), ADR-008 (the multi-host topology that created the problem;
the adopting hosts are the ones that mint auth payloads), ADR-061 (managed identity as the runtime
credential model, which this reuses for a payload that is state rather than a secret), ADR-045 (the
storage account, the account-scoped data-plane grant, and the `DefaultAzureCredential` pattern this
container rides on), ADR-024 (the WebSockets-only SignalR client transport, recorded in its
2026-10-07 revision: with no negotiate request, connect cannot land on a different replica than
negotiate, so the hub needs no session affinity either).
