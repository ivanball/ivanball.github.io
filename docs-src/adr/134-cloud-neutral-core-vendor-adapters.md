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

Revised 2026-10-25 (MMCA.Common v1.257.0, `MMCA.Common/CHANGELOG.md:7`): AWS gains the vault configuration, DataProtection key
ring and native push Azure already had, plus passwordless PostgreSQL through RDS IAM (Azure covers
passwordless SQL Server through Entra instead) (`:11-15`); a third cloud adapter, MMCA.Common.Gcp, covers storage, secrets, the key ring, push,
passwordless PostgreSQL and telemetry for Google Cloud (`:16-23`); Google Cloud has no MassTransit v8
Pub/Sub transport, so its broker answer is a built-in, cloud-neutral `PostgreSql` provider (`:24`);
the core gains the `INpgsqlDataSourceConfigurator` hook and the public `NativePushPayloads` builders
the adapters share (`:25-26`); the startup tripwires gain one check per new gate and the key-ring
rule now fails when more than one of three key-ring gates is set (`:27`, `:33`); and the type-level
vendor rule, which had passed vacuously for every Azure and AWS type, is fixed (`:32`). The Decision
below reads as the current state; the options weighed on 2026-10-25 are added to Alternatives
rejected.

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

- **Three cloud adapter packages and one test adapter.** Every call is opt-in and a no-op until its
  gate key is set (`MMCA.Common/CHANGELOG.md:11`, `:16`).
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
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:29`, `:50`, `:85`);
    Secrets Manager as a configuration source, `AddAwsSecretsManagerConfiguration()`, reading the
    `SecretsManager` section
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsSecretsManagerConfigurationExtensions.cs:25`,
    `:82`); the Systems Manager Parameter Store key ring, `AddAwsDataProtection()`, gated on
    `DataProtection:SsmParameterPrefix` with an optional `DataProtection:KmsKeyId`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsDataProtectionExtensions.cs:57`, `:59`, `:76`;
    `Amazon.AspNetCore.DataProtection.SSM` at `MMCA.Common/Directory.Packages.props:164`); SNS mobile
    push with a DynamoDB installation registry, `AddAmazonSnsPush(configuration)`
    (`AwsServiceCollectionExtensions.cs:164`; `MMCA.Common/CHANGELOG.md:14`); and RDS / Aurora IAM
    authentication for PostgreSQL, `AddAwsRdsIamAuthentication(configuration)` (`:107`), gated on the
    `Rds:IamAuthentication` section
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Rds/RdsIamAuthenticationSettings.cs:11`) with the
    token refreshed every 10 minutes
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Rds/RdsIamAuthenticationConfigurator.cs:24`).
  - `MMCA.Common.Gcp`, over Application Default Credentials throughout (`MMCA.Common/CHANGELOG.md:16`):
    Cloud Storage, `AddGoogleCloudStorage(configuration)`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:26`, `:48`), gated
    on `FileStorage:GcsBucket`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Storage/GcsFileStorageSettings.cs:15`, `:18`); Secret
    Manager as a configuration source, `AddGoogleSecretManagerConfiguration()`, reading the
    `GoogleSecretManager` section
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GoogleSecretManagerConfigurationExtensions.cs:25`,
    `:82`); the key ring in one Cloud Storage object, `AddGoogleCloudDataProtection()`, gated on
    `DataProtection:GcsObjectUri` with optional Cloud KMS encryption at `DataProtection:GcpKmsKeyName`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GoogleCloudDataProtectionExtensions.cs:24-25`, `:76`);
    FCM HTTP v1 push with a Firestore installation registry, `AddFirebaseCloudMessagingPush(configuration)`
    (`GcpServiceCollectionExtensions.cs:142`), which accepts FCM registration tokens only
    (`MMCA.Common/CHANGELOG.md:20`); Cloud SQL IAM authentication for PostgreSQL,
    `AddCloudSqlIamAuthentication(configuration)` (`:90`), gated on the `CloudSql:IamAuthentication`
    section
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/CloudSql/CloudSqlIamAuthenticationSettings.cs:13`)
    with the token refreshed every minute
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/CloudSql/CloudSqlIamAuthenticationConfigurator.cs:26`);
    and the Telemetry (OTLP) API exporter, `AddGoogleCloudTelemetryExporter()`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GoogleCloudTelemetryExporterExtensions.cs:101`),
    which must follow `AddServiceDefaults()` (`:107-109`) and exports traces and logs only: the API
    accepts at most 200 data points per metric request and the OpenTelemetry .NET SDK cannot split one
    metric, so metrics go through the Google-built OpenTelemetry Collector (`:78-88`). The Google
    adapter has no broker transport (see the `PostgreSql` provider below).
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
  built-in names are the `MessageBusProviders` constants `InProcess`, `RabbitMq` and `PostgreSql`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/MessageBusProviders.cs:10`,
  `:16`, `:19`, `:27`). The extension point is `IBrokerTransport`, a `Name` plus a
  `Configure(IBusRegistrationConfigurator, BrokerTransportContext)`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/IBrokerTransport.cs:24`,
  `:30`, `:40`; `BrokerTransportContext.cs:10`), registered through `AddBrokerTransport`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:159`, added as
  an enumerable singleton at `:168`). `AddBrokerMessaging` (`:48`) returns early for `InProcess`
  (`:57`), otherwise resolves the transport by name (`:69`, `ResolveBrokerTransport` at `:188`, with
  RabbitMQ and PostgreSQL built in at `:190-198`) and hands it the bus configurator (`:109`). A name
  with no registered transport throws there, naming the adapter package and call for the two known
  adapter names, `AzureServiceBus` and `AmazonSqs` (`MessageBusProviders.cs:34-39`;
  `DependencyInjection.Messaging.cs:215-220`). Every transport,
  built in or adapter, applies the same receive policies through `BrokerTransportPolicies`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/BrokerTransportPolicies.cs:25`:
  `ApplyReceivePolicies` at `:37` and `:56`, `ApplyMessageRetry` at `:80`, `ApplyBackpressure` at
  `:103`, `BuildRedeliveryIntervals` at `:131` and `:144`).
