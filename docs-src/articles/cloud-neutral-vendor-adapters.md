# One Framework, Three Clouds: A Cloud-Neutral Core With Vendor Adapter Packages

> Series: MMCA.Common · Article #53 (deep-dive) · Pillar P3 · Group G29 · Rubric §7,§10,§32 · ADR-134 ·
> Status: grounded in `Website/docs-src/adr/134-cloud-neutral-core-vendor-adapters.md`,
> `Website/docs-src/onboarding/group-28-common-cloud-provider-adapters.md`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Azure/*.cs`, `MMCA.Common/Source/Hosting/MMCA.Common.Azure.Startup/*Extensions.cs`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Aws/*Extensions.cs`, `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/*Extensions.cs`,
> `MMCA.Common/.../Infrastructure/Messaging/Transports/MessageBusProviders.cs`, `.../IBrokerTransport.cs`,
> `.../BrokerTransportPolicies.cs`, `.../Transports/PostgreSql/PostgreSqlBrokerTransport.cs`,
> `MMCA.Common/.../Infrastructure/DependencyInjection.Messaging.cs`,
> `MMCA.Common/.../Infrastructure/Configuration/CloudAdapterTripwire.cs`,
> `MMCA.Common/.../Aspire/Integrations/HostIntegrationTripwire.cs`,
> `MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs`,
> `MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets`,
> `MMCA.Common/.../Testing.Architecture/Bases/Layering/CloudVendorIsolationTestsBase.cs` and
> `.../Rules/Layering/ArchitectureRules.CloudVendors.cs`, the ADC and Store service `Program.cs` files,
> and the §7/§10/§32 rows of `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`. No em dashes.

**Subtitle:** A framework that ships its first cloud's SDKs inside the core makes every consumer pay for
that cloud, whether it runs there or not. Here is the alternative: a core that references no cloud SDK
and ships inert defaults, adapter packages per cloud with one call per capability, a startup check
that names the call a host forgot, and two gates that keep the core honest.

---

Your framework runs on Azure. It always has, so the Key Vault configuration source, the Blob storage
service, the Service Bus transport and the Azure Monitor exporter all live in the core packages, wired
by the same `AddInfrastructure()` and `AddServiceDefaults()` every host already calls. It is convenient
right up to the first consumer that does not run on Azure.

That consumer restores the Azure SDKs anyway. Its vulnerability audit reads their advisories, its
container image ships their assemblies, and its test projects pull a Service Bus emulator stack it will
never start. When it asks for a broker its cloud actually offers, the answer is an edit to the core,
because the provider list is a closed enum somebody has to widen.

And the obvious fix, "add the second cloud next to the first", makes it worse: then every consumer
carries two clouds.

The move that works is the one the framework already made for language models (ADR-120): keep vendor
code in its own package, let the host opt in by name, and refuse to start when the name has no
registration. **ADR-134** applies that shape to the cloud.

## Why it matters

Three rubric categories read this from three directions.

§7 (Microservices Readiness) is a weight-3 category (`ArchitectureEvaluationCriteria.md:272`) that asks
for an Anti-Corruption Layer around "any legacy or third-party model at the boundary" (`:263`) and lists
"a legacy or vendor model leaking into the domain because no translation layer sits at the boundary" as
a red flag (`:270`). A cloud SDK type in a core package is exactly that leak, one layer down.

§10 (Messaging and Integration Architecture, `:329`) scores how work crosses process boundaries, and
the transport is where a cloud choice bites first: a broker list that only the core can extend is a
broker list frozen at whatever clouds the core's authors used.

§32 (Dependency and Supply-Chain Management, `:843`) asks for "transitive dependencies reviewed"
(`:852`) and names "unaudited transitive dependencies" as a red flag (`:859`), at weight 3 for a
published framework (`:861`). Every SDK a consumer restores and never calls is a transitive dependency
somebody has to audit for nothing.

MMCA.Common scores §7 at Maturity 4 / Implementation 9, §10 at Maturity 4 / Implementation 8 and §32 at
Maturity 4 / Implementation 9 (`common-ArchitectureScorecard.md:72`, `:75`, `:97`; evidence as of
2026-11-23 at v1.315.0, `:5`). The cloud boundary is one of the reasons those rows hold.

## The MMCA answer: the core references no cloud SDK

The decision is one sentence: **the core packages reference no cloud SDK; each vendor integration ships
in an adapter package that references the core, and a host opts in with one registration call per
capability** (`ADR-134:61-62`).

The core ships the abstractions and an inert or neutral default for each. Native push and file storage
default to `Null*` implementations that an adapter call replaces: the null storage service fails each
upload with `FileStorage.NotConfigured` rather than pretending to succeed (`CloudAdapterTripwire.cs:24-28`).
The message bus defaults to in-process dispatch (`MessageBusSettings.cs:25`). Telemetry export is OTLP,
switched on by `AddServiceDefaults()` only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
(`Extensions.Telemetry.cs:166-172`), which is the one exporter no cloud owns.

Then four cloud adapter packages and one test adapter (`ADR-134:65-68`). Azure ships as two:
`MMCA.Common.Azure.Startup` holds the start-up calls (the Key Vault source, the key ring and the Azure
Monitor exporter), so a gateway that needs only start-up wiring takes them without EF Core
(`ADR-134:69-70`), and `MMCA.Common.Azure` holds the service-level calls and references the Startup
package (`MMCA.Common.Azure.csproj:39`), so a host that references it gets both. AWS and Google Cloud
ship one package each.

Their calls stay inert until configuration or selection asks for them, though not all in the same way.
A service call such as `AddAzureBlobFileStorage` is a no-op while its section is incomplete
(`AzureServiceCollectionExtensions.cs:51-62`). A transport call always registers its transport, which
stays unused unless `MessageBus:Provider` selects it (`:150-155`). And an exporter checks its order
first and its gate second: `AddAzureMonitorExporter()` throws when it runs before `AddServiceDefaults()`
regardless of configuration, then returns without registering anything, its receipt included, while
`APPLICATIONINSIGHTS_CONNECTION_STRING` is absent (`AzureMonitorExporterExtensions.cs:44-59`):

| Capability | `MMCA.Common.Azure` (+ `.Startup`) | `MMCA.Common.Aws` | `MMCA.Common.Gcp` |
|---|---|---|---|
| Secrets as configuration | `AddAzureKeyVaultConfiguration()` | `AddAwsSecretsManagerConfiguration()` | `AddGoogleSecretManagerConfiguration()` |
| DataProtection key ring | `AddAzureDataProtection()` | `AddAwsDataProtection()` | `AddGoogleCloudDataProtection()` |
| File storage | `AddAzureBlobFileStorage(configuration)` | `AddS3FileStorage(configuration)` | `AddGoogleCloudStorage(configuration)` |
| Native push | `AddAzureNotificationHubsPush(configuration)` | `AddAmazonSnsPush(configuration)` | `AddFirebaseCloudMessagingPush(configuration)` |
| Broker transport | `AddAzureServiceBusTransport()` | `AddAmazonSqsTransport()` | none (the built-in `PostgreSql` provider) |
| Passwordless PostgreSQL | `AddAzurePostgreSqlEntraAuthentication(configuration)` | `AddAwsRdsIamAuthentication(configuration)` | `AddCloudSqlIamAuthentication(configuration)` |
| Passwordless SQL Server | the Entra SQL provider, by package reference | none | none |
| Passwordless Redis | `AddAzureRedisEntraAuthentication(configuration)` | none | none |
| Telemetry exporter | `AddAzureMonitorExporter()` | `AddAwsTelemetryExporter()` | `AddGoogleCloudTelemetryExporter()` |

Every call in the table is a real method (anchors in the Notes). Two shapes repeat: the host-level
calls (configuration source, key ring, telemetry exporter) extend the host builder (`TBuilder`, for
example `AzureKeyVaultConfigurationExtensions.cs:80`, `AzureDataProtectionExtensions.cs:54`,
`AwsDataProtectionExtensions.cs:70` and `GoogleCloudDataProtectionExtensions.cs:77`), and the
service-level calls extend `IServiceCollection` (for example `AzureServiceCollectionExtensions.cs:44`).
Each adapter binds the framework's standard configuration sections and keys (`ADR-134:196-201`), so a
deployment's environment variables and vault names are the same whichever adapter call reads them.

`MMCA.Common.Testing.Azure` is the test adapter: the Service Bus emulator fixture lives there, so a test
project that never touches Service Bus never restores its emulator stack (`ADR-134:193-195`).

## The broker is a string, and the core owns the cloud-neutral one

The transport selection is where a closed list hurts most, so it is the part that opened furthest.

`MessageBusSettings.Provider` is a `string` defaulting to `InProcess` (`MessageBusSettings.cs:25`).
The built-in values are three constants on `MessageBusProviders` (`MessageBusProviders.cs:10`):
`InProcess` (`:16`), `RabbitMq` (`:19`) and `PostgreSql` (`:27`), compared case-insensitively (`:4-8`).
Any other value names a transport an adapter registered.

The extension point is `IBrokerTransport` (`IBrokerTransport.cs:22`), and it is deliberately small: a
`Name` the configuration selects it by (`:28`), a `MaxRedeliveryDelay` for a broker that caps how far
ahead it can schedule (`:35`), and one `Register(IServiceCollection, BrokerTransportContext)` that adds a
singleton `IBrokerPublisher` and a hosted receiver for the host's queue (`:37-51`). Everything that is
the same on every broker stays in the framework: the topology, the wire format, the receive pipeline
(origin restore, inbox, retry, redelivery and dead-letter decisions), the outbox-only publish path and
the tracing. A transport only moves bytes (`:8-14`). An adapter registers one through
`AddBrokerTransport` (`DependencyInjection.Messaging.cs:174`), which adds it as an enumerable singleton,
idempotent per transport type (`:163-170`, `:183`). The whole Azure adapter call is that registration:

```csharp
// MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:154-155 (verbatim)
public IServiceCollection AddAzureServiceBusTransport() =>
    services.AddBrokerTransport(new AzureServiceBusTransport());

// MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:86-87 (verbatim)
public IServiceCollection AddAmazonSqsTransport() =>
    services.AddBrokerTransport(new AmazonSqsTransport());
```

`AddBrokerMessaging` (`DependencyInjection.Messaging.cs:63`) returns early for `InProcess` (`:72-75`),
otherwise resolves the transport by name before it registers anything, so an unknown name leaves no
half-registered broker behind (`:82-84`), builds the receive pipeline with the transport's delay cap
(`:108-115`), and calls `transport.Register` last, so a missing namespace or connection string throws at
startup rather than at the first publish (`:150-158`, `IBrokerTransport.cs:45-46`). Resolution checks the
two built-ins first and then the adapter registrations, the last one registered under the name winning
(`ResolveBrokerTransport`, `DependencyInjection.Messaging.cs:199-221`). A name that matches nothing
throws, and the message is actionable: for `AzureServiceBus` and `AmazonSqs` it names the package to
reference and the call to make before `AddBrokerMessaging` (`MessageBusProviders.cs:34-39`,
`DependencyInjection.Messaging.cs:226-227`); for any other name it says to register an `IBrokerTransport`
under it or correct the spelling (`:228`).

Why is `PostgreSql` in the core rather than in the Google adapter? Because it needs a database, not a
cloud. `PostgreSqlBrokerTransport` (`Transports/PostgreSql/PostgreSqlBrokerTransport.cs:36`, `Name` at
`:55`) is written on Npgsql against the same `IBrokerTransport` contract an adapter implements, and keeps
topics, queues and delayed redeliveries in three tables of one PostgreSQL database, so Cloud SQL, Amazon
RDS, Azure Database for PostgreSQL or a container is the broker (`:10-15`). A publish inserts one row per
subscribed queue and wakes the receivers with `pg_notify`; a receiver claims rows with
`FOR UPDATE SKIP LOCKED` under a renewed lease and falls back to polling (`:17-19`). Putting it in
`MMCA.Common.Gcp` would make an AWS or self-hosted consumer reference the Google adapter to use a broker
that has nothing to do with Google (`ADR-134:483-486`). It is also the broker a Google Cloud host
selects, since the Google adapter ships no transport (`ADR-134:191-192`).

Whichever transport runs, retry, redelivery and dead-letter decisions come from the same receive
pipeline (`IBrokerTransport.cs:8-14`). A transport changes the inputs in one place, its delay cap: the
pipeline shortens every redelivery interval, default or configured, to `MaxRedeliveryDelay`
(`BrokerTransportPolicies.cs:65-75`, `MessageBusSettings.cs:199-201`). SQS declares 900 seconds
(`AmazonSqsTransport.cs:46`, `:65`); PostgreSQL pushes a row's visibility out and declares no cap
(`PostgreSqlBrokerTransport.cs:19-21`, `:58`). Each transport schedules the delay its own way: RabbitMQ
through per-interval delay queues with no plugin, PostgreSQL through the row's visibility time, Azure
Service Bus and Amazon SQS through their native scheduling (`MessageBusSettings.cs:208-210`).

## Passwordless connections through core hooks

The adapters that put a database or cache on token login go through core extension points rather than
each inventing a connection path. For PostgreSQL that point is `INpgsqlDataSourceConfigurator`, with one
method, `Configure(NpgsqlDataSourceBuilder)` (`INpgsqlDataSourceConfigurator.cs:23`, `:27`), registered
through `AddNpgsqlDataSourceConfigurator` as an enumerable (`DependencyInjection.Persistence.cs:24`,
`:28`), which builds one shared `NpgsqlDataSource` per connection string (`:32-34`). With none
registered the contexts get the raw connection string and no data source is built
(`INpgsqlDataSourceConfigurator.cs:12-13`).

Three configurators implement it, one per cloud. `AzurePostgreSqlEntraAuthenticationConfigurator`
refreshes its Entra token every four minutes (`AzurePostgreSqlEntraAuthenticationConfigurator.cs:23`,
`:26`), `RdsIamAuthenticationConfigurator` every 10 minutes (`RdsIamAuthenticationConfigurator.cs:20`,
`:24`) and `CloudSqlIamAuthenticationConfigurator` every minute
(`CloudSqlIamAuthenticationConfigurator.cs:23`, `:26`). Because the token travels as the password, the
Azure call fails registration for a configured PostgreSQL connection string that does not require TLS
(`AzureServiceCollectionExtensions.cs:167-170`, `:193-195`). And because the `PostgreSql` broker runs on
the same shared data source, a token configurator covers the broker's connections too, the startup
migration included (`PostgreSqlBrokerTransport.cs:31-33`, `:103-109`).

Redis gets the same treatment on Azure: `AddAzureRedisEntraAuthentication` puts every framework Redis
connection (the client and distributed cache, the output-cache store, the SignalR backplane and the
health check) on Entra token login through the core `IRedisConfigurationOptionsConfigurator` extension
point (`AzureServiceCollectionExtensions.cs:210-221`, `:230`). SQL Server takes Entra through the SqlClient
extension package `MMCA.Common.Azure` references, with no call at all (`MMCA.Common.Azure.csproj:31`).

## Silent degradation is the failure the tripwires remove

An opt-in adapter call has one failure mode of its own. A host that has the configuration but not the
adapter call would start cleanly with every vault secret missing, or with no telemetry
export, and look healthy while doing it (`HostIntegrationTripwire.cs:6-11`). The framework turns that
into a startup failure.

`HostIntegrationTripwire` (`HostIntegrationTripwire.cs:15`) is an `IValidateOptions` registered by
`AddServiceDefaults()` under `ValidateOnStart` (`Extensions.cs:50-52`), so it runs before any hosted
service starts. It holds one presence gate per host-level adapter call:

- Azure: `APPLICATIONINSIGHTS_CONNECTION_STRING` (`:20`), `KeyVault:Uri` (`:23`) and
  `DataProtection:BlobStorageUri` (`:26`).
- AWS: `SecretsManager:NamePrefix` (`:29`), `DataProtection:S3ObjectUri` (`:32`) and
  `AwsTelemetry:Region` (`:56`).
- Google Cloud: `GoogleSecretManager:NamePrefix` (`:47`), `DataProtection:GcsObjectUri` (`:50`) and
  `GoogleCloudTelemetry:ProjectId` (`:53`).

It also holds one boolean gate per token configurator: `AzurePostgreSql:EntraAuthentication:Enabled`,
`Rds:IamAuthentication:Enabled`, `CloudSql:IamAuthentication:Enabled` and
`AzureRedis:EntraAuthentication:Enabled` (`:63`, `:69`, `:75`, `:81`). A boolean gate fails when it reads
true with no configurator registered, and also when its value is neither blank nor a boolean, because
whoever wrote "yes" meant on (`:191-205`). A retired AWS key-ring key fails startup naming the key that
replaced it (`:34-39`, `:123-127`).

Each adapter call leaves a receipt behind, a `HostIntegrationMarker` singleton
(`HostIntegrationMarker.cs:10`; for example `AzureMonitorExporterExtensions.cs:63`), and the tripwire
fails any presence gate that is set with no matching receipt (`HostIntegrationTripwire.cs:183-189`). A key
holding only whitespace counts as unset (`:207`). The message names the package and the call. A host
with a vault URI and no vault call fails with:

```text
KeyVault:Uri is set, but no Key Vault configuration source was added, so every secret the vault holds
is missing from configuration. Reference MMCA.Common.Azure.Startup (or MMCA.Common.Azure, which
includes it) and call builder.AddAzureKeyVaultConfiguration() early in Program.cs.
```

(The format is `"{key} is set, but {consequence}."`, `:187`, with the consequence at `:106`.) The same
validator refuses a host that sets more than one of the three key-ring gates, because two configured
rings are a split ring, not a stronger one: whichever registration runs last owns the repository, and
replicas that disagree mint cookies the others cannot decrypt (`:84-89`, `:170-178`).

The service-level twin is `CloudAdapterTripwire` (`CloudAdapterTripwire.cs:32`), registered by
`AddInfrastructure` (`DependencyInjection.cs:244-246`). It fails `NativePush:Enabled=true` when
`INativePushSender` is still the null default (`CloudAdapterTripwire.cs:35`, `:77-78`), naming the call
of each of the three push adapters (`:81`), and applies the same rule to two opt-in framework features,
`Passkeys:Enabled` and `MachineClients:Enabled` (`:37-49`, `:64-75`). File storage deliberately has no
check: a tripwire must fire on a key that declares intent, and a `FileStorage` section is routinely
shared across every service of a solution, including the ones that never store files (`:24-28`).

Order matters in two places, and both fail loudly. `AddAzureMonitorExporter()` throws when it runs
before `AddServiceDefaults()`, because the outbox-poll and probe filter processors must be registered
ahead of the exporter's batch processor (`AzureMonitorExporterExtensions.cs:44-52`), and
`AddGoogleCloudTelemetryExporter()` and `AddAwsTelemetryExporter()` carry the same guard
(`GoogleCloudTelemetryExporterExtensions.cs:103-111`, `AwsTelemetryExporterExtensions.cs:91-99`). An
adapter transport must be registered before `AddBrokerMessaging` resolves it
(`DependencyInjection.Messaging.cs:163-170`).

## The boundary is gated twice

A rule that lives in a guideline erodes the first time an SDK is one `dotnet add package` away. This
one is held by two gates that look at different evidence.

**At build time**, the `EnforceCloudVendorBoundary` target (`MMCA.Common.LayerEnforcement.targets:155`)
runs in every MMCA.Common source project except the five adapters: the targets file is imported only
for a project under `Source` whose name starts with `MMCA.Common` (`MMCA.Common/Directory.Build.props:189-190`),
and the target skips the adapters (`:153`), so test and consumer projects are outside it. It fails a
`PackageReference` whose id starts with `Azure.`, `Microsoft.Azure.`, `AWSSDK.`, `Google.` or
`FirebaseAdmin`, equals `Grpc.Auth`, is one of the retired MassTransit vendor transports, or carries an
`.Azure` segment (`:162-172`), and it fails a `ProjectReference` naming an adapter project (`:173-174`),
each with its own error (`:176-177`, `:178-179`).

**At test time**, `CloudVendorIsolationTestsBase` (`CloudVendorIsolationTestsBase.cs:16`) judges the
compiled assemblies instead of the declared references, so a vendor type that arrives transitively is
caught too (`:10-13`). A subclass names the assemblies that must stay neutral (`:19`) and any engine
allowance (`:25-26`), and inherits two facts: no vendor type named (`:28-30`) and no vendor or adapter
assembly referenced (`:32-34`). The rule bodies match the namespace roots `Azure`, `Microsoft.Azure`,
`Amazon`, `Google`, `FirebaseAdmin` and `Grpc.Auth` (where `Azure` and `Amazon` also cover the Service
Bus and SQS/SNS clients the native transports run on), the retired MassTransit vendor transports and the
adapter roots (`ArchitectureRules.CloudVendors.cs:8-15`, `:28-44`), plus the matching assembly prefixes
(`:51-65`).

One detail in that list is worth copying for its own sake: the namespace roots carry **no trailing dot**,
because the rule engine matches whole namespace segments and an entry ending in a dot matches nothing, which
would make the type-level rule pass vacuously (`:30-31`). A fitness test that cannot fail is worse than
no test, because it reads as coverage.

The build gate exempts exactly two references, and both are database engines rather than cloud
services: `Microsoft.EntityFrameworkCore.Cosmos` in Infrastructure, because Cosmos DB is one of the four
EF engines and brings `Microsoft.Azure.Cosmos` with it, and `Aspire.Hosting.Azure.CosmosDB` in
Aspire.Hosting, the AppHost-side emulator resource that never reaches a service process
(`MMCA.Common.LayerEnforcement.targets:142-149`, exemptions at `:159-160`). The test gate in
MMCA.Common's own architecture tests carries one allowance, `Microsoft.Azure.Cosmos` in Infrastructure
(`Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/CloudVendorIsolationTests.cs:32`), and
Aspire.Hosting is not among the assemblies it holds (`:19-27`), so the AppHost-side exemption belongs to
the build gate alone.

## How ADC and Store adopt it

Both consumers run on Azure, so the adoption is a set of Azure calls in each host. The services build
their hosts through `AddMmcaServiceHost`, which takes the adapter calls as callbacks and runs them in a
fixed order: configuration sources, then `AddServiceDefaults()`, then the after-service-defaults
callback (`ServiceHostBuilderExtensions.cs:79`, `:85-86`), and later `AddInfrastructure`, the services
callback, the broker transports and the application pipeline (`:146`, `:153`, `:156`, `:158`). Both
order rules are therefore held by the host builder, not by each `Program.cs`. ADC's Identity service
shows every host-level call and its four service-level ones (condensed, comments shortened):

```csharp
// MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs (condensed)
var host = builder.AddMmcaServiceHost(new()
{
    // :91, runs first, so every eager bind can read vault values
    ConfigureConfigurationSources = b => b.AddAzureKeyVaultConfiguration(),

    AfterServiceDefaults = b =>
    {
        b.AddAzureMonitorExporter();   // :98, no-op without the connection string
        b.AddAzureDataProtection();    // :106, shared key ring; no-op without DataProtection:BlobStorageUri
    },

    ConfigureServices = b =>
    {
        var services = b.Services;
        var configuration = b.Configuration;
        services.AddAzureRedisEntraAuthentication(configuration);   // :128, inert until its gate is set
        services.AddAzureBlobFileStorage(configuration);            // :225, no-op unless FileStorage is complete
        services.AddAzureNotificationHubsPush(configuration);       // :231, account erasure reaches the hub
    },

    // Registration only: production sets MessageBus:Provider=AzureServiceBus.
    RegisterBrokerTransports = services => services.AddAzureServiceBusTransport(),   // :260

    ConfigurePipeline = (pipeline, moduleHost) => pipeline
        .Register(moduleHost.RegisterModules)
        .Register(s => s.AddBrokerMessaging(builder.Configuration, IdentityBrokerConsumers.Register)),   // :302-308
});
```

The provider string itself comes from the deployment, not the code: ADC's container apps carry
`MessageBus__Provider` = `AzureServiceBus` (`MMCA.ADC/infra/main.bicep:2439`), and Store's do the same
(`MMCA.Store/infra/main.bicep:2076`). The comment at the transport callback says what that buys: a
RabbitMQ or in-process run is unaffected by the registration (`Program.cs:256-259`).

The other ADC services follow the same lines: Conference (`MMCA.ADC.Conference.Service/Program.cs:82`;
vault `:97`, exporter `:118`, Redis `:228`, Blob storage `:301`, transport `:325`), Engagement (`:70`,
`:75`, Redis `:85`, transport `:140`) and Notification (`:70`, `:85`, Redis `:91`, transport `:97`). The
Gateway makes the host-level calls directly, in the same order (`MMCA.ADC.Gateway/Program.cs:75`, `:77`,
`:82`), and the web UI host passes them through the same callback names, with its key ring
(`MMCA.ADC.UI.Web/Program.cs:39`, `:46`, `:47`). Native push is a module call plus one host call: the
Notification module's `AddNotificationModule` calls `AddAzureNotificationHubsPush(configuration)`, safe
in every environment because it is a no-op until the `NativePush` section is enabled and complete
(`MMCA.ADC.Notification.API/DependencyInjection.cs:31`, `:37-40`), and the Identity host makes the same
call so account erasure reaches the hub the devices are registered in
(`MMCA.ADC.Identity.Service/Program.cs:227-231`).

Store's shape is the same with fewer capabilities. Its three broker services build through
`AddMmcaServiceHost` with the vault source, the exporter, Redis Entra sign-in and the Service Bus
transport ahead of `AddBrokerMessaging` (Sales `MMCA.Store.Sales.Service/Program.cs:63`, `:76`, `:93`,
`:124`, `:139`; Identity `:48`, `:56`, `:77`, `:119`, `:125`; Catalog `:42`, `:46`, `:80`, `:102`,
`:110`), and Sales and Identity add the key ring (Sales `:82`, Identity `:62`). The Gateway calls
`AddAzureKeyVaultConfiguration()`, `AddServiceDefaults()` and `AddAzureMonitorExporter()` in that order
(`MMCA.Store.Gateway/Program.cs:67`, `:69`, `:74`), and the web UI host adds the key ring through its
callbacks (`MMCA.Store.UI.Web/Program.cs:39`, `:45`, `:50`).

Neither consumer calls an AWS or Google method, and neither restores those packages. That is the point.

## Trade-offs, honestly

- **Every Azure host carries more calls.** The exporter, the transport, the key ring and the vault
  source are explicit calls in each host (`ADR-134:402-404`). The tripwire is what keeps a
  forgotten line from being a silent regression.
- **Registration order matters, twice.** Exporter after `AddServiceDefaults()`, transport before
  `AddBrokerMessaging`. `AddMmcaServiceHost` fixes both for a service, and both fail at startup with the
  fix in the message for a host wired by hand, which is the best an order dependency can do, but it is
  still an order dependency.
- **The core is cloud-neutral in its cloud services, not free of every Azure assembly.** The Cosmos
  engine brings `Microsoft.Azure.Cosmos` transitively, and both gates name that exemption explicitly
  (`MMCA.Common.LayerEnforcement.targets:144-147`, `CloudVendorIsolationTests.cs:32`). A third exemption is a deliberate edit to both gates.
- **Clouds are not interchangeable at the edges.** SQS caps a message delay at 900 seconds
  (`AmazonSqsTransport.cs:46`), and the pipeline shortens any longer redelivery interval to that cap
  rather than failing it (`AmazonSqsTransport.cs:28-30`, `BrokerTransportPolicies.cs:65-75`), so the
  framework default `[60, 600, 3600]` (`MessageBusSettings.cs:190`) runs as one minute, ten minutes and
  fifteen minutes on SQS. Metrics need a collector on both non-Azure clouds: the Google Telemetry API
  takes at most 200 data points per metric request and the .NET SDK cannot split one metric
  (`GoogleCloudTelemetryExporterExtensions.cs:78-86`), and the AWS call exports traces and logs only,
  because one request is capped at 1,000 data points, so metrics go through an ADOT collector
  (`AwsTelemetryExporterExtensions.cs:66-69`).
- **Emulators are not the clouds, and the live tiers are not merge gates.** The live-broker CI tiers
  cover all four transports (PostgreSQL, SQS/SNS against LocalStack, RabbitMQ and the Azure Service Bus
  emulator), none of them a required check (`common-ArchitectureScorecard.md:75`), and the AWS telemetry
  exporter has not been exercised against live X-Ray or CloudWatch Logs endpoints
  (`AwsTelemetryExporterExtensions.cs:72-74`).

## Apply this even without MMCA

The pattern ports to any framework, internal platform or shared library that more than one deployment
consumes. Six steps:

1. **Draw the line at the package, not the namespace.** A vendor SDK in a core package is a dependency
   of every consumer, whatever namespace hides it. Adapter packages per vendor, referencing the core,
   never the reverse.
2. **Ship an inert or neutral default for every capability.** A null push sender, a storage service
   that fails each call with a named error, in-process messaging, OTLP telemetry. The core must run, and
   fail understandably, with no adapter at all.
3. **One call per capability, a no-op until configured.** A host that calls the method in every
   environment keeps one `Program.cs`; the configuration decides what is live. Keep the configuration
   keys stable across the move so deployments do not change.
4. **Make selection open, and keep the plug-in small.** A provider name as a string resolved against
   registered implementations, not an enum, and a transport contract that only moves bytes while the
   framework keeps the policy. Fail at registration when the name matches nothing, and put the package
   and the call in the message for the names you know.
5. **Fail startup on intent without implementation.** For each configuration key that declares "this
   host uses vendor X", have the adapter call leave a marker and check the pair at startup. Check only
   keys that declare intent; a shared section that every service sees is not one.
6. **Gate it twice, and test the gate.** A build check on declared package ids and an architecture test
   on compiled assemblies catch different leaks. Then pin each rule with a case that must fail, because a
   rule that matches nothing passes forever.

The rule of thumb: **a consumer should pay only for the cloud it runs on, and a host that forgot its
adapter should not start.**

---

**What we covered:** why cloud SDKs in a core package tax every consumer, how ADR-134 splits the
framework into a cloud-neutral core with inert defaults, four cloud adapter packages and a test adapter
with one call per capability, why the broker provider is an open string resolved against
`IBrokerTransport` registrations that only move bytes and why the database-only `PostgreSql` broker
belongs in the core, how passwordless PostgreSQL and Redis go through core configurator hooks, how
`HostIntegrationTripwire` and `CloudAdapterTripwire` turn a missing adapter call into a startup error
that names it, how `EnforceCloudVendorBoundary` and `CloudVendorIsolationTestsBase` hold the boundary
at build and test time, and how ADC and Store wire the Azure adapter through `AddMmcaServiceHost`
callbacks host by host.

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-134 behind this pattern, or
`dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision record: `Website/docs-src/adr/134-cloud-neutral-core-vendor-adapters.md`
- The full 34-category scorecard, §7, §10 and §32 included, lives in
  `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 52, "Finishing identity: second factor, email confirmation and stored permission
grants." Next in the series: Article 54, ["Borrowed and Machine Identities: Read-Only View-As and OAuth Client
Credentials"](borrowed-and-machine-identities.md).*

*Tags: .NET, C Sharp, Cloud Computing, Microservices, Software Architecture*

*Notes: verified type/behavior names with path:line (all read this run). Re-verified 2026-11-25 against
MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`), 30 published packages (`FACTS.md:20`), 186 fitness
test methods across 74 abstract bases (`FACTS.md:98`). First written 2026-10-29 to give ADR-134 and
functional group G29 an article cell. Change history (ledger only, not narrated in the body): the
2026-11-25 refresh was a structural rewrite. MassTransit left MMCA.Common in v1.316.0 (scorecard
`common-ArchitectureScorecard.md:75`), so the transport section now describes the native contract
(`IBrokerTransport.Register(IServiceCollection, BrokerTransportContext)` and `MaxRedeliveryDelay`) in
place of the `IBusRegistrationConfigurator` one; the `PostgreSql` broker is described as framework code
on Npgsql; the "every consumer restores the SQL transport" and "an IAM-only broker database cannot
migrate at startup" trade-offs were dropped (no MassTransit PackageVersion remains,
`MMCA.Common/Directory.Packages.props:164-167`; the migration now runs on the shared data source,
`PostgreSqlBrokerTransport.cs:31-33`); the SQS-specific `[60, 300, 900]` default and the
over-cap-interval failure were replaced by the shared clamp; the RabbitMQ `EnableDelayedRedelivery`
sentence was replaced by the per-transport scheduling line; the adapter count went from three plus a
test adapter to four plus a test adapter (`MMCA.Common.Azure.Startup`); the table gained the Azure
PostgreSQL and Redis Entra calls and the AWS telemetry exporter; the tripwire section gained the four
boolean gates, the retired AWS key and the Passkeys/MachineClients checks; the adoption section was
rewritten around `AddMmcaServiceHost` callbacks; the CI trade-off now reflects four live-broker tiers;
the footer points at Article 54. Code blocks: the two transport calls are verbatim
(`AzureServiceCollectionExtensions.cs:154-155`, `AwsServiceCollectionExtensions.cs:86-87`); the ADC block
is condensed from `MMCA.ADC.Identity.Service/Program.cs:79-309` (comments shortened to one line each,
`LogFilePath`, `ModuleAssemblies`, `Authentication` and every other registration in `ConfigureServices`
trimmed, the four export and invitation clients inside the pipeline trimmed); the tripwire message is
assembled from the format string `HostIntegrationTripwire.cs:187` and the consequence text `:106`,
line-wrapped for width. The SQS one/ten/fifteen-minute sequence is derived by applying the clamp at
`BrokerTransportPolicies.cs:69-74` to the default at `MessageBusSettings.cs:190` with the 900-second cap
at `AmazonSqsTransport.cs:46`.*
- *Flag (2026-11-25): ADR-134 still describes the MassTransit-era transport (`Configure` on the bus
  configurator, `MassTransit.SqlTransport.PostgreSQL`, the "no MassTransit v8 Pub/Sub transport"
  rationale at `ADR-134:222-227`, and the SQL-transport-restored trade-off at `:418-420`), contradicting
  the source read this run (`IBrokerTransport.cs:51`, `PostgreSqlBrokerTransport.cs:10-15`). This
  article follows the source and does not cite those ADR lines; the ADR needs its own refresh.*
- *ADR-134 (`Website/docs-src/adr/134-cloud-neutral-core-vendor-adapters.md`), Status at `:3-42`: the
  decision sentence (`:61-62`), four cloud adapters and one test adapter (`:65-68`), the Startup package
  rationale (`:69-70`), the Google adapter's missing transport (`:191-192`), the test adapter
  (`:193-195`), unchanged configuration keys (`:196-201`), the new-calls trade-off (`:402-404`) and the
  rejected PostgreSQL-in-Gcp alternative (`:483-486`).*
- *Adapter calls (paths rooted at `MMCA.Common/Source/Hosting/`): Azure Startup
  `MMCA.Common.Azure.Startup/AzureKeyVaultConfigurationExtensions.cs:80`, `AzureDataProtectionExtensions.cs:54`,
  `AzureMonitorExporterExtensions.cs:42` (order guard `:44-52`, gate and no-op `:54-59`, marker `:63`,
  `UseAzureMonitor` `:65`). Azure `MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:44`
  (`AddAzureBlobFileStorage`, no-op returns `:51-62`), `:95` (`AddAzureNotificationHubsPush`),
  `:154-155` (`AddAzureServiceBusTransport`, registration-only remark `:150-151`), `:181`
  (`AddAzurePostgreSqlEntraAuthentication`, TLS rule `:167-170`, `:193-195`), `:230`
  (`AddAzureRedisEntraAuthentication`, scope `:210-221`); `PostgreSql/AzurePostgreSqlEntraAuthenticationConfigurator.cs:23`
  (4-minute refresh `:26`); `MMCA.Common.Azure.csproj:31` (`Microsoft.Data.SqlClient.Extensions.Azure`),
  `:39` (references Startup). AWS `MMCA.Common.Aws/AwsSecretsManagerConfigurationExtensions.cs:82`,
  `AwsDataProtectionExtensions.cs:70`, `AwsServiceCollectionExtensions.cs:51` (`AddS3FileStorage`),
  `:86-87` (`AddAmazonSqsTransport`), `:108` (`AddAwsRdsIamAuthentication`), `:174` (`AddAmazonSnsPush`),
  `AwsTelemetryExporterExtensions.cs:89` (order guard `:91-99`, marker `:122`, 1,000-point metrics
  rationale `:66-69`, not-exercised-live remark `:72-74`); `Messaging/AmazonSqsTransport.cs`
  `MaxDelaySeconds` 900 `:46`, `MaxRedeliveryDelay` `:65`, clamp remark `:28-30`;
  `Rds/RdsIamAuthenticationConfigurator.cs:20` (10-minute refresh `:24`). Google Cloud
  `MMCA.Common.Gcp/GoogleSecretManagerConfigurationExtensions.cs:82`, `GoogleCloudDataProtectionExtensions.cs:77`,
  `GoogleCloudTelemetryExporterExtensions.cs:101` (metrics rationale `:78-86`, order guard `:103-111`),
  `GcpServiceCollectionExtensions.cs:49` (`AddGoogleCloudStorage`), `:91` (`AddCloudSqlIamAuthentication`),
  `:149` (`AddFirebaseCloudMessagingPush`); `CloudSql/CloudSqlIamAuthenticationConfigurator.cs:23`
  (1-minute refresh `:26`). No Redis call exists in either the AWS or the Google adapter (Grep for
  `Redis` over both trees: zero matches this run), the basis for the two "none" cells.*
- *Core messaging (paths rooted at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/`):
  `Messaging/MessageBusSettings.cs:25` (`Provider`, default `InProcess`), `:190`
  (`DefaultRedeliveryIntervalsSeconds` `[60, 600, 3600]`), clamp remark `:199-201`, per-transport
  scheduling `:208-210`; `Messaging/Transports/MessageBusProviders.cs:10` (case-insensitive `:4-8`,
  `InProcess` `:16`, `RabbitMq` `:19`, `PostgreSql` `:27`, `KnownAdapterTransports` `:34-39`);
  `Messaging/Transports/IBrokerTransport.cs:22` (boundary remark `:8-14`, `Name` `:28`,
  `MaxRedeliveryDelay` `:35`, `Register` `:37-51`, startup-throw remark `:45-46`);
  `Messaging/Transports/BrokerTransportPolicies.cs:65-75` (`BuildRedeliveryIntervals` clamp);
  `Messaging/Transports/PostgreSql/PostgreSqlBrokerTransport.cs:36` (any-PostgreSQL rationale `:10-15`,
  `pg_notify` and `SKIP LOCKED` `:17-19`, no delay cap `:19-21`, shared data source and migration
  `:31-33`, `Name` `:55`, `MaxRedeliveryDelay` `:58`, `CreateStore` `:103-109`);
  `DependencyInjection.Messaging.cs:63` (`AddBrokerMessaging`, in-process exit `:72-75`,
  resolve-before-register `:82-84`, pipeline with delay cap `:108-115`, `transport.Register` `:150-158`),
  `AddBrokerTransport` `:174` (order and idempotence remark `:163-170`, `TryAddEnumerable` `:183`),
  `ResolveBrokerTransport` `:199-221`, the actionable throw `:223-231` (known-adapter remedy `:227`,
  other-name remedy `:228`).*
- *Core persistence and tripwires: `Persistence/DbContexts/INpgsqlDataSourceConfigurator.cs:23`
  (`Configure` `:27`, none-registered path `:12-13`); `DependencyInjection.Persistence.cs:24`
  (`AddNpgsqlDataSourceConfigurator`, enumerable `:28`, keyed data source `:32-34`);
  `Configuration/CloudAdapterTripwire.cs:32` (no file-storage check `:24-28`, `NativePush:Enabled` `:35`,
  Passkeys and MachineClients keys `:37-49` and checks `:64-75`, null-sender check `:77-78`, message
  `:81`), registered at `DependencyInjection.cs:244-246`.
  `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/`: `Integrations/HostIntegrationTripwire.cs:15`
  (rationale `:6-11`, presence gates `:20`, `:23`, `:26`, `:29`, `:32`, `:47`, `:50`, `:53`, `:56`, retired
  AWS key `:34-39` and check `:123-127`, boolean gates `:63`, `:69`, `:75`, `:81`, key rings `:84-89`,
  `Validate` `:94`, vault consequence `:106`, multi-ring failure `:170-178`, `Check` `:183-189`, format
  `:187`, `CheckBooleanGate` `:191-205`, `IsSet` `:207`); `Integrations/HostIntegrationMarker.cs:10`;
  registered at `Extensions.cs:50-52`; OTLP gate `Extensions.Telemetry.cs:166-172`.
  `MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/`: `ServiceHostBuilderExtensions.cs:65`
  (`AddMmcaServiceHost`; configuration sources `:79`, `AddServiceDefaults` `:85`, after-defaults `:86`,
  `AddInfrastructure` `:146`, services `:153`, broker transports `:156`, pipeline `:158`);
  `MmcaServiceHostOptions.cs:35`, `:66`, `:72`, `:78`, `:84`.*
- *Gates: `MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets` (package-id rule comment
  `:133-140`, retired MassTransit ids `:135-136`, exemption comment `:142-149` with the Cosmos-transitive
  note `:144-147`, five-adapter property `:153`, `EnforceCloudVendorBoundary` `:155`, exemptions
  `:159-160`, id patterns `:162-172`, adapter `ProjectReference` rule `:173-174`, errors `:176-177`,
  `:178-179`); imported at `MMCA.Common/Directory.Build.props:189-190`.
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/CloudVendorIsolationTestsBase.cs:16`
  (runtime-half remark `:10-13`, `CloudNeutralAssemblies` `:19`, `AllowedVendorPrefixes` `:25-26`, the two
  facts `:28-30`, `:32-34`); `Rules/Layering/ArchitectureRules.CloudVendors.cs:8-15` (scope remark),
  `:28-44` (`CloudVendorDependencies`, no-trailing-dot comment `:30-31`) and `:51-65`
  (`CloudVendorAssemblyPrefixes`); `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/CloudVendorIsolationTests.cs:19-27`
  (assemblies, Aspire.Hosting absent), `:32` (Cosmos allowance).*
- *MMCA.ADC adoption (paths rooted at `MMCA.ADC/Source/`): `Services/MMCA.ADC.Identity.Service/Program.cs`
  `:79`, `:91`, `:93`, `:98`, `:106`, `:119-122`, `:128`, `:225`, `:256-259` (registration-only comment),
  `:260`, `:302-308`; `Services/MMCA.ADC.Conference.Service/Program.cs:82`, `:97`, `:118`, `:228`, `:301`,
  `:325`, `:360`; `Services/MMCA.ADC.Engagement.Service/Program.cs:58`, `:70`, `:75`, `:85`, `:140`, `:224`;
  `Services/MMCA.ADC.Notification.Service/Program.cs:58`, `:70`, `:85`, `:91`, `:97`, `:121`;
  `Hosts/MMCA.ADC.Gateway/Program.cs:75`, `:77`, `:82`; `Hosts/UI/MMCA.ADC.UI.Web/Program.cs:39`, `:46`,
  `:47`; `Modules/Notification/MMCA.ADC.Notification.API/DependencyInjection.cs:40` (no-op remark
  `:37-39`). Provider: `MMCA.ADC/infra/main.bicep:2439` (repeated `:2686`, `:2846`, `:3006`). The only
  adapter packages pinned are `MMCA.Common.Azure`, `MMCA.Common.Azure.Startup` and
  `MMCA.Common.Testing.Azure`, all 1.319.0 (`MMCA.ADC/Directory.Packages.props:175`, `:179`, `:180`; Store
  `MMCA.Store/Directory.Packages.props:37`, `:41`, `:38`), which is the basis for "neither restores those
  packages".*
- *MMCA.Store adoption (paths rooted at `MMCA.Store/Source/`): `Services/MMCA.Store.Sales.Service/Program.cs:51`,
  `:63`, `:76`, `:82`, `:93`, `:124`, `:139`; `Services/MMCA.Store.Identity.Service/Program.cs:37`, `:48`,
  `:56`, `:62`, `:77`, `:119`, `:125`; `Services/MMCA.Store.Catalog.Service/Program.cs:32`, `:42`, `:46`,
  `:80`, `:102`, `:110`; `Hosts/MMCA.Store.Gateway/Program.cs:67`, `:69`, `:74`;
  `Hosts/UI/MMCA.Store.UI.Web/Program.cs:39`, `:45`, `:50`. Provider: `MMCA.Store/infra/main.bicep:2076`
  (repeated `:2271`, `:2416`).*
- *Verifier fixes (2026-11-25): Identity's service-level Azure calls counted as four, with the push call
  added to the condensed block (`MMCA.ADC.Identity.Service/Program.cs:128`, `:225`, `:231`, `:260`);
  native push described as the module call plus the Identity host call made for account erasure
  (`MMCA.ADC.Notification.API/DependencyInjection.cs:31`, `:40`; `MMCA.ADC.Identity.Service/Program.cs:227-231`);
  the `MMCA.Common/UPGRADING.md:988-996` gate table citation dropped from the trade-off and from this
  ledger, because it is a historical Azure-only table whose FileStorage row disagrees with the current
  tripwire (`CloudAdapterTripwire.cs:24-28`); the footer quotes Article 54's full title.*
- *Rubric and scorecard: §7 Microservices Readiness
  (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:251`, Anti-Corruption Layer criterion
  `:263`, vendor-model red flag `:270`, weight 3 `:272`); §10 Messaging and Integration Architecture
  (`:329`); §32 Dependency and Supply-Chain Management (`:843`, transitive-review criterion `:852`,
  unaudited-transitive red flag `:859`, weight 3 for a published framework `:861`). Scores:
  `Website/docs-src/governance/common-ArchitectureScorecard.md:72` (§7 weight 3, Maturity 4,
  Implementation 9), `:75` (§10 weight 3, Maturity 4, Implementation 8; four live-broker tiers, none
  required), `:97` (§32 weight 3, Maturity 4, Implementation 9), evidence as of 2026-11-23 at v1.315.0
  (`:5`), facts re-verified 2026-11-24 against v1.318.0 (`:6`). Group G29 Common Cloud Provider Adapters
  (AWS, Azure, GCP) (`Website/docs-src/onboarding/00-group-taxonomy.md:83`, chapter
  `group-28-common-cloud-provider-adapters.md`; not re-read this run).*

- Full series index: https://ivanball.github.io/writing.html
