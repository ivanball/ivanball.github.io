# ADR-134: Cloud-Neutral Core With Vendor Adapter Packages

## Status
Accepted (2026-10-24). The change is the MMCA.Common v1.255.0 entry of the framework changelog
(`MMCA.Common/CHANGELOG.md:7`, Added at `:11-17`, Fixed at `:21`, Breaking at `:25-29`) and its
upgrade section (`MMCA.Common/UPGRADING.md:35`). It amends the records whose Azure integrations
moved: [ADR-041](041-observability-and-telemetry.md), [ADR-044](044-native-push-delivery.md),
[ADR-045](045-managed-file-storage-and-avatars.md), [ADR-061](061-runtime-secret-management.md),
[ADR-066](066-broker-transport-selection.md), [ADR-069](069-shared-data-protection-key-ring.md),
[ADR-015](015-architecture-fitness-functions.md) and
[ADR-118](118-message-transport-library-policy.md); each carries a 2026-10-24 revision.

## Context
Before v1.255.0 the core packages carried the Azure SDKs themselves: MMCA.Common.Infrastructure,
MMCA.Common.Aspire, MMCA.Common.API and MMCA.Common.Testing each referenced Azure packages, and
MMCA.Common.Testing brought Testcontainers.ServiceBus, Azure.Messaging.ServiceBus and
MassTransit.Azure.ServiceBus.Core into every test project that used it (`MMCA.Common/CHANGELOG.md:25`).
A consumer that never runs on Azure (a self-hosted deployment, or one on AWS) still restored, audited
and shipped those dependencies, and the broker selection was a closed enum, `MessageBusProvider`, so a
second cloud's transport could only be added by editing the core (`MMCA.Common/CHANGELOG.md:26`).

The framework already had a working shape for optional vendor code. The AI boundary
([ADR-120](120-governed-chat-client-boundary.md)) keeps the provider SDKs in separate packages
(`MMCA.Common.AI.Anthropic`, `MMCA.Common.AI.OpenAI`) and resolves a configured provider name against
the factories those packages register, failing at boot when the name matches none
(`MMCA.Common/Source/Core/MMCA.Common.AI/Providers/AiProviderValidator.cs:6-12`, `:16`). The cloud
integrations had no equivalent: their SDKs were unconditional references of the core.

## Decision
**The core packages reference no cloud SDK. Each vendor integration ships in an adapter package that
references the core, and a host opts in with one registration call per capability.** The framework
guide states the rule (`MMCA.Common/AGENTS.md:145`).

- **Three adapter packages.**
  - `MMCA.Common.Azure`: Key Vault as a configuration source, `AddAzureKeyVaultConfiguration()`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureKeyVaultConfigurationExtensions.cs:23`, `:80`);
    the Blob plus Key Vault DataProtection key ring, `AddAzureDataProtection()`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureDataProtectionExtensions.cs:20`, `:53`); the Azure
    Monitor exporter, `AddAzureMonitorExporter()`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureMonitorExporterExtensions.cs:12`, `:42`, calling
    `UseAzureMonitor()` at `:63`); Blob file storage, `AddAzureBlobFileStorage(configuration)`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:41`); Notification
    Hubs native push, `AddAzureNotificationHubsPush(configuration)` (`:83`); and the Service Bus
    transport, `AddAzureServiceBusTransport()` (`:117-118`). The Entra ID SQL authentication provider
    (`Microsoft.Data.SqlClient.Extensions.Azure`) arrives by referencing the package, with no call
    (`MMCA.Common/CHANGELOG.md:11`).
  - `MMCA.Common.Aws`: S3-compatible storage, `AddS3FileStorage(configuration)`, and the SQS/SNS
    transport, `AddAmazonSqsTransport()`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:23`, `:44`, `:79`).
  - `MMCA.Common.Testing.Azure`: the Service Bus emulator broker-parity fixture,
    `ServiceBusEmulatorFixtureBase`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Azure/Fixtures/ServiceBusEmulatorFixtureBase.cs:54`).
