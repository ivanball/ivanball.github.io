# 16. Aspire Orchestration & Service Defaults

This chapter covers the **hosting boundary**: how the distributed MMCA system is *composed and run*, locally as a single `dotnet run`, and in Azure Container Apps (ACA) as a set of independent revisions. Two distinct concerns live side by side here, and it pays to separate them up front. **AppHost-side** code (`MMCA.Common.Aspire.Hosting`, `MMCA.ADC.AppHost`) is the *orchestrator*: it declares the resource graph, containers, databases, broker, the four services, the gateway, the UI, and wires their dependencies. **Service-side** code (`MMCA.Common.Aspire`) is the *baseline every running process opts into*: OpenTelemetry, health checks, service discovery, HTTP resilience, Kestrel listener profiles, startup warm-up, vault-backed configuration, a shared DataProtection key ring, and hardened security headers. The two assemblies are deliberately kept apart so a running service never drags in the full `Aspire.Hosting` tooling graph (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:13-17`), and the service-side package carries exactly one first-party project reference, `MMCA.Common.Shared`, taken solely so the resilience constants have one home (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/MMCA.Common.Aspire.csproj:51-53`). ADC has no app-local ServiceDefaults project: all four services, the Gateway, and the Blazor UI host consume `MMCA.Common.Aspire`'s `AddServiceDefaults()` directly (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:115`, `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:111`, `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:98`, `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:101`, `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:31`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:30`). Everything in this group is plumbing, but it is the plumbing that makes [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) (database-per-service), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) (service topology + YARP), [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) (resilience / RTO-RPO), and [ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html) (observability and telemetry) *real* at runtime rather than aspirational.

## The orchestrator: declaring the resource graph

When you run `dotnet run --project Source/Hosting/MMCA.ADC.AppHost`, Aspire executes `Program.cs` top to bottom, building a *resource model* rather than starting anything immediately. It declares a persistent SQL Server container (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:14`), four databases on it (`ADC_Identity` / `ADC_Conference` / `ADC_Engagement` / `ADC_Notification`, `Program.cs:32-35`), Redis (`:39`), a RabbitMQ broker (`:60`), and a MailDev SMTP container (`:67`), then the four service projects (`:88`, `:111`, `:151`, `:176`), the YARP Gateway with its HTTPS endpoint pinned to port `6001` (`:252-262`), and the Blazor UI pinned to `6002` (`:279-291`). All of the cross-cutting wiring vocabulary lives in one reusable, cross-app place: the [Extensions](#extensions) static class of `MMCA.Common.Aspire.Hosting` (Level 0, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:23`). It supplies eight fluent helpers, grouped into C# `extension(T)` blocks by the resource type they attach to (primer [§4](00-primer.md#4-c-build-and-code-style-conventions)): `AddMessageBroker` (`:47`), `WithBroker` (`:66`), `WithJwksDiscovery` (`:93`), the two CI-only helpers `WithE2eRsaKeys` (`:137`) and `WithE2eRegistrationThrottleLift` (`:176`), and the per-engine data-source helpers `WithSQLServerDataSource` (`:213`), `WithCosmosDataSource` (`:245`), and `WithSqliteDataSource` (`:275`), the last two added for polyglot persistence ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)).

`.WithSQLServerDataSource(db, "Conference")` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:213`) is the AppHost manifestation of **[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)**: in one fluent chain it adds `.WithReference(database)`, `.WaitFor(database)`, and injects *two* connection-string env vars, `DataSources__{logicalName}__SQLServerConnectionString` for the multi-source routing layer and `ConnectionStrings__SQLServerConnectionString` for the framework's `[Required]` validation and `AddSqlServer` health check (`Extensions.cs:223-224`). Setting both to the same expression deliberately collapses the logical source onto `Default`, so each service runs as a clean single-database monolith with one change tracker and one migration set, while still owning its own `dbo.OutboxMessages` table (the rationale is spelled out in the method's own doc comment, `:196-208`). The routing types that consume those env vars, [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver) and [EntityDataSourceRegistry](group-07-persistence-ef-core.md#entitydatasourceregistry), live in the persistence group. The ADC AppHost calls it once per service (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:91,114,154,179`). This paragraph is where **`[Rubric §8, Data Architecture]`** (each service owns its store, with no shared write path) meets **`[Rubric §7, Microservices Readiness]`** (the topology is a declaration in one file, not a rewrite).

