# Aspire Orchestration and Containers

This chapter teaches how the MMCA.ADC system goes from a single `dotnet run` on your workstation to a
running stack of six .NET processes plus four containers: databases, a broker, a cache, a mail
interceptor, and a dashboard.
You will learn which resources the AppHost provisions and why, how service discovery and health-based
startup ordering wire everything together, which probe each resource carries and why the choice of
probe is load-bearing, what service defaults each service host gets from the framework's
`MMCA.Common.Aspire` package (there is no ADC-local `ServiceDefaults` project), how the two
`MMCA.Common.Aspire*` framework packages embed that machinery at the framework level, and how each
deployable is packaged into its Docker image. By the end you should be able to follow a `WithReference`
edge from first principles and explain local-to-cloud parity without looking at any other document.

Cross-references: [primer §1, the big picture](00-primer.md#1-the-big-picture),
[primer §2, architectural styles](00-primer.md#2-architectural-styles-this-codebase-commits-to),
and the per-type reference in [group 16, Aspire orchestration and service defaults](group-16-aspire-orchestration.md).

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

One environment variable changes the shape of that stack. Setting `ADC_BROKER=servicebus` before the
run swaps RabbitMQ for the official Azure Service Bus emulator container, so the whole stack speaks the
same transport production speaks (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:91-101`).
Unset is the default, and the rationale block above the switch is explicit about why
(Program.cs:66-88): the emulator costs a second container plus a warm-up, which is not a price the
everyday inner loop should pay, but a developer chasing a transport-specific bug (entity-name limits,
topic and subscription provisioning through the admin plane, scheduled redelivery pacing) previously
could not reproduce it locally at all.

One operational caveat that no source file states: run that command in an **interactive terminal only**.
Launched from a background or non-interactive shell the AppHost stalls at control-plane init (no
dashboard, no `:6001`), so a headless "verification run" hangs rather than failing (`MMCA.ADC/CLAUDE.md`,
Build/Test/Run section).

[Rubric §33, Developer Experience] assesses how quickly a new engineer becomes productive. A
single-command local run that matches production topology (same services, same broker option, same auth
flow) means the feedback loop is: edit, restart, observe real cross-service behavior, rather than
mocking everything and discovering integration bugs in CI. The `ADC_BROKER` opt-in is the same category
of decision applied to the one place where local and production genuinely diverge: parity is available
on demand rather than either always paid for or permanently missing.

---

## `MMCA.ADC.AppHost`, the orchestration project

> Source file: `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs`
> AppHost-local helper: `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/BrokerSelection.cs`
> Framework extension helpers: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs`
>   and `.../H2cHealthCheckExtensions.cs`
> Project file: `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/MMCA.ADC.AppHost.csproj`

### Project identity

The `.csproj` (AppHost.csproj:3) opts in to the `Aspire.AppHost.Sdk` (version 13.5.2), which activates
the Aspire resource model, code-generates strongly-typed `Projects.*` references from the six project
references listed below it (AppHost.csproj:22-27), and arranges for the `.Build().RunAsync()` entry
point (Program.cs:464) to launch the dashboard and all declared resources. Four hosting integrations
are referenced directly (`Aspire.Hosting.AppHost`, `.Redis`, `.SqlServer`, `.RabbitMQ`,
AppHost.csproj:15-18), and `MMCA.Common.Aspire` plus `MMCA.Common.Aspire.Hosting` come in as plain
`PackageReference`s marked `IsAspireProjectResource="false"` (AppHost.csproj:28-29) so the hosting
extensions those packages export are available without treating them as orchestrated processes.

One suppression is worth reading rather than skipping: `NoWarn` carries `ASPIRE010`
(AppHost.csproj:11), with the comment recording why (AppHost.csproj:9-10). The analyzer nudges toward
launching through the Aspire CLI bundle; this AppHost runs via `dotnet run`, and the suppression keeps
that a deliberate, documented choice rather than a warning everyone learns to ignore.

### Infrastructure containers

**SQL Server** is declared as a persistent container named `"sql"` (Program.cs:15-16). The
`ContainerLifetime.Persistent` option keeps the container alive across AppHost restarts, preserving
data and avoiding re-seeding during inner-loop development (Program.cs:12-14 comment). Four databases
are carved from it (Program.cs:37-40):

```
adc-identity     ->  ADC_Identity      (Identity service)
adc-conference   ->  ADC_Conference    (Conference service)
adc-engagement   ->  ADC_Engagement    (Engagement service)
adc-notification ->  ADC_Notification  (Notification service)
```

One database per service is the direct implementation of [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (database-per-service). No service
touches another service's database; no service races for another service's outbox rows
(Program.cs:18-27). The long comment above the declarations (Program.cs:29-36) is the honest part: the
legacy single `AtlDevCon` database is deliberately not provisioned here, and it is gone in Azure too.
It was exported to the bacpac blob `sql-archive/AtlDevCon-20260902.bacpac` and dropped on 2026-09-02,
so the template no longer declares it and the blob, restorable with `az sql db import`, is the rollback
source of record (`MMCA.ADC/infra/main.bicep:697-709`). These four databases are the entire application
data estate (main.bicep:713-723). Database-per-service is the topology everywhere, not a
local-development shortcut.

**Redis** is also persistent (Program.cs:44-45), used by service hosts for distributed output caching
and `ICacheService`. All four service hosts receive `WithReference(redis)` and `WaitFor(redis)`.

**The broker is chosen, not hardcoded.** The AppHost picks one of two broker resources up front and
captures the choice as a delegate (Program.cs:89-101):

```csharp
Func<IResourceBuilder<ProjectResource>, IResourceBuilder<ProjectResource>> withBroker;

if (string.Equals(Environment.GetEnvironmentVariable("ADC_BROKER"), "servicebus", StringComparison.OrdinalIgnoreCase))
{
    var serviceBus = builder.AddServiceBusEmulatorBroker(sqlServer);
    withBroker = service => service.WithBroker(serviceBus);
}
else
{
    var rabbit = builder.AddMessageBroker()
        .WithLifetime(ContainerLifetime.Persistent);
    withBroker = service => service.WithBroker(rabbit);
}
```

The delegate exists because the two `WithBroker` overloads in `MMCA.Common.Aspire.Hosting` take
different resource types (`RabbitMQServerResource` at Common.Aspire.Hosting/Extensions.cs:252 and
`ServiceBusEmulatorResource` at Extensions.cs:280), so the choice cannot be expressed as one variable
handed to one call. `WithSelectedBroker` (`BrokerSelection.cs:21-26`, the AppHost's one local
extension) applies it, and the class comment says exactly what that buys
(BrokerSelection.cs:7-12): every service's wiring chain reads as the same single line, which is what
stops a fifth service from quietly being wired to the wrong broker. See
[`BrokerSelection`](group-16-aspire-orchestration.md#brokerselection) for the per-type entry.

`AddMessageBroker()` wraps `builder.AddRabbitMQ(name).WithManagementPlugin()` with the resource name
defaulting to `"rabbitmq"` (`DefaultBrokerResourceName`, Common.Aspire.Hosting/Extensions.cs:28,
method at 160-165); the management plugin exposes the admin UI at `http://localhost:15672`.
`AddServiceBusEmulatorBroker(sqlServer)` (Extensions.cs:201-238) provisions the official emulator image
`mcr.microsoft.com/azure-messaging/servicebus-emulator:2.0.1` (Extensions.cs:94-107) and points it at
the **existing** SQL Server resource rather than starting a second engine, because the emulator stores
its state in SQL Server (Extensions.cs:176-181, `SQL_SERVER` and `MSSQL_SA_PASSWORD` at 228-233, and a
`WaitFor(sqlServer)` at 237 because the emulator's first act is to create its schema).

**MailDev** comes from a framework helper rather than an inline container declaration (Program.cs:109):

```csharp
var mailDev = builder.AddMailDev();
```

`AddMailDev` (Common.Aspire.Hosting/Extensions.cs:141-150) adds the `maildev/maildev` container with a
persistent lifetime and two **fixed** host ports: 1080 for the web UI and 1025 for SMTP
(`MailDevHttpPort` / `MailDevSmtpPort`, Extensions.cs:118 and 124). Fixed rather than Aspire's dynamic
ports for a stated reason (Extensions.cs:114-124): a developer opens the web UI by hand, and the SMTP
port is what each consumer's `Smtp:Port` setting names. Every service `WaitFor(mailDev)` but none
`WithReference` it, because the address is a literal in configuration rather than a discovered one.

[Rubric §17, DevOps and Deployment] assesses whether the local environment closely mirrors
production. Persistent container lifetime means you are not starting from an empty database on every
run; the same SQL, broker and Redis containers back both development and the Aspire-driven E2E CI run,
so there is no "works on my machine" topology gap between developer and pipeline.

### Health-gated startup, and which resource carries which probe

This is the part of the AppHost that is easiest to skim past and most expensive to get wrong. A
`WaitFor` edge on its own only proves that the target **process started**. Adding a health check to the
target turns every existing `WaitFor` into "the app is up and answering". Every service resource in this
AppHost carries one; only the probe differs, because of the Kestrel profile each target serves
(Program.cs:308-343 is the comment block that records all of this):

- **Notification** takes Aspire's stock `WithHttpHealthCheck("/alive")` (Program.cs:140). It runs the
  [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed `Http1AndHttp2` profile on its default endpoint (`Notification.Service/appsettings.json:9-19`)
  so the SignalR WebSocket Upgrade works, which means Aspire's default HTTP/1.1 `HttpClient` gets a real
  answer.
- **Identity, Conference and Engagement** take `WithH2cHealthCheck()` (Program.cs:242, 213, 166).
  Those three run Kestrel `Http2`-only on cleartext (h2c prior knowledge) so gRPC clients negotiate
  HTTP/2 without TLS. A stock HTTP/1.1 probe is answered with GOAWAY `HTTP_1_1_REQUIRED` rather than the
  health payload, so it would never turn healthy, and since the gateway and the UI `WaitFor` all four
  services an always-failing check would deadlock the whole stack at startup.

`WithH2cHealthCheck` lives in the framework
(`MMCA.Common.Aspire.Hosting/H2cHealthCheckExtensions.cs:110-138`). It issues the same GET over HTTP/2
with `RequestVersionExact`, registers the check under a key of the form `{resource}-h2c-{endpoint}`
(`CheckKey`, H2cHealthCheckExtensions.cs:75-76), and then calls `WithHealthCheck(key)`, because
association and registration are two separate halves and a `WaitFor` gates only when both are present
(H2cHealthCheckExtensions.cs:135-137). A second call for the same resource and endpoint is a no-op
rather than a duplicate registration, which the health-check service rejects at startup
(H2cHealthCheckExtensions.cs:121-124, ledger at 153-199). The probe budget is two seconds
(H2cHealthCheckExtensions.cs:66) because Aspire polls the check for as long as a dependent resource is
waiting, and a probe slower than the poll interval turns the wait into a queue.

The class comment also records a **rejected alternative** so it is not re-proposed
(H2cHealthCheckExtensions.cs:24-35). A deployed service already runs a dedicated HTTP/1.1 probe listener
driven by the `HealthProbe:Port` key, so injecting that key locally and pointing a stock probe at it
looks tempting. Doing so flips `ConfigureEndpointsWithHealthProbe` out of endpoint-defaults mode into
explicit-listener mode, whose `Listen` calls override the `ASPNETCORE_URLS` binding Aspire injects: the
service stops listening on its Aspire-allocated port and every co-hosted service collides on one fixed
port. The probe listener is a deployment-only construct.

The second half of the rule is which **path** the gate probes. Every service startup gate is `/alive`
(liveness), never `/health/ready`, and the reason is a cycle (Program.cs:324-331). Service readiness
includes the [ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html) warm-up gate, whose OIDC metadata task fetches the discovery document **through the
gateway**; the gateway in turn `WaitFor`s these services. A readiness gate there means each service
hammers the not-yet-started gateway with 30 second Polly timeouts until warm-up fails open at roughly
90 seconds. The default path in the framework helper is `/alive` for the same reason
(`DefaultProbePath`, H2cHealthCheckExtensions.cs:53, with the rationale at 44-52).

The gateway resource carries the same rule in its sharpest form (Program.cs:337-343): its readiness
aggregate includes the `downstream-{name}` probes, so gating the Aspire startup edge on that aggregate
means any single unreachable downstream stops `ui.WaitFor(gateway)` from ever releasing. That is the
2026-08-29 UI WaitFor wedge, and how Store's run 33237319737 died before it: the stack never became
ready and a whole E2E run reported zero tests executed. The gateway therefore gates on `/alive`
(Program.cs:354), and `/health/ready` stays the load-balancer signal in deployed environments where the
ACA probe owns it. Only the UI, which nothing `WaitFor`s, gates on `/health/ready`
(Program.cs:396).

[Rubric §29, Resilience and Business Continuity] assesses whether the system survives partial failure.
The liveness-versus-readiness split here is that rubric applied to startup: readiness is the correct
signal for a load balancer and the wrong one for a dependency graph, because readiness aggregates other
resources and a startup gate that aggregates its own waiters cannot converge.

### The `WithSQLServerDataSource` extension (and its Cosmos/SQLite siblings)

`WithSQLServerDataSource` is a framework extension method, not an AppHost-local helper. It lives in
`MMCA.Common.Aspire.Hosting`'s `Extensions` class (Common.Aspire.Hosting/Extensions.cs:483-494). (It was
named `WithDataSource` until [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html); the rename to `WithSQLServerDataSource` gives it a consistent
`With*DataSource` shape with the two polyglot siblings below, a breaking API change swept across
consumers in one lockstep release, [ADR-016](https://ivanball.github.io/docs/adr/016-lockstep-versioning-masstransit-pin.html).)

It is declared inside a C# preview `extension(...)` block rather than as a classic `this`-parameter
static method (Extensions.cs:410), which is why the receiver does not appear in the signature:

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
                             database.Resource.ConnectionStringExpression);
    }
}
```

It injects the connection string **once**, and that single entry is the whole configuration
(Extensions.cs:473-478). `DataSources__{logicalName}__SQLServerConnectionString` feeds the MMCA.Common
multi-database routing: entities whose logical source matches `logicalName` are routed to this database.
With no top-level connection string present, the one database a host declares this way also seeds its
`Default` source, so the framework's own tables, the `[Required]` validation and the readiness health
check all resolve from it, and the logical name collapses onto Default: one `SQLServerDbContext`
instance, one EF change tracker, one migrations set per service. The Azure side matches exactly: the
Bicep hands Identity only `DataSources__Identity__SQLServerConnectionString`
(`MMCA.ADC/infra/main.bicep:1138`) plus its migrations assembly (main.bicep:1139) and
`Outbox__DatabaseName` (main.bicep:1140), with no top-level `ConnectionStrings__SQLServerConnectionString`
anywhere. The `WaitFor(database)` (Extensions.cs:492) ensures the service process does not start until
SQL Server is healthy.

**Polyglot siblings ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)).** Two more helpers wire the non-SQL engines for the staged Conference
`Session` to Cosmos and `Room` to SQLite move:

- `WithCosmosDataSource(database, logicalName)` (Extensions.cs:512-524) takes an
  `AzureCosmosDBDatabaseResource` and injects two env vars,
  `DataSources__{logicalName}__CosmosConnectionString` and
  `DataSources__{logicalName}__CosmosDatabaseName` (Cosmos's `UseCosmos` takes the database name
  separately). It layers **on top of** `WithSQLServerDataSource` (a service uses Cosmos for one module
  alongside its SQL Server source, Extensions.cs:506-507).
- `WithSqliteDataSource(logicalName, filePath)` (Extensions.cs:537-548) takes a file path (SQLite has no
  Aspire container resource) and injects `DataSources__{logicalName}__SqliteConnectionString`
  (`Data Source=<path>`). It adds no reference and no wait, because there is no resource to wait on.

### The four service hosts and their wiring

Services are declared in this order: Notification (Program.cs:127-141), Engagement (156-167), Conference
(199-214), Identity (227-248). Declaration order matters because the gateway and UI references are added
after all four are declared (Program.cs:344 onward). Each service follows the same pattern:

```csharp
builder.AddProject<Projects.MMCA_ADC_{Module}_Service>("{name}", launchProfileName: "https")
    .WithSQLServerDataSource({moduleDb}, "{Module}")
    .WithReference(redis)
    .WithSelectedBroker(withBroker)
    .WaitFor(redis)
    .WaitFor(mailDev)
    .WithH2cHealthCheck()          // or WithHttpHealthCheck("/alive") on Notification
    .WithExternalHttpEndpoints();
```

`launchProfileName: "https"` selects the HTTPS launch profile from `launchSettings.json` so Aspire
registers both HTTP and HTTPS endpoints for service discovery (Program.cs:117-119 comment).
`WithSelectedBroker(withBroker)` resolves to one of the two `WithBroker` overloads. The RabbitMQ one
chains `.WithReference(broker).WaitFor(broker).WithEnvironment("MessageBus__Provider", "RabbitMq")`
(Common.Aspire.Hosting/Extensions.cs:258-261). The emulator one sets
`MessageBus__Provider=AzureServiceBus` plus two more variables:
`MessageBus__ConnectionString` (which ends in `UseDevelopmentEmulator=true`, the marker
`AddBrokerMessaging` keys its emulator branch off) and `MessageBus__EmulatorAdminEndpoint`, the
management-plane address MassTransit v8 needs for its second administration client
(Extensions.cs:286-291, connection-string shape at
`ServiceBusEmulatorResource.cs:66-68`, admin address at 80-82). Either way each service waits for the
broker to be healthy and gets the environment variable that makes `AddBrokerMessaging()` select the
transport. When that variable is absent (integration tests running via `WebApplicationFactory`),
`AddBrokerMessaging` short-circuits to in-process mode so existing tests continue to work without a real
broker (Program.cs:61-64).

**Conference service** has one extra line (Program.cs:210):

```csharp
.WithEnvironment("Seeding__IncludeSampleConferenceData", "true")
```

This seeds sample speakers and sessions so the public browse grids are non-empty for the Playwright E2E
suite. The comment (Program.cs:207-209) explicitly restricts this to local dev and E2E CI; production
leaves it unset, and the AppHost never runs in production at all.

**Identity service** carries two extras. `Seeding__IncludeSampleUsers=true` (Program.cs:238) seeds the
well-known organizer/attendee accounts the Playwright suite logs in with; the comment
(Program.cs:235-237) restricts it to local dev and E2E CI so production creates no weak-credential
accounts. `WithE2eRsaKeys()` (Program.cs:248) is a framework extension, not AppHost-local code: when
`E2E_JWT_PRIVATE_KEY_PEM` and `E2E_JWT_PUBLIC_KEY_PEM` are present in the AppHost's own environment
(injected by the `e2e.yml` workflow for the ephemeral CI keypair) it maps them onto
`Jwt__RsaPrivateKeyPem`, `Jwt__RsaPublicKeyPem` and `Jwks__RsaPublicKeyPem` on the Identity resource
(Common.Aspire.Hosting/Extensions.cs:353-368). Without either variable the method returns the resource
untouched (Extensions.cs:359-362), so locally and in production user-secrets and Azure Key Vault are
used instead.

### gRPC cross-service references

Six directed edges express the gRPC topology (Program.cs:268-292):

```csharp
// Notification -> Identity
notificationService.WithReference(identityService).WaitFor(identityService);
// Engagement -> Conference
engagementService.WithReference(conferenceService).WaitFor(conferenceService);
// Conference -> Engagement (reverse edge, deliberately no WaitFor)
conferenceService.WithReference(engagementService);
// Engagement -> Notification (live-channel push, deliberately no WaitFor)
engagementService.WithReference(notificationService);
// Identity -> Engagement and Identity -> Notification (data-subject export aggregation, no WaitFor)
identityService.WithReference(engagementService);
identityService.WithReference(notificationService);
```

`WithReference` on a project resource injects `services__{name}__http__0` (and `https__0`) environment
variables into the consumer. The `AddTypedGrpcClient<T>(serviceName)` call in each service's
`Program.cs` uses `serviceName` to resolve `http://{name}` through Aspire's service discovery. The
Engagement-to-Notification edge targets a **named** endpoint rather than the default one: Notification
keeps `Http1AndHttp2` on its default endpoint so the SignalR WebSocket Upgrade works and declares a
separate `Http2`-only `grpc` endpoint on 8081 (`Notification.Service/appsettings.json:15-18`), so the
reference injects `services__notification__grpc__0` and the client resolves `http://_grpc.notification`
(Program.cs:274-281, `Notification.Contracts/DependencyInjection.cs:42`).

The deliberate asymmetry in the Conference/Engagement pair is explained in the inline comment
(Program.cs:258-265): bidirectional `WaitFor` would produce a circular wait and deadlock. Instead,
transient "peer not ready" gRPC errors during startup self-heal via the Polly retry and circuit-breaker
pipeline baked into `AddTypedGrpcClient`. Engagement waits for Conference as a best-effort ordering hint
since Conference is the heavier producer (Program.cs:264-265). The three later edges omit `WaitFor` for
the same reason plus one of their own: Engagement's live-channel publish is fire-and-forget-with-logging
(Program.cs:274-280), and Engagement and Notification already depend on Identity, so a reciprocal wait
for the export aggregation would deadlock startup (Program.cs:282-292). Aspire's hosting package has no
gRPC-specific API here: these are stock `WithReference` calls, and MMCA.Common.Aspire.Hosting
deliberately adds none.

What consumes those injected variables lives in a third package, `MMCA.Common.Grpc`. On the server side
`AddGrpcServiceDefaults()` registers `AddGrpc` with the `GrpcResultExceptionInterceptor` (mapping
`Result` failures to `RpcException`), turns detailed errors off, and adds server reflection
(`MMCA.Common.Grpc/DependencyInjection.cs:26-38`); all four ADC services call it (Notification
Program.cs:228, Identity 304, Engagement 297, Conference 362). On the client side
`AddTypedGrpcClient<TClient>(serviceName)` (DependencyInjection.cs:66-117) sets the address to
`http://{serviceName}`, which is HTTP/2 cleartext with prior knowledge, adds the
`JwtForwardingClientInterceptor` so an inbound bearer token rides along to the peer, forces a
`SocketsHttpHandler` (the global `ConfigureHttpClientDefaults` wrapper can otherwise defeat HTTP/2
negotiation, DependencyInjection.cs:80-97) and applies a resilience pipeline from
`GrpcResilienceDefaults` (DependencyInjection.cs:106-115). That type is the interesting one: its
timeouts and retry budget are **re-exposed** from `HttpResilienceDefaults` so the east-west path cannot
drift from the outbound-HTTP path (`Core/MMCA.Common.Shared/Resilience/GrpcResilienceDefaults.cs:15-24`),
while its circuit-breaker shape is stated explicitly (failure ratio 0.5 at line 27, minimum throughput
10 at line 30, break duration 10 seconds at line 33) because an east-west gRPC call addresses a peer
directly and bypasses the gateway's active health checks, so the breaker is the only thing that notices
a peer going bad. The h2c choice is not a shortcut: Aspire's endpoint discovery does not reliably
produce a `services__{name}__https__0` key for project resources, so the resolver falls back to `http`
regardless of the requested scheme, and the target must therefore serve HTTP/2 on its cleartext endpoint
(DependencyInjection.cs:44-52).

[Rubric §7, Microservices Architecture] assesses how cleanly services are decoupled and how
inter-service calls are managed. Declaring `WithReference` only for actual call edges (not broadcasting
every service to every other service) keeps the service-discovery injection minimal and makes the
topology readable as code.

[Rubric §29, Resilience and Business Continuity] assesses whether the system can survive partial
failures. The no-WaitFor choice on the reverse edges, combined with a resilience pipeline on the typed
gRPC clients, means a slow-starting peer never blocks the whole stack from reaching a healthy state.

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
    .WithHttpHealthCheck("/alive")
    .WithEndpoint("https", endpoint => endpoint.Port = 6001);
```

Program.cs:344-355. The gateway has no `WithSQLServerDataSource`, no `WithReference(redis)`, and no
broker attachment. It is stateless: no database, no cache, no broker traffic (Program.cs:304-306). The
four `WithReference` calls are purely for Aspire service-discovery injection, they make the gateway able
to resolve `http://identity`, `http://conference`, and so on at runtime through YARP's configured route
table. The HTTPS endpoint is pinned to port 6001 (Program.cs:355) because the MAUI native client has
this URL baked into its `appsettings.json` and cannot participate in Aspire's dynamic port allocation
(Program.cs:300-302).

The gateway waits for all four backend services before Aspire marks it healthy. This means the UI, which
in turn waits for the gateway, only starts after the full backend is ready, a deliberate staging of the
startup sequence.

#### Why the gateway proxies JWKS discovery, and stamps the issuer

Identity runs `Http2`-only on cleartext (h2c prior knowledge) so gRPC clients can negotiate HTTP/2
without TLS. The downside is that the default JwtBearer backchannel `HttpClient` sends HTTP/1.1, which
a Kestrel `Http2`-only endpoint rejects. The solution (Program.cs:357-366 and
Common.Aspire.Hosting/Extensions.cs:309-337) is `WithJwksDiscovery`, which sets
`Authentication__JwtBearer__Authority` to the **gateway's** HTTPS endpoint rather than Identity's:

```csharp
notificationService.WithJwksDiscovery(identityService, gateway);
engagementService.WithJwksDiscovery(identityService, gateway);
conferenceService.WithJwksDiscovery(identityService, gateway);
```

The gateway accepts both HTTP/1.1 and HTTP/2 via ALPN, and its `/.well-known/*` route forwards the
discovery fetch on to Identity over h2c internally. So the JwtBearer middleware's HTTP/1.1 metadata
fetch works end-to-end without any workaround on the services themselves.

The other half of that contract is one line further down (Program.cs:375):

```csharp
identityService.WithEnvironment("Jwt__Issuer", gateway.GetEndpoint("https"));
```

The issuer Identity stamps into every token it signs has to be the same URL its peers just discovered,
or every cross-service call fails validation on the issuer claim. The `appsettings` default hardcodes
the pinned dev port for a standalone F5 run, so deriving the value from the gateway resource means an
Aspire run cannot mint wrong-issuer tokens if that port ever moves (Program.cs:368-374). Production sets
the equivalent from the gateway's ACA FQDN (`MMCA.ADC/infra/main.bicep:1157`).

[Rubric §11, Security] assesses how credentials and tokens flow through the system. No symmetric
JWT secret is shared between services; each non-Identity service fetches the RSA public key dynamically.
Routing that fetch through the gateway rather than hitting Identity directly keeps the internal topology
(cleartext h2c) invisible to callers, and deriving the issuer from the same resource keeps discovery and
issuance from drifting apart.

### The Blazor UI

```csharp
var ui = builder.AddProject<Projects.MMCA_ADC_UI_Web>("ui", launchProfileName: "https")
    .WithExternalHttpEndpoints()
    .WithReference(gateway)
    .WithReference(notificationService)
    ...
    .WaitFor(gateway)
    ...
    .WithHttpHealthCheck("/health/ready")
    .WithEndpoint("https", endpoint => endpoint.Port = 6002);
```

Program.cs:381-397. The UI waits for the gateway and the four services, ensuring it does not open to
traffic while the backend is still cold. It is the one resource gated on `/health/ready` rather than
`/alive`, and it can be: nothing `WaitFor`s the UI, so there is no cycle to close, and the UI head runs
the default `Http1AndHttp2` profile so the stock probe answers (Program.cs:393-395). Port 6002 is pinned
for the same reason as 6001: E2E tests and out-of-Aspire clients need a stable address
(Program.cs:378-380).

Three environment-derived values are then pushed back onto other resources, all of them things only the
AppHost knows:

- `Api__ApiEndpoint` and `Api__WasmApiEndpoint` on the UI (Program.cs:450-451). These are both halves of
  the split `infra/main.bicep:1879` and `1881` make in production, derived from the gateway resource
  instead of hardcoded. The WASM one is what `/client-config` hands the **browser** (and what the Blazor
  CSP pins `connect-src` to), so it must be an externally reachable URL: a browser cannot resolve an
  Aspire service-discovery name. The server-side one is overridden here because exactly one consumer is
  not an `IHttpClientFactory` client: `NotificationHubService` builds a SignalR `HubConnection`, which
  creates its own message handler and never sees the service-discovery handler (Program.cs:437-449).
- `OAuth__UIBaseUrl` on Identity (Program.cs:455), so the post-login OAuth redirect lands on the UI host
  rather than staying on the API server.
- `PasswordReset__ResetUrl` on Identity (Program.cs:460-462), built as
  `ReferenceExpression.Create($"{ui.GetEndpoint("https")}/reset-password")`. The UI port is dynamic under
  Aspire, so the appsettings default (which serves a standalone F5 run) would point the emailed link at
  a host that is not listening (Program.cs:457-459).

Between the UI declaration and those lines sit the E2E switches (Program.cs:399-435), all absent in
production. `E2E_FORCE_WASM` sets `E2E__ForceWebAssembly` on the UI to run the suite without a Blazor
Server circuit; it is a local fast-box option only, since on the two-core hosted runner the per-context
WASM boot never wins the race against the suite's waits, so `e2e.yml` deliberately does not set it
(Program.cs:400-405, 411-415). `E2E_FORCE_SERVER` sets `E2E__ForceServer` to pin the UI to
InteractiveServer, and loses to `E2E_FORCE_WASM` when both are set (Program.cs:417-426).

The other two switches are not `if` blocks in the AppHost at all, they are single calls:

```csharp
identityService.WithE2eRegistrationThrottleLift(alsoLiftWhen: forceWasm);   // Program.cs:428
gateway.WithE2eGatewayRateLimitLift(alsoLiftWhen: forceWasm);               // Program.cs:435
```

For both, the trigger (`E2E_LIFT_REGISTRATION_THROTTLE`), the target setting names and the lifted values
live inside the framework extension, so the AppHost passes only its own extra condition: forcing WASM
implies the same request volume, hence `alsoLiftWhen: forceWasm`. The registration literal is the
framework constant `E2eRegistrationsPerIpPerHour = 1000` (Common.Aspire.Hosting/Extensions.cs:35),
lifted from the production default of 10
(`MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:37`), because the suite registers far more
than ten accounts from one localhost IP. The gateway lift is covered in the package section below.

---

## Where service defaults come from, `MMCA.Common.Aspire`, not a local project

There is **no** `MMCA.ADC.ServiceDefaults` project. `Source/Hosting/` contains the AppHost and the four
per-service migrations assemblies, nothing else. The conventional Aspire "ServiceDefaults" shared project
that scaffolding generates has been deleted; each service host (and the UI, and the Gateway) instead
calls `AddServiceDefaults()` from the framework's `MMCA.Common.Aspire` package, and `MapDefaultEndpoints()`
to expose the health endpoints. All six ADC deployables do this: Notification (Program.cs:86 / 243),
Engagement (83 / 311), Conference (101 / 376), Identity (97 / 314), the Gateway (57 / 136) and the UI
(30 / 119). This means the OpenTelemetry wiring, health checks, service discovery, and Polly resilience
are identical across both downstream apps (ADC and Store, neither of which has a `ServiceDefaults`
project any more) and are versioned in lockstep with the rest of the framework, there is no per-app copy
to drift. The full behavior of those methods is documented in the next section.

### Framework host extensions that are opt-in per host

Not every framework host extension is bundled into the defaults. Several are opt-in per host, called
from each host's own `Program.cs`, and most are **gated on a configuration key that is absent locally**,
so they no-op on a developer machine and in the test tiers while doing real work in Azure. That gating
is what keeps local-to-cloud parity honest: the same call sites run in both places, and only the
configuration differs.

- **`AddCommonSerilog(path)`** (`MMCA.Common.Aspire/Logging/SerilogHostExtensions.cs:48-56`) is called
  **before** `AddServiceDefaults` in every ADC service (for example Notification Program.cs:85-86). The
  provider registration is the load-bearing part, and the comment says why
  (SerilogHostExtensions.cs:16-19, echoed at Notification Program.cs:79-84): `UseSerilog()` replaces the
  whole `ILoggerFactory` and so silently bypasses every other provider, including the OpenTelemetry to
  Azure Monitor one `AddServiceDefaults` wires. That bypass is why no application log line from these
  hosts ever reached Application Insights, while the Gateway (which never called `UseSerilog`) did show
  up. `builder.Logging.AddSerilog(Log.Logger, dispose: true)` (line 55) adds Serilog as one provider
  alongside the others. Production then caps what ships to Azure Monitor with
  `Logging__OpenTelemetry__LogLevel__Default=Warning` (`MMCA.ADC/infra/main.bicep:238-241`); Serilog
  keeps writing Information to stdout, so container logs stay complete while only warnings and above
  bill against the workspace.
- **`ConfigureEndpointsWithHealthProbe(protocols, redeclareCleartextEndpoint, cleartextPort)`**
  (`MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:77-101`) applies `protocols` to every
  Kestrel endpoint default and, when `HealthProbe:Port` is set (`HealthProbePortConfigKey`,
  KestrelEndpointExtensions.cs:31), adds a dedicated Http1-only listener for the platform probes. Both
  deployed profiles are this one call with different arguments, and the second parameter is the reason
  there are two (KestrelEndpointExtensions.cs:45-59). The three h2c REST services pass
  `HttpProtocols.Http2` and keep `redeclareCleartextEndpoint` at its default of `true` (for example
  `MMCA.ADC.Conference.Service/Program.cs:85`), because an explicit `Listen` call overrides the
  container's `ASPNETCORE_HTTP_PORTS` default binding and the main h2c endpoint has to be re-declared
  alongside the probe port or it disappears. Notification passes
  `HttpProtocols.Http1AndHttp2, redeclareCleartextEndpoint: false`
  (`MMCA.ADC.Notification.Service/Program.cs:70`) because its two endpoints come from configuration
  already; there the probe listener is strictly additive and nothing re-binds a port the configuration
  owns. A non-integer probe port throws at startup rather than silently producing no listener, since
  the platform would then probe a closed port and the revision would never come up
  (KestrelEndpointExtensions.cs:72-76). In Azure the key is `8081` on Identity, Conference and
  Engagement (main.bicep:1134, 1341, 1464) and `8082` on Notification (main.bicep:1610), because the
  [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) mixed profile already owns 8080 for ingress and 8081 for gRPC there (main.bicep:1605-1609).
  Locally the key is absent on every host, which is exactly why the AppHost has to use the h2c probe
  instead.
- **`AddCommonKeyVaultConfiguration()`**
  (`MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:78-111`) layers an Azure Key
  Vault over the host configuration, so a secret in the vault reads back through `IConfiguration` like
  any other setting and overrides the sources added before it. The gate is `KeyVault:Uri`: absent or
  whitespace and the method returns the builder untouched (KeyVaultConfigurationExtensions.cs:80-87),
  which is why local dev, CI and the integration tier take no Azure dependency at startup. Two details
  worth knowing. It is called **early**, before anything binds settings, because `ConfigurationManager`
  builds and loads each source as it is added (`MMCA.ADC.Conference.Service/Program.cs:110`, with the
  comment at 105-109 saying exactly that); and a secret name cannot contain a colon, so the provider maps
  `--` onto the configuration separator, meaning `Jwt--SigningKey` arrives as `Jwt:SigningKey`
  (KeyVaultConfigurationExtensions.cs:44-45). Authentication is `DefaultAzureCredential` (line 109), so a
  deployed host uses its managed identity. All four ADC services call it, as does the UI
  (`MMCA.ADC.UI.Web/Program.cs:38`).
- **`AddCommonDataProtection()`** (`MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:52-87`)
  persists the ASP.NET Core DataProtection key ring to a single Azure blob so every replica of a
  scaled-out host shares one key ring. The default key ring is per-process and in memory, which is
  correct for one process and wrong for two: a cookie or antiforgery token minted by replica A cannot be
  decrypted by replica B, and the user sees sign-outs that follow the load balancer rather than any
  pattern. The gate is `DataProtection:BlobStorageUri` (DataProtectionExtensions.cs:54-61). A second,
  deliberately **separate** gate, `DataProtection:KeyVaultKeyUri`, encrypts that key ring at rest
  (DataProtectionExtensions.cs:81-85): the two are not folded together because blob persistence is what
  fixes cross-replica decryption and has to work on its own, since the Key Vault Crypto User role is
  granted out of band and can lag a deployment, so coupling them would turn a missing role assignment
  into a total auth outage. The two ADC hosts that do cookie cryptography call it: Identity
  (`MMCA.ADC.Identity.Service/Program.cs:112`) and the UI (`MMCA.ADC.UI.Web/Program.cs:40`).
- **`AddRedisCaching()` / `AddRedisOutputCaching()`**
  (`MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:57-66` and `91` onward) register the Aspire
  distributed cache plus the `IConnectionMultiplexer` that `DistributedCacheService` needs for SCAN-based
  prefix eviction, and back the output cache with the same Redis. Both no-op when the connection string
  is absent (RedisCachingExtensions.cs:59-62), where the in-memory fallback is the documented behavior.
  The load-bearing argument is `DisableHealthChecks = true` on both registrations
  (RedisCachingExtensions.cs:64-65): the raw Aspire integration registers an **untagged**
  StackExchange.Redis check, which `/health/ready` therefore includes, and against Azure Managed Redis it
  issues `CLUSTER INFO`, a command StackExchange.Redis 3.x refuses outside admin mode. Every probe threw
  against a healthy cache and every revision failed activation. Common contributes its own PING-only
  check instead (see `AddInfrastructureHealthChecks` below). Conference Program.cs:122-141 records the
  whole incident inline. Conference gates one more cache on the same key: `AddCommonHybridCache()` runs
  only when a `redis` connection string is present (Conference.Service/Program.cs:149-152), because
  without Redis the second level is the in-memory distributed cache and an L1 in front of it buys
  nothing.
- **`AddScheduledJobs(builder.Configuration)`** (`MMCA.Common.Infrastructure/DependencyInjection.cs:391-405`)
  registers the recurring-job runner: it binds the `Scheduler` section and adds `ScheduledJobRunner` as a
  hosted service via `TryAddEnumerable` (not `AddHostedService`, so two callers in one process cannot end
  up with two runners racing for the same job rows, DependencyInjection.cs:398-402). Registering it is
  not the same as turning it on: the runner's `ExecuteAsync` logs once and returns when `Scheduler:Enabled`
  is false (`MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:77`). The runner owns no jobs of
  its own; jobs are `IScheduledJob` implementations contributed separately. The framework ships one,
  `AuditTrailCleanupJob` (`MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailCleanupJob.cs:48`),
  registered by `AddAuditTrail` and running daily at 03:00 UTC (`CronExpression => "0 3 * * *"`,
  AuditTrailCleanupJob.cs:67) to prune the change trail. Conference, Engagement and Identity all call
  `AddScheduledJobs` (Conference.Service/Program.cs:293, comment 291-292).

[Rubric §11, Security] assesses how secrets and key material reach a running process. Vault-backed
configuration keeps connection strings and signing keys out of both the repository and the process
environment, and a shared, optionally vault-encrypted DataProtection key ring keeps auth cookies
portable across replicas. Both are single calls in the framework, so every consumer opts in the same
way rather than inventing its own.

One more per-service extension point is worth noting because it is ADC's, not the framework's:
Conference registers its own OpenTelemetry meter, `"MMCA.ADC.Conference.Scoring"`, on top of the
MMCA.Common meters `AddServiceDefaults` already registers (Conference.Service/Program.cs:119-120). It
carries `scoring.run.failed.terminal`, emitted when a background AI scoring run exhausts its retries and
is abandoned: nothing on the request path reports that failure, so without the counter an incomplete run
is invisible until an organizer notices missing scores (Conference.Service/Program.cs:113-118, the counter
itself at
`Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringProcessor.cs:96-97`). Two
paid-call cost counters ride that same meter name rather than a second meter: `scoring.tokens.input` and
`scoring.tokens.output`, each tagged with the model id and the prompt version
(`.../Sessions/Scoring/AnthropicScoringService.cs:344` and `349`). Reusing the name is the point: a host
that exports one instrument exports all of them, so no second `AddMeter` call is needed. The two tags are
the ones that move spend, a model swap changes the per-token price and a prompt revision changes the
token count, which is why the per-session usage log stays forensics while these counters are the
aggregate a budget alert queries (AnthropicScoringService.cs:381-387). Like the framework meters, the
name is a literal (`SessionScoringProcessor.cs:59`) so the host's startup wiring does not have to
reference an Infrastructure type.

---

## `MMCA.Common.Aspire`, the framework service-defaults package

> Source: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs`
> Tags: `.../HealthCheckTags.cs`
> Telemetry: `.../Telemetry/OutboxPollFilterProcessor.cs`
> Security: `.../Security/SecurityHeaders.cs`
> Warmup: `.../Warmup/`
> Health: `.../Health/RedisPingHealthCheck.cs`
> Gateway building blocks: `.../Gateway/`

This package is the canonical, and the only, service-defaults implementation. Each ADC service
host calls its methods directly; there is no ADC-local copy that shadows or extends it.

### `AddServiceDefaults<TBuilder>`

Common.Aspire/Extensions.cs:46-97. Called early in each service's `Program.cs`, it chains
`ConfigureOpenTelemetry()` (Extensions.cs:48), `AddDefaultHealthChecks()`, which adds a `"self"` check
tagged `"live"` (Extensions.cs:49, 276-282), `AddWarmupReadiness()` (Extensions.cs:50), and
`Services.AddServiceDiscovery()` (Extensions.cs:51). It then applies a Polly resilience pipeline to every
`HttpClient` (`ConfigureHttpClientDefaults`, Extensions.cs:55-94) with 30 s per-attempt / 60 s
circuit-breaker sampling / 90 s total-request timeouts and **one** retry per hop (Extensions.cs:65-71),
and a `SocketsHttpHandler` tuned explicitly for Azure Container Apps Consumption plan
(Extensions.cs:85-93):

- `PooledConnectionLifetime = 10 min`, forces connection recycling so DNS changes during ACA replica
  rollovers are picked up without an app restart.
- `PooledConnectionIdleTimeout = 5 min`, keeps idle connections in the pool long enough for low-traffic
  inter-service calls to reuse them.
- `KeepAlivePingDelay = 60 s` with `KeepAlivePingTimeout = 30 s`, socket-level keep-alive pings prevent
  idle TCP connections from being dropped by Azure's load balancer, without generating HTTP traffic that
  would shift the replica from idle-vCPU billing (roughly 8x cheaper) to active billing.
- `EnableMultipleHttp2Connections = true`, avoids a single multiplexed connection becoming a bottleneck
  under concurrent requests.

None of those numbers are literals here. They all come from `HttpResilienceDefaults` in
`MMCA.Common.Shared` (`Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:13-43`), which
exists so the Aspire HTTP defaults and the `MMCA.Common.Grpc` typed clients cannot drift apart: the
hand-mirrored copies previously did, leaving the gRPC side on the 10 s / 30 s library defaults
(HttpResilienceDefaults.cs:3-9). `MaxRetryAttempts` is deliberately 1 (HttpResilienceDefaults.cs:28),
because the UI service base classes own the user-facing retries and stacking a full budget at every hop
turned a backend brownout into an up-to-16x request storm (HttpResilienceDefaults.cs:21-27).

### Health-check tags, the vocabulary the endpoints filter on

`HealthCheckTags.cs` defines the three tag literals every check in the framework is classified with:
`Live` (line 12), `Ready` (line 18) and `Optional` (line 32). Reading the doc comment on `Optional`
(HealthCheckTags.cs:20-31) is the fastest way to understand the whole health model: a distributed cache
sitting behind an in-memory fallback, or a broker behind a retrying outbox, can fail without the app
losing the ability to serve, and gating readiness on it converts a partial degradation into a **total**
outage because every replica goes unready simultaneously. Leave a check untagged only when the app
genuinely cannot serve correct responses without it, its own database being the standard example. See
[`HealthCheckTags`](group-16-aspire-orchestration.md#healthchecktags).

The endpoint **paths** are declared once alongside the tags, in `HealthEndpointPaths`
(`.../HealthEndpointPaths.cs:11, 14, 17`), with an `IsProbePath` predicate that also matches anything
below `/health/` (HealthEndpointPaths.cs:29-33). That single declaration is what keeps the mapping, the
probe-telemetry filters described below and any host bypass list from drifting apart: a probe route
added to `MapDefaultEndpoints` is automatically a probe route everywhere else
(HealthEndpointPaths.cs:3-7).

### Warmup infrastructure

`AddWarmupReadiness<TBuilder>` (Common.Aspire/Extensions.cs:108-119) registers:

- `WarmupReadinessGate` (singleton), a boolean gate that opens when all warm-up tasks finish.
- `WarmupHostedService`, runs all registered `IWarmupTask` implementations on startup, then opens the
  gate in a `finally` block (`Warmup/WarmupHostedService.cs:58`), so a failing task degrades to a slow
  start rather than a permanently unready replica. Each task is capped at 120 seconds
  (`TaskTimeoutSeconds`, WarmupHostedService.cs:42), a backstop rather than a latency budget: the built-in
  OIDC task is already bounded at 90 s by the resilience pipeline, so a task reaching this limit is one
  waiting on something that will never arrive (WarmupHostedService.cs:36-41).
- `WarmupReadinessHealthCheck` tagged `"ready"` (Extensions.cs:115-116), reports unhealthy until the gate
  opens. Because it appears on `/health/ready` (the readiness probe) but not on `/alive`, ACA ingress
  holds back user traffic from a replica that is still warming up.
- `OpenIdConnectMetadataWarmupTask`, pre-fetches `{authority}/.well-known/openid-configuration`, where
  `{authority}` is the `Authentication:JwtBearer:Authority` key `WithJwksDiscovery` sets; with that key
  unset the task returns immediately (`Warmup/OpenIdConnectMetadataWarmupTask.cs:30-34`). This warms the
  TCP/TLS connection to the JWKS endpoint before the first authenticated request arrives. The problem it
  solves is documented in the class comment (OpenIdConnectMetadataWarmupTask.cs:6-20): on a
  CPU-throttled idle ACA replica, a lazy metadata fetch on the first request can stretch past the client
  timeout, producing the "first request fails, second succeeds" pattern. The remarks are candid that the
  JwtBearer `ConfigurationManager` still performs its own fetch; what the warm-up buys is that the fetch
  now completes in single-digit milliseconds.

Hosts can contribute their own tasks with `services.AddWarmupTask<TTask>()` (Extensions.cs:390-395), and
three ADC services do. Identity (Program.cs:169), Engagement (Program.cs:157) and Conference
(Program.cs:257) each register a subclass of the framework's `SelfHttpWarmupTaskBase`
(`Warmup/SelfHttpWarmupTaskBase.cs:28-33`), which replays a short list of hot read paths against the
host's **own** Kestrel endpoint once the server is listening. The OIDC task warms one outbound
connection; this warms the full inbound path (Kestrel, output cache, routing, authentication,
controller, EF Core, SQL), which is where an idle CPU-throttled replica's cold-start cost actually sits
(SelfHttpWarmupTaskBase.cs:11-15). Two details are load-bearing. The request version defaults to HTTP/2
with `RequestVersionExact` (SelfHttpWarmupTaskBase.cs:70, 77), because these hosts serve h2c only and
an `OrLower` policy would downgrade to HTTP/1.1 and fail the warm-up on every startup
(SelfHttpWarmupTaskBase.cs:64-68); and the whole task is skipped under the `Testing` environment
(SelfHttpWarmupTaskBase.cs:41-46), where `WebApplicationFactory`'s in-memory `TestServer` opens no
socket for a self-request to reach. The derived class contributes only the path list, and that list has
to match the URLs real callers issue in their **values**, not just their shape, or a query-keyed output
cache is warmed with an entry nothing ever reads (SelfHttpWarmupTaskBase.cs:51-59).

[Rubric §12, Performance] assesses whether the system is tuned for its hosting environment. The
`SocketsHttpHandler` tuning and the OIDC warmup task both target the same class of problem: ACA
Consumption plan cold-starts and idle-replica penalties. Solving them in the framework means every
consumer inherits the fix.

### `ConfigureOpenTelemetry<TBuilder>`

Common.Aspire/Extensions.cs:128-268. Configures OTel logging (`IncludeFormattedMessage` + `IncludeScopes`),
metrics (ASP.NET Core, HttpClient, .NET runtime), and tracing (the application's own source plus
`"MMCA.Common.Outbox"`, with ASP.NET Core and HttpClient instrumentation). Three MMCA.Common-specific
additions stand out:

1. **MMCA.Common meters, seven of them** (Common.Aspire/Extensions.cs:199-205): `"MMCA.Common.Outbox"`
   (outbox counters and dispatch lag), `"MMCA.Common.Cqrs"` (RED histograms for command/query handlers
   plus query cache hit/miss), `"MMCA.Common.Idempotency"` (the idempotency filter's replay, conflict
   and degraded counters), `"MMCA.Common.Scheduler"` (the recurring runner's run outcomes, duration and
   schedule lag, inert in a host that never sets `Scheduler:Enabled`), `"MMCA.Common.Broker"` (consumer
   faults plus outbox circuit-breaker openings, inert on the in-process bus),
   `"MMCA.Common.OutputCache"` (the eviction consumer's failed tag evictions) and
   `"MMCA.Common.BestEffort"` (swallowed failures of best-effort side effects). They are registered by
   literal name because the Aspire package has no project reference to the assemblies that define them
   (Extensions.cs:190-198).

2. **`OutboxPollFilterProcessor`** is added to the tracing pipeline (Common.Aspire/Extensions.cs:246)
   before the exporters, so its `OnEnd` runs first (comment at Extensions.cs:241-245).

3. **Four cost knobs** ([Rubric §31, Cost and FinOps]), three off by default and one on.
   `Telemetry:DisableHttpClientMetrics` (Extensions.cs:148-169) and `Telemetry:DisableRuntimeMetrics`
   (Extensions.cs:175-188) each drop a metric family. Both branches are more than "skip the
   instrumentation call", and the comments explain why (Extensions.cs:150-159 and 177-179): a deployed
   host also calls `UseAzureMonitor()`, and the Azure Monitor distro adds the `System.Net.Http` and
   `System.Runtime` meters itself, so skipping `AddHttpClientInstrumentation` left
   `http.client.open_connections` as the single largest AppMetrics stream in both production workspaces
   despite the toggle being on. A `MetricStreamConfiguration.Drop` **View** applies to the whole
   MeterProvider regardless of which component added the meter, which is what makes the toggle
   authoritative instead of advisory (`System.Net.NameResolution` rides along because DNS-lookup metrics
   carry no signal without the rest of the family). The third knob,
   `Telemetry:TracesSampleRatio`, installs a `ParentBasedSampler` over a `TraceIdRatioBasedSampler` for
   head-based trace sampling (Extensions.cs:261-262). A value outside the open interval (0,1), or one
   that fails to parse, falls back to "sample everything" rather than silently blinding the host
   (`TryGetTraceSampleRatio`, Extensions.cs:448-461; the same defensive shape in
   `IsInstrumentationDisabled`, Extensions.cs:471-472). The fourth,
   `Telemetry:FilterProbeTelemetry`, is the one that defaults **on** and is covered on its own below
   (`IsProbeTelemetryFilterEnabled`, Extensions.cs:483-484). ADC's production Bicep sets the first three
   explicitly: `Telemetry__TracesSampleRatio=0.25` (`MMCA.ADC/infra/main.bicep:227-230`),
   `Telemetry__DisableHttpClientMetrics=true` (main.bicep:249-252) and
   `Telemetry__DisableRuntimeMetrics=true` (main.bicep:253-256), the last two measured at roughly 65% of
   AppMetrics ingestion, about 290 MB of a 500 MB daily stream (main.bicep:243-248). It also stretches
   the OTel export cadence with the standard `OTEL_METRIC_EXPORT_INTERVAL=300000` (main.bicep:264-267):
   the exporter ships cumulative aggregates, so a 5x longer interval drops roughly 80% of the remaining
   datapoints while five-minute alert windows keep the same signal (main.bicep:258-263). An unset host
   keeps every metric family, samples every trace and exports on the SDK's 60 second default.

### `MapDefaultEndpoints`

Common.Aspire/Extensions.cs:411-439. Maps three endpoints, each at its `HealthEndpointPaths` constant
rather than a literal:

- `/health` (Extensions.cs:413), all checks must pass; used by humans and dashboards.
- `/alive` (Extensions.cs:417-420), liveness probe: `"live"`-tagged checks only, so a transient
  dependency outage (SQL Server down, say) does not mark the process dead and get it killed.
- `/health/ready` (Extensions.cs:433-436), readiness: everything except `"live"`-only **and
  `"optional"`** checks. This includes the warmup check (tagged `"ready"`) and any untagged dependency
  checks, so a replica still in cold-start or with a failing dependency is removed from ACA ingress
  without being killed. The `"optional"` exclusion is deliberate and the comment above it
  (Extensions.cs:427-432) restates the rule from `HealthCheckTags`: a dependency the app degrades
  gracefully without must not gate readiness, or a partial degradation takes every replica unready at
  once and becomes a total outage. Those checks still surface on `/health`, so the degradation is
  visible without being self-inflicted.

The checks that carry that `"optional"` tag come from `AddInfrastructureHealthChecks(bool requireDatabase)`
(Common.Aspire/Extensions.cs:308-346), which a host calls separately from `AddServiceDefaults`; all four
ADC services pass `requireDatabase: true` (for example Notification Program.cs:128). It registers:

- **Relational checks, one per distinct database** (`AddDatabaseHealthChecks`, Extensions.cs:498-522).
  Both engines are read, SQL Server and SQLite, because a host picks its engine from configuration, and
  both the top-level `ConnectionStrings` section and every named `DataSources` entry are scanned
  (`RelationalSources`, Extensions.cs:541-573). Deduplication is by connection string, so the entries that
  collapse onto one physical database contribute one check rather than one per logical name, and the
  first database keeps the historical `sqlserver` / `sqlite` check name (Extensions.cs:534-540, applied
  at 568). Neither is tagged optional, so both gate readiness.
- **Redis**, via the framework's own `RedisPingHealthCheck` (Extensions.cs:314-331), tagged `"optional"`.
  The comment at Extensions.cs:317-322 is the postmortem: the `AspNetCore.HealthChecks.Redis` check this
  replaced issued `CLUSTER INFO` against any server it detected as clustered, which is how
  StackExchange.Redis 3.x sees Azure Managed Redis (Enterprise tier), and the server refuses that command
  outside admin mode, so every probe threw against a healthy cache. The replacement issues PING only and
  is registered as a singleton so the fallback multiplexer is built once rather than per probe. See
  [`RedisPingHealthCheck`](group-16-aspire-orchestration.md#redispinghealthcheck).
- **RabbitMQ** (Extensions.cs:333-343), also tagged `"optional"`, when a `rabbitmq` or `messaging`
  connection string parses as an absolute URI.

The asymmetry is intentional: Redis and RabbitMQ are optional per host, but a host that cannot resolve
any relational database at all is misconfigured, so `requireDatabase: true` throws at startup instead of
quietly registering no check and reporting healthy (Extensions.cs:294-301, throw at 506-511).

### Dual telemetry export

`AddOpenTelemetryExporters` (Common.Aspire/Extensions.cs:361-378) activates two exporters, each
conditional:

- **OTLP** when `OTEL_EXPORTER_OTLP_ENDPOINT` is present (Extensions.cs:363-369), the Aspire dashboard
  sets this automatically; standalone deployments must supply it.
- **Azure Monitor** when `APPLICATIONINSIGHTS_CONNECTION_STRING` is present (Extensions.cs:371-377),
  injected by the Bicep deployment so logs, metrics, and traces flow to the workspace-based Application
  Insights resource (main.bicep:218-221).

Both can be active simultaneously; each exports an independent copy.

[Rubric §13, Observability and Operability] assesses whether a running system can be understood from
the outside. Dual export means local runs use the lightweight Aspire
dashboard (no Azure subscription required) while the same binary, with a different environment variable,
ships telemetry to Application Insights in production. The switch is purely environment-driven; no code
path changes.

### `OutboxPollFilterProcessor`

`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs`

This OpenTelemetry `BaseProcessor<Activity>` (OutboxPollFilterProcessor.cs:15) drops recurring outbox
poll spans from export. The `OutboxProcessor` background service polls every relational outbox table on a
recurring cycle (2 s framework default,
`Core/MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:31`; deployed environments set 300 s).
Without filtering, those idle polls would dominate Application Insights ingestion, both by span count
and by spawning `SqlClient` dependency spans when the Azure Monitor distro's auto-instrumentation is
active (OutboxPollFilterProcessor.cs:6-14).

The processor walks the in-process parent chain in `OnEnd` (OutboxPollFilterProcessor.cs:37-48),
matching spans whose source is `"MMCA.Common.Outbox"` and whose operation name is `"OutboxPoll"`.
Matching on both avoids suppressing an unrelated consumer span that happens to be called `OutboxPoll`
(OutboxPollFilterProcessor.cs:35-36). When a match is found it clears the `ActivityTraceFlags.Recorded`
flag (line 45), which tells the batch export processors to skip the span. It is registered before the
exporters (Common.Aspire/Extensions.cs:246) so its `OnEnd` runs before the batch processors check the
flag. A null activity returns early rather than throwing, because a telemetry callback must never throw
(OutboxPollFilterProcessor.cs:29-33).

Real outbox-work spans are unaffected: per-message `OutboxProcess` spans restore explicit parent
contexts from the stored trace IDs and are never descendants of the poll span
(OutboxPollFilterProcessor.cs:11-13).

The constant names `OutboxActivitySourceName = "MMCA.Common.Outbox"` and
`PollActivityName = "OutboxPoll"` (OutboxPollFilterProcessor.cs:23-24) are deliberately duplicated from
`MMCA.Common.Infrastructure`; the comment explains that the Aspire package's only `ProjectReference` is
`MMCA.Common.Shared` (for `HttpResilienceDefaults`), so `AddServiceDefaults` stays usable from a host
that does not take the persistence stack (OutboxPollFilterProcessor.cs:17-22).

[Rubric §31, Cost and FinOps] assesses whether observability costs are controlled. Suppressing poll
spans on a 300 s polling interval in production (`Outbox__PollingIntervalSeconds=300` on all four ADC
container apps, `MMCA.ADC/infra/main.bicep:1145, 1348, 1471, 1619`) eliminates the majority of
idle-process telemetry ingestion. The framework makes this the default for every consumer; individual
services do not need to configure it.

### Probe telemetry filtering

`MMCA.Common.Aspire/Telemetry/ProbeTelemetryFilter.cs` and `.../ProbeTelemetryFilterProcessor.cs`

The outbox poll is not the only span nobody asked for. Container Apps liveness and readiness probes,
the gateway's `downstream-{name}` aggregate probes, YARP's active health checks and the outside-in
availability web test between them accounted for **every** `AppRequests` row in both production
workspaces, and their children (the health check's SQL `SELECT 1`, the Redis PING, the gateway's
HttpClient call to each backend's `/alive`) for most of the `AppDependencies` rows
(ProbeTelemetryFilter.cs:6-11, ProbeTelemetryFilterProcessor.cs:6-12). None of it carries end-user
signal, and none of it is touched by `Telemetry:TracesSampleRatio`, because proportional sampling keeps
a proportion of exactly the traffic you did not want (Common.Aspire/Extensions.cs:212-219).

The knob is `Telemetry:FilterProbeTelemetry` and it is the one that defaults to **on**: absent, blank or
unparseable all mean "filter", and only an explicit `false` turns it off, for a host debugging its own
probes (`IsProbeTelemetryFilterEnabled`, Extensions.cs:483-484, rationale at 474-479). Enabled, it
installs two halves:

- **Instrumentation predicates** (Extensions.cs:224-234). `ShouldCollectRequest` refuses an inbound
  request whose path `HealthEndpointPaths.IsProbePath` matches (ProbeTelemetryFilter.cs:40-55) and
  `ShouldCollectOutgoing` refuses an outbound call to a probe path (ProbeTelemetryFilter.cs:62-63).
  Both configure the DEFAULT-named instrumentation options, which is why they are authoritative without
  a View, unlike the two metrics toggles (Extensions.cs:227-229). The outbound half exists because the
  gateway's `DownstreamServiceHealthCheck` calls and YARP's active checks are driven by background
  timers and are nobody's descendants, so a processor would never see them
  (ProbeTelemetryFilter.cs:20-25).
- **`ProbeTelemetryFilterProcessor`** (Extensions.cs:253), registered under the same condition and,
  like the outbox processor, before the exporters. It walks the in-process parent chain and unrecords
  any span sitting under a probe request (ProbeTelemetryFilterProcessor.cs:42-64), because the probe's
  children are sampled independently of the request the predicate just refused.

The load-bearing detail is how the two halves talk to each other. When `ShouldCollectRequest` refuses a
request, the ASP.NET Core instrumentation returns before writing `url.path`, so the descendants would
have no way to recognize their own probe ancestor. The predicate therefore stamps a `mmca.probe` tag on
the server activity on its way out (ProbeTelemetryFilter.cs:33, 49-52), and that tag is the processor's
first match test (ProbeTelemetryFilterProcessor.cs:68-71). It falls back to `url.path`, `http.route` and
the route portion of the display name (ProbeTelemetryFilterProcessor.cs:76-79, 89-93) for the case where
an exporter-side enricher has already consumed the tags. The match is **server-kind only**, so a normal
request never loses its whole subtree because one dependency happened to be a probe
(ProbeTelemetryFilterProcessor.cs:73-76). The pass runs at both `OnStart` and `OnEnd`
(ProbeTelemetryFilterProcessor.cs:29, 40): clearing `Recorded` at end is what keeps the span out of the
exporters, while the start pass additionally stops the instrumentation from enriching data it will never
export, and running only at start would depend on callback ordering this processor does not control
(ProbeTelemetryFilterProcessor.cs:32-39).

Metrics are deliberately untouched. `http.server.request.duration`, the Kestrel instruments and the
routing instruments keep flowing, so probe traffic stays visible on dashboards and only the per-request
trace rows stop being billed (ProbeTelemetryFilterProcessor.cs:15-17).

[Rubric §13, Observability and Operability] assesses whether the signal a system emits is usable.
Filtering here is not "less telemetry", it is a better ratio: the rows that remain in `AppRequests` are
now requests a user made. [Rubric §31, Cost and FinOps] gets the other half, and note the default
direction: the two metrics knobs are opt-in because dropping a metric family is a judgement call, while
this one is opt-out because probe chatter is ingestion no host wants billed.

### Security headers

`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs` provides
`SecurityHeadersMiddleware` (line 133) and `SecurityHeadersExtensions` (line 210). The middleware sets
`X-Content-Type-Options: nosniff` (line 167), `X-Frame-Options` (default `DENY`, line 168 and settings
line 25), `Referrer-Policy` (`strict-origin-when-cross-origin`, line 28), `Permissions-Policy` (line 31),
HSTS outside Development (lines 34-37, applied at 172-175), and a Content-Security-Policy resolved from
`ICspPolicyProvider` (lines 177-199).

The default static policy is a **complete hardened baseline**, not a minimal one
(SecurityHeaders.cs:53-55):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

It ships `script-src` and `style-src` at exactly the strength Blazor (`'wasm-unsafe-eval'`) and MudBlazor
(`'unsafe-inline'` styles) require, so an HTML host that never registers a provider still gets a
functional policy instead of one silently missing both directives, while the JSON, WebSocket and static
responses of API and Gateway hosts are unaffected (SecurityHeaders.cs:39-52). A host needing something
stricter configures the `SecurityHeaders` section or registers its own `ICspPolicyProvider`; the
supported path off `'unsafe-inline'` is the `{nonce}` placeholder, which the middleware replaces with a
freshly generated 16-byte value per request and also stashes in `HttpContext.Items` under
`CspNonce.ItemKey` before the pipeline runs, because the page render is what stamps it onto its tags
(SecurityHeaders.cs:110-113, 136-139, 184-188). Consumers call `AddCommonSecurityHeaders()` (line 220)
and `UseCommonSecurityHeaders()` (line 245); the ADC UI registers with `EnableHsts = false`
(`MMCA.ADC.UI.Web/Program.cs:100`) because that host calls `UseHsts()` itself outside Development
(UI.Web/Program.cs:116).

The same package also ships `AddCommonGatewayCors`
(`MMCA.Common.Aspire/GatewayCorsExtensions.cs:24` onward), which the ADC Gateway calls
(Gateway/Program.cs:89). It is deliberately looser than `MMCA.Common.API`'s allow-list version, because a
reverse proxy has to pass arbitrary client headers through: allow-any in Development
(GatewayCorsExtensions.cs:34-40), and in every other environment the origins from `Cors:AllowedOrigins`
with any header/method plus credentials (GatewayCorsExtensions.cs:44-53).

---

## `MMCA.Common.Aspire.Hosting`, the AppHost extensions package

> Source: `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/`
> Files: `Extensions.cs`, `H2cHealthCheckExtensions.cs`, `H2cEndpointHealthCheck.cs`,
>   `ServiceBusEmulatorResource.cs`

This package lives in a separate assembly from `MMCA.Common.Aspire` so running services do not pull in
the full `Aspire.Hosting` package (Common.Aspire.Hosting/Extensions.cs:13-17 class comment). `Extensions.cs`
exports twelve extension methods used in the AppHosts that orchestrate extracted microservices, and
`H2cHealthCheckExtensions.cs` adds the thirteenth. It exposes no gRPC API at all: gRPC peers are wired
with stock Aspire `WithReference`, as shown above.

### Builder-level resource helpers

- **`AddMailDev(name = "maildev")`** (Extensions.cs:141-150). The MailDev container with a persistent
  lifetime and the two fixed host ports, covered above.
- **`AddMessageBroker(name = "rabbitmq")`** (Extensions.cs:160-165). Wraps
  `builder.AddRabbitMQ(name).WithManagementPlugin()`. The management plugin is always enabled for local
  debug.
- **`AddServiceBusEmulatorBroker(sqlServer, name = "servicebus")`** (Extensions.cs:201-238). The official
  Azure Service Bus emulator container. Both planes are published because the emulator serves two: AMQP
  on container port 5672 carries every publish and consume, and the HTTP management plane on 5300 is what
  MassTransit provisions topology through (`ServiceBusEmulatorResource.cs:34-44`). The image tag floor is
  2.x for that exact reason: the admin plane shipped in 2.0.0, and MassTransit provisions its whole
  topology at bus start, so a silent downgrade to a 1.x image would leave the broker unusable rather than
  merely older (Extensions.cs:101-107). Host ports are left dynamic because nothing outside the stack
  dials these (Extensions.cs:186-189), and `ACCEPT_EULA=Y` is set explicitly because the emulator refuses
  to start without it (Extensions.cs:224-227). No health check is declared, so a `WaitFor` gates on the
  container running rather than on warm-up finishing; the consuming service absorbs the remainder because
  MassTransit starts its bus in the background and reconnects
  (ServiceBusEmulatorResource.cs:25-30). See
  [`ServiceBusEmulatorResource`](group-16-aspire-orchestration.md#servicebusemulatorresource).

### `WithBroker<TResource>`, two overloads

Extensions.cs:252-262 (RabbitMQ) and 280-292 (emulator). Each chains
`WithReference(broker).WaitFor(broker)` plus the provider environment variable, so a single call is the
complete wiring for a broker-aware service: service discovery, health-based wait, and the variable that
`AddBrokerMessaging()` reads to select the transport. The emulator overload adds the connection string
and the management-plane address. The `UseDevelopmentEmulator=true` suffix on that connection string is
the marker `AddBrokerMessaging` keys its emulator branch off, and a real Azure Service Bus connection
string never carries it, so the emulator path cannot be entered by accident (Extensions.cs:271-276).

### `WithJwksDiscovery<TResource>`

Extensions.cs:309-337. Injects `Authentication__JwtBearer__Authority` pointing to the gateway's HTTPS
endpoint (when a gateway is passed) or Identity's HTTPS endpoint (fallback, Extensions.cs:332-335). The
routing-through-gateway rationale is in the method comment (Extensions.cs:321-331): Identity runs
`Http2`-only, so the default HTTP/1.1 backchannel is rejected; the gateway terminates TLS, speaks ALPN,
and routes `/.well-known/*` to Identity over h2c. The method also calls
`WithReference(identity).WaitFor(identity)` (Extensions.cs:316-318). That `WaitFor` is easy to miss and
it shapes the startup graph: all three non-Identity ADC services wait on Identity because they call
`WithJwksDiscovery`, not because of any explicit `WaitFor` in the AppHost.

### `WithE2eRsaKeys`

Extensions.cs:353-368. Reads `E2E_JWT_PRIVATE_KEY_PEM` / `E2E_JWT_PUBLIC_KEY_PEM` from the AppHost's own
process environment and, only when both are non-blank, maps them onto `Jwt__RsaPrivateKeyPem`,
`Jwt__RsaPublicKeyPem` and `Jwks__RsaPublicKeyPem` on the Identity resource. Without the forwarding
every CI login and register fails with "No supported key formats were found" and the readiness gate
times out (Extensions.cs:348-350). Both ADC (AppHost/Program.cs:248) and Store
(`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:168`) call it, which is why it lives in the
framework rather than in either AppHost.

### The two E2E lifts

Both read the same trigger, `E2eLiftTriggerVariable = "E2E_LIFT_REGISTRATION_THROTTLE"`
(Extensions.cs:42), OR-ed with an optional `alsoLiftWhen` parameter evaluated at the call site, and both
return the resource untouched when neither fires.

- **`WithE2eRegistrationThrottleLift(alsoLiftWhen = false)`** (Extensions.cs:392-407) sets
  `LoginProtection__MaxRegistrationsPerIpPerHour` to `E2eRegistrationsPerIpPerHour` (1000,
  Extensions.cs:35), lifted from the production default of 10. An E2E suite registers far more than ten
  accounts from a single localhost IP, so the production default refuses every register test past the
  tenth and the failures look like broken registration rather than the anti-abuse control doing its job
  (Extensions.cs:371-377).
- **`WithE2eGatewayRateLimitLift(alsoLiftWhen = false)`** (Extensions.cs:440-465) lifts three gateway
  values: `GatewayRateLimiting__PermitLimit` to 100000 (Extensions.cs:48),
  `GatewayRateLimiting__GlobalConcurrencyLimit` to 10000 (line 54), and the named auth route policy's
  `PermitLimit` to 100000 (line 60). The whole E2E suite arrives from one loopback client IP, so the
  per-IP window that protects production from a single-source flood reads the suite itself as that flood
  (2026-08-18 ADC run 32185349945: 12 login failures once the window saturated), and the
  anti-credential-stuffing `auth-tight` policy has the same problem for the same reason
  (Extensions.cs:416-424). The three keys are built from constants that **mirror** the settings types
  rather than referencing them (`GatewayRateLimitingSection` at line 70, `MmcaGatewaySection` at line 77,
  `AuthTightPolicyName` at line 84), because this AppHost-tier package must not pull in the
  service-defaults graph to spell one configuration key; a unit test cross-asserts the mirrors, so a
  section rename cannot silently orphan the lift (Extensions.cs:62-70).

The shape is the interesting part in both cases. The trigger, the target setting names and the lifted
values all live in the framework; the AppHost passes only the condition that is its own. ADC calls both
with `alsoLiftWhen: forceWasm` (AppHost/Program.cs:428 and 435) because its forced-WASM switch implies
the same volume; Store calls both parameterless (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:311`
and `320`), leaving the environment variable as the only trigger. A silent regression here surfaces as
login and register E2E reds, never as a build failure (Extensions.cs:429-430).

### `WithH2cHealthCheck`

`H2cHealthCheckExtensions.cs:110-138`, covered in full in the health-gating section above. The point to
carry away is that it is the AppHost-side counterpart of the `Http2`-only Kestrel profile: without it,
a `WaitFor` edge into an h2c service silently degrades to "the process started", which is precisely the
condition that lets a dependent resource race a service that has not finished migrating, seeding or
warming up (H2cHealthCheckExtensions.cs:13-21). See
[`H2cHealthCheckExtensions`](group-16-aspire-orchestration.md#h2chealthcheckextensions).

### The data-source helpers

`WithSQLServerDataSource` (Extensions.cs:483-494), `WithCosmosDataSource` (512-524) and
`WithSqliteDataSource` (537-548), covered in the AppHost section above.

---

## The six Dockerfiles

All six Dockerfiles share the same multi-stage structure (`base`, `build`, `publish`, `final`) and
the same base images. None build the AppHost: it is a local-only orchestration artifact, never deployed.

### Common structure

**Stage `base`** (first `FROM` in all six, line 1): `mcr.microsoft.com/dotnet/aspnet:10.0` with
`WORKDIR /app` and `EXPOSE 8080 8081` (lines 2-4). This is the runtime-only image; it has no SDK tools,
minimizing the attack surface of the final image.

**Stage `build`** (line 6): `mcr.microsoft.com/dotnet/sdk:10.0`, restoring the `MMCA.Common.*` packages
from GitHub Packages. The token is a **BuildKit secret**, never a build argument: each restore step is
`RUN --mount=type=secret,id=github_token` and reads `/run/secrets/github_token` into `GITHUB_TOKEN` for
that one command (Gateway.Dockerfile:24-26). The header comment says why: an `ARG` promoted to `ENV`
lands in image layers, the build cache, and `docker history` (Gateway.Dockerfile:8-10). The build call is
therefore `--secret id=github_token,env=GITHUB_TOKEN`, not `--build-arg`.

There is deliberately **no `dotnet build` step** in any of the six. The comment records the measurement
(CI run 30115729720, 2026-07-24, Gateway.Dockerfile:33-38): a build stage emitted
`bin/Release/net10.0/` while the ReadyToRun publish emits `bin/Release/net10.0/linux-x64/`, so publish
never reused the build output and every image compiled twice, about 75 s of waste per image. Publish does
its own restore and build, and the analyzer gating (`TreatWarningsAsErrors`, `AnalysisMode=All`) still
runs inside it.

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

The build stage copies eight `.csproj` files individually before restoring (UI.Web.Dockerfile:22-29):
three `*.Shared` projects, three `*.UI` projects, and the two web host projects (`MMCA.ADC.UI.Web` +
`MMCA.ADC.UI.Web.Client`). This is a layer-caching optimization: a change in a source file does not
invalidate the restore cache. After restoring, the full `Source/` tree is copied
(UI.Web.Dockerfile:37) and the publish stage builds it.

Entrypoint: `dotnet MMCA.ADC.UI.Web.dll` (UI.Web.Dockerfile:54).

### Four service Dockerfiles

`MMCA.ADC/Source/Services/MMCA.ADC.{Identity,Conference,Engagement,Notification}.Service/Dockerfile`

All four are identical in structure, down to the line numbers. The build stage copies the full `Source/`
tree (line 23) before restoring, and the comment above it says why (lines 20-22): services have deep
project-reference chains through Migrations to all module Infrastructure assemblies, so copying the full
`Source/` tree is simplest. Each service's Dockerfile then restores (lines 26-28) and publishes its own
`.Service.csproj` with ReadyToRun (lines 42-44) independently; all four entrypoints sit on line 50:

- `dotnet MMCA.ADC.Identity.Service.dll`
- `dotnet MMCA.ADC.Conference.Service.dll`
- `dotnet MMCA.ADC.Engagement.Service.dll`
- `dotnet MMCA.ADC.Notification.Service.dll`

[Rubric §17, DevOps and Deployment] continues: having one Dockerfile per deployable means each image
is independently versioned and deployed. CI declares all six as a six-way parallel matrix
(`.github/workflows/deploy.yml:1152-1171`), gated as a whole on the `changes` job classifying the diff as
code (`deploy.yml:1147`), and each leg additionally carries a `changed` column from that job's per-image
dirty map (`deploy.yml:1156, 1159, 1162, 1165, 1168, 1171`). A leg whose image is clean skips the build and
push and re-tags the last `:latest` to this sha instead, so it still concludes **success**: the comment
above the job (deploy.yml:1138-1142) records why that matters, since `deploy` gates on the job-level
`needs.build-images.result == 'success'` equality and a skipped leg would turn the whole job `skipped`
and silently cancel the deploy. The `UseAppHost=false` publish flag strips the native executable
wrapper; the Docker entrypoint invokes the DLL directly via the already-present runtime in the base
image.

---

## Local-to-cloud parity

The AppHost topology maps directly to the Azure infrastructure provisioned by `infra/main.bicep`. The
table below cross-references the local resource with its Azure equivalent:

| Local (AppHost) | Azure (Bicep) |
|---|---|
| SQL Server container (persistent) | Azure SQL Server; the same four databases (`ADC_Identity`, `ADC_Conference`, `ADC_Engagement`, `ADC_Notification`), each Basic 5 DTU / 2 GB (main.bicep:725-741), with weekly/monthly/yearly long-term retention on top of Basic-tier PITR (main.bicep:743-759). The legacy `AtlDevCon` database is declared in neither place (main.bicep:697-709) |
| Redis container (persistent) | Azure Managed Redis (`Microsoft.Cache/redisEnterprise`, Balanced B0, no HA, main.bicep:917-928), OSS-cluster policy and volatile-LRU eviction (main.bicep:936, 939), injected as `ConnectionStrings__redis` from Key Vault (main.bicep:1154) |
| RabbitMQ container (persistent, management plugin), or the Service Bus emulator container under `ADC_BROKER=servicebus` | Azure Service Bus (Standard tier, main.bicep:774-781; Basic lacks the topics MassTransit needs, main.bicep:769-770) |
| MailDev container (fixed ports 1080/1025) | Not provisioned; a real SMTP relay via `Smtp__Host` / `Smtp__Port` / `Smtp__From` (main.bicep:1200-1204 for Identity, 1639-1643 for Notification) |
| `MessageBus__Provider=RabbitMq` (AppHost default) | `MessageBus__Provider=AzureServiceBus` (Bicep env var on all four services, main.bicep:1179, 1369, 1498, 1637) |
| Aspire dashboard (OTLP) | Application Insights workspace-based resource (`APPLICATIONINSIGHTS_CONNECTION_STRING`, main.bicep:218-221) |
| `WithSQLServerDataSource` injects one connection-string env var | Bicep injects the same one plus `DataSources__{Module}__SQLServerMigrationsAssembly` and `Outbox__DatabaseName` (main.bicep:1138-1140) |
| h2c health probe from the AppHost (`WithH2cHealthCheck`) | Dedicated HTTP/1.1 probe listener via `HealthProbe__Port`, 8081 on the three h2c services (main.bicep:1134, 1341, 1464) and 8082 on Notification (main.bicep:1610), because the ACA platform probes speak HTTP/1.1 |
| `WaitFor` gates on `/alive`; only the UI gates on `/health/ready` | The ACA probe block splits the same two paths by job: startup and liveness on `/alive`, readiness on `/health/ready`, all three against the probe port (main.bicep:1249-1274). Readiness polls every 30 s rather than 10 s, because the DB-aware check issues a `SELECT 1` per probe (main.bicep:1243-1248) |
| Outbox poll interval: framework default 2 s | `Outbox__PollingIntervalSeconds=300` on every service (main.bicep:1145, 1348, 1471, 1619); Identity, Conference and Engagement, the three hosts that call `AddScheduledJobs`, also slow the runner's idle wake to `Scheduler__PollingIntervalSeconds=300` (main.bicep:1150, 1350, 1473) |
| Telemetry knobs at their defaults (sample everything, all metric families on, probe traces filtered) | `Telemetry__TracesSampleRatio=0.25`, `Telemetry__DisableHttpClientMetrics=true`, `Telemetry__DisableRuntimeMetrics=true`, `OTEL_METRIC_EXPORT_INTERVAL=300000` (main.bicep:227-230, 249-256, 264-267). `Telemetry__FilterProbeTelemetry` is set nowhere, because its default is already the production behavior |

The transport switch (`RabbitMq` to `AzureServiceBus`) is entirely environment-driven. No code path
changes between local and production: the same `AddBrokerMessaging(configuration)` call in each
service's `Program.cs` reads `MessageBus:Provider` and branches accordingly. This is [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) (outbox +
in-process dispatch + background processor) combined with the infrastructure flexibility of
`MessageBusProvider` selection.

Be honest about what that buys and what it does not. Environment-driven transport selection means no
`#if` and no second code path, but the **default** local run still uses a different broker than
production: RabbitMQ exercises the MassTransit RabbitMQ transport, not the Service Bus topic topology,
its quotas, or its admin-plane behavior. ADC now closes that gap on two fronts rather than one. The
`ADC_BROKER=servicebus` opt-in (AppHost Program.cs:91-95) runs the whole inner-loop stack against the
official emulator, so a developer chasing a transport bug can reproduce it locally; and
`Tests/Integration/MMCA.ADC.ServiceBusEmulator.IntegrationTests` smokes MassTransit against the same
emulator on the weekday nightly, `continue-on-error` and never deploy-gating. The residual gap is what
the emulator itself does not model (real quotas, real throttling, the real admin plane), which is
narrower than the gap a RabbitMQ-only inner loop leaves.

[Rubric §7, Microservices Architecture] is directly served by the fact that the extraction boundaries
(gRPC contracts, broker interfaces, JWKS discovery) are identical in both environments. An engineer can
validate a cross-service event flow locally before it reaches the Azure Service Bus in production.

[Rubric §17, DevOps and Deployment] is served by the single-command local run matching the production
topology in process count, service-discovery mechanism, and transport semantics. The two remaining gaps,
MailDev versus a real SMTP relay and the default RabbitMQ versus Azure Service Bus, are intentional and
each is scoped: the first is never exercised in production paths, the second has both the opt-in
emulator and the nightly emulator tier above.

---

## The YARP Gateway's role

The gateway (`Source/Hosts/MMCA.ADC.Gateway`) is a pure YARP reverse proxy. It has no `DbContext`, no
`ModuleLoader`, no REST controllers, and no broker connection. Its `Program.cs` is 165 lines and
contains **no route definitions at all**: the route table is configuration, not code
(Gateway/Program.cs:9-13). `appsettings.json`'s `ReverseProxy` section owns every route pattern and every
cluster, so adding or repointing a route is an appsettings edit plus a matching entry in `RouteMapTests`
(which pins the whole table), never a redeploy of hand-written `MapForwarder` calls.

### The route table

`Gateway/appsettings.json:57-207` declares **27 routes across 5 clusters**, every destination an
in-cluster service-discovery name over cleartext, never a public URL:

- `/Auth`, `/Users`, `/UserClaims`, `/.well-known/*` to cluster `identity` (`http://identity`,
  appsettings.json:59-75, 170-178). The `/Auth` route alone carries `"RateLimiterPolicy": "auth-tight"`
  (line 62).
- Sixteen Conference prefixes (`/Events`, `/Sessions`, `/Speakers`, `/Rooms`, `/ConferenceCategories`,
  `/CategoryItems`, `/SessionSpeakers`, `/EventSpeakers`, `/SessionCategoryItems`,
  `/SessionQuestionAnswers`, `/EventQuestionAnswers`, `/SpeakerCategoryItems`, `/SessionSelection`,
  `/Questions`, `/Sponsors`, `/Activities`) to cluster `conference` (appsettings.json:76-139, 179-187).
- Five Engagement prefixes (`/Bookmarks`, `/CheckIns`, `/LivePolls`, `/Points`, `/SessionQuestions`) to
  cluster `engagement` (appsettings.json:140-159, 188-196).
- `/Notifications` to cluster `notification-rest` and `/hubs/*` to cluster `notification-hub`
  (appsettings.json:160-167, 197-206). Both point at the same `http://notification` destination; they are
  two clusters because a cluster is what carries the forwarder request config, and these two need
  different ones.

### Three forwarder profiles, on two axes

There are three profiles, not two, and they differ on HTTP version and activity timeout (the header
comment enumerates them, Gateway/Program.cs:15-31).

The `identity`, `conference` and `engagement` clusters each state
`"Version": "2.0"` with `"VersionPolicy": "RequestVersionExact"` in their own `HttpRequest` block
(appsettings.json:174-177, 183-186, 192-195). Exact is load-bearing: on cleartext there is no ALPN to
negotiate, so `RequestVersionOrLower` silently downgrades to HTTP/1.1 and the `Http2`-only backend
rejects it. That pair stays per-cluster rather than moving into the shared defaults, because **which**
clusters speak h2c is a per-cluster fact, not a default (Program.cs:42-43).

The two Notification clusters state no `HttpRequest` block at all, so YARP's HTTP/1.1-capable defaults
apply, because SignalR's WebSocket transport begins with an HTTP/1.1 Upgrade handshake and Notification
therefore stays `Http1AndHttp2` (Program.cs:23-26).

The **timeouts** moved out of the clusters entirely. They live in the `MmcaGateway` section that
`MMCA.Common.Gateway` binds (`GatewaySettings.SectionName`,
`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewaySettings.cs:15`):

- `MmcaGateway:ClusterRequestDefaults:ActivityTimeout = "00:01:40"` (appsettings.json:28-30) applies to
  every cluster that states no value of its own. That value is the shared backend total-request budget of
  90 s (`HttpResilienceDefaults.TotalRequestTimeout`,
  `Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:19`) plus a deliberate 10 second margin.
  The margin is the whole point: the forwarder must **outlive** the backend's own total request budget,
  or a call that exhausts the backend surfaces a gateway abort that hides the backend's real error
  (Program.cs:35-39).
- `MmcaGateway:ClusterRequestOverrides:notification-hub:ActivityTimeout = "01:00:00"`
  (appsettings.json:31-35) is the one cluster whose budget genuinely differs. A hub connection is
  long-lived by design (a WebSocket or long-poll stays open for the session), so applying the REST budget
  to it would tear down healthy hubs.

Precedence is per property and most-specific-wins, which is why the three h2c clusters keep their local
`Version`/`VersionPolicy` pair while inheriting the shared timeout (Program.cs:100-103).

### What `AddMmcaGateway` adds on top

`builder.Services.AddReverseProxy().LoadFromConfig(...).AddMmcaGateway(configuration).AddServiceDiscoveryDestinationResolver()`
(Gateway/Program.cs:112-115). `AddServiceDiscoveryDestinationResolver` is what turns `http://identity`
into a real endpoint; without it YARP would treat `identity` as a DNS host (Program.cs:95-96).
`AddMmcaGateway` (`MMCA.Common.Gateway/GatewayReverseProxyExtensions.cs:47`) adds four things on top of
the loaded table (Program.cs:98-111):

1. The shared cluster request profiles described above.
2. HTTP/2 forwarding, applied by the package's own config filter. It is the single topology, with no
   switch to flip (Program.cs:45-47).
3. Active and passive destination health checks. `appsettings.json:42-47` turns the **active** probe on
   at a 30 second interval, with the path (`/alive`) and timeout (5 s) coming from the package defaults.
   The comment above it (appsettings.json:36-41) explains the upgrade: passive checks only demote a
   destination after real traffic has already failed against it, so a restarting service keeps absorbing
   requests until enough of them error, whereas an out-of-band probe takes a destination out of rotation
   before a client request lands on it. Passive defaults still apply to clusters that declare none
   (`GatewaySettings.cs:121-122`).
4. `X-MMCA-Route` / `X-MMCA-Cluster` trace headers on every proxied request, with any inbound value
   stripped first so a downstream can trust them (`GatewaySettings.cs:181-184`), plus the named per-route
   rate-limiter policies routes reference by name.

### The gateway's own pipeline

The middleware order in `Gateway/Program.cs:124-158` is itself the documentation, and each position is
argued:

- `UseCommonForwardedHeaders()` (line 124) comes **first**, because behind Azure Container Apps ingress
  every connection arrives from the ingress proxy's IP, and without it the per-client-IP rate-limit
  partition would collapse to one shared window for all real users (Program.cs:119-123).
- `UseGatewayCorrelation()` (line 129) stamps the correlation ID on the **request** headers before
  anything can short-circuit (a 429 from the edge limiter included), so the proxied request carries it
  downstream and the service-side middleware adopts the same ID rather than minting a second one
  (Program.cs:126-128).
- `UseCommonSecurityHeaders()` (line 134) is early so the headers apply to forwarded API responses, the
  SignalR hub, the static privacy page and the health endpoints alike.
- `MapDefaultEndpoints()` (line 136) then `UseCors()` (line 137).
- `UseGatewayRateLimiting()` (line 144) sits after CORS so a rejected preflight is still a CORS answer,
  and before the proxy is mapped so a throttled request never reaches a backend. One middleware serves
  both limiters: the edge global limiter from `AddGatewayRateLimiting` (line 64) and the named per-route
  policies `AddMmcaGateway` registered, and a request must satisfy both (Program.cs:139-143).
- `UseStaticFiles()` (line 149) and a `/privacy` alias (lines 154-155) before `MapReverseProxy()`
  (line 158), so the App Store privacy URL is served locally rather than forwarded.

The edge limiter's own numbers are configuration: 120 requests per 60 second window per client IP, a
replica-wide concurrency ceiling of 200, and `/hubs` on the bypass list because a SignalR connection is
long-lived and its negotiate/reconnect traffic must not be throttled (appsettings.json:21-26, defaults in
`MMCA.Common.Aspire/Gateway/GatewayRateLimitingSettings.cs:59, 63, 73`). The `auth-tight` route policy is
30 requests per 60 seconds partitioned on client IP with no queue (appsettings.json:48-55).

### Readiness that reflects the edge's job

`AddGatewayDownstreamHealthChecks("identity", "conference", "engagement", "notification")`
(Gateway/Program.cs:78) registers one `downstream-{name}` check per service, each GETting `/alive`
through a service-discovery-resolved client, tagged `Ready`
(`MMCA.Common.Aspire/Gateway/GatewayHealthCheckExtensions.cs:130, 211`). Tagging matters: a downstream
outage pulls the gateway out of the load balancer without ever failing liveness, because restarting the
gateway fixes nothing about a downstream being down (Gateway/Program.cs:66-69).

One call covers all four because the probe no longer needs to be told which protocol each downstream
speaks. `DownstreamProbeVersion.Auto` is the default
(GatewayHealthCheckExtensions.cs:59); it negotiates per downstream and latches the answer for the life of
the process, so the three h2c REST services latch HTTP/2 on their first poll and Notification answers
`HTTP_1_1_REQUIRED` once and latches HTTP/1.1. The fallback is a one-time cost per downstream, not a
per-poll one (Gateway/Program.cs:70-77).

That active probing has an observable cost, and the gateway's `appsettings.json` pays it down at the
logging layer rather than by probing less (appsettings.json:2-16): three categories (`Polly` retry
attempts, the per-request `System.Net.Http.HttpClient` logs for the `gateway-downstream-*` clients, and
`Yarp.ReverseProxy.Health`) wrote roughly 300k stdout lines a day for traffic no user made, so they sit
at `Warning` while YARP's own request-routing lines stay at `Information`.

### The three architectural purposes

1. **Single entry point.** The MAUI client and Blazor UI always talk to `https://localhost:6001`
   (local) or the equivalent Azure Container Apps ingress URL (production). Neither client is
   hardcoded to individual service addresses. This allows services to be scaled, moved, or split
   without client changes.

2. **TLS termination.** The three REST backends (Identity, Conference, Engagement) run HTTP/2 cleartext
   (h2c) for gRPC; Notification keeps `Http1AndHttp2` defaults for the SignalR WebSocket Upgrade and
   serves gRPC on a separate `Http2`-only endpoint. The gateway terminates TLS and forwards to services
   over cleartext, avoiding TLS overhead on the internal network. The JWKS discovery routing exploits
   this: JwtBearer's HTTP/1.1 backchannel hits the gateway over HTTPS, the gateway negotiates h2c to
   Identity, and the JWKS document is returned transparently.

3. **Extraction reversibility.** If a service needs to be re-merged into the monolith or split
   further, only the YARP route table changes, and it is a configuration file. Clients and other
   services are unaffected. This is [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) (service extraction topology): "transport at the edge
   keeps extraction reversible."

[Rubric §7, Microservices Architecture] is directly served: clients talk to one address; services
talk to each other via gRPC or the broker; the gateway is the only component that knows the current
service topology on behalf of clients.

---

## Startup ordering summary

The health-based `WaitFor` chain imposes this ordering. Two things shape it that are not visible at the
call site: three of the four services wait on Identity without any explicit `WaitFor` in the AppHost
(`WithJwksDiscovery` adds it, Common.Aspire.Hosting/Extensions.cs:316-318), and every one of those waits
gates on a **liveness** answer over the protocol the target actually serves, not on readiness.

```
SQL Server container health
  |- Database resources health (adc-identity, adc-conference, adc-engagement, adc-notification)
       |- Identity Service  (WaitFor: identityDb, redis, mailDev, broker; gate: h2c /alive)
            |- Conference Service (WaitFor: conferenceDb, redis, mailDev, broker,
            |    identity via JWKS; gate: h2c /alive)
            |    |- Engagement Service (WaitFor: engagementDb, redis, mailDev, broker,
            |         conferenceService, identity via JWKS; gate: h2c /alive)
            |- Notification Service (WaitFor: notificationDb, redis, mailDev, broker,
                 identityService twice over: explicit at Program.cs:268 and again via JWKS;
                 gate: stock HTTP/1.1 /alive)
                 |- Gateway (WaitFor: all four services; gate: stock /alive, never /health/ready)
                      |- UI (WaitFor: gateway + all four services; gate: /health/ready)
```

Four edges deliberately carry a `WithReference` with no `WaitFor`: Conference to Engagement (the reverse
half of the bidirectional gRPC pair, Program.cs:273), Engagement to Notification (fire-and-forget live
channel, Program.cs:281), and Identity to Engagement / Identity to Notification (the export aggregation,
Program.cs:291-292). Each would close a cycle against a wait that already exists in the other direction.
All four retry via the gRPC resilience pipeline until the peer is ready.

---

## The AppHost composition smoke test

`MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.SmokeTests/AppHostCompositionSmokeTests.cs`

Everything above is composition code, and composition code has a specific blind spot: a renamed resource,
a reference that no longer resolves, or a `WaitFor` cycle is invisible to `dotnet build` and to every
other test tier, because nothing else runs the orchestration. This project exists to close that blind
spot, and it is deliberately **one test** (AppHostCompositionSmokeTests.cs:41-62).

It boots the real AppHost through `DistributedApplicationTestingBuilder.CreateAsync<Projects.MMCA_ADC_AppHost>`
(line 46-47), starts it, then asks the gateway for a health answer through
`app.CreateHttpClient("gateway", "http")` (line 52). The assertion is not "the gateway is healthy" (the
integration and E2E tiers cover behavior); it is that the composition still resolves: six project
resources, four per-service databases, Redis, the broker, MailDev, the JWKS and gRPC references, and the
whole `WaitFor` graph (class remarks, lines 11-18).

The budgets are generous on purpose. Twelve minutes to build and start (line 33), because the first run
on a cold agent pulls four container images before a single process starts, and eight minutes for the
gateway to answer 200 (line 36), polled every five seconds (line 39). A connection failure while the
gateway is still binding is treated as "not yet" rather than as a result
(AppHostCompositionSmokeTests.cs:91-94), so the test reports the last real status it saw rather than the
first transient error.

It needs a Docker daemon and it is slow, so per [ADR-098](https://ivanball.github.io/docs/adr/098-aspire-orchestration-not-testing-or-dashboards.html) it is probational and non-gating: it runs
`continue-on-error` in the nightly and can never block a deploy (lines 19-21). See
[`AppHostCompositionSmokeTests`](group-16-aspire-orchestration.md#apphostcompositionsmoketests).

[Rubric §14, Testability and Test Strategy] assesses whether the test suite covers the risks the system
actually carries. An orchestration file is a genuine failure surface with no compiler covering it, and the
answer here is proportionate: one test, wide assertion, honest about being slow and kept off the critical
path rather than pretending it is cheap.

---

## Rubric category index for this chapter

| Category | Where primarily embodied |
|---|---|
| §7 Microservices Architecture | `WithReference` declared only for real call edges, so the gRPC topology reads as code (AppHost Program.cs:268-292); the gateway as the only component that knows the service topology on behalf of clients; identical extraction boundaries (gRPC contracts, broker interfaces, JWKS discovery) locally and in Azure |
| §11 Security | The GitHub Packages token as a BuildKit secret in all six Dockerfiles (Gateway.Dockerfile:8-10, 24-26); JWKS discovery with no shared symmetric secret, routed through the gateway and issuer-pinned from the same resource (Program.cs:364-375); `AddCommonKeyVaultConfiguration` and `AddCommonDataProtection` as single framework calls gated on configuration keys absent locally; the hardened default CSP baseline (SecurityHeaders.cs:53-55) |
| §12 Performance & Scalability | The ACA-tuned `SocketsHttpHandler` (Extensions.cs:85-93) and the OIDC metadata warm-up task, both aimed at Consumption-plan cold starts and idle-replica penalties; ReadyToRun publish on the five non-UI images |
| §13 Observability & Operability | Dual OTLP / Azure Monitor export from one binary (Extensions.cs:361-378); seven MMCA.Common meters registered by literal name (Extensions.cs:199-205); probe-trace filtering that raises the signal ratio of `AppRequests` rather than only cutting volume |
| §14 Testability & Test Strategy | `AppHostCompositionSmokeTests`, one test against the one failure surface no compiler covers, kept `continue-on-error` in the nightly per [ADR-098](https://ivanball.github.io/docs/adr/098-aspire-orchestration-not-testing-or-dashboards.html) |
| §17 DevOps & Deployment | Persistent container lifetimes shared by the inner loop and the Aspire-driven E2E CI run; one Dockerfile per deployable behind the six-way `build-images` matrix with per-image dirty gating (`deploy.yml:1152-1171`); the parity table's environment-driven local-to-cloud mapping |
| §29 Resilience & Business Continuity | The liveness-versus-readiness split on every startup gate (Program.cs:324-343), including the gateway's `/alive` gate that avoids the readiness-aggregate wedge; `WithReference` without `WaitFor` on the four cycle-closing edges, absorbed by the gRPC resilience pipeline; `"optional"`-tagged dependency checks that keep a degradation partial |
| §31 Cost / FinOps | The four telemetry knobs and the metric export interval; `OutboxPollFilterProcessor` and `ProbeTelemetryFilterProcessor` suppressing the two highest-volume classes of span nobody asked for; the gateway's probe-log trim (Gateway/appsettings.json:2-16); the 30 s readiness cadence in the ACA probe block (main.bicep:1243-1248) |
| §33 Developer Experience | One command brings up six processes and four containers with no Compose file and no hand-set environment variables; the `ADC_BROKER=servicebus` parity opt-in that is paid for only when needed |

---

## Not determinable from source

- The specific integration events that flow over the broker (`UserRegistered`, `SpeakerLinkedToUser`,
  `SpeakerUnlinkedFromUser`) are cited from AppHost inline comments (Program.cs:50-56, 176-182), not from
  the handler implementations. The comments name the publisher and consumer handler on each side; whether
  those handlers still match the comment is a question for the messaging chapter, not this one.
- The headless-AppHost stall is an operational fact recorded in `MMCA.ADC/CLAUDE.md` and the workspace
  `CLAUDE.md`, not something any source file asserts. There is no code path or config key to cite for it.
- The AppHost declares the Service Bus emulator's endpoints and connection string, but how
  `AddBrokerMessaging` consumes `UseDevelopmentEmulator=true` and `MessageBus:EmulatorAdminEndpoint` is
  in `MMCA.Common.Infrastructure`, outside the files this chapter walks. The emulator resource's own doc
  comment (ServiceBusEmulatorResource.cs:18-24) is the only statement of that contract cited here.
- Every ingestion figure quoted in the cost sections (roughly 65% of AppMetrics, about 290 MB of a
  500 MB daily stream, 100% of `AppRequests` rows from probes, the gateway's roughly 300k stdout lines a
  day) comes from the inline comment that records the measurement, not from a workspace query this
  chapter ran: `MMCA.ADC/infra/main.bicep:243-248`, `MMCA.Common.Aspire/Telemetry/ProbeTelemetryFilter.cs:8-11`
  and `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:2-6`.
- That the `AtlDevCon` database is actually gone from the Azure SQL server is asserted by the template's
  comment (main.bicep:697-709), which is explicit that Incremental-mode Bicep never deleted it and an
  operator did, after the template stopped declaring it. The template can only prove the declaration is
  absent, not the server's current state.