- **Configuration sections and keys are unchanged.** Only the call and the type names moved; no shim
  or `[Obsolete]` alias is left in the core (`MMCA.Common/CHANGELOG.md:25`). Each adapter binds the
  section the core used: Blob storage and S3 both read `FileStorage`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Storage/S3StorageClientFactory.cs:14`), and the
  Notification Hubs registration keeps the `NativePush` gate of `Enabled` plus a connection string and
  hub name (`AzureServiceCollectionExtensions.cs:91-96`).
- **The message bus provider is a string resolved against registered transports.**
  `MessageBusSettings.Provider` is a `string` defaulting to `InProcess`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:25`), and the
  built-in names are the `MessageBusProviders` constants `InProcess` and `RabbitMq`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/MessageBusProviders.cs:9`,
  `:15`, `:18`). The extension point is `IBrokerTransport`, a `Name` plus a
  `Configure(IBusRegistrationConfigurator, BrokerTransportContext)`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/IBrokerTransport.cs:24`,
  `:30`, `:40`; `BrokerTransportContext.cs:10`), registered through `AddBrokerTransport`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:148`, added as
  an enumerable singleton at `:157`). `AddBrokerMessaging` (`:45`) returns early for `InProcess`
  (`:54`), otherwise resolves the transport by name (`:66`, `ResolveBrokerTransport` at `:177`, with
  RabbitMQ built in at `:179-181`) and hands it the bus configurator (`:98`). A name with no
  registered transport throws there, naming the adapter package and call for the two known adapter
  names (`MessageBusProviders.cs:25-29`; `DependencyInjection.Messaging.cs:199-203`). Every transport,
  built in or adapter, applies the same receive policies through `BrokerTransportPolicies`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportPolicies.cs:25`:
  `ApplyReceivePolicies` at `:37` and `:56`, `ApplyMessageRetry` at `:80`, `ApplyBackpressure` at
  `:103`, `BuildRedeliveryIntervals` at `:131` and `:144`).
- **OTLP is the only built-in exporter.** `AddServiceDefaults()` turns on `UseOtlpExporter()` when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs:166`, `:170`). Azure Monitor
  is the adapter call `AddAzureMonitorExporter()`, which throws when it runs before
  `AddServiceDefaults()` because the framework's outbox and probe filter processors must be registered
  ahead of the exporter (`AzureMonitorExporterExtensions.cs:45-50`; `Extensions.Telemetry.cs:146`;
  `MMCA.Common/CHANGELOG.md:27`).
- **Startup tripwires fail fast when vendor configuration exists without its adapter.** Two
  `IValidateOptions` validators run under `ValidateOnStart`, before any hosted service starts.
  `CloudAdapterTripwire`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:30`,
  registered by `AddInfrastructure` at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:221-223`) fails
  `NativePush:Enabled=true` whose `INativePushSender` is still the null default (`:33`, `:48-53`),
  naming the call. A tripwire fires only on a key that declares intent, so a `FileStorage` section,
  which is routinely shared across a solution's services, is deliberately not checked (`:21-26`); a
  host that lost its storage adapter fails each upload with `FileStorage.NotConfigured` instead
  (v1.256.0, `MMCA.Common/CHANGELOG.md:11`). `HostIntegrationTripwire`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:15`, `:31`,
  registered by `AddServiceDefaults()` at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:44-46`)
  checks `APPLICATIONINSIGHTS_CONNECTION_STRING`, `KeyVault:Uri` and `DataProtection:BlobStorageUri`
  (`:20`, `:23`, `:26`) against the `HostIntegrationMarker` each adapter call registers
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationMarker.cs:10`,
  names at `HostIntegrationNames.cs:17`, `:20`, `:23`; registered at
  `AzureKeyVaultConfigurationExtensions.cs:84`, `AzureDataProtectionExtensions.cs:57`,
  `AzureMonitorExporterExtensions.cs:56`). A section holding only blank placeholders stays silent
  (`MMCA.Common/CHANGELOG.md:28`).