- **A broker that needs only a database is built in: `PostgreSql`.** `PostgreSqlBrokerTransport`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlBrokerTransport.cs:40`,
  `Name` at `:43`) runs MassTransit's SQL transport, `MassTransit.SqlTransport.PostgreSQL` at 8.5.11
  (`MMCA.Common/Directory.Packages.props:131-136`), so any PostgreSQL is the broker, which is why it is
  core rather than an adapter (`PostgreSqlBrokerTransport.cs:10-14`). It is the broker for Google
  Cloud, which has no MassTransit v8 Pub/Sub transport (`MMCA.Common/CHANGELOG.md:24`). The
  `MessageBus:PostgreSql` section
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Transports/PostgreSqlTransportSettings.cs:11`)
  carries `Schema` and `Role` (`:20`, `:26`; both default `transport`, `PostgreSqlBrokerTransport.cs:18-19`)
  and `MigrateOnStartup`, default `true` (`PostgreSqlTransportSettings.cs:36`). Delayed redelivery is
  native and unconditional (`PostgreSqlBrokerTransport.cs:24-27`).
- **Passwordless PostgreSQL goes through one cloud-neutral hook.** `INpgsqlDataSourceConfigurator`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/INpgsqlDataSourceConfigurator.cs:23`,
  `Configure(NpgsqlDataSourceBuilder)` at `:27`) is registered with `AddNpgsqlDataSourceConfigurator`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Persistence.cs:24`, as an
  enumerable at `:28`), which switches PostgreSQL onto one shared `NpgsqlDataSource` per connection
  string (`:32-34`) for the contexts, the readiness check and the `PostgreSql` broker alike
  (`PostgreSqlBrokerTransport.cs:30-33`). With none registered the raw connection string path is
  unchanged (`INpgsqlDataSourceConfigurator.cs:12-13`). `AddAwsRdsIamAuthentication` and
  `AddCloudSqlIamAuthentication` are both configurators behind this hook (`MMCA.Common/CHANGELOG.md:25`).
