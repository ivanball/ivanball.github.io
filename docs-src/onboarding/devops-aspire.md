# Aspire Orchestration and Containers

This chapter teaches how the MMCA.ADC system goes from a single `dotnet run` on your workstation to a
running stack of six .NET processes plus four containers: databases, a broker, a cache, a mail
interceptor, and a dashboard.
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

One operational caveat that no source file states: run that command in an **interactive terminal only**.
Launched from a background or non-interactive shell the AppHost stalls at control-plane init (no
dashboard, no `:6001`), so a headless "verification run" hangs rather than failing (`MMCA.ADC/CLAUDE.md`,
Build/Test/Run section).

[Rubric §33, Developer Experience] assesses how quickly a new engineer becomes productive. A
single-command local run that matches production topology (same services, same broker, same auth flow)
means the feedback loop is: edit → restart → observe real cross-service behavior, rather than mocking
everything and discovering integration bugs in CI.

---

## `MMCA.ADC.AppHost`, the orchestration project

> Source file: `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs`
> Extension helpers: `MMCA.Common.Aspire.Hosting/Extensions.cs` (`AddMessageBroker`, `WithBroker`,
>   `WithJwksDiscovery`, `WithE2eRsaKeys`, `WithSQLServerDataSource` / `WithCosmosDataSource` /
>   `WithSqliteDataSource`, there is no AppHost-local extensions file)
> Project file: `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/MMCA.ADC.AppHost.csproj`

### Project identity

The `.csproj` (AppHost.csproj:3) opts in to the `Aspire.AppHost.Sdk` (version 13.2.3), which activates
the Aspire resource model, code-generates strongly-typed `Projects.*` references from the project
references listed below it (AppHost.csproj:19-24), and arranges for the `.Build().RunAsync()` entry
point (Program.cs:334) to launch the dashboard and all declared resources. The SDK also picks up
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

One database per service is the direct implementation of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (database-per-service). No service
touches another service's database; no service races for another service's outbox rows.

**Redis** is also persistent (Program.cs:39-40), used by service hosts for distributed output-caching
and `ICacheService` (`DistributedCacheService`). All four service hosts receive a `WithReference(redis)`
and `WaitFor(redis)`.

**RabbitMQ** is provisioned via a framework helper (Program.cs:60-61):

```csharp
var rabbit = builder.AddMessageBroker()
    .WithLifetime(ContainerLifetime.Persistent);
```

`AddMessageBroker()` lives in `MMCA.Common.Aspire.Hosting` (Common.Aspire.Hosting/Extensions.cs:39-44)
and wraps `builder.AddRabbitMQ(name).WithManagementPlugin()` with the resource name defaulting to
`"rabbitmq"` (`DefaultBrokerResourceName`, Extensions.cs:27); the management plugin exposes the admin
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
`MMCA.Common.Aspire.Hosting`'s `Extensions` class (Common.Aspire.Hosting/Extensions.cs:166-178); the
AppHost-local `DataSourceExtensions.cs` that once held it has been deleted. (It was named `WithDataSource`
until [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html); the rename to `WithSQLServerDataSource` gives it a consistent `With*DataSource` shape with
the two polyglot siblings below, a breaking API change swept across consumers in one lockstep release,
[ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html).)

It is declared inside a C# preview `extension(...)` block rather than as a classic `this`-parameter
static method (Extensions.cs:147), which is why the receiver does not appear in the signature:

```csharp
extension(IResourceBuilder<ProjectResource> service)
{
    public IResourceBuilder<ProjectResource> WithSQLServerDataSource(
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
}
```

It injects the connection string twice. `DataSources__{logicalName}__SQLServerConnectionString` feeds
the MMCA.Common multi-database routing: entities whose logical source matches `logicalName` are routed
to this database. `ConnectionStrings__SQLServerConnectionString` satisfies the framework's `[Required]`
validation and the `AddSqlServer` health-check. Because both values are identical, the `DataSourceResolver`
singleton collapses the logical name onto the `Default` source, one `SQLServerDbContext` instance, one
EF change tracker, one migrations set per service. The `WaitFor(database)`
(Common.Aspire.Hosting/Extensions.cs:174) ensures the service process does not start until SQL Server
is healthy.

