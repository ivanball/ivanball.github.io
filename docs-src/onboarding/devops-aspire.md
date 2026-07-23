# Aspire Orchestration and Containers

This chapter teaches how the MMCA.ADC system goes from a single `dotnet run` on your workstation to a
running eight-process stack with databases, a broker, a cache, a mail interceptor, and a dashboard.
You will learn which resources the AppHost provisions and why, how service discovery and health-based
startup ordering wire everything together, what service defaults each service host gets from the
framework's `MMCA.Common.Aspire` package (there is no longer an ADC-local `ServiceDefaults` project),
how the two `MMCA.Common.Aspire*` framework packages embed that machinery at the framework level, and
how each deployable is packaged into its Docker image. By the end you should be able to follow a
`WithReference` edge from first principles and explain local-to-cloud parity without looking at any
other document.

Cross-references: [primer §1, the big picture](00-primer.md#1-the-big-picture),
[primer §2, architectural styles](00-primer.md#2-architectural-styles-this-codebase-commits-to).

---

## The one-command local run

```
dotnet run --project Source/Hosting/MMCA.ADC.AppHost
```

That command brings up everything the application needs locally: four SQL Server databases, Redis,
RabbitMQ with management UI, a MailDev SMTP interceptor, four extracted microservice processes, a YARP
gateway pinned to `https://localhost:6001`, and the Blazor UI pinned to `https://localhost:6002`. The
Aspire dashboard, opened automatically, shows live logs, metrics, and distributed traces from every
process via an OTLP endpoint it injects into each one. No Docker Compose file is needed; no environment
variables need to be set by hand; the AppHost is the single source of truth for the local topology.

[Rubric §33, Developer Experience] assesses how quickly a new engineer becomes productive. A
single-command local run that matches production topology (same services, same broker, same auth flow)
means the feedback loop is: edit → restart → observe real cross-service behavior, rather than mocking
everything and discovering integration bugs in CI.

---

## `MMCA.ADC.AppHost`, the orchestration project

> Source file: `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs`
> Extension helpers: `MMCA.Common.Aspire.Hosting/Extensions.cs` (`AddMessageBroker`, `WithBroker`,
>   `WithJwksDiscovery`, `WithSQLServerDataSource` / `WithCosmosDataSource` / `WithSqliteDataSource`,
>   there is no AppHost-local extensions file)
> Project file: `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/MMCA.ADC.AppHost.csproj`

### Project identity

The `.csproj` (AppHost.csproj:3) opts in to the `Aspire.AppHost.Sdk` (version 13.2.3), which activates
the Aspire resource model, code-generates strongly-typed `Projects.*` references from the project
references listed below it (AppHost.csproj:19-24), and arranges for the `.Build().RunAsync()` entry
point (Program.cs:285) to launch the dashboard and all declared resources. The SDK also picks up
`MMCA.Common.Aspire` and `MMCA.Common.Aspire.Hosting` as plain `PackageReference`s marked
`IsAspireProjectResource="false"` (AppHost.csproj:25-26) so the hosting extensions and service-defaults
extensions those packages export are available without treating them as orchestrated processes.

### Infrastructure containers

**SQL Server** is declared as a persistent container named `"sql"` (Program.cs:14-15). The
`ContainerLifetime.Persistent` option keeps the container alive across AppHost restarts, preserving
data and avoiding re-seeding during inner-loop development (Program.cs:12-13 comment). Four databases are
carved from it (Program.cs:32-35):

```
adc-identity    →  ADC_Identity     (Identity service)
adc-conference  →  ADC_Conference   (Conference service)
adc-engagement  →  ADC_Engagement   (Engagement service)
adc-notification →  ADC_Notification (Notification service)
```

One database per service is the direct implementation of ADR-006 (database-per-service). No service
touches another service's database; no service races for another service's outbox rows.

**Redis** is also persistent (Program.cs:39-40), used by service hosts for distributed output-caching
and `ICacheService` (`DistributedCacheService`). All four service hosts receive a `WithReference(redis)`
and `WaitFor(redis)`.

**RabbitMQ** is provisioned via a framework helper (Program.cs:60-61):

```csharp
var rabbit = builder.AddMessageBroker()
    .WithLifetime(ContainerLifetime.Persistent);
```

`AddMessageBroker()` lives in `MMCA.Common.Aspire.Hosting` (Common.Aspire.Hosting/Extensions.cs:32-38)
and wraps `builder.AddRabbitMQ(name).WithManagementPlugin()`, the management plugin exposes the admin
UI at `http://localhost:15672`. All four services are wired to the broker via `WithBroker(rabbit)` which
sets `MessageBus__Provider=RabbitMq` in each service's environment (discussed below). The legacy
`AtlDevCon` database comment at Program.cs:26-31 explains why the single combined database is not
provisioned here: it exists on the persistent container as a frozen archive and rollback path, but the
AppHost no longer creates or migrates it.

**MailDev** is a plain Docker container (Program.cs:67-70):

```csharp
var mailDev = builder.AddContainer("maildev", "maildev/maildev")
    .WithLifetime(ContainerLifetime.Persistent)
    .WithHttpEndpoint(targetPort: 1080, port: 1080, name: "http")
    .WithEndpoint(targetPort: 1025, port: 1025, name: "smtp", scheme: "tcp");
```

The web UI at `http://localhost:1080` lets developers inspect every email the app sends. The SMTP port
1025 matches the `Smtp:Port` in `appsettings.json`. No other Aspire helper was needed because MailDev
is a third-party image with no matching Aspire hosting package.

[Rubric §17, DevOps and Deployment] assesses whether the local environment closely mirrors
production. Persistent container lifetime means you are not starting from an empty database on every
run; the same SQL + RabbitMQ + Redis containers back both development and the Aspire-driven E2E CI run,
so there is no "works on my machine" topology gap between developer and pipeline.

### The `WithSQLServerDataSource` extension (and its Cosmos/SQLite siblings)

`WithSQLServerDataSource` is a framework extension method, not an AppHost-local helper. It lives in
`MMCA.Common.Aspire.Hosting`'s `Extensions` class (Common.Aspire.Hosting/Extensions.cs:132-145); the
AppHost-local `DataSourceExtensions.cs` that once held it has been deleted. (It was named `WithDataSource`
until ADR-018; the rename to `WithSQLServerDataSource` gives it a consistent `With*DataSource` shape with
the two polyglot siblings below, a breaking API change swept across consumers in one lockstep release,
ADR-016.)

```csharp
public static IResourceBuilder<ProjectResource> WithSQLServerDataSource(
    this IResourceBuilder<ProjectResource> service,
    IResourceBuilder<SqlServerDatabaseResource> database,
    string logicalName)
{
    ArgumentNullException.ThrowIfNull(service);
    ArgumentNullException.ThrowIfNull(database);

    return service
        .WithReference(database)
        .WaitFor(database)
        .WithEnvironment($"DataSources__{logicalName}__SQLServerConnectionString",
                         database.Resource.ConnectionStringExpression)
        .WithEnvironment("ConnectionStrings__SQLServerConnectionString",
                         database.Resource.ConnectionStringExpression);
}
```

It injects the connection string twice. `DataSources__{logicalName}__SQLServerConnectionString` feeds
the MMCA.Common multi-database routing: entities whose logical source matches `logicalName` are routed
to this database. `ConnectionStrings__SQLServerConnectionString` satisfies the framework's `[Required]`
validation and the `AddSqlServer` health-check. Because both values are identical, the `DataSourceResolver`
singleton collapses the logical name onto the `Default` source, one `SQLServerDbContext` instance, one
EF change tracker, one migrations set per service. The `WaitFor(database)`
(Common.Aspire.Hosting/Extensions.cs:142) ensures the service process does not start until SQL Server
is healthy.

**Polyglot siblings (ADR-018).** Two more helpers wire the non-SQL engines for the staged Conference
`Session`→Cosmos / `Room`→SQLite move:
- `WithCosmosDataSource(service, database, logicalName)` (Extensions.cs:166-180) takes an
  `AzureCosmosDBDatabaseResource` and injects three env vars,
  `DataSources__{logicalName}__CosmosConnectionString`, `DataSources__{logicalName}__CosmosDatabaseName`
  (Cosmos's `UseCosmos` takes the database name separately), and `ConnectionStrings__CosmosConnectionString`.
  It layers **on top of** `WithSQLServerDataSource` (a service uses Cosmos for one module alongside its
  SQL Server source).
- `WithSqliteDataSource(service, logicalName, filePath)` (Extensions.cs:198-211) takes a file path
  (SQLite has no Aspire container resource) and injects `DataSources__{logicalName}__SqliteConnectionString`
  (`Data Source=<path>`) + `ConnectionStrings__SqliteConnectionString`.

### The four service hosts and their wiring

Services are declared in this order: Notification, Engagement, Conference, Identity (Program.cs:90-186).
Declaration order matters because the gateway and UI references are added after all four are declared
(Program.cs:240-283). Each service follows the same pattern:

```csharp
builder.AddProject<Projects.MMCA_ADC_{Module}_Service>("{name}", launchProfileName: "https")
    .WithSQLServerDataSource({moduleDb}, "{Module}")
    .WithReference(redis)
    .WithBroker(rabbit)
    .WaitFor(redis)
    .WaitFor(mailDev)
    .WithExternalHttpEndpoints();
```

`launchProfileName: "https"` selects the HTTPS launch profile from `launchSettings.json` so Aspire
registers both HTTP and HTTPS endpoints for service discovery (Program.cs:78-80 comment). `WithBroker` is
called from `MMCA.Common.Aspire.Hosting` and chains `.WithReference(broker).WaitFor(broker)
.WithEnvironment("MessageBus__Provider", "RabbitMq")` (Common.Aspire.Hosting/Extensions.cs:50-62),
meaning each service waits for RabbitMQ to be healthy before starting and has the environment variable
that makes `AddBrokerMessaging()` in its `Program.cs` select the RabbitMQ transport.

**Conference service** has one extra line (Program.cs:164):

```csharp
.WithEnvironment("Seeding__IncludeSampleConferenceData", "true")
```

This seeds sample speakers and sessions so the public browse grids are non-empty for the Playwright E2E
suite. The comment (Program.cs:161-163) explicitly restricts this to local dev and E2E CI; production
leaves this unset.

**Identity service** has special E2E handling (Program.cs:192-200): when `E2E_JWT_PRIVATE_KEY_PEM` and
`E2E_JWT_PUBLIC_KEY_PEM` environment variables are present (injected by the `e2e.yml` workflow for the
ephemeral CI keypair), they are forwarded to the Identity service's environment so it can sign RS256
tokens during E2E runs. Locally and in production these variables are absent, so user-secrets / Azure
Key Vault are used instead.

### gRPC cross-service references

Three directed edges express the gRPC topology (Program.cs:220-225):

```csharp
// Notification → Identity
notificationService.WithReference(identityService).WaitFor(identityService);
// Engagement → Conference
engagementService.WithReference(conferenceService).WaitFor(conferenceService);
// Conference → Engagement (reverse edge, deliberately no WaitFor)
conferenceService.WithReference(engagementService);
```

`WithReference` on a project resource injects `services__{name}__http__0` (and `https__0`) environment
variables into the consumer. The `AddTypedGrpcClient<T>(serviceName)` call in each service's
`Program.cs` uses `serviceName` to resolve `http://{name}` through Aspire's service discovery. The
deliberate asymmetry in the Conference↔Engagement pair is explained in the inline comment
(Program.cs:210-217): bidirectional `WaitFor` would produce a circular wait and deadlock. Instead,
transient "peer not ready" gRPC errors during startup self-heal via the standard Polly retry and
circuit-breaker pipeline baked into `AddTypedGrpcClient`. Engagement waits for Conference as a
best-effort ordering hint since Conference is the heavier producer (Program.cs:222).

[Rubric §7, Microservices Architecture] assesses how cleanly services are decoupled and how
inter-service calls are managed. Declaring `WithReference` only for actual call edges (not broadcasting
every service to every other service) keeps the service-discovery injection minimal and makes the
topology readable as code.

[Rubric §29, Resilience and Business Continuity] assesses whether the system can survive partial
failures. The no-WaitFor choice on the Conference→Engagement edge, combined with a resilience pipeline
on the typed gRPC clients, means a slow-starting peer never blocks the whole stack from reaching a
healthy state.

### The Gateway

```csharp
var gateway = builder.AddProject<Projects.MMCA_ADC_Gateway>("gateway")
    .WithReference(notificationService)
    .WithReference(engagementService)
    .WithReference(conferenceService)
    .WithReference(identityService)
    .WaitFor(notificationService)
    .WaitFor(engagementService)
    .WaitFor(conferenceService)
    .WaitFor(identityService)
    .WithExternalHttpEndpoints()
    .WithEndpoint("https", endpoint => endpoint.Port = 6001);
```

Program.cs:240-250. The gateway has no `WithSQLServerDataSource`, no `WithReference(redis)`, and no
`WithBroker`. It is stateless: no database, no cache, no broker traffic. The four `WithReference` calls
are purely for Aspire service-discovery injection, they make the gateway able to resolve
`http://identity`, `http://conference`, etc., at runtime through YARP's route configuration. The HTTPS
endpoint is pinned to port 6001 (Program.cs:250) because the MAUI native client has this URL baked into
its `appsettings.json` and cannot participate in Aspire's dynamic port allocation.

The gateway waits for all four backend services before Aspire marks it healthy. This means the UI, which
in turn waits for the gateway, only starts after the full backend is ready, a deliberate staging of the
startup sequence.

#### Why the gateway proxies JWKS discovery

Identity runs `Http2`-only on cleartext (h2c prior knowledge) so gRPC clients can negotiate HTTP/2
without TLS. The downside is that the default JwtBearer backchannel `HttpClient` sends HTTP/1.1, which
a Kestrel `Http2`-only endpoint rejects. The solution (Program.cs:259-261 and
Common.Aspire.Hosting/Extensions.cs:81-111) is `WithJwksDiscovery`, which sets
`Authentication__JwtBearer__Authority` to the **gateway's** HTTPS endpoint rather than Identity's:

```csharp
notificationService.WithJwksDiscovery(identityService, gateway);
engagementService.WithJwksDiscovery(identityService, gateway);
conferenceService.WithJwksDiscovery(identityService, gateway);
```

The gateway accepts both HTTP/1.1 and HTTP/2 via ALPN, and its `/.well-known/*` forwarder routes the
discovery fetch on to Identity over h2c internally. So the JwtBearer middleware's HTTP/1.1 metadata
fetch works end-to-end without any workaround on the services themselves.

[Rubric §11, Security] assesses how credentials and tokens flow through the system. No symmetric
JWT secret is shared between services; each non-Identity service fetches the RSA public key dynamically.
Routing that fetch through the gateway rather than hitting Identity directly keeps the internal topology
(cleartext h2c) invisible to callers.

### The Blazor UI

```csharp
var ui = builder.AddProject<Projects.MMCA_ADC_UI_Web>("ui", launchProfileName: "https")
    .WithExternalHttpEndpoints()
    .WithReference(gateway)
    .WithReference(notificationService)
    .WithReference(engagementService)
    .WithReference(conferenceService)
    .WithReference(identityService)
    .WaitFor(gateway)
    ...
    .WithEndpoint("https", endpoint => endpoint.Port = 6002);
identityService.WithEnvironment("OAuth__UIBaseUrl", ui.GetEndpoint("https"));
```

Program.cs:267-283. The UI waits for the gateway (and transitively the four services), ensuring it
does not open to traffic while the backend is still cold. Port 6002 is pinned for the same reason as
6001, E2E tests and out-of-Aspire clients need a stable address. The `identityService.WithEnvironment`
line (Program.cs:283) passes the UI's HTTPS endpoint back to Identity as `OAuth__UIBaseUrl` so the
post-login OAuth redirect lands on the correct host.

---

## Where service defaults come from, `MMCA.Common.Aspire`, not a local project

There is **no** `MMCA.ADC.ServiceDefaults` project. The conventional Aspire "ServiceDefaults" shared
project that scaffolding generates has been deleted; each service host (and the UI) instead calls
`AddServiceDefaults()` from the framework's `MMCA.Common.Aspire` package, and `MapDefaultEndpoints()` to
expose the health endpoints. This means the OpenTelemetry wiring, health checks, service discovery, and
Polly resilience are identical across both downstream apps (ADC and Store) and are versioned in lockstep
with the rest of the framework, there is no per-app copy to drift. The full behavior of those methods
is documented in the next section, since `MMCA.Common.Aspire` is now the single source of truth for the
service-side defaults.

---

## `MMCA.Common.Aspire`, the framework service-defaults package

> Source: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs`
> Telemetry: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs`
> Security: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs`
> Warmup: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/`

This package is the canonical, and now the only, service-defaults implementation. Each ADC service
host calls its methods directly; there is no ADC-local copy that shadows or extends it.

### `AddServiceDefaults<TBuilder>`

Common.Aspire/Extensions.cs:31-78. Called early in each service's `Program.cs`, it chains
`ConfigureOpenTelemetry()` (Extensions.cs:34), `AddDefaultHealthChecks()`, a `"self"` check tagged
`"live"` (Extensions.cs:35), `AddWarmupReadiness()` (Extensions.cs:36), and `Services.AddServiceDiscovery()`
(Extensions.cs:37). It then applies a Polly resilience pipeline to every `HttpClient`
(`ConfigureHttpClientDefaults`, Extensions.cs:41-75) with 30 s per-attempt / 60 s circuit-breaker
sampling / 90 s total-request timeouts (Extensions.cs:49-51), and a `SocketsHttpHandler` tuned explicitly
for Azure Container Apps Consumption plan (Common.Aspire/Extensions.cs:66-74):

- `PooledConnectionLifetime = 10 min`, forces connection recycling so DNS changes during ACA replica
  rollovers are picked up without an app restart.
- `PooledConnectionIdleTimeout = 5 min`, keeps idle connections in the pool long enough for low-traffic
  inter-service calls to reuse them.
- `KeepAlivePingDelay = 60 s`, socket-level keep-alive pings prevent idle TCP connections from being
  dropped by Azure's load balancer, without generating HTTP traffic that would shift the replica from
  idle-vCPU billing (~8x cheaper) to active billing.
- `EnableMultipleHttp2Connections = true`, avoids a single multiplexed connection becoming a bottleneck
  under concurrent requests.

`AddServiceDefaults` also calls `AddWarmupReadiness()` (Common.Aspire/Extensions.cs:36), so every
service host inherits the warm-up gate (detailed next) without opting in.

### Warmup infrastructure

`AddWarmupReadiness<TBuilder>` (Common.Aspire/Extensions.cs:91-103) registers:

- `WarmupReadinessGate` (singleton), a boolean gate that opens when all warm-up tasks finish.
- `WarmupHostedService`, runs all registered `IWarmupTask` implementations on startup, then opens the
  gate.
- `WarmupReadinessHealthCheck` tagged `"ready"`, reports unhealthy until the gate opens. Because it
  appears on `/health/ready` (the readiness probe) but not on `/alive`, ACA ingress holds back user
  traffic from a replica that is still warming up.
- `OpenIdConnectMetadataWarmupTask`, pre-fetches `{authority}/.well-known/openid-configuration`
  (Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:28-48). This warms the TCP/TLS connection
  to the JWKS endpoint before the first authenticated request arrives. The problem it solves is
  documented in the class comment: on a CPU-throttled idle ACA replica, a lazy metadata fetch on the
  first request can stretch past the client timeout, producing the "first request fails, second
  succeeds" pattern.

[Rubric §12, Performance] assesses whether the system is tuned for its hosting environment. The
`SocketsHttpHandler` tuning and the OIDC warmup task both target the same class of problem: ACA
Consumption plan cold-starts and idle-replica penalties. Solving them in the framework means every
consumer inherits the fix.

### `ConfigureOpenTelemetry<TBuilder>`

Common.Aspire/Extensions.cs:129-164. Configures OTel logging (`IncludeFormattedMessage` + `IncludeScopes`),
metrics (ASP.NET Core, HttpClient, .NET runtime), and tracing (the application's own source plus
`"MMCA.Common.Outbox"`, with ASP.NET Core and HttpClient instrumentation). Two MMCA.Common-specific
additions stand out:

1. **MMCA.Common meters** (Common.Aspire/Extensions.cs:146-147): `"MMCA.Common.Outbox"` (dead-letter
   counter) and `"MMCA.Common.Cqrs"` (RED histograms for command/query handlers). These are registered
   by literal name because the Aspire package has no project reference to the assemblies that define them.

2. **`OutboxPollFilterProcessor`** is added to the tracing pipeline
   (Common.Aspire/Extensions.cs:157-159) before the exporters, so its `OnEnd` runs first.

### `MapDefaultEndpoints`

Common.Aspire/Extensions.cs:230-251. Maps three endpoints:

- `/health`, all checks must pass; used by humans and dashboards.
- `/alive`, liveness probe: `"live"`-tagged checks only, so a transient dependency outage (e.g. SQL
  Server down) does not mark the process dead and get it killed.
- `/health/ready`, readiness: everything except `"live"`-only checks. This includes the warmup check
  (tagged `"ready"`) and any untagged dependency checks, so a replica still in cold-start or with a
  failing dependency is removed from ACA ingress without being killed.

### Dual telemetry export

`AddOpenTelemetryExporters` (Common.Aspire/Extensions.cs:266-284) activates two exporters, each
conditional:

- **OTLP** when `OTEL_EXPORTER_OTLP_ENDPOINT` is present, the Aspire dashboard sets this
  automatically; standalone deployments must supply it.
- **Azure Monitor** when `APPLICATIONINSIGHTS_CONNECTION_STRING` is present, injected by the Bicep
  deployment so logs, metrics, and traces flow to the workspace-based Application Insights resource.

Both can be active simultaneously; each exports an independent copy.

[Rubric §13, Observability] continues: dual export means local runs use the lightweight Aspire
dashboard (no Azure subscription required) while the same binary, with a different environment variable,
ships telemetry to Application Insights in production. The switch is purely environment-driven; no code
path changes.

### `OutboxPollFilterProcessor`

`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs`

This OpenTelemetry `BaseProcessor<Activity>` (OutboxPollFilterProcessor.cs:15) drops recurring outbox
poll spans from export. The `OutboxProcessor` background service polls every relational outbox table on a
recurring cycle (default: 300 s in production). Without filtering, those idle polls would dominate
Application Insights ingestion, both by span count and by spawning `SqlClient` dependency spans when the
Azure Monitor distro's auto-instrumentation is active.

The processor walks the in-process parent chain in `OnEnd` (OutboxPollFilterProcessor.cs:34-45),
matching spans whose source is `"MMCA.Common.Outbox"` and whose operation name is `"OutboxPoll"`. When a
match is found, it clears the `ActivityTraceFlags.Recorded` flag, which tells the batch export
processors to skip the span. It is registered before the exporters (Common.Aspire/Extensions.cs:157-159)
so its `OnEnd` runs before the batch processors check the flag.

Real outbox-work spans are unaffected: per-message `OutboxProcess` spans restore explicit parent
contexts from the stored trace IDs and are never descendants of the poll span
(OutboxPollFilterProcessor.cs:6-14 class comment).

The constant names `OutboxActivitySourceName = "MMCA.Common.Outbox"` and
`PollActivityName = "OutboxPoll"` (OutboxPollFilterProcessor.cs:19-20) are deliberately duplicated from
`MMCA.Common.Infrastructure`, the comment explains the Aspire package has no project reference there by
design, to keep the dependency graph clean.

[Rubric §31, Cost and FinOps] assesses whether observability costs are controlled. Suppressing poll
spans on a 300 s polling interval in production eliminates the majority of idle-process telemetry
ingestion. The framework makes this the default for every consumer; individual services do not need to
configure it.

### Security headers

`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs` provides
`SecurityHeadersMiddleware` and `SecurityHeadersExtensions`. The middleware sets `X-Content-Type-Options:
nosniff`, `X-Frame-Options` (default: `DENY`), `Referrer-Policy`, `Permissions-Policy`, HSTS outside
Development, and a Content-Security-Policy resolved from `ICspPolicyProvider`
(SecurityHeaders.cs:120-142). The default static policy is the conservative baseline
`default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
(SecurityHeaders.cs:46-47), safe for JSON/WebSocket/static endpoints; it deliberately omits `script-src`
/ `style-src` so it does not break a Blazor host that forgot to register a provider. HTML hosts register a
custom `ICspPolicyProvider` for a full resource policy. Consumers call `AddCommonSecurityHeaders()` and
`UseCommonSecurityHeaders()`.

---

## `MMCA.Common.Aspire.Hosting`, the AppHost extensions package

> Source: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs`

This package lives in a separate assembly from `MMCA.Common.Aspire` so running services do not pull in
the full `Aspire.Hosting` package (Common.Aspire.Hosting/Extensions.cs:6-15 class comment). It exports
four extension methods used in every AppHost that orchestrates extracted microservices
(`AddMessageBroker`, `WithBroker`, `WithJwksDiscovery`, and the `WithSQLServerDataSource` / `WithCosmosDataSource` / `WithSqliteDataSource` helpers covered earlier).

### `AddMessageBroker`

Common.Aspire.Hosting/Extensions.cs:32-38. Wraps `builder.AddRabbitMQ(name).WithManagementPlugin()`.
The management plugin is always enabled for local debug. Used in `Program.cs:60-61` as
`builder.AddMessageBroker()`.

### `WithBroker<TResource>`

Common.Aspire.Hosting/Extensions.cs:50-62. Chains `WithReference(broker).WaitFor(broker)
.WithEnvironment("MessageBus__Provider", "RabbitMq")` onto a project resource. This single call is the
complete wiring for broker-aware services: service discovery, health-based wait, and the environment
variable that `AddBrokerMessaging()` reads to select the MassTransit/RabbitMQ transport. When this
environment variable is absent (integration tests running via `WebApplicationFactory`),
`AddBrokerMessaging` short-circuits to in-process mode so existing tests continue to work without a
real broker.

### `WithJwksDiscovery<TResource>`

Common.Aspire.Hosting/Extensions.cs:81-111. Injects `Authentication__JwtBearer__Authority` pointing to
the gateway's HTTPS endpoint (when a gateway is passed) or Identity's HTTPS endpoint (fallback). The
routing-through-gateway rationale is explained in full in the method comment
(Common.Aspire.Hosting/Extensions.cs:95-106): Identity runs `Http2`-only, so the default HTTP/1.1
backchannel is rejected; the gateway terminates TLS, speaks ALPN, and routes `/.well-known/*` to
Identity over h2c. The method also calls `WithReference(identity).WaitFor(identity)` to add service
discovery for any direct identity calls the consuming service needs.

---

## The six Dockerfiles

All six Dockerfiles share the same multi-stage structure (`base` → `build` → `publish` → `final`) and
the same base images. None build the AppHost, it is a local-only orchestration artifact, never deployed.

### Common structure

**Stage `base`** (first `FROM` in all six): `mcr.microsoft.com/dotnet/aspnet:10.0` with `WORKDIR /app`
and `EXPOSE 8080 8081`. This is the runtime-only image; it has no SDK tools, minimizing the attack
surface of the final image.

**Stage `build`**: `mcr.microsoft.com/dotnet/sdk:10.0`. Accepts `GITHUB_TOKEN` as a build argument and
exports it as an environment variable (`ARG GITHUB_TOKEN` / `ENV GITHUB_TOKEN=${GITHUB_TOKEN}`) so
NuGet can restore `MMCA.Common.*` packages from GitHub Packages during the Docker build. All six require
`--build-arg GITHUB_TOKEN=...` at build time.

**Stage `publish`**: runs `dotnet publish ... -o /app/publish /p:UseAppHost=false` against the same
project, then copies the publish output to `final`.

**Stage `final`**: `COPY --from=publish /app/publish .` into the `base` layer. Sets
`ASPNETCORE_ENVIRONMENT=Production` and uses the `ENTRYPOINT` form of the `dotnet` invocation.

### Gateway Dockerfile

`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Dockerfile`

The build stage copies only the gateway's `.csproj` before restoring (Gateway.Dockerfile:20-23), then
copies the full `Source/` tree before building (Gateway.Dockerfile:28). The comment at lines 25-27
explains why the full tree is needed: `Directory.Build.props` links `GlobalUsings.IdentifierType.cs`
from each module's `Shared` project, so the source tree must be present even though the gateway itself
references no module projects. The gateway has minimal NuGet dependencies (`MMCA.Common.Aspire` and
YARP); the partial restore approach is feasible.

Entrypoint: `dotnet MMCA.ADC.Gateway.dll` (Gateway.Dockerfile:39).

### UI (Blazor Web) Dockerfile

`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile`

The build stage copies eight `.csproj` files individually before restoring
(UI.Web.Dockerfile:21-28), three `*.Shared` projects, three `*.UI` projects, and the two web host
projects (`MMCA.ADC.UI.Web` + `MMCA.ADC.UI.Web.Client`). This is a layer-caching optimization: a
dependency change in a source file does not invalidate the restore cache. After restoring, the full
`Source/` tree is copied and built (UI.Web.Dockerfile:34-35).

Entrypoint: `dotnet MMCA.ADC.UI.Web.dll` (UI.Web.Dockerfile:46).

### Four service Dockerfiles

`MMCA.ADC/Source/Services/MMCA.ADC.{Identity,Conference,Engagement,Notification}.Service/Dockerfile`

All four are identical in structure. The build stage copies the full `Source/` tree before restoring
(e.g., Identity.Dockerfile:19-22 comment: "services have deep project-reference chains through Migrations
→ all module Infrastructure assemblies, so copying the full Source/ tree is simplest"). Each service's
Dockerfile then restores, builds, and publishes its own `.Service.csproj` independently.

Entrypoints:
- `dotnet MMCA.ADC.Identity.Service.dll`
- `dotnet MMCA.ADC.Conference.Service.dll`
- `dotnet MMCA.ADC.Engagement.Service.dll`
- `dotnet MMCA.ADC.Notification.Service.dll`

[Rubric §17, DevOps and Deployment] continues: having one Dockerfile per deployable means each image
is independently versioned and deployed. CI can build only the images whose service changed, though the
current CI builds all six in sequence. The `UseAppHost=false` publish flag strips the native executable
wrapper; the Docker entrypoint invokes the DLL directly via the already-present runtime in the base
image.

---

## Local-to-cloud parity

The AppHost topology maps directly to the Azure infrastructure provisioned by `infra/main.bicep`. The
table below cross-references the local resource with its Azure equivalent:

| Local (AppHost) | Azure (Bicep) |
|---|---|
| SQL Server container (persistent) | Azure SQL Server; four databases (`ADC_Identity`, `ADC_Conference`, `ADC_Engagement`, `ADC_Notification`), each Basic tier |
| Redis container (persistent) | Azure Cache for Redis |
| RabbitMQ container (persistent, management plugin) | Azure Service Bus (Standard tier, Basic lacks topics needed by MassTransit) |
| MailDev container | Not provisioned (production uses a real SMTP relay) |
| `MessageBus__Provider=RabbitMq` (AppHost) | `MessageBus__Provider=AzureServiceBus` (Bicep env var on all four services) |
| Aspire dashboard (OTLP) | Application Insights workspace-based resource (`APPLICATIONINSIGHTS_CONNECTION_STRING`) |
| `WithSQLServerDataSource` injects two connection-string env vars | Bicep injects the same two env vars plus `SQLServerMigrationsAssembly` and `Outbox__DatabaseName` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (local) | `APPLICATIONINSIGHTS_CONNECTION_STRING` (Azure) |

The transport switch (`RabbitMq` → `AzureServiceBus`) is entirely environment-driven. No code path
changes between local and production, the same `AddBrokerMessaging(configuration)` call in each
service's `Program.cs` reads `MessageBus:Provider` and branches accordingly. This is ADR-003 (outbox +
in-process dispatch + background processor) combined with the infrastructure flexibility of
`MessageBusProvider` selection.

[Rubric §7, Microservices Architecture] is directly served by the fact that the extraction boundaries
(gRPC contracts, broker interfaces, JWKS discovery) are identical in both environments. An engineer can
validate a cross-service event flow locally against RabbitMQ before it reaches the Azure Service Bus in
production.

[Rubric §17, DevOps and Deployment] is served by the single-command local run matching the production
topology in process count, service-discovery mechanism, and transport semantics. The main gap, MailDev
vs. a real SMTP relay, is intentional and clearly scoped.

---

## The YARP Gateway's role

The gateway (`Source/Hosts/MMCA.ADC.Gateway`) is a pure YARP reverse proxy. It has no `DbContext`, no
`ModuleLoader`, no REST controllers, and no broker connection. Its `Program.cs` configures YARP routes
that map URL prefixes to backend services via Aspire service discovery:

- `/Auth`, `/.well-known/*` → Identity service
- `/Events`, `/Sessions`, `/Speakers`, `/Rooms`, `/Categories`, `/Questions`, `/EventQuestionAnswers` → Conference service
- `/Bookmarks` → Engagement service
- `/Notifications`, `/hubs/notifications` → Notification service

(The route-to-service mapping in `Gateway/Program.cs` is the source of truth for endpoint ownership.)

The gateway serves three architectural purposes:

1. **Single entry point.** The MAUI client and Blazor UI always talk to `https://localhost:6001`
   (local) or the equivalent Azure Container Apps ingress URL (production). Neither client is
   hardcoded to individual service addresses. This allows services to be scaled, moved, or split
   without client changes.

2. **TLS termination.** Backend services run HTTP/2 cleartext (h2c) for gRPC. The gateway terminates
   TLS and forwards to services over cleartext h2c, avoiding TLS overhead on the internal network.
   The JWKS discovery routing exploits this: JwtBearer's HTTP/1.1 backchannel hits the gateway over
   HTTPS, the gateway negotiates h2c to Identity, and the JWKS document is returned transparently.

3. **Extraction reversibility.** If a service needs to be re-merged into the monolith or split
   further, only the YARP route table changes. Clients and other services are unaffected. This is ADR-008
   (service extraction topology): "transport at the edge keeps extraction reversible."

[Rubric §7, Microservices Architecture] is directly served: clients talk to one address; services
talk to each other via gRPC or the broker; the gateway is the only component that knows the current
service topology on behalf of clients.

---

## Startup ordering summary

The health-based `WaitFor` chain imposes this ordering:

```
SQL Server container health
  └─ Database resources health (adc-identity, adc-conference, adc-engagement, adc-notification)
       ├─ Identity Service  (WaitFor: identityDb, redis, mailDev, rabbit)
       ├─ Conference Service (WaitFor: conferenceDb, redis, mailDev, rabbit)
       ├─ Engagement Service (WaitFor: engagementDb, redis, mailDev, rabbit, conferenceService)
       └─ Notification Service (WaitFor: notificationDb, redis, mailDev, rabbit, identityService)
            └─ Gateway (WaitFor: all four services)
                 └─ UI (WaitFor: gateway + all four services)
```

The only deliberate gap in the ordering is Conference↔Engagement's bidirectional gRPC dependency:
Engagement waits for Conference, but Conference does not wait for Engagement
(Program.cs:222-225). Both will retry via Polly until the peer is ready.

---

## Not determinable from source

- The exact YARP route table in `Source/Hosts/MMCA.ADC.Gateway/Program.cs` was cited from the CLAUDE.md
  description of which prefixes map to which service. The Gateway `Program.cs` was not read directly;
  those route prefixes are not determinable from the files read in this chapter. The AppHost declares only
  `WithReference` edges; the route-prefix table lives in the Gateway `Program.cs`.
- Whether every service host and the UI call `AddServiceDefaults()` from `MMCA.Common.Aspire` (vs. only
  some) was inferred from the architectural description in `MMCA.ADC/CLAUDE.md`; individual service
  `Program.cs` files were not read for this chapter.
- The specific integration events that flow over the broker (e.g., `UserRegistered`,
  `SpeakerLinkedToUser`) are cited from AppHost inline comments (Program.cs:46-51, 130-137), not from the
  handler implementations.