- **The push payload builders are core.** `NativePushPayloads`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Push/NativePushPayloads.cs:11`,
  `BuildFcmV1Payload` at `:18`, `BuildApnsPayload` at `:40`) is public and called by the
  Notification Hubs sender
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Notifications/AzureNotificationHubNativePushSender.cs:22-23`)
  and the SNS message builder (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Notifications/SnsPushMessage.cs:29-30`);
  the FCM adapter maps the same fields onto FirebaseAdmin's typed `Message`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Notifications/FcmPushMessage.cs:7-9`).
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
  `NativePush:Enabled=true` whose `INativePushSender` is still the null default (`:33`, `:48-50`),
  naming the call of each of the three push adapters (`:53`). A tripwire fires only on a key that
  declares intent, so a `FileStorage` section, which is routinely shared across a solution's
  services, is deliberately not checked (`:22-26`); a host that lost its storage adapter fails each
  upload with `FileStorage.NotConfigured` instead (v1.256.0, `MMCA.Common/CHANGELOG.md:39-45`).
  `HostIntegrationTripwire`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:15`, `:59`,
  registered by `AddServiceDefaults()` at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:44-46`)
  checks one gate key per host-level adapter call: `APPLICATIONINSIGHTS_CONNECTION_STRING`,
  `KeyVault:Uri` and `DataProtection:BlobStorageUri` (`:20`, `:23`, `:26`), `SecretsManager:NamePrefix`
  and `DataProtection:SsmParameterPrefix` (`:29`, `:32`), and `GoogleSecretManager:NamePrefix`,
  `DataProtection:GcsObjectUri` and `GoogleCloudTelemetry:ProjectId` (`:40`, `:43`, `:46`; the checks
  at `:63-102`), against the `HostIntegrationMarker` each adapter call registers
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationMarker.cs:10`,
  names at `HostIntegrationNames.cs:17`, `:20`, `:23`, `:26`, `:29`, `:32`, `:35`, `:38`; registered at
  `AzureKeyVaultConfigurationExtensions.cs:84`, `AzureDataProtectionExtensions.cs:57`,
  `AzureMonitorExporterExtensions.cs:56`, `AwsSecretsManagerConfigurationExtensions.cs:125`,
  `AwsDataProtectionExtensions.cs:72`, `GoogleSecretManagerConfigurationExtensions.cs:116`,
  `GoogleCloudDataProtectionExtensions.cs:102`, `GoogleCloudTelemetryExporterExtensions.cs:127`). It
  also fails a host that sets more than one of the three key-ring gates, since two rings split cookies
  across replicas (`HostIntegrationTripwire.cs:49-54`, `:104-112`). A section holding only blank
  placeholders stays silent (`:125`).
- **The boundary is gated twice, matched on package id.** The `EnforceCloudVendorBoundary` build target
  fails a core project whose `PackageReference` is an Azure, AWS or Google Cloud package (an
  `Azure.*`, `Microsoft.Azure.*`, `AWSSDK.*` or `Google.*` id, `FirebaseAdmin` or `Grpc.Auth`), a vendor
  MassTransit transport, or whose `ProjectReference` names an adapter project, `MMCA.Common.Gcp` included
  (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:109-115`, adapters at `:128`,
  target at `:130`, patterns at `:138-147`, adapter references at `:149`, errors at `:151` and
  `:153`). `CloudVendorIsolationTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/CloudVendorIsolationTestsBase.cs:15`)
  fails a core assembly that names a vendor type or references a vendor or adapter assembly
  (`:28-29`, `:32-33`), against the namespace roots `Azure`, `Microsoft.Azure`, `Amazon`, `Google`,
  `FirebaseAdmin` and `Grpc.Auth` plus the vendor transports and adapters
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.CloudVendors.cs:25-41`)
  and the matching assembly-name prefixes (`:48-62`). The roots carry no trailing dot because
  NetArchTest matches whole namespace segments and an entry ending in a dot matches nothing
  (`:27-28`); each cloud adapter test project (Azure, Aws, Gcp) pins that with a `CloudVendorRulesTests` case naming its own
  SDK
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Azure.Tests/CloudVendorRulesTests.cs:22`,
  `MMCA.Common/Tests/Hosting/MMCA.Common.Aws.Tests/CloudVendorRulesTests.cs:21`,
  `MMCA.Common/Tests/Hosting/MMCA.Common.Gcp.Tests/CloudVendorRulesTests.cs:28`).
- **Exactly two references are exempt, both database engines rather than cloud services.**
  `Microsoft.EntityFrameworkCore.Cosmos` in MMCA.Common.Infrastructure, because Cosmos DB is one of the
  framework's data engines and brings `Microsoft.Azure.Cosmos` transitively, so that namespace is
  allowed in Infrastructure alone; and `Aspire.Hosting.Azure.CosmosDB` in MMCA.Common.Aspire.Hosting,
  the AppHost-side emulator resource that never reaches a service process
  (`MMCA.Common.LayerEnforcement.targets:117-124`, exemptions at `:134-135`;
  `CloudVendorIsolationTestsBase.cs:21`). The Google Cloud additions added no exemption.