**Polyglot siblings ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)).** Two more helpers wire the non-SQL engines for the staged Conference
`Session`→Cosmos / `Room`→SQLite move:
- `WithCosmosDataSource(service, database, logicalName)` (Extensions.cs:198-211) takes an
  `AzureCosmosDBDatabaseResource` and injects three env vars,
  `DataSources__{logicalName}__CosmosConnectionString`, `DataSources__{logicalName}__CosmosDatabaseName`
  (Cosmos's `UseCosmos` takes the database name separately), and `ConnectionStrings__CosmosConnectionString`.
  It layers **on top of** `WithSQLServerDataSource` (a service uses Cosmos for one module alongside its
  SQL Server source).
- `WithSqliteDataSource(service, logicalName, filePath)` (Extensions.cs:228-240) takes a file path
  (SQLite has no Aspire container resource) and injects `DataSources__{logicalName}__SqliteConnectionString`
  (`Data Source=<path>`) + `ConnectionStrings__SqliteConnectionString`.

### The four service hosts and their wiring

Services are declared in this order: Notification, Engagement, Conference, Identity (Program.cs:90-195).
Declaration order matters because the gateway and UI references are added after all four are declared
(Program.cs:254-293). Each service follows the same pattern:

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
.WithEnvironment("MessageBus__Provider", "RabbitMq")` (Common.Aspire.Hosting/Extensions.cs:58-68),
meaning each service waits for RabbitMQ to be healthy before starting and has the environment variable
that makes `AddBrokerMessaging()` in its `Program.cs` select the RabbitMQ transport.

**Conference service** has one extra line (Program.cs:164):

```csharp
.WithEnvironment("Seeding__IncludeSampleConferenceData", "true")
```

This seeds sample speakers and sessions so the public browse grids are non-empty for the Playwright E2E
suite. The comment (Program.cs:161-163) explicitly restricts this to local dev and E2E CI; production
leaves this unset.

**Identity service** carries two extra lines. `Seeding__IncludeSampleUsers=true` (Program.cs:189) seeds
the well-known organizer/attendee accounts the Playwright suite logs in with; the comment
(Program.cs:186-188) restricts it to local dev and E2E CI so production creates no weak-credential
accounts. `WithE2eRsaKeys()` (Program.cs:195) is a framework extension, not AppHost-local code: when
`E2E_JWT_PRIVATE_KEY_PEM` and `E2E_JWT_PUBLIC_KEY_PEM` are present in the AppHost's own environment
(injected by the `e2e.yml` workflow for the ephemeral CI keypair) it maps them onto
`Jwt__RsaPrivateKeyPem`, `Jwt__RsaPublicKeyPem` and `Jwks__RsaPublicKeyPem` on the Identity resource
(Common.Aspire.Hosting/Extensions.cs:129-144). Without either variable the method returns the resource
untouched (Extensions.cs:135-138), so locally and in production user-secrets / Azure Key Vault are used
instead.

### gRPC cross-service references

Six directed edges express the gRPC topology (Program.cs:215-239):

```csharp
// Notification → Identity
notificationService.WithReference(identityService).WaitFor(identityService);
// Engagement → Conference
engagementService.WithReference(conferenceService).WaitFor(conferenceService);
// Conference → Engagement (reverse edge, deliberately no WaitFor)
conferenceService.WithReference(engagementService);
// Engagement → Notification (live-channel push, deliberately no WaitFor)
engagementService.WithReference(notificationService);
// Identity → Engagement and Identity → Notification (data-subject export aggregation, no WaitFor)
identityService.WithReference(engagementService);
identityService.WithReference(notificationService);
```

`WithReference` on a project resource injects `services__{name}__http__0` (and `https__0`) environment
variables into the consumer. The `AddTypedGrpcClient<T>(serviceName)` call in each service's
`Program.cs` uses `serviceName` to resolve `http://{name}` through Aspire's service discovery. The
Engagement→Notification edge targets a **named** endpoint rather than the default one: Notification
keeps `Http1AndHttp2` defaults so the SignalR WebSocket Upgrade works and declares a separate
`Http2`-only `grpc` endpoint on 8081 (`Notification.Service/appsettings.json:15-17`), so the reference
injects `services__notification__grpc__0` and the client resolves `http://_grpc.notification`
(Program.cs:221-227, `Notification.Contracts/DependencyInjection.cs:42`).

The deliberate asymmetry in the Conference↔Engagement pair is explained in the inline comment
(Program.cs:205-212): bidirectional `WaitFor` would produce a circular wait and deadlock. Instead,
transient "peer not ready" gRPC errors during startup self-heal via the standard Polly retry and
circuit-breaker pipeline baked into `AddTypedGrpcClient`. Engagement waits for Conference as a
best-effort ordering hint since Conference is the heavier producer (Program.cs:217). The three later
edges omit `WaitFor` for the same reason plus one of their own: Engagement's live-channel publish is
fire-and-forget-with-logging (Program.cs:221-227), and Engagement and Notification already wait on
Identity, so a reciprocal wait for the export aggregation would deadlock startup (Program.cs:229-237).
Aspire's hosting package has no gRPC-specific API here: these are stock `WithReference` calls, and
MMCA.Common.Aspire.Hosting deliberately adds none.

What consumes those injected variables lives in a third package, `MMCA.Common.Grpc`. On the server side
`AddGrpcServiceDefaults()` registers `AddGrpc` with the `GrpcResultExceptionInterceptor` (mapping
`Result` failures to `RpcException`), turns detailed errors off, and adds server reflection
(`MMCA.Common.Grpc/DependencyInjection.cs:26-38`); the four ADC services that serve gRPC call it
(e.g. Conference/Program.cs:320, Identity/Program.cs:278). On the client side
`AddTypedGrpcClient<TClient>(serviceName)` sets the address to `http://{serviceName}`, which is HTTP/2
cleartext with prior knowledge, adds the `JwtForwardingClientInterceptor` so an inbound bearer token
rides along to the peer, forces a `SocketsHttpHandler` (the global `ConfigureHttpClientDefaults`
wrapper can otherwise defeat HTTP/2 negotiation) and re-applies the same `HttpResilienceDefaults`
values used by the HTTP defaults (DependencyInjection.cs:66-112). The h2c choice is not a shortcut:
Aspire's endpoint discovery does not reliably produce a `services__{name}__https__0` key for project
resources, so the resolver falls back to `http` regardless of the requested scheme, and the target
must therefore serve HTTP/2 on its cleartext endpoint (DependencyInjection.cs:44-52).

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

Program.cs:254-264. The gateway has no `WithSQLServerDataSource`, no `WithReference(redis)`, and no
`WithBroker`. It is stateless: no database, no cache, no broker traffic. The four `WithReference` calls
are purely for Aspire service-discovery injection, they make the gateway able to resolve
`http://identity`, `http://conference`, etc., at runtime through YARP's route configuration. The HTTPS
endpoint is pinned to port 6001 (Program.cs:264) because the MAUI native client has this URL baked into
its `appsettings.json` and cannot participate in Aspire's dynamic port allocation.

The gateway waits for all four backend services before Aspire marks it healthy. This means the UI, which
in turn waits for the gateway, only starts after the full backend is ready, a deliberate staging of the
startup sequence.

#### Why the gateway proxies JWKS discovery

Identity runs `Http2`-only on cleartext (h2c prior knowledge) so gRPC clients can negotiate HTTP/2
without TLS. The downside is that the default JwtBearer backchannel `HttpClient` sends HTTP/1.1, which
a Kestrel `Http2`-only endpoint rejects. The solution (Program.cs:273-275 and
Common.Aspire.Hosting/Extensions.cs:85-113) is `WithJwksDiscovery`, which sets
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

Program.cs:281-293. The UI waits for the gateway (and transitively the four services), ensuring it
does not open to traffic while the backend is still cold. Port 6002 is pinned for the same reason as
6001, E2E tests and out-of-Aspire clients need a stable address. The `identityService.WithEnvironment`
line (Program.cs:332) passes the UI's HTTPS endpoint back to Identity as `OAuth__UIBaseUrl` so the
post-login OAuth redirect lands on the correct host.

Between the UI declaration and that last line sit three environment-gated E2E switches
(Program.cs:295-328), all absent in production. `E2E_FORCE_WASM` sets `E2E__ForceWebAssembly` on the UI
to run the suite without a Blazor Server circuit; it is a local fast-box option only, since on the
two-core hosted runner the per-context WASM boot never wins the race against the suite's waits, so
`e2e.yml` deliberately does not set it (Program.cs:296-301). `E2E_FORCE_SERVER` sets `E2E__ForceServer`
to pin the UI to InteractiveServer, and loses to `E2E_FORCE_WASM` when both are set
(Program.cs:313-322). `E2E_LIFT_REGISTRATION_THROTTLE` (implied by `E2E_FORCE_WASM`) raises
`LoginProtection__MaxRegistrationsPerIpPerHour` on Identity from the BR-213 default of 10 to 1000,
because the suite registers far more than ten accounts from one localhost IP (Program.cs:302-306,
324-328).

---

## Where service defaults come from, `MMCA.Common.Aspire`, not a local project

There is **no** `MMCA.ADC.ServiceDefaults` project. The conventional Aspire "ServiceDefaults" shared
project that scaffolding generates has been deleted; each service host (and the UI) instead calls
`AddServiceDefaults()` from the framework's `MMCA.Common.Aspire` package, and `MapDefaultEndpoints()` to
expose the health endpoints. All six ADC deployables do this, not just the services: Notification
(Program.cs:100 / 240), Engagement (89 / 248), Conference (113 / 334), Identity (109 / 288), the Gateway
(25 / 46) and the UI (30 / 109). This means the OpenTelemetry wiring, health checks, service discovery,
and Polly resilience are identical across both downstream apps (ADC and Store, neither of which has a
`ServiceDefaults` project any more) and are versioned in lockstep
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

Common.Aspire/Extensions.cs:39-90. Called early in each service's `Program.cs`, it chains
`ConfigureOpenTelemetry()` (Extensions.cs:41), `AddDefaultHealthChecks()`, which adds a `"self"` check
tagged `"live"` (Extensions.cs:42, 196-197), `AddWarmupReadiness()` (Extensions.cs:43), and
`Services.AddServiceDiscovery()` (Extensions.cs:44). It then applies a Polly resilience pipeline to every
`HttpClient` (`ConfigureHttpClientDefaults`, Extensions.cs:48-87) with 30 s per-attempt / 60 s
circuit-breaker sampling / 90 s total-request timeouts and **one** retry per hop (Extensions.cs:60-63),
and a `SocketsHttpHandler` tuned explicitly for Azure Container Apps Consumption plan
(Common.Aspire/Extensions.cs:78-86):

- `PooledConnectionLifetime = 10 min`, forces connection recycling so DNS changes during ACA replica
  rollovers are picked up without an app restart.
- `PooledConnectionIdleTimeout = 5 min`, keeps idle connections in the pool long enough for low-traffic
  inter-service calls to reuse them.
- `KeepAlivePingDelay = 60 s`, socket-level keep-alive pings prevent idle TCP connections from being
  dropped by Azure's load balancer, without generating HTTP traffic that would shift the replica from
  idle-vCPU billing (~8x cheaper) to active billing.
- `EnableMultipleHttp2Connections = true`, avoids a single multiplexed connection becoming a bottleneck
  under concurrent requests.

None of those numbers are literals here. They all come from `HttpResilienceDefaults` in
`MMCA.Common.Shared` (`Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:13-43`), which
exists so the Aspire HTTP defaults and the `MMCA.Common.Grpc` typed clients cannot drift apart: the
hand-mirrored copies previously did, leaving the gRPC side on the 10 s / 30 s library defaults
(HttpResilienceDefaults.cs:6-8). `MaxRetryAttempts` is deliberately 1, because the UI service base
classes own the user-facing retries and stacking a full budget at every hop turned a backend brownout
into an up-to-16x request storm (HttpResilienceDefaults.cs:21-28).

`AddServiceDefaults` also calls `AddWarmupReadiness()` (Common.Aspire/Extensions.cs:43), so every
service host inherits the warm-up gate (detailed next) without opting in.

### Warmup infrastructure

`AddWarmupReadiness<TBuilder>` (Common.Aspire/Extensions.cs:101-112) registers:

- `WarmupReadinessGate` (singleton), a boolean gate that opens when all warm-up tasks finish.
- `WarmupHostedService`, runs all registered `IWarmupTask` implementations on startup, then opens the
  gate.
- `WarmupReadinessHealthCheck` tagged `"ready"`, reports unhealthy until the gate opens. Because it
  appears on `/health/ready` (the readiness probe) but not on `/alive`, ACA ingress holds back user
  traffic from a replica that is still warming up.
- `OpenIdConnectMetadataWarmupTask`, pre-fetches `{authority}/.well-known/openid-configuration`, where
  `{authority}` is the `Authentication:JwtBearer:Authority` key `WithJwksDiscovery` sets; with that key
  unset the task returns immediately (Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:28-49).
  This warms the TCP/TLS connection
  to the JWKS endpoint before the first authenticated request arrives. The problem it solves is
  documented in the class comment: on a CPU-throttled idle ACA replica, a lazy metadata fetch on the
  first request can stretch past the client timeout, producing the "first request fails, second
  succeeds" pattern.

[Rubric §12, Performance] assesses whether the system is tuned for its hosting environment. The
`SocketsHttpHandler` tuning and the OIDC warmup task both target the same class of problem: ACA
Consumption plan cold-starts and idle-replica penalties. Solving them in the framework means every
consumer inherits the fix.

### `ConfigureOpenTelemetry<TBuilder>`

Common.Aspire/Extensions.cs:121-186. Configures OTel logging (`IncludeFormattedMessage` + `IncludeScopes`),
metrics (ASP.NET Core, HttpClient, .NET runtime), and tracing (the application's own source plus
`"MMCA.Common.Outbox"`, with ASP.NET Core and HttpClient instrumentation). Three MMCA.Common-specific
additions stand out:

1. **MMCA.Common meters** (Common.Aspire/Extensions.cs:157-158): `"MMCA.Common.Outbox"` (dead-letter
   counter) and `"MMCA.Common.Cqrs"` (RED histograms for command/query handlers). These are registered
   by literal name because the Aspire package has no project reference to the assemblies that define them.

2. **`OutboxPollFilterProcessor`** is added to the tracing pipeline
   (Common.Aspire/Extensions.cs:167-172) before the exporters, so its `OnEnd` runs first.

3. **Three cost knobs, all off by default** ([Rubric §31, Cost and FinOps]).
   `Telemetry:DisableHttpClientMetrics` drops the HttpClient connection/request metric family
   (Extensions.cs:141-144), `Telemetry:DisableRuntimeMetrics` drops the ~17 .NET runtime instruments
   (Extensions.cs:150-153), and `Telemetry:TracesSampleRatio` installs a `ParentBasedSampler` over a
   `TraceIdRatioBasedSampler` for head-based trace sampling (Extensions.cs:179-180). A value outside the
   open interval (0,1), or one that fails to parse, falls back to "sample everything" rather than
   silently blinding the host (Extensions.cs:361-374, 384-385). ADC's production Bicep sets
   `Telemetry__TracesSampleRatio` (`MMCA.ADC/infra/main.bicep:210`); an unset host behaves exactly as
   before the knobs existed.

### `MapDefaultEndpoints`

Common.Aspire/Extensions.cs:324-352. Maps three endpoints:

- `/health`, all checks must pass; used by humans and dashboards.
- `/alive`, liveness probe: `"live"`-tagged checks only, so a transient dependency outage (e.g. SQL
  Server down) does not mark the process dead and get it killed.
- `/health/ready`, readiness: everything except `"live"`-only **and `"optional"`** checks
  (Extensions.cs:346-349). This includes the warmup check (tagged `"ready"`) and any untagged dependency
  checks, so a replica still in cold-start or with a failing dependency is removed from ACA ingress
  without being killed. The `"optional"` exclusion is deliberate: a dependency the app degrades
  gracefully without (a distributed cache behind an in-memory fallback, a broker behind a retrying
  outbox) must not gate readiness, or a partial degradation takes every replica unready at once and
  becomes a total outage (Extensions.cs:339-345).

The checks that carry that `"optional"` tag come from `AddInfrastructureHealthChecks(bool requireSqlServer)`
(Common.Aspire/Extensions.cs:225-259), which a host calls separately from `AddServiceDefaults`. It
registers a SQL Server check when `SQLServerConnectionString` resolves, plus Redis and RabbitMQ checks
tagged `"optional"` when theirs do. The asymmetry is intentional: Redis and RabbitMQ are optional per
host, but a host that cannot resolve its own database connection string is misconfigured, so passing
`requireSqlServer: true` throws at startup instead of quietly registering no check and reporting healthy
(Extensions.cs:208-233).

### Dual telemetry export

`AddOpenTelemetryExporters` (Common.Aspire/Extensions.cs:274-291) activates two exporters, each
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
recurring cycle (2 s framework default, `OutboxSettings.cs:31`; deployed environments set 300 s).
Without filtering, those idle polls would dominate
Application Insights ingestion, both by span count and by spawning `SqlClient` dependency spans when the
Azure Monitor distro's auto-instrumentation is active.

The processor walks the in-process parent chain in `OnEnd` (OutboxPollFilterProcessor.cs:37-48),
matching spans whose source is `"MMCA.Common.Outbox"` and whose operation name is `"OutboxPoll"`. When a
match is found, it clears the `ActivityTraceFlags.Recorded` flag, which tells the batch export
processors to skip the span. It is registered before the exporters (Common.Aspire/Extensions.cs:167-172)
so its `OnEnd` runs before the batch processors check the flag. A null activity returns early rather
than throwing, because a telemetry callback must never throw (OutboxPollFilterProcessor.cs:29-33).

Real outbox-work spans are unaffected: per-message `OutboxProcess` spans restore explicit parent
contexts from the stored trace IDs and are never descendants of the poll span
(OutboxPollFilterProcessor.cs:6-14 class comment).

The constant names `OutboxActivitySourceName = "MMCA.Common.Outbox"` and
`PollActivityName = "OutboxPoll"` (OutboxPollFilterProcessor.cs:23-24) are deliberately duplicated from
`MMCA.Common.Infrastructure`, the comment explains the Aspire package's only `ProjectReference` is
`MMCA.Common.Shared` (for `HttpResilienceDefaults`), so `AddServiceDefaults` stays usable from a host
that does not take the persistence stack (OutboxPollFilterProcessor.cs:17-22).

[Rubric §31, Cost and FinOps] assesses whether observability costs are controlled. Suppressing poll
spans on a 300 s polling interval in production (`Outbox__PollingIntervalSeconds=300` on all four ADC
container apps, `MMCA.ADC/infra/main.bicep:1050,1215,1325,1460`) eliminates the majority of
idle-process telemetry ingestion. The framework makes this the default for every consumer; individual
services do not need to configure it.

### Security headers

`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs` provides
`SecurityHeadersMiddleware` and `SecurityHeadersExtensions`. The middleware sets `X-Content-Type-Options:
nosniff`, `X-Frame-Options` (default: `DENY`), `Referrer-Policy`, `Permissions-Policy`, HSTS outside
Development, and a Content-Security-Policy resolved from `ICspPolicyProvider`
(SecurityHeaders.cs:121-143). The default static policy is the conservative baseline
`default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
(SecurityHeaders.cs:47-48), safe for JSON/WebSocket/static endpoints; it deliberately omits `script-src`
/ `style-src` so it does not break a Blazor host that forgot to register a provider. HTML hosts register a
custom `ICspPolicyProvider` for a full resource policy. Consumers call `AddCommonSecurityHeaders()` and
`UseCommonSecurityHeaders()`.

The same package also ships `AddCommonGatewayCors`
(`MMCA.Common.Aspire/GatewayCorsExtensions.cs:24-57`), which the ADC Gateway calls right after the
security headers (Gateway/Program.cs:31, 36). It is deliberately looser than `MMCA.Common.API`'s
allow-list version, because a reverse proxy has to pass arbitrary client headers through: allow-any in
Development (GatewayCorsExtensions.cs:34-42), and in every other environment the origins from
`Cors:AllowedOrigins` with any header/method plus credentials (GatewayCorsExtensions.cs:44-53).

---

## `MMCA.Common.Aspire.Hosting`, the AppHost extensions package

> Source: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs`

This package lives in a separate assembly from `MMCA.Common.Aspire` so running services do not pull in
the full `Aspire.Hosting` package (Common.Aspire.Hosting/Extensions.cs:8-17 class comment). It exports
seven extension methods used in the AppHosts that orchestrate extracted microservices
(`AddMessageBroker`, `WithBroker`, `WithJwksDiscovery`, `WithE2eRsaKeys`, and the `WithSQLServerDataSource` / `WithCosmosDataSource` / `WithSqliteDataSource` helpers covered earlier).
It exposes no gRPC API at all: gRPC peers are wired with stock Aspire `WithReference`, as shown above.

### `AddMessageBroker`

Common.Aspire.Hosting/Extensions.cs:39-44. Wraps `builder.AddRabbitMQ(name).WithManagementPlugin()`.
The management plugin is always enabled for local debug. Used in `Program.cs:60-61` as
`builder.AddMessageBroker()`.

### `WithBroker<TResource>`

Common.Aspire.Hosting/Extensions.cs:58-68. Chains `WithReference(broker).WaitFor(broker)
.WithEnvironment("MessageBus__Provider", "RabbitMq")` onto a project resource. This single call is the
complete wiring for broker-aware services: service discovery, health-based wait, and the environment
variable that `AddBrokerMessaging()` reads to select the MassTransit/RabbitMQ transport. When this
environment variable is absent (integration tests running via `WebApplicationFactory`),
`AddBrokerMessaging` short-circuits to in-process mode so existing tests continue to work without a
real broker.

### `WithJwksDiscovery<TResource>`

Common.Aspire.Hosting/Extensions.cs:85-113. Injects `Authentication__JwtBearer__Authority` pointing to
the gateway's HTTPS endpoint (when a gateway is passed) or Identity's HTTPS endpoint (fallback). The
routing-through-gateway rationale is explained in full in the method comment
(Common.Aspire.Hosting/Extensions.cs:97-107): Identity runs `Http2`-only, so the default HTTP/1.1
backchannel is rejected; the gateway terminates TLS, speaks ALPN, and routes `/.well-known/*` to
Identity over h2c. The method also calls `WithReference(identity).WaitFor(identity)`
(Extensions.cs:92-94) to add service discovery for any direct identity calls the consuming service
needs. That `WaitFor` is easy to miss and it shapes the startup graph: all three non-Identity ADC
services wait on Identity because they call `WithJwksDiscovery`, not because of any explicit `WaitFor`
in the AppHost.

### `WithE2eRsaKeys`

Common.Aspire.Hosting/Extensions.cs:129-144. Reads `E2E_JWT_PRIVATE_KEY_PEM` /
`E2E_JWT_PUBLIC_KEY_PEM` from the AppHost's own process environment and, only when both are non-blank,
maps them onto `Jwt__RsaPrivateKeyPem`, `Jwt__RsaPublicKeyPem` and `Jwks__RsaPublicKeyPem` on the
Identity resource. Without the forwarding every CI login and register fails with "No supported key
formats were found" and the readiness gate times out (Extensions.cs:118-127). Both ADC
(AppHost/Program.cs:195) and Store (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:144`) call
it, which is why it lives in the framework rather than in either AppHost.

---

## The six Dockerfiles

All six Dockerfiles share the same multi-stage structure (`base` → `build` → `publish` → `final`) and
the same base images. None build the AppHost, it is a local-only orchestration artifact, never deployed.

### Common structure

**Stage `base`** (first `FROM` in all six): `mcr.microsoft.com/dotnet/aspnet:10.0` with `WORKDIR /app`
and `EXPOSE 8080 8081`. This is the runtime-only image; it has no SDK tools, minimizing the attack
surface of the final image.

**Stage `build`**: `mcr.microsoft.com/dotnet/sdk:10.0`, restoring the `MMCA.Common.*` packages from
GitHub Packages. The token is a **BuildKit secret**, never a build argument: each restore step is
`RUN --mount=type=secret,id=github_token` and reads `/run/secrets/github_token` into `GITHUB_TOKEN` for
that one command (Gateway.Dockerfile:24-26). The header comment says why: an `ARG` promoted
to `ENV` lands in image layers, the build cache, and `docker history` (Gateway.Dockerfile:8-10). The
build call is therefore `--secret id=github_token,env=GITHUB_TOKEN`, not `--build-arg`.

There is deliberately **no `dotnet build` step** in any of the six. The comment records the measurement
(CI run 30115729720, 2026-07-24): a build stage emitted `bin/Release/net10.0/` while the ReadyToRun
publish emits `bin/Release/net10.0/linux-x64/`, so publish never reused the build output and every
image compiled twice, about 75 s of waste per image. Publish does its own restore and build, and the
analyzer gating (`TreatWarningsAsErrors`, `AnalysisMode=All`) still runs inside it
(Gateway.Dockerfile:33-38).

**Stage `publish`**: runs `dotnet publish ... -o /app/publish /p:UseAppHost=false` against the same
project, with the same secret mount because publish performs its own restore pass. The four services
and the Gateway add `/p:PublishReadyToRun=true` so cold starts on fractional-vCPU containers skip
first-request JIT (Gateway.Dockerfile:42-47); the UI image does **not**, and its comment notes that
without R2R the publish reuses the same `obj/` path a build step would have produced
(UI.Web.Dockerfile:39-41, 48).

**Stage `final`**: `COPY --from=publish /app/publish .` into the `base` layer. Sets
`ASPNETCORE_ENVIRONMENT=Production` and uses the `ENTRYPOINT` form of the `dotnet` invocation.

### Gateway Dockerfile

`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Dockerfile`

The build stage copies only the gateway's `.csproj` before restoring (Gateway.Dockerfile:21-26), then
copies the full `Source/` tree before publishing (Gateway.Dockerfile:31). The comment at lines 28-30
explains why the full tree is needed: `Directory.Build.props` links `GlobalUsings.IdentifierType.cs`
from each module's `Shared` project, so the source tree must be present even though the gateway itself
references no module projects. The gateway has minimal NuGet dependencies (`MMCA.Common.Aspire` and
YARP); the partial restore approach is feasible.

Entrypoint: `dotnet MMCA.ADC.Gateway.dll` (Gateway.Dockerfile:53).

### UI (Blazor Web) Dockerfile

`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile`

The build stage copies eight `.csproj` files individually before restoring
(UI.Web.Dockerfile:22-29), three `*.Shared` projects, three `*.UI` projects, and the two web host
projects (`MMCA.ADC.UI.Web` + `MMCA.ADC.UI.Web.Client`). This is a layer-caching optimization: a
dependency change in a source file does not invalidate the restore cache. After restoring, the full
`Source/` tree is copied (UI.Web.Dockerfile:37) and the publish stage builds it.

Entrypoint: `dotnet MMCA.ADC.UI.Web.dll` (UI.Web.Dockerfile:54).

### Four service Dockerfiles

`MMCA.ADC/Source/Services/MMCA.ADC.{Identity,Conference,Engagement,Notification}.Service/Dockerfile`

All four are identical in structure, down to the line numbers. The build stage copies the full `Source/`
tree (Identity.Dockerfile:23) before restoring, and the comment above it says why
(Identity.Dockerfile:20-22): "services have deep project-reference chains through Migrations → all
module Infrastructure assemblies, so copying the full Source/ tree is simplest". Each service's
Dockerfile then restores (lines 26-28) and publishes its own `.Service.csproj` with ReadyToRun
(lines 42-44) independently; all four entrypoints sit on line 50.

Entrypoints:
- `dotnet MMCA.ADC.Identity.Service.dll`
- `dotnet MMCA.ADC.Conference.Service.dll`
- `dotnet MMCA.ADC.Engagement.Service.dll`
- `dotnet MMCA.ADC.Notification.Service.dll`

[Rubric §17, DevOps and Deployment] continues: having one Dockerfile per deployable means each image
is independently versioned and deployed. CI builds all six in one six-way parallel matrix rather than
per-changed-service, gated as a whole on the `changes` job classifying the diff as code
(`.github/workflows/deploy.yml:795-816`). The `UseAppHost=false` publish flag strips the native
executable wrapper; the Docker entrypoint invokes the DLL directly via the already-present runtime in
the base image.

---

## Local-to-cloud parity

The AppHost topology maps directly to the Azure infrastructure provisioned by `infra/main.bicep`. The
table below cross-references the local resource with its Azure equivalent:

| Local (AppHost) | Azure (Bicep) |
|---|---|
| SQL Server container (persistent) | Azure SQL Server; four databases (`ADC_Identity`, `ADC_Conference`, `ADC_Engagement`, `ADC_Notification`), each Basic 5 DTU / 2 GB (main.bicep:639-662), plus the retained `AtlDevCon` archive (main.bicep:614-628) |
| Redis container (persistent) | Azure Managed Redis (`Microsoft.Cache/redisEnterprise`, Balanced B0), injected as `ConnectionStrings__redis` from Key Vault (main.bicep:817-861) |
| RabbitMQ container (persistent, management plugin) | Azure Service Bus (Standard tier, Basic lacks the topics MassTransit needs, main.bicep:689-700) |
| MailDev container | Not provisioned; a real SMTP relay via `Smtp__Host` / `Smtp__Port` / `Smtp__From` (main.bicep:1087-1091) |
| `MessageBus__Provider=RabbitMq` (AppHost) | `MessageBus__Provider=AzureServiceBus` (Bicep env var on all four services, main.bicep:1079, 1230, 1346, 1474) |
| Aspire dashboard (OTLP) | Application Insights workspace-based resource (`APPLICATIONINSIGHTS_CONNECTION_STRING`) |
| `WithSQLServerDataSource` injects two connection-string env vars | Bicep injects the same two plus `ConnectionStrings__SQLServerMigrationsAssembly`, `DataSources__{Module}__SQLServerMigrationsAssembly` and `Outbox__DatabaseName` (main.bicep:1044-1046) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (local) | `APPLICATIONINSIGHTS_CONNECTION_STRING` (Azure) |
| Outbox poll interval: framework default 2 s | `Outbox__PollingIntervalSeconds=300` on every service (main.bicep:1050, 1215, 1325, 1460) |

The transport switch (`RabbitMq` → `AzureServiceBus`) is entirely environment-driven. No code path
changes between local and production, the same `AddBrokerMessaging(configuration)` call in each
service's `Program.cs` reads `MessageBus:Provider` and branches accordingly. This is [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) (outbox +
in-process dispatch + background processor) combined with the infrastructure flexibility of
`MessageBusProvider` selection.

Be honest about what that buys and what it does not. Environment-driven transport selection means no
`#if` and no second code path, but the AppHost still runs a **different broker** than production: local
RabbitMQ exercises the MassTransit RabbitMQ transport, not the Service Bus topic topology, its quotas,
or its admin-plane behavior. ADC covers that residual gap with a dedicated tier rather than pretending
it is closed: `Tests/Integration/MMCA.ADC.ServiceBusEmulator.IntegrationTests` smokes MassTransit
against the official Azure Service Bus emulator on the weekday nightly, `continue-on-error` and never
deploy-gating.

[Rubric §7, Microservices Architecture] is directly served by the fact that the extraction boundaries
(gRPC contracts, broker interfaces, JWKS discovery) are identical in both environments. An engineer can
validate a cross-service event flow locally against RabbitMQ before it reaches the Azure Service Bus in
production.

[Rubric §17, DevOps and Deployment] is served by the single-command local run matching the production
topology in process count, service-discovery mechanism, and transport semantics. The two remaining gaps,
MailDev vs. a real SMTP relay and RabbitMQ vs. Azure Service Bus, are intentional and each is scoped:
the first is never exercised in production paths, the second has the emulator tier above.

---

## The YARP Gateway's role

The gateway (`Source/Hosts/MMCA.ADC.Gateway`) is a pure YARP reverse proxy. It has no `DbContext`, no
`ModuleLoader`, no REST controllers, and no broker connection. Its `Program.cs` is the source of truth
for endpoint ownership: 26 `MapForwarder` calls map URL prefixes to backend services via Aspire service
discovery (Gateway/Program.cs:121-161), every destination an in-cluster service-discovery name over
cleartext, never a public URL:

- `/Auth`, `/Users`, `/UserClaims`, `/.well-known/*` → `http://identity` (Program.cs:121-127)
- `/Events`, `/Sessions`, `/Speakers`, `/Rooms`, `/ConferenceCategories`, `/CategoryItems`,
  `/SessionSpeakers`, `/EventSpeakers`, `/SessionCategoryItems`, `/SessionQuestionAnswers`,
  `/EventQuestionAnswers`, `/SpeakerCategoryItems`, `/SessionSelection`,
  `/Questions`, `/Sponsors` → `http://conference` (Program.cs:130-144)
- `/Bookmarks`, `/CheckIns`, `/LivePolls`, `/Points`, `/SessionQuestions` → `http://engagement` (Program.cs:147-151)
- `/Notifications`, `/hubs/*` → `http://notification` (Program.cs:160-161)

A `/SpeakerQuestionAnswers` forwarder used to sit in the Conference list, but no controller ever
existed behind it (the spec documents SpeakerQuestionAnswer's REST surface as deferred), so the dead
route was removed in the 2026-08-13 hardening pass.

The Identity, Conference and Engagement routes take a shared `http2Config` that sets
`Version = HttpVersion.Version20` with `VersionPolicy = RequestVersionExact` (Program.cs:92-102). Exact is
load-bearing: on cleartext there is no ALPN to negotiate, so `RequestVersionOrLower` silently downgrades
to HTTP/1.1 and the `Http2`-only backend rejects it. The two Notification routes deliberately use YARP's
default HTTP/1.1 config, because SignalR's WebSocket transport begins with an HTTP/1.1 Upgrade handshake
(Program.cs:108-110). `ForwardHttp2` stays configurable (default `true`, Program.cs:73) so a deployment
without HTTP/2 ingress can roll back without a code change.

The gateway serves three architectural purposes:

1. **Single entry point.** The MAUI client and Blazor UI always talk to `https://localhost:6001`
   (local) or the equivalent Azure Container Apps ingress URL (production). Neither client is
   hardcoded to individual service addresses. This allows services to be scaled, moved, or split
   without client changes.

2. **TLS termination.** The three REST backends (Identity, Conference, Engagement) run HTTP/2 cleartext
   (h2c) for gRPC; Notification keeps `Http1AndHttp2` defaults for the SignalR WebSocket Upgrade and
   serves gRPC on a separate `Http2`-only endpoint. The gateway terminates
   TLS and forwards to services over cleartext, avoiding TLS overhead on the internal network.
   The JWKS discovery routing exploits this: JwtBearer's HTTP/1.1 backchannel hits the gateway over
   HTTPS, the gateway negotiates h2c to Identity, and the JWKS document is returned transparently.

3. **Extraction reversibility.** If a service needs to be re-merged into the monolith or split
   further, only the YARP route table changes. Clients and other services are unaffected. This is [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)
   (service extraction topology): "transport at the edge keeps extraction reversible."

[Rubric §7, Microservices Architecture] is directly served: clients talk to one address; services
talk to each other via gRPC or the broker; the gateway is the only component that knows the current
service topology on behalf of clients.

---

## Startup ordering summary

The health-based `WaitFor` chain imposes this ordering. Note that three of the four services wait on
Identity without any explicit `WaitFor` in the AppHost: `WithJwksDiscovery` adds it
(Common.Aspire.Hosting/Extensions.cs:92-94).

```
SQL Server container health
  └─ Database resources health (adc-identity, adc-conference, adc-engagement, adc-notification)
       └─ Identity Service  (WaitFor: identityDb, redis, mailDev, rabbit)
            ├─ Conference Service (WaitFor: conferenceDb, redis, mailDev, rabbit, identity via JWKS)
            │    └─ Engagement Service (WaitFor: engagementDb, redis, mailDev, rabbit,
            │         conferenceService, identity via JWKS)
            └─ Notification Service (WaitFor: notificationDb, redis, mailDev, rabbit,
                 identityService twice over: explicit at Program.cs:215 and again via JWKS)
                 └─ Gateway (WaitFor: all four services)
                      └─ UI (WaitFor: gateway + all four services)
```

Four edges deliberately carry a `WithReference` with no `WaitFor`: Conference→Engagement (the reverse
half of the bidirectional gRPC pair, Program.cs:220), Engagement→Notification (fire-and-forget live
channel, Program.cs:228), and Identity→Engagement / Identity→Notification (the export aggregation,
Program.cs:238-239). Each would close a cycle against a wait that already exists in the other
direction. All four retry via Polly until the peer is ready.

---

## Not determinable from source

- The specific integration events that flow over the broker (e.g., `UserRegistered`,
  `SpeakerLinkedToUser`) are cited from AppHost inline comments (Program.cs:46-51, 130-136), not from the
  handler implementations. The comments name the publisher and consumer handler on each side; whether
  those handlers still match the comment is a question for the messaging chapter, not this one.
- The headless-AppHost stall is an operational fact recorded in `MMCA.ADC/CLAUDE.md` and the workspace
  `CLAUDE.md`, not something any source file asserts. There is no code path or config key to cite for it.