- **The boundary is gated twice, matched on package id.** The `EnforceCloudVendorBoundary` build target
  fails a core project whose `PackageReference` is an Azure, AWS or vendor MassTransit transport
  package, or an adapter package
  (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:108-111`, target at `:126`, errors at
  `:144` and `:146`). `CloudVendorIsolationTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/CloudVendorIsolationTestsBase.cs:14`)
  fails a core assembly that names a vendor type or references a vendor or adapter assembly
  (`:26-27`, `:30-31`).
- **Exactly two references are exempt, both database engines rather than cloud services.**
  `Microsoft.EntityFrameworkCore.Cosmos` in MMCA.Common.Infrastructure, because Cosmos DB is one of the
  framework's data engines and brings `Microsoft.Azure.Cosmos` transitively, so that namespace is
  allowed in Infrastructure alone; and `Aspire.Hosting.Azure.CosmosDB` in MMCA.Common.Aspire.Hosting,
  the AppHost-side emulator resource that never reaches a service process
  (`MMCA.Common.LayerEnforcement.targets:115-120`, exemptions at `:130-131`;
  `CloudVendorIsolationTestsBase.cs:21`).
- **S3-compatible, not S3-only.** `AddS3FileStorage` targets Amazon S3, Cloudflare R2, MinIO and the
  GCS XML API from one `FileStorage` section (`MMCA.Common/CHANGELOG.md:12`;
  `MMCA.Common/Source/Hosting/MMCA.Common.Aws/Storage/S3FileStorageSettings.cs:13`,
  `S3FileStorageService.cs:21`). Request checksum calculation and response checksum validation both
  default to `WHEN_REQUIRED` rather than the AWS SDK default
  (`S3FileStorageSettings.cs:59`, `:65`, `:72`; `AwsServiceCollectionExtensions.cs:35`), the posture
  that keeps the non-AWS stores working.
- **The SQS transport works within SQS limits.** `AmazonSqsTransport` registers under the provider
  name `AmazonSqs`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsTransport.cs:37`, `:40`) and uses
  `MassTransit.AmazonSQS` at 8.5.11, the same version as every other MassTransit pin
  (`MMCA.Common/Directory.Packages.props:125-130`). SQS caps a message delay at 900 seconds
  (`MaxDelaySeconds`, `AmazonSqsTransport.cs:43`), so an unconfigured redelivery list defaults to
  `[60, 300, 900]` (`:55`, applied at `:128`) and a configured interval over 900 fails
  `AddBrokerMessaging` instead of being silently shortened (`:159-161`). The `MMCA-*` ambient headers
  (`:46`) travel in the MassTransit envelope body, not as SQS/SNS message attributes (`:30-33`,
  `:134-135`), so they never compete for the 10-attribute cap (`MMCA.Common/CHANGELOG.md:12`).
- **The adapters are exercised against real infrastructure.** The `aws-integration` CI job runs
  MMCA.Common.Aws against LocalStack through Testcontainers
  (`MMCA.Common/.github/workflows/ci.yml:846-847`, test run at `:883`); it is not a required check
  (`MMCA.Common/CHANGELOG.md:17`).

## Rationale
- **A consumer pays only for the cloud it runs on.** With the SDKs in adapters, a self-hosted or AWS
  deployment restores, audits and ships no Azure package, and an Azure deployment carries no AWS one.
- **The AI provider shape already worked.** Optional vendor code in its own package, selected by name
  and refused at boot when the name has no registration (`AiProviderValidator.cs:6-12`), is the model
  the cloud adapters follow, so a reader of one boundary already knows the other.
- **A string provider is open to extension without editing the core.** A closed enum forced every new
  transport into MMCA.Common.Infrastructure; `IBrokerTransport` lets an adapter add one, and
  `BrokerTransportPolicies` keeps retry, redelivery and backpressure identical across all of them.
- **Unchanged configuration keeps the move to code.** A deployment's environment variables, Bicep and
  Key Vault names stay as they are; only the package reference and the registration calls change.