- **S3-compatible, not S3-only.** `AddS3FileStorage` targets Amazon S3, Cloudflare R2, MinIO and the
  GCS XML API from one `FileStorage` section (`MMCA.Common/CHANGELOG.md:12`;
  `MMCA.Common/Source/Hosting/MMCA.Common.Aws/Storage/S3FileStorageSettings.cs:13`,
  `S3FileStorageService.cs:21`). Request checksum calculation and response checksum validation both
  default to `WHEN_REQUIRED` rather than the AWS SDK default
  (`S3FileStorageSettings.cs:59`, `:65`, `:72`; `AwsServiceCollectionExtensions.cs:40-41`), the posture
  that keeps the non-AWS stores working. The native Google adapter reads its own `Gcs`-prefixed keys
  of the same section, so the two never collide (`MMCA.Common/CHANGELOG.md:17`).
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
  (`MMCA.Common/.github/workflows/ci.yml:849-850`, test run with a floor of 14 tests at `:887`), and
  the `gcp-integration` job runs MMCA.Common.Gcp against fake-gcs-server and the Firestore emulator
  (`:889-890`, floor of 14 at `:934`); neither is a required check (`MMCA.Common/CHANGELOG.md:23`,
  `:59`). The PostgreSQL tier covers a periodic password provider and the `PostgreSql` broker
  (`:28`).

## Rationale
- **A broker that needs a database, not a cloud service, belongs in the core.** The SQL transport
  runs on any PostgreSQL, managed or self-hosted (`PostgreSqlBrokerTransport.cs:10-14`), so putting it
  in MMCA.Common.Gcp would have hidden a cloud-neutral broker behind one vendor's package.
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
- **The AWS and Google Cloud tiers are not required checks.** A regression in MMCA.Common.Aws or
  MMCA.Common.Gcp shows as a red `aws-integration` or `gcp-integration` job without blocking a merge
  (`MMCA.Common/CHANGELOG.md:23`, `:59`).
- **Every consumer of MMCA.Common.Infrastructure restores the SQL transport.** The built-in
  `PostgreSql` provider brings `MassTransit.SqlTransport.PostgreSQL` and Dapper to every consumer,
  whichever broker it selects (`MMCA.Common/CHANGELOG.md:24`).
- **An IAM-only broker database cannot migrate at startup.** MassTransit's schema migrator opens its
  own connections from the connection string, so such a host sets `MigrateOnStartup=false` and
  creates the transport schema in a deployment step that connects with a password
  (`PostgreSqlBrokerTransport.cs:33-37`).
- **Google Cloud metrics need a collector.** `AddGoogleCloudTelemetryExporter()` ships traces and
  logs; metrics reach Google only through the Google-built OpenTelemetry Collector
  (`GoogleCloudTelemetryExporterExtensions.cs:78-88`).
- **The Google push adapter takes FCM tokens only.** An APNs-platform registration fails validation,
  so an iOS client registers an FCM token (`MMCA.Common/CHANGELOG.md:20`).
- **Neither managed SQL Server offers IAM database authentication.** RDS for SQL Server keeps a password connection
  string loaded from Secrets Manager (`MMCA.Common/CHANGELOG.md:15`); Cloud SQL for SQL Server (`:21`)
  takes either a password connection string from Secret Manager or, on SQL Server 2022 and later, Entra
  ID through MMCA.Common.Azure (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:80-83`).

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

Weighed and rejected on 2026-10-25.
- **A hand-written MassTransit transport for Google Pub/Sub.** It would give Google Cloud a native
  broker, but no MassTransit v8 Pub/Sub transport exists (`MMCA.Common/CHANGELOG.md:24`), so the
  framework would own a broker transport's delivery, redelivery and topology outside the MassTransit
  project. The `PostgreSql` provider gives Google Cloud a broker on Cloud SQL instead. Revisit if
  MassTransit ships a supported Pub/Sub transport on the line
  [ADR-118](118-message-transport-library-policy.md) pins.
- **MassTransit v9 for a wider transport set.** v9 is commercial with a runtime licence key, which
  [ADR-118](118-message-transport-library-policy.md) already rejects. Revisit on the condition that
  record names.
- **Google's own DataProtection packages.** They are prerelease only, and a stable package cannot
  depend on a prerelease (NU5104), so the key-ring repository and the Cloud KMS encryptor are the
  framework's own (`MMCA.Common/CHANGELOG.md:19`; `MMCA.Common/Directory.Packages.props:187-191`).
  Revisit when Google publishes a stable release.
- **Exporting Google Cloud metrics without a collector.** The Telemetry API caps a metric request at
  200 data points and the OpenTelemetry .NET SDK offers no supported way to split one metric's points
  across requests, so a host with more than 200 time series would have whole batches rejected
  (`GoogleCloudTelemetryExporterExtensions.cs:78-81`). Revisit when the SDK can split a metric or the
  API cap rises.
- **The PostgreSQL transport inside MMCA.Common.Gcp.** It would keep the core free of one more
  package, but the transport needs only a database and works on any PostgreSQL
  (`PostgreSqlBrokerTransport.cs:10-14`), so an AWS, Azure or self-hosted consumer would have to
  reference the Google adapter to use it. Revisit if the transport ever needs a Google SDK.

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