The remaining helpers complete the orchestration vocabulary. `AddMessageBroker()` (`Extensions.cs:47`) provisions RabbitMQ with the management plugin in a single call (`:51`, UI at `http://localhost:15672`), defaulting the resource name to the `DefaultBrokerResourceName` constant (`:28`); `WithBroker(broker)` (`:66`) attaches a service to it with `.WithReference(broker)`, `.WaitFor(broker)`, and `MessageBus__Provider=RabbitMq` (`:72-75`), the env var that the consuming service's `AddBrokerMessaging` reads to select RabbitMQ over [InProcessMessageBus](group-04-events-outbox.md#inprocessmessagebus) (selection driven by [MessageBusProvider](group-14-module-system-composition.md#messagebusprovider) / [MessageBusSettings](group-14-module-system-composition.md#messagebussettings), [ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html)). `WithJwksDiscovery(identity, gateway?)` (`:93`) sets `Authentication__JwtBearer__Authority` (`:119`) so the consuming service validates RS256 tokens against Identity's published keys ([IJwksProvider](group-08-auth.md#ijwksprovider) / [RsaJwksProvider](group-08-auth.md#rsajwksprovider)). The non-trivial part, captured in a long inline comment (`:105-115`), is that it prefers the *gateway* endpoint over Identity's (`:116-118`): the three REST services run **HTTP/2-only on cleartext (h2c)** so gRPC clients can use prior-knowledge negotiation, but the default `JwtBearer` backchannel `HttpClient` speaks HTTP/1.1, which Kestrel rejects on an HTTP/2-only endpoint. Routing the JWKS and `/.well-known/*` fetch through the gateway (which terminates TLS and supports both protocols via ALPN, [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)) makes the default backchannel work end-to-end without weakening the services (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:271-273`). That is the runtime embodiment of the **cross-service token validation** boundary in [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html), with the transport caveat spelled out in [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html).

The two E2E helpers are the CI-shaped siblings, and both are no-ops outside CI. `WithE2eRsaKeys()` (`Extensions.cs:137`) forwards an ephemeral RSA keypair from `E2E_JWT_PRIVATE_KEY_PEM` / `E2E_JWT_PUBLIC_KEY_PEM` onto Identity's `Jwt__RsaPrivateKeyPem` / `Jwt__RsaPublicKeyPem` / `Jwks__RsaPublicKeyPem` (`:148-151`), returning untouched when either variable is absent (`:143-146`), so locally and in production user-secrets or Key Vault supply the keys (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:193`). `WithE2eRegistrationThrottleLift(alsoLiftWhen)` (`:176`) raises Identity's per-IP registration cap to the `E2eRegistrationsPerIpPerHour` constant of 1000 (`:35`, injected as `LoginProtection__MaxRegistrationsPerIpPerHour` at `:187-189`) when the `E2E_LIFT_REGISTRATION_THROTTLE` env var is set or the caller passes its own trigger (`:180-184`); a Playwright suite registers far more than ten accounts from one localhost IP, so without the lift the anti-abuse control refuses every register test past the tenth and the failures look like broken registration. ADC calls it with its forced-WASM flag as the extra trigger (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:322`, with the two independently gated E2E render-mode switches immediately above at `:305-320`). The Cosmos and SQLite siblings (`Extensions.cs:245,275`) inject the equivalent per-engine connection-string env vars ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) and are layered on top of, not instead of, the SQL Server source; no ADC or Store service wires them today.

## Startup ordering and the gRPC deadlock-avoidance trick

Aspire's `WaitFor` builds a startup dependency graph from the resource model: a service does not start until the resources it waits on report healthy (`/health/ready` for projects, container health for SQL / Redis / RabbitMQ). One subtlety worth internalizing now: Conference and Engagement form a **bidirectional gRPC pair** (`ISessionBookmarkValidationService` one way, `IBookmarkCountService` the other). A reciprocal `WaitFor` would deadlock, each waiting for the other to be healthy before either can start, so the AppHost deliberately omits the reverse `WaitFor` on the Conference-to-Engagement edge (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:218`, with the reasoning at `:203-210`) and lets transient "peer not ready" failures self-heal via the Polly resilience pipeline baked into `AddTypedGrpcClient`. The same judgement is applied twice more in the block: Engagement to Notification carries no `WaitFor` because the live-channel push is fire-and-forget (`:226`), and Identity's two export edges to Engagement and Notification carry none because those two already wait on Identity for JWKS (`:236-237`). The typed-client and interceptor machinery, [JwtForwardingClientInterceptor](group-13-grpc-contracts.md#jwtforwardingclientinterceptor) and [GrpcResultExceptionInterceptor](group-13-grpc-contracts.md#grpcresultexceptioninterceptor), lives in the gRPC group ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). This is the kind of decision that is invisible until it bites; the AppHost's inline comments are the canonical explanation.

## The service baseline: AddServiceDefaults()

Every running host calls one method first in `Program.cs`: `AddServiceDefaults()` from the single framework-grade [Extensions](#extensions-1) in `MMCA.Common.Aspire` (Level 2, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:28`). There is no ADC-local copy. `AddServiceDefaults<TBuilder>()` (`:39`) is four lines of composition, `ConfigureOpenTelemetry()`, `AddDefaultHealthChecks()`, `AddWarmupReadiness()`, `AddServiceDiscovery()` (`:41-44`), followed by one `ConfigureHttpClientDefaults` block (`:48`) that applies to *every* `HttpClient` the host later creates: typed clients, named clients, and the YARP forwarder alike. That block installs the standard Polly pipeline (`:58-64`), re-adds service discovery to the handler chain (`:65`), and then replaces the primary handler with a tuned `SocketsHttpHandler` (`:78-86`, rationale comment at `:67-77`). The handler is the clearest **`[Rubric §31, Cost & FinOps]`** decision in the codebase: recycling pooled connections picks up ACA replica DNS rollover without a restart, holding idle connections in the pool avoids paying TCP and TLS handshakes on every low-traffic inter-service call, and socket-level keep-alive pings keep the TCP connection warm *without* generating HTTP traffic, so an idle replica stays on idle-vCPU billing (documented in-code as roughly 8x cheaper than active) instead of being woken by its own liveness plumbing. `EnableMultipleHttp2Connections = true` (`:85`) keeps a single multiplexed HTTP/2 connection from becoming the bottleneck for the gRPC edges above.

## One source of truth for outbound HTTP: HttpResilienceDefaults

The numbers that pipeline uses are not literals in the Aspire package. They live in [HttpResilienceDefaults](#httpresiliencedefaults) (Level 0, `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:10`), a static class of read-only properties in `MMCA.Common.Shared`: a 30 second per-attempt timeout (`:13`), a 60 second circuit-breaker sampling window (`:16`), a 90 second total request timeout including retries (`:19`), **one** retry beyond the initial attempt (`:28`), a 10 minute pooled-connection lifetime (`:34`), a 5 minute pooled idle timeout (`:37`), and 60 second / 30 second keep-alive ping delay and timeout (`:40,43`). It sits in `Shared` for a layer reason: `MMCA.Common.Aspire` and `MMCA.Common.Grpc` may only depend on `Shared`, and before this type existed each package hand-mirrored the values and drifted (10s/30s library defaults on the gRPC side against the tuned 30s/90s on the HTTP side, stated in the doc comment at `:3-9`). Today both read the same properties: the HTTP defaults at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:60-63,80-83` and the typed gRPC clients in `MMCA.Common.Grpc` (group 13). The retry budget is the interesting constant: it is pinned at one deliberately (`HttpResilienceDefaults.cs:21-27`) because the UI service base classes already own user-facing retries, and a full retry budget re-applied at every hop turns a backend brownout into an up-to-16x request storm at exactly the wrong moment. **`[Rubric §29, Resilience & Business Continuity]`** ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)) and **`[Rubric §10, Cross-Cutting Concerns]`**: one constant, two transports, no drift.

## Listeners and probes: one Kestrel profile per host shape

Before a service can answer a health probe it has to be listening on a protocol the prober speaks, and that is not free when the same port serves inbound gRPC. [KestrelEndpointExtensions](#kestrelendpointextensions) (Level 1, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:24`) turns both deployed profiles into a single call, `ConfigureEndpointsWithHealthProbe(defaultProtocols, redeclareCleartextEndpoint, cleartextPort)` (`:77`). It applies the requested protocols to every Kestrel endpoint default and then declares the explicit listeners computed by `BuildListenerPlan` (`:90-98`, plan at `:113`). The plan is empty when `HealthProbe:Port` (`:31`) is unconfigured (`:119-122`), which is exactly the local and integration-test case: no explicit `Listen` call, so Aspire's dynamic ports keep working and two co-hosted services cannot collide. When the deployment injects the port, the plan is one or two [KestrelListenerSpec](#kestrellistenerspec) records (`:132`), each a `(Port, Protocols)` pair: an `Http1`-only listener on the probe port, preceded by a re-declaration of the main cleartext listener when `redeclareCleartextEndpoint` is left at its default (`:124-126`), because an explicit `Listen` call otherwise overrides the container's `ASPNETCORE_HTTP_PORTS` binding entirely. The reason for the second listener is operational and documented at the top of the file (`:8-23`): ACA `httpGet` probes speak HTTP/1.1, which an Http2-only endpoint rejects with GOAWAY `HTTP_1_1_REQUIRED`, which is why those probes used to be TCP-only and never consulted the real dependency-aware health checks. A dedicated Http1 listener on a port that is never published through ingress gives the platform a real target, since `MapDefaultEndpoints()` maps the health routes on every listener. ADC's three REST services pass `HttpProtocols.Http2` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:85`, `.../MMCA.ADC.Identity.Service/Program.cs:81`, `.../MMCA.ADC.Engagement.Service/Program.cs:68`) and the SignalR-hosting Notification service passes `Http1AndHttp2` with `redeclareCleartextEndpoint: false` because its endpoints come from configuration (`.../MMCA.ADC.Notification.Service/Program.cs:71`). This is [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) made concrete, and it tags **`[Rubric §17, DevOps & Deployment]`**.

## Health checks: liveness, readiness, and the "optional" tag

`MapDefaultEndpoints()` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:329`) exposes the three-probe surface the platform reads: `/health` (every check, for humans and dashboards, `:331`), `/alive` (only checks tagged `live`, `:335-338`), and `/health/ready` (`:351-354`). Every ADC host maps it (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:372`, `.../MMCA.ADC.Identity.Service/Program.cs:321`, `.../MMCA.ADC.Engagement.Service/Program.cs:327`, `.../MMCA.ADC.Notification.Service/Program.cs:257`, `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:52`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:119`). The tag vocabulary is a named type rather than string literals, [HealthCheckTags](#healthchecktags) (Level 0, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/HealthCheckTags.cs:6`), with three constants: `Live` (`:12`), `Ready` (`:18`), and `Optional` (`:32`). Read the readiness predicate carefully, because it encodes a hard-won operational rule: it excludes both `live` and `optional` (`Extensions.cs:353`). Excluding `live` keeps a downstream SQL outage from restarting the container. Excluding `optional` is the subtler half, argued at length in both the tag's own doc comment (`HealthCheckTags.cs:20-31`) and the endpoint comment (`Extensions.cs:340-350`): a dependency the app degrades gracefully without (a distributed cache behind an in-memory fallback, a broker behind a retrying outbox) must not gate readiness, because making it readiness-fatal converts a partial degradation into a total outage when every replica goes unready at once. Those checks still surface on `/health`, so the degradation stays visible without being self-inflicted. `AddDefaultHealthChecks()` (`:199`) registers the baseline `self` check tagged `Live` (`:202`), and `AddInfrastructureHealthChecks(requireSqlServer)` (`:230`) adds the dependency probes: SQL Server untagged so it *does* gate readiness (`:242`), Redis and RabbitMQ tagged `Optional` (`:248,260`), and each added only when its connection string is present, so the same binary runs unchanged in an integration-test environment where those containers are absent. The `requireSqlServer` asymmetry is deliberate and documented (`:213-224`): a host that cannot resolve its own database is misconfigured, so a missing connection string throws at startup rather than silently registering no check (`:235-238`), the same fail-fast posture as [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html). All four ADC services pass `requireSqlServer: true` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:184`, `.../MMCA.ADC.Identity.Service/Program.cs:164`, `.../MMCA.ADC.Engagement.Service/Program.cs:162`, `.../MMCA.ADC.Notification.Service/Program.cs:147`). This is **`[Rubric §17, DevOps & Deployment]`** (the probe contract the deployment platform consumes) and **`[Rubric §13, Observability & Operability]`** made concrete; the readiness revision is recorded in [ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html).

## Telemetry: what gets exported, and what it costs

`ConfigureOpenTelemetry()` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:121`) wires logging with formatted messages and scopes (`:123-127`), metrics, and tracing. It adds the framework's own `MMCA.Common.Outbox`, `MMCA.Common.Cqrs`, `MMCA.Common.Idempotency`, and `MMCA.Common.Scheduler` meters (`:160-163`) and the `MMCA.Common.Outbox` activity source (`:168`) by **literal name**, because the Aspire package has no reference to the assemblies that define them (its only project reference is `Shared`); the scheduler meter is inert in a host that never enables `Scheduler:Enabled` (`:155-159`). Three cost levers hang off this method, and all three fail safe. First, [OutboxPollFilterProcessor](#outboxpollfilterprocessor) (Level 0, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:15`) is registered via `.AddProcessor(...)` (`Extensions.cs:177`): a `BaseProcessor<Activity>` whose `OnEnd` (`OutboxPollFilterProcessor.cs:27`) walks each ending span's in-process parent chain (`:37`), matches on *both* operation name and source name so an unrelated span called `OutboxPoll` is not swept up (`:39-40`, the two literals pinned as private constants at `:23-24`), and clears `ActivityTraceFlags.Recorded` (`:45`) so the batch exporters skip it. It must be registered before the exporters so its `OnEnd` runs first, and it returns rather than throws on a null activity (`:29-33`), because a telemetry callback must never take the process down. Real per-message `OutboxProcess` work restores an explicit parent context and is never a poll descendant, so genuine outbox telemetry survives (the poll machinery, [OutboxProcessor](group-04-events-outbox.md#outboxprocessor), [IOutboxSignal](group-04-events-outbox.md#ioutboxsignal), and [OutboxMessage](group-04-events-outbox.md#outboxmessage), lives in the events and outbox group, [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)). Second, `TryGetTraceSampleRatio` (`Extensions.cs:366`) reads an optional `Telemetry:TracesSampleRatio` and, only when it parses inside the open interval `(0,1)` (`:370-372`), installs a `ParentBasedSampler(TraceIdRatioBasedSampler(...))` (`:184-185`) for head-based sampling; a typo, a blank, or an out-of-range value falls back to sampling everything, so a mistake can never silently blackhole all telemetry, and `ParentBased` keeps a sampled-in trace intact across service boundaries. Third, `IsInstrumentationDisabled` (`:389-390`) backs two opt-in kill switches, `Telemetry:DisableHttpClientMetrics` (`:141-144`) and `Telemetry:DisableRuntimeMetrics` (`:150-153`), which drop the two highest-volume metric families on a low-traffic multi-service deployment; unset keeps them, so a host that does not opt in sees no behavior change. Exporters are equally conditional: `AddOpenTelemetryExporters` (`:279`) enables **OTLP** when `OTEL_EXPORTER_OTLP_ENDPOINT` is present (the local Aspire dashboard, `:281-287`) and **Azure Monitor** when `APPLICATIONINSIGHTS_CONNECTION_STRING` is present (`:289-295`), and both can be active at once. The whole shape is [ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html): instrument where auto-instrumentation is blind, then expose cost knobs whose defaults never go dark. **`[Rubric §13, Observability & Operability]`** and **`[Rubric §31, Cost & FinOps]`**.

## Warm-up: defeating ACA cold-start

The warm-up subsystem exists for one concrete failure mode: the "first request fails, second succeeds" pattern on a CPU-throttled idle ACA replica, where lazy initialization (OIDC discovery fetch, connection-pool establishment, JIT) stretches past a client timeout. `AddWarmupReadiness()` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:101`, folded into `AddServiceDefaults` at `:43`) registers four cooperating pieces. [IWarmupTask](#iwarmuptask) (Level 0, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/IWarmupTask.cs:9`) is the unit of startup work: a `Name` for logs (`:12`) plus `ExecuteAsync` (`:15`). [WarmupHostedService](#warmuphostedservice) (Level 1, `Warmup/WarmupHostedService.cs:28`) is a `BackgroundService` that runs *all* registered tasks in parallel exactly once (`:53`) and then opens the gate **in a `finally` block** (`:56-60`), so even when a task throws, the replica is never wedged permanently out of rotation. Each task additionally runs under a 120 second ceiling applied with `WaitAsync` over an injectable `TimeProvider` (`:42,:44-45,:69`): a task that neither completes nor throws used to leave `Task.WhenAll` pending forever and the gate closed with it, and the timeout turns that case into the same log-and-continue path as a failure (`:77-82`), which closes the one gap [ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html) originally recorded as open. A per-task `catch` logs a genuine failure at Warning and lets the others proceed (`:84-88`), while a real host-shutdown cancellation is rethrown (`:73-76`). [WarmupReadinessGate](#warmupreadinessgate) (Level 0, `Warmup/WarmupReadinessGate.cs:10`) is a thread-safe one-shot flag (`Volatile.Read` at `:15`, `Interlocked.Exchange` at `:18`, over an `int`), consumed by [WarmupReadinessHealthCheck](#warmupreadinesshealthcheck) (Level 1, `Warmup/WarmupReadinessHealthCheck.cs:9`), which is registered tagged `HealthCheckTags.Ready` (`Extensions.cs:108-109`) and reports `Unhealthy` until the gate opens (`WarmupReadinessHealthCheck.cs:14-16`). That is exactly what makes `/health/ready` hold ingress traffic off a still-warming replica.

Two task shapes ship with the framework. [OpenIdConnectMetadataWarmupTask](#openidconnectmetadatawarmuptask) (Level 1, `Warmup/OpenIdConnectMetadataWarmupTask.cs:21`) is registered unconditionally by `AddWarmupReadiness` (`Extensions.cs:106`): it reads `Authentication:JwtBearer:Authority` (`:30`, the same key the AppHost's `WithJwksDiscovery` injects), returns quietly when it is unset (`:31-34`), warns and returns when it is not a valid absolute URI (`:36-43`), and otherwise GETs `{authority}/.well-known/openid-configuration` through the shared `IHttpClientFactory` (`:45-46`) to warm DNS, TCP, TLS, and the connection pool. Its remarks state the honest caveat (`:14-20`): the `JwtBearer` middleware caches discovery state separately and still performs its own first fetch, but now over a warm connection. [SelfHttpWarmupTaskBase](#selfhttpwarmuptaskbase) (Level 1, `Warmup/SelfHttpWarmupTaskBase.cs:28`) is the abstract base for the deeper variant: after awaiting `ApplicationStarted` (`:102`, implemented at `:191-199`, because the warm-up runner starts before Kestrel is listening) it replays a subclass-supplied list of `WarmupPaths` (`:59`) against this host's own bound cleartext port, resolved from the server's addresses feature with `ASPNETCORE_URLS` and port 8080 as fallbacks (`ResolveWarmupPort`, `:157-166`). Three `virtual` members are the extension points that make it usable on every host shape: `RequestVersion` and `RequestVersionPolicy` default to HTTP/2 pinned exactly (`:70,:77`), because an Http2-only cleartext endpoint rejects a silently downgraded HTTP/1.1 request, and `RequireSuccessStatusCode` (`:90`) can be turned off so an intentional 401 on an `[Authorize]` route still counts (the refusal traverses Kestrel, routing, and authentication, which is the JIT cost being paid down). The whole task is skipped under the `Testing` environment (`:46,:95-98`), where `WebApplicationFactory`'s in-memory server never opens a socket. Services register their own tasks via `AddWarmupTask<TTask>()` (`Extensions.cs:308`): ADC wires [SelfHttpOutputCacheWarmupTask](group-20-conference-api-grpc.md#selfhttpoutputcachewarmuptask) in Conference (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:262`) and a [SelfHttpWarmupTask](group-22-engagement-module.md#selfhttpwarmuptask) in Engagement and Identity (`.../MMCA.ADC.Engagement.Service/Program.cs:176`, `.../MMCA.ADC.Identity.Service/Program.cs:187`). This whole subsystem is the decision recorded in **[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)**: warm-up is wired into `AddServiceDefaults` so every host gets it, the gate opens even when a task fails or times out (availability over strict warmth), and the missed work is re-paid as a lazy retry on the first real request through the resilience pipeline ([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)). Tag-wise it leans on **`[Rubric §29, Resilience & Business Continuity]`** (graceful startup, readiness gating, fail-open warm-up) and **`[Rubric §17, DevOps & Deployment]`**.

## Configuration secrets: the vault as one more configuration source

Connection strings, RSA signing keys and OAuth client secrets have to reach the process somehow, and [KeyVaultConfigurationExtensions](#keyvaultconfigurationextensions) (Level 0, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:21`) is the framework's answer: `AddCommonKeyVaultConfiguration()` (`:78`) layers an Azure Key Vault over the host configuration so every secret is readable through `IConfiguration` exactly like any other setting, and overrides the sources added before it (`:109`). Two keys drive it. `KeyVault:Uri` is the gate (`:80`): absent or whitespace and the method does nothing at all (`:85-88`), so a developer machine, a test host, and the Helpdesk seed keep the sources they already have and take no Azure dependency at startup. `KeyVault:ReloadIntervalMinutes` is optional (`:96`), and a non-positive or unparseable value throws rather than falling back to "never reload" (`:99-104`), because a silently ignored interval leaves the host serving startup values forever and the operator only finds out when a rotated credential fails to take effect. Authentication is `DefaultAzureCredential` (`:109`), so a deployed host uses its managed identity and a developer falls back to the Azure CLI or Visual Studio sign-in; the secret naming convention is the double dash, which the provider maps onto the configuration separator (`ConnectionStrings--Default` arrives as `ConnectionStrings:Default`, documented at `:42-48`). Two design notes are worth carrying forward. First, this is deliberately **not** called from `AddServiceDefaults()` (`:56-62`), for the same reason `AddCommonDataProtection` is not: service defaults run in every host, and an unconditional Azure dependency at startup would be a liability on a laptop. Second, `builder.Configuration` is a `ConfigurationManager`, which builds and loads each source as it is added (`:63-69`), so the vault is read synchronously at this point in startup and the call belongs early, before the settings binding that reads those values. All four ADC services and the Blazor UI host opt in immediately after `AddServiceDefaults()` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:124`, `.../MMCA.ADC.Identity.Service/Program.cs:119`, `.../MMCA.ADC.Engagement.Service/Program.cs:106`, `.../MMCA.ADC.Notification.Service/Program.cs:109`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:38`). **`[Rubric §11, Security]`** (secrets out of the repository and out of the process environment, rotatable without a redeploy) and **`[Rubric §17, DevOps & Deployment]`**.

## Security headers, CORS, and the shared key ring at the host edge

The last boundary in this group hardens the request and response edge. The shared response-header middleware is defined entirely in `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs`. [SecurityHeadersSettings](#securityheaderssettings) (Level 0, `:18`) holds the strongly-typed values bound from the `"SecurityHeaders"` section (`:21`): `FrameOptions` defaulting to `DENY` (`:24`), `ReferrerPolicy` (`:27`), `PermissionsPolicy` (`:30`), HSTS opt-out and value (`:33,36`), a conservative default **CSP baseline** (`default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, `:47-48`) safe for the JSON, WebSocket, and static responses of API and gateway hosts, and an enforce-versus-report-only switch (`:51`). It deliberately omits `script-src` and `style-src` so it cannot break an HTML or Blazor host that forgot to register a provider (`:38-46`). [ICspPolicyProvider](#icsppolicyprovider) (Level 1, `:65`) is the per-host CSP extension point, with [StaticCspPolicyProvider](#staticcsppolicyprovider) (Level 2, `:72`) as the default that resolves the configured policy once in its constructor (`:76-83`) and returns it for every request (`:85`); a Blazor host registers its own dynamic implementation *before* calling `AddCommonSecurityHeaders`, which is exactly what ADC's UI host does with the shared [BlazorCspPolicyProvider](group-15-common-ui-framework.md#blazorcsppolicyprovider) behind `AddCommonBlazorCsp()` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:99-100`, also turning HSTS off there because the client-facing Gateway emits it). [CspPolicy](#csppolicy) (Level 0, `:57`) is the resolved `(Value, Enforce)` record that decides between `Content-Security-Policy` and `Content-Security-Policy-Report-Only`, keeping a policy and its enforcement mode inseparable. [SecurityHeadersMiddleware](#securityheadersmiddleware) (Level 2, `:94`) stamps `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` on every response (`:121-125`), adds HSTS only outside Development (decided once in the constructor at `:113`, applied at `:127-130`), and emits whichever CSP header the provider's `Enforce` flag selects (`:132-143`). [SecurityHeadersExtensions](#securityheadersextensions) (Level 3, `:154`) supplies the two registration halves: `AddCommonSecurityHeaders` (`:164`), which binds the config section (`:170-174`) and registers the default provider through `TryAddSingleton` so a pre-registered custom provider wins (`:181`), and `UseCommonSecurityHeaders` (`:189`). The stated point is to centralize what each client-facing host previously hand-rolled, eliminating drift; this is **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)**.

Two siblings complete the edge. [GatewayCorsExtensions](#gatewaycorsextensions) (Level 0, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/GatewayCorsExtensions.cs:16`) exposes `AddCommonGatewayCors` (`:24`), which registers the reverse proxy's *default* CORS policy: allow-any origin in Development (`:34-41`) but in every other environment restricting **origins** to `Cors:AllowedOrigins` while allowing any header and method plus credentials (`:44-52`), because the CORS spec forbids combining allow-any-origin with credentials. It is the gateway counterpart to `MMCA.Common.API`'s stricter per-service `AddCommonCors`, and pairs with the YARP topology of [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html); ADC's Gateway wires both plus the header middleware (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:37,42,50`). [DataProtectionExtensions](#dataprotectionextensions) (Level 0, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:19`) fixes the multi-replica half of the same story: the framework default keeps the ASP.NET Core key ring in memory, so on a scaled-out host an auth cookie or antiforgery token minted by replica A cannot be decrypted by replica B, and the user sees random sign-outs that follow the load balancer rather than any pattern (`:10-17`). `AddCommonDataProtection()` (`:52`) persists the key ring to a blob whose URI comes from `DataProtection:BlobStorageUri`, authenticated with `DefaultAzureCredential` (`:54,:68,:70-72`), sets an application discriminator from `DataProtection:ApplicationName` or the host name (`:64-65`), and optionally encrypts the ring at rest with a Key Vault key (`:81-85`). The two gates are deliberately independent (`:74-80`): blob persistence is what makes cookies portable and has to work without the Key Vault Crypto User role, which is granted out of band and can lag a deployment, so coupling them would turn an optional hardening gap into a total authentication outage. Absent config, the method returns immediately (`:59-62`), so a developer machine, a test host, and the Helpdesk seed take no Azure dependency at startup. ADC calls it on the two hosts that mint cookies and antiforgery tokens, Identity and the Blazor UI (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:126`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:40`); this is **[ADR-069](https://ivanball.github.io/docs/adr/069-shared-data-protection-key-ring.html)**. Relevant tags across this boundary: **`[Rubric §11, Security]`** and **`[Rubric §26, Front-End Security]`** (defense-in-depth headers, CSP, and a key ring that survives scale-out), and **`[Rubric §10, Cross-Cutting Concerns]`** (one shared middleware, one shared CORS policy, and one shared key-ring registration instead of N hand-rolled copies).

## How it all fits at runtime

Putting the pieces in sequence: the AppHost declares the graph and injects per-service env vars (`WithSQLServerDataSource`, `WithBroker`, `WithJwksDiscovery`, the two E2E helpers, and the gRPC `WithReference`s); each service boots, sets its Kestrel protocol profile and optional Http1 probe listener with `ConfigureEndpointsWithHealthProbe`, calls `AddServiceDefaults()` to opt into telemetry, health, resilience, and warm-up, then `AddCommonKeyVaultConfiguration()` so the settings binding that follows reads vault-backed secrets, `AddInfrastructureHealthChecks(requireSqlServer: true)` for its dependency probes, `AddCommonDataProtection()` where cookies must survive scale-out, and `AddCommonSecurityHeaders` plus `UseCommonSecurityHeaders` (with `AddCommonGatewayCors` at the gateway) at the edge; Aspire withholds traffic via `WaitFor` and the `/health/ready` predicate until each replica is past its warm-up gate and its non-optional dependencies are healthy; the warm-up tasks pre-pay the cold paths, bounded by the 120 second per-task ceiling; and once live, outbound calls ride the shared `HttpResilienceDefaults` pipeline over the idle-cost-tuned socket handler, integration events flow through the broker selected by the env vars, and telemetry streams to the OTLP endpoint or Azure Monitor minus the suppressed outbox-poll spans, any disabled metric family, and any head-sampled trace fraction. The same env-var-and-abstraction contract is what lets a module run in-process or as an extracted service without code changes ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)): the AppHost decides topology by what it wires, and the service code stays transport-agnostic. The per-type sections that follow document each of these classes in ascending Level order; the module-registration and message-bus types they reference are in the **module system** (group 14) and **events and outbox** (group 04) chapters.

### CspPolicy

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Security` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:57` · Level 0 · record (sealed)

- **What it is**: A resolved Content-Security-Policy: the directive string plus whether it is enforced or emitted report-only.
- **Depends on**: Nothing first-party. Consumed by [ICspPolicyProvider](#icsppolicyprovider), [StaticCspPolicyProvider](#staticcsppolicyprovider), and [SecurityHeadersMiddleware](#securityheadersmiddleware).
- **Concept introduced**: `[Rubric §11, Security]` assesses HTTP security headers (CSP, HSTS, `X-Frame-Options`) as defence-in-depth; this record is the unit a policy provider hands the middleware. CSP itself is taught at the middleware section; here the point is the *enforce-vs-report* split. The whole security-headers pipeline is governed by **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)** (centralized security-response-headers middleware with a pluggable CSP).
- **Walkthrough**: Positional record `CspPolicy(string Value, bool Enforce)` (`SecurityHeaders.cs:57`, doc comment lines 54-56). `Value` is the full CSP directive string (for example `default-src 'self'; object-src 'none'; ...`). `Enforce` decides the header name: when `true` the middleware writes `Content-Security-Policy`; when `false` it writes `Content-Security-Policy-Report-Only` (browsers report violations but do not block), the standard way to trial a tightened policy without breaking the page.
- **Why it's built this way**: `sealed record` for immutability and structural equality. Carrying `Enforce` *on the record* rather than as a separate provider method keeps the policy and its enforcement mode atomic and inseparable: a provider cannot accidentally return a policy string without saying how to enforce it. **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)** makes this two-field shape the contract, and report-only is the deliberate degradation path a dynamic provider falls back to when it cannot build a correct policy.
- **Where it's used**: Returned by `ICspPolicyProvider.GetPolicy` (`SecurityHeaders.cs:68`); constructed by [StaticCspPolicyProvider](#staticcsppolicyprovider) (`SecurityHeaders.cs:82`); read by `SecurityHeadersMiddleware.InvokeAsync` (`SecurityHeaders.cs:132-143`).

---

### DataProtectionExtensions

> MMCA.Common.Aspire · `MMCA.Common.Aspire` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:19` · Level 0 · class (static)

- **What it is**: One opt-in registration call, `AddCommonDataProtection()`, that moves the ASP.NET Core DataProtection key ring out of process memory and into a single Azure Blob, so every replica of a scaled-out host shares one key ring, and optionally encrypts that key ring at rest with an Azure Key Vault key.
- **Depends on**: `Microsoft.AspNetCore.DataProtection` plus its Azure Blob Storage and Key Vault key-ring providers, and `Azure.Identity` (`DefaultAzureCredential`). No first-party types: it is deliberately a thin adapter over the BCL/Azure APIs. Its opt-in shape is shared with [KeyVaultConfigurationExtensions](#keyvaultconfigurationextensions), which cites this class as its precedent (`KeyVaultConfigurationExtensions.cs:57-58`).
- **Concept introduced, the shared key ring.** `[Rubric §11, Security]`, `[Rubric §29, Resilience & Business Continuity]`, `[Rubric §17, DevOps]`. DataProtection is the ASP.NET Core primitive behind auth cookies and antiforgery tokens: the framework encrypts them with a key ring it generates on first use. The default key ring lives **in memory**, which is correct for a single process and wrong the moment a host scales past one replica, because each replica mints its own keys and a cookie issued by replica A cannot be decrypted by replica B. The class doc comment (`DataProtectionExtensions.cs:8-18`) names the symptom precisely: random sign-outs and "The antiforgery token could not be decrypted" errors that follow no pattern "because they follow the load balancer". §29 is the category that cares: an intermittent, traffic-shaped auth failure is an availability defect that no single-replica test can reproduce. **[ADR-069](https://ivanball.github.io/docs/adr/069-shared-data-protection-key-ring.html)** records the decision and the deliberately opt-in shape.
- **Walkthrough**:
  - The whole surface is one method inside a generic `extension<TBuilder>(TBuilder builder) where TBuilder : IHostApplicationBuilder` block (`:21-22`), so it attaches to a web host and a worker host alike.
  - `AddCommonDataProtection()` (`:52`) reads `DataProtection:BlobStorageUri` (`:54`). **Gate 1**: when that key is absent or whitespace it returns the builder untouched (`:59-62`). The comment there (`:56-58`) is the rationale: a developer machine, a test host, and the Helpdesk seed all run single-process, where the in-memory default is right and "an unconditional Azure dependency at startup would be a liability, not a feature".
  - Past the gate it resolves the application discriminator, `DataProtection:ApplicationName` falling back to `builder.Environment.ApplicationName` (`:64-65`). That string is what isolates one application's keys from another's when several share a blob container.
  - It constructs **one** `DefaultAzureCredential` (`:68`) and reuses it for both sinks, with the comment "One credential instance for both sinks so they share a single token cache" (`:67`). `DefaultAzureCredential` is what makes the same code path work in both places: a deployed host authenticates with its managed identity, a developer machine falls back to the Azure CLI or Visual Studio sign-in (doc comment `:44-49`, which also names the two role assignments needed, Storage Blob Data Contributor and Key Vault Crypto User).
  - The registration chain is `AddDataProtection().SetApplicationName(applicationName).PersistKeysToAzureBlobStorage(new Uri(blobStorageUri), credential)` (`:70-72`).
  - **Gate 2** is separate on purpose: when `DataProtection:KeyVaultKeyUri` is set (`:81-82`), it adds `ProtectKeysWithAzureKeyVault(...)` (`:84`). The comment above it (`:74-80`) explains the split at length, and it is the teaching part of this type: blob persistence is the half that fixes cross-replica cookie and antiforgery decryption, and it "has to work on its own, WITHOUT the Key Vault Crypto User role, because that role assignment is granted out of band and can lag the deployment". Folding the two gates into one would turn a missing or delayed role assignment into a total authentication outage instead of an optional hardening gap.
- **Why it's built this way**: Configuration-gated rather than always-on, so the framework never forces an Azure dependency on a host that does not need one; two independent gates rather than one, so hardening cannot take availability down with it; and a static class with an `extension(T)` block, which is the codebase's standard registration idiom (see [primer, C# `extension(T)` types](00-primer.md#c-extensiont-types-read-this-once)). Both decisions are recorded in **[ADR-069](https://ivanball.github.io/docs/adr/069-shared-data-protection-key-ring.html)**, which also notes that a host that simply never calls the method keeps the broken per-replica default.
- **Where it's used**: The three hosts across both apps that mint cookies or antiforgery tokens: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:40`, `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:126` (whose comment at `:121-125` records why Identity needs it: it performs OAuth cookie cryptography and runs at `maxReplicas 2` with no session affinity, so a login started on one replica can fail on the other), and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:82`. The matching blob URIs are injected by the Container Apps Bicep: `MMCA.ADC/infra/main.bicep:1134` (Identity) and `:1780` (the ADC UI), `MMCA.Store/infra/main.bicep:1468` (the Store UI). Covered by [DataProtectionExtensionsTests](group-27-testing-infrastructure.md#dataprotectionextensionstests), which asserts both gates on a built service provider without any Azure credential (the blob client is constructed lazily by the repository, never at registration time).
- **Caveats / not-in-source**: Gate 2 is wired nowhere today: neither Bicep template sets `DataProtection__KeyVaultKeyUri`, and both say so in a comment (`MMCA.Store/infra/main.bicep:1445`, `MMCA.ADC/infra/main.bicep:837`), each pointing at the separate Key Vault Crypto User grant that would be needed first. Nothing in this file validates that the configured URI points at a reachable blob: a wrong URI surfaces at first key-ring access, not at startup.

---

### Extensions

> MMCA.Common.Aspire.Hosting · `MMCA.Common.Aspire.Hosting` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:23` · Level 0 · class (static)

> Disambiguation: this is the **Common.Aspire.Hosting** `Extensions` (the AppHost-side broker, JWKS, E2E and data-source wiring). The other class named `Extensions` in this chapter is the framework's [Common.Aspire `Extensions`](#extensions-1) (the canonical service-defaults bootstrap, service-side). Neither app ships a local `ServiceDefaults` project; their services consume the Common.Aspire one directly.

- **What it is**: AppHost-side Aspire extension methods that wire shared cross-cutting infrastructure (RabbitMQ broker, JWKS-based identity discovery, message-bus provider selection, CI/E2E signing keys and throttle lifts, and per-service database routing) onto Aspire project resources for extracted-microservice deployments.
- **Depends on**: `Aspire.Hosting` / `Aspire.Hosting.RabbitMQ` / `Aspire.Hosting.Azure` (`IDistributedApplicationBuilder`, `IResourceBuilder<RabbitMQServerResource>`, `IResourceBuilder<ProjectResource>`, `IResourceBuilder<SqlServerDatabaseResource>`, `AzureCosmosDBDatabaseResource`). Conceptually pairs with [MessageBusProvider](group-14-module-system-composition.md#messagebusprovider) / [MessageBusSettings](group-14-module-system-composition.md#messagebussettings) (the env var it sets), the JWKS auth side ([IJwksProvider](group-08-auth.md#ijwksprovider), [RsaJwksProvider](group-08-auth.md#rsajwksprovider)), and the multi-source routing in [DataSourceResolver](group-07-persistence-ef-core.md#datasourceresolver) / [EntityDataSourceRegistry](group-07-persistence-ef-core.md#entitydatasourceregistry).
- **Concept introduced**: `[Rubric §7, Microservices Readiness]`, `[Rubric §8, Data Architecture]`, `[Rubric §17, DevOps]`, `[Rubric §11, Security]`. This assembly is **deliberately separate** from `MMCA.Common.Aspire` (the service-defaults assembly every running service consumes) so that running services do not pull in the heavy `Aspire.Hosting` tooling package (doc comment `Extensions.cs:13-17`). §7 assesses how cleanly a module can be lifted into its own deployable; these helpers are the AppHost edge of that boundary. The class also carries a scoped `CA1708` suppression (`Extensions.cs:19-22`) that documents a known analyzer false positive: with two or more `extension(T)` blocks in one static class, the compiler-generated grouping members trip the "identifiers should differ by more than case" rule.
- **Walkthrough**:
  - Two constants. `DefaultBrokerResourceName = "rabbitmq"` (`Extensions.cs:28`) and `E2eRegistrationsPerIpPerHour = 1000` (`:35`), the latter described by its own doc comment (`:30-34`) as "high enough that no suite can reach it" while production keeps the real anti-abuse throttle.
  - `AddMessageBroker(name)` on `IDistributedApplicationBuilder` (`Extensions.cs:47`, block at `:37`): `builder.AddRabbitMQ(name).WithManagementPlugin()` (`:51`), so one call provisions the broker container with its management UI. Production overrides the connection string via configuration so the same projects can target Azure Service Bus without an AppHost change (doc comment `:39-44`). See **[ADR-066](https://ivanball.github.io/docs/adr/066-broker-transport-selection.html)** for the transport-selection policy this env var feeds.
  - `WithBroker<TResource>(broker)` (`Extensions.cs:66`): `.WithReference(broker)` + `.WaitFor(broker)` + `.WithEnvironment("MessageBus__Provider", "RabbitMq")` (`:72-75`). One fluent step wires the broker reference, holds the service until the broker is healthy, and selects the RabbitMQ transport. The generic constraint `IResourceWithEnvironment, IResourceWithWaitSupport` (`:56`) statically restricts the method to capable resources.
  - `WithJwksDiscovery<TResource>(identity, gateway?)` (`Extensions.cs:93`): `.WithReference(identity)` + `.WaitFor(identity)` (`:101-102`), then a deferred `.WithEnvironment(context => ...)` (`:103`) that sets `Authentication__JwtBearer__Authority` (`:119`). It **prefers the gateway HTTPS endpoint** over Identity's (`:116-118`) because, per the inline comment (`:105-115`), Identity listens HTTP/2-only on cleartext for gRPC `h2c`, but the default `JwtBearer` backchannel `HttpClient` sends HTTP/1.1, which Kestrel rejects on an Http2-only endpoint. The gateway terminates TLS, supports HTTP/1.1 and HTTP/2 via ALPN, and forwards `/.well-known/*` to Identity, so the metadata fetch works end to end. With no gateway passed it falls back to Identity's HTTPS endpoint (with the HTTP/1.1 caveat). See [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) (cross-service token validation), [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html) (service topology), and [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html) (gRPC host transport).
  - `WithE2eRsaKeys()` on `IResourceBuilder<ProjectResource>` (`Extensions.cs:137`, block at `:124`): a CI/E2E-only helper that reads `E2E_JWT_PRIVATE_KEY_PEM` / `E2E_JWT_PUBLIC_KEY_PEM` from the AppHost's own environment (`:141-142`), returns the builder unchanged when either is missing (`:143-146`), and otherwise maps them onto `Jwt__RsaPrivateKeyPem`, `Jwt__RsaPublicKeyPem`, and `Jwks__RsaPublicKeyPem` (`:148-151`) so Identity can sign RS256 tokens with a throwaway keypair. The doc comment (`:126-135`) records the failure it prevents: without the forwarding, every CI login/register fails with "No supported key formats were found" and the readiness gate times out. It is a no-op locally and in production, where the variables are absent and user-secrets / Key Vault supply the keys.
  - `WithE2eRegistrationThrottleLift(alsoLiftWhen = false)` (`Extensions.cs:176`): the sibling CI-only escape hatch, for the *other* control that an E2E suite trips. It computes `lift` as the `alsoLiftWhen` argument OR-ed with an ordinal-ignore-case comparison of `E2E_LIFT_REGISTRATION_THROTTLE` against `"true"` (`:180-184`), and when lifted sets `LoginProtection__MaxRegistrationsPerIpPerHour` to `E2eRegistrationsPerIpPerHour` formatted invariantly (`:186-190`); otherwise it returns the builder untouched. The doc comment (`:154-175`) states the problem exactly: production allows ten registrations per IP per hour, an E2E suite registers far more than that from a single localhost IP, "so the production default refuses every register test past the tenth and the failures look like broken registration rather than the anti-abuse control doing its job". The `alsoLiftWhen` parameter exists so an AppHost can imply the lift from an E2E switch of its own rather than requiring a second environment variable.
  - `WithSQLServerDataSource(database, logicalName)` (`Extensions.cs:213`, block at `:194`): the AppHost manifestation of **[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)** (database per service). One fluent chain: `.WithReference(database)` (Aspire injects the connection string), `.WaitFor(database)` (the service does not start until SQL is healthy), then two `.WithEnvironment(...)` calls (`:220-224`). The first sets `DataSources__{logicalName}__SQLServerConnectionString` (`:223`), which the double-underscore convention flattens to `DataSources:{logicalName}:SQLServerConnectionString` for the multi-source routing layer; the second sets `ConnectionStrings__SQLServerConnectionString` (`:224`), the slot the framework's `[Required]` validation and `AddSqlServer` health check read. **Both are set to the same expression** (`database.Resource.ConnectionStringExpression`) on purpose (doc comment `:196-208`): because the two values are identical, the resolver *collapses* the logical name onto `Default`, giving one context, one change tracker, and one migration set per deployed service, while each database still carries its own `dbo.OutboxMessages`.
  - `WithCosmosDataSource(database, logicalName)` (`Extensions.cs:245`): the **Azure Cosmos DB** sibling ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html), polyglot persistence). Takes an `AzureCosmosDBDatabaseResource` (from `AddAzureCosmosDB(...).AddCosmosDatabase(...)`), then `.WithReference` + `.WaitFor` + three env vars (`:252-257`): `DataSources__{logicalName}__CosmosConnectionString` (`:255`, the account connection string the resolver hands to `CosmosDbContext.UseCosmos(...)`), `DataSources__{logicalName}__CosmosDatabaseName` (`:256`, since `UseCosmos` takes the database name separately from the connection string), and `ConnectionStrings__CosmosConnectionString` (`:257`, the `[Required]` / `Default` fallback). Unlike SQL Server, a service typically uses Cosmos for *one* module alongside its SQL Server source, so this is layered **on top of** (not instead of) `WithSQLServerDataSource` (doc comment `:239-240`).
  - `WithSqliteDataSource(logicalName, filePath)` (`Extensions.cs:275`): the **SQLite** sibling ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). SQLite has no Aspire container resource (it is an in-process file), so this only injects connection-string env vars: `DataSources__{logicalName}__SqliteConnectionString` (`:285`, `Data Source=<path>` built at `:282` and handed to `SqliteDbContext.UseSqlite(...)`) and `ConnectionStrings__SqliteConnectionString` (`:286`, the `Default` fallback). Note the different signature, a `filePath` string instead of a database resource.
- **Why it's built this way**: Fluent extensions on `IResourceBuilder<T>` match the Aspire AppHost idiom; the assembly split keeps service runtimes free of AppHost-only dependencies; the optional `gateway?` lets a monolith deployment still use JWKS by pointing straight at Identity. `WithSQLServerDataSource` lives in this shared framework assembly (not an AppHost-local helper) so ADC and Store share one implementation, and making `logicalName` an explicit parameter keeps each service's database identity discoverable by reading the AppHost. The three `With*DataSource` helpers share one naming shape so an engine move ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) is a one-line AppHost change. The two `WithE2e*` helpers are the same idea applied to test infrastructure: the *knowledge* that CI needs a keypair forwarded and a throttle lifted lives in the framework, not copied into each app's AppHost, and both are inert unless their environment variable is present.
- **Where it's used**: AppHost `Program.cs` in `MMCA.ADC.AppHost` and `MMCA.Store.AppHost`. ADC wires the broker once (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:60`), attaches all four services to it (`Program.cs:93,116,156,181`), calls `WithSQLServerDataSource` once per service (`Program.cs:91,114,154,179`), wires JWKS discovery for the three non-Identity services through the gateway (`Program.cs:271-273`), calls `WithE2eRsaKeys()` on Identity (`Program.cs:193`), and lifts the registration throttle with `identityService.WithE2eRegistrationThrottleLift(alsoLiftWhen: forceWasm)` (`Program.cs:322`). Store does the same for its three services: broker at `MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:44`, `WithBroker` at `:111,132,170`, `WithSQLServerDataSource` at `:109,130,167`, `WithJwksDiscovery` at `:243-244`, `WithE2eRsaKeys()` at `:144`, and a bare `WithE2eRegistrationThrottleLift()` at `:253` (no `alsoLiftWhen`, so the environment variable is its only trigger). The `WithCosmosDataSource` / `WithSqliteDataSource` helpers are available framework plumbing ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) but no consumer wires them today: every ADC and Store service currently runs on SQL Server.
- **Caveats / not-in-source**: For all three `With*DataSource` helpers the `logicalName` must match the key the owning entity's configuration derives (module namespace or `[UseDatabase]`); source shows no validation of that string, so a mismatch routes that entity to the `Default` source rather than failing at startup. Note also that the ADC AppHost comment at `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:82-84` now corrects an older note of its own ("an earlier note here said the broker was not wired yet; it is"): the Notification resource does call `.WithBroker(rabbit)` at `:93`.

---

### GatewayCorsExtensions

> MMCA.Common.Aspire · `MMCA.Common.Aspire` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/GatewayCorsExtensions.cs:16` · Level 0 · class (static)

- **What it is**: Registers the shared **default** CORS policy for the reverse-proxy Gateway via a single `AddCommonGatewayCors` extension method.
- **Depends on**: `Microsoft.Extensions` CORS / Configuration / Hosting (ASP.NET Core, BCL). No first-party types.
- **Concept introduced**: `[Rubric §11, Security]`, `[Rubric §26, Front-End Security]`, `[Rubric §9, API & Contract Design]`. §11 and §26 assess a cross-origin policy that stays safe while still allowing credentials. The doc comment (`GatewayCorsExtensions.cs:7-15`) draws the distinction from a *service* host's CORS: a reverse-proxy gateway must pass arbitrary client headers through to the services it fronts, so, unlike `MMCA.Common.API.AddCommonCors`'s allow-listed headers and methods, the production gateway policy allows **any header and method** while restricting **origins** to `Cors:AllowedOrigins`. That origin restriction is load-bearing: the CORS specification forbids combining `AllowAnyOrigin()` with `AllowCredentials()`, so to let cookies and `Authorization` headers flow, the policy must name explicit origins. **[ADR-082](https://ivanball.github.io/docs/adr/082-two-tier-cors-posture.html)** is the record for exactly this two-tier posture (allow-listed service policies plus an any-header gateway policy), and it names this method as the gateway tier (`Website/docs-src/adr/082-two-tier-cors-posture.md:50`, `:88`). This is the browser-facing edge of the Gateway topology ([ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
- **Walkthrough**: `AddCommonGatewayCors(configuration, environment)` sits in an `extension(IServiceCollection services)` block (`GatewayCorsExtensions.cs:18`, method at `:24`). It null-guards the receiver and both arguments (`:28-30`), then registers a **default** policy inside `services.AddCors` (`:32`). In Development it allows any origin, header, and method (`:37-40`), with a scoped `#pragma warning disable S5122` (`:36`, restored at `:41`) whose comment records that allow-any-origin is confined to Development. Otherwise it reads the `Cors:AllowedOrigins` string array, defaulting to `[]` (`:45-47`), and builds `WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()` (`:48-52`). Because it is registered as the **default** policy, hosts pair it with a bare `app.UseCors()` (no named policy).
- **Why it's built this way**: Credentialed cross-origin traffic requires enumerated origins, so the non-Development branch reads them from configuration rather than allowing everything; the any-header / any-method latitude reflects the gateway's pass-through role. One shared method keeps the ADC and Store gateways from drifting apart.
- **Where it's used**: The YARP Gateway hosts: `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:42` and `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:59`, each followed by a bare `app.UseCors()` (ADC `Program.cs:53`, Store `Program.cs:75`).
- **Caveats / not-in-source**: Outside Development, an unset or empty `Cors:AllowedOrigins` yields an empty origin list, which blocks all cross-origin credentialed calls. That is fail-closed (a misconfiguration denies rather than permits), but the browser client cannot reach the gateway until origins are configured.

---

### HealthCheckTags

> MMCA.Common.Aspire · `MMCA.Common.Aspire` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/HealthCheckTags.cs:6` · Level 0 · class (static)

- **What it is**: The three tag-name constants (`live`, `ready`, `optional`) that the standard health endpoints mapped by `MapDefaultEndpoints()` filter on.
- **Depends on**: Nothing. Three `const string` fields. Consumed by the [Common.Aspire `Extensions`](#extensions-1) registration and endpoint-mapping code.
- **Concept introduced, health-check tags as a routing vocabulary.** `[Rubric §13, Observability & Operability]`, `[Rubric §29, Resilience & Business Continuity]`, `[Rubric §17, DevOps]`. ASP.NET Core health checks each carry a set of string tags, and an endpoint maps a `Predicate` over those tags. That means the tag vocabulary *is* the operational contract between the app and the platform (Azure Container Apps or Kubernetes probes). Getting it wrong is not cosmetic: a liveness probe that fails restarts the container, and a readiness probe that fails removes the replica from traffic. Naming the three tags once, in a shared constants class, is what stops a consumer from tagging a check `"Ready"` or `"live "` and silently landing it on the wrong endpoint.
- **Walkthrough**:
  - `Live = "live"` (`HealthCheckTags.cs:12`): liveness only. The check runs on `/alive` and is **excluded** from readiness. Its doc comment (`:8-11`) reserves it for self checks, "so an external dependency outage never restarts the container".
  - `Ready = "ready"` (`HealthCheckTags.cs:18`): the readiness gate. The check runs on `/health/ready` and holds traffic back until it passes. This is the tag the warm-up gate uses.
  - `Optional = "optional"` (`HealthCheckTags.cs:32`): a dependency the application degrades gracefully without. It is reported on `/health` but **excluded** from `/health/ready`. The long doc comment (`:20-31`) is the teaching part and is worth reading in full: a distributed cache sitting behind an in-memory fallback, or a broker behind a retrying outbox, can fail without the app losing the ability to serve. Gating readiness on such a dependency converts a partial degradation into a **total** outage, because every replica goes unready simultaneously and the platform stops routing traffic the app could still handle. A check is left untagged only when the app genuinely cannot serve correct responses without it, its own database being the standard example.
- **Why it's built this way**: Constants rather than an enum, because the health-checks API takes `string` tags; a `const` also lets the values appear in collection expressions such as `tags: [HealthCheckTags.Optional]` with no conversion. The three-way split (live / ready / optional / untagged) encodes a deliberate blast-radius policy: liveness restarts, readiness withholds traffic, optional only reports. That policy is recorded in **[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)**, whose 2026-07-28 revision added the `optional` exclusion to `/health/ready` for exactly the total-outage reason above.
- **Where it's used**: The [Common.Aspire `Extensions`](#extensions-1): the warm-up check is registered with `[HealthCheckTags.Ready]` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:109`), the `"self"` check with `[HealthCheckTags.Live]` (`:202`), and the conditional Redis and RabbitMQ checks with `[HealthCheckTags.Optional]` (`:248`, `:260`). The endpoint predicates read them back: `/alive` requires `Live` (`:335-338`) and `/health/ready` excludes both `Live` and `Optional` (`:351-354`). The tagging is asserted by [InfrastructureHealthChecksTests](group-27-testing-infrastructure.md#infrastructurehealthcheckstests) (`MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Health/InfrastructureHealthChecksTests.cs:89,93`).

---

### KestrelListenerSpec

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Kestrel` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:132` · Level 0 · record (sealed, internal, nested)

- **What it is**: One explicit Kestrel listener expressed as data: a port and the protocols accepted on it. It is the intermediate value that lets the listener *decision* be computed and tested without ever binding a socket.
- **Depends on**: `HttpProtocols` (`Microsoft.AspNetCore.Server.Kestrel.Core`). Produced by [KestrelEndpointExtensions](#kestrelendpointextensions)`.BuildListenerPlan` and consumed by its `ConfigureEndpointsWithHealthProbe`.
- **Concept introduced, a pure plan object as a testability lever.** `[Rubric §14, Testability]`, `[Rubric §15, Best Practices & Code Quality]`. §14 assesses whether behavior can be verified without standing up infrastructure. `ConfigureKestrel` is a callback that only runs when the host boots, and `ListenAnyIP` binds a real socket, so the *logic* of "which listeners does this configuration imply" would normally be untestable. Extracting that logic into a function that returns `IReadOnlyList<KestrelListenerSpec>` makes the decision a value you can assert on, which is exactly what [KestrelEndpointExtensionsTests](group-27-testing-infrastructure.md#kestrelendpointextensionstests) does across all seven of its cases.
- **Walkthrough**: The entire type is `internal sealed record KestrelListenerSpec(int Port, HttpProtocols Protocols)` (`KestrelEndpointExtensions.cs:132`), a positional record nested inside `KestrelEndpointExtensions`, with per-parameter doc comments at `:129-131`. `Port` is the port to listen on; `Protocols` is the protocol set that port accepts (`Http1`, `Http2`, or `Http1AndHttp2`).
- **Why it's built this way**: A record, so structural equality makes a test assertion read as a plain comparison of expected listeners. `internal` and nested, because it is an implementation detail of one extension class and not part of any public contract; the assembly's `<InternalsVisibleTo Include="MMCA.Common.Aspire.Tests" />` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/MMCA.Common.Aspire.csproj:13`) is what keeps it reachable from the tests without widening the public surface. Modelling a listener as a pair rather than calling `ListenAnyIP` inline is the whole reason the surprising parts of the wiring (re-declaring the cleartext endpoint, forcing the probe listener to `Http1`) are verifiable.
- **Where it's used**: Returned in declaration order by `BuildListenerPlan` (`KestrelEndpointExtensions.cs:113-127`) and looped over inside `ConfigureKestrel` at `:94-97`, where each spec becomes one `kestrel.ListenAnyIP(listener.Port, endpoint => endpoint.Protocols = listener.Protocols)` call.

---

### KeyVaultConfigurationExtensions

> MMCA.Common.Aspire · `MMCA.Common.Aspire` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:21` · Level 0 · class (static)

- **What it is**: One opt-in registration call, `AddCommonKeyVaultConfiguration()`, that layers an Azure Key Vault over the host configuration, so every secret in the vault is readable through `IConfiguration` exactly like any other setting, and overrides the sources added before it.
- **Depends on**: `Azure.Extensions.AspNetCore.Configuration.Secrets` (`AzureKeyVaultConfigurationOptions`, `AddAzureKeyVault`), `Azure.Identity` (`DefaultAzureCredential`), and `Microsoft.Extensions.Configuration` / `Microsoft.Extensions.Hosting` (`IHostApplicationBuilder`). No first-party types: like [DataProtectionExtensions](#dataprotectionextensions), which it names as its precedent (`KeyVaultConfigurationExtensions.cs:57-58`), it is a thin adapter over the Azure APIs.
- **Concept introduced, configuration as an ordered stack with the vault on top.** `[Rubric §11, Security]`, `[Rubric §10, Cross-Cutting Concerns]`, `[Rubric §17, DevOps]`. §11 assesses where credentials live and how they rotate. The class doc comment (`:9-20`) frames the decision as a rejection of the two easy answers: a value checked into an appsettings file "is readable by everyone who can read the repository, and it stays readable in the history after it is removed", and a value injected as a deployment-time environment variable "is readable by anything that can read the process environment, and it is frozen until the next deployment, so rotating it means redeploying". Reading from a vault under the host's own managed identity avoids both and lets a rotation take effect on its own. Two mechanics make this land with **no** binding-side code change. First, `IConfiguration` is an ordered stack of sources and a later source wins, so appending the vault last means a vault secret transparently overrides the same key from a file. Second, because a secret name cannot contain a colon, the provider maps a double dash onto the configuration separator (doc comment `:42-48`): the secret `ConnectionStrings--Default` arrives as the key `ConnectionStrings:Default`, and `Jwt--SigningKey` as `Jwt:SigningKey`, so an existing settings class binds vault values untouched.
- **Walkthrough**:
  - The whole surface is one method in a generic `extension<TBuilder>(TBuilder builder) where TBuilder : IHostApplicationBuilder` block (`:23-24`), so it attaches to a web host and a worker host alike.
  - `AddCommonKeyVaultConfiguration()` (`:78`) reads `KeyVault:Uri` (`:80`). **The gate**: absent or whitespace means "do nothing", returning the builder untouched (`:85-88`). The comment there (`:82-84`) gives the reason: a developer machine, a test host, and the Helpdesk seed read configuration from files and user secrets, "where reaching for a vault at startup buys nothing and costs a hard Azure dependency on every run".
  - It then builds an `AzureKeyVaultConfigurationOptions` (`:90`) and reads the optional `KeyVault:ReloadIntervalMinutes` (`:96`). When that key is present it must parse as a positive whole number under the invariant culture, or the method **throws** `InvalidOperationException` naming the offending value (`:97-104`); a valid value becomes `options.ReloadInterval = TimeSpan.FromMinutes(minutes)` (`:106`). The comment above it (`:92-95`) is the teaching part: a misspelled interval fails loudly rather than falling back to "never reload", because silently ignoring it "would leave the host serving the secret values it read at startup forever, and the operator would only find out when a rotated credential failed to take effect, which is exactly the wrong moment". Left unset entirely, the vault is read once at startup and a rotated secret only reaches the host on its next restart (doc comment `:37-39`).
  - The last statement is `builder.Configuration.AddAzureKeyVault(new Uri(vaultUri), new DefaultAzureCredential(), options)` (`:109`), then it returns the builder (`:111`). `DefaultAzureCredential` is what makes one code path work in both places: a deployed host authenticates with its managed identity, a developer machine falls back to the Azure CLI or Visual Studio sign-in, and the identity needs the Key Vault Secrets User role on the vault (doc comment `:49-55`).
  - **When the read happens** is the detail that dictates where the call goes (doc comment `:63-69`): the source is added to `builder.Configuration`, whose `ConfigurationManager` builds and loads each source **as it is added**, so the vault is read synchronously at this point in startup. That is what makes the secrets visible to everything registered afterwards, and it is why the call belongs early in the host builder, ahead of the settings binding and the service registrations that read them.
- **Why it's built this way**: Deliberately **not** called from `AddServiceDefaults()`, and the doc comment says so in as many words (`:56-62`): service defaults run in every host, developer machine and test host and Helpdesk seed included, so an unconditional Azure dependency at startup "would be a liability there rather than a feature". A host that wants vault-backed configuration opts in with this one call, exactly like [DataProtectionExtensions](#dataprotectionextensions). The loud failure on a bad reload interval is the same fail-fast contract as **[ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)**: a misconfiguration whose only symptom would appear later, during an incident, is worth a startup crash. **[ADR-061](https://ivanball.github.io/docs/adr/061-runtime-secret-management.html)** records the platform half of the same posture (production secrets as `keyVaultUrl` references resolved by a user-assigned managed identity); this extension is the in-process complement, adding the whole vault as a configuration source rather than binding secrets one env var at a time.
- **Where it's used**: Five ADC hosts (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:38`, `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:119`, `.../MMCA.ADC.Conference.Service/Program.cs:124`, `.../MMCA.ADC.Engagement.Service/Program.cs:106`, `.../MMCA.ADC.Notification.Service/Program.cs:109`) and five Store deployables (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:45`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:41`, `.../MMCA.Store.Identity.Service/Program.cs:48`, `.../MMCA.Store.Catalog.Service/Program.cs:41`, `.../MMCA.Store.Sales.Service/Program.cs:60`). Each call sits immediately after `AddServiceDefaults()` and before any settings binding, and the ADC Identity host carries the canonical comment explaining that placement (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:113-118`). The gate is opened in production by the Container Apps Bicep: ADC sets `KeyVault__Uri` per app (`MMCA.ADC/infra/main.bicep:1144`, `:1299`, `:1425`, `:1566`, `:1785`), and Store hoists it into one shared `keyVaultUriEnv` variable (`MMCA.Store/infra/main.bicep:921-924`) whose comment (`:910-920`) records both the no-op-without-it property and the fact that the read grant already exists. Covered by [KeyVaultConfigurationExtensionsTests](group-27-testing-infrastructure.md#keyvaultconfigurationextensionstests), which asserts the gate, the appended source with and without a reload interval, and both throwing paths.
- **Caveats / not-in-source**: A malformed `KeyVault:Uri` throws `UriFormatException` from `new Uri(...)` (documented at `:72-74`); source contains no explicit URI validation of its own. Nothing here verifies the identity actually holds the Secrets User role: because the source loads synchronously as it is added, an authentication failure is a startup crash rather than a degraded feature, which is exactly what the Store Bicep comment warns about for the companion `AZURE_CLIENT_ID` variable (`MMCA.Store/infra/main.bicep:926-934`: `DefaultAzureCredential` targets the system-assigned identity unless the client id is passed, and these apps carry only a user-assigned one). No ADR records this extension by name; ADR-061 covers the platform-resolved secret references beside it.

---

### OutboxPollFilterProcessor

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Telemetry` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:15` · Level 0 · class (sealed)

- **What it is**: An OpenTelemetry `BaseProcessor<Activity>` that suppresses outbox **poll** spans and their descendants from telemetry export, preventing idle polling from dominating Application Insights / Log Analytics ingestion cost.
- **Depends on**: OpenTelemetry `BaseProcessor<Activity>` and `System.Diagnostics.Activity` (NuGet / BCL); the Azure Monitor distro's automatic SqlClient instrumentation. Conceptually it filters the activities raised by [OutboxProcessor](group-04-events-outbox.md#outboxprocessor) on the `MMCA.Common.Outbox` source.
- **Concept introduced, span filtering as a cost lever.** `[Rubric §13, Observability]`, `[Rubric §31, Cost Efficiency / FinOps]`. §31 assesses deliberate spend control; this is one of the codebase's clearest FinOps decisions. `OutboxProcessor` polls every relational outbox table on a recurring cycle (deployed environments push `Outbox:PollingIntervalSeconds` to 300 s precisely so idle polls cost less). Even an idle poll generates an `OutboxPoll` span plus, under the Azure Monitor distro, a child `SqlClient` dependency span; at scale those idle spans would dominate ingestion and spam the local Aspire dashboard. This processor drops them while leaving real per-message work intact. **[ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html)** (observability and telemetry strategy) records it alongside the sampling and metric-family knobs.
- **Walkthrough**:
  - Two literal constants (`OutboxPollFilterProcessor.cs:23-24`): `OutboxActivitySourceName = "MMCA.Common.Outbox"` and `PollActivityName = "OutboxPoll"`. These are **duplicated literals, not references** to the Infrastructure constants, because this package does not reference `MMCA.Common.Infrastructure` (where `OutboxProcessor` lives), which keeps `AddServiceDefaults` usable from a host that does not take the persistence stack; the comment above them (`:17-22`) flags that they must stay in sync with `OutboxProcessor`, records that this package's one `ProjectReference` is `MMCA.Common.Shared` (for [HttpResilienceDefaults](#httpresiliencedefaults)), and notes that the same two literals also appear in the `AddMeter` / `AddSource` calls in `Extensions.cs`.
  - `OnEnd(Activity data)` (`:27`): returns early on `null` (`:29-33`) with the comment "Never throw from a telemetry callback", since a processor that throws would take the host with it.
  - It then walks the in-process parent chain, `for (var current = data; current is not null; current = current.Parent)` (`:37`). If any ancestor matches **both** `OperationName == "OutboxPoll"` **and** `Source.Name == "MMCA.Common.Outbox"` (`:39-40`, checking both avoids suppressing an unrelated consumer span that happens to be named "OutboxPoll"), it clears the recorded flag with `data.ActivityTraceFlags &= ~ActivityTraceFlags.Recorded` (`:45`) and returns.
  - **Why real work survives**: per-message `OutboxProcess` spans are created with explicit parent contexts restored from stored trace ids, so they are never descendants of the poll span and never match the parent-chain walk (doc comment `:11-13`).
- **Why it's built this way**: Sealed. Clearing `Recorded` (rather than trying to drop the activity) is what makes the batch export processors skip it, which is why the registration order matters: this processor is added *before* the exporters so its `OnEnd` runs first (comment at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:172-176`). The parent-chain walk, rather than a direct-parent check, catches deeply nested children (the auto-instrumented `SqlClient` span is a grandchild of the poll span). The literal-string duplication is the documented price of keeping this package off `MMCA.Common.Infrastructure`, whose dependency set (EF Core, MassTransit, SignalR/Redis) every `AddServiceDefaults` caller would otherwise inherit.
- **Where it's used**: Registered on the tracing pipeline via `.AddProcessor(new Telemetry.OutboxPollFilterProcessor())` in the [Common.Aspire `Extensions`](#extensions-1) `ConfigureOpenTelemetry` (`Extensions.cs:177`), before `AddOpenTelemetryExporters()` (`:188`). Covered by [OutboxPollFilterProcessorTests](group-27-testing-infrastructure.md#outboxpollfilterprocessortests).

---

### SecurityHeadersSettings

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Security` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:18` · Level 0 · class (sealed)

- **What it is**: Strongly-typed configuration for [SecurityHeadersMiddleware](#securityheadersmiddleware), centralising the security-header values each client-facing host previously hand-rolled.
- **Depends on**: Nothing first-party. Consumed through `IOptions<SecurityHeadersSettings>` by [StaticCspPolicyProvider](#staticcsppolicyprovider) and [SecurityHeadersMiddleware](#securityheadersmiddleware).
- **Concept introduced**: `[Rubric §11, Security]`, `[Rubric §34, Architecture Governance & Documentation]`. §11 assesses hardened HTTP response headers. Previously each host set `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, and CSP independently, inviting drift; pulling them into one shared settings class with hardened defaults means a new host inherits the safe values automatically, with per-host overrides through the `"SecurityHeaders"` configuration section or a `configure` delegate.
- **Walkthrough**: `SectionName = "SecurityHeaders"` (`SecurityHeaders.cs:21`). The defaults are the interesting part: `FrameOptions = "DENY"` (`:24`, anti-clickjacking, no framing at all); `ReferrerPolicy = "strict-origin-when-cross-origin"` (`:27`, leaks no path cross-origin); `PermissionsPolicy` denying geolocation, microphone, camera, and payment (`:30`); `EnableHsts = true` (`:33`) with `HstsValue = "max-age=31536000; includeSubDomains"` (`:36`, one year including subdomains). `ContentSecurityPolicy` (`:47-48`) defaults to a conservative hardened baseline, `default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, and its doc comment (`:38-46`) explains that it **deliberately omits `script-src` and `style-src`** so it does not break an HTML/Blazor host that forgot to register a provider (Blazor needs `script-src 'wasm-unsafe-eval'`, MudBlazor needs `style-src 'unsafe-inline'`); such hosts register their own [ICspPolicyProvider](#icsppolicyprovider). `EnforceContentSecurityPolicy = true` (`:51`); when false, the middleware emits the policy report-only.
- **Why it's built this way**: Sealed and mutable (`get; set;`, not `init`-only) so the `configure` delegate or `IOptions` binding can mutate defaults before the middleware starts. The conservative CSP-without-script/style default is a careful trade-off, codified in **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)** as *fail-safe over fail-secure*: the shared middleware must never be the thing that blanks out a Blazor app, so the baseline is safe for the JSON / WebSocket / static responses of API and Gateway hosts and harmless to HTML hosts that supply their own provider. The intentionally incomplete baseline is documented on the property itself rather than only in the ADR.
- **Where it's used**: Bound and registered by [SecurityHeadersExtensions](#securityheadersextensions) `AddCommonSecurityHeaders` (`SecurityHeaders.cs:170-179`); read by [StaticCspPolicyProvider](#staticcsppolicyprovider) (`:79-82`) and [SecurityHeadersMiddleware](#securityheadersmiddleware) (`:112-113`, `:122-129`). Both apps' UI hosts override `EnableHsts` to `false` through the `configure` delegate (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:100`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:140`), while their Gateways take the defaults (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:37`, `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:53`).

---

### ICspPolicyProvider

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Security` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:65` · Level 1 · interface

- **What it is**: The contract for resolving the Content-Security-Policy for a response. The framework ships a static default; a host that needs a dynamic policy registers its own implementation.
- **Depends on**: [CspPolicy](#csppolicy) (return type); `HttpContext` (ASP.NET Core).
- **Concept introduced, the CSP extension point.** `[Rubric §11, Security]` (CSP as defence-in-depth) and `[Rubric §26, Front-End Security]` (CSP protecting Blazor pages from XSS). The doc comment (`SecurityHeaders.cs:59-64`) states the extensibility rule: a Blazor host needing a dynamic `connect-src` (for example pinning to its API origin at runtime) registers a custom `ICspPolicyProvider` **before** calling `AddCommonSecurityHeaders`, because that method registers the default only via `TryAddSingleton` (`:181`), so a pre-registered custom provider wins.
- **Walkthrough**: A single method, `CspPolicy? GetPolicy(HttpContext context)` (`SecurityHeaders.cs:68`): returns the policy to emit for the current response, or `null` to emit none. Taking the `HttpContext` makes it per-request, so a provider can vary the policy by path or request properties.
- **Why it's built this way**: A one-method interface is the minimal extension point for a per-consumer CSP allow-list; returning the [CspPolicy](#csppolicy) record (not a bare string) carries the enforce / report decision atomically. **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)** explains why the indirection exists at all: one static CSP cannot serve both a JSON/Gateway host and a Blazor/MudBlazor host (the latter needs `script-src 'wasm-unsafe-eval'`, `style-src 'unsafe-inline'`, and a runtime-pinned `connect-src`), and a wrong CSP hard-breaks the app, so the policy must be resolved through a provider rather than baked in as a constant.
- **Where it's used**: Implemented by the default [StaticCspPolicyProvider](#staticcsppolicyprovider) (`SecurityHeaders.cs:72`) and by the shared [BlazorCspPolicyProvider](group-15-common-ui-framework.md#blazorcsppolicyprovider) in `MMCA.Common.UI.Web`, which both apps' Blazor hosts register through `AddCommonBlazorCsp` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:39`) ahead of `AddCommonSecurityHeaders`. Resolved per request inside [SecurityHeadersMiddleware](#securityheadersmiddleware) (`SecurityHeaders.cs:132`).

---

### KestrelEndpointExtensions

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Kestrel` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:24` · Level 1 · class (static)

- **What it is**: One call, `ConfigureEndpointsWithHealthProbe(...)`, that applies a protocol profile to every Kestrel endpoint default and, when a probe port is configured, adds a dedicated HTTP/1.1-only listener so the platform's `httpGet` health probes have something they can actually speak to.
- **Depends on**: [KestrelListenerSpec](#kestrellistenerspec) (the plan it computes); `WebApplicationBuilder`, `HttpProtocols`, `IConfiguration` (ASP.NET Core / BCL). Pairs with the health endpoints mapped by the [Common.Aspire `Extensions`](#extensions-1) `MapDefaultEndpoints()`.
- **Concept introduced, the protocol mismatch between gRPC hosts and platform probes.** `[Rubric §7, Microservices Readiness]`, `[Rubric §13, Observability & Operability]`, `[Rubric §17, DevOps]`, `[Rubric §29, Resilience]`. The class doc comment (`KestrelEndpointExtensions.cs:8-23`) states the two facts that force this design. First, a service serving inbound gRPC on cleartext must answer **HTTP/2 with prior knowledge (h2c)**: there is no TLS, therefore no ALPN to negotiate with, and the typed gRPC clients from `MMCA.Common.Grpc` speak h2c directly. Second, Azure Container Apps `httpGet` probes speak **HTTP/1.1**, which an Http2-only endpoint rejects with GOAWAY `HTTP_1_1_REQUIRED`. The consequence is the operational point worth internalising: that mismatch is exactly why those probes "used to be TCP-only and never consulted the real, dependency-aware health checks", meaning the platform could not tell a live socket from a service whose database was gone. A separate `Http1`-only listener on a port that is never published through ingress gives the platform a probe target, and because `MapDefaultEndpoints()` maps `/health`, `/alive`, and `/health/ready` on **every** listener, that probe listener serves the real health pipeline. **[ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html)** (gRPC host transport) is the governing decision.
- **Walkthrough**:
  - Two public constants. `HealthProbePortConfigKey = "HealthProbe:Port"` (`:31`), which deployment infrastructure injects as `HealthProbe__Port`, "deliberately absent locally so Aspire's dynamic ports keep working and co-hosted services cannot collide on one machine" (doc comment `:26-30`). `DefaultCleartextPort = 8080` (`:37`), the platform's own default binding.
  - `ConfigureEndpointsWithHealthProbe(defaultProtocols, redeclareCleartextEndpoint = true, cleartextPort = DefaultCleartextPort)` (`:77`, inside an `extension(WebApplicationBuilder builder)` block at `:39`): null-guards the builder (`:82`), computes the listener plan up front (`:84-88`), then inside `builder.WebHost.ConfigureKestrel` (`:90`) sets `kestrel.ConfigureEndpointDefaults(endpoint => endpoint.Protocols = defaultProtocols)` (`:92`) and declares each planned listener with `kestrel.ListenAnyIP(...)` (`:94-97`).
  - The two deployed profiles are the same call with different arguments, and the doc comment (`:48-60`) spells both out. A REST/gRPC service passes `HttpProtocols.Http2` and keeps `redeclareCleartextEndpoint` at its default, because an explicit `Listen` call **overrides** the container's `ASPNETCORE_HTTP_PORTS` default binding, so the main h2c endpoint has to be re-declared next to the probe port or it silently disappears. A host whose endpoints come from configuration (for example a SignalR host running an `Http1AndHttp2` endpoint for the WebSocket upgrade handshake plus an Http2-only gRPC endpoint, both from `appsettings.json`) passes `HttpProtocols.Http1AndHttp2` and `redeclareCleartextEndpoint: false`, so the probe listener is strictly additive and nothing re-binds a port the configuration already owns.
  - `BuildListenerPlan(configuration, defaultProtocols, redeclareCleartextEndpoint, cleartextPort)` (`:113`, `internal static`) is the pure decision function and the only place the branching lives. `configuration.GetValue<int?>(HealthProbePortConfigKey) is not int probePort` returns an empty plan (`:119-122`), which is the local and test case: endpoint defaults alone, Aspire's dynamic ports intact. Otherwise it returns either two specs (`[new KestrelListenerSpec(cleartextPort, defaultProtocols), new KestrelListenerSpec(probePort, HttpProtocols.Http1)]`) or just the probe spec, depending on `redeclareCleartextEndpoint` (`:124-126`). The probe listener is **always** `HttpProtocols.Http1`, whatever the defaults are, which is the entire point.
  - Failure behavior is deliberate and documented on the method (`:72-76`): a probe port that is not an integer makes `GetValue<int?>` throw `InvalidOperationException` at startup, because "a mistyped probe port that silently produced no listener would leave the platform probing a closed port and the revision would never come up". A blank value, by contrast, is treated as absent.
- **Why it's built this way**: The decision is separated from the binding so it can be asserted as data (see [KestrelListenerSpec](#kestrellistenerspec)). The probe port is configuration-gated rather than always-on so local and test runs keep Aspire's dynamic ports. Fail-fast on a bad value rather than fail-quiet follows the same contract as **[ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)**: a misconfiguration that would produce a silently unprobeable revision is worth a startup crash. And the helper lives in the shared framework package rather than in each service, which is what let seven service hosts across two apps collapse onto one implementation.
- **Where it's used**: All four ADC services, three on the h2c profile (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:81`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:85`, `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:68`) and Notification on the mixed profile (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:71`, `HttpProtocols.Http1AndHttp2, redeclareCleartextEndpoint: false`); plus all three Store services, two on h2c (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:65`, `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:58`) and Sales on the mixed profile (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:76`). The port is supplied by the Container Apps Bicep: `HealthProbe__Port` is `8081` for the three ADC REST/gRPC services (`MMCA.ADC/infra/main.bicep:1076`, `:1267`, `:1387`) and `8082` for Notification (`:1530`), and `8081` for the two Http2-only Store services (`MMCA.Store/infra/main.bicep:1064` Identity, `:1164` Catalog). Covered by [KestrelEndpointExtensionsTests](group-27-testing-infrastructure.md#kestrelendpointextensionstests), whose seven cases pin the empty-plan, blank-value, fail-fast, both-profile, always-Http1, and custom-cleartext-port behaviors.
- **Caveats / not-in-source**: Store's Sales app sets no `HealthProbe__Port` in `MMCA.Store/infra/main.bicep` (the only two entries are the Identity and Catalog ones above), so its plan is empty and its configured `Http1AndHttp2` default endpoint answers the probes directly. ADC's Notification service is on the same mixed profile yet *is* given a probe port (`:1530`); source does not state why the two mixed-profile hosts differ.

---

### Extensions

> MMCA.Common.Aspire · `MMCA.Common.Aspire` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:28` · Level 2 · class (static)

> Disambiguation: this is the **framework** (Common.Aspire) `Extensions`, the canonical service-defaults bootstrap consumed by every running service, including all four ADC services and all three Store services (neither app ships a local `ServiceDefaults` project). The other class named `Extensions` in this chapter is the [Common.Aspire.Hosting `Extensions`](#extensions), the AppHost-side broker / JWKS / data-source wiring.

- **What it is**: The shared Aspire service-defaults bootstrap: `AddServiceDefaults()`, `AddWarmupReadiness()`, `ConfigureOpenTelemetry()`, `AddDefaultHealthChecks()`, `AddInfrastructureHealthChecks()`, `AddWarmupTask<T>()`, and `MapDefaultEndpoints()`. It configures OpenTelemetry (logs, metrics, tracing), health checks (`/health`, `/alive`, `/health/ready`), service discovery, the warm-up readiness pipeline, and a Polly resilience pipeline plus a FinOps-tuned `SocketsHttpHandler` for every outbound `HttpClient`.
- **Depends on**: [IWarmupTask](#iwarmuptask), [OpenIdConnectMetadataWarmupTask](#openidconnectmetadatawarmuptask), [WarmupHostedService](#warmuphostedservice), [WarmupReadinessGate](#warmupreadinessgate), [WarmupReadinessHealthCheck](#warmupreadinesshealthcheck), [HealthCheckTags](#healthchecktags), [OutboxPollFilterProcessor](#outboxpollfilterprocessor), and [HttpResilienceDefaults](#httpresiliencedefaults); plus Azure Monitor, OpenTelemetry, Polly / `Microsoft.Extensions.Http.Resilience`, and the AspNetCore health-check packages (NuGet).
- **Concept introduced, Aspire service defaults as a shared cross-cutting bootstrap.** `[Rubric §13, Observability]` (centralised OpenTelemetry plus health endpoints; it registers the `MMCA.Common.Outbox`, `MMCA.Common.Cqrs`, `MMCA.Common.Idempotency`, and `MMCA.Common.Scheduler` meters and the `MMCA.Common.Outbox` trace source by literal name, and installs `OutboxPollFilterProcessor` to drop noisy idle-poll spans before export). `[Rubric §29, Resilience]` (Polly on every outbound client, [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)). `[Rubric §31, Cost Efficiency / FinOps]` (the `SocketsHttpHandler` tuning at `Extensions.cs:78-86`, with its rationale comment at `:67-77`, is the codebase's clearest FinOps decision: `PooledConnectionLifetime` picks up ACA replica DNS rollover, `PooledConnectionIdleTimeout` avoids repeated TLS handshakes, and socket keep-alive pings keep TCP alive **without counting as ACA user traffic**, so the replica stays on idle-vCPU billing, roughly 8x cheaper than active). `[Rubric §10, Cross-Cutting Concerns]` (one call, one baseline, every host). The telemetry half of this is **[ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html)**; the warm-up half is **[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)**.
- **Walkthrough**:
  - `AddServiceDefaults<TBuilder>()` (`Extensions.cs:39`, in a generic `extension<TBuilder>(TBuilder builder) where TBuilder : IHostApplicationBuilder` block at `:30-31`, so it works for a web host or a worker): calls `ConfigureOpenTelemetry` then `AddDefaultHealthChecks` then `AddWarmupReadiness` then `AddServiceDiscovery` (`:41-44`), then `ConfigureHttpClientDefaults` (`:48`), which affects **every** `HttpClient` registered downstream (typed clients, named clients, the YARP forwarder). Inside it, `AddStandardResilienceHandler` pulls all four values from [HttpResilienceDefaults](#httpresiliencedefaults) (`:58-64`), `http.AddServiceDiscovery()` (`:65`) lets clients resolve logical service names, and `ConfigurePrimaryHttpMessageHandler` installs the tuned `SocketsHttpHandler` (`:78-86`) including `KeepAlivePingPolicy.WithActiveRequests` and `EnableMultipleHttp2Connections = true` (`:84-85`, so one multiplexed HTTP/2 connection cannot become a bottleneck). The comment at `:50-57` is worth reading for the retry-budget reasoning: exactly **one** retry per hop, because the UI service base classes own user-facing retries and stacking full budgets at every hop previously multiplied a backend brownout into up to sixteen gateway hits per user action.
  - `AddWarmupReadiness()` (`Extensions.cs:101`): registers the singleton [WarmupReadinessGate](#warmupreadinessgate) (`:103`), the [WarmupHostedService](#warmuphostedservice) runner (`:104`), the built-in [OpenIdConnectMetadataWarmupTask](#openidconnectmetadatawarmuptask) (`:106`), and the [WarmupReadinessHealthCheck](#warmupreadinesshealthcheck) as the `"warmup"` check tagged `HealthCheckTags.Ready` (`:108-109`). `AddWarmupTask<TTask>()` (`:308`, in an `extension(IServiceCollection services)` block at `:299`) lets a consumer add service-specific warm-ups by registering `AddSingleton<IWarmupTask, TTask>()` (`:311`).
  - `ConfigureOpenTelemetry()` (`Extensions.cs:121`): logging with `IncludeFormattedMessage` and `IncludeScopes` (`:125-126`); metrics always add ASP.NET Core instrumentation (`:132`), then add `HttpClient` (`:143`) and .NET runtime (`:152`) instrumentation **only when their cost knobs are not set** (`:141`, `:150`), and subscribe the four MMCA meters by literal name (`:160-163`, with the comment at `:155-159` naming what each carries; the `MMCA.Common.Scheduler` meter is inert in a host that never enables `Scheduler:Enabled`). Tracing adds the application's own source plus `MMCA.Common.Outbox` (`:167-168`), ASP.NET Core and `HttpClient` instrumentation (`:169-170`), and `.AddProcessor(new Telemetry.OutboxPollFilterProcessor())` (`:177`), which the comment above it (`:172-176`) requires to be registered before the exporters so its `OnEnd` clears `Recorded` first. When `TryGetTraceSampleRatio` succeeds it installs `new ParentBasedSampler(new TraceIdRatioBasedSampler(ratio))` (`:184-185`), parent-based so a sampled-in request keeps its whole trace intact across service boundaries. Finally it calls the private `AddOpenTelemetryExporters` (`:188`).
  - `TryGetTraceSampleRatio(configuration, out ratio)` (`Extensions.cs:366`, `internal static`): reads the optional `Telemetry:TracesSampleRatio` knob and returns `true` only for a value that parses invariantly and falls in the open interval (0,1); absent, unparseable, or out-of-range input returns `false` and leaves `ratio` at `1.0` (`:368-378`). Sampling therefore fails toward keeping everything, so a typo can never silently drop *all* telemetry.
  - `IsInstrumentationDisabled(configuration, configKey)` (`Extensions.cs:389`, `internal static`): the same fail-safe shape for the two metric-family knobs `Telemetry:DisableHttpClientMetrics` and `Telemetry:DisableRuntimeMetrics`, expressed as one line, `bool.TryParse(configuration[configKey], out var disabled) && disabled` (`:390`). It returns `true` (drop the family) only when the value parses as boolean `true`; absent, blank, or unparseable keeps the instrumentation. The comments at `:134-140` and `:146-149` name why those two families are the targets: they are the highest-volume AppMetrics contributors on a low-traffic multi-service deployment and carry no end-user-visible signal.
  - `AddDefaultHealthChecks()` (`Extensions.cs:199`) registers a `"self"` check tagged `HealthCheckTags.Live` (`:202`). `AddInfrastructureHealthChecks(requireSqlServer = false)` (`:230`) conditionally adds SQL Server (`:240-243`), Redis (`:245-249`), and RabbitMQ (`:251-261`) checks only when their connection strings are present, so the same binary runs unchanged where those containers are absent. The `requireSqlServer` flag throws at startup when the SQL connection string is missing (`:235-238`); the asymmetry is deliberate and documented (`:213-224`): Redis and RabbitMQ are optional per host, but a service that cannot resolve its own database is misconfigured and must not report healthy. Redis (`:248`) and RabbitMQ (`:260`) get the `Optional` tag; SQL Server deliberately does not.
  - `MapDefaultEndpoints()` (`Extensions.cs:329`, in an `extension(WebApplication app)` block at `:316`): `/health` maps every check (`:331`); `/alive` filters to `HealthCheckTags.Live` (`:335-338`) so a downstream SQL outage cannot get the container restarted; `/health/ready` maps everything tagged neither `Live` nor `Optional` (`:351-354`). The comment above it (`:340-350`) is the canonical explanation of why `optional` is excluded.
  - `AddOpenTelemetryExporters()` (`Extensions.cs:279`, private): enables **OTLP** when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`:281-287`, the local Aspire dashboard sets it) and **Azure Monitor** when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set (`:289-295`, set by the Container Apps Bicep). Both can be active simultaneously.
- **Why it's built this way**: One bootstrap means a baseline change (a new meter, a tighter timeout, the poll filter) propagates to every consumer in lockstep. There is a single framework copy and no per-app variants: neither ADC nor Store ships an app-local `ServiceDefaults` project, so the warm-up gate, the MMCA meters, the poll filter, and the Azure Monitor exporter branch are uniform across every service. Every cost knob defaults to the expensive-but-safe setting, which is the deliberate bias recorded in [ADR-041](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html): a cost surprise is recoverable, a silent telemetry blackout during an incident is not. The class also carries the same scoped `CA1708` suppression as its AppHost sibling (`:24-27`), for the same multi-`extension`-block analyzer false positive.
- **Where it's used**: `builder.AddServiceDefaults()` early in each framework-consuming service host's `Program.cs` (for example `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:31`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:115`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:30`), with `app.MapDefaultEndpoints()` after `Build()` (ADC Gateway `Program.cs:52`, Conference `Program.cs:372`, ADC UI `Program.cs:119`). The two internal cost-knob helpers are covered by [TracesSampleRatioTests](group-27-testing-infrastructure.md#tracessampleratiotests) and [MetricsInstrumentationToggleTests](group-27-testing-infrastructure.md#metricsinstrumentationtoggletests); the conditional infrastructure checks by [InfrastructureHealthChecksTests](group-27-testing-infrastructure.md#infrastructurehealthcheckstests).

---

### SecurityHeadersMiddleware

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Security` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:94` · Level 2 · class (sealed)

- **What it is**: ASP.NET Core middleware that adds hardened security response headers to every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS (outside Development), and a CSP resolved from [ICspPolicyProvider](#icsppolicyprovider).
- **Depends on**: [SecurityHeadersSettings](#securityheaderssettings), [ICspPolicyProvider](#icsppolicyprovider), [CspPolicy](#csppolicy); `RequestDelegate`, `IWebHostEnvironment`, `IOptions<T>` (ASP.NET Core / BCL).
- **Concept introduced, centralized security headers as shared middleware.** `[Rubric §11, Security]` (`X-Frame-Options`, CSP, HSTS, `Referrer-Policy`, `Permissions-Policy`, all defence-in-depth), `[Rubric §10, Cross-Cutting Concerns]` (the doc comment at `SecurityHeaders.cs:91-92` states it "Centralizes what each client-facing host previously hand-rolled"), `[Rubric §26, Front-End Security]` (CSP restricts content sources, reducing XSS impact on Blazor pages).
- **Walkthrough**: Four readonly fields (`SecurityHeaders.cs:96-99`). The constructor (`:102`) null-guards `options` and `environment` (`:108-109`), captures the next delegate, the settings snapshot, and the CSP provider (`:110-112`), and computes `_enableHsts = options.Value.EnableHsts && !environment.IsDevelopment()` (`:113`) so HSTS is never emitted in development, where it would pin `localhost` to HTTPS in the browser for a year. `InvokeAsync` (`:117`) null-guards the context (`:119`), takes the response header collection once (`:121`), and sets `XContentTypeOptions = "nosniff"` (`:122`), `XFrameOptions` (`:123`), `Referrer-Policy` (`:124`), and `Permissions-Policy` (`:125`); it conditionally sets `StrictTransportSecurity` (`:127-130`). It then asks the provider for a [CspPolicy](#csppolicy) (`:132`) and, when non-null, writes `ContentSecurityPolicy` if `Enforce` else `ContentSecurityPolicyReportOnly` (`:133-143`). Finally it awaits `_next(context)` (`:145`). Note the ordering: headers are written **before** the rest of the pipeline runs, which is what makes them survive on responses produced further down (including forwarded YARP responses).
- **Why it's built this way**: A sealed conventional middleware (constructor plus `InvokeAsync`), not an `IMiddleware`, so it is a singleton per pipeline with zero per-request resolution. Resolving CSP through the injected `ICspPolicyProvider` rather than reading settings directly is what makes per-host dynamic policies possible while every other header stays uniform. Computing `_enableHsts` once in the constructor avoids re-checking the environment on every request. This single middleware is **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)**'s "one hardened default, defined once" decision: centralising the header set removes the per-host drift between Gateway and UI (and between apps) that came from each edge host hand-rolling its own headers, and makes a new edge host secure by default.
- **Where it's used**: Added to the pipeline by [SecurityHeadersExtensions](#securityheadersextensions) `UseCommonSecurityHeaders` (`SecurityHeaders.cs:192`). Per [ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html) it is wired at both edges of both apps: `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:50`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:105`, `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:72`, and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:145`. Covered by [SecurityHeadersMiddlewareTests](group-27-testing-infrastructure.md#securityheadersmiddlewaretests) in `MMCA.Common.Aspire.Tests`, and by the shared per-host [SecurityHeadersTestsBase](group-27-testing-infrastructure.md#securityheaderstestsbase) that both Gateway test projects subclass.

---

### StaticCspPolicyProvider

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Security` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:72` · Level 2 · class (sealed, internal)

- **What it is**: The default [ICspPolicyProvider](#icsppolicyprovider): it returns the static CSP configured in [SecurityHeadersSettings](#securityheaderssettings), or `null` when none is configured.
- **Depends on**: [ICspPolicyProvider](#icsppolicyprovider) (implements), [SecurityHeadersSettings](#securityheaderssettings) (via `IOptions<T>`), [CspPolicy](#csppolicy) (returns).
- **Concept introduced**: Cross-reference [ICspPolicyProvider](#icsppolicyprovider) for the provider extension point. `[Rubric §11, Security]`: this is the safe fall-back, so a host that registers nothing still gets the hardened static baseline rather than no CSP at all.
- **Walkthrough**: One readonly `CspPolicy? _policy` field (`SecurityHeaders.cs:74`). The constructor (`:76`) null-guards `options` (`:78`), reads `options.Value.ContentSecurityPolicy` (`:79`), and sets `_policy` to `null` when that string is null or whitespace, otherwise to a new [CspPolicy](#csppolicy) capturing the string and the `EnforceContentSecurityPolicy` flag (`:80-82`). `GetPolicy(HttpContext context)` (`:85`) simply returns the cached `_policy`, ignoring the request context, which is exactly what "static" means here.
- **Why it's built this way**: `internal sealed`, since it is the framework's own default and is registered by `TryAddSingleton` so a custom provider registered first by a Blazor host wins. Computing the policy **once in the constructor** rather than per request makes `GetPolicy` allocation-free on the hot path, which matters because it runs on every single response. Per **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)** this static baseline is the *right complete policy* for JSON / WebSocket / static hosts (API, Gateway) and a deliberately safe-but-partial fallback for an HTML host that forgot to register a fuller provider.
- **Where it's used**: Registered by [SecurityHeadersExtensions](#securityheadersextensions) `AddCommonSecurityHeaders` via `TryAddSingleton` (`SecurityHeaders.cs:181`); resolved per request by [SecurityHeadersMiddleware](#securityheadersmiddleware) (`:132`). Its baseline output is asserted by [SecurityHeadersMiddlewareTests](group-27-testing-infrastructure.md#securityheadersmiddlewaretests).

---

### SecurityHeadersExtensions

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Security` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:154` · Level 3 · class (static)

- **What it is**: The registration and pipeline extensions for the common security-headers middleware: `AddCommonSecurityHeaders` (DI) and `UseCommonSecurityHeaders` (pipeline).
- **Depends on**: [SecurityHeadersSettings](#securityheaderssettings), [ICspPolicyProvider](#icsppolicyprovider), [StaticCspPolicyProvider](#staticcsppolicyprovider), [SecurityHeadersMiddleware](#securityheadersmiddleware).
- **Concept reinforced, middleware registration via extension methods.** `[Rubric §11, Security]` (assesses HTTP security headers) and `[Rubric §26, Front-End Security]` (CSP defending the Blazor front end). The two-call shape, `AddCommonSecurityHeaders` during service registration and `UseCommonSecurityHeaders` in the pipeline, is the idiomatic ASP.NET Core split, expressed here with two `extension(T)` blocks in one static class (`SecurityHeaders.cs:156`, `:186`), which is also why the class carries the scoped `CA1708` suppression (`:150-153`).
- **Walkthrough**:
  - `AddCommonSecurityHeaders(configuration = null, configure = null)` (`SecurityHeaders.cs:164`): null-guards the receiver (`:168`), builds an `AddOptions<SecurityHeadersSettings>()` (`:170`), binds the `"SecurityHeaders"` configuration section when `configuration` is supplied (`:171-174`), applies the optional `configure` delegate when supplied (`:176-179`), then calls **`TryAddSingleton<ICspPolicyProvider, StaticCspPolicyProvider>()`** (`:181`). The `TryAdd` is the key detail: a host that registered a custom provider *before* this call keeps it; otherwise the static default is used. Both parameters are optional, so a host can take the hardened defaults with a bare `AddCommonSecurityHeaders()`.
  - `UseCommonSecurityHeaders()` (`:189`): null-guards the app (`:191`) and returns `app.UseMiddleware<SecurityHeadersMiddleware>()` (`:192`). Call it early in the pipeline so headers land on every response, including forwarded ones (the ADC Gateway puts it ahead of `MapDefaultEndpoints` and `UseCors`, `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:50,52,53`).
- **Why it's built this way**: A static class with `extension(T)` blocks is the codebase's standard DI/registration idiom (see [primer, C# `extension(T)` types](00-primer.md#c-extensiont-types-read-this-once)). The `TryAddSingleton` ordering contract is what makes the per-consumer CSP override work without a configuration flag or a builder API. **[ADR-023](https://ivanball.github.io/docs/adr/023-security-response-headers.html)** documents the matching foot-gun: because the default provider is `TryAdd`-registered, a host must register its custom `ICspPolicyProvider` *before* calling `AddCommonSecurityHeaders`, or the static default silently wins.
- **Where it's used**: Called by each client-facing host: `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:37`, `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:100`, `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:53`, `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:140`. The two UI hosts call `AddCommonBlazorCsp()` first (ADC `Program.cs:99`, Store `Program.cs:139`, each with the ordering comment right above it at ADC `:95-98` and Store `:134-138`) so [BlazorCspPolicyProvider](group-15-common-ui-framework.md#blazorcsppolicyprovider) wins over the [StaticCspPolicyProvider](#staticcsppolicyprovider) default.

---

### HttpResilienceDefaults

> MMCA.Common.Shared · `MMCA.Common.Shared.Resilience` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:10` · Level 0 · class (static)

- **What it is**: eight `static` properties that are the single source of truth for the outbound-HTTP
  resilience window (attempt timeout, breaker window, total timeout, retry count) and for the
  `SocketsHttpHandler` connection hygiene (pool lifetime, idle timeout, keep-alive ping delay and
  timeout). Two independently-packaged transports read them, so the HTTP path and the gRPC path
  cannot drift apart (`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:10-44`).
- **Depends on**: nothing first-party and nothing outside the BCL (`TimeSpan`, `int`). All the arrows
  point *at* it: the Common.Aspire [`Extensions`](#extensions-1) service-defaults bootstrap
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:60-63,80-83`) and the gRPC typed-client
  [`DependencyInjection`](group-13-grpc-contracts.md#dependencyinjection)
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:92-95,106-109`).
- **Concept introduced, the shared-constant class as a drift gate.** Most of this chapter is about
  behavior; this type is about *agreement*. Two packages that ship separately have to configure the
  same Polly and socket numbers, and nothing in the type system makes them match, so the codebase
  turns the numbers into a third artifact both are obliged to read.
  `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation under partial
  failure, and these four Polly values *are* the shape of that degradation: how long one attempt gets,
  how wide a window the breaker judges failures over, how long the caller waits in total, and how many
  times a single hop retries.
  [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) is the
  governing decision, and its first clause is exactly this posture: resilience is a framework
  invariant, not a per-call choice.
  `[Rubric §12, Performance & Scalability]` shows up in the retry arithmetic below, because a retry
  policy is a load multiplier and multipliers compound per hop rather than adding.
  `[Rubric §31, Cost/FinOps]` is why the socket-handler half is here at all instead of being left at
  the BCL defaults: those four values are tuned for an idle Azure Container Apps replica
  (`HttpResilienceDefaults.cs:30-43`). And `[Rubric §16, Maintainability]` is the file's entire
  reason to exist: one edit moves both transports, and the alternative was already tried and failed
  (the class doc comment records the drift it was created to end,
  `HttpResilienceDefaults.cs:3-9`).
- **Walkthrough**: eight expression-bodied `static` properties in two conceptual blocks.
  - *The Polly window*, the values handed to `AddStandardResilienceHandler`:
    - `AttemptTimeout` = 30 s (`HttpResilienceDefaults.cs:13`): the budget for one individual HTTP
      attempt.
    - `CircuitBreakerSamplingDuration` = 60 s (`HttpResilienceDefaults.cs:16`): the rolling window the
      breaker computes its failure ratio over, so a burst is judged against a minute of traffic rather
      than against the last handful of calls.
    - `TotalRequestTimeout` = 90 s (`HttpResilienceDefaults.cs:19`): the ceiling on the whole logical
      call including retries. The three numbers are chosen to nest: a 30 s attempt inside a 90 s total
      leaves room for the initial attempt, the one retry, and the back-off between them.
    - `MaxRetryAttempts` = 1 (`HttpResilienceDefaults.cs:28`): retries *beyond* the initial attempt,
      deliberately one, and carrying the longest comment in the file
      (`HttpResilienceDefaults.cs:21-27`).
  - *Why one retry, the part worth internalizing.* The Blazor UI already owns user-facing retries:
    [`AuthenticatedServiceBase`](group-15-common-ui-framework.md#authenticatedservicebase) holds a
    static Polly policy that retries 3 times with exponential back-off (2 s, 4 s, 8 s) plus jitter on
    `HttpRequestException` or a retryable response status
    (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:21-29`),
    which is up to 4 attempts per user action. If every hop underneath also spent a full retry budget,
    the attempts would multiply instead of adding: the call-site comment records the previous worst
    case as 4 outer x 4 inner = 16 gateway hits for one click
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:55-57`). That is a retry storm, the
    failure mode where the load a struggling backend receives goes *up* precisely because it is
    failing. One transient-fault retry per hop still absorbs a dropped connection while bounding the
    multiplier.
  - *The socket-handler block*, the values handed to `SocketsHttpHandler`:
    - `PooledConnectionLifetime` = 10 min (`HttpResilienceDefaults.cs:34`): a pooled connection is
      recycled on this cadence, which forces DNS to be re-resolved, so an ACA replica rollover is
      picked up without an app restart.
    - `PooledConnectionIdleTimeout` = 5 min (`HttpResilienceDefaults.cs:37`): idle connections stay
      pooled that long, so low-traffic inter-service calls skip the TCP plus TLS handshake.
    - `KeepAlivePingDelay` = 60 s (`HttpResilienceDefaults.cs:40`) and `KeepAlivePingTimeout` = 30 s
      (`HttpResilienceDefaults.cs:43`): the HTTP/2 socket-level keep-alive ping interval and the
      timeout waiting for its acknowledgement.
- **Why it's built this way**:
  - *The layer rules chose the address.* `MMCA.Common.Aspire` (Hosting) and `MMCA.Common.Grpc`
    (Presentation) sit in different layers and neither may reference the other; `Shared` is the one
    layer both are allowed to depend on, which the class doc states outright
    (`HttpResilienceDefaults.cs:6-7`). Both project files carry exactly that single `ProjectReference`,
    and the Aspire one names this type in a comment as the reason it is there at all
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/MMCA.Common.Aspire.csproj:47-49`,
    `MMCA.Common/Source/Presentation/MMCA.Common.Grpc/MMCA.Common.Grpc.csproj:21`).
  - *It is a remediation, not a premature abstraction.* The hand-mirrored copies had already diverged:
    the gRPC side had fallen back to the 10 s/30 s library defaults while the HTTP side ran the tuned
    30 s/90 s (`HttpResilienceDefaults.cs:7-8`), and the gRPC call site repeats the finding where the
    mirror lives (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:99-103`).
  - *Properties, not fields or constants.* `TimeSpan` cannot be a `const` at all, and an
    expression-bodied `static` property is evaluated at call time rather than inlined into the
    consuming assembly the way a `const int` is at compile time. The flat one-line-per-value shape also
    keeps the file readable as a ledger, with each number's justification sitting on the member it
    justifies rather than in a distant comment.
- **Where it's used**: three call sites, two of which read it.
  - `AddServiceDefaults` routes it through `ConfigureHttpClientDefaults`, so *every* `HttpClient` in the
    process inherits it (typed clients, named clients, the YARP forwarder, per the comment at
    `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:46-47`): the four Polly values go into
    `AddStandardResilienceHandler` (`Extensions.cs:58-64`) and the four socket values into
    `ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { ... })` (`Extensions.cs:78-86`).
  - `AddTypedGrpcClient<TClient>(serviceName)` re-applies **both** blocks
    (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:89-97` for the socket
    handler, `:104-110` for the resilience options). It has to: forcing HTTP/2 means overriding the
    primary handler, which bypasses the wrapper the global `ConfigureHttpClientDefaults` installed, so
    the connection-hygiene values must be restated from the same source of truth (the reasoning is
    spelled out at `DependencyInjection.cs:80-88`). That same method wires the
    [`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor).
  - Not a reader: `AddTypedServiceClient<TInterface, TImplementation>` in Infrastructure
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:478`) calls
    `builder.AddStandardResilienceHandler()` with no options delegate (`DependencyInjection.cs:493`),
    so that registration does not itself consume these constants, even though its own doc comment
    describes its resilience as "matching the standard handler from `AddServiceDefaults`"
    (`DependencyInjection.cs:463-464`). Not determinable from source: how that second standard handler
    and the global `ConfigureHttpClientDefaults` pipeline compose into one effective policy on that
    client at runtime.
- **Caveats / not-in-source**:
  - *No test pins the numbers.* The ADR-009 fitness function
    [`ResilienceHandlerTests`](group-27-testing-infrastructure.md#resiliencehandlertests) asserts only
    that `AddTypedGrpcClient` *registers* a standard resilience handler at all
    (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/ResilienceHandlerTests.cs:29-32`), and the
    ADR says so explicitly: parameter tuning remains a review concern, with runtime breaker behavior
    covered separately by
    [`ResilienceCircuitBreakerFaultInjectionTests`](group-27-testing-infrastructure.md#resiliencecircuitbreakerfaultinjectiontests),
    which drives its own 1 s/5 s values rather than these
    (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/ResilienceCircuitBreakerFaultInjectionTests.cs:32,37`).
    A call site that quietly stopped reading a property would still compile and still pass.
  - *Two handler settings are still duplicated literals* rather than centralised here:
    `KeepAlivePingPolicy = HttpKeepAlivePingPolicy.WithActiveRequests` and
    `EnableMultipleHttp2Connections = true` (`Extensions.cs:84-85` and
    `DependencyInjection.cs:91,96`). The first one matters when reading the ping values: under
    `WithActiveRequests` the pings apply to connections that have outstanding requests, so what holds a
    genuinely idle pooled connection open is `PooledConnectionIdleTimeout`, not `KeepAlivePingDelay`.
  - *The billing claim is a platform statement.* "Does not count as user traffic to the ACA platform"
    (`HttpResilienceDefaults.cs:39`), expanded at the call site to idle-vCPU billing roughly 8x cheaper
    than active (`Extensions.cs:72-75`), describes how Azure Container Apps meters a replica. Not
    determinable from source: the code can set a ping interval, it cannot demonstrate how the platform
    bills it.

---

### IWarmupTask

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Warmup` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/IWarmupTask.cs:9` · Level 0 · interface

- **What it is**: a unit of startup work executed once after the host starts, to eliminate lazy
  initialisation from the first user request: cache priming, opening connection pools, pre-fetching
  discovery documents.
- **Depends on**: nothing. Implemented by the built-in
  [OpenIdConnectMetadataWarmupTask](#openidconnectmetadatawarmuptask) and by every host task derived
  from [SelfHttpWarmupTaskBase](#selfhttpwarmuptaskbase); run by
  [WarmupHostedService](#warmuphostedservice); completion published through
  [WarmupReadinessGate](#warmupreadinessgate).
- **Concept introduced, startup warm-up.** `[Rubric §29, Resilience & Business Continuity]`,
  `[Rubric §12, Performance & Scalability]`. §29 assesses proactive elimination of cold-start failure
  modes. After a deployment, or after an idle Azure Container Apps replica is scaled back up, the first
  requests hit cold paths: EF model build, connection-pool establishment, JIT, OIDC discovery. Warm-up
  tasks run these eagerly. Per the doc comment (`IWarmupTask.cs:3-8`), tasks run **in parallel** after
  host start, and **failures are logged but do not prevent the readiness gate from opening**, because a
  transient dependency outage must not wedge a replica permanently out of rotation.
- **Walkthrough**: `string Name { get; }` (`IWarmupTask.cs:12`), a stable identifier used in the
  runner's structured logs and, per the doc comment, in metrics. `Task ExecuteAsync(CancellationToken
  cancellationToken)` (`:15`) performs the work; the token is the host's `stoppingToken`, passed
  through by the runner.
- **Why it's built this way**: an interface, not an abstract class, for maximum implementation freedom;
  the one place the framework does supply a base class is the self-HTTP shape
  ([SelfHttpWarmupTaskBase](#selfhttpwarmuptaskbase)), where the mechanics rather than the contract are
  the shared risk. The non-fatal-failure contract is enforced by the *runner*
  ([WarmupHostedService](#warmuphostedservice)), not by the interface, so implementations stay simple
  and never have to think about their own failure semantics.
  **[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)** records the
  decision.
- **Where it's used**: discovered via DI. `AddWarmupReadiness` registers the built-in
  [OpenIdConnectMetadataWarmupTask](#openidconnectmetadatawarmuptask)
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:106`), and a host adds its own with
  `AddWarmupTask<TTask>()` (`Extensions.cs:306`, whose body is a single
  `services.AddSingleton<IWarmupTask, TTask>()` at `:309`). The whole `IEnumerable<IWarmupTask>` is
  injected into `WarmupHostedService` (`Warmup/WarmupHostedService.cs:29`).
- **Caveats / not-in-source**: the interface itself carries no timeout, no ordering, and no retry. All
  three are the runner's business: tasks run concurrently in whatever order `Task.WhenAll` schedules
  them (`WarmupHostedService.cs:53-54`), each under a 120-second ceiling (`:42`, applied at `:69`), and
  a failed task is never retried by the subsystem, only re-paid lazily on the first real request.

---

### WarmupReadinessGate

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Warmup` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/WarmupReadinessGate.cs:10` · Level 0 · class (sealed)

- **What it is**: a thread-safe one-shot flag that [WarmupHostedService](#warmuphostedservice) flips to
  `true` exactly once when every [IWarmupTask](#iwarmuptask) has finished, failed, or timed out, gating
  the `/health/ready` endpoint.
- **Depends on**: nothing first-party. Read by
  [WarmupReadinessHealthCheck](#warmupreadinesshealthcheck), set by
  [WarmupHostedService](#warmuphostedservice). Uses `Volatile` and `Interlocked` (BCL).
- **Concept introduced, the readiness probe.** `[Rubric §29, Resilience]`, `[Rubric §17, DevOps]`,
  `[Rubric §13, Observability]`. Azure Container Apps (and Kubernetes) withhold traffic from a replica
  until its readiness probe returns healthy. The health check reports unhealthy until `IsReady` is
  `true`, so a fresh replica does not receive production traffic until warm-up has had its chance,
  avoiding slow or failed first requests
  ([ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)).
- **Walkthrough**: `private int _isReady` (`WarmupReadinessGate.cs:12`), 0 or 1. Using an `int` with
  `Volatile.Read` and `Interlocked.Exchange` rather than a `bool` plus a lock gives lock-free,
  correctly published reads and writes. `IsReady => Volatile.Read(ref _isReady) == 1` (`:15`): the
  volatile read prevents a CPU from returning a stale cached value, which matters because the writer is
  a background thread and the readers are probe requests on the thread pool.
  `internal void MarkReady() => Interlocked.Exchange(ref _isReady, 1)` (`:18`): idempotent, safe to
  call twice, and the doc comment says so.
- **Why it's built this way**: sealed, so no subclass can reinterpret readiness. `MarkReady()` is
  `internal` (`:18`), so no external caller can prematurely open the gate; only `WarmupHostedService`,
  in the same assembly, may. The type carries no "not ready again" transition on purpose: readiness
  here means "warm-up has run", a startup fact, not a live health signal, and the live signals are the
  separate dependency checks that also sit on `/health/ready`.
- **Where it's used**: registered as a singleton by `AddWarmupReadiness`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:103`); opened in the `finally` of
  `WarmupHostedService.ExecuteAsync` (`Warmup/WarmupHostedService.cs:58`); read by
  `WarmupReadinessHealthCheck.CheckHealthAsync` (`Warmup/WarmupReadinessHealthCheck.cs:14`), which is
  registered as the `"warmup"` check tagged [`HealthCheckTags.Ready`](#healthchecktags)
  (`Extensions.cs:108-109`) and surfaced at `/health/ready` (`Extensions.cs:349-352`). Covered by
  [WarmupReadinessGateTests](group-27-testing-infrastructure.md#warmupreadinessgatetests).

---

### OpenIdConnectMetadataWarmupTask

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Warmup` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:21` · Level 1 · class (sealed, internal, partial)

- **What it is**: the one built-in [IWarmupTask](#iwarmuptask). It pre-fetches the OIDC discovery
  document on startup, warming the network path so the first authenticated request does not hit a cold
  connection.
- **Depends on**: [IWarmupTask](#iwarmuptask) (implements); `IHttpClientFactory`, `IConfiguration`, and
  `ILogger<T>` (BCL and DI).
- **Concept introduced**: `[Rubric §29, Resilience & Business Continuity]`. The doc comment
  (`OpenIdConnectMetadataWarmupTask.cs:6-13`) names the failure mode precisely: without warm-up, the
  JWT bearer middleware fetches `{authority}/.well-known/openid-configuration` lazily on the first
  authenticated request, and on a CPU-throttled idle ACA Consumption replica that fetch can stretch
  past the client timeout, the textbook "first request fails, second succeeds" pattern. Pre-fetching
  warms DNS, TCP, TLS, and the `HttpClient` pool. **Honest caveat, stated in the type's own remarks
  (`:14-20`)**: the middleware's `ConfigurationManager` caches discovery state separately, so it
  *still* performs its own fetch on the first request; the intent is that the fetch now runs over a
  warm connection and completes in single-digit milliseconds.
- **Walkthrough**: a primary constructor injects `IHttpClientFactory`, `IConfiguration`, and
  `ILogger<OpenIdConnectMetadataWarmupTask>` (`:21-24`). `Name => "OpenIdConnectMetadata"` (`:26`).
  `ExecuteAsync` (`:28`) reads `Authentication:JwtBearer:Authority` (`:30`) and returns immediately
  when it is unset (`:31-34`), so a non-authenticating host pays nothing. It then builds the discovery
  URI by trimming a trailing slash and appending `/.well-known/openid-configuration` (`:36-39`),
  logging a warning and returning if the result is not a valid absolute URI (`:41-42`). Finally it
  creates a client from the factory under the task type's own name (`:45`) and issues a `GET` (`:46`),
  logging the status code (`:48`). Both log lines are source-generated `[LoggerMessage]` partial
  methods (`:51-57`), EventId 1 at Warning for the invalid authority and EventId 2 at Information for
  the fetch.
- **Why it's built this way**: `internal sealed partial`, internal because it is wired by the
  framework's `AddWarmupReadiness` rather than by consumers, `partial` for the `[LoggerMessage]` source
  generator, `sealed` by default policy. Reusing `IHttpClientFactory` is the load-bearing detail: the
  warm-up exercises exactly the connection pool (and the tuned `SocketsHttpHandler` from
  [HttpResilienceDefaults](#httpresiliencedefaults)) that the real auth path will use, so the warmth
  transfers. It reads the same configuration key the AppHost's `WithJwksDiscovery` injects, which is
  what makes the task self-configuring rather than needing its own settings class.
  **[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)** records both the
  decision and the middleware-cache caveat.
- **Where it's used**: registered as an `IWarmupTask` singleton by `AddWarmupReadiness`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:106`), so every host that calls
  `AddServiceDefaults` gets it; executed in parallel with any host-registered tasks by
  [WarmupHostedService](#warmuphostedservice).
- **Caveats / not-in-source**: the HTTP call passes no explicit timeout of its own. It is bounded twice
  from outside: by the shared Polly total-request timeout that `ConfigureHttpClientDefaults` applies to
  every factory client (`Extensions.cs:62`, 90 s from
  [HttpResilienceDefaults](#httpresiliencedefaults)), and by the runner's 120-second per-task ceiling
  (`Warmup/WarmupHostedService.cs:42`). A non-2xx discovery response is logged at Information like any
  other status (`:48`) rather than treated as a failure, so a 404 authority warms the connection and
  reports success.

---

### SelfHttpWarmupTaskBase

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Warmup` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/SelfHttpWarmupTaskBase.cs:28` · Level 1 · class (public, abstract, partial)

- **What it is**: the shared base class for the second family of warm-up tasks: once the server is
  listening, replay a short list of this host's own hot read paths against its own Kestrel endpoint. A
  derived task supplies only a name and the paths; every mechanism (waiting for the server, resolving
  the port, pinning the HTTP version, deciding what counts as failure, keeping failure non-fatal) lives
  here (`SelfHttpWarmupTaskBase.cs:11-22`).
- **Depends on**: [IWarmupTask](#iwarmuptask) (implements). Its five primary-constructor parameters are
  all ASP.NET Core or hosting abstractions: `IServer` plus `IServerAddressesFeature` (the actual bound
  address), `IConfiguration` (the `ASPNETCORE_URLS` fallback), `IHostEnvironment` (the Testing
  short-circuit), `IHostApplicationLifetime` (the `ApplicationStarted` wait), and `ILogger`
  (`:28-33`). It creates its own `SocketsHttpHandler` and `HttpClient` (`:111-117`) rather than taking
  an `IHttpClientFactory`.
- **Concept introduced, self-request warm-up, and the template-method shape.** The built-in OIDC task
  warms one *outbound* connection; this one warms the *inbound* path, which is where the cold-start
  cost of an idle, CPU-throttled replica actually lives: ingress connection, Kestrel, output cache,
  routing, authentication, the controller, EF Core, SQL (`:12-15`). `[Rubric §12, Performance &
  Scalability]` assesses whether the system pays predictable latency under load, and the whole point
  here is to move the first-request JIT and query-plan cost off the first user and onto startup.
  `[Rubric §29, Resilience & Business Continuity]` covers the failure posture: every fault path in this
  class ends in a log line, never in a thrown exception that would reach the runner.
  `[Rubric §2, Design Patterns]` is the shape itself: this is a textbook **template method**, one
  concrete `ExecuteAsync` (`:93`) calling four members a subclass may or must supply (`Name` `:49` and
  `WarmupPaths` `:59` abstract, `RequestVersion` `:70`, `RequestVersionPolicy` `:77`, and
  `RequireSuccessStatusCode` `:90` virtual with defaults). `[Rubric §16, Maintainability]` is why it
  exists as a base class at all: six services across the two apps ran hand-copied versions of this
  logic, and the tests describe those copies as "the behaviors the per-service copies each had to get
  right on their own"
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:21-27`).
- **Walkthrough**, in teaching order.
  - *Two constants.* `public const int DefaultPort = 8080` (`:39`), the containerized default every
    deployed service listens on, used only when nothing else resolves; and
    `private const string TestingEnvironmentName = "Testing"` (`:46`), whose doc comment explains the
    short-circuit below: an integration test boots the host through `WebApplicationFactory`, whose
    in-memory `TestServer` never opens a socket, so a self-HTTP request there could only ever fail
    (`:41-45`).
  - *The extension points.* `Name` (`:49`) and `WarmupPaths` (`:59`) are abstract. The `WarmupPaths`
    doc comment carries the single most important rule for a derived task (`:53-57`): the paths must
    match what real callers issue **character for character in their values**, not just in their shape,
    because an output-cache policy that varies by query string keys the entry on the exact URL, so a
    warmed entry built from different values is an entry nothing ever reads. `RequestVersion` defaults
    to `HttpVersion.Version20` (`:70`) and `RequestVersionPolicy` to
    `HttpVersionPolicy.RequestVersionExact` (`:77`), which together are a **pin, not a preference**:
    the three h2c prior-knowledge hosts serve HTTP/2 only on cleartext, and a silent downgrade to
    HTTP/1.1 would be rejected with a 400 "An HTTP/1.x request was sent to an HTTP/2 only endpoint",
    failing the warm-up on every single startup (`:62-69`). A host with no inbound gRPC server stays
    `Http1AndHttp2` and overrides both members. `RequireSuccessStatusCode` defaults to `true` (`:90`),
    suiting an anonymous read whose response body is what populates the output cache; a protected
    endpoint overrides it to `false`, because an unauthenticated self-request against an `[Authorize]`
    route gets 401 **by design** and that refusal still traverses Kestrel, routing, authentication and
    the middleware pipeline, which is the JIT cost the warm-up exists to pay down (`:80-89`).
  - *`ExecuteAsync(CancellationToken)`* (`:93`). First the Testing short-circuit, which returns before
    anything else and therefore before the server wait (`:95-98`). Then
    `WaitForServerStartedAsync` (`:102`), defined at `:191-199`: it registers a callback on
    `lifetime.ApplicationStarted` that completes a `TaskCompletionSource`
    (`TaskCreationOptions.RunContinuationsAsynchronously`, `:193-196`) and awaits it with
    `.WaitAsync(cancellationToken)` (`:198`). The comment above it states the reason (`:189-190`): the
    warm-up runner is a hosted service that starts *before* Kestrel begins listening, since the web host
    is the last hosted service, so self-requesting immediately would race the listener.
  - *Building the client.* The base address is a `UriBuilder` over `http`, `localhost`, and the port
    from `ResolveWarmupPort` (`:104-109`); the `SocketsHttpHandler` and `HttpClient` are created
    locally with `disposeHandler: false` and both disposed by `using` (`:111-117`), and the client
    carries `DefaultRequestVersion` and `DefaultVersionPolicy` from the two virtuals (`:115-116`).
  - *The replay loop* (`:119-133`): each path is issued as a relative `GET` (`:121-123`). When
    `RequireSuccessStatusCode` is on, `EnsureSuccessStatusCode()` throws on a non-2xx (`:127`) and the
    body is then read to completion (`:131`), which the comment explains is the point of an
    output-cache warm-up: the entry is only worth priming if the whole response was produced and
    transferred (`:129-130`). When it is off, neither the status check nor the body drain happens, so
    the 401-profile task pays only the pipeline traversal. A success logs once for the whole task, with
    the name, the path count, and the base address (`:135`).
  - *The failure boundary* (`:137-146`). An `OperationCanceledException` is rethrown when the token is
    actually cancelled (`:137-140`), so host shutdown is not mistaken for a warm-up failure; every
    other exception is caught under an explicit `#pragma warning disable CA1031` whose comment states
    the policy, "warm-up failures are non-fatal by design: log and fall back to lazy warm-up"
    (`:141-143`), and logged at Warning (`:145`). Note where the `try` starts (`:100`): the loop, the
    server wait, and the port resolution are all inside it, so a bad path list cannot take the host
    down either.
  - *`ResolveWarmupPort(IServer, IConfiguration)`* (`:157-166`), `internal static` so it can be tested
    directly. It prefers the first `http://` address from the server's `IServerAddressesFeature`
    (`:159-160`), which is the only correct answer under Aspire's dynamic ports, falls back to
    `SelectCleartextUrl(configuration["ASPNETCORE_URLS"])` (`:161`), then parses the port by trimming a
    trailing slash and taking the last colon-delimited segment under `CultureInfo.InvariantCulture`
    (`:163`), and finally falls back to `DefaultPort` when nothing parses (`:165`).
  - *`SelectCleartextUrl(string?)`* (`:176-187`) picks the cleartext entry out of a possibly
    semicolon-separated `ASPNETCORE_URLS` list (`:183`), returning the first `http://` entry or, if
    there is none, the first entry at all (`:185-186`). Its doc comment explains why this stays string
    handling rather than `Uri` parsing (`:168-173`): wildcard hosts such as `+` and `*` are legal in
    that variable and `Uri` rejects them.
  - *Two `[LoggerMessage]` partial methods* (`:201-207`): EventId 1 at Information for the completed
    replay, EventId 2 at Warning carrying the exception for the failure, whose message is written for
    an operator reading a startup log, "first requests may be slow".
- **Why it's built this way**:
  - *An abstract class, where the sibling contract is an interface.* [IWarmupTask](#iwarmuptask) stays
    a bare interface because warm-up work has no shared mechanism; self-HTTP warm-up is the opposite
    case, where the mechanism is the entire risk and the per-service part is a string array. Making the
    shared part inheritable, and the varying part `abstract` or `virtual` with a documented default, is
    what turns six copies into six path lists.
  - *`public`, unlike its warmup siblings.* `WarmupHostedService`, `WarmupReadinessHealthCheck` and
    `OpenIdConnectMetadataWarmupTask` are `internal` because the framework wires them; this type is
    public precisely because consumers derive from it in their own assemblies.
  - *Its own handler rather than `IHttpClientFactory`.* The self-request must be pinned to a specific
    HTTP version against this host's own listener; a factory client would inherit the global
    `ConfigureHttpClientDefaults` pipeline, whose resilience handler and shared primary handler are
    tuned for outbound service-to-service calls, not for one loopback request at startup.
  - *`internal static` port resolution.* Extracting the resolution into a pure static function is what
    makes the trickiest logic in the file testable without a running host, and
    `[Rubric §14, Testability]` shows up exactly there: six of the class's test methods (eleven cases
    once the two `[Theory]` sets are expanded) exercise `ResolveWarmupPort` alone
    (`MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:67-131`),
    including the trailing-slash regression the comment at `:119-120` records.
  - The subsystem as a whole is
    **[ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html)**, and the
    HTTP/2-only cleartext endpoints this class must speak to are
    [ADR-012](https://ivanball.github.io/docs/adr/012-grpc-host-transport.html).
- **Where it's used**: never registered by the framework. A host derives a task and registers it with
  `AddWarmupTask<TTask>()`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:306`). ADC has three derived tasks:
  [SelfHttpOutputCacheWarmupTask](group-20-conference-api-grpc.md#selfhttpoutputcachewarmuptask) in
  Conference, which replays eight anonymous read URLs in two families because the two caller families
  build query strings differently
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:42-56`,
  registered at `.../MMCA.ADC.Conference.Service/Program.cs:244`), and a
  [SelfHttpWarmupTask](group-22-engagement-module.md#selfhttpwarmuptask) in Engagement
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/SelfHttpWarmupTask.cs:33-49`, registered at
  `Program.cs:135`) plus a [SelfHttpWarmupTask](group-24-identity-module.md#selfhttpwarmuptask) in
  Identity (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/SelfHttpWarmupTask.cs:33-49`,
  registered at `Program.cs:171`), both of which override `RequireSuccessStatusCode` to `false` because
  their one path is protected. Store has three more of the same shape, and its Sales task is the one
  that overrides the version pin as well, staying on HTTP/1.1 because that host serves no inbound gRPC
  (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/SelfHttpOutputCacheWarmupTask.cs:50-59`).
  Behavior is covered by
  [SelfHttpWarmupTaskBaseTests](group-27-testing-infrastructure.md#selfhttpwarmuptaskbasetests), which
  drives a `ConfigurableWarmupTask` subclass (`SelfHttpWarmupTaskBaseTests.cs:330-351`) against real
  Kestrel listeners started as `Http2` or `Http1` (`:199-327`).
- **Caveats / not-in-source**:
  - *A required-success failure abandons the remaining paths.* `EnsureSuccessStatusCode` throws out of
    the loop into the outer catch (`:127`, `:142`), so with the default profile the first bad path ends
    the run and the later ones are never warmed; the test asserts exactly that, one requested path and
    one Warning entry (`SelfHttpWarmupTaskBaseTests.cs:255-274`).
  - *The value-exactness rule is a convention, not a check.* Nothing verifies that a derived task's
    `WarmupPaths` match the URLs real callers build, so a drifted query string warms a cache entry no
    caller reads, silently and with a success log. The derived tasks record the mapping in comments
    (for example `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:30-41`).
  - *Not determinable from source*: how much first-request latency this actually removes on a
    CPU-throttled ACA replica. The class documents the cost model it is built against (`:12-15`), and
    the tests prove the requests are issued and the failures are non-fatal, but no benchmark or gate in
    the repo measures the saving.

---

### WarmupHostedService

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Warmup` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/WarmupHostedService.cs:28` · Level 1 · class (sealed, internal, partial)

- **What it is**: the `BackgroundService` that runs every registered [IWarmupTask](#iwarmuptask)
  exactly once on startup, in parallel and each under a per-task timeout, then opens the
  [WarmupReadinessGate](#warmupreadinessgate).
- **Depends on**: [IWarmupTask](#iwarmuptask) (the set it runs, injected as `IEnumerable<IWarmupTask>`)
  and [WarmupReadinessGate](#warmupreadinessgate) (the gate it opens); `BackgroundService`,
  `ILogger<T>`, `Stopwatch`, plus the two optional primary-constructor parameters
  `TimeProvider? timeProvider` and `TimeSpan? taskTimeout` (`WarmupHostedService.cs:32-33`) that back
  the per-task timeout (BCL).
- **Concept introduced, fail-open startup gating.** `[Rubric §29, Resilience & Business Continuity]`
  (the startup readiness gate), `[Rubric §13, Observability]` (timing logs per task and overall). The
  defining design choice, stated in the class doc comment (`WarmupHostedService.cs:7-19`), is that the
  gate opens even if tasks fail: a stuck dependency "must not keep the replica out of traffic rotation
  forever" (`:9-12`). The second paragraph of that comment (`:13-19`) extends fail-open to the harder
  case: failure was already harmless, but a task that neither completes nor throws used to leave
  `Task.WhenAll` pending forever and the gate closed with it, "strictly worse than serving a cold one",
  so the per-task ceiling turns hanging into the same log-and-continue path. Both are availability
  chosen over strict warmth, and
  [ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html) calls it the
  load-bearing decision of the subsystem.
- **Walkthrough**:
  - Constructor and timeout state first: the primary constructor (`:28-33`) takes the task set, the
    gate, and the logger, then two optional parameters, `TimeProvider? timeProvider = null` and
    `TimeSpan? taskTimeout = null`. They exist for testability, and the doc comment says so (`:24-27`:
    the override lets tests "exercise the timeout path without waiting two minutes; production always
    takes the default"). The backing fields resolve the defaults once,
    `_timeProvider = timeProvider ?? TimeProvider.System` (`:44`) and
    `_taskTimeout = taskTimeout ?? TimeSpan.FromSeconds(TaskTimeoutSeconds)` (`:45`), over the
    `private const int TaskTimeoutSeconds = 120` (`:42`) whose doc comment (`:35-41`) insists it is "a
    backstop, not a latency budget".
  - `ExecuteAsync(CancellationToken stoppingToken)` (`:47`): starts an overall `Stopwatch` (`:49`),
    runs `Task.WhenAll(tasks.Select(task => RunOneAsync(task, stoppingToken)))` (`:53-54`), and,
    crucially, opens the gate in a **`finally`** block, `gate.MarkReady()` (`:58`) followed by
    `LogWarmupComplete` with the elapsed milliseconds (`:59`). A failing or hanging task therefore can
    never keep the replica permanently unready.
  - `RunOneAsync(task, cancellationToken)` (`:63`): times each task with its own `Stopwatch` (`:65`),
    then awaits `task.ExecuteAsync(cancellationToken)` (`:68`) chained through
    `.WaitAsync(_taskTimeout, _timeProvider, cancellationToken)` (`:69`), and logs the completion with
    the task name and duration (`:71`). Three catch clauses follow, in order. It **rethrows**
    `OperationCanceledException` when the host is actually stopping (`:73-76`, the
    `when (cancellationToken.IsCancellationRequested)` filter), so shutdown is not mistaken for a task
    failure. A `TimeoutException` from the `WaitAsync` ceiling is caught and logged at Warning through
    `LogTaskTimedOut` with the task name, elapsed milliseconds, and `_taskTimeout.TotalSeconds`
    (`:77-82`); the comment there (`:79-80`) states the outcome plainly, "Same outcome as a failure:
    the abandoned task keeps running detached, the gate opens, and the dependency is retried lazily on
    first use". Every other exception is caught and logged at Warning (`:84`, `:87`), with
    `#pragma warning disable CA1031` and the comment "warm-up failures must never crash the host"
    (`:83-85`) documenting that swallowing a general exception is intentional here: a transient warm-up
    failure self-heals through the Polly retry pipeline on the first real request.
  - Four source-generated `[LoggerMessage]` methods (`:91-105`): `LogTaskCompleted` (`:93`, EventId 1,
    Information), `LogTaskFailed` (`:97`, EventId 2, Warning, carrying the exception),
    `LogWarmupComplete` (`:101`, EventId 3, Information), and `LogTaskTimedOut` (`:105`, EventId 4,
    Warning, carrying the exception plus the limit in seconds so the log line names the ceiling that
    fired).
- **Why it's built this way**: `internal sealed partial`. Running the tasks with `Task.WhenAll` rather
  than sequentially means total warm-up time is the slowest task, not the sum. The
  `finally`-open-the-gate pattern is the resilience invariant from [IWarmupTask](#iwarmuptask)'s
  contract, expressed in the one place that can enforce it, and the per-task `WaitAsync` is what makes
  that invariant hold against a task that hangs instead of throwing. Distinguishing host cancellation
  (rethrow) from timeout and from ordinary failure (both log and continue) keeps shutdown clean while
  making warm-up best-effort. Two details are deliberate: the `WaitAsync` overload takes a
  `TimeProvider`, which is why the constructor accepts one, so a test can drive the timeout path
  without a real wall-clock wait; and 120 seconds is chosen to sit **above** the 90-second shared Polly
  total-request timeout that already bounds the built-in OIDC task's HTTP call
  ([HttpResilienceDefaults](#httpresiliencedefaults),
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:19`, applied in
  `Extensions.cs:62`), so per the const's own comment (`:36-41`) a task that reaches this limit is one
  that bypassed those defaults or is waiting on something that will never arrive.
- **Where it's used**: registered as a hosted service by `AddWarmupReadiness`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:104`), which supplies no values for the
  two optional parameters, so production runs on `TimeProvider.System` and the 120-second default.
  Covered by [WarmupHostedServiceTests](group-27-testing-infrastructure.md#warmuphostedservicetests),
  which constructs the service directly and passes a short `taskTimeout` to exercise the hanging-task
  case.
- **Caveats / not-in-source**: `WaitAsync` abandons rather than cancels, so a timed-out task keeps
  running detached for the life of the host (the comment at `:79-80` says exactly this); the only token
  that can stop it is the host's `stoppingToken` at shutdown. The ceiling also bounds the damage rather
  than removing it: a replica whose warm-up hangs stays out of rotation for the full 120 seconds before
  it is admitted. And the ceiling is not operator-tunable, since `TaskTimeoutSeconds` is a
  `private const` (`:42`) and the `taskTimeout` parameter is reachable only from a direct constructor
  call, with no configuration binding anywhere in the file.
  [ADR-025](https://ivanball.github.io/docs/adr/025-startup-warmup-readiness.html) (revised 2026-08-01)
  records the previously unbounded wait as a known gap that is now closed, and these two residual costs
  as its trade-offs.

---

### WarmupReadinessHealthCheck

> MMCA.Common.Aspire · `MMCA.Common.Aspire.Warmup` · `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/WarmupReadinessHealthCheck.cs:9` · Level 1 · class (sealed, internal)

- **What it is**: an `IHealthCheck` that reports unhealthy until the
  [WarmupReadinessGate](#warmupreadinessgate) opens. It is registered with the `ready` tag so it
  appears on the `/health/ready` endpoint that ACA readiness probes hit.
- **Depends on**: [WarmupReadinessGate](#warmupreadinessgate) (primary-constructor injection);
  `IHealthCheck` and `HealthCheckResult` (ASP.NET Core diagnostics).
- **Concept introduced**: `[Rubric §13, Observability]`, `[Rubric §29, Resilience]`. This is the bridge
  between the in-process gate and the hosting platform: the readiness probe's HTTP result is driven by
  one boolean. The readiness-probe concept itself is taught at
  [WarmupReadinessGate](#warmupreadinessgate), and the tag vocabulary at
  [HealthCheckTags](#healthchecktags).
- **Walkthrough**: a single method, `CheckHealthAsync(HealthCheckContext, CancellationToken)`
  (`WarmupReadinessHealthCheck.cs:11-16`), returning
  `Task.FromResult(gate.IsReady ? HealthCheckResult.Healthy("Warm-up complete.") :
  HealthCheckResult.Unhealthy("Warm-up in progress."))`. It is synchronous under an async signature
  because reading a volatile `int` involves no I/O; `Task.FromResult` avoids a state machine entirely.
- **Why it's built this way**: `internal sealed`, since the framework wires it. Keeping it trivially
  cheap (no I/O, no allocation beyond the result) means the platform can poll the readiness endpoint
  frequently without cost, which matters because probe intervals are measured in seconds. The two
  description strings are what an operator sees in the `/health/ready` payload, so they are written for
  a human reading a probe failure.
- **Where it's used**: registered as the `"warmup"` check tagged
  [`HealthCheckTags.Ready`](#healthchecktags) by `AddWarmupReadiness`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:108-109`); surfaced at `/health/ready`
  by `MapDefaultEndpoints` (`Extensions.cs:349-352`), whose predicate admits every check tagged neither
  `live` nor `optional` (`:351`). Covered by
  [WarmupReadinessHealthCheckTests](group-27-testing-infrastructure.md#warmupreadinesshealthchecktests).


---
[⬅ Common UI Framework (MudBlazor components, theme, base pages)](group-15-common-ui-framework.md)  •  [Index](00-index.md)  •  [ADC Conference - Domain Model & Module Contracts ➡](group-17-conference-domain.md)