- **Silent degradation is the failure mode the tripwires remove.** Before the move, the core wired
  each integration itself. After it, a host that keeps its configuration but loses the call would
  otherwise start with the null storage, the null push sender, no telemetry export, no vault secrets
  or a per-replica key ring. Failing startup with the call named turns that into a deploy-time error.

## Trade-offs
- **Every Azure host gains calls it did not need before.** `AddAzureMonitorExporter()` after
  `AddServiceDefaults()` and `AddAzureServiceBusTransport()` before `AddBrokerMessaging` are new, and
  the Key Vault, DataProtection and push calls are renamed (`MMCA.Common/UPGRADING.md:35`).
- **Registration order matters in two places.** The exporter must follow `AddServiceDefaults()`
  (`AzureMonitorExporterExtensions.cs:45-50`), and an adapter transport must be registered before
  `AddBrokerMessaging` resolves it (`DependencyInjection.Messaging.cs:148`, `:177`).
- **The Cosmos engine still brings an Azure assembly into Infrastructure.** `Microsoft.Azure.Cosmos`
  arrives transitively through `Microsoft.EntityFrameworkCore.Cosmos`, so the core is cloud-neutral in
  its cloud-service integrations, not free of every Azure assembly
  (`MMCA.Common.LayerEnforcement.targets:115-118`).
- **SQS redelivery is shorter than the framework default.** The framework default is
  `[60, 600, 3600]` (`MessageBusSettings.cs:212`); SQS cannot delay an hour, so its default stops at
  900 seconds (`AmazonSqsTransport.cs:55`).
- **The AWS tier is not a required check.** A regression in MMCA.Common.Aws shows as a red
  `aws-integration` job without blocking a merge (`MMCA.Common/CHANGELOG.md:17`).

## Alternatives rejected
Weighed and rejected on 2026-10-24.
- **Leave the Azure SDKs in the core.** Simplest for the Azure-hosted consumers, but every other
  consumer keeps restoring, auditing and shipping Azure packages it never calls, and a test project
  keeps pulling the Service Bus emulator stack through MMCA.Common.Testing. Revisit only if every
  consumer is permanently Azure-only.
- **Add AWS to the core next to Azure.** It would serve AWS deployments without new packages, but it
  doubles the dependency footprint every consumer carries instead of removing it, and the closed
  provider enum would grow with each cloud. Revisit never: it worsens the problem this record solves.
- **One package per capability per vendor** (for example separate Blob, Key Vault, Service Bus and
  Monitor packages). It gives the finest-grained dependency control, but multiplies the package count
  the dual-registry release publishes and versions in lockstep, and the maintenance that comes with
  each. One package per vendor with one call per capability keeps the opt-in at the call while the
  package count stays at one per cloud. Revisit if one capability's SDK becomes heavy enough that
  hosts using the others object to carrying it.

## Consequences
- **The change is breaking.** The renames, moved types and new calls are mapped once in
  `MMCA.Common/UPGRADING.md:35` (the old-to-new table and the seven-step fix per host) rather than
  restated here; `Microsoft.Data.SqlClient.Extensions.Azure` now arrives only through
  MMCA.Common.Azure, so any process whose SQL connection string uses `Authentication=Active Directory
  ...` references that package (`MMCA.Common/CHANGELOG.md:25`).
- **A configured redelivery list now replaces the default.** Making the provider a string came with
  `RedeliveryIntervalsSeconds` becoming `null` when unconfigured
  (`MessageBusSettings.cs:234`), which fixes the binder appending a configured list to the old
  initializer, so `[0]` turns second-level redelivery off as documented
  (`BrokerTransportPolicies.cs:124-125`; `MMCA.Common/CHANGELOG.md:21`).
- **A new cloud is an adapter, not a core change.** A transport implements `IBrokerTransport`, storage
  implements `IFileStorageService`, and a tripwire message names the call, with the build and
  architecture gates holding the core free of the new SDK.
- **The residual Cosmos dependency stays.** The two engine exemptions are the only vendor references
  in the core; adding a third is a deliberate edit to both gates, not a drift either can miss.
